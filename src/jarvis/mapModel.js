/**
 * @file Jarvis map model — the pure decisions behind the globe mode: views,
 * colours, airport state, ring geometry, and where a brief item lives.
 * No Cesium, no DOM, so it is unit-testable.
 *
 * @module jarvis/mapModel
 */

/** Camera views around home: range in metres, pitch/heading in degrees. */
export const JARVIS_VIEWS = Object.freeze({
  home: { label: 'Home', range: 900, pitch: -38, heading: 0 },
  area: { label: 'Area', range: 8_000, pitch: -52, heading: 0 },
  metro: { label: 'Metro', range: 75_000, pitch: -72, heading: 0 },
});

/** DESIGN-V5 values used on the map. */
export const HEX = Object.freeze({
  ink: '#E4EAEE', ink2: '#8B98A3', dim: '#5A6670', plate: '#0D1216',
  caution: '#F2B33D', alert: '#FF6A45', signal: '#62E0A8',
  // §09 traffic ramp, free → heavy.
  ramp: Object.freeze(['#4FD6C0', '#A8CF7E', '#F2B33D', '#FF8A4A', '#FF5A3C']),
});

/** `[lon, lat]` points on a circle of `km` around (lat, lon); closed ring. */
export function circleDegrees(lat, lon, km, steps = 96) {
  const R = 6371;
  const d = km / R;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const b = (2 * Math.PI * i) / steps;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    out.push([(l2 * 180) / Math.PI, (p2 * 180) / Math.PI]);
  }
  return out;
}

/** Incident colour: closures read as alert, crashes as the top of the ramp, else by magnitude. */
export function incidentHex(incident) {
  if (incident.category === 'Road closed') return HEX.alert;
  if (incident.category === 'Accident') return HEX.ramp[4];
  return HEX.ramp[Math.max(0, Math.min(4, (incident.magnitude ?? 0) + 1))];
}

/** FAA status for one airport → {label, hex}. */
export function airportStatus(airports, code) {
  if (airports.groundStops.some((x) => x.airport === code)) return { label: 'Ground stop', hex: HEX.alert };
  const gdp = airports.groundDelays.find((x) => x.airport === code);
  if (gdp) return { label: `Delay ${gdp.avg || ''}`.trim(), hex: HEX.caution };
  if (airports.delays.some((x) => x.airport === code)) return { label: 'Delays', hex: HEX.caution };
  return { label: 'Normal', hex: HEX.ink2 };
}

/**
 * Where a brief item lives on the map, if anywhere.
 * @returns {{lat: number, lon: number, range: number}|{view: string}|null}
 */
export function focusFor(item, feeds) {
  const id = String(item?.id || '');
  if (item?.geo && Number.isFinite(item.geo.lat) && Number.isFinite(item.geo.lon)) return { lat: item.geo.lat, lon: item.geo.lon, range: 9_000 };
  if (id.startsWith('nws:') || id === 'wx:wet' || id.startsWith('nhc:') || id.startsWith('space:') || id.startsWith('quake:') || id.startsWith('tfr:') || id.startsWith('buoy:')) return { view: 'metro' };
  if (id.startsWith('power:') || id.startsWith('local-reports:')) return { view: 'area' };
  if (id.startsWith('faa:')) {
    const code = id.split(':').pop();
    const pt = feeds?.['local.airports']?.data?.points?.[code];
    return pt ? { lat: pt[0], lon: pt[1], range: 6_000 } : { view: 'metro' };
  }
  if (id.startsWith('traffic:')) {
    const hit = (feeds?.['local.traffic']?.data || []).find((i) => i.id && id.includes(String(i.id)));
    return hit ? { lat: hit.lat, lon: hit.lon, range: 1_400 } : { view: 'area' };
  }
  return null;
}

/** Short place name for the card: "City of Riverton township" → "Riverton". */
export function shortPlace(home) {
  if (!home) return '';
  const muni = String(home.municipality || '')
    .replace(/^(City|Town|Township|Village|Borough) of /i, '')
    .replace(/ (township|town|city|borough|village)$/i, '')
    .trim();
  return muni || home.label || '';
}

