import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { indexProject, inspectInputPolicy, emptyPolicyGraph, inspectResolverConfiguration, emptyResolverGraph } from './code-index.mjs';
import { attachOverview } from './project-map.mjs';

// Parsing is cached by content; inventory, policy and hashes are checked each scan.
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

  // Invalidate before attempting any replacement scan. Errors may never fall back
  // to the last good source graph after an observed policy change.
  invalidatePolicy(policy) {
    if (!this.graph || !policy || (policy.status === 'valid' && this.graph.inputPolicy?.id === policy.id)) return false;
    if (this.graph.inputPolicy?.status === 'invalid' && this.graph.inputPolicy.id === policy.id && !this.graph.nodes.length) return false;
    this.graph = attachOverview(emptyPolicyGraph(this.root, policy));
    this.changes = [];
    this.sequence++;
    this.runtime = { instanceId: this.instanceId, status: 'error', inventoryFreshness: 'stale', lastCheckedAt: new Date().toISOString(), error: 'Input policy changed or is unavailable; waiting for a fresh index.', sequence: this.sequence, changes: [] };
    this.emit('state', this.snapshot());
    return true;
  }

  checkPolicy() {
    // Test indexers without policy support retain their existing error behavior.
    if (!this.graph || (!this.graph.inputPolicy && this.indexer !== indexProject)) return false;
    try { return this.invalidatePolicy(inspectInputPolicy(this.root, this.indexOptions)); }
    catch { return this.invalidatePolicy({ id: null, status: 'invalid', version: 1, reason: 'unavailable' }); }
  }

  invalidateResolver(resolver) {
    if (!this.graph || !resolver || (resolver.status === 'valid' && this.graph.resolver?.id === resolver.id)) return false;
    if (this.graph.resolver?.id === resolver.id && !this.graph.nodes.length) return false;
    const { bytesRead, ...identity } = resolver;
    this.graph = attachOverview(emptyResolverGraph(this.graph, identity));
    this.changes = [];
    this.sequence++;
    this.runtime = { instanceId: this.instanceId, status: 'error', inventoryFreshness: 'stale', lastCheckedAt: new Date().toISOString(), error: 'Resolver configuration changed or is unavailable; waiting for a fresh index.', sequence: this.sequence, changes: [] };
    this.emit('state', this.snapshot());
    return true;
  }

  checkResolver() {
    if (!this.graph || !this.indexOptions.resolver) return false;
    try { return this.invalidateResolver(inspectResolverConfiguration(this.root, this.indexOptions)); }
    catch {
      return this.invalidateResolver({ ...this.graph.resolver, id: null, status: 'invalid', reason: 'config-unavailable', configPath: this.indexOptions.resolverConfig });
    }
  }

  checkInputs() {
    const policyChanged = this.checkPolicy();
    const resolverChanged = this.checkResolver();
    return policyChanged || resolverChanged;
  }

  refresh() {
    this.checkInputs();
    const old = this.graph;
    try {
      let candidate = this.indexer(this.root, { ...this.indexOptions, previous: old });
      this.invalidatePolicy(candidate.inputPolicy);
      this.invalidateResolver(candidate.resolver);
      let verified = this.indexer(this.root, { ...this.indexOptions, previous: candidate });
      this.invalidatePolicy(verified.inputPolicy);
      this.invalidateResolver(verified.resolver);
      if (candidate.revision !== verified.revision) {
        candidate = verified;
        verified = this.indexer(this.root, { ...this.indexOptions, previous: candidate });
        this.invalidatePolicy(verified.inputPolicy);
      this.invalidateResolver(verified.resolver);
        if (candidate.revision !== verified.revision) throw new Error('Files changed while the map was reading them. Waiting for two scans to agree.');
      }
      // The final observation covers a policy edit after the indexer's own check.
      if (verified.inputPolicy) {
        const current = inspectInputPolicy(this.root, this.indexOptions);
        if (current.id !== verified.inputPolicy.id || current.status !== verified.inputPolicy.status) {
          this.invalidatePolicy(current);
          throw new Error('Input policy changed while the map was reading it.');
        }
      }
      if (verified.resolver?.status === 'valid') {
        const current = inspectResolverConfiguration(this.root, this.indexOptions);
        if (current.id !== verified.resolver.id || current.status !== 'valid') {
          this.invalidateResolver(current);
          throw new Error('Resolver configuration changed while the map was reading it.');
        }
      }
      if (verified.project && verified.diagnostics) attachOverview(verified);
      const beforeGraph = this.graph;
      const changed = !beforeGraph || beforeGraph.revision !== verified.revision || beforeGraph.status !== verified.status;
      const recovered = this.runtime?.status === 'error';
      if (changed) {
        const fileVersions = graph => graph?.inventory
          ? new Map(graph.inventory.entries.filter(entry => !['excluded', 'unscanned'].includes(entry.state)).map(entry => [entry.path, JSON.stringify(entry)]))
          : new Map((graph?.nodes ?? []).filter(node => node.path).map(node => [node.path, node.hash]));
        const before = fileVersions(beforeGraph);
        const after = fileVersions(verified);
        const at = new Date().toISOString();
        if (beforeGraph && beforeGraph.inputPolicy?.id === verified.inputPolicy?.id && beforeGraph.resolver?.id === verified.resolver?.id && verified.inputPolicy?.status !== 'invalid') this.changes = [
          ...[...after].filter(([p, hash]) => before.get(p) !== hash).map(([path]) => ({ path, kind: before.has(path) ? 'changed' : 'added', at })),
          ...[...before.keys()].filter(p => !after.has(p)).map(path => ({ path, kind: 'deleted', at })),
          ...this.changes
        ].slice(0, 30);
        else this.changes = [];
        this.sequence++;
      }
      this.graph = verified;
      this.runtime = { instanceId: this.instanceId, status: 'current', inventoryFreshness: 'current', lastCheckedAt: new Date().toISOString(), error: null, sequence: this.sequence, changes: this.changes };
      if (changed || recovered) this.emit('state', this.snapshot());
    } catch (error) {
      this.checkInputs();
      this.runtime = { instanceId: this.instanceId, status: 'error', inventoryFreshness: 'stale', lastCheckedAt: new Date().toISOString(), error: this.graph?.inputPolicy?.status === 'invalid' ? 'Input policy is unavailable; source data withheld.' : error.message, sequence: this.sequence, changes: this.changes };
      if (this.graph) this.emit('state', this.snapshot());
      else throw error;
    }
    return this.snapshot();
  }

  snapshot() { return { ...this.graph, runtime: this.runtime }; }
  close() { clearInterval(this.timer); this.removeAllListeners(); }
}
