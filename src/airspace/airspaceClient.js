/**
 * @file Browser client for `/api/airspace/brief`. Dependency-free so the
 * action runner can import it without pulling in the board.
 *
 * @module airspace/airspaceClient
 */

export const AIRSPACE_ACTION = 'get_airspace_brief';

/**
 * Fetch the brief from the server.
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<object>} The brief tagged with its action, or `{ok: false, error}`.
 */
export async function fetchAirspaceBrief({ fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/airspace/brief', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      return { ok: false, action: AIRSPACE_ACTION, error: body?.error || `Airspace brief returned HTTP ${response.status}` };
    }
    return { action: AIRSPACE_ACTION, ...body };
  } catch (error) {
    return {
      ok: false,
      action: AIRSPACE_ACTION,
      error: error?.name === 'AbortError' ? 'Airspace brief timed out' : (error?.message || 'Airspace brief unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
