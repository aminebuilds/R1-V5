// Agent result -> composed board -> rendered DOM, end to end.
//
// This file exists because of a bug that every other test in the repo
// missed. The composer tests call `composeForAction(action, {})` with an
// empty payload, which correctly short-circuits to a gap block — and so
// never reached the line where a formatter was used but not imported. The
// unit tests were green, the build was green, and the board threw
// "fmtPct is not defined" the first time a real result reached it.
//
// So: real engine output, every store-agent action, all the way through the
// composer and into a DOM stub. No mock payloads — the whole point is that
// the shapes are the ones the engines actually produce, so a field rename in
// `src/storeAgent/` that a composer still reads by the old name fails here
// rather than in front of someone.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSED_ACTIONS, composeForAction } from '../explain/composers.js';
import { validateBlocks } from '../explain/blocks.js';
import { renderBlock } from '../explain/render.js';
import {
  campaignPerformance,
  memberIntelligence,
  publishOffer,
  recommendOffers,
  stageOffer,
  storePerformance,
  storePulse,
} from './storeAgent.js';
import { clearOffers } from './offerRegistry.js';

const SITE = { id: 'site:test:001', name: 'Test Fuel #1204', externalRef: '1204', format: 'c-store', lat: 30.26, lon: -97.74 };
const NOW = new Date('2026-09-21T14:40:00');
const CONTEXT = {
  now: NOW,
  weather: { tempC: 31, condition: 'CLEAR', precipMm: 0 },
  traffic: { bottleneckCount: 3, closureCount: 1, maxDelayMinutes: 12 },
  competitors: [{ name: 'Circle K', distanceKm: 0.8 }],
};

/** Minimal DOM, including the SVG namespace the creative block draws into. */
function makeDoc() {
  const make = (tagName, namespace = null) => {
    const node = {
      tagName,
      namespace,
      className: '',
      textContent: '',
      title: '',
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      appendChild(child) { node.children.push(child); return child; },
      append(...nodes) { for (const child of nodes) node.appendChild(child); },
      setAttribute(name, value) { node.attributes[name] = String(value); },
      addEventListener() {},
    };
    return node;
  };
  return {
    createElement: (tag) => make(tag),
    createElementNS: (ns, tag) => make(tag, ns),
  };
}

/** Walk a rendered tree and collect every text node value. */
function textOf(node, out = []) {
  if (node.textContent) out.push(String(node.textContent));
  for (const child of node.children || []) textOf(child, out);
  return out;
}

function countTags(node, tag, total = 0) {
  if (node.tagName === tag) total += 1;
  for (const child of node.children || []) total = countTags(child, tag, total);
  return total;
}

/** Every store-agent action paired with a REAL result from the engines. */
function liveResults() {
  clearOffers();
  const staged = stageOffer(SITE, {
    offerId: 'coffee-99', surfaces: ['canopy', 'pump-topper', 'in-store-menu', 'mobile-app', 'register-prompt', 'e-receipt'], durationDays: 3,
  }, CONTEXT);
  return [
    ['get_store_performance', storePerformance(SITE, { ...CONTEXT, period: 'week' })],
    ['get_store_pulse', storePulse(SITE, CONTEXT)],
    ['get_member_intelligence', memberIntelligence(SITE, CONTEXT)],
    ['get_member_intelligence', memberIntelligence(SITE, { ...CONTEXT, focus: 'member', segmentId: 'lapsing-high-value' })],
    ['get_member_intelligence', memberIntelligence(SITE, { ...CONTEXT, focus: 'identity', signals: ['payment', 'device'] })],
    ['get_member_intelligence', memberIntelligence(SITE, { ...CONTEXT, focus: 'identity', signals: ['loyalty'] })],
    ['get_campaign_performance', campaignPerformance(SITE, CONTEXT)],
    ['recommend_offer', recommendOffers(SITE, CONTEXT)],
    ['create_offer', staged],
    ['deploy_offer', { ...staged, ...publishOffer({ offerId: staged.offerId, now: NOW }) }],
  ];
}

