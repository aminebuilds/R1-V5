// Offer mechanics, promotion economics, and creative.
//
// The economics are what this file mostly exists to protect, because they
// are the part that gets a console thrown out of a room when they are wrong.
//
//  - A cents-per-gallon mechanic is costed PER GALLON. Costing it per
//    redemption understates a 22c giveaway by roughly the size of a tank.
//  - Margin is earned only on volume the offer CREATED, and the discount is
//    still paid on volume that was coming anyway. A model that credits every
//    redemption as incremental reports a giveaway as a profit centre.
//  - A redemption forecast is capped at what the store can physically turn.
//    Forecasting 500 coffees a day at a site that pours 350 is the fastest
//    way to lose an operator's trust in every other number on the board.
//
// The creative tests pin the one rule that makes a multi-surface preview
// worth looking at: copy is WRITTEN per surface, not resized onto it.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFER_CATALOG,
  SURFACES,
  buildCreative,
  categoryCapacity,
  contextTriggers,
  createOffer,
  deployOffer,
  forecastOffer,
  matchOfferFromText,
  offerById,
  offerEconomics,
  rankOffers,
  surfaceById,
  surfaceReach,
} from './offerStudio.js';
import { memberBase } from './memberGraph.js';
import { storeProfile } from './storeLedger.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store' };
const NOW = new Date('2026-09-21T14:40:00');

test('every catalogue offer is complete and every surface it names exists', () => {
  const surfaceIds = new Set(SURFACES.map((surface) => surface.id));
  const seen = new Set();
  for (const offer of OFFER_CATALOG) {
    assert.ok(!seen.has(offer.id), `duplicate offer id: ${offer.id}`);
    seen.add(offer.id);
    assert.ok(offer.name && offer.headline && offer.shortHeadline && offer.detail, `${offer.id} is missing copy`);
    assert.ok(offer.cost > 0, `${offer.id} has no margin cost`);
    assert.ok(offer.baseRedemption > 0 && offer.baseRedemption < 1, `${offer.id} has an implausible base redemption`);
    assert.ok(offer.surfaces.length > 0, `${offer.id} names no surface`);
    for (const id of offer.surfaces) assert.ok(surfaceIds.has(id), `${offer.id} names unknown surface ${id}`);
    // The canopy budget is real: nobody reads a sentence at 40 mph.
    const canopy = surfaceById('canopy');
    if (offer.surfaces.includes('canopy')) {
      assert.ok(offer.shortHeadline.length <= canopy.maxHeadline + 8, `${offer.id} short headline is too long for a canopy`);
    }
  }
});

test('a cents-per-gallon mechanic is costed per gallon, not per redemption', () => {
  const offer = offerById('cents-off-gallon');
  const economics = offerEconomics(offer, 100, { gallonsPerFill: 11, fuelMarginCpg: 34, basketAvg: 8 });

  assert.equal(economics.gallons, 1100);
  // 22c off 1,100 gallons is $242 — not 100 x the per-unit `cost` field.
  assert.equal(economics.marginGive, 242);
  assert.ok(economics.marginGive > 100 * offer.cost * 0.5, 'per-gallon give must scale with tank size');
  assert.match(economics.note, /per gallon/);
});

test('margin is earned on incremental volume and the discount is still paid on the rest', () => {
  const offer = offerById('cents-off-gallon');
  // 33% incremental on a volume-defence mechanic: two thirds of the fills
  // were coming anyway and the discount on them is pure loss.
  const economics = offerEconomics(offer, 300, { gallonsPerFill: 11, fuelMarginCpg: 30, basketAvg: 8 });
  assert.equal(economics.incrementalRedemptions + economics.cannibalisedRedemptions, 300);
  assert.ok(economics.cannibalisedRedemptions > economics.incrementalRedemptions);
  assert.ok(
    economics.netGrossProfit < economics.incrementalSales * 0.44,
    'cannibalised volume must drag the net below the incremental gross',
  );
});

test('an item-incremental mechanic is not treated like a visit-incremental one', () => {
  // A basket-build offer adds a line to a visit that was happening anyway,
  // so the ITEM is incremental far more often than the VISIT. Conflating the
  // two makes every basket-build campaign look structurally unprofitable.
  const build = offerEconomics(offerById('coffee-99'), 200, { basketAvg: 9 });
  const defend = offerEconomics(offerById('cents-off-gallon'), 200, { basketAvg: 9, gallonsPerFill: 11, fuelMarginCpg: 32 });
  assert.ok(build.incrementalRedemptions > defend.incrementalRedemptions);
});

test('a forecast is capped at what the store can physically turn', () => {
  const offer = offerById('coffee-99');
  const capacity = categoryCapacity(SITE, offer, NOW);
  assert.ok(capacity > 0, 'a dispensed-beverage offer must have a category baseline');

  const uncapped = forecastOffer(SITE, offer, { exposed: 100000, durationDays: 1 });
  const capped = forecastOffer(SITE, offer, { exposed: 100000, durationDays: 1, capacityPerDay: capacity });

  assert.equal(capped.capped, true);
  assert.ok(capped.redemptions.expected < uncapped.redemptions.expected);
  assert.ok(capped.redemptions.expected <= Math.round(capacity * 1.7));
  assert.ok(capped.redemptions.hi <= Math.round(capacity * 1.7), 'the upper bound is capped too');
  assert.match(capped.capacityNote, /Capped at category capacity/);
});

