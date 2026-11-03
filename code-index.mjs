import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isUtf8 } from 'node:buffer';
import { analyzeSource, securityModule } from './source-analysis.mjs';
import { isTypedSource } from './typed-analysis.mjs';

// This index is descriptive. It never imports, evaluates, or runs scanned files.
export const INDEX_LIMITS = Object.freeze({ files: 1000, fileBytes: 512 * 1024, totalBytes: 16 * 1024 * 1024, entries: 10000, depth: 20 });
// Existing analysis/resolver scope; inventory and safe text reads are independent.
const EXTENSIONS = new Set(['.mjs', '.js', '.json', '.html', '.css', '.md', '.py']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'backups', 'evidence', 'workspace', 'legacy', 'coverage']);
const GENERIC_EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const UNSUPPORTED_SOURCE = /\.(?:ts|tsx|jsx|mts|cts|pyi|go|rs|java|swift|kt|c|h|cpp|cs|rb|php|vue|svelte)$/i;
const CACHE = new WeakMap();
const sha = value => createHash('sha256').update(value).digest('hex');
const fileId = relative => `file:${relative}`;
const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const posix = name => name.split(path.sep).join('/');
const isTest = name => /(^|\/)(test|tests)\//.test(name) || /\.(test|spec)\.(m?js|py|ts|tsx|jsx)$/.test(name) || /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(name);
const sensitive = name => /(?:^|\.)env(?:[.-]|$)/i.test(name)
  || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-]|$)/i.test(name)
  || /(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)/i.test(name)
  || /\.(?:pem|key|p8|ppk|p12|pfx)(?:[._-]|$)/i.test(name);

function kindFor(relative) {
  if (!EXTENSIONS.has(path.extname(relative)) && !isTypedSource(relative)) return 'file';
  if (isTest(relative)) return 'test';
  const extension = path.extname(relative);
  return extension === '.md' ? 'document' : extension === '.json' ? 'config' : ['.html', '.css'].includes(extension) ? 'asset' : 'source';
}

function languageFor(relative) {
  if (isTypedSource(relative)) return relative.endsWith('.jsx') ? 'jsx' : relative.endsWith('.tsx') ? 'tsx' : 'typescript';
  return ({ '.mjs': 'javascript', '.js': 'javascript', '.json': 'json', '.html': 'html', '.css': 'css', '.md': 'markdown', '.py': 'python' })[path.extname(relative)];
}

// This is an encoding check, not a file-format parser or secret detector.
const isText = bytes => isUtf8(bytes) && !bytes.some(byte => byte === 127 || byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13);

function capabilitiesFor(relative) {
  const extension = path.extname(relative);
  if (extension === '.js' || extension === '.mjs') return ['text', 'javascript-syntax', 'static-references', 'named-symbols', 'local-calls', 'security-signals'];
  if (isTypedSource(relative)) return ['text', ...(extension === '.jsx' ? [] : ['typescript-syntax']), ...(extension === '.ts' ? [] : ['jsx-syntax']), 'named-symbols'];
  if (extension === '.py') return ['text', 'python-syntax', 'static-references', 'named-symbols', 'local-calls'];
  if (extension === '.html') return ['text', 'html-assets'];
  if (extension === '.json') return ['text', 'json-validation'];
  return ['text'];
}

/** Check every component again before opening. O_NOFOLLOW protects the final file. */
function checkedPath(root, relative) {
  const candidate = path.resolve(root, relative);
  if (!isInside(root, candidate) || candidate === root) throw new Error('Path is outside the index root');
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are excluded');
  }
  if (!isInside(root, fs.realpathSync(candidate))) throw new Error('Resolved path is outside the index root');
  return candidate;
}

function readBounded(root, relative, available) {
  const absolute = checkedPath(root, relative);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(descriptor);
    const current = fs.lstatSync(checkedPath(root, relative));
    if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino) throw new Error('File changed during boundary check');
    if (stat.size > INDEX_LIMITS.fileBytes || stat.size > available) throw Object.assign(new Error('Read budget exceeded'), { inventoryState: stat.size > INDEX_LIMITS.fileBytes ? 'too-large' : 'budget-exceeded', bytes: stat.size });
    // Read at most the original size + one byte, even if another process grows it.
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(descriptor);
    if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('File changed while reading; retry on the next scan');
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(descriptor);
  }
}

