/**
 * @file Jarvis brief — deterministic rules that turn the live feeds into a
 * short, ranked list of things to do or watch.
 *
 * Contract:
 *  - A rule fires only on a value a feed actually returned. No feed, no item.
 *  - Every item carries its evidence: the figure, the feed it came from, and
 *    whether that feed is measured or modelled. Nothing here is an estimate of
 *    its own; thresholds are stated in the item text.
 *  - Market items describe risk conditions (volatility, trend, liquidity) and
 *    what to review. They never tell the operator to buy or sell anything.
 *
 * Pure: (feeds, context) → items. No network, no DOM.
 *
 * @module jarvis/recommend
 */

const LEVEL_RANK = { act: 0, watch: 1, info: 2, setup: 3 };
const DOMAIN_RANK = { safety: 0, travel: 1, cyber: 2, money: 3, narrative: 4, setup: 5 };

/** Data from a feed that has some, else null. */
function dataOf(feeds, id) {
  const f = feeds?.[id];
  return f && f.kind !== 'unavailable' ? f.data : null;
}

function ev(feeds, id, text) {
  const f = feeds?.[id] || {};
  return { text, feed: id, kind: f.kind || 'unavailable', source: f.source?.name || null, at: f.observedAt || f.fetchedAt || null };
}

const fmtEt = (value, opts = {}) => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    ...(opts.day ? { weekday: 'short' } : {}),
  });
};

const signed = (v, digits = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}`);
const agoH = (at, now) => {
  const h = (now - Date.parse(at)) / 3600_000;
  if (!Number.isFinite(h)) return '';
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${Math.round(h)}h ago`;
};

/** First one or two sentences of an NWS instruction block. */
export function firstSentences(text, count = 2) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return parts.slice(0, count).map((p) => p.trim()).join(' ');
}

// ── safety ──────────────────────────────────────────────────────────────────

function weatherAlerts(feeds, out) {
  const alerts = dataOf(feeds, 'weather.alerts');
  if (!alerts) return;
  for (const a of alerts) {
    const severe = a.severity === 'Extreme' || a.severity === 'Severe';
    const imminent = a.urgency === 'Immediate' || a.urgency === 'Expected';
    const level = severe || (a.severity === 'Moderate' && imminent) ? 'act' : 'watch';
    const until = fmtEt(a.ends || a.expires, { day: true });
    out.push({
      id: `nws:${a.id}`,
      level,
      domain: 'safety',
      title: `${a.event}${until ? ` until ${until}` : ''}`,
      action: firstSentences(a.instruction, 2) || a.headline || 'Follow National Weather Service guidance.',
      evidence: [ev(feeds, 'weather.alerts', `${a.severity} · ${a.urgency} · ${a.sender || 'NWS'}`)],
      url: a.url,
      until: a.ends || a.expires,
    });
  }
}

function measuredConditions(feeds, out) {
  const now = dataOf(feeds, 'weather.now');
  if (!now) return;
  const alerts = dataOf(feeds, 'weather.alerts') || [];
  const hasAlert = (re) => alerts.some((a) => re.test(a.event));
  const obs = `${now.station?.id || 'station'} ${fmtEt(now.observedAt) || ''}`.trim();
  if (now.windChillF !== null && now.windChillF <= 20 && !hasAlert(/cold|chill/i)) {
    out.push({
      id: 'wx:windchill',
      level: now.windChillF <= 0 ? 'act' : 'watch',
      domain: 'safety',
      title: `Wind chill ${now.windChillF}°F`,
      action: now.windChillF <= 0
        ? 'Frostbite possible on exposed skin within 30 minutes. Cover up fully and keep trips outside short.'
        : 'Dress in layers and cover hands and ears for time outside.',
      evidence: [ev(feeds, 'weather.now', `Measured ${now.tempF}°F, wind ${now.windMph ?? '—'} mph at ${obs}`)],
    });
  }
  if (now.heatIndexF !== null && now.heatIndexF >= 95 && !hasAlert(/heat/i)) {
    out.push({
      id: 'wx:heat',
      level: now.heatIndexF >= 103 ? 'act' : 'watch',
      domain: 'safety',
      title: `Heat index ${now.heatIndexF}°F`,
      action: 'Hydrate, limit strenuous activity outdoors, and check on anyone without cooling.',
      evidence: [ev(feeds, 'weather.now', `Measured at ${obs}`)],
    });
  }
  if (now.windGustMph !== null && now.windGustMph >= 40 && !hasAlert(/wind/i)) {
    out.push({
      id: 'wx:gust',
      level: now.windGustMph >= 50 ? 'act' : 'watch',
      domain: 'safety',
      title: `Wind gusts ${now.windGustMph} mph`,
      action: 'Secure outdoor items; stay clear of trees and downed lines.',
      evidence: [ev(feeds, 'weather.now', `Measured gust at ${obs}`)],
    });
  }
  if (now.visibilityMi !== null && now.visibilityMi <= 0.5) {
    out.push({
      id: 'wx:visibility',
      level: 'watch',
      domain: 'travel',
      title: `Visibility ${now.visibilityMi} mi`,
      action: 'Low-visibility driving: lights on, longer following distance.',
      evidence: [ev(feeds, 'weather.now', `Measured at ${obs}`)],
    });
  }
}

