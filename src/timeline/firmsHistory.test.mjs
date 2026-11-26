// src/timeline/firmsHistory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  binDetections,
  compactRow,
  createFirmsHistoryStore,
  decodeFirmsHistory,
  encodeFirmsHistory,
  historyDays,
  inBox,
  materializeFires,
  planChunks,
  rollingSum,
  utcDay,
  windowRange,
} from './firmsHistory.js';

const NOW = Date.UTC(2026, 10, 24, 14, 37);
const HOUR = 3_600_000;

function rec(acqDate, acqTime, extra = {}) {
  return {
    lat: 33.5, lon: 44.25, frp: 12.5, confidence: 'n', brightness: 330.4,
    daynight: 'D', acqDate, acqTime, satellite: 'N20', instrument: 'VIIRS', ...extra,
  };
}

test('historyDays keeps nine UTC days ending today', () => {
  const days = historyDays(NOW);
  assert.equal(days.length, 9);
  assert.equal(days[0], '2026-11-16');
  assert.equal(days[8], '2026-11-24');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(utcDay(Date.UTC(2026, 0, 1, 23, 59)), '2026-01-01');
});

test('planChunks splits contiguous runs into FIRMS-sized requests', () => {
  const days = historyDays(NOW);
  const all = planChunks(days, () => true);
  assert.deepEqual(all.map((c) => [c.start, c.range]), [['2026-11-16', 5], ['2026-11-21', 4]]);
  const gaps = planChunks(days, (d) => d !== '2026-11-18' && d !== '2026-11-19');
  assert.deepEqual(gaps.map((c) => [c.start, c.range]), [['2026-11-16', 2], ['2026-11-20', 5]]);
  assert.deepEqual(planChunks(days, () => false), []);
});

test('compactRow keeps measured fields and drops undated rows', () => {
  const row = compactRow(rec('2026-11-20', '45', { daynight: 'N', confidence: 'h' }));
  assert.deepEqual(row, [33.5, 44.25, Date.UTC(2026, 10, 20, 0, 45) / 60_000, 12.5, 330.4, 90, 1]);
  assert.equal(compactRow(rec('bad', '45')), null);
  assert.equal(compactRow(rec('2026-11-20', '45', { lat: 'x' })), null);
});

test('binary payload round-trips, sorted by acquisition time', () => {
  const rows = [
    { row: compactRow(rec('2026-11-21', '1200', { lat: 10, lon: 20, frp: 5 })), satellite: 'N21' },
    { row: compactRow(rec('2026-11-20', '0300', { lat: -5.5, lon: 179.9, daynight: 'N' })), satellite: 'N20' },
  ];
  const bytes = encodeFirmsHistory(rows, { version: 7 });
  const decoded = decodeFirmsHistory(bytes.buffer);
  assert.equal(decoded.count, 2);
  assert.equal(decoded.meta.version, 7);
  assert.equal(decoded.acqMinute[0] * 60_000, Date.UTC(2026, 10, 20, 3));
  assert.equal(decoded.acqMinute[1] * 60_000, Date.UTC(2026, 10, 21, 12));
  const fires = materializeFires(decoded, 0, 2);
  assert.equal(fires[0].satellite, 'N20');
  assert.equal(fires[0].night, true);
  assert.ok(Math.abs(fires[0].lon - 179.9) < 1e-4);
  assert.equal(fires[1].satellite, 'N21');
  assert.equal(fires[1].frp, 5);
  assert.equal(fires[1].index, 1);
  assert.ok(Math.abs(fires[1].brightness - 330.4) < 0.05);
  assert.equal(fires[1].confidence, 0.6);
});

test('decode refuses a foreign payload', () => {
  assert.throws(() => decodeFirmsHistory(new ArrayBuffer(16)), /not a FIRMS/);
});

test('windowRange is inclusive at both ends, like the live 24 h filter', () => {
  const minutes = [0, 60, 120, 180, 240].map((h) => Date.UTC(2026, 10, 20) / 60_000 + h);
  const acq = Uint32Array.from(minutes);
  const end = Date.UTC(2026, 10, 20, 3, 0);
  assert.deepEqual(windowRange(acq, end, 2 * HOUR), [1, 4]); // 01:00, 02:00, 03:00
  assert.deepEqual(windowRange(acq, Date.UTC(2026, 10, 19), HOUR), [0, 0]);
});

test('inBox handles antimeridian-crossing boxes', () => {
  const box = { west: 170, south: -10, east: -170, north: 10 };
  assert.equal(inBox(0, 175, box), true);
  assert.equal(inBox(0, -175, box), true);
  assert.equal(inBox(0, 0, box), false);
  assert.equal(inBox(20, 175, box), false);
  assert.equal(inBox(0, 0, null), true);
});

