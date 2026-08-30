import test from 'node:test';
import assert from 'node:assert/strict';

import { importSitesCsv } from './sitesCsv.js';

const CSV = [
  'name,address,lat,lon,format,externalRef',
  'Store A,123 Main St,40.1,-75.2,urban,S-1',
  'Store B,456 Oak Ave,,,,S-2',
  'Store C,,,,,',
  'Store D,789 Pine Rd,,,,S-4',
].join('\n');

test('rows with coordinates import without calling geocode', async () => {
  let calls = 0;
  const { sites, skipped } = await importSitesCsv(CSV, {
    geocode: async () => { calls++; return { lat: 1, lon: 1 }; },
    now: () => '2026-01-01T00:00:00.000Z',
  });
  assert.equal(sites.length, 3, 'Store A (has coords) + Store B + Store D (geocoded)');
  assert.equal(skipped.length, 1, 'Store C has neither address nor coords');
  assert.equal(skipped[0].reason, 'no-address-no-coordinates');
  assert.equal(calls, 2, 'geocode called once per unique address needing it');
});

test('a row with coordinates already present is never geocoded', async () => {
  const csv = 'name,address,lat,lon\nStore A,123 Main St,40.1,-75.2\n';
  let calls = 0;
  const { sites } = await importSitesCsv(csv, { geocode: async () => { calls++; return null; } });
  assert.equal(sites.length, 1);
  assert.equal(sites[0].lat, 40.1);
  assert.equal(calls, 0);
});

test('geocode failure skips with a reason, does not block other rows', async () => {
  const csv = 'name,address\nStore A,Bad Address\nStore B,Good Address\n';
  const { sites, skipped } = await importSitesCsv(csv, {
    geocode: async (address) => {
      if (address === 'Bad Address') throw new Error('boom');
      return { lat: 5, lon: 5 };
    },
  });
  assert.equal(sites.length, 1);
  assert.equal(sites[0].name, 'Store B');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].name, 'Store A');
  assert.equal(skipped[0].reason, 'geocode-error:boom');
});

test('geocode returning null (no results) skips with geocode-empty', async () => {
  const csv = 'name,address\nStore A,Nowhere\n';
  const { sites, skipped } = await importSitesCsv(csv, { geocode: async () => null });
  assert.equal(sites.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'geocode-empty');
});

test('rows sharing an identical address only trigger one geocode call', async () => {
  const csv = 'name,address\nStore A,Shared Address\nStore B,Shared Address\n';
  let calls = 0;
  const { sites } = await importSitesCsv(csv, {
    geocode: async () => { calls++; return { lat: 2, lon: 2 }; },
  });
  assert.equal(sites.length, 2);
  assert.equal(calls, 1);
});

test('missing geocode function skips address-only rows explicitly', async () => {
  const csv = 'name,address\nStore A,Some Address\n';
  const { sites, skipped } = await importSitesCsv(csv, {});
  assert.equal(sites.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'geocode-unavailable');
});
