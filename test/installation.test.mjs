import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_FILES, artifactDigest, verifyArtifact, installProject, attachInstallation, detachInstallation, uninstallInstallation, rebindInstallation, statusInstallation, resolveInstallation, purgePlan, purgeInstallation } from '../installation.mjs';
const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-lifecycle-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = path.join(dir, 'release'), project = path.join(dir, 'project with spaces');
  fs.mkdirSync(release); fs.mkdirSync(project);
  for (const name of ARTIFACT_FILES) {
    fs.mkdirSync(path.dirname(path.join(release, name)), { recursive: true });
    fs.copyFileSync(path.join(source, name), path.join(release, name));
  }
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
test('schema-1 artifact digest keeps English path ordering in separate locale processes', () => {
  // This literal order is the schema-1 compatibility oracle, independent of sorting.
  const ordered = {
    'cli.mjs': '1'.repeat(64),
    'installation.mjs': '2'.repeat(64),
    'node_modules/acorn/CHANGELOG.md': '3'.repeat(64),
    'node_modules/acorn/dist/acorn.js': '4'.repeat(64),
    'README.md': '5'.repeat(64),
  };
  const expectedDigest = sha(JSON.stringify(ordered));
  const script = `
    import { artifactDigest } from './installation.mjs';
    const entries = Object.entries(JSON.parse(process.argv[1]));
    console.log(JSON.stringify({
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      digest: artifactDigest(Object.fromEntries(entries.reverse())),
      reorderedDigest: artifactDigest(Object.fromEntries(entries.reverse())),
    }));
  `;
  for (const [locale, resolvedLocale] of [['en_US.UTF-8', 'en-US'], ['cs_CZ.UTF-8', 'cs-CZ'], ['sk_SK.UTF-8', 'sk-SK'], ['C', 'en-US']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(ordered)], {
      cwd: source, env: { ...process.env, LC_ALL: locale, LANG: locale }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.locale, resolvedLocale, `${locale} must select the intended process locale`);
    assert.equal(actual.digest, expectedDigest, `${locale}: English schema-1 digest`);
    assert.equal(actual.reorderedDigest, expectedDigest, `${locale}: input insertion order must not matter`);
  }
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
test('artifact keeps the parser execution closure trimmed and rejects a rehashed version mismatch', t => {
  const f = fixture(t);
  assert.deepEqual(ARTIFACT_FILES.filter(name => name.startsWith('node_modules/@babel/')), [
    'node_modules/@babel/parser/LICENSE',
    'node_modules/@babel/parser/lib/index.js',
    'node_modules/@babel/parser/package.json',
  ]);
  assert(ARTIFACT_FILES.includes('typed-analysis.mjs'));
  const relative = 'node_modules/@babel/parser/package.json';
  const metadata = JSON.parse(fs.readFileSync(path.join(f.release, relative)));
  metadata.version = '0.0.0';
  fs.writeFileSync(path.join(f.release, relative), JSON.stringify(metadata));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.release, 'artifact.json')));
  manifest.files[relative] = sha(fs.readFileSync(path.join(f.release, relative)));
  manifest.digest = artifactDigest(manifest.files);
  fs.writeFileSync(path.join(f.release, 'artifact.json'), JSON.stringify(manifest));
  assert.throws(() => verifyArtifact(f.release), /@babel\/parser versions do not match/);
});
test('Python artifact includes its ESM closure and rejects rehashed transitive metadata drift', t => {
  const f = fixture(t);
  for (const name of ['python', 'common', 'lr', 'highlight']) {
    assert(ARTIFACT_FILES.includes(`node_modules/@lezer/${name}/LICENSE`));
    assert(ARTIFACT_FILES.includes(`node_modules/@lezer/${name}/dist/index.js`));
    assert(!ARTIFACT_FILES.includes(`node_modules/@lezer/${name}/dist/index.cjs`));
  }
  const relative = 'node_modules/@lezer/common/package.json';
  const metadata = JSON.parse(fs.readFileSync(path.join(f.release, relative)));
  metadata.version = '0.0.0';
  fs.writeFileSync(path.join(f.release, relative), JSON.stringify(metadata));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.release, 'artifact.json')));
  manifest.files[relative] = sha(fs.readFileSync(path.join(f.release, relative)));
  manifest.digest = artifactDigest(manifest.files);
  fs.writeFileSync(path.join(f.release, 'artifact.json'), JSON.stringify(manifest));
  assert.throws(() => verifyArtifact(f.release), /@lezer\/common versions do not match/);
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
  for (const operation of [detachInstallation, uninstallInstallation, rebindInstallation]) assert.throws(() => operation(f.install), /foreground view/);
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
    const result = preflight(['main.mjs', ...args]); assert.equal(result.status, 1); assert.match(result.stderr, /Invalid preflight values/);
  }
  const wrong = [...receipt]; wrong[wrong.indexOf('--binding-id') + 1] = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const wrongResult = preflight(['main.mjs', ...wrong]); assert.equal(wrongResult.status, 1); assert.match(wrongResult.stderr, /binding has expired/);
  fs.writeFileSync(path.join(f.project, 'broken.mjs'), 'export const = ;');
  const partialRun = contextRun(); assert.equal(partialRun.status, 0, partialRun.stderr); const partial = JSON.parse(partialRun.stdout); assert.equal(partial.status, 'partial');
  const partialResult = preflight(['main.mjs', '--revision', partial.revision, '--binding-id', partial.binding.id, '--generation', String(partial.binding.generation)]);
  assert.equal(partialResult.status, 1); assert.match(partialResult.stderr, /requires current context/); assert.equal(partialResult.stdout, '');
  fs.unlinkSync(path.join(f.project, 'broken.mjs'));
  fs.writeFileSync(path.join(f.project, 'helper.ts'), 'export const typed: number = 1;');
  const mixed = JSON.parse(contextRun().stdout);
  assert.equal(mixed.inventory.status, 'complete');
  assert.equal(mixed.status, 'partial');
  assert.deepEqual(mixed.nodes.find(node => node.path === 'helper.ts')?.capabilities, undefined, 'selected context remains scoped');
  const mixedResult = preflight(['main.mjs', '--revision', mixed.revision, '--binding-id', mixed.binding.id, '--generation', String(mixed.binding.generation)]);
  assert.equal(mixedResult.status, 1);
  assert.match(mixedResult.stderr, /requires current context/);
  const managed = fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'); assert.match(managed, /--binding-id <returned binding.id> --generation <returned binding.generation>/);
});
test('installed agent profile binds bounded pages and concise preflight receipts through refresh', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  const cli = path.join(f.install, 'cli.mjs');
  fs.appendFileSync(path.join(f.project, 'main.mjs'), Array.from({ length: 35 }, (_, i) => `export function item${i}() { return "žluťoučký 🐘 ${i}"; }`).join('\n'));
  const call = (args, expected = 0) => {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, expected, run.stderr || run.stdout); return run;
  };
  const firstRun = call(['context', 'main.mjs', '--profile', 'agent', '--max-bytes', '6000']);
  assert(Buffer.byteLength(firstRun.stdout) <= 6000); assert.equal(firstRun.stdout.endsWith('\n'), false);
  const first = JSON.parse(firstRun.stdout), full = JSON.parse(call(['context', 'main.mjs']).stdout);
  assert.equal(first.profile, 'agent'); assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.binding, full.binding); assert.equal(first.revision, full.revision);
  assert.equal(first.selection.id, full.selection.id); assert(first.page.next);
  const identity = ['--revision', first.revision, '--binding-id', first.binding.id, '--generation', String(first.binding.generation)];
  const receipt = JSON.parse(call(['preflight', 'main.mjs', '--profile', 'agent', ...identity]).stdout);
  assert.equal(receipt.receipt, 'preflight'); assert.equal(receipt.preflight, 'verified-at-read');
  assert.equal(receipt.selector, 'main.mjs'); assert.equal(receipt.snapshot, first.snapshot);
  assert.deepEqual(receipt.binding, first.binding); assert.deepEqual(receipt.coverage, first.coverage);
  assert.deepEqual(receipt.uncertainty, first.uncertainty);
  for (const key of ['nodes', 'edges', 'symbolGraph', 'inventory', 'vocabulary', 'page']) assert.equal(Object.hasOwn(receipt, key), false);
  for (const reference of receipt.diagnostics) {
    const page = JSON.parse(call(['context', 'main.mjs', '--profile', 'agent', '--cursor', reference.cursor, ...identity]).stdout);
    assert.equal(page.page.section, reference.section); assert.equal(page.snapshot, receipt.snapshot);
  }
  const receiptBytes = Buffer.byteLength(JSON.stringify(receipt));
  // A fitting receipt must never conceal an insufficient R02 evidence envelope.
  const prerequisite = call(['preflight', 'main.mjs', '--profile', 'agent', '--max-bytes', String(receiptBytes), ...identity], 1);
  const prerequisiteError = JSON.parse(prerequisite.stdout).error;
  assert.equal(prerequisiteError.code, 'CONTEXT_BUDGET_TOO_SMALL'); assert(prerequisiteError.requiredBytes > receiptBytes);
  assert(Buffer.byteLength(prerequisite.stdout) <= receiptBytes);
  assert.match(call(['context', 'package.json', '--profile', 'agent', '--cursor', first.page.next, ...identity], 1).stderr, /snapshot changed/);
  const actual = {};
  for (const section of first.sections) {
    let cursor, fragments = new Map(), values = new Map(), turns = 0;
    do {
      assert(++turns < 100);
      const run = call(['context', 'main.mjs', '--profile', 'agent', '--max-bytes', '6000', '--section', section.kind, ...(cursor ? ['--cursor', cursor] : []), ...identity]);
      assert(Buffer.byteLength(run.stdout) <= 6000);
      const page = JSON.parse(run.stdout); assert.equal(page.snapshot, first.snapshot); assert.deepEqual(page.binding, first.binding);
      for (const item of page.page.items) values.set(item.index, item.value);
      for (const item of page.page.fragments) {
        const text = fragments.get(item.index) ?? ''; assert.equal(item.offset, text.length);
        fragments.set(item.index, text + item.text);
        if (text.length + item.text.length === item.total) values.set(item.index, JSON.parse(text + item.text));
      }
      cursor = page.page.next;
    } while (cursor);
    assert.equal(values.size, section.total); actual[section.kind] = [...values].sort(([a], [b]) => a - b).map(([, value]) => value);
  }
  const canonical = value => JSON.stringify(value, (_, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort()) : value);
  const sameValues = (actual, expected) => assert.deepEqual(actual.map(canonical).sort(), expected.map(canonical).sort());
  for (const section of ['diagnostics', 'vocabulary']) sameValues(actual[section], full[section]);
  sameValues(actual.inventory, full.inventory.entries);
  sameValues(actual.selectionDetails, [full.selection]);
  for (const section of ['canvas', 'partCanvas', 'overview', 'scope']) sameValues(actual[section], [full[section]]);
  sameValues(actual.symbolDiagnostics, full.symbolGraph.diagnostics);
  sameValues(actual.context.filter(item => item.kind === 'node').map(item => item.value), full.nodes);
  sameValues(actual.context.filter(item => item.kind === 'symbol').map(item => item.value), full.symbolGraph.nodes);
  const sourceCoverage = actual.context.find(item => item.kind === 'sourceCoverage').value;
  assert.equal(sourceCoverage.hash, full.nodes.find(node => node.path === 'main.mjs').hash);
  const tooSmall = call(['preflight', 'main.mjs', '--profile', 'agent', '--max-bytes', '256', ...identity], 1);
  assert.equal(JSON.parse(tooSmall.stdout).error.code, 'CONTEXT_BUDGET_TOO_SMALL'); assert(Buffer.byteLength(tooSmall.stdout) <= 256);
  fs.appendFileSync(path.join(f.project, 'main.mjs'), '\n// authorized fixture edit\n');
  assert.match(call(['preflight', 'main.mjs', '--profile', 'agent', ...identity], 1).stderr, /revision changed/);
  assert.match(call(['context', 'main.mjs', '--profile', 'agent', '--cursor', first.page.next, ...identity], 1).stderr, /revision changed/);
  const refreshed = JSON.parse(call(['context', 'main.mjs', '--profile', 'agent']).stdout);
  assert.notEqual(refreshed.revision, first.revision); assert.deepEqual(refreshed.binding, first.binding);
  const currentIdentity = ['--revision', refreshed.revision, '--binding-id', refreshed.binding.id, '--generation', String(refreshed.binding.generation)];
  assert.equal(JSON.parse(call(['preflight', 'main.mjs', '--profile', 'agent', ...currentIdentity]).stdout).preflight, 'verified-at-read');
  assert.match(call(['context', 'main.mjs', '--profile', 'agent', '--cursor', first.page.next, ...currentIdentity], 1).stderr, /snapshot changed/);
  detachInstallation(f.install); attachInstallation(f.install);
  assert.match(call(['preflight', 'main.mjs', '--profile', 'agent', ...currentIdentity], 1).stderr, /binding has expired/);
  assert.match(call(['context', 'main.mjs', '--profile', 'agent', '--section', 'inventory', ...currentIdentity], 1).stderr, /binding has expired/);
  const rebound = JSON.parse(call(['context', 'main.mjs', '--profile', 'agent']).stdout);
  const reboundIdentity = ['--revision', rebound.revision, '--binding-id', rebound.binding.id, '--generation', String(rebound.binding.generation)];
  assert.match(call(['context', 'main.mjs', '--profile', 'agent', '--cursor', first.page.next, ...reboundIdentity], 1).stderr, /snapshot changed/);
});
test('agent profile rejects malformed flags, invalid selections and partial preflight without weakening the gate', t => {
  const f = fixture(t); install(f); attachInstallation(f.install);
  const cli = path.join(f.install, 'cli.mjs');
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  const context = JSON.parse(run(['context', 'main.mjs', '--profile', 'agent']).stdout);
  const identity = ['--revision', context.revision, '--binding-id', context.binding.id, '--generation', String(context.binding.generation)];
  for (const flags of [['--profile'], ['--profile', 'wrong'], ['--profile', 'agent', '--profile', 'agent'], ['--max-bytes', '6000'], ['--profile', 'agent', '--max-bytes', '1e4'], ['--profile', 'agent', '--max-bytes', '255'], ['--profile', 'agent', '--section', 'inventory'], ['--profile', 'agent', '--cursor', 'invalid'], ['--profile', 'agent', '--wat'], ['--profile', 'agent', '--revision', context.revision, ...identity]]) {
    const result = run(['context', 'main.mjs', ...flags]); assert.equal(result.status, 1, JSON.stringify(flags)); assert.equal(result.stdout, '');
  }
  for (const selector of ['missing.mjs', 'area:unknown']) { const result = run(['context', selector, '--profile', 'agent']); assert.equal(result.status, 1); assert.equal(result.stdout, ''); }
  for (const flags of [['--section', 'missing'], ['--cursor', 'invalid']]) { const result = run(['context', 'main.mjs', '--profile', 'agent', ...identity, ...flags]); assert.equal(result.status, 1); assert.equal(result.stdout, ''); }
  assert.equal(run(['preflight', 'main.mjs', '--profile', 'agent', ...identity, '--section', 'context']).status, 1);
  fs.writeFileSync(path.join(f.project, 'partial.ts'), 'export const typed: number = 1;');
  const partial = JSON.parse(run(['context', 'main.mjs', '--profile', 'agent']).stdout);
  assert.equal(partial.status, 'partial'); assert(partial.uncertainty.global.diagnostics > 0);
  const failed = run(['preflight', 'main.mjs', '--profile', 'agent', '--revision', partial.revision, '--binding-id', partial.binding.id, '--generation', String(partial.binding.generation)]);
  assert.equal(failed.status, 1); assert.equal(failed.stdout, ''); assert.match(failed.stderr, /requires current context/);
});
test('legacy generated instructions remain unchanged and exact legacy portable clones are adoptable', t => {
  const f = fixture(t); install(f); fs.writeFileSync(path.join(f.project, 'AGENTS.md'), '# Owner\r\n'); attachInstallation(f.install);
  const agentsPath = path.join(f.project, 'AGENTS.md'), receiptPath = path.join(f.install, '.local/install.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  const lines = receipt.agents.block.split('\r\n');
  assert.match(lines[4], /--profile agent/); assert.match(lines[5], /concise receipt/);
  lines[4] = 'Run `node agent.mind/cli.mjs context "selector"`. If more than one part matches, use its stable ID or full breadcrumb. Read the selected implementation and relevant tests before editing.';
  lines[5] = 'Before an authorized action, run `node agent.mind/cli.mjs preflight "selector" --revision <returned revision> --binding-id <returned binding.id> --generation <returned binding.generation>` with the values from context. Compare source hashes too. After edits, get context again and run the relevant project tests.';
  const legacyBlock = lines.join('\r\n'), text = fs.readFileSync(agentsPath, 'utf8').replace(receipt.agents.block, legacyBlock);
  receipt.agents.block = legacyBlock; receipt.agents.afterHash = sha(text); fs.writeFileSync(agentsPath, text);
  const readmePath = path.join(f.install, 'README.md');
  const legacyReadme = fs.readFileSync(readmePath, 'utf8').split('\nFor bounded agent context')[0];
  fs.writeFileSync(readmePath, legacyReadme); receipt.owned['README.md'] = sha(legacyReadme); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  attachInstallation(f.install); assert.equal(fs.readFileSync(agentsPath, 'utf8'), text);
  const clone = path.join(f.dir, 'legacy clone');
  fs.cpSync(f.project, clone, { recursive: true, filter: entry => !entry.startsWith(path.join(f.install, '.local')) });
  const cloneInstall = path.join(clone, 'agent.mind');
  installProject({ project: clone, release: f.release, adopt: true }); attachInstallation(cloneInstall);
  assert.equal(fs.readFileSync(path.join(clone, 'AGENTS.md'), 'utf8'), text);
  assert.equal(fs.readFileSync(path.join(cloneInstall, 'README.md'), 'utf8'), legacyReadme);
  detachInstallation(f.install); assert.equal(fs.readFileSync(agentsPath, 'utf8'), '# Owner\r\n');
  // A new authorized attachment generates the profile instructions; edited old blocks still conflict.
  attachInstallation(f.install); assert.match(fs.readFileSync(agentsPath, 'utf8'), /--profile agent/);
  const bad = path.join(f.dir, 'edited legacy clone');
  fs.cpSync(clone, bad, { recursive: true, filter: entry => !entry.startsWith(path.join(cloneInstall, '.local')) });
  fs.appendFileSync(path.join(bad, 'agent.mind/README.md'), 'owner edit');
  assert.throws(() => installProject({ project: bad, release: f.release, adopt: true }), /Unrecognized portable file/);
  fs.writeFileSync(path.join(bad, 'agent.mind/README.md'), legacyReadme);
  fs.writeFileSync(path.join(bad, 'AGENTS.md'), text.replace('Compare source hashes too.', 'Owner changed this instruction.'));
  assert.throws(() => installProject({ project: bad, release: f.release, adopt: true }), /portable AGENTS block/);
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
  try { assert.throws(() => attachInstallation(g.install), /Could not replace AGENTS/); } finally { fs.renameSync = rename; }
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
  assert.throws(() => installProject({ project: clone, release: f.release }), /run install --adopt/);
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
  const f = fixture(t); install(f); assert.throws(() => purgePlan(f.install), /Run uninstall before purge/); uninstallInstallation(f.install);
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

for (const stage of ['nested', 'local', 'staging', 'root']) test(`purge retains a usable retry record after ${stage} directory removal fails`, t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install);
  fs.mkdirSync(path.join(f.install, 'locked/child'), { recursive: true });
  const originalSource = fs.readFileSync(path.join(f.project, 'main.mjs'));
  const controls = ['project.json', '.local/install.json'].map(relative => [relative, fs.readFileSync(path.join(f.install, relative))]);
  const plan = purgePlan(f.install), rmdir = fs.rmdirSync;
  let injected = false;
  fs.rmdirSync = (filename, ...args) => {
    const target = stage === 'nested' ? path.join(f.install, 'locked/child') : stage === 'local' ? path.join(f.install, '.local') : stage === 'root' ? f.install : null;
    if (!injected && (filename === target || stage === 'staging' && path.dirname(filename) === f.install && path.basename(filename).startsWith('.purge-'))) {
      injected = true; throw Object.assign(new Error(`Injected ${stage} removal failure`), { code: 'EACCES' });
    }
    return rmdir(filename, ...args);
  };
  let result;
  try { result = purgeInstallation(f.install, plan.digest); } finally { fs.rmdirSync = rmdir; }
  assert.equal(injected, true);
  assert.equal(result.state, 'purge-incomplete');
  assert.ok(result.conflicts.length);
  for (const [relative, bytes] of controls) assert.deepEqual(fs.readFileSync(path.join(f.install, relative)), bytes);
  assert.equal(statusInstallation(f.install).state, 'uninstalled');
  const next = purgePlan(f.install);
  assert.ok(next.entries.some(entry => entry.path === 'project.json'));
  assert.ok(next.entries.some(entry => entry.path === '.local/install.json'));
  assert.throws(() => purgeInstallation(f.install, plan.digest), /inventory or root identity changed/);
  assert.equal(purgeInstallation(f.install, next.digest).state, 'purged');
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'main.mjs')), originalSource);
});

