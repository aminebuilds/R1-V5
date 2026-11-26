# Data Sources & Attribution

R.1's **code** is [MIT](LICENSE)-licensed. **The MIT grant covers the source code only — it does NOT extend to third-party data or visual assets.** Every third-party source keeps its own license and terms. This file documents the live and bundled data sources; bundled 3D-model provenance is recorded in [`public/models/README.md`](public/models/README.md).

How to read this:

- **The non-permissive datasets are carved out, not omitted.** Some bundled data (e.g. TeleGeography, CC BY-NC-SA) isn't MIT-compatible. Rather than hide it, we **bundle it with a clear license carve-out** so the app works out of the box — but it stays under the provider's terms.
- **If your use doesn't fit a dataset's license, remove that dataset.** Most importantly: TeleGeography is **NonCommercial** — commercial users must delete it (or license it from TeleGeography). It's one self-contained folder.
- **Attribution is shown in-app** and listed here. Keep it intact. The required Google/Cesium credit renders on the on-globe credit line (bottom-left, `#cesium-credits`), and every per-layer credit below is registered into the expandable **"Data attribution"** lightbox on that line (`src/data/dataCredits.js` → `viewer.creditDisplay.addStaticCredit`). Both stay visible in clean-view and recording modes.
- **Bundled model attribution lives beside the model files.** [`public/models/README.md`](public/models/README.md) records each shipped model's creator, source, license, and modification status.
- **README media provenance lives beside the media.** [`docs/media/README.md`](docs/media/README.md) records the creator and likeness permissions for the 17 capture GIFs, plus the public source, publication permission, and reuse boundary for the two README PNGs. Third-party content visible within this media remains subject to its provider or owner's terms.

---

## Live sources (fetched at runtime — not stored in this repo)