/** Contiguous window of hours with precipitation probability ≥ threshold. */
export function wetWindow(periods, { within = 12, threshold = 50 } = {}) {
  const horizon = periods.slice(0, within + 12);
  const start = horizon.findIndex((p, i) => i < within && (p.pop ?? 0) >= threshold);
  if (start < 0) return null;
  let end = start;
  while (end + 1 < horizon.length && (horizon[end + 1].pop ?? 0) >= threshold) end += 1;
  const slice = horizon.slice(start, end + 1);
  return {
    start: slice[0].start,
    lastHour: slice[slice.length - 1].start,
    peakPop: Math.max(...slice.map((p) => p.pop ?? 0)),
    minTempF: Math.min(...slice.map((p) => p.tempF ?? 99)),
    kinds: [...new Set(slice.map((p) => p.short).filter(Boolean))].slice(0, 3),
    startsNow: start === 0,
  };
}

function forecast(feeds, out, now) {
  const fc = dataOf(feeds, 'weather.forecast');
  if (!fc?.hourly?.periods?.length) return;
  const w = wetWindow(fc.hourly.periods);
  if (w) {
    const frozen = w.minTempF <= 34 && w.kinds.some((k) => /snow|sleet|freezing|ice|wintry/i.test(k));
    const endIso = new Date(Date.parse(w.lastHour) + 3600_000).toISOString();
    const etDay = (v) => new Date(v).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const endLabel = fmtEt(endIso, { day: etDay(endIso) !== etDay(now) });
    out.push({
      id: 'wx:wet',
      level: frozen ? 'act' : 'watch',
      domain: frozen ? 'safety' : 'travel',
      title: frozen
        ? `Icy precipitation ${w.startsNow ? 'now' : `from ${fmtEt(w.start)}`} until ~${endLabel}`
        : `${w.kinds[0] || 'Precipitation'} ${w.startsNow ? 'now' : `from ${fmtEt(w.start)}`} until ~${endLabel}`,
      action: frozen
        ? 'Roads and walkways may ice. Delay non-essential driving until it clears; treat steps and the driveway.'
        : (w.startsNow ? `Wet until about ${endLabel} — time errands and drives after it clears.` : `Get outdoor errands done before ${fmtEt(w.start)}.`),
      evidence: [ev(feeds, 'weather.forecast', `NWS hourly: up to ${w.peakPop}% chance, ${w.kinds.join(' / ')}`)],
    });
  }
  const nights = (fc.daily?.periods || []).filter((p) => !p.isDaytime && p.tempF !== null).slice(0, 2);
  const coldest = nights.reduce((m, p) => (m === null || p.tempF < m.tempF ? p : m), null);
  if (coldest && coldest.tempF <= 25) {
    out.push({
      id: 'wx:hardfreeze',
      level: coldest.tempF <= 15 ? 'watch' : 'info',
      domain: 'safety',
      title: `Hard freeze ${coldest.name}: low ${coldest.tempF}°F`,
      action: 'Disconnect outdoor hoses; keep vulnerable pipes from freezing.',
      evidence: [ev(feeds, 'weather.forecast', `NWS forecast — ${coldest.short || ''}`.trim())],
    });
  }
}

function air(feeds, out) {
  const a = dataOf(feeds, 'local.air');
  if (!a || a.aqi === null) return;
  const peak = Math.max(a.aqi, a.peak24h ?? 0);
  if (peak <= 100) return;
  out.push({
    id: 'air:aqi',
    level: peak > 150 ? 'act' : 'watch',
    domain: 'safety',
    title: `Air quality ${a.aqi > 100 ? 'now' : 'later today'}: AQI ${peak} (${a.aqi > 100 ? a.category : a.peakCategory})`,
    action: peak > 150 ? 'Keep windows closed and move exercise indoors.' : 'Sensitive groups should cut prolonged outdoor exertion.',
    evidence: [ev(feeds, 'local.air', `Current AQI ${a.aqi}${a.pollutant ? ` (${a.pollutant})` : ''}`)],
  });
}

function hazards(feeds, out, now) {
  const q = dataOf(feeds, 'hazards.quakes');
  for (const quake of (q?.near || []).filter((x) => (x.mag ?? 0) >= 3.5 && now - Date.parse(x.at) <= 48 * 3600_000).slice(0, 1)) {
    out.push({
      id: `quake:${quake.id}`,
      level: quake.mag >= 4.5 && quake.distanceKm <= 150 ? 'act' : 'watch',
      domain: 'safety',
      title: `M${quake.mag} earthquake ${quake.distanceKm} km away`,
      action: 'Check for aftershock reports; inspect gas lines and foundations if shaking was felt.',
      evidence: [ev(feeds, 'hazards.quakes', `${quake.place} · ${agoH(quake.at, now)}`)],
      url: quake.url,
    });
  }
  for (const quake of (q?.major || []).filter((x) => x.mag >= 7).slice(0, 1)) {
    out.push({
      id: `quake-major:${quake.id}`,
      level: 'info',
      domain: 'narrative',
      title: `Major M${quake.mag} earthquake: ${quake.place}`,
      action: quake.tsunami ? 'Tsunami flag set — watch supply-chain and insurer headlines.' : 'Watch for supply-chain and insurer headlines.',
      evidence: [ev(feeds, 'hazards.quakes', `${agoH(quake.at, now)}`)],
      url: quake.url,
    });
  }
  for (const s of (dataOf(feeds, 'hazards.tropical') || []).filter((x) => x.distanceKm !== null && x.distanceKm <= 1500).slice(0, 2)) {
    out.push({
      id: `nhc:${s.id}`,
      level: s.distanceKm <= 600 ? 'act' : 'watch',
      domain: 'safety',
      title: `${s.classification} ${s.name} — ${s.distanceKm} km away`,
      action: 'Review the NHC advisory and your supply/evacuation plan; charge devices.',
      evidence: [ev(feeds, 'hazards.tropical', `${s.intensityKt ?? '—'} kt, moving ${s.movement || '—'}`)],
      url: s.advisoryUrl,
    });
  }
  const sw = dataOf(feeds, 'hazards.space');
  const g = Math.max(sw?.current?.G ?? 0, sw?.forecastMaxG ?? 0);
  if (g >= 2) {
    out.push({
      id: 'space:g',
      level: g >= 4 ? 'watch' : 'info',
      domain: 'safety',
      title: `Geomagnetic storm G${g} ${sw.current.G >= g ? 'in progress' : 'forecast'}`,
      action: 'GPS and HF radio can degrade; grid operators may issue alerts. Aurora possible at this latitude only at G4+.',
      evidence: [ev(feeds, 'hazards.space', `NOAA scales: G${sw.current.G ?? 0} now, G${sw.forecastMaxG ?? 0} forecast max`)],
    });
  }
  for (const d of (dataOf(feeds, 'hazards.fema')?.recentForHome || []).slice(0, 1)) {
    out.push({
      id: `fema:${d.disasterNumber}`,
      level: 'watch',
      domain: 'safety',
      title: `FEMA declaration covers your county: ${d.title}`,
      action: 'You may be eligible for assistance — check disasterassistance.gov if you had losses.',
      evidence: [ev(feeds, 'hazards.fema', `${d.declarationType} #${d.disasterNumber}, declared ${d.declaredAt?.slice(0, 10)}`)],
      url: d.url,
    });
  }
}