test('fuel and programme-wide mechanics have no single category line to cap against', () => {
  assert.equal(categoryCapacity(SITE, offerById('cents-off-gallon'), NOW), null);
  assert.equal(categoryCapacity(SITE, offerById('points-3x'), NOW), null);
  assert.ok(categoryCapacity(SITE, offerById('pizza-combo'), NOW) > 0);
});

test('a forecast carries a band and the sample size behind it, and says it is modelled', () => {
  const forecast = forecastOffer(SITE, offerById('coffee-99'), { exposed: 2000, durationDays: 3 });
  assert.equal(forecast.kind, 'modelled');
  assert.ok(forecast.redemptionRate.lo < forecast.redemptionRate.expected);
  assert.ok(forecast.redemptionRate.expected < forecast.redemptionRate.hi);
  assert.ok(forecast.priorRuns >= 2);
  assert.match(forecast.basis, /prior run/);
  assert.match(forecast.caveat, /Not a measured result/);
});

test('fewer prior runs earn a wider band', () => {
  // A mechanic with three runs behind it must not come back looking as
  // certain as one with twelve.
  const widths = OFFER_CATALOG.map((offer) => {
    const forecast = forecastOffer(SITE, offer, { exposed: 1000, durationDays: 1 });
    return {
      runs: forecast.priorRuns,
      width: (forecast.redemptionRate.hi - forecast.redemptionRate.lo) / forecast.redemptionRate.expected,
    };
  });
  const fewest = widths.reduce((a, b) => (a.runs <= b.runs ? a : b));
  const most = widths.reduce((a, b) => (a.runs >= b.runs ? a : b));
  assert.ok(fewest.width > most.width, 'the least-tested mechanic must carry the widest band');
});

test('live conditions become the trigger vocabulary the catalogue is written against', () => {
  const { triggers } = contextTriggers({
    now: NOW,
    weather: { tempC: 31, condition: 'CLEAR', precipMm: 0 },
    pulse: { state: 'dip', hour: { variancePct: -12 }, causes: [] },
  });
  assert.ok(triggers.has('hot'));
  assert.ok(triggers.has('dry'));
  assert.ok(triggers.has('afternoon'));
  assert.ok(triggers.has('dip'));
  assert.ok(!triggers.has('cold'));

  const wet = contextTriggers({ now: NOW, weather: { tempC: 8, condition: 'RAIN', precipMm: 2 } }).triggers;
  assert.ok(wet.has('wet') && wet.has('cold') && !wet.has('dry'));
});

test('ranking prefers the mechanic the conditions actually fire', () => {
  const members = memberBase(SITE, { now: NOW });
  const hot = rankOffers(SITE, {
    now: NOW, members, weather: { tempC: 34, condition: 'CLEAR', precipMm: 0 },
  });
  const cold = rankOffers(SITE, {
    now: new Date('2026-09-21T07:00:00'), members, weather: { tempC: 2, condition: 'CLEAR', precipMm: 0 },
  });

  const coldRank = cold.ranked.findIndex((row) => row.offer.motif === 'coffee');
  const hotRank = hot.ranked.findIndex((row) => row.offer.motif === 'coffee');
  assert.ok(coldRank < hotRank, 'a cold morning must rank hot coffee above a hot afternoon does');

  for (const row of hot.ranked) {
    assert.ok(Array.isArray(row.reasons));
    if (row.matchedTriggers.length === 0) assert.match(row.rationale, /No live trigger/);
  }
});

test('a goal biases the ranking toward that objective', () => {
  const members = memberBase(SITE, { now: NOW });
  const plain = rankOffers(SITE, { now: NOW, members });
  const winback = rankOffers(SITE, { now: NOW, members, goal: 'winback' });
  const find = (result) => result.ranked.findIndex((row) => row.offer.objective === 'winback');
  assert.ok(find(winback) <= find(plain));
});

test('a store with no wash never gets a wash offer ranked', () => {
  const noWash = { id: 'site:urban:9', name: 'City Kiosk', format: 'urban kiosk' };
  assert.equal(storeProfile(noWash).carWash, false);
  const ranked = rankOffers(noWash, { now: NOW, members: memberBase(noWash, { now: NOW }) });
  assert.ok(!ranked.ranked.some((row) => row.offer.category === 'carwash'));
});

