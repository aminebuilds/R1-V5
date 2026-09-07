/**
 * @file The supply-disruption index — the risk overlay (L3) on the fuel-price
 * forecast, and the one place where a world map and a store map become the
 * same map.
 *
 * What it claims: **risk has risen.** What it never claims: a price.
 *
 * Three inputs, all of which this repo can already reach, chosen because each
 * moves BEFORE a weekly retail price series prints:
 *
 *   1. Tanker transits through a chokepoint gate (AIS, live vessel layer).
 *      Physical flow changes days ahead of the price series.
 *   2. Geopolitical event volume and tone (GDELT, via /api/regional-brief).
 *      News moves in hours.
 *   3. Realised spot volatility (EIA daily). Confirms the other two are
 *      signal rather than noise.
 *
 * Each component is scored against its OWN trailing history, so the index
 * measures departure from normal rather than an absolute level someone picked.
 * A component with no data contributes nothing and is named in `missing` —
 * the index never silently averages over an absent input.
 *
 * @module portfolio/disruptionIndex
 */

/**
 * Chokepoint gates. A transit is counted when a vessel is inside the box.
 *
 * Boxes are deliberately generous: the measurement wanted is "how much tanker
 * traffic is moving through here", and a tight polygon would miss vessels
 * standing off or taking an unusual line.
 */
export const CHOKEPOINTS = Object.freeze({
  hormuz: Object.freeze({
    id: 'hormuz',
    name: 'Strait of Hormuz',
    south: 25.6, west: 55.6, north: 27.2, east: 57.4,
    note: 'Roughly a fifth of global petroleum liquids consumption transits here.',
  }),
  malacca: Object.freeze({
    id: 'malacca',
    name: 'Strait of Malacca',
    south: 1.0, west: 100.0, north: 6.0, east: 104.5,
    note: 'Principal Asia-bound crude route.',
  }),
  suez: Object.freeze({
    id: 'suez',
    name: 'Suez Canal & approaches',
    south: 27.5, west: 32.0, north: 31.6, east: 34.2,
    note: 'Europe-bound crude and products.',
  }),
  bab: Object.freeze({
    id: 'bab',
    name: 'Bab el-Mandeb',
    south: 11.5, west: 42.0, north: 14.0, east: 44.5,
    note: 'Red Sea approach; shares traffic with Suez.',
  }),
});

/** Vessel types that count as tanker traffic in an AIS record. */
const TANKER_PATTERN = /tanker|crude|lng|lpg|petrol|chemical/i;

/**
 * Is this vessel record a tanker inside the gate?
 * @param {object} vessel AIS record with `lat`, `lon`, `shipType`.
 * @param {object} gate One of `CHOKEPOINTS`.
 * @returns {boolean}
 */
export function isTankerInGate(vessel, gate) {
  if (!vessel || !gate) return false;
  const { lat, lon } = vessel;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < gate.south || lat > gate.north || lon < gate.west || lon > gate.east) return false;
  return TANKER_PATTERN.test(String(vessel.shipType || ''));
}

/**
 * Count tankers currently inside a gate.
 * @param {object[]} vessels
 * @param {object} gate
 * @returns {{count: number, vessels: object[]}}
 */
export function countTankersInGate(vessels, gate) {
  const inside = (vessels || []).filter((v) => isTankerInGate(v, gate));
  return { count: inside.length, vessels: inside };
}

