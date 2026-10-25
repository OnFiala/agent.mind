import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parse } from 'acorn';
import { analyzeSymbolGraph } from './symbol-index.mjs';

// This index is descriptive. It never imports, evaluates, or runs scanned files.
export const INDEX_LIMITS = Object.freeze({ files: 1000, fileBytes: 512 * 1024, totalBytes: 16 * 1024 * 1024, entries: 10000, depth: 20 });
const EXTENSIONS = new Set(['.mjs', '.js', '.json', '.html', '.css', '.md', '.py']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'backups', 'evidence', 'workspace', 'legacy', 'coverage']);
const GENERIC_EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const UNSUPPORTED_SOURCE = /\.(?:ts|tsx|jsx|mts|cts|go|rs|java|swift|kt|c|h|cpp|cs|rb|php|vue|svelte)$/i;
const SECURITY_MODULES = new Set(['fs', 'fs/promises', 'http', 'https', 'http2', 'net', 'tls', 'crypto', 'child_process', 'dgram', 'dns', 'worker_threads', 'vm', 'module']);
const CACHE = new WeakMap();
const sha = value => createHash('sha256').update(value).digest('hex');
const fileId = relative => `file:${relative}`;
const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const posix = name => name.split(path.sep).join('/');
const isTest = name => /(^|\/)(test|tests)\//.test(name) || /\.(test|spec)\.(m?js|py)$/.test(name);
const sensitive = name => /^\.env(?:[.-]|$)/i.test(name) || /(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)/i.test(name) || /\.(pem|key|p12|pfx)$/i.test(name);
const securityModule = specifier => SECURITY_MODULES.has(specifier.replace(/^node:/, ''));
const location = (relative, lines, node) => {
  const line = node.loc?.start.line ?? 1;
  return { path: relative, line, column: (node.loc?.start.column ?? 0) + 1, snippet: lines[line - 1]?.trim().slice(0, 220) ?? '' };
};

function kindFor(relative) {
  if (isTest(relative)) return 'test';
  const extension = path.extname(relative);
  return extension === '.md' ? 'document' : extension === '.json' ? 'config' : ['.html', '.css'].includes(extension) ? 'asset' : 'source';
}

function languageFor(relative) {
  return ({ '.mjs': 'javascript', '.js': 'javascript', '.json': 'json', '.html': 'html', '.css': 'css', '.md': 'markdown', '.py': 'python' })[path.extname(relative)];
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
    if (stat.size > INDEX_LIMITS.fileBytes || stat.size > available) throw new Error('Read budget exceeded');
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
  if (!relativePath(relative) || excludedByPolicy(relative, policy) || !EXTENSIONS.has(path.posix.extname(relative)) || node.id !== fileId(relative) || !/^[a-f\d]{64}$/.test(node.hash ?? '')) throw new Error('Source is not an eligible indexed file');
  const requestedRoot = path.resolve(directory);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error('Index root must not be a symbolic link');
  const root = fs.realpathSync(requestedRoot);
  const bytes = readBounded(root, relative, INDEX_LIMITS.fileBytes);
  if (sha(bytes) !== node.hash) throw new Error('Indexed source changed; refresh the graph before reading');
  return bytes.toString('utf8');
}

function inventory(root, diagnostics, excluded, policy, unsupported) {
  const files = [];
  let entries = 0;
  let exhausted = false;
  function visit(relative, depth) {
    if (entries > INDEX_LIMITS.entries) return;
    if (depth > INDEX_LIMITS.depth) {
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
            if (!exhausted) diagnostics.push({ path: relative || '.', message: 'Inventory budget exceeded; some files are omitted', severity: 'warning' });
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
          if (!exhausted) diagnostics.push({ path: name, message: 'Inventory budget exceeded; some files are omitted', severity: 'warning' });
          exhausted = true;
          return;
        }
        if (entry.isSymbolicLink()) {
          excluded.add(`${name} (symlink)`);
          continue;
        }
        if (entry.name === '.DS_Store' || sensitive(entry.name) || entry.name.startsWith('.') || excludedByPolicy(name, policy)) {
          excluded.add(`${name}${entry.isDirectory() ? '/' : ''}`);
          continue;
        }
        if (entry.isDirectory()) visit(name, depth + 1);
        else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) files.push(name);
        else if (entry.isFile() && UNSUPPORTED_SOURCE.test(entry.name)) unsupported.add(name);
      }
    } catch (error) {
      diagnostics.push({ path: relative || '.', message: `Cannot list directory: ${error.message}`, severity: 'warning' });
    }
  }
  visit('', 0);
  return files.sort();
}

