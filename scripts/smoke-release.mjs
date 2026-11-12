// Exercise the actual shipped CLI/runtime, never a fake runner or a model response.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

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
  const runtime = path.join(installDir, '.local/runtime', installed.runtime.digest);
  const runtimeRequire = createRequire(path.join(runtime, 'package.json'));
  assert.equal(runtimeRequire.resolve('@babel/parser'), path.join(runtime, 'node_modules/@babel/parser/lib/index.js'));
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'node_modules/@babel')), ['parser']);
  for (let ancestor = path.dirname(runtime); ; ancestor = path.dirname(ancestor)) {
    for (const dependency of ['@babel/parser', '@babel/types', '@babel/helper-string-parser', '@babel/helper-validator-identifier']) {
      assert(!fs.existsSync(path.join(ancestor, 'node_modules', dependency)), `Ancestor dependency would invalidate isolation proof: ${ancestor}/${dependency}`);
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  checks.push('trimmed parser resolves inside the shipped runtime with no ancestor Babel packages');

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

  const profileRun = spawnSync(process.execPath, [cli, 'context', 'block:module-c', '--profile', 'agent'], { cwd: other, encoding: 'utf8', timeout: 15000 });
  assert.equal(profileRun.status, 0, profileRun.stderr);
  assert(Buffer.byteLength(profileRun.stdout, 'utf8') <= 10000);
  assert.equal(profileRun.stdout.endsWith('\n'), false);
  const bounded = JSON.parse(profileRun.stdout);
  assert.equal(bounded.profile, 'agent'); assert.equal(bounded.schemaVersion, 1);
  assert.deepEqual(bounded.binding, context.binding); assert.equal(bounded.revision, context.revision);
  const concise = run(cli, ['preflight', 'block:module-c', '--profile', 'agent', ...receipt]);
  assert.equal(concise.receipt, 'preflight'); assert.equal(concise.preflight, 'verified-at-read');
  assert.equal(concise.snapshot, bounded.snapshot); assert.deepEqual(concise.coverage, bounded.coverage);
  for (const key of ['nodes', 'edges', 'symbolGraph', 'inventory', 'vocabulary', 'page']) assert.equal(Object.hasOwn(concise, key), false);
  const inventoryPage = run(cli, ['context', 'block:module-c', '--profile', 'agent', '--section', 'inventory', ...receipt]);
  assert.equal(inventoryPage.page.section, 'inventory'); assert.equal(inventoryPage.snapshot, bounded.snapshot);
  const diagnosticReference = concise.diagnostics.find(item => item.section === 'diagnostics');
  assert.equal(run(cli, ['context', 'block:module-c', '--profile', 'agent', '--cursor', diagnosticReference.cursor, ...receipt]).snapshot, concise.snapshot);
  const insufficient = spawnSync(process.execPath, [cli, 'preflight', 'block:module-c', '--profile', 'agent', '--max-bytes', '256', ...receipt], { cwd: other, encoding: 'utf8', timeout: 15000 });
  assert.equal(insufficient.status, 1); assert.equal(JSON.parse(insufficient.stdout).error.code, 'CONTEXT_BUDGET_TOO_SMALL');
  assert(Buffer.byteLength(insufficient.stdout, 'utf8') <= 256);
  // Whole-project context is a supported initial selection and must remain retrievable.
  const rootFixture = path.join(project, 'src/root-pagination.mjs');
  fs.writeFileSync(rootFixture, Array.from({ length: 50 }, (_, i) => `export function whole${i}() { return ${i}; }`).join('\n'));
  try {
    const rootProfile = ['--profile', 'agent', '--max-bytes', '6000'];
    const whole = run(cli, ['context', ...rootProfile]);
    assert.equal(whole.selection, null); assert(whole.page.next);
    const rootIdentity = ['--revision', whole.revision, '--binding-id', whole.binding.id, '--generation', String(whole.binding.generation)];
    const continued = run(cli, ['context', ...rootProfile, '--cursor', whole.page.next, ...rootIdentity]);
    assert.equal(continued.snapshot, whole.snapshot); assert.equal(continued.selection, null);
    assert(continued.page.items.length || continued.page.fragments.length);
    const rootInventory = run(cli, ['context', ...rootProfile, '--section', 'inventory', ...rootIdentity]);
    assert.equal(rootInventory.snapshot, whole.snapshot); assert.equal(rootInventory.page.section, 'inventory');
    assert.match(run(cli, ['preflight', ...rootProfile, ...rootIdentity], false), /requires one exact selector/);
    assert.match(run(cli, ['context', 'block:module-c', ...rootProfile, '--cursor', whole.page.next, ...rootIdentity], false), /snapshot changed/);
  } finally { fs.unlinkSync(rootFixture); }
  checks.push('installed bounded profile includes binding within wire budget and returns concise gated receipt with pinned section/cursor retrieval');

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
  assert.match(run(cli, ['preflight', 'block:module-c', '--profile', 'agent', ...receipt], false), /revision changed/i);
  assert.match(run(cli, ['context', 'block:module-c', '--profile', 'agent', '--cursor', diagnosticReference.cursor, ...receipt], false), /revision changed/i);
  const current = run(cli, ['context', 'Module C']);
  const refreshedProfile = run(cli, ['context', 'block:module-c', '--profile', 'agent']);
  assert.equal(refreshedProfile.revision, current.revision); assert.notEqual(refreshedProfile.revision, bounded.revision);
  assert.equal(run(cli, ['preflight', 'block:module-c', '--profile', 'agent', '--revision', refreshedProfile.revision, '--binding-id', refreshedProfile.binding.id, '--generation', String(refreshedProfile.binding.generation)]).preflight, 'verified-at-read');
  run(cli, ['detach']);
  assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), agents);
  run(cli, ['context', 'Module C'], false);
  run(cli, ['attach']);
  assert.match(run(cli, ['preflight', 'block:module-c', '--revision', current.revision, '--binding-id', current.binding.id, '--generation', String(current.binding.generation)], false), /expired/i);
  checks.push('source drift and pre-detach receipts rejected; exact owner instructions restored');

  fs.writeFileSync(path.join(project, 'src/typed.ts'), 'export interface Box { value: string; }\nexport function typed(value: Box): string { return value.value; }\n');
  const typedContext = run(cli, ['context', 'src/typed.ts']);
  assert.equal(typedContext.status, 'partial');
  const partialProfile = run(cli, ['context', 'src/typed.ts', '--profile', 'agent']);
  assert.equal(partialProfile.status, 'partial');
  assert.match(run(cli, ['preflight', 'src/typed.ts', '--profile', 'agent', '--revision', partialProfile.revision, '--binding-id', partialProfile.binding.id, '--generation', String(partialProfile.binding.generation)], false), /partial/i);
  assert(typedContext.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#Box'));
  assert(typedContext.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#typed'));
  assert.match(run(cli, ['preflight', 'src/typed.ts', '--revision', typedContext.revision, '--binding-id', typedContext.binding.id, '--generation', String(typedContext.binding.generation)], false), /partial/i);
  checks.push('shipped parser extracts typed declarations while installed preflight rejects syntax-only context');

  for (const name of ['python', 'common', 'lr', 'highlight']) {
    assert(fs.existsSync(path.join(runtime, 'node_modules/@lezer', name, 'dist/index.js')));
    assert(!fs.existsSync(path.join(runtime, 'node_modules/@lezer', name, 'dist/index.cjs')));
    for (let ancestor = path.dirname(runtime); ; ancestor = path.dirname(ancestor)) {
      assert(!fs.existsSync(path.join(ancestor, 'node_modules/@lezer', name)), 'Ancestor Lezer package invalidates runtime isolation');
      if (path.dirname(ancestor) === ancestor) break;
    }
  }
  // Remove only this harness's typed fixture: its intentionally partial analysis
  // must not mask the first-class Python context/preflight acceptance below.
  fs.unlinkSync(path.join(project, 'src/typed.ts'));
  fs.writeFileSync(path.join(project, 'src/__init__.py'), '');
  fs.writeFileSync(path.join(project, 'src/helper.py'), 'def remote(): return 2\n');
  const pythonSource = 'from .helper import remote\nraise RuntimeError("Scanned source must not run")\ndef helper(): return 1\ndef __target(): return 0\ndef _Service__target(): return 2\nclass Service:\n    from .__dep import remote\n    async def run(self):\n        return helper() + __target()\n';
  const privateSources = { 'src/python.py': pythonSource, 'src/__dep.py': 'def remote(): return 0\n', 'src/_Service__dep.py': 'def remote(): return 2\n' };
  for (const [relative, contents] of Object.entries(privateSources)) fs.writeFileSync(path.join(project, relative), contents);
  const pythonContext = run(cli, ['context', 'src/python.py']);
  assert.equal(pythonContext.status, 'current');
  assert(pythonContext.symbolGraph.nodes.some(node => node.id === 'symbol:src/python.py#Service.run'));
  assert(pythonContext.symbolGraph.edges.some(edge => edge.from === 'symbol:src/python.py#Service.run' && edge.to === 'symbol:src/python.py#helper'));
  assert(pythonContext.edges.some(edge => edge.kind === 'import' && edge.from === 'file:src/python.py' && edge.to === 'file:src/helper.py'));
  const privateImport = pythonContext.edges.find(edge => edge.kind === 'import' && edge.from === 'file:src/python.py' && edge.to === 'file:src/_Service__dep.py');
  assert.deepEqual(privateImport?.evidence, [{ path: 'src/python.py', line: 7, column: 5, snippet: 'from .__dep import remote' }]);
  assert(!pythonContext.edges.some(edge => edge.from === 'file:src/python.py' && edge.to === 'file:src/__dep.py'));
  const privateCall = pythonContext.symbolGraph.edges.find(edge => edge.from === 'symbol:src/python.py#Service.run' && edge.to === 'symbol:src/python.py#_Service__target');
  assert(privateCall?.evidence.some(item => item.path === 'src/python.py' && item.line === 9 && item.snippet === 'return helper() + __target()'));
  assert(!pythonContext.symbolGraph.edges.some(edge => edge.from === 'symbol:src/python.py#Service.run' && edge.to === 'symbol:src/python.py#__target'));
  for (const [key, value] of Object.entries(run(cli, ['status']).binding)) assert.equal(pythonContext.binding[key], value);
  for (const [relative, contents] of Object.entries(privateSources)) assert.equal(fs.readFileSync(path.join(project, relative), 'utf8'), contents);
  const pythonReceipt = ['--revision', pythonContext.revision, '--binding-id', pythonContext.binding.id, '--generation', String(pythonContext.binding.generation)];
  assert.equal(run(cli, ['preflight', 'src/python.py', ...pythonReceipt]).preflight, 'verified-at-read');
  fs.appendFileSync(path.join(project, 'src/python.py'), '# changed after preflight\n');
  assert.match(run(cli, ['preflight', 'src/python.py', ...pythonReceipt], false), /revision changed/i);
  fs.writeFileSync(path.join(project, 'src/python.py'), 'def original(): pass\ndef broken(\n');
  const failedPython = run(cli, ['context', 'src/python.py']);
  assert(!failedPython.symbolGraph.nodes.some(node => node.path === 'src/python.py'));
  assert(failedPython.diagnostics.some(d => /parse error/i.test(d.message)));
  assert.equal(failedPython.status, 'partial');
  assert.match(run(cli, ['preflight', 'src/python.py', ...pythonReceipt], false), /partial/i);
  fs.writeFileSync(path.join(project, 'src/python.py'), pythonSource);
  const restoredPython = run(cli, ['context', 'src/python.py']);
  assert.equal(restoredPython.status, 'current');
  assert.equal(restoredPython.revision, pythonContext.revision);
  assert.deepEqual(restoredPython.binding, pythonContext.binding);
  assert.equal(run(cli, ['preflight', 'src/python.py', ...pythonReceipt]).preflight, 'verified-at-read');
  for (const [relative, contents] of Object.entries(privateSources)) assert.equal(fs.readFileSync(path.join(project, relative), 'utf8'), contents);
  checks.push('shipped Python runtime preserves private import/call identity and raw evidence, accepts current preflight, rejects stale/error context and preserves binding/source without execution');

  const repairSource = [
    'raise RuntimeError("Scanned source must not run")',
    'class A: pass',
    'A()',
    'def maker(): return A()',
    'def target(): pass',
    'def replacement(): pass',
    'factory = lambda value=(target := replacement): None',
    'def caller(): target()',
    'def __annotations__(): pass',
    'class C:',
    '    value: int',
    '    __annotations__()',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(project, 'src/repairs.py'), repairSource);
  const repairs = run(cli, ['context', 'src/repairs.py']);
  assert.equal(repairs.status, 'current');
  const constructs = repairs.symbolGraph.edges.filter(edge => edge.to === 'symbol:src/repairs.py#A');
  assert.deepEqual(constructs.map(edge => [edge.from, edge.kind]).sort(), [
    ['file:src/repairs.py', 'construct'], ['symbol:src/repairs.py#maker', 'construct'],
  ]);
  for (const edge of constructs) {
    const projected = repairs.partCanvas.edges.find(item => item.sourceEdgeIds.includes(edge.id));
    assert.equal(projected?.kind, 'construct'); assert.equal(projected.label, 'constructs');
    assert.deepEqual(projected.evidence, edge.evidence);
    assert(repairs.canvas.edges.some(item => item.sourceEdgeIds.includes(edge.id)) ||
      repairs.canvas.areas.some(area => area.internalSourceEdgeIds.includes(edge.id)));
  }
  assert(!repairs.symbolGraph.edges.some(edge => edge.from === 'symbol:src/repairs.py#caller'));
  assert(!repairs.symbolGraph.edges.some(edge => edge.from === 'symbol:src/repairs.py#C'));
  assert(repairs.diagnostics.some(item => /__annotations__/.test(item.message)));
  assert.equal(run(cli, ['preflight', 'src/repairs.py', '--revision', repairs.revision, '--binding-id', repairs.binding.id, '--generation', String(repairs.binding.generation)]).preflight, 'verified-at-read');
  assert.deepEqual(repairs.binding, pythonContext.binding);
  assert.equal(fs.readFileSync(path.join(project, 'src/repairs.py'), 'utf8'), repairSource);
  checks.push('shipped Python repairs retain construct kind and source IDs through file/area context and suppress lambda-default and version-sensitive class annotation false targets');

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
