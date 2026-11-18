import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { ARTIFACT_FILES, artifactDigest, installProject, attachInstallation, resolveInstallation, detachInstallation, rebindInstallation } from '../installation.mjs';
import { scopedResponse } from '../scoped-context.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pair = ['--resolver', 'bundler-local-v1', '--resolver-config', 'tsconfig.json'];
const resolver = { resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
const textOperation = 'inspect-selected-source@1', boundaryOperation = 'review-direct-file-boundary@1';
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-r15-installed-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'target'), release = path.join(dir, 'release');
  fs.mkdirSync(project); fs.mkdirSync(release);
  const files = {};
  for (const relative of ARTIFACT_FILES) {
    const data = fs.readFileSync(path.join(source, relative));
    fs.mkdirSync(path.dirname(path.join(release, relative)), { recursive: true });
    fs.writeFileSync(path.join(release, relative), data); files[relative] = sha(data);
  }
  const version = JSON.parse(fs.readFileSync(path.join(release, 'package.json'))).version;
  const artifact = { schemaVersion: 1, version, files, digest: artifactDigest(files) };
  fs.writeFileSync(path.join(release, 'artifact.json'), JSON.stringify(artifact));
  const originals = {
    'main.ts': 'import { helper } from "./helper";\nexport function selected() { return helper; }\n',
    'helper.ts': 'export function helper() { return 1; }\n',
    'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}\n',
    'package.json': '{"private":true,"scripts":{"install":"exit 99","test":"exit 99"}}\n',
    'owner.txt': 'Keep owner data exactly.\r\n'
  };
  for (const [relative, data] of Object.entries(originals)) fs.writeFileSync(path.join(project, relative), data);
  installProject({ project, release }); const integration = path.join(project, 'agent.mind');
  attachInstallation(integration);
  const cli = path.join(integration, 'cli.mjs');
  const managed = fs.readFileSync(path.join(project, 'AGENTS.md'));
  const ownerMap = fs.readFileSync(path.join(integration, 'project-map.json'));
  const call = (args, status = 0) => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, status, result.stderr || result.stdout);
    return result;
  };
  const json = (args, status = 0) => JSON.parse(call(args, status).stdout);
  const request = (operation = textOperation, selector = 'main.ts') => {
    const context = json(['context', selector, '--profile', 'agent', ...pair]);
    const input = { schemaVersion: 1, operation, ...(operation === boundaryOperation ? { model: 'typed-static-local-v1@1' } : {}), selector,
      revision: context.revision, snapshot: context.snapshot, bindingId: context.binding.id, generation: context.binding.generation };
    return { context, input };
  };
  const args = request => {
    const mapping = { schemaVersion: '--schema-version', operation: '--operation', model: '--model', revision: '--revision', snapshot: '--snapshot',
      bindingId: '--binding-id', generation: '--generation', scopedSnapshot: '--scoped-snapshot', requirementsDigest: '--requirements-digest', section: '--section', cursor: '--cursor', maxBytes: '--max-bytes' };
    return [request.selector, ...Object.entries(request).filter(([key]) => key !== 'selector').flatMap(([key, value]) => [mapping[key], String(value)]), ...pair];
  };
  const prepare = operation => {
    const { context, input } = request(operation);
    const preparation = json(['scoped-context', ...args(input)]);
    assert.equal(preparation.phase, 'preparation');
    return { context, input: { ...input, scopedSnapshot: preparation.scopedSnapshot, requirementsDigest: preparation.requirementsDigest }, preparation };
  };
  const assertCustody = () => {
    for (const [relative, data] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(project, relative), 'utf8'), data);
    assert.deepEqual(fs.readFileSync(path.join(project, 'AGENTS.md')), managed);
    assert.deepEqual(fs.readFileSync(path.join(integration, 'project-map.json')), ownerMap);
    assert(!fs.existsSync(path.join(project, 'node_modules')));
  };
  return { dir, project, release, artifact, integration, cli, call, json, request, args, prepare, managed, assertCustody };
}

