/**
 * @file Engine result → explanation blocks.
 *
 * One composer per operator question. Each is a pure function from a result
 * object the engines already return to an ordered block list, so composition
 * is testable in node and the renderer never has to know what a bottleneck is.
 *
 * The contract these functions enforce is the one in
 * docs/RETAIL-FUEL-INTELLIGENCE.md §05.3: an answer is a set of deterministic
 * engine outputs composed into a board, with each clause naming its source
 * and its kind. Nothing here invents a number, softens an unavailable feed
 * into a reassuring sentence, or promotes a modelled figure to a measured one.
 * Where a composer cannot say something, it emits a `gap` block that says so.
 *
 * @module explain/composers
 */

import { PLAYS } from '../portfolio/playLibrary.js';
import {
  band,
  chain,
  coverage,
  evidence,
  fmtCentsSigned,
  fmtInt,
  fmtMeters,
  fmtNum,
  fmtRatio,
  fmtUsd,
  gap,
  head,
  multiples,
  note,
  NO_VALUE,
  plays,
  provenanceForConfidence,
  ranked,
  readouts,
  sources,
  verdict,
  withIds,
} from './blocks.js';

/** Feed labels, written once so two boards never credit the same feed twice. */
export const FEEDS = Object.freeze({
  tomtom: { label: 'TomTom Traffic Flow', detail: 'Live segment speeds via /api/tomtom' },
  eia: { label: 'EIA Open Data v2', detail: 'Weekly retail + daily spot, US public domain' },
  places: { label: 'Google Places', detail: 'Text Search, brand and competitor locations' },
  portfolio: { label: 'Operator portfolio', detail: 'Imported sites, held locally in this browser' },
  playbook: { label: 'Play library', detail: 'src/portfolio/playLibrary.js — fixed, versioned' },
  layers: { label: 'Active map layers', detail: 'Whatever is rendered right now, nothing else' },
  ais: { label: 'AISStream', detail: 'Live vessel positions via /api/ais' },
});

/**
 * Drop an engine's own `LABEL — ` prefix. The board's header already says
 * which question this is, so repeating it inside the sentence is noise.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function stripReadoutPrefix(text) {
  return String(text || '').replace(/^[A-Z][A-Z0-9 \-/]{1,24}—\s*/, '').trim();
}

/**
 * Title-cased human label for an action id.
 * @param {string} action
 * @returns {string}
 */
