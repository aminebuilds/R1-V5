// Blocks → DOM.
//
// The behaviour worth pinning is reconciliation. A board resolves in pieces —
// the header lands before the engine answers, the price block after the
// traffic block — so an unchanged block must keep its node (and with it the
// operator's scroll position and focus), a changed one must be replaced in
// place, and a block that disappeared must be removed. The rest of the file
// checks that a row carrying coordinates becomes a camera hand-off.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chain, evidence, gap, head, plays, ranked, readouts, verdict, withIds } from './blocks.js';
import { renderBlock, renderExplain, signatureOf } from './render.js';

/** Minimal element stand-in: the renderer only needs structure and attrs. */
function makeDoc() {
  const makeElement = (tagName, namespace = null) => {
    const element = {
      tagName,
      namespace,
      className: '',
      textContent: '',
      title: '',
      hidden: false,
      dataset: {},
      style: {},
      attributes: {},
      listeners: {},
      children: [],
      parent: null,
      get nextSibling() {
        if (!element.parent) return null;
        const at = element.parent.children.indexOf(element);
        return at === -1 ? null : element.parent.children[at + 1] || null;
      },
      appendChild(child) {
        child.parent = element;
        element.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        const at = ref ? element.children.indexOf(ref) : -1;
        child.parent = element;
        if (at === -1) element.children.push(child);
        else element.children.splice(at, 0, child);
        return child;
      },
      replaceChild(next, current) {
        const at = element.children.indexOf(current);
        if (at === -1) return current;
        next.parent = element;
        element.children[at] = next;
        current.parent = null;
        return current;
      },
      removeChild(child) {
        const at = element.children.indexOf(child);
        if (at !== -1) element.children.splice(at, 1);
        child.parent = null;
        return child;
      },
      replaceChildren() {
        element.children = [];
      },
      append(...nodes) {
        for (const node of nodes) element.appendChild(node);
      },
      setAttribute(name, value) {
        element.attributes[name] = String(value);
      },
      getAttribute(name) {
        return element.attributes[name] ?? null;
      },
      addEventListener(type, handler) {
        (element.listeners[type] ||= []).push(handler);
      },
      dispatch(type, event = {}) {
        for (const handler of element.listeners[type] || []) handler(event);
      },
    };
    return element;
  };

  return {
    createElement: (tagName) => makeElement(tagName),
    createElementNS: (ns, tagName) => makeElement(tagName, ns),
  };
}

/** Depth-first search for the first node matching a class. */
function findByClass(node, className) {
  if (!node) return null;
  if (String(node.className).split(/\s+/).includes(className)) return node;
  for (const child of node.children || []) {
    const hit = findByClass(child, className);
    if (hit) return hit;
  }
  return null;
}

/** Every node matching a class. */
function collectByClass(node, className, out = []) {
  if (!node) return out;
  if (String(node.className).split(/\s+/).includes(className)) out.push(node);
  for (const child of node.children || []) collectByClass(child, className, out);
  return out;
}

test('a block renders inside a wrapper carrying its identity and signature', () => {
  const doc = makeDoc();
  const block = withIds([head({ question: 'How is this view doing?', scope: 'in view', action: 'get_view_health' })])[0];
  const node = renderBlock(block, { doc });

  assert.equal(node.dataset.blockType, 'head');
  assert.equal(node.dataset.blockId, 'head:0');
  assert.equal(node.dataset.sig, signatureOf(block));
  assert.equal(findByClass(node, 'xp-head-question').textContent, 'How is this view doing?');
});

test('an unknown block type renders nothing instead of throwing', () => {
  const doc = makeDoc();
  assert.equal(renderBlock({ type: 'hologram', id: 'x' }, { doc }), null);
  assert.equal(renderBlock(null, { doc }), null);
});

test('provenance is the only thing that colours a block', () => {
  const doc = makeDoc();
  const node = renderBlock(
    withIds([evidence({
      rows: [
        { claim: 'Drivers are slowed', source: 'trafficDelayEngine', kind: 'measured' },
        { claim: 'It will lift sales', source: 'no holdout test', kind: 'unmeasured' },
      ],
    })])[0],
    { doc },
  );

  const rows = collectByClass(node, 'xp-ev-row');
  assert.deepEqual(rows.map((row) => row.dataset.tone), ['signal', 'ghost']);
  assert.deepEqual(collectByClass(node, 'xp-kind').map((chip) => chip.textContent), ['Measured', 'Unmeasured']);
});

