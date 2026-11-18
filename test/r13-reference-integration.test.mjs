import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject, readIndexedSource } from '../code-index.mjs';
import { projectContext, contextCursor } from '../graph-context.mjs';
import { LiveIndex } from '../live-index.mjs';

const options = { generic: true };
const file = (graph, name = 'main.ts') => graph.nodes.find(node => node.path === name);
const normalize = graph => { const copy = structuredClone(graph); delete copy.generatedAt; delete copy.stats.parseMs; delete copy.stats.cachedFiles; return copy; };
function fixture(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r13-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); }
  return root;
}
const agent = (graph, extra = {}) => projectContext(graph, 'main.ts', { profile: 'agent', version: 1, maxBytes: 7000, ...extra });

test('T09 typed facts never enter local, external, security or call resolution', t => {
  const refs = ['./other.mjs', './other.ts', './folder', './folder/index', '../outside', '@/alias', 'node:fs', 'package'];
  const source = refs.map(specifier => `import '${specifier}';`).join('\n') + '\nexport function own(){ return imported(); }';
  const root = fixture(t, { 'main.ts': source, 'other.ts': 'export function other(){}', 'view.tsx': 'import {other} from "./other.ts"; export const V=()=> <other/>;', 'main.mjs': 'import "./main.ts";', 'other.mjs': 'export function legacy(){}', 'folder/index.ts': 'export const value=1;' });
  const graph = indexProject(root, options);
  assert.equal(graph.status, 'partial');
  assert.deepEqual(file(graph).referenceSyntax.facts.map(fact => fact.specifier), refs);
  assert.deepEqual(graph.edges, []); assert.deepEqual(graph.symbolGraph.edges, []);
  assert.equal(graph.nodes.some(node => node.kind === 'external'), false);
  for (const node of graph.nodes.filter(node => node.referenceSyntax)) {
    assert.deepEqual(node.security, []);
    assert.equal(node.capabilities.includes('static-reference-syntax'), true);
    assert.equal(node.capabilities.includes('static-references'), false);
    assert.deepEqual(node.referenceSyntax.resolution, { status: 'unsupported', reason: 'typed-resolution-not-enabled' });
  }
  assert.equal(Object.hasOwn(file(graph, 'other.mjs'), 'referenceSyntax'), false);
  assert(graph.diagnostics.some(item => item.path === 'main.mjs' && /Unresolved local reference/.test(item.message)));
});

test('T11 cold/warm graphs agree and every nested reference collection is cache-isolated', t => {
  const source = 'import { type T, value as local } from "module";\nimport("later");\nexport function stable(){}';
  const root = fixture(t, { 'main.ts': source });
  const cold = indexProject(root, options), warm = indexProject(root, { ...options, previous: cold });
  assert(warm.stats.cachedFiles > 0); assert.deepEqual(normalize(warm), normalize(cold));
  const pristine = normalize(warm);
  const syntax = file(warm).referenceSyntax;
  syntax.facts[0].specifier = 'poison'; syntax.facts[0].typed.bindings[0].local = 'poison';
  syntax.facts[0].typed.bindings[0].range.start = -1; syntax.facts[0].evidence.producer.name = 'poison';
  syntax.facts[0].evidence.range.end = -1; syntax.unsupported[0].range.start = -1;
  syntax.resolution.status = 'resolved'; syntax.facts.push({ poison: true });
  assert.deepEqual(normalize(indexProject(root, { ...options, previous: warm })), pristine);
  assert.equal(readIndexedSource(root, file(cold), options), source);
});

