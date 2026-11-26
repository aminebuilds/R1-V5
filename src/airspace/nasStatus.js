/**
 * @file FAA National Airspace System status — the public ATCSCC airport-status
 * feed (`nasstatus.faa.gov/api/airport-status-information`) parsed into the
 * programs an operator acts on: ground stops, ground delay programs, general
 * arrival/departure delays and airport closures.
 *
 * The feed is XML grouped into `<Delay_type>` blocks, each with a `<Name>` and
 * a list of items keyed by `<ARPT>`. Block names and item shapes vary by
 * program and the same block name can appear twice (the live feed splits
 * closures across two `Airport Closures` blocks), so this parser reads items
 * generically — any element carrying an `<ARPT>` child — and classifies by the
 * block name rather than trusting one fixed schema.
 *
 * Pure: no network, no DOM. Every field is what the FAA published, or null.
 *
 * @module airspace/nasStatus
 */

/** Decode the handful of entities the feed uses and trim. */
function decode(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First `<tag>` text inside a block, or null. */
function tagText(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  const text = match ? decode(match[1]) : '';
  return text || null;
}

/**
 * Split a `<Delay_type>` body into its airport items: every element whose first
 * child is `<ARPT>`. Returns the raw inner XML of each.
 * @param {string} body
 * @returns {Array<{tag: string, xml: string}>}
 */
function airportItems(body) {
  const items = [];
  const opener = /<([A-Za-z_]+)(?:\s[^>]*)?>\s*<ARPT>/g;
  let match;
  while ((match = opener.exec(body))) {
    const tag = match[1];
    const start = match.index;
    const close = body.indexOf(`</${tag}>`, start);
    if (close === -1) break;
    items.push({ tag, xml: body.slice(start, close + tag.length + 3) });
    opener.lastIndex = close + tag.length + 3;
  }
  return items;
}

/**
 * The NOTAM text carries its own validity window as `YYMMDDHHMM-YYMMDDHHMM`
 * (UTC). The `<Start>`/`<Reopen>` fields drop the year, so this is the one
 * place an unambiguous instant can be read.
 * @param {string|null} text
 * @returns {{start: string|null, end: string|null}}
 */
export function notamWindow(text) {
  const match = /\b(\d{10})-(\d{10})\b/.exec(String(text || ''));
  if (!match) return { start: null, end: null };
  const toIso = (stamp) => {
    const [yy, mo, dd, hh, mi] = [0, 2, 4, 6, 8].map((at) => Number(stamp.slice(at, at + 2)));
    const ms = Date.UTC(2000 + yy, mo - 1, dd, hh, mi);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };
  return { start: toIso(match[1]), end: toIso(match[2]) };
}

/**
 * What kind of closure a NOTAM describes. Standing general-aviation
 * prior-permission notices run for months and are not news; a closure to
 * diversion traffic is exactly what a disruption leaves behind.
 * @param {string|null} text
 * @returns {'diversion'|'intl-carriers'|'ga-ppr'|'event'|'other'}
 */
export function closureKind(text) {
  const raw = String(text || '').toUpperCase();
  if (/DIVERSION/.test(raw)) return 'diversion';
  if (/NON SKED INTL|INTL AIR CARRIER/.test(raw)) return 'intl-carriers';
  if (/TRANSIENT GA|NON SKED TRANSIENT/.test(raw)) return 'ga-ppr';
  if (/AIRSHOW|EVENT|VIP|SECURITY/.test(raw)) return 'event';
  return 'other';
}

/** Parse the feed's own update stamp ("Sat Nov 14 02:57:12 2026 GMT"). */
function parseUpdateTime(text) {
  const ms = Date.parse(String(text || '').replace(/ GMT$/, ' UTC'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Parse the FAA airport-status XML.
 *
 * @param {string} xml
 * @param {{now?: number, recentHours?: number}} [options] `recentHours` decides
 *   which closures count as new (started within that window) versus standing.
 * @returns {{
 *   updatedAt: string|null,
 *   groundStops: Array<{airport: string, reason: string|null, endTime: string|null}>,
 *   groundDelays: Array<{airport: string, reason: string|null, avg: string|null, max: string|null}>,
 *   delays: Array<{airport: string, reason: string|null, type: string|null, min: string|null, max: string|null, trend: string|null}>,
 *   closures: Array<{airport: string, notam: string|null, kind: string, start: string|null, end: string|null, recent: boolean}>,
 *   other: Array<{program: string, airport: string, reason: string|null}>,
 * }}
 */
export function parseNasStatusXml(xml, { now = Date.now(), recentHours = 48 } = {}) {
  const text = String(xml || '');
  if (!/<AIRPORT_STATUS_INFORMATION/i.test(text)) {
    throw new Error('Not an FAA airport status document');
  }
  const out = {
    updatedAt: parseUpdateTime(tagText(text, 'Update_Time')),
    groundStops: [],
    groundDelays: [],
    delays: [],
    closures: [],
    other: [],
  };

  for (const match of text.matchAll(/<Delay_type>([\s\S]*?)<\/Delay_type>/gi)) {
    const body = match[1];
    const name = tagText(body, 'Name') || '';
    for (const item of airportItems(body)) {
      const airport = tagText(item.xml, 'ARPT');
      if (!airport) continue;
      const reason = tagText(item.xml, 'Reason');
      if (/ground stop/i.test(name)) {
        out.groundStops.push({ airport, reason, endTime: tagText(item.xml, 'End_Time') });
      } else if (/ground delay/i.test(name)) {
        out.groundDelays.push({ airport, reason, avg: tagText(item.xml, 'Avg'), max: tagText(item.xml, 'Max') });
      } else if (/closure/i.test(name)) {
        const window = notamWindow(reason);
        const startMs = window.start ? Date.parse(window.start) : NaN;
        out.closures.push({
          airport,
          notam: reason,
          kind: closureKind(reason),
          start: window.start,
          end: window.end,
          recent: Number.isFinite(startMs) && now - startMs <= recentHours * 3600_000 && now - startMs >= -24 * 3600_000,
        });
      } else if (/arrival|departure/i.test(name)) {
        // One airport can carry both an arrival and a departure entry.
        const legs = [...item.xml.matchAll(/<Arrival_Departure(?:\s+Type="([^"]*)")?\s*>([\s\S]*?)<\/Arrival_Departure>/gi)];
        if (legs.length === 0) {
          out.delays.push({ airport, reason, type: null, min: tagText(item.xml, 'Min'), max: tagText(item.xml, 'Max'), trend: tagText(item.xml, 'Trend') });
        }
        for (const leg of legs) {
          out.delays.push({
            airport,
            reason,
            type: leg[1] ? decode(leg[1]) : null,
            min: tagText(leg[2], 'Min'),
            max: tagText(leg[2], 'Max'),
            trend: tagText(leg[2], 'Trend'),
          });
        }
      } else {
        out.other.push({ program: name, airport, reason });
      }
    }
  }
  return out;
}

/**
 * The counts a timeline sample keeps — small enough to store every ten minutes
 * for a week, specific enough to see a program arrive and clear.
 * @param {ReturnType<typeof parseNasStatusXml>|null} nas
 * @returns {{groundStops: number, groundDelays: number, delays: number, newClosures: number, airports: string[]}|null}
 */
export function nasSampleCounts(nas) {
  if (!nas) return null;
  const airports = new Set([
    ...nas.groundStops.map((item) => item.airport),
    ...nas.groundDelays.map((item) => item.airport),
    ...nas.delays.map((item) => item.airport),
  ]);
  return {
    groundStops: nas.groundStops.length,
    groundDelays: nas.groundDelays.length,
    delays: nas.delays.length,
    newClosures: nas.closures.filter((item) => item.recent && item.kind !== 'ga-ppr').length,
    airports: [...airports].sort(),
  };
}
