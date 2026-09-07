/**
 * @file AG-UI-shaped event stream for composed explanations.
 *
 * The board is not rendered from a return value; it is rendered from a stream
 * of typed events, because the engines behind an answer resolve at different
 * speeds. Traffic flow lands in a few hundred milliseconds, a price model
 * takes a network round trip, and a disruption index depends on whether the
 * vessel layer is even loaded. A single awaited object would make the operator
 * stare at nothing until the slowest input returned, and would throw away the
 * fact that some of the answer was already known.
 *
 * The vocabulary is deliberately the Agent-User Interaction protocol's:
 * `RUN_STARTED`, `STEP_STARTED`, `TEXT_MESSAGE_CONTENT`, `STATE_DELTA` (RFC
 * 6902 patches), `CUSTOM`, `RUN_FINISHED`. Nothing is imported to achieve that
 * — this project has no framework and AG-UI's packages are TypeScript/React
 * oriented — but the shape is the protocol's, so a real transport (an SSE
 * endpoint from a server-side agent) can be dropped in front of this reducer
 * without the renderer changing.
 *
 * Everything here is pure except `createExplainStream`, which is a small
 * emitter. That keeps the protocol node-testable.
 *
 * @module explain/agui
 */

/** Event types this client understands. AG-UI names, verbatim. */
export const EVENT = Object.freeze({
  RUN_STARTED: 'RUN_STARTED',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  STEP_STARTED: 'STEP_STARTED',
  STEP_FINISHED: 'STEP_FINISHED',
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_END: 'TOOL_CALL_END',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  STATE_DELTA: 'STATE_DELTA',
  CUSTOM: 'CUSTOM',
});

/** `CUSTOM` event names carrying generative-UI payloads. */
export const CUSTOM_EVENT = Object.freeze({
  BLOCK: 'explain.block',
  BLOCKS: 'explain.blocks',
  SCOPE: 'explain.scope',
});

const EVENT_SET = new Set(Object.values(EVENT));

/**
 * The document a renderer draws.
 * @returns {object}
 */
