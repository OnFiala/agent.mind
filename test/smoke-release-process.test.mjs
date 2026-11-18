import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runSmokeCommand, startSmokeView, cleanupSmoke } from '../scripts/smoke-release-process.mjs';

function fixture(t, source) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-smoke-process-test-'));
  const cli = path.join(temporary, 'inert-cli.mjs');
  fs.writeFileSync(cli, source);
  const views = [];
  t.after(async () => {
    for (const view of views) await cleanupSmoke(view, temporary);
    fs.rmSync(temporary, { recursive: true, force: true });
    assert(!fs.existsSync(temporary));
    for (const { child } of views) if (child.pid) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  });
  return {
    temporary, cli,
    run: options => runSmokeCommand(cli, [], { cwd: temporary, ...options }),
    view: options => { const view = startSmokeView(cli, { cwd: temporary, ...options }); views.push(view); return view; },
  };
}

test('smoke command accepts JSON success and a numeric nonzero rejection with the expected reason', t => {
  assert.deepEqual(fixture(t, 'console.log(JSON.stringify({ status: "ok" }));').run(), { status: 'ok' });
  const negative = fixture(t, 'console.error("EXPECTED_OWNER_REJECTION"); process.exitCode = 7;');
  assert.match(negative.run({ expectedRejection: /EXPECTED_OWNER_REJECTION/ }), /EXPECTED_OWNER_REJECTION/);
  assert.throws(() => negative.run({ expectedRejection: /OTHER_REASON/ }), /OTHER_REASON/);
  assert.throws(() => negative.run({ expectedRejection: false }), /requires a reason pattern/);
});

test('smoke command refuses success even when stderr contains the expected rejection', t => {
  const child = fixture(t, 'console.error("EXPECTED_OWNER_REJECTION"); console.log("{}");');
  assert.throws(() => child.run({ expectedRejection: /EXPECTED_OWNER_REJECTION/ }), /Expected an explicit rejection/);
});

test('smoke command refuses timeout even when stderr contains the expected rejection', t => {
  const child = fixture(t, 'import fs from "node:fs"; console.error("EXPECTED_OWNER_REJECTION"); fs.writeFileSync("started", "ready"); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);');
  assert.throws(() => child.run({ expectedRejection: /EXPECTED_OWNER_REJECTION/, timeoutMs: 1000 }), /ETIMEDOUT/);
  assert.equal(fs.readFileSync(path.join(child.temporary, 'started'), 'utf8'), 'ready');
});

test('smoke command distinguishes a terminating signal from an explicit rejection', t => {
  const child = fixture(t, 'console.error("EXPECTED_OWNER_REJECTION"); process.kill(process.pid, "SIGTERM");');
  assert.throws(() => child.run({ expectedRejection: /EXPECTED_OWNER_REJECTION/ }), /CLI terminated by signal SIGTERM/);
});

test('smoke command refuses launch errors independently of the rejection pattern', t => {
  const child = fixture(t, 'console.error("EXPECTED_OWNER_REJECTION"); process.exitCode = 1;');
  assert.throws(() => child.run({ cwd: path.join(child.temporary, 'absent'), expectedRejection: /EXPECTED_OWNER_REJECTION/ }), /ENOENT/);
});

test('viewer exit before readiness retains the original error and removes its fixture after exit', async t => {
  const child = fixture(t, 'console.error("EARLY_EXIT_REASON"); process.exitCode = 7;');
  const view = child.view();
  let original;
  await assert.rejects(async () => {
    try { await view.ready; }
    catch (error) { original = error; throw error; }
    finally { await cleanupSmoke(view, child.temporary, original); }
  }, error => error === original && /status 7, signal null.*EARLY_EXIT_REASON/s.test(error.message));
  assert.equal(view.child.exitCode, 7);
  assert(!fs.existsSync(child.temporary));
  await view.stop(); // Also safe after the close event was already observed.
});

test('viewer signal before readiness is reported and cleaned up', async t => {
  const child = fixture(t, 'process.kill(process.pid, "SIGTERM");');
  const view = child.view();
  await assert.rejects(view.ready, /status null, signal SIGTERM/);
  await cleanupSmoke(view, child.temporary);
  assert(!fs.existsSync(child.temporary));
});

test('viewer launch failure settles cleanup without waiting for an exit event', async t => {
  const child = fixture(t, 'console.log("{}");');
  const view = child.view({ cwd: path.join(child.temporary, 'absent') });
  await assert.rejects(view.ready, { code: 'ENOENT' });
  await cleanupSmoke(view, child.temporary);
  assert(!fs.existsSync(child.temporary));
});

test('viewer readiness timeout remains the failure and cleanup stops the live process', async t => {
  const child = fixture(t, 'setInterval(() => {}, 1000);');
  const view = child.view({ readinessTimeoutMs: 300 });
  let original;
  await assert.rejects(async () => {
    try { await view.ready; }
    catch (error) { original = error; throw error; }
    finally { await cleanupSmoke(view, child.temporary, original); }
  }, error => error === original && /View readiness timeout/.test(error.message));
  assert(!fs.existsSync(child.temporary));
});

test('viewer stop escalates to SIGKILL after a bounded wait for an ignored signal', async t => {
  const child = fixture(t, 'process.on("SIGTERM", () => {}); console.log(JSON.stringify({ url: "http://127.0.0.1:1" })); setInterval(() => {}, 1000);');
  const view = child.view({ stopTimeoutMs: 100 });
  assert.equal((await view.ready).url, 'http://127.0.0.1:1');
  await view.stop();
  assert.equal(view.child.signalCode, 'SIGKILL');
});

test('viewer cleanup also works when a ready viewer has subsequently exited', async t => {
  const child = fixture(t, 'console.log(JSON.stringify({ url: "http://127.0.0.1:1" })); setTimeout(() => process.exit(3), 50);');
  const view = child.view();
  const ended = once(view.child, 'close');
  await view.ready;
  await ended;
  assert.equal(view.child.exitCode, 3);
  await cleanupSmoke(view, child.temporary);
  assert(!fs.existsSync(child.temporary));
});

test('fixture removal still runs after a stop failure and preserves the primary error', async t => {
  const child = fixture(t, '');
  const primary = new Error('ORIGINAL_SMOKE_FAILURE'), stopFailure = new Error('STOP_FAILURE');
  await assert.rejects(async () => {
    try { throw primary; }
    finally { await cleanupSmoke({ stop: async () => { throw stopFailure; } }, child.temporary, primary); }
  }, error => error === primary);
  assert.deepEqual(primary.cleanupErrors, [stopFailure]);
  assert(!fs.existsSync(child.temporary));
});

test('cleanup reports a stop failure if there is no earlier smoke failure', async t => {
  const child = fixture(t, '');
  const stopFailure = new Error('STOP_FAILURE');
  await assert.rejects(cleanupSmoke({ stop: async () => { throw stopFailure; } }, child.temporary), error => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors, [stopFailure]);
    return true;
  });
  assert(!fs.existsSync(child.temporary));
});
