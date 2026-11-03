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

test('NFKC lookup resolves Unicode spellings while preserving raw declaration identity and ranges', () => {
  const source = 'def K(): pass\ndef owner():\n    K()\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(pairs(result), [['owner', 'K', 'call']]);
  const declaration = result.symbolGraph.nodes.find(node => node.name === 'K');
  assert.equal(declaration.id, 'symbol:test/example.py#K');
  assert.equal(declaration.qualifiedName, 'K');
  assert.equal(source.slice(declaration.range.start, declaration.range.end), 'def K(): pass\n');
  assert.equal(declaration.hash, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(pairs(analyze('def K(): pass\ndef owner(): K()\n')), [['owner', 'K', 'call']]);
});

for (const [name, source] of [
  ['assignment shadow', 'def owner():\n    K()\n    K = other\n'],
  ['parameter', 'def owner(K): K()\n'],
  ['global write', 'def owner():\n    global K\n    K()\n    K = other\n'],
  ['nonlocal write', 'def outer():\n    def K(): pass\n    def owner():\n        nonlocal K\n        K()\n        K = other\n'],
  ['mutation', 'K.__code__ = other\ndef owner(): K()\n'],
  ['import alias', 'def owner():\n    K()\n    import module as K\n'],
  ['from import alias', 'def owner():\n    K()\n    from module import value as K\n']
]) test(`NFKC binding suppresses false source edge for ${name}`, () => {
  const result = analyze('def K(): pass\n' + source); clean(result);
  assert.equal(result.symbolGraph.edges.length, 0, JSON.stringify(pairs(result)));
  assert(result.diagnostics.some(item => /Unresolved Python call/.test(item.message) && item.line && item.column));
});

test('NFKC declaration collisions retain raw source symbols and omit ambiguous call edges', () => {
  const result = analyze('def K(): pass\ndef K(): pass\ndef owner():\n    K()\n    K()\n'); clean(result);
  assert.deepEqual(result.symbolGraph.nodes.map(node => node.name), ['K', 'K', 'owner']);
  assert.equal(result.symbolGraph.edges.length, 0);
  assert(result.diagnostics.some(item => /Ambiguous normalized Python binding/.test(item.message)));
});

test('NFKC import bindings retain raw module, alias and specifier evidence', () => {
  const result = analyze('import K.pkg as K\nfrom K.𝓂 import K as 𝓀\n'); clean(result);
  assert.deepEqual(result.references.map(item => [item.specifier, item.python.module, item.python.names]), [
    ['K.pkg', 'K.pkg', [{ name: 'K.pkg', as: 'K' }]],
    ['K.𝓂', 'K.𝓂', [{ name: 'K', as: '𝓀' }]]
  ]);
});

test('review R1: import comments are trivia and cannot hide imported shadow bindings', () => {
  const result = analyze('def target(): pass\ndef caller():\n    from pkg import (other, # comment\n        target)\n    target()\n'); clean(result);
  assert.deepEqual(result.references[0].python.names, [{ name: 'other' }, { name: 'target' }]);
  assert.deepEqual(pairs(result), []);
  const aliases = analyze('from pkg import (first, # comment\n    second as renamed, # trailing\n)\n'); clean(aliases);
  assert.deepEqual(aliases.references[0].python.names, [{ name: 'first' }, { name: 'second', as: 'renamed' }]);
});

test('review R2: implicit method __class__ cell suppresses module binding in methods and nested closures', () => {
  const result = analyze('def __class__(): pass\nclass Box:\n    def caller(self):\n        __class__()\n        def nested(): __class__()\n'); clean(result);
  assert.deepEqual(pairs(result), []);
  assert.equal(result.diagnostics.filter(item => /Unresolved Python call/.test(item.message)).length, 2);
});

test('review R2: class body __class__ retains lexical lookup while compiler namespace strings block calls', () => {
  const result = analyze('def __class__(): pass\ndef __module__(): pass\ndef __qualname__(): pass\ndef __doc__(): pass\nclass Box:\n    __class__()\n    __module__()\n    __qualname__()\n    __doc__()\nclass Documented:\n    "class doc"\n    __doc__()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([['Box', '__class__', 'call'], ['Box', '__doc__', 'call']].map(JSON.stringify)));
});

test('review R2: parenthesized or concatenated class docstrings bind __doc__ but bytes and f-strings do not', () => {
  for (const doc of ['("class doc")', '"class " "doc"', 'r"raw doc"']) {
    const result = analyze(`def __doc__(): pass\nclass Box:\n    ${doc}\n    __doc__()\n`); clean(result);
    assert.deepEqual(pairs(result), [], doc);
  }
  for (const expression of ['b"bytes"', 'f"formatted"']) {
    const result = analyze(`def __doc__(): pass\nclass Box:\n    ${expression}\n    __doc__()\n`); clean(result);
    assert.deepEqual(pairs(result), [['Box', '__doc__', 'call']], expression);
  }
});

test('review R3: dynamic namespace decorator callee poisons the same targets as an ordinary call', () => {
  const result = analyze('def target(): pass\ndef keep(value): return value\n@eval("globals().__setitem__(\'target\', lambda: \'replacement\') or keep")\ndef decorated(): pass\ndef caller(): target()\n'); clean(result);
  assert.deepEqual(pairs(result), []);
  assert(result.diagnostics.some(item => /dynamic namespace operations/.test(item.message)));
  const control = analyze('def target(): pass\ndef keep(): pass\n@keep()\ndef decorated(): pass\ndef caller(): target()\n'); clean(control);
  assert.deepEqual(new Set(pairs(control).map(JSON.stringify)), new Set([['file:test/example.py', 'keep', 'call'], ['caller', 'target', 'call']].map(JSON.stringify)));
});

for (const relative of ['calc.test.py', 'calc.spec.py']) test(`review R4: ${relative} call edges carry the testing layer`, () => {
  const source = 'def target(): pass\ndef caller(): target()\n';
  const result = analyzePythonSource(relative, source, createHash('sha256').update(source).digest('hex')); clean(result);
  assert.equal(result.symbolGraph.edges.length, 1);
  assert.deepEqual(result.symbolGraph.edges[0].layers, ['project', 'testing']);
});

test('private identity: bare reads select the effective class name and preserve exact raw evidence', () => {
  const source = '# 🧠\r\ndef __target(): pass\r\ndef _Box__target(): pass\r\nclass Box:\r\n    def caller(self): __target()\r\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(pairs(result), [['Box.caller', '_Box__target', 'call']]);
  assert.deepEqual(result.symbolGraph.edges[0].evidence, [{ path: 'test/example.py', line: 5, column: 23, snippet: 'def caller(self): __target()', containment: 'direct-body' }]);
  assert.deepEqual(result.symbolGraph.nodes.map(node => node.id), ['__target', '_Box__target', 'Box', 'Box.caller'].map(name => `symbol:test/example.py#${name}`));
  for (const node of result.symbolGraph.nodes) {
    assert.equal(node.hash, createHash('sha256').update(source).digest('hex'));
    assert.equal(source.slice(node.range.start, node.range.end).startsWith(node.kind === 'class' ? 'class Box:' : `def ${node.name}(`), true);
  }
});

test('private identity: declaration binders and explicit effective reads share one key without renaming symbols', () => {
  const result = analyze('def _Box__helper(): pass\nclass Box:\n    def caller(self):\n        def __helper(): pass\n        __helper()\n        _Box__helper()\n'); clean(result);
  assert.deepEqual(pairs(result), [['Box.caller', 'Box.caller.__helper', 'call']]);
  assert.deepEqual(result.symbolGraph.edges[0].evidence.map(item => [item.line, item.column, item.snippet]), [[5, 9, '__helper()'], [6, 9, '_Box__helper()']]);
  const nested = analyze('class Outer:\n    class __Inner: pass\n    _Outer__Inner()\n'); clean(nested);
  assert.deepEqual(pairs(nested), [['Outer', 'Outer.__Inner', 'construct']]);
});

for (const [name, signature, statement] of [
  ['parameter', 'self, __target', 'pass'],
  ['assignment', 'self', '__target = other'],
  ['annotation', 'self', '__target: object'],
  ['destructuring', 'self', 'x, __target = values'],
  ['chained assignment', 'self', 'x = __target = other'],
  ['loop', 'self', 'for __target in values: pass'],
  ['except', 'self', 'try: pass\n        except Error as __target: pass'],
  ['with', 'self', 'with ctx as __target: pass'],
  ['delete', 'self', 'del __target'],
  ['update', 'self', '__target += other'],
  ['walrus', 'self', '(__target := other)'],
  ['comprehension walrus', 'self', '[(__target := x) for x in values]'],
  ['match', 'self', 'match value:\n            case {"key": __target}: pass'],
  ['type alias', 'self', 'type __target = object'],
  ['import', 'self', 'import __target'],
  ['dotted import', 'self', 'import __target.member'],
  ['import alias', 'self', 'import other as __target'],
  ['from member', 'self', 'from other import __target'],
  ['from alias', 'self', 'from other import value as __target']
]) test(`private identity: ${name} shadows an explicit mangled call for the whole function`, () => {
  const result = analyze(`def _Box__target(): pass\nclass Box:\n    def caller(${signature}):\n        _Box__target()\n        ${statement}\n`); clean(result);
  assert.deepEqual(pairs(result), []);
  assert(result.diagnostics.some(item => /Unresolved Python call/.test(item.message) && item.line === 4 && item.column === 9));
});

test('private identity: global writes and member poison affect effective keys without poisoning raw module names', () => {
  for (const mutation of ['def mutate(self):\n        global __target\n        __target = other', '__target.__code__ = other']) {
    const result = analyze(`def __target(): pass\ndef _Box__target(): pass\nclass Box:\n    ${mutation}\ndef caller():\n    _Box__target()\n    __target()\n`); clean(result);
    assert.deepEqual(pairs(result), [['caller', '__target', 'call']]);
    assert.equal(result.symbolGraph.edges[0].evidence[0].snippet, '__target()');
  }
  const nonlocal = analyze('def outer():\n    def _Box__target(): pass\n    class Box:\n        def caller(self):\n            nonlocal __target\n            _Box__target()\n            __target = other\n'); clean(nonlocal);
  assert.deepEqual(pairs(nonlocal), []);
});

test('private identity: nested headers use outer context and bodies use the original inner class name', () => {
  const source = 'def __target(): pass\ndef _Outer__target(): pass\ndef _Inner__target(): pass\nclass Outer:\n    @__target()\n    class __Inner(__target()):\n        def caller(self, value=__target()):\n            def nested(): __target()\n            __target()\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['Outer', '_Outer__target', 'call'], ['Outer.__Inner', '_Inner__target', 'call'],
    ['Outer.__Inner.caller.nested', '_Inner__target', 'call'], ['Outer.__Inner.caller', '_Inner__target', 'call']
  ].map(JSON.stringify)));
  assert.deepEqual(result.symbolGraph.edges.find(edge => edge.from.endsWith('#Outer')).evidence.map(item => [item.line, item.column]), [[5, 5], [6, 19]]);
  assert.deepEqual(result.symbolGraph.edges.find(edge => edge.from.endsWith('#Outer.__Inner')).evidence.map(item => [item.line, item.column]), [[7, 32]]);
});

