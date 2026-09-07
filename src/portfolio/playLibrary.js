/**
 * @file The play library: parameterised interventions with explicit triggers.
 *
 * The rule this file exists to enforce — a recommendation reaching an operator
 * is a LOOKUP, never a sentence a language model composed. The model may
 * choose among these plays and phrase the delivery; it may not invent the
 * play, the threshold that fired it, or the lift it claims.
 *
 * Every play carries `expectedLiftPct: null` until a holdout test measures it.
 * A play with a number in that field has been measured; one without says so.
 * There are no seeded "typical" values, because a plausible prior is
 * indistinguishable from a result once it is on screen.
 *
 * @module portfolio/playLibrary
 */

/**
 * @typedef {object} Play
 * @property {string} id Stable identifier — the unit of measurement.
 * @property {string} name Operator-facing name.
 * @property {string} action What actually gets done.
 * @property {string} rationale Why this fires, in one line.
 * @property {object} trigger Threshold set evaluated against a signal bundle.
 * @property {{value: number|null, confidence: string, n: number}} expectedLiftPct
 * @property {boolean} requiresApproval Never auto-executed.
 * @property {string[]} categories Site categories the play applies to.
 */

/** @type {readonly Play[]} */
export const PLAYS = Object.freeze([
  Object.freeze({
    id: 'play:cooloff-cold-drink',
    name: 'Cool-off cold drink bundle',
    action: 'Forecourt signage + geo-push: cold drink bundled with fill-up',
    rationale: 'Queued traffic on an adjacent corridor puts stopped, uncomfortable drivers within a short detour.',
    trigger: { minDelayMin: 8, maxDistanceM: 1200, approach: ['near'], minConversionScore: 65 },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    requiresApproval: true,
    categories: ['fuel', 'convenience', 'coffee', 'cafe', 'fast_food'],
  }),
  Object.freeze({
    id: 'play:cooloff-coffee-break',
    name: 'Construction-delay coffee break',
    action: 'Digital signage promoting a fixed-price hot drink + restroom stop',
    rationale: 'A closure or construction zone produces sustained, predictable delay rather than a transient spike.',
    trigger: { minDelayMin: 12, maxDistanceM: 1800, requiresConstruction: true, minConversionScore: 60 },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    requiresApproval: true,
    categories: ['coffee', 'cafe', 'fuel', 'convenience', 'restaurant'],
  }),
  Object.freeze({
    id: 'play:farside-skip',
    name: 'Suppress promo — far-side site',
    action: 'Do not spend promo budget on this site during this window',
    rationale: 'Reaching the site needs a left turn across the queue; conversion does not justify the spend.',
    trigger: { minDelayMin: 8, approach: ['far'] },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    requiresApproval: false,
    categories: ['fuel', 'convenience', 'coffee', 'cafe', 'fast_food', 'retail'],
  }),
  Object.freeze({
    id: 'play:price-hold-through-decline',
    name: 'Hold pump price through a wholesale decline',
    action: 'Hold street price while the modelled wholesale cost falls; re-evaluate weekly',
    rationale: 'Pass-through on declines is slower than on increases; holding captures margin without moving off the local price rank.',
    trigger: { minForecastDeclineCents: 3, maxPriceRankFromCheapest: 3 },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    categories: ['fuel'],
    requiresApproval: true,
  }),
  Object.freeze({
    id: 'play:price-match-local',
    name: 'Match the local cheapest',
    action: 'Move street price to within 1¢ of the cheapest competitor inside 1 mi',
    rationale: 'Site is priced above every mapped competitor in its own ring and is losing rank on the corridor.',
    trigger: { minCentsAboveLocalMin: 6, minCompetitorsWithin1km: 1 },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    requiresApproval: true,
    categories: ['fuel'],
  }),
  Object.freeze({
    id: 'play:supply-risk-forward-buy',
    name: 'Bring forward the next fuel buy',
    action: 'Advance the scheduled wholesale purchase ahead of the modelled band widening',
    rationale: 'Disruption index has broken its trailing threshold; the forecast band has widened upward.',
    trigger: { minDisruptionIndex: 70 },
    expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
    requiresApproval: true,
    categories: ['fuel'],
  }),
]);