function localReports(feeds, out, now) {
  const items = (dataOf(feeds, 'news.safety') || []).filter((n) => n.at && now - Date.parse(n.at) <= 24 * 3600_000).slice(0, 3);
  if (!items.length) return;
  out.push({
    id: `local-reports:${items[0].url}`,
    level: 'watch',
    domain: 'safety',
    title: `${items.length} incident report${items.length > 1 ? 's' : ''} near you in the last 24h`,
    action: 'Skim before heading out; route around anything active.',
    evidence: items.map((n) => ev(feeds, 'news.safety', `${n.title} — ${n.source || 'news'}, ${agoH(n.at, now)}`)),
    url: items[0].url,
  });
}

function traffic(feeds, out, now) {
  const incidents = dataOf(feeds, 'local.traffic');
  if (!incidents?.length) return;
  // Acute only: crashes, flooding, major jams, and closures that began in the
  // last day. A months-long construction closure is a fact of the map, not news.
  const seen = new Set();
  const serious = incidents.filter((i) => {
    const fresh = i.start && now - Date.parse(i.start) <= 24 * 3600_000;
    const acute = i.category === 'Accident' || i.category === 'Flooding' || (i.category === 'Jam' && i.magnitude >= 3) || (i.category === 'Road closed' && fresh);
    if (!acute) return false;
    const key = [i.category, ...[i.from, i.to].sort()].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!serious.length) return;
  const top = serious.slice(0, 3);
  const describe = (i) => `${i.category}${i.roads.length ? ` ${i.roads.join('/')}` : ''}${i.from ? ` ${i.from}${i.to ? ` → ${i.to}` : ''}` : ''} · ${i.distanceKm} km${i.delayMin ? ` · +${i.delayMin} min` : ''}`;
  out.push({
    id: `traffic:${top.map((i) => i.id).join(',')}`,
    level: top.some((i) => i.distanceKm <= 3 && (i.category === 'Road closed' || i.magnitude >= 3)) ? 'act' : 'watch',
    domain: 'travel',
    title: `${serious.length} serious traffic incident${serious.length > 1 ? 's' : ''} within 8 km`,
    action: 'Check your route before you leave.',
    evidence: top.map((i) => ev(feeds, 'local.traffic', describe(i))),
  });
}

// ── travel ──────────────────────────────────────────────────────────────────

function airports(feeds, out) {
  const a = dataOf(feeds, 'local.airports');
  if (!a) return;
  for (const s of a.groundStops) {
    out.push({
      id: `faa:gs:${s.airport}`,
      level: 'act',
      domain: 'travel',
      title: `${s.airport} ground stop${s.endTime ? ` until ${s.endTime}` : ''}`,
      action: 'Flying today? Check your airline before leaving — departures to this airport are held.',
      evidence: [ev(feeds, 'local.airports', `FAA: ${s.reason || 'ground stop'}`)],
      url: 'https://nasstatus.faa.gov/',
    });
  }
  for (const d of a.groundDelays) {
    out.push({
      id: `faa:gdp:${d.airport}`,
      level: 'watch',
      domain: 'travel',
      title: `${d.airport} ground delay program — avg ${d.avg || '—'}`,
      action: 'Expect late departures to this airport; build slack into connections and pickups.',
      evidence: [ev(feeds, 'local.airports', `FAA: ${d.reason || 'delay'}, max ${d.max || '—'}`)],
      url: 'https://nasstatus.faa.gov/',
    });
  }
  const byAirport = new Map();
  for (const d of a.delays) {
    if (!byAirport.has(d.airport)) byAirport.set(d.airport, []);
    byAirport.get(d.airport).push(d);
  }
  for (const [airport, legs] of byAirport) {
    out.push({
      id: `faa:delay:${airport}`,
      level: 'watch',
      domain: 'travel',
      title: `${airport} ${legs.map((l) => (l.type || 'delays').toLowerCase()).join(' & ')} delayed ${legs[0].min || ''}–${legs[0].max || ''}`.replace(/\s+/g, ' ').trim(),
      action: 'Leave earlier for the airport and track your flight.',
      evidence: legs.map((l) => ev(feeds, 'local.airports', `FAA: ${l.reason || 'delay'} · ${l.trend || 'trend n/a'}`)),
      url: 'https://nasstatus.faa.gov/',
    });
  }
}

function events(feeds, out, now) {
  const list = (dataOf(feeds, 'local.events') || []).filter((e) => e.start && Date.parse(e.start) - now < 30 * 3600_000 && Date.parse(e.start) > now - 2 * 3600_000);
  const byVenue = new Map();
  for (const e of list) {
    if (!e.venue) continue;
    if (!byVenue.has(e.venue)) byVenue.set(e.venue, []);
    byVenue.get(e.venue).push(e);
  }
  const big = /prudential center|metlife|red bull arena|sports arena|stadium|arena|nj pac|newark symphony|madison square/i;
  for (const [venue, evts] of byVenue) {
    if (!big.test(venue)) continue;
    const first = evts[0];
    out.push({
      id: `event:${venue}:${first.start}`,
      level: 'info',
      domain: 'travel',
      title: `${venue}: ${first.name} ${fmtEt(first.start, { day: true }) || ''}`.trim(),
      action: `Expect congestion near ${first.city || 'the venue'} for ~90 min before start and after it lets out.`,
      evidence: evts.slice(0, 2).map((e) => ev(feeds, 'local.events', `${e.name} · ${e.distanceMi ?? '—'} mi`)),
      url: first.url,
    });
  }
}

// ── cyber ───────────────────────────────────────────────────────────────────

function cyber(feeds, out, now) {
  const hn = (dataOf(feeds, 'attention.hn') || []).filter((s) => s.security && s.points >= 150).slice(0, 2);
  for (const s of hn) {
    out.push({
      id: `hn-sec:${s.id}`,
      level: 'watch',
      domain: 'cyber',
      title: `Security event trending: ${s.title}`,
      action: 'If you use the affected product, read the vendor advisory and rotate any credentials it names.',
      evidence: [ev(feeds, 'attention.hn', `Hacker News front page · ${s.points} pts · ${s.comments} comments`)],
      url: s.url,
    });
  }
  const kev = dataOf(feeds, 'cyber.kev');
  const consumer = (kev?.recent || []).filter((v) => v.consumer && now - Date.parse(`${v.dateAdded}T00:00:00Z`) <= 7 * 86_400_000);
  if (consumer.length) {
    const top = consumer.slice(0, 3);
    out.push({
      id: `kev:${top.map((v) => v.cve).join(',')}`,
      level: top.some((v) => v.ransomware) ? 'act' : 'watch',
      domain: 'cyber',
      title: `Patch now: ${[...new Set(top.map((v) => `${v.vendor} ${v.product}`))].join(', ')} actively exploited`,
      action: 'Install the latest updates on affected phones, laptops and routers today.',
      evidence: top.map((v) => ev(feeds, 'cyber.kev', `${v.cve} · added ${v.dateAdded}${v.ransomware ? ' · used in ransomware' : ''}`)),
      url: top[0].url,
    });
  }
}

// ── money (risk conditions, never trade calls) ──────────────────────────────

function quoteOf(feeds, symbol) {
  return (dataOf(feeds, 'markets') || []).find((q) => q.symbol === symbol && q.available) || null;
}

function session(ctx, out) {
  const s = ctx.session;
  if (!s) return;
  if (s.holiday) {
    out.push({
      id: `session:holiday:${s.date}`,
      level: 'info',
      domain: 'money',
      title: `US markets closed — ${s.holiday}`,
      action: `Next open ${s.nextOpen?.date} 9:30 am ET${s.nextOpen?.earlyClose ? ' (early close 1:00 pm)' : ''}. Crypto trades 24/7 on thinner holiday liquidity.`,
      evidence: [{ text: 'NYSE published holiday calendar', feed: 'calendar', kind: 'measured', source: 'NYSE', at: null }],
    });
  }
  for (const e of s.upcomingEarlyCloses.slice(0, 1)) {
    out.push({
      id: `session:early:${e.date}`,
      level: 'watch',
      domain: 'money',
      title: `Early close ${e.closeEt} ET on ${e.date} (${e.reason})`,
      action: 'Options on early-close days stop trading at or shortly after 1:00 pm ET — confirm cutoffs with your broker and manage expiring positions before then.',
      evidence: [{ text: 'NYSE published early-close schedule', feed: 'calendar', kind: 'measured', source: 'NYSE', at: null }],
    });
  }
}

function volatility(feeds, out) {
  const vix = quoteOf(feeds, '^VIX');
  if (!vix) return;
  const vix3m = quoteOf(feeds, '^VIX3M');
  const ratio = vix3m ? vix.last / vix3m.last : null;
  const inverted = ratio !== null && ratio > 1;
  let level = null;
  let title = null;
  if (vix.last >= 30) { level = 'act'; title = `Volatility stress: VIX ${vix.last.toFixed(1)}`; }
  else if (vix.last >= 20) { level = 'watch'; title = `Elevated volatility: VIX ${vix.last.toFixed(1)}`; }
  else if (vix.last <= 13) { level = 'info'; title = `Low volatility: VIX ${vix.last.toFixed(1)}`; }
  if (!level && !inverted) return;
  if (!level) { level = 'watch'; title = `VIX curve inverted (${vix.last.toFixed(1)} vs 3M ${vix3m.last.toFixed(1)})`; }
  out.push({
    id: 'mkt:vix',
    level,
    domain: 'money',
    title: inverted && !title.includes('inverted') ? `${title} · curve inverted` : title,
    action: vix.last <= 13
      ? 'Options are cheap relative to history; complacency regimes can end abruptly — know your downside.'
      : 'Implied moves are wide. Review position sizes, stops and defined-risk exposure before the next session.',
    evidence: [
      ev(feeds, 'markets', `VIX ${vix.last.toFixed(2)} (${signed(vix.changePct)}% d/d)`),
      ...(vix3m ? [ev(feeds, 'markets', `VIX/VIX3M ${ratio.toFixed(2)}${inverted ? ' — near-term fear above 3-month' : ''}`)] : []),
    ],
  });
}

function trend(feeds, out) {
  const r = dataOf(feeds, 'markets.regime');
  if (!r || r.last === null) return;
  const below200 = r.vsSma200Pct !== null && r.vsSma200Pct < 0;
  const correction = r.drawdownPct !== null && r.drawdownPct <= -10;
  if (!below200 && !correction && !(r.drawdownPct <= -5)) return;
  const vix = quoteOf(feeds, '^VIX');
  out.push({
    id: 'mkt:trend',
    level: below200 || correction ? 'watch' : 'info',
    domain: 'money',
    title: `${r.symbol} ${r.drawdownPct}% from 1-year high${below200 ? ' · below 200-day' : ''}`,
    action: below200
      ? 'Trend regime is down: rallies fail more often below the 200-day. Size new risk smaller until it reclaims it.'
      : 'Pullback in progress inside an uptrend — check that stops reflect current volatility.',
    evidence: [
      ev(feeds, 'markets.regime', `Last ${r.last} · 50d ${r.sma50 ?? '—'} · 200d ${r.sma200 ?? '—'} (${signed(r.vsSma200Pct)}%)`),
      ev(feeds, 'markets.regime', `20d realised vol ${r.realizedVol20 ?? '—'}%${vix ? ` vs VIX ${vix.last.toFixed(1)}` : ''}`),
    ],
  });
}

function movers(feeds, out) {
  const quotes = (dataOf(feeds, 'markets') || []).filter((q) => q.available && q.changePct !== null);
  const big = quotes.filter((q) => {
    if (q.symbol.startsWith('^VIX')) return false;
    if (q.unit === '%') return Math.abs(q.changeBp ?? 0) >= 10;
    if (q.group === 'fx' || /=X$/.test(q.symbol)) return Math.abs(q.changePct) >= 1;
    return Math.abs(q.changePct) >= 3;
  }).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 4);
  if (!big.length) return;
  out.push({
    id: `mkt:movers:${big.map((q) => q.symbol).join(',')}`,
    level: 'watch',
    domain: 'money',
    title: `Big moves: ${big.map((q) => `${q.label} ${q.unit === '%' ? `${signed(q.changeBp, 0)} bp` : `${signed(q.changePct)}%`}`).join(' · ')}`,
    action: 'Check whether any of these touch your positions, payroll stock or FX exposure.',
    evidence: big.map((q) => ev(feeds, 'markets', `${q.symbol} ${q.last} (prev ${q.prevClose ?? '—'})`)),
  });
}

