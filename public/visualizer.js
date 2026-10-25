const CARD = { width: 224, height: 94, gapX: 42, gapY: 30 };
const KIND = { source: 'source', test: 'test', asset: 'asset', config: 'config', document: 'document', external: 'external' };
const GLYPH = { source: '{ }', test: 'T', asset: '◫', config: '⚙', document: '≡', external: '↗' };
const BLOCK_TYPES = { interface: 'Interface', service: 'Service', process: 'Process', tests: 'Tests', config: 'Settings', document: 'Documentation', module: 'Module' };

export function createNavigationState() { return { scopeId: null, history: [], snapshots: new Map(), notice: null }; }

function copyView(view) {
  return { positions: new Map([...(view?.positions || [])].map(([id, point]) => [id, { ...point }])), camera: view?.camera ? { ...view.camera } : null, selection: view?.selection ? { ...view.selection } : null, relationMode: view?.relationMode || 'auto', expandedAreaIds: new Set(view?.expandedAreaIds || []), focusedAreaId: view?.focusedAreaId || null };
}

export function navigateScope(navigation, targetId, view) {
  if (navigation.scopeId === targetId) return navigation;
  const snapshots = new Map(navigation.snapshots);
  snapshots.set(navigation.scopeId, copyView(view));
  return { scopeId: targetId, history: [...navigation.history, navigation.scopeId], snapshots, notice: null };
}

export function backScope(navigation, view) {
  if (!navigation.history.length) return navigation;
  const snapshots = new Map(navigation.snapshots);
  snapshots.set(navigation.scopeId, copyView(view));
  return { ...navigation, scopeId: navigation.history.at(-1), history: navigation.history.slice(0, -1), snapshots, notice: null };
}

export function reconcileNavigation(navigation, nodes, previousNodes = []) {
  const valid = new Map(nodes.map(node => [node.id, node]));
  const old = new Map(previousNodes.map(node => [node.id, node]));
  let scopeId = navigation.scopeId;
  const visited = new Set();
  while (scopeId !== null && (!valid.has(scopeId) || valid.get(scopeId).hasChildren === false)) {
    if (visited.has(scopeId)) { scopeId = null; break; }
    visited.add(scopeId);
    scopeId = old.get(scopeId)?.parentId ?? null;
  }
  const survives = id => id === null || valid.has(id) && valid.get(id).hasChildren !== false;
  const history = navigation.history.filter(survives);
  while (history.length && history.at(-1) === scopeId) history.pop();
  return { ...navigation, scopeId, history, snapshots: new Map([...navigation.snapshots].filter(([id]) => survives(id))), notice: scopeId !== navigation.scopeId ? 'The open part changed or was removed. Showing its nearest available parent.' : navigation.notice };
}

export function decorateScope(scope, graph) {
  const raw = new Map(graph.nodes.map(node => [node.id, node]));
  return { ...scope, mode: 'blocks', nodes: scope.nodes.map(node => {
    const members = (node.fileIds || []).map(id => raw.get(id)).filter(Boolean);
    const security = node.isArea ? [] : members.flatMap(member => member.security || []).filter(signal => node.kind !== 'symbol' || signal.line >= node.line && signal.line <= node.endLine);
    const sourceNames = node.isArea ? [] : node.kind === 'symbol' ? [node.sourceName, node.qualifiedName] : members.flatMap(member => [member.path, ...(member.symbols || []).map(symbol => symbol.name)]);
    return { ...node, hierarchyKind: node.kind, kind: 'block', security, searchText: [node.kind === 'symbol' ? '' : node.searchText || '', node.sourceName || '', node.qualifiedName || '', ...(node.aliases || []), node.path || '', ...sourceNames].filter(Boolean).join(' ') };
  }) };
}

export function displayGraph(graph, mode = 'blocks') {
  if (mode === 'files' || !graph.overview?.nodes?.length) return { ...graph, mode: 'files' };
  const rawById = new Map(graph.nodes.map(node => [node.id, node]));
  const edgeById = new Map(graph.edges.map(edge => [edge.id, edge]));
  const nodes = graph.overview.nodes.map(block => {
    const members = (block.fileIds || []).map(id => rawById.get(id)).filter(Boolean);
    return { ...block, kind: 'block', security: members.flatMap(node => node.security || []), layers: [...new Set(['project', ...members.flatMap(node => node.layers || [])])], searchText: [...(block.aliases || []), ...members.flatMap(node => [node.path, node.label, ...(node.symbols || []).map(symbol => symbol.name)])].join(' ') };
  });
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.overview.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => ({ ...edge, layers: [...new Set(['project', ...(edge.sourceEdgeIds || []).flatMap(id => edgeById.get(id)?.layers || [])])] }));
  return { ...graph, nodes, edges, mode: 'blocks' };
}

export function nodeSize(node) {
  if (node?.isArea) return { width: 260, height: 136 };
  if (node?.kind === 'block' && node.hierarchyKind && node.hierarchyKind !== 'block') return { width: 260, height: node.hierarchyKind === 'boundary' ? 136 : 156 };
  return node?.kind === 'block' ? { width: 260, height: node.group === 'core' ? 136 : 116 } : CARD;
}

export function selectedDisplayId(selection, display) {
  if (!selection || selection.type === 'edge') return null;
  if (selection.partId) return display.nodes.find(node => node.id === selection.partId || node.isArea && node.memberIds?.includes(selection.partId))?.id || null;
  return display.nodes.find(node => node.id === selection.id)?.id || display.nodes.find(node => (!node.hierarchyKind || node.hierarchyKind === 'block') && node.fileIds?.includes(selection.id))?.id || null;
}

export function sectionGroups(nodes) {
  const grouped = new Map();
  for (const node of nodes) {
    const label = node.hierarchyKind === 'boundary' ? 'Outside' : node.section?.trim() || 'Other parts';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(node);
  }
  const order = ['Entry', 'Interface', 'Navigation', 'Controls', 'Rendering', 'Live data', 'Details', 'Source code', 'Helpers'];
  const rank = label => order.includes(label) ? order.indexOf(label) : 20;
  return [...grouped].map(([label, members]) => ({ id: label, label, nodes: members, count: members.length, context: label === 'Outside' })).sort((a, b) => Number(a.context) - Number(b.context) || Number(a.label === 'Other parts') - Number(b.label === 'Other parts') || rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, 'en'));
}

export function layoutScope(nodes, previous = new Map(), columns = 3, grouped = nodes.some(node => ['file', 'symbol'].includes(node.hierarchyKind))) {
  const internal = nodes.filter(node => node.hierarchyKind !== 'boundary');
  const boundary = nodes.filter(node => node.hierarchyKind === 'boundary');
  const result = grouped ? { positions: new Map(), groups: [] } : layoutOverview(internal, previous, columns);
  if (grouped) {
    let top = 0;
    const occupied = [...previous.values()];
    for (const group of sectionGroups(internal)) {
      const members = [...group.nodes].sort((a, b) => (a.line || 0) - (b.line || 0) || a.label.localeCompare(b.label, 'en'));
      members.forEach((node, index) => {
        const point = previous.has(node.id) ? { ...previous.get(node.id) } : { x: index % columns * 356, y: top + Math.floor(index / columns) * 212 };
        if (!previous.has(node.id)) {
          while (occupied.some(other => Math.abs(point.x - other.x) < 280 && Math.abs(point.y - other.y) < 156)) point.y += 212;
          occupied.push(point);
        }
        result.positions.set(node.id, point);
      });
      const points = members.map(node => result.positions.get(node.id));
      const left = Math.min(...points.map(point => point.x));
      const bottom = Math.max(...members.map(node => result.positions.get(node.id).y + nodeSize(node).height));
      result.groups.push({ id: group.id, label: group.label, count: group.count, x: left, y: Math.min(...points.map(point => point.y)) - 38, width: Math.max(...points.map(point => point.x)) + 260 - left, section: true });
      top = bottom + 100;
    }
  }
  const right = internal.length ? Math.max(...[...result.positions.values()].map(point => point.x)) + 420 : 0;
  boundary.forEach((node, index) => result.positions.set(node.id, previous.has(node.id) ? { ...previous.get(node.id) } : { x: right, y: index * 174 }));
  if (boundary.length) result.groups.push({ id: 'Outside', label: 'Outside', count: boundary.length, x: right, y: -37, width: 260, section: true });
  return result;
}

export function areaDirections(display, focusedAreaId) {
  const area = display.areas?.find(area => area.id === focusedAreaId);
  const selectedNodes = new Set(), neighbors = new Set(), related = new Set(), directions = new Map();
  const incoming = [], outgoing = [], internal = [];
  if (!area) return { area: null, selectedNodes, neighbors, related, directions, incoming, outgoing, internal };
  const members = new Set(area.memberIds);
  const belongs = id => id === area.id || members.has(id) || display.nodes.some(node => node.id === id && node.areaId === area.id);
  for (const node of display.nodes) if (belongs(node.id)) selectedNodes.add(node.id);
  for (const edge of display.edges) {
    const from = belongs(edge.from), to = belongs(edge.to);
    const direction = from && to ? 'internal' : from ? 'outgoing' : to ? 'incoming' : 'unrelated';
    directions.set(edge.id, direction);
    if (direction === 'unrelated') continue;
    related.add(edge.id);
    if (!from) neighbors.add(edge.from);
    if (!to) neighbors.add(edge.to);
    ({ incoming, outgoing, internal })[direction].push(edge);
  }
  return { area, selectedNodes, neighbors, related, directions, incoming, outgoing, internal };
}

export function connectorLabel(edge, display) {
  const from = display.nodes.find(node => node.id === edge.from) || display.partNodes?.find(node => node.id === edge.from) || display.hierarchy?.nodes.find(node => node.id === edge.from);
  const to = display.nodes.find(node => node.id === edge.to) || display.partNodes?.find(node => node.id === edge.to) || display.hierarchy?.nodes.find(node => node.id === edge.to);
  const count = edge.sourceEdgeIds ? new Set(edge.sourceEdgeIds).size : 1;
  return `${from?.label || edge.from} → ${to?.label || edge.to} · ${edge.kind} · ${count} source ${count === 1 ? 'relation' : 'relations'}`;
}

export function relationFocus(display, { mode = 'auto', selection = null, hoverNode = null, focusNode = null, hoverEdge = null, focusEdge = null, focusedAreaId = null } = {}) {
  const dense = display.mode === 'blocks' && (display.nodes.length > 12 || display.edges.length > 18);
  const allCollapsed = display.areaMode && display.areas?.every(area => !area.expanded);
  const resolvedMode = mode === 'auto' ? dense && !allCollapsed ? 'focus' : 'all' : mode;
  const directional = areaDirections(display, focusedAreaId);
  if (directional.area) return { mode: resolvedMode, dense, targets: directional.selectedNodes, emphasized: directional.related, visible: resolvedMode === 'all' ? new Set(display.edges.map(edge => edge.id)) : directional.related, total: display.edges.length, directional };
  const nodeIds = new Set(display.nodes.map(node => node.id));
  const targets = new Set([selectedDisplayId(selection, display), hoverNode, focusNode].filter(id => nodeIds.has(id)));
  const directEdges = new Set([selection?.type === 'edge' ? selection.id : null, hoverEdge, focusEdge].filter(Boolean));
  const emphasized = new Set(display.edges.filter(edge => targets.has(edge.from) || targets.has(edge.to) || directEdges.has(edge.id)).map(edge => edge.id));
  const visible = resolvedMode === 'all' ? new Set(display.edges.map(edge => edge.id)) : emphasized;
  return { mode: resolvedMode, dense, targets, emphasized, visible, total: display.edges.length };
}

