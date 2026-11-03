import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('released runtime rejects direct context execution while imports and development CLI stay usable', async t => {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-context-cli-')));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const runtime = path.join(fixture, 'runtime');
  const target = path.join(fixture, 'target');
  fs.mkdirSync(path.join(runtime, 'public'), { recursive: true });
  fs.mkdirSync(target);
  for (const relative of ['graph-context.mjs', 'code-index.mjs', 'source-analysis.mjs', 'typed-analysis.mjs', 'python-analysis.mjs', 'symbol-index.mjs', 'project-map.mjs', 'public/hierarchy.mjs']) fs.copyFileSync(path.join(appRoot, relative), path.join(runtime, relative));
  fs.symlinkSync(path.join(appRoot, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(target, 'main.mjs'), 'export const value = 1;');
  const script = path.join(runtime, 'graph-context.mjs');
  const invoke = () => spawnSync(process.execPath, [script, 'main.mjs'], { encoding: 'utf8', env: { ...process.env, AGENT_MIND_PROJECT: target }, timeout: 10000 });
  const development = invoke();
  assert.equal(development.status, 0, development.stderr);
  assert.equal(JSON.parse(development.stdout).selection.id, 'file:main.mjs');
  fs.writeFileSync(path.join(runtime, 'artifact.json'), '{}');
  const released = invoke();
  assert.equal(released.status, 1);
  assert.equal(released.stdout, '');
  assert.match(released.stderr, /installed agent\.mind\/cli\.mjs context.*binding/);
  const { freshContext } = await import(pathToFileURL(script).href);
  assert.equal(freshContext(target, 'main.mjs', { generic: true }).selection.id, 'file:main.mjs');
});

test('development Python context exposes import and same-file call evidence and rejects stale source revisions', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-python-context-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = 'import helper\ndef answer():\n    return 1\ndef run():\n    return answer()\n';
  fs.writeFileSync(path.join(root, 'main.py'), main);
  fs.writeFileSync(path.join(root, 'helper.py'), 'value = 1\n');
  const result = spawnSync(process.execPath, [path.join(appRoot, 'graph-context.mjs'), 'main.py'], { encoding: 'utf8', env: { ...process.env, AGENT_MIND_PROJECT: root }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout);
  assert.equal(context.status, 'current');
  assert.equal(context.selection.id, 'file:main.py');
  assert.ok(context.edges.some(edge => edge.from === 'file:main.py' && edge.to === 'file:helper.py' && edge.kind === 'import' && edge.evidence[0].line === 1));
  assert.ok(context.symbolGraph.edges.some(edge => edge.from === 'symbol:main.py#run' && edge.to === 'symbol:main.py#answer' && edge.kind === 'call'));
  const { freshContext } = await import('../graph-context.mjs');
  const selected = freshContext(root, 'symbol:main.py#run', { expectedRevision: context.revision });
  assert.equal(selected.selection.id, 'symbol:main.py#run');
  assert.ok(selected.symbolGraph.edges.some(edge => edge.to === 'symbol:main.py#answer'));
  fs.writeFileSync(path.join(root, 'helper.py'), 'value = 2\n');
  assert.throws(() => freshContext(root, 'main.py', { expectedRevision: context.revision }), { code: 'STALE_REVISION' });
});
