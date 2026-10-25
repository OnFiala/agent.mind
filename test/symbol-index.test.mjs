import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'acorn';
import { analyzeSymbolGraph, SYMBOL_LIMITS } from '../symbol-index.mjs';
import { indexProject } from '../code-index.mjs';

const analyze = source => analyzeSymbolGraph('source.mjs', source);
const get = (graph, name) => graph.nodes.find(node => node.qualifiedName === name);
const call = (graph, from, to) => graph.edges.find(edge => edge.from === get(graph, from)?.id && edge.to === get(graph, to)?.id);

test('named hierarchy includes nested functions, const functions, classes and methods with nearest named parents', () => {
  const source = [
    'export function start() {',
    '  const render = () => { function label() {} return label(); };',
    '  function load() {}',
    '  class Store { refresh() { function persist() {} persist(); } }',
    '  return render();',
    '}',
    'const factory = function internal() { return internal(); };',
    '// function invented() {}',
    'const example = "function invented() {}";'
  ].join('\n');
  const graph = analyze(source);
  assert.deepEqual(graph.nodes.map(node => node.qualifiedName).sort(), ['factory', 'start', 'start.load', 'start.render', 'start.render.label', 'start.Store', 'start.Store.refresh', 'start.Store.refresh.persist'].sort());
  assert.equal(get(graph, 'start.render.label').parentId, get(graph, 'start.render').id);
  assert.equal(get(graph, 'start.Store.refresh').parentId, get(graph, 'start.Store').id);
  assert.equal(get(graph, 'start.Store').kind, 'class');
  assert.equal(get(graph, 'start.Store.refresh').kind, 'method');
  assert.equal(get(graph, 'start.render').line, 2);
  assert.equal(get(graph, 'start').endLine, 6);
  assert.match(get(graph, 'start').hash, /^[a-f\d]{64}$/);
  assert.ok(call(graph, 'factory', 'factory'));
});

test('same-file direct lexical calls and class construction preserve exact call-site evidence', () => {
  const graph = analyze([
    'function shared() {}',
    'class Store {}',
    'function start() {',
    '  function child() { shared(); }',
    '  const render = () => child();',
    '  render(); child();',
    '  return new Store();',
    '}'
  ].join('\n'));
  assert.ok(call(graph, 'start.child', 'shared'));
  assert.ok(call(graph, 'start.render', 'start.child'));
  assert.ok(call(graph, 'start', 'start.render'));
  assert.ok(call(graph, 'start', 'start.child'));
  assert.ok(call(graph, 'start', 'Store'));
  const evidence = call(graph, 'start.child', 'shared').evidence[0];
  assert.equal(evidence.path, 'source.mjs');
  assert.equal(evidence.line, 4);
  assert.equal(evidence.column, 22);
  assert.equal(evidence.snippet, 'function child() { shared(); }');
  for (const edge of graph.edges) {
    assert.equal(edge.kind, 'call');
    assert.equal(edge.label, 'calls');
    assert.deepEqual(edge.layers, ['project']);
    assert.equal(edge.execution, 'not-observed');
  }
});

test('parameters, catch bindings, block shadows and hoisted variables prevent false lexical links', () => {
  const graph = analyze(`
function target() {}
function parameter(target) { target(); }
function caught() { try { throw 1; } catch(target) { target(); } }
function hoisted() { target(); var target; }
function blocks() { { const target = () => {}; target(); } target(); }
`);
  assert.ok(!call(graph, 'parameter', 'target'));
  assert.ok(!call(graph, 'caught', 'target'));
  assert.ok(!call(graph, 'hoisted', 'target'));
  assert.ok(call(graph, 'blocks', 'blocks.target'));
  assert.ok(call(graph, 'blocks', 'target'));
  assert.equal(graph.edges.length, 2);
});

test('reassignment including destructuring and loop writes invalidates calls through touched lexical bindings', () => {
  for (const write of ['target = unknown;', '({value:target}=unknown);', '[target] = unknown;', '[...target] = unknown;', 'for(target of unknown) {}', 'target++;']) {
    const graph = analyze(`let target = () => {}; function caller() { target(); ${write} }`);
    assert.ok(get(graph, 'target'));
    assert.equal(graph.edges.length, 0, write);
  }
});

