/**
 * @file JARVIS-grade Fuzzy Address and Business Search Engine.
 * 
 * Provides resilient, typo-tolerant natural language search for businesses,
 * brands, addresses, and POIs. Handles partial strings, street abbreviations,
 * messy formatting, misspellings, and voice transcription quirks.
 * 
 * Resolution Pipeline:
 *  1. Query Tokenizer & Intent Stripper ("find", "show me", "where is").
 *  2. Local POI & Known Landmark fast-match (Levenshtein + Token Overlap).
 *  3. Active Portfolio Site match.
 *  4. Upstream Search: Google Places / Geocode + OSM Overpass Fallback.
 *  5. Confidence scoring (0-100%) and JARVIS telemetry summary.
 * 
 * @module portfolio/fuzzySearchEngine
 */

import { CITY_POIS } from '../locations.js';
import { searchBusinessSites } from './businessSearch.js';
import { geocodeAddress } from './geocodeClient.js';
import { loadPortfolio } from './portfolioStore.js';

/** Intent prefixes to strip from voice / natural language queries */
const INTENT_PREFIXES = [
  /^find\s+(me\s+)?(all\s+)?/i,
  /^show\s+(me\s+)?(all\s+)?/i,
  /^where\s+(is|are)\s+/i,
  /^locate\s+/i,
  /^look\s+up\s+/i,
  /^navigate\s+(to\s+)?/i,
  /^take\s+me\s+to\s+/i,
  /^search\s+(for\s+)?/i,
  /^pull\s+up\s+/i,
  /^zoom\s+(in\s+)?to\s+/i,
  /^what\s+about\s+/i,
];

