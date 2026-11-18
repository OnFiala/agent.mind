import { createHash } from 'node:crypto';

// Pure decision layer. Callers own safe reads, agreeing scans and live identity
// verification. Nothing here reads a project or resolves a reference.
export const SCOPED_LIMITS = Object.freeze({ origins: 10000, referenceObservations: 100000, decisionWork: 200000,
  evidenceBytes: 16777216, wireBytesDefault: 32768, wireBytesMax: 1048576, wireBytesMin: 256, cursorBytes: 4096 });
export const SCOPED_OPERATIONS = Object.freeze(['inspect-selected-source@1', 'review-direct-file-boundary@1']);
export const SCOPED_MODEL = 'typed-static-local-v1@1';
const typedProducer = Object.freeze({ parser: '@babel/parser@7.29.12', collector: 'typed-reference-syntax-v1', resolver: 'bundler-local-v1' });
const categories = new Set(['analysis-limitation', 'inventory-omission', 'domain-notice', 'invalid-policy', 'invalid-resolver', 'naming-limitation', 'unknown']);
const nonclaims = Object.freeze(['edit-authority', 'refactor-safety', 'runtime-behavior', 'test-pass', 'security-assurance',
  'whole-application-completeness', 'consumer-read-completion', 'host-instruction-activation', 'filesystem-lock']);
const hashPattern = /^[a-f0-9]{64}$/;
const pathValid = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') &&
  !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const scopedDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = value => value === undefined ? null : structuredClone(value);
const same = (a, b) => scopedDigest(a) === scopedDigest(b);

export function scopedRequirements(operation, model = null) {
  if (!SCOPED_OPERATIONS.includes(operation) || (operation === SCOPED_OPERATIONS[1] ? model !== SCOPED_MODEL : model !== null)) {
    const error = new TypeError('Unsupported scoped operation/model'); error.code = 'invalid-request'; throw error;
  }
  const boundary = operation === SCOPED_OPERATIONS[1];
  const descriptor = { schemaVersion: 1, operation, model, selectedText: 'complete-hash-bound-utf8',
    incoming: boundary ? 'all-admitted-origins' : 'not-required', outgoing: boundary ? 'all-selected-file-references' : 'not-required',
    ...(boundary ? { relations: ['import', 'reexport'], producer: { ...typedProducer },
      originUniverse: 'all-admitted-files-and-unknown-subtrees', resolution: 'bundler-local-v1',
      unsupported: 'unknown-unless-model-bound-exhaustive-disjoint-proof',
      jsonNonOrigin: { producer: 'strict-json-v1', jsonDepth: 256, jsonValues: 100000,
        bytes: 'existing-index-bound', requiredRole: 'none-or-validated-control' } } : {}),
    limits: { ...SCOPED_LIMITS }, nonclaims: [...nonclaims], testResults: 'not-observed' };
  return { descriptor, digest: scopedDigest(descriptor) };
}

