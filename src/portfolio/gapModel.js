/**
 * @file Per-site performance gap — modelled expected volume vs. ACTUAL
 * volume, in dollars.
 *
 * The honest position this file takes, and the reason it looks the way it
 * does: **a gap cannot be computed from public data alone.** "Actual" is the
 * operator's own number. It lives in their POS, and nothing on the open
 * internet substitutes for it.
 *
 * The previous implementation manufactured both sides — expected volume from
 * a hash of the site id, actual volume from a second hash — and multiplied
 * the difference by a margin constant to produce a dollar figure that ranked
 * a queue. Deterministic, so it never flickered, and entirely fictional. It
 * stamped `confidence: 'placeholder'`, which was honest as far as it went,
 * but a ranked dollar queue is read as a finding no matter what the field
 * says.
 *
 * So this module now does two separate things and refuses to confuse them:
 *
 *  1. **Demand potential** (`scoreDemandPotential`) — a 0–100 index built
 *     only from things actually measured about a location: competitor density
 *     at real distances, the class of the road it sits on, and its live flow
 *     reading. Always available, never expressed in dollars, and explicitly
 *     an index rather than a volume.
 *
 *  2. **Dollar gap** (`scoreSiteGap`) — computed ONLY when the caller supplies
 *     `actualGallons`. Without it the row comes back with `gapUsd: null` and
 *     `confidence: 'requires-actuals'`, and the ranking falls back to demand
 *     potential so the queue still has a defensible order.
 *
 * @module portfolio/gapModel
 */

/**
 * Gross margin dollars per gallon of recovered volume, annualised: fuel CPG
 * plus the inside-basket pull-through a marginal fill-up drags with it.
 *
 * These are the shape of an operator's economics, not any specific
 * operator's. They are exposed as an override on every entry point precisely
 * so a real customer's numbers replace them rather than being buried.
 */
export const DEFAULT_ECONOMICS = Object.freeze({
  fuelMarginPerGallon: 0.36,
  basketAttachRate: 0.42,
  basketMarginPerVisit: 0.33 * 1.9,
  gallonsPerVisit: 12,
});

/**
 * Dollars of annual gross margin per gallon/year of volume gap.
 * @param {typeof DEFAULT_ECONOMICS} [economics]
 * @returns {number}
 */
export function usdPerGallonGap(economics = DEFAULT_ECONOMICS) {
  const visitsPerGallon = 1 / (economics.gallonsPerVisit || DEFAULT_ECONOMICS.gallonsPerVisit);
  return economics.fuelMarginPerGallon
    + visitsPerGallon * economics.basketAttachRate * economics.basketMarginPerVisit;
}

/** Road classes ranked by the passing volume they typically carry. */
const ROAD_CLASS_WEIGHT = {
  motorway: 1.0,
  trunk: 0.9,
  primary: 0.75,
  secondary: 0.55,
  tertiary: 0.4,
  residential: 0.2,
  other: 0.45,
};

/**
 * Demand-potential index for one site, 0–100, from measured inputs only.
 *
 * Deliberately NOT a volume and NOT a dollar figure. It ranks locations by how
 * much passing demand the measurable evidence supports, and says which inputs
 * were available — a site scored on road class alone is not comparable to one
 * scored on road class plus live flow plus a full competitor sweep, and the
 * `inputs` array is how a caller can tell.
 *
 * @param {object} site Site record; may carry `roadType`, `trafficLevel`.
 * @param {{competitorsWithin1km?: number, competitorsWithin3km?: number}} [competition]
 * @returns {{
 *   siteId: string,
 *   demandPotential: number|null,
 *   inputs: string[],
 *   confidence: 'measured-inputs'|'insufficient-inputs'
 * }|null}
 */
export function scoreDemandPotential(site, competition = {}) {
  if (!site?.id) return null;

  const inputs = [];
  let score = 50; // neutral prior, moved only by evidence

  const roadType = String(site.roadType || '').toLowerCase();
  if (roadType && ROAD_CLASS_WEIGHT[roadType] !== undefined) {
    inputs.push('road-class');
    // A motorway frontage is worth up to +25; a residential street loses.
    score += (ROAD_CLASS_WEIGHT[roadType] - 0.45) * 45;
  }

  if (Number.isFinite(site.trafficLevel)) {
    inputs.push('live-flow');
    // Moving traffic is demand passing the door. A total standstill converts
    // worse than steady flow, so this peaks around moderate congestion.
    const level = site.trafficLevel;
    score += (level <= 0.6 ? level * 18 : (1.2 - level) * 18);
  }

  if (Number.isFinite(competition.competitorsWithin1km)) {
    inputs.push('competitor-density');
    score -= competition.competitorsWithin1km * 7;
    if (Number.isFinite(competition.competitorsWithin3km)) {
      score -= Math.max(0, competition.competitorsWithin3km - competition.competitorsWithin1km) * 2;
    }
  }

  if (inputs.length === 0) {
    return { siteId: site.id, demandPotential: null, inputs, confidence: 'insufficient-inputs' };
  }

  return {
    siteId: site.id,
    demandPotential: Math.max(0, Math.min(100, Math.round(score))),
    inputs,
    confidence: 'measured-inputs',
  };
}