export function actionLabel(action) {
  return String(action || 'answer').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Alphabetic key for a row index, matching across `ranked` and `multiples`. */
function keyAt(index) {
  return String.fromCharCode(65 + (index % 26));
}

/** Focus payload the board uses to fly the camera to a row's subject. */
function focusOf(record) {
  if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
  return {
    id: record.siteId || record.id || null,
    lat: Number(record.lat),
    lon: Number(record.lon),
    label: record.siteName || record.name || null,
  };
}

/**
 * The blocks every board opens with while its engines are still resolving.
 * @param {{question: string, scope?: string|null, action?: string|null}} init
 * @returns {object[]}
 */
export function composePending({ question, scope = null, action = null }) {
  return withIds([head({ question, scope, action, status: 'pending' })]);
}

/* ── Cool-off conversion ─────────────────────────────────────────────────── */

/**
 * Rebuild a play's trigger thresholds against the signals that were actually
 * measured, so the card shows which condition fired rather than asserting the
 * play applies. Thresholds come from the library, never from the result.
 *
 * @param {object} play Play summary from the engine.
 * @param {object} top Top opportunity.
 * @returns {Array<{label: string, display: string, met: boolean|null}>}
 */
export function triggersForPlay(play, top) {
  const definition = PLAYS.find((candidate) => candidate.id === play.id);
  if (!definition || !top) return [];
  const trigger = definition.trigger || {};
  const rows = [];

  if (Number.isFinite(trigger.minDelayMin)) {
    rows.push({
      label: `Corridor delay ≥ ${trigger.minDelayMin} min`,
      display: Number.isFinite(top.delayMin) ? `${fmtNum(top.delayMin, 1)} min` : NO_VALUE,
      met: Number.isFinite(top.delayMin) ? top.delayMin >= trigger.minDelayMin : null,
    });
  }
  if (Number.isFinite(trigger.maxDistanceM)) {
    rows.push({
      label: `Within ${fmtMeters(trigger.maxDistanceM)} of the jam`,
      display: fmtMeters(top.distanceToBottleneckM),
      met: Number.isFinite(top.distanceToBottleneckM) ? top.distanceToBottleneckM <= trigger.maxDistanceM : null,
    });
  }
  if (Array.isArray(trigger.approach)) {
    rows.push({
      label: `Approach side is ${trigger.approach.join(' or ')}`,
      display: top.approach || NO_VALUE,
      met: top.approach === 'ambiguous' ? null : trigger.approach.includes(top.approach),
    });
  }
  if (trigger.requiresConstruction) {
    rows.push({
      label: 'Closure or construction present',
      display: top.isConstruction ? 'yes' : 'no',
      met: Boolean(top.isConstruction),
    });
  }
  if (Number.isFinite(trigger.minConversionScore)) {
    rows.push({
      label: `Score ≥ ${trigger.minConversionScore}`,
      display: Number.isFinite(top.conversionScore) ? `${top.conversionScore}/100` : NO_VALUE,
      met: Number.isFinite(top.conversionScore) ? top.conversionScore >= trigger.minConversionScore : null,
    });
  }
  return rows;
}

/**
 * "Is there something worth running right now, and where?"
 * @param {object} result From `evaluateCoolOffOpportunities`.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeCoolOff(result, context = {}) {
  const question = context.question || 'Where is a promotion worth running right now?';
  const scope = context.scope || null;

  if (!result || result.success === false) {
    return withIds([
      head({ question, scope, action: 'get_cool_off_opportunities', status: 'error' }),
      gap({
        title: 'Cannot evaluate',
        reason: stripReadoutPrefix(result?.readout) || 'Live road flow is unavailable for this area.',
        missing: ['Measured congestion on the corridors around each site'],
        remedy: 'Set TOMTOM_API_KEY, or move the camera to a metro TomTom covers. '
          + 'No opportunity is reported from an unmeasured road.',
      }),
      sources({ items: [FEEDS.tomtom, FEEDS.portfolio] }),
    ]);
  }

  const top = result.topOpportunity;
  const opportunities = result.opportunities || [];
  const kind = provenanceForConfidence(result.confidence);

  const blocks = [
    head({ question, scope, action: 'get_cool_off_opportunities', status: 'ready' }),
    verdict({
      text: stripReadoutPrefix(result.readout),
      kind,
      score: top ? { value: top.conversionScore, max: 100, label: 'Conversion score' } : null,
    }),
  ];

  if (top) {
    blocks.push(readouts({
      items: [
        { label: 'Corridor delay', value: fmtNum(top.delayMin, 1), unit: 'min', kind: 'measured' },
        { label: 'Detour', value: fmtMeters(top.distanceToBottleneckM), kind: 'measured' },
        { label: 'Approach', value: top.approach || NO_VALUE, kind: 'derived' },
        { label: 'Sites scanned', value: fmtInt(result.totalSitesScanned), kind: 'measured' },
      ],
    }));

    blocks.push(chain({
      title: 'How this was reached',
      stages: [
        {
          key: '01',
          label: 'Congestion measured',
          value: `${fmtNum(top.delayMin, 1)} min on a ${top.bottleneckRoadType || 'road'}`,
          state: 'met',
          note: 'TomTom segment speed against published free-flow',
        },
        {
          key: '02',
          label: 'Site is in detour range',
          value: fmtMeters(top.distanceToBottleneckM),
          state: top.distanceToBottleneckM <= 1800 ? 'met' : 'unmet',
          note: 'Straight-line distance to the jammed segment midpoint',
        },
        {
          key: '03',
          label: 'Approach side',
          value: top.approach || NO_VALUE,
          state: top.approach === 'near' ? 'met' : top.approach === 'far' ? 'unmet' : 'na',
          note: top.approachDivided
            ? 'Divided carriageway — the turn across traffic is the constraint'
            : 'Undivided road — either side is reachable',
        },
        {
          key: '04',
          label: 'Play matched',
          value: top.plays?.[0]?.name || 'none',
          state: top.plays?.length ? 'met' : 'unmet',
          note: 'Looked up in the play library; not composed',
        },
        {
          key: '05',
          label: 'Expected lift',
          value: NO_VALUE,
          state: 'na',
          note: 'Stays blank until a holdout test measures it',
        },
      ],
    }));

    blocks.push(evidence({
      rows: [
        { claim: 'There is a traffic condition beside this site', source: 'trafficDelayEngine → bottlenecks[0]', kind: 'measured' },
        { claim: 'Drivers are already slowed', source: `delayMin ${fmtNum(top.delayMin, 1)} · frustration index`, kind: 'measured' },
        {
          claim: `The site sits on the ${top.approach || 'undetermined'} side of the jam`,
          source: 'approachSide.js — segment bearing vs. site bearing',
          kind: top.approach === 'ambiguous' ? 'unmeasured' : 'derived',
        },
        { claim: 'This intervention is the one to run', source: 'playLibrary.js — trigger lookup', kind: 'parameterised' },
        { claim: 'It will lift sales by X%', source: 'No holdout test has been run', kind: 'unmeasured' },
      ],
    }));
  }

  if (opportunities.length > 0) {
    blocks.push(ranked({
      title: 'Ranked opportunities',
      unit: 'score',
      max: 100,
      kind,
      rows: opportunities.slice(0, 8).map((opportunity, index) => ({
        key: keyAt(index),
        label: opportunity.siteName || 'Unnamed site',
        sub: `+${fmtNum(opportunity.delayMin, 1)} min · ${fmtMeters(opportunity.distanceToBottleneckM)} · ${opportunity.approach || 'side unknown'}`,
        value: opportunity.conversionScore,
        display: `${opportunity.conversionScore}/100`,
        tone: opportunity.conversionScore >= 80 ? 'alert' : opportunity.conversionScore >= 60 ? 'caution' : 'signal',
        focus: focusOf(opportunity),
      })),
    }));

    blocks.push(multiples({
      title: 'Per site',
      tiles: opportunities.slice(0, 6).map((opportunity, index) => ({
        key: keyAt(index),
        label: opportunity.siteName || 'Unnamed site',
        sub: opportunity.isConstruction ? 'closure / construction' : opportunity.bottleneckStatus || 'congested corridor',
        value: opportunity.conversionScore,
        display: String(opportunity.conversionScore),
        unit: '/100',
        tone: opportunity.conversionScore >= 80 ? 'alert' : opportunity.conversionScore >= 60 ? 'caution' : 'signal',
        focus: focusOf(opportunity),
      })),
    }));
  }

  if (top?.plays?.length) {
    blocks.push(plays({
      title: 'Plays that fired',
      cards: top.plays.map((play) => ({
        id: play.id,
        name: play.name,
        action: play.action,
        rationale: play.rationale,
        lift: {
          display: Number.isFinite(play.expectedLiftPct?.value) ? `${play.expectedLiftPct.value}%` : NO_VALUE,
          kind: Number.isFinite(play.expectedLiftPct?.value) ? 'measured' : 'unmeasured',
        },
        approval: play.requiresApproval ? 'required' : 'not-required',
        triggers: triggersForPlay(play, top),
      })),
    }));
  }

  blocks.push(coverage({
    bars: [
      {
        label: 'Sites with a measured bottleneck within 3.5 km',
        n: opportunities.length,
        of: result.totalSitesScanned,
        note: 'Sites outside that radius are not scored, not scored zero',
      },
    ],
  }));

  blocks.push(sources({ items: [FEEDS.tomtom, FEEDS.portfolio, FEEDS.playbook] }));
  return withIds(blocks);
}

/* ── View / portfolio health ─────────────────────────────────────────────── */

/**
 * "How is this view doing?" / "How is my business doing?"
 * @param {object} result From `getViewHealth` or `getPortfolioHealth`.
 * @param {{question?: string, scope?: string|null, action?: string}} [context]
 * @returns {object[]}
 */
export function composeHealth(result, context = {}) {
  const action = context.action || 'get_view_health';
  const portfolioWide = action === 'get_portfolio_health';
  const question = context.question
    || (portfolioWide ? 'How is my whole portfolio doing?' : 'How is this view doing?');
  const scope = context.scope || result?.scopeLabel || null;

  if (!result || !result.siteCount) {
    return withIds([
      head({ question, scope, action, status: 'ready' }),
      gap({
        title: 'No sites in scope',
        reason: portfolioWide
          ? 'No portfolio is loaded, so there is nothing to roll up.'
          : 'No portfolio site falls inside the current view.',
        missing: ['A site network on the globe'],
        remedy: 'Search a business name or import a CSV from the SITES panel, then ask again.',
      }),
      sources({ items: [FEEDS.portfolio] }),
    ]);
  }

  const traffic = result.traffic || {};
  const price = result.price || {};
  const economics = result.economics || {};
  const cover = result.coverage || {};
  const gapKind = economics.gapConfidence === 'measured' ? 'measured' : 'unmeasured';

  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: result.readout || '', kind: 'derived' }),
    readouts({
      items: [
        { label: 'Sites', value: fmtInt(result.siteCount), kind: 'measured' },
        { label: 'Mean congestion', value: fmtInt(traffic.meanCongestionScore), unit: '/100', kind: 'measured' },
        { label: 'Corridor closures', value: fmtInt(traffic.corridorClosures), kind: 'measured' },
        { label: 'Price vs anchor', value: fmtCentsSigned(price.meanCentsVsAnchor), kind: 'measured' },
        {
          label: 'Recoverable gap',
          value: economics.recoverableGapUsd === null ? NO_VALUE : fmtUsd(economics.recoverableGapUsd),
          unit: '/yr',
          kind: gapKind,
        },
      ],
    }),
    evidence({
      rows: [
        { claim: 'Congestion around each site', source: 'traffic layer → measured segment speeds', kind: 'measured' },
        { claim: 'Which corridors are closed', source: 'traffic layer → closure flags', kind: 'measured' },
        {
          claim: 'Where each site prices against its region',
          source: price.sitesWithPrice > 0 ? 'fuelPriceClient → EIA regional anchor' : 'No station price resolved',
          kind: price.sitesWithPrice > 0 ? 'measured' : 'unmeasured',
        },
        {
          claim: 'Dollars recoverable per year',
          source: gapKind === 'measured'
            ? 'gapModel → operator actual volumes'
            : 'gapModel — needs the operator’s own volumes; public data cannot produce it',
          kind: gapKind,
        },
      ],
    }),
  ];

  const rankedTop = economics.rankedTop || [];
  if (rankedTop.length > 0) {
    blocks.push(multiples({
      title: 'Worst gap first',
      tiles: rankedTop.map((row, index) => ({
        key: keyAt(index),
        label: row.name || row.siteId,
        sub: row.confidence === 'measured' ? 'measured gap' : 'needs actuals',
        value: Number.isFinite(row.gapUsd) ? row.gapUsd : null,
        display: Number.isFinite(row.gapUsd) ? fmtUsd(row.gapUsd) : NO_VALUE,
        tone: row.confidence === 'measured' ? 'alert' : 'ghost',
      })),
    }));
  }

  if (traffic.worstSite) {
    blocks.push(note({
      text: `Worst live congestion: ${traffic.worstSite.name} at ${fmtInt(traffic.worstSite.congestionScore)}/100.`,
      tone: 'caution',
    }));
  }

  if (portfolioWide && Array.isArray(result.regions) && result.regions.length > 1) {
    const maxSites = Math.max(...result.regions.map((region) => region.siteCount));
    blocks.push(ranked({
      title: 'By region',
      unit: 'sites',
      max: maxSites,
      kind: 'measured',
      rows: result.regions.slice(0, 8).map((region, index) => ({
        key: keyAt(index),
        label: region.region,
        sub: `live flow on ${fmtRatio(region.sitesWithLiveFlow, region.siteCount)}`,
        value: region.siteCount,
        display: fmtInt(region.siteCount),
        tone: 'signal',
      })),
    }));
  }

  blocks.push(coverage({
    bars: [
      {
        label: 'Sites with live road flow',
        n: traffic.sitesWithLiveFlow,
        of: cover.sitesTotal,
        note: 'Every congestion figure above is an average over these only',
      },
      {
        label: 'Sites with a resolved price',
        n: price.sitesWithPrice,
        of: cover.sitesTotal,
        note: 'Station prices are only free and official in some countries',
      },
    ],
  }));

  if (Number.isFinite(result.ungeocodedSites) && result.ungeocodedSites > 0) {
    blocks.push(note({
      text: `${fmtInt(result.ungeocodedSites)} imported site(s) have no coordinates and are excluded from every figure above.`,
      tone: 'caution',
    }));
  }

  blocks.push(sources({ items: [FEEDS.portfolio, FEEDS.tomtom, FEEDS.eia] }));
  return withIds(blocks);
}