function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.endsWith('/') && value === path.posix.normalize(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.split('/').some(component => component === '..' || component.startsWith('.') || sensitive(component));
}

function indexingPolicy({ generic = false, excludePaths = [], metadataPath = 'project-map.json' } = {}) {
  if (!Array.isArray(excludePaths) || !excludePaths.every(relativePath)) throw new Error('excludePaths must contain safe relative paths without trailing slashes.');
  if (!relativePath(metadataPath) || path.posix.extname(metadataPath) !== '.json' || metadataPath.split('/').includes('node_modules')) throw new Error('metadataPath must be a safe relative JSON path.');
  return { generic: Boolean(generic), excludePaths: [...new Set(excludePaths)].sort(), metadataPath, excludedDirs: generic ? GENERIC_EXCLUDED_DIRS : EXCLUDED_DIRS };
}

const excludedByPolicy = (relative, policy) => relative.split('/').some(component => policy.excludedDirs.has(component)) || policy.excludePaths.some(excluded => relative === excluded || relative.startsWith(`${excluded}/`));

// Metadata is read independently of inventory so an excluded integration folder
// can hold the single target vocabulary. It never falls back to a second map.
function namingMetadata(root, policy, diagnostics, explicitlySelected) {
  const result = { path: policy.metadataPath, hash: null, status: 'missing', configuration: null };
  try {
    const bytes = readBounded(root, policy.metadataPath, INDEX_LIMITS.fileBytes);
    result.hash = sha(bytes);
    result.configuration = JSON.parse(bytes.toString('utf8'));
    if (!result.configuration || typeof result.configuration !== 'object' || Array.isArray(result.configuration)) {
      result.configuration = null;
      throw new Error('Project map must be a JSON object.');
    }
    result.status = 'current';
  } catch (error) {
    if (error.code !== 'ENOENT' || explicitlySelected) {
      result.status = 'error';
      diagnostics.push({ path: policy.metadataPath, message: `Cannot load names: ${error.message}`, severity: 'warning' });
    }
  }
  return result;
}

/** Read the exact indexed source version; reject stale hashes and excluded paths. */
export function readIndexedSource(directory, node, indexOptions = {}) {
  const policy = indexingPolicy(indexOptions);
  const relative = node?.path;
  if (!relativePath(relative) || excludedByPolicy(relative, policy) || !node.capabilities?.includes('text') || node.id !== fileId(relative) || !/^[a-f\d]{64}$/.test(node.hash ?? '')) throw new Error('Source is not an eligible indexed file');
  const requestedRoot = path.resolve(directory);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error('Index root must not be a symbolic link');
  const root = fs.realpathSync(requestedRoot);
  const bytes = readBounded(root, relative, INDEX_LIMITS.fileBytes);
  if (sha(bytes) !== node.hash) throw new Error('Indexed source changed; refresh the graph before reading');
  if (!isText(bytes)) throw new Error('Indexed file is not supported UTF-8 text');
  return bytes.toString('utf8');
}

