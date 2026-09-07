/**
 * @file Which side of a road does a site sit on, relative to the direction
 * traffic is actually travelling?
 *
 * This is the difference between a detour a driver takes and one they don't.
 * A near-side site (right-hand kerb under right-hand traffic) is a pull-in;
 * a far-side site needs a left turn across a queue the driver is already
 * annoyed by, and converts at a fraction of the rate.
 *
 * Honest limitation, stated once and carried in the return value: TomTom flow
 * tiles encode each carriageway of a DIVIDED road as its own feature, so
 * coordinate order tracks the direction of travel and the test is sound. On an
 * undivided road both directions collapse into a single feature, coordinate
 * order is an arbitrary digitisation artefact, and the answer is
 * `'ambiguous'` — never a guess dressed up as a result.
 *
 * @module portfolio/approachSide
 */

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

/**
 * Project lon/lat to local planar metres around an origin. Accurate well
 * inside the sub-kilometre distances this module works at.
 * @param {number} lat
 * @param {number} lon
 * @param {number} lat0
 * @param {number} lon0
 * @returns {{x: number, y: number}} x east, y north, in metres.
 */
export function toLocalMeters(lat, lon, lat0, lon0) {
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return {
    x: (lon - lon0) * M_PER_DEG_LON_EQ * cosLat,
    y: (lat - lat0) * M_PER_DEG_LAT,
  };
}

/**
 * Closest edge of a polyline to a point, in local metres.
 * @param {number[][]} coords `[[lon, lat], …]`
 * @param {{lat: number, lon: number}} point
 * @returns {{a: {x:number,y:number}, b: {x:number,y:number}, p: {x:number,y:number}, distanceM: number}|null}
 */
export function closestEdge(coords, point) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;

  const lat0 = point.lat;
  const lon0 = point.lon;
  const p = { x: 0, y: 0 }; // the point is the projection origin
  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i] || [];
    const [lon2, lat2] = coords[i + 1] || [];
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) continue;

    const a = toLocalMeters(lat1, lon1, lat0, lon0);
    const b = toLocalMeters(lat2, lon2, lat0, lon0);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    // Perpendicular distance to the segment, clamped to its extent.
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { a, b, p, distanceM: dist };
    }
  }
  return best;
}

/**
 * Bearing of an edge in degrees clockwise from north.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number} 0–360
 */
