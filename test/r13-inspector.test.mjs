import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReferenceSyntax } from '../public/visualizer.js';

class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.ownText = ''; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Untrusted text must not be parsed as HTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.ownText = ''; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click(); }
}
globalThis.document = { createElement: tag => new FakeElement(tag) };
const range = { start: 2, end: 7, unit: 'utf16-code-unit', endExclusive: true };
const fact = index => ({ kind: 'import', specifier: `module-${index}<img src=x onerror=alert(1)>`, typed: { syntaxKind: 'ImportDeclaration', typeOnly: false, bindings: [{ syntaxKind: 'ImportSpecifier', local: '<script>bad</script>', imported: 'a', exported: null, typeOnly: false, range }] }, evidence: { path: 'src/a.ts', hash: 'abc123', producer: { name: '@babel/parser', version: '7.29.12', mode: 'syntax-only' }, line: index + 1, column: 2, endLine: index + 1, endColumn: 8, range, declarationRange: range } });
const envelope = (facts = [], unsupported = [], extraction = 'collected') => ({ version: 'typed-reference-syntax-v1', extraction, facts, unsupported, resolution: { status: 'unsupported', reason: 'typed-resolution-not-enabled' } });
const descendants = root => [root, ...root.children.flatMap(descendants)];
const findButton = (root, text) => descendants(root).find(item => item.tag === 'button' && item.textContent === text);

test('inspector treats source strings as text, preserves evidence and show-line callback', () => {
  const seen = [];
  const root = renderReferenceSyntax(envelope([fact(4)]), line => seen.push(line));
  assert.match(root.textContent, /resolution is unavailable/);
  assert.match(root.textContent, /module-4<img src=x onerror=alert\(1\)>/);
  assert.match(root.textContent, /<script>bad<\/script>/);
  assert.match(root.textContent, /src\/a\.ts:5:2–5:8 · hash abc123 · producer @babel\/parser · 7\.29\.12 · syntax-only/);
  assert.match(root.textContent, /2–7 utf16-code-unit, end exclusive: true/);
  assert.equal(descendants(root).some(item => item.tag === 'img' || item.tag === 'script'), false);
  findButton(root, 'Show line 5').click();
  assert.deepEqual(seen, [5]);
});

test('withheld, empty and unsupported states are explicit', () => {
  const withheld = renderReferenceSyntax(envelope([], [], 'withheld'), () => {});
  assert.match(withheld.textContent, /No facts from this pass.*withheld.*diagnostics/);
  const empty = renderReferenceSyntax(envelope(), () => {});
  assert.match(empty.textContent, /Zero supported occurrences.*does not establish absence of dependencies/);
  const unsupported = renderReferenceSyntax(envelope([], [{ reason: 'dynamic-import', syntaxKind: 'ImportExpression', range }]), () => {});
  assert.match(unsupported.textContent, /0 supported occurrences and 1 unsupported occurrences/);
  assert.match(unsupported.textContent, /Unsupported: ImportExpression.*Reason: dynamic-import.*2–7/);
});

test('bounded pages make all occurrences accessible in both directions', () => {
  const facts = Array.from({ length: 1999 }, (_, i) => fact(i));
  const unsupported = [{ reason: 'dynamic', syntaxKind: 'CallExpression', range }];
  const root = renderReferenceSyntax(envelope(facts, unsupported), () => {});
  assert.match(root.textContent, /1999 supported occurrences and 1 unsupported occurrences/);
  assert.match(root.textContent, /Showing 1–40 of 2000/);
  assert.equal(descendants(root).filter(item => item.tag === 'details').length, 40);
  for (let i = 0; i < 49; i++) findButton(root, 'Next occurrences').click();
  assert.match(root.textContent, /Showing 1961–2000 of 2000/);
  assert.match(root.textContent, /module-1998/);
  assert.match(root.textContent, /Unsupported: CallExpression/);
  assert.equal(findButton(root, 'Next occurrences'), undefined);
  findButton(root, 'Previous occurrences').click();
  assert.match(root.textContent, /Showing 1921–1960 of 2000/);
});
