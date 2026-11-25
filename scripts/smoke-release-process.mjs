// Process handling for smoke-release only; this development helper is not shipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

export function runSmokeCommand(cli, args, { cwd, expectedRejection, timeoutMs = 15000 } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error); // Includes ETIMEDOUT, launch failure and output overflow.
  assert.equal(result.signal, null, `CLI terminated by signal ${result.signal}`);
  assert(Number.isInteger(result.status), 'CLI did not return a numeric exit status');
  if (expectedRejection !== undefined) {
    assert(expectedRejection instanceof RegExp, 'Expected rejection requires a reason pattern');
    assert.notEqual(result.status, 0, 'Expected an explicit rejection');
    assert.match(result.stderr, expectedRejection);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export function startSmokeView(cli, { cwd, readinessTimeoutMs = 10000, stopTimeoutMs = 2000 } = {}) {
  const child = spawn(process.execPath, [cli, 'view'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false, spawnError, stderr = '';
  // Observe from spawn onward: stop must also work after close/error has happened.
  const completion = new Promise(resolve => {
    child.on('error', error => { spawnError = error; });
    child.once('close', () => { closed = true; resolve(); });
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const ready = new Promise((resolve, reject) => {
    let stdout = '';
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout.off('data', onData);
      if (error) reject(error); else resolve(value);
    };
    const onError = error => finish(error);
    const onClose = (code, signal) => finish(new Error(`View exited before readiness (status ${code}, signal ${signal}): ${stderr}`));
    const onData = bytes => {
      stdout += bytes;
      let value;
      try { value = JSON.parse(stdout); } catch { return; }
      if (value.url) finish(null, value);
    };
    const timer = setTimeout(() => finish(new Error(`View readiness timeout: ${stderr}`)), readinessTimeoutMs);
    child.once('error', onError);
    child.once('close', onClose);
    child.stdout.on('data', onData);
  });
  const waitClosed = async () => {
    let timer;
    try {
      return await Promise.race([
        completion.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), stopTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const stop = async (signal = 'SIGTERM') => {
    if (closed) return;
    // A failed spawn has no PID; its close event is still observed above.
    if (!spawnError) child.kill(signal);
    if (await waitClosed()) return;
    child.kill('SIGKILL');
    if (!await waitClosed()) throw new Error('View did not close after bounded SIGKILL cleanup');
  };
  return { child, ready, stop };
}

export async function cleanupSmoke(view, temporary, primaryError) {
  const errors = [];
  try { await view?.stop(); } catch (error) { errors.push(error); }
  // Always remove the disposable fixture, even if stopping the view failed.
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (!errors.length) return;
  if (primaryError) primaryError.cleanupErrors = errors;
  else throw new AggregateError(errors, 'Release smoke cleanup failed');
}
