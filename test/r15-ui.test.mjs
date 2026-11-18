import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedRequest, scopedViewIdentity, renderScopedResult, collectScopedReasons } from '../public/visualizer.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.ownText = ''; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('HTML parsing prohibited'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.ownText = ''; }
  addEventListener(name, handler) { this[name] = handler; }
}
globalThis.document = { createElement: tag => new Element(tag) };
const op = 'review-direct-file-boundary@1', model = 'typed-static-local-v1@1';
const selected = 'file:a.ts';
const current = () => ({ ready: true, selector: selected, identity: 'identity', revision: 'rev', binding: null, policyId: 'policy', resolverId: 'resolver' });
const bootstrap = { phase: 'bootstrap', preparation: true, operation: op, model, selector: selected, revision: 'rev', snapshot: 'r02', binding: null };
const prepared = { phase: 'preparation', preparation: true, operation: op, model, revision: 'rev', snapshot: 'r02', scopedSnapshot: 'scoped', requirementsDigest: 'requirements', runtimeId: 'runtime', selection: { id: selected }, binding: null, inputPolicy: { id: 'policy' }, resolver: { id: 'resolver' } };
const receipt = { receipt: 'scoped-preview', mode: 'unbound-preview', installedReceipt: false, operation: op, model, revision: 'rev', snapshot: 'r02', scopedSnapshot: 'scoped', requirementsDigest: 'requirements', runtimeId: 'runtime', selection: { id: selected }, binding: null, inputPolicy: { id: 'policy' }, decision: 'insufficient-evidence', globalStatus: 'partial', blockingReasons: [{ code: 'reference-unknown', path: '<img src=x>' }], nonblockingReasons: [{ code: 'domain-boundary' }], coverage: { incoming: 'unknown' }, claims: { testResults: 'not-observed', nonclaims: ['edit-authority', 'test-pass'] } };
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('three stages preserve original and scoped identities and display 422 negative receipt', async () => {
  const calls = [], states = [];
  const fetcher = async url => { const query = new URL(url, 'http://localhost').searchParams; calls.push(query); return response(calls.length === 1 ? bootstrap : calls.length === 2 ? prepared : receipt, calls.length === 3 ? 422 : 200); };
  await createScopedRequest(current, value => states.push(value), fetcher).run(op, selected);
  assert.deepEqual(calls.map(value => value.get('stage')), ['bootstrap', 'prepare', 'preflight']);
  assert.equal(calls[0].has('snapshot'), false);
  assert.equal(calls[1].get('snapshot'), 'r02');
  assert.equal(calls[1].has('scopedSnapshot'), false);
  assert.equal(calls[2].get('scopedSnapshot'), 'scoped');
  assert.equal(calls[2].get('requirementsDigest'), 'requirements');
  assert.equal(states.at(-1).receipt, receipt);
  const root = renderScopedResult(states.at(-1));
  assert.match(root.textContent, /insufficient-evidence.*original global status: partial/);
  assert.match(root.textContent, /reference-unknown/);
  assert.match(root.textContent, /domain-boundary/);
  assert.match(root.textContent, /edit-authority/);
  assert.match(root.textContent, /not-observed/);
  assert.match(root.textContent, /<img src=x>/);
});

test('late response after revocation or changed identity cannot restore a verdict', async () => {
  let release, now = current();
  const states = [];
  const controller = createScopedRequest(() => now, value => states.push(value), () => new Promise(resolve => { release = resolve; }));
  const promise = controller.run(op, selected);
  controller.revoke();
  now = { ...now, identity: 'changed' };
  release(response(bootstrap));
  await promise;
  assert.equal(states.at(-1), null);
  assert.equal(states.some(value => value?.receipt), false);
});

test('409 protocol errors are shown and preparation cannot masquerade as receipt', async () => {
  const states = [];
  await createScopedRequest(current, value => states.push(value), async () => response({ error: { code: 'STALE', message: 'Fresh context required' } }, 409)).run(op, selected);
  assert.match(states.at(-1).error, /Fresh context required/);
  const next = [];
  await createScopedRequest(current, value => next.push(value), async () => response(receipt, 409)).run(op, selected);
  assert.match(next.at(-1).error, /Scoped request failed/);
  assert.equal(next.some(value => value?.receipt), false);
});

test('identity covers runtime, binding, resolver, policy and selection while excluding presentation', () => {
  const graph = { revision: 'rev', inputPolicy: { id: 'p' }, resolver: { id: 'r' }, binding: { id: 'b', generation: 1 }, runtime: { instanceId: 'i', sequence: 1, status: 'current' } };
  const initial = scopedViewIdentity(graph, selected);
  for (const changed of [ { ...graph, revision: 'rev2' }, { ...graph, inputPolicy: { id: 'p2' } }, { ...graph, resolver: { id: 'r2' } }, { ...graph, binding: { id: 'b', generation: 2 } }, { ...graph, runtime: { ...graph.runtime, sequence: 2 } } ]) assert.notEqual(scopedViewIdentity(changed, selected), initial);
  assert.notEqual(scopedViewIdentity(graph, 'file:b.ts'), initial);
  assert.equal(scopedViewIdentity({ ...graph, camera: { x: 2 }, view: 'testing' }, selected), initial);
});

