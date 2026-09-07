/**
 * @file The block vocabulary an explanation is composed from.
 *
 * The console already answers operator questions honestly — every engine in
 * `src/portfolio/` returns `null` where nothing was measured and tags what it
 * did with a confidence. Until now that all collapsed into one spoken
 * sentence, which throws away the part an operator actually needs: *why*, and
 * *what the claim rests on*.
 *
 * A brief is therefore not prose. It is an ordered list of typed blocks, each
 * carrying its own provenance, that a renderer draws as an annotated board.
 * The blocks are plain data with no DOM in sight, so composition is testable
 * in node and the same document could be drawn by any surface.
 *
 * Two rules hold across every block:
 *  - A value that was not measured is `null`, and renders as an em dash.
 *    Never zero, never a plausible placeholder.
 *  - Every claim names a source and a kind. A block that cannot say where its
 *    number came from does not belong on the board.
 *
 * @module explain/blocks
 */

/**
 * How a number or claim came to exist. `tone` selects the semantic colour in
 * DESIGN-V5 §03 — the chromatic budget is spent here and nowhere else.
 *
 * @type {Readonly<Record<string, {label: string, tone: string, note: string}>>}
 */
export const PROVENANCE = Object.freeze({
  measured: Object.freeze({
    label: 'Measured',
    tone: 'signal',
    note: 'Read from a live feed',
  }),
  derived: Object.freeze({
    label: 'Derived',
    tone: 'signal',
    note: 'Computed from measured inputs by a stated rule',
  }),
  ranked: Object.freeze({
    label: 'Ranked',
    tone: 'caution',
    note: 'Ordering convention over measured inputs — no fitted coefficient',
  }),
  modelled: Object.freeze({
    label: 'Modelled',
    tone: 'caution',
    note: 'Fitted estimate carrying a stated error',
  }),
  parameterised: Object.freeze({
    label: 'Parameterised',
    tone: 'caution',
    note: 'Looked up from a fixed library, not composed',
  }),
  unmeasured: Object.freeze({
    label: 'Unmeasured',
    tone: 'ghost',
    note: 'No value exists yet — deliberately blank',
  }),
  unavailable: Object.freeze({
    label: 'Unavailable',
    tone: 'alert',
    note: 'The feed could not answer',
  }),
});

/** Block types a renderer must know how to draw. */
export const BLOCK_TYPES = Object.freeze([
  'head',
  'verdict',
  'readouts',
  'evidence',
  'chain',
  'ranked',
  'multiples',
  'band',
  'plays',
  'coverage',
  'sources',
  'gap',
  'note',
]);

const BLOCK_TYPE_SET = new Set(BLOCK_TYPES);

/** Stage states in a `chain` block. */
export const CHAIN_STATES = Object.freeze(['met', 'unmet', 'pending', 'na']);

/** The em dash every absent value renders as. One character, one meaning. */
export const NO_VALUE = '—';

/**
 * Resolve a provenance descriptor, falling back to `unmeasured` rather than
 * inventing a confident-looking default for an unknown key.
 * @param {string} kind
 * @returns {{key: string, label: string, tone: string, note: string}}
 */
export function provenance(kind) {
  const key = PROVENANCE[kind] ? kind : 'unmeasured';
  return { key, ...PROVENANCE[key] };
}

/**
 * Map an engine's own confidence string onto a provenance key. The engines
 * predate this module and each phrases confidence slightly differently; this
 * is the one place that translation lives.
 * @param {string|null|undefined} confidence
 * @returns {string}
 */
export function provenanceForConfidence(confidence) {
  const raw = String(confidence || '').toLowerCase();
  if (!raw) return 'unmeasured';
  if (raw === 'measured') return 'measured';
  if (raw === 'unavailable' || raw === 'no-key' || raw === 'error') return 'unavailable';
  if (raw.includes('requires-actuals') || raw.includes('unmeasured')) return 'unmeasured';
  if (raw.includes('ranked')) return 'ranked';
  if (raw.includes('model')) return 'modelled';
  if (raw.includes('derived')) return 'derived';
  return 'modelled';
}

