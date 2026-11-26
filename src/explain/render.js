/**
 * @file Blocks → DOM.
 *
 * Dumb by design: every number arrives pre-formatted from a composer, so this
 * file decides geometry and nothing else. It follows DESIGN-V5 — opaque
 * plates, 1px hairlines, 2px radius, achromatic chrome with the semantic hues
 * spent only on provenance, and tabular monospace on every figure.
 *
 * Rendering is incremental: `renderExplain` reconciles by block id, so a board
 * whose price block arrives two seconds after its traffic block updates in
 * place instead of redrawing and losing the operator's scroll position.
 *
 * The DOM is injectable (`doc`) the same way `mapStackChips.js` does it, which
 * keeps the whole module testable under node with a small element stub.
 *
 * @module explain/render
 */

import { NO_VALUE, provenance } from './blocks.js';
import { AIRSPACE_RENDERERS } from './airspaceRender.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Resolve the document to build in. */
function ownerDocument(container, doc) {
  return doc || container?.ownerDocument || globalThis.document || null;
}

/**
 * Element helper: tag, class, text.
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(doc, tag, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

/** Append children, skipping nulls, and return the parent. */
function append(parent, ...children) {
  for (const child of children) if (child) parent.appendChild(child);
  return parent;
}

/**
 * A provenance chip. The only place chroma enters a block.
 * @param {Document} doc
 * @param {string} kind
 * @returns {HTMLElement}
 */
function kindChip(doc, kind) {
  const meta = provenance(kind);
  const chip = el(doc, 'span', 'xp-kind', meta.label);
  chip.dataset.tone = meta.tone;
  chip.title = meta.note;
  return chip;
}

/** Section header: a label and a hairline that fills the row. */
function sectionHead(doc, title) {
  const header = el(doc, 'div', 'xp-section');
  append(header, el(doc, 'span', 'xp-section-label', title), el(doc, 'span', 'xp-rule'));
  return header;
}

/** A 3px magnitude meter. Width only — no gradient, no glow. */
function meter(doc, fraction, tone = 'signal') {
  const track = el(doc, 'div', 'xp-meter');
  const fill = el(doc, 'div', 'xp-meter-fill');
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  fill.style.width = `${(clamped * 100).toFixed(1)}%`;
  fill.dataset.tone = tone;
  track.appendChild(fill);
  return track;
}

/** An A/B/C key badge, shared between ranked rows and their tiles. */
function keyBadge(doc, key) {
  return el(doc, 'span', 'xp-key', key);
}

/**
 * Make a row activate the camera when it carries a focus target.
 * @param {HTMLElement} node
 * @param {object|null} focus
 * @param {{onFocus?: (focus: object) => void}} ctx
 */
function wireFocus(node, focus, ctx) {
  if (!focus || typeof ctx?.onFocus !== 'function') return;
  node.dataset.focusable = 'true';
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.title = focus.label ? `Fly to ${focus.label}` : 'Fly to this location';
  const go = () => ctx.onFocus(focus);
  node.addEventListener?.('click', go);
  node.addEventListener?.('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      go();
    }
  });
}

/* ── Block renderers ─────────────────────────────────────────────────────── */

function renderHead(doc, block) {
  const node = el(doc, 'div', 'xp-head');
  const eyebrow = el(doc, 'div', 'xp-head-eyebrow');
  append(
    eyebrow,
    el(doc, 'span', 'xp-eyebrow-label', 'Explain'),
    block.action ? el(doc, 'span', 'xp-eyebrow-action', block.action.replace(/_/g, ' ')) : null,
  );
  const question = el(doc, 'h2', 'xp-head-question', block.question);
  const meta = el(doc, 'div', 'xp-head-meta');
  append(
    meta,
    block.scope ? el(doc, 'span', 'xp-head-scope', block.scope) : null,
    el(doc, 'span', 'xp-head-status', block.status === 'pending' ? 'Resolving' : block.status === 'error' ? 'Incomplete' : 'Resolved'),
  );
  meta.dataset.status = block.status || 'ready';
  return append(node, eyebrow, question, meta);
}

function renderVerdict(doc, block) {
  const node = el(doc, 'div', 'xp-verdict');
  const row = el(doc, 'div', 'xp-verdict-row');
  append(row, el(doc, 'p', 'xp-verdict-text', block.text), kindChip(doc, block.kind));
  append(node, row);

  if (block.score && Number.isFinite(block.score.value)) {
    const score = el(doc, 'div', 'xp-score');
    const max = Number.isFinite(block.score.max) ? block.score.max : 100;
    append(
      score,
      el(doc, 'span', 'xp-score-label', block.score.label || 'Score'),
      el(doc, 'span', 'xp-score-value', `${block.score.value}`),
      el(doc, 'span', 'xp-score-max', `/${max}`),
    );
    append(node, score, meter(doc, block.score.value / max, block.score.value >= 80 ? 'alert' : 'caution'));
  }
  return node;
}

function renderReadouts(doc, block) {
  const node = el(doc, 'div', 'xp-readouts');
  for (const item of block.items) {
    const cell = el(doc, 'div', 'xp-readout');
    cell.dataset.tone = provenance(item.kind).tone;
    const value = el(doc, 'div', 'xp-readout-value', item.value);
    if (item.unit) append(value, el(doc, 'span', 'xp-readout-unit', item.unit));
    append(cell, el(doc, 'div', 'xp-readout-label', item.label), value);
    append(node, cell);
  }
  return node;
}

