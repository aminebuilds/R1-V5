/**
 * @file The member side of the stack: segments, enriched profiles, and the
 * identity bridge that collapses anonymous transactions onto known people.
 *
 * Same standing as `storeLedger.js` -- a deterministic simulation of what a
 * PAR-class loyalty and CDP layer exposes, not a live connection. Read that
 * file's header first.
 *
 * Two things here are worth understanding before changing them.
 *
 * SEGMENTS ARE BEHAVIOURAL, NOT DEMOGRAPHIC. Every segment in this file is
 * defined by what the member does at the pump and the register -- frequency,
 * fuel-to-inside attachment, daypart, category concentration, recency. That
 * is what a c-store operator can actually act on, and it is what makes an
 * offer recommendation defensible: "fuel-only commuters, 3,100 of them, zero
 * inside attach" names both the opportunity and the mechanic that addresses
 * it. No segment is built on an inferred protected attribute, and none should
 * be added.
 *
 * IDENTITY RESOLUTION IS PROBABILISTIC AND SAYS SO. `resolveIdentity` returns
 * a confidence and the specific signals that bridged, because a match at 0.62
 * and a match at 0.98 justify very different actions. A resolution below the
 * review threshold is returned as a candidate, never silently applied.
 *
 * Pure and node-testable.
 *
 * @module storeAgent/memberGraph
 */

import { seeded, storeProfile } from './storeLedger.js';

/** Loyalty tiers, in ascending order of value to the operator. */
export const TIERS = Object.freeze(['Member', 'Silver', 'Gold', 'Platinum']);

/**
 * The behavioural segments the program is cut into. `share` is the share of
 * the enrolled file; the values are per-member-per-month unless stated.
 */
export const SEGMENTS = Object.freeze([
  {
    id: 'am-fuel-coffee',
    label: 'Morning fuel + coffee',
    thesis: 'Fills and buys a hot dispensed beverage on the same visit, five mornings a week.',
    share: 0.135, visitsPerMonth: 9.4, gallonsPerMonth: 42, insideSpendPerMonth: 38.20,
    attachRate: 0.86, redemptionRate: 0.31, churnRisk: 'low', daypart: 'am-rush',
    topCategories: ['dispensed', 'foodservice', 'packaged-bev'],
  },
  {
    id: 'fuel-only',
    label: 'Fuel-only commuters',
    thesis: 'High gallons, never walks inside. The single largest conversion pool on the file.',
    share: 0.205, visitsPerMonth: 6.1, gallonsPerMonth: 58, insideSpendPerMonth: 2.40,
    attachRate: 0.04, redemptionRate: 0.19, churnRisk: 'medium', daypart: 'pm-rush',
    topCategories: [],
  },
  {
    id: 'inside-locals',
    label: 'Inside-only locals',
    thesis: 'Walks or drives in for the store, not the pump. Small basket, high frequency.',
    share: 0.148, visitsPerMonth: 11.2, gallonsPerMonth: 0, insideSpendPerMonth: 52.80,
    attachRate: 1, redemptionRate: 0.38, churnRisk: 'low', daypart: 'midday',
    topCategories: ['packaged-bev', 'snacks', 'lottery'],
  },
  {
    id: 'foodservice-regulars',
    label: 'Foodservice regulars',
    thesis: 'Comes for lunch. Highest inside basket on the file and the most margin per visit.',
    share: 0.085, visitsPerMonth: 7.8, gallonsPerMonth: 19, insideSpendPerMonth: 84.60,
    attachRate: 0.94, redemptionRate: 0.42, churnRisk: 'low', daypart: 'midday',
    topCategories: ['foodservice', 'dispensed', 'packaged-bev'],
  },
  {
    id: 'weekend-family',
    label: 'Weekend family fill',
    thesis: 'Saturday and Sunday, big tank, big basket, takes the wash when the weather allows.',
    share: 0.110, visitsPerMonth: 3.6, gallonsPerMonth: 51, insideSpendPerMonth: 46.10,
    attachRate: 0.71, redemptionRate: 0.34, churnRisk: 'low', daypart: 'midday',
    topCategories: ['snacks', 'packaged-bev', 'general'],
  },
  {
    id: 'nicotine-loyal',
    label: 'Nicotine loyalists',
    thesis: 'Most frequent visitors on the file and the least margin per dollar. Basket-build target.',
    share: 0.098, visitsPerMonth: 14.7, gallonsPerMonth: 31, insideSpendPerMonth: 128.40,
    attachRate: 0.97, redemptionRate: 0.22, churnRisk: 'low', daypart: 'pm-rush',
    topCategories: ['nicotine', 'packaged-bev', 'lottery'],
  },
  {
    id: 'lapsing-high-value',
    label: 'Lapsing high value',
    thesis: 'Was top-decile within the last six months. No visit in 31+ days. Winback window is closing.',
    share: 0.057, visitsPerMonth: 0.4, gallonsPerMonth: 5, insideSpendPerMonth: 3.10,
    attachRate: 0.58, redemptionRate: 0.27, churnRisk: 'critical', daypart: 'pm-rush',
    topCategories: ['dispensed', 'foodservice'],
  },
  {
    id: 'app-native',
    label: 'App-native',
    thesis: 'Opens the app before the visit. The only segment that reliably reads a push before arriving.',
    share: 0.072, visitsPerMonth: 8.3, gallonsPerMonth: 36, insideSpendPerMonth: 61.70,
    attachRate: 0.88, redemptionRate: 0.53, churnRisk: 'low', daypart: 'am-rush',
    topCategories: ['dispensed', 'foodservice', 'snacks'],
  },
  {
    id: 'overnight',
    label: 'Overnight shift',
    thesis: 'Between 22:00 and 05:00. Predictable, under-served, and nobody markets to them.',
    share: 0.047, visitsPerMonth: 10.1, gallonsPerMonth: 27, insideSpendPerMonth: 71.30,
    attachRate: 0.82, redemptionRate: 0.29, churnRisk: 'medium', daypart: 'overnight',
    topCategories: ['dispensed', 'foodservice', 'nicotine'],
  },
  {
    id: 'fleet',
    label: 'Fleet & commercial',
    thesis: 'Card-locked, high gallons, effectively zero inside spend and zero offer sensitivity.',
    share: 0.042, visitsPerMonth: 12.4, gallonsPerMonth: 186, insideSpendPerMonth: 11.90,
    attachRate: 0.12, redemptionRate: 0.06, churnRisk: 'low', daypart: 'am-rush',
    topCategories: [],
  },
]);