export function edgeBearingDeg(a, b) {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0–180. */
export function bearingDelta(deg1, deg2) {
  const d = Math.abs(((deg1 - deg2) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Is this segment one carriageway of a divided road?
 *
 * True when another segment in the set runs roughly ANTIPARALLEL (within
 * `angleToleranceDeg` of a 180° reversal) and close by — the signature of a
 * dual carriageway split into two directional features. A single feature
 * carrying both directions has no such twin.
 *
 * @param {object} segment The segment under test (needs `coords`).
 * @param {object[]} allSegments Every segment fetched for the area.
 * @param {{maxSeparationM?: number, angleToleranceDeg?: number}} [opts]
 * @returns {boolean}
 */
export function hasOpposingCarriageway(segment, allSegments, {
  maxSeparationM = 60,
  angleToleranceDeg = 25,
} = {}) {
  const coords = segment?.coords;
  if (!Array.isArray(coords) || coords.length < 2) return false;

  const midIdx = Math.floor(coords.length / 2);
  const [midLon, midLat] = coords[Math.max(0, midIdx - 1)] || [];
  if (!Number.isFinite(midLat) || !Number.isFinite(midLon)) return false;

  const self = closestEdge(coords, { lat: midLat, lon: midLon });
  if (!self) return false;
  const selfBearing = edgeBearingDeg(self.a, self.b);

  for (const other of allSegments || []) {
    if (other === segment) continue;
    const otherEdge = closestEdge(other?.coords, { lat: midLat, lon: midLon });
    if (!otherEdge || otherEdge.distanceM > maxSeparationM) continue;
    const otherBearing = edgeBearingDeg(otherEdge.a, otherEdge.b);
    // Antiparallel: ~180° apart.
    if (Math.abs(bearingDelta(selfBearing, otherBearing) - 180) <= angleToleranceDeg) {
      return true;
    }
  }
  return false;
}

/**
 * Left-hand-traffic regions, as coarse bounding boxes.
 *
 * Approximate by construction — a bounding box is not a border. It is used
 * only to flip near/far side, and a wrong call downgrades a recommendation
 * rather than corrupting a measurement. Callers who know the country should
 * pass `drivingSide` explicitly instead of relying on this.
 * @type {Array<{name: string, south: number, west: number, north: number, east: number}>}
 */
export const LEFT_HAND_TRAFFIC_BOXES = Object.freeze([
  { name: 'UK & Ireland', south: 49.8, west: -11.0, north: 61.0, east: 2.0 },
  { name: 'Australia', south: -44.0, west: 112.0, north: -10.0, east: 154.0 },
  { name: 'New Zealand', south: -47.5, west: 166.0, north: -34.0, east: 179.0 },
  { name: 'Japan', south: 24.0, west: 122.0, north: 46.0, east: 146.0 },
  { name: 'India & neighbours', south: 5.0, west: 68.0, north: 36.0, east: 92.0 },
  { name: 'Southern Africa', south: -35.0, west: 11.0, north: -8.0, east: 41.0 },
  { name: 'Malaysia & Indonesia', south: -11.0, west: 95.0, north: 7.5, east: 141.0 },
  { name: 'Thailand', south: 5.5, west: 97.0, north: 20.5, east: 106.0 },
]);

/**
 * Approximate driving side for a coordinate.
 * @param {number} lat
 * @param {number} lon
 * @returns {'left'|'right'}
 */
export function drivingSideForCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'right';
  for (const box of LEFT_HAND_TRAFFIC_BOXES) {
    if (lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east) return 'left';
  }
  return 'right';
}

/**
 * Which side of the travelled direction does the site sit on?
 *
 * @param {{lat: number, lon: number}} site
 * @param {object} segment Flow segment: `{coords: [[lon,lat],…]}`.
 * @param {object[]} [allSegments] Full segment set, used to decide whether the
 *   road is divided. Without it, the result is always `'ambiguous'` — the
 *   divided/undivided question cannot be answered from one feature alone.
 * @param {{drivingSide?: 'left'|'right'}} [opts]
 * @returns {{
 *   side: 'left'|'right'|null,
 *   approach: 'near'|'far'|'ambiguous',
 *   bearingDeg: number|null,
 *   offsetM: number|null,
 *   divided: boolean,
 *   drivingSide: 'left'|'right'
 * }}
 */
export function approachSideForSite(site, segment, allSegments = null, { drivingSide } = {}) {
  const side = { side: null, approach: 'ambiguous', bearingDeg: null, offsetM: null, divided: false };
  const resolvedDrivingSide = drivingSide || drivingSideForCoords(site?.lat, site?.lon);
  const out = { ...side, drivingSide: resolvedDrivingSide };

  const edge = closestEdge(segment?.coords, site);
  if (!edge) return out;

  const bearingDeg = edgeBearingDeg(edge.a, edge.b);
  // Cross product of the travel vector with the vector to the site. Positive
  // means the site lies to the LEFT of the direction of travel.
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const sx = edge.p.x - edge.a.x;
  const sy = edge.p.y - edge.a.y;
  const cross = dx * sy - dy * sx;
  const geometricSide = cross > 0 ? 'left' : 'right';

  const divided = Array.isArray(allSegments) && allSegments.length > 0
    ? hasOpposingCarriageway(segment, allSegments)
    : false;

  return {
    ...out,
    side: geometricSide,
    // Only a divided carriageway licenses a near/far claim: there, coordinate
    // order is the direction of travel. Otherwise the geometry is real but its
    // meaning is not recoverable, and the caller must be told so.
    approach: divided
      ? (geometricSide === resolvedDrivingSide ? 'near' : 'far')
      : 'ambiguous',
    bearingDeg: Math.round(bearingDeg),
    offsetM: Math.round(edge.distanceM),
    divided,
  };
}
