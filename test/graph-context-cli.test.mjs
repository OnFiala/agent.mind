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
  for (const relative of ['graph-context.mjs', 'code-index.mjs', 'symbol-index.mjs', 'project-map.mjs', 'public/hierarchy.mjs']) fs.copyFileSync(path.join(appRoot, relative), path.join(runtime, relative));
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