export function layoutAreas(display, previous = new Map(), columns = 3) {
  const positions = new Map(), groups = [];
  const activeIds = new Set(display.nodes.map(node => node.id));
  const occupied = [...previous].filter(([id]) => activeIds.has(id)).map(([, point]) => point);
  let top = 0, column = 0, rowBottom = 0;
  const place = (node, x, y) => {
    const point = previous.has(node.id) ? { ...previous.get(node.id) } : { x, y };
    if (!previous.has(node.id)) {
      while (occupied.some(other => Math.abs(point.x - other.x) < 280 && Math.abs(point.y - other.y) < 160)) point.y += 220;
      occupied.push(point);
    }
    positions.set(node.id, point); return point;
  };
  const order = ['$entry', 'navigation', 'controls', 'rendering', 'live-data', 'details', 'source', 'helpers'];
  const areas = [...display.areas || []].sort((a, b) => Number(a.context) - Number(b.context) || (order.indexOf(a.sectionId) + 1 || 99) - (order.indexOf(b.sectionId) + 1 || 99) || a.label.localeCompare(b.label, 'en'));
  for (const area of areas) {
    if (!area.expanded) {
      if (column >= columns) { top = rowBottom + 84; column = 0; }
      const node = display.nodes.find(node => node.id === area.id);
      if (!node) continue;
      const point = place(node, column * 356, top);
      rowBottom = Math.max(rowBottom, point.y + nodeSize(node).height); column++;
      continue;
    }
    if (column) { top = rowBottom + 100; column = 0; }
    const members = display.nodes.filter(node => node.areaId === area.id);
    members.forEach((node, index) => place(node, index % columns * 356, top + Math.floor(index / columns) * 220));
    if (!members.length) continue;
    const points = members.map(node => positions.get(node.id)), left = Math.min(...points.map(point => point.x));
    rowBottom = Math.max(...members.map(node => positions.get(node.id).y + nodeSize(node).height));
    groups.push({ id: area.id, areaId: area.id, label: area.label, count: members.length, x: left, y: Math.min(...points.map(point => point.y)) - 40, width: Math.max(...points.map(point => point.x)) + 260 - left, section: true });
    top = rowBottom + 104;
  }
  return { positions, groups };
}

export function areaSearch(display, query, graph) {
  if (!display.areaMode) { const matches = findNodes(display, query); return { targets: matches, visible: matches }; }
  const parts = decorateScope({ nodes: display.partNodes || [], edges: display.partEdges || [] }, graph);
  const targets = findNodes(parts, query);
  for (const id of findNodes({ nodes: display.nodes.filter(node => node.isArea).map(node => ({ ...node, path: null, searchText: '', symbols: [] })) }, query)) targets.add(id);
  const visible = new Set();
  for (const id of targets) {
    if (display.nodes.some(node => node.id === id)) visible.add(id);
    else { const area = display.areas.find(area => area.memberIds.includes(id)); if (area) visible.add(area.id); }
  }
  return { targets, visible };
}

export function expandForPart(display, id, expandedAreaIds) {
  const result = new Set(expandedAreaIds);
  const area = display.areas?.find(area => area.memberIds.includes(id));
  if (area) result.add(area.id);
  return result;
}

export function fitScopeCamera(nodes, positions, width, height, panelWidth = 0) {
  if (!positions.size) return overviewCamera(positions, width, height);
  const rectangles = nodes.filter(node => positions.has(node.id)).map(node => ({ ...positions.get(node.id), ...nodeSize(node) }));
  const minX = Math.min(...rectangles.map(rect => rect.x)), minY = Math.min(...rectangles.map(rect => rect.y)) - 42;
  const spanX = Math.max(...rectangles.map(rect => rect.x + rect.width)) - minX;
  const spanY = Math.max(...rectangles.map(rect => rect.y + rect.height)) - minY;
  const left = 56, top = 138, usableWidth = Math.max(100, width - 112 - panelWidth), usableHeight = Math.max(100, height - top - 35);
  const scale = Math.max(.02, Math.min(1, usableWidth / Math.max(1, spanX), usableHeight / Math.max(1, spanY)));
  return { scale, x: left + (usableWidth - spanX * scale) / 2 - minX * scale, y: top + (usableHeight - spanY * scale) / 2 - minY * scale };
}

export function layoutOverview(nodes, previous = new Map(), columns = 3) {
  const positions = new Map();
  const order = ['block:canvas', 'block:server', 'block:live-index', 'block:agent-context', 'block:code-index', 'block:tests', 'block:settings', 'block:docs'];
  const sorted = [...nodes].sort((a, b) => {
    const priority = node => order.includes(node.id) ? order.indexOf(node.id) : node.group === 'core' ? 5 : 9;
    return priority(a) - priority(b) || a.label.localeCompare(b.label);
  });
  sorted.forEach((node, index) => {
    const retained = previous.get(node.id);
    positions.set(node.id, retained && Number.isFinite(retained.x) && Number.isFinite(retained.y) ? { ...retained } : { x: (index % columns) * 356, y: Math.floor(index / columns) * 244 });
  });
  const occupied = nodes.filter(node => previous.has(node.id)).map(node => positions.get(node.id));
  for (const node of sorted.filter(node => !previous.has(node.id))) {
    const point = positions.get(node.id);
    while (occupied.some(other => Math.abs(point.x - other.x) < 280 && Math.abs(point.y - other.y) < 156)) point.y += 244;
    occupied.push(point);
  }
  return { positions, groups: [] };
}

export function overviewCamera(positions, width, height) {
  const minX = positions.size ? Math.min(...[...positions.values()].map(point => point.x)) : 0;
  const minY = positions.size ? Math.min(...[...positions.values()].map(point => point.y)) : 0;
  // An overview is readable at first paint. A narrow viewport pans over the
  // diagram instead of shrinking the entire project into illegible cards.
  const scale = width < 1000 ? .9 : 1;
  return { scale, x: 56 - minX * scale, y: Math.max(92, Math.min(125, height * .13)) - minY * scale };
}

export function segmentCrossesRect(a, b, rect) {
  const epsilon = .01;
  if (a.x === b.x) return a.x > rect.x + epsilon && a.x < rect.x + rect.width - epsilon && Math.max(a.y, b.y) > rect.y + epsilon && Math.min(a.y, b.y) < rect.y + rect.height - epsilon;
  if (a.y === b.y) return a.y > rect.y + epsilon && a.y < rect.y + rect.height - epsilon && Math.max(a.x, b.x) > rect.x + epsilon && Math.min(a.x, b.x) < rect.x + rect.width - epsilon;
  return true;
}

export function sharedSegmentLength(a, b, c, d, clearance = 8) {
  if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < clearance) return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
  if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < clearance) return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
  return 0;
}

export function edgePresentation(edge, display, view = 'project', selection = null) {
  const selectedNode = selectedDisplayId(selection, display);
  const testing = edge.layers?.includes('testing') || display.nodes.some(node => [edge.from, edge.to].includes(node.id) && (node.type === 'tests' || node.kind === 'test'));
  const connected = edge.from === selectedNode || edge.to === selectedNode;
  const selected = selection?.type === 'edge' && selection.id === edge.id;
  return { testing: Boolean(testing), subdued: Boolean(testing && view !== 'testing' && !connected && !selected), labelVisible: Boolean(edge.kind === 'contract' || connected || selected || testing && view === 'testing') };
}

function gridRoute(rectangles, obstacles, starts, ends, offset) {
  const xs = [...new Set([...rectangles.flatMap(rect => [rect.x - offset, rect.x + rect.width + offset]), ...starts.map(point => point.x), ...ends.map(point => point.x)])].sort((a, b) => a - b);
  const ys = [...new Set([...rectangles.flatMap(rect => [rect.y - offset, rect.y + rect.height + offset]), ...starts.map(point => point.y), ...ends.map(point => point.y)])].sort((a, b) => a - b);
  const targetKeys = new Set(ends.map(point => `${xs.indexOf(point.x)},${ys.indexOf(point.y)}`));
  const frontier = [];
  const best = new Map();
  const key = point => `${point.x},${point.y},${point.direction}`;
  const heuristic = point => Math.min(...ends.map(end => Math.abs(xs[point.x] - end.x) + Math.abs(ys[point.y] - end.y)));
  for (const start of starts) {
    const point = { x: xs.indexOf(start.x), y: ys.indexOf(start.y), direction: -1, cost: 0, previous: null };
    point.estimate = heuristic(point); frontier.push(point); best.set(key(point), 0);
  }
  while (frontier.length) {
    frontier.sort((a, b) => b.estimate - a.estimate);
    const current = frontier.pop();
    if (current.cost > best.get(key(current))) continue;
    if (targetKeys.has(`${current.x},${current.y}`)) {
      const points = [];
      for (let point = current; point; point = point.previous) points.unshift({ x: xs[point.x], y: ys[point.y] });
      return points.filter((point, index) => !index || index === points.length - 1 || !((points[index - 1].x === point.x && point.x === points[index + 1].x) || (points[index - 1].y === point.y && point.y === points[index + 1].y)));
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, y = current.y + dy;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const from = { x: xs[current.x], y: ys[current.y] }, to = { x: xs[x], y: ys[y] };
      if (obstacles.some(rect => segmentCrossesRect(from, to, rect))) continue;
      const direction = dx ? 0 : 1;
      const cost = current.cost + Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + (current.direction !== -1 && direction !== current.direction ? 25 : 0);
      const point = { x, y, direction, cost, previous: current };
      if (cost >= (best.get(key(point)) ?? Infinity)) continue;
      best.set(key(point), cost); point.estimate = cost + heuristic(point); frontier.push(point);
    }
  }
  return null;
}

/** Orthogonal ports and outside lanes keep paths out of card interiors. */
export function routeEdge(edge, nodes, positions, laneIndex = 0, previousRoutes = []) {
  const rectangles = nodes.filter(node => positions.has(node.id)).map(node => ({ id: node.id, ...positions.get(node.id), ...nodeSize(node) }));
  const from = rectangles.find(node => node.id === edge.from);
  const to = rectangles.find(node => node.id === edge.to);
  if (!from || !to) return { path: '', points: [], label: { x: 0, y: 0 } };
  const portOffset = ((laneIndex % 3) - 1) * 17;
  const ports = rect => [{ x: rect.x + rect.width, y: rect.y + rect.height / 2 + portOffset }, { x: rect.x + rect.width / 2 + portOffset, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height / 2 + portOffset }, { x: rect.x + rect.width / 2 + portOffset, y: rect.y }];
  const obstacles = rectangles.map(rect => [edge.from, edge.to].includes(rect.id) ? rect : { ...rect, x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 });
  const occupied = previousRoutes.flatMap(route => route.points.slice(1).map((point, index) => [route.points[index], point]));
  const offset = 22 + (laneIndex % 4) * 9;
  const xs = [...new Set([from.x - offset, from.x + from.width + offset, to.x - offset, to.x + to.width + offset, Math.min(...rectangles.map(rect => rect.x)) - offset, Math.max(...rectangles.map(rect => rect.x + rect.width)) + offset])];
  const ys = [...new Set([from.y - offset, from.y + from.height + offset, to.y - offset, to.y + to.height + offset, Math.min(...rectangles.map(rect => rect.y)) - offset, Math.max(...rectangles.map(rect => rect.y + rect.height)) + offset])];
  let best = null;
  for (const start of ports(from)) for (const end of ports(to)) {
    const candidates = [
      [start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end],
      ...xs.map(x => [start, { x, y: start.y }, { x, y: end.y }, end]),
      ...ys.map(y => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ];
    for (let points of candidates) {
      points = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
      if (points.length < 2 || points.some((point, index) => index && obstacles.some(rect => segmentCrossesRect(points[index - 1], point, rect)))) continue;
      const distance = points.reduce((total, point, index) => index ? total + Math.abs(point.x - points[index - 1].x) + Math.abs(point.y - points[index - 1].y) : total, 0);
      const shared = points.reduce((total, point, index) => index ? total + occupied.reduce((overlap, [a, b]) => overlap + sharedSegmentLength(points[index - 1], point, a, b), 0) : total, 0);
      const cost = distance + (points.length - 2) * 25 + shared * 12;
      if (!best || cost < best.cost) best = { points, cost };
    }
  }
  if (!best) {
    const grid = gridRoute(rectangles, obstacles, ports(from), ports(to), offset);
    if (grid) best = { points: grid };
  }
  // Retained free layouts can enclose a card. Preserve an explicit path rather
  // than claiming obstacle avoidance when no supported route exists.
  const points = best?.points || [ports(from)[0], { x: from.x + from.width + offset, y: from.y + from.height / 2 }, { x: from.x + from.width + offset, y: to.y - offset }, { x: to.x + to.width / 2, y: to.y - offset }, ports(to)[3]];
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1], point = points[index], after = points[index + 1];
    const radius = Math.min(9, Math.hypot(point.x - before.x, point.y - before.y) / 2, Math.hypot(after.x - point.x, after.y - point.y) / 2);
    const enter = { x: point.x - Math.sign(point.x - before.x) * radius, y: point.y - Math.sign(point.y - before.y) * radius };
    const leave = { x: point.x + Math.sign(after.x - point.x) * radius, y: point.y + Math.sign(after.y - point.y) * radius };
    path += ` L${enter.x},${enter.y} Q${point.x},${point.y} ${leave.x},${leave.y}`;
  }
  path += ` L${points.at(-1).x},${points.at(-1).y}`;
  const segments = points.slice(1).map((point, index) => ({ a: points[index], b: point, length: Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y) }));
  segments.sort((a, b) => b.length - a.length);
  const longest = segments[0];
  return { path, points, label: { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2 - 8 }, obstructed: !best };
}

