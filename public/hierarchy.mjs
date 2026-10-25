// Shared by the browser and the agent context. No filesystem or browser globals.
// Bulk callers share an operation-local lookup. Standalone calls read current nodes;
// keeping a cache across calls would miss in-place additions, removals or reparenting.
export function ancestorPath(hierarchy, id, byId = new Map((hierarchy?.nodes ?? []).map(node => [node.id, node]))) {
  const result = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return result;
}

export function descendantIds(hierarchy, id) {
  const children = new Map();
  for (const node of hierarchy?.nodes ?? []) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  const result = new Set();
  const queue = [id];
  while (queue.length) {
    const next = queue.pop();
    if (result.has(next)) continue;
    result.add(next);
    queue.push(...children.get(next) ?? []);
  }
  return result;
}

/** Project proven source endpoints to immediate children; retain outside context. */
export function scopeGraph(graph, parentId = null) {
  const hierarchy = graph.hierarchy;
  if (!hierarchy) return { ...graph, ...(graph.overview ?? {}), scopeId: null, scopeNode: null, breadcrumbs: [], mode: 'blocks' };
  const byId = new Map(hierarchy.nodes.map(node => [node.id, node]));
  const scopeNode = parentId ? byId.get(parentId) : null;
  if (parentId && !scopeNode) throw new Error('This part is no longer in the project.');
  const breadcrumbs = parentId ? ancestorPath(hierarchy, parentId, byId).map(({ id, label }) => ({ id, label })) : [];
  if (!parentId) return { ...graph, nodes: hierarchy.nodes.filter(node => !node.parentId), edges: graph.overview?.edges ?? [], scopeId: null, scopeNode: null, breadcrumbs, mode: 'blocks' };
  const children = hierarchy.nodes.filter(node => node.parentId === parentId);
  const descendants = descendantIds(hierarchy, parentId);
  const visible = new Map(children.map(node => [node.id, { ...node }]));
  const scopePath = ancestorPath(hierarchy, parentId, byId);
  let omittedExternalEdges = 0;
  const project = id => {
    const node = byId.get(id);
    if (!node) return null;
    if (id === parentId) {
      if (!['symbol', 'file'].includes(scopeNode.kind)) return null;
      const entryId = `entry:${parentId}`;
      if (!visible.has(entryId)) visible.set(entryId, { ...scopeNode, id: entryId, sourceId: parentId, label: scopeNode.kind === 'file' ? 'File body' : 'Entry', description: scopeNode.kind === 'file' ? 'Statements directly in this file.' : 'Statements directly in this function.', aliases: [], hasChildren: false, isEntry: true });
      return entryId;
    }
    const chain = ancestorPath(hierarchy, id, byId);
    if (descendants.has(id)) {
      const position = chain.findIndex(item => item.id === parentId);
      return chain[position + 1]?.id ?? null;
    }
    let shared = 0;
    while (shared < chain.length && shared < scopePath.length && chain[shared].id === scopePath[shared].id) shared++;
    const target = chain[Math.min(shared, chain.length - 1)];
    if (!target) return null;
    const boundaryId = `boundary:${parentId}=>${target.id}`;
    if (!visible.has(boundaryId)) visible.set(boundaryId, { ...target, id: boundaryId, kind: 'boundary', targetId: target.id, sourceId: target.sourceId ?? target.id, group: 'context', description: `Outside this scope · ${target.description || target.label}`, aliases: target.aliases ?? [] });
    return boundaryId;
  };
  const grouped = new Map();
  for (const edge of hierarchy.edges) {
    const insideFrom = descendants.has(edge.from);
    const insideTo = descendants.has(edge.to);
    if (!insideFrom && !insideTo) continue;
    // Imports at the file boundary describe the whole file, not an invented function caller.
    if (scopeNode.kind === 'file' && edge.kind !== 'call' && (edge.from === parentId || edge.to === parentId)) continue;
    if (!byId.has(edge.from) || !byId.has(edge.to)) { omittedExternalEdges++; continue; }
    const from = project(edge.from);
    const to = project(edge.to);
    if (!from || !to || from === to) continue;
    const kind = edge.kind === 'call' ? 'call' : ['http','event-stream','http-reference','contract'].includes(edge.kind) ? 'contract' : 'dependency';
    const key = `${from}|${kind}|${to}`;
    if (!grouped.has(key)) grouped.set(key, { id: `scope:${encodeURIComponent(parentId)}:${encodeURIComponent(key)}`, from, to, kind, label: kind === 'call' ? 'calls' : kind === 'contract' ? 'HTTP / SSE' : 'uses', layers: ['project'], sourceEdgeIds: [], evidence: [], provenance: kind === 'contract' ? 'static-contract' : 'source' });
    const relation = grouped.get(key);
    relation.sourceEdgeIds.push(edge.id);
    relation.evidence.push(...edge.evidence ?? []);
    for (const layer of edge.layers ?? []) if (!relation.layers.includes(layer)) relation.layers.push(layer);
  }
  const edges = [...grouped.values()];
  // A projected endpoint from a discarded self-edge must not leave an orphan boundary.
  const used = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const nodes = [...visible.values()].filter(node => children.some(child => child.id === node.id) || used.has(node.id));
  for (const edge of edges) {
    edge.sourceEdgeIds = [...new Set(edge.sourceEdgeIds)].sort();
    edge.evidence = [...new Map(edge.evidence.map(item => [`${item.path}:${item.line}:${item.column}:${item.snippet}`, item])).values()];
  }
  return { ...graph, nodes, edges, scopeId: parentId, scopeNode, breadcrumbs, omittedExternalEdges, mode: 'blocks' };
}

