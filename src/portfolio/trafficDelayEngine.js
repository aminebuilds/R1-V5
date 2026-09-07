/**
 * @file Real-Time Traffic Delays, Bottlenecks & Road Construction Detection Engine.
 * 
 * Ingests live road flow tiles (TomTom relative flow proxy) and identifies:
 *  - Severe congestion and stop-and-go gridlock (speed ratio < 0.35).
 *  - Road closures, construction bottlenecks, and lane blockages.
 *  - Estimated delay in minutes per corridor and commuter frustration index.
 *  - High-friction zones for the "Cool-Off" conversion engine.
 * 
 * @module portfolio/trafficDelayEngine
 */

import { fetchFlowForBounds } from '../data/flowTiles.js';
import { haversineMeters } from './siteTraffic.js';

/** Free-flow baseline speeds in meters/sec by road category */
const FREEFLOW_SPEED_MPS = {
  motorway: 30.0, // ~108 km/h / 67 mph
  trunk: 25.0,    // ~90 km/h / 55 mph
  primary: 18.0,  // ~65 km/h / 40 mph
  secondary: 14.0,// ~50 km/h / 30 mph
  tertiary: 10.0, // ~36 km/h / 22 mph
  residential: 7.0, // ~25 km/h / 15 mph
  other: 10.0,
};

/** Empty, honestly-labelled result. There is no simulated fallback by design. */
export function emptyDelays(status, message) {
  const readout = {
    'no-key': 'TRAFFIC — NO KEY. TomTom flow is unconfigured; no congestion data available.',
    'no-coverage': 'TRAFFIC — NO COVERAGE. No flow segments returned for this area.',
    error: `TRAFFIC — UNAVAILABLE.${message ? ` ${message}` : ''}`,
  }[status] || 'TRAFFIC — UNAVAILABLE.';
  return {
    status,
    ...(message ? { message } : {}),
    delays: [],
    bottlenecks: [],
    constructionZones: [],
    corridorSummary: {
      averageDelayMin: null,
      severeCorridorsCount: null,
      constructionCount: null,
      maxDelayMin: null,
      overallCongestionScore: null,
    },
    confidence: 'unavailable',
    readout,
  };
}

/**
 * Compute the bounding box around a center point with a given radius in km.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusKm
 * @returns {{ south: number, north: number, west: number, east: number }}
 */
export function boundsAroundPoint(lat, lon, radiusKm = 6) {
  const deltaLat = radiusKm / 111.32;
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const deltaLon = radiusKm / (111.32 * cosLat);
  return {
    south: lat - deltaLat,
    north: lat + deltaLat,
    west: lon - deltaLon,
    east: lon + deltaLon,
  };
}

/**
 * Calculate length of polyline in meters.
 * @param {number[][]} coords Array of [lon, lat]
 * @returns {number}
 */
export function calculatePolylineLengthM(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    if (Number.isFinite(lat1) && Number.isFinite(lon1) && Number.isFinite(lat2) && Number.isFinite(lon2)) {
      total += haversineMeters(lat1, lon1, lat2, lon2);
    }
  }
  return total;
}

/**
 * Classify a road segment delay and frustration level.
 * @param {{ coords: number[][], trafficLevel: number, roadType: string, closure: boolean }} segment
 * @returns {object|null}
 */
export function analyzeSegmentDelay(segment) {
  if (!segment || !Array.isArray(segment.coords) || segment.coords.length < 2) return null;

  const roadType = String(segment.roadType || 'primary').toLowerCase();
  const freeflowMps = FREEFLOW_SPEED_MPS[roadType] || FREEFLOW_SPEED_MPS.other;
  const trafficLevel = Math.max(0, Math.min(1, Number(segment.trafficLevel) || 0));
  const isClosure = Boolean(segment.closure);

  // Speed ratio: 1.0 = freeflow, 0.1 = complete crawl
  // TomTom trafficLevel: 0 = clear, 1.0 = severe jam
  const speedRatio = isClosure ? 0.05 : Math.max(0.1, 1 - trafficLevel * 0.88);
  const actualSpeedMps = freeflowMps * speedRatio;
  const lengthM = calculatePolylineLengthM(segment.coords);

  const freeflowTimeSec = lengthM / freeflowMps;
  const actualTimeSec = lengthM / actualSpeedMps;
  const delaySec = Math.max(0, actualTimeSec - freeflowTimeSec);
  const delayMin = Math.round((delaySec / 60) * 10) / 10;

  // Frustration / Annoyance Index (0-100)
  let frustrationScore = 0;
  let delayStatus = 'Normal Flow';
  let isConstruction = isClosure || (trafficLevel > 0.8 && ['motorway', 'trunk', 'primary'].includes(roadType));

  if (isClosure) {
    frustrationScore = 95;
    delayStatus = 'Road Closed / Construction';
  } else if (trafficLevel > 0.75) {
    frustrationScore = Math.min(100, Math.round(75 + delayMin * 3));
    delayStatus = 'Severe Gridlock / Major Delay';
  } else if (trafficLevel > 0.45) {
    frustrationScore = Math.min(75, Math.round(40 + delayMin * 2));
    delayStatus = 'Moderate Slowdown';
  } else {
    frustrationScore = Math.round(trafficLevel * 30);
    delayStatus = 'Light Delay';
  }

  // Midpoint coordinate of the segment
  const midIdx = Math.floor(segment.coords.length / 2);
  const [midLon, midLat] = segment.coords[midIdx] || [0, 0];

  return {
    roadType,
    lengthM: Math.round(lengthM),
    trafficLevel,
    speedMps: Math.round(actualSpeedMps * 10) / 10,
    speedMph: Math.round(actualSpeedMps * 2.23694),
    delayMin,
    frustrationScore,
    delayStatus,
    isClosure,
    isConstruction,
    midLat,
    midLon,
    coords: segment.coords,
  };
}

