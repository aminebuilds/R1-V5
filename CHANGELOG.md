# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-09-21

### Added

- **Time slider: the last seven days, not just now.** Open it from the clock
  button in the top action bar, from `?time`, or parked at a moment with
  `?at=-36h` (also `-2d`, an ISO time, or epoch ms). Drag the cursor, step an
  hour at a time, or press play:
  - **Fires (NASA FIRMS)** and **earthquakes (USGS, M2.5+)** redraw the 24 h
    ending at the cursor, the same window they show live, so "now" on the
    slider is exactly the live map.
  - Trend lanes above the scrubber show rolling 24 h fire detections and quake
    events in the current view, and GDELT news-coverage share at Hormuz,
    Malacca, Suez and Bab el-Mandeb.
  - Every lane is measured. A stretch no source could fetch is hatched and
    reads NO DATA, never zero. A rate-limited feed reads UNAVAILABLE.
  - Layers with no history (flights, vessels, traffic and the rest) stay live,
    and while the cursor is parked the strip names them. Closing the strip
    returns the map to live.

  Fire history needs `FIRMS_MAP_KEY`. The server backfills nine days on first
  open (about a minute) and keeps them in `.r1-cache/firms-history/`.

- **US airspace brief, live.** Open it from `BRIEFS · US AIRSPACE` on the
  explain board, from `?airspace`, or by asking about the FAA, a ground stop
  or cancelled flights. The board shows:
  - FAA ground stops, delay programs, delays and closures from the public NAS
    Status feed.
  - US aircraft airborne, sampled from OpenSky every ten minutes into a
    persisted timeline.
  - US departures per half hour on the event day against the day before, from
    OpenSky's flight table.
  - A sourced record of the 2026-11-13 nationwide ground stop.
  - Linked live coverage.

  The timeline scrubs: drag across it and every lane, the FAA programs at
  that moment and the reported event in effect read out together. The board
  refreshes in place each minute while open, keeping its scroll position and
  cursor. Every figure is labelled measured or unavailable; a stale traffic
  count is dated, never shown as current. `R1_AIRSPACE_SAMPLE_MIN` sets the
  sampler cadence; `0` turns it off.

- **The store agent — one store's POS, loyalty, campaigns and screens.** The
  console can now answer store-level operating questions and act on them:
  trading performance over a period with a day-by-day series and daypart and
  category movement; a live transaction pulse that reports a dip *with* a
  ranked attribution of what is behind it; the loyalty file cut into
  behavioural segments, one enriched member profile, or the identity bridge
  that collapses an anonymous transaction onto a known member; the campaign
  book showing every loyalty offer running with what it has done beside what
  it was forecast to do; an offer recommendation ranked against live
  conditions; and offer creation and publication to the forecourt canopy,
  dispenser toppers, in-store menu boards, the mobile app, the register
  prompt and the digital receipt.
- **The advertisement is drawn on screen.** Creating an offer composes the
  creative for each requested surface and the board renders it — a real ad,
  laid out per screen rather than one rectangle rescaled, because a canopy
  read at 40 mph and an app card read in the hand are different problems.
- **Creating and publishing are two decisions.** `create_offer` stages and
  draws; `deploy_offer` publishes. A mobile-app deployment sends a push, and
  the board and the narration both say plainly that a sent push cannot be
  recalled.
- Seven new voice tools (`get_store_performance`, `get_store_pulse`,
  `get_member_intelligence`, `get_campaign_performance`, `recommend_offer`,
  `create_offer`, `deploy_offer`), each reachable by typing as well —
  the mic stays optional, as everywhere else.
- Five new explain-board block types: `series` (ordered time bars with the
  prior period as a ghost behind), `roster` (members and segments),
  `campaigns` (measured result and modelled forecast in separate labelled
  columns), `creative` (the advertisement), and `surfaces` (distribution
  state, including which pushes are irreversible).

### Changed

