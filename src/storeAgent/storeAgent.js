/**
 * @file The store agent itself: one entry point per operator question, each
 * returning a typed result the voice runner and the explain board both read.
 *
 * This is the orchestration layer over `storeLedger`, `storePulse`,
 * `memberGraph` and `offerStudio`. It resolves WHICH store is being asked
 * about, gathers the answer, and writes the one-line readout the voice model
 * speaks. It stays pure with respect to the network and the DOM -- live
 * context (weather, traffic, competitors) is passed in by the caller, which
 * already has those engines wired.
 *
 * Read `storeLedger.js`'s header for what the data behind these answers is.
 *
 * STORE RESOLUTION, in order: an explicitly named store, then the nearest
 * portfolio site to the camera, then a site anchored at the camera itself.
 * That last fallback matters -- an operator who has not imported a portfolio
 * yet should still be able to ask about the store they are looking at, and
 * the alternative is a console that refuses to answer until a CSV arrives.
 *
 * @module storeAgent/storeAgent
 */

import { DAYPARTS, periodPerformance, seeded, storeProfile } from './storeLedger.js';
import { realtimePulse } from './storePulse.js';
import { memberBase, memberProfile, resolveIdentity, segmentById } from './memberGraph.js';
import { createOffer, deployOffer, rankOffers, surfaceById, SURFACES } from './offerStudio.js';
import { campaignBook, verdictFor } from './campaignBook.js';
import { findOffer, loadOffers, saveOffer } from './offerRegistry.js';

/* -- Store resolution ---------------------------------------------------- */

function haversineKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = Math.PI / 180;
  const dLat = (latB - latA) * toRad;
  const dLon = (lonB - lonA) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latA * toRad) * Math.cos(latB * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Pick the store an answer is about.
 *
 * @param {{sites?: object[], query?: string|null, lat?: number|null, lon?: number|null, placeLabel?: string|null}} input
 * @returns {{site: object, how: string, distanceKm: number|null}}
 */
export function resolveStore({ sites = [], query = null, lat = null, lon = null, placeLabel = null } = {}) {
  const portfolio = (sites || []).filter(Boolean);

  if (query) {
    const needle = String(query).trim().toLowerCase();
    const scored = portfolio
      .map((site) => {
        const name = String(site.name || '').toLowerCase();
        const address = String(site.address || '').toLowerCase();
        const ref = String(site.externalRef || '').toLowerCase();
        let score = 0;
        if (name === needle || ref === needle) score = 100;
        else if (name.includes(needle) || needle.includes(name)) score = 70;
        else if (address.includes(needle)) score = 40;
        else if (ref && needle.includes(ref)) score = 55;
        return { site, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return { site: scored[0].site, how: 'named', distanceKm: null };
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const nearest = portfolio
      .filter((site) => Number.isFinite(site.lat) && Number.isFinite(site.lon))
      .map((site) => ({ site, distanceKm: haversineKm(lat, lon, site.lat, site.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (nearest) return { site: nearest.site, how: 'nearest-in-view', distanceKm: Number(nearest.distanceKm.toFixed(2)) };
  }

  if (portfolio.length > 0) return { site: portfolio[0], how: 'only-site', distanceKm: null };

  // Nothing imported. Anchor a store on the camera so the console can still
  // answer about the place the operator is looking at.
  const anchorLat = Number.isFinite(lat) ? lat : 30.2672;
  const anchorLon = Number.isFinite(lon) ? lon : -97.7431;
  const id = `site:view:${anchorLat.toFixed(3)},${anchorLon.toFixed(3)}`;
  const profile = storeProfile({ id });
  return {
    site: {
      id,
      name: placeLabel ? `Store #${profile.storeNumber} - ${placeLabel}` : `Store #${profile.storeNumber}`,
      address: placeLabel || null,
      lat: anchorLat,
      lon: anchorLon,
      format: null,
    },
    how: 'camera-anchored',
    distanceKm: null,
  };
}

/* -- Formatting helpers -------------------------------------------------- */

const usd = (value) => (Number.isFinite(value)
  ? `$${Math.round(Number(value)).toLocaleString('en-US')}`
  : '--');

const signedPct = (value) => (Number.isFinite(value)
  ? `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(Number(value)).toFixed(1)}%`
  : '--');

const int = (value) => (Number.isFinite(value) ? Math.round(Number(value)).toLocaleString('en-US') : '--');

/* -- 1. Performance ------------------------------------------------------ */

/** Day counts the `period` argument maps onto. */
const PERIOD_DAYS = Object.freeze({ today: 1, week: 7, month: 28, quarter: 91 });

/**
 * "How is this store doing this week?"
 *
 * @param {object} site
 * @param {{period?: string, now?: Date, weather?: object, brand?: string|null}} [context]
 * @returns {object}
 */
export function storePerformance(site, context = {}) {
  const period = PERIOD_DAYS[String(context.period || 'week')] ? String(context.period) : 'week';
  const performance = periodPerformance(site, {
    now: context.now,
    days: PERIOD_DAYS[period],
    weather: context.weather,
  });

  const { totals, deltas, best, worst, profile } = performance;
  const strongestCategory = performance.categories
    .slice()
    .sort((a, b) => (b.deltaPct ?? -999) - (a.deltaPct ?? -999))[0];
  const weakestCategory = performance.categories
    .slice()
    .sort((a, b) => (a.deltaPct ?? 999) - (b.deltaPct ?? 999))[0];
  const weakestDaypart = performance.dayparts
    .slice()
    .sort((a, b) => (a.deltaPct ?? 999) - (b.deltaPct ?? 999))[0];

  const readout = period === 'today'
    ? `${usd(totals.totalSales)} today on ${int(totals.totalTransactions)} transactions, ${signedPct(deltas.totalSales)} against the same day last week.`
    : `${usd(totals.totalSales)} over ${performance.days} days, ${signedPct(deltas.totalSales)} on the prior ${performance.days}. `
      + `${best?.weekdayName} carried it at ${signedPct(best?.salesDeltaPct)}; ${worst?.weekdayName} leaked ${signedPct(worst?.salesDeltaPct)}. `
      + `${weakestCategory?.label} is the soft line at ${signedPct(weakestCategory?.deltaPct)}.`;

  return {
    kind: 'store-performance',
    period,
    store: { id: profile.siteId, name: profile.siteName, number: profile.storeNumber },
    ...performance,
    highlights: {
      bestDay: best ? { day: best.weekdayName, date: best.date, deltaPct: best.salesDeltaPct, sales: best.totalSales } : null,
      worstDay: worst ? { day: worst.weekdayName, date: worst.date, deltaPct: worst.salesDeltaPct, sales: worst.totalSales } : null,
      strongestCategory: strongestCategory || null,
      weakestCategory: weakestCategory || null,
      weakestDaypart: weakestDaypart || null,
    },
    readout,
  };
}

/* -- 2. Pulse ------------------------------------------------------------ */

/**
 * "Are we seeing a dip right now?"
 *
 * @param {object} site
 * @param {object} [context]
 * @returns {object}
 */
export function storePulse(site, context = {}) {
  const pulse = realtimePulse(site, context);
  const lead = pulse.causes[0] || null;

  const readout = pulse.state === 'on-plan'
    ? `Running on plan: ${int(pulse.hour.actual)} transactions this hour against ${int(pulse.hour.planned)} expected.`
    : `${pulse.state === 'dip' ? 'Down' : 'Up'} ${Math.abs(pulse.hour.variancePct)}% this hour -- ${int(pulse.hour.actual)} transactions against ${int(pulse.hour.planned)} expected`
      + `${lead ? `. Biggest single factor: ${lead.label}, about ${Math.round(lead.share * 100)}% of the gap` : ''}`
      + `${pulse.unexplainedShare > 0.25 ? `, with ${Math.round(pulse.unexplainedShare * 100)}% unexplained` : ''}.`;

  return { kind: 'store-pulse', store: { id: pulse.profile.siteId, name: pulse.profile.siteName, number: pulse.profile.storeNumber }, ...pulse, readout };
}

/* -- 3. Members ---------------------------------------------------------- */

/**
 * "Who is on the file, and who should I be talking to?"
 *
 * @param {object} site
 * @param {{focus?: string, segmentId?: string|null, memberId?: string|null, signals?: string[]|null, now?: Date}} [context]
 * @returns {object}
 */
export function memberIntelligence(site, context = {}) {
  const focus = ['segments', 'member', 'identity'].includes(String(context.focus))
    ? String(context.focus)
    : (context.memberId || context.segmentId ? 'member' : 'segments');
  const base = memberBase(site, context);
  const store = { id: base.profile.siteId, name: base.profile.siteName, number: base.profile.storeNumber };

  if (focus === 'identity') {
    const resolution = resolveIdentity(site, { signals: context.signals, now: context.now });
    // Applied and merely-matched are different claims, and the readout has to
    // keep them apart -- "we know who that was" and "we think we might" lead
    // an operator to different actions.
    const readout = !resolution.resolved
      ? resolution.reason
      : `${resolution.applied ? 'Bridged' : 'Matched'} an anonymous transaction to ${resolution.member.name}, ${resolution.member.tier}, `
        + `at ${Math.round(resolution.confidence * 100)}% confidence on ${resolution.signals.length} signal${resolution.signals.length === 1 ? '' : 's'}`
        + `${resolution.applied ? '' : ` -- under the ${Math.round(resolution.threshold * 100)}% auto-merge bar, so it is held for review and nothing was written to the member record`}. `
        + `Across the day the bridge recovers ${int(resolution.programmeEffect.recoveredPerDay)} otherwise-anonymous transactions and moves identified share from ${resolution.programmeEffect.identifiedShareBefore}% to ${resolution.programmeEffect.identifiedShareAfter}%.`;
    return { kind: 'member-identity', focus, store, base, resolution, readout };
  }

  if (focus === 'member') {
    const member = memberProfile(site, {
      segmentId: context.segmentId || 'lapsing-high-value',
      memberId: context.memberId,
      now: context.now,
    });
    const readout = `${member.name}, ${member.tier}, ${member.segmentLabel}. `
      + `${member.behaviour.visitsPerMonth} visits a month, ${int(member.behaviour.gallons90)} gallons and ${usd(member.behaviour.insideSpend90)} inside over 90 days, `
      + `last seen ${member.lastVisitDaysAgo} days ago. Next best action: ${member.nextBestAction.action}.`;
    return { kind: 'member-profile', focus, store, base, member, readout };
  }

  const top = base.segments[0];
  const opportunity = base.segments.find((segment) => segment.id === 'fuel-only')
    || base.segments.find((segment) => segment.id === 'lapsing-high-value')
    || base.segments[1];
  const readout = `${int(base.enrolled)} enrolled, ${int(base.active30)} active in the last 30 days, ${Math.round(base.attachRate * 100)}% of transactions identified. `
    + `${top.label} contributes the most gross profit at ${usd(top.monthlyGrossProfit)} a month. `
    + `The opening is ${opportunity.label}: ${int(opportunity.members)} members, ${Math.round(opportunity.attachRate * 100)}% inside attach.`;

  return { kind: 'member-segments', focus, store, base, segments: base.segments, readout };
}

/* -- 4. Offer recommendation -------------------------------------------- */

/**
 * "What should I run right now?"
 *
 * @param {object} site
 * @param {{now?: Date, weather?: object, traffic?: object|null, competitors?: object[]|null, goal?: string|null, limit?: number}} [context]
 * @returns {object}
 */
export function recommendOffers(site, context = {}) {
  const profile = storeProfile(site);
  const pulse = realtimePulse(site, context);
  const members = memberBase(site, context);
  const enriched = { ...context, pulse, members, basketAvg: pulse.basketAvg };
  const { ranked, triggers, reasons } = rankOffers(site, enriched);
  const limit = Math.max(1, Math.min(5, Number(context.limit) || 3));

  const candidates = ranked.slice(0, limit).map((row) => {
    const segment = members.segments.find((s) => row.offer.segments.includes(s.id)) || null;
    const surface = surfaceById(row.offer.surfaces[0]);
    const exposed = segment ? segment.members : Math.round(profile.insideBase * 0.4);
    return {
      offerId: row.offer.id,
      name: row.offer.name,
      mechanic: row.offer.mechanic,
      objective: row.offer.objective,
      valueLabel: row.offer.valueLabel,
      detail: row.offer.detail,
      motif: row.offer.motif,
      score: row.score,
      matchedTriggers: row.matchedTriggers,
      reasons: row.reasons || [],
      rationale: row.rationale,
      targetSegment: segment ? { id: segment.id, label: segment.label, members: segment.members } : null,
      recommendedSurfaces: row.offer.surfaces.slice(0, 3),
      leadSurface: surface ? { id: surface.id, label: surface.label, leadTimeMinutes: surface.leadTimeMinutes } : null,
      priors: row.priors,
      exposed,
    };
  });

  const top = candidates[0] || null;
  // One recommendation, the reason it fires, and the reach. An operator
  // deciding in the next two minutes does not need the runners-up read aloud.
  const why = (top?.reasons || []).map((reason, index) => (index === 0 ? reason : reason.charAt(0).toLowerCase() + reason.slice(1)));
  const readout = top
    ? `Run ${top.name}${top.targetSegment ? ` at ${top.targetSegment.label.toLowerCase()}` : ''}`
      + `${top.leadSurface ? ` on the ${top.leadSurface.label.toLowerCase()}` : ''}`
      + `${top.targetSegment ? ` -- ${int(top.targetSegment.members)} members` : ''}. `
      + `${why.length ? `Why now: ${why.join(', ')}.` : 'No live trigger fires for it, so this is a default rather than a read.'}`
      + `${top.leadSurface ? ` Live in ${top.leadSurface.leadTimeMinutes} minutes on your word.` : ''}`
    : 'Nothing in the catalogue fires against the current conditions.';

  return {
    kind: 'offer-recommendations',
    store: { id: profile.siteId, name: profile.siteName, number: profile.storeNumber },
    pulse,
    members,
    triggers,
    triggerReasons: reasons,
    candidates,
    readout,
  };
}

/* -- 5. Campaign book ---------------------------------------------------- */

/**
 * Turn an offer this session deployed into a campaign row, so "what is
 * running?" includes what the operator just launched rather than only what
 * was already in flight. A campaign minutes old has no result yet, and the
 * row says that instead of reporting a pace of zero as a failure.
 *
 * @param {object} deployed
 * @param {Date} now
 * @returns {object}
 */
function campaignFromDeployedOffer(deployed, now) {
  const minutesLive = Math.max(0, Math.round((now.getTime() - new Date(deployed.deployedAt || deployed.createdAt).getTime()) / 60000));
  const live = (deployed.surfaces || []).filter((surface) => surface.status === 'live');
  return {
    campaignId: deployed.offerId,
    offerId: deployed.offer.id,
    name: deployed.offer.name,
    mechanic: deployed.offer.mechanic,
    objective: deployed.offer.objective,
    category: deployed.offer.category,
    motif: deployed.offer.motif,
    valueLabel: deployed.offer.valueLabel,
    status: 'live',
    launchedAt: deployed.deployedAt || deployed.createdAt,
    endsAt: deployed.endsAt,
    plannedDays: deployed.durationDays,
    daysElapsed: 0,
    daysRemaining: deployed.durationDays,
    launchedThisSession: true,
    minutesLive,
    audience: {
      segmentId: deployed.audience?.segmentId || null,
      label: deployed.audience?.label || 'All members',
      size: deployed.audience?.size || 0,
    },
    surfaces: live.map((surface) => ({ id: surface.surfaceId, label: surface.surfaceLabel })),
    forecast: {
      kind: 'modelled',
      totalRedemptions: deployed.forecast.redemptions.expected,
      band: [deployed.forecast.redemptions.lo, deployed.forecast.redemptions.hi],
      perDay: Math.round(deployed.forecast.redemptions.expected / Math.max(1, deployed.durationDays)),
      proratedToDate: 0,
      basis: deployed.forecast.basis,
    },
    // Nothing has happened yet, and every field says so rather than reading
    // as a zero result.
    actual: {
      kind: 'measured',
      redemptions: 0,
      perDay: null,
      redemptionRate: null,
      incrementalVisits: 0,
      incrementalSales: 0,
      marginGive: 0,
      netGrossProfit: 0,
      returnOnGive: null,
    },
    series: [],
    paceRatio: null,
    pacePct: null,
    verdict: 'too-early',
    verdictLabel: minutesLive < 60 ? `Launched ${minutesLive} min ago` : 'Too early to read',
    verdictTone: 'ghost',
    advice: 'No reading yet. Give it a full daypart before judging it.',
    trend: { direction: 'too-early', changePct: null },
  };
}

/**
 * "What loyalty campaigns are running, and which ones are working?"
 *
 * @param {object} site
 * @param {{now?: Date, status?: string|null, sort?: string|null}} [context]
 * @returns {object}
 */
export function campaignPerformance(site, context = {}) {
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const members = memberBase(site, { now });
  const book = campaignBook(site, { now, members });

  // Anything deployed in this session, for this store, joins the book.
  const sessionCampaigns = loadOffers()
    .filter((offer) => offer.status === 'live' && offer.site?.id === book.profile.siteId)
    .map((offer) => campaignFromDeployedOffer(offer, now));

  const wanted = String(context.status || 'live');
  const all = [...sessionCampaigns, ...book.campaigns];
  const campaigns = wanted === 'all' ? all : all.filter((campaign) => campaign.status === wanted);

  const readable = campaigns.filter((campaign) => Number.isFinite(campaign.paceRatio));
  const winners = readable.filter((campaign) => campaign.paceRatio >= 1.05 && campaign.actual.netGrossProfit > 0);
  const losers = readable.filter((campaign) => campaign.actual.netGrossProfit < 0 || campaign.paceRatio < 0.88);
  const best = readable[0] || null;
  const drain = readable.filter((campaign) => campaign.actual.netGrossProfit < 0)
    .sort((a, b) => a.actual.netGrossProfit - b.actual.netGrossProfit)[0] || null;
  const fastest = readable.slice().sort((a, b) => b.paceRatio - a.paceRatio)[0] || null;
  // The most useful sentence in the whole book is the one where redemption
  // volume and profit disagree, so it gets said explicitly rather than left
  // for the operator to spot across two columns. The case that matters is a
  // campaign BEATING its plan while losing money -- not merely the worst one.
  const divergence = readable
    .filter((campaign) => campaign.paceRatio >= 1.05 && campaign.actual.netGrossProfit < 0)
    .sort((a, b) => a.actual.netGrossProfit - b.actual.netGrossProfit)[0] || null;

  const readout = campaigns.length === 0
    ? 'Nothing is running at this store right now.'
    : `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} live. `
      + (best && best.actual.netGrossProfit > 0
        ? `${best.name} is the one paying: ${usd(best.actual.netGrossProfit)} net on ${int(best.actual.redemptions)} redemptions, ${best.pacePct}% of its forecast pace. `
        : 'Nothing in the book is currently net positive. ')
      + (divergence
        ? `Watch ${divergence.name} -- redeeming at ${divergence.pacePct}% of plan and still ${usd(Math.abs(divergence.actual.netGrossProfit))} down, because ${int(divergence.actual.cannibalised)} of those redemptions were coming anyway. `
        : drain
          ? `${drain.name} is the drain: ${usd(Math.abs(drain.actual.netGrossProfit))} down on ${usd(drain.actual.marginGive)} of give at ${drain.pacePct}% of pace. `
          : '')
      + `Across the book, ${usd(book.totals.marginGive)} of margin given away returned `
      + `${book.totals.programReturn === null ? 'nothing measurable' : `${book.totals.programReturn}x`}.`;

  return {
    kind: 'campaign-performance',
    store: { id: book.profile.siteId, name: book.profile.siteName, number: book.profile.storeNumber },
    at: book.at,
    campaigns,
    totals: book.totals,
    winners: winners.map((campaign) => campaign.campaignId),
    losers: losers.map((campaign) => campaign.campaignId),
    best,
    worst: readable[readable.length - 1] || null,
    fastestPace: fastest,
    biggestDrain: drain,
    divergence,
    overlaps: book.overlaps,
    readout,
  };
}

/* -- 6. Create ----------------------------------------------------------- */

/**
 * Build an offer and its creative. Stages it -- nothing goes live here.
 *
 * @param {object} site
 * @param {object} spec
 * @param {object} [context]
 * @returns {object}
 */
export function stageOffer(site, spec = {}, context = {}) {
  const pulse = realtimePulse(site, context);
  const members = memberBase(site, context);
  const created = createOffer(site, spec, {
    ...context,
    pulse,
    members,
    basketAvg: pulse.basketAvg,
  });
  saveOffer(created);

  const forecast = created.forecast;
  const readout = `${created.offer.name} is built and staged as ${created.offerId}, targeting ${created.audience.label}`
    + `${created.audience.size ? ` -- ${int(created.audience.size)} members` : ''}. `
    + `Creative is ready for ${created.creatives.map((c) => c.surfaceLabel.toLowerCase()).join(', ')}. `
    + `Forecast is ${int(forecast.redemptions.expected)} redemptions over ${created.durationDays} day${created.durationDays === 1 ? '' : 's'}, `
    + `band ${int(forecast.redemptions.lo)} to ${int(forecast.redemptions.hi)}, modelled on ${forecast.basis}. `
    + `${forecast.capped ? `${forecast.capacityNote} ` : ''}Nothing is live until you say so.`;

  return { kind: 'offer-created', ...created, readout };
}

/* -- 7. Deploy ----------------------------------------------------------- */

/**
 * Push a staged offer onto its surfaces.
 *
 * @param {{offerId?: string|null, surfaces?: string[], sendPush?: boolean, now?: Date}} [input]
 * @returns {object}
 */
export function publishOffer(input = {}) {
  const staged = findOffer(input.offerId || null);
  if (!staged) {
    return {
      kind: 'offer-deploy',
      ok: false,
      error: input.offerId
        ? `No staged offer with id ${input.offerId}.`
        : 'No offer has been created in this session yet.',
      readout: input.offerId
        ? `I do not have an offer with id ${input.offerId}. Create it first and I will push it.`
        : 'There is no staged offer to push. Tell me what to build and I will have it ready.',
    };
  }

  const deployed = deployOffer(staged, input);
  saveOffer(deployed);

  const live = deployed.surfaces.filter((surface) => surface.status === 'live');
  const readout = `${deployed.offer.name} is live on ${live.map((surface) => surface.surfaceLabel.toLowerCase()).join(', ')}`
    + `${deployed.pushSent ? ', push sent' : ''}. `
    + `${int(deployed.totalImpressionsPerDay)} impressions a day across those surfaces. `
    + `${live.some((surface) => surface.leadTimeMinutes > 2) ? `Slowest surface is up in ${Math.max(...live.map((s) => s.leadTimeMinutes))} minutes.` : 'Everything is up within two minutes.'}`;

  return { kind: 'offer-deploy', ok: true, ...deployed, readout };
}

/* -- Re-exports the runner needs ----------------------------------------- */

export { DAYPARTS, SURFACES, segmentById, seeded, verdictFor };
