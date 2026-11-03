import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INDEX_LIMITS, indexProject, readIndexedSource } from '../code-index.mjs';

function fixture(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(contents)) write(root, name, value);
  return fs.realpathSync(root);
}

function write(root, name, value) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

const file = (graph, name) => graph.nodes.find(node => node.id === `file:${name}`);
const edge = (graph, from, to, kind) => graph.edges.find(item => item.from === `file:${from}` && item.to === to && item.kind === kind);

test('AST relationships ignore comments, strings and regex literals; preserve reexports and literal dynamic imports', t => {
  const root = fixture(t, {
    'main.mjs': [
      '// import "./false-comment.mjs";',
      'const example = `import "./false-string.mjs"`;',
      String.raw`const regex = /import ".\/false-regex.mjs"/;`,
      'import { answer } from "./value.mjs";',
      'export { answer } from "./value.mjs";',
      'export * from "./value.mjs";',
      'await import("./value.mjs");',
      'await import(example);',
      'export function greet() { return answer; }'
    ].join('\n'),
    'value.mjs': 'export const answer = 42;'
  });
  const graph = indexProject(root);
  assert.equal(graph.stats.files, 2);
  assert.equal(graph.edges.length, 3);
  assert.equal(edge(graph, 'main.mjs', 'file:value.mjs', 'reexport').evidence.length, 2);
  assert.equal(edge(graph, 'main.mjs', 'file:value.mjs', 'import').evidence[0].line, 4);
  assert.equal(edge(graph, 'main.mjs', 'file:value.mjs', 'dynamic-import').evidence[0].line, 7);
  assert.ok(graph.diagnostics.some(item => item.line === 8 && item.message.includes('Computed dynamic import')));
  assert.ok(file(graph, 'main.mjs').symbols.some(symbol => symbol.name === 'greet' && symbol.kind === 'function' && symbol.line === 9));
  assert.ok(!JSON.stringify(graph).includes('external:./false'));
});

test('security layer records exact dependencies and AST operations, suppressing shadowed bindings', t => {
  const root = fixture(t, {
    'security.mjs': [
      'import fs from "node:fs";',
      'import { createServer as serve } from "node:http";',
      'import unrelated from "acorn";',
      'fs.readFileSync("local.json");',
      'serve(() => {});',
      'function shadow(fs, fetch, process) { fs.readFileSync("x"); fetch("x"); return process.env; }',
      'fetch("https://example.invalid/");',
      'const environmentName = process.env.EXAMPLE;',
      String.raw`export const escaped = "child_process.exec(\"false\")";`
    ].join('\n')
  });
  const graph = indexProject(root);
  const node = file(graph, 'security.mjs');
  assert.deepEqual(node.layers, ['project', 'security']);
  assert.equal(node.security.filter(item => item.kind === 'dependency').length, 2);
  assert.equal(node.security.filter(item => item.kind === 'operation').length, 2);
  assert.equal(node.security.filter(item => item.kind === 'network').length, 1);
  assert.equal(node.security.filter(item => item.kind === 'environment').length, 1);
  assert.ok(!node.security.some(item => item.line === 6 || item.line === 9));
  assert.ok(edge(graph, 'security.mjs', 'external:node:fs', 'import').layers.includes('security'));
  assert.ok(!edge(graph, 'security.mjs', 'external:acorn', 'import').layers.includes('security'));
  assert.equal(graph.status, 'current');
  assert.ok(graph.scope.limitations.some(item => item.includes('do not establish vulnerabilities or safety')));
});

test('testing highlights literal source references and imports, without claiming coverage or pass evidence', t => {
  const root = fixture(t, {
    'test/app.test.mjs': [
      'import { answer } from "../src/app.mjs";',
      'const source = new URL("../src/app.mjs", import.meta.url);',
      'const data = new URL("fixture.json", import.meta.url);'
    ].join('\n'),
    'test/fixture.json': '{"answer":42}',
    'src/app.mjs': 'export const answer = 42;'
  });
  const graph = indexProject(root);
  assert.equal(file(graph, 'test/app.test.mjs').kind, 'test');
  assert.ok(file(graph, 'src/app.mjs').layers.includes('testing'));
  assert.ok(edge(graph, 'test/app.test.mjs', 'file:src/app.mjs', 'import').layers.includes('testing'));
  assert.equal(edge(graph, 'test/app.test.mjs', 'file:src/app.mjs', 'test-reference').evidence[0].line, 2);
  assert.ok(edge(graph, 'test/app.test.mjs', 'file:test/fixture.json', 'test-reference'));
  assert.ok(graph.scope.limitations.some(item => item.includes('Run tests for results and enable coverage')));
  assert.equal(graph.status, 'current');
});

test('HTML resolves actual script/link assets, ignoring comments, raw script strings and query fragments', t => {
  const root = fixture(t, {
    'public/index.html': [
      '<!-- <script src="./fake.js"></script> -->',
      '<script>const text = `<link href="./fake.css">`;</script><textarea><script src="./inert.js"></script></textarea>',
      '<script data-note="src=fake.js" src="/app.js?version=1"></script>',
      '<link rel="stylesheet" href="./style.css#theme">',
      '<script src="https://example.invalid/module.js"></script>'
    ].join('\n'),
    'public/app.js': 'export const ready = true;',
    'public/style.css': 'body { color: white; }'
  });
  const graph = indexProject(root);
  assert.equal(graph.edges.length, 3);
  assert.equal(edge(graph, 'public/index.html', 'file:public/app.js', 'asset').evidence[0].line, 3);
  assert.ok(edge(graph, 'public/index.html', 'file:public/style.css', 'asset'));
  assert.ok(edge(graph, 'public/index.html', 'external:https://example.invalid/module.js', 'asset'));
  assert.equal(graph.status, 'current');
});

test('missing local imports stay unresolved; packages retain literal identities and no extension guessing occurs', t => {
  const root = fixture(t, {
    'main.mjs': 'import "./missing.mjs"; import "./exists"; import "package/subpath"; import "node:fs/promises";',
    'exists.mjs': 'export const x = 1;'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.nodes.some(node => node.id === 'external:package/subpath' && node.path === null));
  assert.ok(graph.diagnostics.some(item => item.message.includes('./missing.mjs')));
  assert.ok(graph.diagnostics.some(item => item.message.includes('./exists')));
  assert.ok(!graph.nodes.some(node => node.id === 'external:./missing.mjs'));
});

test('stable file and edge identities survive edits; inventory add/delete and content changes alter revision', t => {
  const root = fixture(t, { 'main.mjs': 'import "./value.mjs";', 'value.mjs': 'export const answer = 1;' });
  const first = indexProject(root);
  const unchanged = indexProject(root, { previous: first });
  assert.equal(unchanged.revision, first.revision);
  assert.equal(unchanged.stats.cachedFiles, 2);
  write(root, 'value.mjs', 'export const answer = 2;');
  const edited = indexProject(root, { previous: unchanged });
  assert.notEqual(edited.revision, first.revision);
  assert.equal(edited.stats.cachedFiles, 1);
  assert.equal(edited.edges[0].id, first.edges[0].id);
  write(root, 'added.py', 'x = 1\n');
  const added = indexProject(root, { previous: edited });
  assert.notEqual(added.revision, edited.revision);
  assert.equal(added.stats.cachedFiles, 2);
  fs.unlinkSync(path.join(root, 'added.py'));
  const deleted = indexProject(root, { previous: added });
  assert.equal(deleted.revision, edited.revision);
  assert.ok(!file(deleted, 'added.py'));
});

test('cached analysis cannot be poisoned by modifying serialized symbols, edges or security', t => {
  const root = fixture(t, { 'main.mjs': 'import fs from "node:fs"; export const answer = fs.statSync(".");' });
  const first = indexProject(root);
  const expectedRevision = first.revision;
  first.edges[0].evidence[0].snippet = 'changed by caller';
  file(first, 'main.mjs').symbols[0].name = 'changed';
  file(first, 'main.mjs').security[0].evidence.snippet = 'changed';
  const second = indexProject(root, { previous: first });
  assert.equal(second.revision, expectedRevision);
  assert.equal(second.stats.cachedFiles, 1);
  assert.ok(!JSON.stringify(second).includes('changed by caller'));
  assert.ok(!('cache' in JSON.parse(JSON.stringify(second))));
});

test('syntax errors are explicit partial diagnostics, with no guessed relationships', t => {
  const root = fixture(t, { 'broken.mjs': 'import "node:fs"; export const =;', 'broken.json': '{ not json }' });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.edges.length, 0);
  assert.equal(file(graph, 'broken.mjs').security.length, 0);
  assert.ok(graph.diagnostics.some(item => item.path === 'broken.mjs' && item.line === 1 && item.message.includes('parse error')));
  assert.ok(graph.diagnostics.some(item => item.path === 'broken.json' && item.message.includes('JSON parse error')));
});

