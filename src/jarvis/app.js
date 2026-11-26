/**
 * @file Jarvis console — renders /api/jarvis/snapshot.
 *
 * The page never fetches a third party itself and never computes a figure the
 * server didn't return: it formats, it labels each panel with the feed's own
 * measured / modelled / unavailable status, and it says why when a panel is
 * empty. Every interpolated string goes through `esc()`; every link through
 * `href()` (http/https only).
 *
 * @module jarvis/app
 */

import './jarvis.css';

const REFRESH_MS = 60_000;
const NOTIFY_KEY = 'r1.jarvis.notify';
const SEEN_KEY = 'r1.jarvis.seen';
const TZ = 'America/New_York';

const state = {
  snap: null,
  error: null,
  lastOk: 0,
  tabs: { news: 'local', attention: 'us', headlines: 'macro' },
  openAlerts: new Set(),
  renderedBrief: new Set(),
  notify: localStorage.getItem(NOTIFY_KEY) === '1',
};

// ── formatting ──────────────────────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function href(u) {
  try {
    const p = new URL(String(u || ''));
    return p.protocol === 'https:' || p.protocol === 'http:' ? esc(p.href) : null;
  } catch {
    return null;
  }
}
const link = (u, text) => {
  const h = href(u);
  return h ? `<a href="${h}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fix = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '—');
const signed = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}` : '—');
const dir = (v) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');
const big = (v) => {
  if (!isNum(v)) return '—';
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
};

function fmtEt(value, opts = {}) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('en-US', {
    timeZone: TZ,
    ...(opts.date ? { month: 'short', day: 'numeric' } : {}),
    ...(opts.day ? { weekday: 'short' } : {}),
    ...(opts.time === false ? {} : { hour: 'numeric', minute: '2-digit' }),
    ...(opts.seconds ? { second: '2-digit' } : {}),
  });
}

function ago(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function price(q) {
  if (!isNum(q.last)) return '—';
  if (q.unit === '%') return `${q.last.toFixed(3)}%`;
  if (/=X$/.test(q.symbol)) return q.last.toFixed(4);
  if (q.last >= 10000) return q.last.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (q.last >= 1000) return q.last.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return q.last.toFixed(2);
}

// ── status chips & plates ───────────────────────────────────────────────────

const SOFT_REASONS = new Set(['no-key', 'no-home', 'loading', 'not-configured']);

function chip(feed) {
  if (!feed) return '<span class="kind"><i class="mk loading"></i>Loading</span>';
  if (feed.stale) return `<span class="kind stale"><i class="mk stale"></i>Stale · ${esc(feed.staleReason || 'refreshing')}</span>`;
  if (feed.kind === 'measured') return '<span class="kind measured"><i class="mk measured"></i>Measured</span>';
  if (feed.kind === 'modelled') return '<span class="kind"><i class="mk modelled"></i>Modelled</span>';
  const soft = SOFT_REASONS.has(feed.reason);
  const mk = feed.reason === 'loading' ? 'loading' : soft ? '' : 'failed';
  return `<span class="kind ${soft ? '' : 'failed'}"><i class="mk ${mk}"></i>Unavailable · ${esc(feed.reason)}</span>`;
}

function meta(feeds) {
  const list = feeds.filter(Boolean);
  if (!list.length) return chip(null);
  const f = list[0];
  const at = f.observedAt || f.fetchedAt;
  return `${list.map(chip).join('')}<span class="micro">${f.source ? link(f.source.url, f.source.name) : ''}${at ? ` · ${esc(ago(at))}` : ''}</span>`;
}

function plate(title, feeds, body, { flush = false, extra = '' } = {}) {
  return `<section class="plate"><header><h2>${esc(title)}</h2>${extra}<div class="meta">${meta(feeds)}</div></header><div class="body${flush ? ' flush' : ''}">${body}</div></section>`;
}

/** Body for a feed with no data: says exactly why. */
function why(feed, what = 'data') {
  if (!feed) return `<div class="empty">Fetching ${esc(what)}…</div>`;
  const r = feed.reason;
  if (r === 'loading') return `<div class="empty">Fetching ${esc(what)} — first pull can take a few seconds.</div>`;
  if (r === 'no-key') return `<div class="empty">Unavailable — <b>no key</b>. Add ${esc(feed.needs || 'the key')} to .env and restart.</div>`;
  if (r === 'no-home' || r === 'not-configured') return '<div class="empty">Unavailable — <b>no home point</b>. Set JARVIS_HOME_ADDRESS in .env.</div>';
  return `<div class="empty">Unavailable — <b>${esc(r)}</b> from ${esc(feed.source?.name || 'source')}. Retrying automatically; nothing shown rather than a guess.</div>`;
}

const has = (feed) => feed && feed.kind !== 'unavailable' && feed.data !== null && feed.data !== undefined;

function seg(group, options) {
  return `<div class="seg" role="tablist">${options.map(([id, label]) => `<button type="button" role="tab" data-tab="${esc(group)}:${esc(id)}" aria-selected="${state.tabs[group] === id}">${esc(label)}</button>`).join('')}</div>`;
}

function spark(series, ref = null) {
  const v = (series || []).filter(isNum);
  if (v.length < 2) return '';
  const all = isNum(ref) ? [...v, ref] : v;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (x) => (20 - ((x - lo) / span) * 18 + 1).toFixed(2);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * 100).toFixed(2)},${y(x)}`).join('');
  const line = isNum(ref) ? `<line x1="0" x2="100" y1="${y(ref)}" y2="${y(ref)}"/>` : '';
  return `<svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">${line}<path d="${d}"/></svg>`;
}

