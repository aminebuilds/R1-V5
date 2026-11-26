/**
 * @file Client for the session-priced Google Places Autocomplete + Place
 * Details proxy (`/api/google/autocomplete`, `/api/google/place-details` in
 * vite.config.js).
 *
 * Google bills Autocomplete + the one Place Details call that completes it
 * as a single bundled "session" price when both share a sessionToken — no
 * matter how many keystrokes fired an Autocomplete request along the way.
 * Paying per keystroke with a full Text Search call (a much pricier SKU) is
 * the failure mode this exists to avoid. Call {@link createSessionToken}
 * once when a search interaction starts, reuse it for every
 * {@link fetchAutocomplete} call and the closing {@link fetchPlaceDetails}
 * call, then start a fresh token for the next search.
 * @module portfolio/autocompleteClient
 */

/** @returns {string} A fresh per-search-session token. */
export function createSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string} input - Free-text the user has typed so far (2+ chars).
 * @param {string} sessionToken
 * @param {{biasLat?: number, biasLon?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<{placeId:string, text:string, mainText:string, secondaryText:string|null, types:string[]}>>}
 */
export async function fetchAutocomplete(input, sessionToken, { biasLat, biasLon, signal } = {}) {
  const trimmed = String(input || '').trim();
  if (trimmed.length < 2 || !sessionToken) return [];
  const params = new URLSearchParams({
    input: trimmed,
    sessionToken,
    lat: Number.isFinite(biasLat) ? biasLat.toFixed(5) : '0',
    lon: Number.isFinite(biasLon) ? biasLon.toFixed(5) : '0',
  });
  try {
    const response = await fetch(`/api/google/autocomplete?${params.toString()}`, { signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return [];
    return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

/**
 * Resolves one suggestion's exact place — the call that closes the billed
 * session started by {@link fetchAutocomplete}.
 * @param {string} placeId
 * @param {string} sessionToken
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{id:string, name:string|null, address:string|null, latitude:number, longitude:number}|null>}
 */
export async function fetchPlaceDetails(placeId, sessionToken, { signal } = {}) {
  if (!placeId || !sessionToken) return null;
  const params = new URLSearchParams({ placeId, sessionToken });
  try {
    const response = await fetch(`/api/google/place-details?${params.toString()}`, { signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    return payload?.place || null;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}
