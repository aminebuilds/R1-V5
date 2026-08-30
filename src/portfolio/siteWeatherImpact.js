/**
 * @file Forecourt & Retail Weather Sensitivity Model.
 * Computes predictive footfall, fuel volume, store basket, and car wash
 * revenue adjustments based on real-time meteorological conditions from Open-Meteo.
 * @module portfolio/siteWeatherImpact
 */

/**
 * Calculate commercial impact of weather on fuel, convenience, and retail sites.
 * @param {{temperatureC?: number, weatherCode?: number, windKph?: number, precipitationMm?: number}} weather
 * @returns {{
 *   alertLevel: 'none'|'moderate'|'severe',
 *   fuelVolumeDeltaPct: number,
 *   storeSalesDeltaPct: number,
 *   carWashDeltaPct: number,
 *   primaryFactor: string,
 *   summary: string,
 *   kpis: Array<{label: string, value: string, direction: 'up'|'down'|'neutral'}>
 * }}
 */
export function calculateWeatherImpact(weather = {}) {
  const temp = Number.isFinite(weather.temperatureC) ? weather.temperatureC : 20;
  const code = Number.isFinite(weather.weatherCode) ? weather.weatherCode : 0;
  const wind = Number.isFinite(weather.windKph) ? weather.windKph : 10;
  const precip = Number.isFinite(weather.precipitationMm) ? weather.precipitationMm : 0;

  let fuelDelta = 0;
  let storeDelta = 0;
  let carWashDelta = 0;
  let alertLevel = 'none';
  let primaryFactor = 'Clear Conditions';

  // Severe storms / Thunderstorms (WMO 95, 96, 99)
  if (code >= 95) {
    fuelDelta = -28;
    storeDelta = +8;
    carWashDelta = -75;
    alertLevel = 'severe';
    primaryFactor = 'Convective Thunderstorm';
  }
  // Snow & Ice (WMO 71-77, 85-86)
  else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    fuelDelta = -35;
    storeDelta = +24;
    carWashDelta = -90;
    alertLevel = 'severe';
    primaryFactor = 'Snow & Frozen Precipitation';
  }
  // Moderate to Heavy Rain (WMO 63, 65, 81, 82)
  else if (code === 63 || code === 65 || code === 81 || code === 82 || precip >= 5) {
    fuelDelta = -18;
    storeDelta = +12;
    carWashDelta = -60;
    alertLevel = 'moderate';
    primaryFactor = 'Heavy Rain';
  }
  // Light Rain / Drizzle (WMO 51-55, 61, 80)
  else if ((code >= 51 && code <= 55) || code === 61 || code === 80 || precip > 0) {
    fuelDelta = -8;
    storeDelta = +4;
    carWashDelta = -35;
    alertLevel = 'moderate';
    primaryFactor = 'Light Rain';
  }
  // Extreme Heat (> 35C / 95F)
  else if (temp >= 35) {
    fuelDelta = +6;
    storeDelta = +22;
    carWashDelta = +15;
    alertLevel = 'moderate';
    primaryFactor = 'Extreme Heat Wave';
  }
  // Sub-Zero Freezing (< 0C / 32F)
  else if (temp <= 0) {
    fuelDelta = -14;
    storeDelta = +18;
    carWashDelta = -40;
    alertLevel = 'moderate';
    primaryFactor = 'Sub-Zero Freezing Temperature';
  }
  // High Winds (> 50 km/h)
  else if (wind >= 50) {
    fuelDelta = -10;
    storeDelta = -5;
    carWashDelta = -30;
    alertLevel = 'moderate';
    primaryFactor = 'High Wind Advisory';
  }
  // Optimal / Clear
  else {
    fuelDelta = +3;
    storeDelta = +2;
    carWashDelta = +20;
    alertLevel = 'none';
    primaryFactor = 'Optimal Clear Sky';
  }

  const formatPct = (num) => (num >= 0 ? `+${num}%` : `${num}%`);

  const summary = alertLevel === 'severe'
    ? `Severe weather: ${primaryFactor} reducing fuel throughput by ${formatPct(fuelDelta)} and car wash by ${formatPct(carWashDelta)}.`
    : alertLevel === 'moderate'
      ? `${primaryFactor}: Fuel volume ${formatPct(fuelDelta)}, store basket ${formatPct(storeDelta)}.`
      : `Optimal conditions: Forecourt traffic and car wash demand running above baseline.`;

  return {
    alertLevel,
    fuelVolumeDeltaPct: fuelDelta,
    storeSalesDeltaPct: storeDelta,
    carWashDeltaPct: carWashDelta,
    primaryFactor,
    summary,
    kpis: [
      {
        label: 'Fuel Volume',
        value: formatPct(fuelDelta),
        direction: fuelDelta > 0 ? 'up' : fuelDelta < 0 ? 'down' : 'neutral',
      },
      {
        label: 'Inside Store Basket',
        value: formatPct(storeDelta),
        direction: storeDelta > 0 ? 'up' : storeDelta < 0 ? 'down' : 'neutral',
      },
      {
        label: 'Car Wash Revenue',
        value: formatPct(carWashDelta),
        direction: carWashDelta > 0 ? 'up' : carWashDelta < 0 ? 'down' : 'neutral',
      },
    ],
  };
}
