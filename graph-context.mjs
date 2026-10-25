import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { indexProject } from './code-index.mjs';
import { attachOverview, resolvePart } from './project-map.mjs';
import { ancestorPath, descendantIds, scopeGraph, projectAreas } from './public/hierarchy.mjs';

export function projectContext(graph, selector) {
  if (!graph.hierarchy) attachOverview(graph);
  const selected = selector ? resolvePart(graph.hierarchy, selector) : null;
  if (selector && !selected) throw new Error('The file or named part is not in the active index.');
  const ancestry = selected ? ancestorPath(graph.hierarchy, selected.id) : [];
  const owner = ancestry[0] ?? null;
  const selectedIds = selected ? new Set(selected.fileIds) : null;
  const edges = selectedIds ? graph.edges.filter(edge => selectedIds.has(edge.from) || selectedIds.has(edge.to)) : graph.edges;
  const ids = selectedIds ? new Set([...selectedIds, ...edges.flatMap(edge => [edge.from, edge.to])]) : null;
  const relations = owner ? graph.overview.edges.filter(edge => edge.from === owner.id || edge.to === owner.id) : graph.overview.edges;
  const blockIds = owner ? new Set([owner.id, ...relations.flatMap(edge => [edge.from, edge.to])]) : null;
  const subtree = selected ? descendantIds(graph.hierarchy, selected.id) : null;
  const symbolEdges = (graph.symbolGraph?.edges ?? []).filter(edge => !subtree || subtree.has(edge.from) || subtree.has(edge.to));
  const symbolIds = subtree ? new Set([...subtree, ...symbolEdges.flatMap(edge => [edge.from, edge.to])]) : null;
  const partCanvas = scopeGraph(graph, selected?.hasChildren ? selected.id : selected?.parentId ?? null);
  const canvas = projectAreas(partCanvas);
  return {
    ...(graph.binding ? { binding: graph.binding } : {}),
    project: graph.project, revision: graph.revision, generatedAt: graph.generatedAt,
    status: graph.status, runtime: graph.runtime, target: selector ?? null,
    selection: selected ? { ...selected, blockId: owner.id, blockLabel: owner.label } : null,
    ancestry: ancestry.map(({ id, label, qualifiedLabel }) => ({ id, label, qualifiedLabel })),
    canvas: { scopeId: canvas.scopeId, breadcrumbs: canvas.breadcrumbs, nodes: canvas.nodes, edges: canvas.edges, areas: canvas.areas, areaMode: canvas.areaMode, omittedExternalEdges: canvas.omittedExternalEdges ?? 0 },
    partCanvas: { scopeId: partCanvas.scopeId, nodes: partCanvas.nodes, edges: partCanvas.edges },
    symbolGraph: { nodes: (graph.symbolGraph?.nodes ?? []).filter(node => !symbolIds || symbolIds.has(node.id)), edges: symbolEdges, diagnostics: (graph.symbolGraph?.diagnostics ?? []).filter(item => !selected || selected.fileIds.includes(`file:${item.path}`)) },
    nodes: graph.nodes.filter(node => !ids || ids.has(node.id)), edges,
    overview: { ...graph.overview, nodes: graph.overview.nodes.filter(node => !blockIds || blockIds.has(node.id)), edges: relations },
    vocabulary: graph.hierarchy.vocabulary,
    diagnostics: graph.diagnostics, scope: graph.scope,
    interpretation: 'Names and areas are project metadata; ancestry and relationships come from source. The default canvas groups areas, while partCanvas retains their members. Links preserve direction, types and source evidence; internal links remain attached to each area. Calls and HTTP/SSE are static references, not runtime proof. Test references are not coverage; Security is not an audit.'
  };
}

export function freshContext(root, relative, indexOptions = {}) {
  const { expectedRevision, ...options } = indexOptions;
  const first = indexProject(root, options);
  const checked = indexProject(root, { ...options, previous: first });
  if (first.revision !== checked.revision) throw new Error('The project changed during the read. Repeat the context preflight.');
  if (expectedRevision !== undefined && expectedRevision !== checked.revision) {
    const error = new Error('The project revision changed; repeat context resolution before acting.');
    error.code = 'STALE_REVISION';
    error.expectedRevision = expectedRevision;
    error.actualRevision = checked.revision;
    throw error;
  }
  return projectContext(checked, relative);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifact.json'))) throw new Error('Use the installed agent.mind/cli.mjs context command to verify the target project binding.');
    const context = freshContext(process.env.AGENT_MIND_PROJECT || path.dirname(fileURLToPath(import.meta.url)), process.argv[2]);
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
