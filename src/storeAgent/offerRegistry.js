/**
 * @file Where offers created in this session live between being staged and
 * being pushed live.
 *
 * Creating an offer and deploying it are two decisions, often two sentences
 * apart in a conversation ("make me a 99-cent coffee offer" ... "alright, put
 * it on the canopy and the app"). The second one has to be able to find what
 * the first one made, including after a reload, so the registry is
 * localStorage-backed with the same defensive idiom as `portfolioStore.js`.
 *
 * Bounded at `MAX_OFFERS` -- this is a working set, not an offer history, and
 * an unbounded list in localStorage eventually throws on write.
 *
 * @module storeAgent/offerRegistry
 */

export const OFFER_STORAGE_KEY = 'r1:store-agent:offers:v1';

/** Keep the most recent N. Older entries fall off the end. */
export const MAX_OFFERS = 24;

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
 * Subscribe to registry changes.
 * @param {(offers: object[]) => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function subscribeOffers(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(offers) {
  for (const listener of listeners) {
    try {
      listener(offers);
    } catch {
      // A listener failure must not break the store or the other listeners.
    }
  }
}

/**
 * @returns {object[]} Stored offers, newest first, or `[]` if unavailable.
 */
export function loadOffers() {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Insert or replace one offer by `offerId`, newest first.
 * @param {object} offer
 * @returns {object[]} The resulting list.
 */
export function saveOffer(offer) {
  if (!offer?.offerId) return loadOffers();
  const existing = loadOffers().filter((row) => row.offerId !== offer.offerId);
  const next = [offer, ...existing].slice(0, MAX_OFFERS);
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(OFFER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota or a private-mode refusal. The offer still exists for this
      // turn; it just will not survive a reload.
    }
  }
  notify(next);
  return next;
}

/**
 * Find an offer by id, or -- when no id is given -- the most recently created
 * one, which is what "push it live" means in conversation.
 *
 * @param {string|null} [offerId]
 * @returns {object|null}
 */
export function findOffer(offerId = null) {
  const offers = loadOffers();
  if (!offerId) return offers[0] || null;
  const wanted = String(offerId).toUpperCase();
  return offers.find((offer) => String(offer.offerId).toUpperCase() === wanted) || null;
}

/** Drop everything. Test hook and an operator-facing reset. */
export function clearOffers() {
  const storage = safeStorage();
  try {
    storage?.removeItem(OFFER_STORAGE_KEY);
  } catch {
    // Nothing to do -- the caller gets the empty list either way.
  }
  notify([]);
  return [];
}