function rates(feeds, out) {
  const t = dataOf(feeds, 'rates.treasury');
  if (t) {
    const ten = t.tenors.find((x) => x.tenor === '10Y');
    if (ten && ten.changeBp !== null && Math.abs(ten.changeBp) >= 10) {
      out.push({
        id: `rates:10y:${t.date}`,
        level: 'watch',
        domain: 'money',
        title: `10-year Treasury ${signed(ten.changeBp, 0)} bp to ${ten.yield}%`,
        action: 'Rate-sensitive assets (housing, long duration, growth) reprice on moves this size.',
        evidence: [ev(feeds, 'rates.treasury', `Par curve ${t.date} vs ${t.priorDate}`)],
      });
    }
  }
  const m = dataOf(feeds, 'macro.mortgage');
  if (m) {
    out.push({
      id: `mortgage:${m.date}`,
      level: m.change30Bp !== null && Math.abs(m.change30Bp) >= 10 ? 'watch' : 'info',
      domain: 'money',
      title: `30-yr mortgage ${m.rate30}% (${signed(m.change30Bp, 0)} bp w/w)`,
      action: m.change30Bp !== null && m.change30Bp <= -10
        ? 'Affordability improved this week — watch for a pickup in buyer and refinance activity.'
        : (m.change30Bp !== null && m.change30Bp >= 10
          ? 'Affordability worsened this week — expect softer buyer demand and more rate-lock urgency.'
          : 'Rates steady week over week.'),
      evidence: [ev(feeds, 'macro.mortgage', `Freddie Mac PMMS ${m.date}; 15-yr ${m.rate15 ?? '—'}%; a year ago ${m.yearAgo30 ?? '—'}%`)],
    });
  }
}

