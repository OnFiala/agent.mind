import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReferenceSyntax, renderReferenceResolution, renderTypedEvidence, captureResolverView, restoreResolverView, reconcileNavigation, sourceMatchesSnapshot, shouldAcceptGraph } from '../public/visualizer.js';

class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.ownText = ''; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Untrusted text must not be parsed as HTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.ownText = ''; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click(); }
}
globalThis.document = { createElement: tag => new FakeElement(tag) };
const descendants = root => [root, ...root.children.flatMap(descendants)];
const findButton = (root, label) => descendants(root).find(node => node.tag === 'button' && node.textContent === label);
const resolver = { id: 'identity-a', mode: 'bundler-local-v1', status: 'valid', configPath: 'config.json', configHash: 'hash-a', scopeRoot: '.', candidateDomainVersion: 'v1' };
const outcome = i => ({ kind: 'import', specifier: `./file-${i}<img src=x>`, status: i === 40 ? 'blocked' : 'resolved', reasons: ['reason<script>'], target: 'x.ts', typed: { syntaxKind: 'ImportDeclaration', typeOnly: true, bindings: [{ local: '<script>', imported: 'x', typeOnly: true }] }, evidence: { path: 'src/a.ts', hash: 'file-hash', line: i + 1, range: { start: 1, end: 2, unit: 'utf16-code-unit', endExclusive: true } }, candidates: [{ path: 'x.ts', state: 'eligible', hash: 'candidate-hash' }], vetoes: [{ path: 'other.ts', state: 'unknown', reason: 'not-observed' }], traversals: [{ path: 'dir', state: 'enumerated' }] });

test('model outcomes preserve text, provenance and complete evidence across pages', () => {
  const seen = [];
  const data = Array.from({ length: 41 }, (_, i) => outcome(i));
  const root = renderReferenceResolution({ version: 'typed-local-resolution-v1', extraction: 'collected', resolver, outcomes: data }, line => seen.push(line));
  assert.match(root.textContent, /Model-relative local resolution/);
  assert.match(root.textContent, /config.json/);
  assert.match(root.textContent, /Showing 1–40 of 41 outcomes/);
  assert.match(root.textContent, /<img src=x>/);
  assert.match(root.textContent, /candidate-hash/);
  assert.match(root.textContent, /not-observed/);
  assert.match(root.textContent, /enumerated/);
  assert.match(root.textContent, /<script>/);
  assert.equal(descendants(root).some(item => item.tag === 'img' || item.tag === 'script'), false);
  findButton(root, 'Show line 1').click();
  assert.deepEqual(seen, [1]);
  findButton(root, 'Next outcomes').click();
  assert.match(root.textContent, /Showing 41–41 of 41 outcomes/);
  assert.match(root.textContent, /blocked/);
  findButton(root, 'Previous outcomes').click();
  assert.match(root.textContent, /Showing 1–40 of 41 outcomes/);
});

test('producer status and model results are separate; withheld remains explicit', () => {
  const raw = { extraction: 'collected', facts: [], unsupported: [], resolution: { status: 'unsupported' } };
  assert.match(renderReferenceSyntax(raw, () => {}, true).textContent, /producer does not resolve.*separate model-relative/);
  assert.match(renderReferenceSyntax(raw, () => {}).textContent, /resolution is unavailable/);
  assert.match(renderReferenceResolution({ resolver, extraction: 'withheld' }, () => {}).textContent, /outcomes withheld/);
  assert.equal(raw.resolution.status, 'unsupported');
});

test('source acceptance requires matching resolver identity across graph, node and response', () => {
  const policy = { id: 'policy', status: 'valid' };
  const node = { id: 'file:a', path: 'a.ts', hash: 'hash', policyId: 'policy', resolverId: resolver.id };
  const graph = { inputPolicy: policy, resolver, revision: 'rev', runtime: { instanceId: 'instance', sequence: 1 }, nodes: [node] };
  const source = { path: node.path, hash: node.hash, policyId: policy.id, resolverId: resolver.id, revision: 'rev', lines: [] };
  assert.equal(sourceMatchesSnapshot(source, node, graph, graph), true);
  for (const value of [undefined, 'old']) {
    assert.equal(sourceMatchesSnapshot({ ...source, resolverId: value }, node, graph, graph), false);
    assert.equal(sourceMatchesSnapshot(source, { ...node, resolverId: value }, graph, graph), false);
    assert.equal(sourceMatchesSnapshot(source, node, graph, { ...graph, nodes: [{ ...node, resolverId: value }] }), false);
    assert.equal(sourceMatchesSnapshot(source, node, graph, { ...graph, resolver: value ? { ...resolver, id: value } : undefined }), false);
  }
  assert.equal(sourceMatchesSnapshot(source, node, graph, { ...graph, resolver: { ...resolver, status: 'invalid' } }), false);
  assert.equal(shouldAcceptGraph(graph, { ...graph, resolver: { ...resolver, id: 'old' } }), false);
  const plainNode = { ...node }; delete plainNode.resolverId;
  const plainGraph = { ...graph, resolver: undefined, nodes: [plainNode] };
  const plainSource = { ...source }; delete plainSource.resolverId;
  assert.equal(sourceMatchesSnapshot(plainSource, plainNode, plainGraph, plainGraph), true);
  assert.equal(sourceMatchesSnapshot(source, plainNode, plainGraph, plainGraph), false);
});


test('all resolver and edge evidence preformatted text uses the wrapping class', () => {
  const root = renderReferenceResolution({ resolver, extraction: 'collected', outcomes: [outcome(0)] }, () => {});
  const pre = descendants(root).filter(item => item.tag === 'pre');
  assert.equal(pre.length, 2);
  pre.push(renderTypedEvidence(outcome(0).typed));
  for (const item of pre) assert.match(item.className, /(?:^|\s)reference-bindings(?:\s|$)/);
});

test('resolver recovery saves only presentation IDs and restores detached view preferences', () => {
  const old = { positions: new Map([['file:a', { x: 9, y: 10 }]]), camera: { x: 3, y: 4, scale: 0.8 },
    selection: { type: 'node', id: 'file:a', line: 2 }, fitted: true, relationMode: 'focus',
    expandedAreaIds: new Set(['area:a']), focusedAreaId: 'area:a',
    navigation: { scopeId: 'scope:a', history: [null], notice: 'old', snapshots: new Map([[null, { positions: new Map(), selection: { type: 'node', id: 'file:a' } }]]) },
    source: { lines: [{ text: 'secret' }] }, graph: { nodes: [{ label: 'old label' }] } };
  const saved = captureResolverView(old);
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.equal(JSON.stringify(saved).includes('old label'), false);
  old.positions.get('file:a').x = 999;
  old.selection.id = 'changed';
  const state = {};
  restoreResolverView(state, saved);
  assert.deepEqual(state.positions.get('file:a'), { x: 9, y: 10 });
  assert.deepEqual(state.camera, { x: 3, y: 4, scale: 0.8 });
  assert.deepEqual(state.selection, { type: 'node', id: 'file:a', line: 2 });
  assert.equal(state.relationMode, 'focus');
  assert.equal(state.navigation.scopeId, 'scope:a');
  assert.equal(reconcileNavigation(state.navigation, [{ id: 'scope:a', hasChildren: true }]).scopeId, 'scope:a');
  assert.equal(reconcileNavigation(state.navigation, []).scopeId, null);
  assert.equal(state.source, undefined);
});
