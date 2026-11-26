/**
 * @file Client-side, local-only persistence for the typed chat panel: the
 * message transcript and a small list of facts recalled across sessions.
 * Same defensive `safeStorage()` idiom as `src/portfolio/portfolioStore.js`
 * and `src/data/layerState.js` — two separate keys, never one blob, so a
 * corrupt/oversized history can never take the remembered facts down with it.
 * @module chat/chatMemory
 */

export const CHAT_HISTORY_STORAGE_KEY = 'r1:chat:history:v1';
export const CHAT_FACTS_STORAGE_KEY = 'r1:chat:memory:v1';

/** How many transcript messages to keep. Oldest trimmed first on overflow. */
export const MAX_HISTORY_MESSAGES = 200;

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @returns {object[]} The stored transcript, or `[]` if missing/corrupt/unavailable.
 */
export function loadHistory() {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort persist, trimmed to `MAX_HISTORY_MESSAGES`.
 * @param {object[]} messages
 * @returns {boolean} Whether the write succeeded.
 */
export function saveHistory(messages) {
  const storage = safeStorage();
  const normalized = Array.isArray(messages) ? messages : [];
  const trimmed = normalized.length > MAX_HISTORY_MESSAGES
    ? normalized.slice(normalized.length - MAX_HISTORY_MESSAGES)
    : normalized;
  if (!storage) return false;
  try {
    storage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

/** Best-effort clear of the transcript only — remembered facts are untouched. */
export function clearHistory() {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string[]} Remembered facts, or `[]` if missing/corrupt/unavailable.
 */
export function loadFacts() {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(CHAT_FACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((fact) => typeof fact === 'string' && fact.trim()) : [];
  } catch {
    return [];
  }
}

function saveFacts(facts) {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(CHAT_FACTS_STORAGE_KEY, JSON.stringify(facts));
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a fact, de-duplicated case-insensitively against what is already stored.
 * @param {string} fact
 * @returns {string[]} The updated fact list.
 */
export function addFact(fact) {
  const trimmed = String(fact || '').trim();
  const facts = loadFacts();
  if (!trimmed) return facts;
  const exists = facts.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());
  const updated = exists ? facts : [...facts, trimmed];
  saveFacts(updated);
  return updated;
}

/**
 * Remove a fact by exact index, or by closest case-insensitive substring match
 * against its text — whichever the caller has on hand (a slash command may
 * only have the visible text; a tool call may echo it back verbatim).
 * @param {string|number} factOrIndex
 * @returns {string[]} The updated fact list.
 */
export function removeFact(factOrIndex) {
  const facts = loadFacts();
  let index = -1;
  if (typeof factOrIndex === 'number' && Number.isInteger(factOrIndex)) {
    index = factOrIndex;
  } else {
    const needle = String(factOrIndex || '').trim().toLowerCase();
    if (needle) {
      index = facts.findIndex((existing) => existing.toLowerCase() === needle);
      if (index === -1) index = facts.findIndex((existing) => existing.toLowerCase().includes(needle));
    }
  }
  if (index < 0 || index >= facts.length) return facts;
  const updated = facts.slice(0, index).concat(facts.slice(index + 1));
  saveFacts(updated);
  return updated;
}

/** Alias kept for readability at call sites that list rather than mutate. */
export const listFacts = loadFacts;
