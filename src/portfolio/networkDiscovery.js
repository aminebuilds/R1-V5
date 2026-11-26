/**
 * @file Brand-scale site discovery — the path to a portfolio of thousands
 * without a CSV.
 *
 * `businessSearch.js` answers "what's near me" through Google Places: nearby
 * matches around one bias point, a few dozen at most. That is the wrong shape
 * for an operator who says "pull up my whole network" and owns 1,400 stores.
 *
 * This module answers the other question by sweeping OpenStreetMap instead.
 * OSM carries `brand` / `operator` tags on fuel stations, charging stations,
 * banks and the rest, so a brand's footprint across a whole state or country
 * is a real, queryable dataset — no scraping, no licensing problem, no
 * invented pins. The work is turning one region into bounded queries the
 * Overpass proxy will accept.
 *
 * WHAT THIS IS NOT. OSM completeness is contributor-driven and varies by
 * country and by brand. A sweep returns *what OSM knows*, which is a floor on
 * the operator's real estate, never a verified store list. Every result
 * carries that caveat in `coverage`, and callers must repeat it rather than
 * presenting the count as the operator's actual store count.
 *
 * @module portfolio/networkDiscovery
 */

import { osmNodeToSite } from './businessSearch.js';

/**
 * Server-side cap is 12° per bbox side (OVERPASS_MAX_BBOX_DEG). Tiles are cut
 * at 10° so a rounding error at the edge can never produce a rejected query.
 */
export const MAX_TILE_DEG = 10;

/** Concurrent tile queries. The proxy allows 6 overall; leave it room. */
const TILE_CONCURRENCY = 3;

/** Per-tile Overpass result cap. */
const PER_TILE_LIMIT = 2000;

/**
 * The tags a chain is identified by, and the reason `name` is not among them.
 *
 * Measured against the live Overpass mirrors on a 6°x6° Arizona tile:
 *
 *   nwr[amenity=fuel][brand~"Chevron",i]      249 results,  6.0 s
 *   nwr[amenity=fuel][operator~"Chevron",i]    14 results, 11.6 s
 *   nwr[amenity=fuel][name~"Chevron",i]         — timed out / 429 —
 *
 * `brand` and `operator` are sparse keys, so the index does the work. `name`
 * is on most objects in OSM, so a regex over it scans an enormous set and
 * blows past the proxy's 22 s upstream abort at every tile size tried,
 * including 1°x1°. Querying it would not be slower-but-complete; it would
 * fail the tile and return nothing.
 *
 * The consequence is stated in every sweep's `coverage.matchedOn`: a site
 * tagged `name=Chevron` with no `brand` tag will not be found. That is a real
 * gap in the result and belongs in the answer, not hidden behind a total.
 */
export const BRAND_TAGS = Object.freeze(['brand', 'operator']);

/** Total sites one sweep will return, however many tiles it took. */
export const SWEEP_SITE_LIMIT = 8000;

/**
 * OSM selectors that identify a physical site, per industry vertical.
 *
 * Verticals whose footprint has no clean, unambiguous OSM tag are deliberately
 * absent rather than mapped to a near-enough tag: a sweep that silently
 * searches the wrong feature class would return real OSM objects that are not
 * the operator's sites, which reads exactly like fabricated data. Those fall
 * back to a brand-name-only sweep, which the caller is told about.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const VERTICAL_OSM_FILTERS = Object.freeze({
  'fuel-convenience': Object.freeze(['["amenity"="fuel"]']),
  'automotive-ev': Object.freeze(['["amenity"="charging_station"]']),
  'airlines-aviation': Object.freeze(['["aeroway"="aerodrome"]']),
  'datacenters-cloud': Object.freeze(['["telecom"="data_center"]', '["building"="data_center"]']),
  'energy-utilities': Object.freeze(['["power"="plant"]', '["power"="substation"]']),
  'apparel-fashion': Object.freeze(['["shop"="clothes"]']),
  'banking-financial': Object.freeze(['["amenity"="bank"]']),
  'clinical-trials-healthcare': Object.freeze(['["amenity"="hospital"]', '["amenity"="clinic"]']),
});

/**
 * Split a bounding box into tiles no larger than `maxDeg` on either side.
 *
 * Pure, and the reason the sweep is possible at all: the Overpass proxy
 * rejects any bbox wider than 12°, and every interesting region (the US is
 * ~58° wide) exceeds that.
 *
 * @param {{south: number, west: number, north: number, east: number}} bbox
 * @param {number} [maxDeg]
 * @returns {Array<{south: number, west: number, north: number, east: number}>}
 */
