// Engine result → board.
//
// These are honesty tests, not layout tests. The composers are the last thing
// standing between an operator and a number that looks measured but is not, so
// the suite pins the four ways that could go wrong: an unavailable feed must
// become a `gap` and never a reassuring verdict; an unmeasured lift must stay
// a dash; a rollup must carry its denominators; and a fit that loses to a flat
// baseline must say so on the board.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_VALUE, validateBlocks } from './blocks.js';
import {
  COMPOSED_ACTIONS,
  composeAnalyst,
  composeCompetitors,
  composeCoolOff,
  composeForAction,
  composeFuelOutlook,
  composeGeneric,
  composeHealth,
  composePending,
  composeTraffic,
  stripReadoutPrefix,
  triggersForPlay,
} from './composers.js';

/** Find the first block of a type. */
const find = (blocks, type) => blocks.find((block) => block.type === type) || null;
/** All blocks of a type. */
const all = (blocks, type) => blocks.filter((block) => block.type === type);

/** A cool-off result shaped exactly as `evaluateCoolOffOpportunities` returns. */
function coolOffResult(overrides = {}) {
  const top = {
    siteId: 'site-1',
    siteName: 'Casey’s #418',
    address: '1200 E Hwy 30',
    lat: 41.6,
    lon: -93.6,
    conversionScore: 82,
    urgencyLevel: 'High',
    delayMin: 11.4,
    distanceToBottleneckM: 840,
    isConstruction: true,
    approach: 'near',
    approachSide: 'right',
    approachDivided: true,
    offsetFromRoadM: 42,
    plays: [{
      id: 'play:cooloff-cold-drink',
      name: 'Cool-off cold drink bundle',
      action: 'Forecourt signage + geo-push: cold drink bundled with fill-up',
      rationale: 'Queued traffic on an adjacent corridor puts stopped drivers within a short detour.',
      expectedLiftPct: { value: null, confidence: 'unmeasured', n: 0 },
      requiresApproval: true,
    }],
    bottleneckRoadType: 'primary',
    bottleneckStatus: 'heavy',
    confidence: 'measured-inputs-ranked',
  };
  return {
    success: true,
    status: 'ready',
    totalSitesScanned: 12,
    opportunities: [top, { ...top, siteId: 'site-2', siteName: 'Casey’s #77', conversionScore: 61, delayMin: 6.2, approach: 'far' }],
    topOpportunity: top,
    actionableCount: 1,
    activeConstructionCount: 2,
    confidence: 'measured-inputs-ranked',
    readout: 'COOL-OFF — Casey’s #418: +11.4 min measured on an adjacent primary. Score 82/100.',
    ...overrides,
  };
}

test('an engine prefix is dropped so the verdict is not a duplicate label', () => {
  assert.equal(stripReadoutPrefix('TRAFFIC — 40 segments measured.'), '40 segments measured.');
  assert.equal(stripReadoutPrefix('PRICE MODEL — fitted on 500 weeks.'), 'fitted on 500 weeks.');
  assert.equal(stripReadoutPrefix('No prefix here.'), 'No prefix here.');
  assert.equal(stripReadoutPrefix(null), '');
});

test('cool-off: unavailable traffic becomes a gap, never an empty all-clear', () => {
  const blocks = composeCoolOff({
    success: false,
    status: 'no-key',
    opportunities: [],
    topOpportunity: null,
    confidence: 'unavailable',
    readout: 'COOL-OFF — cannot evaluate: TomTom key absent.',
  });

  const gap = find(blocks, 'gap');
  assert.ok(gap, 'an unavailable feed must produce a gap block');
  assert.match(gap.reason, /TomTom key absent/);
  assert.match(gap.remedy, /TOMTOM_API_KEY/);
  assert.equal(find(blocks, 'verdict'), null, 'no verdict is asserted from an unmeasured road');
  assert.equal(find(blocks, 'ranked'), null);
  assert.equal(find(blocks, 'plays'), null);
  assert.equal(find(blocks, 'head').status, 'error');
});

