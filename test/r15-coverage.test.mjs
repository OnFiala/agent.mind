import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { indexProject, getScopedCoverage, readIndexedSource, INDEX_LIMITS } from '../code-index.mjs';
import { observeStrictJSON, observeTypedProgram, scopedDigest, COVERAGE_LIMITS } from '../scoped-coverage.mjs';
import { TYPED_REFERENCE_LIMITS, analyzeTypedSource } from '../typed-analysis.mjs';
import { analysisObservation } from '../scoped-coverage.mjs';

const config = '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}';
const resolver = { generic: true, scopedEvidence: true, resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
function fixture(t, files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r15-coverage-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text); };
  for (const [relative, text] of Object.entries({ 'tsconfig.json': config, 'main.ts': 'import "./value";', 'value.ts': 'export const value = 1;', ...files })) write(relative, text);
  return { root, write };
}
const origin = (coverage, relative = 'main.ts') => coverage.origins.find(item => item.path === relative);
const normalized = graph => { const value = structuredClone(graph); delete value.generatedAt; delete value.stats.parseMs; delete value.stats.cachedFiles; return value; };

test('V07 scoped sidecar preserves default/resolver legacy graph and does not leak through serialization', t => {
  const { root } = fixture(t);
  for (const options of [{ generic: true }, { ...resolver, scopedEvidence: false }]) {
    const baseline = indexProject(root, options), scoped = indexProject(root, { ...options, scopedEvidence: true });
    assert.deepEqual(normalized(scoped), normalized(baseline));
    assert.equal(scoped.revision, baseline.revision);
    assert.equal(getScopedCoverage(baseline), null);
    assert.equal(JSON.stringify(scoped).includes('scoped-origin-ledger-v1'), false);
    assert.equal(getScopedCoverage(scoped).enumeration.complete, true);
    assert.equal(getScopedCoverage(structuredClone(scoped)), null);
  }
});

test('G1 exact checked hashes, R13 facts and full R14 outcomes remain unchanged and isolated', t => {
  const { root } = fixture(t);
  const graph = indexProject(root, resolver), coverage = getScopedCoverage(graph), file = graph.nodes.find(node => node.path === 'main.ts');
  assert.equal(origin(coverage).hash, file.hash);
  assert.deepEqual(origin(coverage).references, file.referenceResolution.outcomes);
  assert.deepEqual(origin(coverage).analysis, { status: 'complete', producer: { parser: '@babel/parser@7.29.12', collector: 'typed-reference-syntax-v1', resolver: 'bundler-local-v1' }, parse: 'complete', referenceTraversal: 'complete' });
  assert.equal(coverage.runtimeId.length, 64);
  origin(coverage).references[0].status = 'forged';
  assert.equal(origin(getScopedCoverage(graph)).references[0].status, 'resolved');
  const warm = indexProject(root, { ...resolver, previous: graph });
  assert.deepEqual(getScopedCoverage(warm), getScopedCoverage(graph));
});

for (const source of ['import(location.hash)', 'class C { field=()=>import("./value"); static { require("./value"); } }', 'import X = require("./value")', 'type X = import("./value").X', 'require?.("./value")', 'const load = require; load("./value")', 'export = 1;']) test(`V01 exhaustive observation blocks unsupported source: ${source}`, t => {
  const { root } = fixture(t, { 'main.ts': source });
  const graph = indexProject(root, resolver), item = origin(getScopedCoverage(graph));
  assert.equal(item.analysis.status, 'unknown');
  assert(item.unsupported.length > 0);
  assert.equal(item.analysis.referenceTraversal, 'complete');
});

test('V02 parser success and empty restricted facts do not imply exhaustive coverage', () => {
  const envelope = { extraction: 'collected', unsupported: [], facts: [] };
  const result = observeTypedProgram({ type: 'Program', body: [{ type: 'FutureReference', start: 0, end: 1 }] }, envelope, TYPED_REFERENCE_LIMITS);
  assert.equal(result.status, 'unknown'); assert.equal(result.unsupported[0].reason, 'unrecognized-syntax');
  const withheld = observeTypedProgram({ type: 'Program', body: [] }, { ...envelope, extraction: 'withheld' }, TYPED_REFERENCE_LIMITS);
  assert.equal(withheld.referenceTraversal, 'withheld'); assert.equal(withheld.status, 'unknown');
  const limited = observeTypedProgram({ type: 'Program', body: [{ type: 'Identifier' }] }, envelope, { ...TYPED_REFERENCE_LIMITS, astNodes: 1 });
  assert.equal(limited.referenceTraversal, 'withheld'); assert.equal(limited.unsupported[0].reason, 'model-observer-limit');
});

