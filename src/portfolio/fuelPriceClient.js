/**
 * @file Client for the fuel-price spine: EIA series through `/api/eia`,
 * official station-level feeds through `/api/fuel-prices`, and the operator's
 * own price book when they have one.
 *
 * Every function here reports its own unavailability as a named state. Nothing
 * falls back to a synthetic series — a fabricated price curve would be worse
 * here than anywhere else in the product, because the whole point of the price
 * spine is that it is checkable against a number on a roadside sign.
 *
 * @module portfolio/fuelPriceClient
 */

import { haversineMeters } from './siteTraffic.js';
import { alignSeries, backtest, fitPassThrough, forecastPassThrough } from './fuelPriceModel.js';

/**
 * PADD regions by US state, for picking the right regional anchor.
 * Source: EIA's own PADD definitions.
 */
const STATE_TO_PADD = Object.freeze({
  CT: 1, DE: 1, DC: 1, FL: 1, GA: 1, ME: 1, MD: 1, MA: 1, NH: 1, NJ: 1, NY: 1,
  NC: 1, PA: 1, RI: 1, SC: 1, VT: 1, VA: 1, WV: 1,
  IL: 2, IN: 2, IA: 2, KS: 2, KY: 2, MI: 2, MN: 2, MO: 2, NE: 2, ND: 2, OH: 2,
  OK: 2, SD: 2, TN: 2, WI: 2,
  AL: 3, AR: 3, LA: 3, MS: 3, NM: 3, TX: 3,
  CO: 4, ID: 4, MT: 4, UT: 4, WY: 4,
  AK: 5, AZ: 5, CA: 5, HI: 5, NV: 5, OR: 5, WA: 5,
});

/**
 * Rough PADD lookup by longitude/latitude, for when no state code is known.
 * Coarse on purpose — it picks an anchor series, and the anchor is a regional
 * average, so a borderline site landing in a neighbouring PADD shifts the
 * reference by cents, not dollars.
 * @param {number} lat
 * @param {number} lon
 * @returns {number|null}
 */
export function paddForCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Outside the contiguous US + AK/HI, there is no PADD and no US anchor.
  if (lon < -180 || lon > -60 || lat < 15 || lat > 72) return null;
  if (lon >= -125 && lon <= -114 && lat >= 32) return 5;
  if (lon < -125) return 5;
  if (lon >= -114 && lon < -104) return 4;
  if (lon >= -104 && lon < -88 && lat < 37) return 3;
  if (lon >= -88 && lon < -80 && lat < 33) return 3;
  if (lon >= -104 && lon < -80) return 2;
  return 1;
}

/**
 * @param {string} stateCode Two-letter US state.
 * @returns {number|null}
 */
export function paddForState(stateCode) {
  return STATE_TO_PADD[String(stateCode || '').toUpperCase().trim()] ?? null;
}

/**
 * Fetch one allowlisted EIA series.
 * @param {string} id Series key, e.g. `retail-padd3`.
 * @param {{start?: string, signal?: AbortSignal}} [opts]
 * @returns {Promise<{status: string, points?: Array<{period: string, value: number}>, [k: string]: any}>}
 */
