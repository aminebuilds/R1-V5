/**
 * @file US Eastern clock formatting for the airspace board. FAA command
 * centre times, airline statements and press timelines are all in ET, so the
 * board speaks ET and labels it — never the viewer's local zone unannounced.
 *
 * @module airspace/etTime
 */

const ZONE = 'America/New_York';
const clock = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const hourOnly = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' });
const date = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric' });

function toMs(value) {
  if (typeof value === 'number') return value;
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * "3:54 PM ET", or "Fri 3:54 PM ET" with `day`.
 * @param {number|string|null} value Epoch ms or ISO string.
 * @param {{day?: boolean}} [options]
 * @returns {string|null}
 */
export function fmtEt(value, { day = false } = {}) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return null;
  return `${(day ? dayClock : clock).format(ms)} ET`;
}

/** "Fri, Nov 13". */
export function fmtEtDate(value) {
  const ms = toMs(value);
  return Number.isFinite(ms) ? date.format(ms) : null;
}

/** Axis tick: "6 PM", or the weekday at Eastern midnight. */
export function fmtEtTick(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return '';
  const hour = hourOnly.format(ms);
  return /^12\s?AM$/i.test(hour) ? weekday.format(ms) : hour.replace(/\s/g, '');
}

/** Hour of day in Eastern time, 0–23. */
export function etHour(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' }).formatToParts(ms);
  return Number(parts.find((part) => part.type === 'hour')?.value);
}