function inventory(root, diagnostics, excluded, policy, unsupported, records) {
  const files = [];
  let entries = 0;
  let exhausted = false;
  function visit(relative, depth) {
    if (entries > INDEX_LIMITS.entries) return;
    if (depth > INDEX_LIMITS.depth) {
      records.push({ path: relative + '/', state: 'unscanned', reason: 'depth-limit' });
      diagnostics.push({ path: relative, message: 'Directory depth budget exceeded', severity: 'warning' });
      return;
    }
    try {
      const directory = relative ? checkedPath(root, relative) : root;
      const handle = fs.opendirSync(directory);
      const directoryEntries = [];
      try {
        let entry;
        while ((entry = handle.readSync())) {
          if (++entries > INDEX_LIMITS.entries) {
            if (!exhausted) {
              records.push({ path: relative || '.', state: 'unscanned', reason: 'entry-limit' });
              diagnostics.push({ path: relative || '.', message: 'Inventory budget exceeded; some files are omitted', severity: 'warning' });
            }
            exhausted = true;
            break;
          }
          directoryEntries.push(entry);
        }
      } finally {
        handle.closeSync();
      }
      for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const name = posix(path.join(relative, entry.name));
        if (files.length >= INDEX_LIMITS.files) {
          if (!exhausted) {
            records.push({ path: relative || '.', state: 'unscanned', reason: 'file-limit' });
            diagnostics.push({ path: name, message: 'Inventory budget exceeded; some files are omitted', severity: 'warning' });
          }
          exhausted = true;
          return;
        }
        if (entry.isSymbolicLink()) {
          excluded.add(`${name} (symlink)`);
          records.push({ path: name, state: 'excluded', reason: 'symlink' });
          continue;
        }
        if (entry.name === '.DS_Store' || sensitive(entry.name) || entry.name.startsWith('.') || excludedByPolicy(name, policy)) {
          excluded.add(`${name}${entry.isDirectory() ? '/' : ''}`);
          records.push({ path: name + (entry.isDirectory() ? '/' : ''), state: 'excluded', reason: sensitive(entry.name) ? 'sensitive-name' : entry.name.startsWith('.') ? 'hidden' : 'policy' });
          continue;
        }
        if (entry.isDirectory()) visit(name, depth + 1);
        else if (entry.isFile()) {
          files.push(name);
          if (UNSUPPORTED_SOURCE.test(entry.name) && !isTypedSource(name)) unsupported.add(name);
        } else records.push({ path: name, state: 'excluded', reason: 'special-file' });
      }
    } catch (error) {
      records.push({ path: relative || '.', state: 'unreadable', reason: error.message });
      diagnostics.push({ path: relative || '.', message: `Cannot list directory: ${error.message}`, severity: 'warning' });
    }
  }
  visit('', 0);
  return files.sort();
}

// Python resolution describes one documented source layout, never sys.path or a
// running interpreter. Only already indexed UTF-8 .py files can be candidates.
function resolvePythonReference(relative, reference, available) {
  const specifier = reference.specifier;
  const python = reference.python;
  const identifier = /^[_\p{ID_Start}][_\p{ID_Continue}]*$/u;
  // Python normalizes identifier tokens before module lookup. Normalize only
  // source-spelled segments; inventory paths retain their exact filesystem names.
  const parts = typeof python.module === 'string' && python.module ? python.module.split('.').map(part => part.normalize('NFKC')) : [];
  if (!Number.isSafeInteger(python.level) || python.level < 0 || !['import', 'from'].includes(python.form)
      || typeof python.module !== 'string' || parts.some(part => !identifier.test(part))
      || (!parts.length && (!python.level || python.form !== 'from'))) {
    return { error: `Malformed Python module reference: ${specifier}` };
  }
  let base = '';
  if (python.level) {
    const packages = [];
    let directory = path.posix.dirname(relative);
    while (directory !== '.' && available.has(`${directory}/__init__.py`)) {
      packages.push(directory);
      directory = path.posix.dirname(directory);
    }
    if (python.level > packages.length) return { error: `Python relative import leaves the indexed regular package: ${specifier}` };
    base = packages[python.level - 1];
  }
  const modulePath = path.posix.join(base, ...parts);
  // A dotted source module requires indexed regular-package ancestry. Relative
  // imports already established their base; only additional dotted dirs remain.
  const packageDirectories = parts.slice(0, -1).map((_, index) => path.posix.join(base, ...parts.slice(0, index + 1)));
  const missingPackage = packageDirectories.find(directory => !available.has(`${directory}/__init__.py`));
  const candidates = parts.length ? [`${modulePath}.py`, `${modulePath}/__init__.py`] : [`${base}/__init__.py`];
  const eligible = missingPackage ? [] : candidates.filter(candidate => available.has(candidate));
  if (eligible.length > 1) return { error: `Ambiguous Python source module (module/package collision): ${specifier}` };
  if (!eligible.length) {
    if (python.level) return { error: `Unresolved local Python module in the indexed regular package: ${specifier}` };
    return { external: `python:${specifier}`, label: `${specifier} (external/unresolved Python)`, info: `Python import is external or unresolved in the project-root regular-package layout: ${specifier}. No environment or namespace-package resolution is inferred.` };
  }
  const info = python.form === 'from' && !parts.length
    ? `Python from-import members remain ambiguous attributes or submodules: ${specifier}. Only the containing package is referenced.` : undefined;
  return { ...(!parts.length && eligible[0] === relative ? { ignored: true } : { target: eligible[0] }), info };
}

