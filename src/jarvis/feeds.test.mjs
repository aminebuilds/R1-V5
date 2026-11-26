import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './feeds.js';

const HOME = { lat: 40.7347, lon: -74.1644 }; // a generic public point, not anyone's address

test('Census geocoder match is read as published; no match is null, garbage throws', () => {
  const payload = { result: { addressMatches: [{
    matchedAddress: '1 MAIN ST, ANYTOWN, NJ, 07000',
    coordinates: { x: -74.16, y: 40.73 },
    addressComponents: { zip: '07000', state: 'NJ' },
    geographies: {
      Counties: [{ NAME: 'Example County', STATE: '34', COUNTY: '099' }],
      'County Subdivisions': [{ NAME: 'City of Example township' }],
      States: [{ STUSAB: 'NJ' }],
    },
  }] } };
  const g = F.parseCensusGeocode(payload);
  assert.deepEqual([g.lat, g.lon, g.county, g.countyFips, g.state, g.zip], [40.73, -74.16, 'Example County', '34099', 'NJ', '07000']);
  assert.equal(F.parseCensusGeocode({ result: { addressMatches: [] } }), null);
  assert.throws(() => F.parseCensusGeocode({ nope: true }), /Unexpected/);
});

test('NWS observation converts units arithmetically and keeps unreported readings null', () => {
  const obs = F.parseNwsObservation({ properties: {
    timestamp: '2026-11-26T15:20:00+00:00',
    textDescription: 'Light Rain',
    temperature: { unitCode: 'wmoUnit:degC', value: 7.2 },
    windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 40.2 },
    windGust: { unitCode: 'wmoUnit:km_h-1', value: null },
    windDirection: { value: 50 },
    barometricPressure: { unitCode: 'wmoUnit:Pa', value: 101600 },
    visibility: { unitCode: 'wmoUnit:m', value: 8050 },
    windChill: { unitCode: 'wmoUnit:degC', value: 3.1 },
    heatIndex: { value: null },
    relativeHumidity: { value: 81.4 },
  } }, { id: 'KEWR', name: 'Newark' });
  assert.equal(obs.tempF, 45);
  assert.equal(obs.windMph, 25);
  assert.equal(obs.windGustMph, null);
  assert.equal(obs.windFrom, 'NE');
  assert.equal(obs.pressureInHg, 30);
  assert.equal(obs.visibilityMi, 5);
  assert.equal(obs.feelsLikeF, 38);
  assert.equal(obs.station.id, 'KEWR');
});

test('NWS alerts drop tests and cancellations and sort by severity', () => {
  const feature = (event, severity, extra = {}) => ({ properties: { id: event, event, severity, status: 'Actual', messageType: 'Alert', urgency: 'Expected', ...extra } });
  const alerts = F.parseNwsAlerts({ features: [
    feature('Wind Advisory', 'Moderate'),
    feature('Tornado Warning', 'Extreme'),
    feature('Test Message', 'Minor', { status: 'Test' }),
    feature('Old Watch', 'Severe', { messageType: 'Cancel' }),
  ] });
  assert.deepEqual(alerts.map((a) => a.event), ['Tornado Warning', 'Wind Advisory']);
});

test('Yahoo spark parses both payload shapes; missing symbols are marked unavailable', () => {
  const board = [{ symbol: 'SPY', label: 'S&P' }, { symbol: '^TNX', label: '10Y', unit: '%' }, { symbol: 'GONE', label: 'Delisted' }];
  const keyed = {
    SPY: { timestamp: [1, 2, 3], close: [700, null, 707], chartPreviousClose: 700 },
    '^TNX': { timestamp: [1, 2], close: [4.9, 4.8], chartPreviousClose: 4.9 },
    GONE: { timestamp: [], close: null, chartPreviousClose: null },
  };
  const q = F.parseYahooSpark(keyed, board);
  assert.equal(q[0].last, 707);
  assert.equal(Math.round(q[0].changePct * 100) / 100, 1);
  assert.equal(Math.round(q[1].changeBp), -10);
  assert.equal(q[2].available, false);
  const legacy = { spark: { result: [{ symbol: 'SPY', response: [{ meta: { chartPreviousClose: 10 }, timestamp: [1], indicators: { quote: [{ close: [11] }] } }] }] } };
  assert.equal(F.parseYahooSpark(legacy, board.slice(0, 1))[0].last, 11);
});

