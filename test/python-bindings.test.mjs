import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzePythonSource, PYTHON_LIMITS } from '../python-analysis.mjs';
const analyze = source => analyzePythonSource('test/example.py', source, createHash('sha256').update(source).digest('hex'));
const pairs = result => result.symbolGraph.edges.map(edge => [edge.from.replace('symbol:test/example.py#', ''), edge.to.replace('symbol:test/example.py#', ''), edge.kind]);
const clean = result => assert(!result.diagnostics.some(item => ['warning', 'error'].includes(item.severity)), JSON.stringify(result.diagnostics));

test('Python import syntax retains modules, relative level, aliases, star and located source evidence', () => {
  const source = '# 🧠\r\nimport os.path as p, sys\r\nfrom ..pkg.mod import (one as first, two)\r\nfrom . import x\r\nfrom pkg import *\r\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(result.references.map(({ kind, specifier, python }) => ({ kind, specifier, python })), [
    { kind: 'import', specifier: 'os.path', python: { level: 0, module: 'os.path', names: [{ name: 'os.path', as: 'p' }], form: 'import' } },
    { kind: 'import', specifier: 'sys', python: { level: 0, module: 'sys', names: [{ name: 'sys' }], form: 'import' } },
    { kind: 'import', specifier: '..pkg.mod', python: { level: 2, module: 'pkg.mod', names: [{ name: 'one', as: 'first' }, { name: 'two' }], form: 'from' } },
    { kind: 'import', specifier: '.', python: { level: 1, module: '', names: [{ name: 'x' }], form: 'from' } },
    { kind: 'import', specifier: 'pkg', python: { level: 0, module: 'pkg', names: [{ name: '*' }], form: 'from' } }
  ]);
  assert.deepEqual(result.references.map(item => [item.evidence.line, item.evidence.column]), [[2, 8], [2, 22], [3, 1], [4, 1], [5, 1]]);
  assert(result.references.every(item => item.evidence.path === 'test/example.py' && item.evidence.snippet));
});

test('direct functions, recursion, nested closures and simple class construction produce static source edges', () => {
  const result = analyze('def helper(): pass\nclass Box: pass\ndef outer():\n    def inner():\n        helper()\n        inner()\n    inner()\n    return Box()\nouter()\n');
  clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['outer.inner', 'helper', 'call'], ['outer.inner', 'outer.inner', 'call'],
    ['outer', 'outer.inner', 'call'], ['outer', 'Box', 'construct'], ['file:test/example.py', 'outer', 'call']
  ].map(JSON.stringify)));
  for (const edge of result.symbolGraph.edges) {
    assert.equal(edge.provenance, 'static-call'); assert.equal(edge.execution, 'not-observed');
    assert.deepEqual(edge.layers, ['project', 'testing']);
    assert(edge.evidence.every(item => item.line > 0 && item.column > 0 && item.snippet));
  }
});

const shadows = [
  ['parameter', 'def caller(target):\n    target()\n'],
  ['assignment after call', 'def caller():\n    target()\n    target = other\n'],
  ['type alias', 'def caller():\n    target()\n    type target = int\n'],
  ['annotated local', 'def caller():\n    target()\n    target: object\n'],
  ['destructuring', 'def caller():\n    target()\n    target, x = values\n'],
  ['chained assignment', 'def caller():\n    target()\n    x = target = other\n'],
  ['loop target', 'def caller():\n    target()\n    for target, x in values: pass\n'],
  ['except target', 'def caller():\n    target()\n    try: pass\n    except Exception as target: pass\n'],
  ['with target', 'def caller():\n    target()\n    with ctx as target: pass\n'],
  ['delete', 'def caller():\n    target()\n    del target\n'],
  ['update', 'def caller():\n    target()\n    target += other\n'],
  ['walrus', 'def caller():\n    target()\n    (target := other)\n'],
  ['comprehension walrus', 'def caller():\n    target()\n    [(target := x) for x in values]\n'],
  ['match capture', 'def caller(value):\n    target()\n    match value:\n        case {"key": target}: pass\n'],
  ['match as pattern', 'def caller(value):\n    target()\n    match value:\n        case A(value=x) as target: pass\n'],
  ['import alias', 'def caller():\n    target()\n    import module as target\n'],
  ['from alias', 'def caller():\n    target()\n    from module import value as target\n'],
  ['global', 'def caller():\n    global target\n    target()\n    target = other\n'],
  ['nonlocal', 'def outer():\n    def target(): pass\n    def caller():\n        nonlocal target\n        target()\n        target = other\n'],
  ['member mutation', 'target.__code__ = other\ndef caller(): target()\n'],
  ['dynamic namespace', 'def caller():\n    globals()["target"] = other\n    target()\n'],
  ['star import', 'from module import *\ndef caller(): target()\n'],
  ['conditional definition', 'if enabled:\n    def target(): pass\ndef caller(): target()\n']
];
for (const [name, source] of shadows) test(`whole-body Python binding suppresses false target edge: ${name}`, () => {
  const result = analyze('def target(): pass\n' + source); clean(result);
  assert(!result.symbolGraph.edges.some(edge => edge.to.endsWith('#target') || edge.to.endsWith('#outer.target')), JSON.stringify(pairs(result)));
  assert(result.diagnostics.some(item => item.severity === 'info' && /Unresolved Python call/.test(item.message) && item.line && item.column));
});

