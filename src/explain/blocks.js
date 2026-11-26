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
  // Store-agent vocabulary: the operator's own transaction, member and
  // campaign surface, plus the creative the console actually publishes.
  'series',
  'roster',
  'campaigns',
  'creative',
  'surfaces',
  // Airspace vocabulary: a scrubbable multi-lane timeline, linked live
  // headlines, and a sourced event record.
  'timeline',
  'headlines',
  'dossier',
]);

const BLOCK_TYPE_SET = new Set(BLOCK_TYPES);

/**
 * An http(s) URL, normalised, or null. Links on the board come from feeds and
 * curated records; anything else (javascript:, data:, relative) is dropped
 * rather than rendered.
 * @param {*} value
 * @returns {string|null}
 */
export function safeLink(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

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
      url: safeLink(item.url),
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

/* -- Store-agent blocks ---------------------------------------------------
 * The five below carry the operator's own transaction and member surface.
 * They obey the same two rules as everything above: an unmeasured value is
 * null and renders as an em dash, and every block states its kind.
 */

/**
 * An ordered run of values over time -- days of a week, hours of a shift,
 * days of a campaign. Distinct from `ranked` because ORDER is the meaning
 * here: re-sorting a week by size destroys the thing being looked at.
 *
 * `compare` is the same point in the previous period, drawn as a ghost
 * behind the bar so a delta is visible rather than asserted.
 *
 * @param {{title?: string, unit?: string|null, kind?: string, points: object[], note?: string|null}} props
 * @returns {object}
 */
export function series({ title = 'Over time', unit = null, kind = 'measured', points, note: footnote = null }) {
  return {
    type: 'series',
    title,
    unit,
    kind: provenance(kind).key,
    note: footnote,
    points: (points || []).map((point) => ({
      label: String(point.label || ''),
      value: finite(point.value) ? Number(point.value) : null,
      display: point.display === undefined || point.display === null ? NO_VALUE : String(point.display),
      compare: finite(point.compare) ? Number(point.compare) : null,
      deltaPct: finite(point.deltaPct) ? Number(point.deltaPct) : null,
      tone: point.tone || 'signal',
      // A partial bar is hatched rather than drawn solid: today at 14:40 is
      // not a short day, it is an incomplete one, and the chart must not
      // read as the former.
      partial: Boolean(point.partial),
      sub: point.sub || null,
    })),
  };
}

/**
 * People and cohorts: member profiles, loyalty segments, a resolved
 * identity. Each card is a subject with a handful of labelled stats and
 * optional tags.
 *
 * @param {{title?: string, cards: object[], note?: string|null}} props
 * @returns {object}
 */
export function roster({ title = 'Members', cards, note: footnote = null }) {
  return {
    type: 'roster',
    title,
    note: footnote,
    cards: (cards || []).map((card, index) => ({
      key: card.key || String.fromCharCode(65 + (index % 26)),
      name: String(card.name || ''),
      sub: card.sub || null,
      badge: card.badge || null,
      tone: card.tone || 'signal',
      stats: (card.stats || []).map((stat) => ({
        label: String(stat.label || ''),
        value: stat.value === null || stat.value === undefined ? NO_VALUE : String(stat.value),
        kind: provenance(stat.kind || 'measured').key,
      })),
      tags: (card.tags || []).map(String),
      note: card.note || null,
      meter: finite(card.meter) ? Number(card.meter) : null,
    })),
  };
}

/**
 * Running campaigns. The one block in the vocabulary that deliberately shows
 * two provenances in one row: what the campaign HAS DONE (measured) beside
 * what it was FORECAST to do (modelled). Keeping them in separate columns is
 * the entire point -- "doing well" is the comparison, and a single blended
 * number would hide which half is which.
 *
 * @param {{title?: string, rows: object[], note?: string|null}} props
 * @returns {object}
 */
export function campaigns({ title = 'Campaigns running', rows, note: footnote = null }) {
  return {
    type: 'campaigns',
    title,
    note: footnote,
    rows: (rows || []).map((row, index) => ({
      key: row.key || String.fromCharCode(65 + (index % 26)),
      id: String(row.id || ''),
      name: String(row.name || ''),
      sub: row.sub || null,
      verdict: String(row.verdict || 'on-plan'),
      verdictLabel: String(row.verdictLabel || ''),
      tone: row.tone || 'ghost',
      // 0..1+ where 1 is "exactly on its forecast pace". The renderer draws
      // the plan line at 1 so over and under are read at a glance.
      paceRatio: finite(row.paceRatio) ? Number(row.paceRatio) : null,
      paceDisplay: row.paceDisplay === undefined || row.paceDisplay === null ? NO_VALUE : String(row.paceDisplay),
      measured: (row.measured || []).map((stat) => ({
        label: String(stat.label || ''),
        value: stat.value === null || stat.value === undefined ? NO_VALUE : String(stat.value),
      })),
      forecast: (row.forecast || []).map((stat) => ({
        label: String(stat.label || ''),
        value: stat.value === null || stat.value === undefined ? NO_VALUE : String(stat.value),
      })),
      trend: row.trend || null,
      advice: row.advice || null,
      spark: Array.isArray(row.spark) ? row.spark.filter(finite).map(Number) : null,
    })),
  };
}

/**
 * The advertisement itself, as it will appear on each screen.
 *
 * This block is a rendering instruction, not a measurement, so it carries no
 * provenance chip -- there is nothing to be right or wrong about in a piece
 * of artwork. The numbers that justify running it live in the blocks around
 * it.
 *
 * @param {{title?: string, cards: object[], note?: string|null}} props
 * @returns {object}
 */
export function creative({ title = 'Creative', cards, note: footnote = null }) {
  return {
    type: 'creative',
    title,
    note: footnote,
    cards: (cards || []).map((card) => ({
      surfaceId: String(card.surfaceId || ''),
      surfaceLabel: String(card.surfaceLabel || ''),
      where: card.where || null,
      aspect: Array.isArray(card.aspect) && card.aspect.length === 2
        ? [Number(card.aspect[0]) || 1, Number(card.aspect[1]) || 1]
        : [16, 9],
      motif: card.motif || 'points',
      palette: card.palette || { accent: '#62E0A8', ink: '#06080A', paper: '#E4EAEE' },
      brand: card.brand || null,
      storeNumber: card.storeNumber || null,
      value: card.value || null,
      kicker: card.kicker || null,
      headline: String(card.headline || ''),
      sub: card.sub || null,
      cta: card.cta || null,
      terms: card.terms || null,
      status: card.status || 'staged',
    })),
  };
}

/**
 * Where an offer is going, or has gone. Distribution state per screen,
 * including which pushes cannot be recalled -- an operator approving a
 * deployment is entitled to know which part of it is permanent.
 *
 * @param {{title?: string, rows: object[], note?: string|null}} props
 * @returns {object}
 */
export function surfaces({ title = 'Distribution', rows, note: footnote = null }) {
  return {
    type: 'surfaces',
    title,
    note: footnote,
    rows: (rows || []).map((row) => ({
      id: String(row.id || ''),
      label: String(row.label || ''),
      where: row.where || null,
      status: String(row.status || 'staged'),
      statusLabel: String(row.statusLabel || row.status || 'Staged'),
      tone: row.tone || 'ghost',
      impressions: row.impressions === null || row.impressions === undefined ? NO_VALUE : String(row.impressions),
      addressable: row.addressable === null || row.addressable === undefined ? NO_VALUE : String(row.addressable),
      timing: row.timing || null,
      irreversible: Boolean(row.irreversible),
      note: row.note || null,
    })),
  };
}

/* -- Airspace blocks -------------------------------------------------------
 * Time is the subject here, so these carry raw epoch-ms instants and raw
 * numbers for geometry, alongside display strings for anything printed as-is.
 * A lane whose feed could not answer says so in `status` and has no points —
 * it is never drawn as a flat zero line.
 */

const LANE_STATUSES = new Set(['ready', 'stale', 'partial', 'computing', 'unavailable']);

/**
 * A scrubbable timeline: stacked lanes over one time domain, shaded bands for
 * periods (a ground stop), lettered markers for reported moments, and the
 * program state recorded at each sample.
 *
 * @param {{
 *   key?: string, title?: string, domain: {from: number, to: number},
 *   lanes: Array<{id: string, label: string, sub?: string|null, kind?: string, status?: string, reason?: string|null,
 *     stepMs?: number|null, current?: string|null, points: Array<{t: number, value: number|null, compare?: number|null}>}>,
 *   bands?: Array<{from: number, to: number, label: string, tone?: string}>,
 *   markers?: Array<{key: string, t: number, label: string, detail?: string|null, sources?: Array<{outlet: string, url?: string|null}>}>,
 *   programs?: Array<{t: number, groundStops: number, groundDelays: number, delays: number, airports?: string[]}>,
 *   live?: {updatedAt: number|null, everyMs?: number|null},
 *   note?: string|null,
 * }} props
 * @returns {object}
 */
export function timeline({ key = 'timeline', title = 'Over time', domain, lanes, bands = [], markers = [], programs = [], live = null, note: footnote = null }) {
  const from = finite(domain?.from) ? Number(domain.from) : null;
  const to = finite(domain?.to) ? Number(domain.to) : null;
  return {
    type: 'timeline',
    key: String(key),
    title,
    domain: from !== null && to !== null && to > from ? { from, to } : null,
    note: footnote,
    lanes: (lanes || []).map((lane) => ({
      id: String(lane.id || ''),
      label: String(lane.label || ''),
      sub: lane.sub || null,
      kind: provenance(lane.kind || 'measured').key,
      status: LANE_STATUSES.has(lane.status) ? lane.status : 'unavailable',
      reason: lane.reason || null,
      stepMs: finite(lane.stepMs) ? Number(lane.stepMs) : null,
      current: lane.current === undefined || lane.current === null ? NO_VALUE : String(lane.current),
      points: (lane.points || [])
        .filter((point) => finite(point.t))
        .map((point) => ({
          t: Number(point.t),
          value: finite(point.value) ? Number(point.value) : null,
          compare: finite(point.compare) ? Number(point.compare) : null,
        }))
        .sort((a, b) => a.t - b.t),
    })),
    bands: (bands || [])
      .filter((item) => finite(item.from) && finite(item.to))
      .map((item) => ({ from: Number(item.from), to: Number(item.to), label: String(item.label || ''), tone: item.tone || 'alert' })),
    markers: (markers || [])
      .filter((item) => finite(item.t))
      .map((item) => ({
        key: String(item.key || ''),
        t: Number(item.t),
        label: String(item.label || ''),
        detail: item.detail || null,
        sources: (item.sources || []).map((src) => ({ outlet: String(src.outlet || ''), url: safeLink(src.url) })),
      }))
      .sort((a, b) => a.t - b.t),
    programs: (programs || [])
      .filter((item) => finite(item.t))
      .map((item) => ({
        t: Number(item.t),
        groundStops: finite(item.groundStops) ? Number(item.groundStops) : null,
        groundDelays: finite(item.groundDelays) ? Number(item.groundDelays) : null,
        delays: finite(item.delays) ? Number(item.delays) : null,
        airports: Array.isArray(item.airports) ? item.airports.map(String).slice(0, 12) : [],
      }))
      .sort((a, b) => a.t - b.t),
    live: live ? { updatedAt: finite(live.updatedAt) ? Number(live.updatedAt) : null, everyMs: finite(live.everyMs) ? Number(live.everyMs) : null } : null,
  };
}

/**
 * Linked headlines from a news index. Titles and outlets are the publisher's;
 * the board adds nothing but the time it was seen.
 * @param {{title?: string, status?: string, source?: string|null, fetchedAt?: string|null, items: Array<{title: string, url: string, outlet?: string|null, publishedAt?: string|null}>, note?: string|null}} props
 * @returns {object}
 */
export function headlines({ title = 'Latest coverage', status = 'ready', source = null, fetchedAt = null, items, note: footnote = null }) {
  return {
    type: 'headlines',
    title,
    status: LANE_STATUSES.has(status) || status === 'empty' ? status : 'unavailable',
    source,
    fetchedAt,
    note: footnote,
    items: (items || [])
      .map((item) => ({
        title: String(item.title || '').slice(0, 200),
        url: safeLink(item.url),
        outlet: item.outlet || null,
        publishedAt: item.publishedAt || null,
      }))
      .filter((item) => item.title && item.url),
  };
}

/**
 * A curated event record: labelled facts, each with the outlets that reported
 * it and any disagreement between them.
 * @param {{title: string, sub?: string|null, asOf?: string|null, items: Array<{label: string, text: string, note?: string|null, sources?: Array<{outlet: string, url?: string|null}>}>}} props
 * @returns {object}
 */
export function dossier({ title, sub = null, asOf = null, items }) {
  return {
    type: 'dossier',
    title: String(title || ''),
    sub,
    asOf,
    items: (items || []).map((item) => ({
      label: String(item.label || ''),
      text: String(item.text || ''),
      note: item.note || null,
      sources: (item.sources || []).map((src) => ({ outlet: String(src.outlet || ''), url: safeLink(src.url) })),
    })),
  };
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
  if (block.type === 'dossier' && (block.items || []).some((item) => !(item.sources || []).length)) {
    problems.push('dossier fact without a source');
  }
  if (block.type === 'timeline' && !block.domain) problems.push('timeline block has no time domain');
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
