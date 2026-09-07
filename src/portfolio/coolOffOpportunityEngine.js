/**
 * @file Commuter "Cool-Off" Conversion Opportunity Engine.
 * 
 * Detects high-friction traffic gridlock, road construction, and bottlenecks
 * near client store locations where annoyed, fatigued commuters are prime
 * candidates for a "cool-off" detour break (coffee, cold drinks, quick bites,
 * convenience, gas, impulse retail).
 * 
 * Evaluates:
 *  - Corridor Annoyance Index (Delay minutes * Traffic density).
 *  - Egress Detour Feasibility (Distance from bottleneck exit to business site).
 *  - Cool-off Conversion Opportunity Score (0-100).
 *  - Estimated Incremental Detour Footfall & Recommended Actionable Promos.
 * 
 * @module portfolio/coolOffOpportunityEngine
 */

import { fetchTrafficDelays } from './trafficDelayEngine.js';
import { loadPortfolio } from './portfolioStore.js';
import { haversineMeters } from './siteTraffic.js';
import { approachSideForSite } from './approachSide.js';
import { selectPlays } from './playLibrary.js';

/** Category propensity multiplier for cool-off detours */
const COOL_OFF_CATEGORY_WEIGHTS = {
  coffee: 1.35,
  cafe: 1.35,
  beverage: 1.30,
  boba: 1.30,
  convenience: 1.25,
  fast_food: 1.20,
  restaurant: 1.15,
  gas_station: 1.25,
  retail: 1.05,
  default: 1.10,
};

/**
 * Infer category multiplier from site name/format.
 * @param {object} site
 * @returns {number}
 */
export function getCategoryMultiplier(site) {
  const text = `${site?.name || ''} ${site?.format || ''}`.toLowerCase();
  for (const [key, weight] of Object.entries(COOL_OFF_CATEGORY_WEIGHTS)) {
    if (text.includes(key)) return weight;
  }
  if (/starbucks|dunkin|peet|dutch|coffee|tea|boba/i.test(text)) return 1.35;
  if (/taco|burger|chipotle|chick-fil-a|casey|7-eleven|walgreens/i.test(text)) return 1.25;
  return COOL_OFF_CATEGORY_WEIGHTS.default;
}

/**
 * Score one site against surrounding traffic bottlenecks for cool-off conversion potential.
 * @param {object} site
 * @param {object[]} bottlenecks
 * @returns {object|null}
 */
export function scoreCoolOffOpportunity(site, bottlenecks, allSegments = null) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return null;
  if (!Array.isArray(bottlenecks) || bottlenecks.length === 0) return null;

  let bestBottleneck = null;
  let minDistanceM = Infinity;

  for (const b of bottlenecks) {
    if (!Number.isFinite(b.midLat) || !Number.isFinite(b.midLon)) continue;
    const distM = haversineMeters(site.lat, site.lon, b.midLat, b.midLon);
    if (distM < minDistanceM) {
      minDistanceM = distM;
      bestBottleneck = { ...b, distM: Math.round(distM) };
    }
  }

  if (!bestBottleneck || minDistanceM > 3500) {
    // No bottleneck within 3.5km
    return null;
  }

  const categoryWeight = getCategoryMultiplier(site);
  // No default delay. A bottleneck without a measured delay figure is not a
  // scoreable opportunity — the old `|| 5.0` invented five minutes of traffic.
  if (!Number.isFinite(bestBottleneck.delayMin)) return null;
  const delayMin = bestBottleneck.delayMin;
  const isConstruction = Boolean(bestBottleneck.isConstruction || bestBottleneck.isClosure);

  // Annoyance Factor: increases steeply with delay duration & construction
  const annoyanceFactor = Math.min(3.5, 1.0 + (delayMin / 8.0) * (isConstruction ? 1.4 : 1.0));

  // Detour proximity penalty (closer sites get vastly higher conversion)
  const proximityBonus = Math.max(0, 1.0 - minDistanceM / 2500); // 1.0 at 0m, 0.0 at 2.5km

  // Raw score calculation (0-100)
  const rawScore = (annoyanceFactor * 24 + proximityBonus * 45 + (isConstruction ? 15 : 5)) * (categoryWeight / 1.1);
  const conversionScore = Math.min(100, Math.max(15, Math.round(rawScore)));

  // Deliberately NO absolute "incremental visits/hour" figure. The previous
  // version multiplied the score by a hard-coded 450 vehicles/hour that came
  // from nowhere and surfaced as a concrete forecast. Until a site has either
  // an AADT count or the operator's own footfall data, the honest output is a
  // ranking score plus the measured inputs behind it.
  const urgencyLevel = conversionScore >= 80
    ? 'High'
    : conversionScore >= 60
      ? 'Elevated'
      : 'Moderate';

  // Which side of the jammed direction the site sits on. Needs the full
  // segment set to tell a divided carriageway from an undivided road.
  const approachInfo = approachSideForSite(site, bestBottleneck, allSegments);

  const signals = {
    delayMin,
    distanceToBottleneckM: Math.round(minDistanceM),
    approach: approachInfo.approach,
    conversionScore,
    isConstruction,
    categoryText: `${site.name || ''} ${site.format || ''}`,
  };

  // Recommendations are LOOKUPS against the play library, not composed text.
  const matched = selectPlays(signals);

  return {
    siteId: site.id,
    siteName: site.name,
    address: site.address,
    lat: site.lat,
    lon: site.lon,
    conversionScore,
    urgencyLevel,
    delayMin,
    distanceToBottleneckM: Math.round(minDistanceM),
    isConstruction,
    approach: approachInfo.approach,
    approachSide: approachInfo.side,
    approachDivided: approachInfo.divided,
    offsetFromRoadM: approachInfo.offsetM,
    plays: matched.map(({ play }) => ({
      id: play.id,
      name: play.name,
      action: play.action,
      rationale: play.rationale,
      expectedLiftPct: play.expectedLiftPct,
      requiresApproval: play.requiresApproval,
    })),
    bottleneckRoadType: bestBottleneck.roadType,
    bottleneckStatus: bestBottleneck.delayStatus,
    // Delay and distance are measured; the conversion score is a ranking
    // convention over them, with no fitted coefficient behind it.
    confidence: 'measured-inputs-ranked',
  };
}

