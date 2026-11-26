/**
 * @file US airspace traffic, counted from OpenSky data.
 *
 * Two shapes come in:
 *  - `states/all` snapshots — every transponder OpenSky hears right now. These
 *    give the live "how many are airborne over the US" count.
 *  - `flights/all` records — OpenSky's derived flight table. It is a SAMPLE of
 *    global traffic (it only holds flights its pipeline resolved, roughly 1.5k
 *    per two hours worldwide when we measured it, and a flight appears only
 *    once it has landed), so it is used for the SHAPE of a day against the day
 *    before, never as a departure total.
 *
 * Operator class is read from the ICAO callsign prefix and the US military
 * ICAO24 block. That is a lookup convention, not a registry query — a callsign
 * outside the tables lands in an explicit "other" bucket rather than a guess.
 *
 * Pure: no network, no DOM.
 *
 * @module airspace/usTraffic
 */

const codes = (list) => new Set(list.trim().split(/\s+/));

/** US scheduled passenger carriers and their regional partners (ICAO 3-letter). */
const US_PASSENGER = codes('AAL DAL UAL SWA JBU ASA NKS FFT AAY SKW ENY RPA EDV JIA PDT ASH GJS QXE CPZ SCX MXY HAL SIL AWI UCA VXP KAP VTE');
/** All-cargo operators, US and foreign. */
const CARGO = codes('FDX UPS GTI ABX ATN CKS PAC AJT WGN NCR MTN AMF WIG KFS CLX GEC CAO CKK BCS DHK ABW SQC ICV TAY MPH CLU');
/** Charter operators that fly sports teams and military lift. */
const CHARTER = codes('SWQ OAE');
/** Fractional and charter business aviation. */
const BIZJET = codes('EJA LXJ EJM VJT XSR WUP');
/** Callsign stems used by US military and government flights. */
const MILITARY_CALLSIGN = /^(RCH|PAT|SAM|SPAR|CNV|VENUS|EXEC|NAVY|ARMY|CGAUX|COAST)/;

/** Operator classes, in display order. */
export const OPERATOR_CLASSES = Object.freeze([
  'us-airline',
  'cargo',
  'other-airline',
  'military',
  'bizjet',
  'charter',
  'ga',
  'unknown',
]);

/** Display labels for operator classes. */
export const OPERATOR_LABELS = Object.freeze({
  'us-airline': 'US airlines',
  cargo: 'Cargo',
  'other-airline': 'Other airline / operator',
  military: 'Military / government',
  bizjet: 'Fractional / charter jets',
  charter: 'Team & troop charter',
  ga: 'Private (N-number)',
  unknown: 'No / other callsign',
});

/**
 * Classify an aircraft by who operates it.
 * @param {string} icao24 Hex transponder address.
 * @param {string|null|undefined} callsign
 * @returns {string} One of OPERATOR_CLASSES.
 */
export function classifyOperator(icao24, callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  const hex = parseInt(String(icao24 || ''), 16);
  // AE0000–AFFFFF is the US military allocation.
  if ((hex >= 0xae0000 && hex <= 0xafffff) || MILITARY_CALLSIGN.test(cs)) return 'military';
  if (!cs) return 'unknown';
  if (/^N[0-9][0-9A-Z]{0,4}$/.test(cs)) return 'ga';
  if (!/^[A-Z]{3}[0-9]/.test(cs)) return 'unknown';
  const prefix = cs.slice(0, 3);
  if (CARGO.has(prefix)) return 'cargo';
  if (US_PASSENGER.has(prefix)) return 'us-airline';
  if (CHARTER.has(prefix)) return 'charter';
  if (BIZJET.has(prefix)) return 'bizjet';
  return 'other-airline';
}

/**
 * Lower-48 outline with a coastal buffer, traced along the Canadian and Mexican
 * borders. Coarse on purpose (about 40 vertices): it decides "over the US" for
 * a count, not a legal boundary.
 */
export const CONUS_OUTLINE = Object.freeze([
  [49.0, -123.3], [49.0, -95.2], [48.0, -89.5], [46.5, -84.5], [43.0, -82.4], [42.3, -81.0], [42.6, -79.0],
  [43.6, -77.5], [44.1, -76.4], [45.0, -74.7], [45.0, -71.5], [46.4, -70.0], [47.4, -69.2], [47.1, -67.8],
  [44.5, -66.9], [42.0, -66.0], [39.0, -70.0], [35.0, -74.0], [31.0, -79.0], [25.5, -79.0], [24.0, -80.5],
  [24.0, -83.5], [26.5, -88.0], [26.5, -94.0], [25.9, -97.0], [26.0, -97.2], [27.5, -99.5], [29.8, -101.4],
  [29.2, -103.3], [31.8, -106.5], [31.8, -108.2], [31.3, -108.2], [31.3, -111.1], [32.7, -114.7], [32.5, -117.1],
  [32.3, -118.5], [34.0, -121.0], [37.5, -123.5], [42.0, -125.0], [48.4, -125.0], [48.3, -123.2],
]);

function insidePolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Which US region a position falls in.
 * @param {number|null} lat
 * @param {number|null} lon
 * @returns {'CONUS'|'Alaska'|'Hawaii'|null}
 */
