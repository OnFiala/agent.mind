import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject, readIndexedSource } from '../code-index.mjs';
import { analyzeSource } from '../source-analysis.mjs';

const CODE = 'COMMONJS_REFERENCE_ANALYSIS_UNSUPPORTED';
const file = (graph, name) => graph.nodes.find(node => node.id === `file:${name}`);
const commonJS = result => result.diagnostics.filter(item => item.code === CODE).toSorted((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
function fixture(t, contents) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-reference-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), source);
  }
  return root;
}

// Fixture source is inspected as data. It must never be imported or executed.
test('CommonJS extensions remain safe text-only inventory with one per-file and global reason', t => {
  const source = 'module.exports = require("./dep.mjs"); throw new Error("MUST NOT EXECUTE");';
  const root = fixture(t, { 'main.cjs': source, 'other.CJS': 'invalid JavaScript }', 'binary.cjs': Buffer.from([0, 1, 2]), 'dep.mjs': 'export const value = 1;' });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.inventory.status, 'complete');
  assert.deepEqual(graph.scope.unsupported, ['binary.cjs', 'main.cjs', 'other.CJS']);
  assert.deepEqual(graph.edges, []);
  assert.equal(commonJS(graph).length, 3);
  assert.equal(file(graph, 'binary.cjs'), undefined);
  for (const name of ['main.cjs', 'other.CJS']) {
    const node = file(graph, name);
    assert.equal(node.kind, 'file');
    assert.equal(node.language, undefined);
    assert.deepEqual(node.capabilities, ['text']);
    assert.deepEqual(node.symbols, []);
    assert.deepEqual(node.security, []);
    assert.deepEqual(node.diagnostics, commonJS(graph).filter(item => item.path === name));
    assert.equal(node.diagnostics.length, 1);
    assert.equal(node.diagnostics[0].reason, 'cjs-extension');
    assert.equal(node.diagnostics[0].capability, 'static-references');
    assert.equal(node.diagnostics[0].severity, 'warning');
    assert.equal(node.diagnostics[0].line, undefined);
  }
  assert.equal(readIndexedSource(root, file(graph, 'main.cjs')), source);
  const warm = indexProject(root, { previous: graph });
  assert.equal(warm.revision, graph.revision);
  assert.equal(warm.stats.cachedFiles, 3);
  assert.deepEqual(commonJS(warm), commonJS(graph));
});

test('parsed CommonJS-style forms disclose precise syntax evidence without resolving references', t => {
  const lines = [
    'require("./dep.mjs");',
    'require.resolve("pkg");',
    'require["resolve"](computed);',
    'module.require("./dep.mjs");',
    'module["require"](computed);',
    'module.exports = {};',
    'module["exports"].value = 1;',
    'exports.value = 1;',
    'exports["other"] = 2;',
    'consume(module.exports, exports.value);'
  ];
  for (const extension of ['js', 'mjs']) {
    const name = `main.${extension}`;
    const root = fixture(t, { [name]: lines.join('\n'), 'dep.mjs': 'export const value = 1;' });
    const graph = indexProject(root);
    const diagnostics = commonJS(graph);
    assert.equal(graph.status, 'partial');
    assert.equal(graph.inventory.status, 'complete');
    assert.deepEqual(graph.edges, []);
    assert.deepEqual(diagnostics.map(item => [item.line, item.column, item.form]), [
      [1, 1, 'require'], [2, 1, 'require.resolve'], [3, 1, 'require.resolve'],
      [4, 1, 'module.require'], [5, 1, 'module.require'], [6, 1, 'module.exports'],
      [7, 1, 'module.exports'], [8, 1, 'exports-property'], [9, 1, 'exports-property'],
      [10, 9, 'module.exports'], [10, 25, 'exports-property']
    ]);
    assert.deepEqual(file(graph, name).diagnostics, diagnostics);
    for (const item of diagnostics) {
      assert.equal(item.path, name);
      assert.equal(item.snippet, lines[item.line - 1]);
      assert.equal(item.reason, 'commonjs-syntax');
      assert.equal(item.capability, 'static-references');
      assert.equal(item.severity, 'warning');
      assert.match(item.message, /CommonJS-style/);
    }
  }
});

