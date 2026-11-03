import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzePythonSource, isPythonSource, PYTHON_LIMITS } from '../python-analysis.mjs';
import { indexProject, readIndexedSource } from '../code-index.mjs';
import { LiveIndex } from '../live-index.mjs';

const hash = source => createHash('sha256').update(source).digest('hex');
const analyze = (source, relative = 'src/example.py') => analyzePythonSource(relative, source, hash(source));
const symbol = (result, name) => result.symbolGraph.nodes.find(node => node.qualifiedName === name);
const file = (graph, name) => graph.nodes.find(node => node.path === name);
function fixture(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-python-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), source);
  }
  return root;
}
function withheld(result, pattern) {
  assert.deepEqual(result.symbols, []);
  assert.deepEqual(result.symbolGraph.nodes, []);
  assert.deepEqual(result.symbolGraph.edges, []);
  assert(result.diagnostics.some(item => pattern.test(item.message)));
}

test('Python declaration inspection preserves source names, native kinds, lexical parents and producer evidence', () => {
  const source = [
    '@pkg.decorator("ignored")',
    'async def outer():',
    '    class Box:',
    '        @staticmethod',
    '        async def read():',
    '            def inner(): pass',
    '            return inner()',
    '    return Box',
    'if enabled:',
    '    def conditional(): pass',
    'value = lambda: 1'
  ].join('\n');
  const result = analyze(source);
  assert.deepEqual(result.symbolGraph.nodes.map(node => [node.qualifiedName, node.kind, node.languageKind]), [
    ['outer', 'function', 'FunctionDefinition'], ['outer.Box', 'class', 'ClassDefinition'],
    ['outer.Box.read', 'method', 'FunctionDefinition'], ['outer.Box.read.inner', 'function', 'FunctionDefinition'],
    ['conditional', 'function', 'FunctionDefinition']
  ]);
  for (const node of result.symbolGraph.nodes) {
    assert.equal(node.id, `symbol:src/example.py#${node.qualifiedName}`);
    assert.equal(node.name, node.label);
    assert.equal(node.hash, hash(source));
    assert.deepEqual(node.producer, { name: '@lezer/python', version: '1.1.19', mode: 'static-source' });
    assert.equal(node.parentId, node.qualifiedName.includes('.') ? `symbol:src/example.py#${node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf('.'))}` : null);
  }
  assert.deepEqual(result.symbols.map(node => node.name), ['outer', 'conditional']);
  assert.equal(symbol(result, 'outer').range.start, source.indexOf('async def'));
  assert.equal(symbol(result, 'outer.Box.read').range.start, source.indexOf('async def read'));
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.security, []);
  assert.deepEqual(result.symbolGraph.edges.map(edge => [edge.from, edge.to]), [['symbol:src/example.py#outer.Box.read', 'symbol:src/example.py#outer.Box.read.inner']]);
});

for (const newline of ['\n', '\r\n', '\r']) test(`raw UTF-16 ranges retain tabs, astral text, source spelling and ${JSON.stringify(newline)}`, () => {
  const lines = ['# 🧠', '@pkg.decorator("🧠")', 'class Café:', '\tasync def méthode(self, value="🧠"):', '\t\tdef inner(): return value', '\t\treturn inner()', '', 'def fin(value="🧠"): pass'];
  const source = lines.join(newline);
  const starts = lines.map((_, index) => lines.slice(0, index).reduce((offset, line) => offset + line.length + newline.length, 0));
  const result = analyze(source);
  const expectations = [
    ['Café', starts[2], starts[6], 3, 1, 7, 1],
    ['Café.méthode', starts[3] + 1, starts[6], 4, 2, 7, 1],
    ['Café.méthode.inner', starts[4] + 2, starts[5], 5, 3, 6, 1],
    ['fin', starts[7], source.length, 8, 1, 8, lines[7].length + 1]
  ];
  for (const [name, start, end, line, column, endLine, endColumn] of expectations) {
    const node = symbol(result, name);
    assert(node, name);
    assert.deepEqual(node.range, { start, end, unit: 'utf16-code-unit', endExclusive: true });
    assert.deepEqual([node.line, node.column, node.endLine, node.endColumn], [line, column, endLine, endColumn]);
    assert.equal(node.hash, hash(source));
    assert.match(source.slice(node.range.start, node.range.end), /^(?:class|async def|def) /);
  }
});

test('comments, strings, docstrings, f-strings and lambdas create no false declarations', () => {
  const result = analyze([
    '# def comment(): pass',
    'text = "def string(): pass"',
    'doc = """class Fake:',
    '    def fake(self): pass',
    '"""',
    'formatted = f"def fake_formatted(): {1}"',
    'fn = lambda: "class Lambda: pass"',
    'def real():',
    '    """def hidden(): pass"""',
    '    return text'
  ].join('\n'));
  assert.deepEqual(result.symbolGraph.nodes.map(node => node.qualifiedName), ['real']);
});