test('private identity: NFKC precedes class/name mangling while dunders and underscore-only reset stay unchanged', () => {
  const unicode = analyze('def __K(): pass\ndef _K__K(): pass\nclass K:\n    def caller(self): __K()\n'); clean(unicode);
  assert.deepEqual(pairs(unicode), [['K.caller', '_K__K', 'call']]);
  assert(unicode.symbolGraph.nodes.some(node => node.id === 'symbol:test/example.py#__K' && node.name === '__K'));
  const leading = analyze('def _Box__target(): pass\nclass __Box:\n    def caller(self): __target()\n'); clean(leading);
  assert.deepEqual(pairs(leading), [['__Box.caller', '_Box__target', 'call']]);
  const controls = analyze('def __target(): pass\ndef __target__(): pass\ndef _Outer__target(): pass\ndef module(): __target()\nclass Outer:\n    class ___:\n        def caller(self):\n            __target()\n            __target__()\n'); clean(controls);
  assert.deepEqual(new Set(pairs(controls).map(JSON.stringify)), new Set([
    ['module', '__target', 'call'], ['Outer.___.caller', '__target', 'call'], ['Outer.___.caller', '__target__', 'call']
  ].map(JSON.stringify)));
});

test('private identity: generic class bases and keywords are explicitly unresolved while ordinary headers remain supported', () => {
  const source = 'def __target(): pass\ndef _Outer__target(): pass\ndef _Generic__target(): pass\nclass Outer:\n    class Generic[T](__target(), metaclass=__target()):\n        def caller(self): __target()\n    class Ordinary(__target()): pass\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['Outer.Generic.caller', '_Generic__target', 'call'], ['Outer', '_Outer__target', 'call']
  ].map(JSON.stringify)));
  assert.equal(result.diagnostics.filter(item => /generic class header/.test(item.message) && item.line === 5).length, 2);
  const typeParam = analyze('def _Generic__T(): pass\nclass Outer:\n    class Generic[__T](__T()):\n        def caller(self): __T()\n'); clean(typeParam);
  assert.deepEqual(pairs(typeParam), []);
});