/**
 * Fetch and analyze all live traffic delays and construction bottlenecks around a target area.
 * 
 * @param {number} lat
 * @param {number} lon
 * @param {{ radiusKm?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{
 *   status: 'ready'|'no-key'|'no-coverage'|'error',
 *   delays: object[],
 *   bottlenecks: object[],
 *   constructionZones: object[],
 *   corridorSummary: {
 *     averageDelayMin: number,
 *     severeCorridorsCount: number,
 *     constructionCount: number,
 *     maxDelayMin: number,
 *     overallCongestionScore: number
 *   },
 *   confidence: 'measured-flow'|'unavailable',
 *   readout: string
 * }>}
 *   There is no simulated fallback: when TomTom is unconfigured or returns
 *   nothing, the status says so and every corridor figure is `null`.
 */
export async function fetchTrafficDelays(lat, lon, { radiusKm = 6, signal } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return emptyDelays('no-coverage', 'Invalid target coordinates');
  }

  const bounds = boundsAroundPoint(lat, lon, radiusKm);
  let rawSegments = [];
  try {
    rawSegments = await fetchFlowForBounds(bounds, { signal, zoom: 15 });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // A missing TOMTOM_API_KEY 503s at the proxy. Report that as its own state:
    // an invented bottleneck reads identically to a measured one downstream,
    // and the cool-off engine would then recommend a promo for a jam that
    // does not exist.
    const message = String(error?.message || '');
    return emptyDelays(/HTTP 503/.test(message) ? 'no-key' : 'error', message);
  }

  if (!rawSegments || rawSegments.length === 0) {
    return emptyDelays('no-coverage');
  }

  const analyzed = rawSegments
    .map(analyzeSegmentDelay)
    .filter(Boolean);

  const bottlenecks = analyzed
    .filter((s) => s.frustrationScore >= 60 || s.delayMin >= 3.0)
    .sort((a, b) => b.frustrationScore - a.frustrationScore);

  const constructionZones = analyzed.filter((s) => s.isConstruction || s.isClosure);

  const totalDelay = analyzed.reduce((acc, s) => acc + s.delayMin, 0);
  const avgDelay = analyzed.length ? Math.round((totalDelay / analyzed.length) * 10) / 10 : 0;
  const maxDelay = bottlenecks.length ? bottlenecks[0].delayMin : 0;
  const severeCount = bottlenecks.length;
  const overallCongestion = Math.min(100, Math.round(severeCount * 8 + avgDelay * 12));

  const readout = `TRAFFIC — ${analyzed.length} segments measured across ${radiusKm} km. ${severeCount} severe bottleneck${severeCount === 1 ? '' : 's'}, ${constructionZones.length} closure/construction zone${constructionZones.length === 1 ? '' : 's'}. Max corridor delay +${maxDelay} min. Congestion index ${overallCongestion}/100.`;

  return {
    status: 'ready',
    delays: analyzed,
    bottlenecks,
    constructionZones,
    corridorSummary: {
      averageDelayMin: avgDelay,
      severeCorridorsCount: severeCount,
      constructionCount: constructionZones.length,
      maxDelayMin: maxDelay,
      overallCongestionScore: overallCongestion,
    },
    // Delay minutes are derived from measured TomTom speed ratios against
    // published free-flow speeds by road class — measured input, modelled
    // conversion. Named so narration cannot upgrade it to "measured".
    confidence: 'measured-flow',
    readout,
  };
}
