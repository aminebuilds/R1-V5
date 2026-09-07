// AG-UI event protocol for the explain board.
//
// These pin the two things a renderer depends on: a run's events fold into one
// document in order, and a STATE_DELTA is a real RFC 6902 patch rather than a
// merge dressed up as one. The patch path matters — progressive fill (a price
// block arriving after its traffic block) addresses a nested field by pointer.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperation,
  applyPatch,
  createExplainStream,
  CUSTOM_EVENT,
  EVENT,
  initialExplainState,
  isExplainEvent,
  parsePointer,
  reduceExplainEvent,
  reduceExplainEvents,
} from './agui.js';

test('parsePointer decodes escaped tokens and the whole-document pointer', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/blocks/0/rows'), ['blocks', '0', 'rows']);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.throws(() => parsePointer('blocks/0'), /Invalid JSON Pointer/);
});

test('applyOperation supports add, replace and remove on objects and arrays', () => {
  const doc = { blocks: [{ id: 'a', value: 1 }], meta: { scope: 'view' } };

  applyOperation(doc, { op: 'replace', path: '/blocks/0/value', value: 2 });
  assert.equal(doc.blocks[0].value, 2);

  applyOperation(doc, { op: 'add', path: '/blocks/-', value: { id: 'b' } });
  assert.equal(doc.blocks.length, 2);

  applyOperation(doc, { op: 'remove', path: '/meta/scope' });
  assert.equal('scope' in doc.meta, false);

  assert.throws(() => applyOperation(doc, { op: 'copy', path: '/meta/x' }), /Unsupported patch op/);
  assert.throws(() => applyOperation(doc, { op: 'replace', path: '/nope/deep' }), /does not exist/);
});

test('applyPatch is all-or-nothing and never mutates the input', () => {
  const before = { blocks: [{ id: 'a', value: 1 }] };
  const after = applyPatch(before, [{ op: 'replace', path: '/blocks/0/value', value: 9 }]);
  assert.equal(before.blocks[0].value, 1, 'input document must be untouched');
  assert.equal(after.blocks[0].value, 9);

  assert.throws(
    () => applyPatch(before, [
      { op: 'replace', path: '/blocks/0/value', value: 5 },
      { op: 'replace', path: '/missing/thing', value: 5 },
    ]),
    /does not exist/,
  );
  assert.equal(before.blocks[0].value, 1, 'a failed patch leaves the original alone');
});

test('a run folds into one document in event order', () => {
  const state = reduceExplainEvents([
    { type: EVENT.RUN_STARTED, runId: 'run-1', question: 'How is this view doing?', scope: 'in view', action: 'get_view_health' },
    { type: EVENT.STEP_STARTED, step: 'get view health' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'head:0', type: 'head', question: 'How is this view doing?' } },
    { type: EVENT.STEP_FINISHED, step: 'get view health' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'verdict:1', type: 'verdict', text: '4 sites in view.' } },
    { type: EVENT.RUN_FINISHED },
  ]);

  assert.equal(state.status, 'finished');
  assert.equal(state.question, 'How is this view doing?');
  assert.deepEqual(state.blocks.map((block) => block.id), ['head:0', 'verdict:1']);
  assert.equal(state.steps[0].status, 'done');
});

test('a block re-emitted with the same id updates in place, keeping its position', () => {
  const state = reduceExplainEvents([
    { type: EVENT.RUN_STARTED, runId: 'run-2', question: 'q' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'head:0', type: 'head', question: 'q', status: 'pending' } },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'verdict:1', type: 'verdict', text: 'later' } },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'head:0', type: 'head', question: 'q', status: 'ready' } },
  ]);

  assert.equal(state.blocks.length, 2);
  assert.equal(state.blocks[0].id, 'head:0');
  assert.equal(state.blocks[0].status, 'ready', 'the update replaced the pending header');
});

test('RUN_STARTED clears the previous run so two answers never blend', () => {
  const first = reduceExplainEvents([
    { type: EVENT.RUN_STARTED, runId: 'run-3', question: 'first' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'note:0', type: 'note', text: 'stale' } },
    { type: EVENT.RUN_FINISHED },
  ]);
  const second = reduceExplainEvent(first, { type: EVENT.RUN_STARTED, runId: 'run-4', question: 'second' });

  assert.equal(second.blocks.length, 0);
  assert.equal(second.question, 'second');
  assert.equal(second.status, 'running');
});

test('an unapplyable STATE_DELTA leaves the board it was patching intact', () => {
  const before = reduceExplainEvents([
    { type: EVENT.RUN_STARTED, runId: 'run-5', question: 'q' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'note:0', type: 'note', text: 'kept' } },
  ]);
  const after = reduceExplainEvent(before, { type: EVENT.STATE_DELTA, delta: [{ op: 'replace', path: '/nope/x', value: 1 }] });
  assert.equal(after.blocks[0].text, 'kept');
});

test('STATE_DELTA patches a nested block field', () => {
  const before = reduceExplainEvents([
    { type: EVENT.RUN_STARTED, runId: 'run-6', question: 'q' },
    { type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value: { id: 'readouts:0', type: 'readouts', items: [{ label: 'Price', value: '—' }] } },
  ]);
  const after = reduceExplainEvent(before, {
    type: EVENT.STATE_DELTA,
    delta: [{ op: 'replace', path: '/blocks/0/items/0/value', value: '3.219' }],
  });
  assert.equal(after.blocks[0].items[0].value, '3.219');
});

test('unknown and malformed events are ignored rather than throwing', () => {
  const state = initialExplainState();
  assert.equal(isExplainEvent({ type: 'NOT_A_THING' }), false);
  assert.equal(reduceExplainEvent(state, { type: 'NOT_A_THING' }), state);
  assert.equal(reduceExplainEvent(state, null), state);
});

test('the stream notifies subscribers with the reduced state', () => {
  const stream = createExplainStream({ now: () => '2026-09-06T00:00:00.000Z' });
  const seen = [];
  const unsubscribe = stream.subscribe((state, event) => seen.push([event.type, state.blocks.length]));

  stream.startRun({ question: 'q', scope: 'in view', action: 'get_view_health' });
  const done = stream.step('get view health');
  stream.block({ id: 'note:0', type: 'note', text: 'x' });
  done();
  stream.finish();

  assert.deepEqual(seen.map(([type]) => type), [
    EVENT.RUN_STARTED, EVENT.STEP_STARTED, EVENT.CUSTOM, EVENT.STEP_FINISHED, EVENT.RUN_FINISHED,
  ]);
  assert.equal(stream.getState().status, 'finished');
  assert.equal(stream.getState().blocks.length, 1);
  unsubscribe();
});

test('a throwing subscriber cannot break the stream for the others', () => {
  const stream = createExplainStream();
  const seen = [];
  stream.subscribe(() => { throw new Error('boom'); });
  stream.subscribe((state) => seen.push(state.status));
  stream.startRun({ question: 'q' });
  assert.deepEqual(seen, ['running']);
});

test('a step closes exactly once', () => {
  const stream = createExplainStream();
  stream.startRun({ question: 'q' });
  const done = stream.step('work');
  done();
  done();
  assert.equal(stream.getState().steps.filter((step) => step.status === 'done').length, 1);
});
