import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { indexProject, readIndexedSource } from '../code-index.mjs';
import { attachOverview } from '../project-map.mjs';
import { freshContext } from '../graph-context.mjs';
import { LiveIndex } from '../live-index.mjs';
import { createVisualizer, sourceExcerpt } from '../server.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r06-integration-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.mjs'), 'export const publicValue = 1;\n');
  fs.writeFileSync(path.join(root, 'private.mjs'), 'export const withheldSentinel = "R06_WITHHELD_SOURCE";\n');
  return root;
}
const block = (id, label, files) => ({ id, label, files, aliases: [], prefixes: [], type: 'module', group: 'core', description: '' });

test('excluded naming members are removed from raw and derived graph metadata; eligible map text stays unredacted', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.gitignore'), 'private.mjs\n');
  const map = { schemaVersion: 1, blocks: [block('public', 'Public module', ['main.mjs']), block('private', 'R06_PRIVATE_LABEL', ['private.mjs']), block('protected', 'R06_PROTECTED_LABEL', ['credentials.mjs'])], parts: [{ target: 'symbol:private.mjs#withheldSentinel', label: 'R06_PRIVATE_PART', description: '', aliases: [] }] };
  fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify(map));
  const raw = indexProject(root);
  for (const marker of ['R06_PRIVATE_LABEL', 'R06_PROTECTED_LABEL', 'R06_PRIVATE_PART', 'R06_WITHHELD_SOURCE']) assert(!JSON.stringify(raw).includes(marker), marker);
  const graph = attachOverview(raw);
  assert(graph.overview.nodes.some(node => node.label === 'Public module'));
  assert(!JSON.stringify(graph).includes('R06_PRIVATE_LABEL'));
  assert(!graph.diagnostics.some(d => d.message.includes('private.mjs') && d.message.includes('missing')));
  const mapSource = sourceExcerpt(root, graph, 'project-map.json');
  assert(mapSource.lines.some(line => line.text.includes('R06_PRIVATE_LABEL')));
  assert.equal(mapSource.policyId, graph.inputPolicy.id);
  assert.equal(mapSource.revision, graph.revision);
});

test('invalid naming metadata never echoes excluded labels in validation diagnostics', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify({ schemaVersion: 1, blocks: [block('a', 'R06_PRIVATE_LABEL', ['credentials.mjs']), block('b', 'R06_PRIVATE_LABEL', ['main.mjs'])] }));
  const graph = attachOverview(indexProject(root));
  assert.equal(graph.status, 'partial');
  assert.equal(graph.metadata.configuration, null);
  assert(!JSON.stringify(graph).includes('R06_PRIVATE_LABEL'));
  assert(graph.diagnostics.some(d => d.code === 'INVALID_NAMING_METADATA'));
});

test('ignore-only changes invalidate legacy context, bounded cursor and direct source nodes', t => {
  const root = fixture(t);
  const ignore = path.join(root, '.gitignore');
  fs.writeFileSync(ignore, '# alpha\n');
  const first = freshContext(root, 'main.mjs');
  const bounded = freshContext(root, 'main.mjs', {}, { profile: 'agent', section: 'scope', maxBytes: 10000 });
  const node = indexProject(root).nodes.find(node => node.path === 'main.mjs');
  const stat = fs.statSync(ignore);
  fs.writeFileSync(ignore, '# bravo\n'); fs.utimesSync(ignore, stat.atime, stat.mtime);
  const second = freshContext(root, 'main.mjs');
  assert.notEqual(second.inputPolicy.id, first.inputPolicy.id);
  assert.notEqual(second.revision, first.revision);
  assert.throws(() => freshContext(root, 'main.mjs', { expectedRevision: first.revision }), { code: 'STALE_REVISION' });
  assert.throws(() => readIndexedSource(root, node), /policy|Policy/);
  assert.notEqual(freshContext(root, 'main.mjs', {}, { profile: 'agent' }).snapshot, bounded.snapshot);
  assert.equal(readIndexedSource(root, indexProject(root).nodes.find(node => node.path === 'main.mjs')), 'export const publicValue = 1;\n');
});

