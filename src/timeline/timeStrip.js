/**
 * @file The map's time slider: a transport strip above the command dock.
 *
 * Drag the cursor back up to seven days and the layers with a measured past
 * — fires (NASA FIRMS) and earthquakes (USGS) — re-draw the 24 h ending at the
 * cursor, the same window they show live. The lanes above the scrubber draw
 * the trend that produced each picture: rolling 24 h fire detections and
 * quake events in view, and GDELT news-coverage share at the four oil
 * chokepoints.
 *
 * What it will not do: shift a layer that has no history. Flights, vessels,
 * traffic and the rest stay live, and while the cursor is parked the strip
 * names them. Closing the strip returns the map to live, so a past picture is
 * never on screen without the strip saying so.
 *
 * Front doors: the clock button in the top action bar, `?time` (open, live)
 * and `?at=<ISO | epoch ms | -36h | -2d>` (open, parked). No voice tool yet —
 * adding one means re-deriving the two schema pins.
 *
 * @module timeline/timeStrip
 */

import * as Cesium from 'cesium';
import {
  DAY_MS,
  HOUR_MS,
  LAYER_WINDOW_MS,
  createTimeCursor,
  formatCursorUtc,
  formatOffset,
  parseTimeParam,
} from './timeCursor.js';
import {
  createFirmsHistorySource,
  createGdeltHistorySource,
  createQuakeHistorySource,
} from './historySources.js';
import { governorRequestRender } from '../renderGovernor.js';

