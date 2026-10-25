import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ARTIFACT_FILES, verifyArtifact } from '../installation.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/build-release.mjs [--output /absolute/new-directory]');
const output = path.resolve(args[1] || path.join(root, 'dist', `agent-mind-${pkg.version}`));
if (fs.existsSync(output)) throw new Error(`Output exists; choose a new directory: ${output}`);
const bundleName = `agent-mind-${pkg.version}`;
const bundle = path.join(output, bundleName);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
const copy = relative => {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Release inputs must not be symlinks: ${relative}`);
  if (stat.isFile()) {
    const bytes = fs.readFileSync(source);
    files[relative] = sha(bytes);
    fs.mkdirSync(path.dirname(path.join(bundle, relative)), { recursive: true });
    fs.writeFileSync(path.join(bundle, relative), bytes, { flag: 'wx' });
  } else throw new Error(`Unsupported release input: ${relative}`);
};
const acorn = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/acorn/package.json'), 'utf8'));
if (acorn.version !== pkg.dependencies.acorn) throw new Error('Installed Acorn does not match the exact package pin; run npm ci --ignore-scripts.');
fs.mkdirSync(bundle, { recursive: true });
// Explicit runtime allowlist: never package development history or target workspaces.
for (const relative of ARTIFACT_FILES) copy(relative);
const orderedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const manifest = { schemaVersion: 1, version: pkg.version, files: orderedFiles, digest: sha(JSON.stringify(orderedFiles)) };
fs.writeFileSync(path.join(bundle, 'artifact.json'), `${JSON.stringify(manifest, null, 2)}\n`);
verifyArtifact(bundle, manifest.digest);
const archiveName = `${bundleName}.tar.gz`;
const archive = path.join(output, archiveName);
const packed = spawnSync('tar', ['-czf', archive, '-C', output, bundleName], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
if (packed.status !== 0) throw new Error(`tar failed: ${packed.stderr}`);
const archiveSha256 = sha(fs.readFileSync(archive));
fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${archiveSha256}  ${archiveName}\n`);
console.log(JSON.stringify({ version: pkg.version, bundle, archive, archiveSha256, artifactDigest: manifest.digest, files: Object.keys(files).length }, null, 2));
