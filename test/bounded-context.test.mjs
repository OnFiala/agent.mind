import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { indexProject } from '../code-index.mjs';
import { projectContext, freshContext, contextCursor } from '../graph-context.mjs';
import { chainInputs, fixtureIdentity, writeChainFixture, FIXTURE_SELECTOR } from '../scripts/bounded-context-fixture-v1.mjs';

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const agent = (graph, selector = 'main.mjs', options = {}) => projectContext(graph, selector, { profile: 'agent', version: 1, ...options });
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sorted = values => values.map(canonical).sort();
function fixture(t, contents) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-bounded-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries(contents)) { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text); }
  return root;
}
function traverse(graph, selector, initial, section, maxBytes = 7000) {
  const results = new Map(), fragments = new Map();
  let cursor = contextCursor(initial, section), pageCount = 0, suffixPages = 0;
  do {
    assert.ok(++pageCount < 2000, 'Continuation must progress.');
    const response = agent(graph, selector, { cursor, maxBytes });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    assert.ok(bytes(response) <= maxBytes);
    assert.equal(typeof JSON.parse(JSON.stringify(response)), 'object');
    assert.equal(response.snapshot, initial.snapshot);
    assert.deepEqual(response.uncertainty, initial.uncertainty);
    for (const { index, value } of response.page.items) { assert.ok(!results.has(index)); results.set(index, value); }
    for (const fragment of response.page.fragments) {
      assert.equal(fragment.encoding, 'json-text');
      assert.ok(!/[\uD800-\uDBFF]$/u.test(fragment.text));
      const previous = fragments.get(fragment.index) ?? '';
      assert.equal(fragment.offset, previous.length);
      const joined = previous + fragment.text;
      fragments.set(fragment.index, joined);
      if (joined.length === fragment.total) { assert.ok(!results.has(fragment.index)); results.set(fragment.index, JSON.parse(joined)); }
    }
    const complete = response.page.items.length;
    for (const fragment of response.page.fragments) if (fragment.offset > 0 && fragment.offset + fragment.text.length === fragment.total) suffixPages++;
    if (section === 'context') for (const kind of response.sections.find(item => item.kind === section).kinds) assert.equal(kind.omitted, kind.total - response.page.items.filter(item => item.value.kind === kind.kind).length);
    assert.equal(response.sections.find(item => item.kind === section).omitted, response.sections.find(item => item.kind === section).total - complete);
    cursor = response.page.next;
  } while (cursor);
  assert.equal(results.size, initial.sections.find(item => item.kind === section).total);
  return { values: [...results].sort(([a], [b]) => a - b).map(([, value]) => value), pageCount, fragments, suffixPages };
}

test('legacy default matches the independently captured pre-R02 compact serialization oracle', t => {
  const root = fixture(t, { 'main.mjs': 'import "./other.mjs";\nexport function run() { return helper(); }\nfunction helper() { return 1; }\n', 'other.mjs': 'export const other = 2;\n' });
  const graph = indexProject(root, { generic: true });
  graph.project = { name: 'fixture', root: '/fixture' };
  graph.generatedAt = '2026-01-01T00:00:00.000Z';
  const full = projectContext(graph, 'main.mjs');
  // Measured on the clean e20f43e base before changing graph-context.mjs.
  assert.equal(bytes(full), 11735);
  assert.equal(createHash('sha256').update(JSON.stringify(full)).digest('hex'), 'fa0cff4212650484a2e038cef779ad76f13626d9cdd10e94d9deddd6396e5e96');
  assert.deepEqual(projectContext(graph, 'main.mjs', {}), full);
  assert.equal(full.profile, undefined);
});

