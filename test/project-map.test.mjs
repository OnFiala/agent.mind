import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOverview, attachOverview, resolveBlock } from '../project-map.mjs';
import { indexProject } from '../code-index.mjs';
import { freshContext } from '../graph-context.mjs';
import { LiveIndex } from '../live-index.mjs';

const file = (name, kind = 'source', layers = ['project']) => ({ id: `file:${name}`, path: name, label: name, kind, layers, hash: 'x' });
const definition = (id, label, files) => ({ id, label, description: 'Popis bloku.', files, prefixes: [], aliases: [], type: 'process', group: 'core' });
const edge = (from, to, kind = 'import', layers = ['project']) => ({ id: `${from}:${to}:${kind}`, from: `file:${from}`, to: `file:${to}`, kind, layers, evidence: [{ path: from, line: 1, column: 1, snippet: 'real source reference' }] });

test('overview covers every source once and aggregates only real internal cross-block references', () => {
  const graph = { nodes: [file('a.mjs'), file('a2.mjs'), file('b.mjs'), { id: 'external:fs', path: null }], edges: [edge('a.mjs', 'a2.mjs'), edge('a.mjs', 'b.mjs'), edge('a2.mjs', 'b.mjs'), { ...edge('a.mjs', 'fs'), to: 'external:fs' }] };
  const config = { schemaVersion: 1, blocks: [definition('a', 'Mapa', ['a.mjs', 'a2.mjs']), definition('b', 'Server', ['b.mjs'])] };
  const overview = buildOverview(graph, config);
  assert.equal(overview.nodes.length, 2);
  assert.deepEqual(overview.nodes.flatMap(n => n.fileIds).sort(), ['file:a.mjs', 'file:a2.mjs', 'file:b.mjs']);
  assert.equal(overview.edges.length, 1);
  assert.equal(overview.edges[0].from, 'block:a');
  assert.equal(overview.edges[0].to, 'block:b');
  assert.equal(overview.edges[0].sourceEdgeIds.length, 2);
  assert.equal(overview.edges[0].evidence.length, 2);
});

test('transport and import relations remain distinct with evidence and security/testing layers', () => {
  const graph = { nodes: [file('a.mjs'), file('b.mjs')], edges: [edge('a.mjs','b.mjs'), edge('a.mjs','b.mjs','http',['project','security']), edge('a.mjs','b.mjs','event-stream',['project','security'])] };
  const config = { schemaVersion: 1, blocks: [definition('a','A',['a.mjs']),definition('b','B',['b.mjs'])] };
  const overview = buildOverview(graph, config);
  assert.equal(overview.edges.length, 2);
  const contract = overview.edges.find(e => e.kind === 'contract');
  assert.equal(contract.sourceEdgeIds.length, 2);
  assert.equal(contract.provenance, 'static-contract');
  assert(contract.layers.includes('security'));
});

test('new and removed files remain visible without stale membership or invented roles', () => {
  const config = { schemaVersion:1, blocks:[definition('main','Hlavní část',['missing.mjs'])] };
  const overview = buildOverview({nodes:[file('lib/new.mjs'),file('test/new.test.mjs','test')],edges:[]},config);
  assert.equal(overview.nodes.flatMap(n=>n.fileIds).length,2);
  assert(overview.nodes.some(n=>n.label==='lib' && n.inferred));
  assert(!overview.nodes.some(n=>n.id==='block:main'));
  assert(overview.diagnostics.some(d=>d.message.includes('missing.mjs')));
});

test('invalid schema, alias collisions and overlapping membership never silently hide files', () => {
  const graph={nodes:[file('a.mjs')],edges:[]};
  const a=definition('a','Živé změny',['a.mjs']);const b=definition('b','Zive zmeny',['a.mjs']);
  const invalid=buildOverview(graph,{schemaVersion:1,blocks:[a,b]});
  assert.equal(invalid.source,'inferred');assert.equal(invalid.nodes[0].fileIds.length,1);assert(invalid.diagnostics.length);
  b.label='Jiné';
  const overlap=buildOverview(graph,{schemaVersion:1,blocks:[a,b]});
  assert.equal(overlap.nodes.length,1);assert(overlap.nodes[0].inferred);assert(overlap.diagnostics.length);
  a.files=['../outside'];
  assert(buildOverview(graph,{schemaVersion:1,blocks:[a]}).diagnostics.length);
});