test('cool-off: the board carries the whole chain of custody', () => {
  const blocks = composeCoolOff(coolOffResult());

  const chain = find(blocks, 'chain');
  assert.deepEqual(chain.stages.map((stage) => stage.state), ['met', 'met', 'met', 'met', 'na']);
  assert.equal(chain.stages.at(-1).value, NO_VALUE, 'expected lift is blank, not projected');

  const evidence = find(blocks, 'evidence');
  assert.equal(evidence.rows.length, 5);
  assert.deepEqual(
    evidence.rows.map((row) => row.kind),
    ['measured', 'measured', 'derived', 'parameterised', 'unmeasured'],
  );
  assert.ok(evidence.rows.every((row) => row.source), 'every clause names a source');

  const ranked = find(blocks, 'ranked');
  assert.deepEqual(ranked.rows.map((row) => row.key), ['A', 'B']);
  assert.deepEqual(ranked.rows[0].focus, { id: 'site-1', lat: 41.6, lon: -93.6, label: 'Casey’s #418' });

  const multiples = find(blocks, 'multiples');
  assert.equal(multiples.tiles[0].key, ranked.rows[0].key, 'tiles and rows share their keys');
});

test('cool-off: an ambiguous approach side is downgraded from derived to unmeasured', () => {
  const result = coolOffResult();
  result.topOpportunity = { ...result.topOpportunity, approach: 'ambiguous' };
  const blocks = composeCoolOff(result);

  const approachRow = find(blocks, 'evidence').rows.find((row) => /side of the jam/.test(row.claim));
  assert.equal(approachRow.kind, 'unmeasured');
  assert.equal(find(blocks, 'chain').stages[2].state, 'na');
});

test('cool-off: a play card shows its thresholds against what was measured', () => {
  const blocks = composeCoolOff(coolOffResult());
  const card = find(blocks, 'plays').cards[0];

  assert.equal(card.approval, 'required');
  assert.equal(card.lift.display, NO_VALUE);
  assert.equal(card.lift.kind, 'unmeasured');

  const labels = card.triggers.map((trigger) => trigger.label);
  assert.ok(labels.some((label) => /Corridor delay ≥ 8 min/.test(label)));
  assert.ok(card.triggers.every((trigger) => trigger.met === true), 'this fixture satisfies every threshold');
});

test('triggersForPlay reports an unmet threshold rather than hiding it', () => {
  const play = { id: 'play:cooloff-cold-drink' };
  const triggers = triggersForPlay(play, {
    delayMin: 4, distanceToBottleneckM: 2400, approach: 'far', conversionScore: 30,
  });
  assert.ok(triggers.length > 0);
  assert.ok(triggers.every((trigger) => trigger.met === false));
});

test('triggersForPlay reports "unknown" when the signal itself is missing', () => {
  const triggers = triggersForPlay({ id: 'play:cooloff-cold-drink' }, {
    delayMin: null, distanceToBottleneckM: null, approach: 'ambiguous', conversionScore: null,
  });
  assert.ok(triggers.every((trigger) => trigger.met === null));
});

test('triggersForPlay returns nothing for a play id that is not in the library', () => {
  assert.deepEqual(triggersForPlay({ id: 'play:invented-by-a-model' }, { delayMin: 20 }), []);
});

test('health: no sites in scope is a gap with a way out, not a zero board', () => {
  const blocks = composeHealth({ siteCount: 0 }, { action: 'get_view_health' });
  const gap = find(blocks, 'gap');
  assert.ok(gap);
  assert.match(gap.remedy, /SITES panel/);
  assert.equal(find(blocks, 'readouts'), null);
});

