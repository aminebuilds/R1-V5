/**
 * @file Lettered map keys — the board's rows, placed on the globe.
 *
 * A ranked row that says "A — Casey's #418, +11.4 min" is only half an answer
 * while the operator has to guess which dot on the map that is. The same key
 * the board prints beside a row is therefore drawn at that row's coordinates,
 * so a claim and its subject are readable in one glance and the board stops
 * being a table sitting next to an unrelated picture.
 *
 * Keys come from whatever the current board already computed: `ranked` rows and
 * `multiples` tiles hand out matching letters, so the two blocks and the globe
 * all agree without any of them coordinating.
 *
 * The collection half is pure and node-testable; only `syncMapKeys` and its
 * neighbours touch Cesium.
 *
 * @module explain/mapKeys
 */

import * as Cesium from 'cesium';

/** Data source name, so the keys are one removable group on the viewer. */
export const MAP_KEY_SOURCE_NAME = 'explain-keys';

/**
 * Fallbacks for the V5 semantic hues. The stylesheet's `:root` block is the
 * source of truth (§06); these only stand in when the computed style is
 * unavailable, which is the case in tests and before the stylesheet parses.
 */
const TONE_FALLBACK = Object.freeze({
  signal: '#62E0A8',
  caution: '#F2B33D',
  alert: '#FF6A45',
  ghost: '#8B98A3',
});

/** Map a block tone onto the CSS custom property that defines it. */
const TONE_VARIABLE = Object.freeze({
  signal: '--signal',
  caution: '--caution',
  alert: '--alert',
  ghost: '--text-secondary',
});

let _viewer = null;
let _source = null;

/**
 * Resolve a tone to a hex colour, preferring the live stylesheet so the badge
 * and the chip beside its row can never drift apart.
 *
 * @param {string} tone
 * @param {Document} [doc]
 * @returns {string}
 */
export function toneColor(tone, doc = globalThis.document) {
  const key = TONE_VARIABLE[tone] ? tone : 'signal';
  const fallback = TONE_FALLBACK[key];
  const root = doc?.documentElement;
  if (!root || typeof globalThis.getComputedStyle !== 'function') return fallback;
  const value = globalThis.getComputedStyle(root).getPropertyValue(TONE_VARIABLE[key]);
  return String(value || '').trim() || fallback;
}

/**
 * Pull the keyed, located subjects out of a composed board.
 *
 * `ranked` is read before `multiples` so that when both carry the same letter —
 * which is the normal case, they are two views of one list — the ranked row's
 * richer label wins. A subject without coordinates is skipped rather than
 * placed at a guessed position.
 *
 * @param {object[]} blocks
 * @returns {Array<{key: string, lat: number, lon: number, label: string, tone: string}>}
 */
export function collectMapKeys(blocks) {
  const byKey = new Map();

  const consider = (key, focus, label, tone) => {
    if (!key || !focus) return;
    if (!Number.isFinite(focus.lat) || !Number.isFinite(focus.lon)) return;
    if (byKey.has(key)) return;
    byKey.set(key, {
      key: String(key),
      lat: Number(focus.lat),
      lon: Number(focus.lon),
      label: String(focus.label || label || ''),
      tone: tone || 'signal',
    });
  };

  for (const block of blocks || []) {
    if (block?.type !== 'ranked') continue;
    for (const row of block.rows || []) consider(row.key, row.focus, row.label, row.tone);
  }
  for (const block of blocks || []) {
    if (block?.type !== 'multiples') continue;
    for (const tile of block.tiles || []) consider(tile.key, tile.focus, tile.label, tile.tone);
  }

  return [...byKey.values()];
}

/** Attach the key layer to a viewer. Idempotent. */
export function initMapKeys(viewer) {
  if (!viewer?.dataSources || _source) return _source;
  _viewer = viewer;
  _source = new Cesium.CustomDataSource(MAP_KEY_SOURCE_NAME);
  viewer.dataSources.add(_source);
  return _source;
}

/** Remove every key currently on the globe. */
export function clearMapKeys() {
  _source?.entities.removeAll();
}

/**
 * Draw one badge per keyed subject.
 *
 * Deliberately a label with a background rather than a billboard: it stays
 * crisp at every zoom, needs no generated texture, and inherits the same
 * monospace the board prints its keys in. Depth testing is disabled so a badge
 * is never swallowed by terrain — a key the operator cannot see is worse than
 * no key at all.
 *
 * @param {Array<{key: string, lat: number, lon: number, label: string, tone: string}>} keys
 */
export function syncMapKeys(keys) {
  if (!_source) return;
  clearMapKeys();
  if (!Array.isArray(keys) || keys.length === 0) return;

  for (const entry of keys) {
    const colour = Cesium.Color.fromCssColorString(toneColor(entry.tone));
    _source.entities.add({
      id: `${MAP_KEY_SOURCE_NAME}:${entry.key}`,
      position: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat),
      label: {
        text: entry.key,
        font: '600 13px "IBM Plex Mono", ui-monospace, monospace',
        fillColor: colour,
        showBackground: true,
        // `--plate-top`, the value step the board uses for its own key badge.
        backgroundColor: Cesium.Color.fromCssColorString('#18222A').withAlpha(0.92),
        backgroundPadding: new Cesium.Cartesian2(7, 5),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Recede rather than disappear, so a wide view still shows where the
        // ranked set is without the letters colliding.
        scaleByDistance: new Cesium.NearFarScalar(2_000, 1.0, 400_000, 0.55),
        translucencyByDistance: new Cesium.NearFarScalar(400_000, 1.0, 2_500_000, 0.0),
      },
      point: {
        pixelSize: 5,
        color: colour,
        outlineWidth: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(400_000, 1.0, 2_500_000, 0.0),
      },
      description: entry.label,
    });
  }
}

/** Detach the key layer. */
export function destroyMapKeys() {
  if (_viewer?.dataSources && _source) {
    try {
      _viewer.dataSources.remove(_source, true);
    } catch {
      // The viewer may already be torn down; the reference drop below is enough.
    }
  }
  _source = null;
  _viewer = null;
}
