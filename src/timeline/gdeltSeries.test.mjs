// src/timeline/gdeltSeries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGdeltDate, parseGdeltSeries, pointAt } from './gdeltSeries.js';

test('parseGdeltDate reads GDELT timeline stamps', () => {
  assert.equal(parseGdeltDate('20261117T000000Z'), Date.UTC(2026, 10, 17));
  assert.equal(parseGdeltDate('20261117T134500Z'), Date.UTC(2026, 10, 17, 13, 45));
  assert.equal(parseGdeltDate('20261117'), Date.UTC(2026, 10, 17));
  assert.ok(Number.isNaN(parseGdeltDate('yesterday')));
});

test('parseGdeltSeries keeps dated points, drops unreadable ones, sorts', () => {
  const points = parseGdeltSeries({
    timeline: [{
      series: 'Volume Intensity',
      data: [
        { date: '20261118T000000Z', value: 0.42 },
        { date: '20261117T000000Z', value: '0.31' },
        { date: 'bad', value: 1 },
        { date: '20261119T000000Z', value: 'n/a' },
      ],
    }],
  });
  assert.deepEqual(points, [
    { t: Date.UTC(2026, 10, 17), value: 0.31 },
    { t: Date.UTC(2026, 10, 18), value: 0.42 },
  ]);
  assert.deepEqual(parseGdeltSeries(null), []);
});

test('pointAt returns the value in force, and a gap as null', () => {
  const H = 3_600_000;
  const points = [{ t: 0, value: 1 }, { t: H, value: 2 }, { t: 10 * H, value: 3 }];
  assert.equal(pointAt(points, 30 * 60_000).value, 1);
  assert.equal(pointAt(points, H).value, 2);
  assert.equal(pointAt(points, 6 * H), null, 'five hours past the last point is a gap');
  assert.equal(pointAt(points, -1), null);
  assert.equal(pointAt([], 0), null);
});
