/**
 * @file The campaign book: what loyalty offers are live right now, how each
 * one is actually performing against the forecast it launched on, and which
 * ones should be pushed, left alone, or killed.
 *
 * Same standing as `storeLedger.js` -- deterministic simulation, not a live
 * connection. Read that file's header first.
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT
 *
 * A running campaign has two numbers and they are different kinds of claim:
 *
 *   - What it has DONE. Redemptions, spend, margin given away. These are
 *     transactions that happened. `measured`.
 *   - What it was SUPPOSED to do. The forecast band it launched on.
 *     `modelled`, with the prior-run count behind it.
 *
 * "Doing well" is the comparison of the first against the second, and it is
 * only meaningful if the two are never merged. So every campaign row carries
 * both, separately labelled, and the verdict names which side it fell on. A
 * campaign at 140% of forecast is not "up 40%" against last year, against the
 * category, or against anything else -- it is ahead of its own plan, and the
 * board says exactly that.
 *
 * PACE, NOT TOTAL. A campaign three days into fourteen has not underperformed
 * by 78%. Every comparison here is against the forecast PRORATED to the days
 * elapsed, which is the only way a mid-flight verdict means anything.
 *
 * @module storeAgent/campaignBook
 */

import { addDays, dayKey, dayPerformance, seeded, storeProfile } from './storeLedger.js';
import { memberBase, segmentById } from './memberGraph.js';
import { OFFER_CATALOG, categoryCapacity, forecastOffer, offerEconomics, surfaceById } from './offerStudio.js';

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Verdict bands, as a share of the prorated forecast. Deliberately wide in
 * the middle: a campaign at 94% of pace has not failed, and telling an
 * operator it has will get the console ignored.
 */
export const VERDICTS = Object.freeze([
  { id: 'outperforming', label: 'Outperforming', min: 1.18, tone: 'signal', advice: 'Extend it or widen the audience -- it is beating its own plan with room left.' },
  { id: 'ahead', label: 'Ahead of pace', min: 1.05, tone: 'signal', advice: 'Leave it alone. It is working.' },
  { id: 'on-plan', label: 'On plan', min: 0.88, tone: 'ghost', advice: 'No action. It is doing what it was built to do.' },
  { id: 'behind', label: 'Behind pace', min: 0.68, tone: 'caution', advice: 'Move it to a surface with more qualified reach before spending more on it.' },
  { id: 'failing', label: 'Failing', min: 0, tone: 'alert', advice: 'Kill it. The margin give is buying redemptions that were going to happen anyway.' },
]);

/** Resolve the verdict for a pace ratio. */
export function verdictFor(paceRatio) {
  if (!Number.isFinite(paceRatio)) return VERDICTS[2];
  return VERDICTS.find((verdict) => paceRatio >= verdict.min) || VERDICTS[VERDICTS.length - 1];
}

/**
 * How many campaigns a store of this size is realistically running at once.
 * More than about eight and they cannibalise each other, which is itself a
 * finding the book should be able to report.
 */
function campaignCount(rng, profile) {
  return Math.max(3, Math.min(8, Math.round(rng.between(4, 7) * Math.min(1.3, profile.scale))));
}

/**
 * Build the live campaign book for a site.
 *
 * Every campaign is a catalogue mechanic that launched some days ago against
 * a segment on a set of surfaces, with a forecast recorded at launch and a
 * day-by-day redemption series since. The series is generated per campaign
 * per day, so the totals are a real sum rather than a headline number with
 * invented daily detail beneath it.
 *
 * @param {object} site
 * @param {{now?: Date, members?: object|null}} [context]
 * @returns {object}
 */
