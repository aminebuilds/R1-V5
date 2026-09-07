import test from 'node:test';
import assert from 'node:assert/strict';

import {
  meanOrNull,
  summarizeSites,
  describeHealth,
  getViewHealth,
  getPortfolioHealth,
} from './healthRollup.js';

const AUSTIN = { lat: 30.2672, lon: -97.7431 };

function site(id, extra = {}) {
  return {
    id,
    name: id,
    lat: AUSTIN.lat,
    lon: AUSTIN.lon,
    hasLiveFlow: false,
    trafficLevel: null,
    congestionScore: null,
    isClosure: false,
    isCompetitor: false,
    ...extra,
  };
}

function measured(id, level, extra = {}) {
  return site(id, {
    hasLiveFlow: true,
    trafficLevel: level,
    congestionScore: Math.round(level * 100),
    ...extra,
  });
}

test('meanOrNull ignores non-finite values and returns null on an empty set', () => {
  assert.equal(meanOrNull([]), null);
  assert.equal(meanOrNull([null, undefined, NaN]), null);
  assert.equal(meanOrNull([2, 4, null]), 3);
});

test('an empty scope summarises to zero sites without inventing figures', () => {
  const rollup = summarizeSites([], []);
  assert.equal(rollup.siteCount, 0);
  assert.equal(rollup.traffic.meanCongestionScore, null);
  assert.equal(rollup.traffic.congestedSites, null);
  assert.equal(rollup.price.meanCentsVsAnchor, null);
  assert.match(describeHealth(rollup), /No portfolio sites/);
});

test('unmeasured sites never contribute to a congestion average', () => {
  const rollup = summarizeSites([
    measured('a', 0.8),
    site('b'),
    site('c'),
  ], []);
  assert.equal(rollup.siteCount, 3);
  assert.equal(rollup.traffic.sitesWithLiveFlow, 1);
  // The mean is over the ONE site that was read, not diluted by two zeros.
  assert.equal(rollup.traffic.meanCongestionScore, 80);
  assert.equal(rollup.coverage.flowCoverage, 1 / 3);
});

test('coverage exposes how thin a reading is', () => {
  const sites = [measured('a', 0.9), ...Array.from({ length: 39 }, (_, i) => site(`s${i}`))];
  const rollup = summarizeSites(sites, []);
  assert.equal(rollup.coverage.sitesTotal, 40);
  assert.equal(Math.round(rollup.coverage.flowCoverage * 100), 3);
  // And the readout has to say it out loud.
  assert.match(describeHealth(rollup), /live flow on 1\/40/);
});

test('competitors are counted separately from the operator sites', () => {
  const rollup = summarizeSites([
    measured('mine', 0.5),
    site('theirs', { isCompetitor: true }),
  ], []);
  assert.equal(rollup.siteCount, 1);
  assert.equal(rollup.competitorCount, 1);
});

test('the worst congested site is identified by measurement', () => {
  const rollup = summarizeSites([
    measured('calm', 0.2),
    measured('jammed', 0.92),
    measured('busy', 0.6),
  ], []);
  assert.equal(rollup.traffic.worstSite.id, 'jammed');
  assert.equal(rollup.traffic.congestedSites, 1);
});

test('corridor figures come from the traffic records, not the sites', () => {
  const rollup = summarizeSites([measured('a', 0.3)], [
    { id: 'f1', lat: AUSTIN.lat, lon: AUSTIN.lon, delayMin: 9, frustrationScore: 80, isClosure: false },
    { id: 'f2', lat: AUSTIN.lat, lon: AUSTIN.lon, delayMin: 14, frustrationScore: 95, isClosure: true },
    { id: 'f3', lat: AUSTIN.lat, lon: AUSTIN.lon, delayMin: 0.2, frustrationScore: 5, isClosure: false },
  ]);
  assert.equal(rollup.traffic.corridorBottlenecks, 2);
  assert.equal(rollup.traffic.corridorClosures, 1);
  assert.equal(rollup.traffic.maxCorridorDelayMin, 14);
});

test('corridor figures are null when no traffic was loaded', () => {
  const rollup = summarizeSites([measured('a', 0.3)], []);
  assert.equal(rollup.traffic.corridorBottlenecks, null);
  assert.equal(rollup.traffic.corridorClosures, null);
  assert.equal(rollup.traffic.maxCorridorDelayMin, null);
});

test('the dollar gap stays null until actual volumes exist', () => {
  const rollup = summarizeSites([measured('a', 0.4), measured('b', 0.5)], []);
  assert.equal(rollup.economics.recoverableGapUsd, null);
  assert.equal(rollup.economics.gapConfidence, 'requires-actuals');
  assert.match(describeHealth(rollup), /needs actual volumes/);
});

test('price position only counts sites that carry a price', () => {
  const priceBySiteId = new Map([['a', { priceVsAnchorCents: 6 }]]);
  const rollup = summarizeSites([measured('a', 0.4), measured('b', 0.4)], [], { priceBySiteId });
  assert.equal(rollup.price.sitesWithPrice, 1);
  assert.equal(rollup.price.meanCentsVsAnchor, 6);
  assert.equal(rollup.price.sitesAboveAnchor, 1);
  assert.equal(rollup.coverage.priceCoverage, 0.5);
  assert.match(describeHealth(rollup), /6¢ above the regional anchor/);
});

test('getViewHealth scopes to the camera radius', () => {
  const near = measured('near', 0.8);
  const far = measured('far', 0.9, { lat: 40.7128, lon: -74.006 }); // New York
  const providers = {
    getRecords: (key) => (key === 'sites' ? [near, far] : []),
    getViewContext: () => ({ ...AUSTIN, viewRadiusKm: 50 }),
  };
  const health = getViewHealth(providers);
  assert.equal(health.siteCount, 1);
  assert.match(health.scopeLabel, /within 50 km/);
  assert.ok(health.readout.length > 0);
});

test('getPortfolioHealth ignores the camera entirely', () => {
  const near = measured('near', 0.8);
  const far = measured('far', 0.9, { lat: 40.7128, lon: -74.006 });
  const providers = {
    getRecords: (key) => (key === 'sites' ? [near, far] : []),
    getViewContext: () => ({ ...AUSTIN, viewRadiusKm: 50 }),
  };
  const health = getPortfolioHealth(providers);
  assert.equal(health.siteCount, 2);
  assert.match(health.scopeLabel, /across the portfolio/);
});

test('getPortfolioHealth breaks down by region, largest first', () => {
  const providers = {
    getRecords: (key) => (key === 'sites'
      ? [
        measured('a', 0.5, { regionId: 'south' }),
        measured('b', 0.7, { regionId: 'south' }),
        site('c', { regionId: 'north' }),
      ]
      : []),
    getViewContext: () => ({ ...AUSTIN, viewRadiusKm: 50 }),
  };
  const health = getPortfolioHealth(providers);
  assert.equal(health.regions[0].region, 'south');
  assert.equal(health.regions[0].siteCount, 2);
  assert.equal(health.regions[0].meanCongestionScore, 60);
  // North has no reading at all — null, not zero.
  assert.equal(health.regions[1].meanCongestionScore, null);
});
