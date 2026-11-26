import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirspaceService } from './airspaceService.js';

const NAS_XML = '<AIRPORT_STATUS_INFORMATION><Update_Time>Sat Nov 14 17:16:53 2026 GMT</Update_Time><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>wind</Reason><Avg>45 minutes</Avg><Max>1 hour</Max></Ground_Delay></Ground_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>';

function statesBody(time, n) {
  const states = [];
  for (let i = 0; i < n; i += 1) states.push([`a0${String(i).padStart(4, '0')}`, `DAL${i}`, 'United States', 0, 0, -84.4, 33.6, 9000, false, 220, 90, 0, null, 9000, '1200']);
  return JSON.stringify({ time, states });
}

/** A service wired to in-memory fakes; `env` is mutable from the test. */
function rig(overrides = {}) {
  const env = {
    t: Date.parse('2026-11-14T17:20:00Z'),
    cache: { body: null, at: 0 },
    cooling: false,
    stored: null,
    departures: new Map(),
    calls: { states: 0, flights: [], nas: 0, headlines: 0 },
    nasXml: NAS_XML,
    headlines: async () => ({ source: 'GDELT', items: [{ title: 'FAA lifts ground stop', url: 'https://example.com/a', domain: 'example.com', publishedAt: '2026-11-14T01:20:00Z' }] }),
    flights: async () => [],
  };
  Object.assign(env, overrides);
  const service = createAirspaceService({
    now: () => env.t,
    timelineStore: { read: async () => env.stored, write: async (data) => { env.stored = JSON.parse(JSON.stringify(data)); } },
    departuresStore: { read: async (id) => env.departures.get(id) || null, write: async (id, data) => { env.departures.set(id, JSON.parse(JSON.stringify(data))); } },
    readOpenSkyCache: () => env.cache,
    openSkyCoolingDown: () => env.cooling,
    fetchOpenSkyStates: async () => { env.calls.states += 1; return statesBody(Math.floor(env.t / 1000) - 5, 42); },
    fetchOpenSkyFlights: async (begin, end) => { env.calls.flights.push(begin); return env.flights(begin, end); },
    fetchNasXml: async () => { env.calls.nas += 1; if (env.nasXml instanceof Error) throw env.nasXml; return env.nasXml; },
    fetchHeadlines: async (query) => { env.calls.headlines += 1; return env.headlines(query); },
    options: { headlinesFirstWaitMs: 50, ...(overrides.options || {}) },
    logger: { warn() {} },
  });
  return { env, service };
}

test('a sample reuses the flights proxy cache when it is fresh — no extra OpenSky call', async () => {
  const { env, service } = rig();
  env.cache = { body: statesBody(Math.floor(env.t / 1000) - 3, 7), at: env.t - 30_000 };
  const sample = await service.sampleNow({ allowFetch: true });
  assert.equal(sample.src, 'proxy-cache');
  assert.equal(sample.traffic.airborne, 7);
  assert.equal(env.calls.states, 0);
  assert.equal(sample.nas.groundDelays, 1);
  assert.equal(env.stored.samples.length, 1);
});

test('the sampler fetches for itself only when allowed, and never in a 429 cooldown', async () => {
  const { env, service } = rig();
  assert.equal((await service.sampleNow({ allowFetch: false })).traffic, null, 'board-driven sample spends no credits');
  env.t += 5 * 60_000;
  env.cooling = true;
  assert.equal((await service.sampleNow({ allowFetch: true })).traffic, null);
  assert.equal(env.calls.states, 0);
  env.t += 5 * 60_000;
  env.cooling = false;
  const sample = await service.sampleNow({ allowFetch: true });
  assert.equal(sample.src, 'sampler');
  assert.equal(sample.traffic.airborne, 42);
  assert.equal(env.calls.states, 1);
});

test('a recent FAA-only sample does not block a due traffic sample', async () => {
  const { env, service } = rig();
  await service.sampleNow({ allowFetch: false });
  env.t += 60_000;
  const sample = await service.sampleNow({ allowFetch: true });
  assert.ok(sample?.traffic, 'traffic was due and the tick took it');
  env.t += 60_000;
  assert.equal(await service.sampleNow({ allowFetch: true }), null, 'then the minimum gap applies');
});

