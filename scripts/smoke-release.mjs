// Exercise the actual shipped CLI/runtime, never a fake runner or a model response.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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
  const ownerIgnore = Buffer.from('# Owner root policy\r\n');
  fs.writeFileSync(path.join(project, '.gitignore'), ownerIgnore);
  const hostPackage = '{"name":"fixture","private":true}\n';
  fs.writeFileSync(path.join(project, 'package.json'), hostPackage);
  const originCLI = path.join(release, 'cli.mjs');
  const installed = run(originCLI, ['install', '--project', project, '--release', release, '--attach']);
  assert.equal(installed.state, 'attached');
  assert.equal(installed.integrity, 'verified');
  const installDir = path.join(project, 'agent.mind'), cli = path.join(installDir, 'cli.mjs');
  assert.equal(fs.readFileSync(path.join(project, 'package.json'), 'utf8'), hostPackage);
  assert.deepEqual(fs.readFileSync(path.join(project, '.gitignore')), ownerIgnore);
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

  const commonJSPath = path.join(project, 'src/legacy.cjs');
  try {
    fs.writeFileSync(commonJSPath, "module.exports = require('./module-c.mjs');\nthrow new Error('Scanned source must not run');\n");
    const cjs = run(cli, ['context', 'src/legacy.cjs']);
    assert.equal(cjs.status, 'partial'); assert.equal(cjs.inventory.status, 'complete');
    assert.deepEqual(cjs.selection.capabilities, ['text']); assert.deepEqual(cjs.edges, []);
    assert.equal(cjs.nodes.find(node => node.path === 'src/legacy.cjs').diagnostics[0].code, 'COMMONJS_REFERENCE_ANALYSIS_UNSUPPORTED');
    const cjsIdentity = ['--revision', cjs.revision, '--binding-id', cjs.binding.id, '--generation', String(cjs.binding.generation)];
    const cjsPage = run(cli, ['context', 'src/legacy.cjs', '--profile', 'agent', '--section', 'diagnostics', ...cjsIdentity]);
    assert(cjsPage.page.items.some(item => item.value.reason === 'cjs-extension'));
    for (const flags of [[], ['--profile', 'agent']]) assert.match(run(cli, ['preflight', 'src/legacy.cjs', ...flags, ...cjsIdentity], false), /requires current context/);
  } finally { fs.rmSync(commonJSPath, { force: true }); }
  assert.equal(run(cli, ['context', 'Module C']).revision, context.revision);
  assert.equal(run(cli, ['preflight', 'block:module-c', ...receipt]).preflight, 'verified-at-read');
  checks.push('unsupported CommonJS remains text-only with explicit diagnostics; strict preflight rejects and recovers after removal');

  // R07 competes for the real installed runtime's file budget. Do not run the
  // fixture project; inspect its source-derived context and strict preflight.
  const priorityAssets = path.join(project, 'r07-assets');
  const prioritySource = path.join(project, 'src/r07-priority.mjs');
  const priorityPreserved = ['.gitignore', 'package.json', 'src/module-c.mjs', 'agent.mind/project-map.json', 'agent.mind/project.json']
    .map(name => [name, fs.readFileSync(path.join(project, name))]);
  fs.mkdirSync(priorityAssets);
  try {
    for (let i = 0; i < 1005; i++) fs.writeFileSync(path.join(priorityAssets, String(i).padStart(4, '0') + '.json'), '{}');
    fs.writeFileSync(prioritySource, "import { normalizeCount } from './module-c.mjs';\nexport function priorityCount(value) { return normalizeCount(value); }\nthrow new Error('R07_SOURCE_MUST_NOT_EXECUTE');\n");
    const prioritized = run(cli, ['context', 'src/r07-priority.mjs']);
    assert.equal(prioritized.project.root, project);
    assert.equal(prioritized.status, 'partial');
    assert.equal(prioritized.inventory.status, 'partial');
    const priorityNode = prioritized.nodes.find(node => node.path === 'src/r07-priority.mjs');
    assert(priorityNode?.symbols.some(symbol => symbol.name === 'priorityCount'));
    assert(prioritized.edges.some(edge => edge.from === priorityNode.id && edge.to === 'file:src/module-c.mjs' && edge.kind === 'import'));
    assert(prioritized.inventory.entries.some(entry => entry.path.startsWith('r07-assets/') && entry.state === 'unscanned' && entry.reason === 'file-limit'));
    const priorityReceipt = ['--revision', prioritized.revision, '--binding-id', prioritized.binding.id, '--generation', String(prioritized.binding.generation)];
    // A readable selected source cannot grant a complete-project preflight.
    for (const flags of [[], ['--profile', 'agent']]) assert.match(run(cli, ['preflight', 'src/r07-priority.mjs', ...flags, ...priorityReceipt], false), /requires current context/);
    for (const [name, bytes] of priorityPreserved) assert.deepEqual(fs.readFileSync(path.join(project, name)), bytes, name);
  } finally {
    fs.rmSync(priorityAssets, { recursive: true, force: true });
    fs.rmSync(prioritySource, { force: true });
  }
  assert.equal(run(cli, ['context', 'Module C']).revision, context.revision);
  checks.push('installed source priority survives 1005 JSON candidates while incomplete global scope rejects full and agent preflight and preserves owner bytes');

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
  // R06 is exercised through the produced bundle's installed CLI and real view.
  // Only harness-owned disposable inputs change; restore policy/map byte-for-byte.
  const ignorePath = path.join(project, '.gitignore');
  const mapPath = path.join(installDir, 'project-map.json');
  const descriptorPath = path.join(installDir, 'project.json');
  const originalIgnore = fs.readFileSync(ignorePath);
  const originalMap = fs.readFileSync(mapPath);
  const originalDescriptor = fs.readFileSync(descriptorPath);
  const policyFiles = [
    'dist/generated.mjs', 'build/generated.mjs', 'venv/generated.mjs',
    'src/build/legitimate.mjs', 'agent.mind-copy/visible.mjs',
    'src/agent.mind/visible.mjs', 'src/revocable.mjs',
    'src/policy.pyc', 'src/policy.pyo', 'src/policy.pyd',
    'src/policy.py', 'src/policy.pycc', 'src/upper-policy.pyC', 'src/policy.pyx',
    'src/credentials.mjs', '.hidden-policy.mjs',
  ];
  const policyDirectories = ['dist', 'build', 'venv', 'src/build', 'agent.mind-copy', 'src/agent.mind'];
  const sourceMarker = 'R06_REVOKABLE_SOURCE_SENTINEL';
  const labelMarker = 'R06_REVOKABLE_LABEL_SENTINEL';
  const getGraph = async () => {
    const response = await fetch(`${started.url}/api/graph`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const waitGraph = async predicate => {
    const deadline = Date.now() + 6000;
    do {
      const current = await getGraph();
      if (predicate(current)) return current;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.fail('Installed view did not reach the expected policy-consistent graph');
  };
  const sourceURL = (relative, snapshot) => `${started.url}/api/source?path=${encodeURIComponent(relative)}&policyId=${snapshot.inputPolicy.id}&revision=${snapshot.revision}`;
  const firstSSEState = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let reader;
    try {
      const response = await fetch(`${started.url}/api/events`, { signal: controller.signal });
      assert.equal(response.status, 200);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let frame = '';
      while (!frame.includes('\n\n')) {
        const { value, done } = await reader.read();
        assert.equal(done, false, 'SSE closed before its first state');
        frame += decoder.decode(value, { stream: true });
        assert(frame.length <= 8 * 1024 * 1024, 'SSE first frame exceeded the smoke bound');
      }
      assert(frame.startsWith('event: state\n'));
      return JSON.parse(frame.split('\n\n')[0].split('data: ')[1]);
    } finally {
      clearTimeout(timer); controller.abort();
      await reader?.cancel().catch(() => {});
    }
  };
  const assertWithheld = snapshot => {
    assert.equal(snapshot.inputPolicy.status, 'invalid');
    assert.equal(snapshot.status, 'partial');
    assert.deepEqual(snapshot.nodes, []); assert.deepEqual(snapshot.edges, []);
    assert.deepEqual(snapshot.symbolGraph.nodes, []); assert.deepEqual(snapshot.symbolGraph.edges, []);
    assert.equal(snapshot.metadata, null);
    assert.deepEqual(snapshot.runtime.changes, []);
    for (const marker of [sourceMarker, labelMarker, 'R06_RAW_POLICY_MUST_NOT_ECHO']) assert(!JSON.stringify(snapshot).includes(marker));
  };
  try {
    for (const relative of policyFiles) {
      const file = path.join(project, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relative === 'src/revocable.mjs'
        ? `export const revocable = "${sourceMarker}";\n`
        : relative === 'src/policy.py' ? '\n' : 'export const harmless = true;\n');
    }
    const naming = JSON.parse(originalMap);
    naming.blocks.push({ id: 'r06-revocable', label: labelMarker, aliases: [], description: '', type: 'module', group: 'core', files: ['src/revocable.mjs'], prefixes: [] });
    fs.writeFileSync(mapPath, JSON.stringify(naming));
    const initial = run(cli, ['context', 'block:module-c']);
    const initialGraph = await waitGraph(current => current.revision === initial.revision);
    assert.equal(initialGraph.inputPolicy.status, 'valid');
    for (const relative of ['src/policy.pyc', 'src/policy.pyo', 'src/policy.pyd', 'src/policy.py', 'src/policy.pycc', 'src/upper-policy.pyC', 'src/policy.pyx']) assert(initialGraph.nodes.some(node => node.path === relative), relative);
    const installedPolicyContext = run(cli, ['context']);
    assert.equal(installedPolicyContext.inputPolicy.id, initialGraph.inputPolicy.id);
    assert.deepEqual(installedPolicyContext.nodes.map(node => node.id), initialGraph.nodes.map(node => node.id));
    for (const relative of ['src/build/legitimate.mjs', 'agent.mind-copy/visible.mjs', 'src/agent.mind/visible.mjs', 'src/revocable.mjs']) assert(initialGraph.nodes.some(node => node.path === relative), relative);
    for (const relative of ['dist/generated.mjs', 'build/generated.mjs', 'venv/generated.mjs']) {
      assert(!initialGraph.nodes.some(node => node.path === relative), relative);
      assert.equal((await fetch(`${started.url}/api/source?path=${relative}`)).status, 409);
    }
    assert(!initialGraph.nodes.some(node => node.path?.startsWith('agent.mind/')));
    assert(initialGraph.overview.nodes.some(node => node.label === 'Module C'));
    assert.equal((await fetch(`${started.url}/api/source?path=agent.mind/project-map.json`)).status, 409);
    const initialReceipt = ['--revision', initial.revision, '--binding-id', initial.binding.id, '--generation', String(initial.binding.generation)];
    const initialProfile = run(cli, ['preflight', 'block:module-c', '--profile', 'agent', ...initialReceipt]);
    const policyCursor = initialProfile.diagnostics.find(item => item.section === 'diagnostics').cursor;
    const unchangedNode = initialGraph.nodes.find(node => node.path === 'src/module-c.mjs');
    const initialSourceURL = sourceURL('src/module-c.mjs', initialGraph);
    assert.equal((await fetch(initialSourceURL)).status, 200);
    const warmRevocable = await fetch(sourceURL('src/revocable.mjs', initialGraph));
    assert.equal(warmRevocable.status, 200);
    assert((await warmRevocable.json()).lines.some(line => line.text.includes(sourceMarker)));

    fs.writeFileSync(ignorePath, Buffer.concat([originalIgnore, Buffer.from('# comment-only policy change\r\n')]));
    assert.equal((await fetch(initialSourceURL)).status, 409);
    const commentGraph = await getGraph();
    assert.equal(commentGraph.inputPolicy.status, 'valid');
    assert.notEqual(commentGraph.inputPolicy.id, initialGraph.inputPolicy.id);
    assert.notEqual(commentGraph.revision, initialGraph.revision);
    assert.equal(commentGraph.nodes.find(node => node.id === unchangedNode.id).hash, unchangedNode.hash);
    for (const flags of [[], ['--profile', 'agent']]) assert.match(run(cli, ['preflight', 'block:module-c', ...flags, ...initialReceipt], false), /revision changed/i);
    assert.match(run(cli, ['context', 'block:module-c', '--profile', 'agent', '--cursor', policyCursor, ...initialReceipt], false), /revision changed/i);
    const commentSource = await (await fetch(sourceURL('src/module-c.mjs', commentGraph))).json();
    assert.equal(commentSource.policyId, commentGraph.inputPolicy.id);
    assert.equal(commentSource.revision, commentGraph.revision);
    assert.equal(commentSource.hash, unchangedNode.hash);

    // P1: the installed v2 runtime must apply sets through the same live boundary.
    // All fixture files are harmless text; the hidden/sensitive negative controls
    // stay inaccessible even when an explicit set rule attempts to include them.
    const setPolicy = Buffer.concat([originalIgnore, Buffer.from('*.py[cod]\r\n!agent.[m]ind/\r\n!src/credential[s].mjs\r\n!.hidden-policy.[m]js\r\n')]);
    fs.writeFileSync(ignorePath, setPolicy);
    const setContext = run(cli, ['context', 'block:module-c']);
    const setGraph = await waitGraph(current => current.revision === setContext.revision);
    assert.equal(setGraph.inputPolicy.version, 'root-ignore-v2');
    assert.equal(setGraph.inputPolicy.status, 'valid');
    assert.equal(setContext.inputPolicy.id, setGraph.inputPolicy.id);
    assert(!setGraph.nodes.some(node => node.path?.startsWith('agent.mind/')));
    assert.deepEqual(run(cli, ['context']).nodes.map(node => node.id), setGraph.nodes.map(node => node.id));
    for (const relative of ['src/policy.pyc', 'src/policy.pyo', 'src/policy.pyd', 'src/credentials.mjs', '.hidden-policy.mjs']) {
      assert(!setGraph.nodes.some(node => node.path === relative), relative);
      assert.equal((await fetch(sourceURL(relative, setGraph))).status, 409);
    }
    for (const relative of ['src/policy.py', 'src/policy.pycc', 'src/upper-policy.pyC', 'src/policy.pyx']) assert(setGraph.nodes.some(node => node.path === relative), relative);
    const setReceipt = ['--revision', setContext.revision, '--binding-id', setContext.binding.id, '--generation', String(setContext.binding.generation)];
    const setProfile = run(cli, ['preflight', 'block:module-c', '--profile', 'agent', ...setReceipt]);
    const setCursor = setProfile.diagnostics.find(item => item.section === 'diagnostics').cursor;
    assert.equal((await fetch(sourceURL('src/module-c.mjs', commentGraph))).status, 409);
    const setSourceURL = sourceURL('src/module-c.mjs', setGraph);
    assert.equal((await fetch(setSourceURL)).status, 200);
    assert.deepEqual(fs.readFileSync(ignorePath), setPolicy);
    fs.writeFileSync(ignorePath, Buffer.concat([setPolicy, Buffer.from('# v2 comment-only edit\r\n')]));
    const setComment = await getGraph();
    assert.notEqual(setComment.inputPolicy.id, setGraph.inputPolicy.id);
    assert.notEqual(setComment.revision, setGraph.revision);
    assert.equal(setComment.nodes.find(node => node.id === unchangedNode.id).hash, unchangedNode.hash);
    assert.equal((await fetch(setSourceURL)).status, 409);
    for (const flags of [[], ['--profile', 'agent']]) assert.match(run(cli, ['preflight', 'block:module-c', ...flags, ...setReceipt], false), /revision changed/i);
    assert.match(run(cli, ['context', 'block:module-c', '--profile', 'agent', '--cursor', setCursor, ...setReceipt], false), /revision changed/i);
    fs.writeFileSync(ignorePath, Buffer.concat([setPolicy, Buffer.from('unobserved/[a-z]\n')]));
    assertWithheld(await getGraph());
    assertWithheld(await firstSSEState());
    assert.equal((await fetch(setSourceURL)).status, 409);
    const setInvalid = run(cli, ['context']);
    assert.equal(setInvalid.inputPolicy.status, 'invalid');
    assert.deepEqual(setInvalid.nodes, []);
    assert.match(run(cli, ['preflight', 'block:module-c', ...setReceipt], false), /partial|current context|active index/i);
    const recoveredSetPolicy = Buffer.concat([setPolicy, Buffer.from('# recovered v2 policy\r\n')]);
    fs.writeFileSync(ignorePath, recoveredSetPolicy);
    const setRecovered = await getGraph();
    assert.equal(setRecovered.inputPolicy.status, 'valid');
    assert.equal((await fetch(sourceURL('src/module-c.mjs', setRecovered))).status, 200);
    assert.equal((await fetch(setSourceURL)).status, 409);
    const recoveredSetContext = run(cli, ['context', 'block:module-c']);
    assert.equal(run(cli, ['preflight', 'block:module-c', '--revision', recoveredSetContext.revision, '--binding-id', recoveredSetContext.binding.id, '--generation', String(recoveredSetContext.binding.generation)]).preflight, 'verified-at-read');
    assert.deepEqual(fs.readFileSync(ignorePath), recoveredSetPolicy);
    assert.deepEqual(fs.readFileSync(descriptorPath), originalDescriptor);
    checks.push('installed v2 sets exclude exact suffix members, preserve hard guards, reject stale policy/source/continuation/preflight, fail closed on unsupported sets and recover without changing owner bytes');

    fs.writeFileSync(ignorePath, Buffer.concat([originalIgnore, Buffer.from('/src/revocable.mjs\n')]));
    const excluded = await getGraph();
    assert.equal(excluded.inputPolicy.status, 'valid');
    for (const marker of [sourceMarker, labelMarker]) assert(!JSON.stringify(excluded).includes(marker), marker);
    assert(!excluded.nodes.some(node => node.path === 'src/revocable.mjs'));
    const excludedContext = run(cli, ['context']);
    assert.equal(excludedContext.inputPolicy.id, excluded.inputPolicy.id);
    for (const marker of [sourceMarker, labelMarker]) assert(!JSON.stringify(excludedContext).includes(marker), marker);
    assert(!excludedContext.nodes.some(node => node.path === 'src/revocable.mjs'));
    assert.equal((await fetch(sourceURL('src/revocable.mjs', initialGraph))).status, 409);
    assert.equal((await fetch(`${started.url}/api/source?path=src/revocable.mjs`)).status, 409);
    const excludedPart = { target: 'file:src/revocable.mjs', label: labelMarker, description: '', aliases: [] };
    for (const parts of [excludedPart, [{ ...excludedPart, label: '' }], Array.from({ length: 513 }, (_, index) => ({ ...excludedPart, target: `symbol:src/revocable.mjs#value${index}` }))]) {
      fs.writeFileSync(mapPath, JSON.stringify({ ...naming, parts }));
      const invalidNames = run(cli, ['context', 'src/module-c.mjs']);
      assert.equal(invalidNames.status, 'partial');
      assert(!JSON.stringify(invalidNames).includes(labelMarker));
      const invalidGraph = await waitGraph(current => current.revision === invalidNames.revision);
      assert.equal(invalidGraph.metadata.status, 'error');
      assert(!JSON.stringify(invalidGraph).includes(labelMarker));
      assert(!JSON.stringify(await firstSSEState()).includes(labelMarker));
      const invalidReceipt = ['--revision', invalidNames.revision, '--binding-id', invalidNames.binding.id, '--generation', String(invalidNames.binding.generation)];
      for (const flags of [[], ['--profile', 'agent']]) assert.match(run(cli, ['preflight', 'src/module-c.mjs', ...flags, ...invalidReceipt], false), /requires current context/i);
    }
    fs.writeFileSync(mapPath, JSON.stringify(naming));
    await waitGraph(current => current.revision === excluded.revision);
    checks.push('invalid installed naming parts never expose excluded labels or lose the strict preflight gate after filtering');
    fs.writeFileSync(ignorePath, Buffer.concat([originalIgnore, Buffer.from('/agent.mind/project-map.json\n/src/revocable.mjs\n')]));
    const mapExcluded = await getGraph();
    assert.equal(mapExcluded.metadata.status, 'excluded');
    assert.equal(mapExcluded.metadata.configuration, null);
    assert(!JSON.stringify(mapExcluded).includes('Module C'));
    assert(!JSON.stringify(mapExcluded).includes(labelMarker));
    assert(mapExcluded.nodes.some(node => node.path === 'src/module-c.mjs'));
    assert.equal((await fetch(`${started.url}/api/source?path=agent.mind/project-map.json`)).status, 409);

    fs.writeFileSync(ignorePath, '**R06_RAW_POLICY_MUST_NOT_ECHO\n');
    assertWithheld(await getGraph());
    assertWithheld(await firstSSEState());
    assert.equal((await fetch(`${started.url}/api/source?path=src/module-c.mjs`)).status, 409);
    const invalidContext = run(cli, ['context']);
    assert.equal(invalidContext.inputPolicy.status, 'invalid');
    assert.deepEqual(invalidContext.nodes, []); assert.deepEqual(invalidContext.edges, []);
    for (const marker of [sourceMarker, labelMarker, 'R06_RAW_POLICY_MUST_NOT_ECHO']) assert(!JSON.stringify(invalidContext).includes(marker));
    assert.match(run(cli, ['preflight', 'src/module-c.mjs', '--revision', invalidContext.revision, '--binding-id', invalidContext.binding.id, '--generation', String(invalidContext.binding.generation)], false), /partial|requires current context|not in the active index/i);

    fs.writeFileSync(ignorePath, Buffer.concat([originalIgnore, Buffer.from('# recovered policy\n')]));
    const recovered = await getGraph();
    assert.equal(recovered.inputPolicy.status, 'valid');
    assert(recovered.nodes.some(node => node.path === 'src/revocable.mjs'));
    assert(recovered.overview.nodes.some(node => node.label === labelMarker));
    const recoveredSource = await fetch(sourceURL('src/revocable.mjs', recovered));
    assert.equal(recoveredSource.status, 200);
    assert((await recoveredSource.json()).lines.some(line => line.text.includes(sourceMarker)));
    assert.equal((await fetch(initialSourceURL)).status, 409);
    const recoveredContext = run(cli, ['context', 'Module C']);
    assert.equal(recoveredContext.revision, recovered.revision);
    assert.equal(run(cli, ['preflight', 'block:module-c', '--revision', recoveredContext.revision, '--binding-id', recoveredContext.binding.id, '--generation', String(recoveredContext.binding.generation)]).preflight, 'verified-at-read');
  } finally {
    fs.writeFileSync(ignorePath, originalIgnore);
    fs.writeFileSync(mapPath, originalMap);
    for (const relative of policyFiles) fs.rmSync(path.join(project, relative), { force: true });
    for (const relative of policyDirectories) if (fs.existsSync(path.join(project, relative))) fs.rmdirSync(path.join(project, relative));
    assert.deepEqual(fs.readFileSync(ignorePath), originalIgnore);
    assert.deepEqual(fs.readFileSync(mapPath), originalMap);
    assert.deepEqual(fs.readFileSync(descriptorPath), originalDescriptor);
  }
  assert.deepEqual(fs.readFileSync(ignorePath), ownerIgnore);
  assert.equal((await waitGraph(current => current.revision === context.revision)).inputPolicy.status, 'valid');
  checks.push('installed bundle enforces root defaults/exact integration/map policy, comment-only stale receipt/cursor/source revocation, invalid-policy graph/SSE/source withholding and fresh recovery while preserving descriptor/policy/map bytes');
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

  const typedSource = '// 🧠 Raw evidence retains UTF-16 offsets and CRLF.\r\nimport type { Remote as Alias } from "./remote\\u002ets";\r\nimport fs from "node:fs";\r\nexport { value as publicValue } from "./module-c.mjs";\r\nexport interface Box { value: string; }\r\nexport function typed(value: Box): string { return value.value; }\r\nconst deferred = import("./module-c.mjs");\r\n';
  fs.writeFileSync(path.join(project, 'src/typed.ts'), typedSource);
  const typedContext = run(cli, ['context', 'src/typed.ts']);
  assert.equal(typedContext.status, 'partial');
  const partialProfile = run(cli, ['context', 'src/typed.ts', '--profile', 'agent']);
  assert.equal(partialProfile.status, 'partial');
  assert.match(run(cli, ['preflight', 'src/typed.ts', '--profile', 'agent', '--revision', partialProfile.revision, '--binding-id', partialProfile.binding.id, '--generation', String(partialProfile.binding.generation)], false), /partial/i);
  assert(typedContext.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#Box'));
  assert(typedContext.symbolGraph.nodes.some(node => node.id === 'symbol:src/typed.ts#typed'));
  assert.match(run(cli, ['preflight', 'src/typed.ts', '--revision', typedContext.revision, '--binding-id', typedContext.binding.id, '--generation', String(typedContext.binding.generation)], false), /partial/i);
  const typedFile = typedContext.nodes.find(node => node.id === 'file:src/typed.ts');
  assert(typedFile.capabilities.includes('static-reference-syntax'));
  assert(!typedFile.capabilities.includes('static-references'));
  assert.deepEqual(typedFile.security, []);
  const syntax = typedFile.referenceSyntax;
  assert.equal(syntax.version, 'typed-reference-syntax-v1'); assert.equal(syntax.extraction, 'collected');
  assert.deepEqual(syntax.resolution, { status: 'unsupported', reason: 'typed-resolution-not-enabled' });
  assert.deepEqual(syntax.facts.map(fact => [fact.kind, fact.specifier, fact.typed.typeOnly]), [['import', './remote.ts', true], ['import', 'node:fs', false], ['reexport', './module-c.mjs', false]]);
  assert.equal(syntax.facts[0].typed.bindings[0].local, 'Alias');
  assert.equal(syntax.facts[0].typed.bindings[0].imported, 'Remote');
  assert.equal(syntax.facts[0].typed.bindings[0].typeOnly, true);
  const rawSpecifier = '"./remote\\u002ets"';
  assert.equal(syntax.facts[0].evidence.range.start, typedSource.indexOf(rawSpecifier));
  assert.equal(typedSource.slice(syntax.facts[0].evidence.range.start, syntax.facts[0].evidence.range.end), rawSpecifier);
  for (const fact of syntax.facts) {
    assert.equal(fact.evidence.hash, createHash('sha256').update(typedSource).digest('hex'));
    assert.equal(fact.evidence.path, 'src/typed.ts');
    for (const [offset, lineKey, columnKey] of [[fact.evidence.range.start, 'line', 'column'], [fact.evidence.range.end, 'endLine', 'endColumn']]) {
      const prefix = typedSource.slice(0, offset).split('\n');
      assert.equal(fact.evidence[lineKey], prefix.length); assert.equal(fact.evidence[columnKey], prefix.at(-1).length + 1);
    }
    assert.deepEqual(fact.evidence.producer, { name: '@babel/parser', version: '7.29.12', mode: 'syntax-only' });
    for (const range of [fact.evidence.range, fact.evidence.declarationRange, ...fact.typed.bindings.map(binding => binding.range)]) { assert.equal(range.unit, 'utf16-code-unit'); assert.equal(range.endExclusive, true); }
  }
  assert.equal(syntax.unsupported.length, 1);
  assert.match(typedSource.slice(syntax.unsupported[0].range.start, syntax.unsupported[0].range.end), /^import\(/);
  assert(!typedContext.edges.some(edge => edge.from === typedFile.id || edge.to === typedFile.id));
  assert(!typedContext.symbolGraph.edges.some(edge => edge.from.startsWith('symbol:src/typed.ts#') || edge.to.startsWith('symbol:src/typed.ts#')));
  assert(!typedContext.nodes.some(node => node.kind === 'external'));
  for (const node of typedContext.nodes.filter(node => node.path && !/\.(ts|tsx|jsx)$/.test(node.path))) assert.equal(Object.hasOwn(node, 'referenceSyntax'), false);
  const typedIdentity = ['--revision', typedContext.revision, '--binding-id', typedContext.binding.id, '--generation', String(typedContext.binding.generation)];
  const typedPage = run(cli, ['context', 'src/typed.ts', '--profile', 'agent']);
  const { contextCursor: shippedContextCursor } = await import(pathToFileURL(path.join(runtime, 'graph-context.mjs')));
  const typedCursor = shippedContextCursor(typedPage, 'diagnostics');
  assert.equal(run(cli, ['context', 'src/typed.ts', '--profile', 'agent', '--cursor', typedCursor, ...typedIdentity]).snapshot, typedPage.snapshot);
  const editedTypedSource = `// later source line\r\n${typedSource}`;
  fs.writeFileSync(path.join(project, 'src/typed.ts'), editedTypedSource);
  assert.match(run(cli, ['context', 'src/typed.ts', ...typedIdentity], false), /revision changed/i);
  assert.match(run(cli, ['context', 'src/typed.ts', '--profile', 'agent', '--cursor', typedCursor, ...typedIdentity], false), /revision changed/i);
  const editedTyped = run(cli, ['context', 'src/typed.ts']);
  const editedTypedFile = editedTyped.nodes.find(node => node.id === typedFile.id);
  assert.equal(editedTypedFile.referenceSyntax.facts[0].evidence.line, syntax.facts[0].evidence.line + 1);
  assert.equal(editedTypedFile.referenceSyntax.facts[0].evidence.hash, createHash('sha256').update(editedTypedSource).digest('hex'));
  assert.equal(run(cli, ['status']).binding.id, typedContext.binding.id);
  assert.equal(fs.readFileSync(path.join(project, 'src/typed.ts'), 'utf8'), editedTypedSource);
  checks.push('shipped typed runtime carries raw reference syntax/capability with explicit unsupported resolution, zero inferred edges/security/calls, partial strict refusal and source/cursor invalidation');

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
