/**
 * @file The action half of the store agent: what offer to run, what it looks
 * like on each screen, and what happens when it is pushed live.
 *
 * Same standing as `storeLedger.js` -- deterministic simulation of the offer
 * and content-distribution layer a PAR-class stack exposes. Read that file's
 * header first.
 *
 * THREE THINGS THIS FILE INSISTS ON
 *
 * 1. An offer is a mechanic, not a discount. Every entry in the catalogue
 *    names what it is trying to change -- attach a first inside visit, build
 *    a thin basket, restart a lapsed habit, defend gallons against a price
 *    move -- because that is what decides whether it is the right one at
 *    14:40 on a wet Thursday. A catalogue of percentages off would rank
 *    identically in every situation, which is the same as not ranking.
 *
 * 2. The forecast carries a band and its own sample size. `forecastLift`
 *    returns low/expected/high and the number of prior runs of that mechanic
 *    at that site behind it. It is `modelled`, never `measured`, and the
 *    composer is required to say so. This is a different claim from the play
 *    library's, which carries `expectedLiftPct: null` precisely because it has
 *    no redemption history to reason from -- do not let the two blur.
 *
 * 3. Creative is composed per surface, not resized. A canopy at 40 mph gets
 *    three words; the app gets the terms. `buildCreative` returns a typed
 *    spec -- never markup -- so the renderer owns pixels and this file stays
 *    pure and node-testable.
 *
 * @module storeAgent/offerStudio
 */

import { CATEGORIES, dayPerformance, seeded, storeProfile } from './storeLedger.js';

/* -- Surfaces ------------------------------------------------------------ */

/**
 * Every screen the stack can put an offer on. `maxHeadline` is a hard copy
 * budget, not a suggestion -- it is set by how long someone looks.
 */
export const SURFACES = Object.freeze([
  {
    id: 'canopy',
    label: 'Forecourt canopy',
    where: 'Overhead LED spans, visible from the road and the approach lanes',
    aspect: [8, 3],
    maxHeadline: 22,
    dwellSeconds: 4,
    leadTimeMinutes: 2,
    reachModel: 'passing-traffic',
  },
  {
    id: 'pump-topper',
    label: 'Dispenser screen',
    where: 'Topper display at each fuelling position',
    aspect: [3, 4],
    maxHeadline: 30,
    dwellSeconds: 95,
    leadTimeMinutes: 2,
    reachModel: 'fuel-transactions',
  },
  {
    id: 'in-store-menu',
    label: 'In-store menu board',
    where: 'Digital menu behind the foodservice counter',
    aspect: [16, 9],
    maxHeadline: 34,
    dwellSeconds: 40,
    leadTimeMinutes: 5,
    reachModel: 'inside-transactions',
  },
  {
    id: 'mobile-app',
    label: 'Mobile app',
    where: 'Offer card on the app home surface, plus optional push',
    aspect: [4, 5],
    maxHeadline: 44,
    dwellSeconds: 20,
    leadTimeMinutes: 1,
    reachModel: 'push-opt-in',
  },
  {
    id: 'register-prompt',
    label: 'Register prompt',
    where: 'Cashier-facing upsell on the POS terminal',
    aspect: [1, 1],
    maxHeadline: 28,
    dwellSeconds: 6,
    leadTimeMinutes: 10,
    reachModel: 'inside-transactions',
  },
  {
    id: 'e-receipt',
    label: 'Digital receipt',
    where: 'Footer of the emailed and printed receipt',
    aspect: [3, 1],
    maxHeadline: 36,
    dwellSeconds: 8,
    leadTimeMinutes: 15,
    reachModel: 'identified-transactions',
  },
]);

const SURFACE_BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));

/** Resolve a surface definition by id, or null. */
export function surfaceById(id) {
  return SURFACE_BY_ID.get(String(id || '')) || null;
}

/* -- Offer catalogue ----------------------------------------------------- */

/**
 * The mechanics this format actually runs. `cost` is the gross-profit give
 * per redemption; `baseRedemption` is the share of exposed, eligible members
 * who take it under ordinary conditions.
 */
