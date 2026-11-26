import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TOOL_ROUNDS, buildSystemMessage, runChatTurn } from './chatEngine.js';
import { loadFacts } from './chatMemory.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

async function withStorage(storage, fn) {
  const original = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

/** A fetch stub that replays one scripted response per call, clamping to the last entry. */
function stubFetch(steps) {
  let call = 0;
  return async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    return {
      ok: step.ok !== false,
      status: step.status || (step.ok === false ? 500 : 200),
      json: async () => step.body,
    };
  };
}

function assistantMessage({ content = null, toolCalls = [] } = {}) {
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('buildSystemMessage folds in remembered facts when present', () => {
  assert.doesNotMatch(buildSystemMessage([]).content, /already know/);
  const withFacts = buildSystemMessage(['runs 400 Kwik Fill sites']);
  assert.match(withFacts.content, /runs 400 Kwik Fill sites/);
});

test('a plain reply with no tool calls ends the turn', async () => {
  await withStorage(fakeStorage(), async () => {
    const fetchImpl = stubFetch([{ body: { message: assistantMessage({ content: 'Hello there' }) } }]);
    const result = await runChatTurn({ history: [], userText: 'hi', runAction: async () => ({}), fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.reply, 'Hello there');
    assert.deepEqual(result.actions, []);
    assert.equal(result.history.length, 2);
    assert.equal(result.history[0].role, 'user');
    assert.equal(result.history[1].role, 'assistant');
  });
});

test('a tool call routes through the shared action runner, then the loop continues', async () => {
  await withStorage(fakeStorage(), async () => {
    const calls = [];
    const runAction = async (name, args) => {
      calls.push({ name, args });
      return { ok: true, action: name };
    };
    const fetchImpl = stubFetch([
      { body: { message: assistantMessage({ toolCalls: [toolCall('call1', 'fly_to_location', { query: 'Austin' })] }) } },
      { body: { message: assistantMessage({ content: 'Flew to Austin.' }) } },
    ]);
    const result = await runChatTurn({ history: [], userText: 'fly to Austin', runAction, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.reply, 'Flew to Austin.');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'fly_to_location', args: { query: 'Austin' } });
    assert.equal(result.actions.length, 1);
    const toolMessage = result.history.find((m) => m.role === 'tool');
    assert.equal(toolMessage.tool_call_id, 'call1');
    assert.deepEqual(JSON.parse(toolMessage.content), { ok: true, action: 'fly_to_location' });
  });
});

test('remember_fact and forget_fact are handled locally, never through the action runner', async () => {
  await withStorage(fakeStorage(), async () => {
    const runAction = async () => { throw new Error('should not be called for a memory tool'); };
    const fetchImpl = stubFetch([
      { body: { message: assistantMessage({ toolCalls: [toolCall('call1', 'remember_fact', { fact: 'runs 400 Kwik Fill sites' })] }) } },
      { body: { message: assistantMessage({ content: 'Got it.' }) } },
    ]);
    const result = await runChatTurn({ history: [], userText: 'remember I run 400 Kwik Fill sites', runAction, fetchImpl });
    assert.equal(result.ok, true);
    assert.deepEqual(loadFacts(), ['runs 400 Kwik Fill sites']);
    assert.equal(result.actions[0].result.ok, true);
  });
});

test('an unroutable proxy error stops the turn without fabricating a reply', async () => {
  await withStorage(fakeStorage(), async () => {
    const fetchImpl = stubFetch([{ ok: false, status: 503, body: { error: 'OPENAI_API_KEY is not set' } }]);
    const result = await runChatTurn({ history: [], userText: 'hi', runAction: async () => ({}), fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'OPENAI_API_KEY is not set');
    assert.equal(result.reply, null);
  });
});

test('a model that never stops calling tools is cut off at the round cap', async () => {
  await withStorage(fakeStorage(), async () => {
    const fetchImpl = stubFetch([
      { body: { message: assistantMessage({ toolCalls: [toolCall('call', 'get_view_health', {})] }) } },
    ]);
    const result = await runChatTurn({ history: [], userText: 'loop forever', runAction: async () => ({ ok: true }), fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.error, /Stopped after/);
    assert.equal(result.actions.length, MAX_TOOL_ROUNDS);
  });
});

test('onStep is invoked once per executed tool call', async () => {
  await withStorage(fakeStorage(), async () => {
    const steps = [];
    const fetchImpl = stubFetch([
      { body: { message: assistantMessage({ toolCalls: [toolCall('call1', 'get_weather', {})] }) } },
      { body: { message: assistantMessage({ content: 'Sunny.' }) } },
    ]);
    await runChatTurn({
      history: [],
      userText: 'weather?',
      runAction: async () => ({ ok: true, temperatureC: 21 }),
      fetchImpl,
      onStep: (step) => steps.push(step),
    });
    assert.equal(steps.length, 1);
    assert.equal(steps[0].name, 'get_weather');
    assert.equal(steps[0].result.temperatureC, 21);
  });
});
