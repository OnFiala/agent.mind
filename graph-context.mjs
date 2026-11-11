import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { indexProject } from './code-index.mjs';
import { attachOverview, resolvePart } from './project-map.mjs';
import { ancestorPath, descendantIds, scopeGraph, projectAreas } from './public/hierarchy.mjs';

export function projectContext(graph, selector, projectionOptions = {}) {
  if (projectionOptions.profile !== undefined) {
    if (projectionOptions.profile !== 'agent') throw new TypeError('Unknown context profile.');
    return agentContext(graph, selector, projectionOptions);
  }
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
    status: graph.status, inventory: graph.inventory, runtime: graph.runtime, target: selector ?? null,
    selection: selected ? { ...selected, blockId: owner.id, blockLabel: owner.label } : null,
    ancestry: ancestry.map(({ id, label, qualifiedLabel }) => ({ id, label, qualifiedLabel })),
    canvas: { scopeId: canvas.scopeId, breadcrumbs: canvas.breadcrumbs, nodes: canvas.nodes, edges: canvas.edges, areas: canvas.areas, areaMode: canvas.areaMode, omittedExternalEdges: canvas.omittedExternalEdges ?? 0 },
    partCanvas: { scopeId: partCanvas.scopeId, nodes: partCanvas.nodes, edges: partCanvas.edges },
    symbolGraph: { nodes: (graph.symbolGraph?.nodes ?? []).filter(node => !symbolIds || symbolIds.has(node.id)), edges: symbolEdges, diagnostics: (graph.symbolGraph?.diagnostics ?? []).filter(item => !selected || selected.fileIds.includes(`file:${item.path}`)) },
    nodes: graph.nodes.filter(node => !ids || ids.has(node.id)), edges,
    overview: { ...graph.overview, nodes: graph.overview.nodes.filter(node => !blockIds || blockIds.has(node.id)), edges: relations },
    vocabulary: graph.hierarchy.vocabulary,
    diagnostics: graph.diagnostics, scope: graph.scope,
    interpretation: 'The project map supplies names and areas. Source code determines nesting and connections. canvas groups parts into areas; partCanvas keeps the full set of parts. Links keep their direction, type and source references, including links within an area. Calls and HTTP/SSE links show code references, not observed execution. Run tests for results and coverage. Review Security links in source; this map does not perform a security audit.'
  };
}

