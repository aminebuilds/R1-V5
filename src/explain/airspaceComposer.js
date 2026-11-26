/**
 * @file "What is happening in US airspace?" — the board for `get_airspace_brief`.
 *
 * Built from four feeds that fail independently (FAA NAS status, OpenSky
 * samples, the OpenSky flight-table departure study, event headlines) plus the
 * curated event record in `src/airspace/events.js`. The wording is fixed
 * templates over measured values: the board states what the FAA has in effect
 * and what the transponders show, then shows its working. Nothing is
 * summarised by a model.
 *
 * @module explain/airspaceComposer
 */

import {
  dossier,
  evidence,
  fmtInt,
  gap,
  head,
  headlines,
  note,
  readouts,
  sources,
  timeline,
  verdict,
  withIds,
} from './blocks.js';
import { fmtEt, fmtEtDate } from '../airspace/etTime.js';

export { fmtEt };
export const AIRSPACE_ACTION = 'get_airspace_brief';
export const AIRSPACE_QUESTION = 'What is happening in US airspace?';
export const AIRSPACE_TIMELINE_KEY = 'airspace-timeline';

/**
 * Google News appends " - Outlet" to every title; the outlet already has its
 * own line, so the suffix is dropped when it names the same outlet.
 * @param {string} title
 * @param {string|null} outlet
 * @returns {string}
 */
export function stripOutletSuffix(title, outlet) {
  const text = String(title || '');
  if (!outlet) return text;
  const suffix = ` - ${outlet}`;
  return text.toLowerCase().endsWith(suffix.toLowerCase()) ? text.slice(0, -suffix.length).trim() : text;
}

function plural(n, one, many = `${one}s`) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** The FAA's programs, one row each, in the order an operator cares about. */
export function programRows(nas) {
  const rows = [];
  for (const item of nas.groundStops || []) {
    rows.push({ label: `${item.airport} — ground stop`, sub: [item.reason, item.endTime ? `until ${item.endTime}` : null].filter(Boolean).join(' · ') || null });
  }
  for (const item of nas.groundDelays || []) {
    rows.push({ label: `${item.airport} — ground delay program`, sub: [item.reason, item.avg ? `avg ${item.avg}` : null, item.max ? `max ${item.max}` : null].filter(Boolean).join(' · ') || null });
  }
  for (const item of nas.delays || []) {
    rows.push({ label: `${item.airport} — ${String(item.type || 'traffic').toLowerCase()} delays`, sub: [item.reason, item.min && item.max ? `${item.min}–${item.max}` : null, item.trend].filter(Boolean).join(' · ') || null });
  }
  for (const item of nas.closures || []) {
    const what = item.kind === 'diversion' ? 'closed to diversions'
      : item.kind === 'intl-carriers' ? 'closed to unscheduled international carriers'
        : item.kind === 'event' ? 'closed for an event'
          : 'closure';
    rows.push({ label: `${item.airport} — ${what}`, sub: item.end ? `until ${fmtEt(item.end, { day: true })}` : null });
  }
  return rows;
}

/** The one-line state of the system. Fixed wording; every number is a count. */
export function airspaceVerdict(result) {
  const nas = result?.nas || {};
  const traffic = result?.traffic || {};
  const parts = [];
  if (nas.status !== 'ready' && nas.status !== 'stale') {
    parts.push('FAA status feed unavailable — which programs are in effect is unknown.');
  } else {
    const stops = (nas.groundStops || []).length;
    const gdps = (nas.groundDelays || []).length;
    const delays = (nas.delays || []).length;
    if (stops > 0) {
      const airports = (nas.groundStops || []).slice(0, 6).map((item) => item.airport).join(', ');
      parts.push(`FAA ground stops in effect at ${plural(stops, 'airport')}: ${airports}${stops > 6 ? ' …' : ''}.`);
    } else if (gdps + delays > 0) {
      const airports = [...new Set([...(nas.groundDelays || []), ...(nas.delays || [])].map((item) => item.airport))].slice(0, 6).join(', ');
      parts.push(`No FAA ground stops. ${plural(gdps, 'ground delay program')} and ${plural(delays, 'airport delay')} (${airports}).`);
    } else {
      parts.push('No FAA ground stops, ground delay programs or airport delays in effect.');
    }
    if (nas.status === 'stale') parts.push(`FAA feed last read ${fmtEt(nas.fetchedAt)}.`);
  }
  if (traffic.status === 'ready') {
    parts.push(`${fmtInt(traffic.airborne)} aircraft airborne over the US at ${fmtEt(traffic.t)}.`);
  } else if (traffic.status === 'stale') {
    // An old count is history, not the present: say when it was taken.
    parts.push(`No current US traffic sample — the last one, ${fmtEt(traffic.t, { day: true })}, counted ${fmtInt(traffic.airborne)} airborne.`);
  }
  return parts.join(' ');
}

