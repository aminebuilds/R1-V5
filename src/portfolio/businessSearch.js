/**
 * @file Search a business/brand name near a location and turn the matching
 * Google Places results directly into `Site` records — an alternative,
 * lighter path into the portfolio than CSV import (§07 "Ask" of the R.1
 * spec calls for natural-language discovery; this is the site-acquisition
 * half of that).
 *
 * Honest limitation: Google Places Text Search returns NEARBY matches around
 * a bias point, not an exhaustive nationwide chain locator — there is no free
 * API for "every location of X in the country" in one call. This searches
 * the area around the given bias (typically the current camera center) and
 * returns what Places finds there, same as a human typing the search into
 * Google Maps would get.
 * @module portfolio/businessSearch
 */

import { clip, MAX_ADDRESS_LEN, MAX_NAME_LEN } from './siteModel.js';
import { placesTextSearch } from './placesSearchClient.js';

/**
 * @param {object} place - One result from `placesTextSearch`.
 * @param {{importedAt?: string}} [opts]
 * @returns {object|null} A `Site` record, or null if the place lacks usable identity/coordinates.
 */
export function placeToSite(place, { importedAt } = {}) {
  if (!place?.id || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  return {
    id: `site:place:${place.id}`,
    orgId: 'org:default',
    bannerId: 'banner:default',
    regionId: 'region:default',
    externalRef: null,
    name: clip(String(place.name || 'Unnamed location'), MAX_NAME_LEN),
    address: clip(String(place.address || ''), MAX_ADDRESS_LEN),
    lat: place.latitude,
    lon: place.longitude,
    openedAt: null,
    format: null,
    importedAt: importedAt || new Date().toISOString(),
    geocodeSource: 'places-search',
  };
}

/**
 * Convert an OpenStreetMap / Overpass node to a Site record.
 * @param {object} node
 * @param {{importedAt?: string}} [opts]
 * @returns {object|null}
 */
export function osmNodeToSite(node, { importedAt } = {}) {
  if (!node?.id || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) return null;
  const tags = node.tags || {};
  const name = tags.name || tags.brand || 'Unnamed Location';
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || '';
  const state = tags['addr:state'] || '';
  const address = [street, city, state].filter(Boolean).join(', ') || tags['addr:full'] || `${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`;

  return {
    id: `site:osm:${node.id}`,
    orgId: 'org:default',
    bannerId: 'banner:default',
    regionId: 'region:default',
    externalRef: tags.ref || tags['brand:wikidata'] || null,
    name: clip(String(name), MAX_NAME_LEN),
    address: clip(String(address), MAX_ADDRESS_LEN),
    lat: node.lat,
    lon: node.lon,
    openedAt: null,
    format: tags.shop || tags.amenity || null,
    importedAt: importedAt || new Date().toISOString(),
    geocodeSource: 'osm-overpass',
  };
}

/**
 * Query Overpass API for multi-location brand nodes across a metro or region.
 * @param {string} brandName
 * @param {{biasLat?: number, biasLon?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<object[]>}
 */
export async function searchOverpassSites(brandName, { biasLat = 30.2672, biasLon = -97.7431, signal } = {}) {
  const brandClean = brandName.replace(/[^\w\s'-]/g, '').trim();
  if (!brandClean) return [];

  // 150km bounding box around bias coordinate
  const latDelta = 1.35;
  const lonDelta = 1.35;
  const south = (biasLat - latDelta).toFixed(4);
  const west = (biasLon - lonDelta).toFixed(4);
  const north = (biasLat + latDelta).toFixed(4);
  const east = (biasLon + lonDelta).toFixed(4);

  const query = `[out:json][timeout:8];
(
  node["name"~"${brandClean}",i](${south},${west},${north},${east});
  node["brand"~"${brandClean}",i](${south},${west},${north},${east});
);
out body 40;`;

  // Through the server proxy, never straight to overpass-api.de: SECURITY.md
  // requires every third-party fetch to go via Vite middleware, which is also
  // where the QL sanitizer, the shared cache, and the rate limiter live.
  try {
    const res = await fetch('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.elements) ? data.elements : [];
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

/**
 * Search for a business by name near a location and map every usable result
 * to a `Site`. Tries Google Places first, then augments with Overpass for broad coverage.
 * @param {string} query - Business/brand name, e.g. "Casey's" or "McDonald's".
 * @param {{biasLat?: number, biasLon?: number, signal?: AbortSignal, importedAt?: string}} [opts]
 * @returns {Promise<{sites: object[], error: string|null}>}
 */
export async function searchBusinessSites(query, { biasLat, biasLon, signal, importedAt } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return { sites: [], error: 'empty-query' };

  let places = [];
  let upstreamError = null;
  try {
    places = await placesTextSearch(trimmed, { biasLat, biasLon, signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // Remember *why* the search came back empty. Without this an upstream
    // outage reads to the operator as "this business has no locations here",
    // which is a materially different (and wrong) answer.
    upstreamError = error?.message || 'search-failed';
  }

  let sites = places.map((place) => placeToSite(place, { importedAt })).filter(Boolean);

  // If few or no results from Places API, query Overpass for regional brand coverage
  if (sites.length < 5) {
    try {
      const osmElements = await searchOverpassSites(trimmed, { biasLat, biasLon, signal });
      const osmSites = osmElements.map((el) => osmNodeToSite(el, { importedAt })).filter(Boolean);
      
      // Deduplicate by close proximity (within 100m)
      const existingCoords = new Set(sites.map((s) => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`));
      for (const osmSite of osmSites) {
        const key = `${osmSite.lat.toFixed(3)},${osmSite.lon.toFixed(3)}`;
        if (!existingCoords.has(key)) {
          existingCoords.add(key);
          sites.push(osmSite);
        }
      }
    } catch {}
  }

  // A partial result still counts as a result — only surface the upstream
  // failure when the fallback found nothing either.
  if (sites.length === 0) return { sites, error: upstreamError || 'no-results' };
  return { sites, error: null };
}
