import path from 'node:path';
import { createHash } from 'node:crypto';
import { ancestorPath } from './public/hierarchy.mjs';

const TYPES = new Set(['interface', 'service', 'process', 'tests', 'config', 'document', 'module']);
const GROUPS = new Set(['core', 'tests', 'support']);
export const normalizeName = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
const sha = value => createHash('sha256').update(value).digest('hex');
const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..');
const diagnostic = message => ({ path: 'project-map.json', message, severity: 'warning' });

function validateConfiguration(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.blocks) || config.blocks.length > 64) throw new Error('The block map requires schemaVersion 1 and at most 64 blocks.');
  const ids = new Set();
  const names = new Map();
  for (const block of config.blocks) {
    if (!block || !/^[a-z][a-z0-9-]{0,63}$/.test(block.id) || ids.has(block.id)) throw new Error('Each block requires a unique stable ID.');
    if (typeof block.label !== 'string' || !block.label.trim() || block.label.length > 80 || typeof block.description !== 'string' || block.description.length > 300) throw new Error(`Block ${block.id} requires a valid name and short description.`);
    if (!TYPES.has(block.type) || !GROUPS.has(block.group)) throw new Error(`Block ${block.id} has an unknown type or group.`);
    if (!Array.isArray(block.files) || !block.files.every(safePath) || !Array.isArray(block.prefixes) || !block.prefixes.every(p => safePath(p) && p.endsWith('/'))) throw new Error(`Block ${block.id} contains invalid paths.`);
    if (!Array.isArray(block.aliases) || block.aliases.length > 16 || !block.aliases.every(alias => typeof alias === 'string' && alias.trim() && alias.length <= 80)) throw new Error(`Block ${block.id} contains invalid aliases.`);
    ids.add(block.id);
    for (const name of [block.label, ...block.aliases]) {
      const key = normalizeName(name);
      if (!key || names.has(key) && names.get(key) !== block.id) throw new Error(`The name "${name}" is ambiguous.`);
      names.set(key, block.id);
    }
  }
  return config.blocks;
}

function fallback(file) {
  if (file.kind === 'test') return { id: 'auto:tests', label: 'Tests', type: 'tests', group: 'tests', description: 'Test files and their static references.' };
  if (file.kind === 'document') return { id: 'auto:documents', label: 'Documentation', type: 'document', group: 'support', description: 'Project rules and documentation.' };
  if (file.kind === 'config') return { id: 'auto:config', label: 'Settings', type: 'config', group: 'support', description: 'Project configuration files.' };
  const folder = path.posix.dirname(file.path);
  const key = folder === '.' ? file.path : folder;
  return { id: `auto:${sha(key).slice(0, 16)}`, label: folder === '.' ? path.posix.basename(file.path) : folder, type: 'module', group: 'core', description: 'Grouped by path. Its purpose has not been named yet.', inferred: true };
}

