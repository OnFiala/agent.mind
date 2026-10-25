import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedEdge, refreshSymbolSelection, layoutGraph, layerMembership, findNodes, fitCamera, shouldAcceptRuntime, displayGraph, layoutOverview, overviewCamera, selectedDisplayId, routeEdge, nodeSize, segmentCrossesRect, edgePresentation, sharedSegmentLength, createNavigationState, navigateScope, backScope, reconcileNavigation, decorateScope, layoutScope, sectionGroups, relationFocus, fitScopeCamera, layoutAreas, areaSearch, expandForPart, areaDirections, connectorLabel } from '../public/visualizer.js';
import { projectAreas } from '../public/hierarchy.mjs';

const nodes = [
  { id: 'server', label: 'server.mjs', path: 'server.mjs', kind: 'source', layers: ['project', 'security'], security: [{ label: 'loopback listener' }], symbols: [{ name: 'createServer' }] },
  { id: 'index', label: 'code-index.mjs', path: 'code-index.mjs', kind: 'source', layers: ['project'], symbols: [{ name: 'resolveImport' }] },
  { id: 'view', label: 'visualizer.js', path: 'public/visualizer.js', kind: 'source', layers: ['project'], symbols: [] },
  { id: 'test', label: 'index.test.mjs', path: 'test/index.test.mjs', kind: 'test', layers: ['project', 'testing'], symbols: [] },
  { id: 'external', label: 'node:http', path: null, kind: 'external', layers: ['project'], symbols: [] },
];
const edges = [
  { id: 'import', from: 'server', to: 'index', layers: ['project'] },
  { id: 'test-import', from: 'test', to: 'index', layers: ['project', 'testing'] },
  { id: 'security-context', from: 'server', to: 'external', layers: ['project', 'security'] },
];
const graph = { nodes, edges };

test('layers retain the complete structure and emphasize real link endpoints', () => {
  const all = layerMembership(graph, 'project');
  assert.deepEqual([...all.nodes].sort(), nodes.map(node => node.id).sort());
  assert.equal(all.edges.size, 3);
  const testing = layerMembership(graph, 'testing');
  assert.deepEqual([...testing.nodes].sort(), ['index', 'test']);
  assert.deepEqual([...testing.edges], ['test-import']);
  const security = layerMembership(graph, 'security');
  assert.deepEqual([...security.nodes].sort(), ['external', 'server']);
  assert.deepEqual([...security.edges], ['security-context']);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 3);
});

test('initial layout is deterministic and cards never overlap across a larger project', () => {
  const project = Array.from({ length: 76 }, (_, index) => ({ id: `file-${index}`, label: `${index}.mjs`, path: `${index % 3 ? 'lib/' : ''}${index}.mjs`, kind: index % 5 === 0 ? 'test' : 'source' }));
  const first = layoutGraph(project);
  const second = layoutGraph([...project].reverse());
  for (const node of project) assert.deepEqual(first.positions.get(node.id), second.positions.get(node.id));
  const points = [...first.positions.values()];
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    assert.ok(Math.abs(points[a].x - points[b].x) >= 224 || Math.abs(points[a].y - points[b].y) >= 94);
  }
});

test('live reconciliation preserves manual positions, drops removed files, and finds space for new files', () => {
  const first = layoutGraph(nodes);
  first.positions.set('server', { x: 812, y: 222 });
  const nextNodes = [...nodes.filter(node => node.id !== 'test'), { id: 'added', label: 'a.mjs', path: 'a.mjs', kind: 'source' }];
  const next = layoutGraph(nextNodes, first.positions);
  for (const node of nodes.filter(node => node.id !== 'test')) assert.deepEqual(next.positions.get(node.id), first.positions.get(node.id));
  assert.equal(next.positions.has('test'), false);
  assert.ok(next.positions.has('added'));
  const added = next.positions.get('added');
  for (const [id, point] of next.positions) if (id !== 'added') assert.ok(Math.abs(added.x - point.x) >= 224 || Math.abs(added.y - point.y) >= 94);
});

test('search reaches every path, symbol and external dependency with conjunctive terms', () => {
  assert.deepEqual([...findNodes(graph, 'resolveimport')], ['index']);
  assert.deepEqual([...findNodes(graph, 'PUBLIC visualizer')], ['view']);
  assert.deepEqual([...findNodes(graph, 'node:http')], ['external']);
  assert.equal(findNodes(graph, 'server resolveImport').size, 0);
  assert.equal(findNodes(graph, '   ').size, 0);
  const vocabulary = { nodes: [{ id: 'live', label: 'Živé změny', aliases: ['live-index'] }, { id: 'index', label: 'Index kódu', aliases: ['indexer'] }] };
  assert.deepEqual([...findNodes(vocabulary, 'zive zmeny')], ['live']);
  assert.deepEqual([...findNodes(vocabulary, 'LIVE_INDEX')], ['live']);
  assert.deepEqual([...findNodes(vocabulary, 'INDEXER')], ['index']);
});