function renderEvidence(doc, block) {
  const node = el(doc, 'div', 'xp-evidence');
  append(node, sectionHead(doc, block.title));
  for (const row of block.rows) {
    const line = el(doc, 'div', 'xp-ev-row');
    line.dataset.tone = provenance(row.kind).tone;
    append(
      line,
      el(doc, 'div', 'xp-ev-claim', row.claim),
      el(doc, 'div', 'xp-ev-source', row.source),
      kindChip(doc, row.kind),
    );
    append(node, line);
  }
  return node;
}

function renderChain(doc, block) {
  const node = el(doc, 'div', 'xp-chain');
  append(node, sectionHead(doc, block.title));
  const list = el(doc, 'ol', 'xp-chain-list');
  for (const stage of block.stages) {
    const item = el(doc, 'li', 'xp-stage');
    item.dataset.state = stage.state;
    const marker = el(doc, 'span', 'xp-stage-node');
    const body = el(doc, 'div', 'xp-stage-body');
    const headRow = el(doc, 'div', 'xp-stage-head');
    append(
      headRow,
      el(doc, 'span', 'xp-stage-key', stage.key),
      el(doc, 'span', 'xp-stage-label', stage.label),
      el(doc, 'span', 'xp-stage-value', stage.value === null ? NO_VALUE : String(stage.value)),
    );
    append(body, headRow, stage.note ? el(doc, 'div', 'xp-stage-note', stage.note) : null);
    append(item, marker, body);
    append(list, item);
  }
  return append(node, list);
}

function renderRanked(doc, block, ctx) {
  const node = el(doc, 'div', 'xp-ranked');
  append(node, sectionHead(doc, block.title));
  const values = block.rows.map((row) => row.value).filter(Number.isFinite);
  const max = Number.isFinite(block.max) ? block.max : (values.length ? Math.max(...values) : 0);

  for (const row of block.rows) {
    const line = el(doc, 'div', 'xp-rank-row');
    const label = el(doc, 'div', 'xp-rank-label');
    append(
      label,
      keyBadge(doc, row.key),
      el(doc, 'span', 'xp-rank-name', row.label),
    );
    const body = el(doc, 'div', 'xp-rank-body');
    append(
      body,
      label,
      row.sub ? el(doc, 'div', 'xp-rank-sub', row.sub) : null,
      max > 0 ? meter(doc, Number.isFinite(row.value) ? row.value / max : 0, row.tone) : null,
    );
    append(line, body, el(doc, 'div', 'xp-rank-value', row.display));
    wireFocus(line, row.focus, ctx);
    append(node, line);
  }
  return node;
}

function renderMultiples(doc, block, ctx) {
  const node = el(doc, 'div', 'xp-multiples');
  append(node, sectionHead(doc, block.title));
  const grid = el(doc, 'div', 'xp-tile-grid');
  for (const tile of block.tiles) {
    const cell = el(doc, 'div', 'xp-tile');
    cell.dataset.tone = tile.tone;
    const top = el(doc, 'div', 'xp-tile-top');
    append(top, keyBadge(doc, tile.key), el(doc, 'span', 'xp-tile-label', tile.label));
    const value = el(doc, 'div', 'xp-tile-value', tile.display);
    if (tile.unit) append(value, el(doc, 'span', 'xp-tile-unit', tile.unit));
    append(
      cell,
      top,
      value,
      Number.isFinite(tile.value) ? meter(doc, tile.value / 100, tile.tone) : null,
      tile.sub ? el(doc, 'div', 'xp-tile-sub', tile.sub) : null,
    );
    wireFocus(cell, tile.focus, ctx);
    append(grid, cell);
  }
  return append(node, grid);
}

/**
 * The forecast band. Drawn as SVG because a range over time is the one thing
 * in this vocabulary that a stack of divs cannot say honestly.
 */
