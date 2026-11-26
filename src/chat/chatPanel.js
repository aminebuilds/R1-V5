/**
 * @file The typed chat panel — DOM wiring only.
 *
 * Mirrors the lifecycle shape of `src/explain/board.js`
 * (`queryDom()` / `initX({...})` returning a small API / `destroyX()`), but is
 * a deliberately separate module: the Explain Board draws single composed
 * answer cards for a fixed set of actions, this is a running conversation
 * with free-form tool calls, slash commands, and local memory.
 *
 * @module chat/chatPanel
 */

import { MAX_TOOL_ROUNDS, runChatTurn } from './chatEngine.js';
import { addFact, listFacts, loadHistory, removeFact, saveHistory } from './chatMemory.js';

/** Curated for the /help menu — kept in the same categories as the tools
 * live in conceptually. Not wire schema, so it does not need to track
 * R1_REALTIME_TOOLS (vite.config.js) byte-for-byte, just in spirit. */
const ABILITIES_MENU = [
  {
    category: 'View & camera',
    tools: [
      ['fly_to_location', 'Fly the camera to a named place, address, or business'],
      ['zoom_to_globe', 'Pull all the way out to the whole-globe view'],
      ['adjust_camera_zoom', 'Zoom in or out from where the camera is now'],
      ['move_camera', 'Pan/orbit the camera by a relative amount'],
      ['fly_route', 'Fly a route between two or more points'],
      ['frame_overhead', 'Frame something directly overhead'],
      ['track_entity', 'Follow a moving aircraft/vessel/entity with the camera'],
      ['stop_tracking', 'Stop following the currently tracked entity'],
      ['select_nearest_aircraft', 'Select the nearest aircraft to the camera'],
      ['get_current_view_state', 'Report exactly where the camera is looking now'],
    ],
  },
  {
    category: 'Layers & visuals',
    tools: [
      ['set_layer_visibility', 'Turn a data layer on or off'],
      ['show_data_layers_menu', 'Open the data layers menu'],
      ['set_visual_style', 'Switch the visual filter (retro, thermal, night vision, etc.)'],
      ['set_hud', 'Show or hide HUD chrome elements'],
      ['set_detection', 'Configure object-detection overlays'],
      ['set_map_stack', 'Switch the base map/imagery stack'],
      ['set_post_processing', 'Toggle post-processing effects'],
      ['toggle_competitive_heatmap', 'Toggle the competitive-density heatmap'],
      ['control_weather_effects', 'Toggle visual rain/weather effects'],
    ],
  },
  {
    category: 'HUD & panels',
    tools: [
      ['set_panel_open', 'Open or close a specific HUD panel'],
      ['set_context_mode', 'Switch the Context panel mode'],
      ['control_cockpit', 'Enter or exit cockpit view'],
      ['control_scene', 'Control a saved camera scene/sequence'],
    ],
  },
  {
    category: 'CCTV & radio',
    tools: [
      ['control_cctv', 'Control the CCTV camera feed'],
      ['control_radio', 'Control internet radio playback'],
    ],
  },
  {
    category: 'Annotations',
    tools: [
      ['annotate_map', 'Draw an annotation/marker on the map'],
      ['clear_annotations', 'Clear map annotations'],
    ],
  },
  {
    category: 'Data & queries',
    tools: [
      ['get_entity_context', 'Get details about a selected entity'],
      ['analyst_query', 'Count/list/filter live layer data (flights, ships, fires, etc.)'],
      ['next_iss_pass', 'When the ISS next passes overhead'],
      ['get_weather', 'Live weather for the current or a named location'],
    ],
  },
  {
    category: 'Business intelligence',
    tools: [
      ['search_business_sites', 'Map a business chain’s site network'],
      ['activate_network', 'Activate a mapped site network on the globe'],
      ['search_address_or_business', 'Look up a specific address or business'],
      ['analyze_competitors', 'Who you’re up against in a market'],
      ['get_traffic_delays_and_construction', 'Traffic/construction near your sites'],
      ['get_cool_off_opportunities', 'Where a promotion is worth running'],
      ['get_fuel_price_outlook', 'What fuel is about to cost'],
      ['get_view_health', 'How the current view is doing'],
      ['get_portfolio_health', 'How the whole portfolio is doing'],
      ['regeocode_pending_sites', 'Retry map placement for saved sites still missing coordinates'],
      ['get_local_news', 'Recent local news near a location'],
      ['get_full_insight', 'One combined pass: competitors, prices, busyness, news, and top plays'],
    ],
  },
  {
    category: 'Memory',
    tools: [
      ['remember_fact', 'Remember something about you or your business (also: /remember <fact>)'],
      ['forget_fact', 'Forget a remembered fact (also: /forget <fact>)'],
    ],
  },
];

