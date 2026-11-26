/**
 * @file Live transaction pulse: what the store is doing right now against
 * what this hour normally does, and -- when the two disagree -- what is most
 * likely responsible.
 *
 * Same standing as `storeLedger.js`: deterministic simulation of the
 * real-time side of a PAR-class stack, not a live feed. Read that file's
 * header before extending this one.
 *
 * The design point worth keeping: a dip is only useful if it comes with a
 * cause you can act on. "Transactions are down 14%" sends an operator hunting;
 * "transactions are down 14%, and the rain took the wash out and pulled inside
 * traffic with it" is a decision. So the pulse never reports a variance
 * without attributing it, and the attribution is built from the console's OWN
 * live context -- the regional brief's weather, the traffic engine's
 * bottlenecks, the competitive engine's nearby brands -- rather than invented
 * alongside it. Where a context input is absent, that cause simply is not
 * offered; the residual is named as unexplained rather than padded out.
 *
 * @module storeAgent/storePulse
 */

import { DAYPARTS, dayKey, dayPerformance, seeded, storeProfile, weatherResponse } from './storeLedger.js';

/** Variance beyond this (either way) is worth telling an operator about. */
const MATERIAL_VARIANCE = 0.07;

/**
 * The most of a gap the console will ever claim to explain. The remaining
 * share is reported as unexplained, because there is always something the
 * console cannot see from here.
 */
export const MAX_EXPLAINED = 0.85;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function pct(value) {
  return Number((Number(value) * 100).toFixed(1));
}

/**
 * The store's own equipment state right now. Deterministic per store per
 * hour, and deliberately mostly-healthy: an operator console that reports a
 * dispenser down every time it is opened teaches people to ignore it.
 *
 * @param {object} profile
 * @param {Date} now
 * @returns {{healthy: boolean, faults: Array<{id: string, label: string, detail: string, since: string}>}}
 */
export function equipmentState(profile, now) {
  const rng = seeded('equip', profile.siteId, dayKey(now), now.getHours());
  const faults = [];

  if (rng.chance(0.14)) {
    const lane = 1 + Math.floor(rng.next() * profile.dispensers);
    faults.push({
      id: 'dispenser',
      label: `Dispenser ${lane} offline`,
      detail: `Lane ${lane} has been out of service since ${String(Math.max(0, now.getHours() - 2)).padStart(2, '0')}:${String(Math.floor(rng.next() * 6) * 10).padStart(2, '0')} -- card reader fault reported by the site controller.`,
      since: `${Math.max(1, now.getHours() - Math.max(0, now.getHours() - 2))}h`,
    });
  }
  if (profile.kitchen && rng.chance(0.09)) {
    faults.push({
      id: 'kitchen',
      label: 'Hot food case below temperature hold',
      detail: 'Roller grill and hot case are holding under target; foodservice availability is reduced until the case recovers.',
      since: '40m',
    });
  }
  if (profile.carWash && rng.chance(0.07)) {
    faults.push({
      id: 'carwash',
      label: 'Car wash in fault',
      detail: 'Wash bay reporting a blower fault. Wash codes are still selling at the register and will not redeem.',
      since: '2h',
    });
  }

  return { healthy: faults.length === 0, faults };
}

/**
 * Build the ranked cause list for a variance.
 *
 * Each candidate declares how much of the observed gap it accounts for. The
 * shares are apportioned over the causes that actually apply, and whatever is
 * left over is returned as `unexplained` rather than distributed -- a cause
 * list that always sums to 100% is a cause list that is guessing.
 *
 * @param {object} args
 * @returns {{causes: object[], unexplainedShare: number}}
 */
