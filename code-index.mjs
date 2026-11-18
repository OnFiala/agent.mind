import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { analyzeSource, securityModule } from './source-analysis.mjs';
import { isTypedSource } from './typed-analysis.mjs';
import { normalizeResolverOptions, validateResolverConfig, resolveTypedReference, TYPED_RESOLVER_LIMITS, TYPED_RESOLUTION_VERSION, TYPED_CANDIDATE_DOMAIN_VERSION } from './typed-resolution.mjs';
import { sanitizeNamingMetadata } from './project-map.mjs';

// This index is descriptive. It never imports, evaluates, or runs scanned files.
export const INDEX_LIMITS = Object.freeze({ files: 1000, fileBytes: 512 * 1024, totalBytes: 16 * 1024 * 1024, entries: 10000, depth: 20 });
// Existing analysis/resolver scope; inventory and safe text reads are independent.
const EXTENSIONS = new Set(['.mjs', '.js', '.json', '.html', '.css', '.md', '.py']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'backups', 'evidence', 'workspace', 'legacy', 'coverage']);
const GENERIC_EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const UNSUPPORTED_SOURCE = /\.(?:cjs|ts|tsx|jsx|mts|cts|pyi|go|rs|java|swift|kt|c|h|cpp|cs|rb|php|vue|svelte)$/i;
// Allocation priority only; these suffixes grant no additional analysis support.
const sourcePriority = relative => ['.js', '.mjs', '.py'].includes(path.extname(relative)) || isTypedSource(relative) || UNSUPPORTED_SOURCE.test(relative) ? 0 : 1;
const ordinalCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const CACHE = new WeakMap();
const sha = value => createHash('sha256').update(value).digest('hex');
const fileId = relative => `file:${relative}`;
const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
// Bind source-mode and installed-mode resolution to the executing implementation.
// These are this runtime's own files, never files from the scanned project.
const RESOLVER_RUNTIME_ID = sha(['code-index.mjs', 'typed-resolution.mjs', 'typed-analysis.mjs', 'source-analysis.mjs'].map(name => sha(fs.readFileSync(fileURLToPath(new URL(name, import.meta.url))))).join(':'));
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
  if (isTypedSource(relative)) return ['text', ...(extension === '.jsx' ? [] : ['typescript-syntax']), ...(extension === '.ts' ? [] : ['jsx-syntax']), 'named-symbols', 'static-reference-syntax'];
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

function requireResidentFile(absolute) {
  // Node does not expose Darwin st_flags. Query only metadata using the OS tool;
  // never open a dataless file or request a provider download in opt-in scans.
  if (process.platform === 'darwin') {
    const flags = Number(execFileSync('/usr/bin/stat', ['-f', '%f', absolute], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 }).trim());
    if (!Number.isSafeInteger(flags) || flags & 0x40000000) throw new Error('Cloud-only file is unavailable; no hydration is requested');
  }
}

function readBounded(root, relative, available, fileLimit = INDEX_LIMITS.fileBytes, residentOnly = false) {
  const absolute = checkedPath(root, relative);
  if (residentOnly) requireResidentFile(absolute);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(descriptor);
    const current = fs.lstatSync(checkedPath(root, relative));
    if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino) throw new Error('File changed during boundary check');
    if (stat.size > fileLimit || stat.size > available) throw Object.assign(new Error('Read budget exceeded'), { inventoryState: stat.size > fileLimit ? 'too-large' : 'budget-exceeded', bytes: stat.size });
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

function indexingPolicy({ generic = false, excludePaths = [], metadataPath = 'project-map.json', resolver } = {}) {
  if (!Array.isArray(excludePaths) || !excludePaths.every(relativePath)) throw new Error('excludePaths must contain safe relative paths without trailing slashes.');
  if (!relativePath(metadataPath) || path.posix.extname(metadataPath) !== '.json' || metadataPath.split('/').includes('node_modules')) throw new Error('metadataPath must be a safe relative JSON path.');
  return { residentOnly: resolver === 'bundler-local-v1', generic: Boolean(generic), excludePaths: [...new Set(excludePaths)].sort(), metadataPath, excludedDirs: generic ? GENERIC_EXCLUDED_DIRS : EXCLUDED_DIRS };
}

const excludedByPolicy = (relative, policy, exemption = null) => relative.split('/').some(component => policy.excludedDirs.has(component)) || policy.excludePaths.some(excluded => excluded !== exemption && (relative === excluded || relative.startsWith(`${excluded}/`)));

export const INPUT_POLICY_LIMITS = Object.freeze({ bytes: 65536, lines: 1024, lineBytes: 1024, work: 8000000 });
const POLICY_VERSION = 'root-ignore-v2';
const SOFT_DIRECTORIES = ['build', 'dist', 'venv'];
const policyFailure = (reason, line) => Object.assign(new Error('Input policy is invalid'), { policyFailure: true, reason, ...(line ? { line } : {}) });

// Literal/wildcard code points or one constant-size ASCII set per token.
function policyTokens(pattern, line) {
  const chars = [...pattern];
  const tokens = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ']') throw policyFailure('grammar', line);
    if (chars[i] !== '[') { tokens.push(chars[i]); continue; }
    const members = new Uint8Array(128);
    let count = 0;
    for (i++; i < chars.length && chars[i] !== ']'; i++) {
      const code = chars[i].codePointAt(0);
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)) throw policyFailure('grammar', line);
      members[code] = 1;
      count++;
    }
    if (!count || i === chars.length) throw policyFailure('grammar', line);
    tokens.push(members);
  }
  return tokens;
}

