import { parse } from '@babel/parser';

// Syntax-only pilot. Input text has already crossed the index's read boundary.
// This module never loads project configuration, resolves imports or runs source.
export const TYPED_LIMITS = Object.freeze({ bytes: 64 * 1024, symbols: 2000, astNodes: 100000, depth: 256 });
const PRODUCER = Object.freeze({ name: '@babel/parser', version: '7.29.12', mode: 'syntax-only' });
export const isTypedSource = relative => /\.(?:ts|tsx|jsx)$/.test(relative) && !relative.endsWith('.d.ts');
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'TSDeclareFunction']);
const classes = new Set(['ClassDeclaration', 'ClassExpression']);
const declarations = { TSInterfaceDeclaration: 'interface', TSTypeAliasDeclaration: 'type', TSEnumDeclaration: 'enum', TSModuleDeclaration: 'namespace' };
const methods = new Set(['ClassMethod', 'ClassPrivateMethod', 'TSDeclareMethod', 'TSMethodSignature']);
const omittedBodies = new Set(['ClassProperty', 'ClassPrivateProperty', 'ClassAccessorProperty', 'StaticBlock', 'ObjectMethod']);

function children(node) {
  const result = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') result.push(child);
    } else if (value && typeof value.type === 'string') result.push(value);
  }
  return result;
}

export function analyzeTypedSource(relative, source, hash) {
  const diagnostics = [{ path: relative, severity: 'warning', message: 'Syntax-only pilot: named declarations only; imports, type relationships, calls, security and HTTP/framework behavior are not analyzed.' }];
  const result = { references: [], symbols: [], security: [], diagnostics, symbolGraph: { nodes: [], edges: [], diagnostics: [] }, producer: { ...PRODUCER } };
  const warn = (message, node) => diagnostics.push({ path: relative, ...(node?.loc ? { line: node.loc.start.line, column: node.loc.start.column + 1 } : {}), severity: 'warning', message });
  if (Buffer.byteLength(source, 'utf8') > TYPED_LIMITS.bytes) {
    warn(`Syntax analysis limit: ${TYPED_LIMITS.bytes} bytes per file; text remains available.`);
    return result;
  }
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', sourceFilename: relative, errorRecovery: false, attachComment: false, ranges: true, plugins: relative.endsWith('.jsx') ? ['jsx'] : relative.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
  } catch (error) {
    warn(`Syntax parse error: ${error.message}`, error.loc ? { loc: { start: error.loc } } : null);
    return result;
  }
  const candidates = [];
  const omitted = new Set();
  const omit = (node, reason) => {
    if (!omitted.has(reason)) { omitted.add(reason); warn(`Syntax scope omitted: ${reason}`, node); }
  };
  const add = (node, name, kind, owner) => {
    if (candidates.length >= TYPED_LIMITS.symbols) return null;
    const qualifiedName = owner ? `${owner.qualifiedName}.${name}` : name;
    const symbol = {
      id: `symbol:${relative}#${qualifiedName}`, path: relative, name, label: name, qualifiedName,
      kind, languageKind: node.type, parentId: owner?.id ?? null,
      line: node.loc.start.line, column: node.loc.start.column + 1,
      endLine: node.loc.end.line, endColumn: node.loc.end.column + 1,
      range: { start: node.start, end: node.end, unit: 'utf16-code-unit', endExclusive: true },
      hash, producer: { ...PRODUCER }
    };
    candidates.push(symbol);
    return symbol;
  };
  const pending = [{ node: ast.program, owner: null, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { node, owner, depth, suppliedName } = pending.pop();
    if (++visited > TYPED_LIMITS.astNodes || depth > TYPED_LIMITS.depth) {
      warn('Syntax traversal limit reached; symbols from this file are withheld.');
      return result;
    }
    if (omittedBodies.has(node.type)) { omit(node, 'class fields/static blocks and object methods'); continue; }
    let own = owner;
    let name = null;
    let kind = null;
    if (functions.has(node.type) || classes.has(node.type)) {
      name = suppliedName ?? node.id?.name;
      kind = classes.has(node.type) ? 'class' : node.type === 'TSDeclareFunction' ? 'signature' : 'function';
      if (!name) { omit(node, 'anonymous function/class bodies'); continue; }
    } else if (Object.hasOwn(declarations, node.type)) {
      name = node.id?.type === 'Identifier' ? node.id.name : null;
      kind = declarations[node.type];
      if (!name) { omit(node, 'string-named ambient modules'); continue; }
    } else if (methods.has(node.type)) {
      name = !node.computed && node.key?.type === 'Identifier' ? node.key.name : !node.computed && node.key?.type === 'PrivateName' ? `#${node.key.id.name}` : null;
      kind = node.type === 'TSMethodSignature' || node.type === 'TSDeclareMethod' ? 'signature' : 'method';
      if (!owner || !name) { omit(node, 'computed or string-named methods'); continue; }
    }
    if (name) {
      own = add(node, name, kind, owner);
      if (!own) { warn('Syntax symbol limit reached; symbols from this file are withheld.'); return result; }
    }
    // A variable gives an otherwise anonymous function/class its source name.
    // Skip the binding's type annotation so it cannot become a child of the body.
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && (functions.has(node.init.type) || classes.has(node.init.type))) {
      pending.push({ node: node.init, owner, depth: depth + 1, suppliedName: node.id.name });
      continue;
    }
    for (const child of children(node).reverse()) pending.push({ node: child, owner: own, depth: depth + 1 });
  }
  // Source names alone cannot distinguish overloads, merges or shadowed declarations.
  // Withhold every conflicting declaration and its descendants instead of choosing one.
  const counts = new Map();
  for (const symbol of candidates) counts.set(symbol.id, (counts.get(symbol.id) ?? 0) + 1);
  const invalid = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  for (const id of invalid) {
    const symbol = candidates.find(candidate => candidate.id === id);
    warn(`Ambiguous declaration ${symbol.qualifiedName}; overloads/merged or duplicate declarations and their descendants are withheld.`, { loc: { start: { line: symbol.line, column: symbol.column - 1 } } });
  }
  // Candidates are in parent-before-child traversal order.
  for (const symbol of candidates) if (invalid.has(symbol.parentId)) invalid.add(symbol.id);
  result.symbolGraph.nodes = candidates.filter(symbol => !invalid.has(symbol.id));
  result.symbols = result.symbolGraph.nodes.filter(symbol => !symbol.parentId).map(({ name, kind, line, column }) => ({ name, kind, line, column }));
  return result;
}
