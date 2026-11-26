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
import { AIRSPACE_ACTION, composeAirspaceBrief } from './airspaceComposer.js';
import {
  band,
  campaigns as campaignsBlock,
  chain,
  coverage,
  creative as creativeBlock,
  evidence,
  fmtCentsSigned,
  fmtInt,
  fmtMeters,
  fmtNum,
  fmtPct,
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
  roster,
  series,
  sources,
  surfaces as surfacesBlock,
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
  gdelt: { label: 'GDELT event timeline', detail: 'Chokepoint event volume + tone via /api/gdelt/timeline' },
  news: { label: 'Regional news', detail: 'Google News RSS (non-commercial) with GDELT fallback, via /api/regional-brief' },
  pos: { label: 'Store POS', detail: 'Transaction, basket and category records for this site' },
  loyalty: { label: 'Loyalty & member graph', detail: 'Enrolment, segments, redemption history and identity resolution' },
  offers: { label: 'Offer & content distribution', detail: 'Canopy, dispenser, menu board, app and receipt surfaces' },
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

/* ── Chokepoint transit intelligence ─────────────────────────────────────── */

/**
 * "How busy is this strait, and does that mean anything for fuel prices?"
 * @param {object} result From the `inspect_chokepoint` action.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeChokepointIntel(result, context = {}) {
  const gateName = result?.gateName || 'this chokepoint';
  const question = context.question || `How busy is the ${gateName} right now?`;
  const scope = context.scope || gateName;

  if (!result || result.status !== 'ready') {
    return withIds([
      head({ question, scope, action: 'inspect_chokepoint', status: 'error' }),
      gap({
        title: 'No AIS coverage in the gate yet',
        reason: stripReadoutPrefix(result?.error) || 'The AIS feed has not delivered a contact inside this gate.',
        missing: ['Live vessel positions inside the gate box'],
        remedy: `${fmtInt(result?.vesselsObserved)} vessel(s) observed elsewhere in the feed. Keep the vessel layer on and retry — this reports as no coverage, never as a zero.`,
      }),
      sources({ items: [FEEDS.ais] }),
    ]);
  }

  const disruption = result.disruptionIndex || null;
  const hasTransits = Boolean(disruption?.available?.includes('transits'));
  const hasIndex = Number.isFinite(disruption?.index);

  const blocks = [
    head({ question, scope, action: 'inspect_chokepoint', status: 'ready' }),
    verdict({
      text: stripReadoutPrefix(result.measurement)
        || `${fmtInt(result.tankersInGate)} tankers among ${fmtInt(result.vesselsInGate)} contacts in ${gateName}.`,
      kind: 'measured',
    }),
    readouts({
      items: [
        { label: 'Tankers in gate', value: fmtInt(result.tankersInGate), kind: 'measured' },
        { label: 'All vessels in gate', value: fmtInt(result.vesselsInGate), kind: 'measured' },
        { label: 'Unclassified contacts', value: fmtInt(result.unclassifiedInGate), kind: 'measured' },
        { label: 'Feed-wide contacts', value: fmtInt(result.vesselsObserved), kind: 'measured' },
      ],
    }),
    chain({
      title: 'How this reads as fuel-price risk',
      stages: [
        {
          key: '01',
          label: 'Tankers counted in gate',
          value: `${fmtInt(result.tankersInGate)} of ${fmtInt(result.vesselsInGate)}`,
          state: 'met',
          note: 'AISStream, live positions inside the gate box',
        },
        {
          key: '02',
          label: 'Transit history enough to score',
          value: hasTransits ? 'Yes' : NO_VALUE,
          state: hasTransits ? 'met' : 'pending',
          note: hasTransits
            ? 'This app\'s own snapshot history for this gate has two or more points'
            : 'Needs at least two snapshots of this gate over time — still building that history',
        },
        {
          key: '03',
          label: 'Disruption index',
          value: hasIndex ? `${disruption.index}/100 (${disruption.level})` : NO_VALUE,
          state: hasIndex ? 'met' : 'pending',
          note: disruption?.readout || 'Not computed — no component had enough data yet',
        },
      ],
    }),
  ];

  blocks.push(note({
    text: hasIndex
      ? 'This index is the one input allowed to widen the fuel-price forecast\'s upper band — ask "what will fuel cost" to see it applied.'
      : `Not enough data yet to score supply risk here${disruption?.missing?.length ? ` (missing ${disruption.missing.join(', ')})` : ''}.`,
    tone: hasIndex ? 'signal' : 'caution',
  }));

  blocks.push(evidence({
    rows: [
      { claim: 'This is how many tankers are in the strait right now', source: 'AISStream — live AIS positions, instantaneous count', kind: 'measured' },
      {
        claim: 'Traffic here is unusual versus its own recent history',
        source: hasTransits
          ? 'Self-built transit history — AIS has no historical-transit feed, so this app snapshots its own'
          : 'Not enough snapshots yet to say',
        kind: hasTransits ? 'modelled' : 'unmeasured',
      },
    ],
  }));

  const sourceItems = [FEEDS.ais];
  if (disruption?.available?.includes('eventVolume') || disruption?.available?.includes('eventTone')) sourceItems.push(FEEDS.gdelt);
  if (disruption?.available?.includes('volatility')) sourceItems.push(FEEDS.eia);
  blocks.push(sources({ items: sourceItems }));
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

/* ── Local news ──────────────────────────────────────────────────────────── */

/**
 * "What's the local news near here?"
 * @param {object} result From the `get_local_news` action.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeLocalNews(result, context = {}) {
  const question = context.question || 'What is the local news near here?';
  const scope = context.scope || (result?.place?.label ? String(result.place.label) : null);
  const articles = result?.articles || [];

  if (!result || articles.length === 0) {
    return withIds([
      head({ question, scope, action: 'get_local_news', status: result?.ok === false && result?.error ? 'error' : 'ready' }),
      gap({
        title: 'No recent local news',
        reason: stripReadoutPrefix(result?.readout) || result?.error || 'No articles were returned for this location.',
        missing: ['Recent local news articles'],
        remedy: 'Try a broader or different location, or ask again later.',
      }),
      sources({ items: [FEEDS.news] }),
    ]);
  }

  const blocks = [
    head({ question, scope, action: 'get_local_news', status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'measured' }),
    ranked({
      title: 'Recent articles',
      kind: 'measured',
      rows: articles.slice(0, 8).map((article, index) => ({
        key: keyAt(index),
        label: article.title,
        sub: [article.domain, article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : null]
          .filter(Boolean).join(' · ') || null,
        value: null,
        display: NO_VALUE,
        tone: 'signal',
      })),
    }),
  ];

  if (result.newsSource === 'Google News RSS') {
    blocks.push(note({
      text: 'Sourced from Google News RSS, which is licensed for non-commercial use only — switch to the GDELT source before acting on these headlines in a commercial workflow.',
      tone: 'caution',
    }));
  }

  blocks.push(sources({
    items: [{ label: result.newsSource || 'News feed', detail: '/api/regional-brief' }],
  }));
  return withIds(blocks);
}

/* ── Full insight (orchestrated) ────────────────────────────────────────── */

/**
 * "Give me the full picture" — one board composed from the same engines
 * `analyze_competitors`, `get_view_health`/`get_portfolio_health`,
 * `get_fuel_price_outlook` and `get_local_news` already answer separately,
 * plus a modelled busyness estimate. Every clause still names its own kind;
 * this composer aggregates, it does not upgrade anything's confidence.
 * @param {object} result From the `get_full_insight` action.
 * @param {{question?: string, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeFullInsight(result, context = {}) {
  const question = context.question || 'Give me the full picture here';
  const scope = context.scope || null;

  if (!result || result.ok === false) {
    return withIds([
      head({ question, scope, action: 'get_full_insight', status: 'error' }),
      gap({
        title: 'Could not build a full insight',
        reason: String(result?.error || 'The orchestrated analysis did not complete.'),
        missing: [],
        remedy: null,
      }),
    ]);
  }

  const competitors = result.competitors || {};
  const health = result.health || {};
  const price = result.price || {};
  const busynessRows = result.busyness || [];
  const news = result.news || {};
  const playRows = result.plays || [];

  const scoredBusyness = busynessRows.filter((row) => Number.isFinite(row.score));
  const meanBusyness = scoredBusyness.length
    ? Math.round(scoredBusyness.reduce((sum, row) => sum + row.score, 0) / scoredBusyness.length)
    : null;

  const summaryParts = [];
  if (competitors.success) {
    summaryParts.push(`${competitors.clientSitesCount} site${competitors.clientSitesCount === 1 ? '' : 's'} vs ${competitors.competitorSitesCount} mapped competitor${competitors.competitorSitesCount === 1 ? '' : 's'} (${competitors.marketSharePct}% of the mapped set)`);
  }
  if (Number.isFinite(health?.traffic?.meanCongestionScore)) {
    summaryParts.push(`mean congestion ${health.traffic.meanCongestionScore}/100`);
  }
  if (price.status === 'ready') {
    summaryParts.push(`fuel anchor ${fmtNum(price.anchor?.value, 3)} ${price.anchor?.unit || '$/gal'}`);
  }
  if (meanBusyness !== null) {
    summaryParts.push(`modelled busyness ${meanBusyness}/100`);
  }
  const verdictText = summaryParts.length > 0
    ? `${summaryParts.join('; ')}.`
    : 'Not enough measured data in scope to build a picture yet.';

  const blocks = [
    head({ question, scope, action: 'get_full_insight', status: 'ready' }),
    verdict({ text: verdictText, kind: 'derived' }),
    readouts({
      items: [
        { label: 'Your locations', value: fmtInt(competitors.clientSitesCount), kind: 'measured' },
        { label: 'Competitor sites', value: fmtInt(competitors.competitorSitesCount), kind: 'measured' },
        { label: 'Mean congestion', value: fmtInt(health?.traffic?.meanCongestionScore), unit: '/100', kind: 'measured' },
        {
          label: 'Fuel anchor',
          value: price.status === 'ready' ? fmtNum(price.anchor?.value, 3) : NO_VALUE,
          unit: price.anchor?.unit || '$/gal',
          kind: price.status === 'ready' ? 'measured' : 'unavailable',
        },
        {
          label: 'Modelled busyness',
          value: meanBusyness === null ? NO_VALUE : fmtInt(meanBusyness),
          unit: '/100',
          kind: meanBusyness === null ? 'unavailable' : 'modelled',
        },
      ],
    }),
  ];

  const breakdowns = competitors.siteBreakdowns || [];
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

  if (price.status === 'ready' && price.forecast?.ok && price.forecast.points?.length) {
    blocks.push(band({
      title: `${price.forecast.weeks}-week forward band`,
      kind: 'modelled',
      anchor: {
        label: 'Anchor',
        value: price.forecast.anchor,
        display: `${fmtNum(price.forecast.anchor, 3)} ${price.anchor?.unit || '$/gal'}`,
      },
      points: price.forecast.points.map((point) => ({ t: `+${point.week}w`, mid: point.central, lo: point.low, hi: point.high })),
      baseline: null,
      note: 'Price band only — run get_fuel_price_outlook separately for the chokepoint disruption overlay.',
    }));
  }

  if (busynessRows.length > 0) {
    blocks.push(multiples({
      title: 'Modelled busyness by site',
      tiles: busynessRows.map((row, index) => ({
        key: keyAt(index),
        label: row.siteName || row.siteId || 'Site',
        sub: row.confidence === 'modelled' ? 'road flow × time-of-day, modelled' : 'no congestion reading',
        value: row.score,
        display: row.score === null ? NO_VALUE : `${row.score}/100`,
        tone: row.confidence === 'modelled' ? 'caution' : 'ghost',
      })),
    }));
  }

  if (playRows.length > 0) {
    blocks.push(plays({
      title: 'Recommended plays',
      cards: playRows.map((play) => ({
        id: play.id,
        name: play.name,
        action: play.action,
        rationale: play.rationale,
        lift: {
          display: Number.isFinite(play.expectedLiftPct?.value) ? `${play.expectedLiftPct.value}%` : NO_VALUE,
          kind: Number.isFinite(play.expectedLiftPct?.value) ? 'measured' : 'unmeasured',
        },
        approval: play.requiresApproval ? 'required' : 'not-required',
        triggers: [],
      })),
    }));
  }

  if ((news.articles || []).length > 0) {
    blocks.push(ranked({
      title: 'Local news near this view',
      kind: 'measured',
      rows: news.articles.slice(0, 5).map((article, index) => ({
        key: keyAt(index),
        label: article.title,
        sub: article.domain || null,
        value: null,
        display: NO_VALUE,
        tone: 'signal',
      })),
    }));
    if (news.newsSource === 'Google News RSS') {
      blocks.push(note({
        text: 'News is via Google News RSS, licensed for non-commercial use only — switch to the GDELT source before acting on these headlines commercially.',
        tone: 'caution',
      }));
    }
  }

  blocks.push(note({
    text: 'Modelled busyness is road congestion × time-of-day, never measured footfall. Store-level busyness needs the operator’s own POS/loyalty data.',
    tone: 'dim',
  }));

  blocks.push(sources({
    items: [
      FEEDS.places,
      FEEDS.portfolio,
      FEEDS.tomtom,
      ...(price.status === 'ready' ? [FEEDS.eia] : []),
      ...((news.articles || []).length ? [FEEDS.news] : []),
      FEEDS.playbook,
    ],
  }));

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

/* -- Store agent ----------------------------------------------------------
 * The operator's own transaction, member, campaign and content surface.
 * Same contract as everything above: a figure that was not measured is null
 * and every claim names its kind. The one addition is that campaign boards
 * show MEASURED result and MODELLED forecast side by side and never blend
 * them -- "is it doing well" is precisely that comparison.
 */

const signed = (value, digits = 1) => (Number.isFinite(value)
  ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Number(value)).toFixed(digits)}%`
  : NO_VALUE);

const toneForDelta = (value, threshold = 1) => (
  !Number.isFinite(value) ? 'ghost' : value > threshold ? 'signal' : value < -threshold ? 'alert' : 'ghost'
);

/** Header naming the store, so a board is never ambiguous about its subject. */
function storeScope(result, context) {
  const store = result?.store;
  if (!store) return context.scope || null;
  return `${store.name}${store.number ? ` (store #${store.number})` : ''}`;
}

/**
 * "How is this store doing this week?"
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeStorePerformance(result, context = {}) {
  const question = context.question || 'How is this store performing?';
  const scope = storeScope(result, context);
  const action = 'get_store_performance';

  // A missing payload is a gap, not a crash: the board must degrade to
  // "cannot answer" rather than take the panel down with it.
  if (!result || result.ok === false || !result.totals) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({ title: 'No reading', reason: String(result?.error || 'The store returned no trading figures.'), missing: [] }),
    ]);
  }

  const { totals, deltas, highlights, loyalty } = result;
  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'measured' }),
    readouts({
      items: [
        { label: 'Total sales', value: fmtUsd(totals.totalSales), kind: 'measured' },
        { label: 'vs prior', value: signed(deltas.totalSales), kind: 'derived' },
        { label: 'Transactions', value: fmtInt(totals.totalTransactions), kind: 'measured' },
        { label: 'Gallons', value: fmtInt(totals.gallons), kind: 'measured' },
        { label: 'Gross profit', value: fmtUsd(totals.totalGrossProfit), kind: 'measured' },
        { label: 'Loyalty attach', value: fmtPct(loyalty.attachRate), kind: 'measured' },
      ],
    }),
    series({
      title: `Day by day, against the prior ${result.days} days`,
      kind: 'measured',
      points: (result.series || []).map((day) => ({
        label: day.weekdayShort,
        value: day.totalSales,
        display: fmtUsd(day.totalSales),
        compare: day.priorTotalSales,
        deltaPct: day.salesDeltaPct,
        tone: toneForDelta(day.salesDeltaPct),
        partial: Boolean(day.partial),
        sub: day.partial ? 'to date' : null,
      })),
      note: (result.series || []).some((day) => day.partial)
        ? 'Today is incomplete. Both today and the day it is compared against are cut to the same point in the trading day.'
        : null,
    }),
    series({
      title: 'By daypart',
      kind: 'measured',
      points: (result.dayparts || []).map((part) => ({
        label: part.label,
        value: part.insideTransactions,
        display: fmtInt(part.insideTransactions),
        deltaPct: part.deltaPct,
        tone: toneForDelta(part.deltaPct),
        sub: part.window,
      })),
    }),
    ranked({
      title: 'Category movement',
      kind: 'measured',
      rows: (result.categories || [])
        .slice()
        .sort((a, b) => (b.sales || 0) - (a.sales || 0))
        .map((category) => ({
          key: category.id.slice(0, 2).toUpperCase(),
          label: category.label,
          sub: `${signed(category.deltaPct)} vs prior`,
          value: category.sales,
          display: fmtUsd(category.sales),
          tone: toneForDelta(category.deltaPct),
        })),
    }),
    evidence({
      rows: [
        { claim: `${fmtUsd(totals.totalSales)} across ${result.days} days`, source: 'Store POS, transaction-level', kind: 'measured' },
        { claim: `${signed(deltas.totalSales)} against the prior ${result.days} days`, source: 'Same-weekday comparison over the prior window', kind: 'derived' },
        {
          claim: highlights.weakestCategory
            ? `${highlights.weakestCategory.label} is the softest line at ${signed(highlights.weakestCategory.deltaPct)}`
            : 'No category is materially soft',
          source: 'Category sales, prior-window delta',
          kind: 'derived',
        },
        { claim: `${fmtPct(loyalty.attachRate)} of transactions identified to a member`, source: 'Loyalty attachment at the register and the pump', kind: 'measured' },
      ],
    }),
    sources({ items: [FEEDS.pos, FEEDS.loyalty] }),
  ];
  return withIds(blocks);
}

/**
 * "Are we seeing a dip right now?"
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeStorePulse(result, context = {}) {
  const question = context.question || 'What is happening at this store right now?';
  const scope = storeScope(result, context);
  const action = 'get_store_pulse';

  if (!result || result.ok === false || !result.hour) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({ title: 'No live reading', reason: String(result?.error || 'The store returned no live pulse.'), missing: [] }),
    ]);
  }

  const tone = result.state === 'dip' ? 'alert' : result.state === 'lift' ? 'signal' : 'ghost';
  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'measured' }),
    readouts({
      items: [
        { label: 'This hour', value: fmtInt(result.hour.actual), kind: 'measured' },
        { label: 'Expected', value: fmtInt(result.hour.planned), kind: 'modelled' },
        { label: 'Variance', value: signed(result.hour.variancePct), kind: 'derived' },
        { label: 'Day to date', value: signed(result.dayToDate.variancePct), kind: 'derived' },
        { label: 'Basket', value: fmtUsd(result.basketAvg), kind: 'measured' },
        { label: 'Sales at risk/hr', value: fmtUsd(result.hourlySalesAtRisk), kind: 'derived' },
      ],
    }),
    series({
      title: 'Last six hours, actual against expected',
      kind: 'measured',
      points: (result.trailing || []).map((hour) => ({
        label: hour.label,
        value: hour.actual,
        display: fmtInt(hour.actual),
        compare: hour.planned,
        deltaPct: hour.variancePct,
        tone: toneForDelta(hour.variancePct, 7),
        partial: hour.partial,
        sub: hour.partial ? 'in progress' : null,
      })),
      note: 'The ghost bar behind each column is what that hour normally does.',
    }),
  ];

  // The causes ARE the answer. A variance with no attribution sends an
  // operator hunting instead of acting.
  if (result.causes?.length) {
    blocks.push(ranked({
      title: 'What is behind it',
      kind: 'derived',
      max: 1,
      rows: result.causes.map((cause, index) => ({
        key: String.fromCharCode(65 + index),
        label: cause.label,
        sub: cause.detail,
        value: cause.share,
        display: `${Math.round(cause.share * 100)}%`,
        tone: index === 0 ? tone : 'caution',
      })),
    }));
    if (result.unexplainedShare > 0.05) {
      blocks.push(note({
        text: `${Math.round(result.unexplainedShare * 100)}% of the gap is unaccounted for. The shares above are apportioned only across causes the console can actually see — nothing is padded out to reach 100%.`,
        tone: 'dim',
      }));
    }
  } else if (result.state !== 'on-plan') {
    blocks.push(gap({
      title: 'Variance with no attributable cause',
      reason: 'The hour is off plan, but no weather, traffic, competitor or equipment signal explains it.',
      missing: ['No attributable cause in the live context'],
      remedy: 'Worth a look at the floor rather than the console.',
    }));
  }

  if (!result.equipment?.healthy) {
    blocks.push(surfacesBlock({
      title: 'Equipment',
      rows: (result.equipment.faults || []).map((fault) => ({
        id: fault.id,
        label: fault.label,
        where: fault.detail,
        status: 'fault',
        statusLabel: `Down ${fault.since}`,
        tone: 'alert',
        impressions: null,
        addressable: null,
      })),
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: `${fmtInt(result.hour.actual)} transactions this hour`, source: 'Store POS, live', kind: 'measured' },
      { claim: `${fmtInt(result.hour.planned)} expected for this hour`, source: 'Daypart curve for this site and weekday', kind: 'modelled' },
      ...(result.causes || []).slice(0, 2).map((cause) => ({
        claim: `${cause.label} — about ${Math.round(cause.share * 100)}% of the gap`,
        source: cause.source,
        kind: 'derived',
      })),
    ],
  }));
  blocks.push(sources({ items: [FEEDS.pos, FEEDS.tomtom, FEEDS.news] }));
  return withIds(blocks);
}

/**
 * "Who is on the file?" / "Who is this?" / "Can you identify that transaction?"
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeMemberIntelligence(result, context = {}) {
  const question = context.question || 'Who is on the loyalty file here?';
  const scope = storeScope(result, context);
  const action = 'get_member_intelligence';

  if (!result || result.ok === false || !(result.base || result.resolution || result.member)) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({ title: 'No member reading', reason: String(result?.error || 'The loyalty file returned nothing.'), missing: [] }),
    ]);
  }

  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'measured' }),
  ];

  if (result.kind === 'member-identity') {
    const { resolution } = result;
    blocks.push(readouts({
      items: [
        { label: 'Confidence', value: fmtPct(resolution.confidence), kind: 'derived' },
        { label: 'Auto-merge bar', value: fmtPct(resolution.threshold), kind: 'parameterised' },
        { label: 'Applied', value: resolution.applied ? 'Yes' : 'Held for review', kind: 'measured' },
        { label: 'Signals', value: fmtInt(resolution.signals.length), kind: 'measured' },
      ],
    }));
    blocks.push(chain({
      title: 'How the bridge was made',
      stages: resolution.signals.map((signal, index) => ({
        key: String(index + 1).padStart(2, '0'),
        label: signal.label,
        value: fmtPct(signal.strength),
        state: 'met',
        note: 'Independent signal',
      })).concat([{
        key: String(resolution.signals.length + 1).padStart(2, '0'),
        label: resolution.applied ? 'Merged onto the member record' : 'Held below the auto-merge bar',
        value: fmtPct(resolution.confidence),
        state: resolution.applied ? 'met' : 'unmet',
        note: resolution.reason,
      }]),
    }));
    if (resolution.member) blocks.push(memberCard(resolution.member));
    blocks.push(readouts({
      items: [
        { label: 'Anonymous/day', value: fmtInt(resolution.programmeEffect.anonymousTransactionsPerDay), kind: 'measured' },
        { label: 'Recovered/day', value: fmtInt(resolution.programmeEffect.recoveredPerDay), kind: 'derived' },
        { label: 'Identified before', value: `${resolution.programmeEffect.identifiedShareBefore}%`, kind: 'measured' },
        { label: 'Identified after', value: `${resolution.programmeEffect.identifiedShareAfter}%`, kind: 'derived' },
      ],
    }));
    blocks.push(note({
      text: 'Confidence compounds across independent signals rather than summing: two 50% signals give 75%, not certainty. A match under the bar is a candidate, and nothing is written to the member record until it clears.',
      tone: 'dim',
    }));
  } else if (result.kind === 'member-profile') {
    blocks.push(memberCard(result.member));
    blocks.push(evidence({
      rows: [
        { claim: `${result.member.behaviour.visitsPerMonth} visits a month`, source: 'Transaction history, 90 days', kind: 'measured' },
        { claim: `${fmtPct(result.member.value.churnProbability90d)} chance of lapsing in 90 days`, source: 'Churn model over recency, frequency and tenure', kind: 'modelled' },
        { claim: result.member.nextBestAction.action, source: 'Segment thesis + recency', kind: 'derived' },
      ],
    }));
  } else {
    const { base } = result;
    blocks.push(readouts({
      items: [
        { label: 'Enrolled', value: fmtInt(base.enrolled), kind: 'measured' },
        { label: 'Active 30d', value: fmtInt(base.active30), kind: 'measured' },
        { label: 'Lapsed', value: fmtInt(base.lapsed), kind: 'measured' },
        { label: 'Identified txns', value: fmtPct(base.attachRate), kind: 'measured' },
        { label: 'Push reachable', value: fmtInt(base.pushOptIn), kind: 'measured' },
        { label: 'Member basket lift', value: `+${base.memberBasketPremiumPct}%`, kind: 'derived' },
      ],
    }));
    blocks.push(roster({
      title: 'Segments, ranked by gross profit contribution',
      cards: (result.segments || []).slice(0, 6).map((segment, index) => ({
        key: String.fromCharCode(65 + index),
        name: segment.label,
        sub: segment.thesis,
        badge: segment.churnRisk === 'critical' ? 'At risk' : null,
        tone: segment.churnRisk === 'critical' ? 'alert' : segment.churnRisk === 'medium' ? 'caution' : 'signal',
        meter: segment.shareOfFile,
        stats: [
          { label: 'Members', value: fmtInt(segment.members), kind: 'measured' },
          { label: 'GP / month', value: fmtUsd(segment.monthlyGrossProfit), kind: 'derived' },
          { label: 'Inside attach', value: fmtPct(segment.attachRate), kind: 'measured' },
          { label: 'Redemption', value: fmtPct(segment.redemptionRate), kind: 'measured' },
          { label: 'Visits / mo', value: fmtNum(segment.visitsPerMonth, 1), kind: 'measured' },
          { label: 'Push reach', value: fmtInt(segment.reachable.push), kind: 'measured' },
        ],
      })),
      note: 'Ranked by gross profit, not revenue. The highest-spending segment on this file is rarely the most valuable one.',
    }));
    blocks.push(note({
      text: 'Every segment here is behavioural — frequency, attachment, daypart, recency. Nothing is inferred about who a member is, only about what they do at the pump and the register.',
      tone: 'dim',
    }));
  }

  blocks.push(sources({ items: [FEEDS.loyalty, FEEDS.pos] }));
  return withIds(blocks);
}

/** One member rendered as a roster card. Shared by the profile and identity boards. */
function memberCard(member) {
  return roster({
    title: 'Member',
    cards: [{
      key: 'M',
      name: member.name,
      sub: `${member.tier} · ${member.segmentLabel} · home store ${member.homeStore}`,
      badge: member.value.churnRisk === 'critical' ? 'Churn risk' : member.tier,
      tone: member.value.churnRisk === 'critical' ? 'alert' : 'signal',
      meter: member.value.percentileOnFile / 100,
      stats: [
        { label: 'Visits / mo', value: fmtNum(member.behaviour.visitsPerMonth, 1), kind: 'measured' },
        { label: 'Gallons 90d', value: fmtInt(member.behaviour.gallons90), kind: 'measured' },
        { label: 'Inside 90d', value: fmtUsd(member.behaviour.insideSpend90), kind: 'measured' },
        { label: 'Avg basket', value: fmtUsd(member.behaviour.avgBasket), kind: 'measured' },
        { label: 'Last visit', value: `${member.lastVisitDaysAgo}d ago`, kind: 'measured' },
        { label: 'Annual GP', value: fmtUsd(member.value.annualGrossProfit), kind: 'derived' },
        { label: 'On file', value: `top ${100 - member.value.percentileOnFile}%`, kind: 'derived' },
        { label: 'Churn 90d', value: fmtPct(member.value.churnProbability90d), kind: 'modelled' },
      ],
      tags: [
        member.behaviour.preferredDaypart,
        member.behaviour.preferredGrade,
        member.behaviour.paymentMethod,
        member.reachability.appInstalled ? 'App installed' : 'No app',
        member.reachability.pushOptIn ? 'Push on' : 'Push off',
        ...member.identities.map((identity) => identity.label),
      ],
      note: `Next best action — ${member.nextBestAction.action}. ${member.nextBestAction.rationale}`,
    }],
  });
}

/**
 * "What campaigns are running, and which ones are working?"
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeCampaignPerformance(result, context = {}) {
  const question = context.question || 'Which loyalty campaigns are working?';
  const scope = storeScope(result, context);
  const action = 'get_campaign_performance';

  if (!result || result.ok === false || !result.totals) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({ title: 'No campaign book', reason: String(result?.error || 'The loyalty stack returned nothing.'), missing: [] }),
    ]);
  }

  if (!result.campaigns?.length) {
    return withIds([
      head({ question, scope, action, status: 'ready' }),
      gap({
        title: 'Nothing is running',
        reason: 'No loyalty campaign is live at this store right now.',
        missing: [],
        remedy: 'Ask what is worth running and the console will rank the catalogue against current conditions.',
      }),
    ]);
  }

  const { totals } = result;
  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'derived' }),
    readouts({
      items: [
        { label: 'Live campaigns', value: fmtInt(result.campaigns.length), kind: 'measured' },
        { label: 'Redemptions', value: fmtInt(totals.redemptions), kind: 'measured' },
        { label: 'Margin given', value: fmtUsd(totals.marginGive), kind: 'measured' },
        { label: 'Net gross profit', value: fmtUsd(totals.netGrossProfit), kind: 'derived' },
        { label: 'Return on give', value: totals.programReturn === null ? NO_VALUE : `${totals.programReturn}x`, kind: 'derived' },
        { label: 'Members reached', value: fmtInt(totals.membersReached), kind: 'measured' },
      ],
    }),
    campaignsBlock({
      title: 'Running now',
      rows: result.campaigns.map((campaign, index) => ({
        key: String.fromCharCode(65 + index),
        id: campaign.campaignId,
        name: campaign.name,
        sub: `${campaign.audience.label} · ${campaign.surfaces.map((surface) => surface.label).join(', ') || 'no surface'}`
          + ` · day ${campaign.daysElapsed} of ${campaign.plannedDays}`,
        verdict: campaign.verdict,
        verdictLabel: campaign.verdictLabel,
        tone: campaign.verdictTone,
        paceRatio: campaign.paceRatio,
        paceDisplay: campaign.pacePct === null ? NO_VALUE : `${campaign.pacePct}% of pace`,
        measured: [
          { label: 'Redemptions', value: fmtInt(campaign.actual.redemptions) },
          { label: 'Of which incremental', value: fmtInt(campaign.actual.incrementalVisits) },
          { label: 'Margin given', value: fmtUsd(campaign.actual.marginGive) },
          { label: 'Net gross profit', value: fmtUsd(campaign.actual.netGrossProfit) },
          { label: 'Return on give', value: campaign.actual.returnOnGive === null ? NO_VALUE : `${campaign.actual.returnOnGive}x` },
        ],
        forecast: [
          { label: 'Expected by now', value: fmtInt(campaign.forecast.proratedToDate) },
          { label: 'Full run', value: fmtInt(campaign.forecast.totalRedemptions) },
          { label: 'Band', value: `${fmtInt(campaign.forecast.band[0])}–${fmtInt(campaign.forecast.band[1])}` },
          // The full basis sentence belongs in the evidence block; this
          // column is narrow and a truncated half-sentence reads worse than
          // the number it was trying to qualify.
          { label: 'Prior runs', value: fmtInt(campaign.forecast.basis.match(/^(\d+)/)?.[1]) },
        ],
        trend: campaign.trend?.direction === 'too-early'
          ? 'Too early to read a trend'
          : `${campaign.trend.direction} · ${signed(campaign.trend.changePct)} last third vs first`,
        advice: campaign.advice,
        spark: (campaign.series || []).map((day) => day.redemptions),
      })),
      note: 'Left column is what happened. Right column is what it was forecast to do. "Doing well" is the comparison of the two, and they are never blended.',
    }),
  ];

  if (result.divergence) {
    blocks.push(note({
      text: `${result.divergence.name} is the trap in this book: it is beating its redemption plan and still losing money, because ${fmtInt(result.divergence.actual.cannibalised)} of its redemptions went to people who were buying anyway. Volume is not the problem — the give is.`,
      tone: 'caution',
    }));
  }

  if (result.overlaps?.length) {
    blocks.push(ranked({
      title: 'Campaigns competing for the same members',
      kind: 'derived',
      rows: result.overlaps.map((overlap, index) => ({
        key: String.fromCharCode(65 + index),
        label: overlap.names.join('  +  '),
        sub: overlap.note,
        value: 1,
        display: overlap.segmentLabel,
        tone: overlap.sameObjective ? 'alert' : 'caution',
      })),
    }));
  }

  blocks.push(evidence({
    rows: [
      { claim: `${fmtInt(totals.redemptions)} redemptions across the book`, source: 'Loyalty redemption records', kind: 'measured' },
      { claim: `${fmtUsd(totals.marginGive)} of margin given away`, source: 'Per-unit give, per-gallon for fuel mechanics', kind: 'measured' },
      { claim: `${fmtUsd(totals.netGrossProfit)} net after cannibalisation`, source: 'Incremental share by objective, netted against the give', kind: 'derived' },
      { claim: 'Pace is measured against the forecast prorated to days elapsed', source: 'Launch forecast, prorated', kind: 'modelled' },
    ],
  }));
  blocks.push(sources({ items: [FEEDS.loyalty, FEEDS.pos, FEEDS.offers] }));
  return withIds(blocks);
}

/**
 * "What should I run right now?"
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeOfferRecommendations(result, context = {}) {
  const question = context.question || 'What offer should I run right now?';
  const scope = storeScope(result, context);
  const action = 'recommend_offer';

  if (!result || result.ok === false || !result.candidates?.length) {
    return withIds([
      head({ question, scope, action, status: 'ready' }),
      gap({
        title: 'Nothing fires',
        reason: 'No mechanic in the catalogue matches the conditions at this store right now.',
        missing: [],
        remedy: 'Running one anyway means discounting without a reason to.',
      }),
    ]);
  }

  const blocks = [
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'derived' }),
  ];

  if (result.pulse) {
    blocks.push(readouts({
      items: [
        { label: 'This hour', value: fmtInt(result.pulse.hour.actual), kind: 'measured' },
        { label: 'Expected', value: fmtInt(result.pulse.hour.planned), kind: 'modelled' },
        { label: 'Variance', value: signed(result.pulse.hour.variancePct), kind: 'derived' },
        { label: 'Basket', value: fmtUsd(result.pulse.basketAvg), kind: 'measured' },
      ],
    }));
  }

  blocks.push(plays({
    title: 'Ranked against current conditions',
    cards: result.candidates.map((candidate) => ({
      id: candidate.offerId,
      name: `${candidate.name} — ${candidate.valueLabel}`,
      action: candidate.detail,
      rationale: `${candidate.rationale}. Target: ${candidate.targetSegment ? `${candidate.targetSegment.label}, ${fmtInt(candidate.targetSegment.members)} members` : 'all members'}.`
        + ` Lead surface: ${candidate.leadSurface ? candidate.leadSurface.label : 'unset'}.`,
      // Prior redemption rate for this mechanic AT THIS SITE. Unlike the
      // play library, this one has a history to quote — and it is still a
      // modelled expectation, not a measured outcome.
      lift: {
        display: `${fmtPct(candidate.priors.meanRedemption)} redemption, ${candidate.priors.runs} prior run${candidate.priors.runs === 1 ? '' : 's'}`,
        kind: 'modelled',
      },
      approval: 'required',
      triggers: (candidate.matchedTriggers || []).map((trigger) => ({
        label: trigger.replace(/-/g, ' '),
        display: result.triggerReasons?.[trigger] || 'firing',
        met: true,
      })),
    })),
  }));

  blocks.push(evidence({
    rows: [
      { claim: `${result.triggers.length} live condition${result.triggers.length === 1 ? '' : 's'} matched against the catalogue`, source: 'Daypart, weather, pulse, competitor and file state', kind: 'derived' },
      { claim: 'Ranking is trigger fit first, then addressable reach, then prior redemption at this site', source: 'offerStudio.rankOffers', kind: 'ranked' },
      { claim: 'Nothing here is live. Creating an offer and publishing it are separate steps.', source: 'Offer distribution', kind: 'parameterised' },
    ],
  }));
  blocks.push(sources({ items: [FEEDS.pos, FEEDS.loyalty, FEEDS.offers, FEEDS.news] }));
  return withIds(blocks);
}

/**
 * "Build me that offer." The board that shows the advertisement.
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeOfferCreated(result, context = {}) {
  const question = context.question || 'Build this offer';
  const scope = storeScope(result, context) || (result?.site ? `${result.site.name} (store #${result.site.storeNumber})` : null);
  const action = 'create_offer';

  if (!result || result.ok === false || !result.offer || !result.forecast) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({ title: 'Offer not built', reason: String(result?.error || 'The offer stack returned nothing.'), missing: [] }),
    ]);
  }

  const { forecast } = result;
  return withIds([
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'derived' }),
    creativeBlock({
      title: `${result.offer.name} — ${result.offerId}`,
      cards: (result.creatives || []).map((card) => ({ ...card, status: result.status })),
      note: 'This is the artwork as it will appear on each screen. Copy is written per surface, not resized onto it.',
    }),
    readouts({
      items: [
        { label: 'Audience', value: result.audience.label, kind: 'measured' },
        { label: 'Members', value: fmtInt(result.audience.size), kind: 'measured' },
        { label: 'Runs for', value: `${result.durationDays} day${result.durationDays === 1 ? '' : 's'}`, kind: 'parameterised' },
        { label: 'Expected redemptions', value: fmtInt(forecast.redemptions.expected), kind: 'modelled' },
        { label: 'Margin give', value: fmtUsd(forecast.marginGive), kind: 'modelled' },
        { label: 'Net gross profit', value: fmtUsd(forecast.netGrossProfit), kind: 'modelled' },
      ],
    }),
    surfacesBlock({
      title: 'Where it will run',
      rows: (result.surfaces || []).map((surface) => ({
        id: surface.surfaceId,
        label: surface.surfaceLabel,
        where: surface.note,
        status: surface.status,
        statusLabel: surface.status === 'live' ? 'Live' : 'Staged',
        tone: surface.status === 'live' ? 'signal' : 'ghost',
        impressions: fmtInt(surface.impressions),
        addressable: fmtInt(surface.addressable),
        timing: `up in ${surface.leadTimeMinutes} min`,
      })),
      note: 'Nothing is published yet. Publishing is a separate, explicit step.',
    }),
    band({
      title: 'Forecast redemptions over the run',
      kind: 'modelled',
      anchor: { label: 'Expected', value: forecast.redemptions.expected, display: fmtInt(forecast.redemptions.expected) },
      points: Array.from({ length: result.durationDays }, (_, day) => {
        const share = (day + 1) / result.durationDays;
        return {
          t: `D${day + 1}`,
          mid: Math.round(forecast.redemptions.expected * share),
          lo: Math.round(forecast.redemptions.lo * share),
          hi: Math.round(forecast.redemptions.hi * share),
        };
      }),
      note: forecast.caveat,
    }),
    evidence({
      rows: [
        { claim: `${fmtInt(forecast.redemptions.expected)} redemptions expected, band ${fmtInt(forecast.redemptions.lo)} to ${fmtInt(forecast.redemptions.hi)}`, source: forecast.basis, kind: 'modelled' },
        ...(forecast.capped ? [{ claim: forecast.capacityNote, source: 'Category throughput at this site', kind: 'derived' }] : []),
        { claim: forecast.economics?.note || 'Incremental share netted against the give', source: 'Promotion economics by objective', kind: 'derived' },
        { claim: `${fmtInt(result.audience.size)} members addressable`, source: 'Loyalty file, segment sized at this store', kind: 'measured' },
      ],
    }),
    sources({ items: [FEEDS.offers, FEEDS.loyalty, FEEDS.pos] }),
  ]);
}

