import { createHash } from 'node:crypto';

// Internal observations over already checked bytes/ASTs. No I/O or target execution.
const observations = new WeakMap();
const diagnosticOrigins = new WeakMap();
const ledgers = new WeakMap();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const scopedDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function markScopedDiagnostic(item, category) {
  diagnosticOrigins.set(item, { digest: scopedDigest(item), category });
  return item;
}
export function pushScopedDiagnostics(array, category, ...items) {
  for (const item of items) array.push(markScopedDiagnostic(item, category));
}
export function cloneScopedDiagnostics(items) {
  return items.map(item => {
    const clone = structuredClone(item), observation = diagnosticOrigins.get(item);
    if (observation?.digest === scopedDigest(item)) markScopedDiagnostic(clone, observation.category);
    return clone;
  });
}
export function markAnalysisDiagnostics(analysis) {
  // Called only at the pinned adapter dispatch, before the result reaches callers.
  for (const item of [...analysis.diagnostics, ...(analysis.symbolGraph?.diagnostics ?? [])]) markScopedDiagnostic(item, 'analysis-limitation');
}
export const recordAnalysisObservation = (analysis, observation) => observations.set(analysis, observation);
export const analysisObservation = analysis => observations.get(analysis);
export function attachScopedCoverage(graph, coverage) { ledgers.set(graph, coverage); return graph; }
export const COVERAGE_LIMITS = Object.freeze({ origins: 10000, referenceObservations: 100000, evidenceBytes: 16777216 });
export function getScopedCoverage(graph) {
  const coverage = ledgers.get(graph);
  if (!coverage) return null;
  let bytes = Buffer.byteLength(JSON.stringify(coverage), 'utf8');
  const diagnostics = [];
  for (let index = 0; index < graph.diagnostics.length; index++) {
    const item = graph.diagnostics[index], digest = scopedDigest(item), original = diagnosticOrigins.get(item);
    const observation = { index, digest, category: original?.digest === digest ? original.category : 'unknown' };
    bytes += Buffer.byteLength(JSON.stringify(observation), 'utf8') + 1;
    if (bytes + 32 > COVERAGE_LIMITS.evidenceBytes) return structuredClone({ ...coverage, diagnostics, budget: { status: 'exceeded', reason: 'evidence-bytes' } });
    diagnostics.push(observation);
  }
  return structuredClone({ ...coverage, diagnostics });
}

export const TYPED_SCOPED_PRODUCER = Object.freeze({ parser: '@babel/parser@7.29.12', collector: 'typed-reference-syntax-v1', resolver: 'bundler-local-v1' });
// Explicit neutral forms for the pinned parser. A future/unrecognized node is
// uncertainty, never evidence that no additional reference form occurred.
const neutralTypedNodes = new Set(`Program Import Identifier PrivateName StringLiteral NumericLiteral BooleanLiteral NullLiteral BigIntLiteral DecimalLiteral RegExpLiteral Directive DirectiveLiteral InterpreterDirective EmptyStatement DebuggerStatement ExpressionStatement BlockStatement ReturnStatement ThrowStatement BreakStatement ContinueStatement LabeledStatement IfStatement SwitchStatement SwitchCase TryStatement CatchClause WithStatement WhileStatement DoWhileStatement ForStatement ForInStatement ForOfStatement VariableDeclaration VariableDeclarator FunctionDeclaration FunctionExpression ArrowFunctionExpression ClassDeclaration ClassExpression ClassBody ClassMethod ClassPrivateMethod ClassProperty ClassPrivateProperty ClassAccessorProperty StaticBlock ObjectExpression ObjectProperty ObjectMethod ArrayExpression SpreadElement RestElement AssignmentPattern ObjectPattern ArrayPattern ThisExpression Super MetaProperty MemberExpression OptionalMemberExpression CallExpression OptionalCallExpression NewExpression SequenceExpression UnaryExpression UpdateExpression BinaryExpression LogicalExpression AssignmentExpression ConditionalExpression AwaitExpression YieldExpression TemplateLiteral TemplateElement TaggedTemplateExpression ParenthesizedExpression ImportDeclaration ImportSpecifier ImportDefaultSpecifier ImportNamespaceSpecifier ExportNamedDeclaration ExportDefaultDeclaration ExportAllDeclaration ExportSpecifier ExportNamespaceSpecifier ImportAttribute JSXElement JSXFragment JSXOpeningElement JSXClosingElement JSXOpeningFragment JSXClosingFragment JSXIdentifier JSXMemberExpression JSXNamespacedName JSXAttribute JSXSpreadAttribute JSXExpressionContainer JSXSpreadChild JSXText JSXEmptyExpression TSParameterProperty TSDeclareFunction TSDeclareMethod TSQualifiedName TSCallSignatureDeclaration TSConstructSignatureDeclaration TSPropertySignature TSMethodSignature TSIndexSignature TSAnyKeyword TSBooleanKeyword TSBigIntKeyword TSIntrinsicKeyword TSNeverKeyword TSNullKeyword TSNumberKeyword TSObjectKeyword TSStringKeyword TSSymbolKeyword TSUndefinedKeyword TSUnknownKeyword TSVoidKeyword TSThisType TSFunctionType TSConstructorType TSTypeReference TSTypePredicate TSTypeQuery TSTypeLiteral TSArrayType TSTupleType TSOptionalType TSRestType TSNamedTupleMember TSUnionType TSIntersectionType TSConditionalType TSInferType TSParenthesizedType TSTypeOperator TSIndexedAccessType TSMappedType TSLiteralType TSExpressionWithTypeArguments TSInterfaceDeclaration TSInterfaceBody TSTypeAliasDeclaration TSInstantiationExpression TSAsExpression TSSatisfiesExpression TSTypeAssertion TSEnumDeclaration TSEnumMember TSModuleDeclaration TSModuleBlock TSNonNullExpression TSTypeAnnotation TSTypeParameterInstantiation TSTypeParameterDeclaration TSTypeParameter`.split(/\s+/));
const rangeOf = node => Number.isSafeInteger(node.start) && Number.isSafeInteger(node.end) ? { range: { start: node.start, end: node.end, unit: 'utf16-code-unit', endExclusive: true } } : {};
export function observeTypedProgram(program, referenceSyntax, limits) {
  const unsupported = structuredClone(referenceSyntax.unsupported);
  const recorded = new Set(unsupported.map(item => JSON.stringify([item.reason, item.range?.start, item.range?.end])));
  const result = { status: 'unknown', producer: { ...TYPED_SCOPED_PRODUCER }, parse: 'complete', referenceTraversal: 'withheld', unsupported };
  if (referenceSyntax.extraction !== 'collected') { unsupported.push({ reason: 'reference-traversal-withheld' }); return result; }
  const pending = [{ node: program, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (++visited > limits.astNodes || depth > limits.depth || unsupported.length > limits.occurrences) {
      result.unsupported = [{ reason: 'model-observer-limit' }]; return result;
    }
    let reason = null;
    if (node.type === 'ImportExpression') reason = 'dynamic-import';
    else if (node.type === 'TSImportEqualsDeclaration' || node.type === 'TSExternalModuleReference') reason = 'import-equals';
    else if (node.type === 'TSImportType') reason = 'import-type';
    else if (node.type === 'Identifier' && ['require', 'module', 'exports'].includes(node.name)) reason = 'commonjs-reference';
    else if (!neutralTypedNodes.has(node.type)) reason = 'unrecognized-syntax';
    const key = JSON.stringify([reason, node.start, node.end]);
    if (reason && !recorded.has(key)) { recorded.add(key); unsupported.push({ reason, syntaxKind: node.type, ...rangeOf(node) }); }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') pending.push({ node: child, depth: depth + 1 }); }
      else if (value && typeof value.type === 'string') pending.push({ node: value, depth: depth + 1 });
    }
  }
  result.referenceTraversal = 'complete';
  result.status = unsupported.length ? 'unknown' : 'complete';
  return result;
}

