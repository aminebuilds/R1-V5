/**
 * @file Shared client for the existing `/api/google/text-search` proxy
 * (vite.config.js) — the raw places list, factored out so both single-address
 * geocoding ({@link module:portfolio/geocodeClient}) and multi-result
 * business-name search ({@link module:portfolio/businessSearch}) share one
 * fetch/parse path. No new server route.
 * @module portfolio/placesSearchClient
 */

const DEFAULT_RADIUS_M = 50000;

/**
 * @param {string} query - Free-text search (address, business name, etc.).
 * @param {{biasLat?: number, biasLon?: number, radiusM?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<{id:string, name:string, address:string, latitude:number, longitude:number}>>}
 *   Raw place results (may be empty). Throws on a network error or non-2xx response.
 */
export async function placesTextSearch(query, { biasLat, biasLon, radiusM = DEFAULT_RADIUS_M, signal } = {}) {
  const params = new URLSearchParams({
    q: query,
    lat: Number.isFinite(biasLat) ? biasLat.toFixed(5) : '0',
    lon: Number.isFinite(biasLon) ? biasLon.toFixed(5) : '0',
    radiusM: String(radiusM),
  });
  const response = await fetch(`/api/google/text-search?${params.toString()}`, { signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Google Places HTTP ${response.status}`);
  }
  return Array.isArray(payload?.places) ? payload.places : [];
}
