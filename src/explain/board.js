/**
 * @file The explain board — the surface a composed answer is drawn on.
 *
 * Owns the panel lifecycle, the typed ask box, the AG-UI stream for the
 * current run, and the camera hand-off when an operator clicks a row. It is
 * the only file here that touches the viewer or the live DOM; everything it
 * draws came from a pure composer.
 *
 * Two front doors reach it and neither is privileged: the voice runner
 * publishes every explainable action result on the bus, and the ask box routes
 * typed questions through the same runner. If the mic is off the product still
 * answers, which is the rule the whole vertical is built on.
 *
 * @module explain/board
 */

import * as Cesium from 'cesium';
import { createExplainStream } from './agui.js';
import { onActionResult } from './bus.js';
import { COMPOSED_ACTIONS, composeForAction, composePending } from './composers.js';
import { gap, head, withIds } from './blocks.js';
import { renderExplain } from './render.js';
import { routeQuestion, SUGGESTIONS } from './askRouter.js';

/** Actions that open a board. Camera moves and layer toggles do not. */
const EXPLAINABLE = new Set(COMPOSED_ACTIONS);

/** Altitude the camera settles at when a row is clicked. */
const FOCUS_HEIGHT_M = 2400;

let _viewer = null;
let _runAction = null;
let _stream = null;
let _dom = null;
let _unsubscribeBus = null;
let _unsubscribeStream = null;

function byId(id) {
  return document.getElementById(id);
}

function queryDom() {
  return {
    board: byId('explain-board'),
    runState: byId('explain-run-state'),
    scaleBtn: byId('explain-scale'),
    closeBtn: byId('explain-close'),
    reopenBtn: byId('explain-reopen'),
    form: byId('explain-ask'),
    input: byId('explain-ask-input'),
    steps: byId('explain-steps'),
    body: byId('explain-body'),
  };
}

/**
 * Describe what the camera is currently over, in the same terms the analyst
 * engine scopes by, so "in view" means one thing across the product.
 * @returns {string|null}
 */
