import test from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshteinDistance,
  stringSimilarity,
  normalizeSearchQuery,
  scoreMatchCandidate,
  searchLocalCandidates,
  executeJarvisFuzzySearch,
} from './fuzzySearchEngine.js';

test('levenshteinDistance computes accurate edit distances', () => {
  assert.equal(levenshteinDistance('starbucks', 'starbucks'), 0);
  assert.equal(levenshteinDistance('sturbucks', 'starbucks'), 1);
  assert.equal(levenshteinDistance('austn', 'austin'), 1);
  assert.equal(levenshteinDistance('', 'hello'), 5);
});

test('stringSimilarity returns normalized score between 0 and 1', () => {
  assert.equal(stringSimilarity('austin', 'austin'), 1.0);
  assert.ok(stringSimilarity('wholfoods', 'whole foods') > 0.6);
  assert.ok(stringSimilarity('starbux', 'starbucks') > 0.6);
  assert.ok(stringSimilarity('completely different', 'target') < 0.3);
});

test('normalizeSearchQuery strips intent words and recognizes addresses & brand typos', () => {
  const q1 = normalizeSearchQuery('show me where is sturbucks in austin');
  assert.equal(q1.inferredBrand, 'Starbucks');

  const q2 = normalizeSearchQuery('take me to 500 s congress ave');
  assert.equal(q2.isAddress, true);
  assert.ok(q2.tokens.includes('500'));
  assert.ok(q2.tokens.includes('south'));
  assert.ok(q2.tokens.includes('congress'));
  assert.ok(q2.tokens.includes('avenue'));

  const q3 = normalizeSearchQuery('find wholfoods market');
  assert.equal(q3.inferredBrand, 'Whole Foods Market');
});

test('scoreMatchCandidate matches tokens and handles partials', () => {
  const scoreHigh = scoreMatchCandidate(['frost', 'bank', 'tower'], 'Frost Bank Tower', 'Austin, TX');
  assert.ok(scoreHigh >= 85, `Expected score >= 85, got ${scoreHigh}`);

  const scorePartial = scoreMatchCandidate(['frost', 'austin'], 'Frost Bank Tower', 'Austin, TX');
  assert.ok(scorePartial >= 50, `Expected score >= 50, got ${scorePartial}`);
});

test('searchLocalCandidates finds known POIs in CITY_POIS', () => {
  const results = searchLocalCandidates('Texas State Capitol');
  assert.ok(results.length > 0);
  assert.equal(results[0].name, 'Texas State Capitol');
  assert.equal(results[0].source, 'local-poi');
});

test('executeJarvisFuzzySearch resolves known landmarks with JARVIS readout', async () => {
  const res = await executeJarvisFuzzySearch('take me to Texas State Capitol');
  assert.equal(res.success, true);
  assert.ok(res.bestMatch);
  assert.equal(res.bestMatch.name, 'Texas State Capitol');
  assert.match(res.jarvisReadout, /\[JARVIS TARGET IDENTIFIED\]/);
  assert.ok(res.confidencePct >= 85);
});
