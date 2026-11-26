// The campaign book: what is running and whether it is working.
//
// The rule this file protects is the separation of two different kinds of
// claim about one campaign. What it HAS DONE is measured — those redemptions
// happened. What it was SUPPOSED to do is modelled — a forecast with a
// prior-run count behind it. "Doing well" is the comparison of the two, and
// it means nothing if they are ever merged into a single number.
//
// Three consequences are pinned below:
//
//  - PACE IS PRORATED. A campaign three days into fourteen has not missed
//    its target by 78%. Every mid-flight verdict compares against the
//    forecast cut to the days elapsed.
//  - PROFIT OVERRIDES PACE. A campaign beating its redemption plan while
//    losing money is not "outperforming". Calling it that because the
//    coupon counter is high is the most expensive mistake this book could
//    make, so the verdict is overridden and the book is sorted by net.
//  - OVERLAPS ARE NAMED. Two campaigns chasing one segment pay twice for
//    one behaviour change, and neither can be read cleanly while the other
//    runs.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERDICTS, campaignBook, campaignTrend, findOverlaps, verdictFor } from './campaignBook.js';
import { memberBase } from './memberGraph.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store' };
const NOW = new Date('2026-09-21T14:40:00');

function book(site = SITE, now = NOW) {
  return campaignBook(site, { now, members: memberBase(site, { now }) });
}

test('verdict bands are ordered and leave a wide middle', () => {
  for (let i = 1; i < VERDICTS.length; i += 1) {
    assert.ok(VERDICTS[i - 1].min > VERDICTS[i].min, 'bands must descend');
  }
  // 94% of pace is not a failure, and telling an operator it is gets the
  // console ignored.
  assert.equal(verdictFor(0.94).id, 'on-plan');
  assert.equal(verdictFor(1.0).id, 'on-plan');
  assert.equal(verdictFor(1.3).id, 'outperforming');
  assert.equal(verdictFor(0.4).id, 'failing');
  assert.equal(verdictFor(NaN).id, 'on-plan', 'an unreadable pace defaults to no opinion');
});

test('the book is stable and every campaign is internally coherent', () => {
  assert.deepEqual(book(), book());
  const { campaigns } = book();
  assert.ok(campaigns.length >= 3 && campaigns.length <= 8);

  const ids = new Set();
  const mechanics = new Set();
  for (const campaign of campaigns) {
    assert.ok(!ids.has(campaign.campaignId));
    ids.add(campaign.campaignId);
    // Two of the same mechanic running at once is a mis-configuration, not
    // a plan.
    assert.ok(!mechanics.has(campaign.offerId), `${campaign.offerId} is running twice`);
    mechanics.add(campaign.offerId);

    assert.ok(campaign.daysElapsed >= 1 && campaign.daysElapsed <= campaign.plannedDays);
    assert.equal(campaign.series.length, campaign.daysElapsed);
    assert.equal(
      campaign.actual.redemptions,
      campaign.series.reduce((total, day) => total + day.redemptions, 0),
      'the headline total must be the sum of the daily series, not a separate number',
    );
    assert.equal(campaign.forecast.kind, 'modelled');
    assert.equal(campaign.actual.kind, 'measured');
    assert.ok(campaign.advice, 'a verdict without advice is an observation, not a decision');
  }
});

test('pace is measured against the forecast prorated to days elapsed', () => {
  for (const campaign of book().campaigns) {
    const expected = Math.max(
      1,
      Math.round(campaign.forecast.totalRedemptions * (campaign.daysElapsed / campaign.plannedDays)),
    );
    assert.equal(campaign.forecast.proratedToDate, expected);
    assert.ok(
      Math.abs(campaign.paceRatio - campaign.actual.redemptions / expected) < 0.002,
      'pace must be actual over the PRORATED forecast, never the full-run one',
    );
    // A day-3-of-14 campaign compared against a full-run forecast would read
    // as catastrophically behind on every single reading.
    if (campaign.daysElapsed < campaign.plannedDays / 3) {
      assert.ok(campaign.paceRatio > 0.2, 'an early campaign must not be condemned by proration');
    }
  }
});

test('a campaign beating its plan while losing money is not "outperforming"', () => {
  const losing = book().campaigns.filter((campaign) => campaign.actual.netGrossProfit < 0);
  for (const campaign of losing) {
    assert.equal(campaign.verdict, 'unprofitable');
    assert.equal(campaign.verdictTone, 'alert');
    if (campaign.paceRatio >= 1.05) {
      assert.match(campaign.verdictLabel, /losing money/i);
      assert.match(campaign.advice, /give|discount|audience/i, 'the advice must point at the give, not the volume');
    }
  }
  for (const campaign of book().campaigns) {
    if (campaign.actual.netGrossProfit >= 0) assert.notEqual(campaign.verdict, 'unprofitable');
  }
});

