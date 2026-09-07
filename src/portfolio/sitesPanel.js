/**
 * @file Self-contained "SITES" & Commercial Intelligence panel:
 *  - CSV import + JARVIS fuzzy business search controls.
 *  - Competitive Benchmarking & Market Share Matrix.
 *  - Real-Time Traffic Bottlenecks & Road Construction Delays.
 *  - Commuter "Cool-Off" Conversion Opportunity Radar.
 *  - Dynamic Radiant Heatmap Controls (Traffic / Competitor / Cool-Off).
 *  - Ranked gap-opportunity queue & rich site-brief inspector.
 * 
 * @module portfolio/sitesPanel
 */

import * as Cesium from 'cesium';
import sitesLayer from '../data/sitesLayer.js';
import { fetchRegionalBrief, weatherCodeLabel } from '../data/regionalBrief.js';
import { searchBusinessSites } from './businessSearch.js';
import { executeJarvisFuzzySearch } from './fuzzySearchEngine.js';
import { analyzeCompetitivePosition } from './competitiveEngine.js';
import { fetchTrafficDelays } from './trafficDelayEngine.js';
import { evaluateCoolOffOpportunities } from './coolOffOpportunityEngine.js';
import { renderHeatmapData, setHeatmapMode, getHeatmapMode } from './competitiveHeatmap.js';
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

/** Render "N added · M skipped" plus an expandable skip-reason list. */
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
 * Render the ranked gap queue or specialized intelligence lists (Cool-Off, Competitors, Bottlenecks).
 * @param {object[]} sites
 * @param {string} filter
 */