test('versioned 1000-file chain input identity is reproducible and initial output stays within 10000 UTF-8 bytes', t => {
  const root = fixture(t, {});
  assert.deepEqual(writeChainFixture(root), { version: 1, selector: FIXTURE_SELECTOR, files: 1000, functionsPerFile: 5, sha256: 'ba667fedf7c55041a1b99e3957ed6838e8703ce14cbb5317f97740c17bb494ae' });
  assert.equal(fixtureIdentity().sha256, 'ba667fedf7c55041a1b99e3957ed6838e8703ce14cbb5317f97740c17bb494ae');
  assert.equal(chainInputs().length, 1000);
  assert.ok(chainInputs()[0].text.startsWith("import './m1.mjs';\n"));
  assert.ok(!chainInputs().at(-1).text.includes('import'));
  assert.ok(chainInputs().every(item => item.text.match(/export function /g).length === 5));
  const graph = indexProject(root, { generic: true });
  const response = agent(graph, FIXTURE_SELECTOR);
  assert.equal(response.error, undefined);
  assert.ok(bytes(response) <= 10000);
  assert.equal(response.coverage.inventoryEntries, 1000);
  assert.equal(response.coverage.selectedSources, 1);
  assert.equal(response.status, 'current');
  assert.equal(response.selection.id, 'file:src/m10.mjs');
  assert.equal(response.revision, graph.revision);
  const source = response.page.items.find(item => item.value.kind === 'sourceCoverage').value.value;
  assert.equal(source.hash, graph.nodes.find(node => node.path === FIXTURE_SELECTOR).hash);
  assert.deepEqual(source.capabilities, graph.nodes.find(node => node.path === FIXTURE_SELECTOR).capabilities);
  assert.equal(response.vocabulary, undefined);
  assert.equal(response.inventory, undefined);
  assert.equal(response.canvas, undefined);
  assert.equal(response.sections.find(item => item.kind === 'vocabulary').omitted, 6001);
  assert.deepEqual(agent(graph, `file:${FIXTURE_SELECTOR}`), response);
});