test('comments, strings, aliases, ordinary receivers and shadowed bindings do not claim CommonJS syntax', () => {
  const negative = [
    '// require("fake"); module.exports = fake; exports.fake = 1;',
    'const text = "require(\\\"fake\\\"); module.exports";',
    'const regex = /require\\(fake\\)/;',
    'const object = { require() {}, exports: {} }; object.require("fake"); object.exports.value = 1;',
    'const alias = object.require; alias("fake");',
    'function params(require, module, exports) { require("fake"); module.require("fake"); module.exports = exports.value; }',
    'function locals() { require("fake"); module.exports = exports.value; var require, module, exports; }',
    'function destructured({ require, module, exports }) { require("fake"); module.exports = exports.value; }',
    'try {} catch ({ require, module, exports }) { require("fake"); module.exports = exports.value; }',
    '{ let require, module, exports; require("fake"); module.exports = exports.value; }',
    'for (let require of []) require("fake");',
    'for (const module of []) module.exports = 1;',
    'for (let exports = {}; false;) exports.value = 1;',
    'const expression = function require() { require("fake"); };',
    'const expression = require => require("fake");',
    'const klass = class module { method() { module.exports = 1; } };',
    'class Outer { static { var require; require("fake"); } }',
    'switch (1) { case 1: let require; require("fake"); break; }',
    'exports[computed] = 1; require[computed]("fake"); module[computed]("fake");'
  ];
  for (const source of negative) {
    const result = analyzeSource('negative.mjs', source, 'hash');
    assert.deepEqual(commonJS(result), [], source);
    assert.ok(!result.diagnostics.some(item => /parse error/i.test(item.message)), source);
  }
  for (const binding of ['require', 'module', 'exports']) {
    const source = `import ${binding} from "local-library"; require("fake"); module.exports = exports.value;`;
    const result = analyzeSource('imported.mjs', source, 'hash');
    const forms = commonJS(result).map(item => item.form);
    assert.ok(!forms.includes(binding === 'require' ? 'require' : binding === 'module' ? 'module.exports' : 'exports-property'));
  }
});

test('inner lexical, loop, class and function bindings leave outer CommonJS diagnostics visible', () => {
  const source = [
    '{ let require, module, exports; require("inner"); module.exports = exports.inner; }',
    'function inner(require, module, exports) { require("inner"); module.exports = exports.inner; }',
    'for (const require of []) require("inner");',
    'class Inner { static { var require; require("inner"); } }',
    'const expression = class module { method() { module.exports = 1; } };',
    'require("outer"); module.exports = exports.outer;'
  ].join('\n');
  const result = analyzeSource('outer.mjs', source, 'hash');
  assert.deepEqual(commonJS(result).map(item => [item.line, item.form]), [[6, 'require'], [6, 'module.exports'], [6, 'exports-property']]);
});

test('function-body and switch-case locals do not hide outer references in defaults or discriminants', () => {
  const result = analyzeSource('evaluation.mjs', [
    'function defaults(value = require("parameter")) { var require; require("body"); }',
    'switch (require("discriminant")) { case 1: let require; require("case"); }',
    'const arrow = () => require("arrow body");'
  ].join('\n'), 'hash');
  assert.deepEqual(commonJS(result).map(item => [item.line, item.column, item.form]), [[1, 27, 'require'], [2, 9, 'require'], [3, 21, 'require']]);
});

test('concise arrow bodies remain analyzable with unshadowed and shadowed require', () => {
  for (const [source, forms] of [
    ['const plain = () => 1;', []],
    ['const load = () => require("pkg");', ['require']],
    ['const local = require => require("pkg");', []]
  ]) {
    const result = analyzeSource('arrows.mjs', source, 'hash');
    assert.deepEqual(commonJS(result).map(item => item.form), forms, source);
    assert.ok(!result.diagnostics.some(item => /parse error/i.test(item.message)), source);
  }
});

