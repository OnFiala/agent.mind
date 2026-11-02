import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { analyzeSource } from '../source-analysis.mjs';

const analyze = source => analyzeSource('fixture.mjs', source, 'fixture-hash');

// These are the existing conservative scope rules, including whole-function
// suppression for declarations and module-wide suppression for global mutation.
const scopes = [
  ['nested duplicate names and following siblings', `
    function outer(fetch) {
      function inner(fetch) { fetch('/api/hidden-inner'); }
      fetch('/api/hidden-outer');
    }
    function sibling() { fetch('/api/sibling'); }
    fetch('/api/after');
  `, ['/api/sibling', '/api/after']],
  ['destructured parameters and late declarations', `
    function destructured({fetch}, [EventSource], ...rest) { fetch('/api/hidden-param'); }
    function late() { fetch('/api/hidden-var'); var fetch; }
    function declared() { fetch('/api/hidden-function'); function fetch() {} }
    fetch('/api/after');
  `, ['/api/after']],
  ['catch and named class scopes end before siblings', `
    try {} catch (fetch) { fetch('/api/hidden-catch'); }
    const C = class fetch extends fetch('/api/hidden-extends') {
      [fetch('/api/hidden-key')]() { fetch('/api/hidden-method'); }
    };
    fetch('/api/after');
  `, ['/api/after']],
  ['loop declarations keep existing whole-function conservatism', `
    function loops() {
      for (let fetch of values) { fetch('/api/hidden-loop'); }
      fetch('/api/hidden-function');
    }
    fetch('/api/after');
  `, ['/api/after']],
  ['global mutation suppresses the entire module', `
    fetch('/api/hidden-before');
    function mutate() { [globalThis.fetch] = custom; }
    fetch('/api/hidden-after');
  `, []]
];
for (const [name, source, expected] of scopes) test(`scope membership preserves ${name}`, () => {
  const result = analyze(source);
  assert.ok(!result.diagnostics.some(item => item.message.includes('parse error')));
  assert.deepEqual(result.contracts.consumers.map(item => item.pathname), expected);
  assert.equal(result.security.filter(item => item.label === 'Network call: fetch').length, expected.length);
});

test('membership lookup crosses nested frames without recursive lookup or sibling leaks', () => {
  const depth = 128;
  const source = Array.from({ length: depth }, (_, i) => `function f${i}(p${i}) {`).join('\n')
    + '\nfetch("/api/deep");\n' + '}\n'.repeat(depth) + 'fetch("/api/after");';
  const result = analyze(source);
  assert.deepEqual(result.contracts.consumers.map(item => item.pathname), ['/api/deep', '/api/after']);
});

test('import shadowing is local to its scope and preserves following operations', () => {
  const result = analyze(`
    import fs from 'node:fs';
    function outer(fs) { function inner(fs) { fs.readFileSync('hidden'); } fs.readFileSync('hidden'); }
    function sibling() { fs.readFileSync('sibling'); }
    fs.readFileSync('after');
  `);
  assert.equal(result.references.length, 1);
  assert.equal(result.security.filter(item => item.kind === 'dependency').length, 1);
  assert.deepEqual(result.security.filter(item => item.kind === 'operation').map(item => item.evidence.line), [4, 5]);
});

test('one dense eligible file retains references and security after the symbol budget within an external deadline', () => {
  // An external process can kill a blocked synchronous walk. This generous
  // regression bound is not a supported-size or latency guarantee.
  const program = `
    import assert from 'node:assert/strict';
    import { INDEX_LIMITS } from ${JSON.stringify(new URL('../code-index.mjs', import.meta.url).href)};
    import { analyzeSource } from ${JSON.stringify(new URL('../source-analysis.mjs', import.meta.url).href)};
    const dense = Array.from({ length: 20000 }, (_, i) => 'function f' + i + '(){}').join('\\n');
    assert.equal(Buffer.byteLength(dense), 388889);
    const source = dense + '\\nnew URL("./tail.json", import.meta.url);\\nfetch("/api/tail");';
    assert.ok(Buffer.byteLength(source) < INDEX_LIMITS.fileBytes);
    const result = analyzeSource('dense.mjs', source, 'dense-hash');
    assert.equal(result.symbols.length, 20000);
    assert.equal(result.symbolGraph.nodes.length, 2000);
    assert.ok(result.symbolGraph.diagnostics.some(item => item.message.includes('budget exceeded') && item.message.includes('partial')));
    assert.deepEqual(result.references.map(item => [item.specifier, item.evidence.line]), [['./tail.json', 20001]]);
    assert.deepEqual(result.contracts.consumers.map(item => [item.pathname, item.evidence.line]), [['/api/tail', 20002]]);
    assert.ok(result.security.some(item => item.label === 'Network call: fetch' && item.line === 20002));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', program], {
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

const wideElements = Array(150000).fill('0').join(',');
const wideContexts = [
  ['top-level', `const values = [${wideElements}];\nfetch('/api/tail');`, result => {
    assert.deepEqual(result.contracts.consumers.map(item => [item.pathname, item.evidence.line]), [['/api/tail', 2]]);
  }],
  ['function scope', `function owner() { const values = [${wideElements}]; }\nfetch('/api/tail');`, result => {
    assert.deepEqual(result.contracts.consumers.map(item => [item.pathname, item.evidence.line]), [['/api/tail', 2]]);
  }],
  ['unsupported field without this write', `class Store { run() { this.save(); } save() {} value = [${wideElements}]; }`, result => {
    assert.ok(result.symbolGraph.edges.some(edge => edge.from.endsWith('#Store.run') && edge.to.endsWith('#Store.save')));
  }],
  ['unsupported field with this write', `class Store { run() { this.save(); } save() {} value = [${wideElements}, this.save = replacement]; }`, result => {
    assert.ok(!result.symbolGraph.edges.some(edge => edge.from.endsWith('#Store.run') && edge.to.endsWith('#Store.save')));
    assert.match(result.symbolGraph.diagnostics.map(item => item.message).join(' '), /unresolved/);
  }],
  ['unsupported static block with this write', `class Store { static run() { this.save(); } static save() {} static { const values = [${wideElements}]; this.save = replacement; } }`, result => {
    assert.ok(!result.symbolGraph.edges.some(edge => edge.from.endsWith('#Store.run') && edge.to.endsWith('#Store.save')));
    assert.match(result.symbolGraph.diagnostics.map(item => item.message).join(' '), /unresolved/);
  }],
  ['HTTP handler and response branch', `import {createServer} from 'node:http';\ncreateServer((req, res) => { const url = new URL(req.url, 'http://localhost'); if (url.pathname === '/api/wide') { const values = [${wideElements}]; res.setHeader('Content-Type', 'text/event-stream'); res.end('ok'); } });`, result => {
    assert.deepEqual(result.contracts.providers.map(item => [item.pathname, item.eventStream, item.evidence.line]), [['/api/wide', true, 2]]);
    assert.deepEqual(result.references.map(item => item.specifier), ['node:http']);
  }]
];
for (const [name, source, check] of wideContexts) test(`wide child arrays preserve ${name} analysis and explicit symbol-budget diagnostics`, () => {
  const result = analyze(source);
  assert.match(result.symbolGraph.diagnostics.map(item => item.message).join(' '), /budget exceeded;.*partial/);
  assert.ok(!result.diagnostics.some(item => /parse error|call stack/i.test(item.message)));
  check(result);
});
