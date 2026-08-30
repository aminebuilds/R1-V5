# God's Eye View — Design Spec R.1

**Visual identity & interface specification**

| | |
|---|---|
| **Status** | Draft · unbuilt |
| **Date** | 2026-08-29 |
| **Scope** | All HUD chrome |
| **Excludes** | GLSL post-process styles (`src/styles/`), the globe itself |
| **Supersedes** | The `:root` block in `style.css` |
| **Surface** | 9,433 lines of CSS, 948 lines of `index.html` |
| **Rendered** | [Artifact](https://claude.ai/code/artifact/0ed6c054-0964-4e9e-8be6-9ff5fcebf1fb) — same content, rendered in the system it specifies |
| **Source** | [`docs/DESIGN-R1.artifact.html`](DESIGN-R1.artifact.html) — the HTML that produced the artifact |

> **The thesis.** The earth is the only light source.
>
> Everything the chrome does today — the blur, the glow, the sixteen-pixel corners, the cyan
> halo on every active control — competes with a photoreal globe for the same attention. R.1
> turns the interface into an instrument: opaque plates, hairline edges, achromatic steel, and
> colour held in reserve so that when something goes green, amber or red it means something.
> Apple's restraint and optical discipline; Palantir's density and mission-console grammar.
> No decoration survives that isn't carrying data.

---

## 01 · The read

Five things the reference consoles agree on. None of them is a style; all of them are
structural decisions that happen to produce the look.

**A. Chrome is opaque, the scene is not.**
Panels sit on flat plates that fully occlude what's behind them. Nothing is translucent.
Legibility never depends on what the map happens to be showing.

**B. Separation by edge, not by shadow.**
One-pixel hairlines and shared gutters do all the work a drop shadow was doing. Depth is read
from value steps between plates, not from blur.

**C. The frame is fixed.**
A top strip, a left rail, a right context column, a bottom transport. Elements have addresses.
Nothing floats, nothing is dragged, nothing overlaps by accident.

**D. Density is the point.**
Many small labelled cells beat few large ones. Whitespace is structural — gutters and
alignment — never padding sprayed on to make a card feel calm.

**E. Colour is a claim.**
Chrome is grey. When a hue appears it asserts something: this is live, this is stale, this is
on fire. A hue used because it looks good has spent the budget.

### What the current build does instead

Measured against `style.css` as it stands today.

| Signal | Now | R.1 ceiling | Why it matters |
|---|---|---|---|
| Distinct `border-radius` values | **20** | 3 | Corner radius is currently noise, not a system |
| `backdrop-filter` declarations | **58** | 4 | Every blurred panel is a GPU cost and a legibility gamble |
| `box-shadow` declarations | **112** | 8 | Shadow is standing in for a value scale that doesn't exist |
| `text-shadow` declarations | **29** | 0 | Glowing text is the single loudest slop tell |
| Chromatic hues in chrome | 1, decorative | 1, semantic | `#00d4ff` marks active, hover, focus, label and mood alike |
| Font families loaded | 4 | 3 | Inter + JetBrains Mono + two icon sets, one of them legacy |

The diagnosis is not "it looks dated." It is that the chrome has no value scale, so it borrows
contrast from blur and glow — and blur and glow are exactly what make an interface read as
generated rather than engineered.

---

## 02 · Six laws

Binding. A change that violates one of these is wrong even if it looks better in isolation.

1. **The map is the only light source.** Chrome never emits. No glow, no bloom, no luminous
   borders. If a control needs to be found, raise its value or give it an edge — do not make it
   shine.
2. **Chrome is achromatic.** Panels, rails, labels, borders and inactive states are pure steel.
   Saturation is reserved for the semantic set and for the data layers themselves.
3. **Edges, not shadows.** A 1px hairline plus a one-step value change is the only permitted
   separation. Shadow is allowed on exactly one thing: a true overlay that floats above the frame.
4. **Type carries the hierarchy.** Size, weight, case and letter-spacing establish rank before
   colour is consulted. If a label needs colour to read as secondary, the type scale is wrong.
5. **Every number is monospaced and tabular.** Altitude, bearing, count, timestamp, percentage.
   Digits that jitter as they update destroy the instrument illusion faster than any styling error.
6. **Motion reports state; it never performs.** Animation is permitted to show that something
   changed, arrived, or is waiting. It is not permitted to make an arrival feel impressive.
   No idle shimmer, ever.

---

## 03 · Palette

Twelve values. The neutrals are cooled toward green-blue so they sit under the signal hue as a
family rather than reading as generic charcoal.

### Ground & structure

| Token | Hex | Use |
|---|---|---|
| `ground` | `#06080A` | App backdrop |
| `plate` | `#0D1216` | Panel surface |
| `plate-hi` | `#121A20` | Hover / raised |
| `plate-top` | `#18222A` | Selected row |
| `plate-sunk` | `#04070A` | Code, wells, inset areas |
| `line` | `#1C242B` | Internal rule |
| `line-strong` | `#2E3941` | Panel border |
| `line-live` | `#3A4750` | Border, hover / active panel |

### Ink

| Token | Hex | Use |
|---|---|---|
| `ink` | `#E4EAEE` | Values, titles |
| `ink-2` | `#8B98A3` | Body, secondary |
| `ink-3` | `#5A6670` | Labels, units |
| `ink-4` | `#39434B` | Disabled, ticks |

### Semantic — the entire chromatic budget

| Token | Hex | Use |
|---|---|---|
| `signal` | `#62E0A8` | Live · active · locked |
| `signal-sunk` | `#0E2A21` | Signal-tinted ground (inline code, chip fill) |
| `caution` | `#F2B33D` | Loading · stale · degraded |
| `caution-sunk` | `#2C2110` | Caution-tinted ground |
| `alert` | `#FF6A45` | Failed · critical |
| `alert-sunk` | `#2E1409` | Alert-tinted ground |

**Mint, not cyan.** Dropping `#00d4ff` is deliberate. Neon cyan on near-black is the default
sci-fi HUD of the last decade and it is also the hue the globe's ocean and atmosphere already
occupy — chrome and terrain were fighting for the same wavelength. Mint phosphor separates
cleanly from ocean blue, survives on a bright daylight basemap, and carries the instrument
association without the arcade.

**Selection is white, not coloured.** The strongest emphasis in the system is an inverted plate
— `ink` ground, `ground` text. Signal green is spent only on state that came from the data,
never on "you clicked this."

---

## 04 · Type

**Archivo** for interface, **IBM Plex Mono** for everything with a number or a status in it.

Inter is retired — it is the neutral default that makes every product look like every other
product, and its wide apertures go soft at the 9–10px label sizes this console lives at.
Archivo's tighter, squarer grotesk holds shape at small caps and reads as silkscreen on an
instrument face.

```html
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap">
```

| Role | Face | Size / spacing | Applies to |
|---|---|---|---|
| Display | Archivo 600 | 30px · −0.028em · 1.05 | Panel titles at hero scale only |
| Title | Archivo 600 | 18px · −0.014em · 1.2 | Callsign, place name, contact subject |
| Body | Archivo 400 | 13.5px / 1.62 | Sentences. Rare in this UI. |
| UI | Archivo 500 | 12px / 1.35 | Button labels, sentence case |
| Label | Plex Mono 500 | 10px · 0.20em · UC | Every field name |
| Micro | Plex Mono 500 | 9px · 0.24em · UC | Qualifiers, credits, tick marks |
| Readout | Plex Mono 400 | 22px · tabular | Altitude, speed, heading, coords |

Only two letter-spacing values exist for uppercase: `0.20em` for labels, `0.24em` for micro.
The current build uses eleven, ranging from 0.3px to 3px, which is why nothing lines up
optically. All numerics carry `font-variant-numeric: tabular-nums` without exception.

---

## 05 · Geometry

| Property | Values | Rule |
|---|---|---|
| Radius | 0 · 2 · 3 | 2px is the default. 0 for full-bleed rails and strips. 3px only on overlays. Nothing else exists (plus `50%` for marker dots). |
| Stroke | 1px | One weight. Emphasis comes from the hairline's colour, not its thickness. Single exception: the 2px state spine on a selected row or toast. |
| Spacing | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 | 4px base. Panel padding is 12 or 16. Section gaps are 24 or 32. |
| Elevation | 4 plates | `ground → plate → plate-hi → plate-top`. Depth is a value step. There is no z-shadow ladder. |
| Shadow | 1 permitted | `0 24px 48px -12px rgba(0,0,0,.72)` — popovers and modals only. |
| Blur | 0 | No `backdrop-filter` in chrome. Reserved for the cockpit visor optics, which are scene, not UI. |

---

## 06 · The token block

Drop-in replacement for the `:root` block in `style.css`. Existing variable names are preserved
wherever they carry the same meaning, so the 9,433-line stylesheet re-skins on the first paste
before any component work starts.

```css
/* style.css — GEV R.1 */
:root {
  color-scheme: dark;

  /* ground stack */
  --bg-dark:            #06080A;
  --plate:              #0D1216;
  --plate-hi:           #121A20;
  --plate-top:          #18222A;
  --plate-sunk:         #04070A;
  --glass-bg:           #0D1216;   /* opaque now — name kept for the diff */

  /* structure */
  --line:               #1C242B;
  --glass-border:       #2E3941;
  --glass-border-hover: #3A4750;

  /* ink */
  --text-primary:       #E4EAEE;
  --text-secondary:     #8B98A3;
  --text-dim:           #5A6670;
  --text-ghost:         #39434B;

  /* semantic — the whole chromatic budget */
  --signal:             #62E0A8;
  --signal-sunk:        #0E2A21;
  --caution:            #F2B33D;
  --caution-sunk:       #2C2110;
  --alert:              #FF6A45;
  --alert-sunk:         #2E1409;
  --accent:             var(--signal);  /* alias during migration, then delete */

  /* geometry */
  --panel-radius:       2px;
  --btn-radius:         2px;
  --overlay-radius:     3px;
  --stroke:             1px;
  --shadow-overlay:     0 24px 48px -12px rgba(0, 0, 0, .72);

  /* type */
  --font-sans:          'Archivo', 'Helvetica Neue', Arial, sans-serif;
  --font-mono:          'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --track-label:        0.20em;
  --track-micro:        0.24em;

  /* motion */
  --ease:               cubic-bezier(0.2, 0, 0, 1);
  --t-fast:             90ms;
  --t-base:             160ms;
  --t-slow:             260ms;
}
```

Deletions, not additions, do most of the work: strike every `--accent-glow`, `--accent-dim`,
`text-shadow` and `backdrop-filter` reference in the file. That single pass is roughly 87
declarations and lands most of the visual change before a single component is rebuilt.

Variables to delete outright once Phase 2 lands: `--accent-dim`, `--accent-glow`,
`--transition-fast`, `--transition-smooth` (replaced by `--t-*` + `--ease`), and the
`--left-stack-*` / `--right-rail-*` offsets (replaced by the frame grid in §08).

---

## 07 · Components

Live specimens exist in the [artifact](https://claude.ai/code/artifact/0ed6c054-0964-4e9e-8be6-9ff5fcebf1fb).
The values below are the specification.

### Plate

The base surface. Everything is a plate or lives on one.

- Background `--plate`, border `1px solid --glass-border`, radius `2px`
- Padding `12px 16px`
- **No** backdrop-filter, **no** box-shadow, **no** inset highlight

**Bracketed focus.** The one element holding focus gets 7×7px corner ticks, `1px solid --signal`,
on the top-left and bottom-right only, offset `-1px` so they sit on the border. Corners only —
never a full outline, never a glow.

### Readout

Label above, value below, unit trailing at label weight.

- Label — mono 9px · `0.20em` · UC · `--text-dim`
- Value — mono 24px · 400 · `--text-primary` · `tabular-nums`
- Unit — mono 10px · `0.14em` · `--text-dim`, baseline-aligned, 8px gap
- Multi-readout rows: 24px gap between groups

Tabular figures are mandatory so digits never shift under live update.

### Layer chip

- Height `26px`, padding `0 12px`, radius `2px`
- Mono 10px · `0.14em` · UC
- Marker: 4×4px square, `flex: none`, 8px gap

| State | Text | Border | Marker |
|---|---|---|---|
| Off | `--text-dim` | `--glass-border` | `--text-ghost` fill |
| Loading | `--caution` | `--caution-sunk` | `--caution` fill, blinking |
| Live | `--text-primary` | `--glass-border-hover` | `--signal` fill |
| Degraded | `--caution` | `--caution-sunk` | 5×5px `--caution` **outline**, hollow |
| Failed | `--alert` | `--alert-sunk` | `--alert` fill |

State reads from the marker's fill and the border, so it survives at a glance and in greyscale.

### Segmented control

- Height `26px`, 1px outer border, internal dividers `1px solid --line`
- Buttons: padding `0 12px`, mono 10px · `0.16em` · UC
- Rest `--text-dim` · Hover `--text-primary` on `--plate-hi`
- **Selected: inverted** — background `--text-primary`, colour `--bg-dark`
- Focus: `outline: 1px solid --signal; outline-offset: -2px`

No accent hue on selection — the emphasis is value, so it never competes with live-data green.

### Tool rail

- Width `48px`, flush to the viewport edge, radius `0`
- Buttons `44px` tall, separated by `1px solid --line`
- Active: `2px` `--signal` spine on the left inset edge **plus** a step to `--plate-hi`
- No fill, no icon glow, no transform

### List row

- Grid `minmax(0,1fr) auto auto`, gap `12px`, padding `8px 12px`
- Mono 11px, `tabular-nums`, `--text-secondary`; the id column is `--text-primary`
- Separated by `1px solid --line` — rows are **not** carded
- Hover: `--plate-hi`
- Selected: `--plate-top` + `box-shadow: inset 2px 0 0 var(--signal)`

No border change, no lift, no transform on selection.

### Quantitative slider

- Track `3px` `--line`; fill `--text-secondary`; knob is a `2×12px` blade in `--text-primary`
- Head row: label (mono 9px · `0.18em` · UC · `--text-dim`) left, value right in
  `--text-primary`, `tabular-nums`
- Ticks below: min · mid · max, mono 9px `--text-ghost`

The value is always printed. A slider that only shows a position isn't an instrument.

### Status line / toast

- Padding `8px 12px`, 1px border, radius `2px`
- Left border `2px` carries severity: `--signal` / `--caution` / `--alert`
- Mono 10.5px · `0.08em` · `--text-primary`
- Timestamp right-aligned, `--text-ghost`, `tabular-nums`

Messages state what happened, then what it means —
`TomTom key absent — simulated traffic`, not `Warning: fallback active`.

### Before / after

| | Now | R.1 |
|---|---|---|
| Surface | `rgba(12,12,20,.72)` + `blur(24px)` | `#0D1216`, opaque |
| Border | `rgba(255,255,255,.08)` | `#2E3941` hairline |
| Radius | `16px` panel, `10px` button | `2px` both |
| Depth | 2 stacked box-shadows | value step, no shadow |
| Active | cyan border + halo + text-shadow | inverted white plate |
| Header | title only | title + keyboard hint, `1px` rule below |

---

## 08 · The frame

The largest structural change. Today the HUD is a set of floating, draggable, collapsible glass
islands with hard-coded offsets — `--left-stack-x: 52px`, `--left-stack-top: 26vh` — that
overlap unpredictably at small viewports. R.1 replaces them with four fixed regions and one
scene.

```
┌──────────────────────────────────────────────────────────────┐
│  STATUS STRIP                                       36px     │
├────┬────────────────────────────────────┬────────────────────┤
│    │                                    │                    │
│ T  │                                    │   CONTEXT          │
│ O  │              SCENE                 │   264px            │
│ O  │        (never covered)             │                    │
│ L  │                                    │   collapses to 0   │
│    │                                    │                    │
│ 48 ├────────────────────────────────────┴────────────────────┤
│ px │  TRANSPORT — time & playback                    44px    │
└────┴─────────────────────────────────────────────────────────┘
```

| Region | Size | Holds |
|---|---|---|
| Status strip | 36px, fixed | Identity, active style, clock, connection state, global loading. Everything true of the whole system, nothing true of one layer. |
| Tool rail | 48px | Mode switching only — layers, search, styles, voice. Four to six entries, never a scrolling list. |
| Scene | fills | Never covered. Panels resize the scene rather than float over it; the globe recentres on region change. |
| Context | 264px | Whatever is selected. Collapses to 0 with the scene expanding — it does not slide over the map. |
| Transport | 44px | Time, playback, feed freshness. The one place a timeline lives. |

**Dragging is removed.** Draggable panels exist to escape a layout that doesn't work; a frame
that works has no need of them. The saved-position code in the panel handlers goes with it
(`.panel-drag-handle`, `.panel-dragging`, and the associated pointer handlers in `src/ui.js`).

---

## 09 · Colour in the data

The chrome gave up its colour so the layers could have it. One hue per layer, used on the map
marker and on that layer's chip and nowhere else — so a colour anywhere on screen always answers
"which feed is this?"

| Layer | Hue |
|---|---|
| Aircraft | `#7FC8FF` |
| Ships | `#4FD6C0` |
| Satellites | `#B9C6D0` |
| CCTV | `#9AA7B2` |
| Bikeshare | `#C0D46A` |
| Fires | `#FF7A2F` |

### Ramps, where magnitude is the message

Traffic and earthquakes are quantities, not categories, so they get ordered ramps rather than a
single hue.

| Layer | Domain | Stops |
|---|---|---|
| Traffic | free → heavy | `#4FD6C0` · `#A8CF7E` · `#F2B33D` · `#FF8A4A` · `#FF5A3C` |
| Earthquakes | M2 → M7+ | `#F2B33D` · `#FF9236` · `#FF6A45` · `#FF4A38` · `#FF3B2F` |

Both ramps are luminance-ordered as well as hue-ordered, which keeps them readable when the
basemap goes bright and for red-green colour deficiency.

**The overlap rule.** Two layers on screen must never share a hue family. If a seventh
categorical layer arrives and no distinct hue is left, that is the signal to introduce shape or
a second visual channel — not to squeeze in another orange.

---

## 10 · Motion

One easing curve, three durations, and a short list of things allowed to move.

| Event | Duration | Property | Note |
|---|---|---|---|
| Hover / press | 90ms | `background`, `color`, `border-color` | No transform. Buttons do not lift. |
| Panel open / close | 160ms | `width`, `opacity` | The scene reflows with it; nothing slides over the map. |
| Value update | 0ms | — | Numbers snap. A tweened altitude is a lie about the data. |
| Row / contact arrival | 160ms | `opacity` 0→1 | Fade only. No slide, no stagger. |
| Awaiting data | 1.1s loop | `opacity`, 2 steps | Square-wave blink on the chip marker. Not a smooth pulse — a smooth pulse reads as ambience, a blink reads as a status light. |
| Camera flight | scene-owned | Cesium easing | Unchanged. Camera motion is the app's one cinematic moment; keep it. |

Easing is `cubic-bezier(0.2, 0, 0, 1)` throughout: fast departure, long settle. Every animation
sits behind `prefers-reduced-motion`, including the blink, which falls back to a static
caution-filled marker.

---

## 11 · Prohibited

Not stylistic preferences. Each of these is a specific tell that reads as generated rather than
designed, and each one currently appears in the build or in its obvious next iteration.

- ❌ **Glassmorphism as a default.** Translucent blurred panels everywhere. Blur is a scene
  effect, not a panel treatment.
- ❌ **Glow as emphasis.** `text-shadow` on labels, halo on active buttons, radial bloom behind
  panels.
- ❌ **Neon cyan on black.** The stock sci-fi HUD. It also collides with the ocean.
- ❌ **Purple-to-blue gradients.** Anywhere, at any opacity, including as a "subtle" panel wash.
- ❌ **Inter and Space Grotesk.** The two faces that make an interface look like every AI-built
  product of the last two years.
- ❌ **Emoji as iconography.** The share button's 🔗 goes. Icons are a single monoline set or
  nothing.
- ❌ **Warm clay, terracotta and cream.** The current house palette of AI-generated design. This
  console is cold; keep it cold.
- ❌ **Pill radii on rectangles.** `999px` is for a marker dot, never for a button, chip or panel.
- ❌ **Idle animation.** Shimmer, breathing gradients, drifting particles, ambient scanlines.
  If nothing changed, nothing moves.
- ❌ **Shadow as hierarchy.** Stacked `box-shadow` ladders standing in for a value scale.
- ❌ **Centred hero cards.** A console has regions with addresses, not a poster with a focal point.
- ❌ **Decorative numerals.** 01 / 02 / 03 markers on content that isn't a sequence. Numbering
  must be citable.

---

## 12 · Migration

Four phases, ordered so the largest visual change lands first and the riskiest structural change
lands last. Each phase is independently shippable and independently revertable.

### Phase 1 — Token swap and strip-out · ~2h

Replace the `:root` block (§06), swap the Google Fonts link (§04), then delete every
`text-shadow`, `backdrop-filter` and glow-related declaration in the stylesheet. Normalise all
20 radius values down to `2px` / `3px` / `50%`. No markup changes. This is where most of the
look arrives.

**Files** — `style.css`, `index.html`

### Phase 2 — Component rebuild · ~4h

Rewrite the specimen set from §07 against the existing class names — `.panel-inner`,
`.style-btn`, `.map-stack-chip`, `.pp-slider`, `.cockpit-signal-list`, `#toast`, `.pp-mode-seg`.
Class names stay put so the JS that toggles them is untouched.

**Files** — `style.css`, `src/ui.js`

### Phase 3 — Layer colour system · ~3h

Move the per-layer hues and the two ramps from §09 into shared tokens consumed by both the map
renderers and the chips, so a layer's colour is defined once.

**Files** — `src/data/*.js`, `src/data/detectionPresentation.js`, `style.css`

### Phase 4 — The frame · ~8h

Replace the floating stack with the five-region grid from §08. Retire the drag handlers and the
`--left-stack-*` offset variables. Highest risk — the cockpit HUD overlays the same space and
needs its own pass.

**Files** — `index.html`, `src/ui.js`, `src/cockpitUtilityLayout.js`, `style.css`

### Gates — every phase, per CONTRIBUTING.md

```bash
npm run build && npm test
```

```bash
npm run test:track
```

`test:track` requires the dev server to be up. All three must stay green.

### Acceptance — R.1 is done when

| Criterion | Target |
|---|---|
| Distinct `border-radius` values in `style.css` | ≤ 3 (plus `50%`) |
| `text-shadow` declarations in chrome | 0 |
| `backdrop-filter` declarations | ≤ 4, cockpit optics only |
| `box-shadow` declarations | ≤ 8, overlays only |
| Chromatic hues in chrome | 3, all semantic |
| Numeric readouts using `tabular-nums` | 100% |
| Uppercase letter-spacing values | 2 |
| Panels overlapping the scene at 1280×720 | 0 |
| Chrome legible over a white-desert basemap | Pass |

The last one is the real test and it is worth running by hand: fly to a bright daytime salt flat
at low altitude. If any label, chip or panel becomes hard to read, the chrome is still borrowing
contrast from the scene, and something in §02 has been violated.

---

## Notes

- **Dark-committed by intent.** There is no light theme. The subject is a night-side console;
  a light mode would be a different product, not a variant.
- **Updating the artifact.** Edit `docs/DESIGN-R1.artifact.html` and republish it to the same URL
  with the `url` parameter. Keep this Markdown and that HTML in sync — the Markdown is canonical
  for implementation, the HTML is canonical for the rendered version.
