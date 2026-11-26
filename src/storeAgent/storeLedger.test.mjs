// The store's book of record.
//
// Two properties carry this module and both are pinned here.
//
// DETERMINISM. Asking the same question twice about the same store on the
// same day must return the same answer. A console that contradicts itself
// thirty seconds into a conversation is worse than one that says nothing,
// and because every figure here derives from a seeded hash, the failure mode
// would be silent — numbers that look fine individually and differ between
// two readings nobody compares.
//
// PRORATION. A week-to-date rollup at 09:00 must not report today as
// catastrophically down purely because most of it has not happened yet.
// Both ends of the last comparison are cut to the same point in the trading
// day, and the daypart breakdown is cut per daypart rather than by the day's
// overall fraction — at 14:40 the AM rush is complete and the evening has
// not started.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  DAYPARTS,
  addDays,
  dayKey,
  dayPerformance,
  elapsedDayFraction,
  periodPerformance,
  prorateDay,
  seeded,
  storeProfile,
  weatherResponse,
} from './storeLedger.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store' };
const NOON = new Date('2026-09-21T12:00:00');

test('a seeded generator is stable across calls and distinct across keys', () => {
  const a = seeded('x', 'y').next();
  const b = seeded('x', 'y').next();
  assert.equal(a, b, 'the same key must produce the same sequence');
  assert.notEqual(a, seeded('x', 'z').next(), 'different keys must diverge');
});

test('a store keeps its character across every question asked about it', () => {
  const first = storeProfile(SITE);
  const second = storeProfile(SITE);
  assert.deepEqual(first, second);
  assert.notEqual(storeProfile({ id: 'site:test:002' }).insideBase, first.insideBase);
});

test("a site's own store number wins over a generated one", () => {
  // Answering about "Test Fuel #1204" and then calling it store #2937 tells
  // the room the number was invented.
  assert.equal(storeProfile(SITE).storeNumber, '1204');
  assert.equal(storeProfile({ id: 'x', name: 'Riverside Travel Plaza', externalRef: 'TC-88' }).storeNumber, '88');
  assert.match(storeProfile({ id: 'x', name: 'Riverside' }).storeNumber, /^\d{4}$/);
});

test('the same store on the same day reports identical figures', () => {
  const a = dayPerformance(SITE, NOON);
  const b = dayPerformance(SITE, new Date('2026-09-21T23:59:00'));
  assert.equal(a.date, b.date);
  assert.equal(a.insideTransactions, b.insideTransactions);
  assert.equal(a.totalSales, b.totalSales);
  assert.equal(a.loyaltyTransactions, b.loyaltyTransactions);
});

test('a trading day adds up: categories sum to inside sales, dayparts cover the clock', () => {
  const day = dayPerformance(SITE, NOON);
  const categorySum = day.categories.reduce((total, category) => total + category.sales, 0);
  assert.ok(Math.abs(categorySum - day.insideSales) < 0.5, 'inside sales must be the sum of its category lines');
  assert.equal(day.categories.length, CATEGORIES.length);
  assert.equal(day.dayparts.length, DAYPARTS.length);
  assert.equal(day.hours.length, 24);
  const daypartTransactions = day.dayparts.reduce((total, part) => total + part.insideTransactions, 0);
  const hourTransactions = day.hours.reduce((total, hour) => total + hour.insideTransactions, 0);
  assert.equal(daypartTransactions, hourTransactions, 'every hour must fall inside exactly one daypart');
  assert.equal(day.totalTransactions, day.insideTransactions + day.fuelTransactions);
});

test('weather moves the mix in the direction the format actually moves', () => {
  const hot = weatherResponse({ tempC: 33, condition: 'CLEAR', precipMm: 0 });
  assert.ok(hot.byCategory['packaged-bev'] > 1, 'heat lifts packaged beverage');
  assert.ok(hot.carWash > 1, 'heat lifts the wash');

  const wet = weatherResponse({ tempC: 14, condition: 'RAIN', precipMm: 3.2 });
  assert.ok(wet.carWash < 0.5, 'rain effectively takes the wash out');
  assert.ok(wet.inside < 1, 'rain pulls inside traffic down');
  assert.ok(wet.byCategory.dispensed > 1, 'rain lifts hot dispensed');

  const cold = weatherResponse({ tempC: 1, condition: 'CLEAR', precipMm: 0 });
  assert.ok(cold.byCategory.dispensed > 1 && cold.byCategory['packaged-bev'] < 1);

  const mild = weatherResponse({ tempC: 18, condition: 'CLEAR', precipMm: 0 });
  assert.equal(mild.inside, 1, 'a mild dry day moves nothing');
  assert.equal(mild.notes.length, 0);
});