function patternNames(pattern, output = new Set()) {
  if (!pattern) return output;
  if (pattern.type === 'Identifier') output.add(pattern.name);
  else if (pattern.type === 'RestElement') patternNames(pattern.argument, output);
  else if (pattern.type === 'AssignmentPattern') patternNames(pattern.left, output);
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => patternNames(item, output));
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item => patternNames(item.value ?? item.argument, output));
  return output;
}

function children(node) {
  const result = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) result.push(...value.filter(item => item && typeof item.type === 'string'));
    else if (value && typeof value === 'object' && typeof value.type === 'string') result.push(value);
  }
  return result;
}

function scopeNames(node) {
  const names = new Set();
  if (node.type === 'Program' || /Function/.test(node.type) || node.type === 'ArrowFunctionExpression') {
    node.params?.forEach(parameter => patternNames(parameter, names));
    if (node.id) names.add(node.id.name);
    // Conservatively suppress a binding if a local declaration shadows it anywhere.
    const stack = Array.isArray(node.body) ? [...node.body] : node.body ? [node.body] : [];
    while (stack.length) {
      const item = stack.pop();
      if (/Function/.test(item.type) || item.type === 'ArrowFunctionExpression') {
        if (item.type === 'FunctionDeclaration' && item.id) names.add(item.id.name);
        continue;
      }
      if (item.type === 'VariableDeclarator') patternNames(item.id, names);
      if (item.type === 'ClassDeclaration' && item.id) names.add(item.id.name);
      stack.push(...children(item));
    }
  } else if (node.type === 'BlockStatement') {
    for (const item of node.body) {
      if (item.type === 'VariableDeclaration') item.declarations.forEach(declaration => patternNames(declaration.id, names));
      if (['FunctionDeclaration', 'ClassDeclaration'].includes(item.type) && item.id) names.add(item.id.name);
    }
  } else if (node.type === 'CatchClause') patternNames(node.param, names);
  else if (['ForStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)) {
    const declaration = node.init ?? node.left;
    if (declaration?.type === 'VariableDeclaration') declaration.declarations.forEach(item => patternNames(item.id, names));
  }
  return names;
}

const isFunction = node => /Function/.test(node.type) || node.type === 'ArrowFunctionExpression';
const stringLiteral = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
const memberOf = (node, receiver, property) => node?.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.object.name === receiver && node.property.name === property;

// Assignment patterns contain writable leaves, including members, not just names.
function assignmentTargets(pattern) {
  if (!pattern) return [];
  if (['Identifier', 'MemberExpression'].includes(pattern.type)) return [pattern];
  if (pattern.type === 'RestElement') return assignmentTargets(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return assignmentTargets(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(assignmentTargets);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(item => assignmentTargets(item.value ?? item.argument));
  return [];
}

function requestPath(argument) {
  let value = stringLiteral(argument);
  if (argument?.type === 'TemplateLiteral') {
    const prefix = argument.quasis[0].value.cooked;
    if (argument.expressions.length && (prefix === null || !prefix.includes('?') || prefix.indexOf('#') >= 0 && prefix.indexOf('#') < prefix.indexOf('?'))) return { unknown: true };
    value = prefix;
  }
  if (value === null) return { unknown: true };
  if (!value.startsWith('/api/')) return { ignored: true };
  const pathname = value.split(/[?#]/)[0];
  if (!/^\/api\/[a-z\d_./-]+$/i.test(pathname) || pathname !== path.posix.normalize(pathname)) return { unknown: true };
  return { pathname };
}

function handlerPath(argument) {
  const literal = stringLiteral(argument) ?? (argument?.type === 'TemplateLiteral' && !argument.expressions.length ? argument.quasis[0].value.cooked : null);
  // URL.pathname never contains a query or fragment. Unlike a client URL, the
  // server comparison must preserve the complete literal without stripping it.
  return literal !== null && !/[?#]/.test(literal) ? requestPath(argument) : {};
}

function fetchMethod(options) {
  if (!options) return 'GET';
  if (options.type !== 'ObjectExpression' || options.properties.some(item => item.type !== 'Property' || item.computed || item.kind !== 'init')) return null;
  const methods = options.properties.filter(item => (item.key.name ?? item.key.value) === 'method');
  if (!methods.length) return 'GET';
  const method = stringLiteral(methods.at(-1).value);
  return method && ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(method.toUpperCase()) ? method.toUpperCase() : method;
}

/** Narrow handler recognition: inline imported http.createServer + exact request URL binding. */
function serverContracts(callback, factory, relative, lines, globalURLAvailable) {
  const providers = [];
  if (!isFunction(callback) || callback.params.length < 2 || callback.params.some(parameter => parameter.type !== 'Identifier') || callback.body.type !== 'BlockStatement') return providers;
  const [request, response] = callback.params.map(parameter => parameter.name);
  const records = [];
  const declarations = new Map();
  const writes = new Map();
  const noteWrite = (name, value, record) => {
    if (!writes.has(name)) writes.set(name, []);
    writes.get(name).push({ value, ...record });
  };
  const pending = [{ node: callback.body, scopes: [] }];
  while (pending.length) {
    const record = pending.pop();
    const { node } = record;
    if (isFunction(node)) {
      if (node.type === 'FunctionDeclaration' && node.id) {
        if (!declarations.has(node.id.name)) declarations.set(node.id.name, []);
        declarations.get(node.id.name).push({ node, scopes: record.scopes });
      }
      continue;
    }
    const scopes = node.type === 'BlockStatement' ? [...record.scopes, node.start] : record.scopes;
    const current = { node, scopes };
    records.push(current);
    if (node.type === 'CatchClause' || node.type === 'ClassDeclaration') for (const name of patternNames(node.param ?? node.id)) {
      if (!declarations.has(name)) declarations.set(name, []);
      declarations.get(name).push(current);
    }
    if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) for (const name of patternNames(declaration.id)) {
      if (!declarations.has(name)) declarations.set(name, []);
      declarations.get(name).push({ node: declaration, scopes: node.kind === 'var' ? [] : scopes });
      if (declaration.init) noteWrite(name, declaration.id.type === 'Identifier' ? declaration.init : null, current);
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const pattern = node.left ?? node.argument;
      for (let target of assignmentTargets(pattern)) {
        if (target.type === 'Identifier') noteWrite(target.name, target === pattern && node.type === 'AssignmentExpression' && node.operator === '=' ? node.right : null, current);
        else {
          while (target.type === 'MemberExpression') target = target.object;
          if (target.type === 'Identifier') noteWrite(target.name, null, current);
        }
      }
    }
    if (['ForInStatement', 'ForOfStatement'].includes(node.type) && node.left.type !== 'VariableDeclaration') for (let target of assignmentTargets(node.left)) {
      while (target.type === 'MemberExpression') target = target.object;
      if (target.type === 'Identifier') noteWrite(target.name, null, current);
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete' && node.argument.type === 'MemberExpression' && node.argument.object.type === 'Identifier') noteWrite(node.argument.object.name, null, current);
    for (const child of children(node).reverse()) pending.push({ node: child, scopes });
  }
  // Refuse ambiguous lexical bindings, receiver mutation, and URL constructor shadowing.
  if (!globalURLAvailable || declarations.has('URL') || callback.params.some(parameter => parameter.name === 'URL') || declarations.has(request) || declarations.has(response) || writes.has(request) || writes.has(response)) return providers;
  const within = (declaration, usage) => declaration.scopes.every((scope, index) => usage.scopes[index] === scope);
  const bindings = new Map();
  for (const [name, values] of declarations) {
    const assignments = writes.get(name) ?? [];
    if (values.length !== 1 || assignments.length !== 1 || !within(values[0], assignments[0])) continue;
    const value = assignments[0].value;
    if (value?.type === 'NewExpression' && value.callee.type === 'Identifier' && value.callee.name === 'URL' && value.arguments.length >= 2 && memberOf(value.arguments[0], request, 'url')) bindings.set(name, { declaration: values[0], assignment: assignments[0], evidence: location(relative, lines, value) });
  }
  const equality = (node, property) => {
    if (node?.type !== 'BinaryExpression' || !['===', '==', '!==', '!='].includes(node.operator)) return null;
    if (memberOf(node.left, request, property) && stringLiteral(node.right) !== null) return stringLiteral(node.right);
    if (memberOf(node.right, request, property) && stringLiteral(node.left) !== null) return stringLiteral(node.left);
    return null;
  };
  const methodChecks = records.filter(record => equality(record.node, 'method') !== null);
  const guards = callback.body.body.filter(node => node.type === 'IfStatement' && ['!==', '!='].includes(node.test.operator) && equality(node.test, 'method') !== null && !node.alternate && (node.consequent.type === 'ReturnStatement' || node.consequent.type === 'BlockStatement' && node.consequent.body.at(-1)?.type === 'ReturnStatement'));
  if (methodChecks.some(record => !guards.some(guard => guard.test === record.node)) || new Set(guards.map(guard => equality(guard.test, 'method'))).size > 1) return providers;
  for (const record of records) {
    const route = record.node;
    if (route.type !== 'IfStatement' || route.test.type !== 'BinaryExpression' || !['===', '=='].includes(route.test.operator)) continue;
    const [receiver, literal] = route.test.left.type === 'MemberExpression' ? [route.test.left, route.test.right] : [route.test.right, route.test.left];
    if (receiver.type !== 'MemberExpression' || receiver.computed || receiver.object.type !== 'Identifier' || receiver.property.name !== 'pathname') continue;
    const binding = bindings.get(receiver.object.name);
    const target = handlerPath(literal);
    if (!binding || !target.pathname || !within(binding.declaration, record) || binding.assignment.node.start >= route.start || guards.some(guard => guard.start >= route.start)) continue;
    const branch = [route.consequent];
    let responseEvidence = null;
    let streamEvidence = null;
    while (branch.length) {
      const node = branch.pop();
      if (isFunction(node)) continue;
      if (node.type === 'CallExpression') {
        const method = node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'Identifier' && node.callee.object.name === response ? node.callee.property.name : null;
        if (['end', 'write', 'writeHead', 'setHeader'].includes(method) || node.callee.type === 'Identifier' && node.arguments[0]?.type === 'Identifier' && node.arguments[0].name === response) responseEvidence ??= location(relative, lines, node);
        if (method === 'setHeader' && stringLiteral(node.arguments[0])?.toLowerCase() === 'content-type' && stringLiteral(node.arguments[1])?.split(';')[0].trim().toLowerCase() === 'text/event-stream') streamEvidence = location(relative, lines, node);
        if (method === 'writeHead' && node.arguments[1]?.type === 'ObjectExpression') for (const header of node.arguments[1].properties) {
          if (header.type === 'Property' && !header.computed && String(header.key.name ?? header.key.value).toLowerCase() === 'content-type' && stringLiteral(header.value)?.split(';')[0].trim().toLowerCase() === 'text/event-stream') streamEvidence = location(relative, lines, node);
        }
      }
      branch.push(...children(node).reverse());
    }
    if (responseEvidence) providers.push({ pathname: target.pathname, method: guards.length ? equality(guards[0].test, 'method') : null, eventStream: Boolean(streamEvidence), streamEvidence, evidence: location(relative, lines, route.test), factoryEvidence: location(relative, lines, factory), urlEvidence: binding.evidence, responseEvidence });
  }
  return providers;
}

function analyzeJavaScript(relative, source, hash) {
  const analysis = { references: [], symbols: [], security: [], diagnostics: [], contracts: { consumers: [], providers: [] } };
  const lines = source.split(/\r?\n/);
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (error) {
    analysis.diagnostics.push({ path: relative, line: error.loc?.line, message: `JavaScript parse error: ${error.message}`, severity: 'warning' });
    analysis.symbolGraph = { nodes: [], edges: [], diagnostics: structuredClone(analysis.diagnostics) };
    return analysis;
  }
  const imported = new Map();
  const moduleBindings = new Set();
  function reference(specifier, kind, node) {
    analysis.references.push({ specifier, kind, evidence: location(relative, lines, node) });
  }
  function security(label, kind, node) {
    const evidence = location(relative, lines, node);
    analysis.security.push({ label, kind, line: evidence.line, evidence });
  }
  for (const item of ast.body) {
    if (item.type === 'ImportDeclaration') {
      const specifier = item.source.value;
      reference(specifier, 'import', item.source);
      for (const binding of item.specifiers) {
        imported.set(binding.local.name, { specifier, member: binding.imported?.name ?? (binding.type === 'ImportDefaultSpecifier' ? 'default' : '*') });
        moduleBindings.add(binding.local.name);
      }
      if (securityModule(specifier)) security(`Dependency: ${specifier}`, 'dependency', item.source);
    }
    if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(item.type) && item.source) {
      reference(item.source.value, 'reexport', item.source);
      if (securityModule(item.source.value)) security(`Dependency: ${item.source.value}`, 'dependency', item.source);
    }
    const declaration = item.declaration ?? item;
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type) && declaration.id) {
      const evidence = location(relative, lines, declaration.id);
      analysis.symbols.push({ name: declaration.id.name, kind: declaration.type === 'ClassDeclaration' ? 'class' : 'function', line: evidence.line, column: evidence.column });
      moduleBindings.add(declaration.id.name);
    }
    if (declaration.type === 'VariableDeclaration') for (const variable of declaration.declarations) for (const name of patternNames(variable.id)) {
      const evidence = location(relative, lines, variable.id);
      analysis.symbols.push({ name, kind: declaration.kind, line: evidence.line, column: evidence.column });
      moduleBindings.add(name);
    }
  }
  const mutatedImports = new Set();
  const mutationStack = [ast];
  while (mutationStack.length) {
    const node = mutationStack.pop();
    const pattern = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete' ? node.argument : ['ForInStatement', 'ForOfStatement'].includes(node.type) && node.left.type !== 'VariableDeclaration' ? node.left : null;
    for (let target of assignmentTargets(pattern)) {
      while (target.type === 'MemberExpression') {
        if (target.object.type === 'Identifier' && ['globalThis', 'window'].includes(target.object.name)) {
          const property = target.computed ? stringLiteral(target.property) : target.property.name;
          if (property === null) ['fetch', 'EventSource', 'URL'].forEach(name => moduleBindings.add(name));
          else if (['fetch', 'EventSource', 'URL'].includes(property)) moduleBindings.add(property);
        }
        target = target.object;
      }
      if (target.type === 'Identifier') {
        if (imported.has(target.name)) mutatedImports.add(target.name);
        if (['fetch', 'EventSource', 'URL'].includes(target.name)) moduleBindings.add(target.name);
      }
    }
    mutationStack.push(...children(node));
  }
  const stack = [{ node: ast, shadowed: new Set() }];
  while (stack.length) {
    const { node, shadowed } = stack.pop();
    const localNames = scopeNames(node);
    const nextShadowed = localNames.size ? new Set([...shadowed, ...localNames]) : shadowed;
    const globalAvailable = name => !moduleBindings.has(name) && !nextShadowed.has(name);
    if (node.type === 'ImportExpression') {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        reference(node.source.value, 'dynamic-import', node.source);
        if (securityModule(node.source.value)) security(`Dependency: ${node.source.value}`, 'dependency', node.source);
      } else analysis.diagnostics.push({ path: relative, line: node.loc.start.line, message: 'Computed dynamic import cannot be resolved statically', severity: 'info' });
    }
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && globalAvailable('URL')) {
      const [target, base] = node.arguments;
      if (target?.type === 'Literal' && typeof target.value === 'string' && base?.type === 'MemberExpression' && !base.computed && base.property.name === 'url' && base.object.type === 'MetaProperty' && base.object.meta.name === 'import' && base.object.property.name === 'meta') {
        reference(target.value, isTest(relative) ? 'test-reference' : 'asset', target);
      }
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      let callee = node.callee;
      const members = [];
      while (callee?.type === 'MemberExpression') {
        members.unshift(callee.computed ? callee.property.type === 'Literal' ? callee.property.value : '?' : callee.property.name);
        callee = callee.object;
      }
      const binding = callee?.type === 'Identifier' && !nextShadowed.has(callee.name) ? imported.get(callee.name) : null;
      if (binding && securityModule(binding.specifier)) security(`Call: ${binding.specifier} ${[binding.member, ...members].filter(member => member !== '*' && member !== 'default').join('.') || callee.name}`, 'operation', node);
      if (callee?.type === 'Identifier' && members.length === 0 && globalAvailable(callee.name) && ['fetch', 'eval', 'Function'].includes(callee.name)) {
        security(callee.name === 'fetch' ? 'Network call: fetch' : `Dynamic code: ${callee.name}`, callee.name === 'fetch' ? 'network' : 'dynamic-code', node);
      }
      if (callee?.type === 'Identifier' && members.length === 0 && globalAvailable(callee.name) && (node.type === 'CallExpression' && callee.name === 'fetch' || node.type === 'NewExpression' && callee.name === 'EventSource')) {
        const target = requestPath(node.arguments[0]);
        if (target.pathname) analysis.contracts.consumers.push({ pathname: target.pathname, kind: callee.name === 'EventSource' ? 'event-stream' : 'http', method: callee.name === 'EventSource' ? 'GET' : fetchMethod(node.arguments[1]), evidence: location(relative, lines, node) });
        else if (target.unknown) analysis.diagnostics.push({ path: relative, line: node.loc.start.line, message: 'HTTP/SSE target is not a supported fixed same-origin /api pathname', severity: 'info' });
        if (callee.name === 'EventSource') security('Network stream: EventSource', 'network', node);
      }
      if (node.type === 'CallExpression' && binding && !mutatedImports.has(callee.name) && ['http', 'node:http'].includes(binding.specifier) && (binding.member === 'createServer' && members.length === 0 || ['*', 'default'].includes(binding.member) && members.length === 1 && members[0] === 'createServer')) {
        const callback = node.arguments.at(-1);
        if (callback && isFunction(callback)) analysis.contracts.providers.push(...serverContracts(callback, node, relative, lines, globalAvailable('URL')));
      }
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'process' && globalAvailable('process') && ((!node.computed && node.property.name === 'env') || (node.computed && node.property.value === 'env'))) security('Environment access: process.env', 'environment', node);
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && ((!node.left.computed && node.left.property.name === 'innerHTML') || (node.left.computed && node.left.property.value === 'innerHTML'))) security('DOM HTML assignment: innerHTML', 'dom-html', node);
    for (const child of children(node).reverse()) stack.push({ node: child, shadowed: nextShadowed });
  }
  analysis.symbolGraph = analyzeSymbolGraph(relative, source, { ast, hash });
  return analysis;
}