test('private identity: import lookup modules follow simple/dotted operands and retain raw spelling and relative levels', () => {
  const source = 'class Box:\n    import __mod\n    import __mod as __alias\n    import __mod.child\n    import __mod.child as __alias2\n    from __pkg import __member\n    from .__pkg import __member as __alias3\n    from pkg.__mod import __member\n    from .. import __member\n    import __mod__\n    import __K\n    import K\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(result.references.map(({ specifier, python }) => [specifier, python.module, python.lookupModule, python.level, python.names]), [
    ['__mod', '__mod', '_Box__mod', 0, [{ name: '__mod' }]],
    ['__mod', '__mod', '_Box__mod', 0, [{ name: '__mod', as: '__alias' }]],
    ['__mod.child', '__mod.child', undefined, 0, [{ name: '__mod.child' }]],
    ['__mod.child', '__mod.child', undefined, 0, [{ name: '__mod.child', as: '__alias2' }]],
    ['__pkg', '__pkg', '_Box__pkg', 0, [{ name: '__member' }]],
    ['.__pkg', '__pkg', '_Box__pkg', 1, [{ name: '__member', as: '__alias3' }]],
    ['pkg.__mod', 'pkg.__mod', undefined, 0, [{ name: '__member' }]],
    ['..', '', undefined, 2, [{ name: '__member' }]],
    ['__mod__', '__mod__', undefined, 0, [{ name: '__mod__' }]],
    ['__K', '__K', '_Box__K', 0, [{ name: '__K' }]],
    ['K', 'K', 'K', 0, [{ name: 'K' }]]
  ]);
  assert.deepEqual(result.references.map(reference => reference.evidence.line), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const reset = analyze('class Outer:\n    class ___:\n        import __mod\n'); clean(reset);
  assert(!Object.hasOwn(reset.references[0].python, 'lookupModule'));
});