test('any parser recovery withholds declarations, including a valid declaration before malformed text', () => {
  for (const source of ['def kept(): pass\ndef broken(:\n    pass\n', 'def kept(): pass\nvalue = (\n', 'def broken(:\n    pass\ndef kept(): pass\n']) {
    const result = analyze(source);
    withheld(result, /parse error/i);
    const error = result.diagnostics.find(item => item.severity === 'error');
    assert(error.line >= 1 && error.column >= 1);
  }
});

test('known unsupported modern syntax, Python 2 forms and unfinished strings fail closed', t => {
  for (const invalid of [
    '@factory[0]\ndef decorated(): pass\n', 'def generic[T = int](): pass\n',
    'print "old"\n', 'raise E, value\n', 'try: pass\nexcept E, e: pass\n',
    'x = 0755\n', 'x = 1 <> 2\n', '"unterminated\n', "x = r'undone\n", 'x = f"undone\n'
  ]) withheld(analyze('def kept(): pass\n' + invalid), /parse error/i);
  const accepted = analyze('def visible(): return "complete"\n');
  assert(symbol(accepted, 'visible'));
  assert(!accepted.diagnostics.some(item => ['warning', 'error'].includes(item.severity)));
  assert(accepted.diagnostics.some(item => /not CPython/.test(item.message)));
  const graph = indexProject(fixture(t, { 'malformed.py': 'def visible(): pass\n"unterminated\n' }));
  assert.equal(graph.status, 'partial');
  assert.equal(graph.symbolGraph.nodes.length, 0);
  assert(file(graph, 'malformed.py').diagnostics.some(item => item.severity === 'error'));
});

test('duplicate qualified names across conditionals withhold every ambiguous descendant and retain unrelated names', () => {
  const result = analyze([
    'if enabled:', '    class Duplicate:', '        def first(self):', '            def deep(): pass',
    'else:', '    class Duplicate:', '        def second(self): pass',
    'class Safe:', '    if enabled:', '        def method(self):', '            def hidden(): pass',
    '    else:', '        def method(self): pass', '    def distinct(self): pass',
    'def unique(): pass'
  ].join('\n'));
  assert.deepEqual(result.symbolGraph.nodes.map(node => node.qualifiedName), ['Safe', 'Safe.distinct', 'unique']);
  assert(result.diagnostics.some(item => /Ambiguous declaration Duplicate/.test(item.message)));
  assert(result.diagnostics.some(item => /Ambiguous declaration Safe.method/.test(item.message)));
  assert.equal(new Set(result.symbolGraph.nodes.map(node => node.id)).size, result.symbolGraph.nodes.length);
});

test('byte and symbol boundaries are exact and fail closed above their caps', () => {
  const prefix = 'def kept(): pass\n#';
  const atBytes = prefix + 'x'.repeat(PYTHON_LIMITS.bytes - Buffer.byteLength(prefix));
  assert(symbol(analyze(atBytes), 'kept'));
  withheld(analyze(atBytes + '🧠'), /65536 bytes/);
  const atSymbols = Array.from({ length: PYTHON_LIMITS.symbols }, (_, index) => `def f${index}(): pass`).join('\n');
  assert.equal(analyze(atSymbols).symbolGraph.nodes.length, PYTHON_LIMITS.symbols);
  withheld(analyze(atSymbols + '\ndef overflow(): pass'), /symbol limit/);
});

test('real parser depth and node-count overflow withhold an earlier valid declaration', () => {
  const deep = 'def kept(): pass\nx = ' + '('.repeat(300) + '0' + ')'.repeat(300) + '\n';
  // Flat statement groups exercise the node cap below the byte and depth caps.
  const wide = 'def kept(): pass\n' + '~0;'.repeat(21000);
  for (const source of [deep, wide]) {
    assert(Buffer.byteLength(source) < PYTHON_LIMITS.bytes);
    withheld(analyze(source), /traversal limit/);
  }
});

