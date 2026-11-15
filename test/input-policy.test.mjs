import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { INPUT_POLICY_LIMITS, parseInputPolicy, policyMatchDecision, inspectInputPolicy, indexProject, readIndexedSource } from '../code-index.mjs';

function fixture(t, contents = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-policy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(contents)) write(root, name, bytes);
  return root;
}
function write(root, name, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), bytes);
}
const node = (graph, name) => graph.nodes.find(item => item.path === name);
const decide = (text, name, directory = false) => policyMatchDecision(parseInputPolicy(Buffer.from(text)).rules, name, directory, { units: 0 });
function spyOpens(t) {
  const opened = [];
  const original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(String(name)); return original(name, ...args); });
  return opened;
}
function assertEmpty(graph) {
  assert.equal(graph.status, 'partial');
  assert.equal(graph.inputPolicy.status, 'invalid');
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.symbolGraph, { nodes: [], edges: [], diagnostics: [] });
  assert.equal(graph.metadata, null);
}

test('root-only directory defaults and no-ignore/empty policy identities apply in both modes', t => {
  const root = fixture(t, { 'ok.js': 'export const ok=1;', 'dist/no.js': 'EXCLUDED_DIST_SENTINEL', 'build/no.js': 'EXCLUDED_BUILD_SENTINEL', 'venv/no.py': 'EXCLUDED_VENV_SENTINEL', 'src/build/keep.js': 'export const yes=1;' });
  const opened = spyOpens(t);
  for (const generic of [false, true]) {
    const graph = indexProject(root, { generic });
    assert.equal(graph.inputPolicy.rootIgnore.state, 'missing');
    assert.equal(graph.status, 'current');
    assert.ok(node(graph, 'src/build/keep.js'));
    for (const name of ['dist/no.js', 'build/no.js', 'venv/no.py']) assert.ok(!node(graph, name));
    assert.ok(!JSON.stringify(graph).includes('EXCLUDED_'));
  }
  const missing = inspectInputPolicy(root);
  write(root, '.gitignore', '');
  const empty = indexProject(root);
  assert.notEqual(empty.inputPolicy.id, missing.id);
  assert.equal(empty.inputPolicy.rootIgnore.state, 'empty');
  assert.equal(empty.inputPolicy.id, inspectInputPolicy(root).id);
  assert.ok(!node(empty, '.gitignore'));
  for (const name of ['dist/no.js', 'build/no.js', 'venv/no.py']) assert.ok(!opened.includes(path.join(root, name)));
});

test('dialect anchoring, terminal slash, wildcard and Unicode cases preserve negative controls', () => {
  for (const name of ['generated', 'deep/generated']) assert.equal(decide('generated/', name, true), true);
  assert.equal(decide('generated/', 'deep/generated'), false);
  assert.equal(decide('/generated/', 'deep/generated', true), false);
  assert.equal(decide('/generated/', 'generated', true), true);
  assert.equal(decide('a/b', 'a/b'), true);
  assert.equal(decide('a/b', 'deep/a/b'), false);
  assert.equal(decide('b', 'deep/a/b'), true);
  assert.equal(decide('*.log', 'deep/a.log'), true);
  assert.equal(decide('*.log', 'deep/a.LOG'), false);
  assert.equal(decide('file?.js', 'file😀.js'), true);
  assert.equal(decide('file?.js', 'fileab.js'), false);
  assert.equal(decide('číslo.js', 'deep/číslo.js'), true);
  assert.equal(decide('é.js', 'e\u0301.js'), false);
  assert.equal(decide('build/', 'deep/build', true), true);
  assert.equal(decide('# comment\n a.js  \n{name}(x).js\r\n', ' a.js'), true);
  assert.equal(decide('{name}(x).js', '{name}(x).js'), true);
});

test('directory pruning requires parent re-inclusion and honors last matching rule', t => {
  const root = fixture(t, { 'build/keep.js': 'export const keep=1;', 'build/drop.js': 'DROP_SENTINEL', '.gitignore': '!/build/keep.js\n' });
  assert.ok(!node(indexProject(root), 'build/keep.js'));
  write(root, '.gitignore', '!/build/\n/build/*\n!/build/keep.js\n');
  const graph = indexProject(root);
  assert.ok(node(graph, 'build/keep.js'));
  assert.ok(!node(graph, 'build/drop.js'));
  assert.ok(!JSON.stringify(graph).includes('DROP_SENTINEL'));
});

