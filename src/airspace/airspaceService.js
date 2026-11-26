/**
 * @file Server-side airspace brief: one place that knows what US airspace is
 * doing now, what it did over the last few days, and what is being reported
 * about it.
 *
 * Four feeds, each with its own cadence and failure state:
 *  - FAA NAS status (public XML) — fetched on demand, cached 60 s.
 *  - OpenSky `states/all` — sampled into a persisted timeline. A sample reuses
 *    the flights proxy's own cached snapshot when it is fresh (zero extra
 *    credits); only when nobody has refreshed it does the sampler fetch one
 *    itself, at most every `sampleEveryMs`, and never during a 429 cooldown.
 *  - OpenSky `flights/all` — the departure study for the active event, built
 *    once in the background and cached; refreshed every three hours until the
 *    event is old enough for OpenSky's flight table to be complete.
 *  - Headlines — GDELT DOC (commercial use permitted with citation) first,
 *    Google News RSS (non-commercial only, flagged) as a fallback. Cached 10 min.
 *
 * Every network dependency is injected, so this module is plain logic that
 * runs under `node --test` with fakes. It never invents a value: a feed that
 * cannot answer is reported as `unavailable` (or `stale`, with its age).
 *
 * @module airspace/airspaceService
 */

import { activeAirspaceEvent } from './events.js';
import { nasSampleCounts, parseNasStatusXml } from './nasStatus.js';
import { departureBinsFromKeys, flightTableWindows, summarizeUsStates, usDepartureKeys } from './usTraffic.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const AIRSPACE_DEFAULTS = Object.freeze({
  sampleEveryMs: 10 * MINUTE,
  minSampleGapMs: 4 * MINUTE,
  piggybackMaxAgeMs: 3 * MINUTE,
  nasTtlMs: MINUTE,
  headlinesTtlMs: 10 * MINUTE,
  headlinesFirstWaitMs: 4000,
  departuresRefreshMs: 3 * HOUR,
  // OpenSky adds a flight to its table after it lands; a two-hour window is
  // treated as final (never re-fetched) once it ended this long ago.
  departureWindowFinalAfterMs: 24 * HOUR,
  maxSamples: 7 * 24 * 6,
  timelineSpanMs: 72 * HOUR,
  firstSampleDelayMs: MINUTE,
});

/**
 * @param {object} deps
 * @param {() => number} [deps.now]
 * @param {{read: () => Promise<any>, write: (data: any) => Promise<void>}} deps.timelineStore
 * @param {{read: (id: string) => Promise<any>, write: (id: string, data: any) => Promise<void>}} deps.departuresStore
 * @param {() => ({body: string|null, at: number, sourceEpochMs?: number|null})} deps.readOpenSkyCache
 * @param {() => boolean} [deps.openSkyCoolingDown]
 * @param {() => Promise<string|null>} [deps.fetchOpenSkyStates]
 * @param {(beginSec: number, endSec: number) => Promise<object[]>} [deps.fetchOpenSkyFlights]
 * @param {() => Promise<string>} deps.fetchNasXml
 * @param {(query: {gdelt: string, rss: string}) => Promise<{source: string, items: object[]}>} [deps.fetchHeadlines]
 * @param {Partial<typeof AIRSPACE_DEFAULTS>} [deps.options]
 * @param {{warn: Function}} [deps.logger]
 */
