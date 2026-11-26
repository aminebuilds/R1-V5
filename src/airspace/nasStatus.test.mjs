import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closureKind, nasSampleCounts, notamWindow, parseNasStatusXml } from './nasStatus.js';

// The FAA feed as it read at 02:57Z on 2026-11-14, two hours after the
// nationwide ground stop lifted (trimmed to the blocks that matter).
const AFTER_LIFT = `<AIRPORT_STATUS_INFORMATION><Update_Time>Sat Nov 14 02:57:12 2026 GMT</Update_Time><Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SAN</ARPT><Reason>airport volume</Reason><Avg>34 minutes</Avg><Max>1 hour and 21 minutes</Max></Ground_Delay><Ground_Delay><ARPT>SFO</ARPT><Reason>wind</Reason><Avg>2 hours and 18 minutes</Avg><Max>11 hours and 30 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 2605271826-2705281600</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport><Airport><ARPT>DCA</ARPT><Reason>!DCA 11/261 DCA AD AP CLSD TO DIVERSION ACFT 2611140004-2611141100</Reason><Start>Nov 14 at 00:04 UTC.</Start><Reopen>Nov 14 at 11:00 UTC.</Reopen></Airport><Airport><ARPT>BDL</ARPT><Reason>!BDL 11/082 BDL AD AP CLSD TO NON SKED INTL AIR CARRIERS EXC 6HR PPR 860-627-3001. 2611132139-2611140500</Reason><Start>Nov 13 at 21:39 UTC.</Start><Reopen>Nov 14 at 05:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>FLL</ARPT><Reason>!FLL 11/142 FLL AD AP CLSD TO DIVERSION ACFT DUE TO CAPACITY 2611140038-2611140900</Reason><Start>Nov 14 at 00:38 UTC.</Start><Reopen>Nov 14 at 09:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;

// Ground stops and arrival/departure delays in the feed's published shape.
const ACTIVE = `<AIRPORT_STATUS_INFORMATION><Update_Time>Fri Nov 13 21:10:00 2026 GMT</Update_Time><Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List><Program><ARPT>ORD</ARPT><Reason>equipment / outage</Reason><End_Time>4:45 pm CST</End_Time></Program><Program><ARPT>MDW</ARPT><Reason>equipment / outage</Reason><End_Time>4:45 pm CST</End_Time></Program></Ground_Stop_List></Delay_type><Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>JFK</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Arrival"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure><Arrival_Departure Type="Departure"><Min>31 minutes</Min><Max>45 minutes</Max><Trend>Steady</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;

test('ground delay programs and the feed timestamp are read as published', () => {
  const nas = parseNasStatusXml(AFTER_LIFT, { now: Date.parse('2026-11-14T02:57:12Z') });
  assert.equal(nas.updatedAt, '2026-11-14T02:57:12.000Z');
  assert.deepEqual(nas.groundDelays.map((item) => [item.airport, item.reason, item.avg]), [
    ['SAN', 'airport volume', '34 minutes'],
    ['SFO', 'wind', '2 hours and 18 minutes'],
  ]);
  assert.equal(nas.groundStops.length, 0);
});

test('closures split across two blocks are merged and classified', () => {
  const nas = parseNasStatusXml(AFTER_LIFT, { now: Date.parse('2026-11-14T02:57:12Z') });
  const byAirport = Object.fromEntries(nas.closures.map((item) => [item.airport, item]));
  assert.deepEqual(Object.keys(byAirport).sort(), ['BDL', 'DCA', 'FLL', 'LAX']);
  assert.equal(byAirport.DCA.kind, 'diversion');
  assert.equal(byAirport.FLL.kind, 'diversion');
  assert.equal(byAirport.BDL.kind, 'intl-carriers');
  assert.equal(byAirport.LAX.kind, 'ga-ppr');
  // The standing GA notice from May is not news; the diversion closures are.
  assert.equal(byAirport.LAX.recent, false);
  assert.equal(byAirport.DCA.recent, true);
  assert.equal(byAirport.DCA.end, '2026-11-14T11:00:00.000Z');
});

test('ground stops and both legs of an airport delay are kept', () => {
  const nas = parseNasStatusXml(ACTIVE, { now: Date.parse('2026-11-13T21:10:00Z') });
  assert.deepEqual(nas.groundStops.map((item) => item.airport), ['ORD', 'MDW']);
  assert.equal(nas.groundStops[0].endTime, '4:45 pm CST');
  assert.deepEqual(nas.delays.map((item) => [item.airport, item.type, item.max]), [
    ['JFK', 'Arrival', '30 minutes'],
    ['JFK', 'Departure', '45 minutes'],
  ]);
});

test('sample counts exclude standing GA notices', () => {
  const counts = nasSampleCounts(parseNasStatusXml(AFTER_LIFT, { now: Date.parse('2026-11-14T02:57:12Z') }));
  assert.deepEqual(counts, { groundStops: 0, groundDelays: 2, delays: 0, newClosures: 3, airports: ['SAN', 'SFO'] });
  assert.equal(nasSampleCounts(null), null);
});

test('a document that is not the FAA feed is refused, not parsed as "no programs"', () => {
  assert.throws(() => parseNasStatusXml('<html>Service Unavailable</html>'), /Not an FAA airport status document/);
  assert.throws(() => parseNasStatusXml(''), /Not an FAA/);
});

test('NOTAM windows and closure kinds', () => {
  assert.deepEqual(notamWindow('CLSD 2611140038-2611140900'), { start: '2026-11-14T00:38:00.000Z', end: '2026-11-14T09:00:00.000Z' });
  assert.deepEqual(notamWindow('no window here'), { start: null, end: null });
  assert.equal(closureKind('SUA AD AP CLSD EXC AIRSHOW ACFT'), 'event');
  assert.equal(closureKind('RWY 10/28 CLSD'), 'other');
});