test('chain stage states reach the DOM so the diagram can read them', () => {
  const doc = makeDoc();
  const node = renderBlock(
    withIds([chain({
      stages: [
        { label: 'Congestion measured', value: '11.4 min', state: 'met' },
        { label: 'Approach side', value: 'far', state: 'unmet' },
        { label: 'Expected lift', value: '—', state: 'na' },
      ],
    })])[0],
    { doc },
  );
  assert.deepEqual(collectByClass(node, 'xp-stage').map((stage) => stage.dataset.state), ['met', 'unmet', 'na']);
});

test('a trigger that was not met is marked, not omitted', () => {
  const doc = makeDoc();
  const node = renderBlock(
    withIds([plays({
      cards: [{
        id: 'play:x',
        name: 'A play',
        action: 'Do the thing',
        triggers: [
          { label: 'Delay ≥ 8 min', display: '11.4 min', met: true },
          { label: 'Near side', display: 'far', met: false },
          { label: 'Score ≥ 65', display: '—', met: null },
        ],
      }],
    })])[0],
    { doc },
  );
  const marks = collectByClass(node, 'xp-trigger').map((row) => [row.dataset.met, findByClass(row, 'xp-trigger-mark').textContent]);
  assert.deepEqual(marks, [['true', '✓'], ['false', '×'], ['unknown', '?']]);
});

test('a row with coordinates hands off to the camera; one without does not', () => {
  const doc = makeDoc();
  const flown = [];
  const node = renderBlock(
    withIds([ranked({
      rows: [
        { label: 'Store 1', value: 80, display: '80/100', focus: { lat: 41.6, lon: -93.6, id: 's1', label: 'Store 1' } },
        { label: 'Store 2', value: 40, display: '40/100', focus: null },
      ],
    })])[0],
    { doc, onFocus: (focus) => flown.push(focus) },
  );

  const rows = collectByClass(node, 'xp-rank-row');
  assert.equal(rows[0].dataset.focusable, 'true');
  assert.equal(rows[1].dataset.focusable, undefined);

  rows[0].dispatch('click');
  assert.deepEqual(flown, [{ lat: 41.6, lon: -93.6, id: 's1', label: 'Store 1' }]);

  rows[0].dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(flown.length, 2);
  rows[0].dispatch('keydown', { key: 'Tab', preventDefault() {} });
  assert.equal(flown.length, 2, 'Tab must still move focus, not fly the camera');
});

test('reconciliation keeps unchanged nodes and replaces only what changed', () => {
  const doc = makeDoc();
  const container = doc.createElement('div');

  const first = withIds([
    head({ question: 'q', status: 'pending' }),
    verdict({ text: 'partial', kind: 'derived' }),
  ]);
  renderExplain(container, { blocks: first, status: 'running' }, { doc });
  assert.equal(container.children.length, 2);
  assert.equal(container.dataset.status, 'running');

  const verdictNode = container.children[1];
  const second = withIds([
    head({ question: 'q', status: 'ready' }),
    verdict({ text: 'partial', kind: 'derived' }),
  ]);
  renderExplain(container, { blocks: second, status: 'finished' }, { doc });

  assert.equal(container.children.length, 2);
  assert.equal(container.children[1], verdictNode, 'the unchanged verdict kept its node');
  assert.notEqual(container.children[0].dataset.sig, signatureOf(first[0]), 'the header was replaced');
  assert.equal(findByClass(container.children[0], 'xp-head-meta').dataset.status, 'ready');
});

test('blocks appended mid-run land in composed order', () => {
  const doc = makeDoc();
  const container = doc.createElement('div');

  renderExplain(container, { blocks: withIds([head({ question: 'q' })]) }, { doc });
  const full = withIds([head({ question: 'q' }), readouts({ items: [{ label: 'Sites', value: '6' }] }), gap({ title: 'g', reason: 'r' })]);
  renderExplain(container, { blocks: full }, { doc });

  assert.deepEqual(container.children.map((child) => child.dataset.blockId), ['head:0', 'readouts:1', 'gap:2']);
});

test('a block that disappears is removed', () => {
  const doc = makeDoc();
  const container = doc.createElement('div');
  renderExplain(container, { blocks: withIds([head({ question: 'q' }), gap({ title: 'g', reason: 'r' })]) }, { doc });
  renderExplain(container, { blocks: withIds([head({ question: 'q' })]) }, { doc });
  assert.deepEqual(container.children.map((child) => child.dataset.blockId), ['head:0']);
});

test('rendering into nothing is a no-op rather than a crash', () => {
  assert.equal(renderExplain(null, { blocks: [] }, {}), 0);
  assert.equal(renderExplain({}, { blocks: [] }, { doc: { } }), 0);
});
