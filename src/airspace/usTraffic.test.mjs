import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOperator,
  departureBins,
  flightTableWindows,
  summarizeUsStates,
  usDepartureKeys,
  usRegion,
} from './usTraffic.js';

test('operator class comes from the callsign prefix and the US military block', () => {
  assert.equal(classifyOperator('a10e8b', 'UAL1420 '), 'us-airline');
  assert.equal(classifyOperator('ac972c', 'FDX1007'), 'cargo');
  assert.equal(classifyOperator('4075b4', 'VIR91U'), 'other-airline');
  assert.equal(classifyOperator('ae4b5c', 'WLFPCK21'), 'military');
  assert.equal(classifyOperator('a00000', 'RCH242'), 'military');
  assert.equal(classifyOperator('a3ecf8', 'N352HP'), 'ga');
  assert.equal(classifyOperator('a7cb89', 'LXJ601'), 'bizjet');
  assert.equal(classifyOperator('a00001', ''), 'unknown');
  assert.equal(classifyOperator('a00001', 'JANET51'), 'unknown');
});

test('US regions: lower 48 with coastal buffer, Alaska, Hawaii — not Canada or Mexico', () => {
  assert.equal(usRegion(33.64, -84.43), 'CONUS'); // ATL
  assert.equal(usRegion(37.62, -122.38), 'CONUS'); // SFO
  assert.equal(usRegion(61.17, -150.0), 'Alaska'); // ANC
  assert.equal(usRegion(21.32, -157.92), 'Hawaii'); // HNL
  assert.equal(usRegion(43.68, -79.63), null); // Toronto Pearson
  assert.equal(usRegion(49.19, -123.18), null); // Vancouver
  assert.equal(usRegion(19.44, -99.07), null); // Mexico City
  assert.equal(usRegion(null, -80), null);
});

test('a states/all body summarises to US airborne counts by region and class', () => {
  const body = {
    time: 1794621495,
    states: [
      ['a10e8b', 'UAL1420 ', 'United States', 0, 0, -86.28, 39.71, 1200, false, 120, 90, 8, null, 1250, '1234'],
      ['abf308', 'SWA4134 ', 'United States', 0, 0, -91.09, 38.17, 9266, false, 217, 214, 17, null, 9300, '7600'],
      ['a3ecf8', 'N352HP  ', 'United States', 0, 0, -111.97, 40.78, 0, true, 0, 0, 0, null, 0, null],
      ['c0ffee', 'ACA101  ', 'Canada', 0, 0, -79.63, 43.68, 3000, false, 150, 0, 0, null, 3000, null],
      ['a5d45d', 'ASA1042 ', 'United States', 0, 0, -157.9, 21.3, 2000, false, 120, 0, 2, null, 2000, null],
    ],
  };
  const summary = summarizeUsStates(body);
  assert.equal(summary.t, 1794621495000);
  assert.equal(summary.airborne, 3);
  assert.equal(summary.onGround, 1);
  assert.deepEqual(summary.byRegion, { CONUS: 2, Hawaii: 1 });
  assert.deepEqual(summary.byClass, { 'us-airline': 3 });
  assert.equal(summary.climbing, 1);
  assert.deepEqual(summary.emergencies, [{ callsign: 'SWA4134', squawk: '7600' }]);
  assert.equal(summarizeUsStates({ time: 1, states: null }), null);
});

const row = (icao24, firstSeenIso, airport, horiz = 2000) => ({
  icao24,
  firstSeen: Date.parse(firstSeenIso) / 1000,
  estDepartureAirport: airport,
  estDepartureAirportHorizDistance: horiz,
  estDepartureAirportVertDistance: 200,
});

test('departure bins count confident US takeoffs once, against the same half-hour a day earlier', () => {
  const records = [
    row('a1', '2026-11-13T20:05:00Z', 'KATL'),
    row('a1', '2026-11-13T20:05:00Z', 'KATL'), // the same flight from an adjacent window
    row('a2', '2026-11-13T20:20:00Z', 'PHNL'),
    row('a3', '2026-11-13T20:25:00Z', 'EGLL'), // not a US airport
    row('a4', '2026-11-13T20:10:00Z', 'KORD', 45_000), // first heard mid-air
    row('b1', '2026-11-12T20:01:00Z', 'KJFK'),
    row('b2', '2026-11-12T20:40:00Z', 'KLAX'),
  ];
  const bins = departureBins(records, { from: Date.parse('2026-11-13T20:00:00Z'), to: Date.parse('2026-11-13T21:00:00Z') });
  assert.deepEqual(bins.map((bin) => [new Date(bin.t).toISOString().slice(11, 16), bin.event, bin.baseline]), [
    ['20:00', 2, 1],
    ['20:30', 0, 1],
  ]);
  assert.deepEqual(usDepartureKeys(records).length, 5);
});

test('flight-table windows stay under the two-hour API limit and cover both days', () => {
  const windows = flightTableWindows({ from: Date.parse('2026-11-13T13:00:00Z'), to: Date.parse('2026-11-14T05:00:00Z') });
  assert.equal(windows.length, 16);
  for (const window of windows) assert.ok(window.end - window.begin < 7200);
  assert.equal(new Date(windows[0].begin * 1000).toISOString(), '2026-11-13T13:00:00.000Z');
  assert.equal(new Date(windows[8].begin * 1000).toISOString(), '2026-11-12T13:00:00.000Z');
});
