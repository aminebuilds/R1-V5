import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocks } from './blocks.js';
import { AIRSPACE_ACTION, airspaceVerdict, composeAirspaceBrief } from './airspaceComposer.js';
import { COMPOSED_ACTIONS, composeForAction } from './composers.js';
import { routeQuestion } from './askRouter.js';
import { AIRSPACE_EVENTS } from '../airspace/events.js';

const find = (blocks, type) => blocks.find((block) => block.type === type) || null;
const all = (blocks, type) => blocks.filter((block) => block.type === type);

function brief(overrides = {}) {
  const generatedAt = '2026-11-14T17:34:00.000Z';
  const now = Date.parse(generatedAt);
  return {
    ok: true,
    action: AIRSPACE_ACTION,
    generatedAt,
    nas: {
      status: 'ready',
      fetchedAt: generatedAt,
      updatedAt: '2026-11-14T17:32:12.000Z',
      groundStops: [],
      groundDelays: [{ airport: 'SFO', reason: 'wind', avg: '2 hours and 18 minutes', max: '11 hours and 30 minutes' }],
      delays: [],
      closures: [{ airport: 'DCA', kind: 'diversion', end: '2026-11-14T11:00:00.000Z' }],
      standingClosures: 3,
    },
    traffic: { status: 'ready', t: now - 120_000, airborne: 2431, climbing: 112, emergencies: [], ageMs: 120_000 },
    timeline: {
      sampleEveryMs: 600_000,
      samples: [
        { at: Date.parse('2026-11-14T01:58:15Z'), traffic: { t: Date.parse('2026-11-14T01:58:15Z'), airborne: 496 }, nas: null },
        { at: Date.parse('2026-11-14T02:57:16Z'), traffic: { t: Date.parse('2026-11-14T02:57:16Z'), airborne: 1117 }, nas: { groundStops: 0, groundDelays: 4, delays: 0, newClosures: 3, airports: ['BOS', 'LGA', 'SAN', 'SFO'] } },
        { at: now - 120_000, traffic: { t: now - 120_000, airborne: 2431 }, nas: { groundStops: 0, groundDelays: 1, delays: 0, newClosures: 1, airports: ['SFO'] } },
      ],
    },
    departures: {
      status: 'ready',
      complete: false,
      computedAt: '2026-11-14T17:32:00.000Z',
      bins: [
        { t: Date.parse('2026-11-13T20:00:00Z'), event: 24, baseline: 96 },
        { t: Date.parse('2026-11-13T20:30:00Z'), event: 18, baseline: 109 },
        { t: Date.parse('2026-11-13T21:00:00Z'), event: 9, baseline: 100 },
      ],
    },
    event: AIRSPACE_EVENTS[0],
    headlines: {
      status: 'ready',
      source: 'GDELT',
      query: '"ground stop" FAA',
      fetchedAt: generatedAt,
      items: [{ title: 'FAA blames ground stop on equipment issue', url: 'https://www.npr.org/x', domain: 'npr.org', publishedAt: '2026-11-14T16:00:00Z' }],
    },
    ...overrides,
  };
}

test('the airspace board is a valid, sourced document', () => {
  const blocks = composeAirspaceBrief(brief());
  assert.deepEqual(validateBlocks(blocks), { ok: true, problems: [] });
  assert.equal(blocks[0].type, 'head');
  assert.equal(blocks[0].action, AIRSPACE_ACTION);
  assert.ok(find(blocks, 'timeline'));
  assert.ok(find(blocks, 'dossier'));
  assert.ok(find(blocks, 'headlines'));
  const sources = find(blocks, 'sources');
  assert.ok(sources.items.some((item) => item.url === 'https://nasstatus.faa.gov/'));
});

test('the verdict is fixed wording over counts', () => {
  assert.equal(
    airspaceVerdict(brief()),
    'No FAA ground stops. 1 ground delay program and 0 airport delays (SFO). 2,431 aircraft airborne over the US at 12:32 PM ET.',
  );
  const stops = brief({ nas: { ...brief().nas, groundStops: [{ airport: 'ORD' }, { airport: 'MDW' }] } });
  assert.match(airspaceVerdict(stops), /^FAA ground stops in effect at 2 airports: ORD, MDW\./);
});

test('an unreadable FAA feed is a gap, and its readouts are dashes — never zero', () => {
  const blocks = composeAirspaceBrief(brief({ nas: { status: 'unavailable', reason: 'Upstream returned 503' } }));
  const readouts = find(blocks, 'readouts').items;
  assert.equal(readouts.find((item) => item.label === 'Ground stops').value, '—');
  assert.equal(readouts.find((item) => item.label === 'Ground stops').kind, 'unavailable');
  assert.ok(all(blocks, 'gap').some((block) => /FAA program state unknown/.test(block.title)));
  assert.match(find(blocks, 'verdict').text, /FAA status feed unavailable/);
});

