import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexProject, getScopedCoverage, readIndexedSource } from './code-index.mjs';
import { projectContext } from './graph-context.mjs';
import { SCOPED_LIMITS, scopedRequirements, scopedDigest, evaluateScoped } from './scoped-preflight.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const canonical = value => JSON.stringify(sorted(value));
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const publicBinding = binding => binding ? Object.fromEntries(Object.entries(binding).filter(([, value]) => typeof value !== 'function')) : null;
const allowed = new Set(['schemaVersion', 'operation', 'model', 'selector', 'revision', 'snapshot', 'bindingId', 'generation', 'scopedSnapshot', 'requirementsDigest', 'section', 'cursor', 'maxBytes']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const runtimeFiles = ['code-index.mjs', 'source-analysis.mjs', 'typed-analysis.mjs', 'typed-resolution.mjs', 'python-analysis.mjs', 'symbol-index.mjs', 'project-map.mjs', 'graph-context.mjs', 'scoped-coverage.mjs', 'scoped-preflight.mjs', 'scoped-context.mjs', 'installation.mjs', 'server.mjs', 'public/hierarchy.mjs'];
function runtimeIdentity() {
  // Executing runtime files only, never files from the scanned project.
  return scopedDigest(runtimeFiles.map(name => [name, scopedDigest(fs.readFileSync(fileURLToPath(new URL(name, import.meta.url))).toString('base64'))]));
}

export function scopedProtocolError(error, maxBytes) {
  const output = { schemaVersion: 1, profile: 'scoped', error: { code: error.code || 'SCOPED_REQUEST_FAILED', message: error.message } };
  if (maxBytes !== undefined) output.error.maxBytes = maxBytes;
  return output;
}

function validateRequest(request, stage, binding) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !allowed.has(key))) throw fail('INVALID_SCOPED_REQUEST', 'Unknown scoped request field.');
  if (!['bootstrap', 'prepare', 'evidence', 'preflight'].includes(stage) || request.schemaVersion !== 1) throw fail('INVALID_SCOPED_REQUEST', 'Use scoped contract schema version 1.');
  if (typeof request.selector !== 'string' || !request.selector.trim() || request.selector.length > 4096) throw fail('INVALID_SCOPED_REQUEST', 'One exact nonempty source selector is required.');
  const requirements = scopedRequirements(request.operation, request.model);
  const maxBytes = request.maxBytes ?? SCOPED_LIMITS.wireBytesDefault;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < SCOPED_LIMITS.wireBytesMin || maxBytes > SCOPED_LIMITS.wireBytesMax) throw fail('INVALID_SCOPED_BUDGET', 'Scoped maxBytes is outside the supported integer range.');
  if (stage === 'bootstrap') {
    if (Object.keys(request).some(key => !['schemaVersion', 'operation', 'model', 'selector', 'maxBytes'].includes(key))) throw fail('INVALID_SCOPED_REQUEST', 'Bootstrap accepts only the operation, model, selector and wire budget.');
  } else {
    if (![request.revision, request.snapshot].every(value => typeof value === 'string' && HASH.test(value))) throw fail('INVALID_SCOPED_REQUEST', 'Original R02 revision and snapshot are required.');
    if (binding) {
      if (!UUID.test(request.bindingId ?? '') || !Number.isSafeInteger(request.generation) || request.generation < 1) throw fail('INVALID_SCOPED_REQUEST', 'Installed binding ID and generation are required.');
    } else if (request.bindingId !== undefined || request.generation !== undefined) throw fail('INVALID_SCOPED_REQUEST', 'Unbound preview cannot accept an installed binding.');
    if (stage === 'prepare') {
      if (['scopedSnapshot', 'requirementsDigest', 'section', 'cursor'].some(key => request[key] !== undefined)) throw fail('INVALID_SCOPED_REQUEST', 'First preparation uses the original R02 identity only.');
    } else if (![request.scopedSnapshot, request.requirementsDigest].every(value => typeof value === 'string' && HASH.test(value))) throw fail('INVALID_SCOPED_REQUEST', 'Continuation and preflight require the prepared scoped snapshot and requirements digest.');
    if (stage === 'preflight' && (request.section !== undefined || request.cursor !== undefined)) throw fail('INVALID_SCOPED_REQUEST', 'Preflight returns a receipt, not an evidence page.');
  }
  return { requirements, maxBytes };
}