/* ── Formatting ───────────────────────────────────────────────────────────
 * Composers produce display strings so the renderer stays dumb, and so a
 * missing value is turned into an em dash exactly once, here.
 */

/**
 * Whether a value is a real number.
 *
 * `Number(null)`, `Number('')` and `Number(false)` are all `0`, so a bare
 * `Number.isFinite(Number(v))` would format an absent measurement as a
 * confident zero — the exact failure this module exists to prevent.
 *
 * @param {*} value
 * @returns {boolean}
 */
function finite(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return false;
  return Number.isFinite(Number(value));
}

/**
 * Integer with thousands separators, or the no-value dash.
 * @param {*} value
 * @returns {string}
 */
export function fmtInt(value) {
  return finite(value) ? Math.round(Number(value)).toLocaleString('en-US') : NO_VALUE;
}

/**
 * Fixed-precision number, or the no-value dash.
 * @param {*} value
 * @param {number} [digits]
 * @returns {string}
 */
export function fmtNum(value, digits = 1) {
  return finite(value) ? Number(value).toFixed(digits) : NO_VALUE;
}

/**
 * Whole US dollars, or the no-value dash.
 * @param {*} value
 * @returns {string}
 */
export function fmtUsd(value) {
  return finite(value) ? `$${Math.round(Number(value)).toLocaleString('en-US')}` : NO_VALUE;
}

/**
 * Signed cents against a reference. The sign is the message.
 * @param {*} value
 * @param {number} [digits]
 * @returns {string}
 */