test('fit has finite camera coordinates and keeps ordinary cards within the usable canvas', () => {
  const positions = layoutGraph(nodes).positions;
  const camera = fitCamera(positions, 1440, 900);
  assert.ok(camera.scale > 0 && camera.scale <= 1);
  for (const point of positions.values()) {
    assert.ok(point.x * camera.scale + camera.x >= 112 - .001);
    assert.ok((point.x + 224) * camera.scale + camera.x <= 1350 + .001);
    assert.ok(point.y * camera.scale + camera.y >= 155 - .001);
    assert.ok((point.y + 94) * camera.scale + camera.y <= 730 + .001);
  }
  const empty = fitCamera(new Map(), 320, 500);
  assert.ok(Object.values(empty).every(Number.isFinite));
});

test('narrow layouts use three compact columns instead of spreading folder groups horizontally', () => {
  const project = Array.from({ length: 27 }, (_, index) => ({ id: `file-${index}`, label: `${index}.mjs`, path: `${index % 4 ? `folder-${index % 4}/` : ''}${index}.mjs`, kind: index > 15 ? 'external' : index % 5 === 0 ? 'test' : 'source' }));
  const { positions } = layoutGraph(project, new Map(), { columns: 3 });
  assert.ok(Math.max(...[...positions.values()].map(point => point.x)) <= 2 * (224 + 42));
  const camera = fitCamera(positions, 659, 959);
  assert.ok(camera.scale >= .4, `Readable narrow canvas fit: ${camera.scale}`);
});

test('server restart may reset sequence while stale updates from the same instance stay rejected', () => {
  const before = { instanceId: 'before-restart', sequence: 200 };
  assert.equal(shouldAcceptRuntime(before, { instanceId: 'before-restart', sequence: 199 }), false);
  assert.equal(shouldAcceptRuntime(before, { instanceId: 'before-restart', sequence: 200 }), true);
  assert.equal(shouldAcceptRuntime(before, { instanceId: 'after-restart', sequence: 1 }), true);
  assert.equal(shouldAcceptRuntime(null, { instanceId: 'first-connect', sequence: 0 }), true);
});

const overviewGraph = {
  ...graph,
  overview: {
    nodes: [
      { id: 'block:server', label: 'Server', type: 'service', group: 'core', aliases: ['API'], fileIds: ['server'], description: 'Poskytuje mapu.' },
      { id: 'block:code-index', label: 'Index kódu', type: 'process', group: 'core', aliases: ['čtení kódu'], fileIds: ['index'], description: 'Čte zdroje.' },
      { id: 'block:canvas', label: 'Mapa', type: 'interface', group: 'core', aliases: ['plátno'], fileIds: ['view'], description: 'Zobrazuje vazby.' },
      { id: 'block:tests', label: 'Testy', type: 'tests', group: 'tests', fileIds: ['test'], description: 'Scénáře.' },
    ],
    edges: [
      { id: 'blocks:import', from: 'block:server', to: 'block:code-index', label: 'používá', sourceEdgeIds: ['import'], provenance: 'source' },
      { id: 'blocks:test', from: 'block:tests', to: 'block:code-index', label: 'ověřuje', sourceEdgeIds: ['test-import'], provenance: 'source' },
      { id: 'blocks:contract', from: 'block:canvas', to: 'block:server', label: 'čte mapu', sourceEdgeIds: [], provenance: 'declared-contract' },
    ],
  },
};

test('overview retains real file search and source-derived layer evidence without adding external cards', () => {
  const display = displayGraph(overviewGraph);
  assert.equal(display.mode, 'blocks');
  assert.equal(display.nodes.length, 4);
  assert.equal(display.nodes.some(node => node.id === 'external'), false);
  assert.deepEqual([...findNodes(display, 'resolveimport')], ['block:code-index']);
  assert.deepEqual([...findNodes(display, 'public/visualizer.js')], ['block:canvas']);
  assert.deepEqual([...findNodes(display, 'platno')], ['block:canvas']);
  assert.deepEqual([...findNodes(display, 'API')], ['block:server']);
  assert.deepEqual([...layerMembership(display, 'testing').edges], ['blocks:test']);
  assert.deepEqual([...layerMembership(display, 'security').nodes], ['block:server']);
  assert.equal(layerMembership(display, 'security').edges.has('blocks:contract'), false);
  assert.equal(displayGraph(overviewGraph, 'files').nodes, nodes);
  assert.equal(displayGraph(graph).mode, 'files');
  assert.equal(overviewGraph.nodes.length, 5);
});

test('raw source selection remains associated with its overview block across layer projections', () => {
  const display = displayGraph(overviewGraph);
  assert.equal(selectedDisplayId({ type: 'node', id: 'view' }, display), 'block:canvas');
  assert.equal(selectedDisplayId({ type: 'block', id: 'block:server' }, display), 'block:server');
  for (const view of ['project', 'security', 'testing']) {
    layerMembership(display, view);
    assert.equal(selectedDisplayId({ type: 'node', id: 'view' }, display), 'block:canvas');
  }
  assert.equal(selectedDisplayId({ type: 'node', id: 'deleted' }, display), null);
});

