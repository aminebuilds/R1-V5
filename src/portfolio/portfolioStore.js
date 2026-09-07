/**
 * @file Client-side (Phase 0 has no server persistence — see the R.1
 * spec's hard constraints) storage for the imported `Site[]` portfolio. Its
 * own localStorage key, deliberately separate from
 * `LAYER_STATE_STORAGE_KEY` (`src/data/layerState.js`), which only ever
 * serializes per-layer enabled/options toggle state, never arbitrary data
 * payloads.
 * @module portfolio/portfolioStore
 */

export const PORTFOLIO_STORAGE_KEY = 'r1:banner-os:portfolio:v1';

/** Same defensive wrapper idiom as `safeStorage()` in `src/data/layerState.js`. */
function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

const listeners = new Set();

/**
 * Subscribe to portfolio changes (import, clear). Returns an unsubscribe fn.
 * @param {(sites: object[]) => void} listener
 * @returns {() => void}
 */
export function subscribePortfolio(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(sites) {
  for (const listener of listeners) {
    try {
      listener(sites);
    } catch {
      // A listener failure must not break the store or other listeners.
    }
  }
}

/**
 * @returns {object[]} The stored portfolio, or `[]` if missing/corrupt/unavailable.
 */
export function loadPortfolio() {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort persist. Returns whether the write succeeded.
 * @param {object[]} sites
 * @returns {boolean}
 */
export function savePortfolio(sites) {
  const storage = safeStorage();
  const normalized = Array.isArray(sites) ? sites : [];
  if (!storage) {
    notify(normalized);
    return false;
  }
  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalized));
    notify(normalized);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge new sites into an existing list, de-duplicated by `id` — a re-import
 * of the same store (same `externalRef`/slug) replaces the prior row rather
 * than duplicating it. Pure.
 * @param {object[]} existingSites
 * @param {object[]} newSites
 * @returns {object[]}
 */
export function addSites(existingSites, newSites) {
  const byId = new Map();
  for (const site of existingSites || []) {
    if (site?.id) byId.set(site.id, site);
  }
  for (const site of newSites || []) {
    if (site?.id) byId.set(site.id, site);
  }
  return [...byId.values()];
}

/** Remove the entire stored portfolio and notify subscribers of an empty list. */
export function clearPortfolio() {
  const storage = safeStorage();
  if (storage) {
    try {
      storage.removeItem(PORTFOLIO_STORAGE_KEY);
    } catch {
      // best-effort
    }
  }
  notify([]);
}