test('ESM edges, evidence and symbols remain exact when unsupported CommonJS syntax is added', t => {
  const source = 'import { value } from "./dep.mjs";\nexport { value } from "./dep.mjs";\nawait import("./dep.mjs");\nconst asset = new URL("./data.json", import.meta.url);\nexport function work() { return value; }';
  const root = fixture(t, { 'main.mjs': source, 'dep.mjs': 'export const value = 1;', 'data.json': '{}' });
  const esm = indexProject(root);
  assert.equal(esm.status, 'current');
  assert.deepEqual(esm.edges.toSorted((a, b) => a.kind.localeCompare(b.kind)).map(item => [item.from, item.to, item.kind, item.evidence.map(evidence => [evidence.line, evidence.column, evidence.snippet])]), [
    ['file:main.mjs', 'file:data.json', 'asset', [[4, 23, 'const asset = new URL("./data.json", import.meta.url);']]],
    ['file:main.mjs', 'file:dep.mjs', 'dynamic-import', [[3, 14, 'await import("./dep.mjs");']]],
    ['file:main.mjs', 'file:dep.mjs', 'import', [[1, 23, 'import { value } from "./dep.mjs";']]],
    ['file:main.mjs', 'file:dep.mjs', 'reexport', [[2, 23, 'export { value } from "./dep.mjs";']]]
  ]);
  fs.writeFileSync(path.join(root, 'main.mjs'), `${source}\nrequire("./dep.mjs");`);
  const mixed = indexProject(root, { previous: esm });
  assert.equal(mixed.status, 'partial');
  assert.deepEqual(mixed.edges, esm.edges);
  assert.deepEqual(file(mixed, 'main.mjs').symbols, file(esm, 'main.mjs').symbols);
  assert.deepEqual(file(mixed, 'main.mjs').capabilities, file(esm, 'main.mjs').capabilities);
  assert.deepEqual(mixed.scope, esm.scope);
});

test('fresh and cached scans preserve diagnostics independently and clear them after source repair', t => {
  const root = fixture(t, { 'main.mjs': 'require("./dep.mjs");', 'dep.mjs': 'export const value = 1;' });
  const first = indexProject(root);
  const expected = structuredClone(first.diagnostics);
  const warm = indexProject(root, { previous: first });
  assert.deepEqual(warm.diagnostics, expected);
  assert.equal(warm.revision, first.revision);
  assert.equal(warm.stats.cachedFiles, 2);
  warm.diagnostics[0].reason = 'consumer mutation';
  file(warm, 'main.mjs').diagnostics[0].snippet = 'consumer mutation';
  const fresh = indexProject(root);
  const cached = indexProject(root, { previous: warm });
  assert.deepEqual(cached.diagnostics, fresh.diagnostics);
  assert.deepEqual(file(cached, 'main.mjs').diagnostics, file(fresh, 'main.mjs').diagnostics);
  fs.writeFileSync(path.join(root, 'main.mjs'), 'import "./dep.mjs";');
  const repaired = indexProject(root, { previous: cached });
  assert.equal(repaired.status, 'current');
  assert.deepEqual(commonJS(repaired), []);
  assert.deepEqual(file(repaired, 'main.mjs').diagnostics, []);
  assert.equal(repaired.edges.length, 1);
  assert.equal(repaired.edges[0].kind, 'import');
  assert.equal(repaired.stats.cachedFiles, 1);
  assert.notEqual(repaired.revision, first.revision);
  assert.equal(indexProject(root).revision, repaired.revision);
});

test('Python src imports retain informational provenance and unresolved calls without CommonJS warnings', t => {
  const root = fixture(t, {
    'main.py': 'import src.worker\nfrom helper import work\nwork()\n',
    'src/worker.py': 'def local():\n    return 1\nlocal()\nunknown()\n',
    'helper.py': 'def work():\n    return 1\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.deepEqual(commonJS(graph), []);
  const unresolved = graph.edges.find(item => item.to === 'external:python:src.worker');
  assert.ok(unresolved);
  assert.deepEqual(unresolved.evidence, [{ path: 'main.py', line: 1, column: 8, snippet: 'import src.worker' }]);
  assert.ok(!graph.edges.some(item => item.to === 'file:src/worker.py'));
  const diagnostic = graph.diagnostics.find(item => item.path === 'main.py' && item.line === 1 && /project-root/.test(item.message));
  assert.equal(diagnostic.severity, 'info');
  assert.deepEqual({ path: diagnostic.path, line: diagnostic.line, column: diagnostic.column, snippet: diagnostic.snippet }, unresolved.evidence[0]);
  assert.deepEqual(file(graph, 'src/worker.py').producer, { name: '@lezer/python', version: '1.1.19', mode: 'static-source' });
  assert.ok(graph.symbolGraph.edges.some(item => item.kind === 'call' && item.evidence.some(evidence => evidence.path === 'src/worker.py' && evidence.line === 3)));
  assert.ok(graph.diagnostics.some(item => item.path === 'src/worker.py' && item.line === 4 && item.column === 1 && item.severity === 'info' && /Unresolved Python call/.test(item.message)));
  const warm = indexProject(root, { previous: graph });
  assert.deepEqual(warm.diagnostics, graph.diagnostics);
  assert.deepEqual(warm.symbolGraph, graph.symbolGraph);
  assert.deepEqual(warm.edges, graph.edges);
});