function renderBand(doc, block) {
  const node = el(doc, 'div', 'xp-band');
  append(node, sectionHead(doc, block.title));

  const points = block.points || [];
  if (!doc.createElementNS || points.length === 0) {
    append(node, el(doc, 'div', 'xp-note', 'No forward band was produced.'));
    return node;
  }

  const width = 300;
  const height = 96;
  const padX = 8;
  const padY = 10;
  const anchorValue = Number.isFinite(block.anchor?.value) ? block.anchor.value : points[0].mid;
  const lows = points.map((point) => point.lo);
  const highs = points.map((point) => point.hi);
  const min = Math.min(anchorValue, ...lows);
  const max = Math.max(anchorValue, ...highs);
  const span = max - min || 1;

  const x = (index) => padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
  const y = (value) => height - padY - ((value - min) / span) * (height - padY * 2);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'xp-band-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${block.title}: band from ${Math.min(...lows).toFixed(2)} to ${Math.max(...highs).toFixed(2)}`);

  const anchorLine = doc.createElementNS(SVG_NS, 'line');
  anchorLine.setAttribute('x1', String(padX));
  anchorLine.setAttribute('x2', String(width - padX));
  anchorLine.setAttribute('y1', y(anchorValue).toFixed(2));
  anchorLine.setAttribute('y2', y(anchorValue).toFixed(2));
  anchorLine.setAttribute('class', 'xp-band-anchor');
  svg.appendChild(anchorLine);

  const area = doc.createElementNS(SVG_NS, 'polygon');
  const upper = points.map((point, index) => `${x(index).toFixed(2)},${y(point.hi).toFixed(2)}`);
  const lower = points.map((point, index) => `${x(index).toFixed(2)},${y(point.lo).toFixed(2)}`).reverse();
  area.setAttribute('points', [...upper, ...lower].join(' '));
  area.setAttribute('class', 'xp-band-area');
  svg.appendChild(area);

  const central = doc.createElementNS(SVG_NS, 'polyline');
  central.setAttribute('points', points.map((point, index) => `${x(index).toFixed(2)},${y(point.mid).toFixed(2)}`).join(' '));
  central.setAttribute('class', 'xp-band-line');
  svg.appendChild(central);

  append(node, svg);

  const axis = el(doc, 'div', 'xp-band-axis');
  for (const point of points) append(axis, el(doc, 'span', 'xp-band-tick', point.t));
  append(node, axis);

  const legend = el(doc, 'div', 'xp-band-legend');
  append(
    legend,
    block.anchor ? el(doc, 'span', 'xp-band-legend-item', `${block.anchor.label}: ${block.anchor.display}`) : null,
    block.baseline ? el(doc, 'span', 'xp-band-legend-item', `${block.baseline.label}: ${block.baseline.display}`) : null,
  );
  append(node, legend, block.note ? el(doc, 'div', 'xp-band-note', block.note) : null);
  return node;
}

function renderPlays(doc, block) {
  const node = el(doc, 'div', 'xp-plays');
  append(node, sectionHead(doc, block.title));
  for (const card of block.cards) {
    const item = el(doc, 'article', 'xp-play');
    const top = el(doc, 'div', 'xp-play-head');
    const approval = el(doc, 'span', 'xp-play-approval', card.approval === 'required' ? 'Approval required' : 'No approval needed');
    approval.dataset.tone = card.approval === 'required' ? 'caution' : 'ghost';
    append(top, el(doc, 'h4', 'xp-play-name', card.name), approval);

    const triggers = el(doc, 'ul', 'xp-triggers');
    for (const trigger of card.triggers) {
      const row = el(doc, 'li', 'xp-trigger');
      row.dataset.met = trigger.met === null ? 'unknown' : String(trigger.met);
      append(
        row,
        el(doc, 'span', 'xp-trigger-mark', trigger.met === null ? '?' : trigger.met ? '✓' : '×'),
        el(doc, 'span', 'xp-trigger-label', trigger.label),
        el(doc, 'span', 'xp-trigger-value', trigger.display),
      );
      append(triggers, row);
    }

    const lift = el(doc, 'div', 'xp-play-lift');
    append(
      lift,
      el(doc, 'span', 'xp-play-lift-label', 'Expected lift'),
      el(doc, 'span', 'xp-play-lift-value', card.lift.display),
      kindChip(doc, card.lift.kind),
    );

    append(
      item,
      top,
      el(doc, 'p', 'xp-play-action', card.action),
      card.rationale ? el(doc, 'p', 'xp-play-rationale', card.rationale) : null,
      card.triggers.length ? triggers : null,
      lift,
    );
    append(node, item);
  }
  return node;
}

function renderCoverage(doc, block) {
  const node = el(doc, 'div', 'xp-coverage');
  append(node, sectionHead(doc, block.title));
  for (const bar of block.bars) {
    const row = el(doc, 'div', 'xp-cov-row');
    const fraction = Number.isFinite(bar.n) && Number.isFinite(bar.of) && bar.of > 0 ? bar.n / bar.of : 0;
    const head = el(doc, 'div', 'xp-cov-head');
    append(
      head,
      el(doc, 'span', 'xp-cov-label', bar.label),
      el(doc, 'span', 'xp-cov-value', Number.isFinite(bar.n) && Number.isFinite(bar.of) ? `${bar.n}/${bar.of}` : NO_VALUE),
    );
    append(
      row,
      head,
      meter(doc, fraction, fraction >= 0.66 ? 'signal' : fraction > 0 ? 'caution' : 'alert'),
      bar.note ? el(doc, 'div', 'xp-cov-note', bar.note) : null,
    );
    append(node, row);
  }
  return node;
}

function renderSources(doc, block) {
  const node = el(doc, 'div', 'xp-sources');
  append(node, sectionHead(doc, 'Sources'));
  const list = el(doc, 'ul', 'xp-source-list');
  for (const item of block.items) {
    const row = el(doc, 'li', 'xp-source');
    let label = el(doc, 'span', 'xp-source-label', item.label);
    if (item.url) {
      // Already filtered to http(s) by the block builder.
      label = el(doc, 'a', 'xp-source-label', item.label);
      label.setAttribute('href', item.url);
      label.setAttribute('target', '_blank');
      label.setAttribute('rel', 'noopener noreferrer');
    }
    append(
      row,
      label,
      item.detail ? el(doc, 'span', 'xp-source-detail', item.detail) : null,
    );
    append(list, row);
  }
  return append(node, list);
}

