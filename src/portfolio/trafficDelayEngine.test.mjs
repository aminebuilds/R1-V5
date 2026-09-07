import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsAroundPoint,
  calculatePolylineLengthM,
  analyzeSegmentDelay,
  fetchTrafficDelays,
  emptyDelays,
} from './trafficDelayEngine.js';

test('boundsAroundPoint computes valid bounding box', () => {
  const b = boundsAroundPoint(30.2672, -97.7431, 5);
  assert.ok(b.north > b.south);
  assert.ok(b.east > b.west);
  assert.ok(b.north > 30.2672);
  assert.ok(b.south < 30.2672);
});

test('calculatePolylineLengthM calculates distance in meters', () => {
  const coords = [
    [-97.7431, 30.2672],
    [-97.7431, 30.2772], // ~1.11 km north
  ];
  const len = calculatePolylineLengthM(coords);
  assert.ok(len > 1000 && len < 1250, `Expected ~1113m, got ${len}`);
});

test('analyzeSegmentDelay correctly flags congestion and computes delay', () => {
  const normalSegment = {
    roadType: 'motorway',
    trafficLevel: 0.1,
    closure: false,
    coords: [
      [-97.74, 30.26],
      [-97.74, 30.27],
    ],
  };
  const normalRes = analyzeSegmentDelay(normalSegment);
  assert.equal(normalRes.isClosure, false);
  assert.ok(normalRes.frustrationScore < 40);

  const jammedSegment = {
    roadType: 'motorway',
    trafficLevel: 0.95,
    closure: false,
    coords: [
      [-97.74, 30.26],
      [-97.74, 30.27],
    ],
  };
  const jamRes = analyzeSegmentDelay(jammedSegment);
  assert.ok(jamRes.delayMin > 0);
  assert.ok(jamRes.frustrationScore >= 75);
  assert.equal(jamRes.isConstruction, true);
});

test('fetchTrafficDelays reports unavailability instead of simulating corridors', async () => {
  // No TomTom reachable from the test runner. The engine used to answer this
  // with six invented corridors ("Main Arterial", +22.5 min, index 78/100)
  // returned as status 'ready' — indistinguishable downstream from measured
  // traffic.
  const res = await fetchTrafficDelays(30.2672, -97.7431, { radiusKm: 4 });
  assert.ok(['no-key', 'no-coverage', 'error'].includes(res.status));
  assert.equal(res.confidence, 'unavailable');
  assert.deepEqual(res.delays, []);
  assert.deepEqual(res.bottlenecks, []);
  assert.deepEqual(res.constructionZones, []);
  // Every corridor figure is null, never a plausible-looking zero.
  for (const value of Object.values(res.corridorSummary)) {
    assert.equal(value, null);
  }
  assert.match(res.readout, /TRAFFIC —/);
});

test('emptyDelays never reports a numeric corridor summary', () => {
  for (const status of ['no-key', 'no-coverage', 'error']) {
    const res = emptyDelays(status);
    assert.equal(res.status, status);
    assert.equal(res.confidence, 'unavailable');
    assert.equal(res.corridorSummary.overallCongestionScore, null);
    assert.equal(res.corridorSummary.maxDelayMin, null);
  }
});

test('invalid coordinates are a no-coverage state, not a zeroed reading', async () => {
  const res = await fetchTrafficDelays(NaN, NaN);
  assert.equal(res.status, 'no-coverage');
  assert.equal(res.corridorSummary.averageDelayMin, null);
});
