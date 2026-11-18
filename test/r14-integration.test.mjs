import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { indexProject, readIndexedSource, INDEX_LIMITS } from '../code-index.mjs';
import { freshContext, projectContext, contextCursor } from '../graph-context.mjs';
import { LiveIndex } from '../live-index.mjs';
import { createVisualizer } from '../server.mjs';

const config = '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}';
const options = { generic: true, resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
const node = (g, p = 'main.ts') => g.nodes.find(n => n.path === p);
const localEdges = g => g.edges.filter(e => e.provenance === 'typed-local-resolution');
const outcomes = g => node(g).referenceResolution.outcomes;
function fixture(t, files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r14-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  for (const [p, text] of Object.entries({ 'tsconfig.json': config, 'main.ts': 'import type {Value} from "./value";\nimport "./value";', 'value.ts': 'export interface Value {}', ...files })) write(p, text);
  return { root, write };
}

test('V01/V04 default stays syntax-only; opt-in keeps full occurrences, stable identities and global partial', t => {
  const { root } = fixture(t);
  const plain = indexProject(root, { generic: true }), resolved = indexProject(root, options);
  assert.equal(plain.resolver, undefined); assert.equal(node(plain).referenceResolution, undefined); assert.deepEqual(plain.edges, []);
  assert.deepEqual(node(plain).referenceSyntax, node(resolved).referenceSyntax);
  assert.deepEqual(plain.nodes.map(n => n.id), resolved.nodes.map(n => n.id));
  assert.deepEqual(plain.symbolGraph, resolved.symbolGraph);
  assert.notEqual(plain.revision, resolved.revision);
  assert.equal(resolved.status, 'partial'); assert.equal(resolved.inventory.enumeration.complete, true);
  assert.equal(localEdges(resolved).length, 1); assert.deepEqual(outcomes(resolved).map(o => o.status), ['resolved', 'resolved']);
  const edge = localEdges(resolved)[0]; assert.equal(edge.certainty, 'model-relative'); assert.equal(edge.resolverId, resolved.resolver.id);
  assert.deepEqual(edge.evidence.map(e => e.typed.typeOnly), [true, false]);
  assert.equal(edge.evidence[0].hash, node(resolved).hash); assert.equal(edge.evidence[0].declarationRange.start, 0);
  assert.deepEqual(edge.layers, ['project']); assert.equal(resolved.nodes.some(n => n.kind === 'external'), false);
  assert.equal(node(resolved).security.length, 0); assert.equal(node(resolved).referenceSyntax.resolution.status, 'unsupported');
  assert.equal(readIndexedSource(root, node(resolved), options).startsWith('import type'), true);
  assert.throws(() => readIndexedSource(root, node(resolved), { generic: true }), /Resolver mode/);
  assert.throws(() => readIndexedSource(root, node(plain), options), /Resolver mode/);
});

test('V01 zero-edge graphs and invalid policy remain mode-specific without config discovery', t => {
  const { root, write } = fixture(t, { 'main.ts': 'export const a=1;' });
  const plain = indexProject(root, { generic: true }), opt = indexProject(root, options);
  assert.deepEqual(opt.edges, []); assert.notEqual(opt.revision, plain.revision);
  write('.gitignore', 'bad/**\n');
  const a = indexProject(root, { generic: true }), b = indexProject(root, options);
  assert.equal(b.resolver.status, 'invalid'); assert.deepEqual(b.nodes, []); assert.notEqual(a.revision, b.revision);
});

test('V05/V06 complete candidate/veto evidence distinguishes collision, absence and package veto', t => {
  const { root, write } = fixture(t, { 'main.ts': 'import "./dot.gen"; import "./folder"; import "./missing";', 'dot.gen.ts': 'export{}', 'folder/index.tsx': 'export const X=()=> <div/>;' });
  let g = indexProject(root, options); assert.deepEqual(outcomes(g).map(o => o.status), ['resolved', 'resolved', 'unresolved']);
  assert.equal(outcomes(g)[0].candidates.length, 10); assert.equal(outcomes(g)[0].vetoes.length, 12);
  write('dot.gen.js', 'export{}'); g = indexProject(root, { ...options, previous: g });
  assert.equal(outcomes(g)[0].status, 'ambiguous'); assert.equal(outcomes(g)[0].candidates.filter(c => c.state === 'eligible').length, 2);
  write('folder/package.json', '{"main":"not-executed.js","exports":"not-executed.js"}');
  g = indexProject(root, { ...options, previous: g }); assert.equal(outcomes(g)[1].status, 'blocked'); assert(outcomes(g)[1].reasons.includes('veto-witness'));
  assert.equal(outcomes(g)[1].vetoes.find(v => v.path === 'folder/package.json').state, 'present');
});

test('V07 policy-denied absent siblings, ancestors and raw traversals never count as absence or cause denied reads', t => {
  const { root, write } = fixture(t, { 'main.ts': 'import "./value"; import "./hidden/../value.ts";', 'hidden/a.ts': 'export{}' });
  write('.gitignore', 'value.tsx\nhidden/\n');
  const opened = [], original = fs.openSync;
  fs.openSync = function (p, ...args) { opened.push(String(p)); return original.call(this, p, ...args); };
  let g; try { g = indexProject(root, options); } finally { fs.openSync = original; }
  assert.equal(localEdges(g).length, 0); assert.deepEqual(outcomes(g).map(o => o.status), ['blocked', 'blocked']);
  assert(outcomes(g)[0].candidates.some(c => c.path === 'value.tsx' && c.state === 'unknown'));
  assert.equal(opened.some(p => p.endsWith('/value.tsx') || p.includes('/hidden/')), false);
  write('.gitignore', 'value/\n'); g = indexProject(root, options); assert.equal(outcomes(g)[0].status, 'blocked');
});

for (const [label, bytes] of [['binary', Buffer.from([0, 1])], ['parse', 'export const ='], ['oversized', 'x'.repeat(65537)]]) test(`V07/V08 ${label} candidate blocks rather than proving absence`, t => {
  const { root } = fixture(t, { 'value.ts': bytes }); const g = indexProject(root, options);
  assert.equal(g.inventory.enumeration.complete, true); assert.equal(outcomes(g)[0].status, 'blocked'); assert.equal(localEdges(g).length, 0);
});

test('V07 symlink source and candidate aliases are blocked without reading targets', t => {
  const { root } = fixture(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r14-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'value.tsx'), 'throw Error("never execute");');
  fs.symlinkSync(path.join(outside, 'value.tsx'), path.join(root, 'value.tsx'));
  const g = indexProject(root, options); assert.equal(outcomes(g)[0].status, 'blocked'); assert.equal(localEdges(g).length, 0);
  assert(outcomes(g)[0].candidates.some(c => c.path === 'value.tsx' && c.reason === 'symlink'));
});