function renderGap(doc, block) {
  const node = el(doc, 'div', 'xp-gap');
  append(node, el(doc, 'h3', 'xp-gap-title', block.title), el(doc, 'p', 'xp-gap-reason', block.reason));
  if (block.missing?.length) {
    const list = el(doc, 'ul', 'xp-gap-missing');
    for (const missing of block.missing) append(list, el(doc, 'li', 'xp-gap-missing-item', missing));
    append(node, list);
  }
  if (block.remedy) append(node, el(doc, 'p', 'xp-gap-remedy', block.remedy));
  return node;
}

function renderNote(doc, block) {
  const node = el(doc, 'p', 'xp-note', block.text);
  node.dataset.tone = block.tone;
  return node;
}

/* -- Store-agent blocks -------------------------------------------------- */

/** Namespaced element with attributes. */
function svgEl(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

/** Namespaced text node. */
function svgText(doc, text, attrs = {}) {
  const node = svgEl(doc, 'text', attrs);
  node.textContent = String(text == null ? '' : text);
  return node;
}

function renderSeries(doc, block) {
  const node = el(doc, 'div', 'xp-series');
  append(node, sectionHead(doc, block.title));
  const points = block.points || [];
  if (points.length === 0) {
    append(node, el(doc, 'p', 'xp-note', 'Nothing to plot.'));
    return node;
  }

  const max = Math.max(
    1,
    ...points.map((point) => Math.max(point.value ?? 0, point.compare ?? 0)),
  );
  const chart = el(doc, 'div', 'xp-series-chart');
  for (const point of points) {
    const column = el(doc, 'div', 'xp-series-col');
    if (point.partial) column.dataset.partial = 'true';
    const stack = el(doc, 'div', 'xp-series-stack');

    // The prior period sits behind as a ghost outline. A delta the operator
    // can see beats a delta the board asserts.
    if (point.compare !== null) {
      const ghost = el(doc, 'div', 'xp-series-ghost');
      ghost.style.height = `${((point.compare / max) * 100).toFixed(1)}%`;
      ghost.title = `Prior period: ${point.compare}`;
      append(stack, ghost);
    }
    const bar = el(doc, 'div', 'xp-series-bar');
    bar.style.height = `${(((point.value ?? 0) / max) * 100).toFixed(1)}%`;
    bar.dataset.tone = point.tone;
    if (point.partial) bar.dataset.partial = 'true';
    bar.title = point.partial
      ? `${point.label}: ${point.display} so far (day not complete)`
      : `${point.label}: ${point.display}`;
    append(stack, bar);

    append(
      column,
      stack,
      el(doc, 'span', 'xp-series-value', point.display),
      point.deltaPct === null
        ? null
        : (() => {
          const delta = el(doc, 'span', 'xp-series-delta', `${point.deltaPct > 0 ? '+' : point.deltaPct < 0 ? '−' : ''}${Math.abs(point.deltaPct).toFixed(1)}%`);
          delta.dataset.tone = point.deltaPct > 1 ? 'signal' : point.deltaPct < -1 ? 'alert' : 'ghost';
          return delta;
        })(),
      el(doc, 'span', 'xp-series-label', point.label),
      point.sub ? el(doc, 'span', 'xp-series-sub', point.sub) : null,
    );
    append(chart, column);
  }

  append(node, chart);
  const footer = el(doc, 'div', 'xp-series-foot');
  append(footer, kindChip(doc, block.kind), block.note ? el(doc, 'span', 'xp-series-note', block.note) : null);
  return append(node, footer);
}

function renderRoster(doc, block) {
  const node = el(doc, 'div', 'xp-roster');
  append(node, sectionHead(doc, block.title));
  for (const card of block.cards) {
    const item = el(doc, 'article', 'xp-member');
    item.dataset.tone = card.tone;

    const top = el(doc, 'div', 'xp-member-head');
    append(
      top,
      keyBadge(doc, card.key),
      (() => {
        const identity = el(doc, 'div', 'xp-member-identity');
        append(
          identity,
          el(doc, 'h4', 'xp-member-name', card.name),
          card.sub ? el(doc, 'span', 'xp-member-sub', card.sub) : null,
        );
        return identity;
      })(),
      card.badge
        ? (() => {
          const badge = el(doc, 'span', 'xp-member-badge', card.badge);
          badge.dataset.tone = card.tone;
          return badge;
        })()
        : null,
    );
    append(item, top);

    if (card.meter !== null) append(item, meter(doc, card.meter, card.tone));

    if (card.stats.length) {
      const stats = el(doc, 'div', 'xp-member-stats');
      for (const stat of card.stats) {
        const cell = el(doc, 'div', 'xp-member-stat');
        append(
          cell,
          el(doc, 'span', 'xp-member-stat-label', stat.label),
          el(doc, 'span', 'xp-member-stat-value', stat.value),
        );
        cell.dataset.kind = stat.kind;
        append(stats, cell);
      }
      append(item, stats);
    }

    if (card.tags.length) {
      const tags = el(doc, 'div', 'xp-member-tags');
      for (const tag of card.tags) append(tags, el(doc, 'span', 'xp-member-tag', tag));
      append(item, tags);
    }

    if (card.note) append(item, el(doc, 'p', 'xp-member-note', card.note));
    append(node, item);
  }
  if (block.note) append(node, el(doc, 'p', 'xp-note', block.note));
  return node;
}

function renderCampaigns(doc, block) {
  const node = el(doc, 'div', 'xp-campaigns');
  append(node, sectionHead(doc, block.title));

  for (const row of block.rows) {
    const item = el(doc, 'article', 'xp-campaign');
    item.dataset.tone = row.tone;

    const top = el(doc, 'div', 'xp-campaign-head');
    const verdict = el(doc, 'span', 'xp-campaign-verdict', row.verdictLabel);
    verdict.dataset.tone = row.tone;
    append(
      top,
      keyBadge(doc, row.key),
      (() => {
        const identity = el(doc, 'div', 'xp-campaign-identity');
        append(
          identity,
          el(doc, 'h4', 'xp-campaign-name', row.name),
          row.sub ? el(doc, 'span', 'xp-campaign-sub', row.sub) : null,
        );
        return identity;
      })(),
      verdict,
    );
    append(item, top);

    // Pace against plan, with the plan drawn at 100%. Over and under are
    // then a glance rather than a subtraction.
    if (row.paceRatio !== null) {
      const pace = el(doc, 'div', 'xp-pace');
      const track = el(doc, 'div', 'xp-pace-track');
      const fill = el(doc, 'div', 'xp-pace-fill');
      const scale = Math.max(1.5, row.paceRatio);
      fill.style.width = `${Math.min(100, (row.paceRatio / scale) * 100).toFixed(1)}%`;
      fill.dataset.tone = row.tone;
      const plan = el(doc, 'div', 'xp-pace-plan');
      plan.style.left = `${((1 / scale) * 100).toFixed(1)}%`;
      plan.title = 'Forecast pace for the days elapsed';
      append(track, fill, plan);
      append(pace, track, el(doc, 'span', 'xp-pace-value', row.paceDisplay));
      append(item, pace);
    }

    // Measured and modelled sit in two labelled columns and never merge.
    const columns = el(doc, 'div', 'xp-campaign-cols');
    for (const [heading, stats, kind] of [
      ['Done', row.measured, 'measured'],
      ['Planned', row.forecast, 'modelled'],
    ]) {
      if (!stats.length) continue;
      const column = el(doc, 'div', 'xp-campaign-col');
      const columnHead = el(doc, 'div', 'xp-campaign-col-head');
      append(columnHead, el(doc, 'span', 'xp-campaign-col-label', heading), kindChip(doc, kind));
      append(column, columnHead);
      for (const stat of stats) {
        const line = el(doc, 'div', 'xp-campaign-stat');
        append(
          line,
          el(doc, 'span', 'xp-campaign-stat-label', stat.label),
          el(doc, 'span', 'xp-campaign-stat-value', stat.value),
        );
        append(column, line);
      }
      append(columns, column);
    }
    append(item, columns);

    if (row.trend) {
      const trend = el(doc, 'span', 'xp-campaign-trend', row.trend);
      append(item, trend);
    }
    if (row.advice) append(item, el(doc, 'p', 'xp-campaign-advice', row.advice));
    append(node, item);
  }

  if (block.note) append(node, el(doc, 'p', 'xp-note', block.note));
  return node;
}

/**
 * The motif mark that identifies what the offer is about at a glance.
 * Drawn in a 24x24 box so every layout can place it the same way.
 */
function motifMark(doc, motif, color) {
  const group = svgEl(doc, 'g', { fill: 'none', stroke: color, 'stroke-width': '1.6', 'stroke-linecap': 'square' });
  const paths = {
    coffee: ['M5 8h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z', 'M16 10h2a2.5 2.5 0 0 1 0 5h-2', 'M8 3v2.5', 'M12 3v2.5'],
    fuel: ['M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15', 'M4 20h11', 'M14 9h3l2 2v6a1.5 1.5 0 0 1-3 0v-4h-2', 'M7 7h5v4H7z'],
    wash: ['M6 13a6 6 0 0 1 12 0', 'M12 19v-9', 'M4 8l2 2', 'M20 8l-2 2', 'M12 3v3'],
    food: ['M4 16l8-11 8 11z', 'M7 16h10', 'M10 11h4'],
    // A tapered cup alone reads as a waste bin at small sizes, so the lid
    // and straw are what actually carry the meaning here.
    cold: ['M7 8h10l-1.2 11.5H8.2z', 'M5.5 6h13v2h-13z', 'M13.5 6V2.5h3'],
    points: ['M12 3l2.6 5.7L21 9.5l-4.5 4.4 1.1 6.1L12 17l-5.6 3 1.1-6.1L3 9.5l6.4-.8z'],
  }[motif] || ['M12 3l2.6 5.7L21 9.5l-4.5 4.4 1.1 6.1L12 17l-5.6 3 1.1-6.1L3 9.5l6.4-.8z'];
  for (const d of paths) group.appendChild(svgEl(doc, 'path', { d }));
  return group;
}

/**
 * Draw the advertisement.
 *
 * Each surface gets its own composition rather than one layout rescaled: a
 * canopy read at 40 mph and an app card read in the hand are different
 * design problems, and showing the same rectangle twice would hide the only
 * thing this panel exists to let an operator judge.
 *
 * @param {Document} doc
 * @param {object} card
 * @returns {Element|null}
 */
function renderAd(doc, card) {
  if (!doc.createElementNS) return null;
  const [aw, ah] = card.aspect;
  const width = 400;
  const height = Math.round((width * ah) / aw);
  const { accent, ink, paper } = card.palette;

  const svg = svgEl(doc, 'svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'xp-ad-canvas',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
    'aria-label': `${card.surfaceLabel} creative: ${card.headline}${card.value ? `, ${card.value}` : ''}`,
  });
  svg.appendChild(svgEl(doc, 'rect', { x: 0, y: 0, width, height, fill: ink }));

  const put = (node) => svg.appendChild(node);
  const label = (text, attrs) => put(svgText(doc, text, { 'font-family': 'IBM Plex Mono, monospace', ...attrs }));
  const display = (text, attrs) => put(svgText(doc, text, { 'font-family': 'Archivo, Helvetica Neue, sans-serif', 'font-weight': '700', ...attrs }));

  /** Break a headline onto at most `lines` rows without splitting words. */
  const wrap = (text, perLine, lines) => {
    const words = String(text).split(/\s+/);
    const rows = [];
    let current = '';
    for (const word of words) {
      if (!current) current = word;
      else if ((current + ' ' + word).length <= perLine) current += ` ${word}`;
      else { rows.push(current); current = word; }
      if (rows.length === lines) break;
    }
    if (current && rows.length < lines) rows.push(current);
    return rows;
  };

  if (card.surfaceId === 'canopy') {
    put(svgEl(doc, 'rect', { x: 0, y: 0, width: 10, height, fill: accent }));
    display(card.value || '', { x: 30, y: height * 0.62, 'font-size': height * 0.44, fill: accent, 'letter-spacing': '-2' });
    const valueWidth = (card.value || '').length * height * 0.24;
    const headlineX = 30 + valueWidth + 22;
    wrap(card.headline, 16, 2).forEach((line, index) => {
      display(line, { x: headlineX, y: height * 0.42 + index * height * 0.24, 'font-size': height * 0.19, fill: paper, 'letter-spacing': '0.5' });
    });
    put(svgEl(doc, 'line', { x1: 30, x2: width - 20, y1: height - 26, y2: height - 26, stroke: paper, 'stroke-opacity': '0.2' }));
    label(card.sub || '', { x: 30, y: height - 10, 'font-size': 10, fill: paper, 'fill-opacity': '0.65', 'letter-spacing': '2' });
    label(card.brand || '', { x: width - 20, y: height - 10, 'font-size': 10, fill: accent, 'letter-spacing': '1.5', 'text-anchor': 'end' });
    return svg;
  }

  if (card.surfaceId === 'pump-topper') {
    label(card.kicker || '', { x: width / 2, y: 34, 'font-size': 12, fill: accent, 'letter-spacing': '3', 'text-anchor': 'middle' });
    const mark = motifMark(doc, card.motif, accent);
    mark.setAttribute('transform', `translate(${width / 2 - 36} ${70}) scale(3)`);
    put(mark);
    display(card.value || '', { x: width / 2, y: height * 0.55, 'font-size': 92, fill: paper, 'text-anchor': 'middle', 'letter-spacing': '-3' });
    wrap(card.headline, 20, 2).forEach((line, index) => {
      display(line, { x: width / 2, y: height * 0.63 + index * 26, 'font-size': 21, fill: paper, 'text-anchor': 'middle' });
    });
    label(card.sub || '', { x: width / 2, y: height * 0.63 + 62, 'font-size': 12, fill: paper, 'fill-opacity': '0.6', 'text-anchor': 'middle' });
    if (card.cta) {
      put(svgEl(doc, 'rect', { x: 40, y: height - 76, width: width - 80, height: 40, fill: accent }));
      display(card.cta, { x: width / 2, y: height - 50, 'font-size': 16, fill: ink, 'text-anchor': 'middle', 'letter-spacing': '2' });
    }
    label(card.brand || '', { x: width / 2, y: height - 18, 'font-size': 10, fill: paper, 'fill-opacity': '0.45', 'text-anchor': 'middle', 'letter-spacing': '2' });
    return svg;
  }

  if (card.surfaceId === 'in-store-menu') {
    put(svgEl(doc, 'rect', { x: 0, y: 0, width, height: 6, fill: accent }));
    label(card.kicker || '', { x: 26, y: 40, 'font-size': 11, fill: accent, 'letter-spacing': '3' });
    // The value plate occupies the right third, so the headline column is
    // ~240px wide. At 23px Archivo bold that is about 14 characters a line
    // — wrapping any wider runs the copy under the plate.
    wrap(card.headline, 14, 3).forEach((line, index) => {
      display(line, { x: 26, y: 74 + index * 27, 'font-size': 23, fill: paper });
    });
    wrap(card.sub || '', 44, 2).forEach((line, index) => {
      label(line, { x: 26, y: 162 + index * 16, 'font-size': 11, fill: paper, 'fill-opacity': '0.6' });
    });
    put(svgEl(doc, 'rect', { x: width - 132, y: 44, width: 108, height: 78, fill: accent }));
    display(card.value || '', { x: width - 78, y: 98, 'font-size': 38, fill: ink, 'text-anchor': 'middle', 'letter-spacing': '-1' });
    const mark = motifMark(doc, card.motif, paper);
    mark.setAttribute('transform', `translate(${width - 118} ${height - 56}) scale(1.6)`);
    put(mark);
    label(card.terms || '', { x: 26, y: height - 16, 'font-size': 9, fill: paper, 'fill-opacity': '0.4' });
    return svg;
  }

  if (card.surfaceId === 'mobile-app') {
    put(svgEl(doc, 'rect', { x: 18, y: 18, width: width - 36, height: height - 36, fill: '#0D1216', stroke: accent, 'stroke-opacity': '0.4' }));
    put(svgEl(doc, 'rect', { x: 34, y: 40, width: Math.max(90, (card.kicker || '').length * 6.2), height: 20, fill: accent, 'fill-opacity': '0.16' }));
    label(card.kicker || '', { x: 42, y: 54, 'font-size': 9, fill: accent, 'letter-spacing': '1.6' });
    wrap(card.headline, 19, 3).forEach((line, index) => {
      display(line, { x: 34, y: 100 + index * 28, 'font-size': 24, fill: paper });
    });
    display(card.value || '', { x: 34, y: 216, 'font-size': 52, fill: accent, 'letter-spacing': '-2' });
    const mark = motifMark(doc, card.motif, accent);
    mark.setAttribute('transform', `translate(${width - 104} 150) scale(2.4)`);
    put(mark);
    wrap(card.sub || '', 46, 3).forEach((line, index) => {
      label(line, { x: 34, y: 248 + index * 15, 'font-size': 10.5, fill: paper, 'fill-opacity': '0.66' });
    });
    if (card.cta) {
      put(svgEl(doc, 'rect', { x: 34, y: height - 100, width: width - 68, height: 42, fill: accent }));
      display(card.cta, { x: width / 2, y: height - 73, 'font-size': 15, fill: ink, 'text-anchor': 'middle', 'letter-spacing': '1.6' });
    }
    wrap(card.terms || '', 62, 2).forEach((line, index) => {
      label(line, { x: 34, y: height - 40 + index * 12, 'font-size': 8.5, fill: paper, 'fill-opacity': '0.38' });
    });
    return svg;
  }

  if (card.surfaceId === 'register-prompt') {
    put(svgEl(doc, 'rect', { x: 0, y: 0, width, height: 34, fill: accent }));
    label(card.kicker || '', { x: 18, y: 22, 'font-size': 12, fill: ink, 'letter-spacing': '2.4' });
    wrap(card.headline, 16, 2).forEach((line, index) => {
      display(line, { x: 18, y: 92 + index * 32, 'font-size': 28, fill: paper });
    });
    display(card.value || '', { x: 18, y: height - 96, 'font-size': 64, fill: accent, 'letter-spacing': '-2' });
    label(card.sub || '', { x: 18, y: height - 66, 'font-size': 11, fill: paper, 'fill-opacity': '0.55' });
    if (card.cta) {
      put(svgEl(doc, 'rect', { x: 18, y: height - 54, width: width - 36, height: 38, fill: 'none', stroke: accent }));
      display(card.cta, { x: width / 2, y: height - 28, 'font-size': 15, fill: accent, 'text-anchor': 'middle', 'letter-spacing': '3' });
    }
    return svg;
  }

  // e-receipt: a torn strip, because that is what it is attached to.
  put(svgEl(doc, 'line', { x1: 0, x2: width, y1: 4, y2: 4, stroke: paper, 'stroke-opacity': '0.25', 'stroke-dasharray': '4 4' }));
  label(card.kicker || '', { x: 20, y: 34, 'font-size': 9.5, fill: accent, 'letter-spacing': '2.4' });
  wrap(card.headline, 26, 2).forEach((line, index) => {
    display(line, { x: 20, y: 62 + index * 22, 'font-size': 20, fill: paper });
  });
  display(card.value || '', { x: width - 20, y: 64, 'font-size': 34, fill: accent, 'text-anchor': 'end', 'letter-spacing': '-1' });
  label(card.terms || '', { x: 20, y: height - 14, 'font-size': 9, fill: paper, 'fill-opacity': '0.42' });
  return svg;
}

