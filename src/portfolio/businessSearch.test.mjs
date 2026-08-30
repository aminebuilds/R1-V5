import test from 'node:test';
import assert from 'node:assert/strict';

import { placeToSite, searchBusinessSites } from './businessSearch.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

const SAMPLE_PLACE = {
  id: 'places/abc123',
  name: "Torchy's Tacos",
  address: '1911 Aldrich St, Austin, TX',
  latitude: 30.2985,
  longitude: -97.7195,
};

test('placeToSite maps a Google place into a Site record', () => {
  const site = placeToSite(SAMPLE_PLACE, { importedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(site.id, 'site:place:places/abc123');
  assert.equal(site.name, "Torchy's Tacos");
  assert.equal(site.lat, 30.2985);
  assert.equal(site.lon, -97.7195);
  assert.equal(site.geocodeSource, 'places-search');
  assert.equal(site.externalRef, null);
});

test('placeToSite returns null for a place missing an id or coordinates', () => {
  assert.equal(placeToSite({ ...SAMPLE_PLACE, id: undefined }), null);
  assert.equal(placeToSite({ ...SAMPLE_PLACE, latitude: NaN }), null);
  assert.equal(placeToSite(null), null);
});

test('searchBusinessSites maps every usable result', async () => {
  const restore = stubFetch(async (url) => {
    assert.ok(String(url).includes(encodeURIComponent("Torchy's Tacos").replace(/%27/g, "'")) || String(url).includes('q='));
    return {
      ok: true,
      json: async () => ({
        places: [SAMPLE_PLACE, { ...SAMPLE_PLACE, id: 'places/def456', name: "Torchy's Tacos South" }],
        error: null,
      }),
    };
  });
  try {
    const { sites, error } = await searchBusinessSites("Torchy's Tacos", { biasLat: 30.3, biasLon: -97.7 });
    assert.equal(sites.length, 2);
    assert.equal(error, null);
  } finally {
    restore();
  }
});

test('searchBusinessSites reports no-results without throwing', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ places: [], error: null }) }));
  try {
    const { sites, error } = await searchBusinessSites('Nonexistent Business XYZ');
    assert.deepEqual(sites, []);
    assert.equal(error, 'no-results');
  } finally {
    restore();
  }
});

test('searchBusinessSites reports a search failure without throwing', async () => {
  const restore = stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: 'upstream_error' }) }));
  try {
    const { sites, error } = await searchBusinessSites('Torchy\'s Tacos');
    assert.deepEqual(sites, []);
    assert.equal(error, 'upstream_error');
  } finally {
    restore();
  }
});

test('searchBusinessSites rejects an empty query without calling fetch', async () => {
  let called = false;
  const restore = stubFetch(async () => { called = true; return { ok: true, json: async () => ({ places: [] }) }; });
  try {
    const { sites, error } = await searchBusinessSites('   ');
    assert.deepEqual(sites, []);
    assert.equal(error, 'empty-query');
    assert.equal(called, false);
  } finally {
    restore();
  }
});