export function createAirspaceService(deps) {
  const now = deps.now || (() => Date.now());
  const opts = { ...AIRSPACE_DEFAULTS, ...(deps.options || {}) };
  const logger = deps.logger || console;
  const coolingDown = deps.openSkyCoolingDown || (() => false);

  let samples = null; // lazily loaded from the store
  let loading = null;
  let timer = null;
  let firstTimer = null;
  let sampling = null;

  let nasCache = null; // { at, parsed, error }
  let nasInflight = null;
  const headlineCache = new Map(); // eventId|default -> { entry, promise, error }
  const departureState = new Map(); // eventId -> { promise, data }

  async function loadSamples() {
    if (samples) return samples;
    if (!loading) {
      loading = (async () => {
        try {
          const stored = await deps.timelineStore.read();
          samples = Array.isArray(stored?.samples) ? stored.samples.filter((s) => Number.isFinite(s?.at)) : [];
        } catch {
          samples = [];
        }
        return samples;
      })();
    }
    return loading;
  }

  /* ── FAA NAS status ─────────────────────────────────────────────────── */

  async function getNas() {
    const t = now();
    if (nasCache?.parsed && !nasCache.error && t - nasCache.at < opts.nasTtlMs) return nasCache;
    // A failure is remembered briefly so one brief does not hammer a down feed.
    if (nasCache?.error && t - nasCache.failedAt < 15_000) return nasCache;
    if (nasInflight) return nasInflight;
    nasInflight = (async () => {
      try {
        const xml = await deps.fetchNasXml();
        nasCache = { at: now(), parsed: parseNasStatusXml(xml, { now: now() }), error: null, failedAt: 0 };
      } catch (error) {
        // Keep the last good parse, but say how old it is.
        nasCache = { at: nasCache?.at || 0, parsed: nasCache?.parsed || null, error: error?.message || 'unavailable', failedAt: now() };
      } finally {
        nasInflight = null;
      }
      return nasCache;
    })();
    return nasInflight;
  }

  function nasView(cache) {
    if (!cache?.parsed) return { status: 'unavailable', reason: cache?.error || 'not-fetched' };
    const t = now();
    const stale = Boolean(cache.error) || t - cache.at > 5 * opts.nasTtlMs;
    const parsed = cache.parsed;
    return {
      status: stale ? 'stale' : 'ready',
      fetchedAt: new Date(cache.at).toISOString(),
      updatedAt: parsed.updatedAt,
      groundStops: parsed.groundStops,
      groundDelays: parsed.groundDelays,
      delays: parsed.delays,
      closures: parsed.closures.filter((item) => item.recent && item.kind !== 'ga-ppr'),
      standingClosures: parsed.closures.filter((item) => !(item.recent && item.kind !== 'ga-ppr')).length,
      error: cache.error || null,
    };
  }

  /* ── Traffic sampler ────────────────────────────────────────────────── */

  /** Read a states/all body: the proxy's cache when fresh, else (optionally) our own fetch. */
  async function readStates({ allowFetch }) {
    const t = now();
    const cache = deps.readOpenSkyCache?.() || {};
    if (cache.body && t - Number(cache.at || 0) <= opts.piggybackMaxAgeMs) {
      return { text: cache.body, src: 'proxy-cache' };
    }
    if (!allowFetch || opts.sampleEveryMs <= 0 || !deps.fetchOpenSkyStates || coolingDown()) return null;
    const text = await deps.fetchOpenSkyStates();
    return text ? { text, src: 'sampler' } : null;
  }

  /**
   * Take one timeline sample.
   * @param {{allowFetch?: boolean, force?: boolean}} [options]
   * @returns {Promise<object|null>} The appended sample, or null if skipped.
   */
  async function sampleNow({ allowFetch = true, force = false } = {}) {
    if (sampling) return sampling;
    sampling = (async () => {
      const list = await loadSamples();
      const t = now();
      const last = list[list.length - 1];
      // A recent FAA-only sample must not block a due traffic sample.
      const lastTraffic = [...list].reverse().find((sample) => sample.traffic);
      const trafficDue = !lastTraffic || t - lastTraffic.at >= opts.minSampleGapMs;
      if (!force && last && t - last.at < opts.minSampleGapMs && !(allowFetch && trafficDue)) return null;

      let traffic = null;
      let src = null;
      try {
        const states = await readStates({ allowFetch });
        if (states) {
          const summary = summarizeUsStates(JSON.parse(states.text));
          // The same upstream snapshot twice is one observation, not two.
          if (summary && !(last?.traffic && last.traffic.t === summary.t)) {
            traffic = {
              t: summary.t,
              airborne: summary.airborne,
              onGround: summary.onGround,
              byRegion: summary.byRegion,
              byClass: summary.byClass,
              climbing: summary.climbing,
              emergencies: summary.emergencies.slice(0, 5),
            };
            src = states.src;
          }
        }
      } catch (error) {
        logger.warn?.('[airspace] traffic sample failed:', error?.message || error);
      }

      const nasCacheNow = await getNas();
      const nas = nasCacheNow?.parsed && !nasCacheNow.error ? nasSampleCounts(nasCacheNow.parsed) : null;
      if (!traffic && !nas) return null;

      const sample = { at: t, traffic, nas, src };
      list.push(sample);
      while (list.length > opts.maxSamples) list.shift();
      try {
        await deps.timelineStore.write({ version: 1, samples: list });
      } catch (error) {
        logger.warn?.('[airspace] timeline write failed:', error?.message || error);
      }
      return sample;
    })();
    try {
      return await sampling;
    } finally {
      sampling = null;
    }
  }

  /* ── Departure study (OpenSky flight table) ────────────────────────── */

  /**
   * Build (or top up) the study. Each `flights/all` window costs OpenSky
   * credits, so windows are cached individually and a window that ended more
   * than `departureWindowFinalAfterMs` ago is never fetched again — a rebuild
   * only re-reads the windows OpenSky may still be filling.
   */
  async function computeDepartures(event, previous) {
    const from = Date.parse(event.window.from);
    const to = Date.parse(event.window.to);
    const windows = flightTableWindows({ from, to });
    const cached = new Map((previous?.windowsData || []).map((entry) => [entry.begin, entry]));
    const windowsData = [];
    let missing = 0;
    let records = 0;
    for (const window of windows) {
      const prior = cached.get(window.begin);
      if (prior?.final) { windowsData.push(prior); continue; }
      if (coolingDown()) {
        missing += 1;
        if (prior) windowsData.push(prior);
        continue;
      }
      try {
        const rows = await deps.fetchOpenSkyFlights(window.begin, window.end);
        const list = Array.isArray(rows) ? rows : [];
        records += list.length;
        windowsData.push({
          begin: window.begin,
          end: window.end,
          fetchedAt: now(),
          final: now() - window.end * 1000 > opts.departureWindowFinalAfterMs,
          keys: usDepartureKeys(list),
        });
      } catch (error) {
        missing += 1;
        if (prior) windowsData.push(prior);
        logger.warn?.('[airspace] flight table window failed:', error?.message || error);
      }
    }
    const t = now();
    const data = {
      eventId: event.id,
      computedAt: t,
      complete: missing === 0 && windowsData.length === windows.length && windowsData.every((entry) => entry.final),
      windows: windows.length,
      missingWindows: missing,
      recordsFetched: records,
      departures: windowsData.reduce((sum, entry) => sum + entry.keys.length, 0),
      windowsData,
      bins: departureBinsFromKeys(windowsData.flatMap((entry) => entry.keys), { from, to }),
    };
    try {
      await deps.departuresStore.write(event.id, data);
    } catch (error) {
      logger.warn?.('[airspace] departures write failed:', error?.message || error);
    }
    return data;
  }

  /** Cached study, kicking a background refresh when due. Never blocks on OpenSky. */
  async function getDepartures(event) {
    if (!event) return { status: 'no-event' };
    if (!deps.fetchOpenSkyFlights) return { status: 'unavailable', reason: 'no-flight-table-source' };
    let state = departureState.get(event.id);
    if (!state) {
      state = { promise: null, data: null };
      departureState.set(event.id, state);
      try { state.data = await deps.departuresStore.read(event.id); } catch { state.data = null; }
    }
    const t = now();
    const due = !state.data || (!state.data.complete && t - Number(state.data.computedAt || 0) > opts.departuresRefreshMs);
    if (due && !state.promise) {
      state.promise = computeDepartures(event, state.data)
        .then((data) => { state.data = data; return data; })
        .catch((error) => { logger.warn?.('[airspace] departures failed:', error?.message || error); return null; })
        .finally(() => { state.promise = null; });
    }
    if (!state.data) return { status: 'computing' };
    return {
      status: state.data.missingWindows > 0 ? 'partial' : 'ready',
      computedAt: new Date(state.data.computedAt).toISOString(),
      complete: Boolean(state.data.complete),
      windows: state.data.windows,
      missingWindows: state.data.missingWindows,
      departures: state.data.departures ?? null,
      binMinutes: 30,
      bins: state.data.bins,
      refreshing: Boolean(state.promise),
    };
  }

  /** Test hook: wait for any background departure or headline work. */
  async function settle() {
    await Promise.all([
      ...[...departureState.values()].map((state) => state.promise),
      ...[...headlineCache.values()].map((state) => state.promise),
    ].filter(Boolean));
  }

  /* ── Headlines ─────────────────────────────────────────────────────── */

  /**
   * Stale-while-revalidate. News indexes are the slowest feed here (GDELT
   * answers a rate-limited caller with a 429 after ~12 s), so the brief never
   * waits on one for longer than `headlinesFirstWaitMs`: it returns what it
   * has and the board's next refresh picks up the rest.
   */
  async function getHeadlines(event) {
    if (!deps.fetchHeadlines) return { status: 'unavailable', reason: 'no-headline-source' };
    const query = event?.newsQuery || { gdelt: '"air traffic control" FAA', rss: 'FAA air traffic control' };
    const key = event?.id || 'default';
    let state = headlineCache.get(key);
    if (!state) {
      state = { entry: null, promise: null, error: null };
      headlineCache.set(key, state);
    }
    const t = now();
    const fresh = state.entry && t - state.entry.at < opts.headlinesTtlMs;
    if (!fresh && !state.promise) {
      state.promise = Promise.resolve()
        .then(() => deps.fetchHeadlines(query))
        .then((result) => {
          state.entry = { at: now(), source: result?.source || null, items: Array.isArray(result?.items) ? result.items : [], error: null };
          state.error = null;
        })
        .catch((error) => {
          state.error = error?.message || 'unavailable';
          if (state.entry) state.entry = { ...state.entry, error: state.error };
        })
        .finally(() => { state.promise = null; });
    }
    if (!state.entry && state.promise) {
      await Promise.race([state.promise, new Promise((resolve) => setTimeout(resolve, opts.headlinesFirstWaitMs))]);
    }
    if (state.entry) return headlineView(state.entry, query);
    if (state.promise) return { status: 'computing', query: query.gdelt };
    return { status: 'unavailable', reason: state.error || 'unavailable', query: query.gdelt };
  }

  function headlineView(entry, query) {
    return {
      status: entry.error ? 'stale' : entry.items.length ? 'ready' : 'empty',
      source: entry.source,
      query: entry.source === 'Google News RSS' ? query.rss : query.gdelt,
      fetchedAt: new Date(entry.at).toISOString(),
      items: entry.items,
      error: entry.error,
    };
  }

  /* ── The brief ─────────────────────────────────────────────────────── */

  /**
   * Everything the board needs in one response.
   * @returns {Promise<object>}
   */
  async function getBrief() {
    const t = now();
    const event = activeAirspaceEvent(t);
    // An open board is a reason to sample, but only from the proxy's cache —
    // watching the board must not spend OpenSky credits on its own.
    await sampleNow({ allowFetch: false }).catch(() => null);
    const [nasCacheNow, headlines, departures] = await Promise.all([
      getNas(),
      getHeadlines(event),
      getDepartures(event).catch((error) => ({ status: 'unavailable', reason: error?.message || 'failed' })),
    ]);
    const list = await loadSamples();
    const spanStart = Math.min(t - opts.timelineSpanMs, event ? Date.parse(event.window.from) : Infinity);
    const timeline = list.filter((sample) => sample.at >= spanStart);
    const latestTraffic = [...timeline].reverse().find((sample) => sample.traffic)?.traffic || null;
    const trafficAge = latestTraffic ? t - latestTraffic.t : null;

    return {
      ok: true,
      generatedAt: new Date(t).toISOString(),
      nas: nasView(nasCacheNow),
      traffic: latestTraffic
        ? { status: trafficAge > 3 * Math.max(opts.sampleEveryMs, 10 * MINUTE) ? 'stale' : 'ready', ...latestTraffic, ageMs: trafficAge }
        : { status: 'unavailable', reason: opts.sampleEveryMs > 0 ? 'no-sample-yet' : 'sampler-off' },
      timeline: { sampleEveryMs: opts.sampleEveryMs, samples: timeline },
      departures,
      event,
      headlines,
    };
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────── */

  function start() {
    if (timer) return;
    const tick = () => { sampleNow({ allowFetch: true }).catch(() => null); };
    firstTimer = setTimeout(tick, opts.firstSampleDelayMs);
    timer = setInterval(tick, Math.max(opts.sampleEveryMs || 10 * MINUTE, MINUTE));
    firstTimer.unref?.();
    timer.unref?.();
  }

  function stop() {
    clearTimeout(firstTimer);
    clearInterval(timer);
    firstTimer = null;
    timer = null;
  }

  return { start, stop, sampleNow, getBrief, getNas, getDepartures, getHeadlines, settle };
}
