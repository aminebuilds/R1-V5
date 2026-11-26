/**
 * @file GDELT DOC 2.0 timeline parsing with the dates kept — pure.
 *
 * `vite.config.js`'s disruption route keeps only the values (the index scores a
 * current value against its own history). The time slider needs each value at
 * its moment, so this parser keeps `{t, value}` pairs.
 *
 * What the number is: GDELT's `timelinevol` "volume intensity" — the share of
 * all articles GDELT monitored in that interval that match the chokepoint
 * query, in percent. It is a measured share of news coverage. It is not a
 * count of incidents and the strip labels it that way.
 *
 * @module timeline/gdeltSeries
 */

/**
 * `20261117T000000Z` (GDELT's timeline stamp) → epoch ms, or NaN.
 * @param {string} text
 * @returns {number}
 */
export function parseGdeltDate(text) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(String(text ?? '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/**
 * Parse a `timelinevol`/`timelinetone` payload into dated points, ascending.
 * Points with an unreadable date or value are dropped, never zero-filled.
 * @param {object} payload
 * @returns {Array<{t: number, value: number}>}
 */
export function parseGdeltSeries(payload) {
  const series = Array.isArray(payload?.timeline) ? payload.timeline[0] : null;
  const data = Array.isArray(series?.data) ? series.data : [];
  const points = [];
  for (const point of data) {
    const t = parseGdeltDate(point?.date);
    const value = Number(point?.value);
    if (Number.isFinite(t) && Number.isFinite(value)) points.push({ t, value });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * The value in force at `ms`: the last point at or before it, provided it is
 * no older than `maxAgeMs` (a gap in the series is a gap, not a carry-forward).
 * @param {Array<{t: number, value: number}>} points Ascending.
 * @param {number} ms
 * @param {number} [maxAgeMs]
 * @returns {{t: number, value: number}|null}
 */
export function pointAt(points, ms, maxAgeMs = 3 * 3_600_000) {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(ms)) return null;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].t <= ms) lo = mid + 1;
    else hi = mid;
  }
  const hit = points[lo - 1];
  if (!hit || ms - hit.t > maxAgeMs) return null;
  return hit;
}
