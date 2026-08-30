import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeatherImpact } from './siteWeatherImpact.js';

test('calculateWeatherImpact: severe thunderstorm reduces fuel and car wash volume', () => {
  const impact = calculateWeatherImpact({ weatherCode: 95, temperatureC: 22 });
  assert.equal(impact.alertLevel, 'severe');
  assert.equal(impact.fuelVolumeDeltaPct, -28);
  assert.equal(impact.carWashDeltaPct, -75);
  assert.equal(impact.storeSalesDeltaPct, 8);
  assert.match(impact.summary, /Convective Thunderstorm/);
});

test('calculateWeatherImpact: snow storm causes major car wash drop and hot food spike', () => {
  const impact = calculateWeatherImpact({ weatherCode: 73, temperatureC: -2 });
  assert.equal(impact.alertLevel, 'severe');
  assert.equal(impact.fuelVolumeDeltaPct, -35);
  assert.equal(impact.storeSalesDeltaPct, 24);
  assert.equal(impact.carWashDeltaPct, -90);
});

test('calculateWeatherImpact: extreme heat wave drives cold beverage basket', () => {
  const impact = calculateWeatherImpact({ weatherCode: 0, temperatureC: 38 });
  assert.equal(impact.alertLevel, 'moderate');
  assert.equal(impact.storeSalesDeltaPct, 22);
  assert.equal(impact.fuelVolumeDeltaPct, 6);
});

test('calculateWeatherImpact: clear skies yield baseline performance', () => {
  const impact = calculateWeatherImpact({ weatherCode: 0, temperatureC: 21, precipitationMm: 0 });
  assert.equal(impact.alertLevel, 'none');
  assert.equal(impact.fuelVolumeDeltaPct, 3);
  assert.equal(impact.carWashDeltaPct, 20);
});