test('every store-agent result composes into a valid board and renders', () => {
  for (const [action, result] of liveResults()) {
    const blocks = composeForAction(action, result, { question: 'test', scope: 'test scope' });
    assert.ok(blocks.length > 1, `${action} produced no board`);
    assert.equal(blocks[0].type, 'head', `${action} must open with a head block`);

    const validity = validateBlocks(blocks);
    assert.ok(validity.ok, `${action} produced invalid blocks: ${validity.problems.join('; ')}`);

    // A board that composed but cannot be drawn is not a board. This is the
    // step that catches a missing import or a renderer that was never wired
    // into the dispatch table.
    const doc = makeDoc();
    for (const block of blocks) {
      const node = renderBlock(block, { doc });
      assert.ok(node, `${action}: block type "${block.type}" has no renderer`);
      assert.ok(node.children.length > 0, `${action}: "${block.type}" rendered empty`);
    }
  }
});

test('no board ever prints undefined, NaN or [object Object]', () => {
  for (const [action, result] of liveResults()) {
    const doc = makeDoc();
    for (const block of composeForAction(action, result, { question: 'test' })) {
      const node = renderBlock(block, { doc });
      for (const text of textOf(node)) {
        assert.ok(!/undefined|NaN|\[object Object\]/.test(text), `${action}/${block.type} printed: ${text}`);
      }
    }
  }
});

test('the creative board draws a real advertisement for every surface', () => {
  clearOffers();
  const staged = stageOffer(SITE, {
    offerId: 'coffee-99',
    surfaces: ['canopy', 'pump-topper', 'in-store-menu', 'mobile-app', 'register-prompt', 'e-receipt'],
    durationDays: 3,
  }, CONTEXT);

  const blocks = composeForAction('create_offer', staged, { question: 'build it' });
  const creative = blocks.find((block) => block.type === 'creative');
  assert.ok(creative, 'creating an offer must put the artwork on screen');
  assert.equal(creative.cards.length, 6, 'one composition per requested surface');

  const doc = makeDoc();
  const node = renderBlock(creative, { doc });
  assert.ok(countTags(node, 'svg') === 6, 'every surface must draw its own canvas');
  // Copy is written per surface, so the six headlines are not six copies of
  // one string.
  assert.ok(new Set(creative.cards.map((card) => card.headline)).size > 1);
  const drawn = textOf(node).join(' ');
  assert.ok(drawn.includes('99c'), 'the offer value must appear in the artwork');
});

test('a campaign board keeps measured and modelled in separate columns', () => {
  const blocks = composeForAction('get_campaign_performance', campaignPerformance(SITE, CONTEXT), {});
  const campaigns = blocks.find((block) => block.type === 'campaigns');
  assert.ok(campaigns && campaigns.rows.length > 0);

  for (const row of campaigns.rows) {
    assert.ok(row.measured.length > 0, 'a campaign row must say what it has done');
    assert.ok(row.forecast.length > 0, 'a campaign row must say what it was meant to do');
    // The two must never be the same list — that would be the merge this
    // whole design exists to prevent.
    assert.notDeepEqual(row.measured, row.forecast);
  }
  assert.match(campaigns.note, /never blended/i);

  const doc = makeDoc();
  const rendered = textOf(renderBlock(campaigns, { doc })).join(' ');
  assert.ok(rendered.includes('Done') && rendered.includes('Planned'), 'both columns must be labelled on screen');
  assert.ok(rendered.includes('Measured') && rendered.includes('Modelled'), 'each column carries its own provenance chip');
});

test('a partial day is drawn as incomplete, not as a bad day', () => {
  const blocks = composeForAction('get_store_performance', storePerformance(SITE, { ...CONTEXT, period: 'week' }), {});
  const daily = blocks.find((block) => block.type === 'series');
  assert.ok(daily);
  const today = daily.points[daily.points.length - 1];
  assert.equal(today.partial, true);
  assert.equal(today.sub, 'to date');
  assert.match(daily.note, /incomplete/i);
});

test('every action the console advertises still has a composer', () => {
  // Guards against adding a tool and a handler but forgetting the board.
  for (const action of [
    'get_store_performance', 'get_store_pulse', 'get_member_intelligence',
    'get_campaign_performance', 'recommend_offer', 'create_offer', 'deploy_offer',
  ]) {
    assert.ok(COMPOSED_ACTIONS.includes(action), `${action} would open no board`);
  }
});