// ── panels ──────────────────────────────────────────────────────────────────

function briefPanel(snap) {
  const items = snap.brief || [];
  const prev = state.renderedBrief;
  const next = new Set(items.map((i) => i.id));
  const html = items.length ? `<ul class="brief">${items.map((i) => `
    <li class="${esc(i.level)}${prev.size && !prev.has(i.id) ? ' new' : ''}">
      <div class="row1"><span class="lvl">${esc(i.level)}</span><span class="title">${i.url ? link(i.url, i.title) : esc(i.title)}</span><span class="dom micro">${esc(i.domain)}</span></div>
      <div class="action">${esc(i.action)}</div>
      ${i.evidence?.length ? `<div class="evidence">${i.evidence.map((e) => `<div><i class="mk ${esc(e.kind)}"></i><span>${esc(e.text)}${e.source ? ` <span class="ink2">— ${esc(e.source)}${e.at ? `, ${esc(ago(e.at))}` : ''}</span>` : ''}</span></div>`).join('')}</div>` : ''}
    </li>`).join('')}</ul>` : '<div class="empty">Nothing needs your attention from the feeds that are live. Unavailable feeds are listed under Provenance.</div>';
  state.renderedBrief = next;
  const counts = ['act', 'watch', 'info'].map((l) => `${items.filter((i) => i.level === l).length} ${l}`).join(' · ');
  return `<section class="plate"><header><h2>Brief</h2><div class="meta"><span class="micro">${esc(counts)}</span><span class="micro">${esc(fmtEt(snap.generatedAt, { seconds: true }))} ET</span></div></header><div class="body flush">${html}</div></section>`;
}

function conditionsPanel(f) {
  const now = f['weather.now'];
  const alerts = f['weather.alerts'];
  let body = '';
  if (has(now)) {
    const d = now.data;
    body += `<div class="readouts">
      <div class="ro"><div class="l">Temp</div><div class="v">${fix(d.tempF, 0)}<small>°F</small></div></div>
      <div class="ro"><div class="l">Feels like</div><div class="v">${fix(d.feelsLikeF, 0)}<small>°F</small></div></div>
      <div class="ro"><div class="l">Wind</div><div class="v">${fix(d.windMph, 0)}<small>mph ${esc(d.windFrom || '')}</small></div></div>
      <div class="ro"><div class="l">Gust</div><div class="v">${fix(d.windGustMph, 0)}<small>mph</small></div></div>
      <div class="ro"><div class="l">Humidity</div><div class="v sm">${fix(d.humidity, 0)}<small>%</small></div></div>
      <div class="ro"><div class="l">Pressure</div><div class="v sm">${fix(d.pressureInHg, 2)}<small>inHg</small></div></div>
      <div class="ro"><div class="l">Visibility</div><div class="v sm">${fix(d.visibilityMi, 1)}<small>mi</small></div></div>
    </div>
    <div class="cond">${esc(d.text || 'No condition text reported')} <span class="micro">· ${esc(d.station?.id)} ${esc(d.station?.name || '')} · observed ${esc(fmtEt(d.observedAt))} ET</span></div>`;
  } else {
    body += why(now, 'station observation');
  }
  body += '<div class="sub">Active alerts</div>';
  if (has(alerts)) {
    body += alerts.data.length ? alerts.data.map((a) => `
      <div class="alert ${esc(a.severity)}">
        <div class="t">${link(a.url, a.event)}</div>
        <div class="m">${esc(a.severity)} · ${esc(a.urgency)} · until ${esc(fmtEt(a.ends || a.expires, { day: true }))} ET · ${esc(a.sender || 'NWS')}</div>
        ${a.headline ? `<div class="m">${esc(a.headline)}</div>` : ''}
        <details data-alert="${esc(a.id)}"${state.openAlerts.has(a.id) ? ' open' : ''}><summary>Full text</summary>
          ${a.description ? `<p>${esc(a.description)}</p>` : ''}${a.instruction ? `<p><b>What to do:</b> ${esc(a.instruction)}</p>` : ''}
        </details>
      </div>`).join('') : '<div class="empty">No active NWS alerts for your point.</div>';
  } else {
    body += why(alerts, 'alerts');
  }
  return plate('Conditions — home', [now, alerts], body);
}

function forecastPanel(f) {
  const fc = f['weather.forecast'];
  if (!has(fc)) return plate('Forecast', [fc], why(fc, 'forecast'));
  const hours = fc.data.hourly.periods.slice(0, 12);
  const strip = `<div class="hourly">${hours.map((p) => `
    <div><span class="h">${esc(fmtEt(p.start).replace(':00', '').replace(' ', ''))}</span><span class="t">${fix(p.tempF, 0)}°</span>
    <span class="bar"><i style="height:${Math.max(1, Math.round(((p.pop ?? 0) / 100) * 22))}px"></i></span><span class="p">${isNum(p.pop) ? `${p.pop}%` : '—'}</span></div>`).join('')}</div>`;
  const periods = (fc.data.daily?.periods || []).slice(0, 4).map((p) => `
    <div><span class="n">${esc(p.name)}</span><span class="tt">${fix(p.tempF, 0)}°</span><span class="s">${esc(p.short || '')}${isNum(p.pop) ? ` · ${p.pop}%` : ''}</span></div>`).join('');
  return plate('Forecast — next 12 h', [fc], `${strip}<div class="periods">${periods}</div><div class="micro" style="margin-top:8px">NWS ${esc(fc.data.office || '')} grid · issued ${esc(fmtEt(fc.data.hourly.issuedAt, { day: true }))} ET · bars = chance of precipitation</div>`);
}