/** Strict bounded root-only dialect; no project code or Git state is consulted. */
export function parseInputPolicy(bytes) {
  if (bytes.length > INPUT_POLICY_LIMITS.bytes) throw policyFailure('byte-limit');
  if (!isUtf8(bytes)) throw policyFailure('encoding');
  const text = bytes.toString('utf8');
  if (text.startsWith('\uFEFF')) throw policyFailure('encoding');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop(); // A final newline terminates, rather than adds, a line.
  if (lines.length > INPUT_POLICY_LIMITS.lines) throw policyFailure('line-limit');
  const rules = [];
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    // A terminal CR is valid only when followed by LF in the original input.
    if (raw.endsWith('\r') && index === lines.length - 1 && !text.endsWith('\n')) throw policyFailure('controls', index + 1);
    if (Buffer.byteLength(line) > INPUT_POLICY_LIMITS.lineBytes) throw policyFailure('line-byte-limit', index + 1);
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(line)) throw policyFailure('controls', index + 1);
    line = line.replace(/ +$/, '');
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/') || line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line || line.includes('**') || line.includes('\\') || line.split('/').some(part => !part || part === '.' || part === '..')) throw policyFailure('grammar', index + 1);
    rules.push({ tokens: policyTokens(line, index + 1), negate, directoryOnly, anchored });
  }
  return { rules, lines: lines.length };
}

// One unit is one visited DP state (token-prefix, candidate-prefix), including
// the initial row. Every rule costs (tokens + 1) * (codepoints + 1); there is no
// backtracking or regex evaluation. Check BEFORE visiting state 8,000,001.
function globMatch(tokens, candidate, work) {
  const chars = [...candidate];
  let previous = new Uint8Array(chars.length + 1);
  const charge = () => { if (work.units >= INPUT_POLICY_LIMITS.work) throw policyFailure('work-limit'); work.units++; };
  for (let j = 0; j <= chars.length; j++) { charge(); previous[j] = Number(j === 0); }
  for (const token of tokens) {
    const current = new Uint8Array(chars.length + 1);
    for (let j = 0; j <= chars.length; j++) {
      charge();
      if (token === '*') current[j] = Number(Boolean(previous[j] || j && chars[j - 1] !== '/' && current[j - 1]));
      else if (j && previous[j - 1]) {
        const char = chars[j - 1];
        current[j] = Number(token === '?' ? char !== '/' : typeof token === 'string' ? token === char : token[char.codePointAt(0)] === 1);
      }
    }
    previous = current;
  }
  return Boolean(previous[chars.length]);
}

/** Pure soft-policy decision. Callers enforce hard boundaries first. */
export function policyMatchDecision(rules, relative, directory, work) {
  let excluded = directory && !relative.includes('/') && SOFT_DIRECTORIES.includes(relative);
  for (const rule of rules) {
    if (rule.directoryOnly && !directory) continue;
    if (globMatch(rule.tokens, rule.anchored ? relative : relative.slice(relative.lastIndexOf('/') + 1), work)) excluded = !rule.negate;
  }
  return excluded;
}

function policyIdentity(policy, rootIgnore, status, reason, line) {
  return sha(JSON.stringify({ version: POLICY_VERSION, generic: policy.generic, hardDirectories: [...policy.excludedDirs].sort(), softDirectories: SOFT_DIRECTORIES, excludePaths: policy.excludePaths, metadataPath: policy.metadataPath, rootIgnore, status, ...(reason ? { reason } : {}), ...(line ? { line } : {}) }));
}

