/**
 * @file NASA FIRMS detection history — shared by the server store
 * (`vite.config.js` → `firmsProxy`) and the browser time slider. Pure: no DOM,
 * no Cesium, no network; IO is injected so the store is node-testable.
 *
 * Why a store at all: the live proxy serves the trailing 24 h, and FIRMS will
 * return at most five days per request (`DAY_RANGE` 1..5, counted FORWARD
 * from an optional `DATE`). A seven-day slider whose every position shows
 * "the 24 h ending here" needs eight days behind it, so the server keeps
 * nine UTC days, one file per day, and re-fetches a day only until it is
 * final (NRT latency is ~3 h; a day fetched 6 h after it ended is complete).
 *
 * Everything here is measured: detections are FIRMS rows, unaltered except for
 * float32 coordinates. A day no source could fetch is reported as a gap — it is
 * never filled, interpolated, or shown as "no fires".
 *
 * @module timeline/firmsHistory
 */

import { acquisitionMsUtc } from '../data/firmsCsv.js';
import { normalizeConfidence } from '../data/firmsAdapt.js';

export const FIRMS_HISTORY_DAYS = 9;
export const FIRMS_MAX_DAY_RANGE = 5;
/** A day fetched this long after it ended is treated as complete. */
export const FIRMS_FINAL_LAG_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const MAGIC = 0x31485246; // 'FRH1' little-endian

/** @param {number} ms @returns {string} `YYYY-MM-DD` (UTC). */
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {string} day `YYYY-MM-DD` @returns {number} epoch ms at 00:00Z. */
export function dayStartMs(day) {
  return Date.parse(`${day}T00:00:00Z`);
}

/** @param {string} day @param {number} n @returns {string} */
export function addDays(day, n) {
  return utcDay(dayStartMs(day) + n * DAY_MS);
}

/**
 * The UTC days the store keeps, oldest first, ending today.
 * @param {number} nowMs
 * @param {number} [count]
 * @returns {string[]}
 */
export function historyDays(nowMs, count = FIRMS_HISTORY_DAYS) {
  const today = utcDay(nowMs);
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) days.push(addDays(today, -i));
  return days;
}

/**
 * Group the days that need fetching into FIRMS requests: contiguous runs, each
 * at most {@link FIRMS_MAX_DAY_RANGE} days, as `{start, range}` (forward).
 * @param {string[]} days Ordered oldest first.
 * @param {(day: string) => boolean} needsFetch
 * @returns {Array<{start: string, range: number, days: string[]}>}
 */
export function planChunks(days, needsFetch) {
  const chunks = [];
  let run = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += FIRMS_MAX_DAY_RANGE) {
      const part = run.slice(i, i + FIRMS_MAX_DAY_RANGE);
      chunks.push({ start: part[0], range: part.length, days: part });
    }
    run = [];
  };
  for (const day of days) {
    if (needsFetch(day)) {
      const prev = run[run.length - 1];
      if (prev && addDays(prev, 1) !== day) flush();
      run.push(day);
    } else {
      flush();
    }
  }
  flush();
  return chunks;
}

/**
 * Parser record (`firmsCsv.parseFirmsCsv` shape) → compact stored row
 * `[lat, lon, acqMinute, frp, brightness, confidence0to100, night]`.
 * Rows with an unparseable acquisition time are dropped (null).
 * @param {object} record
 * @returns {Array<number>|null}
 */