for (const source of ['export const =', 'x'.repeat(65537), 'import "./value";' + 'import("x");'.repeat(2001)]) test(`V02 actual parse/byte/reference failures remain unknown (${source.length} chars)`, t => {
  const { root } = fixture(t, { 'main.ts': source });
  const item = origin(getScopedCoverage(indexProject(root, resolver)));
  assert.equal(item.analysis.status, 'unknown'); assert.equal(item.analysis.referenceTraversal, 'withheld');
});

test('V03 origin universe includes all admitted languages outside resolver scopeRoot', t => {
  const { root } = fixture(t, { 'inner/tsconfig.json': config, 'inner/selected.ts': 'export{}', 'outside.js': 'import "./main.ts";', 'outside.py': 'import selected', 'outside.html': '<script src="inner/selected.ts"></script>', 'outside.css': '@import "inner/selected.ts";', 'outside.md': '# text', 'outside.d.ts': 'import "./main";', 'unknown.bin': Buffer.from([0]) });
  const coverage = getScopedCoverage(indexProject(root, { ...resolver, resolverConfig: 'inner/tsconfig.json' }));
  for (const relative of ['main.ts', 'outside.js', 'outside.py', 'outside.html', 'outside.css', 'outside.md', 'outside.d.ts', 'unknown.bin']) assert(origin(coverage, relative), relative);
  for (const relative of ['outside.js', 'outside.py', 'outside.html', 'outside.css', 'outside.md', 'outside.d.ts', 'unknown.bin']) assert.equal(origin(coverage, relative).classification, 'unknown', relative);
  for (const relative of ['outside.js', 'outside.py']) { assert.equal(origin(coverage, relative).analysis.parse, 'complete'); assert.equal(origin(coverage, relative).analysis.referenceTraversal, 'complete'); }
  assert.equal(origin(coverage, 'outside.html').analysis.parse, 'not-observed');
  assert.equal(origin(coverage, 'unknown.bin').read.state, 'binary');
});

test('T13 JSON classification uses strict checked contents and explicit control roles', t => {
  const { root, write } = fixture(t, { 'asset.json': '{"count":1}', 'control.json': '{"nested":{"paths":{"x":["./main.ts"]}}}', 'project-map.json': '{"schemaVersion":1,"blocks":[]}' });
  let coverage = getScopedCoverage(indexProject(root, resolver));
  assert.equal(origin(coverage, 'asset.json').classification, 'json-non-origin'); assert.equal(origin(coverage, 'asset.json').jsonRole, 'none');
  assert.equal(origin(coverage, 'control.json').classification, 'unknown'); assert.equal(origin(coverage, 'control.json').jsonRole, 'unknown-control');
  for (const relative of ['tsconfig.json', 'project-map.json']) assert.equal(origin(coverage, relative).jsonRole, 'known-control');
  const previous = origin(coverage, 'asset.json').hash;
  write('asset.json', '{"count":1,"count":2}'); coverage = getScopedCoverage(indexProject(root, resolver));
  assert.notEqual(origin(coverage, 'asset.json').hash, previous); assert.equal(origin(coverage, 'asset.json').classification, 'unknown');
  write('project-map.json', '{"compilerOptions":{}}'); coverage = getScopedCoverage(indexProject(root, resolver));
  assert.equal(origin(coverage, 'project-map.json').jsonRole, 'unknown-control');
});

for (const source of ['\ufeff{}', '{"x":1,"\\u0078":2}', '{"x":1,}', '{/*comment*/}', '{} trailing', '['.repeat(257)+'0'+']'.repeat(257), '['+'0,'.repeat(99999)+'0]']) test(`T13 strict JSON fails closed: ${source.slice(0, 20)}`, () => {
  const value = observeStrictJSON(source); assert.equal(value.status, 'unknown'); assert.equal(value.parse, 'withheld');
});

