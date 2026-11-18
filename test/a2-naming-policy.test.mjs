import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { indexProject } from '../code-index.mjs';
import { attachOverview, resolvePart, sanitizeNamingMetadata } from '../project-map.mjs';
import { freshContext } from '../graph-context.mjs';
import { createVisualizer, sourceExcerpt } from '../server.mjs';

const part = (target, label) => ({ target, label, description: `${label} description`, aliases: [`${label} alias`], section: `${label} area`, sectionId: 'fixture-area' });
const accessor = (name, kind = 'get') => `symbol:allowed#part.mjs#@accessor:${JSON.stringify(['Store', [name, kind, false, name.startsWith('#')]])}`;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-a2-naming-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  // Excluded files are inert placeholders. Their bytes are never needed for naming.
  const excluded = ['omitted#one.mjs', 'omitted#one#two.mjs', 'private#folder/nested#two.mjs', '.hidden#file.mjs', 'secret_key#one.mjs', 'public.mjs#Store.'];
  for (const name of excluded) write(name, '/* A2_EXCLUDED_PLACEHOLDER */\n');
  write('.gitignore', 'omitted#one.mjs\nomitted#one#two.mjs\nprivate#folder/\npublic.mjs#Store.\n');
  write('public.mjs', 'export class Store { #part() {} }\n');
  write('allowed#part.mjs', `export function run() {}\nexport class Store {
    #method() {} get #value() { return 1; } set #value(next) {}
    get #solo() { return 1; } get 'path/credentials.mjs#entry'() { return 1; }
  }\n`);
  const withheld = [
    ...excluded.map(name => `symbol:${name}#placeholder`),
    'file:omitted#one.mjs', 'symbol:omitted#one.mjs', 'symbol:private#folder',
    'symbol:private#folder/unobserved#child.mjs#placeholder',
    // The eligible private method shares a textual ID with an excluded path.
    'symbol:public.mjs#Store.#part',
    // Missing hard-denied owners and incomplete references stay withheld too.
    'symbol:credentials.pem#placeholder', 'symbol:credentials.pem',
  ];
  const positive = [
    ['file:allowed#part.mjs', 'Allowed source'],
    ['symbol:allowed#part.mjs#run', 'Allowed runner'],
    ['symbol:allowed#part.mjs#Store.#method', 'Private method'],
    [accessor('#value'), 'Private getter'],
    [accessor('#value', 'set'), 'Private setter'],
    ['symbol:allowed#part.mjs#Store.#solo', 'Legacy private getter'],
    [accessor('path/credentials.mjs#entry'), 'Literal getter'],
  ];
  const config = { schemaVersion: 1, blocks: [], parts: [
    ...withheld.map((target, index) => part(target, `A2_WITHHELD_${index}`)),
    ...positive.map(([target, label]) => part(target, label)),
  ] };
  write('agent.mind/project-map.json', JSON.stringify(config));
  const options = { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' };
  return { root, options, excluded, withheld, positive, write, config };
}

function assertFiltered(graph, f) {
  assert(!JSON.stringify(graph).includes('A2_WITHHELD_'));
  assert(!JSON.stringify(graph).includes('A2_EXCLUDED_PLACEHOLDER'));
  assert(!graph.metadata.configuration.parts.some(item => f.withheld.includes(item.target)));
  assert(!graph.diagnostics.some(item => f.withheld.some(target => item.message.includes(target))));
  for (const [target, label] of f.positive) {
    const node = resolvePart(graph.hierarchy, target);
    assert.equal(node.label, label, target);
    assert(node.aliases.includes(`${label} alias`));
  }
  assert.equal(resolvePart(graph.hierarchy, 'symbol:public.mjs#Store.#part').label, '#part');
}