function groupFor(node) {
  if (node.kind === 'test') return ['4-tests', 'Tests'];
  if (node.kind === 'external') return ['7-external', 'External dependencies'];
  if (node.kind === 'document') return ['6-documents', 'Documentation'];
  if (node.kind === 'config') return ['5-config', 'Konfigurace'];
  const folder = (node.path || '').split('/').slice(0, -1).join('/');
  if (folder === 'public' || folder.startsWith('public/')) return ['2-public', 'Interface / public'];
  if (node.kind === 'asset') return ['3-assets', 'Assets'];
  return folder ? [`1-${folder}`, folder] : ['0-core', 'Project core'];
}

/** A deterministic local layout. Reconcile retains positions for unchanged IDs. */
export function layoutGraph(nodes, previous = new Map(), { columns = 5 } = {}) {
  const buckets = new Map();
  for (const node of nodes) {
    const [key, label] = groupFor(node);
    if (!buckets.has(key)) buckets.set(key, { key, label, nodes: [] });
    buckets.get(key).nodes.push(node);
  }
  const positions = new Map();
  const groups = [];
  const columnCount = Math.max(1, Math.floor(columns));
  const columnHeights = Array(columnCount).fill(0);
  for (const group of [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    group.nodes.sort((a, b) => (a.path || a.label).localeCompare(b.path || b.label));
    // Small folder runs form a masonry layout. Long external/module groups
    // continue in another column rather than pushing every group far sideways.
    for (let start = 0; start < group.nodes.length; start += 5) {
      const chunk = group.nodes.slice(start, start + 5);
      const column = columnHeights.indexOf(Math.min(...columnHeights));
      const x = column * (CARD.width + CARD.gapX);
      const y = columnHeights[column];
      groups.push({ label: `${group.label}${start ? ' · continued' : ''}`, x, y: y - 37, width: CARD.width });
      chunk.forEach((node, index) => {
        const existing = previous.get(node.id);
        positions.set(node.id, existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)
          ? { ...existing }
          : { x, y: y + index * (CARD.height + CARD.gapY) });
      });
      columnHeights[column] = y + chunk.length * (CARD.height + CARD.gapY) + 37;
    }
  }
  // A new file can share a default slot with a manually moved or retained file.
  // Only new files move to the next free row; existing user positions stay put.
  const occupied = nodes.filter(node => previous.has(node.id)).map(node => positions.get(node.id));
  for (const node of nodes.filter(node => !previous.has(node.id))) {
    const position = positions.get(node.id);
    while (occupied.some(other => Math.abs(position.x - other.x) < CARD.width + 12 && Math.abs(position.y - other.y) < CARD.height + 12)) {
      position.y += CARD.height + CARD.gapY;
    }
    occupied.push(position);
  }
  return { positions, groups };
}

/** Layer views emphasize structure in place, including endpoints of real links. */
export function layerMembership(graph, view) {
  const nodes = new Set();
  const edges = new Set();
  for (const node of graph.nodes) {
    if (view === 'project' || node.layers?.includes(view) || (view === 'security' && node.security?.length) || (view === 'testing' && node.kind === 'test')) nodes.add(node.id);
  }
  for (const edge of graph.edges) {
    if (view === 'project' || edge.layers?.includes(view)) {
      edges.add(edge.id);
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
  }
  return { nodes, edges };
}

export function findNodes(graph, query) {
  const normalized = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[_-]/g, ' ');
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return new Set();
  return new Set(graph.nodes.filter(node => {
    const value = normalized([node.label, node.path, node.searchText, ...(node.aliases || []), ...(node.symbols || []).map(symbol => symbol.name)].join(' '));
    return terms.every(term => value.includes(term));
  }).map(node => node.id));
}

/** Sequence numbers are ordered only inside the server instance that made them. */
export function shouldAcceptRuntime(previous, next) {
  return !(previous?.instanceId && previous.instanceId === next?.instanceId
    && previous.sequence !== undefined && next.sequence !== undefined
    && next.sequence < previous.sequence);
}

export function fitCamera(positions, width, height, panelWidth = 0) {
  if (!positions.size) return { x: width / 2, y: height / 2, scale: 1 };
  const points = [...positions.values()];
  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)) - 43;
  const maxX = Math.max(...points.map(point => point.x)) + CARD.width;
  const maxY = Math.max(...points.map(point => point.y)) + CARD.height;
  const left = width < 610 ? 89 : 112;
  const right = width - 90 - panelWidth;
  const top = width < 610 ? 165 : 155;
  const bottom = height - (height < 650 ? 105 : 170);
  const areaWidth = Math.max(100, right - left);
  const areaHeight = Math.max(100, bottom - top);
  const scale = Math.max(.08, Math.min(1, areaWidth / Math.max(1, maxX - minX), areaHeight / Math.max(1, maxY - minY)));
  return { x: left + (areaWidth - (maxX - minX) * scale) / 2 - minX * scale, y: top + (areaHeight - (maxY - minY) * scale) / 2 - minY * scale, scale };
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const svgElement = (tag, attributes = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
const timeLabel = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'time unavailable';
};
const shortHash = value => value ? String(value).slice(0, 12) : 'neuveden';