export function compactRow(record) {
  const acqMs = acquisitionMsUtc(record?.acqDate, record?.acqTime);
  const lat = Number(record?.lat);
  const lon = Number(record?.lon);
  if (!Number.isFinite(acqMs) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const frp = Number(record?.frp);
  const bright = Number(record?.brightness);
  return [
    lat,
    lon,
    Math.round(acqMs / MIN_MS),
    Number.isFinite(frp) ? frp : 0,
    Number.isFinite(bright) ? bright : 0,
    Math.round(normalizeConfidence(record?.confidence) * 100),
    record?.daynight === 'N' ? 1 : 0,
  ];
}

/**
 * Pack rows into the binary transfer format. Rows are sorted by acquisition
 * time so a time window is one contiguous index range on the client.
 *
 * Layout (little-endian): u32 magic · u32 count · u32 metaLen · meta JSON
 * (padded to 4) · f32 lat[n] · f32 lon[n] · u32 acqMinute[n] · f32 frp[n] ·
 * u16 brightness×10[n] (padded to 4) · u8 confidence[n] · u8 flags[n]
 * (bit0 night, bits1-7 satellite index into meta.satellites).
 *
 * @param {Array<{row: Array<number>, satellite: string}>} entries
 * @param {object} [meta] Extra JSON carried in the header.
 * @returns {Uint8Array}
 */
export function encodeFirmsHistory(entries, meta = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const order = list.map((_, i) => i).sort((a, b) => list[a].row[2] - list[b].row[2]);
  const satellites = [];
  const satIndex = new Map();
  for (const entry of list) {
    const sat = String(entry.satellite || '');
    if (!satIndex.has(sat) && satellites.length < 127) {
      satIndex.set(sat, satellites.length);
      satellites.push(sat);
    }
  }
  const metaBytes = new TextEncoder().encode(JSON.stringify({ ...meta, satellites }));
  const n = list.length;
  const pad4 = (x) => (x + 3) & ~3;
  const headerLen = 12 + pad4(metaBytes.length);
  const total = headerLen + 16 * n + pad4(2 * n) + 2 * n;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, n, true);
  view.setUint32(8, metaBytes.length, true);
  new Uint8Array(buffer, 12, metaBytes.length).set(metaBytes);
  let offset = headerLen;
  const lat = new Float32Array(buffer, offset, n); offset += 4 * n;
  const lon = new Float32Array(buffer, offset, n); offset += 4 * n;
  const acq = new Uint32Array(buffer, offset, n); offset += 4 * n;
  const frp = new Float32Array(buffer, offset, n); offset += 4 * n;
  const bright = new Uint16Array(buffer, offset, n); offset += pad4(2 * n);
  const conf = new Uint8Array(buffer, offset, n); offset += n;
  const flags = new Uint8Array(buffer, offset, n);
  for (let k = 0; k < n; k += 1) {
    const { row, satellite } = list[order[k]];
    lat[k] = row[0];
    lon[k] = row[1];
    acq[k] = row[2];
    frp[k] = row[3];
    bright[k] = Math.max(0, Math.min(65535, Math.round(row[4] * 10)));
    conf[k] = Math.max(0, Math.min(255, row[5]));
    flags[k] = (row[6] ? 1 : 0) | ((satIndex.get(String(satellite || '')) ?? 0) << 1);
  }
  return new Uint8Array(buffer);
}

/**
 * Unpack {@link encodeFirmsHistory} output. Throws on a foreign payload.
 * @param {ArrayBuffer} buffer
 * @returns {{count: number, meta: object, satellites: string[], lat: Float32Array,
 *   lon: Float32Array, acqMinute: Uint32Array, frp: Float32Array,
 *   brightness10: Uint16Array, confidence: Uint8Array, flags: Uint8Array}}
 */
export function decodeFirmsHistory(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('not a FIRMS history payload');
  }
  const n = view.getUint32(4, true);
  const metaLen = view.getUint32(8, true);
  const pad4 = (x) => (x + 3) & ~3;
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen)));
  let offset = 12 + pad4(metaLen);
  const lat = new Float32Array(buffer, offset, n); offset += 4 * n;
  const lon = new Float32Array(buffer, offset, n); offset += 4 * n;
  const acqMinute = new Uint32Array(buffer, offset, n); offset += 4 * n;
  const frp = new Float32Array(buffer, offset, n); offset += 4 * n;
  const brightness10 = new Uint16Array(buffer, offset, n); offset += pad4(2 * n);
  const confidence = new Uint8Array(buffer, offset, n); offset += n;
  const flags = new Uint8Array(buffer, offset, n);
  return {
    count: n,
    meta,
    satellites: Array.isArray(meta?.satellites) ? meta.satellites : [],
    lat, lon, acqMinute, frp, brightness10, confidence, flags,
  };
}

/**
 * First index whose value is >= target in an ascending typed array.
 * @param {ArrayLike<number>} sorted
 * @param {number} target
 */
export function lowerBound(sorted, target) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Index range `[lo, hi)` of detections acquired in `[endMs − spanMs, endMs]`,
 * inclusive at both ends like the live proxy's trailing-24 h filter.
 * @param {Uint32Array} acqMinute Sorted ascending.
 * @param {number} endMs
 * @param {number} spanMs
 * @returns {[number, number]}
 */
export function windowRange(acqMinute, endMs, spanMs) {
  const lo = lowerBound(acqMinute, Math.ceil((endMs - spanMs) / MIN_MS));
  const hi = lowerBound(acqMinute, Math.floor(endMs / MIN_MS) + 1);
  return [lo, Math.max(lo, hi)];
}

/**
 * Build the fire records the FIRMS layer renders (`firmsAdapt` shape) for one
 * index range of a decoded payload.
 * @param {ReturnType<typeof decodeFirmsHistory>} decoded
 * @param {number} lo
 * @param {number} hi
 * @returns {Array<object>}
 */