export function campaignBook(site, context = {}) {
  const profile = storeProfile(site);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const members = context.members || memberBase(site, { now });
  const rng = seeded('campaigns', profile.siteId, dayKey(now).slice(0, 7));

  const count = campaignCount(rng, profile);
  // Pick distinct mechanics -- a book with two cents-off-per-gallon campaigns
  // running at once is a mis-configuration, not a plan.
  const pool = OFFER_CATALOG.filter((offer) => {
    if (offer.category === 'carwash' && !profile.carWash) return false;
    if (offer.category === 'foodservice' && !profile.kitchen) return false;
    return true;
  });
  const chosen = [];
  const used = new Set();
  let guard = 0;
  while (chosen.length < Math.min(count, pool.length) && guard < 200) {
    guard += 1;
    const candidate = rng.pick(pool);
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    chosen.push(candidate);
  }

  const campaigns = chosen.map((offer, index) => buildCampaign({
    site, profile, offer, index, now, members,
  }));

  const active = campaigns.filter((campaign) => campaign.status === 'live');
  const spend = round2(campaigns.reduce((total, campaign) => total + campaign.actual.marginGive, 0));
  const netGp = round2(campaigns.reduce((total, campaign) => total + campaign.actual.netGrossProfit, 0));
  const redemptions = campaigns.reduce((total, campaign) => total + campaign.actual.redemptions, 0);

  // Ordered by what the campaign made, not by how many coupons moved. The
  // pace column is still there and still matters, but a book sorted by
  // redemptions puts the most expensive mistake at the top of the page.
  const sorted = campaigns.slice().sort((a, b) => b.actual.netGrossProfit - a.actual.netGrossProfit);

  return {
    profile,
    at: now.toISOString(),
    campaigns: sorted,
    activeCount: active.length,
    totals: {
      redemptions,
      marginGive: spend,
      incrementalSales: round2(campaigns.reduce((total, c) => total + c.actual.incrementalSales, 0)),
      netGrossProfit: netGp,
      // Return on the margin actually given away. The number that decides
      // whether the programme as a whole is paying for itself.
      programReturn: spend > 0 ? Number((netGp / spend).toFixed(2)) : null,
      membersReached: campaigns.reduce((total, c) => total + c.audience.size, 0),
    },
    best: sorted[0] || null,
    worst: sorted[sorted.length - 1] || null,
    // Kept separately because the two questions have different answers: the
    // campaign making the most money and the campaign hitting its plan are
    // often not the same campaign.
    fastestPace: campaigns.slice().sort((a, b) => b.paceRatio - a.paceRatio)[0] || null,
    biggestDrain: campaigns.filter((c) => c.actual.netGrossProfit < 0)
      .sort((a, b) => a.actual.netGrossProfit - b.actual.netGrossProfit)[0] || null,
    // Campaigns chasing the same segment with the same objective are spending
    // twice to move one person. Worth naming without being asked.
    overlaps: findOverlaps(sorted),
  };
}

/** One campaign, launch to now. */
function buildCampaign({ site, profile, offer, index, now, members }) {
  const rng = seeded('campaign', profile.siteId, offer.id, dayKey(now).slice(0, 7));

  const plannedDays = Math.round(rng.between(7, 30));
  const daysElapsed = Math.max(1, Math.min(plannedDays, Math.round(rng.between(1, plannedDays))));
  const launchedAt = addDays(now, -daysElapsed);
  const endsAt = addDays(launchedAt, plannedDays);
  const status = daysElapsed >= plannedDays ? 'ended' : 'live';

  const segment = segmentById(rng.pick(offer.segments)) || null;
  const sized = segment ? members.segments.find((row) => row.id === segment.id) : null;
  const audienceSize = sized ? sized.members : Math.round(profile.loyaltyEnrolled * 0.22);

  const surfaces = offer.surfaces.slice(0, Math.max(1, Math.round(rng.between(1, 3))))
    .map((id) => surfaceById(id))
    .filter(Boolean)
    .map((surface) => ({ id: surface.id, label: surface.label }));

  // The forecast this campaign LAUNCHED on. Recorded once; never re-derived
  // to match the result, which would make every campaign look on-plan.
  const forecast = forecastOffer(site, offer, {
    exposed: audienceSize,
    matchedTriggers: [],
    basketAvg: 8.4,
    durationDays: plannedDays,
    capacityPerDay: categoryCapacity(site, offer, launchedAt),
  });

  // A per-day redemption series. `performance` is the campaign's own quality
  // factor -- some land, some do not, and the spread is what makes the book
  // worth reading.
  const performance = rng.between(0.42, 1.62);
  const plannedPerDay = forecast.redemptions.expected / plannedDays;
  const series = [];
  for (let day = 0; day < daysElapsed; day += 1) {
    const date = addDays(launchedAt, day);
    const dayRng = seeded('camday', profile.siteId, offer.id, dayKey(date));
    // Novelty decay: most mechanics peak in the first three days and settle.
    const decay = 0.72 + 0.58 * Math.exp(-day / 5.5);
    const redemptions = Math.max(0, Math.round(plannedPerDay * performance * decay * dayRng.between(0.78, 1.24)));
    series.push({
      date: dayKey(date),
      dayIndex: day + 1,
      redemptions,
      planned: Math.round(plannedPerDay),
    });
  }

  const redemptions = series.reduce((total, row) => total + row.redemptions, 0);
  const today = dayPerformance(site, now, { profile });
  // Same promo-economics as the forecast, so plan and result are comparable
  // rather than two differently-computed numbers put side by side.
  const economics = offerEconomics(offer, redemptions, {
    basketAvg: today.basketAvg,
    gallonsPerFill: profile.gallonsPerFill,
    fuelMarginCpg: today.fuelMarginCpg,
    streetPrice: today.streetPrice,
  });

  // Pace: measured redemptions against the forecast PRORATED to the elapsed
  // days. Comparing a three-day-old campaign to a fourteen-day forecast is
  // the most common way a book like this lies.
  const proratedForecast = Math.max(1, Math.round(forecast.redemptions.expected * (daysElapsed / plannedDays)));
  const paceRatio = Number((redemptions / proratedForecast).toFixed(3));

  // Pace and profit can disagree, and when they do the disagreement IS the
  // finding: a cents-off-per-gallon campaign at 140% of plan is handing
  // margin to people who were filling up anyway. Calling that "outperforming"
  // because the redemption counter is high is the single most expensive
  // mistake this book could make, so profit overrides pace.
  const losingMoney = economics.netGrossProfit < 0;
  const verdict = losingMoney
    ? {
      id: 'unprofitable',
      label: paceRatio >= 1.05 ? 'Redeeming well, losing money' : 'Unprofitable',
      tone: 'alert',
      advice: paceRatio >= 1.05
        ? 'Volume is not the problem -- the give is. Cut the discount or tighten the audience to the members who were not coming anyway.'
        : 'Kill it. It is neither hitting its plan nor covering its own give.',
    }
    : verdictFor(paceRatio);

  const redeemedShare = audienceSize > 0 ? redemptions / audienceSize : null;

  return {
    campaignId: `CMP-${String(1000 + index)}-${offer.id.slice(0, 4).toUpperCase()}`,
    offerId: offer.id,
    name: offer.name,
    mechanic: offer.mechanic,
    objective: offer.objective,
    category: offer.category,
    motif: offer.motif,
    valueLabel: offer.valueLabel,
    status,
    launchedAt: launchedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    plannedDays,
    daysElapsed,
    daysRemaining: Math.max(0, plannedDays - daysElapsed),
    audience: {
      segmentId: segment?.id || null,
      label: segment?.label || 'All members',
      size: audienceSize,
    },
    surfaces,
    // MODELLED -- the plan this launched on.
    forecast: {
      kind: 'modelled',
      totalRedemptions: forecast.redemptions.expected,
      band: [forecast.redemptions.lo, forecast.redemptions.hi],
      perDay: Math.round(plannedPerDay),
      proratedToDate: proratedForecast,
      basis: forecast.basis,
    },
    // MEASURED -- transactions that happened.
    actual: {
      kind: 'measured',
      redemptions,
      perDay: Math.round(redemptions / Math.max(1, daysElapsed)),
      redemptionRate: redeemedShare === null ? null : Number(redeemedShare.toFixed(4)),
      incrementalVisits: economics.incrementalRedemptions,
      cannibalised: economics.cannibalisedRedemptions,
      gallons: economics.gallons,
      incrementalSales: economics.incrementalSales,
      marginGive: economics.marginGive,
      netGrossProfit: economics.netGrossProfit,
      returnOnGive: economics.marginGive > 0
        ? Number((economics.netGrossProfit / economics.marginGive).toFixed(2))
        : null,
      economicsNote: economics.note,
    },
    series,
    paceRatio,
    pacePct: Math.round(paceRatio * 100),
    verdict: verdict.id,
    verdictLabel: verdict.label,
    verdictTone: verdict.tone,
    advice: verdict.advice,
    // A trend within the campaign, so "it started well and died" is visible
    // rather than averaged away.
    trend: campaignTrend(series),
  };
}

