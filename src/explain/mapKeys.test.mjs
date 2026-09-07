// Lettered map keys.
//
// The collection rule is the whole contract: a key on the globe must be the
// same key the board printed, for the same subject, and a subject without
// coordinates must be skipped rather than placed somewhere plausible.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiples, ranked, withIds } from './blocks.js';
import { collectMapKeys, toneColor } from './mapKeys.js';

test('ranked rows with coordinates become keyed map subjects', () => {
  const blocks = withIds([ranked({
    rows: [
      { label: 'Store 1', value: 82, display: '82/100', tone: 'alert', focus: { id: 's1', lat: 41.6, lon: -93.6, label: "Casey's #418" } },
      { label: 'Store 2', value: 61, display: '61/100', tone: 'caution', focus: { id: 's2', lat: 41.7, lon: -93.7, label: "Casey's #77" } },
    ],
  })]);

  assert.deepEqual(collectMapKeys(blocks), [
    { key: 'A', lat: 41.6, lon: -93.6, label: "Casey's #418", tone: 'alert' },
    { key: 'B', lat: 41.7, lon: -93.7, label: "Casey's #77", tone: 'caution' },
  ]);
});

test('a subject with no coordinates is skipped, never placed at a guess', () => {
  const blocks = withIds([ranked({
    rows: [
      { label: 'Located', value: 1, focus: { lat: 10, lon: 20 } },
      { label: 'Unlocated', value: 2, focus: null },
      { label: 'Half located', value: 3, focus: { lat: 10, lon: null } },
    ],
  })]);
  assert.deepEqual(collectMapKeys(blocks).map((entry) => entry.key), ['A']);
});

test('ranked and multiples share a letter without producing two badges', () => {
  const focus = { lat: 30.2, lon: -97.7, label: 'Site A' };
  const blocks = withIds([
    ranked({ rows: [{ label: 'Site A', value: 80, focus }] }),
    multiples({ tiles: [{ label: 'Site A', value: 80, focus, tone: 'caution' }] }),
  ]);

  const keys = collectMapKeys(blocks);
  assert.equal(keys.length, 1, 'one subject, one badge');
  assert.equal(keys[0].tone, 'signal', 'the ranked row wins the tie');
});

test('a tile-only board still produces keys', () => {
  const blocks = withIds([multiples({
    tiles: [{ label: 'Only tile', value: 5, focus: { lat: 1, lon: 2, label: 'Only tile' } }],
  })]);
  assert.deepEqual(collectMapKeys(blocks).map((entry) => entry.key), ['A']);
});

test('boards with nothing locatable place nothing', () => {
  assert.deepEqual(collectMapKeys([]), []);
  assert.deepEqual(collectMapKeys(null), []);
  assert.deepEqual(collectMapKeys(withIds([ranked({ rows: [] })])), []);
});

test('tone resolves to the V5 hue, falling back off the stylesheet', () => {
  assert.equal(toneColor('signal', undefined), '#62E0A8');
  assert.equal(toneColor('alert', undefined), '#FF6A45');
  assert.equal(toneColor('nonsense', undefined), '#62E0A8', 'an unknown tone is not a crash');
});
