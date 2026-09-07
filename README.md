<div align="center">

# R.1

### Commercial Intelligence

**A decision console for people who operate physical sites.**
Type a business name, watch its network land on a photorealistic 3D globe, and ask the world what it is doing to your revenue.

*Every number declares whether it was measured, modelled, or unavailable.*

</div>

---

<div align="center">

**[Quick Start](#-quick-start) · [The Flow](#-the-flow) · [Lenses](#-industry-lenses) · [Fuel & Convenience](#-fuel--convenience--the-built-vertical) · [Layers](#%EF%B8%8F-whats-on-the-globe) · [Voice](#-ask-it) · [Keys](#-keys--costs) · [Docs](#-documentation)**

</div>

---

## 🎯 What This Is

R.1 is an operator's console, not a map toy.

The premise: an operator of physical sites — fuel and convenience stores first — has exactly one question that matters on any given morning. *Where is money leaking, and what do I do about it in the next hour?* Answering that needs live context about the world immediately around each site: congestion, closures, weather, competitors, prices, regional news. All of that exists as public signal. None of it is assembled anywhere an operator can act on.

R.1 assembles it. The globe is not the product — it is the surface where a modelled answer becomes **checkable** against something you can see with your own eyes.

> ### The rule that shapes everything
>
> Every figure on screen carries its epistemic status. **Measured** means a real feed said so. **Modelled** means R.1 inferred it and will tell you from what. **Unavailable** means no honest source exists and the field stays empty.
>
> There is no fourth category. A fabricated gallon count that looks like a real one destroys the only thing this product sells, so synthetic fallbacks were removed from every commercial path rather than dressed up. An empty competitor search returns `no-competitors-found`; it does not invent competitors. The gap model reports a dollar figure only when given operator actuals — otherwise it ranks on measured demand potential and says so.

---

## ⚡ Quick Start

Requires **Node.js 24.14.x or 26.x** (enforced by `package.json` `engines`).

1. Copy `.env.example` → `.env` and set `GOOGLE_MAPS_API_KEY`.
2. Install and run:

```bash
npm install
npm run dev
```

3. Open **`http://localhost:4173`**.

That one key is the entry fee — it buys the photorealistic planet. Every other layer degrades gracefully without its key: traffic falls back to a clearly labeled simulation, fire detection reports `KEY REQUIRED`, voice control stays off, fuel pricing reports `no-key`. Nothing silently invents data to fill a gap.

The dev server binds to **localhost**, so your keys stay on your machine. Read [Running it somewhere else](#-running-it-somewhere-else) before exposing it.

---

## 🔄 The Flow

The user types a business name. Everything else follows from that one input.

```
"Casey's"  →  site discovery  →  network on globe  →  live overlays  →  ask
   │              │                    │                   │             │
   │         Places + OSM         sites layer         traffic flow   view-grounded
   │         ~40 sites/metro      one dot per site    fuel price     answers over
   │                              live health         competitors    what's rendered
   └── no agent required — this is a workflow calling APIs
```

**The design rule that matters:** every capability is a plain async function with a typed return, callable from a button, a URL parameter, or a voice tool. Voice sits on top of that surface. It is never load-bearing. **If the mic is off, the product still works.**

You can also skip discovery entirely and import your own portfolio as CSV.

<!-- CAPTURE: business name typed → sites landing on the globe → a site card opening -->

---

## 🔭 Industry Lenses

A lens re-weights which layers, entities, and questions matter. Fuel & convenience is built out; the others select the relevant globe layers and ontology today, and deepen as each vertical gets specified.

| | Lens | | Lens |
|---|---|---|---|
| ⛽ | **Fuel & Convenience** *(built)* | 🏭 | Energy & Utilities |
| 🚙 | Automotive & EV Mobility | 👕 | Apparel & Fashion |
| ✈️ | Airlines & Aviation | 🌾 | Agriculture & Commodities |
| 🚢 | Maritime & Shipping | 🏦 | Banking & Financial Services |
| 🖥️ | Datacenters & Cloud | 🏗️ | Construction & Heavy |
| 🚀 | Space & Aerospace | 🩺 | Clinical Trials & Healthcare |

Ontology lives in [`src/ontology/industryOntology.js`](src/ontology/industryOntology.js).

---

## ⛽ Fuel & Convenience — the built vertical

The first vertical taken all the way down. It targets the **direct multi-site operator** — the buyer who owns the stores and the POS, and can act on a pricing or staffing decision this afternoon.

| Capability | What it does | Status |
|---|---|---|
| **Site discovery** | Business name → site network. Places Text Search, Overpass fallback | Works |
| **Portfolio import** | CSV of your own sites, parsed and placed | Works |
| **Live congestion** | TomTom flow tiles colored per road segment around each site | Works (keyless = labeled simulation) |
| **Delay & closure detection** | Bottlenecks and construction on a site's approaches | Works |
| **Cool-off opportunities** | Congestion → promo trigger, weighted by which side of the road the site sits on relative to the jammed direction of travel | Works |
| **Competitor discovery** | Nearby competing sites plus a density heatmap | Works — no synthetic fallback |
| **Per-site ranking** | Ranks sites by opportunity; dollarized *only* against operator actuals | Works |
| **Fuel price outlook** | EIA regional anchor + asymmetric lagged pass-through + disruption overlay. Explicitly no ML | Works with a free EIA key |
| **Competitor street prices** | Station-level, live and keyless | Spain and France — see below |
| **Weather impact** | Per-site weather and its demand effect | Works |
| **Regional briefing** | News around a site's region | Works |
| **Health rollups** | View-level and portfolio-level summaries | Works |
| **View-scoped Q&A** | Ask questions against exactly what is rendered | Works |

### The uncomfortable part, stated plainly

**US station-level street prices are not freely available.** GasBuddy and OPIS are licensed products, and every "free" alternative found was a scraper operating against a site's terms of service. R.1 therefore does not ship US street prices. It models the regional anchor from EIA public-domain data, or takes actuals from the operator.

Spain, France, Germany, Italy, and Australia publish genuinely free official station-level feeds, and those are the ones wired up.

Likewise, **"how busy is this store"** is not measured anywhere public. R.1 keeps two things rigidly separate:

- **Road busy** — *measured*. TomTom flow on the segments around the site. Stated as fact.
- **Store busy** — *modelled* from road flow × time-of-day × site format, and labeled as such — unless the operator connects POS or loyalty data, at which point it becomes measured.

Full capability specification: **[docs/RETAIL-FUEL-INTELLIGENCE.md](docs/RETAIL-FUEL-INTELLIGENCE.md)**.

---

## 🛰️ What's on the Globe

The live-world substrate every lens draws on. Thirteen layers; **ten need no key at all.**

| Layer | What you get | Source | Auth |
|-------|--------------|--------|------|
| 🗺️ **Map Stack** | Google Photorealistic 3D, Bing aerial, OSM | Google / ion / OSM | 🔴 Google (required) · 🟡 ion for Bing · 🟢 OSM |
| 🏪 **Sites** | Your portfolio or a discovered network, one dot per site | Places / OSM / CSV | 🟡 |
| 🚗 **Traffic** | Live congestion driving per-vehicle flow below ~8 km | TomTom + OSM | 🟢 (🟡 TomTom makes it real) |
| ✈️ **Live Flights** | Thousands of live aircraft with route history | OpenSky + adsb.lol | 🟢 (🟡 optional, more credits) |
| 🎖️ **Military Flights** | ADS-B military traffic in amber | adsb.lol | 🟢 |
| 🚢 **Live Vessels** | Global ship traffic — also feeds the disruption index | AISStream | 🟡 |
| 🛰️ **Satellites** | ~840-object core catalog; **DENSE** adds the Starlink shell | CelesTrak | 🟢 |
| 🌍 **Earthquakes** | Global seismic activity, last 24 h | USGS | 🟢 |
| 📹 **CCTV Mesh** | ~800 public cameras projected *into* the 3D scene, with calibratable pose | City APIs | 🟢 |
| 📻 **Radio** | Geolocated stations with an analog tuner | Radio Browser | 🟢 |
| 🚲 **Bikeshare** | Live station availability | GBFS | 🟢 |
| 🔥 **Active Fires** | NASA FIRMS detections, trailing 24 h | NASA FIRMS | 🟡 |
| 🚀 **Space Missions** | Rolling 30-day launches | Launch Library 2 | 🟢 (🟡 raises allowance) |

**Bundled static infrastructure:** datacenters (4,351), dams (704), submarine cables (712). **Also available:** GLSL sensor styles, a screen-space detection overlay, cockpit view, a scene director, and share links that serialize camera, style, layers, and one tracked target into a URL.

Layers that model rather than measure say so on their own face — keyless traffic is labeled a simulation, camera poses are estimated priors until you calibrate them, and launch ascent playback is marked `RECONSTRUCTED ESTIMATE`.

---

## 🎙️ Ask It

Voice needs an **OpenAI key**. Without one everything else runs; the mic button reports that voice is unavailable.

**Forty tools**, and the twelve commercial ones are the same functions the buttons call:

> ⛽ *"Find every Casey's near Des Moines and put them on the map."*
> 📉 *"Which of my sites is bleeding the most right now?"*
> 🚧 *"What's blocking the approaches to site 14?"*
> 💵 *"What happens to my fuel margin over the next two weeks?"*
> 🏁 *"Who am I competing with within three miles of here?"*
> 🌦️ *"How is the weather going to hit this site tomorrow?"*

…plus the full globe console — camera moves, layer control, annotation, cockpit, and analyst queries against the live layers.

**How it stays honest:** the agent pulls live scene context before answering, so it reasons about what is actually rendered. At street level it reads a viewport screenshot to identify legible signage, and is instructed never to invent labels. It confirms only actions that actually succeeded. Your `OPENAI_API_KEY` never reaches the browser — the client receives a short-lived session token, and each session carries a **$5 in-app cap** with a warning at $2.

<!-- CAPTURE: a spoken portfolio question and the answer resolving on the globe -->

---

## 🔧 Under the Hood

- **No framework.** Vanilla ES modules, **CesiumJS**, and **Vite**. Fast to read, fast to change.
- **`vite.config.js` is also the server.** Every route needing a private key is Vite middleware registered under *both* `configureServer` and `configurePreviewServer` — key brokering is not dev-only.
- **Capabilities are plain functions.** `analyzeCompetitivePosition()`, `fetchTrafficDelays()`, and `evaluateCoolOffOpportunities()` are pure async functions with typed returns. The voice layer dispatches to them; it does not own them.
- **World-stable icons.** Aircraft and vessels point along their true real-world heading at every camera angle, via per-frame screen-space course projection.
- **Smooth motion from choppy data.** Feeds arrive every 15–30 s; the globe renders one interval behind and interpolates between known fixes, with dead reckoning across gaps.
- **Sits on the real ground.** Entity heights run through a geoid-aware vertical datum sampled against the *rendered* terrain mesh, so things rest on surfaces instead of floating.
- **Spends your quota like it's its own.** Paid feeds sit behind cached, budget-governed proxies — an OpenSky credit governor, a TomTom daily tile budget, disk-cached TLEs.

```
src/
├── main.js          # Bootstrap: Google 3D tiles, layer registration
├── ui.js            # Runtime UI — panels, HUD, control facade
├── hud.js           # Intelligence HUD + AI scene summary
├── portfolio/       # Sites, competitors, gap model, fuel price, plays
├── ontology/        # Industry lenses + intent engine
├── voice/           # OpenAI Realtime session + 40 voice tools
├── data/            # One module per layer + manager + context store
│   └── local_data/  # Bundled datasets (per-folder provenance)
├── styles/          # GLSL post-process visual styles
└── scenes/          # Cinematic scene director
```

Tests are colocated `*.test.mjs` files run by `scripts/run-unit-tests.mjs` — no external test framework.

```bash
npm run build      # must pass
npm test           # must pass
npm run test:track # must pass (needs the dev server up)
```

---

## 🔑 Keys & Costs

**Legend:** 🟢 no signup · 🟡 free key · 🔴 metered.

| | Key | Buys you | Get it |
|---|-----|-----|--------|
| 🔴 | **Google Maps** *(required)* | The photorealistic 3D planet | [Google Cloud Console](https://console.cloud.google.com/) — [pricing](https://developers.google.com/maps/billing-and-pricing/pricing); URL-restrict it |
| 🔴 | **OpenAI** | Voice control + the AI HUD summary | [platform.openai.com](https://platform.openai.com) — [pricing](https://openai.com/api/pricing/) |
| 🟡 | **TomTom** | Real congestion instead of a labeled simulation | [developer.tomtom.com](https://developer.tomtom.com) |
| 🟡 | **EIA** | The fuel price anchor and forecast | [eia.gov/opendata](https://www.eia.gov/opendata/) — free, US public domain |
| 🟡 | **AISStream** | Global vessels, and the disruption index | [aisstream.io](https://aisstream.io) — free |
| 🟡 | **NASA FIRMS** | Live active fires | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) — free |
| 🟡 | **Cesium ion** | Bing imagery map stacks | [cesium.com/ion](https://cesium.com/ion) |
| 🟡 | **OpenSky** | More flight-polling credits (🟢 anonymous works) | [opensky-network.org](https://opensky-network.org) |
| 🟡 | **Launch Library 2** | Higher space-missions allowance (🟢 works without) | [thespacedevs.com](https://thespacedevs.com) |

**What it actually costs.** Most layers are $0 with no signup. Google 3D tiles bill per *root tileset request* — one buys up to three hours of unlimited tile rendering, the first 1,000 per month are free, then roughly $6 per 1,000 (US pricing; rates vary by billing region). A single user rarely leaves the free tier. OpenAI Realtime is metered by model, conversation length, and audio volume; the app shows a live session estimate and caps the session at $5.

Provider prices and allowances change. Check the linked pages before relying on any of this, restrict every key at the provider, and set budget alerts — **the app's throttles are guards, not billing caps.**

---

## 🌐 Running It Somewhere Else

**This is not a static site.** `npm run build` produces a client bundle, but the key-brokering middleware only runs inside Vite's own server. That means:

- **A static host cannot serve this.** On GitHub Pages or a plain CDN, every proxied layer breaks — vessels, fires, voice, traffic, fuel prices, OpenSky — and only the two client-side keys (Google Maps, Cesium ion) would work at all.
- **You need a Node-capable host** running `vite preview`, or a small custom server reusing the same middleware, with the keys as server env vars — Fly.io, Render, a VPS, a container. Serverless tiers could work, but the middleware would need porting to that runtime's handler shape.
- **Before exposing it beyond localhost**, read the network-exposure section of [SECURITY.md](SECURITY.md). A LAN-visible server brokers your configured API keys to anyone who can reach it. Set the per-IP throttles (`R1_RATELIMIT_OPENAI_PER_MIN`, `R1_RATELIMIT_GOOGLE_PER_MIN`) *and* provider-side budget caps first.

---

## 📚 Documentation

| Doc | What it's for |
|---|---|
| [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) | The authoritative runtime reference. Read it first for any behavior question |
| [docs/RETAIL-FUEL-INTELLIGENCE.md](docs/RETAIL-FUEL-INTELLIGENCE.md) | The fuel & convenience capability spec — price model, data reality, build order |
| [docs/DESIGN-V5.md](docs/DESIGN-V5.md) | Visual identity spec. Binding for any change to HUD chrome |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Architecture in a minute, coding style, PR checklist |
| [SECURITY.md](SECURITY.md) | The secrets and threat model — why each proxy endpoint exists |
| [DATA_SOURCES.md](DATA_SOURCES.md) | License and attribution per data feed |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | Check before "fixing" a known quirk |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Frame budget and measured cold-start numbers |
| [TESTING.md](TESTING.md) | Manual test protocol for voice and live tracking |

---

## 📋 Responsible Use

R.1 runs on **public data, named sources, and local-first execution.** No private datasets, no mystery scraping. Anything involving a private key is brokered server-side, and third-party fetches go through fixed or allowlisted proxy destinations rather than arbitrary URLs.

**The line.** R.1 models **sites, events, assets, infrastructure, and systems** — stores, road networks, vessels, aircraft, weather, prices. It does not build features for named-person search, face recognition, or tracking individuals, and pull requests that cross that line will not be merged. People are not a query type here.

**Status.** An actively developed console, not a hardened production service. Released under the **[MIT License](LICENSE)** — which covers the *source code only*. Bundled and live datasets keep their own terms; see **[DATA_SOURCES.md](DATA_SOURCES.md)**, and note that the bundled submarine-cable dataset is NonCommercial.

> [!IMPORTANT]
> R.1 visualizes public and third-party data, and models what it cannot measure.
> Data may be delayed, incomplete, modelled, inferred, or wrong. Do not use it for
> flight or maritime navigation, emergency response, medical decisions, investment
> decisions, or other safety-critical purposes. Commercial figures are decision
> support, not accounting. Verify anything that matters against authoritative sources.

---

## 🙏 Credits

R.1's globe substrate began as a fork of **[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)**, created and open-sourced under the MIT License by **[Bilawal Sidhu](https://github.com/bilawalsidhu)**. The photorealistic-globe rendering, the live aircraft, vessel and satellite layers, the CCTV projection mesh, and the original Realtime voice architecture all descend from that work, and R.1 would not exist without it. Thank you.

R.1 has since diverged into a different product for a different buyer — an operator's decision console rather than a world-exploration client — but the debt is real, and the license is retained in full. See [LICENSE](LICENSE).

The 3D models under `public/models/` and every bundled dataset carry their own authors and licenses, recorded in [`public/models/README.md`](public/models/README.md) and [DATA_SOURCES.md](DATA_SOURCES.md).

---

<div align="center">

**R.1 — Commercial Intelligence**

</div>
