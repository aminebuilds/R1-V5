import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dossier, headlines, timeline } from './blocks.js';
import { renderBlock } from './render.js';
import { laneValueAt, markerRows, programsAt, resetTimelineScrub, timelineTicks } from './airspaceRender.js';

/** Element stand-in with just enough DOM for the renderer. */
function makeDoc() {
  const make = (tagName, namespace = null) => {
    const node = {
      tagName,
      namespace,
      className: '',
      textContent: '',
      title: '',
      hidden: false,
      value: '',
      dataset: {},
      style: {},
      attributes: {},
      listeners: {},
      children: [],
      appendChild(child) { node.children.push(child); return child; },
      setAttribute(name, value) { node.attributes[name] = String(value); },
      getAttribute(name) { return node.attributes[name] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      dispatch(type, event = {}) { for (const fn of node.listeners[type] || []) fn(event); },
    };
    return node;
  };
  return { createElement: (tag) => make(tag), createElementNS: (ns, tag) => make(tag, ns) };
}

function findAll(node, className, out = []) {
  if (!node) return out;
  if (String(node.className).split(/\s+/).includes(className)) out.push(node);
  for (const child of node.children || []) findAll(child, className, out);
  return out;
}
const findOne = (node, className) => findAll(node, className)[0] || null;

const FROM = Date.parse('2026-11-13T13:00:00Z');
const TO = Date.parse('2026-11-14T17:34:00Z');

function block(overrides = {}) {
  return timeline({
    key: 'test-timeline',
    title: 'US airspace over time',
    domain: { from: FROM, to: TO },
    lanes: [
      {
        id: 'departures', label: 'US departures / 30 min', status: 'ready', stepMs: 1_800_000,
        points: [
          { t: Date.parse('2026-11-13T20:30:00Z'), value: 18, compare: 109 },
          { t: Date.parse('2026-11-13T21:00:00Z'), value: 9, compare: 100 },
        ],
      },
      {
        id: 'airborne', label: 'Airborne over US', status: 'ready', current: '2,431',
        points: [
          { t: Date.parse('2026-11-14T01:58:15Z'), value: 496 },
          { t: Date.parse('2026-11-14T17:32:00Z'), value: 2431 },
        ],
      },
    ],
    bands: [{ from: Date.parse('2026-11-13T20:54:00Z'), to: Date.parse('2026-11-14T01:15:00Z'), label: 'Nationwide ground stop', tone: 'alert' }],
    markers: [
      { key: 'A', t: Date.parse('2026-11-13T20:36:00Z'), label: 'Router instability begins', sources: [{ outlet: 'CBS News', url: 'https://www.cbsnews.com/x' }] },
      { key: 'B', t: Date.parse('2026-11-13T20:54:00Z'), label: 'Nationwide departure ground stop', sources: [{ outlet: 'OpenSky tracks (measured by R.1)', url: null }] },
    ],
    programs: [{ t: Date.parse('2026-11-14T02:57:16Z'), groundStops: 0, groundDelays: 4, delays: 0, airports: ['BOS', 'LGA', 'SAN', 'SFO'] }],
    live: { updatedAt: TO },
    ...overrides,
  });
}

test('the timeline follows "now" by default and reads every lane at the live edge', () => {
  resetTimelineScrub();
  const node = renderBlock(block(), { doc: makeDoc() });
  assert.equal(findOne(node, 'xp-tl-live-state').textContent, 'Live');
  const values = findAll(node, 'xp-tl-lane-value').map((item) => item.textContent);
  assert.deepEqual(values, ['—', '2,431 · 12:32 PM ET']);
  assert.equal(findOne(node, 'xp-tl-scrub').value, '1000');
});

test('scrubbing into the ground stop reads the departures bin against the day before', () => {
  resetTimelineScrub();
  const node = renderBlock(block(), { doc: makeDoc() });
  const scrub = findOne(node, 'xp-tl-scrub');
  const at = Date.parse('2026-11-13T21:10:00Z');
  scrub.value = String(Math.round(((at - FROM) / (TO - FROM)) * 1000));
  scrub.dispatch('input');
  assert.equal(findOne(node, 'xp-tl-live-state').textContent, 'Scrubbing');
  assert.equal(findAll(node, 'xp-tl-lane-value')[0].textContent, '9 vs 100 (9%)');
  assert.equal(findOne(node, 'xp-tl-read-phase').textContent, 'Inside: Nationwide ground stop');
  assert.equal(findOne(node, 'xp-tl-read-phase').dataset.tone, 'alert');
});

test('a scrubbed cursor survives a live re-render; "Now" returns it to the edge', () => {
  resetTimelineScrub();
  const doc = makeDoc();
  const first = renderBlock(block(), { doc });
  findAll(first, 'xp-tl-key')[0].dispatch('click');
  const second = renderBlock(block({ live: { updatedAt: TO + 60_000 } }), { doc });
  assert.equal(findOne(second, 'xp-tl-live-state').textContent, 'Scrubbing');
  assert.match(findOne(second, 'xp-tl-read-time').textContent, /^Fri 3:36 PM ET$/);
  findOne(second, 'xp-tl-now').dispatch('click');
  assert.equal(findOne(second, 'xp-tl-live-state').textContent, 'Live');
});

test('a lane with no data says why instead of drawing a flat zero', () => {
  resetTimelineScrub();
  const node = renderBlock(block({
    lanes: [{ id: 'departures', label: 'US departures / 30 min', status: 'computing', reason: 'Building from the OpenSky flight table.', points: [] }],
  }), { doc: makeDoc() });
  assert.equal(findOne(node, 'xp-tl-empty').textContent, 'Building from the OpenSky flight table.');
  assert.equal(findAll(node, 'xp-tl-line').length, 0);
});

test('marker sources link out safely; measured-by-R.1 sources are plain text', () => {
  resetTimelineScrub();
  const node = renderBlock(block(), { doc: makeDoc() });
  const links = findAll(node, 'xp-src-link');
  const cbs = links.find((item) => item.textContent === 'CBS News');
  assert.equal(cbs.tagName, 'a');
  assert.equal(cbs.attributes.href, 'https://www.cbsnews.com/x');
  assert.equal(cbs.attributes.rel, 'noopener noreferrer');
  assert.equal(links.find((item) => /OpenSky/.test(item.textContent)).tagName, 'span');
});

test('crowded marker keys drop to a second row', () => {
  const span = TO - FROM;
  const t0 = FROM + span / 2;
  assert.deepEqual(markerRows([{ t: t0 }, { t: t0 + span * 0.01 }, { t: t0 + span * 0.02 }, { t: t0 + span * 0.5 }], span), [0, 1, 0, 0]);
});

test('lane and program lookups', () => {
  const lanes = block().lanes;
  assert.equal(laneValueAt(lanes[1], Date.parse('2026-11-14T02:10:00Z')), '496 · 8:58 PM ET');
  assert.equal(laneValueAt(lanes[1], Date.parse('2026-11-14T06:00:00Z')), '—');
  assert.equal(programsAt(block().programs, Date.parse('2026-11-14T03:00:00Z')).groundDelays, 4);
  assert.equal(programsAt(block().programs, Date.parse('2026-11-14T05:00:00Z')), null);
  const ticks = timelineTicks(FROM, TO);
  assert.ok(ticks.length >= 8 && ticks.length <= 14);
});

test('headlines and the event record render their links', () => {
  const doc = makeDoc();
  const news = renderBlock(headlines({
    source: 'GDELT',
    fetchedAt: '12:34 PM ET',
    items: [{ title: 'FAA lifts ground stop', url: 'https://example.com/a', outlet: 'example.com', publishedAt: null }],
  }), { doc });
  const title = findOne(news, 'xp-hl-title');
  assert.equal(title.tagName, 'a');
  assert.equal(title.attributes.target, '_blank');

  const record = renderBlock(dossier({
    title: 'FAA nationwide ground stop',
    asOf: 'Sat 12:20 PM ET',
    items: [{ label: 'Cause', text: 'Router flood.', sources: [{ outlet: 'NBC News', url: 'https://www.nbcnews.com/x' }] }],
  }), { doc });
  assert.equal(findOne(record, 'xp-src-link').attributes.href, 'https://www.nbcnews.com/x');
  assert.match(findOne(record, 'xp-dz-asof').textContent, /Sat 12:20 PM ET/);
});