test('V08 unrelated oversized resource preserves partial without vetoing proven local relations', t => {
  const { root } = fixture(t, { 'manual.pdf': Buffer.alloc(INDEX_LIMITS.fileBytes + 1, 42) });
  const g = indexProject(root, options);
  assert.equal(g.status, 'partial'); assert.equal(g.inventory.status, 'partial'); assert.equal(g.inventory.enumeration.complete, true);
  assert.equal(g.inventory.entries.find(e => e.path === 'manual.pdf').state, 'too-large'); assert.equal(localEdges(g).length, 1);
});

for (const limitation of ['depth', 'allocation', 'directory-read', 'entry']) test(`V08 global ${limitation} omission withholds all local edges`, t => {
  const { root, write } = fixture(t);
  if (limitation === 'depth') write('deep/'.repeat(INDEX_LIMITS.depth + 1) + 'last.txt', 'x');
  if (limitation === 'allocation') for (let i = 0; i < INDEX_LIMITS.files; i++) write(`f${i}.txt`, '');
  if (limitation === 'entry') for (let i = 0; i < INDEX_LIMITS.entries; i++) write(`f${i}.txt`, '');
  const original = fs.opendirSync;
  if (limitation === 'directory-read') { write('failure/a.txt', 'x'); fs.opendirSync = function (p, ...args) { if (String(p).endsWith('/failure')) throw new Error('Injected directory denial'); return original.call(this, p, ...args); }; }
  let g; try { g = indexProject(root, options); } finally { fs.opendirSync = original; }
  assert.equal(g.inventory.enumeration.complete, false); assert.equal(localEdges(g).length, 0);
  if (node(g)) assert(outcomes(g).every(o => o.status === 'blocked'));
});

test('V09 unsupported typed forms and bare/resources remain visible without generic/external resolution', t => {
  const { root } = fixture(t, { 'main.ts': 'import "pkg"; import "./a.css"; import("./value"); type T=import("./value").Value; import x from "./value" with {};' });
  const g = indexProject(root, options); assert.deepEqual(outcomes(g).map(o => o.status), ['unsupported', 'unsupported']);
  assert.equal(node(g).referenceSyntax.unsupported.length, 3); assert.equal(localEdges(g).length, 0); assert.equal(g.nodes.some(n => n.kind === 'external'), false);
});