/* ── Fuel price outlook ──────────────────────────────────────────────────── */

/**
 * "What is fuel going to cost me?"
 * @param {object} result From the `get_fuel_price_outlook` action.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeFuelOutlook(result, context = {}) {
  const question = context.question || 'What is fuel about to cost me?';
  const scope = context.scope || (result?.region ? String(result.region) : null);

  if (!result || result.status !== 'ready') {
    const noKey = result?.status === 'no-key';
    return withIds([
      head({ question, scope, action: 'get_fuel_price_outlook', status: 'error' }),
      gap({
        title: noKey ? 'No price key configured' : 'Price series unavailable',
        reason: stripReadoutPrefix(result?.readout) || 'The EIA series could not be fetched.',
        missing: ['Regional retail anchor', 'Daily spot series', 'Forward band'],
        remedy: noKey
          ? 'EIA_API_KEY is free at eia.gov/opendata. Nothing here is modelled without it.'
          : 'Retry once the series responds — no fallback price is invented in the meantime.',
      }),
      sources({ items: [FEEDS.eia] }),
    ]);
  }

  const fit = result.model || {};
  const validation = result.validation || {};
  const forecast = result.forecast || {};
  const anchor = result.anchor || {};
  const beatsNaive = Boolean(validation.ok && validation.beatsNaive);

  const blocks = [
    head({ question, scope, action: 'get_fuel_price_outlook', status: 'ready' }),
    verdict({
      text: stripReadoutPrefix(result.readout),
      kind: beatsNaive ? 'modelled' : 'unmeasured',
    }),
    readouts({
      items: [
        { label: 'Regional anchor', value: fmtNum(anchor.value, 3), unit: anchor.unit || '$/gal', kind: 'measured' },
        { label: 'Brent spot', value: fmtNum(result.spot?.value, 2), unit: result.spot?.unit || '$/bbl', kind: 'measured' },
        { label: 'Pass-through up', value: fmtNum(fit.passThroughUp, 2), kind: 'modelled' },
        { label: 'Pass-through down', value: fmtNum(fit.passThroughDown, 2), kind: 'modelled' },
        {
          label: 'Holdout MAE',
          value: validation.ok ? fmtNum(validation.modelMaeCents, 2) : NO_VALUE,
          unit: '¢/gal',
          kind: 'modelled',
        },
      ],
    }),
  ];

  if (forecast.ok && forecast.points?.length) {
    blocks.push(band({
      title: `${forecast.weeks}-week forward band`,
      kind: 'modelled',
      anchor: {
        label: 'Anchor',
        value: forecast.anchor,
        display: `${fmtNum(forecast.anchor, 3)} ${anchor.unit || '$/gal'}`,
      },
      points: forecast.points.map((point) => ({
        t: `+${point.week}w`,
        mid: point.central,
        lo: point.low,
        hi: point.high,
      })),
      baseline: validation.ok
        ? { label: 'Naive flat-price baseline', display: `${fmtNum(validation.naiveMaeCents, 2)}¢ MAE` }
        : null,
      note: forecast.riskWidenedCents > 0
        ? `Upper bound widened ${fmtInt(forecast.riskWidenedCents)}¢ by the disruption index. The claim is that risk rose, not that the price will.`
        : 'No risk widening applied — the disruption index is below its trailing threshold.',
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: 'This is the regional price level', source: `EIA ${result.seriesId || 'retail series'} — published, not modelled`, kind: 'measured' },
      { claim: 'Rises reach the pump faster than falls', source: `fitPassThrough — ${fmtInt(fit.observations)} weekly observations`, kind: 'modelled' },
      {
        claim: 'The model is better than assuming no change',
        source: validation.ok
          ? `Backtest over ${fmtInt(validation.holdoutWeeks)} held-out weeks`
          : 'No holdout was scored',
        kind: beatsNaive ? 'modelled' : 'unmeasured',
      },
      {
        claim: 'Supply risk has risen',
        source: result.disruption
          ? `${result.disruption.tankersInGate} tankers in the ${result.disruption.gate} gate (AISStream)`
          : 'Vessel layer not loaded — no risk input',
        kind: result.disruption ? 'measured' : 'unmeasured',
      },
    ],
  }));

  if (validation.ok && !validation.beatsNaive) {
    blocks.push(note({
      text: `This fit does NOT beat a flat-price baseline (${fmtNum(validation.modelMaeCents, 2)}¢ vs ${fmtNum(validation.naiveMaeCents, 2)}¢). Treat the band as context, not as a forecast to buy against.`,
      tone: 'alert',
    }));
  }

  blocks.push(sources({ items: [FEEDS.eia, ...(result.disruption ? [FEEDS.ais] : [])] }));
  return withIds(blocks);
}

/* ── Competitive position ────────────────────────────────────────────────── */

