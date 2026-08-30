/**
 * @file Per-site traffic lookup for the site brief. No existing layer
 * exposes a "traffic near this point" query — `src/data/traffic.js` only
 * tracks the current camera viewport in private module state — so this adds
 * one small, honest function on top of the *existing* TomTom flow-tile
 * client (`src/data/flowTiles.js`), which already goes through the
 * `/api/tomtom/flow/{z}/{x}/{y}.pbf` proxy. No new server route.
 * @module portfolio/siteTraffic
 */

import { fetchFlowForBounds } from '../data/flowTiles.js';

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Find the flow segment whose nearest vertex is closest to `point`, within
 * `maxDistanceM`. Pure.
 * @param {{lat:number, lon:number}} point
 * @param {Array<{coords:number[][], trafficLevel:number, roadType:string, closure:boolean}>} segments
 * @param {{maxDistanceM?: number}} [opts]
 * @returns {({coords:number[][], trafficLevel:number, roadType:string, closure:boolean, distanceM:number})|null}
 */
export function nearestFlowSegment(point, segments, { maxDistanceM = 150 } = {}) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  if (!Array.isArray(segments) || segments.length === 0) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const segment of segments) {
    const coords = Array.isArray(segment?.coords) ? segment.coords : [];
    for (const vertex of coords) {
      const lon = vertex?.[0];
      const lat = vertex?.[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const distance = haversineMeters(point.lat, point.lon, lat, lon);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = segment;
      }
    }
  }
  if (!best || bestDistance > maxDistanceM) return null;
  return { ...best, distanceM: Math.round(bestDistance) };
}

const SITE_TRAFFIC_ZOOM = 16;
const SITE_TRAFFIC_MAX_DISTANCE_M = 180;
/** ~180m of latitude, generous enough to cover the query radius at the fetch bbox edge. */
const BBOX_DELTA_LAT_DEG = 0.0018;

function bboxAround(lat, lon) {
  const deltaLon = BBOX_DELTA_LAT_DEG / Math.max(0.15, Math.cos(toRad(lat)));
  return {
    south: lat - BBOX_DELTA_LAT_DEG,
    north: lat + BBOX_DELTA_LAT_DEG,
    west: lon - deltaLon,
    east: lon + deltaLon,
  };
}

/**
 * Fetch the nearest live traffic-flow reading to a site. Honest about
 * unavailability rather than inventing a number — in a dev environment with
 * no `TOMTOM_API_KEY` configured, the proxy 503s and this reports
 * `{status:'no-key'}` instead of `'ready'`.
 * @param {number} lat
 * @param {number} lon
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{status:'ready', trafficLevel:number, roadType:string, closure:boolean, distanceM:number}
 *   |{status:'no-key'|'no-coverage'|'error', message?:string}>}
 */
export async function fetchSiteTraffic(lat, lon, { signal } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { status: 'no-coverage' };

  let segments;
  try {
    segments = await fetchFlowForBounds(bboxAround(lat, lon), { signal, zoom: SITE_TRAFFIC_ZOOM });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const message = String(error?.message || '');
    if (/HTTP 503/.test(message)) return { status: 'no-key' };
    return { status: 'error', message: message || 'flow fetch failed' };
  }

  const nearest = nearestFlowSegment({ lat, lon }, segments, { maxDistanceM: SITE_TRAFFIC_MAX_DISTANCE_M });
  if (!nearest) return { status: 'no-coverage' };
  return {
    status: 'ready',
    trafficLevel: nearest.trafficLevel,
    roadType: nearest.roadType,
    closure: nearest.closure,
    distanceM: nearest.distanceM,
  };
}
