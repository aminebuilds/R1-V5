import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './feeds.js';
import { REPORT_TITLE_FILTERS } from './sources.js';
import { buildBrief, PLAYBOOKS } from './recommend.js';
import { escapeRoute, gaugeShortName, gaugeState } from './mapModel.js';
import { HttpError, createJarvisService } from './jarvisService.js';

const HOME = { lat: 40.7347, lon: -74.1644 };
const NOW = Date.parse('2026-11-26T17:00:00Z');
const live = (id, data) => ({ id, label: id, kind: 'measured', data, source: { name: id } });

const gauge = (lid, name, lat, lon, obsCat, obsStage, fcCat = 'fcst_not_current', fcStage = -999) => ({
  lid, name, latitude: lat, longitude: lon,
  status: { observed: { primary: obsStage, primaryUnit: 'ft', floodCategory: obsCat, validTime: '2026-11-26T16:00:00Z' },
    forecast: { primary: fcStage, primaryUnit: 'ft', floodCategory: fcCat, validTime: '2026-11-27T02:00:00Z' } },
});

test('NWPS gauges: categories, tidal flag, -999 as missing, out-of-service dropped, nearest first', () => {
  const list = F.parseNwpsGauges({ gauges: [
    gauge('BATN6', 'New York Harbor at The Battery (IN MLLW)', 40.7006, -74.0142, 'minor', 7.05, 'moderate', 8.9),
    gauge('NWKN4', 'Passaic River at Newark (IN MLLW)', 40.713, -74.123, 'moderate', 8.56),
    gauge('MWLN4', 'at Midwood', 40.917, -74.278, 'out_of_service', -999),
  ] }, HOME);
  assert.deepEqual(list.map((g) => g.id), ['NWKN4', 'BATN6']);
  assert.equal(list[0].name, 'Passaic River at Newark');
  assert.equal(list[0].tidal, true);
  assert.equal(list[0].forecast.stage, null);
  assert.equal(F.gaugeRank(list[1]), 3);
  const s = gaugeState(list[1]);
  assert.equal(s.label, 'Minor flood → Moderate flood');
  assert.equal(gaugeShortName('Passaic River at Newark'), 'Passaic @ Newark');
});

test('NDBC: newest row for wind, newest non-missing row for waves, metric to imperial', () => {
  const txt = [
    '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE',
    '#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft',
    '2026 11 26 16 40  60 20.0 24.0    MM    MM    MM  MM 1021.3  10.5  13.9   7.8   MM   MM    MM',
    '2026 11 26 16 20  50 19.0 23.0   4.2    10   7.1 130 1021.9  10.5  13.8   7.8   MM   MM    MM',
  ].join('\n');
  const b = F.parseNdbc(txt, { now: NOW });
  assert.equal(b.windKt, 39);
  assert.equal(b.gustKt, 47);
  assert.equal(b.waveHeightFt, 13.8);
  assert.equal(b.dominantPeriodS, 10);
  assert.equal(b.waveFrom, 'SE');
  assert.equal(F.parseNdbc(txt, { now: NOW + 24 * 3600_000 }), null);
});

test('safe places: Overpass and Nominatim shapes, deduped, nearest first; escape routes skip non-ER hospitals', () => {
  const places = F.parseSafePlaces({ elements: [
    { type: 'node', id: 1, lat: 40.741, lon: -74.191, tags: { amenity: 'hospital', name: 'University Hospital', emergency: 'yes' } },
    { type: 'way', id: 2, center: { lat: 40.76, lon: -74.30 }, tags: { amenity: 'hospital', name: 'Kessler Institute for Rehabilitation' } },
    { type: 'node', id: 3, lat: 40.77, lon: -74.185, tags: { amenity: 'police', name: 'Precinct 7' } },
    { type: 'node', id: 4, lat: 40.77, lon: -74.185, tags: { amenity: 'police', name: 'Precinct 7' } },
    { type: 'node', id: 5, lat: 40.75, lon: -74.2, tags: { amenity: 'fire_station' } },
  ] }, HOME);
  assert.deepEqual(places.map((p) => `${p.kind}:${p.name}`).sort(), ['hospital:Kessler Institute for Rehabilitation', 'hospital:University Hospital', 'police:Precinct 7']);
  const nom = F.parseNominatimPlaces([
    { category: 'amenity', type: 'hospital', name: 'Newark Beth Israel', lat: '40.71', lon: '-74.213', extratags: { emergency: 'yes' }, osm_type: 'way', osm_id: 9 },
    { category: 'amenity', type: 'clinic', name: 'Walk-in', lat: '40.72', lon: '-74.2' },
  ], 'hospital', HOME);
  assert.deepEqual(nom.map((p) => [p.name, p.emergency]), [['Newark Beth Israel', 'yes']]);
  assert.deepEqual(F.pickRouteHospitals([...places, ...nom]).map((p) => p.name), ['University Hospital', 'Newark Beth Israel']);
});