export const OFFER_CATALOG = Object.freeze([
  {
    id: 'coffee-99',
    name: '99c any size hot coffee',
    mechanic: 'fixed-price',
    objective: 'basket-build',
    category: 'dispensed',
    value: 0.99,
    valueLabel: '99c',
    headline: '99c ANY SIZE COFFEE',
    shortHeadline: '99c COFFEE',
    detail: 'Any size hot dispensed beverage for 99 cents, members only, one per day.',
    cost: 0.72,
    baseRedemption: 0.28,
    triggers: ['am-rush', 'cold', 'wet', 'dip', 'overnight'],
    segments: ['fuel-only', 'nicotine-loyal', 'app-native', 'overnight'],
    surfaces: ['canopy', 'pump-topper', 'in-store-menu', 'mobile-app', 'register-prompt'],
    motif: 'coffee',
  },
  {
    id: 'coffee-with-fill',
    name: 'Free coffee with an 8+ gallon fill',
    mechanic: 'conditional-free',
    objective: 'inside-attach',
    category: 'dispensed',
    value: 2.49,
    valueLabel: 'FREE',
    headline: 'FILL 8 GAL. COFFEE IS ON US',
    shortHeadline: 'FREE COFFEE',
    detail: 'Fill 8 gallons or more and take any size hot dispensed beverage free. Scan at the register.',
    cost: 0.94,
    baseRedemption: 0.22,
    triggers: ['am-rush', 'cold', 'pm-rush', 'fuel-only-heavy'],
    segments: ['fuel-only', 'fleet', 'weekend-family'],
    surfaces: ['canopy', 'pump-topper', 'mobile-app', 'e-receipt'],
    motif: 'coffee',
  },
  {
    id: 'cents-off-gallon',
    name: 'Cents off per gallon, single fill',
    mechanic: 'cents-per-gallon',
    objective: 'volume-defence',
    category: 'fuel',
    value: 0.22,
    valueLabel: '22c/GAL',
    headline: 'SAVE 22c A GALLON',
    shortHeadline: '22c OFF/GAL',
    detail: 'Twenty-two cents off every gallon on one fill, up to 25 gallons. Members only.',
    cost: 4.60,
    baseRedemption: 0.41,
    triggers: ['competitor-price', 'dip', 'pm-rush', 'lapsed'],
    segments: ['fuel-only', 'lapsing-high-value', 'weekend-family', 'am-fuel-coffee'],
    surfaces: ['canopy', 'pump-topper', 'mobile-app', 'e-receipt'],
    motif: 'fuel',
  },
  {
    id: 'winback-gallon',
    name: 'Winback: 15c/gal, 7-day expiry',
    mechanic: 'cents-per-gallon',
    objective: 'winback',
    category: 'fuel',
    value: 0.15,
    valueLabel: '15c/GAL',
    headline: 'WE MISS YOU. 15c A GALLON.',
    shortHeadline: '15c OFF/GAL',
    detail: 'Fifteen cents off per gallon on your next fill. Expires in seven days. Lapsed members only.',
    cost: 2.90,
    baseRedemption: 0.27,
    triggers: ['lapsed'],
    segments: ['lapsing-high-value'],
    surfaces: ['mobile-app', 'e-receipt'],
    motif: 'fuel',
  },
  {
    id: 'wash-with-fill',
    name: '$3 off a wash with any fill',
    mechanic: 'bundle-discount',
    objective: 'attach-high-margin',
    category: 'carwash',
    value: 3,
    valueLabel: '$3 OFF',
    headline: '$3 OFF ANY WASH TODAY',
    shortHeadline: '$3 OFF WASH',
    detail: 'Three dollars off any wash package when you fill. Code prints on the receipt and holds for 30 days.',
    cost: 1.85,
    baseRedemption: 0.19,
    triggers: ['hot', 'dry', 'weekend', 'afternoon'],
    segments: ['weekend-family', 'am-fuel-coffee', 'fuel-only'],
    surfaces: ['canopy', 'pump-topper', 'register-prompt', 'e-receipt'],
    motif: 'wash',
  },
  {
    id: 'pizza-combo',
    name: '2 slices + fountain drink, $5.99',
    mechanic: 'combo-price',
    objective: 'basket-build',
    category: 'foodservice',
    value: 5.99,
    valueLabel: '$5.99',
    headline: '2 SLICES + DRINK $5.99',
    shortHeadline: '2 SLICES $5.99',
    detail: 'Two slices and any size fountain drink for $5.99. Available while the case is hot.',
    cost: 1.42,
    baseRedemption: 0.33,
    triggers: ['midday', 'wet', 'dip', 'evening'],
    segments: ['foodservice-regulars', 'inside-locals', 'overnight'],
    surfaces: ['in-store-menu', 'canopy', 'mobile-app', 'register-prompt'],
    motif: 'food',
  },
  {
    id: 'breakfast-combo',
    name: 'Breakfast sandwich + coffee, $4.99',
    mechanic: 'combo-price',
    objective: 'basket-build',
    category: 'foodservice',
    value: 4.99,
    valueLabel: '$4.99',
    headline: 'SANDWICH + COFFEE $4.99',
    shortHeadline: 'BREAKFAST $4.99',
    detail: 'Any breakfast sandwich with any size hot coffee, $4.99 before 10am.',
    cost: 1.28,
    baseRedemption: 0.31,
    triggers: ['am-rush', 'cold'],
    segments: ['am-fuel-coffee', 'app-native', 'foodservice-regulars'],
    surfaces: ['in-store-menu', 'canopy', 'pump-topper', 'mobile-app'],
    motif: 'food',
  },
  {
    id: 'cold-dispensed-79',
    name: 'Any size fountain, 79c',
    mechanic: 'fixed-price',
    objective: 'traffic-drive',
    category: 'dispensed',
    value: 0.79,
    valueLabel: '79c',
    headline: 'ANY SIZE FOUNTAIN 79c',
    shortHeadline: '79c FOUNTAIN',
    detail: 'Any size cold fountain drink for 79 cents while the heat holds.',
    cost: 0.44,
    baseRedemption: 0.36,
    triggers: ['hot', 'afternoon', 'dip'],
    segments: ['inside-locals', 'fuel-only', 'weekend-family', 'app-native'],
    surfaces: ['canopy', 'in-store-menu', 'pump-topper', 'mobile-app'],
    motif: 'cold',
  },
  {
    id: 'energy-2for5',
    name: '2 for $5 energy drinks',
    mechanic: 'multibuy',
    objective: 'basket-build',
    category: 'packaged-bev',
    value: 5,
    valueLabel: '2 FOR $5',
    headline: '2 FOR $5 ENERGY',
    shortHeadline: '2 FOR $5',
    detail: 'Any two participating energy drinks for five dollars.',
    cost: 1.10,
    baseRedemption: 0.29,
    triggers: ['afternoon', 'overnight', 'pm-rush'],
    segments: ['overnight', 'nicotine-loyal', 'inside-locals', 'app-native'],
    surfaces: ['in-store-menu', 'register-prompt', 'mobile-app', 'canopy'],
    motif: 'cold',
  },
  {
    id: 'points-3x',
    name: '3x points this weekend',
    mechanic: 'points-multiplier',
    objective: 'frequency-defence',
    category: 'program',
    value: 3,
    valueLabel: '3X POINTS',
    headline: '3X POINTS ALL WEEKEND',
    shortHeadline: '3X POINTS',
    detail: 'Triple points on every gallon and every item, Friday through Sunday.',
    cost: 0.61,
    baseRedemption: 0.44,
    triggers: ['weekend', 'competitor-price', 'frequency-slip'],
    segments: ['app-native', 'am-fuel-coffee', 'foodservice-regulars', 'weekend-family'],
    surfaces: ['mobile-app', 'canopy', 'in-store-menu', 'e-receipt'],
    motif: 'points',
  },
  {
    id: 'late-grill-2for3',
    name: '2 for $3 roller grill after 8pm',
    mechanic: 'multibuy',
    objective: 'traffic-drive',
    category: 'foodservice',
    value: 3,
    valueLabel: '2 FOR $3',
    headline: '2 FOR $3 AFTER 8PM',
    shortHeadline: '2 FOR $3',
    detail: 'Any two roller grill items for three dollars, 8pm to close. Clears the case, holds the margin.',
    cost: 0.86,
    baseRedemption: 0.34,
    triggers: ['evening', 'overnight', 'dip'],
    segments: ['overnight', 'inside-locals', 'nicotine-loyal'],
    surfaces: ['in-store-menu', 'canopy', 'register-prompt', 'mobile-app'],
    motif: 'food',
  },
]);

