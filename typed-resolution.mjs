import path from 'node:path';

// Pure decisions over already checked text and a caller-owned inventory ledger.
// No filesystem reads, target imports, cache or project execution belong here.
export const TYPED_RESOLVER_MODE = 'bundler-local-v1';
export const TYPED_RESOLUTION_VERSION = 'typed-local-resolution-v1';
export const TYPED_CANDIDATE_DOMAIN_VERSION = 'typed-local-candidates-v1';
export const TYPED_RESOLVER_LIMITS = Object.freeze({ configBytes: 65536, configDepth: 32, configValues: 4096, pathsPerOccurrence: 32, scanPaths: 1000000, traversals: 20 });
const extensions = ['.ts', '.tsx', '.jsx', '.js', '.mjs'];
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
const safeTextPath = value => typeof value === 'string' && value.length > 0 && !controls.test(value) && !/[\\?#]/u.test(value);
const canonicalRelative = value => safeTextPath(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const inside = (relative, root) => root === '.' || relative.startsWith(root + '/');

export function normalizeResolverOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Resolver options must be an object.');
  const mode = Object.hasOwn(options, 'resolver'), config = Object.hasOwn(options, 'resolverConfig');
  if (!mode && !config) return null;
  if (!mode || !config || options.resolver !== TYPED_RESOLVER_MODE || !canonicalRelative(options.resolverConfig) || !options.resolverConfig.endsWith('.json')) {
    throw new TypeError('Use --resolver bundler-local-v1 and a canonical root-relative --resolver-config JSON path together.');
  }
  return { mode: TYPED_RESOLVER_MODE, configPath: options.resolverConfig, scopeRoot: path.posix.dirname(options.resolverConfig) };
}

// Count each JSON container/scalar once, including root at depth zero. A member's
// value counts once; its key is not an additional value. Compare decoded keys.
function strictConfigJSON(text) {
  let at = 0, values = 0;
  const fail = reason => { throw Object.assign(new Error(reason), { reason }); };
  const whitespace = () => { while (/[\t\n\r ]/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => {
    if (text[at] !== '"') fail('config-json-syntax');
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        try { return JSON.parse(text.slice(start, at)); } catch { fail('config-json-syntax'); }
      }
      if (char === '\\') at++;
      else if (char.charCodeAt(0) < 32) fail('config-json-syntax');
    }
    fail('config-json-syntax');
  };
  const value = depth => {
    if (depth > TYPED_RESOLVER_LIMITS.configDepth) fail('config-depth-limit');
    if (++values > TYPED_RESOLVER_LIMITS.configValues) fail('config-value-limit');
    whitespace();
    const char = text[at];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      const object = char === '{', result = object ? Object.create(null) : [], keys = new Set(), close = object ? '}' : ']';
      at++; whitespace();
      if (text[at] === close) { at++; return result; }
      for (;;) {
        let key;
        if (object) {
          key = string();
          if (keys.has(key)) fail('config-duplicate-key');
          keys.add(key); whitespace();
          if (text[at++] !== ':') fail('config-json-syntax');
        }
        const item = value(depth + 1);
        if (object) result[key] = item;
        else result.push(item);
        whitespace();
        if (text[at] === close) { at++; return result; }
        if (text[at++] !== ',') fail('config-json-syntax');
        whitespace();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, at)) { at += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (number) { at += number[0].length; return Number(number[0]); }
    fail('config-json-syntax');
  };
  const result = value(0); whitespace();
  if (at !== text.length) fail('config-json-syntax');
  return result;
}

export function validateResolverConfig(text) {
  const invalid = reason => ({ status: 'invalid', reason });
  if (typeof text !== 'string') return invalid('config-text-required');
  if (Buffer.byteLength(text, 'utf8') > TYPED_RESOLVER_LIMITS.configBytes) return invalid('config-byte-limit');
  if (text.charCodeAt(0) === 0xfeff) return invalid('config-json-syntax');
  let config;
  try { config = strictConfigJSON(text); } catch (error) { return invalid(error.reason ?? 'config-json-syntax'); }
  const object = item => item !== null && typeof item === 'object' && !Array.isArray(item);
  const strings = item => Array.isArray(item) && item.every(value => typeof value === 'string');
  if (!object(config)) return invalid('config-shape');
  if (Object.keys(config).some(key => !['compilerOptions', 'include', 'exclude', 'files'].includes(key))) return invalid('config-unknown-key');
  for (const key of ['include', 'exclude', 'files']) if (Object.hasOwn(config, key) && !strings(config[key])) return invalid('config-option-type');
  const compiler = config.compilerOptions;
  if (!object(compiler)) return invalid('config-shape');
  const arrays = ['lib', 'types'], booleans = ['noEmit', 'strict', 'noUncheckedIndexedAccess', 'skipLibCheck'];
  const names = ['target', 'jsx', 'module', 'moduleResolution'];
  if (Object.keys(compiler).some(key => ![...arrays, ...booleans, ...names].includes(key))) return invalid('config-unknown-key');
  for (const [key, item] of Object.entries(compiler)) {
    if (arrays.includes(key) ? !strings(item) : booleans.includes(key) ? typeof item !== 'boolean' : typeof item !== 'string') return invalid('config-option-type');
  }
  if (typeof compiler.moduleResolution !== 'string' || typeof compiler.module !== 'string') return invalid('config-option-type');
  if (compiler.moduleResolution.toLowerCase() !== 'bundler' || !['esnext', 'preserve'].includes(compiler.module.toLowerCase()) ||
      Object.hasOwn(compiler, 'target') && compiler.target.toLowerCase() !== 'es2023' ||
      Object.hasOwn(compiler, 'jsx') && compiler.jsx !== 'react-jsx') return invalid('config-unsupported-value');
  return { status: 'valid' };
}

export function planTypedReference(relative, fact, scopeRoot = '.') {
  const unsupported = reason => ({ status: 'unsupported', reasons: [reason], candidates: [], vetoes: [], traversals: [] });
  if (!canonicalRelative(relative) || !/\.(?:ts|tsx|jsx)$/.test(relative) || relative.endsWith('.d.ts')) return unsupported('unsupported-origin');
  if (!(scopeRoot === '.' || canonicalRelative(scopeRoot)) || !inside(relative, scopeRoot)) return unsupported('unsupported-config-domain');
  if (!fact || !['import', 'reexport'].includes(fact.kind) || !fact.typed || !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(fact.typed.syntaxKind)) return unsupported('unsupported-reference');
  const specifier = fact.specifier;
  if (typeof specifier !== 'string' || !(specifier.startsWith('./') || specifier.startsWith('../'))) return unsupported('unsupported-nonrelative');
  if (!safeTextPath(specifier)) return unsupported('unsupported-path');
  const parts = relative.split('/').slice(0, -1), traversals = new Set(['.']);
  const addPrefixes = segments => { for (let i = 1; i <= segments.length; i++) traversals.add(segments.slice(0, i).join('/')); };
  addPrefixes(parts);
  addPrefixes(scopeRoot === '.' ? [] : scopeRoot.split('/'));
  const segments = specifier.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return unsupported('unsupported-config-domain');
      parts.pop();
      const current = parts.join('/') || '.';
      if (scopeRoot !== '.' && current !== scopeRoot && !inside(current, scopeRoot)) return unsupported('unsupported-config-domain');
    } else {
      parts.push(segment);
      if (i < segments.length - 1) traversals.add(parts.join('/'));
    }
  }
  const stem = parts.join('/');
  if (!stem) return unsupported('unsupported-config-domain');
  if (/\.(?:d\.ts|d\.mts|d\.cts|mts|cts|cjs)$/.test(stem)) return unsupported('unsupported-source-suffix');
  if (/\.(?:json|css|html|svg|png|jpg|jpeg|gif|webp|wasm)$/.test(stem)) return unsupported('unsupported-resource');
  const extension = extensions.find(suffix => stem.endsWith(suffix));
  let candidates, vetoes;
  if (extension) {
    candidates = [stem];
    const base = stem.slice(0, -extension.length);
    const alternatives = extension === '.js' ? ['.ts', '.tsx', '.jsx', '.d.ts'] : extension === '.mjs' ? ['.mts', '.d.mts'] : extension === '.jsx' ? ['.tsx', '.ts', '.d.ts'] : [];
    vetoes = alternatives.map(suffix => base + suffix);
  } else {
    candidates = [...extensions.map(suffix => stem + suffix), ...extensions.map(suffix => stem + '/index' + suffix)];
    vetoes = [stem, ...['.d.ts', '.mts', '.cts', '.cjs', '.json'].map(suffix => stem + suffix), ...['.d.ts', '.mts', '.cts', '.cjs', '.json'].map(suffix => stem + '/index' + suffix), stem + '/package.json'];
  }
  // Never discard out-of-domain sibling candidates to choose an index candidate.
  if ([...candidates, ...vetoes].some(candidate => !inside(candidate, scopeRoot))) return unsupported('unsupported-config-domain');
  if (traversals.size > TYPED_RESOLVER_LIMITS.traversals) return { status: 'blocked', reasons: ['traversal-limit'], candidates, vetoes, traversals: [...traversals] };
  return { status: 'planned', candidates, vetoes, traversals: [...traversals] };
}