test('elapsed day is measured in transactions, not clock hours', () => {
  const at = (time) => elapsedDayFraction(new Date(`2026-09-21T${time}:00`));

  // Wall-clock proration is wrong in both directions and this is the proof.
  // The overnight hours are nearly dead: a fifth of the clock has passed by
  // 05:00 and barely a twentieth of the trading.
  assert.ok(at('05:00') < 0.5 * (5 / 24), `overnight is over-counted by clock time: ${at('05:00')}`);

  // The morning peak is the opposite: three hours of clock, far more than
  // three hours of trading.
  const morningWindow = at('09:00') - at('06:00');
  assert.ok(morningWindow > 1.6 * (3 / 24), `the morning peak is under-counted by clock time: ${morningWindow}`);

  // Monotonic, bounded, and complete by end of day.
  assert.equal(at('00:00'), 0);
  assert.ok(at('23:59') > 0.98);
  let previous = -1;
  for (let hour = 0; hour < 24; hour += 1) {
    const value = at(String(hour).padStart(2, '0'));
    assert.ok(value >= previous, 'elapsed share must never go backwards');
    previous = value;
  }
});

test('proration cuts each daypart by its own elapsed share, not the day average', () => {
  const day = dayPerformance(SITE, NOON);
  const partial = prorateDay(day, new Date('2026-09-21T14:40:00'));

  assert.equal(partial.partial, true);
  assert.ok(partial.totalSales < day.totalSales);

  const amBefore = day.dayparts.find((part) => part.id === 'am-rush').insideTransactions;
  const amAfter = partial.dayparts.find((part) => part.id === 'am-rush').insideTransactions;
  assert.equal(amAfter, amBefore, 'the AM rush is over by 14:40 and must be reported whole');

  const eveningAfter = partial.dayparts.find((part) => part.id === 'evening').insideTransactions;
  assert.equal(eveningAfter, 0, 'the evening has not happened yet');

  const afternoon = partial.dayparts.find((part) => part.id === 'afternoon');
  assert.equal(afternoon.partial, true, '14:40 sits inside the afternoon window');

  assert.equal(partial.hours[20].insideTransactions, 0, 'future hours are zero, not scaled');
  assert.equal(partial.hours[20].future, true);
  assert.equal(partial.hours[9].insideTransactions, day.hours[9].insideTransactions, 'past hours are untouched');
});

test('a period compares like with like: same weekday, both sides cut to the same point', () => {
  const now = new Date('2026-09-21T14:40:00');
  const week = periodPerformance(SITE, { now, days: 7 });

  assert.equal(week.series.length, 7);
  assert.equal(week.to, dayKey(now));
  assert.equal(week.from, dayKey(addDays(now, -6)));

  const today = week.series[6];
  assert.equal(today.partial, true, 'today is incomplete and says so');
  assert.ok(Number.isFinite(today.priorTotalSales));

  // Both ends cut to the same point, so the delta is a real comparison
  // rather than an artefact of the clock. A full day against a 58% day
  // would show a ~40% collapse every single morning.
  assert.ok(Math.abs(today.salesDeltaPct) < 60, `today's delta looks like a proration artefact: ${today.salesDeltaPct}%`);

  // Same weekday on both sides of the comparison.
  for (let i = 0; i < 7; i += 1) {
    assert.equal(
      new Date(`${week.series[i].date}T12:00:00`).getDay(),
      new Date(`${dayKey(addDays(now, -(13 - i)))}T12:00:00`).getDay(),
      'each day must be compared against the same weekday a week earlier',
    );
  }
});

test('period totals are the sum of the series, and deltas are real subtractions', () => {
  const week = periodPerformance(SITE, { now: new Date('2026-09-21T23:00:00'), days: 7 });
  const summed = week.series.reduce((total, day) => total + day.totalTransactions, 0);
  assert.equal(week.totals.totalTransactions, Math.round(summed));

  const expected = ((week.totals.totalSales - week.priorTotals.totalSales) / week.priorTotals.totalSales) * 100;
  assert.ok(Math.abs(week.deltas.totalSales - Number(expected.toFixed(1))) < 0.05);
});

test('a period reading is stable when asked twice within the same hour', () => {
  const now = new Date('2026-09-21T14:40:00');
  const a = periodPerformance(SITE, { now, days: 7 });
  const b = periodPerformance(SITE, { now, days: 7 });
  assert.deepEqual(a.totals, b.totals);
  assert.equal(a.best.date, b.best.date);
});
