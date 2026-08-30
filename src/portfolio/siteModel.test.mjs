import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHeaderIndex, mergeSiteCoordinates, normalizeSiteRow, slugifySiteKey } from './siteModel.js';

const HEADER = ['name', 'address', 'lat', 'lon', 'format', 'externalRef'];

test('buildHeaderIndex is case-insensitive and trims', () => {
  const index = buildHeaderIndex(['Name', ' Address ', 'LAT']);
  assert.equal(index.get('name'), 0);
  assert.equal(index.get('address'), 1);
  assert.equal(index.get('lat'), 2);
});

test('normalizeSiteRow with full data', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const { site, error } = normalizeSiteRow(
    ['Store A', '123 Main St', '40.1', '-75.2', 'urban', 'S-100'],
    headerIndex,
    { importedAt: '2026-01-01T00:00:00.000Z' },
  );
  assert.equal(error, null);
  assert.equal(site.id, 'site:ext:s-100');
  assert.equal(site.name, 'Store A');
  assert.equal(site.address, '123 Main St');
  assert.equal(site.lat, 40.1);
  assert.equal(site.lon, -75.2);
  assert.equal(site.format, 'urban');
  assert.equal(site.externalRef, 'S-100');
  assert.equal(site.geocodeSource, 'csv');
  assert.equal(site.orgId, 'org:default');
});

test('normalizeSiteRow without externalRef derives a deterministic slug id', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const a = normalizeSiteRow(['Store B', '456 Oak Ave', '', '', '', ''], headerIndex, {});
  const b = normalizeSiteRow(['Store B', '456 Oak Ave', '', '', '', ''], headerIndex, {});
  assert.equal(a.error, null);
  assert.equal(a.site.id, b.site.id);
  assert.equal(a.site.lat, null);
  assert.equal(a.site.geocodeSource, null);
});

test('normalizeSiteRow rejects a row with no name', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const { site, error } = normalizeSiteRow(['', '123 Main St', '', '', '', ''], headerIndex, {});
  assert.equal(site, null);
  assert.equal(error, 'missing-name');
});

test('normalizeSiteRow rejects a row with neither address nor coordinates', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const { site, error } = normalizeSiteRow(['Store C', '', '', '', '', ''], headerIndex, {});
  assert.equal(site, null);
  assert.equal(error, 'no-address-no-coordinates');
});

test('normalizeSiteRow accepts coordinates with no address', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const { site, error } = normalizeSiteRow(['Store D', '', '40.1', '-75.2', '', ''], headerIndex, {});
  assert.equal(error, null);
  assert.equal(site.lat, 40.1);
  assert.equal(site.geocodeSource, 'csv');
});

test('slugifySiteKey is deterministic and collision-resistant for distinct inputs', () => {
  const a = slugifySiteKey('Store E', '789 Pine Rd');
  const b = slugifySiteKey('Store E', '789 Pine Rd');
  const c = slugifySiteKey('Store F', '789 Pine Rd');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('mergeSiteCoordinates is pure and sets geocodeSource', () => {
  const headerIndex = buildHeaderIndex(HEADER);
  const { site } = normalizeSiteRow(['Store G', '1 Elm St', '', '', '', ''], headerIndex, {});
  const merged = mergeSiteCoordinates(site, { lat: 10, lon: 20 });
  assert.equal(merged.lat, 10);
  assert.equal(merged.lon, 20);
  assert.equal(merged.geocodeSource, 'address');
  assert.equal(site.lat, null, 'original site object must not be mutated');
});
