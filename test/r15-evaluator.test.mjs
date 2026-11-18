import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScoped, scopedRequirements, scopedDigest, SCOPED_OPERATIONS, SCOPED_MODEL, SCOPED_LIMITS } from '../scoped-preflight.mjs';

const H = 'a'.repeat(64), R = 'b'.repeat(64), S = 'c'.repeat(64);
const producer = { parser: '@babel/parser@7.29.12', collector: 'typed-reference-syntax-v1', resolver: 'bundler-local-v1' };
function origin(path, hash = H) {
  return { path, hash, read: { state: 'text' }, classification: 'typed-origin',
    analysis: { status: 'complete', producer: { ...producer }, parse: 'complete', referenceTraversal: 'complete' }, references: [], unsupported: [] };
}
function fixture() {
  const graph = { project: { root: '/disposable', name: 'fixture' }, revision: R, status: 'partial', inputPolicy: { id: H, status: 'valid', version: 1 },
    resolver: { mode: 'bundler-local-v1', status: 'valid', configPath: 'tsconfig.json', configHash: H, policyId: H },
    nodes: [], edges: [], diagnostics: [], inventory: { status: 'complete', entries: [
      { path: 'a.ts', state: 'text', hash: H, bytes: 8 }, { path: 'b.ts', state: 'text', hash: H, bytes: 8 }] },
    scope: { excluded: ['private/'], limitations: ['bounded static evidence'] } };
  const originRecords = [origin('a.ts'), origin('b.ts')];
  graph.nodes = originRecords.map(record => ({ id: `file:${record.path}`, path: record.path, hash: record.hash, referenceSyntax: { extraction: 'collected', facts: record.references, unsupported: [] }, referenceResolution: { extraction: 'collected', outcomes: record.references } }));
  return { graph, coverage: { schemaVersion: 1, version: 'scoped-origin-ledger-v1', runtimeId: H,
    enumeration: { complete: true, boundaries: [] }, origins: originRecords, diagnostics: [] },
    selection: { id: 'file:a.ts', kind: 'file', files: [{ id: 'file:a.ts', path: 'a.ts', hash: H, bytes: 8 }], digest: S },
    identity: { verified: true, errors: [], runtimeId: H, binding: { id: 'fixture', generation: 1, root: '/disposable' }, snapshot: R, scopedSnapshot: S } };
}
function run(input, boundary = false) {
  const operation = SCOPED_OPERATIONS[boundary ? 1 : 0], model = boundary ? SCOPED_MODEL : null;
  return evaluateScoped({ ...input, operation, model, identity: { ...input.identity, requirementsDigest: scopedRequirements(operation, model).digest } });
}
function envelope(receipt, decision, boundary) {
  assert.equal(receipt.decision, decision);
  assert.ok(['scoped-preflight', 'scoped-preview'].includes(receipt.receipt));
  assert.equal(receipt.installedReceipt, receipt.receipt === 'scoped-preflight');
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.globalStatus, 'partial');
  assert.equal(receipt.operation, SCOPED_OPERATIONS[boundary ? 1 : 0]);
  assert.equal(receipt.model, boundary ? SCOPED_MODEL : null);
  assert.equal(receipt.snapshot, R); assert.equal(receipt.scopedSnapshot, S);
  assert.equal(receipt.requirementsDigest, scopedRequirements(receipt.operation, receipt.model).digest);
  assert.equal(receipt.project.root, '/disposable'); assert.equal(receipt.revision, R);
  assert.equal(receipt.selection.files[0].path, 'a.ts');
  for (const field of ['binding', 'runtimeId', 'inputPolicy', 'freshness', 'coverage', 'uncertainty', 'diagnostics', 'evidence', 'claims', 'blockingReasons', 'nonblockingReasons']) assert.ok(field in receipt, field);
  assert.equal(receipt.claims.applies, decision === 'sufficient-at-read');
  assert.equal(receipt.claims.testResults, 'not-observed');
  assert.deepEqual(receipt.claims.nonclaims, ['edit-authority', 'refactor-safety', 'runtime-behavior', 'test-pass', 'security-assurance', 'whole-application-completeness', 'consumer-read-completion', 'host-instruction-activation', 'filesystem-lock']);
  assert.equal(receipt.coverage.admittedDomain.outsideDomain, 'unknown');
  assert.equal(receipt.coverage.incoming, boundary ? receipt.coverage.incoming : 'not-required');
  assert.equal(receipt.coverage.outgoing, boundary ? receipt.coverage.outgoing : 'not-required');
  assert.ok(receipt.nonblockingReasons.some(reason => reason.code === 'domain-boundary'));
}
function pair(input, text, boundary) { envelope(run(input), text, false); envelope(run(input, true), boundary, true); }
function unknown(input, index = 1) { input.coverage.origins[index].classification = 'unknown'; input.coverage.origins[index].analysis = { status: 'unknown', producer: 'scoped-origin-ledger-v1', parse: 'not-observed', referenceTraversal: 'not-observed' }; }
function diagnostic(input, category, severity = 'info') {
  const record = { path: 'b.ts', severity, message: 'opaque presentation wording' };
  input.graph.diagnostics.push(record); input.coverage.diagnostics.push({ index: 0, digest: scopedDigest(record), category });
}
function reference(status = 'unsupported') { return { kind: 'import', status, specifier: 'opaque', evidence: { path: 'b.ts', hash: H }, candidates: [] }; }