test('stable IDs survive rename and normalized aliases resolve exact same block', () => {
  const config={schemaVersion:1,blocks:[{...definition('live-index','Živé změny',['a.mjs']),aliases:['aktualizace']}]};
  const graph={nodes:[file('a.mjs')],edges:[]};
  const before=buildOverview(graph,config);
  assert.equal(resolveBlock(before,'zive zmeny').id,'block:live-index');
  assert.equal(resolveBlock(before,'AKTUALIZACE').id,'block:live-index');
  config.blocks[0].label='Obnova mapy';
  assert.equal(buildOverview(graph,config).nodes[0].id,before.nodes[0].id);
});

test('real metadata changes drive live vocabulary and CLI resolves names with source-backed context', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-mind-blocks-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'a.mjs'),"import './b.mjs';\n");
  fs.writeFileSync(path.join(root,'b.mjs'),'export const value=1;\n');
  const config={schemaVersion:1,blocks:[{...definition('a','Mapa',['a.mjs']),aliases:['canvas']},definition('b','Server',['b.mjs'])]};
  const meta=path.join(root,'project-map.json');fs.writeFileSync(meta,JSON.stringify(config));
  const live=new LiveIndex(root,{intervalMs:60000});t.after(()=>live.close());
  const revision=live.graph.revision;
  assert.equal(freshContext(root,'canvas').selection.id,'block:a');
  assert(freshContext(root,'Mapa').nodes.some(n=>n.path==='b.mjs'));
  assert.equal(freshContext(root,'a.mjs').selection.blockLabel,'Mapa');
  config.blocks[0].label='Rozhraní';fs.writeFileSync(meta,JSON.stringify(config));
  assert.notEqual(live.refresh().revision,revision);
  assert.equal(freshContext(root,'canvas').selection.label,'Rozhraní');
  assert.throws(()=>freshContext(root,'Mapa'),/not in/);
  const unrelated=buildOverview(indexProject(root));
  assert(!unrelated.nodes.some(n=>n.label==='Mapa'));
  fs.writeFileSync(meta,'{"schemaVersion":9}');
  const broken=attachOverview(indexProject(root));assert.equal(broken.status,'partial');assert(broken.overview.diagnostics.length);
});


test('inferred files cannot steal configured names, aliases or IDs', () => {
  const config={schemaVersion:1,blocks:[{...definition('auto-config','Nastavení',['a.mjs']),aliases:['Dokumentace']}]};
  const graph={nodes:[file('a.mjs'),file('new.json','config'),file('guide.md','document')],edges:[]};
  const overview=buildOverview(graph,config);
  assert.equal(overview.nodes.length,3);
  assert.equal(new Set(overview.nodes.map(n=>n.id)).size,3);
  assert.equal(resolveBlock(overview,'Nastavení').id,'block:auto-config');
  assert.equal(resolveBlock(overview,'Dokumentace').id,'block:auto-config');
  assert.deepEqual(resolveBlock(overview,'Nastavení').fileIds,['file:a.mjs']);
  for(const node of overview.nodes) assert.equal(resolveBlock(overview,node.label).id,node.id);
});

function portableFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-portable-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'agent.mind'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'src/module-c.mjs'), 'export function original() {}\nexport function helper() { original(); }');
  fs.writeFileSync(path.join(root, 'test/module-c.test.mjs'), 'import { original } from "../src/module-c.mjs";');
  const config = { schemaVersion: 1, blocks: [definition('module-c', 'Module C', ['src/module-c.mjs']), definition('tests', 'Tests', ['test/module-c.test.mjs'])], parts: [] };
  config.blocks[0].aliases = ['modul C'];
  const save = () => fs.writeFileSync(path.join(root, 'agent.mind/project-map.json'), JSON.stringify(config));
  save();
  return { root, config, save, options: { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' } };
}

test('portable context and live scans use one metadata source, including metadata-only changes and missing-map failures', t => {
  const { root, config, save, options } = portableFixture(t);
  fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify({ schemaVersion: 1, blocks: [definition('stale', 'Stale map', ['src/module-c.mjs'])] }));
  const live = new LiveIndex(root, { intervalMs: 60000, indexOptions: options });
  t.after(() => live.close());
  const first = freshContext(root, 'modul C', options);
  assert.equal(first.selection.id, 'block:module-c');
  assert.ok(first.edges.some(item => item.from === 'file:test/module-c.test.mjs' && item.to === 'file:src/module-c.mjs'));
  assert.equal(first.overview.source, 'agent.mind/project-map.json');
  assert.equal(live.graph.hierarchy.nodes.find(item => item.id === first.selection.id).label, first.selection.label);
  config.blocks[0].label = 'Module C renamed'; save();
  const updated = live.refresh();
  assert.notEqual(updated.revision, first.revision);
  assert.equal(freshContext(root, 'modul C', options).selection.label, 'Module C renamed');
  assert.throws(() => freshContext(root, 'modul C', { ...options, expectedRevision: first.revision }), error => error.code === 'STALE_REVISION' && error.actualRevision === updated.revision);
  assert.equal(freshContext(root, 'modul C', { ...options, expectedRevision: updated.revision }).revision, updated.revision);
  fs.unlinkSync(path.join(root, options.metadataPath));
  const missing = attachOverview(indexProject(root, options));
  assert.equal(missing.status, 'partial');
  assert.equal(missing.overview.source, 'inferred');
  assert.ok(!missing.hierarchy.nodes.some(item => item.label === 'Stale map'));
  fs.writeFileSync(path.join(root, options.metadataPath), '{"broken":');
  const broken = attachOverview(indexProject(root, options));
  assert.equal(broken.status, 'partial');
  assert.ok(broken.diagnostics.some(item => item.path === options.metadataPath && item.message.includes('Cannot load names')));
});

test('source aliases and all qualified alias paths retain collisions instead of selecting a renamed sibling', t => {
  const { root, config, save, options } = portableFixture(t);
  config.parts = [
    { target: 'file:src/module-c.mjs', label: 'Implementation', aliases: ['old implementation'], description: 'Module source.' },
    { target: 'symbol:src/module-c.mjs#helper', label: 'original', aliases: [], description: 'Renamed helper.' }
  ];
  save();
  const graph = attachOverview(indexProject(root, options));
  const original = graph.hierarchy.nodes.find(item => item.id === 'symbol:src/module-c.mjs#original');
  assert.ok(original.aliases.includes('original'));
  for (const selector of ['original', 'Module C / Implementation / original', 'modul C / old implementation / original', 'Module C / src/module-c.mjs / original']) {
    assert.throws(() => freshContext(root, selector, options), error => error.code === 'AMBIGUOUS_SELECTOR' && error.candidates.length === 2, selector);
  }
  assert.equal(freshContext(root, original.id, options).selection.id, original.id);
});

test('a canonical block short name does not outrank a nested alias and stable IDs remain definitive', t => {
  const { root, config, save, options } = portableFixture(t);
  config.parts.push({ target: 'symbol:src/module-c.mjs#helper', label: 'Helper', aliases: ['Module C'], description: 'Helper.' });
  save();
  assert.throws(() => freshContext(root, 'Module C', options), error => error.code === 'AMBIGUOUS_SELECTOR' && error.candidates.some(item => item.id === 'block:module-c') && error.candidates.some(item => item.id === 'symbol:src/module-c.mjs#helper'));
  assert.equal(freshContext(root, 'block:module-c', options).selection.id, 'block:module-c');
  assert.equal(freshContext(root, 'Module C / src/module-c.mjs / Helper', options).selection.id, 'symbol:src/module-c.mjs#helper');
  assert.throws(() => freshContext(root, 'area:file%3Asrc%2Fmodule-c.mjs:helpers', options), /presentation groups/);
});


test('an exact relative source filepath remains a definitive selector in a neutral inferred project', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-neutral-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.mjs'), 'export function run() {}');
  const context = freshContext(root, 'main.mjs', { generic: true });
  assert.equal(context.selection.id, 'file:main.mjs');
});
