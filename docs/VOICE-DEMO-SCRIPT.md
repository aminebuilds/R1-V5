# Voice demo script — two scenarios, live data only

**Status:** Both scenarios run end-to-end on real, live data as of 2026-09-20.
Built to close two gaps found while scoping this doc — see §4 "What changed
to make this true" for exactly what was wired and why.

This is rehearsal material, not a spec. Say the operator lines roughly as
written; the tool calls and data are real regardless of exact phrasing, since
the Realtime model chooses the tool from intent, not a keyword match.

---

## 0 · Before you go on stage

1. **Dev server up, keys warm.** `npm run dev`, then in the browser console
   (or just by using the app once) fire one `get_fuel_price_outlook` call
   so the 6-hour EIA cache is warm — the first call after a server restart is
   a live network round trip and adds a couple of seconds.
2. **Pick a chokepoint with live AIS coverage.** AISStream's receiver density
   is real and uneven — checked live on 2026-09-20, **Hormuz had zero vessels
   in the gate box; Malacca had 53, Suez and Bab el-Mandeb also empty at that
   moment.** This changes hour to hour. Run this in the browser console a few
   minutes before you go on:
   ```js
   const dm = window.__r1?.dataManager;
   const mod = dm?.layers?.get('ais-live-vessels')?.module;
   const vessels = mod?.getAnalystRecords?.(50000) || [];
   const gates = {
     hormuz: {south:25.6,west:55.6,north:27.2,east:57.4},
     malacca:{south:1.0,west:100.0,north:6.0,east:104.5},
     suez:   {south:27.5,west:32.0,north:31.6,east:34.2},
     bab:    {south:11.5,west:42.0,north:14.0,east:44.5},
   };
   Object.fromEntries(Object.entries(gates).map(([id,g]) =>
     [id, vessels.filter(v => v.lat>=g.south&&v.lat<=g.north&&v.lon>=g.west&&v.lon<=g.east).length]));
   ```
   Use whichever gate is non-zero. If Hormuz genuinely has traffic that day,
   great — say "Strait of Hormuz" and it will resolve correctly (Google
   Geocoding returns it as a `natural_feature`; `fly_to_location` has a
   purpose-built framing path for straits). If not, say "Strait of Malacca"
   instead — the mechanics are identical, only the name changes.
3. **Warm the disruption history a little.** `transits` (tanker-count
   history) is real but starts empty — this app has no historical AIS feed to
   draw on, so it builds its own history one real observation at a time (see
   §4). One `get_fuel_price_outlook` call per gate records one snapshot; a
   second call **5+ minutes later** records the next, and only then does
   `transits` stop reading `missing`. If you want all four disruption
   components live on stage, make one warm-up call now and demo at least 5
   minutes later. If you demo sooner, the index still works — it will
   honestly report `partial-3-of-4` or fewer, which is itself a fine thing to
   narrate ("here's what's actually measured right now").
4. **Layers: only what each scenario needs.** Neither scenario needs flights,
   military, earthquakes, satellites, fires, or CCTV. If any of those got
   toggled on during earlier testing, turn them off first — `set_layer_visibility`
   per layer, or just reload the page (layer + portfolio state live in
   `localStorage` under `r1:layer-state:v2` / `r1:banner-os:portfolio:v1`;
   clearing those two keys resets to a clean slate).
5. **Clear any leftover portfolio** from rehearsal before the real run —
   same two `localStorage` keys, or just say "clear the portfolio" /
   `return_to_portfolio` won't clear it, so clear storage or reload.

---

## 1 · Scenario A — Fuel price prediction at a chokepoint

**Layers this needs:** `ais-live-vessels` only. Nothing else.

**Operator says:**

> "Take me to the Strait of Hormuz." *(or Malacca — see §0.2)*

**What fires:** `inspect_chokepoint` — flies the camera to the gate box,
turns on `ais-live-vessels` if it isn't already on, and waits (up to the
tool's own timeout) for real AIS contacts to appear inside the box before
answering. It will not report a confident zero from a feed that simply
hasn't delivered anything yet for that box — it says so explicitly
("no coverage," not "0 tankers") when that happens.

**Operator says:**

> "What's the situation there, and where do you think fuel prices are
> heading over the next month?"

**What fires:** `get_fuel_price_outlook({ chokepoint })`. One call now
returns, all real:

- **Tanker count in the gate right now** (live AIS, floor not a total — the
  response says how many contacts carried no ship type at all).
- **The disruption index** — a 0–100 score built from up to four real,
  independently-sourced inputs, each scored against its own trailing
  history (`departureScore`, not an absolute threshold someone picked):
  - **Tanker transits** — this app's own accumulated snapshot history (see
    §0.3). `missing` until ≥2 real observations exist.
  - **GDELT event volume** — a real daily time series (~90 days) from
    GDELT's keyless `timelinevol` mode, on a query built per gate (e.g. for
    Hormuz: tanker/attack/blockade/sanctions terms).
  - **GDELT event tone** — same source, `timelinetone` mode.
  - **EIA spot volatility** — realised volatility computed directly from the
    same 12-year Brent spot series the price model already fetched; no
    extra network call.
  - The index names exactly which components it has and which are
    `missing` — never averages over an absent one.
- **The 4-week price band**, EIA-anchored, from the real asymmetric
  pass-through regression (`fitPassThrough`/`forecastPassThrough`), with its
  own backtested MAE against naive-flat-price printed alongside it
  (`beatsNaive: true/false` — say it either way).
- **The causal link that makes this a real prediction and not two numbers
  side by side:** when the disruption index is above 50, it genuinely
  widens the band's *upper* bound — `forecast.riskWidenedCents` is nonzero
  and `forecast.confidence` flips to `modelled-with-risk-overlay`. Verified
  live: Malacca's index of 55 widened the band by 1¢ on 2026-09-20. The
  central path never moves — only the upside risk does. Say this out loud;
  it is the whole point of L3.

**Say it straight, not oversold:** "Risk has risen" is the only claim the
index is allowed to make — never "price will be $X." And the anchor itself
is the **US national (or PADD) retail price**, not a Gulf-regional price —
there is no such public series. The story is "a real disruption signal at a
global chokepoint is widening the risk band on the US pump-price forecast,"
which is true and still a strong demo; don't let the narration imply a
Gulf-local price exists.

**Optional follow-up:**

> "Show me the tanker traffic there." → already on screen from the AIS
> layer; `get_current_view_state` or just a visual pan works if you want a
> second beat.

---

## 2 · Scenario B — Retail intelligence for a chosen site

**Layers this needs:** `sites` (via search, not a layer toggle) + `traffic`.
Nothing else.

**Operator says:**

> "Show me the 7-Elevens around [wherever you're demoing — pick a real
> downtown with actual nearby competitors, e.g. downtown Austin]."

**What fires:** `search_business_sites` or `activate_network` — real Google
Places + OSM Overpass results, added to the portfolio, camera flies to the
network. Any brand works identically; nothing about 7-Eleven is
special-cased.

**Operator says:**

> "Analyze the competition around these — who's winning on traffic?"

**What fires:** `analyze_competitors`. Per site, all real:

- Competitor count within 1/3/5 km, and a density-based dominance score
  (`measured-density` — a counting convention, not a fitted model, and it
  says so).
- The client site's own live TomTom road-congestion reading.
- **New:** live TomTom readings for the site's 3 nearest mapped
  competitors, and the delta between the site's own congestion and the
  busiest of them (`competitorTraffic.leadingCompetitor.deltaPct`).
- **When a competitor's corridor is reading ≥20 points more congested than
  the site's own, within 2 km:** the `play:competitor-traffic-advantage`
  recommendation fires — a parameterised lookup, not language-model prose.
  Its `expectedLiftPct` is `null` until a holdout measures it; say that
  aloud too, it's the product's whole honesty contract.

**Say the distinction out loud, every time:** this is **road congestion**,
not footfall. "Shop 24, 280 meters away, is showing 21 points higher live
road congestion than your site right now" is a true, measured sentence.
"Shop 24 has more customers than you" is not something this data supports —
don't let the narration drift there. Store-level footfall has no free public
source and is never faked here.

**Optional follow-ups, same site:**

> "Any construction or delays nearby?" → `get_traffic_delays_and_construction`
> — real TomTom bottleneck/closure detection.

> "What about fuel pricing here?" → `get_fuel_price_outlook` at the site's
> coordinates. In the US this resolves to the **PADD-region anchor**, not a
> per-station live price — station-level live pricing is only real and free
> in Spain/France/Germany/Italy/Australia today. Say which one you're
> getting.

