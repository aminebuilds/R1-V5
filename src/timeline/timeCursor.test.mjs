// src/timeline/timeCursor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  HOUR_MS,
  computeDomain,
  createTimeCursor,
  formatCursorUtc,
  formatOffset,
  parseTimeParam,
  snapToStep,
} from './timeCursor.js';

const NOW = Date.UTC(2026, 10, 24, 14, 37); // 24 Nov 2026 14:37Z

test('snapToStep floors to UTC hour boundaries', () => {
  assert.equal(snapToStep(NOW, HOUR_MS), Date.UTC(2026, 10, 24, 14, 0));
  assert.ok(Number.isNaN(snapToStep(NaN)));
});

test('computeDomain spans seven days back from now, start on an hour', () => {
  const d = computeDomain(NOW);
  assert.equal(d.endMs, NOW);
  assert.equal(d.startMs, Date.UTC(2026, 10, 17, 14, 0));
  assert.equal(d.stepMs, HOUR_MS);
});

test('parseTimeParam reads ISO, epoch ms and relative offsets', () => {
  assert.equal(parseTimeParam('2026-11-20T06:00Z', NOW), Date.UTC(2026, 10, 20, 6));
  assert.equal(parseTimeParam(String(NOW), NOW), NOW);
  assert.equal(parseTimeParam('-36h', NOW), NOW - 36 * HOUR_MS);
  assert.equal(parseTimeParam('-2d', NOW), NOW - 2 * DAY_MS);
  assert.equal(parseTimeParam('-90m', NOW), NOW - 90 * 60_000);
});

test('parseTimeParam refuses junk instead of guessing', () => {
  for (const bad of ['', null, undefined, '1', 'yesterday', '+2d', 'abc-2d']) {
    assert.equal(parseTimeParam(bad, NOW), null, String(bad));
  }
});

test('formatters print UTC and the offset behind now', () => {
  assert.equal(formatCursorUtc(Date.UTC(2026, 10, 22, 9, 0)), '22 NOV 09:00Z');
  assert.equal(formatOffset(NOW - (2 * DAY_MS + 4 * HOUR_MS), NOW), '−2D 04H');
  assert.equal(formatOffset(NOW - 5 * HOUR_MS, NOW), '−5H');
  assert.equal(formatOffset(NOW, NOW), 'NOW');
  assert.equal(formatOffset(NOW - 20 * 60_000, NOW), '−20M');
});

test('cursor starts live and parks on hour steps', () => {
  const cursor = createTimeCursor({ now: () => NOW });
  assert.equal(cursor.getState().live, true);
  const parked = cursor.setCursor(Date.UTC(2026, 10, 21, 8, 42));
  assert.equal(parked.live, false);
  assert.equal(parked.cursorMs, Date.UTC(2026, 10, 21, 8, 0));
});

test('cursor clamps to the domain start and resolves "now" to live', () => {
  const cursor = createTimeCursor({ now: () => NOW });
  assert.equal(cursor.setCursor(NOW - 30 * DAY_MS).cursorMs, Date.UTC(2026, 10, 17, 14, 0));
  assert.equal(cursor.setCursor(NOW + HOUR_MS).live, true);
  assert.equal(cursor.setCursor(NOW).live, true);
});

test('stepBy walks back from live onto the last full hour, forward to live', () => {
  const cursor = createTimeCursor({ now: () => NOW });
  const back = cursor.stepBy(-1);
  assert.equal(back.live, false);
  assert.equal(back.cursorMs, Date.UTC(2026, 10, 24, 14, 0));
  assert.equal(cursor.stepBy(-2).cursorMs, Date.UTC(2026, 10, 24, 12, 0));
  cursor.stepBy(2);
  assert.equal(cursor.getState().live, false);
  assert.equal(cursor.stepBy(1).live, true);
});

test('subscribers hear changes once and not for no-ops', () => {
  const cursor = createTimeCursor({ now: () => NOW });
  const seen = [];
  const off = cursor.subscribe((s) => seen.push(s.live ? 'live' : s.cursorMs));
  cursor.setCursor(Date.UTC(2026, 10, 20, 3, 15));
  cursor.setCursor(Date.UTC(2026, 10, 20, 3, 50)); // same hour → no publish
  cursor.goLive();
  cursor.goLive(); // already live → no publish
  off();
  cursor.setCursor(Date.UTC(2026, 10, 20, 3, 0));
  assert.deepEqual(seen, [Date.UTC(2026, 10, 20, 3, 0), 'live']);
});

test('a parked cursor survives the clock moving on', () => {
  let now = NOW;
  const cursor = createTimeCursor({ now: () => now });
  cursor.setCursor(Date.UTC(2026, 10, 22, 0, 0));
  now += 3 * HOUR_MS;
  const state = cursor.tick();
  assert.equal(state.live, false);
  assert.equal(state.cursorMs, Date.UTC(2026, 10, 22, 0, 0));
  assert.equal(state.endMs, now);
});
