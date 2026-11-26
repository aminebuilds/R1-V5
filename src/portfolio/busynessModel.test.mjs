import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT_WEIGHTS,
  HOURLY_DEMAND_CURVE,
  estimateBusyness,
  formatWeight,
} from './busynessModel.js';

test('no congestion reading means unavailable, never a guessed score', () => {
  const result = estimateBusyness(null, { hour: 18 });
  assert.equal(result.score, null);
  assert.equal(result.confidence, 'unavailable');
  assert.ok(result.basis.length > 0);

  const stillNothing = estimateBusyness({ trafficLevel: null }, { hour: 9 });
  assert.equal(stillNothing.score, null);
  assert.equal(stillNothing.confidence, 'unavailable');
});

test('a measured congestion reading produces a modelled score in 0-100', () => {
  const result = estimateBusyness({ trafficLevel: 0.8 }, { hour: 18, format: 'convenience' });
  assert.equal(result.confidence, 'modelled');
  assert.ok(Number.isInteger(result.score));
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.hour, 18);
  assert.ok(result.basis.some((line) => line.includes('convenience')));
});

test('the score follows the hourly demand curve at a fixed congestion level', () => {
  const peak = estimateBusyness({ trafficLevel: 0.5 }, { hour: 18 }); // curve = 1.00
  const trough = estimateBusyness({ trafficLevel: 0.5 }, { hour: 3 }); // curve = 0.04
  assert.ok(peak.score > trough.score, 'evening peak hour must score above the overnight trough');
});

test('format weight amplifies or dampens the same congestion + hour', () => {
  const plaza = estimateBusyness({ trafficLevel: 0.6 }, { hour: 12, format: 'travel plaza' });
  const kiosk = estimateBusyness({ trafficLevel: 0.6 }, { hour: 12, format: 'kiosk' });
  assert.ok(plaza.score > kiosk.score);
  assert.equal(formatWeight('TRAVEL PLAZA'), FORMAT_WEIGHTS['travel plaza'], 'format lookup is case-insensitive');
  assert.equal(formatWeight('unlisted-format'), 1.0, 'an unknown format falls back to a neutral weight, not zero');
  assert.equal(formatWeight(null), 1.0);
});

test('hour wraps to a valid 0-23 index instead of throwing on odd input', () => {
  const negative = estimateBusyness({ trafficLevel: 0.5 }, { hour: -1 });
  assert.equal(negative.hour, 23);
  const overflow = estimateBusyness({ trafficLevel: 0.5 }, { hour: 25 });
  assert.equal(overflow.hour, 1);
});

test('the demand curve has exactly 24 entries, each a fraction in (0, 1]', () => {
  assert.equal(HOURLY_DEMAND_CURVE.length, 24);
  for (const fraction of HOURLY_DEMAND_CURVE) {
    assert.ok(fraction > 0 && fraction <= 1);
  }
});

test('the score is clamped to [0, 100] even at the curve peak with an amplifying format', () => {
  const result = estimateBusyness({ trafficLevel: 1 }, { hour: 18, format: 'travel plaza' });
  assert.ok(result.score <= 100);
});
