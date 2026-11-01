import { parser } from '@lezer/python';

// Input has already crossed the index's checked text boundary. This adapter only
// inspects syntax; it never reads configuration, resolves bindings or runs Python.
export const PYTHON_LIMITS = Object.freeze({ bytes: 64 * 1024, symbols: 2000, astNodes: 100000, depth: 256 });
const PRODUCER = Object.freeze({ name: '@lezer/python', version: '1.1.19', mode: 'syntax-only' });
export const isPythonSource = relative => relative.endsWith('.py');

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
  const diagnostics = [{ path: relative, severity: 'warning', message: 'Syntax-only Python pilot: always partial. Named declarations use syntactic source spelling, not runtime binding resolution. Imports, calls, types, security and framework behavior are not analyzed; this editor grammar accepts some Python 2 constructs and can tolerate malformed tokens and does not validate CPython syntax or semantics. Arbitrary decorator expressions (PEP 614) and type parameter defaults (PEP 696) are unsupported.' }];
  const result = { references: [], symbols: [], security: [], diagnostics, symbolGraph: { nodes: [], edges: [], diagnostics: [] }, producer: { ...PRODUCER } };
  if (Buffer.byteLength(source, 'utf8') > PYTHON_LIMITS.bytes) {
    diagnostics.push({ path: relative, severity: 'warning', message: `Syntax analysis limit: ${PYTHON_LIMITS.bytes} bytes per file; symbols are withheld and text remains available.` });
    return result;
  }
  const locate = sourceLocations(source);
  const report = (message, node, severity = 'warning') => diagnostics.push({ path: relative, ...(node ? locate(node.from) : {}), severity, message });
  let tree;
  try {
    tree = parser.parse(source);
  } catch (error) {
    report(`Syntax parse error: ${error.message}; symbols from this file are withheld.`, null, 'error');
    return result;
  }
  const candidates = [];
  const pending = [{ node: tree.topNode, owner: null, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { node, owner, depth } = pending.pop();
    if (++visited > PYTHON_LIMITS.astNodes || depth > PYTHON_LIMITS.depth) {
      report('Syntax traversal limit reached; symbols from this file are withheld.', node);
      return result;
    }
    // Lezer recovers for editor use. Even an error after a valid declaration
    // invalidates all candidates: a recovered tree is not accepted source syntax.
    if (node.type.isError) {
      report('Syntax parse error: parser recovery/error node; symbols from this file are withheld.', node, 'error');
      return result;
    }
    let own = owner;
    if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') {
      const identifier = node.getChild('VariableName');
      if (!identifier) {
        report('Syntax declaration has no unambiguous source name; symbols from this file are withheld.', node, 'error');
        return result;
      }
      if (candidates.length >= PYTHON_LIMITS.symbols) {
        report('Syntax symbol limit reached; symbols from this file are withheld.', node);
        return result;
      }
      const name = source.slice(identifier.from, identifier.to);
      const qualifiedName = owner ? `${owner.qualifiedName}.${name}` : name;
      // Lezer may stop after the CR of a CRLF terminator. Keep the raw
      // exclusive range on a complete newline boundary without changing text.
      const rangeEnd = source[node.to - 1] === '\r' && source[node.to] === '\n' ? node.to + 1 : node.to;
      const start = locate(node.from), end = locate(rangeEnd);
      own = {
        id: `symbol:${relative}#${qualifiedName}`, path: relative, name, label: name, qualifiedName,
        kind: node.name === 'ClassDefinition' ? 'class' : owner?.kind === 'class' ? 'method' : 'function',
        languageKind: node.name, parentId: owner?.id ?? null,
        line: start.line, column: start.column, endLine: end.line, endColumn: end.column,
        range: { start: node.from, end: rangeEnd, unit: 'utf16-code-unit', endExclusive: true },
        hash, producer: { ...PRODUCER }
      };
      candidates.push(own);
    }
    // DecoratedStatement is a wrapper: walking to the actual declaration keeps
    // decorators out of its range, and grants them no inferred behavior.
    const children = [];
    for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
    for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index], owner: own, depth: depth + 1 });
  }
  const counts = new Map();
  for (const symbol of candidates) counts.set(symbol.id, (counts.get(symbol.id) ?? 0) + 1);
  const invalid = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  for (const id of invalid) {
    const symbol = candidates.find(candidate => candidate.id === id);
    report(`Ambiguous declaration ${symbol.qualifiedName}; duplicate syntactic names and their descendants are withheld.`, { from: symbol.range.start });
  }
  // Traversal is parent-before-child, so ambiguity propagates through every depth.
  for (const symbol of candidates) if (invalid.has(symbol.parentId)) invalid.add(symbol.id);
  result.symbolGraph.nodes = candidates.filter(symbol => !invalid.has(symbol.id));
  result.symbols = result.symbolGraph.nodes.filter(symbol => !symbol.parentId).map(({ name, kind, line, column }) => ({ name, kind, line, column }));
  return result;
}
