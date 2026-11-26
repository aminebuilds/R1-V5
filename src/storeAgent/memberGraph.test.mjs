// Segments, member profiles, and the identity bridge.
//
// Two things here are worth pinning.
//
// SEGMENTS STAY BEHAVIOURAL. Every segment is defined by what a member does
// at the pump and the register — frequency, attachment, daypart, recency.
// That is what an operator can act on, and it is the line this product does
// not cross: no segment may be built on an inferred protected attribute.
// The test below is a structural guard, not a substitute for review.
//
// IDENTITY RESOLUTION STAYS PROBABILISTIC. Confidence compounds across
// independent signals rather than summing, a single weak signal never
// resolves on its own, and a match below the auto-merge bar is returned as a
// review candidate with `applied: false`. "We think that might have been
// Marcus" and "that was Marcus" justify very different actions, and the
// difference must survive all the way to the narration.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_MERGE_CONFIDENCE,
  SEGMENTS,
  TIERS,
  memberBase,
  memberProfile,
  nextBestAction,
  resolveIdentity,
  segmentById,
} from './memberGraph.js';
import { storeProfile } from './storeLedger.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store' };
const NOW = new Date('2026-09-21T14:40:00');

test('the segment definitions are coherent and shares are plausible', () => {
  const total = SEGMENTS.reduce((sum, segment) => sum + segment.share, 0);
  assert.ok(Math.abs(total - 1) < 0.02, `segment shares should cover the file, got ${total}`);
  const ids = new Set();
  for (const segment of SEGMENTS) {
    assert.ok(!ids.has(segment.id), `duplicate segment ${segment.id}`);
    ids.add(segment.id);
    assert.ok(segment.thesis && segment.thesis.length > 20, `${segment.id} has no usable thesis`);
    assert.ok(segment.attachRate >= 0 && segment.attachRate <= 1);
    assert.ok(segment.redemptionRate > 0 && segment.redemptionRate < 1);
    assert.ok(['low', 'medium', 'critical'].includes(segment.churnRisk));
    assert.equal(segmentById(segment.id), segment);
  }
  assert.equal(segmentById('not-a-segment'), null);
});

test('no segment is defined on an inferred personal attribute', () => {
  // A structural guard. Every segment must describe behaviour at the store,
  // and the words below have no business defining one.
  const forbidden = /\b(age|aged|gender|male|female|race|ethnic\w*|religio\w*|income bracket|marital|disab\w*|pregnan\w*|orientation)\b/i;
  for (const segment of SEGMENTS) {
    const text = `${segment.id} ${segment.label} ${segment.thesis}`;
    assert.ok(!forbidden.test(text), `${segment.id} reads as a demographic cut: ${segment.thesis}`);
  }
});

test('the loyalty file is internally consistent', () => {
  const base = memberBase(SITE, { now: NOW });
  const profile = storeProfile(SITE);

  assert.equal(base.enrolled, profile.loyaltyEnrolled);
  assert.ok(base.active30 < base.active90, 'the 30-day active set is inside the 90-day one');
  assert.ok(base.active90 <= base.enrolled);
  assert.equal(base.lapsed, base.enrolled - base.active90);
  assert.ok(base.pushOptIn <= base.appInstalled, 'you cannot opt into push without the app');
  assert.ok(base.appInstalled <= base.enrolled);
  assert.equal(base.segments.length, SEGMENTS.length);

  for (const segment of base.segments) {
    assert.ok(segment.members > 0);
    assert.ok(segment.reachable.push <= segment.members);
    assert.ok(segment.reachable.inStore === segment.members, 'everyone is reachable in the store');
  }
});

test('segments rank by gross profit, which is not the same order as spend', () => {
  const base = memberBase(SITE, { now: NOW });
  for (let i = 1; i < base.segments.length; i += 1) {
    assert.ok(
      base.segments[i - 1].monthlyGrossProfit >= base.segments[i].monthlyGrossProfit,
      'the file must be ranked by gross profit contribution',
    );
  }
  // Nicotine is the canonical case: highest spend per member, thinnest
  // margin. Ranking by revenue would put it top and mislead the operator
  // about where the money actually is.
  const nicotine = base.segments.find((segment) => segment.id === 'nicotine-loyal');
  assert.ok(nicotine.monthlyValuePerMember > 100);
  assert.ok(
    nicotine.monthlyGrossProfit / nicotine.members < nicotine.monthlyValuePerMember * 0.55,
    'nicotine must convert spend into gross profit at a poor rate',
  );
});

