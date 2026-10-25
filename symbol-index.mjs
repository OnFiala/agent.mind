import { createHash } from 'node:crypto';
import { parse } from 'acorn';

export const SYMBOL_LIMITS = Object.freeze({ nodes: 2000, edges: 5000, callSites: 10000, astNodes: 100000, depth: 256 });
const digest = value => createHash('sha256').update(value).digest('hex');
const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
const isClass = node => ['ClassDeclaration', 'ClassExpression'].includes(node.type);

function children(node) {
  const output = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) output.push(...value.filter(item => item && typeof item.type === 'string'));
    else if (value && typeof value.type === 'string') output.push(value);
  }
  return output;
}

function names(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return names(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return names(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(names);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(item => names(item.value ?? item.argument));
  return [];
}

function writable(pattern) {
  if (!pattern) return [];
  if (['Identifier', 'MemberExpression'].includes(pattern.type)) return [pattern];
  if (pattern.type === 'RestElement') return writable(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return writable(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(writable);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(item => writable(item.value ?? item.argument));
  return [];
}

function methodName(node) {
  if (node.computed) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'PrivateIdentifier') return `#${node.key.name}`;
  return node.key.type === 'Literal' && typeof node.key.value === 'string' ? node.key.value : null;
}

// Unsupported field/static-block bodies produce no calls, but their lexical
// this writes still invalidate nominal method targets. Ordinary functions in
// these unsupported bodies may later be called with the instance/class as this;
// conservatively include them. A nested class has its own known this boundary.
function hasLexicalThisWrite(root) {
  const pending = root ? [root] : [];
  while (pending.length) {
    const node = pending.pop();
    if (isClass(node)) continue;
    const pattern = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete' ? node.argument : ['ForInStatement', 'ForOfStatement'].includes(node.type) && node.left.type !== 'VariableDeclaration' ? node.left : null;
    for (let target of writable(pattern)) {
      if (target.type !== 'MemberExpression') continue;
      while (target.type === 'MemberExpression') target = target.object;
      if (target.type === 'ThisExpression') return true;
    }
    pending.push(...children(node));
  }
  return false;
}

/** Static lexical containment and same-file call references; never evaluates source. */
export function analyzeSymbolGraph(relative, source, { ast, hash = digest(source) } = {}) {
  const diagnostics = [];
  if (!ast) try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (error) {
    return { nodes: [], edges: [], diagnostics: [{ path: relative, line: error.loc?.line, severity: 'warning', message: `Symbol parse error: ${error.message}` }] };
  }
  const lines = source.split(/\r?\n/);
  const evidence = node => ({ path: relative, line: node.loc.start.line, column: node.loc.start.column + 1, snippet: lines[node.loc.start.line - 1]?.trim().slice(0, 220) ?? '' });
  const candidates = [];
  const records = [];
  const scopes = [];
  const classMethods = new Map();
  const constructible = new Set();
  let visited = 0;
  let truncated = false;
  const scope = (parent, type) => {
    const result = { parent, type, bindings: new Map() };
    scopes.push(result);
    return result;
  };
  const bind = (current, name, symbol = null) => {
    if (!current.bindings.has(name)) current.bindings.set(name, []);
    const binding = { name, symbol, mutated: false };
    current.bindings.get(name).push(binding);
    return binding;
  };
  const lookup = (current, name) => {
    for (let item = current; item; item = item.parent) if (item.bindings.has(name)) return item.bindings.get(name);
    return [];
  };
  const symbol = (node, name, kind, owner) => {
    if (!name || candidates.length >= SYMBOL_LIMITS.nodes) { truncated = true; return null; }
    const qualifiedName = owner ? `${owner.qualifiedName}.${name}` : name;
    const result = { id: `symbol:${relative}#${qualifiedName}`, path: relative, name, label: name, qualifiedName, kind, parentId: owner?.id ?? null, line: node.loc.start.line, column: node.loc.start.column + 1, endLine: node.loc.end.line, hash };
    candidates.push(result);
    if (kind === 'class' || kind === 'function' && node.type !== 'ArrowFunctionExpression' && !node.async && !node.generator) constructible.add(result);
    return result;
  };
  function visit(node, context, depth = 0, supplied = null) {
    if (!node || ++visited > SYMBOL_LIMITS.astNodes || depth > SYMBOL_LIMITS.depth) { truncated = true; return; }
    let current = context;
    if (isClass(node)) {
      const own = supplied ?? (node.id ? symbol(node, node.id.name, 'class', context.owner) : null);
      if (node.type === 'ClassDeclaration' && node.id) bind(context.scope, node.id.name, own);
      if (!own && node.id && truncated) return;
      if (node.superClass) visit(node.superClass, context, depth + 1);
      const classScope = scope(context.scope, 'class');
      if (node.id) bind(classScope, node.id.name, own);
      const methods = new Map();
      if (own) classMethods.set(own.id, methods);
      for (const method of node.body.body) {
        if (method.type !== 'MethodDefinition') {
          // Field initializers/static blocks have no supported named callable owner.
          continue;
        }
        const name = methodName(method);
        const member = own && name ? symbol(method, name, 'method', own) : null;
        if (member) {
          const key = `${Boolean(method.static)}:${name}`;
          if (!methods.has(key)) methods.set(key, []);
          methods.get(key).push({ symbol: member, mutated: false, callable: method.kind === 'method' });
        }
        if (!(own && name && !member)) visit(method.value, { ...context, scope: classScope, owner: own ?? context.owner, classBinding: own ? { id: own.id, static: Boolean(method.static) } : null, closureDepth: 0, method: true }, depth + 1, member);
      }
      for (const field of node.body.body.filter(item => item.type === 'PropertyDefinition')) for (const [key, entries] of methods) {
        const name = methodName(field);
        if (key.startsWith(`${Boolean(field.static)}:`) && (name === null || key === `${Boolean(field.static)}:${name}`)) entries.forEach(entry => { entry.mutated = true; });
      }
      for (const item of node.body.body) if (item.type === 'StaticBlock' || item.type === 'PropertyDefinition') {
        const isStatic = item.type === 'StaticBlock' || Boolean(item.static);
        if (hasLexicalThisWrite(item.type === 'StaticBlock' ? item : item.value)) for (const [key, entries] of methods) if (key.startsWith(`${isStatic}:`)) entries.forEach(entry => { entry.mutated = true; });
      }
      return;
    }
    if (isFunction(node)) {
      const own = supplied ?? (node.id ? symbol(node, node.id.name, 'function', context.owner) : null);
      if (node.type === 'FunctionDeclaration' && node.id) bind(context.scope, node.id.name, own);
      if (!own && node.id && truncated) return;
      const functionScope = scope(context.scope, 'function');
      if (node.type === 'FunctionExpression' && node.id) bind(functionScope, node.id.name, own);
      node.params.flatMap(names).forEach(name => bind(functionScope, name));
      current = {
        ...context, scope: functionScope, owner: own ?? context.owner,
        classBinding: context.method || node.type === 'ArrowFunctionExpression' ? context.classBinding : null,
        closureDepth: own ? 0 : context.closureDepth + 1, method: false
      };
      for (const parameter of node.params) visit(parameter, current, depth + 1);
      visit(node.body, current, depth + 1);
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'CatchClause' || ['ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) {
      current = { ...context, scope: scope(context.scope, 'block') };
      if (node.type === 'CatchClause') names(node.param).forEach(name => bind(current.scope, name));
    }
    if (node.type === 'ImportDeclaration') {
      node.specifiers.forEach(specifier => bind(current.scope, specifier.local.name));
      return;
    }
    if (node.type === 'VariableDeclaration') {
      let declarationScope = current.scope;
      if (node.kind === 'var') while (declarationScope.parent && !['function', 'program'].includes(declarationScope.type)) declarationScope = declarationScope.parent;
      for (const declaration of node.declarations) {
        const own = declaration.id.type === 'Identifier' && declaration.init && (isFunction(declaration.init) || isClass(declaration.init)) ? symbol(declaration.init, declaration.id.name, isClass(declaration.init) ? 'class' : 'function', current.owner) : null;
        names(declaration.id).forEach(name => bind(declarationScope, name, own));
        visit(declaration.id, current, depth + 1);
        if (declaration.init && !(truncated && !own && declaration.id.type === 'Identifier' && (isFunction(declaration.init) || isClass(declaration.init)))) visit(declaration.init, current, depth + 1, own);
      }
      return;
    }
    records.push({ node, ...current });
    for (const child of children(node)) visit(child, current, depth + 1);
  }
  visit(ast, { scope: scope(null, 'program'), owner: null, classBinding: null, closureDepth: 0, method: false });

  // Resolve after collecting every lexical declaration, so declaration order
  // does not guess a runtime execution order or bypass later shadowing.
  for (const record of records) {
    const node = record.node;
    const target = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete' ? node.argument : ['ForInStatement', 'ForOfStatement'].includes(node.type) && node.left.type !== 'VariableDeclaration' ? node.left : null;
    for (const item of writable(target)) {
      if (item.type === 'Identifier') lookup(record.scope, item.name).forEach(binding => { binding.mutated = true; });
      else {
        let receiver = item.object;
        if (receiver.type === 'ThisExpression' && record.classBinding) {
          const name = item.computed ? item.property.type === 'Literal' ? item.property.value : null : item.property.type === 'PrivateIdentifier' ? `#${item.property.name}` : item.property.name;
          for (const [key, methods] of classMethods.get(record.classBinding.id) ?? []) if (name === null || key === `${record.classBinding.static}:${name}`) methods.forEach(method => { method.mutated = true; });
        }
        // Explicit Class.method / Class.prototype.method writes invalidate
        // matching same-class this calls. No receiver aliases are inferred.
        let prototype = false;
        if (receiver.type === 'MemberExpression' && !receiver.computed && receiver.property.name === 'prototype') { prototype = true; receiver = receiver.object; }
        if (receiver.type === 'Identifier') for (const binding of lookup(record.scope, receiver.name)) if (binding.symbol?.kind === 'class') {
          const name = item.computed ? item.property.type === 'Literal' ? item.property.value : null : item.property.name;
          for (const [key, methods] of classMethods.get(binding.symbol.id) ?? []) if (name === null || !prototype && name === 'prototype' && key.startsWith('false:') || key === `${!prototype}:${name}`) methods.forEach(method => { method.mutated = true; });
        }
      }
    }
  }
  const grouped = new Map();
  for (const node of candidates) {
    if (!grouped.has(node.id)) grouped.set(node.id, []);
    grouped.get(node.id).push(node);
  }
  const valid = new Map([...grouped].filter(([, values]) => values.length === 1).map(([id, values]) => [id, values[0]]));
  for (const [id, values] of grouped) if (values.length > 1) diagnostics.push({ path: relative, line: values[0].line, severity: 'info', message: `Ambiguous symbol name ${values[0].qualifiedName}; duplicate IDs and call targets are omitted` });
  for (const node of candidates) if (node.parentId && !valid.has(node.parentId)) valid.delete(node.id);
  for (const item of scopes) for (const [name, bindings] of item.bindings) if (bindings.length > 1) diagnostics.push({ path: relative, severity: 'info', message: `Ambiguous lexical binding ${name}; calls through this binding are omitted` });
  const edges = new Map();
  let unresolved = 0;
  let callSites = 0;
  for (const record of records) {
    const call = record.node;
    if (!['CallExpression', 'NewExpression'].includes(call.type) || record.owner && !valid.has(record.owner.id)) continue;
    if (++callSites > SYMBOL_LIMITS.callSites) { truncated = true; continue; }
    let target = null;
    if (call.callee.type === 'Identifier') {
      const bindings = lookup(record.scope, call.callee.name);
      if (bindings.length === 1 && !bindings[0].mutated) {
        const candidate = bindings[0].symbol;
        if (candidate && (call.type === 'NewExpression' ? constructible.has(candidate) : candidate.kind === 'function')) target = candidate;
      }
    } else if (call.type === 'CallExpression' && call.callee.type === 'MemberExpression' && !call.callee.computed && call.callee.object.type === 'ThisExpression' && record.classBinding) {
      const name = call.callee.property.type === 'PrivateIdentifier' ? `#${call.callee.property.name}` : call.callee.property.name;
      const methods = classMethods.get(record.classBinding.id)?.get(`${record.classBinding.static}:${name}`) ?? [];
      if (methods.length === 1 && methods[0].callable && !methods[0].mutated) target = methods[0].symbol;
    }
    if (!target || !valid.has(target.id)) { unresolved++; continue; }
    const from = record.owner?.id ?? `file:${relative}`;
    const key = `${from}\0${target.id}`;
    if (!edges.has(key)) {
      if (edges.size >= SYMBOL_LIMITS.edges) { truncated = true; continue; }
      edges.set(key, { id: `call:${digest(key).slice(0, 24)}`, from, to: target.id, kind: 'call', label: 'calls', layers: ['project', ...(/(^|\/)(test|tests)\/|\.(test|spec)\.[cm]?js$/.test(relative) ? ['testing'] : [])], provenance: 'static-call', execution: 'not-observed', evidence: [] });
    }
    edges.get(key).evidence.push({ ...evidence(call), containment: record.closureDepth ? 'nested-closure' : 'direct-body' });
  }
  if (unresolved) diagnostics.push({ path: relative, severity: 'info', message: `${unresolved} call sites remain unresolved (imports, member/dynamic calls, shadows or mutations); no call edges are guessed` });
  if (truncated) diagnostics.push({ path: relative, severity: 'warning', message: 'Symbol analysis budget exceeded; hierarchy and calls are partial' });
  return { nodes: [...valid.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')), diagnostics };
}
