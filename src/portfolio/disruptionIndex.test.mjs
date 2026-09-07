import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHOKEPOINTS,
  computeDisruptionIndex,
  correlate,
  countTankersInGate,
  departureScore,
  findLeadLag,
  isTankerInGate,
  median,
  realisedVolatility,
  stdDev,
} from './disruptionIndex.js';

const HORMUZ = CHOKEPOINTS.hormuz;

test('isTankerInGate needs both the box and the ship type', () => {
  const inside = { lat: 26.4, lon: 56.5, shipType: 'Crude Oil Tanker' };
  assert.equal(isTankerInGate(inside, HORMUZ), true);

  assert.equal(isTankerInGate({ ...inside, shipType: 'Container Ship' }, HORMUZ), false);
  assert.equal(isTankerInGate({ ...inside, lat: 40 }, HORMUZ), false);
  assert.equal(isTankerInGate({ ...inside, lat: NaN }, HORMUZ), false);
  assert.equal(isTankerInGate(null, HORMUZ), false);
});

test('countTankersInGate counts only qualifying vessels', () => {
  const { count, vessels } = countTankersInGate([
    { lat: 26.4, lon: 56.5, shipType: 'Crude Oil Tanker' },
    { lat: 26.5, lon: 56.6, shipType: 'LNG Tanker' },
    { lat: 26.5, lon: 56.6, shipType: 'Bulk Carrier' },
    { lat: 10.0, lon: 20.0, shipType: 'Crude Oil Tanker' },
  ], HORMUZ);
  assert.equal(count, 2);
  assert.equal(vessels.length, 2);
});

test('stdDev and median handle short and dirty input', () => {
  assert.equal(stdDev([]), null);
  assert.equal(stdDev([5]), null);
  assert.ok(Math.abs(stdDev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01);
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('departureScore reads 50 at the trailing median', () => {
  const history = [10, 10, 10, 12, 8, 10, 11, 9];
  assert.equal(departureScore(10, history), 50);
});

test('departureScore rises as the metric departs upward', () => {
  const history = [10, 10, 10, 12, 8, 10, 11, 9];
  assert.ok(departureScore(14, history) > 50);
  assert.ok(departureScore(6, history) < 50);
});

test('departureScore inverts for metrics where a FALL is the risk', () => {
  const history = [100, 102, 98, 101, 99, 100, 103, 97];
  // Transits collapsing is the signal, so "below" must score high.
  assert.ok(departureScore(80, history, { direction: 'below' }) > 50);
  assert.ok(departureScore(120, history, { direction: 'below' }) < 50);
});

test('departureScore returns null without usable history', () => {
  assert.equal(departureScore(10, []), null);
  assert.equal(departureScore(10, [5, 5, 5, 5]), null, 'zero variance gives no scale');
  assert.equal(departureScore(NaN, [1, 2, 3]), null);
});

test('realisedVolatility needs a full window', () => {
  assert.equal(realisedVolatility([{ period: 'a', value: 70 }], 14), null);
  const points = Array.from({ length: 30 }, (_, i) => ({
    period: `2026-01-${String(i + 1).padStart(2, '0')}`,
    value: 70 + Math.sin(i) * 2,
  }));
  const vol = realisedVolatility(points, 14);
  assert.ok(Number.isFinite(vol) && vol > 0);
});

test('the index is null — not 50 — when nothing is measurable', () => {
  const result = computeDisruptionIndex({});
  assert.equal(result.index, null);
  assert.equal(result.level, 'unavailable');
  assert.equal(result.confidence, 'unavailable');
  assert.match(result.readout, /not computed/);
});

test('a partial index says how partial it is', () => {
  const result = computeDisruptionIndex({
    transits: { current: 60, history: [100, 102, 98, 101, 99, 100, 103, 97] },
  });
  assert.ok(Number.isFinite(result.index));
  assert.deepEqual(result.available, ['transits']);
  assert.equal(result.missing.length, 3);
  assert.equal(result.confidence, 'partial-1-of-4');
  assert.match(result.readout, /1 of 4 components/);
});

test('a collapse in transits drives the index high', () => {
  const steady = [100, 102, 98, 101, 99, 100, 103, 97];
  const calm = computeDisruptionIndex({ transits: { current: 100, history: steady } });
  const alarming = computeDisruptionIndex({ transits: { current: 55, history: steady } });
  assert.ok(alarming.index > calm.index);
  assert.equal(alarming.level, 'high');
});

test('components combine on the weights of only what was available', () => {
  const result = computeDisruptionIndex({
    transits: { current: 55, history: [100, 102, 98, 101, 99, 100, 103, 97] },
    volatility: { current: 60, history: [20, 22, 19, 21, 20, 23, 18, 20] },
  });
  assert.equal(result.available.length, 2);
  // Both components scream; a weighted mean over only those two must too, and
  // must not be diluted toward 50 by the missing pair.
  assert.ok(result.index > 70, `got ${result.index}`);
});

test('every component is reported even when it scored null', () => {
  const result = computeDisruptionIndex({
    transits: { current: 90, history: [100, 102, 98, 101, 99, 100, 103, 97] },
  });
  assert.equal(result.components.eventVolume.score, null);
  assert.equal(result.components.eventVolume.current, null);
  assert.ok(result.components.transits.score !== null);
});

test('correlate finds a perfect positive relationship', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.equal(correlate(a, a.map((x) => x * 2 + 1)), 1);
});

test('correlate finds a perfect inverse relationship', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.equal(correlate(a, a.map((x) => -x)), -1);
});

test('correlate returns null without enough overlap or variance', () => {
  assert.equal(correlate([1, 2], [1, 2]), null);
  assert.equal(correlate([1, 1, 1, 1], [1, 2, 3, 4]), null);
});

test('findLeadLag recovers a known two-period lead', () => {
  // `following` is `leading` shifted two periods later.
  const leading = [1, 5, 2, 8, 3, 9, 4, 7, 2, 6, 1, 8];
  const following = [0, 0, 1, 5, 2, 8, 3, 9, 4, 7, 2, 6];
  const { bestLag, bestCorrelation } = findLeadLag(leading, following, { maxLag: 5 });
  assert.equal(bestLag, 2);
  assert.ok(bestCorrelation > 0.95);
});

test('findLeadLag reports a weak correlation honestly rather than hiding it', () => {
  const noise = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
  const unrelated = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5];
  const { bestCorrelation } = findLeadLag(noise, unrelated, { maxLag: 4 });
  // The point is that a number comes back at all — a weak one reported is a
  // feature; the failure mode would be asserting a strong one.
  assert.ok(bestCorrelation !== null);
  assert.ok(Math.abs(bestCorrelation) <= 1);
});

test('findLeadLag degrades to nulls on unusable input', () => {
  const result = findLeadLag([], [], { maxLag: 3 });
  assert.equal(result.bestLag, null);
  assert.deepEqual(result.byLag, []);
});

test('the chokepoint gates cover the real straits', () => {
  // Hormuz proper sits around 26.6N 56.5E.
  assert.ok(26.6 >= HORMUZ.south && 26.6 <= HORMUZ.north);
  assert.ok(56.5 >= HORMUZ.west && 56.5 <= HORMUZ.east);
  for (const gate of Object.values(CHOKEPOINTS)) {
    assert.ok(gate.north > gate.south, `${gate.id} box is inverted`);
    assert.ok(gate.east > gate.west, `${gate.id} box is inverted`);
    assert.ok(gate.name && gate.note);
  }
});