- **The remote `par_intelligence` MCP tool is gone.** The Realtime session
  used to append an `mcp`-type tool pointed at an external POS/loyalty
  server, with a bearer token handed to OpenAI so its infrastructure could
  call that server directly. Store capability is now served in-process by
  [`src/storeAgent/`](src/storeAgent/) through ordinary function tools: the
  results flow through the explain bus and draw a board, the tool schemas are
  covered by the two existing pins, and no third party is given a credential.
  `PAR_INTELLIGENCE_MCP_URL` and `PAR_INTELLIGENCE_MCP_API_KEY` are removed.
- Realtime tool inventory 46 → 53. Both schema pins re-derived; the
  companion 21-tool `unchanged` digest is unmoved, which is the evidence that
  no existing tool definition was touched.

## [Unreleased] — 2026-09-06

### Added

- **The explain board** — answers and recommendations are now composed as a
  visual document instead of a single sentence. Ask a question in the board's
  own ask box, or trigger any of the seven analysis tools by voice, and the
  right-hand board draws the reasoning: the verdict and the kind of claim it
  is, the measured readouts behind it, a stage diagram of how it was reached,
  a chain-of-custody table naming the engine and provenance of every clause,
  ranked rows and per-site tiles that fly the camera when clicked, forecast
  bands, and play cards showing which thresholds fired. Every figure declares
  whether it was **measured**, **derived**, **ranked**, **modelled**,
  **parameterised** or **unmeasured**; a feed that cannot answer produces a
  "cannot tell" block naming what is missing, never a reassuring summary.
  Collapses to an edge tab; expands to a two-column board. New modules under
  [`src/explain/`](src/explain/), styled per [DESIGN-V5](docs/DESIGN-V5.md).
- **Lettered map keys.** The letters beside a board's ranked rows are drawn at
  those subjects' coordinates on the globe, so a claim and the dot it describes
  read as one thing. Keys clear when the board closes.
- Typed questions route through the same action runner voice uses
  (`ensureActionRunner` in `src/voice/r1Actions.js`), so the console still
  answers with the mic off. A question that maps onto no capability is declined
  with the list of answerable ones rather than guessed at.
- **Chokepoint traffic now reads as fuel-price risk.** Flying to a chokepoint
  gate (`inspect_chokepoint`) previously returned a bare tanker count with no
  board and no non-voice front door. It now shares the fuel outlook's
  disruption-index assessment and gets its own board — measured tanker/vessel
  counts plus a stage diagram showing whether that traffic fed the index and
  what the index reads, `pending` rather than invented wherever an input is
  missing — and can be reached by typing a question naming a strait or
  chokepoint, not only by voice.

### Changed

- **The project is now R.1 — Commercial Intelligence, a standalone product.**
  Documentation, package metadata, and the internal namespace describe R.1 on
  its own terms rather than as a fork. Attribution for the globe substrate R.1
  grew out of is retained in [README.md](README.md) and [LICENSE](LICENSE).
- Internal namespace renamed throughout: the debug/QA surface is `window.__r1`,
  env vars are `R1_*`, browser storage keys are `r1.*`, CSS classes this app
  owns are `r1-` prefixed, runtime dirs are `.r1-cache` / `.r1-logs`, and the
  voice modules are `src/voice/r1Actions.js` and `src/voice/r1Realtime.js`.
  **Stored panel positions and CCTV calibration reset once** on first run after
  this change, because their storage keys moved.
- `Banner OS`, the earlier working name for this product, is now `R.1`
  everywhere.
- The voice tool-schema pins in `src/firstRunExperience.test.mjs` and
  `src/radioMarkup.test.mjs` were re-derived: tool descriptions changed with the
  rename. No tool was added, removed, or given different parameters.

### Removed

- Removed the bundled promotional GIFs and PNGs (~68 MB) that documented the
  upstream project rather than R.1, along with their provenance file.
  `docs/media/README.md` now describes what belongs there instead.

## [Unreleased] — 2026-08-24

### Added

- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.

### Fixed

- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