| Source | Used for | License / terms | Attribution |
|--------|----------|-----------------|-------------|
| **Google Map Tiles API** (Photorealistic 3D Tiles) + Places/Geocoding | The 3D globe, voice scene context, and on-demand nearby installation search | Google Maps Platform ToS (proprietary, your own key + billing) | "Google" / "Google Maps" logo — **shown in-app**, required |
| **OpenSky Network** | Primary worldwide live-flight snapshot | Non-commercial research/education license | Schäfer et al., *"Bringing Up OpenSky"*, IPSN 2014 + opensky-network.org |
| **adsb.lol point API** | Bounded live-flight fallback when OpenSky has no usable snapshot | ODbL 1.0 | adsb.lol contributors; `api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}` |
| **adsb.lol** | Military flights + aircraft traces | ODbL 1.0 | "adsb.lol" (ODbL) |
| **AISStream.io** | Live vessels (AIS) | Free, beta, no formal ToS; AIS is a public broadcast | "AISStream.io" (courtesy) |
| **CelesTrak** | Satellite TLEs (SGP4) | US-government-origin data, no license; citation requested | "CelesTrak (celestrak.org), Dr. T.S. Kelso" |
| **The Space Devs — Launch Library 2 v2.3** | Recent launch, payload, stage, and recovery metadata for Space Missions (30d) | [The Space Devs terms of use](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md#terms-of-use): data may be used and shared in any form; avoid forwarding it without added value; attribution is encouraged (not mandatory). [Official API limits](https://ll.thespacedevs.com/docs/): 15 unauthenticated calls/hour; optional token | "Launch Library 2 — The Space Devs" (courtesy attribution) |
| **USGS** | Earthquakes | U.S. public domain | "Data courtesy of the U.S. Geological Survey" |
| **OpenStreetMap (Overpass API)** | Road geometry for traffic | ODbL 1.0 | "© OpenStreetMap contributors" |
| **TomTom Traffic API** (flow vector tiles) | Live congestion coloring for the traffic layer (optional, BYOK) | [TomTom for Developers terms](https://developer.tomtom.com) (proprietary, your own key; quotas depend on the current account plan) | "Traffic flow data © TomTom" — registered when live mode activates |
| **OpenStreetMap (Overpass API)** | Viewport-bounded mapped installation context for Global Context | ODbL 1.0 | "© OpenStreetMap contributors" (incomplete mapped context) |
| **OpenStreetMap (Nominatim)** | Reverse-geocoded place label in the cockpit Local Info page | ODbL 1.0 + Nominatim usage policy | "© OpenStreetMap contributors" |
| **Open-Meteo** | Current weather in the cockpit Local Info page and cockpit-local dynamic atmospheric effects | [CC BY 4.0 data licence and adjacent-link attribution requirement](https://open-meteo.com/en/licence) | Linked "Weather data by Open-Meteo.com" beside the displayed local data |
| **Google News RSS** | Primary locality-matched headlines in the cockpit Regional News page | [Google News Terms of Service](https://www.google.com/intl/en_us/terms_google_news.html) restrict use to personal, noncommercial use; linked articles remain third-party publisher content and retain publisher terms | "Google News RSS" plus each article's linked publisher/domain |
| **GDELT Project DOC 2.0** | Fail-soft fallback for location-matched cockpit headlines | [GDELT Terms of Use](https://www.gdeltproject.org/about.html#termsofuse): unrestricted academic/commercial/governmental dataset use, with citation and link required; linked articles retain publisher terms | "GDELT Project" plus each article's linked publisher/domain |
| **City of Austin Open Data** | CCTV camera catalog + frames | City of Austin Open Data Terms of Use | "City of Austin, TX — data.austintexas.gov" |
| **U.S. Energy Information Administration (EIA) Open Data v2** | Regional weekly retail gasoline prices (the price anchor) and daily crude spot (WTI/Brent) — the series the fuel pass-through model is fitted and backtested on (optional, free key) | US Government work, public domain; [EIA Open Data](https://www.eia.gov/opendata/) requests citation | "U.S. Energy Information Administration (EIA)" |
| **Ministerio para la Transición Ecológica y el Reto Demográfico (Spain)** | Official station-level fuel prices for ~11,000 Spanish service stations (keyless) | Spanish open-data reuse terms ([geoportalgasolineras.es](https://geoportalgasolineras.es)) | "Ministerio para la Transición Ecológica y el Reto Demográfico (geoportalgasolineras.es)" |
| **prix-carburants / data.gouv.fr (France)** | Official station-level fuel prices for French stations (keyless) | [Licence Ouverte / Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence) | "Ministère de l'Économie — prix-carburants.gouv.fr (Licence Ouverte)" |

**No US station-level price feed is wired, deliberately.** GasBuddy and OPIS
license their per-station data commercially and publish no free API; every
"free" alternative found is a scraper operating against a site's terms of
service. Shipping one would breach those terms and put fabricated-provenance
prices on the map. The supported US paths are the EIA regional anchor above
(published, free, public domain) and the operator's own price book.
| **Caltrans (cwwp2.dot.ca.gov)** | CCTV camera catalogs + frames, California districts | Public Caltrans traffic camera data | "Caltrans — cwwp2.dot.ca.gov" (courtesy) |
| **TfL Open Data (JamCams)** | CCTV camera catalog + frames, London | [TfL Open Data terms](https://tfl.gov.uk/info-for/open-data-users/) — attribution REQUIRED | "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights" |
| **GBFS (Lyft / BCycle)** | Bikeshare availability | Per-feed (attribution-only) | Credit the operator (e.g. Austin BCycle) + its `license_url` |
| **Radio Browser** | Geolocated internet-radio station directory and station-level tags | Public-domain directory data under PDDL 1.0; individual broadcaster stream terms apply | "Radio Browser" plus a link to the selected broadcaster |
| **Re:Earth Terrain** (Mapterhorn) | Terrain (keyless globe stacks — OSM etc. — + `/api/terrain/heights` ellipsoidal-height lookups) | Terrain mesh: CC BY 4.0; geoid: EGM2008 (NGA, public domain) | "Terrain (keyless globe stacks): Re:Earth Terrain / Mapterhorn (CC BY 4.0) / EGM2008 (NGA)" |
| **FAA NAS Status** (ATCSCC airport status feed, `nasstatus.faa.gov/api/airport-status-information`) | Ground stops, ground delay programs, airport delays and closures on the US airspace brief (keyless) | US Government work, public domain | "FAA NAS Status (nasstatus.faa.gov)" |
| **OpenSky Network** — `flights/all` table | Departure-by-half-hour study for an airspace event on the US airspace brief (authenticated; ~30 API credits per two-hour window) | Same OpenSky non-commercial terms as the live-flight snapshot | Same as OpenSky above |
| **Google News RSS / GDELT DOC 2.0** — airspace query | Linked event headlines on the US airspace brief | Same terms as the regional-news rows above: GDELT permits commercial use with citation; Google News RSS is personal/non-commercial only | "GDELT Project" or "Google News RSS", plus each article's linked publisher |
| **USGS ComCat FDSN event query** (`earthquake.usgs.gov/fdsnws/event/1/query`) | Eight days of M2.5+ earthquakes behind the time slider (fetched in the browser, keyless) | U.S. public domain, same as the USGS row above | "Data courtesy of the U.S. Geological Survey" |
| **GDELT DOC 2.0** — `timelinevol` per oil chokepoint (`/api/gdelt/series`) | The time slider's chokepoint lanes: eight days of news-coverage share for Hormuz, Malacca, Suez and Bab el-Mandeb, using the same queries as the disruption index | Same GDELT terms as above: commercial use permitted with citation | "GDELT Project" |

### Jarvis personal console (`jarvis.html`, `/api/jarvis/snapshot`)

Fetched server-side by `src/jarvis/jarvisService.js` from the fixed allowlist in
`src/jarvis/sources.js`. Every panel labels its figures measured, modelled, or
unavailable (with the reason); nothing is filled in. This console is for the
operator's own, personal use — several sources below (Yahoo Finance, Google
News RSS, Google Trends) are personal/non-commercial only, so it must not be
put in front of paying customers as-is.

| Source | Used for | License / terms | Attribution |
|--------|----------|-----------------|-------------|
| **US Census Geocoder** | One-time geocode of `JARVIS_HOME_ADDRESS` (cached in `.r1-cache/jarvis/home.json`) | US Government work, public domain | "U.S. Census Bureau Geocoder" |
| **National Weather Service API** (`api.weather.gov`) | Active alerts for the home point, latest station observation (measured), hourly and 12-hour forecast (modelled) | US Government work, public domain; NWS asks for an identifying User-Agent (sent) | "National Weather Service" |
| **Open-Meteo Air Quality** (CAMS) | Current and 24 h peak US AQI — labelled **modelled** | CC BY 4.0, linked attribution required | "Weather data by Open-Meteo.com" (linked in the footer) |
| **EPA AirNow** (optional, `AIRNOW_API_KEY`) | Monitor-measured AQI, replaces the modelled value when set | AirNow data-use guidelines; preliminary data | "U.S. EPA AirNow" |
| **NOAA SWPC** | Space-weather R/S/G scales and planetary Kp | US Government work, public domain | "NOAA Space Weather Prediction Center" |
| **NOAA National Hurricane Center** | Active tropical cyclones with distance from home | US Government work, public domain | "NOAA NHC" |
| **USGS M2.5+ week feed** | Earthquakes within 500 km of home and global M6+ | U.S. public domain | "Data courtesy of the U.S. Geological Survey" |
| **OpenFEMA** | Disaster declarations for the home state/county | US Government work; OpenFEMA terms | "FEMA (OpenFEMA)" |
| **FAA NAS Status** | Ground stops/delays/closures at EWR, LGA, JFK, TEB | US Government work, public domain | "FAA NAS Status" |
| **TomTom Traffic Incident Details** (`TOMTOM_API_KEY`) | Incidents within ~8 km of home, 5-min cache | TomTom developer terms, your key and quota | "Traffic © TomTom" |
| **Ticketmaster Discovery** (optional, `TICKETMASTER_API_KEY`) | Ticketed events within 12 miles, next 48 h | Ticketmaster Discovery API terms | "Ticketmaster" |
| **Yahoo Finance chart/spark endpoints** | Market board (delayed) and SPY daily closes for the trend regime | Unofficial, undocumented endpoints; Yahoo terms — **personal use only** | "Yahoo Finance" |
| **U.S. Treasury** daily par yield curve | Curve and day-over-day change | US Government work, public domain | "U.S. Department of the Treasury" |
| **Federal Reserve Bank of New York** | SOFR and EFFR | NY Fed terms of use; attribution requested | "Federal Reserve Bank of New York" |
| **Bureau of Labor Statistics API v1** | Unemployment, CPI and core CPI y/y, payroll change (≤25 calls/day; cached 12 h on disk) | US Government work, public domain | "U.S. Bureau of Labor Statistics" |
| **Freddie Mac PMMS** | Weekly 30- and 15-year mortgage rates | Freddie Mac terms of use; attribution required | "Freddie Mac Primary Mortgage Market Survey®" |
| **Alternative.me** | Crypto Fear & Greed Index | Free API; attribution required | "Alternative.me" (linked in the footer) |
| **DefiLlama** stablecoins API | USD-pegged stablecoin supply and 1/7/30-day drift | Open API, attribution requested | "DefiLlama" |
| **Polymarket Gamma API** | Top non-sports prediction markets by 24 h volume, last prices | Polymarket terms; public read API | "Polymarket" |
| **Google Trends daily RSS** | US and home-state trending searches | Google terms — personal use | "Google Trends" |
| **Wikimedia pageviews REST** | Top English-Wikipedia articles for the previous UTC day | CC0 pageview data | "Wikimedia Foundation" |
| **Hacker News (Algolia API)** | Tech front page; security stories flagged | HN API terms | "Hacker News" |
| **Google News RSS** | Local, local-incident, macro, AI and tokenization headlines | Personal, non-commercial use only; publishers keep their rights | "Google News RSS" plus each linked publisher |
| **GDELT DOC 2.0** `timelinetone` | 24 h vs 7-day average article tone per theme (one request per 5 s, refreshed hourly in the background) | Commercial use permitted with citation and link | "GDELT Project" (linked in the footer) |
| **CISA KEV catalog** | Known-exploited vulnerabilities added in the last 10 days; consumer vendors flagged | US Government work, public domain | "CISA Known Exploited Vulnerabilities Catalog" |
| **Reddit API** (optional, OAuth app-only) | Hot posts in a few subreddits | Reddit Data API terms; your own app credentials | "Reddit" |
| **Bluesky / AT Protocol** (optional, app password) | Top posts for a few search terms, last 24 h | Bluesky developer guidelines | "Bluesky" |

**Not wired, deliberately:** CNN's Fear & Greed endpoint rejects non-browser
clients (HTTP 418) and is not an API, so it isn't spoofed. Reddit and Bluesky
search now require authentication, so without credentials they report
`no-key` instead of scraping. Tokenized-treasury AUM has no free
authoritative feed (rwa.xyz is licensed), so it isn't shown. Utility outage
maps (PSE&G) publish no public API.

### Notes on the live sources

- **Google Maps Platform.** You supply your own API key and are bound by [Google's ToS](https://cloud.google.com/maps-platform/terms). Google Maps Content (tiles, geocodes, places) **may not be cached, stored, rehosted, or committed** — this app only ever uses it live, which is the compliant pattern. The "Google" attribution is displayed on the globe and must stay visible. Restrict your key (see [SECURITY.md](SECURITY.md)). As-you-type search suggestions (`/api/google/autocomplete`, `/api/google/place-details`) use Places Autocomplete with a client-minted session token, priced by Google as one bundled session per search interaction rather than per keystroke — the cost-conscious lever for a live-typing UI, alongside client-side debouncing and a 2-character minimum. Like the other Places proxies, neither endpoint keeps a server-side result cache; both set `Cache-Control: private` only, which lets the requesting browser reuse its own response briefly without the server storing or rehosting Google's data across requests.
- **OpenSky Network.** Its license is **non-commercial**, and operational use of the REST API in a live product can require a prior written agreement with OpenSky — even for non-profit/government use. If you deploy this commercially, contact OpenSky for your own terms. The flights layer is a toggle and runs anonymously by default.
- **adsb.lol flight fallback.** When OpenSky is unavailable and no last-good OpenSky response exists, the server requests a cached, capped 250 nm adsb.lol point snapshot around the current camera subpoint. This is regional observed context, not worldwide completeness; provenance is exposed in the Flights stats/context row. Military ICAOs remain reconciled through the existing dedicated military registry rather than duplicated.
- **Launch Library 2.** `/api/launches` makes a server-side rolling-30-day query against the supported v2.3 detailed launch endpoint, caches successful responses for 15 minutes in memory and on disk, and serves the last successful response during a throttle or transient outage. Anonymous access is limited to 15 calls/hour; deployments can provide `LL2_API_TOKEN` for authenticated access. The Space Devs' published terms permit using and sharing the API data in any form, ask users not to forward it without adding value, disclaim complete accuracy, and encourage—but do not require—attribution. This app keeps a courtesy credit. Payload and stage/recovery records are shown only when supplied. Failed launches expose their source status and never receive fallback orbit geometry or a live/estimated marker. LL2 supplies launch context and event timing, not continuous ascent telemetry or live orbital state.
- **TfL JamCams.** The camera list comes from the keyless `api.tfl.gov.uk` endpoint (an optional `TFL_APP_KEY` raises its rate limit); frames come from TfL's public S3 bucket. The "Powered by TfL Open Data" attribution is required by TfL's terms and is registered in the Data attribution popover.
- **Radio Browser.** `/api/radio/stations` discovers official API mirrors, makes bounded and coalesced healthy/geolocated HTTPS-station queries, caches the normalized public-domain directory for 45 minutes, and may serve the last good catalog for up to seven days during an outage. Refreshes must meet minimum accepted-query and station coverage before replacing a warm catalog; schema-valid responses whose rows all fail the product's health policy do not count as successful queries. A usable partial cold catalog is explicitly `DEGRADED`, and malformed or empty successful payloads are rejected atomically. Every directory and click-count request rejects redirects, validates all resolved addresses as globally routable (including reserved/documentation IPv4 and special/non-global IPv6 exclusions), and pins the TLS connection to a validated address. Only MP3/AAC non-HLS directory rows with public HTTPS stream targets are returned; favicons are intentionally omitted. Pressing play connects one browser audio element directly to the selected broadcaster and calls the directory's click counter through known-ID-only `POST /api/radio/click/:uuid`. R1 never proxies, caches, records, bundles, or redistributes audio. Radio Browser supplies station-level tags, not dependable current-song or upcoming-program metadata, so Radio filtering never claims either. Direct playback exposes the listener's IP address to the broadcaster, whose own stream terms apply.
- **TomTom Traffic.** Optional and BYOK: without `TOMTOM_API_KEY` the traffic layer runs its built-in simulation and no TomTom data (or attribution) appears. With a key, flow vector tiles are fetched through the server-side `/api/tomtom` proxy (120 s cache + a configurable daily tile-budget governor, default 40,000 requests) and the "Traffic flow data © TomTom" credit is registered in the Data attribution popover the moment live mode activates. Set that governor within the current allowance for your TomTom account; the application default is a safety limit, not a promise of free quota. TomTom data is served live and cached only transiently (≤120 s TTL under `.r1-cache/`, gitignored) — it is not bundled or redistributed. One 23 KB point-in-time tile snapshot is committed as a decode-test fixture (`src/data/fixtures/`, © TomTom, never served to the app).
- **Re:Earth Terrain.** Keyless (no API key). Used two ways: (1) `src/mapStackController.js` swaps in a `Cesium.CesiumTerrainProvider` pointed at Re:Earth's `cesium-mesh/ellipsoid` quantized-mesh endpoint for globe stacks without a Cesium ion token (e.g. OSM), replacing a flat `EllipsoidTerrainProvider`; falls back to the flat provider if the endpoint can't be reached. (2) The server-side `/api/terrain/heights` proxy (disk-cached, serve-stale) resolves per-point ellipsoidal ground height for entity placement. Both are best-effort with a keyless-safe fallback (bundled EGM96 geoid math) if Re:Earth is unreachable.
- **Global Context installation context.** `/api/military-installations` queries only an allow-listed subset of OSM `military=*` and `landuse=military` features inside a maximum 10° non-dateline viewport. It caches and may serve stale mapped context, but it is neither a global installation database nor evidence of capability, activity, or absence. User-requested Google Places results remain separately sourced candidates unless their returned types explicitly establish military classification; generic offices, museums, and similarly ambiguous matches are excluded from military proximity counts.
- **Cockpit regional briefing.** `/api/regional-brief` rounds aircraft coordinates into 0.1° cache cells, caches results for five minutes, and serializes Nominatim calls at no more than one request per second. Google News RSS is queried with the resolved locality/region first; GDELT is used only when that RSS query fails or is empty. Google's published Google News terms restrict that source to personal, noncommercial use, so commercial deployments must disable/replace it or obtain separate permission; GDELT permits commercial dataset use with citation. The Data attribution popover identifies the active headline sources; article links retain publisher attribution. Headlines are location-query matches, not verified incidents, risk rankings, or evidence that a location is safe. Empty, partial, stale, and unavailable source states remain distinct. Open-Meteo supplies current conditions independently of the news source. `WX OFF` disables cockpit weather rendering only; the Local Info briefing still fetches its source-backed weather values and displays the required linked Open-Meteo credit.
- **US airspace brief.** `/api/airspace/brief` combines four feeds, each reported with its own state (`ready`, `stale`, `computing`, `unavailable`) rather than blended:
  - **FAA NAS Status** is read on demand and cached for 60 s. If it can't be read, the brief says so and never reports "no programs".
  - **US airborne counts** come from OpenSky `states/all`. The server samples them into `.r1-cache/airspace-timeline.json` (gitignored; up to seven days at ten-minute spacing). A sample reuses the flights proxy's own cached snapshot when it is under three minutes old, which costs no extra credits. Otherwise the server fetches its own snapshot every `R1_AIRSPACE_SAMPLE_MIN` minutes (default 10; `0` turns self-fetching off). It never fetches during a 429 cooldown.
  - **The departure study** reads OpenSky's `flights/all` table. That table is a sample of global traffic and adds a flight only after it lands, so it is used for the shape of the event day against the day before, never as a total. It is cached per two-hour window; a window that ended more than 24 h ago is never re-fetched.
  - **Headlines** query GDELT first and fall back to Google News RSS. Google News results carry the non-commercial caveat on the board.
- **Curated event records** (`src/airspace/events.js`) pin reported facts of an airspace event to the outlet that published them, with the time the record was last checked. They link to articles; they don't copy them (paraphrase, quotes under fifteen words). Facts R.1 measured itself from OpenSky are labelled as such and carry no link.
- **Dynamic weather presentation.** While cockpit mode is active, `/api/weather-effects` requests current Open-Meteo observations for the aircraft/camera location, rounds coordinates into 0.1° cache cells, caches results for five minutes, and may retain a stale observation for up to 30 minutes during a transient outage. WMO condition code selects the visual family; observed cloud cover, precipitation, visibility, wind speed, and wind direction bound its strength and motion. Missing or expired weather renders no synthetic atmospheric effect, and normal globe view never renders the weather overlay.

---

## Bundled snapshots (committed under `src/data/local_data/`)

Static datasets shipped in the repo for an out-of-the-box experience. **None are MIT** — each keeps its own license (see the carve-out in [LICENSE](LICENSE)). Each folder also has its own provenance README.

| Dataset | Folder | License | Commercial use? | Attribution |
|---------|--------|---------|-----------------|-------------|
| **Datacenters** (~4.3K) | `datacenters/` | **ODbL 1.0** (OpenStreetMap extract) | ✅ (attribution + share-alike on data) | "© OpenStreetMap contributors" |
| **Dams** (704) | `dams/` | **ODbL 1.0** (OpenInfraMap / OSM extract) | ✅ (attribution + share-alike on data) | "© OpenStreetMap contributors" (+ Open Infrastructure Map) |
| **TeleGeography Submarine Cable Map** (712 cables + 1,917 landing points) | `telegeography_submarine_cables/` | **CC BY-NC-SA 3.0** | ❌ **NonCommercial — remove for commercial use** | "© TeleGeography — submarinecablemap.com" |
| **Natural Earth physical regions** (1,046 land + 292 marine named polygons) | `natural_earth/` | **Public domain** | ✅ (no restrictions) | "Made with Natural Earth" (courtesy credit — not legally required) |
| **DataSF Analysis Neighborhoods** (41 SF neighborhood polygons) | `neighborhoods/` | **PDDL 1.0** (public domain) | ✅ (no restrictions) | "City & County of San Francisco — DataSF" (courtesy — not legally required) |

### ⚠️ TeleGeography is bundled but NonCommercial

The submarine-cable GeoJSON is **CC BY-NC-SA 3.0** (Attribution-**NonCommercial**-**ShareAlike**). It is bundled so the cables layer works out of the box, but it is **not covered by this project's MIT license**. CC BY-NC-SA permits redistribution with attribution and share-alike — which is exactly how it ships here — but the **NonCommercial** clause means:

> If you use R.1 commercially, delete `src/data/local_data/telegeography_submarine_cables/` (or obtain a commercial license from TeleGeography). It is one self-contained folder; the rest of the app runs without it.

The richer structured dataset is licensed separately/commercially by TeleGeography.

### ODbL share-alike (datacenters, dams)

The OSM-derived datasets are under the **Open Database License**. ODbL's share-alike applies to the **data / derived database, not this MIT-licensed code** — the two coexist (exactly how Open Infrastructure Map ships: MIT software + ODbL data). If you publicly distribute a *modified* version of these databases, you must offer it under ODbL. Keep the "© OpenStreetMap contributors" notice (link: https://www.openstreetmap.org/copyright).

The bundled public-release copies omit contact-oriented tags and any note value
that contains an email or phone identifier. Those fields are not used by the
application. This privacy transform does not change feature geometry, identity,
name, operator, capacity, or river metadata, and the resulting derived databases
remain under ODbL 1.0.

### NASA FIRMS acknowledgement

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing System Data and Information System (EOSDIS).

FIRMS active fires are **fetched live at runtime** (CC0 / U.S. public domain data): the
`/api/firms` server-side proxy merges the three VIIRS NRT sources (NOAA-20, NOAA-21,
Suomi-NPP) clamped to the trailing 24 h, cached 30 min to respect the shared MAP_KEY
transaction quota. Requires a free `FIRMS_MAP_KEY`
(https://firms.modaps.eosdis.nasa.gov/api/map_key/); the layer is empty without it.
The former bundled 2026-05-25 snapshot was removed 2026-07-16.

The time slider adds a **nine-day detection history** under the same key:
`/api/firms/history` backfills nine UTC days in requests of at most five days
(FIRMS' `DAY_RANGE` limit, counted forward from `DATE`), keeps one file per day
in the gitignored `.r1-cache/firms-history/`, and re-fetches a day only until 6 h
after it ended. Every live refresh also tops up the two open days at no extra
cost. The first backfill is six world-sized requests (two per source, ~20 MB of
CSV each). That is well inside the 5,000-transaction / 10-minute quota, though
FIRMS notes multi-day requests can count as several transactions. Nothing is
redistributed: the browser downloads the detections from this server, packed
binary (~14 MB for nine days), only when the slider is opened.

### Natural Earth physical regions (`natural_earth/`)

Curated from the **Natural Earth 10m physical vectors** (https://www.naturalearthdata.com/ —
fetched from the canonical `nvkelso/natural-earth-vector` GitHub repo, commit
`ca96624a56bd078437bca8184e78163e5039ad19`, 2026-07-28): `ne_10m_geography_regions_polys`
(mountain ranges, deserts, plateaus, peninsulas, islands, …) → `regions.json` and
`ne_10m_geography_marine_polys` (seas, gulfs, straits, bays) → `marine.json`. They back the
voice-annotation resolver's named-natural-region lookup (`src/data/naturalEarthRegions.js`),
so "outline the Alps" draws the real range polygon offline.

Curation (provenance in each file's `meta` header): named features only, outer rings only,
Douglas-Peucker simplified at ~0.01° with coordinates rounded to 3 decimals, sub-20 km²
MultiPolygon crumbs and zero-area sliver artifacts dropped (7.3 MB source → 2.5 MB pack).

Natural Earth is **public domain** (no permission needed, no attribution legally required —
https://www.naturalearthdata.com/about/terms-of-use/). We credit anyway: "Made with Natural
Earth". Registration in the in-app `dataCredits.js` attribution list ships with the resolver
wiring (see below).

### DataSF Analysis Neighborhoods (`neighborhoods/`)

`neighborhoods/san-francisco.json` bundles the City & County of San Francisco's official
**"Analysis Neighborhoods"** dataset (41 neighborhood polygons; DataSF dataset `j2bu-swwd`,
catalog map view
[`p5b7-5n3h`](https://data.sfgov.org/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-Map/p5b7-5n3h)).
It backs the voice-annotation resolver's offline neighborhood-boundary lookup
(`src/data/neighborhoodPolygons.js`), so "outline Chinatown" draws the city's real
boundary polygon with no network dependency.

The dataset is licensed **PDDL 1.0** (Open Data Commons Public Domain Dedication and
License — public domain; the DataSF metadata declares `licenseId: "PDDL"`). No attribution
is legally required; we note the source here and in the folder's `SOURCE.md`, which records
the retrieval date (2026-07-30), exact download URL, license evidence, and the
deterministic transform (`scripts/build-sf-neighborhoods.mjs`: `nhood` → `name`, ~2 m
Douglas-Peucker simplification, 6-decimal rounding).

---

## The store agent has no external source

`src/storeAgent/` carries no entry in this file because it reaches no feed.
Store performance, loyalty, member, campaign and offer figures are generated
in-process by a deterministic simulation of a PAR-class POS/loyalty stack —
there is no provider, no licence, and nothing to attribute. It is the
demonstration substrate for the commercial motion, and
[`src/storeAgent/storeLedger.js`](src/storeAgent/storeLedger.js)'s header
states the constraint that goes with that: it must not serve a paying
operator's console, and its output must not be blended into a rollup that
also carries measured feeds.

If a real operator stack is ever wired in, it gets an entry here like any
other source, and the seam is the exports of `src/storeAgent/storeAgent.js`.

---

## In-app attribution

The required Google Maps / Cesium credit renders on the on-globe credit line (`#cesium-credits`, bottom-left) and must stay visible — including in clean-view and recording modes (the whole line, logo + "Google Maps" + the "Data attribution" link, stays on screen; only the R1 panels/HUD fade). The layer-specific credits (adsb.lol, TeleGeography, OSM datacenters/dams/roads, NASA FIRMS, CelesTrak, USGS, City of Austin, GBFS, Radio Browser, OpenSky, AISStream) are registered into the expandable **"Data attribution"** popover on that credit line via `viewer.creditDisplay.addStaticCredit(new Cesium.Credit(html, /* showOnScreen */ false))` — see `src/data/dataCredits.js`. When you add a new data source, add its license and attribution to this file **and** append an entry to `DATA_CREDITS` in `src/data/dataCredits.js` so it surfaces in the app.
