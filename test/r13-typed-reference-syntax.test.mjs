import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as analyzer from '../typed-analysis.mjs';

const producer = { name: '@babel/parser', version: '7.29.12', mode: 'syntax-only' };
const resolution = { status: 'unsupported', reason: 'typed-resolution-not-enabled' };
const hashOf = source => createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
const analyze = (source, relative = 'fixture.ts') => analyzer.analyzeTypedSource(relative, source, hashOf(source));
const range = (start, end) => ({ start, end, unit: 'utf16-code-unit', endExclusive: true });
const span = (source, text, from = 0) => {
  const start = source.indexOf(text, from);
  assert.notEqual(start, -1, `Missing expected source slice ${text}`);
  return range(start, start + text.length);
};
// This oracle uses raw source strings, not parser locations or analyzer facts.
const position = (source, offset) => {
  const prefix = source.slice(0, offset);
  return { line: prefix.split('\n').length, column: offset - prefix.lastIndexOf('\n') };
};
const binding = (source, text, syntaxKind, local = null, imported = null, exported = null, typeOnly = false) =>
  ({ syntaxKind, local, imported, exported, typeOnly, range: span(source, text) });
const expectedFact = (source, declaration, literal, kind, syntaxKind, bindings = [], typeOnly = false, specifier = literal.slice(1, -1), relative = 'fixture.ts') => {
  const declarationRange = span(source, declaration);
  const sourceRange = span(source, literal, declarationRange.start);
  const start = position(source, sourceRange.start);
  const end = position(source, sourceRange.end);
  return { kind, specifier, typed: { syntaxKind, typeOnly, bindings }, evidence: {
    path: relative, hash: hashOf(source), producer, line: start.line, column: start.column,
    endLine: end.line, endColumn: end.column, range: sourceRange, declarationRange
  } };
};
const envelope = result => {
  assert(result.referenceSyntax, 'The typed reference envelope is required, including empty/withheld results');
  assert.equal(result.referenceSyntax.version, 'typed-reference-syntax-v1');
  assert.deepEqual(result.referenceSyntax.resolution, resolution);
  assert.deepEqual(result.references, result.referenceSyntax.facts);
  assert.deepEqual(result.security, []);
  assert.deepEqual(result.symbolGraph.edges, []);
  return result.referenceSyntax;
};
const withheld = result => {
  const value = envelope(result);
  assert.equal(value.extraction, 'withheld');
  assert.deepEqual(value.facts, []);
  assert.deepEqual(value.unsupported, []);
};

for (const extension of ['ts', 'tsx', 'jsx']) test(`T01 ${extension}: exact static import and reexport forms`, () => {
  const relative = `fixture.${extension}`;
  const lines = [
    'import Default from "./default";',
    'import { item as renamed, plain } from "./named";',
    'import * as namespace from "./namespace";',
    'import "./side-effect";',
    'export { upstream as publicName } from "./reexport";',
    'export * from "./star";',
    'export * as api from "./namespace-export";'
  ];
  const source = lines.join('\n');
  const facts = [
    expectedFact(source, lines[0], '"./default"', 'import', 'ImportDeclaration', [binding(source, 'Default', 'ImportDefaultSpecifier', 'Default')]),
    expectedFact(source, lines[1], '"./named"', 'import', 'ImportDeclaration', [binding(source, 'item as renamed', 'ImportSpecifier', 'renamed', 'item'), binding(source, 'plain', 'ImportSpecifier', 'plain', 'plain')]),
    expectedFact(source, lines[2], '"./namespace"', 'import', 'ImportDeclaration', [binding(source, '* as namespace', 'ImportNamespaceSpecifier', 'namespace')]),
    expectedFact(source, lines[3], '"./side-effect"', 'import', 'ImportDeclaration'),
    expectedFact(source, lines[4], '"./reexport"', 'reexport', 'ExportNamedDeclaration', [binding(source, 'upstream as publicName', 'ExportSpecifier', 'upstream', null, 'publicName')]),
    expectedFact(source, lines[5], '"./star"', 'reexport', 'ExportAllDeclaration'),
    expectedFact(source, lines[6], '"./namespace-export"', 'reexport', 'ExportNamedDeclaration', [binding(source, '* as api', 'ExportNamespaceSpecifier', null, null, 'api')])
  ];
  for (const fact of facts) fact.evidence.path = relative;
  const result = analyze(source, relative);
  assert.deepEqual(envelope(result), { version: 'typed-reference-syntax-v1', extraction: 'collected', facts, unsupported: [], resolution });
  assert.deepEqual(result.producer, producer);
});

