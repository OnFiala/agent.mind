import { createHash } from 'node:crypto';
import { parser } from '@lezer/python';

// Checked text in, static evidence out. No filesystem, interpreter, environment
// or installed-package queries are involved in this bounded adapter.
export const PYTHON_LIMITS = Object.freeze({ bytes: 64 * 1024, symbols: 2000, astNodes: 100000, depth: 256, callSites: 10000, edges: 5000 });
const PRODUCER = Object.freeze({ name: '@lezer/python', version: '1.1.19', mode: 'static-source' });
export const isPythonSource = relative => relative.endsWith('.py');
const digest = value => createHash('sha256').update(value).digest('hex');
// Python compares identifier tokens after NFKC normalization; displayed source
// spelling, symbol IDs, module references and ranges remain untouched.
const bindingKey = name => name.normalize('NFKC');
const privateContext = name => {
  const prefix = bindingKey(name).replace(/^_+/, '');
  return Object.freeze({ prefix, length: [...prefix].length });
};
// Keep the index's test naming contract without introducing index/I/O coupling.
const isTestSource = name => /(^|\/)(test|tests)\//.test(name) || /\.(test|spec)\.(m?js|py|ts|tsx|jsx)$/.test(name) || /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(name);

function sourceLocations(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\r') {
      if (source[index + 1] === '\n') index++;
      starts.push(index + 1);
    } else if (source[index] === '\n') starts.push(index + 1);
  }
  return offset => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