test('V10 warm parse cache recomputes candidate additions, renames, parse changes and removals', t => {
  const { root, write } = fixture(t); let g = indexProject(root, options); const hash = node(g).hash, id = node(g).id;
  write('value.tsx', 'export{}'); let next = indexProject(root, { ...options, previous: g });
  assert(next.stats.cachedFiles > 0); assert.notEqual(next.revision, g.revision); assert.equal(outcomes(next)[0].status, 'ambiguous'); g = next;
  fs.renameSync(path.join(root, 'value.tsx'), path.join(root, 'other.tsx')); next = indexProject(root, { ...options, previous: g }); assert.equal(outcomes(next)[0].status, 'resolved'); g = next;
  write('value.ts', 'export const ='); next = indexProject(root, { ...options, previous: g }); assert.equal(outcomes(next)[0].status, 'blocked'); g = next;
  fs.unlinkSync(path.join(root, 'value.ts')); next = indexProject(root, { ...options, previous: g }); assert.equal(outcomes(next)[0].status, 'unresolved');
  assert.equal(node(next).hash, hash); assert.equal(node(next).id, id);
});

test('V11 config whitespace invalidates live graph before a scan failure; recovery needs fresh scans', t => {
  const { root, write } = fixture(t); let fail = false, scans = 0;
  const live = new LiveIndex(root, { intervalMs: 60000, indexOptions: options, indexer: (...args) => { scans++; if (fail) throw new Error('injected scan failure'); return indexProject(...args); } }); t.after(() => live.close());
  const before = live.snapshot(); assert.equal(localEdges(before).length, 1); const count = scans;
  write('tsconfig.json', config + ' '); fail = true;
  const invalid = live.refresh(); assert.equal(invalid.nodes.length, 0); assert.equal(invalid.edges.length, 0); assert.equal(invalid.runtime.status, 'error'); assert.deepEqual(invalid.runtime.changes, []);
  assert.notEqual(invalid.revision, before.revision); assert.throws(() => readIndexedSource(root, node(before), options), /Resolver configuration/);
  fail = false; const after = live.refresh(); assert(scans >= count + 3); assert.equal(localEdges(after).length, 1); assert.notEqual(after.resolver.id, before.resolver.id);
  assert.equal(node(after).id, node(before).id); assert.deepEqual(after.symbolGraph.nodes.map(n => n.id), before.symbolGraph.nodes.map(n => n.id));
});

for (const change of ['delete', 'symlink', 'deny', 'wrong-mode']) test(`V11 ${change} configuration cannot authorize stale source`, t => {
  const { root, write } = fixture(t); const g = indexProject(root, options);
  if (change === 'delete') fs.unlinkSync(path.join(root, 'tsconfig.json'));
  if (change === 'symlink') { write('other.json', config); fs.unlinkSync(path.join(root, 'tsconfig.json')); fs.symlinkSync('other.json', path.join(root, 'tsconfig.json')); }
  if (change === 'deny') write('.gitignore', 'tsconfig.json\n');
  if (change === 'wrong-mode') write('tsconfig.json', config.replace('bundler', 'node16'));
  assert.throws(() => readIndexedSource(root, node(g), options), /Resolver|policy/);
  const next = indexProject(root, options); assert.equal(next.resolver.status, 'invalid'); assert.equal(localEdges(next).length, 0);
});

test('V11 config changes after the indexed read revoke the complete scan', t => {
  const { root, write } = fixture(t, { 'zz-after-config.txt': 'AFTER_CONFIG_MUTATION_SENTINEL' });
  const original = fs.readSync; let changed = false;
  fs.readSync = function (fd, ...args) { const n = original.call(this, fd, ...args); if (!changed && n && String(args[0].subarray(0, n)).includes('AFTER_CONFIG_MUTATION_SENTINEL')) { changed = true; write('tsconfig.json', config + ' '); } return n; };
  let g; try { g = indexProject(root, options); } finally { fs.readSync = original; }
  assert.equal(changed, true); assert.equal(g.resolver.status, 'invalid'); assert.equal(g.resolver.reason, 'config-changed');
  assert.deepEqual(g.nodes, []); assert.deepEqual(g.edges, []);
  assert.equal(localEdges(indexProject(root, options)).length, 1);
});

test('V11 config mutation during source read rejects the old authorization', t => {
  const { root, write } = fixture(t); const g = indexProject(root, options);
  const original = fs.readSync; let changed = false;
  fs.readSync = function (fd, ...args) { const n = original.call(this, fd, ...args); if (!changed && n && String(args[0].subarray(0, n)).startsWith('import type')) { changed = true; write('tsconfig.json', config + ' '); } return n; };
  try { assert.throws(() => readIndexedSource(root, node(g), options), /Resolver configuration changed/); } finally { fs.readSync = original; }
  assert.equal(changed, true);
});