test('high fan-in, Unicode, duplicate evidence and global collections remain losslessly retrievable', t => {
  const files = { 'main.mjs': 'export function téměř() { return 1; }\nconst path = "computed"; import(path);\n', 'outside.ts': 'export const typed: number = 1;\n', 'notes.md': '# Příliš 🧭 žluťoučký\n', 'outside.mjs': 'export function unresolved(value) { return value.member(); }\n' };
  for (let i = 0; i < 48; i++) files[`in${i}.mjs`] = `import './main.mjs'; // 🧭 ${i}\n`;
  const root = fixture(t, files), graph = indexProject(root, { generic: true });
  graph.binding = { id: 'binding-one', generation: 2, root, dev: 1, ino: 123, state: 'attached', installId: 'install-one', version: '1.3.1', digest: 'artifact-one' };
  // Synthetic stress on a real source-derived edge: duplicate nested evidence
  // and one oversized Unicode snippet must survive exactly, without deduping.
  const edge = graph.edges.find(item => item.to === 'file:main.mjs');
  const evidence = { ...edge.evidence[0], snippet: '🧭é漢字'.repeat(1800) };
  edge.evidence.push(evidence, structuredClone(evidence));
  const full = projectContext(graph, 'main.mjs'), initial = agent(graph);
  assert.equal(initial.status, 'partial');
  assert.deepEqual(initial.binding, graph.binding);
  assert.ok(initial.uncertainty.global.diagnostics > initial.uncertainty.local.diagnostics);
  assert.ok(initial.uncertainty.local.diagnostics > 0);
  assert.ok(initial.uncertainty.global.symbolDiagnostics > initial.uncertainty.local.symbolDiagnostics);
  assert.equal(initial.page.items[0].value.kind, 'sourceCoverage');
  assert.equal(initial.page.items[0].value.value.hash, graph.nodes.find(node => node.path === 'main.mjs').hash);
  assert.ok(initial.sections.find(item => item.kind === 'context').kinds.find(item => item.kind === 'edge').omitted > 0);
  assert.deepEqual(initial.uncertainty.limitations, full.scope.limitations);
  assert.equal(initial.coverage.testResults, 'not-observed');
  const expected = {
    diagnostics: full.diagnostics, symbolDiagnostics: full.symbolGraph.diagnostics, globalSymbolDiagnostics: graph.symbolGraph.diagnostics,
    selectionDetails: [full.selection], vocabulary: full.vocabulary, inventory: full.inventory.entries,
    canvas: [full.canvas], partCanvas: [full.partCanvas], overview: [full.overview], scope: [full.scope]
  };
  let fragmentPages = 0;
  for (const [section, values] of Object.entries(expected)) {
    const traversal = traverse(graph, 'main.mjs', initial, section, 7000);
    assert.deepEqual(sorted(traversal.values), sorted(values), section);
    fragmentPages += traversal.fragments.size;
  }
  const context = traverse(graph, 'main.mjs', initial, 'context', 7000);
  const ofKind = kind => context.values.filter(item => item.kind === kind).map(item => item.value);
  assert.deepEqual(sorted(ofKind('node')), sorted(full.nodes));
  assert.deepEqual(sorted(ofKind('edge')), sorted(full.edges));
  assert.deepEqual(sorted(ofKind('symbol')), sorted(full.symbolGraph.nodes));
  assert.deepEqual(sorted(ofKind('symbolEdge')), sorted(full.symbolGraph.edges));
  assert.deepEqual(sorted(ofKind('localDiagnostic')), sorted(full.diagnostics.filter(item => item.path === 'main.mjs')));
  assert.deepEqual(ofKind('edge').find(item => item.id === edge.id).evidence, edge.evidence);
  assert.ok(context.pageCount > 1);
  assert.ok(context.fragments.size > 0 && fragmentPages > 0);
  assert.ok(context.suffixPages > 0, 'A final suffix still counts as omitted in that response.');
  const oversizedIndex = context.values.findIndex(item => item.kind === 'edge' && item.value.id === edge.id);
  const oversizedText = canonical(context.values[oversizedIndex]);
  const splitSurrogate = oversizedText.indexOf('🧭') + 1;
  const malformed = { ...JSON.parse(Buffer.from(contextCursor(initial, 'context'), 'base64url').toString('utf8')), offset: oversizedIndex, fragment: splitSurrogate };
  assert.throws(() => agent(graph, 'main.mjs', { cursor: Buffer.from(JSON.stringify(malformed)).toString('base64url') }), { code: 'INVALID_CONTEXT_CURSOR' });
  const reversed = structuredClone(graph);
  reversed.nodes.reverse(); reversed.edges.reverse(); reversed.diagnostics.reverse(); reversed.symbolGraph.nodes.reverse(); reversed.symbolGraph.edges.reverse();
  assert.deepEqual(agent(reversed), initial);
});

test('cursors bind project, revision, canonical selection, binding and section with no hidden state', t => {
  const root = fixture(t, { 'main.mjs': 'export function one() {}\n', 'other.mjs': 'export function two() {}\n' });
  const graph = indexProject(root, { generic: true });
  graph.binding = { id: 'binding', generation: 1, root };
  const initial = agent(graph), cursor = contextCursor(initial, 'vocabulary');
  const page = agent(structuredClone(graph), 'file:main.mjs', { cursor });
  assert.equal(page.page.section, 'vocabulary');
  for (const mutation of [g => { g.revision += 'changed'; }, g => { g.project.root += '-other'; }, g => { g.binding.generation++; }, g => { g.binding.id += '-new'; }, g => { delete g.binding; }, g => { g.scope.limitations.push('Changed projection uncertainty.'); }, g => { g.runtime = { current: false }; }]) {
    const changed = structuredClone(graph); mutation(changed);
    assert.throws(() => agent(changed, 'main.mjs', { cursor }), { code: 'STALE_CONTEXT_CURSOR' });
  }
  assert.throws(() => agent(graph, 'other.mjs', { cursor }), { code: 'STALE_CONTEXT_CURSOR' });
  assert.throws(() => agent(graph, 'missing.mjs', { cursor }), /not in the active index/);
  assert.throws(() => agent(graph, 'main.mjs', { cursor, section: 'inventory' }), { code: 'INVALID_CONTEXT_CURSOR' });
  for (const bad of ['', '%%%garbage', 'e30', 1, null, 'x'.repeat(5000)]) assert.throws(() => agent(graph, 'main.mjs', { cursor: bad }), { code: 'INVALID_CONTEXT_CURSOR' });
  const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  for (const delta of [{ offset: -1 }, { offset: 1.5 }, { offset: 999999 }, { fragment: 999999 }, { section: '__proto__' }, { extra: true }, { version: 2 }]) {
    const bad = Buffer.from(JSON.stringify({ ...decoded, ...delta })).toString('base64url');
    assert.throws(() => agent(graph, 'main.mjs', { cursor: bad }), { code: 'INVALID_CONTEXT_CURSOR' });
  }
  assert.throws(() => contextCursor(initial, 'unknown'), { code: 'INVALID_CONTEXT_CURSOR' });
});

