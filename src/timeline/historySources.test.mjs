// src/timeline/historySources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFirmsHistorySource,
  createQuakeHistorySource,
  featuresInWindow,
  rollingQuakeCounts,
  windowCoverage,
} from './historySources.js';
import { compactRow, encodeFirmsHistory } from './firmsHistory.js';

const H = 3_600_000;
const D = 24 * H;
const DAY0 = Date.UTC(2026, 10, 16);

function days(okFlags) {
  return okFlags.map((ok, i) => ({ startMs: DAY0 + i * D, ok }));
}

test('windowCoverage: full, partial across a gap, none inside a gap', () => {
  const list = days([true, true, false, true]);
  assert.equal(windowCoverage(list, DAY0 + 1.5 * D, D), 'full');
  assert.equal(windowCoverage(list, DAY0 + 2.5 * D, D), 'partial');
  assert.equal(windowCoverage(days([true, false, false]), DAY0 + 2.5 * D, 12 * H), 'none');
  assert.equal(windowCoverage([], DAY0, D), 'none');
});

test('windowCoverage: a window reaching before the first stored day is partial', () => {
  assert.equal(windowCoverage(days([true, true]), DAY0 + 12 * H, D), 'partial');
});

function quake(t, lat = 0, lon = 0) {
  return { properties: { time: t, mag: 3 }, geometry: { coordinates: [lon, lat, 10] } };
}

test('featuresInWindow is inclusive at both ends', () => {
  const list = [quake(0), quake(H), quake(2 * H), quake(3 * H)];
  assert.equal(featuresInWindow(list, 2 * H, H).length, 2);
  assert.deepEqual(featuresInWindow(null, 0, H), []);
});

test('rollingQuakeCounts is the 24 h count at each hour, boxed when asked', () => {
  const start = DAY0 + D;
  const list = [quake(DAY0 + 2 * H, 10, 10), quake(start + H + 5, 10, 10), quake(start + H + 9, -40, -40)];
  const all = rollingQuakeCounts(list, { startMs: start, endMs: start + 3 * H });
  // Bin i holds the 24 h ending at start + (i+1)h.
  assert.deepEqual(all, [1, 3, 2]);
  const boxed = rollingQuakeCounts(list, {
    startMs: start, endMs: start + 3 * H, box: { west: 0, south: 0, east: 20, north: 20 },
  });
  assert.deepEqual(boxed, [1, 2, 1]);
});

function response(body, { ok = true, status = 200, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
    arrayBuffer: async () => body,
  };
}

test('FIRMS source reports no-key and never downloads without one', async () => {
  const calls = [];
  const source = createFirmsHistorySource({
    fetchImpl: async (url) => { calls.push(url); return response({ status: 'no-key' }); },
  });
  await source.loadMeta();
  assert.equal(await source.loadData(), null);
  assert.deepEqual(calls, ['/api/firms/history']);
  assert.equal(source.windowFires(DAY0, D), null);
});

test('FIRMS source cuts the window from the downloaded detections', async () => {
  const rec = (acqTime) => ({
    lat: 1, lon: 2, frp: 3, confidence: 'h', brightness: 300, daynight: 'D',
    acqDate: '2026-11-20', acqTime, satellite: 'N20',
  });
  const bytes = encodeFirmsHistory(
    ['0100', '0500', '0900'].map((t) => ({ row: compactRow(rec(t)), satellite: 'N20' })),
    { version: 4 },
  );
  const source = createFirmsHistorySource({
    fetchImpl: async (url) => (url.endsWith('/data')
      ? response(bytes.buffer, { headers: { 'X-FIRMS-History-Version': '4' } })
      : response({ status: 'ready', version: 4, days: days([true]) })),
  });
  await source.loadMeta();
  await source.loadData();
  assert.equal(source.loaded, true);
  assert.equal(source.stale, false);
  const fires = source.windowFires(Date.UTC(2026, 10, 20, 6), 6 * H);
  assert.equal(fires.length, 2);
  assert.equal(fires[0].acqMs, Date.UTC(2026, 10, 20, 1));
});

test('quake source records its error instead of an empty catalogue', async () => {
  const source = createQuakeHistorySource({
    fetchImpl: async () => response(null, { ok: false, status: 503 }),
    now: () => DAY0,
  });
  await source.load();
  assert.equal(source.loaded, false);
  assert.equal(source.error, 'USGS HTTP 503');
  assert.equal(source.coverage(DAY0, D), 'none');
  assert.equal(source.windowFeatures(DAY0, D), null);
});