// Small HTML tokenizer: skip comments and raw script/style bodies; inspect real tags.
function analyzeHTML(relative, source) {
  const analysis = { references: [], symbols: [], security: [], diagnostics: [] };
  const tag = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  let match;
  while ((match = tag.exec(source))) {
    if (!match[1] || match[0].startsWith('</')) continue;
    const name = match[1].toLowerCase();
    if (name === 'script' || name === 'link') {
      const attribute = name === 'script' ? 'src' : 'href';
      const attributes = match[0].slice(match[0].indexOf(match[1]) + match[1].length, -1);
      const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let item;
      while ((item = attributePattern.exec(attributes))) {
        if (item[1].toLowerCase() !== attribute) continue;
        const specifier = item[2] ?? item[3] ?? item[4];
        if (!specifier) continue;
        const prefix = source.slice(0, match.index);
        analysis.references.push({ specifier, kind: 'asset', html: true, evidence: { path: relative, line: prefix.split('\n').length, column: match.index - prefix.lastIndexOf('\n'), snippet: match[0].trim().slice(0, 220) } });
        break;
      }
    }
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].includes(name) && !match[0].endsWith('/>')) {
      const close = new RegExp(`</${name}\\s*>`, 'ig');
      close.lastIndex = tag.lastIndex;
      const end = close.exec(source);
      tag.lastIndex = end ? close.lastIndex : source.length;
    }
  }
  return analysis;
}