/**
 * Scan all active portfolio sites and rank cool-off conversion opportunities.
 * 
 * @param {{ biasLat?: number, biasLon?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{
 *   success: boolean,
 *   totalSitesScanned: number,
 *   opportunities: object[],
 *   topOpportunity: object|null,
 *   activeConstructionCount: number|null,
 *   confidence: string,
 *   readout: string
 * }>}
 *   `success: false` when live traffic is unavailable — "cannot tell" is
 *   reported as itself, never as "no opportunities".
 */
export async function evaluateCoolOffOpportunities({ biasLat = 30.2672, biasLon = -97.7431, signal } = {}) {
  const sites = loadPortfolio().filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon));
  // With no portfolio loaded, scan the point the camera is actually over. It
  // is a real location, and is named as an ad-hoc scan point rather than
  // dressed up as one of the operator's sites.
  const effectiveSites = sites.length > 0
    ? sites
    : [{
      id: 'scan:current-view',
      name: 'Current view',
      address: `${biasLat.toFixed(4)}, ${biasLon.toFixed(4)}`,
      lat: biasLat,
      lon: biasLon,
      isAdHocScanPoint: true,
    }];

  const centerLat = effectiveSites[0].lat;
  const centerLon = effectiveSites[0].lon;

  const trafficData = await fetchTrafficDelays(centerLat, centerLon, { radiusKm: 8, signal });

  // Traffic unavailable is not "no opportunities" — it is "we cannot tell",
  // and the two must not collapse into the same reassuring sentence.
  if (trafficData.status !== 'ready') {
    return {
      success: false,
      status: trafficData.status,
      totalSitesScanned: effectiveSites.length,
      opportunities: [],
      topOpportunity: null,
      activeConstructionCount: null,
      confidence: 'unavailable',
      readout: `COOL-OFF — cannot evaluate: ${trafficData.readout}`,
    };
  }

  const bottlenecks = trafficData.bottlenecks || [];
  const allSegments = trafficData.delays || [];

  const scoredOpportunities = effectiveSites
    .map((site) => scoreCoolOffOpportunity(site, bottlenecks, allSegments))
    .filter(Boolean)
    .sort((a, b) => b.conversionScore - a.conversionScore);

  const topOpp = scoredOpportunities[0] || null;
  const constructionCount = trafficData.constructionZones?.length || 0;
  const actionable = scoredOpportunities.filter((o) => o.plays.some((p) => p.requiresApproval));

  const readout = topOpp && topOpp.plays.length > 0
    ? `COOL-OFF — ${topOpp.siteName}: +${topOpp.delayMin} min measured on an adjacent ${topOpp.bottleneckRoadType || 'road'}${topOpp.isConstruction ? ' (closure/construction)' : ''}, ${topOpp.distanceToBottleneckM} m away, ${topOpp.approach === 'ambiguous' ? 'approach side undetermined' : `${topOpp.approach}-side approach`}. ${topOpp.plays.length} play${topOpp.plays.length === 1 ? '' : 's'} match; lift unmeasured. Score ${topOpp.conversionScore}/100.`
    : `COOL-OFF — scanned ${effectiveSites.length} location${effectiveSites.length === 1 ? '' : 's'} against ${bottlenecks.length} measured bottleneck${bottlenecks.length === 1 ? '' : 's'}. No play thresholds met.`;

  return {
    success: true,
    status: 'ready',
    totalSitesScanned: effectiveSites.length,
    opportunities: scoredOpportunities,
    topOpportunity: topOpp,
    actionableCount: actionable.length,
    activeConstructionCount: constructionCount,
    confidence: 'measured-inputs-ranked',
    readout,
  };
}
