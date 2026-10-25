import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { LiveIndex } from '../live-index.mjs';
import { createVisualizer, sourceExcerpt } from '../server.mjs';
import { freshContext } from '../graph-context.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-visualizer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.mjs'), "import { value } from './value.mjs';\nexport const result = value;\n");
  fs.writeFileSync(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  fs.mkdirSync(path.join(root, 'workspace'));
  fs.writeFileSync(path.join(root, 'workspace', 'project.mind'), 'preserve exact existing state');
  fs.writeFileSync(path.join(root, '.env'), 'PRIVATE=must-not-read');
  return root;
}

test('live reconciliation handles add, edit, delete and parse failure without stale edges', t => {
  const root = fixture(t);
  const live = new LiveIndex(root, { intervalMs: 60000 });
  t.after(() => live.close());
  const original = live.graph.revision;
  fs.writeFileSync(path.join(root, 'next.mjs'), "import './main.mjs';\n");
  const added = live.refresh();
  assert.notEqual(added.revision, original);
  assert(added.edges.some(e => e.from === 'file:next.mjs' && e.to === 'file:main.mjs'));
  assert(added.runtime.changes.some(c => c.path === 'next.mjs' && c.kind === 'added'));
  fs.writeFileSync(path.join(root, 'next.mjs'), 'import {');
  const broken = live.refresh();
  assert.equal(broken.status, 'partial');
  assert(!broken.edges.some(e => e.from === 'file:next.mjs'));
  assert(broken.diagnostics.some(d => d.path === 'next.mjs'));
  fs.unlinkSync(path.join(root, 'next.mjs'));
  const deleted = live.refresh();
  assert(!deleted.nodes.some(n => n.path === 'next.mjs'));
  assert(deleted.runtime.changes.some(c => c.kind === 'deleted'));
  assert.equal(deleted.status, 'current');
  assert.equal(fs.readFileSync(path.join(root, 'workspace/project.mind'), 'utf8'), 'preserve exact existing state');
});

test('unstable snapshot is never published as current and later recovers', t => {
  let revision = 0;
  let unstable = false;
  const indexer = () => ({ revision: String(unstable ? revision++ : revision), nodes: [], edges: [], status: 'current' });
  const live = new LiveIndex('.', { intervalMs: 60000, indexer });
  t.after(() => live.close());
  unstable = true;
  const failed = live.refresh();
  assert.equal(failed.revision, '0');
  assert.equal(failed.runtime.status, 'error');
  unstable = false;
  assert.equal(live.refresh().runtime.status, 'current');
});

test('context includes reverse dependencies, source hash, exclusions and diagnostics', t => {
  const root = fixture(t);
  const context = freshContext(root, 'value.mjs');
  assert(context.nodes.some(n => n.path === 'main.mjs'));
  assert(context.nodes.every(n => !n.path || n.hash));
  assert(context.scope.excluded.some(p => p.startsWith('workspace')));
  assert.match(context.revision, /^[a-f0-9]{64}$/);
  assert.throws(() => freshContext(root, '.env'));
});

test('source excerpt enforces inventory, content hash, symlinks and bounded lines', t => {
  const root = fixture(t);
  const live = new LiveIndex(root, { intervalMs: 60000 });
  t.after(() => live.close());
  const excerpt = sourceExcerpt(root, live.graph, 'main.mjs');
  assert.equal(excerpt.lines[0].number, 1);
  for (const target of ['.env', '../outside', 'workspace/project.mind']) assert.throws(() => sourceExcerpt(root, live.graph, target));
  fs.writeFileSync(path.join(root, 'main.mjs'), 'changed');
  assert.throws(() => sourceExcerpt(root, live.graph, 'main.mjs'), /changed/);
  fs.unlinkSync(path.join(root, 'value.mjs'));
  fs.symlinkSync(path.join(root, '.env'), path.join(root, 'value.mjs'));
  assert.throws(() => sourceExcerpt(root, live.graph, 'value.mjs'), /links/);
});

test('HTTP serves read-only graph, rejects old controls and foreign origins; SSE receives updates', async t => {
  const root = fixture(t);
  const app = createVisualizer({ root, intervalMs: 40 });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const abort = new AbortController();
  t.after(() => { abort.abort(); app.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const graph = await (await fetch(`${base}/api/graph`)).json();
  assert(graph.nodes.some(n => n.path === 'main.mjs'));
  assert(!graph.nodes.some(n => n.path === '.env'));
  for (const route of ['/api/build', '/api/requirements', '/api/agent/run', '/api/native/next']) {
    assert.equal((await fetch(base + route, { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + route)).status, 404);
  }
  assert.equal((await fetch(`${base}/api/graph`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => { const request = http.get(`${base}/api/graph`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(foreignHost, 403);
  const malformed = await new Promise((resolve, reject) => { const request = http.get({ hostname: '127.0.0.1', port: app.server.address().port, path: '//' }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(malformed, 400);
  assert.equal((await fetch(`${base}/api/graph`)).status, 200);
  assert.equal((await fetch(`${base}/api/source?path=.env`)).status, 409);
  const stream = await fetch(`${base}/api/events`, { signal: abort.signal });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: state/);
  fs.writeFileSync(path.join(root, 'added.mjs'), "import './value.mjs';\n");
  let text = '';
  const deadline = setTimeout(() => abort.abort(), 5000);
  try {
    while (!text.includes('file:added.mjs')) text += decoder.decode((await reader.read()).value);
    assert.match(text, /file:added.mjs/);
  } finally { clearTimeout(deadline); await reader.cancel(); }
  assert.equal(fs.readFileSync(path.join(root, 'workspace/project.mind'), 'utf8'), 'preserve exact existing state');
});

test('installed HTTP uses explicit scope and rejects invalidated project binding', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'agent.mind'));
  fs.writeFileSync(path.join(root, 'agent.mind/project-map.json'), '{"schemaVersion":1,"blocks":[]}');
  fs.writeFileSync(path.join(root, 'workspace/source.mjs'), 'export const validTargetSource = true;');
  let active = true;
  const binding = { id: 'test-project-binding', generation: 1, verify() { if (!active) throw new Error('detached'); } };
  const app = createVisualizer({ root, indexOptions: { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' }, binding });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const graph = await (await fetch(`${base}/api/graph`)).json();
  assert.equal(graph.binding.id, binding.id);
  assert(!Object.hasOwn(graph.binding, 'verify'));
  assert(graph.nodes.some(node => node.path === 'workspace/source.mjs'));
  assert(!graph.nodes.some(node => node.path?.startsWith('agent.mind/')));
  assert.equal((await fetch(`${base}/api/source?path=workspace/source.mjs`)).status, 200);
  const context = await (await fetch(`${base}/api/context?path=workspace/source.mjs`)).json();
  assert.equal(context.binding.id, binding.id);
  assert.equal(context.revision, graph.revision);
  active = false;
  for (const route of ['/api/graph', '/api/context', '/api/source?path=main.mjs', '/api/events']) assert.equal((await fetch(base + route)).status, 409);
});
