import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rankSitesByGap,
  scoreSiteGap,
  scoreDemandPotential,
  totalRecoverableGapUsd,
  usdPerGallonGap,
  DEFAULT_ECONOMICS,
} from './gapModel.js';

test('scoreSiteGap returns null without a site id', () => {
  assert.equal(scoreSiteGap(null), null);
  assert.equal(scoreSiteGap({}), null);
});

test('scoreSiteGap will not produce a dollar gap without actuals', () => {
  // The whole point of the rewrite: a gap needs the operator's own volumes.
  // The old build hashed the site id into both an "expected" and an "actual"
  // gallon figure and multiplied the difference into a ranked dollar queue.
  const score = scoreSiteGap({ id: 'site:abc' });
  assert.equal(score.gapUsd, null);
  assert.equal(score.gapGallons, null);
  assert.equal(score.expectedGallons, null);
  assert.equal(score.actualGallons, null);
  assert.equal(score.confidence, 'requires-actuals');
});

test('scoreSiteGap refuses a half-supplied pair', () => {
  const onlyActual = scoreSiteGap({ id: 'site:abc' }, { actualGallons: 120000 });
  assert.equal(onlyActual.confidence, 'requires-actuals');
  assert.equal(onlyActual.gapUsd, null);
  // The supplied side is still reported — it is real, it just is not a gap.
  assert.equal(onlyActual.actualGallons, 120000);

  const onlyExpected = scoreSiteGap({ id: 'site:abc' }, { expectedGallons: 150000 });
  assert.equal(onlyExpected.confidence, 'requires-actuals');
  assert.equal(onlyExpected.gapUsd, null);
});

test('scoreSiteGap computes a real gap when both volumes are supplied', () => {
  const score = scoreSiteGap({ id: 'site:abc' }, {
    expectedGallons: 150000,
    actualGallons: 120000,
  });
  assert.equal(score.confidence, 'measured');
  assert.equal(score.gapGallons, 30000);
  assert.equal(score.gapUsd, Math.round(30000 * usdPerGallonGap()));
  assert.ok(score.gapUsd > 0);
});

test('an over-performing site scores a negative gap', () => {
  const score = scoreSiteGap({ id: 'site:abc' }, {
    expectedGallons: 100000,
    actualGallons: 130000,
  });
  assert.equal(score.confidence, 'measured');
  assert.ok(score.gapUsd < 0);
});

test('operator economics override the defaults', () => {
  const base = scoreSiteGap({ id: 's' }, { expectedGallons: 100000, actualGallons: 90000 });
  const richer = scoreSiteGap({ id: 's' }, {
    expectedGallons: 100000,
    actualGallons: 90000,
    economics: { ...DEFAULT_ECONOMICS, fuelMarginPerGallon: 0.72 },
  });
  assert.ok(richer.gapUsd > base.gapUsd);
});

test('scoreDemandPotential returns null-scored rows when nothing was measured', () => {
  const demand = scoreDemandPotential({ id: 'site:abc' });
  assert.equal(demand.demandPotential, null);
  assert.equal(demand.confidence, 'insufficient-inputs');
  assert.deepEqual(demand.inputs, []);
});

test('scoreDemandPotential names the inputs each score rests on', () => {
  const demand = scoreDemandPotential(
    { id: 'site:abc', roadType: 'motorway', trafficLevel: 0.5 },
    { competitorsWithin1km: 1, competitorsWithin3km: 3 },
  );
  assert.equal(demand.confidence, 'measured-inputs');
  assert.deepEqual(demand.inputs.sort(), ['competitor-density', 'live-flow', 'road-class']);
  assert.ok(demand.demandPotential >= 0 && demand.demandPotential <= 100);
});

test('scoreDemandPotential rewards a motorway frontage over a residential one', () => {
  const motorway = scoreDemandPotential({ id: 'a', roadType: 'motorway' });
  const residential = scoreDemandPotential({ id: 'b', roadType: 'residential' });
  assert.ok(motorway.demandPotential > residential.demandPotential);
});

test('scoreDemandPotential penalises competitor density', () => {
  const alone = scoreDemandPotential({ id: 'a', roadType: 'primary' }, { competitorsWithin1km: 0 });
  const crowded = scoreDemandPotential({ id: 'a', roadType: 'primary' }, { competitorsWithin1km: 4 });
  assert.ok(alone.demandPotential > crowded.demandPotential);
});

test('rankSitesByGap excludes sites without resolved coordinates', () => {
  const ranked = rankSitesByGap([
    { id: 'site:1', lat: 30.2, lon: -97.7 },
    { id: 'site:2', lat: null, lon: null },
    { id: 'site:3' },
  ]);
  assert.deepEqual(ranked.map((r) => r.site.id), ['site:1']);
});

test('rankSitesByGap puts measured dollar gaps above unmeasured sites', () => {
  const sites = [
    { id: 'site:unmeasured', lat: 30, lon: -97, roadType: 'motorway' },
    { id: 'site:measured', lat: 31, lon: -97 },
  ];
  const actualsBySiteId = new Map([
    ['site:measured', { expectedGallons: 150000, actualGallons: 100000 }],
  ]);
  const ranked = rankSitesByGap(sites, { actualsBySiteId });
  assert.equal(ranked[0].site.id, 'site:measured');
  assert.equal(ranked[0].score.confidence, 'measured');
  assert.equal(ranked[1].score.confidence, 'requires-actuals');
});

test('rankSitesByGap orders measured rows by dollar gap, unmeasured by demand', () => {
  const sites = [
    { id: 'm:small', lat: 30, lon: -97 },
    { id: 'm:big', lat: 30.1, lon: -97 },
    { id: 'u:residential', lat: 30.2, lon: -97, roadType: 'residential' },
    { id: 'u:motorway', lat: 30.3, lon: -97, roadType: 'motorway' },
  ];
  const actualsBySiteId = new Map([
    ['m:small', { expectedGallons: 100000, actualGallons: 95000 }],
    ['m:big', { expectedGallons: 200000, actualGallons: 100000 }],
  ]);
  const ranked = rankSitesByGap(sites, { actualsBySiteId });
  assert.deepEqual(ranked.map((r) => r.site.id), ['m:big', 'm:small', 'u:motorway', 'u:residential']);
});

test('rankSitesByGap handles an empty or missing list', () => {
  assert.deepEqual(rankSitesByGap([]), []);
  assert.deepEqual(rankSitesByGap(null), []);
});

test('totalRecoverableGapUsd sums only positive, measured gaps', () => {
  const ranked = [
    { score: { gapUsd: 500, confidence: 'measured' } },
    { score: { gapUsd: -200, confidence: 'measured' } },
    { score: { gapUsd: 1200, confidence: 'measured' } },
  ];
  assert.equal(totalRecoverableGapUsd(ranked), 1700);
});

test('totalRecoverableGapUsd ignores rows that have no actuals', () => {
  const ranked = [
    { score: { gapUsd: 500, confidence: 'measured' } },
    { score: { gapUsd: null, confidence: 'requires-actuals' } },
  ];
  assert.equal(totalRecoverableGapUsd(ranked), 500);
});

test('totalRecoverableGapUsd handles an empty or missing list', () => {
  assert.equal(totalRecoverableGapUsd([]), 0);
  assert.equal(totalRecoverableGapUsd(null), 0);
});