test('index exposes Python static evidence, inventory-only formats text-only, and literal JS source references intact', t => {
  const source = 'import os\nfrom missing import value\nraise RuntimeError("MUST NEVER EXECUTE")\ndef inspect():\n    os.system("never")\n    return value()\n';
  const root = fixture(t, {
    'src/inspect.py': source,
    'src/types.pyi': 'def stub(): ...\n',
    'notebook.ipynb': '{"cells": []}',
    'main.mjs': 'const source = new URL("./src/inspect.py", import.meta.url); export function legacy() { return 1; }',
    'typed.ts': 'export function typed(): number { return 1; }'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  const python = file(graph, 'src/inspect.py');
  assert.deepEqual(python.capabilities, ['text', 'python-syntax', 'static-references', 'named-symbols', 'local-calls']);
  assert.deepEqual(python.security, []);
  assert(symbol(graph, 'inspect'));
  assert.equal(readIndexedSource(root, python), source);
  for (const name of ['src/types.pyi', 'notebook.ipynb']) {
    assert.deepEqual(file(graph, name).capabilities, ['text']);
  }
  const asset = graph.edges.find(edge => edge.kind === 'asset');
  assert(asset);
  assert.equal(asset.to, 'file:src/inspect.py');
  assert.equal(graph.edges.filter(edge => edge.kind === 'import').length, 2);
  assert.deepEqual(graph.symbolGraph.edges, []);
  assert.equal(graph.nodes.filter(node => node.id.startsWith('external:python:')).length, 2);
  assert(graph.scope.limitations.some(item => /Python/.test(item)));
  const withoutPython = fixture(t, {
    'main.mjs': 'const source = new URL("./src/inspect.py", import.meta.url); export function legacy() { return 1; }',
    'typed.ts': 'export function typed(): number { return 1; }'
  });
  const legacy = indexProject(withoutPython);
  assert.deepEqual(graph.symbolGraph.nodes.filter(node => ['main.mjs', 'typed.ts'].includes(node.path)), legacy.symbolGraph.nodes);
});

test('cache and live reconciliation preserve IDs, refresh hashes, expose errors and recover through rename and deletion', t => {
  const source = 'raise RuntimeError("MUST NEVER EXECUTE")\ndef original(): pass\n';
  const root = fixture(t, { 'app.py': source });
  const live = new LiveIndex(root, { intervalMs: 60000 });
  t.after(() => live.close());
  const initial = live.graph;
  assert.equal(initial.status, 'current');
  assert(symbol(initial, 'original'));
  const warm = indexProject(root, { previous: initial });
  assert.equal(warm.revision, initial.revision);
  const pristine = structuredClone(warm.symbolGraph);
  warm.symbolGraph.nodes[0].name = 'poison';
  file(warm, 'app.py').symbols[0].name = 'poison';
  assert.deepEqual(indexProject(root, { previous: warm }).symbolGraph, pristine);
  fs.writeFileSync(path.join(root, 'app.py'), source.replace('pass', 'return 2'));
  const edited = live.refresh();
  assert.equal(symbol(edited, 'original').id, symbol(initial, 'original').id);
  assert.notEqual(symbol(edited, 'original').hash, symbol(initial, 'original').hash);
  assert.throws(() => readIndexedSource(root, file(initial, 'app.py')), /changed/);
  fs.writeFileSync(path.join(root, 'app.py'), 'def valid_before_error(): pass\ndef broken(:\n');
  const failed = live.refresh();
  assert.equal(failed.status, 'partial');
  assert.equal(failed.symbolGraph.nodes.length, 0);
  assert(failed.diagnostics.some(item => /parse error/i.test(item.message)));
  assert.equal(failed.runtime.status, 'current');
  const tooLarge = 'def hidden(): pass\n#' + 'x'.repeat(PYTHON_LIMITS.bytes);
  fs.writeFileSync(path.join(root, 'app.py'), tooLarge);
  const limited = live.refresh();
  assert.equal(limited.symbolGraph.nodes.length, 0);
  assert(limited.diagnostics.some(item => /65536 bytes/.test(item.message)));
  assert.equal(readIndexedSource(root, file(limited, 'app.py')), tooLarge);
  fs.writeFileSync(path.join(root, 'app.py'), 'def renamed(): pass\n');
  const recovered = live.refresh();
  assert(symbol(recovered, 'renamed'));
  assert(!symbol(recovered, 'original'));
  fs.renameSync(path.join(root, 'app.py'), path.join(root, 'moved.py'));
  const moved = live.refresh();
  assert.equal(symbol(moved, 'renamed').id, 'symbol:moved.py#renamed');
  assert(moved.runtime.changes.some(change => change.path === 'app.py' && change.kind === 'deleted'));
  fs.unlinkSync(path.join(root, 'moved.py'));
  const removed = live.refresh();
  assert.deepEqual(removed.symbolGraph.nodes, []);
  assert.equal(removed.stats.files, 0);
});

test('only the exact .py extension is eligible for this analyzer', () => {
  assert(isPythonSource('src/app.py'));
  for (const name of ['app.pyi', 'app.PY', 'app.pyc', 'app.ipynb', 'app.py.txt']) assert(!isPythonSource(name));
});
