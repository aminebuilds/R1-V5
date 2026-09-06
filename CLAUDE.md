# God's Eye View — project context

Amine's working fork of Bilawal Sidhu's open-source **God's Eye View**
(`bilawalsidhu/gods-eye-view`) — a photorealistic 3D globe with live
aircraft/ships/satellites/earthquakes/traffic/CCTV layers and OpenAI
Realtime voice control. This checkout tracks `origin` =
`aminebuilds/gods-eye-view-world` (Amine's own GitHub, not upstream) — pushes
here go to Amine's repo, not Bilawal's.

## Before touching anything

Read these in order — they are the actual spec, this file is just the map:

1. [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) — authoritative runtime
   reference, huge, read it first for any behavior question.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — architecture-in-a-minute, coding
   style, PR checklist.
3. [SECURITY.md](SECURITY.md) — the secrets/threat model. Every proxy
   endpoint in `vite.config.js` exists because of a rule in here (SSRF
   guards, no-arbitrary-URL fetching, localhost-only default).
4. [DATA_SOURCES.md](DATA_SOURCES.md) — license/attribution per data feed.
   Don't add a source without an entry here.
5. [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — check before "fixing" a
   known quirk.
6. [docs/DESIGN-V5.md](docs/DESIGN-V5.md) — the visual identity spec. Binding
   for any change to HUD chrome: tokens, type, geometry, motion, and a list
   of prohibited treatments. Not yet built — the current `style.css` still
   predates it, so read §12 for which phase has landed.

## Running it

```bash
npm install
npm run dev            # http://localhost:4173
```

Copy `.env.example` to `.env` and fill in what you have — it is gitignored,
never commit it. Only `GOOGLE_MAPS_API_KEY` is required; every other layer
degrades gracefully when its key is absent (traffic falls back to its keyless
simulation, FIRMS reports "KEY REQUIRED", voice control stays off). Google
Maps and Cesium ion are client-exposed by design — restrict them at the
provider rather than trying to hide them; see [SECURITY.md](SECURITY.md).

Also registered as a Claude Code launch config named `gods-eye-view`
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
  `src/voice/` — Realtime voice tool declarations + client execution.
  `src/styles/` — GLSL post-process visual styles.
- `vite.config.js` is large (~7k lines) and doubles as the app's **server**:
  every route needing a private key (OpenAI, AISStream, OpenSky, FIRMS,
  TomTom, CCTV frame fetch, radio) is Vite middleware here, registered under
  both `configureServer` (dev) *and* `configurePreviewServer` (prod preview)
  — the key-brokering logic runs in both modes, it isn't dev-only.
- Tests are colocated `*.test.mjs` files next to their source, run via
  `scripts/run-unit-tests.mjs` (no external test framework dependency).

## Hosting later — what actually changes

This is **not a static site**: `npm run build` produces a client bundle, but
the API-key-brokering middleware only runs inside Vite's own server
(`vite preview` or `vite dev`), registered via `configurePreviewServer`. That
means:

- A static host (GitHub Pages, plain S3/CDN) **cannot** serve this as-is —
  every proxied layer (ships, fires, voice, traffic, OpenSky) would break,
  and the two client-side keys (Google Maps, Cesium ion) would need to be
  the only ones present, unrestricted layers only.
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

## Provenance note for future sessions

All history through `314a0e1` is upstream Bilawal Sidhu commits, verified
clean (no injected code, no obfuscation, no exfil-style network calls) before
this fork became Amine's working copy on 2026-08-29. Treat any *new* commit
authored by someone else as something to actually review, not assume-clean
like the base.