test('a stale traffic sample is history: dated in the verdict, absent from the now-readouts', () => {
  const blocks = composeAirspaceBrief(brief({
    traffic: { status: 'stale', t: Date.parse('2026-11-14T03:05:13Z'), airborne: 1250, climbing: 74, emergencies: [], ageMs: 52_000_000 },
  }));
  assert.match(find(blocks, 'verdict').text, /No current US traffic sample — the last one, Fri 10:05 PM ET, counted 1,250 airborne\./);
  const airborne = find(blocks, 'readouts').items.find((item) => item.label === 'Airborne over US');
  assert.equal(airborne.value, '—');
  assert.equal(find(blocks, 'timeline').lanes[1].current, '—');
});

test('programs in effect are listed with their FAA detail', () => {
  const rows = find(composeAirspaceBrief(brief()), 'evidence').rows;
  assert.deepEqual(rows.map((row) => row.claim), ['SFO — ground delay program', 'DCA — closed to diversions']);
  assert.match(rows[0].source, /avg 2 hours and 18 minutes/);
});

test('the timeline carries the stop band, the sourced markers and both lanes', () => {
  const block = find(composeAirspaceBrief(brief()), 'timeline');
  assert.equal(block.key, 'airspace-timeline');
  assert.deepEqual(block.bands.map((band) => [new Date(band.from).toISOString(), new Date(band.to).toISOString()]), [
    ['2026-11-13T20:54:00.000Z', '2026-11-14T01:15:00.000Z'],
  ]);
  assert.deepEqual(block.markers.map((marker) => marker.key), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.ok(block.markers.every((marker) => marker.sources.length > 0));
  const [departures, airborne] = block.lanes;
  assert.equal(departures.stepMs, 1_800_000);
  assert.deepEqual(departures.points[2], { t: Date.parse('2026-11-13T21:00:00Z'), value: 9, compare: 100 });
  assert.deepEqual(airborne.points.map((point) => point.value), [496, 1117, 2431]);
  assert.equal(block.programs.length, 2);
});

test('a departure study still building is said to be building, with no points', () => {
  const lane = find(composeAirspaceBrief(brief({ departures: { status: 'computing' } })), 'timeline').lanes[0];
  assert.equal(lane.status, 'computing');
  assert.equal(lane.points.length, 0);
  assert.match(lane.reason, /Building/);
});

test('Google News headlines carry the non-commercial caveat; GDELT ones do not', () => {
  const gdelt = find(composeAirspaceBrief(brief()), 'headlines');
  assert.equal(gdelt.note, null);
  const rss = find(composeAirspaceBrief(brief({ headlines: { ...brief().headlines, source: 'Google News RSS' } })), 'headlines');
  assert.match(rss.note, /non-commercial use only/);
});

test('a trailing " - Outlet" on a headline is dropped when it repeats the outlet', () => {
  const block = find(composeAirspaceBrief(brief({
    headlines: { ...brief().headlines, source: 'Google News RSS', items: [{ title: 'FAA blames ground stop on equipment issue - NPR', url: 'https://www.npr.org/x', domain: 'NPR' }] },
  })), 'headlines');
  assert.equal(block.items[0].title, 'FAA blames ground stop on equipment issue');
});

test('headline links that are not http(s) are dropped', () => {
  const block = find(composeAirspaceBrief(brief({
    headlines: { ...brief().headlines, items: [{ title: 'Bad', url: 'javascript:alert(1)', domain: 'x' }, { title: 'Good', url: 'https://a.example/b', domain: 'a.example' }] },
  })), 'headlines');
  assert.deepEqual(block.items.map((item) => item.title), ['Good']);
});

test('a failed brief is a gap, not an empty board', () => {
  const blocks = composeAirspaceBrief({ ok: false, error: 'Airspace brief timed out' });
  assert.equal(find(blocks, 'head').status, 'error');
  assert.equal(find(blocks, 'gap').reason, 'Airspace brief timed out');
});

test('the action is wired into the board and the ask box', () => {
  assert.ok(COMPOSED_ACTIONS.includes(AIRSPACE_ACTION));
  assert.equal(composeForAction(AIRSPACE_ACTION, brief())[0].action, AIRSPACE_ACTION);
  for (const question of [
    'What is happening with the FAA?',
    'Are flights grounded right now?',
    'Is the ground stop still on?',
    'Why are flights cancelled today?',
    'Any flight delays at the airports?',
    'What is happening in US airspace?',
  ]) {
    assert.equal(routeQuestion(question).action, AIRSPACE_ACTION, question);
  }
  // Road traffic and the analyst counter keep their own questions.
  assert.equal(routeQuestion('What is traffic doing around here?').action, 'get_traffic_delays_and_construction');
  assert.equal(routeQuestion('How many flights are in view?').action, 'analyst_query');
});
