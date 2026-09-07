import test from 'node:test';
import assert from 'node:assert/strict';

import { esNumber, esPrice, parseFrenchStations, parseSpanishStations } from '../vite.config.js';

// ── Spanish ministry feed ───────────────────────────────────────────────────

test('esNumber converts the feed\'s comma decimals', () => {
  assert.equal(esNumber('1,934'), 1.934);
  assert.equal(esNumber('2,035'), 2.035);
});

test('esNumber keeps negatives — most Spanish longitudes are west of Greenwich', () => {
  // Rejecting negatives here would silently drop every station in western
  // Spain and all of the Canaries.
  assert.equal(esNumber('-3,773917'), -3.773917);
  assert.equal(esNumber('-16,25'), -16.25);
});

test('esNumber reports missing values as null', () => {
  assert.equal(esNumber(''), null);
  assert.equal(esNumber('   '), null);
  assert.equal(esNumber(null), null);
  assert.equal(esNumber(undefined), null);
  assert.equal(esNumber('not a number'), null);
});

test('an unsold grade is null, never zero', () => {
  // The live feed uses an EMPTY STRING for a grade a station does not stock.
  // Number('') is 0 and is finite, so a naive parse publishes a €0.000 price
  // that undercuts every real competitor in any comparison built on it.
  assert.equal(esPrice(''), null);
  assert.equal(esPrice('   '), null);
  assert.equal(esPrice(null), null);
  assert.equal(esPrice('0'), null, 'a literal zero price is not a real price either');
  assert.equal(esPrice('-1,20'), null, 'nor is a negative one');
  assert.equal(esPrice('1,925'), 1.925);
});

const SPANISH_ROW = {
  'IDEESS': '4629',
  'Rótulo': 'REPSOL',
  'Dirección': 'CL ALAVA, S.N.',
  'Municipio': 'Leganés',
  'Provincia': 'MADRID',
  'Latitud': '40,35725',
  'Longitud (WGS84)': '-3,773917',
  'Precio Gasolina 95 E5': '1,925',
  'Precio Gasolina 98 E5': '2,035',
  'Precio Gasoleo A': '1,909',
};

test('parseSpanishStations maps a real row to the shared shape', () => {
  const [station] = parseSpanishStations({ ListaEESSPrecio: [SPANISH_ROW] });
  assert.equal(station.id, 'fuel:es:4629');
  assert.equal(station.brand, 'REPSOL');
  assert.equal(station.country, 'es');
  assert.equal(station.unit, 'eur/l');
  assert.ok(Math.abs(station.lat - 40.35725) < 1e-6);
  assert.ok(Math.abs(station.lon - -3.773917) < 1e-6);
  assert.match(station.address, /Leganés/);
  assert.deepEqual(station.prices, { gasoline95: 1.925, gasoline98: 2.035, diesel: 1.909 });
});

test('a station not stocking 98 reports null for it, not a zero price', () => {
  const [station] = parseSpanishStations({
    ListaEESSPrecio: [{ ...SPANISH_ROW, 'Precio Gasolina 98 E5': '' }],
  });
  assert.equal(station.prices.gasoline98, null);
  assert.equal(station.prices.gasoline95, 1.925);
});

test('parseSpanishStations drops rows with no usable coordinates', () => {
  const stations = parseSpanishStations({
    ListaEESSPrecio: [{ ...SPANISH_ROW, 'Latitud': '' }],
  });
  assert.deepEqual(stations, []);
});

test('parseSpanishStations drops rows selling neither petrol nor diesel', () => {
  const stations = parseSpanishStations({
    ListaEESSPrecio: [{
      ...SPANISH_ROW,
      'Precio Gasolina 95 E5': '',
      'Precio Gasoleo A': '',
    }],
  });
  assert.deepEqual(stations, []);
});

test('parseSpanishStations survives a malformed payload', () => {
  assert.deepEqual(parseSpanishStations(null), []);
  assert.deepEqual(parseSpanishStations({}), []);
  assert.deepEqual(parseSpanishStations({ ListaEESSPrecio: 'nope' }), []);
});

// ── French Opendatasoft feed ────────────────────────────────────────────────

const FRENCH_ROW = {
  id: 75016001,
  latitude: '4884700',
  longitude: '225600',
  ville: 'Paris',
  adresse: '1 Avenue du Général Sarrail',
  gazole_prix: 2.35,
  sp95_prix: null,
  sp98_prix: 2.3,
  e10_prix: 2.25,
};

test('parseFrenchStations scales the ×100000 integer coordinates', () => {
  const [station] = parseFrenchStations([FRENCH_ROW]);
  assert.ok(Math.abs(station.lat - 48.847) < 1e-6);
  assert.ok(Math.abs(station.lon - 2.256) < 1e-6);
});

test('parseFrenchStations handles western France\'s negative longitudes', () => {
  const [station] = parseFrenchStations([{ ...FRENCH_ROW, longitude: '-234500' }]);
  assert.ok(Math.abs(station.lon - -2.345) < 1e-6);
});

test('E10 stands in for SP95 and says so', () => {
  const [station] = parseFrenchStations([FRENCH_ROW]);
  assert.equal(station.prices.gasoline95, 2.25);
  assert.equal(station.prices.gasolineE10, 2.25);
  // Without this a caller would silently compare an E10 price against an
  // SP95 one and read the grade difference as a competitive gap.
  assert.equal(station.gasoline95Grade, 'E10');
});

test('a real SP95 price takes precedence over E10', () => {
  const [station] = parseFrenchStations([{ ...FRENCH_ROW, sp95_prix: 2.4 }]);
  assert.equal(station.prices.gasoline95, 2.4);
  assert.equal(station.prices.gasolineE10, 2.25);
  assert.equal(station.gasoline95Grade, 'SP95');
});

test('a missing French grade is null, not zero', () => {
  const [station] = parseFrenchStations([{ ...FRENCH_ROW, sp98_prix: null, gazole_prix: '' }]);
  assert.equal(station.prices.gasoline98, null);
  assert.equal(station.prices.diesel, null);
});

test('parseFrenchStations drops rows with no id or coordinates', () => {
  assert.deepEqual(parseFrenchStations([{ ...FRENCH_ROW, id: undefined }]), []);
  assert.deepEqual(parseFrenchStations([{ ...FRENCH_ROW, latitude: 'abc' }]), []);
});

test('parseFrenchStations survives a malformed payload', () => {
  assert.deepEqual(parseFrenchStations(null), []);
  assert.deepEqual(parseFrenchStations('nope'), []);
});
