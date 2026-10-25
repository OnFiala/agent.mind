import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject } from '../code-index.mjs';
import { attachOverview, resolvePart } from '../project-map.mjs';
import { scopeGraph, ancestorPath, projectAreas, sourceRelations } from '../public/hierarchy.mjs';
import { freshContext } from '../graph-context.mjs';

test('ancestor paths preserve references, missing parents, cycles and last duplicate IDs', () => {
  const root = { id: 'root', parentId: null };
  const child = { id: 'child', parentId: 'root' };
  const orphan = { id: 'orphan', parentId: 'missing' };
  const self = { id: 'self', parentId: 'self' };
  const a = { id: 'a', parentId: 'b' }, b = { id: 'b', parentId: 'a' };
  const lastRoot = { id: 'root', parentId: null, label: 'Last root' };
  const hierarchy = { nodes: [root, child, orphan, self, a, b, lastRoot] };
  for (const lookup of [undefined, new Map(hierarchy.nodes.map(node => [node.id, node]))]) {
    const chain = ancestorPath(hierarchy, 'child', lookup);
    assert.equal(chain[0], lastRoot);
    assert.equal(chain[1], child);
    assert.deepEqual(ancestorPath(hierarchy, 'orphan', lookup), [orphan]);
    assert.deepEqual(ancestorPath(hierarchy, 'self', lookup), [self]);
    assert.deepEqual(ancestorPath(hierarchy, 'a', lookup), [b, a]);
    assert.deepEqual(ancestorPath(hierarchy, 'unknown', lookup), []);
  }
  assert.deepEqual(ancestorPath(null, 'missing'), []);
});

