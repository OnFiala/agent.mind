// Exact unreleased R14 -> R15 -> R14; disposable fixtures, no target execution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(value => !path.isAbsolute(value))) throw new Error('Usage: node scripts/smoke-scoped-rollback.mjs /absolute/exact-R14 /absolute/R15-candidate');
const releases = args.map(value => fs.realpathSync(value));
assert.notEqual(releases[0], releases[1]);
const sha = value => createHash('sha256').update(value).digest('hex');
function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    assert(!entry.isSymbolicLink());
    if (entry.isDirectory()) Object.assign(result, { [relative + '/']: 'directory' }, snapshot(root, relative));
    else { assert(entry.isFile()); result[relative] = sha(fs.readFileSync(path.join(root, relative))); }
  }
  return result;
}
const originalArtifacts = releases.map(release => snapshot(release));
const modules = await Promise.all(releases.map(release => import(pathToFileURL(path.join(release, 'installation.mjs')))));
const artifacts = releases.map((release, i) => modules[i].verifyArtifact(release));
assert.equal(artifacts[0].digest, '378643335eaa3e10f2a5a809f1960cdee82a2d8f673a632a24669d0e0f01576c');
assert(!artifacts[0].files['scoped-context.mjs']);
assert(artifacts[1].files['scoped-context.mjs']);
assert.notEqual(artifacts[0].digest, artifacts[1].digest);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-scoped-rollback-')));
const project = path.join(temporary, 'source target'), parked = path.join(temporary, 'retained integrations');
fs.mkdirSync(project); fs.mkdirSync(parked);
const integration = path.join(project, 'agent.mind'), cli = path.join(integration, 'cli.mjs');
const host = {
  'main.ts': 'import { value } from "./target.gen";\nexport function selected() { return value; }\nthrow new Error("SCANNED SOURCE MUST NOT EXECUTE");\n',
  'target.gen.ts': 'export const value: number = 1;\n',
  'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}\r\n',
  'package.json': '{"private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
  '.gitignore': '# Original owner policy. No scope relaxation.\n',
  'AGENTS.md': '\ufeff# Owner instructions\r\nNever run scanned source.\r\n',
  'owner.txt': 'Owner data stays byte-identical.\r\n'
};
for (const [relative, data] of Object.entries(host)) fs.writeFileSync(path.join(project, relative), data);
const map = Buffer.from(JSON.stringify({ schemaVersion: 1, blocks: [{ id: 'owner', label: 'Owner source', aliases: ['owner-alias'], type: 'module', group: 'core', description: 'Disposable scoped fixture', files: ['main.ts'], prefixes: [] }] }, null, 2) + '\r\n');
const ownerData = Buffer.from('Retained integration owner data.\r\n'), retired = [], checks = [], receipts = [];
const env = { ...process.env }; delete env.AGENT_MIND_PROJECT;
let view;
const run = (command, argv, expected = 0, json = true) => {
  const result = spawnSync(process.execPath, [command, ...argv], { cwd: temporary, env, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  assert(!result.error, result.error?.message); assert.equal(result.status, expected, result.stderr || result.stdout);
  return json ? JSON.parse(result.stdout) : result;
};
const pair = ['--resolver', 'bundler-local-v1', '--resolver-config', 'tsconfig.json'];
const legacyIdentity = context => ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
const scopedArgs = input => {
  const keys = { schemaVersion: '--schema-version', operation: '--operation', model: '--model', revision: '--revision', snapshot: '--snapshot', bindingId: '--binding-id', generation: '--generation', scopedSnapshot: '--scoped-snapshot', requirementsDigest: '--requirements-digest' };
  return ['owner-alias', ...Object.entries(input).flatMap(([key, value]) => [keys[key], String(value)]), ...pair];
};
function custody(attached) {
  for (const [relative, data] of Object.entries(host)) {
    const actual = fs.readFileSync(path.join(project, relative));
    if (relative === 'AGENTS.md' && attached) assert(actual.toString().startsWith(data));
    else assert.deepEqual(actual, Buffer.from(data));
  }
  assert(!fs.existsSync(path.join(project, 'node_modules')));
  if (fs.existsSync(integration)) {
    assert.deepEqual(fs.readFileSync(path.join(integration, 'project-map.json')), map);
    assert.deepEqual(fs.readFileSync(path.join(integration, 'owner-data.txt')), ownerData);
  }
}
function install(which) {
  const artifact = artifacts[which];
  assert.equal(run(path.join(releases[which], 'cli.mjs'), ['install', '--project', project, '--release', releases[which], '--digest', artifact.digest, '--attach']).state, 'attached');
  fs.writeFileSync(path.join(integration, 'project-map.json'), map);
  fs.writeFileSync(path.join(integration, 'owner-data.txt'), ownerData);
  const status = run(cli, ['status']); assert.equal(status.integrity, 'verified'); assert.equal(status.runtime.digest, artifact.digest); assert.deepEqual(status.conflicts, []);
  const context = run(cli, ['context', 'owner-alias', '--profile', 'agent', ...pair]);
  assert.equal(context.status, 'partial'); assert.equal(context.selection.id, 'block:owner'); assert.equal(context.binding.digest, artifact.digest);
  const strict = run(cli, ['preflight', 'owner-alias', ...legacyIdentity(context), ...pair], 1, false);
  assert.equal(strict.stdout, ''); assert.match(strict.stderr, /partial/);
  custody(true); return context;
}
async function startView() {
  view = spawn(process.execPath, [cli, 'view', '--port', '0', ...pair], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  view.stderr.on('data', data => { errors += data; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('View timeout: ' + errors)), 10000);
    view.stdout.on('data', data => { output += data; try { const result = JSON.parse(output); clearTimeout(timer); resolve(result.url); } catch {} });
    view.once('error', reject); view.once('exit', code => { if (!output) { clearTimeout(timer); reject(new Error('View exited ' + code + ': ' + errors)); } });
  });
  return url;
}
async function stopView() {
  if (!view) return;
  const child = view; view = null;
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
}
function uninstallAndPark(label) {
  const suffix = '\r\nOwner edited README before ' + label + '\r\n';
  fs.appendFileSync(path.join(integration, 'README.md'), suffix);
  assert.equal(run(cli, ['uninstall']).state, 'uninstalled');
  custody(false);
  assert(fs.readFileSync(path.join(integration, 'README.md'), 'utf8').endsWith(suffix));
  const receipt = JSON.parse(fs.readFileSync(path.join(integration, '.local/install.json')));
  assert(receipt.recovery.length > 0);
  assert(receipt.recovery.some(entry => entry.source === 'AGENTS.md' && fs.readFileSync(path.join(integration, entry.path)).equals(Buffer.from(host['AGENTS.md']))));
  for (const entry of receipt.recovery) {
    assert.equal(entry.phase, 'retained');
    const data = fs.readFileSync(path.join(integration, entry.path));
    if (entry.source !== 'AGENTS.md') assert.equal(sha(data), receipt.owned[entry.source]);
  }
  const contents = snapshot(integration), destination = path.join(parked, label);
  assert(!fs.existsSync(destination)); fs.renameSync(integration, destination);
  assert.deepEqual(snapshot(destination), contents); retired.push({ destination, contents });
}
let report;
try {
  const baseline = install(0);
  const baselineFull = run(cli, ['context', 'owner-alias', ...pair]);
  const baselineFacts = baselineFull.nodes.find(node => node.path === 'main.ts').referenceSyntax;
  const oldRoute = await startView();
  assert.equal((await fetch(oldRoute + '/api/scoped')).status, 404);
  await stopView(); uninstallAndPark('R14 baseline');
  const candidate = install(1), candidateFull = run(cli, ['context', 'owner-alias', ...pair]);
  assert.equal(candidate.inputPolicy.id, baseline.inputPolicy.id);
  assert.deepEqual(candidateFull.nodes.find(node => node.path === 'main.ts').referenceSyntax, baselineFacts);
  checks.push('Exact R14 -> candidate preserves source/policy/map/managed instructions and R13 facts; strict partial refusal unchanged');
  const inputs = [];
  for (const operation of ['inspect-selected-source@1', 'review-direct-file-boundary@1']) {
    const input = { schemaVersion: 1, operation, ...(operation.startsWith('review-') ? { model: 'typed-static-local-v1@1' } : {}), revision: candidate.revision, snapshot: candidate.snapshot, bindingId: candidate.binding.id, generation: candidate.binding.generation };
    const preparation = run(cli, ['scoped-context', ...scopedArgs(input)]);
    assert.equal(preparation.phase, 'preparation'); assert.equal(preparation.receipt, undefined);
    Object.assign(input, { scopedSnapshot: preparation.scopedSnapshot, requirementsDigest: preparation.requirementsDigest });
    const receipt = run(cli, ['scoped-preflight', ...scopedArgs(input)], operation.startsWith('review-') ? 1 : 0);
    assert.equal(receipt.receipt, 'scoped-preflight'); assert.equal(receipt.globalStatus, 'partial');
    assert.equal(receipt.decision, operation.startsWith('review-') ? 'insufficient-evidence' : 'sufficient-at-read');
    assert.equal(receipt.claims.testResults, 'not-observed');
    receipts.push({ operation, decision: receipt.decision, revision: receipt.revision, snapshot: receipt.snapshot, scopedSnapshot: receipt.scopedSnapshot, binding: receipt.binding.id, runtime: receipt.binding.digest });
    inputs.push(input);
  }
  const stale = { ...inputs[0], revision: baseline.revision, snapshot: baseline.snapshot, bindingId: baseline.binding.id, generation: baseline.binding.generation };
  assert.equal(run(cli, ['scoped-preflight', ...scopedArgs(stale)], 1).decision, 'rejected');
  const currentView = await startView();
  const query = new URLSearchParams({ stage: 'preflight', selector: 'owner-alias', ...Object.fromEntries(Object.entries(inputs[0]).map(([key, value]) => [key, String(value)])) });
  const response = await fetch(currentView + '/api/scoped?' + query); assert.equal(response.status, 200);
  assert.equal((await response.json()).scopedSnapshot, receipts[0].scopedSnapshot);
  await stopView(); custody(true);
  checks.push('Both explicit installed scoped operations, complete promises/nonclaims, CLI/HTTP identity parity and old R14 identity rejection verified');
  uninstallAndPark('R15 candidate');
  const restored = install(0), restoredFull = run(cli, ['context', 'owner-alias', ...pair]);
  assert.equal(restored.inputPolicy.id, baseline.inputPolicy.id);
  assert.deepEqual(restoredFull.nodes.find(node => node.path === 'main.ts').referenceSyntax, baselineFacts);
  for (const input of inputs) {
    const refused = run(cli, ['scoped-preflight', ...scopedArgs(input)], 1, false);
    assert.equal(refused.stdout, ''); assert(refused.stderr.length);
  }
  const restoredView = await startView();
  assert.equal((await fetch(restoredView + '/api/scoped?' + query)).status, 404);
  await stopView(); uninstallAndPark('R14 restored');
  for (const retained of retired) assert.deepEqual(snapshot(retained.destination), retained.contents);
  checks.push('Exact R14 artifact restored by own CLI; R15 commands/routes unavailable, old scoped identities cannot succeed, all owner and conflict/recovery bytes retained');
  report = { status: 'passed', baseline: { commit: '07dd8a39d867cb3302b29ffeae5af3e20994491b', tree: 'bb1bf14fbcde1ea2fb08dabe1d0789ee3cb424ab', digest: artifacts[0].digest, published: false }, candidate: { digest: artifacts[1].digest }, checks, receipts, sourceExecution: 'never', instructionActivation: 'not-verified', scope: 'Disposable synthetic target only', cleanup: 'Owned views stopped and harness-owned temporary trees removed' };
} finally {
  try {
    await stopView();
    for (let i = 0; i < releases.length; i++) { assert.deepEqual(snapshot(releases[i]), originalArtifacts[i]); modules[i].verifyArtifact(releases[i], artifacts[i].digest); }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
console.log(JSON.stringify(report, null, 2));
