/**
 * @file Jarvis source registry — every upstream the personal console reads,
 * as fixed URL builders on an explicit host allowlist.
 *
 * Nothing here takes a URL from a request. The only inputs are the operator's
 * own home point (resolved server-side from `.env`) and the static queries
 * below, so the snapshot endpoint can never be turned into an open fetcher
 * (SECURITY.md, "Server-side proxy hardening").
 *
 * Privacy: third-party weather/hazard calls get the home point rounded to two
 * decimals (~1 km). Only the one-time Census geocode sees the street address.
 *
 * @module jarvis/sources
 */

/** Every host the Jarvis service may contact. Checked before each fetch. */
export const JARVIS_ALLOWED_HOSTS = Object.freeze(new Set([
  'geocoding.geo.census.gov',
  'api.weather.gov',
  'air-quality-api.open-meteo.com',
  'www.airnowapi.org',
  'services.swpc.noaa.gov',
  'earthquake.usgs.gov',
  'www.nhc.noaa.gov',
  'www.fema.gov',
  'nasstatus.faa.gov',
  'mapservices.weather.noaa.gov',
  'api.water.noaa.gov',
  'www.ndbc.noaa.gov',
  'hazards.fema.gov',
  'gis.fema.gov',
  'tfr.faa.gov',
  'overpass-api.de',
  'overpass.private.coffee',
  'overpass.kumi.systems',
  'nominatim.openstreetmap.org',
  'routing.openstreetmap.de',
  'api.open-meteo.com',
  'api.tomtom.com',
  'app.ticketmaster.com',
  'query1.finance.yahoo.com',
  'home.treasury.gov',
  'markets.newyorkfed.org',
  'api.bls.gov',
  'www.freddiemac.com',
  'api.alternative.me',
  'stablecoins.llama.fi',
  'gamma-api.polymarket.com',
  'trends.google.com',
  'wikimedia.org',
  'hn.algolia.com',
  'news.google.com',
  'api.gdeltproject.org',
  'www.cisa.gov',
  'www.reddit.com',
  'oauth.reddit.com',
  'bsky.social',
]));

/** Identifies this client to public APIs that ask for a contact-bearing UA (NWS). */
export const JARVIS_USER_AGENT = 'R1-Jarvis/0.1 (+https://github.com/aminebuilds/R1-V5)';

/** Round a coordinate for third-party calls (~1.1 km at 2 dp). */
export function coarse(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

/**
 * Default market board. Symbols are Yahoo Finance tickers. The operator's own
 * names (employer, positions, FX exposure) belong in `JARVIS_WATCHLIST` in
 * `.env`, not here.
 */
export const DEFAULT_MARKET_BOARD = Object.freeze([
  { symbol: 'SPY', label: 'S&P 500 ETF', group: 'equity' },
  { symbol: 'QQQ', label: 'Nasdaq 100 ETF', group: 'equity' },
  { symbol: 'IWM', label: 'Russell 2000 ETF', group: 'equity' },
  { symbol: '^VIX', label: 'VIX', group: 'vol' },
  { symbol: '^VIX3M', label: 'VIX 3-month', group: 'vol' },
  { symbol: '^TNX', label: 'US 10Y yield', group: 'rates', unit: '%' },
  { symbol: 'DX-Y.NYB', label: 'Dollar index', group: 'fx' },
  { symbol: 'GC=F', label: 'Gold', group: 'commodity' },
  { symbol: 'CL=F', label: 'WTI crude', group: 'commodity' },
  { symbol: 'BTC-USD', label: 'Bitcoin', group: 'crypto' },
  { symbol: 'ETH-USD', label: 'Ether', group: 'crypto' },
]);

/** Yahoo symbol syntax: letters, digits and the punctuation tickers actually use. */
const SYMBOL_RE = /^[A-Z0-9^=.\-]{1,15}$/;

/**
 * Parse `JARVIS_WATCHLIST` ("PAR,COMP:Compass,MAD=X:USD/MAD") into board rows.
 * Unknown syntax is dropped, never forwarded.
 * @param {string|undefined} raw
 * @returns {Array<{symbol: string, label: string, group: string}>}
 */
export function parseWatchlist(raw) {
  const seen = new Set(DEFAULT_MARKET_BOARD.map((row) => row.symbol));
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const [sym, ...labelParts] = part.trim().split(':');
    const symbol = String(sym || '').trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    const label = labelParts.join(':').trim().slice(0, 32) || symbol;
    out.push({ symbol, label, group: 'watch' });
    if (out.length >= 14) break;
  }
  return out;
}

