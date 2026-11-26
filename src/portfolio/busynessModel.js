/**
 * @file Modelled "how busy is this store likely to be right now" estimate.
 *
 * Google Popular Times has no public API and no free substitute exists (see
 * docs/RETAIL-FUEL-INTELLIGENCE.md §04). "Store busy" is therefore never
 * measured here — only "road busy" (live TomTom congestion, from
 * `siteTraffic.fetchSiteTraffic`) is. This module combines that one measured
 * input with an hour-of-day demand curve and a site-format weight into a
 * single modelled estimate, and returns `unavailable` rather than a guess
 * when there is no congestion reading to build the estimate from.
 *
 * @module portfolio/busynessModel
 */

/**
 * Fraction of a day's peak retail traffic, by local hour (0–23). A generic
 * commuter/retail curve — morning and evening peaks around a midday trough —
 * the same kind of fixed convention `competitiveEngine.js` uses for its
 * dominance-score weighting, not a value fitted to any real site.
 * @type {readonly number[]}
 */
export const HOURLY_DEMAND_CURVE = Object.freeze([
  0.15, 0.08, 0.05, 0.04, 0.05, 0.12, // 00–05
  0.30, 0.55, 0.70, 0.60, 0.50, 0.55, // 06–11
  0.65, 0.60, 0.55, 0.58, 0.68, 0.85, // 12–17
  1.00, 0.90, 0.70, 0.50, 0.35, 0.22, // 18–23
]);

/**
 * How much a site format amplifies passing road traffic into store visits —
 * a highway travel plaza captures more of the road than a small urban
 * forecourt reading the same congestion level.
 * @type {Readonly<Record<string, number>>}
 */
export const FORMAT_WEIGHTS = Object.freeze({
  'travel plaza': 1.15,
  'truck stop': 1.1,
  hypermarket: 1.05,
  supermarket: 1.0,
  convenience: 0.95,
  forecourt: 0.9,
  kiosk: 0.75,
});

const DEFAULT_FORMAT_WEIGHT = 1.0;

/**
 * @param {string|null|undefined} format
 * @returns {number}
 */
export function formatWeight(format) {
  const key = String(format || '').toLowerCase().trim();
  return FORMAT_WEIGHTS[key] ?? DEFAULT_FORMAT_WEIGHT;
}

/**
 * Modelled busyness for one site at one hour.
 *
 * @param {{trafficLevel?: number|null}|null} flow Live congestion reading
 *   (0–1) from `fetchSiteTraffic`/`sitesLayer.getSiteFlow`, or `null`/absent
 *   when unmeasured.
 * @param {{hour?: number, format?: string|null}} [opts] `hour` is local,
 *   0–23, defaulting to the current wall-clock hour.
 * @returns {{
 *   score: number|null,
 *   confidence: 'modelled'|'unavailable',
 *   basis: string[],
 *   hour: number
 * }}
 */
export function estimateBusyness(flow, { hour, format = null } = {}) {
  const h = Number.isInteger(hour) ? ((hour % 24) + 24) % 24 : new Date().getHours();
  const level = Number.isFinite(flow?.trafficLevel) ? flow.trafficLevel : null;

  if (level === null) {
    return {
      score: null,
      confidence: 'unavailable',
      basis: ['No live road-congestion reading for this site — nothing to model busyness from.'],
      hour: h,
    };
  }

  const curve = HOURLY_DEMAND_CURVE[h];
  const weight = formatWeight(format);
  const raw = level * curve * weight;
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));

  return {
    score,
    confidence: 'modelled',
    basis: [
      `Live road congestion ${Math.round(level * 100)}/100 (TomTom)`,
      `Hour-of-day demand curve ${Math.round(curve * 100)}% for ${h}:00 local`,
      format
        ? `Site-format weight ${weight}× for "${format}"`
        : `Default site-format weight ${weight}× (no format on record)`,
    ],
    hour: h,
  };
}