test('private identity: long implementation-defined transforms withhold affected relationships explicitly', () => {
  const at = 'B'.repeat(251), over = 'B'.repeat(252);
  const safe = analyze(`def _${at}__x(): pass\nclass ${at}:\n    def caller(self): __x()\n`); clean(safe);
  assert.deepEqual(pairs(safe), [[`${at}.caller`, `_${at}__x`, 'call']]);
  const limited = analyze(`def helper(): pass\nclass ${over}:\n    import __x\n    def caller(self): __x()\ndef caller(): helper()\n`);
  assert.deepEqual(limited.references, []);
  assert.deepEqual(pairs(limited), []);
  assert(limited.diagnostics.some(item => item.severity === 'warning' && /private.*255|255.*private/i.test(item.message)));
});

test('lambda defaults bind walrus writes in the enclosing module or function scope', () => {
  const module = analyze('def target(): pass\ndef replacement(): pass\nfactory = lambda value=(target := replacement): None\ndef caller(): target()\n'); clean(module);
  assert.deepEqual(pairs(module), []);
  const closure = analyze('def target(): pass\ndef outer():\n    def replacement(): pass\n    factory = lambda value=(target := replacement): None\n    def caller(): target()\ndef unaffected(): target()\n'); clean(closure);
  assert.deepEqual(pairs(closure), [['unaffected', 'target', 'call']]);
});