test('overview starts readable on a narrow canvas and retains manual positions on reconciliation', () => {
  const display = displayGraph(overviewGraph);
  const layout = layoutOverview(display.nodes, new Map(), 2);
  const camera = overviewCamera(layout.positions, 375, 600);
  assert.ok(camera.scale >= .85);
  layout.positions.set('block:server', { x: 901, y: 301 });
  const next = layoutOverview(display.nodes, layout.positions, 3);
  assert.deepEqual(next.positions.get('block:server'), { x: 901, y: 301 });
  for (const node of display.nodes) assert.deepEqual(next.positions.get(node.id), layout.positions.get(node.id));
});

test('orthogonal routes stay outside card interiors and keep an explicit directional endpoint', () => {
  const routeNodes = ['a', 'blocker', 'b', 'c'].map(id => ({ id, kind: 'block', group: 'core' }));
  const positions = new Map([['a', { x: 0, y: 0 }], ['blocker', { x: 356, y: 0 }], ['b', { x: 712, y: 0 }], ['c', { x: 356, y: 244 }]]);
  for (const edge of [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a' }]) {
    const route = routeEdge(edge, routeNodes, positions);
    assert.equal(route.obstructed, false);
    assert.ok(route.path.startsWith('M'));
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index];
      assert.ok(a.x === b.x || a.y === b.y);
      for (const node of routeNodes) assert.equal(segmentCrossesRect(a, b, { ...positions.get(node.id), ...nodeSize(node) }), false);
    }
    const destination = positions.get(edge.to);
    const endpoint = route.points.at(-1);
    assert.ok(endpoint.x === destination.x || endpoint.x === destination.x + 260 || endpoint.y === destination.y || endpoint.y === destination.y + 136);
    assert.ok(Number.isFinite(route.label.x) && Number.isFinite(route.label.y));
  }
});

test('test references stay available but their labels are quiet until relevant, while transport remains named', () => {
  const display = displayGraph(overviewGraph);
  const testEdge = display.edges.find(edge => edge.id === 'blocks:test');
  assert.deepEqual(edgePresentation(testEdge, display), { testing: true, subdued: true, labelVisible: false });
  assert.deepEqual(edgePresentation(testEdge, display, 'testing'), { testing: true, subdued: false, labelVisible: true });
  assert.equal(edgePresentation(testEdge, display, 'project', { type: 'block', id: 'block:code-index' }).subdued, false);
  assert.equal(edgePresentation(testEdge, display, 'project', { type: 'edge', id: testEdge.id }).labelVisible, true);
  const contract = { ...display.edges.find(edge => edge.id === 'blocks:contract'), kind: 'contract' };
  assert.equal(edgePresentation(contract, display).labelVisible, true);
  assert.equal(edgePresentation(display.edges.find(edge => edge.id === 'blocks:import'), display).labelVisible, false);
  assert.equal(display.edges.length, 3);
});

test('grouped project routes separate shared lanes and clear unrelated cards by ten pixels', () => {
  // The eight-block production topology that originally overlapped test routes.
  const groupedNodes = ['canvas', 'server', 'live-index', 'agent-context', 'code-index', 'tests', 'settings', 'docs'].map(id => ({ id: `block:${id}`, label: id, kind: 'block', type: id === 'tests' ? 'tests' : 'process', group: ['settings', 'docs'].includes(id) ? 'support' : id === 'tests' ? 'tests' : 'core' }));
  const groupedEdges = [
    ['canvas', 'server'], ['server', 'live-index'], ['server', 'agent-context'], ['agent-context', 'code-index'], ['server', 'code-index'], ['live-index', 'code-index'],
    ['tests', 'code-index'], ['tests', 'live-index'], ['tests', 'server'], ['tests', 'canvas'], ['tests', 'agent-context'],
  ].map(([from, to], index) => ({ id: String(index), from: `block:${from}`, to: `block:${to}` }));
  const { positions } = layoutOverview(groupedNodes, new Map(), 2);
  const baseline = groupedEdges.map((edge, index) => routeEdge(edge, groupedNodes, positions, index));
  const separated = [];
  groupedEdges.forEach((edge, index) => separated.push(routeEdge(edge, groupedNodes, positions, index, separated)));
  const totalShared = routes => routes.reduce((total, route, i) => total + routes.slice(0, i).reduce((sum, other) => sum + route.points.slice(1).reduce((subtotal, b, j) => subtotal + other.points.slice(1).reduce((n, d, k) => n + sharedSegmentLength(route.points[j], b, other.points[k], d, 1), 0), 0), 0), 0);
  assert.ok(totalShared(separated) < totalShared(baseline));
  for (const [index, route] of separated.entries()) {
    assert.equal(route.obstructed, false);
    for (const node of groupedNodes.filter(node => ![groupedEdges[index].from, groupedEdges[index].to].includes(node.id))) {
      const rect = { ...positions.get(node.id), ...nodeSize(node) };
      const clearance = { x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 };
      for (let point = 1; point < route.points.length; point++) assert.equal(segmentCrossesRect(route.points[point - 1], route.points[point], clearance), false);
    }
  }
});