/** Lanes, bands, markers and per-sample program state for the timeline block. */
function timelineBlock(result) {
  const now = Date.parse(result.generatedAt) || Date.now();
  const event = result.event || null;
  const samples = result.timeline?.samples || [];
  const from = event ? Date.parse(event.window.from) : now - 24 * 3600_000;
  const lastSampleAt = samples.length ? samples[samples.length - 1].at : null;
  const to = Math.max(now, lastSampleAt || 0);

  const dep = result.departures || {};
  const depReady = dep.status === 'ready' || dep.status === 'partial';
  const depLane = {
    id: 'departures',
    label: 'US departures / 30 min',
    sub: 'OpenSky flight-table sample · line = event day · ghost = day before',
    kind: 'measured',
    status: depReady ? dep.status : dep.status === 'computing' ? 'computing' : 'unavailable',
    reason: depReady ? null
      : dep.status === 'computing' ? 'Building from the OpenSky flight table — first load takes a minute.'
        : dep.status === 'no-event' ? 'No active event to compare against.'
          : `Flight table unavailable${dep.reason ? ` (${dep.reason})` : ''}.`,
    stepMs: 30 * 60_000,
    current: null,
    points: depReady ? (dep.bins || []).map((bin) => ({ t: bin.t, value: bin.event, compare: bin.baseline })) : [],
  };

  const trafficPoints = samples.filter((sample) => sample.traffic).map((sample) => ({ t: sample.traffic.t, value: sample.traffic.airborne }));
  const airLane = {
    id: 'airborne',
    label: 'Airborne over US',
    sub: `OpenSky transponder snapshots · sampled every ${Math.round((result.timeline?.sampleEveryMs || 600_000) / 60_000) || 10} min while the server runs`,
    kind: 'measured',
    status: trafficPoints.length ? (result.traffic?.status === 'stale' ? 'stale' : 'ready') : 'unavailable',
    reason: trafficPoints.length ? null : 'No samples yet — the first lands within ten minutes of the server starting.',
    current: result.traffic?.status === 'ready' ? fmtInt(result.traffic.airborne) : null,
    points: trafficPoints,
  };

  return timeline({
    key: AIRSPACE_TIMELINE_KEY,
    title: 'US airspace over time',
    domain: { from, to },
    lanes: [depLane, airLane],
    bands: event?.stop ? [{ from: Date.parse(event.stop.start), to: Date.parse(event.stop.end), label: 'Nationwide ground stop', tone: 'alert' }] : [],
    markers: (event?.markers || []).map((marker) => ({ key: marker.key, t: Date.parse(marker.at), label: marker.label, detail: marker.detail, sources: marker.sources })),
    programs: samples.filter((sample) => sample.nas).map((sample) => ({ t: sample.at, ...sample.nas })),
    live: { updatedAt: now, everyMs: 60_000 },
    note: depReady && dep.complete === false
      ? `Flight-table study last built ${fmtEt(dep.computedAt, { day: true })}; OpenSky adds flights after they land, so recent bins fill in on the next rebuild.`
      : null,
  });
}

/**
 * Compose the airspace board.
 * @param {object} result From the `get_airspace_brief` action.
 * @param {{question?: string|null, scope?: string|null}} [context]
 * @returns {object[]}
 */