function checkedRoot(root) {
  if (!path.isAbsolute(root) || fs.lstatSync(root).isSymbolicLink()) throw fail('SCOPED_ROOT_CHANGED', 'The scoped root must be an absolute real directory.');
  const real = fs.realpathSync(root), stat = fs.statSync(real);
  if (!stat.isDirectory()) throw fail('SCOPED_ROOT_CHANGED', 'The scoped root is not a directory.');
  return { path: real, dev: stat.dev, ino: stat.ino };
}
function verifyBinding(binding) {
  if (!binding) return;
  if (typeof binding.verifyScoped !== 'function') throw fail('SCOPED_BINDING_UNVERIFIED', 'Full installed integrity verification is required for scoped reads.');
  binding.verifyScoped();
}
function selectionFor(graph, selector) {
  const full = projectContext(graph, selector);
  const selected = full.selection;
  if (!selected || !['file', 'symbol', 'block'].includes(selected.kind) || !Array.isArray(selected.fileIds) || !selected.fileIds.length) throw fail('INVALID_SCOPED_SELECTION', 'Select a file, symbol or source block with complete owning files.');
  const ids = [...new Set(selected.fileIds)].sort();
  const files = ids.map(id => {
    const node = graph.nodes.find(item => item.id === id);
    if (!node?.path || !HASH.test(node.hash ?? '') || !node.capabilities?.includes('text')) throw fail('SELECTED_SOURCE_UNAVAILABLE', 'Every selected owning file must have checked indexed text.');
    return { id: node.id, path: node.path, hash: node.hash, bytes: node.bytes };
  });
  return { id: selected.id, kind: selected.kind, files, digest: scopedDigest(files) };
}

