/**
 * @file Front doors and live refresh for the US airspace brief.
 *
 * Three ways in, none privileged (CLAUDE.md: voice is never load-bearing):
 *  - the "US airspace" button on the explain board,
 *  - the URL — `?airspace` or `?brief=airspace` opens it on load,
 *  - the ask box / chat / voice, which run `get_airspace_brief` through the
 *    shared action runner.
 *
 * Whichever door opened it, the board then refreshes in place every minute
 * for as long as it stays open on this answer, and stops the moment the
 * operator closes it or asks something else. A background tab does not poll.
 * A failed refresh leaves the last good board up — its timestamps already say
 * how old it is — rather than blanking it.
 *
 * @module airspace/airspaceLive
 */

import { onActionResult } from '../explain/bus.js';
import { currentExplainAction, explainResult, refreshExplainResult } from '../explain/board.js';
import { AIRSPACE_QUESTION } from '../explain/airspaceComposer.js';
import { AIRSPACE_ACTION, fetchAirspaceBrief } from './airspaceClient.js';

export { fetchAirspaceBrief };
export const AIRSPACE_REFRESH_MS = 60_000;
const SCOPE = 'US national airspace';

let _timer = null;
let _inflight = null;
let _question = AIRSPACE_QUESTION;

async function refresh() {
  if (currentExplainAction() !== AIRSPACE_ACTION) {
    stopAirspaceLive();
    return;
  }
  if (globalThis.document?.hidden || _inflight) return;
  _inflight = fetchAirspaceBrief()
    .then((result) => {
      if (result?.ok === false) return;
      refreshExplainResult(AIRSPACE_ACTION, result, { question: _question, scope: SCOPE });
    })
    .finally(() => { _inflight = null; });
}

/** Keep the open airspace board current. Idempotent. */
export function startAirspaceLive(question = null) {
  if (question) _question = question;
  if (_timer) return;
  _timer = setInterval(() => { void refresh(); }, AIRSPACE_REFRESH_MS);
}

/** Stop refreshing. */
export function stopAirspaceLive() {
  clearInterval(_timer);
  _timer = null;
}

/**
 * Open the airspace board from a button or URL.
 * @param {{question?: string}} [options]
 * @returns {Promise<object>} The brief that was drawn.
 */
export async function openAirspaceBrief({ question = AIRSPACE_QUESTION } = {}) {
  const result = await fetchAirspaceBrief();
  explainResult(AIRSPACE_ACTION, result, { question, scope: SCOPE });
  startAirspaceLive(question);
  return result;
}

/**
 * Wire the front doors. Call once, after the explain board is mounted.
 * @param {{doc?: Document, location?: Location}} [deps]
 * @returns {{open: Function, stop: Function, destroy: Function}}
 */
export function initAirspaceBrief({ doc = globalThis.document, location = globalThis.location } = {}) {
  // The ask box, chat and voice all publish through the shared runner.
  const unsubscribe = onActionResult(({ action, meta }) => {
    if (action !== AIRSPACE_ACTION || meta?.origin === 'chat') return;
    startAirspaceLive(meta?.question || null);
  });

  const button = doc?.getElementById?.('explain-brief-airspace');
  const onClick = () => { void openAirspaceBrief(); };
  button?.addEventListener('click', onClick);

  try {
    const params = new URLSearchParams(location?.search || '');
    if (params.has('airspace') || params.get('brief') === 'airspace') void openAirspaceBrief();
  } catch { /* no URL to read */ }

  return {
    open: openAirspaceBrief,
    stop: stopAirspaceLive,
    destroy() {
      unsubscribe();
      stopAirspaceLive();
      button?.removeEventListener('click', onClick);
    },
  };
}
