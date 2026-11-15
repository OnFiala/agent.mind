import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INDEX_LIMITS, indexProject } from '../code-index.mjs';

function fixture(t, contents = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-priority-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(contents)) write(root, name, bytes);
  return root;
}
function write(root, name, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), bytes);
}
function addJSON(root, count) {
  for (let i = 0; i < count; i++) write(root, `assets/${String(i).padStart(4, '0')}.json`, '{}');
}
const file = (graph, name) => graph.nodes.find(node => node.id === `file:${name}`);
const scopeEntry = (graph, name, state, reason) => graph.inventory.entries.find(item => item.path === name && item.state === state && (reason === undefined || item.reason === reason));
function stable(graph) {
  const { generatedAt, stats, ...value } = graph;
  return value;
}

test('source survives 1005 earlier JSON files with imports, symbols and identical cold/warm content', t => {
  const root = fixture(t, {
    'src/main.mjs': "import { answer } from './value.js';\nexport function readAnswer() { return answer; }\nthrow new Error('SOURCE_MUST_NOT_EXECUTE');\n",
    'src/value.js': 'export function answer() { return 42; }\n',
    'src/python.py': 'def python_answer():\n    return 42\n',
  });
  addJSON(root, 1005);
  const opened = [];
  const original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(String(name)); return original(name, ...args); });
  const cold = indexProject(root);
  assert.ok(file(cold, 'src/main.mjs'), 'later source must survive earlier JSON candidates');
  assert.ok(file(cold, 'src/main.mjs').symbols.some(item => item.name === 'readAnswer'));
  assert.ok(file(cold, 'src/python.py').symbols.some(item => item.name === 'python_answer'));
  assert.ok(cold.edges.some(item => item.kind === 'import' && item.from === 'file:src/main.mjs' && item.to === 'file:src/value.js'));
  assert.equal(cold.stats.files, INDEX_LIMITS.files);
  assert.equal(cold.inventory.status, 'partial');
  assert.equal(cold.status, 'partial');
  const omitted = cold.inventory.entries.filter(item => item.state === 'unscanned' && item.reason === 'file-limit');
  assert.equal(omitted.length, 8);
  assert.ok(omitted.every(item => item.path.startsWith('assets/') && !Object.hasOwn(item, 'bytes') && !Object.hasOwn(item, 'hash')));
  for (const item of omitted) assert.ok(!opened.includes(path.join(root, item.path)), item.path);
  const warm = indexProject(root, { previous: cold });
  assert.equal(warm.stats.cachedFiles, INDEX_LIMITS.files);
  assert.equal(cold.stats.cachedFiles, 0);
  assert.deepEqual(stable(warm), stable(cold));
});

test('the same source priority controls the unchanged total byte budget and per-file bound', t => {
  const root = fixture(t, {
    'src/late.mjs': 'export function retained() { return true; }\n',
    'src/oversized.js': ' '.repeat(INDEX_LIMITS.fileBytes + 1),
  });
  const json = '"' + 'x'.repeat(INDEX_LIMITS.fileBytes - 2) + '"';
  for (let i = 0; i < 33; i++) write(root, `assets/${String(i).padStart(2, '0')}.json`, json);
  const graph = indexProject(root);
  assert.ok(file(graph, 'src/late.mjs'), 'source must be read before assets exhaust 16 MiB');
  assert.ok(scopeEntry(graph, 'src/oversized.js', 'too-large'));
  assert.ok(scopeEntry(graph, 'assets/31.json', 'budget-exceeded'));
  assert.equal(graph.inventory.status, 'partial');
  const readBytes = graph.inventory.entries.filter(item => ['text', 'binary'].includes(item.state)).reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(readBytes <= INDEX_LIMITS.totalBytes);
  assert.equal(INDEX_LIMITS.totalBytes, 16 * 1024 * 1024);
  assert.equal(INDEX_LIMITS.fileBytes, 512 * 1024);
});