export function initialExplainState() {
  return {
    runId: null,
    action: null,
    status: 'idle',
    question: '',
    scope: null,
    message: '',
    steps: [],
    blocks: [],
    toolCalls: [],
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Whether a value is a well-formed protocol event.
 * @param {*} event
 * @returns {boolean}
 */
export function isExplainEvent(event) {
  return Boolean(event) && typeof event === 'object' && EVENT_SET.has(event.type);
}

/* ── RFC 6902, the three operations this client needs ───────────────────── */

/** Unescape a JSON Pointer token (`~1` → `/`, `~0` → `~`). */
function decodeToken(token) {
  return String(token).replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Split a JSON Pointer into tokens. `''` addresses the whole document.
 * @param {string} pointer
 * @returns {string[]}
 */
export function parsePointer(pointer) {
  const raw = String(pointer == null ? '' : pointer);
  if (raw === '') return [];
  if (!raw.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${raw}`);
  return raw.slice(1).split('/').map(decodeToken);
}

/**
 * Apply one RFC 6902 operation in place. Only `add`, `replace` and `remove`
 * are supported — the other four have no use here, and silently accepting
 * them would let a malformed patch look like it applied.
 *
 * @param {object} document Mutated.
 * @param {{op: string, path: string, value?: *}} operation
 * @returns {object} The same document.
 */
export function applyOperation(document, operation) {
  const { op, path, value } = operation || {};
  const tokens = parsePointer(path);
  if (tokens.length === 0) throw new Error('Patching the whole document is not supported');

  let target = document;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const next = Array.isArray(target) ? target[Number(token)] : target[token];
    if (next === undefined || next === null) throw new Error(`Patch path does not exist: ${path}`);
    target = next;
  }

  const last = tokens[tokens.length - 1];

  if (Array.isArray(target)) {
    const index = last === '-' ? target.length : Number(last);
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid array index in path: ${path}`);
    if (op === 'add') target.splice(index, 0, value);
    else if (op === 'replace') {
      if (index >= target.length) throw new Error(`Patch path does not exist: ${path}`);
      target[index] = value;
    } else if (op === 'remove') target.splice(index, 1);
    else throw new Error(`Unsupported patch op: ${String(op)}`);
    return document;
  }

  if (op === 'add' || op === 'replace') target[last] = value;
  else if (op === 'remove') delete target[last];
  else throw new Error(`Unsupported patch op: ${String(op)}`);
  return document;
}

/**
 * Apply a patch to a copy of the document. All-or-nothing: a failing
 * operation leaves the original untouched and rethrows, so a bad patch shows
 * up as an error rather than a half-updated board.
 *
 * @param {object} document
 * @param {Array<object>} operations
 * @returns {object} A new document.
 */
export function applyPatch(document, operations) {
  const draft = structuredClone(document);
  for (const operation of operations || []) applyOperation(draft, operation);
  return draft;
}

/* ── Reducer ─────────────────────────────────────────────────────────────── */

/**
 * Insert or replace a block by id, preserving order for updates.
 * @param {object[]} blocks
 * @param {object} block
 * @returns {object[]}
 */
function upsertBlock(blocks, block) {
  if (!block || typeof block !== 'object') return blocks;
  const id = block.id || `${block.type}:${blocks.length}`;
  const next = { ...block, id };
  const at = blocks.findIndex((existing) => existing.id === id);
  if (at === -1) return [...blocks, next];
  const copy = blocks.slice();
  copy[at] = next;
  return copy;
}

/**
 * Fold one event into the document. Pure: returns a new state, never mutates.
 *
 * Unknown events are returned unchanged rather than throwing — a transport
 * that emits more of the protocol than this client implements should degrade,
 * not break the board.
 *
 * @param {object} state
 * @param {object} event
 * @returns {object}
 */
export function reduceExplainEvent(state, event) {
  if (!isExplainEvent(event)) return state;

  switch (event.type) {
    case EVENT.RUN_STARTED:
      return {
        ...initialExplainState(),
        runId: event.runId || null,
        action: event.action || null,
        status: 'running',
        question: event.question || '',
        scope: event.scope || null,
        startedAt: event.at || null,
      };

    case EVENT.STEP_STARTED:
      return {
        ...state,
        steps: [...state.steps, { name: event.step || '', status: 'running', at: event.at || null }],
      };

    case EVENT.STEP_FINISHED: {
      const steps = state.steps.slice();
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (steps[i].name === event.step && steps[i].status === 'running') {
          steps[i] = { ...steps[i], status: event.failed ? 'failed' : 'done' };
          break;
        }
      }
      return { ...state, steps };
    }

    case EVENT.TEXT_MESSAGE_START:
      return { ...state, message: '' };

    case EVENT.TEXT_MESSAGE_CONTENT:
      return { ...state, message: `${state.message}${event.delta || ''}` };

    case EVENT.TEXT_MESSAGE_END:
      return state;

    case EVENT.TOOL_CALL_START:
      return {
        ...state,
        toolCalls: [...state.toolCalls, { id: event.toolCallId || null, name: event.toolCallName || '', status: 'running' }],
      };

    case EVENT.TOOL_CALL_END: {
      const toolCalls = state.toolCalls.map((call) => (
        call.id === event.toolCallId ? { ...call, status: 'done' } : call
      ));
      return { ...state, toolCalls };
    }

    case EVENT.STATE_SNAPSHOT:
      return { ...state, ...(event.snapshot || {}) };

    case EVENT.STATE_DELTA:
      try {
        return applyPatch(state, event.delta);
      } catch {
        // A patch that does not apply is a bug in the producer, not a reason
        // to blank a board the operator is reading.
        return state;
      }

    case EVENT.CUSTOM:
      if (event.name === CUSTOM_EVENT.BLOCK) return { ...state, blocks: upsertBlock(state.blocks, event.value) };
      if (event.name === CUSTOM_EVENT.BLOCKS) {
        return { ...state, blocks: (event.value || []).reduce(upsertBlock, []) };
      }
      if (event.name === CUSTOM_EVENT.SCOPE) return { ...state, scope: event.value || null };
      return state;

    case EVENT.RUN_ERROR:
      return { ...state, status: 'error', error: event.message || 'Run failed', finishedAt: event.at || null };

    case EVENT.RUN_FINISHED:
      return { ...state, status: 'finished', finishedAt: event.at || null };

    default:
      return state;
  }
}

/**
 * Fold a whole event list. Useful for tests and for replaying a transcript.
 * @param {object[]} events
 * @param {object} [from]
 * @returns {object}
 */
export function reduceExplainEvents(events, from = initialExplainState()) {
  return (events || []).reduce(reduceExplainEvent, from);
}

/* ── Stream ──────────────────────────────────────────────────────────────── */

let runSequence = 0;

/** A monotonic run id. Not a UUID — it only has to be unique within a tab. */
export function nextRunId() {
  runSequence += 1;
  return `run-${runSequence}`;
}

/**
 * An event sink that keeps the reduced document and notifies subscribers.
 *
 * A subscriber receives `(state, event)` so a renderer can either patch just
 * what changed or redraw from state; this client does the former for blocks
 * and the latter for the header.
 *
 * @param {{now?: () => string}} [options]
 * @returns {{
 *   emit: (event: object) => object,
 *   subscribe: (fn: (state: object, event: object) => void) => () => void,
 *   getState: () => object,
 *   reset: () => void,
 *   startRun: (init: object) => string,
 *   block: (block: object) => object,
 *   step: (name: string) => () => void,
 *   fail: (message: string) => object,
 *   finish: () => object
 * }}
 */
export function createExplainStream({ now = () => new Date().toISOString() } = {}) {
  let state = initialExplainState();
  const listeners = new Set();

  const emit = (event) => {
    const stamped = { at: now(), ...event };
    state = reduceExplainEvent(state, stamped);
    for (const listener of listeners) {
      try {
        listener(state, stamped);
      } catch (error) {
        console.warn('[explain] subscriber threw', error);
      }
    }
    return state;
  };

  return {
    emit,

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getState: () => state,

    reset() {
      state = initialExplainState();
      for (const listener of listeners) listener(state, { type: EVENT.RUN_FINISHED, at: now() });
    },

    /** Begin a run and return its id. */
    startRun({ question, scope = null, action = null, runId = nextRunId() }) {
      emit({ type: EVENT.RUN_STARTED, runId, question, scope, action });
      return runId;
    },

    /** Append or update one block. */
    block(value) {
      return emit({ type: EVENT.CUSTOM, name: CUSTOM_EVENT.BLOCK, value });
    },

    /** Mark a step running; the returned function marks it finished. */
    step(name) {
      emit({ type: EVENT.STEP_STARTED, step: name });
      let closed = false;
      return (failed = false) => {
        if (closed) return;
        closed = true;
        emit({ type: EVENT.STEP_FINISHED, step: name, failed });
      };
    },

    fail(message) {
      return emit({ type: EVENT.RUN_ERROR, message });
    },

    finish() {
      return emit({ type: EVENT.RUN_FINISHED });
    },
  };
}