test('recursive navigation captures independent scope views and back restores camera, positions and selection', () => {
  const rootView = { positions: new Map([['block:canvas', { x: 12, y: 24 }]]), camera: { x: 50, y: 60, scale: .9 }, selection: { type: 'block', id: 'block:server' } };
  const fileView = { positions: new Map([['file:public/visualizer.js', { x: 80, y: 90 }]]), camera: { x: -320, y: 125, scale: 1.3 }, selection: null };
  const symbolView = { positions: new Map([['symbol:public/visualizer.js#startVisualizer', { x: 220, y: 144 }]]), camera: { x: 60, y: -210, scale: 1 }, selection: { type: 'node', id: 'view', partId: 'symbol:public/visualizer.js#startVisualizer' } };
  let navigation = createNavigationState();
  navigation = navigateScope(navigation, 'block:canvas', rootView);
  navigation = navigateScope(navigation, 'file:public/visualizer.js', fileView);
  navigation = navigateScope(navigation, 'symbol:public/visualizer.js#startVisualizer', symbolView);
  rootView.positions.get('block:canvas').x = 999;
  assert.equal(navigation.snapshots.get(null).positions.get('block:canvas').x, 12);
  navigation = backScope(navigation, { positions: new Map(), camera: { x: 1, y: 2, scale: .9 }, selection: null });
  assert.equal(navigation.scopeId, 'file:public/visualizer.js');
  assert.deepEqual(navigation.snapshots.get(navigation.scopeId).camera, symbolView.camera);
  assert.deepEqual(navigation.snapshots.get(navigation.scopeId).selection, symbolView.selection);
  navigation = backScope(navigation, symbolView);
  assert.equal(navigation.scopeId, 'block:canvas');
  assert.deepEqual(navigation.snapshots.get(navigation.scopeId).positions, fileView.positions);
  navigation = backScope(navigation, fileView);
  assert.equal(navigation.scopeId, null);
  assert.deepEqual(navigation.snapshots.get(null).camera, rootView.camera);
  assert.equal(backScope(navigation, rootView), navigation);
});

test('live removal returns to the nearest surviving scope and prunes stale scope history', () => {
  const hierarchy = [
    { id: 'block:canvas', parentId: null, hasChildren: true },
    { id: 'file:view', parentId: 'block:canvas', hasChildren: true },
    { id: 'symbol:start', parentId: 'file:view', hasChildren: true },
    { id: 'symbol:nested', parentId: 'symbol:start', hasChildren: true },
  ];
  const view = { positions: new Map(), camera: { x: 15, y: 20, scale: 1 }, selection: null };
  let navigation = createNavigationState();
  for (const node of hierarchy) navigation = navigateScope(navigation, node.id, view);
  const next = reconcileNavigation(navigation, hierarchy.slice(0, 2), hierarchy);
  assert.equal(next.scopeId, 'file:view');
  assert.deepEqual(next.history, [null, 'block:canvas']);
  assert.equal(next.snapshots.has('symbol:start'), false);
  assert.match(next.notice, /nearest/);
  const leafFile = reconcileNavigation(next, [{ ...hierarchy[0] }, { ...hierarchy[1], hasChildren: false }], hierarchy);
  assert.equal(leafFile.scopeId, 'block:canvas');
  const root = reconcileNavigation(leafFile, [], hierarchy);
  assert.equal(root.scopeId, null);
});

test('scope decoration keeps source roles, separates context, and selects exact symbol leaves', () => {
  const scoped = decorateScope({ nodes: [
    { id: 'symbol:first', kind: 'symbol', type: 'process', group: 'core', label: 'První', fileIds: ['view'], line: 10 },
    { id: 'symbol:second', kind: 'symbol', type: 'process', group: 'core', label: 'Druhá', fileIds: ['view'], line: 30 },
    { id: 'boundary:server', kind: 'boundary', type: 'module', group: 'context', label: 'Server', targetId: 'block:server', fileIds: ['server'], hasChildren: true },
  ], edges: [] }, graph);
  assert.equal(scoped.nodes[0].hierarchyKind, 'symbol');
  assert.equal(selectedDisplayId({ type: 'node', id: 'view', partId: 'symbol:second' }, scoped), 'symbol:second');
  assert.equal(selectedDisplayId({ type: 'node', id: 'view' }, scoped), null);
  const layout = layoutScope(scoped.nodes, new Map(), 2);
  assert.ok(layout.positions.get('boundary:server').x > layout.positions.get('symbol:second').x + 260);
  assert.equal(scoped.nodes[2].targetId, 'block:server');
});