/**
 * "Who am I up against here?"
 * @param {object} result From `analyzeCompetitivePosition`.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeCompetitors(result, context = {}) {
  const question = context.question || 'Who am I up against in this market?';
  const scope = context.scope || null;

  if (!result || result.success === false) {
    return withIds([
      head({ question, scope, action: 'analyze_competitors', status: 'error' }),
      gap({
        title: result?.status === 'no-client-sites' ? 'No network loaded' : 'No competitors found',
        reason: stripReadoutPrefix(result?.readout) || 'The competitor search returned nothing.',
        missing: result?.status === 'no-client-sites'
          ? ['Your own site locations']
          : ['Mapped competitor locations in this area'],
        remedy: result?.status === 'no-client-sites'
          ? 'Search your brand name or import a portfolio CSV first.'
          : 'An empty search is a real answer here — no placeholder competitors are generated.',
      }),
      sources({ items: [FEEDS.places, FEEDS.portfolio] }),
    ]);
  }

  const breakdowns = result.siteBreakdowns || [];
  const blocks = [
    head({ question, scope, action: 'analyze_competitors', status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'derived' }),
    readouts({
      items: [
        { label: 'Your locations', value: fmtInt(result.clientSitesCount), kind: 'measured' },
        { label: 'Competitor sites', value: fmtInt(result.competitorSitesCount), kind: 'measured' },
        { label: 'Share of mapped set', value: fmtInt(result.marketSharePct), unit: '%', kind: 'derived' },
        { label: 'Mean territorial score', value: fmtInt(result.averageDominanceScore), unit: '/100', kind: 'ranked' },
      ],
    }),
  ];

  if (breakdowns.length > 0) {
    blocks.push(ranked({
      title: 'Territorial score by site',
      unit: 'score',
      max: 100,
      kind: 'ranked',
      rows: [...breakdowns]
        .sort((a, b) => (b.dominanceScore ?? -1) - (a.dominanceScore ?? -1))
        .slice(0, 8)
        .map((row, index) => ({
          key: keyAt(index),
          label: row.siteName || 'Unnamed site',
          sub: `${fmtInt(row.competitorsWithin1km)} competitor(s) within 1 km`,
          value: row.dominanceScore,
          display: `${fmtInt(row.dominanceScore)}/100`,
          tone: row.dominanceScore >= 75 ? 'signal' : 'caution',
          focus: focusOf(row),
        })),
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: 'These are the competitors here', source: `Places text search — ${(result.competitorBrands || []).join(', ') || 'inferred set'}`, kind: 'measured' },
      { claim: 'This is how crowded each site is', source: 'competitiveEngine — count within 1 km', kind: 'derived' },
      { claim: 'Share of mapped locations', source: 'Counting locations, NOT revenue or volume', kind: 'derived' },
      { claim: 'Territorial score', source: 'Ranking convention over density and access', kind: 'ranked' },
    ],
  }));

  blocks.push(coverage({
    bars: [{
      label: 'Sites with live road flow resolved',
      n: result.flowCoverage,
      of: result.clientSitesCount,
      note: 'Access friction is only measured for these',
    }],
  }));

  blocks.push(note({
    text: 'Share of mapped locations is not market share. It counts pins, not gallons.',
    tone: 'dim',
  }));

  blocks.push(sources({ items: [FEEDS.places, FEEDS.portfolio, FEEDS.tomtom] }));
  return withIds(blocks);
}

/* ── Traffic ─────────────────────────────────────────────────────────────── */