test('T11 live edit, line movement, deletion and policy invalidation remove stale syntax', t => {
  const source = 'import "before";\nexport function stable(){}';
  const root = fixture(t, { 'main.ts': source });
  const live = new LiveIndex(root, { intervalMs: 60000, indexOptions: options }); t.after(() => live.close());
  const before = structuredClone(live.snapshot()), cursor = contextCursor(agent(before), 'context');
  fs.writeFileSync(path.join(root, 'main.ts'), '\nimport "after";\nexport function stable(){}');
  const after = live.refresh();
  assert.notEqual(after.revision, before.revision);
  assert.deepEqual(after.symbolGraph.nodes.map(node => node.id), before.symbolGraph.nodes.map(node => node.id));
  assert.equal(file(after).referenceSyntax.facts[0].specifier, 'after');
  assert.equal(file(after).referenceSyntax.facts[0].evidence.line, 2);
  assert.throws(() => readIndexedSource(root, file(before), options), /changed/);
  assert.throws(() => agent(after, { cursor }), { code: 'STALE_CONTEXT_CURSOR' });
  fs.writeFileSync(path.join(root, '.gitignore'), 'main.ts\n');
  assert.equal(live.checkPolicy(), true); assert.equal(live.snapshot().nodes.length, 0);
  assert.throws(() => readIndexedSource(root, file(after), options), /policy|stale/i);
  assert.equal(file(live.refresh()), undefined);
  fs.writeFileSync(path.join(root, '.gitignore'), '');
  assert.equal(file(live.refresh()).referenceSyntax.facts[0].specifier, 'after');
  fs.unlinkSync(path.join(root, 'main.ts'));
  assert.equal(file(live.refresh()), undefined); assert.equal(live.snapshot().symbolGraph.nodes.length, 0);
});

test('T12 large typed nodes reconstruct losslessly through byte-bounded context fragments', t => {
  const source = Array.from({ length: 90 }, (_, i) => `import { type T${i}, value${i} as local${i} } from "module-${i}-🧭";`).join('\n');
  const root = fixture(t, { 'main.ts': source }); const graph = indexProject(root, options);
  const full = projectContext(graph, 'main.ts'), initial = agent(graph);
  assert.deepEqual(file(full).referenceSyntax, file(graph).referenceSyntax);
  const complete = new Map(), fragments = new Map(); let cursor = contextCursor(initial, 'context'), pages = 0;
  do {
    assert(++pages < 300);
    const page = agent(graph, { cursor });
    assert.equal(page.error, undefined); assert(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 7000);
    assert.equal(page.snapshot, initial.snapshot); assert.equal(page.status, 'partial');
    for (const item of page.page.items) { assert(!complete.has(item.index)); complete.set(item.index, item.value); }
    for (const part of page.page.fragments) {
      const prior = fragments.get(part.index) ?? ''; assert.equal(part.offset, prior.length);
      assert.equal(part.encoding, 'json-text'); assert(!/[\uD800-\uDBFF]$/u.test(part.text));
      const joined = prior + part.text; fragments.set(part.index, joined);
      if (joined.length === part.total) { assert(!complete.has(part.index)); complete.set(part.index, JSON.parse(joined)); }
    }
    const section = page.sections.find(item => item.kind === 'context');
    assert.equal(section.omitted, section.total - page.page.items.length);
    cursor = page.page.next;
  } while (cursor);
  assert(pages > 1); assert(fragments.size > 0);
  assert.equal(complete.size, initial.sections.find(item => item.kind === 'context').total);
  const nodes = [...complete.values()].filter(item => item.kind === 'node').map(item => item.value);
  assert.deepEqual(nodes, full.nodes);
  const live = new LiveIndex(root, { intervalMs: 60000, indexOptions: options }); t.after(() => live.close());
  assert.deepEqual(file(live.snapshot()).referenceSyntax, file(graph).referenceSyntax);
  const tooSmall = agent(graph, { maxBytes: 256 }); assert.equal(tooSmall.error.code, 'CONTEXT_BUDGET_TOO_SMALL');
});

for (const [name, source, extraction] of [['empty', 'export const value=1;', 'collected'], ['malformed', 'import {', 'withheld'], ['limit', 'import "x";'.repeat(2001), 'withheld']]) test(`T12/T14 ${name} retains partial and explicit extraction in full/bounded/live output`, t => {
  const root = fixture(t, { 'main.ts': source }); const live = new LiveIndex(root, { intervalMs: 60000, indexOptions: options }); t.after(() => live.close());
  const graph = live.snapshot(), node = file(graph), full = projectContext(graph, 'main.ts'), bounded = agent(graph, { maxBytes: 64000 });
  assert.equal(graph.status, 'partial'); assert.equal(full.status, 'partial'); assert.equal(bounded.status, 'partial');
  assert.equal(node.referenceSyntax.extraction, extraction); assert.deepEqual(node.referenceSyntax.facts, []);
  assert.deepEqual(file(full).referenceSyntax, node.referenceSyntax);
  assert.deepEqual(bounded.page.items.find(item => item.value.kind === 'node').value.value.referenceSyntax, node.referenceSyntax);
  assert.equal(node.referenceSyntax.resolution.status, 'unsupported');
});