function resolveReference(relative, reference, available) {
  if (reference.python) return resolvePythonReference(relative, reference, available);
  let specifier = reference.specifier;
  const resource = reference.html || ['asset', 'test-reference'].includes(reference.kind);
  if (resource) {
    // Browser absolute asset paths refer to the public directory when present.
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(specifier)) return { external: specifier };
    specifier = specifier.split(/[?#]/)[0];
    if (!specifier) return { ignored: true };
    try { specifier = decodeURIComponent(specifier); } catch { return { error: 'Invalid encoded asset path' }; }
    if (reference.html && specifier.startsWith('/')) {
      const target = path.posix.normalize(`${relative.startsWith('public/') ? 'public/' : ''}${specifier.slice(1)}`);
      return available.has(target) ? { target } : { error: `Unresolved local asset: ${reference.specifier}` };
    }
  }
  if (specifier.startsWith('/') || specifier.startsWith('file:')) return { error: `Absolute file reference is outside the supported project-relative resolver: ${specifier}` };
  if (specifier.startsWith('.') || resource) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    if (target === '..' || target.startsWith('../') || target.startsWith('/')) return { error: `Reference leaves the project boundary: ${reference.specifier}` };
    return available.has(target) ? { target } : { error: `Unresolved local reference: ${reference.specifier}` };
  }
  return { external: specifier };
}

