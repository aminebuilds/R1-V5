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
    append(
      row,
      el(doc, 'span', 'xp-source-label', item.label),
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
