import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject, getScopedCoverage } from '../code-index.mjs';
import { attachOverview, buildOverview, buildHierarchy } from '../project-map.mjs';
import { scopedResponse, scopedObservation } from '../scoped-context.mjs';
import { evaluateScoped } from '../scoped-preflight.mjs';

const resolver = { generic: true, resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
const textOperation = 'inspect-selected-source@1', boundaryOperation = 'review-direct-file-boundary@1';
const block = (id, files) => ({ id, label: id === 'unrelated' ? 'Unrelated' : id, aliases: [], type: 'module', group: 'core', description: 'Unrelated naming entry', files, prefixes: [] });
const part = (target, label = 'Unrelated') => ({ target, label, aliases: [], description: 'Unrelated part name' });
const cases = [
  ['missing block member', { schemaVersion: 1, blocks: [block('unrelated', ['missing.ts'])] }, 'The name Unrelated refers to a missing file: missing.ts.'],
  ['unrelated overlapping blocks', { schemaVersion: 1, blocks: [block('first', ['helper.ts']), block('second', ['helper.ts'])] }, 'File helper.ts belongs to multiple blocks; using a neutral path group.'],
  ['missing named part', { schemaVersion: 1, blocks: [], parts: [part('file:missing.ts')] }, 'The named part file:missing.ts is missing from the current sources.']
];
function fixture(t, map, mapPath = 'project-map.json') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-r15-naming-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries({
    'main.ts': 'export const value = 1;', 'helper.ts': 'export const helper = 2;',
    'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}',
    [mapPath]: JSON.stringify(map)
  })) fs.writeFileSync(path.join(root, relative), source);
  return { root, options: { ...resolver, ...(mapPath === 'project-map.json' ? {} : { metadataPath: mapPath }) } };
}
function observation(root, options, operation = textOperation, selector = 'file:main.ts') {
  const request = { schemaVersion: 1, operation, ...(operation === boundaryOperation ? { model: 'typed-static-local-v1@1' } : {}), selector };
  const bootstrap = scopedResponse(root, request, { stage: 'bootstrap', indexOptions: options });
  assert(!bootstrap.error, JSON.stringify(bootstrap));
  return scopedObservation(root, { ...request, revision: bootstrap.revision, snapshot: bootstrap.snapshot }, { stage: 'prepare', indexOptions: options });
}
function reevaluate(observed, coverage = getScopedCoverage(observed.graph)) {
  return evaluateScoped({ graph: observed.graph, coverage, selection: observed.selection, operation: observed.decision.operation, model: observed.decision.model, identity: observed.identity });
}
function normalized(graph) { const value = structuredClone(graph); delete value.generatedAt; delete value.stats.parseMs; delete value.stats.cachedFiles; return value; }

for (const [name, map, message] of cases) for (const mapPath of ['project-map.json', 'names.json']) test(`R15-DIAG-01 ${name} at ${mapPath} keeps exact-file text and typed boundary sufficient`, t => {
  const { root, options } = fixture(t, map, mapPath);
  for (const operation of [textOperation, boundaryOperation]) {
    const observed = observation(root, options, operation);
    assert.equal(observed.graph.metadata.status, 'current');
    assert.equal(observed.graph.status, 'partial');
    assert.equal(observed.decision.decision, 'sufficient-at-read', JSON.stringify(observed.decision.blockingReasons));
    const index = observed.graph.diagnostics.findIndex(item => item.message === message);
    assert(index >= 0, message);
    assert.equal(observed.graph.diagnostics[index].path, mapPath);
    assert.equal(observed.coverage.diagnostics[index].category, 'naming-limitation');
    assert.equal(observed.coverage.diagnostics.some(item => item.category === 'unknown'), false);
    // Provenance is internal; the graph and diagnostic wire fields stay legacy.
    const diagnostic = observed.graph.diagnostics[index];
    assert.equal(JSON.stringify(diagnostic), JSON.stringify({ path: mapPath, message, severity: 'warning' }));
  }
  const plain = attachOverview(indexProject(root, options));
  const scoped = attachOverview(indexProject(root, { ...options, scopedEvidence: true }));
  assert.deepEqual(normalized(scoped), normalized(plain));
  assert.equal(scoped.revision, plain.revision);
});