test('inventory excludes archived builder, hidden paths, credentials, workspace and dependencies', t => {
  const root = fixture(t, {
    'main.mjs': 'export const ready = true;',
    'legacy/builder.mjs': 'throw new Error("not executed");',
    'workspace/project.mjs': 'export const privateProject = true;',
    'node_modules/module/index.js': 'export default 1;',
    'evidence/private.md': 'private',
    'backups/private.json': '{}',
    'credentials.json': '{"private":"content"}',
    '.env.json': '{"private":"content"}',
    '.hidden/private.mjs': 'export const hidden = 1;'
  });
  const graph = indexProject(root);
  assert.deepEqual(graph.nodes.map(node => node.path), ['main.mjs']);
  assert.ok(graph.scope.excluded.includes('legacy/'));
  assert.ok(graph.scope.excluded.includes('credentials.json'));
  assert.ok(!JSON.stringify(graph).includes('not executed'));
});

test('symlink files/directories, traversal and absolute references never read outside the index root', t => {
  const outside = fixture(t, { 'private.mjs': 'export const sensitiveOutsideMarker = 1;' });
  const root = fixture(t, { 'main.mjs': 'import "./link.mjs"; import "./linked/private.mjs"; import "../private.mjs"; import "file:///outside/private.mjs";' });
  fs.symlinkSync(path.join(outside, 'private.mjs'), path.join(root, 'link.mjs'));
  fs.symlinkSync(outside, path.join(root, 'linked'), 'dir');
  const graph = indexProject(root);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.diagnostics.length, 4);
  assert.ok(graph.scope.excluded.includes('link.mjs (symlink)'));
  assert.ok(graph.scope.excluded.includes('linked (symlink)'));
  assert.ok(!JSON.stringify(graph).includes('sensitiveOutsideMarker'));
  const rootLink = path.join(root, 'root-link');
  fs.symlinkSync(outside, rootLink, 'dir');
  assert.throws(() => indexProject(rootLink), /symbolic link/);
});

test('source reads bind to the indexed hash and reject stale, excluded and symlink files', t => {
  const root = fixture(t, { 'main.mjs': 'export const value = 1;', 'credentials.json': '{"private":"content"}' });
  const graph = indexProject(root);
  const node = file(graph, 'main.mjs');
  assert.equal(readIndexedSource(root, node), 'export const value = 1;');
  write(root, 'main.mjs', 'export const value = 2;');
  assert.throws(() => readIndexedSource(root, node), /changed/);
  assert.throws(() => readIndexedSource(root, { ...node, id: 'file:../main.mjs', path: '../main.mjs' }), /eligible/);
  assert.throws(() => readIndexedSource(root, { ...node, id: 'file:credentials.json', path: 'credentials.json' }), /eligible/);
  fs.unlinkSync(path.join(root, 'main.mjs'));
  fs.symlinkSync(path.join(root, 'credentials.json'), path.join(root, 'main.mjs'));
  assert.throws(() => readIndexedSource(root, node), /Symbolic links/);
});

test('per-file read budget produces an explicit partial scan and avoids allocating oversized source', t => {
  const root = fixture(t, { 'small.mjs': 'export const small = true;', 'large.md': 'x'.repeat(INDEX_LIMITS.fileBytes + 1) });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.stats.files, 1);
  assert.ok(!file(graph, 'large.md'));
  assert.ok(graph.diagnostics.some(item => item.path === 'large.md' && item.message.includes('Read budget')));
});

test('total bytes and file-count budgets bound a project with many eligible files', t => {
  const countRoot = fixture(t, {});
  for (let number = 0; number <= INDEX_LIMITS.files; number++) write(countRoot, `${String(number).padStart(4, '0')}.md`, 'small');
  const countGraph = indexProject(countRoot);
  assert.equal(countGraph.stats.files, INDEX_LIMITS.files);
  assert.equal(countGraph.status, 'partial');
  assert.ok(countGraph.diagnostics.some(item => item.message.includes('Inventory budget')));

  const byteRoot = fixture(t, {});
  const value = 'x'.repeat(INDEX_LIMITS.fileBytes);
  for (let number = 0; number <= INDEX_LIMITS.totalBytes / INDEX_LIMITS.fileBytes; number++) write(byteRoot, `${String(number).padStart(3, '0')}.md`, value);
  const byteGraph = indexProject(byteRoot);
  assert.equal(byteGraph.nodes.reduce((sum, node) => sum + node.bytes, 0), INDEX_LIMITS.totalBytes);
  assert.equal(byteGraph.status, 'partial');
  assert.ok(byteGraph.diagnostics.some(item => item.message.includes('Read budget')));
});

test('global operations are not attributed to locally declared or hoisted names', t => {
  const root = fixture(t, { 'main.mjs': 'if (true) { var fetch = () => {}; } fetch("local"); function read() { return process.env; var process; }' });
  const graph = indexProject(root);
  assert.equal(file(graph, 'main.mjs').security.length, 0);
});

const transportEdges = graph => graph.edges.filter(item => ['http', 'event-stream'].includes(item.kind));
const handler = (body, { method = 'GET', input = 'req.url', before = '', receiver = 'http', declaration = 'const url = new URL(INPUT, "http://localhost");' } = {}) => `
import http from 'node:http';
${before}
${receiver}.createServer((req, res) => {
  ${method ? `if (req.method !== '${method}') return res.end();` : ''}
  ${declaration.replace('INPUT', input)}
  ${body}
});`;

test('named class expressions shadow APIs only inside their own class scope', t => {
  const root = fixture(t, {
    'client.mjs': [
      'const A = class fetch extends fetch("/api/graph") { [fetch("/api/graph")]() {} run() { fetch("/api/graph"); } };',
      'const B = class EventSource { stream = new EventSource("/api/events"); };',
      'const C = class URL { static { new URL("./hidden.json", import.meta.url); } };',
      'fetch("/api/graph");',
      'new EventSource("/api/events");',
      'new URL("./visible.json", import.meta.url);'
    ].join('\n'),
    'server.mjs': handler('if (url.pathname === "/api/graph") return res.end(); if (url.pathname === "/api/events") { res.writeHead(200, {"Content-Type":"text/event-stream"}); res.write("event"); }'),
    'hidden.json': '{}',
    'visible.json': '{}'
  });
  const graph = indexProject(root);
  assert.ok(!graph.diagnostics.some(item => item.message.includes('parse error')));
  assert.deepEqual(file(graph, 'client.mjs').security.filter(item => item.kind === 'network').map(item => item.line), [4, 5]);
  assert.equal(transportEdges(graph).length, 2);
  assert.deepEqual(transportEdges(graph).flatMap(item => item.evidence.filter(e => e.role === 'consumer').map(e => e.line)).sort(), [4, 5]);
  assert.ok(!edge(graph, 'client.mjs', 'file:hidden.json', 'asset'));
  assert.ok(edge(graph, 'client.mjs', 'file:visible.json', 'asset'));
});

test('class expression names suppress imported HTTP factories without hiding the outer import', t => {
  const callback = '(req, res) => { const url = new URL(req.url, "http://localhost"); if (url.pathname === "/api/graph") return res.end(); }';
  const root = fixture(t, {
    'client.mjs': 'fetch("/api/graph");',
    'server.mjs': [
      'import http from "node:http";',
      `const A = class http { run() { http.createServer(${callback}); } };`,
      `http.createServer(${callback});`
    ].join('\n')
  });
  const graph = indexProject(root);
  assert.equal(transportEdges(graph).length, 1);
  assert.deepEqual(file(graph, 'server.mjs').security.filter(item => item.kind === 'operation').map(item => item.line), [3]);
  assert.ok(transportEdges(graph)[0].evidence.some(item => item.role === 'server' && item.line === 3));
});

test('static HTTP/SSE contracts connect both actual endpoint sources with hash evidence and preserve imports', t => {
  const root = fixture(t, {
    'public/client.js': [
      'fetch("/api/graph");',
      'fetch(`/api/source?path=${encodeURIComponent("source.mjs")}&line=${1}`);',
      'new EventSource("/api/events");'
    ].join('\n'),
    'server.mjs': handler([
      'if (url.pathname === "/api/graph") return res.end("graph");',
      'if (url.pathname === "/api/source") return res.end("source");',
      'if (url.pathname === "/api/events") { res.writeHead(200, {"Content-Type":"text/event-stream"}); res.write("event"); }'
    ].join('\n'), { declaration: 'let url; try { url = new URL(INPUT, "http://localhost"); } catch { return res.end(); }' })
  });
  const graph = indexProject(root);
  const contracts = transportEdges(graph);
  assert.equal(contracts.length, 3);
  assert.deepEqual(contracts.map(item => item.label).sort(), ['HTTP /api/graph', 'HTTP /api/source', 'SSE /api/events']);
  for (const item of contracts) {
    assert.equal(item.from, 'file:public/client.js');
    assert.equal(item.to, 'file:server.mjs');
    assert.equal(item.provenance, 'static-contract');
    assert.equal(item.certainty, 'static-contract');
    assert.equal(item.contract.methodAssurance, 'matched');
    assert.deepEqual(item.layers, ['project', 'security']);
    for (const role of ['consumer', 'handler', 'server', 'request-url', 'response']) assert.ok(item.evidence.some(evidence => evidence.role === role));
    for (const evidence of item.evidence) assert.equal(evidence.hash, file(graph, evidence.path).hash);
  }
  assert.ok(contracts.find(item => item.kind === 'event-stream').evidence.some(evidence => evidence.role === 'event-stream-header' && evidence.snippet.includes('text/event-stream')));
  assert.ok(edge(graph, 'server.mjs', 'external:node:http', 'import'));
  assert.equal(graph.status, 'current');
  const same = indexProject(root, { previous: graph });
  assert.equal(same.revision, graph.revision);
  assert.equal(same.stats.cachedFiles, 2);
  contracts[0].evidence[0].snippet = 'caller mutation';
  contracts[0].contract.pathname = '/poison';
  assert.equal(indexProject(root, { previous: graph }).revision, same.revision);
});

