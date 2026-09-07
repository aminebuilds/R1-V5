/**
 * @file Competitive Research & Intelligence Benchmarking Engine.
 * 
 * Provides spatial competitive analysis ("How am I doing vs competitors?"):
 *  - Discovers and maps competitor store networks within the target zone.
 *  - Calculates Market Density (1km/3km/5km radii).
 *  - Estimates Traffic Capture Share & Corridors.
 *  - Access friction & delay exposure vs competitors.
 *  - Outputs Composite Competitive Score (0-100) and JARVIS voice briefings.
 * 
 * @module portfolio/competitiveEngine
 */

import { searchBusinessSites } from './businessSearch.js';
import { loadPortfolio } from './portfolioStore.js';
import { haversineMeters, fetchSiteTraffic } from './siteTraffic.js';

/** Default competitor category pairings if not explicitly specified */
export const DEFAULT_COMPETITOR_MAP = {
  starbucks: ["Dunkin'", "Dutch Bros Coffee", "Peet's Coffee"],
  mcdonalds: ["Burger King", "Wendy's", "Chick-fil-A"],
  target: ['Walmart', 'Costco', 'Kohl\'s'],
  torchys: ["Chipotle", "Taco Bell", "Freebirds World Burrito"],
  caseys: ["7-Eleven", "Circle K", "QuikTrip", "Buc-ee's"],
  heb: ['Whole Foods Market', 'Trader Joe\'s', 'Randalls', 'Kroger'],
};

/**
 * Identify competitor names for a given brand name.
 * @param {string} brandName
 * @returns {string[]}
 */
export function inferCompetitors(brandName) {
  const clean = String(brandName || '').toLowerCase().replace(/[^\w]/g, '');
  for (const [key, comps] of Object.entries(DEFAULT_COMPETITOR_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return comps;
    }
  }
  // Unknown brand: fall back to a CATEGORY search that actually resolves to
  // real nearby businesses. The old fallback returned the literal strings
  // "Primary Competitor"/"Regional Competitor", which match nothing upstream
  // and so guaranteed an empty search — which the removed synthetic branch
  // then filled with fabricated stores.
  return ['gas station', 'convenience store'];
}

/**
 * Score competitive position for one client site against nearby competitor
 * sites.
 *
 * Every field here is derived from real measured geometry — counted competitor
 * locations at measured distances, plus (optionally) a live TomTom flow
 * reading for the adjacent road. The previous version of this function
 * manufactured a "14k–42k vehicles/day" figure out of
 * `sin(lat·12.9898 + lon·78.233)` and an access-friction label from the same
 * hash. Both are gone: a plausible number with no relationship to reality is
 * worse than an absent one, because voice narration read it aloud as fact.
 *
 * @param {object} site Client site
 * @param {object[]} competitorSites Array of competitor sites
 * @param {{trafficLevel?: number, roadType?: string, closure?: boolean}} [flow]
 *   Live flow reading for the site's nearest road, from `fetchSiteTraffic`.
 *   Omitted when traffic is unavailable — the access fields then read `null`.
 * @returns {object|null}
 */
export function scoreSiteVsCompetitors(site, competitorSites, flow = null) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return null;

  const within1km = [];
  const within3km = [];
  const within5km = [];

  for (const comp of competitorSites) {
    if (!comp || !Number.isFinite(comp.lat) || !Number.isFinite(comp.lon)) continue;
    const distM = haversineMeters(site.lat, site.lon, comp.lat, comp.lon);
    if (distM <= 1000) within1km.push({ ...comp, distM });
    if (distM <= 3000) within3km.push({ ...comp, distM });
    if (distM <= 5000) within5km.push({ ...comp, distM });
  }

  // Access friction comes from the measured flow reading, or not at all.
  const hasFlow = flow && Number.isFinite(flow.trafficLevel);
  const accessFriction = !hasFlow
    ? null
    : flow.closure
      ? 'Closed'
      : flow.trafficLevel > 0.75
        ? 'High delay'
        : flow.trafficLevel > 0.45
          ? 'Moderate'
          : 'Smooth flow';

  // Territorial dominance is a pure competitor-density measure on measured
  // distances: 100 with no competitor inside 3 km, falling as rings fill.
  const densityPenalty = within1km.length * 18 + within3km.length * 5;
  const dominanceScore = Math.max(0, Math.min(100, Math.round(100 - densityPenalty)));

  const status = dominanceScore >= 75
    ? 'Uncontested'
    : dominanceScore >= 50
      ? 'Contested'
      : 'Saturated';

  return {
    siteId: site.id,
    siteName: site.name,
    address: site.address,
    lat: site.lat,
    lon: site.lon,
    competitorsWithin1km: within1km.length,
    competitorsWithin3km: within3km.length,
    competitorsWithin5km: within5km.length,
    nearestCompetitor: within5km.sort((a, b) => a.distM - b.distM)[0] || null,
    trafficLevel: hasFlow ? flow.trafficLevel : null,
    roadType: hasFlow ? (flow.roadType || null) : null,
    accessFriction,
    dominanceScore,
    status,
    // Counted competitors at measured distances. The dominance weighting is a
    // convention, not a fitted coefficient.
    confidence: 'measured-density',
  };
}

