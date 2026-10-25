import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ARTIFACT_FILES, verifyArtifact } from '../installation.mjs';

test('release builder packages only shared allowlist and verifies the produced runtime', t => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-package-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const mirror = path.join(temporary, 'source'), output = path.join(temporary, 'release');
  for (const relative of [...ARTIFACT_FILES, 'scripts/build-release.mjs']) {
    fs.mkdirSync(path.dirname(path.join(mirror, relative)), { recursive: true });
    fs.copyFileSync(path.join(root, relative), path.join(mirror, relative));
  }
  fs.writeFileSync(path.join(mirror, 'public/owner-private-probe.txt'), 'synthetic private fixture; must not be packaged');
  const result = spawnSync(process.execPath, [path.join(mirror, 'scripts/build-release.mjs'), '--output', output], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const built = JSON.parse(result.stdout), artifact = verifyArtifact(built.bundle);
  assert.equal(artifact.digest, built.artifactDigest);
  assert.deepEqual(Object.keys(artifact.files).sort(), [...ARTIFACT_FILES].sort());
  assert(!fs.existsSync(path.join(built.bundle, 'public/owner-private-probe.txt')));
  const listing = spawnSync('tar', ['-tzf', built.archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0);
  assert(!listing.stdout.includes('owner-private-probe'));
  assert(listing.stdout.includes('node_modules/acorn/LICENSE'));
  const again = spawnSync(process.execPath, [path.join(mirror, 'scripts/build-release.mjs'), '--output', output], { encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /Output exists/);
});
