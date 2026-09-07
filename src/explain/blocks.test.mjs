// The block vocabulary.
//
// The invariant worth a test suite: an absent measurement renders as a dash
// and never as a number. Every formatter here is the last place a `null` can
// be turned into something that looks like data, so each one is pinned.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  chain,
  evidence,
  fmtCentsSigned,
  fmtInt,
  fmtMeters,
  fmtNum,
  fmtPct,
  fmtRatio,
  fmtUsd,
  gap,
  head,
  multiples,
  NO_VALUE,
  plays,
  PROVENANCE,
  provenance,
  provenanceForConfidence,
  ranked,
  readouts,
  validateBlock,
  validateBlocks,
  verdict,
  withIds,
} from './blocks.js';

test('every formatter turns an absent value into the dash, not a zero', () => {
  for (const format of [fmtInt, fmtNum, fmtUsd, fmtCentsSigned, fmtMeters, fmtPct]) {
    assert.equal(format(null), NO_VALUE, `${format.name}(null)`);
    assert.equal(format(undefined), NO_VALUE, `${format.name}(undefined)`);
    assert.equal(format(Number.NaN), NO_VALUE, `${format.name}(NaN)`);
  }
  assert.equal(fmtRatio(3, null), NO_VALUE);
  assert.equal(fmtRatio(3, 0), NO_VALUE, 'a zero denominator has no honest ratio');
});

test('formatters keep zero as zero — measured nothing is not missing', () => {
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtUsd(0), '$0');
  assert.equal(fmtCentsSigned(0), '0.0¢');
  assert.equal(fmtRatio(0, 12), '0/12');
});

test('signed cents carry their sign, metres switch to km above 1000', () => {
  assert.equal(fmtCentsSigned(3.44), '+3.4¢');
  assert.equal(fmtCentsSigned(-2.5), '−2.5¢');
  assert.equal(fmtMeters(840), '840 m');
  assert.equal(fmtMeters(1800), '1.8 km');
});

test('an unknown provenance degrades to unmeasured rather than inventing confidence', () => {
  assert.equal(provenance('nonsense').key, 'unmeasured');
  assert.equal(provenance('measured').tone, 'signal');
  assert.equal(provenance('unavailable').tone, 'alert');
  for (const [key, meta] of Object.entries(PROVENANCE)) {
    assert.ok(meta.label && meta.tone && meta.note, `${key} is fully described`);
  }
});

test('engine confidence strings map onto provenance keys', () => {
  assert.equal(provenanceForConfidence('measured'), 'measured');
  assert.equal(provenanceForConfidence('measured-inputs-ranked'), 'ranked');
  assert.equal(provenanceForConfidence('modelled-and-backtested'), 'modelled');
  assert.equal(provenanceForConfidence('requires-actuals'), 'unmeasured');
  assert.equal(provenanceForConfidence('unavailable'), 'unavailable');
  assert.equal(provenanceForConfidence('no-key'), 'unavailable');
  assert.equal(provenanceForConfidence(null), 'unmeasured');
});

test('readouts normalise a null value to the dash', () => {
  const block = readouts({ items: [{ label: 'Gap', value: null }, { label: 'Sites', value: '4', unit: 'ea' }] });
  assert.equal(block.items[0].value, NO_VALUE);
  assert.equal(block.items[1].unit, 'ea');
  assert.equal(block.items[0].kind, 'measured');
});

test('ranked and multiples hand out matching keys so blocks cross-reference', () => {
  const rows = [{ label: 'A site', value: 90 }, { label: 'B site', value: 40 }];
  const rankedBlock = ranked({ rows });
  const tilesBlock = multiples({ tiles: rows.map((row) => ({ label: row.label, value: row.value })) });
  assert.deepEqual(rankedBlock.rows.map((row) => row.key), ['A', 'B']);
  assert.deepEqual(tilesBlock.tiles.map((tile) => tile.key), ['A', 'B']);
});

test('ranked drops a non-numeric value to null instead of coercing it to zero', () => {
  const block = ranked({ rows: [{ label: 'x', value: 'n/a', display: NO_VALUE }] });
  assert.equal(block.rows[0].value, null);
  assert.equal(block.rows[0].display, NO_VALUE);
});

test('a chain stage with an unknown state falls back to not-applicable', () => {
  const block = chain({ stages: [{ label: 'x', state: 'sideways' }] });
  assert.equal(block.stages[0].state, 'na');
  assert.equal(block.stages[0].key, '01');
});

test('plays default to requiring approval', () => {
  const block = plays({ cards: [{ id: 'p', name: 'n', action: 'a' }] });
  assert.equal(block.cards[0].approval, 'required');
  assert.equal(block.cards[0].lift.display, NO_VALUE);
});

test('withIds assigns deterministic, addressable ids', () => {
  const blocks = withIds([head({ question: 'q' }), verdict({ text: 'v' }), null]);
  assert.deepEqual(blocks.map((block) => block.id), ['head:0', 'verdict:1']);
});

test('validation catches the structural mistakes that would render a lie', () => {
  assert.deepEqual(validateBlock(head({ question: 'q' })), []);
  assert.match(validateBlock({ type: 'nope' })[0], /unknown block type/);
  assert.match(validateBlock(gap({ title: 't', reason: '' }))[0], /no reason/);
  assert.match(
    validateBlock(evidence({ rows: [{ claim: 'c', source: '', kind: 'measured' }] }))[0],
    /without a source/,
  );
  const report = validateBlocks([head({ question: '' })]);
  assert.equal(report.ok, false);
  assert.match(report.problems[0], /^\[0\]/);
});

test('the renderer and the vocabulary agree on the type list', () => {
  assert.equal(new Set(BLOCK_TYPES).size, BLOCK_TYPES.length, 'no duplicate block types');
  assert.ok(BLOCK_TYPES.includes('gap'), 'the cannot-tell block is part of the vocabulary');
});