/** Sample standard deviation, or null below two points. */
export function stdDev(values) {
  const finite = (values || []).filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, b) => a + (b - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

/** Median, or null when empty. */
export function median(values) {
  const finite = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

/**
 * Score one observation against its own trailing history, as a 0–100
 * departure-from-normal.
 *
 * 50 means "at the trailing median". Above 50 means the metric has moved in
 * the direction that raises risk. `direction: 'below'` inverts it — for
 * transit counts, a FALL is the risk signal.
 *
 * @param {number} current
 * @param {number[]} history
 * @param {{direction?: 'above'|'below'}} [opts]
 * @returns {number|null}
 */
export function departureScore(current, history, { direction = 'above' } = {}) {
  if (!Number.isFinite(current)) return null;
  const med = median(history);
  const sd = stdDev(history);
  if (med === null || sd === null || sd === 0) return null;

  const z = (current - med) / sd;
  const signed = direction === 'below' ? -z : z;
  // A two-sigma move maps to the top of the scale.
  return Math.max(0, Math.min(100, Math.round(50 + signed * 25)));
}

/**
 * Realised volatility of a price series over a trailing window, as the
 * standard deviation of daily log returns, annualised to a percentage.
 * @param {Array<{period: string, value: number}>} points
 * @param {number} [window]
 * @returns {number|null}
 */
export function realisedVolatility(points, window = 14) {
  const values = (points || []).map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < window + 1) return null;
  const recent = values.slice(-(window + 1));
  const returns = [];
  for (let i = 1; i < recent.length; i++) returns.push(Math.log(recent[i] / recent[i - 1]));
  const sd = stdDev(returns);
  if (sd === null) return null;
  return Math.round(sd * Math.sqrt(252) * 1000) / 10;
}

/**
 * Compose the disruption index from whatever inputs are actually available.
 *
 * @param {object} inputs
 * @param {{current: number|null, history: number[]}} [inputs.transits]
 *   Tanker transits through the gate: current 7-day count and its trailing
 *   history (e.g. 90 days of daily counts).
 * @param {{current: number|null, history: number[]}} [inputs.eventVolume]
 *   GDELT event volume on a fixed disruption query set.
 * @param {{current: number|null, history: number[]}} [inputs.eventTone]
 *   Mean GDELT tone. More negative is worse, so this scores on `below`.
 * @param {{current: number|null, history: number[]}} [inputs.volatility]
 *   Realised spot volatility and its trailing history.
 * @returns {{
 *   index: number|null,
 *   components: object,
 *   available: string[],
 *   missing: string[],
 *   level: 'normal'|'elevated'|'high'|'unavailable',
 *   confidence: string,
 *   readout: string
 * }}
 */
export function computeDisruptionIndex(inputs = {}) {
  const specs = [
    // A FALL in transits is the risk signal — traffic stops before prices move.
    { key: 'transits', weight: 0.40, direction: 'below', label: 'tanker transits' },
    { key: 'eventVolume', weight: 0.25, direction: 'above', label: 'event volume' },
    { key: 'eventTone', weight: 0.15, direction: 'below', label: 'event tone' },
    { key: 'volatility', weight: 0.20, direction: 'above', label: 'spot volatility' },
  ];

  const components = {};
  const available = [];
  const missing = [];
  let weighted = 0;
  let weightUsed = 0;

  for (const spec of specs) {
    const input = inputs[spec.key];
    const score = input
      ? departureScore(input.current, input.history, { direction: spec.direction })
      : null;
    components[spec.key] = {
      score,
      current: input?.current ?? null,
      median: median(input?.history) ?? null,
      label: spec.label,
      weight: spec.weight,
    };
    if (score === null) {
      missing.push(spec.key);
      continue;
    }
    available.push(spec.key);
    weighted += score * spec.weight;
    weightUsed += spec.weight;
  }

  // Nothing measurable: the index is null, not 50. A neutral-looking number
  // is indistinguishable from a measured all-clear.
  if (weightUsed === 0) {
    return {
      index: null,
      components,
      available,
      missing,
      level: 'unavailable',
      confidence: 'unavailable',
      readout: 'DISRUPTION — no component inputs available; index not computed.',
    };
  }

  const index = Math.round(weighted / weightUsed);
  const level = index >= 70 ? 'high' : index >= 55 ? 'elevated' : 'normal';

  const drivers = available
    .map((key) => ({ key, ...components[key] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((c) => `${c.label} ${c.score}/100`)
    .join(', ');

  return {
    index,
    components,
    available,
    missing,
    level,
    // Named so nothing downstream can present a partial index as a full one.
    confidence: missing.length === 0 ? 'all-components' : `partial-${available.length}-of-${specs.length}`,
    readout: `DISRUPTION — index ${index}/100 (${level}) from ${available.length} of ${specs.length} components${missing.length ? `; missing ${missing.join(', ')}` : ''}. Leading: ${drivers}.`,
  };
}

/**
 * Pearson correlation between two equal-length series, with a lead/lag shift.
 *
 * A positive `lagPeriods` tests whether `a` LEADS `b` by that many periods —
 * which is the entire question being asked of the Hormuz view.
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} [lagPeriods]
 * @returns {number|null}
 */
export function correlate(a, b, lagPeriods = 0) {
  const seriesA = [];
  const seriesB = [];
  for (let i = 0; i < a.length; i++) {
    const j = i + lagPeriods;
    if (j < 0 || j >= b.length) continue;
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[j])) continue;
    seriesA.push(a[i]);
    seriesB.push(b[j]);
  }
  if (seriesA.length < 3) return null;

  const meanA = seriesA.reduce((x, y) => x + y, 0) / seriesA.length;
  const meanB = seriesB.reduce((x, y) => x + y, 0) / seriesB.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < seriesA.length; i++) {
    const da = seriesA[i] - meanA;
    const db = seriesB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return null;
  return Math.round((num / Math.sqrt(denA * denB)) * 1000) / 1000;
}

/**
 * Find the lead/lag at which two series correlate most strongly.
 *
 * Reports the actual number whichever way it comes out. A weak correlation
 * honestly reported is a feature; a strong one asserted without evidence is
 * what gets the product thrown out.
 * @param {number[]} leading
 * @param {number[]} following
 * @param {{maxLag?: number}} [opts]
 * @returns {{bestLag: number|null, bestCorrelation: number|null, byLag: Array<{lag: number, r: number}>}}
 */
export function findLeadLag(leading, following, { maxLag = 8 } = {}) {
  const byLag = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const r = correlate(leading, following, lag);
    if (r !== null) byLag.push({ lag, r });
  }
  if (byLag.length === 0) return { bestLag: null, bestCorrelation: null, byLag: [] };
  const best = byLag.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
  return { bestLag: best.lag, bestCorrelation: best.r, byLag };
}