const OFFER_BY_ID = new Map(OFFER_CATALOG.map((offer) => [offer.id, offer]));

/** Resolve a catalogue offer by id, or null. */
export function offerById(id) {
  return OFFER_BY_ID.get(String(id || '')) || null;
}

/* -- Context triggers ---------------------------------------------------- */

/**
 * Turn the console's live context into the trigger vocabulary the catalogue
 * is written against. This is the only place conditions become keywords, so
 * a new trigger is added here and nowhere else.
 *
 * @param {{now?: Date, weather?: object, pulse?: object|null, competitors?: object[]|null, members?: object|null}} context
 * @returns {{triggers: Set<string>, reasons: Record<string, string>}}
 */
export function contextTriggers(context = {}) {
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const hour = now.getHours();
  const day = now.getDay();
  const triggers = new Set();
  const reasons = {};
  const add = (trigger, why) => { triggers.add(trigger); reasons[trigger] = why; };

  if (hour >= 5 && hour < 10) add('am-rush', 'Inside the morning peak');
  else if (hour >= 10 && hour < 14) add('midday', 'Inside the lunch window');
  else if (hour >= 14 && hour < 16) add('afternoon', 'Afternoon trough');
  else if (hour >= 16 && hour < 20) add('pm-rush', 'Inside the commute-home peak');
  else if (hour >= 20 && hour < 24) add('evening', 'Evening trade');
  else add('overnight', 'Overnight window');

  if (day === 5 || day === 6 || day === 0) add('weekend', 'Weekend trade pattern');

  const weather = context.weather || {};
  const temp = Number.isFinite(weather.tempC) ? Number(weather.tempC) : null;
  const precip = Number.isFinite(weather.precipMm) ? Number(weather.precipMm) : 0;
  const wet = precip > 0.2 || /RAIN|SNOW|THUNDER|DRIZZLE|SLEET/.test(String(weather.condition || '').toUpperCase());
  if (temp !== null && temp >= 27) add('hot', `${Math.round(temp)}C at the site`);
  if (temp !== null && temp <= 10) add('cold', `${Math.round(temp)}C at the site`);
  if (wet) add('wet', 'Precipitation at the site');
  else add('dry', 'Dry at the site');

  if (context.pulse?.state === 'dip') {
    add('dip', `Transactions running ${Math.abs(context.pulse.hour?.variancePct ?? 0)}% under plan this hour`);
  }
  const priceCause = (context.pulse?.causes || []).find((cause) => cause.id === 'competitor-price');
  if (priceCause) add('competitor-price', priceCause.label);

  const fuelOnly = (context.members?.segments || []).find((segment) => segment.id === 'fuel-only');
  if (fuelOnly && fuelOnly.shareOfFile > 0.2) {
    add('fuel-only-heavy', `${fuelOnly.members.toLocaleString('en-US')} members on file with no inside attach`);
  }
  const lapsing = (context.members?.segments || []).find((segment) => segment.id === 'lapsing-high-value');
  if (lapsing && lapsing.members > 300) {
    add('lapsed', `${lapsing.members.toLocaleString('en-US')} lapsing high-value members`);
  }

  return { triggers, reasons };
}