test('T02 whole and binding type-only syntax does not infer absent roles', () => {
  const lines = [
    'import type DefaultType from "a";',
    'import type * as TypeNS from "b";',
    'import { type A, type B as C } from "c";',
    'import { type D, value as actual } from "d";',
    'import {} from "e";',
    'import "f";',
    'export type { TypeA as PublicA } from "g";',
    'export { type TypeB, type TypeC as PublicC } from "h";',
    'export { type TypeD, value as publicValue } from "i";',
    'export {} from "j";',
    'export type {} from "k";',
    'export type * from "l";',
    'const local = 1; export { local };'
  ];
  const source = lines.join('\n');
  const value = envelope(analyze(source));
  assert.equal(value.extraction, 'collected');
  assert.deepEqual(value.facts.map(f => f.typed.typeOnly), [true, true, true, false, false, false, true, true, false, false, true, true]);
  assert.deepEqual(value.facts.map(f => f.typed.bindings.map(b => b.typeOnly)), [[true], [true], [true, true], [true, false], [], [], [true], [true, true], [true, false], [], [], []]);
  assert.deepEqual(value.facts[0].typed.bindings, [binding(source, 'DefaultType', 'ImportDefaultSpecifier', 'DefaultType', null, null, true)]);
  assert.deepEqual(value.facts[1].typed.bindings, [binding(source, '* as TypeNS', 'ImportNamespaceSpecifier', 'TypeNS', null, null, true)]);
  assert.deepEqual(value.facts[2].typed.bindings, [binding(source, 'type A', 'ImportSpecifier', 'A', 'A', null, true), binding(source, 'type B as C', 'ImportSpecifier', 'C', 'B', null, true)]);
  assert.deepEqual(value.facts[6].typed.bindings, [binding(source, 'TypeA as PublicA', 'ExportSpecifier', 'TypeA', null, 'PublicA', true)]);
  assert.deepEqual(value.unsupported, []);
});

for (const newline of ['\n', '\r\n']) test(`T03 raw UTF-16 provenance, multiline and decoded names with ${JSON.stringify(newline)}`, () => {
  const declaration = ['import {', '  "a\\u002db" as café,', '  value as \\u0061lias', '} from "./\\u006dodule";'].join(newline);
  const reexport = 'export { "raw-name" as "public\\u002dname" } from "other";';
  const source = `/*🧠*/ ${declaration}${newline}${reexport}`;
  const result = analyze(source);
  const facts = envelope(result).facts;
  assert.deepEqual(facts, [
    expectedFact(source, declaration, '"./\\u006dodule"', 'import', 'ImportDeclaration', [binding(source, '"a\\u002db" as café', 'ImportSpecifier', 'café', 'a-b'), binding(source, 'value as \\u0061lias', 'ImportSpecifier', 'alias', 'value')], false, './module'),
    expectedFact(source, reexport, '"other"', 'reexport', 'ExportNamedDeclaration', [binding(source, '"raw-name" as "public\\u002dname"', 'ExportSpecifier', 'raw-name', null, 'public-name')])
  ]);
  for (let i = 0; i < facts.length; i++) {
    const evidence = facts[i].evidence;
    assert.equal(source.slice(evidence.declarationRange.start, evidence.declarationRange.end), [declaration, reexport][i]);
    assert.equal(evidence.hash, hashOf(source));
    for (const item of facts[i].typed.bindings) assert(source.slice(item.range.start, item.range.end).length > 0);
  }
});

for (const invalid of [
  'import "kept"; function broken( {',
  'import "kept"; import x = ;',
  'import "kept"; @decorator class Unsupported {}',
  'import "kept"; import data from "data" assert { type: "json" };'
]) test(`T04 parse failure withholds all facts: ${invalid.slice(-40)}`, () => {
  const result = analyze(invalid);
  withheld(result);
  assert.deepEqual(result.symbolGraph.nodes, []);
  assert(result.diagnostics.some(d => /parse error/i.test(d.message)));
});

for (const declaration of [
  'import "x" with { type: "json" };',
  'import "x" with {};',
  'export * from "x" with {};',
  'export { x } from "x" with {};',
  'import "x" /* gap */ with /* braces */ {};',
  'import "x"\n// gap\nwith\n{};'
]) test(`T04 accepted attributes are unsupported, including empty arrays: ${declaration}`, () => {
  const source = `import "safe";\n${declaration}`;
  const value = envelope(analyze(source));
  assert.equal(value.extraction, 'collected');
  assert.deepEqual(value.facts.map(f => f.specifier), ['safe']);
  assert.deepEqual(value.unsupported, [{ reason: 'import-attributes', syntaxKind: declaration.startsWith('import') ? 'ImportDeclaration' : declaration.startsWith('export *') ? 'ExportAllDeclaration' : 'ExportNamedDeclaration', range: span(source, declaration) }]);
});

