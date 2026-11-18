// Verify P1 declarations-only -> R13 syntax -> P1 rollback on disposable source.
// Never execute the scanned project or mutate either supplied release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-typed-rollback.mjs /absolute/pinned-P1-baseline /absolute/candidate-release');
const oldRelease = fs.realpathSync(args[0]), candidateRelease = fs.realpathSync(args[1]);
assert.notEqual(oldRelease, candidateRelease);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(root, prefix = '') {
  const values = {};
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `Unexpected artifact/fixture symlink: ${relative}`);
    if (entry.isDirectory()) Object.assign(values, { [`${relative}/`]: 'directory' }, snapshot(root, relative));
    else { assert(entry.isFile()); values[relative] = sha(fs.readFileSync(path.join(root, relative))); }
  }
  return values;
}
const artifactBytes = [snapshot(oldRelease), snapshot(candidateRelease)];
const oldVerifier = await import(pathToFileURL(path.join(oldRelease, 'installation.mjs')));
const candidateVerifier = await import(pathToFileURL(path.join(candidateRelease, 'installation.mjs')));
const oldArtifact = oldVerifier.verifyArtifact(oldRelease);
const candidateArtifact = candidateVerifier.verifyArtifact(candidateRelease);
assert.equal(oldArtifact.version, '1.4.0');
assert.equal(oldArtifact.digest, '63dcffc91f79a788dab8a933c3a8e778e4370cab3968d2da8580a6ff018bbf93', 'Use exact unreleased P1 declarations-only payload; published 1.4.0 has policy v1');
assert.notEqual(candidateArtifact.digest, oldArtifact.digest, 'Digest identifies candidates even when package versions match');

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-typed-rollback-')));
const project = path.join(temporary, 'synthetic project with spaces');
const parkedRoot = path.join(temporary, 'parked outside project');
const unrelated = path.join(temporary, 'unrelated cwd');
for (const directory of [project, parkedRoot, unrelated]) fs.mkdirSync(directory);
const integration = path.join(project, 'agent.mind');
const installedCLI = path.join(integration, 'cli.mjs');
const mapPath = path.join(integration, 'project-map.json');
const ignorePath = path.join(project, '.gitignore');
const savedMapPath = path.join(parkedRoot, 'saved-project-map.json');
const savedOwnerPath = path.join(parkedRoot, 'saved-owner-data.txt');
const env = { ...process.env }; delete env.AGENT_MIND_PROJECT;
const receipts = [], parked = [], checks = [];
let view, report;
const run = (cli, argv, expectedError) => {
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd: unrelated, env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message);
  if (expectedError) {
    assert.notEqual(result.status, 0, `Expected rejection: ${argv.join(' ')}`);
    assert.match(result.stderr, expectedError);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const ownerIgnore = Buffer.from('# Owner P1 policy remains v2 on R13 rollback\r\n*.py[cod]\r\n');
let expectedIgnore = ownerIgnore;
const typedSource = '// 🧠 Preserve raw CRLF and escapes.\r\nimport type { Remote as Alias } from "./remote\\u002ets";\r\nimport fs from "node:fs";\r\nexport { value } from "../app.mjs";\r\nexport interface Box { value: string; }\r\nexport function typed(value: Box): string { return value.value; }\r\nconst deferred = import("../app.mjs");\r\n';
const hostFiles = {
  'AGENTS.md': '\ufeff# Owner instructions\r\nNever execute scanned source. Preserve these bytes.\r\n',
  'package.json': '{"name":"typed-fixture","private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
  'package-lock.json': '{"name":"typed-fixture","lockfileVersion":3,"packages":{}}\n',
  'owner-note.txt': 'Host owner note.\n',
  'app.mjs': 'throw new Error("SCANNED SOURCE MUST NEVER EXECUTE");\nexport const value = 1;\n',
  'src/typed.ts': typedSource,
  'cache.pyc': 'Synthetic excluded bytecode stand-in; never execute.\n',
};
fs.mkdirSync(path.join(project, 'src'));
for (const [relative, bytes] of Object.entries(hostFiles)) fs.writeFileSync(path.join(project, relative), bytes);
fs.writeFileSync(ignorePath, expectedIgnore);
const mapBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'typed', label: 'Owner typed', aliases: ['owner-alias'], description: 'Synthetic fixture only', files: ['src/typed.ts'], prefixes: [], type: 'module', group: 'core' }], parts: [{ target: 'symbol:src/typed.ts#Box', label: 'Owner Box', aliases: ['owner-box'], description: 'Preserve original declaration name' }] }, null, 2).replaceAll('\n', '\r\n')}\r\n`);
const ownerData = Buffer.from('Custom integration owner data preserved across transitions.\r\n');
const identity = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
function assertHost(attached = true) {
  for (const [relative, bytes] of Object.entries(hostFiles)) {
    if (relative === 'AGENTS.md' && attached) assert(fs.readFileSync(path.join(project, relative), 'utf8').startsWith(bytes));
    else assert.deepEqual(fs.readFileSync(path.join(project, relative)), Buffer.from(bytes), `Host changed: ${relative}`);
  }
  assert.deepEqual(fs.readFileSync(ignorePath), expectedIgnore);
  assert(!fs.existsSync(path.join(project, 'node_modules')));
}
function context(artifact, referencesEnabled) {
  const status = run(installedCLI, ['status']);
  assert.equal(status.state, 'attached'); assert.equal(status.integrity, 'verified'); assert.deepEqual(status.conflicts, []);
  assert.equal(status.root, project); assert.equal(status.binding.root, project);
  assert.equal(status.runtime.digest, artifact.digest); assert.equal(status.runtime.version, artifact.version);
  assert.deepEqual(fs.readFileSync(mapPath), mapBytes);
  assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), ownerData);
  const result = run(installedCLI, ['context']);
  assert.equal(result.project.root, project); assert.equal(result.binding.id, status.binding.id);
  assert.equal(result.inputPolicy.version, 'root-ignore-v2'); assert.equal(result.inputPolicy.status, 'valid');
  assert.equal(result.status, 'partial');
  assert.equal(run(installedCLI, ['context', 'owner-alias']).selection.id, 'block:typed');
  assert.equal(run(installedCLI, ['context', 'owner-box']).selection.id, 'symbol:src/typed.ts#Box');
  for (const flags of [[], ['--profile', 'agent']]) run(installedCLI, ['preflight', 'src/typed.ts', ...flags, ...identity(result)], /partial/i);
  const node = result.nodes.find(item => item.id === 'file:src/typed.ts');
  assert(node); assert.equal(node.hash, sha(Buffer.from(typedSource)));
  assert.equal(node.capabilities.includes('static-reference-syntax'), referencesEnabled);
  assert(!node.capabilities.includes('static-references')); assert.deepEqual(node.security, []);
  assert.deepEqual(result.edges, []); assert.deepEqual(result.symbolGraph.edges, []);
  assert(!result.nodes.some(item => item.kind === 'external'));
  assert(!result.nodes.some(item => item.path === 'cache.pyc'));
  if (referencesEnabled) {
    const syntax = node.referenceSyntax;
    assert.equal(syntax.version, 'typed-reference-syntax-v1'); assert.equal(syntax.extraction, 'collected');
    assert.deepEqual(syntax.resolution, { status: 'unsupported', reason: 'typed-resolution-not-enabled' });
    assert.deepEqual(syntax.facts.map(fact => [fact.kind, fact.specifier, fact.typed.typeOnly]), [['import', './remote.ts', true], ['import', 'node:fs', false], ['reexport', '../app.mjs', false]]);
    assert.equal(syntax.unsupported.length, 1);
    const raw = '"./remote\\u002ets"', evidence = syntax.facts[0].evidence;
    assert.equal(evidence.range.start, typedSource.indexOf(raw));
    assert.equal(typedSource.slice(evidence.range.start, evidence.range.end), raw);
    assert.equal(evidence.hash, node.hash); assert.equal(evidence.path, 'src/typed.ts');
    assert.equal(evidence.range.unit, 'utf16-code-unit'); assert.equal(evidence.range.endExclusive, true);
    assert.deepEqual(evidence.producer, { name: '@babel/parser', version: '7.29.12', mode: 'syntax-only' });
  } else assert.equal(Object.hasOwn(node, 'referenceSyntax'), false);
  assertHost();
  receipts.push({ digest: artifact.digest, version: artifact.version, referencesEnabled, policyVersion: result.inputPolicy.version, policyId: result.inputPolicy.id, bindingId: status.binding.id, generation: status.binding.generation, revision: result.revision, status: result.status });
  return result;
}
function install(release, artifact, referencesEnabled) {
  assert.equal(run(path.join(release, 'cli.mjs'), ['install', '--project', project, '--release', release, '--digest', artifact.digest, '--attach']).state, 'attached');
  // Restore only saved owner inputs, never runtime/descriptor/managed instructions.
  fs.writeFileSync(mapPath, fs.existsSync(savedMapPath) ? fs.readFileSync(savedMapPath) : mapBytes);
  fs.writeFileSync(path.join(integration, 'owner-data.txt'), fs.existsSync(savedOwnerPath) ? fs.readFileSync(savedOwnerPath) : ownerData);
  return context(artifact, referencesEnabled);
}
async function stopView() {
  if (!view) return;
  const child = view; view = null;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned view did not stop')), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function startView() {
  view = spawn(process.execPath, [installedCLI, 'view'], { cwd: unrelated, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '', error = '';
    const timer = setTimeout(() => reject(new Error(`View readiness timeout: ${error}`)), 10000);
    view.once('error', err => { clearTimeout(timer); reject(err); });
    view.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited ${code}: ${error}`)); });
    view.stderr.on('data', bytes => { error += bytes; });
    view.stdout.on('data', bytes => { output += bytes; try { const value = JSON.parse(output); if (value.url) { clearTimeout(timer); resolve(value); } } catch {} });
  });
}
const sourceURL = (url, receipt) => `${url}/api/source?path=src%2Ftyped.ts&policyId=${receipt.inputPolicy.id}&revision=${receipt.revision}`;
async function sourceStatus(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, expected);
  return response;
}
function rejectReceipt(previous, current) {
  assert.notEqual(current.binding.id, previous.binding.id);
  run(installedCLI, ['context', ...identity(previous)], /binding.*expired|revision changed/i);
  run(installedCLI, ['preflight', 'app.mjs', ...identity(previous)], /binding.*expired|revision changed|partial|current context|active index/i);
}
function uninstallAndPark(label) {
  const savedMap = fs.readFileSync(mapPath), savedOwner = fs.readFileSync(path.join(integration, 'owner-data.txt'));
  assert.deepEqual(savedMap, mapBytes); assert.deepEqual(savedOwner, ownerData);
  fs.writeFileSync(savedMapPath, savedMap); fs.writeFileSync(savedOwnerPath, savedOwner);
  const suffix = `\nOwner README modification: ${label}\n`;
  fs.appendFileSync(path.join(integration, 'README.md'), suffix);
  assert.equal(run(installedCLI, ['uninstall']).state, 'uninstalled'); // Its own currently installed CLI.
  assertHost(false);
  assert.deepEqual(fs.readFileSync(mapPath), savedMap);
  assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), savedOwner);
  assert(fs.readFileSync(path.join(integration, 'README.md'), 'utf8').endsWith(suffix));
  const receipt = JSON.parse(fs.readFileSync(path.join(integration, '.local/install.json')));
  assert.equal(receipt.state, 'uninstalled'); assert(receipt.recovery.length > 0);
  assert(receipt.recovery.some(entry => entry.source === 'AGENTS.md' && fs.readFileSync(path.join(integration, entry.path), 'utf8') === hostFiles['AGENTS.md']));
  for (const entry of receipt.recovery) {
    assert.equal(entry.phase, 'retained');
    if (entry.source !== 'AGENTS.md') assert.equal(sha(fs.readFileSync(path.join(integration, entry.path))), receipt.owned[entry.source]);
  }
  const destination = path.join(parkedRoot, label), contents = snapshot(integration);
  assert(!destination.startsWith(`${project}${path.sep}`)); assert(!fs.existsSync(destination));
  fs.renameSync(integration, destination); assert.deepEqual(snapshot(destination), contents);
  parked.push({ path: destination, contents });
  // Retain only these owner bytes for fresh installation, never parked runtime data.
  assert.deepEqual(fs.readFileSync(savedMapPath), mapBytes); assert.deepEqual(fs.readFileSync(savedOwnerPath), ownerData);
}
try {
  const original = install(oldRelease, oldArtifact, false);
  const oldBounded = run(installedCLI, ['context', 'src/typed.ts', '--profile', 'agent']);
  const { contextCursor } = await import(pathToFileURL(path.join(oldRelease, 'graph-context.mjs')));
  const oldCursor = contextCursor(oldBounded, 'diagnostics');
  assert.equal(run(installedCLI, ['context', 'src/typed.ts', '--profile', 'agent', '--cursor', oldCursor, ...identity(original)]).snapshot, oldBounded.snapshot);
  uninstallAndPark('P1 declarations before R13');
  const candidate = install(candidateRelease, candidateArtifact, true);
  assert.equal(candidate.inputPolicy.id, original.inputPolicy.id, 'R13 keeps the independent P1 policy contract');
  assert.deepEqual(candidate.symbolGraph.nodes.map(node => node.id), original.symbolGraph.nodes.map(node => node.id));
  rejectReceipt(original, candidate);
  run(installedCLI, ['context', 'src/typed.ts', '--profile', 'agent', '--cursor', oldCursor, ...identity(original)], /binding.*expired|revision changed/i);
  const candidateView = await startView();
  await sourceStatus(sourceURL(candidateView.url, original), 409);
  const source = await sourceStatus(sourceURL(candidateView.url, candidate), 200);
  assert.equal((await source.json()).hash, sha(Buffer.from(typedSource)));
  const graph = await (await fetch(`${candidateView.url}/api/graph`, { signal: AbortSignal.timeout(5000) })).json();
  assert.deepEqual(graph.nodes.find(node => node.id === 'file:src/typed.ts').referenceSyntax, candidate.nodes.find(node => node.id === 'file:src/typed.ts').referenceSyntax);
  expectedIgnore = Buffer.concat([ownerIgnore, Buffer.from('/src/typed.ts\r\n')]);
  fs.writeFileSync(ignorePath, expectedIgnore);
  await sourceStatus(sourceURL(candidateView.url, candidate), 409);
  const excluded = await (await fetch(`${candidateView.url}/api/graph`, { signal: AbortSignal.timeout(5000) })).json();
  assert(!excluded.nodes.some(node => node.id === 'file:src/typed.ts'));
  assert(!JSON.stringify(excluded).includes('"specifier":"node:fs"'));
  expectedIgnore = ownerIgnore; fs.writeFileSync(ignorePath, expectedIgnore);
  const recovered = context(candidateArtifact, true);
  await sourceStatus(sourceURL(candidateView.url, recovered), 200);
  await stopView();
  checks.push('Installed R13 carries exact raw syntax facts/producer/hash with no inferred edges, preserves partial strict refusal, matches live graph and revokes excluded source/facts');

  uninstallAndPark('R13 syntax before rollback');
  const restored = install(oldRelease, oldArtifact, false);
  rejectReceipt(recovered, restored);
  assert.equal(restored.inputPolicy.id, original.inputPolicy.id);
  assert.deepEqual(restored.symbolGraph.nodes.map(node => node.id), original.symbolGraph.nodes.map(node => node.id));
  const rollbackView = await startView();
  await sourceStatus(sourceURL(rollbackView.url, recovered), 409);
  await sourceStatus(sourceURL(rollbackView.url, restored), 200);
  await stopView();
  checks.push('Own-CLI uninstall/reinstall round trip removes R13 facts/capability while preserving P1 root-ignore-v2 set behavior, stable declaration names, maps, owner bytes and strict partial refusal');
  for (const entry of parked) assert.deepEqual(snapshot(entry.path), entry.contents, 'Parked recovery/modified owned files changed');
  assert.deepEqual(snapshot(oldRelease), artifactBytes[0]); assert.deepEqual(snapshot(candidateRelease), artifactBytes[1]);
  oldVerifier.verifyArtifact(oldRelease, oldArtifact.digest); candidateVerifier.verifyArtifact(candidateRelease, candidateArtifact.digest);
  checks.push('Old source/continuation/context receipts rejected across runtime changes; modified README, map/owner backups, recovery, source bytes and both input artifacts preserved');
  report = { status: 'passed', baseline: { sourceCommit: 'c80b8aa6a07c9cdbd6930af8114f78d9f7baca2d', version: oldArtifact.version, digest: oldArtifact.digest, published: false }, candidate: { version: candidateArtifact.version, digest: candidateArtifact.digest }, checks, receipts, scope: 'Disposable synthetic target only; no scanned source or package scripts executed.', instructionActivation: 'not-verified; installed CLI smoke cannot establish host instruction loading', cleanup: 'Owned foreground views stopped; only harness-owned temporary tree removed.' };
} finally {
  await stopView();
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