function loadInputPolicy(root, policy) {
  let rootIgnore = { state: 'missing', hash: null, bytes: 0, lines: 0 };
  let rules = [];
  let failure;
  let descriptor;
  try {
    const absolute = path.join(root, '.gitignore');
    let before;
    try { before = fs.lstatSync(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before) {
      if (before.isSymbolicLink()) throw policyFailure('symlink');
      if (!before.isFile()) throw policyFailure('special-file');
      if (before.size > INPUT_POLICY_LIMITS.bytes) throw policyFailure('byte-limit');
      if (policy.residentOnly) requireResidentFile(absolute);
      descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(descriptor);
      const current = fs.lstatSync(absolute);
      if (!stat.isFile() || current.isSymbolicLink() || !current.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs || stat.dev !== current.dev || stat.ino !== current.ino) throw policyFailure('changed');
      if (stat.size > INPUT_POLICY_LIMITS.bytes) throw policyFailure('byte-limit');
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      const after = fs.fstatSync(descriptor);
      const final = fs.lstatSync(absolute);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || final.isSymbolicLink() || final.dev !== stat.dev || final.ino !== stat.ino || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) throw policyFailure('changed');
      const bytes = buffer.subarray(0, length);
      rootIgnore = { state: length ? 'present' : 'empty', hash: sha(bytes), bytes: length, lines: 0 };
      const parsed = parseInputPolicy(bytes);
      rules = parsed.rules;
      rootIgnore.lines = parsed.lines;
    }
  } catch (error) {
    failure = error.policyFailure ? error : policyFailure('unreadable');
    rootIgnore = { ...rootIgnore, state: 'invalid' };
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  const status = failure ? 'invalid' : 'valid';
  const summary = { id: policyIdentity(policy, rootIgnore, status, failure?.reason, failure?.line), version: POLICY_VERSION, status, rootIgnore, workUnits: 0, nestedIgnoreCount: 0, ...(failure ? { reason: failure.reason, ...(failure.line ? { line: failure.line } : {}) } : {}) };
  return { summary, rules, work: { units: 0 } };
}

function checkedRoot(directory) {
  const requestedRoot = path.resolve(directory);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error('Index root must not be a symbolic link');
  const root = fs.realpathSync(requestedRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('Index root must be a directory');
  return root;
}

/** Read only the bounded policy control input; never source or naming-map bytes. */
export function inspectInputPolicy(directory, indexOptions = {}) {
  const policy = indexingPolicy(indexOptions);
  return loadInputPolicy(checkedRoot(directory), policy).summary;
}

function invalidatePolicy(input, policy, reason, line) {
  const rootIgnore = { ...input.summary.rootIgnore };
  input.summary = { ...input.summary, id: policyIdentity(policy, rootIgnore, 'invalid', reason, line), status: 'invalid', reason, ...(line ? { line } : {}), workUnits: input.work.units };
  return input.summary;
}

/** Safe replacement snapshot after any observed policy invalidation/failure. */
export function emptyPolicyGraph(directory, inputPolicy, reason = 'policy-refresh') {
  const safeReason = ['policy-refresh', 'policy-changed', 'policy-invalid'].includes(reason) ? reason : 'policy-refresh';
  const diagnostics = [{ path: '.gitignore', code: 'INPUT_POLICY_INVALID', reason: inputPolicy?.reason ?? safeReason, ...(inputPolicy?.line ? { line: inputPolicy.line } : {}), message: 'Input policy is invalid or changed; source and naming data are withheld.', severity: 'warning' }];
  return { schemaVersion: 1, project: { name: path.basename(directory), root: directory }, inputPolicy, revision: sha(JSON.stringify({ inputPolicy, diagnostics })), generatedAt: new Date().toISOString(), status: 'partial', nodes: [], edges: [], symbolGraph: { nodes: [], edges: [], diagnostics: [] }, diagnostics, metadata: null, inventory: { status: 'partial', entries: [] }, stats: { files: 0, edges: 0, tests: 0, security: 0, parseMs: 0, cachedFiles: 0 }, scope: { excluded: [], unsupported: [], generic: false, limitations: ['Invalid or changed root input policy; no project source or naming-map contents are exposed.'] } };
}

function softPathExcluded(relative, policy, input, metadata = false) {
  const exemption = metadata && policy.generic && policy.metadataPath === 'agent.mind/project-map.json' && policy.excludePaths.includes('agent.mind') ? 'agent.mind' : null;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join('/');
    if (parts[i].startsWith('.') || sensitive(parts[i]) || excludedByPolicy(prefix, policy, exemption)) return true;
    if (policyMatchDecision(input.rules, prefix, i < parts.length - 1, input.work)) return true;
  }
  return false;
}

// Metadata is read independently of inventory so an excluded integration folder
// can hold the single target vocabulary. It never falls back to a second map.
function namingMetadata(root, policy, diagnostics, explicitlySelected, excluded) {
  const result = { path: policy.metadataPath, hash: null, status: 'missing', configuration: null };
  if (excluded) {
    result.status = 'excluded';
    diagnostics.push({ path: policy.metadataPath, code: 'NAMING_MAP_EXCLUDED', message: 'Selected naming map is excluded by input policy; source-derived names are used.', severity: 'info' });
    return result;
  }
  try {
    const bytes = readBounded(root, policy.metadataPath, INDEX_LIMITS.fileBytes, INDEX_LIMITS.fileBytes, policy.residentOnly);
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
      diagnostics.push({ path: policy.metadataPath, message: 'Cannot load names: selected naming map is unavailable or invalid.', severity: 'warning' });
    }
  }
  return result;
}

function resolverDescriptor(selection, inputPolicy, configHash, validation) {
  const fields = { ...selection, version: TYPED_RESOLUTION_VERSION, configHash,
    ...validation, policyId: inputPolicy?.id ?? null,
    candidateDomainVersion: TYPED_CANDIDATE_DOMAIN_VERSION, runtimeId: RESOLVER_RUNTIME_ID };
  return { ...fields, id: sha(JSON.stringify(fields)) };
}

// This bounded control observation only revokes old authority. Admission to a new
// graph still requires the configuration to pass the ordinary inventory/read budget.
export function inspectResolverConfiguration(directory, options = {}, { available = TYPED_RESOLVER_LIMITS.configBytes } = {}) {
  const selection = normalizeResolverOptions(options);
  if (!selection) return null;
  const policy = indexingPolicy(options), root = checkedRoot(directory), input = loadInputPolicy(root, policy);
  let configHash = null, bytesRead = 0, validation;
  try {
    if (input.summary.status !== 'valid') throw new Error('config-policy-invalid');
    if (softPathExcluded(selection.configPath, policy, input)) throw new Error('config-excluded');
    const bytes = readBounded(root, selection.configPath, available, TYPED_RESOLVER_LIMITS.configBytes, true);
    bytesRead = bytes.length; configHash = sha(bytes);
    validation = isText(bytes) ? validateResolverConfig(bytes.toString('utf8')) : { status: 'invalid', reason: 'config-encoding' };
    const after = loadInputPolicy(root, policy);
    if (after.summary.id !== input.summary.id || after.summary.status !== 'valid') throw new Error('config-policy-changed');
  } catch (error) {
    validation = { status: 'invalid', reason: error.policyFailure ? 'config-policy-limit' : ['config-policy-invalid', 'config-policy-changed', 'config-excluded'].includes(error.message) ? error.message : error.inventoryState === 'too-large' ? 'config-byte-limit' : 'config-unavailable' };
  }
  return { ...resolverDescriptor(selection, input.summary, configHash, validation), bytesRead };
}

/** No last-good source state survives a changed or unavailable resolver control. */
export function emptyResolverGraph(graph, resolver) {
  const result = emptyPolicyGraph(graph.project.root, graph.inputPolicy);
  result.resolver = resolver;
  result.diagnostics = [{ path: resolver.configPath, code: 'TYPED_RESOLVER_INVALID', reason: resolver.reason ?? 'config-changed', message: 'Resolver configuration changed or is unavailable; source data are withheld until a fresh scan.', severity: 'warning' }];
  result.scope.limitations = ['Resolver control changed; waiting for fresh matching scans.'];
  result.revision = sha(JSON.stringify({ inputPolicy: result.inputPolicy, resolver, diagnostics: result.diagnostics }));
  return result;
}

