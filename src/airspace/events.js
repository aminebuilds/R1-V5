/**
 * @file Curated airspace event records.
 *
 * A live feed tells you what the system is doing now. It cannot tell you why
 * a ground stop happened, who said so, or what was ruled out — that is
 * reporting, and it changes as the story does. Each record here pins the
 * reported facts of one event to the outlet that published them, with the time
 * the record was last checked, so the board can say "as of" rather than
 * presenting yesterday's reporting as current.
 *
 * Rules for an entry:
 *  - Every marker and fact names at least one source. Press facts link to the
 *    article; facts measured by this console from OpenSky say so and carry no
 *    link because there is no page to cite.
 *  - Paraphrase. Direct quotes stay under fifteen words.
 *  - Where outlets disagree, the disagreement goes in `note` — the board never
 *    silently picks one.
 *  - Times are UTC ISO strings; the board renders them in US Eastern.
 *
 * The live headline feed (`/api/airspace/brief` → headlines) carries anything
 * newer than `checkedAt`.
 *
 * @module airspace/events
 */

const NBC_FRI = { outlet: 'NBC News', url: 'https://www.nbcnews.com/news/us-news/faa-orders-nationwide-ground-stop-departing-flights-reasons-safety-rcna609247' };
const NBC_SAT = { outlet: 'NBC News live', url: 'https://www.nbcnews.com/news/us-news/live-blog/live-updates-faa-lifts-ground-stops-airports-rcna609302' };
const CBS = { outlet: 'CBS News', url: 'https://www.cbsnews.com/news/faa-ground-stop-canceled-flights-travelers-what-we-know/' };
const YAHOO = { outlet: 'Yahoo News live', url: 'https://www.yahoo.com/news/us/live/faa-ground-stop-latest-updates-thousands-more-flights-canceled-saturday-officials-blame-overloaded-routers-no-sign-of-cyberattack-140904919.html' };
const ALJAZEERA = { outlet: 'Al Jazeera', url: 'https://www.aljazeera.com/news/2026/11/14/faa-ground-stop-lifted-why-were-us-flights-grounded-and-whats-next' };
const AIR_CURRENT = { outlet: 'The Air Current', url: 'https://theaircurrent.com/feed/dispatches/u-s-halts-flight-departures-nationwide-on-air-traffic-communications-outage/' };
const CP24_AP = { outlet: 'CP24 / AP', url: 'https://www.cp24.com/news/world/2026/11/13/faa-issues-ground-stop-for-all-flights-across-the-us-due-to-safety-issue-live-updates-here/' };
const OPENSKY_TRACKS = { outlet: 'OpenSky tracks (measured by R.1)', url: null };
const OPENSKY_TABLE = { outlet: 'OpenSky flight table (measured by R.1)', url: null };

/**
 * @typedef {{outlet: string, url: string|null}} EventSource
 * @typedef {{key: string, at: string, label: string, detail: string, sources: EventSource[]}} EventMarker
 * @typedef {{id: string, label: string, text: string, sources: EventSource[], note?: string|null}} EventFact
 */