function crypto(feeds, out) {
  const fng = dataOf(feeds, 'sentiment.cryptoFng');
  const v = fng?.now?.value;
  if (v !== null && v !== undefined && (v <= 20 || v >= 80)) {
    const btc = quoteOf(feeds, 'BTC-USD');
    out.push({
      id: `fng:${fng.now.at}`,
      level: 'watch',
      domain: 'money',
      title: `Crypto sentiment: ${fng.now.label} (${v}/100)`,
      action: v <= 20
        ? 'Fear regimes bring forced liquidations and gap moves — check any leveraged or margin exposure before it checks you.'
        : 'Greed regimes are where leverage builds — tighten risk on anything you can’t hold through a drawdown.',
      evidence: [
        ev(feeds, 'sentiment.cryptoFng', `Yesterday ${fng.yesterday?.value ?? '—'}, a week ago ${fng.weekAgo?.value ?? '—'}`),
        ...(btc ? [ev(feeds, 'markets', `BTC ${Math.round(btc.last).toLocaleString('en-US')} (${signed(btc.changePct)}% 24h)`)] : []),
      ],
    });
  }
  const s = dataOf(feeds, 'crypto.stablecoins');
  if (s && s.change30dPct !== null && (s.change30dPct <= -1 || s.change30dPct >= 2)) {
    out.push({
      id: 'stables:drift',
      level: s.change30dPct <= -1 ? 'watch' : 'info',
      domain: 'narrative',
      title: `Stablecoin supply ${signed(s.change30dPct, 1)}% in 30 days ($${(s.totalUsd / 1e9).toFixed(1)}B)`,
      action: s.change30dPct <= -1
        ? 'On-chain dollar liquidity is contracting — tokenization rails are seeing net outflows.'
        : 'On-chain dollar liquidity is expanding — capital is moving onto tokenized rails.',
      evidence: [ev(feeds, 'crypto.stablecoins', `7d ${signed(s.change7dPct, 2)}%, 1d ${signed(s.change1dPct, 2)}%`)],
    });
  }
}