/**
 * "Push it live."
 * @param {object} result
 * @param {object} [context]
 * @returns {object[]}
 */
export function composeOfferDeployed(result, context = {}) {
  const question = context.question || 'Publish this offer';
  const scope = storeScope(result, context) || (result?.site ? `${result.site.name} (store #${result.site.storeNumber})` : null);
  const action = 'deploy_offer';

  if (!result || result.ok === false || !result.surfaces) {
    return withIds([
      head({ question, scope, action, status: 'error' }),
      gap({
        title: 'Nothing to publish',
        reason: String(result?.error || 'No staged offer was found.'),
        missing: [],
        remedy: 'Build the offer first; the console keeps it staged until it is explicitly pushed.',
      }),
    ]);
  }

  const live = (result.surfaces || []).filter((surface) => surface.status === 'live');
  return withIds([
    head({ question, scope, action, status: 'ready' }),
    verdict({ text: stripReadoutPrefix(result.readout), kind: 'measured' }),
    surfacesBlock({
      title: 'Distribution',
      rows: (result.surfaces || []).map((surface) => ({
        id: surface.surfaceId,
        label: surface.surfaceLabel,
        where: null,
        status: surface.status,
        statusLabel: surface.status === 'live' ? 'Live' : surface.status === 'not-requested' ? 'Not selected' : 'Staged',
        tone: surface.status === 'live' ? 'signal' : 'ghost',
        impressions: fmtInt(surface.impressions),
        addressable: fmtInt(surface.addressable),
        timing: surface.status === 'live' ? `live in ${surface.liveInMinutes} min` : null,
        irreversible: Boolean(surface.irreversible),
        note: surface.note,
      })),
    }),
    creativeBlock({
      title: 'Now showing',
      cards: (result.creatives || [])
        .filter((card) => live.some((surface) => surface.surfaceId === card.surfaceId))
        .map((card) => ({ ...card, status: 'live' })),
    }),
    readouts({
      items: [
        { label: 'Surfaces live', value: fmtInt(result.liveSurfaceCount), kind: 'measured' },
        { label: 'Impressions/day', value: fmtInt(result.totalImpressionsPerDay), kind: 'derived' },
        { label: 'Push sent', value: result.pushSent ? 'Yes — not recallable' : 'No', kind: 'measured' },
        { label: 'Runs until', value: result.endsLabel || NO_VALUE, kind: 'parameterised' },
      ],
    }),
    sources({ items: [FEEDS.offers, FEEDS.loyalty] }),
  ]);
}

