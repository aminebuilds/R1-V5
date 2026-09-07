import * as Cesium from 'cesium';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './contextStore.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { loadPortfolio, subscribePortfolio } from '../portfolio/portfolioStore.js';
import { fetchSiteTraffic } from '../portfolio/siteTraffic.js';
import {
  initCompetitiveHeatmap,
  renderHeatmapData,
  setHeatmapMode,
  getHeatmapMode,
  toggleHeatmapVisibility,
  isHeatmapVisible,
} from '../portfolio/competitiveHeatmap.js';

/**
 * @file The Banner OS "Portfolio Sites" data layer — Phase 0 of the Banner OS
 * spec. Displays user-imported and dynamically discovered commercial networks,
 * integrates live traffic congestion, and hosts the multi-mode Competitive &
 * Traffic Radiant Heatmaps.
 * @module data/sitesLayer
 */

const LAYER_ID = 'sites';
const SITE_COLOR = Cesium.Color.fromCssColorString('#c2610c');

/** How long a per-site flow reading stays usable before it is refetched. */
const FLOW_TTL_MS = 2 * 60_000;
/** Concurrent flow fetches. Each is one tile request through /api/tomtom. */
const FLOW_CONCURRENCY = 4;
/** Sites fetched per sweep — a large portfolio must not become a tile storm. */
const FLOW_MAX_PER_SWEEP = 40;

function createSitesLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _clickHandler = null;
  let _unsubscribePortfolio = null;
  let _enabled = false;
  let _selectedId = null;
  let _lastUpdate = null;
  let _heatmapEnabled = true;
  /** @type {Map<string, {trafficLevel: number|null, closure: boolean, measuredAt: number}>} */
  const _siteFlow = new Map();
  let _flowSweepRunning = false;
  let _flowAbort = null;

  /**
   * Fetch live flow for sites whose reading is missing or stale, then re-render
   * so the dots recolour. Failures leave a site unmeasured (neutral) rather
   * than substituting a value.
   */
  async function refreshSiteFlow() {
    if (_flowSweepRunning || !_enabled) return;
    const now = Date.now();
    const due = loadPortfolio()
      .filter((s) => s?.id && Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .filter((s) => {
        const cached = _siteFlow.get(s.id);
        return !cached || now - cached.measuredAt > FLOW_TTL_MS;
      })
      .slice(0, FLOW_MAX_PER_SWEEP);
    if (due.length === 0) return;

    _flowSweepRunning = true;
    _flowAbort = new AbortController();
    const { signal } = _flowAbort;
    let changed = false;

    try {
      const queue = [...due];
      const workers = Array.from({ length: Math.min(FLOW_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          if (signal.aborted) return;
          const site = queue.shift();
          if (!site) return;
          try {
            const reading = await fetchSiteTraffic(site.lat, site.lon, { signal });
            if (reading?.status === 'ready') {
              _siteFlow.set(site.id, {
                trafficLevel: reading.trafficLevel,
                closure: Boolean(reading.closure),
                roadType: reading.roadType || null,
                measuredAt: Date.now(),
              });
              changed = true;
            } else {
              // Remember the miss so a keyless/uncovered site is not retried
              // on every sweep — but store no level, so it stays unmeasured.
              _siteFlow.set(site.id, { trafficLevel: null, closure: false, measuredAt: Date.now() });
            }
          } catch (error) {
            if (error?.name === 'AbortError') return;
          }
        }
      });
      await Promise.all(workers);
    } finally {
      _flowSweepRunning = false;
      _flowAbort = null;
    }

    if (changed && _enabled) renderSites();
  }

  function renderSites() {
    if (!_dataSource) return;
    _dataSource.entities.suspendEvents();
    _dataSource.entities.removeAll();
    removeEntityContextsForLayer(LAYER_ID);

    const sites = loadPortfolio();
    for (const site of sites) {
      if (!site?.id || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      const isSelected = site.id === _selectedId;

      // Congestion classification from the site's LIVE flow reading. Sites with
      // no reading yet render neutral — green has to mean "measured free
      // flowing", never "we have not looked". The previous build coloured every
      // dot from `sin(lat·12.9898 + lon·78.233)`, so the most visible signal on
      // the map was a hash of the coordinates.
      const flow = _siteFlow.get(site.id) || null;
      const level = flow && Number.isFinite(flow.trafficLevel) ? flow.trafficLevel : null;
      const isUnknown = level === null;
      const isSevere = !isUnknown && (flow.closure || level > 0.75);
      const isModerate = !isUnknown && !isSevere && level > 0.45;
      const siteColor = isSelected
        ? Cesium.Color.WHITE
        : isUnknown
          ? Cesium.Color.fromCssColorString('#8b98a3')
          : isSevere
            ? Cesium.Color.fromCssColorString('#ef4444')
            : isModerate
              ? Cesium.Color.fromCssColorString('#eab308')
              : Cesium.Color.fromCssColorString('#22c55e');

      // 3D Site Point
      const entity = _dataSource.entities.add({
        id: site.id,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
        point: {
          pixelSize: isSelected ? 15 : 11,
          color: siteColor,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Congestion ring — only drawn where flow was actually measured. An
      // unmeasured site gets no ring rather than a reassuring green one.
      if (_heatmapEnabled && !isUnknown) {
        const glowColor = isSevere
          ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.24)
          : isModerate
            ? Cesium.Color.fromCssColorString('#eab308').withAlpha(0.20)
            : Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.18);
        const ringColor = isSevere
          ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.65)
          : isModerate
            ? Cesium.Color.fromCssColorString('#eab308').withAlpha(0.55)
            : Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.5);

        _dataSource.entities.add({
          id: `${site.id}:heatmap-ring`,
          position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
          ellipse: {
            semiMinorAxis: isSelected ? 480.0 : 320.0,
            semiMajorAxis: isSelected ? 480.0 : 320.0,
            material: glowColor,
            outline: true,
            outlineColor: ringColor,
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
      }

      registerEntityContext(entity, {
        id: site.id,
        layerId: LAYER_ID,
        layerName: 'Portfolio Sites',
        label: site.name,
        latitude: site.lat,
        longitude: site.lon,
        properties: {
          address: site.address,
          format: site.format,
          externalRef: site.externalRef,
          openedAt: site.openedAt,
          // null, not a label, when nothing was measured for this site.
          trafficLevel: level,
          accessFriction: isUnknown
            ? null
            : isSevere ? 'High delay' : isModerate ? 'Moderate' : 'Smooth flow',
          trafficMeasuredAt: flow?.measuredAt || null,
        },
      });
    }

    // Refresh dynamic competitive heatmap
    if (_heatmapEnabled) {
      renderHeatmapData({ clientSites: sites });
    }

    _dataSource.entities.resumeEvents();

    const selectedEntity = _selectedId ? _dataSource.entities.getById(_selectedId) : null;
    if (selectedEntity) selectEntityContext(selectedEntity);
    else _selectedId = null;
    _lastUpdate = Date.now();
  }

  function setHeatmapVisible(visible) {
    _heatmapEnabled = Boolean(visible);
    toggleHeatmapVisibility(_heatmapEnabled);
    renderSites();
  }

  function toggleHeatmap() {
    setHeatmapVisible(!_heatmapEnabled);
    return _heatmapEnabled;
  }

  function cycleHeatmapMode() {
    const modes = ['traffic', 'competitor', 'opportunity'];
    const current = getHeatmapMode();
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    const nextMode = modes[nextIdx];
    setHeatmapMode(nextMode);
    renderHeatmapData({ clientSites: loadPortfolio(), mode: nextMode });
    return nextMode;
  }

  function fitPortfolioBounds(sites = loadPortfolio()) {
    if (!sites?.length || !_viewer?.camera) return;
    const lats = sites.map((s) => s.lat).filter(Number.isFinite);
    const lons = sites.map((s) => s.lon).filter(Number.isFinite);
    if (!lats.length || !lons.length) return;

    if (sites.length === 1) {
      _viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lons[0], lats[0], 1200),
        duration: 1.6,
      });
      return;
    }

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const padLat = Math.max(0.04, (maxLat - minLat) * 0.2);
    const padLon = Math.max(0.04, (maxLon - minLon) * 0.2);

    const rect = Cesium.Rectangle.fromDegrees(
      minLon - padLon,
      minLat - padLat,
      maxLon + padLon,
      maxLat + padLat
    );

    _viewer.camera.flyTo({
      destination: rect,
      duration: 2.0,
    });
  }

  function selectSite(id) {
    if (!_dataSource?.entities.getById(id)) return false;
    _selectedId = id;
    renderSites();
    return _selectedId === id;
  }

  function focusSite(id) {
    if (!selectSite(id)) return false;
    const site = loadPortfolio().find((s) => s.id === id);
    if (site && _viewer?.camera && Number.isFinite(site.lat) && Number.isFinite(site.lon)) {
      _viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 900),
        duration: 1.6,
      });
    }
    return true;
  }

  function installClickHandler(viewer) {
    if (_clickHandler) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = typeof picked?.id?.id === 'string' ? picked.id.id : null;
      if (id && _dataSource?.entities.getById(id)) selectSite(id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  const layer = {
    id: LAYER_ID,
    name: 'Portfolio Sites',
    icon: '◈',
    source: 'Commercial Network',
    // Per-site flow readings expire; the manager's poll drives the refresh.
    updateInterval: 60_000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('sites');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      initCompetitiveHeatmap(viewer);
      installClickHandler(viewer);
      _unsubscribePortfolio = subscribePortfolio(() => {
        if (!_enabled) return;
        renderSites();
        refreshSiteFlow();
      });
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      toggleHeatmapVisibility(_heatmapEnabled);
      registerPickOwner(LAYER_ID, (id) => Boolean(_dataSource?.entities.getById(id)));
      renderSites();
      refreshSiteFlow();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      toggleHeatmapVisibility(false);
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
      if (_flowAbort) _flowAbort.abort();
    },

    /** Refreshes the per-site live flow readings that colour the dots. */
    update() {
      refreshSiteFlow();
      return true;
    },

    /** Live flow readings by site id — read by the view-health rollup. */
    getSiteFlow() {
      return new Map(_siteFlow);
    },

    /**
     * Portfolio sites as analyst records, joined to whatever has actually been
     * measured for them. Unmeasured fields are `null`, never a stand-in, so a
     * query like "sites with congestion above 0.7" can only ever match sites
     * that were really read.
     * @param {number} [limit]
     * @returns {object[]}
     */
    getAnalystRecords(limit = 5000) {
      const sites = loadPortfolio();
      const out = [];
      for (const site of sites) {
        if (out.length >= limit) break;
        if (!site?.id || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
        const flow = _siteFlow.get(site.id) || null;
        const level = flow && Number.isFinite(flow.trafficLevel) ? flow.trafficLevel : null;
        out.push({
          id: site.id,
          name: site.name,
          address: site.address || null,
          brand: site.brand || null,
          format: site.format || null,
          lat: site.lat,
          lon: site.lon,
          trafficLevel: level,
          roadType: flow?.roadType || null,
          isClosure: Boolean(flow?.closure),
          hasLiveFlow: level !== null,
          congestionScore: level === null ? null : Math.round(level * 100),
          accessFriction: level === null
            ? null
            : flow.closure ? 'Closed' : level > 0.75 ? 'High delay' : level > 0.45 ? 'Moderate' : 'Smooth flow',
          measuredAt: flow?.measuredAt || null,
          isCompetitor: Boolean(site.isCompetitor),
        });
      }
      return out;
    },

    focusSite,
    fitPortfolioBounds,
    setHeatmapVisible,
    toggleHeatmap,
    cycleHeatmapMode,

    destroy(viewer) {
      _enabled = false;
      if (_flowAbort) _flowAbort.abort();
      _siteFlow.clear();
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
      removeEntityContextsForLayer(LAYER_ID);
      if (_unsubscribePortfolio) {
        _unsubscribePortfolio();
        _unsubscribePortfolio = null;
      }
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (_dataSource && viewer?.dataSources) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _selectedId = null;
    },
  };

  return layer;
}

const sitesLayer = createSitesLayer();
export default sitesLayer;
