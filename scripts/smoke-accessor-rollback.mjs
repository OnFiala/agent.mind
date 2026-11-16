// Exercise real installed CLIs on disposable source; never execute the scanned project.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-accessor-rollback.mjs /absolute/published-1.3.1 /absolute/candidate-release');
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
assert.equal(oldArtifact.version, '1.3.1');
assert.equal(oldArtifact.digest, 'a4ebaf5b35e82cee108c3a7649804e0a2c9688034363ea43f0c324614c62c306', 'Use the exact published 1.3.1 payload');
assert.notEqual(candidateArtifact.digest, oldArtifact.digest, 'Candidate identity is its digest; same-version candidates are valid');

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-accessor-rollback-')));
const project = path.join(temporary, 'synthetic source with spaces');
const parkedRoot = path.join(temporary, 'parked outside project');
const unrelated = path.join(temporary, 'unrelated cwd');
for (const directory of [project, parkedRoot, unrelated]) fs.mkdirSync(directory);
const integration = path.join(project, 'agent.mind');
const installedCLI = path.join(integration, 'cli.mjs');
const mapPath = path.join(integration, 'project-map.json');
const env = { ...process.env }; delete env.AGENT_MIND_PROJECT;
const receipts = [], parked = [], checks = [];
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
const legacyGetter = 'symbol:app.mjs#Store.value';
const legacyChild = `${legacyGetter}.child`;
const getter = `symbol:app.mjs#@accessor:${JSON.stringify(['Store', ['value', 'get', false, false]])}`;
const setter = `symbol:app.mjs#@accessor:${JSON.stringify(['Store', ['value', 'set', false, false]])}`;
const child = `symbol:app.mjs#@accessor:${JSON.stringify(['Store', ['value', 'get', false, false], 'child'])}`;
const singleton = `throw new Error('SCANNED SOURCE MUST NEVER EXECUTE');\nclass Store {\n  get value() { function child() {} child(); return 1; }\n}\n`;
const pair = singleton.replace('\n}\n', '\n  set value(next) {}\n}\n');
let source = singleton;
const hostFiles = {
  'AGENTS.md': '\ufeff# Owner instructions\r\nOwner source must never execute. Preserve these bytes.\r\n',
  'package.json': '{"name":"accessor-fixture","private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
  'package-lock.json': '{"name":"accessor-fixture","lockfileVersion":3,"packages":{}}\n',
  'owner-note.txt': 'Unrelated host owner note.\n'
};
for (const [relative, bytes] of Object.entries(hostFiles)) fs.writeFileSync(path.join(project, relative), bytes);
fs.writeFileSync(path.join(project, 'app.mjs'), source);
const namedPart = (target, label) => ({ target, label, aliases: [], description: 'Owner name' });
const map = parts => Buffer.from(`${JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'app', label: 'App', aliases: [], description: 'Synthetic source only', files: ['app.mjs'], prefixes: [], type: 'module', group: 'core' }], parts }, null, 2).replaceAll('\n', '\r\n')}\r\n`);
const oldMap = map([namedPart(legacyGetter, 'Owner getter'), namedPart(legacyChild, 'Owner child')]);
const newMap = map([namedPart(getter, 'Owner getter'), namedPart(child, 'Owner child')]);
let expectedMap = oldMap;
const receiptArgs = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
function assertHost(attached = true) {
  for (const [relative, bytes] of Object.entries(hostFiles)) {
    if (relative === 'AGENTS.md' && attached) {
      assert(fs.readFileSync(path.join(project, relative), 'utf8').startsWith(bytes));
    } else assert.deepEqual(fs.readFileSync(path.join(project, relative)), Buffer.from(bytes), `Host file changed: ${relative}`);
  }
  assert.equal(fs.readFileSync(path.join(project, 'app.mjs'), 'utf8'), source);
  assert(!fs.existsSync(path.join(project, 'node_modules')), 'Target dependencies must not be installed');
}
function ready(artifact) {
  const status = run(installedCLI, ['status']);
  assert.equal(status.state, 'attached'); assert.equal(status.integrity, 'verified'); assert.deepEqual(status.conflicts, []);
  assert.equal(status.root, project); assert.equal(status.binding.root, project);
  assert.equal(status.runtime.digest, artifact.digest); assert.equal(status.runtime.version, artifact.version);
  assert.deepEqual(fs.readFileSync(mapPath), expectedMap);
  const context = run(installedCLI, ['context', 'app.mjs']);
  assert.equal(context.project.root, project); assert.equal(context.binding.id, status.binding.id);
  assertHost();
  receipts.push({ digest: artifact.digest, version: artifact.version, bindingId: status.binding.id, generation: status.binding.generation, revision: context.revision, status: context.status });
  return context;
}
function install(release, artifact) {
  const result = run(path.join(release, 'cli.mjs'), ['install', '--project', project, '--release', release, '--digest', artifact.digest, '--attach']);
  assert.equal(result.state, 'attached');
  fs.writeFileSync(mapPath, expectedMap);
  return ready(artifact);
}
function uninstallAndPark(label) {
  const savedMap = fs.readFileSync(mapPath);
  assert.deepEqual(savedMap, expectedMap);
  const ownerBytes = Buffer.from(`Unknown integration owner note: ${label}\n`);
  fs.writeFileSync(path.join(integration, 'owner-note.txt'), ownerBytes);
  const attachedAgents = fs.readFileSync(path.join(project, 'AGENTS.md'));
  const allowedAgentsHashes = new Set([sha(Buffer.from(hostFiles['AGENTS.md'])), sha(attachedAgents)]);
  const recoveredAgentsHashes = new Set();
  const removed = run(installedCLI, ['uninstall']);
  assert.equal(removed.state, 'uninstalled');
  assertHost(false);
  assert.deepEqual(fs.readFileSync(mapPath), savedMap);
  assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-note.txt')), ownerBytes);
  const receipt = JSON.parse(fs.readFileSync(path.join(integration, '.local/install.json')));
  assert.equal(receipt.state, 'uninstalled'); assert(receipt.recovery.length > 0);
  for (const entry of receipt.recovery) {
    assert.equal(entry.phase, 'retained');
    const bytes = fs.readFileSync(path.join(integration, entry.path));
    if (entry.source === 'AGENTS.md') {
      // Attach retains the prior owner file; detach retains the attached file
      // it replaces. Both are complete, known pre-operation snapshots.
      assert(allowedAgentsHashes.has(sha(bytes)), 'Unknown AGENTS recovery bytes');
      recoveredAgentsHashes.add(sha(bytes));
    }
    else assert.equal(sha(bytes), receipt.owned[entry.source]);
  }
  assert.deepEqual(recoveredAgentsHashes, allowedAgentsHashes, 'Both owner and attached AGENTS snapshots remain in recovery');
  const destination = path.join(parkedRoot, label), contents = snapshot(integration);
  assert(!destination.startsWith(`${project}${path.sep}`)); assert(!fs.existsSync(destination));
  fs.renameSync(integration, destination);
  assert.deepEqual(snapshot(destination), contents);
  parked.push({ path: destination, contents });
}
function rejectReceipt(previous, current) {
  assert.notEqual(current.binding.id, previous.binding.id);
  run(installedCLI, ['context', 'app.mjs', ...receiptArgs(previous)], /binding.*expired|revision changed/i);
  run(installedCLI, ['context', 'app.mjs', '--revision', current.revision, '--binding-id', previous.binding.id, '--generation', String(previous.binding.generation)], /binding.*expired/i);
}
function assertNode(context, target, label) {
  assert(context.symbolGraph.nodes.some(node => node.id === target));
  assert.equal(run(installedCLI, ['context', target]).selection.label, label);
}
try {
  const old = install(oldRelease, oldArtifact);
  assert.equal(old.status, 'current');
  assertNode(old, legacyGetter, 'Owner getter'); assertNode(old, legacyChild, 'Owner child');
  assert.equal(run(installedCLI, ['preflight', 'app.mjs', ...receiptArgs(old)]).preflight, 'verified-at-read');
  uninstallAndPark('published before candidate');
  const candidate = install(candidateRelease, candidateArtifact);
  assert.equal(candidate.status, 'current'); rejectReceipt(old, candidate);
  assert.equal(run(installedCLI, ['context', legacyGetter]).selection.id, getter);
  assert.equal(run(installedCLI, ['context', legacyChild]).selection.id, child);
  assertNode(candidate, getter, 'Owner getter'); assertNode(candidate, child, 'Owner child');
  checks.push('Published singleton old map binds uniquely after candidate install without map-byte migration');

  source = pair; fs.writeFileSync(path.join(project, 'app.mjs'), source);
  run(installedCLI, ['context', legacyGetter], /ambiguous/i);
  const paired = ready(candidateArtifact);
  assert(paired.symbolGraph.nodes.some(node => node.id === getter));
  assert(paired.symbolGraph.nodes.some(node => node.id === setter));
  assert.equal(run(installedCLI, ['context', getter]).selection.id, getter);
  assert.equal(run(installedCLI, ['context', child]).selection.id, child);
  assert.equal(paired.vocabulary.some(node => node.label === 'Owner getter'), false);
  assert.match(JSON.stringify(paired.diagnostics), /ambig/i);
  expectedMap = newMap; fs.writeFileSync(mapPath, expectedMap);
  const namedPair = ready(candidateArtifact);
  assertNode(namedPair, getter, 'Owner getter'); assertNode(namedPair, child, 'Owner child');
  checks.push('Pair keeps canonical identities; ambiguous old selector fails and explicit new-ID map names exact parts');

  source = singleton; fs.writeFileSync(path.join(project, 'app.mjs'), source);
  const candidateSingleton = ready(candidateArtifact);
  assert.equal(candidateSingleton.status, 'current');
  assertNode(candidateSingleton, getter, 'Owner getter');
  uninstallAndPark('candidate before rollback');
  const restored = install(oldRelease, oldArtifact);
  rejectReceipt(candidateSingleton, restored);
  assert.equal(restored.status, 'partial');
  assert(restored.symbolGraph.nodes.some(node => node.id === legacyGetter));
  assert(restored.symbolGraph.nodes.some(node => node.id === legacyChild));
  for (const target of [getter, child]) run(installedCLI, ['context', target], /not.*active index|not.*index|missing/i);
  assert.equal(restored.vocabulary.some(node => ['Owner getter', 'Owner child'].includes(node.label)), false);
  assert.match(JSON.stringify(restored.diagnostics), /missing.*current sources/i);
  run(installedCLI, ['preflight', 'app.mjs', ...receiptArgs(restored)], /partial|requires current/i);
  assert.deepEqual(fs.readFileSync(mapPath), newMap, 'Old runtime preserves unrecognized new-ID map byte-for-byte');
  checks.push('Rollback to published runtime preserves singleton source and new-ID map bytes with explicit unresolved names, no misbinding');
  uninstallAndPark('restored published runtime');
  for (const saved of parked) assert.deepEqual(snapshot(saved.path), saved.contents, 'Parked integration/user data changed');
  checks.push('Every uninstall used its installed CLI; source, instructions, host package and owner data preserved; old binding receipts rejected');
  console.log(JSON.stringify({ ok: true, oldArtifact, candidateArtifact, checks, receipts, foregroundView: 'not-started', targetExecution: 'not-performed' }, null, 2));
} finally {
  try {
    assert.deepEqual(snapshot(oldRelease), artifactBytes[0], 'Published input artifact changed');
    assert.deepEqual(snapshot(candidateRelease), artifactBytes[1], 'Candidate input artifact changed');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
