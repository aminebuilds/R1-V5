import test from 'node:test';
import assert from 'node:assert/strict';

import { rankSitesByGap, scoreSiteGap, totalRecoverableGapUsd } from './gapModel.js';

test('scoreSiteGap returns null without a site id', () => {
  assert.equal(scoreSiteGap(null), null);
  assert.equal(scoreSiteGap({}), null);
});

test('scoreSiteGap is deterministic — same id always scores the same', () => {
  const a = scoreSiteGap({ id: 'site:abc' });
  const b = scoreSiteGap({ id: 'site:abc' });
  assert.deepEqual(a, b);
});

test('scoreSiteGap gives different sites different scores', () => {
  const a = scoreSiteGap({ id: 'site:abc' });
  const b = scoreSiteGap({ id: 'site:xyz' });
  assert.notEqual(a.gapUsd, b.gapUsd);
});

test('scoreSiteGap: performance ratio can exceed 100% of expected — those sites score a negative (exemplar) gap', () => {
  const scores = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => scoreSiteGap({ id: `site:${id}` }));
  for (const score of scores) {
    assert.equal(score.gapGallons, score.expectedGallons - score.actualGallons);
    assert.equal(score.confidence, 'placeholder');
  }
  // The seeded spread (0.62..1.24x expected) should produce at least one of each across a handful of ids.
  assert.ok(scores.some((s) => s.gapUsd > 0), 'expected at least one under-performing (positive gap) site');
  assert.ok(scores.some((s) => s.gapUsd < 0), 'expected at least one over-performing (negative gap / exemplar) site');
});

test('rankSitesByGap excludes sites without resolved coordinates', () => {
  const ranked = rankSitesByGap([
    { id: 'site:1', lat: 30.2, lon: -97.7 },
    { id: 'site:2', lat: null, lon: null },
    { id: 'site:3' },
  ]);
  assert.deepEqual(ranked.map((r) => r.site.id), ['site:1']);
});

test('rankSitesByGap sorts largest gap first', () => {
  const sites = Array.from({ length: 12 }, (_, i) => ({ id: `site:${i}`, lat: 30 + i * 0.01, lon: -97 }));
  const ranked = rankSitesByGap(sites);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score.gapUsd >= ranked[i].score.gapUsd);
  }
});

test('rankSitesByGap handles an empty or missing list', () => {
  assert.deepEqual(rankSitesByGap([]), []);
  assert.deepEqual(rankSitesByGap(null), []);
});

test('totalRecoverableGapUsd sums only positive gaps', () => {
  const ranked = [
    { score: { gapUsd: 500 } },
    { score: { gapUsd: -200 } },
    { score: { gapUsd: 1200 } },
  ];
  assert.equal(totalRecoverableGapUsd(ranked), 1700);
});

test('totalRecoverableGapUsd handles an empty or missing list', () => {
  assert.equal(totalRecoverableGapUsd([]), 0);
  assert.equal(totalRecoverableGapUsd(null), 0);
});
