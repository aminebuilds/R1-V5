import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEX, JARVIS_VIEWS, airportStatus, buildBriefing, circleDegrees, focusFor, incidentHex, newActItems, shortPlace } from './mapModel.js';

const R = 6371;
const kmBetween = ([lon1, lat1], [lon2, lat2]) => {
  const t = (d) => (d * Math.PI) / 180;
  const a = Math.sin(t(lat2 - lat1) / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(t(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

test('rings are closed and every vertex sits at the stated radius', () => {
  const ring = circleDegrees(40.73, -74.16, 5, 36);
  assert.equal(ring.length, 37);
  assert.deepEqual(ring[0].map((v) => v.toFixed(6)), ring[36].map((v) => v.toFixed(6)));
  for (const p of ring) assert.ok(Math.abs(kmBetween([-74.16, 40.73], p) - 5) < 0.001);
});

test('incident colours: closures alert, crashes top of ramp, else by magnitude', () => {
  assert.equal(incidentHex({ category: 'Road closed', magnitude: 4 }), HEX.alert);
  assert.equal(incidentHex({ category: 'Accident', magnitude: 1 }), HEX.ramp[4]);
  assert.equal(incidentHex({ category: 'Jam', magnitude: 2 }), HEX.ramp[3]);
  assert.equal(incidentHex({ category: 'Road works' }), HEX.ramp[1]);
});

test('airport state follows the FAA programs, most serious first', () => {
  const base = { groundStops: [], groundDelays: [], delays: [] };
  assert.equal(airportStatus(base, 'EWR').label, 'Normal');
  assert.equal(airportStatus({ ...base, delays: [{ airport: 'EWR' }] }, 'EWR').label, 'Delays');
  assert.equal(airportStatus({ ...base, groundDelays: [{ airport: 'EWR', avg: '45 minutes' }] }, 'EWR').label, 'Delay 45 minutes');
  assert.equal(airportStatus({ ...base, groundStops: [{ airport: 'EWR' }], delays: [{ airport: 'EWR' }] }, 'EWR').hex, HEX.alert);
});

test('brief items focus where they happen, or nowhere', () => {
  const feeds = {
    'local.airports': { data: { points: { EWR: [40.69, -74.17] } } },
    'local.traffic': { data: [{ id: 'TTI-1', lat: 40.7, lon: -74.2 }] },
  };
  assert.deepEqual(focusFor({ id: 'nws:urn:1' }, feeds), { view: 'metro' });
  assert.deepEqual(focusFor({ id: 'faa:gs:EWR' }, feeds), { lat: 40.69, lon: -74.17, range: 6000 });
  assert.deepEqual(focusFor({ id: 'traffic:TTI-1' }, feeds), { lat: 40.7, lon: -74.2, range: 1400 });
  assert.equal(focusFor({ id: 'mkt:vix' }, feeds), null);
  assert.equal(focusFor({ id: 'session:holiday:2026-11-26' }, feeds), null);
});

test('views and place labels', () => {
  assert.deepEqual(Object.keys(JARVIS_VIEWS), ['home', 'area', 'metro']);
  assert.ok(JARVIS_VIEWS.home.range < JARVIS_VIEWS.area.range && JARVIS_VIEWS.area.range < JARVIS_VIEWS.metro.range);
  assert.equal(shortPlace({ municipality: 'City of Example township', label: 'x' }), 'Example');
  assert.equal(shortPlace({ municipality: null, label: '1 Main St' }), '1 Main St');
});

test('the protection briefing speaks only the snapshot: counts, act titles with actions, watch titles', () => {
  const snap = {
    generatedAt: '2026-11-26T16:21:00Z',
    home: { municipality: 'City of Example township', state: 'NJ' },
    brief: [
      { id: 'nws:1', level: 'act', domain: 'safety', title: 'Wind Advisory until Fri 5:00 AM', action: 'Use extra caution.' },
      { id: 'wx:wet', level: 'watch', domain: 'travel', title: 'Light Rain now until ~Fri 4:00 AM', action: 'Time errands after it clears.' },
      { id: 'session:x', level: 'info', domain: 'money', title: 'US markets closed', action: 'x' },
      { id: 'setup:x', level: 'setup', domain: 'setup', title: '3 feeds need a key', action: 'x' },
    ],
    feeds: {
      'weather.now': { kind: 'measured', data: { tempF: 45, feelsLikeF: 45, text: 'Light Rain' } },
      'social.reddit': { kind: 'unavailable', reason: 'no-key', label: 'Reddit' },
      'tone.gdelt': { kind: 'unavailable', reason: 'loading', label: 'News tone' },
    },
  };
  const b = buildBriefing(snap);
  assert.equal(b.actCount, 1);
  assert.equal(b.watchCount, 1);
  assert.equal(b.spoken, 'Protection mode on at Example, NJ. 1 to act on, 1 to watch. Act: Wind Advisory until Fri 5:00 AM. Use extra caution. Watch: Light Rain now until ~Fri 4:00 AM. It is 45 degrees, light rain.');
  assert.deepEqual(b.unavailable, ['Reddit: no-key']);
  assert.equal(buildBriefing(null), null);
  assert.match(buildBriefing({ brief: [], feeds: {} }).spoken, /no home point/);
});

test('monitoring announces only act items it has not told before', () => {
  const seen = new Set(['nws:1']);
  const brief = [
    { id: 'nws:1', level: 'act' },
    { id: 'faa:gs:EWR', level: 'act' },
    { id: 'wx:wet', level: 'watch' },
  ];
  assert.deepEqual(newActItems(seen, brief).map((i) => i.id), ['faa:gs:EWR']);
  assert.deepEqual(newActItems(seen, null), []);
});
