/**
 * @file Typed question → console action.
 *
 * Voice already reaches every capability through the realtime model, but the
 * mic is never load-bearing in this product (RETAIL-FUEL-INTELLIGENCE.md §01),
 * so the board needs a keyboard front door to the same functions. This is a
 * keyword router, not a language model: it maps a question onto one of the
 * deterministic actions, or admits it could not.
 *
 * The admission matters. A router that guesses would send "what is my rent"
 * to the traffic engine and produce a confident board about the wrong thing.
 * An unrouted question returns `null` and the board says which questions it
 * can actually answer.
 *
 * @module explain/askRouter
 */

/** Layer keywords the analyst engine can be pointed at. */
const LAYER_KEYWORDS = Object.freeze([
  { layer: 'flights', pattern: /\b(flight|flights|plane|planes|aircraft|airliner|adsb)\b/i },
  { layer: 'military', pattern: /\b(military|air ?force|navy|tanker jet|fighter)\b/i },
  { layer: 'ais-live-vessels', pattern: /\b(ship|ships|vessel|vessels|tanker|tankers|cargo|boat)\b/i },
  { layer: 'local-firms', pattern: /\b(fire|fires|wildfire|hotspot|hotspots)\b/i },
  { layer: 'earthquakes', pattern: /\b(earthquake|earthquakes|quake|quakes|seismic|magnitude)\b/i },
  { layer: 'sites', pattern: /\b(site|sites|store|stores|station|stations|location|locations)\b/i },
]);

/**
 * Ordered intents. First match wins, so the more specific patterns are listed
 * before the ones that would also match them.
 *
 * @type {ReadonlyArray<{action: string, pattern: RegExp, question: string}>}
 */
export const INTENTS = Object.freeze([
  {
    action: 'get_cool_off_opportunities',
    pattern: /\b(promo|promotion|opportunit\w*|cool.?off|worth running|what should i (do|run|launch)|recommend\w*|play|plays|campaign)\b/i,
    question: 'Where is a promotion worth running right now?',
  },
  {
    action: 'get_fuel_price_outlook',
    // Two ways in: an unambiguous price word, or a fuel word within a clause
    // of "cost" — "what is fuel about to cost me" carries neither on its own.
    pattern: /\b(price|prices|pricing|per gallon|forecast|wholesale|crude|brent|margin)\b|\b(fuel|gas|diesel|gasoline)\b[^?!.]{0,40}\bcosts?\b|\bcosts?\b[^?!.]{0,40}\b(fuel|gas|diesel|gasoline)\b/i,
    question: 'What is fuel about to cost me?',
  },
  {
    action: 'analyze_competitors',
    pattern: /\b(competitor\w*|competition|rival\w*|up against|market share|versus|vs\.?)\b/i,
    question: 'Who am I up against in this market?',
  },
  {
    action: 'get_portfolio_health',
    pattern: /\b(portfolio|whole business|entire business|all (my|our) (sites|stores)|every site|network)\b/i,
    question: 'How is my whole portfolio doing?',
  },
  {
    action: 'get_traffic_delays_and_construction',
    pattern: /\b(traffic|congestion|delay|delays|closure|closures|construction|roadwork|jam|gridlock)\b/i,
    question: 'What is traffic doing around here?',
  },
  {
    action: 'get_view_health',
    pattern: /\b(how('s| is| are)?\s+(this|the|it|we|things)|health|doing|performing|performance|state of play|summary)\b/i,
    question: 'How is this view doing?',
  },
]);

/** Questions the board advertises when it cannot route one. */
export const SUGGESTIONS = Object.freeze([
  'How is this view doing?',
  'Where is a promotion worth running right now?',
  'What is fuel about to cost me?',
  'Who am I up against here?',
  'What is traffic doing around here?',
]);

/**
 * Detect a counting question over a rendered layer, e.g. "how many ships in
 * view". Produces a structured `analyst_query` rather than free text, because
 * that is the only shape the engine accepts.
 *
 * @param {string} text
 * @returns {{action: string, args: object}|null}
 */
export function routeAnalystQuery(text) {
  const raw = String(text || '');
  const asksCount = /\b(how many|count|how much|list|which|show me all)\b/i.test(raw);
  if (!asksCount) return null;

  const layers = LAYER_KEYWORDS.filter(({ pattern }) => pattern.test(raw)).map(({ layer }) => layer);
  if (layers.length === 0) return null;

  const anywhere = /\b(anywhere|worldwide|globally|in total|everywhere)\b/i.test(raw);
  return {
    action: 'analyst_query',
    args: {
      layers,
      scope: anywhere ? { kind: 'anywhere' } : { kind: 'view' },
      limit: 10,
    },
  };
}

/**
 * Route a typed question.
 *
 * @param {string} text
 * @returns {{action: string|null, args: object, question: string, matched: string|null}}
 *   `action: null` means the router declined — the caller should say so rather
 *   than dispatching a best guess.
 */
export function routeQuestion(text) {
  const question = String(text || '').trim();
  if (!question) return { action: null, args: {}, question, matched: null };

  const analyst = routeAnalystQuery(question);
  if (analyst) return { ...analyst, question, matched: 'analyst' };

  for (const intent of INTENTS) {
    if (intent.pattern.test(question)) {
      return { action: intent.action, args: {}, question, matched: intent.action };
    }
  }

  return { action: null, args: {}, question, matched: null };
}
