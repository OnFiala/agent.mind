import path from 'node:path';
import { parse } from 'acorn';
import { analyzeSymbolGraph } from './symbol-index.mjs';
import { analyzeTypedSource, isTypedSource } from './typed-analysis.mjs';

// Pure synchronous source analysis. No filesystem, project resolver or cache.
const SECURITY_MODULES = new Set(['fs', 'fs/promises', 'http', 'https', 'http2', 'net', 'tls', 'crypto', 'child_process', 'dgram', 'dns', 'worker_threads', 'vm', 'module']);
export const securityModule = specifier => SECURITY_MODULES.has(specifier.replace(/^node:/, ''));
const location = (relative, lines, node) => {
  const line = node.loc?.start.line ?? 1;
  return { path: relative, line, column: (node.loc?.start.column ?? 0) + 1, snippet: lines[line - 1]?.trim().slice(0, 220) ?? '' };
};

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
  } else if (node.type === 'ClassExpression' && node.id) names.add(node.id.name);
  else if (node.type === 'CatchClause') patternNames(node.param, names);
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

function analyzeJavaScript(relative, source, hash, testFile) {
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
        reference(target.value, testFile ? 'test-reference' : 'asset', target);
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

/**
 * Analyze already checked UTF-8 source; hash identifies the original file bytes.
 * The caller owns safe reads, test-file classification, caching and resolution.
 * Returns references (unresolved specifiers), symbols, security and diagnostics;
 * JavaScript also returns contracts; JS and the typed pilot return symbolGraph.
 * Other types keep those fields absent; the typed pilot adds parser provenance.
 * Locations use 1-based lines/columns; columns count UTF-16 code units, not bytes.
 * Acorn offsets are 0-based UTF-16 units; they stay internal. No newline rewriting.
 * HTML only extracts script src/link href; embedded code remains unanalyzed.
 */
export function analyzeSource(relative, source, hash, testFile = false) {
  const extension = path.extname(relative);
  if (extension === '.js' || extension === '.mjs') return analyzeJavaScript(relative, source, hash, testFile);
  if (isTypedSource(relative)) return analyzeTypedSource(relative, source, hash);
  if (extension === '.html') return analyzeHTML(relative, source);
  const result = { references: [], symbols: [], security: [], diagnostics: [] };
  if (extension === '.json') try { JSON.parse(source); } catch (error) {
    result.diagnostics.push({ path: relative, message: `JSON parse error: ${error.message}`, severity: 'warning' });
  }
  return result;
}
