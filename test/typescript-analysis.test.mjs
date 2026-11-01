import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { indexProject, readIndexedSource } from '../code-index.mjs';
import { attachOverview } from '../project-map.mjs';
import { LiveIndex } from '../live-index.mjs';
const fixture = (t, files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-ts-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true}); fs.writeFileSync(path.join(root,name),source); }
  return root;
};
const file = (graph, name) => graph.nodes.find(node=>node.path===name);
const symbol = (graph, name) => graph.symbolGraph.nodes.find(node=>node.qualifiedName===name);

test('syntax pilot reports named declarations with native kinds, nesting, hashes and honest display labels', t => {
  const source = 'export interface Box { read(): string; }\nexport type Choice = "a" | "b";\nexport enum Flag { On, Off }\nexport namespace Domain { export class C { method(): void {} } }\nexport const View = (p: Box) => <span>{p.read()}</span>;';
  const root=fixture(t,{'view.tsx':source});
  const graph=attachOverview(indexProject(root));
  assert.equal(graph.status,'partial');
  assert.deepEqual(file(graph,'view.tsx').capabilities,['text','typescript-syntax','jsx-syntax','named-symbols']);
  assert.match(file(graph,'view.tsx').diagnostics[0].message,/syntax-only/i);
  for(const [name,kind,native] of [['Box','interface','TSInterfaceDeclaration'],['Choice','type','TSTypeAliasDeclaration'],['Flag','enum','TSEnumDeclaration'],['Domain','namespace','TSModuleDeclaration'],['View','function','ArrowFunctionExpression']]) {
    const s=symbol(graph,name);assert(s,name);assert.equal(s.kind,kind);assert.equal(s.languageKind,native);assert.equal(s.hash,file(graph,'view.tsx').hash);assert.equal(s.producer.name,'@babel/parser');assert.equal(s.producer.version,'7.29.12');
  }
  assert.equal(symbol(graph,'Box.read').parentId,symbol(graph,'Box').id);
  assert.equal(symbol(graph,'Domain.C.method').parentId,symbol(graph,'Domain.C').id);
  assert.equal(graph.hierarchy.nodes.find(n=>n.sourceId===symbol(graph,'Box').id).description,'Interface · Box');
  assert.equal(graph.hierarchy.nodes.find(n=>n.sourceId===symbol(graph,'Choice').id).description,'Type · Choice');
  assert.equal(graph.edges.length,0);assert.equal(graph.symbolGraph.edges.length,0);
  assert.equal(readIndexedSource(root,file(graph,'view.tsx')),source);
});

for(const newline of ['\n','\r\n']) test(`typed ranges use raw UTF-16 offsets and preserve ${JSON.stringify(newline)}`,t=>{
  const source=['/*🧠*/ export function café<T>(value: T): T {','\treturn value;','}'].join(newline);
  const root=fixture(t,{'unicode.ts':source});const graph=indexProject(root);const s=symbol(graph,'café');assert(s);
  assert.deepEqual(s.range,{start:source.indexOf('function'),end:source.length,unit:'utf16-code-unit',endExclusive:true});
  assert.equal(s.line,1);assert.equal(s.column,source.indexOf('function')+1);assert.equal(s.endLine,3);assert.equal(s.endColumn,2);
  assert.equal(s.hash,createHash('sha256').update(source).digest('hex'));
});

test('typed syntax never invents imports, calls, JSX component calls or security analysis',t=>{
  const root=fixture(t,{'main.mjs':'import "./typed.ts"; export function legacy(){ return 1; }','typed.ts':'import { legacy } from "./main.mjs"; import fs from "node:fs"; export function typed(){ fs.readFileSync("never"); return legacy(); }','view.jsx':'import {typed} from "./typed.ts"; export function View(){ return <typed/>; }'});
  const graph=indexProject(root);assert(symbol(graph,'typed'));assert(symbol(graph,'View'));
  assert.equal(graph.edges.length,0);assert.equal(graph.symbolGraph.edges.length,0);
  assert(graph.diagnostics.some(d=>d.path==='main.mjs' && /Unresolved local reference/.test(d.message)));
  assert.deepEqual(file(graph,'typed.ts').security,[]);assert(!file(graph,'typed.ts').capabilities.includes('security-signals'));
  assert.deepEqual(file(graph,'view.jsx').capabilities,['text','jsx-syntax','named-symbols']);
});

