// Reproducible source-only measurement input. Never imports/executes its files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { indexProject } from '../code-index.mjs';
import { projectContext } from '../graph-context.mjs';

export const FIXTURE_VERSION = 1;
export const REPOSITORY_BASE = 'e20f43ef7b9d182ae0937fa2b587d9b8584c0bc7';
export const FIXTURE_SELECTOR = 'src/m10.mjs';
export function chainInputs() {
  return Array.from({ length: 1000 }, (_, index) => ({
    path: `src/m${index}.mjs`,
    text: `${index < 999 ? `import './m${index + 1}.mjs';\n` : ''}${Array.from({ length: 5 }, (_, fn) => `export function f${fn}() { return ${index * 5 + fn}; }\n`).join('')}`
  }));
}
export function fixtureIdentity() {
  const files = chainInputs().map(({ path, text }) => ({ path, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }));
  return { version: FIXTURE_VERSION, selector: FIXTURE_SELECTOR, files: files.length, functionsPerFile: 5, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}
export function writeChainFixture(root) {
  if (fs.readdirSync(root).length) throw new Error('Fixture destination must be an empty directory.');
  for (const { path: relative, text } of chainInputs()) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text, { flag: 'wx' });
  }
  return fixtureIdentity();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--repository') throw new Error('Usage: node scripts/bounded-context-fixture-v1.mjs --repository /path/to/pinned-repository');
  const repository = fs.realpathSync(args[1]);
  const head = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== REPOSITORY_BASE || execFileSync('git', ['-C', repository, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim()) throw new Error(`Repository measurement requires a clean ${REPOSITORY_BASE} snapshot.`);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-context-v1-')));
  try {
    const identity = writeChainFixture(root);
    const measurement = (project, selector, options, maxBytes) => {
      const graph = indexProject(project, options);
      const full = projectContext(graph, selector);
      const agent = projectContext(graph, selector, { profile: 'agent', version: 1, maxBytes });
      if (agent.error) throw new Error(`Mandatory context does not fit: ${JSON.stringify(agent.error)}`);
      return { selector, revision: full.revision, status: full.status, legacyBytes: Buffer.byteLength(JSON.stringify(full)), agentBytes: Buffer.byteLength(JSON.stringify(agent)), maxBytes };
    };
    console.log(JSON.stringify({ fixture: identity, repository: { head, selector: 'server.mjs' }, serialization: 'UTF-8 JSON.stringify(response), no indentation or newline', measurements: { chain: measurement(root, FIXTURE_SELECTOR, { generic: true }, 10000), repository: measurement(repository, 'server.mjs', {}, 20000) } }, null, 2));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