export function analyzePythonSource(relative, source, hash) {
  const diagnostics = [{ path: relative, severity: 'info', message: 'Bounded Python static source analysis; editor grammar is not CPython syntax/semantic validation. No type, cross-file call, runtime, installed-package or security inference. Unsupported PEP 614 decorator expressions and PEP 696 type parameter defaults fail parsing.' }];
  const result = { references: [], symbols: [], security: [], diagnostics, symbolGraph: { nodes: [], edges: [], diagnostics: [] }, producer: { ...PRODUCER } };
  if (Buffer.byteLength(source, 'utf8') > PYTHON_LIMITS.bytes) {
    diagnostics.push({ path: relative, severity: 'warning', message: `Syntax analysis limit: ${PYTHON_LIMITS.bytes} bytes per file; analysis is withheld and text remains available.` });
    return result;
  }
  const locate = sourceLocations(source), lines = source.split(/\r\n|\r|\n/);
  const text = node => source.slice(node.from, node.to);
  const evidence = node => { const location = locate(node.from); return { path: relative, ...location, snippet: lines[location.line - 1]?.trim().slice(0, 220) ?? '' }; };
  const report = (message, node, severity = 'warning') => diagnostics.push({ path: relative, ...(node ? locate(node.from) : {}), severity, message });
  let tree;
  try { tree = parser.parse(source); }
  catch (error) { report(`Syntax parse error: ${error.message}; analysis from this file is withheld.`, null, 'error'); return result; }
  const candidates = [], all = [];
  const root = { children: [] };
  const pending = [{ node: tree.topNode, parent: root, owner: null, depth: 0 }];
  while (pending.length) {
    const { node, parent, owner, depth } = pending.pop();
    if (all.length >= PYTHON_LIMITS.astNodes || depth > PYTHON_LIMITS.depth) {
      report('Syntax traversal limit reached; analysis from this file is withheld.', node); return result;
    }
    if (node.type.isError) { report('Syntax parse error: parser recovery/error node; analysis from this file is withheld.', node, 'error'); return result; }
    const current = { name: node.name, from: node.from, to: node.to, children: [], parent };
    parent.children.push(current); all.push(current);
    let own = owner;
    if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') {
      const identifier = node.getChild('VariableName');
      if (!identifier) { report('Syntax declaration has no unambiguous source name; analysis is withheld.', node, 'error'); return result; }
      if (candidates.length >= PYTHON_LIMITS.symbols) { report('Syntax symbol limit reached; analysis from this file is withheld.', node); return result; }
      const name = source.slice(identifier.from, identifier.to), qualifiedName = owner ? `${owner.qualifiedName}.${name}` : name;
      const rangeEnd = source[node.to - 1] === '\r' && source[node.to] === '\n' ? node.to + 1 : node.to;
      const start = locate(node.from), end = locate(rangeEnd);
      own = {
        id: `symbol:${relative}#${qualifiedName}`, path: relative, name, label: name, qualifiedName,
        kind: node.name === 'ClassDefinition' ? 'class' : owner?.kind === 'class' ? 'method' : 'function',
        languageKind: node.name, parentId: owner?.id ?? null,
        line: start.line, column: start.column, endLine: end.line, endColumn: end.column,
        range: { start: node.from, end: rangeEnd, unit: 'utf16-code-unit', endExclusive: true }, hash, producer: { ...PRODUCER }
      };
      candidates.push(own); current.symbol = own;
    }
    const children = [];
    for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
    for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index], parent: current, owner: own, depth: depth + 1 });
  }
  // Targeted validation of known editor-grammar tolerances, not a second parser
  // or a claim to validate every CPython context-sensitive constraint.
  for (const node of all) {
    let invalid = null;
    if (['String', 'FormatString'].includes(node.name)) {
      const value = text(node), at = value.search(/['"]/), quote = value[at];
      const delimiter = value.slice(at, at + 3) === quote?.repeat(3) ? quote.repeat(3) : quote;
      const beforeEnd = value.length - (delimiter?.length ?? 0);
      let slashes = 0;
      for (let index = beforeEnd - 1; index >= 0 && value[index] === '\\'; index--) slashes++;
      if (at < 0 || value.length < at + delimiter.length * 2 || !value.endsWith(delimiter) || slashes % 2) invalid = 'unterminated string token';
    }
    if (node.name === 'PrintStatement') invalid = 'Python 2 print statement';
    if (node.name === 'Number' && /^0[0-9_]+$/.test(text(node)) && /[1-9]/.test(text(node))) invalid = 'Python 2 octal number';
    if (node.name === 'CompareOp' && text(node) === '<>') invalid = 'Python 2 comparison operator';
    if (node.name === 'RaiseStatement' && node.children.some(child => child.name === ',')) invalid = 'Python 2 raise statement';
    if (node.name === 'TryStatement') {
      let inExcept = false;
      for (const child of node.children) {
        if (child.name === 'except') inExcept = true;
        if (child.name === 'Body') inExcept = false;
        if (inExcept && child.name === ',') invalid = 'Python 2 except binding';
      }
    }
    if (invalid) { report(`Syntax parse error: unsupported or malformed ${invalid}; analysis from this file is withheld.`, node, 'error'); return result; }
  }
  const counts = new Map();
  for (const symbol of candidates) counts.set(symbol.id, (counts.get(symbol.id) ?? 0) + 1);
  const invalid = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  for (const id of invalid) {
    const symbol = candidates.find(candidate => candidate.id === id);
    report(`Ambiguous declaration ${symbol.qualifiedName}; duplicate syntactic names and their descendants are withheld.`, { from: symbol.range.start }, 'info');
  }
  for (const symbol of candidates) if (invalid.has(symbol.parentId)) invalid.add(symbol.id);
  result.symbolGraph.nodes = candidates.filter(symbol => !invalid.has(symbol.id));
  result.symbols = result.symbolGraph.nodes.filter(symbol => !symbol.parentId).map(({ name, kind, line, column }) => ({ name, kind, line, column }));

  const makeScope = (parent, type) => ({ parent, type, bindings: new Map(), unknown: false });
  const moduleScope = makeScope(null, 'module'), calls = [], poisoned = new Set();
  let dynamicNamespace = false, limited = false, uncertainIdentity = false;
  const identity = (spelling, privateClass, node) => {
    const name = bindingKey(spelling);
    if (!privateClass?.prefix || !name.startsWith('__') || name.endsWith('__') || name.includes('.')) return name;
    // The language reference permits implementation-defined truncation beyond
    // 255 characters. Such a binding can affect explicit names elsewhere too.
    if (1 + privateClass.length + [...name].length > 255) {
      uncertainIdentity = true;
      report('Python private-name transform exceeds 255 characters; implementation-defined identity is unresolved. Affected imports and file call targets are withheld.', node);
      return null;
    }
    return `_${privateClass.prefix}${name}`;
  };
  const bind = (scope, name, symbol = null, node = null, privateClass = null) => {
    const key = identity(name, privateClass, node);
    if (key === null) return;
    if (!scope.bindings.has(key)) scope.bindings.set(key, []);
    const bindings = scope.bindings.get(key);
    if (bindings.some(binding => binding.spelling !== name)) report(`Ambiguous normalized Python binding ${name}; colliding source spellings cannot resolve a call target.`, node, 'info');
    bindings.push({ symbol, node, spelling: name });
  };
  const target = (node, scope, privateClass) => {
    if (!node) return;
    if (node.name === 'VariableName') bind(scope, text(node), null, node, privateClass);
    else if (node.name === 'MemberExpression') {
      // Mutation of a declaration object may change construction/call behavior.
      let base = node;
      while (base?.name === 'MemberExpression') base = base.children[0];
      if (base?.name === 'VariableName') poisoned.add(identity(text(base), privateClass, base));
    } else if (['TupleExpression', 'ArrayExpression', 'ParenthesizedExpression', 'StarredExpression'].includes(node.name)) for (const child of node.children) target(child, scope, privateClass);
  };
  const importStatement = (node, scope, privateClass) => {
    const children = node.children.filter(child => child.name !== 'Comment'), from = children[0].name === 'from';
    const importIndex = children.findIndex(child => child.name === 'import');
    const tail = children.slice(importIndex + 1).filter(child => !['(', ')'].includes(child.name));
    const groups = [[]];
    for (const child of tail) child.name === ',' ? groups.push([]) : groups.at(-1).push(child);
    const names = group => {
      const alias = group.findIndex(child => child.name === 'as');
      const head = alias < 0 ? group : group.slice(0, alias);
      return { name: head.map(text).join(''), ...(alias < 0 ? {} : { as: text(group[alias + 1]) }) };
    };
    const moduleIdentity = module => {
      if (!module) return {};
      const lookupModule = identity(module, privateClass, node);
      return lookupModule === null ? null : lookupModule === module ? {} : { lookupModule };
    };
    if (from) {
      const moduleNodes = children.slice(1, importIndex), spelling = moduleNodes.map(text).join('');
      const level = spelling.match(/^\.+/)?.[0].length ?? 0;
      const imported = groups.filter(group => group.length).map(names);
      const module = spelling.slice(level), effective = moduleIdentity(module);
      if (effective) result.references.push({ kind: 'import', specifier: spelling, evidence: evidence(node), python: { level, module, ...effective, names: imported, form: 'from' } });
      for (const entry of imported) entry.name === '*' ? scope.unknown = true : bind(scope, entry.as ?? entry.name, null, node, privateClass);
    } else for (const group of groups.filter(group => group.length)) {
      const entry = names(group);
      const effective = moduleIdentity(entry.name);
      if (effective) result.references.push({ kind: 'import', specifier: entry.name, evidence: evidence(group[0]), python: { level: 0, module: entry.name, ...effective, names: [entry], form: 'import' } });
      bind(scope, entry.as ?? entry.name.split('.')[0], null, node, privateClass);
    }
  };
  const isDocstring = node => {
    if (!node) return false;
    if (node.name === 'String') return !/^[rub]*b/i.test(text(node));
    if (!['ExpressionStatement', 'ParenthesizedExpression', 'ContinuedString'].includes(node.name)) return false;
    const content = node.children.filter(child => !['(', ')', 'Comment'].includes(child.name));
    return content.length > 0 && content.every(isDocstring);
  };
  const callCallee = node => {
    const parts = node.name === 'Decorator' ? node.children.filter(child => !['At', 'ArgList', 'Comment'].includes(child.name)) : [node.children[0]];
    const callee = parts.length === 1 ? parts[0] : null;
    const direct = callee?.name === 'VariableName' ? text(callee) : null;
    return { direct, name: direct ?? (callee?.name === 'MemberExpression' ? text(callee.children.at(-1)) : node.name === 'Decorator' ? text(parts.at(-1)) : '') };
  };
  function visit(node, scope, owner = null, omitted = false, conditional = false, privateClass = null) {
    const children = node.children;
    if (node.symbol) {
      const decorated = node.parent.name === 'DecoratedStatement';
      const dynamicClass = node.name === 'ClassDefinition' && children.some(child => child.name === 'ArgList' && child.children.some(item => !['(', ')'].includes(item.name)));
      bind(scope, node.symbol.name, decorated || conditional || dynamicClass ? null : node.symbol, node, privateClass);
      // Lexical private identity is independent of namespace lookup: the class
      // binder/header uses the outer class, its body resets to its raw name.
      const bodyClass = node.name === 'ClassDefinition' ? privateContext(node.symbol.name) : privateClass;
      const typeParams = children.find(child => child.name === 'TypeParamList');
      const headerScope = typeParams ? makeScope(scope, 'type-parameters') : scope;
      if (typeParams) for (const parameter of typeParams.children.filter(child => child.name === 'TypeParam')) {
        const name = parameter.children.find(child => child.name === 'VariableName');
        if (name) bind(headerScope, text(name), null, name, bodyClass);
      }
      // Methods capture a compiler-supplied __class__ cell; class bodies do
      // not. Keep it outside the skipped class namespace for nested closures.
      const bodyParent = node.name === 'FunctionDefinition' && scope.type === 'class' ? makeScope(headerScope, 'implicit-class-cell') : headerScope;
      if (bodyParent !== headerScope) bind(bodyParent, '__class__');
      const ownScope = makeScope(bodyParent, node.name === 'ClassDefinition' ? 'class' : 'function');
      if (node.name === 'ClassDefinition') {
        bind(ownScope, '__module__'); bind(ownScope, '__qualname__');
        const body = children.find(child => child.name === 'Body');
        if (isDocstring(body?.children.find(child => ![':', 'Comment'].includes(child.name)))) bind(ownScope, '__doc__');
      }
      const params = children.find(child => child.name === 'ParamList');
      if (params) {
        // Parameter names are direct children; defaults/annotations have their
        // own CST nodes and execute (or defer) outside the function body scope.
        let parameter = true;
        for (const child of params.children) {
          if ([',', '*', '**'].includes(child.name)) parameter = true;
          else if (child.name === 'VariableName' && parameter) { bind(ownScope, text(child), null, child, bodyClass); parameter = false; }
          else visit(child, headerScope, owner, omitted, conditional, privateClass);
        }
      }
      for (const child of children) {
        if (child.name === 'Body') visit(child, ownScope, node.symbol, omitted, false, bodyClass);
        else if (!['ParamList', 'VariableName'].includes(child.name)) {
          const genericHeader = node.name === 'ClassDefinition' && typeParams && child.name === 'ArgList';
          visit(child, headerScope, owner, genericHeader ? 'generic class header' : omitted, conditional, child.name === 'TypeParamList' ? bodyClass : privateClass);
        }
      }
      return;
    }
    if (node.name === 'ImportStatement') { importStatement(node, scope, privateClass); return; }
    if (['TypeDef', 'TypeParamList'].includes(node.name)) {
      for (const child of children) visit(child, scope, owner, 'annotation/type-parameter context', conditional, privateClass);
      return;
    }
    if (node.name === 'TypeDefinition') {
      target(children.find(child => child.name === 'VariableName'), scope, privateClass);
      for (const child of children) visit(child, scope, owner, 'type-alias context', conditional, privateClass);
      return;
    }
    if (node.name === 'ScopeStatement') {
      for (const child of children) if (child.name === 'VariableName') { poisoned.add(identity(text(child), privateClass, child)); bind(scope, text(child), null, child, privateClass); }
      return;
    }
    if (node.name === 'LambdaExpression') {
      const local = makeScope(scope, 'function');
      const params = children.find(child => child.name === 'ParamList');
      for (const child of params?.children ?? []) if (child.name === 'VariableName') bind(local, text(child), null, child, privateClass);
      for (const child of children) visit(child, local, owner, 'lambda/comprehension context', conditional, privateClass);
      return;
    }
    if (/ComprehensionExpression$/.test(node.name)) {
      const local = makeScope(scope, 'comprehension');
      for (let index = 0; index < children.length; index++) {
        if (children[index].name === 'for') for (let end = index + 1; end < children.length && children[end].name !== 'in'; end++) target(children[end], local, privateClass);
      }
      // Comprehension scope/evaluation order is intentionally omitted. Walrus
      // names bind the enclosing non-comprehension scope, including in filters.
      const walruses = [node];
      while (walruses.length) {
        const child = walruses.pop();
        if (child !== node && child.name === 'LambdaExpression') continue;
        if (child.name === 'NamedExpression') target(child.children[0], scope, privateClass);
        walruses.push(...child.children);
      }
      for (const child of children) visit(child, local, owner, 'lambda/comprehension context', conditional, privateClass);
      return;
    }
    if (node.name === 'AssignStatement') {
      const ops = children.map((child, index) => child.name === 'AssignOp' ? index : -1).filter(index => index >= 0);
      if (!ops.length) target(children[0], scope, privateClass);
      let start = 0;
      for (const index of ops) {
        for (const child of children.slice(start, index)) if (child.name !== 'TypeDef') target(child, scope, privateClass);
        start = index + 1;
      }
    }
    if (['UpdateStatement', 'NamedExpression'].includes(node.name)) target(children[0], scope, privateClass);
    if (node.name === 'DeleteStatement') for (const child of children.slice(1)) target(child, scope, privateClass);
    if (node.name === 'ForStatement') for (const child of children.slice(children.findIndex(child => child.name === 'for') + 1, children.findIndex(child => child.name === 'in'))) target(child, scope, privateClass);
    if (['WithStatement', 'TryStatement', 'AsPattern'].includes(node.name)) for (let index = 0; index < children.length; index++) if (children[index].name === 'as') target(children[index + 1], scope, privateClass);
    if (node.name === 'CapturePattern') target(children[0], scope, privateClass);
    if (node.name === 'CallExpression' || node.name === 'Decorator' && children.some(child => child.name === 'ArgList')) {
      if (calls.length >= PYTHON_LIMITS.callSites) limited = true;
      else {
        const { direct } = callCallee(node);
        calls.push({ node, scope, owner, omitted, key: direct ? identity(direct, privateClass, node) : null });
      }
      const { name } = callCallee(node);
      if (['exec', 'eval', 'globals', 'locals', 'vars', 'setattr', 'delattr', '__import__'].includes(bindingKey(name))) dynamicNamespace = true;
    }
    const branch = conditional || ['IfStatement', 'ForStatement', 'WhileStatement', 'TryStatement', 'WithStatement', 'MatchStatement'].includes(node.name);
    for (const child of children) visit(child, scope, owner, omitted, branch, privateClass);
  }
  visit(root.children[0], moduleScope);
  // The source occurrence has already been normalized/mangled exactly once.
  const lookup = (scope, name) => {
    if (name === null || poisoned.has(name) || dynamicNamespace || uncertainIdentity) return null;
    let skipClasses = false;
    for (let current = scope; current; current = current.parent) {
      if (!(skipClasses && current.type === 'class')) {
        if (current.unknown) return null;
        if (current.bindings.has(name)) {
          const bindings = current.bindings.get(name);
          return bindings.length === 1 ? bindings[0] : null;
        }
      }
      if (['function', 'class', 'comprehension'].includes(current.type)) skipClasses = true;
    }
    return null;
  };
  const edges = new Map();
  let unresolved = 0;
  for (const record of calls) {
    const { node, scope, owner, omitted, key: lookupKey } = record;
    const binding = !omitted ? lookup(scope, lookupKey) : null;
    const candidate = binding?.symbol;
    // Module/class bodies execute sequentially. Deferred function bodies use
    // lexical candidates; the edge is source evidence, never execution proof.
    const body = binding?.node?.children.find(child => child.name === 'Body');
    const inOwnHeader = binding?.node && node.from >= binding.node.from && node.from < (body?.from ?? binding.node.to);
    const beforeDeclaration = binding?.node && scope.type !== 'function' && binding.node.to > node.from;
    if (!candidate || inOwnHeader || beforeDeclaration || invalid.has(candidate.id) || owner && invalid.has(owner.id)) {
      unresolved++;
      report(`Unresolved Python call: ${omitted || (dynamicNamespace ? 'dynamic namespace operations in file' : 'imported, member/dynamic, ambiguous, shadowed or mutated binding')}; no call edge is guessed.`, node, 'info');
      continue;
    }
    const from = owner?.id ?? `file:${relative}`, kind = candidate.kind === 'class' ? 'construct' : 'call';
    const key = `${from}\0${candidate.id}\0${kind}`;
    if (!edges.has(key)) {
      if (edges.size >= PYTHON_LIMITS.edges) { limited = true; continue; }
      edges.set(key, { id: `call:${digest(key).slice(0, 24)}`, from, to: candidate.id, kind, label: kind === 'construct' ? 'constructs' : 'calls', layers: ['project', ...(isTestSource(relative) ? ['testing'] : [])], provenance: 'static-call', execution: 'not-observed', evidence: [] });
    }
    edges.get(key).evidence.push({ ...evidence(node), containment: 'direct-body' });
  }
  result.symbolGraph.edges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (unresolved) report(`${unresolved} Python call sites remain unresolved; no call edges are guessed.`, null, 'info');
  if (limited) report('Symbol call-site/edge analysis budget exceeded; calls are partial.', null);
  return result;
}