/* -- Ranking ------------------------------------------------------------- */

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Prior performance of a mechanic at a site. This is what separates a
 * forecast from a guess, and the `runs` count is why the band is the width
 * it is -- three prior runs earn a much wider band than eleven.
 *
 * @param {object} profile
 * @param {object} offer
 * @returns {{runs: number, meanRedemption: number, dispersion: number}}
 */
export function priorRuns(profile, offer) {
  const rng = seeded('priors', profile.siteId, offer.id);
  const runs = Math.round(rng.between(2, 14));
  return {
    runs,
    meanRedemption: Number((offer.baseRedemption * rng.between(0.84, 1.19)).toFixed(3)),
    // Fewer runs, wider dispersion. Floors at 0.14 so a well-tested mechanic
    // never comes back claiming near-certainty.
    dispersion: Number(Math.max(0.14, 0.62 / Math.sqrt(runs)).toFixed(3)),
  };
}

/**
 * Score every catalogue offer against the live context.
 *
 * @param {object} site
 * @param {object} context
 * @returns {{ranked: object[], triggers: string[], reasons: Record<string, string>}}
 */
export function rankOffers(site, context = {}) {
  const profile = storeProfile(site);
  const { triggers, reasons } = contextTriggers(context);
  const segments = context.members?.segments || [];
  const goal = context.goal ? String(context.goal) : null;

  const ranked = OFFER_CATALOG.map((offer) => {
    const matched = offer.triggers.filter((trigger) => triggers.has(trigger));
    const priors = priorRuns(profile, offer);

    // Trigger fit dominates; segment reach and prior performance break ties.
    let score = matched.length * 24;
    const reach = segments
      .filter((segment) => offer.segments.includes(segment.id))
      .reduce((total, segment) => total + segment.members, 0);
    score += Math.min(28, reach / 260);
    score += priors.meanRedemption * 34;
    // A mechanic with only two prior runs is a worse recommendation than an
    // equally-fitting one with ten, and should rank that way.
    score += Math.min(10, priors.runs);
    if (goal && offer.objective === goal) score += 30;
    if (offer.category === 'carwash' && !profile.carWash) score = -1;
    if (offer.category === 'foodservice' && !profile.kitchen) score -= 40;

    return {
      offer,
      score: Number(score.toFixed(2)),
      matchedTriggers: matched,
      reachableMembers: Math.round(reach),
      priors,
      reasons: matched.map((trigger) => reasons[trigger]).filter(Boolean),
      rationale: matched.length
        ? matched.map((trigger) => reasons[trigger]).filter(Boolean).join('; ')
        : 'No live trigger fires for this mechanic right now.',
    };
  })
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score);

  return { ranked, triggers: [...triggers], reasons };
}

/* -- Forecast ------------------------------------------------------------ */

/**
 * Forecast the effect of running an offer. MODELLED, with a band and the
 * sample size behind it -- a composer must present all three.
 *
 * @param {object} site
 * @param {object} offer
 * @param {{exposed?: number, matchedTriggers?: string[], basketAvg?: number, durationDays?: number, capacityPerDay?: number|null}} input
 * @returns {object}
 */
export function forecastOffer(site, offer, input = {}) {
  const profile = storeProfile(site);
  const priors = priorRuns(profile, offer);
  const exposed = Math.max(0, Math.round(Number(input.exposed) || 0));
  const basketAvg = Number(input.basketAvg) || 8.4;
  const durationDays = Math.max(1, Number(input.durationDays) || 1);

  // A mechanic whose triggers are all firing outperforms its own history;
  // one fired blind underperforms it. Bounded so the adjustment can never
  // dominate the prior.
  const fit = Array.isArray(input.matchedTriggers) ? input.matchedTriggers.length : 0;
  const fitFactor = Math.max(0.68, Math.min(1.32, 0.86 + fit * 0.11));

  const expectedRate = Number((priors.meanRedemption * fitFactor).toFixed(4));
  const loRate = Number(Math.max(0, expectedRate * (1 - priors.dispersion)).toFixed(4));
  const hiRate = Number((expectedRate * (1 + priors.dispersion)).toFixed(4));

  // The store cannot redeem more coffees than it can physically pour. A
  // redemption model that ignores category capacity will happily forecast
  // 500 coffees a day at a site that sells 350 -- which is the single fastest
  // way to lose an operator's trust in the whole console. The ceiling is the
  // category's own baseline plus the most a promotion has ever lifted it.
  const capacityPerDay = Number.isFinite(input.capacityPerDay) ? Number(input.capacityPerDay) : null;
  const ceiling = capacityPerDay === null ? null : Math.round(capacityPerDay * CAPACITY_HEADROOM * durationDays);
  const clamp = (value) => (ceiling === null ? value : Math.min(value, ceiling));

  const redemptions = clamp(Math.round(exposed * expectedRate));
  const capped = ceiling !== null && Math.round(exposed * expectedRate) > ceiling;

  const economics = offerEconomics(offer, redemptions, {
    basketAvg,
    gallonsPerFill: profile.gallonsPerFill,
    fuelMarginCpg: input.fuelMarginCpg,
    streetPrice: profile.streetPrice,
  });

  return {
    kind: 'modelled',
    basis: `${priors.runs} prior run${priors.runs === 1 ? '' : 's'} of this mechanic at store #${profile.storeNumber}`,
    priorRuns: priors.runs,
    exposed,
    durationDays,
    redemptionRate: { lo: loRate, expected: expectedRate, hi: hiRate },
    redemptions: {
      lo: clamp(Math.round(exposed * loRate)),
      expected: redemptions,
      hi: clamp(Math.round(exposed * hiRate)),
    },
    capped,
    capacityPerDay,
    capacityNote: capped
      ? `Capped at category capacity: this site turns about ${Math.round(capacityPerDay)} of these a day, so the ceiling over ${durationDays} day${durationDays === 1 ? '' : 's'} is ${ceiling.toLocaleString('en-US')}. Demand above that walks.`
      : null,
    incrementalVisits: economics.incrementalRedemptions,
    incrementalSales: economics.incrementalSales,
    marginGive: economics.marginGive,
    netGrossProfit: economics.netGrossProfit,
    economics,
    // Stated so nobody reads the band as a guarantee. The composer surfaces
    // this verbatim.
    caveat: 'Modelled from prior runs of this mechanic at this site. Not a measured result -- the band is the forecast, not a range of outcomes already observed.',
  };
}

