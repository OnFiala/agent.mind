import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshContext, contextCursor } from '../graph-context.mjs';
import { scopedResponse, scopedObservation, scopedEvidenceCursor } from '../scoped-context.mjs';
import { scopedDigest } from '../scoped-preflight.mjs';

const resolver = { generic: true, resolver: 'bundler-local-v1', resolverConfig: 'tsconfig.json' };
const textOperation = 'inspect-selected-source@1', boundaryOperation = 'review-direct-file-boundary@1';
function fixture(t, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mind-r15-protocol-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"}}\n',
    'main.ts': 'import { helper } from "./helper";\nexport function selected() { return helper; }\n',
    'helper.ts': 'export function helper() { return 1; }\n',
    ...extra
  };
  for (const [relative, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), source);
  }
  return root;
}
function requestFor(root, operation = textOperation, selector = 'main.ts', options = resolver) {
  const context = freshContext(root, selector, options, { profile: 'agent', maxBytes: 1000000 });
  assert(!context.error);
  const request = { schemaVersion: 1, operation, ...(operation === boundaryOperation ? { model: 'typed-static-local-v1@1' } : {}), selector, revision: context.revision, snapshot: context.snapshot };
  return { context, request };
}
function preflight(root, request, options = resolver) {
  const preparation = scopedResponse(root, request, { indexOptions: options, stage: 'prepare' });
  assert.equal(preparation.phase, 'preparation', JSON.stringify(preparation));
  assert.equal(preparation.decision, undefined);
  assert.equal(preparation.receipt, undefined);
  const fullRequest = { ...request, scopedSnapshot: preparation.scopedSnapshot, requirementsDigest: preparation.requirementsDigest };
  return { preparation, fullRequest, receipt: scopedResponse(root, fullRequest, { indexOptions: options, stage: 'preflight' }) };
}
function expectedClaims(receipt) {
  assert.equal(receipt.claims.testResults, 'not-observed');
  for (const name of ['edit-authority', 'test-pass', 'runtime-behavior', 'consumer-read-completion', 'filesystem-lock']) assert(receipt.claims.nonclaims.includes(name));
}

test('R15 V13 bootstrap preserves original R02 identity, preparation never issues receipt, both previews retain partial', t => {
  const root = fixture(t);
  for (const operation of [textOperation, boundaryOperation]) {
    const { context, request } = requestFor(root, operation);
    const bootstrap = scopedResponse(root, { schemaVersion: 1, operation, ...(request.model ? { model: request.model } : {}), selector: 'main.ts' }, { indexOptions: resolver, stage: 'bootstrap' });
    assert.equal(bootstrap.snapshot, context.snapshot);
    assert.equal(bootstrap.revision, context.revision);
    assert.equal(bootstrap.receipt, undefined);
    assert.equal(bootstrap.claims.preflight, 'not-issued');
    const { preparation, receipt } = preflight(root, request);
    assert.equal(preparation.snapshot, context.snapshot);
    assert.notEqual(preparation.scopedSnapshot, context.snapshot);
    assert.equal(receipt.receipt, 'scoped-preview');
    assert.equal(receipt.mode, 'unbound-preview');
    assert.equal(receipt.installedReceipt, false);
    assert.equal(receipt.globalStatus, 'partial');
    assert.equal(receipt.decision, 'sufficient-at-read', JSON.stringify(receipt.blockingReasons));
    expectedClaims(receipt);
  }
});

test('R15 T03/V01/V03/V04 unknown incoming origins remain unknown even without discovered edge', t => {
  for (const [name, source] of [
    ['outside.ts', 'export async function run(p: string) { return import(p); }\n'],
    ['outside.mjs', 'export async function run(p) { return import(p); }\n'],
    ['outside.py', 'import selected\n'],
    ['outside.html', '<script src="main.ts"></script>'],
    ['outside.ts', 'import "package-name";\n']
  ]) {
    const root = fixture(t, { [name]: source });
    const text = preflight(root, requestFor(root).request).receipt;
    const boundary = preflight(root, requestFor(root, boundaryOperation).request).receipt;
    assert.equal(text.decision, 'sufficient-at-read', name);
    assert.equal(boundary.decision, 'insufficient-evidence', JSON.stringify(boundary.blockingReasons));
    assert(boundary.blockingReasons.length);
    assert.equal(boundary.globalStatus, 'partial');
    expectedClaims(boundary);
  }
});

test('R15 V05 file/block/symbol expand complete owning files; invalid or area selectors reject', t => {
  const root = fixture(t);
  const full = freshContext(root, 'main.ts', resolver);
  const block = full.selection.blockId;
  for (const selector of ['file:main.ts', 'symbol:main.ts#selected', block]) {
    const { receipt } = preflight(root, requestFor(root, textOperation, selector).request);
    assert.equal(receipt.decision, 'sufficient-at-read');
    assert(receipt.selection.files.some(file => file.path === 'main.ts'));
    if (selector.startsWith('symbol:')) assert.equal(receipt.selection.files.length, 1);
  }
  const { request } = requestFor(root);
  for (const selector of ['missing.ts', 'area:whatever']) {
    const rejected = scopedResponse(root, { ...request, selector }, { indexOptions: resolver });
    assert.equal(rejected.decision, 'rejected');
    expectedClaims(rejected);
  }
});

