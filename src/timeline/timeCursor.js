/**
 * @file The map's shared time cursor — pure state, no DOM, no Cesium.
 *
 * One cursor for the whole globe. It is either LIVE (every layer shows what it
 * shows today) or parked at a moment inside a fixed trailing domain (default:
 * the last 7 days, hour steps). Layers that hold measured history re-draw for
 * the window ending at the cursor; layers that do not stay live and the strip
 * says so — the cursor never makes a live-only layer look historical.
 *
 * The window each layer draws is the same width it uses live (24 h for fires
 * and earthquakes), so parking the cursor at "now" reproduces the live map
 * exactly rather than a different picture of the same moment.
 *
 * @module timeline/timeCursor
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Default reach of the slider: the trailing seven days. */
export const DEFAULT_SPAN_MS = 7 * DAY_MS;
/** Default cursor step: one hour. */
export const DEFAULT_STEP_MS = HOUR_MS;
/** Width of the window a layer draws at the cursor — identical to live. */
export const LAYER_WINDOW_MS = DAY_MS;

/**
 * Snap a time down to a step boundary (UTC-aligned for hour/day steps).
 * @param {number} ms
 * @param {number} stepMs
 * @returns {number}
 */
export function snapToStep(ms, stepMs = DEFAULT_STEP_MS) {
  if (!Number.isFinite(ms)) return NaN;
  if (!Number.isFinite(stepMs) || stepMs <= 0) return ms;
  return Math.floor(ms / stepMs) * stepMs;
}

/**
 * Compute the slider domain for a given "now". The end is `now` itself (live);
 * the start is snapped to a step so every non-live position is a clean hour.
 * @param {number} nowMs
 * @param {{spanMs?: number, stepMs?: number}} [opts]
 * @returns {{startMs: number, endMs: number, stepMs: number}}
 */
export function computeDomain(nowMs, { spanMs = DEFAULT_SPAN_MS, stepMs = DEFAULT_STEP_MS } = {}) {
  const endMs = Number(nowMs);
  return {
    startMs: snapToStep(endMs - spanMs, stepMs),
    endMs,
    stepMs,
  };
}

/**
 * Parse a `?at=` value: an ISO-8601 instant, epoch milliseconds, or a
 * relative offset back from now (`-36h`, `-2d`, `-90m`). Returns null for
 * anything else — an unparseable link opens live rather than at a guessed time.
 * @param {string|null|undefined} text
 * @param {number} nowMs
 * @returns {number|null}
 */
export function parseTimeParam(text, nowMs) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const rel = /^-(\d+(?:\.\d+)?)\s*([mhd])$/i.exec(raw);
  if (rel) {
    const unit = rel[2].toLowerCase();
    const factor = unit === 'm' ? 60_000 : unit === 'h' ? HOUR_MS : DAY_MS;
    const value = Number(rel[1]) * factor;
    return Number.isFinite(value) ? nowMs - value : null;
  }
  if (/^\d{12,14}$/.test(raw)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  // Only accept something that looks like a date — Date.parse is lenient
  // enough to read "1" as a year.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * `24 NOV 14:00Z` — the cursor readout. UTC always: the feeds are UTC and a
 * local-time readout would silently disagree with every source's own stamp.
 * @param {number} ms
 * @returns {string}
 */
export function formatCursorUtc(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

/**
 * `−2D 04H` — how far the cursor sits behind now.
 * @param {number} cursorMs
 * @param {number} nowMs
 * @returns {string}
 */
export function formatOffset(cursorMs, nowMs) {
  if (!Number.isFinite(cursorMs) || !Number.isFinite(nowMs)) return '—';
  const behind = Math.max(0, nowMs - cursorMs);
  const days = Math.floor(behind / DAY_MS);
  const hours = Math.floor((behind % DAY_MS) / HOUR_MS);
  if (days === 0 && hours === 0) {
    const minutes = Math.floor(behind / 60_000);
    return minutes > 0 ? `−${minutes}M` : 'NOW';
  }
  return days > 0 ? `−${days}D ${pad2(hours)}H` : `−${hours}H`;
}

/**
 * Create the shared cursor. State changes are published synchronously to
 * subscribers; `now` is injectable so the domain can be tested.
 * @param {{now?: () => number, spanMs?: number, stepMs?: number}} [opts]
 */
export function createTimeCursor({ now = () => Date.now(), spanMs = DEFAULT_SPAN_MS, stepMs = DEFAULT_STEP_MS } = {}) {
  const listeners = new Set();
  let domain = computeDomain(now(), { spanMs, stepMs });
  let live = true;
  let cursorMs = domain.endMs;

  const snapshot = () => ({
    live,
    cursorMs: live ? domain.endMs : cursorMs,
    startMs: domain.startMs,
    endMs: domain.endMs,
    stepMs: domain.stepMs,
    windowMs: LAYER_WINDOW_MS,
  });

  const publish = () => {
    const state = snapshot();
    for (const fn of listeners) {
      try { fn(state); } catch (error) { console.warn('[Timeline] listener failed:', error); }
    }
    return state;
  };

  /** Re-anchor the domain end on the current clock (cursor position is kept). */
  function refreshDomain() {
    domain = computeDomain(now(), { spanMs, stepMs });
    if (!live && cursorMs < domain.startMs) cursorMs = domain.startMs;
  }

  return {
    getState: snapshot,

    /**
     * Park the cursor. Anything at or past the last full step resolves to
     * LIVE — there is no "historical now" distinct from live.
     * @param {number} ms
     */
    setCursor(ms) {
      refreshDomain();
      const value = Number(ms);
      if (!Number.isFinite(value)) return snapshot();
      const lastStep = snapToStep(domain.endMs, domain.stepMs);
      if (value >= lastStep + domain.stepMs || value >= domain.endMs) {
        if (live) return snapshot();
        live = true;
        cursorMs = domain.endMs;
        return publish();
      }
      const next = Math.max(domain.startMs, snapToStep(value, domain.stepMs));
      if (!live && next === cursorMs) return snapshot();
      live = false;
      cursorMs = next;
      return publish();
    },

    /** Move by whole steps; stepping forward past the last step goes live. */
    stepBy(count) {
      refreshDomain();
      const base = live ? snapToStep(domain.endMs, domain.stepMs) + domain.stepMs : cursorMs;
      return this.setCursor(base + Number(count || 0) * domain.stepMs);
    },

    goLive() {
      refreshDomain();
      if (live) return snapshot();
      live = true;
      cursorMs = domain.endMs;
      return publish();
    },

    /** Re-read the clock without moving a parked cursor (e.g. once a minute). */
    tick() {
      refreshDomain();
      return publish();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
