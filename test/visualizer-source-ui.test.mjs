import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveIndex } from '../live-index.mjs';
import { sourceExcerpt } from '../server.mjs';
import { decorateScope, sourcePagingControls, updateCardContent } from '../public/visualizer.js';

// Only the DOM operations used by the production renderers; no copied UI logic.
class Element {
  dataset = {};
  children = [];
  listeners = new Map();
  textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  click() { this.listeners.get('click')?.(); }
}

function fixture(t, source) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => new Element() };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mind-source-ui-'));
  const file = path.join(root, 'sample.mjs');
  fs.writeFileSync(file, source);
  const live = new LiveIndex(root, { intervalMs: 60000 });
  t.after(() => {
    live.close();
    fs.rmSync(root, { recursive: true, force: true });
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  return { root, file, live };
}

for (const length of [1, 71, 72, 134, 300]) {
  test(`source paging buttons cover all ${length} lines through the source API and stop at EOF`, t => {
    const source = Array.from({ length }, (_, i) => `// source line ${i + 1}`).join('\r\n');
    const { root, live } = fixture(t, source);
    const seen = new Set();
    let excerpt = sourceExcerpt(root, live.graph, 'sample.mjs');
    let pages = 0;
    while (true) {
      for (const line of excerpt.lines) {
        seen.add(line.number);
        assert.equal(line.text, `// source line ${line.number}`);
      }
      const last = excerpt.lines.at(-1).number;
      const controls = sourcePagingControls(excerpt, line => {
        excerpt = sourceExcerpt(root, live.graph, 'sample.mjs', line);
      });
      const next = controls.children.find(control => control.textContent === '↓ Next lines');
      if (!next) { assert.equal(last, length); break; }
      next.click();
      assert.ok(excerpt.lines[0].number <= last + 1, 'next page must not skip unread lines');
      assert.ok(excerpt.lines.at(-1).number > last, 'next page must advance');
      assert.ok(++pages <= length, 'paging must terminate');
    }
    assert.deepEqual([...seen], Array.from({ length }, (_, i) => i + 1));
    const controls = sourcePagingControls(excerpt, line => {
      excerpt = sourceExcerpt(root, live.graph, 'sample.mjs', line);
    });
    const previous = controls.children.find(control => control.textContent === '↑ Previous lines');
    assert.equal(Boolean(previous), excerpt.startLine > 1);
    if (previous) {
      const start = excerpt.startLine;
      previous.click();
      assert.ok(excerpt.startLine < start, 'previous page must move back');
    }
  });
}

test('a moved symbol updates the existing card footer and retains its other content', t => {
  const source = 'export function sample() { return 1; }\n';
  const { file, live } = fixture(t, source);
  const symbol = live.graph.hierarchy.nodes.find(node => node.sourceName === 'sample' && node.kind === 'symbol');
  assert.ok(symbol);
  const displayNode = graph => decorateScope({ nodes: [graph.hierarchy.nodes.find(node => node.id === symbol.id)] }, graph).nodes[0];
  const card = new Element();
  card.dataset.id = symbol.id;
  updateCardContent(card, displayNode(live.graph), 0);
  const initialChildren = card.children;
  assert.equal(card.children[1].children[1].textContent, 'line 1 · 0 relations');
  updateCardContent(card, displayNode(live.graph), 0);
  assert.equal(card.children, initialChildren, 'unchanged card should retain its children');

  fs.writeFileSync(file, '\n\n\n' + source);
  const graph = live.refresh();
  const moved = displayNode(graph);
  assert.equal(moved.id, symbol.id);
  assert.equal(moved.line, 4);
  updateCardContent(card, moved, 0);
  assert.notEqual(card.children, initialChildren, 'line-only changes must invalidate rendered content');
  assert.equal(card.children[1].children[1].textContent, 'line 4 · 0 relations');
  assert.equal(card.dataset.id, symbol.id);
  assert.equal(card.children[0].children[1].children[0].textContent, 'sample');
});