export function materializeFires(decoded, lo, hi) {
  const fires = new Array(Math.max(0, hi - lo));
  for (let k = lo, i = 0; k < hi; k += 1, i += 1) {
    const flags = decoded.flags[k];
    fires[i] = {
      index: i,
      lat: decoded.lat[k],
      lon: decoded.lon[k],
      frp: decoded.frp[k],
      confidence: decoded.confidence[k] / 100,
      brightness: decoded.brightness10[k] / 10,
      night: (flags & 1) === 1,
      acqMs: decoded.acqMinute[k] * MIN_MS,
      sensor: 'VIIRS',
      satellite: decoded.satellites[flags >> 1] || '',
      contextEntity: null,
      position: null,
    };
  }
  return fires;
}

/**
 * Whether a point falls inside a lon/lat box (degrees). A box whose west edge
 * is east of its east edge crosses the antimeridian.
 * @param {number} lat
 * @param {number} lon
 * @param {{west:number, south:number, east:number, north:number}|null} box
 */
export function inBox(lat, lon, box) {
  if (!box) return true;
  if (lat < box.south || lat > box.north) return false;
  return box.west <= box.east
    ? lon >= box.west && lon <= box.east
    : lon >= box.west || lon <= box.east;
}

/**
 * Detections per bin over `[startMs, endMs)`, optionally inside a box.
 * @param {{lat: ArrayLike<number>, lon: ArrayLike<number>, acqMinute: ArrayLike<number>, count: number}} decoded
 * @param {{startMs: number, endMs: number, binMs: number, box?: object|null}} opts
 * @returns {number[]}
 */
export function binDetections(decoded, { startMs, endMs, binMs, box = null }) {
  const bins = new Array(Math.max(0, Math.ceil((endMs - startMs) / binMs))).fill(0);
  if (!bins.length) return bins;
  const lo = lowerBound(decoded.acqMinute, Math.ceil(startMs / MIN_MS));
  for (let k = lo; k < decoded.count; k += 1) {
    const t = decoded.acqMinute[k] * MIN_MS;
    if (t >= endMs) break;
    if (box && !inBox(decoded.lat[k], decoded.lon[k], box)) continue;
    bins[Math.floor((t - startMs) / binMs)] += 1;
  }
  return bins;
}

/**
 * Rolling sum over a trailing window of whole bins: entry i is the total for
 * the `windowBins` bins ending with bin i — i.e. what the map shows when the
 * cursor sits at the end of bin i. Entries whose window reaches before the
 * first bin are null, not partial sums: a short window would read as a dip.
 * @param {number[]} bins
 * @param {number} windowBins
 * @returns {Array<number|null>}
 */
export function rollingSum(bins, windowBins) {
  const out = new Array(bins.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bins.length; i += 1) {
    sum += bins[i];
    if (i >= windowBins) sum -= bins[i - windowBins];
    if (i >= windowBins - 1) out[i] = sum;
  }
  return out;
}

/**
 * The server-side history store. IO is injected:
 * - `fetchChunk(source, startDay, range)` → parser records (throws on failure)
 * - `loadDay(day)` → stored day object or null
 * - `saveDay(day, obj)` → persist (best-effort)
 * @param {{sources: string[], fetchChunk: Function, loadDay?: Function, saveDay?: Function,
 *   now?: () => number, ttlMs?: number, log?: Function}} opts
 */