const SEGMENT_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));

/** Resolve a segment definition by id. */
export function segmentById(id) {
  return SEGMENT_BY_ID.get(String(id || '')) || null;
}

/* -- Name generation ----------------------------------------------------- */

const GIVEN_NAMES = Object.freeze([
  'Marcus', 'Priya', 'Dwayne', 'Elena', 'Tomas', 'Ayesha', 'Colton', 'Nadia',
  'Rashad', 'Brigitte', 'Hector', 'Yolanda', 'Sean', 'Mei', 'Darnell', 'Lucia',
  'Grant', 'Fatima', 'Reid', 'Simone', 'Omar', 'Kendra', 'Tobias', 'Alina',
]);

const FAMILY_NAMES = Object.freeze([
  'Okafor', 'Delgado', 'Whitfield', 'Nakamura', 'Brennan', 'Castellanos',
  'Ferreira', 'Halloran', 'Ibarra', 'Kowalski', 'Mensah', 'Novak',
  'Prasad', 'Quintero', 'Rasmussen', 'Silva', 'Thibodeaux', 'Vance',
]);

/** A stable display name for a synthetic member reference. */
function nameFor(rng) {
  return `${rng.pick(GIVEN_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
}

/* -- Program rollup ------------------------------------------------------ */

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * The loyalty file at a glance, plus every segment sized against it.
 *
 * @param {object} site
 * @param {{now?: Date}} [context]
 * @returns {object}
 */
export function memberBase(site, context = {}) {
  const profile = storeProfile(site);
  const rng = seeded('members', profile.siteId);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());

  const enrolled = profile.loyaltyEnrolled;
  const active30 = Math.round(enrolled * rng.between(0.38, 0.57));
  const active90 = Math.round(enrolled * rng.between(0.61, 0.78));
  const appInstalled = Math.round(enrolled * profile.appPenetration);
  const pushOptIn = Math.round(appInstalled * rng.between(0.52, 0.74));
  const emailReachable = Math.round(enrolled * rng.between(0.63, 0.82));
  const smsOptIn = Math.round(enrolled * rng.between(0.28, 0.46));

  const segments = SEGMENTS.map((segment) => {
    const segRng = seeded('segment', profile.siteId, segment.id);
    // Each store's file leans differently: a site next to an industrial park
    // carries more fleet, a downtown site carries more inside-only.
    const skew = segRng.between(0.72, 1.34);
    const members = Math.round(enrolled * segment.share * skew);
    const monthlyValue = round2(
      segment.insideSpendPerMonth + segment.gallonsPerMonth * 0.34,
    );
    return {
      ...segment,
      members,
      shareOfFile: Number((members / Math.max(1, enrolled)).toFixed(4)),
      monthlyValuePerMember: monthlyValue,
      monthlyValue: round2(monthlyValue * members),
      // Gross profit contribution, which ranks segments very differently from
      // revenue -- nicotine loyalists spend the most and contribute least.
      monthlyGrossProfit: round2(
        (segment.insideSpendPerMonth * (segment.id === 'nicotine-loyal' ? 0.19 : 0.44)
          + segment.gallonsPerMonth * 0.34) * members,
      ),
      reachable: {
        push: Math.round(members * profile.appPenetration * 0.63),
        email: Math.round(members * 0.71),
        sms: Math.round(members * 0.36),
        inStore: members,
      },
    };
  }).sort((a, b) => b.monthlyGrossProfit - a.monthlyGrossProfit);

  return {
    profile,
    at: now.toISOString(),
    enrolled,
    active30,
    active90,
    lapsed: Math.max(0, enrolled - active90),
    appInstalled,
    pushOptIn,
    emailReachable,
    smsOptIn,
    attachRate: profile.loyaltyAttachRate,
    identifiedShare: profile.loyaltyAttachRate,
    avgVisitsPerMonth: round2(rng.between(4.4, 7.9)),
    memberBasketPremiumPct: Number((profile.memberBasketPremium * 100).toFixed(1)),
    memberGallonPremiumPct: Number((profile.memberGallonPremium * 100).toFixed(1)),
    segments,
  };
}

/* -- Enriched member profile --------------------------------------------- */

/**
 * One member, fully enriched -- the view an operator gets when they ask
 * "who is this?" after a resolution, or "show me a lapsing high-value member".
 *
 * @param {object} site
 * @param {{segmentId?: string, memberId?: string, now?: Date}} [options]
 * @returns {object}
 */
export function memberProfile(site, options = {}) {
  const profile = storeProfile(site);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const segment = segmentById(options.segmentId) || SEGMENTS[0];
  const key = options.memberId || `${profile.siteId}|${segment.id}|1`;
  const rng = seeded('member', key);

  const memberId = options.memberId || `LM-${String(100000 + Math.floor(rng.next() * 899999))}`;
  const tenureMonths = Math.round(rng.between(2, 71));
  const visits90 = Math.max(0, Math.round(segment.visitsPerMonth * 3 * rng.between(0.74, 1.28)));
  const gallons90 = Math.round(segment.gallonsPerMonth * 3 * rng.between(0.78, 1.24));
  const insideSpend90 = round2(segment.insideSpendPerMonth * 3 * rng.between(0.71, 1.33));
  const daysSinceLastVisit = segment.id === 'lapsing-high-value'
    ? Math.round(rng.between(31, 74))
    : Math.round(rng.between(0, 9));

  const tier = segment.id === 'fleet' ? 'Member'
    : insideSpend90 + gallons90 * 0.34 > 420 ? 'Platinum'
      : insideSpend90 + gallons90 * 0.34 > 240 ? 'Gold'
        : insideSpend90 + gallons90 * 0.34 > 110 ? 'Silver' : 'Member';

  const annualValue = round2((insideSpend90 * 0.44 + gallons90 * 0.34) * 4);

  return {
    memberId,
    name: nameFor(rng),
    tier,
    segmentId: segment.id,
    segmentLabel: segment.label,
    homeStore: `#${profile.storeNumber}`,
    enrolledMonthsAgo: tenureMonths,
    lastVisitDaysAgo: daysSinceLastVisit,
    lastVisitAt: new Date(now.getTime() - daysSinceLastVisit * 86400000).toISOString(),
    behaviour: {
      visits90,
      visitsPerMonth: round2(visits90 / 3),
      gallons90,
      insideSpend90,
      avgBasket: round2(insideSpend90 / Math.max(1, visits90 * (segment.attachRate || 0.1))),
      fuelAttachRate: Number(segment.attachRate.toFixed(2)),
      preferredDaypart: segment.daypart,
      preferredGrade: rng.pick(['Regular 87', 'Regular 87', 'Midgrade 89', 'Premium 93', 'Diesel']),
      topCategories: segment.topCategories.slice(0, 3),
      paymentMethod: rng.pick(['Mobile wallet', 'Contactless card', 'Chip card', 'In-app pay', 'Fleet card']),
    },
    value: {
      annualGrossProfit: annualValue,
      lifetimeGrossProfit: round2(annualValue * (tenureMonths / 12)),
      percentileOnFile: Math.min(99, Math.round(rng.between(18, 99))),
      churnRisk: segment.churnRisk,
      churnProbability90d: Number(
        (segment.churnRisk === 'critical' ? rng.between(0.56, 0.81)
          : segment.churnRisk === 'medium' ? rng.between(0.22, 0.41)
            : rng.between(0.04, 0.17)).toFixed(3),
      ),
    },
    reachability: {
      appInstalled: rng.chance(profile.appPenetration),
      pushOptIn: rng.chance(profile.appPenetration * 0.63),
      emailOptIn: rng.chance(0.71),
      smsOptIn: rng.chance(0.36),
      lastOfferOpenedDaysAgo: Math.round(rng.between(1, 46)),
      offerRedemptionRate: Number(segment.redemptionRate.toFixed(2)),
    },
    // The identity graph -- what the CDP has bridged onto this one person.
    identities: [
      { kind: 'loyalty', label: 'Loyalty ID', value: memberId, confidence: 1 },
      { kind: 'payment', label: 'Payment token', value: `tok_${String(rng.next()).slice(2, 12)}`, confidence: Number(rng.between(0.93, 0.99).toFixed(2)) },
      { kind: 'device', label: 'Mobile device', value: `dev_${String(rng.next()).slice(2, 10)}`, confidence: Number(rng.between(0.88, 0.98).toFixed(2)) },
      { kind: 'email', label: 'Email (hashed)', value: `sha256:${String(rng.next()).slice(2, 14)}`, confidence: Number(rng.between(0.9, 0.99).toFixed(2)) },
      { kind: 'vehicle', label: 'Vehicle profile', value: `${rng.pick(['Sedan', 'Pickup', 'SUV', 'Crossover', 'Van'])}, ${Math.round(rng.between(11, 26))} gal tank`, confidence: Number(rng.between(0.62, 0.86).toFixed(2)) },
    ],
    nextBestAction: nextBestAction(segment, daysSinceLastVisit),
  };
}