test('standalone ancestry observes replacement, insertion, removal and reparenting in the same array', () => {
  const root = { id: 'root' }, child = { id: 'child', parentId: 'root' };
  const hierarchy = { nodes: [root, child] };
  assert.deepEqual(ancestorPath(hierarchy, 'child'), [root, child]);
  const replacement = { id: 'root', label: 'Renamed' };
  hierarchy.nodes[0] = replacement;
  assert.equal(ancestorPath(hierarchy, 'child')[0], replacement);
  const added = { id: 'added' };
  hierarchy.nodes.push(added);
  child.parentId = added.id;
  assert.deepEqual(ancestorPath(hierarchy, 'child'), [added, child]);
  hierarchy.nodes.pop();
  assert.deepEqual(ancestorPath(hierarchy, 'child'), [child]);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-hierarchy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.mjs'), `import './other.mjs';
function helper() {}
function start() {
  function child() { helper(); }
  child();
}
start();
`);
  fs.writeFileSync(path.join(root, 'other.mjs'), 'export function helper() {}\n');
  const config = { schemaVersion: 1, blocks: [{ id: 'map', label: 'Mapa', description: 'Rozhraní', aliases: ['canvas'], type: 'interface', group: 'core', files: ['app.mjs'], prefixes: [] }, { id: 'other', label: 'Okolí', description: 'Doplňky', aliases: [], type: 'module', group: 'core', files: ['other.mjs'], prefixes: [] }], parts: [ { target: 'file:app.mjs', label: 'Ovládání', description: 'Ovládání mapy', aliases: [] }, { target: 'symbol:app.mjs#start', label: 'Běh', description: 'Běh mapy', aliases: ['run'] }, { target: 'symbol:app.mjs#start.child', label: 'Obnova', description: 'Obnovení mapy', aliases: [] } ] };
  fs.writeFileSync(path.join(root, 'project-map.json'), JSON.stringify(config));
  return { root, config, scan: () => attachOverview(indexProject(root)) };
}

test('recursive hierarchy, names and agent scope share source identities and ancestry', t => {
  const { root, scan } = fixture(t);
  const graph = scan();
  const selected = resolvePart(graph.hierarchy, 'Mapa / Ovládání / Běh / Obnova');
  assert.equal(selected.id, 'symbol:app.mjs#start.child');
  assert.deepEqual(ancestorPath(graph.hierarchy, selected.id).map(n => n.label), ['Mapa', 'Ovládání', 'Běh', 'Obnova']);
  assert.equal(resolvePart(graph.hierarchy, 'run').id, 'symbol:app.mjs#start');
  assert.throws(() => resolvePart(graph.hierarchy, 'helper'), /multiple parts/);
  const context = freshContext(root, selected.qualifiedLabel);
  assert.equal(context.selection.id, selected.id);
  assert.deepEqual(context.vocabulary, graph.hierarchy.vocabulary);
  assert.equal(context.canvas.scopeId, selected.parentId);
  assert.equal(context.nodes.find(n => n.path === 'app.mjs').hash, selected.hash);
  assert(context.symbolGraph.edges.some(e => e.from === selected.id));
  assert.equal(freshContext(root, 'app.mjs').selection.blockLabel, 'Mapa');
});

test('file scope retains proven top-level call but never assigns imports to a function', t => {
  const graph = fixture(t).scan();
  const scoped = scopeGraph(graph, 'file:app.mjs');
  const entry = scoped.nodes.find(n => n.isEntry);
  assert.equal(entry.label, 'File body');
  assert.equal(entry.sourceId, 'file:app.mjs');
  assert(scoped.edges.some(e => e.from === entry.id && e.to === 'symbol:app.mjs#start'));
  assert(scoped.edges.every(e => e.kind === 'call'));
  assert(!scoped.nodes.some(n => n.id.includes('other')));
  for (const e of scoped.edges) assert(e.sourceEdgeIds.every(id => graph.hierarchy.edges.some(source => source.id === id)));
});

test('nested scope keeps direct children, scoped entry and explicit outside boundary with evidence', t => {
  const graph = fixture(t).scan();
  const scoped = scopeGraph(graph, 'symbol:app.mjs#start');
  assert(scoped.nodes.some(n => n.id === 'symbol:app.mjs#start.child'));
  const outside = scoped.nodes.find(n => n.kind === 'boundary' && n.targetId === 'symbol:app.mjs#helper');
  assert(outside);
  assert(scoped.edges.some(e => e.to === outside.id && e.evidence.some(x => x.line === 4)));
  assert(scoped.edges.some(e => e.from === 'entry:symbol:app.mjs#start' && e.to === 'symbol:app.mjs#start.child'));
  assert(scoped.edges.every(e => scoped.nodes.some(n => n.id === e.from) && scoped.nodes.some(n => n.id === e.to)));
});

test('source deletion removes recursive parts and stale names cannot resolve', t => {
  const { root, scan } = fixture(t);
  const before = scan();
  fs.writeFileSync(path.join(root, 'app.mjs'), 'function start() {}\nstart();\n');
  const after = scan();
  assert.notEqual(before.revision, after.revision);
  assert(!after.hierarchy.nodes.some(n => n.id === 'symbol:app.mjs#start.child'));
  assert.equal(resolvePart(after.hierarchy, 'Obnova'), null);
  assert.throws(() => scopeGraph(after, 'symbol:app.mjs#start.child'), /no longer/);
  assert(after.hierarchy.diagnostics.some(d => d.message.includes('start.child')));
});

test('section metadata stays shared presentation vocabulary and never changes source topology', t => {
  const {root, config, scan} = fixture(t);
  const before = scan();
  config.parts[1].section = 'Ovládání';
  config.parts[1].sectionId = 'controls';
  config.parts[2].section = 'Kreslení';
  config.parts[2].sectionId = 'rendering';
  config.parts[2].label = 'Obnovit mapu';
  fs.writeFileSync(path.join(root,'project-map.json'), JSON.stringify(config));
  const after = scan();
  const part = resolvePart(after.hierarchy, 'Mapa / Ovládání / Běh / Obnovit mapu');
  assert.equal(part.section,'Kreslení');
  assert.equal(resolvePart(after.hierarchy,'child').id,part.id);
  const context = freshContext(root, part.id);
  assert.equal(context.selection.section,'Kreslení');
  assert.equal(context.vocabulary.find(n=>n.id===part.id).section,'Kreslení');
  assert.equal(context.partCanvas.nodes.find(n=>n.id===part.id).section,'Kreslení');
  assert.deepEqual(after.symbolGraph.edges,before.symbolGraph.edges);
  assert.deepEqual(after.hierarchy.nodes.map(n=>[n.id,n.parentId]),before.hierarchy.nodes.map(n=>[n.id,n.parentId]));
  config.parts[2].section={label:'Invalid'};
  fs.writeFileSync(path.join(root,'project-map.json'),JSON.stringify(config));
  const invalid=scan();
  assert(invalid.hierarchy.diagnostics.some(d=>d.message.includes('Invalid')));
  assert.equal(invalid.hierarchy.nodes.find(n=>n.id===part.id).section,undefined);
});

test('duplicate friendly sibling labels stay short and unambiguous without exposing qualified code names', t => {
  const {root,config,scan}=fixture(t);
  config.parts.push({target:'symbol:app.mjs#helper',label:'Běh',description:'Pomocná funkce',aliases:[]});
  fs.writeFileSync(path.join(root,'project-map.json'),JSON.stringify(config));
  const graph=scan();
  const siblings=graph.hierarchy.nodes.filter(n=>n.parentId==='file:app.mjs');
  assert.equal(new Set(siblings.map(n=>n.label)).size,siblings.length);
  assert.deepEqual(siblings.map(n=>n.label).sort(),['Běh','Běh · 2']);
  for(const node of siblings) assert.equal(resolvePart(graph.hierarchy,node.qualifiedLabel).id,node.id);
});

function areaFixture() {
  const part = (id, sectionId, section, kind = 'symbol') => ({ id, label: id, sectionId, section, kind, layers: ['project'], fileIds: ['file:app.mjs'], hash: 'source-hash' });
  const edge = (id, from, to, kind = 'call') => ({ id, from, to, kind, provenance: kind === 'contract' ? 'static-contract' : 'source', label: kind === 'call' ? 'calls' : 'HTTP', sourceEdgeIds: [`raw:${id}`], layers: ['project', id === 'ab2' ? 'security' : 'testing'], evidence: [{ path: 'app.mjs', line: id.length, hash: 'source-hash', snippet: id }] });
  return { scopeId: 'symbol:app.mjs#main', scopeNode: { kind: 'symbol' }, mode: 'blocks', nodes: [part('a1','controls','Controls'), part('a2','controls','Controls'), part('b1','rendering','Rendering'),part('outside','remote','Remote','boundary')], edges: [edge('aa','a1','a2'),edge('ab1','a1','b1'),edge('ab2','a2','b1'),edge('ba','b1','a1'),edge('http','a1','b1','contract'),edge('external','outside','a2')] };
}

test('collapsed areas conserve every directed relationship, type, layer and source evidence', () => {
  const input = areaFixture(); const snapshot = JSON.stringify(input);
  const collapsed = projectAreas(input);
  assert.equal(collapsed.nodes.length,3);
  const controls=collapsed.areas.find(a=>a.label==='Controls');
  const rendering=collapsed.areas.find(a=>a.label==='Rendering');
  const ab=collapsed.edges.find(e=>e.from===controls.id&&e.to===rendering.id&&e.kind==='call');
  assert.deepEqual(ab.scopeEdgeIds,['ab1','ab2']);
  assert.deepEqual(ab.sourceEdgeIds,['raw:ab1','raw:ab2']);
  assert.equal(ab.evidence.length,2);
  assert(ab.layers.includes('security')&&ab.layers.includes('testing'));
  assert(collapsed.edges.some(e=>e.from===rendering.id&&e.to===controls.id));
  assert(collapsed.edges.some(e=>e.from===controls.id&&e.to===rendering.id&&e.kind==='contract'));
  assert.deepEqual(controls.internalEdgeIds,['aa']);
  assert.deepEqual(collapsed.nodes.find(n=>n.id===controls.id).internalSourceEdgeIds,['raw:aa']);
  const accounted=[...collapsed.edges.flatMap(e=>e.scopeEdgeIds),...collapsed.areas.filter(a=>!a.expanded).flatMap(a=>a.internalEdgeIds)];
  assert.deepEqual(accounted.sort(),input.edges.map(e=>e.id).sort());
  assert.equal(JSON.stringify(input),snapshot);
});

test('mixed and fully expanded area projections preserve identities and exact edge accounting', () => {
  const input=areaFixture();const collapsed=projectAreas(input);const area=collapsed.areas.find(a=>a.label==='Controls');
  const mixed=projectAreas(input,new Set([area.id]));
  assert(mixed.nodes.some(n=>n.id==='a1'&&n.areaId===area.id&&n.hash==='source-hash'));
  assert(mixed.edges.some(e=>e.from==='a1'&&e.to==='a2'));
  const all=projectAreas(input,new Set(collapsed.areas.map(a=>a.id)));
  assert.deepEqual(all.nodes.map(n=>n.id).sort(),input.nodes.map(n=>n.id).sort());
  assert.deepEqual(all.edges.flatMap(e=>e.scopeEdgeIds).sort(),input.edges.map(e=>e.id).sort());
  for (const original of input.edges) {
    const projected=all.edges.find(e=>e.scopeEdgeIds.includes(original.id));
    assert.equal(projected.from,original.from);assert.equal(projected.to,original.to);assert.equal(projected.kind,original.kind);
    assert.deepEqual(projected.evidence,original.evidence);
  }
  assert.deepEqual(projectAreas(input).nodes,collapsed.nodes);
});

test('area IDs survive display-name translations and stale expansion IDs never invent members', () => {
  const input=areaFixture();const before=projectAreas(input);const area=before.areas.find(a=>a.label==='Controls');
  const renamed={...input,nodes:input.nodes.map(n=>({...n,section:n.sectionId==='controls'?'Ovládání':n.section}))};
  const after=projectAreas(renamed,new Set([area.id,'missing-area']));
  assert(after.areas.find(a=>a.label==='Ovládání').expanded);
  assert.deepEqual(after.expandedAreaIds,[area.id]);
  const smaller={...input,nodes:input.nodes.filter(n=>n.id!=='a2'),edges:input.edges.filter(e=>e.from!=='a2'&&e.to!=='a2')};
  assert(!projectAreas(smaller,new Set([area.id])).nodes.some(n=>n.id==='a2'));
  const root={...input,scopeNode:null};assert.equal(projectAreas(root).areaMode,false);
  assert.throws(()=>projectAreas({...input,edges:[...input.edges,{id:'bad',from:'missing',to:'a1'}]}),/missing endpoint/);
});

test('English renaming preserves Czech breadcrumb aliases and canonical source targets', t => {
  const {root,config,scan}=fixture(t);const before=scan();
  for (const [block,label] of config.blocks.map((b,i)=>[b,['Map','Outside'][i]])) {block.aliases.push(block.label);block.label=label;}
  for (const [i,part] of config.parts.entries()) {part.aliases.push(part.label);part.label=['Controls','Map runtime','Refresh'][i];part.section='Controls';part.sectionId='controls';}
  fs.writeFileSync(path.join(root,'project-map.json'),JSON.stringify(config));
  const after=scan();
  assert.equal(resolvePart(after.hierarchy,'Mapa / Ovládání / Běh / Obnova').id,'symbol:app.mjs#start.child');
  assert.equal(resolvePart(after.hierarchy,'Map / Controls / Map runtime / Refresh').id,'symbol:app.mjs#start.child');
  assert.deepEqual(after.hierarchy.nodes.map(n=>[n.id,n.parentId]),before.hierarchy.nodes.map(n=>[n.id,n.parentId]));
  const context=freshContext(root,'Mapa / Ovládání / Běh');
  assert(context.canvas.areaMode);
  assert(context.canvas.nodes.every(n=>n.isArea));
  assert(context.partCanvas.nodes.some(n=>n.id==='symbol:app.mjs#start.child'));
});

test('legacy area labels without stable IDs fall back visibly without losing part names or expansion identity', t => {
  const {root,config,scan}=fixture(t);
  config.parts[2].section='Controls';
  fs.writeFileSync(path.join(root,'project-map.json'),JSON.stringify(config));
  const graph=scan();const part=graph.hierarchy.nodes.find(n=>n.id==='symbol:app.mjs#start.child');
  assert.equal(part.label,'Obnova');
  assert.equal(part.section,undefined);
  assert(graph.hierarchy.diagnostics.some(d=>d.message.includes('stable sectionId')));
  const base=areaFixture();base.nodes=base.nodes.map(n=>({...n,sectionId:undefined}));
  const before=projectAreas(base);const other=before.areas.find(a=>a.label==='Other parts');
  const after=projectAreas({...base,nodes:base.nodes.map(n=>({...n,section:'Renamed'}))},new Set([other.id]));
  assert(after.areas.find(a=>a.label==='Other parts').expanded);
  assert.deepEqual(before.areas.map(a=>a.id),after.areas.map(a=>a.id));
});

test('projected connector details resolve original named source pairs, not grouped area endpoints', t => {
  const {scan}=fixture(t);const graph=scan();
  const rawCall=graph.symbolGraph.edges.find(e=>e.from==='symbol:app.mjs#start.child'&&e.to==='symbol:app.mjs#helper');
  assert(rawCall);
  const scope=scopeGraph(graph,'symbol:app.mjs#start');
  const compact=projectAreas(scope);
  const connector=compact.edges.find(e=>e.sourceEdgeIds.includes(rawCall.id));
  const details=sourceRelations(graph,connector);
  assert.equal(details.unresolvedSourceEdgeIds.length,0);
  const pair=details.references.find(e=>e.id===rawCall.id);
  assert.equal(pair.fromNode.id,'symbol:app.mjs#start.child');
  assert.equal(pair.fromNode.label,'Obnova');
  assert.equal(pair.toNode.id,'symbol:app.mjs#helper');
  assert.deepEqual(pair.evidence,rawCall.evidence);
  assert.equal(pair.execution,'not-observed');
  assert.equal(pair.kind,rawCall.kind);
  assert.deepEqual(sourceRelations(graph,{...connector,sourceEdgeIds:[rawCall.id,rawCall.id,'missing-reference']}).unresolvedSourceEdgeIds,['missing-reference']);
  assert.equal(sourceRelations(graph,{...connector,sourceEdgeIds:[rawCall.id,rawCall.id]}).references.length,1);
});

test('connector reference resolution handles raw imports, missing endpoints and explicit empty evidence without guessing', () => {
  const raw={id:'import:a:b',from:'file:a',to:'external:b',kind:'import',evidence:[]};
  const graph={nodes:[{id:'file:a',label:'A',path:'a.mjs'}],edges:[raw]};
  const direct=sourceRelations(graph,raw);
  assert.equal(direct.references[0].fromNode.label,'A');
  assert.equal(direct.references[0].toNode,null);
  assert.deepEqual(direct.references[0].evidence,[]);
  assert.equal(sourceRelations(graph,{id:'projected',sourceEdgeIds:[]}).references.length,0);
  assert.deepEqual(sourceRelations(graph,{id:'unknown'}).unresolvedSourceEdgeIds,['unknown']);
});
