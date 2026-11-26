/**
 * @file Renderers for the airspace blocks: `timeline`, `headlines`, `dossier`.
 *
 * The timeline is the one interactive chart on the board. Lanes share a time
 * domain; a range input scrubs a cursor across all of them at once and the
 * readout row prints what every feed said at that instant — the departures
 * bin against the same half-hour the day before, the nearest airborne sample,
 * the FAA programs recorded with it, and which reported moment it falls after.
 *
 * Live behaviour: the board re-composes the block every minute while it is
 * open. A cursor parked at the right edge follows "now"; a cursor the operator
 * moved stays where they put it across refreshes (state keyed by `block.key`,
 * not the positional block id, which shifts as other blocks come and go).
 *
 * Geometry follows DESIGN-V5: 1px non-scaling hairlines, data in the aircraft
 * layer hue, the semantic alert tone only on the ground-stop band, labels in
 * HTML (never stretched SVG text), tabular figures throughout.
 *
 * @module explain/airspaceRender
 */

import { NO_VALUE, provenance } from './blocks.js';
import { etHour, fmtEt, fmtEtTick } from '../airspace/etTime.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1000;
const VIEW_H = 100;
const SAMPLE_REACH_MS = 30 * 60_000;
const number = new Intl.NumberFormat('en-US');

/** Cursor state per timeline key: `{follow: boolean, t: number|null}`. */
const scrubState = new Map();

/** Test hook. */
export function resetTimelineScrub() {
  scrubState.clear();
}