/** Airports that matter for a north-Jersey base. */
export const HOME_AIRPORTS = Object.freeze(['EWR', 'LGA', 'JFK', 'TEB']);

/** FAA airport reference points ([lat, lon]) for drawing the home airports on the map. */
export const AIRPORT_POINTS = Object.freeze({
  EWR: [40.6925, -74.1687],
  LGA: [40.7769, -73.874],
  JFK: [40.6398, -73.7789],
  TEB: [40.8501, -74.0608],
});

/**
 * Radar window around home: ±1.5° lon × ±0.9° lat (~250 × 200 km), centred on
 * the coarsened point so the image request never carries the exact home.
 */
export function radarBbox(home) {
  const lat = coarse(home.lat, 1);
  const lon = coarse(home.lon, 1);
  return { west: round2(lon - 1.5), south: round2(lat - 0.9), east: round2(lon + 1.5), north: round2(lat + 0.9) };
}
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Google News RSS searches. `when:` bounds recency server-side. Local and
 * incident searches are built from the home's place names (see
 * `localNewsQueries`) so no town is hard-coded here.
 */
export const DEFAULT_NEWS_QUERIES = Object.freeze({
  macro: '("Federal Reserve" OR inflation OR "Treasury yields" OR "jobs report" OR recession OR tariffs) when:1d',
  ai: '("artificial intelligence" OR OpenAI OR Anthropic OR Nvidia OR "AI agents") when:1d',
  tokenization: '(tokenization OR tokenized OR stablecoin OR "real-world assets" OR "GENIUS Act") when:2d',
});

/** Words that make a local headline an incident report rather than general news. */
export const INCIDENT_TERMS_RE = /\b(shooting|shot|stabb(?:ed|ing)|fire|blaze|flames|crash(?:es|ed)?|collision|closed|closure|evacuat\w*|outage|power out|water main|arrest(?:ed)?|homicide|killed|dead|missing|robbery|robbed|carjack\w*|stolen|theft|burglar\w*|break-in|lockdown|hazmat|gas leak|flood(?:ing)?|sinkhole|explosion|assault(?:ed)?)\b/i;

/** Words that mark a headline as about the past or a ceremony, not something happening now. */
export const NOT_CURRENT_RE = /\b(convicted|sentenced|pleads?|pleaded|indicted|trial|jury|verdict|remembered|memorial|anniversary|honou?red|gives?|donat\w*|years? (?:ago|later)|cold case|upgrades?|funding|grant|budget|ceremony|ribbon[- ]cutting)\b/i;

/** Place names for the home area: `JARVIS_LOCAL_PLACES`, else municipality + county. */
export function homePlaces(home, raw) {
  const fromEnv = String(raw || '').split(',').map((p) => p.trim()).filter(Boolean).slice(0, 16);
  if (fromEnv.length) return fromEnv;
  const out = [];
  const muni = String(home?.municipality || '').replace(/^(City|Town|Township|Village|Borough) of /i, '').replace(/ (township|town|city|borough|village)$/i, '').trim();
  if (muni) out.push(muni);
  if (home?.county) out.push(home.county);
  return out;
}

/** Local-news and incident queries for Google News RSS. */
export function localNewsQueries(places, state) {
  const quoted = places.map((p) => `"${p.replace(/"/g, '')}"`).join(' OR ');
  const st = state ? ` ${state}` : '';
  return {
    local: `(${quoted})${st} when:2d`,
    safety: `(${quoted})${st} (police OR shooting OR fire OR crash OR closed OR evacuation OR outage OR "water main" OR arrested) when:2d`,
  };
}

/** NDBC buoy for sea state: 44065 is the New York Harbor entrance. Override with JARVIS_BUOY. */
export const DEFAULT_BUOY = '44065';