function renderCreative(doc, block) {
  const node = el(doc, 'div', 'xp-creative');
  append(node, sectionHead(doc, block.title));
  const grid = el(doc, 'div', 'xp-ad-grid');

  for (const card of block.cards) {
    const frame = el(doc, 'figure', 'xp-ad');
    frame.dataset.surface = card.surfaceId;
    const head = el(doc, 'figcaption', 'xp-ad-head');
    const status = el(doc, 'span', 'xp-ad-status', card.status === 'live' ? 'Live' : 'Staged');
    status.dataset.tone = card.status === 'live' ? 'signal' : 'ghost';
    append(head, el(doc, 'span', 'xp-ad-surface', card.surfaceLabel), status);

    const stage = el(doc, 'div', 'xp-ad-stage');
    stage.style.aspectRatio = `${card.aspect[0]} / ${card.aspect[1]}`;
    const ad = renderAd(doc, card);
    if (ad) append(stage, ad);
    else append(stage, el(doc, 'div', 'xp-ad-fallback', `${card.headline}${card.value ? ` — ${card.value}` : ''}`));

    append(frame, head, stage, card.where ? el(doc, 'p', 'xp-ad-where', card.where) : null);
    append(grid, frame);
  }

  append(node, grid);
  if (block.note) append(node, el(doc, 'p', 'xp-note', block.note));
  return node;
}