export function createFirmsHistoryStore({
  sources,
  fetchChunk,
  loadDay = async () => null,
  saveDay = async () => {},
  now = () => Date.now(),
  ttlMs = 30 * 60_000,
  log = () => {},
}) {
  /** day → {sources: {src: {ok, count, fetchedAt, final, satellite}}, rows: {src: rows[]}} */
  const days = new Map();
  const loaded = new Set();
  let version = 0;
  let inflight = null;
  let lastError = null;
  let encoded = null;

  let loading = null;
  /** Single-flight: a second caller waits for the same disk read. */
  function ensureLoaded() {
    if (!loading) loading = loadWanted().finally(() => { loading = null; });
    return loading;
  }

  async function loadWanted() {
    const wanted = historyDays(now());
    for (const day of wanted) {
      if (loaded.has(day)) continue;
      loaded.add(day);
      try {
        const stored = await loadDay(day);
        if (stored && typeof stored === 'object' && stored.sources && stored.rows) {
          days.set(day, { sources: stored.sources, rows: stored.rows });
          version += 1;
        }
      } catch { /* unreadable day file — refetch it */ }
    }
    const keep = new Set(wanted);
    for (const day of [...days.keys()]) {
      if (!keep.has(day)) { days.delete(day); version += 1; }
    }
    for (const day of [...loaded]) if (!keep.has(day)) loaded.delete(day);
  }

  function needsFetch(day, source) {
    const state = days.get(day)?.sources?.[source];
    if (!state) return true;
    if (state.ok && state.final) return false;
    return now() - Number(state.fetchedAt || 0) >= ttlMs;
  }

  /**
   * Replace `source`'s rows for every covered day from one upstream answer.
   * @param {string} source
   * @param {Array<object>} records Parser records.
   * @param {number} fetchedAt
   * @param {string[]} coveredDays
   * @returns {string[]} Days changed.
   */
  function ingest(source, records, fetchedAt, coveredDays) {
    const byDay = new Map(coveredDays.map((day) => [day, []]));
    let satellite = '';
    for (const record of Array.isArray(records) ? records : []) {
      const bucket = byDay.get(record?.acqDate);
      if (!bucket) continue;
      const row = compactRow(record);
      if (!row) continue;
      if (!satellite && record.satellite) satellite = String(record.satellite);
      bucket.push(row);
    }
    for (const [day, rows] of byDay) {
      const entry = days.get(day) || { sources: {}, rows: {} };
      entry.rows[source] = rows;
      entry.sources[source] = {
        ok: true,
        count: rows.length,
        fetchedAt,
        final: fetchedAt >= dayStartMs(day) + DAY_MS + FIRMS_FINAL_LAG_MS,
        satellite: satellite || entry.sources[source]?.satellite || source,
      };
      days.set(day, entry);
    }
    version += 1;
    return coveredDays;
  }

  function markFailed(source, fetchedAt, coveredDays) {
    for (const day of coveredDays) {
      const entry = days.get(day) || { sources: {}, rows: {} };
      const prev = entry.sources[source];
      // Keep previously stored rows: an older complete answer beats none.
      entry.sources[source] = {
        ok: Boolean(prev?.ok),
        count: prev?.count ?? 0,
        fetchedAt,
        final: Boolean(prev?.final),
        failedAt: fetchedAt,
        satellite: prev?.satellite || source,
      };
      if (!entry.rows[source]) entry.rows[source] = [];
      days.set(day, entry);
    }
    version += 1;
  }

  async function persist(changed) {
    for (const day of changed) {
      const entry = days.get(day);
      if (!entry) continue;
      try { await saveDay(day, { day, ...entry }); } catch (error) { log('save failed', day, error); }
    }
  }

  async function runRefresh() {
    await ensureLoaded();
    const wanted = historyDays(now());
    const changed = new Set();
    for (const source of sources) {
      const chunks = planChunks(wanted, (day) => needsFetch(day, source));
      for (const chunk of chunks) {
        const at = now();
        try {
          const records = await fetchChunk(source, chunk.start, chunk.range);
          ingest(source, records, at, chunk.days).forEach((d) => changed.add(d));
          lastError = null;
        } catch (error) {
          lastError = error?.message || String(error);
          log(`${source} ${chunk.start}+${chunk.range} failed: ${lastError}`);
          markFailed(source, at, chunk.days);
          chunk.days.forEach((d) => changed.add(d));
        }
      }
    }
    await persist(changed);
  }

  return {
    /** Bring the store up to date (single-flight). Resolves when done. */
    refresh() {
      if (!inflight) {
        inflight = runRefresh().finally(() => { inflight = null; });
      }
      return inflight;
    },

    /** Feed rows fetched elsewhere (the live proxy's 2-day pull). */
    async ingestLive(source, records, fetchedAt, coveredDays) {
      await ensureLoaded();
      const changed = ingest(source, records, fetchedAt, coveredDays.filter((d) => historyDays(now()).includes(d)));
      await persist(changed);
    },

    /** Read the stored day files (cheap after the first call). */
    async load() {
      await ensureLoaded();
    },

    isBuilding() { return Boolean(inflight); },

    /** Per-day coverage, oldest first, for the slider's gap shading. */
    status() {
      const list = historyDays(now()).map((day) => {
        const entry = days.get(day);
        const perSource = {};
        let ok = false;
        let count = 0;
        for (const source of sources) {
          const s = entry?.sources?.[source];
          perSource[source] = s ? { ok: s.ok, count: s.count, final: s.final } : null;
          if (s?.ok) { ok = true; count += s.count; }
        }
        return { day, startMs: dayStartMs(day), ok, count, final: dayIsFinal(entry, sources), sources: perSource };
      });
      return {
        version,
        building: Boolean(inflight),
        lastError,
        days: list,
        count: list.reduce((sum, d) => sum + d.count, 0),
      };
    },

    /** Binary payload for the browser, cached per store version. */
    encoded() {
      if (encoded && encoded.version === version) return encoded.bytes;
      const entries = [];
      for (const entry of days.values()) {
        for (const source of sources) {
          if (!entry.sources?.[source]?.ok) continue;
          const satellite = entry.sources[source].satellite || source;
          for (const row of entry.rows?.[source] || []) entries.push({ row, satellite });
        }
      }
      const bytes = encodeFirmsHistory(entries, { version });
      encoded = { version, bytes };
      return bytes;
    },

    get version() { return version; },
  };
}

function dayIsFinal(entry, sources) {
  if (!entry) return false;
  return sources.every((source) => entry.sources?.[source]?.ok && entry.sources[source].final);
}
