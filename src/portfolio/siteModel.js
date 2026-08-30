/**
 * @file The Phase-0 `Site` record shape and pure normalization helpers for
 * turning a raw CSV row into a `Site`, or flagging why it can't become one.
 * `Org`/`Banner`/`Region` are constant-id stubs on every `Site` in Phase 0
 * (see docs/CURRENT-STATE.md-adjacent Banner OS spec, §04) rather than
 * separate entity tables — a later phase can split them without reshaping
 * `Site`.
 * @module portfolio/siteModel
 */

export const MAX_NAME_LEN = 200;
export const MAX_ADDRESS_LEN = 300;
const MAX_FORMAT_LEN = 100;
const MAX_REF_LEN = 100;

/**
 * Build a lowercase-trimmed column-name → index map from a CSV header row.
 * First occurrence of a duplicate column name wins.
 * @param {string[]} header
 * @returns {Map<string, number>}
 */
export function buildHeaderIndex(header) {
  const index = new Map();
  (header || []).forEach((col, i) => {
    const key = String(col ?? '').trim().toLowerCase();
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}

function cell(row, headerIndex, key) {
  const i = headerIndex.get(key);
  if (i === undefined) return '';
  const value = row[i];
  return typeof value === 'string' ? value.trim() : '';
}

/** Truncate untrusted free text to a bounded length before it enters a Site record. */
export function clip(value, maxLen) {
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

/** Tiny deterministic string hash (FNV-1a) — good enough to disambiguate slugs, not cryptographic. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Deterministic id-safe slug for a site with no `externalRef`. Same
 * name+address always yields the same key, so re-importing the same CSV
 * replaces rather than duplicates.
 * @param {string} name
 * @param {string} address
 * @returns {string}
 */
export function slugifySiteKey(name, address) {
  const base = `${name || ''} ${address || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'site'}-${fnv1a(`${name || ''}|${address || ''}`)}`;
}

/**
 * Normalize one CSV data row into a `Site`, or report why it can't be one.
 * A row with an address but no valid lat/lon is still a valid `Site` —
 * `lat`/`lon`/`geocodeSource` are left `null`, pending geocode resolution
 * via {@link mergeSiteCoordinates}.
 * @param {string[]} row
 * @param {Map<string, number>} headerIndex
 * @param {{importedAt?: string}} [opts]
 * @returns {{site: object|null, error: string|null}}
 */
export function normalizeSiteRow(row, headerIndex, { importedAt } = {}) {
  const name = clip(cell(row, headerIndex, 'name'), MAX_NAME_LEN);
  if (!name) return { site: null, error: 'missing-name' };

  const address = clip(cell(row, headerIndex, 'address'), MAX_ADDRESS_LEN);
  const rawLat = cell(row, headerIndex, 'lat');
  const rawLon = cell(row, headerIndex, 'lon');
  const lat = rawLat === '' ? NaN : Number(rawLat);
  const lon = rawLon === '' ? NaN : Number(rawLon);
  const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lon);

  if (!hasValidCoords && !address) {
    return { site: null, error: 'no-address-no-coordinates' };
  }

  const format = clip(cell(row, headerIndex, 'format'), MAX_FORMAT_LEN) || null;
  const externalRef = clip(cell(row, headerIndex, 'externalref'), MAX_REF_LEN) || null;
  const openedAt = cell(row, headerIndex, 'openedat') || null;

  const id = externalRef
    ? `site:ext:${externalRef.toLowerCase()}`
    : `site:${slugifySiteKey(name, address)}`;

  const site = {
    id,
    orgId: 'org:default',
    bannerId: 'banner:default',
    regionId: 'region:default',
    externalRef,
    name,
    address,
    lat: hasValidCoords ? lat : null,
    lon: hasValidCoords ? lon : null,
    openedAt,
    format,
    importedAt: importedAt || new Date().toISOString(),
    geocodeSource: hasValidCoords ? 'csv' : null,
  };

  return { site, error: null };
}

/**
 * Apply a resolved geocode result to a `Site` pending coordinates. Pure —
 * returns a new object.
 * @param {object} site
 * @param {{lat: number, lon: number, source?: string}} resolved
 * @returns {object}
 */
export function mergeSiteCoordinates(site, { lat, lon, source = 'address' }) {
  return { ...site, lat, lon, geocodeSource: source };
}
