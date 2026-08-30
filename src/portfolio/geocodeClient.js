/**
 * @file Thin client for CSV-import geocoding fallback. Built on
 * {@link module:portfolio/placesSearchClient}, which wraps the existing
 * `/api/google/text-search` proxy (vite.config.js) verbatim — no new server
 * route — same call shape already used by `src/data/militaryInstallations.js`
 * for its own Google Places lookups. The key never reaches the browser.
 * @module portfolio/geocodeClient
 */

import { placesTextSearch } from './placesSearchClient.js';

/**
 * Resolve a free-text address to coordinates via the existing Places
 * text-search proxy, biased toward the current camera center so an
 * ambiguous address (e.g. a store number with no city) resolves nearby.
 * @param {string} address
 * @param {{biasLat?: number, biasLon?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{lat:number, lon:number}|null>} `null` when the search
 *   returned no usable result. Throws on a network error or non-2xx response
 *   — the caller (`sitesCsv.js`) turns that into a skip reason.
 */
export async function geocodeAddress(address, opts = {}) {
  const places = await placesTextSearch(address, opts);
  const first = places[0];
  if (!first || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) return null;
  return { lat: first.latitude, lon: first.longitude };
}