export function composeAirspaceBrief(result, context = {}) {
  const question = context.question || AIRSPACE_QUESTION;
  const scope = 'US national airspace';

  if (!result || result.ok === false || !result.generatedAt) {
    return withIds([
      head({ question, scope, action: AIRSPACE_ACTION, status: 'error' }),
      gap({
        title: 'Airspace brief unavailable',
        reason: result?.error || 'The server did not return an airspace brief.',
        missing: ['FAA NAS status', 'OpenSky US traffic samples', 'Event headlines'],
        remedy: 'Check that the dev or preview server is running; every feed behind this board is server-side.',
      }),
      sources({ items: [{ label: 'R.1 server', detail: '/api/airspace/brief' }] }),
    ]);
  }

  const nas = result.nas || {};
  const traffic = result.traffic || {};
  const nasLive = nas.status === 'ready' || nas.status === 'stale';
  // Readouts are "now". A stale sample stays on the timeline, not up here.
  const trafficLive = traffic.status === 'ready';
  const nasKind = nas.status === 'ready' ? 'measured' : nasLive ? 'measured' : 'unavailable';
  const trafficKind = trafficLive ? 'measured' : 'unavailable';

  const blocks = [
    head({ question, scope, action: AIRSPACE_ACTION, status: 'ready', at: result.generatedAt }),
    verdict({ text: airspaceVerdict(result), kind: nasLive ? 'measured' : 'unavailable' }),
    readouts({
      items: [
        { label: 'Ground stops', value: nasLive ? fmtInt((nas.groundStops || []).length) : null, kind: nasKind },
        { label: 'Delay programs', value: nasLive ? fmtInt((nas.groundDelays || []).length) : null, kind: nasKind },
        { label: 'Airport delays', value: nasLive ? fmtInt((nas.delays || []).length) : null, kind: nasKind },
        { label: 'Airborne over US', value: trafficLive ? fmtInt(traffic.airborne) : null, kind: trafficKind },
        { label: 'Climbing out', value: trafficLive ? fmtInt(traffic.climbing) : null, unit: '<3 km', kind: trafficKind },
      ],
    }),
    timelineBlock(result),
  ];

  if (nasLive) {
    const rows = programRows(nas);
    if (rows.length) {
      blocks.push(evidence({
        title: `In effect · FAA ${fmtEt(nas.updatedAt || nas.fetchedAt)}`,
        rows: rows.map((row) => ({ claim: row.label, source: row.sub || 'FAA NAS status', kind: 'measured' })),
      }));
    }
  } else {
    blocks.push(gap({
      title: 'FAA program state unknown',
      reason: `The FAA NAS status feed did not answer (${nas.reason || 'unavailable'}).`,
      missing: ['Ground stops', 'Ground delay programs', 'Airport closures'],
      remedy: 'Check nasstatus.faa.gov directly; the board will not report "no programs" from a feed it could not read.',
    }));
  }

  if (trafficLive && (traffic.emergencies || []).length) {
    blocks.push(note({
      text: `Emergency squawks over the US in the latest sample: ${traffic.emergencies.map((item) => `${item.callsign} ${item.squawk}`).join(', ')}. A single reading — codes are sometimes set in error.`,
      tone: 'caution',
    }));
  }

  const event = result.event;
  if (event) {
    blocks.push(dossier({
      title: `${event.title} · ${fmtEtDate(event.stop?.start || event.window.from)}`,
      sub: event.summary,
      asOf: fmtEt(event.checkedAt, { day: true }),
      items: event.facts.map((fact) => ({ label: fact.label, text: fact.text, note: fact.note || null, sources: fact.sources })),
    }));
  }

  const news = result.headlines || {};
  if (news.status === 'ready' || news.status === 'stale' || news.status === 'empty') {
    blocks.push(headlines({
      title: 'Latest coverage',
      status: news.status === 'empty' ? 'empty' : news.status,
      source: news.source,
      fetchedAt: fmtEt(news.fetchedAt),
      items: (news.items || []).map((item) => ({ title: stripOutletSuffix(item.title, item.domain), url: item.url, outlet: item.domain, publishedAt: item.publishedAt })),
      note: news.source === 'Google News RSS'
        ? 'From Google News RSS, licensed for non-commercial use only — GDELT did not answer.'
        : null,
    }));
  } else if (news.status === 'computing') {
    blocks.push(note({ text: 'Fetching the latest coverage — it appears on the next refresh.', tone: 'dim' }));
  } else {
    blocks.push(gap({
      title: 'No live headlines',
      reason: `Neither GDELT nor Google News answered (${news.reason || 'unavailable'}).`,
      missing: ['Coverage newer than the event record'],
      remedy: event ? `The event record above was last checked ${fmtEt(event.checkedAt, { day: true })}.` : null,
    }));
  }

  blocks.push(sources({
    items: [
      { label: 'FAA NAS Status', detail: `ATCSCC airport status feed · read ${fmtEt(nas.fetchedAt) || '—'}`, url: 'https://nasstatus.faa.gov/' },
      { label: 'OpenSky Network', detail: 'states/all snapshots and the flights/all table, via the R.1 server', url: 'https://opensky-network.org/' },
      news.source ? { label: news.source === 'GDELT' ? 'GDELT DOC 2.0' : news.source, detail: `query ${news.query || '—'}`, url: news.source === 'GDELT' ? 'https://www.gdeltproject.org/' : 'https://news.google.com/' } : null,
      event ? { label: 'Event record', detail: `src/airspace/events.js · checked ${fmtEt(event.checkedAt, { day: true })}` } : null,
    ].filter(Boolean),
  }));

  return withIds(blocks);
}