export function resolveTypedReference(relative, fact, { resolver, enumerationComplete, observe, work } = {}) {
  const plan = planTypedReference(relative, fact, resolver?.scopeRoot ?? '.');
  const result = { ...structuredClone(fact), status: plan.status, reasons: [...(plan.reasons ?? [])], candidates: [], vetoes: [], traversals: [] };
  if (plan.status === 'unsupported') return result;
  const reasons = new Set(result.reasons);
  let blocked = reasons.size > 0;
  if (!resolver || resolver.mode !== TYPED_RESOLVER_MODE || resolver.status !== 'valid') { blocked = true; reasons.add(resolver?.reason ?? 'resolver-config-invalid'); }
  for (const reason of resolver?.reasons ?? []) reasons.add(reason);
  if (enumerationComplete !== true) { blocked = true; reasons.add('enumeration-incomplete'); }
  if (plan.candidates.length + plan.vetoes.length > TYPED_RESOLVER_LIMITS.pathsPerOccurrence) { blocked = true; reasons.add('candidate-path-limit'); }
  const canObserve = resolver?.mode === TYPED_RESOLVER_MODE && resolver.status === 'valid' && plan.status === 'planned';
  const ledger = work ?? { units: 0, exceeded: false };
  const check = (candidate, role) => {
    let observed;
    if (!canObserve) observed = { state: 'unknown', reason: result.reasons[0] ?? resolver?.reason ?? 'resolver-config-invalid' };
    else if (ledger.exceeded || !Number.isSafeInteger(ledger.units) || ledger.units < 0 || ++ledger.units > TYPED_RESOLVER_LIMITS.scanPaths) {
      ledger.exceeded = true;
      observed = { state: 'unknown', reason: 'resolver-work-limit' };
    } else {
      try { observed = observe?.(candidate, role); } catch { observed = { state: 'unknown', reason: 'observation-failed' }; }
      if (!observed || !['eligible', 'absent', 'directory', 'unknown', 'present'].includes(observed.state)) observed = { state: 'unknown', reason: 'observation-missing' };
    }
    const entry = { ...structuredClone(observed), path: candidate };
    if (observed.reason) reasons.add(observed.reason);
    if (role === 'traversal') {
      if (observed.state !== 'directory') { blocked = true; reasons.add('traversal-not-directory'); }
    } else if (role === 'veto') {
      if (['eligible', 'present'].includes(observed.state)) { blocked = true; reasons.add('veto-witness'); }
      else if (observed.state === 'unknown') { blocked = true; reasons.add('veto-unknown'); }
    } else if (observed.state === 'eligible') {
      if (!/^[a-f0-9]{64}$/.test(observed.hash ?? '')) { blocked = true; reasons.add('candidate-hash-missing'); }
    } else if (observed.state !== 'absent') { blocked = true; reasons.add(observed.state === 'unknown' ? 'candidate-unknown' : observed.state === 'directory' ? 'candidate-is-directory' : 'candidate-not-eligible'); }
    return entry;
  };
  result.traversals = plan.traversals.map(candidate => check(candidate, 'traversal'));
  result.candidates = plan.candidates.map(candidate => check(candidate, 'candidate'));
  result.vetoes = plan.vetoes.map(candidate => check(candidate, 'veto'));
  const eligible = result.candidates.filter(candidate => candidate.state === 'eligible' && /^[a-f0-9]{64}$/.test(candidate.hash ?? ''));
  if (eligible.length > 1) reasons.add('multiple-candidates');
  result.status = blocked ? 'blocked' : eligible.length > 1 ? 'ambiguous' : eligible.length ? 'resolved' : 'unresolved';
  if (result.status === 'resolved') result.target = eligible[0].path;
  if (result.status === 'unresolved') reasons.add('no-candidate');
  result.reasons = [...reasons];
  return result;
}