for (const failedControl of ['project.json', '.local/install.json']) test(`purge recovers when final unlink of ${failedControl} fails`, t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install);
  const controls = ['project.json', '.local/install.json'].map(relative => [relative, fs.readFileSync(path.join(f.install, relative))]);
  const bytes = controls.find(([relative]) => relative === failedControl)[1], plan = purgePlan(f.install), unlink = fs.unlinkSync;
  let injected = false;
  fs.unlinkSync = filename => {
    if (!injected && path.dirname(path.dirname(filename)) === f.install && path.basename(path.dirname(filename)).startsWith('.purge-') && fs.readFileSync(filename).equals(bytes)) {
      injected = true; throw Object.assign(new Error('Injected final unlink failure'), { code: 'EACCES' });
    }
    return unlink(filename);
  };
  let result; try { result = purgeInstallation(f.install, plan.digest); } finally { fs.unlinkSync = unlink; }
  assert.equal(injected, true); assert.equal(result.state, 'purge-incomplete');
  for (const [relative, original] of controls) assert.deepEqual(fs.readFileSync(path.join(f.install, relative)), original);
  assert.equal(statusInstallation(f.install).state, 'uninstalled');
  assert.equal(purgeInstallation(f.install, purgePlan(f.install).digest).state, 'purged');
});