function analyze(relative, source, hash) {
  const extension = path.extname(relative);
  if (extension === '.js' || extension === '.mjs') return analyzeJavaScript(relative, source, hash);
  if (extension === '.html') return analyzeHTML(relative, source);
  const result = { references: [], symbols: [], security: [], diagnostics: [] };
  if (extension === '.json') try { JSON.parse(source); } catch (error) {
    result.diagnostics.push({ path: relative, message: `JSON parse error: ${error.message}`, severity: 'warning' });
  }
  return result;
}

function resolveReference(relative, reference, available) {
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
  const files = inventory(root, diagnostics, excluded, policy, unsupported);
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
      const cached = priorCache?.get(relative);
      const analysis = cached?.hash === hash ? (cachedFiles++, cached.analysis) : analyze(relative, bytes.toString('utf8'), hash);
      nextCache.set(relative, { hash, analysis });
      analyses.set(relative, analysis);
      const layers = ['project', ...(isTest(relative) ? ['testing'] : []), ...(analysis.security.length ? ['security'] : [])];
      // Clones prevent a consumer modifying its serialized result from poisoning the cache.
      nodes.push({ id: fileId(relative), path: relative, label: path.posix.basename(relative), kind: kindFor(relative), language: languageFor(relative), hash, bytes: bytes.length, layers, symbols: structuredClone(analysis.symbols), security: structuredClone(analysis.security), diagnostics: structuredClone(analysis.diagnostics) });
      diagnostics.push(...structuredClone(analysis.diagnostics));
    } catch (error) {
      diagnostics.push({ path: relative, message: `Cannot index file: ${error.message}`, severity: 'warning' });
    }
  }
  const available = new Map(nodes.map(node => [node.path, node]));
  const externalNodes = new Map();
  const groupedEdges = new Map();
  for (const [relative, analysis] of analyses) for (const reference of analysis.references) {
    const resolved = resolveReference(relative, reference, available);
    if (resolved.ignored) continue;
    if (resolved.error) {
      const diagnostic = { path: relative, line: reference.evidence.line, message: resolved.error, severity: 'warning' };
      diagnostics.push(diagnostic);
      available.get(relative).diagnostics.push(diagnostic);
      continue;
    }
    const from = fileId(relative);
    const to = resolved.target ? fileId(resolved.target) : `external:${resolved.external}`;
    const testing = isTest(relative) || (resolved.target && isTest(resolved.target));
    const security = Boolean(resolved.external && securityModule(resolved.external));
    const layers = ['project', ...(testing ? ['testing'] : []), ...(security ? ['security'] : [])];
    if (resolved.external && !externalNodes.has(to)) externalNodes.set(to, { id: to, path: null, label: resolved.external, kind: 'external', layers: ['project'], symbols: [], security: [], diagnostics: [] });
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
      'Read-only static evidence; scanned code is never executed. Security relevance is not a vulnerability or safety verdict.',
      'Testing relationships are static references, not coverage, execution, or passing-test evidence.',
      'JavaScript modules use Acorn. Only literal imports/reexports/dynamic imports and new URL(literal, import.meta.url) are resolved; CommonJS require, computed paths, aliases and extension inference are unsupported.',
      'HTTP/SSE edges are static-contract matches, never runtime execution: nonshadowed fetch/EventSource fixed same-origin /api paths (dynamic query only) match one inline imported http.createServer handler using one unmodified new URL(request.url, base) binding and exact pathname guard. SSE requires static event-stream response evidence. Frameworks, indirect handlers, computed pathnames and ambiguous providers are unsupported; method assurance is explicit on each contract.',
      'Symbol hierarchy is lexical containment. Call edges are same-file direct lexical references and known same-class this.method references, not runtime execution, callback scheduling, dynamic dispatch, coverage or control flow. Imported/aliased/computed calls and class field/static-block bodies are omitted; ambiguous or directly reassigned bindings/methods are excluded. Anonymous closures retain nearest named owner with nested-closure evidence. Symbol analysis has per-file node/edge/AST/depth budgets.',
      'HTML links inspect script src and link href; inline scripts, CSS imports/URLs, Python dependencies and Markdown links are not analyzed.',
      'Only .mjs, .js, .json, .html, .css, .md and .py files are inventoried. Hidden paths, secrets/env files, symlinks and configured excluded paths are excluded. Other source languages are reported as unsupported.',
      `Budgets: ${INDEX_LIMITS.files} files, ${INDEX_LIMITS.fileBytes} bytes/file, ${INDEX_LIMITS.totalBytes} total bytes, ${INDEX_LIMITS.entries} directory entries, depth ${INDEX_LIMITS.depth}.`,
      'Each file uses no-follow open and realpath/inode checks. A scan is not an atomic filesystem snapshot; concurrent writes can yield partial diagnostics.'
    ]
  };
  const result = {
    schemaVersion: 1,
    project: { name: path.basename(root), root },
    revision: sha(JSON.stringify({ nodes, edges, symbolGraph, diagnostics, excluded: scope.excluded, generic: policy.generic, metadata: { path: metadata.path, hash: metadata.hash, status: metadata.status } })),
    generatedAt: new Date().toISOString(),
    status: diagnostics.some(item => item.severity === 'warning' || item.severity === 'error') ? 'partial' : 'current',
    nodes, edges, symbolGraph, diagnostics, metadata,
    stats: { files: available.size, edges: edges.length, tests: [...available.values()].filter(node => node.kind === 'test').length, security: [...available.values()].filter(node => node.security.length).length, parseMs: Math.round((performance.now() - started) * 100) / 100, cachedFiles },
    scope
  };
  CACHE.set(result, nextCache);
  return result;
}
