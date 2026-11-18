import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_FILES, artifactDigest, verifyArtifact, installProject, attachInstallation } from '../installation.mjs';
import { freshContext, projectContext, contextCursor } from '../graph-context.mjs';
import { indexProject } from '../code-index.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pair = ['--resolver', 'bundler-local-v1', '--resolver-config', 'frontend/tsconfig.json'];
const options = { resolver: 'bundler-local-v1', resolverConfig: 'frontend/tsconfig.json' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, { typed = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-r14-cli-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'target'), release = path.join(dir, 'release');
  fs.mkdirSync(path.join(project, 'frontend'), { recursive: true });
  fs.mkdirSync(release);
  const files = {};
  assert(ARTIFACT_FILES.includes('typed-resolution.mjs'));
  for (const relative of ARTIFACT_FILES) {
    const bytes = fs.readFileSync(path.join(source, relative));
    fs.mkdirSync(path.dirname(path.join(release, relative)), { recursive: true });
    fs.writeFileSync(path.join(release, relative), bytes);
    files[relative] = sha(bytes);
  }
  const version = JSON.parse(fs.readFileSync(path.join(release, 'package.json'))).version;
  fs.writeFileSync(path.join(release, 'artifact.json'), JSON.stringify({ schemaVersion: 1, version, files, digest: artifactDigest(files) }));
  assert.equal(verifyArtifact(release).files['typed-resolution.mjs'], sha(fs.readFileSync(path.join(source, 'typed-resolution.mjs'))));
  fs.writeFileSync(path.join(project, 'frontend/tsconfig.json'), '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}\n');
  const selected = typed ? 'frontend/main.ts' : 'frontend/main.mjs';
  fs.writeFileSync(path.join(project, selected), (typed ? 'import { value } from "./helper";\n' : '') + Array.from({ length: 40 }, (_, i) => `export function item${i}() { return ${i}; }`).join('\n'));
  if (typed) fs.writeFileSync(path.join(project, 'frontend/helper.ts'), 'export const value: number = 1;\n');
  installProject({ project, release });
  attachInstallation(path.join(project, 'agent.mind'));
  const cli = path.join(project, 'agent.mind/cli.mjs');
  const call = (args, expected = 0, env = {}) => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { ...process.env, AGENT_MIND_PROJECT: project, ...env }, timeout: 15000 });
    assert.equal(result.status, expected, result.stderr || result.stdout || String(result.error));
    return result;
  };
  return { dir, project, cli, selected, call };
}
const identity = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];

// All target files are source-only disposable fixtures: the application is never imported or executed.
test('R14 installed full/agent context uses explicit per-command mode and preserves partial preflight', t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.project, 'agent.mind/project.json'));
  const managed = fs.readFileSync(path.join(f.project, 'AGENTS.md'));
  const normal = JSON.parse(f.call(['context', f.selected], 0, { AGENT_MIND_RESOLVER: 'bundler-local-v1', AGENT_MIND_RESOLVER_CONFIG: 'frontend/tsconfig.json' }).stdout);
  assert.equal(Object.hasOwn(normal, 'resolver'), false);
  const full = JSON.parse(f.call(['context', f.selected, ...pair]).stdout);
  assert.equal(full.resolver.mode, 'bundler-local-v1');
  assert.notEqual(full.revision, normal.revision);
  assert.equal(full.status, 'partial');
  const agent = JSON.parse(f.call(['context', f.selected, '--profile', 'agent', ...pair]).stdout);
  assert.deepEqual(agent.resolver, full.resolver);
  assert.equal(agent.revision, full.revision);
  const pinned = identity(agent);
  const section = JSON.parse(f.call(['context', f.selected, '--profile', 'agent', '--section', 'inventory', ...pinned, ...pair]).stdout);
  assert.equal(section.snapshot, agent.snapshot);
  assert.deepEqual(section.resolver, full.resolver);
  const cursor = contextCursor(agent, 'context');
  const continued = JSON.parse(f.call(['context', f.selected, '--profile', 'agent', '--cursor', cursor, ...pinned, ...pair]).stdout);
  assert.equal(continued.snapshot, agent.snapshot);
  for (const profile of [[], ['--profile', 'agent']]) {
    const refused = f.call(['preflight', f.selected, ...profile, ...pinned, ...pair], 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /requires current context.*partial/);
  }
  assert.match(f.call(['context', f.selected, '--profile', 'agent', '--cursor', cursor, ...pinned], 1).stderr, /revision changed/);
  const defaultAgain = JSON.parse(f.call(['context', f.selected]).stdout);
  assert.equal(defaultAgain.revision, normal.revision);
  assert.equal(Object.hasOwn(defaultAgain, 'resolver'), false);
  fs.appendFileSync(path.join(f.project, 'frontend/tsconfig.json'), ' ');
  assert.match(f.call(['context', f.selected, '--profile', 'agent', '--cursor', cursor, ...pinned, ...pair], 1).stderr, /revision changed/);
  const changed = JSON.parse(f.call(['context', f.selected, ...pair]).stdout);
  assert.notEqual(changed.revision, full.revision);
  assert.notDeepEqual(changed.resolver, full.resolver);
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'agent.mind/project.json')), before);
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'AGENTS.md')), managed);
  const status = JSON.parse(f.call(['status']).stdout);
  assert.equal(status.integrity, 'verified');
  assert.equal(Object.hasOwn(status, 'resolver'), false);
});

