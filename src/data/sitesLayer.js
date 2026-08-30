import * as Cesium from 'cesium';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './contextStore.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { loadPortfolio, subscribePortfolio } from '../portfolio/portfolioStore.js';

/**
 * @file The Banner OS "Portfolio Sites" data layer — Phase 0 of the Banner OS
 * spec. Unlike every other layer, this one has no live feed: sites come from
 * a user-imported CSV persisted in `src/portfolio/portfolioStore.js`
 * (localStorage), so `update()` is a no-op and rendering is driven by
 * `enable()` and by portfolio-change notifications instead of polling.
 *
 * Selection wiring is modeled on `src/data/militaryInstallations.js`: a
 * `Cesium.CustomDataSource`, one `ScreenSpaceEventHandler` click handler,
 * `registerEntityContext`/`selectEntityContext` from `contextStore.js` so a
 * click fires the same `gev:entity-selected` event every other layer uses.
 * @module data/sitesLayer
 */

const LAYER_ID = 'sites';
const SITE_COLOR = Cesium.Color.fromCssColorString('#c2610c');

function createSitesLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _clickHandler = null;
  let _unsubscribePortfolio = null;
  let _enabled = false;
  let _selectedId = null;
  let _lastUpdate = null;
  let _heatmapEnabled = true;

  function renderSites() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    removeEntityContextsForLayer(LAYER_ID);

    const sites = loadPortfolio();
    for (const site of sites) {
      if (!site?.id || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      const isSelected = site.id === _selectedId;

      // Congestion & access friction classification
      const hash = Math.abs(Math.sin(site.lat * 12.9898 + site.lon * 78.233) * 43758.5453) % 1;
      const isSevere = hash > 0.72;
      const isModerate = hash > 0.40 && !isSevere;
      const siteColor = isSelected
        ? Cesium.Color.WHITE
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
          pixelSize: isSelected ? 14 : 10,
          color: siteColor,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Radiant Congestion Heatmap Ring
      if (_heatmapEnabled) {
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
          accessFriction: isSevere ? 'High Bottleneck' : isModerate ? 'Moderate Delay' : 'Free-Flowing Access',
        },
      });
    }

    const selectedEntity = _selectedId ? _dataSource.entities.getById(_selectedId) : null;
    if (selectedEntity) selectEntityContext(selectedEntity);
    else _selectedId = null;
    _lastUpdate = Date.now();
  }

  function setHeatmapVisible(visible) {
    _heatmapEnabled = Boolean(visible);
    renderSites();
  }

  function toggleHeatmap() {
    setHeatmapVisible(!_heatmapEnabled);
    return _heatmapEnabled;
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
    source: 'Imported CSV',
    updateInterval: 0,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('sites');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installClickHandler(viewer);
      _unsubscribePortfolio = subscribePortfolio(() => {
        if (_enabled) renderSites();
      });
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      registerPickOwner(LAYER_ID, (id) => Boolean(_dataSource?.entities.getById(id)));
      renderSites();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
    },

    /** No live feed to poll — rendering is import- and enable-driven. */
    update() {
      return true;
    },

    focusSite,
    fitPortfolioBounds,
    setHeatmapVisible,
    toggleHeatmap,

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
      removeEntityContextsForLayer(LAYER_ID);
      if (_unsubscribePortfolio) {
        _unsubscribePortfolio();
        _unsubscribePortfolio = null;
      }
      _clickHandler?.destroy();
      _clickHandler = null;
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _selectedId = null;
      _lastUpdate = null;
      _viewer = null;
    },

    getStats() {
      return {
        count: _dataSource ? _dataSource.entities.values.length : 0,
        lastUpdate: _lastUpdate,
        error: null,
      };
    },
  };

  return layer;
}

const sitesLayer = createSitesLayer();
export default sitesLayer;