test('FEMA shelters, TFRs, OSRM and elevation parse as published', () => {
  const sh = F.parseFemaShelters({ features: [{ attributes: { shelter_name: 'HS Gym', address: '1 A St', city: 'Newark', state: 'NJ', shelter_status: 'OPEN', latitude: 40.74, longitude: -74.17 } }] }, HOME);
  assert.equal(sh[0].kind, 'open-shelter');
  assert.ok(sh[0].distanceKm < 1.5);
  assert.deepEqual(F.parseTfrList([{ notam_id: '6/1', type: 'SECURITY', state: 'NJ', description: 'Bedminster, NJ' }, { notam_id: '6/2', state: 'MO' }], ['NJ', 'NY']).map((t) => t.id), ['6/1']);
  const r = F.parseOsrmRoute({ code: 'Ok', routes: [{ duration: 330, distance: 2800, geometry: { coordinates: [[-74.16, 40.73], [-74.18, 40.74]] } }] });
  assert.deepEqual([r.durationMin, r.distanceKm, r.path.length], [6, 2.8, 2]);
  assert.throws(() => F.parseOsrmRoute({ code: 'NoRoute' }), /Unexpected/);
  assert.deepEqual(F.parseElevations({ elevation: [56.2, 75] }, 2), [56, 75]);
});

test('report headlines must be about the thing in their own title', () => {
  const uap = F.filterTitles([
    { title: 'Drone sightings reported over Morris County, NJ' },
    { title: "'A storm to be remembered': New Jersey damage" },
    { title: '2 killed after Iranian drones intercepted in Kuwait' },
  ], REPORT_TITLE_FILTERS.uap);
  assert.deepEqual(uap.map((n) => n.title), ['Drone sightings reported over Morris County, NJ']);
  const fin = F.filterTitles([
    { title: 'Halfords Hit by Third-Party Cyberattack' },
    { title: 'Chase banking app down for thousands of customers' },
  ], REPORT_TITLE_FILTERS.finsec);
  assert.deepEqual(fin.map((n) => n.title), ['Chase banking app down for thousands of customers']);
});

test('flood rule: coastal flooding is a watch with the pre-planned route; a nearby river at moderate is act', () => {
  const safety = live('safety.places', { homeElevationM: 56, routes: [{ to: { name: 'University Hospital', kind: 'hospital', elevationM: 75 }, durationMin: 6, distanceKm: 4.1, path: [[-74.2, 40.7], [-74.19, 40.74]] }] });
  const coastal = F.parseNwpsGauges({ gauges: [gauge('NWKN4', 'Passaic River at Newark (IN MLLW)', 40.713, -74.123, 'moderate', 8.56)] }, HOME);
  const [w] = buildBrief({ 'water.gauges': live('water.gauges', coastal), 'safety.places': safety }, { now: NOW });
  assert.equal(w.level, 'watch');
  assert.match(w.title, /^Coastal flooding: Passaic River at Newark — moderate flood$/);
  assert.match(w.action, /Pre-planned route: University Hospital, 6 min \/ 4\.1 km by car \(75 m elevation vs home 56 m\)\. The route does not know which roads are flooded\./);
  assert.deepEqual(w.playbook, PLAYBOOKS.flood);
  const river = F.parseNwpsGauges({ gauges: [gauge('X', 'Example Creek at Riverton', 40.75, -74.18, 'moderate', 9)] }, HOME);
  assert.equal(buildBrief({ 'water.gauges': live('water.gauges', river) }, { now: NOW })[0].level, 'act');
  assert.equal(escapeRoute({ 'safety.places': safety }, [{ id: 'flood:x', level: 'watch' }]).urgent, true);
  assert.equal(escapeRoute({ 'safety.places': safety }, [{ id: 'mkt:vix', level: 'watch' }]).urgent, false);
});

