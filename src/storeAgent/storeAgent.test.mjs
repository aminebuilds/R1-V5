// The agent facade: store resolution, the live pulse, and the create/deploy
// separation.
//
// STORE RESOLUTION has an order and the order matters: a named store beats
// the camera, the camera beats an arbitrary pick, and an empty portfolio
// still answers. That last fallback is the one worth defending — an operator
// who has not imported a CSV yet should still be able to ask about the store
// they are looking at, and a console that refuses until data arrives never
// gets to the part where they hand over their data.
//
// THE PULSE never reports a variance it cannot attribute, and never
// attributes more of a gap than the gap contains. Where the console has no
// visibility, the residual is returned as unexplained rather than padded out
// across the causes it does have. A cause list that always sums to 100% is a
// cause list that is guessing.
//
// CREATE AND DEPLOY are two decisions. Building an offer must never publish
// it, and publishing with nothing staged must fail with something an
// operator can act on rather than throwing.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignPerformance,
  memberIntelligence,
  publishOffer,
  recommendOffers,
  resolveStore,
  stageOffer,
  storePerformance,
  storePulse,
} from './storeAgent.js';
import { MAX_EXPLAINED, attributeVariance, equipmentState, realtimePulse } from './storePulse.js';
import { clearOffers } from './offerRegistry.js';
import { storeProfile } from './storeLedger.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store', lat: 30.26, lon: -97.74 };
const NOW = new Date('2026-09-21T14:40:00');
const HOT = { tempC: 31, condition: 'CLEAR', precipMm: 0 };

