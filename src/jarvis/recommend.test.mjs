import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, firstSentences, situationLine, wetWindow } from './recommend.js';
import { marketSession } from './marketCalendar.js';

const NOW = Date.parse('2026-11-26T15:50:00Z');
const live = (id, data, kind = 'measured') => ({ id, label: id, kind, data, source: { name: id }, fetchedAt: new Date(NOW).toISOString() });
const off = (id, reason, needs) => ({ id, label: id, kind: 'unavailable', reason, needs, data: null });

test('no feeds, no items: the brief never invents a condition', () => {
  assert.deepEqual(buildBrief({}, { now: NOW }), []);
  const allDown = { markets: off('markets', 'timeout'), 'weather.alerts': off('weather.alerts', 'timeout'), 'sentiment.cryptoFng': off('sentiment.cryptoFng', 'rate-limited') };
  assert.deepEqual(buildBrief(allDown, { now: NOW }), []);
});

test('an NWS alert becomes an act item carrying the official instruction', () => {
  const feeds = { 'weather.alerts': live('weather.alerts', [{
    id: 'a1', event: 'Wind Advisory', severity: 'Moderate', urgency: 'Expected', sender: 'NWS Upton NY',
    ends: '2026-11-27T10:00:00Z', instruction: 'Winds this strong can make driving difficult.  Use extra caution. Secure objects.',
  }]) };
  const [item] = buildBrief(feeds, { now: NOW });
  assert.equal(item.level, 'act');
  assert.equal(item.domain, 'safety');
  assert.match(item.title, /^Wind Advisory until Fri 5:00 AM$/);
  assert.equal(item.action, 'Winds this strong can make driving difficult. Use extra caution.');
  assert.equal(item.evidence[0].kind, 'measured');
});

test('volatility regime thresholds and VIX curve inversion', () => {
  const q = (symbol, last, changePct = 0) => ({ symbol, label: symbol, available: true, last, changePct, group: 'vol' });
  const brief = (vix, vix3m) => buildBrief({ markets: live('markets', [q('^VIX', vix), q('^VIX3M', vix3m)]) }, { now: NOW });
  assert.equal(brief(16, 18).length, 0);
  assert.equal(brief(26.8, 26.3)[0].level, 'watch');
  assert.match(brief(26.8, 26.3)[0].title, /curve inverted/);
  assert.equal(brief(34, 30)[0].level, 'act');
  // No trade calls: the action reviews risk, it never says buy or sell.
  assert.doesNotMatch(brief(34, 30)[0].action, /\b(buy|sell|short|long)\b/i);
});

test('big movers use per-asset thresholds', () => {
  const q = (symbol, changePct, extra = {}) => ({ symbol, label: symbol, available: true, last: 10, prevClose: 9, changePct, ...extra });
  const items = buildBrief({ markets: live('markets', [q('COMP', 7.7), q('SPY', -0.3), q('MAD=X', 1.2, { group: 'watch' }), q('^TNX', -1, { unit: '%', changeBp: -12 })]) }, { now: NOW });
  const movers = items.find((i) => i.id.startsWith('mkt:movers'));
  assert.ok(movers);
  assert.match(movers.title, /COMP \+7\.7%/);
  assert.match(movers.title, /MAD=X/);
  assert.match(movers.title, /\^TNX −?-?12 bp/);
  assert.doesNotMatch(movers.title, /SPY/);
});

test('holiday and early close come from the NYSE calendar', () => {
  const items = buildBrief({}, { now: NOW, session: marketSession(NOW) });
  assert.deepEqual(items.map((i) => i.id), ['session:early:2026-11-27', 'session:holiday:2026-11-26']);
});

test('standing road closures stay off the brief; fresh ones and crashes make it', () => {
  const inc = (id, category, start, extra = {}) => ({ id, category, magnitude: 4, start, from: id, to: 'B', roads: [], distanceKm: 2, ...extra });
  const feeds = { 'local.traffic': live('local.traffic', [
    inc('old-closure', 'Road closed', '2026-06-01T00:00:00Z'),
    inc('new-closure', 'Road closed', '2026-11-26T12:00:00Z'),
    inc('crash', 'Accident', null, { magnitude: 2 }),
  ]) };
  const item = buildBrief(feeds, { now: NOW }).find((i) => i.domain === 'travel');
  assert.equal(item.evidence.length, 2);
  assert.ok(item.evidence.every((e) => !e.text.includes('old-closure')));
  assert.equal(item.level, 'act');
});

test('missing keys collapse into one setup item naming the env vars', () => {
  const items = buildBrief({ 'social.reddit': off('social.reddit', 'no-key', 'REDDIT_CLIENT_ID'), 'local.events': off('local.events', 'no-key', 'TICKETMASTER_API_KEY') }, { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].level, 'setup');
  assert.match(items[0].action, /REDDIT_CLIENT_ID/);
  assert.match(items[0].action, /TICKETMASTER_API_KEY/);
});

test('recurring price-ladder markets never count as odds shifts', () => {
  const ev = (id, title, change) => ({ id, title, volume24h: 500_000, url: null, options: [{ label: 'x', prob: 0.5, change24h: change }], mover: { label: 'x', prob: 0.5, change24h: change } });
  const items = buildBrief({ 'narratives.polymarket': live('narratives.polymarket', [
    ev('1', 'Bitcoin above ___ on November 26?', 0.6),
    ev('2', 'Next Prime Minister of Spain?', 0.12),
  ]) }, { now: NOW });
  assert.deepEqual(items.filter((i) => i.id.startsWith('pm:shift')).map((i) => i.id), ['pm:shift:2']);
});

test('wet window finds the contiguous precipitation run', () => {
  const hours = [10, 20, 70, 90, 60, 30, 10].map((pop, i) => ({ start: new Date(NOW + i * 3600_000).toISOString(), pop, tempF: 40, short: 'Rain' }));
  const w = wetWindow(hours);
  assert.equal(w.peakPop, 90);
  assert.equal(w.start, hours[2].start);
  assert.equal(w.lastHour, hours[4].start);
  assert.equal(wetWindow(hours.map((h) => ({ ...h, pop: 10 }))), null);
});

test('helpers', () => {
  assert.equal(firstSentences('One.  Two!   Three?'), 'One. Two!');
  assert.equal(situationLine([{ level: 'act', title: 'A' }, { level: 'setup', title: 'S' }, { level: 'info', title: 'B' }]), 'A  ·  B');
});
