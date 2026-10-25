import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifactDigest, verifyArtifact, installProject, attachInstallation, detachInstallation, uninstallInstallation, rebindInstallation, statusInstallation, resolveInstallation, purgePlan, purgeInstallation } from '../installation.mjs';
const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-lifecycle-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = path.join(dir, 'release'), project = path.join(dir, 'project with spaces');
  fs.mkdirSync(release); fs.mkdirSync(project);
  const names = ['cli.mjs', 'installation.mjs', 'server.mjs', 'graph-context.mjs', 'code-index.mjs', 'symbol-index.mjs', 'live-index.mjs', 'project-map.mjs', 'README.md', 'LICENSE', 'package.json', 'package-lock.json'];
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(release, name));
  for (const name of ['public', 'node_modules/acorn']) fs.cpSync(path.join(source, name), path.join(release, name), { recursive: true });
  const files = {};
  function walk(current, prefix = '') { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const rel = prefix + entry.name; if (entry.isDirectory()) walk(path.join(current, entry.name), rel + '/'); else files[rel] = sha(fs.readFileSync(path.join(current, entry.name))); } }
  walk(release);
  const version = JSON.parse(fs.readFileSync(path.join(release, 'package.json'))).version;
  fs.writeFileSync(path.join(release, 'artifact.json'), JSON.stringify({ schemaVersion: 1, version, files, digest: artifactDigest(files) }));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"untouched"}\n');
  fs.writeFileSync(path.join(project, 'main.mjs'), 'export function example() { return 1; }\n');
  return { dir, release, project, install: path.join(project, 'agent.mind') };
}
function install(f) { return installProject({ project: f.project, release: f.release }); }
test('verified release installs isolated runtime and never touches target dependencies; repeat is idempotent', t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.project, 'package.json'));
  const result = install(f);
  assert.equal(result.state, 'detached'); assert.equal(result.integrity, 'verified');
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'package.json')), before);
  assert.equal(fs.existsSync(path.join(f.project, 'node_modules')), false);
  assert.deepEqual(install(f).binding, result.binding);
  assert.throws(() => resolveInstallation(f.install), /detached/);
  assert.equal(resolveInstallation(f.install, { requireAttached: false }).root, f.project);
});
test('artifact fails closed for unexpected files, altered bytes, bad digest, traversal and symlinks', t => {
  const f = fixture(t); verifyArtifact(f.release);
  fs.writeFileSync(path.join(f.release, 'private.env'), 'secret'); assert.throws(() => verifyArtifact(f.release), /unknown/); fs.unlinkSync(path.join(f.release, 'private.env'));
  fs.appendFileSync(path.join(f.release, 'server.mjs'), '\n'); assert.throws(() => verifyArtifact(f.release), /hash mismatch/);
  fs.copyFileSync(path.join(source, 'server.mjs'), path.join(f.release, 'server.mjs'));
  assert.throws(() => verifyArtifact(f.release, '0'.repeat(64)), /digest mismatch/);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.release, 'artifact.json'))); manifest.files['../escape'] = '0'.repeat(64); fs.writeFileSync(path.join(f.release, 'artifact.json'), JSON.stringify(manifest)); assert.throws(() => verifyArtifact(f.release), /Unsafe relative/);
  delete manifest.files['../escape']; fs.writeFileSync(path.join(f.release, 'artifact.json'), JSON.stringify(manifest));
  fs.unlinkSync(path.join(f.release, 'README.md')); fs.symlinkSync(path.join(source, 'README.md'), path.join(f.release, 'README.md')); assert.throws(() => verifyArtifact(f.release), /Symbolic/);
});
test('foreign destination and project symlinks are rejected without overwriting', t => {
  const f = fixture(t); fs.mkdirSync(f.install); fs.writeFileSync(path.join(f.install, 'mine'), 'keep');
  assert.throws(() => install(f)); assert.equal(fs.readFileSync(path.join(f.install, 'mine'), 'utf8'), 'keep');
  const link = path.join(f.dir, 'link'); fs.symlinkSync(f.project, link); assert.throws(() => installProject({ project: link, release: f.release }), /symlink/);
});
test('attach/detach preserve existing BOM CRLF bytes and invalidate outstanding binding', t => {
  const f = fixture(t), original = '\ufeff# Mine\r\nRules without final newline';
  fs.writeFileSync(path.join(f.project, 'AGENTS.md'), original); install(f);
  attachInstallation(f.install); const attached = fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8');
  attachInstallation(f.install); assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), attached);
  const { binding } = resolveInstallation(f.install); binding.verify();
  detachInstallation(f.install); assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), original);
  assert.throws(() => binding.verify(), /detached|expired/);
  detachInstallation(f.install); assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), original);
});
test('user additions survive detach and modified or duplicate managed blocks need attention', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  fs.appendFileSync(path.join(f.project, 'AGENTS.md'), '\nUser append\n'); detachInstallation(f.install);
  assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), '\nUser append\n');
  attachInstallation(f.install);
  const file = path.join(f.project, 'AGENTS.md'), text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, text.replace('Before nontrivial', 'Edited before nontrivial'));
  assert.throws(() => detachInstallation(f.install), /changed or duplicated/);
  assert.equal(statusInstallation(f.install).integrity, 'needs-attention');
  assert.throws(() => resolveInstallation(f.install), /detaching/);
});
test('interrupted attaching journal recovers when no bytes were published yet', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), 'original'); install(f); attachInstallation(f.install);
  const receiptPath = path.join(f.install, '.local/install.json'), receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.state = 'attaching';
  fs.writeFileSync(receiptPath, JSON.stringify(receipt)); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), 'original');
  assert.equal(attachInstallation(f.install).state, 'attached'); detachInstallation(f.install); assert.equal(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), 'original');
});
test('binding rejects move, conflicting environment and edited runtime; explicit rebind rotates identity', t => {
  const f = fixture(t); install(f); attachInstallation(f.install); const old = resolveInstallation(f.install).binding;
  const previous = process.env.AGENT_MIND_PROJECT; process.env.AGENT_MIND_PROJECT = f.dir;
  try { assert.throws(() => resolveInstallation(f.install), /conflicts/); } finally { if (previous === undefined) delete process.env.AGENT_MIND_PROJECT; else process.env.AGENT_MIND_PROJECT = previous; }
  const moved = path.join(f.dir, 'moved'); fs.renameSync(f.project, moved); const movedInstall = path.join(moved, 'agent.mind');
  assert.throws(() => resolveInstallation(movedInstall), /binding changed/);
  const rebound = rebindInstallation(movedInstall); assert.notEqual(rebound.binding.id, old.id); assert.equal(rebound.state, 'detached');
  assert.equal(fs.existsSync(path.join(moved, 'AGENTS.md')), false); attachInstallation(movedInstall);
  fs.appendFileSync(path.join(movedInstall, `.local/runtime/${rebound.runtime.digest}/server.mjs`), 'edited');
  assert.throws(() => resolveInstallation(movedInstall), /hash mismatch/);
});
test('uninstall removes hash-matching owned files and preserves user map, edits, unknown and symlink destinations', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  const status = statusInstallation(f.install), runtime = `.local/runtime/${status.runtime.digest}`;
  fs.appendFileSync(path.join(f.install, `${runtime}/server.mjs`), '\nuser edit');
  fs.writeFileSync(path.join(f.install, 'notes.txt'), 'mine'); fs.writeFileSync(path.join(f.install, 'project-map.json'), '{"user":true}');
  const external = path.join(f.dir, 'external'); fs.writeFileSync(external, 'outside'); fs.symlinkSync(external, path.join(f.install, 'external-link'));
  const result = uninstallInstallation(f.install);
  assert.equal(result.state, 'uninstalled'); assert.equal(fs.existsSync(path.join(f.install, `${runtime}/code-index.mjs`)), false);
  assert.equal(fs.readFileSync(path.join(f.install, `${runtime}/server.mjs`), 'utf8').endsWith('user edit'), true);
  assert.equal(fs.readFileSync(path.join(f.install, 'project-map.json'), 'utf8'), '{"user":true}'); assert.equal(fs.readFileSync(external, 'utf8'), 'outside');
  assert.ok(result.preserved.includes('external-link')); assert.ok(result.preserved.includes('notes.txt'));
  assert.equal(fs.existsSync(path.join(f.project, 'AGENTS.md')), false);
  assert.equal(uninstallInstallation(f.install).state, 'uninstalled');
});
test('active view lease blocks lifecycle and exact release token cannot kill another process', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  fs.writeFileSync(path.join(f.install, '.local/view.json'), JSON.stringify({ token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pid: process.pid }));
  for (const operation of [detachInstallation, uninstallInstallation, rebindInstallation]) assert.throws(() => operation(f.install), /foreground view lease/);
  const result = spawnSync(process.execPath, [path.join(f.install, 'cli.mjs'), 'release-view', '--token', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /still alive/); assert.equal(fs.existsSync(path.join(f.install, '.local/view.json')), true);
});
test('installed launcher context ignores cwd and returns binding, exact source and current revision preflight', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  const command = [path.join(f.install, 'cli.mjs'), 'context', 'main.mjs'];
  const result = spawnSync(process.execPath, command, { encoding: 'utf8', cwd: f.dir });
  assert.equal(result.status, 0, result.stderr); const context = JSON.parse(result.stdout);
  assert.equal(context.binding.root, f.project); assert.equal(context.selection.path, 'main.mjs');
  assert.ok(context.nodes.every(n => !n.path?.startsWith('agent.mind/')));
  const preflight = spawnSync(process.execPath, [path.join(f.install, 'cli.mjs'), 'preflight', 'main.mjs', '--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)], { encoding: 'utf8' });
  assert.equal(preflight.status, 0, preflight.stderr);
  fs.appendFileSync(path.join(f.project, 'main.mjs'), '\nexport const changed=1;');
  const stale = spawnSync(process.execPath, [path.join(f.install, 'cli.mjs'), 'preflight', 'main.mjs', '--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)], { encoding: 'utf8' }); assert.equal(stale.status, 1); assert.match(stale.stderr, /revision changed/);
});
test('unknown empty artifact directories fail closed; unknown empty installation directories survive uninstall', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.release, 'unknown')); assert.throws(() => verifyArtifact(f.release), /unknown directory/); fs.rmdirSync(path.join(f.release, 'unknown'));
  install(f); fs.mkdirSync(path.join(f.install, 'empty user data')); const result = uninstallInstallation(f.install);
  assert.equal(fs.existsSync(path.join(f.install, 'empty user data')), true); assert.ok(result.preserved.includes('empty user data/'));
  const status = spawnSync(process.execPath, [path.join(f.release, 'cli.mjs'), 'status', '--install-dir', f.install], { encoding: 'utf8' }); assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).state, 'uninstalled');
  assert.throws(() => install(f), /preserved data remain/);
});
test('copied identical source projects have distinct bindings; unsafe receipt ownership cannot delete target files', t => {
  const f = fixture(t); install(f); const second = path.join(f.dir, 'second'); fs.mkdirSync(second); fs.copyFileSync(path.join(f.project, 'main.mjs'), path.join(second, 'main.mjs'));
  installProject({ project: second, release: f.release }); assert.notEqual(statusInstallation(f.install).binding.id, statusInstallation(path.join(second, 'agent.mind')).binding.id);
  const receiptPath = path.join(f.install, '.local/install.json'), receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.owned['../main.mjs'] = sha(fs.readFileSync(path.join(f.project, 'main.mjs'))); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => uninstallInstallation(f.install), /Unsafe relative/); assert.equal(fs.existsSync(path.join(f.project, 'main.mjs')), true);
});