/** The most a promotion has lifted a category above its own baseline here. */
const CAPACITY_HEADROOM = 1.7;

/**
 * Share of redemptions that would NOT have happened without the offer.
 * Everything else is a discount on a sale the store was going to make
 * anyway, which is the cost side of every promotion and the reason a
 * campaign can run "ahead of plan" while losing money.
 *
 * NOTE ON WHAT "INCREMENTAL" COUNTS. The unit differs by objective, and
 * conflating them makes whole classes of offer look structurally unprofitable
 * when they are not. A volume-defence mechanic is incremental only if the
 * VISIT would not have happened -- most fills were coming regardless. A
 * basket-build mechanic is incremental if the ITEM would not have been
 * bought, which is true far more often, because the visit was happening
 * either way and the promoted line is the thing being added to it.
 */
const INCREMENTAL_SHARE = Object.freeze({
  winback: 0.78,            // visit-incremental: they had stopped coming
  'inside-attach': 0.61,    // visit-incremental: first walk-in off the forecourt
  'basket-build': 0.58,     // item-incremental: the line added to a visit already happening
  'attach-high-margin': 0.52,
  'traffic-drive': 0.44,
  'frequency-defence': 0.34,
  'volume-defence': 0.33,   // visit-incremental: most fills were coming anyway
});

/** How often a fuel-led redemption also walks inside and buys something. */
const FUEL_INSIDE_ATTACH_LIFT = 0.18;

/**
 * The money a run of this offer actually makes or costs.
 *
 * Promotion economics, done the way an operator would check them: you earn
 * margin on the volume the offer CREATED, and you pay the discount on the
 * volume that was coming anyway. A model that credits every redemption as
 * incremental will report a 22-cent-a-gallon giveaway as a profit centre,
 * which is exactly the kind of number that gets a console thrown out.
 *
 * Cents-per-gallon mechanics are costed per gallon, not per redemption --
 * the give scales with tank size and nothing else does.
 *
 * @param {object} offer
 * @param {number} redemptions
 * @param {{basketAvg?: number, gallonsPerFill?: number, fuelMarginCpg?: number}} [rates]
 * @returns {object}
 */
export function offerEconomics(offer, redemptions, rates = {}) {
  const count = Math.max(0, Math.round(Number(redemptions) || 0));
  const basketAvg = Number(rates.basketAvg) || 8.4;
  const gallonsPerFill = Number(rates.gallonsPerFill) || 10.8;
  const fuelMarginCpg = Number(rates.fuelMarginCpg) || 34;
  const incrementalShare = INCREMENTAL_SHARE[offer.objective] ?? 0.3;
  const incremental = Math.round(count * incrementalShare);
  const cannibalised = count - incremental;

  if (offer.mechanic === 'cents-per-gallon') {
    const discountCpg = offer.value * 100;
    const gallons = Math.round(count * gallonsPerFill);
    const incrementalGallons = Math.round(incremental * gallonsPerFill);
    // Margin earned on volume the offer created, net of its own discount...
    const earnedOnIncremental = (incrementalGallons * Math.max(0, fuelMarginCpg - discountCpg)) / 100;
    // ...minus the discount handed to volume that was coming regardless.
    const paidOnCannibalised = ((gallons - incrementalGallons) * discountCpg) / 100;
    const insideAttach = incremental * FUEL_INSIDE_ATTACH_LIFT * basketAvg * 0.44;
    return {
      redemptions: count,
      incrementalRedemptions: incremental,
      cannibalisedRedemptions: cannibalised,
      gallons,
      incrementalGallons,
      incrementalSales: round2(incrementalGallons * (rates.streetPrice || 3.2) + incremental * FUEL_INSIDE_ATTACH_LIFT * basketAvg),
      marginGive: round2((gallons * discountCpg) / 100),
      netGrossProfit: round2(earnedOnIncremental + insideAttach - paidOnCannibalised),
      note: `Costed per gallon: ${discountCpg.toFixed(0)}c off ${gallons.toLocaleString('en-US')} gallons. ${Math.round(incrementalShare * 100)}% of fills treated as incremental; the rest are a discount on volume that was coming anyway.`,
    };
  }

  // Everything else is a per-unit give against a per-unit margin.
  const give = count * offer.cost;
  const unitGrossProfit = offer.objective === 'basket-build'
    ? basketAvg * 0.44 * 0.52
    : basketAvg * 0.44 * 0.78;
  const earned = incremental * unitGrossProfit;
  const paidOnCannibalised = cannibalised * offer.cost;

  return {
    redemptions: count,
    incrementalRedemptions: incremental,
    cannibalisedRedemptions: cannibalised,
    gallons: null,
    incrementalGallons: null,
    incrementalSales: round2(incremental * basketAvg * (offer.objective === 'basket-build' ? 0.52 : 0.78)),
    marginGive: round2(give),
    netGrossProfit: round2(earned - paidOnCannibalised),
    note: `${Math.round(incrementalShare * 100)}% of redemptions treated as incremental; the remaining ${cannibalised.toLocaleString('en-US')} are a discount on a sale that was already coming.`,
  };
}

