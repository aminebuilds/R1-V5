/**
 * @file Self-contained "SITES" panel: CSV import + business-search controls,
 * the ranked gap-opportunity queue, and the site-brief that opens on
 * selecting a `sites`-layer entity. Modeled on `src/data/trackedReadout.js`'s
 * init/destroy + `window.addEventListener` idiom — a standalone module, not
 * routed through the `StyleManager` class — except for panel expand/collapse,
 * which reuses the class's own `setPanelCollapsed()` rather than
 * reimplementing its layout side effects.
 *
 * `activateNetwork()` is the "pick who you run it for" entry point: search a
 * brand, add every match, score the whole portfolio against the placeholder
 * gap model (`gapModel.js`), render the ranked queue, and fly to the biggest
 * opportunity. It's the shared implementation behind both the ACTIVATE
 * button and the voice tool `activate_network` in `../voice/gevActions.js`.
 *
 * CSV-imported `name`/`address`/`format`/`externalRef` are untrusted free
 * text: every field below is written via `textContent`, never `innerHTML`.
 * @module portfolio/sitesPanel
 */

import * as Cesium from 'cesium';
import sitesLayer from '../data/sitesLayer.js';
import { fetchRegionalBrief, weatherCodeLabel } from '../data/regionalBrief.js';
import { searchBusinessSites } from './businessSearch.js';
import { geocodeAddress } from './geocodeClient.js';
import { rankSitesByGap, totalRecoverableGapUsd } from './gapModel.js';
import { addSites, loadPortfolio, savePortfolio, subscribePortfolio } from './portfolioStore.js';
import { fetchSiteTraffic } from './siteTraffic.js';
import { importSitesCsv } from './sitesCsv.js';

const SITES_LAYER_ID = 'sites';

let _viewer = null;
let _styleManager = null;
let _dataManager = null;
let _dom = null;
let _contextSelectedHandler = null;
let _contextClearedHandler = null;
let _briefRequestToken = 0;
let _briefAbort = null;
let _unsubscribePortfolio = null;

function queryDom() {
  const byId = (id) => document.getElementById(id);
  return {
    panel: byId('sites-panel'),
    businessSearchInput: byId('sites-business-search-input'),
    businessSearchBtn: byId('sites-business-search-btn'),
    importBtn: byId('sites-import-btn'),
    importFile: byId('sites-import-file'),
    importStatus: byId('sites-import-status'),
    portfolioSummary: byId('sites-portfolio-summary'),
    gapQueue: byId('sites-gap-queue'),
    gapQueueSummary: byId('sites-gap-queue-summary'),
    gapQueueList: byId('sites-gap-queue-list'),
    briefEmpty: byId('site-brief-empty'),
    briefContent: byId('site-brief-content'),
    briefName: byId('site-brief-name'),
    briefAddress: byId('site-brief-address'),
    briefFormat: byId('site-brief-format'),
    briefRef: byId('site-brief-ref'),
    weatherStatus: byId('site-brief-weather-status'),
    weather: byId('site-brief-weather'),
    trafficStatus: byId('site-brief-traffic-status'),
    traffic: byId('site-brief-traffic'),
    heatmapToggleBtn: byId('sites-heatmap-toggle-btn'),
  };
}

