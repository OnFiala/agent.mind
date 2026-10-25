import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { indexProject } from './code-index.mjs';
import { attachOverview } from './project-map.mjs';

// Polling is intentional: editor renames and missed filesystem events reconcile too.
// Parsing is cached by content; the inventory and hashes are rechecked every scan.
export class LiveIndex extends EventEmitter {
  constructor(root, { intervalMs = 900, indexer = indexProject, indexOptions = {} } = {}) {
    super();
    this.root = root;
    this.indexer = indexer;
    this.indexOptions = structuredClone(indexOptions);
    this.sequence = 0;
    this.instanceId = randomUUID();
    this.changes = [];
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.timer.unref();
  }

  refresh() {
    const old = this.graph;
    try {
      let candidate = this.indexer(this.root, { ...this.indexOptions, previous: old });
      let verified = this.indexer(this.root, { ...this.indexOptions, previous: candidate });
      if (candidate.revision !== verified.revision) {
        candidate = verified;
        verified = this.indexer(this.root, { ...this.indexOptions, previous: candidate });
        if (candidate.revision !== verified.revision) throw new Error('Files changed while the map was reading them. Waiting for two scans to agree.');
      }
      if (verified.project && verified.diagnostics) attachOverview(verified);
      const changed = !old || old.revision !== verified.revision || old.status !== verified.status;
      const recovered = this.runtime?.status === 'error';
      if (changed) {
        const before = new Map((old?.nodes ?? []).filter(n => n.path).map(n => [n.path, n.hash]));
        const after = new Map(verified.nodes.filter(n => n.path).map(n => [n.path, n.hash]));
        const at = new Date().toISOString();
        if (old) this.changes = [
          ...[...after].filter(([p, hash]) => before.get(p) !== hash).map(([path]) => ({ path, kind: before.has(path) ? 'changed' : 'added', at })),
          ...[...before.keys()].filter(p => !after.has(p)).map(path => ({ path, kind: 'deleted', at })),
          ...this.changes
        ].slice(0, 30);
        this.sequence++;
      }
      this.graph = verified;
      this.runtime = { instanceId: this.instanceId, status: 'current', lastCheckedAt: new Date().toISOString(), error: null, sequence: this.sequence, changes: this.changes };
      if (changed || recovered) this.emit('state', this.snapshot());
    } catch (error) {
      this.runtime = { instanceId: this.instanceId, status: 'error', lastCheckedAt: new Date().toISOString(), error: error.message, sequence: this.sequence, changes: this.changes };
      if (old) this.emit('state', this.snapshot());
      else throw error;
    }
    return this.snapshot();
  }

  snapshot() { return { ...this.graph, runtime: this.runtime }; }
  close() { clearInterval(this.timer); this.removeAllListeners(); }
}
