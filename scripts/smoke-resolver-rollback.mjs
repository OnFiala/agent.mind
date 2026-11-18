// V16/V17: exact unreleased R13 -> R14 default -> opt-in -> default -> R13.
// Only disposable targets are installed. Never execute their source/package scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-resolver-rollback.mjs /absolute/exact-R13-baseline /absolute/R14-candidate');
const releases = args.map(value => fs.realpathSync(value));
assert.notEqual(...releases);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `Unexpected artifact/fixture symlink: ${relative}`);
    if (entry.isDirectory()) Object.assign(result, { [`${relative}/`]: 'directory' }, snapshot(root, relative));
    else { assert(entry.isFile()); result[relative] = sha(fs.readFileSync(path.join(root, relative))); }
  }
  return result;
}
const artifactBytes = releases.map(release => snapshot(release));
const verifiers = await Promise.all(releases.map(release => import(pathToFileURL(path.join(release, 'installation.mjs')))));
const artifacts = releases.map((release, i) => verifiers[i].verifyArtifact(release));
const [baseline, candidate] = artifacts;
assert.equal(baseline.version, '1.4.0');
assert.equal(baseline.digest, 'ad68027479f60777e85059d1d7c75630960ea9f8eb639c207ee5c22625acd25a', 'Use exact unreleased R13 source artifact, not published 1.4.0');
assert.notEqual(candidate.digest, baseline.digest);
assert(Object.hasOwn(candidate.files, 'typed-resolution.mjs'));
assert(!Object.hasOwn(baseline.files, 'typed-resolution.mjs'));
const contextModules = await Promise.all(releases.map(release => import(pathToFileURL(path.join(release, 'graph-context.mjs')))));
const pair = ['--resolver', 'bundler-local-v1', '--resolver-config', 'tsconfig.json'];
const identity = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-resolver-rollback-')));
const unrelated = path.join(temporary, 'unrelated cwd'); fs.mkdirSync(unrelated);
const env = { ...process.env }; delete env.AGENT_MIND_PROJECT;
const checks = [], receipts = [], preflightReceipts = [], fixtures = [];
const run = (cli, argv, expectedError) => {
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd: unrelated, env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error, result.error?.message);
  if (expectedError) {
    assert.notEqual(result.status, 0, `Expected rejection: ${argv.join(' ')}`); assert.match(result.stderr, expectedError);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
function fixture(name, typed) {
  const project = path.join(temporary, name), parkedRoot = path.join(temporary, `${name} parked outside target`);
  fs.mkdirSync(project); fs.mkdirSync(parkedRoot);
  const integration = path.join(project, 'agent.mind'), cli = path.join(integration, 'cli.mjs');
  const selected = typed ? 'main.ts' : 'main.mjs';
  const ownerAgents = '\ufeff# Owner instructions\r\nNever execute scanned source or package scripts.\r\n';
  const ignore = '# Owner policy must remain unchanged\r\n*.py[cod]\r\n';
  const config = '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}\r\n';
  const source = (typed ? 'import type { Remote } from "./target.gen";\r\nexport { value } from "./target.gen";\r\n' : '') +
    'throw new Error("SCANNED SOURCE MUST NEVER EXECUTE");\r\n' + Array.from({ length: 32 }, (_, i) => `export function item${i}() { return ${i}; }`).join('\r\n') + '\r\n';
  const host = { 'AGENTS.md': ownerAgents, '.gitignore': ignore, 'tsconfig.json': config,
    'package.json': '{"private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
    'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n', 'cache.pyc': 'Excluded synthetic bytecode; never execute.\n',
    'owner-note.txt': 'Owner target data.\r\n', [selected]: source,
    ...(typed ? { 'target.gen.ts': 'export interface Remote { value: number; }\r\nexport const value = 1;\r\n' } : {}) };
  for (const [relative, bytes] of Object.entries(host)) fs.writeFileSync(path.join(project, relative), bytes);
  const map = Buffer.from(JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'owner', label: 'Owner block', description: 'Disposable resolver fixture', aliases: ['owner-alias'], files: [selected], prefixes: [], type: 'module', group: 'core' }], parts: [{ target: `symbol:${selected}#item0`, label: 'Owner item', description: 'Original source name retained', aliases: ['owner-item'] }] }, null, 2) + '\r\n');
  const ownerData = Buffer.from('Owner integration data survives every artifact transition.\r\n');
  const savedMap = path.join(parkedRoot, 'saved-map.json'), savedOwner = path.join(parkedRoot, 'saved-owner.txt');
  const parked = []; let view;
  const assertHost = attached => {
    for (const [relative, bytes] of Object.entries(host)) {
      const actual = fs.readFileSync(path.join(project, relative));
      if (relative === 'AGENTS.md' && attached) assert(actual.toString('utf8').startsWith(bytes));
      else assert.deepEqual(actual, Buffer.from(bytes), `${name} host changed: ${relative}`);
    }
    assert(!fs.existsSync(path.join(project, 'node_modules')));
  };
  const context = (artifact, mode = false) => {
    const status = run(cli, ['status']);
    assert.equal(status.state, 'attached'); assert.equal(status.integrity, 'verified'); assert.deepEqual(status.conflicts, []);
    assert.equal(status.root, project); assert.equal(status.binding.root, project); assert.equal(status.runtime.digest, artifact.digest);
    assert.equal(Object.hasOwn(status, 'resolver'), false);
    const result = run(cli, ['context', ...(mode ? pair : [])]);
    assert.equal(result.project.root, project); assert.equal(result.binding.id, status.binding.id);
    assert.equal(result.inputPolicy.version, 'root-ignore-v2'); assert.equal(result.inputPolicy.status, 'valid');
    assert.equal(result.status, typed ? 'partial' : 'current');
    assert.deepEqual(fs.readFileSync(path.join(integration, 'project-map.json')), map);
    assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), ownerData);
    assert.equal(run(cli, ['context', 'owner-alias', ...(mode ? pair : [])]).selection.id, 'block:owner');
    assert.equal(run(cli, ['context', 'owner-item', ...(mode ? pair : [])]).selection.id, `symbol:${selected}#item0`);
    const node = result.nodes.find(item => item.path === selected);
    assert.equal(node.hash, sha(Buffer.from(source))); assert(!result.nodes.some(item => item.path === 'cache.pyc'));
    if (typed) {
      assert.equal(node.referenceSyntax.version, 'typed-reference-syntax-v1'); assert.equal(node.referenceSyntax.extraction, 'collected');
      assert.deepEqual(node.referenceSyntax.resolution, { status: 'unsupported', reason: 'typed-resolution-not-enabled' });
      assert.deepEqual(node.referenceSyntax.facts.map(fact => [fact.kind, fact.specifier, fact.typed.typeOnly]), [['import', './target.gen', true], ['reexport', './target.gen', false]]);
      for (const profile of [[], ['--profile', 'agent']]) run(cli, ['preflight', selected, ...profile, ...identity(result), ...(mode ? pair : [])], /partial/i);
      assert.deepEqual(node.security, []); assert.deepEqual(result.symbolGraph.edges, []);
    }
    if (mode) {
      assert.equal(result.resolver.mode, 'bundler-local-v1'); assert.equal(result.resolver.status, 'valid');
      assert.equal(result.resolver.configPath, 'tsconfig.json');
      assert.equal(result.resolver.configHash, sha(Buffer.from(config)));
      for (const file of result.nodes.filter(item => item.kind === 'file')) assert.equal(file.resolverId, result.resolver.id);
      if (typed) {
        assert.equal(node.referenceResolution.version, 'typed-local-resolution-v1');
        assert.deepEqual(node.referenceResolution.outcomes.map(item => [item.status, item.target]), [['resolved', 'target.gen.ts'], ['resolved', 'target.gen.ts']]);
        assert.equal(result.edges.length, 2);
        for (const edge of result.edges) { assert.equal(edge.provenance, 'typed-local-resolution'); assert.equal(edge.certainty, 'model-relative'); }
      }
    } else {
      assert.equal(Object.hasOwn(result, 'resolver'), false); assert.equal(Object.hasOwn(node, 'referenceResolution'), false);
      assert.equal(result.edges.length, 0);
    }
    assertHost(true);
    receipts.push({ fixture: name, digest: artifact.digest, mode: mode ? 'bundler-local-v1' : 'default', policyId: result.inputPolicy.id, revision: result.revision, resolverId: result.resolver?.id, bindingId: result.binding.id, generation: result.binding.generation, status: result.status });
    return result;
  };
  const install = index => {
    assert.equal(run(path.join(releases[index], 'cli.mjs'), ['install', '--project', project, '--release', releases[index], '--digest', artifacts[index].digest, '--attach']).state, 'attached');
    fs.writeFileSync(path.join(integration, 'project-map.json'), fs.existsSync(savedMap) ? fs.readFileSync(savedMap) : map);
    fs.writeFileSync(path.join(integration, 'owner-data.txt'), fs.existsSync(savedOwner) ? fs.readFileSync(savedOwner) : ownerData);
    return context(artifacts[index]);
  };
  const continuation = (index, mode = false) => {
    const bounded = run(cli, ['context', selected, '--profile', 'agent', ...(mode ? pair : [])]);
    const cursor = contextModules[index].contextCursor(bounded, 'context');
    assert.equal(run(cli, ['context', selected, '--profile', 'agent', '--cursor', cursor, ...identity(bounded), ...(mode ? pair : [])]).snapshot, bounded.snapshot);
    return { bounded, cursor };
  };
  const preflight = (current, mode = false) => {
    assert(!typed);
    const receipt = run(cli, ['preflight', selected, '--profile', 'agent', ...identity(current), ...(mode ? pair : [])]);
    assert.equal(receipt.receipt, 'preflight'); assert.equal(receipt.status, 'current'); assert.equal(receipt.revision, current.revision);
    assert.deepEqual(receipt.resolver, current.resolver);
    preflightReceipts.push({ fixture: name, digest: current.binding.digest, revision: receipt.revision, snapshot: receipt.snapshot, resolverId: receipt.resolver?.id, bindingId: receipt.binding.id, generation: receipt.binding.generation, status: receipt.status });
    return receipt;
  };
  const reject = (previous, token, mode = false) => {
    run(cli, ['context', ...identity(previous), ...(mode ? pair : [])], /binding.*expired|revision changed/i);
    if (token) run(cli, ['context', selected, '--profile', 'agent', '--cursor', token, ...identity(previous), ...(mode ? pair : [])], /binding.*expired|revision changed|snapshot|cursor/i);
    if (!typed) run(cli, ['preflight', selected, '--profile', 'agent', ...identity(previous), ...(mode ? pair : [])], /binding.*expired|revision changed/i);
  };
  const stopView = async () => {
    if (!view) return;
    const child = view; view = null;
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGTERM'); let timer;
      try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned view did not stop')), 5000); })]); }
      finally { clearTimeout(timer); }
    }
    assert(!fs.existsSync(path.join(integration, '.local/view.json')), 'Owned view lease remained');
  };
  const startView = async (mode = false) => {
    assert(!view); view = spawn(process.execPath, [cli, 'view', ...(mode ? pair : [])], { cwd: unrelated, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
      let output = '', error = '';
      const timer = setTimeout(() => reject(new Error(`View readiness timeout: ${error}`)), 10000);
      view.once('error', err => { clearTimeout(timer); reject(err); });
      view.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited ${code}: ${error}`)); });
      view.stderr.on('data', bytes => { error += bytes; });
      view.stdout.on('data', bytes => { output += bytes; try { const value = JSON.parse(output); if (value.url) { clearTimeout(timer); resolve(value); } } catch {} });
    });
  };
  const sourceURL = (url, current, override = {}) => {
    const query = new URLSearchParams({ path: selected, policyId: current.inputPolicy.id, revision: current.revision, ...(current.resolver ? { resolverId: current.resolver.id } : {}), ...override });
    return `${url}/api/source?${query}`;
  };
  const uninstallAndPark = label => {
    fs.writeFileSync(savedMap, fs.readFileSync(path.join(integration, 'project-map.json')));
    fs.writeFileSync(savedOwner, fs.readFileSync(path.join(integration, 'owner-data.txt')));
    const suffix = `\r\nOwner modified README: ${label}\r\n`; fs.appendFileSync(path.join(integration, 'README.md'), suffix);
    assert.equal(run(cli, ['uninstall']).state, 'uninstalled'); assertHost(false);
    assert.deepEqual(fs.readFileSync(path.join(integration, 'project-map.json')), map);
    assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), ownerData);
    assert(fs.readFileSync(path.join(integration, 'README.md'), 'utf8').endsWith(suffix));
    const receipt = JSON.parse(fs.readFileSync(path.join(integration, '.local/install.json')));
    assert.equal(receipt.state, 'uninstalled'); assert(receipt.recovery.length > 0);
    assert(receipt.recovery.some(entry => entry.source === 'AGENTS.md' && fs.readFileSync(path.join(integration, entry.path), 'utf8') === ownerAgents));
    for (const entry of receipt.recovery) {
      assert.equal(entry.phase, 'retained');
      if (entry.source !== 'AGENTS.md') assert.equal(sha(fs.readFileSync(path.join(integration, entry.path))), receipt.owned[entry.source]);
    }
    const destination = path.join(parkedRoot, label), contents = snapshot(integration);
    assert(!destination.startsWith(project + path.sep)); assert(!fs.existsSync(destination)); fs.renameSync(integration, destination);
    assert.deepEqual(snapshot(destination), contents); parked.push({ destination, contents });
  };
  const verifyParked = () => { for (const entry of parked) assert.deepEqual(snapshot(entry.destination), entry.contents); };
  const result = { project, integration, selected, typed, source, context, install, continuation, preflight, reject, startView, stopView, sourceURL, uninstallAndPark, verifyParked };
  fixtures.push(result); return result;
}
async function source(url, expected, fixture, current) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, expected, await response.clone().text());
  if (expected === 200) {
    const body = await response.json(); assert.equal(body.hash, sha(Buffer.from(fixture.source)));
    assert.equal(body.resolverId, current.resolver?.id);
  }
}
let report;
try {
  const typed = fixture('typed project with spaces', true), js = fixture('current JS receipt project', false);
  const old = typed.install(0), oldJS = js.install(0);
  const oldToken = typed.continuation(0), oldJSReceipt = js.preflight(oldJS);
  typed.uninstallAndPark('R13 before candidate'); js.uninstallAndPark('R13 before candidate');
  const normal = typed.install(1), normalJS = js.install(1);
  assert.equal(normal.inputPolicy.id, old.inputPolicy.id);
  assert.deepEqual(normal.symbolGraph.nodes.map(node => node.id), old.symbolGraph.nodes.map(node => node.id));
  assert.deepEqual(normal.nodes.find(node => node.path === typed.selected).referenceSyntax, old.nodes.find(node => node.path === typed.selected).referenceSyntax);
  typed.reject(old, oldToken.cursor); js.reject(oldJSReceipt);
  const defaultToken = typed.continuation(1), defaultReceipt = js.preflight(normalJS);
  const unchanged = fixtures.map(item => snapshot(item.integration));
  checks.push('Exact R13 artifact -> candidate default preserves immutable R13 facts, IDs, root-ignore-v2 and partial refusal; old runtime binding/continuation/preflight receipts reject');

  const opted = typed.context(candidate, true), optedJS = js.context(candidate, true);
  assert.notEqual(opted.revision, normal.revision); assert.equal(opted.binding.id, normal.binding.id);
  typed.reject(normal, defaultToken.cursor, true); js.reject(defaultReceipt, undefined, true);
  const optToken = typed.continuation(1, true), optReceipt = js.preflight(optedJS, true);
  const optView = await typed.startView(true);
  await source(typed.sourceURL(optView.url, normal), 409);
  await source(typed.sourceURL(optView.url, opted, { resolverId: '0'.repeat(64) }), 409);
  const missingResolver = new URL(typed.sourceURL(optView.url, opted)); missingResolver.searchParams.delete('resolverId');
  await source(missingResolver.href, 409);
  await source(typed.sourceURL(optView.url, opted), 200, typed, opted);
  const optGraph = await (await fetch(`${optView.url}/api/graph`, { signal: AbortSignal.timeout(5000) })).json();
  assert.deepEqual(optGraph.resolver, opted.resolver);
  assert.deepEqual(optGraph.nodes.find(node => node.path === typed.selected).referenceResolution, opted.nodes.find(node => node.path === typed.selected).referenceResolution);
  await typed.stopView();
  checks.push('Installed explicit opt-in resolves .gen import/reexport including type-only, preserves syntax-only producer and strict partial refusal, and live source/graph requires current resolver identity');

  const normalAgain = typed.context(candidate), normalJSAgain = js.context(candidate);
  assert.equal(normalAgain.revision, normal.revision); assert.equal(normalJSAgain.revision, normalJS.revision);
  typed.reject(opted, optToken.cursor); js.reject(optReceipt);
  js.preflight(normalJSAgain);
  const defaultView = await typed.startView();
  await source(typed.sourceURL(defaultView.url, opted), 409);
  await source(typed.sourceURL(defaultView.url, normalAgain), 200, typed, normalAgain);
  const defaultGraph = await (await fetch(`${defaultView.url}/api/graph`, { signal: AbortSignal.timeout(5000) })).json();
  assert.equal(Object.hasOwn(defaultGraph, 'resolver'), false);
  assert.equal(Object.hasOwn(defaultGraph.nodes.find(node => node.path === typed.selected), 'referenceResolution'), false);
  await typed.stopView();
  for (let i = 0; i < fixtures.length; i++) assert.deepEqual(snapshot(fixtures[i].integration), unchanged[i], 'Per-command mode changed persistent installation bytes');
  checks.push('Omitting pair restores identical candidate-default revision without persistent changes; opt-in source/cursor/preflight authorities reject in default mode; live default source remains readable');

  typed.uninstallAndPark('Candidate before R13 rollback'); js.uninstallAndPark('Candidate before R13 rollback');
  const restored = typed.install(0), restoredJS = js.install(0);
  typed.reject(normalAgain, defaultToken.cursor); js.reject(defaultReceipt); js.reject(optReceipt);
  assert.equal(restored.inputPolicy.id, old.inputPolicy.id);
  assert.deepEqual(restored.symbolGraph.nodes.map(node => node.id), old.symbolGraph.nodes.map(node => node.id));
  assert.deepEqual(restored.nodes.find(node => node.path === typed.selected).referenceSyntax, old.nodes.find(node => node.path === typed.selected).referenceSyntax);
  js.preflight(restoredJS);
  const restoredView = await typed.startView();
  await source(typed.sourceURL(restoredView.url, normalAgain), 409);
  await source(typed.sourceURL(restoredView.url, opted), 409);
  await source(typed.sourceURL(restoredView.url, restored), 200, typed, restored);
  await typed.stopView();
  typed.uninstallAndPark('Restored exact R13'); js.uninstallAndPark('Restored exact R13');
  for (const item of fixtures) item.verifyParked();
  checks.push('Own installed CLI uninstall/park/reinstall restores exact R13 artifact with no R14 envelope; prior runtime authorities reject and owner source/ignore/AGENTS/map/data/modified owned README/recovery remain intact');
  report = { status: 'passed', baseline: { sourceCommit: '247268e98c36b77eaf279706bc16ef147424a38b', sourceTree: '8039ecb44eb5cb02cc531ec0e66c6aeb34369721', digest: baseline.digest, version: baseline.version, published: false }, candidate: { digest: candidate.digest, version: candidate.version }, checks, receipts, preflightReceipts,
    scope: 'Disposable synthetic targets only; no scanned project source or package scripts executed.', instructionActivation: 'not-verified; installed smoke cannot prove host instruction loading', cleanup: 'Owned foreground views stopped; harness-owned temporary trees removed.' };
} finally {
  try {
    for (const item of fixtures) await item.stopView();
    for (let i = 0; i < releases.length; i++) { assert.deepEqual(snapshot(releases[i]), artifactBytes[i], 'Input artifact changed'); verifiers[i].verifyArtifact(releases[i], artifacts[i].digest); }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
console.log(JSON.stringify(report, null, 2));