test('small budgets return an explicit bounded error and freshContext keeps index options separate', t => {
  const root = fixture(t, { 'main.mjs': 'const target="computed"; import(target);\nexport function run() {}\n' });
  const graph = indexProject(root, { generic: true }), full = projectContext(graph, 'main.mjs');
  const response = agent(graph, 'main.mjs', { maxBytes: 256 });
  assert.equal(response.error.code, 'CONTEXT_BUDGET_TOO_SMALL');
  assert.ok(response.error.requiredBytes > 256);
  assert.ok(bytes(response) <= 256);
  assert.equal(response.status, undefined);
  for (const maxBytes of [1, 255, -1, NaN, 4000.1, '10000', Infinity]) assert.throws(() => agent(graph, 'main.mjs', { maxBytes }), { code: 'INVALID_CONTEXT_BUDGET' });
  assert.throws(() => agent(graph, 'main.mjs', { version: 2 }), /Unsupported/);
  assert.throws(() => projectContext(graph, 'main.mjs', { profile: 'unknown' }), /Unknown/);
  const fresh = freshContext(root, 'main.mjs', { generic: true, expectedRevision: graph.revision }, { profile: 'agent', maxBytes: 10000 });
  assert.equal(fresh.status, full.status);
  assert.equal(fresh.uncertainty.global.diagnostics, full.diagnostics.length);
  assert.equal(freshContext(root, 'main.mjs', { generic: true }).profile, undefined);
  fs.appendFileSync(path.join(root, 'main.mjs'), '// changed\n');
  assert.throws(() => freshContext(root, 'main.mjs', { generic: true, expectedRevision: graph.revision }, { profile: 'agent' }), { code: 'STALE_REVISION' });
  assert.throws(() => freshContext(root, 'main.mjs', { generic: true }, { profile: 'agent', cursor: contextCursor(fresh, 'context') }), { code: 'STALE_CONTEXT_CURSOR' });
});


test('response and fragment boundary budgets either make progress within the exact wire size or return bounded errors', t => {
  const root = fixture(t, { 'main.mjs': 'export function run() {}\n', 'other.mjs': 'import "./main.mjs";\n' });
  const graph = indexProject(root, { generic: true });
  graph.edges[0].evidence[0].snippet = '🧭漢\\"'.repeat(2000);
  for (const maxBytes of [256, 4200, 4500, 4700, 4800, 4900, 5000, 5100, 5500, 6000, 7000, 10000]) {
    let response = agent(graph, 'main.mjs', { maxBytes });
    for (let step = 0; step < 4; step++) {
      assert.ok(bytes(response) <= maxBytes, `${maxBytes} byte budget`);
      if (response.error) { assert.equal(response.error.code, 'CONTEXT_BUDGET_TOO_SMALL'); assert.ok(response.error.requiredBytes > maxBytes); break; }
      assert.ok(response.page.items.length || response.page.fragments.some(item => item.text.length > 0) || response.page.next === null);
      assert.deepEqual(response.uncertainty.limitations, graph.scope.limitations);
      if (!response.page.next) break;
      response = agent(graph, 'main.mjs', { maxBytes, cursor: response.page.next });
    }
  }
});