test('the book is ordered by what campaigns made, not by how many coupons moved', () => {
  const { campaigns } = book();
  for (let i = 1; i < campaigns.length; i += 1) {
    assert.ok(
      campaigns[i - 1].actual.netGrossProfit >= campaigns[i].actual.netGrossProfit,
      'sorting by redemptions would put the most expensive mistake at the top of the page',
    );
  }
});

test('the two answers to "which is best" are kept apart', () => {
  // The campaign making the most money and the campaign hitting its plan are
  // frequently not the same campaign, and the book must be able to say so.
  const result = book();
  assert.ok(result.best);
  assert.ok(result.fastestPace);
  const byPace = result.campaigns.slice().sort((a, b) => b.paceRatio - a.paceRatio)[0];
  assert.equal(result.fastestPace.campaignId, byPace.campaignId);
  if (result.biggestDrain) assert.ok(result.biggestDrain.actual.netGrossProfit < 0);
});

test('programme totals are the sum of the book', () => {
  const result = book();
  const summed = result.campaigns.reduce((total, campaign) => total + campaign.actual.redemptions, 0);
  assert.equal(result.totals.redemptions, summed);
  assert.ok(
    Math.abs(result.totals.marginGive - result.campaigns.reduce((t, c) => t + c.actual.marginGive, 0)) < 0.5,
  );
  if (result.totals.marginGive > 0) {
    assert.ok(Math.abs(result.totals.programReturn - result.totals.netGrossProfit / result.totals.marginGive) < 0.01);
  }
});

test('a trend distinguishes ordinary novelty decay from a collapse', () => {
  assert.equal(campaignTrend([]).direction, 'too-early');
  assert.equal(campaignTrend([{ redemptions: 5 }, { redemptions: 4 }]).direction, 'too-early');

  const steady = campaignTrend(Array.from({ length: 9 }, () => ({ redemptions: 40 })));
  assert.equal(steady.direction, 'steady');
  assert.equal(steady.changePct, 0);

  const collapse = campaignTrend([
    { redemptions: 100 }, { redemptions: 90 }, { redemptions: 80 },
    { redemptions: 40 }, { redemptions: 20 }, { redemptions: 10 },
  ]);
  assert.equal(collapse.direction, 'collapsing');
  assert.ok(collapse.changePct < -28);

  const building = campaignTrend([
    { redemptions: 10 }, { redemptions: 12 }, { redemptions: 20 },
    { redemptions: 30 }, { redemptions: 40 }, { redemptions: 50 },
  ]);
  assert.equal(building.direction, 'building');
});

test('campaigns competing for the same members are named', () => {
  const rows = [
    { campaignId: 'A', name: 'A', status: 'live', objective: 'basket-build', audience: { segmentId: 'fuel-only', label: 'Fuel-only commuters' } },
    { campaignId: 'B', name: 'B', status: 'live', objective: 'basket-build', audience: { segmentId: 'fuel-only', label: 'Fuel-only commuters' } },
    { campaignId: 'C', name: 'C', status: 'live', objective: 'winback', audience: { segmentId: 'app-native', label: 'App-native' } },
    { campaignId: 'D', name: 'D', status: 'ended', objective: 'basket-build', audience: { segmentId: 'fuel-only', label: 'Fuel-only commuters' } },
  ];
  const overlaps = findOverlaps(rows);
  assert.equal(overlaps.length, 1, 'only LIVE campaigns can be competing right now');
  assert.deepEqual(overlaps[0].campaigns, ['A', 'B']);
  assert.equal(overlaps[0].sameObjective, true);
  assert.match(overlaps[0].note, /Neither can be read cleanly/);

  assert.equal(findOverlaps([{ ...rows[0], audience: { segmentId: null, label: 'All' } }, rows[1]]).length, 0);
});

test('a store with no kitchen never runs a foodservice campaign', () => {
  const kiosk = { id: 'site:urban:9', name: 'City Kiosk', format: 'urban kiosk' };
  const result = campaignBook(kiosk, { now: NOW, members: memberBase(kiosk, { now: NOW }) });
  for (const campaign of result.campaigns) {
    assert.notEqual(campaign.category, 'carwash');
  }
});