// ── narrative ───────────────────────────────────────────────────────────────

function narratives(feeds, out) {
  const pm = dataOf(feeds, 'narratives.polymarket') || [];
  const pct = (p) => `${Math.round(p * 100)}%`;
  const macro = pm.find((e) => /\bfed\b|rate|recession|inflation|cpi|tariff|shutdown/i.test(e.title));
  if (macro) {
    out.push({
      id: `pm:macro:${macro.id}`,
      level: 'info',
      domain: 'narrative',
      title: `Money-weighted odds — ${macro.title}`,
      action: macro.options.map((o) => `${o.label} ${pct(o.prob)}`).join(' · '),
      evidence: [ev(feeds, 'narratives.polymarket', `$${Math.round(macro.volume24h / 1000)}k traded in 24h`)],
      url: macro.url,
    });
  }
  // Recurring price-ladder markets ("Bitcoin above ___ on …") swing every day by design.
  const recurring = /___|what price will|up or down|\bhit in (january|february|march|april|may|june|july|august|september|october|november|december)\b|# tweets/i;
  const shifts = pm.filter((e) => e.mover && Math.abs(e.mover.change24h) >= 0.08 && e.volume24h >= 50_000 && e !== macro && !recurring.test(e.title)).slice(0, 2);
  for (const e of shifts) {
    out.push({
      id: `pm:shift:${e.id}`,
      level: 'info',
      domain: 'narrative',
      title: `Odds shift — ${e.title}`,
      action: `${e.mover.label}: ${pct(e.mover.prob)} (${signed(e.mover.change24h * 100, 0)} pts in 24h)`,
      evidence: [ev(feeds, 'narratives.polymarket', `$${Math.round(e.volume24h / 1000)}k traded in 24h`)],
      url: e.url,
    });
  }
  const tone = dataOf(feeds, 'tone.gdelt') || [];
  for (const t of tone.filter((x) => x.tone && x.tone.delta !== null && x.tone.delta <= -0.8).slice(0, 2)) {
    out.push({
      id: `tone:${t.id}`,
      level: 'info',
      domain: 'narrative',
      title: `News tone souring: ${t.label} (${signed(t.tone.delta, 2)} vs 7-day)`,
      action: 'Coverage is turning negative faster than usual — expect it in headlines and sentiment next.',
      evidence: [ev(feeds, 'tone.gdelt', `24h ${t.tone.avg24h} · 7d ${t.tone.avg7d}`)],
    });
  }
  const trends = (dataOf(feeds, 'attention.trends')?.us || []).slice(0, 4);
  if (trends.length) {
    out.push({
      id: `trends:${trends.map((t) => t.title).join('|')}`,
      level: 'info',
      domain: 'narrative',
      title: `What the US is searching: ${trends.map((t) => t.title).join(' · ')}`,
      action: 'Public attention right now — useful context for posts, pitches and timing.',
      evidence: trends.slice(0, 2).map((t) => ev(feeds, 'attention.trends', `${t.title} ${t.traffic || ''} searches${t.newsSource ? ` · ${t.newsSource}` : ''}`)),
    });
  }
}

function setup(feeds, out) {
  const missing = Object.entries(feeds || {}).filter(([, f]) => f?.kind === 'unavailable' && f.reason === 'no-key');
  if (!missing.length) return;
  out.push({
    id: `setup:${missing.map(([id]) => id).join(',')}`,
    level: 'setup',
    domain: 'setup',
    title: `${missing.length} feed${missing.length > 1 ? 's' : ''} need a key`,
    action: missing.map(([, f]) => `${f.label}: ${f.needs || 'key required'}`).join(' · '),
    evidence: [],
  });
}


// ── protection layers: water, airspace, reports, playbooks ──────────────────

/**
 * Survival playbooks — fixed procedures (Ready.gov / FEMA / NWS guidance),
 * attached to an item only when a LIVE trigger fires. They are guidance, not
 * data, and are labelled that way in the UI.
 */