> "How's this whole view doing?" → `get_view_health` — a rollup naming
> exactly what's measured (sites in view, live-flow coverage, mean
> congestion, price coverage) versus `null` where nothing real exists yet.

---

## 3 · Scenario C — One command, the full picture

**Layers this needs:** `sites` (via search) + `traffic`. Nothing else.

**Opens differently from Scenario B on purpose:** the first-run "Retail &
Fuel Networks" tile no longer defaults to a specific chain — it used to
silently activate "Casey's" for every visitor. Now it just focuses the
search box. So the demo starts with **your own** chain, spoken or typed —
say the name of the business you're actually demoing for.

**Operator says:**

> "Show me the Shells around downtown Austin."

**What fires:** `search_business_sites` / `activate_network` — same as
Scenario B, real Places + Overpass results on the map.

**Operator says:**

> "Check the competitors."

**What fires:** `analyze_competitors` — same engine as Scenario B, but now
also **places a pin at every competitor location**, not just the territory
ellipse. Verified live: 5 client sites → 10 competitor pins actually
rendered on the globe from this one line, magenta and distinct from the own
orange site dots.

**Operator says:**

> "Give me a full analysis."

**What fires:** `get_full_insight` — one call that runs `analyze_competitors`
(pins again), `get_view_health`, the fuel price model, a **modelled**
busyness estimate per site, and local news, then hands it all to the model
as one bundle. Verified live, real numbers, one round trip: 4 of 5 sites
heavily congested, 13 measured corridor closures, Gulf Coast regular at
$3.953/gal with a backtested 4-week band of $4.044–$4.272/gal, and a
loyalty-intercept play recommended at the one site with a real competitor
traffic advantage.

**Two things to say out loud, every time this runs:**

- **Busyness is modelled, never measured.** It's live road congestion ×
  time-of-day × site format — an honest substitute for the Google
  Popular-Times equivalent, which has no free API and is never faked here.
  Say "modelled busyness," not "how busy the store is."
- **News carries its own license.** When the source is Google News RSS
  (shown in the result), say so — that feed is non-commercial-use-only, and
  the board flags it. GDELT-sourced headlines carry no such caveat.

**Optional follow-up:**

> "What's the local news here?" → `get_local_news` alone, same sourcing
> rule, useful when you only want the headlines without the rest of the
> bundle.

---

## 4 · What changed to make this true (context, not script)

Two real gaps were found and closed on 2026-09-20, both on real data, no
synthetic fallback:

1. **The disruption index was fully built but never called outside its own
   unit test.** `get_fuel_price_outlook` computed its own tiny inline tanker
   count and returned it *next to* the price band, not *feeding* it. Fixed by
   wiring `computeDisruptionIndex()` into the handler with three real inputs
   (a new GDELT timeline proxy for event volume/tone, EIA-derived volatility
   history, and a new self-accumulating tanker-snapshot store since AIS has
   no historical feed) and passing the resulting index into
   `buildRegionalPriceModel`, which already accepted — but was never
   given — a `disruptionIndex` argument.
2. **Nothing compared a site's live traffic to a competitor's.**
   `analyze_competitors` only ever gave competitor *locations*. Added
   `compareSiteTrafficToCompetitors()` (live TomTom on the nearest 3
   competitors) and a new play, `play:competitor-traffic-advantage`, worded
   specifically to keep "road busy" and "store busy" from being confused —
   the one distinction this whole vertical's spec calls out as the thing
   that must never be conflated.

Both are covered by new unit tests (`disruptionIndex.test.mjs`,
`competitiveEngine.test.mjs`, `playLibrary.test.mjs`) and the full suite
(2933 tests) is green. Neither change touched the `R1_REALTIME_TOOLS` schema
in `vite.config.js`, so the two byte/hash-pinned voice-tool-schema tests are
unaffected.

**Known, live limitations, worth saying on stage rather than hiding:**

- AIS chokepoint coverage is genuinely intermittent (receiver density, not a
  bug) — check before you go on (§0.2).
- `transits` starts `missing` and fills in only after real elapsed time
  between observations — it is not backfilled or estimated.
- The play-matching system gates on category words appearing in a site's
  name/format text; Google-Places-sourced sites carry `format: null`, so
  most plays with a category list wouldn't fire for a bare brand name like
  "7-Eleven". `play:competitor-traffic-advantage` is deliberately
  category-unfiltered for this reason — the other five existing plays still
  have this limitation and it wasn't in scope to fix here.