test('the same upstream snapshot is one observation, not two', async () => {
  const { env, service } = rig();
  env.cache = { body: statesBody(1794677000, 9), at: env.t };
  await service.sampleNow({ allowFetch: false });
  env.t += 5 * 60_000;
  env.cache = { body: statesBody(1794677000, 9), at: env.t };
  const second = await service.sampleNow({ allowFetch: false });
  assert.equal(second.traffic, null);
});

test('sampling off (sampleEveryMs 0) only ever reuses the proxy cache', async () => {
  const { env, service } = rig({ options: { sampleEveryMs: 0 } });
  const sample = await service.sampleNow({ allowFetch: true });
  assert.equal(sample.traffic, null);
  assert.equal(env.calls.states, 0);
  const brief = await service.getBrief();
  assert.equal(brief.traffic.status, 'unavailable');
  assert.equal(brief.traffic.reason, 'sampler-off');
});

test('the brief reports an unreadable FAA feed as unavailable, never as "no programs"', async () => {
  const { env, service } = rig({ nasXml: new Error('Upstream returned 503') });
  const brief = await service.getBrief();
  assert.equal(brief.nas.status, 'unavailable');
  assert.equal(brief.nas.groundStops, undefined);
  assert.equal(env.calls.nas, 1);
});

test('a failing FAA re-read keeps the last good parse and marks it stale', async () => {
  const { env, service } = rig();
  assert.equal((await service.getBrief()).nas.status, 'ready');
  env.t += 2 * 60_000;
  env.nasXml = new Error('timeout');
  const brief = await service.getBrief();
  assert.equal(brief.nas.status, 'stale');
  assert.equal(brief.nas.groundDelays[0].airport, 'SFO');
});

test('old traffic is reported stale with its age, not as the present', async () => {
  const { env, service } = rig();
  env.cache = { body: statesBody(Math.floor(env.t / 1000), 3), at: env.t };
  await service.sampleNow({ allowFetch: false });
  env.cache = { body: null, at: 0 };
  env.t += 3 * 3600_000;
  const brief = await service.getBrief();
  assert.equal(brief.traffic.status, 'stale');
  assert.ok(brief.traffic.ageMs >= 3 * 3600_000);
});

test('the departure study builds in the background and never re-fetches a final window', async () => {
  const { env, service } = rig({
    flights: async (begin) => [{
      icao24: `x${begin}`,
      firstSeen: begin + 600,
      estDepartureAirport: 'KATL',
      estDepartureAirportHorizDistance: 1000,
      estDepartureAirportVertDistance: 100,
    }],
  });
  const first = await service.getBrief();
  assert.equal(first.departures.status, 'computing');
  await service.settle();
  assert.equal(env.calls.flights.length, 16);

  const second = await service.getBrief();
  assert.equal(second.departures.status, 'ready');
  assert.equal(second.departures.bins.length, 32);
  assert.equal(second.departures.departures, 16);

  // Three hours on, only the windows that were not yet final are re-read.
  const finalCount = env.departures.get('faa-ground-stop-2026-11-13').windowsData.filter((entry) => entry.final).length;
  assert.ok(finalCount >= 8, 'every baseline-day window is final');
  env.t += 3 * 3600_000 + 1;
  env.calls.flights = [];
  await service.getBrief();
  await service.settle();
  assert.equal(env.calls.flights.length, 16 - finalCount);
});

test('headlines never hold the brief for longer than the first-wait budget', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { service } = rig({ headlines: async () => { await gate; return { source: 'GDELT', items: [] }; } });
  const started = Date.now();
  const brief = await service.getBrief();
  assert.ok(Date.now() - started < 2000);
  assert.equal(brief.headlines.status, 'computing');
  release();
  await service.settle();
  assert.equal((await service.getBrief()).headlines.status, 'empty');
});

test('a failed headline refresh keeps the last items, marked stale', async () => {
  const { env, service } = rig();
  assert.equal((await service.getBrief()).headlines.status, 'ready');
  env.t += 11 * 60_000;
  env.headlines = async () => { throw new Error('GDELT 429'); };
  await service.getBrief();
  await service.settle();
  const brief = await service.getBrief();
  assert.equal(brief.headlines.status, 'stale');
  assert.equal(brief.headlines.items.length, 1);
});
