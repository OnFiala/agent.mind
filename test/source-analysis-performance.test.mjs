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