test('source ties use full-path case-sensitive UTF16 order independently of creation and locale', t => {
  const root = fixture(t);
  // The remaining candidates straddle ordering differences between ordinal and locale comparison.
  const candidates = ['src/a.js', 'src/Zed.js', 'src/é.js', 'src/_x.js', 'src/ä.js', 'src/zoo.js', 'src/Ω.js', 'src/B.js'];
  for (const name of candidates) write(root, name, 'export const chosen = true;');
  for (let i = 0; i < 996; i++) write(root, `fill/${String(i).padStart(4, '0')}.js`, 'export const filler = 1;');
  const graph = indexProject(root);
  const expected = [...candidates].sort().slice(0, 4);
  assert.deepEqual(graph.nodes.filter(item => item.path?.startsWith('src/')).map(item => item.path).sort(), expected);
  for (const name of [...candidates].sort().slice(4)) assert.ok(scopeEntry(graph, name, 'unscanned', 'file-limit'), name);
  assert.equal(graph.stats.files, 1000);
  assert.equal(graph.status, 'partial');
});

test('typed and unsupported source suffixes gain priority without gaining unsupported semantics', t => {
  const root = fixture(t, {
    'src/pilot.ts': 'export function typed(value: number): number { return value; }',
    'src/unknown.go': 'package main\nfunc hidden() {}\n',
    'src/common.cjs': "module.exports = require('./missing.js'); throw new Error('MUST_NOT_EXECUTE');",
    'src/shapes.pyi': 'def declaration() -> int: ...\n',
  });
  addJSON(root, 1005);
  const graph = indexProject(root);
  assert.ok(file(graph, 'src/pilot.ts')?.symbols.some(item => item.name === 'typed'));
  for (const name of ['src/unknown.go', 'src/common.cjs', 'src/shapes.pyi']) {
    const node = file(graph, name);
    assert.ok(node, name);
    assert.deepEqual(node.capabilities, ['text']);
    assert.deepEqual(node.symbols, []);
    assert.ok(!graph.edges.some(item => item.from === node.id));
    assert.ok(graph.scope.unsupported.includes(name));
  }
  assert.equal(graph.status, 'partial');
});

test('exactly 1000 eligible files stay complete; the next file is observable but unscanned', t => {
  const root = fixture(t);
  addJSON(root, 999);
  write(root, 'src/main.js', 'export const main = true;');
  fs.mkdirSync(path.join(root, 'empty'));
  write(root, 'dist/excluded.js', 'DO_NOT_READ');
  const exact = indexProject(root);
  assert.equal(exact.stats.files, 1000);
  assert.equal(exact.inventory.status, 'complete');
  assert.equal(exact.status, 'current');
  assert.ok(!exact.inventory.entries.some(item => item.reason === 'file-limit'));
  write(root, 'assets/0999.json', '{}');
  const over = indexProject(root);
  assert.equal(over.stats.files, 1000);
  assert.equal(over.inventory.status, 'partial');
  assert.equal(over.status, 'partial');
  assert.ok(file(over, 'src/main.js'));
  assert.ok(scopeEntry(over, 'assets/0999.json', 'unscanned', 'file-limit'));
});

test('refresh admits new source, evicts the last asset, reuses cache and restores the prior revision', t => {
  const root = fixture(t);
  addJSON(root, 1000);
  const initial = indexProject(root);
  assert.equal(initial.status, 'current');
  assert.ok(file(initial, 'assets/0999.json'));
  write(root, 'src/added.js', 'export function added() { return 1; }');
  const admitted = indexProject(root, { previous: initial });
  assert.ok(file(admitted, 'src/added.js'));
  assert.equal(admitted.status, 'partial');
  assert.equal(admitted.stats.cachedFiles, 999);
  assert.ok(!file(admitted, 'assets/0999.json'));
  assert.ok(scopeEntry(admitted, 'assets/0999.json', 'unscanned', 'file-limit'));
  assert.notEqual(admitted.revision, initial.revision);
  fs.rmSync(path.join(root, 'src'), { recursive: true });
  const restored = indexProject(root, { previous: admitted });
  assert.equal(restored.status, 'current');
  assert.equal(restored.stats.cachedFiles, 999);
  assert.ok(file(restored, 'assets/0999.json'));
  assert.equal(restored.revision, initial.revision);
  assert.deepEqual(stable(restored), stable(initial));
});

