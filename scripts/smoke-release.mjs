// Exercise the actual shipped CLI/runtime, never a fake runner or a model response.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

if (!process.argv[2]) throw new Error('Usage: node scripts/smoke-release.mjs /absolute/release-directory');
const release = fs.realpathSync(process.argv[2]);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-release-smoke-')));
const project = path.join(temporary, 'target with spaces');
const other = path.join(temporary, 'unrelated cwd');
fs.mkdirSync(project); fs.mkdirSync(other);
let view;
const checks = [];
const run = (cli, args, ok = true) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: other, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (ok) assert.equal(result.status, 0, result.stderr || result.error?.message);
  else assert.notEqual(result.status, 0, 'Expected an explicit rejection');
  return ok ? JSON.parse(result.stdout) : result.stderr;
};
try {
  fs.mkdirSync(path.join(project, 'src')); fs.mkdirSync(path.join(project, 'test')); fs.mkdirSync(path.join(project, 'legacy'));
  fs.writeFileSync(path.join(project, 'src/module-c.mjs'), 'export function normalizeCount(value) { return Math.max(0, Math.floor(value)); }\n');
  fs.writeFileSync(path.join(project, 'test/module-c.test.mjs'), "import assert from 'node:assert/strict';\nimport { normalizeCount } from '../src/module-c.mjs';\nassert.equal(normalizeCount(2.9), 2);\n");
  fs.writeFileSync(path.join(project, 'legacy/core.mjs'), 'export const stillActive = true;\n');
  const agents = '\ufeff# Owner instructions\r\nPreserve this exact text.\r\n';
  fs.writeFileSync(path.join(project, 'AGENTS.md'), agents);
  const hostPackage = '{"name":"fixture","private":true}\n';
  fs.writeFileSync(path.join(project, 'package.json'), hostPackage);
  const originCLI = path.join(release, 'cli.mjs');
  const installed = run(originCLI, ['install', '--project', project, '--release', release, '--attach']);
  assert.equal(installed.state, 'attached');
  assert.equal(installed.integrity, 'verified');
  const installDir = path.join(project, 'agent.mind'), cli = path.join(installDir, 'cli.mjs');
  assert.equal(fs.readFileSync(path.join(project, 'package.json'), 'utf8'), hostPackage);
  assert(!fs.existsSync(path.join(project, 'node_modules')));
  assert(!fs.existsSync(path.join(project, 'package-lock.json')));
  checks.push('install and attach preserve host dependencies and instructions');

  fs.writeFileSync(path.join(installDir, 'project-map.json'), JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'module-c', label: 'Module C', aliases: ['modul C', 'modul cé'], description: 'Normalizes a count.', type: 'module', group: 'core', files: ['src/module-c.mjs'], prefixes: [] }] }));
  const context = run(cli, ['context', 'modul C']);
  assert.equal(context.project.root, project);
  assert.equal(context.selection.id, 'block:module-c');
  assert.deepEqual(context.selection.fileIds, ['file:src/module-c.mjs']);
  assert(context.edges.some(edge => edge.from === 'file:test/module-c.test.mjs' && edge.to === 'file:src/module-c.mjs'));
  assert(!context.nodes.some(node => node.path?.startsWith('agent.mind/')));
  const receipt = ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
  assert.equal(run(cli, ['preflight', 'block:module-c', ...receipt]).preflight, 'verified-at-read');
  run(cli, ['preflight', 'block:module-c'], false);
  checks.push('exact alias, test reference and full binding/revision preflight');

  const clone = path.join(temporary, 'portable clone');
  fs.cpSync(project, clone, { recursive: true, filter: source => !source.startsWith(path.join(installDir, '.local')) });
  run(originCLI, ['install', '--project', clone, '--release', release], false);
  const adopted = run(originCLI, ['install', '--project', clone, '--release', release, '--adopt', '--attach']);
  assert.equal(adopted.state, 'attached');
  assert.notEqual(adopted.binding.id, context.binding.id);
  const clonedCLI = path.join(clone, 'agent.mind/cli.mjs');
  assert.equal(run(clonedCLI, ['context', 'Module C']).project.root, clone);
  run(clonedCLI, ['uninstall']);
  const clonePlan = run(originCLI, ['purge-plan', '--install-dir', path.join(clone, 'agent.mind')]);
  assert.equal(run(originCLI, ['purge', '--install-dir', path.join(clone, 'agent.mind'), '--digest', clonePlan.digest]).state, 'purged');
  assert(!fs.existsSync(path.join(clone, 'agent.mind')));
  // Without the original local receipt, the separating CRLF belongs to the
  // cloned owner's surrounding text and must not be guessed away on detach.
  assert.equal(fs.readFileSync(path.join(clone, 'AGENTS.md'), 'utf8'), agents + '\r\n');
  assert(fs.existsSync(path.join(clone, 'src/module-c.mjs')));
  checks.push('portable clone explicit adoption and reviewed purge preserve host source');

  view = spawn(process.execPath, [cli, 'view'], { cwd: other, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = await new Promise((resolve, reject) => {
    let output = '', error = '';
    const timer = setTimeout(() => reject(new Error(`View readiness timeout: ${error}`)), 10000);
    view.once('error', err => { clearTimeout(timer); reject(err); });
    view.stderr.on('data', bytes => { error += bytes; });
    view.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited ${code}: ${error}`)); });
    view.stdout.on('data', bytes => {
      output += bytes;
      try { const value = JSON.parse(output); if (value.url) { clearTimeout(timer); resolve(value); } } catch {}
    });
  });
  const graph = await (await fetch(`${started.url}/api/graph`)).json();
  assert.equal(graph.project.root, project);
  assert.equal(graph.binding.id, context.binding.id);
  assert.equal(graph.revision, context.revision);
  assert(graph.nodes.some(node => node.path === 'legacy/core.mjs'));
  assert(!graph.nodes.some(node => node.path?.startsWith('agent.mind/')));
  const sourceResponse = await fetch(`${started.url}/api/source?path=legacy/core.mjs`);
  assert.equal(sourceResponse.status, 200);
  assert((await sourceResponse.json()).lines.some(line => line.text.includes('stillActive')));
  for (const asset of ['/', '/visualizer.js', '/hierarchy.mjs', '/assets/canvas-paper.webp', '/assets/agent-mind-wordmark.webp']) assert.equal((await fetch(started.url + asset)).status, 200);
  assert.equal((await fetch(`${started.url}/api/graph`, { headers: { Origin: 'https://example.com' } })).status, 403);
  run(cli, ['detach'], false);
  const ended = once(view, 'exit'); view.kill('SIGINT'); await ended; view = null;
  checks.push('real loopback graph/source/assets use same binding; active view protects lifecycle');

  fs.appendFileSync(path.join(project, 'src/module-c.mjs'), '// later source edit\n');
  assert.match(run(cli, ['preflight', 'block:module-c', ...receipt], false), /revision changed/i);
  const current = run(cli, ['context', 'Module C']);
  run(cli, ['detach']);
  assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), agents);
  run(cli, ['context', 'Module C'], false);
  run(cli, ['attach']);
  assert.match(run(cli, ['preflight', 'block:module-c', '--revision', current.revision, '--binding-id', current.binding.id, '--generation', String(current.binding.generation)], false), /expired/i);
  checks.push('source drift and pre-detach receipts rejected; exact owner instructions restored');

  const userNote = '\nOwner edit must survive.\n';
  fs.appendFileSync(path.join(installDir, 'README.md'), userNote);
  fs.writeFileSync(path.join(installDir, 'owner-note.txt'), 'keep');
  const removal = run(cli, ['uninstall']);
  assert.equal(removal.state, 'uninstalled');
  assert(fs.readFileSync(path.join(installDir, 'README.md'), 'utf8').endsWith(userNote));
  assert.equal(fs.readFileSync(path.join(installDir, 'owner-note.txt'), 'utf8'), 'keep');
  assert(fs.existsSync(path.join(installDir, 'project-map.json')));
  assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(run(originCLI, ['status', '--install-dir', installDir]).state, 'uninstalled');
  assert.equal(run(originCLI, ['uninstall', '--install-dir', installDir]).state, 'uninstalled');
  checks.push('uninstall preserves edited/unknown/user data and supports tombstone retry');
  const plan = run(originCLI, ['purge-plan', '--install-dir', installDir]);
  fs.appendFileSync(path.join(installDir, 'owner-note.txt'), ' later change');
  run(originCLI, ['purge', '--install-dir', installDir, '--digest', plan.digest], false);
  const freshPlan = run(originCLI, ['purge-plan', '--install-dir', installDir]);
  assert.equal(run(originCLI, ['purge', '--install-dir', installDir, '--digest', freshPlan.digest]).state, 'purged');
  assert(!fs.existsSync(installDir));
  assert(fs.existsSync(path.join(project, 'src/module-c.mjs')));
  checks.push('explicit final purge rejects changed inventory and removes only its target');
  console.log(JSON.stringify({ status: 'passed', artifactDigest: installed.runtime.digest, checks }, null, 2));
} finally {
  if (view) { const ended = once(view, 'exit'); view.kill('SIGTERM'); await ended; }
  fs.rmSync(temporary, { recursive: true, force: true });
}