test('both UI actions interoperate with the actual scoped builder on a disposable fixture', async t => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { indexProject } = await import('../code-index.mjs');
  const { attachOverview } = await import('../project-map.mjs');
  const { scopedResponse } = await import('../scoped-context.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r15-ui-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'export const thing = 1;\n');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } }));
  const indexOptions = { resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
  const graph = attachOverview(indexProject(root, indexOptions));
  graph.runtime = { instanceId: 'fixture', sequence: 1, status: 'current' };
  const selector = graph.nodes.find(node => node.path === 'main.ts').id;
  const getCurrent = () => ({ ready: true, selector, identity: scopedViewIdentity(graph, selector), revision: graph.revision,
    binding: null, policyId: graph.inputPolicy.id, resolverId: graph.resolver.id });
  const fetcher = async url => {
    const params = new URL(url, 'http://localhost').searchParams, stage = params.get('stage'), request = {};
    for (const [key, value] of params) if (key !== 'stage') request[key] = ['schemaVersion', 'generation', 'maxBytes'].includes(key) ? Number(value) : value;
    const body = scopedResponse(root, request, { stage, indexOptions });
    return response(body, body.error || body.decision === 'rejected' ? 409 : body.decision === 'insufficient-evidence' ? 422 : 200);
  };
  for (const operation of ['inspect-selected-source@1', op]) {
    const states = [];
    const controller = createScopedRequest(getCurrent, value => states.push(value), fetcher);
    await controller.run(operation, selector);
    assert.equal(states.at(-1).receipt?.operation, operation, JSON.stringify(states.at(-1)));
    assert.equal(states.at(-1).receipt?.mode, 'unbound-preview');
    assert.equal(states.at(-1).receipt?.globalStatus, 'partial');
    await controller.loadReasons();
    assert.ok(Array.isArray(states.at(-1).reasons), JSON.stringify(states.at(-1)));
    assert.equal(states.at(-1).reasons.length, states.at(-1).receipt.evidence.retrieval.find(item => item.kind === 'reasons').total);
  }
});


test('reason pages reconstruct ordered items and UTF-16 fragments with verified digest', async () => {
  const { scopedDigest } = await import('../scoped-preflight.mjs');
  const values = [{ blocking: true, code: 'alpha' }, { blocking: false, code: 'emoji', path: 'a😀b' }];
  const canonicalFragment = JSON.stringify({ blocking: false, code: 'emoji', path: 'a😀b' });
  const split = canonicalFragment.indexOf('😀') + 2;
  const pages = [
    { page: { section: 'reasons', offset: 0, items: [{ index: 0, value: values[0] }], fragments: [], next: 'b' } },
    { page: { section: 'reasons', offset: 1, items: [], fragments: [{ index: 1, offset: 0, total: canonicalFragment.length, encoding: 'json-text', text: canonicalFragment.slice(0, split) }], next: 'c' } },
    { page: { section: 'reasons', offset: 1, items: [], fragments: [{ index: 1, offset: split, total: canonicalFragment.length, encoding: 'json-text', text: canonicalFragment.slice(split) }], next: null } },
  ];
  const manifest = { kind: 'reasons', total: 2, digest: scopedDigest(values), cursor: 'a' };
  let index = 0;
  assert.deepEqual(await collectScopedReasons(async () => pages[index++], manifest, () => {}), values);
  const repeated = structuredClone(pages[0]); repeated.page.next = 'a';
  await assert.rejects(collectScopedReasons(async () => repeated, manifest, () => {}), /repeated cursor/);
  index = 0;
  await assert.rejects(collectScopedReasons(async () => pages[index++], { ...manifest, digest: '0'.repeat(64) }, () => {}), /digest mismatch/);
  index = 0;
  const altered = structuredClone(pages); altered[1].page.fragments[0].offset = 1;
  await assert.rejects(collectScopedReasons(async () => altered[index++], manifest, () => {}), /fragment/);
  await assert.rejects(collectScopedReasons(async () => pages[0], { ...manifest, total: 200001 }, () => {}), /manifest/);
  await assert.rejects(collectScopedReasons(async () => pages[0], manifest, () => {}, () => false), { name: 'AbortError' });
});


test('reason detail control is explicit and reconstruction pages remain reachable', () => {
  let loads = 0;
  const initial = renderScopedResult({ receipt }, () => loads++);
  const button = initial.children.find(child => child.tag === 'button');
  assert.equal(button.textContent, 'Load reason details');
  button.click();
  assert.equal(loads, 1);
  const rendered = renderScopedResult({ receipt, reasons: Array.from({ length: 41 }, (_, index) => ({ code: `reason-${index}` })) });
  assert.match(rendered.textContent, /Reason details 1–40 of 41/);
  const area = rendered.children.at(-1);
  area.children.find(child => child.tag === 'button' && child.textContent === 'Next reasons').click();
  assert.match(rendered.textContent, /Reason details 41–41 of 41/);
  assert.match(rendered.textContent, /reason-40/);
});

test('reason loading rejects foreign page identity and retains no partial reason list', async () => {
  const { scopedDigest } = await import('../scoped-preflight.mjs');
  const reasons = [{ code: 'reference-unknown', blocking: true }];
  const manifest = { kind: 'reasons', total: 1, digest: scopedDigest(reasons), cursor: 'cursor-a' };
  const preparation = { ...prepared, sections: [manifest] };
  const result = { ...receipt, evidence: { retrieval: [manifest] } };
  const states = [];
  const fetcher = async url => {
    const stage = new URL(url, 'http://localhost').searchParams.get('stage');
    if (stage === 'bootstrap') return response(bootstrap);
    if (stage === 'prepare') return response(preparation);
    if (stage === 'preflight') return response(result, 422);
    return response({ ...preparation, phase: 'evidence', runtimeId: 'foreign', page: { section: 'reasons', offset: 0, items: [{ index: 0, value: reasons[0] }], fragments: [], next: null } });
  };
  const controller = createScopedRequest(current, value => states.push(value), fetcher);
  await controller.run(op, selected);
  await controller.loadReasons();
  assert.match(states.at(-1).reasonsError, /identity changed/);
  assert.equal(states.at(-1).reasons, undefined);
});
