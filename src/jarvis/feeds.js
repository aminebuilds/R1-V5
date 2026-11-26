/**
 * @file Jarvis feed parsers — one pure function per upstream payload.
 *
 * Every parser takes exactly what the source published and returns a small,
 * typed object. No parser invents a value: a field the source left null stays
 * null, and a payload that doesn't have the expected shape throws so the
 * service reports the feed as unavailable instead of rendering a blank as a
 * zero. Unit conversions (°C→°F, km/h→mph, Pa→inHg) are arithmetic on the
 * published value, not estimates.
 *
 * Pure: no network, no DOM, no clock unless one is passed in.
 *
 * @module jarvis/feeds
 */

import { CONSUMER_VENDORS, INCIDENT_TERMS_RE, NOT_CURRENT_RE, SECURITY_TERMS_RE } from './sources.js';

// ── shared helpers ──────────────────────────────────────────────────────────

/** Finite number or null. */
export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Round to `digits` decimals, preserving null. */
export function round(value, digits = 1) {
  const n = num(value);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** ISO string from a parseable date, else null. */
export function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass label for a bearing in degrees. */
export function compass(deg) {
  const d = num(deg);
  if (d === null) return null;
  return COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
}

/** Decode the XML/HTML entities RSS feeds actually use, strip tags, squeeze space. */
export function decodeText(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** First `<tag>` text in an XML block (namespaced tags allowed), decoded. */
export function xmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i').exec(String(block || ''));
  return match ? decodeText(match[1]) : '';
}

/** Keep only http(s) links. */
function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Evenly thin a series to at most `max` points, always keeping the last. */
export function thin(values, max = 48) {
  if (!Array.isArray(values) || values.length <= max) return values || [];
  const step = (values.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(values[Math.round(i * step)]);
  return out;
}

function requireShape(condition, what) {
  if (!condition) throw new Error(`Unexpected ${what} payload`);
}

// ── home ────────────────────────────────────────────────────────────────────

/**
 * US Census geocoder (geographies/onelineaddress).
 * @returns {{lat:number, lon:number, matchedAddress:string, municipality:string|null,
 *   county:string|null, countyFips:string|null, state:string|null, zip:string|null, tract:string|null}|null}
 */
export function parseCensusGeocode(payload) {
  requireShape(payload?.result && Array.isArray(payload.result.addressMatches), 'Census geocoder');
  const match = payload.result.addressMatches[0];
  if (!match) return null;
  const lat = num(match.coordinates?.y);
  const lon = num(match.coordinates?.x);
  if (lat === null || lon === null) return null;
  const geos = match.geographies || {};
  const county = geos.Counties?.[0] || null;
  const sub = geos['County Subdivisions']?.[0] || null;
  const state = geos.States?.[0] || null;
  const tract = geos['Census Tracts']?.[0] || null;
  return {
    lat,
    lon,
    matchedAddress: String(match.matchedAddress || ''),
    municipality: sub?.NAME || null,
    county: county?.NAME || null,
    countyFips: county ? `${county.STATE}${county.COUNTY}` : null,
    state: state?.STUSAB || match.addressComponents?.state || null,
    zip: match.addressComponents?.zip || null,
    tract: tract?.GEOID || null,
  };
}

// ── weather (NWS) ───────────────────────────────────────────────────────────

/** NWS /points metadata: forecast endpoints, station list, zones. */
export function parseNwsPoint(payload) {
  const p = payload?.properties;
  requireShape(p && p.forecastHourly && p.observationStations, 'NWS point');
  return {
    office: p.gridId || null,
    gridX: num(p.gridX),
    gridY: num(p.gridY),
    forecastUrl: p.forecast,
    forecastHourlyUrl: p.forecastHourly,
    stationsUrl: p.observationStations,
    forecastZone: String(p.forecastZone || '').split('/').pop() || null,
    countyZone: String(p.county || '').split('/').pop() || null,
    nearestPlace: p.relativeLocation?.properties
      ? `${p.relativeLocation.properties.city}, ${p.relativeLocation.properties.state}`
      : null,
    timeZone: p.timeZone || 'America/New_York',
  };
}

/** NWS station list → ordered `[{id, name}]` (NWS returns nearest first). */
export function parseNwsStations(payload) {
  requireShape(Array.isArray(payload?.features), 'NWS stations');
  return payload.features
    .map((f) => ({ id: f?.properties?.stationIdentifier, name: f?.properties?.name || null }))
    .filter((s) => typeof s.id === 'string' && /^[A-Z0-9]{3,5}$/.test(s.id));
}

function quantity(q, kind) {
  const value = num(q?.value);
  if (value === null) return null;
  const unit = String(q?.unitCode || '');
  switch (kind) {
    case 'tempF': return unit.endsWith('degF') ? value : value * 9 / 5 + 32;
    case 'mph':
      if (unit.endsWith('m_s-1')) return value * 2.236936;
      if (unit.endsWith('mi_h-1')) return value;
      return value / 1.609344; // km_h-1, NWS default
    case 'inHg': return value / 3386.389;
    case 'mi': return value / 1609.344;
    case 'in': return value / 25.4;
    default: return value;
  }
}

/**
 * NWS latest observation — the measured "now". Readings the station did not
 * report stay null.
 */
export function parseNwsObservation(payload, station = null) {
  const p = payload?.properties;
  requireShape(p && p.timestamp, 'NWS observation');
  const tempF = quantity(p.temperature, 'tempF');
  const windChillF = quantity(p.windChill, 'tempF');
  const heatIndexF = quantity(p.heatIndex, 'tempF');
  const windDir = num(p.windDirection?.value);
  return {
    station: station || { id: String(p.station || '').split('/').pop() || null, name: null },
    observedAt: iso(p.timestamp),
    text: p.textDescription || null,
    tempF: round(tempF, 0),
    dewpointF: round(quantity(p.dewpoint, 'tempF'), 0),
    humidity: round(p.relativeHumidity?.value, 0),
    windMph: round(quantity(p.windSpeed, 'mph'), 0),
    windGustMph: round(quantity(p.windGust, 'mph'), 0),
    windDirDeg: windDir,
    windFrom: compass(windDir),
    pressureInHg: round(quantity(p.barometricPressure, 'inHg'), 2),
    visibilityMi: round(quantity(p.visibility, 'mi'), 1),
    precipLastHourIn: round(quantity(p.precipitationLastHour, 'in'), 2),
    windChillF: round(windChillF, 0),
    heatIndexF: round(heatIndexF, 0),
    feelsLikeF: round(windChillF ?? heatIndexF ?? tempF, 0),
  };
}

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

/** NWS active alerts for the home point, most severe first. */
export function parseNwsAlerts(payload) {
  requireShape(Array.isArray(payload?.features), 'NWS alerts');
  const out = [];
  for (const feature of payload.features) {
    const p = feature?.properties;
    if (!p || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    out.push({
      id: String(p.id || feature.id || ''),
      event: p.event || 'Alert',
      severity: p.severity || 'Unknown',
      urgency: p.urgency || 'Unknown',
      certainty: p.certainty || 'Unknown',
      headline: p.headline || null,
      description: String(p.description || '').trim().slice(0, 1600) || null,
      instruction: String(p.instruction || '').trim().slice(0, 1000) || null,
      onset: iso(p.onset || p.effective),
      expires: iso(p.expires),
      ends: iso(p.ends),
      sender: p.senderName || null,
      area: p.areaDesc || null,
      url: safeUrl(p['@id'] || feature.id),
      // Drawn on the map: the alert's own polygon when NWS sends one,
      // otherwise the service resolves these zone URLs to their outlines.
      areas: geometryRings(feature.geometry),
      zones: (Array.isArray(p.affectedZones) ? p.affectedZones : []).filter((z) => /^https:\/\/api\.weather\.gov\/zones\//.test(z)).slice(0, 4),
    });
  }
  return out.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
    || String(a.onset).localeCompare(String(b.onset)));
}

/**
 * GeoJSON Polygon / MultiPolygon → outer rings as `[[lon, lat], …]`, each
 * thinned to at most `maxPoints` vertices (drawing, not measurement).
 * @returns {Array<Array<[number, number]>>}
 */
export function geometryRings(geometry, maxPoints = 240) {
  if (!geometry || typeof geometry !== 'object') return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
      : geometry.type === 'GeometryCollection' ? (geometry.geometries || []).flatMap((g) => geometryRings(g, maxPoints).map((r) => [r]))
        : [];
  return polygons
    .map((poly) => (Array.isArray(poly) ? poly[0] : null))
    .filter((ring) => Array.isArray(ring) && ring.length >= 4)
    .map((ring) => thin(ring.filter((c) => num(c?.[0]) !== null && num(c?.[1]) !== null), maxPoints)
      .map((c) => [round(c[0], 5), round(c[1], 5)]));
}

/** NOAA radar ImageServer metadata → the newest mosaic time. */
export function parseRadarMeta(payload) {
  const extent = payload?.timeInfo?.timeExtent;
  requireShape(Array.isArray(extent) && extent.length === 2, 'NOAA radar metadata');
  const end = num(extent[1]);
  requireShape(end !== null, 'NOAA radar time');
  return { latestMs: end, earliestMs: num(extent[0]) };
}

/** "10 to 15 mph" → 15; "25 mph" → 25. */
export function maxMph(text) {
  const values = String(text || '').match(/\d+(?:\.\d+)?/g);
  return values ? Math.max(...values.map(Number)) : null;
}

/** NWS hourly forecast → next `hours` periods. Forecast = modelled. */
export function parseNwsHourly(payload, { now = Date.now(), hours = 24 } = {}) {
  const p = payload?.properties;
  requireShape(p && Array.isArray(p.periods), 'NWS hourly forecast');
  const periods = p.periods
    .filter((period) => Date.parse(period.endTime) > now)
    .slice(0, hours)
    .map((period) => ({
      start: iso(period.startTime),
      tempF: period.temperatureUnit === 'C' ? round(num(period.temperature) * 9 / 5 + 32, 0) : num(period.temperature),
      pop: num(period.probabilityOfPrecipitation?.value),
      windMph: maxMph(period.windSpeed),
      windFrom: period.windDirection || null,
      short: period.shortForecast || null,
      isDaytime: Boolean(period.isDaytime),
    }));
  return { issuedAt: iso(p.updateTime || p.generatedAt), periods };
}

/** NWS 12-hour forecast → next `count` named periods. */
export function parseNwsDaily(payload, { count = 6 } = {}) {
  const p = payload?.properties;
  requireShape(p && Array.isArray(p.periods), 'NWS forecast');
  return {
    issuedAt: iso(p.updateTime || p.generatedAt),
    periods: p.periods.slice(0, count).map((period) => ({
      name: period.name,
      start: iso(period.startTime),
      isDaytime: Boolean(period.isDaytime),
      tempF: num(period.temperature),
      pop: num(period.probabilityOfPrecipitation?.value),
      short: period.shortForecast || null,
      detailed: String(period.detailedForecast || '').slice(0, 320) || null,
    })),
  };
}

// ── air, space, hazards ─────────────────────────────────────────────────────

/** EPA AQI category for a US AQI value. */
export function aqiCategory(aqi) {
  const v = num(aqi);
  if (v === null) return null;
  if (v <= 50) return 'Good';
  if (v <= 100) return 'Moderate';
  if (v <= 150) return 'Unhealthy for sensitive groups';
  if (v <= 200) return 'Unhealthy';
  if (v <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

/** Open-Meteo air quality (CAMS model) — modelled. */
export function parseOpenMeteoAir(payload, { now = Date.now() } = {}) {
  const c = payload?.current;
  requireShape(c && 'us_aqi' in c, 'Open-Meteo air quality');
  const hourlyTimes = payload.hourly?.time || [];
  const hourlyAqi = payload.hourly?.us_aqi || [];
  // Hourly times are local wall-clock (timezone=America/New_York); compare on the string.
  const nowLocal = new Date(now).toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 13).replace(' ', 'T');
  const endLocal = addHoursLocal(nowLocal, 24);
  let peak = null;
  let peakAt = null;
  for (let i = 0; i < hourlyTimes.length; i += 1) {
    const hour = String(hourlyTimes[i]).slice(0, 13);
    if (hour < nowLocal || hour >= endLocal) continue;
    const v = num(hourlyAqi[i]);
    if (v !== null && (peak === null || v > peak)) { peak = v; peakAt = hourlyTimes[i]; }
  }
  const aqi = num(c.us_aqi);
  return {
    observedAt: c.time ? `${c.time} ET` : null,
    aqi,
    category: aqiCategory(aqi),
    pm25: round(c.pm2_5, 1),
    pm10: round(c.pm10, 1),
    ozone: round(c.ozone, 0),
    no2: round(c.nitrogen_dioxide, 0),
    peak24h: peak,
    peak24hAt: peakAt ? `${peakAt} ET` : null,
    peakCategory: aqiCategory(peak),
  };
}

function addHoursLocal(localHour, hours) {
  const ms = Date.parse(`${localHour}:00:00Z`) + hours * 3600_000;
  return new Date(ms).toISOString().slice(0, 13);
}

/** AirNow current observations (measured monitors) — max across pollutants. */
export function parseAirNow(payload) {
  requireShape(Array.isArray(payload), 'AirNow');
  if (!payload.length) return null;
  const worst = payload.reduce((a, b) => ((num(b.AQI) ?? -1) > (num(a.AQI) ?? -1) ? b : a));
  return {
    observedAt: `${worst.DateObserved?.trim()} ${String(worst.HourObserved).padStart(2, '0')}:00 ${worst.LocalTimeZone || ''}`.trim(),
    aqi: num(worst.AQI),
    category: worst.Category?.Name || aqiCategory(worst.AQI),
    pollutant: worst.ParameterName || null,
    area: worst.ReportingArea || null,
    readings: payload.map((r) => ({ pollutant: r.ParameterName, aqi: num(r.AQI) })),
  };
}

/** NOAA space-weather scales: current, past-24h max, and 3-day forecast max. */
export function parseSwpcScales(payload) {
  requireShape(payload && payload['0'], 'SWPC scales');
  const scale = (entry, key) => num(entry?.[key]?.Scale);
  const forecasts = ['1', '2', '3'].map((k) => payload[k]).filter(Boolean);
  const maxG = forecasts.reduce((m, f) => Math.max(m, scale(f, 'G') ?? 0), 0);
  return {
    issuedAt: iso(`${payload['0'].DateStamp}T${payload['0'].TimeStamp}Z`),
    current: { R: scale(payload['0'], 'R'), S: scale(payload['0'], 'S'), G: scale(payload['0'], 'G') },
    past24h: payload['-1'] ? { R: scale(payload['-1'], 'R'), S: scale(payload['-1'], 'S'), G: scale(payload['-1'], 'G') } : null,
    forecastMaxG: forecasts.length ? maxG : null,
  };
}

/** Planetary Kp — accepts both the object rows and the legacy header-row array. */
export function parseKp(payload) {
  requireShape(Array.isArray(payload) && payload.length, 'SWPC Kp');
  const rows = Array.isArray(payload[0])
    ? payload.slice(1).map((r) => ({ time_tag: r[0], Kp: r[1] }))
    : payload;
  const last = rows[rows.length - 1];
  return { at: iso(`${String(last.time_tag).replace(' ', 'T')}Z`), kp: round(last.Kp ?? last.kp, 2) };
}

/** USGS M2.5+ week: quakes near home plus globally major ones. */
export function parseUsgsQuakes(payload, home, { now = Date.now(), nearKm = 500 } = {}) {
  requireShape(Array.isArray(payload?.features), 'USGS');
  const all = payload.features.map((f) => {
    const [lon, lat, depth] = f.geometry?.coordinates || [];
    return {
      id: f.id,
      mag: round(f.properties?.mag, 1),
      place: f.properties?.place || null,
      at: iso(f.properties?.time),
      url: safeUrl(f.properties?.url),
      tsunami: Boolean(f.properties?.tsunami),
      lat: num(lat),
      lon: num(lon),
      depthKm: round(depth, 0),
      distanceKm: home && num(lat) !== null ? Math.round(haversineKm(home.lat, home.lon, lat, lon)) : null,
    };
  });
  return {
    generatedAt: iso(payload.metadata?.generated),
    near: all.filter((q) => q.distanceKm !== null && q.distanceKm <= nearKm).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8),
    major: all.filter((q) => (q.mag ?? 0) >= 6 && now - Date.parse(q.at) <= 72 * 3600_000).sort((a, b) => b.mag - a.mag).slice(0, 5),
  };
}

const NHC_CLASS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone' };

/** NHC active storms with distance from home. */
export function parseNhcStorms(payload, home) {
  requireShape(payload && Array.isArray(payload.activeStorms), 'NHC');
  return payload.activeStorms.map((s) => {
    const lat = num(s.latitudeNumeric);
    const lon = num(s.longitudeNumeric);
    return {
      id: s.id,
      name: s.name,
      classification: NHC_CLASS[s.classification] || s.classification || null,
      intensityKt: num(s.intensity),
      pressureMb: num(s.pressure),
      movement: s.movementDir !== undefined ? `${compass(s.movementDir) || ''} ${s.movementSpeed ?? ''} mph`.trim() : null,
      lastUpdate: iso(s.lastUpdate),
      advisoryUrl: safeUrl(s.publicAdvisory?.url),
      distanceKm: home && lat !== null && lon !== null ? Math.round(haversineKm(home.lat, home.lon, lat, lon)) : null,
    };
  }).sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}

/** OpenFEMA declarations for the home state, grouped by disaster number. */
export function parseFemaDeclarations(payload, { county = null, now = Date.now() } = {}) {
  const rows = payload?.DisasterDeclarationsSummaries;
  requireShape(Array.isArray(rows), 'OpenFEMA');
  const countyKey = county ? String(county).replace(/\s+County$/i, '').toLowerCase() : null;
  const byNumber = new Map();
  for (const r of rows) {
    const key = r.disasterNumber;
    if (!byNumber.has(key)) {
      byNumber.set(key, {
        disasterNumber: key,
        title: r.declarationTitle || null,
        incidentType: r.incidentType || null,
        declarationType: r.declarationType || null,
        declaredAt: iso(r.declarationDate),
        incidentBegin: iso(r.incidentBeginDate),
        incidentEnd: iso(r.incidentEndDate),
        areas: [],
        url: `https://www.fema.gov/disaster/${encodeURIComponent(key)}`,
      });
    }
    if (r.designatedArea) byNumber.get(key).areas.push(r.designatedArea);
  }
  const list = [...byNumber.values()].map((d) => ({
    ...d,
    coversHome: countyKey ? d.areas.some((a) => a.toLowerCase().startsWith(countyKey) || /statewide/i.test(a)) : false,
    ageDays: d.declaredAt ? Math.floor((now - Date.parse(d.declaredAt)) / 86_400_000) : null,
  }));
  return { latest: list.slice(0, 5), recentForHome: list.filter((d) => d.coversHome && d.ageDays !== null && d.ageDays <= 180) };
}

// ── local mobility ──────────────────────────────────────────────────────────

/** Filter a parsed FAA NAS status to the home airports. */
export function pickHomeAirports(nas, airports) {
  const wanted = new Set(airports);
  const pick = (list) => list.filter((item) => wanted.has(item.airport));
  const closures = pick(nas.closures).filter((c) => c.kind !== 'ga-ppr');
  const out = {
    updatedAt: nas.updatedAt,
    airports,
    groundStops: pick(nas.groundStops),
    groundDelays: pick(nas.groundDelays),
    delays: pick(nas.delays),
    closures,
  };
  out.anyActive = Boolean(out.groundStops.length || out.groundDelays.length || out.delays.length || closures.some((c) => c.recent));
  return out;
}

const TOMTOM_CATEGORY = { 0: 'Unknown', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle' };
const TOMTOM_MAGNITUDE = { 0: 'Unknown', 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Closure' };

/** TomTom incident details near home, worst and nearest first. */
export function parseTomTomIncidents(payload, home, { maxKm = 8 } = {}) {
  requireShape(Array.isArray(payload?.incidents), 'TomTom incidents');
  const out = [];
  for (const inc of payload.incidents) {
    const p = inc.properties || {};
    const coords = inc.geometry?.type === 'Point' ? [inc.geometry.coordinates] : (inc.geometry?.coordinates || []);
    let best = null;
    let nearest = null;
    for (const c of coords) {
      if (!Array.isArray(c)) continue;
      const d = haversineKm(home.lat, home.lon, c[1], c[0]);
      if (best === null || d < best) { best = d; nearest = c; }
    }
    if (best === null || best > maxKm) continue;
    const category = TOMTOM_CATEGORY[p.iconCategory] || 'Incident';
    const magnitude = num(p.magnitudeOfDelay) ?? 0;
    out.push({
      id: p.id || null,
      category,
      magnitude,
      magnitudeLabel: TOMTOM_MAGNITUDE[magnitude] || 'Unknown',
      description: p.events?.[0]?.description || category,
      from: p.from || null,
      to: p.to || null,
      roads: Array.isArray(p.roadNumbers) ? p.roadNumbers.slice(0, 3) : [],
      delayMin: num(p.delay) !== null ? Math.round(p.delay / 60) : null,
      lengthKm: num(p.length) !== null ? round(p.length / 1000, 1) : null,
      start: iso(p.startTime),
      end: iso(p.endTime),
      distanceKm: round(best, 1),
      // Where to draw it: the point nearest home and the published geometry, thinned.
      lat: round(nearest[1], 5),
      lon: round(nearest[0], 5),
      path: thin(coords.filter((c) => Array.isArray(c) && num(c[0]) !== null), 40).map((c) => [round(c[0], 5), round(c[1], 5)]),
    });
  }
  const severity = (i) => (i.category === 'Road closed' ? 5 : i.magnitude);
  return out.sort((a, b) => severity(b) - severity(a) || a.distanceKm - b.distanceKm).slice(0, 15);
}

/** Ticketmaster Discovery events near home. */
export function parseTicketmaster(payload) {
  requireShape(payload && typeof payload === 'object', 'Ticketmaster');
  const events = payload._embedded?.events || [];
  return events.map((e) => {
    const venue = e._embedded?.venues?.[0] || {};
    return {
      name: e.name,
      start: e.dates?.start?.dateTime ? iso(e.dates.start.dateTime) : null,
      localDate: e.dates?.start?.localDate || null,
      localTime: e.dates?.start?.localTime || null,
      venue: venue.name || null,
      city: venue.city?.name || null,
      segment: e.classifications?.[0]?.segment?.name || null,
      distanceMi: round(e.distance, 1),
      lat: num(venue.location?.latitude),
      lon: num(venue.location?.longitude),
      url: safeUrl(e.url),
    };
  });
}

// ── markets & macro ─────────────────────────────────────────────────────────

/**
 * Yahoo Finance spark (range=1d, interval=5m) → one quote per board row.
 * Accepts both the symbol-keyed shape and the older `{spark:{result:[]}}`.
 */
export function parseYahooSpark(payload, board) {
  requireShape(payload && typeof payload === 'object', 'Yahoo spark');
  const bySymbol = {};
  if (Array.isArray(payload.spark?.result)) {
    for (const r of payload.spark.result) {
      const resp = r.response?.[0];
      bySymbol[r.symbol] = {
        timestamp: resp?.timestamp || [],
        close: resp?.indicators?.quote?.[0]?.close || [],
        chartPreviousClose: resp?.meta?.chartPreviousClose ?? resp?.meta?.previousClose,
      };
    }
  } else {
    Object.assign(bySymbol, payload);
  }
  return board.map((row) => {
    const s = bySymbol[row.symbol];
    const closes = [];
    const times = [];
    (s?.close || []).forEach((c, i) => {
      if (num(c) !== null) { closes.push(Number(c)); times.push(s.timestamp?.[i]); }
    });
    const last = closes.length ? closes[closes.length - 1] : null;
    const prev = num(s?.chartPreviousClose);
    if (last === null) return { ...row, available: false };
    const change = prev !== null ? last - prev : null;
    return {
      ...row,
      available: true,
      last,
      prevClose: prev,
      change,
      changePct: change !== null && prev ? (change / prev) * 100 : null,
      changeBp: row.unit === '%' && change !== null ? change * 100 : null,
      lastAt: times.length ? iso(times[times.length - 1] * 1000) : null,
      series: thin(closes, 48).map((v) => round(v, 4)),
    };
  });
}

/** Mean of the last `n` values, or null when there aren't `n`. */
export function sma(values, n) {
  if (!Array.isArray(values) || values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

/** Annualised realised volatility (%) from the last `n` daily closes. */
export function realizedVol(values, n = 20) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
  const slice = values.slice(-(n + 1));
  const rets = [];
  for (let i = 1; i < slice.length; i += 1) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Yahoo 1y daily chart → trend regime computed from the published closes. */
export function parseYahooDailyRegime(payload) {
  const r = payload?.chart?.result?.[0];
  requireShape(r && Array.isArray(r.timestamp), 'Yahoo chart');
  const closes = (r.indicators?.quote?.[0]?.close || []).map(num).filter((v) => v !== null);
  requireShape(closes.length > 20, 'Yahoo chart closes');
  const last = closes[closes.length - 1];
  const high = Math.max(...closes);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  return {
    symbol: r.meta?.symbol || null,
    asOf: iso((r.timestamp[r.timestamp.length - 1]) * 1000),
    last: round(last, 2),
    sma50: round(s50, 2),
    sma200: round(s200, 2),
    high1y: round(high, 2),
    drawdownPct: round((last / high - 1) * 100, 1),
    vsSma200Pct: s200 ? round((last / s200 - 1) * 100, 1) : null,
    realizedVol20: round(realizedVol(closes, 20), 1),
    trend: s50 && s200 ? (last > s200 ? (s50 > s200 ? 'uptrend' : 'recovering') : (s50 < s200 ? 'downtrend' : 'weakening')) : null,
  };
}

const TREASURY_TENORS = [
  ['1M', 'BC_1MONTH'], ['3M', 'BC_3MONTH'], ['6M', 'BC_6MONTH'], ['1Y', 'BC_1YEAR'],
  ['2Y', 'BC_2YEAR'], ['5Y', 'BC_5YEAR'], ['10Y', 'BC_10YEAR'], ['30Y', 'BC_30YEAR'],
];

/** Treasury daily par yield curve XML → dated rows, oldest first. */
export function parseTreasuryXml(xml) {
  const text = String(xml || '');
  requireShape(/<feed[\s>]/i.test(text) || /<m:properties>/i.test(text), 'Treasury XML');
  const rows = [];
  for (const match of text.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/gi)) {
    const block = match[1];
    const date = xmlTag(block, 'd:NEW_DATE').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const yields = {};
    for (const [label, field] of TREASURY_TENORS) yields[label] = num(xmlTag(block, `d:${field}`));
    rows.push({ date, yields });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest curve + day-over-day change in basis points. */
export function summarizeTreasury(rows) {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const prior = rows.length > 1 ? rows[rows.length - 2] : null;
  const tenors = TREASURY_TENORS.map(([label]) => ({
    tenor: label,
    yield: latest.yields[label],
    changeBp: prior && latest.yields[label] !== null && prior.yields[label] !== null
      ? Math.round((latest.yields[label] - prior.yields[label]) * 100) : null,
  }));
  const y2 = latest.yields['2Y'];
  const y10 = latest.yields['10Y'];
  const m3 = latest.yields['3M'];
  return {
    date: latest.date,
    priorDate: prior?.date || null,
    tenors,
    spread2s10sBp: y2 !== null && y10 !== null ? Math.round((y10 - y2) * 100) : null,
    spread3m10yBp: m3 !== null && y10 !== null ? Math.round((y10 - m3) * 100) : null,
  };
}

/** NY Fed reference rate (SOFR / EFFR). */
export function parseNyFedRate(payload) {
  const r = payload?.refRates?.[0];
  requireShape(r && 'percentRate' in r, 'NY Fed rate');
  return { type: r.type, date: r.effectiveDate, rate: num(r.percentRate), volumeBn: num(r.volumeInBillions) };
}

/** BLS v1 series → unemployment, CPI y/y, core CPI y/y, payroll change. */
export function parseBls(payload, series) {
  requireShape(payload?.status === 'REQUEST_SUCCEEDED' && Array.isArray(payload.Results?.series), 'BLS');
  const byId = Object.fromEntries(payload.Results.series.map((s) => [s.seriesID, (s.data || [])
    .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && num(d.value) !== null)
    .map((d) => ({ year: Number(d.year), month: Number(d.period.slice(1)), label: `${d.periodName} ${d.year}`, value: Number(d.value) }))
    .sort((a, b) => b.year - a.year || b.month - a.month)]));
  // y/y needs the same month a year earlier. When BLS never published that
  // month (the Oct-2025 shutdown gap), report the newest month that can be
  // computed and say which month was skipped — never interpolate across it.
  const yoy = (id) => {
    const rows = byId[id] || [];
    if (!rows[0]) return null;
    const computable = rows
      .map((r) => ({ r, ago: rows.find((x) => x.year === r.year - 1 && x.month === r.month) }))
      .filter((x) => x.ago);
    const [first, second] = computable;
    if (!first) return { period: rows[0].label, yoyPct: null, prevPeriod: null, prevYoyPct: null, latestPeriod: rows[0].label, skipped: rows[0].label };
    return {
      period: first.r.label,
      yoyPct: round((first.r.value / first.ago.value - 1) * 100, 1),
      prevPeriod: second ? second.r.label : null,
      prevYoyPct: second ? round((second.r.value / second.ago.value - 1) * 100, 1) : null,
      latestPeriod: rows[0].label,
      skipped: first.r === rows[0] ? null : rows[0].label,
    };
  };
  const level = (id) => {
    const rows = byId[id] || [];
    if (!rows[0]) return null;
    return { period: rows[0].label, value: rows[0].value, prev: rows[1]?.value ?? null, prevPeriod: rows[1]?.label ?? null };
  };
  const payrolls = level(series.payrolls);
  return {
    unemployment: level(series.unemployment),
    cpi: yoy(series.cpi),
    coreCpi: yoy(series.coreCpi),
    payrolls: payrolls ? { period: payrolls.period, changeK: payrolls.prev !== null ? Math.round(payrolls.value - payrolls.prev) : null, levelK: payrolls.value } : null,
  };
}

/** Freddie Mac PMMS weekly history CSV → latest 30/15-year rates. */
export function parsePmmsCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  requireShape(/pmms30/i.test(lines[0] || ''), 'PMMS CSV');
  const header = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
  const iDate = header.indexOf('date');
  const i30 = header.indexOf('pmms30');
  const i15 = header.indexOf('pmms15');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.replace(/"/g, '').trim());
    const r30 = num(cells[i30]);
    if (r30 === null) continue;
    const [m, d, y] = String(cells[iDate]).split('/').map(Number);
    if (!y) continue;
    rows.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, rate30: r30, rate15: num(cells[i15]) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1];
  requireShape(latest, 'PMMS rows');
  const prev = rows[rows.length - 2] || null;
  const yearAgo = rows.slice().reverse().find((r) => Date.parse(r.date) <= Date.parse(latest.date) - 358 * 86_400_000) || null;
  return {
    date: latest.date,
    rate30: latest.rate30,
    rate15: latest.rate15,
    change30Bp: prev ? Math.round((latest.rate30 - prev.rate30) * 100) : null,
    yearAgo30: yearAgo?.rate30 ?? null,
    series30: rows.slice(-26).map((r) => r.rate30),
  };
}

// ── sentiment, narratives, attention ────────────────────────────────────────

/** alternative.me Crypto Fear & Greed. */
export function parseFearGreed(payload) {
  const rows = payload?.data;
  requireShape(Array.isArray(rows) && rows.length, 'Fear & Greed');
  const at = (i) => (rows[i] ? { value: num(rows[i].value), label: rows[i].value_classification, at: iso(Number(rows[i].timestamp) * 1000) } : null);
  return { now: at(0), yesterday: at(1), weekAgo: at(7) };
}

/** DefiLlama stablecoins → USD-pegged supply and its drift. */
export function parseStablecoins(payload) {
  const assets = payload?.peggedAssets;
  requireShape(Array.isArray(assets), 'DefiLlama stablecoins');
  const usd = assets.filter((a) => a.pegType === 'peggedUSD');
  const sum = (key) => usd.reduce((s, a) => s + (num(a[key]?.peggedUSD) ?? 0), 0);
  const total = sum('circulating');
  const pct = (prior) => (prior ? ((total / prior) - 1) * 100 : null);
  const top = usd
    .map((a) => {
      const circ = num(a.circulating?.peggedUSD) ?? 0;
      const week = num(a.circulatingPrevWeek?.peggedUSD);
      return { name: a.name, symbol: a.symbol, circulating: circ, change7dPct: week ? round((circ / week - 1) * 100, 2) : null };
    })
    .sort((a, b) => b.circulating - a.circulating)
    .slice(0, 6);
  return {
    totalUsd: total,
    change1dPct: round(pct(sum('circulatingPrevDay')), 2),
    change7dPct: round(pct(sum('circulatingPrevWeek')), 2),
    change30dPct: round(pct(sum('circulatingPrevMonth')), 2),
    count: usd.length,
    top,
  };
}

const SPORTS_RE = /\bvs\.?\s|\bBO[1-7]\b|game \d+ winner|\bO\/U\b|spread:|moneyline|\bmap \d\b|\bset \d\b|grand prix|total (?:goals|points|kills)|\b(?:champions?(?:hip)?|league|cup|mvp|super bowl|nba|nfl|mlb|nhl|wnba|ncaa|ufc|f1|formula 1|grand slam|wimbledon|world series|stanley cup|ballon d'or|premier league|la liga|serie a|bundesliga|uefa|fifa|heisman|playoffs?|rookie of the year|cy young|top scorer|esports|counter-strike|dota|valorant|league of legends)\b/i;

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}

/**
 * Polymarket open markets (sorted by 24h volume) → non-sports events with
 * their leading outcomes. Prices are the market's last published prices.
 */
export function parsePolymarket(payload, { limit = 14 } = {}) {
  requireShape(Array.isArray(payload), 'Polymarket');
  const events = new Map();
  for (const m of payload) {
    if (m.sportsMarketType || m.gameStartTime) continue;
    const ev = m.events?.[0] || {};
    if (SPORTS_RE.test(m.question || '') || SPORTS_RE.test(ev.title || '')) continue;
    const outcomes = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices).map(num);
    if (!outcomes.length || prices[0] === null || prices[0] === undefined) continue;
    const yesNo = String(outcomes[0]).toLowerCase() === 'yes';
    const key = ev.id || m.id;
    if (!events.has(key)) {
      events.set(key, {
        id: String(key),
        title: ev.title || m.question,
        url: safeUrl(`https://polymarket.com/event/${ev.slug || m.slug}`),
        endDate: iso(ev.endDate || m.endDate),
        volume24h: 0,
        options: [],
      });
    }
    const entry = events.get(key);
    entry.volume24h += num(m.volume24hr) ?? 0;
    entry.options.push({
      label: m.groupItemTitle || (yesNo ? m.question : String(outcomes[0])),
      yesNo,
      question: m.question,
      prob: prices[0],
      change24h: num(m.oneDayPriceChange),
    });
  }
  const list = [...events.values()].map((e) => {
    // A lone Yes/No market is the event itself: its outcome reads "Yes".
    if (e.options.length === 1 && e.options[0].yesNo && e.options[0].label === e.options[0].question) {
      e.options[0].label = 'Yes';
    }
    e.options.sort((a, b) => b.prob - a.prob);
    const mover = e.options.reduce((best, o) => (Math.abs(o.change24h ?? 0) > Math.abs(best?.change24h ?? 0) ? o : best), null);
    return { ...e, volume24h: Math.round(e.volume24h), options: e.options.slice(0, 3), mover: mover && mover.change24h ? mover : null };
  }).sort((a, b) => b.volume24h - a.volume24h);
  return list.slice(0, limit);
}

/** Google Trends daily-trending RSS. */
export function parseTrendsRss(xml, { limit = 10 } = {}) {
  const text = String(xml || '');
  requireShape(/<rss[\s>]/i.test(text), 'Google Trends RSS');
  const out = [];
  for (const match of text.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = xmlTag(item, 'title');
    if (!title) continue;
    const news = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/i.exec(item)?.[1] || '';
    out.push({
      title,
      traffic: xmlTag(item, 'ht:approx_traffic') || null,
      at: iso(xmlTag(item, 'pubDate')),
      newsTitle: xmlTag(news, 'ht:news_item_title') || null,
      newsUrl: safeUrl(xmlTag(news, 'ht:news_item_url')),
      newsSource: xmlTag(news, 'ht:news_item_source') || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

const WIKI_SKIP_RE = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Talk:|User:|Template:|Category:|-$|Cleopatra$|XXX)/i;
const WIKI_ADULT_RE = /(porn|xxx|xhamster|xvideos|onlyfans|sex)/i;

/** Wikimedia top-viewed en.wikipedia articles for a day. */
export function parseWikiTop(payload, { limit = 10 } = {}) {
  const articles = payload?.items?.[0]?.articles;
  requireShape(Array.isArray(articles), 'Wikimedia top');
  const day = payload.items[0];
  return {
    date: `${day.year}-${day.month}-${day.day}`,
    articles: articles
      .filter((a) => !WIKI_SKIP_RE.test(a.article) && !WIKI_ADULT_RE.test(a.article))
      .slice(0, limit)
      .map((a) => ({
        title: decodeURIComponent(String(a.article)).replace(/_/g, ' '),
        views: num(a.views),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
      })),
  };
}

/** Hacker News front page via Algolia. */
export function parseHnFront(payload) {
  requireShape(Array.isArray(payload?.hits), 'HN');
  return payload.hits
    .map((h) => ({
      id: h.objectID,
      title: h.title,
      url: safeUrl(h.url) || `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`,
      hnUrl: `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`,
      points: num(h.points) ?? 0,
      comments: num(h.num_comments) ?? 0,
      at: iso(h.created_at),
      security: SECURITY_TERMS_RE.test(h.title || ''),
    }))
    .sort((a, b) => b.points - a.points);
}

/** Google News RSS search → headlines with publisher and time. */
export function parseNewsRss(xml, { limit = 8 } = {}) {
  const text = String(xml || '');
  requireShape(/<rss[\s>]/i.test(text), 'Google News RSS');
  const seen = new Set();
  const out = [];
  for (const match of text.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const source = xmlTag(item, 'source') || null;
    let title = xmlTag(item, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const url = safeUrl(xmlTag(item, 'link'));
    if (!title || !url) continue;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 200), source, url, at: iso(xmlTag(item, 'pubDate')) });
  }
  return out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, limit);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keep only headlines that read as a current incident AND name one of the
 * home places — a search hit on "fire" in a council-meeting story, or a
 * sentencing for a shooting two years ago, is not a report of something now.
 */
export function filterIncidentHeadlines(items, places) {
  const placeRes = places.map((p) => new RegExp(`\\b${escapeRe(String(p).replace(/\s+County$/i, ''))}\\b`, 'i'));
  return (items || []).filter((n) => INCIDENT_TERMS_RE.test(n.title)
    && !NOT_CURRENT_RE.test(n.title)
    && placeRes.some((re) => re.test(n.title)));
}

/** "20261119T000000Z" → ms. */
function gdeltDateMs(text) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(String(text || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** GDELT DOC timelinetone → latest-24h tone vs the 7-day average. */
export function parseGdeltTone(payload) {
  const data = payload?.timeline?.[0]?.data;
  requireShape(Array.isArray(data), 'GDELT tone');
  // GDELT reports exactly 0 for intervals with no matching articles; that is
  // an absence of coverage, not neutral coverage, so it is dropped.
  const points = data
    .map((d) => ({ at: gdeltDateMs(d.date), value: num(d.value) }))
    .filter((p) => Number.isFinite(p.at) && p.value !== null && p.value !== 0)
    .sort((a, b) => a.at - b.at);
  if (!points.length) return null;
  const lastAt = points[points.length - 1].at;
  const mean = (list) => (list.length ? list.reduce((s, p) => s + p.value, 0) / list.length : null);
  const day = points.filter((p) => p.at > lastAt - 24 * 3600_000);
  const avg7d = mean(points);
  const avg24h = mean(day);
  return {
    asOf: iso(lastAt),
    avg24h: round(avg24h, 2),
    avg7d: round(avg7d, 2),
    delta: avg24h !== null && avg7d !== null ? round(avg24h - avg7d, 2) : null,
    series: thin(points.map((p) => round(p.value, 2)), 42),
  };
}

/** CISA Known Exploited Vulnerabilities → recent additions, consumer-relevant flagged. */
export function parseKev(payload, { now = Date.now(), days = 10 } = {}) {
  const vulns = payload?.vulnerabilities;
  requireShape(Array.isArray(vulns), 'CISA KEV');
  const cutoff = now - days * 86_400_000;
  const recent = vulns
    .filter((v) => Date.parse(v.dateAdded) >= cutoff)
    .map((v) => {
      const vendor = String(v.vendorProject || '');
      const product = String(v.product || '');
      const hay = `${vendor} ${product}`.toLowerCase();
      return {
        cve: v.cveID,
        vendor,
        product,
        name: v.vulnerabilityName || null,
        dateAdded: v.dateAdded,
        due: v.dueDate || null,
        ransomware: String(v.knownRansomwareCampaignUse || '').toLowerCase() === 'known',
        description: String(v.shortDescription || '').slice(0, 300) || null,
        action: String(v.requiredAction || '').slice(0, 200) || null,
        consumer: CONSUMER_VENDORS.some((name) => hay.includes(name)),
        url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cveID)}`,
      };
    })
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
  return { catalogReleased: iso(payload.dateReleased), total: vulns.length, recent: recent.slice(0, 20) };
}

/** Reddit listing JSON (OAuth). */
export function parseRedditListing(payload, sub) {
  const children = payload?.data?.children;
  requireShape(Array.isArray(children), 'Reddit listing');
  return children
    .map((c) => c.data)
    .filter((d) => d && !d.stickied)
    .slice(0, 6)
    .map((d) => ({
      sub,
      title: String(d.title || '').slice(0, 220),
      score: num(d.score) ?? 0,
      comments: num(d.num_comments) ?? 0,
      url: `https://www.reddit.com${d.permalink}`,
      at: iso(num(d.created_utc) * 1000),
    }));
}

/** Bluesky searchPosts. */
export function parseBlueskySearch(payload, query) {
  requireShape(Array.isArray(payload?.posts), 'Bluesky search');
  return payload.posts.slice(0, 6).map((p) => {
    const rkey = String(p.uri || '').split('/').pop();
    const handle = p.author?.handle || null;
    return {
      query,
      text: String(p.record?.text || '').slice(0, 280),
      author: handle,
      likes: num(p.likeCount) ?? 0,
      reposts: num(p.repostCount) ?? 0,
      at: iso(p.indexedAt),
      url: handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : null,
    };
  });
}

// ── water, safety, airspace (protection layers) ────────────────────────────

/** NWPS flood categories, worst last. Anything else is "not ranked". */
export const FLOOD_RANK = Object.freeze({ no_flooding: 0, action: 1, minor: 2, moderate: 3, major: 4 });

const stage = (v) => (num(v) !== null && v > -900 ? num(v) : null);

/** NOAA NWPS gauges (rivers and tidal stations) with observed and forecast flood category. */
export function parseNwpsGauges(payload, home) {
  requireShape(Array.isArray(payload?.gauges), 'NWPS gauges');
  return payload.gauges
    .map((g) => {
      const obs = g.status?.observed || {};
      const fc = g.status?.forecast || {};
      const lat = num(g.latitude);
      const lon = num(g.longitude);
      return {
        id: g.lid,
        name: String(g.name || g.lid).replace(/\s*\((?:IN )?MLLW\)\s*/i, '').trim(),
        tidal: /MLLW/i.test(g.name || ''),
        lat,
        lon,
        distanceKm: home && lat !== null && lon !== null ? round(haversineKm(home.lat, home.lon, lat, lon), 1) : null,
        observed: { stage: stage(obs.primary), unit: obs.primaryUnit || 'ft', category: obs.floodCategory || null, at: iso(obs.validTime) },
        forecast: { stage: stage(fc.primary), unit: fc.primaryUnit || 'ft', category: fc.floodCategory || null, at: iso(fc.validTime) },
        url: g.lid ? `https://water.noaa.gov/gauges/${encodeURIComponent(String(g.lid).toLowerCase())}` : null,
      };
    })
    .filter((g) => g.lat !== null && g.observed.category !== 'out_of_service')
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}

/** Worst observed-or-forecast flood rank for a gauge (0 when none). */
export function gaugeRank(g) {
  return Math.max(FLOOD_RANK[g?.observed?.category] ?? 0, FLOOD_RANK[g?.forecast?.category] ?? 0);
}

/** NDBC realtime2 standard met file → newest wind/pressure and newest wave reading. */
export function parseNdbc(text, { now = Date.now(), maxAgeH = 6 } = {}) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  requireShape(/^#YY/.test(lines[0] || ''), 'NDBC buoy');
  const cols = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const rows = lines.slice(2).map((l) => {
    const v = l.trim().split(/\s+/);
    const r = Object.fromEntries(cols.map((c, i) => [c, v[i] === 'MM' ? null : v[i]]));
    r.at = Date.UTC(+r.YY, +r.MM - 1, +r.DD, +r.hh, +r.mm);
    return r;
  }).filter((r) => Number.isFinite(r.at) && now - r.at <= maxAgeH * 3600_000);
  const latest = rows[0] || null;
  const wave = rows.find((r) => num(r.WVHT) !== null) || null;
  if (!latest) return null;
  const kt = (v) => (num(v) !== null ? round(v * 1.943844, 0) : null);
  return {
    at: iso(latest.at),
    windKt: kt(latest.WSPD),
    gustKt: kt(latest.GST),
    windFrom: compass(latest.WDIR),
    pressureHpa: round(latest.PRES, 1),
    waterTempF: num(latest.WTMP) !== null ? round(latest.WTMP * 9 / 5 + 32, 0) : null,
    waveAt: wave ? iso(wave.at) : null,
    waveHeightFt: wave ? round(wave.WVHT * 3.28084, 1) : null,
    dominantPeriodS: wave ? round(wave.DPD, 0) : null,
    waveFrom: wave ? compass(wave.MWD) : null,
  };
}

/** FEMA National Shelter System — shelters currently OPEN in the region. */
export function parseFemaShelters(payload, home) {
  requireShape(Array.isArray(payload?.features), 'FEMA open shelters');
  return payload.features.map((f) => f.attributes || {}).map((a) => ({
    kind: 'open-shelter',
    name: a.shelter_name || 'Shelter',
    address: [a.address, a.city, a.state].filter(Boolean).join(', '),
    capacity: num(a.evacuation_capacity),
    population: num(a.total_population),
    org: a.org_name || null,
    pets: a.pet_accommodations_code || null,
    wheelchair: a.wheelchair_accessible || null,
    lat: num(a.latitude),
    lon: num(a.longitude),
  })).filter((s) => s.lat !== null && s.lon !== null).map((s) => ({
    ...s, distanceKm: home ? round(haversineKm(home.lat, home.lon, s.lat, s.lon), 1) : null,
  })).sort((a, b) => a.distanceKm - b.distanceKm);
}

/** FAA TFR list → restrictions in the given states. */
export function parseTfrList(payload, states) {
  requireShape(Array.isArray(payload), 'FAA TFR list');
  const wanted = new Set(states);
  return payload.filter((t) => wanted.has(t.state)).map((t) => ({
    id: t.notam_id,
    type: t.type || null,
    state: t.state,
    facility: t.facility || null,
    description: String(t.description || '').slice(0, 200),
    created: t.creation_date || null,
    url: 'https://tfr.faa.gov/tfr3/',
  }));
}

function safeKind(tags) {
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.amenity === 'police') return 'police';
  if (tags.amenity === 'fire_station') return 'fire';
  if (tags.emergency === 'assembly_point') return 'assembly';
  return 'shelter';
}

/** Overpass → public safe places (hospitals, police, fire stations, mapped shelters). */
export function parseSafePlaces(payload, home) {
  requireShape(Array.isArray(payload?.elements), 'Overpass safe places');
  const seen = new Set();
  const out = [];
  for (const e of payload.elements) {
    const lat = num(e.lat ?? e.center?.lat);
    const lon = num(e.lon ?? e.center?.lon);
    if (lat === null || lon === null) continue;
    const tags = e.tags || {};
    const kind = safeKind(tags);
    const name = tags.name || tags.operator || null;
    if (!name && kind !== 'assembly') continue;
    const key = `${kind}|${String(name).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      name: name || 'Assembly point',
      emergency: tags.emergency || null,
      lat,
      lon,
      distanceKm: home ? round(haversineKm(home.lat, home.lon, lat, lon), 1) : null,
      osm: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Nominatim search results of one kind → safe-place items. */
export function parseNominatimPlaces(list, kind, home) {
  requireShape(Array.isArray(list), 'Nominatim search');
  const type = { hospital: 'hospital', police: 'police', fire: 'fire_station' }[kind];
  return list
    .filter((r) => r.category === 'amenity' && (!type || r.type === type))
    .map((r) => {
      const lat = num(r.lat);
      const lon = num(r.lon);
      return {
        kind,
        name: r.name || String(r.display_name || '').split(',')[0],
        emergency: r.extratags?.emergency || null,
        lat,
        lon,
        distanceKm: home && lat !== null ? round(haversineKm(home.lat, home.lon, lat, lon), 1) : null,
        osm: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : null,
      };
    })
    .filter((p) => p.lat !== null && p.name);
}

const NOT_AN_ER_RE = /\b(rehab\w*|psychiatric|behavioral|nursing|hospice|veterans|VA|children's specialized)\b/i;

/**
 * Escape-route destinations: hospitals with a mapped emergency department
 * first, then general hospitals (rehab, psychiatric, veterans-only sites
 * excluded), nearest first.
 */
export function pickRouteHospitals(places, count = 2) {
  const hospitals = (places || []).filter((p) => p.kind === 'hospital' && p.emergency !== 'no' && !NOT_AN_ER_RE.test(p.name));
  const withEr = hospitals.filter((p) => p.emergency === 'yes');
  const rest = hospitals.filter((p) => p.emergency !== 'yes');
  return [...withEr, ...rest].slice(0, count);
}

/** Keep headlines whose own title matches every pattern. */
export function filterTitles(items, patterns) {
  return (items || []).filter((n) => patterns.every((re) => re.test(n.title || '')));
}

/** OSRM route → duration, distance, and the road geometry (thinned). */
export function parseOsrmRoute(payload) {
  const r = payload?.routes?.[0];
  requireShape(payload?.code === 'Ok' && r, 'OSRM route');
  return {
    durationMin: Math.round(num(r.duration) / 60),
    distanceKm: round(num(r.distance) / 1000, 1),
    path: thin(r.geometry?.coordinates || [], 160).map((c) => [round(c[0], 5), round(c[1], 5)]),
  };
}

/** Open-Meteo elevation (Copernicus 90 m DEM) → metres per input point. */
export function parseElevations(payload, count) {
  requireShape(Array.isArray(payload?.elevation) && payload.elevation.length === count, 'Open-Meteo elevation');
  return payload.elevation.map((v) => round(v, 0));
}
