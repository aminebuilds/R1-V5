/**
 * @file The one-way seam between the action runner and the explain board.
 *
 * `gevActions.js` must not import the board: the board imports the composers,
 * the composers import the play library, and the runner is what produces the
 * results in the first place — wiring it directly would close a cycle and
 * couple voice execution to whether a panel happens to be mounted.
 *
 * So the runner publishes `{action, result}` here and forgets about it. If a
 * board is listening it draws one; if none is mounted the call is a no-op.
 *
 * @module explain/bus
 */

/** @type {Set<(payload: {action: string, result: object, meta: object}) => void>} */
const listeners = new Set();

/**
 * Announce that an action produced a result worth explaining.
 * Never throws into the caller — a rendering failure must not fail the action
 * that succeeded.
 *
 * @param {string} action
 * @param {object} result
 * @param {{question?: string, scope?: string|null, origin?: string}} [meta]
 */
export function publishActionResult(action, result, meta = {}) {
  if (!action) return;
  for (const listener of listeners) {
    try {
      listener({ action, result, meta });
    } catch (error) {
      console.warn('[explain] listener threw', error);
    }
  }
}

/**
 * Listen for action results.
 * @param {(payload: {action: string, result: object, meta: object}) => void} fn
 * @returns {() => void} Unsubscribe.
 */
export function onActionResult(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test hook: drop every listener. */
export function resetActionBus() {
  listeners.clear();
}
