import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeSymbolGraph } from '../symbol-index.mjs';
import { indexProject } from '../code-index.mjs';
import { attachOverview, resolvePart } from '../project-map.mjs';
import { projectContext } from '../graph-context.mjs';
import { scopeGraph, projectAreas, ancestorPath } from '../public/hierarchy.mjs';
import { LiveIndex } from '../live-index.mjs';

const analyze = source => analyzeSymbolGraph('app.mjs', source);
const id = (...segments) => `symbol:app.mjs#@accessor:${JSON.stringify(segments)}`;
const accessor = (kind, name = 'value', isStatic = false, isPrivate = false) => id('Store', [name, kind, isStatic, isPrivate]);
const hash = source => createHash('sha256').update(source).digest('hex');
const byId = (graph, target) => graph.nodes.find(node => node.id === target);
const getter = 'get value() { function child() { target(); } child(); return 1; }';
const setter = 'set value(next) { function child() { target(); } child(); }';
const sourceOf = methods => `function target() {}\nclass Store {\n${methods.join('\n')}\nnormal() { this.value(); this.other(); }\nother() {}\n}`;

function fixture(t, source, parts = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-accessor-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = value => fs.writeFileSync(path.join(root, 'app.mjs'), value);
  const configure = entries => fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify({
    schemaVersion: 1,
    blocks: [{ id: 'app', label: 'App', description: 'Synthetic source', aliases: [], type: 'module', group: 'core', files: ['app.mjs'], prefixes: [] }],
    parts: entries
  }));
  write(source); configure(parts);
  return { root, write, configure, scan: () => attachOverview(indexProject(root)) };
}
const part = (target, label) => ({ target, label, description: 'Synthetic name', aliases: [] });
function ambiguous(hierarchy, selector, expectedIds) {
  assert.throws(() => resolvePart(hierarchy, selector), error => {
    assert.equal(error.code, 'AMBIGUOUS_SELECTOR');
    assert.ok(Array.isArray(error.candidates));
    if (expectedIds) assert.deepEqual(error.candidates.map(item => item.id).sort(), expectedIds.slice().sort());
    assert.ok(error.candidates.every(item => item.id && item.path === 'app.mjs' && item.qualifiedLabel));
    return true;
  });
}

for (const [firstKind, first, secondKind, second] of [['get', getter, 'set', setter], ['set', setter, 'get', getter]]) {
  test(`${firstKind}-only to pair to ${secondKind}-only keeps accessor and descendant identities in either declaration order`, () => {
    const single = analyze(sourceOf([first]));
    const initial = accessor(firstKind);
    const initialChild = id('Store', ['value', firstKind, false, false], 'child');
    assert.ok(byId(single, initial));
    assert.ok(byId(single, initialChild));
    for (const methods of [[first, second], [second, first]]) {
      const pair = analyze(sourceOf(methods));
      for (const kind of ['get', 'set']) {
        const node = byId(pair, accessor(kind));
        assert.ok(node, `${kind} remains visible`);
        assert.equal(node.name, 'value');
        assert.equal(node.label, 'value');
        assert.equal(node.qualifiedName, 'Store.value');
        assert.equal(node.kind, 'method');
        assert.equal(node.accessorKind, kind);
        assert.equal(node.static, false);
        assert.equal(node.private, false);
        assert.equal(node.parentId, 'symbol:app.mjs#Store');
        assert.equal(node.legacyId, 'symbol:app.mjs#Store.value');
        const child = byId(pair, id('Store', ['value', kind, false, false], 'child'));
        assert.ok(child);
        assert.equal(child.parentId, node.id);
        assert.equal(child.legacyId, 'symbol:app.mjs#Store.value.child');
        assert.ok(pair.edges.some(edge => edge.from === node.id && edge.to === child.id));
        assert.ok(pair.edges.some(edge => edge.from === child.id && edge.to === 'symbol:app.mjs#target'));
      }
      assert.ok(byId(pair, initial));
      assert.ok(byId(pair, initialChild));
      const remaining = analyze(sourceOf([second]));
      assert.ok(byId(remaining, accessor(secondKind)));
      assert.ok(byId(remaining, id('Store', ['value', secondKind, false, false], 'child')));
      assert.equal(byId(remaining, initial), undefined);
    }
  });
}