test('preflight requires a complete well-formed exact context receipt and rejects wrong binding and partial indexes', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  const cli = path.join(f.install, 'cli.mjs');
  const contextRun = () => spawnSync(process.execPath, [cli, 'context', 'main.mjs'], { encoding: 'utf8' });
  const context = JSON.parse(contextRun().stdout);
  const receipt = ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
  const preflight = args => spawnSync(process.execPath, [cli, 'preflight', ...args], { encoding: 'utf8' });
  for (const args of [[], ['main.mjs'], receipt, ['main.mjs', '--revision', context.revision], ['main.mjs', '--binding-id', context.binding.id, '--generation', String(context.binding.generation)]]) {
    const result = preflight(args); assert.equal(result.status, 1); assert.match(result.stderr, /requires one exact selector/);
  }
  for (const [name, value] of [['--revision', 'invalid'], ['--binding-id', 'invalid'], ['--generation', '0'], ['--generation', '1e3']]) {
    const args = [...receipt]; args[args.indexOf(name) + 1] = value;
    const result = preflight(['main.mjs', ...args]); assert.equal(result.status, 1); assert.match(result.stderr, /receipt format/);
  }
  const wrong = [...receipt]; wrong[wrong.indexOf('--binding-id') + 1] = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const wrongResult = preflight(['main.mjs', ...wrong]); assert.equal(wrongResult.status, 1); assert.match(wrongResult.stderr, /binding has expired/);
  fs.writeFileSync(path.join(f.project, 'broken.mjs'), 'export const = ;');
  const partialRun = contextRun(); assert.equal(partialRun.status, 0, partialRun.stderr); const partial = JSON.parse(partialRun.stdout); assert.equal(partial.status, 'partial');
  const partialResult = preflight(['main.mjs', '--revision', partial.revision, '--binding-id', partial.binding.id, '--generation', String(partial.binding.generation)]);
  assert.equal(partialResult.status, 1); assert.match(partialResult.stderr, /requires current context/); assert.equal(partialResult.stdout, '');
  const managed = fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'); assert.match(managed, /--binding-id <returned binding.id> --generation <returned binding.generation>/);
});
test('AGENTS custody keeps concurrent owner bytes and never overwrites a recreated path', t => {
  const f = fixture(t); install(f); const agents = path.join(f.project, 'AGENTS.md'); fs.writeFileSync(agents, 'Original owner instructions\n');
  const rename = fs.renameSync; let injected = false;
  fs.renameSync = (from, to) => { if (from === agents && !injected) { injected = true; fs.appendFileSync(agents, 'Concurrent owner rule\n'); } return rename(from, to); };
  try { assert.throws(() => attachInstallation(f.install), /Concurrent owner change preserved/); } finally { fs.renameSync = rename; }
  assert.match(fs.readFileSync(agents, 'utf8'), /Concurrent owner rule/);
  let recovery = statusInstallation(f.install).recovery; assert.ok(recovery.some(entry => fs.readFileSync(path.join(f.install, entry.path), 'utf8').includes('Concurrent owner rule')));
  // A fresh fixture tests publication after someone creates the displaced name.
  const g = fixture(t); install(g); const other = path.join(g.project, 'AGENTS.md'); fs.writeFileSync(other, 'Original\n'); injected = false;
  fs.renameSync = (from, to) => { const result = rename(from, to); if (from === other && !injected) { injected = true; fs.writeFileSync(other, 'Owner recreated path\n'); } return result; };
  try { assert.throws(() => attachInstallation(g.install), /publication conflict/); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(other, 'utf8'), 'Owner recreated path\n'); recovery = statusInstallation(g.install).recovery;
  assert.ok(recovery.some(entry => fs.readFileSync(path.join(g.install, entry.path), 'utf8') === 'Original\n'));
});
test('AGENTS backup retains an original open writer descriptor and uninstall verifies displaced owned bytes', t => {
  const f = fixture(t); install(f); const agents = path.join(f.project, 'AGENTS.md'); fs.writeFileSync(agents, 'Original\n'); const descriptor = fs.openSync(agents, 'a');
  attachInstallation(f.install); fs.writeSync(descriptor, 'Late descriptor write\n'); fs.closeSync(descriptor);
  assert.ok(statusInstallation(f.install).recovery.some(entry => fs.readFileSync(path.join(f.install, entry.path), 'utf8').includes('Late descriptor write')));
  const owned = path.join(f.install, 'README.md'), rename = fs.renameSync; let injected = false;
  fs.renameSync = (from, to) => { if (from === owned && !injected) { injected = true; fs.writeFileSync(owned, 'Owner replacement during cleanup'); } return rename(from, to); };
  let result; try { result = uninstallInstallation(f.install); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(owned, 'utf8'), 'Owner replacement during cleanup'); assert.ok(!result.removed.includes('README.md')); assert.ok(result.preserved.includes('README.md'));
});
test('explicit portable clone adoption preserves map and unknown data and creates a fresh binding', t => {
  const f = fixture(t); install(f); attachInstallation(f.install); const original = statusInstallation(f.install);
  const clone = path.join(f.dir, 'clone'); fs.mkdirSync(clone); fs.cpSync(f.install, path.join(clone, 'agent.mind'), { recursive: true, filter: p => path.basename(p) !== '.local' });
  fs.copyFileSync(path.join(f.project, 'AGENTS.md'), path.join(clone, 'AGENTS.md')); const cloneInstall = path.join(clone, 'agent.mind');
  const map = '{"schemaVersion":1,"blocks":[],"owner":"retained"}\n'; fs.writeFileSync(path.join(cloneInstall, 'project-map.json'), map); fs.writeFileSync(path.join(cloneInstall, 'unknown.txt'), 'owner');
  assert.throws(() => installProject({ project: clone, release: f.release }), /explicit install --adopt/);
  const adopted = installProject({ project: clone, release: f.release, adopt: true }); assert.equal(adopted.state, 'detached'); assert.notEqual(adopted.binding.id, original.binding.id); assert.equal(adopted.runtime.digest, original.runtime.digest);
  assert.equal(fs.readFileSync(path.join(cloneInstall, 'project-map.json'), 'utf8'), map); assert.equal(fs.readFileSync(path.join(cloneInstall, 'unknown.txt'), 'utf8'), 'owner');
  attachInstallation(cloneInstall); assert.equal(resolveInstallation(cloneInstall).binding.installId, JSON.parse(fs.readFileSync(path.join(f.install, '.local/install.json'))).installId);
  const receiptPath = path.join(cloneInstall, '.local/install.json'), receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.state = 'installing'; fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  fs.unlinkSync(path.join(cloneInstall, `.local/runtime/${adopted.runtime.digest}/server.mjs`));
  assert.equal(installProject({ project: clone, release: f.release, adopt: true }).state, 'detached');
});
test('portable adoption refuses edited managed block, launcher or mismatched pin without creating local state', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  for (const edit of ['block', 'launcher', 'pin']) {
    const clone = path.join(f.dir, edit); fs.mkdirSync(clone); const destination = path.join(clone, 'agent.mind'); fs.cpSync(f.install, destination, { recursive: true, filter: p => path.basename(p) !== '.local' }); fs.copyFileSync(path.join(f.project, 'AGENTS.md'), path.join(clone, 'AGENTS.md'));
    if (edit === 'block') fs.appendFileSync(path.join(clone, 'AGENTS.md'), '<!-- agent.mind:owner edit -->');
    if (edit === 'launcher') fs.appendFileSync(path.join(destination, 'cli.mjs'), '//owner');
    if (edit === 'pin') { const descriptor = JSON.parse(fs.readFileSync(path.join(destination, 'project.json'))); descriptor.runtime.digest = '0'.repeat(64); fs.writeFileSync(path.join(destination, 'project.json'), JSON.stringify(descriptor)); }
    const before = fs.readFileSync(path.join(clone, 'AGENTS.md'));
    assert.throws(() => installProject({ project: clone, release: f.release, adopt: true })); assert.equal(fs.existsSync(path.join(destination, '.local')), false); assert.deepEqual(fs.readFileSync(path.join(clone, 'AGENTS.md')), before);
  }
});