test('transport matching ignores fixture strings/comments, shadowed globals, external URLs and dynamic pathnames', t => {
  const root = fixture(t, {
    'client.js': [
      '// fetch("/api/graph"); new EventSource("/api/events");',
      'const fixture = `fetch("/api/graph")`;',
      'function shadow(fetch, EventSource) { fetch("/api/graph"); new EventSource("/api/events"); }',
      'fetch("https://example.invalid/api/graph");',
      'new EventSource("//example.invalid/api/events");',
      'const name = "graph"; fetch(`/api/${name}`);',
      'new EventSource(`/api/events?filter=${name}`);'
    ].join('\n'),
    'server.mjs': handler('if (url.pathname === "/api/graph") return res.end("graph");')
  });
  const graph = indexProject(root);
  assert.equal(transportEdges(graph).length, 0);
  assert.ok(graph.diagnostics.some(item => item.path === 'client.js' && item.line === 6 && item.message.includes('fixed same-origin')));
  assert.ok(graph.diagnostics.some(item => item.path === 'client.js' && item.line === 7 && item.message.includes('/api/events')));
  assert.ok(!graph.diagnostics.some(item => item.line === 1 || item.line === 2 || item.line === 3 || item.line === 4 || item.line === 5));
});

test('only imported HTTP factory callbacks with a unique request URL binding produce providers', t => {
  const scenarios = [
    ['wrong-receiver', handler('if (url.pathname === "/api/graph") return res.end();', { receiver: 'fake', before: 'const fake = {createServer(){}};' })],
    ['shadowed-receiver', `import http from 'node:http'; function run(http) { http.createServer((req,res) => {const url=new URL(req.url,"http://localhost"); if(url.pathname==="/api/graph") return res.end();}); }`],
    ['wrong-request', handler('if (url.pathname === "/api/graph") return res.end();', { input: 'other.url' })],
    ['unrelated-object', handler('if (other.pathname === "/api/graph") return res.end();')],
    ['unrelated-comparison', handler('console.log(url.pathname === "/api/graph");')],
    ['no-response', handler('if (url.pathname === "/api/graph") console.log("hello");')],
    ['reassigned-url', handler('url = new URL("/wrong", "http://localhost"); if (url.pathname === "/api/graph") return res.end();')],
    ['mutated-url', handler('url.pathname = "/wrong"; if (url.pathname === "/api/graph") return res.end();')],
    ['shadowed-url', handler('{ const url = new URL(req.url,"http://localhost"); if (url.pathname === "/api/graph") return res.end(); }')],
    ['escaped-block', handler('if (url.pathname === "/api/graph") return res.end();', { declaration: '{ const url = new URL(INPUT, "http://localhost"); }' })],
    ['constructor-shadow', handler('function URL() {} if (url.pathname === "/api/graph") return res.end();')],
    ['catch-shadow', handler('try { throw 1; } catch(req) {const other = new URL(req.url,"http://localhost"); if(other.pathname === "/api/graph") return res.end();}')],
    ['nested-unrelated-handler', handler('function unrelated() {if (url.pathname === "/api/graph") return res.end();}')],
    ['mutated-factory', handler('if (url.pathname === "/api/graph") return res.end();', { before: 'http.createServer = () => {};' })]
  ];
  for (const [name, source] of scenarios) {
    const root = fixture(t, { 'client.js': 'fetch("/api/graph");', 'server.mjs': source });
    const graph = indexProject(root);
    assert.equal(transportEdges(graph).length, 0, name);
    assert.ok(graph.diagnostics.some(item => item.path === 'client.js' && item.message.includes('No supported')), name);
  }
});

test('ambiguous providers and incompatible HTTP methods never invent a selected target', t => {
  const root = fixture(t, {
    'client.js': 'fetch("/api/graph"); fetch("/api/write");',
    'server-one.mjs': handler('if (url.pathname === "/api/graph") return res.end();'),
    'server-two.mjs': handler('if (url.pathname === "/api/graph") return res.end();'),
    'write.mjs': handler('if (url.pathname === "/api/write") return res.end();', { method: 'POST' })
  });
  const graph = indexProject(root);
  assert.equal(transportEdges(graph).length, 0);
  assert.ok(graph.diagnostics.some(item => item.message.includes('Ambiguous HTTP handlers for /api/graph')));
  assert.ok(graph.diagnostics.some(item => item.message.includes('No supported method-compatible HTTP handler for /api/write')));
  write(root, 'client.js', 'fetch("/api/write", {method: "post"});');
  const matched = indexProject(root, { previous: graph });
  assert.equal(transportEdges(matched).length, 1);
  assert.equal(transportEdges(matched)[0].to, 'file:write.mjs');
  assert.equal(transportEdges(matched)[0].contract.methodAssurance, 'matched');
});

test('method uncertainty is explicit and EventSource requires observed event-stream response headers', t => {
  const root = fixture(t, {
    'test/client.test.mjs': 'fetch("/api/graph"); new EventSource("/api/graph");',
    'server.mjs': handler('if (url.pathname === "/api/graph") return res.end("plain response");', { method: null })
  });
  const graph = indexProject(root);
  assert.equal(transportEdges(graph).length, 1);
  assert.equal(transportEdges(graph)[0].kind, 'http');
  assert.equal(transportEdges(graph)[0].contract.methodAssurance, 'unknown');
  assert.equal(transportEdges(graph)[0].contract.providerMethod, null);
  assert.ok(transportEdges(graph)[0].layers.includes('testing'));
  assert.ok(graph.diagnostics.some(item => item.message.includes('No static text/event-stream')));
});

test('named HTTP imports work, while mutated browser globals and unsupported method control flow remain unlinked', t => {
  const root = fixture(t, {
    'client.js': 'fetch("/api/graph");',
    'server.mjs': 'import { createServer as listen } from "node:http"; listen((request,response) => {const target = new URL(request.url,"http://localhost"); if(target.pathname === "/api/graph") return response.end();});'
  });
  assert.equal(transportEdges(indexProject(root)).length, 1);
  write(root, 'client.js', 'globalThis.fetch = custom; fetch("/api/graph");');
  assert.equal(transportEdges(indexProject(root)).length, 0);
  write(root, 'client.js', 'fetch("/api/graph");');
  write(root, 'server.mjs', handler('if (req.method === "POST" && url.pathname === "/api/graph") return res.end();', { method: null }));
  assert.equal(transportEdges(indexProject(root)).length, 0);
});

test('server pathname literals never strip query or fragment, while legitimate client URLs do', t => {
  for (const suffix of ['?format=json', '#fragment']) {
    const root = fixture(t, {
      'client.js': 'fetch("/api/graph?format=json#fragment");',
      'server.mjs': handler(`if (url.pathname === "/api/graph${suffix}") return res.end();`)
    });
    const rejected = indexProject(root);
    assert.equal(transportEdges(rejected).length, 0, suffix);
    assert.ok(rejected.diagnostics.some(item => item.message.includes('No supported method-compatible HTTP handler for /api/graph')));
    write(root, 'server.mjs', handler('if (url.pathname === "/api/graph") return res.end();'));
    const accepted = indexProject(root, { previous: rejected });
    assert.equal(transportEdges(accepted).length, 1);
    assert.equal(transportEdges(accepted)[0].contract.pathname, '/api/graph');
  }
});

test('destructuring/default/rest/delete assignment leaves invalidate HTTP factories and browser globals', t => {
  const mutations = [
    target => `({value: ${target}} = custom);`,
    target => `[${target}] = custom;`,
    target => `({value: ${target} = replacement} = custom);`,
    target => `[...${target}] = custom;`,
    target => `({...${target}} = custom);`,
    target => `delete ${target};`,
    target => `for (${target} of custom) {}`
  ];
  for (const mutation of mutations) {
    const serverRoot = fixture(t, {
      'client.js': 'fetch("/api/graph");',
      'server.mjs': handler('if (url.pathname === "/api/graph") return res.end();', { before: mutation('http.createServer') })
    });
    const serverGraph = indexProject(serverRoot);
    assert.ok(!serverGraph.diagnostics.some(item => item.message.includes('JavaScript parse error')), mutation('http.createServer'));
    assert.equal(transportEdges(serverGraph).length, 0, mutation('http.createServer'));
    const clientRoot = fixture(t, {
      'client.js': `${mutation('globalThis.fetch')} fetch("/api/graph");`,
      'server.mjs': handler('if (url.pathname === "/api/graph") return res.end();')
    });
    const clientGraph = indexProject(clientRoot);
    assert.ok(!clientGraph.diagnostics.some(item => item.message.includes('JavaScript parse error')), mutation('globalThis.fetch'));
    assert.equal(transportEdges(clientGraph).length, 0, mutation('globalThis.fetch'));
  }
});