test('line-only edits preserve identities while ranges, hashes and callsite evidence follow current source', () => {
  const source = sourceOf([getter, setter]);
  const before = analyze(source), after = analyze(`\n// shifted\n${source}`);
  assert.deepEqual(after.nodes.map(node => node.id), before.nodes.map(node => node.id));
  assert.ok(before.nodes.some(node => node.accessorKind === 'get'));
  for (const node of before.nodes) {
    const shifted = byId(after, node.id);
    assert.equal(node.hash, hash(source));
    assert.equal(shifted.hash, hash(`\n// shifted\n${source}`));
    assert.equal(shifted.line, node.line + 2);
    assert.equal(shifted.endLine, node.endLine + 2);
    assert.equal(shifted.column, node.column);
  }
  assert.deepEqual(after.edges.map(edge => [edge.from, edge.to]), before.edges.map(edge => [edge.from, edge.to]));
  for (let index = 0; index < before.edges.length; index++) {
    assert.equal(after.edges[index].execution, 'not-observed');
    assert.deepEqual(after.edges[index].evidence, before.edges[index].evidence.map(item => ({ ...item, line: item.line + 2 })));
  }
});

test('nested class accessors and shared child names retain every source ancestor', () => {
  const graph = analyze(`class Store {
    get value() { class Inner { get item() { function child() {} child(); } set item(v) { function child() {} child(); } } return Inner; }
    set value(v) { class Inner { get item() { function child() {} child(); } } }
  }`);
  for (const outerKind of ['get', 'set']) {
    const outer = ['value', outerKind, false, false];
    const inner = id('Store', outer, 'Inner');
    assert.equal(byId(graph, inner)?.parentId, accessor(outerKind));
    const kinds = outerKind === 'get' ? ['get', 'set'] : ['get'];
    for (const innerKind of kinds) {
      const nested = id('Store', outer, 'Inner', ['item', innerKind, false, false]);
      const child = id('Store', outer, 'Inner', ['item', innerKind, false, false], 'child');
      assert.equal(byId(graph, nested)?.parentId, inner);
      assert.equal(byId(graph, child)?.parentId, nested);
    }
  }
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
});

test('static, private, literal and dotted/marker names cannot collide with accessor ancestry', () => {
  const graph = analyze(`class Store {
    get value() { function child() {} } static get value() {}
    get #value() {} get '#value'() {}
    get 'value.child'() {} get valueChild() { function child() {} }
    get '@accessor:["Store",["value","get",false,false]]'() {}
    '@accessor:["Store",["value","get",false,false]]'() {}
  }`);
  for (const [name, isStatic, isPrivate] of [['value', false, false], ['value', true, false], ['#value', false, true], ['#value', false, false]]) {
    const node = byId(graph, accessor('get', name, isStatic, isPrivate));
    assert.ok(node, `${name}/${isStatic}/${isPrivate}`);
    assert.equal(node.static, isStatic);
    assert.equal(node.private, isPrivate);
  }
  assert.ok(byId(graph, accessor('get', 'value.child')));
  assert.ok(byId(graph, id('Store', ['valueChild', 'get', false, false], 'child')));
  assert.ok(byId(graph, id('Store', ['value', 'get', false, false], 'child')));
  assert.equal(graph.nodes.length, 11);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.equal(graph.diagnostics.some(item => /duplicate IDs/.test(item.message)), false);
});