test('T01 complete model preserves global partial, exact selection and full promise/nonclaims', () => {
  const input = fixture(), before = structuredClone(input); pair(input, 'sufficient-at-read', 'sufficient-at-read'); assert.deepEqual(input, before);
  assert.equal(run(input, true).coverage.incoming, 'satisfied'); assert.equal(run(input, true).coverage.outgoing, 'satisfied');
});
test('T02 malformed outside origin has no incoming absence inference', () => { const x = fixture(); x.coverage.origins[1].analysis.parse = 'withheld'; x.coverage.origins[1].analysis.status = 'unknown'; diagnostic(x, 'analysis-limitation'); pair(x, 'sufficient-at-read', 'insufficient-evidence'); });
test('T03 computed outside import and info severity block boundary equally', () => {
  for (const severity of ['info', 'warning', 'error']) { const x = fixture(); x.coverage.origins[1].unsupported.push({ reason: 'dynamic-import' }); diagnostic(x, 'analysis-limitation', severity); pair(x, 'sufficient-at-read', 'insufficient-evidence'); }
});
test('T04 selected outgoing unknown always blocks even with finite disjoint proof', () => {
  const x = fixture(); x.coverage.origins[0].unsupported.push({ reason: 'dynamic-import', endpointProof: proof(['b.ts']) }); pair(x, 'sufficient-at-read', 'insufficient-evidence'); assert.equal(run(x, true).coverage.outgoing, 'unknown');
});
test('T05 every observed omitted file/byte budget leaves origin unknown', () => {
  for (const state of ['unscanned', 'too-large', 'budget-exceeded']) { const x = fixture(); x.graph.inventory.entries[1] = { path: 'b.ts', state, reason: 'budget' }; x.coverage.origins[1].hash = null; x.coverage.origins[1].read = { state }; unknown(x); pair(x, 'sufficient-at-read', 'insufficient-evidence'); }
});
test('T06 entry/depth/unreadable subtree is unknown without invented descendant count', () => {
  for (const reason of ['entry-limit', 'depth-limit', 'unreadable']) { const x = fixture(); x.coverage.enumeration = { complete: false, boundaries: [{ path: 'unknown/', reason }] }; pair(x, 'sufficient-at-read', 'insufficient-evidence'); assert.deepEqual(run(x, true).coverage.admittedDomain.enumeration, x.coverage.enumeration); }
});
test('T07 selected unavailable or identity-mismatched text rejects both', () => {
  for (const state of ['unreadable', 'too-large', 'binary', 'excluded', 'unscanned']) { const x = fixture(); x.graph.inventory.entries[0].state = state; x.coverage.origins[0].read.state = state; pair(x, 'rejected', 'rejected'); }
  const x = fixture(); x.selection.files[0].hash = R; pair(x, 'rejected', 'rejected');
});
test('T08 unread outside origin stays outside-selected-text-read', () => {
  const x = fixture(); x.graph.inventory.entries[1] = { path: 'b.ts', state: 'unreadable' }; x.coverage.origins[1].hash = null; x.coverage.origins[1].read.state = 'unreadable'; unknown(x); pair(x, 'sufficient-at-read', 'insufficient-evidence'); assert.ok(run(x).nonblockingReasons.some(r => r.code === 'outside-selected-text-read'));
});
test('T09 unsupported JS/Python/HTML/asset origin outside resolver scopeRoot remains required', () => {
  for (const path of ['outside/a.js', 'outside/a.py', 'outside/a.html', 'wordmark.webp']) { const x = fixture(); x.graph.inventory.entries[1].path = path; x.coverage.origins[1].path = path; unknown(x); pair(x, 'sufficient-at-read', 'insufficient-evidence'); }
});
test('T10 parse success and named declarations cannot replace completed reference traversal', () => {
  for (const state of ['withheld', 'not-observed']) { const x = fixture(); x.coverage.origins[0].analysis.referenceTraversal = state; pair(x, 'sufficient-at-read', 'insufficient-evidence'); }
});
test('T11 unresolved/ambiguous/bare/external labels and candidate lists never imply exhaustive disjointness', () => {
  for (const status of ['unresolved', 'ambiguous', 'unsupported', 'external', 'blocked']) { const x = fixture(); x.coverage.origins[1].references.push({ ...reference(status), candidates: [{ path: 'outside.ts', state: 'absent' }] }); pair(x, 'sufficient-at-read', 'insufficient-evidence'); }
});
function proof(possibleTargets) { return { kind: 'finite-local', complete: true, model: SCOPED_MODEL, sourceHash: H, runtimeId: H, possibleTargets }; }
test('T12 only explicit exhaustive current model-bound proof discharges outside uncertainty', () => {
  const x = fixture(); x.coverage.origins[1].references.push({ ...reference(), endpointProof: proof(['outside.ts']) }); pair(x, 'sufficient-at-read', 'sufficient-at-read'); assert.ok(run(x, true).nonblockingReasons.some(r => r.code === 'proven-disjoint'));
  for (const patch of [{ possibleTargets: ['a.ts'] }, { possibleTargets: ['../escape.ts'] }, { complete: false }, { model: 'invented' }, { sourceHash: R }, { runtimeId: R }]) { const y = structuredClone(x); Object.assign(y.coverage.origins[1].references[0].endpointProof, patch); pair(y, 'sufficient-at-read', 'insufficient-evidence'); }
});
test('T13 JSON non-origin requires positive read/parse, no selected/target/unknown control role', () => {
  const x = fixture(); x.coverage.origins[1].classification = 'json-non-origin'; x.coverage.origins[1].analysis.producer = 'strict-json-v1'; x.coverage.origins[1].jsonRole = 'none'; pair(x, 'sufficient-at-read', 'sufficient-at-read');
  for (const patch of [{ jsonRole: 'unknown-control' }, { analysis: { ...x.coverage.origins[1].analysis, parse: 'withheld' } }]) { const y = structuredClone(x); Object.assign(y.coverage.origins[1], patch); pair(y, 'sufficient-at-read', 'insufficient-evidence'); }
  const y = structuredClone(x); y.coverage.origins[0] = { ...y.coverage.origins[0], classification: 'json-non-origin', jsonRole: 'none', analysis: { ...y.coverage.origins[0].analysis, producer: 'strict-json-v1' } }; pair(y, 'sufficient-at-read', 'insufficient-evidence');
});
test('T14 oversized asset-looking entry has no extension waiver', () => { const x = fixture(); x.graph.inventory.entries[1] = { path: 'wordmark.pdf', state: 'too-large' }; x.coverage.origins[1] = { ...origin('wordmark.pdf'), hash: null, read: { state: 'too-large' } }; unknown(x); pair(x, 'sufficient-at-read', 'insufficient-evidence'); });
test('T15 stale root/binding/runtime/revision/snapshot rejects full negative envelopes', () => {
  for (const code of ['root-mismatch', 'binding-generation', 'runtime-pin', 'revision-mismatch', 'snapshot-mismatch']) { const x = fixture(); x.identity.verified = false; x.identity.errors = [{ code }]; pair(x, 'rejected', 'rejected'); assert.equal(run(x).freshness, 'not-verified'); }
});
test('T16 policy failure globally rejects unchanged selected bytes', () => { const x = fixture(); x.graph.inputPolicy.status = 'invalid'; pair(x, 'rejected', 'rejected'); });
test('T17 source drift has no verified-at-read freshness', () => { const x = fixture(); x.identity.errors = [{ code: 'unstable-scans' }]; pair(x, 'rejected', 'rejected'); assert.equal(run(x).freshness, 'not-verified'); });
test('T18 intentional excluded domain remains unknown outside and does not block complete admitted coverage', () => { pair(fixture(), 'sufficient-at-read', 'sufficient-at-read'); });
test('T19 unsupported contract/model never downgrades to text', () => {
  for (const [operation, model] of [['whole-app-impact@1', null], [SCOPED_OPERATIONS[1], 'guessed-model'], [SCOPED_OPERATIONS[0], SCOPED_MODEL]]) { const x = fixture(); const result = evaluateScoped({ ...x, operation, model }); assert.equal(result.decision, 'rejected'); assert.ok(result.blockingReasons.some(r => r.code === 'invalid-request')); assert.equal(result.claims.testResults, 'not-observed'); }
});
test('T20 unknown/missing/inconsistent producer/categories fail closed independent of text', () => {
  for (const category of ['unknown', 'invented', undefined]) { const x = fixture(); diagnostic(x, category); pair(x, 'rejected', 'rejected'); }
  for (const candidateProducer of [undefined, 'next-version', { ...producer, parser: 'other' }]) { const x = fixture(); x.coverage.origins[1].analysis.producer = candidateProducer; pair(x, 'rejected', 'rejected'); }
  const x = fixture(); diagnostic(x, 'analysis-limitation'); x.coverage.diagnostics[0].digest = R; pair(x, 'rejected', 'rejected');
});
test('T21 empty/area/ambiguous/duplicate selection and unavailable membership reject', () => {
  for (const selection of [{ ...fixture().selection, files: [] }, { ...fixture().selection, kind: 'area' }, { ...fixture().selection, kind: 'ambiguous' }, { ...fixture().selection, files: [fixture().selection.files[0], fixture().selection.files[0]] }]) { const x = fixture(); x.selection = selection; assert.equal(run(x).decision, 'rejected'); assert.equal(run(x, true).decision, 'rejected'); }
});
test('T22 decision uses full evidence and test imports do not imply execution/consumer-read completion', () => {
  const x = fixture(); const ref = { ...reference('resolved'), target: 'a.ts', candidates: [{ path: 'a.ts', hash: H, state: 'eligible' }] }; x.coverage.origins[1].references.push(ref); pair(x, 'sufficient-at-read', 'sufficient-at-read'); assert.ok(run(x, true).claims.nonclaims.includes('consumer-read-completion'));
});
test('T23 stale continuation identity rejects even with unchanged source', () => { const x = fixture(); x.identity.errors.push({ code: 'cross-selection-cursor' }); pair(x, 'rejected', 'rejected'); });
test('T24 internal work/evidence budgets fail closed; wire enforcement belongs to transport', () => {
  const x = fixture(); x.coverage.origins = Array.from({ length: SCOPED_LIMITS.origins + 1 }, () => origin('b.ts')); pair(x, 'rejected', 'rejected');
  const y = fixture(); y.coverage.padding = 'x'.repeat(SCOPED_LIMITS.evidenceBytes); pair(y, 'rejected', 'rejected'); assert.ok(run(y).blockingReasons.some(r => r.code === 'evidence-budget-exceeded'));
});
test('V01/V02 empty collector, missing origin record, unknown adapter, unsupported construct traps', () => {
  const x = fixture(); x.coverage.origins.pop(); pair(x, 'sufficient-at-read', 'insufficient-evidence');
  const y = fixture(); y.coverage.origins[1].unsupported.push({ reason: 'new-unrecognized-syntax' }); y.coverage.origins[1].analysis.status = 'unknown'; pair(y, 'sufficient-at-read', 'insufficient-evidence');
});
test('V06 requirements mismatch and absent verified identity reject without fabricated identity', () => {
  const x = fixture(); const result = evaluateScoped({ ...x, operation: SCOPED_OPERATIONS[0], model: null }); assert.equal(result.decision, 'rejected');
  const y = evaluateScoped({ graph: x.graph, selection: x.selection, coverage: x.coverage, operation: SCOPED_OPERATIONS[0] }); assert.equal(y.decision, 'rejected'); assert.equal(y.snapshot, null); assert.equal(y.binding, null); assert.equal(y.receipt, 'scoped-preview');
});
test('V12 unbound source preview is visibly distinct from an installed receipt', () => { const x = fixture(); x.identity.binding = null; const result = run(x); assert.equal(result.decision, 'sufficient-at-read'); assert.equal(result.receipt, 'scoped-preview'); assert.equal(result.mode, 'unbound-preview'); assert.equal(result.installedReceipt, false); });
test('canonical diagnostic digest is stable across object key order', () => { assert.equal(scopedDigest({ a: { x: 1, y: 2 }, z: [2, 1] }), scopedDigest({ z: [2, 1], a: { y: 2, x: 1 } })); assert.notEqual(scopedDigest([1, 2]), scopedDigest([2, 1])); });