test('generic indexing includes legitimate project directories and excludes only the exact integration subtree', t => {
  const root = fixture(t, {
    'main.mjs': 'import "./legacy/a.mjs";',
    'legacy/a.mjs': 'export const a = 1;',
    'workspace/b.mjs': 'export const b = 2;',
    'backups/c.mjs': 'export const c = 3;',
    'evidence/d.mjs': 'export const d = 4;',
    'coverage/e.mjs': 'export const e = 5;',
    'agent.mind/runtime.mjs': 'export const runtimeMarker = 1;',
    'src/agent.mind/genuine.mjs': 'export const genuine = 1;',
    '.hidden/private.mjs': 'export const hidden = 1;',
    'legacy/credentials.json': '{"private":"secretMarker"}',
    'node_modules/mod/index.js': 'export default 1;'
  });
  const options = { generic: true, excludePaths: ['agent.mind'] };
  const graph = indexProject(root, options);
  for (const name of ['legacy/a.mjs', 'workspace/b.mjs', 'backups/c.mjs', 'evidence/d.mjs', 'coverage/e.mjs', 'src/agent.mind/genuine.mjs']) assert.ok(file(graph, name), name);
  assert.ok(!file(graph, 'agent.mind/runtime.mjs'));
  assert.ok(!JSON.stringify(graph).includes('secretMarker'));
  assert.equal(readIndexedSource(root, JSON.parse(JSON.stringify(file(graph, 'legacy/a.mjs'))), options), 'export const a = 1;');
  assert.throws(() => readIndexedSource(root, file(graph, 'legacy/a.mjs')), /eligible/);
  const defaultGraph = indexProject(root, { previous: graph });
  assert.ok(!file(defaultGraph, 'legacy/a.mjs'));
  assert.ok(file(defaultGraph, 'agent.mind/runtime.mjs'));
  const returned = indexProject(root, { ...options, previous: defaultGraph });
  assert.equal(returned.revision, graph.revision);
  fs.writeFileSync(path.join(root, 'legacy/a.mjs'), 'export const a = 2;');
  assert.throws(() => readIndexedSource(root, file(graph, 'legacy/a.mjs'), options), /changed/);
  assert.throws(() => indexProject(root, { generic: true, excludePaths: ['../other'] }), /safe relative/);
  assert.throws(() => indexProject(root, { generic: true, excludePaths: ['agent.mind/'] }), /safe relative/);
});