test('purge recovery preserves a recreated control path and retains the original record', t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install);
  const plan = purgePlan(f.install), original = fs.readFileSync(path.join(f.install, 'project.json')), rmdir = fs.rmdirSync;
  let injected = false;
  fs.rmdirSync = filename => {
    if (filename === f.install && !injected) {
      injected = true; fs.writeFileSync(path.join(f.install, 'project.json'), 'Owner recreated this path');
      throw Object.assign(new Error('Injected root conflict'), { code: 'ENOTEMPTY' });
    }
    return rmdir(filename);
  };
  let result; try { result = purgeInstallation(f.install, plan.digest); } finally { fs.rmdirSync = rmdir; }
  assert.equal(injected, true); assert.equal(result.state, 'purge-incomplete');
  assert.equal(fs.readFileSync(path.join(f.install, 'project.json'), 'utf8'), 'Owner recreated this path');
  assert.ok(result.conflicts.some(item => /original record retained at/.test(item.error)));
  assert.ok(result.remainder.some(relative => relative.startsWith('.purge-') && !relative.endsWith('/') && fs.readFileSync(path.join(f.install, relative)).equals(original)));
});

test('purge never restores controls through a replaced root symlink', t => {
  const f = fixture(t); install(f); uninstallInstallation(f.install);
  const plan = purgePlan(f.install), rmdir = fs.rmdirSync, moved = path.join(f.project, 'displaced-install'), outside = path.join(f.dir, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'owner'), 'untouched');
  let injected = false;
  fs.rmdirSync = filename => {
    if (filename === f.install && !injected) {
      injected = true; fs.renameSync(f.install, moved); fs.symlinkSync(outside, f.install);
      throw Object.assign(new Error('Injected root replacement'), { code: 'EACCES' });
    }
    return rmdir(filename);
  };
  let result; try { result = purgeInstallation(f.install, plan.digest); } finally { fs.rmdirSync = rmdir; }
  assert.equal(injected, true); assert.equal(result.state, 'purge-incomplete');
  assert.deepEqual(fs.readdirSync(outside), ['owner']);
  assert.equal(fs.readFileSync(path.join(outside, 'owner'), 'utf8'), 'untouched');
  assert.ok(result.conflicts.some(item => /identity changed/.test(item.error)));
});