/** Read-only synchronous file graph. Reuse the exact previous result to cache parsing. */
export function indexProject(directory, options = {}) {
  const { previous } = options;
  const policy = indexingPolicy(options);
  const started = performance.now();
  const requestedRoot = path.resolve(directory);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error('Index root must not be a symbolic link');
  const root = fs.realpathSync(requestedRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('Index root must be a directory');
  const diagnostics = [];
  const excluded = new Set([...policy.excludedDirs].map(name => `${name}/`).concat(policy.excludePaths.map(name => `${name}/`)));
  const unsupported = new Set();
  const inventoryEntries = [];
  const files = inventory(root, diagnostics, excluded, policy, unsupported, inventoryEntries);
  let inventoryComplete = diagnostics.length === 0;
  for (const name of unsupported) diagnostics.push({ path: name, message: 'Unsupported source language; file is outside source analysis.', severity: 'warning' });
  const metadata = namingMetadata(root, policy, diagnostics, Object.hasOwn(options, 'metadataPath'));
  const priorCache = previous?.project?.root === root ? CACHE.get(previous) : null;
  const nextCache = new Map();
  const nodes = [];
  const analyses = new Map();
  let totalBytes = 0;
  let cachedFiles = 0;
  for (const relative of files) {
    try {
      const bytes = readBounded(root, relative, INDEX_LIMITS.totalBytes - totalBytes);
      totalBytes += bytes.length;
      const hash = sha(bytes);
      const text = isText(bytes);
      inventoryEntries.push({ path: relative, state: text ? 'text' : 'binary', bytes: bytes.length, hash });
      if (!text) {
        if (EXTENSIONS.has(path.extname(relative)) || isTypedSource(relative)) diagnostics.push({ path: relative, message: 'Non-text or unsupported encoding; source analysis skipped.', severity: 'warning' });
        continue;
      }
      const cached = priorCache?.get(relative);
      const analysis = cached?.hash === hash ? (cachedFiles++, cached.analysis) : analyzeSource(relative, bytes.toString('utf8'), hash, isTest(relative));
      nextCache.set(relative, { hash, analysis });
      if (EXTENSIONS.has(path.extname(relative)) || isTypedSource(relative)) analyses.set(relative, analysis);
      const layers = ['project', ...(isTest(relative) ? ['testing'] : []), ...(analysis.security.length ? ['security'] : [])];
      // Clones prevent a consumer modifying its serialized result from poisoning the cache.
      nodes.push({ id: fileId(relative), path: relative, label: path.posix.basename(relative), kind: kindFor(relative), language: languageFor(relative), hash, bytes: bytes.length, capabilities: capabilitiesFor(relative), ...(analysis.producer ? { producer: structuredClone(analysis.producer) } : {}), layers, symbols: structuredClone(analysis.symbols), security: structuredClone(analysis.security), diagnostics: structuredClone(analysis.diagnostics) });
      diagnostics.push(...structuredClone(analysis.diagnostics));
    } catch (error) {
      inventoryComplete = false;
      inventoryEntries.push({ path: relative, state: error.inventoryState || 'unreadable', ...(error.bytes === undefined ? {} : { bytes: error.bytes }), reason: error.message });
      diagnostics.push({ path: relative, message: `Cannot index file: ${error.message}`, severity: 'warning' });
    }
  }
  const available = new Map(nodes.map(node => [node.path, node]));
  // Inventory-only text cannot turn a previously unresolved reference into an edge.
  const resolvable = new Map([...available].filter(([relative]) => EXTENSIONS.has(path.extname(relative))));
  const externalNodes = new Map();
  const groupedEdges = new Map();
  for (const [relative, analysis] of analyses) for (const reference of analysis.references) {
    const resolved = resolveReference(relative, reference, resolvable);
    if (resolved.info) {
      const diagnostic = { ...structuredClone(reference.evidence), message: resolved.info, severity: 'info' };
      diagnostics.push(diagnostic);
      available.get(relative).diagnostics.push(diagnostic);
    }
    if (resolved.ignored) continue;
    if (resolved.error) {
      const diagnostic = { ...(reference.python ? structuredClone(reference.evidence) : { path: relative, line: reference.evidence.line }), message: resolved.error, severity: 'warning' };
      diagnostics.push(diagnostic);
      available.get(relative).diagnostics.push(diagnostic);
      continue;
    }
    const from = fileId(relative);
    const to = resolved.target ? fileId(resolved.target) : `external:${resolved.external}`;
    const testing = isTest(relative) || (resolved.target && isTest(resolved.target));
    const security = Boolean(!reference.python && resolved.external && securityModule(resolved.external));
    const layers = ['project', ...(testing ? ['testing'] : []), ...(security ? ['security'] : [])];
    if (resolved.external && !externalNodes.has(to)) externalNodes.set(to, { id: to, path: null, label: resolved.label ?? resolved.external, kind: 'external', layers: ['project'], symbols: [], security: [], diagnostics: [] });
    const target = resolved.target ? available.get(resolved.target) : externalNodes.get(to);
    for (const layer of layers) if (!target.layers.includes(layer)) target.layers.push(layer);
    if (testing && !available.get(relative).layers.includes('testing')) available.get(relative).layers.push('testing');
    const key = `${from}\0${reference.kind}\0${to}`;
    if (!groupedEdges.has(key)) groupedEdges.set(key, { id: `edge:${sha(key).slice(0, 24)}`, from, to, kind: reference.kind, label: reference.kind, layers, evidence: [] });
    groupedEdges.get(key).evidence.push(structuredClone(reference.evidence));
  }
  const providers = [...analyses].flatMap(([relative, analysis]) => (analysis.contracts?.providers ?? []).map(provider => ({ relative, ...provider })));
  for (const [relative, analysis] of analyses) for (const consumer of analysis.contracts?.consumers ?? []) {
    const candidates = providers.filter(provider => provider.pathname === consumer.pathname && (!provider.method || !consumer.method || provider.method === consumer.method));
    let message;
    if (!candidates.length) message = `No supported method-compatible HTTP handler for ${consumer.pathname}`;
    else if (candidates.length > 1) message = `Ambiguous HTTP handlers for ${consumer.pathname}: ${candidates.map(provider => `${provider.relative}:${provider.evidence.line}`).join(', ')}`;
    else if (consumer.kind === 'event-stream' && !candidates[0].eventStream) message = `No static text/event-stream response evidence for ${consumer.pathname}`;
    if (message) {
      const diagnostic = { path: relative, line: consumer.evidence.line, message, severity: 'warning' };
      diagnostics.push(diagnostic);
      available.get(relative).diagnostics.push(diagnostic);
      continue;
    }
    const provider = candidates[0];
    const from = fileId(relative);
    const to = fileId(provider.relative);
    const key = `${from}\0${consumer.kind}\0${to}\0${consumer.pathname}\0${consumer.method ?? '?'}`;
    const layers = ['project', 'security', ...(isTest(relative) || isTest(provider.relative) ? ['testing'] : [])];
    for (const endpoint of [available.get(relative), available.get(provider.relative)]) for (const layer of layers) if (!endpoint.layers.includes(layer)) endpoint.layers.push(layer);
    if (!groupedEdges.has(key)) groupedEdges.set(key, {
      id: `edge:${sha(key).slice(0, 24)}`, from, to, kind: consumer.kind,
      label: `${consumer.kind === 'event-stream' ? 'SSE' : 'HTTP'} ${consumer.pathname}`,
      layers, provenance: 'static-contract', certainty: 'static-contract',
      contract: { pathname: consumer.pathname, consumerMethod: consumer.method, providerMethod: provider.method, methodAssurance: consumer.method && provider.method ? 'matched' : 'unknown' },
      evidence: []
    });
    const evidence = groupedEdges.get(key).evidence;
    for (const [role, source] of [['consumer', consumer.evidence], ['handler', provider.evidence], ['server', provider.factoryEvidence], ['request-url', provider.urlEvidence], ['response', provider.responseEvidence], ...(consumer.kind === 'event-stream' ? [['event-stream-header', provider.streamEvidence]] : [])]) {
      if (!evidence.some(item => item.role === role && item.path === source.path && item.line === source.line && item.column === source.column)) evidence.push({ ...structuredClone(source), role, hash: available.get(source.path).hash });
    }
  }
  nodes.push(...externalNodes.values());
  nodes.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const edges = [...groupedEdges.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const symbolGraph = { nodes: [], edges: [], diagnostics: [] };
  for (const analysis of analyses.values()) for (const key of ['nodes', 'edges', 'diagnostics']) symbolGraph[key].push(...structuredClone(analysis.symbolGraph?.[key] ?? []));
  symbolGraph.nodes.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  symbolGraph.edges.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  for (const diagnostic of symbolGraph.diagnostics) if (['warning', 'error'].includes(diagnostic.severity) && !diagnostics.some(item => item.path === diagnostic.path && item.line === diagnostic.line && item.message === diagnostic.message)) {
    diagnostics.push(structuredClone(diagnostic));
    available.get(diagnostic.path)?.diagnostics.push(structuredClone(diagnostic));
  }
  for (const edge of edges) edge.evidence.sort((a, b) => a.line - b.line || a.column - b.column);
  diagnostics.sort((a, b) => a.path.localeCompare(b.path, 'en') || (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message, 'en'));
  const scope = {
    excluded: [...excluded].sort(),
    unsupported: [...unsupported].sort(),
    generic: policy.generic,
    metadataPath: policy.metadataPath,
    limitations: [
      'The map reads source files without running them. Security signals point to code to review; they do not establish vulnerabilities or safety.',
      'Test links come from source references. Run tests for results and enable coverage to measure what they cover.',
      'Acorn parses JavaScript modules. The map resolves literal imports, reexports, dynamic imports and new URL(literal, import.meta.url). It does not resolve CommonJS require, computed paths or aliases, or guess missing extensions.',
      'HTTP/SSE links match code on both sides of a request; they do not show requests that ran. A nonshadowed fetch/EventSource call must use a fixed same-origin /api path; query strings may be dynamic. It must match one inline handler passed to an imported http.createServer, with one unmodified new URL(request.url, base) binding and an exact pathname check. SSE also requires code that sets an event-stream response. Frameworks, indirect handlers, computed paths and multiple possible providers are unsupported. Each match states what is known about its HTTP method.',
      'Functions and classes are nested as they appear in source. Call links cover direct same-file references and known this.method calls within a class. They do not show runtime execution, callback scheduling, dynamic dispatch, coverage or control flow. Imported, aliased and computed calls, class fields and static-block bodies are omitted. Ambiguous or directly reassigned bindings and methods are excluded. Anonymous closures use the nearest named owner and carry a nested-closure marker. Per-file limits apply to symbols, calls, AST nodes and nesting depth.',
      'HTML analysis reads script src and link href. It skips inline scripts, CSS imports and URLs, and Markdown links.',
      'Inventory includes bounded regular files independently of language support. UTF-8 text without binary controls can be read by indexed hash. Binary, unreadable, oversized and unscanned entries have explicit states; excluded directories are not traversed. Hidden/sensitive paths, symlinks and configured exclusions remain excluded.',
      'File capabilities name available operations, not successful analysis or coverage. Text-only files have no inferred symbols or dependencies; source-reference resolution retains the existing .mjs/.js/.json/.html/.css/.md/.py scope. Known unsupported source extensions retain partial diagnostics.',
      ...([...analyses.keys()].some(name => name.endsWith('.py')) ? ['Python provides bounded declarations, literal module imports and conservative bare same-file calls (64 KiB per file), using an editor grammar rather than CPython validation. Imports map only project-root modules and indexed regular packages, or explicit relatives within contiguous indexed regular packages; namespace packages, custom source roots, sys.path and environment resolution are not inferred. From-import members are attributes or submodules, never guessed file edges. Imported/member calls, types, security, framework/runtime behavior, decorator effects, notebooks and .pyi files remain outside scope. Recovery errors and traversal limits withhold relationships; ambiguity remains explicit. Parser limits are not timeouts or a sandbox.'] : []),
      ...([...analyses.keys()].some(isTypedSource) ? ['TS/TSX/JSX pilot provides syntax and bounded named declarations only (64 KiB per file); no import/type/call/security/HTTP analysis. Both directions of cross-language resolution remain disabled. Ambient .d.ts, .mts/.cts, decorators and embedded scripts are outside this pilot. Parse errors and ambiguity withhold affected symbols; traversal limits withhold all symbols from the file. Parser and traversal limits are not timeouts or a sandbox.'] : []),
      `Scan limits: ${INDEX_LIMITS.files} files, ${INDEX_LIMITS.fileBytes} bytes per file, ${INDEX_LIMITS.totalBytes} total bytes, ${INDEX_LIMITS.entries} directory entries, depth ${INDEX_LIMITS.depth}.`,
      'Source reads reject symlinks and check each file\'s real path and inode. Files can still change during a scan; incomplete reads are reported in diagnostics.'
    ]
  };
  const inventorySnapshot = { status: inventoryComplete ? 'complete' : 'partial', entries: inventoryEntries.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.state.localeCompare(b.state, 'en')) };
  const result = {
    schemaVersion: 1,
    project: { name: path.basename(root), root },
    revision: sha(JSON.stringify({ inventory: inventorySnapshot, nodes, edges, symbolGraph, diagnostics, excluded: scope.excluded, generic: policy.generic, metadata: { path: metadata.path, hash: metadata.hash, status: metadata.status } })),
    generatedAt: new Date().toISOString(),
    status: diagnostics.some(item => item.severity === 'warning' || item.severity === 'error') ? 'partial' : 'current',
    nodes, edges, symbolGraph, diagnostics, metadata, inventory: inventorySnapshot,
    stats: { files: available.size, edges: edges.length, tests: [...available.values()].filter(node => node.kind === 'test').length, security: [...available.values()].filter(node => node.security.length).length, parseMs: Math.round((performance.now() - started) * 100) / 100, cachedFiles },
    scope
  };
  CACHE.set(result, nextCache);
  return result;
}