/**
 * What to do with this member next, given the segment thesis and recency.
 * Deliberately one action, not a menu -- a recommendation that lists five
 * options has not recommended anything.
 *
 * @param {object} segment
 * @param {number} daysSinceLastVisit
 * @returns {{action: string, rationale: string, surface: string, urgency: string}}
 */
export function nextBestAction(segment, daysSinceLastVisit = 0) {
  if (segment.id === 'lapsing-high-value' || daysSinceLastVisit > 30) {
    return {
      action: 'Winback: cents-off-per-gallon, single fill, 7-day expiry',
      rationale: 'Was top-decile and has not filled in over a month. Fuel price is the only lever that reliably restarts the habit.',
      surface: 'mobile-app',
      urgency: 'high',
    };
  }
  if (segment.id === 'fuel-only') {
    return {
      action: 'Free dispensed beverage with an 8+ gallon fill',
      rationale: 'Zero inside attach against high gallons. The first walk-in is the whole objective; the coffee is the cheapest way to buy it.',
      surface: 'pump-topper',
      urgency: 'medium',
    };
  }
  if (segment.id === 'nicotine-loyal') {
    return {
      action: 'Basket-build: pair a dispensed beverage at 99c with the usual purchase',
      rationale: 'Most frequent visitors, thinnest margin. Adding one high-margin line per visit is worth more than another visit.',
      surface: 'in-store-menu',
      urgency: 'medium',
    };
  }
  if (segment.id === 'app-native') {
    return {
      action: 'Timed push 20 minutes before their usual arrival window',
      rationale: 'Highest redemption rate on the file and the only segment that reads a push before arriving.',
      surface: 'mobile-app',
      urgency: 'low',
    };
  }
  return {
    action: 'Points multiplier on their top category for the coming weekend',
    rationale: 'Healthy, habitual, and cheap to keep. Protect the frequency rather than discount the basket.',
    surface: 'mobile-app',
    urgency: 'low',
  };
}