test('R15-DIAG-01 unknown, copied, changed or missing diagnostic provenance still rejects both operations', t => {
  const { root, options } = fixture(t, cases[0][1]);
  for (const operation of [textOperation, boundaryOperation]) for (const change of ['injected', 'copied', 'changed', 'missing']) {
    const observed = observation(root, options, operation);
    const index = observed.graph.diagnostics.findIndex(item => item.message === cases[0][2]);
    let coverage;
    if (change === 'injected') observed.graph.diagnostics.push({ path: 'project-map.json', message: 'Unrecognized naming observation', severity: 'info' });
    if (change === 'copied') observed.graph.diagnostics.push(structuredClone(observed.graph.diagnostics[index]));
    if (change === 'changed') observed.graph.diagnostics[index].message += ' changed';
    coverage = getScopedCoverage(observed.graph);
    if (change === 'missing') coverage.diagnostics.splice(index, 1);
    else assert.equal(coverage.diagnostics[change === 'changed' ? index : coverage.diagnostics.length - 1].category, 'unknown');
    const receipt = reevaluate(observed, coverage);
    assert.equal(receipt.decision, 'rejected', `${operation} ${change}`);
    assert(receipt.blockingReasons.some(item => item.code === 'unclassified-evidence'));
  }
});

test('R15-DIAG-01 malformed/duplicate part producers remain known without granting ambiguous selection', t => {
  const map = { schemaVersion: 1, blocks: [], parts: [part('file:main.ts', 'Shared'), part('file:helper.ts', 'Shared')] };
  const { root, options } = fixture(t, map);
  for (const operation of [textOperation, boundaryOperation]) {
    assert.equal(observation(root, options, operation).decision.decision, 'sufficient-at-read');
    for (const selector of ['Shared', 'file:missing.ts']) {
      const observed = observation(root, options, operation, selector);
      assert.equal(observed.decision.decision, 'rejected');
      assert(observed.decision.blockingReasons.some(item => item.code === 'invalid-selection'));
    }
  }
  fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify({ schemaVersion: 1, blocks: [], parts: [part('file:helper.ts'), part('file:helper.ts')] }));
  const graph = attachOverview(indexProject(root, { ...options, scopedEvidence: true }));
  const coverage = getScopedCoverage(graph);
  const indexes = graph.diagnostics.flatMap((item, index) => item.code === 'INVALID_NAMING_PARTS' ? [index] : []);
  assert(indexes.length > 0);
  assert(indexes.every(index => coverage.diagnostics[index].category === 'naming-limitation'));
});

test('R15-DIAG-01 structured hierarchy ambiguity/conflict diagnostic objects retain producer provenance', t => {
  const { root, options } = fixture(t, { schemaVersion: 1, blocks: [] });
  for (const mode of ['ambiguous', 'conflicting']) {
    const graph = indexProject(root, { ...options, scopedEvidence: true });
    graph.overview = buildOverview(graph);
    const first = graph.nodes.find(item => item.path === 'main.ts'), second = graph.nodes.find(item => item.path === 'helper.ts');
    first.legacyId = 'legacy-source';
    if (mode === 'ambiguous') second.legacyId = 'legacy-source';
    const config = { schemaVersion: 1, blocks: [], parts: mode === 'ambiguous' ? [part('legacy-source')] : [part(first.id), part('legacy-source', 'Other')] };
    const hierarchy = buildHierarchy(graph, config);
    const diagnostic = hierarchy.diagnostics.find(item => item.code === (mode === 'ambiguous' ? 'AMBIGUOUS_NAMING_TARGET' : 'CONFLICTING_NAMING_TARGET'));
    assert(diagnostic, mode);
    graph.diagnostics.push(diagnostic);
    assert.equal(getScopedCoverage(graph).diagnostics.at(-1).category, 'naming-limitation');
    diagnostic.severity = 'info';
    assert.equal(getScopedCoverage(graph).diagnostics.at(-1).category, 'unknown');
  }
});

test('R15-DIAG-01 attachOverview never retroactively trusts injected naming-shaped records', t => {
  const { root, options } = fixture(t, { schemaVersion: 1, blocks: [] }, 'names.json');
  const graph = indexProject(root, { ...options, scopedEvidence: true });
  const injected = { path: 'other.json', code: 'INVALID_NAMING_PARTS', severity: 'warning', message: 'Invalid or duplicate part name.' };
  graph.diagnostics.push(injected);
  attachOverview(graph);
  const coverage = getScopedCoverage(graph);
  assert.equal(coverage.diagnostics[graph.diagnostics.indexOf(injected)].category, 'unknown');
  const copied = graph.hierarchy.diagnostics.find(item => item.code === 'INVALID_NAMING_PARTS');
  assert(copied); assert.equal(copied.path, 'names.json');
  graph.diagnostics.push(copied);
  assert.equal(getScopedCoverage(graph).diagnostics.at(-1).category, 'unknown');
});