function abilitiesMenuText() {
  const lines = ["Everything I can do — ask in plain English, or call one of these directly by describing what you want:"];
  for (const group of ABILITIES_MENU) {
    lines.push('', group.category.toUpperCase());
    for (const [name, description] of group.tools) {
      lines.push(`  • ${name.replace(/_/g, ' ')} — ${description}`);
    }
  }
  lines.push('', 'Also: /memory to list remembered facts, /forget <fact> to remove one.');
  return lines.join('\n');
}

let _dom = null;
let _viewer = null;
let _runAction = null;
let _busy = false;

function byId(id) {
  return document.getElementById(id);
}

function queryDom() {
  return {
    panel: byId('chat-panel'),
    transcript: byId('chat-transcript'),
    empty: byId('chat-empty'),
    form: byId('chat-ask'),
    input: byId('chat-ask-input'),
    submitBtn: byId('chat-ask-submit'),
    status: byId('chat-status'),
  };
}

function setStatus(state, text = '') {
  if (!_dom?.status) return;
  _dom.status.textContent = text;
  if (state) _dom.status.dataset.state = state;
  else delete _dom.status.dataset.state;
}

function setBusy(busy) {
  _busy = busy;
  if (_dom?.input) _dom.input.disabled = busy;
  if (_dom?.submitBtn) _dom.submitBtn.disabled = busy;
}

/** One row in the transcript. `role` drives the accent color; `tone` can
 * override it (e.g. a failed tool call renders in alert regardless of role). */
function appendRow({ role, text, tone = null }) {
  if (!_dom?.transcript) return;
  if (_dom.empty) _dom.empty.hidden = true;
  const row = document.createElement('div');
  row.className = 'chat-row';
  row.dataset.role = role;
  if (tone) row.dataset.tone = tone;
  const meta = document.createElement('div');
  meta.className = 'chat-row-meta';
  meta.textContent = role === 'user' ? 'You' : role === 'tool' ? 'Action' : 'R.1';
  const body = document.createElement('div');
  body.className = 'chat-row-text';
  body.textContent = text;
  row.append(meta, body);
  _dom.transcript.appendChild(row);
  _dom.transcript.scrollTop = _dom.transcript.scrollHeight;
  return row;
}

/** Terse one-line summary of a tool result — not a rich composed card (that
 * is the Explain Board's job for the handful of actions it composes for). */
function summarizeToolResult(name, result) {
  const label = name.replace(/_/g, ' ');
  if (!result || result.ok === false) {
    return { text: `${label} — ${result?.error || 'did not complete'}`, tone: 'alert' };
  }
  return { text: `${label} — done`, tone: null };
}

function appendToolRow(name, result) {
  const { text, tone } = summarizeToolResult(name, result);
  appendRow({ role: 'tool', text, tone });
}

/** Reconstruct the visible transcript from the raw (API-shaped) history —
 * tool_calls/tool-role bookkeeping is paired back up into one row per call. */
function renderHistory(rawHistory) {
  if (!_dom?.transcript) return;
  _dom.transcript.replaceChildren();
  if (_dom.empty) _dom.transcript.appendChild(_dom.empty);
  let any = false;
  for (const message of rawHistory) {
    if (message.role === 'user' && message.content) {
      appendRow({ role: 'user', text: message.content });
      any = true;
    } else if (message.role === 'assistant') {
      if (message.content) {
        appendRow({ role: 'assistant', text: message.content });
        any = true;
      }
      for (const call of message.tool_calls || []) {
        const toolMessage = rawHistory.find((m) => m.role === 'tool' && m.tool_call_id === call.id);
        let result = null;
        try {
          result = toolMessage ? JSON.parse(toolMessage.content) : null;
        } catch {
          result = null;
        }
        appendToolRow(call.function?.name || '', result);
        any = true;
      }
    }
  }
  if (_dom.empty) _dom.empty.hidden = any;
}