export async function fetchEiaSeries(id, { start, signal } = {}) {
  const params = new URLSearchParams({ id });
  if (start) params.set('start', start);
  let res;
  try {
    res = await fetch(`/api/eia/series?${params}`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { status: 'error', message: error?.message || 'network error', points: [] };
  }
  if (res.status === 503) return { status: 'no-key', points: [] };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}`, points: [] };
  const json = await res.json().catch(() => null);
  if (!json) return { status: 'error', message: 'unparseable response', points: [] };
  return json;
}

/**
 * Build the complete price picture for a region: anchor level, fitted
 * pass-through model, its backtest report card, and a forward band.
 *
 * @param {{padd?: number|null, disruptionIndex?: number|null, signal?: AbortSignal}} [opts]
 * @returns {Promise<object>}
 */
export async function buildRegionalPriceModel({ padd = null, disruptionIndex = null, signal } = {}) {
  const retailId = padd ? `retail-padd${padd}` : 'retail-us';
  const [retail, spot] = await Promise.all([
    fetchEiaSeries(retailId, { signal }),
    fetchEiaSeries('spot-brent', { signal }),
  ]);

  if (retail.status === 'no-key' || spot.status === 'no-key') {
    return {
      status: 'no-key',
      confidence: 'unavailable',
      readout: 'PRICE — EIA_API_KEY is not configured. Regional anchor and forecast unavailable. Get a free key at eia.gov/opendata.',
    };
  }
  if (retail.status !== 'ready' || spot.status !== 'ready') {
    return {
      status: retail.status === 'ready' ? spot.status : retail.status,
      confidence: 'unavailable',
      readout: `PRICE — EIA series unavailable (${retail.status}/${spot.status}).`,
    };
  }

  const aligned = alignSeries(retail.points, spot.points);
  const fit = fitPassThrough(aligned);
  const validation = backtest(aligned);
  const forecast = forecastPassThrough(fit, aligned, { disruptionIndex });

  const latest = retail.points[retail.points.length - 1];

  return {
    status: 'ready',
    region: retail.label,
    seriesId: retail.seriesId,
    anchor: {
      // The anchor is not a model output. It is EIA's own published number.
      value: latest.value,
      period: latest.period,
      unit: retail.unit,
      confidence: 'published',
    },
    spot: {
      label: spot.label,
      value: spot.points[spot.points.length - 1].value,
      period: spot.points[spot.points.length - 1].period,
      unit: spot.unit,
      confidence: 'published',
    },
    model: fit,
    validation,
    forecast,
    observations: aligned.length,
    attribution: retail.attribution,
    confidence: fit.ok ? 'modelled-and-backtested' : 'unavailable',
  };
}

/**
 * Fetch official station-level prices for a country, optionally clipped to a
 * viewport.
 * @param {string} country Two-letter code, e.g. `es`.
 * @param {{bounds?: {south:number,west:number,north:number,east:number}, signal?: AbortSignal}} [opts]
 * @returns {Promise<object>}
 */
export async function fetchStationPrices(country, { bounds, signal } = {}) {
  const params = new URLSearchParams({ country });
  if (bounds) {
    params.set('south', String(bounds.south));
    params.set('west', String(bounds.west));
    params.set('north', String(bounds.north));
    params.set('east', String(bounds.east));
  }
  let res;
  try {
    res = await fetch(`/api/fuel-prices?${params}`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { status: 'error', stations: [], count: 0, message: error?.message || 'network error' };
  }
  if (res.status === 400) {
    return {
      status: 'unsupported-country',
      stations: [],
      count: 0,
      // The honest sentence, so the UI never has to invent one.
      message: 'No free official station-level price feed exists for that country. Upload an operator price book instead.',
    };
  }
  if (!res.ok) return { status: 'error', stations: [], count: 0, message: `HTTP ${res.status}` };
  const json = await res.json().catch(() => null);
  return json || { status: 'error', stations: [], count: 0 };
}

/**
 * Which countries have a wired official feed.
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<object>}
 */
export async function fetchPriceCoverage({ signal } = {}) {
  try {
    const res = await fetch('/api/fuel-prices', { signal });
    if (!res.ok) return { countries: [], note: null };
    return (await res.json()) || { countries: [], note: null };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { countries: [], note: null };
  }
}

/**
 * Position each portfolio site against its local competitors on price.
 *
 * Pure — takes stations rather than fetching them, so it is testable and so
 * the caller controls how much of a country's feed is in memory.
 *
 * @param {object[]} sites Portfolio sites with `lat`/`lon`.
 * @param {object[]} stations Priced stations from `fetchStationPrices`.
 * @param {{radiusM?: number, grade?: string, anchorValue?: number|null}} [opts]
 * @returns {Map<string, object>} Keyed by site id.
 */
export function positionSitesOnPrice(sites, stations, {
  radiusM = 1609,
  grade = 'gasoline95',
  anchorValue = null,
} = {}) {
  const out = new Map();
  const priced = (stations || []).filter((s) => Number.isFinite(s?.prices?.[grade]));

  for (const site of sites || []) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;

    // The site's own price, when it is itself in the official feed.
    let own = null;
    let ownDistance = Infinity;
    const neighbours = [];

    for (const station of priced) {
      const distM = haversineMeters(site.lat, site.lon, station.lat, station.lon);
      if (distM <= 60 && distM < ownDistance) {
        own = station;
        ownDistance = distM;
        continue;
      }
      if (distM <= radiusM) neighbours.push({ ...station, distM });
    }

    if (!own) {
      // No price for this site. Reported as such — never imputed from the
      // neighbours, which would make a competitive comparison compare a site
      // to a number derived from the very things it is being compared with.
      out.set(site.id, {
        siteId: site.id,
        hasLivePrice: false,
        priceCents: null,
        priceVsAnchorCents: null,
        competitorsPriced: neighbours.length,
        rankFromCheapest: null,
        centsAboveLocalMin: null,
        confidence: 'no-price-for-site',
      });
      continue;
    }

    const ownPrice = own.prices[grade];
    const neighbourPrices = neighbours.map((n) => n.prices[grade]).filter(Number.isFinite);
    const localMin = neighbourPrices.length ? Math.min(...neighbourPrices) : null;
    const cheaperThanOwn = neighbourPrices.filter((p) => p < ownPrice).length;

    out.set(site.id, {
      siteId: site.id,
      hasLivePrice: true,
      priceCents: Math.round(ownPrice * 100),
      priceVsAnchorCents: Number.isFinite(anchorValue)
        ? Math.round((ownPrice - anchorValue) * 100)
        : null,
      competitorsPriced: neighbourPrices.length,
      // 1 means cheapest in the ring.
      rankFromCheapest: neighbourPrices.length ? cheaperThanOwn + 1 : null,
      centsAboveLocalMin: localMin === null ? null : Math.round((ownPrice - localMin) * 100),
      localMinCents: localMin === null ? null : Math.round(localMin * 100),
      confidence: 'official-feed',
    });
  }

  return out;
}