test('mutations in unsupported class parts invalidate outer targets without adding symbols or calls', () => {
  for (const body of [
    'static { target = () => {}; }',
    'static value = (target = () => {});',
    'value = (target = () => {});',
    '[target = () => {}]() {}',
    '[target = () => {}] = 1;',
    'static { (() => { target = () => {}; })(); }',
    'static { class Nested { static { target = () => {}; } } }'
  ]) {
    const graph = analyze(`let target = () => {}; class Store { ${body} } target();`);
    assert.ok(get(graph, 'target'));
    assert.equal(graph.edges.length, 0, body);
    assert.match(graph.diagnostics.map(item => item.message).join(' '), /unresolved/, body);
    assert.equal(graph.nodes.some(node => node.name === 'Nested'), false);
  }
  const methods = analyze('class Store { run() { this.save(); } save() {} static { Store.prototype.save = () => {}; } }');
  assert.equal(methods.edges.length, 0);
});

test('unsupported class-local shadows preserve outer calls and keep omitted bodies out of the graph', () => {
  for (const body of [
    'static { let target; target = 1; }',
    'static { var target; target = 1; }',
    'static { function local(target) { target = 1; } }',
    'static { try {} catch (target) { target = 1; } }',
    'value = function target() { target = 1; };',
    'static { class target { static { target = 1; } } }'
  ]) {
    const graph = analyze(`function target() {} class Store { ${body} } target();`);
    assert.equal(graph.edges.length, 1, body);
    assert.equal(graph.edges[0].to, get(graph, 'target').id);
    assert.deepEqual(graph.nodes.map(node => node.name).sort(), ['Store', 'target']);
  }
  const omitted = analyze('function target() {} class Store { value = target(); static { target(); function local() {} } }');
  assert.equal(omitted.edges.length, 0);
  assert.deepEqual(omitted.nodes.map(node => node.name).sort(), ['Store', 'target']);
});

test('same-scope duplicate declarations and indistinguishable qualified names remain visibly ambiguous', () => {
  const graph = analyze(`
function owner() {
  var child = () => { function leaf() {} leaf(); };
  var child = () => {};
  child();
}
`);
  assert.ok(get(graph, 'owner'));
  assert.ok(!get(graph, 'owner.child'));
  assert.ok(!get(graph, 'owner.child.leaf'));
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.diagnostics.some(item => item.message.includes('Ambiguous symbol name owner.child')));
  assert.ok(graph.diagnostics.some(item => item.message.includes('Ambiguous lexical binding child')));
});

test('same-class this methods resolve only within their instance/static context and lexical arrow this', () => {
  const graph = analyze(`
class Store {
  run() { this.save(); setTimeout(() => this.save()); function unrelated() { this.save(); } }
  save() {}
  static create() { this.build(); this.save(); }
  static build() {}
}
`);
  assert.equal(call(graph, 'Store.run', 'Store.save').evidence.length, 2);
  assert.deepEqual(call(graph, 'Store.run', 'Store.save').evidence.map(item => item.containment), ['direct-body', 'nested-closure']);
  assert.ok(!call(graph, 'Store.run.unrelated', 'Store.save'));
  assert.ok(call(graph, 'Store.create', 'Store.build'));
  assert.ok(!call(graph, 'Store.create', 'Store.save'));
  assert.equal(graph.edges.length, 2);
});

test('direct this/prototype method writes and class field overrides invalidate nominal this targets', () => {
  const cases = [
    'class Store { run() { this.save(); this.save = other; } save() {} }',
    'class Store { run() { this.save(); } save() {} } Store.prototype.save = other;',
    'class Store { run() { this.save(); } save() {} } Store.prototype = other;',
    'class Store { run() { this.save(); } save() {} save = () => {}; }',
    'class Store { static run() { this.save(); } static save() {} } Store.save = other;',
    'class Store { run() { this.save(); [this.save] = other; } save() {} }'
  ];
  for (const source of cases) {
    const graph = analyze(source);
    assert.ok(get(graph, 'Store.run'));
    assert.ok(get(graph, 'Store.save'));
    assert.equal(graph.edges.length, 0, source);
  }
});

test('anonymous callbacks retain lexical owner without inventing scheduling or imported/member call targets', () => {
  const graph = analyze(`
import external from 'external';
function target() {}
function owner() {
  queueMicrotask(() => target());
  external(); object.target(); object["target"]();
  const arrow = () => {};
  new arrow();
}
`);
  assert.equal(graph.edges.length, 1);
  assert.equal(call(graph, 'owner', 'target').evidence[0].containment, 'nested-closure');
  assert.ok(graph.diagnostics.some(item => item.message.includes('remain unresolved')));
});