test('R14 concise preflight receipts carry resolver identity and reject default receipts after opt-in', t => {
  const f = fixture(t, { typed: false });
  const normal = JSON.parse(f.call(['context', f.selected, '--profile', 'agent']).stdout);
  const opted = JSON.parse(f.call(['context', f.selected, '--profile', 'agent', ...pair]).stdout);
  assert.equal(opted.status, 'current');
  assert.notEqual(opted.revision, normal.revision);
  assert.match(f.call(['preflight', f.selected, '--profile', 'agent', ...identity(normal), ...pair], 1).stderr, /revision changed/);
  const receipt = JSON.parse(f.call(['preflight', f.selected, '--profile', 'agent', ...identity(opted), ...pair]).stdout);
  assert.equal(receipt.receipt, 'preflight');
  assert.equal(receipt.snapshot, opted.snapshot);
  assert.deepEqual(receipt.resolver, opted.resolver);
  assert.match(f.call(['preflight', f.selected, '--profile', 'agent', ...identity(opted)], 1).stderr, /revision changed/);
});

test('R14 malformed CLI pairs and lifecycle combinations fail before changing installation state', t => {
  const f = fixture(t);
  for (const args of [
    ['--resolver', 'bundler-local-v1'], ['--resolver-config', 'frontend/tsconfig.json'],
    ['--resolver', 'typo', '--resolver-config', 'frontend/tsconfig.json'],
    ['--resolver', 'bundler-local-v1', '--resolver-config', '../tsconfig.json'],
    ['--resolver', 'bundler-local-v1', '--resolver-config', '/tsconfig.json'],
    ['--resolver', 'bundler-local-v1', '--resolver-config', 'frontend/./tsconfig.json'],
    ['--resolver', 'bundler-local-v1', '--resolver-config', 'frontend/config.js'],
    [...pair, '--resolver', 'bundler-local-v1'], [...pair, '--resolver-config', 'frontend/tsconfig.json'],
    ['--resolver'], ['--resolver', '--resolver-config', 'frontend/tsconfig.json']
  ]) {
    const result = f.call(['context', ...args], 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /together|Duplicate|Missing/);
  }
  for (const command of ['status', 'install', 'attach', 'detach', 'uninstall', 'rebind', 'purge-plan', 'purge', 'release-view']) {
    const result = f.call([command, ...pair], 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /only supported by context, preflight and view/);
  }
  assert.equal(JSON.parse(f.call(['status']).stdout).state, 'attached');
});