export async function renderGapQueue(sites, filter = 'all') {
  if (!_dom?.gapQueue) return;
  
  if (filter === 'cool-off') {
    renderCoolOffView(sites);
    return;
  }
  
  if (filter === 'competitors') {
    renderCompetitorsView(sites);
    return;
  }

  // Live flow per site, measured — the same readings colouring the map dots.
  const siteFlow = sitesLayer.getSiteFlow?.() || new Map();
  const enriched = sites.map((site) => {
    const flow = siteFlow.get(site.id) || null;
    const level = flow && Number.isFinite(flow.trafficLevel) ? flow.trafficLevel : null;
    return { ...site, trafficLevel: level, roadType: flow?.roadType || null };
  });

  let ranked = rankSitesByGap(enriched);

  if (filter === 'bottlenecks') {
    // Real congestion, not a hash. Sites with no reading are excluded rather
    // than assigned a side.
    ranked = ranked.filter(({ site }) => Number.isFinite(site.trafficLevel) && site.trafficLevel > 0.6);
  } else if (filter === 'opportunity') {
    ranked = ranked.filter(({ score, demand }) => (
      score.confidence === 'measured' ? score.gapUsd > 0 : (demand?.demandPotential ?? 0) >= 55
    ));
  }

  if (ranked.length === 0) {
    _dom.gapQueue.hidden = false;
    _dom.gapQueueSummary.textContent = filter === 'bottlenecks'
      ? 'No site has a measured congestion reading above threshold'
      : `0 sites matching ${filter} filter`;
    _dom.gapQueueList.replaceChildren();
    return;
  }

  _dom.gapQueue.hidden = false;
  const recoverable = totalRecoverableGapUsd(ranked);
  const measuredCount = ranked.filter(({ score }) => score.confidence === 'measured').length;
  // A dollar total is only shown when it rests on real volumes.
  _dom.gapQueueSummary.textContent = measuredCount > 0
    ? `${ranked.length} site${ranked.length === 1 ? '' : 's'} · $${formatUsd(recoverable)}/yr gap across ${measuredCount} with actuals`
    : `${ranked.length} site${ranked.length === 1 ? '' : 's'} · ranked by demand potential — dollar gap needs actual volumes`;

  _dom.gapQueueList.replaceChildren();
  for (const { site, score, demand } of ranked.slice(0, 30)) {
    const level = site.trafficLevel;
    const isBottleneck = Number.isFinite(level) && level > 0.72;
    const isUnmeasured = !Number.isFinite(level);

    const item = document.createElement('li');
    item.className = 'sites-gap-row';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const hasDollars = score.confidence === 'measured';
    item.setAttribute('aria-label', hasDollars
      ? `Fly to ${site.name}, measured gap $${formatUsd(Math.abs(score.gapUsd))} per year`
      : `Fly to ${site.name}, demand potential ${demand?.demandPotential ?? 'unknown'} of 100`);

    const name = document.createElement('span');
    name.className = 'sites-gap-row-name';
    const pip = isUnmeasured ? 'unmeasured' : isBottleneck ? 'bottleneck' : 'optimal';
    name.innerHTML = `<span class="site-status-pip ${pip}">●</span> ${site.name}`;

    const amount = document.createElement('span');
    if (hasDollars) {
      const isDeficit = score.gapUsd >= 0;
      amount.className = `sites-gap-row-amount ${isDeficit ? 'deficit' : 'surplus'}`;
      amount.textContent = isDeficit ? `$${formatUsd(score.gapUsd)}/yr` : `+$${formatUsd(-score.gapUsd)}/yr`;
    } else {
      amount.className = 'sites-gap-row-amount';
      amount.textContent = demand?.demandPotential === null || demand?.demandPotential === undefined
        ? '—'
        : `${demand.demandPotential}/100 potential`;
    }

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

/** Render Cool-Off Conversion Opportunities */
async function renderCoolOffView(sites) {
  _dom.gapQueueSummary.textContent = 'Scanning real-time road friction & delays…';
  _dom.gapQueueList.replaceChildren();

  const { biasLat, biasLon } = cameraBias();
  const oppReport = await evaluateCoolOffOpportunities({ biasLat, biasLon });

  // "Traffic unavailable" and "no bottlenecks found" are different answers and
  // are shown as different answers.
  if (!oppReport?.success) {
    _dom.gapQueueSummary.textContent = oppReport?.status === 'no-key'
      ? 'Traffic unavailable — TomTom key not configured'
      : 'Traffic unavailable — cannot evaluate this catchment';
    return;
  }
  if (!oppReport.opportunities.length) {
    _dom.gapQueueSummary.textContent = 'No bottleneck met the play thresholds in this catchment';
    return;
  }

  _dom.gapQueueSummary.textContent = `${oppReport.opportunities.length} scored · ${oppReport.activeConstructionCount} closure/construction zone${oppReport.activeConstructionCount === 1 ? '' : 's'}`;

  // Render opportunity heatmap
  renderHeatmapData({
    clientSites: sites,
    opportunities: oppReport.opportunities,
    mode: 'opportunity',
  });

  for (const opp of oppReport.opportunities) {
    const item = document.createElement('li');
    item.className = 'sites-gap-row';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const topPlay = opp.plays[0] || null;
    item.title = topPlay ? `${topPlay.name} — ${topPlay.action} (lift unmeasured)` : 'No play threshold met';

    const name = document.createElement('span');
    name.className = 'sites-gap-row-name';
    const badgeColor = opp.conversionScore >= 80 ? '#ef4444' : opp.conversionScore >= 60 ? '#f59e0b' : '#38bdf8';
    const approachNote = opp.approach === 'ambiguous'
      ? 'approach side undetermined'
      : `${opp.approach}-side approach`;
    name.innerHTML = `<span style="color:${badgeColor}">⚡ ${opp.conversionScore}/100</span> ${opp.siteName} <small style="display:block;opacity:0.75;font-size:11px;">+${opp.delayMin}m on ${opp.bottleneckRoadType || 'road'} · ${opp.distanceToBottleneckM}m · ${approachNote}</small>`;

    const amount = document.createElement('span');
    amount.className = 'sites-gap-row-amount surplus';
    // Play count, not an invented footfall forecast.
    amount.textContent = topPlay ? `${opp.plays.length} play${opp.plays.length === 1 ? '' : 's'}` : '—';

    item.append(name, amount);
    item.addEventListener('click', () => focusSite(opp.siteId));
    _dom.gapQueueList.appendChild(item);
  }
}

/** Render Competitive Analysis Matrix */
async function renderCompetitorsView(sites) {
  _dom.gapQueueSummary.textContent = 'Analyzing competitive density & market share…';
  _dom.gapQueueList.replaceChildren();

  const { biasLat, biasLon } = cameraBias();
  const compReport = await analyzeCompetitivePosition(null, null, { biasLat, biasLon });

  if (!compReport?.success) {
    _dom.gapQueueSummary.textContent = compReport?.status === 'no-client-sites'
      ? 'No sites loaded — import a portfolio or search a brand first'
      : `No mapped competitors found near this area for ${compReport?.primaryBrand || 'this brand'}`;
    return;
  }

  _dom.gapQueueSummary.textContent = `${compReport.primaryBrand}: ${compReport.marketSharePct}% of mapped locations · mean territorial score ${compReport.averageDominanceScore}/100`;

  // Render competitor heatmap
  renderHeatmapData({
    clientSites: sites,
    competitorSites: compReport.competitorSites,
    mode: 'competitor',
  });

  for (const itemData of compReport.siteBreakdowns) {
    const item = document.createElement('li');
    item.className = 'sites-gap-row';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const name = document.createElement('span');
    name.className = 'sites-gap-row-name';
    const isAdvantaged = itemData.dominanceScore >= 60;
    // Access reads "—" when no live flow resolved for this site, rather than
    // borrowing a label from a number that was never measured.
    const access = itemData.accessFriction || 'access unknown';
    name.innerHTML = `<span style="color:${isAdvantaged ? '#22c55e' : '#f59e0b'}">★ ${itemData.dominanceScore}</span> ${itemData.siteName} <small style="display:block;opacity:0.75;font-size:11px;">${itemData.competitorsWithin1km} within 1km · ${access}</small>`;

    const amount = document.createElement('span');
    amount.className = `sites-gap-row-amount ${isAdvantaged ? 'surplus' : 'deficit'}`;
    amount.textContent = itemData.status;

    item.append(name, amount);
    item.addEventListener('click', () => focusSite(itemData.siteId));
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
 * Search a business or address using the JARVIS Fuzzy Search Engine.
 * @param {string} query
 * @param {{biasLat?: number, biasLon?: number}} [bias]
 * @returns {Promise<{addedCount: number, error: string|null, query: string, jarvisReadout?: string}>}
 */
export async function searchAndAddBusiness(query, bias = {}) {
  const trimmed = String(query || '').trim();
  const { biasLat, biasLon } = Number.isFinite(bias.biasLat) && Number.isFinite(bias.biasLon)
    ? bias
    : cameraBias();

  if (_dom) {
    _styleManager?.setPanelCollapsed?.('sites-panel', false, { explicit: true });
    _dom.importStatus.textContent = trimmed ? `[JARVIS SEARCH] Querying "${trimmed}"…` : 'Enter a business name or address.';
    _dom.portfolioSummary.replaceChildren();
  }
  if (!trimmed) return { addedCount: 0, error: 'empty-query', query: trimmed };

  const fuzzyResult = await executeJarvisFuzzySearch(trimmed, { biasLat, biasLon });

  if (fuzzyResult.success && fuzzyResult.matches.length > 0) {
    const sites = fuzzyResult.matches.map((m) => ({
      id: m.id || `site:fuzzy:${m.lat.toFixed(4)},${m.lon.toFixed(4)}`,
      name: m.name,
      address: m.address,
      lat: m.lat,
      lon: m.lon,
      format: m.category || 'Commercial',
      geocodeSource: fuzzyResult.source,
    }));

    addToPortfolio(sites);

    if (_dom) {
      _dom.importStatus.textContent = fuzzyResult.jarvisReadout;
    }
    return { addedCount: sites.length, error: null, query: trimmed, jarvisReadout: fuzzyResult.jarvisReadout };
  }

  // Fallback to standard searchBusinessSites
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
 * Primary commercial activation entry point.
 * @param {string} businessName
 * @param {{biasLat?: number, biasLon?: number}} [bias]
 * @returns {Promise<{
 *   ok: boolean,
 *   action: 'activate_network',
 *   businessName: string,
 *   addedCount: number,
 *   portfolioTotal: number,
 *   recoverableGapUsd: number,
 *   topOpportunity: object|null,
 *   competitiveScore: number,
 *   coolOffAlert: string|null,
 *   error?: string
 * }>}
 */
export async function activateNetwork(businessName, bias = {}) {
  const trimmed = String(businessName || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      action: 'activate_network',
      businessName: '',
      addedCount: 0,
      portfolioTotal: loadPortfolio().length,
      recoverableGapUsd: 0,
      topOpportunity: null,
      competitiveScore: 50,
      coolOffAlert: null,
      error: 'empty-business-name',
    };
  }

  const { addedCount, error } = await searchAndAddBusiness(trimmed, bias);
  const portfolio = loadPortfolio();

  if (portfolio.length === 0) {
    return {
      ok: false,
      action: 'activate_network',
      businessName: trimmed,
      addedCount: 0,
      portfolioTotal: 0,
      recoverableGapUsd: 0,
      topOpportunity: null,
      competitiveScore: 50,
      coolOffAlert: null,
      error: error || 'no-locations-found',
    };
  }

  await ensureSitesLayerEnabled();
  sitesLayer.fitPortfolioBounds(portfolio);

  const ranked = rankSitesByGap(portfolio);
  const recoverableGapUsd = totalRecoverableGapUsd(ranked);
  const top = ranked[0] || null;

  if (top?.site?.id) {
    window.setTimeout(() => focusSite(top.site.id), 800);
  }

  // Run competitive & cool-off scan
  const { biasLat, biasLon } = cameraBias();
  // Both stay null when the underlying scan could not run. The old default of
  // 65 made an unavailable competitive scan indistinguishable from a measured
  // mid-range score.
  let compScore = null;
  let coolOffAlert = null;
  try {
    const [compRes, coolRes] = await Promise.all([
      analyzeCompetitivePosition(trimmed, null, { biasLat, biasLon }),
      evaluateCoolOffOpportunities({ biasLat, biasLon }),
    ]);
    compScore = compRes?.success ? compRes.averageDominanceScore : null;
    coolOffAlert = coolRes?.success ? coolRes.readout : null;
  } catch {}

  return {
    ok: true,
    action: 'activate_network',
    businessName: trimmed,
    addedCount,
    portfolioTotal: portfolio.length,
    recoverableGapUsd,
    topOpportunity: top
      ? {
          name: top.site.name,
          address: top.site.address,
          gapUsd: top.score.gapUsd,
          confidence: top.score.confidence,
        }
      : null,
    competitiveScore: compScore,
    coolOffAlert,
  };
}

function setBriefStatus(element, status) {
  if (!element) return;
  element.dataset.status = status;
  if (status === 'loading') element.textContent = 'Loading…';
  else if (status === 'unavailable') element.textContent = 'Unavailable';
  else if (status === 'no-key') element.textContent = 'API key required';
  else if (status === 'no-coverage') element.textContent = 'No coverage near this site';
  else if (status === 'ready') element.textContent = '';
}

function renderWeather(payload) {
  if (!_dom) return;
  if (!payload || payload.status === 'unavailable' || !payload.weather) {
    setBriefStatus(_dom.weatherStatus, payload?.status || 'unavailable');
    _dom.weather.replaceChildren();
    return;
  }
  setBriefStatus(_dom.weatherStatus, 'ready');
  const w = payload.weather;
  const tempC = Number.isFinite(w.temperatureC) ? `${Math.round(w.temperatureC)}°C` : '--';
  const label = weatherCodeLabel(w.weatherCode) || 'Conditions unavailable';
  const wind = Number.isFinite(w.windSpeedKmh) ? ` · ${Math.round(w.windSpeedKmh)} km/h wind` : '';
  _dom.weather.textContent = `${tempC} · ${label}${wind}`;
}

function renderTraffic(result) {
  if (!_dom) return;
  if (!result || result.status !== 'ready') {
    setBriefStatus(_dom.trafficStatus, result?.status || 'unavailable');
    _dom.traffic.replaceChildren();
    return;
  }
  setBriefStatus(_dom.trafficStatus, 'ready');
  const level = Number.isFinite(result.trafficLevel) ? Math.round(result.trafficLevel * 100) : null;
  const speedWord = level === null ? 'Unknown' : level < 25 ? 'Free-flow' : level < 60 ? 'Moderate' : 'Heavy delay';
  const closureNote = result.closure ? ' · Road closed' : '';
  const roadType = result.roadType ? ` on ${result.roadType}` : '';
  const dist = Number.isFinite(result.distanceM) ? ` (${result.distanceM}m away)` : '';
  _dom.traffic.textContent = `${speedWord}${roadType}${dist}${closureNote}`;
}

function renderBrief(record) {
  if (!_dom) return;
  _briefAbort?.abort();
  const controller = new AbortController();
  _briefAbort = controller;
  const requestToken = ++_briefRequestToken;

  _dom.briefEmpty.hidden = true;
  _dom.briefContent.hidden = false;
  _dom.briefName.textContent = record.label || 'Unnamed Site';
  _dom.briefAddress.textContent = record.properties?.address || '';
  _dom.briefFormat.textContent = record.properties?.format ? `Format: ${record.properties.format}` : '';
  _dom.briefRef.textContent = record.properties?.externalRef ? `Ref: ${record.properties.externalRef}` : '';

  setBriefStatus(_dom.weatherStatus, 'loading');
  setBriefStatus(_dom.trafficStatus, 'loading');
  _dom.weather.replaceChildren();
  _dom.traffic.replaceChildren();

  const lat = record.latitude;
  const lon = record.longitude;
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
 * Initialize SITES panel and interactive intelligence controls.
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
    const nextMode = sitesLayer.cycleHeatmapMode();
    if (_dom.heatmapToggleBtn) {
      _dom.heatmapToggleBtn.textContent = `HEATMAP: ${nextMode.toUpperCase()}`;
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
  window.addEventListener('r1:entity-selected', _contextSelectedHandler);
  window.addEventListener('r1:entity-selection-cleared', _contextClearedHandler);
}

export function destroySitesPanel() {
  if (_contextSelectedHandler) window.removeEventListener('r1:entity-selected', _contextSelectedHandler);
  if (_contextClearedHandler) window.removeEventListener('r1:entity-selection-cleared', _contextClearedHandler);
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
