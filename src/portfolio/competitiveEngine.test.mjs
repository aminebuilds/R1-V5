import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferCompetitors,
  scoreSiteVsCompetitors,
  analyzeCompetitivePosition,
} from './competitiveEngine.js';

test('inferCompetitors matches known brands', () => {
  const comps1 = inferCompetitors('Starbucks Coffee');
  assert.ok(comps1.includes("Dunkin'"));

  const comps2 = inferCompetitors('McDonalds');
  assert.ok(comps2.includes('Burger King'));
});

test('inferCompetitors falls back to searchable category terms, not placeholder names', () => {
  const comps = inferCompetitors('Some Unknown Regional Brand');
  // The old fallback returned the literal strings "Primary Competitor" /
  // "Regional Competitor", which match nothing upstream and guarantee an
  // empty search. Every fallback term must be something a places search can
  // actually resolve.
  assert.ok(comps.length > 0);
  for (const term of comps) {
    assert.doesNotMatch(term, /^(Primary|Regional) Competitor$/);
  }
  assert.ok(comps.includes('gas station'));
});

test('scoreSiteVsCompetitors measures spatial competition within 1km/3km/5km', () => {
  const site = {
    id: 'site:1',
    name: 'My Store Downtown',
    address: '100 Main St',
    lat: 30.2672,
    lon: -97.7431,
  };

  const comps = [
    { id: 'c1', name: 'Rival 1', lat: 30.2675, lon: -97.7435 }, // ~50m away
    { id: 'c2', name: 'Rival 2', lat: 30.2800, lon: -97.7431 }, // ~1.4km away
    { id: 'c3', name: 'Rival 3', lat: 30.3100, lon: -97.7431 }, // ~4.7km away
  ];

  const score = scoreSiteVsCompetitors(site, comps);
  assert.equal(score.competitorsWithin1km, 1);
  assert.equal(score.competitorsWithin3km, 2);
  assert.equal(score.competitorsWithin5km, 3);
  assert.ok(score.dominanceScore >= 0 && score.dominanceScore <= 100);
});

test('scoreSiteVsCompetitors reports access from measured flow, or not at all', () => {
  const site = { id: 'site:1', name: 'Store', lat: 30.2672, lon: -97.7431 };

  const withoutFlow = scoreSiteVsCompetitors(site, []);
  // No live reading means no access claim — the previous build derived both a
  // vehicles/day count and a friction label from a hash of the coordinates.
  assert.equal(withoutFlow.accessFriction, null);
  assert.equal(withoutFlow.trafficLevel, null);
  assert.ok(!('trafficVolumeEst' in withoutFlow));

  const withFlow = scoreSiteVsCompetitors(site, [], { trafficLevel: 0.8, roadType: 'primary' });
  assert.equal(withFlow.accessFriction, 'High delay');
  assert.equal(withFlow.trafficLevel, 0.8);
});

test('scoreSiteVsCompetitors dominance is a pure function of measured density', () => {
  const site = { id: 'site:1', name: 'Store', lat: 30.2672, lon: -97.7431 };
  const uncontested = scoreSiteVsCompetitors(site, []);
  assert.equal(uncontested.dominanceScore, 100);
  assert.equal(uncontested.status, 'Uncontested');

  // Two competitors inside 1 km (each also inside 3 km): 100 - 2*18 - 2*5.
  const crowded = scoreSiteVsCompetitors(site, [
    { id: 'c1', name: 'R1', lat: 30.2675, lon: -97.7435 },
    { id: 'c2', name: 'R2', lat: 30.2680, lon: -97.7440 },
  ]);
  assert.equal(crowded.dominanceScore, 54);
  assert.equal(crowded.status, 'Contested');
});

test('analyzeCompetitivePosition never fabricates competitors when search finds none', async () => {
  // No network and no stored portfolio: the honest answer is a failure with a
  // named status. The removed synthetic branch returned success:true with
  // manufactured "#101"-style stores at fixed coordinate offsets.
  const res = await analyzeCompetitivePosition('Starbucks', ["Dunkin'"], { biasLat: 30.2672, biasLon: -97.7431 });
  assert.equal(res.success, false);
  assert.ok(['no-client-sites', 'no-competitors-found'].includes(res.status));
  assert.equal(res.marketSharePct, null);
  assert.equal(res.averageDominanceScore, null);
  assert.equal(res.confidence, 'unavailable');
  assert.deepEqual(res.siteBreakdowns, []);
  for (const site of res.competitorSites) {
    assert.doesNotMatch(String(site.id), /mock/);
  }
});