test('health: an unmeasured dollar gap renders as a dash and says why', () => {
  const blocks = composeHealth({
    scopeLabel: 'within 40 km of view centre',
    siteCount: 6,
    competitorCount: 11,
    readout: '6 sites within 40 km of view centre.',
    traffic: {
      sitesWithLiveFlow: 4, congestedSites: 2, closedAccessSites: 0, meanCongestionScore: 63,
      worstSite: { id: 's3', name: 'Store 3', congestionScore: 88 },
      corridorBottlenecks: 5, corridorClosures: 1, maxCorridorDelayMin: 9,
    },
    price: { sitesWithPrice: 0, meanCentsVsAnchor: null, sitesAboveAnchor: null },
    economics: { recoverableGapUsd: null, gapConfidence: 'requires-actuals', rankedTop: [] },
    coverage: { sitesTotal: 6, flowCoverage: 4 / 6, priceCoverage: 0, trafficSegments: 140 },
  }, { action: 'get_view_health' });

  const gapReadout = find(blocks, 'readouts').items.find((item) => item.label === 'Recoverable gap');
  assert.equal(gapReadout.value, NO_VALUE);
  assert.equal(gapReadout.kind, 'unmeasured');

  const priceReadout = find(blocks, 'readouts').items.find((item) => item.label === 'Price vs anchor');
  assert.equal(priceReadout.value, NO_VALUE, 'no resolved price means no price position');

  const gapClaim = find(blocks, 'evidence').rows.find((row) => /Dollars recoverable/.test(row.claim));
  assert.equal(gapClaim.kind, 'unmeasured');
  assert.match(gapClaim.source, /own volumes/);

  const coverage = find(blocks, 'coverage');
  assert.deepEqual(coverage.bars.map((bar) => [bar.n, bar.of]), [[4, 6], [0, 6]]);
});

test('health: ungeocoded imports are declared instead of silently dropped', () => {
  const blocks = composeHealth({
    scopeLabel: 'across the portfolio',
    siteCount: 3,
    competitorCount: 0,
    readout: '3 sites across the portfolio.',
    traffic: { sitesWithLiveFlow: 0, meanCongestionScore: null, corridorClosures: null, worstSite: null },
    price: { sitesWithPrice: 0, meanCentsVsAnchor: null },
    economics: { recoverableGapUsd: null, gapConfidence: 'requires-actuals', rankedTop: [] },
    coverage: { sitesTotal: 3, flowCoverage: 0, priceCoverage: 0, trafficSegments: 0 },
    regions: [{ region: 'Iowa', siteCount: 2, sitesWithLiveFlow: 0 }, { region: 'Nebraska', siteCount: 1, sitesWithLiveFlow: 0 }],
    ungeocodedSites: 4,
  }, { action: 'get_portfolio_health' });

  const note = all(blocks, 'note').find((block) => /no coordinates/.test(block.text));
  assert.ok(note, 'sites without coordinates must be named');
  assert.ok(find(blocks, 'ranked'), 'a multi-region portfolio gets a regional breakdown');
});

test('price: a missing key is a gap that names the free key, and models nothing', () => {
  const blocks = composeFuelOutlook({
    status: 'no-key',
    confidence: 'unavailable',
    readout: 'PRICE — EIA_API_KEY is not configured.',
  });
  const gap = find(blocks, 'gap');
  assert.match(gap.remedy, /EIA_API_KEY/);
  assert.equal(find(blocks, 'band'), null, 'no band is drawn without a series');
  assert.equal(find(blocks, 'readouts'), null);
});

/** A ready price model, shaped as `buildRegionalPriceModel` returns. */
function priceResult({ beatsNaive = true } = {}) {
  return {
    status: 'ready',
    region: 'PADD 2 (Midwest)',
    seriesId: 'retail-padd2',
    anchor: { value: 3.214, period: '2026-08-31', unit: '$/gal', confidence: 'published' },
    spot: { label: 'Brent', value: 78.4, period: '2026-09-05', unit: '$/bbl', confidence: 'published' },
    model: { ok: true, observations: 520, maxLag: 6, passThroughUp: 0.62, passThroughDown: 0.41, asymmetry: 0.21 },
    validation: {
      ok: true,
      modelMaeCents: beatsNaive ? 3.1 : 6.9,
      naiveMaeCents: 5.2,
      improvementPct: beatsNaive ? 40.4 : -32.7,
      beatsNaive,
      holdoutWeeks: 104,
      trainedOn: 416,
    },
    forecast: {
      ok: true,
      anchor: 3.214,
      weeks: 4,
      points: [
        { week: 1, central: 3.22, low: 3.18, high: 3.26 },
        { week: 2, central: 3.25, low: 3.19, high: 3.32 },
        { week: 3, central: 3.27, low: 3.19, high: 3.36 },
        { week: 4, central: 3.28, low: 3.18, high: 3.41 },
      ],
      riskWidenedCents: 4,
      confidence: 'modelled-with-risk-overlay',
    },
    observations: 520,
    confidence: 'modelled-and-backtested',
    readout: 'PRICE MODEL — fitted on 520 weekly observations.',
    disruption: { gate: 'Strait of Hormuz', tankersInGate: 34 },
  };
}