/** Names/types describe source membership; all relationships come from the source graph. */
export function buildOverview(graph, configuration = null) {
  const diagnostics = [];
  let definitions = [];
  if (configuration !== null) {
    try { definitions = validateConfiguration(configuration); }
    catch (error) { diagnostics.push(diagnostic(error.message)); }
  }
  const files = graph.nodes.filter(node => node.path);
  const fileIds = new Set(files.map(node => node.id));
  const blocks = new Map();
  const membership = new Map();
  for (const file of files) {
    const matches = definitions.filter(block => block.files.includes(file.path) || block.prefixes.some(prefix => file.path.startsWith(prefix)));
    if (matches.length > 1) diagnostics.push(diagnostic(`File ${file.path} belongs to multiple blocks; using a neutral path group.`));
    const definition = matches.length === 1 ? matches[0] : fallback(file);
    const id = `block:${definition.id}`;
    if (!blocks.has(id)) blocks.set(id, {
      id, label: definition.label, type: definition.type, description: definition.description,
      aliases: [...new Set(definition.aliases ?? [])], group: definition.group,
      fileIds: [], layers: ['project'], primaryPath: null, inferred: matches.length !== 1
    });
    const block = blocks.get(id);
    block.fileIds.push(file.id);
    for (const layer of file.layers ?? []) if (!block.layers.includes(layer)) block.layers.push(layer);
    membership.set(file.id, id);
  }
  for (const definition of definitions) for (const expected of definition.files) {
    if (!files.some(file => file.path === expected)) diagnostics.push(diagnostic(`The name ${definition.label} refers to a missing file: ${expected}.`));
  }
  for (const block of blocks.values()) {
    block.fileIds.sort();
    const definition = definitions.find(d => `block:${d.id}` === block.id);
    block.primaryPath = definition?.files.find(p => membership.get(`file:${p}`) === block.id) ?? graph.nodes.find(n => n.id === block.fileIds[0])?.path ?? null;
  }
  // Configured names win. Inferred files must never make an existing name ambiguous.
  // The colon namespace cannot be produced by a configured stable ID.
  const claimedNames = new Set([...blocks.values()].filter(block => !block.inferred).flatMap(block => [block.label, ...block.aliases]).map(normalizeName));
  for (const block of [...blocks.values()].filter(block => block.inferred).sort((a, b) => a.id.localeCompare(b.id))) {
    const original = block.label;
    let suffix = 0;
    while (claimedNames.has(normalizeName(block.label))) block.label = `${original} · unassigned${++suffix > 1 ? ` ${suffix}` : ''}`;
    claimedNames.add(normalizeName(block.label));
  }
  const grouped = new Map();
  for (const edge of graph.edges) {
    if (!fileIds.has(edge.from) || !fileIds.has(edge.to)) continue;
    const from = membership.get(edge.from);
    const to = membership.get(edge.to);
    if (!from || !to || from === to) continue;
    const contract = ['http', 'event-stream', 'http-reference'].includes(edge.kind);
    const kind = contract ? 'contract' : 'dependency';
    const key = `${from}\0${to}\0${kind}`;
    if (!grouped.has(key)) grouped.set(key, {
      id: `relation:${sha(key).slice(0, 24)}`, from, to, kind,
      label: contract ? 'HTTP / events' : blocks.get(from).type === 'tests' ? 'test reference' : 'uses',
      evidence: [], sourceEdgeIds: [], layers: ['project'], provenance: contract ? 'static-contract' : 'source'
    });
    const relation = grouped.get(key);
    relation.sourceEdgeIds.push(edge.id);
    relation.evidence.push(...edge.evidence.map(item => ({ ...item })));
    for (const layer of edge.layers ?? []) if (!relation.layers.includes(layer)) relation.layers.push(layer);
  }
  for (const relation of grouped.values()) {
    relation.sourceEdgeIds.sort();
    if (relation.kind === 'contract') {
      const kinds = new Set(graph.edges.filter(edge => relation.sourceEdgeIds.includes(edge.id)).map(edge => edge.kind));
      relation.label = kinds.has('event-stream') ? (kinds.has('http') || kinds.has('http-reference') ? 'HTTP + SSE' : 'SSE') : 'HTTP';
    }
    relation.evidence = [...new Map(relation.evidence.map(item => [`${item.path}:${item.line}:${item.column}:${item.snippet}`, item])).values()];
  }
  const order = new Map(definitions.map((d, index) => [`block:${d.id}`, index]));
  const nodes = [...blocks.values()].sort((a, b) => (order.get(a.id) ?? 100) - (order.get(b.id) ?? 100) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, source: definitions.length ? 'project-map.json' : 'inferred',
    nodes, edges: [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id)), diagnostics,
    vocabulary: nodes.map(({ id, label, aliases, fileIds, type }) => ({ id, label, aliases, fileIds: [...fileIds], type }))
  };
}

