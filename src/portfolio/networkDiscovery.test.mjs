import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRAND_TAGS,
  MAX_TILE_DEG,
  VERTICAL_OSM_FILTERS,
  buildBrandTileQuery,
  dedupeSites,
  discoverBrandNetwork,
  escapeOverpassRegex,
  normalizeOverpassElement,
  resolveRegionBbox,
  tileBbox,
} from './networkDiscovery.js';

const US_BBOX = { south: 24.5, west: -125.0, north: 49.4, east: -66.9 };

test('tileBbox cuts a continent into tiles the Overpass proxy will accept', () => {
  const tiles = tileBbox(US_BBOX);
  assert.ok(tiles.length > 1, 'the continental US must not fit in one tile');
  for (const tile of tiles) {
    assert.ok(tile.north - tile.south <= MAX_TILE_DEG + 1e-9, 'tile is taller than the cap');
    assert.ok(tile.east - tile.west <= MAX_TILE_DEG + 1e-9, 'tile is wider than the cap');
    // The server rejects anything over 12 degrees a side; that is the whole
    // reason this function exists.
    assert.ok(tile.north - tile.south < 12);
    assert.ok(tile.east - tile.west < 12);
  }
});

test('tiles cover the full region without leaving a gap at the edges', () => {
  const tiles = tileBbox(US_BBOX);
  assert.equal(Math.min(...tiles.map((t) => t.south)), US_BBOX.south);
  assert.equal(Math.min(...tiles.map((t) => t.west)), US_BBOX.west);
  assert.equal(Math.max(...tiles.map((t) => t.north)), US_BBOX.north);
  assert.equal(Math.max(...tiles.map((t) => t.east)), US_BBOX.east);
});

test('a region smaller than one tile stays a single query', () => {
  assert.equal(tileBbox({ south: 30, west: -98, north: 31, east: -97 }).length, 1);
});

test('degenerate or inverted bounds produce no tiles rather than a bad query', () => {
  assert.deepEqual(tileBbox({ south: 40, west: 0, north: 30, east: 10 }), []);
  assert.deepEqual(tileBbox({ south: 1, west: 1, north: 1, east: 1 }), []);
  assert.deepEqual(tileBbox(null), []);
  assert.deepEqual(tileBbox({ south: 'x', west: 0, north: 1, east: 1 }), []);
});

test('brand names cannot break out of the Overpass regex literal', () => {
  // A quote or backslash would terminate the QL string; regex metacharacters
  // would silently change which sites match.
  assert.equal(escapeOverpassRegex('Casey"s'), 'Casey s');
  assert.equal(escapeOverpassRegex('Shell\\'), 'Shell');
  assert.equal(escapeOverpassRegex('BP.*'), 'BP');
  assert.equal(escapeOverpassRegex('  Chevron  '), 'Chevron');
  assert.equal(escapeOverpassRegex('(7|11)'), '7 11');
  assert.equal(escapeOverpassRegex(''), '');
});

test('every generated statement carries its own bbox bound', () => {
  const query = buildBrandTileQuery('Chevron', { south: 30, west: -98, north: 31, east: -97 }, ['["amenity"="fuel"]']);
  const statements = query.split('\n').filter((line) => /^\s*nwr/.test(line));
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(statement, /\(30\.0000,-98\.0000,31\.0000,-97\.0000\)/, 'statement lost its bbox');
  }
});

test('one query matches exactly one brand tag', () => {
  // Measured: brand and operator unioned in one request took 19.9s against a
  // 22s upstream abort. Split, each runs in 6-12s. If this ever collapses back
  // into one union, country-scale sweeps start failing tiles.
  for (const tag of BRAND_TAGS) {
    const query = buildBrandTileQuery('Chevron', { south: 0, west: 0, north: 1, east: 1 }, ['["amenity"="fuel"]'], tag);
    assert.ok(query.includes(`["${tag}"~"Chevron",i]`), `missing ${tag} selector`);
    for (const other of BRAND_TAGS.filter((t) => t !== tag)) {
      assert.ok(!query.includes(`["${other}"~`), `${tag} query must not also carry ${other}`);
    }
  }
});

test('name is never queried — the index is too large to survive the timeout', () => {
  assert.ok(!BRAND_TAGS.includes('name'));
  assert.equal(buildBrandTileQuery('Chevron', { south: 0, west: 0, north: 1, east: 1 }, [], 'name'), null);
  for (const tag of BRAND_TAGS) {
    const query = buildBrandTileQuery('Chevron', { south: 0, west: 0, north: 1, east: 1 }, ['["amenity"="fuel"]'], tag);
    assert.ok(!query.includes('["name"~'), 'a name regex would fail the tile, not slow it down');
  }
});

test('nwr covers nodes, ways and relations, with a center for polygons', () => {
  const query = buildBrandTileQuery('Chevron', { south: 0, west: 0, north: 1, east: 1 }, ['["amenity"="fuel"]']);
  assert.ok(query.includes('nwr["amenity"="fuel"]'));
  // `out center` is what gives a forecourt mapped as a polygon one coordinate.
  assert.match(query, /out center \d+;/);
});

test('the QL timeout stays under the proxy ceiling', () => {
  const query = buildBrandTileQuery('Shell', { south: 0, west: 0, north: 1, east: 1 }, []);
  const timeout = Number(query.match(/\[timeout:(\d+)\]/)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30, `timeout ${timeout} would be clamped or rejected`);
});