/** @type {Map<string, Play>} */
const BY_ID = new Map(PLAYS.map((play) => [play.id, play]));

/**
 * @param {string} id
 * @returns {Play|null}
 */
export function getPlay(id) {
  return BY_ID.get(String(id || '')) || null;
}

/**
 * Does a site's category text match a play's category list?
 * @param {string} categoryText Free text from site name/format.
 * @param {string[]} categories
 * @returns {boolean}
 */
export function matchesCategory(categoryText, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return true;
  const text = String(categoryText || '').toLowerCase();
  return categories.some((c) => text.includes(String(c).toLowerCase().replace(/_/g, ' '))
    || text.includes(String(c).toLowerCase()));
}

/**
 * Evaluate one play's trigger against a signal bundle.
 *
 * Missing signals never satisfy a threshold. A play cannot fire on data the
 * product does not have — which is the whole point of separating the trigger
 * from the phrasing.
 *
 * @param {Play} play
 * @param {object} signals Measured values: `delayMin`, `distanceToBottleneckM`,
 *   `approach`, `conversionScore`, `isConstruction`, `forecastDeclineCents`,
 *   `centsAboveLocalMin`, `competitorsWithin1km`, `priceRankFromCheapest`,
 *   `disruptionIndex`, `categoryText`.
 * @returns {boolean}
 */
export function playFires(play, signals = {}) {
  const t = play?.trigger;
  if (!t) return false;
  if (!matchesCategory(signals.categoryText, play.categories)) return false;

  const num = (v) => (Number.isFinite(v) ? v : null);

  if (Number.isFinite(t.minDelayMin)) {
    const d = num(signals.delayMin);
    if (d === null || d < t.minDelayMin) return false;
  }
  if (Number.isFinite(t.maxDistanceM)) {
    const d = num(signals.distanceToBottleneckM);
    if (d === null || d > t.maxDistanceM) return false;
  }
  if (Array.isArray(t.approach) && !t.approach.includes(signals.approach)) return false;
  if (t.requiresConstruction && !signals.isConstruction) return false;
  if (Number.isFinite(t.minConversionScore)) {
    const s = num(signals.conversionScore);
    if (s === null || s < t.minConversionScore) return false;
  }
  if (Number.isFinite(t.minForecastDeclineCents)) {
    const c = num(signals.forecastDeclineCents);
    if (c === null || c < t.minForecastDeclineCents) return false;
  }
  if (Number.isFinite(t.maxPriceRankFromCheapest)) {
    const r = num(signals.priceRankFromCheapest);
    if (r === null || r > t.maxPriceRankFromCheapest) return false;
  }
  if (Number.isFinite(t.minCentsAboveLocalMin)) {
    const c = num(signals.centsAboveLocalMin);
    if (c === null || c < t.minCentsAboveLocalMin) return false;
  }
  if (Number.isFinite(t.minCompetitorsWithin1km)) {
    const n = num(signals.competitorsWithin1km);
    if (n === null || n < t.minCompetitorsWithin1km) return false;
  }
  if (Number.isFinite(t.minDisruptionIndex)) {
    const i = num(signals.disruptionIndex);
    if (i === null || i < t.minDisruptionIndex) return false;
  }
  return true;
}

/**
 * Every play whose trigger the signals satisfy, most specific first.
 *
 * Specificity = number of thresholds the play actually tests, so a play that
 * needed four conditions outranks one that needed one.
 * @param {object} signals
 * @returns {Array<{play: Play, specificity: number}>}
 */
export function selectPlays(signals = {}) {
  return PLAYS
    .filter((play) => playFires(play, signals))
    .map((play) => ({ play, specificity: Object.keys(play.trigger || {}).length }))
    .sort((a, b) => b.specificity - a.specificity);
}
