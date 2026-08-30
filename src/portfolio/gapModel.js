/**
 * @file Placeholder per-site "gap" scoring — modeled expected volume vs.
 * modeled actual volume, in dollars. This is NOT the real expected-performance
 * model from the Banner OS spec (that needs ingested AADT + census/LODES +
 * competitor density, none of which exists in this repo yet). It exists so
 * the pick → prime → operate interaction loop (search a business, activate
 * its network, see a ranked queue, fly to the biggest opportunity) is real
 * and testable today, ahead of the real model landing underneath it.
 *
 * Deterministic and seeded off the site id — same site always scores the
 * same, so the queue doesn't reshuffle on every render — and every score
 * carries `confidence: 'placeholder'` so nothing downstream (UI copy, voice
 * narration) can present it as a measured number.
 * @module portfolio/gapModel
 */

const BASE_EXPECTED_GALLONS = 150000;
const EXPECTED_SPREAD_GALLONS = 90000;
const PERFORMANCE_FLOOR = 0.62;
const PERFORMANCE_SPREAD = 0.62;
/** Rough CPG margin + inside-basket pull-through per gallon of gap, annualized — same arithmetic shape as the spec's economics section, not a real operator's numbers. */
const USD_PER_GALLON_GAP_PER_YEAR = 12 * (0.36 + 0.33 * 1.9 * 0.42);

/** Deterministic string hash (FNV-1a) — matches the idiom in siteModel.js. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic pseudo-random unit float in [0, 1) from a seed string + salt. */
function seededUnit(seed, salt) {
  return fnv1a(`${seed}|${salt}`) / 0xffffffff;
}

/**
 * Deterministic placeholder gap score for one site.
 * @param {{id: string}} site
 * @returns {{siteId: string, expectedGallons: number, actualGallons: number, gapGallons: number, gapUsd: number, confidence: 'placeholder'}|null}
 *   `gapUsd` is positive when the site is under its (synthetic) expected
 *   volume, negative when it's over — mirroring the spec's "exemplar" sites.
 */
export function scoreSiteGap(site) {
  if (!site?.id) return null;
  const expectedGallons = Math.round(
    BASE_EXPECTED_GALLONS + (seededUnit(site.id, 'expected') - 0.5) * 2 * EXPECTED_SPREAD_GALLONS,
  );
  const performanceRatio = PERFORMANCE_FLOOR + seededUnit(site.id, 'performance') * PERFORMANCE_SPREAD;
  const actualGallons = Math.round(expectedGallons * performanceRatio);
  const gapGallons = expectedGallons - actualGallons;
  const gapUsd = Math.round(gapGallons * USD_PER_GALLON_GAP_PER_YEAR);

  return {
    siteId: site.id,
    expectedGallons,
    actualGallons,
    gapGallons,
    gapUsd,
    confidence: 'placeholder',
  };
}

/**
 * Rank every geocoded site by dollar gap, largest opportunity first.
 * Ungeocoded sites (no resolved lat/lon) are excluded — there is nothing to
 * show on the map or fly the camera to.
 * @param {object[]} sites
 * @returns {Array<{site: object, score: ReturnType<typeof scoreSiteGap>}>}
 */
export function rankSitesByGap(sites) {
  return (sites || [])
    .filter((site) => Number.isFinite(site?.lat) && Number.isFinite(site?.lon))
    .map((site) => ({ site, score: scoreSiteGap(site) }))
    .filter((row) => row.score)
    .sort((a, b) => b.score.gapUsd - a.score.gapUsd);
}

/** Sum of positive (under-performing) gaps across a ranked queue — the "recoverable" total, not netted against exemplar sites running ahead of model. */
export function totalRecoverableGapUsd(ranked) {
  return (ranked || []).reduce((sum, row) => sum + Math.max(0, row.score?.gapUsd || 0), 0);
}