// The opt-in wire budget is exactly UTF-8 JSON.stringify(response), without a
// newline or indentation. It bounds the response, not indexing CPU or memory.
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const canonicalJSON = value => JSON.stringify(canonicalValue(value));
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}
const ordered = values => values.map(value => ({ value, key: canonicalJSON(value) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.value);
const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const cursorError = message => Object.assign(new Error(message), { code: 'INVALID_CONTEXT_CURSOR' });

/** Start an explicit section at this response's snapshot; no server state. */
export function contextCursor(context, section) {
  if (context?.profile !== 'agent' || context.schemaVersion !== 1 || !context.sections?.some(item => item.kind === section)) throw cursorError('Unknown bounded context section.');
  return encodeCursor({ version: 1, snapshot: context.snapshot, section, offset: 0, fragment: 0 });
}

function readCursor(token, snapshot, sections, requestedSection) {
  try {
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const cursor = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (encodeCursor(cursor) !== token || Object.keys(cursor).sort().join(',') !== 'fragment,offset,section,snapshot,version' || cursor.version !== 1 || typeof cursor.section !== 'string' || !Object.hasOwn(sections, cursor.section) || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isSafeInteger(cursor.fragment) || cursor.fragment < 0 || (requestedSection !== undefined && requestedSection !== cursor.section)) throw new Error();
    if (cursor.snapshot !== snapshot) throw Object.assign(new Error('The context snapshot changed; resolve the selection again.'), { code: 'STALE_CONTEXT_CURSOR' });
    if (cursor.offset > sections[cursor.section].length || (cursor.offset === sections[cursor.section].length && cursor.fragment !== 0)) throw new Error();
    const text = cursor.offset < sections[cursor.section].length ? canonicalJSON(sections[cursor.section][cursor.offset]) : '';
    if (cursor.fragment && (cursor.fragment >= text.length || /[\uDC00-\uDFFF]/u.test(text[cursor.fragment]))) throw new Error();
    return cursor;
  } catch (error) {
    if (error.code === 'STALE_CONTEXT_CURSOR') throw error;
    throw cursorError('Invalid bounded context cursor.');
  }
}

function agentContext(graph, selector, options) {
  const { version = 1, maxBytes = 10000, cursor: token, section: requestedSection } = options;
  if (version !== 1) throw new TypeError('Unsupported agent context version.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw Object.assign(new RangeError('maxBytes must be an integer of at least 256 UTF-8 bytes.'), { code: 'INVALID_CONTEXT_BUDGET' });
  // Reuse the authoritative legacy scope and evidence; only the response changes.
  const full = projectContext(graph, selector);
  const selection = full.selection ? Object.fromEntries(['id', 'kind', 'path', 'label', 'qualifiedLabel', 'blockId', 'blockLabel'].filter(key => full.selection[key] !== undefined).map(key => [key, full.selection[key]])) : null;
  const contextKinds = ['sourceCoverage', 'localDiagnostic', 'edge', 'node', 'symbol', 'symbolEdge'];
  const selectedIds = full.selection ? new Set(full.selection.fileIds) : null;
  const localSources = full.nodes.filter(node => node.hash && (!selectedIds || selectedIds.has(node.id)));
  const localDiagnostics = full.diagnostics.filter(item => !selectedIds || selectedIds.has(`file:${item.path}`));
  const sections = {
    context: ordered([
      ...localSources.map(({ id, path, hash, bytes, capabilities }) => ({ kind: 'sourceCoverage', value: { id, path, hash, bytes, capabilities } })),
      ...full.nodes.map(value => ({ kind: 'node', value })),
      ...full.edges.map(value => ({ kind: 'edge', value })),
      ...full.symbolGraph.nodes.map(value => ({ kind: 'symbol', value })),
      ...full.symbolGraph.edges.map(value => ({ kind: 'symbolEdge', value })),
      ...localDiagnostics.map(value => ({ kind: 'localDiagnostic', value }))
    ]).sort((a, b) => contextKinds.indexOf(a.kind) - contextKinds.indexOf(b.kind)),
    diagnostics: ordered(full.diagnostics),
    symbolDiagnostics: ordered(full.symbolGraph.diagnostics),
    globalSymbolDiagnostics: ordered(graph.symbolGraph?.diagnostics ?? []),
    selectionDetails: full.selection ? [full.selection] : [],
    vocabulary: ordered(full.vocabulary),
    inventory: ordered(full.inventory?.entries ?? []),
    canvas: [full.canvas],
    partCanvas: [full.partCanvas],
    overview: [full.overview],
    scope: [full.scope]
  };
  const snapshot = createHash('sha256').update(canonicalJSON({ profile: 'agent', version: 1, project: full.project, revision: full.revision, binding: full.binding ?? null, selection: selection?.id ?? null, status: full.status, runtime: full.runtime ?? null, sections })).digest('hex');
  const position = token !== undefined ? readCursor(token, snapshot, sections, requestedSection) : { version: 1, snapshot, section: requestedSection ?? 'context', offset: 0, fragment: 0 };
  if (!Object.hasOwn(sections, position.section)) throw cursorError('Unknown bounded context section.');
  const stateCounts = {};
  for (const item of full.inventory?.entries ?? []) stateCounts[item.state] = (stateCounts[item.state] ?? 0) + 1;
  const countSeverity = items => Object.fromEntries(ordered([...new Set(items.map(item => item.severity ?? 'unspecified'))]).map(severity => [severity, items.filter(item => (item.severity ?? 'unspecified') === severity).length]));
  const base = {
    schemaVersion: 1, profile: 'agent', snapshot,
    project: full.project, revision: full.revision,
    ...(full.binding ? { binding: full.binding } : {}),
    ...(full.runtime ? { runtime: full.runtime } : {}),
    status: full.status, selection, ancestry: full.ancestry,
    coverage: { inventoryStatus: full.inventory?.status ?? null, inventoryEntries: full.inventory?.entries.length ?? 0, inventoryStates: Object.fromEntries(Object.entries(stateCounts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), selectedSources: localSources.length, testResults: 'not-observed' },
    uncertainty: { global: { diagnostics: full.diagnostics.length, severities: countSeverity(full.diagnostics), symbolDiagnostics: sections.globalSymbolDiagnostics.length }, local: { diagnostics: localDiagnostics.length, severities: countSeverity(localDiagnostics), symbolDiagnostics: full.symbolGraph.diagnostics.length }, excluded: full.scope.excluded.length, unsupported: full.scope.unsupported.length, limitations: full.scope.limitations },
    sections: Object.entries(sections).map(([kind, values]) => ({ kind, total: values.length, omitted: values.length, ...(kind === 'context' ? { kinds: contextKinds.map(kind => ({ kind, total: values.filter(item => item.kind === kind).length, omitted: values.filter(item => item.kind === kind).length })) } : {}) })),
    page: { section: position.section, offset: position.offset, items: [], fragments: [], next: null }
  };
  const values = sections[position.section];
  const result = (offset, fragment) => {
    const next = offset < values.length ? encodeCursor({ version: 1, snapshot, section: position.section, offset, fragment }) : null;
    base.page.next = next;
    // Omitted means absent as a complete value in this response, not client
    // reconstruction state. Even the final suffix remains omitted here.
    const completed = base.page.items.length;
    const manifest = base.sections.find(item => item.kind === position.section);
    manifest.omitted = values.length - completed;
    if (manifest.kinds) {
      const completedValues = base.page.items.map(item => item.value);
      for (const count of manifest.kinds) count.omitted = count.total - completedValues.filter(item => item.kind === count.kind).length;
    }
    return base;
  };
  const boundedError = requiredBytes => ({ schemaVersion: 1, profile: 'agent', error: { code: 'CONTEXT_BUDGET_TOO_SMALL', maxBytes, requiredBytes } });
  // Reserve an actual continuation token even before adding data. Required
  // identity/uncertainty is never removed to squeeze a successful response in.
  if (jsonBytes(result(position.offset, position.fragment)) > maxBytes) return boundedError(jsonBytes(base));
  let offset = position.offset;
  if (!position.fragment) {
    while (offset < values.length) {
      base.page.items.push({ index: offset, value: values[offset] });
      if (jsonBytes(result(offset + 1, 0)) > maxBytes) { base.page.items.pop(); result(offset, 0); break; }
      offset++;
    }
  }
  if (offset < values.length && !base.page.items.length) {
    const text = canonicalJSON(values[offset]);
    const start = position.fragment;
    const fragment = { index: offset, offset: start, total: text.length, encoding: 'json-text', text: '' };
    base.page.fragments.push(fragment);
    // Completing the item removes or changes the cursor. Try that case first
    // so its smaller envelope cannot be missed by an incomplete-prefix search.
    fragment.text = text.slice(start);
    if (jsonBytes(result(offset + 1, 0)) <= maxBytes) return base;
    let low = 0, high = text.length - start - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      fragment.text = text.slice(start, start + middle);
      if (jsonBytes(result(offset, start + middle)) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    // UTF-16 offsets are explicit; never split an astral Unicode code point.
    if (low && /[\uD800-\uDBFF]/u.test(text[start + low - 1])) low--;
    fragment.text = text.slice(start, start + low);
    if (!low) { fragment.text = text.slice(start, start + (text.codePointAt(start) > 65535 ? 2 : 1)); result(offset, start + fragment.text.length); return boundedError(jsonBytes(base)); }
    const end = start + low;
    result(end === text.length ? offset + 1 : offset, end === text.length ? 0 : end);
  } else result(offset, 0);
  return base;
}

export function freshContext(root, relative, indexOptions = {}, projectionOptions = {}) {
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
  return projectContext(checked, relative, projectionOptions);
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
