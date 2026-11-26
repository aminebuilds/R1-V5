/**
 * @file The time slider's history sources — one per layer that has a measured
 * past. Each source loads lazily, reports its own coverage, and cuts the
 * window a layer draws at the cursor. A source that cannot answer for a moment
 * says so (`coverage: 'none'`) rather than returning an empty set that would
 * read as "nothing happened".
 *
 * - Fires: NASA FIRMS detections from the server's nine-day store
 *   (`/api/firms/history`), shipped binary (src/timeline/firmsHistory.js).
 * - Earthquakes: USGS ComCat's FDSN event query, M2.5+ (the live layer's own
 *   floor), eight days. Public, keyless, CORS-enabled — the same source the
 *   live layer reads, by its query endpoint instead of the 24 h summary feed.
 * - Chokepoint news: GDELT DOC 2.0 volume intensity per gate
 *   (`/api/gdelt/series`) — a measured share of news coverage, not an
 *   incident count.
 *
 * @module timeline/historySources
 */

import {
  binDetections,
  decodeFirmsHistory,
  inBox,
  materializeFires,
  rollingSum,
  windowRange,
} from './firmsHistory.js';
import { pointAt } from './gdeltSeries.js';
import { CHOKEPOINTS } from '../portfolio/disruptionIndex.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const USGS_QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
/** The live earthquake layer's own floor (earthquakes.js skips < 2.5). */
export const QUAKE_MIN_MAGNITUDE = 2.5;

/**
 * Whether the days a window touches were all fetched.
 * @param {Array<{startMs: number, ok: boolean}>} days Per-UTC-day status.
 * @param {number} endMs
 * @param {number} spanMs
 * @returns {'full'|'partial'|'none'}
 */
export function windowCoverage(days, endMs, spanMs) {
  if (!Array.isArray(days) || !days.length) return 'none';
  const startMs = endMs - spanMs;
  let touched = 0;
  let ok = 0;
  for (const day of days) {
    const dayEnd = day.startMs + DAY_MS;
    if (dayEnd <= startMs || day.startMs > endMs) continue;
    touched += 1;
    if (day.ok) ok += 1;
  }
  // A window reaching before the first stored day is short by that much.
  const firstStart = days[0].startMs;
  if (startMs < firstStart) touched += 1;
  if (touched === 0 || ok === 0) return 'none';
  return ok === touched ? 'full' : 'partial';
}

/**
 * USGS features whose event time falls in `[endMs − spanMs, endMs]`.
 * @param {Array<object>} features Sorted ascending by `properties.time`.
 * @param {number} endMs
 * @param {number} spanMs
 * @returns {Array<object>}
 */
