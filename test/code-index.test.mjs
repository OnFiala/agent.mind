import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  const root = fixture(t, { 'src/value.ts': 'export const typed: number = 1;', 'a.mjs': 'export const value = 1;' });
  const graph = indexProject(root, { generic: true });
  assert.equal(graph.status, 'partial');
  assert.deepEqual(graph.scope.unsupported, ['src/value.ts']);
  assert.ok(graph.diagnostics.some(item => item.path === 'src/value.ts' && item.message.includes('Unsupported source')));
  const other = fixture(t, { 'a.mjs': 'export const value = 2;' });
  const second = indexProject(other, { previous: graph, generic: true });
  assert.equal(second.stats.cachedFiles, 0);
  assert.notEqual(file(graph, 'a.mjs').hash, file(second, 'a.mjs').hash);
});
