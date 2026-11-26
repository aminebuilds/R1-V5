import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRSPACE_EVENTS, EVENT_RELEVANCE_MS, activeAirspaceEvent } from './events.js';

test('every marker and fact in an event record names a source', () => {
  for (const event of AIRSPACE_EVENTS) {
    for (const item of [...event.markers, ...event.facts]) {
      assert.ok(item.sources.length > 0, `${event.id}: ${item.label} has no source`);
      for (const source of item.sources) {
        assert.ok(source.outlet, `${event.id}: ${item.label} has a source without an outlet`);
        // Press facts link to the article; facts R.1 measured itself say so.
        if (source.url) assert.match(source.url, /^https:\/\//);
        else assert.match(source.outlet, /measured by R\.1/);
      }
    }
  }
});

test('event records are internally consistent', () => {
  for (const event of AIRSPACE_EVENTS) {
    const times = event.markers.map((marker) => Date.parse(marker.at));
    assert.ok(times.every(Number.isFinite), `${event.id}: marker time unparsable`);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `${event.id}: markers out of order`);
    assert.equal(new Set(event.markers.map((marker) => marker.key)).size, event.markers.length);
    assert.ok(Date.parse(event.stop.start) < Date.parse(event.stop.end));
    assert.ok(Date.parse(event.window.from) <= Date.parse(event.stop.start));
    assert.ok(Number.isFinite(Date.parse(event.checkedAt)));
    // Direct quotes stay short.
    for (const fact of event.facts) {
      for (const quote of fact.text.match(/"[^"]+"/g) || []) {
        assert.ok(quote.split(/\s+/).length <= 15, `${event.id}: long quote in ${fact.label}`);
      }
    }
  }
});

test('the ground-stop record is the active event for a week after its window', () => {
  const event = AIRSPACE_EVENTS[0];
  const end = Date.parse(event.window.to);
  assert.equal(activeAirspaceEvent(Date.parse('2026-11-14T17:00:00Z'))?.id, 'faa-ground-stop-2026-11-13');
  assert.equal(activeAirspaceEvent(end + EVENT_RELEVANCE_MS - 1)?.id, event.id);
  assert.equal(activeAirspaceEvent(end + EVENT_RELEVANCE_MS + 1), null);
  assert.equal(activeAirspaceEvent(Date.parse('2026-11-01T00:00:00Z')), null);
});
