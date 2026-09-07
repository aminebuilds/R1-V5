# R.1 — Retail & Fuel Intelligence

**Capability specification for the fuel-and-convenience vertical**

| | |
|---|---|
| **Status** | Built · P1–P7 landed, no simulated data on any retail path |
| **Date** | 2026-09-06 |
| **Vertical** | `fuel-convenience` ([`src/ontology/industryOntology.js:82`](../src/ontology/industryOntology.js)) |
| **Buyer** | Direct multi-site operator (Parker's tier), not brand owner |
| **Depends on** | `sites`, `traffic` layers; `/api/tomtom`, `/api/regional-brief` proxies |
| **Excludes** | Visual identity (see [DESIGN-V5.md](DESIGN-V5.md)); non-retail verticals |
| **Rendered** | [Artifact](https://claude.ai/code/artifact/55934322-0c56-4137-8844-9f7af1fc54b3) — same content, in the V5 instrument system |
| **Source** | [`docs/RETAIL-FUEL-INTELLIGENCE.artifact.html`](RETAIL-FUEL-INTELLIGENCE.artifact.html) |

> **The thesis.** Every capability here answers one operator question — *where is money
> leaking, and what do I do about it in the next hour?* The globe is not the product; it is
> the surface where a modelled answer becomes checkable against something the operator can
> see. Which means every number on screen has to declare whether it was **measured**,
> **modelled**, or **synthetic** — a fabricated gallon count that looks like a real one
> destroys the only thing this product sells.

---

## 01 · The flow

The user types a business name. Everything else follows from that one input.

```
"Casey's"  →  site discovery  →  network on globe  →  live overlays  →  ask
   │              │                    │                   │              │
   │         Places + OSM         sites layer         traffic flow    view-grounded
   │         ~40 sites/metro      one dot per site    fuel price      answers over
   │                                                  competitors     what's rendered
   └── no agent required — this is a workflow calling APIs. Voice is a second
       front door to the same functions, never the only one.
```

**The design rule that matters:** every capability is a plain async function with a typed
return, callable from a button, a URL parameter, or a voice tool. Voice sits on top. It is
never load-bearing. If the mic is off, the product still works.

This is already how the existing engines are shaped — `analyzeCompetitivePosition()`,
`fetchTrafficDelays()`, `evaluateCoolOffOpportunities()` are pure functions; `gevActions.js`
just dispatches to them. Keep it that way.

---

## 02 · What already exists

Audited against the working tree on 2026-09-06. This is not aspirational — these run today.

| Capability | Module | Voice tool | State |
|---|---|---|---|
| Business name → sites | [`portfolio/businessSearch.js`](../src/portfolio/businessSearch.js) | `search_business_sites` | **Works.** Places Text Search, Overpass fallback below 5 hits |
| Fuzzy address/business resolve | [`portfolio/fuzzySearchEngine.js`](../src/portfolio/fuzzySearchEngine.js) | `search_address_or_business` | **Works** |
| Activate network on globe | [`portfolio/sitesPanel.js`](../src/portfolio/sitesPanel.js), [`data/sitesLayer.js`](../src/data/sitesLayer.js) | `activate_network` | **Works** |
| CSV portfolio import | [`portfolio/sitesCsv.js`](../src/portfolio/sitesCsv.js), `csvParser.js` | — | **Works** |
| Live congestion colouring | [`data/traffic.js`](../src/data/traffic.js), `flowTiles.js`, `trafficFlowStyle.js` | — | **Works.** TomTom flow tiles via `/api/tomtom`, keyless simulation fallback |
| Delay / bottleneck / closure detection | [`portfolio/trafficDelayEngine.js`](../src/portfolio/trafficDelayEngine.js) | `get_traffic_delays_and_construction` | **Works** |
| Congestion → promo trigger | [`portfolio/coolOffOpportunityEngine.js`](../src/portfolio/coolOffOpportunityEngine.js) | `get_cool_off_opportunities` | **Works** |
| Competitor discovery + density | [`portfolio/competitiveEngine.js`](../src/portfolio/competitiveEngine.js), `competitiveHeatmap.js` | `analyze_competitors`, `toggle_competitive_heatmap` | **Works.** Synthetic fallback removed; empty search now returns `no-competitors-found` |
| Per-site ranking | [`portfolio/gapModel.js`](../src/portfolio/gapModel.js) | — | **Works.** Dollar gap only with operator actuals; otherwise ranks on measured-input demand potential |
| Regional price anchor + forecast | [`fuelPriceModel.js`](../src/portfolio/fuelPriceModel.js), `fuelPriceClient.js` | `get_fuel_price_outlook` | **Works** with a free `EIA_API_KEY`; `no-key` state otherwise |
| Station-level competitor prices | `/api/fuel-prices` proxy | — | **Works, live and keyless** for Spain and France |
| Approach-side geometry | [`approachSide.js`](../src/portfolio/approachSide.js) | (feeds cool-off) | **Works** |
| Play library | [`playLibrary.js`](../src/portfolio/playLibrary.js) | (feeds cool-off) | **Works.** 6 plays, every lift `null` until measured |
| Disruption index | [`disruptionIndex.js`](../src/portfolio/disruptionIndex.js) | (feeds price outlook) | **Works** |
| View / portfolio rollups | [`healthRollup.js`](../src/portfolio/healthRollup.js) | `get_view_health`, `get_portfolio_health` | **Works** |
| Weather impact per site | [`portfolio/siteWeatherImpact.js`](../src/portfolio/siteWeatherImpact.js) | `get_weather` | **Works** |
| News / regional briefing | [`data/regionalBrief.js`](../src/data/regionalBrief.js), `/api/regional-brief` | — | **Works.** Google News RSS primary, GDELT fallback |
| View-scoped Q&A over layers | [`data/analystEngine.js`](../src/data/analystEngine.js) | analyst query path | **Works, retail included.** `sites` and `traffic` are now queryable layers |

Everything above runs on measured or published data. The five gaps in §03 are closed; §10
records how each was built and what was verified against live feeds.

---

## 03 · The five gaps — all now closed

Stated as they were found, because each one names a decision that shaped the build.

1. **The analyst engine cannot see the retail layers.** `ANALYST_LAYERS` covers flights,
   military, AIS vessels, FIRMS fires and earthquakes. It has no entry for `sites` and none
   for traffic. "How is this view doing?" is therefore unanswerable today — the question the
   whole product rests on.
2. **No fuel price data of any kind.** Nothing in `src/` references a price series. The map
   cannot show what competitors charge because it has never fetched a price.
3. **No price forecast.** Consequently no "what will this cost me in two weeks".
4. **No geopolitical → commodity correlation.** AIS vessels and GDELT news both exist in the
   repo, and have never been pointed at each other.
5. **No approach-side logic.** The cool-off engine scores distance to a bottleneck but not
   *which side of the road the site sits on relative to the jammed direction of travel* —
   which is most of whether a detour actually converts.

---

## 04 · Data reality — the honest table

The crux of this whole vertical is fuel price data, and the answer is uncomfortable. It was
checked, not assumed.

| What | Availability | Verdict |
|---|---|---|
| **Regional / metro average retail price, weekly, by grade** | [EIA Open Data API v2](https://www.eia.gov/opendata/) — free key, US Government public domain, decades of history | **Use it.** This is the anchor for everything |
| **Daily crude & wholesale spot** (WTI, Brent, conventional gasoline NY/USGC) | Same EIA API, daily | **Use it.** This is the leading signal |
| **US station-level street prices** | GasBuddy and OPIS are licensed/paid. No free official feed exists. Every "free" option found is a scraper operating against a site's ToS | **Do not ship.** Model it (§06) or take it from the operator |
| **EU / AU station-level street prices** | Genuinely free and official: [Spain](https://geoportalgasolineras.es) (Ministry REST, ~11k stations), [France](https://www.prix-carburants.gouv.fr) (data.gouv.fr open data), [Germany](https://tankerkoenig.de) (MTS-K, free key), Italy (MIMIT Osservaprezzi), Australia (NSW FuelCheck, WA FuelWatch) | **Ship it.** Verify each licence before wiring |
| **Vessel transits (Hormuz, Malacca, Suez)** | AISStream, already proxied in this repo | **Already have it** |
| **Geopolitical event volume / tone** | GDELT, already proxied. Commercial use permitted with citation | **Already have it.** Google News RSS is *noncommercial only* — do not build the commercial path on it |
| **Road congestion + closures** | TomTom flow tiles, already proxied | **Already have it** |
| **"How busy is this store right now"** | Google Popular Times is not in any public API. No free source exists | **Two honest substitutes only** — see below |

### The two things that must never be confused

- **Road busy** — measured. TomTom flow gives real congestion on the segments around a site.
  This is the one the product can state as fact.
- **Store busy** — not measured. Either modelled from road flow × time-of-day curve × site
  format (label it *modelled*), or supplied by the operator's own POS/loyalty feed (label it
  *measured*, and it becomes the single highest-value integration in the product).

A direct operator *has* the POS data. That is precisely why the wedge is direct operators
and not brand owners.

### One defect to fix while here

`searchOverpassSites()` in [`businessSearch.js:102`](../src/portfolio/businessSearch.js)
calls `https://overpass-api.de` **directly from the browser**. Every other third-party fetch
in this codebase goes through a Vite middleware proxy — that is the rule in
[SECURITY.md](../SECURITY.md), and `src/data/overpassProxy.test.mjs` shows a proxy already
exists. Route it through the proxy.

---

## 05 · The view-grounded answer layer

This is the highest-leverage gap and should be built first, because it is what makes every
other capability *askable*.

### 5.1 — Teach the analyst engine about retail

Add two entries to `ANALYST_LAYERS` in [`analystEngine.js:30`](../src/data/analystEngine.js):

```js
sites: {
  numeric: ['gapUsd', 'gapGallons', 'expectedGallons', 'dominanceScore',
            'competitorsWithin1km', 'priceCents', 'priceVsMarketCents',
            'congestionScore', 'coolOffScore'],
  text:    ['name', 'address', 'brand', 'format', 'status'],
  flags:   ['isCompetitor', 'hasLivePrice'],
},
traffic: {
  numeric: ['delayMin', 'frustrationScore', 'trafficLevel', 'speedMph', 'lengthM'],
  text:    ['roadType', 'delayStatus'],
  flags:   ['isClosure', 'isConstruction'],
},
```

The engine's existing machinery — `applyScope` with `kind:'view'`, filters, sort, limit —
then answers *"which of my sites in view have a competitor within 1 km and are priced above
market?"* with no new query logic at all. That is the entire point of the existing design;
it just needs the schema.

### 5.2 — Two rollups the engine cannot express

`analystEngine` returns a filtered record set. Two questions need aggregation instead:

**`getViewHealth()` → "How is this view doing?"**
Scoped to the current camera frustum. Returns: site count in view, total modelled gap USD,
worst-performing site, live congestion score, active closures, price position vs. regional
anchor, weather flags, and the top-ranked play. One object, every field carrying its
`confidence`.

**`getPortfolioHealth()` → "How's my entire business doing?"**
Same shape, scoped to the whole loaded portfolio rather than the frustum, plus a regional
breakdown and a ranked play queue. This is `rankSitesByGap()` and
`totalRecoverableGapUsd()` — which already exist — wrapped with the live overlays.

### 5.3 — The narration contract

The answer the user described —

> *"Great, but right now there's a traffic condition here. Could be worth launching a
> grab-a-fresh-bottle-of-water-with-your-fill-up, because people are already slowing down —
> especially if the station is on the right."*

— is **not** free-form LLM improvisation. It is three deterministic engine outputs composed
into a sentence:

| Clause | Source | Kind |
|---|---|---|
| "there's a traffic condition here" | `trafficDelayEngine` → `bottlenecks[0]` | measured |
| "people are already slowing down" | `delayMin`, `frustrationScore` | measured |
| "station is on the right" | approach-side test (§08.2) | derived |
| "launch a water-with-fill-up promo" | play library lookup keyed on category × trigger | parameterised, not invented |

The model chooses *which* play and phrases it. It never invents the play, the number, or the
claim. This is the read/stage/never-autonomous contract from the Banner OS spec, and it is
what keeps a confident-sounding hallucination from reaching an operator as an instruction.

---

## 06 · The fuel price model

The user's instinct — *think outside the box, don't overcomplicate, use the correlation* —
is correct, and the literature agrees with it. **Do not build ML here.** A transparent
lagged regression on free public data captures most of the explainable variance, runs in
milliseconds in the browser, and — decisively — can show its own coefficients on screen. A
gradient-boosted model that an operator cannot interrogate is worth less than a linear one
they can argue with.

Three layers, each independently inspectable.

### L1 · Anchor — no model at all

Regional weekly retail price for the site's PADD/metro, straight from EIA. This is not a
prediction; it is the ground truth level that everything else is expressed relative to.
Every station price on the map reads as **± cents vs. this anchor**, which is also how
operators actually think about price.

### L2 · Lead — the pass-through regression

Retail pump prices follow crude and wholesale spot with a lag, and — this is the exploitable
part — **asymmetrically**. Increases pass through to the pump faster and more completely
than decreases. The phenomenon is well documented, and it means a naive symmetric model
leaves money on the table.

```
Δpump(t) = α + Σ βₖ⁺ · max(Δspot(t−k), 0) + Σ βₖ⁻ · min(Δspot(t−k), 0) + γ·season(t) + ε
                k=0..6                        k=0..6
```

- Ordinary least squares. Weekly. ~10 years of EIA history for the fit.
- Separate positive and negative coefficients — the asymmetry *is* the signal.
- `season(t)` carries the summer/winter RVP blend switch, which moves the pump on a
  calendar, not on the market.
- Output: a **1–4 week forward band** on the regional anchor, not a point estimate.

### L3 · Risk overlay — the differentiator

This layer does not forecast a price. It **widens the upper band** and raises a flag. Build a
Disruption Index from three inputs the repo can already reach:

| Input | Source | Why it leads |
|---|---|---|
| 7-day tanker transit count through a Hormuz gate polygon vs. trailing 90-day median | AISStream (already proxied) | Physical flow changes before it prints in a weekly price series |
| GDELT event volume + tone on a fixed supply-disruption query set | `/api/regional-brief` path (already proxied) | News moves in hours; retail prices in weeks |
| Realised spot volatility, 14-day | EIA daily | Confirms the other two are real, not noise |

When the index breaks its own trailing threshold, the forecast band widens upward and the
console says *why*, naming the transit count and the event cluster. **The claim being made
is "risk has risen", not "the price will be $X".** That distinction is the difference between
a defensible product and a fortune teller.

### L4 · Station level

```
station price ≈ regional anchor + station premium
station premium = f(brand tier, adjacent road class, competitor count within 1 mi,
                    highway-exit vs. surface-street site, own-price history)
```

In markets with an official station feed (§04) fit this on real data and report the residual.
In the US it is **modelled** and must be labelled so — or replaced wholesale by the
operator's own price book, which is better data than anyone could buy.

### Validation — non-negotiable

Hold out the last 24 months. Report **MAE in cents/gallon against a naive "price stays flat"
baseline**, on screen, next to the forecast. If the model does not beat naive, the product
says it does not beat naive. An operator who catches one unfalsifiable number stops
believing all of them.

---

## 07 · The Hormuz correlation, concretely

The user's example is the right one, and it is the demo that sells the whole platform,
because it is the only view where a *world* map and a *store* map are the same map.

1. Define a gate polygon across the Strait. Count AIS tanker transits per day. This layer
   already renders (`aisLiveVessels.js`); it just needs a counting geofence.
2. Pull GDELT event volume and average tone for a fixed query set over the same window.
3. Overlay both on EIA Brent daily spot, and on the regional pump anchor lagged per §06 L2.
4. Show all four on one time axis, scrubbable, with the correlation coefficient and the
   lead/lag stated plainly.

Then the question *"is my fuel cost about to move?"* has a visible chain of custody from a
tanker on the globe to a cent on a pump sign. Whether the correlation turns out strong or
weak, **show the actual number**. A weak correlation honestly reported is a feature; a
strong one asserted without evidence is the thing that gets the product thrown out.

---

## 08 · Tactical plays

### 8.1 — The play library, not free-form advice

A play is a parameterised record, not a sentence the model wrote:

```js
{ id: 'play:cooloff-cold-drink',
  trigger: { minDelayMin: 8, maxDistanceM: 1200, approachSide: 'near', categories: ['fuel','convenience'] },
  action: 'Geo-push + forecourt signage: cold drink bundled with fill-up',
  expectedLiftPct: { value: null, confidence: 'unmeasured' },
  requiresApproval: true }
```

`expectedLiftPct` starts null. It becomes a real number only after a holdout test. The
existing `coolOffOpportunityEngine` already emits recommendation strings — those should
become play IDs so their outcomes can be measured rather than merely spoken.

### 8.2 — Approach-side test

The missing piece the user named — *"especially if the station is on the right"*.

Given a congested segment's polyline and a site coordinate:

1. Take the segment bearing from consecutive coordinate order.
2. Take the bearing from segment midpoint to the site.
3. The sign of the cross product gives left or right of the direction of travel.
4. A site on the **right of the jammed direction** is a near-side, no-left-turn-across-traffic
   detour. That is a materially different conversion proposition from the far side.

**Honest limitation:** TomTom flow tiles encode each carriageway of a divided road as its own
feature, so coordinate order tracks direction of travel there and the test is reliable. On
undivided roads both directions collapse into one feature and the result is a heuristic.
Label it accordingly — `approachSide: 'near' | 'far' | 'ambiguous'`.

### 8.3 — Competitive pricing view

With station prices present (real in EU/AU, modelled or operator-supplied in the US):

- Colour every station by **cents vs. regional anchor**, diverging scale, so the map reads as
  over/under-market at a glance rather than as absolute dollars.
- Per site: price rank within a 1/3/5 mi ring — the rings `competitiveEngine` already
  computes.
- Recommendation as a **range with a stated basis**, never a single number: *"you are 6¢
  above the three nearest competitors; the pass-through model has wholesale falling ~4¢ over
  two weeks; holding price through that window widens the gap."*

---

## 09 · What must stay honest

**All three are fixed.** Kept here as the record of what was wrong and what replaced it,
because the failure mode matters more than the fix.

1. **`competitiveEngine` fabricates competitors on empty results.** Lines 171–188 synthesise
   `#101`-style stores at fixed lat/lon offsets when the network returns nothing, and the
   result is returned with `success: true` and no marker distinguishing it. A synthetic
   competitor must be flagged `synthetic: true` and rendered visibly differently, or not
   returned at all.
2. **`scoreSiteVsCompetitors` derives traffic volume from a hash of the coordinates.** Line
   65 turns `sin(lat·12.9898 + lon·78.233)` into "14k–42k vehicles/day". It is a plausible
   number with no relationship to reality. Either wire real AADT, or label it `estimated`
   everywhere it surfaces — including in voice narration, which currently reads it aloud as
   fact.
3. **JARVIS-voiced summary strings assert confidence the data does not carry.** Strings like
   `[JARVIS TRAFFIC TELEMETRY] … Commuter annoyance index: 78/100` read as instrument
   readings. When the underlying path is `synthesizeSimulatedDelays()`, the readout must say
   *simulated* — one does, the rest do not.

A fourth was found during the rebuild and is also fixed: **every site dot on the map was
coloured red/amber/green by that same coordinate hash** — the most visible signal in the
product was noise. Dots now colour from a live per-site TomTom flow reading, and a site
with no reading renders neutral grey with no congestion ring. Green means *measured free
flowing*, never *we have not looked*.

The pattern all four now follow: a value that was not measured is `null`, its absence has
a named state, and the voice instructions forbid substituting a plausible number for it.

---

## 10 · Build order — as built

All seven phases landed. Every figure on a retail path is now measured, published,
or explicitly `null`; there is no simulated fallback anywhere in the vertical.

| Phase | Shipped as | State |
|---|---|---|
| **P1 · Make the view askable** | `sites` + `traffic` in `ANALYST_LAYERS`; [`healthRollup.js`](../src/portfolio/healthRollup.js) with `getViewHealth()` / `getPortfolioHealth()`; voice tools `get_view_health`, `get_portfolio_health` | **Done** |
| **P2 · Honesty pass** | Synthetic competitors, hash-derived traffic volume, hash-coloured site dots, simulated delay corridors, the hard-coded 450 veh/hr footfall constant and the `\|\| 5.0` default delay all removed; Overpass routed through `/api/overpass` | **Done** |
| **P3 · Price anchor** | [`eiaProxy`](../vite.config.js) (`/api/eia/series`, `/api/eia/catalog`) with an 8-series allowlist; [`fuelPriceClient.js`](../src/portfolio/fuelPriceClient.js) with PADD resolution | **Done** — needs a free `EIA_API_KEY` |
| **P4 · Approach side + play library** | [`approachSide.js`](../src/portfolio/approachSide.js) (cross-product side test + divided-carriageway detection), [`playLibrary.js`](../src/portfolio/playLibrary.js) (6 plays, all `expectedLiftPct: null`) | **Done** |
| **P5 · Pass-through model** | [`fuelPriceModel.js`](../src/portfolio/fuelPriceModel.js) — asymmetric lagged OLS, `backtest()` reporting MAE vs naive, forward band | **Done** — verified against synthetic ground truth |
| **P6 · Station-level prices** | [`fuelPriceProxy`](../vite.config.js) (`/api/fuel-prices`) — Spain (11,303 stations) and France (server-side bbox filter), both keyless and official; `positionSitesOnPrice()` for ring rank | **Done, live** |
| **P7 · Disruption overlay** | [`disruptionIndex.js`](../src/portfolio/disruptionIndex.js) — four chokepoint gates, tanker counting, weighted departure-from-normal index, `findLeadLag()` correlation | **Done** |

### Verified against live data, not just tests

- **France**, Paris viewport: 73 real stations, server-side bbox filter, ~19 KB.
- **Spain**, Madrid viewport: 182 of 11,303 real stations, with brands.
- **A bug this work caught in itself:** the Spanish feed uses an empty string for a
  grade a station does not stock. `Number('')` is `0` and is finite, so the first
  parser published a €0.000 price for unsold fuel — which would have undercut every
  real competitor in the ring comparison. Now `null`, pinned by a test. Its first fix
  then rejected negative longitudes and silently dropped every station in western
  Spain; the price guard and the coordinate parser are now separate functions.
- **Model validation:** the regression recovers known coefficients from synthetic
  data within tolerance, and correctly reports ~zero asymmetry when the truth is
  symmetric — so it cannot manufacture a pricing play that has no basis.

### What still needs an operator, not an engineer

Two things remain genuinely unavailable from public data, and both are now reported as
their own state rather than filled in:

1. **Dollar gap** needs actual volumes. `scoreSiteGap()` returns
   `confidence: 'requires-actuals'` and a `null` gap until the operator supplies them;
   the queue falls back to a measured-input demand-potential ranking.
2. **Store-level footfall** needs POS or loyalty data. Road congestion is measured;
   store busyness is not, and the two are kept strictly apart.

---

## Open questions

1. **Which market for the pricing demo?** A live Spanish or French station-price map is
   genuinely real today; the equivalent US map is modelled. A US-market demo is the actual
   sales target but the weaker artifact. Possible answer: build EU first to prove the
   mechanic, sell it in the US against the operator's own price book.
2. **Does anyone hand over POS data before signing?** Everything separating "modelled store
   traffic" from "measured store traffic" runs through this. Per the go-to-market note, a
   real site list from a regional operator is still the highest-leverage missing input.
3. **How far does the vertical generalise?** The ontology already carries EV mobility,
   aviation, maritime. The price spine is fuel-specific; the gap engine, play library and
   approach-side logic are not. Worth keeping that seam clean.