function hazardsPanel(f) {
  const air = f['local.air'];
  const space = f['hazards.space'];
  const quakes = f['hazards.quakes'];
  const trop = f['hazards.tropical'];
  const fema = f['hazards.fema'];
  let b = '<div class="two"><div>';
  b += `<div class="sub">Air quality ${chip(air)}</div>`;
  b += has(air) ? `<div class="readouts"><div class="ro"><div class="l">US AQI</div><div class="v">${fix(air.data.aqi, 0)}</div></div>
    <div class="ro"><div class="l">PM2.5</div><div class="v sm">${fix(air.data.pm25, 1)}<small>µg/m³</small></div></div></div>
    <div class="cond">${esc(air.data.category || '')}${isNum(air.data.peak24h) ? ` · 24 h peak ${air.data.peak24h} (${esc(air.data.peakCategory)})` : ''}</div>` : why(air, 'air quality');
  b += '</div><div>';
  b += `<div class="sub">Space weather ${chip(space)}</div>`;
  b += has(space) ? `<div class="readouts"><div class="ro"><div class="l">Geomag</div><div class="v sm">G${fix(space.data.current.G, 0)}</div></div>
    <div class="ro"><div class="l">Radio</div><div class="v sm">R${fix(space.data.current.R, 0)}</div></div>
    <div class="ro"><div class="l">Kp</div><div class="v sm">${fix(space.data.kp?.kp, 1)}</div></div></div>
    <div class="cond">3-day forecast max G${fix(space.data.forecastMaxG, 0)}</div>` : why(space, 'space weather');
  b += '</div></div>';
  b += `<div class="sub">Earthquakes within 500 km · 7 days ${chip(quakes)}</div>`;
  if (has(quakes)) {
    const near = quakes.data.near;
    b += near.length ? `<ul class="rows">${near.slice(0, 4).map((q) => `<li><span>${link(q.url, `M${fix(q.mag, 1)} ${q.place || ''}`)}</span><span class="r">${esc(q.distanceKm)} km · ${esc(ago(q.at))}</span></li>`).join('')}</ul>` : '<div class="empty">None recorded by USGS.</div>';
    if (quakes.data.major.length) b += `<div class="micro" style="margin-top:6px">Global M6+ (72 h): ${quakes.data.major.map((q) => `${esc(`M${q.mag} ${q.place}`)}`).join(' · ')}</div>`;
  } else b += why(quakes, 'earthquakes');
  b += `<div class="sub">Tropical cyclones ${chip(trop)}</div>`;
  b += has(trop) ? (trop.data.length ? `<ul class="rows">${trop.data.map((s) => `<li><span>${link(s.advisoryUrl, `${s.classification} ${s.name}`)}</span><span class="r">${esc(s.distanceKm)} km · ${esc(s.intensityKt)} kt</span></li>`).join('')}</ul>` : '<div class="empty">No active storms (NHC).</div>') : why(trop, 'storms');
  b += `<div class="sub">FEMA declarations · your state ${chip(fema)}</div>`;
  if (has(fema)) {
    const recent = fema.data.recentForHome;
    b += recent.length
      ? `<ul class="rows">${recent.map((d) => `<li><span>${link(d.url, d.title)}</span><span class="r">${esc(d.declaredAt?.slice(0, 10))}</span></li>`).join('')}</ul>`
      : `<div class="empty">None covering your county in 180 days. Latest in state: ${esc(fema.data.latest[0]?.title || '—')} (${esc(fema.data.latest[0]?.declaredAt?.slice(0, 10) || '—')}).</div>`;
  } else b += why(fema, 'declarations');
  return plate('Air & hazards', [air, space, quakes], b);
}

function mobilityPanel(f) {
  const ap = f['local.airports'];
  const tr = f['local.traffic'];
  const evt = f['local.events'];
  let b = `<div class="sub">Airports ${chip(ap)}</div>`;
  if (has(ap)) {
    const d = ap.data;
    b += `<ul class="rows">${d.airports.map((code) => {
      const items = [
        ...d.groundStops.filter((x) => x.airport === code).map((x) => `<span class="down">Ground stop</span> ${esc(x.reason || '')}`),
        ...d.groundDelays.filter((x) => x.airport === code).map((x) => `<span class="flag">Ground delay</span> avg ${esc(x.avg || '—')}`),
        ...d.delays.filter((x) => x.airport === code).map((x) => `<span class="flag">${esc(x.type || 'Delay')}</span> ${esc(x.min || '')}–${esc(x.max || '')}`),
      ];
      return `<li><span class="mono">${esc(code)}</span><span class="r">${items.length ? items.join(' · ') : 'Normal operations'}</span></li>`;
    }).join('')}</ul><div class="micro" style="margin-top:6px">FAA ATCSCC · ${esc(fmtEt(d.updatedAt))} ET</div>`;
  } else b += why(ap, 'airport status');
  b += `<div class="sub">Traffic within 8 km ${chip(tr)}</div>`;
  if (has(tr)) {
    b += tr.data.length ? `<ul class="rows">${tr.data.slice(0, 6).map((i) => `<li><span>${esc(i.category)}${i.roads.length ? ` · ${esc(i.roads.join('/'))}` : ''}<span class="s2">${esc(i.from || '')}${i.to ? ` → ${esc(i.to)}` : ''}${i.start ? ` · since ${esc(fmtEt(i.start, { date: true }))}` : ''}</span></span><span class="r">${esc(fix(i.distanceKm, 1))} km${isNum(i.delayMin) && i.delayMin > 0 ? ` · +${i.delayMin} min` : ''}</span></li>`).join('')}</ul>` : '<div class="empty">No incidents reported by TomTom.</div>';
  } else b += why(tr, 'traffic');
  b += `<div class="sub">Events · next 48 h ${chip(evt)}</div>`;
  if (has(evt)) {
    b += evt.data.length ? `<ul class="rows">${evt.data.slice(0, 6).map((e) => `<li><span>${link(e.url, e.name)}<span class="s2">${esc(e.venue || '')}${e.city ? `, ${esc(e.city)}` : ''}</span></span><span class="r">${esc(e.start ? fmtEt(e.start, { day: true }) : `${e.localDate || ''} ${e.localTime || ''}`)}</span></li>`).join('')}</ul>` : '<div class="empty">No ticketed events nearby.</div>';
  } else b += why(evt, 'events');
  return plate('Mobility', [ap, tr], b);
}