function renderSurfaces(doc, block) {
  const node = el(doc, 'div', 'xp-surfaces');
  append(node, sectionHead(doc, block.title));
  for (const row of block.rows) {
    const item = el(doc, 'div', 'xp-surface');
    item.dataset.status = row.status;

    const top = el(doc, 'div', 'xp-surface-head');
    const status = el(doc, 'span', 'xp-surface-status', row.statusLabel);
    status.dataset.tone = row.tone;
    append(top, el(doc, 'span', 'xp-surface-label', row.label), status);

    const stats = el(doc, 'div', 'xp-surface-stats');
    append(
      stats,
      el(doc, 'span', 'xp-surface-stat', `${row.impressions} impressions/day`),
      el(doc, 'span', 'xp-surface-stat', `${row.addressable} addressable`),
      row.timing ? el(doc, 'span', 'xp-surface-stat', row.timing) : null,
    );

    append(
      item,
      top,
      row.where ? el(doc, 'p', 'xp-surface-where', row.where) : null,
      stats,
      // A push that has gone out cannot be recalled, and the operator who
      // approved it is entitled to see that said plainly.
      row.irreversible
        ? (() => {
          const warn = el(doc, 'p', 'xp-surface-warn', row.note || 'This dispatch cannot be recalled.');
          warn.dataset.tone = 'caution';
          return warn;
        })()
        : row.note ? el(doc, 'p', 'xp-surface-note', row.note) : null,
    );
    append(node, item);
  }
  if (block.note) append(node, el(doc, 'p', 'xp-note', block.note));
  return node;
}