test('producer bridge cap is a global mandatory budget rejection', () => { for (const reason of ['reference-observations', 'evidence-bytes']) { const x = fixture(); x.coverage.budget = { status: 'exceeded', reason }; pair(x, 'rejected', 'rejected'); } });

// Literal G0 ORACLE-v2 expectations frozen before candidate execution; transport
// T22/T24 are represented here only by their full-evidence/budget premises.
const frozenOracle = {
  "T01": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"satisfied"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]}],
  "T02": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T03": [{"decision":"sufficient-at-read","globalStatus":"current","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"current","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["reference-unknown"],"nonblockingReasons":[]}],
  "T04": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["reference-unknown"],"nonblockingReasons":[]}],
  "T05": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["outside-selected-text-read"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T06": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["outside-selected-text-read"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"unknown","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-universe-unknown"],"nonblockingReasons":[]}],
  "T07": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"failed","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["selected-source-unavailable"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"failed","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["selected-source-unavailable"],"nonblockingReasons":[]}],
  "T08": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["outside-selected-text-read"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T09": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T10": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T11": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["reference-unknown"],"nonblockingReasons":[]}],
  "T12": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"satisfied"},"blockingReasons":[],"nonblockingReasons":["proven-disjoint"]}],
  "T13": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["analysis-not-required"]},{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"satisfied"},"blockingReasons":[],"nonblockingReasons":["verified-non-origin"]}],
  "T14": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["outside-selected-text-read"]},{"decision":"insufficient-evidence","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"satisfied","incoming":"unknown"},"blockingReasons":["origin-coverage-unknown"],"nonblockingReasons":[]}],
  "T15": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]}],
  "T16": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["invalid-policy"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["invalid-policy"],"nonblockingReasons":[]}],
  "T17": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]}],
  "T18": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["domain-boundary"]},{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"satisfied"},"blockingReasons":[],"nonblockingReasons":["domain-boundary"]}],
  "T19": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["invalid-request"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["invalid-request"],"nonblockingReasons":[]}],
  "T20": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["unclassified-evidence"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["unclassified-evidence"],"nonblockingReasons":[]}],
  "T21": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"failed","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["invalid-selection"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"failed","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["invalid-selection"],"nonblockingReasons":[]}],
  "T22": [{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":[],"nonblockingReasons":["domain-boundary"]},{"decision":"sufficient-at-read","globalStatus":"partial","obligations":{"identity":"satisfied","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"satisfied","outgoing":"satisfied","incoming":"satisfied"},"blockingReasons":[],"nonblockingReasons":["domain-boundary"]}],
  "T23": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"failed","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["identity-mismatch"],"nonblockingReasons":[]}],
  "T24": [{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"unknown","selection":"satisfied","selectedText":"satisfied","originUniverse":"not-required","originCoverage":"not-required","outgoing":"not-required","incoming":"not-required"},"blockingReasons":["evidence-budget-exceeded"],"nonblockingReasons":[]},{"decision":"rejected","globalStatus":"partial","obligations":{"identity":"unknown","selection":"satisfied","selectedText":"satisfied","originUniverse":"satisfied","originCoverage":"unknown","outgoing":"unknown","incoming":"unknown"},"blockingReasons":["evidence-budget-exceeded"],"nonblockingReasons":[]}]
};

