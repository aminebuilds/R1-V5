/**
 * @file Multi-Industry Contextual Intent Engine for R. v1.
 * Evaluates freeform user input (typed or voiced) against the Domain Ontology,
 * maps queries to sectors & verticals, configures optimal geospatial layers,
 * and formats JARVIS-style analytical insight briefs.
 * @module ontology/intentEngine
 */

import { VERTICALS, SECTORS, getAllVerticals, getVerticalById } from './industryOntology.js';

/**
 * @typedef {Object} IntentResolution
 * @property {string} rawQuery - Original input string.
 * @property {import('./industryOntology.js').IndustryVertical} vertical - Resolved vertical.
 * @property {object} sector - Resolved parent sector.
 * @property {string[]} layersToEnable - Computed set of layers to activate.
 * @property {string} cleanedSearchQuery - Query optimized for Places / Geocoding.
 * @property {string|null} detectedBrand - Brand or organization name detected in query.
 * @property {string[]} relevantKpis - Target performance metrics for this intent.
 * @property {Record<string, string>} relevantGlossary - Contextual glossary definitions.
 * @property {string} confidence - 'high' | 'medium' | 'default'.
 */

/**
 * Common words that should not influence vertical classification.
 */
const STOP_WORDS = new Set([
  'the', 'in', 'on', 'near', 'at', 'by', 'of', 'and', 'for', 'to', 'from',
  'show', 'find', 'locate', 'track', 'where', 'is', 'are', 'me', 'all', 'any',
  'check', 'monitor', 'look', 'up', 'search', 'get', 'give', 'list',
]);

/**
 * Extract tokens from query string.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Resolve commercial intent from a freeform query.
 * @param {string} query - Natural language query string.
 * @param {{ activeVerticalId?: string }} [context] - Current console context.
 * @returns {IntentResolution}
 */
export function resolveCommercialIntent(query, context = {}) {
  const rawQuery = String(query || '').trim();
  const tokens = tokenize(rawQuery);
  const lowerQuery = rawQuery.toLowerCase();

  let bestVertical = null;
  let highestScore = 0;
  let matchedKeyword = null;

  const verticals = getAllVerticals();

  for (const vertical of verticals) {
    let score = 0;

    // Direct vertical name match
    if (lowerQuery.includes(vertical.name.toLowerCase())) {
      score += 25;
    }

    // Direct sector name match
    if (lowerQuery.includes(vertical.sectorName.toLowerCase())) {
      score += 15;
    }

    // Aliases and brand matches
    for (const alias of vertical.aliases) {
      const aliasLower = alias.toLowerCase();
      if (lowerQuery.includes(aliasLower)) {
        score += aliasLower.includes(' ') ? 20 : 15;
        if (!matchedKeyword) matchedKeyword = alias;
      }
    }

    // Glossary term matches
    for (const term of Object.keys(vertical.glossary)) {
      const termLower = term.toLowerCase();
      if (lowerQuery.includes(termLower)) {
        score += 12;
      }
    }

    // Search keywords
    for (const kw of vertical.searchKeywords) {
      const kwLower = kw.toLowerCase();
      if (lowerQuery.includes(kwLower)) {
        score += 8;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestVertical = vertical;
    }
  }

  // Fallback to active vertical from context, or default to fuel-convenience
  const confidence = highestScore >= 15 ? 'high' : (highestScore > 0 ? 'medium' : 'default');
  if (!bestVertical) {
    bestVertical = (context.activeVerticalId && getVerticalById(context.activeVerticalId)) || VERTICALS['fuel-convenience'];
  }

  const sector = SECTORS[bestVertical.sector] || { name: bestVertical.sectorName, icon: 'business' };

  // Compute recommended layers based on vertical + specific mentions in query
  const layers = new Set(bestVertical.recommendedLayers || []);

  if (/\b(traffic|congestion|roads?|delay|commute)\b/i.test(lowerQuery)) {
    layers.add('traffic');
  }
  if (/\b(weather|storm|wind|rain|snow|temp|clouds?)\b/i.test(lowerQuery)) {
    layers.add('weather-openmeteo');
  }
  if (/\b(quake|earthquake|seismic|tremor)\b/i.test(lowerQuery)) {
    layers.add('earthquakes');
  }
  if (/\b(fire|wildfire|firms|thermal|hotspot)\b/i.test(lowerQuery)) {
    layers.add('local-firms');
  }
  if (/\b(flight|plane|aircraft|airports?|adsb)\b/i.test(lowerQuery)) {
    layers.add('flights');
  }
  if (/\b(ship|vessel|boat|marine|ais|port)\b/i.test(lowerQuery)) {
    layers.add('marine');
  }
  if (/\b(datacenter|cloud|server|fiber|cable)\b/i.test(lowerQuery)) {
    layers.add('local-datacenters');
    layers.add('telegeography-submarine-cables');
  }
  if (/\b(dam|hydro|reservoir|water)\b/i.test(lowerQuery)) {
    layers.add('local-dams');
  }
  if (/\b(satellite|orbit|tle|space)\b/i.test(lowerQuery)) {
    layers.add('satellites');
  }

  // Extract relevant glossary entries for terms present in the query
  const relevantGlossary = {};
  for (const [term, def] of Object.entries(bestVertical.glossary || {})) {
    if (lowerQuery.includes(term.toLowerCase()) || Object.keys(relevantGlossary).length < 3) {
      relevantGlossary[term] = def;
    }
  }

  // Clean conversational filler prefixes and map-request suffixes for search backends
  const cleanedSearchQuery = rawQuery
    .replace(/^(show\s+(me\s+)?(all\s+)?|find\s+(all\s+)?|map\s+(all\s+)?|locate\s+(all\s+)?|search\s+(for\s+)?|where\s+are\s+(all\s+)?)/i, '')
    .replace(/\s+(on|in)\s+(a\s+|the\s+)?map[\/\.]*$/i, '')
    .replace(/\s+(near\s+me|around\s+here|nearby)[\/\.]*$/i, '')
    .trim() || rawQuery;

  return {
    rawQuery,
    vertical: bestVertical,
    sector,
    layersToEnable: Array.from(layers),
    cleanedSearchQuery,
    detectedBrand: matchedKeyword,
    relevantKpis: bestVertical.kpis || [],
    relevantGlossary,
    confidence,
  };
}

/**
 * Format a structured JARVIS-style intelligence brief for a given entity and vertical.
 * @param {string} entityName
 * @param {import('./industryOntology.js').IndustryVertical} vertical
 * @param {Record<string, string|number>} [metrics]
 * @returns {string} Formatted markdown brief.
 */
export function formatCommercialBrief(entityName, vertical, metrics = {}) {
  const kpis = vertical?.kpis || [];
  const kpiLines = kpis.slice(0, 4).map((kpi) => {
    const val = metrics[kpi] || (metrics[kpi.toLowerCase()] !== undefined ? metrics[kpi.toLowerCase()] : 'NOMINAL · LIVE');
    return `• **${kpi}**: \`${val}\``;
  }).join('\n');

  const glossarySnippet = Object.entries(vertical?.glossary || {})
    .slice(0, 2)
    .map(([t, d]) => `> **${t}**: ${d}`)
    .join('\n>\n');

  return `### COMMERCIAL INTELLIGENCE BRIEF // ${String(entityName || 'TARGET').toUpperCase()}
**Sector**: ${vertical?.sectorName || 'Enterprise'} · **Vertical**: ${vertical?.name || 'General Commercial'}

#### OPERATIONAL TELEMETRY
${kpiLines}

#### DOMAIN CONTEXT & ONTOLOGY
${glossarySnippet}
`;
}