/** Actions that have a bespoke composer. */
export const COMPOSED_ACTIONS = Object.freeze([
  'get_cool_off_opportunities',
  'get_view_health',
  'get_portfolio_health',
  'get_fuel_price_outlook',
  'inspect_chokepoint',
  'analyze_competitors',
  'get_traffic_delays_and_construction',
  'analyst_query',
  'get_local_news',
  'get_full_insight',
  'get_store_performance',
  'get_store_pulse',
  'get_member_intelligence',
  'get_campaign_performance',
  'recommend_offer',
  'create_offer',
  'deploy_offer',
  AIRSPACE_ACTION,
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
    case 'inspect_chokepoint':
      return composeChokepointIntel(result, context);
    case 'analyze_competitors':
      return composeCompetitors(result, context);
    case 'get_traffic_delays_and_construction':
      return composeTraffic(result, context);
    case 'analyst_query':
      return composeAnalyst(result, context);
    case 'get_local_news':
      return composeLocalNews(result, context);
    case 'get_full_insight':
      return composeFullInsight(result, context);
    case 'get_store_performance':
      return composeStorePerformance(result, context);
    case 'get_store_pulse':
      return composeStorePulse(result, context);
    case 'get_member_intelligence':
      return composeMemberIntelligence(result, context);
    case 'get_campaign_performance':
      return composeCampaignPerformance(result, context);
    case 'recommend_offer':
      return composeOfferRecommendations(result, context);
    case 'create_offer':
      return composeOfferCreated(result, context);
    case 'deploy_offer':
      return composeOfferDeployed(result, context);
    case AIRSPACE_ACTION:
      return composeAirspaceBrief(result, context);
    default:
      return composeGeneric(action, result, context);
  }
}
