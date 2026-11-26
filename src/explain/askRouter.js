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

/**
 * Named chokepoints a question can point the fuel-price and chokepoint
 * actions at, matched against `disruptionIndex.js`'s `CHOKEPOINTS` ids.
 */
const CHOKEPOINT_NAMES = Object.freeze([
  { id: 'hormuz', pattern: /\bhormuz\b/i },
  { id: 'malacca', pattern: /\bmalacca\b/i },
  { id: 'suez', pattern: /\bsuez\b/i },
  { id: 'bab', pattern: /\bbab[\s-]?el[\s-]?mandeb\b/i },
]);

/**
 * Which named chokepoint (if any) a question mentions.
 * @param {string} text
 * @returns {string|null}
 */
function detectChokepoint(text) {
  const found = CHOKEPOINT_NAMES.find(({ pattern }) => pattern.test(text));
  return found ? found.id : null;
}

/**
 * Which trading window a performance question is asking about.
 * @param {string} text
 * @returns {string}
 */
export function detectPeriod(text) {
  if (/\b(today|so far today|this morning|tonight)\b/i.test(text)) return 'today';
  if (/\b(month|30 days|last 4 weeks)\b/i.test(text)) return 'month';
  if (/\b(quarter|90 days|ytd)\b/i.test(text)) return 'quarter';
  return 'week';
}

/**
 * Which face of the loyalty file a member question wants: the cohorts, one
 * person, or the identity bridge.
 * @param {string} text
 * @returns {string}
 */
export function detectMemberFocus(text) {
  if (/\b(identif\w*|identity|resolve|who (is|was) (that|this)|anonymous)\b/i.test(text)) return 'identity';
  if (/\b(a member|one member|this member|show me a|profile)\b/i.test(text)) return 'member';
  return 'segments';
}

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
  // Store-agent intents come first because their vocabulary is the most
  // specific in the product -- "campaign", "member", "offer", "this hour".
  // Each is worded narrowly enough not to swallow the broader questions
  // below it: "what should I run today" still reaches the cool-off engine,
  // and "how busy is the Strait of Hormuz right now" still reaches the
  // chokepoint one, because neither carries store or offer vocabulary.
  {
    action: 'deploy_offer',
    pattern: /\b(push (it |that )?live|go live|publish (it|that|the offer)|deploy (it|that|the offer)|launch (it|that)|send (the )?push|put (it|that) (up|live)|make (it|that) live)\b/i,
    question: 'Push the offer live',
  },
  {
    action: 'create_offer',
    pattern: /\b(create|build|make|set ?up|design|draft|mock ?up|generate)\b[^?!.]{0,36}\b(offer|promo|promotion|deal|coupon|ad|advert|creative|campaign)\b/i,
    question: 'Build this offer',
  },
  {
    action: 'get_campaign_performance',
    pattern: /\b(campaign|campaigns)\b|\b(loyalty|promo|promotion|program|programme)\b[^?!.]{0,28}\b(perform\w*|working|pay\w*|roi|return|results?)\b|\bwhat\b.{0,14}\b(running|live right now)\b/i,
    question: 'Which loyalty campaigns are working?',
  },
  {
    action: 'recommend_offer',
    pattern: /\b(offer|offers|coupon|coupons|deal|deals)\b|\bloyalty\b[^?!.]{0,24}\b(run|launch|push|fire|idea|ideas)\b/i,
    question: 'What offer should I run right now?',
  },
  {
    action: 'get_member_intelligence',
    pattern: /\b(member|members|membership|segment|segments|loyalty file|enrolled|enrolment|enrollment|lapsing|lapsed|churn|identity|identify|resolve|who (is|was) (that|this))\b/i,
    question: 'Who is on the loyalty file here?',
  },
  {
    action: 'get_store_pulse',
    pattern: /\b(dip|dipping|pulse)\b|\b(transactions?|sales|basket|business|store|register|forecourt)\b[^?!.]{0,28}\b(right now|this hour|last hour|at the moment|today so far)\b|\breal[\s-]?time\s+(transactions?|sales|numbers|performance)\b/i,
    question: 'What is happening at this store right now?',
  },
  {
    action: 'get_store_performance',
    // A bare period ("this quarter") is deliberately NOT enough on its own:
    // "what is my commercial rent this quarter" is not a trading question,
    // and routing it here would produce a confident board about the wrong
    // thing — the exact failure this router exists to refuse.
    pattern: /\b(store|shop|site)\b[^?!.]{0,30}\b(doing|perform\w*|week|month|quarter|sales|numbers|trading|trend|go|goes|going|went|do|did|does|today|yesterday)\b|\b(doing|perform\w*|sales|numbers|trading|trend|go|went|do|did|does)\b[^?!.]{0,30}\b(store|shop|site)\b|\b(sales|transactions?|gallons|basket|trading|revenue|gross profit|numbers)\b[^?!.]{0,30}\b(this|last|past) (week|month|quarter)\b|\bweek[\s-]?over[\s-]?week\b|\bdaypart\b|\bbasket size\b/i,
    question: 'How is this store performing?',
  },
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
    action: 'inspect_chokepoint',
    pattern: /\b(strait|chokepoint|choke point|hormuz|malacca|suez|bab[\s-]?el[\s-]?mandeb)\b/i,
    question: 'How busy is this strait right now?',
  },
  {
    // Placed above traffic so "flight delays" reaches the airspace board, not
    // the road-traffic one. A bare "flights" stays with the analyst counter
    // ("how many flights in view" is routed before INTENTS are consulted).
    action: 'get_airspace_brief',
    pattern: /\b(faa|ground ?stops?|grounded|airspace|air traffic control|atc (outage|failure)|ground delay|nas status)\b|\b(flights?|airports?|airlines?)\b[^?!.]{0,30}\b(cancel\w*|delay\w*|grounded|halted|stopped|disrupt\w*)\b|\b(cancel\w*|delay\w*|grounded|disrupt\w*)\b[^?!.]{0,30}\b(flights?|airports?|airlines?)\b/i,
    question: 'What is happening in US airspace?',
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
  'How is this store doing this week?',
  'Are we seeing a dip in transactions right now?',
  'Which loyalty campaigns are working?',
  'What offer should I run right now?',
  'Who is on the loyalty file here?',
  'How is this view doing?',
  'What is fuel about to cost me?',
  'Who am I up against here?',
  'What is happening in US airspace?',
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
      const args = {};
      if (intent.action === 'get_fuel_price_outlook' || intent.action === 'inspect_chokepoint') {
        const chokepoint = detectChokepoint(question);
        if (chokepoint) args.chokepoint = chokepoint;
      }
      // "Build me a 99 cent coffee offer" carries the whole specification in
      // the sentence. Dropping it would hand the offer studio an empty spec
      // and quietly build whatever ranks first — the operator asks for coffee
      // and the board shows them a fountain drink.
      if (intent.action === 'create_offer') args.description = question;
      if (intent.action === 'get_store_performance') args.period = detectPeriod(question);
      if (intent.action === 'get_member_intelligence') args.focus = detectMemberFocus(question);
      return { action: intent.action, args, question, matched: intent.action };
    }
  }

  return { action: null, args: {}, question, matched: null };
}