test('T06 unseen descendants stay unknown; excluded branches are separate and never opened', t => {
  const { root, write } = fixture(t, { '.gitignore': 'excluded/\n', 'excluded/private.ts': 'throw Error("never execute")' });
  write('deep/'.repeat(INDEX_LIMITS.depth + 1) + 'unseen.ts', 'export{}');
  const opened = [], original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(String(name)); return original(name, ...args); });
  const coverage = getScopedCoverage(indexProject(root, resolver));
  assert.equal(coverage.enumeration.complete, false); assert(coverage.enumeration.boundaries.some(item => item.reason === 'depth-limit'));
  assert.equal(coverage.origins.some(item => item.path.includes('unseen.ts') || item.path.startsWith('excluded/')), false);
  assert.equal(opened.some(name => name.includes('/excluded/') || name.endsWith('/unseen.ts')), false);
  assert.equal(Object.hasOwn(coverage.enumeration, 'omittedCount'), false);
});

test('T06 unavailable directory is an unknown subtree, not a fictitious zero-file origin', t => {
  const { root } = fixture(t, { 'blocked/a.ts': 'export{}' }); const original = fs.opendirSync;
  t.mock.method(fs, 'opendirSync', (name, ...args) => { if (name === path.join(root, 'blocked')) throw new Error('injected directory denial'); return original(name, ...args); });
  const coverage = getScopedCoverage(indexProject(root, resolver));
  assert.equal(coverage.enumeration.complete, false); assert.deepEqual(coverage.enumeration.boundaries, [{ path: 'blocked', reason: 'directory-unreadable' }]);
  assert.equal(origin(coverage, 'blocked'), undefined); assert.equal(origin(coverage, 'blocked/a.ts'), undefined);
});

test('T08/T14 unread and oversized possible origins retain unavailable hashes and no asset waiver', t => {
  const { root } = fixture(t, { 'manual.pdf': Buffer.alloc(INDEX_LIMITS.fileBytes + 1), 'unread.ts': 'export{}' }); const original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { if (name === path.join(root, 'unread.ts')) throw new Error('injected read denial'); return original(name, ...args); });
  const coverage = getScopedCoverage(indexProject(root, resolver));
  for (const [relative, state] of [['manual.pdf','too-large'],['unread.ts','unreadable']]) { const item=origin(coverage,relative); assert.equal(item.read.state,state); assert.equal(item.hash,null); assert.equal(item.classification,'unknown'); assert.equal(item.analysis.status,'unknown'); }
});

test('T20 categories are producer observations; equal severity or text cannot whitelist a new diagnostic', t => {
  const { root } = fixture(t); const graph = indexProject(root, resolver);
  let coverage = getScopedCoverage(graph);
  assert(coverage.diagnostics.every(item => item.category !== 'unknown'));
  for (const item of coverage.diagnostics) assert.equal(item.digest, scopedDigest(graph.diagnostics[item.index]));
  graph.diagnostics.push(structuredClone(graph.diagnostics[0]));
  assert.equal(getScopedCoverage(graph).diagnostics.at(-1).category,'unknown');
  graph.diagnostics[0].message += ' changed';
  assert.equal(getScopedCoverage(graph).diagnostics[0].category,'unknown');
  graph.diagnostics.at(-1).severity='info'; assert.equal(getScopedCoverage(graph).diagnostics.at(-1).category,'unknown');
});

test('Invalid policy yields a sidecar with no invented admitted coverage', t => {
  const { root } = fixture(t, { '.gitignore': 'bad/**\n' });
  const coverage = getScopedCoverage(indexProject(root, resolver));
  assert.equal(coverage.enumeration.complete,false); assert.deepEqual(coverage.origins,[]); assert.equal(coverage.diagnostics[0].category,'invalid-policy');
});

