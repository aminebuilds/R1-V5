import test from 'node:test';
import assert from 'node:assert/strict';

import { geocodeAddress } from './geocodeClient.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('returns lat/lon from the first place result', async () => {
  const restore = stubFetch(async (url) => {
    assert.ok(String(url).startsWith('/api/google/text-search?'));
    return {
      ok: true,
      json: async () => ({ places: [{ latitude: 40.1, longitude: -75.2 }], error: null }),
    };
  });
  try {
    const result = await geocodeAddress('123 Main St', { biasLat: 40, biasLon: -75 });
    assert.deepEqual(result, { lat: 40.1, lon: -75.2 });
  } finally {
    restore();
  }
});

test('returns null when there are no results', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ places: [], error: null }) }));
  try {
    const result = await geocodeAddress('Nowhere');
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test('throws with the server error message on a non-2xx response', async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'rate_limited', places: [] }),
  }));
  try {
    await assert.rejects(() => geocodeAddress('123 Main St'), /rate_limited/);
  } finally {
    restore();
  }
});
