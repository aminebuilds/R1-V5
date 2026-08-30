import test from 'node:test';
import assert from 'node:assert/strict';

import { placesTextSearch } from './placesSearchClient.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('builds the expected query string and returns the places array', async () => {
  let capturedUrl = null;
  const restore = stubFetch(async (url) => {
    capturedUrl = String(url);
    return { ok: true, json: async () => ({ places: [{ id: 'a' }], error: null }) };
  });
  try {
    const places = await placesTextSearch('Torchy\'s Tacos', { biasLat: 30.3, biasLon: -97.7, radiusM: 20000 });
    assert.deepEqual(places, [{ id: 'a' }]);
    assert.ok(capturedUrl.startsWith('/api/google/text-search?'));
    assert.ok(capturedUrl.includes('lat=30.30000'));
    assert.ok(capturedUrl.includes('lon=-97.70000'));
    assert.ok(capturedUrl.includes('radiusM=20000'));
  } finally {
    restore();
  }
});

test('defaults bias to 0,0 and radius to 50000 when omitted', async () => {
  let capturedUrl = null;
  const restore = stubFetch(async (url) => {
    capturedUrl = String(url);
    return { ok: true, json: async () => ({ places: [], error: null }) };
  });
  try {
    await placesTextSearch('anything');
    assert.ok(capturedUrl.includes('lat=0'));
    assert.ok(capturedUrl.includes('lon=0'));
    assert.ok(capturedUrl.includes('radiusM=50000'));
  } finally {
    restore();
  }
});

test('throws with the server error message on a non-2xx response', async () => {
  const restore = stubFetch(async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate_limited' }) }));
  try {
    await assert.rejects(() => placesTextSearch('x'), /rate_limited/);
  } finally {
    restore();
  }
});

test('returns [] when the payload has no places array', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
  try {
    const places = await placesTextSearch('x');
    assert.deepEqual(places, []);
  } finally {
    restore();
  }
});