/** Common street suffix normalization map */
const STREET_ABBREVIATIONS = {
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  rd: 'road',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  pkwy: 'parkway',
  hwy: 'highway',
  expy: 'expressway',
  fwy: 'freeway',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

/** Common brand typo dictionary for instant fuzzy normalization */
const BRAND_ALIASES = {
  sturbucks: 'Starbucks',
  starbuck: 'Starbucks',
  starbux: 'Starbucks',
  wholfoods: 'Whole Foods Market',
  wholefoods: 'Whole Foods Market',
  mcdonald: "McDonald's",
  mcdonalds: "McDonald's",
  macdonalds: "McDonald's",
  torchys: "Torchy's Tacos",
  torchy: "Torchy's Tacos",
  caseys: "Casey's General Store",
  casey: "Casey's General Store",
  dunkin: "Dunkin'",
  dunkins: "Dunkin'",
  dunkindonuts: "Dunkin'",
  chickfila: 'Chick-fil-A',
  chickfil: 'Chick-fil-A',
  peets: "Peet's Coffee",
  dutchbros: 'Dutch Bros Coffee',
  dutchbro: 'Dutch Bros Coffee',
  target: 'Target',
  walmart: 'Walmart',
  heb: 'H-E-B',
  costco: 'Costco Wholesale',
  traderjoes: "Trader Joe's",
  traderjoe: "Trader Joe's",
  walgreens: 'Walgreens',
  cvs: 'CVS Pharmacy',
  seveneleven: '7-Eleven',
  '7eleven': '7-Eleven',
  '7-11': '7-Eleven',
};

/**
 * Compute Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  const s1 = String(a || '').toLowerCase();
  const s2 = String(b || '').toLowerCase();
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  const v0 = new Array(s2.length + 1);
  const v1 = new Array(s2.length + 1);

  for (let i = 0; i <= s2.length; i++) v0[i] = i;

  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= s2.length; j++) v0[j] = v1[j];
  }

  return v1[s2.length];
}

/**
 * Compute normalized string similarity in [0, 1].
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function stringSimilarity(a, b) {
  const s1 = String(a || '').trim().toLowerCase();
  const s2 = String(b || '').trim().toLowerCase();
  if (!s1 && !s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const lenRatio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    return Math.max(0.75, lenRatio);
  }

  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Tokenize and normalize a search query.
 * @param {string} rawQuery
 * @returns {{ cleanQuery: string, tokens: string[], isAddress: boolean, inferredBrand: string|null }}
 */
export function normalizeSearchQuery(rawQuery) {
  let text = String(rawQuery || '').trim();

  // Strip conversational intent prefixes
  for (const prefix of INTENT_PREFIXES) {
    text = text.replace(prefix, '').trim();
  }

  // Remove trailing punctuation
  text = text.replace(/[?,.!;:]+$/, '').trim();

  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Normalize street abbreviations & check if it looks like an address (has numbers)
  const isAddress = /\d+/.test(text) || words.some((w) => ['st', 'street', 'ave', 'avenue', 'blvd', 'rd', 'dr', 'ln', 'way', 'pkwy'].includes(w));
  
  const normalizedWords = words.map((w) => STREET_ABBREVIATIONS[w] || w);
  const cleanKey = words.join('').replace(/[^a-z0-9]/g, '');
  let inferredBrand = BRAND_ALIASES[cleanKey] || null;

  if (!inferredBrand) {
    for (const w of words) {
      const cleanW = w.replace(/[^a-z0-9]/g, '');
      if (BRAND_ALIASES[cleanW]) {
        inferredBrand = BRAND_ALIASES[cleanW];
        break;
      }
    }
  }

  return {
    cleanQuery: text,
    tokens: normalizedWords,
    isAddress,
    inferredBrand,
  };
}

/**
 * Score candidate match against query tokens.
 * @param {string[]} queryTokens
 * @param {string} candidateName
 * @param {string} [candidateAddress]
 * @returns {number} Score in [0, 100]
 */
export function scoreMatchCandidate(queryTokens, candidateName, candidateAddress = '') {
  if (!queryTokens.length) return 0;
  const targetText = `${candidateName} ${candidateAddress}`.toLowerCase();
  const targetWords = targetText.split(/\s+/).filter(Boolean);

  let matchedTokens = 0;
  let partialBonus = 0;

  for (const token of queryTokens) {
    if (targetWords.includes(token)) {
      matchedTokens += 1;
    } else {
      let bestSim = 0;
      for (const word of targetWords) {
        const sim = stringSimilarity(token, word);
        if (sim > bestSim) bestSim = sim;
      }
      if (bestSim >= 0.75) {
        matchedTokens += bestSim;
        partialBonus += 0.2;
      }
    }
  }

  const coverage = matchedTokens / queryTokens.length;
  const rawScore = coverage * 85 + partialBonus * 15;
  return Math.min(100, Math.round(rawScore));
}

/**
 * Perform fast local search across known presets and portfolio.
 * @param {string} query
 * @returns {Array<{ name: string, address: string, lat: number, lon: number, source: string, score: number, category: string }>}
 */
export function searchLocalCandidates(query) {
  const { tokens, inferredBrand } = normalizeSearchQuery(query);
  const effectiveQuery = inferredBrand || query;
  const candidates = [];

  // 1. Search CITY_POIS
  for (const [cityKey, cityData] of Object.entries(CITY_POIS)) {
    if (cityData?.pois) {
      for (const poi of cityData.pois) {
        const score = scoreMatchCandidate(tokens, poi.name, cityData.name);
        if (score >= 40) {
          candidates.push({
            id: `poi:${cityKey}:${poi.name}`,
            name: poi.name,
            address: `${cityData.name}, Landmark`,
            lat: poi.lat,
            lon: poi.lon,
            source: 'local-poi',
            score,
            category: 'Landmark',
          });
        }
      }
    }
  }

  // 2. Search Active Portfolio
  try {
    const portfolio = loadPortfolio();
    for (const site of portfolio) {
      const score = scoreMatchCandidate(tokens, site.name, site.address);
      if (score >= 40) {
        candidates.push({
          id: site.id,
          name: site.name,
          address: site.address,
          lat: site.lat,
          lon: site.lon,
          source: 'portfolio',
          score: Math.min(100, score + 10), // slight boost for active portfolio
          category: site.format || 'Business Site',
        });
      }
    }
  } catch {}

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Primary JARVIS Fuzzy Search function.
 * Resolves natural language or address queries into actionable geographic targets.
 * 
 * @param {string} query
 * @param {{ biasLat?: number, biasLon?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{
 *   success: boolean,
 *   bestMatch: object|null,
 *   matches: object[],
 *   jarvisReadout: string,
 *   confidencePct: number,
 *   source: string
 * }>}
 */
export async function executeJarvisFuzzySearch(query, { biasLat = 30.2672, biasLon = -97.7431, signal } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return {
      success: false,
      bestMatch: null,
      matches: [],
      jarvisReadout: '[JARVIS SEARCH] Query is empty.',
      confidencePct: 0,
      source: 'none',
    };
  }

  const { cleanQuery, tokens, isAddress, inferredBrand } = normalizeSearchQuery(trimmed);
  const targetSearchName = inferredBrand || cleanQuery;

  // 1. Check local candidates first
  const localHits = searchLocalCandidates(targetSearchName);
  if (localHits.length > 0 && localHits[0].score >= 85) {
    const best = localHits[0];
    return {
      success: true,
      bestMatch: best,
      matches: localHits,
      jarvisReadout: `[JARVIS TARGET IDENTIFIED] "${best.name}" (${best.address}) · Confidence: ${best.score}% [Source: ${best.source}]`,
      confidencePct: best.score,
      source: best.source,
    };
  }

  // 2. If it's an explicit address, try geocoding
  if (isAddress) {
    try {
      const geoResult = await geocodeAddress(cleanQuery, { signal });
      if (geoResult?.lat && geoResult?.lon) {
        const addrMatch = {
          id: `geocode:${geoResult.lat.toFixed(4)},${geoResult.lon.toFixed(4)}`,
          name: cleanQuery,
          address: geoResult.formattedAddress || cleanQuery,
          lat: geoResult.lat,
          lon: geoResult.lon,
          source: 'geocoder',
          score: 95,
          category: 'Address',
        };
        return {
          success: true,
          bestMatch: addrMatch,
          matches: [addrMatch, ...localHits],
          jarvisReadout: `[JARVIS ADDRESS ACQUIRED] ${addrMatch.address} · [${addrMatch.lat.toFixed(4)}, ${addrMatch.lon.toFixed(4)}] · Confidence: 95%`,
          confidencePct: 95,
          source: 'geocoder',
        };
      }
    } catch {}
  }

  // 3. Search upstream business places + Overpass
  try {
    const { sites, error } = await searchBusinessSites(targetSearchName, {
      biasLat,
      biasLon,
      signal,
    });

    if (sites.length > 0) {
      const mapped = sites.map((site) => {
        const score = scoreMatchCandidate(tokens, site.name, site.address);
        return {
          id: site.id,
          name: site.name,
          address: site.address,
          lat: site.lat,
          lon: site.lon,
          source: site.geocodeSource || 'places-api',
          score: Math.max(70, score),
          category: site.format || 'Commercial',
        };
      }).sort((a, b) => b.score - a.score);

      const best = mapped[0];
      const count = mapped.length;
      return {
        success: true,
        bestMatch: best,
        matches: mapped,
        jarvisReadout: `[JARVIS INTELLIGENCE] Found ${count} location${count > 1 ? 's' : ''} matching "${best.name}". Best target: ${best.address} · Confidence: ${best.score}%`,
        confidencePct: best.score,
        source: best.source,
      };
    }
  } catch {}

  // 4. Fallback to local hits if any existed with moderate score
  if (localHits.length > 0) {
    const best = localHits[0];
    return {
      success: true,
      bestMatch: best,
      matches: localHits,
      jarvisReadout: `[JARVIS APPROXIMATE MATCH] "${best.name}" (${best.address}) · Confidence: ${best.score}%`,
      confidencePct: best.score,
      source: best.source,
    };
  }

  return {
    success: false,
    bestMatch: null,
    matches: [],
    jarvisReadout: `[JARVIS ALERT] Unable to acquire target for "${cleanQuery}". No matching coordinates found.`,
    confidencePct: 0,
    source: 'none',
  };
}