test('symbol identities survive line edits while graph hashes/cache and deletion reflect exact source versions', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-symbol-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'source.mjs');
  const source = 'function target() {}\nfunction owner() { const child = () => target(); child(); }';
  fs.writeFileSync(target, source);
  const first = indexProject(root);
  const same = indexProject(root, { previous: first });
  assert.equal(first.revision, same.revision);
  assert.equal(same.stats.cachedFiles, 1);
  assert.ok(first.symbolGraph.nodes.every(node => node.hash === first.nodes[0].hash));
  const ids = first.symbolGraph.nodes.map(node => node.id);
  first.symbolGraph.nodes[0].hash = 'caller mutation';
  first.symbolGraph.edges[0].evidence[0].snippet = 'caller mutation';
  assert.equal(indexProject(root, { previous: first }).revision, same.revision);
  fs.writeFileSync(target, `\n\n${source}`);
  const shifted = indexProject(root, { previous: same });
  assert.deepEqual(shifted.symbolGraph.nodes.map(node => node.id), ids);
  assert.notEqual(shifted.revision, same.revision);
  assert.equal(shifted.stats.cachedFiles, 0);
  assert.equal(get(shifted.symbolGraph, 'target').line, 3);
  fs.writeFileSync(target, 'function owner() {}');
  const deleted = indexProject(root, { previous: shifted });
  assert.deepEqual(deleted.symbolGraph.nodes.map(node => node.qualifiedName), ['owner']);
  assert.equal(deleted.symbolGraph.edges.length, 0);
});

test('shared Acorn AST input, parse failures and symbol budgets have explicit bounded behavior', () => {
  const source = 'function target() {} function owner() { target(); }';
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const graph = analyzeSymbolGraph('test/source.test.mjs', source, { ast, hash: 'test-source-hash' });
  assert.ok(graph.nodes.every(node => node.hash === 'test-source-hash'));
  assert.ok(graph.edges[0].layers.includes('testing'));
  const broken = analyze('function broken( {');
  assert.equal(broken.nodes.length, 0);
  assert.ok(broken.diagnostics.some(item => item.severity === 'warning' && item.message.includes('parse error')));
  const bounded = analyze(Array.from({ length: SYMBOL_LIMITS.nodes + 1 }, (_, number) => `function f${number}() {}`).join('\n'));
  assert.equal(bounded.nodes.length, SYMBOL_LIMITS.nodes);
  assert.ok(bounded.diagnostics.some(item => item.severity === 'warning' && item.message.includes('budget exceeded')));
});

test('program call/new sites originate at file scope, while callbacks preserve containment and fields stay unsupported', () => {
  const graph = analyze([
    'function start() {}',
    'class Store { field = start(); static { start(); } }',
    'start();',
    'new Store();',
    'setTimeout(() => start());'
  ].join('\n'));
  const direct = graph.edges.find(edge => edge.from === 'file:source.mjs' && edge.to === get(graph, 'start').id);
  assert.ok(direct);
  assert.equal(direct.execution, 'not-observed');
  assert.deepEqual(direct.evidence.map(item => ({ line: item.line, containment: item.containment })), [
    { line: 3, containment: 'direct-body' },
    { line: 5, containment: 'nested-closure' }
  ]);
  assert.ok(graph.edges.some(edge => edge.from === 'file:source.mjs' && edge.to === get(graph, 'Store').id && edge.evidence[0].line === 4));
  assert.ok(!graph.edges.some(edge => edge.evidence.some(item => item.line === 2)));
});

test('unsupported static blocks and field initializers still invalidate lexical this method mutations', () => {
  const cases = [
    'class Store { static { this.save = () => {}; } static run() { this.save(); } static save() {} }',
    'class Store { replacement = (this.save = () => {}); run() { this.save(); } save() {} }',
    'class Store { static replacement = (() => { [this.save] = replacement; })(); static run() { this.save(); } static save() {} }',
    'class Store { replacement = (() => { delete this.save; })(); run() { this.save(); } save() {} }'
  ];
  for (const source of cases) {
    const graph = analyze(source);
    assert.ok(get(graph, 'Store.run'));
    assert.ok(get(graph, 'Store.save'));
    assert.ok(!call(graph, 'Store.run', 'Store.save'), source);
    assert.equal(graph.edges.length, 0);
  }
  const safe = analyze('class Store { value = 1; static { const unrelated = 1; } run() { this.save(); } save() {} }');
  assert.ok(call(safe, 'Store.run', 'Store.save'));
  const deferredThis = analyze('class Store { replacement = function() { this.save = other; }; run() { this.save(); } save() {} }');
  assert.ok(!call(deferredThis, 'Store.run', 'Store.save'));
});
