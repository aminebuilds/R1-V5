# R.1 — project context

**R.1 — Commercial Intelligence.** A decision console for multi-site operators:
type a business name, get that site network on a photorealistic 3D globe, and
ask view-grounded questions about what the world is doing to its revenue. The
fuel-and-convenience vertical is the one built out; other industry lenses select
layers and ontology today and deepen as each is specified.

`origin` is `aminebuilds/R1-V5`.

## The rule that governs every change

Every figure on screen declares whether it is **measured**, **modelled**, or
**unavailable**. There is no fourth category, and synthetic stand-ins are not
acceptable on any commercial path — an invented number that looks real destroys
the only thing this product sells. If a source doesn't exist, the field stays
empty and says why (`no-key`, `no-competitors-found`, `KEY REQUIRED`). When you
add a capability, decide which of the three it is before you write it.

## Before touching anything

Read these in order — they are the actual spec, this file is just the map:

1. [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) — authoritative runtime
   reference, huge, read it first for any behavior question.
2. [docs/RETAIL-FUEL-INTELLIGENCE.md](docs/RETAIL-FUEL-INTELLIGENCE.md) — the
   fuel-and-convenience capability spec: the price model, the honest data-reality
   table, and the build order. Binding for anything in `src/portfolio/`.
3. [CONTRIBUTING.md](CONTRIBUTING.md) — architecture-in-a-minute, coding
   style, PR checklist.
4. [SECURITY.md](SECURITY.md) — the secrets/threat model. Every proxy
   endpoint in `vite.config.js` exists because of a rule in here (SSRF
   guards, no-arbitrary-URL fetching, localhost-only default).
5. [DATA_SOURCES.md](DATA_SOURCES.md) — license/attribution per data feed.
   Don't add a source without an entry here.
6. [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — check before "fixing" a
   known quirk.
7. [docs/DESIGN-V5.md](docs/DESIGN-V5.md) — the visual identity spec. Binding
   for any change to HUD chrome: tokens, type, geometry, motion, and a list
   of prohibited treatments. Read §12 for which phase has landed — the current
   `style.css` still predates parts of it.

## Running it

```bash
npm install
npm run dev            # http://localhost:4173
```

Copy `.env.example` to `.env` and fill in what you have — it is gitignored,
never commit it. Only `GOOGLE_MAPS_API_KEY` is required; every other layer
degrades gracefully when its key is absent (traffic falls back to its keyless
simulation, FIRMS reports "KEY REQUIRED", voice control stays off, fuel pricing
reports `no-key`). Google Maps and Cesium ion are client-exposed by design —
restrict them at the provider rather than trying to hide them; see
[SECURITY.md](SECURITY.md).

Also registered as a Claude Code launch config named `r1`
(`.claude/launch.json`) — `preview_start` can boot it directly without a
manual `cd`.

Before any PR: `npm run build`, `npm test`, `npm run test:track` (dev server
must be up for the last one) — all three must stay green, per CONTRIBUTING.md.

## Structure, in brief

- **No framework.** Vanilla ES modules + CesiumJS + Vite. Works from any
  editor/IDE — nothing here assumes VS Code or a specific extension; there's
  no `.vscode/` and no editor-specific config committed.
- `src/ui.js` — HUD/panels/control facade. `src/data/<layer>.js` — one
  self-contained data layer per file (`init/enable/disable/update/destroy`).
  `src/portfolio/` — the commercial engines (sites, competitors, gap model,
  fuel price, plays), each a pure async function with a typed return.
  `src/ontology/` — industry lenses and the intent engine.
  `src/voice/` — Realtime voice tool declarations + client execution.
  `src/styles/` — GLSL post-process visual styles.
- **Voice is never load-bearing.** Every capability must be reachable from a
  button or a URL parameter first; the voice tool is a second front door to the
  same function. If the mic is off, the product still works.
- `vite.config.js` is large (~7k lines) and doubles as the app's **server**:
  every route needing a private key (OpenAI, AISStream, OpenSky, FIRMS,
  TomTom, EIA/fuel prices, CCTV frame fetch, radio, regional brief) is Vite
  middleware here, registered under both `configureServer` (dev) *and*
  `configurePreviewServer` (prod preview) — the key-brokering logic runs in
  both modes, it isn't dev-only.
- Tests are colocated `*.test.mjs` files next to their source, run via
  `scripts/run-unit-tests.mjs` (no external test framework dependency).
- Internal namespace is `r1` throughout: `window.__r1` is the debug/QA surface the
  scripts in `scripts/` drive, `R1_*` are the env vars, `.r1-cache` and
  `.r1-logs` are the gitignored runtime dirs, and `r1-` prefixes the CSS classes
  this app owns.

### Two tests pin the voice tool schema

`src/firstRunExperience.test.mjs` and `src/radioMarkup.test.mjs` assert a byte
length and a sha256 over the `R1_REALTIME_TOOLS` block. They exist to catch
*accidental* schema drift, because a silent edit to a shipped tool changes model
behavior in production with nothing in review to catch it. If you change a tool
on purpose, re-derive both pins in the same commit and say which tools moved —
the session cache busts on any schema change.

## Hosting later — what actually changes

This is **not a static site**: `npm run build` produces a client bundle, but
the API-key-brokering middleware only runs inside Vite's own server
(`vite preview` or `vite dev`), registered via `configurePreviewServer`. That
means:

- A static host (GitHub Pages, plain S3/CDN) **cannot** serve this as-is —
  every proxied layer (vessels, fires, voice, traffic, fuel prices, OpenSky)
  would break, and the two client-side keys (Google Maps, Cesium ion) would need
  to be the only ones present, unrestricted layers only.
- A real deployment needs a **Node-capable host** running `vite preview`
  (or a small custom Node server reusing the same middleware) with the six+
  keys as server env vars — think Fly.io, Render, a VPS, or a container, not
  Vercel/Netlify's static tier (their serverless functions could work but
  would need the middleware ported to that runtime's handler shape).
- Before exposing this beyond `localhost`: read the "Network exposure" section
  of [SECURITY.md](SECURITY.md) — the per-IP rate limits are opt-in and are
  *not* billing caps; set real provider-side budget alerts (Google Cloud,
  OpenAI usage limits) first.
- Node engine pin is `>=24.14.0 <25 || >=26 <27` (`package.json` `engines`).
  Older runtimes mostly work with an `EBADENGINE` warning, but a few tests
  use APIs added after Node 22.14 (e.g. `registerHooks` from `node:module`)
  and fail below the pin — match it locally and on whatever host you deploy
  to.

## Provenance

R.1's globe substrate began as a fork of Bilawal Sidhu's MIT-licensed
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view); the rendering
core, the live aircraft/vessel/satellite layers, the CCTV mesh, and the original
Realtime voice architecture descend from that work. Credit and the retained MIT
notice live in [README.md](README.md) and [LICENSE](LICENSE).

Operationally relevant for future sessions: all history through `314a0e1` is
that upstream base, reviewed clean (no injected code, no obfuscation, no
exfil-style network calls) on 2026-08-29. Treat any *new* commit authored by
someone else as something to actually review, not assume-clean like the base.