/**
 * Baseline daily units for the category an offer sits in -- the input the
 * capacity ceiling is built from. Fuel and program-wide mechanics have no
 * single category line, so they return null and go uncapped.
 *
 * @param {object} site
 * @param {object} offer
 * @param {Date} now
 * @returns {number|null}
 */
export function categoryCapacity(site, offer, now) {
  if (offer.category === 'fuel' || offer.category === 'program') return null;
  if (offer.category === 'carwash') {
    return dayPerformance(site, now).carWashes || null;
  }
  if (!CATEGORIES.some((category) => category.id === offer.category)) return null;
  const line = dayPerformance(site, now).categories.find((category) => category.id === offer.category);
  return line ? line.transactions : null;
}

/* -- Creative ------------------------------------------------------------ */

/** Palette per motif. Kept inside the DESIGN-V5 chromatic budget. */
const MOTIF_PALETTE = Object.freeze({
  coffee: { accent: '#F2B33D', ink: '#0D1216', paper: '#E4EAEE' },
  fuel: { accent: '#62E0A8', ink: '#06080A', paper: '#E4EAEE' },
  wash: { accent: '#7FC8FF', ink: '#06080A', paper: '#E4EAEE' },
  food: { accent: '#FF6A45', ink: '#0D1216', paper: '#E4EAEE' },
  cold: { accent: '#4FD6C0', ink: '#06080A', paper: '#E4EAEE' },
  points: { accent: '#B9C6D0', ink: '#06080A', paper: '#E4EAEE' },
});

