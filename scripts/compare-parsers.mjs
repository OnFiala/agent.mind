// Offline, developer-run comparison. Install candidates in a disposable directory
// with scripts disabled first. Input projects are read as text, never imported.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const CAP = 64 * 1024;
const VERSIONS = { babel: ['@babel/parser', '7.29.12'], typescript: ['typescript', '6.0.3'] };
const synthetic = () => {
  const files = [];
  for (const newline of ['\n', '\r\n']) {
    files.push({ path: `unicode-${newline.length}.ts`, source: ['/*🧠*/ export function café<T>(value: T): T {', ' return value;', '}', 'export interface Box<T> { value: T; }', 'export type Choice = "left" | "right";', 'export enum Flag { On, Off }'].join(newline), valid: true });
    files.push({ path: `view-${newline.length}.tsx`, source: ['interface Props { label: string }', 'export const View = ({label}: Props) => <span>{label}</span>;'].join(newline), valid: true });
    files.push({ path: `view-${newline.length}.jsx`, source: 'export function View({label}) { return <span>{label}</span>; }', valid: true });
    files.push({ path: `broken-${newline.length}.ts`, source: 'export const broken: = ;', valid: false });
  }
  let dense = '';
  for (let i = 0; ; i++) {
    const line = `export function f${i}(v:number):number{return v+1;}\n`;
    if (Buffer.byteLength(dense + line) > CAP) break;
    dense += line;
  }
  files.push({ path: 'stress-dense.ts', source: dense, valid: true });
  files.push({ path: 'stress-depth.ts', source: `const x = ${'['.repeat(10000)}0${']'.repeat(10000)};`, valid: null });
  return files;
};
function corpus(root) {
  const entries = [], omitted = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name, 'en'))) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'test', 'tests', '__tests__', 'fixtures'].includes(entry.name)) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && /\/src\//.test(name) && /\.(?:ts|tsx|jsx)$/.test(name)) {
        const bytes = fs.readFileSync(path.join(root, name));
        if (name.endsWith('.d.ts')) omitted.push({ path: name, reason: 'ambient declaration file outside pilot' });
        else if (bytes.length > CAP) omitted.push({ path: name, reason: '64 KiB pilot cap', bytes: bytes.length });
        else entries.push({ path: name, source: bytes.toString('utf8') });
      }
    }
  }
  walk('packages');
  entries.sort((a,b)=>a.path.localeCompare(b.path, 'en'));
  const files = []; let bytes = 0;
  for (const file of entries) {
    if (files.length >= 100 || bytes + Buffer.byteLength(file.source) > 2 * 1024 * 1024) omitted.push({ path: file.path, reason: 'corpus file/byte budget' });
    else { files.push(file); bytes += Buffer.byteLength(file.source); }
  }
  return { files, omitted, bytes, digest: HASH(JSON.stringify(files.map(f=>[f.path,HASH(f.source)]))) };
}
function loadParser(kind, packages) {
  const [name, version] = VERSIONS[kind] ?? [];
  assert(name, 'Unknown candidate');
  const root = path.join(packages, 'node_modules', name);
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.version, version, 'Comparison requires exact pinned candidate');
  const require = createRequire(path.join(packages, 'package.json'));
  const api = require(name);
  return { root, metadata, parse(name, source) {
    if (kind === 'babel') return api.parse(source, { sourceType: 'module', sourceFilename: name, errorRecovery: false, attachComment: false, ranges: true, plugins: name.endsWith('.jsx') ? ['jsx'] : name.endsWith('.tsx') ? ['typescript','jsx'] : ['typescript'] });
    const scriptKind = name.endsWith('.jsx') ? api.ScriptKind.JSX : name.endsWith('.tsx') ? api.ScriptKind.TSX : api.ScriptKind.TS;
    const ast = api.createSourceFile(name, source, api.ScriptTarget.Latest, false, scriptKind);
    if (ast.parseDiagnostics.length) throw new Error(api.flattenDiagnosticMessageText(ast.parseDiagnostics[0].messageText, '\n'));
    return ast;
  }, count(ast) {
    let count = 0; const stack = [ast];
    while (stack.length) {
      const node = stack.pop(); count++;
      if (kind === 'typescript') api.forEachChild(node, child => { stack.push(child); });
      else for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child.type === 'string') stack.push(child);
        } else if (value && typeof value.type === 'string') stack.push(value);
      }
    }
    return count;
  }, location(ast, source) {
    const declaration = kind === 'babel' ? ast.program.body[0].declaration : ast.statements[0];
    const start = kind === 'babel' ? declaration.start : declaration.getStart(ast);
    const loc = kind === 'babel' ? declaration.loc.start : ast.getLineAndCharacterOfPosition(start);
    return { start, line: kind === 'babel' ? loc.line : loc.line + 1, column: (kind === 'babel' ? loc.column : loc.character) + 1, end: kind === 'babel' ? declaration.end : declaration.getEnd() };
  } };
}
function worker(kind, packages, root) {
  const real = corpus(root), fixtures = synthetic(), files = [...real.files, ...fixtures];
  const baselineRSS = process.memoryUsage().rss;
  const coldStart = performance.now(), parser = loadParser(kind, packages);
  const loadedMs = performance.now() - coldStart;
  const cache = new Map(); const samples = [];
  function scan(input) {
    let cached = 0;
    for (const file of input) {
      const hash = HASH(file.source);
      if (cache.get(file.path)?.hash === hash) { cached++; continue; }
      const start = performance.now(); let nodes = 0, error = null;
      try { const ast = parser.parse(file.path, file.source); nodes = parser.count(ast); }
      catch (caught) { error = caught.message; }
      samples.push({ path: file.path, bytes: Buffer.byteLength(file.source), ms: performance.now()-start, nodes, error });
      if (file.valid !== undefined && file.valid !== null) assert.equal(error === null, file.valid, file.path);
      cache.set(file.path, { hash, nodes, error });
    }
    return cached;
  }
  scan(files); const coldMs = performance.now()-coldStart;
  const warmStart = performance.now(), cachedFiles = scan(files), unchangedMs = performance.now()-warmStart;
  const edited = files.map((f,i)=>i===0 ? {...f,source:'// edit\n'+f.source} : f);
  const updateStart = performance.now(), updateCached = scan(edited), updateMs = performance.now()-updateStart;
  for (const file of fixtures.filter(f=>f.path.startsWith('unicode'))) {
    const ast=parser.parse(file.path,file.source),loc=parser.location(ast,file.source);
    // TS getStart includes export; Babel's declaration starts at function. Both
    // must preserve raw UTF-16 offsets; check each parser's documented boundary.
    assert.equal(loc.start,file.source.indexOf(kind==='babel'?'function':'export'));
    assert.equal(loc.line,1); assert.equal(loc.column,loc.start+1);
    assert.equal(file.source.slice(loc.start,loc.end).endsWith('}'),true);
  }
  const peakRSS = process.resourceUsage().maxRSS * 1024;
  return { kind, version: parser.metadata.version, real: { files: real.files.length, bytes: real.bytes, digest: real.digest, omitted: real.omitted }, fixtures: fixtures.length, loadedMs,coldMs,unchangedMs,updateMs,cachedFiles,updateCached,baselineRSS,peakRSS,increaseRSS:peakRSS-baselineRSS,samples };
}
const args=process.argv.slice(2);
if (args[0]==='--worker') console.log(JSON.stringify(worker(args[1],path.resolve(args[2]),path.resolve(args[3]))));
else {
  if (args.length!==2) throw new Error('Usage: node scripts/compare-parsers.mjs /absolute/candidate-package-root /absolute/signals-root');
  const runs={};
  for (const kind of Object.keys(VERSIONS)) {
    runs[kind]=[];
    for (let i=0;i<3;i++) {
      const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',kind,...args.map(p=>path.resolve(p))],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
      if (result.status!==0) throw new Error(`${kind}: ${result.error?.message || result.stderr}`);
      runs[kind].push(JSON.parse(result.stdout));
    }
  }
  const footprint={};
  for (const [kind,[name,version]] of Object.entries(VERSIONS)) {
    const root=path.join(path.resolve(args[0]),'node_modules',name);
    const files=kind==='babel'?['LICENSE','package.json','lib/index.js']:['LICENSE.txt','ThirdPartyNoticeText.txt','package.json','lib/typescript.js'];
    const payload=files.map(p=>fs.readFileSync(path.join(root,p)));
    footprint[kind]={name,version,files,bytes:payload.reduce((n,b)=>n+b.length,0),gzipConcatenatedBytes:gzipSync(Buffer.concat(payload)).length,hashes:Object.fromEntries(files.map((p,i)=>[p,HASH(payload[i])]))};
  }
  console.log(JSON.stringify({host:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,os:os.release()},footprint,runs},null,2));
}