test('hard guards, exact installed exclusion and naming-map exception cannot be negated', t => {
  const root = fixture(t, { '.gitignore': '!*.mjs\n!node_modules/\n!agent.mind/\n', 'main.mjs': 'export const main=1;', 'env.mjs': 'SENSITIVE_SENTINEL', 'Credentials.mjs': 'SENSITIVE_SENTINEL', 'secret_manager.mjs': 'SENSITIVE_SENTINEL', 'id_ed25519.mjs': 'SENSITIVE_SENTINEL', 'file.PEM.js': 'SENSITIVE_SENTINEL', 'sensitive/secrets/deep.mjs': 'SENSITIVE_SENTINEL', '.private/x.mjs': 'SENSITIVE_SENTINEL', 'node_modules/x.mjs': 'SENSITIVE_SENTINEL', 'agent.mind/private.mjs': 'INTEGRATION_SENTINEL', 'agent.mind/project-map.json': '{"schemaVersion":1,"blocks":[]}', 'agent.mind-copy/a.mjs': 'export const copy=1;', 'src/agent.mind/a.mjs': 'export const nested=1;', 'environment.mjs': 'export const environment=1;', 'credentialsHelper.mjs': 'export const helper=1;', 'mykey.js': 'export const key=1;' });
  const opened = spyOpens(t);
  const options = { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' };
  const graph = indexProject(root, options);
  assert.equal(graph.metadata.status, 'current');
  for (const name of ['agent.mind-copy/a.mjs', 'src/agent.mind/a.mjs', 'environment.mjs', 'credentialsHelper.mjs', 'mykey.js']) assert.ok(node(graph, name), name);
  assert.ok(!JSON.stringify(graph).includes('SENSITIVE_SENTINEL'));
  assert.ok(!JSON.stringify(graph).includes('INTEGRATION_SENTINEL'));
  for (const name of ['env.mjs', 'Credentials.mjs', 'secret_manager.mjs', 'id_ed25519.mjs', 'file.PEM.js', 'sensitive/secrets/deep.mjs', '.private/x.mjs', 'node_modules/x.mjs', 'agent.mind/private.mjs']) assert.ok(!opened.includes(path.join(root, name)), name);
  write(root, '.gitignore', '/agent.mind/\n');
  const excludedMap = indexProject(root, options);
  assert.equal(excludedMap.metadata.status, 'excluded');
  assert.equal(excludedMap.metadata.hash, null);
  assert.equal(excludedMap.metadata.configuration, null);
  assert.ok(!node(graph, 'agent.mind/project-map.json'));
});

test('source naming maps obey policy and do not fall back; nested ignores are counted without reads', t => {
  const root = fixture(t, { '.gitignore': '/project-map.json\n/skip/\n', 'project-map.json': 'NAMING_SENTINEL', 'src/.gitignore': 'UNSUPPORTED_**_SENTINEL', 'skip/.gitignore': 'PRUNED_SENTINEL', 'src/yes.js': 'export const yes=1;' });
  const opened = spyOpens(t);
  const graph = indexProject(root);
  assert.equal(graph.metadata.status, 'excluded');
  assert.equal(graph.inputPolicy.nestedIgnoreCount, 1);
  assert.ok(graph.diagnostics.some(item => item.path === 'src/.gitignore' && item.code === 'NESTED_IGNORE_NOT_LOADED'));
  for (const name of ['project-map.json', 'src/.gitignore', 'skip/.gitignore']) assert.ok(!opened.includes(path.join(root, name)));
  assert.ok(!JSON.stringify(graph).includes('SENTINEL'));
});

test('every unsupported active rule invalidates the entire policy without source/map reads or raw diagnostics', t => {
  const root = fixture(t, { 'main.js': 'SOURCE_SENTINEL', 'project-map.json': 'MAP_SENTINEL' });
  const opened = spyOpens(t);
  for (const invalid of ['**', '[ab]', 'a\\b', '!', '/', 'a//b', '.', '..', 'a/../b', 'a/./b', '\ufeffok', 'ok\u0000', 'ok\t', 'ok\r', 'ok\rnext\n', 'ok\u0085', Buffer.from([0xff])]) {
    write(root, '.gitignore', typeof invalid === 'string' ? Buffer.from(invalid.startsWith('\ufeff') ? invalid : 'ignored.js\n' + invalid) : invalid);
    opened.length = 0;
    const graph = indexProject(root);
    assertEmpty(graph);
    assert.ok(opened.every(name => name === path.join(root, '.gitignore')));
    assert.ok(!JSON.stringify(graph).includes('SOURCE_SENTINEL'));
    assert.ok(!JSON.stringify(graph).includes('MAP_SENTINEL'));
    assert.throws(() => readIndexedSource(root, { path: 'main.js', id: 'file:main.js', hash: '0'.repeat(64), policyId: graph.inputPolicy.id, capabilities: ['text'] }), /policy/);
  }
});

test('exact byte, logical line and UTF-8 line byte bounds accept the boundary and reject one beyond', t => {
  const root = fixture(t, { 'main.js': 'export const yes=1;' });
  const check = bytes => { write(root, '.gitignore', bytes); return inspectInputPolicy(root); };
  const atBytes = ('#' + 'x'.repeat(1022) + '\n').repeat(64);
  assert.equal(Buffer.byteLength(atBytes), INPUT_POLICY_LIMITS.bytes);
  assert.equal(check(atBytes).status, 'valid');
  assert.equal(check(atBytes + '\n').reason, 'byte-limit');
  assert.equal(check('\n'.repeat(1024)).status, 'valid');
  assert.equal(check('\n'.repeat(1025)).reason, 'line-limit');
  assert.equal(check('#' + 'x'.repeat(1023)).status, 'valid');
  assert.equal(check('#' + 'x'.repeat(1024)).reason, 'line-byte-limit');
  assert.equal(check('#' + 'x'.repeat(1023) + '\r\n').status, 'valid');
  assert.equal(check('#' + 'é'.repeat(512)).reason, 'line-byte-limit');
});

test('nonbacktracking matcher visits exactly 8,000,000 states and stops before the next state', () => {
  const { rules } = parseInputPolicy(Buffer.from('a'.repeat(999)));
  const work = { units: 0 };
  assert.equal(policyMatchDecision(rules, 'b'.repeat(7999), false, work), false);
  assert.equal(work.units, INPUT_POLICY_LIMITS.work);
  assert.throws(() => policyMatchDecision(rules, 'b', false, work), error => error.reason === 'work-limit');
  assert.equal(work.units, INPUT_POLICY_LIMITS.work);
  const over = { units: 0 };
  assert.throws(() => policyMatchDecision(rules, 'b'.repeat(8000), false, over), error => error.reason === 'work-limit');
  assert.equal(over.units, INPUT_POLICY_LIMITS.work);
});

test('scan work exhaustion fails closed before opening source or naming map', t => {
  const root = fixture(t, { '.gitignore': ('a'.repeat(999) + '\n').repeat(64), 'main.js': 'SOURCE_SENTINEL', 'project-map.json': 'MAP_SENTINEL' });
  // 64,000 bytes of valid rules; enough candidates exceed the fixed shared cap.
  for (let i = 0; i < 20; i++) write(root, 'a'.repeat(200) + i + '.js', 'SOURCE_SENTINEL');
  const opened = spyOpens(t);
  const graph = indexProject(root);
  assertEmpty(graph);
  assert.equal(graph.inputPolicy.reason, 'work-limit');
  assert.equal(graph.inputPolicy.workUnits, INPUT_POLICY_LIMITS.work);
  assert.ok(opened.every(name => name === path.join(root, '.gitignore')));
});

test('policy control symlinks/directories/special files and unreadability never fall back or read targets', t => {
  const outside = fixture(t, { 'outside': 'OUTSIDE_SENTINEL' });
  const root = fixture(t, { 'main.js': 'SOURCE_SENTINEL', 'project-map.json': 'MAP_SENTINEL' });
  const opened = spyOpens(t);
  fs.symlinkSync(path.join(outside, 'outside'), path.join(root, '.gitignore'));
  assertEmpty(indexProject(root));
  assert.equal(opened.length, 0);
  fs.unlinkSync(path.join(root, '.gitignore'));
  fs.mkdirSync(path.join(root, '.gitignore'));
  assertEmpty(indexProject(root));
  assert.equal(opened.length, 0);
  fs.rmdirSync(path.join(root, '.gitignore'));
  write(root, '.gitignore', '');
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (name, ...args) => {
    const result = original(name, ...args);
    if (name === path.join(root, '.gitignore')) return { ...result, isSymbolicLink: () => false, isFile: () => false };
    return result;
  });
  assertEmpty(indexProject(root));
  assert.equal(opened.length, 0);
  t.mock.restoreAll();
  const originalOpen = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => { if (name === path.join(root, '.gitignore')) throw Object.assign(new Error('unreadable SENTINEL'), { code: 'EACCES' }); return originalOpen(name, ...args); });
  const unreadable = indexProject(root);
  assertEmpty(unreadable);
  assert.equal(unreadable.inputPolicy.reason, 'unreadable');
  assert.ok(!JSON.stringify(unreadable).includes('SENTINEL'));
});