test('source overflow preserves naming control metadata without making its omitted file a readable node', t => {
  const naming = { schemaVersion: 1, blocks: [{ id: 'retained-source', label: 'Retained source', aliases: [], description: 'Control metadata survives ordinary inventory omission.', type: 'module', group: 'core', files: ['src/0000.js'], prefixes: [] }] };
  const root = fixture(t, { 'project-map.json': JSON.stringify(naming) });
  for (let i = 0; i < 1001; i++) write(root, `src/${String(i).padStart(4, '0')}.js`, 'export const source = true;');
  const graph = indexProject(root);
  assert.equal(graph.stats.files, 1000);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.metadata.status, 'current');
  assert.deepEqual(graph.metadata.configuration, naming);
  assert.ok(!file(graph, 'project-map.json'));
  assert.ok(scopeEntry(graph, 'project-map.json', 'unscanned', 'file-limit'));
  assert.ok(scopeEntry(graph, 'src/1000.js', 'unscanned', 'file-limit'));
});

test('source priority cannot override R06 exclusions or invalid-policy fail-closed reads', t => {
  const root = fixture(t, {
    '.gitignore': '/blocked/\n!node_modules/\n!agent.mind/\n',
    'src/keep.js': 'export const keep = 1;',
    'blocked/private.js': 'PRIVATE_SENTINEL', 'dist/private.js': 'PRIVATE_SENTINEL',
    'node_modules/private.js': 'PRIVATE_SENTINEL', '.hidden/private.js': 'PRIVATE_SENTINEL',
    'secret.js': 'PRIVATE_SENTINEL', 'agent.mind/private.js': 'PRIVATE_SENTINEL',
    'agent.mind/project-map.json': '{"schemaVersion":1,"blocks":[]}',
  });
  addJSON(root, 1005);
  fs.symlinkSync(path.join(root, 'blocked/private.js'), path.join(root, 'src/link.js'));
  const opened = [];
  const original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(String(name)); return original(name, ...args); });
  const options = { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' };
  const graph = indexProject(root, options);
  assert.ok(file(graph, 'src/keep.js'));
  assert.ok(!JSON.stringify(graph).includes('PRIVATE_SENTINEL'));
  for (const name of ['blocked/private.js', 'dist/private.js', 'node_modules/private.js', '.hidden/private.js', 'secret.js', 'agent.mind/private.js', 'src/link.js']) assert.ok(!opened.includes(path.join(root, name)), name);
  write(root, '.gitignore', '**\n');
  opened.length = 0;
  const invalid = indexProject(root, { ...options, previous: graph });
  assert.equal(invalid.inputPolicy.status, 'invalid');
  assert.equal(invalid.status, 'partial');
  assert.deepEqual(invalid.nodes, []);
  assert.deepEqual(invalid.edges, []);
  assert.equal(invalid.metadata, null);
  assert.ok(opened.every(name => name === path.join(root, '.gitignore')));
});

test('priority does not erase depth or directory-entry uncertainty or raise traversal limits', t => {
  const deep = fixture(t, { 'src/visible.js': 'export const visible = true;' });
  write(deep, Array.from({ length: 21 }, () => 'nested').join('/') + '/unobserved.js', 'DO_NOT_READ');
  const depth = indexProject(deep);
  assert.equal(depth.status, 'partial');
  assert.ok(depth.inventory.entries.some(item => item.reason === 'depth-limit' && item.state === 'unscanned'));
  assert.ok(!depth.nodes.some(item => item.path?.endsWith('unobserved.js')));
  const wide = fixture(t);
  // Entries consume the traversal bound even when privacy guards exclude each file.
  for (let i = 0; i <= INDEX_LIMITS.entries; i++) write(wide, `.hidden-${String(i).padStart(5, '0')}`, '');
  const entries = indexProject(wide);
  assert.equal(entries.status, 'partial');
  assert.equal(entries.inventory.status, 'partial');
  assert.ok(entries.inventory.entries.some(item => item.reason === 'entry-limit' && item.state === 'unscanned'));
  assert.equal(INDEX_LIMITS.entries, 10000);
  assert.equal(INDEX_LIMITS.depth, 20);
});