test('V12 full/agent fragments preserve resolution and stale mode/config cursors fail', t => {
  const { root, write } = fixture(t); const g = indexProject(root, options);
  const full = projectContext(g, 'main.ts'); assert.deepEqual(full.resolver, g.resolver); assert.deepEqual(node(full).referenceResolution, node(g).referenceResolution);
  const agentOptions = { profile: 'agent', version: 1, maxBytes: 7000 };
  const initial = projectContext(g, 'main.ts', agentOptions), cursor = contextCursor(initial, 'context');
  const complete = new Map(), fragments = new Map(); let next = cursor, pages = 0;
  do { const page = projectContext(g, 'main.ts', { ...agentOptions, cursor: next }); assert(++pages < 100); assert(Buffer.byteLength(JSON.stringify(page)) <= 7000);
    for (const item of page.page.items) complete.set(item.index, item.value);
    for (const part of page.page.fragments) { const text = (fragments.get(part.index) ?? '') + part.text; fragments.set(part.index, text); if (text.length === part.total) complete.set(part.index, JSON.parse(text)); }
    next = page.page.next;
  } while (next);
  const selected = [...complete.values()].find(x => x.kind === 'node' && x.value.path === 'main.ts'); assert.deepEqual(selected.value.referenceResolution, node(g).referenceResolution);
  const plain = indexProject(root, { generic: true }); assert.throws(() => projectContext(plain, 'main.ts', { ...agentOptions, cursor }), { code: 'STALE_CONTEXT_CURSOR' });
  write('tsconfig.json', config + '\n'); assert.throws(() => freshContext(root, 'main.ts', { ...options, expectedRevision: g.revision }), { code: 'STALE_REVISION' });
});

test('V12 source API requires resolver and revision identities and rejects stale config/mode', async t => {
  const { root, write } = fixture(t); const app = createVisualizer({ root, intervalMs: 60000, indexOptions: options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`, g = await (await fetch(base + '/api/graph')).json();
  assert.equal((await fetch(base + '/api/source?path=main.ts')).status, 409);
  const url = `${base}/api/source?path=main.ts&revision=${g.revision}&resolverId=${g.resolver.id}`;
  const good = await fetch(url); assert.equal(good.status, 200); assert.equal((await good.json()).resolverId, g.resolver.id);
  assert.equal((await fetch(url.replace(g.resolver.id, 'wrong'))).status, 409);
  write('tsconfig.json', config + ' '); assert.equal((await fetch(url)).status, 409);
  const plain = createVisualizer({ root, intervalMs: 60000, indexOptions: { generic: true } });
  await new Promise(resolve => plain.server.listen(0, '127.0.0.1', resolve)); t.after(() => plain.close());
  assert.equal((await fetch(`http://127.0.0.1:${plain.server.address().port}/api/source?path=main.ts&resolverId=${g.resolver.id}`)).status, 409);
});

test('V08 resolver scan work exhaustion withholds the complete result, retaining all syntax facts', t => {
  const { root, write } = fixture(t, { 'main.ts': 'export{}' });
  // 46,000 occurrences are below each file syntax limit but exceed the finite
  // scan-wide path budget. No candidate prefix may survive as accepted edges.
  for (let i = 0; i < 23; i++) write(`many${i}.ts`, 'import "./value";'.repeat(2000));
  const g = indexProject(root, options);
  assert(g.diagnostics.some(d => d.code === 'TYPED_RESOLVER_LIMIT'));
  assert.equal(localEdges(g).length, 0);
  assert.equal(g.nodes.reduce((n, item) => n + (item.referenceSyntax?.facts.length ?? 0), 0), 46000);
  for (const item of g.nodes.filter(n => n.referenceResolution)) {
    assert.equal(item.referenceResolution.extraction, 'withheld');
    assert.deepEqual(item.referenceResolution.outcomes, []);
  }
});

test('V08 repeated path decisions reuse immutable policy checks without bypassing resolver occurrence limits', t => {
  const stem = 'nested/long-source-component-for-finite-policy-work';
  const { root, write } = fixture(t, { 'main.ts': `import "./${stem}";`.repeat(1000) });
  write(stem + '.ts', 'export{}');
  write('.gitignore', Array.from({ length: 13 }, (_, i) => `unrelated-${i}-*.py[cod]`).join('\n') + '\n');
  const g = indexProject(root, options);
  assert.equal(g.inputPolicy.status, 'valid'); assert(g.inputPolicy.workUnits < 8000000);
  assert.equal(outcomes(g).length, 1000); assert(outcomes(g).every(o => o.status === 'resolved'));
  assert.equal(localEdges(g)[0].evidence.length, 1000);
});
