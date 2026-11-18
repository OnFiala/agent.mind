import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResolverOptions, validateResolverConfig, planTypedReference, resolveTypedReference, TYPED_RESOLVER_MODE, TYPED_RESOLUTION_VERSION, TYPED_CANDIDATE_DOMAIN_VERSION, TYPED_RESOLVER_LIMITS } from '../typed-resolution.mjs';

const hash = 'a'.repeat(64);
const fact = (specifier = './target', extra = {}) => ({ kind: 'import', specifier,
  typed: { syntaxKind: 'ImportDeclaration', typeOnly: true, bindings: [{ typeOnly: true, local: 'T', range: { start: 8, end: 9 } }] },
  evidence: { path: 'frontend/src/origin.ts', hash, range: { start: 15, end: 25 }, declarationRange: { start: 0, end: 26 } }, ...extra });
const resolver = { ...normalizeResolverOptions({ resolver: TYPED_RESOLVER_MODE, resolverConfig: 'frontend/tsconfig.json' }), status: 'valid' };
const config = extra => JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', ...extra } });
const run = (specifier = './target', records = {}, extra = {}, original = fact(specifier)) => {
  const calls = [], work = { units: 0, exceeded: false };
  const outcome = resolveTypedReference('frontend/src/origin.ts', original, {
    resolver, enumerationComplete: true, work,
    observe: (relative, role) => { calls.push([relative, role]); return records[relative] ?? (role === 'traversal' ? { state: 'directory' } : { state: 'absent' }); }, ...extra
  });
  return { outcome, calls, work };
};
const eligible = { state: 'eligible', hash };

test('R14 pure module has versioned bounded opt-in only', () => {
  assert.equal(TYPED_RESOLUTION_VERSION, 'typed-local-resolution-v1');
  assert.equal(TYPED_CANDIDATE_DOMAIN_VERSION, 'typed-local-candidates-v1');
  assert.equal(TYPED_RESOLVER_LIMITS.scanPaths, 1000000);
  assert.equal(normalizeResolverOptions(), null);
  assert.equal(normalizeResolverOptions({ generic: true }), null);
  assert.deepEqual(normalizeResolverOptions({ resolver: TYPED_RESOLVER_MODE, resolverConfig: 'tsconfig.json' }), { mode: TYPED_RESOLVER_MODE, configPath: 'tsconfig.json', scopeRoot: '.' });
  for (const input of [null, [], { resolver: TYPED_RESOLVER_MODE }, { resolverConfig: 'tsconfig.json' }, { resolver: 'other', resolverConfig: 'tsconfig.json' }]) assert.throws(() => normalizeResolverOptions(input), TypeError);
  for (const relative of ['', '/tsconfig.json', './tsconfig.json', '../tsconfig.json', 'a/../tsconfig.json', 'a//tsconfig.json', 'a\\tsconfig.json', 'a.json?x', 'a.json#x', 'a.json\0', 'config.js', 'config.JSON']) assert.throws(() => normalizeResolverOptions({ resolver: TYPED_RESOLVER_MODE, resolverConfig: relative }), TypeError, relative);
});

test('V01 config accepts only the narrow inert allowlist with explicit module pair', () => {
  assert.deepEqual(validateResolverConfig(config()), { status: 'valid' });
  assert.deepEqual(validateResolverConfig(JSON.stringify({ compilerOptions: { target: 'es2023', module: 'PRESERVE', moduleResolution: 'BUNDLER', jsx: 'react-jsx', lib: ['DOM'], types: [], noEmit: false, strict: true, noUncheckedIndexedAccess: true, skipLibCheck: false }, include: [], exclude: ['ignored/**'], files: ['not-read.ts'] })), { status: 'valid' });
  for (const extra of [{ target: 'ES2022' }, { jsx: 'React-JSX' }, { module: 'commonjs' }, { moduleResolution: 'node' }]) assert.equal(validateResolverConfig(config(extra)).reason, 'config-unsupported-value');
  for (const extra of [{ target: false }, { jsx: [] }, { lib: [1] }, { types: null }, { strict: 'true' }]) assert.equal(validateResolverConfig(config(extra)).reason, 'config-option-type');
  for (const key of ['paths', 'baseUrl', 'rootDirs', 'moduleSuffixes', 'customConditions', 'allowImportingTsExtensions', '__proto__']) {
    assert.equal(validateResolverConfig(config({ [key]: {} })).reason, 'config-unknown-key', key);
  }
  for (const text of ['{}', '[]', 'null', '{"compilerOptions":null}', '{"compilerOptions":[]}']) assert.equal(validateResolverConfig(text).reason, 'config-shape');
  for (const text of ['{"compilerOptions":{}}', '{"compilerOptions":{"module":"ESNext"}}']) assert.equal(validateResolverConfig(text).reason, 'config-option-type');
  assert.equal(validateResolverConfig('{"extends":"./other.json"}').reason, 'config-unknown-key');
  assert.equal(validateResolverConfig('{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"},"include":[1]}').reason, 'config-option-type');
});