/**
 * The protection-mode briefing: counts, the top items, and one spoken line
 * built ONLY from the snapshot (titles and actions are the brief's own text).
 * @param {object|null} snap `/api/jarvis/snapshot` payload.
 */
export function buildBriefing(snap) {
  if (!snap) return null;
  const items = (snap.brief || []).filter((i) => i.level === 'act' || i.level === 'watch');
  const act = items.filter((i) => i.level === 'act');
  const watch = items.filter((i) => i.level === 'watch');
  const f = snap.feeds || {};
  const live = (id) => (f[id] && f[id].kind !== 'unavailable' ? f[id].data : null);
  const now = live('weather.now');
  const place = shortPlace(snap.home);
  const top = [...act, ...watch].slice(0, 4).map((i) => ({ level: i.level, domain: i.domain, title: i.title, action: i.action }));
  const sentence = (text) => (/[.!?]$/.test(String(text).trim()) ? String(text).trim() : `${String(text).trim()}.`);
  const spoken = [
    snap.home ? `Protection mode on at ${place}${snap.home.state ? `, ${snap.home.state}` : ''}.` : 'Protection mode on, but no home point is configured.',
    `${act.length} to act on, ${watch.length} to watch.`,
    ...top.map((i) => `${i.level === 'act' ? 'Act' : 'Watch'}: ${sentence(i.title)}${i.level === 'act' && i.action ? ` ${sentence(i.action)}` : ''}`),
    now && Number.isFinite(now.tempF) ? `It is ${now.tempF} degrees${now.text ? `, ${String(now.text).toLowerCase()}` : ''}.` : null,
  ].filter(Boolean).join(' ');
  return {
    place,
    state: snap.home?.state || null,
    generatedAt: snap.generatedAt || null,
    actCount: act.length,
    watchCount: watch.length,
    top,
    conditions: now ? { tempF: now.tempF, feelsLikeF: now.feelsLikeF, text: now.text, observedAt: now.observedAt } : null,
    unavailable: Object.values(f).filter((x) => x?.kind === 'unavailable' && x.reason !== 'loading').map((x) => `${x.label}: ${x.reason}`),
    spoken,
  };
}

/** Act-level items whose id has not been seen before (what monitoring announces). */
export function newActItems(seen, brief) {
  return (brief || []).filter((i) => i.level === 'act' && !seen.has(i.id));
}

const FLOOD_RANK = { no_flooding: 0, action: 1, minor: 2, moderate: 3, major: 4 };
const FLOOD_WORD = ['Normal', 'Action', 'Minor flood', 'Moderate flood', 'Major flood'];

/** Gauge state for the map: worst of observed and forecast → {rank, hex, label}. */
export function gaugeState(g) {
  const obs = FLOOD_RANK[g?.observed?.category] ?? 0;
  const fc = FLOOD_RANK[g?.forecast?.category] ?? 0;
  const rank = Math.max(obs, fc);
  const hex = rank >= 3 ? HEX.alert : rank === 2 ? HEX.ramp[3] : rank === 1 ? HEX.caution : HEX.ink2;
  const word = FLOOD_WORD[rank];
  const label = fc > obs ? `${FLOOD_WORD[obs]} → ${word}` : word;
  return { rank, hex, label };
}

/** Short gauge name for a map label: "Passaic River at Newark" → "Passaic @ Newark". */
export function gaugeShortName(name) {
  return String(name || '')
    .replace(/\s+(River|Brook|Creek)\b/i, '')
    .replace(/\s+at\s+/i, ' @ ')
    .replace(/\s+(above|below|near)\s+/i, ' ')
    .slice(0, 28);
}

/** The escape route to draw: the first pre-computed route, emphasised when a flood or act-level hazard is live. */
export function escapeRoute(feeds, brief) {
  const s = feeds?.['safety.places'];
  const route = s && s.kind !== 'unavailable' ? s.data?.routes?.[0] : null;
  if (!route) return null;
  const urgent = (brief || []).some((i) => i.level === 'act' || String(i.id).startsWith('flood:'));
  return { ...route, urgent };
}