test('malformed, unsupported ambient/dialect and oversized syntax stays explicit without recovered symbols',t=>{
  const root=fixture(t,{'broken.ts':'export function broken( {','broken.tsx':'export const V = () => <div>;','ambient.d.ts':'declare function hidden(): void;','module.mts':'export function hidden() {}','large.ts':'//'+ 'x'.repeat(65536)+'\nexport function hidden(){}'});
  const graph=indexProject(root);assert.equal(graph.status,'partial');assert.equal(graph.symbolGraph.nodes.length,0);
  assert(file(graph,'broken.ts').diagnostics.some(d=>/parse error/i.test(d.message)));
  assert(file(graph,'broken.tsx').diagnostics.some(d=>/parse error/i.test(d.message)));
  assert(file(graph,'large.ts').diagnostics.some(d=>/65536.*byte|64 KiB/i.test(d.message)));
  assert.deepEqual(file(graph,'ambient.d.ts').capabilities,['text']);assert.deepEqual(file(graph,'module.mts').capabilities,['text']);
  assert(graph.scope.unsupported.includes('ambient.d.ts'));assert(graph.scope.unsupported.includes('module.mts'));
});

test('overloads, merged declarations and duplicate names stay ambiguous with no colliding IDs',t=>{
  const source='export function run(x: string): string;\nexport function run(x: number): number;\nexport function run(x: unknown): unknown { function child(){} return x; }\ninterface Box {a:string}\ninterface Box {b:number}\nexport function safe(){}';
  const graph=indexProject(fixture(t,{'overloads.ts':source}));
  assert(symbol(graph,'safe'));assert(!symbol(graph,'run'));assert(!symbol(graph,'run.child'));assert(!symbol(graph,'Box'));
  assert(graph.diagnostics.some(d=>/Ambiguous.*run/.test(d.message)));assert(graph.diagnostics.some(d=>/Ambiguous.*Box/.test(d.message)));
  assert.equal(new Set(graph.symbolGraph.nodes.map(n=>n.id)).size,graph.symbolGraph.nodes.length);
});

test('syntax failures and limits do not stop live updates; cache remains isolated and deletions remove symbols',t=>{
  const root=fixture(t,{'typed.ts':'export function original() {}'});const live=new LiveIndex(root,{intervalMs:60000});t.after(()=>live.close());
  const initial=live.graph;assert(symbol(initial,'original'));
  const warm=indexProject(root,{previous:initial});const pristine=structuredClone(warm.symbolGraph);warm.symbolGraph.nodes[0].name='poison';
  assert.deepEqual(indexProject(root,{previous:warm}).symbolGraph,pristine);
  fs.writeFileSync(path.join(root,'typed.ts'),'export function renamed() {}');const edited=live.refresh();assert(symbol(edited,'renamed'));assert(!symbol(edited,'original'));assert.notEqual(edited.revision,initial.revision);
  fs.writeFileSync(path.join(root,'typed.ts'),'const x = '+'['.repeat(10000)+'0'+']'.repeat(10000)+';');const failed=live.refresh();assert.equal(failed.status,'partial');assert.equal(failed.symbolGraph.nodes.length,0);assert(failed.diagnostics.some(d=>/parse error/i.test(d.message)));
  fs.unlinkSync(path.join(root,'typed.ts'));const removed=live.refresh();assert.equal(removed.symbolGraph.nodes.length,0);assert.equal(removed.stats.files,0);
});

test('symbol and traversal caps withhold the entire typed symbol graph while preserving source access', t => {
  const many = Array.from({length:2001},(_,i)=>`function f${i}(){}`).join('\n');
  const deep = 'function kept(){}\nconst x = 0'+'+0'.repeat(300)+';';
  const graph=indexProject(fixture(t,{'many.ts':many,'deep.ts':deep}));
  assert.equal(graph.symbolGraph.nodes.length,0);
  for(const name of ['many.ts','deep.ts']) assert(file(graph,name).diagnostics.some(d=>/limit reached/.test(d.message)));
  assert.equal(graph.inventory.status,'complete');
});

test('unsupported bodies are explicit and signatures are never labeled as implemented methods',t=>{
  const source='export class C { abstractMethod?: () => void; static { function hidden(){} } ["computed"](){} regular(){} }\ninterface Box { read(): void }\nsetTimeout(() => { function anonymousChild() {} });';
  const graph=indexProject(fixture(t,{'bodies.ts':source}));
  assert(symbol(graph,'C.regular'));assert.equal(symbol(graph,'Box.read').kind,'signature');
  assert(!symbol(graph,'hidden'));assert(!symbol(graph,'anonymousChild'));assert(!symbol(graph,'C.computed'));
  assert(graph.diagnostics.some(d=>/class fields\/static blocks/.test(d.message)));assert(graph.diagnostics.some(d=>/anonymous function/.test(d.message)));
});