test('uninstall retains owned inode writes made through descriptors until explicit purge', t => {
  const f = fixture(t); install(f); const owned = path.join(f.install, 'README.md'), descriptor = fs.openSync(owned, 'a');
  const stat = fs.fstatSync(descriptor); const result = uninstallInstallation(f.install); fs.writeSync(descriptor, '\nLate owned descriptor update'); fs.closeSync(descriptor);
  const retained = result.preserved.find(relative => { try { return fs.lstatSync(path.join(f.install, relative)).ino === stat.ino; } catch { return false; } });
  assert.ok(retained); assert.match(fs.readFileSync(path.join(f.install, retained), 'utf8'), /Late owned descriptor update/);
});
test('purge requires exact uninstalled inventory and explicit digest, then removes only the reviewed installation', t => {
  const f = fixture(t); install(f); assert.throws(() => purgePlan(f.install), /uninstalled tombstone/); uninstallInstallation(f.install);
  const plan = purgePlan(f.install); assert.match(plan.digest, /^[a-f0-9]{64}$/); assert.ok(plan.entries.some(entry => entry.path === 'project-map.json' && entry.kind === 'file' && entry.hash));
  assert.throws(() => purgeInstallation(f.install, '0'.repeat(64)), /inventory or root identity changed/); assert.equal(fs.existsSync(f.install), true);
  const result = purgeInstallation(f.install, plan.digest); assert.equal(result.state, 'purged'); assert.equal(fs.existsSync(f.install), false); assert.equal(fs.existsSync(path.join(f.project, 'main.mjs')), true);
});
test('purge refuses changed or new inventory and symlinks without deleting owner or foreign files', t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install); const plan = purgePlan(f.install), map = path.join(f.install, 'project-map.json'); fs.appendFileSync(map, '\nOwner edit');
  assert.throws(() => purgeInstallation(f.install, plan.digest), /inventory or root identity changed/); assert.match(fs.readFileSync(map, 'utf8'), /Owner edit/);
  const changedPlan = purgePlan(f.install); fs.writeFileSync(path.join(f.install, 'new-owner-file'), 'keep'); assert.throws(() => purgeInstallation(f.install, changedPlan.digest), /inventory or root identity changed/);
  const outside = path.join(f.dir, 'foreign.txt'); fs.writeFileSync(outside, 'foreign'); fs.symlinkSync(outside, path.join(f.install, 'foreign-link'));
  assert.throws(() => purgePlan(f.install), /Symbolic/); assert.equal(fs.readFileSync(outside, 'utf8'), 'foreign'); assert.throws(() => purgeInstallation(path.join(f.dir, '..'), changedPlan.digest));
});
test('mid-purge owner change preserves tombstone for a fresh exact plan', t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install); const map = path.join(f.install, 'project-map.json'), plan = purgePlan(f.install);
  const rename = fs.renameSync; let injected = false;
  fs.renameSync = (from, to) => { if (from === map && !injected) { injected = true; fs.appendFileSync(map, '\nOwner mid-purge update'); } return rename(from, to); };
  let result; try { result = purgeInstallation(f.install, plan.digest); } finally { fs.renameSync = rename; }
  assert.equal(result.state, 'purge-incomplete'); assert.match(fs.readFileSync(map, 'utf8'), /Owner mid-purge update/);
  assert.equal(statusInstallation(f.install).state, 'uninstalled'); const next = purgePlan(f.install); assert.notEqual(next.digest, plan.digest); assert.ok(next.entries.some(entry => entry.path === 'project.json')); assert.ok(next.entries.some(entry => entry.path === '.local/install.json'));
});
test('purge CLI emits exact incomplete result and exits nonzero when an owner file changes during deletion', t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install); const plan = purgePlan(f.install), map = path.join(f.install, 'project-map.json');
  const script = `import fs from 'node:fs'; const {runCLI}=await import(${JSON.stringify(path.join(source, 'installation.mjs'))}); const original=fs.renameSync; let injected=false; fs.renameSync=(from,to)=>{if(from===${JSON.stringify(map)}&&!injected){injected=true;fs.appendFileSync(from,'owner update');}return original(from,to);}; await runCLI(${JSON.stringify(['purge', '--install-dir', f.install, '--digest', plan.digest])});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }); assert.equal(result.status, 1, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.state, 'purge-incomplete'); assert.ok(report.remainder.includes('project.json')); assert.ok(report.remainder.includes('.local/install.json')); assert.equal(statusInstallation(f.install).state, 'uninstalled');
});