/** Dispatch table, so an unknown block type is a no-op rather than a crash. */
const RENDERERS = {
  head: renderHead,
  verdict: renderVerdict,
  readouts: renderReadouts,
  evidence: renderEvidence,
  chain: renderChain,
  ranked: renderRanked,
  multiples: renderMultiples,
  band: renderBand,
  plays: renderPlays,
  coverage: renderCoverage,
  sources: renderSources,
  gap: renderGap,
  note: renderNote,
  series: renderSeries,
  roster: renderRoster,
  campaigns: renderCampaigns,
  creative: renderCreative,
  surfaces: renderSurfaces,
  ...AIRSPACE_RENDERERS,
};

/**
 * Render one block into a wrapper carrying its identity and signature.
 * @param {object} block
 * @param {{doc?: Document, onFocus?: Function}} [ctx]
 * @returns {HTMLElement|null}
 */
export function renderBlock(block, ctx = {}) {
  const doc = ctx.doc || globalThis.document;
  if (!doc?.createElement || !block) return null;
  const renderer = RENDERERS[block.type];
  if (!renderer) return null;

  const wrapper = el(doc, 'section', 'xp-block');
  wrapper.dataset.blockType = block.type;
  wrapper.dataset.blockId = block.id || block.type;
  wrapper.dataset.sig = signatureOf(block);
  const body = renderer(doc, block, ctx);
  if (body) wrapper.appendChild(body);
  return wrapper;
}