test('lambda default calls use enclosing bindings and retain source identities and evidence', () => {
  const source = '# 🧠\r\ndef target(): pass\r\ndef caller():\r\n    factory = lambda target=target(), *, value=target(): target()\r\n    target()\r\n';
  const result = analyze(source); clean(result);
  assert.deepEqual(pairs(result), [['caller', 'target', 'call']]);
  assert.deepEqual(result.symbolGraph.edges[0].evidence.map(item => [item.line, item.column, item.snippet]), [
    [4, 29, 'factory = lambda target=target(), *, value=target(): target()'],
    [4, 48, 'factory = lambda target=target(), *, value=target(): target()'],
    [5, 5, 'target()']
  ]);
  assert(result.diagnostics.some(item => /lambda\/comprehension context/.test(item.message) && item.line === 4 && item.column === 58));
  assert.deepEqual(result.symbolGraph.nodes.map(node => node.id), ['target', 'caller'].map(name => `symbol:test/example.py#${name}`));
  for (const node of result.symbolGraph.nodes) {
    assert.equal(node.hash, createHash('sha256').update(source).digest('hex'));
    assert(source.slice(node.range.start, node.range.end).startsWith(`def ${node.name}(`));
  }
});

test('lambda parameters, body writes and nested lambda defaults keep their own local scopes', () => {
  for (const expression of ['lambda target=target: target()', 'lambda *target, **other: target()', 'lambda: (target := replacement)', 'lambda: (lambda value=(target := replacement): target())']) {
    const result = analyze(`def target(): pass\ndef replacement(): pass\nfactory = ${expression}\ndef caller(): target()\n`); clean(result);
    assert.deepEqual(pairs(result), [['caller', 'target', 'call']], expression);
  }
  const nestedDefault = analyze('def target(): pass\ndef replacement(): pass\nfactory = lambda value=(lambda nested=(target := replacement): None): None\ndef caller(): target()\n'); clean(nestedDefault);
  assert.deepEqual(pairs(nestedDefault), []);
});

test('lambda defaults preserve lexical class-private context without leaking body writes', () => {
  const result = analyze('def __target(): pass\ndef _Box__target(): pass\ndef replacement(): pass\nclass Box:\n    def method(self):\n        factory = lambda __target=__target(): (__target := replacement)\n        __target()\n    class Inner:\n        factory = lambda value=(__target := replacement): None\n        __target()\ndef caller(): __target()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['Box.method', '_Box__target', 'call'], ['caller', '__target', 'call']
  ].map(JSON.stringify)));
  assert.deepEqual(result.symbolGraph.edges.find(edge => edge.from.endsWith('#Box.method')).evidence.map(item => item.line), [6, 7]);
  const write = analyze('def _Box__target(): pass\ndef replacement(): pass\nclass Box:\n    def method(self):\n        factory = lambda value=(__target := replacement): None\n        _Box__target()\ndef unaffected(): _Box__target()\n'); clean(write);
  assert.deepEqual(pairs(write), [['unaffected', '_Box__target', 'call']]);
});

test('lambda defaults inside comprehensions do not hide enclosing walrus writes', () => {
  const result = analyze('def target(): pass\ndef replacement(): pass\ndef caller():\n    factories = [lambda value=(target := replacement): None for item in items]\n    target()\n'); clean(result);
  assert.deepEqual(pairs(result), []);
});

