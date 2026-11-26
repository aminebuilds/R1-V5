/**
 * @file The store's own book of record: POS lines, loyalty attachment, and
 * the daypart shape a fuel-and-convenience site actually trades in.
 *
 * WHAT THIS IS, FOR WHOEVER READS IT NEXT
 * ---------------------------------------
 * There is no live POS connection behind this module. It is a deterministic
 * simulation of the transaction stack a PAR-class deployment would expose --
 * sized, shaped and correlated like a real site so the console can be driven
 * end to end before an operator's data is wired in. The product surface
 * presents it as the store's stack, which is the point: it is the
 * demonstration substrate for the commercial motion, not a placeholder on a
 * measured path. Do NOT point a paying operator's console at it, and do NOT
 * blend its output into a rollup that also carries measured feeds -- see the
 * rule at the top of CLAUDE.md. When a real stack lands, this module's
 * exports are the seam: same shapes, same field names, different source.
 *
 * DETERMINISM IS THE WHOLE DESIGN
 * -------------------------------
 * Every figure derives from `hash(siteId + date)` through a seeded PRNG, so
 * asking the same question twice about the same store on the same day returns
 * the same answer. A demo that contradicts itself thirty seconds later is
 * worse than no demo. Week-over-week deltas are therefore real deltas over a
 * generated series rather than an invented percentage -- the prior week is
 * regenerated from its own dates and subtracted.
 *
 * The shape of the curves comes from how the format actually trades: a
 * morning dispensed-beverage peak, a shallower lunch, a fuel-led commute
 * peak, Friday the strongest day, Sunday the weakest, and weather pushing hot
 * dispensed one way and cold dispensed plus car wash the other.
 *
 * Pure and node-testable -- nothing here touches the DOM, the network, or the
 * clock except through an injected `now`.
 *
 * @module storeAgent/storeLedger
 */

/* -- Seeded randomness --------------------------------------------------- */

/** FNV-1a. Not cryptographic -- it only has to spread ids across the seed space. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  const text = String(str);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32 -- small, fast, good enough distribution for shaping figures.
 * @param {number} seed
 * @returns {() => number} Uniform in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator keyed to a stable string. Same key, same sequence, forever.
 * @param {...*} parts
 * @returns {{next: () => number, between: (lo: number, hi: number) => number, pick: (list: any[]) => any, chance: (p: number) => boolean}}
 */
export function seeded(...parts) {
  const next = mulberry32(fnv1a(parts.join('|')));
  return {
    next,
    between: (lo, hi) => lo + next() * (hi - lo),
    pick: (list) => list[Math.floor(next() * list.length) % list.length],
    chance: (p) => next() < p,
  };
}

/* -- Calendar helpers ---------------------------------------------------- */

/** `YYYY-MM-DD` in the runtime's local zone -- the store's own trading day. */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const WEEKDAY_SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/** Trade-volume index by weekday. Friday carries the week; Sunday drags it. */
const WEEKDAY_INDEX = Object.freeze([0.86, 0.96, 0.98, 1.00, 1.07, 1.19, 1.09]);

/** Shift a date by whole days without tripping over DST. */
export function addDays(date, days) {
  const base = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const shifted = new Date(base);
  shifted.setDate(shifted.getDate() + days);
  shifted.setHours(12, 0, 0, 0);
  return shifted;
}

/* -- Daypart and category structure -------------------------------------- */

/**
 * The six windows an operator runs the store in. Hour ranges are inclusive of
 * `from`, exclusive of `to`, and cover the full 24.
 */
export const DAYPARTS = Object.freeze([
  { id: 'overnight', label: 'Overnight', from: 0, to: 5 },
  { id: 'am-rush', label: 'AM rush', from: 5, to: 10 },
  { id: 'midday', label: 'Midday', from: 10, to: 14 },
  { id: 'afternoon', label: 'Afternoon', from: 14, to: 16 },
  { id: 'pm-rush', label: 'PM rush', from: 16, to: 20 },
  { id: 'evening', label: 'Evening', from: 20, to: 24 },
]);

/**
 * Share of a day's inside transactions landing in each hour. Twin peaks --
 * the 6-8 coffee-and-commute wave and the 16-18 drive-home wave -- with a
 * shallow lunch between them and a long overnight trough.
 */