// One source graph/ledger owner. Both CLI and HTTP call this exact builder.
export function scopedObservation(root, request, { stage = 'prepare', indexOptions = {}, binding = null } = {}) {
  const { requirements, maxBytes } = validateRequest(request, stage, binding);
  verifyBinding(binding);
  const beforeRoot = checkedRoot(root), runtimeId = runtimeIdentity();
  const options = { ...indexOptions, scopedEvidence: true };
  const first = indexProject(beforeRoot.path, options);
  const checked = indexProject(beforeRoot.path, { ...options, previous: first });
  const errors = [];
  if (first.revision !== checked.revision) errors.push({ code: 'identity-mismatch', detail: 'source-drift' });
  const exposedBinding = publicBinding(binding);
  if (exposedBinding) checked.binding = exposedBinding;
  let selection;
  try { selection = selectionFor(checked, request.selector); }
  catch (error) {
    selection = { id: null, kind: null, files: [], digest: scopedDigest([]) };
    errors.push({ code: error.code === 'SELECTED_SOURCE_UNAVAILABLE' ? 'selected-source-unavailable' : 'invalid-selection' });
  }
  // R02 identity is reconstructed from this fresh source projection, never SSE.
  let context;
  try { context = projectContext(checked, request.selector, { profile: 'agent', maxBytes: SCOPED_LIMITS.wireBytesMax }); }
  catch {
    context = projectContext(checked, undefined, { profile: 'agent', maxBytes: SCOPED_LIMITS.wireBytesMax });
    if (!errors.some(item => item.code === 'invalid-selection')) errors.push({ code: 'invalid-selection' });
  }
  if (context.error) throw fail('SCOPED_EVIDENCE_BUDGET', 'Original R02 identity cannot fit its mandatory envelope.');
  const coverage = getScopedCoverage(checked);
  // Compare the complete internal observation, not merely a stable omission.
  projectContext(first, undefined);
  if (scopedDigest(getScopedCoverage(first)) !== scopedDigest(coverage)) errors.push({ code: 'identity-mismatch', detail: 'evidence-drift' });
  if (request.operation === 'review-direct-file-boundary@1' && checked.resolver?.mode !== 'bundler-local-v1') errors.push({ code: 'invalid-resolver' });
  const baseEvidence = {
    schemaVersion: 1, originalSnapshot: context.snapshot, revision: checked.revision,
    project: checked.project, binding: exposedBinding, runtimeId, operation: request.operation,
    model: request.model ?? null, requirementsDigest: requirements.digest,
    inputPolicy: checked.inputPolicy, resolver: checked.resolver ?? null, selection, coverage
  };
  if (bytes(baseEvidence) > SCOPED_LIMITS.evidenceBytes) throw fail('SCOPED_EVIDENCE_BUDGET', 'The complete scoped evidence exceeds its fixed work envelope.');
  const scopedSnapshot = scopedDigest(baseEvidence);
  if (stage !== 'bootstrap') {
    if (request.revision !== checked.revision || request.snapshot !== context.snapshot) errors.push({ code: 'identity-mismatch', detail: 'original-context' });
    if (binding && (request.bindingId !== binding.id || request.generation !== binding.generation)) errors.push({ code: 'identity-mismatch', detail: 'binding' });
    if (stage !== 'prepare' && (request.scopedSnapshot !== scopedSnapshot || request.requirementsDigest !== requirements.digest)) errors.push({ code: 'identity-mismatch', detail: 'scoped-context' });
  }
  // Safe exact selected reads and a final agreeing scan before projection.
  for (const file of selection.files) {
    try { readIndexedSource(beforeRoot.path, checked.nodes.find(node => node.id === file.id), options); }
    catch { errors.push({ code: 'selected-source-unavailable', path: file.path }); }
  }
  const final = indexProject(beforeRoot.path, { ...options, previous: checked });
  projectContext(final, undefined);
  if (final.revision !== checked.revision || scopedDigest(getScopedCoverage(final)) !== scopedDigest(coverage)) errors.push({ code: 'identity-mismatch', detail: 'final-source-check' });
  if (canonical(checkedRoot(root)) !== canonical(beforeRoot) || runtimeIdentity() !== runtimeId) errors.push({ code: 'identity-mismatch', detail: 'root-or-runtime' });
  verifyBinding(binding);
  const identity = { verified: errors.length === 0, errors, runtimeId, binding: exposedBinding, snapshot: context.snapshot, scopedSnapshot, requirementsDigest: requirements.digest };
  const decision = evaluateScoped({ graph: checked, coverage, selection, operation: request.operation, model: request.model, identity });
  const sections = {
    selection: selection.files,
    origins: coverage?.origins ?? [],
    coverage: [coverage ? Object.fromEntries(Object.entries(coverage).filter(([key]) => key !== 'origins')) : { status: 'missing' }],
    diagnostics: checked.diagnostics,
    diagnosticClassifications: coverage?.diagnostics ?? [],
    inventory: checked.inventory?.entries ?? [],
    domain: [decision.coverage.admittedDomain],
    originResults: decision.coverage.origins,
    selectedText: decision.coverage.selectedText,
    reasons: [...decision.blockingReasons.map(value => ({ blocking: true, ...value })), ...decision.nonblockingReasons.map(value => ({ blocking: false, ...value }))],
    scope: [checked.scope],
    requirements: [requirements.descriptor]
  };
  const envelope = {
    schemaVersion: 1, profile: 'scoped', phase: stage === 'evidence' ? 'evidence' : 'preparation',
    preparation: true, operation: request.operation, model: request.model ?? null,
    project: checked.project, revision: checked.revision, snapshot: context.snapshot, scopedSnapshot,
    requirementsDigest: requirements.digest, runtimeId, binding: exposedBinding,
    inputPolicy: { id: checked.inputPolicy?.id ?? null, version: checked.inputPolicy?.version ?? null, status: checked.inputPolicy?.status ?? null },
    resolver: checked.resolver ?? null, globalStatus: checked.status,
    selection: { id: selection.id, kind: selection.kind, count: selection.files.length, digest: selection.digest },
    observation: errors.length ? 'rejected' : 'checked-at-read',
    claims: { preparationOnly: true, preflight: 'not-issued', consumerReadCompletion: 'not-observed', testResults: 'not-observed' },
    sections: Object.entries(sections).map(([kind, values]) => ({ kind, total: values.length, digest: scopedDigest(values) }))
  };
  return { graph: checked, coverage, selection, context, identity, decision, sections, envelope, maxBytes, errors };
}

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function cursorFor(snapshot, section, offset = 0, fragment = 0) {
  return encode({ namespace: 'scoped-evidence', version: 1, snapshot, section, offset, fragment });
}
export function scopedEvidenceCursor(preparation, section) {
  if (preparation?.profile !== 'scoped' || !HASH.test(preparation.scopedSnapshot ?? '') || !preparation.sections?.some(item => item.kind === section)) throw fail('INVALID_SCOPED_CURSOR', 'Unknown scoped evidence section.');
  return cursorFor(preparation.scopedSnapshot, section);
}
function readCursor(token, snapshot, sections, section) {
  try {
    if (typeof token !== 'string' || token.length > SCOPED_LIMITS.cursorBytes || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (encode(value) !== token || Object.keys(value).sort().join(',') !== 'fragment,namespace,offset,section,snapshot,version' || value.namespace !== 'scoped-evidence' || value.version !== 1 || value.snapshot !== snapshot || !Object.hasOwn(sections, value.section) || section !== undefined && section !== value.section || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > sections[value.section].length || !Number.isSafeInteger(value.fragment) || value.fragment < 0) throw new Error();
    const text = value.offset < sections[value.section].length ? canonical(sections[value.section][value.offset]) : '';
    if (value.fragment && (value.fragment >= text.length || /[\uDC00-\uDFFF]/u.test(text[value.fragment]))) throw new Error();
    return value;
  } catch { throw fail('INVALID_SCOPED_CURSOR', 'Scoped continuation identity or position is invalid. Prepare fresh context.'); }
}
function budgetError(maxBytes, requiredBytes) {
  return { schemaVersion: 1, profile: 'scoped', error: { code: 'SCOPED_BUDGET_TOO_SMALL', maxBytes, requiredBytes } };
}
export function scopedPage(observation, request = {}) {
  const { sections, maxBytes } = observation;
  const token = request.cursor;
  const position = token !== undefined ? readCursor(token, observation.envelope.scopedSnapshot, sections, request.section) : { section: request.section ?? 'selection', offset: 0, fragment: 0 };
  if (!Object.hasOwn(sections, position.section)) throw fail('INVALID_SCOPED_CURSOR', 'Unknown scoped evidence section.');
  const values = sections[position.section], response = structuredClone(observation.envelope);
  response.page = { section: position.section, offset: position.offset, items: [], fragments: [], next: null };
  const result = (offset, fragment) => {
    response.page.next = offset < values.length ? cursorFor(response.scopedSnapshot, position.section, offset, fragment) : null;
    response.page.omitted = values.length - response.page.items.length;
    return response;
  };
  const requiredBytes = bytes(result(position.offset, position.fragment));
  if (requiredBytes > maxBytes) return budgetError(maxBytes, requiredBytes);
  let offset = position.offset;
  if (!position.fragment) while (offset < values.length) {
    response.page.items.push({ index: offset, value: values[offset] });
    if (bytes(result(offset + 1, 0)) > maxBytes) { response.page.items.pop(); result(offset, 0); break; }
    offset++;
  }
  if (offset < values.length && !response.page.items.length) {
    const text = canonical(values[offset]), start = position.fragment;
    const fragment = { index: offset, offset: start, total: text.length, encoding: 'json-text', text: text.slice(start) };
    response.page.fragments.push(fragment);
    if (bytes(result(offset + 1, 0)) <= maxBytes) return response;
    const boundaries = [start];
    for (let end = start; end < text.length;) { end += text.codePointAt(end) > 65535 ? 2 : 1; boundaries.push(end); }
    let low = 0, high = boundaries.length - 2;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      fragment.text = text.slice(start, boundaries[middle]);
      if (bytes(result(offset, boundaries[middle])) <= maxBytes) low = middle; else high = middle - 1;
    }
    if (!low) { fragment.text = text.slice(start, boundaries[1]); return budgetError(maxBytes, bytes(result(offset, boundaries[1]))); }
    fragment.text = text.slice(start, boundaries[low]);
    result(offset, boundaries[low]);
  } else result(offset, 0);
  return response;
}