test('defaults, decorators and bases evaluate in enclosing scope; function body shadow does not leak to header', () => {
  const result = analyze('def target(): pass\n@target()\ndef caller(value=target()):\n    target = other\n    target()\nclass Box(target()): pass\n'); clean(result);
  const edge = result.symbolGraph.edges.find(edge => edge.to.endsWith('#target'));
  assert.equal(edge.from, 'file:test/example.py');
  assert.deepEqual(edge.evidence.map(item => item.line), [2, 3, 6]);
  assert(!pairs(result).some(([from]) => from === 'caller'));
});

test('default name expressions are not parameter binders', () => {
  const result = analyze('def target(): pass\ndef caller(value=target):\n    target()\n'); clean(result);
  assert.deepEqual(pairs(result), [['caller', 'target', 'call']]);
});

test('methods and nested classes skip class lexical namespaces, retaining enclosing function closures', () => {
  const result = analyze('def target(): pass\ndef outer():\n    def closed(): pass\n    class Box:\n        def target(): pass\n        class Inner:\n            target()\n        def method(self):\n            target()\n            closed()\n            self.target()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['outer.Box.Inner', 'target', 'call'], ['outer.Box.method', 'target', 'call'], ['outer.Box.method', 'outer.closed', 'call']
  ].map(JSON.stringify)));
});

test('decorated targets, dotted decorators, inherited/metaclass classes and member calls stay unresolved', () => {
  const result = analyze('def target(): pass\n@target.member()\ndef decorated(): pass\n@deco\nclass Wrapped: pass\nclass Inherited(Base): pass\nclass Meta(metaclass=Factory): pass\ndef caller():\n    decorated()\n    Wrapped()\n    Inherited()\n    Meta()\n    obj.target()\n'); clean(result);
  assert.deepEqual(pairs(result), []);
});

test('lambda and comprehension calls are located unresolved while ordinary enclosing call remains resolvable', () => {
  const result = analyze('def target(): pass\ndef caller():\n    target()\n    x = lambda target: target()\n    values = [target() for target in items]\n    return (target() for x in items)\n'); clean(result);
  assert.deepEqual(pairs(result), [['caller', 'target', 'call']]);
  assert.equal(result.diagnostics.filter(item => /Unresolved Python call/.test(item.message)).length, 3);
});

test('call-site budget warns at its exact cap without unbounded records', () => {
  const prefix = 'def f(): pass\n';
  const at = analyze(prefix + 'f();'.repeat(PYTHON_LIMITS.callSites)); clean(at);
  assert.equal(at.symbolGraph.edges[0].evidence.length, PYTHON_LIMITS.callSites);
  const over = analyze(prefix + 'f();'.repeat(PYTHON_LIMITS.callSites + 1));
  assert(over.diagnostics.some(item => item.severity === 'warning' && /budget/.test(item.message)));
  assert.equal(over.symbolGraph.edges[0].evidence.length, PYTHON_LIMITS.callSites);
});

test('annotations are located unresolved and never attributed to the function body', () => {
  const result = analyze('def target(): pass\ndef caller(value: target()) -> target():\n    target()\n'); clean(result);
  assert.deepEqual(pairs(result), [['caller', 'target', 'call']]);
  assert.equal(result.diagnostics.filter(item => /Unresolved Python call/.test(item.message)).length, 2);
});

test('a declaration is unbound during its own header and class body but function recursion remains valid', () => {
  const result = analyze('def f(value=f()):\n    f()\nclass C:\n    C()\ndef outer():\n    def inner(value=inner()):\n        inner()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([['f', 'f', 'call'], ['outer.inner', 'outer.inner', 'call']].map(JSON.stringify)));
});

test('generic type parameters shadow ordinary functions in headers, bodies and class method closures', () => {
  const result = analyze('def target(): pass\ndef generic[target](value=target()):\n    target()\nclass Box[target]:\n    def method(self): target()\n'); clean(result);
  assert.deepEqual(pairs(result), []);
  assert.equal(result.diagnostics.filter(item => /Unresolved Python call/.test(item.message)).length, 3);
});