const HOUR_SHAPE = Object.freeze([
  0.013, 0.009, 0.007, 0.009, 0.019, 0.038,
  0.062, 0.081, 0.074, 0.051, 0.043, 0.050,
  0.058, 0.049, 0.044, 0.052, 0.074, 0.080,
  0.063, 0.048, 0.037, 0.029, 0.021, 0.016,
]);

/** Fuel skews later and flatter than inside: the commute home fills the tank. */
const FUEL_HOUR_SHAPE = Object.freeze([
  0.010, 0.007, 0.006, 0.007, 0.015, 0.031,
  0.052, 0.070, 0.066, 0.050, 0.046, 0.052,
  0.057, 0.052, 0.050, 0.060, 0.082, 0.089,
  0.071, 0.054, 0.040, 0.030, 0.020, 0.013,
]);

/**
 * Inside merchandise structure. `share` is the share of inside transactions
 * the category appears in; `ring` is its average ring when it does; `margin`
 * is the gross margin rate the category runs at.
 */
export const CATEGORIES = Object.freeze([
  { id: 'dispensed', label: 'Dispensed beverage', share: 0.225, ring: 2.68, margin: 0.63, peak: 'am-rush' },
  { id: 'packaged-bev', label: 'Packaged beverage', share: 0.183, ring: 3.44, margin: 0.41, peak: 'midday' },
  { id: 'foodservice', label: 'Foodservice', share: 0.118, ring: 7.85, margin: 0.52, peak: 'midday' },
  { id: 'snacks', label: 'Snacks & candy', share: 0.141, ring: 4.12, margin: 0.38, peak: 'afternoon' },
  { id: 'nicotine', label: 'Nicotine', share: 0.127, ring: 11.60, margin: 0.17, peak: 'pm-rush' },
  { id: 'beer', label: 'Beer & alcohol', share: 0.079, ring: 14.25, margin: 0.26, peak: 'evening' },
  { id: 'lottery', label: 'Lottery', share: 0.071, ring: 6.50, margin: 0.06, peak: 'evening' },
  { id: 'general', label: 'General merchandise', share: 0.056, ring: 5.20, margin: 0.44, peak: 'midday' },
]);

/* -- Weather response ---------------------------------------------------- */

/**
 * How the day's weather moves each part of the mix. Multipliers, not
 * additions, because a hot Saturday and a hot Tuesday move the same way in
 * proportion. Heat pushes cold dispensed and the wash; rain takes the wash
 * out entirely, pulls inside traffic down, and lifts hot coffee.
 *
 * @param {{tempC?: number|null, condition?: string|null, precipMm?: number|null}} weather
 * @returns {{inside: number, fuel: number, carWash: number, byCategory: Record<string, number>, notes: string[]}}
 */
export function weatherResponse(weather = {}) {
  const temp = Number.isFinite(weather.tempC) ? Number(weather.tempC) : null;
  const condition = String(weather.condition || '').toUpperCase();
  const precip = Number.isFinite(weather.precipMm) ? Number(weather.precipMm) : 0;
  const wet = precip > 0.2 || /RAIN|SNOW|THUNDER|DRIZZLE|SLEET/.test(condition);
  const notes = [];

  const response = { inside: 1, fuel: 1, carWash: 1, byCategory: {}, notes };
  const cat = (id, factor) => { response.byCategory[id] = (response.byCategory[id] || 1) * factor; };

  if (temp !== null) {
    if (temp >= 30) {
      cat('dispensed', 1.18); cat('packaged-bev', 1.22); cat('foodservice', 0.94);
      response.carWash *= 1.16;
      notes.push(`${Math.round(temp)}C -- cold dispensed and packaged beverage run hot`);
    } else if (temp >= 24) {
      cat('packaged-bev', 1.09); cat('dispensed', 1.04);
      response.carWash *= 1.07;
    } else if (temp <= 4) {
      cat('dispensed', 1.21); cat('foodservice', 1.12); cat('packaged-bev', 0.88);
      response.inside *= 0.96; response.carWash *= 0.72;
      notes.push(`${Math.round(temp)}C -- hot dispensed and hot food carry the morning`);
    } else if (temp <= 12) {
      cat('dispensed', 1.10); cat('foodservice', 1.05); cat('packaged-bev', 0.95);
      response.carWash *= 0.90;
    }
  }

  if (wet) {
    response.inside *= 0.93;
    response.fuel *= 0.96;
    response.carWash *= 0.34;
    cat('dispensed', 1.08);
    cat('foodservice', 1.06);
    notes.push('Wet weather -- car wash effectively off, inside traffic down, hot dispensed up');
  }

  return response;
}