/** States whose FAA flight restrictions matter for a north-Jersey base. */
export const TFR_STATES = Object.freeze(['NJ', 'NY']);

/**
 * Reports, not verified events: drone and UAP sightings, payment-system
 * attacks or outages, and local power-outage reports.
 */
export const REPORT_QUERIES = Object.freeze({
  uap: '("drone sighting" OR "drone sightings" OR drones OR UAP OR UFO OR "unidentified aircraft") ("New Jersey" OR NJ) when:7d',
  finsec: '("bank outage" OR "payment outage" OR "card network" OR "banking app down" OR ransomware OR "cyberattack") (bank OR banks OR payments OR Visa OR Mastercard OR "credit union") when:1d',
});

/** A report headline must say what it is about in its own title. */
export const REPORT_TITLE_FILTERS = Object.freeze({
  uap: [/\b(drones?|UAPs?|UFOs?|unidentified (?:aerial|aircraft|object))\b/i, /\b(New Jersey|N\.\s?J\.?|NJ)\b/],
  finsec: [
    /\b(banks?|banking|payments?|card|Visa|Mastercard|credit union|ATMs?|Zelle|Venmo|PayPal|Fedwire|ACH|SWIFT|brokerage|Robinhood|Schwab|Fidelity|Chase|Wells Fargo|Citi|Bank of America)\b/i,
    /\b(outage|down|hack(?:ed)?|breach|cyberattack|ransomware|attack|disrupt\w*|glitch)\b/i,
  ],
  power: [/\b(power|outages?|PSE&G|PSEG|JCP&L|electric\w*|blackout)\b/i],
});

/** Power-outage report query built from the home places. */
export function powerQuery(places, state) {
  const quoted = places.map((p) => `"${p.replace(/"/g, '')}"`).join(' OR ');
  return `(${quoted})${state ? ` ${state}` : ''} ("power outage" OR "without power" OR outages OR PSE&G OR PSEG OR "JCP&L") when:1d`;
}

/** Bbox of ~±0.35° lat / ±0.45° lon (~40 km) around the coarsened home. */
export function regionBbox(home) {
  const lat = coarse(home.lat, 2);
  const lon = coarse(home.lon, 2);
  return { west: round2(lon - 0.45), south: round2(lat - 0.35), east: round2(lon + 0.45), north: round2(lat + 0.35) };
}

/** Bbox of ~±0.06° (~6 km) around the coarsened home, for the flood-zone map. */
export function nearBbox(home) {
  const lat = coarse(home.lat, 2);
  const lon = coarse(home.lon, 2);
  return { west: round2(lon - 0.08), south: round2(lat - 0.06), east: round2(lon + 0.08), north: round2(lat + 0.06) };
}

/** Overpass QL for public safe places within `radiusM` of the coarsened home. */
export function safePlacesQuery(home, radiusM = 8000) {
  const a = `around:${Math.round(radiusM)},${coarse(home.lat, 3)},${coarse(home.lon, 3)}`;
  return `[out:json][timeout:25];(
nwr[amenity=hospital][emergency!=no](${a});
nwr[amenity=police](${a});
nwr[amenity=fire_station](${a});
nwr[emergency=assembly_point](${a});
nwr[amenity=shelter][shelter_type=emergency](${a});
nwr[social_facility=shelter](${a});
);out center tags 300;`;
}

/** GDELT tone themes — one request each, spaced ≥5 s apart per GDELT policy. */
export const GDELT_THEMES = Object.freeze([
  { id: 'tokenization', label: 'Tokenization & stablecoins', query: '(stablecoin OR tokenization OR tokenized)' },
  { id: 'fed', label: 'Fed & inflation', query: '("federal reserve" OR inflation)' },
  { id: 'ai', label: 'Artificial intelligence', query: '"artificial intelligence"' },
  { id: 'newjersey', label: 'New Jersey', query: '"new jersey"' },
]);

/** Subreddits read when Reddit OAuth credentials are present. */
export const REDDIT_SUBS = Object.freeze(['newjersey', 'wallstreetbets', 'CryptoCurrency', 'economics']);