export function currentScopeLabel(viewer = _viewer) {
  const carto = viewer?.camera?.positionCartographic;
  if (!carto) return null;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const radiusKm = Math.max(25, Math.min(2500, (carto.height / 1000) * 1.6));
  return `within ${Math.round(radiusKm)} km of ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

/** Open the board. */
export function openExplainBoard() {
  if (!_dom?.board) return;
  _dom.board.hidden = false;
  document.body.classList.add('explain-open');
  // Mirrored onto the body so the right rail's offset can react to the board's
  // width without a `:has()` dependency.
  document.body.dataset.explainScale = _dom.board.dataset.scale || 'rail';
  if (_dom.reopenBtn) _dom.reopenBtn.hidden = true;
}

/** Collapse the board to its edge tab. */
export function closeExplainBoard() {
  if (!_dom?.board) return;
  _dom.board.hidden = true;
  document.body.classList.remove('explain-open');
  // The tab is the permanent way in — the ask box lives inside the board, so
  // hiding both would leave a typed question with no front door at all.
  if (_dom.reopenBtn) _dom.reopenBtn.hidden = false;
}

/** Toggle between the reading rail and the full board. */
function toggleScale() {
  if (!_dom?.board) return;
  const next = _dom.board.dataset.scale === 'board' ? 'rail' : 'board';
  _dom.board.dataset.scale = next;
  document.body.dataset.explainScale = next;
  if (_dom.scaleBtn) {
    const expanding = next === 'rail';
    _dom.scaleBtn.setAttribute('aria-label', expanding ? 'Expand board' : 'Narrow board');
    _dom.scaleBtn.title = expanding ? 'Expand to full board' : 'Narrow to reading rail';
  }
}

/** Fly the camera to a row's subject. */
function focusOnTarget(focus) {
  if (!_viewer || !focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lon)) return;
  _viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(focus.lon, focus.lat, FOCUS_HEIGHT_M),
    duration: 1.6,
  });
}

/** Paint the step ticker: what is resolving, and what already did. */
function renderSteps(state) {
  if (!_dom?.steps) return;
  _dom.steps.replaceChildren();
  for (const step of state.steps || []) {
    const row = document.createElement('div');
    row.className = 'xp-step';
    row.dataset.state = step.status;
    const marker = document.createElement('span');
    marker.className = 'xp-step-marker';
    const label = document.createElement('span');
    label.className = 'xp-step-label';
    label.textContent = step.name;
    row.append(marker, label);
    _dom.steps.appendChild(row);
  }
  _dom.steps.hidden = (state.steps || []).length === 0 || state.status !== 'running';
}

/** Reflect run status in the header. */
function renderRunState(state) {
  if (!_dom?.runState) return;
  const label = state.status === 'running'
    ? 'Resolving'
    : state.status === 'error'
      ? 'Incomplete'
      : state.status === 'finished'
        ? 'Resolved'
        : 'Idle';
  _dom.runState.textContent = label;
  _dom.runState.dataset.state = state.status;
}

/** One subscription drives every part of the panel. */
function onStreamState(state) {
  if (!_dom?.body) return;
  renderExplain(_dom.body, state, { onFocus: focusOnTarget });
  renderSteps(state);
  renderRunState(state);
}

/**
 * Draw a board for an action result that has already been computed — the path
 * every voice tool call takes.
 *
 * @param {string} action
 * @param {object} result
 * @param {{question?: string, scope?: string|null}} [meta]
 */
export function explainResult(action, result, meta = {}) {
  if (!_stream) return;
  const scope = meta.scope || currentScopeLabel();
  const question = meta.question || null;
  _stream.startRun({ question: question || '', scope, action });
  const blocks = composeForAction(action, result, { question, scope });
  for (const block of blocks) _stream.block(block);
  _stream.finish();
  openExplainBoard();
}

/**
 * Answer a typed question: route it, run the action, compose the board.
 *
 * Progressive by construction — the header lands before the engine is called,
 * so the operator sees their question accepted rather than a frozen panel.
 *
 * @param {string} text
 * @returns {Promise<object|null>} The raw action result, or null if unrouted.
 */
export async function askExplainBoard(text) {
  if (!_stream) return null;
  const routed = routeQuestion(text);
  const scope = currentScopeLabel();
  const question = routed.question || String(text || '');

  _stream.startRun({ question, scope, action: routed.action });
  openExplainBoard();

  if (!routed.action) {
    for (const block of withIds([
      head({ question, scope, action: null, status: 'error' }),
      gap({
        title: 'Not a question this console can answer',
        reason: 'Nothing in that maps onto a capability, and guessing would produce a confident board about the wrong thing.',
        missing: SUGGESTIONS,
        remedy: 'Try one of the questions above, or ask by voice for anything involving the camera and layers.',
      }),
    ])) _stream.block(block);
    _stream.finish();
    return null;
  }

  for (const block of composePending({ question, scope, action: routed.action })) _stream.block(block);

  if (typeof _runAction !== 'function') {
    _stream.fail('No action runner is available in this session.');
    return null;
  }

  const done = _stream.step(routed.action.replace(/_/g, ' '));
  try {
    const result = await _runAction(routed.action, routed.args || {});
    done(false);
    for (const block of composeForAction(routed.action, result, { question, scope })) _stream.block(block);
    _stream.finish();
    return result;
  } catch (error) {
    done(true);
    _stream.fail(error?.message || 'The action failed');
    for (const block of withIds([
      gap({
        title: 'That did not complete',
        reason: String(error?.message || error || 'Unknown failure'),
        missing: [],
        remedy: 'The console reports the failure rather than an empty result — nothing was inferred from it.',
      }),
    ])) _stream.block(block);
    return null;
  }
}

/**
 * Mount the board.
 *
 * @param {{viewer: object, runAction?: Function}} deps
 * @returns {{ask: Function, explain: Function, open: Function, close: Function}|null}
 */
export function initExplainBoard({ viewer, runAction = null } = {}) {
  _dom = queryDom();
  if (!_dom.board) return null;

  _viewer = viewer || null;
  _runAction = runAction;
  _stream = createExplainStream();
  _unsubscribeStream = _stream.subscribe(onStreamState);

  const submitAsk = () => {
    const text = _dom.input?.value?.trim();
    if (!text) return;
    _dom.input.value = '';
    void askExplainBoard(text);
  };

  _dom.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAsk();
  });

  // Enter is handled explicitly rather than left to the form's implicit
  // submission, which does not fire in every environment the console runs in.
  _dom.input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitAsk();
  });

  _dom.scaleBtn?.addEventListener('click', toggleScale);
  _dom.closeBtn?.addEventListener('click', closeExplainBoard);
  _dom.reopenBtn?.addEventListener('click', openExplainBoard);
  _dom.board?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeExplainBoard();
      _dom.reopenBtn?.focus();
    }
  });

  // Voice and panel buttons both arrive here. Only the questions with a
  // composer open a board — a camera move is not an explanation.
  _unsubscribeBus = onActionResult(({ action, result, meta }) => {
    if (!EXPLAINABLE.has(action)) return;
    explainResult(action, result, meta);
  });

  return {
    ask: askExplainBoard,
    explain: explainResult,
    open: openExplainBoard,
    close: closeExplainBoard,
  };
}

/** Tear the board down. */
export function destroyExplainBoard() {
  _unsubscribeBus?.();
  _unsubscribeStream?.();
  _unsubscribeBus = null;
  _unsubscribeStream = null;
  _stream = null;
  _viewer = null;
  _runAction = null;
  if (_dom?.body) _dom.body.replaceChildren();
  _dom = null;
  document.body.classList.remove('explain-open');
}

/** Set or replace the action runner after mount (voice initialises later). */
export function setExplainActionRunner(runAction) {
  _runAction = typeof runAction === 'function' ? runAction : null;
}