export function buildHierarchy(graph, configuration = null) {
  const diagnostics = [];
  const rawFiles = new Map(graph.nodes.filter(node => node.path).map(node => [node.id, node]));
  const nodes = graph.overview.nodes.map(block => ({ ...block, parentId: null, sourceId: block.id, kind: 'block', hasChildren: false }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const block of graph.overview.nodes) for (const id of block.fileIds) {
    const file = rawFiles.get(id);
    if (!file) continue;
    const node = { ...file, sourceId: file.id, sourceName: file.path, parentId: block.id, kind: 'file', type: file.kind === 'test' ? 'tests' : file.kind === 'document' ? 'document' : file.kind === 'config' ? 'config' : 'module', description: file.path, aliases: [], group: 'core', fileIds: [file.id], hasChildren: false };
    nodes.push(node); byId.set(node.id, node);
  }
  const symbols = graph.symbolGraph?.nodes ?? [];
  const symbolIds = new Set(symbols.map(symbol => symbol.id));
  for (const symbol of symbols) {
    const file = rawFiles.get(`file:${symbol.path}`);
    if (!file) continue;
    const node = { ...symbol, label: symbol.name, sourceName: symbol.name, sourceId: symbol.id, parentId: symbol.parentId && symbolIds.has(symbol.parentId) ? symbol.parentId : file.id, kind: 'symbol', symbolKind: symbol.kind, type: symbol.kind === 'class' ? 'module' : 'process', description: `${symbol.kind === 'class' ? 'Class' : symbol.kind === 'method' ? 'Method' : 'Function'} · ${symbol.name}`, aliases: [], fileIds: [file.id], group: 'core', layers: [...new Set(['project', ...(file.kind === 'test' ? ['testing'] : []), ...((file.security ?? []).some(signal => signal.line >= symbol.line && signal.line <= symbol.endLine) ? ['security'] : [])])], hasChildren: false };
    nodes.push(node); byId.set(node.id, node);
  }
  const parts = configuration?.parts ?? [];
  if (!Array.isArray(parts) || parts.length > 512) diagnostics.push(diagnostic('Part names must be a list of at most 512 entries.'));
  else {
    const targets = new Set();
    for (const part of parts) {
      if (!part || typeof part.target !== 'string' || targets.has(part.target) || typeof part.label !== 'string' || !part.label.trim() || part.label.length > 80 || part.label.includes('/') || typeof part.description !== 'string' || part.description.length > 300 || (part.section !== undefined && (typeof part.section !== 'string' || !part.section.trim() || part.section.length > 48)) || !Array.isArray(part.aliases) || part.aliases.length > 16 || !part.aliases.every(alias => typeof alias === 'string' && alias.trim() && alias.length <= 80 && !alias.includes('/'))) {
        diagnostics.push(diagnostic('Invalid or duplicate part name.')); continue;
      }
      targets.add(part.target);
      const validSection = Boolean(part.section && typeof part.sectionId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(part.sectionId));
      if ((part.section !== undefined || part.sectionId !== undefined) && !validSection) diagnostics.push(diagnostic('A named area requires a stable sectionId slug; using Other parts until it is provided.'));
      const node = byId.get(part.target);
      if (!node || node.kind === 'block') { diagnostics.push(diagnostic(`The named part ${part.target} is missing from the current sources.`)); continue; }
      node.label = part.label;
      node.description = part.description;
      if (validSection) { node.section = part.section.trim(); node.sectionId = part.sectionId; }
      node.aliases = [...new Set([node.sourceName, ...part.aliases].filter(Boolean))];
      node.named = true;
    }
  }
  // Preserve every source part; disambiguate sibling display names deterministically.
  const used = new Map();
  for (const node of [...nodes].sort((a, b) => Number(Boolean(b.named)) - Number(Boolean(a.named)) || a.id.localeCompare(b.id))) {
    if (node.kind === 'block') continue;
    if (!used.has(node.parentId)) used.set(node.parentId, new Set());
    const names = used.get(node.parentId);
    const original = node.label;
    let suffix = 1;
    while (names.has(normalizeName(node.label))) node.label = `${original} · ${++suffix}`;
    names.add(normalizeName(node.label));
    // Display names may need suffixes, but every original source/declared name
    // remains a claim. Colliding claims must resolve as ambiguity.
    node.aliases = [...new Set([...(node.aliases ?? []), node.sourceName].filter(Boolean))];
  }
  for (const node of nodes) if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).hasChildren = true;
  const hierarchy = { schemaVersion: 1, nodes, edges: [...graph.edges, ...(graph.symbolGraph?.edges ?? [])], diagnostics };
  for (const node of nodes) node.qualifiedLabel = ancestorPath(hierarchy, node.id).map(part => part.label).join(' / ');
  hierarchy.vocabulary = nodes.map(({ id, parentId, label, qualifiedLabel, aliases, kind, path, fileIds, section, sectionId }) => ({ id, parentId, label, qualifiedLabel, aliases, kind, path, fileIds, ...(section ? { section, ...(sectionId ? { sectionId } : {}) } : {}) }));
  return hierarchy;
}

