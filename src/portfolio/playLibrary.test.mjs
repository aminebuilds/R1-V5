import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYS,
  getPlay,
  matchesCategory,
  playFires,
  selectPlays,
} from './playLibrary.js';

test('every play carries an unmeasured lift until a holdout proves otherwise', () => {
  // The library must never ship seeded "typical" lift values — a plausible
  // prior is indistinguishable from a result once it is rendered.
  for (const play of PLAYS) {
    assert.equal(play.expectedLiftPct.value, null, `${play.id} has a pre-baked lift`);
    assert.equal(play.expectedLiftPct.confidence, 'unmeasured');
    assert.equal(play.expectedLiftPct.n, 0);
  }
});

test('every play has a stable namespaced id and a trigger', () => {
  const seen = new Set();
  for (const play of PLAYS) {
    assert.match(play.id, /^play:[a-z0-9-]+$/);
    assert.ok(!seen.has(play.id), `duplicate id ${play.id}`);
    seen.add(play.id);
    assert.ok(play.trigger && Object.keys(play.trigger).length > 0);
    assert.ok(play.action && play.rationale);
  }
});

test('getPlay resolves by id and returns null otherwise', () => {
  assert.equal(getPlay('play:cooloff-cold-drink').id, 'play:cooloff-cold-drink');
  assert.equal(getPlay('play:nope'), null);
  assert.equal(getPlay(null), null);
});

test('matchesCategory is permissive when a play names no categories', () => {
  assert.equal(matchesCategory('anything', []), true);
  assert.equal(matchesCategory('anything', undefined), true);
});

test('matchesCategory matches on site name text', () => {
  assert.equal(matchesCategory("Casey's General Store fuel", ['fuel']), true);
  assert.equal(matchesCategory('Office Supply Depot', ['fuel', 'coffee']), false);
});

test('a missing signal never satisfies a threshold', () => {
  const play = getPlay('play:cooloff-cold-drink');
  // No delay measured at all — the play must not fire on absence.
  assert.equal(playFires(play, {
    distanceToBottleneckM: 100,
    approach: 'near',
    conversionScore: 90,
    categoryText: 'fuel',
  }), false);
});

test('the cold-drink play fires on a near-side, close, severe jam', () => {
  const play = getPlay('play:cooloff-cold-drink');
  assert.equal(playFires(play, {
    delayMin: 12,
    distanceToBottleneckM: 400,
    approach: 'near',
    conversionScore: 80,
    categoryText: 'Shell fuel station',
  }), true);
});

test('the cold-drink play does not fire on the far side', () => {
  const play = getPlay('play:cooloff-cold-drink');
  assert.equal(playFires(play, {
    delayMin: 12,
    distanceToBottleneckM: 400,
    approach: 'far',
    conversionScore: 80,
    categoryText: 'Shell fuel station',
  }), false);
});

test('an ambiguous approach does not satisfy a near-side trigger', () => {
  const play = getPlay('play:cooloff-cold-drink');
  assert.equal(playFires(play, {
    delayMin: 12,
    distanceToBottleneckM: 400,
    approach: 'ambiguous',
    conversionScore: 80,
    categoryText: 'Shell fuel station',
  }), false);
});

test('the construction play requires an actual closure or construction zone', () => {
  const play = getPlay('play:cooloff-coffee-break');
  const base = {
    delayMin: 20,
    distanceToBottleneckM: 900,
    conversionScore: 70,
    categoryText: 'Corner Coffee',
  };
  assert.equal(playFires(play, base), false);
  assert.equal(playFires(play, { ...base, isConstruction: true }), true);
});

test('the far-side play suppresses spend rather than recommending it', () => {
  const play = getPlay('play:farside-skip');
  assert.equal(play.requiresApproval, false);
  assert.equal(playFires(play, {
    delayMin: 10,
    approach: 'far',
    categoryText: 'fuel',
  }), true);
});

test('the price-match play needs both the gap and a real competitor', () => {
  const play = getPlay('play:price-match-local');
  assert.equal(playFires(play, {
    centsAboveLocalMin: 8,
    categoryText: 'fuel station',
  }), false, 'no competitor count means no fire');
  assert.equal(playFires(play, {
    centsAboveLocalMin: 8,
    competitorsWithin1km: 2,
    categoryText: 'fuel station',
  }), true);
});

test('the supply-risk play needs a real disruption index', () => {
  const play = getPlay('play:supply-risk-forward-buy');
  assert.equal(playFires(play, { categoryText: 'fuel' }), false);
  assert.equal(playFires(play, { disruptionIndex: 82, categoryText: 'fuel' }), true);
  assert.equal(playFires(play, { disruptionIndex: 40, categoryText: 'fuel' }), false);
});

test('selectPlays ranks more specific plays first', () => {
  const matched = selectPlays({
    delayMin: 20,
    distanceToBottleneckM: 400,
    approach: 'near',
    conversionScore: 85,
    isConstruction: true,
    categoryText: 'Corner Coffee fuel',
  });
  assert.ok(matched.length >= 2);
  for (let i = 1; i < matched.length; i++) {
    assert.ok(matched[i - 1].specificity >= matched[i].specificity);
  }
});

test('selectPlays returns nothing when no threshold is met', () => {
  assert.deepEqual(selectPlays({ delayMin: 1, categoryText: 'fuel' }), []);
  assert.deepEqual(selectPlays({}), []);
});
