import test from 'node:test';
import assert from 'node:assert/strict';

import {
  paddForCoords,
  paddForState,
  positionSitesOnPrice,
} from './fuelPriceClient.js';

test('paddForState maps states to their EIA region', () => {
  assert.equal(paddForState('TX'), 3);
  assert.equal(paddForState('ca'), 5);
  assert.equal(paddForState('NY'), 1);
  assert.equal(paddForState('IL'), 2);
  assert.equal(paddForState('CO'), 4);
  assert.equal(paddForState('ZZ'), null);
  assert.equal(paddForState(''), null);
});

test('paddForCoords lands the big markets in the right region', () => {
  assert.equal(paddForCoords(30.2672, -97.7431), 3); // Austin
  assert.equal(paddForCoords(34.05, -118.24), 5);    // Los Angeles
  assert.equal(paddForCoords(41.88, -87.63), 2);     // Chicago
  assert.equal(paddForCoords(40.71, -74.01), 1);     // New York
  assert.equal(paddForCoords(39.74, -104.99), 4);    // Denver
});

test('paddForCoords returns null outside the US, where there is no PADD', () => {
  assert.equal(paddForCoords(48.85, 2.35), null);   // Paris
  assert.equal(paddForCoords(-33.87, 151.2), null); // Sydney
  assert.equal(paddForCoords(NaN, NaN), null);
});

const SITE = { id: 'site:1', name: 'Mine', lat: 40.4168, lon: -3.7038 };

/** A station at a given metre offset east of SITE. */
function stationAt(id, eastMeters, price) {
  const degPerM = 1 / (111320 * Math.cos((SITE.lat * Math.PI) / 180));
  return {
    id,
    lat: SITE.lat,
    lon: SITE.lon + eastMeters * degPerM,
    prices: { gasoline95: price },
  };
}

test('a site with no station in the feed reports no price rather than imputing one', () => {
  const positions = positionSitesOnPrice([SITE], [
    stationAt('near', 500, 1.60),
    stationAt('far', 900, 1.55),
  ]);
  const p = positions.get('site:1');
  assert.equal(p.hasLivePrice, false);
  assert.equal(p.priceCents, null);
  assert.equal(p.centsAboveLocalMin, null);
  assert.equal(p.rankFromCheapest, null);
  assert.equal(p.confidence, 'no-price-for-site');
  // It still knows how many competitors it could see.
  assert.equal(p.competitorsPriced, 2);
});

test('a site matched to its own station is priced from the official feed', () => {
  const positions = positionSitesOnPrice([SITE], [
    stationAt('own', 10, 1.699),
    stationAt('rivalA', 400, 1.639),
    stationAt('rivalB', 800, 1.659),
  ]);
  const p = positions.get('site:1');
  assert.equal(p.hasLivePrice, true);
  assert.equal(p.priceCents, 170);
  assert.equal(p.confidence, 'official-feed');
  assert.equal(p.competitorsPriced, 2);
  // Both rivals are cheaper, so the site ranks third.
  assert.equal(p.rankFromCheapest, 3);
  assert.equal(p.centsAboveLocalMin, 6);
});

test('the cheapest site in its ring ranks first', () => {
  const positions = positionSitesOnPrice([SITE], [
    stationAt('own', 10, 1.599),
    stationAt('rivalA', 400, 1.649),
  ]);
  const p = positions.get('site:1');
  assert.equal(p.rankFromCheapest, 1);
  assert.ok(p.centsAboveLocalMin < 0, 'a cheaper site is below the local minimum competitor');
});

test('price vs anchor is null until an anchor is supplied', () => {
  const withoutAnchor = positionSitesOnPrice([SITE], [stationAt('own', 10, 1.70)]);
  assert.equal(withoutAnchor.get('site:1').priceVsAnchorCents, null);

  const withAnchor = positionSitesOnPrice([SITE], [stationAt('own', 10, 1.70)], { anchorValue: 1.64 });
  assert.equal(withAnchor.get('site:1').priceVsAnchorCents, 6);
});

test('stations beyond the ring are excluded from the comparison', () => {
  const positions = positionSitesOnPrice([SITE], [
    stationAt('own', 10, 1.70),
    stationAt('outOfRing', 5000, 1.20),
  ], { radiusM: 1609 });
  const p = positions.get('site:1');
  assert.equal(p.competitorsPriced, 0);
  assert.equal(p.centsAboveLocalMin, null);
});

test('stations without a price for the requested grade are ignored', () => {
  const positions = positionSitesOnPrice([SITE], [
    stationAt('own', 10, 1.70),
    { id: 'dieselOnly', lat: SITE.lat, lon: SITE.lon + 0.004, prices: { diesel: 1.5 } },
  ]);
  assert.equal(positions.get('site:1').competitorsPriced, 0);
});

test('sites without coordinates are skipped entirely', () => {
  const positions = positionSitesOnPrice([{ id: 'nogeo' }], [stationAt('own', 10, 1.7)]);
  assert.equal(positions.size, 0);
});

test('an empty station feed leaves every site unpriced, not zero-priced', () => {
  const positions = positionSitesOnPrice([SITE], []);
  const p = positions.get('site:1');
  assert.equal(p.hasLivePrice, false);
  assert.equal(p.priceCents, null);
  assert.equal(p.competitorsPriced, 0);
});