function el(doc, tag, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function append(parent, ...children) {
  for (const child of children) if (child) parent.appendChild(child);
  return parent;
}

function svgEl(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

function sectionHead(doc, title) {
  const header = el(doc, 'div', 'xp-section');
  append(header, el(doc, 'span', 'xp-section-label', title), el(doc, 'span', 'xp-rule'));
  return header;
}

function kindChip(doc, kind) {
  const meta = provenance(kind);
  const chip = el(doc, 'span', 'xp-kind', meta.label);
  chip.dataset.tone = meta.tone;
  chip.title = meta.note;
  return chip;
}

/** An outbound link, or plain text when there is nothing to link to. */
function sourceLink(doc, text, url, className) {
  if (!url) return el(doc, 'span', className, text);
  const link = el(doc, 'a', className, text);
  link.setAttribute('href', url);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  return link;
}

function sourceLinks(doc, sources, className = 'xp-src-links') {
  if (!sources?.length) return null;
  const row = el(doc, 'span', className);
  sources.forEach((src, index) => {
    if (index) append(row, el(doc, 'span', 'xp-src-sep', ' · '));
    append(row, sourceLink(doc, src.outlet, src.url, 'xp-src-link'));
  });
  return row;
}

const fmtNum = (value) => (Number.isFinite(value) ? number.format(Math.round(value)) : NO_VALUE);

/* ── Timeline ─────────────────────────────────────────────────────────── */

/** Axis tick spacing for a span, in hours. */
function tickHours(spanMs) {
  const hours = spanMs / 3600_000;
  if (hours <= 18) return 2;
  if (hours <= 36) return 3;
  if (hours <= 80) return 6;
  if (hours <= 170) return 12;
  return 24;
}

/** Tick instants on whole Eastern hours that divide the tick step (3, 6 PM…). */
export function timelineTicks(from, to) {
  const step = tickHours(to - from) * 3600_000;
  const ticks = [];
  let t = Math.ceil(from / 3600_000) * 3600_000;
  while (t <= to && etHour(t) % (step / 3600_000) !== 0) t += 3600_000;
  for (; t <= to; t += step) ticks.push(t);
  return ticks;
}

/** The step-path (or polyline) for one series. */
function seriesPath(points, key, x, y, stepMs) {
  let d = '';
  let open = false;
  points.forEach((point, index) => {
    const value = point[key];
    if (!Number.isFinite(value)) { open = false; return; }
    const px = x(point.t).toFixed(1);
    const py = y(value).toFixed(1);
    if (stepMs) {
      const end = x(point.t + stepMs).toFixed(1);
      d += `${open ? 'L' : 'M'}${px},${py}L${end},${py}`;
      // Bins are contiguous; a missing neighbour breaks the line.
      open = Boolean(points[index + 1] && points[index + 1].t === point.t + stepMs);
    } else {
      // Samples more than an hour apart are a gap in observation, not a slope.
      const gap = index > 0 && point.t - points[index - 1].t > 2 * SAMPLE_REACH_MS;
      d += `${open && !gap ? 'L' : 'M'}${px},${py}`;
      open = true;
    }
  });
  return d;
}

/**
 * Which of two rows each marker key sits on. Keys closer than ~4% of the
 * domain would print on top of each other, so a crowded key drops to the
 * second row (alternating, so three close keys still separate).
 * @param {Array<{t: number}>} markers Sorted by time.
 * @param {number} span Domain length in ms.
 * @returns {number[]}
 */
export function markerRows(markers, span) {
  const rows = [];
  markers.forEach((marker, index) => {
    const prev = markers[index - 1];
    const crowded = prev && span > 0 && (marker.t - prev.t) / span < 0.04;
    rows.push(crowded ? (rows[index - 1] === 0 ? 1 : 0) : 0);
  });
  return rows;
}

/** Value text for a lane at an instant. */
export function laneValueAt(lane, t, { atLiveEdge = false } = {}) {
  if (lane.status === 'computing' || lane.status === 'unavailable' || !lane.points.length) return NO_VALUE;
  if (lane.stepMs) {
    const bin = lane.points.find((point) => point.t <= t && t < point.t + lane.stepMs);
    if (!bin) return NO_VALUE;
    const ratio = Number.isFinite(bin.compare) && bin.compare > 0 ? ` (${Math.round((bin.value / bin.compare) * 100)}%)` : '';
    return `${fmtNum(bin.value)} vs ${fmtNum(bin.compare)}${ratio}`;
  }
  let nearest = null;
  for (const point of lane.points) {
    if (point.t <= t) nearest = point;
    else break;
  }
  if (nearest && t - nearest.t <= SAMPLE_REACH_MS) return `${fmtNum(nearest.value)} · ${fmtEt(nearest.t)}`;
  if (atLiveEdge && lane.current && lane.current !== NO_VALUE) return lane.current;
  return NO_VALUE;
}

/** FAA program state recorded nearest before an instant. */
export function programsAt(programs, t) {
  let nearest = null;
  for (const sample of programs) {
    if (sample.t <= t) nearest = sample;
    else break;
  }
  if (!nearest || t - nearest.t > SAMPLE_REACH_MS) return null;
  return nearest;
}

function renderTimeline(doc, block) {
  const node = el(doc, 'div', 'xp-tl');
  append(node, sectionHead(doc, block.title));
  if (!block.domain) {
    append(node, el(doc, 'p', 'xp-note', 'No time window to draw.'));
    return node;
  }
  const { from, to } = block.domain;
  const span = to - from;
  const x = (t) => ((t - from) / span) * VIEW_W;
  const pct = (t) => `${Math.max(0, Math.min(100, ((t - from) / span) * 100)).toFixed(2)}%`;
  const inDomain = (t) => t >= from && t <= to;

  // Live row: whether the cursor is following now, and when the board last refreshed.
  const liveRow = el(doc, 'div', 'xp-tl-live');
  const liveState = el(doc, 'span', 'xp-tl-live-state');
  const liveMeta = el(doc, 'span', 'xp-tl-live-meta', block.live?.updatedAt ? `Refreshed ${fmtEt(block.live.updatedAt)}` : '');
  const nowBtn = el(doc, 'button', 'xp-tl-now', 'Now');
  nowBtn.setAttribute('type', 'button');
  append(liveRow, liveState, liveMeta, nowBtn);
  append(node, liveRow);

  const cursors = [];
  const laneValues = [];

  // Marker keys sit above the lanes, each a button that jumps the cursor.
  const keys = el(doc, 'div', 'xp-tl-keys');
  const markers = block.markers.filter((marker) => inDomain(marker.t));
  const rows = markerRows(markers, span);
  if (rows.some((row) => row > 0)) keys.dataset.rows = '2';
  markers.forEach((marker, index) => {
    const key = el(doc, 'button', 'xp-tl-key', marker.key);
    key.setAttribute('type', 'button');
    key.dataset.row = String(rows[index]);
    key.style.left = pct(marker.t);
    key.title = `${marker.key} · ${fmtEt(marker.t, { day: true })} · ${marker.label}`;
    key.addEventListener?.('click', () => setCursor(marker.t, false));
    append(keys, key);
  });
  if (markers.length) append(node, keys);

  for (const lane of block.lanes) {
    const laneNode = el(doc, 'div', 'xp-tl-lane');
    laneNode.dataset.status = lane.status;
    const headRow = el(doc, 'div', 'xp-tl-lane-head');
    const value = el(doc, 'span', 'xp-tl-lane-value', NO_VALUE);
    laneValues.push({ lane, value });
    append(headRow, el(doc, 'span', 'xp-tl-lane-label', lane.label), value, kindChip(doc, lane.status === 'unavailable' ? 'unavailable' : lane.kind));
    append(laneNode, headRow);
    if (lane.sub) append(laneNode, el(doc, 'div', 'xp-tl-lane-sub', lane.sub));

    const plot = el(doc, 'div', 'xp-tl-plot');
    const svg = svgEl(doc, 'svg', { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    for (const band of block.bands) {
      if (band.to < from || band.from > to) continue;
      const bx = x(Math.max(band.from, from));
      append(svg, svgEl(doc, 'rect', { class: 'xp-tl-band', 'data-tone': band.tone, x: bx.toFixed(1), y: 0, width: Math.max(1, x(Math.min(band.to, to)) - bx).toFixed(1), height: VIEW_H }));
    }
    for (const marker of markers) {
      append(svg, svgEl(doc, 'line', { class: 'xp-tl-mark', x1: x(marker.t).toFixed(1), x2: x(marker.t).toFixed(1), y1: 0, y2: VIEW_H, 'vector-effect': 'non-scaling-stroke' }));
    }

    const plotted = lane.points.filter((point) => point.t + (lane.stepMs || 0) >= from && point.t <= to);
    if (plotted.length && lane.status !== 'computing' && lane.status !== 'unavailable') {
      const max = Math.max(1, ...plotted.map((point) => Math.max(point.value ?? 0, point.compare ?? 0)));
      const y = (v) => VIEW_H - 4 - (v / max) * (VIEW_H - 12);
      if (plotted.some((point) => Number.isFinite(point.compare))) {
        append(svg, svgEl(doc, 'path', { class: 'xp-tl-compare', d: seriesPath(plotted, 'compare', x, y, lane.stepMs), 'vector-effect': 'non-scaling-stroke' }));
      }
      append(svg, svgEl(doc, 'path', { class: 'xp-tl-line', d: seriesPath(plotted, 'value', x, y, lane.stepMs), 'vector-effect': 'non-scaling-stroke' }));
      append(plot, el(doc, 'span', 'xp-tl-ymax', fmtNum(max)));
      if (!lane.stepMs) {
        // Sample points as HTML ticks: SVG circles would stretch with the plot.
        for (const point of plotted) {
          const dot = el(doc, 'span', 'xp-tl-dot');
          dot.style.left = pct(point.t);
          dot.style.top = `${((y(point.value ?? 0) / VIEW_H) * 100).toFixed(2)}%`;
          append(plot, dot);
        }
      }
    } else {
      append(plot, el(doc, 'span', 'xp-tl-empty', lane.reason || 'No data.'));
    }
    const cursor = svgEl(doc, 'line', { class: 'xp-tl-cursor', x1: 0, x2: 0, y1: 0, y2: VIEW_H, 'vector-effect': 'non-scaling-stroke' });
    cursors.push(cursor);
    append(svg, cursor);
    append(plot, svg);
    // Press and drag across any lane to scrub. Pointer events rather than
    // `click`: the globe's gesture handling can swallow synthesized clicks.
    const scrubFromPointer = (event) => {
      const rect = plot.getBoundingClientRect?.();
      if (!rect?.width) return;
      setCursor(from + ((event.clientX - rect.left) / rect.width) * span, false);
    };
    plot.addEventListener?.('pointerdown', (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      plot.setPointerCapture?.(event.pointerId);
      plot.dataset.dragging = 'true';
      scrubFromPointer(event);
    });
    plot.addEventListener?.('pointermove', (event) => {
      if (plot.dataset.dragging === 'true') scrubFromPointer(event);
    });
    const endDrag = (event) => {
      plot.dataset.dragging = 'false';
      plot.releasePointerCapture?.(event.pointerId);
    };
    plot.addEventListener?.('pointerup', endDrag);
    plot.addEventListener?.('pointercancel', endDrag);
    append(laneNode, plot);
    append(node, laneNode);
  }

  // Axis: ticks on whole Eastern hours, the weekday at midnight.
  const axis = el(doc, 'div', 'xp-tl-axis');
  for (const tick of timelineTicks(from, to)) {
    const label = el(doc, 'span', 'xp-tl-tick', fmtEtTick(tick));
    label.style.left = pct(tick);
    append(axis, label);
  }
  append(node, axis);

  const scrub = el(doc, 'input', 'r1-quantitative-slider xp-tl-scrub');
  scrub.setAttribute('type', 'range');
  scrub.setAttribute('min', '0');
  scrub.setAttribute('max', '1000');
  scrub.setAttribute('step', '1');
  scrub.setAttribute('aria-label', 'Scrub the airspace timeline');
  append(node, scrub);

  const readout = el(doc, 'div', 'xp-tl-readout');
  const readTime = el(doc, 'span', 'xp-tl-read-time');
  const readPhase = el(doc, 'span', 'xp-tl-read-phase');
  const readPrograms = el(doc, 'span', 'xp-tl-read-programs');
  append(readout, readTime, readPhase, readPrograms);
  append(node, readout);

  // The reported moments, in order, each with its sources.
  if (markers.length) {
    const list = el(doc, 'ol', 'xp-tl-events');
    for (const marker of markers) {
      const row = el(doc, 'li', 'xp-tl-event');
      const jump = el(doc, 'button', 'xp-key xp-tl-event-key', marker.key);
      jump.setAttribute('type', 'button');
      jump.title = 'Move the cursor here';
      jump.addEventListener?.('click', () => setCursor(marker.t, false));
      const body = el(doc, 'div', 'xp-tl-event-body');
      append(
        body,
        append(el(doc, 'div', 'xp-tl-event-head'), el(doc, 'span', 'xp-tl-event-time', fmtEt(marker.t, { day: true })), el(doc, 'span', 'xp-tl-event-label', marker.label)),
        marker.detail ? el(doc, 'div', 'xp-tl-event-detail', marker.detail) : null,
        sourceLinks(doc, marker.sources),
      );
      append(row, jump, body);
      append(list, row);
    }
    append(node, list);
  }

  if (block.note) append(node, el(doc, 'p', 'xp-tl-note', block.note));

  function setCursor(t, follow) {
    const clamped = Math.max(from, Math.min(to, t));
    scrubState.set(block.key, { follow: Boolean(follow), t: clamped });
    const position = x(clamped).toFixed(1);
    for (const cursor of cursors) {
      cursor.setAttribute('x1', position);
      cursor.setAttribute('x2', position);
    }
    scrub.value = String(Math.round(((clamped - from) / span) * 1000));
    const label = fmtEt(clamped, { day: true });
    scrub.setAttribute('aria-valuetext', label || '');
    node.dataset.follow = follow ? 'true' : 'false';
    liveState.textContent = follow ? 'Live' : 'Scrubbing';
    liveState.dataset.state = follow ? 'live' : 'scrub';
    nowBtn.hidden = Boolean(follow);

    for (const { lane, value } of laneValues) value.textContent = laneValueAt(lane, clamped, { atLiveEdge: follow });

    readTime.textContent = label || NO_VALUE;
    // End-exclusive: at the lift instant the stop is over.
    const band = block.bands.find((item) => clamped >= item.from && clamped < item.to);
    const lastMarker = [...markers].reverse().find((marker) => marker.t <= clamped);
    readPhase.textContent = band ? `Inside: ${band.label}` : lastMarker ? `After ${lastMarker.key} · ${lastMarker.label}` : '';
    readPhase.dataset.tone = band ? band.tone : 'dim';
    const programs = programsAt(block.programs, clamped);
    readPrograms.textContent = programs
      ? `FAA: ${programs.groundStops ?? NO_VALUE} stops · ${programs.groundDelays ?? NO_VALUE} delay programs · ${programs.delays ?? NO_VALUE} delays${programs.airports?.length ? ` (${programs.airports.slice(0, 5).join(', ')})` : ''}`
      : 'FAA programs: not sampled at this time';
  }

  scrub.addEventListener?.('input', () => {
    const fraction = Number(scrub.value) / 1000;
    setCursor(from + fraction * span, fraction >= 0.999);
  });
  nowBtn.addEventListener?.('click', () => setCursor(to, true));

  const saved = scrubState.get(block.key);
  if (saved && !saved.follow && Number.isFinite(saved.t)) setCursor(saved.t, false);
  else setCursor(to, true);

  return node;
}

/* ── Headlines ───────────────────────────────────────────────────────── */

function relativeAge(iso, now = Date.now()) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return fmtEt(ms, { day: true });
}

function renderHeadlines(doc, block) {
  const node = el(doc, 'div', 'xp-headlines');
  append(node, sectionHead(doc, block.title));
  const meta = el(doc, 'div', 'xp-hl-meta-row');
  append(
    meta,
    el(doc, 'span', 'xp-hl-source', [block.source, block.fetchedAt ? `read ${block.fetchedAt}` : null].filter(Boolean).join(' · ')),
    kindChip(doc, block.status === 'stale' ? 'unavailable' : 'measured'),
  );
  append(node, meta);
  if (!block.items.length) {
    append(node, el(doc, 'p', 'xp-note', 'No matching articles in the last 72 hours.'));
  } else {
    const list = el(doc, 'ul', 'xp-hl-list');
    for (const item of block.items) {
      const row = el(doc, 'li', 'xp-hl');
      append(
        row,
        sourceLink(doc, item.title, item.url, 'xp-hl-title'),
        el(doc, 'span', 'xp-hl-meta', [item.outlet, relativeAge(item.publishedAt)].filter(Boolean).join(' · ')),
      );
      append(list, row);
    }
    append(node, list);
  }
  if (block.note) {
    const footnote = el(doc, 'p', 'xp-note', block.note);
    footnote.dataset.tone = 'caution';
    append(node, footnote);
  }
  return node;
}

/* ── Dossier ─────────────────────────────────────────────────────────── */

function renderDossier(doc, block) {
  const node = el(doc, 'div', 'xp-dossier');
  append(node, sectionHead(doc, block.title));
  if (block.sub) append(node, el(doc, 'p', 'xp-dz-sub', block.sub));
  for (const item of block.items) {
    const row = el(doc, 'div', 'xp-dz-row');
    append(
      row,
      el(doc, 'div', 'xp-dz-label', item.label),
      el(doc, 'div', 'xp-dz-text', item.text),
      item.note ? el(doc, 'div', 'xp-dz-note', item.note) : null,
      sourceLinks(doc, item.sources),
    );
    append(node, row);
  }
  if (block.asOf) append(node, el(doc, 'p', 'xp-dz-asof', `Record checked ${block.asOf}. Newer reporting appears under Latest coverage.`));
  return node;
}

export const AIRSPACE_RENDERERS = Object.freeze({
  timeline: renderTimeline,
  headlines: renderHeadlines,
  dossier: renderDossier,
});