// Pure observations of this scan's completed directory ledger. No additional
// candidate or veto file is opened; policy-denied hypothetical paths stay unknown.
function resolverObserver(ledger, policy, input, available, analyses, inventoryEntries) {
  const directories = new Map(ledger.directories.map(item => [item.path, { ...item, names: new Map(item.entries.map(entry => [entry.name, entry])) }]));
  const records = new Map(inventoryEntries.map(item => [item.path, item]));
  // The policy is immutable within this scan. Reuse exact prefix/type decisions;
  // every actual matcher operation still debits its existing work budget. The
  // resolver separately charges every occurrence path, including duplicates.
  const policyDecisions = new Map();
  const denied = (prefix, directory) => {
    const key = JSON.stringify([prefix, directory]);
    if (!policyDecisions.has(key)) policyDecisions.set(key, policyMatchDecision(input.rules, prefix, directory, input.work));
    return policyDecisions.get(key);
  };
  return (relative, role) => {
    if (relative === '.') return directories.get('.')?.complete ? { state: 'directory' } : { state: 'unknown', reason: 'directory-unobserved' };
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/');
      if (parts[i].startsWith('.') || sensitive(parts[i]) || excludedByPolicy(prefix, policy) || denied(prefix, i < parts.length - 1 || role === 'traversal')) return { state: 'unknown', reason: 'path-excluded' };
    }
    let parent = '.';
    for (let i = 0; i < parts.length; i++) {
      const proof = directories.get(parent);
      if (!proof?.complete) return { state: 'unknown', reason: 'directory-unobserved' };
      const entry = proof.names.get(parts[i]);
      if (!entry) return { state: 'absent' };
      if (!entry.admitted) return { state: 'unknown', reason: entry.reason };
      if (i < parts.length - 1) {
        if (entry.kind === 'file') return { state: 'absent' };
        if (entry.kind !== 'directory') return { state: 'unknown', reason: 'unsafe-ancestor' };
        parent = parts.slice(0, i + 1).join('/'); continue;
      }
      if (entry.kind === 'directory') return directories.get(relative)?.complete ? { state: 'directory' } : { state: 'unknown', reason: 'directory-unobserved' };
      if (entry.kind !== 'file') return { state: 'unknown', reason: 'unsafe-file' };
      if (role !== 'candidate') return { state: 'present' };
      const node = available.get(relative), analysis = analyses.get(relative);
      if (node && analysis?.parseStatus === 'complete' && (!isTypedSource(relative) || analysis.referenceSyntax?.extraction === 'collected')) return { state: 'eligible', hash: node.hash };
      return { state: 'unknown', reason: records.get(relative)?.state !== 'text' ? 'candidate-content-unavailable' : 'candidate-analysis-withheld' };
    }
    return { state: 'unknown', reason: 'observation-missing' };
  };
}

/** Read the exact indexed source version; reject stale hashes and excluded paths. */
export function readIndexedSource(directory, node, indexOptions = {}) {
  const selection = normalizeResolverOptions(indexOptions);
  if (Boolean(selection) !== Boolean(node?.resolverId)) throw new Error('Resolver mode changed; refresh the graph before reading');
  const policy = indexingPolicy(indexOptions);
  const relative = node?.path;
  if (!relativePath(relative) || excludedByPolicy(relative, policy) || !node.capabilities?.includes('text') || node.id !== fileId(relative) || !/^[a-f\d]{64}$/.test(node.hash ?? '') || !/^[a-f\d]{64}$/.test(node.policyId ?? '')) throw new Error('Source is not an eligible indexed file');
  const root = checkedRoot(directory);
  const input = loadInputPolicy(root, policy);
  try {
    if (input.summary.status !== 'valid' || input.summary.id !== node.policyId || softPathExcluded(relative, policy, input)) throw policyFailure('stale');
    const resolver = selection ? inspectResolverConfiguration(root, indexOptions) : null;
    if (resolver && (resolver.status !== 'valid' || resolver.id !== node.resolverId)) throw new Error('Resolver configuration changed; refresh before reading');
    const bytes = readBounded(root, relative, INDEX_LIMITS.fileBytes, INDEX_LIMITS.fileBytes, Boolean(selection));
    if (sha(bytes) !== node.hash) throw new Error('Indexed source changed; refresh the graph before reading');
    if (!isText(bytes)) throw new Error('Indexed file is not supported UTF-8 text');
    const after = loadInputPolicy(root, policy);
    if (after.summary.status !== 'valid' || after.summary.id !== node.policyId || softPathExcluded(relative, policy, { ...after, work: input.work })) throw policyFailure('stale');
    if (selection && inspectResolverConfiguration(root, indexOptions).id !== resolver.id) throw new Error('Resolver configuration changed while reading');
    return bytes.toString('utf8');
  } catch (error) {
    if (error.policyFailure) throw new Error('Input policy changed or is invalid; refresh the graph before reading');
    throw error;
  }
}