test('a member profile is stable and self-consistent', () => {
  const a = memberProfile(SITE, { segmentId: 'app-native', memberId: 'LM-424242', now: NOW });
  const b = memberProfile(SITE, { segmentId: 'app-native', memberId: 'LM-424242', now: NOW });
  assert.deepEqual(a, b);

  assert.ok(TIERS.includes(a.tier));
  assert.equal(a.segmentId, 'app-native');
  assert.ok(a.behaviour.visits90 >= 0);
  assert.ok(a.value.churnProbability90d > 0 && a.value.churnProbability90d < 1);
  assert.ok(a.identities.some((identity) => identity.kind === 'loyalty'));
  assert.ok(a.identities.every((identity) => identity.confidence > 0 && identity.confidence <= 1));
  assert.ok(a.nextBestAction.action && a.nextBestAction.rationale);
});

test('a lapsing member reads as lapsed and gets the winback action', () => {
  const lapsing = memberProfile(SITE, { segmentId: 'lapsing-high-value', now: NOW });
  assert.ok(lapsing.lastVisitDaysAgo > 30, 'a lapsing member has not been in for over a month');
  assert.equal(lapsing.value.churnRisk, 'critical');
  assert.match(lapsing.nextBestAction.action, /Winback/i);
  assert.equal(lapsing.nextBestAction.urgency, 'high');
});

test('next best action is one action, chosen from the segment thesis', () => {
  assert.match(nextBestAction(segmentById('fuel-only'), 2).action, /beverage/i);
  assert.equal(nextBestAction(segmentById('fuel-only'), 2).surface, 'pump-topper');
  assert.match(nextBestAction(segmentById('app-native'), 1).action, /push/i);
  // Recency overrides the segment: anyone gone a month is a winback.
  assert.match(nextBestAction(segmentById('app-native'), 45).action, /Winback/i);
});

test('identity confidence compounds across independent signals and never sums past 1', () => {
  const two = resolveIdentity(SITE, { signals: ['device', 'geofence'], transactionRef: 'T1', now: NOW });
  // 0.48 and 0.18 independently: 1 - (0.52 x 0.82) = 0.574, not 0.66.
  assert.ok(Math.abs(two.confidence - 0.574) < 0.01, `expected compounding, got ${two.confidence}`);

  const many = resolveIdentity(SITE, {
    signals: ['payment', 'device', 'phone', 'email', 'plate'], transactionRef: 'T2', now: NOW,
  });
  assert.ok(many.confidence < 1, 'confidence approaches certainty but never reaches it');
  assert.ok(many.confidence > two.confidence);
});

test('a scanned loyalty card resolves outright; a weak signal alone does not', () => {
  const scanned = resolveIdentity(SITE, { signals: ['loyalty'], transactionRef: 'T3', now: NOW });
  assert.equal(scanned.confidence, 1);
  assert.equal(scanned.applied, true);

  const weak = resolveIdentity(SITE, { signals: ['basket-pattern'], transactionRef: 'T4', now: NOW });
  assert.ok(weak.confidence < AUTO_MERGE_CONFIDENCE);
  assert.equal(weak.applied, false, 'one weak signal must never write to a member record');
  assert.match(weak.reason, /review candidate/i);
});

test('a transaction with nothing to match on stays anonymous rather than guessing', () => {
  const none = resolveIdentity(SITE, { signals: [], transactionRef: 'T5', now: NOW });
  assert.equal(none.resolved, false);
  assert.equal(none.applied, false);
  assert.equal(none.member, null);
  assert.equal(none.confidence, 0);
  assert.match(none.reason, /stays anonymous/);
});

test('the bridge reports its programme-level effect honestly', () => {
  const resolved = resolveIdentity(SITE, { signals: ['payment', 'device'], transactionRef: 'T6', now: NOW });
  const effect = resolved.programmeEffect;
  assert.ok(effect.recoveredPerDay > 0);
  assert.ok(effect.recoveredPerDay < effect.anonymousTransactionsPerDay, 'the bridge recovers a share, never all of it');
  assert.ok(effect.identifiedShareAfter > effect.identifiedShareBefore);
  assert.ok(effect.identifiedShareAfter < 100);
});
