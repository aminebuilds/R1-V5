import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketSession, nextTradingDate, tradingDay } from './marketCalendar.js';

const et = (local) => Date.parse(`${local}-05:00`); // November/December are EST

test('Thanksgiving 2026 is closed and the next session is the 1 pm early close', () => {
  const s = marketSession(et('2026-11-26T10:49:00'));
  assert.equal(s.state, 'closed');
  assert.equal(s.holiday, 'Thanksgiving Day');
  assert.deepEqual(s.nextOpen, { date: '2026-11-27', timeEt: '9:30 am', earlyClose: 'Day after Thanksgiving' });
  assert.deepEqual(s.upcomingEarlyCloses.map((e) => [e.date, e.closeEt]), [['2026-11-27', '1:00 pm']]);
});

test('early-close day: open until 1 pm, after hours past it, and the early close drops off once passed', () => {
  assert.equal(marketSession(et('2026-11-27T12:59:00')).state, 'open');
  const after = marketSession(et('2026-11-27T13:05:00'));
  assert.equal(after.state, 'post');
  assert.deepEqual(after.upcomingEarlyCloses, []);
});

test('regular sessions, pre-market and weekends', () => {
  assert.equal(marketSession(et('2026-12-01T09:00:00')).state, 'pre');
  assert.equal(marketSession(et('2026-12-01T15:59:00')).state, 'open');
  assert.equal(marketSession(et('2026-12-01T16:30:00')).state, 'post');
  assert.equal(marketSession(et('2026-11-28T12:00:00')).detail, 'Weekend');
  assert.equal(nextTradingDate('2026-12-24'), '2026-12-28');
});

test('years outside the transcribed calendar say so instead of guessing', () => {
  assert.equal(tradingDay('2028-03-01').covered, false);
  assert.equal(tradingDay('2026-03-02').covered, true);
});