test('deep sections are ordered, counted and nonoverlapping while root layout stays unchanged', () => {
  const parts = Array.from({ length: 14 }, (_, i) => ({ id: `part:${i}`, label: `Část ${i}`, kind: 'block', hierarchyKind: 'symbol', group: 'core', line: i * 10, section: i < 4 ? 'Details' : i < 8 ? 'Navigation' : i < 12 ? 'Rendering' : undefined }));
  parts.push({ id: 'outside', label: 'Server', kind: 'block', hierarchyKind: 'boundary', group: 'context' });
  const groups = sectionGroups(parts);
  assert.deepEqual(groups.map(group => group.label), ['Navigation', 'Rendering', 'Details', 'Other parts', 'Outside']);
  assert.equal(groups.reduce((count, group) => count + group.count, 0), parts.length);
  const layout = layoutScope(parts, new Map(), 2);
  assert.deepEqual(layout.groups.map(group => group.count), [4, 4, 4, 2, 1]);
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    const first = { ...layout.positions.get(parts[a].id), ...nodeSize(parts[a]) }, second = { ...layout.positions.get(parts[b].id), ...nodeSize(parts[b]) };
    assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y);
  }
  layout.positions.set('part:0', { x: 120, y: 150 });
  const next = layoutScope([...parts, { id: 'new', label: 'Nová část', kind: 'block', hierarchyKind: 'symbol', group: 'core', section: 'Details' }], layout.positions, 2);
  for (const part of parts) assert.deepEqual(next.positions.get(part.id), layout.positions.get(part.id));
  const root = displayGraph(overviewGraph).nodes;
  assert.deepEqual(layoutScope(root).positions, layoutOverview(root).positions);
  assert.equal(layoutScope(root).groups.length, 0);
});

test('dense relation focus shows only actual adjacent edges and preserves selected edges after hover leaves', () => {
  const display = { mode: 'blocks', nodes: Array.from({ length: 14 }, (_, i) => ({ id: String(i) })), edges: [{ id: 'a', from: '0', to: '1' }, { id: 'b', from: '1', to: '2' }, { id: 'c', from: '3', to: '4' }] };
  const empty = relationFocus(display);
  assert.equal(empty.mode, 'focus');
  assert.equal(empty.visible.size, 0);
  assert.equal(empty.total, 3);
  const hovered = relationFocus(display, { hoverNode: '1' });
  assert.deepEqual([...hovered.visible], ['a', 'b']);
  assert.deepEqual([...relationFocus(display, { focusNode: '1' }).visible], ['a', 'b']);
  assert.deepEqual([...relationFocus(display, { selection: { type: 'edge', id: 'c' } }).visible], ['c']);
  assert.equal(relationFocus(display, { mode: 'all' }).visible.size, 3);
  assert.equal(relationFocus({ ...display, nodes: display.nodes.slice(0, 5) }).mode, 'all');
  assert.equal(display.edges.length, 3);
});

test('symbol source-name search matches the real part rather than every sibling in the same file', () => {
  const raw = { nodes: [{ id: 'file:map', path: 'map.js', symbols: [{ name: 'drawCards' }, { name: 'loadSource' }], security: [] }] };
  const display = decorateScope({ nodes: [
    { id: 'symbol:draw', kind: 'symbol', label: 'Karty', sourceName: 'drawCards', qualifiedName: 'start.drawCards', path: 'map.js', aliases: [], fileIds: ['file:map'] },
    { id: 'symbol:source', kind: 'symbol', label: 'Zdroj', sourceName: 'loadSource', qualifiedName: 'start.loadSource', path: 'map.js', aliases: [], fileIds: ['file:map'] },
  ], edges: [] }, raw);
  assert.deepEqual([...findNodes(display, 'drawCards')], ['symbol:draw']);
  assert.deepEqual([...findNodes(display, 'start.loadSource')], ['symbol:source']);
});

test('explicit fit includes the entire deep scope while initial camera remains readable', () => {
  const parts = [{ id: 'one', kind: 'block', hierarchyKind: 'symbol', group: 'core' }, { id: 'two', kind: 'block', hierarchyKind: 'symbol', group: 'core' }];
  const positions = new Map([['one', { x: 0, y: 0 }], ['two', { x: 1600, y: 4000 }]]);
  const camera = fitScopeCamera(parts, positions, 659, 959);
  for (const part of parts) {
    const point = positions.get(part.id), size = nodeSize(part);
    assert.ok(point.x * camera.scale + camera.x >= 56 - .01);
    assert.ok((point.x + size.width) * camera.scale + camera.x <= 603 + .01);
    assert.ok((point.y + size.height) * camera.scale + camera.y <= 924 + .01);
  }
  assert.ok(overviewCamera(positions, 659, 959).scale >= .85);
});

