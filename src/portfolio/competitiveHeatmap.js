/**
 * @file Dynamic Competitive & Traffic Heatmap Visualization Engine.
 * 
 * Renders high-tech radiant 3D gradient heatmap rings on Cesium for:
 *  1. `traffic` - Live traffic density, delay corridors, and construction zones.
 *  2. `competitor` - Territorial dominance, competitor saturation, and market share.
 *  3. `opportunity` - Prime commuter "cool-off" conversion zones.
 * 
 * @module portfolio/competitiveHeatmap
 */

import * as Cesium from 'cesium';

let _viewer = null;
let _dataSource = null;
let _currentMode = 'traffic'; // 'traffic' | 'competitor' | 'opportunity'
let _isVisible = true;

/**
 * Initialize the competitive heatmap datasource.
 * @param {object} viewer Cesium Viewer instance
 */
export function initCompetitiveHeatmap(viewer) {
  _viewer = viewer;
  if (!_dataSource && viewer?.dataSources) {
    _dataSource = new Cesium.CustomDataSource('competitive-heatmap-layer');
    viewer.dataSources.add(_dataSource);
  }
}

/**
 * Set active heatmap visualization mode.
 * @param {'traffic'|'competitor'|'opportunity'} mode
 */
export function setHeatmapMode(mode) {
  if (['traffic', 'competitor', 'opportunity'].includes(mode)) {
    _currentMode = mode;
  }
  return _currentMode;
}

export function getHeatmapMode() {
  return _currentMode;
}

/**
 * Toggle heatmap visibility.
 * @param {boolean} [force]
 */
export function toggleHeatmapVisibility(force) {
  _isVisible = force !== undefined ? Boolean(force) : !_isVisible;
  if (_dataSource) {
    _dataSource.show = _isVisible;
  }
  return _isVisible;
}

export function isHeatmapVisible() {
  return _isVisible;
}

/**
 * Clear all rendered heatmap entities.
 */
export function clearHeatmap() {
  if (_dataSource) {
    _dataSource.entities.removeAll();
  }
}

/**
 * Render multi-tier radiant heatmap elements.
 * 
 * @param {{
 *   clientSites?: object[],
 *   competitorSites?: object[],
 *   delays?: object[],
 *   opportunities?: object[],
 *   mode?: 'traffic'|'competitor'|'opportunity'
 * }} data
 */
export function renderHeatmapData({
  clientSites = [],
  competitorSites = [],
  delays = [],
  opportunities = [],
  mode = _currentMode,
} = {}) {
  if (!_dataSource) return;
  _dataSource.entities.suspendEvents();
  _dataSource.entities.removeAll();
  _currentMode = mode;

  if (_isVisible) {
    if (mode === 'traffic') {
      renderTrafficDensityHeatmap(delays, clientSites);
    } else if (mode === 'competitor') {
      renderCompetitorPressureHeatmap(clientSites, competitorSites);
    } else if (mode === 'opportunity') {
      renderCoolOffOpportunityHeatmap(opportunities, delays);
    }
  }
  _dataSource.entities.resumeEvents();
}

/**
 * Render Traffic Flow & Delay Heatmap.
 */
function renderTrafficDensityHeatmap(delays, sites) {
  // 1. Road delay hotspots
  for (let i = 0; i < delays.length; i++) {
    const d = delays[i];
    if (!Number.isFinite(d.midLat) || !Number.isFinite(d.midLon)) continue;

    const isSevere = d.frustrationScore >= 70 || d.isConstruction;
    const isModerate = d.frustrationScore >= 40 && !isSevere;

    const color = isSevere
      ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.32)
      : isModerate
        ? Cesium.Color.fromCssColorString('#eab308').withAlpha(0.24)
        : Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.18);

    const outline = isSevere
      ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.85)
      : isModerate
        ? Cesium.Color.fromCssColorString('#eab308').withAlpha(0.70)
        : Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.60);

    const radius = isSevere ? 500.0 : isModerate ? 380.0 : 250.0;

    _dataSource.entities.add({
      id: `traffic-heat:${i}`,
      position: Cesium.Cartesian3.fromDegrees(d.midLon, d.midLat),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color,
        outline: true,
        outlineColor: outline,
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  // 2. Site traffic capture beacons
  for (const s of sites) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    _dataSource.entities.add({
      id: `site-traffic-beacon:${s.id}`,
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      ellipse: {
        semiMinorAxis: 420.0,
        semiMajorAxis: 420.0,
        material: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.22),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#0284c7').withAlpha(0.8),
        outlineWidth: 2.0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }
}

/**
 * Render Competitive Pressure Heatmap (Client vs Competitors).
 */
function renderCompetitorPressureHeatmap(clientSites, competitorSites) {
  // Client territory (Cyan / Blue)
  for (const s of clientSites) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    _dataSource.entities.add({
      id: `comp-client:${s.id}`,
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      ellipse: {
        semiMinorAxis: 600.0,
        semiMajorAxis: 600.0,
        material: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.28),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#0891b2').withAlpha(0.9),
        outlineWidth: 2.0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  // Competitor territory (Magenta / Purple)
  for (let i = 0; i < competitorSites.length; i++) {
    const c = competitorSites[i];
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    _dataSource.entities.add({
      // Falls back to the index, not Math.random(): a random id changes on
      // every render, so Cesium sees a brand-new entity each pass instead of
      // an update, and the ring flickers.
      id: `comp-rival:${c.id || `idx-${i}`}`,
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
      ellipse: {
        semiMinorAxis: 550.0,
        semiMajorAxis: 550.0,
        material: Cesium.Color.fromCssColorString('#d946ef').withAlpha(0.25),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#c026d3').withAlpha(0.85),
        outlineWidth: 1.8,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }
}

/**
 * Render Cool-off Opportunity Heatmap (Glowing Gold / Amber conversion hubs).
 */
function renderCoolOffOpportunityHeatmap(opportunities, delays) {
  for (const opp of opportunities) {
    if (!Number.isFinite(opp.lat) || !Number.isFinite(opp.lon)) continue;

    const isPrime = opp.conversionScore >= 75;
    const color = isPrime
      ? Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.38)
      : Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.25);

    const outline = isPrime
      ? Cesium.Color.fromCssColorString('#d97706').withAlpha(0.95)
      : Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.80);

    const radius = isPrime ? 750.0 : 500.0;

    // Radiant inner circle
    _dataSource.entities.add({
      id: `opp-inner:${opp.siteId}`,
      position: Cesium.Cartesian3.fromDegrees(opp.lon, opp.lat),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color,
        outline: true,
        outlineColor: outline,
        outlineWidth: 2.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    // Radiant outer pulse halo
    _dataSource.entities.add({
      id: `opp-halo:${opp.siteId}`,
      position: Cesium.Cartesian3.fromDegrees(opp.lon, opp.lat),
      ellipse: {
        semiMinorAxis: radius * 1.5,
        semiMajorAxis: radius * 1.5,
        material: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.12),
        outline: true,
        outlineColor: outline.withAlpha(0.4),
        outlineWidth: 1.0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }
}