test('price: a band is drawn as a range, with the risk widening explained', () => {
  const blocks = composeFuelOutlook(priceResult());
  const band = find(blocks, 'band');
  assert.equal(band.points.length, 4);
  assert.ok(band.points.every((point) => point.hi >= point.mid && point.mid >= point.lo));
  assert.match(band.note, /risk rose, not that the price will/);
  assert.match(band.baseline.label, /Naive/);

  const disruptionRow = find(blocks, 'evidence').rows.find((row) => /Supply risk/.test(row.claim));
  assert.equal(disruptionRow.kind, 'measured');
  assert.match(disruptionRow.source, /34 tankers/);
});

test('price: a fit that loses to a flat baseline says so on the board', () => {
  const blocks = composeFuelOutlook(priceResult({ beatsNaive: false }));
  assert.equal(find(blocks, 'verdict').kind, 'unmeasured');
  const warning = all(blocks, 'note').find((block) => /does NOT beat/.test(block.text));
  assert.ok(warning, 'the failure has to be visible, not buried in a confidence field');
  assert.equal(warning.tone, 'alert');
});

test('price: with no vessel layer the risk input is reported as absent', () => {
  const result = priceResult();
  delete result.disruption;
  const row = find(composeFuelOutlook(result), 'evidence').rows.find((r) => /Supply risk/.test(r.claim));
  assert.equal(row.kind, 'unmeasured');
  assert.match(row.source, /not loaded/);
});

test('competitors: an empty search is a real answer, not a placeholder set', () => {
  const blocks = composeCompetitors({
    success: false,
    status: 'no-competitors-found',
    readout: 'COMPETITIVE — searched Kwik Trip near this area and found no locations.',
  });
  const gap = find(blocks, 'gap');
  assert.match(gap.remedy, /no placeholder competitors/);
  assert.equal(find(blocks, 'ranked'), null);
});

test('competitors: location share is labelled as counting pins, not gallons', () => {
  const blocks = composeCompetitors({
    success: true,
    status: 'ready',
    primaryBrand: 'Casey’s',
    competitorBrands: ['Kwik Trip', 'Kum & Go'],
    clientSitesCount: 8,
    competitorSitesCount: 14,
    marketSharePct: 36,
    averageDominanceScore: 58,
    flowCoverage: 5,
    siteBreakdowns: [
      { siteName: 'Store 1', dominanceScore: 81, competitorsWithin1km: 0, lat: 41.1, lon: -93.1 },
      { siteName: 'Store 2', dominanceScore: 44, competitorsWithin1km: 3, lat: 41.2, lon: -93.2 },
    ],
    confidence: 'measured-density',
    readout: 'COMPETITIVE — 8 Casey’s locations against 14 mapped competitor sites.',
  });

  assert.ok(all(blocks, 'note').some((block) => /not market share/.test(block.text)));
  assert.deepEqual(find(blocks, 'ranked').rows.map((row) => row.value), [81, 44]);
  assert.deepEqual(find(blocks, 'coverage').bars[0].n, 5);
});

test('traffic: no key produces a gap that refuses to simulate', () => {
  const blocks = composeTraffic({ status: 'no-key', delays: [], bottlenecks: [] });
  assert.match(find(blocks, 'gap').remedy, /Nothing is simulated/);
});