test('daily regime is arithmetic over the published closes', () => {
  const closes = Array.from({ length: 220 }, (_, i) => 100 + i);
  closes.push(250);
  const payload = { chart: { result: [{ meta: { symbol: 'SPY' }, timestamp: closes.map((_, i) => 1_700_000_000 + i * 86400), indicators: { quote: [{ close: closes }] } }] } };
  const r = F.parseYahooDailyRegime(payload);
  assert.equal(r.last, 250);
  assert.equal(r.high1y, 319);
  assert.equal(r.trend, 'uptrend'); // still above a rising 200-day despite the drop
  assert.ok(r.drawdownPct < -21 && r.drawdownPct > -22);
});

test('Treasury XML rows parse and summarize to bp changes', () => {
  const entry = (date, y10, y2) => `<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">${y2}</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">${y10}</d:BC_10YEAR></m:properties></content></entry>`;
  const xml = `<feed>${entry('2026-11-25', '4.85', '4.61')}${entry('2026-11-24', '4.97', '4.70')}</feed>`;
  const s = F.summarizeTreasury(F.parseTreasuryXml(xml));
  assert.equal(s.date, '2026-11-25');
  assert.equal(s.tenors.find((t) => t.tenor === '10Y').changeBp, -12);
  assert.equal(s.spread2s10sBp, 24);
  assert.equal(s.tenors.find((t) => t.tenor === '30Y').yield, null);
});

test('BLS y/y skips a month whose year-ago value was never published', () => {
  const row = (year, m, value) => ({ year: String(year), period: `M${String(m).padStart(2, '0')}`, periodName: `M${m}`, value: String(value) });
  const cpi = [row(2026, 10, 330), row(2026, 9, 329), row(2025, 9, 317), row(2025, 8, 316), row(2026, 8, 328)];
  const payload = { status: 'REQUEST_SUCCEEDED', Results: { series: [
    { seriesID: 'CPI', data: cpi },
    { seriesID: 'UNRATE', data: [row(2026, 10, 4.1), row(2026, 9, 4.2)] },
    { seriesID: 'PAY', data: [row(2026, 9, 160165), row(2026, 8, 160000)] },
  ] } };
  const out = F.parseBls(payload, { cpi: 'CPI', coreCpi: 'NONE', unemployment: 'UNRATE', payrolls: 'PAY' });
  assert.equal(out.cpi.period, 'M9 2026');
  assert.equal(out.cpi.skipped, 'M10 2026');
  assert.equal(out.cpi.yoyPct, 3.8);
  assert.equal(out.unemployment.value, 4.1);
  assert.equal(out.payrolls.changeK, 165);
  assert.equal(out.coreCpi, null);
});

test('PMMS CSV gives the latest week and its change', () => {
  const csv = 'date,pmms30,pmms30p,pmms15,pmms15p\n"11/19/2026","7.28","","6.66",""\n"11/25/2026","7.21","","6.54",""\n';
  const m = F.parsePmmsCsv(csv);
  assert.deepEqual([m.date, m.rate30, m.rate15, m.change30Bp], ['2026-11-25', 7.21, 6.54, -7]);
});

test('Polymarket drops sports, groups by event, and labels a lone binary "Yes"', () => {
  const mk = (question, ev, price, extra = {}) => ({ question, outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([String(price), String(1 - price)]), volume24hr: 1000, events: [ev], ...extra });
  const fed = { id: 'e1', title: 'Fed Decision in December?', slug: 'fed-dec' };
  const markets = [
    mk('Will the Fed hike 25 bps?', fed, 0.94, { groupItemTitle: '25 bps increase', oneDayPriceChange: 0.04 }),
    mk('Will the Fed hold?', fed, 0.04, { groupItemTitle: 'No change' }),
    mk('Celtics vs. Knicks', { id: 'e2', title: 'Celtics vs. Knicks', slug: 'nba' }, 0.5),
    mk('UEFA Champions League: 2027 Champion — Liverpool', { id: 'e3', title: 'UEFA Champions League: 2027 Champion', slug: 'ucl' }, 0.05),
    { ...mk('Esports market', { id: 'e4', title: 'Game', slug: 'g' }, 0.5), sportsMarketType: 'moneyline' },
    mk('New CEO named by Dec 31?', { id: 'e5', title: 'New CEO named by Dec 31?', slug: 'ceo' }, 0.99),
  ];
  const events = F.parsePolymarket(markets);
  assert.deepEqual(events.map((e) => e.title).sort(), ['Fed Decision in December?', 'New CEO named by Dec 31?']);
  const fedEvent = events.find((e) => e.id === 'e1');
  assert.equal(fedEvent.options[0].label, '25 bps increase');
  assert.equal(fedEvent.url, 'https://polymarket.com/event/fed-dec');
  assert.equal(events.find((e) => e.id === 'e5').options[0].label, 'Yes');
});