const areaRaw = { nodes: [{ id: 'file:map.js', path: 'map.js', label: 'map.js', hash: 'current-file-hash', symbols: [{ name: 'drawCards' }, { name: 'drawEdges' }, { name: 'loadSource' }], security: [] }] };
const areaScope = {
  scopeId: 'file:map.js', scopeNode: { id: 'file:map.js', kind: 'file' },
  nodes: [
    { id: 'symbol:cards', sourceId: 'symbol:cards', kind: 'symbol', label: 'Cards', sourceName: 'drawCards', path: 'map.js', line: 10, endLine: 20, section: 'Rendering', sectionId: 'rendering', fileIds: ['file:map.js'], group: 'core', type: 'process', layers: ['project'] },
    { id: 'symbol:edges', sourceId: 'symbol:edges', kind: 'symbol', label: 'Edges', sourceName: 'drawEdges', path: 'map.js', line: 30, endLine: 40, section: 'Rendering', sectionId: 'rendering', fileIds: ['file:map.js'], group: 'core', type: 'process', layers: ['project'] },
    { id: 'symbol:source', sourceId: 'symbol:source', kind: 'symbol', label: 'Source', sourceName: 'loadSource', path: 'map.js', line: 50, endLine: 60, section: 'Source', sectionId: 'source', fileIds: ['file:map.js'], group: 'core', type: 'process', layers: ['project'] },
    { id: 'boundary:server', kind: 'boundary', label: 'Server', targetId: 'block:server', fileIds: [], group: 'context', type: 'module', layers: ['project'] },
  ],
  edges: [
    { id: 'part:internal', from: 'symbol:cards', to: 'symbol:edges', kind: 'call', label: 'calls', sourceEdgeIds: ['call:1'], evidence: [{ path: 'map.js', line: 12, snippet: 'drawEdges();' }], layers: ['project'] },
    { id: 'part:source', from: 'symbol:cards', to: 'symbol:source', kind: 'call', label: 'calls', sourceEdgeIds: ['call:2'], evidence: [{ path: 'map.js', line: 15, snippet: 'loadSource();' }], layers: ['project'] },
    { id: 'part:outside', from: 'symbol:source', to: 'boundary:server', kind: 'contract', label: 'HTTP', sourceEdgeIds: ['http:1'], evidence: [{ path: 'map.js', line: 53, snippet: 'fetch("/api/source")' }], layers: ['project'] },
  ],
};

test('collapsed areas retain internal evidence, expand inline, and search reveals the exact hidden source part', () => {
  const collapsed = decorateScope(projectAreas(areaScope), areaRaw);
  assert.equal(collapsed.nodes.length, 3);
  assert.equal(collapsed.edges.length, 2);
  const rendering = collapsed.areas.find(area => area.sectionId === 'rendering');
  assert.deepEqual(rendering.internalEdgeIds, ['part:internal']);
  assert.equal(collapsed.partEdges.find(edge => edge.id === rendering.internalEdgeIds[0]).evidence[0].line, 12);
  const search = areaSearch(collapsed, 'drawEdges', areaRaw);
  assert.deepEqual([...search.targets], ['symbol:edges']);
  assert.deepEqual([...search.visible], [rendering.id]);
  const expandedIds = expandForPart(collapsed, 'symbol:edges', new Set());
  const mixed = decorateScope(projectAreas(areaScope, expandedIds), areaRaw);
  assert.equal(mixed.scopeId, collapsed.scopeId);
  assert.equal(mixed.nodes.some(node => node.id === 'symbol:edges'), true);
  assert.equal(mixed.nodes.some(node => node.isArea && node.sectionId === 'source'), true);
  const part = mixed.nodes.find(node => node.id === 'symbol:edges');
  const source = areaRaw.nodes.find(node => node.path === part.path);
  assert.equal(source.hash, 'current-file-hash');
  assert.equal(part.sourceId, 'symbol:edges');
  assert.equal(part.line, 30);
  const selection = { type: 'node', id: source.id, partId: part.id };
  assert.equal(selectedDisplayId(selection, mixed), part.id);
  assert.equal(selectedDisplayId(selection, collapsed), rendering.id);
  assert.equal(mixed.edges.some(edge => edge.scopeEdgeIds.includes('part:internal')), true);
});

test('area expansion and mixed source selection survive scope back without sharing mutable sets', () => {
  const collapsed = decorateScope(projectAreas(areaScope), areaRaw);
  const ids = expandForPart(collapsed, 'symbol:cards', new Set());
  const mixed = decorateScope(projectAreas(areaScope, ids), areaRaw);
  const positions = layoutAreas(mixed, new Map(), 2).positions;
  const selection = { type: 'node', id: 'file:map.js', partId: 'symbol:cards', line: 10 };
  let navigation = navigateScope(createNavigationState(), areaScope.scopeId, { positions: new Map(), camera: { x: 0, y: 0, scale: 1 } });
  navigation = navigateScope(navigation, 'symbol:cards', { positions, camera: { x: 55, y: -120, scale: .9 }, selection, expandedAreaIds: ids });
  ids.clear();
  navigation = backScope(navigation, { positions: new Map(), expandedAreaIds: new Set() });
  const saved = navigation.snapshots.get(areaScope.scopeId);
  assert.equal(saved.expandedAreaIds.size, 1);
  assert.deepEqual(saved.selection, selection);
  assert.deepEqual(saved.positions, positions);
  assert.deepEqual(saved.camera, { x: 55, y: -120, scale: .9 });
  const restored = decorateScope(projectAreas(areaScope, saved.expandedAreaIds), areaRaw);
  assert.equal(selectedDisplayId(saved.selection, restored), 'symbol:cards');
});