/** Bluesky search terms when an app password is present. */
export const BLUESKY_QUERIES = Object.freeze(['tokenization', 'stablecoin', 'federal reserve']);

/** BLS series (v1 keyless API, ≤25 calls/day — fetched twice a day at most). */
export const BLS_SERIES = Object.freeze({
  unemployment: 'LNS14000000',
  cpi: 'CUUR0000SA0',
  coreCpi: 'CUUR0000SA0L1E',
  payrolls: 'CES0000000001',
});

/** Vendors whose actively exploited bugs land on personal devices and home networks. */
export const CONSUMER_VENDORS = Object.freeze([
  'apple', 'google', 'microsoft', 'mozilla', 'samsung', 'adobe', 'meta', 'whatsapp', 'zoom',
  'rarlab', '7-zip', 'tp-link', 'netgear', 'd-link', 'asus', 'linksys', 'synology', 'qnap',
  'qualcomm', 'arm', 'android', 'chromium', 'opera', 'telegram', '1password', 'lastpass',
  'bitwarden', 'zyxel', 'ubiquiti', 'openssh', 'winrar', 'notepad++',
]);

/** Words that mark a front-page tech story as a security event. */
export const SECURITY_TERMS_RE = /\b(breach|breached|security incident|hacked|hack|vulnerabilit(?:y|ies)|exploit(?:ed)?|ransomware|leak(?:ed)?|compromised|zero-day|0-day|cve-\d{4}|malware|phishing|outage|supply[- ]chain attack)\b/i;

/**
 * URL builders. Each returns a fully formed URL on an allowlisted host.
 * `home` is `{lat, lon}`; builders coarsen it themselves where it leaves the box.
 */