test('same-kind accessor duplicates and descendants remain omitted without dropping the valid counterpart', () => {
  const graph = analyze(`class Store {
    get value() { function first() {} }
    get value() { function second() {} }
    set value(v) { function child() {} child(); }
  }`);
  assert.equal(byId(graph, accessor('get')), undefined);
  assert.equal(graph.nodes.some(node => ['first', 'second'].includes(node.name)), false);
  assert.ok(byId(graph, accessor('set')));
  assert.ok(byId(graph, id('Store', ['value', 'set', false, false], 'child')));
  assert.match(graph.diagnostics.map(item => item.message).join(' '), /Ambiguous symbol name/);
});

test('ordinary symbol IDs and supported calls are unchanged; an accessor is never a this-call target', () => {
  const graph = analyze(sourceOf([getter, setter]));
  for (const name of ['target', 'Store', 'Store.normal', 'Store.other']) {
    const node = byId(graph, `symbol:app.mjs#${name}`);
    assert.ok(node);
    assert.equal(node.legacyId, undefined);
  }
  assert.ok(graph.edges.some(edge => edge.from === 'symbol:app.mjs#Store.normal' && edge.to === 'symbol:app.mjs#Store.other'));
  assert.equal(graph.edges.some(edge => [accessor('get'), accessor('set')].includes(edge.to)), false);
  assert.match(graph.diagnostics.map(item => item.message).join(' '), /unresolved/);
});

test('exact legacy selectors name a singleton, while pairs expose candidate identities and keep canonical selection', t => {
  const f = fixture(t, sourceOf([getter]), [part('symbol:app.mjs#Store.value', 'Stored value')]);
  let graph = f.scan();
  assert.equal(resolvePart(graph.hierarchy, 'symbol:app.mjs#Store.value')?.id, accessor('get'));
  assert.equal(resolvePart(graph.hierarchy, 'symbol:app.mjs#Store.value.child')?.id, id('Store', ['value', 'get', false, false], 'child'));
  assert.equal(resolvePart(graph.hierarchy, accessor('get'))?.label, 'Stored value');
  assert.equal(resolvePart(graph.hierarchy, 'SYMBOL:app.mjs#Store.value'), null, 'legacy IDs are exact selectors');
  f.write(sourceOf([getter, setter])); graph = f.scan();
  ambiguous(graph.hierarchy, 'symbol:app.mjs#Store.value', [accessor('get'), accessor('set')]);
  ambiguous(graph.hierarchy, 'symbol:app.mjs#Store.value.child', ['get', 'set'].map(kind => id('Store', ['value', kind, false, false], 'child')));
  assert.equal(resolvePart(graph.hierarchy, accessor('get')).sourceName, 'value');
  assert.equal(graph.hierarchy.nodes.some(node => node.label === 'Stored value'), false);
  assert.match(graph.hierarchy.diagnostics.map(item => item.message).join(' '), /ambig/i);
  f.configure([part(accessor('get'), 'Read value'), part(accessor('set'), 'Write value')]); graph = f.scan();
  assert.equal(resolvePart(graph.hierarchy, accessor('get')).label, 'Read value');
  assert.equal(resolvePart(graph.hierarchy, accessor('set')).label, 'Write value');
});

test('conflicting old/new names cannot silently assign two names to one source declaration', t => {
  const f = fixture(t, sourceOf([getter]), [part('symbol:app.mjs#Store.value', 'Old name'), part(accessor('get'), 'New name')]);
  const graph = f.scan();
  assert.match(graph.hierarchy.diagnostics.map(item => item.message).join(' '), /duplicate|conflict|ambig/i);
  assert.equal(graph.hierarchy.nodes.filter(node => node.id === accessor('get')).length, 1);
  assert.equal(graph.hierarchy.nodes.some(node => ['Old name', 'New name'].includes(node.label)), false);
});

