import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TOP = new Set(['cli.mjs', 'installation.mjs', 'server.mjs', 'code-index.mjs', 'live-index.mjs', 'project-map.mjs', 'symbol-index.mjs', 'graph-context.mjs', 'package.json', 'package-lock.json', 'README.md', 'LICENSE']);
const PUBLIC = new Set(['public/hierarchy.mjs', 'public/visualizer.js', 'public/visualizer.css', 'public/visualizer.html', 'public/assets/canvas-paper.webp', 'public/assets/agent-mind-wordmark.webp', 'public/assets/README.md']);
const ACORN = new Set(['LICENSE', 'bin/acorn', 'CHANGELOG.md', 'dist/bin.js', 'dist/acorn.mjs', 'dist/acorn.d.ts', 'dist/acorn.js', 'dist/acorn.d.mts', 'README.md', 'package.json'].map(p => `node_modules/acorn/${p}`));
export const ARTIFACT_FILES = Object.freeze([...TOP, ...PUBLIC, ...ACORN].sort());
const allowedArtifact = relative => TOP.has(relative) || PUBLIC.has(relative) || ACORN.has(relative);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.posix.normalize(relative) !== relative || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Unsafe relative path.');
  return relative;
}
function checked(root, relative, missing = false) {
  safeRelative(relative);
  let current = root;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Symbolic links are not allowed.');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (missing && !exists(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relative}`);
  }
  return current;
}
function read(root, relative, limit = 4 * 1024 * 1024) {
  const filename = checked(root, relative);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd), current = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > limit || stat.ino !== current.ino || stat.dev !== current.dev) throw new Error(`Unsafe file: ${relative}`);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (bytes.length !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error(`File changed during read: ${relative}`);
    return bytes;
  } finally { fs.closeSync(fd); }
}
const readJSON = (root, relative) => JSON.parse(read(root, relative).toString('utf8'));
function writeAtomic(root, relative, value) {
  const filename = checked(root, relative, true);
  const temporary = `${filename}.tmp-${randomUUID()}`;
  fs.writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
  try { checked(root, relative, true); fs.renameSync(temporary, filename); }
  finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
function filesBelow(root, prefix = '', allowedDirectories, budget = { entries: 0 }) {
  const result = [];
  for (const item of fs.readdirSync(prefix ? checked(root, prefix) : root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (++budget.entries > 300) throw new Error('Release has too many directory entries.');
    if (item.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${relative}`);
    if (item.isDirectory()) {
      if (allowedDirectories && !allowedDirectories.has(relative)) throw new Error(`Artifact contains unknown directory: ${relative}`);
      result.push(...filesBelow(root, relative, allowedDirectories, budget));
    }
    else if (item.isFile()) result.push(relative);
    else throw new Error(`Unsupported file type: ${relative}`);
    if (result.length > 200) throw new Error('Release has too many files.');
  }
  return result.sort();
}
export function artifactDigest(files) {
  return sha(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))));
}
export function verifyArtifact(directory, expectedDigest) {
  const root = fs.realpathSync(directory);
  if (fs.lstatSync(path.resolve(directory)).isSymbolicLink()) throw new Error('Release directory must not be a symlink.');
  const manifest = readJSON(root, 'artifact.json');
  if (manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !manifest.version || !manifest.files || Array.isArray(manifest.files) || !HASH.test(manifest.digest)) throw new Error('Invalid artifact manifest.');
  const entries = Object.entries(manifest.files);
  if (!entries.length || entries.length > 100 || entries.some(([p, hash]) => !allowedArtifact(safeRelative(p)) || !HASH.test(hash))) throw new Error('Artifact contains an unapproved path or hash.');
  for (const required of [...TOP, ...PUBLIC, ...ACORN]) if (!Object.hasOwn(manifest.files, required)) throw new Error(`Artifact missing required file: ${required}`);
  if (artifactDigest(manifest.files) !== manifest.digest || (expectedDigest && manifest.digest !== expectedDigest)) throw new Error('Artifact digest mismatch.');
  const directories = new Set();
  for (const [relative] of entries) { let parent = path.posix.dirname(relative); while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); } }
  if (JSON.stringify(filesBelow(root, '', directories)) !== JSON.stringify([...Object.keys(manifest.files), 'artifact.json'].sort())) throw new Error('Artifact contains missing or unknown files.');
  for (const [relative, hash] of entries) if (sha(read(root, relative)) !== hash) throw new Error(`Artifact hash mismatch: ${relative}`);
  const pkg = readJSON(root, 'package.json'), acorn = readJSON(root, 'node_modules/acorn/package.json'), lockfile = readJSON(root, 'package-lock.json');
  if (pkg.version !== manifest.version || pkg.dependencies?.acorn !== acorn.version || lockfile.packages?.['node_modules/acorn']?.version !== acorn.version) throw new Error('Runtime package, lockfile and Acorn versions do not match.');
  return { root, ...manifest };
}
function load(installDir) {
  const requested = path.resolve(installDir);
  if (fs.lstatSync(requested).isSymbolicLink()) throw new Error('Install directory must not be a symlink.');
  const dir = fs.realpathSync(requested);
  if (path.basename(dir) !== 'agent.mind') throw new Error('Install directory must be a real agent.mind directory.');
  const descriptor = readJSON(dir, 'project.json'), receipt = readJSON(dir, '.local/install.json');
  if (descriptor.schemaVersion !== 1 || descriptor.projectRoot !== '..' || !HASH.test(descriptor.runtime?.digest) || receipt.schemaVersion !== 1 || !UUID.test(receipt.installId) || !UUID.test(receipt.binding?.id) || !Number.isSafeInteger(receipt.binding?.generation) || receipt.binding.generation < 1 || !['attached', 'detached', 'attaching', 'detaching', 'uninstalling', 'uninstalled', 'rebinding', 'installing'].includes(receipt.state) || receipt.runtimeDigest !== descriptor.runtime.digest || !receipt.owned || Array.isArray(receipt.owned)) throw new Error('Invalid project.json or .local/install.json. Check the installation files.');
  for (const [relative, hash] of Object.entries(receipt.owned)) {
    safeRelative(relative);
    const prefix = `.local/runtime/${descriptor.runtime.digest}/`;
    if (!HASH.test(hash) || (!['cli.mjs', 'project.json', 'README.md', '.gitignore'].includes(relative) && !(relative.startsWith(prefix) && (allowedArtifact(relative.slice(prefix.length)) || relative.slice(prefix.length) === 'artifact.json')))) throw new Error('The installation file list in .local/install.json is invalid.');
  }
  for (const entry of receipt.recovery ?? []) {
    if (!entry || !/^\.local\/recovery\/[a-f0-9-]{36}-(?:AGENTS\.md|owned)$/.test(entry.path) || !['prepared', 'displaced', 'retained', 'not-moved', 'removed', 'conflict'].includes(entry.phase) || (entry.source !== 'AGENTS.md' && !Object.hasOwn(receipt.owned, entry.source))) throw new Error('The recovery record in .local/install.json is invalid.');
  }
  return { dir, descriptor, receipt };
}
function validateBinding(state, { requireAttached = true, verifyRuntime = true } = {}) {
  const { dir, descriptor, receipt } = state;
  const root = fs.realpathSync(path.join(dir, descriptor.projectRoot)), stat = fs.statSync(root), binding = receipt.binding;
  if (root !== binding.root || stat.dev !== binding.dev || stat.ino !== binding.ino) throw new Error('Project binding changed. Run rebind for this directory.');
  if (process.env.AGENT_MIND_PROJECT && fs.realpathSync(process.env.AGENT_MIND_PROJECT) !== root) throw new Error('AGENT_MIND_PROJECT conflicts with the installed binding.');
  if (requireAttached && receipt.state !== 'attached') throw new Error(`Installation is ${receipt.state}; attach before context or view.`);
  if (verifyRuntime) verifyArtifact(checked(dir, `.local/runtime/${descriptor.runtime.digest}`), descriptor.runtime.digest);
  return root;
}
export function resolveInstallation(installDir, options = {}) {
  const state = load(installDir), root = validateBinding(state, options);
  const binding = { ...state.receipt.binding, state: state.receipt.state, installId: state.receipt.installId, version: state.descriptor.runtime.version, digest: state.descriptor.runtime.digest };
  Object.defineProperty(binding, 'verify', { enumerable: false, value: () => {
    const latest = load(state.dir);
    validateBinding(latest, { ...options, verifyRuntime: false });
    if (latest.receipt.binding.id !== binding.id || latest.receipt.binding.generation !== binding.generation) throw new Error('Context binding has expired. Run context again.');
  } });
  return { root, binding, indexOptions: { generic: true, excludePaths: ['agent.mind'], metadataPath: 'agent.mind/project-map.json' }, runtime: checked(state.dir, `.local/runtime/${state.descriptor.runtime.digest}`) };
}
const save = state => writeAtomic(state.dir, '.local/install.json', json(state.receipt));
function lock(state, operation) {
  const lockPath = checked(state.dir, '.local/operation.lock', true);
  try { fs.writeFileSync(lockPath, json({ pid: process.pid }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = readJSON(state.dir, '.local/operation.lock');
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error('Invalid operation lock. Check .local/operation.lock before retrying.');
    try { process.kill(previous.pid, 0); throw new Error('Another installation operation is active.'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    fs.unlinkSync(lockPath);
    return lock(state, operation);
  }
  Object.assign(state, load(state.dir));
  try { return operation(); } finally { if (exists(lockPath)) fs.unlinkSync(lockPath); }
}
function assertNoView(state) {
  // A view lease is deliberately not removed using a PID guess. A crashed view
  // can be released by explicit `release-view --token <recorded token>`.
  if (exists(checked(state.dir, '.local/view.json', true))) throw new Error('A foreground view is recorded. Stop it first. If it crashed, use release-view with its recorded token.');
}
export const LAUNCHER = `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport { createHash } from 'node:crypto';\nimport { fileURLToPath, pathToFileURL } from 'node:url';\nconst dir = path.dirname(fileURLToPath(import.meta.url));\ntry {\n const p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));\n const r = JSON.parse(fs.readFileSync(path.join(dir, '.local/install.json'), 'utf8'));\n const digest = p.runtime?.digest;\n if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid runtime pin.');\n const relative = '.local/runtime/' + digest + '/installation.mjs';\n let current = dir;\n for (const part of relative.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Runtime symlink rejected.'); }\n const bytes = fs.readFileSync(current);\n if (createHash('sha256').update(bytes).digest('hex') !== r.owned?.[relative]) throw new Error('Runtime loader integrity mismatch.');\n const { runCLI } = await import(pathToFileURL(current));\n await runCLI(process.argv.slice(2), { installDir: dir });\n} catch (error) { console.error(error.message); process.exitCode = 1; }\n`;
function portableFiles(descriptor) { return { 'cli.mjs': LAUNCHER, 'project.json': json(descriptor), '.gitignore': '.local/\n', 'README.md': '# agent.mind in this project\n\nRun `node agent.mind/cli.mjs status`, `attach`, `context "selector"`, `view`, `detach`, or `uninstall` from the project root.\n\nproject-map.json is your map. Uninstall keeps it. Stop the foreground view before attach, detach, rebind or uninstall. After attach, reload the project instructions in the main coding agent and check that it loaded them.\n\nUninstall removes active files and saves the originals in .local/recovery. It also keeps your map, changed files and unknown files.\n\nFor permanent deletion, use the original release CLI: `purge-plan --install-dir /absolute/project/agent.mind`. Review the full file list and stop other programs from writing to those files. Then run `purge --install-dir /absolute/project/agent.mind --digest <exact plan digest>`.\n\nPurge is a separate command. It permanently deletes the listed data, including your files and saved originals. Other programs can still change files while it runs; purge does not lock them out.\n' }; }
export function installProject({ project, release, expectedDigest, adopt = false }) {
  if (!project || !path.isAbsolute(project)) throw new Error('Install requires an explicit absolute --project path.');
  const root = fs.realpathSync(project);
  if (fs.lstatSync(project).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Project must be a real directory, not a symlink.');
  const artifact = verifyArtifact(release, expectedDigest), dir = path.join(root, 'agent.mind');
  if (exists(dir)) {
    if (!exists(checked(dir, '.local', true))) {
      if (!adopt) throw new Error('This agent.mind directory has no local installation. To use a recognized portable clone, run install --adopt.');
      return adoptPortable(dir, root, artifact);
    }
    const state = load(dir);
    if (state.receipt.state === 'installing') {
      if (!adopt) throw new Error('Adoption did not finish. Run install --adopt again to resume.');
      return lock(state, () => materializePortable(state, artifact));
    }
    if (state.receipt.state === 'uninstalled') throw new Error('Uninstall is complete; preserved data remain. Review them, move the whole agent.mind directory aside, then install again.');
    validateBinding(state, { requireAttached: false });
    if (state.descriptor.runtime.digest !== artifact.digest) throw new Error('A different runtime is already installed. Replace it explicitly before installing this release.');
    return statusInstallation(dir);
  }
  const stage = path.join(root, `.agent-mind-stage-${randomUUID()}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  const stat = fs.statSync(root), runtimePrefix = `.local/runtime/${artifact.digest}`;
  const descriptor = { schemaVersion: 1, projectRoot: '..', runtime: { version: artifact.version, digest: artifact.digest } };
  const receipt = { schemaVersion: 1, installId: randomUUID(), state: 'detached', runtimeDigest: artifact.digest, binding: { id: randomUUID(), generation: 1, root, dev: stat.dev, ino: stat.ino }, owned: {}, agents: null };
  try {
    fs.mkdirSync(path.join(stage, runtimePrefix), { recursive: true });
    for (const relative of [...Object.keys(artifact.files), 'artifact.json']) {
      const destination = `${runtimePrefix}/${relative}`, bytes = read(artifact.root, relative);
      if (relative !== 'artifact.json' && sha(bytes) !== artifact.files[relative]) throw new Error('Release changed during installation.');
      fs.mkdirSync(path.dirname(path.join(stage, destination)), { recursive: true });
      fs.writeFileSync(path.join(stage, destination), bytes, { flag: 'wx' });
      receipt.owned[destination] = sha(bytes);
    }
    const generated = portableFiles(descriptor);
    for (const [relative, bytes] of Object.entries(generated)) { fs.writeFileSync(path.join(stage, relative), bytes, { flag: 'wx' }); receipt.owned[relative] = sha(bytes); }
    fs.writeFileSync(path.join(stage, 'project-map.json'), json({ schemaVersion: 1, blocks: [] }), { flag: 'wx' });
    fs.writeFileSync(path.join(stage, '.local/install.json'), json(receipt), { flag: 'wx', mode: 0o600 });
    verifyArtifact(path.join(stage, runtimePrefix), artifact.digest);
    if (exists(dir)) throw new Error('Install directory appeared during installation.');
    fs.renameSync(stage, dir);
    return statusInstallation(dir);
  } catch (error) {
    // Stage was created exclusively by this invocation and is never an existing install.
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
function portableReceipt(dir, root, artifact) {
  const descriptor = readJSON(dir, 'project.json');
  const expected = { schemaVersion: 1, projectRoot: '..', runtime: { version: artifact.version, digest: artifact.digest } };
  if (JSON.stringify(descriptor) !== JSON.stringify(expected)) throw new Error('project.json must pin this exact release.');
  const generated = portableFiles(expected), owned = {};
  for (const [relative, bytes] of Object.entries(generated)) {
    if (sha(read(dir, relative)) !== sha(bytes)) throw new Error(`Unrecognized portable file: ${relative}`);
    owned[relative] = sha(bytes);
  }
  read(dir, 'project-map.json'); // User-owned bytes are validated as a safe file, never rewritten.
  for (const relative of [...Object.keys(artifact.files), 'artifact.json']) owned[`.local/runtime/${artifact.digest}/${relative}`] = relative === 'artifact.json' ? sha(read(artifact.root, relative)) : artifact.files[relative];
  const stat = fs.statSync(root), text = readAgents(root);
  let installId = randomUUID(), agents = null;
  if (/<!-- agent\.mind:/.test(text)) {
    const matches = [...text.matchAll(/<!-- agent\.mind:([a-f0-9-]{36}):start -->/g)];
    if (matches.length !== 1 || !UUID.test(matches[0][1])) throw new Error('The portable AGENTS block does not match this release. Review it before adopting.');
    installId = matches[0][1]; const block = managedBlock(installId, text.includes('\r\n') ? '\r\n' : '\n');
    agents = { installId, block, prefix: '', existed: true, beforeHash: sha(text.replace(block, '')), afterHash: sha(text) };
    checkBlock(text, agents);
    if ((text.match(/<!-- agent\.mind:/g) ?? []).length !== 2) throw new Error('Found more than one portable AGENTS block. Resolve them before adopting.');
  }
  return { schemaVersion: 1, installId, state: 'installing', runtimeDigest: artifact.digest, binding: { id: randomUUID(), generation: 1, root, dev: stat.dev, ino: stat.ino }, owned, agents };
}
function materializePortable(state, artifact) {
  validateBinding(state, { requireAttached: false, verifyRuntime: false });
  if (state.descriptor.runtime.digest !== artifact.digest) throw new Error('This release does not match the runtime pinned in project.json.');
  // Revalidate all known portable bytes on resume; unknown files remain untouched.
  const expected = portableReceipt(state.dir, state.receipt.binding.root, artifact);
  if (JSON.stringify(expected.owned) !== JSON.stringify(state.receipt.owned)) throw new Error('The adoption file list does not match the verified release.');
  if (state.receipt.agents) checkBlock(readAgents(state.receipt.binding.root), state.receipt.agents);
  for (const relative of [...Object.keys(artifact.files), 'artifact.json']) {
    const destination = `.local/runtime/${artifact.digest}/${relative}`, bytes = read(artifact.root, relative), hash = state.receipt.owned[destination];
    if (sha(bytes) !== hash) throw new Error('Release changed during adoption.');
    const filename = checked(state.dir, destination, true);
    fs.mkdirSync(path.dirname(filename), { recursive: true }); checked(state.dir, destination, true);
    if (exists(filename)) { if (sha(read(state.dir, destination)) !== hash) throw new Error(`Adoption conflict preserved: ${destination}`); }
    else fs.writeFileSync(filename, bytes, { flag: 'wx' });
  }
  verifyArtifact(checked(state.dir, `.local/runtime/${artifact.digest}`), artifact.digest);
  state.receipt.state = 'detached'; save(state); return statusInstallation(state.dir);
}
function adoptPortable(dir, root, artifact) {
  if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== dir) throw new Error('Portable installation must be a real directory.');
  const receipt = portableReceipt(dir, root, artifact);
  // Exclusive creation reserves only our absent local state; no portable or owner
  // file is renamed or overwritten. The installing receipt supports safe resume.
  fs.mkdirSync(checked(dir, '.local', true), { mode: 0o700 });
  fs.writeFileSync(checked(dir, '.local/install.json', true), json(receipt), { flag: 'wx', mode: 0o600 });
  const state = load(dir);
  return lock(state, () => materializePortable(state, artifact));
}
// Move the actual inode before deciding its custody. Never overwrite a path
// another process recreated. AGENTS originals remain owner data, including writes
// through descriptors opened before the move.
function recoveryEntry(state, source, kind) {
  const directory = checked(state.dir, '.local/recovery', true);
  if (!exists(directory)) fs.mkdirSync(directory);
  checked(state.dir, '.local/recovery');
  const entry = { source, path: `.local/recovery/${randomUUID()}-${kind}`, phase: 'prepared' };
  (state.receipt.recovery ??= []).push(entry); save(state);
  return entry;
}
function restoreExclusive(state, root, entry) {
  const backup = checked(state.dir, entry.path);
  // A hardlink restores the same inode, preserving open writer descriptors.
  // link fails atomically if a concurrent writer already recreated the name.
  if (!fs.lstatSync(backup).isFile()) return false;
  try { fs.linkSync(backup, checked(root, entry.source, true)); return true; }
  catch (error) { if (error.code === 'EEXIST' || error.code === 'ENOENT') return false; throw error; }
}
function recoverPending(state, root) {
  for (const entry of state.receipt.recovery ?? []) {
    if (!['prepared', 'displaced'].includes(entry.phase)) continue;
    const custodyRoot = entry.source === 'AGENTS.md' ? root : state.dir;
    if (exists(checked(state.dir, entry.path, true))) {
      restoreExclusive(state, custodyRoot, entry);
      entry.phase = 'retained';
    } else entry.phase = 'not-moved';
  }
  save(state);
}
function displace(state, root, relative, expectedHash, kind) {
  const entry = recoveryEntry(state, relative, kind);
  const backup = checked(state.dir, entry.path, true);
  fs.renameSync(checked(root, relative), backup);
  entry.phase = 'displaced'; save(state);
  let actual;
  try { actual = sha(read(state.dir, entry.path)); }
  catch (error) { entry.phase = 'conflict'; save(state); throw new Error(`Could not verify the moved file. It is saved at ${backup}: ${error.message}`); }
  if (actual !== expectedHash) {
    restoreExclusive(state, root, entry); entry.phase = 'conflict'; save(state);
    throw new Error(`Concurrent owner change preserved at ${backup}. The original path is restored only if it is free.`);
  }
  return entry;
}
function replaceAgents(state, root, expectedText, nextText) {
  let entry;
  if (exists(checked(root, 'AGENTS.md', true))) entry = displace(state, root, 'AGENTS.md', sha(expectedText), 'AGENTS.md');
  else if (expectedText !== '') throw new Error('AGENTS.md disappeared before replacement.');
  try {
    if (nextText !== null) fs.writeFileSync(checked(root, 'AGENTS.md', true), nextText, { flag: 'wx', mode: 0o600 });
    if (entry) { entry.phase = 'retained'; save(state); }
  } catch (error) {
    if (entry) { restoreExclusive(state, root, entry); entry.phase = 'conflict'; save(state); }
    throw new Error(`Could not replace AGENTS.md. Your text is saved${entry ? ` at ${path.join(state.dir, entry.path)}` : ' in the AGENTS.md created by another process'}. ${error.message}`);
  }
}
function managedBlock(installId, eol) {
  return [`<!-- agent.mind:${installId}:start -->`, '## agent.mind source context', 'Before nontrivial source work, run `node agent.mind/cli.mjs status` and get current context.', 'Choose a name from the request (for example: "module C needs another test" -> "module C").', 'Run `node agent.mind/cli.mjs context "selector"`. If more than one part matches, use its stable ID or full breadcrumb. Read the selected implementation and relevant tests before editing.', 'Before an authorized action, run `node agent.mind/cli.mjs preflight "selector" --revision <returned revision> --binding-id <returned binding.id> --generation <returned binding.generation>` with the values from context. Compare source hashes too. After edits, get context again and run the relevant project tests.', 'The map reads supported source patterns and may be incomplete. Test imports do not show coverage or a test result. Security labels are not vulnerability findings. Ask for clarification if a name is missing or still matches more than one part.', 'The main coding agent must follow these steps; this file does not enforce them automatically. After attach or rebind, reload these instructions and check that the chat loaded them. Detached or expired bindings cannot return valid installed context.', `<!-- agent.mind:${installId}:end -->`, ''].join(eol);
}
function readAgents(root) { return exists(checked(root, 'AGENTS.md', true)) ? read(root, 'AGENTS.md', 1024 * 1024).toString('utf8') : ''; }
function checkBlock(text, agents) {
  const start = `<!-- agent.mind:${agents.installId}:start -->`, end = `<!-- agent.mind:${agents.installId}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2 || !text.includes(agents.block)) throw new Error('Managed AGENTS block changed or duplicated. Review it before retrying.');
}
export function attachInstallation(installDir) {
  const state = load(installDir);
  return lock(state, () => {
    const root = validateBinding(state, { requireAttached: false }); assertNoView(state); recoverPending(state, root);
    if (['uninstalling', 'installing'].includes(state.receipt.state)) throw new Error('Install or uninstall is in progress. Finish that operation first.');
    const text = readAgents(root);
    if (state.receipt.agents) {
      if (state.receipt.state === 'attaching' && sha(text) === state.receipt.agents.beforeHash) replaceAgents(state, root, text, text + state.receipt.agents.prefix + state.receipt.agents.block);
      checkBlock(readAgents(root), state.receipt.agents);
      state.receipt.state = 'attached'; save(state); return statusInstallation(installDir);
    }
    if (/<!-- agent\.mind:/.test(text)) throw new Error('Another or incomplete agent.mind AGENTS block exists. Review it before attaching.');
    const eol = text.includes('\r\n') ? '\r\n' : '\n', block = managedBlock(state.receipt.installId, eol);
    const prefix = text && !text.endsWith('\n') ? eol + eol : text ? eol : '';
    state.receipt.agents = { installId: state.receipt.installId, block, prefix, beforeHash: sha(text), afterHash: sha(text + prefix + block), existed: exists(checked(root, 'AGENTS.md', true)) };
    state.receipt.state = 'attaching'; save(state);
    if (sha(readAgents(root)) !== sha(text)) throw new Error('AGENTS.md changed during attach.');
    replaceAgents(state, root, text, text + prefix + block);
    state.receipt.state = 'attached'; save(state); return statusInstallation(installDir);
  });
}
function detach(state) {
  const root = validateBinding(state, { requireAttached: false, verifyRuntime: false }); assertNoView(state); recoverPending(state, root);
  const agents = state.receipt.agents;
  state.receipt.state = 'detaching'; state.receipt.binding.generation++; save(state);
  if (agents) {
    const text = readAgents(root);
    if (sha(text) !== agents.beforeHash) {
      checkBlock(text, agents);
      const next = sha(text) === agents.afterHash ? text.slice(0, -(agents.prefix + agents.block).length) : text.replace(agents.block, '');
      if (sha(readAgents(root)) !== sha(text)) throw new Error('AGENTS.md changed during detach.');
      replaceAgents(state, root, text, !agents.existed && next === '' ? null : next);
    }
  }
  state.receipt.agents = null; state.receipt.state = 'detached'; save(state);
}
export function detachInstallation(installDir) {
  const state = load(installDir);
  return lock(state, () => { detach(state); return statusInstallation(installDir); });
}
export function statusInstallation(installDir) {
  const state = load(installDir), conflicts = [];
  let root = null;
  try { root = validateBinding(state, { requireAttached: false, verifyRuntime: state.receipt.state !== 'uninstalled' }); } catch (error) { conflicts.push(error.message); }
  if (state.receipt.agents && root) try { checkBlock(readAgents(root), state.receipt.agents); } catch (error) { conflicts.push(error.message); }
  for (const [relative, hash] of Object.entries(state.receipt.owned).filter(([relative]) => state.receipt.state !== 'uninstalled' || exists(checked(state.dir, relative, true)))) try { if (sha(read(state.dir, relative)) !== hash) conflicts.push(`Installed file changed: ${relative}`); } catch (error) { conflicts.push(`Installed file is missing or unsafe: ${relative}`); }
  return { schemaVersion: 1, state: state.receipt.state, root: root ?? state.receipt.binding.root, binding: state.receipt.binding, runtime: state.descriptor.runtime, integrity: conflicts.length ? 'needs-attention' : 'verified', conflicts, recovery: state.receipt.recovery ?? [], instructionActivation: 'not-verified', instructionWarnings: root && exists(checked(root, 'AGENTS.override.md', true)) ? ['AGENTS.override.md in the project root may take precedence. Check which instructions the coding agent loaded.'] : [], view: exists(checked(state.dir, '.local/view.json', true)) ? readJSON(state.dir, '.local/view.json') : null };
}
export function rebindInstallation(installDir) {
  const state = load(installDir);
  return lock(state, () => {
    assertNoView(state);
    if (state.receipt.state === 'uninstalled') throw new Error('Cannot rebind an uninstalled runtime.');
    const root = fs.realpathSync(path.dirname(state.dir)), stat = fs.statSync(root);
    if (process.env.AGENT_MIND_PROJECT && fs.realpathSync(process.env.AGENT_MIND_PROJECT) !== root) throw new Error('AGENT_MIND_PROJECT conflicts with the new root.');
    verifyArtifact(checked(state.dir, `.local/runtime/${state.descriptor.runtime.digest}`), state.descriptor.runtime.digest);
    recoverPending(state, root);
    state.receipt.state = 'rebinding'; save(state);
    if (state.receipt.agents) {
      const text = readAgents(root), agents = state.receipt.agents;
      if (sha(text) !== agents.beforeHash) {
        checkBlock(text, agents);
        const next = sha(text) === agents.afterHash ? text.slice(0, -(agents.prefix + agents.block).length) : text.replace(agents.block, '');
        if (sha(readAgents(root)) !== sha(text)) throw new Error('AGENTS.md changed during rebind.');
        replaceAgents(state, root, text, !agents.existed && next === '' ? null : next);
      }
      state.receipt.agents = null;
    }
    state.receipt.state = 'detached';
    state.receipt.binding = { id: randomUUID(), generation: state.receipt.binding.generation + 1, root, dev: stat.dev, ino: stat.ino };
    save(state); return statusInstallation(installDir);
  });
}
export function uninstallInstallation(installDir) {
  const state = load(installDir);
  return lock(state, () => {
    detach(state); state.receipt.state = 'uninstalling'; save(state);
    const removed = [], preserved = [];
    // User-owned project-map.json is deliberately absent from this inventory.
    for (const [relative, hash] of Object.entries(state.receipt.owned)) {
      if (relative === 'project.json') continue;
      try {
        if (!exists(checked(state.dir, relative, true))) continue;
        if (sha(read(state.dir, relative)) !== hash) { preserved.push(relative); continue; }
        const entry = displace(state, state.dir, relative, hash, 'owned');
        // Retain the displaced inode until the separate, explicit purge. A writer
        // may still hold a descriptor opened before this move.
        entry.phase = 'retained'; save(state); removed.push(relative);
      } catch { preserved.push(relative); }
    }
    // Retain descriptor and receipt for inspection/retry via the original release CLI.
    pruneEmpty(state.dir, Object.keys(state.receipt.owned));
    const remaining = listRemaining(state.dir).filter(p => !['.local/install.json', '.local/operation.lock'].includes(p));
    state.receipt.state = 'uninstalled'; state.receipt.uninstalled = true; state.receipt.remnants = remaining; save(state);
    return { state: 'uninstalled', removed, preserved: remaining, receipt: path.join(state.dir, '.local/install.json'), note: 'Active files removed. The originals, your map, and changed or unknown files are kept. For permanent deletion, use purge-plan from the original release CLI, review the full file list, then use purge --digest.' };
  });
}
function fileFingerprint(root, relative) {
  const filename = checked(root, relative), fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd), current = fs.lstatSync(filename);
    if (!before.isFile() || current.dev !== before.dev || current.ino !== before.ino) throw new Error(`Unsafe purge file: ${relative}`);
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024); let count;
    while ((count = fs.readSync(fd, buffer))) hash.update(buffer.subarray(0, count));
    const after = fs.fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`File changed during purge inventory: ${relative}`);
    return { kind: 'file', hash: hash.digest('hex'), bytes: before.size, dev: before.dev, ino: before.ino };
  } finally { fs.closeSync(fd); }
}
function purgeInventory(root, prefix = '', budget = { count: 0, depth: 0 }) {
  if (budget.depth > 30) throw new Error('Purge stopped: the directory tree is too deep.');
  const entries = [];
  for (const item of fs.readdirSync(prefix ? checked(root, prefix) : root, { withFileTypes: true })) {
    if (++budget.count > 10000) throw new Error('Purge stopped: the file list is too large.');
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const filename = checked(root, relative), stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: 'directory', dev: stat.dev, ino: stat.ino });
      budget.depth++; entries.push(...purgeInventory(root, relative, budget)); budget.depth--;
    } else entries.push({ path: relative, ...fileFingerprint(root, relative) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function purgePlan(installDir) {
  const state = load(installDir);
  if (state.receipt.state !== 'uninstalled') throw new Error('Run uninstall before purge; its local record must still exist.');
  const root = validateBinding(state, { requireAttached: false, verifyRuntime: false }); assertNoView(state);
  if (exists(checked(state.dir, '.local/operation.lock', true))) throw new Error('An installation operation lock exists. Finish or resolve that operation before purge.');
  const stat = fs.statSync(state.dir), parent = fs.statSync(root);
  const plan = { schemaVersion: 1, installDir: state.dir, rootIdentity: { dev: stat.dev, ino: stat.ino, projectRoot: root, projectDev: parent.dev, projectIno: parent.ino, bindingId: state.receipt.binding.id, generation: state.receipt.binding.generation }, entries: purgeInventory(state.dir) };
  return { ...plan, digest: sha(JSON.stringify(plan)), warning: 'This list includes your data and saved originals. Purge deletes them permanently. Stop other programs from writing to these files before running it.' };
}
export function purgeInstallation(installDir, expectedDigest) {
  if (!HASH.test(expectedDigest ?? '')) throw new Error('Purge requires the digest from the exact purge-plan you reviewed.');
  const plan = purgePlan(installDir);
  if (plan.digest !== expectedDigest) throw new Error('Purge inventory or root identity changed. Run purge-plan again and review it before deleting files.');
  const controls = new Set(['project.json', '.local/install.json']);
  const controlBytes = new Map(plan.entries.filter(entry => controls.has(entry.path)).map(entry => {
    const bytes = read(plan.installDir, entry.path);
    if (sha(bytes) !== entry.hash) throw new Error('Purge control record changed. Run purge-plan again.');
    return [entry.path, bytes];
  }));
  const root = plan.installDir, workspaceRelative = `.purge-${randomUUID()}`, workspace = checked(root, workspaceRelative, true);
  fs.mkdirSync(workspace, { mode: 0o700 });
  let workspaceIdentity = fs.lstatSync(workspace);
  const removed = [], conflicts = [], stagedControls = [];
  const assertRoot = () => {
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || stat.dev !== plan.rootIdentity.dev || stat.ino !== plan.rootIdentity.ino || fs.realpathSync(root) !== root) throw new Error('Install directory identity changed; cleanup stopped.');
  };
  const removeFile = (entry, retainControl = false) => {
    const destination = `${workspaceRelative}/${randomUUID()}`;
    try {
      assertRoot();
      // This move takes custody of the actual current inode, not the previously
      // checked pathname. A replacement is preserved instead of blindly unlinked.
      const current = fileFingerprint(root, entry.path);
      if (JSON.stringify(current) !== JSON.stringify({ kind: entry.kind, hash: entry.hash, bytes: entry.bytes, dev: entry.dev, ino: entry.ino })) throw new Error('File identity or content changed.');
      fs.renameSync(checked(root, entry.path), checked(root, destination, true));
      if (retainControl) stagedControls.push({ path: entry.path, destination });
      const displaced = fileFingerprint(root, destination);
      if (displaced.hash !== entry.hash || displaced.dev !== entry.dev || displaced.ino !== entry.ino || displaced.bytes !== entry.bytes) {
        try { fs.linkSync(checked(root, destination), checked(root, entry.path, true)); } catch {}
        throw new Error(`The file changed during purge. Its replacement is saved at ${destination}.`);
      }
      if (!retainControl) { fs.unlinkSync(checked(root, destination)); removed.push(entry.path); }
    } catch (error) { conflicts.push({ path: entry.path, error: error.message }); }
  };
  for (const entry of plan.entries.filter(item => item.kind === 'file' && !controls.has(item.path))) removeFile(entry);
  // Keep the tombstone usable after any conflict. Unexpected additions are never
  // inferred to belong to the reviewed inventory and prevent control deletion.
  try {
    assertRoot();
    const allowedRemainder = new Set([workspaceRelative + '/', ...controls, ...plan.entries.filter(item => item.kind === 'directory').map(item => item.path + '/')]);
    for (const relative of listRemaining(root)) if (!allowedRemainder.has(relative)) conflicts.push({ path: relative, error: 'Unexpected or changed file remains. Local installation records kept for another purge-plan.' });
    if (!conflicts.length) for (const entry of plan.entries.filter(item => item.kind === 'file' && controls.has(item.path)).sort((a, b) => a.path === '.local/install.json' ? 1 : b.path === '.local/install.json' ? -1 : 0)) {
      if (conflicts.length) break;
      removeFile(entry, true);
    }
    if (stagedControls.length) {
      const expected = new Set([...plan.entries.filter(item => item.kind === 'directory').map(item => item.path + '/'), ...stagedControls.map(item => item.destination)]);
      for (const relative of listRemaining(root)) if (!expected.has(relative)) conflicts.push({ path: relative, error: 'Unexpected file remains. Local installation records kept for another purge-plan.' });
    }
  } catch (error) { conflicts.push({ path: '.', error: error.message }); }
  // Only directories from the reviewed inventory and our own staging directory
  // are removed, individually and only when empty.
  for (const entry of plan.entries.filter(item => item.kind === 'directory').sort((a, b) => b.path.length - a.path.length)) {
    try {
      assertRoot(); const filename = checked(root, entry.path), stat = fs.lstatSync(filename);
      if (!stat.isDirectory() || stat.dev !== entry.dev || stat.ino !== entry.ino) throw new Error('Directory identity changed.');
      fs.rmdirSync(filename); removed.push(`${entry.path}/`);
    } catch (error) { conflicts.push({ path: entry.path, error: error.message }); }
  }
  let remainder;
  try {
    assertRoot();
    if (!conflicts.length) {
      const expected = new Set(stagedControls.map(control => control.destination));
      if (listRemaining(root).some(relative => !expected.has(relative))) throw new Error('Unexpected files remain; local installation records kept.');
      for (const control of stagedControls) {
        const original = plan.entries.find(entry => entry.path === control.path), current = fileFingerprint(root, control.destination);
        if (current.hash !== original.hash || current.dev !== original.dev || current.ino !== original.ino) throw new Error('Purge control record changed; cleanup stopped.');
      }
      for (const control of stagedControls) { fs.unlinkSync(checked(root, control.destination)); removed.push(control.path); }
      fs.rmdirSync(workspace);
    }
    remainder = listRemaining(root);
    if (!remainder.length) { try { fs.rmdirSync(root); } catch (error) { conflicts.push({ path: '.', error: error.message }); remainder = listRemaining(root); } }
  } catch (error) { conflicts.push({ path: '.', error: error.message }); remainder = ['The installation directory changed or is unavailable. Check it before further cleanup.']; }
  // Directory removal can still fail after the last control link was removed.
  // Recover caught failures in the same root, never overwrite a recreated path.
  // The snapshots are process-local: this is not a crash/power-loss transaction.
  if (exists(root)) {
    let restoredLocal = false;
    for (const [relative, bytes] of controlBytes) try {
      assertRoot();
      const target = checked(root, relative, true);
      const recreated = exists(target);
      if (recreated && !removed.includes(relative)) continue;
      let backup = stagedControls.find(control => control.path === relative)?.destination;
      if (!backup || !exists(checked(root, backup, true))) {
        if (!exists(workspace)) { fs.mkdirSync(checked(root, workspaceRelative, true), { mode: 0o700 }); workspaceIdentity = fs.lstatSync(workspace); }
        const stat = fs.lstatSync(checked(root, workspaceRelative));
        if (!stat.isDirectory() || stat.dev !== workspaceIdentity.dev || stat.ino !== workspaceIdentity.ino) throw new Error('Purge recovery directory changed.');
        backup = `${workspaceRelative}/${randomUUID()}`;
        fs.writeFileSync(checked(root, backup, true), bytes, { flag: 'wx', mode: 0o600 });
      }
      if (recreated) throw new Error(`The path was recreated; original record retained at ${backup}.`);
      if (relative.startsWith('.local/')) {
        const local = checked(root, '.local', true), original = plan.entries.find(entry => entry.path === '.local');
        if (!exists(local)) { fs.mkdirSync(local, { mode: 0o700 }); restoredLocal = true; }
        const stat = fs.lstatSync(local);
        if (!stat.isDirectory() || !restoredLocal && (stat.dev !== original.dev || stat.ino !== original.ino)) throw new Error(`Local directory changed; control record retained at ${backup}.`);
      }
      fs.linkSync(checked(root, backup), checked(root, relative, true));
      const index = removed.indexOf(relative); if (index !== -1) removed.splice(index, 1);
      if (restoredLocal) { const index = removed.indexOf('.local/'); if (index !== -1) removed.splice(index, 1); }
    } catch (error) { conflicts.push({ path: relative, error: `Could not restore purge record without overwriting: ${error.message}` }); }
    try { assertRoot(); remainder = listRemaining(root); } catch {}
  }
  return { state: exists(root) ? 'purge-incomplete' : 'purged', digest: plan.digest, removed, conflicts, remainder };
}
function pruneEmpty(root, ownedPaths) {
  const directories = new Set();
  for (const relative of ownedPaths) { let parent = path.posix.dirname(relative); while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); } }
  for (const relative of [...directories].sort((a, b) => b.length - a.length)) {
    try { const directory = checked(root, relative); if (fs.lstatSync(directory).isDirectory() && !fs.readdirSync(directory).length) fs.rmdirSync(directory); } catch {}
  }
}
function listRemaining(root, prefix = '') {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Symbolic root rejected.');
  const result = [];
  for (const item of fs.readdirSync(prefix ? checked(root, prefix) : root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) { const children = listRemaining(root, relative); if (children.length) result.push(...children); else result.push(`${relative}/`); } else result.push(relative);
  }
  return result.sort();
}
export async function runCLI(args = process.argv.slice(2), { installDir } = {}) {
  const argv = [...args], command = argv.shift();
  const option = name => { const i = argv.indexOf(name); if (i < 0) return undefined; const value = argv[i + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing ${name} value.`); argv.splice(i, 2); return value; };
  const emit = value => console.log(json(value).trimEnd());
  if (command === 'install') {
    const attachIndex = argv.indexOf('--attach'), attach = attachIndex >= 0; if (attach) argv.splice(attachIndex, 1);
    const adoptIndex = argv.indexOf('--adopt'), adopt = adoptIndex >= 0; if (adopt) argv.splice(adoptIndex, 1);
    const project = option('--project'), release = option('--release'), expectedDigest = option('--digest');
    if (!release || argv.length) throw new Error('Usage: install --project /absolute/project --release /verified/release [--digest SHA256] [--attach] [--adopt]');
    const installed = installProject({ project, release, expectedDigest, adopt });
    return emit(attach ? attachInstallation(path.join(installed.root, 'agent.mind')) : installed);
  }
  installDir ??= option('--install-dir');
  if (!installDir) throw new Error('Use the installed agent.mind/cli.mjs or an explicit --install-dir.');
  if (['status', 'attach', 'detach', 'uninstall', 'rebind'].includes(command)) {
    if (argv.length) throw new Error('Unexpected argument.');
    return emit(({ status: statusInstallation, attach: attachInstallation, detach: detachInstallation, uninstall: uninstallInstallation, rebind: rebindInstallation })[command](installDir));
  }
  if (command === 'release-view') {
    const token = option('--token'); if (argv.length || !UUID.test(token ?? '')) throw new Error('release-view requires the exact recorded --token.');
    const state = load(installDir);
    return lock(state, () => { const lease = readJSON(state.dir, '.local/view.json'); if (lease.token !== token) throw new Error('View token mismatch.'); try { process.kill(lease.pid, 0); throw new Error('View process is still alive. Stop it before releasing its token.'); } catch (error) { if (error.code !== 'ESRCH') throw error; } fs.unlinkSync(checked(state.dir, '.local/view.json')); emit({ state: 'released' }); });
  }
  if (command === 'purge-plan') { if (argv.length) throw new Error('Unexpected argument.'); return emit(purgePlan(installDir)); }
  if (command === 'purge') { const digest = option('--digest'); if (argv.length || !HASH.test(digest ?? '')) throw new Error('Purge requires --digest from the exact purge-plan you reviewed.'); const result = purgeInstallation(installDir, digest); emit(result); if (result.state !== 'purged') process.exitCode = 1; return; }
  const resolved = resolveInstallation(installDir);
  if (command === 'context' || command === 'preflight') {
    const revision = option('--revision'), bindingId = option('--binding-id'), generation = option('--generation');
    if (argv.length > 1) throw new Error('Pass one exact selector.');
    if (command === 'preflight') {
      if (argv.length !== 1 || !argv[0].trim() || argv[0].startsWith('--') || !revision || !bindingId || !generation) throw new Error('Preflight requires one exact selector and --revision, --binding-id, --generation from the context output.');
      if (!HASH.test(revision) || !UUID.test(bindingId) || !/^[1-9][0-9]*$/.test(generation) || !Number.isSafeInteger(Number(generation))) throw new Error('Invalid preflight values. Use the revision, binding ID and generation returned by context.');
    }
    const { freshContext } = await import(pathToFileURL(path.join(resolved.runtime, 'graph-context.mjs')));
    const context = freshContext(resolved.root, argv[0], resolved.indexOptions);
    resolved.binding.verify();
    if (command === 'preflight' && context.status !== 'current') throw new Error(`Preflight requires current context; project index is ${context.status}. Check the context diagnostics before acting.`);
    if (revision && revision !== context.revision) throw new Error('Project revision changed. Run context again.');
    if (bindingId && bindingId !== resolved.binding.id || generation && Number(generation) !== resolved.binding.generation) throw new Error('Context binding has expired. Run context again.');
    return emit({ ...context, binding: resolved.binding, preflight: command === 'preflight' ? 'verified-at-read' : undefined });
  }
  if (command === 'view') {
    const port = option('--port') ?? '0'; if (argv.length || !/^\d+$/.test(port) || Number(port) > 65535) throw new Error('Invalid view port.');
    const state = load(installDir), token = randomUUID();
    lock(state, () => { resolved.binding.verify(); assertNoView(state); fs.writeFileSync(checked(state.dir, '.local/view.json', true), json({ token, pid: process.pid, bindingId: resolved.binding.id, generation: resolved.binding.generation }), { flag: 'wx', mode: 0o600 }); });
    const release = () => { try { if (readJSON(state.dir, '.local/view.json').token === token) fs.unlinkSync(checked(state.dir, '.local/view.json')); } catch {} };
    try {
      const { createVisualizer } = await import(pathToFileURL(path.join(resolved.runtime, 'server.mjs')));
      const app = createVisualizer({ root: resolved.root, indexOptions: resolved.indexOptions, binding: resolved.binding });
      const close = () => { app.close(); release(); };
      app.server.once('close', release);
      app.server.once('error', error => { console.error(error.message); app.live.close(); release(); process.exitCode = 1; });
      process.once('SIGINT', close); process.once('SIGTERM', close);
      app.server.listen(Number(port), '127.0.0.1', () => emit({ url: `http://127.0.0.1:${app.server.address().port}`, root: resolved.root, binding: resolved.binding, viewToken: token }));
    } catch (error) { release(); throw error; }
    return;
  }
  throw new Error('Commands: install, status, attach, context, preflight, view, detach, uninstall, rebind, release-view, purge-plan, purge.');
}