/**
 * Whether the last third of the run is beating the first third. Novelty decay
 * is normal; a collapse is not, and the difference is the whole reason to
 * look at a series instead of a total.
 *
 * @param {Array<{redemptions: number}>} series
 * @returns {{direction: string, changePct: number|null}}
 */
export function campaignTrend(series) {
  if (!Array.isArray(series) || series.length < 4) return { direction: 'too-early', changePct: null };
  const window = Math.max(1, Math.floor(series.length / 3));
  const opening = series.slice(0, window).reduce((total, row) => total + row.redemptions, 0) / window;
  const closing = series.slice(-window).reduce((total, row) => total + row.redemptions, 0) / window;
  if (opening === 0) return { direction: 'too-early', changePct: null };
  const changePct = Number((((closing - opening) / opening) * 100).toFixed(1));
  return {
    direction: changePct > 12 ? 'building' : changePct < -28 ? 'collapsing' : changePct < -8 ? 'decaying' : 'steady',
    changePct,
  };
}

/**
 * Campaigns competing for the same people with the same objective. Two offers
 * chasing one segment are paying twice for one behaviour change, and neither
 * can be measured cleanly while the other runs.
 *
 * @param {object[]} campaigns
 * @returns {object[]}
 */
export function findOverlaps(campaigns) {
  const overlaps = [];
  const live = campaigns.filter((campaign) => campaign.status === 'live');
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      if (!a.audience.segmentId || a.audience.segmentId !== b.audience.segmentId) continue;
      overlaps.push({
        segmentId: a.audience.segmentId,
        segmentLabel: a.audience.label,
        campaigns: [a.campaignId, b.campaignId],
        names: [a.name, b.name],
        sameObjective: a.objective === b.objective,
        note: a.objective === b.objective
          ? `Both chase ${a.objective.replace(/-/g, ' ')} at ${a.audience.label.toLowerCase()}. Neither can be read cleanly while the other runs.`
          : `Both target ${a.audience.label.toLowerCase()}. Different objectives, but the same member is being asked twice.`,
      });
    }
  }
  return overlaps;
}
