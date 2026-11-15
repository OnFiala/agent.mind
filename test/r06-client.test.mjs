import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptGraph, sourceMatchesSnapshot, revokeClientSource } from '../public/visualizer.js';

const policy = (id, status = 'valid') => ({ id, status });
const node = { id: 'file:app', path: 'app.mjs', hash: 'unchanged', policyId: 'policy-a' };
const graph = (id = 'policy-a', sequence = 1, instanceId = 'server-a') => ({
  revision: `revision-${id}`, inputPolicy: policy(id),
  runtime: { instanceId, sequence }, nodes: [{ ...node, policyId: id }],
});
const source = { path: node.path, hash: node.hash, policyId: 'policy-a', revision: 'revision-policy-a', lines: [{ number: 1, text: 'SENTINEL_OLD_SOURCE' }] };

test('cached and in-flight source require the current policy even when source bytes do not change', () => {
  const before = graph();
  assert.equal(sourceMatchesSnapshot(source, node, before, before), true);
  assert.equal(sourceMatchesSnapshot(source, node, before, graph('policy-b', 2)), false);
  const invalid = { ...graph('invalid', 2), inputPolicy: policy('invalid', 'invalid'), nodes: [] };
  assert.equal(sourceMatchesSnapshot(source, node, before, invalid), false);
  assert.equal(sourceMatchesSnapshot(source, node, before, { ...before, nodes: [] }), false);
  assert.equal(sourceMatchesSnapshot(source, node, before, graph('policy-a', 2, 'server-b')), false);
  assert.equal(sourceMatchesSnapshot(source, node, before, { ...before, revision: 'different' }), false);
  assert.equal(sourceMatchesSnapshot(source, node, before, graph('policy-a', 2)), true);
});

test('source response policy, revision, file identity and shape must all match the request snapshot', () => {
  const current = graph();
  for (const delta of [
    { policyId: 'policy-b' }, { policyId: undefined }, { revision: 'old' },
    { hash: 'different' }, { path: 'other.mjs' }, { lines: undefined },
  ]) assert.equal(sourceMatchesSnapshot({ ...source, ...delta }, node, current, current), false);
  assert.equal(sourceMatchesSnapshot(source, { ...node, policyId: 'old' }, current, current), false);
  assert.equal(sourceMatchesSnapshot(source, node, { ...current, inputPolicy: policy('policy-a', 'invalid') }, current), false);
});

test('policy revocation aborts pending source and clears caches while retaining ID-only view state', () => {
  const controller = new AbortController();
  const state = {
    sourceAbort: controller, sourceRequest: 7, source,
    modeViews: new Map([['blocks', { positions: new Map() }]]),
    selection: { type: 'node', id: node.id }, camera: { x: 20, y: 30, scale: .8 },
    positions: new Map([[node.id, { x: 5, y: 10 }]]),
  };
  const selection = state.selection, camera = state.camera, positions = state.positions;
  revokeClientSource(state);
  assert.equal(controller.signal.aborted, true);
  assert.equal(state.sourceRequest, 8);
  assert.equal(state.source, null);
  assert.equal(state.sourceAbort, null);
  assert.equal(state.modeViews.size, 0);
  assert.equal(state.selection, selection);
  assert.equal(state.camera, camera);
  assert.equal(state.positions, positions);
});

test('late graph snapshots cannot restore old policy data after revocation or server replacement', () => {
  const before = graph();
  const changed = graph('policy-b', 2);
  assert.equal(shouldAcceptGraph(before, changed), true);
  assert.equal(shouldAcceptGraph(changed, before), false);
  assert.equal(shouldAcceptGraph(changed, graph('policy-a', 2)), false);
  assert.equal(shouldAcceptGraph(changed, { ...graph('policy-b', 3), inputPolicy: undefined }), false);
  const invalid = { ...graph('invalid', 3), inputPolicy: policy('invalid', 'invalid'), nodes: [] };
  assert.equal(shouldAcceptGraph(changed, invalid), true);
  assert.equal(shouldAcceptGraph(invalid, changed), false);
  const recovered = graph('policy-a', 4);
  assert.equal(shouldAcceptGraph(invalid, recovered), true);
  const restarted = graph('policy-b', 1, 'server-b');
  assert.equal(shouldAcceptGraph(recovered, restarted), true);
  assert.equal(shouldAcceptGraph(restarted, recovered, new Set(['server-a'])), false);
  assert.equal(shouldAcceptGraph(restarted, graph('policy-b', 2, 'server-b'), new Set(['server-a'])), true);
});