test('fully collapsed dense area maps show all aggregate relations by default and keep a compact nonoverlapping layout', () => {
  const parts = Array.from({ length: 9 }, (_, i) => ({ id: `part:${i}`, kind: 'symbol', label: `Part ${i}`, section: `Area ${i}`, sectionId: `area-${i}`, type: 'process', group: 'core', fileIds: [], layers: ['project'] }));
  const edges = parts.flatMap((part, i) => ['call', 'dependency', 'contract'].map(kind => ({ id: `${kind}:${i}`, from: part.id, to: parts[(i + 1) % parts.length].id, kind, evidence: [], layers: ['project'] })));
  const display = decorateScope(projectAreas({ scopeId: 'dense', scopeNode: { kind: 'symbol' }, nodes: parts, edges }), { nodes: [] });
  const policy = relationFocus(display);
  assert.equal(policy.dense, true);
  assert.equal(policy.mode, 'all');
  assert.equal(policy.visible.size, 27);
  const layout = layoutAreas(display, new Map(), 3);
  assert.equal(layout.positions.size, 9);
  assert.ok(Math.max(...[...layout.positions.values()].map(point => point.y)) < 500);
  for (let a = 0; a < display.nodes.length; a++) for (let b = a + 1; b < display.nodes.length; b++) {
    const first = layout.positions.get(display.nodes[a].id), second = layout.positions.get(display.nodes[b].id);
    assert.ok(Math.abs(first.x - second.x) >= 260 || Math.abs(first.y - second.y) >= 136);
  }
});

test('area direction uses full membership for collapsed, mixed and expanded endpoints', () => {
  const scope = { ...areaScope, edges: [...areaScope.edges, { id: 'part:reverse', from: 'symbol:source', to: 'symbol:cards', kind: 'call', label: 'calls', sourceEdgeIds: ['call:reverse'], evidence: [], layers: ['project'] }] };
  const collapsed = decorateScope(projectAreas(scope), areaRaw);
  const rendering = collapsed.areas.find(area => area.sectionId === 'rendering');
  const source = collapsed.areas.find(area => area.sectionId === 'source');
  const direction = areaDirections(collapsed, rendering.id);
  assert.equal(direction.outgoing.length, 1);
  assert.equal(direction.incoming.length, 1);
  assert.equal(direction.internal.length, 0);
  assert.deepEqual([...direction.selectedNodes], [rendering.id]);
  assert.deepEqual([...direction.neighbors], [source.id]);
  assert.equal(direction.directions.get(collapsed.edges.find(edge => edge.scopeEdgeIds.includes('part:outside')).id), 'unrelated');
  const mixed = decorateScope(projectAreas(scope, new Set([rendering.id, source.id])), areaRaw);
  const expandedDirection = areaDirections(mixed, rendering.id);
  assert.equal(expandedDirection.internal.length, 1);
  assert.equal(expandedDirection.outgoing.length, 1);
  assert.equal(expandedDirection.incoming.length, 1);
  assert.deepEqual([...expandedDirection.selectedNodes].sort(), ['symbol:cards', 'symbol:edges']);
  assert.deepEqual([...expandedDirection.neighbors], ['symbol:source']);
  assert.equal(mixed.partEdges.length, 4);
});

test('pinned area ignores unrelated hover and remains selected while a contributing edge is inspected', () => {
  const display = decorateScope(projectAreas(areaScope), areaRaw);
  const rendering = display.areas.find(area => area.sectionId === 'rendering');
  const outside = display.areas.find(area => area.context);
  const outgoing = display.edges.find(edge => edge.scopeEdgeIds.includes('part:source'));
  const unrelated = display.edges.find(edge => edge.scopeEdgeIds.includes('part:outside'));
  const pinned = relationFocus(display, { mode: 'focus', focusedAreaId: rendering.id });
  const hovered = relationFocus(display, { mode: 'focus', focusedAreaId: rendering.id, hoverNode: outside.id, focusNode: outside.id, hoverEdge: unrelated.id, selection: { type: 'edge', id: outgoing.id } });
  assert.deepEqual(hovered.emphasized, pinned.emphasized);
  assert.deepEqual(hovered.visible, pinned.visible);
  assert.equal(hovered.directional.area.id, rendering.id);
  assert.equal(hovered.visible.has(outgoing.id), true);
  assert.equal(hovered.visible.has(unrelated.id), false);
  assert.equal(areaDirections(display, 'removed-area').area, null);
});