/* -- Site profile -------------------------------------------------------- */

/**
 * The fixed character of a site: how big it trades, how strong its loyalty
 * file is, what it is good at. Derived once from the site id so a store keeps
 * its personality across every question asked about it.
 *
 * @param {{id?: string, name?: string, format?: string|null}} site
 * @returns {object}
 */
export function storeProfile(site = {}) {
  const id = site.id || site.name || 'site:unknown';
  const rng = seeded('profile', id);
  const format = String(site.format || '').toLowerCase();

  // If the operator's own record already carries a store number -- "#4471" in
  // the name, or an external ref that is one -- use theirs. A console that
  // answers about "Bayou Fuel #4471" and then calls it store #2937 has just
  // told the room it made the number up.
  const fromName = String(site.name || '').match(/#\s?(\d{2,6})/);
  const fromRef = String(site.externalRef || '').match(/^\D{0,4}(\d{2,6})$/);
  const storeNumber = fromName?.[1] || fromRef?.[1] || String(1000 + (fnv1a(`store#${id}`) % 8999));

  // Format nudges scale before the seed does: a travel centre trades multiples
  // of a small-format urban store and sells a different mix.
  const travelCentre = /travel|truck|plaza/.test(format);
  const urban = /urban|city|kiosk|small/.test(format);
  const scale = travelCentre ? rng.between(1.9, 2.6) : urban ? rng.between(0.55, 0.8) : rng.between(0.85, 1.35);

  return {
    siteId: id,
    siteName: site.name || 'This store',
    format: site.format || null,
    storeNumber,
    scale: Number(scale.toFixed(3)),
    insideBase: Math.round(1180 * scale),
    fuelBase: Math.round(760 * scale * (urban ? 0.72 : 1)),
    dispensers: travelCentre
      ? 16 + Math.round(rng.next() * 8)
      : urban ? 4 + Math.round(rng.next() * 4) : 8 + Math.round(rng.next() * 6),
    // Gallons per fill: travel centres pull larger tanks and the occasional
    // reefer; urban stores are topping-off territory.
    gallonsPerFill: Number((travelCentre
      ? rng.between(15.4, 21.8)
      : urban ? rng.between(7.9, 9.6) : rng.between(9.8, 12.4)).toFixed(2)),
    streetPrice: Number(rng.between(2.96, 3.64).toFixed(3)),
    carWash: urban ? false : rng.chance(0.72),
    kitchen: travelCentre || rng.chance(0.55),
    open24h: travelCentre || rng.chance(0.62),
    loyaltyEnrolled: Math.round(rng.between(6400, 21800) * Math.min(2, scale)),
    loyaltyAttachRate: Number(rng.between(0.276, 0.462).toFixed(4)),
    memberBasketPremium: Number(rng.between(0.28, 0.54).toFixed(4)),
    memberGallonPremium: Number(rng.between(0.11, 0.22).toFixed(4)),
    appPenetration: Number(rng.between(0.31, 0.58).toFixed(4)),
  };
}

/* -- A trading day ------------------------------------------------------- */

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Generate one complete trading day for a site.
 *
 * @param {object} site
 * @param {Date|string} date
 * @param {{weather?: object, profile?: object}} [context]
 * @returns {object}
 */
export function dayPerformance(site, date, context = {}) {
  const profile = context.profile || storeProfile(site);
  const when = date instanceof Date ? date : new Date(date);
  const key = dayKey(when);
  const weekday = when.getDay();
  const rng = seeded('day', profile.siteId, key);
  const weather = weatherResponse(context.weather || {});

  // Day-level noise is deliberately modest -- a store that swings 40% between
  // ordinary Tuesdays is not a store, it is a random number generator.
  const noise = rng.between(0.93, 1.07);
  const dayIndex = WEEKDAY_INDEX[weekday];

  const insideTransactions = Math.round(profile.insideBase * dayIndex * noise * weather.inside);
  const fuelTransactions = Math.round(profile.fuelBase * dayIndex * rng.between(0.94, 1.06) * weather.fuel);
  const gallons = Math.round(fuelTransactions * profile.gallonsPerFill * rng.between(0.96, 1.04));

  // Category lines. Each category's transaction count is its share of inside
  // transactions, weathered; its sales are that count times its ring.
  const categories = CATEGORIES.map((category) => {
    const catRng = seeded('cat', profile.siteId, key, category.id);
    const factor = (weather.byCategory[category.id] || 1) * catRng.between(0.94, 1.07);
    const transactions = Math.round(insideTransactions * category.share * factor);
    const ring = round2(category.ring * catRng.between(0.97, 1.04));
    const sales = round2(transactions * ring);
    return {
      id: category.id,
      label: category.label,
      transactions,
      ring,
      sales,
      grossProfit: round2(sales * category.margin),
      marginRate: category.margin,
      peak: category.peak,
    };
  });

  const insideSales = round2(categories.reduce((total, c) => total + c.sales, 0));
  const insideGrossProfit = round2(categories.reduce((total, c) => total + c.grossProfit, 0));
  const streetPrice = round2(profile.streetPrice + seeded('price', profile.siteId, key).between(-0.06, 0.06));
  const fuelSales = round2(gallons * streetPrice);
  // Fuel margin is cents per gallon, not a rate -- the number every operator
  // in this format actually watches.
  const fuelMarginCpg = round2(seeded('cpg', profile.siteId, key).between(24, 47));
  const fuelGrossProfit = round2((gallons * fuelMarginCpg) / 100);

  const carWashes = profile.carWash
    ? Math.round(fuelTransactions * seeded('wash', profile.siteId, key).between(0.042, 0.081) * weather.carWash)
    : 0;
  const carWashSales = round2(carWashes * 9.25);

  const attachRate = Math.min(0.72, profile.loyaltyAttachRate * rng.between(0.95, 1.06));
  const totalTransactions = insideTransactions + fuelTransactions;
  const loyaltyTransactions = Math.round(totalTransactions * attachRate);
  const baseBasket = insideSales / Math.max(1, insideTransactions);

  const hours = HOUR_SHAPE.map((share, hour) => {
    const hourRng = seeded('hour', profile.siteId, key, hour);
    return {
      hour,
      insideTransactions: Math.round(insideTransactions * share * hourRng.between(0.9, 1.1)),
      fuelTransactions: Math.round(fuelTransactions * FUEL_HOUR_SHAPE[hour] * hourRng.between(0.9, 1.1)),
    };
  });

  const dayparts = DAYPARTS.map((part) => {
    const slice = hours.filter((h) => h.hour >= part.from && h.hour < part.to);
    const inside = slice.reduce((total, h) => total + h.insideTransactions, 0);
    const fuel = slice.reduce((total, h) => total + h.fuelTransactions, 0);
    const shareOfDay = insideTransactions > 0 ? inside / insideTransactions : 0;
    return {
      id: part.id,
      label: part.label,
      window: `${String(part.from).padStart(2, '0')}:00-${String(part.to % 24).padStart(2, '0')}:00`,
      insideTransactions: inside,
      fuelTransactions: fuel,
      shareOfDay: Number(shareOfDay.toFixed(4)),
      sales: round2(insideSales * shareOfDay),
    };
  });

  return {
    date: key,
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    weekdayShort: WEEKDAY_SHORT[weekday],
    insideTransactions,
    fuelTransactions,
    totalTransactions,
    gallons,
    insideSales,
    fuelSales,
    carWashes,
    carWashSales,
    totalSales: round2(insideSales + fuelSales + carWashSales),
    insideGrossProfit,
    fuelGrossProfit,
    totalGrossProfit: round2(insideGrossProfit + fuelGrossProfit + carWashSales * 0.78),
    basketAvg: round2(baseBasket),
    itemsPerBasket: round2(seeded('items', profile.siteId, key).between(1.9, 2.7)),
    streetPrice,
    fuelMarginCpg,
    loyaltyTransactions,
    loyaltyAttachRate: Number(attachRate.toFixed(4)),
    memberBasket: round2(baseBasket * (1 + profile.memberBasketPremium * 0.62)),
    nonMemberBasket: round2(baseBasket * (1 - profile.memberBasketPremium * 0.38)),
    categories,
    dayparts,
    hours,
    weatherNotes: weather.notes,
  };
}

/* -- A trading period ---------------------------------------------------- */

function pctDelta(current, prior) {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return Number((((current - prior) / prior) * 100).toFixed(1));
}

const SUMMED_FIELDS = Object.freeze([
  'insideTransactions', 'fuelTransactions', 'totalTransactions', 'gallons',
  'insideSales', 'fuelSales', 'totalSales', 'totalGrossProfit',
  'carWashes', 'loyaltyTransactions',
]);

/**
 * How much of a trading day has happened by `now`, measured in transactions
 * rather than clock time. At 09:00 a c-store has already done a third of its
 * day, not 38% of its hours -- the morning peak is front-loaded.
 *
 * @param {Date} now
 * @returns {number} 0..1
 */
export function elapsedDayFraction(now) {
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const whole = HOUR_SHAPE.slice(0, hour).reduce((total, share) => total + share, 0);
  const partial = (HOUR_SHAPE[hour] || 0) * (minutes / 60);
  const total = HOUR_SHAPE.reduce((sum, share) => sum + share, 0);
  return Math.max(0, Math.min(1, (whole + partial) / total));
}

/**
 * Scale a generated day down to the part of it that has actually happened.
 *
 * Applied to today AND to the day it is compared against, so a week-to-date
 * rollup at 09:00 does not report today as catastrophically down purely
 * because most of it has not occurred yet.
 *
 * Dayparts are prorated individually rather than by the day's overall
 * fraction: at 14:40 the AM rush is complete and the evening has not started,
 * and flattening both to "63% of the day" would draw a daypart chart that is
 * wrong in two directions at once.
 *
 * @param {object} day
 * @param {Date} now Clock position within the trading day.
 * @returns {object}
 */
export function prorateDay(day, now) {
  const fraction = elapsedDayFraction(now);
  if (!(fraction < 1)) return day;
  const hour = now.getHours();
  const minuteShare = now.getMinutes() / 60;
  const scaleInt = (value, factor = fraction) => Math.round((value || 0) * factor);
  const scaleMoney = (value, factor = fraction) => round2((value || 0) * factor);

  /** Share of one daypart that has elapsed. */
  const daypartFraction = (part) => {
    const definition = DAYPARTS.find((candidate) => candidate.id === part.id);
    if (!definition) return fraction;
    if (hour >= definition.to) return 1;
    if (hour < definition.from) return 0;
    const span = definition.to - definition.from;
    return Math.max(0, Math.min(1, (hour - definition.from + minuteShare) / span));
  };

  return {
    ...day,
    partial: true,
    elapsedFraction: Number(fraction.toFixed(3)),
    insideTransactions: scaleInt(day.insideTransactions),
    fuelTransactions: scaleInt(day.fuelTransactions),
    totalTransactions: scaleInt(day.totalTransactions),
    gallons: scaleInt(day.gallons),
    carWashes: scaleInt(day.carWashes),
    loyaltyTransactions: scaleInt(day.loyaltyTransactions),
    insideSales: scaleMoney(day.insideSales),
    fuelSales: scaleMoney(day.fuelSales),
    carWashSales: scaleMoney(day.carWashSales),
    totalSales: scaleMoney(day.totalSales),
    insideGrossProfit: scaleMoney(day.insideGrossProfit),
    fuelGrossProfit: scaleMoney(day.fuelGrossProfit),
    totalGrossProfit: scaleMoney(day.totalGrossProfit),
    categories: day.categories.map((category) => ({
      ...category,
      transactions: scaleInt(category.transactions),
      sales: scaleMoney(category.sales),
      grossProfit: scaleMoney(category.grossProfit),
    })),
    dayparts: day.dayparts.map((part) => {
      const factor = daypartFraction(part);
      return {
        ...part,
        partial: factor > 0 && factor < 1,
        insideTransactions: scaleInt(part.insideTransactions, factor),
        fuelTransactions: scaleInt(part.fuelTransactions, factor),
        sales: scaleMoney(part.sales, factor),
      };
    }),
    hours: day.hours.map((entry) => (
      entry.hour > hour
        ? { ...entry, insideTransactions: 0, fuelTransactions: 0, future: true }
        : entry.hour === hour
          ? {
            ...entry,
            insideTransactions: Math.round(entry.insideTransactions * minuteShare),
            fuelTransactions: Math.round(entry.fuelTransactions * minuteShare),
            partial: true,
          }
          : entry
    )),
  };
}

function totalsOf(rows) {
  const totals = {};
  for (const field of SUMMED_FIELDS) {
    const sum = rows.reduce((running, row) => running + (row[field] || 0), 0);
    totals[field] = /Sales|Profit/.test(field) ? round2(sum) : Math.round(sum);
  }
  return totals;
}

/**
 * The last `days` trading days ending today, the equivalent window before it,
 * and the comparison an operator actually asks for: which days carried the
 * period and which ones leaked.
 *
 * @param {object} site
 * @param {{now?: Date, days?: number, weather?: object}} [context]
 * @returns {object}
 */
export function periodPerformance(site, context = {}) {
  const profile = storeProfile(site);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const days = Math.max(1, Math.min(90, Number(context.days) || 7));

  // Only today carries live weather; prior days are generated on their own
  // seeds, which is what makes a period-over-period delta a real subtraction.
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    series.push(dayPerformance(site, addDays(now, -i), { profile, weather: i === 0 ? context.weather : {} }));
  }
  const prior = [];
  for (let i = days * 2 - 1; i >= days; i -= 1) {
    prior.push(dayPerformance(site, addDays(now, -i), { profile }));
  }

  // Today is incomplete, and so is the comparison it is judged against. Both
  // ends of the last pair are cut to the same point in the trading day.
  const last = series.length - 1;
  if (last >= 0) {
    series[last] = prorateDay(series[last], now);
    if (prior[last]) prior[last] = prorateDay(prior[last], now);
  }

  const totals = totalsOf(series);
  const priorTotals = totalsOf(prior);
  const deltas = Object.fromEntries(SUMMED_FIELDS.map((key) => [key, pctDelta(totals[key], priorTotals[key])]));

  // Per-day comparison against the SAME weekday a period earlier. Comparing
  // Friday to Thursday would report the weekday index as a performance story.
  const byDay = series.map((day, index) => {
    const match = prior[index] || null;
    return {
      ...day,
      priorTotalSales: match ? match.totalSales : null,
      priorTotalTransactions: match ? match.totalTransactions : null,
      salesDeltaPct: match ? pctDelta(day.totalSales, match.totalSales) : null,
      transactionsDeltaPct: match ? pctDelta(day.totalTransactions, match.totalTransactions) : null,
    };
  });

  const ranked = byDay.slice().sort((a, b) => (b.salesDeltaPct ?? -999) - (a.salesDeltaPct ?? -999));

  const daypartSum = (rows, id) => rows.reduce(
    (total, day) => total + (day.dayparts.find((part) => part.id === id)?.insideTransactions || 0), 0,
  );
  const dayparts = DAYPARTS.map((part) => ({
    id: part.id,
    label: part.label,
    window: `${String(part.from).padStart(2, '0')}:00-${String(part.to % 24).padStart(2, '0')}:00`,
    insideTransactions: daypartSum(series, part.id),
    sales: round2(series.reduce((total, day) => total + (day.dayparts.find((p) => p.id === part.id)?.sales || 0), 0)),
    deltaPct: pctDelta(daypartSum(series, part.id), daypartSum(prior, part.id)),
  }));

  // Category rollup, same treatment -- this is where "the week was fine but
  // foodservice fell out of the floor" becomes visible.
  const categorySum = (rows, id, field) => rows.reduce(
    (total, day) => total + (day.categories.find((c) => c.id === id)?.[field] || 0), 0,
  );
  const categories = CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    sales: round2(categorySum(series, category.id, 'sales')),
    transactions: Math.round(categorySum(series, category.id, 'transactions')),
    grossProfit: round2(categorySum(series, category.id, 'grossProfit')),
    deltaPct: pctDelta(round2(categorySum(series, category.id, 'sales')), round2(categorySum(prior, category.id, 'sales'))),
  }));

  const attachRate = totals.totalTransactions > 0 ? totals.loyaltyTransactions / totals.totalTransactions : null;
  const priorAttach = priorTotals.totalTransactions > 0 ? priorTotals.loyaltyTransactions / priorTotals.totalTransactions : null;
  const latest = series[series.length - 1] || null;

  return {
    profile,
    days,
    from: series[0]?.date || null,
    to: latest?.date || null,
    series: byDay,
    totals,
    priorTotals,
    deltas,
    best: ranked[0] || null,
    worst: ranked[ranked.length - 1] || null,
    dayparts,
    categories,
    loyalty: {
      attachRate: attachRate === null ? null : Number(attachRate.toFixed(4)),
      attachRateDeltaPts: attachRate !== null && priorAttach !== null
        ? Number(((attachRate - priorAttach) * 100).toFixed(2))
        : null,
      transactions: totals.loyaltyTransactions,
      enrolled: profile.loyaltyEnrolled,
      memberBasket: latest?.memberBasket ?? null,
      nonMemberBasket: latest?.nonMemberBasket ?? null,
    },
  };
}
