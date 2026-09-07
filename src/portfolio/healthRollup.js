/**
 * @file The two questions the console exists to answer:
 *   `getViewHealth()`      — "How is this view doing?"
 *   `getPortfolioHealth()` — "How's my entire business doing?"
 *
 * `analystEngine` returns a filtered RECORD SET; these return an AGGREGATE.
 * That is the whole reason this module is separate: the engine's query grammar
 * cannot express "roll up everything you know about these sites and tell me
 * where the money is", and stuffing an aggregation verb into it would make
 * every existing query pay for it.
 *
 * The invariant every field here obeys: a number that was not measured is
 * `null`, and the `coverage` block says how many sites each figure actually
 * rests on. A rollup that silently averages over the two sites that happened
 * to have data, and presents it as the portfolio, is the most dangerous
 * possible output of this product.
 *
 * @module portfolio/healthRollup
 */

import { loadPortfolio } from './portfolioStore.js';
import { haversineMeters } from './siteTraffic.js';
import { rankSitesByGap, totalRecoverableGapUsd } from './gapModel.js';

/** Mean of the finite values only, or null when there are none. */
export function meanOrNull(values) {
  const finite = (values || []).filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/**
 * Summarise a set of site records that already carry their measurements.
 *
 * Pure — every input arrives as an argument, so this is directly testable
 * without a viewer, a portfolio, or a network.
 *
 * @param {object[]} siteRecords Records from `sitesLayer.getAnalystRecords()`.
 * @param {object[]} trafficRecords Records from `traffic.getAnalystRecords()`.
 * @param {{scopeLabel?: string, priceBySiteId?: Map<string, object>}} [opts]
 * @returns {object}
 */
export function summarizeSites(siteRecords, trafficRecords, { scopeLabel = 'in view', priceBySiteId = null } = {}) {
  const sites = Array.isArray(siteRecords) ? siteRecords : [];
  const traffic = Array.isArray(trafficRecords) ? trafficRecords : [];

  const own = sites.filter((s) => !s.isCompetitor);
  const competitors = sites.filter((s) => s.isCompetitor);

  const withFlow = own.filter((s) => s.hasLiveFlow);
  const congested = withFlow.filter((s) => Number(s.trafficLevel) > 0.75);
  const closed = withFlow.filter((s) => s.isClosure);

  const meanCongestion = meanOrNull(withFlow.map((s) => s.congestionScore));
  const worstCongested = [...withFlow]
    .sort((a, b) => (b.congestionScore ?? -1) - (a.congestionScore ?? -1))[0] || null;

  // Traffic corridors in the same scope.
  const bottlenecks = traffic.filter((t) => t.frustrationScore >= 60 || t.delayMin >= 3);
  const closures = traffic.filter((t) => t.isClosure);
  const maxDelayMin = bottlenecks.length
    ? Math.max(...bottlenecks.map((b) => b.delayMin).filter(Number.isFinite))
    : null;

  // Price position, only over sites that actually carry a price.
  const priced = priceBySiteId
    ? own.map((s) => ({ site: s, price: priceBySiteId.get(s.id) || null })).filter((r) => r.price)
    : [];
  const meanVsAnchor = meanOrNull(priced.map((r) => r.price.priceVsAnchorCents));
  const aboveAnchor = priced.filter((r) => Number(r.price.priceVsAnchorCents) > 0).length;

  // Dollar gap: only real when actuals exist. `rankSitesByGap` returns
  // placeholder-confidence rows, so the total is reported alongside its
  // confidence rather than as a measured figure.
  const ranked = rankSitesByGap(own);
  const measuredGapRows = ranked.filter((r) => r.score?.confidence === 'measured');
  const recoverableGapUsd = measuredGapRows.length > 0
    ? totalRecoverableGapUsd(measuredGapRows)
    : null;

  return {
    scopeLabel,
    siteCount: own.length,
    competitorCount: competitors.length,

    traffic: {
      sitesWithLiveFlow: withFlow.length,
      congestedSites: withFlow.length ? congested.length : null,
      closedAccessSites: withFlow.length ? closed.length : null,
      meanCongestionScore: meanCongestion === null ? null : Math.round(meanCongestion),
      worstSite: worstCongested
        ? { id: worstCongested.id, name: worstCongested.name, congestionScore: worstCongested.congestionScore }
        : null,
      corridorBottlenecks: traffic.length ? bottlenecks.length : null,
      corridorClosures: traffic.length ? closures.length : null,
      maxCorridorDelayMin: maxDelayMin,
    },

    price: {
      sitesWithPrice: priced.length,
      meanCentsVsAnchor: meanVsAnchor === null ? null : Math.round(meanVsAnchor * 10) / 10,
      sitesAboveAnchor: priced.length ? aboveAnchor : null,
    },

    economics: {
      recoverableGapUsd,
      // Named so no surface can render a placeholder total as a measured one.
      gapConfidence: measuredGapRows.length > 0 ? 'measured' : 'requires-actuals',
      rankedTop: ranked.slice(0, 5).map((r) => ({
        siteId: r.site.id,
        name: r.site.name,
        gapUsd: r.score.gapUsd,
        confidence: r.score.confidence,
      })),
    },

    // What each figure above actually rests on.
    coverage: {
      sitesTotal: own.length,
      flowCoverage: own.length ? withFlow.length / own.length : 0,
      priceCoverage: own.length ? priced.length / own.length : 0,
      trafficSegments: traffic.length,
    },
  };
}

/**
 * One plain-language line describing a rollup, with its coverage stated.
 * @param {ReturnType<typeof summarizeSites>} rollup
 * @returns {string}
 */
export function describeHealth(rollup) {
  if (!rollup || rollup.siteCount === 0) {
    return `No portfolio sites ${rollup?.scopeLabel || 'in view'}.`;
  }
  const parts = [`${rollup.siteCount} site${rollup.siteCount === 1 ? '' : 's'} ${rollup.scopeLabel}`];

  const t = rollup.traffic;
  if (t.sitesWithLiveFlow === 0) {
    parts.push('no live road flow measured for any of them');
  } else {
    parts.push(`live flow on ${t.sitesWithLiveFlow}/${rollup.siteCount}, mean congestion ${t.meanCongestionScore}/100`);
    if (t.congestedSites > 0) {
      parts.push(`${t.congestedSites} heavily congested${t.worstSite ? ` (worst ${t.worstSite.name})` : ''}`);
    }
    if (t.corridorClosures > 0) parts.push(`${t.corridorClosures} corridor closure${t.corridorClosures === 1 ? '' : 's'}`);
    if (Number.isFinite(t.maxCorridorDelayMin)) parts.push(`peak corridor delay +${t.maxCorridorDelayMin} min`);
  }

  const p = rollup.price;
  if (p.sitesWithPrice > 0) {
    const sign = p.meanCentsVsAnchor > 0 ? 'above' : 'below';
    parts.push(`${p.sitesWithPrice} priced, mean ${Math.abs(p.meanCentsVsAnchor)}¢ ${sign} the regional anchor`);
  }

  const e = rollup.economics;
  parts.push(e.gapConfidence === 'measured'
    ? `recoverable gap $${Math.round(e.recoverableGapUsd).toLocaleString()}/yr`
    : 'dollar gap needs actual volumes — not modelled from public data alone');

  return `${parts.join('. ')}.`;
}

/**
 * "How is this view doing?" — scoped to the current camera.
 *
 * @param {{
 *   getRecords: (layerKey: string) => object[],
 *   getViewContext: () => {lat: number, lon: number, viewRadiusKm: number},
 *   getPrices?: () => Map<string, object>
 * }} providers Same provider shape the analyst engine takes.
 * @returns {object}
 */
export function getViewHealth(providers) {
  const view = providers.getViewContext();
  const radiusM = Math.max(0, Number(view.viewRadiusKm) || 0) * 1000;

  const inScope = (record) => Number.isFinite(record?.lat) && Number.isFinite(record?.lon)
    && haversineMeters(view.lat, view.lon, record.lat, record.lon) <= radiusM;

  const sites = (providers.getRecords('sites') || []).filter(inScope);
  const traffic = (providers.getRecords('traffic') || []).filter(inScope);

  const rollup = summarizeSites(sites, traffic, {
    scopeLabel: `within ${Math.round(view.viewRadiusKm)} km of view centre`,
    priceBySiteId: providers.getPrices?.() || null,
  });
  return { ...rollup, readout: describeHealth(rollup) };
}

/**
 * "How's my entire business doing?" — the whole loaded portfolio, regardless
 * of where the camera is pointing, with a per-region breakdown.
 *
 * @param {{getRecords: (layerKey: string) => object[], getPrices?: () => Map<string, object>}} providers
 * @returns {object}
 */
export function getPortfolioHealth(providers) {
  const all = providers.getRecords('sites') || [];
  // Traffic records only cover the current viewport, so a portfolio-wide
  // rollup includes them for context but never implies they cover every site —
  // `coverage.flowCoverage` is what tells the truth about that.
  const traffic = providers.getRecords('traffic') || [];

  const rollup = summarizeSites(all, traffic, {
    scopeLabel: 'across the portfolio',
    priceBySiteId: providers.getPrices?.() || null,
  });

  // Regional breakdown by the site's own regionId when the import carried one.
  const byRegion = new Map();
  for (const site of all.filter((s) => !s.isCompetitor)) {
    const key = site.regionId || site.brand || 'unassigned';
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(site);
  }
  const regions = [...byRegion.entries()]
    .map(([key, sites]) => ({
      region: key,
      siteCount: sites.length,
      meanCongestionScore: (() => {
        const m = meanOrNull(sites.filter((s) => s.hasLiveFlow).map((s) => s.congestionScore));
        return m === null ? null : Math.round(m);
      })(),
      sitesWithLiveFlow: sites.filter((s) => s.hasLiveFlow).length,
    }))
    .sort((a, b) => b.siteCount - a.siteCount);

  const totalPortfolio = loadPortfolio().length;

  return {
    ...rollup,
    regions,
    // A site with no coordinates never reaches the layer's records, and would
    // otherwise vanish from the count without explanation.
    ungeocodedSites: Math.max(0, totalPortfolio - rollup.siteCount - rollup.competitorCount),
    readout: describeHealth(rollup),
  };
}