export function usRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (insidePolygon(lat, lon, CONUS_OUTLINE)) return 'CONUS';
  if (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154) return 'Hawaii';
  if (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) return 'Alaska';
  return null;
}

/** ICAO airport prefixes inside US jurisdiction. */
const US_AIRPORT = /^(K[A-Z0-9]{3}|PA|PH|PG|TJ|TIS)/;

/** Squawks that mean hijack, lost radio and emergency. */
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

function tally(items, key) {
  const out = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Summarise an OpenSky `states/all` body for US airspace.
 *
 * State vector indices: 0 icao24 · 1 callsign · 5 lon · 6 lat · 7 baro alt m ·
 * 8 on_ground · 11 vertical rate m/s · 14 squawk.
 *
 * @param {{time: number, states: Array<Array<any>>|null}} body
 * @returns {{t: number, airborne: number, onGround: number, byRegion: object, byClass: object, climbing: number, emergencies: Array<{callsign: string, squawk: string}>, world: number}|null}
 */
export function summarizeUsStates(body) {
  if (!body || !Array.isArray(body.states) || !Number.isFinite(body.time)) return null;
  const us = [];
  for (const state of body.states) {
    const region = usRegion(state[6], state[5]);
    if (region) us.push({ state, region });
  }
  const airborne = us.filter(({ state }) => !state[8]);
  const climbing = airborne.filter(({ state }) => Number.isFinite(state[7]) && state[7] < 3000 && state[11] > 4);
  return {
    t: body.time * 1000,
    world: body.states.length,
    airborne: airborne.length,
    onGround: us.length - airborne.length,
    byRegion: tally(airborne, ({ region }) => region),
    byClass: tally(airborne, ({ state }) => classifyOperator(state[0], state[1])),
    climbing: climbing.length,
    emergencies: us
      .filter(({ state }) => EMERGENCY_SQUAWKS.has(String(state[14] || '')))
      .map(({ state }) => ({ callsign: String(state[1] || state[0]).trim(), squawk: String(state[14]) })),
  };
}

/**
 * Is a flight-table record a takeoff we can trust to have happened at its
 * departure airport? OpenSky also records aircraft first heard mid-air; those
 * carry a large horizontal distance to the guessed airport.
 */
function confidentDeparture(record) {
  return Boolean(record?.estDepartureAirport)
    && Number(record.estDepartureAirportHorizDistance) <= 8000
    && Number(record.estDepartureAirportVertDistance) <= 1000;
}

/**
 * The confident US departures in a set of `flights/all` rows, reduced to the
 * two fields that identify a flight. Compact enough to cache per window.
 * @param {object[]} records
 * @returns {Array<[string, number]>} `[icao24, firstSeen]` pairs.
 */
export function usDepartureKeys(records) {
  const keys = [];
  for (const record of records || []) {
    if (!confidentDeparture(record) || !US_AIRPORT.test(record.estDepartureAirport)) continue;
    const firstSeen = Number(record.firstSeen);
    if (!Number.isFinite(firstSeen)) continue;
    keys.push([String(record.icao24), firstSeen]);
  }
  return keys;
}

/**
 * Bin departure keys across an event window and its baseline. The same
 * flight can come back from two adjacent table windows; it counts once.
 *
 * @param {Array<[string, number]>} keys
 * @param {{from: number, to: number, baselineOffsetMs?: number, binMs?: number}} window
 *   Event window in epoch ms; the baseline is the same clock span shifted back.
 * @returns {Array<{t: number, event: number, baseline: number}>}
 */
export function departureBinsFromKeys(keys, { from, to, baselineOffsetMs = 86_400_000, binMs = 1_800_000 }) {
  const seen = new Set();
  const counts = new Map();
  for (const [icao24, firstSeen] of keys || []) {
    const id = `${icao24}:${firstSeen}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const bin = Math.floor((firstSeen * 1000) / binMs) * binMs;
    counts.set(bin, (counts.get(bin) || 0) + 1);
  }
  const bins = [];
  for (let t = Math.floor(from / binMs) * binMs; t < to; t += binMs) {
    bins.push({ t, event: counts.get(t) || 0, baseline: counts.get(t - baselineOffsetMs) || 0 });
  }
  return bins;
}

/**
 * Count confident US departures per bin across an event day and its baseline.
 * @param {object[]} records `flights/all` rows from both days.
 * @param {{from: number, to: number, baselineOffsetMs?: number, binMs?: number}} window
 * @returns {Array<{t: number, event: number, baseline: number}>}
 */
export function departureBins(records, window) {
  return departureBinsFromKeys(usDepartureKeys(records), window);
}

/**
 * The two-hour `flights/all` windows needed to cover an event and its baseline.
 * OpenSky rejects intervals of two hours or more, so each ends a minute short.
 * @param {{from: number, to: number, baselineOffsetMs?: number}} window
 * @returns {Array<{begin: number, end: number}>} Epoch seconds.
 */
export function flightTableWindows({ from, to, baselineOffsetMs = 86_400_000 }) {
  const windows = [];
  const span = 2 * 3600_000;
  for (const offset of [0, baselineOffsetMs]) {
    for (let t = from - offset; t < to - offset; t += span) {
      windows.push({ begin: Math.floor(t / 1000), end: Math.floor((t + span) / 1000) - 60 });
    }
  }
  return windows;
}