test('Google News RSS strips the " - Publisher" suffix and dedupes', () => {
  const item = (title, src, date) => `<item><title>${title} - ${src}</title><link>https://news.google.com/rss/articles/x${src}</link><pubDate>${date}</pubDate><source url="https://x">${src}</source></item>`;
  const xml = `<rss><channel>${item('Water main break closes street', 'TAPinto', 'Thu, 26 Nov 2026 14:00:00 GMT')}${item('Water main break closes street', 'Patch', 'Thu, 26 Nov 2026 13:00:00 GMT')}${item('Tom &amp; Jerry', 'NJ.com', 'Thu, 26 Nov 2026 15:00:00 GMT')}</channel></rss>`;
  const items = F.parseNewsRss(xml);
  assert.deepEqual(items.map((i) => i.title), ['Tom & Jerry', 'Water main break closes street']);
  assert.equal(items[1].source, 'TAPinto');
});

test('incident filter needs both an incident word and a home place', () => {
  const kept = F.filterIncidentHeadlines([
    { title: 'Police investigate shooting in East Riverton' },
    { title: 'Members of the South Riverton Police Department Give Free Turkeys to Many Locals' },
    { title: 'Riverton man convicted in 2024 shooting of brother-in-law' },
    { title: 'South Riverton council urges residents to shop small' },
    { title: 'Car fire on Route 9 in Fairview' },
    { title: 'Water main break closes road in Example Falls' },
  ], ['Riverton', 'East Riverton', 'Example County']);
  assert.deepEqual(kept.map((k) => k.title), ['Police investigate shooting in East Riverton', 'Water main break closes road in Example Falls']);
});

test('GDELT tone ignores zero (no-coverage) intervals', () => {
  const data = [
    { date: '20261120T000000Z', value: -2 },
    { date: '20261121T000000Z', value: 0 },
    { date: '20261126T000000Z', value: -4 },
    { date: '20261126T060000Z', value: 0 },
  ];
  const t = F.parseGdeltTone({ timeline: [{ data }] });
  assert.equal(t.avg24h, -4);
  assert.equal(t.avg7d, -3);
  assert.equal(t.delta, -1);
});

test('KEV recent additions flag consumer vendors and ransomware use', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const k = F.parseKev({ dateReleased: '2026-11-25T19:48:12Z', vulnerabilities: [
    { cveID: 'CVE-2026-1', vendorProject: 'Apple', product: 'iOS', dateAdded: '2026-11-24', knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-2026-2', vendorProject: 'Ivanti', product: 'EPMM', dateAdded: '2026-11-25', knownRansomwareCampaignUse: 'Known' },
    { cveID: 'CVE-2020-3', vendorProject: 'Apple', product: 'Safari', dateAdded: '2020-01-01' },
  ] }, { now });
  assert.deepEqual(k.recent.map((v) => [v.cve, v.consumer, v.ransomware]), [['CVE-2026-2', false, true], ['CVE-2026-1', true, false]]);
});

test('TomTom incidents outside the radius are dropped; closures rank first', () => {
  const inc = (id, cat, mag, lon, lat) => ({ geometry: { type: 'LineString', coordinates: [[lon, lat]] }, properties: { id, iconCategory: cat, magnitudeOfDelay: mag, from: 'A', to: 'B' } });
  const list = F.parseTomTomIncidents({ incidents: [
    inc('jam', 6, 2, -74.155, 40.738),
    inc('closed', 8, 4, -74.145, 40.728),
    inc('far', 1, 3, -74.6, 40.9),
  ] }, HOME);
  assert.deepEqual(list.map((i) => i.id), ['closed', 'jam']);
  assert.equal(list[0].category, 'Road closed');
});

test('USGS quakes split into near-home and global-major', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const q = (id, mag, lon, lat, hoursAgo) => ({ id, geometry: { coordinates: [lon, lat, 10] }, properties: { mag, place: id, time: now - hoursAgo * 3600_000 } });
  const out = F.parseUsgsQuakes({ metadata: {}, features: [q('nj', 2.6, -74.5, 40.6, 5), q('reunion', 6.4, 55, -21, 30), q('old', 6.5, 100, 0, 100)] }, HOME, { now });
  assert.deepEqual(out.near.map((x) => x.id), ['nj']);
  assert.deepEqual(out.major.map((x) => x.id), ['reunion']);
});
