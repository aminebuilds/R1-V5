/**
 * @file Client for the two live inputs `computeDisruptionIndex` cannot build
 * from data already in the browser: a GDELT event-volume/tone timeline for a
 * chokepoint, and this app's own accumulated history of tanker-count
 * snapshots (see `vite.config.js`'s `gdelt-timeline-proxy` and
 * `disruption-history-proxy`).
 *
 * Every function reports its own unavailability rather than defaulting to an
 * empty series that would read downstream as "nothing is happening" — see
 * `disruptionIndex.js`'s `missing` handling.
 *
 * @module portfolio/disruptionClient
 */

/**
 * Fetch the GDELT event-volume and event-tone timelines for a chokepoint.
 * @param {string} gate One of `hormuz`, `malacca`, `suez`, `bab`.
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{status:string, volume:{current:number|null,history:number[]}, tone:{current:number|null,history:number[]}}>}
 */
export async function fetchGdeltTimeline(gate, { signal } = {}) {
  const params = new URLSearchParams({ gate: String(gate || '').toLowerCase() });
  let res;
  try {
    res = await fetch(`/api/gdelt/timeline?${params}`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { status: 'error', message: error?.message || 'network error', volume: { current: null, history: [] }, tone: { current: null, history: [] } };
  }
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}`, volume: { current: null, history: [] }, tone: { current: null, history: [] } };
  const json = await res.json().catch(() => null);
  return json || { status: 'error', volume: { current: null, history: [] }, tone: { current: null, history: [] } };
}

/**
 * Fetch this app's own accumulated tanker-count snapshot history for a gate.
 * @param {string} gate
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<{ts:number, tankerCount:number, vesselsInGate:number, unclassified:number|null}>>}
 */
export async function fetchDisruptionHistory(gate, { signal } = {}) {
  const params = new URLSearchParams({ gate: String(gate || '').toLowerCase() });
  try {
    const res = await fetch(`/api/disruption-history?${params}`, { signal });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    return Array.isArray(json?.points) ? json.points : [];
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

/**
 * Record one real tanker-count observation for a gate. Best-effort — a
 * failed write should never block the price outlook the caller is building.
 * @param {string} gate
 * @param {{tankerCount:number, vesselsInGate:number, unclassified?:number|null}} snapshot
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<object>>} The gate's history after the write (or its current history on failure).
 */
export async function postDisruptionSnapshot(gate, snapshot, { signal } = {}) {
  try {
    const res = await fetch('/api/disruption-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gate: String(gate || '').toLowerCase(), ...snapshot }),
      signal,
    });
    if (!res.ok) return fetchDisruptionHistory(gate, { signal });
    const json = await res.json().catch(() => null);
    return Array.isArray(json?.points) ? json.points : [];
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}
