// Exercise documented operator steps with verified artifacts and disposable targets.
// No artifact is modified, no target source is executed, and no release is published.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-upgrade.mjs /absolute/published-1.0.3 /absolute/candidate-release');
const oldRelease = fs.realpathSync(args[0]), newRelease = fs.realpathSync(args[1]);
assert.notEqual(oldRelease, newRelease);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `Unexpected fixture/artifact symlink: ${relative}`);
    if (entry.isDirectory()) Object.assign(result, { [`${relative}/`]: 'directory' }, snapshot(root, relative));
    else { assert(entry.isFile()); result[relative] = sha(fs.readFileSync(path.join(root, relative))); }
  }
  return result;
}
const inputBefore = [snapshot(oldRelease), snapshot(newRelease)];
const oldVerifier = await import(pathToFileURL(path.join(oldRelease, 'installation.mjs')));
const newVerifier = await import(pathToFileURL(path.join(newRelease, 'installation.mjs')));
const oldArtifact = oldVerifier.verifyArtifact(oldRelease);
const newArtifact = newVerifier.verifyArtifact(newRelease);
assert.equal(oldArtifact.version, '1.0.3');
assert.equal(oldArtifact.digest, 'ffcf92c345d0bd2d6ad6082dc546947e36b6e0e9b7f0b79d107e236434a8db28', 'The old artifact must be the published 1.0.3 payload');
assert.notEqual(newArtifact.version, oldArtifact.version);
assert.notEqual(newArtifact.digest, oldArtifact.digest);
assert.throws(() => newVerifier.verifyArtifact(oldRelease), /missing required file|unapproved|versions do not match/i);

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-upgrade-smoke-')));
const backups = path.join(temporary, 'parked outside projects');
const unrelated = path.join(temporary, 'unrelated cwd');
fs.mkdirSync(backups); fs.mkdirSync(unrelated);
const env = { ...process.env };
delete env.AGENT_MIND_PROJECT;
const checks = ['published 1.0.3 and candidate verified by their own verifiers; current allowlist rejects old payload'];
const receipts = [];
let view, report;
const run = (cli, argv, expectedError) => {
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd: unrelated, env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message);
  if (expectedError) {
    assert.notEqual(result.status, 0, `Expected rejection: ${argv[0]}`);
    assert.match(result.stderr, expectedError);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const cliFor = release => path.join(release, 'cli.mjs');
const installedCLI = fixture => path.join(fixture.install, 'cli.mjs');
const receiptArgs = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
const selector = 'modul cé';
const mapBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'module-c', label: 'Owner Module C', aliases: [selector, 'custom-owner-alias'], type: 'module', group: 'core', description: 'Owner map survives upgrades.', files: ['src/main.mjs'], prefixes: [] }] }, null, 2).replaceAll('\n', '\r\n')}\r\n`);
function fixture(name) {
  const project = path.join(temporary, name);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'node_modules/owner-dependency'), { recursive: true });
  const files = {
    'AGENTS.md': '\ufeff# Owner instructions\r\nPreserve BOM, CRLF and this surrounding text.\r\n\r\n## Owner section\r\nNo target execution.\r\n',
    'package.json': '{"name":"owner-fixture","private":true,"scripts":{"install":"exit 99"}}\n',
    'package-lock.json': '{"name":"owner-fixture","lockfileVersion":3,"packages":{}}\n',
    'node_modules/owner-dependency/index.js': 'throw new Error("Dependency must never execute");\n',
    'src/main.mjs': 'throw new Error("Target must never execute");\nexport function main(value) { return value; }\n',
    'owner-note.txt': 'Host owner note stays byte identical.\n',
  };
  for (const [relative, bytes] of Object.entries(files)) fs.writeFileSync(path.join(project, relative), bytes);
  return { project, install: path.join(project, 'agent.mind'), files, savedMap: path.join(backups, `${name}-project-map.json`) };
}
function assertHost(f, attached = true) {
  for (const [relative, bytes] of Object.entries(f.files)) {
    if (relative === 'AGENTS.md' && attached) continue;
    assert.deepEqual(fs.readFileSync(path.join(f.project, relative)), Buffer.from(bytes), `Host file changed: ${relative}`);
  }
}
function install(f, release, artifact) {
  const result = run(cliFor(release), ['install', '--project', f.project, '--release', release, '--digest', artifact.digest, '--attach']);
  assert.equal(result.state, 'attached');
  fs.writeFileSync(path.join(f.install, 'project-map.json'), fs.existsSync(f.savedMap) ? fs.readFileSync(f.savedMap) : mapBytes);
  return ready(f, artifact);
}
function ready(f, artifact) {
  const cli = installedCLI(f), status = run(cli, ['status']);
  assert.equal(status.state, 'attached'); assert.equal(status.integrity, 'verified'); assert.deepEqual(status.conflicts, []);
  assert.equal(status.root, f.project); assert.equal(status.binding.root, f.project);
  assert.equal(status.runtime.version, artifact.version); assert.equal(status.runtime.digest, artifact.digest);
  assert.deepEqual(fs.readFileSync(path.join(f.install, 'project-map.json')), mapBytes);
  const context = run(cli, ['context', selector]);
  assert.equal(context.project.root, f.project); assert.equal(context.binding.id, status.binding.id);
  assert.equal(context.selection.id, 'block:module-c'); assert.deepEqual(context.selection.fileIds, ['file:src/main.mjs']);
  assert.equal(run(cli, ['context', 'custom-owner-alias']).selection.id, 'block:module-c');
  assert.equal(context.status, 'current');
  assert.equal(run(cli, ['preflight', selector, ...receiptArgs(context)]).preflight, 'verified-at-read');
  assertHost(f);
  receipts.push({ scenario: path.basename(f.project), version: artifact.version, digest: artifact.digest, bindingId: context.binding.id, generation: context.binding.generation, revision: context.revision });
  return context;
}
async function stopView() {
  if (!view) return;
  const child = view; view = null;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit');
  child.kill('SIGTERM');
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned view did not stop')), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function activeViewRejectsUninstall(f) {
  view = spawn(process.execPath, [installedCLI(f), 'view'], { cwd: unrelated, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = await new Promise((resolve, reject) => {
    let output = '', error = '';
    const timer = setTimeout(() => reject(new Error(`View readiness timeout: ${error}`)), 10000);
    view.once('error', err => { clearTimeout(timer); reject(err); });
    view.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited ${code}: ${error}`)); });
    view.stderr.on('data', bytes => { error += bytes; });
    view.stdout.on('data', bytes => { output += bytes; try { const value = JSON.parse(output); if (value.url) { clearTimeout(timer); resolve(value); } } catch {} });
  });
  assert.equal(started.root, f.project);
  const before = snapshot(f.project);
  run(installedCLI(f), ['uninstall'], /foreground view|Stop it first/i);
  assert.deepEqual(snapshot(f.project), before, 'Active-view rejection must not change target files');
  await stopView();
  checks.push(`${run(installedCLI(f), ['status']).runtime.version}: actual active view rejects uninstall without loss; owned process stopped`);
}
function editedInstructionsRejectUninstall(f) {
  const agents = path.join(f.project, 'AGENTS.md'), attached = fs.readFileSync(agents, 'utf8');
  assert(attached.includes('## agent.mind source context'));
  const edited = attached.replace('## agent.mind source context', '## Owner edited managed context');
  fs.writeFileSync(agents, edited);
  const installBefore = snapshot(f.install);
  run(installedCLI(f), ['uninstall'], /edited|modified|conflict|managed/i);
  assert.equal(fs.readFileSync(agents, 'utf8'), edited);
  const installAfter = snapshot(f.install);
  for (const [relative, hash] of Object.entries(installBefore)) if (relative !== '.local/install.json') assert.equal(installAfter[relative], hash, `Conflict changed ${relative}`);
  assert.equal(run(installedCLI(f), ['status']).state, 'detaching', 'Conflict is an explicit retryable state');
  fs.writeFileSync(agents, attached); // Revert only this fixture's deliberate managed-block edit.
  assert.equal(run(installedCLI(f), ['attach']).state, 'attached');
  checks.push(`${run(installedCLI(f), ['status']).runtime.version}: managed-block edit rejects uninstall without byte loss; explicit repair/attach resumes`);
}
function addOwnerData(f, label) {
  const note = `Unknown ${label} owner note\n`, suffix = `\nOwner README edit ${label} must survive.\n`;
  fs.writeFileSync(path.join(f.install, 'owner-note.txt'), note);
  fs.appendFileSync(path.join(f.install, 'README.md'), suffix);
  return { note, suffix };
}
function uninstallAndPark(f, label, ownerData) {
  fs.copyFileSync(path.join(f.install, 'project-map.json'), f.savedMap);
  assert.deepEqual(fs.readFileSync(f.savedMap), mapBytes);
  const removed = run(installedCLI(f), ['uninstall']); // Always the currently installed version's CLI.
  assert.equal(removed.state, 'uninstalled');
  assertHost(f, false);
  assert.deepEqual(fs.readFileSync(path.join(f.install, 'project-map.json')), mapBytes);
  assert.equal(fs.readFileSync(path.join(f.install, 'owner-note.txt'), 'utf8'), ownerData.note);
  assert(fs.readFileSync(path.join(f.install, 'README.md'), 'utf8').endsWith(ownerData.suffix));
  const receipt = JSON.parse(fs.readFileSync(path.join(f.install, '.local/install.json')));
  assert.equal(receipt.state, 'uninstalled');
  assert(receipt.recovery.length > 0);
  for (const entry of receipt.recovery) {
    assert.equal(entry.phase, 'retained');
    const bytes = fs.readFileSync(path.join(f.install, entry.path));
    if (entry.source !== 'AGENTS.md') assert.equal(sha(bytes), receipt.owned[entry.source], `Recovery custody: ${entry.source}`);
  }
  assert(receipt.recovery.some(entry => entry.source === 'AGENTS.md' && fs.readFileSync(path.join(f.install, entry.path), 'utf8') === f.files['AGENTS.md']));
  const parked = path.join(backups, label);
  assert(!parked.startsWith(`${f.project}${path.sep}`)); assert(!fs.existsSync(parked));
  const before = snapshot(f.install);
  fs.renameSync(f.install, parked);
  assert.deepEqual(snapshot(parked), before);
  assert(!fs.existsSync(f.install));
  return { parked, contents: before };
}
function rejectOldReceipt(f, previous) {
  const current = run(installedCLI(f), ['context', selector]);
  assert.notEqual(current.binding.id, previous.binding.id);
  run(installedCLI(f), ['preflight', selector, ...receiptArgs(previous)], /binding.*expired|revision changed/i);
  run(installedCLI(f), ['preflight', selector, '--revision', current.revision, '--binding-id', previous.binding.id, '--generation', String(previous.binding.generation)], /binding.*expired/i);
}
function assertParked(parked) { assert.deepEqual(snapshot(parked.parked), parked.contents, 'Parked recovery/user data changed'); }

