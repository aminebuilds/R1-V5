/**
 * @file Jarvis service — fetches every feed on its own cadence, caches it,
 * serves last-good data (flagged stale) through upstream blips, and assembles
 * one snapshot with the ranked brief.
 *
 * Runs server-side only (Vite middleware, `vite.config.js` → `jarvisProxy`).
 * The browser never sees a key and never names a URL.
 *
 * Every envelope declares `kind`: `measured` (a published observation or
 * price), `modelled` (a forecast or model output), or `unavailable` with a
 * `reason` (`no-key`, `no-home`, `rate-limited`, `timeout`, …). There is no
 * fourth state and no fallback to invented values.
 *
 * @module jarvis/jarvisService
 */

import * as F from './feeds.js';
import {
  BLS_SERIES, BLUESKY_QUERIES, DEFAULT_MARKET_BOARD, DEFAULT_NEWS_QUERIES, GDELT_THEMES,
  HOME_AIRPORTS, JARVIS_USER_AGENT, REDDIT_SUBS, assertAllowedUrl, homePlaces, localNewsQueries,
  parseWatchlist, urls,
} from './sources.js';
import { parseNasStatusXml } from '../airspace/nasStatus.js';
import { etParts, marketSession } from './marketCalendar.js';
import { buildBrief, situationLine } from './recommend.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** HTTP failure carrying the upstream status. */
export class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/**
 * Default fetcher: allowlisted https hosts only, timeout, byte cap, and the
 * final (post-redirect) host re-checked against the allowlist.
 */
export async function defaultFetchText(url, { method = 'GET', headers = {}, body, timeoutMs = 12_000, maxBytes = 8 * 1024 * 1024 } = {}) {
  assertAllowedUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': JARVIS_USER_AGENT, ...headers },
      body,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.url) assertAllowedUrl(res.url);
    if (!res.ok) throw new HttpError(res.status);
    if (!res.body?.getReader) return await res.text();
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8').decode(merged);
  } finally {
    clearTimeout(timer);
  }
}

/** Why a fetch failed, in the vocabulary the UI prints. */
export function reasonFor(error) {
  if (error?.status === 401 || error?.status === 403) return 'auth-rejected';
  if (error?.status === 429) return 'rate-limited';
  if (error?.status === 404) return 'not-found';
  if (error?.status >= 500) return 'upstream-down';
  if (error?.name === 'AbortError' || /abort|timeout/i.test(String(error?.message))) return 'timeout';
  if (/Unexpected .* payload|JSON/.test(String(error?.message))) return 'bad-payload';
  if (/not matched/i.test(String(error?.message))) return 'address-not-matched';
  return 'upstream-error';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

function titleCaseAddress(text) {
  return String(text || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bNj\b/, 'NJ');
}

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   fetchText?: typeof defaultFetchText,
 *   store?: {read: (name: string) => Promise<any>, write: (name: string, data: any) => Promise<void>}|null,
 *   now?: () => number,
 *   log?: (message: string) => void,
 *   gdeltSpacingMs?: number,
 * }} [options]
 */