test('V01 strict JSON rejects comments, trailing content, BOM and decoded duplicate keys', () => {
  for (const text of ['', '\ufeff' + config(), config() + '{}', '{/*x*/}', '{"x":1,}', '{"x":[1,]}', '{"x":01}', '{"x":"\\q"}', '{"x":"line\nbreak"}']) assert.equal(validateResolverConfig(text).reason, 'config-json-syntax', text);
  for (const text of ['{"compilerOptions":{},"compilerOptions":{}}', '{"compilerOptions":{"module":"esnext","\\u006dodule":"preserve"}}']) assert.equal(validateResolverConfig(text).reason, 'config-duplicate-key');
  assert.equal(validateResolverConfig(Buffer.from(config())).reason, 'config-text-required');
});

test('V01 JSON bounds count containers/scalars once with root depth zero', () => {
  const base = { compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' }, include: Array(4091).fill('') };
  assert.equal(validateResolverConfig(JSON.stringify(base)).status, 'valid'); // 5 container/member values + 4091 strings.
  base.include.push('');
  assert.equal(validateResolverConfig(JSON.stringify(base)).reason, 'config-value-limit');
  const nested = depth => '{"x":' + '['.repeat(depth - 1) + '0' + ']'.repeat(depth - 1) + '}';
  assert.equal(validateResolverConfig(nested(32)).reason, 'config-unknown-key');
  assert.equal(validateResolverConfig(nested(33)).reason, 'config-depth-limit');
  assert.equal(validateResolverConfig(' '.repeat(65536 - config().length) + config()).status, 'valid');
  assert.equal(validateResolverConfig(' '.repeat(65537 - config().length) + config()).reason, 'config-byte-limit');
  assert.equal(validateResolverConfig(config({ types: ['é'.repeat(33000)] })).reason, 'config-byte-limit');
});

test('V03 stem including .gen has exact ten candidates and twelve veto paths', () => {
  const plan = planTypedReference('frontend/src/origin.ts', fact('./types.gen'), 'frontend');
  assert.equal(plan.status, 'planned');
  assert.deepEqual(plan.candidates, ['frontend/src/types.gen.ts', 'frontend/src/types.gen.tsx', 'frontend/src/types.gen.jsx', 'frontend/src/types.gen.js', 'frontend/src/types.gen.mjs', 'frontend/src/types.gen/index.ts', 'frontend/src/types.gen/index.tsx', 'frontend/src/types.gen/index.jsx', 'frontend/src/types.gen/index.js', 'frontend/src/types.gen/index.mjs']);
  assert.deepEqual(plan.vetoes, ['frontend/src/types.gen', 'frontend/src/types.gen.d.ts', 'frontend/src/types.gen.mts', 'frontend/src/types.gen.cts', 'frontend/src/types.gen.cjs', 'frontend/src/types.gen.json', 'frontend/src/types.gen/index.d.ts', 'frontend/src/types.gen/index.mts', 'frontend/src/types.gen/index.cts', 'frontend/src/types.gen/index.cjs', 'frontend/src/types.gen/index.json', 'frontend/src/types.gen/package.json']);
  assert.deepEqual(plan.traversals, ['.', 'frontend', 'frontend/src']);
  assert.equal(plan.candidates.length + plan.vetoes.length, 22);
});

test('V03 every supported suffix/index candidate can resolve without precedence', () => {
  for (const suffix of ['.ts', '.tsx', '.jsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.jsx', '/index.js', '/index.mjs']) {
    const target = 'frontend/src/target' + suffix;
    const { outcome } = run('./target', { [target]: eligible });
    assert.equal(outcome.status, 'resolved', suffix); assert.equal(outcome.target, target);
  }
  const { outcome } = run('./target', { 'frontend/src/target.ts': eligible, 'frontend/src/target/index.ts': eligible });
  assert.equal(outcome.status, 'ambiguous'); assert.equal(outcome.target, undefined);
  assert.deepEqual(outcome.reasons, ['multiple-candidates']);
  assert.equal(run().outcome.status, 'unresolved');
});

test('V04 each stem veto witnesses blockage; directories at veto paths are harmless', () => {
  for (const veto of planTypedReference('frontend/src/origin.ts', fact(), 'frontend').vetoes) {
    const { outcome } = run('./target', { 'frontend/src/target.ts': eligible, [veto]: { state: 'present' } });
    assert.equal(outcome.status, 'blocked', veto); assert(outcome.reasons.includes('veto-witness')); assert.equal(outcome.target, undefined);
  }
  assert.equal(run('./target', { 'frontend/src/target.ts': eligible, 'frontend/src/target': { state: 'directory', reason: 'enumerated-directory' } }).outcome.status, 'resolved');
});

test('V05 exact suffixes never substitute and conservative same-name alternatives veto', () => {
  const vetoes = { '.js': ['.ts', '.tsx', '.jsx', '.d.ts'], '.mjs': ['.mts', '.d.mts'], '.jsx': ['.tsx', '.ts', '.d.ts'], '.ts': [], '.tsx': [] };
  for (const [suffix, witnesses] of Object.entries(vetoes)) {
    const specifier = './target' + suffix, target = 'frontend/src/target' + suffix;
    const plan = planTypedReference('frontend/src/origin.ts', fact(specifier), 'frontend');
    assert.deepEqual(plan.candidates, [target]);
    assert.deepEqual(plan.vetoes, witnesses.map(value => 'frontend/src/target' + value));
    assert.equal(run(specifier, { [target]: eligible }).outcome.status, 'resolved');
    for (const witness of witnesses) assert.equal(run(specifier, { [target]: eligible, ['frontend/src/target' + witness]: { state: 'present' } }).outcome.status, 'blocked');
  }
  assert.equal(run('./target.js', { 'frontend/src/target.ts': eligible }).outcome.status, 'blocked');
  assert.equal(run('./target.ts', { 'frontend/src/target.tsx': eligible }).outcome.status, 'unresolved');
});

test('V06 unsupported origins, syntax, resources and nonrelative literals have no ledger fallback', () => {
  for (const specifier of ['pkg', '@alias/x', '#local', '/root', 'file:///a', 'https://x']) {
    const { outcome, calls } = run(specifier); assert.equal(outcome.status, 'unsupported'); assert(outcome.reasons.includes('unsupported-nonrelative')); assert.equal(calls.length, 0);
  }
  for (const suffix of ['.css', '.json', '.html', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.wasm']) assert.deepEqual(run('./target' + suffix).outcome.reasons, ['unsupported-resource']);
  for (const suffix of ['.d.ts', '.d.mts', '.d.cts', '.mts', '.cts', '.cjs']) assert.deepEqual(run('./target' + suffix).outcome.reasons, ['unsupported-source-suffix']);
  for (const specifier of ['./x?y', './x#y', './x\\y', './x\0y', './x\u0085y']) assert.deepEqual(run(specifier).outcome.reasons, ['unsupported-path']);
  for (const origin of ['origin.js', 'origin.mjs', 'origin.py', 'origin.d.ts']) assert.equal(planTypedReference(origin, fact(), '.').status, 'unsupported');
  for (const invalid of [{ ...fact(), kind: 'dynamic' }, { ...fact(), typed: undefined }, { ...fact(), typed: { syntaxKind: 'TSImportType' } }]) assert.equal(run('./target', {}, {}, invalid).calls.length, 0);
});

test('V06 domain cannot leave and return, or trim outside siblings to choose an index', () => {
  assert.deepEqual(run('../../frontend/src/target').outcome.reasons, ['unsupported-config-domain']);
  assert.equal(planTypedReference('other/origin.ts', fact(), 'frontend').status, 'unsupported');
  assert.deepEqual(planTypedReference('frontend/origin.ts', fact('./'), 'frontend').reasons, ['unsupported-config-domain']);
  assert.deepEqual(run('../../../outside').outcome.reasons, ['unsupported-config-domain']);
});

test('V07 unknown/denied observations outrank known candidate counts and keep all evidence', () => {
  const original = fact();
  const { outcome } = run('./target', {
    'frontend/src/target.ts': eligible, 'frontend/src/target.tsx': eligible,
    'frontend/src/target.jsx': { state: 'unknown', reason: 'parse-failure' },
    'frontend/src/target/package.json': { state: 'unknown', reason: 'policy-denied' }
  }, {}, original);
  assert.equal(outcome.status, 'blocked');
  for (const reason of ['candidate-unknown', 'parse-failure', 'veto-unknown', 'policy-denied', 'multiple-candidates']) assert(outcome.reasons.includes(reason));
  assert.equal(outcome.target, undefined);
  assert.deepEqual(outcome.typed, original.typed); assert.deepEqual(outcome.evidence, original.evidence);
  outcome.typed.bindings[0].local = 'changed'; outcome.evidence.range.start = -1;
  assert.equal(original.typed.bindings[0].local, 'T'); assert.equal(original.evidence.range.start, 15);
  assert.equal(run('./target', { 'frontend/src/target.ts': { state: 'eligible' } }).outcome.status, 'blocked');
  assert.equal(run('./target', { 'frontend/src/target.ts': { state: 'directory' } }).outcome.status, 'blocked');
});

test('V07 lexical symlink or absent prefixes before .. cannot normalize into a valid edge', () => {
  const original = './denied/../target.ts';
  for (const state of ['unknown', 'present', 'absent', 'eligible']) {
    const { outcome } = run(original, { 'frontend/src/denied': { state, reason: 'denied-prefix' }, 'frontend/src/target.ts': eligible });
    assert.equal(outcome.status, 'blocked', state); assert(outcome.reasons.includes('traversal-not-directory'));
    assert(outcome.traversals.some(item => item.path === 'frontend/src/denied' && item.state === state));
  }
  assert.equal(run(original, { 'frontend/src/target.ts': eligible }).outcome.status, 'resolved');
});

test('V08 incomplete enumeration, blocked config and observation failures never fall back', () => {
  assert.equal(run('./target', { 'frontend/src/target.ts': eligible }, { enumerationComplete: false }).outcome.status, 'blocked');
  const invalid = run('./target', { 'frontend/src/target.ts': eligible }, { resolver: { ...resolver, status: 'invalid', reason: 'config-changed' } });
  assert.equal(invalid.outcome.status, 'blocked'); assert(invalid.outcome.reasons.includes('config-changed')); assert.equal(invalid.calls.length, 0);
  assert.equal(run('./target', {}, { observe: () => { throw new Error('failure'); } }).outcome.status, 'blocked');
  assert.equal(run('./target', {}, { observe: () => ({ state: 'nonsense' }) }).outcome.status, 'blocked');
});

test('V08 shared work debits every actual observation and stops on scan exhaustion', () => {
  const normal = run(); assert.equal(normal.work.units, normal.calls.length); assert.equal(normal.calls.length, 25);
  const work = { units: TYPED_RESOLVER_LIMITS.scanPaths - 1, exceeded: false };
  const limited = run('./target', { 'frontend/src/target.ts': eligible }, { work });
  assert.equal(work.units, TYPED_RESOLVER_LIMITS.scanPaths + 1); assert.equal(work.exceeded, true);
  assert.equal(limited.calls.length, 1); assert.equal(limited.outcome.status, 'blocked'); assert(limited.outcome.reasons.includes('resolver-work-limit'));
  const tooDeep = './' + Array.from({ length: 21 }, (_, i) => 'dir' + i).join('/') + '/target';
  const deep = run(tooDeep); assert.equal(deep.outcome.status, 'blocked'); assert(deep.outcome.reasons.includes('traversal-limit')); assert.equal(deep.calls.length, 0);
});

test('V09 exact percent/case spelling, type-only, reexports and self-reference remain unchanged', () => {
  for (const specifier of ['./%74arget.ts', './Target.ts']) {
    const target = 'frontend/src/' + specifier.slice(2);
    assert.equal(run(specifier, { [target]: eligible }).outcome.target, target);
  }
  const original = fact('./origin.ts', { kind: 'reexport', typed: { syntaxKind: 'ExportAllDeclaration', typeOnly: true, bindings: [] } });
  const { outcome } = run('./origin.ts', { 'frontend/src/origin.ts': eligible }, {}, original);
  assert.equal(outcome.status, 'resolved'); assert.equal(outcome.target, 'frontend/src/origin.ts');
  assert.equal(outcome.kind, 'reexport'); assert.deepEqual(outcome.typed, original.typed);
});