export const JSON_CONTROL_KEYS = Object.freeze(['paths', 'baseUrl', 'imports', 'exports', 'workspaces', 'moduleResolution', 'compilerOptions', 'extends', 'references', 'main', 'module', 'browser', 'type', 'rootDirs', 'include', 'exclude', 'files', 'resolutions', 'alias']);
const controlKeys = new Set(JSON_CONTROL_KEYS);
// Strict JSON grammar, duplicate decoded keys and bounded traversal are checked
// against actual source text. A suffix or successful legacy JSON.parse is no waiver.
export function observeStrictJSON(source) {
  let at = 0, values = 0, control = false;
  const fail = reason => { throw Object.assign(new Error(reason), { reason }); };
  const space = () => { while (at < source.length && /[\t\n\r ]/.test(source[at])) at++; };
  const string = () => {
    if (source[at] !== '"') fail('json-syntax');
    const start = at++;
    while (at < source.length) {
      const char = source[at++];
      if (char === '"') { try { return JSON.parse(source.slice(start, at)); } catch { fail('json-syntax'); } }
      if (char === '\\') at++;
      else if (char.charCodeAt(0) < 32) fail('json-syntax');
    }
    fail('json-syntax');
  };
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const value = depth => {
    if (depth > 256 || ++values > 100000) fail('json-classifier-limit');
    space();
    const char = source[at];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      const object = char === '{', close = object ? '}' : ']', keys = new Set();
      at++; space(); if (source[at] === close) { at++; return; }
      for (;;) {
        if (object) {
          const key = string();
          if (keys.has(key)) fail('json-duplicate-key');
          keys.add(key); if (controlKeys.has(key)) control = true;
          space(); if (source[at++] !== ':') fail('json-syntax');
        }
        value(depth + 1); space();
        if (source[at] === close) { at++; return; }
        if (source[at++] !== ',') fail('json-syntax');
        space();
      }
    }
    for (const literal of ['true', 'false', 'null']) if (source.startsWith(literal, at)) { at += literal.length; return; }
    number.lastIndex = at;
    const match = number.exec(source);
    if (!match) fail('json-syntax');
    at = number.lastIndex;
  };
  try {
    value(0); space(); if (at !== source.length) fail('json-syntax');
    return { status: 'complete', producer: 'strict-json-v1', parse: 'complete', referenceTraversal: 'complete', jsonRole: control ? 'unknown-control' : 'none', unsupported: [] };
  } catch (error) { return { status: 'unknown', producer: 'strict-json-v1', parse: 'withheld', referenceTraversal: 'withheld', jsonRole: 'unknown-control', unsupported: [{ reason: error.reason ?? 'json-classification-failure' }] }; }
}