test('observed policy change followed by refresh failure drops last-good source and history', t => {
  const root = fixture(t);
  let fail = false;
  const live = new LiveIndex(root, { intervalMs: 60000, indexer: (directory, options) => { if (fail) throw new Error('synthetic index failure'); return indexProject(directory, options); } });
  t.after(() => live.close());
  assert(JSON.stringify(live.snapshot()).includes('withheldSentinel'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'private.mjs\n');
  fail = true;
  const emitted = []; live.on('state', state => emitted.push(state));
  const withheld = live.refresh();
  assert.equal(withheld.runtime.status, 'error');
  assert.equal(withheld.nodes.length, 0);
  assert.equal(withheld.metadata, null);
  assert.deepEqual(withheld.runtime.changes, []);
  assert(!JSON.stringify(emitted).includes('withheldSentinel'));
  fail = false;
  const recovered = live.refresh();
  assert.equal(recovered.runtime.status, 'current');
  assert(recovered.nodes.some(n => n.path === 'main.mjs'));
  assert(!recovered.nodes.some(n => n.path === 'private.mjs'));
});

test('HTTP graph/source/SSE reject old policy without waiting for the polling interval and recover safely', async t => {
  const root = fixture(t);
  const app = createVisualizer({ root, intervalMs: 60000 });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const first = await (await fetch(`${base}/api/graph`)).json();
  const sourceUrl = `${base}/api/source?path=private.mjs&policyId=${first.inputPolicy.id}&revision=${first.revision}`;
  assert.equal((await fetch(sourceUrl)).status, 200);
  fs.writeFileSync(path.join(root, '.gitignore'), 'private.mjs\n');
  assert.equal((await fetch(sourceUrl)).status, 409);
  const filtered = await (await fetch(`${base}/api/graph`)).json();
  assert.notEqual(filtered.inputPolicy.id, first.inputPolicy.id);
  assert(!JSON.stringify(filtered).includes('withheldSentinel'));
  assert.equal((await fetch(`${base}/api/source?path=main.mjs&policyId=${first.inputPolicy.id}&revision=${first.revision}`)).status, 409);
  const valid = await (await fetch(`${base}/api/source?path=main.mjs&policyId=${filtered.inputPolicy.id}&revision=${filtered.revision}`)).json();
  assert.equal(valid.policyId, filtered.inputPolicy.id);
  fs.writeFileSync(path.join(root, '.gitignore'), '**R06_RAW_POLICY_MUST_NOT_ECHO\n');
  const invalid = await (await fetch(`${base}/api/graph`)).json();
  assert.equal(invalid.inputPolicy.status, 'invalid'); assert.deepEqual(invalid.nodes, []);
  assert(!JSON.stringify(invalid).includes('R06_RAW_POLICY_MUST_NOT_ECHO'));
  assert.equal((await fetch(`${base}/api/source?path=main.mjs`)).status, 409);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  try {
    const { value } = await reader.read(); const frame = new TextDecoder().decode(value);
    assert(frame.startsWith('event: state\n'));
    const snapshot = JSON.parse(frame.split('data: ')[1].split('\n\n')[0]);
    assert.equal(snapshot.inputPolicy.status, 'invalid'); assert.deepEqual(snapshot.nodes, []);
    assert(!frame.includes('withheldSentinel')); assert(!frame.includes('R06_RAW_POLICY_MUST_NOT_ECHO'));
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
  fs.writeFileSync(path.join(root, '.gitignore'), '# recovered\n');
  const restored = await (await fetch(`${base}/api/graph`)).json();
  assert.equal(restored.inputPolicy.status, 'valid'); assert(restored.nodes.some(n => n.path === 'private.mjs'));
  assert.equal((await fetch(sourceUrl)).status, 409);
});