test('legacy claim collisions with ordinary canonical IDs and withheld declarations remain ambiguous', t => {
  const collision = `class Store { get value() { function child() {} } 'value.child'() {} }`;
  const f = fixture(t, collision, [part('symbol:app.mjs#Store.value.child', 'Unsafe name')]);
  let graph = f.scan();
  ambiguous(graph.hierarchy, 'symbol:app.mjs#Store.value.child', ['symbol:app.mjs#Store.value.child', id('Store', ['value', 'get', false, false], 'child')]);
  assert.equal(graph.hierarchy.nodes.some(node => node.label === 'Unsafe name'), false);
  f.write(`class Store { get value() {} get value() {} set value(v) {} }`); graph = f.scan();
  ambiguous(graph.hierarchy, 'symbol:app.mjs#Store.value');
  assert.ok(resolvePart(graph.hierarchy, accessor('set')));
});

test('shared scope/area projections and full/bounded context preserve accessor IDs, ancestry and source evidence', t => {
  const f = fixture(t, sourceOf([getter, setter]));
  const graph = f.scan();
  for (const kind of ['get', 'set']) {
    const selected = accessor(kind), child = id('Store', ['value', kind, false, false], 'child');
    assert.deepEqual(ancestorPath(graph.hierarchy, child).slice(-3).map(node => node.id), ['symbol:app.mjs#Store', selected, child]);
    const scope = scopeGraph(graph, selected), collapsed = projectAreas(scope);
    assert.ok(scope.nodes.some(node => node.id === child));
    assert.ok(collapsed.areas.some(area => area.memberIds.includes(child)));
    const expanded = projectAreas(scope, new Set(collapsed.areas.map(area => area.id)));
    assert.ok(expanded.nodes.some(node => node.id === child));
    const full = projectContext(graph, selected);
    assert.equal(full.selection.id, selected);
    assert.deepEqual(full.partCanvas.nodes, scope.nodes);
    const bounded = projectContext(graph, selected, { profile: 'agent', maxBytes: 1000000 });
    assert.equal(bounded.selection.id, selected);
    assert.equal(bounded.page.next, null);
    const symbols = bounded.page.items.map(item => item.value).filter(item => item.kind === 'symbol').map(item => item.value);
    assert.deepEqual(symbols.map(node => node.id).sort(), full.symbolGraph.nodes.map(node => node.id).sort());
    for (const node of symbols) assert.equal(node.hash, graph.nodes.find(file => file.path === 'app.mjs').hash);
  }
});

test('LiveIndex updates singleton/pair/removal without stale identities or evidence', t => {
  const f = fixture(t, sourceOf([getter]));
  const live = new LiveIndex(f.root, { intervalMs: 60000 });
  t.after(() => live.close());
  const before = live.snapshot();
  assert.ok(byId(before.symbolGraph, accessor('get')));
  f.write(`\n${sourceOf([setter, getter])}`);
  const pair = live.refresh();
  assert.equal(pair.runtime.status, 'current');
  assert.notEqual(pair.revision, before.revision);
  for (const kind of ['get', 'set']) assert.ok(byId(pair.symbolGraph, accessor(kind)));
  f.write(sourceOf([setter]));
  const remaining = live.refresh();
  assert.equal(byId(remaining.symbolGraph, accessor('get')), undefined);
  assert.ok(byId(remaining.symbolGraph, accessor('set')));
  assert.equal(resolvePart(remaining.hierarchy, 'symbol:app.mjs#Store.value').id, accessor('set'));
  assert.ok(remaining.symbolGraph.nodes.every(node => node.hash === hash(sourceOf([setter]))));
});

// Missing selectors must not match nodes merely because they have no legacy ID.
test('absent source selectors preserve the resolver not-found behavior', t => {
  const graph = fixture(t, sourceOf([getter])).scan();
  assert.equal(resolvePart(graph.hierarchy, undefined), null);
  assert.equal(resolvePart(graph.hierarchy, null), null);
  assert.equal(resolvePart(graph.hierarchy, 'symbol:app.mjs#missing'), null);
});