function oracleFixture(id) {
  const x = fixture(); x.graph.scope.excluded = [];
  const addUnknownReference = (index, value = reference()) => { value.evidence = { path: x.coverage.origins[index].path, hash: H }; x.coverage.origins[index].references.push(value); };
  switch (id) {
    case 'T01': diagnostic(x, 'analysis-limitation'); break;
    case 'T02': x.coverage.origins[1].analysis.parse = 'withheld'; x.coverage.origins[1].analysis.status = 'unknown'; diagnostic(x, 'analysis-limitation'); break;
    case 'T03': x.graph.status = 'current'; x.coverage.origins[1].unsupported.push({ reason: 'dynamic-import' }); diagnostic(x, 'analysis-limitation'); break;
    case 'T04': x.coverage.origins[0].unsupported.push({ reason: 'dynamic-import' }); break;
    case 'T05': case 'T07': case 'T08': case 'T14': {
      const index = id === 'T07' ? 0 : 1, state = id === 'T05' ? 'unscanned' : id === 'T14' ? 'too-large' : 'unreadable';
      x.graph.inventory.entries[index] = { path: index ? 'b.ts' : 'a.ts', state };
      x.coverage.origins[index].read.state = state; x.coverage.origins[index].hash = null; unknown(x, index); break;
    }
    case 'T06': x.coverage.enumeration = { complete: false, boundaries: [{ path: 'hidden-descendants/', reason: 'entry-limit' }] }; break;
    case 'T09': unknown(x); break;
    case 'T10': unknown(x, 0); break;
    case 'T11': addUnknownReference(0); break;
    case 'T12': addUnknownReference(1, { ...reference(), endpointProof: proof(['outside.ts']) }); break;
    case 'T13': x.coverage.origins[1].classification = 'json-non-origin'; x.coverage.origins[1].analysis.producer = 'strict-json-v1'; x.coverage.origins[1].jsonRole = 'none'; break;
    case 'T15': case 'T17': case 'T23': x.identity.verified = false; x.identity.errors.push({ code: 'identity-mismatch' }); break;
    case 'T16': x.graph.inputPolicy.status = 'invalid'; break;
    case 'T18': case 'T22': x.graph.scope.excluded = ['excluded/']; break;
    case 'T19': break;
    case 'T20': diagnostic(x, 'unknown'); break;
    case 'T21': x.selection.kind = 'area'; break;
    case 'T24': x.coverage.budget = { status: 'exceeded', reason: 'evidence-bytes' }; break;
  }
  return x;
}
for (const [id, expectations] of Object.entries(frozenOracle)) test(`${id} literal full obligation/reason oracle for both operations`, () => {
  for (let index = 0; index < 2; index++) {
    const input = oracleFixture(id), operation = SCOPED_OPERATIONS[index], model = index ? SCOPED_MODEL : null;
    const receipt = id === 'T19' ? evaluateScoped({ ...input, operation, model: 'unsupported-model', identity: { ...input.identity, requirementsDigest: S } }) : run(input, index === 1);
    const expected = expectations[index];
    assert.equal(receipt.decision, expected.decision); assert.equal(receipt.globalStatus, expected.globalStatus);
    assert.deepEqual(receipt.coverage.obligations, expected.obligations);
    const codes = reasons => [...new Set(reasons.map(reason => reason.code))].sort();
    assert.deepEqual(codes(receipt.blockingReasons), [...expected.blockingReasons].sort());
    assert.deepEqual(codes(receipt.nonblockingReasons), [...expected.nonblockingReasons].sort());
    assert.equal(receipt.claims.testResults, 'not-observed'); assert.equal(receipt.claims.applies, expected.decision === 'sufficient-at-read');
    assert.equal(receipt.selection.files[0].hash, H); assert.equal(receipt.coverage.admittedDomain.outsideDomain, 'unknown');
    assert.equal(receipt.diagnostics.count, input.graph.diagnostics.length); assert.deepEqual(receipt.diagnostics.records, input.graph.diagnostics);
  }
});

test('V02 actual graph reference syntax/outcome coverage cannot be silently omitted from ledger', () => {
  for (const mode of ['missing-outcome', 'withheld-resolution', 'missing-unsupported']) {
    const x = fixture();
    if (mode === 'missing-outcome') x.graph.nodes[1].referenceSyntax.facts = [reference()];
    if (mode === 'withheld-resolution') x.graph.nodes[1].referenceResolution.extraction = 'withheld';
    if (mode === 'missing-unsupported') x.graph.nodes[1].referenceSyntax.unsupported.push({ reason: 'dynamic-import', range: { start: 1, end: 4 } });
    pair(x, 'sufficient-at-read', 'insufficient-evidence');
  }
});