test('T05 excluded forms have exact target-free evidence, including shadowed and optional require', () => {
  const cases = [
    ['import("dynamic")', 'dynamic-import', 'CallExpression'],
    ['import(target)', 'dynamic-import', 'CallExpression'],
    ['import old = require("old");', 'import-equals', 'TSImportEqualsDeclaration'],
    ['import("type").Value', 'import-type', 'TSImportType'],
    ['require("cjs")', 'commonjs-require', 'CallExpression'],
    ['require?.("optional")', 'commonjs-require', 'OptionalCallExpression']
  ];
  const source = ['import "safe";', 'function f(require: unknown) {', 'import("dynamic"); import(target); require("cjs"); require?.("optional");', '}', 'import old = require("old");', 'type T = import("type").Value;', 'declare module "ambient" { import { A } from "nested"; export { A } from "nested-export"; }', 'namespace N { export * from "namespace-export"; }'].join('\n');
  const value = envelope(analyze(source));
  assert.deepEqual(value.facts.map(f => f.specifier), ['safe']);
  const expected = cases.map(([text, reason, syntaxKind]) => ({ reason, syntaxKind, range: span(source, text) }));
  for (const [text, syntaxKind] of [['import { A } from "nested";', 'ImportDeclaration'], ['export { A } from "nested-export";', 'ExportNamedDeclaration'], ['export * from "namespace-export";', 'ExportAllDeclaration']]) expected.push({ reason: 'non-top-level-reference', syntaxKind, range: span(source, text) });
  expected.sort((a, b) => a.range.start - b.range.start);
  assert.deepEqual(value.unsupported, expected);
});

test('T06 comments/strings and attribute decoys are ignored; omitted symbol bodies are still walked', () => {
  const source = [
    '// import "comment"; import("dynamic-comment"); require("comment");',
    'const text = `import "string" with {}; require("string")`;',
    'import "real" /* with {} */;',
    'export * from "other"; // with {}',
    'class Kept { field = () => import("field"); static { require("static"); } }',
    'const obj = { method() { import("method"); } };',
    'setTimeout(() => { require("anonymous"); });',
    'obj.require("member");'
  ].join('\n');
  const result = analyze(source);
  const value = envelope(result);
  assert.deepEqual(value.facts.map(f => f.specifier), ['real', 'other']);
  assert.deepEqual(value.unsupported.map(item => source.slice(item.range.start, item.range.end)), ['import("field")', 'require("static")', 'import("method")', 'require("anonymous")']);
  assert.deepEqual(result.symbolGraph.nodes.map(s => s.qualifiedName), ['Kept']);
});

test('T07 existing byte limit is exact in bytes, including multibyte text', () => {
  const prefix = 'import "kept"; function retained(){} //';
  const exact = prefix + '🧠'.repeat(100) + 'x'.repeat(65536 - Buffer.byteLength(prefix) - 400);
  assert.equal(Buffer.byteLength(exact), 65536);
  assert.equal(envelope(analyze(exact)).extraction, 'collected');
  const result = analyze(exact + 'x');
  withheld(result);
  assert.deepEqual(result.symbolGraph.nodes, []);
  assert(result.diagnostics.some(d => /65536.*bytes/.test(d.message)));
  assert.deepEqual(analyzer.TYPED_LIMITS, { bytes: 65536, symbols: 2000, astNodes: 100000, depth: 256 });
});

const referenceLimit = (result, reason) => {
  withheld(result);
  assert(result.diagnostics.some(d => d.code === 'TYPED_REFERENCE_LIMIT' && d.reason === reason && d.severity === 'warning'), reason);
};

test('T07 actual source counts repeated supported and unsupported occurrences without deduplication', () => {
  const prefix = 'function retained(){}\n';
  for (const occurrence of ['import "same";\n', 'require("same");\n']) {
    const exact = analyze(prefix + occurrence.repeat(2000));
    const value = envelope(exact);
    assert.equal(value.extraction, 'collected');
    assert.equal(value.facts.length + value.unsupported.length, 2000);
    const over = analyze(prefix + occurrence.repeat(2001));
    referenceLimit(over, 'occurrence-limit');
    assert.equal(over.symbolGraph.nodes[0].id, 'symbol:fixture.ts#retained');
  }
  const mixed = analyze(prefix + 'import "same"; require("same");\n'.repeat(1000) + 'import "last";');
  referenceLimit(mixed, 'occurrence-limit');
});

test('T07 actual parsed source accepts 8000 bindings and withholds all at binding 8001', () => {
  const source = count => `function retained(){}\nimport {${Array.from({ length: count }, (_, i) => `b${i}`).join(',')}} from "same";`;
  const exact = source(8000);
  assert(Buffer.byteLength(exact) < 65536);
  const value = envelope(analyze(exact));
  assert.equal(value.extraction, 'collected');
  assert.equal(value.facts[0].typed.bindings.length, 8000);
  const over = analyze(source(8001));
  referenceLimit(over, 'binding-limit');
  assert.equal(over.symbolGraph.nodes[0].qualifiedName, 'retained');
});

