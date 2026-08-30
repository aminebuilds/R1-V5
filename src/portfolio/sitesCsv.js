/**
 * @file Orchestrates a full CSV import: parse → normalize each row → resolve
 * missing coordinates via an injected `geocode` function → `{sites, skipped}`.
 * Failure is skip-with-warning, never a silent drop or a blocked import — one
 * bad address in a 340-row file must not stop the other 339.
 * @module portfolio/sitesCsv
 */

import { parseCsv } from './csvParser.js';
import { buildHeaderIndex, mergeSiteCoordinates, normalizeSiteRow } from './siteModel.js';

const DEFAULT_MAX_CONCURRENT_GEOCODE = 5;

/**
 * @param {string} text - Raw CSV file contents.
 * @param {object} opts
 * @param {(address: string, opts: {signal?: AbortSignal}) => Promise<{lat:number, lon:number}|null>} opts.geocode
 *   Injected so this stays testable without a real network call.
 * @param {() => string} [opts.now]
 * @param {number} [opts.maxConcurrentGeocode]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{sites: object[], skipped: Array<{name:string, address:string, reason:string}>}>}
 */
export async function importSitesCsv(text, {
  geocode,
  now = () => new Date().toISOString(),
  maxConcurrentGeocode = DEFAULT_MAX_CONCURRENT_GEOCODE,
  signal,
} = {}) {
  const { header, rows } = parseCsv(text);
  const headerIndex = buildHeaderIndex(header);
  const importedAt = now();

  const sites = [];
  const skipped = [];
  /** @type {Map<string, object[]>} normalized address -> sites sharing it */
  const pendingByAddress = new Map();

  for (const row of rows) {
    const { site, error } = normalizeSiteRow(row, headerIndex, { importedAt });
    if (error) {
      skipped.push({ name: rawCell(row, headerIndex, 'name'), address: rawCell(row, headerIndex, 'address'), reason: error });
      continue;
    }
    if (site.lat === null || site.lon === null) {
      const key = site.address.trim().toLowerCase();
      if (!pendingByAddress.has(key)) pendingByAddress.set(key, []);
      pendingByAddress.get(key).push(site);
    } else {
      sites.push(site);
    }
  }

  const addressKeys = [...pendingByAddress.keys()];
  if (addressKeys.length > 0) {
    if (typeof geocode !== 'function') {
      for (const key of addressKeys) {
        for (const site of pendingByAddress.get(key)) {
          skipped.push({ name: site.name, address: site.address, reason: 'geocode-unavailable' });
        }
      }
    } else {
      await runWithConcurrency(addressKeys, maxConcurrentGeocode, async (key) => {
        const group = pendingByAddress.get(key);
        const sampleAddress = group[0].address;
        let result = null;
        let failReason = null;
        try {
          result = await geocode(sampleAddress, { signal });
        } catch (err) {
          failReason = err?.name === 'AbortError' ? 'geocode-aborted' : `geocode-error:${err?.message || 'unknown'}`;
        }
        if (!result && !failReason) failReason = 'geocode-empty';
        for (const site of group) {
          if (result) {
            sites.push(mergeSiteCoordinates(site, { lat: result.lat, lon: result.lon, source: 'address' }));
          } else {
            skipped.push({ name: site.name, address: site.address, reason: failReason });
          }
        }
      });
    }
  }

  return { sites, skipped };
}

function rawCell(row, headerIndex, key) {
  const i = headerIndex.get(key);
  if (i === undefined) return '';
  return String(row[i] ?? '').trim();
}

/** Run `worker` over `items` with at most `limit` concurrent calls. */
async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const lanes = new Array(workerCount).fill(0).map(async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(lanes);
}