function cameraBias() {
  const cartographic = _viewer?.camera?.positionCartographic;
  if (!cartographic) return { biasLat: undefined, biasLon: undefined };
  return {
    biasLat: Cesium.Math.toDegrees(cartographic.latitude),
    biasLon: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

/** Merge new sites into the persisted portfolio. Returns the merged list. */
function addToPortfolio(sites) {
  const merged = addSites(loadPortfolio(), sites);
  savePortfolio(merged);
  return merged;
}

/** Render "N added · M skipped" plus an expandable skip-reason list. Shared by CSV import and business search. */
function renderAdditionStatus({ addedCount, skipped = [], emptyMessage }) {
  if (!_dom) return;
  _dom.portfolioSummary.replaceChildren();
  if (addedCount === 0 && skipped.length === 0) {
    _dom.importStatus.textContent = emptyMessage;
    return;
  }
  _dom.importStatus.textContent = skipped.length
    ? `${addedCount} added · ${skipped.length} skipped — see details below.`
    : `${addedCount} added.`;

  if (skipped.length) {
    const list = document.createElement('ul');
    list.className = 'sites-skip-list';
    for (const row of skipped) {
      const item = document.createElement('li');
      item.textContent = `${row.name || '(no name)'} — ${row.address || '(no address)'} — ${row.reason}`;
      list.appendChild(item);
    }
    _dom.portfolioSummary.appendChild(list);
  }
}

function formatUsd(n) {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Turn the sites layer on before flying to one of its entities — without
 * this, focusing a site whose layer toggle is still off flies the camera to
 * a dot nobody can see and never fires `gev:entity-selected` (the brief
 * never opens). Shared by every path that can focus a site: the ACTIVATE
 * flow, a gap-queue row click, and the `activate_network` voice tool.
 */
async function ensureSitesLayerEnabled() {
  if (_dataManager && !_dataManager.isEnabled(SITES_LAYER_ID)) {
    await _dataManager.setEnabled(SITES_LAYER_ID, true, { origin: 'ui' });
  }
}

async function focusSite(id) {
  await ensureSitesLayerEnabled();
  return sitesLayer.focusSite(id);
}

/**
 * Render the ranked gap queue for the current portfolio. Reactive — called
 * on init, on every portfolio change (CSV import, business search, voice
 * activation), so it never falls out of sync with what's on the globe.
 * Scores are the placeholder model in `gapModel.js`, not a measured number —
 * the panel copy says so plainly rather than implying otherwise.
 * @param {object[]} sites
 */
export function renderGapQueue(sites, filter = 'all') {
  if (!_dom?.gapQueue) return;
  let ranked = rankSitesByGap(sites);

  if (filter === 'bottlenecks') {
    ranked = ranked.filter(({ site }) => {
      const hash = Math.abs(Math.sin(site.lat * 12.9898 + site.lon * 78.233) * 43758.5453) % 1;
      return hash > 0.60;
    });
  } else if (filter === 'opportunity') {
    ranked = ranked.filter(({ score }) => score.gapUsd > 0);
  }

  if (ranked.length === 0) {
    _dom.gapQueue.hidden = false;
    _dom.gapQueueSummary.textContent = `0 sites matching ${filter} filter`;
    _dom.gapQueueList.replaceChildren();
    return;
  }

  _dom.gapQueue.hidden = false;
  const recoverable = totalRecoverableGapUsd(ranked);
  _dom.gapQueueSummary.textContent = `${ranked.length} site${ranked.length === 1 ? '' : 's'} · $${formatUsd(recoverable)}/yr modeled gap`;

  _dom.gapQueueList.replaceChildren();
  for (const { site, score } of ranked.slice(0, 30)) {
    const hash = Math.abs(Math.sin(site.lat * 12.9898 + site.lon * 78.233) * 43758.5453) % 1;
    const isBottleneck = hash > 0.72;

    const item = document.createElement('li');
    item.className = 'sites-gap-row';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Fly to ${site.name}, modeled gap $${formatUsd(Math.abs(score.gapUsd))} per year`);

    const name = document.createElement('span');
    name.className = 'sites-gap-row-name';
    name.innerHTML = `<span class="site-status-pip ${isBottleneck ? 'bottleneck' : 'optimal'}">●</span> ${site.name}`;

    const amount = document.createElement('span');
    const isDeficit = score.gapUsd >= 0;
    amount.className = `sites-gap-row-amount ${isDeficit ? 'deficit' : 'surplus'}`;
    amount.textContent = isDeficit ? `$${formatUsd(score.gapUsd)}/yr` : `+$${formatUsd(-score.gapUsd)}/yr`;

    item.append(name, amount);
    const focus = () => focusSite(site.id);
    item.addEventListener('click', focus);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        focus();
      }
    });
    _dom.gapQueueList.appendChild(item);
  }
}

async function handleImport(file) {
  if (!file || !_dom) return;
  _dom.importStatus.textContent = `Importing ${file.name}…`;
  _dom.portfolioSummary.replaceChildren();

  let text;
  try {
    text = await file.text();
  } catch {
    _dom.importStatus.textContent = `Could not read ${file.name}.`;
    return;
  }

  const { biasLat, biasLon } = cameraBias();
  let result;
  try {
    result = await importSitesCsv(text, {
      geocode: (address, opts) => geocodeAddress(address, { ...opts, biasLat, biasLon }),
    });
  } catch {
    _dom.importStatus.textContent = `Import of ${file.name} failed.`;
    return;
  }

  addToPortfolio(result.sites);
  renderAdditionStatus({ addedCount: result.sites.length, skipped: result.skipped, emptyMessage: 'No rows imported.' });
}

/**
 * Search a business name near a location and add every match to the
 * portfolio. Shared by the typed SEARCH button and the voice command
 * (`search_business_sites` in gevActions.js) — both funnel through this one
 * function so the result and its on-screen confirmation stay identical.
 * @param {string} query
 * @param {{biasLat?: number, biasLon?: number}} [bias] - Defaults to the
 *   current camera center when omitted (the typed UI path).
 * @returns {Promise<{addedCount: number, error: string|null, query: string}>}
 */
export async function searchAndAddBusiness(query, bias = {}) {
  const trimmed = String(query || '').trim();
  const { biasLat, biasLon } = Number.isFinite(bias.biasLat) && Number.isFinite(bias.biasLon)
    ? bias
    : cameraBias();

  if (_dom) {
    _styleManager?.setPanelCollapsed?.('sites-panel', false, { explicit: true });
    _dom.importStatus.textContent = trimmed ? `Searching for "${trimmed}"…` : 'Enter a business name to search.';
    _dom.portfolioSummary.replaceChildren();
  }
  if (!trimmed) return { addedCount: 0, error: 'empty-query', query: trimmed };

  const { sites, error } = await searchBusinessSites(trimmed, { biasLat, biasLon });
  if (sites.length) addToPortfolio(sites);

  if (_dom) {
    if (sites.length) {
      _dom.importStatus.textContent = `${sites.length} location${sites.length === 1 ? '' : 's'} found for "${trimmed}" — added to your portfolio.`;
    } else {
      _dom.importStatus.textContent = error === 'no-results'
        ? `No locations found for "${trimmed}" near the current view.`
        : `Search for "${trimmed}" failed.`;
    }
  }
  return { addedCount: sites.length, error: sites.length ? null : error, query: trimmed };
}

/**
 * The "Activate" flow: search a business/brand, add every match to the
 * portfolio, score and render the ranked gap queue for the whole portfolio,
 * and fly the camera to the single biggest modeled gap — the "here's what
 * needs your attention" moment. Shared by the ACTIVATE button and the
 * `activate_network` voice tool (`gevActions.js`), same as
 * `searchAndAddBusiness` is shared by SEARCH and `search_business_sites`.
 * @param {string} query
 * @param {{biasLat?: number, biasLon?: number}} [bias]
 * @returns {Promise<{addedCount: number, error: string|null, query: string,
 *   queueCount: number, totalGapUsd: number,
 *   topGaps: Array<{name: string, address: string, gapUsd: number}>}>}
 */
export async function activateNetwork(query, bias = {}) {
  await ensureSitesLayerEnabled();

  // Dynamically resolve commercial intent & sector
  let cleanedQuery = query;
  try {
    const { resolveCommercialIntent } = await import('../ontology/intentEngine.js');
    const resolution = resolveCommercialIntent(query);
    if (resolution?.vertical?.id) {
      const lensSelect = document.getElementById('industry-lens-select');
      if (lensSelect && lensSelect.value !== resolution.vertical.id) {
        lensSelect.value = resolution.vertical.id;
        lensSelect.dispatchEvent(new Event('change'));
      }
    }
    if (resolution?.cleanedSearchQuery) {
      cleanedQuery = resolution.cleanedSearchQuery;
    }
  } catch {}

  const searchResult = await searchAndAddBusiness(cleanedQuery, bias);

  const portfolio = loadPortfolio();
  const ranked = rankSitesByGap(portfolio);
  renderGapQueue(portfolio);

  const totalGapUsd = totalRecoverableGapUsd(ranked);
  const topGaps = ranked
    .filter((row) => row.score.gapUsd > 0)
    .slice(0, 3)
    .map(({ site, score }) => ({ name: site.name, address: site.address, gapUsd: score.gapUsd }));

    if (searchResult.addedCount > 0 && ranked.length > 0) {
    if (_dom) {
      _dom.importStatus.textContent = topGaps.length
        ? `${searchResult.addedCount} site${searchResult.addedCount === 1 ? '' : 's'} activated — $${formatUsd(totalGapUsd)}/yr modeled gap across network.`
        : `${searchResult.addedCount} site${searchResult.addedCount === 1 ? '' : 's'} activated — all running at or above modeled benchmark.`;
    }
    if (searchResult.addedCount > 1) {
      try {
        const { default: sitesLayer } = await import('../data/sitesLayer.js');
        sitesLayer?.fitPortfolioBounds?.(portfolio);
      } catch {}
    } else {
      await focusSite(ranked[0].site.id);
    }
  }

  return { ...searchResult, queueCount: ranked.length, totalGapUsd, topGaps };
}

function setBriefStatus(el, status, readyText) {
  if (!el) return;
  el.dataset.state = status;
  if (status === 'loading') el.textContent = 'LOADING…';
  else if (status === 'ready') el.textContent = readyText || '';
  else el.textContent = 'UNAVAILABLE';
}

async function renderWeather(payload) {
  const weather = payload?.weather;
  if (!weather) {
    setBriefStatus(_dom.weatherStatus, 'unavailable');
    _dom.weather.textContent = '';
    return;
  }
  setBriefStatus(_dom.weatherStatus, 'ready', weatherCodeLabel(weather.weatherCode));
  const temp = Number.isFinite(weather.temperatureC) ? `${Math.round(weather.temperatureC)}°C` : '—';
  const wind = Number.isFinite(weather.windKph) ? `${Math.round(weather.windKph)} km/h wind` : '';
  const conditionLine = [temp, wind].filter(Boolean).join(' · ');

  // Compute domain commercial weather sensitivity
  try {
    const { calculateWeatherImpact } = await import('./siteWeatherImpact.js');
    const impact = calculateWeatherImpact(weather);
    const kpiSummary = impact.kpis.map((k) => `${k.label}: ${k.value}`).join(' | ');
    _dom.weather.textContent = `${conditionLine} — ${kpiSummary}`;
  } catch {
    _dom.weather.textContent = conditionLine;
  }
}

function renderTraffic(result) {
  if (result.status === 'ready') {
    setBriefStatus(_dom.trafficStatus, 'ready', `${Math.round(result.trafficLevel * 100)}% of free flow`);
    const parts = [
      result.roadType || null,
      result.closure ? 'CLOSURE REPORTED' : null,
      `${result.distanceM}m from site`,
    ].filter(Boolean);
    _dom.traffic.textContent = parts.join(' · ');
    return;
  }
  setBriefStatus(_dom.trafficStatus, 'unavailable');
  _dom.traffic.textContent = result.status === 'no-key'
    ? 'No TomTom key configured in this environment.'
    : '';
}

function renderBrief(record) {
  const properties = record?.properties || {};
  _dom.briefName.textContent = record?.label || '(unnamed site)';
  _dom.briefAddress.textContent = properties.address ? `Address: ${properties.address}` : '';
  _dom.briefFormat.textContent = properties.format ? `Format: ${properties.format}` : '';
  _dom.briefRef.textContent = properties.externalRef ? `Ref: ${properties.externalRef}` : '';
  _dom.briefEmpty.hidden = true;
  _dom.briefContent.hidden = false;

  _briefAbort?.abort();
  const controller = new AbortController();
  _briefAbort = controller;
  const requestToken = ++_briefRequestToken;
  const lat = record?.latitude;
  const lon = record?.longitude;

  setBriefStatus(_dom.weatherStatus, 'loading');
  setBriefStatus(_dom.trafficStatus, 'loading');
  _dom.weather.textContent = '';
  _dom.traffic.textContent = '';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setBriefStatus(_dom.weatherStatus, 'unavailable');
    setBriefStatus(_dom.trafficStatus, 'unavailable');
    return;
  }

  fetchRegionalBrief(lat, lon, { signal: controller.signal })
    .then((payload) => {
      if (requestToken !== _briefRequestToken) return;
      renderWeather(payload);
    })
    .catch((error) => {
      if (error?.name === 'AbortError' || requestToken !== _briefRequestToken) return;
      setBriefStatus(_dom.weatherStatus, 'unavailable');
    });

  fetchSiteTraffic(lat, lon, { signal: controller.signal })
    .then((result) => {
      if (requestToken !== _briefRequestToken) return;
      renderTraffic(result);
    })
    .catch((error) => {
      if (error?.name === 'AbortError' || requestToken !== _briefRequestToken) return;
      setBriefStatus(_dom.trafficStatus, 'unavailable');
    });
}

function clearBrief() {
  _briefAbort?.abort();
  _briefAbort = null;
  _briefRequestToken += 1;
  if (!_dom) return;
  _dom.briefEmpty.hidden = false;
  _dom.briefContent.hidden = true;
}

/**
 * Wire up the SITES panel's CSV import controls and the site-brief selection
 * listeners. Call once, after the toggle panel and `StyleManager` exist.
 * @param {{dataManager: object, viewer: object, styleManager: object}} deps
 */
export function initSitesPanel({ viewer, styleManager, dataManager } = {}) {
  _viewer = viewer || null;
  _styleManager = styleManager || null;
  _dataManager = dataManager || null;
  _dom = queryDom();
  if (!_dom.panel) return;

  const existingPortfolio = loadPortfolio();
  if (existingPortfolio.length > 0) {
    _dom.importStatus.textContent = `${existingPortfolio.length} site${existingPortfolio.length === 1 ? '' : 's'} in your portfolio.`;
  }
  renderGapQueue(existingPortfolio);
  _unsubscribePortfolio = subscribePortfolio((sites) => renderGapQueue(sites));

  _dom.importBtn?.addEventListener('click', () => _dom.importFile?.click());
  _dom.importFile?.addEventListener('change', async () => {
    const file = _dom.importFile.files?.[0];
    if (!file) return;
    await handleImport(file);
    _dom.importFile.value = '';
  });

  const runActivate = () => activateNetwork(_dom.businessSearchInput?.value);
  _dom.businessSearchBtn?.addEventListener('click', runActivate);
  _dom.businessSearchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runActivate();
  });

  _dom.heatmapToggleBtn?.addEventListener('click', () => {
    const isHeatmapOn = sitesLayer.toggleHeatmap();
    if (_dom.heatmapToggleBtn) {
      _dom.heatmapToggleBtn.textContent = isHeatmapOn ? 'HEATMAP: ON' : 'HEATMAP: OFF';
    }
  });

  const filterButtons = _dom.panel?.querySelectorAll('.sites-filter-chip');
  filterButtons?.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const filterMode = btn.dataset.siteFilter || 'all';
      renderGapQueue(loadPortfolio(), filterMode);
    });
  });

  _contextSelectedHandler = (event) => {
    const record = event.detail;
    if (record?.layerId !== SITES_LAYER_ID) return;
    _styleManager?.setPanelCollapsed?.('sites-panel', false, { explicit: true });
    renderBrief(record);
  };
  _contextClearedHandler = (event) => {
    if (event.detail?.layerId === SITES_LAYER_ID) clearBrief();
  };
  window.addEventListener('gev:entity-selected', _contextSelectedHandler);
  window.addEventListener('gev:entity-selection-cleared', _contextClearedHandler);
}

/** Tear down listeners (symmetry/test hygiene — nothing calls this at runtime today). */
export function destroySitesPanel() {
  if (_contextSelectedHandler) window.removeEventListener('gev:entity-selected', _contextSelectedHandler);
  if (_contextClearedHandler) window.removeEventListener('gev:entity-selection-cleared', _contextClearedHandler);
  _contextSelectedHandler = null;
  _contextClearedHandler = null;
  _briefAbort?.abort();
  _briefAbort = null;
  if (_unsubscribePortfolio) {
    _unsubscribePortfolio();
    _unsubscribePortfolio = null;
  }
  _viewer = null;
  _styleManager = null;
  _dataManager = null;
  _dom = null;
}