const FIRES_ID = 'local-firms';
const QUAKES_ID = 'earthquakes';
const TIME_AWARE = new Set([FIRES_ID, QUAKES_ID]);
const PLAY_STEP_MS = 600;
const META_POLL_BUILDING_MS = 15_000;
const META_POLL_READY_MS = 10 * 60_000;
const DATA_RELOAD_MIN_MS = 60_000;
const GATE_FOCUS_HEIGHT_M = 900_000;
/** §09 earthquake ramp, M2 → M7+. */
const QUAKE_RAMP = ['#F2B33D', '#FF9236', '#FF6A45', '#FF4A38', '#FF3B2F'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const fmtCount = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');

function quakeColor(mag) {
  const i = Math.max(0, Math.min(QUAKE_RAMP.length - 1, Math.floor(Number(mag) - 2)));
  return QUAKE_RAMP[i];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function iconButton(act, icon, label) {
  const button = el('button', 'r1-ts-btn');
  button.type = 'button';
  button.dataset.act = act;
  button.setAttribute('aria-label', label);
  button.title = label;
  const glyph = el('span', 'material-symbols-outlined', icon);
  glyph.setAttribute('aria-hidden', 'true');
  button.append(glyph);
  return button;
}

/**
 * Mount the strip. Returns a small control surface (also `window.__r1.time`).
 * @param {{viewer: Cesium.Viewer, dataManager: object, toggleButton?: HTMLElement|null,
 *   search?: string}} opts
 */
export function initTimeStrip({ viewer, dataManager, toggleButton = null, search = window.location.search }) {
  const cursor = createTimeCursor();
  const firms = createFirmsHistorySource();
  const quakes = createQuakeHistorySource();
  const gdelt = createGdeltHistorySource();

  let open = false;
  let playTimer = null;
  let metaTimer = null;
  let clockTimer = null;
  let lastDataLoadAt = 0;
  let box = null;
  let applyQueued = false;
  let lastApplyAt = 0;
  let removeMoveEnd = null;
  let lanesDirty = true;
  let lastAppliedLive = true;
  /** `${cursorMs}:${downloaded data version}` of the fire window last drawn. */
  let appliedFiresKey = null;

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = el('section', 'r1-time-strip');
  root.id = 'r1-time-strip';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Time slider');
  root.hidden = true;

  const defs = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true', class: 'r1-ts-defs' });
  const pattern = svgEl('pattern', { id: 'r1-ts-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.append(svgEl('rect', { width: 6, height: 6, class: 'r1-ts-hatch-bg' }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'r1-ts-hatch-line' }));
  const defsInner = svgEl('defs');
  defsInner.append(pattern);
  defs.append(defsInner);

  const head = el('header', 'r1-ts-head');
  const title = el('span', 'r1-ts-title', 'TIME');
  const transport = el('div', 'r1-ts-transport');
  transport.setAttribute('role', 'group');
  transport.setAttribute('aria-label', 'Playback');
  const backBtn = iconButton('back', 'chevron_left', 'Back one hour');
  const playBtn = iconButton('play', 'play_arrow', 'Play forward');
  const fwdBtn = iconButton('fwd', 'chevron_right', 'Forward one hour');
  const liveBtn = el('button', 'r1-ts-btn r1-ts-live', 'LIVE');
  liveBtn.type = 'button';
  liveBtn.dataset.act = 'live';
  liveBtn.title = 'Return every layer to live';
  transport.append(backBtn, playBtn, fwdBtn, liveBtn);

  const readout = el('div', 'r1-ts-readout');
  readout.setAttribute('aria-live', 'polite');
  const when = el('span', 'r1-ts-when', 'LIVE');
  const offset = el('span', 'r1-ts-offset', '');
  readout.append(when, offset);
  const note = el('span', 'r1-ts-note', 'EACH LAYER SHOWS THE 24 H ENDING AT THE CURSOR · UTC');
  const closeBtn = iconButton('close', 'close', 'Close time slider and return to live');
  head.append(title, transport, readout, note, closeBtn);

  const body = el('div', 'r1-ts-body');
  const labels = el('div', 'r1-ts-labels');
  const plot = el('div', 'r1-ts-plot');
  const values = el('div', 'r1-ts-values');
  const cursorLine = el('div', 'r1-ts-cursor');
  const axis = el('div', 'r1-ts-axis');
  const range = el('input', 'r1-ts-range');
  range.type = 'range';
  range.min = '0';
  range.step = '1';
  range.setAttribute('aria-label', 'Time cursor, hours back from now');
  body.append(labels, plot, values);

  /** @type {Map<string, {label: HTMLElement, svg: SVGSVGElement, value: HTMLElement, sub: HTMLElement}>} */
  const lanes = new Map();
  function addLane(key, text, { tall = false, onLabel = null, scope = '' } = {}) {
    const label = el(onLabel ? 'button' : 'div', `r1-ts-label${tall ? ' is-tall' : ''}`);
    if (onLabel) {
      label.type = 'button';
      label.title = `Fly to ${text}`;
      label.addEventListener('click', onLabel);
    }
    const name = el('span', 'r1-ts-label-name', text);
    const sub = el('span', 'r1-ts-label-sub', scope);
    label.append(name, sub);
    const svg = svgEl('svg', { class: `r1-ts-lane${tall ? ' is-tall' : ''}`, viewBox: '0 0 1000 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    svg.dataset.lane = key;
    const value = el('div', `r1-ts-value${tall ? ' is-tall' : ''}`, '—');
    labels.append(label);
    plot.append(svg);
    values.append(value);
    lanes.set(key, { label, svg, value, sub });
  }
  addLane('fires', 'FIRES', { tall: true, scope: '24 H · GLOBAL' });
  addLane('quakes', 'QUAKES M2.5+', { tall: true, scope: '24 H · GLOBAL' });
  for (const gate of gdelt.gates) {
    addLane(`gate:${gate.id}`, gate.name.replace(/ & approaches$/, '').toUpperCase(), {
      scope: 'NEWS SHARE',
      onLabel: () => viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(gate.lon, gate.lat, GATE_FOCUS_HEIGHT_M),
        duration: 1.6,
      }),
    });
  }
  plot.append(cursorLine, axis, range);
  // Spacer rows keep the label/value columns level with the axis + range.
  labels.append(el('div', 'r1-ts-axis-spacer'));
  values.append(el('div', 'r1-ts-axis-spacer'));

  const foot = el('footer', 'r1-ts-foot');
  const liveOnly = el('span', 'r1-ts-live-only', '');
  const status = el('span', 'r1-ts-status', '');
  const sources = el('span', 'r1-ts-sources', 'MEASURED · NASA FIRMS · USGS · GDELT');
  foot.append(liveOnly, status, sources);

  root.append(defs, head, body, foot);
  document.body.append(root);

  // ── geometry ──────────────────────────────────────────────────────────────
  function placeAboveDock() {
    const dock = document.getElementById('command-dock');
    const rect = dock?.getBoundingClientRect();
    const gap = 8;
    const bottom = rect && rect.height > 0 ? Math.max(gap, window.innerHeight - rect.top + gap) : 96;
    root.style.setProperty('--r1-ts-bottom', `${Math.round(bottom)}px`);
  }

  const frac = (ms, state) => (ms - state.startMs) / Math.max(1, state.endMs - state.startMs);

  function computeBox() {
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return null;
    const west = Cesium.Math.toDegrees(rect.west);
    const east = Cesium.Math.toDegrees(rect.east);
    const south = Cesium.Math.toDegrees(rect.south);
    const north = Cesium.Math.toDegrees(rect.north);
    const lonSpan = west <= east ? east - west : 360 - (west - east);
    // A near-hemisphere view is "global" — say so rather than call it a view.
    if (lonSpan > 160 || north - south > 120) return null;
    return { west, south, east, north };
  }

  // ── lanes ─────────────────────────────────────────────────────────────────
  function gapRects(svg, state, coverageAt, height) {
    const hours = Math.ceil((state.endMs - state.startMs) / HOUR_MS);
    let runStart = null;
    const flush = (endIndex) => {
      if (runStart === null) return;
      const x0 = (runStart / hours) * 1000;
      const x1 = (endIndex / hours) * 1000;
      svg.append(svgEl('rect', { x: x0, y: 0, width: Math.max(1, x1 - x0), height, fill: 'url(#r1-ts-hatch)' }));
      runStart = null;
    };
    for (let i = 0; i < hours; i += 1) {
      const t = Math.min(state.endMs, state.startMs + (i + 1) * HOUR_MS);
      const cov = coverageAt(t);
      if (cov === 'full') flush(i);
      else if (runStart === null) runStart = i;
    }
    flush(hours);
  }

  function drawBars(svg, valuesList, color) {
    const n = valuesList.length;
    const max = Math.max(1, ...valuesList.filter((v) => Number.isFinite(v)));
    const w = 1000 / Math.max(1, n);
    for (let i = 0; i < n; i += 1) {
      const v = valuesList[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      const h = Math.max(2, (v / max) * 92);
      svg.append(svgEl('rect', { x: i * w, y: 100 - h, width: Math.max(0.6, w * 0.82), height: h, fill: color, class: 'r1-ts-bar' }));
    }
    return max;
  }

  function renderFiresLane(state) {
    const lane = lanes.get('fires');
    lane.svg.replaceChildren();
    const meta = firms.meta;
    lane.sub.textContent = `24 H · ${box && firms.loaded ? 'IN VIEW' : 'GLOBAL'}`;
    if (!meta) return;
    if (meta.status === 'no-key' || meta.status === 'unavailable') return;
    gapRects(lane.svg, state, (t) => firms.coverage(t, LAYER_WINDOW_MS), 100);
    const series = firms.rollingCounts({ startMs: state.startMs, endMs: state.endMs, box: firms.loaded ? box : null });
    if (series) {
      lane.series = series.values;
      drawBars(lane.svg, series.values, 'var(--layer-fires)');
    }
  }

  function renderQuakesLane(state) {
    const lane = lanes.get('quakes');
    lane.svg.replaceChildren();
    lane.sub.textContent = `24 H · ${box ? 'IN VIEW' : 'GLOBAL'}`;
    if (!quakes.loaded) return;
    gapRects(lane.svg, state, (t) => quakes.coverage(t, LAYER_WINDOW_MS), 100);
    const series = quakes.rollingCounts({ startMs: state.startMs, endMs: state.endMs, box });
    lane.series = series?.values || null;
    // Events as ticks: when each quake happened, tall by magnitude.
    for (const f of quakes.features) {
      const t = f.properties.time;
      if (t < state.startMs || t > state.endMs) continue;
      const [lon, lat] = f.geometry?.coordinates || [];
      if (box && !(lat >= box.south && lat <= box.north
        && (box.west <= box.east ? lon >= box.west && lon <= box.east : lon >= box.west || lon <= box.east))) continue;
      const mag = Number(f.properties.mag) || 2.5;
      const h = Math.max(14, Math.min(96, (mag - 2) * 19));
      const x = frac(t, state) * 1000;
      lane.svg.append(svgEl('line', { x1: x, x2: x, y1: 100, y2: 100 - h, stroke: quakeColor(mag), class: 'r1-ts-tick' }));
    }
  }

  function renderGateLanes(state) {
    for (const gate of gdelt.gates) {
      const lane = lanes.get(`gate:${gate.id}`);
      lane.svg.replaceChildren();
      const pts = gate.points.filter((p) => p.t >= state.startMs - HOUR_MS && p.t <= state.endMs);
      if (!pts.length) continue;
      const max = Math.max(...pts.map((p) => p.value), 1e-9);
      lane.max = max;
      let d = '';
      let prevT = null;
      for (const p of pts) {
        const x = Math.max(0, frac(p.t, state)) * 1000;
        const y = 96 - (p.value / max) * 88;
        // A gap of more than 3 h in the series is a break, not a slope.
        d += `${prevT === null || p.t - prevT > 3 * HOUR_MS ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
        prevT = p.t;
      }
      lane.svg.append(svgEl('path', { d, class: 'r1-ts-line' }));
    }
  }

  function renderAxis(state) {
    axis.replaceChildren();
    const firstMidnight = Math.ceil(state.startMs / DAY_MS) * DAY_MS;
    for (let t = firstMidnight; t < state.endMs; t += DAY_MS) {
      const tick = el('span', 'r1-ts-axis-tick', formatCursorUtc(t).slice(0, 6));
      tick.style.left = `${(frac(t, state) * 100).toFixed(3)}%`;
      axis.append(tick);
    }
  }

  function renderLanes() {
    const state = cursor.getState();
    renderFiresLane(state);
    renderQuakesLane(state);
    renderGateLanes(state);
    renderAxis(state);
    lanesDirty = false;
    renderCursor();
  }

  // ── cursor readout ────────────────────────────────────────────────────────
  function seriesAt(series, state) {
    if (!Array.isArray(series) || !series.length) return null;
    // Bar i covers the 24 h ending at start + (i+1)h, i.e. cursor (i+1)h.
    const i = state.live ? series.length - 1 : Math.round((state.cursorMs - state.startMs) / HOUR_MS) - 1;
    return i >= 0 && i < series.length ? series[i] : null;
  }

  function layerEnabled(id) {
    try { return Boolean(dataManager.isEnabled(id)); } catch { return false; }
  }

  function renderValues(state) {
    const T = state.live ? state.endMs : state.cursorMs;
    // Fires
    const firesLane = lanes.get('fires');
    const meta = firms.meta;
    let firesText;
    if (!meta) firesText = 'LOADING';
    else if (meta.status === 'no-key') firesText = 'KEY REQUIRED';
    else if (meta.status === 'unavailable') firesText = 'UNAVAILABLE';
    else {
      const cov = firms.coverage(T, LAYER_WINDOW_MS);
      // Exact count of what the map draws once the detections are here; the
      // hourly-binned lane value only until then.
      const v = firms.loaded ? firms.countInWindow(T, LAYER_WINDOW_MS, box) : seriesAt(firesLane.series, state);
      firesText = cov === 'none' && !state.live ? 'NO DATA' : `${fmtCount(v)}${cov === 'partial' && !state.live ? ' · PARTIAL' : ''}`;
    }
    firesLane.value.textContent = firesText;
    firesLane.value.dataset.state = /KEY|UNAVAIL|NO DATA/.test(firesText) ? 'alert' : (/PARTIAL|LOADING/.test(firesText) ? 'caution' : '');
    // Quakes
    const quakesLane = lanes.get('quakes');
    let quakesText;
    if (quakes.error && !quakes.loaded) quakesText = 'UNAVAILABLE';
    else if (!quakes.loaded) quakesText = 'LOADING';
    else quakesText = fmtCount(quakes.countInWindow(T, LAYER_WINDOW_MS, box));
    quakesLane.value.textContent = quakesText;
    quakesLane.value.dataset.state = quakesText === 'UNAVAILABLE' ? 'alert' : (quakesText === 'LOADING' ? 'caution' : '');
    // Gates
    for (const gate of gdelt.gates) {
      const lane = lanes.get(`gate:${gate.id}`);
      let text;
      if (gate.status === 'loading' || gate.status === 'idle') text = 'LOADING';
      else if (gate.status === 'unavailable') text = 'UNAVAILABLE';
      else {
        const hit = gdelt.valueAt(gate, T);
        text = hit ? `${hit.value.toFixed(2)}%` : 'NO DATA';
      }
      lane.value.textContent = text;
      lane.value.dataset.state = /UNAVAIL|NO DATA/.test(text) ? 'alert' : (text === 'LOADING' ? 'caution' : '');
    }
    // Layers that do not move with the cursor.
    if (state.live) {
      liveOnly.textContent = '';
    } else {
      const names = (dataManager.getAll?.() || [])
        .filter((l) => l.enabled && l.showInTogglePanel !== false && !TIME_AWARE.has(l.id))
        .map((l) => String(l.name || l.id).toUpperCase());
      liveOnly.textContent = names.length ? `STILL LIVE, NOT TIME-SHIFTED: ${names.join(' · ')}` : '';
    }
    const off = [FIRES_ID, QUAKES_ID].filter((id) => !layerEnabled(id));
    const parts = [];
    if (meta?.status === 'building') {
      const done = (meta.days || []).filter((d) => d.ok).length;
      parts.push(`FIRE HISTORY BUILDING · ${done}/${(meta.days || []).length} DAYS`);
    } else if (firms.loading) {
      parts.push('DOWNLOADING FIRE HISTORY');
    } else if (firms.error) {
      parts.push(`FIRE HISTORY: ${firms.error.toUpperCase()}`);
    }
    if (!state.live && off.length) {
      parts.push(`TURN ON ${off.map((id) => (id === FIRES_ID ? 'FIRES' : 'EARTHQUAKES')).join(' + ')} TO SEE ${off.length > 1 ? 'THEM' : 'IT'} ON THE MAP`);
    }
    status.textContent = parts.join(' · ');
  }

  function renderCursor() {
    const state = cursor.getState();
    const hours = Math.ceil((state.endMs - state.startMs) / HOUR_MS);
    range.max = String(hours);
    const index = state.live ? hours : Math.round((state.cursorMs - state.startMs) / HOUR_MS);
    range.value = String(index);
    range.setAttribute('aria-valuetext', state.live ? 'Live' : `${formatCursorUtc(state.cursorMs)}, ${formatOffset(state.cursorMs, state.endMs)}`);
    const x = state.live ? 1 : frac(state.cursorMs, state);
    root.style.setProperty('--r1-ts-x', x.toFixed(5));
    root.dataset.live = state.live ? 'true' : 'false';
    when.textContent = state.live ? 'LIVE' : formatCursorUtc(state.cursorMs);
    offset.textContent = state.live ? '' : formatOffset(state.cursorMs, state.endMs);
    liveBtn.setAttribute('aria-pressed', state.live ? 'true' : 'false');
    fwdBtn.disabled = state.live;
    backBtn.disabled = !state.live && state.cursorMs <= state.startMs;
    toggleButton?.classList.toggle('is-historical', !state.live);
    renderValues(state);
  }

  // ── applying the cursor to layers ────────────────────────────────────────
  function moduleFor(id) {
    return dataManager.layers?.get?.(id)?.module || null;
  }

  function applyNow() {
    lastApplyAt = performance.now();
    const state = cursor.getState();
    const firesLayer = moduleFor(FIRES_ID);
    const quakesLayer = moduleFor(QUAKES_ID);
    if (state.live) {
      appliedFiresKey = null;
      if (firesLayer?.isHistorical?.()) firesLayer.showLive();
      if (quakesLayer?.isHistorical?.()) quakesLayer.showLive();
    } else {
      const T = state.cursorMs;
      const W = LAYER_WINDOW_MS;
      if (firesLayer && layerEnabled(FIRES_ID)) {
        if (firms.loaded) {
          // Same window, same data, already drawn: skip the ~100k-sprite rebuild
          // (the one-minute clock tick re-applies an unchanged cursor).
          const key = `${T}:${firms.dataVersion}`;
          if (key !== appliedFiresKey || !firesLayer.isHistorical()) {
            // A window no source could fetch draws nothing, and the lane and
            // value say NO DATA — the map must not read that as "no fires".
            const fires = firms.coverage(T, W) === 'none' ? [] : firms.windowFires(T, W);
            firesLayer.showHistoricalFires(fires || [], { endMs: T, spanMs: W });
            appliedFiresKey = key;
          }
        } else {
          void ensureFirmsData();
        }
      }
      if (quakesLayer && layerEnabled(QUAKES_ID)) {
        if (quakes.loaded) {
          quakesLayer.showHistoricalEvents(quakes.windowFeatures(T, W) || [], { endMs: T, spanMs: W });
        } else {
          void quakes.load().then(() => { lanesDirty = true; scheduleApply(); });
        }
      }
    }
    governorRequestRender('time-cursor');
    // The layer panel's FIRES row reads HISTORY while parked; repaint it when
    // that flips, not on every drag frame.
    if (state.live !== lastAppliedLive) {
      lastAppliedLive = state.live;
      dataManager._refreshTogglePanel?.();
    }
  }

  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    // A timer, not rAF: rAF is paused in a background tab, and a parked cursor
    // must still reach the layers (the scene renders on the governor's request).
    const wait = Math.max(0, 120 - (performance.now() - lastApplyAt));
    setTimeout(() => {
      applyQueued = false;
      if (lanesDirty && open) renderLanes();
      applyNow();
    }, wait);
  }

  cursor.subscribe(() => {
    renderCursor();
    scheduleApply();
  });

  // ── loading ───────────────────────────────────────────────────────────────
  async function ensureFirmsData() {
    if (firms.loading) return;
    const before = firms.loaded;
    await firms.loadData();
    lastDataLoadAt = Date.now();
    if (firms.loaded !== before || firms.loaded) {
      lanesDirty = true;
      scheduleApply();
    }
  }

  async function pollMeta() {
    clearTimeout(metaTimer);
    if (!open) return;
    const prevVersion = firms.meta?.version;
    const meta = await firms.loadMeta();
    if (meta.version !== prevVersion) lanesDirty = true;
    const building = meta.status === 'building';
    const shouldReload = meta.status !== 'no-key' && meta.status !== 'unavailable'
      && (!firms.loaded || (firms.stale && (!building || Date.now() - lastDataLoadAt > DATA_RELOAD_MIN_MS)));
    if (shouldReload) await ensureFirmsData();
    if (lanesDirty) renderLanes();
    else renderValues(cursor.getState());
    metaTimer = setTimeout(pollMeta, building ? META_POLL_BUILDING_MS : META_POLL_READY_MS);
  }

  function startLoads() {
    void pollMeta();
    void quakes.load().then(() => { lanesDirty = true; if (open) renderLanes(); scheduleApply(); });
    gdelt.reset();
    void gdelt.load(() => { if (open) { renderGateLanes(cursor.getState()); renderValues(cursor.getState()); } });
  }

  // ── controls ──────────────────────────────────────────────────────────────
  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    playBtn.querySelector('span').textContent = 'play_arrow';
    playBtn.setAttribute('aria-label', 'Play forward');
    playBtn.title = 'Play forward';
  }

  function startPlay() {
    if (cursor.getState().live) cursor.setCursor(cursor.getState().startMs);
    playBtn.querySelector('span').textContent = 'pause';
    playBtn.setAttribute('aria-label', 'Pause');
    playBtn.title = 'Pause';
    playTimer = setInterval(() => {
      const next = cursor.stepBy(1);
      if (next.live) stopPlay();
    }, PLAY_STEP_MS);
  }

  head.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act !== 'play') stopPlay();
    if (act === 'back') cursor.stepBy(-1);
    else if (act === 'fwd') cursor.stepBy(1);
    else if (act === 'live') cursor.goLive();
    else if (act === 'play') (playTimer ? stopPlay() : startPlay());
    else if (act === 'close') setOpen(false);
  });

  range.addEventListener('input', () => {
    stopPlay();
    const state = cursor.getState();
    const index = Number(range.value);
    if (index >= Number(range.max)) cursor.goLive();
    else cursor.setCursor(state.startMs + index * HOUR_MS);
  });

  let dragging = false;
  const fromPointer = (event) => {
    const rect = plot.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const state = cursor.getState();
    if (f >= 0.999) cursor.goLive();
    else cursor.setCursor(state.startMs + f * (state.endMs - state.startMs));
  };
  plot.addEventListener('pointerdown', (event) => {
    if (event.target === range) return;
    stopPlay();
    dragging = true;
    plot.setPointerCapture?.(event.pointerId);
    fromPointer(event);
  });
  plot.addEventListener('pointermove', (event) => { if (dragging) fromPointer(event); });
  const endDrag = () => { dragging = false; };
  plot.addEventListener('pointerup', endDrag);
  plot.addEventListener('pointercancel', endDrag);

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
  });

  // Re-sync when a time-aware layer is switched on while the cursor is parked.
  dataManager.subscribe?.((change) => {
    if (!open || !TIME_AWARE.has(change?.layerId)) return;
    if (!cursor.getState().live) scheduleApply();
    renderValues(cursor.getState());
  });

  function onMoveEnd() {
    const next = computeBox();
    if (JSON.stringify(next) === JSON.stringify(box)) return;
    box = next;
    lanesDirty = true;
    if (open) renderLanes();
  }

  function setOpen(next, { at = null } = {}) {
    next = Boolean(next);
    if (next === open) {
      if (next && Number.isFinite(at)) cursor.setCursor(at);
      return;
    }
    open = next;
    root.hidden = !open;
    toggleButton?.setAttribute('aria-pressed', open ? 'true' : 'false');
    toggleButton?.setAttribute('aria-label', open ? 'Close time slider' : 'Open time slider');
    if (open) {
      placeAboveDock();
      box = computeBox();
      lanesDirty = true;
      cursor.tick();
      renderLanes();
      startLoads();
      if (!removeMoveEnd) removeMoveEnd = viewer.camera.moveEnd.addEventListener(onMoveEnd);
      clockTimer = setInterval(() => { lanesDirty = true; cursor.tick(); if (lanesDirty) renderLanes(); }, 60_000);
      if (Number.isFinite(at)) cursor.setCursor(at);
    } else {
      stopPlay();
      clearTimeout(metaTimer);
      clearInterval(clockTimer);
      removeMoveEnd?.();
      removeMoveEnd = null;
      // Closing returns the map to live: no past picture without the strip.
      cursor.goLive();
      applyNow();
    }
  }

  toggleButton?.addEventListener('click', () => setOpen(!open));
  window.addEventListener('resize', () => { if (open) placeAboveDock(); });

  // URL front door: `?time` opens live, `?at=` opens parked.
  const params = new URLSearchParams(search || '');
  const atParam = params.get('at');
  const at = atParam ? parseTimeParam(atParam, Date.now()) : null;
  if (params.has('time') || Number.isFinite(at)) {
    setOpen(true, { at });
  }

  return {
    open: (opts) => setOpen(true, opts),
    close: () => setOpen(false),
    isOpen: () => open,
    setCursor: (ms) => cursor.setCursor(ms),
    goLive: () => cursor.goLive(),
    getState: () => ({ ...cursor.getState(), open, firms: firms.meta?.status ?? null, firmsLoaded: firms.loaded, quakesLoaded: quakes.loaded, gates: gdelt.gates.map((g) => ({ id: g.id, status: g.status, points: g.points.length })) }),
  };
}