function inventory(root, diagnostics, excluded, policy, unsupported, records, input, ledger = null) {
  const files = [];
  let entries = 0;
  let exhausted = false;
  function visit(relative, depth) {
    if (entries > INDEX_LIMITS.entries) { if (ledger) ledger.complete = false; return; }
    if (depth > INDEX_LIMITS.depth) {
      if (ledger) ledger.complete = false;
      records.push({ path: relative + '/', state: 'unscanned', reason: 'depth-limit' });
      diagnostics.push({ path: relative, message: 'Directory depth budget exceeded', severity: 'warning' });
      return;
    }
    try {
      const directory = relative ? checkedPath(root, relative) : root;
      const beforeDirectory = ledger ? fs.statSync(directory) : null;
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
            if (ledger) ledger.complete = false;
            break;
          }
          directoryEntries.push(entry);
        }
      } finally {
        handle.closeSync();
      }
      const afterDirectory = ledger ? fs.statSync(relative ? checkedPath(root, relative) : root) : null;
      const directoryChanged = ledger && ['dev', 'ino', 'mtimeMs', 'ctimeMs'].some(key => beforeDirectory[key] !== afterDirectory[key]);
      if (directoryChanged) ledger.complete = false;
      const directoryProof = ledger ? { path: relative || '.', complete: !exhausted && !directoryChanged, entries: [] } : null;
      if (ledger) ledger.directories.push(directoryProof);
      for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const proof = directoryProof ? { name: entry.name, kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'special', admitted: true } : null;
        if (proof) directoryProof.entries.push(proof);
        const name = posix(path.join(relative, entry.name));
        if (entry.name === '.gitignore' && relative) {
          input.summary.nestedIgnoreCount++;
          diagnostics.push({ path: name, code: 'NESTED_IGNORE_NOT_LOADED', message: 'Nested ignore is not loaded; only the root .gitignore is supported.', severity: 'info' });
        }
        if (entry.isSymbolicLink()) {
          if (proof) Object.assign(proof, { admitted: false, reason: 'symlink' });
          excluded.add(`${name} (symlink)`);
          records.push({ path: name, state: 'excluded', reason: 'symlink' });
          continue;
        }
        if (entry.name === '.DS_Store' || sensitive(entry.name) || entry.name.startsWith('.') || excludedByPolicy(name, policy)) {
          if (proof) Object.assign(proof, { admitted: false, reason: 'hard-exclusion' });
          excluded.add(`${name}${entry.isDirectory() ? '/' : ''}`);
          records.push({ path: name + (entry.isDirectory() ? '/' : ''), state: 'excluded', reason: sensitive(entry.name) ? 'sensitive-name' : entry.name.startsWith('.') ? 'hidden' : 'policy' });
          continue;
        }
        if (!entry.isDirectory() && !entry.isFile()) { if (proof) Object.assign(proof, { admitted: false, reason: 'special-file' }); records.push({ path: name, state: 'excluded', reason: 'special-file' }); continue; }
        if (policyMatchDecision(input.rules, name, entry.isDirectory(), input.work)) {
          if (proof) Object.assign(proof, { admitted: false, reason: 'input-policy' });
          excluded.add(`${name}${entry.isDirectory() ? '/' : ''}`);
          records.push({ path: name + (entry.isDirectory() ? '/' : ''), state: 'excluded', reason: 'input-policy' });
          continue;
        }
        if (entry.isDirectory()) visit(name, depth + 1);
        else if (entry.isFile()) files.push(name);
        else records.push({ path: name, state: 'excluded', reason: 'special-file' });
      }
    } catch (error) {
      if (error.policyFailure) throw error;
      if (ledger) ledger.complete = false;
      records.push({ path: relative || '.', state: 'unreadable', reason: error.message });
      diagnostics.push({ path: relative || '.', message: `Cannot list directory: ${error.message}`, severity: 'warning' });
    }
  }
  visit('', 0);
  // Discovery remains bounded by the existing entry/depth/policy-work limits.
  // Rank only observed eligible paths, before any candidate contents are opened.
  files.sort((a, b) => sourcePriority(a) - sourcePriority(b) || ordinalCompare(a, b));
  const selected = files.slice(0, INDEX_LIMITS.files);
  const omitted = files.slice(INDEX_LIMITS.files);
  if (omitted.length) {
    if (ledger) ledger.complete = false;
    diagnostics.push({ path: omitted[0], message: 'Inventory budget exceeded; some files are omitted', severity: 'warning' });
    // These paths were observed, but their contents, sizes and hashes are unknown.
    for (const name of omitted) records.push({ path: name, state: 'unscanned', reason: 'file-limit' });
  }
  for (const name of selected) if (UNSUPPORTED_SOURCE.test(name) && !isTypedSource(name)) unsupported.add(name);
  return selected;
}

// Python resolution describes one documented source layout, never sys.path or a
// running interpreter. Only already indexed UTF-8 .py files can be candidates.
function resolvePythonReference(relative, reference, available, directories) {
  const specifier = reference.specifier;
  const python = reference.python;
  const identifier = /^[_\p{ID_Start}][_\p{ID_Continue}]*$/u;
  // The adapter supplies class-private module identity separately from spelling.
  // Invalid present metadata must fail closed, never fall back to the raw token.
  const module = Object.hasOwn(python, 'lookupModule') ? python.lookupModule : python.module;
  // Normalize identifier tokens only; inventory paths retain their exact names.
  const parts = typeof module === 'string' && module ? module.split('.').map(part => part.normalize('NFKC')) : [];
  if (!Number.isSafeInteger(python.level) || python.level < 0 || !['import', 'from'].includes(python.form)
      || typeof python.module !== 'string' || typeof module !== 'string' || parts.some(part => !identifier.test(part))
      || (!parts.length && (python.module !== '' || !python.level || python.form !== 'from'))) {
    return { error: `Malformed Python module reference: ${specifier}` };
  }
  const packageFile = directory => directory === '.' ? '__init__.py' : `${directory}/__init__.py`;
  const regularPackage = directory => available.has(packageFile(directory));
  const lookupModule = parts.join('.');
  const unresolved = () => python.level
    ? { error: `Unresolved local Python module in the indexed regular package: ${specifier}` }
    : { external: `python:${lookupModule}`, label: `${lookupModule} (external/unresolved Python)`, info: `Python import is external or unresolved in the project-root regular-package layout: ${specifier}. No environment or top-level namespace-package resolution is inferred.` };
  let base = '', anchor = null;
  const sourceDirectory = path.posix.dirname(relative);
  if (python.level) {
    // An indexed regular package anchors internal namespace subdirectories. The
    // highest such ancestor is the floor; no source-root or runtime inference.
    let directory = sourceDirectory;
    while (true) {
      if (regularPackage(directory)) anchor = directory;
      if (directory === '.') break;
      directory = path.posix.dirname(directory);
    }
    if (anchor === null) return { error: `Python relative import leaves the indexed regular package: ${specifier}` };
    base = sourceDirectory;
    for (let level = 1; level < python.level; level++) {
      if (base === anchor) return { error: `Python relative import leaves the indexed regular package: ${specifier}` };
      base = path.posix.dirname(base);
    }
  } else if (parts.length > 1) {
    // Absolute imports still start at the project root in a regular package.
    anchor = parts[0];
    if (!regularPackage(anchor)) return unresolved();
  }
  const modulePath = path.posix.join(base, ...parts);
  const traversal = new Set();
  if (anchor !== null) for (const endpoint of [parts.length ? path.posix.dirname(modulePath) : modulePath, ...(python.level ? [sourceDirectory] : [])]) {
    let directory = endpoint;
    while (true) {
      traversal.add(directory);
      if (directory === anchor) break;
      // Defensive boundary check; validated identifiers and the ascent floor
      // should already guarantee that every endpoint is inside its anchor.
      if (directory === '.') return unresolved();
      directory = path.posix.dirname(directory);
    }
  }
  for (const directory of traversal) {
    if (directory !== '.' && available.has(`${directory}.py`)) {
      return { error: regularPackage(directory)
        ? `Ambiguous Python source module (module/package collision): ${specifier}`
        : `Python source module blocks package traversal: ${specifier} (${directory}.py)` };
    }
    if (!directories.has(directory)) return unresolved();
  }
  const candidates = parts.length ? [`${modulePath}.py`, `${modulePath}/__init__.py`] : [packageFile(base)];
  const eligible = candidates.filter(candidate => available.has(candidate));
  if (eligible.length > 1) return { error: `Ambiguous Python source module (module/package collision): ${specifier}` };
  if (!eligible.length) {
    if (anchor !== null && directories.has(modulePath)) return { ignored: true, info: `Python namespace module has no source file; imported members remain unresolved: ${specifier}. No package initializer or member edge is inferred.` };
    return unresolved();
  }
  const info = python.form === 'from' && !parts.length
    ? `Python from-import members remain ambiguous attributes or submodules: ${specifier}. Only the containing package is referenced.` : undefined;
  return { ...(!parts.length && eligible[0] === relative ? { ignored: true } : { target: eligible[0] }), info };
}

