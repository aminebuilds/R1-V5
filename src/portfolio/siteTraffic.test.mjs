import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSiteTraffic, haversineMeters, nearestFlowSegment } from './siteTraffic.js';
import { resetFlowTileCache } from '../data/flowTiles.js';

test('haversineMeters: same point is 0', () => {
  assert.equal(haversineMeters(40.1, -75.2, 40.1, -75.2), 0);
});

test('haversineMeters: roughly 111km per degree of latitude', () => {
  const d = haversineMeters(40, -75, 41, -75);
  assert.ok(Math.abs(d - 111_195) < 2000, `got ${d}`);
});

const SEGMENTS = [
  { coords: [[-75.2, 40.1], [-75.201, 40.101]], trafficLevel: 0.8, roadType: 'primary', closure: false },
  { coords: [[-75.5, 40.5]], trafficLevel: 0.2, roadType: 'secondary', closure: true },
];

test('nearestFlowSegment: picks the closer segment within range', () => {
  const nearest = nearestFlowSegment({ lat: 40.1, lon: -75.2 }, SEGMENTS, { maxDistanceM: 150 });
  assert.ok(nearest);
  assert.equal(nearest.roadType, 'primary');
  assert.equal(nearest.distanceM, 0);
});

test('nearestFlowSegment: null when nothing is within maxDistanceM', () => {
  const nearest = nearestFlowSegment({ lat: 0, lon: 0 }, SEGMENTS, { maxDistanceM: 150 });
  assert.equal(nearest, null);
});

test('nearestFlowSegment: null for empty/invalid input', () => {
  assert.equal(nearestFlowSegment(null, SEGMENTS), null);
  assert.equal(nearestFlowSegment({ lat: 40, lon: -75 }, []), null);
  assert.equal(nearestFlowSegment({ lat: NaN, lon: -75 }, SEGMENTS), null);
});

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('fetchSiteTraffic: invalid coordinates short-circuit to no-coverage without fetching', async () => {
  let called = false;
  const restore = stubFetch(async () => { called = true; return new Response('', { status: 200 }); });
  try {
    const result = await fetchSiteTraffic(NaN, -75.2);
    assert.deepEqual(result, { status: 'no-coverage' });
    assert.equal(called, false);
  } finally {
    restore();
  }
});

test('fetchSiteTraffic: a 503 (keyless dev environment) reports no-key', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response('', { status: 503 }));
  try {
    const result = await fetchSiteTraffic(40.1, -75.2);
    assert.equal(result.status, 'no-key');
  } finally {
    restore();
  }
});

test('fetchSiteTraffic: a tile that decodes to no segments reports no-coverage', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response('not a protobuf tile', { status: 200 }));
  try {
    const result = await fetchSiteTraffic(40.1, -75.2);
    assert.equal(result.status, 'no-coverage');
  } finally {
    restore();
  }
});

test('fetchSiteTraffic: a non-503 failure reports a generic error, not a fabricated reading', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response('', { status: 500 }));
  try {
    const result = await fetchSiteTraffic(40.1, -75.2);
    assert.equal(result.status, 'error');
  } finally {
    restore();
  }
});