/** Clip a headline to a surface's copy budget without cutting mid-word. */
function fitHeadline(text, max) {
  const clean = String(text || '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Compose the creative for one offer on one surface.
 *
 * Returns a typed spec, never markup: the renderer decides pixels. Copy is
 * written for the surface rather than resized onto it -- the canopy gets the
 * short headline because nobody reads a sentence at 40 mph.
 *
 * @param {object} offer A catalogue offer, or a created offer's `offer` field.
 * @param {string} surfaceId
 * @param {{brand?: string, storeNumber?: string, endsAt?: string|null, audienceLabel?: string|null}} [options]
 * @returns {object|null}
 */
export function buildCreative(offer, surfaceId, options = {}) {
  const surface = surfaceById(surfaceId);
  if (!surface || !offer) return null;
  const palette = MOTIF_PALETTE[offer.motif] || MOTIF_PALETTE.points;
  const brand = options.brand || 'Your brand';
  const audience = options.audienceLabel || 'Members';

  const perSurface = {
    canopy: {
      kicker: 'TODAY',
      headline: fitHeadline(offer.shortHeadline, surface.maxHeadline),
      sub: 'MEMBERS - SCAN INSIDE',
      cta: null,
      terms: null,
    },
    'pump-topper': {
      kicker: 'WHILE YOU FILL',
      headline: fitHeadline(offer.headline, surface.maxHeadline),
      sub: 'Scan your app at the register',
      cta: 'STEP INSIDE',
      terms: 'One per member per day.',
    },
    'in-store-menu': {
      kicker: 'TODAY ONLY',
      headline: fitHeadline(offer.headline, surface.maxHeadline),
      sub: offer.detail,
      cta: 'ASK AT THE COUNTER',
      terms: 'Members only. One per member per day.',
    },
    'mobile-app': {
      kicker: `${audience.toUpperCase()} - JUST FOR YOU`,
      headline: fitHeadline(offer.headline, surface.maxHeadline),
      sub: offer.detail,
      cta: 'ADD TO MY OFFERS',
      terms: `One per member per day.${options.endsAt ? ` Ends ${options.endsAt}.` : ''} Participating item only.`,
    },
    'register-prompt': {
      kicker: 'ADD TO THIS SALE',
      headline: fitHeadline(offer.shortHeadline, surface.maxHeadline),
      sub: 'Offer this to the customer',
      cta: 'ADD',
      terms: null,
    },
    'e-receipt': {
      kicker: 'ON YOUR NEXT VISIT',
      headline: fitHeadline(offer.headline, surface.maxHeadline),
      sub: 'Code is saved to your account automatically',
      cta: null,
      terms: options.endsAt ? `Expires ${options.endsAt}.` : 'Expires in 7 days.',
    },
  }[surface.id];

  return {
    surfaceId: surface.id,
    surfaceLabel: surface.label,
    where: surface.where,
    aspect: surface.aspect,
    motif: offer.motif,
    palette,
    brand,
    storeNumber: options.storeNumber || null,
    value: offer.valueLabel,
    ...perSurface,
  };
}

/* -- Offer creation ------------------------------------------------------ */

/**
 * Reach for a surface at a site, from the surface's own reach model. An
 * offer on the canopy and the same offer in the app reach very different
 * numbers of very differently-qualified people, and the difference decides
 * where it should run.
 *
 * @param {object} surface
 * @param {object} profile
 * @param {object|null} members
 * @returns {{impressions: number, addressable: number, note: string}}
 */
export function surfaceReach(surface, profile, members = null) {
  const daily = {
    'passing-traffic': Math.round(profile.fuelBase * 7.4),
    'fuel-transactions': profile.fuelBase,
    'inside-transactions': profile.insideBase,
    'identified-transactions': Math.round((profile.insideBase + profile.fuelBase) * profile.loyaltyAttachRate),
    'push-opt-in': members
      ? members.pushOptIn
      : Math.round(profile.loyaltyEnrolled * profile.appPenetration * 0.63),
  }[surface.reachModel] || 0;

  const addressable = surface.reachModel === 'passing-traffic'
    ? Math.round(daily * 0.14)
    : surface.reachModel === 'push-opt-in' ? daily : Math.round(daily * profile.loyaltyAttachRate);

  return {
    impressions: daily,
    addressable,
    note: {
      'passing-traffic': 'Vehicles past the forecourt per day; addressable is the share that stops.',
      'fuel-transactions': 'One impression per fuelling transaction.',
      'inside-transactions': 'One impression per inside transaction.',
      'identified-transactions': 'Only transactions matched to a member receive a receipt.',
      'push-opt-in': 'Members with the app installed and push permission granted.',
    }[surface.reachModel] || '',
  };
}

/**
 * Create an offer: resolve the mechanic, build creative for every requested
 * surface, size the reach, and forecast the result.
 *
 * Nothing here publishes. `deployOffer` is the separate, deliberate step --
 * creating and pushing live are two different decisions and the tool surface
 * keeps them apart.
 *
 * @param {object} site
 * @param {object} spec
 * @param {object} [context]
 * @returns {object}
 */
export function createOffer(site, spec = {}, context = {}) {
  const profile = storeProfile(site);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const members = context.members || null;

  const base = offerById(spec.offerId) || null;
  // A free-form request ("a 79-cent fountain offer") is matched onto the
  // nearest mechanic rather than invented, so the forecast has priors behind
  // it. An unmatched request falls back to the top-ranked offer.
  const resolved = base || matchOfferFromText(spec.description || spec.name || '', site, context);

  const offer = {
    ...resolved,
    ...(spec.valueLabel ? { valueLabel: String(spec.valueLabel).toUpperCase() } : {}),
    ...(spec.headline ? { headline: String(spec.headline).toUpperCase(), shortHeadline: String(spec.headline).toUpperCase() } : {}),
    ...(spec.name ? { name: String(spec.name) } : {}),
  };

  const durationDays = Math.max(1, Math.min(30, Number(spec.durationDays) || 1));
  const endsAt = new Date(now.getTime() + durationDays * 86400000);
  const endsLabel = `${endsAt.getMonth() + 1}/${endsAt.getDate()}`;

  const requestedSurfaces = Array.isArray(spec.surfaces) && spec.surfaces.length
    ? spec.surfaces.map(String)
    : offer.surfaces.slice(0, 3);
  const surfaces = requestedSurfaces
    .map((id) => surfaceById(id))
    .filter(Boolean)
    .map((surface) => ({
      ...surfaceReach(surface, profile, members),
      surfaceId: surface.id,
      surfaceLabel: surface.label,
      leadTimeMinutes: surface.leadTimeMinutes,
      status: 'staged',
    }));

  const audienceSegment = spec.segmentId
    ? (members?.segments || []).find((segment) => segment.id === spec.segmentId) || null
    : null;
  const audienceLabel = audienceSegment ? audienceSegment.label : 'All members';
  const exposed = audienceSegment
    ? audienceSegment.members
    : surfaces.reduce((total, surface) => Math.max(total, surface.addressable), 0);

  const ranking = rankOffers(site, context).ranked.find((row) => row.offer.id === offer.id) || null;
  const forecast = forecastOffer(site, offer, {
    exposed,
    matchedTriggers: ranking?.matchedTriggers || [],
    basketAvg: context.basketAvg,
    durationDays,
    capacityPerDay: categoryCapacity(site, offer, now),
  });

  const rng = seeded('offer', profile.siteId, offer.id, now.toISOString().slice(0, 13));
  const offerId = `OF-${String(Math.floor(rng.next() * 900000) + 100000)}`;

  return {
    offerId,
    createdAt: now.toISOString(),
    status: 'staged',
    site: { id: profile.siteId, name: profile.siteName, storeNumber: profile.storeNumber },
    offer,
    audience: {
      segmentId: audienceSegment?.id || null,
      label: audienceLabel,
      size: exposed,
      reachable: audienceSegment ? audienceSegment.reachable : null,
    },
    durationDays,
    endsAt: endsAt.toISOString(),
    endsLabel,
    surfaces,
    creatives: surfaces.map((surface) => buildCreative(offer, surface.surfaceId, {
      brand: context.brand || profile.siteName,
      storeNumber: profile.storeNumber,
      endsAt: endsLabel,
      audienceLabel,
    })).filter(Boolean),
    forecast,
    matchedTriggers: ranking?.matchedTriggers || [],
    rationale: ranking?.rationale || null,
  };
}

/**
 * Match free text onto the nearest catalogue mechanic. Keyword scoring, not a
 * language model -- an unmatched phrase falls through to the best-ranked
 * offer for the current context rather than inventing a mechanic with no
 * history behind it.
 *
 * @param {string} text
 * @param {object} site
 * @param {object} context
 * @returns {object}
 */
export function matchOfferFromText(text, site, context = {}) {
  const raw = String(text || '').toLowerCase();
  if (raw) {
    const scored = OFFER_CATALOG.map((offer) => {
      let score = 0;
      const words = `${offer.name} ${offer.detail} ${offer.category} ${offer.mechanic}`.toLowerCase();
      for (const token of raw.split(/[^a-z0-9.]+/).filter((t) => t.length > 2)) {
        if (words.includes(token)) score += 3;
      }
      if (/coffee/.test(raw) && offer.category === 'dispensed' && offer.motif === 'coffee') score += 6;
      if (/(gallon|gal\b|fuel|gas)/.test(raw) && offer.category === 'fuel') score += 6;
      if (/(wash)/.test(raw) && offer.category === 'carwash') score += 8;
      if (/(pizza|slice|sandwich|food|grill|hot dog)/.test(raw) && offer.category === 'foodservice') score += 6;
      if (/(fountain|soda|energy|drink)/.test(raw) && offer.category === 'packaged-bev') score += 4;
      if (/(fountain|soda)/.test(raw) && offer.id === 'cold-dispensed-79') score += 6;
      if (/(point|multiplier)/.test(raw) && offer.mechanic === 'points-multiplier') score += 8;
      if (/(win ?back|lapsed|miss you)/.test(raw) && offer.objective === 'winback') score += 8;
      // A price in the request is the strongest signal there is: "99 cent
      // coffee" and "free coffee with a fill" are different mechanics with
      // different economics, and only the number separates them. Tokens
      // this short are filtered out of the word pass above, so match them
      // against the value explicitly.
      for (const number of raw.match(/\d+/g) || []) {
        const haystack = `${offer.valueLabel} ${offer.name} ${offer.headline}`.toLowerCase();
        if (haystack.includes(number)) score += 9;
      }
      return { offer, score };
    }).sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) return scored[0].offer;
  }
  return rankOffers(site, context).ranked[0]?.offer || OFFER_CATALOG[0];
}

/* -- Deployment ---------------------------------------------------------- */

/**
 * Push a created offer live on its surfaces.
 *
 * Surfaces do not all accept content at the same speed, and the ones that
 * touch a customer's phone are the ones that cannot be unsent -- so the
 * result reports per-surface state and marks which pushes were irreversible.
 *
 * @param {object} created The return of `createOffer`.
 * @param {{surfaces?: string[], now?: Date, sendPush?: boolean}} [options]
 * @returns {object}
 */
export function deployOffer(created, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const only = Array.isArray(options.surfaces) && options.surfaces.length
    ? new Set(options.surfaces.map(String))
    : null;

  const surfaces = (created.surfaces || []).map((surface) => {
    if (only && !only.has(surface.surfaceId)) return { ...surface, status: 'not-requested' };
    const liveAt = new Date(now.getTime() + surface.leadTimeMinutes * 60000);
    const irreversible = surface.surfaceId === 'mobile-app' && options.sendPush !== false;
    return {
      ...surface,
      status: 'live',
      liveAt: liveAt.toISOString(),
      liveInMinutes: surface.leadTimeMinutes,
      irreversible,
      note: irreversible
        ? 'Push notification dispatched - cannot be recalled once sent. The in-app card can be withdrawn.'
        : 'Content is live on this surface and can be withdrawn at any time.',
    };
  });

  const live = surfaces.filter((surface) => surface.status === 'live');

  return {
    ...created,
    status: live.length > 0 ? 'live' : created.status,
    deployedAt: now.toISOString(),
    surfaces,
    liveSurfaceCount: live.length,
    totalImpressionsPerDay: live.reduce((total, surface) => total + surface.impressions, 0),
    pushSent: live.some((surface) => surface.surfaceId === 'mobile-app' && surface.irreversible),
  };
}
