// Developer-only measurement over a hash-pinned corpus. No source is executed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const sha = value => createHash('sha256').update(value).digest('hex');
async function measure(runtime, corpusRoot, receiptFile) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  assert(receipt.files.length > 0 && receipt.files.length <= 100);
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-py-measure-')));
  let live;
  try {
    let total = 0;
    for (const file of receipt.files) {
      assert(!path.isAbsolute(file.path) && !file.path.split('/').some(part => !part || part === '..' || part === '.') && file.path.endsWith('.py'));
      const bytes = fs.readFileSync(path.join(corpusRoot, file.path));
      assert.equal(sha(bytes), file.sha256, file.path);
      assert.equal(bytes.length, file.bytes);
      assert(bytes.length <= 65536);
      total += bytes.length;
      const output = path.join(fixture, file.path);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, bytes);
    }
    assert(total <= 512 * 1024);
    const baselineRSS = process.memoryUsage().rss;
    const loadStart = performance.now();
    const { indexProject } = await import(pathToFileURL(path.join(runtime, 'code-index.mjs')));
    const { LiveIndex } = await import(pathToFileURL(path.join(runtime, 'live-index.mjs')));
    const loadedMs = performance.now() - loadStart;
    const start = performance.now();
    const cold = indexProject(fixture, { generic: true });
    const coldMs = performance.now() - start;
    const warmStart = performance.now();
    const warm = indexProject(fixture, { generic: true, previous: cold });
    const unchangedMs = performance.now() - warmStart;
    assert.equal(cold.inventory.status, 'complete');
    assert.equal(cold.stats.files, receipt.files.length);
    assert.equal(warm.stats.cachedFiles, receipt.files.length);
    assert(['current', 'partial'].includes(cold.status));
    // The original declaration pilot and later source analyzer share this
    // input-hash/performance harness; capability evidence is recorded explicitly.
    const first = receipt.files.find(file => file.path === 'src/flask/views.py') ?? receipt.files[0];
    const filePath = path.join(fixture, first.path);
    const source = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, '# measured edit\n' + source);
    const updateStart = performance.now();
    const update = indexProject(fixture, { generic: true, previous: warm });
    const updateMs = performance.now() - updateStart;
    assert.equal(update.stats.cachedFiles, receipt.files.length - 1);
    assert.notEqual(update.revision, cold.revision);
    live = new LiveIndex(fixture, { intervalMs: 60000, indexOptions: { generic: true } });
    const liveUpdateMs = [];
    for (let index = 0; index < 3; index++) {
      fs.writeFileSync(filePath, `# live edit ${index}\n` + source);
      const before = performance.now();
      live.refresh();
      liveUpdateMs.push(performance.now() - before);
    }
    const peakRSS = process.resourceUsage().maxRSS * 1024;
    const failures = cold.diagnostics.filter(d => /parse error|limit reached|analysis limit/i.test(d.message));
    const result = { corpus: { repository: receipt.repository, commit: receipt.commit, files: receipt.files.length, bytes: total, digest: sha(JSON.stringify(receipt.files)), omitted: receipt.omitted }, loadedMs, coldMs, unchangedMs, updateMs, liveUpdateMs, baselineRSS, peakRSS, increaseRSS: peakRSS - baselineRSS, status: cold.status, sourceEdges: cold.edges.length, callEdges: cold.symbolGraph.edges.length, symbols: cold.symbolGraph.nodes.length, diagnostics: cold.diagnostics.length, failures, ambiguities: cold.diagnostics.filter(d => /Ambiguous declaration/.test(d.message)) };
    assert(coldMs <= 1000 && unchangedMs <= 100 && updateMs <= 200 && Math.max(...liveUpdateMs) <= 200, JSON.stringify(result));
    assert(peakRSS <= 256 * 1024 * 1024 && result.increaseRSS <= 160 * 1024 * 1024, JSON.stringify(result));
    return result;
  } finally {
    live?.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  console.log(JSON.stringify(await measure(...args.slice(1))));
} else {
  if (args.length !== 3 || args.some(arg => !path.isAbsolute(arg))) throw new Error('Usage: node scripts/measure-python-pilot.mjs /absolute/runtime /absolute/corpus /absolute/receipt.json');
  const runs = [];
  for (let index = 0; index < 3; index++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
    runs.push(JSON.parse(result.stdout));
  }
  console.log(JSON.stringify({ host: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, os: os.release() }, runs }, null, 2));
}