/* -- Identity bridge ----------------------------------------------------- */

/** At or above this, the bridge is applied automatically. Below it, a candidate. */
export const AUTO_MERGE_CONFIDENCE = 0.9;

const SIGNAL_STRENGTH = Object.freeze({
  loyalty: 1,
  payment: 0.62,
  device: 0.48,
  phone: 0.55,
  email: 0.58,
  plate: 0.41,
  'basket-pattern': 0.22,
  geofence: 0.18,
});

/**
 * Bridge an anonymous transaction onto a known member.
 *
 * Returns the resolution WITH its confidence and the signals that produced
 * it. A single weak signal never resolves on its own; two independent weak
 * signals can. Below `AUTO_MERGE_CONFIDENCE` the result is a candidate for
 * review and `applied` is false.
 *
 * @param {object} site
 * @param {{signals?: string[], transactionRef?: string, now?: Date}} [input]
 * @returns {object}
 */
export function resolveIdentity(site, input = {}) {
  const profile = storeProfile(site);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  // An explicitly empty array means "this transaction carried nothing" and
  // must stay anonymous. Only an ABSENT `signals` falls through to whatever
  // the transaction actually had.
  const requested = Array.isArray(input.signals)
    ? input.signals.map((signal) => String(signal).toLowerCase())
    : null;

  const transactionRef = input.transactionRef || `TXN-${String(now.getTime()).slice(-8)}`;
  const rng = seeded('resolve', profile.siteId, transactionRef);

  // Which signals this particular transaction actually carried.
  const available = requested || ['payment', 'device', 'basket-pattern', 'geofence']
    .filter((signal) => rng.chance(signal === 'payment' ? 0.82 : signal === 'device' ? 0.61 : 0.5));

  const signals = available
    .filter((id) => SIGNAL_STRENGTH[id] !== undefined)
    .map((id) => ({
      id,
      label: {
        loyalty: 'Loyalty ID scanned',
        payment: 'Payment token match',
        device: 'Mobile device ID in geofence',
        phone: 'Phone number match',
        email: 'Hashed email match',
        plate: 'Forecourt plate read',
        'basket-pattern': 'Basket pattern match',
        geofence: 'App geofence entry',
      }[id],
      strength: SIGNAL_STRENGTH[id],
      matchedAt: new Date(now.getTime() - Math.round(rng.between(5, 240)) * 1000).toISOString(),
    }));

  // Independent signals compound: 1 - product of (1 - strength). Two 0.5
  // signals give 0.75, not 1.0 -- which is the behaviour that keeps a weak
  // pair from being treated as certainty.
  const confidence = signals.length === 0
    ? 0
    : Number((1 - signals.reduce((residual, signal) => residual * (1 - signal.strength), 1)).toFixed(3));

  if (confidence === 0) {
    return {
      profile,
      transactionRef,
      resolved: false,
      applied: false,
      confidence: 0,
      signals: [],
      member: null,
      reason: 'No resolvable signal on the transaction -- it stays anonymous.',
    };
  }

  const segment = rng.pick(SEGMENTS.filter((s) => s.id !== 'fleet'));
  const member = memberProfile(site, { segmentId: segment.id, memberId: `LM-${String(100000 + Math.floor(rng.next() * 899999))}`, now });

  // Programme-level effect of the bridge, which is the number that actually
  // sells this capability: how much of the anonymous tail it recovers.
  const anonymousDaily = Math.round(profile.insideBase * (1 - profile.loyaltyAttachRate));
  const recovered = Math.round(anonymousDaily * rng.between(0.19, 0.34));

  return {
    profile,
    transactionRef,
    resolved: true,
    applied: confidence >= AUTO_MERGE_CONFIDENCE,
    confidence,
    threshold: AUTO_MERGE_CONFIDENCE,
    signals,
    member,
    reason: confidence >= AUTO_MERGE_CONFIDENCE
      ? 'Bridged and applied to the member record.'
      : 'Held as a review candidate -- below the auto-merge threshold, so nothing was written to the member record.',
    programmeEffect: {
      anonymousTransactionsPerDay: anonymousDaily,
      recoveredPerDay: recovered,
      recoveredSharePct: Number(((recovered / Math.max(1, anonymousDaily)) * 100).toFixed(1)),
      identifiedShareBefore: Number((profile.loyaltyAttachRate * 100).toFixed(1)),
      identifiedShareAfter: Number(
        (((profile.insideBase * profile.loyaltyAttachRate + recovered) / profile.insideBase) * 100).toFixed(1),
      ),
    },
  };
}