test('pinned area survives scope back independently of the inspected edge selection', () => {
  const display = decorateScope(projectAreas(areaScope), areaRaw);
  const area = display.areas.find(area => area.sectionId === 'rendering');
  const view = { positions: layoutAreas(display).positions, camera: { x: 20, y: 30, scale: .8 }, focusedAreaId: area.id, selection: { type: 'edge', id: display.edges[0].id } };
  let navigation = navigateScope(createNavigationState(), areaScope.scopeId, {});
  navigation = navigateScope(navigation, 'symbol:cards', view);
  navigation = backScope(navigation, {});
  const restored = navigation.snapshots.get(areaScope.scopeId);
  assert.equal(restored.focusedAreaId, area.id);
  assert.deepEqual(restored.selection, view.selection);
  assert.deepEqual(restored.camera, view.camera);
});

test('connector captions always identify named endpoints, kind and exact unique source reference count', () => {
  const display = decorateScope(projectAreas(areaScope), areaRaw);
  const edge = display.edges.find(edge => edge.scopeEdgeIds.includes('part:source'));
  assert.equal(connectorLabel(edge, display), 'Rendering → Source · call · 1 source relation');
  assert.equal(connectorLabel({ ...edge, sourceEdgeIds: ['one', 'one', 'two'] }, display), 'Rendering → Source · call · 2 source relations');
  const expanded = decorateScope(projectAreas(areaScope, new Set(display.areas.map(area => area.id))), areaRaw);
  const internal = expanded.edges.find(edge => edge.scopeEdgeIds.includes('part:internal'));
  assert.equal(connectorLabel(internal, expanded), 'Cards → Edges · call · 1 source relation');
});


test('symbol selections follow current source ranges, including saved Back selections', () => {
  const selection = { type: 'node', id: 'file:app.mjs', partId: 'symbol:run', line: 4, endLine: 7 };
  const current = { hierarchy: { nodes: [{ id: 'symbol:run', line: 14, endLine: 19 }] } };
  const display = { nodes: [] };
  const next = refreshSymbolSelection(selection, current, display);
  assert.equal(next.line, 14);
  assert.equal(next.endLine, 19);
  assert.equal(next.partId, selection.partId);
  assert.equal(selection.line, 4);
  let navigation = navigateScope(createNavigationState(), 'file:app.mjs', { selection });
  navigation = backScope(navigation, {});
  assert.deepEqual(refreshSymbolSelection(navigation.snapshots.get(null).selection, current, display), next);
});

test('refreshing a symbol range preserves an explicitly chosen source cursor and ordinary file selections', () => {
  const graph = { hierarchy: { nodes: [{ id: 'symbol:run', line: 14, endLine: 19 }] } };
  const manual = { type: 'node', id: 'file:app.mjs', partId: 'symbol:run', line: 5, endLine: 7, manualLine: true };
  assert.deepEqual(refreshSymbolSelection(manual, graph, { nodes: [] }), { ...manual, endLine: 19 });
  const fileSelection = { type: 'node', id: 'file:app.mjs', line: 5 };
  assert.equal(refreshSymbolSelection(fileSelection, graph, { nodes: [] }), fileSelection);
  assert.equal(refreshSymbolSelection(null, graph, { nodes: [] }), null);
  assert.equal(refreshSymbolSelection(manual, { hierarchy: { nodes: [] } }, { nodes: [] }), manual);
});


test('overview relations remain selected from deep scopes across unrelated refreshes and disappear when removed', () => {
  const relation = { id: 'overview:app-helper', from: 'block:app', to: 'block:helper', sourceEdgeIds: ['import'] };
  const overview = { nodes: [{ id: 'block:app', fileIds: ['server'] }, { id: 'block:helper', fileIds: ['index'] }], edges: [relation] };
  const current = { ...graph, overview };
  const deepDisplay = { nodes: [{ id: 'symbol:run' }], edges: [], partEdges: [] };
  assert.equal(selectedEdge(relation.id, current, deepDisplay)?.id, relation.id);
  assert.equal(selectedEdge(relation.id, { ...current, revision: 'unrelated-update' }, deepDisplay)?.id, relation.id);
  assert.equal(selectedEdge(relation.id, { ...current, overview: { ...overview, edges: [] } }, deepDisplay), undefined);
  assert.equal(selectedEdge(relation.id, { ...current, overview: { ...overview, nodes: overview.nodes.slice(0, 1) } }, deepDisplay), undefined);
  assert.equal(selectedEdge('import', current, deepDisplay), edges[0]);
  const local = { id: 'local' };
  assert.equal(selectedEdge('local', current, { ...deepDisplay, edges: [local] }), local);
  assert.equal(selectedEdge('local', current, { ...deepDisplay, partEdges: [local] }), local);
});