export function resolvePart(hierarchy, selector) {
  const nodes = hierarchy?.nodes ?? [];
  const direct = nodes.find(node => node.id === selector);
  if (direct) return direct;
  // An exact source filepath is a filesystem selector, like its file: ID.
  // Human labels and breadcrumbs below share one ambiguity rule.
  const sourceFile = nodes.find(node => node.kind === 'file' && node.path === selector);
  if (sourceFile) return sourceFile;
  if (String(selector).startsWith('area:')) throw new Error('Area selectors are presentation groups; use a member stable ID or full source path.');
  const normalizeSelector = value => String(value).split('/').map(normalizeName).join('/');
  const name = normalizeSelector(selector);
  const claims = part => [...new Set([part.label, part.sourceName, ...(part.aliases ?? [])].filter(Boolean))];
  // Qualified labels are one claim among all alias paths, never a priority rule.
  const matches = nodes.filter(node => {
    if (claims(node).some(alias => normalizeSelector(alias) === name)) return true;
    if (normalizeSelector(node.qualifiedLabel) === name) return true;
    return matchesPath(ancestorPath(hierarchy, node.id), String(selector).split('/').map(normalizeName));
  });
  if (matches.length > 1) {
    const candidates = matches.map(({ id, path, qualifiedLabel }) => ({ id, path: path ?? null, qualifiedLabel }));
    const error = new Error(`The name or path "${selector}" is ambiguous; matches multiple parts. Use a stable ID. Candidates: ${candidates.map(item => `${item.id} (${item.qualifiedLabel})`).join('; ')}`);
    error.code = 'AMBIGUOUS_SELECTOR';
    error.candidates = candidates;
    throw error;
  }
  return matches[0] ?? null;

  // A file label can itself contain '/'. Match complete segments against the
  // ancestor claims rather than treating every slash as a new source parent.
  function matchesPath(chain, segments) {
    let positions = new Set([0]);
    for (const part of chain) {
      const next = new Set();
      for (const index of positions) for (const alias of claims(part)) {
        const parts = String(alias).split('/').map(normalizeName);
        if (parts.every((value, offset) => segments[index + offset] === value)) next.add(index + parts.length);
      }
      positions = next;
      if (!positions.size) return false;
    }
    return positions.has(segments.length);
  }
}

export function attachOverview(graph) {
  const config = graph.metadata?.configuration ?? null;
  graph.overview = buildOverview(graph, config);
  if (graph.metadata && graph.overview.source !== 'inferred') graph.overview.source = graph.metadata.path;
  graph.hierarchy = buildHierarchy(graph, config);
  graph.overview.diagnostics.push(...graph.hierarchy.diagnostics);
  for (const item of graph.overview.diagnostics) item.path = graph.metadata?.path ?? item.path;
  if (graph.overview.diagnostics.length) {
    graph.status = 'partial';
    graph.diagnostics = [...graph.diagnostics, ...graph.overview.diagnostics];
  }
  return graph;
}

export function resolveBlock(overview, selector) {
  const direct = overview?.nodes.find(block => block.id === selector);
  if (direct) return direct;
  const name = normalizeName(selector);
  const matches = (overview?.nodes ?? []).filter(block => [block.label, ...block.aliases].some(alias => normalizeName(alias) === name));
  if (matches.length > 1) throw new Error(`The name "${selector}" is ambiguous; use a stable block ID.`);
  return matches[0] ?? null;
}