test('namespaced metadata is a bounded independent snapshot and changes revision without indexing runtime', t => {
  const root = fixture(t, {
    'a.mjs': 'export const value = 1;',
    'agent.mind/project-map.json': '{"schemaVersion":1,"blocks":[]}',
    'agent.mind/runtime.mjs': 'throw new Error("never run");'
  });
  const options = { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' };
  const first = indexProject(root, options);
  assert.equal(first.metadata.status, 'current');
  assert.equal(first.metadata.path, options.metadataPath);
  assert.ok(!first.nodes.some(node => node.path?.startsWith('agent.mind/')));
  write(root, options.metadataPath, '{"schemaVersion":1,"blocks":[],"parts":[]}');
  const second = indexProject(root, { ...options, previous: first });
  assert.notEqual(second.revision, first.revision);
  assert.notEqual(second.metadata.hash, first.metadata.hash);
  assert.equal(second.stats.cachedFiles, 1);
  write(root, options.metadataPath, 'x'.repeat(INDEX_LIMITS.fileBytes + 1));
  const oversized = indexProject(root, options);
  assert.equal(oversized.status, 'partial');
  assert.ok(oversized.diagnostics.some(item => item.path === options.metadataPath && item.message.includes('Read budget')));
  fs.unlinkSync(path.join(root, options.metadataPath));
  fs.symlinkSync(path.join(root, 'a.mjs'), path.join(root, options.metadataPath));
  const symlink = indexProject(root, options);
  assert.equal(symlink.metadata.status, 'error');
  assert.ok(symlink.diagnostics.some(item => /Symbolic links/.test(item.message)));
  fs.unlinkSync(path.join(root, options.metadataPath));
  fs.rmSync(path.join(root, 'agent.mind'), { recursive: true });
  const outside = fixture(t, { 'project-map.json': '{"outsideMarker":true}' });
  fs.symlinkSync(outside, path.join(root, 'agent.mind'), 'dir');
  const parentSymlink = indexProject(root, options);
  assert.equal(parentSymlink.metadata.status, 'error');
  assert.ok(!JSON.stringify(parentSymlink).includes('outsideMarker'));
});

test('unsupported source languages remain visible and cached source content is root-independent', t => {
  const root = fixture(t, { 'src/value.mts': 'export const typed: number = 1;', 'a.mjs': 'export const value = 1;' });
  const graph = indexProject(root, { generic: true });
  assert.equal(graph.status, 'partial');
  assert.deepEqual(graph.scope.unsupported, ['src/value.mts']);
  assert.ok(graph.diagnostics.some(item => item.path === 'src/value.mts' && item.message.includes('Unsupported source')));
  const other = fixture(t, { 'a.mjs': 'export const value = 2;' });
  const second = indexProject(other, { previous: graph, generic: true });
  assert.equal(second.stats.cachedFiles, 0);
  assert.notEqual(file(graph, 'a.mjs').hash, file(second, 'a.mjs').hash);
});

test('bounded inventory fingerprints unsupported text without extending source analysis or resolution', t => {
  const root = fixture(t, { 'main.mjs': 'import "./value.mjs"; import "./helper.mts";', 'value.mjs': 'export const value = 1;' });
  const original = indexProject(root);
  write(root, 'helper.mts', 'export const typed: number = 1; // Žluťoučký\r\n');
  write(root, 'notes.txt', 'Plain text, not source analysis.');
  const graph = indexProject(root, { previous: original });
  assert.equal(graph.inventory.status, 'complete');
  assert.equal(graph.status, 'partial');
  assert.notEqual(graph.revision, original.revision);
  assert.deepEqual(graph.edges, original.edges, 'inventory must not resolve the formerly unsupported import');
  for (const name of ['main.mjs', 'value.mjs']) assert.deepEqual(file(graph, name), file(original, name));
  const typed = file(graph, 'helper.mts');
  assert.equal(typed.kind, 'file');
  assert.deepEqual(typed.capabilities, ['text']);
  assert.deepEqual(typed.symbols, []);
  assert.ok(!graph.symbolGraph.nodes.some(node => node.path === 'helper.mts'));
  assert.equal(readIndexedSource(root, typed), 'export const typed: number = 1; // Žluťoučký\r\n');
  assert.equal(graph.inventory.entries.find(entry => entry.path === 'helper.mts').hash, typed.hash);
  assert.equal(indexProject(root, { previous: graph }).revision, graph.revision);
  write(root, 'helper.mts', 'export const typed: number = 2;\n');
  assert.throws(() => readIndexedSource(root, typed), /changed/);
  const changed = indexProject(root, { previous: graph });
  assert.notEqual(changed.revision, graph.revision);
  fs.unlinkSync(path.join(root, 'helper.mts'));
  const removed = indexProject(root, { previous: changed });
  assert.notEqual(removed.revision, changed.revision);
  assert.ok(!removed.inventory.entries.some(entry => entry.path === 'helper.mts'));
  assert.ok(!file(removed, 'helper.mts'));
});

test('inventory separates binary, non-UTF8, oversized and excluded entries from readable text', t => {
  const root = fixture(t, {
    'main.mjs': 'export const value = 1;',
    'image.bin': Buffer.from([0, 1, 255]),
    'invalid.txt': Buffer.from([0xc3, 0x28]),
    'large.ts': 'x'.repeat(INDEX_LIMITS.fileBytes + 1),
    'empty.txt': '',
    'credentials.txt': 'excluded-content-marker',
    'workspace/private.ts': 'excluded-content-marker',
    'hidden-code.ts': 'export const value: number = 1;'
  });
  fs.symlinkSync(path.join(root, 'credentials.txt'), path.join(root, 'linked.txt'));
  const graph = indexProject(root);
  const entry = name => graph.inventory.entries.find(item => item.path === name);
  assert.equal(graph.inventory.status, 'partial');
  assert.equal(graph.status, 'partial');
  for (const name of ['image.bin', 'invalid.txt']) {
    assert.equal(entry(name).state, 'binary');
    assert.match(entry(name).hash, /^[a-f0-9]{64}$/);
    assert.ok(!file(graph, name));
    assert.throws(() => readIndexedSource(root, { id: `file:${name}`, path: name, hash: entry(name).hash, capabilities: ['text'] }), /text/);
  }
  assert.equal(entry('large.ts').state, 'too-large');
  assert.equal(entry('large.ts').hash, undefined);
  assert.equal(entry('credentials.txt').state, 'excluded');
  assert.equal(entry('workspace/').state, 'excluded');
  assert.equal(entry('linked.txt').reason, 'symlink');
  assert.ok(!graph.inventory.entries.some(item => item.path === 'workspace/private.ts'));
  assert.equal(readIndexedSource(root, file(graph, 'empty.txt')), '');
  assert.ok(!JSON.stringify(graph).includes('excluded-content-marker'));
  const typed = file(graph, 'hidden-code.ts');
  fs.unlinkSync(path.join(root, 'hidden-code.ts'));
  fs.symlinkSync(path.join(root, 'credentials.txt'), path.join(root, 'hidden-code.ts'));
  assert.throws(() => readIndexedSource(root, typed), /Symbolic links/);
});

test('unsupported inventory consumes the existing file and total-byte budgets', t => {
  const root = fixture(t, {});
  for (let number = 0; number <= INDEX_LIMITS.files; number++) write(root, `${String(number).padStart(4, '0')}.txt`, 'text');
  const counted = indexProject(root);
  assert.equal(counted.inventory.entries.filter(item => item.state === 'text').length, INDEX_LIMITS.files);
  assert.equal(counted.inventory.status, 'partial');
  assert.ok(counted.inventory.entries.some(item => item.state === 'unscanned' && item.reason === 'file-limit'));
  const bytesRoot = fixture(t, {});
  const value = 'x'.repeat(INDEX_LIMITS.fileBytes);
  for (let number = 0; number <= INDEX_LIMITS.totalBytes / INDEX_LIMITS.fileBytes; number++) write(bytesRoot, `${String(number).padStart(3, '0')}.txt`, value);
  const sized = indexProject(bytesRoot);
  assert.equal(sized.inventory.status, 'partial');
  assert.equal(sized.inventory.entries.reduce((sum, item) => sum + (item.hash ? item.bytes : 0), 0), INDEX_LIMITS.totalBytes);
  assert.equal(sized.inventory.entries.at(-1).state, 'budget-exceeded');
});

test('capabilities describe available operations while analysis errors remain explicit', t => {
  const root = fixture(t, { 'broken.mjs': 'export const = ;', 'page.html': '<h1>Text</h1>', 'data.json': '{}', 'notes.md': 'Text', 'other.py': 'print("not executed")' });
  const graph = indexProject(root);
  assert.equal(graph.inventory.status, 'complete');
  assert.equal(graph.status, 'partial');
  assert.ok(file(graph, 'broken.mjs').capabilities.includes('named-symbols'));
  assert.ok(file(graph, 'broken.mjs').diagnostics.some(item => /parse error/.test(item.message)));
  assert.deepEqual(file(graph, 'page.html').capabilities, ['text', 'html-assets']);
  assert.deepEqual(file(graph, 'data.json').capabilities, ['text', 'json-validation']);
  assert.deepEqual(file(graph, 'other.py').capabilities, ['text', 'python-syntax', 'static-references', 'named-symbols', 'local-calls']);
  assert.ok(!file(graph, 'other.py').diagnostics.some(item => item.severity === 'warning'));
  assert.deepEqual(file(graph, 'notes.md').capabilities, ['text']);
});

test('inventory records unreadable files and known depth boundaries without claiming unseen contents', t => {
  const deep = 'nested/'.repeat(INDEX_LIMITS.depth + 1);
  const root = fixture(t, { 'blocked.txt': 'not returned', [deep + 'unseen.txt']: 'unseen-content-marker' });
  const open = fs.openSync;
  fs.openSync = (name, ...args) => {
    if (name === path.join(root, 'blocked.txt')) throw Object.assign(new Error('test read denied'), { code: 'EACCES' });
    return open(name, ...args);
  };
  let graph;
  try { graph = indexProject(root); } finally { fs.openSync = open; }
  assert.equal(graph.inventory.status, 'partial');
  assert.equal(graph.inventory.entries.find(entry => entry.path === 'blocked.txt').state, 'unreadable');
  assert.ok(graph.inventory.entries.some(entry => entry.path === deep && entry.state === 'unscanned' && entry.reason === 'depth-limit'));
  assert.ok(!graph.inventory.entries.some(entry => entry.path.endsWith('unseen.txt')));
  assert.ok(!JSON.stringify(graph).includes('unseen-content-marker'));
});

for (const generic of [false, true]) test(`inventory and source reads exclude conventional key/env names before opening bytes (generic=${generic})`, t => {
  const names = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ecdsa_sk', 'id_ed25519_sk', 'id_rsa.bak', 'id_rsa_backup', 'config.env', 'production.env.local', 'AuthKey_EXAMPLE.p8', 'deploy.ppk', 'private.key.bak'];
  const marker = 'synthetic-sensitive-marker';
  const root = fixture(t, Object.fromEntries([['main.mjs', 'export const value = 1;'], ...names.map(name => [name, marker])]));
  const opened = [];
  const open = fs.openSync;
  fs.openSync = (name, ...args) => { opened.push(name); return open(name, ...args); };
  try {
    const graph = indexProject(root, { generic });
    for (const name of names) {
      assert.equal(graph.inventory.entries.find(entry => entry.path === name)?.state, 'excluded', name);
      assert.ok(!file(graph, name));
      assert.throws(() => readIndexedSource(root, { id: `file:${name}`, path: name, hash: createHash('sha256').update(marker).digest('hex'), capabilities: ['text'] }, { generic }), /eligible/);
      assert.ok(!opened.includes(path.join(root, name)), 'excluded content must never be opened');
    }
    assert.ok(!JSON.stringify(graph).includes(marker));
  } finally { fs.openSync = open; }
});


for (const newline of ['\n', '\r\n']) test(`analysis preserves UTF-16 columns, source lines and raw hashes with ${JSON.stringify(newline)}`, t => {
  const lines = [
    '/*🧠*/ import { value } from "./value.mjs";',
    '/*🧠*/ export function café() {',
    '  return value;',
    '}',
    'export function caller() { "🧠"; return café(); }',
    'throw new Error("Source must only be scanned");'
  ];
  const source = lines.join(newline);
  const htmlLines = [
    '<!-- 🧠 -->',
    '🧠<script src="../main.mjs"></script>',
    '<script>throw new Error("Inline code must not run"); import("./absent.mjs");</script>'
  ];
  const root = fixture(t, { 'main.mjs': source, 'value.mjs': 'export const value = 1;', 'public/index.html': htmlLines.join(newline) });
  const graph = indexProject(root);
  const hash = createHash('sha256').update(source).digest('hex');
  assert.equal(graph.status, 'current');
  assert.equal(file(graph, 'main.mjs').hash, hash);
  assert.equal(file(graph, 'main.mjs').bytes, Buffer.byteLength(source));
  assert.equal(readIndexedSource(root, file(graph, 'main.mjs')), source);
  const declaration = graph.symbolGraph.nodes.find(node => node.id === 'symbol:main.mjs#café');
  assert.deepEqual({ line: declaration.line, column: declaration.column, endLine: declaration.endLine, hash: declaration.hash }, {
    line: 2, column: lines[1].indexOf('function') + 1, endLine: 4, hash
  });
  assert.deepEqual(file(graph, 'main.mjs').symbols.find(symbol => symbol.name === 'café'), {
    name: 'café', kind: 'function', line: 2, column: lines[1].indexOf('café') + 1
  });
  const imported = edge(graph, 'main.mjs', 'file:value.mjs', 'import').evidence[0];
  assert.equal(imported.column, lines[0].indexOf('"./value.mjs"') + 1);
  const call = graph.symbolGraph.edges.find(item => item.from === 'symbol:main.mjs#caller' && item.to === 'symbol:main.mjs#café');
  assert.equal(call.evidence[0].line, 5);
  assert.equal(call.evidence[0].column, lines[4].indexOf('café()') + 1);
  const asset = edge(graph, 'public/index.html', 'file:main.mjs', 'asset').evidence[0];
  assert.equal(asset.line, 2);
  assert.equal(asset.column, 3, 'the astral character occupies two UTF-16 code units');
  assert.equal(graph.edges.length, 2, 'inline JavaScript remains outside HTML analysis');
  const warm = indexProject(root, { previous: graph });
  assert.equal(warm.revision, graph.revision);
  assert.deepEqual(warm.symbolGraph, graph.symbolGraph);
  assert.deepEqual(warm.edges, graph.edges);
  assert.equal(warm.stats.cachedFiles, 3);
});

test('an eligible wide array remains one readable text entry when symbol analysis reaches its AST budget', t => {
  const source = 'const values = [' + Array(150000).fill('0').join(',') + '];\n';
  assert.equal(Buffer.byteLength(source), 300018);
  assert.ok(Buffer.byteLength(source) < INDEX_LIMITS.fileBytes);
  const root = fixture(t, { 'wide.mjs': source });
  const graph = indexProject(root, { generic: true });
  const node = file(graph, 'wide.mjs');
  const hash = createHash('sha256').update(source).digest('hex');
  assert.ok(node);
  assert.equal(graph.stats.files, 1);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.inventory.status, 'complete');
  assert.deepEqual(graph.inventory.entries, [{ path: 'wide.mjs', state: 'text', bytes: 300018, hash }]);
  assert.equal(node.hash, hash);
  assert.equal(readIndexedSource(root, node, { generic: true }), source);
  assert.ok(graph.diagnostics.some(item => item.path === 'wide.mjs' && /budget exceeded;.*partial/.test(item.message)));
  assert.ok(!graph.diagnostics.some(item => /Cannot index file|call stack/.test(item.message)));
  write(root, 'wide.mjs', source + '// changed\n');
  assert.throws(() => readIndexedSource(root, node, { generic: true }), /changed/);
});