export function fmtCentsSigned(value, digits = 1) {
  if (!finite(value)) return NO_VALUE;
  const n = Number(value);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}¢`;
}

/**
 * Metres below 1 km, kilometres above.
 * @param {*} value
 * @returns {string}
 */
export function fmtMeters(value) {
  if (!finite(value)) return NO_VALUE;
  const m = Number(value);
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * An `n/N` coverage string, or the dash when the denominator is unknown.
 * @param {*} n
 * @param {*} of
 * @returns {string}
 */
export function fmtRatio(n, of) {
  if (!finite(n) || !finite(of) || Number(of) === 0) return NO_VALUE;
  return `${Math.round(Number(n))}/${Math.round(Number(of))}`;
}

/**
 * Percentage from a 0–1 fraction, or the no-value dash.
 * @param {*} fraction
 * @returns {string}
 */
export function fmtPct(fraction) {
  return finite(fraction) ? `${Math.round(Number(fraction) * 100)}%` : NO_VALUE;
}

/* ── Block constructors ───────────────────────────────────────────────────
 * Thin on purpose: they normalise shape and nothing else, so a composer's
 * intent stays readable at the call site.
 */

/**
 * Board header: the question, the scope it was answered over, and whether the
 * run is still resolving.
 * @param {{question: string, scope?: string|null, status?: string, action?: string|null, at?: string|null}} props
 * @returns {object}
 */
export function head({ question, scope = null, status = 'pending', action = null, at = null }) {
  return { type: 'head', question: String(question || ''), scope, status, action, at };
}

/**
 * The answer in one sentence, with the kind of claim it is.
 * @param {{text: string, kind?: string, score?: {value: number|null, max?: number, label?: string}|null}} props
 * @returns {object}
 */
export function verdict({ text, kind = 'derived', score = null }) {
  return { type: 'verdict', text: String(text || ''), kind: provenance(kind).key, score };
}

/**
 * A row of labelled readouts. Values arrive pre-formatted.
 * @param {{items: Array<{label: string, value: string, unit?: string|null, kind?: string}>}} props
 * @returns {object}
 */
export function readouts({ items }) {
  return {
    type: 'readouts',
    items: (items || []).map((item) => ({
      label: String(item.label || ''),
      value: item.value === null || item.value === undefined ? NO_VALUE : String(item.value),
      unit: item.unit || null,
      kind: provenance(item.kind || 'measured').key,
    })),
  };
}

/**
 * The narration contract made visible: every clause of the answer beside the
 * engine that produced it and the kind of claim it is. This is the block the
 * whole board exists for.
 * @param {{title?: string, rows: Array<{claim: string, source: string, kind: string}>}} props
 * @returns {object}
 */
export function evidence({ title = 'Chain of custody', rows }) {
  return {
    type: 'evidence',
    title,
    rows: (rows || []).map((row) => ({
      claim: String(row.claim || ''),
      source: String(row.source || ''),
      kind: provenance(row.kind).key,
    })),
  };
}

/**
 * The reasoning as a diagram: ordered stages from signal to outcome, each
 * either satisfied, not satisfied, still resolving, or not applicable.
 * @param {{title?: string, stages: Array<{key?: string, label: string, value?: string|null, state?: string, note?: string|null}>}} props
 * @returns {object}
 */
export function chain({ title = 'How this was reached', stages }) {
  return {
    type: 'chain',
    title,
    stages: (stages || []).map((stage, index) => ({
      key: stage.key || String(index + 1).padStart(2, '0'),
      label: String(stage.label || ''),
      value: stage.value === undefined ? null : stage.value,
      state: CHAIN_STATES.includes(stage.state) ? stage.state : 'na',
      note: stage.note || null,
    })),
  };
}

/**
 * Ranked rows with a magnitude bar. `max` scales the bars; when absent the
 * renderer takes the largest row.
 * @param {{title?: string, unit?: string|null, max?: number|null, kind?: string, rows: object[]}} props
 * @returns {object}
 */
export function ranked({ title = 'Ranked', unit = null, max = null, kind = 'ranked', rows }) {
  return {
    type: 'ranked',
    title,
    unit,
    max,
    kind: provenance(kind).key,
    rows: (rows || []).map((row, index) => ({
      key: row.key || String.fromCharCode(65 + (index % 26)),
      label: String(row.label || ''),
      sub: row.sub || null,
      value: finite(row.value) ? Number(row.value) : null,
      display: row.display === undefined || row.display === null ? NO_VALUE : String(row.display),
      tone: row.tone || 'signal',
      focus: row.focus || null,
    })),
  };
}

/**
 * Small multiples: one tile per site or scenario, each with its own micro
 * chart. Keys match the `ranked` block so the two cross-reference.
 * @param {{title?: string, tiles: object[]}} props
 * @returns {object}
 */
export function multiples({ title = 'Per site', tiles }) {
  return {
    type: 'multiples',
    title,
    tiles: (tiles || []).map((tile, index) => ({
      key: tile.key || String.fromCharCode(65 + (index % 26)),
      label: String(tile.label || ''),
      sub: tile.sub || null,
      value: finite(tile.value) ? Number(tile.value) : null,
      display: tile.display === undefined || tile.display === null ? NO_VALUE : String(tile.display),
      unit: tile.unit || null,
      series: Array.isArray(tile.series) ? tile.series.filter(finite).map(Number) : null,
      tone: tile.tone || 'signal',
      focus: tile.focus || null,
    })),
  };
}

/**
 * A forecast band over an anchor level — the only chart in the vocabulary
 * that plots a range, because a point estimate would be a lie about the model.
 * @param {{title?: string, anchor: object, points: object[], baseline?: object|null, note?: string|null, kind?: string}} props
 * @returns {object}
 */
export function band({ title = 'Forecast', anchor, points, baseline = null, note = null, kind = 'modelled' }) {
  return {
    type: 'band',
    title,
    kind: provenance(kind).key,
    anchor: anchor || null,
    points: (points || [])
      .filter((point) => finite(point.mid) && finite(point.lo) && finite(point.hi))
      .map((point) => ({
        t: String(point.t || ''),
        mid: Number(point.mid),
        lo: Number(point.lo),
        hi: Number(point.hi),
      })),
    baseline,
    note,
  };
}

/**
 * Recommended plays. A card states what fires it, what it does, and — loudly —
 * that its lift has not been measured and that nothing executes without
 * approval.
 * @param {{title?: string, cards: object[]}} props
 * @returns {object}
 */
export function plays({ title = 'Plays', cards }) {
  return {
    type: 'plays',
    title,
    cards: (cards || []).map((card) => ({
      id: String(card.id || ''),
      name: String(card.name || ''),
      action: String(card.action || ''),
      rationale: card.rationale || null,
      lift: card.lift || { display: NO_VALUE, kind: 'unmeasured' },
      approval: card.approval === 'not-required' ? 'not-required' : 'required',
      triggers: (card.triggers || []).map((trigger) => ({
        label: String(trigger.label || ''),
        display: trigger.display === undefined || trigger.display === null ? NO_VALUE : String(trigger.display),
        met: trigger.met === null || trigger.met === undefined ? null : Boolean(trigger.met),
      })),
    })),
  };
}

/**
 * What the numbers above actually rest on. A rollup that averages the two
 * sites which happened to have data is the most dangerous output this product
 * can produce, so the denominator is never optional.
 * @param {{title?: string, bars: Array<{label: string, n: number|null, of: number|null, note?: string|null}>}} props
 * @returns {object}
 */
export function coverage({ title = 'What this rests on', bars }) {
  return {
    type: 'coverage',
    title,
    bars: (bars || []).map((bar) => ({
      label: String(bar.label || ''),
      n: finite(bar.n) ? Number(bar.n) : null,
      of: finite(bar.of) ? Number(bar.of) : null,
      note: bar.note || null,
    })),
  };
}

/**
 * Feed attribution for everything on the board.
 * @param {{items: Array<{label: string, detail?: string|null, at?: string|null}>}} props
 * @returns {object}
 */
export function sources({ items }) {
  return {
    type: 'sources',
    items: (items || []).map((item) => ({
      label: String(item.label || ''),
      detail: item.detail || null,
      at: item.at || null,
    })),
  };
}

/**
 * "Cannot tell" rendered as itself. The single most important block: an
 * unavailable feed must never reach an operator as a reassuring "no issues".
 * @param {{title: string, reason: string, missing?: string[], remedy?: string|null}} props
 * @returns {object}
 */
export function gap({ title, reason, missing = [], remedy = null }) {
  return {
    type: 'gap',
    title: String(title || 'Cannot answer'),
    reason: String(reason || ''),
    missing: (missing || []).map(String),
    remedy,
  };
}

/**
 * A sentence. Rare by design.
 * @param {{text: string, tone?: string}} props
 * @returns {object}
 */
export function note({ text, tone = 'dim' }) {
  return { type: 'note', text: String(text || ''), tone };
}

/**
 * Assign stable ids to a composed block list. Ids are deterministic —
 * `type:index` — so a later patch can address a block without the composer
 * having to invent identifiers.
 * @param {object[]} blocks
 * @returns {object[]}
 */
export function withIds(blocks) {
  return (blocks || []).filter(Boolean).map((block, index) => ({ id: `${block.type}:${index}`, ...block }));
}

/**
 * Structural check. Returns the problems found rather than throwing, so a
 * malformed block degrades to a skipped block instead of an empty board.
 * @param {object} block
 * @returns {string[]}
 */
export function validateBlock(block) {
  const problems = [];
  if (!block || typeof block !== 'object') return ['block is not an object'];
  if (!BLOCK_TYPE_SET.has(block.type)) problems.push(`unknown block type: ${String(block.type)}`);
  if (block.type === 'head' && !block.question) problems.push('head block has no question');
  if (block.type === 'verdict' && !block.text) problems.push('verdict block has no text');
  if (block.type === 'evidence' && (block.rows || []).some((row) => !row.source)) {
    problems.push('evidence row without a source');
  }
  if (block.type === 'gap' && !block.reason) problems.push('gap block has no reason');
  return problems;
}

/**
 * Validate a whole document.
 * @param {object[]} blocks
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateBlocks(blocks) {
  const problems = (blocks || []).flatMap((block, index) => validateBlock(block).map((p) => `[${index}] ${p}`));
  return { ok: problems.length === 0, problems };
}
