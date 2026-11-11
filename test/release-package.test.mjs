import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ARTIFACT_FILES, verifyArtifact } from '../installation.mjs';

// A literal schema-1 order: changing either production comparator cannot change this oracle.
const englishPaths = `
cli.mjs
code-index.mjs
graph-context.mjs
installation.mjs
LICENSE
live-index.mjs
node_modules/@babel/parser/lib/index.js
node_modules/@babel/parser/LICENSE
node_modules/@babel/parser/package.json
node_modules/@lezer/common/dist/index.js
node_modules/@lezer/common/LICENSE
node_modules/@lezer/common/package.json
node_modules/@lezer/highlight/dist/index.js
node_modules/@lezer/highlight/LICENSE
node_modules/@lezer/highlight/package.json
node_modules/@lezer/lr/dist/index.js
node_modules/@lezer/lr/LICENSE
node_modules/@lezer/lr/package.json
node_modules/@lezer/python/dist/index.js
node_modules/@lezer/python/LICENSE
node_modules/@lezer/python/package.json
node_modules/acorn/bin/acorn
node_modules/acorn/CHANGELOG.md
node_modules/acorn/dist/acorn.d.mts
node_modules/acorn/dist/acorn.d.ts
node_modules/acorn/dist/acorn.js
node_modules/acorn/dist/acorn.mjs
node_modules/acorn/dist/bin.js
node_modules/acorn/LICENSE
node_modules/acorn/package.json
node_modules/acorn/README.md
package-lock.json
package.json
project-map.mjs
public/assets/agent-mind-wordmark.webp
public/assets/canvas-paper.webp
public/assets/README.md
public/hierarchy.mjs
public/visualizer.css
public/visualizer.html
public/visualizer.js
python-analysis.mjs
README.md
server.mjs
source-analysis.mjs
symbol-index.mjs
typed-analysis.mjs
`.trim().split('\n');
const locales = [['en_US.UTF-8', 'en-US'], ['cs_CZ.UTF-8', 'cs-CZ'], ['sk_SK.UTF-8', 'sk-SK'], ['C', 'en-US']];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

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
  assert.deepEqual([...englishPaths].sort(), [...ARTIFACT_FILES].sort());
  const expectedFiles = Object.fromEntries(englishPaths.map(relative => [relative, sha(fs.readFileSync(path.join(mirror, relative)))]));
  const expectedDigest = sha(JSON.stringify(expectedFiles));
  const buildScript = `
    import { pathToFileURL } from 'node:url';
    console.error(Intl.DateTimeFormat().resolvedOptions().locale);
    const [builder, output] = process.argv.slice(1);
    process.argv = [process.execPath, builder, '--output', output];
    await import(pathToFileURL(builder).href);
  `;
  const verifyScript = `
    import { verifyArtifact } from './installation.mjs';
    const artifact = verifyArtifact(process.argv[1], process.argv[2]);
    console.log(JSON.stringify({ locale: Intl.DateTimeFormat().resolvedOptions().locale, digest: artifact.digest }));
  `;
  let built;
  for (const [buildLocale, resolvedBuildLocale] of locales) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', buildScript, path.join(mirror, 'scripts/build-release.mjs'), `${output}-${buildLocale}`], {
      env: { ...process.env, LC_ALL: buildLocale, LANG: buildLocale }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), resolvedBuildLocale, `${buildLocale}: resolved build locale`);
    built = JSON.parse(result.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(built.bundle, 'artifact.json')));
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(Object.keys(manifest.files), englishPaths, `${buildLocale}: manifest order`);
    assert.deepEqual(manifest.files, expectedFiles);
    assert.equal(manifest.digest, expectedDigest, `${buildLocale}: independent digest oracle`);
    assert.equal(built.artifactDigest, expectedDigest);
    for (const [verifyLocale, resolvedVerifyLocale] of locales) {
      const run = digest => spawnSync(process.execPath, ['--input-type=module', '-e', verifyScript, built.bundle, digest], {
        cwd: mirror, env: { ...process.env, LC_ALL: verifyLocale, LANG: verifyLocale }, encoding: 'utf8', timeout: 10000,
      });
      const verified = run(expectedDigest);
      assert.equal(verified.status, 0, `${buildLocale} -> ${verifyLocale}: ${verified.stderr}`);
      assert.deepEqual(JSON.parse(verified.stdout), { locale: resolvedVerifyLocale, digest: expectedDigest });
      const wrong = run('0'.repeat(64));
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /Artifact digest mismatch/);
      const target = path.join(built.bundle, 'README.md'), original = fs.readFileSync(target);
      try {
        fs.appendFileSync(target, '\nsynthetic tamper\n');
        const tampered = run(expectedDigest);
        assert.notEqual(tampered.status, 0);
        assert.match(tampered.stderr, /Artifact hash mismatch: README\.md/);
      } finally { fs.writeFileSync(target, original); }
    }
    t.diagnostic(`${buildLocale} (${resolvedBuildLocale}): canonical digest; verified and rejected wrong digest/tampered bytes in all four locales`);
  }
  const artifact = verifyArtifact(built.bundle);
  assert.equal(artifact.digest, built.artifactDigest);
  assert.deepEqual(Object.keys(artifact.files).sort(), [...ARTIFACT_FILES].sort());
  assert(!fs.existsSync(path.join(built.bundle, 'public/owner-private-probe.txt')));
  const listing = spawnSync('tar', ['-tzf', built.archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0);
  assert(!listing.stdout.includes('owner-private-probe'));
  assert(listing.stdout.includes('node_modules/acorn/LICENSE'));
  const again = spawnSync(process.execPath, [path.join(mirror, 'scripts/build-release.mjs'), '--output', path.dirname(built.bundle)], { encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /Output exists/);
});