function newsRows(feed, empty) {
  if (!has(feed)) return why(feed, 'headlines');
  if (!feed.data.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<ul class="rows">${feed.data.map((n) => `<li><span>${link(n.url, n.title)}<span class="s2">${esc(n.source || '')}</span></span><span class="r">${esc(ago(n.at))}</span></li>`).join('')}</ul>`;
}

function localNewsPanel(f) {
  const tab = state.tabs.news;
  const feed = tab === 'incidents' ? f['news.safety'] : f['news.local'];
  return plate('Around you', [feed], newsRows(feed, tab === 'incidents' ? 'No incident headlines naming your area in the last 48 h.' : 'No local headlines in the last 48 h.'),
    { flush: true, extra: seg('news', [['local', 'Local'], ['incidents', 'Incidents']]) });
}

function marketsPanel(snap) {
  const f = snap.feeds;
  const m = f.markets;
  const s = snap.session;
  const sessionLine = s ? `<div class="empty" style="padding:8px 12px;border-bottom:1px solid var(--line)"><b>NYSE ${esc(s.state.toUpperCase())}</b> · ${esc(s.detail)}${s.nextOpen && s.state !== 'open' ? ` · next open ${esc(s.nextOpen.date)} 9:30 am ET${s.nextOpen.earlyClose ? ' (early close 1:00 pm)' : ''}` : ''}${s.calendarCovered ? '' : ' · holiday calendar not loaded for this year'}</div>` : '';
  if (!has(m)) return plate('Markets', [m], sessionLine + why(m, 'quotes'), { flush: true });
  const tiles = m.data.map((q) => (q.available ? `
    <div class="tile" title="${esc(q.symbol)} · last print ${esc(fmtEt(q.lastAt, { date: true }))} ET">
      <div class="l"><span>${esc(q.label)}</span><span>${esc(q.symbol)}</span></div>
      <div class="v">${esc(price(q))}</div>
      <div class="c ${dir(q.change)}">${q.unit === '%' ? `${signed(q.changeBp, 0)} bp` : `${signed(q.changePct, 2)}%`}</div>
      ${spark(q.series, q.prevClose)}
    </div>` : `<div class="tile na"><div class="l"><span>${esc(q.label)}</span><span>${esc(q.symbol)}</span></div><div class="v">—</div><div class="c dim">no quote</div></div>`)).join('');
  return plate('Markets', [m], `${sessionLine}<div class="board">${tiles}</div><div class="micro" style="padding:8px 12px">Change vs prior session close · Yahoo Finance, delayed · dashed line = prior close</div>`, { flush: true });
}

function regimePanel(f) {
  const r = f['markets.regime'];
  if (!has(r)) return plate('S&P trend regime', [r], why(r, 'daily closes'));
  const d = r.data;
  return plate(`${d.symbol || 'SPY'} trend regime`, [r], `<div class="readouts">
    <div class="ro"><div class="l">Last</div><div class="v sm">${fix(d.last, 2)}</div></div>
    <div class="ro"><div class="l">50-day</div><div class="v sm">${fix(d.sma50, 2)}</div></div>
    <div class="ro"><div class="l">200-day</div><div class="v sm">${fix(d.sma200, 2)}</div></div>
    <div class="ro"><div class="l">vs 200d</div><div class="v sm ${dir(d.vsSma200Pct)}">${signed(d.vsSma200Pct, 1)}<small>%</small></div></div>
    <div class="ro"><div class="l">From 1y high</div><div class="v sm ${dir(d.drawdownPct)}">${signed(d.drawdownPct, 1)}<small>%</small></div></div>
    <div class="ro"><div class="l">20d real. vol</div><div class="v sm">${fix(d.realizedVol20, 1)}<small>%</small></div></div>
  </div><div class="cond">Regime: <b>${esc(d.trend || '—')}</b> · computed from published daily closes through ${esc(fmtEt(d.asOf, { date: true, time: false }))}</div>`);
}

function ratesPanel(f) {
  const t = f['rates.treasury'];
  const ny = f['rates.nyfed'];
  const mo = f['macro.mortgage'];
  let b = `<div class="sub">Treasury par curve ${chip(t)}</div>`;
  if (has(t)) {
    const d = t.data;
    b += `<table class="t"><thead><tr><th>Tenor</th>${d.tenors.map((x) => `<th>${esc(x.tenor)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Yield %</td>${d.tenors.map((x) => `<td class="v">${fix(x.yield, 2)}</td>`).join('')}</tr>
      <tr><td>Δ bp</td>${d.tenors.map((x) => `<td class="${dir(x.changeBp)}">${signed(x.changeBp, 0)}</td>`).join('')}</tr></tbody></table>
      <div class="micro" style="margin-top:6px">${esc(d.date)} vs ${esc(d.priorDate || '—')} · 2s10s ${signed(d.spread2s10sBp, 0)} bp · 3m10y ${signed(d.spread3m10yBp, 0)} bp</div>`;
  } else b += why(t, 'Treasury curve');
  b += '<div class="two"><div>';
  b += `<div class="sub">Funding ${chip(ny)}</div>`;
  b += has(ny) ? `<div class="readouts">
      <div class="ro"><div class="l">SOFR</div><div class="v sm">${fix(ny.data.sofr?.rate, 2)}<small>%</small></div></div>
      <div class="ro"><div class="l">EFFR</div><div class="v sm">${fix(ny.data.effr?.rate, 2)}<small>%</small></div></div></div>
      <div class="micro" style="margin-top:6px">NY Fed · ${esc(ny.data.sofr?.date || ny.data.effr?.date || '')}</div>` : why(ny, 'reference rates');
  b += '</div><div>';
  b += `<div class="sub">Mortgage ${chip(mo)}</div>`;
  b += has(mo) ? `<div class="readouts">
      <div class="ro"><div class="l">30-yr</div><div class="v sm">${fix(mo.data.rate30, 2)}<small>%</small></div></div>
      <div class="ro"><div class="l">15-yr</div><div class="v sm">${fix(mo.data.rate15, 2)}<small>%</small></div></div>
      <div class="ro"><div class="l">w/w</div><div class="v sm ${dir(-mo.data.change30Bp)}">${signed(mo.data.change30Bp, 0)}<small>bp</small></div></div></div>
      <div class="micro" style="margin-top:6px">Freddie Mac PMMS · ${esc(mo.data.date)} · yr ago ${fix(mo.data.yearAgo30, 2)}%</div>` : why(mo, 'mortgage rates');
  b += '</div></div>';
  return plate('Rates', [t, ny, mo], b);
}

function macroPanel(f) {
  const bls = f['macro.bls'];
  if (!has(bls)) return plate('Jobs & inflation', [bls], why(bls, 'BLS series'));
  const d = bls.data;
  const yoyRo = (label, x) => `<div class="ro"><div class="l">${esc(label)}</div><div class="v sm">${fix(x?.yoyPct, 1)}<small>% y/y</small></div><div class="micro" style="margin-top:4px">${esc(x?.period || '—')}${isNum(x?.prevYoyPct) ? ` · prior ${x.prevYoyPct}%` : ''}</div></div>`;
  const gaps = [d.cpi, d.coreCpi].filter((x) => x?.skipped).map((x) => x.skipped);
  return plate('Jobs & inflation', [bls], `<div class="readouts">
    <div class="ro"><div class="l">Unemployment</div><div class="v sm">${fix(d.unemployment?.value, 1)}<small>%</small></div><div class="micro" style="margin-top:4px">${esc(d.unemployment?.period || '—')} · prior ${fix(d.unemployment?.prev, 1)}%</div></div>
    ${yoyRo('CPI', d.cpi)}${yoyRo('Core CPI', d.coreCpi)}
    <div class="ro"><div class="l">Payrolls</div><div class="v sm ${dir(d.payrolls?.changeK)}">${signed(d.payrolls?.changeK, 0)}<small>k m/m</small></div><div class="micro" style="margin-top:4px">${esc(d.payrolls?.period || '—')}</div></div>
  </div>${gaps.length ? `<div class="note">y/y for ${esc([...new Set(gaps)].join(', '))} can't be computed: BLS published no figure for the same month a year earlier. Showing the newest computable month.</div>` : ''}`);
}

function sentimentPanel(f) {
  const fng = f['sentiment.cryptoFng'];
  const st = f['crypto.stablecoins'];
  const tone = f['tone.gdelt'];
  let b = '<div class="two"><div>';
  b += `<div class="sub">Crypto Fear &amp; Greed ${chip(fng)}</div>`;
  if (has(fng)) {
    const v = fng.data.now?.value;
    b += `<div class="readouts"><div class="ro"><div class="l">${esc(fng.data.now?.label || '')}</div><div class="v">${fix(v, 0)}<small>/100</small></div></div></div>
      <div class="meter"><i style="left:calc(${Math.max(0, Math.min(100, v ?? 0))}% - 1px)"></i></div><div class="meter-ticks"><span>Fear 0</span><span>50</span><span>100 Greed</span></div>
      <div class="micro" style="margin-top:6px">Yesterday ${fix(fng.data.yesterday?.value, 0)} · week ago ${fix(fng.data.weekAgo?.value, 0)}</div>`;
  } else b += why(fng, 'index');
  b += '</div><div>';
  b += `<div class="sub">Stablecoin supply ${chip(st)}</div>`;
  if (has(st)) {
    const d = st.data;
    b += `<div class="readouts"><div class="ro"><div class="l">USD-pegged</div><div class="v">$${esc(big(d.totalUsd))}</div></div></div>
      <div class="micro" style="margin-top:6px"><span class="${dir(d.change1dPct)}">1d ${signed(d.change1dPct, 2)}%</span> · <span class="${dir(d.change7dPct)}">7d ${signed(d.change7dPct, 2)}%</span> · <span class="${dir(d.change30dPct)}">30d ${signed(d.change30dPct, 2)}%</span></div>
      <div class="micro" style="margin-top:6px">${d.top.slice(0, 4).map((x) => `${esc(x.symbol)} $${esc(big(x.circulating))}`).join(' · ')}</div>`;
  } else b += why(st, 'supply');
  b += '</div></div>';
  b += `<div class="sub">News tone · GDELT 24 h vs 7 d ${chip(tone)}</div>`;
  if (has(tone)) {
    b += `<table class="t"><thead><tr><th>Theme</th><th>24 h</th><th>7 d</th><th>Δ</th><th style="width:30%"></th></tr></thead><tbody>${tone.data.map((t) => (t.tone
      ? `<tr><td>${esc(t.label)}</td><td class="v">${fix(t.tone.avg24h, 2)}</td><td>${fix(t.tone.avg7d, 2)}</td><td class="${dir(t.tone.delta)}">${signed(t.tone.delta, 2)}</td><td><div class="tile" style="padding:0;background:none">${spark(t.tone.series)}</div></td></tr>`
      : `<tr><td>${esc(t.label)}</td><td colspan="4" class="dim">unavailable · ${esc(t.reason || '')}</td></tr>`)).join('')}</tbody></table>
      <div class="micro" style="margin-top:6px">Average article tone (negative = hostile coverage). <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">GDELT Project</a></div>`;
  } else b += why(tone, 'tone (GDELT allows one request per 5 s — first pull takes ~30 s)');
  return plate('Sentiment', [fng, st], b);
}

function narrativesPanel(f) {
  const pm = f['narratives.polymarket'];
  if (!has(pm)) return plate('Narratives — money-weighted odds', [pm], why(pm, 'markets'));
  const body = pm.data.length ? `<ul class="rows">${pm.data.slice(0, 9).map((e) => `
    <li style="grid-template-columns:1fr"><span>${link(e.url, e.title)} <span class="micro">· $${esc(big(e.volume24h))} 24 h</span>
      <div class="probs">${e.options.map((o) => `<div><span class="lab">${esc(o.label)}<div class="pbar"><i style="width:${Math.round(o.prob * 100)}%"></i></div></span><span class="pv">${Math.round(o.prob * 100)}%</span><span class="pc ${dir(o.change24h)}">${isNum(o.change24h) && o.change24h !== 0 ? `${signed(o.change24h * 100, 0)} pts` : ''}</span></div>`).join('')}</div></span></li>`).join('')}</ul>`
    : '<div class="empty">No non-sports markets returned.</div>';
  return plate('Narratives — money-weighted odds', [pm], `${body}<div class="micro" style="padding:8px 12px">Polymarket last prices, top non-sports events by 24 h volume. Odds are traders' bets, not forecasts of record.</div>`, { flush: true });
}

function attentionPanel(f) {
  const tr = f['attention.trends'];
  const wk = f['attention.wiki'];
  const hn = f['attention.hn'];
  const tab = state.tabs.attention;
  let feed = tr;
  let body = '';
  if (tab === 'us' || tab === 'local') {
    feed = tr;
    const list = has(tr) ? (tab === 'us' ? tr.data.us : tr.data.local) : null;
    body = !has(tr) ? why(tr, 'trends') : (list.length ? `<ul class="rows">${list.map((t) => `<li><span>${esc(t.title)}${t.newsTitle ? `<span class="s2">${link(t.newsUrl, t.newsTitle)}${t.newsSource ? ` · ${esc(t.newsSource)}` : ''}</span>` : ''}</span><span class="r">${esc(t.traffic || '')}</span></li>`).join('')}</ul>` : '<div class="empty">No trending searches returned.</div>');
  } else if (tab === 'wiki') {
    feed = wk;
    body = has(wk) ? `<ul class="rows">${wk.data.articles.map((a) => `<li><span>${link(a.url, a.title)}</span><span class="r">${esc(big(a.views))} views</span></li>`).join('')}</ul><div class="micro" style="padding:8px 12px">English Wikipedia, ${esc(wk.data.date)} (UTC)</div>` : why(wk, 'pageviews');
  } else {
    feed = hn;
    body = has(hn) ? `<ul class="rows">${hn.data.slice(0, 12).map((s) => `<li><span>${s.security ? '<span class="flag">SEC </span>' : ''}${link(s.url, s.title)}<span class="s2">${link(s.hnUrl, `${s.comments} comments`)}</span></span><span class="r">${esc(s.points)} pts</span></li>`).join('')}</ul>` : why(hn, 'front page');
  }
  const localLabel = has(tr) ? tr.data.localGeo.replace('US-', '') : 'Local';
  return plate('Attention', [feed], body, { flush: true, extra: seg('attention', [['us', 'US search'], ['local', `${localLabel} search`], ['wiki', 'Wikipedia'], ['hn', 'Tech']]) });
}

function socialPanel(f) {
  const rd = f['social.reddit'];
  const bs = f['social.bluesky'];
  let b = `<div class="sub">Reddit ${chip(rd)}</div>`;
  b += has(rd) ? rd.data.map((s) => `<div class="micro" style="margin:10px 0 4px">r/${esc(s.sub)}</div><ul class="rows">${s.posts.slice(0, 3).map((p) => `<li><span>${link(p.url, p.title)}</span><span class="r">${esc(big(p.score))} · ${esc(ago(p.at))}</span></li>`).join('')}</ul>`).join('') : why(rd, 'Reddit');
  b += `<div class="sub">Bluesky · last 24 h ${chip(bs)}</div>`;
  b += has(bs) ? bs.data.map((q) => `<div class="micro" style="margin:10px 0 4px">“${esc(q.query)}”</div><ul class="rows">${q.posts.slice(0, 3).map((p) => `<li><span>${link(p.url, p.text)}<span class="s2">@${esc(p.author)}</span></span><span class="r">${esc(big(p.likes))} likes</span></li>`).join('')}</ul>`).join('') : why(bs, 'Bluesky');
  return plate('Social', [rd, bs], b);
}

function cyberPanel(f) {
  const kev = f['cyber.kev'];
  const hn = f['attention.hn'];
  let b = '';
  const sec = has(hn) ? hn.data.filter((s) => s.security).slice(0, 4) : [];
  b += `<div class="sub">Trending security stories ${chip(hn)}</div>`;
  b += has(hn) ? (sec.length ? `<ul class="rows">${sec.map((s) => `<li><span>${link(s.url, s.title)}</span><span class="r">${esc(s.points)} pts</span></li>`).join('')}</ul>` : '<div class="empty">None on the front page.</div>') : why(hn, 'stories');
  b += `<div class="sub">Actively exploited · added last 10 days ${chip(kev)}</div>`;
  if (has(kev)) {
    const list = [...kev.data.recent].sort((a, c) => Number(c.consumer) - Number(a.consumer));
    b += list.length ? `<ul class="rows">${list.slice(0, 8).map((v) => `<li><span>${v.consumer ? '<span class="flag">HOME </span>' : ''}${link(v.url, `${v.vendor} ${v.product}`)}<span class="s2">${esc(v.cve)}${v.ransomware ? ' · ransomware' : ''} · ${esc(v.name || '')}</span></span><span class="r">${esc(v.dateAdded)}</span></li>`).join('')}</ul>` : '<div class="empty">No KEV additions in 10 days.</div>';
    b += `<div class="micro" style="margin-top:6px">CISA KEV catalog · ${esc(kev.data.total)} entries · HOME = vendor ships consumer devices or apps</div>`;
  } else b += why(kev, 'KEV');
  return plate('Cyber', [kev], b);
}

function headlinesPanel(f) {
  const tab = state.tabs.headlines;
  const feed = f[`news.${tab}`];
  return plate('Headlines', [feed], newsRows(feed, 'No headlines in the window.'),
    { flush: true, extra: seg('headlines', [['macro', 'Macro'], ['ai', 'AI'], ['tokenization', 'Tokenization']]) });
}

function provenancePanel(snap) {
  const rows = Object.values(snap.feeds).map((f) => `<tr>
    <td class="v">${esc(f.label)}</td><td>${chip(f)}</td><td>${f.source ? link(f.source.url, f.source.name) : '—'}</td>
    <td>${esc(f.observedAt ? fmtEt(f.observedAt, { date: true }) : '—')}</td><td>${esc(f.fetchedAt ? ago(f.fetchedAt) : '—')}</td>
    <td class="reason ${f.kind === 'unavailable' && SOFT_REASONS.has(f.reason) ? 'na' : ''}">${esc(f.kind === 'unavailable' ? (f.needs ? `needs ${f.needs}` : f.reason) : (f.stale ? `stale: ${f.staleReason}` : ''))}</td></tr>`).join('');
  const h = snap.health;
  return `<section class="plate prov"><header><h2>Provenance — every feed, every state</h2><div class="meta"><span class="micro">${h.measured} measured · ${h.modelled} modelled · ${h.unavailable} unavailable · ${h.stale} stale</span></div></header>
    <div class="body flush"><table class="t"><thead><tr><th>Feed</th><th>State</th><th>Source</th><th>Observed (ET)</th><th>Fetched</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ── page ────────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  const snap = state.snap;
  if (!snap) {
    app.innerHTML = `<div class="situation"><i class="mk loading"></i> ${state.error ? `Snapshot unavailable — ${esc(state.error)}. Retrying.` : 'Pulling live feeds — weather, markets, odds, sentiment, news…'}</div>`;
    return;
  }
  const f = snap.feeds;
  const act = snap.brief.filter((i) => i.level === 'act').length;
  const watch = snap.brief.filter((i) => i.level === 'watch').length;
  const homeBanner = snap.home ? '' : `<div class="situation watch">Home point ${esc(snap.homeStatus)} — set <b>JARVIS_HOME_ADDRESS</b> (or JARVIS_HOME_LAT/LON) in .env and restart. Local feeds stay unavailable until then.</div>`;
  app.innerHTML = `${homeBanner}
    <div class="situation ${act ? 'act' : watch ? 'watch' : ''}"><b>${act} act · ${watch} watch</b>${snap.situation ? ` — ${esc(snap.situation)}` : ''}${state.error ? ` <span class="kind failed">· last refresh failed (${esc(state.error)}), showing ${esc(ago(state.lastOk))}</span>` : ''}</div>
    <div class="grid">
      <div class="col c1">${briefPanel(snap)}${conditionsPanel(f)}${forecastPanel(f)}${mobilityPanel(f)}${localNewsPanel(f)}</div>
      <div class="col c2">${marketsPanel(snap)}${regimePanel(f)}${ratesPanel(f)}${macroPanel(f)}${hazardsPanel(f)}</div>
      <div class="col c3">${sentimentPanel(f)}${narrativesPanel(f)}${attentionPanel(f)}${headlinesPanel(f)}${cyberPanel(f)}${socialPanel(f)}</div>
    </div>
    ${provenancePanel(snap)}
    <div class="foot">Every figure is labelled measured (published observation or price), modelled (forecast or model output), or unavailable with the reason. Nothing is filled in.
      Weather &amp; alerts: <a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer">NWS</a> · Air: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo.com</a> (CAMS, CC BY 4.0) · Data courtesy of the U.S. Geological Survey · NOAA SWPC &amp; NHC · OpenFEMA · FAA ATCSCC ·
      Traffic © TomTom · Quotes: Yahoo Finance (delayed, personal use) · U.S. Treasury · NY Fed · BLS · Freddie Mac PMMS · Fear &amp; Greed: <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener noreferrer">Alternative.me</a> · Stablecoins: DefiLlama ·
      Odds: Polymarket · Trends: Google · Pageviews: Wikimedia · Headlines: Google News RSS &amp; publishers · Tone: <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">GDELT Project</a> · CISA KEV.
      Market items describe risk conditions, not trade recommendations.</div>`;
  document.title = act ? `(${act}) Jarvis — R.1` : 'Jarvis — R.1';
  renderStrip();
}

function renderStrip() {
  const snap = state.snap;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  if (snap) {
    set('home', esc(snap.home ? `${snap.home.label}` : 'Home not set'));
    const s = snap.session;
    set('session', s ? `NYSE <span class="val">${esc(s.state)}</span>${s.holiday ? ` · ${esc(s.holiday)}` : ''}` : '');
    const h = snap.health;
    set('health', `<span><i class="mk measured"></i><span class="val">${h.measured}</span> measured</span><span><i class="mk modelled"></i><span class="val">${h.modelled}</span> modelled</span><span><i class="mk"></i><span class="val">${h.unavailable}</span> unavailable</span>${h.stale ? `<span><i class="mk stale"></i><span class="val">${h.stale}</span> stale</span>` : ''}`);
    set('updated', `Updated <span class="val">${esc(fmtEt(snap.generatedAt, { seconds: true }))}</span>`);
  }
  const btn = document.getElementById('notify');
  if (btn) {
    btn.setAttribute('aria-pressed', String(state.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted'));
    btn.textContent = state.notify ? 'Alerts on' : 'Alerts off';
  }
}

function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.innerHTML = `ET <span class="val">${esc(fmtEt(Date.now(), { seconds: true, day: true }))}</span>`;
}

// ── notifications ───────────────────────────────────────────────────────────

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}

function notifyNew(brief) {
  const seen = loadSeen();
  const fresh = brief.filter((i) => i.level === 'act' && !seen.has(i.id));
  if (!fresh.length) return;
  for (const i of fresh) seen.add(i.id);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300)));
  if (!state.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const i of fresh.slice(0, 3)) {
    try { new Notification(`Jarvis · ${i.title}`, { body: i.action, tag: i.id }); } catch { /* unsupported context */ }
  }
}

async function toggleNotify() {
  if (typeof Notification === 'undefined') return;
  if (state.notify) {
    state.notify = false;
  } else {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    state.notify = permission === 'granted';
    if (state.notify && state.snap) {
      const act = state.snap.brief.filter((i) => i.level === 'act');
      try { new Notification('Jarvis alerts on', { body: act.length ? `${act.length} action${act.length > 1 ? 's' : ''} now: ${act.map((i) => i.title).join(' · ')}` : 'Nothing needs action right now. New act-level items will notify you.' }); } catch { /* ignore */ }
    }
  }
  localStorage.setItem(NOTIFY_KEY, state.notify ? '1' : '0');
  renderStrip();
}

// ── data loop ───────────────────────────────────────────────────────────────

let inflight = false;
async function refresh() {
  if (inflight) return;
  inflight = true;
  const btn = document.getElementById('refresh');
  if (btn) btn.textContent = 'Refreshing';
  try {
    const res = await fetch('/api/jarvis/snapshot', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.snap = await res.json();
    state.error = null;
    state.lastOk = Date.now();
    notifyNew(state.snap.brief || []);
  } catch (error) {
    state.error = error?.message || 'network error';
  } finally {
    inflight = false;
    if (btn) btn.textContent = 'Refresh';
    render();
  }
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    const [group, id] = tab.getAttribute('data-tab').split(':');
    state.tabs[group] = id;
    render();
    return;
  }
  if (event.target.closest('#refresh')) refresh();
  if (event.target.closest('#notify')) toggleNotify();
});
document.addEventListener('toggle', (event) => {
  const el = event.target;
  if (el?.matches?.('details[data-alert]')) {
    const id = el.getAttribute('data-alert');
    if (el.open) state.openAlerts.add(id); else state.openAlerts.delete(id);
  }
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastOk > REFRESH_MS) refresh();
});

tickClock();
setInterval(tickClock, 1000);
render();
refresh();
setInterval(() => { if (document.visibilityState === 'visible' || state.notify) refresh(); }, REFRESH_MS);
