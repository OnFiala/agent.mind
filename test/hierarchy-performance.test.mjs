import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A separate process is essential: a timer in the blocked indexer's event loop
// cannot enforce a deadline. This is a regression bound, not a supported-size SLA.
for (const shape of ['flat', 'calls']) test(`dense ${shape} hierarchy, name resolution and scope finish within an external deadline`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-dense-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = 20, perFile = 1000;
  for (let i = 0; i < files; i++) {
    const source = Array.from({ length: perFile }, (_, j) => `function f${j}(){${shape === 'calls' && j ? `f${j - 1}();` : ''}}`).join('\n');
    fs.writeFileSync(path.join(root, `f${i}.mjs`), source);
  }
  const source = `
    import assert from 'node:assert/strict';
    import { LiveIndex } from ${JSON.stringify(new URL('../live-index.mjs', import.meta.url).href)};
    import { resolvePart } from ${JSON.stringify(new URL('../project-map.mjs', import.meta.url).href)};
    import { scopeGraph } from ${JSON.stringify(new URL('../public/hierarchy.mjs', import.meta.url).href)};
    const live = new LiveIndex(process.argv[1], { intervalMs: 60000 });
    try {
      const graph = live.graph;
      assert.equal(graph.status, 'current');
      assert.equal(graph.stats.files, ${files});
      assert.equal(graph.symbolGraph.nodes.length, ${files * perFile});
      assert.equal(graph.symbolGraph.edges.length, ${shape === 'calls' ? files * (perFile - 1) : 0});
      const leaf = graph.hierarchy.nodes.find(n => n.id === 'symbol:f0.mjs#f999');
      assert.equal(resolvePart(graph.hierarchy, leaf.qualifiedLabel).id, leaf.id);
      assert.equal(resolvePart(graph.hierarchy, 'not present / nonexistent'), null);
      const scope = scopeGraph(graph, 'file:f0.mjs');
      assert.equal(scope.nodes.filter(n => n.kind === 'symbol').length, ${perFile});
      assert.equal(scope.edges.length, ${shape === 'calls' ? perFile - 1 : 0});
      assert.equal(new Set(scope.edges.flatMap(e => e.sourceEdgeIds)).size, ${shape === 'calls' ? perFile - 1 : 0});
      live.refresh();
      assert.equal(live.graph.revision, graph.revision);
      assert.deepEqual(live.graph.hierarchy, graph.hierarchy);
    } finally { live.close(); }
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', source, root], { encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