export function startVisualizer(projectScope = null, projectAreaScope = null, resolveSourceRelations = null) {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const state = { graph: null, display: null, mode: 'blocks', modeViews: new Map(), relationMode: 'auto', expandedAreaIds: new Set(), focusedAreaId: null, hoverNode: null, focusNode: null, hoverEdge: null, focusEdge: null, navigation: createNavigationState(), runtime: null, view: 'project', query: '', selection: null, panel: null, positions: new Map(), groups: [], camera: { x: 0, y: 0, scale: 1 }, connected: false, received: false, fitted: false, indexError: null, sourceRequest: 0, source: null };
  const cards = new Map();
  const detailButtons = new Map();
  const links = new Map();
  const layoutOptions = () => ({ columns: canvas.clientWidth < 550 ? 2 : canvas.clientWidth < 1000 ? 3 : 5 });
  let drag = null;
  let reconnectTimer;
  let fetchSequence = 0;
  let version = 0;
  let panelReturnFocus = null;

  function setMessage(title, description, error = false) {
    const message = $('canvas-message');
    message.hidden = !title;
    message.classList.toggle('error', error);
    message.querySelector('h2').textContent = title || '';
    message.querySelector('p').textContent = description || '';
  }

  function setCamera(camera) {
    state.camera = camera;
    $('world').style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    $('zoom-reset').textContent = `${Math.round(camera.scale * 100)} %`;
    canvas.style.backgroundPosition = `${camera.x % 22}px ${camera.y % 22}px`;
  }

  function fit({ initial = false } = {}) {
    if (state.display?.mode === 'blocks') {
      const collapsedAreas = state.display.areaMode && state.display.areas.every(area => !area.expanded);
      const camera = initial && !collapsedAreas ? overviewCamera(state.positions, canvas.clientWidth, canvas.clientHeight) : fitScopeCamera(state.display.nodes, state.positions, canvas.clientWidth, canvas.clientHeight, state.panel ? $('inspector').offsetWidth + 12 : 0);
      if (initial && !collapsedAreas && state.groups.some(group => group.section)) camera.y += 55;
      setCamera(camera);
    }
    else setCamera(fitCamera(state.positions, canvas.clientWidth, canvas.clientHeight, state.panel ? $('inspector').offsetWidth + 12 : 0));
  }

  function changeMode(mode) {
    if (!state.graph || state.mode === mode) return;
    state.modeViews.set(state.display.mode, { positions: state.positions, camera: { ...state.camera } });
    state.mode = mode;
    const saved = state.modeViews.get(mode);
    state.positions = saved?.positions || new Map();
    state.fitted = Boolean(saved);
    syncGraph(state.graph);
    if (saved) setCamera(saved.camera);
  }

  function viewSnapshot() { return { positions: state.positions, camera: state.camera, selection: state.selection, relationMode: state.relationMode, expandedAreaIds: state.expandedAreaIds, focusedAreaId: state.focusedAreaId }; }

  function restoreScope() {
    const saved = state.navigation.snapshots.get(state.navigation.scopeId);
    state.positions = saved ? copyView(saved).positions : new Map();
    state.selection = saved?.selection ? { ...saved.selection } : null;
    state.relationMode = saved?.relationMode || 'auto';
    state.expandedAreaIds = new Set(saved?.expandedAreaIds || []);
    state.focusedAreaId = saved?.focusedAreaId || null;
    state.hoverNode = state.focusNode = state.hoverEdge = state.focusEdge = null;
    state.source = null; state.sourceRequest++;
    state.fitted = Boolean(saved?.camera);
    state.panel = null; $('inspector').hidden = true;
    document.querySelectorAll('[data-panel]').forEach(control => control.setAttribute('aria-expanded', 'false'));
    state.query = ''; $('search').value = '';
    syncGraph(state.graph);
    if (saved?.camera) setCamera({ ...saved.camera });
  }

  function enterScope(id) {
    if (!state.graph?.hierarchy || !projectScope) return;
    if (id === state.navigation.scopeId) return;
    const target = state.graph.hierarchy.nodes.find(node => node.id === id);
    if (id !== null && (!target || !target.hasChildren)) return;
    state.navigation = navigateScope(state.navigation, id, viewSnapshot());
    restoreScope();
  }

  function goBack() {
    if (state.mode !== 'blocks') return;
    if (!state.navigation.history.length) return;
    state.navigation = backScope(state.navigation, viewSnapshot());
    restoreScope();
  }

  function toggleArea(id, expanded) {
    if (!state.display?.areaMode) return;
    const next = new Set(state.expandedAreaIds);
    if (expanded) next.add(id); else next.delete(id);
    state.expandedAreaIds = next;
    state.positions = new Map(); state.fitted = true;
    state.hoverNode = state.focusNode = state.hoverEdge = state.focusEdge = null;
    syncGraph(state.graph);
    const group = state.groups.find(group => group.areaId === id);
    if (group) { const scale = Math.max(.85, state.camera.scale); setCamera({ scale, x: 56 - group.x * scale, y: 145 - group.y * scale }); }
    else revealNode(id);
  }

  function renderBreadcrumbs() {
    const wrapper = $('scope-breadcrumbs');
    wrapper.replaceChildren();
    const root = element('button', 'scope-crumb', 'Project');
    root.addEventListener('click', () => enterScope(null));
    root.setAttribute('aria-current', state.navigation.scopeId === null ? 'location' : 'false');
    wrapper.append(root);
    for (const crumb of state.display?.breadcrumbs || []) {
      if (crumb.id === null || crumb.id === undefined) continue;
      wrapper.append(element('span', 'crumb-separator', '/'));
      const control = element('button', 'scope-crumb', crumb.label);
      control.title = crumb.label;
      control.setAttribute('aria-current', crumb.id === state.navigation.scopeId ? 'location' : 'false');
      control.addEventListener('click', () => enterScope(crumb.id));
      wrapper.append(control);
    }
    const sections = $('section-jump');
    sections.replaceChildren(element('option', '', 'Map area'));
    sections.firstChild.value = '';
    const jumpGroups = state.display?.areaMode ? state.display.areas.map(area => ({ id: area.id, label: area.label, count: area.memberIds.length })) : state.groups.filter(group => group.section);
    for (const group of jumpGroups) {
      const option = element('option', '', `${group.label} (${group.count})`);
      option.value = group.id; sections.append(option);
    }
    sections.hidden = !jumpGroups.length;
    $('collapse-all').hidden = !state.display?.areaMode || !state.expandedAreaIds.size;
    $('scope-back').disabled = !state.navigation.history.length;
    $('scope-notice').hidden = !state.navigation.notice;
    $('scope-notice').textContent = state.navigation.notice || '';
    $('scope-navigation').hidden = state.display?.mode !== 'blocks' || !state.graph?.hierarchy || !projectScope;
  }

  function zoom(factor, point = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }) {
    const old = state.camera;
    const scale = Math.max(.08, Math.min(2.5, old.scale * factor));
    setCamera({ scale, x: point.x - (point.x - old.x) * scale / old.scale, y: point.y - (point.y - old.y) * scale / old.scale });
  }

  function status() {
    const runtime = state.runtime || {};
    const statusNode = $('live-status');
    let label;
    let kind;
    if (state.indexError || runtime.status === 'error') { kind = 'error'; label = 'Index error'; }
    else if (!state.connected) { kind = 'offline'; label = state.received ? 'Disconnected' : 'Connecting'; }
    else if (runtime.status === 'indexing') { kind = 'indexing'; label = 'Indexing…'; }
    else if (state.graph?.status === 'partial') { kind = 'partial'; label = 'Partial index'; }
    else if (state.received && runtime.status === 'current') { kind = 'current'; label = 'Live index'; }
    else { kind = 'indexing'; label = 'Checking index'; }
    statusNode.dataset.state = kind;
    $('live-text').textContent = label;
    statusNode.title = [label, runtime.lastCheckedAt ? `Checked ${timeLabel(runtime.lastCheckedAt)}` : '', state.indexError || runtime.error || ''].filter(Boolean).join(' · ');
  }

  function drawGroups() {
    const fragment = document.createDocumentFragment();
    for (const group of state.groups) {
      const label = element('div', `group-label${group.section ? ' section-label' : ''}`, group.label);
      if (group.count !== undefined) label.append(element('span', 'section-count', `${group.count} ${group.count === 1 ? 'part' : 'parts'}`));
      if (group.areaId) {
        const select = element('button', 'area-collapse area-select-control', 'Select');
        select.setAttribute('aria-label', `Select area: ${group.label}`);
        select.addEventListener('click', event => {
          event.stopPropagation(); state.focusedAreaId = group.areaId;
          state.selection = { type: 'area', id: group.areaId }; state.source = null; state.sourceRequest++;
          openPanel('selection'); emphasize();
        });
        const collapse = element('button', 'area-collapse', 'Collapse');
        collapse.setAttribute('aria-label', `Collapse ${group.label}`);
        collapse.addEventListener('click', event => { event.stopPropagation(); toggleArea(group.areaId, false); });
        label.append(select, collapse);
      }
      label.style.left = `${group.x}px`;
      label.style.top = `${group.y}px`;
      label.style.width = `${group.width}px`;
      fragment.append(label);
    }
    $('groups').replaceChildren(fragment);
  }

  function drawEdges() {
    if (!state.display) return;
    const routed = [];
    const prioritized = [...state.display.edges].sort((a, b) => Number(edgePresentation(a, state.display).testing) - Number(edgePresentation(b, state.display).testing) || Number(b.kind === 'contract') - Number(a.kind === 'contract') || a.id.localeCompare(b.id));
    prioritized.forEach((edge, index) => {
      const group = links.get(edge.id);
      if (!group) return;
      const route = routeEdge(edge, state.display.nodes, state.positions, index, routed);
      routed.push(route);
      group.querySelectorAll('path').forEach(node => node.setAttribute('d', route.path));
      const label = group.querySelector('.edge-label');
      if (label) { label.setAttribute('x', route.label.x); label.setAttribute('y', route.label.y); }
      group.classList.toggle('declared-contract', edge.provenance === 'declared-contract');
      group.classList.toggle('route-obstructed', route.obstructed);
    });
  }

  function placeCard(id) {
    const position = state.positions.get(id);
    const card = cards.get(id);
    if (position && card) card.style.transform = `translate(${position.x}px,${position.y}px)`;
    if (position && detailButtons.has(id)) {
      const size = nodeSize(state.display.nodes.find(node => node.id === id));
      const inset = state.display.nodes.find(node => node.id === id)?.isArea ? 62 : 30;
      detailButtons.get(id).style.transform = `translate(${position.x + size.width - inset}px,${position.y + 8}px)`;
    }
  }

  function membership() { return state.display ? layerMembership(state.display, state.view) : { nodes: new Set(), edges: new Set() }; }

  function emphasize() {
    if (!state.display) return;
    const layer = membership();
    const searchResult = areaSearch(state.display, state.query, state.graph);
    const matches = searchResult.visible;
    const hasQuery = Boolean(state.query.trim());
    const neighbors = new Set();
    const policy = relationFocus(state.display, { mode: state.relationMode, selection: state.selection, hoverNode: state.hoverNode, focusNode: state.focusNode, hoverEdge: state.hoverEdge, focusEdge: state.focusEdge, focusedAreaId: state.focusedAreaId });
    const selectedNode = selectedDisplayId(state.selection, state.display);
    const selectedEdge = state.selection?.type === 'edge' ? state.selection.id : null;
    for (const edge of state.display.edges) {
      if (policy.emphasized.has(edge.id)) { neighbors.add(edge.from); neighbors.add(edge.to); }
      if (edge.id === selectedEdge) { neighbors.add(edge.from); neighbors.add(edge.to); }
    }
    for (const node of state.display.nodes) {
      const card = cards.get(node.id);
      if (!card) continue;
      const highlighted = layer.nodes.has(node.id);
      card.classList.toggle('layer-focus', state.view !== 'project' && highlighted);
      card.classList.toggle('is-dimmed', hasQuery ? !matches.has(node.id) : state.view !== 'project' && !highlighted);
      card.classList.toggle('is-match', hasQuery && matches.has(node.id));
      const directional = policy.directional;
      card.classList.toggle('area-unrelated', Boolean(directional?.area) && !directional.selectedNodes.has(node.id) && !directional.neighbors.has(node.id));
      card.classList.toggle('area-related', Boolean(directional?.area) && (directional.selectedNodes.has(node.id) || directional.neighbors.has(node.id)));
      card.classList.toggle('area-pinned', Boolean(directional?.selectedNodes.has(node.id)));
      detailButtons.get(node.id)?.setAttribute('aria-pressed', String(node.isArea && node.id === state.focusedAreaId));
      card.classList.toggle('is-selected', selectedNode === node.id);
      card.classList.toggle('is-neighbor', neighbors.has(node.id));
      card.setAttribute('aria-pressed', String(selectedNode === node.id));
    }
    for (const edge of state.display.edges) {
      const group = links.get(edge.id);
      if (!group) continue;
      const presentation = edgePresentation(edge, state.display, state.view, state.selection);
      const direction = policy.directional?.directions.get(edge.id) || null;
      for (const value of ['incoming', 'outgoing', 'internal', 'unrelated']) group.classList.toggle(`area-${value}`, direction === value);
      const marker = direction && direction !== 'unrelated' ? `edge-arrow-${direction}` : 'edge-arrow';
      group.querySelector('.edge-line')?.setAttribute('marker-end', `url(#${marker})`);
      const visible = policy.visible.has(edge.id);
      group.classList.toggle('relation-hidden', !visible);
      group.classList.toggle('focus-strong', policy.emphasized.has(edge.id));
      group.setAttribute('tabindex', visible ? '0' : '-1');
      group.setAttribute('aria-hidden', String(!visible));
      group.classList.toggle('test-reference', presentation.testing);
      group.classList.toggle('subdued-reference', presentation.subdued);
      group.classList.toggle('show-label', policy.directional?.area ? direction !== 'unrelated' && (edge.id === selectedEdge || edge.id === state.hoverEdge || edge.id === state.focusEdge) : presentation.labelVisible || edge.id === state.hoverEdge || edge.id === state.focusEdge);
      group.classList.toggle('focused', state.view !== 'project' && layer.edges.has(edge.id));
      group.classList.toggle('dimmed', hasQuery ? !matches.has(edge.from) && !matches.has(edge.to) : state.view !== 'project' && !layer.edges.has(edge.id));
      group.classList.toggle('selected', selectedEdge === edge.id);
      group.classList.toggle('connected', policy.emphasized.has(edge.id));
      group.classList.toggle('outside-neighborhood', policy.emphasized.size > 0 && !policy.emphasized.has(edge.id));
    }
    $('area-focus-bar').hidden = !policy.directional?.area;
    $('area-focus-name').textContent = policy.directional?.area ? `${policy.directional.area.label} selected` : '';
    $('relation-mode').value = policy.mode;
    $('relation-count').textContent = `${policy.visible.size} / ${policy.total} ${policy.total === 1 ? 'relation' : 'relations'}`;
    const visibleLayer = [...policy.visible].filter(id => layer.edges.has(id)).length;
    const layerName = { project: 'Whole project', security: 'Security', testing: 'Testing' }[state.view];
    const hint = policy.mode === 'focus' ? 'Hover a part, focus it with the keyboard or inspect its details.' : 'All relations in the open scope.';
    const countDescription = `${hint} Showing ${policy.visible.size} of ${policy.total} relations. ${layerName} layer: ${visibleLayer} of ${layer.edges.size}.${state.display.areaMode ? ` All ${state.display.partEdges.length} part relations are retained, including links inside collapsed areas.` : ''}`;
    $('relation-count').title = countDescription;
    $('relation-count').setAttribute('aria-label', countDescription);
    $('relation-mode').title = hint;
    $('search-summary').hidden = !hasQuery;
    $('search-summary').textContent = searchResult.targets.size ? `${searchResult.targets.size} ${searchResult.targets.size === 1 ? 'match' : 'matches'} · Enter opens the first result · Escape clears search` : 'No matching block, file or symbol';
  }

  function selectNode(id, { center = false, line = null, inspect = false } = {}) {
    let node = state.display?.nodes.find(item => item.id === id) || state.display?.partNodes?.find(item => item.id === id) || state.graph?.hierarchy?.nodes.find(item => item.id === id) || state.graph?.nodes.find(item => item.id === id) || state.graph?.overview?.nodes.find(item => item.id === id);
    if (!node) return;
    if (node.isArea) {
      if (!inspect) { toggleArea(node.id, true); return; }
      state.focusedAreaId = id;
      state.selection = { type: 'area', id }; state.source = null; state.sourceRequest++;
      openPanel('selection'); emphasize(); return;
    }
    if (state.display?.areaMode && !state.display.nodes.some(item => item.id === id)) {
      const expanded = expandForPart(state.display, id, state.expandedAreaIds);
      if (expanded.size !== state.expandedAreaIds.size) { state.expandedAreaIds = expanded; state.positions = new Map(); state.fitted = true; syncGraph(state.graph); node = state.display.nodes.find(item => item.id === id) || node; }
    }
    if (node.hierarchyKind === 'boundary' || node.kind === 'boundary') { selectNode(node.targetId, { center, line, inspect }); return; }
    if (!inspect && !line && state.mode === 'blocks' && state.graph.hierarchy && projectScope && node.hasChildren) { enterScope(node.targetId || id); return; }
    const sourceKind = node.hierarchyKind || node.kind;
    const file = state.graph.nodes.find(item => item.path === node.path || item.id === node.sourceId);
    if (sourceKind === 'symbol' || sourceKind === 'file') {
      if (!file) return;
      state.selection = { type: 'node', id: file.id, line: line || node.line || 1, partId: sourceKind === 'symbol' || node.isEntry ? id : null, endLine: node.endLine };
    } else state.selection = { type: sourceKind === 'block' || node.fileIds ? 'block' : 'node', id, line };
    state.source = null;
    state.sourceRequest++;
    openPanel('selection');
    emphasize();
    if (center) revealNode(id);
  }

  function revealNode(id) {
    const displayId = selectedDisplayId({ type: 'node', id }, state.display);
    const position = state.positions.get(displayId);
    if (!position) return;
    const size = nodeSize(state.display.nodes.find(node => node.id === displayId));
    const scale = Math.max(state.display.mode === 'blocks' ? .9 : .75, state.camera.scale);
    const available = canvas.clientWidth - (state.panel ? $('inspector').offsetWidth + 100 : 70);
    setCamera({ scale, x: Math.max(90, available / 2) - (position.x + size.width / 2) * scale, y: canvas.clientHeight / 2 - (position.y + size.height / 2) * scale });
  }

  function selectEdge(id) {
    state.selection = { type: 'edge', id };
    state.sourceRequest++;
    state.source = null;
    openPanel('selection');
    $('panel-body').scrollTop = 0;
    emphasize();
  }

  function syncGraph(graph) {
    const previousGraph = state.graph;
    const previousSelected = state.selection?.type === 'node' ? previousGraph?.nodes.find(node => node.id === state.selection.id) : null;
    state.graph = graph;
    if (graph.hierarchy) {
      const navigation = reconcileNavigation(state.navigation, graph.hierarchy.nodes, previousGraph?.hierarchy?.nodes || []);
      if (navigation.scopeId !== state.navigation.scopeId) {
        const saved = navigation.snapshots.get(navigation.scopeId);
        state.positions = saved ? copyView(saved).positions : new Map();
        state.selection = saved?.selection ? { ...saved.selection } : null;
        state.expandedAreaIds = new Set(saved?.expandedAreaIds || []);
        state.focusedAreaId = saved?.focusedAreaId || null;
        state.fitted = Boolean(saved?.camera);
        if (saved?.camera) setCamera({ ...saved.camera });
        state.source = null; state.sourceRequest++;
      }
      state.navigation = navigation;
    }
    const scope = state.mode === 'blocks' && graph.hierarchy && projectScope ? projectScope(graph, state.navigation.scopeId) : null;
    const display = scope ? decorateScope(projectAreaScope ? projectAreaScope(scope, state.expandedAreaIds) : scope, graph) : displayGraph(graph, state.mode);
    if (display.areaMode) state.expandedAreaIds = new Set(display.expandedAreaIds);
    if (!display.areas?.some(area => area.id === state.focusedAreaId)) state.focusedAreaId = null;

    const changedMode = state.display && state.display.mode !== display.mode;
    state.display = display;
    document.body.dataset.diagram = display.mode;
    state.runtime = graph.runtime || null;
    state.received = true;
    state.indexError = null;
    const layout = display.areaMode ? layoutAreas(display, state.positions, canvas.clientWidth < 1000 ? 2 : 3) : display.mode === 'blocks' ? layoutScope(display.nodes, state.positions, canvas.clientWidth < 1000 ? 2 : 3) : layoutGraph(display.nodes, state.positions, layoutOptions());
    state.positions = layout.positions;
    state.groups = layout.groups;
    const ids = new Set(display.nodes.map(node => node.id));
    for (const [id, card] of cards) if (!ids.has(id)) { card.remove(); cards.delete(id); detailButtons.get(id)?.remove(); detailButtons.delete(id); }
    for (const node of display.nodes) {
      let card = cards.get(node.id);
      if (!card) {
        card = element('button', `file-node ${node.kind === 'block' ? `block-node block-type-${node.type || 'module'} group-${node.group || 'support'}` : node.kind === 'external' ? 'external' : ''}`);
        card.dataset.id = node.id;
        card.addEventListener('pointerenter', () => { state.hoverNode = node.id; emphasize(); });
        card.addEventListener('pointerleave', () => { if (state.hoverNode === node.id) state.hoverNode = null; emphasize(); });
        card.addEventListener('focus', () => { state.focusNode = node.id; emphasize(); });
        card.addEventListener('blur', () => { if (state.focusNode === node.id) state.focusNode = null; emphasize(); });
        // Pointer selection happens on pointerup (also after pointer capture).
        // Native keyboard and assistive-technology clicks have detail === 0.
        card.addEventListener('click', event => { if (event.detail === 0) selectNode(node.id); });
        card.addEventListener('keydown', event => {
          if (event.altKey && event.key === 'ArrowLeft') return;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          if (event.altKey) {
            const position = state.positions.get(node.id);
            position.x += event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0;
            position.y += event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
            placeCard(node.id); drawEdges();
          } else {
            const origin = state.positions.get(node.id);
            const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
            const forward = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
            const candidates = state.display.nodes.filter(item => item.id !== node.id).map(item => ({ id: item.id, point: state.positions.get(item.id) })).filter(item => ((horizontal ? item.point.x - origin.x : item.point.y - origin.y) * forward) > 0);
            candidates.sort((a, b) => Math.hypot(a.point.x - origin.x, a.point.y - origin.y) - Math.hypot(b.point.x - origin.x, b.point.y - origin.y));
            if (candidates[0]) { cards.get(candidates[0].id)?.focus({ preventScroll: true }); revealNode(candidates[0].id); }
          }
        });
        cards.set(node.id, card);
        $('nodes').append(card);
      }
      card.className = `file-node ${node.isArea ? 'area-node ' : ''}${node.hierarchyKind && node.hierarchyKind !== 'block' ? 'part-node ' : ''}${node.hierarchyKind === 'boundary' ? 'boundary-node ' : ''}${node.kind === 'block' ? `block-node block-type-${node.type || 'module'} group-${node.group || 'support'}` : node.kind === 'external' ? 'external' : ''}`;
      const signature = JSON.stringify([node.label, node.path, node.kind, node.type, node.hasChildren, node.isArea, node.partCount, node.internalEdgeCount, node.description, node.fileIds?.length, node.symbols?.length, node.security?.length, display.edges.filter(edge => edge.from === node.id || edge.to === node.id).length]);
      if (card.dataset.signature !== signature) {
        card.dataset.signature = signature;
        const main = element('span', 'node-main');
        main.append(element('span', 'node-glyph', node.isArea ? '▦' : node.kind === 'block' ? ({ interface: '▣', service: '◉', process: '↳', tests: 'T', config: '⚙', document: '≡', module: '{ }' }[node.type] || '{ }') : GLYPH[node.kind] || '·'));
        const titles = element('span', 'node-titles');
        titles.append(element('span', 'node-name', node.label), element('span', 'node-path', node.isArea ? node.group === 'context' ? 'Parts outside the current scope' : 'Expand to inspect source parts' : node.kind === 'block' ? node.description : node.path || 'External package / module'));
        main.append(titles);
        const footer = element('span', 'node-footer');
        const count = display.edges.filter(edge => edge.from === node.id || edge.to === node.id).length;
        footer.append(element('span', '', node.isArea ? 'Area' : node.kind === 'block' ? BLOCK_TYPES[node.type] || 'Module' : node.security?.length ? `${KIND[node.kind]} · security ${node.security.length}` : KIND[node.kind] || node.kind), element('span', 'node-stat', node.isArea ? `${node.partCount} ${node.partCount === 1 ? 'part' : 'parts'} · ${node.internalEdgeCount || 0} internal ${node.internalEdgeCount === 1 ? 'link' : 'links'}` : node.kind === 'block' ? `${node.hierarchyKind === 'boundary' ? 'context' : node.hierarchyKind === 'symbol' ? `line ${node.line || '?'}` : `${node.fileIds.length} ${node.fileIds.length === 1 ? 'file' : 'files'}`} · ${count} ${count === 1 ? 'relation' : 'relations'}${node.hasChildren ? ' · ↳' : ''}` : `${count} ${count === 1 ? 'relation' : 'relations'}${node.symbols?.length ? ` · ${node.symbols.length} ${node.symbols.length === 1 ? 'symbol' : 'symbols'}` : ''}`));
        card.replaceChildren(main, footer);
      }
      if (node.kind === 'block' && node.hierarchyKind !== 'boundary' && !detailButtons.has(node.id)) {
        const detail = element('button', 'node-detail-button', 'i');
        detail.setAttribute('aria-label', `Detail: ${node.label}`);
        detail.title = `Detail: ${node.label}`;
        detail.addEventListener('pointerenter', () => { state.hoverNode = node.id; emphasize(); });
        detail.addEventListener('pointerleave', () => { if (state.hoverNode === node.id) state.hoverNode = null; emphasize(); });
        detail.addEventListener('focus', () => { state.focusNode = node.id; emphasize(); });
        detail.addEventListener('blur', () => { if (state.focusNode === node.id) state.focusNode = null; emphasize(); });
        detail.addEventListener('click', event => { event.stopPropagation(); selectNode(node.id, { inspect: true }); });
        detailButtons.set(node.id, detail); $('nodes').append(detail);
      }
      if (detailButtons.has(node.id)) {
        const detail = detailButtons.get(node.id);
        detail.textContent = node.isArea ? 'Select' : 'i'; detail.classList.toggle('area-select', Boolean(node.isArea));
        detail.setAttribute('aria-label', node.isArea ? `Select area: ${node.label}` : `Detail: ${node.label}`);
        detail.title = node.isArea ? `Select area: ${node.label}` : `Detail: ${node.label}`;
      }
      card.title = `${node.label || node.path} · ${node.kind === 'block' ? BLOCK_TYPES[node.type] || 'Module' : KIND[node.kind] || node.kind}\n${node.isArea ? 'Click to expand this area' : node.hasChildren ? 'Click to open smaller parts' : 'Click to open source'}; Alt + arrows move the card.`;
      card.setAttribute('aria-label', `${node.label || node.path}, ${node.kind === 'block' ? BLOCK_TYPES[node.type] : KIND[node.kind] || node.kind}, ${node.isArea ? 'expand area' : node.hasChildren ? 'open smaller parts' : 'source details'}`);
      placeCard(node.id);
    }
    const edgeIds = new Set(display.edges.map(edge => edge.id));
    for (const [id, link] of links) if (!edgeIds.has(id)) { link.remove(); links.delete(id); }
    if (!$('edge-arrow')) {
      const defs = svgElement('defs');
      const marker = svgElement('marker', { id: 'edge-arrow', markerWidth: 7, markerHeight: 7, refX: 6, refY: 3.5, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.append(svgElement('path', { d: 'M1,1 L6,3.5 L1,6', fill: 'none', stroke: '#8b9585', 'stroke-width': 1 }));
      defs.append(marker);
      for (const [direction, color] of [['incoming', '#ad7c4d'], ['outgoing', '#56798f'], ['internal', '#7e786b']]) {
        const directionalMarker = svgElement('marker', { id: `edge-arrow-${direction}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
        directionalMarker.append(svgElement('path', { d: 'M1,1 L7,4 L1,7', fill: 'none', stroke: color, 'stroke-width': 1.5 })); defs.append(directionalMarker);
      } $('connections').append(defs);
    }
    for (const edge of display.edges) {
      if (!links.has(edge.id)) {
        const group = svgElement('g', { class: 'edge', tabindex: '0', role: 'button' });
        group.append(svgElement('title'), svgElement('path', { class: 'edge-line', 'marker-end': 'url(#edge-arrow)' }), svgElement('path', { class: 'edge-hit' }));
        if (display.mode === 'blocks') { const label = svgElement('text', { class: 'edge-label', 'text-anchor': 'middle' }); label.textContent = edge.label || 'uses'; group.append(label); }
        group.addEventListener('pointerenter', () => { state.hoverEdge = edge.id; emphasize(); });
        group.addEventListener('pointerleave', () => { if (state.hoverEdge === edge.id) state.hoverEdge = null; emphasize(); });
        group.addEventListener('focus', () => { state.focusEdge = edge.id; emphasize(); });
        group.addEventListener('blur', () => { if (state.focusEdge === edge.id) state.focusEdge = null; emphasize(); });
        group.addEventListener('click', event => { event.stopPropagation(); selectEdge(edge.id); });
        group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectEdge(edge.id); } });
        links.set(edge.id, group); $('connections').append(group);
      }
      links.get(edge.id).setAttribute('aria-label', connectorLabel(edge, display));
      links.get(edge.id).querySelector('title').textContent = connectorLabel(edge, display);
      const label = links.get(edge.id).querySelector('.edge-label');
      if (label) label.textContent = `${display.nodes.find(node => node.id === edge.from)?.label || edge.from} → ${display.nodes.find(node => node.id === edge.to)?.label || edge.to} · ${edge.label || edge.kind}`;
    }
    const selected = state.selection;
    if (selected && !(selected.type === 'node' ? graph.nodes.some(node => node.id === selected.id) && (!selected.partId || display.nodes.some(node => node.id === selected.partId) || graph.hierarchy?.nodes.some(node => node.id === selected.partId)) : selected.type === 'area' ? display.areas?.some(area => area.id === selected.id) : selected.type === 'block' ? graph.overview?.nodes.some(node => node.id === selected.id) : edgeIds.has(selected.id) || graph.edges.some(edge => edge.id === selected.id) || display.partEdges?.some(edge => edge.id === selected.id))) { state.selection = null; state.source = null; state.sourceRequest++; }
    const nowSelected = state.selection?.type === 'node' ? graph.nodes.find(node => node.id === state.selection.id) : null;
    if (nowSelected && previousSelected?.hash !== nowSelected.hash) { state.source = null; state.sourceRequest++; }
    $('project-name').textContent = graph.project?.name || 'Project';
    const fileCount = graph.stats?.files ?? graph.nodes.filter(node => node.kind !== 'external').length;
    $('graph-count').textContent = display.mode === 'blocks'
      ? `${display.nodes.length} ${display.nodes.length === 1 ? 'block' : 'blocks'} · ${display.edges.length} ${display.edges.length === 1 ? 'relation' : 'relations'}`
      : `${fileCount} ${fileCount === 1 ? 'file' : 'files'} · ${graph.edges.length} ${graph.edges.length === 1 ? 'relation' : 'relations'}`;
    $('activity-count').hidden = !state.runtime?.changes?.length;
    $('activity-count').textContent = Math.min(state.runtime?.changes?.length || 0, 99);
    drawGroups(); drawEdges(); emphasize(); status(); renderBreadcrumbs();
    setMessage(graph.nodes.length ? null : 'No indexed project files yet', graph.nodes.length ? '' : 'Project information contains the index scope and limitations.');
    if (state.panel) renderPanel();
    if ((!state.fitted || changedMode) && display.nodes.length) { fit({ initial: true }); state.fitted = true; }
  }

  function section(title, parent = $('panel-body')) { const heading = element('h2', '', title); parent.append(heading); return parent; }
  function note(text, neutral = false, parent = $('panel-body')) { const node = element('div', `notice${neutral ? ' neutral' : ''}`, text); parent.append(node); return node; }
  function button(text, action, small = null, parent = $('panel-body')) {
    const control = element('button', 'panel-button', text);
    if (small) control.append(element('small', '', small));
    control.addEventListener('click', action); parent.append(control); return control;
  }
  function fact(value, label, parent) { const item = element('div', 'fact'); item.append(element('strong', '', value), element('span', '', label)); parent.append(item); }
  function pathButton(path, line, label, parent = $('panel-body')) {
    const node = state.graph.nodes.find(item => item.path === path);
    if (node) return button(label || `${path}${line ? `:${line}` : ''}`, () => selectNode(node.id, { line, center: true }), null, parent);
    const fallback = element('span', 'hint', label || path);
    parent.append(fallback);
    return fallback;
  }

  function openPanel(panel) {
    if (!state.panel) panelReturnFocus = document.activeElement;
    state.panel = panel;
    $('inspector').hidden = false;
    document.querySelectorAll('[data-panel]').forEach(control => control.setAttribute('aria-expanded', String(control.dataset.panel === panel)));
    renderPanel();
  }

  function closePanel() {
    state.panel = null;
    $('inspector').hidden = true;
    document.querySelectorAll('[data-panel]').forEach(control => control.setAttribute('aria-expanded', 'false'));
    if (panelReturnFocus?.isConnected) panelReturnFocus.focus({ preventScroll: true });
  }

  function renderPanel() {
    const body = $('panel-body');
    const scroll = body.scrollTop;
    const previousKey = body.dataset.key;
    body.dataset.key = `${state.panel}:${state.selection?.id || ''}`;
    body.replaceChildren();
    if (state.panel === 'project') renderProject(body);
    else if (state.panel === 'activity') renderActivity(body);
    else renderSelection(body);
    if (body.dataset.key === previousKey) body.scrollTop = scroll;
  }

  function renderProject(body) {
    $('panel-eyebrow').textContent = 'PROJECT INDEX';
    $('panel-title').textContent = state.graph?.project?.name || 'Project';
    if (!state.graph) { note(state.indexError || 'Waiting for the first project index.', false, body); return; }
    const graph = state.graph;
    if (graph.hierarchy && !projectScope) note('Nested navigation is unavailable. Showing the supported block overview.', false, body);
    section('Map display', body);
    const modes = element('div', 'map-mode-controls');
    for (const [mode, label] of [['blocks', 'Blocks'], ['files', 'Files']]) {
      const control = button(label, () => changeMode(mode), null, modes);
      control.setAttribute('aria-pressed', String(state.display.mode === mode));
      control.disabled = mode === 'blocks' && !graph.overview?.nodes.length;
    }
    body.append(modes);
    if (state.display.mode === 'blocks') body.append(element('p', 'hint', `Blocks: ${graph.overview.source === 'inferred' ? 'derived from source' : `named in ${graph.overview.source}`}. Open a block to reach its source files and lines.`));
    body.append(element('div', 'path-label', graph.project?.root || 'Project root not provided'));
    if (graph.binding) {
      section('Project attachment', body);
      body.append(element('p', 'primary-text', `Attached · ${graph.binding.bindingId || graph.binding.id || 'local project'}`));
      body.append(element('p', 'hint', `Runtime ${graph.binding.version || graph.binding.runtime?.version || 'pinned'} · ${graph.binding.artifactDigest || graph.binding.digest || graph.binding.runtime?.digest || ''}`));
      note('This confirms the local project binding. It does not prove that a coding agent has loaded or used this context.', true, body);
    }
    if (state.indexError || state.runtime?.status === 'error') note(`Could not refresh the index: ${state.indexError || state.runtime.error || 'unknown error'}. The map shows the last available state.`, false, body);
    else if (!state.connected) note('Live connection lost. The last available map may be stale; reconnecting.', false, body);
    else if (state.runtime?.status === 'indexing') note('Indexing changes. The map shows the last completed index.', true, body);
    if (graph.status === 'partial') note('Partial index. Some files or relations could not be analyzed reliably; see details below.', false, body);
    const facts = element('div', 'fact-grid');
    fact(graph.stats?.files ?? graph.nodes.filter(node => node.kind !== 'external').length, 'indexed files', facts);
    fact(graph.edges.length, 'static relations', facts);
    fact(graph.stats?.tests ?? graph.nodes.filter(node => node.kind === 'test').length, 'test files', facts);
    fact(graph.stats?.security ?? graph.nodes.filter(node => node.security?.length).length, 'files with security signals', facts);
    body.append(facts);
    body.append(element('p', 'hint', `Index ${timeLabel(graph.generatedAt)} · last checked ${timeLabel(state.runtime?.lastCheckedAt)} · revision ${shortHash(graph.revision)}`));
    note('The map shows static source references. It does not run code or tests, or establish security or coverage.', true, body);
    if (graph.overview) {
      section('Block types', body);
      body.append(element('p', 'hint', 'Interfaces use a screen shape, services a rounded block and processes a double-sided rectangle. Tests use a dashed border; documents a folded corner. Shapes describe roles, not completion.'));
      for (const diagnostic of graph.overview.diagnostics || []) note(typeof diagnostic === 'string' ? diagnostic : diagnostic.message, false, body);
    }
    if (graph.diagnostics?.length) {
      section(`Diagnostics (${graph.diagnostics.length})`, body);
      for (const diagnostic of graph.diagnostics) {
        const item = element('div', 'evidence-item');
        item.append(element('strong', '', diagnostic.severity || 'info'), element('p', '', diagnostic.message));
        if (diagnostic.path) pathButton(diagnostic.path, diagnostic.line, null, item);
        body.append(item);
      }
    }
    section('Scope and limitations', body);
    const limitations = graph.scope?.limitations || [];
    const excluded = graph.scope?.excluded || [];
    if (limitations.length) {
      const list = element('ul', 'scope-list');
      for (const limitation of limitations) list.append(element('li', '', typeof limitation === 'string' ? limitation : limitation.message || JSON.stringify(limitation)));
      body.append(list);
    } else body.append(element('p', 'hint', 'No additional scope limitations reported.'));
    const excludedDetails = element('details');
    excludedDetails.append(element('summary', 'hint', `Excluded paths (${excluded.length})`));
    const list = element('ul', 'scope-list');
    for (const entry of excluded) list.append(element('li', '', typeof entry === 'string' ? entry : `${entry.path || entry.pattern || ''} ${entry.reason || ''}`.trim()));
    if (!excluded.length) list.append(element('li', '', 'The index lists no excluded paths.'));
    excludedDetails.append(list); body.append(excludedDetails);
    renderFileList(body);
  }

  function renderFileList(body) {
    const matches = findNodes(state.graph, state.query);
    const nodes = state.graph.nodes.filter(node => !state.query.trim() || matches.has(node.id)).sort((a, b) => (a.path || a.label).localeCompare(b.path || b.label));
    section(`All files and modules (${nodes.length})`, body);
    if (!nodes.length) body.append(element('p', 'hint', 'No search results.'));
    for (const node of nodes) {
      const control = button(node.path || node.label, () => selectNode(node.id, { center: true }), KIND[node.kind] || node.kind, body);
      if (membership().nodes.has(node.id) && state.view !== 'project') control.classList.add('is-layer');
    }
  }

  function renderActivity(body) {
    $('panel-eyebrow').textContent = 'LIVE SOURCE';
    $('panel-title').textContent = 'Source changes';
    if (!state.connected) note('Connection lost. New changes will appear after reconnecting.', false, body);
    if (state.runtime?.status === 'error' || state.indexError) note(state.runtime?.error || state.indexError, false, body);
    body.append(element('p', 'hint', `Last checked: ${timeLabel(state.runtime?.lastCheckedAt)}. History contains changes observed by this server.`));
    const changes = state.runtime?.changes || [];
    if (!changes.length) note('No source changes recorded since startup.', true, body);
    for (const change of [...changes].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))) {
      const item = element('div', 'activity-item');
      const kinds = { added: 'Added', modified: 'Changed', changed: 'Changed', removed: 'Deleted', deleted: 'Deleted' };
      item.append(element('span', 'change-kind', kinds[change.kind] || change.kind), element('time', '', timeLabel(change.at)));
      const node = state.graph?.nodes.find(entry => entry.path === change.path);
      if (node) button(change.path, () => selectNode(node.id, { center: true }), null, item);
      else item.append(element('div', 'path-label', change.path));
      body.append(item);
    }
  }

  function renderSelection(body) {
    $('panel-eyebrow').textContent = 'SOURCE CODE';
    if (!state.selection || !state.graph) {
      $('panel-title').textContent = 'Selection details';
      const empty = element('div', 'empty-detail');
      empty.append(element('p', 'primary-text', 'Select a block or relation.'), element('p', '', 'Inspect its role, source files and relation evidence.'));
      body.append(empty); return;
    }
    if (state.selection.type === 'edge') { renderEdge(body); return; }
    if (state.selection.type === 'block') { renderBlock(body); return; }
    if (state.selection.type === 'area') { renderArea(body); return; }
    const node = state.graph.nodes.find(item => item.id === state.selection.id);
    if (!node) return;
    const owner = state.graph.overview?.nodes.find(block => block.fileIds.includes(node.id));
    if (owner) button(`← Back to block ${owner.label}`, () => selectNode(owner.id, { inspect: true }), null, body);
    const part = state.selection.partId ? state.graph.hierarchy?.nodes.find(item => item.id === state.selection.partId) || state.display.nodes.find(item => item.id === state.selection.partId) : null;
    $('panel-title').textContent = part?.label || node.label;
    if (part) { body.append(element('p', 'primary-text', `${part.description || 'Named source part.'} · lines ${state.selection.line}–${state.selection.endLine || state.selection.line}`)); if (part.sourceName || part.qualifiedName) body.append(element('p', 'hint', `Source name: ${part.qualifiedName || part.sourceName}`)); }
    body.append(element('div', 'path-label', node.path || node.label));
    body.append(element('p', 'hint', `${KIND[node.kind] || node.kind}${node.language ? ` · ${node.language}` : ''}${Number.isFinite(node.bytes) ? ` · ${node.bytes.toLocaleString('en-GB')} B` : ''} · hash ${shortHash(node.hash)}`));
    if (node.kind === 'external') {
      note('External dependency identified from an import. Its source is outside this index; package contents are neither read nor executed.', true, body);
    } else {
      section('Source', body);
      const target = element('div'); target.id = 'source-excerpt'; body.append(target);
      if (state.source?.path === node.path && state.source.hash === node.hash) displaySource(state.source, target, state.selection.line);
      else loadSource(node, state.selection.line || 1, target);
    }
    if (node.diagnostics?.length) {
      section('File diagnostics', body);
      for (const diagnostic of node.diagnostics) body.append(element('p', 'hint', typeof diagnostic === 'string' ? diagnostic : diagnostic.message || JSON.stringify(diagnostic)));
    }
    if (node.symbols?.length) {
      section(`Symbols (${node.symbols.length})`, body);
      for (const symbol of node.symbols) button(symbol.name, () => showSourceLine(node, symbol.line || 1), `${symbol.kind} · line ${symbol.line || '?'}`, body);
    }
    section('Security', body);
    if (!node.security?.length) body.append(element('p', 'hint', 'No security signals identified in this file. This is not a security audit.'));
    for (const evidence of node.security || []) {
      const item = element('div', 'evidence-item');
      const detail = evidence.evidence;
      const line = evidence.line || detail?.line;
      item.append(element('strong', '', evidence.label || evidence.kind));
      if (typeof detail === 'string') item.append(element('p', '', detail));
      else if (detail?.snippet) item.append(element('p', '', detail.snippet));
      if (line) {
        item.append(element('p', 'hint', `${detail?.path || node.path}:${line}`));
        button(`Show line ${line}`, () => showSourceLine(node, line), null, item);
      }
      body.append(item);
    }
    const outgoing = state.graph.edges.filter(edge => edge.from === node.id);
    const incoming = state.graph.edges.filter(edge => edge.to === node.id);
    renderRelations('Imports and references', outgoing, 'to', body);
    renderRelations('Used by', incoming, 'from', body);
    const testEdges = [...outgoing, ...incoming].filter(edge => edge.layers?.includes('testing') || [edge.from, edge.to].some(id => state.graph.nodes.find(item => item.id === id)?.kind === 'test'));
    section(`Test relations (${testEdges.length})`, body);
    note('A test reference shows a source relationship. It does not prove execution, results or coverage.', true, body);
    for (const edge of testEdges) button(edge.label || edge.kind, () => selectEdge(edge.id), `${state.graph.nodes.find(item => item.id === edge.from)?.label} → ${state.graph.nodes.find(item => item.id === edge.to)?.label}`, body);
  }

  function renderBlock(body) {
    const block = state.graph.overview?.nodes.find(node => node.id === state.selection.id);
    if (!block) return;
    $('panel-eyebrow').textContent = 'PROJECT BLOCK';
    $('panel-title').textContent = block.label;
    body.append(element('p', 'primary-text', block.description));
    body.append(element('p', 'hint', `${BLOCK_TYPES[block.type] || 'Module'} · ${block.fileIds.length} ${block.fileIds.length === 1 ? 'file' : 'files'} · ${block.id}`));
    if (block.aliases?.length) body.append(element('p', 'hint', `Aliases: ${block.aliases.join(', ')}`));
    const ids = new Set(block.fileIds);
    const members = state.graph.nodes.filter(node => ids.has(node.id));
    const primary = members.find(node => node.path === block.primaryPath);
    if (primary) button('Open primary source', () => selectNode(primary.id), primary.path, body);
    section('Block files', body);
    const memberGroups = new Map();
    for (const node of members) {
      const label = KIND[node.kind] || node.kind;
      if (!memberGroups.has(label)) memberGroups.set(label, []);
      memberGroups.get(label).push(node);
    }
    for (const [label, files] of memberGroups) {
      body.append(element('p', 'hint', label));
      for (const node of files) button(node.path || node.label, () => selectNode(node.id), `${node.symbols?.length || 0} symbols${node.security?.length ? ` · ${node.security.length} security signals` : ''}`, body);
    }
    const overview = displayGraph(state.graph, 'blocks');
    const relations = overview.edges.filter(edge => edge.from === block.id || edge.to === block.id);
    section(`Block relations (${relations.length})`, body);
    for (const edge of relations) {
      const incoming = edge.to === block.id;
      const other = overview.nodes.find(node => node.id === (incoming ? edge.from : edge.to));
      button(`${incoming ? '←' : '→'} ${other?.label || '?'} · ${edge.label}`, () => selectEdge(edge.id), edge.provenance === 'declared-contract' ? 'Declared contract · open origin' : `${edge.sourceEdgeIds?.length || 0} source references · open evidence`, body);
    }
    const rawRelations = state.graph.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to));
    const externalIds = new Set(rawRelations.flatMap(edge => [edge.from, edge.to]));
    const externals = state.graph.nodes.filter(node => node.kind === 'external' && externalIds.has(node.id));
    section(`External modules (${externals.length})`, body);
    if (!externals.length) body.append(element('p', 'hint', 'No identified external dependencies.'));
    for (const node of externals) button(node.label, () => selectNode(node.id), 'External module · source is outside the index', body);
    const testRelations = rawRelations.filter(edge => edge.layers?.includes('testing'));
    section(`Test references (${testRelations.length})`, body);
    note('Static source references. These do not prove test execution, results or coverage.', true, body);
    for (const edge of testRelations) button(`${state.graph.nodes.find(node => node.id === edge.from)?.label} → ${state.graph.nodes.find(node => node.id === edge.to)?.label}`, () => selectEdge(edge.id), edge.label || edge.kind, body);
    const security = members.flatMap(node => (node.security || []).map(signal => ({ ...signal, node })));
    section(`Security signals (${security.length})`, body);
    if (!security.length) body.append(element('p', 'hint', 'No identified signals. This does not confirm safety.'));
    for (const signal of security) button(signal.label || signal.kind, () => selectNode(signal.node.id, { line: signal.line }), `${signal.node.path}:${signal.line || '?'}`, body);
  }

  function renderArea(body) {
    const area = state.display.areas?.find(area => area.id === state.selection.id);
    if (!area) return;
    $('panel-eyebrow').textContent = 'AREA';
    $('panel-title').textContent = area.label;
    body.append(element('p', 'primary-text', `${area.memberIds.length} ${area.memberIds.length === 1 ? 'part' : 'parts'} · ${area.internalEdgeIds.length} internal ${area.internalEdgeIds.length === 1 ? 'relation' : 'relations'}`));
    button(area.expanded ? 'Collapse area' : 'Expand area', () => toggleArea(area.id, !area.expanded), null, body);
    const directional = areaDirections(state.display, area.id);
    for (const [title, edges, side] of [['Incoming', directional.incoming, 'from'], ['Outgoing', directional.outgoing, 'to']]) {
      section(`${title} (${edges.length})`, body);
      if (!edges.length) body.append(element('p', 'hint', `No ${title.toLowerCase()} relations in this scope.`));
      for (const edge of edges) {
        const otherId = edge[side];
        const otherArea = state.display.areas.find(candidate => candidate.id === otherId || candidate.memberIds.includes(otherId));
        const otherNode = state.display.nodes.find(node => node.id === otherId);
        const count = edge.sourceEdgeIds ? new Set(edge.sourceEdgeIds).size : 1;
        button(`${title === 'Incoming' ? '←' : '→'} ${otherArea?.label || otherNode?.label || otherId} · ${count} source ${count === 1 ? 'relation' : 'relations'}`, () => selectEdge(edge.id), connectorLabel(edge, state.display), body);
      }
    }
    section('Parts', body);
    for (const id of area.memberIds) {
      const part = state.display.partNodes.find(node => node.id === id);
      if (part) button(part.label, () => selectNode(part.id), part.sourceName || part.path || part.description, body);
    }
    section(`Internal relations (${area.internalEdgeIds.length})`, body);
    for (const id of area.internalEdgeIds) {
      const edge = state.display.partEdges.find(edge => edge.id === id);
      if (!edge) continue;
      const from = state.display.partNodes.find(node => node.id === edge.from), to = state.display.partNodes.find(node => node.id === edge.to);
      button(`${from?.label || edge.from} → ${to?.label || edge.to}`, () => selectEdge(edge.id), edge.label || edge.kind, body);
    }
  }

  function renderRelations(title, edges, direction, body) {
    section(`${title} (${edges.length})`, body);
    if (!edges.length) body.append(element('p', 'hint', 'No statically identified relations.'));
    for (const edge of edges) {
      const target = state.graph.nodes.find(node => node.id === edge[direction]);
      button(target?.path || target?.label || edge[direction], () => selectEdge(edge.id), edge.label || edge.kind, body);
    }
  }

  function renderEdge(body) {
    const edge = state.display.edges.find(item => item.id === state.selection.id) || state.display.partEdges?.find(item => item.id === state.selection.id) || state.graph.edges.find(item => item.id === state.selection.id) || displayGraph(state.graph, 'blocks').edges.find(item => item.id === state.selection.id);
    if (!edge) return;
    $('panel-eyebrow').textContent = `SOURCE RELATION · ${edge.kind}`;
    const endpointNames = [];
    for (const [title, id] of [['From', edge.from], ['To', edge.to]]) {
      const node = state.display.nodes.find(item => item.id === id) || state.display.partNodes?.find(item => item.id === id) || state.graph.hierarchy?.nodes.find(item => item.id === id) || state.graph.nodes.find(item => item.id === id);
      endpointNames.push(node?.label || id);
      section(title, body);
      if (node) button(node.label || node.path, () => selectNode(node.id, { center: true }), [node.sourceName || node.qualifiedName, node.path ? `${node.path}${node.line ? `:${node.line}` : ''}` : KIND[node.kind]].filter(Boolean).join(' · '), body);
    }
    $('panel-title').textContent = endpointNames.join(' → ');
    if (edge.provenance === 'declared-contract') note('Declared contract from project-map.json. Its direction describes a named role, not an import or observed runtime call.', true, body);
    let contribution = null;
    if (resolveSourceRelations) {
      try { contribution = resolveSourceRelations(state.graph, edge); }
      catch (error) { note(`Source references could not be resolved: ${error.message}`, false, body); }
    }
    section(`Contributing parts (${contribution?.references.length || 0})`, body);
    if (!contribution) note('The source-pair resolver is unavailable. Collected evidence is shown below.', false, body);
    else {
      for (const reference of contribution.references) {
        const item = element('div', 'source-pair evidence-item');
        item.append(element('strong', '', `${reference.fromNode?.label || reference.from} → ${reference.toNode?.label || reference.to}`));
        item.append(element('p', 'hint', `${reference.kind} · ${reference.id}${reference.execution ? ` · ${reference.execution}` : ''}`));
        for (const [side, node, id] of [['From', reference.fromNode, reference.from], ['To', reference.toNode, reference.to]]) {
          if (!node) { item.append(element('p', 'hint', `${side}: named source endpoint unavailable (${id}).`)); continue; }
          const location = [node.qualifiedName || node.sourceName, node.path ? `${node.path}${node.line ? `:${node.line}` : ''}` : null].filter(Boolean).join(' · ');
          button(`${side}: ${node.label || node.path || id}`, () => selectNode(node.id, { line: node.line || 1, inspect: true }), location, item);
        }
        if (!reference.evidence?.length) item.append(element('p', 'hint', 'No source excerpt supplied for this reference.'));
        for (const evidence of reference.evidence || []) {
          item.append(element('p', 'primary-text', `${evidence.path}${evidence.line ? `:${evidence.line}` : ''}`));
          if (evidence.snippet) item.append(element('p', '', evidence.snippet));
          pathButton(evidence.path, evidence.line, 'Open source line', item);
        }
        body.append(item);
      }
      for (const id of contribution.unresolvedSourceEdgeIds) note(`Source reference is no longer available: ${id}`, false, body);
      if (!contribution.references.length && !contribution.unresolvedSourceEdgeIds.length) body.append(element('p', 'hint', 'No underlying source references were supplied for this relation.'));
    }
    if (!contribution?.references.length) {
      section('Collected source evidence', body);
      if (!edge.evidence?.length) note('The index did not provide a specific source line for this relation.', false, body);
      for (const evidence of edge.evidence || []) {
        const item = element('div', 'evidence-item');
        item.append(element('p', 'primary-text', `${evidence.path}${evidence.line ? `:${evidence.line}` : ''}`));
        if (evidence.snippet) item.append(element('p', '', evidence.snippet));
        pathButton(evidence.path, evidence.line, 'Open source line', item); body.append(item);
      }
    }
    if (edge.layers?.includes('testing')) note('Static test reference. This relation does not establish execution, results or coverage.', true, body);
    if (edge.layers?.includes('security')) note('Security context in source. The relation alone establishes neither a vulnerability nor safety.', true, body);
  }

  async function loadSource(node, line, target) {
    const request = ++state.sourceRequest;
    target.append(element('p', 'hint', 'Loading source…'));
    try {
      const response = await fetch(`/api/source?path=${encodeURIComponent(node.path)}&line=${encodeURIComponent(line)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Source unavailable (HTTP ${response.status}).`);
      const source = await response.json();
      if (request !== state.sourceRequest || !target.isConnected) return;
      if (source.path !== node.path || !Array.isArray(source.lines)) throw new Error('The source response does not match the selected file.');
      if (node.hash && source.hash !== node.hash) {
        target.replaceChildren();
        note('The file changed after indexing. Source will be available when the map updates.', false, target);
        void refresh(); return;
      }
      state.source = source;
      displaySource(source, target, line);
    } catch (error) {
      if (request !== state.sourceRequest || !target.isConnected) return;
      target.replaceChildren(); note(error.message, false, target);
    }
  }

  function displaySource(source, target, line) {
    target.replaceChildren();
    target.append(element('p', 'hint', `Lines ${source.startLine ?? source.lines[0]?.number ?? 1}–${source.lines.at(-1)?.number ?? 0} of ${source.totalLines} · ${shortHash(source.hash)}`));
    const view = element('div', 'source-view');
    for (const entry of source.lines) {
      const row = element('div', `source-line${entry.number === line ? ' target-line' : ''}`);
      const anchor = element('a', 'line-number', entry.number);
      anchor.href = `#source-${encodeURIComponent(source.path)}-L${entry.number}`;
      anchor.setAttribute('aria-label', `Line ${entry.number}`);
      anchor.addEventListener('click', event => {
        event.preventDefault();
        if (state.selection?.type === 'node') state.selection.line = entry.number;
        view.querySelectorAll('.source-line').forEach(item => item.classList.toggle('target-line', item === row));
        history.replaceState(null, '', anchor.getAttribute('href'));
      });
      row.append(anchor, element('span', 'line-code', entry.text)); view.append(row);
    }
    target.append(view);
    const targetRow = [...view.children].find(row => row.classList.contains('target-line'));
    if (targetRow) view.scrollTop = Math.max(0, targetRow.offsetTop - view.offsetTop - 50);
    const controls = element('div');
    const first = source.lines[0]?.number || 1;
    const last = source.lines.at(-1)?.number || 0;
    const node = state.graph.nodes.find(item => item.path === source.path);
    if (first > 1) button('↑ Previous lines', () => showSourceLine(node, Math.max(1, first - 30)), null, controls);
    if (last < source.totalLines) button('↓ Next lines', () => showSourceLine(node, last + 20), null, controls);
    target.append(controls);
  }

  function showSourceLine(node, line) {
    if (!node || state.selection?.type !== 'node' || state.selection.id !== node.id) return;
    state.selection.line = line;
    const target = $('source-excerpt');
    state.source = null;
    target.replaceChildren();
    void loadSource(node, line, target);
  }

  function validGraph(graph) {
    if (!graph || graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.project || !['current', 'partial'].includes(graph.status)) return false;
    const ids = new Set(graph.nodes.map(node => node.id));
    return ids.size === graph.nodes.length && graph.nodes.every(node => typeof node.id === 'string' && typeof node.label === 'string') && graph.edges.every(edge => typeof edge.id === 'string' && ids.has(edge.from) && ids.has(edge.to));
  }

  function accept(graph) {
    if (!validGraph(graph)) throw new Error('The server returned an invalid graph format.');
    if (!shouldAcceptRuntime(state.runtime, graph.runtime)) return;
    version++;
    syncGraph(graph);
  }

  function failure(error) {
    state.indexError = error.message || String(error);
    status();
    if (!state.received) setMessage('Index unavailable', state.indexError, true);
    if (state.panel === 'project' || state.panel === 'activity') renderPanel();
  }

  async function refresh() {
    const request = ++fetchSequence;
    const before = version;
    try {
      const response = await fetch('/api/graph', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load the index (HTTP ${response.status}).`);
      const graph = await response.json();
      if (request !== fetchSequence || before !== version) return;
      accept(graph);
    } catch (error) { if (request === fetchSequence && before === version) failure(error); }
  }

  document.querySelectorAll('[data-view]').forEach(control => control.addEventListener('click', () => {
    state.view = control.dataset.view;
    document.body.dataset.view = state.view;
    document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === control)));
    emphasize();
    if (state.panel === 'project') renderPanel();
  }));
  document.querySelectorAll('[data-panel]').forEach(control => control.addEventListener('click', () => {
    if (state.panel === control.dataset.panel) closePanel();
    else if (control.dataset.panel === 'selection' && !state.selection && state.navigation.scopeId) selectNode(state.navigation.scopeId, { inspect: true });
    else openPanel(control.dataset.panel);
  }));
  $('scope-back').addEventListener('click', goBack);
  $('clear-area-focus').addEventListener('click', () => {
    state.focusedAreaId = null;
    if (state.selection?.type === 'area') { state.selection = null; if (state.panel === 'selection') renderPanel(); }
    emphasize();
  });
  $('collapse-all').addEventListener('click', () => {
    state.expandedAreaIds = new Set(); state.positions = new Map(); state.fitted = true;
    state.hoverNode = state.focusNode = state.hoverEdge = state.focusEdge = null;
    syncGraph(state.graph); fit({ initial: true });
  });
  $('relation-mode').addEventListener('change', event => { state.relationMode = event.target.value; emphasize(); });
  $('section-jump').addEventListener('change', event => {
    const group = state.groups.find(item => item.id === event.target.value);
    if (group) { const scale = Math.max(.85, state.camera.scale); setCamera({ scale, x: 56 - group.x * scale, y: 145 - group.y * scale }); }
    else if (state.positions.has(event.target.value)) revealNode(event.target.value);
    event.target.value = '';
  });
  for (const selector of ['.view-rail', '.tools-rail']) {
    document.querySelector(selector).addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll('button')];
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next].focus();
    });
  }
  $('close-panel').addEventListener('click', closePanel);
  $('fit').addEventListener('click', fit);
  $('zoom-in').addEventListener('click', () => zoom(1.2));
  $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
  $('zoom-reset').addEventListener('click', () => zoom(1 / state.camera.scale));
  $('arrange').addEventListener('click', () => { if (!state.graph) return; const layout = state.display.areaMode ? layoutAreas(state.display, new Map(), canvas.clientWidth < 1000 ? 2 : 3) : state.display.mode === 'blocks' ? layoutScope(state.display.nodes, new Map(), canvas.clientWidth < 1000 ? 2 : 3) : layoutGraph(state.display.nodes, new Map(), layoutOptions()); state.positions = layout.positions; state.groups = layout.groups; state.display.nodes.forEach(node => placeCard(node.id)); drawGroups(); drawEdges(); fit(); });
  $('search').addEventListener('input', event => { state.query = event.target.value; emphasize(); if (state.panel === 'project') renderPanel(); });
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); event.target.value = ''; state.query = ''; emphasize(); if (state.panel === 'project') renderPanel(); }
    if (event.key === 'Enter' && state.graph) { const match = [...areaSearch(state.display, state.query, state.graph).targets][0]; if (match) { selectNode(match, { center: true }); cards.get(match)?.focus({ preventScroll: true }); } }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (state.panel) closePanel(); else if (!event.target.closest('input,textarea,select')) goBack(); return; }
    if (!event.target.closest('input,textarea,select') && (event.altKey && event.key === 'ArrowLeft' || event.key === 'Backspace')) { event.preventDefault(); goBack(); return; }
    if (event.target.closest('input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '/') { event.preventDefault(); $('search').focus(); }
    else if (event.key === '0') { event.preventDefault(); fit(); }
    else if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
  });
  canvas.addEventListener('keydown', event => {
    if (event.target !== canvas || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    setCamera({ ...state.camera, x: state.camera.x + (event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0), y: state.camera.y + (event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0) });
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * .006), { x: event.clientX, y: event.clientY });
    else setCamera({ ...state.camera, x: state.camera.x - event.deltaX, y: state.camera.y - event.deltaY });
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.edge,.node-detail-button,.area-collapse')) return;
    const card = event.target.closest('.file-node');
    if (card) card.focus({ preventScroll: true }); else canvas.focus({ preventScroll: true });
    drag = { pointer: event.pointerId, id: card?.dataset.id || null, startX: event.clientX, startY: event.clientY, position: card ? { ...state.positions.get(card.dataset.id) } : { x: state.camera.x, y: state.camera.y }, moved: false };
    canvas.setPointerCapture(event.pointerId);
    if (!card) canvas.classList.add('panning');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.id && state.positions.has(drag.id)) { state.positions.set(drag.id, { x: drag.position.x + dx / state.camera.scale, y: drag.position.y + dy / state.camera.scale }); placeCard(drag.id); drawEdges(); }
    else if (!drag.id) setCamera({ ...state.camera, x: drag.position.x + dx, y: drag.position.y + dy });
  });
  function endDrag(event) {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.id && !drag.moved && event.type === 'pointerup') selectNode(drag.id);
    drag = null; canvas.classList.remove('panning');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.classList.remove('panning'); });

  const events = new EventSource('/api/events');
  events.addEventListener('open', () => {
    state.connected = true; status();
    if (state.panel === 'project' || state.panel === 'activity') renderPanel();
    void refresh();
    clearInterval(reconnectTimer);
  });
  events.addEventListener('state', event => { try { accept(JSON.parse(event.data)); } catch (error) { failure(error); } });
  events.addEventListener('error', () => {
    state.connected = false; status();
    if (state.panel === 'project' || state.panel === 'activity') renderPanel();
    clearInterval(reconnectTimer);
    reconnectTimer = setInterval(() => void refresh(), 8000);
  });
  window.addEventListener('beforeunload', () => { events.close(); clearInterval(reconnectTimer); });
  void refresh();
}

if (typeof document !== 'undefined') import('./hierarchy.mjs').then(module => module, () => ({})).then(module => startVisualizer(module.scopeGraph, module.projectAreas, module.sourceRelations));