export function tileBbox(bbox, maxDeg = MAX_TILE_DEG) {
  const south = Number(bbox?.south);
  const west = Number(bbox?.west);
  const north = Number(bbox?.north);
  const east = Number(bbox?.east);
  if (![south, west, north, east].every(Number.isFinite)) return [];
  if (north <= south || east <= west) return [];
  const step = Math.max(0.1, Number(maxDeg) || MAX_TILE_DEG);

  const tiles = [];
  for (let lat = south; lat < north; lat += step) {
    const tileNorth = Math.min(lat + step, north);
    for (let lon = west; lon < east; lon += step) {
      tiles.push({
        south: lat,
        west: lon,
        north: tileNorth,
        east: Math.min(lon + step, east),
      });
    }
  }
  return tiles;
}

/**
 * Escape a brand name for safe use inside an Overpass regex literal.
 * Overpass QL takes a POSIX regex in `~"..."`, so both regex metacharacters
 * and the quote/backslash that would break out of the literal are stripped.
 * @param {string} brand
 * @returns {string}
 */
export function escapeOverpassRegex(brand) {
  return String(brand || '')
    .replace(/[\\"]/g, ' ')
    .replace(/[.*+?^${}()|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build one bounded Overpass QL query: one brand tag, one tile.
 *
 * Deliberately ONE tag per query. Combining `brand` and `operator` into a
 * single union measured 19.9 s against a 22 s upstream abort — fast enough in
 * a test, not fast enough to rely on across a whole country. Split, each side
 * runs in 6-12 s and a slow tile fails alone instead of taking its partner
 * down with it.
 *
 * Every statement carries its own bbox — the proxy's sanitizer rejects any
 * unbounded selector, which is also what keeps a typo from requesting a
 * planet-scale scan.
 *
 * @param {string} brand
 * @param {{south: number, west: number, north: number, east: number}} tile
 * @param {ReadonlyArray<string>} [osmFilters] Feature-class selectors; empty means brand-tag-only.
 * @param {string} [tag] Which brand tag to match — one of BRAND_TAGS.
 * @returns {string|null} Overpass QL, or null if the brand is unusable.
 */
export function buildBrandTileQuery(brand, tile, osmFilters = [], tag = 'brand') {
  const safeBrand = escapeOverpassRegex(brand);
  if (!safeBrand) return null;
  if (!BRAND_TAGS.includes(tag)) return null;
  const box = `(${tile.south.toFixed(4)},${tile.west.toFixed(4)},${tile.north.toFixed(4)},${tile.east.toFixed(4)})`;

  // `nwr` covers node, way and relation in one statement, and `out center`
  // gives a forecourt mapped as a polygon the same single coordinate a node
  // already has.
  const classes = osmFilters.length > 0 ? osmFilters : [''];
  const statements = classes.map(
    (featureClass) => `  nwr${featureClass}["${tag}"~"${safeBrand}",i]${box};`,
  );

  return `[out:json][timeout:25];\n(\n${statements.join('\n')}\n);\nout center ${PER_TILE_LIMIT};`;
}

/**
 * Overpass returns ways with a `center`, nodes with `lat`/`lon`. Normalize to
 * the node shape `osmNodeToSite` already understands.
 * @param {object} element
 * @returns {object|null}
 */
export function normalizeOverpassElement(element) {
  if (!element?.id) return null;
  const lat = Number.isFinite(element.lat) ? element.lat : Number(element.center?.lat);
  const lon = Number.isFinite(element.lon) ? element.lon : Number(element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: `${element.type || 'node'}/${element.id}`,
    lat,
    lon,
    tags: element.tags || {},
  };
}

/**
 * Deduplicate sites that are the same physical place.
 *
 * OSM frequently carries a station as both a node (the pump) and a way (the
 * forecourt polygon), and tile edges can return a place twice. Both collapse
 * on a ~11 m coordinate grid.
 *
 * @param {object[]} sites
 * @returns {object[]}
 */
export function dedupeSites(sites) {
  const seen = new Set();
  const out = [];
  for (const site of sites) {
    if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const key = `${site.lat.toFixed(4)},${site.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(site);
  }
  return out;
}

/**
 * Resolve a region name ("Texas", "Spain", "United States") to its official
 * OSM bounding box through the server-side Nominatim proxy.
 *
 * @param {string} regionName
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{ok: boolean, name: string|null, bbox: object|null, error: string|null}>}
 */
export async function resolveRegionBbox(regionName, { signal, fetchImpl = fetch } = {}) {
  const query = String(regionName || '').trim();
  if (!query) return { ok: false, name: null, bbox: null, error: 'empty-region' };
  try {
    const res = await fetchImpl(`/api/geocode/region?q=${encodeURIComponent(query)}`, { signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.bbox) {
      return { ok: false, name: null, bbox: null, error: data?.error || 'region-not-found' };
    }
    return { ok: true, name: data.name || query, bbox: data.bbox, error: null };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { ok: false, name: null, bbox: null, error: error?.message || 'region-lookup-failed' };
  }
}

/**
 * Run one tile's query through the Overpass proxy.
 * @returns {Promise<{ok: boolean, elements: object[]}>}
 */
async function fetchTile(query, { signal, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!res.ok) return { ok: false, elements: [] };
    const data = await res.json().catch(() => null);
    return { ok: true, elements: Array.isArray(data?.elements) ? data.elements : [] };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { ok: false, elements: [] };
  }
}

/**
 * Sweep a whole region for one brand's sites.
 *
 * @param {string} brand Brand/operator name as the operator says it.
 * @param {object} [opts]
 * @param {string} [opts.region] Region name to sweep ("Texas", "United States").
 * @param {object} [opts.bbox] Explicit bbox, bypassing region lookup.
 * @param {string} [opts.verticalId] Industry vertical, selecting the OSM feature class.
 * @param {(progress: {done: number, total: number, found: number}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ok: boolean, sites: object[], coverage: object, error: string|null}>}
 */
export async function discoverBrandNetwork(brand, {
  region,
  bbox,
  verticalId,
  onProgress,
  signal,
  fetchImpl = fetch,
} = {}) {
  const brandName = String(brand || '').trim();
  if (!brandName) {
    return { ok: false, sites: [], coverage: emptyCoverage(), error: 'empty-brand' };
  }

  let searchBbox = bbox || null;
  let regionLabel = region || null;
  if (!searchBbox) {
    const resolved = await resolveRegionBbox(region, { signal, fetchImpl });
    if (!resolved.ok) {
      return { ok: false, sites: [], coverage: emptyCoverage(), error: resolved.error };
    }
    searchBbox = resolved.bbox;
    regionLabel = resolved.name;
  }

  const tiles = tileBbox(searchBbox);
  if (tiles.length === 0) {
    return { ok: false, sites: [], coverage: emptyCoverage(), error: 'invalid-region-bounds' };
  }

  const osmFilters = VERTICAL_OSM_FILTERS[verticalId] || [];
  const collected = [];
  let queriesRun = 0;
  let queriesFailed = 0;

  // One unit of work per (tile, brand tag) — see buildBrandTileQuery for why
  // the tags are not unioned into a single request.
  const queue = tiles.flatMap((tile) => BRAND_TAGS.map((tag) => ({ tile, tag })));
  const totalQueries = queue.length;

  const workers = Array.from({ length: Math.min(TILE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const unit = queue.shift();
      if (!unit) return;
      const query = buildBrandTileQuery(brandName, unit.tile, osmFilters, unit.tag);
      if (!query) continue;
      const { ok, elements } = await fetchTile(query, { signal, fetchImpl });
      queriesRun += 1;
      if (!ok) queriesFailed += 1;
      for (const element of elements) {
        const normalized = normalizeOverpassElement(element);
        if (!normalized) continue;
        const site = osmNodeToSite(normalized);
        if (site) collected.push(site);
      }
      onProgress?.({ done: queriesRun, total: totalQueries, found: collected.length });
    }
  });
  await Promise.all(workers);

  const sites = dedupeSites(collected).slice(0, SWEEP_SITE_LIMIT);

  return {
    ok: true,
    sites,
    coverage: {
      region: regionLabel,
      brand: brandName,
      tilesTotal: tiles.length,
      queriesRun,
      queriesFailed,
      siteCount: sites.length,
      truncated: collected.length > SWEEP_SITE_LIMIT,
      featureClass: osmFilters.length > 0 ? osmFilters.join(' | ') : 'brand-tag-only',
      matchedOn: BRAND_TAGS.join(', '),
      source: 'openstreetmap-overpass',
      // Said in every result because the count means something narrower than
      // it looks: OSM is contributor-maintained, so this is a floor on the
      // operator's footprint, not a verified store list.
      completeness: 'OpenStreetMap coverage is contributor-maintained and varies by country and brand. Matched on the brand and operator tags, so a site tagged only with a name is not counted. This is what OSM knows, not a verified store list.',
    },
    error: null,
  };
}

function emptyCoverage() {
  return {
    region: null,
    brand: null,
    tilesTotal: 0,
    queriesRun: 0,
    queriesFailed: 0,
    siteCount: 0,
    truncated: false,
    featureClass: null,
    matchedOn: BRAND_TAGS.join(', '),
    source: 'openstreetmap-overpass',
    completeness: null,
  };
}