/**
 * Cheap change detector. JSON is fine here — blocks are small, and an exact
 * comparison is worth more than a fast approximate one when the cost of a
 * false "unchanged" is a stale number on screen.
 * @param {object} block
 * @returns {string}
 */
export function signatureOf(block) {
  try {
    return JSON.stringify(block);
  } catch {
    return String(Date.now());
  }
}

/**
 * Reconcile a container against a document state.
 *
 * Blocks are matched by id: existing nodes whose signature is unchanged are
 * left alone (so scroll position and focus survive), changed ones are
 * replaced, new ones are appended, and blocks that disappeared are removed.
 *
 * @param {HTMLElement} container
 * @param {{blocks: object[], status?: string}} state
 * @param {{doc?: Document, onFocus?: Function}} [ctx]
 * @returns {number} Number of blocks now rendered.
 */
export function renderExplain(container, state, ctx = {}) {
  const doc = ownerDocument(container, ctx.doc);
  if (!container || !doc?.createElement) return 0;

  const blocks = state?.blocks || [];
  const wanted = new Map(blocks.map((block) => [block.id || block.type, block]));

  for (const child of [...(container.children || [])]) {
    if (!wanted.has(child.dataset?.blockId)) container.removeChild(child);
  }

  const existing = new Map(
    [...(container.children || [])].map((child) => [child.dataset?.blockId, child]),
  );

  let previous = null;
  for (const block of blocks) {
    const id = block.id || block.type;
    const current = existing.get(id);
    const signature = signatureOf(block);

    if (current && current.dataset.sig === signature) {
      previous = current;
      continue;
    }

    const next = renderBlock(block, { ...ctx, doc });
    if (!next) continue;
    if (current) {
      container.replaceChild(next, current);
    } else if (previous && previous.nextSibling) {
      container.insertBefore(next, previous.nextSibling);
    } else {
      container.appendChild(next);
    }
    previous = next;
  }

  if (container.dataset) container.dataset.status = state?.status || 'idle';
  return blocks.length;
}