export function featuresInWindow(features, endMs, spanMs) {
  if (!Array.isArray(features)) return [];
  const startMs = endMs - spanMs;
  return features.filter((f) => {
    const t = Number(f?.properties?.time);
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
}

/**
 * Rolling 24 h event counts per hour bin for quakes (optionally in a box) —
 * the same shape the fires lane draws.
 * @param {Array<object>} features
 * @param {{startMs: number, endMs: number, binMs?: number, windowMs?: number, box?: object|null}} opts
 * @returns {Array<number|null>}
 */
export function rollingQuakeCounts(features, { startMs, endMs, binMs = HOUR_MS, windowMs = DAY_MS, box = null }) {
  const lead = Math.ceil(windowMs / binMs);
  const binStart = startMs - lead * binMs;
  const bins = new Array(Math.max(0, Math.ceil((endMs - binStart) / binMs))).fill(0);
  for (const f of Array.isArray(features) ? features : []) {
    const t = Number(f?.properties?.time);
    if (!Number.isFinite(t) || t < binStart || t >= endMs) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    if (box && !inBox(lat, lon, box)) continue;
    bins[Math.floor((t - binStart) / binMs)] += 1;
  }
  return rollingSum(bins, lead).slice(lead);
}

/** NASA FIRMS history, from the server's store. */
export function createFirmsHistorySource({ fetchImpl = (...a) => fetch(...a) } = {}) {
  let meta = null;
  let decoded = null;
  let decodedVersion = null;
  let dataPromise = null;
  let dataError = null;

  return {
    id: 'local-firms',
    label: 'FIRES',
    attribution: 'NASA FIRMS',

    async loadMeta() {
      try {
        const res = await fetchImpl('/api/firms/history', { cache: 'no-store' });
        meta = res.ok ? await res.json() : { status: 'unavailable', error: `HTTP ${res.status}` };
      } catch (error) {
        meta = { status: 'unavailable', error: error?.message || 'network error' };
      }
      return meta;
    },

    /** Download (or re-download, if the store moved on) the detections. */
    loadData() {
      if (!meta || meta.status === 'no-key' || meta.status === 'unavailable') return Promise.resolve(null);
      if (decoded && decodedVersion === meta.version) return Promise.resolve(decoded);
      if (dataPromise) return dataPromise;
      dataPromise = (async () => {
        try {
          const res = await fetchImpl('/api/firms/history/data', { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const next = decodeFirmsHistory(await res.arrayBuffer());
          decoded = next;
          decodedVersion = Number(res.headers?.get?.('X-FIRMS-History-Version') ?? next.meta?.version);
          dataError = null;
          return decoded;
        } catch (error) {
          dataError = error?.message || 'history download failed';
          return null;
        } finally {
          dataPromise = null;
        }
      })();
      return dataPromise;
    },

    get meta() { return meta; },
    /** Store version of the detections actually downloaded. */
    get dataVersion() { return decodedVersion; },
    get loaded() { return Boolean(decoded); },
    get loading() { return Boolean(dataPromise); },
    get error() { return dataError; },
    get stale() { return Boolean(decoded && meta && decodedVersion !== meta.version); },

    coverage(endMs, spanMs) {
      return windowCoverage(meta?.days, endMs, spanMs);
    },

    /**
     * Exactly how many detections the map draws for this window (in the box
     * when given) — the readout, as opposed to the hourly-binned trend lane.
     * @returns {number|null}
     */
    countInWindow(endMs, spanMs, box = null) {
      if (!decoded) return null;
      const [lo, hi] = windowRange(decoded.acqMinute, endMs, spanMs);
      if (!box) return hi - lo;
      let n = 0;
      for (let k = lo; k < hi; k += 1) if (inBox(decoded.lat[k], decoded.lon[k], box)) n += 1;
      return n;
    },

    /** firmsAdapt-shaped records for `[endMs − spanMs, endMs]`, or null if not loaded. */
    windowFires(endMs, spanMs) {
      if (!decoded) return null;
      const [lo, hi] = windowRange(decoded.acqMinute, endMs, spanMs);
      return materializeFires(decoded, lo, hi);
    },

    /**
     * Rolling 24 h detection counts per hour for the lane — in the box when
     * the detections are loaded, else the server's global hourly counts.
     * @returns {{values: Array<number|null>, scope: 'view'|'global'}|null}
     */
    rollingCounts({ startMs, endMs, box = null, windowMs = DAY_MS }) {
      const lead = Math.ceil(windowMs / HOUR_MS);
      const from = startMs - lead * HOUR_MS;
      if (decoded) {
        const bins = binDetections(decoded, { startMs: from, endMs, binMs: HOUR_MS, box });
        return { values: rollingSum(bins, lead).slice(lead), scope: box ? 'view' : 'global' };
      }
      const hourly = meta?.hourly;
      if (!hourly || !Array.isArray(hourly.counts)) return null;
      const bins = [];
      for (let t = from; t < endMs; t += HOUR_MS) {
        const i = Math.floor((t - hourly.startMs) / hourly.binMs);
        bins.push(i >= 0 && i < hourly.counts.length ? hourly.counts[i] : 0);
      }
      return { values: rollingSum(bins, lead).slice(lead), scope: 'global' };
    },
  };
}

/** USGS earthquakes, M2.5+, eight days. */
export function createQuakeHistorySource({ fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  let features = null;
  let coveredFrom = null;
  let coveredTo = null;
  let fetchedAt = null;
  let promise = null;
  let error = null;

  return {
    id: 'earthquakes',
    label: 'QUAKES',
    attribution: 'USGS',

    load({ force = false } = {}) {
      if (promise) return promise;
      if (features && !force && now() - fetchedAt < 10 * 60_000) return Promise.resolve(features);
      promise = (async () => {
        const startMs = now() - 8 * DAY_MS;
        const params = new URLSearchParams({
          format: 'geojson',
          starttime: new Date(startMs).toISOString(),
          minmagnitude: String(QUAKE_MIN_MAGNITUDE),
          orderby: 'time-asc',
        });
        try {
          const res = await fetchImpl(`${USGS_QUERY_URL}?${params}`);
          if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
          const geojson = await res.json();
          if (!Array.isArray(geojson?.features)) throw new Error('Malformed USGS response');
          features = geojson.features
            .filter((f) => Number.isFinite(Number(f?.properties?.time)))
            .sort((a, b) => a.properties.time - b.properties.time);
          coveredFrom = startMs;
          coveredTo = now();
          fetchedAt = now();
          error = null;
        } catch (err) {
          error = err?.message || 'USGS unavailable';
        } finally {
          promise = null;
        }
        return features;
      })();
      return promise;
    },

    get loaded() { return Boolean(features); },
    get loading() { return Boolean(promise); },
    get error() { return error; },
    get features() { return features || []; },

    coverage(endMs, spanMs) {
      if (!features) return 'none';
      if (endMs - spanMs >= coveredFrom && endMs <= coveredTo + HOUR_MS) return 'full';
      return endMs > coveredFrom ? 'partial' : 'none';
    },

    windowFeatures(endMs, spanMs) {
      return features ? featuresInWindow(features, endMs, spanMs) : null;
    },

    /** Exact event count for the window (in the box when given). */
    countInWindow(endMs, spanMs, box = null) {
      if (!features) return null;
      return featuresInWindow(features, endMs, spanMs).filter((f) => {
        const [lon, lat] = f.geometry?.coordinates || [];
        return inBox(lat, lon, box);
      }).length;
    },

    rollingCounts({ startMs, endMs, box = null }) {
      if (!features) return null;
      return { values: rollingQuakeCounts(features, { startMs, endMs, box }), scope: box ? 'view' : 'global' };
    },
  };
}

/** GDELT chokepoint news-coverage series, one per gate. */
export function createGdeltHistorySource({ fetchImpl = (...a) => fetch(...a) } = {}) {
  const gates = Object.values(CHOKEPOINTS).map((gate) => ({
    id: gate.id,
    name: gate.name,
    lat: (gate.south + gate.north) / 2,
    lon: (gate.west + gate.east) / 2,
    status: 'idle',
    points: [],
  }));
  let started = false;

  return {
    id: 'gdelt-chokepoints',
    label: 'CHOKEPOINT NEWS',
    attribution: 'GDELT',
    gates,

    /** Fetch every gate in turn (the server spaces GDELT calls 5.5 s apart). */
    async load(onUpdate = () => {}) {
      if (started) return;
      started = true;
      for (const gate of gates) {
        gate.status = 'loading';
        onUpdate(gate);
        try {
          const res = await fetchImpl(`/api/gdelt/series?gate=${encodeURIComponent(gate.id)}`);
          const json = await res.json().catch(() => null);
          if (!res.ok || !json || json.status === 'unavailable') throw new Error(json?.error || `HTTP ${res.status}`);
          gate.points = Array.isArray(json.points) ? json.points : [];
          gate.status = json.status === 'stale' ? 'stale' : (gate.points.length ? 'ready' : 'empty');
        } catch {
          gate.points = [];
          gate.status = 'unavailable';
        }
        onUpdate(gate);
      }
    },

    /** Re-allow a load after failures (e.g. the strip was reopened). */
    reset() {
      if (gates.every((g) => g.status === 'ready' || g.status === 'stale')) return;
      started = false;
    },

    valueAt(gate, ms) {
      return pointAt(gate.points, ms);
    },
  };
}