/** Evaluate the full checked observation before projection/pagination. */
export function evaluateScoped({ graph, coverage, selection, operation, model = null, identity } = {}) {
  const blockingReasons = [], nonblockingReasons = [];
  const reasonKeys = new Set();
  const add = (code, path, evidence, rejection = false, nonblocking = false) => {
    const key = JSON.stringify([code, path ?? null, evidence ?? null, rejection, nonblocking]);
    if (reasonKeys.has(key)) return;
    reasonKeys.add(key);
    (nonblocking ? nonblockingReasons : blockingReasons).push({ code, ...(path ? { path } : {}),
      ...(evidence ? { evidence } : {}), ...(rejection ? { rejection: true } : {}) });
  };
  let requirements = null;
  try { requirements = scopedRequirements(operation, model); } catch { add('invalid-request', null, null, true); }
  const boundary = operation === SCOPED_OPERATIONS[1];
  const graphObject = graph && typeof graph === 'object';
  const inventory = Array.isArray(graph?.inventory?.entries) ? graph.inventory.entries : [];
  const diagnostics = Array.isArray(graph?.diagnostics) ? graph.diagnostics : [];
  const origins = Array.isArray(coverage?.origins) ? coverage.origins : [];
  const sourceNodes = new Map((Array.isArray(graph?.nodes) ? graph.nodes : []).filter(node => node?.path).map(node => [node.path, node]));
  const selected = Array.isArray(selection?.files) ? selection.files : [];
  const selectedPaths = new Set(selected.map(file => file?.path));
  const selectedText = [], originResults = [];
  let incoming = boundary ? 'satisfied' : 'not-required', outgoing = boundary ? 'satisfied' : 'not-required';
  const unknown = (code, path, evidence, selectedOrigin = false) => {
    add(code, path, evidence); incoming = 'unknown'; if (selectedOrigin) outgoing = 'unknown';
  };
  if (!graphObject || !['current', 'partial'].includes(graph?.status) || !Array.isArray(graph?.inventory?.entries) || !Array.isArray(graph?.diagnostics)) add('unclassified-evidence', null, null, true);
  if (graph?.inputPolicy?.status !== 'valid') add('invalid-policy', null, null, true);
  if ((!identity?.verified && (!identity?.errors?.length || Array.isArray(identity.errors) && identity.errors.some(error => !['invalid-selection', 'selected-source-unavailable', 'invalid-policy', 'invalid-resolver'].includes(error?.code)))) || !Array.isArray(identity?.errors) || identity.errors.length || !hashPattern.test(identity?.runtimeId ?? '') ||
      !hashPattern.test(identity?.snapshot ?? '') || !hashPattern.test(identity?.scopedSnapshot ?? '') ||
      requirements && identity?.requirementsDigest !== requirements.digest) add('identity-mismatch', null, 'identity', true);
  if (identity?.binding !== null && (!identity?.binding || typeof identity.binding !== 'object')) add('identity-mismatch', null, 'binding', true);
  for (const error of Array.isArray(identity?.errors) ? identity.errors : []) add(['invalid-selection', 'selected-source-unavailable', 'invalid-policy', 'invalid-resolver'].includes(error?.code) ? error.code : 'identity-mismatch', error?.path, error?.code ?? 'identity-error', true);
  if (boundary && (graph?.resolver?.mode !== 'bundler-local-v1' || graph?.resolver?.status !== 'valid' ||
      !hashPattern.test(graph?.resolver?.configHash ?? '') || graph?.resolver?.policyId !== graph?.inputPolicy?.id)) add('invalid-resolver', null, null, true);
  if (!selection || !['file', 'block', 'symbol'].includes(selection.kind) || !selection.id ||
      !hashPattern.test(selection.digest ?? '') || !selected.length || selectedPaths.size !== selected.length) add('invalid-selection', null, null, true);
  const entries = new Map();
  for (const entry of inventory) {
    if (!entry || typeof entry.path !== 'string' || entries.has(entry.path)) add('unclassified-evidence', entry?.path, 'inventory', true);
    else entries.set(entry.path, entry);
  }
  for (const file of selected) {
    const entry = entries.get(file?.path);
    const valid = pathValid(file?.path) && file?.id && hashPattern.test(file?.hash ?? '') && Number.isSafeInteger(file?.bytes) && file.bytes >= 0 &&
      entry?.state === 'text' && entry.hash === file.hash && entry.bytes === file.bytes;
    selectedText.push({ path: file?.path ?? null, hash: file?.hash ?? null, state: valid ? 'satisfied' : 'failed' });
    if (!valid) add('selected-source-unavailable', file?.path, 'inventory', true);
  }
  let evidenceBytes = 0, observations = 0, work = inventory.length + diagnostics.length + selected.length + origins.length + sourceNodes.size;
  try { evidenceBytes = Buffer.byteLength(JSON.stringify({ coverage, selection, diagnostics }), 'utf8'); }
  catch { add('unclassified-evidence', null, 'non-json-evidence', true); }
  if (coverage?.budget?.status === 'exceeded') add(coverage.budget.reason === 'evidence-bytes' ? 'evidence-budget-exceeded' : 'work-budget-exceeded', null, 'coverage-budget', true);
  if (evidenceBytes > SCOPED_LIMITS.evidenceBytes) add('evidence-budget-exceeded', null, null, true);
  if (origins.length > SCOPED_LIMITS.origins) add('work-budget-exceeded', null, 'origins', true);
  const ledgerValid = coverage?.schemaVersion === 1 && coverage?.version === 'scoped-origin-ledger-v1' && hashPattern.test(coverage?.runtimeId ?? '') &&
    Array.isArray(coverage?.origins) && typeof coverage?.enumeration?.complete === 'boolean' && Array.isArray(coverage?.enumeration?.boundaries);
  const earlyRejected = () => blockingReasons.some(reason => reason.rejection);
  if (!ledgerValid && !earlyRejected()) {
    if (boundary) unknown('origin-coverage-unknown', null, 'ledger');
    else add('analysis-not-required', null, 'missing-ledger', false, true);
  }
  const classified = Array.isArray(coverage?.diagnostics) ? coverage.diagnostics : [];
  if (classified.length !== diagnostics.length) add('unclassified-evidence', null, 'diagnostics', true);
  for (let index = 0; index < diagnostics.length; index++) {
    const record = classified[index], diagnostic = diagnostics[index];
    if (record?.index !== index || !categories.has(record?.category) || record?.category === 'unknown' || record.digest !== scopedDigest(diagnostic)) {
      add('unclassified-evidence', diagnostic?.path, `diagnostic:${index}`, true); continue;
    }
    if (record.category === 'invalid-policy' || record.category === 'invalid-resolver') add(record.category, diagnostic?.path, `diagnostic:${index}`, true);
    else if (!boundary && !earlyRejected()) add(record.category === 'inventory-omission' ? 'outside-selected-text-read' :
      record.category === 'domain-notice' ? 'domain-boundary' : 'analysis-not-required', diagnostic?.path, `diagnostic:${index}`, false, true);
  }
  if (ledgerValid && !earlyRejected()) {
    const byPath = new Map(), targetPaths = new Set();
    for (const origin of origins) {
      observations += (origin?.references?.length ?? 0) + (origin?.unsupported?.length ?? 0);
      work += (origin?.references?.length ?? 0) + (origin?.unsupported?.length ?? 0);
      for (const observation of [...(Array.isArray(origin?.references) ? origin.references : []), ...(Array.isArray(origin?.unsupported) ? origin.unsupported : [])]) {
        work += (observation?.candidates?.length ?? 0) + (observation?.vetoes?.length ?? 0) + (observation?.traversals?.length ?? 0) + (observation?.endpointProof?.possibleTargets?.length ?? 0);
      }
      if (!origin || !pathValid(origin.path) || byPath.has(origin.path)) add('unclassified-evidence', origin?.path, 'origin', true);
      else byPath.set(origin.path, origin);
      for (const reference of Array.isArray(origin?.references) ? origin.references : []) if (reference?.status === 'resolved') targetPaths.add(reference.target);
    }
    if (observations > SCOPED_LIMITS.referenceObservations || work > SCOPED_LIMITS.decisionWork) add('work-budget-exceeded', null, 'observations', true);
    const budgetFailed = blockingReasons.some(reason => ['work-budget-exceeded', 'evidence-budget-exceeded'].includes(reason.code));
    if (!budgetFailed && !earlyRejected()) {
      for (const entry of inventory) {
        if (entry?.state === 'excluded' || entry?.path?.endsWith('/') || entry?.path === '.') continue;
        if (!byPath.has(entry.path) && boundary) unknown('origin-coverage-unknown', entry.path, 'missing-origin', selectedPaths.has(entry.path));
      }
      for (const origin of origins) {
        const path = origin.path, entry = entries.get(path), isSelected = selectedPaths.has(path);
        const producer = origin.analysis?.producer;
        const producerKnown = producer === 'strict-json-v1' || producer === 'scoped-origin-ledger-v1' ||
          producer && typeof producer === 'object' && same(producer, typedProducer);
        const coherent = entry && entry.state !== 'excluded' && origin.read?.state === entry.state && (origin.hash ?? null) === (entry.hash ?? null);
        if (!producerKnown || !['typed-origin', 'json-non-origin', 'unknown'].includes(origin.classification) ||
            origin.classification === 'typed-origin' && !(producer && typeof producer === 'object' && same(producer, typedProducer)) ||
            origin.classification === 'json-non-origin' && producer !== 'strict-json-v1' || !Array.isArray(origin.references) || !Array.isArray(origin.unsupported) ||
            !['complete', 'unknown'].includes(origin.analysis?.status) || !['complete', 'withheld', 'not-observed'].includes(origin.analysis?.parse) ||
            !['complete', 'withheld', 'not-observed'].includes(origin.analysis?.referenceTraversal) || !coherent) {
          add('unclassified-evidence', path, 'origin-record', true); originResults.push({ path, state: 'failed' }); continue;
        }
        if (!boundary) {
          if (origin.read.state !== 'text' || origin.analysis.status !== 'complete' || origin.classification !== 'typed-origin' || origin.unsupported.length || origin.references.some(reference => reference.status !== 'resolved')) add(origin.read.state === 'text' ? 'analysis-not-required' : 'outside-selected-text-read', path, 'origin', false, true);
          originResults.push({ path, state: 'not-required' }); continue;
        }
        const completeRead = origin.read.state === 'text' && hashPattern.test(origin.hash ?? '');
        const targetRole = targetPaths.has(path);
        if (origin.classification === 'json-non-origin' && producer === 'strict-json-v1' && completeRead &&
            origin.analysis.status === 'complete' && origin.analysis.parse === 'complete' && origin.analysis.referenceTraversal === 'complete' &&
            ['none', 'known-control'].includes(origin.jsonRole) && !isSelected && !targetRole && origin.references.length === 0 && origin.unsupported.length === 0) {
          add('verified-non-origin', path, 'origin', false, true); originResults.push({ path, state: 'satisfied', role: 'non-origin' }); continue;
        }
        const sourceNode = sourceNodes.get(path);
        const observedUnsupported = new Set(origin.unsupported.map(item => scopedDigest([item.reason, item.range ?? null])));
        const syntax = sourceNode?.referenceSyntax, resolution = sourceNode?.referenceResolution;
        const graphReferenceCoverage = sourceNode?.hash === origin.hash && syntax?.extraction === 'collected' && resolution?.extraction === 'collected' &&
          Array.isArray(syntax.facts) && syntax.facts.length === origin.references.length && Array.isArray(resolution.outcomes) && same(resolution.outcomes, origin.references) &&
          Array.isArray(syntax.unsupported) && syntax.unsupported.every(item => observedUnsupported.has(scopedDigest([item.reason, item.range ?? null])));
        const actualTyped = origin.classification === 'typed-origin' && producer && typeof producer === 'object' && same(producer, typedProducer);
        if (!actualTyped || !graphReferenceCoverage || !completeRead || origin.analysis.parse !== 'complete' || origin.analysis.referenceTraversal !== 'complete' ||
            origin.analysis.status !== 'complete' && !origin.unsupported.length) {
          unknown('origin-coverage-unknown', path, 'analysis', isSelected); originResults.push({ path, state: 'unknown' }); continue;
        }
        let state = 'satisfied';
        const uncertainties = [...origin.references, ...origin.unsupported];
        for (let index = 0; index < uncertainties.length; index++) {
          const reference = uncertainties[index], evidence = `origin:${path}:reference:${index}`;
          if (index < origin.references.length && reference.status === 'resolved' && ['import', 'reexport'].includes(reference.kind) &&
              reference.evidence?.path === path && reference.evidence?.hash === origin.hash && pathValid(reference.target)) {
            const target = entries.get(reference.target), witness = reference.candidates?.find(candidate => candidate.path === reference.target && candidate.state === 'eligible');
            if (target?.state === 'text' && hashPattern.test(target.hash ?? '') && witness?.hash === target.hash) continue;
          }
          const proof = reference.endpointProof;
          if (!isSelected && proof?.kind === 'finite-local' && proof.complete === true && proof.model === SCOPED_MODEL && proof.sourceHash === origin.hash &&
              proof.runtimeId === coverage.runtimeId && Array.isArray(proof.possibleTargets) && proof.possibleTargets.every(target => pathValid(target) && !selectedPaths.has(target))) {
            add('proven-disjoint', path, evidence, false, true); continue;
          }
          state = 'unknown'; unknown('reference-unknown', path, evidence, isSelected);
        }
        originResults.push({ path, state });
      }
      if (coverage.enumeration.complete !== true || coverage.enumeration.boundaries.length) {
        if (boundary) unknown('origin-universe-unknown', null, 'enumeration');
        else add('outside-selected-text-read', null, 'enumeration', false, true);
      }
    }
  }
  if (work > SCOPED_LIMITS.decisionWork) add('work-budget-exceeded', null, 'decision', true);
  if (boundary && !earlyRejected()) for (let index = 0; index < classified.length; index++) {
    const category = classified[index]?.category, path = diagnostics[index]?.path;
    if (category === 'domain-notice') add('domain-boundary', path, `diagnostic:${index}`, false, true);
    else if (category === 'naming-limitation' || category === 'analysis-limitation' && originResults.some(origin => origin.path === path && origin.state === 'satisfied') &&
        !nonblockingReasons.some(reason => reason.path === path && ['proven-disjoint', 'verified-non-origin'].includes(reason.code))) add('analysis-not-required', path, `diagnostic:${index}`, false, true);
  }
  const identityFailed = blockingReasons.some(reason => ['identity-mismatch', 'invalid-policy', 'invalid-resolver', 'invalid-request'].includes(reason.code));
  const budgetFailure = blockingReasons.some(reason => ['work-budget-exceeded', 'evidence-budget-exceeded'].includes(reason.code));
  if (boundary && earlyRejected()) { incoming = 'unknown'; outgoing = 'unknown'; }
  const obligations = { identity: identityFailed ? 'failed' : budgetFailure ? 'unknown' : 'satisfied',
    selection: blockingReasons.some(reason => reason.code === 'invalid-selection') ? 'failed' : 'satisfied',
    selectedText: selectedText.some(file => file.state === 'failed') || blockingReasons.some(reason => reason.code === 'selected-source-unavailable') ? 'failed' : 'satisfied',
    originUniverse: boundary ? ledgerValid && coverage.enumeration.complete && !coverage.enumeration.boundaries.length ? 'satisfied' : 'unknown' : 'not-required',
    originCoverage: boundary ? earlyRejected() || !ledgerValid || !coverage.enumeration.complete || coverage.enumeration.boundaries.length || blockingReasons.some(reason => reason.code === 'origin-coverage-unknown') ? 'unknown' : 'satisfied' : 'not-required', outgoing, incoming };
  for (const path of graph?.scope?.excluded ?? []) add('domain-boundary', path, 'scope', false, true);
  const decision = blockingReasons.some(reason => reason.rejection) ? 'rejected' : blockingReasons.length ? 'insufficient-evidence' : 'sufficient-at-read';
  const installed = !!identity?.binding && identity?.verified === true;
  return { receipt: installed ? 'scoped-preflight' : 'scoped-preview', schemaVersion: 1, mode: installed ? 'installed' : 'unbound-preview', installedReceipt: installed,
    operation: operation ?? null, model, requirementsDigest: requirements?.digest ?? null,
    project: clone(graph?.project), revision: graph?.revision ?? null, snapshot: identity?.snapshot ?? null, scopedSnapshot: identity?.scopedSnapshot ?? null,
    runtimeId: identity?.runtimeId ?? null, binding: clone(identity?.binding), inputPolicy: clone(graph?.inputPolicy), selection: clone(selection),
    globalStatus: graph?.status ?? null, freshness: identity?.verified === true && !blockingReasons.some(reason => reason.code === 'identity-mismatch') ? 'verified-at-read' : 'not-verified',
    coverage: { obligations, globalInventory: clone(graph?.inventory), selectedText, origins: originResults, incoming, outgoing,
      admittedDomain: { policyId: graph?.inputPolicy?.id ?? null, excluded: clone(graph?.scope?.excluded ?? []), outsideDomain: 'unknown',
        enumeration: clone(coverage?.enumeration) } }, decision, blockingReasons, nonblockingReasons,
    uncertainty: { global: { inventoryStatus: graph?.inventory?.status ?? 'unknown', limitations: clone(graph?.scope?.limitations ?? []),
      diagnosticCount: diagnostics.length, originUniverse: coverage?.enumeration?.complete === true ? 'complete' : 'unknown' },
      local: { requiredUnknowns: blockingReasons.filter(reason => !reason.rejection).length, incoming, outgoing }, testResults: 'not-observed' },
    diagnostics: { count: diagnostics.length, records: clone(diagnostics), classifications: clone(classified) },
    evidence: { coverageDigest: ledgerValid ? scopedDigest(coverage) : null, selectionDigest: selection?.digest ?? null, bytes: evidenceBytes, work, referenceObservations: observations },
    claims: { promise: operation === SCOPED_OPERATIONS[0] ? 'Exact selected complete bounded UTF-8 text at the checked hashes and admitted policy at read time.' :
      boundary ? 'All direct incoming/outgoing file-reference observations for selected files accounted for within typed-static-local-v1@1 and the admitted domain at read time.' : null,
      applies: decision === 'sufficient-at-read', nonclaims: [...nonclaims], testResults: 'not-observed' } };
}