test('ignore-only bytes, comments, CRLF and same-mtime edits revoke old nodes and warm membership', t => {
  const root = fixture(t, { '.gitignore': '#a\n', 'main.js': 'export const yes=1;', 'other.js': 'export const other=1;' });
  let previous = indexProject(root);
  for (const policy of ['#b\n', '#b\r\n', '/main.js\n', '**\n', '# restored\n']) {
    const stale = node(previous, 'main.js');
    const before = fs.statSync(path.join(root, '.gitignore'));
    write(root, '.gitignore', policy);
    fs.utimesSync(path.join(root, '.gitignore'), before.atime, before.mtime);
    if (stale) assert.throws(() => readIndexedSource(root, stale), /policy/);
    const warm = indexProject(root, { previous });
    const cold = indexProject(root);
    assert.equal(warm.revision, cold.revision);
    assert.notEqual(warm.revision, previous.revision);
    if (node(warm, 'main.js')) assert.equal(readIndexedSource(root, node(warm, 'main.js')), 'export const yes=1;');
    previous = warm;
  }
});

test('an in-flight policy edit rejects source bodies and late graph publication; valid recovery is fresh', t => {
  const root = fixture(t, { '.gitignore': '# safe\n', 'main.js': 'export const yes=1;' });
  const graph = indexProject(root);
  const original = fs.readSync;
  let changed = false;
  t.mock.method(fs, 'readSync', (descriptor, ...args) => {
    const result = original(descriptor, ...args);
    if (!changed && fs.fstatSync(descriptor).ino === fs.statSync(path.join(root, 'main.js')).ino) { changed = true; write(root, '.gitignore', '/main.js\n'); }
    return result;
  });
  assert.throws(() => readIndexedSource(root, node(graph, 'main.js')), /policy/);
  t.mock.restoreAll();
  write(root, '.gitignore', '# safe\n');
  changed = false;
  t.mock.method(fs, 'readSync', (descriptor, ...args) => {
    const result = original(descriptor, ...args);
    if (!changed && fs.fstatSync(descriptor).ino === fs.statSync(path.join(root, 'main.js')).ino) { changed = true; write(root, '.gitignore', '**\n'); }
    return result;
  });
  const invalidated = indexProject(root, { previous: graph });
  assertEmpty(invalidated);
  assert.equal(invalidated.inputPolicy.reason, 'policy-changed');
  t.mock.restoreAll();
  write(root, '.gitignore', '# recovery\n');
  const recovered = indexProject(root, { previous: invalidated });
  assert.equal(recovered.status, 'current');
  assert.equal(recovered.stats.cachedFiles, 0);
  assert.equal(readIndexedSource(root, node(recovered, 'main.js')), 'export const yes=1;');
});