test('traffic: bottlenecks rank by frustration and keep their delay in minutes', () => {
  const blocks = composeTraffic({
    status: 'ready',
    delays: [{}, {}, {}],
    bottlenecks: [
      { roadType: 'motorway', delayMin: 12.5, frustrationScore: 91, isClosure: true, delayStatus: 'blocked', midLat: 30.2, midLon: -97.7 },
      { roadType: 'primary', delayMin: 4.2, frustrationScore: 64, isConstruction: true, delayStatus: 'heavy' },
    ],
    constructionZones: [{}],
    corridorSummary: { averageDelayMin: 2.1, severeCorridorsCount: 2, constructionCount: 1, maxDelayMin: 12.5, overallCongestionScore: 41 },
    confidence: 'measured-flow',
    readout: 'TRAFFIC — 3 segments measured.',
  });
  const ranked = find(blocks, 'ranked');
  assert.equal(ranked.rows[0].display, '+12.5 min');
  assert.equal(ranked.rows[0].tone, 'alert');
  assert.deepEqual(ranked.rows[0].focus, { lat: 30.2, lon: -97.7, id: null, label: null });
  assert.equal(ranked.rows[1].focus, null, 'a segment without a midpoint gets no camera target');
});

test('analyst: a rejected query explains what would make it answerable', () => {
  const blocks = composeAnalyst({ ok: false, error: 'Unsupported layer' });
  assert.match(find(blocks, 'gap').remedy, /Enable the layer/);
});

test('analyst: a result set becomes rows with their layer named', () => {
  const blocks = composeAnalyst({
    ok: true,
    count: 2,
    scopeLabel: 'in view',
    truncated: false,
    summary: '2 vessels in view',
    items: [{ layerKey: 'ais-live-vessels', name: 'MAERSK', lat: 1, lon: 2 }, { layerKey: 'ais-live-vessels', name: 'EVER' }],
    coverage: { layersQueried: ['ais-live-vessels'] },
  });
  const ranked = find(blocks, 'ranked');
  assert.deepEqual(ranked.rows.map((row) => row.label), ['MAERSK', 'EVER']);
  assert.ok(ranked.rows[0].focus, 'a record with coordinates is clickable');
});

test('an action with no bespoke composer still produces an honest board', () => {
  const blocks = composeGeneric('get_weather', { ok: true, readout: 'WEATHER — 24°C, clear.', temperatureC: 24 });
  assert.equal(find(blocks, 'verdict').text, '24°C, clear.');
  assert.equal(find(blocks, 'evidence').rows[0].source, 'gevActions → get_weather');

  const failed = composeGeneric('get_weather', { ok: false, error: 'no coverage' });
  assert.equal(find(failed, 'gap').reason, 'no coverage');
});

test('composeForAction routes every advertised action and falls back safely', () => {
  assert.equal(composeForAction('get_cool_off_opportunities', coolOffResult())[0].type, 'head');
  assert.equal(composeForAction('get_portfolio_health', { siteCount: 0 })[0].type, 'head');
  assert.equal(composeForAction('something_new', { ok: true })[0].type, 'head');
  for (const action of COMPOSED_ACTIONS) {
    const blocks = composeForAction(action, {});
    assert.ok(blocks.length > 0, `${action} produced no blocks`);
  }
});

test('the pending header lands before any engine has answered', () => {
  const blocks = composePending({ question: 'How is this view doing?', scope: 'in view', action: 'get_view_health' });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].status, 'pending');
});

test('every composed board is structurally valid with unique block ids', () => {
  const boards = [
    composeCoolOff(coolOffResult()),
    composeCoolOff({ success: false, readout: 'COOL-OFF — cannot evaluate: no key.' }),
    composeHealth({ siteCount: 0 }, { action: 'get_view_health' }),
    composeFuelOutlook(priceResult()),
    composeFuelOutlook({ status: 'no-key', readout: 'PRICE — no key.' }),
    composeTraffic({ status: 'no-key' }),
    composeAnalyst({ ok: false, error: 'x' }),
    composeGeneric('get_weather', { ok: true, readout: 'WEATHER — fine.' }),
  ];
  for (const blocks of boards) {
    const report = validateBlocks(blocks);
    assert.equal(report.ok, true, report.problems.join('; '));
    const ids = blocks.map((block) => block.id);
    assert.equal(new Set(ids).size, ids.length, 'block ids must be unique to be patchable');
    assert.equal(blocks[0].type, 'head', 'every board opens with its question');
  }
});