export const PLAYBOOKS = Object.freeze({
  flood: [
    'Never walk or drive through moving water: 6 in can knock you down, 12 in can float a car.',
    'If water threatens the building: move people, pets and documents above the ground floor.',
    'Switch off power at the breaker only if you can reach it standing on dry ground.',
    'If told to leave, take the pre-planned route on the map and turn back at any flooded road.',
  ],
  wind: [
    'Bring in or tie down outdoor furniture, bins and decorations.',
    'Stay clear of trees and downed lines — treat every wire as live and call it in.',
    'Charge phones and a battery pack now in case the power goes.',
    'Driving: both hands on the wheel; high-profile vehicles avoid exposed bridges.',
  ],
  power: [
    'Unplug sensitive electronics; leave one lamp on to know when power returns.',
    'Keep the fridge closed: food stays safe ~4 h (fridge), ~48 h (full freezer).',
    'Generators and grills outdoors only, 20 ft from windows — carbon monoxide kills indoors.',
    'Charge phones and a battery pack now; check on neighbours who rely on medical devices.',
  ],
  finsec: [
    'Do not act on calls, texts or emails "from your bank" — call the number on the back of your card.',
    'Turn on transaction alerts and check recent activity in each account.',
    'Keep some cash and a second payment method that runs on a different network.',
    'Do not move money or sell in a hurry because of the headline; verify with the institution first.',
  ],
  cyber: [
    'Update the affected device or app today (Settings → Software Update).',
    'Change the password for any service named in the advisory; turn on 2-step verification.',
    'Watch for phishing that references the incident — it always follows.',
  ],
  quake: [
    'Drop, cover, hold on during shaking; expect aftershocks.',
    'Smell gas? Leave, then call the utility from outside. Do not use switches.',
    'Check walls, chimney and foundation before going back in.',
  ],
  cold: [
    'Limit time outside; cover skin — frostbite starts on fingers, ears and nose.',
    'Let faucets drip and open sink cabinets to keep pipes from freezing.',
    'Never heat the home with an oven or grill.',
  ],
  heat: [
    'Drink water before you are thirsty; avoid alcohol and heavy meals.',
    'Stay in air-conditioning in the hottest hours; check on older neighbours.',
  ],
  air: [
    'Keep windows closed; run any air purifier on high.',
    'Move exercise indoors; an N95 helps if you must be outside.',
  ],
});

const FLOOD_LABEL = { action: 'action stage', minor: 'minor flood', moderate: 'moderate flood', major: 'major flood' };
const FLOOD_RANK_LOCAL = { no_flooding: 0, action: 1, minor: 2, moderate: 3, major: 4 };
const rankOf = (cat) => FLOOD_RANK_LOCAL[cat] ?? 0;

/** The pre-planned escape route text, from the safety feed. */
function routeLine(feeds) {
  const s = dataOf(feeds, 'safety.places');
  const r = s?.routes?.[0];
  if (!r) return null;
  const higher = s.homeElevationM !== null && r.to.elevationM !== null ? ` (${r.to.elevationM} m elevation vs home ${s.homeElevationM} m)` : '';
  return `Pre-planned route: ${r.to.name}, ${r.durationMin} min / ${r.distanceKm} km by car${higher}. The route does not know which roads are flooded.`;
}

function water(feeds, out) {
  const gauges = dataOf(feeds, 'water.gauges');
  if (gauges?.length) {
    const flooding = gauges
      .filter((g) => (g.distanceKm ?? 99) <= 30 && Math.max(rankOf(g.observed.category), rankOf(g.forecast.category)) >= 2)
      .sort((a, b) => Math.max(rankOf(b.observed.category), rankOf(b.forecast.category)) - Math.max(rankOf(a.observed.category), rankOf(a.forecast.category)) || a.distanceKm - b.distanceKm);
    if (flooding.length) {
      const worst = flooding[0];
      const worstRank = Math.max(rankOf(worst.observed.category), rankOf(worst.forecast.category));
      const nearRiver = flooding.some((g) => !g.tidal && g.distanceKm <= 8 && Math.max(rankOf(g.observed.category), rankOf(g.forecast.category)) >= 3);
      const describe = (g) => {
        const now = g.observed.stage !== null ? `${FLOOD_LABEL[g.observed.category] || g.observed.category} at ${g.observed.stage} ${g.observed.unit}` : null;
        const later = rankOf(g.forecast.category) >= 2 && g.forecast.stage !== null ? `forecast ${FLOOD_LABEL[g.forecast.category]} ${g.forecast.stage} ${g.forecast.unit} by ${fmtEt(g.forecast.at, { day: true })}` : null;
        return `${g.name} (${g.distanceKm} km): ${[now, later].filter(Boolean).join(', ')}`;
      };
      const route = routeLine(feeds);
      out.push({
        id: `flood:${flooding.map((g) => `${g.id}-${g.observed.category}-${g.forecast.category}`).join(',')}`,
        level: nearRiver || worstRank >= 4 ? 'act' : 'watch',
        domain: 'safety',
        title: `${worst.tidal ? 'Coastal flooding' : 'River flooding'}: ${worst.name} — ${FLOOD_LABEL[rankOf(worst.observed.category) >= rankOf(worst.forecast.category) ? worst.observed.category : worst.forecast.category]}`,
        action: `Avoid low roads along the rivers and the bay; never drive into water.${route ? ` ${route}` : ''}`,
        evidence: flooding.slice(0, 3).map((g) => ev(feeds, 'water.gauges', describe(g))),
        playbook: PLAYBOOKS.flood,
        url: worst.url,
        geo: { lat: worst.lat, lon: worst.lon },
      });
    }
  }
  const b = dataOf(feeds, 'water.buoy');
  if (b && ((b.waveHeightFt ?? 0) >= 8 || (b.gustKt ?? 0) >= 34)) {
    out.push({
      id: `buoy:${b.station}:${Math.round(b.waveHeightFt ?? 0)}:${b.gustKt ?? 0}`,
      level: (b.waveHeightFt ?? 0) >= 15 || (b.gustKt ?? 0) >= 48 ? 'watch' : 'info',
      domain: 'safety',
      title: `Rough seas at the harbor entrance: ${b.waveHeightFt ?? '—'} ft waves, gusts ${b.gustKt ?? '—'} kt`,
      action: 'Coastal storm conditions: expect higher tides and surge in the bays; stay off the water and the shore roads.',
      evidence: [ev(feeds, 'water.buoy', `Buoy ${b.station}: ${b.dominantPeriodS ?? '—'} s period from ${b.waveFrom || '—'}, wind ${b.windFrom || ''} ${b.windKt ?? '—'} kt, water ${b.waterTempF ?? '—'}°F`)],
      url: b.url,
    });
  }
}