/** @type {ReadonlyArray<object>} */
export const AIRSPACE_EVENTS = Object.freeze([
  Object.freeze({
    id: 'faa-ground-stop-2026-11-13',
    title: 'FAA nationwide ground stop',
    summary: 'A telecom network failure grounded US departures for 4 h 21 min on Friday, Nov 13.',
    checkedAt: '2026-11-14T17:20:00Z',
    // Window the departure study and the timeline cover: 8 AM to midnight ET.
    window: Object.freeze({ from: '2026-11-13T13:00:00Z', to: '2026-11-14T05:00:00Z' }),
    stop: Object.freeze({ start: '2026-11-13T20:54:00Z', end: '2026-11-14T01:15:00Z' }),
    newsQuery: Object.freeze({ gdelt: '"ground stop" FAA', rss: 'FAA ground stop' }),
    markers: Object.freeze([
      {
        key: 'A',
        at: '2026-11-13T20:36:00Z',
        label: 'Router instability begins',
        detail: 'Overloaded routers on the FAA telecom network destabilise radar and radio links at en-route centres.',
        sources: [CBS, AIR_CURRENT],
      },
      {
        key: 'B',
        at: '2026-11-13T20:54:00Z',
        label: 'Nationwide departure ground stop',
        detail: 'FAA holds every departure "for reasons of safety". Flights already airborne continue.',
        sources: [NBC_FRI, CP24_AP],
      },
      {
        key: 'C',
        at: '2026-11-13T22:32:00Z',
        label: 'First Pacific departures released',
        detail: 'EVA007 leaves SFO at 5:32 PM ET and UAL871 at 5:59 PM ET; AP reported SFO Pacific flights cleared from about 5 PM ET.',
        sources: [OPENSKY_TRACKS, CP24_AP],
      },
      {
        key: 'D',
        at: '2026-11-14T00:20:00Z',
        label: 'Transatlantic departures released',
        detail: 'DAL214 leaves ATL at 7:20 PM ET, then DAL72, DAL14 and AFR31M from ATL, CLX12B from ORD and DLH455 from SFO.',
        sources: [OPENSKY_TRACKS],
      },
      {
        key: 'E',
        at: '2026-11-14T01:15:00Z',
        label: 'Ground stop lifted',
        detail: 'Departures resume nationwide at 8:15 PM ET (CBS gives about 8:20 PM).',
        sources: [NBC_FRI, ALJAZEERA, AIR_CURRENT],
      },
      {
        key: 'F',
        at: '2026-11-14T16:01:00Z',
        label: 'Cause attributed to contractor router work',
        detail: 'Sec. Duffy: a router replaced during L3Harris copper-to-fiber work flooded the network.',
        sources: [YAHOO, NBC_SAT],
      },
    ]),
    facts: Object.freeze([
      {
        id: 'cause',
        label: 'Cause — provisional',
        text: 'A router replaced during L3Harris copper-to-fiber work at a remote FAA site flooded the FAA Telecommunications Infrastructure (FTI) network. Contractor error versus a faulty router is not yet determined.',
        sources: [YAHOO, NBC_SAT, CBS],
      },
      {
        id: 'spread',
        label: 'Spread',
        text: 'Instability reached 17 facilities, with about 45 minutes of flooding before the source was found (FAA Administrator Bedford).',
        sources: [CBS],
        note: 'The Air Current cited 10 en-route centres "and growing" mid-event.',
      },
      {
        id: 'ruled-out',
        label: 'Ruled out',
        text: 'Cyberattack — "we don\'t believe this was cyber at all" (Duffy). The SMART AI planning tool is not connected to the systems that failed (Bedford).',
        sources: [YAHOO, NBC_SAT],
      },
      {
        id: 'friday',
        label: 'Friday impact',
        text: '9,159 flights cancelled and 7,190 delayed (FlightAware). At least 827 diversions by 7:05 PM ET (Cirium). About 3,500 aircraft were airborne when the order went out.',
        sources: [CBS, ALJAZEERA],
        note: 'FlightRadar24 counted 4,700+ cancellations and 10,000 delays (Al Jazeera).',
      },
      {
        id: 'saturday',
        label: 'Saturday impact',
        text: '4,100+ flights cancelled and about 3,200 delayed by late morning ET (FlightAware). FAA projected 4,000–5,000 cancellations of about 41,000 scheduled.',
        sources: [CBS, NBC_SAT],
      },
      {
        id: 'who-flew',
        label: 'Who kept flying',
        text: 'Lower-48 departures fell to 3–7% of the prior day. Still moving: flights already airborne, case-by-case international departures, Alaska and Hawaii, military, and VFR private flights.',
        sources: [OPENSKY_TABLE, OPENSKY_TRACKS],
      },
      {
        id: 'recovery',
        label: 'Recovery',
        text: 'Airlines expected back on full schedules by close of business Sunday. The FAA disabled the faulting function on about 60 routers of the same type.',
        sources: [YAHOO, NBC_SAT],
      },
      {
        id: 'next',
        label: 'Next',
        text: 'House Transportation and Senate Commerce reviews announced. Duffy plans an emergency modernization funding request on Monday.',
        sources: [YAHOO, AIR_CURRENT],
      },
    ]),
  }),
]);

/** How long after an event's window closes it stays the board's subject. */
export const EVENT_RELEVANCE_MS = 7 * 86_400_000;

/**
 * The event the board should frame live data around, if any.
 * @param {number} [now]
 * @returns {object|null}
 */
export function activeAirspaceEvent(now = Date.now()) {
  const live = AIRSPACE_EVENTS
    .filter((event) => Date.parse(event.window.from) <= now && now - Date.parse(event.window.to) <= EVENT_RELEVANCE_MS)
    .sort((a, b) => Date.parse(b.window.from) - Date.parse(a.window.from));
  return live[0] || null;
}