test('R15 installed explicit commands preserve strict legacy refusal and owner custody', t => {
  const f = fixture(t);
  const text = f.prepare(textOperation);
  const receipt = f.json(['scoped-preflight', ...f.args(text.input)]);
  assert.equal(receipt.receipt, 'scoped-preflight'); assert.equal(receipt.installedReceipt, true);
  assert.equal(receipt.decision, 'sufficient-at-read'); assert.equal(receipt.globalStatus, 'partial');
  assert.equal(receipt.claims.testResults, 'not-observed');
  const boundary = f.prepare(boundaryOperation);
  const refused = f.json(['scoped-preflight', ...f.args(boundary.input)], 1);
  assert.equal(refused.decision, 'insufficient-evidence');
  assert(refused.blockingReasons.some(item => item.code === 'origin-coverage-unknown' && item.count > 0));
  const reasonPage = f.json(['scoped-context', ...f.args({ ...boundary.input, section: 'reasons' })]);
  assert(reasonPage.page.items.some(item => item.value.path === 'AGENTS.md'));
  const strict = f.call(['preflight', 'main.ts', '--revision', text.context.revision, '--binding-id', text.context.binding.id, '--generation', String(text.context.binding.generation), ...pair], 1);
  assert.equal(strict.stdout, ''); assert.match(strict.stderr, /requires current context.*partial/);
  assert(!f.managed.toString().includes('scoped-preflight'));
  f.assertCustody();
});

test('R15 installed CLI and HTTP receipts have identical source-derived decisions and identities', async t => {
  const f = fixture(t), resolved = resolveInstallation(f.integration);
  const { createVisualizer } = await import(pathToFileURL(path.join(resolved.runtime, 'server.mjs')));
  const app = createVisualizer({ root: resolved.root, indexOptions: { ...resolved.indexOptions, ...resolver }, binding: resolved.binding, intervalMs: 60000 });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const get = async (stage, input, expected = 200) => {
    const url = new URL(base + '/api/scoped');
    for (const [key, value] of Object.entries({ stage, ...input })) url.searchParams.set(key, String(value));
    const response = await fetch(url); assert.equal(response.status, expected);
    return response.json();
  };
  for (const operation of [textOperation, boundaryOperation]) {
    const { context, input } = f.request(operation);
    const bootstrap = await get('bootstrap', { schemaVersion: 1, operation, ...(input.model ? { model: input.model } : {}), selector: 'main.ts' });
    assert.equal(bootstrap.snapshot, context.snapshot); assert.deepEqual(bootstrap.binding, context.binding);
    const preparation = await get('prepare', input);
    const complete = { ...input, scopedSnapshot: preparation.scopedSnapshot, requirementsDigest: preparation.requirementsDigest };
    const api = await get('preflight', complete, operation === textOperation ? 200 : 422);
    const cli = f.json(['scoped-preflight', ...f.args(complete)], operation === textOperation ? 0 : 1);
    assert.deepEqual(api, cli);
  }
  const duplicate = await fetch(base + '/api/scoped?stage=bootstrap&stage=preflight');
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).profile, 'scoped');
  assert.equal((await fetch(base + '/api/scoped?stage=bootstrap', { headers: { Origin: 'https://outside.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/scoped', { method: 'POST' })).status, 405);
  f.assertCustody();
});

test('R15 V13 missing/duplicate/unknown and cross-phase flags return versioned failure', t => {
  const f = fixture(t), { input } = f.request();
  for (const extra of [['--schema-version', '1'], ['--unknown', 'x'], ['--resolver', 'bundler-local-v1']]) {
    const result = f.json(['scoped-context', ...f.args(input), ...extra], 1);
    assert.equal(result.profile, 'scoped'); assert(result.error);
  }
  const missing = { ...input }; delete missing.snapshot;
  assert(f.json(['scoped-context', ...f.args(missing)], 1).error);
  assert(f.json(['scoped-preflight', ...f.args(input)], 1).error);
});

test('R15 V09 binding lifecycle and exact runtime integrity revoke old scoped evidence', t => {
  const f = fixture(t), { input } = f.prepare(textOperation);
  const before = resolveInstallation(f.integration);
  rebindInstallation(f.integration);
  assert.match(f.json(['scoped-preflight', ...f.args(input)], 1).error.message, /detached/);
  attachInstallation(f.integration);
  assert.equal(f.json(['scoped-preflight', ...f.args(input)], 1).decision, 'rejected');
  const renewed = f.prepare(textOperation);
  const resolved = resolveInstallation(f.integration);
  const modulePath = path.join(resolved.runtime, 'scoped-preflight.mjs'), original = fs.readFileSync(modulePath);
  fs.appendFileSync(modulePath, '\n// Disposable integrity mutation.\n');
  const failure = f.json(['scoped-preflight', ...f.args(renewed.input)], 1);
  assert(failure.error); assert.match(failure.error.message, /mismatch|integrity/i);
  fs.writeFileSync(modulePath, original);
  assert.throws(() => before.binding.verifyScoped(), /expired/);
  detachInstallation(f.integration);
  const detached = f.json(['scoped-preflight', ...f.args(renewed.input)], 1);
  assert(detached.error); assert.match(detached.error.message, /detached/);
});