function sectionReference(observation, kind) {
  const section = observation.envelope.sections.find(item => item.kind === kind);
  return { section: kind, total: section.total, digest: section.digest, cursor: scopedEvidenceCursor(observation.envelope, kind) };
}
function stateCounts(values) {
  const counts = {};
  for (const value of values) { const state = value.state ?? value.status ?? 'unknown'; counts[state] = (counts[state] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
// The evaluator always sees full evidence. Wire receipts retain every reason
// code/count and bind the complete detail to the same reconstructed snapshot.
function projectScopedReceipt(observation) {
  const receipt = structuredClone(observation.decision);
  const grouped = values => {
    const groups = new Map();
    for (const item of values) {
      const key = JSON.stringify([item.code, item.rejection === true]);
      if (!groups.has(key)) groups.set(key, { code: item.code, count: 0, ...(item.rejection ? { rejection: true } : {}), evidence: sectionReference(observation, 'reasons') });
      groups.get(key).count++;
    }
    return [...groups.values()].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : Number(a.rejection) - Number(b.rejection));
  };
  receipt.blockingReasons = grouped(receipt.blockingReasons);
  receipt.nonblockingReasons = grouped(receipt.nonblockingReasons);
  receipt.diagnostics = { count: observation.graph.diagnostics.length, evidence: sectionReference(observation, 'diagnostics'),
    classifications: sectionReference(observation, 'diagnosticClassifications') };
  receipt.coverage.globalInventory = { status: observation.graph.inventory.status, entries: observation.graph.inventory.entries.length,
    states: stateCounts(observation.graph.inventory.entries), evidence: sectionReference(observation, 'inventory') };
  receipt.coverage.origins = { count: observation.decision.coverage.origins.length,
    states: stateCounts(observation.decision.coverage.origins), evidence: sectionReference(observation, 'originResults') };
  const domain = observation.decision.coverage.admittedDomain;
  receipt.coverage.admittedDomain = { policyId: domain.policyId, outsideDomain: 'unknown',
    excludedCount: domain.excluded.length, enumeration: { complete: domain.enumeration?.complete === true,
      unknownBoundaries: domain.enumeration?.boundaries?.length ?? null,
      unknownDescendantCount: domain.enumeration?.complete === true ? 0 : null }, evidence: sectionReference(observation, 'domain') };
  receipt.evidence.retrieval = observation.envelope.sections.map(section => ({ ...section, cursor: scopedEvidenceCursor(observation.envelope, section.kind) }));
  receipt.evidence.transfer = { fullEvidenceEvaluated: true, details: 'revision-bound-paged-evidence', consumerReadCompletion: 'not-observed' };
  return receipt;
}

export function scopedResponse(root, request, options = {}) {
  const stage = options.stage ?? 'prepare';
  const observation = scopedObservation(root, request, options);
  if (stage === 'preflight' || observation.errors.length) {
    const receipt = projectScopedReceipt(observation);
    let size = bytes(receipt);
    if (size > observation.maxBytes) {
      // Membership remains byte-exactly retrievable; no partial list is labeled complete.
      receipt.selection = { id: receipt.selection.id, kind: receipt.selection.kind, digest: receipt.selection.digest,
        count: observation.selection.files.length, evidence: sectionReference(observation, 'selection') };
      receipt.coverage.selectedText = { count: observation.decision.coverage.selectedText.length,
        states: stateCounts(observation.decision.coverage.selectedText), evidence: sectionReference(observation, 'selectedText') };
      size = bytes(receipt);
    }
    return size <= observation.maxBytes ? receipt : budgetError(observation.maxBytes, size);
  }
  if (stage === 'bootstrap') {
    const result = {
      schemaVersion: 1, profile: 'scoped', phase: 'bootstrap', preparation: true,
      operation: request.operation, model: request.model ?? null, selector: request.selector,
      revision: observation.context.revision, snapshot: observation.context.snapshot,
      binding: observation.identity.binding, globalStatus: observation.context.status,
      claims: { preflight: 'not-issued', testResults: 'not-observed' }
    };
    return bytes(result) <= observation.maxBytes ? result : budgetError(observation.maxBytes, bytes(result));
  }
  return scopedPage(observation, request);
}