test('an unusable brand yields no query at all', () => {
  assert.equal(buildBrandTileQuery('', { south: 0, west: 0, north: 1, east: 1 }), null);
  assert.equal(buildBrandTileQuery('***', { south: 0, west: 0, north: 1, east: 1 }), null);
});

test('a vertical with no clean OSM tag falls back to brand-only, not a wrong tag', () => {
  // Mapping a vertical to a near-enough feature class would return real OSM
  // objects that are not the operator's sites — indistinguishable from fake.
  assert.equal(VERTICAL_OSM_FILTERS['agriculture-commodities'], undefined);
  const query = buildBrandTileQuery('Cargill', { south: 0, west: 0, north: 1, east: 1 }, []);
  assert.ok(query.includes('nwr["brand"~"Cargill",i]'));
  assert.ok(!query.includes('amenity'));
});

test('ways resolve through their center, nodes through their own coordinates', () => {
  assert.deepEqual(
    normalizeOverpassElement({ type: 'node', id: 7, lat: 30.1, lon: -97.2, tags: { brand: 'Chevron' } }),
    { id: 'node/7', lat: 30.1, lon: -97.2, tags: { brand: 'Chevron' } },
  );
  assert.deepEqual(
    normalizeOverpassElement({ type: 'way', id: 9, center: { lat: 30.5, lon: -97.5 }, tags: {} }),
    { id: 'way/9', lat: 30.5, lon: -97.5, tags: {} },
  );
  assert.equal(normalizeOverpassElement({ type: 'way', id: 9, tags: {} }), null);
  assert.equal(normalizeOverpassElement(null), null);
});

test('a station mapped as both a node and a polygon counts once', () => {
  const deduped = dedupeSites([
    { id: 'site:osm:node/1', lat: 30.26721, lon: -97.74311 },
    { id: 'site:osm:way/2', lat: 30.26719, lon: -97.74309 },
    { id: 'site:osm:node/3', lat: 31.0, lon: -97.0 },
  ]);
  assert.equal(deduped.length, 2);
});

test('sites without usable coordinates are dropped, never defaulted to 0,0', () => {
  const deduped = dedupeSites([
    { id: 'a', lat: null, lon: -97 },
    { id: 'b', lat: 30, lon: undefined },
    { id: 'c', lat: 30, lon: -97 },
  ]);
  assert.deepEqual(deduped.map((s) => s.id), ['c']);
});

test('an unresolvable region fails with a reason instead of sweeping somewhere arbitrary', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'region-not-found' }) });
  const result = await discoverBrandNetwork('Chevron', { region: 'Nowherestan', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'region-not-found');
  assert.deepEqual(result.sites, []);
});

test('a sweep reports real coverage and the OSM completeness caveat', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (String(url).startsWith('/api/geocode/region')) {
      return {
        ok: true,
        json: async () => ({ name: 'Texas', bbox: { south: 25.8, west: -106.7, north: 36.5, east: -93.5 } }),
      };
    }
    calls.push(options.body);
    return {
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: calls.length, lat: 30 + calls.length, lon: -97, tags: { brand: 'Chevron', amenity: 'fuel' } },
        ],
      }),
    };
  };

  const result = await discoverBrandNetwork('Chevron', {
    region: 'Texas',
    verticalId: 'fuel-convenience',
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.ok(result.sites.length > 0);
  assert.equal(result.coverage.region, 'Texas');
  assert.equal(result.coverage.brand, 'Chevron');
  assert.equal(result.coverage.source, 'openstreetmap-overpass');
  assert.match(result.coverage.completeness, /contributor-maintained/i);
  // The name-tag gap is a real hole in the count and has to travel with it.
  assert.match(result.coverage.completeness, /tagged only with a name is not counted/i);
  assert.equal(result.coverage.matchedOn, 'brand, operator');
  assert.equal(result.coverage.featureClass, '["amenity"="fuel"]');
  // Texas is wider than one tile, and each tile is swept once per brand tag.
  assert.ok(result.coverage.tilesTotal > 1);
  assert.equal(result.coverage.queriesRun, result.coverage.tilesTotal * BRAND_TAGS.length);
});

test('failed queries are counted rather than hidden behind a smaller total', async () => {
  // The difference between "this brand has no sites here" and "the sweep
  // broke" is the whole ballgame; a zero with no failure count asserts the
  // first when the second happened.
  let call = 0;
  const fetchImpl = async (url) => {
    if (String(url).startsWith('/api/geocode/region')) {
      return { ok: true, json: async () => ({ name: 'Texas', bbox: { south: 25, west: -106, north: 36, east: -94 } }) };
    }
    call += 1;
    if (call % 2 === 0) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ elements: [] }) };
  };
  const result = await discoverBrandNetwork('Chevron', { region: 'Texas', fetchImpl });
  assert.ok(result.coverage.queriesFailed > 0, 'a failed query must be visible in coverage');
  assert.equal(result.coverage.siteCount, 0);
});

test('resolveRegionBbox surfaces the proxy error instead of inventing bounds', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'No region found for "zzz"' }) });
  const result = await resolveRegionBbox('zzz', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.bbox, null);
  assert.match(result.error, /No region found/);
});