for (const annotation of ['value: int', 'value: int = 1', '(value): int', 'obj.value: int', 'values[0]: int']) {
  test(`version-sensitive class __annotations__ collision includes ${annotation}`, () => {
    const result = analyze(`def __annotations__(): pass\nclass Box:\n    __annotations__()\n    ${annotation}\n    __annotations__()\n    def method(self): __annotations__()\n`); clean(result);
    assert.deepEqual(pairs(result), [['Box.method', '__annotations__', 'call']]);
    const collisions = result.diagnostics.filter(item => /version-sensitive.*__annotations__/.test(item.message));
    assert.deepEqual(collisions.map(item => item.line), [3, 5]);
    assert(collisions.every(item => item.severity === 'info' && item.column === 5 && /3\.12\/3\.13/.test(item.message) && /3\.14/.test(item.message)));
  });
}

test('class annotation collision stops at function and nested class boundaries', () => {
  const result = analyze('def __annotations__(): pass\nclass Outer:\n    __annotations__()\n    def method(self, value: int) -> int:\n        local: int\n        __annotations__()\n    class Inner:\n        value: int\n        __annotations__()\n    class Plain:\n        __annotations__()\n    __annotations__()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['Outer', '__annotations__', 'call'], ['Outer.method', '__annotations__', 'call'], ['Outer.Plain', '__annotations__', 'call']
  ].map(JSON.stringify)));
  assert.deepEqual(result.symbolGraph.edges.find(edge => edge.from.endsWith('#Outer')).evidence.map(item => item.line), [3, 12]);
  assert.deepEqual(result.diagnostics.filter(item => /version-sensitive.*__annotations__/.test(item.message)).map(item => item.line), [9]);
});

for (const statement of ['if False:\n        value: int', 'for item in items:\n        value: int', 'while enabled:\n        value: int', 'try:\n        pass\n    except Error:\n        value: int', 'with context:\n        value: int', 'match value:\n        case 0:\n            field: int']) {
  test(`class annotation collision includes same-body control flow: ${statement.split(':')[0]}`, () => {
    const result = analyze(`def __annotations__(): pass\nclass Box:\n    __annotations__()\n    ${statement}\n`); clean(result);
    assert.deepEqual(pairs(result), []);
    assert(result.diagnostics.some(item => /version-sensitive.*__annotations__/.test(item.message) && item.line === 3));
  });
}

test('class annotation collision stays local and does not make unrelated files or calls partial', () => {
  const result = analyze('def __annotations__(): pass\ndef target(): pass\nclass Annotated:\n    value: int\n    target()\n    class Nested:\n        __annotations__()\n    def method(self): __annotations__()\nclass Plain:\n    __annotations__()\ndef caller(): __annotations__()\n'); clean(result);
  assert.deepEqual(new Set(pairs(result).map(JSON.stringify)), new Set([
    ['Annotated', 'target', 'call'], ['Annotated.Nested', '__annotations__', 'call'], ['Annotated.method', '__annotations__', 'call'],
    ['Plain', '__annotations__', 'call'], ['caller', '__annotations__', 'call']
  ].map(JSON.stringify)));
  assert(!result.diagnostics.some(item => /version-sensitive/.test(item.message)));
});

test('class annotation collision preserves explicit later class declarations and future-import uncertainty', () => {
  const local = analyze('def __annotations__(): pass\nclass Box:\n    value: int\n    __annotations__()\n    def __annotations__(): pass\n    __annotations__()\n'); clean(local);
  assert.deepEqual(pairs(local), [['Box', 'Box.__annotations__', 'call']]);
  assert.deepEqual(local.symbolGraph.edges[0].evidence.map(item => item.line), [6]);
  const future = analyze('from __future__ import annotations\ndef __annotations__(): pass\nclass Box:\n    __annotations__()\n    value: int\n'); clean(future);
  assert.deepEqual(pairs(future), []);
});

test('annotations inside conditional nested declarations do not mark their enclosing class', () => {
  const result = analyze('def __annotations__(): pass\nclass Box:\n    if enabled:\n        class Nested:\n            value: int\n        def method(self):\n            value: int\n    __annotations__()\n'); clean(result);
  assert.deepEqual(pairs(result), [['Box', '__annotations__', 'call']]);
  assert(!result.diagnostics.some(item => /version-sensitive/.test(item.message)));
});