try {
  const badRelease = path.join(temporary, 'tampered candidate');
  fs.cpSync(newRelease, badRelease, { recursive: true });
  fs.appendFileSync(path.join(badRelease, 'server.mjs'), '\n// Deliberate disposable artifact tamper.\n');
  const attemptBadInstall = f => run(cliFor(newRelease), ['install', '--project', f.project, '--release', badRelease, '--digest', newArtifact.digest, '--attach'], /hash mismatch/i);

  const forward = fixture('forward and rollback');
  install(forward, oldRelease, oldArtifact);
  await activeViewRejectsUninstall(forward);
  editedInstructionsRejectUninstall(forward);
  const oldBeforeTamper = snapshot(forward.project);
  attemptBadInstall(forward);
  assert.deepEqual(snapshot(forward.project), oldBeforeTamper);
  const oldContext = ready(forward, oldArtifact);
  checks.push('tampered candidate is rejected before old uninstall; old installation, instructions and host bytes unchanged');

  const oldParked = uninstallAndPark(forward, 'old remnants before upgrade', addOwnerData(forward, 'old'));
  install(forward, newRelease, newArtifact);
  rejectOldReceipt(forward, oldContext);
  assertParked(oldParked);
  checks.push('forward upgrade uses old installed CLI, outside-project backup, fresh candidate install and exact saved map; old receipts rejected');
  await activeViewRejectsUninstall(forward);
  editedInstructionsRejectUninstall(forward);
  const newContext = ready(forward, newArtifact);
  const typedPath = path.join(forward.project, 'src/typed.ts');
  fs.writeFileSync(typedPath, 'export interface Box { value: string; }\nexport function typed(value: Box): string { return value.value; }\n');
  const typed = run(installedCLI(forward), ['context', 'src/typed.ts']);
  assert.equal(typed.status, 'partial');
  assert(typed.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#Box'));
  assert(typed.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#typed'));
  run(installedCLI(forward), ['preflight', 'src/typed.ts', ...receiptArgs(typed)], /partial/i);
  fs.renameSync(typedPath, path.join(backups, 'typed fixture source.ts'));
  checks.push('upgraded actual runtime extracts typed declarations while strict installed preflight rejects partial syntax-only context');

  const newParked = uninstallAndPark(forward, 'new remnants before rollback', addOwnerData(forward, 'new'));
  install(forward, oldRelease, oldArtifact);
  rejectOldReceipt(forward, newContext);
  assertParked(oldParked); assertParked(newParked); assertHost(forward);
  checks.push('rollback uses new installed CLI and original published release; exact map/aliases restored, new receipts rejected, both recovery backups unchanged');

  const recovery = fixture('post uninstall failure recovery');
  const recoveryOriginal = install(recovery, oldRelease, oldArtifact);
  const recoveryParked = uninstallAndPark(recovery, 'failure original remnants', addOwnerData(recovery, 'failure'));
  attemptBadInstall(recovery);
  assert(!fs.existsSync(recovery.install), 'Failed candidate must not leave an apparently installed runtime');
  assert(!fs.readdirSync(recovery.project).some(name => name.startsWith('.agent-mind-stage-')));
  assertHost(recovery, false); assertParked(recoveryParked);
  install(recovery, oldRelease, oldArtifact);
  rejectOldReceipt(recovery, recoveryOriginal);
  assertParked(recoveryParked); assertHost(recovery);
  checks.push('post-uninstall tampered-candidate failure is explicit and leaves no runtime/stage; original release plus saved map restores a verified usable old installation');

  assert.deepEqual(snapshot(oldRelease), inputBefore[0]); assert.deepEqual(snapshot(newRelease), inputBefore[1]);
  oldVerifier.verifyArtifact(oldRelease, oldArtifact.digest); newVerifier.verifyArtifact(newRelease, newArtifact.digest);
  checks.push('both input artifacts remain byte-identical; only unique temporary fixture trees mutated; no target source/dependency execution');
  report = { status: 'passed', old: { version: oldArtifact.version, digest: oldArtifact.digest }, candidate: { version: newArtifact.version, digest: newArtifact.digest }, checks, receipts, custody: 'Parked map, edited/unknown files and recovery originals verified unchanged outside each project until disposal of this test-owned temporary tree.', instructionActivation: 'not-verified; CLI smoke cannot prove host instruction loading', cleanup: 'owned views stopped; all test-owned temporary fixtures removed' };
} finally {
  await stopView();
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
