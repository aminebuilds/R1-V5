/**
 * @file The typed-chat orchestration loop.
 *
 * Turns one user message into a finished assistant turn by round-tripping
 * through `/api/openai/chat` and dispatching any tool calls the model makes:
 * `remember_fact`/`forget_fact` are handled locally against
 * `src/chat/chatMemory.js`, everything else goes through the same
 * `runAction(name, args, opts)` runner voice and the Explain Board already
 * share (`src/voice/r1Actions.js` `ensureActionRunner`). No DOM here — see
 * `src/chat/chatPanel.js` for rendering.
 *
 * Deliberately simpler than the voice Realtime session
 * (`src/voice/r1Realtime.js`): a typed turn is strictly sequential (one
 * request in flight at a time, no overlapping responses to arbitrate), so
 * there is no superseded-response bookkeeping and no radio-handoff epoch
 * tracking — that machinery exists for a persistent WebSocket session with
 * concurrent turns, which this is not.
 *
 * @module chat/chatEngine
 */

import { addFact, loadFacts, removeFact } from './chatMemory.js';

/** Hard ceiling on tool round-trips within a single user turn — stops a
 * runaway tool-call loop from running away with cost, nothing more. */
export const MAX_TOOL_ROUNDS = 6;

const CHAT_PROXY_URL = '/api/openai/chat';

const SYSTEM_PREAMBLE = [
  "You are R.1's in-console analyst for a retail/fuel-convenience operator — an operator's second brain, not a chatbot.",
  'FORMAT, every reply: 2-4 short sentences of plain prose. No bullet lists, no headers, no bold labels, no "Here is your snapshot"-style openers, no closing menu of options. State the one signal that matters, one line of why if it is not obvious, and the one action worth taking — as a call, not a question. If several things are true, say the one that matters most and drop the rest. If nothing needs action, say that in one line and stop.',
  'BANNED: bullet points, numbered lists, restating the question, apologizing, hedging ("I think", "it seems"), "let me know if...", "would you like me to...", offering a menu of next steps instead of picking one.',
  'Every answer ties back to what moves this business: gallons, memberships and loyalty signups, repeat-visit habits, basket size, customer satisfaction — not vanity metrics or raw data dumps.',
  'You can move the camera, toggle map layers, and query live business-intelligence tools through the functions available to you. Call a function only when the request needs its effect or its data — then answer from the result, do not just describe the data back.',
  "This product's one rule: every figure is measured, modelled, or explicitly unavailable — never state a number a tool did not actually return, and say plainly when something is unavailable rather than guessing.",
  'When the operator states a fact worth recalling in future sessions (about their business, preferences, or this conversation), call remember_fact — even if they did not say the word "remember".',
].join(' ');

/**
 * @param {string[]} facts
 * @returns {{role: 'system', content: string}}
 */
export function buildSystemMessage(facts = []) {
  const knownFacts = Array.isArray(facts) ? facts.filter(Boolean) : [];
  const content = knownFacts.length
    ? `${SYSTEM_PREAMBLE}\n\nWhat you already know about this operator, from past sessions:\n${knownFacts.map((fact) => `- ${fact}`).join('\n')}`
    : SYSTEM_PREAMBLE;
  return { role: 'system', content };
}

function parseToolArguments(rawArguments) {
  try {
    const parsed = JSON.parse(rawArguments || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Run the two chat-only memory tools locally — they have no business being
 * routed through the map/business-intelligence action runner.
 * @returns {object|null} A result object, or null if `name` is not a memory tool.
 */
function runMemoryTool(name, args) {
  if (name === 'remember_fact') {
    const facts = addFact(args?.fact);
    return { ok: true, action: name, fact: String(args?.fact || '').trim(), facts };
  }
  if (name === 'forget_fact') {
    const facts = removeFact(args?.fact);
    return { ok: true, action: name, facts };
  }
  return null;
}

async function callChatProxy(messages, { fetchImpl = fetch, signal } = {}) {
  let response;
  try {
    response = await fetchImpl(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { ok: false, error: error?.message || 'Chat request failed' };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    return { ok: false, error: data?.error || `Chat request failed (${response.status})` };
  }
  return { ok: true, message: data?.message || null };
}

/**
 * Run one full user turn: send it, execute any tool calls the model makes,
 * feed the results back, and repeat until a final text reply or the round
 * cap is hit.
 *
 * @param {object} params
 * @param {object[]} params.history Prior transcript, oldest first — `role`/
 *   `content` (and `tool_calls`/`tool_call_id` for assistant/tool turns).
 * @param {string} params.userText The new user message.
 * @param {Function} params.runAction `(name, args, opts) => Promise<object>`.
 * @param {typeof fetch} [params.fetchImpl]
 * @param {AbortSignal} [params.signal]
 * @param {(step: {name: string, args: object, result: object}) => void} [params.onStep]
 *   Called once per executed tool call, before the next round trip, so the
 *   panel can render a live "running <tool>…" → result progression.
 * @returns {Promise<{ok: boolean, history: object[], reply: string|null, actions: object[], error: string|null}>}
 */
export async function runChatTurn({ history = [], userText, runAction, fetchImpl, signal, onStep } = {}) {
  const messages = [...history, { role: 'user', content: String(userText || '') }];
  const actions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const outgoing = [buildSystemMessage(loadFacts()), ...messages];
    let response;
    try {
      response = await callChatProxy(outgoing, { fetchImpl, signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, history: messages, reply: null, actions, error: 'Cancelled' };
      }
      throw error;
    }
    if (!response.ok) {
      return { ok: false, history: messages, reply: null, actions, error: response.error };
    }

    const assistantMessage = response.message || { role: 'assistant', content: null };
    messages.push(assistantMessage);

    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (!toolCalls.length) {
      return { ok: true, history: messages, reply: assistantMessage.content || '', actions, error: null };
    }

    for (const call of toolCalls) {
      const name = call.function?.name || '';
      const args = parseToolArguments(call.function?.arguments);
      let result = runMemoryTool(name, args);
      if (!result) {
        if (typeof runAction !== 'function') {
          result = { ok: false, action: name, error: 'No action runner is available in this session.' };
        } else {
          try {
            // origin: 'chat' — the shared runner publishes every result onto
            // the explain bus (src/explain/bus.js); the board skips 'chat'
            // -origin results so it never pops open and steals focus while
            // the operator is mid-conversation here. Chat renders its own
            // terse result line inline instead.
            result = await runAction(name, args, { signal, isCurrent: () => true, origin: 'chat' });
          } catch (error) {
            result = { ok: false, action: name, error: error?.message || 'The action failed' };
          }
        }
      }
      actions.push({ name, args, result });
      onStep?.({ name, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result ?? {}),
      });
    }
  }

  return {
    ok: false,
    history: messages,
    reply: null,
    actions,
    error: `Stopped after ${MAX_TOOL_ROUNDS} tool calls in one turn — ask a narrower question.`,
  };
}