export const urls = {
  censusGeocode: (address) => `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${new URLSearchParams({
    address, benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json',
  })}`,
  nwsPoint: (home) => `https://api.weather.gov/points/${coarse(home.lat)},${coarse(home.lon)}`,
  nwsAlerts: (home) => `https://api.weather.gov/alerts/active?point=${coarse(home.lat)},${coarse(home.lon)}`,
  nwsLatestObs: (stationId) => `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
  openMeteoAir: (home) => `https://air-quality-api.open-meteo.com/v1/air-quality?${new URLSearchParams({
    latitude: String(coarse(home.lat)), longitude: String(coarse(home.lon)),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide', hourly: 'us_aqi', forecast_days: '2', timezone: 'America/New_York',
  })}`,
  airNow: (home, key) => `https://www.airnowapi.org/aq/observation/latLong/current/?${new URLSearchParams({
    format: 'application/json', latitude: String(coarse(home.lat)), longitude: String(coarse(home.lon)), distance: '25', API_KEY: key,
  })}`,
  swpcScales: () => 'https://services.swpc.noaa.gov/products/noaa-scales.json',
  swpcKp: () => 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  usgsWeek: () => 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
  nhcStorms: () => 'https://www.nhc.noaa.gov/CurrentStorms.json',
  femaState: (stateCode) => `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?${new URLSearchParams({
    $filter: `state eq '${String(stateCode).replace(/[^A-Z]/g, '').slice(0, 2)}'`,
    $orderby: 'declarationDate desc',
    $top: '40',
  })}`,
  faaStatus: () => 'https://nasstatus.faa.gov/api/airport-status-information',
  tomtomIncidents: (home, key) => {
    const dLat = 0.07; const dLon = 0.09; // ≈ 8 km box around the coarsened home point
    const lat = coarse(home.lat); const lon = coarse(home.lon);
    const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(3)).join(',');
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
    return `https://api.tomtom.com/traffic/services/5/incidentDetails?${new URLSearchParams({
      key, bbox, fields, language: 'en-US', timeValidityFilter: 'present',
    })}`;
  },
  ticketmaster: (home, key, startIso, endIso) => `https://app.ticketmaster.com/discovery/v2/events.json?${new URLSearchParams({
    apikey: key, latlong: `${coarse(home.lat)},${coarse(home.lon)}`, radius: '12', unit: 'miles',
    startDateTime: startIso, endDateTime: endIso, size: '30', sort: 'date,asc',
  })}`,
  yahooSpark: (symbols) => `https://query1.finance.yahoo.com/v8/finance/spark?${new URLSearchParams({
    symbols: symbols.join(','), range: '1d', interval: '5m',
  })}`,
  yahooDaily: (symbol) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
  treasuryMonth: (yyyymm) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`,
  nyFedSofr: () => 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json',
  nyFedEffr: () => 'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json',
  bls: () => 'https://api.bls.gov/publicAPI/v1/timeseries/data/',
  pmms: () => 'https://www.freddiemac.com/pmms/docs/PMMS_history.csv',
  fearGreed: () => 'https://api.alternative.me/fng/?limit=8',
  stablecoins: () => 'https://stablecoins.llama.fi/stablecoins?includePrices=false',
  polymarket: () => 'https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=200',
  trends: (geo) => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`,
  wikiTop: (yyyy, mm, dd) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${yyyy}/${mm}/${dd}`,
  hnFront: () => 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
  googleNews: (query) => `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`,
  gdeltTone: (query) => `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({
    query: `${query} sourcelang:english`, mode: 'timelinetone', timespan: '7d', format: 'json',
  })}`,
  cisaKev: () => 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  nwpsGauges: (bbox) => `https://api.water.noaa.gov/nwps/v1/gauges?${new URLSearchParams({
    'bbox.xmin': String(bbox.west), 'bbox.ymin': String(bbox.south), 'bbox.xmax': String(bbox.east), 'bbox.ymax': String(bbox.north), srid: 'EPSG_4326',
  })}`,
  ndbcBuoy: (id) => `https://www.ndbc.noaa.gov/data/realtime2/${encodeURIComponent(String(id).replace(/[^A-Za-z0-9]/g, ''))}.txt`,
  nfhlExport: (bbox) => `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?${new URLSearchParams({
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north].join(','), bboxSR: '4326', imageSR: '4326',
    size: '1024,768', layers: 'show:28', format: 'png32', transparent: 'true', f: 'image',
  })}`,
  femaShelters: (bbox) => `https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/MapServer/0/query?${new URLSearchParams({
    where: "shelter_status='OPEN'", geometry: [bbox.west, bbox.south, bbox.east, bbox.north].join(','), geometryType: 'esriGeometryEnvelope',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'shelter_name,address,city,state,shelter_status,evacuation_capacity,total_population,org_name,pet_accommodations_code,wheelchair_accessible,latitude,longitude',
    returnGeometry: 'false', f: 'json',
  })}`,
  tfrList: () => 'https://tfr.faa.gov/tfrapi/exportTfrList',
  overpass: () => 'https://overpass-api.de/api/interpreter',
  overpassMirrors: () => ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
  nominatimSearch: (q, bbox) => `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: 'jsonv2', limit: '15', bounded: '1', extratags: '1', viewbox: [bbox.west, bbox.north, bbox.east, bbox.south].join(','),
  })}`,
  osrmRoute: (from, to) => `https://routing.openstreetmap.de/routed-car/route/v1/driving/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?overview=full&geometries=geojson&alternatives=false&steps=false`,
  elevation: (points) => `https://api.open-meteo.com/v1/elevation?${new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','), longitude: points.map((p) => p.lon.toFixed(4)).join(','),
  })}`,
  radarMeta: () => 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer?f=json',
  radarExport: (bbox, timeMs) => `https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage?${new URLSearchParams({
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north].join(','),
    bboxSR: '4326', imageSR: '4326', size: '1200,720', format: 'png32', transparent: 'true',
    time: String(timeMs), f: 'image',
  })}`,
  redditToken: () => 'https://www.reddit.com/api/v1/access_token',
  redditHot: (sub) => `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/hot?limit=10&raw_json=1`,
  bskySession: () => 'https://bsky.social/xrpc/com.atproto.server.createSession',
  bskySearch: (q, sinceIso) => `https://bsky.social/xrpc/app.bsky.feed.searchPosts?${new URLSearchParams({
    q, sort: 'top', limit: '8', since: sinceIso,
  })}`,
};

/** Throw unless `url` is https on an allowlisted host. */
export function assertAllowedUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !JARVIS_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Jarvis: host not allowlisted (${parsed.hostname})`);
  }
  return parsed;
}