export function createJarvisService({
  env = {},
  fetchText = defaultFetchText,
  store = null,
  now = () => Date.now(),
  log = (message) => console.warn(message),
  gdeltSpacingMs = 5_500,
} = {}) {
  const geo = { headers: { Accept: 'application/geo+json' } };
  const http = {
    text: (url, opts = {}) => fetchText(url, opts),
    json: async (url, opts = {}) => JSON.parse(await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } })),
  };
  const board = [...DEFAULT_MARKET_BOARD, ...parseWatchlist(env.JARVIS_WATCHLIST)];
  const news = DEFAULT_NEWS_QUERIES;
  /** Local + incident queries, derived from the home once it resolves. */
  const localQueries = (h) => {
    const places = homePlaces(h, env.JARVIS_LOCAL_PLACES);
    return { places, ...localNewsQueries(places, h?.state) };
  };
  const cache = new Map();
  const memo = new Map();
  const hydrated = new Set();
  let home = { value: undefined, error: null, at: 0, inflight: null };

  async function memoize(key, ttlMs, fn) {
    const hit = memo.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await fn();
    memo.set(key, { value, at: now() });
    return value;
  }

  async function retryOnce(fn) {
    try { return await fn(); } catch (error) {
      if (error?.status && error.status < 500) throw error;
      await sleep(400);
      return fn();
    }
  }

  // ── home ──────────────────────────────────────────────────────────────────

  async function resolveHome() {
    if (home.value) return home.value;
    if (home.value === null && !home.error) return null;
    if (home.error && now() - home.at < MIN) return null;
    if (home.inflight) return home.inflight;
    home.inflight = (async () => {
      const lat = F.num(env.JARVIS_HOME_LAT);
      const lon = F.num(env.JARVIS_HOME_LON);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return {
          lat, lon, label: env.JARVIS_HOME_LABEL || 'Home', matchedAddress: null,
          municipality: null, county: env.JARVIS_HOME_COUNTY || null, state: env.JARVIS_HOME_STATE || null,
          zip: null, source: 'env',
        };
      }
      const address = String(env.JARVIS_HOME_ADDRESS || '').trim();
      if (!address) return null;
      const key = hashText(address);
      const cached = store ? await store.read('home').catch(() => null) : null;
      if (cached?.key === key && cached.home) return cached.home;
      const g = F.parseCensusGeocode(await http.json(urls.censusGeocode(address), { timeoutMs: 15_000 }));
      if (!g) throw new Error('Address not matched by the Census geocoder');
      const value = { ...g, label: env.JARVIS_HOME_LABEL || titleCaseAddress(g.matchedAddress), source: 'census' };
      if (store) await store.write('home', { key, home: value, at: now() }).catch(() => {});
      return value;
    })();
    try {
      home = { value: await home.inflight, error: null, at: now(), inflight: null };
    } catch (error) {
      log(`[jarvis] home geocode failed: ${error?.message || error}`);
      home = { value: undefined, error: reasonFor(error), at: now(), inflight: null };
    }
    return home.value ?? null;
  }

  async function nwsMeta(h) {
    return memoize('nws-meta', 24 * HOUR, async () => {
      const point = F.parseNwsPoint(await retryOnce(() => http.json(urls.nwsPoint(h), geo)));
      const stations = F.parseNwsStations(await retryOnce(() => http.json(`${point.stationsUrl}?limit=6`, geo)));
      return { point, stations };
    });
  }

  // ── feed definitions ──────────────────────────────────────────────────────

  const defs = [
    {
      id: 'weather.alerts', label: 'NWS alerts', group: 'local', kind: 'measured', ttlMs: MIN, staleMs: 10 * MIN, requiresHome: true,
      source: { name: 'National Weather Service', url: 'https://www.weather.gov/' },
      run: async (h) => F.parseNwsAlerts(await retryOnce(() => http.json(urls.nwsAlerts(h), geo))),
    },
    {
      id: 'weather.now', label: 'Conditions', group: 'local', kind: 'measured', ttlMs: 5 * MIN, staleMs: 90 * MIN, requiresHome: true,
      source: { name: 'NWS station observation', url: 'https://www.weather.gov/' },
      observedAt: (d) => d.observedAt,
      run: async (h) => {
        const meta = await nwsMeta(h);
        let lastError = null;
        for (const station of meta.stations.slice(0, 3)) {
          try {
            const obs = F.parseNwsObservation(await http.json(urls.nwsLatestObs(station.id), geo), station);
            if (obs.tempF !== null && now() - Date.parse(obs.observedAt) < 3 * HOUR) return obs;
          } catch (error) { lastError = error; }
        }
        throw lastError || new Error('No nearby station reported in the last 3 hours');
      },
    },
    {
      id: 'weather.forecast', label: 'Forecast', group: 'local', kind: 'modelled', ttlMs: 15 * MIN, staleMs: 6 * HOUR, requiresHome: true,
      source: { name: 'NWS gridded forecast', url: 'https://www.weather.gov/' },
      observedAt: (d) => d.hourly?.issuedAt || null,
      run: async (h) => {
        const meta = await nwsMeta(h);
        const [hourly, daily] = await Promise.all([
          retryOnce(() => http.json(meta.point.forecastHourlyUrl, geo)).then((p) => F.parseNwsHourly(p, { now: now() })),
          retryOnce(() => http.json(meta.point.forecastUrl, geo)).then((p) => F.parseNwsDaily(p)).catch(() => null),
        ]);
        return { hourly, daily, office: meta.point.office, nearestPlace: meta.point.nearestPlace };
      },
    },
    {
      id: 'local.air', label: 'Air quality', group: 'local', kind: 'modelled', ttlMs: 30 * MIN, staleMs: 4 * HOUR, requiresHome: true,
      source: { name: 'Open-Meteo (CAMS model)', url: 'https://open-meteo.com/' },
      kindFor: (d) => (d.provider === 'airnow' ? 'measured' : 'modelled'),
      sourceFor: (d) => (d.provider === 'airnow' ? { name: 'EPA AirNow monitors', url: 'https://www.airnow.gov/' } : null),
      run: async (h) => {
        if (env.AIRNOW_API_KEY) {
          try {
            const a = F.parseAirNow(await http.json(urls.airNow(h, env.AIRNOW_API_KEY)));
            if (a) return { ...a, provider: 'airnow', peak24h: null };
          } catch (error) { log(`[jarvis] AirNow failed, using Open-Meteo: ${error?.message}`); }
        }
        return { ...F.parseOpenMeteoAir(await http.json(urls.openMeteoAir(h)), { now: now() }), provider: 'open-meteo' };
      },
    },
    {
      id: 'hazards.space', label: 'Space weather', group: 'hazards', kind: 'measured', ttlMs: 15 * MIN, staleMs: 3 * HOUR,
      source: { name: 'NOAA SWPC', url: 'https://www.swpc.noaa.gov/' },
      run: async () => {
        const [scales, kp] = await Promise.all([
          http.json(urls.swpcScales()).then(F.parseSwpcScales),
          http.json(urls.swpcKp()).then(F.parseKp).catch(() => null),
        ]);
        return { ...scales, kp };
      },
    },
    {
      id: 'hazards.quakes', label: 'Earthquakes', group: 'hazards', kind: 'measured', ttlMs: 10 * MIN, staleMs: 2 * HOUR, requiresHome: true,
      source: { name: 'USGS', url: 'https://earthquake.usgs.gov/' },
      run: async (h) => F.parseUsgsQuakes(await http.json(urls.usgsWeek(), { maxBytes: 4 * 1024 * 1024 }), h, { now: now() }),
    },
    {
      id: 'hazards.tropical', label: 'Tropical cyclones', group: 'hazards', kind: 'measured', ttlMs: 30 * MIN, staleMs: 6 * HOUR, requiresHome: true,
      source: { name: 'NOAA National Hurricane Center', url: 'https://www.nhc.noaa.gov/' },
      run: async (h) => F.parseNhcStorms(await http.json(urls.nhcStorms()), h),
    },
    {
      id: 'hazards.fema', label: 'FEMA declarations', group: 'hazards', kind: 'measured', ttlMs: 6 * HOUR, staleMs: 48 * HOUR, requiresHome: true, persist: true,
      source: { name: 'OpenFEMA', url: 'https://www.fema.gov/about/openfema' },
      run: async (h) => {
        if (!h.state) throw new Error('Home state unknown');
        return F.parseFemaDeclarations(await http.json(urls.femaState(h.state)), { county: h.county, now: now() });
      },
    },
    {
      id: 'local.airports', label: 'Airports', group: 'local', kind: 'measured', ttlMs: 2 * MIN, staleMs: 30 * MIN,
      source: { name: 'FAA NAS status', url: 'https://nasstatus.faa.gov/' },
      observedAt: (d) => d.updatedAt,
      run: async () => {
        const xml = await http.text(urls.faaStatus(), { headers: { Accept: 'application/xml' }, maxBytes: 1024 * 1024 });
        return F.pickHomeAirports(parseNasStatusXml(xml, { now: now() }), HOME_AIRPORTS);
      },
    },
    {
      id: 'local.traffic', label: 'Traffic incidents', group: 'local', kind: 'measured', ttlMs: 5 * MIN, staleMs: 30 * MIN, requiresHome: true,
      source: { name: 'TomTom Traffic', url: 'https://developer.tomtom.com/' },
      key: () => Boolean(env.TOMTOM_API_KEY), needs: 'TOMTOM_API_KEY',
      run: async (h) => F.parseTomTomIncidents(await http.json(urls.tomtomIncidents(h, env.TOMTOM_API_KEY)), h),
    },
    {
      id: 'local.events', label: 'Events nearby', group: 'local', kind: 'measured', ttlMs: HOUR, staleMs: 6 * HOUR, requiresHome: true,
      source: { name: 'Ticketmaster Discovery', url: 'https://developer.ticketmaster.com/' },
      key: () => Boolean(env.TICKETMASTER_API_KEY), needs: 'TICKETMASTER_API_KEY (free at developer.ticketmaster.com)',
      run: async (h) => {
        const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
        return F.parseTicketmaster(await http.json(urls.ticketmaster(h, env.TICKETMASTER_API_KEY, stamp(now()), stamp(now() + 48 * HOUR))));
      },
    },
    {
      id: 'markets', label: 'Market board', group: 'money', kind: 'measured', ttlMs: MIN, staleMs: 30 * MIN,
      source: { name: 'Yahoo Finance (delayed)', url: 'https://finance.yahoo.com/' },
      run: async () => {
        const chunks = [];
        for (let i = 0; i < board.length; i += 20) chunks.push(board.slice(i, i + 20));
        const parts = await Promise.all(chunks.map(async (rows) => F.parseYahooSpark(await http.json(urls.yahooSpark(rows.map((r) => r.symbol))), rows)));
        const quotes = parts.flat();
        if (!quotes.some((q) => q.available)) throw new Error('Unexpected Yahoo spark payload (no quotes)');
        return quotes;
      },
    },
    {
      id: 'markets.regime', label: 'S&P trend regime', group: 'money', kind: 'measured', ttlMs: HOUR, staleMs: 24 * HOUR,
      source: { name: 'Yahoo Finance daily closes', url: 'https://finance.yahoo.com/quote/SPY' },
      observedAt: (d) => d.asOf,
      run: async () => F.parseYahooDailyRegime(await http.json(urls.yahooDaily('SPY'))),
    },
    {
      id: 'rates.treasury', label: 'Treasury curve', group: 'money', kind: 'measured', ttlMs: 3 * HOUR, staleMs: 72 * HOUR, persist: true,
      source: { name: 'U.S. Treasury par yield curve', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' },
      observedAt: (d) => (d?.date ? `${d.date}T21:00:00.000Z` : null),
      run: async () => {
        const { year, date } = etParts(now());
        const month = Number(date.slice(5, 7));
        const yyyymm = `${year}${String(month).padStart(2, '0')}`;
        const get = (ym) => retryOnce(() => http.text(urls.treasuryMonth(ym), { maxBytes: 2 * 1024 * 1024, timeoutMs: 30_000 }));
        let rows = F.parseTreasuryXml(await get(yyyymm));
        if (rows.length < 2) {
          const prevMonth = month === 1 ? `${year - 1}12` : `${year}${String(month - 1).padStart(2, '0')}`;
          rows = [...F.parseTreasuryXml(await get(prevMonth)), ...rows];
        }
        const summary = F.summarizeTreasury(rows);
        if (!summary) throw new Error('Unexpected Treasury payload (no rows)');
        return summary;
      },
    },
    {
      id: 'rates.nyfed', label: 'SOFR / EFFR', group: 'money', kind: 'measured', ttlMs: 3 * HOUR, staleMs: 72 * HOUR, persist: true,
      source: { name: 'Federal Reserve Bank of New York', url: 'https://www.newyorkfed.org/markets/reference-rates' },
      run: async () => {
        const [sofr, effr] = await Promise.allSettled([
          http.json(urls.nyFedSofr()).then(F.parseNyFedRate),
          http.json(urls.nyFedEffr()).then(F.parseNyFedRate),
        ]);
        if (sofr.status === 'rejected' && effr.status === 'rejected') throw sofr.reason;
        return { sofr: sofr.value || null, effr: effr.value || null };
      },
    },
    {
      id: 'macro.bls', label: 'Jobs & inflation', group: 'money', kind: 'measured', ttlMs: 12 * HOUR, staleMs: 14 * 24 * HOUR, persist: true,
      source: { name: 'U.S. Bureau of Labor Statistics', url: 'https://www.bls.gov/' },
      run: async () => F.parseBls(await http.json(urls.bls(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesid: Object.values(BLS_SERIES) }),
      }), BLS_SERIES),
    },
    {
      id: 'macro.mortgage', label: 'Mortgage rates', group: 'money', kind: 'measured', ttlMs: 12 * HOUR, staleMs: 14 * 24 * HOUR, persist: true,
      source: { name: 'Freddie Mac PMMS', url: 'https://www.freddiemac.com/pmms' },
      observedAt: (d) => (d?.date ? `${d.date}T16:00:00.000Z` : null),
      run: async () => F.parsePmmsCsv(await http.text(urls.pmms(), { maxBytes: 2 * 1024 * 1024 })),
    },
    {
      id: 'sentiment.cryptoFng', label: 'Crypto Fear & Greed', group: 'sentiment', kind: 'measured', ttlMs: 30 * MIN, staleMs: 24 * HOUR,
      source: { name: 'Alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/' },
      observedAt: (d) => d.now?.at,
      run: async () => F.parseFearGreed(await http.json(urls.fearGreed())),
    },
    {
      id: 'crypto.stablecoins', label: 'Stablecoin supply', group: 'sentiment', kind: 'measured', ttlMs: 30 * MIN, staleMs: 24 * HOUR,
      source: { name: 'DefiLlama', url: 'https://defillama.com/stablecoins' },
      run: async () => F.parseStablecoins(await http.json(urls.stablecoins(), { maxBytes: 6 * 1024 * 1024 })),
    },
    {
      id: 'narratives.polymarket', label: 'Prediction markets', group: 'narrative', kind: 'measured', ttlMs: 3 * MIN, staleMs: 2 * HOUR,
      source: { name: 'Polymarket', url: 'https://polymarket.com/' },
      run: async () => F.parsePolymarket(await http.json(urls.polymarket(), { maxBytes: 12 * 1024 * 1024, timeoutMs: 15_000 })),
    },
    {
      id: 'attention.trends', label: 'Search trends', group: 'narrative', kind: 'measured', ttlMs: 15 * MIN, staleMs: 6 * HOUR,
      source: { name: 'Google Trends', url: 'https://trends.google.com/trending?geo=US' },
      run: async (h) => {
        const state = h?.state && /^[A-Z]{2}$/.test(h.state) ? h.state : 'NJ';
        const [us, local] = await Promise.all([
          http.text(urls.trends('US')).then((x) => F.parseTrendsRss(x)),
          http.text(urls.trends(`US-${state}`)).then((x) => F.parseTrendsRss(x)).catch(() => []),
        ]);
        return { us, local, localGeo: `US-${state}` };
      },
    },
    {
      id: 'attention.wiki', label: 'Wikipedia attention', group: 'narrative', kind: 'measured', ttlMs: 6 * HOUR, staleMs: 48 * HOUR, persist: true,
      source: { name: 'Wikimedia pageviews', url: 'https://wikimedia.org/api/rest_v1/' },
      run: async () => {
        for (const back of [1, 2]) {
          const d = new Date(now() - back * 24 * HOUR);
          const [yyyy, mm, dd] = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];
          try { return F.parseWikiTop(await http.json(urls.wikiTop(yyyy, mm, dd))); } catch (error) { if (error?.status !== 404 || back === 2) throw error; }
        }
        return null;
      },
    },
    {
      id: 'attention.hn', label: 'Hacker News', group: 'narrative', kind: 'measured', ttlMs: 10 * MIN, staleMs: 3 * HOUR,
      source: { name: 'Hacker News (Algolia)', url: 'https://news.ycombinator.com/' },
      run: async () => F.parseHnFront(await http.json(urls.hnFront())),
    },
    {
      id: 'news.local', label: 'Local news', group: 'news', kind: 'measured', ttlMs: 10 * MIN, staleMs: 6 * HOUR, requiresHome: true,
      source: { name: 'Google News RSS', url: 'https://news.google.com/' },
      run: async (h) => F.parseNewsRss(await http.text(urls.googleNews(localQueries(h).local)), { limit: 8 }),
    },
    {
      id: 'news.safety', label: 'Local incident reports', group: 'news', kind: 'measured', ttlMs: 10 * MIN, staleMs: 6 * HOUR, requiresHome: true,
      source: { name: 'Google News RSS', url: 'https://news.google.com/' },
      run: async (h) => {
        const q = localQueries(h);
        return F.filterIncidentHeadlines(F.parseNewsRss(await http.text(urls.googleNews(q.safety)), { limit: 25 }), q.places).slice(0, 6);
      },
    },
    ...Object.entries({
      'news.macro': ['Macro headlines', news.macro, 8],
      'news.ai': ['AI headlines', news.ai, 8],
      'news.tokenization': ['Tokenization headlines', news.tokenization, 8],
    }).map(([id, [label, query, limit]]) => ({
      id, label, group: 'news', kind: 'measured', ttlMs: 10 * MIN, staleMs: 6 * HOUR,
      source: { name: 'Google News RSS', url: 'https://news.google.com/' },
      run: async () => F.parseNewsRss(await http.text(urls.googleNews(query)), { limit }),
    })),
    {
      id: 'tone.gdelt', label: 'News tone', group: 'sentiment', kind: 'measured', ttlMs: HOUR, staleMs: 12 * HOUR, persist: true, background: true, retryMs: 15 * MIN,
      source: { name: 'GDELT Project', url: 'https://www.gdeltproject.org/' },
      run: async () => {
        const out = [];
        let lastError = null;
        for (const [i, theme] of GDELT_THEMES.entries()) {
          if (i > 0) await sleep(gdeltSpacingMs);
          try {
            out.push({ id: theme.id, label: theme.label, tone: F.parseGdeltTone(await http.json(urls.gdeltTone(theme.query), { timeoutMs: 20_000 })) });
          } catch (error) {
            lastError = error;
            out.push({ id: theme.id, label: theme.label, tone: null, reason: reasonFor(error) });
            if (error?.status === 429) await sleep(gdeltSpacingMs);
          }
        }
        if (!out.some((t) => t.tone)) throw lastError || new Error('GDELT returned no tone');
        return out;
      },
    },
    {
      id: 'cyber.kev', label: 'Exploited vulnerabilities', group: 'cyber', kind: 'measured', ttlMs: 6 * HOUR, staleMs: 72 * HOUR, persist: true,
      source: { name: 'CISA KEV catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
      run: async () => F.parseKev(await http.json(urls.cisaKev(), { maxBytes: 8 * 1024 * 1024, timeoutMs: 20_000 }), { now: now() }),
    },
    {
      id: 'social.reddit', label: 'Reddit', group: 'sentiment', kind: 'measured', ttlMs: 10 * MIN, staleMs: 3 * HOUR,
      source: { name: 'Reddit API', url: 'https://www.reddit.com/' },
      key: () => Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
      needs: 'REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (script app at reddit.com/prefs/apps)',
      run: async () => {
        const ua = env.REDDIT_USER_AGENT || JARVIS_USER_AGENT;
        const token = await memoize('reddit-token', 50 * MIN, async () => {
          const payload = JSON.parse(await http.text(urls.redditToken(), {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': ua,
            },
            body: 'grant_type=client_credentials',
          }));
          if (!payload.access_token) throw new HttpError(401);
          return payload.access_token;
        });
        const subs = await Promise.all(REDDIT_SUBS.map(async (sub) => ({
          sub,
          posts: F.parseRedditListing(await http.json(urls.redditHot(sub), { headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua } }), sub),
        })));
        return subs;
      },
    },
    {
      id: 'social.bluesky', label: 'Bluesky', group: 'sentiment', kind: 'measured', ttlMs: 15 * MIN, staleMs: 3 * HOUR,
      source: { name: 'Bluesky (AT Protocol)', url: 'https://bsky.app/' },
      key: () => Boolean(env.BSKY_HANDLE && env.BSKY_APP_PASSWORD),
      needs: 'BSKY_HANDLE + BSKY_APP_PASSWORD (Settings → App passwords)',
      run: async () => {
        const jwt = await memoize('bsky-session', 90 * MIN, async () => {
          const payload = JSON.parse(await http.text(urls.bskySession(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
          }));
          if (!payload.accessJwt) throw new HttpError(401);
          return payload.accessJwt;
        });
        const since = new Date(now() - 24 * HOUR).toISOString();
        return Promise.all(BLUESKY_QUERIES.map(async (q) => ({
          query: q,
          posts: F.parseBlueskySearch(await http.json(urls.bskySearch(q, since), { headers: { Authorization: `Bearer ${jwt}` } }), q),
        })));
      },
    },
  ];

  // ── cache machinery ───────────────────────────────────────────────────────

  function base(def) {
    return { id: def.id, label: def.label, group: def.group, source: def.source };
  }

  function unavailable(def, reason) {
    return { ...base(def), kind: 'unavailable', reason, ...(reason === 'no-key' ? { needs: def.needs } : {}), fetchedAt: null, observedAt: null, data: null };
  }

  async function hydrate(def) {
    if (hydrated.has(def.id)) return;
    hydrated.add(def.id);
    if (!def.persist || !store) return;
    const saved = await store.read(`feed-${def.id}`).catch(() => null);
    if (!saved?.envelope || !Number.isFinite(saved.at)) return;
    const age = now() - saved.at;
    if (age > def.staleMs) return;
    const entry = { lastGood: { envelope: saved.envelope, at: saved.at } };
    if (age < def.ttlMs) { entry.envelope = saved.envelope; entry.at = saved.at; }
    cache.set(def.id, entry);
  }

  /** Cached envelope still good to serve without a fetch? */
  function isFresh(def, entry) {
    if (!entry?.envelope) return false;
    const age = now() - entry.at;
    // Failures back off for a minute (or the TTL, if shorter) before retrying;
    // feeds with a strict upstream policy set their own `retryMs`.
    return entry.envelope.kind === 'unavailable' ? age < (def.retryMs ?? Math.min(def.ttlMs, MIN)) : age < def.ttlMs;
  }

  async function runFeed(def, h) {
    await hydrate(def);
    const entry = cache.get(def.id) || {};
    cache.set(def.id, entry);
    const t = now();
    if (isFresh(def, entry)) return entry.envelope;
    if (entry.inflight) return entry.inflight;
    if (def.key && !def.key()) {
      Object.assign(entry, { envelope: unavailable(def, 'no-key'), at: t });
      return entry.envelope;
    }
    if (def.requiresHome && !h) {
      Object.assign(entry, { envelope: unavailable(def, home.error || 'no-home'), at: t });
      return entry.envelope;
    }
    entry.inflight = (async () => {
      try {
        const data = await def.run(h);
        const envelope = {
          ...base(def),
          source: def.sourceFor?.(data) || def.source,
          kind: def.kindFor ? def.kindFor(data) : def.kind,
          fetchedAt: new Date(now()).toISOString(),
          observedAt: def.observedAt ? (def.observedAt(data) || null) : null,
          stale: false,
          data,
        };
        Object.assign(entry, { envelope, at: now(), lastGood: { envelope, at: now() } });
        if (def.persist && store) store.write(`feed-${def.id}`, { at: now(), envelope }).catch(() => {});
        return envelope;
      } catch (error) {
        const reason = reasonFor(error);
        log(`[jarvis] ${def.id} failed (${reason}): ${error?.message || error}`);
        const last = entry.lastGood;
        const envelope = last && now() - last.at < def.staleMs
          ? { ...last.envelope, stale: true, staleReason: reason }
          : unavailable(def, reason);
        Object.assign(entry, { envelope, at: now() });
        return envelope;
      } finally {
        entry.inflight = null;
      }
    })();
    return entry.inflight;
  }

  function publicHome(h) {
    if (!h) return null;
    return {
      label: h.label,
      matchedAddress: h.matchedAddress,
      municipality: h.municipality,
      county: h.county,
      state: h.state,
      zip: h.zip,
      lat: F.round(h.lat, 4),
      lon: F.round(h.lon, 4),
      source: h.source,
    };
  }

  /**
   * Assemble the snapshot. Feeds that miss the deadline keep fetching in the
   * background and are reported as `loading` (or their last-good data, stale).
   */
  async function getSnapshot({ deadlineMs = 9_000 } = {}) {
    const started = now();
    const h = await resolveHome();
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, deadlineMs, null); });
    const fallback = (def) => {
      const entry = cache.get(def.id);
      return entry?.lastGood
        ? { ...entry.lastGood.envelope, stale: true, staleReason: 'refreshing' }
        : { ...base(def), kind: 'unavailable', reason: 'loading', fetchedAt: null, observedAt: null, data: null };
    };
    const results = await Promise.all(defs.map(async (def) => {
      await hydrate(def);
      const entry = cache.get(def.id);
      if (isFresh(def, entry)) return entry.envelope;
      const wasRunning = Boolean(entry?.inflight);
      const pending = runFeed(def, h);
      // Background feeds (GDELT's 5-second spacing) and fetches already in
      // flight from an earlier request never hold this snapshot up: they
      // report last-good (stale) or loading and land on a later poll.
      if (def.background || wasRunning) {
        pending.catch(() => {});
        return fallback(def);
      }
      const settled = await Promise.race([pending, deadline]);
      return settled || fallback(def);
    }));
    clearTimeout(timer);
    const feeds = Object.fromEntries(results.map((f) => [f.id, f]));
    const t = now();
    const session = marketSession(t);
    const brief = buildBrief(feeds, { now: t, session, log });
    const health = { measured: 0, modelled: 0, unavailable: 0, stale: 0 };
    for (const f of results) {
      health[f.kind] += 1;
      if (f.stale) health.stale += 1;
    }
    return {
      generatedAt: new Date(t).toISOString(),
      tookMs: t - started,
      home: publicHome(h),
      homeStatus: h ? 'ok' : (home.error || (env.JARVIS_HOME_ADDRESS || env.JARVIS_HOME_LAT ? 'pending' : 'not-configured')),
      session,
      situation: situationLine(brief),
      brief,
      feeds,
      health,
    };
  }

  return { getSnapshot, resolveHome, feedIds: defs.map((d) => d.id), board };
}