/**
 * Execute full competitive benchmarking analysis.
 * 
 * @param {string} [brandName] - Optional primary brand name (defaults to active portfolio brand)
 * @param {string[]} [competitorNames] - Optional list of competitors to benchmark against
 * @param {{ biasLat?: number, biasLon?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{
 *   success: boolean,
 *   primaryBrand: string,
 *   competitorBrands: string[],
 *   clientSitesCount: number,
 *   competitorSitesCount: number,
 *   marketSharePct: number,
 *   averageDominanceScore: number,
 *   siteBreakdowns: object[],
 *   competitorSites: object[],
 *   confidence: string,
 *   readout: string
 * }>}
 *   `success: false` with a `status` of `no-client-sites` or
 *   `no-competitors-found` when there is nothing real to compare — never
 *   synthesized stand-ins.
 */
export async function analyzeCompetitivePosition(
  brandName,
  competitorNames,
  { biasLat = 30.2672, biasLon = -97.7431, signal } = {}
) {
  let clientSites = loadPortfolio().filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon));
  let resolvedBrand = brandName;

  // If no brand specified, infer from first portfolio item
  if (!resolvedBrand && clientSites.length > 0) {
    resolvedBrand = clientSites[0].name.split(/\s*[-#·,]/)[0].trim();
  }
  resolvedBrand = resolvedBrand || 'Your Brand';

  // If portfolio empty or brand explicitly given with no loaded sites, search for client sites
  if (clientSites.length === 0 && brandName) {
    const searchRes = await searchBusinessSites(brandName, { biasLat, biasLon, signal });
    if (searchRes?.sites?.length) {
      clientSites = searchRes.sites;
    }
  }

  // Resolve competitor search targets
  let targetCompetitors = Array.isArray(competitorNames) && competitorNames.length > 0
    ? competitorNames
    : inferCompetitors(resolvedBrand);

  const competitorSites = [];
  for (const compName of targetCompetitors) {
    try {
      const res = await searchBusinessSites(compName, { biasLat, biasLon, signal });
      if (res?.sites?.length) {
        for (const s of res.sites) {
          competitorSites.push({
            ...s,
            brand: compName,
            isCompetitor: true,
          });
        }
      }
    } catch {}
  }

  // Deduplicate competitor sites
  const dedupedComps = [];
  const seen = new Set();
  for (const c of competitorSites) {
    const key = `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedComps.push(c);
    }
  }

  // No synthetic fallback. An empty competitor search means the search found
  // nothing — which is a real, reportable answer — and must never be papered
  // over with manufactured "#101"-style stores returned as `success: true`.
  if (clientSites.length === 0) {
    return {
      success: false,
      status: 'no-client-sites',
      primaryBrand: resolvedBrand,
      competitorBrands: targetCompetitors,
      clientSitesCount: 0,
      competitorSitesCount: dedupedComps.length,
      marketSharePct: null,
      averageDominanceScore: null,
      siteBreakdowns: [],
      competitorSites: dedupedComps,
      confidence: 'unavailable',
      readout: `COMPETITIVE — no ${resolvedBrand} locations loaded. Import a portfolio or search the brand first.`,
    };
  }
  if (dedupedComps.length === 0) {
    return {
      success: false,
      status: 'no-competitors-found',
      primaryBrand: resolvedBrand,
      competitorBrands: targetCompetitors,
      clientSitesCount: clientSites.length,
      competitorSitesCount: 0,
      marketSharePct: null,
      averageDominanceScore: null,
      siteBreakdowns: [],
      competitorSites: [],
      confidence: 'unavailable',
      readout: `COMPETITIVE — searched ${targetCompetitors.join(', ')} near this area and found no locations. Either none are mapped here, or the search upstream is unavailable.`,
    };
  }

  // Live flow per site, fetched concurrently. Unavailable readings stay null
  // rather than defaulting to a plausible-looking level.
  const flows = await Promise.all(clientSites.map(async (site) => {
    try {
      const reading = await fetchSiteTraffic(site.lat, site.lon, { signal });
      return reading?.status === 'ready' ? reading : null;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return null;
    }
  }));

  const siteBreakdowns = clientSites
    .map((site, i) => scoreSiteVsCompetitors(site, dedupedComps, flows[i]))
    .filter(Boolean);

  const totalLocations = clientSites.length + dedupedComps.length;
  const marketSharePct = Math.round((clientSites.length / totalLocations) * 100);

  const totalDominance = siteBreakdowns.reduce((sum, b) => sum + b.dominanceScore, 0);
  const avgDominance = siteBreakdowns.length > 0
    ? Math.round(totalDominance / siteBreakdowns.length)
    : null;

  const topSite = [...siteBreakdowns].sort((a, b) => b.dominanceScore - a.dominanceScore)[0];
  const uncontestedCount = siteBreakdowns.filter((s) => s.dominanceScore >= 75).length;
  const flowCoverage = flows.filter(Boolean).length;

  const readout = `COMPETITIVE — ${clientSites.length} ${resolvedBrand} location${clientSites.length === 1 ? '' : 's'} against ${dedupedComps.length} mapped competitor site${dedupedComps.length === 1 ? '' : 's'} (${targetCompetitors.join(', ')}). Location share of mapped set: ${marketSharePct}%. Mean territorial score ${avgDominance}/100; ${uncontestedCount} uncontested${topSite ? `, strongest ${topSite.siteName}` : ''}. Live road flow resolved for ${flowCoverage}/${clientSites.length}.`;

  return {
    success: true,
    status: 'ready',
    primaryBrand: resolvedBrand,
    competitorBrands: targetCompetitors,
    clientSitesCount: clientSites.length,
    competitorSitesCount: dedupedComps.length,
    // Share of MAPPED locations in the searched area, not market share by
    // revenue or volume — the name is deliberately narrow.
    marketSharePct,
    averageDominanceScore: avgDominance,
    siteBreakdowns,
    competitorSites: dedupedComps,
    flowCoverage,
    confidence: 'measured-density',
    readout,
  };
}