export function attributeVariance({
  varianceRatio,
  weather = {},
  traffic = null,
  competitors = null,
  equipment = { faults: [] },
  profile,
  now,
}) {
  const down = varianceRatio < 0;
  const magnitude = Math.abs(varianceRatio);
  const candidates = [];

  const response = weatherResponse(weather);
  const weatherPush = (response.inside - 1) + (response.carWash - 1) * 0.12;
  if (Math.abs(weatherPush) > 0.015 && (weatherPush < 0) === down) {
    candidates.push({
      id: 'weather',
      label: response.notes[0] || (down ? 'Weather suppressing inside traffic' : 'Weather lifting the mix'),
      detail: Number.isFinite(weather.tempC)
        ? `${Math.round(weather.tempC)}C, ${String(weather.condition || 'clear').toLowerCase()}${Number.isFinite(weather.precipMm) && weather.precipMm > 0 ? `, ${weather.precipMm.toFixed(1)}mm precipitation` : ''}.`
        : 'Current conditions at the site.',
      weight: Math.min(0.55, Math.abs(weatherPush) * 3.2),
      source: 'Open-Meteo via /api/regional-brief',
      actionable: true,
    });
  }

  // Traffic only explains a DOWN move: a closure on the approach removes
  // visits, it does not create them.
  const bottlenecks = Number(traffic?.bottleneckCount ?? traffic?.bottlenecks?.length ?? 0);
  const closures = Number(traffic?.closureCount ?? traffic?.closures?.length ?? 0);
  if (down && (bottlenecks > 0 || closures > 0)) {
    candidates.push({
      id: 'traffic',
      label: closures > 0 ? 'Road closure on the approach' : 'Congestion on the approach corridor',
      detail: `${closures > 0 ? `${closures} closure${closures === 1 ? '' : 's'} and ` : ''}${bottlenecks} bottleneck${bottlenecks === 1 ? '' : 's'} within the trade area${Number.isFinite(traffic?.maxDelayMinutes) ? `, worst delay ${Math.round(traffic.maxDelayMinutes)} min` : ''}.`,
      weight: Math.min(0.45, 0.08 + closures * 0.18 + bottlenecks * 0.05),
      source: 'TomTom Traffic Flow via /api/tomtom',
      actionable: true,
    });
  }

  for (const fault of equipment.faults || []) {
    candidates.push({
      id: `equipment:${fault.id}`,
      label: fault.label,
      detail: fault.detail,
      weight: fault.id === 'dispenser' ? Math.min(0.4, 1 / Math.max(4, profile.dispensers)) : 0.14,
      source: 'Site controller',
      actionable: true,
    });
  }

  // A competitor undercutting on street price is the classic fuel-volume
  // explanation, and the one an operator can answer within the hour.
  const rival = Array.isArray(competitors) && competitors.length > 0 ? competitors[0] : null;
  if (down && rival) {
    const rng = seeded('rivalprice', profile.siteId, dayKey(now), now.getHours());
    const cpg = Math.round(rng.between(4, 14));
    if (rng.chance(0.55)) {
      candidates.push({
        id: 'competitor-price',
        label: `${rival.name || rival.brand || 'A nearby competitor'} is posting ${cpg}c under`,
        detail: `${rival.name || rival.brand || 'The nearest competitor'}${Number.isFinite(rival.distanceKm) ? ` (${rival.distanceKm.toFixed(1)} km)` : ''} is holding a lower street price this hour; fuel-led visits are the first to move.`,
        weight: Math.min(0.42, 0.06 + cpg * 0.022),
        source: 'Competitive engine + street price board',
        actionable: true,
      });
    }
  }

  if (candidates.length === 0) {
    return { causes: [], unexplainedShare: 1 };
  }

  // Normalise against the size of the move, never above it. A 4% dip cannot
  // be 55% explained by weather AND 45% by traffic if those weights were
  // calibrated for a 20% dip.
  //
  // And never above MAX_EXPLAINED either. A console that says a closure
  // accounts for 100% of a dip is claiming to have seen everything that
  // happened at that store in that hour, which it has not: it cannot see a
  // queue, a card outage, a staffing gap or a school holiday. Leaving a
  // floor of residual keeps the attribution a reading rather than a verdict,
  // and it is the difference between "most of this is the closure" and a
  // claim an operator can catch being wrong.
  const rawTotal = candidates.reduce((total, c) => total + c.weight, 0);
  const explainable = Math.min(MAX_EXPLAINED, rawTotal / Math.max(magnitude, 0.04));
  const causes = candidates
    .map((candidate) => ({
      ...candidate,
      share: Number(((candidate.weight / rawTotal) * explainable).toFixed(3)),
    }))
    .sort((a, b) => b.share - a.share);

  const covered = causes.reduce((total, c) => total + c.share, 0);
  return { causes, unexplainedShare: Number(Math.max(0, 1 - covered).toFixed(3)) };
}

/**
 * The store right now.
 *
 * @param {object} site
 * @param {{now?: Date, weather?: object, traffic?: object|null, competitors?: object[]|null}} [context]
 * @returns {object}
 */