test('TFRs, power and payment incidents carry the right levels and playbooks; NWS flood alerts get the flood playbook', () => {
  const at = new Date(NOW - 3600_000).toISOString();
  const items = buildBrief({
    'airspace.tfr': live('airspace.tfr', [{ id: '6/1', type: 'SECURITY', state: 'NJ', description: 'Bedminster, NJ', url: 'https://tfr.faa.gov/tfr3/' }]),
    'news.power': live('news.power', [{ title: 'Power outage disrupts parts of East Riverton', url: 'https://x/1', source: 'TAPinto', at }]),
    'news.finsec': live('news.finsec', [{ title: 'Chase banking app down', url: 'https://x/2', source: 'CNBC', at }]),
    'weather.alerts': live('weather.alerts', [{ id: 'a', event: 'Coastal Flood Warning', severity: 'Moderate', urgency: 'Expected', ends: '2026-11-27T10:00:00Z' }]),
  }, { now: NOW });
  const byPrefix = (p) => items.find((i) => i.id.startsWith(p));
  assert.equal(byPrefix('tfr:').level, 'watch');
  assert.deepEqual(byPrefix('power:').playbook, PLAYBOOKS.power);
  assert.deepEqual(byPrefix('finsec:').playbook, PLAYBOOKS.finsec);
  assert.deepEqual(byPrefix('nws:').playbook, PLAYBOOKS.flood);
});

test('safe places fall back to Nominatim when every Overpass mirror fails; routes start from the coarsened home', async () => {
  const asked = [];
  const fetchText = async (url) => {
    asked.push(url);
    if (url.includes('overpass')) throw new HttpError(502);
    if (url.includes('nominatim') && url.includes('q=hospital')) return JSON.stringify([{ category: 'amenity', type: 'hospital', name: 'General Hospital', lat: '40.74', lon: '-74.17', extratags: { emergency: 'yes' } }]);
    if (url.includes('nominatim')) return '[]';
    if (url.includes('OpenShelters')) return JSON.stringify({ features: [] });
    if (url.includes('elevation')) return JSON.stringify({ elevation: [56, 40] });
    if (url.includes('routing.openstreetmap.de')) return JSON.stringify({ code: 'Ok', routes: [{ duration: 300, distance: 2000, geometry: { coordinates: [[-74.16, 40.73], [-74.17, 40.74]] } }] });
    throw new HttpError(503);
  };
  const svc = createJarvisService({ env: { JARVIS_HOME_LAT: '40.73468', JARVIS_HOME_LON: '-74.16437' }, fetchText, fetchBytes: async () => new Uint8Array(1), log: () => {}, now: () => NOW });
  await svc.getSnapshot({ deadlineMs: 50 });
  await new Promise((r) => setTimeout(r, 3_000));
  const snap = await svc.getSnapshot({ deadlineMs: 2000 });
  const s = snap.feeds['safety.places'];
  assert.equal(s.kind, 'measured');
  assert.equal(s.data.provider, 'nominatim');
  assert.equal(s.data.routes[0].to.name, 'General Hospital');
  const route = asked.find((u) => u.includes('routing.openstreetmap.de'));
  assert.match(route, /driving\/-74\.16400,40\.73500;/, 'origin is rounded to 3 decimals');
  assert.equal(await svc.getFloodZoneImage(1), null, 'only the advertised day is served');
});