/** Collapse presentation areas without changing source ancestry or losing references. */
export function projectAreas(scope, expandedAreaIds = new Set()) {
  if (!['file', 'symbol'].includes(scope.scopeNode?.kind)) return { ...scope, areaMode: false, areas: [], partNodes: scope.nodes, partEdges: scope.edges };
  const expanded = new Set(expandedAreaIds);
  const areas = new Map();
  const owner = new Map();
  for (const node of scope.nodes) {
    const sectionId = node.kind === 'boundary' ? '$outside' : node.isEntry ? '$entry' : node.sectionId || '$other';
    const label = node.kind === 'boundary' ? 'Outside' : node.isEntry ? 'Entry' : node.sectionId && node.section || 'Other parts';
    const id = `area:${encodeURIComponent(scope.scopeId)}:${encodeURIComponent(sectionId)}`;
    if (!areas.has(id)) areas.set(id, { id, label, sectionId, memberIds: [], expanded: expanded.has(id), internalEdgeIds: [], internalSourceEdgeIds: [], context: node.kind === 'boundary' });
    areas.get(id).memberIds.push(node.id);
    owner.set(node.id, id);
  }
  const nodes = [];
  for (const area of areas.values()) {
    const members = scope.nodes.filter(node => owner.get(node.id) === area.id);
    area.memberIds.sort();
    if (area.expanded) nodes.push(...members.map(node => ({ ...node, areaId: area.id })));
    else nodes.push({
      id: area.id, areaId: area.id, kind: 'area', isArea: true, type: 'module', group: area.context ? 'context' : 'core',
      label: area.label, section: area.label, sectionId: area.sectionId, description: `${members.length} ${members.length === 1 ? 'part' : 'parts'} · Click to expand`,
      memberIds: [...area.memberIds], fileIds: [...new Set(members.flatMap(node => node.fileIds || []))].sort(),
      layers: [...new Set(members.flatMap(node => node.layers || ['project']))].sort(),
      aliases: [], hasChildren: false, partCount: members.length, internalEdgeCount: 0, internalEdgeIds: [], internalSourceEdgeIds: []
    });
  }
  const grouped = new Map();
  for (const edge of scope.edges) {
    const fromArea = areas.get(owner.get(edge.from));
    const toArea = areas.get(owner.get(edge.to));
    if (!fromArea || !toArea) throw new Error('Area projection received an edge with a missing endpoint.');
    if (fromArea.id === toArea.id) {
      fromArea.internalEdgeIds.push(edge.id);
      fromArea.internalSourceEdgeIds.push(...edge.sourceEdgeIds || [edge.id]);
    }
    const from = fromArea.expanded ? edge.from : fromArea.id;
    const to = toArea.expanded ? edge.to : toArea.id;
    if (from === to) continue;
    const key = JSON.stringify([from, to, edge.kind, edge.provenance || 'source']);
    if (!grouped.has(key)) grouped.set(key, {
      id: `area-edge:${encodeURIComponent(scope.scopeId)}:${encodeURIComponent(key)}`, from, to, kind: edge.kind,
      label: edge.label, provenance: edge.provenance, scopeEdgeIds: [], sourceEdgeIds: [], evidence: [], layers: [], relationCount: 0
    });
    const relation = grouped.get(key);
    relation.scopeEdgeIds.push(edge.id);
    relation.sourceEdgeIds.push(...edge.sourceEdgeIds || [edge.id]);
    relation.evidence.push(...edge.evidence || []);
    relation.layers.push(...edge.layers || []);
    relation.relationCount++;
  }
  for (const area of areas.values()) {
    area.internalEdgeIds.sort();
    area.internalSourceEdgeIds = [...new Set(area.internalSourceEdgeIds)].sort();
    const node = nodes.find(node => node.isArea && node.id === area.id);
    if (node) Object.assign(node, { internalEdgeCount: area.internalEdgeIds.length, internalEdgeIds: [...area.internalEdgeIds], internalSourceEdgeIds: [...area.internalSourceEdgeIds] });
  }
  const edges = [...grouped.values()].map(edge => ({
    ...edge, scopeEdgeIds: [...new Set(edge.scopeEdgeIds)].sort(), sourceEdgeIds: [...new Set(edge.sourceEdgeIds)].sort(),
    layers: [...new Set(edge.layers)].sort(), evidence: [...new Map(edge.evidence.map(item => [JSON.stringify(item), item])).values()]
  }));
  return { ...scope, nodes, edges, areaMode: true, areas: [...areas.values()], expandedAreaIds: [...areas.values()].filter(area => area.expanded).map(area => area.id), partNodes: scope.nodes, partEdges: scope.edges };
}

/** Resolve concrete source pairs behind a projected link; never infer missing edges. */
export function sourceRelations(graph, edge) {
  const edges = new Map([
    ...(graph.edges || []), ...(graph.symbolGraph?.edges || []), ...(graph.hierarchy?.edges || [])
  ].map(item => [item.id, item]));
  const nodes = new Map([...(graph.nodes || []), ...(graph.hierarchy?.nodes || [])].map(node => [node.id, node]));
  const ids = [...new Set(Array.isArray(edge.sourceEdgeIds) ? edge.sourceEdgeIds : [edge.id])];
  const references = [];
  const unresolvedSourceEdgeIds = [];
  for (const id of ids) {
    const source = edges.get(id);
    if (!source) { unresolvedSourceEdgeIds.push(id); continue; }
    references.push({ ...source, fromNode: nodes.get(source.from) ?? null, toNode: nodes.get(source.to) ?? null });
  }
  return { references, unresolvedSourceEdgeIds };
}