test('a price in the request picks the mechanic, because only the number separates them', () => {
  // "99 cent coffee" and "free coffee with a fill" are different mechanics
  // with different economics. Ask for one and get the other and the board
  // is showing an offer nobody asked for.
  const cases = [
    ['build me a 99 cent coffee offer', 'coffee-99'],
    ['create a free coffee with a fill offer', 'coffee-with-fill'],
    ['make a 22 cents off a gallon promo', 'cents-off-gallon'],
    ['build a 79 cent fountain deal', 'cold-dispensed-79'],
    ['set up a 3x points campaign', 'points-3x'],
    ['create a win back offer for lapsed members', 'winback-gallon'],
    ['build a 5.99 pizza combo deal', 'pizza-combo'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(matchOfferFromText(text, SITE, { now: NOW }).id, expected, text);
  }
});

test('free text is matched onto a real mechanic so the forecast has priors behind it', () => {
  assert.equal(matchOfferFromText('a 99 cent coffee deal', SITE, { now: NOW }).category, 'dispensed');
  assert.equal(matchOfferFromText('twenty two cents off a gallon', SITE, { now: NOW }).category, 'fuel');
  assert.equal(matchOfferFromText('three dollars off a car wash', SITE, { now: NOW }).category, 'carwash');
  assert.equal(matchOfferFromText('win back the lapsed members', SITE, { now: NOW }).objective, 'winback');
  // Unmatched text falls through to the best-ranked mechanic rather than
  // inventing one with no history behind it.
  const fallback = matchOfferFromText('something completely unrelated', SITE, { now: NOW, members: memberBase(SITE, { now: NOW }) });
  assert.ok(OFFER_CATALOG.some((offer) => offer.id === fallback.id));
});

test('creative is written per surface, not one layout resized', () => {
  const offer = offerById('coffee-99');
  const canopy = buildCreative(offer, 'canopy', { brand: 'Test Fuel' });
  const app = buildCreative(offer, 'mobile-app', { brand: 'Test Fuel', endsAt: '9/24' });

  assert.notEqual(canopy.headline, app.headline, 'the canopy and the app must not carry the same line');
  assert.ok(canopy.headline.length <= surfaceById('canopy').maxHeadline);
  assert.ok(app.headline.length <= surfaceById('mobile-app').maxHeadline);
  assert.equal(canopy.terms, null, 'nobody reads terms at 40 mph');
  assert.ok(app.terms && app.terms.includes('9/24'), 'the app carries the terms and the expiry');
  assert.ok(app.cta, 'the app has somewhere to tap');
  assert.deepEqual(canopy.aspect, [8, 3]);
  assert.deepEqual(app.aspect, [4, 5]);
  assert.equal(buildCreative(offer, 'not-a-surface'), null);
});

test('a headline is clipped on a word boundary, never mid-word', () => {
  const long = buildCreative(
    { ...offerById('coffee-99'), shortHeadline: 'EXTRAORDINARILY LONG HEADLINE COPY HERE' },
    'canopy',
    {},
  );
  assert.ok(long.headline.length <= surfaceById('canopy').maxHeadline);
  assert.ok(!long.headline.endsWith(' '));
});

test('each surface reach model counts a different thing', () => {
  const profile = storeProfile(SITE);
  const members = memberBase(SITE, { now: NOW });
  const canopy = surfaceReach(surfaceById('canopy'), profile, members);
  const app = surfaceReach(surfaceById('mobile-app'), profile, members);
  assert.ok(canopy.impressions > canopy.addressable, 'passing traffic is not addressable traffic');
  assert.equal(app.impressions, members.pushOptIn);
  assert.equal(app.addressable, members.pushOptIn, 'a push reaches exactly the people who opted into it');
});

test('creating an offer stages it and publishes nothing', () => {
  const created = createOffer(SITE, {
    offerId: 'coffee-99', surfaces: ['canopy', 'mobile-app'], durationDays: 3,
  }, { now: NOW, members: memberBase(SITE, { now: NOW }), basketAvg: 8.4 });

  assert.equal(created.status, 'staged');
  assert.match(created.offerId, /^OF-\d{6}$/);
  assert.equal(created.creatives.length, 2);
  assert.ok(created.surfaces.every((surface) => surface.status === 'staged'));
  assert.ok(created.forecast.redemptions.expected >= 0);
});

test('deploying is the separate decision, and an irreversible push says so', () => {
  const created = createOffer(SITE, {
    offerId: 'coffee-99', surfaces: ['canopy', 'mobile-app'], durationDays: 1,
  }, { now: NOW, members: memberBase(SITE, { now: NOW }) });

  const partial = deployOffer(created, { surfaces: ['canopy'], now: NOW });
  assert.equal(partial.surfaces.find((surface) => surface.surfaceId === 'canopy').status, 'live');
  assert.equal(partial.surfaces.find((surface) => surface.surfaceId === 'mobile-app').status, 'not-requested');
  assert.equal(partial.pushSent, false);

  const full = deployOffer(created, { now: NOW });
  const app = full.surfaces.find((surface) => surface.surfaceId === 'mobile-app');
  assert.equal(app.irreversible, true);
  assert.match(app.note, /cannot be recalled/);
  assert.equal(full.pushSent, true);
  assert.equal(full.status, 'live');

  // The in-app card without the push is a different, recallable action.
  const quiet = deployOffer(created, { now: NOW, sendPush: false });
  assert.equal(quiet.surfaces.find((surface) => surface.surfaceId === 'mobile-app').irreversible, false);
  assert.equal(quiet.pushSent, false);
});
