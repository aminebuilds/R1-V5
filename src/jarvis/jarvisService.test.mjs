import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, createJarvisService, reasonFor } from './jarvisService.js';
import { assertAllowedUrl, homePlaces, localNewsQueries, parseWatchlist } from './sources.js';

/** Fetcher that fails every call and records what was asked for. */
function failingFetch(calls, status = 503) {
  return async (url) => {
    calls.push(url);
    throw new HttpError(status);
  };
}

test('without a home point, local feeds report no-home and are never fetched', async () => {
  const calls = [];
  const svc = createJarvisService({ env: {}, fetchText: failingFetch(calls), log: () => {} });
  const snap = await svc.getSnapshot({ deadlineMs: 2000 });
  assert.equal(snap.home, null);
  assert.equal(snap.homeStatus, 'not-configured');
  assert.equal(snap.feeds['weather.alerts'].reason, 'no-home');
  assert.ok(!calls.some((u) => u.includes('api.weather.gov')));
});

test('keyed feeds report no-key without touching the network', async () => {
  const calls = [];
  const svc = createJarvisService({ env: { JARVIS_HOME_LAT: '40.73', JARVIS_HOME_LON: '-74.16' }, fetchText: failingFetch(calls), log: () => {} });
  const snap = await svc.getSnapshot({ deadlineMs: 2000 });
  for (const id of ['local.traffic', 'local.events', 'social.reddit', 'social.bluesky']) {
    assert.equal(snap.feeds[id].kind, 'unavailable', id);
    assert.equal(snap.feeds[id].reason, 'no-key', id);
  }
  assert.ok(!calls.some((u) => /tomtom|ticketmaster|reddit|bsky/.test(u)));
  assert.equal(snap.home.source, 'env');
});

test('an upstream failure is reported as unavailable with the reason — never zero-filled', async () => {
  const svc = createJarvisService({ env: { JARVIS_HOME_LAT: '40.73', JARVIS_HOME_LON: '-74.16' }, fetchText: failingFetch([], 429), log: () => {} });
  const snap = await svc.getSnapshot({ deadlineMs: 3000 });
  const markets = snap.feeds.markets;
  assert.equal(markets.kind, 'unavailable');
  assert.equal(markets.reason, 'rate-limited');
  assert.equal(markets.data, null);
  assert.ok(!snap.brief.some((i) => i.domain === 'money' && !i.id.startsWith('session')));
});

test('last-good data is served flagged stale when the upstream then fails', async () => {
  let t = Date.parse('2026-11-26T15:00:00Z');
  let up = true;
  const fng = JSON.stringify({ data: [{ value: '11', value_classification: 'Extreme Fear', timestamp: '1795651200' }] });
  const fetchText = async (url) => {
    if (url.includes('alternative.me') && up) return fng;
    throw new HttpError(503);
  };
  const svc = createJarvisService({ env: {}, fetchText, now: () => t, log: () => {} });
  const first = await svc.getSnapshot({ deadlineMs: 2000 });
  assert.equal(first.feeds['sentiment.cryptoFng'].kind, 'measured');
  assert.equal(first.feeds['sentiment.cryptoFng'].stale, false);
  up = false;
  t += 31 * 60_000; // past the 30-minute TTL
  const second = await svc.getSnapshot({ deadlineMs: 2000 });
  const f = second.feeds['sentiment.cryptoFng'];
  assert.equal(f.kind, 'measured');
  assert.equal(f.stale, true);
  assert.equal(f.staleReason, 'upstream-down');
  assert.equal(f.data.now.value, 11);
});

test('a feed that misses the deadline reports loading instead of holding the snapshot', async () => {
  const fetchText = (url) => (url.includes('alternative.me') ? new Promise(() => {}) : Promise.reject(new HttpError(503)));
  const svc = createJarvisService({ env: {}, fetchText, log: () => {} });
  const started = Date.now();
  const snap = await svc.getSnapshot({ deadlineMs: 150 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(snap.feeds['sentiment.cryptoFng'].reason, 'loading');
});

test('the host allowlist rejects anything off-list or non-https', () => {
  assert.doesNotThrow(() => assertAllowedUrl('https://api.weather.gov/alerts/active?point=1,2'));
  assert.throws(() => assertAllowedUrl('https://evil.example.com/'), /not allowlisted/);
  assert.throws(() => assertAllowedUrl('http://api.weather.gov/'), /not allowlisted/);
  assert.throws(() => assertAllowedUrl('https://169.254.169.254/latest/meta-data'), /not allowlisted/);
});

test('watchlist parsing keeps valid tickers only and dedupes against the default board', () => {
  const rows = parseWatchlist('PAR:PAR Technology, spy, MAD=X:USD/MAD, bad ticker!, ../etc/passwd');
  assert.deepEqual(rows.map((r) => [r.symbol, r.label]), [['PAR', 'PAR Technology'], ['MAD=X', 'USD/MAD']]);
});

test('local places come from env, else the geocoded municipality and county', () => {
  assert.deepEqual(homePlaces({ municipality: 'City of Example township', county: 'Example County' }, ''), ['Example', 'Example County']);
  assert.deepEqual(homePlaces({}, 'Springfield, Riverton'), ['Springfield', 'Riverton']);
  assert.match(localNewsQueries(['Springfield'], 'NJ').safety, /^\("Springfield"\) NJ \(police OR/);
});

test('reason vocabulary', () => {
  assert.equal(reasonFor(new HttpError(403)), 'auth-rejected');
  assert.equal(reasonFor(new HttpError(429)), 'rate-limited');
  assert.equal(reasonFor(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
  assert.equal(reasonFor(new Error('Unexpected NWS alerts payload')), 'bad-payload');
});
