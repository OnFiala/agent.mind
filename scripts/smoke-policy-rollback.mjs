// Verify actual published-v1/candidate-v2 lifecycle using disposable synthetic input.
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
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-policy-rollback.mjs /absolute/published-1.4.0 /absolute/candidate-release');
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
assert.equal(oldArtifact.digest, '74e8af9f4771e7a9443d309f76c1dbc38d3f468d494ce7387a9210082f5c4558', 'Use exact published 1.4.0 payload');
assert.notEqual(candidateArtifact.digest, oldArtifact.digest, 'Digest identifies candidates even when package versions match');

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-policy-rollback-')));
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
const compatibleIgnore = Buffer.from('# Owner policy bytes\r\n');
const setIgnore = Buffer.concat([compatibleIgnore, Buffer.from('*.py[cod]\r\n')]);
let expectedIgnore = compatibleIgnore;
const hostFiles = {
  'AGENTS.md': '\ufeff# Owner instructions\r\nNever execute scanned source. Preserve these bytes.\r\n',
  'package.json': '{"name":"policy-fixture","private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
  'package-lock.json': '{"name":"policy-fixture","lockfileVersion":3,"packages":{}}\n',
  'owner-note.txt': 'Host owner note.\n',
  'app.mjs': 'throw new Error("SCANNED SOURCE MUST NEVER EXECUTE");\nexport const value = 1;\n',
  'cache.pyc': 'Synthetic bytecode stand-in; never execute.\n',
  'cache.pyo': 'Synthetic optimized stand-in; never execute.\n',
  'cache.pyd': 'Synthetic library stand-in; never execute.\n',
  'cache.pycc': 'Negative control remains visible.\n',
};
for (const [relative, bytes] of Object.entries(hostFiles)) fs.writeFileSync(path.join(project, relative), bytes);
fs.writeFileSync(ignorePath, expectedIgnore);
const mapBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'app', label: 'Owner App', aliases: ['owner-alias'], description: 'Synthetic fixture only', files: ['app.mjs'], prefixes: [], type: 'module', group: 'core' }] }, null, 2).replaceAll('\n', '\r\n')}\r\n`);
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
function context(artifact, version, valid) {
  const status = run(installedCLI, ['status']);
  assert.equal(status.state, 'attached'); assert.equal(status.integrity, 'verified'); assert.deepEqual(status.conflicts, []);
  assert.equal(status.root, project); assert.equal(status.binding.root, project);
  assert.equal(status.runtime.digest, artifact.digest); assert.equal(status.runtime.version, artifact.version);
  assert.deepEqual(fs.readFileSync(mapPath), mapBytes);
  assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), ownerData);
  const result = run(installedCLI, ['context']);
  assert.equal(result.project.root, project); assert.equal(result.binding.id, status.binding.id);
  assert.equal(result.inputPolicy.version, version); assert.equal(result.inputPolicy.status, valid ? 'valid' : 'invalid');
  if (valid) {
    assert.equal(result.status, 'current');
    assert.equal(run(installedCLI, ['context', 'owner-alias']).selection.id, 'block:app');
    assert.equal(run(installedCLI, ['preflight', 'block:app', ...identity(result)]).preflight, 'verified-at-read');
  } else {
    assert.equal(result.status, 'partial'); assert.deepEqual(result.nodes, []); assert.deepEqual(result.edges, []);
    assert.deepEqual(result.symbolGraph.nodes, []); assert.deepEqual(result.symbolGraph.edges, []);
    assert.match(JSON.stringify(result.diagnostics), /INPUT_POLICY_INVALID/);
    assert.equal(result.inputPolicy.reason, 'grammar');
    run(installedCLI, ['preflight', 'app.mjs', ...identity(result)], /partial|current context|active index/i);
    assert(!JSON.stringify(result).includes('Owner App'));
  }
  assertHost();
  receipts.push({ digest: artifact.digest, version: artifact.version, policyVersion: version, policyId: result.inputPolicy.id, bindingId: status.binding.id, generation: status.binding.generation, revision: result.revision, status: result.status });
  return result;
}
function install(release, artifact, version, valid) {
  assert.equal(run(path.join(release, 'cli.mjs'), ['install', '--project', project, '--release', release, '--digest', artifact.digest, '--attach']).state, 'attached');
  // Restore only saved owner inputs, never runtime/descriptor/managed instructions.
  fs.writeFileSync(mapPath, fs.existsSync(savedMapPath) ? fs.readFileSync(savedMapPath) : mapBytes);
  fs.writeFileSync(path.join(integration, 'owner-data.txt'), fs.existsSync(savedOwnerPath) ? fs.readFileSync(savedOwnerPath) : ownerData);
  return context(artifact, version, valid);
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
const sourceURL = (url, receipt) => `${url}/api/source?path=app.mjs&policyId=${receipt.inputPolicy.id}&revision=${receipt.revision}`;
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
function managedConflict() {
  const agents = path.join(project, 'AGENTS.md'), attached = fs.readFileSync(agents, 'utf8');
  assert(attached.includes('## agent.mind source context'));
  const edited = attached.replace('## agent.mind source context', '## Owner edited context');
  fs.writeFileSync(agents, edited);
  const before = snapshot(integration);
  run(installedCLI, ['uninstall'], /edited|modified|conflict|managed/i);
  assert.equal(fs.readFileSync(agents, 'utf8'), edited);
  const after = snapshot(integration);
  for (const [relative, hash] of Object.entries(before)) if (relative !== '.local/install.json') assert.equal(after[relative], hash, `Conflict changed ${relative}`);
  assert.equal(run(installedCLI, ['status']).state, 'detaching');
  fs.writeFileSync(agents, attached); // Repair only this harness-created edit.
  assert.equal(run(installedCLI, ['attach']).state, 'attached');
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
  const original = install(oldRelease, oldArtifact, 'root-ignore-v1', true);
  const bounded = run(installedCLI, ['preflight', 'block:app', '--profile', 'agent', ...identity(original)]);
  const oldCursor = bounded.diagnostics.find(item => item.section === 'diagnostics').cursor;
  const oldView = await startView();
  await sourceStatus(sourceURL(oldView.url, original), 200);
  expectedIgnore = setIgnore; fs.writeFileSync(ignorePath, expectedIgnore);
  context(oldArtifact, 'root-ignore-v1', false);
  await sourceStatus(sourceURL(oldView.url, original), 409);
  await stopView();
  expectedIgnore = compatibleIgnore; fs.writeFileSync(ignorePath, expectedIgnore);
  context(oldArtifact, 'root-ignore-v1', true);
  managedConflict();
  uninstallAndPark('published before candidate');
  const candidate = install(candidateRelease, candidateArtifact, 'root-ignore-v2', true);
  assert.notEqual(candidate.inputPolicy.id, original.inputPolicy.id);
  assert.notEqual(candidate.revision, original.revision);
  assert.deepEqual(candidate.nodes.map(node => node.id), original.nodes.map(node => node.id));
  for (const node of original.nodes.filter(node => node.path !== 'AGENTS.md')) assert.equal(candidate.nodes.find(item => item.id === node.id).hash, node.hash);
  rejectReceipt(original, candidate);
  run(installedCLI, ['context', 'block:app', '--profile', 'agent', '--cursor', oldCursor, ...identity(original)], /binding.*expired|revision changed/i);
  const newView = await startView();
  await sourceStatus(sourceURL(newView.url, original), 409);
  await sourceStatus(sourceURL(newView.url, candidate), 200);
  checks.push('Identical v1-valid policy/source/map bytes retain node identities and hashes but v2 changes policy/revision and rejects old source, continuation and preflight receipts');

  expectedIgnore = setIgnore; fs.writeFileSync(ignorePath, expectedIgnore);
  const accepted = context(candidateArtifact, 'root-ignore-v2', true);
  for (const relative of ['cache.pyc', 'cache.pyo', 'cache.pyd']) assert(!accepted.nodes.some(node => node.path === relative));
  assert(accepted.nodes.some(node => node.path === 'cache.pycc'));
  await sourceStatus(sourceURL(newView.url, candidate), 409);
  const source = await sourceStatus(sourceURL(newView.url, accepted), 200);
  assert.equal((await source.json()).hash, sha(Buffer.from(hostFiles['app.mjs'])));
  await stopView();
  managedConflict();
  const beforeRollback = context(candidateArtifact, 'root-ignore-v2', true);
  uninstallAndPark('candidate before rollback');
  const restored = install(oldRelease, oldArtifact, 'root-ignore-v1', false);
  rejectReceipt(beforeRollback, restored);
  const restoredView = await startView();
  await sourceStatus(sourceURL(restoredView.url, beforeRollback), 409);
  await sourceStatus(`${restoredView.url}/api/source?path=app.mjs`, 409);
  await stopView();
  checks.push('Set-containing ignore is accepted by candidate; rollback to exact published v1 restores explicit grammar refusal without editing ignore, source, map or custom data');

  const tampered = path.join(temporary, 'tampered candidate');
  fs.cpSync(candidateRelease, tampered, { recursive: true });
  fs.appendFileSync(path.join(tampered, 'server.mjs'), '\n// Disposable integrity failure.\n');
  uninstallAndPark('rollback before failed candidate');
  run(path.join(candidateRelease, 'cli.mjs'), ['install', '--project', project, '--release', tampered, '--digest', candidateArtifact.digest, '--attach'], /hash mismatch/i);
  assert(!fs.existsSync(integration));
  assert(!fs.readdirSync(project).some(name => name.startsWith('.agent-mind-stage-')));
  assertHost(false);
  const recovered = install(oldRelease, oldArtifact, 'root-ignore-v1', false);
  rejectReceipt(restored, recovered);
  checks.push('Post-uninstall tampered candidate fails without a runtime/stage; reinstall exact old artifact plus saved owner data recovers verified attachment and explicit v1 grammar refusal');
  for (const entry of parked) assert.deepEqual(snapshot(entry.path), entry.contents, 'Parked recovery/modified owned files changed');
  assert.deepEqual(snapshot(oldRelease), artifactBytes[0]); assert.deepEqual(snapshot(candidateRelease), artifactBytes[1]);
  oldVerifier.verifyArtifact(oldRelease, oldArtifact.digest); candidateVerifier.verifyArtifact(candidateRelease, candidateArtifact.digest);
  checks.push('Both runtimes preserve managed-block conflicts, modified owned files, exact CRLF map/ignore/source/owner bytes and parked recovery; both input artifacts unchanged');
  report = { status: 'passed', old: { version: oldArtifact.version, digest: oldArtifact.digest }, candidate: { version: candidateArtifact.version, digest: candidateArtifact.digest }, checks, receipts, scope: 'Disposable synthetic target only; no scanned target code or package scripts executed.', instructionActivation: 'not-verified; installed CLI smoke cannot establish host instruction loading', cleanup: 'Owned foreground views stopped; only harness-owned temporary tree removed.' };
} finally {
  await stopView();
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