test('complete structured paths withhold excluded naming and preserve hash paths, private members and accessor aliases', t => {
  const f = fixture(t);
  const opened = new Set();
  const originalOpen = fs.openSync;
  let raw;
  fs.openSync = (filename, ...args) => { opened.add(String(filename)); return originalOpen(filename, ...args); };
  try { raw = indexProject(f.root, f.options); }
  finally { fs.openSync = originalOpen; }
  for (const name of f.excluded) assert(!opened.has(path.join(f.root, name)), name);
  assert(!JSON.stringify(raw).includes('A2_WITHHELD_'));
  const graph = attachOverview(raw);
  assert.equal(graph.status, 'current');
  assertFiltered(graph, f);
  for (const name of f.excluded) {
    assert(!graph.nodes.some(node => node.path === name));
    assert.throws(() => sourceExcerpt(f.root, graph, name, 1, f.options), /not in the active index/);
  }
  for (const projection of [{}, { profile: 'agent', section: 'diagnostics', maxBytes: 10000 }]) {
    const context = freshContext(f.root, 'allowed#part.mjs', f.options, projection);
    assert.equal(context.status, 'current');
    assert(!JSON.stringify(context).includes('A2_WITHHELD_'));
    assert(!JSON.stringify(context).includes('A2_EXCLUDED_PLACEHOLDER'));
  }
  const privateGetter = freshContext(f.root, 'Legacy private getter alias', f.options);
  assert.equal(privateGetter.selection.id, accessor('#solo'));
  assert.equal(privateGetter.selection.sourceName, '#solo');
  assert(sourceExcerpt(f.root, graph, 'allowed#part.mjs', 1, f.options).lines.some(line => line.text.includes('class Store')));
});

test('ordinary missing eligible targets retain diagnostics, including incomplete and hash-containing paths', t => {
  const f = fixture(t);
  const missing = ['symbol:allowed#part.mjs#missing', 'symbol:allowed#part.mjs', 'symbol:missing#part.mjs#missing', 'symbol:missing.mjs'];
  f.config.parts.push(...missing.map((target, index) => part(target, `Missing ${index}`)));
  f.write('agent.mind/project-map.json', JSON.stringify(f.config));
  const graph = attachOverview(indexProject(f.root, f.options));
  assert.equal(graph.status, 'partial');
  assertFiltered(graph, f);
  for (const target of missing) {
    assert(graph.metadata.configuration.parts.some(item => item.target === target));
    assert(graph.diagnostics.some(item => item.message.includes(target) && item.message.includes('missing')));
  }
});

test('only unresolved ownership uses a bounded conservative fallback for long delimiter-rich naming IDs', () => {
  const target = `symbol:missing.mjs#${'placeholder#'.repeat(1000)}`;
  const graph = { inputPolicy: {}, nodes: [], symbolGraph: { nodes: [] }, inventory: { entries: [] }, diagnostics: [], metadata: { configuration: { schemaVersion: 1, blocks: [], parts: [part(target, 'Unresolved placeholder')] } } };
  let work = 0;
  sanitizeNamingMetadata(graph, candidate => { work += candidate.length; return false; });
  assert.deepEqual(graph.metadata.configuration.parts, []);
  assert(work <= 64 * 1024);
  // An existing opaque accessor identity has an authoritative path, regardless
  // of the length or delimiters of its literal property name.
  graph.metadata.configuration.parts = [part(target, 'Known placeholder')];
  graph.symbolGraph.nodes = [{ id: target, path: 'allowed.mjs' }];
  sanitizeNamingMetadata(graph, candidate => candidate !== 'allowed.mjs');
  assert.equal(graph.metadata.configuration.parts[0].label, 'Known placeholder');
});

test('HTTP graph, context and SSE use the same filtered metadata and excluded source stays inaccessible', async t => {
  const f = fixture(t);
  const app = createVisualizer({ root: f.root, intervalMs: 60000, indexOptions: f.options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const graph = await (await fetch(`${base}/api/graph`)).json();
  assertFiltered(graph, f);
  assert.equal(graph.status, 'current');
  const context = await (await fetch(`${base}/api/context?path=${encodeURIComponent('allowed#part.mjs')}`)).json();
  assert.equal(context.status, 'current');
  assert(!JSON.stringify(context).includes('A2_WITHHELD_'));
  for (const name of [...f.excluded, f.options.metadataPath]) {
    const params = new URLSearchParams({ path: name, policyId: graph.inputPolicy.id, revision: graph.revision });
    const response = await fetch(`${base}/api/source?${params}`);
    assert.equal(response.status, 409, name);
    assert(!(await response.text()).includes('A2_'));
  }
  const allowed = await fetch(`${base}/api/source?${new URLSearchParams({ path: 'allowed#part.mjs', policyId: graph.inputPolicy.id, revision: graph.revision })}`);
  assert.equal(allowed.status, 200);
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  try {
    let frame = '';
    while (!frame.includes('\n\n')) {
      const chunk = await reader.read();
      assert(!chunk.done);
      frame += new TextDecoder().decode(chunk.value);
    }
    assert(frame.startsWith('event: state\n'));
    const state = JSON.parse(frame.split('data: ')[1].split('\n\n')[0]);
    assertFiltered(state, f);
    assert.equal(state.revision, graph.revision);
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
});
