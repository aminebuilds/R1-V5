import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCategoryMultiplier,
  scoreCoolOffOpportunity,
  evaluateCoolOffOpportunities,
} from './coolOffOpportunityEngine.js';

test('getCategoryMultiplier rewards high-impulse refreshment categories', () => {
  assert.equal(getCategoryMultiplier({ name: 'Starbucks Coffee' }), 1.35);
  assert.equal(getCategoryMultiplier({ name: 'Happy Lemon Boba Tea' }), 1.30);
  assert.equal(getCategoryMultiplier({ name: 'Office Supply Depot' }), 1.10);
});

const SITE = { id: 'site:1', name: 'Main St Coffee', lat: 30.2672, lon: -97.7431 };

/** A measured bottleneck ~100 m from SITE, running north on a divided road. */
function jamNearSite(overrides = {}) {
  return {
    midLat: 30.2680,
    midLon: -97.7435,
    delayMin: 15.0,
    isConstruction: true,
    roadType: 'motorway',
    delayStatus: 'Severe Construction Jam',
    coords: [[-97.7435, 30.2670], [-97.7435, 30.2690]],
    ...overrides,
  };
}

test('scoreCoolOffOpportunity ranks close severe bottlenecks highest', () => {
  const opp = scoreCoolOffOpportunity(SITE, [jamNearSite()]);
  assert.ok(opp);
  assert.ok(opp.conversionScore >= 75);
  assert.equal(opp.isConstruction, true);
  assert.equal(opp.urgencyLevel, 'High');
  assert.equal(opp.confidence, 'measured-inputs-ranked');
});

test('scoreCoolOffOpportunity emits no absolute footfall forecast', () => {
  const opp = scoreCoolOffOpportunity(SITE, [jamNearSite()]);
  // The old build multiplied the score by a hard-coded 450 vehicles/hour and
  // surfaced the product as an expected visit count.
  assert.ok(!('estimatedDetourHourlyVisits' in opp));
});

test('a bottleneck without a measured delay is not scoreable', () => {
  const opp = scoreCoolOffOpportunity(SITE, [jamNearSite({ delayMin: undefined })]);
  // Previously defaulted to `|| 5.0`, inventing five minutes of traffic.
  assert.equal(opp, null);
});

test('recommendations are play lookups carrying unmeasured lift', () => {
  const opp = scoreCoolOffOpportunity(SITE, [jamNearSite()]);
  assert.ok(Array.isArray(opp.plays));
  for (const play of opp.plays) {
    assert.match(play.id, /^play:/);
    assert.equal(play.expectedLiftPct.value, null);
    assert.equal(play.expectedLiftPct.confidence, 'unmeasured');
  }
});

test('approach side stays ambiguous on an undivided road', () => {
  const opp = scoreCoolOffOpportunity(SITE, [jamNearSite()], [jamNearSite()]);
  // One feature carrying both directions: coordinate order is a digitisation
  // artefact, so near/far is not recoverable and must not be claimed.
  assert.equal(opp.approach, 'ambiguous');
  assert.equal(opp.approachDivided, false);
});

test('approach side resolves on a divided carriageway', () => {
  const northbound = jamNearSite();
  const southbound = jamNearSite({
    coords: [[-97.74345, 30.2690], [-97.74345, 30.2670]], // antiparallel twin
  });
  const opp = scoreCoolOffOpportunity(SITE, [northbound], [northbound, southbound]);
  assert.equal(opp.approachDivided, true);
  assert.ok(['near', 'far'].includes(opp.approach));
  assert.ok(['left', 'right'].includes(opp.approachSide));
});

test('evaluateCoolOffOpportunities reports "cannot tell" when traffic is unavailable', async () => {
  const res = await evaluateCoolOffOpportunities({ biasLat: 30.2672, biasLon: -97.7431 });
  // With no TomTom reachable the honest answer is a failure state — not the
  // old reassuring "Normal traffic flow ... no triggers active".
  assert.equal(res.success, false);
  assert.equal(res.confidence, 'unavailable');
  assert.deepEqual(res.opportunities, []);
  assert.equal(res.topOpportunity, null);
  assert.equal(res.activeConstructionCount, null);
  assert.match(res.readout, /cannot evaluate/);
});