test('R14 invalid config remains explicit partial in full/agent context and developer CLI validates the same pair', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'frontend/tsconfig.json'), '{"extends":"outside.json"}');
  const full = JSON.parse(f.call(['context', f.selected, ...pair]).stdout);
  assert.equal(full.status, 'partial');
  assert.equal(full.resolver.status, 'invalid');
  assert(full.nodes.find(node => node.path === f.selected).referenceResolution.outcomes.every(outcome => outcome.status === 'blocked'));
  const agent = JSON.parse(f.call(['context', f.selected, '--profile', 'agent', ...pair]).stdout);
  assert.deepEqual(agent.resolver, full.resolver);
  assert.match(f.call(['preflight', f.selected, ...identity(full), ...pair], 1).stderr, /requires current context/);
  const dev = args => spawnSync(process.execPath, [path.join(source, 'graph-context.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, AGENT_MIND_PROJECT: f.project }, timeout: 15000 });
  for (const args of [[f.selected, ...pair], [...pair, f.selected]]) {
    const result = dev(args);
    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout);
    assert.equal(context.resolver.mode, 'bundler-local-v1');
    assert.equal(context.resolver.status, 'invalid');
  }
  for (const args of [[f.selected, '--resolver', 'bundler-local-v1'], [f.selected, ...pair, ...pair], [f.selected, '--unknown']]) {
    const result = dev(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /together|Duplicate|unknown options/);
  }
});

test('R14 bounded context cursors and source coverage retain resolver identity independently of output budget', t => {
  const f = fixture(t);
  const graph = indexProject(f.project, { generic: true, excludePaths: ['agent.mind'], ...options });
  const full = projectContext(graph, f.selected);
  const agent = projectContext(graph, f.selected, { profile: 'agent', maxBytes: 10000 });
  assert.deepEqual(agent.resolver, full.resolver);
  assert.match(graph.resolver.id, /^[a-f0-9]{64}$/);
  const fragment = projectContext(graph, f.selected, { profile: 'agent', section: 'partCanvas', maxBytes: 10000 });
  assert.equal(fragment.page.fragments.length, 1);
  assert.equal(fragment.page.items.length, 0);
  assert(Buffer.byteLength(JSON.stringify(fragment)) <= 10000);
  assert.deepEqual(fragment.resolver, graph.resolver);
  const continuation = projectContext(graph, f.selected, { profile: 'agent', cursor: fragment.page.next, maxBytes: 10000 });
  assert.equal(continuation.snapshot, fragment.snapshot);
  assert.deepEqual(continuation.resolver, graph.resolver);
  assert(Buffer.byteLength(JSON.stringify(continuation)) <= 10000);
  const sources = projectContext(graph, f.selected, { profile: 'agent', section: 'context', maxBytes: 1000000 }).page.items.filter(item => item.value.kind === 'sourceCoverage');
  assert(sources.length > 0);
  for (const item of sources) assert.equal(item.value.value.resolverId, graph.resolver.id);
  const token = contextCursor(agent, 'context');
  const modified = { ...graph, resolver: { ...graph.resolver, id: 'changed-resolver' } };
  assert.throws(() => projectContext(modified, f.selected, { profile: 'agent', cursor: token }), { code: 'STALE_CONTEXT_CURSOR' });
  assert.throws(() => freshContext(f.project, f.selected, { generic: true, excludePaths: ['agent.mind'], expectedRevision: graph.revision }), { code: 'STALE_REVISION' });
});

test('R14 installed view passes resolver options to its immutable loopback graph', async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [f.cli, 'view', ...pair], { cwd: f.dir, env: { ...process.env, AGENT_MIND_PROJECT: f.project }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await closed; });
  const ready = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error(`View startup timed out: ${errors}`)), 10000);
    child.stderr.on('data', bytes => { errors += bytes; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited ${code}: ${errors}`)); });
    child.stdout.on('data', bytes => {
      output += bytes;
      try { const value = JSON.parse(output); clearTimeout(timer); resolve(value); } catch {}
    });
  });
  const response = await fetch(`${ready.url}/api/graph`);
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.equal(graph.resolver.mode, 'bundler-local-v1');
  assert.equal(graph.status, 'partial');
  const cannotSwitch = await (await fetch(`${ready.url}/api/graph?resolver=other&resolver-config=other.json`)).json();
  assert.deepEqual(cannotSwitch.resolver, graph.resolver);
  child.kill('SIGTERM');
  assert.equal(await closed, 0);
  assert.equal(fs.existsSync(path.join(f.project, 'agent.mind/.local/view.json')), false);
});