export function realtimePulse(site, context = {}) {
  const profile = storeProfile(site);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const hour = now.getHours();
  const minutes = now.getMinutes();

  // The baseline day, generated WITHOUT live weather, is the plan. The same
  // day generated WITH it is what is actually happening. The gap between the
  // two is therefore an honest consequence of the conditions rather than a
  // number chosen to be interesting.
  const plan = dayPerformance(site, now, { profile });
  const actualDay = dayPerformance(site, now, { profile, weather: context.weather || {} });

  const planHour = plan.hours[hour];
  const actualHour = actualDay.hours[hour];
  const planned = planHour.insideTransactions + planHour.fuelTransactions;
  const shifted = actualHour.insideTransactions + actualHour.fuelTransactions;

  // Intra-hour variance the plan cannot know about: the part a live pulse is
  // for. Seeded on the hour so the reading holds steady while it is discussed.
  const rng = seeded('pulse', profile.siteId, dayKey(now), hour);
  const equipment = equipmentState(profile, now);
  const equipmentDrag = (equipment.faults || []).reduce(
    (drag, fault) => drag + (fault.id === 'dispenser' ? 1 / Math.max(4, profile.dispensers) : 0.06), 0,
  );
  const live = Math.max(0, Math.round(shifted * rng.between(0.9, 1.08) * (1 - equipmentDrag)));

  const varianceRatio = planned > 0 ? (live - planned) / planned : 0;
  const elapsed = Math.max(1, minutes) / 60;
  const state = varianceRatio <= -MATERIAL_VARIANCE ? 'dip'
    : varianceRatio >= MATERIAL_VARIANCE ? 'lift'
      : 'on-plan';

  const attribution = state === 'on-plan'
    ? { causes: [], unexplainedShare: 0 }
    : attributeVariance({
      varianceRatio,
      weather: context.weather || {},
      traffic: context.traffic || null,
      competitors: context.competitors || null,
      equipment,
      profile,
      now,
    });

  // Trailing six hours, so the board can show whether this is a spike or a
  // slide. Each prior hour carries its own seeded live variance.
  const trailing = [];
  for (let back = 5; back >= 0; back -= 1) {
    const h = hour - back;
    if (h < 0) continue;
    const hourRng = seeded('pulse', profile.siteId, dayKey(now), h);
    const hourPlan = plan.hours[h].insideTransactions + plan.hours[h].fuelTransactions;
    const hourShifted = actualDay.hours[h].insideTransactions + actualDay.hours[h].fuelTransactions;
    const hourLive = back === 0 ? live : Math.max(0, Math.round(hourShifted * hourRng.between(0.9, 1.08) * (1 - equipmentDrag)));
    trailing.push({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      planned: hourPlan,
      actual: hourLive,
      variancePct: hourPlan > 0 ? pct((hourLive - hourPlan) / hourPlan) : null,
      partial: back === 0,
    });
  }

  const dayToDatePlanned = plan.hours.slice(0, hour).reduce((total, h) => total + h.insideTransactions + h.fuelTransactions, 0);
  const dayToDateActual = trailing.reduce((total, h) => total + h.actual, 0)
    + plan.hours.slice(0, Math.max(0, hour - 5)).reduce((total, h) => total + h.insideTransactions + h.fuelTransactions, 0);

  return {
    profile,
    at: now.toISOString(),
    localTime: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    daypart: (() => {
      const definition = DAYPARTS.find((part) => hour >= part.from && hour < part.to) || null;
      return definition ? plan.dayparts.find((part) => part.id === definition.id) || null : null;
    })(),
    state,
    hour: {
      planned,
      actual: live,
      // Only `minutes` of this hour have happened, so the run rate is the
      // honest projection and `actual` is the honest count so far.
      soFar: Math.round(live * elapsed),
      runRatePerHour: Math.round(live),
      variancePct: pct(varianceRatio),
      transactionsGap: live - planned,
    },
    dayToDate: {
      planned: Math.round(dayToDatePlanned),
      actual: Math.round(dayToDateActual),
      variancePct: dayToDatePlanned > 0 ? pct((dayToDateActual - dayToDatePlanned) / dayToDatePlanned) : null,
    },
    trailing,
    causes: attribution.causes,
    unexplainedShare: attribution.unexplainedShare,
    equipment,
    basketAvg: actualDay.basketAvg,
    loyaltyAttachRate: actualDay.loyaltyAttachRate,
    streetPrice: actualDay.streetPrice,
    // Dollars the variance is worth if the rest of the hour holds -- the
    // number that decides whether an offer is worth firing.
    hourlySalesAtRisk: round2(Math.abs(live - planned) * actualDay.basketAvg),
  };
}