function airspaceAndReports(feeds, out, now) {
  for (const t of (dataOf(feeds, 'airspace.tfr') || []).slice(0, 3)) {
    out.push({
      id: `tfr:${t.id}`,
      level: 'watch',
      domain: 'travel',
      title: `Flight restriction (${t.type || 'TFR'}): ${t.description}`,
      action: 'Drones and private aircraft are restricted inside it — expect security activity in that area.',
      evidence: [ev(feeds, 'airspace.tfr', `FAA NOTAM ${t.id} · ${t.state}`)],
      url: t.url,
    });
  }
  const recent = (id, hours) => (dataOf(feeds, id) || []).filter((n) => n.at && now - Date.parse(n.at) <= hours * 3600_000);
  const uap = recent('news.uap', 48).slice(0, 2);
  if (uap.length) {
    out.push({
      id: `uap:${uap[0].url}`,
      level: 'info',
      domain: 'narrative',
      title: `Drone / UAP reports (unverified): ${uap[0].title}`,
      action: 'Reports, not confirmed events. Flight restrictions above are the official signal.',
      evidence: uap.map((n) => ev(feeds, 'news.uap', `${n.title} — ${n.source || 'news'}, ${agoH(n.at, now)}`)),
      url: uap[0].url,
    });
  }
  const fin = recent('news.finsec', 12).slice(0, 2);
  if (fin.length) {
    out.push({
      id: `finsec:${fin[0].url}`,
      level: 'watch',
      domain: 'cyber',
      title: `Payments / banking incident reported: ${fin[0].title}`,
      action: 'Verify with your bank before acting on any message about it; watch your accounts.',
      evidence: fin.map((n) => ev(feeds, 'news.finsec', `${n.title} — ${n.source || 'news'}, ${agoH(n.at, now)}`)),
      playbook: PLAYBOOKS.finsec,
      url: fin[0].url,
    });
  }
  const power = recent('news.power', 24).slice(0, 2);
  if (power.length) {
    out.push({
      id: `power:${power[0].url}`,
      level: 'watch',
      domain: 'safety',
      title: `Power outage reports near you: ${power[0].title}`,
      action: 'Get ready before it reaches you: charge devices now. (Utility outage maps have no public feed.)',
      evidence: power.map((n) => ev(feeds, 'news.power', `${n.title} — ${n.source || 'news'}, ${agoH(n.at, now)}`)),
      playbook: PLAYBOOKS.power,
      url: power[0].url,
    });
  }
}

/** Attach playbooks to items whose live trigger maps to one. */
function attachPlaybooks(items) {
  for (const i of items) {
    if (i.playbook) continue;
    const t = `${i.id} ${i.title}`;
    if (/^nws:/.test(i.id) && /flood|surge|coastal/i.test(i.title)) i.playbook = PLAYBOOKS.flood;
    else if (/^nws:/.test(i.id) && /winter|ice|freez|cold|chill/i.test(i.title)) i.playbook = PLAYBOOKS.cold;
    else if (/^nws:/.test(i.id) && /heat/i.test(i.title)) i.playbook = PLAYBOOKS.heat;
    else if (/^nws:/.test(i.id) && /wind|storm|hurricane|tornado/i.test(i.title)) i.playbook = PLAYBOOKS.wind;
    else if (/^wx:gust/.test(i.id)) i.playbook = PLAYBOOKS.wind;
    else if (/^wx:windchill|^wx:hardfreeze/.test(i.id)) i.playbook = PLAYBOOKS.cold;
    else if (/^wx:heat/.test(i.id)) i.playbook = PLAYBOOKS.heat;
    else if (/^air:/.test(i.id)) i.playbook = PLAYBOOKS.air;
    else if (/^quake:/.test(i.id)) i.playbook = PLAYBOOKS.quake;
    else if (/^kev:|^hn-sec:/.test(t)) i.playbook = PLAYBOOKS.cyber;
  }
  return items;
}

/**
 * Build the ranked brief.
 * @param {Record<string, {kind: string, data: any, reason?: string}>} feeds
 * @param {{now?: number, session?: object}} [ctx]
 */
export function buildBrief(feeds, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const out = [];
  const rules = [
    () => weatherAlerts(feeds, out),
    () => measuredConditions(feeds, out),
    () => forecast(feeds, out, now),
    () => air(feeds, out),
    () => water(feeds, out),
    () => airspaceAndReports(feeds, out, now),
    () => hazards(feeds, out, now),
    () => localReports(feeds, out, now),
    () => traffic(feeds, out, now),
    () => airports(feeds, out),
    () => events(feeds, out, now),
    () => cyber(feeds, out, now),
    () => session(ctx, out),
    () => volatility(feeds, out),
    () => trend(feeds, out),
    () => movers(feeds, out),
    () => rates(feeds, out),
    () => crypto(feeds, out),
    () => narratives(feeds, out),
    () => setup(feeds, out),
  ];
  for (const rule of rules) {
    try { rule(); } catch (error) {
      // A malformed feed must not take the whole brief down; the feed's own
      // status line already reports it.
      if (ctx.log) ctx.log(`[jarvis] rule failed: ${error?.message || error}`);
    }
  }
  return attachPlaybooks(out)
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || DOMAIN_RANK[a.domain] - DOMAIN_RANK[b.domain] || a.index - b.index)
    .map(({ index, ...item }) => item);
}

/** One-line situation summary from the top of the brief. */
export function situationLine(brief, max = 4) {
  return brief.filter((i) => i.level !== 'setup').slice(0, max).map((i) => i.title).join('  ·  ');
}