// Artificial ASTs verify the internal walker boundary, not parser acceptance.
const collectArtificial = program => {
  assert.equal(typeof analyzer.collectTypedReferenceSyntax, 'function');
  const value = analyzer.collectTypedReferenceSyntax('fixture.ts', '', hashOf(''), program);
  return { ...value, references: value.referenceSyntax.facts, security: [], symbolGraph: { edges: [] } };
};
const artificialChain = depth => {
  let node = { type: 'SyntheticLeaf' };
  for (let i = 0; i < depth; i++) node = { type: i === depth - 1 ? 'Program' : 'SyntheticWrapper', body: [node] };
  return node;
};

test('T07 internal reference walker accepts exact AST-node/depth bounds and rejects count+1', () => {
  assert.deepEqual(analyzer.TYPED_REFERENCE_LIMITS, { astNodes: 100000, depth: 256, occurrences: 2000, bindings: 8000 });
  const exactNodes = { type: 'Program', body: Array.from({ length: 99999 }, () => ({ type: 'SyntheticLeaf' })) };
  assert.equal(envelope(collectArtificial(exactNodes)).extraction, 'collected');
  exactNodes.body.push({ type: 'SyntheticLeaf' });
  referenceLimit(collectArtificial(exactNodes), 'ast-node-limit');
  assert.equal(envelope(collectArtificial(artificialChain(256))).extraction, 'collected');
  referenceLimit(collectArtificial(artificialChain(257)), 'depth-limit');
});

test('T08 declaration symbol failures preserve references; reference depth failure preserves declarations', () => {
  const functions = count => 'import "retained";\n' + Array.from({ length: count }, (_, i) => `function f${i}(){}`).join('\n');
  const exact = analyze(functions(2000));
  assert.equal(exact.symbolGraph.nodes.length, 2000);
  assert.equal(envelope(exact).facts.length, 1);
  const over = analyze(functions(2001));
  assert.deepEqual(over.symbolGraph.nodes, []);
  assert.equal(envelope(over).extraction, 'collected');
  assert.equal(over.references.length, 1);
  assert(over.diagnostics.some(d => /symbol limit reached/.test(d.message)));
  const source = 'import "withheld"; function retained(){}\nclass C { field = () => 0' + '+0'.repeat(300) + '; }';
  const deep = analyze(source);
  referenceLimit(deep, 'depth-limit');
  assert.deepEqual(deep.symbolGraph.nodes.map(s => s.qualifiedName), ['retained', 'C']);
});

test('T08 deterministic source order and unchanged symbol identities/ambiguity', () => {
  const declarations = 'function retained(){ function child(){} }\nfunction overloaded(a: string): void;\nfunction overloaded(a: number): void;\nfunction overloaded(a: unknown){}';
  const baseline = analyze(declarations);
  const source = 'import "one";\n' + declarations + '\nexport * from "two";\nrequire("three");';
  const first = analyze(source);
  assert.deepEqual(first, analyze(source));
  assert.deepEqual(first.symbolGraph.nodes.map(s => [s.id, s.qualifiedName, s.parentId, s.kind, s.languageKind]), baseline.symbolGraph.nodes.map(s => [s.id, s.qualifiedName, s.parentId, s.kind, s.languageKind]));
  assert.deepEqual(first.symbolGraph.nodes.map(s => s.id), ['symbol:fixture.ts#retained', 'symbol:fixture.ts#retained.child']);
  assert(first.diagnostics.some(d => /Ambiguous declaration overloaded/.test(d.message)));
  assert.deepEqual(envelope(first).facts.map(f => f.specifier), ['one', 'two']);
  assert.equal(first.referenceSyntax.unsupported.length, 1);
});

test('T07 binding budget is combined across declarations, not reset per import', () => {
  const source = count => [
    'import {' + Array.from({ length: 4000 }, (_, i) => `b${i}`).join(',') + '} from "one";',
    'import {' + Array.from({ length: count - 4000 }, (_, i) => `b${i + 4000}`).join(',') + '} from "two";'
  ].join('\n');
  const exact = envelope(analyze(source(8000)));
  assert.equal(exact.extraction, 'collected');
  assert.deepEqual(exact.facts.map(f => f.typed.bindings.length), [4000, 4000]);
  referenceLimit(analyze(source(8001)), 'binding-limit');
});

test('T08 empty/comment-only collection retains the unsupported-resolution contract', () => {
  for (const source of ['', '// import "decoy";\n', 'const text = "require(never)";']) {
    assert.deepEqual(envelope(analyze(source)), {
      version: 'typed-reference-syntax-v1', extraction: 'collected', facts: [], unsupported: [], resolution
    });
  }
});