function recordLocalTurn(userText, assistantText) {
  appendRow({ role: 'user', text: userText });
  appendRow({ role: 'assistant', text: assistantText });
  const history = [
    ...loadHistory(),
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ];
  saveHistory(history);
}

/** Slash commands are local — no network round trip, same memory store the
 * model's own remember_fact/forget_fact tool calls write through. */
function handleSlashCommand(text) {
  const match = /^\/(\w+)\s*(.*)$/s.exec(text.trim());
  if (!match) return false;
  const [, command, rest] = match;
  const arg = rest.trim();

  if (command === 'help' || command === 'abilities') {
    recordLocalTurn(text, abilitiesMenuText());
    return true;
  }
  if (command === 'memory') {
    const facts = listFacts();
    recordLocalTurn(text, facts.length
      ? `What I remember about you:\n${facts.map((fact, i) => `  ${i + 1}. ${fact}`).join('\n')}`
      : 'Nothing remembered yet. Try: /remember <fact>');
    return true;
  }
  if (command === 'remember') {
    if (!arg) {
      recordLocalTurn(text, 'Usage: /remember <fact to keep>');
      return true;
    }
    addFact(arg);
    recordLocalTurn(text, `Remembered: ${arg}`);
    return true;
  }
  if (command === 'forget') {
    if (!arg) {
      recordLocalTurn(text, 'Usage: /forget <fact text, or its number from /memory>');
      return true;
    }
    const asIndex = /^\d+$/.test(arg) ? Number(arg) - 1 : null;
    removeFact(asIndex !== null ? asIndex : arg);
    recordLocalTurn(text, `Forgot: ${arg}`);
    return true;
  }
  return false;
}

async function submitAsk() {
  const text = _dom?.input?.value?.trim();
  if (!text || _busy) return;
  _dom.input.value = '';

  if (handleSlashCommand(text)) return;

  appendRow({ role: 'user', text });
  setBusy(true);
  setStatus('busy', 'Thinking…');

  try {
    const result = await runChatTurn({
      history: loadHistory(),
      userText: text,
      runAction: _runAction,
      onStep: ({ name, result: stepResult }) => appendToolRow(name, stepResult),
    });
    saveHistory(result.history);
    if (result.ok) {
      appendRow({ role: 'assistant', text: result.reply || '(no reply)' });
      setStatus(null, '');
    } else {
      setStatus('error', result.error || 'Something went wrong.');
    }
  } catch (error) {
    setStatus('error', error?.message || 'Something went wrong.');
  } finally {
    setBusy(false);
    _dom?.input?.focus();
  }
}

/**
 * Mount the panel.
 * @param {{viewer: object, runAction?: Function}} deps
 * @returns {{ask: Function}|null}
 */
export function initChatPanel({ viewer, runAction = null } = {}) {
  _dom = queryDom();
  if (!_dom.panel) return null;

  _viewer = viewer || null;
  _runAction = runAction;

  // Re-append the empty-state placeholder before rendering — it is part of
  // the static markup, not something render creates.
  if (!_dom.empty) _dom.empty = _dom.transcript?.querySelector('.chat-empty') || null;
  renderHistory(loadHistory());

  _dom.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAsk();
  });

  return {
    ask: (text) => {
      if (_dom?.input) _dom.input.value = String(text || '');
      return submitAsk();
    },
  };
}

/** Tear the panel down (mirrors destroyExplainBoard). */
export function destroyChatPanel() {
  if (_dom?.transcript) _dom.transcript.replaceChildren();
  _dom = null;
  _viewer = null;
  _runAction = null;
  _busy = false;
}

/** Exposed for tests/tooling that want to inspect the menu without duplicating it. */
export function describeAbilities() {
  return abilitiesMenuText();
}

/** Round-trip cap re-exported for anything that surfaces it in the UI. */
export { MAX_TOOL_ROUNDS };