/**
 * Dollar gap for one site.
 *
 * @param {object} site
 * @param {object} [actuals] The operator's own figures.
 * @param {number} [actuals.actualGallons] Annual gallons actually sold.
 * @param {number} [actuals.expectedGallons] Expected annual gallons. Supply
 *   the operator's own plan/budget figure, or a fitted model output — this
 *   module will not invent one.
 * @param {typeof DEFAULT_ECONOMICS} [actuals.economics]
 * @returns {{
 *   siteId: string,
 *   expectedGallons: number|null,
 *   actualGallons: number|null,
 *   gapGallons: number|null,
 *   gapUsd: number|null,
 *   confidence: 'measured'|'requires-actuals'
 * }|null}
 */
export function scoreSiteGap(site, actuals = {}) {
  if (!site?.id) return null;

  const actualGallons = Number(actuals.actualGallons);
  const expectedGallons = Number(actuals.expectedGallons);

  // Both sides must be real. One real number and one invented one produces a
  // gap that looks measured and is not.
  if (!Number.isFinite(actualGallons) || !Number.isFinite(expectedGallons)) {
    return {
      siteId: site.id,
      expectedGallons: Number.isFinite(expectedGallons) ? expectedGallons : null,
      actualGallons: Number.isFinite(actualGallons) ? actualGallons : null,
      gapGallons: null,
      gapUsd: null,
      confidence: 'requires-actuals',
    };
  }

  const gapGallons = expectedGallons - actualGallons;
  return {
    siteId: site.id,
    expectedGallons,
    actualGallons,
    gapGallons,
    gapUsd: Math.round(gapGallons * usdPerGallonGap(actuals.economics)),
    confidence: 'measured',
  };
}

/**
 * Rank sites for the operator's queue.
 *
 * Sites with real actuals rank first, by dollar gap. Everything else ranks
 * below them by demand potential — a defensible order that never implies a
 * dollar figure exists where it does not.
 *
 * @param {object[]} sites
 * @param {{
 *   actualsBySiteId?: Map<string, {actualGallons?: number, expectedGallons?: number}>,
 *   competitionBySiteId?: Map<string, object>,
 *   economics?: typeof DEFAULT_ECONOMICS
 * }} [opts]
 * @returns {Array<{site: object, score: object, demand: object|null}>}
 */
export function rankSitesByGap(sites, {
  actualsBySiteId = null,
  competitionBySiteId = null,
  economics = DEFAULT_ECONOMICS,
} = {}) {
  const rows = (sites || [])
    .filter((site) => Number.isFinite(site?.lat) && Number.isFinite(site?.lon))
    .map((site) => {
      const actuals = actualsBySiteId?.get(site.id) || {};
      const score = scoreSiteGap(site, { ...actuals, economics });
      const demand = scoreDemandPotential(site, competitionBySiteId?.get(site.id) || {});
      return { site, score, demand };
    })
    .filter((row) => row.score);

  const measured = rows.filter((r) => r.score.confidence === 'measured')
    .sort((a, b) => b.score.gapUsd - a.score.gapUsd);
  const unmeasured = rows.filter((r) => r.score.confidence !== 'measured')
    .sort((a, b) => (b.demand?.demandPotential ?? -1) - (a.demand?.demandPotential ?? -1));

  return [...measured, ...unmeasured];
}

/**
 * Sum of positive (under-performing) gaps across a ranked queue.
 *
 * Only rows with `confidence: 'measured'` contribute. A queue with no actuals
 * therefore totals 0 — and the caller is expected to check
 * `gapConfidence` before rendering that as a finding.
 * @param {Array<{score: object}>} ranked
 * @returns {number}
 */
export function totalRecoverableGapUsd(ranked) {
  return (ranked || []).reduce((sum, row) => (
    row.score?.confidence === 'measured' ? sum + Math.max(0, row.score.gapUsd || 0) : sum
  ), 0);
}