test('Python imports resolve only unique project-root modules and regular packages with source evidence', t => {
  const root = fixture(t, {
    'main.py': 'import helpers as h, pkg.worker\nfrom pkg import member\nfrom pkg.worker import work\nimport os\nimport fs\nimport namespace.worker\nimport src.custom\n',
    'helpers.py': 'def helper():\n    pass\n',
    'pkg/__init__.py': 'member = 1\n',
    'pkg/member.py': 'pass\n',
    'pkg/worker.py': 'def work():\n    pass\n',
    'namespace/worker.py': 'pass\n',
    'src/custom.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  for (const target of ['helpers.py', 'pkg/worker.py', 'pkg/__init__.py']) assert.ok(edge(graph, 'main.py', `file:${target}`, 'import'), target);
  assert.equal(edge(graph, 'main.py', 'file:pkg/worker.py', 'import').evidence.length, 2);
  assert.equal(edge(graph, 'main.py', 'file:helpers.py', 'import').evidence[0].line, 1);
  assert.match(edge(graph, 'main.py', 'file:helpers.py', 'import').evidence[0].snippet, /import helpers/);
  for (const target of ['pkg/member.py', 'namespace/worker.py', 'src/custom.py']) assert.ok(!edge(graph, 'main.py', `file:${target}`, 'import'), target);
  for (const name of ['os', 'fs', 'namespace.worker', 'src.custom']) {
    const relation = edge(graph, 'main.py', `external:python:${name}`, 'import');
    assert.ok(relation, name);
    assert.deepEqual(relation.layers, ['project']);
    assert.match(graph.nodes.find(node => node.id === relation.to).label, /external\/unresolved Python/);
  }
  assert.ok(!graph.nodes.some(node => node.layers.includes('security')));
  assert.ok(graph.diagnostics.some(item => item.path === 'main.py' && item.line === 7 && item.severity === 'info' && /project-root/.test(item.message)));
});

test('Python explicit relative imports respect contiguous regular packages and never guess members', t => {
  const root = fixture(t, {
    'pkg/__init__.py': 'pass\n',
    'pkg/sibling.py': 'pass\n',
    'pkg/sub/__init__.py': 'from . import leaf\n',
    'pkg/sub/main.py': 'from .leaf import value\nfrom ..sibling import value\nfrom . import leaf\nfrom ...outside import value\nfrom .missing import value\n',
    'pkg/sub/leaf.py': 'value = 1\n',
    'outside.py': 'pass\n',
    'lonely/main.py': 'from .leaf import value\n',
    'lonely/leaf.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  for (const target of ['pkg/sub/leaf.py', 'pkg/sibling.py', 'pkg/sub/__init__.py']) assert.ok(edge(graph, 'pkg/sub/main.py', `file:${target}`, 'import'), target);
  assert.ok(!edge(graph, 'pkg/sub/__init__.py', 'file:pkg/sub/__init__.py', 'import'));
  assert.ok(!edge(graph, 'pkg/sub/__init__.py', 'file:pkg/sub/leaf.py', 'import'));
  assert.ok(graph.diagnostics.some(item => item.path === 'pkg/sub/__init__.py' && item.severity === 'info' && /members remain ambiguous/.test(item.message)));
  assert.ok(!edge(graph, 'pkg/sub/main.py', 'file:outside.py', 'import'));
  assert.ok(!edge(graph, 'lonely/main.py', 'file:lonely/leaf.py', 'import'));
  for (const [name, line] of [['pkg/sub/main.py', 4], ['pkg/sub/main.py', 5], ['lonely/main.py', 1]]) assert.ok(graph.diagnostics.some(item => item.path === name && item.line === line && item.severity === 'warning'), `${name}:${line}`);
});

test('Python import candidates exclude absent, binary, unreadable, symlink and policy-excluded files', t => {
  const root = fixture(t, {
    'main.py': 'import missing\nimport binary\nimport linked\nimport blocked\nimport workspace.hidden\nimport hiddenpkg\n',
    'binary.py': Buffer.from([0, 1, 2]),
    'blocked.py': 'pass\n',
    'target.py': 'pass\n',
    'workspace/__init__.py': 'pass\n',
    'workspace/hidden.py': 'pass\n',
    'hiddenpkg/__init__.py': 'pass\n'
  });
  fs.symlinkSync(path.join(root, 'target.py'), path.join(root, 'linked.py'));
  const open = fs.openSync;
  fs.openSync = (name, ...args) => {
    if (name === path.join(root, 'blocked.py')) throw new Error('synthetic denied source');
    return open(name, ...args);
  };
  let graph;
  try { graph = indexProject(root, { excludePaths: ['hiddenpkg'] }); } finally { fs.openSync = open; }
  for (const name of ['missing', 'binary', 'linked', 'blocked', 'workspace.hidden', 'hiddenpkg']) assert.ok(edge(graph, 'main.py', `external:python:${name}`, 'import'), name);
  assert.equal(graph.status, 'partial');
  assert.ok(!graph.edges.some(relation => relation.from === 'file:main.py' && relation.to.startsWith('file:')));
});

test('Python module/package collision stays partial and malformed imports cannot traverse the root', t => {
  const root = fixture(t, {
    'main.py': 'import clash\nfrom pkg import clash\n',
    'clash.py': 'pass\n',
    'clash/__init__.py': 'pass\n',
    'pkg.py': 'pass\n',
    'pkg/__init__.py': 'pass\n',
    'malformed.py': 'from ../../outside import x\n',
    'outside.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.ok(!graph.edges.some(relation => relation.from === 'file:main.py'));
  assert.ok(!graph.edges.some(relation => relation.from === 'file:malformed.py'));
  assert.equal(graph.diagnostics.filter(item => item.path === 'main.py' && /module\/package collision/.test(item.message)).length, 2);
  assert.ok(graph.diagnostics.some(item => item.path === 'malformed.py' && ['error', 'warning'].includes(item.severity)));
});

test('Python import reconciliation re-resolves cached syntax when module targets appear or disappear', t => {
  const root = fixture(t, { 'main.py': 'import helper\n' });
  const initial = indexProject(root);
  assert.equal(initial.status, 'current');
  assert.ok(edge(initial, 'main.py', 'external:python:helper', 'import'));
  write(root, 'helper.py', 'def help():\n    pass\n');
  const warm = indexProject(root, { previous: initial });
  const cold = indexProject(root);
  assert.ok(warm.stats.cachedFiles > 0);
  assert.equal(warm.revision, cold.revision);
  assert.notEqual(warm.revision, initial.revision);
  assert.ok(edge(warm, 'main.py', 'file:helper.py', 'import'));
  fs.unlinkSync(path.join(root, 'helper.py'));
  const removed = indexProject(root, { previous: warm });
  assert.equal(removed.revision, initial.revision);
  assert.equal(removed.revision, indexProject(root).revision);
  assert.ok(edge(removed, 'main.py', 'external:python:helper', 'import'));
});

test('Python conventional test filenames and their import links share Testing without PASS or coverage claims', t => {
  const root = fixture(t, {
    'test_worker.py': 'import worker\n',
    'worker_test.py': 'import worker\n',
    'checks/test_extra.py': 'import worker\n',
    'worker.py': 'def helper():\n    pass\ndef work():\n    return helper()\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.equal(graph.stats.tests, 3);
  for (const name of ['test_worker.py', 'worker_test.py', 'checks/test_extra.py']) {
    assert.equal(file(graph, name).kind, 'test');
    assert.deepEqual(edge(graph, name, 'file:worker.py', 'import').layers, ['project', 'testing']);
  }
  assert.ok(file(graph, 'worker.py').layers.includes('testing'));
  assert.ok(graph.symbolGraph.edges.some(relation => relation.kind === 'call' && relation.from === 'symbol:worker.py#work' && relation.to === 'symbol:worker.py#helper'));
  assert.ok(!JSON.stringify(graph).includes('"coverage":'));
  assert.ok(!JSON.stringify(graph).includes('"passed":'));
});


test('Python cached import resolution also invalidates when regular-package ancestry changes', t => {
  const root = fixture(t, { 'main.py': 'import pkg.worker\n', 'pkg/worker.py': 'pass\n' });
  const missing = indexProject(root);
  assert.ok(edge(missing, 'main.py', 'external:python:pkg.worker', 'import'));
  write(root, 'pkg/__init__.py', 'pass\n');
  const packageGraph = indexProject(root, { previous: missing });
  assert.equal(packageGraph.revision, indexProject(root).revision);
  assert.ok(edge(packageGraph, 'main.py', 'file:pkg/worker.py', 'import'));
  fs.unlinkSync(path.join(root, 'pkg/__init__.py'));
  const removed = indexProject(root, { previous: packageGraph });
  assert.equal(removed.revision, missing.revision);
  assert.ok(edge(removed, 'main.py', 'external:python:pkg.worker', 'import'));
});

test('Python module self-imports retain evidence while empty containing-package self references stay informational', t => {
  const root = fixture(t, { 'main.py': 'import main\n', 'pkg/__init__.py': 'from . import member\n' });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.ok(edge(graph, 'main.py', 'file:main.py', 'import'));
  assert.ok(!edge(graph, 'pkg/__init__.py', 'file:pkg/__init__.py', 'import'));
  assert.ok(graph.diagnostics.some(item => item.path === 'pkg/__init__.py' && item.line === 1 && item.severity === 'info' && /members remain ambiguous/.test(item.message)));
});

test('Python module lookup NFKC-normalizes identifiers while preserving raw import evidence', t => {
  const root = fixture(t, {
    'main.py': 'import K\nimport 𝓅𝓀𝓰.𝓂\nfrom 𝓅𝓀𝓰.𝓂 import value\n',
    'K.py': 'pass\n',
    'pkg/__init__.py': 'pass\n',
    'pkg/m.py': 'value = 1\n',
    'pkg/main.py': 'from .𝓂 import value\n',
    'pkg/sub/__init__.py': 'pass\n',
    'pkg/sub/main.py': 'from ..𝓂 import value\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  const kelvin = edge(graph, 'main.py', 'file:K.py', 'import');
  assert.ok(kelvin);
  assert.match(kelvin.evidence[0].snippet, /import K/);
  const dotted = edge(graph, 'main.py', 'file:pkg/m.py', 'import');
  assert.equal(dotted.evidence.length, 2);
  assert.match(dotted.evidence[0].snippet, /𝓅𝓀𝓰\.𝓂/);
  for (const source of ['pkg/main.py', 'pkg/sub/main.py']) assert.ok(edge(graph, source, 'file:pkg/m.py', 'import'), source);
});

test('Python module lookup never normalizes filesystem paths to invent Unicode aliases', t => {
  const root = fixture(t, {
    'main.py': 'import K\nimport 𝓅𝓀𝓰.𝓂\nimport plain.𝓂\n',
    'K.py': 'pass\n',
    '𝓅𝓀𝓰/__init__.py': 'pass\n',
    '𝓅𝓀𝓰/𝓂.py': 'pass\n',
    'plain/__init__.py': 'pass\n',
    'plain/𝓂.py': 'pass\n',
    'plain/main.py': 'from .𝓂 import value\n',
    'plain/sub/__init__.py': 'pass\n',
    'plain/sub/main.py': 'from ..𝓂 import value\n'
  });
  const graph = indexProject(root);
  for (const specifier of ['K', '𝓅𝓀𝓰.𝓂', 'plain.𝓂']) assert.ok(edge(graph, 'main.py', `external:python:${specifier.normalize('NFKC')}`, 'import'), specifier);
  for (const source of ['main.py', 'plain/main.py', 'plain/sub/main.py']) assert.ok(!graph.edges.some(relation => relation.from === `file:${source}` && relation.to.startsWith('file:')), source);
  for (const source of ['plain/main.py', 'plain/sub/main.py']) assert.ok(graph.diagnostics.some(item => item.path === source && item.severity === 'warning' && /Unresolved local Python module/.test(item.message)), source);
  assert.equal(graph.status, 'partial');
});

test('Python internal namespace directories resolve below a known regular-package anchor like the Flask layout', t => {
  const root = fixture(t, {
    'main.py': 'import flask.sansio.app\n',
    'src/flask/__init__.py': 'pass\n',
    'src/flask/app.py': 'from .sansio.app import App\nfrom .sansio.scaffold import Scaffold\n',
    'src/flask/config.py': 'value = 1\n',
    'src/flask/sansio/app.py': 'from .scaffold import Scaffold\nfrom ..config import value\n',
    'src/flask/sansio/scaffold.py': 'class Scaffold:\n    pass\n',
    'flask/__init__.py': 'pass\n',
    'flask/sansio/app.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  for (const [source, target] of [
    ['main.py', 'flask/sansio/app.py'],
    ['src/flask/app.py', 'src/flask/sansio/app.py'],
    ['src/flask/app.py', 'src/flask/sansio/scaffold.py'],
    ['src/flask/sansio/app.py', 'src/flask/sansio/scaffold.py'],
    ['src/flask/sansio/app.py', 'src/flask/config.py']
  ]) assert.ok(edge(graph, source, `file:${target}`, 'import'), `${source} -> ${target}`);
  assert.ok(!edge(graph, 'main.py', 'file:src/flask/sansio/app.py', 'import'));
});

test('Python namespace-only modules retain info without inventing initializer or member edges', t => {
  const root = fixture(t, {
    'main.py': 'import pkg.ns\nfrom pkg.ns import child\n',
    'pkg/__init__.py': 'from .ns import child\n',
    'pkg/ns/main.py': 'from . import child\n',
    'pkg/ns/child.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.equal(graph.edges.length, 0);
  for (const source of ['main.py', 'pkg/__init__.py', 'pkg/ns/main.py']) assert.ok(graph.diagnostics.some(item => item.path === source && item.severity === 'info' && /namespace module has no source file/.test(item.message)), source);
  assert.ok(!graph.nodes.some(node => node.id === 'file:pkg/ns/__init__.py'));
});

test('Python namespace traversal requires a regular anchor and keeps missing and over-anchor relatives partial', t => {
  const root = fixture(t, {
    'main.py': 'import ns.worker\nimport src.pkg.worker\n',
    'ns/worker.py': 'pass\n',
    'src/pkg/__init__.py': 'pass\n',
    'src/pkg/worker.py': 'pass\n',
    'pkg/__init__.py': 'pass\n',
    'pkg/ns/main.py': 'from .missing import value\nfrom ...outside import value\nfrom ..missingns import value\n',
    'outside.py': 'pass\n',
    'ns/main.py': 'from .worker import value\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  for (const name of ['ns.worker', 'src.pkg.worker']) assert.ok(edge(graph, 'main.py', `external:python:${name}`, 'import'));
  assert.ok(!graph.edges.some(relation => ['file:pkg/ns/main.py', 'file:ns/main.py'].includes(relation.from)));
  for (const line of [1, 2, 3]) assert.ok(graph.diagnostics.some(item => item.path === 'pkg/ns/main.py' && item.line === line && item.severity === 'warning'), line);
  assert.ok(graph.diagnostics.some(item => item.path === 'ns/main.py' && item.severity === 'warning'));
});

test('Python module files block internal namespace traversal and intermediate package collisions stay explicit', t => {
  const root = fixture(t, {
    'main.py': 'import pkg.ns.child\nimport pkg.clash.child\n',
    'pkg/__init__.py': 'from .ns.child import value\nfrom .clash.child import value\n',
    'pkg/ns.py': 'pass\n',
    'pkg/ns/child.py': 'pass\n',
    'pkg/clash.py': 'pass\n',
    'pkg/clash/__init__.py': 'pass\n',
    'pkg/clash/child.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.edges.length, 0);
  for (const source of ['main.py', 'pkg/__init__.py']) {
    assert.ok(graph.diagnostics.some(item => item.path === source && item.line === 1 && /blocks package traversal/.test(item.message) && item.severity === 'warning'));
    assert.ok(graph.diagnostics.some(item => item.path === source && item.line === 2 && /module\/package collision/.test(item.message) && item.severity === 'warning'));
  }
});

test('Python explicit project-root initializer anchors bounded relative namespace imports', t => {
  const root = fixture(t, {
    '__init__.py': 'from .sub.worker import value\n',
    'config.py': 'value = 1\n',
    'sub/worker.py': 'from ..config import value\nfrom . import other\n',
    'sub/other.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.ok(edge(graph, '__init__.py', 'file:sub/worker.py', 'import'));
  assert.ok(edge(graph, 'sub/worker.py', 'file:config.py', 'import'));
  assert.ok(!edge(graph, 'sub/worker.py', 'file:sub/other.py', 'import'));
  assert.ok(graph.diagnostics.some(item => item.path === 'sub/worker.py' && item.line === 2 && /namespace module has no source file/.test(item.message)));
  write(root, 'sub/worker.py', 'from ...outside import value\n');
  const escaped = indexProject(root, { previous: graph });
  assert.equal(escaped.status, 'partial');
  assert.ok(escaped.diagnostics.some(item => item.path === 'sub/worker.py' && /leaves the indexed regular package/.test(item.message) && item.severity === 'warning'));
});

test('Python cached namespace resolution follows descendant, blocker and initializer transitions', t => {
  const root = fixture(t, { 'pkg/__init__.py': 'from .ns import value\n' });
  const missing = indexProject(root);
  assert.equal(missing.status, 'partial');
  write(root, 'pkg/ns/child.py', 'pass\n');
  const namespace = indexProject(root, { previous: missing });
  assert.equal(namespace.status, 'current');
  assert.equal(namespace.edges.length, 0);
  assert.equal(namespace.revision, indexProject(root).revision);
  write(root, 'pkg/ns/__init__.py', 'pass\n');
  const regular = indexProject(root, { previous: namespace });
  assert.ok(edge(regular, 'pkg/__init__.py', 'file:pkg/ns/__init__.py', 'import'));
  assert.equal(regular.revision, indexProject(root).revision);
  write(root, 'pkg/ns.py', 'pass\n');
  const collision = indexProject(root, { previous: regular });
  assert.equal(collision.status, 'partial');
  assert.equal(collision.revision, indexProject(root).revision);
  assert.equal(collision.edges.length, 0);
  fs.unlinkSync(path.join(root, 'pkg/ns.py'));
  fs.unlinkSync(path.join(root, 'pkg/ns/__init__.py'));
  fs.unlinkSync(path.join(root, 'pkg/ns/child.py'));
  const removed = indexProject(root, { previous: collision });
  assert.equal(removed.revision, missing.revision);
});

test('Python private import modules resolve effective class identities and retain raw source evidence', t => {
  const root = fixture(t, {
    'main.py': 'class A:\n    import __dep\nclass B:\n    import __dep\nclass Box:\n    import __dep as __alias\n    from __pkg import __member as __alias\n    import __raw.child as __alias\n    from pkg.__raw import __member\n',
    '__dep.py': 'pass\n',
    '_A__dep.py': 'pass\n',
    '_B__dep.py': 'pass\n',
    '_Box__dep.py': 'pass\n',
    '__pkg/__init__.py': 'pass\n',
    '_Box__pkg/__init__.py': 'pass\n',
    '_Box__pkg/__member.py': 'pass\n',
    '__raw/__init__.py': 'pass\n',
    '__raw/child.py': 'pass\n',
    '_Box__raw/__init__.py': 'pass\n',
    '_Box__raw/child.py': 'pass\n',
    'pkg/__init__.py': 'pass\n',
    'pkg/__raw.py': 'pass\n',
    'pkg/_Box__raw.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  const vector = graph.edges.filter(relation => relation.from === 'file:main.py').map(relation => ({
    target: relation.to, evidence: relation.evidence.map(({ path, line, column, snippet }) => ({ path, line, column, snippet }))
  })).sort((a, b) => a.target.localeCompare(b.target, 'en'));
  const expected = [
    ['_A__dep.py', 2, 12, 'import __dep'],
    ['_B__dep.py', 4, 12, 'import __dep'],
    ['_Box__dep.py', 6, 12, 'import __dep as __alias'],
    ['_Box__pkg/__init__.py', 7, 5, 'from __pkg import __member as __alias'],
    ['__raw/child.py', 8, 12, 'import __raw.child as __alias'],
    ['pkg/__raw.py', 9, 5, 'from pkg.__raw import __member']
  ].map(([target, line, column, snippet]) => ({ target: `file:${target}`, evidence: [{ path: 'main.py', line, column, snippet }] })).sort((a, b) => a.target.localeCompare(b.target, 'en'));
  assert.deepEqual(vector, expected);
  for (const target of ['__dep.py', '__pkg/__init__.py', '_Box__pkg/__member.py', '_Box__raw/child.py', 'pkg/_Box__raw.py']) assert.ok(!edge(graph, 'main.py', `file:${target}`, 'import'), target);
});

test('Python private relative from-modules keep package boundaries and never guess member or alias files', t => {
  const root = fixture(t, {
    'pkg/__init__.py': 'pass\n',
    'pkg/main.py': 'class Box:\n    from .__dep import item as __alias\n    from .__raw.child import member\n    from . import __member as __alias\n',
    'pkg/__dep.py': 'pass\n',
    'pkg/_Box__dep.py': 'pass\n',
    'pkg/__alias.py': 'pass\n',
    'pkg/__member.py': 'pass\n',
    'pkg/__raw/__init__.py': 'pass\n',
    'pkg/__raw/child.py': 'pass\n',
    'pkg/_Box__raw/__init__.py': 'pass\n',
    'pkg/_Box__raw/child.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.deepEqual(graph.edges.map(relation => relation.to).sort(), ['file:pkg/_Box__dep.py', 'file:pkg/__init__.py', 'file:pkg/__raw/child.py'].sort());
  assert.deepEqual(edge(graph, 'pkg/main.py', 'file:pkg/_Box__dep.py', 'import').evidence, [{ path: 'pkg/main.py', line: 2, column: 5, snippet: 'from .__dep import item as __alias' }]);
  for (const target of ['pkg/__dep.py', 'pkg/__alias.py', 'pkg/__member.py', 'pkg/_Box__raw/child.py']) assert.ok(!edge(graph, 'pkg/main.py', `file:${target}`, 'import'));
});

test('Python unresolved private imports keep distinct effective class identities and raw evidence', t => {
  const root = fixture(t, { 'main.py': 'class A:\n    import __dep\nclass B:\n    import __dep\nimport K\n' });
  const graph = indexProject(root);
  assert.equal(graph.status, 'current');
  assert.deepEqual(graph.edges.map(relation => ({ target: relation.to, evidence: relation.evidence })).sort((a, b) => a.target.localeCompare(b.target, 'en')), [
    { target: 'external:python:_A__dep', evidence: [{ path: 'main.py', line: 2, column: 12, snippet: 'import __dep' }] },
    { target: 'external:python:_B__dep', evidence: [{ path: 'main.py', line: 4, column: 12, snippet: 'import __dep' }] },
    { target: 'external:python:K', evidence: [{ path: 'main.py', line: 5, column: 8, snippet: 'import K' }] }
  ].sort((a, b) => a.target.localeCompare(b.target, 'en')));
  assert.ok(!graph.nodes.some(node => node.id === 'external:python:__dep'));
});

test('Python effective private module collisions cannot fall back to a unique raw candidate', t => {
  const root = fixture(t, {
    'main.py': 'class Box:\n    import __dep\n',
    '__dep.py': 'pass\n',
    '_Box__dep.py': 'pass\n',
    '_Box__dep/__init__.py': 'pass\n'
  });
  const graph = indexProject(root);
  assert.equal(graph.status, 'partial');
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.diagnostics.some(item => item.path === 'main.py' && item.line === 2 && item.severity === 'warning' && /module\/package collision/.test(item.message)));
});


test('Python adapter lookup metadata rejects invalid present values without falling back to raw module', async t => {
  // Exercise the real index through its existing text-adapter seam. This trusted
  // runtime copy injects only reference metadata, never executes scanned files,
  // and avoids adding a public resolver API just for invalid producer output.
  const runtime = fixture(t, {
    'code-index.mjs': fs.readFileSync(new URL('../code-index.mjs', import.meta.url)),
    'typed-analysis.mjs': fs.readFileSync(new URL('../typed-analysis.mjs', import.meta.url)),
    'source-analysis.mjs': `export const securityModule = () => false;
export function analyzeSource(relative, source) {
  return { references: relative === 'main.py' ? [{ kind: 'import', specifier: 'raw', evidence: { path: relative, line: 1, column: 1, snippet: 'import raw' }, python: JSON.parse(source) }] : [], symbols: [], security: [], diagnostics: [] };
}
`
  });
  fs.symlinkSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
  const { indexProject: injectedIndex } = await import(pathToFileURL(path.join(runtime, 'code-index.mjs')).href);
  const root = fixture(t, { 'main.py': '', 'raw.py': 'pass\n', '_Box__raw.py': 'pass\n' });
  const metadata = { level: 0, module: 'raw', names: [{ name: 'raw' }], form: 'import' };
  for (const lookupModule of [null, false, 7, '', '../raw', '/raw', 'raw/child', 'raw..child', 'raw.／child']) {
    write(root, 'main.py', JSON.stringify({ ...metadata, lookupModule }));
    const graph = injectedIndex(root);
    assert.equal(graph.status, 'partial', JSON.stringify(lookupModule));
    assert.equal(graph.edges.length, 0, JSON.stringify(lookupModule));
    assert.ok(graph.diagnostics.some(item => item.path === 'main.py' && item.severity === 'warning' && /Malformed Python module reference/.test(item.message)), JSON.stringify(lookupModule));
  }
  write(root, 'main.py', JSON.stringify(metadata));
  assert.ok(edge(injectedIndex(root), 'main.py', 'file:raw.py', 'import'), 'absent metadata preserves raw lookup');
  write(root, 'main.py', JSON.stringify({ ...metadata, lookupModule: '_Box__raw' }));
  const effective = injectedIndex(root);
  assert.equal(effective.status, 'current');
  assert.ok(edge(effective, 'main.py', 'file:_Box__raw.py', 'import'));
  assert.ok(!edge(effective, 'main.py', 'file:raw.py', 'import'));
});