test('R15 T15-T17/V06/V13 stale identities reject with complete negative envelope', t => {
  const root = fixture(t), { request } = requestFor(root);
  const { fullRequest } = preflight(root, request);
  for (const field of ['revision', 'snapshot', 'scopedSnapshot', 'requirementsDigest']) {
    const result = scopedResponse(root, { ...fullRequest, [field]: '0'.repeat(64) }, { indexOptions: resolver, stage: 'preflight' });
    assert.equal(result.decision, 'rejected', field);
    expectedClaims(result);
  }
  fs.writeFileSync(path.join(root, 'helper.ts'), 'export function helper() { return 2; }\n');
  const changed = scopedResponse(root, fullRequest, { indexOptions: resolver, stage: 'preflight' });
  assert.equal(changed.decision, 'rejected');
  expectedClaims(changed);
});

test('R15 T16 policy-only edit and resolver-only edit revoke scoped observations', t => {
  for (const change of ['policy', 'resolver']) {
    const root = fixture(t), { fullRequest } = preflight(root, requestFor(root).request);
    if (change === 'policy') fs.writeFileSync(path.join(root, '.gitignore'), '# Same admitted files; different policy identity\n');
    else fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler"},"include":["**/*.ts"]}\n');
    const result = scopedResponse(root, fullRequest, { indexOptions: resolver, stage: 'preflight' });
    assert.equal(result.decision, 'rejected', change);
  }
});

test('R15 T22/T23 evidence pages and UTF-16 fragments reconstruct exactly; foreign cursors reject', t => {
  const root = fixture(t, { 'many.ts': Array.from({ length: 100 }, (_, i) => 'import { helper as h' + i + ' } from "./helper";').join('\n') });
  const { request, context } = requestFor(root, boundaryOperation);
  const { preparation, fullRequest } = preflight(root, request);
  const expected = scopedObservation(root, request, { indexOptions: resolver });
  let fragmented = false;
  for (const section of preparation.sections) {
    const values = new Map(), fragments = new Map();
    let cursor = scopedEvidenceCursor(preparation, section.kind), pages = 0;
    while (cursor) {
      const page = scopedResponse(root, { ...fullRequest, cursor, maxBytes: 6000 }, { indexOptions: resolver, stage: 'evidence' });
      assert(!page.error, JSON.stringify(page)); assert.equal(page.decision, undefined);
      assert(Buffer.byteLength(JSON.stringify(page)) <= 6000);
      for (const item of page.page.items) values.set(item.index, item.value);
      for (const item of page.page.fragments) {
        fragmented = true;
        const prior = fragments.get(item.index) ?? '';
        assert.equal(item.offset, prior.length);
        fragments.set(item.index, prior + item.text);
        if (prior.length + item.text.length === item.total) values.set(item.index, JSON.parse(prior + item.text));
      }
      cursor = page.page.next;
      assert(++pages < 200);
    }
    assert.equal(values.size, section.total);
    assert.equal(scopedDigest([...values].sort(([a], [b]) => a - b).map(([, value]) => value)), section.digest);
    assert.deepEqual([...values].sort(([a], [b]) => a - b).map(([, value]) => value), expected.sections[section.kind]);
  }
  assert(fragmented);
  assert.throws(() => scopedResponse(root, { ...fullRequest, cursor: contextCursor(context, 'context') }, { indexOptions: resolver, stage: 'evidence' }), /continuation/);
  const other = preflight(root, requestFor(root, boundaryOperation, 'helper.ts').request);
  assert.throws(() => scopedResponse(root, { ...fullRequest, cursor: scopedEvidenceCursor(other.preparation, 'origins') }, { indexOptions: resolver, stage: 'evidence' }), /continuation/);
});

test('R15 T24 mandatory budgets and closed phase/request shapes never truncate success', t => {
  const root = fixture(t), { request } = requestFor(root);
  const { fullRequest } = preflight(root, request);
  const small = scopedResponse(root, { ...fullRequest, maxBytes: 256 }, { indexOptions: resolver, stage: 'preflight' });
  assert.equal(small.error.code, 'SCOPED_BUDGET_TOO_SMALL');
  assert.equal(small.decision, undefined);
  for (const bad of [{ ...request, unknown: true }, { ...request, schemaVersion: 2 }, { ...request, scopedSnapshot: '0'.repeat(64) }]) assert.throws(() => scopedResponse(root, bad, { indexOptions: resolver }));
  assert.throws(() => scopedResponse(root, request, { indexOptions: resolver, stage: 'preflight' }), /prepared scoped/);
  assert.throws(() => scopedResponse(root, { ...fullRequest, section: 'origins' }, { indexOptions: resolver, stage: 'preflight' }), /not an evidence page/);
});

test('R15 text works without enabling resolver and a selected parse failure remains readable', t => {
  const root = fixture(t, { 'main.ts': 'export function broken( {\n' });
  const { request } = requestFor(root, textOperation, 'main.ts', { generic: true });
  const result = preflight(root, request, { generic: true }).receipt;
  assert.equal(result.decision, 'sufficient-at-read', JSON.stringify(result.blockingReasons));
  assert.equal(result.globalStatus, 'partial');
});