/** localStorage stand-in, so the offer registry is exercised under node. */
function withStorage(run) {
  const store = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  });
  try {
    clearOffers();
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

/* -- Store resolution ---------------------------------------------------- */

test('a named store wins over the camera', () => {
  const sites = [
    { id: 'a', name: 'Riverside #22', lat: 0, lon: 0 },
    { id: 'b', name: 'Hilltop #91', lat: 50, lon: 50 },
  ];
  const named = resolveStore({ sites, query: 'Hilltop', lat: 0, lon: 0 });
  assert.equal(named.site.id, 'b');
  assert.equal(named.how, 'named');
});

test('with no name, the nearest site to the camera answers, and says how far', () => {
  const sites = [
    { id: 'a', name: 'Riverside #22', lat: 30.1, lon: -97.7 },
    { id: 'b', name: 'Hilltop #91', lat: 47.6, lon: -122.3 },
  ];
  const nearest = resolveStore({ sites, lat: 30.26, lon: -97.74 });
  assert.equal(nearest.site.id, 'a');
  assert.equal(nearest.how, 'nearest-in-view');
  assert.ok(nearest.distanceKm > 0 && nearest.distanceKm < 40);
});

test('an empty portfolio still answers about the store under the camera', () => {
  const anchored = resolveStore({ sites: [], lat: 41.88, lon: -87.63, placeLabel: 'Chicago' });
  assert.equal(anchored.how, 'camera-anchored');
  assert.match(anchored.site.name, /^Store #\d+ - Chicago$/);
  assert.equal(anchored.site.lat, 41.88);
  // Stable: the same place must not become a different store on re-ask.
  assert.equal(resolveStore({ sites: [], lat: 41.88, lon: -87.63, placeLabel: 'Chicago' }).site.id, anchored.site.id);
});

test('a site with no coordinates never wins a proximity contest', () => {
  const sites = [{ id: 'a', name: 'No Geocode', lat: null, lon: null }];
  assert.equal(resolveStore({ sites, lat: 30, lon: -97 }).how, 'only-site');
});

/* -- Pulse --------------------------------------------------------------- */

test('attribution never claims more of a gap than the gap contains', () => {
  const profile = storeProfile(SITE);
  // A 4% dip with several candidate causes must not come back 100%
  // explained by weights calibrated for a 20% one.
  const small = attributeVariance({
    varianceRatio: -0.04,
    weather: { tempC: 6, condition: 'RAIN', precipMm: 4 },
    traffic: { bottleneckCount: 4, closureCount: 2, maxDelayMinutes: 18 },
    equipment: { faults: [{ id: 'dispenser', label: 'Dispenser 3 offline', detail: '', since: '2h' }] },
    profile,
    now: NOW,
  });
  const covered = small.causes.reduce((total, cause) => total + cause.share, 0);
  assert.ok(covered <= 1.001, `attribution over-claims: ${covered}`);
  assert.ok(Math.abs(covered + small.unexplainedShare - 1) < 0.01, 'shares plus unexplained must account for the whole gap');
});

test('the console never claims to have explained all of a gap', () => {
  // It cannot see a queue, a card outage, a staffing gap or a school
  // holiday. A single cause reported at 100% is a claim to have seen
  // everything that happened in that hour.
  const overwhelming = attributeVariance({
    varianceRatio: -0.05,
    weather: { tempC: 2, condition: 'SNOW', precipMm: 9 },
    traffic: { bottleneckCount: 8, closureCount: 4, maxDelayMinutes: 40 },
    competitors: [{ name: 'Circle K', distanceKm: 0.4 }],
    equipment: { faults: [{ id: 'dispenser', label: 'Dispenser 1 offline', detail: '', since: '3h' }] },
    profile: storeProfile(SITE),
    now: NOW,
  });
  const covered = overwhelming.causes.reduce((total, cause) => total + cause.share, 0);
  assert.ok(covered <= MAX_EXPLAINED + 0.001, `attribution claimed ${covered} of the gap`);
  assert.ok(overwhelming.unexplainedShare >= 1 - MAX_EXPLAINED - 0.001, 'some residual is always left honest');
  for (const cause of overwhelming.causes) {
    assert.ok(cause.share < 1, `${cause.id} claimed the entire gap on its own`);
  }
});

test('a gap with nothing visible behind it is reported as unexplained, not padded', () => {
  const none = attributeVariance({
    varianceRatio: -0.15,
    weather: {},
    traffic: null,
    competitors: null,
    equipment: { faults: [] },
    profile: storeProfile(SITE),
    now: NOW,
  });
  assert.deepEqual(none.causes, []);
  assert.equal(none.unexplainedShare, 1);
});

test('traffic only ever explains a fall, never a rise', () => {
  const traffic = { bottleneckCount: 5, closureCount: 2, maxDelayMinutes: 20 };
  const base = { weather: {}, traffic, equipment: { faults: [] }, profile: storeProfile(SITE), now: NOW };
  const down = attributeVariance({ ...base, varianceRatio: -0.2 });
  const up = attributeVariance({ ...base, varianceRatio: 0.2 });
  assert.ok(down.causes.some((cause) => cause.id === 'traffic'));
  assert.ok(!up.causes.some((cause) => cause.id === 'traffic'), 'a closure removes visits, it does not create them');
});

test('every attributed cause names a source and whether it can be acted on', () => {
  const result = attributeVariance({
    varianceRatio: -0.18,
    weather: { tempC: 4, condition: 'RAIN', precipMm: 5 },
    traffic: { bottleneckCount: 3, closureCount: 1, maxDelayMinutes: 12 },
    competitors: [{ name: 'Circle K', distanceKm: 0.8 }],
    equipment: { faults: [] },
    profile: storeProfile(SITE),
    now: NOW,
  });
  assert.ok(result.causes.length > 0);
  for (const cause of result.causes) {
    assert.ok(cause.label && cause.detail && cause.source, `${cause.id} is missing provenance`);
    assert.ok(cause.share > 0 && cause.share <= 1);
  }
  // Ordered strongest first — the operator reads the top line and acts.
  for (let i = 1; i < result.causes.length; i += 1) {
    assert.ok(result.causes[i - 1].share >= result.causes[i].share);
  }
});

test('equipment faults are occasional, not constant', () => {
  // A console that reports a dispenser down every time it is opened teaches
  // people to ignore it.
  let faulty = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const at = new Date(`2026-09-21T${String(hour).padStart(2, '0')}:00:00`);
    if (!equipmentState(storeProfile(SITE), at).healthy) faulty += 1;
  }
  assert.ok(faulty < 12, `equipment is faulty ${faulty}/24 hours — too noisy to be believed`);
});

test('the pulse is stable within the hour and states its own scope', () => {
  const a = realtimePulse(SITE, { now: NOW, weather: HOT });
  const b = realtimePulse(SITE, { now: new Date('2026-09-21T14:52:00'), weather: HOT });
  assert.equal(a.hour.actual, b.hour.actual, 'a reading must not move while it is being discussed');
  assert.ok(['dip', 'lift', 'on-plan'].includes(a.state));
  assert.ok(a.trailing.length > 0 && a.trailing.length <= 6);
  assert.equal(a.trailing[a.trailing.length - 1].partial, true, 'the current hour is in progress');
  assert.ok(a.daypart, 'the pulse must know which daypart it is in');
  assert.equal(a.daypart.id, 'afternoon');
  assert.ok(a.hour.soFar <= a.hour.runRatePerHour, 'what has happened cannot exceed the projected hour');
});

test('an on-plan hour offers no causes at all', () => {
  const found = [0, 3, 6, 9, 12, 15, 18, 21]
    .map((hour) => realtimePulse(SITE, { now: new Date(`2026-09-21T${String(hour).padStart(2, '0')}:20:00`) }))
    .find((pulse) => pulse.state === 'on-plan');
  if (found) {
    assert.deepEqual(found.causes, [], 'a store running to plan needs no explanation');
    assert.equal(found.unexplainedShare, 0);
  }
});

/* -- Entry points -------------------------------------------------------- */

test('every entry point returns a spoken readout and names its store', () => {
  const context = { now: NOW, weather: HOT };
  const results = [
    storePerformance(SITE, { ...context, period: 'week' }),
    storePulse(SITE, context),
    memberIntelligence(SITE, context),
    memberIntelligence(SITE, { ...context, focus: 'member', segmentId: 'fuel-only' }),
    memberIntelligence(SITE, { ...context, focus: 'identity' }),
    campaignPerformance(SITE, context),
    recommendOffers(SITE, context),
  ];
  for (const result of results) {
    assert.ok(result.readout && result.readout.length > 20, `${result.kind} has no usable readout`);
    assert.equal(result.store.number, '1204');
    assert.ok(result.kind);
  }
});

test('an identity match below the bar is narrated as held, never as known', () => {
  const held = memberIntelligence(SITE, { now: NOW, focus: 'identity', signals: ['device', 'geofence'] });
  assert.equal(held.resolution.applied, false);
  assert.match(held.readout, /^Matched/);
  assert.match(held.readout, /held for review/);
  assert.ok(!/^Bridged/.test(held.readout));

  const applied = memberIntelligence(SITE, { now: NOW, focus: 'identity', signals: ['loyalty'] });
  assert.equal(applied.resolution.applied, true);
  assert.match(applied.readout, /^Bridged/);
});

test('a recommendation names one offer, why it fired, and how fast it can run', () => {
  const result = recommendOffers(SITE, { now: NOW, weather: HOT, limit: 3 });
  assert.equal(result.candidates.length, 3);
  assert.match(result.readout, /^Run /);
  assert.match(result.readout, /Why now:|default rather than a read/);
  assert.match(result.readout, /Live in \d+ minutes/);
  for (let i = 1; i < result.candidates.length; i += 1) {
    assert.ok(result.candidates[i - 1].score >= result.candidates[i].score);
  }
});

test('staging an offer never publishes it, and says so out loud', () => withStorage(() => {
  const staged = stageOffer(SITE, {
    offerId: 'coffee-99', surfaces: ['canopy', 'mobile-app'], durationDays: 2,
  }, { now: NOW, weather: HOT });

  assert.equal(staged.status, 'staged');
  assert.ok(staged.surfaces.every((surface) => surface.status === 'staged'));
  assert.match(staged.readout, /Nothing is live until you say so/);
  assert.ok(staged.creatives.length === 2);
}));

test('publishing with nothing staged fails with something an operator can act on', () => withStorage(() => {
  const nothing = publishOffer({ now: NOW });
  assert.equal(nothing.ok, false);
  assert.match(nothing.readout, /no staged offer|Tell me what to build/i);

  const missing = publishOffer({ offerId: 'OF-000000', now: NOW });
  assert.equal(missing.ok, false);
  assert.match(missing.readout, /OF-000000/);
}));

test('publishing picks up the offer staged moments earlier and flags the push', () => withStorage(() => {
  const staged = stageOffer(SITE, {
    offerId: 'coffee-99', surfaces: ['canopy', 'mobile-app'], durationDays: 2,
  }, { now: NOW, weather: HOT });

  const live = publishOffer({ now: NOW });
  assert.equal(live.ok, true);
  assert.equal(live.offerId, staged.offerId, '"push it live" means the one just built');
  assert.equal(live.status, 'live');
  assert.equal(live.pushSent, true);
  assert.match(live.readout, /is live on/);
}));

test('an offer published this session joins the campaign book as too early to read', () => withStorage(() => {
  stageOffer(SITE, { offerId: 'coffee-99', surfaces: ['canopy'], durationDays: 3 }, { now: NOW, weather: HOT });
  publishOffer({ now: NOW });

  const result = campaignPerformance(SITE, { now: NOW });
  const mine = result.campaigns.find((campaign) => campaign.launchedThisSession);
  assert.ok(mine, 'a just-launched campaign must appear in "what is running"');
  assert.equal(mine.verdict, 'too-early');
  assert.equal(mine.paceRatio, null, 'a campaign minutes old has no pace to report');
  assert.equal(mine.actual.redemptions, 0);
  assert.equal(mine.actual.perDay, null, 'zero redemptions in zero days is not a rate');
  assert.match(mine.advice, /full daypart/);
}));