for (const relative of ['.gitignore','project-map.json','main.ts']) test(`Scoped no-resolver mode checks resident metadata before opening ${relative}`, t => {
  const { root } = fixture(t, { '.gitignore':'# policy\n', 'project-map.json':'{"schemaVersion":1,"blocks":[]}' });
  const platform = Object.getOwnPropertyDescriptor(process,'platform'), exec = childProcess.execFileSync, open = fs.openSync, opened=[],checked=[];
  Object.defineProperty(process,'platform',{...platform,value:'darwin'});
  childProcess.execFileSync=(command,args)=>{assert.equal(command,'/usr/bin/stat');checked.push(args[2]);return args[2]===path.join(root,relative)?'1073741824\n':'0\n';};
  fs.openSync=(name,...args)=>{opened.push(String(name));return open(name,...args);}; syncBuiltinESMExports();
  try { const coverage=getScopedCoverage(indexProject(root,{generic:true,scopedEvidence:true})); assert(coverage); assert(checked.includes(path.join(root,relative))); assert.equal(opened.includes(path.join(root,relative)),false); }
  finally { childProcess.execFileSync=exec;fs.openSync=open;Object.defineProperty(process,'platform',platform);syncBuiltinESMExports(); }
});

test('Coverage bounds are frozen and observer sidecars cannot turn empty parse failures complete', () => {
  assert.deepEqual(COVERAGE_LIMITS,{origins:10000,referenceObservations:100000,evidenceBytes:16777216});
  const result=analyzeTypedSource('bad.ts','export const =','0'.repeat(64));
  assert.equal(analysisObservation(result).parse,'withheld');
  assert.equal(scopedDigest({b:2,a:{z:1,x:0}}),scopedDigest({a:{x:0,z:1},b:2}));
});

test('Mandatory coverage reference budget fails closed before origin ledger can silently truncate', t => {
  const { root, write } = fixture(t);
  for (let index = 0; index < 51; index++) write(`origin-${index}.ts`, 'import("x");'.repeat(2000));
  const coverage=getScopedCoverage(indexProject(root,resolver));
  assert.deepEqual(coverage.budget,{status:'exceeded',reason:'reference-observations'});
  assert.equal(coverage.enumeration.complete,false);
});

test('Mandatory coverage evidence byte budget fails closed while legacy outcomes remain intact', t => {
  const { root, write } = fixture(t);
  for (let index=0;index<20;index++) write(`origin-${index}.ts`,'import "bare";'.repeat(2000));
  const graph=indexProject(root,resolver),coverage=getScopedCoverage(graph);
  assert.deepEqual(coverage.budget,{status:'exceeded',reason:'evidence-bytes'});
  assert.equal(coverage.enumeration.complete,false);
  assert.equal(graph.nodes.find(node=>node.path==='origin-19.ts').referenceResolution.outcomes.length,2000);
});

test('Scoped no-resolver indexed source rereads also refuse hydration', t => {
  const { root }=fixture(t),options={generic:true,scopedEvidence:true};
  const graph=indexProject(root,options),node=graph.nodes.find(item=>item.path==='main.ts');
  const platform=Object.getOwnPropertyDescriptor(process,'platform'),exec=childProcess.execFileSync,open=fs.openSync,opened=[];
  Object.defineProperty(process,'platform',{...platform,value:'darwin'});
  childProcess.execFileSync=(_command,args)=>args[2]===path.join(root,'main.ts')?'1073741824\n':'0\n';
  fs.openSync=(name,...args)=>{opened.push(String(name));return open(name,...args);};syncBuiltinESMExports();
  try { assert.throws(()=>readIndexedSource(root,node,options),/Cloud-only/);assert.equal(opened.includes(path.join(root,'main.ts')),false); }
  finally {childProcess.execFileSync=exec;fs.openSync=open;Object.defineProperty(process,'platform',platform);syncBuiltinESMExports();}
});

test('V02 actual exhausted R14 resolution cannot leave an empty complete model observation', t => {
  const { root,write }=fixture(t,{'main.ts':'export{}'});
  for(let index=0;index<23;index++)write(`many${index}.ts`,'import "./value";'.repeat(2000));
  const graph=indexProject(root,resolver),coverage=getScopedCoverage(graph);
  assert(graph.diagnostics.some(item=>item.code==='TYPED_RESOLVER_LIMIT'));
  for(const item of coverage.origins.filter(item=>item.classification==='typed-origin')) {
    assert.equal(item.analysis.status,'unknown');
    assert(item.unsupported.some(value=>value.reason==='resolver-reference-withheld'));
    assert.deepEqual(item.references,[]);
  }
});