test('oversized control input is rejected before open; an observed loader edit cannot authorize source reads', t => {
  const root = fixture(t, { '.gitignore': '#'.repeat(INPUT_POLICY_LIMITS.bytes + 1), 'main.js': 'SOURCE_SENTINEL', 'project-map.json': 'MAP_SENTINEL' });
  const opened = spyOpens(t);
  const oversized = indexProject(root);
  assertEmpty(oversized);
  assert.equal(oversized.inputPolicy.reason, 'byte-limit');
  assert.equal(opened.length, 0);
  t.mock.restoreAll();
  write(root, '.gitignore', '# before\n');
  const original = fs.readSync;
  let changed = false;
  const requests = [];
  const originalSize = fs.statSync(path.join(root, '.gitignore')).size;
  t.mock.method(fs, 'readSync', (descriptor, buffer, offset, length, position) => {
    requests.push({ buffer: buffer.length, length });
    const count = original(descriptor, buffer, offset, length, position);
    if (!changed) { changed = true; write(root, '.gitignore', '# edited\n'); }
    return count;
  });
  const concurrent = indexProject(root);
  assertEmpty(concurrent);
  assert.equal(concurrent.inputPolicy.reason, 'changed');
  assert.ok(requests.every(request => request.buffer <= originalSize + 1 && request.length <= originalSize + 1));
  assert.ok(!JSON.stringify(concurrent).includes('SENTINEL'));
});

test('one direct-read work budget is shared across both policy observations', t => {
  const name = 'b'.repeat(196) + '.js';
  const root = fixture(t, { '.gitignore': ('a'.repeat(999) + '\n').repeat(32), [name]: 'export const yes=1;' });
  const graph = indexProject(root);
  assert.equal(graph.inputPolicy.status, 'valid');
  assert.ok(node(graph, name));
  // Each observation alone fits; two membership checks together exceed 8M.
  assert.ok(graph.inputPolicy.workUnits < INPUT_POLICY_LIMITS.work);
  assert.throws(() => readIndexedSource(root, node(graph, name)), /policy/);
});