/**
 * "What is the road doing around here?"
 * @param {object} result From `fetchTrafficDelays`.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeTraffic(result, context = {}) {
  const question = context.question || 'What is traffic doing around here?';
  const scope = context.scope || null;

  if (!result || result.status !== 'ready') {
    return withIds([
      head({ question, scope, action: 'get_traffic_delays_and_construction', status: 'error' }),
      gap({
        title: 'No measured flow here',
        reason: result?.status === 'no-key'
          ? 'TOMTOM_API_KEY is absent, so no live segment speeds were fetched.'
          : `Flow status: ${result?.status || 'unknown'}.`,
        missing: ['Live segment speeds for this bounding box'],
        remedy: 'Nothing is simulated on this path — an unmeasured road stays unmeasured.',
      }),
      sources({ items: [FEEDS.tomtom] }),
    ]);
  }

  const summary = result.corridorSummary || {};
  const bottlenecks = result.bottlenecks || [];

  const blocks = [
    head({ question, scope, action: 'get_traffic_delays_and_construction', status: 'ready' }),
    verdict({
      text: stripReadoutPrefix(result.readout),
      kind: 'derived',
      score: { value: summary.overallCongestionScore, max: 100, label: 'Congestion index' },
    }),
    readouts({
      items: [
        { label: 'Segments measured', value: fmtInt((result.delays || []).length), kind: 'measured' },
        { label: 'Severe bottlenecks', value: fmtInt(summary.severeCorridorsCount), kind: 'derived' },
        { label: 'Closures', value: fmtInt(summary.constructionCount), kind: 'measured' },
        { label: 'Max delay', value: fmtNum(summary.maxDelayMin, 1), unit: 'min', kind: 'derived' },
      ],
    }),
  ];

  if (bottlenecks.length > 0) {
    blocks.push(ranked({
      title: 'Worst corridors',
      unit: 'frustration',
      max: 100,
      kind: 'derived',
      rows: bottlenecks.slice(0, 8).map((segment, index) => ({
        key: keyAt(index),
        label: segment.roadType ? `${segment.roadType} segment` : 'Road segment',
        sub: `${segment.delayStatus || 'delayed'}${segment.isClosure ? ' · closure' : ''}${segment.isConstruction ? ' · construction' : ''}`,
        value: segment.frustrationScore,
        display: `+${fmtNum(segment.delayMin, 1)} min`,
        tone: segment.isClosure ? 'alert' : 'caution',
        focus: Number.isFinite(segment.midLat) ? { lat: segment.midLat, lon: segment.midLon, id: null, label: null } : null,
      })),
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: 'These roads are slow right now', source: 'TomTom flow tiles — current vs free-flow speed', kind: 'measured' },
      { claim: 'Delay in minutes', source: 'analyzeSegmentDelay — speed ratio × segment length', kind: 'derived' },
      { claim: 'Frustration ranking', source: 'Ordering convention over delay and density', kind: 'ranked' },
    ],
  }));

  blocks.push(sources({ items: [FEEDS.tomtom] }));
  return withIds(blocks);
}

/* ── Analyst queries over what is on screen ─────────────────────────────── */