test('installed Python source context passes strict preflight while stale, binding, parse and budget failures still reject', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'helper.py'), 'def answer():\n    return 42\n');
  fs.writeFileSync(path.join(f.project, 'main.py'), 'import helper\nimport os\nimport package.ns.worker\ndef local():\n    return 1\ndef run():\n    return local()\n');
  fs.mkdirSync(path.join(f.project, 'package/ns'), { recursive: true });
  fs.writeFileSync(path.join(f.project, 'package/__init__.py'), 'pass\n');
  fs.writeFileSync(path.join(f.project, 'package/config.py'), 'value = 1\n');
  fs.writeFileSync(path.join(f.project, 'package/ns/worker.py'), 'from ..config import value\n');
  install(f); attachInstallation(f.install);
  const cli = path.join(f.install, 'cli.mjs');
  const contextRun = selector => spawnSync(process.execPath, [cli, 'context', selector], { encoding: 'utf8', cwd: f.dir });
  const readContext = () => {
    const result = contextRun('main.py');
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const preflight = (context, overrides = {}) => spawnSync(process.execPath, [cli, 'preflight', 'main.py', '--revision', overrides.revision ?? context.revision, '--binding-id', overrides.bindingId ?? context.binding.id, '--generation', String(overrides.generation ?? context.binding.generation)], { encoding: 'utf8', cwd: f.dir });
  const context = readContext();
  assert.equal(context.status, 'current');
  assert.equal(context.inventory.status, 'complete');
  assert.equal(context.binding.root, f.project);
  assert.ok(context.nodes.every(node => !node.path?.startsWith('agent.mind/')));
  const main = context.nodes.find(node => node.id === 'file:main.py');
  assert.deepEqual(main.capabilities, ['text', 'python-syntax', 'static-references', 'named-symbols', 'local-calls']);
  assert.equal(main.producer.mode, 'static-source');
  assert.ok(context.edges.some(edge => edge.from === main.id && edge.to === 'file:helper.py' && edge.kind === 'import'));
  assert.ok(context.edges.some(edge => edge.from === main.id && edge.to === 'file:package/ns/worker.py' && edge.kind === 'import'));
  const namespaceContext = JSON.parse(contextRun('package/ns/worker.py').stdout);
  assert.equal(namespaceContext.status, 'current');
  assert.ok(namespaceContext.edges.some(edge => edge.from === 'file:package/ns/worker.py' && edge.to === 'file:package/config.py' && edge.kind === 'import'));
  assert.ok(context.symbolGraph.edges.some(edge => edge.from === 'symbol:main.py#run' && edge.to === 'symbol:main.py#local' && edge.kind === 'call'));
  const accepted = preflight(context);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).preflight, 'verified-at-read');
  const wrongBinding = preflight(context, { bindingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  assert.equal(wrongBinding.status, 1); assert.match(wrongBinding.stderr, /binding has expired/);
  fs.appendFileSync(path.join(f.project, 'helper.py'), '\nchanged = True\n');
  const stale = preflight(context);
  assert.equal(stale.status, 1); assert.match(stale.stderr, /revision changed/);
  const refreshed = readContext();
  assert.notEqual(refreshed.revision, context.revision);
  assert.equal(preflight(refreshed).status, 0);
  fs.writeFileSync(path.join(f.project, 'broken.py'), 'def invalid(:\n    pass\n');
  const broken = readContext();
  assert.equal(broken.status, 'partial');
  assert.ok(broken.diagnostics.some(item => item.path === 'broken.py' && ['warning', 'error'].includes(item.severity)));
  const rejectedParse = preflight(broken);
  assert.equal(rejectedParse.status, 1); assert.match(rejectedParse.stderr, /requires current context/);
  fs.unlinkSync(path.join(f.project, 'broken.py'));
  fs.writeFileSync(path.join(f.project, 'limited.py'), '#'.repeat(64 * 1024 + 1));
  const limited = readContext();
  assert.equal(limited.inventory.status, 'complete');
  assert.equal(limited.status, 'partial');
  assert.ok(limited.diagnostics.some(item => item.path === 'limited.py' && /limit/.test(item.message) && item.severity === 'warning'));
  const rejectedLimit = preflight(limited);
  assert.equal(rejectedLimit.status, 1); assert.match(rejectedLimit.stderr, /requires current context/);
  fs.unlinkSync(path.join(f.project, 'limited.py'));
  fs.writeFileSync(path.join(f.project, 'oversized.py'), '#'.repeat(512 * 1024 + 1));
  const incomplete = readContext();
  assert.equal(incomplete.inventory.status, 'partial');
  assert.equal(incomplete.status, 'partial');
  const rejectedInventory = preflight(incomplete);
  assert.equal(rejectedInventory.status, 1); assert.match(rejectedInventory.stderr, /requires current context/);
});