test('binDetections counts per hour inside a box; rollingSum nulls short windows', () => {
  const rows = [
    { row: compactRow(rec('2026-11-20', '0010', { lat: 1, lon: 1 })), satellite: 'N20' },
    { row: compactRow(rec('2026-11-20', '0050', { lat: 1, lon: 1 })), satellite: 'N20' },
    { row: compactRow(rec('2026-11-20', '0130', { lat: 50, lon: 50 })), satellite: 'N20' },
    { row: compactRow(rec('2026-11-20', '0230', { lat: 1, lon: 1 })), satellite: 'N20' },
  ];
  const decoded = decodeFirmsHistory(encodeFirmsHistory(rows).buffer);
  const start = Date.UTC(2026, 10, 20);
  const all = binDetections(decoded, { startMs: start, endMs: start + 3 * HOUR, binMs: HOUR });
  assert.deepEqual(all, [2, 1, 1]);
  const boxed = binDetections(decoded, {
    startMs: start, endMs: start + 3 * HOUR, binMs: HOUR, box: { west: 0, south: 0, east: 2, north: 2 },
  });
  assert.deepEqual(boxed, [2, 0, 1]);
  assert.deepEqual(rollingSum([2, 1, 1, 0], 2), [null, 3, 2, 1]);
});

function memoryIo() {
  const disk = new Map();
  return {
    disk,
    loadDay: async (day) => (disk.has(day) ? JSON.parse(disk.get(day)) : null),
    saveDay: async (day, obj) => { disk.set(day, JSON.stringify(obj)); },
  };
}

test('store backfills nine days in FIRMS-sized chunks and stops once days are final', async () => {
  let now = NOW;
  const calls = [];
  const io = memoryIo();
  const store = createFirmsHistoryStore({
    sources: ['A'],
    now: () => now,
    ...io,
    fetchChunk: async (source, start, range) => {
      calls.push(`${source}:${start}+${range}`);
      const out = [];
      for (let i = 0; i < range; i += 1) out.push(rec(addDays(start, i), '1200'));
      return out;
    },
  });
  await store.refresh();
  assert.deepEqual(calls, ['A:2026-11-16+5', 'A:2026-11-21+4']);
  const status = store.status();
  assert.equal(status.days.length, 9);
  assert.ok(status.days.every((d) => d.ok && d.count === 1));
  // Days that ended >6 h before the fetch are final (yesterday ended 14 h
  // ago); today is still open.
  assert.deepEqual(status.days.filter((d) => !d.final).map((d) => d.day), ['2026-11-24']);
  // Within TTL nothing is refetched; after it only the open days are.
  calls.length = 0;
  await store.refresh();
  assert.deepEqual(calls, []);
  now += 31 * 60_000;
  await store.refresh();
  assert.deepEqual(calls, ['A:2026-11-24+1']);
  assert.equal(io.disk.size, 9);
  const decoded = decodeFirmsHistory(store.encoded().buffer);
  assert.equal(decoded.count, 9);
});

test('a failed chunk is reported as a gap and keeps earlier rows', async () => {
  let fail = false;
  let now = NOW;
  const store = createFirmsHistoryStore({
    sources: ['A'],
    now: () => now,
    fetchChunk: async (source, start, range) => {
      if (fail) throw new Error('HTTP 500');
      const out = [];
      for (let i = 0; i < range; i += 1) out.push(rec(addDays(start, i), '0600'));
      return out;
    },
  });
  fail = true;
  await store.refresh();
  let status = store.status();
  assert.ok(status.days.every((d) => !d.ok));
  assert.equal(status.lastError, 'HTTP 500');
  assert.equal(decodeFirmsHistory(store.encoded().buffer).count, 0);
  fail = false;
  now += 31 * 60_000;
  await store.refresh();
  status = store.status();
  assert.ok(status.days.every((d) => d.ok));
  fail = true;
  now += 31 * 60_000;
  await store.refresh();
  status = store.status();
  const today = status.days.at(-1);
  assert.equal(today.ok, true, 'previous good answer survives a failed refetch');
  assert.equal(today.count, 1);
});

test('ingestLive folds the live proxy pull into the open days', async () => {
  const store = createFirmsHistoryStore({ sources: ['A'], now: () => NOW, fetchChunk: async () => [] });
  await store.ingestLive('A', [rec('2026-11-24', '0100'), rec('2026-11-23', '2300'), rec('2026-11-01', '0100')], NOW, ['2026-11-23', '2026-11-24']);
  const status = store.status();
  assert.equal(status.days.find((d) => d.day === '2026-11-24').count, 1);
  assert.equal(status.days.find((d) => d.day === '2026-11-23').count, 1);
  assert.equal(status.days.find((d) => d.day === '2026-11-20').ok, false);
});