/**
 * Best label available for a record from any layer.
 * @param {object} item
 * @returns {string}
 */
function itemLabel(item) {
  return String(item?.name || item?.callsign || item?.place || item?.siteName || item?.id || 'record');
}

/**
 * "How many X are in view?" — the engine already scoped and filtered; this
 * turns its record set into a board rather than a spoken count.
 * @param {object} result From the `analyst_query` action.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeAnalyst(result, context = {}) {
  const question = context.question || 'Query over the active layers';
  const scope = context.scope || result?.scopeLabel || null;

  if (!result || result.ok === false) {
    return withIds([
      head({ question, scope, action: 'analyst_query', status: 'error' }),
      gap({
        title: 'Query could not run',
        reason: String(result?.error || 'The analyst engine rejected this query.'),
        missing: ['A layer that carries the field being asked about'],
        remedy: 'Enable the layer this question is about, then ask again. The engine only reads what is already rendered.',
      }),
      sources({ items: [FEEDS.layers] }),
    ]);
  }

  const items = result.items || [];
  const blocks = [
    head({ question, scope, action: 'analyst_query', status: 'ready' }),
    verdict({ text: result.summary || `${fmtInt(result.count)} ${result.scopeLabel || 'in scope'}`, kind: 'measured' }),
    readouts({
      items: [
        { label: 'Matches', value: fmtInt(result.count), kind: 'measured' },
        { label: 'Shown', value: fmtInt(items.length), kind: 'measured' },
        { label: 'Truncated', value: result.truncated ? 'yes' : 'no', kind: 'measured' },
      ],
    }),
  ];

  if (items.length > 0) {
    blocks.push(ranked({
      title: 'Matching records',
      kind: 'measured',
      rows: items.slice(0, 10).map((item, index) => ({
        key: keyAt(index),
        label: itemLabel(item),
        sub: item.layerKey || null,
        value: null,
        display: NO_VALUE,
        tone: 'signal',
        focus: focusOf(item),
      })),
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: 'This count is complete for the scope', source: 'analystEngine over already-loaded layer records', kind: 'measured' },
      {
        claim: 'Nothing outside the loaded layers was consulted',
        source: result.coverage ? JSON.stringify(result.coverage) : 'Client-side records only',
        kind: 'measured',
      },
    ],
  }));

  blocks.push(sources({ items: [FEEDS.layers] }));
  return withIds(blocks);
}

/* ── Fallback ────────────────────────────────────────────────────────────── */