function resolveReference(relative, reference, available, directories) {
  if (reference.python) return resolvePythonReference(relative, reference, available, directories);
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
  const selection = normalizeResolverOptions(options);
  const ledger = selection ? { complete: true, directories: [] } : null;
  const policy = indexingPolicy(options);
  const started = performance.now();
  const root = checkedRoot(directory);
  const input = loadInputPolicy(root, policy);
  const policyGraph = (summary, reason) => {
    const graph = emptyPolicyGraph(root, summary, reason);
    return selection ? emptyResolverGraph(graph, resolverDescriptor(selection, summary, null, { status: 'invalid', reason: 'config-policy-invalid' })) : graph;
  };
  if (input.summary.status !== 'valid') return policyGraph(input.summary, 'policy-invalid');
  const diagnostics = [{ path: '.gitignore', code: 'ROOT_IGNORE_SCOPE', message: 'Only the root .gitignore is loaded; nested ignores, Git tracking and global excludes are outside scope.', severity: 'info' }];
  const excluded = new Set([...policy.excludedDirs].map(name => `${name}/`).concat(policy.excludePaths.map(name => `${name}/`)));
  const unsupported = new Set();
  const inventoryEntries = [];
  let files;
  let metadataExcluded;
  try {
    files = inventory(root, diagnostics, excluded, policy, unsupported, inventoryEntries, input, ledger);
    metadataExcluded = softPathExcluded(policy.metadataPath, policy, input, true);
  } catch (error) {
    if (!error.policyFailure) throw error;
    return policyGraph(invalidatePolicy(input, policy, error.reason, error.line), 'policy-invalid');
  }
  input.summary.workUnits = input.work.units;
  let inventoryComplete = !diagnostics.some(item => ['warning', 'error'].includes(item.severity));
  const commonJSFiles = new Map();
  for (const name of unsupported) {
    const diagnostic = /\.cjs$/i.test(name)
      ? { path: name, code: 'COMMONJS_REFERENCE_ANALYSIS_UNSUPPORTED', capability: 'static-references', reason: 'cjs-extension', message: 'The .cjs extension is outside supported reference analysis; readable text has no inferred symbols or dependencies.', severity: 'warning' }
      : { path: name, message: 'Unsupported source language; file is outside source analysis.', severity: 'warning' };
    if (diagnostic.reason === 'cjs-extension') commonJSFiles.set(name, diagnostic);
    diagnostics.push(diagnostic);
  }
  const beforeReads = loadInputPolicy(root, policy);
  if (beforeReads.summary.status !== 'valid' || beforeReads.summary.id !== input.summary.id) return policyGraph(invalidatePolicy(input, policy, 'policy-changed'), 'policy-changed');
  const metadata = namingMetadata(root, policy, diagnostics, Object.hasOwn(options, 'metadataPath'), metadataExcluded);
  const priorCache = previous?.project?.root === root ? CACHE.get(previous) : null;
  const nextCache = new Map();
  const nodes = [];
  const analyses = new Map();
  let totalBytes = 0;
  let cachedFiles = 0;
  let config = { hash: null, validation: { status: 'invalid', reason: 'config-not-indexed' } };
  for (const relative of files) {
    try {
      const bytes = readBounded(root, relative, INDEX_LIMITS.totalBytes - totalBytes, relative === selection?.configPath ? TYPED_RESOLVER_LIMITS.configBytes : INDEX_LIMITS.fileBytes, Boolean(selection));
      totalBytes += bytes.length;
      const hash = sha(bytes);
      const text = isText(bytes);
      if (relative === selection?.configPath) config = { hash, validation: text ? validateResolverConfig(bytes.toString('utf8')) : { status: 'invalid', reason: 'config-encoding' } };
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
      nodes.push({ id: fileId(relative), path: relative, label: path.posix.basename(relative), kind: kindFor(relative), language: languageFor(relative), hash, policyId: input.summary.id, bytes: bytes.length, capabilities: capabilitiesFor(relative), ...(analysis.producer ? { producer: structuredClone(analysis.producer) } : {}), ...(isTypedSource(relative) ? { referenceSyntax: structuredClone(analysis.referenceSyntax) } : {}), layers, symbols: structuredClone(analysis.symbols), security: structuredClone(analysis.security), diagnostics: structuredClone([...analysis.diagnostics, ...(commonJSFiles.has(relative) ? [commonJSFiles.get(relative)] : [])]) });
      const node = nodes.at(-1);
      if (selection && isTypedSource(relative)) for (const diagnostic of node.diagnostics) if (diagnostic.message.startsWith('Syntax-only pilot:')) diagnostic.message = 'Typed syntax pilot with optional model-relative local resolution; types, calls, security and HTTP/framework behavior remain unsupported. Global coverage remains partial.';
      diagnostics.push(...structuredClone(node.diagnostics.slice(0, analysis.diagnostics.length)));
    } catch (error) {
      if (relative === selection?.configPath) config.validation = { status: 'invalid', reason: error.inventoryState === 'too-large' ? 'config-byte-limit' : 'config-unavailable' };
      inventoryComplete = false;
      inventoryEntries.push({ path: relative, state: error.inventoryState || 'unreadable', ...(error.bytes === undefined ? {} : { bytes: error.bytes }), reason: error.message });
      diagnostics.push({ path: relative, message: `Cannot index file: ${error.message}`, severity: 'warning' });
    }
  }
  const available = new Map(nodes.map(node => [node.path, node]));
  // Inventory-only text cannot turn a previously unresolved reference into an edge.
  const resolvable = new Map([...available].filter(([relative]) => EXTENSIONS.has(path.extname(relative))));
  const directories = new Set(['.']);
  for (const relative of resolvable.keys()) {
    let directory = path.posix.dirname(relative);
    while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory); }
  }
  const externalNodes = new Map();
  const groupedEdges = new Map();
  for (const [relative, analysis] of analyses) for (const reference of analysis.references) {
    // R13 syntax facts are serialized on the file; resolution remains unsupported.
    if (reference.typed || isTypedSource(relative)) continue;
    const resolved = resolveReference(relative, reference, resolvable, directories);
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
  let resolver = null;
  if (selection) {
    resolver = resolverDescriptor(selection, input.summary, config.hash, config.validation);
    const work = { units: 0, exceeded: false };
    const observed = resolverObserver(ledger, policy, input, available, analyses, inventoryEntries);
    let policyError = null;
    const observe = (relative, role) => { try { return observed(relative, role); } catch (error) { if (error.policyFailure) policyError = error; throw error; } };
    for (const node of nodes) {
      node.resolverId = resolver.id;
      if (!node.referenceSyntax) continue;
      node.referenceResolution = { version: TYPED_RESOLUTION_VERSION, resolver: structuredClone(resolver), extraction: node.referenceSyntax.extraction,
        outcomes: node.referenceSyntax.facts.map(fact => resolveTypedReference(node.path, fact, { resolver, enumerationComplete: ledger.complete, observe, work })) };
    }
    // A policy matcher failure caught by the helper must revoke the whole scan.
    if (policyError) return policyGraph(invalidatePolicy(input, policy, policyError.reason, policyError.line), 'policy-invalid');
    if (work.exceeded) {
      diagnostics.push({ path: '.', code: 'TYPED_RESOLVER_LIMIT', message: 'Resolver work limit exceeded; all local outcomes and edges are withheld.', severity: 'warning' });
      for (const node of nodes) if (node.referenceResolution) {
        node.referenceResolution.extraction = 'withheld';
        node.referenceResolution.reason = 'resolver-work-limit';
        node.referenceResolution.outcomes = [];
      }
    } else for (const node of nodes) for (const outcome of node.referenceResolution?.outcomes ?? []) {
      if (outcome.status !== 'resolved') continue;
      const from = node.id, to = fileId(outcome.target), key = `${from}\0${outcome.kind}\0${to}`;
      const layers = ['project', ...(isTest(node.path) || isTest(outcome.target) ? ['testing'] : [])];
      for (const endpoint of [node, available.get(outcome.target)]) for (const layer of layers) if (!endpoint.layers.includes(layer)) endpoint.layers.push(layer);
      if (!groupedEdges.has(key)) groupedEdges.set(key, { id: `edge:${sha(key).slice(0, 24)}`, from, to, kind: outcome.kind, label: outcome.kind, layers, provenance: 'typed-local-resolution', certainty: 'model-relative', resolverId: resolver.id, evidence: [] });
      groupedEdges.get(key).evidence.push({ ...structuredClone(outcome.evidence), typed: structuredClone(outcome.typed), specifier: outcome.specifier });
    }
    if (resolver.status !== 'valid') diagnostics.push({ path: selection.configPath, code: 'TYPED_RESOLVER_INVALID', reason: resolver.reason, message: 'Selected resolver configuration is unavailable or outside the supported contract; local resolution is blocked.', severity: 'warning' });
    input.summary.workUnits = input.work.units;
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
    nestedIgnoreCount: input.summary.nestedIgnoreCount,
    limitations: [
      'The map reads source files without running them. Security signals point to code to review; they do not establish vulnerabilities or safety.',
      'Test links come from source references. Run tests for results and enable coverage to measure what they cover.',
      'Acorn parses JavaScript modules. The map resolves literal imports, reexports, dynamic imports and new URL(literal, import.meta.url). It does not resolve CommonJS require, computed paths or aliases, or guess missing extensions.',
      'HTTP/SSE links match code on both sides of a request; they do not show requests that ran. A nonshadowed fetch/EventSource call must use a fixed same-origin /api path; query strings may be dynamic. It must match one inline handler passed to an imported http.createServer, with one unmodified new URL(request.url, base) binding and an exact pathname check. SSE also requires code that sets an event-stream response. Frameworks, indirect handlers, computed paths and multiple possible providers are unsupported. Each match states what is known about its HTTP method.',
      'Functions and classes are nested as they appear in source. Call links cover direct same-file references and known this.method calls within a class. They do not show runtime execution, callback scheduling, dynamic dispatch, coverage or control flow. Imported, aliased and computed calls, class fields and static-block bodies are omitted. Ambiguous or directly reassigned bindings and methods are excluded. Anonymous closures use the nearest named owner and carry a nested-closure marker. Per-file limits apply to symbols, calls, AST nodes and nesting depth.',
      'HTML analysis reads script src and link href. It skips inline scripts, CSS imports and URLs, and Markdown links.',
      'Inventory includes bounded regular files independently of language support. UTF-8 text without binary controls can be read by indexed hash. Binary, unreadable, oversized and unscanned entries have explicit states; excluded directories are not traversed. Hidden/sensitive paths, symlinks and configured exclusions remain excluded.',
      'File and total-byte budgets prioritize recognized source suffixes, then other eligible paths, with ordinal full-path ordering within each group. Priority applies only to observed candidates; entry/depth limits leave unvisited scope unknown. Source priority grants no additional language support.',
      'File capabilities name available operations, not successful analysis or coverage. Text-only files have no inferred symbols or dependencies; source-reference resolution retains the existing .mjs/.js/.json/.html/.css/.md/.py scope. Known unsupported source extensions retain partial diagnostics.',
      ...([...analyses.keys()].some(name => name.endsWith('.py')) ? ['Python provides bounded declarations, literal module imports and conservative bare same-file calls (64 KiB per file), using an editor grammar rather than CPython validation. Imports map project-root modules and regular packages, with internal namespace subdirectories below an indexed regular-package anchor. Relative ascent stops at the highest indexed regular-package ancestor, including an explicit root initializer. Namespace-only modules have no file edge; top-level namespace packages, custom source roots, sys.path and environment resolution are not inferred. From-import members are attributes or submodules, never guessed file edges. Imported/member calls, types, security, framework/runtime behavior, decorator effects, notebooks and .pyi files remain outside scope. Recovery errors and traversal limits withhold relationships; ambiguity remains explicit. Parser limits are not timeouts or a sandbox.'] : []),
      ...([...analyses.keys()].some(isTypedSource) ? ['TS/TSX/JSX pilot provides bounded named declarations and static-reference syntax (64 KiB per file). Reference facts have unsupported resolution and create no dependency, external-module, call or Security edges. The restricted pass records selected unsupported forms, not exhaustive reference coverage. Import resolution, types, calls, security and HTTP/framework behavior remain unsupported; both directions of cross-language resolution remain disabled. Ambient .d.ts, .mts/.cts, decorators and embedded scripts are outside this pilot. Parse/byte failures withhold all syntax; declaration and reference traversal limits independently withhold their complete results. Parser and traversal limits are not timeouts or a sandbox.'] : []),
      `Scan limits: ${INDEX_LIMITS.files} files, ${INDEX_LIMITS.fileBytes} bytes per file, ${INDEX_LIMITS.totalBytes} total bytes, ${INDEX_LIMITS.entries} directory entries, depth ${INDEX_LIMITS.depth}.`,
      'Source reads reject symlinks and check each file\'s real path and inode. Files can still change during a scan; incomplete reads are reported in diagnostics.'
    ]
  };
  const inventorySnapshot = { ...(ledger ? { enumeration: ledger } : {}), status: inventoryComplete ? 'complete' : 'partial', entries: inventoryEntries.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.state.localeCompare(b.state, 'en')) };
  const result = {
    schemaVersion: 1,
    inputPolicy: input.summary,
    ...(resolver ? { resolver } : {}),
    project: { name: path.basename(root), root },
    revision: null,
    generatedAt: new Date().toISOString(),
    status: diagnostics.some(item => item.severity === 'warning' || item.severity === 'error') ? 'partial' : 'current',
    nodes, edges, symbolGraph, diagnostics, metadata, inventory: inventorySnapshot,
    stats: { files: available.size, edges: edges.length, tests: [...available.values()].filter(node => node.kind === 'test').length, security: [...available.values()].filter(node => node.security.length).length, parseMs: Math.round((performance.now() - started) * 100) / 100, cachedFiles },
    scope
  };
  sanitizeNamingMetadata(result, relative => !relativePath(relative) || excludedByPolicy(relative, policy));
  result.diagnostics.sort((a, b) => a.path.localeCompare(b.path, 'en') || (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message, 'en'));
  result.revision = sha(JSON.stringify({ inputPolicy: input.summary, ...(resolver ? { resolver } : {}), inventory: inventorySnapshot, nodes, edges, symbolGraph, diagnostics: result.diagnostics, excluded: scope.excluded, generic: policy.generic, metadata: result.metadata }));
  const finalPolicy = loadInputPolicy(root, policy);
  if (finalPolicy.summary.status !== 'valid' || finalPolicy.summary.id !== input.summary.id) return policyGraph(invalidatePolicy(input, policy, 'policy-changed'), 'policy-changed');
  if (resolver?.status === 'valid') {
    const current = inspectResolverConfiguration(root, options, { available: INDEX_LIMITS.totalBytes - totalBytes });
    if (current.status !== 'valid' || current.id !== resolver.id) {
      const { bytesRead, ...observed } = current;
      return emptyResolverGraph(result, resolverDescriptor(selection, input.summary, observed.configHash, { status: 'invalid', reason: 'config-changed' }));
    }
  }
  if (resolver) {
    result.scope.limitations = result.scope.limitations.map(message => message.startsWith('TS/TSX/JSX pilot') ? 'TS/TSX/JSX retains bounded syntax evidence and global partial. Explicit bundler-local-v1 adds conservative model-relative local file relations only; types, imported calls, security, runtime behavior and complete incoming coverage remain unsupported.' : message);
  }
  CACHE.set(result, nextCache);
  return result;
}