/**
 * Any other action still produces a board. The alternative — silence for
 * everything without a bespoke composer — trains the operator to distrust the
 * surface.
 * @param {string} action
 * @param {object} result
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeGeneric(action, result, context = {}) {
  const question = context.question || actionLabel(action);
  const scope = context.scope || null;
  const ok = result?.ok !== false;

  if (!ok) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({
        title: 'That did not complete',
        reason: String(result?.error || 'The action reported a failure without a message.'),
        missing: [],
        remedy: null,
      }),
    ]);
  }

  const text = stripReadoutPrefix(result?.readout || result?.summary || '')
    || `${actionLabel(action)} completed.`;

  const numericFields = Object.entries(result || {})
    .filter(([key, value]) => Number.isFinite(value) && !['ok', 'lat', 'lon', 'latitude', 'longitude'].includes(key))
    .slice(0, 4)
    .map(([key, value]) => ({
      label: key.replace(/([a-z])([A-Z])/g, '$1 $2'),
      value: fmtInt(value),
      kind: 'measured',
    }));

  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text, kind: 'derived' }),
  ];
  if (numericFields.length > 0) blocks.push(readouts({ items: numericFields }));
  blocks.push(evidence({
    rows: [{ claim: text, source: `gevActions → ${action}`, kind: 'derived' }],
  }));
  return withIds(blocks);
}

/** Actions that have a bespoke composer. */
export const COMPOSED_ACTIONS = Object.freeze([
  'get_cool_off_opportunities',
  'get_view_health',
  'get_portfolio_health',
  'get_fuel_price_outlook',
  'analyze_competitors',
  'get_traffic_delays_and_construction',
  'analyst_query',
]);

/**
 * Route an action result to its composer.
 * @param {string} action
 * @param {object} result
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeForAction(action, result, context = {}) {
  switch (action) {
    case 'get_cool_off_opportunities':
      return composeCoolOff(result, context);
    case 'get_view_health':
    case 'get_portfolio_health':
      return composeHealth(result, { ...context, action });
    case 'get_fuel_price_outlook':
      return composeFuelOutlook(result, context);
    case 'analyze_competitors':
      return composeCompetitors(result, context);
    case 'get_traffic_delays_and_construction':
      return composeTraffic(result, context);
    case 'analyst_query':
      return composeAnalyst(result, context);
    default:
      return composeGeneric(action, result, context);
  }
}
