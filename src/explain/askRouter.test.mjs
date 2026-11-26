// Typed question → action.
//
// The test that matters most is the last one: an unroutable question must
// return `action: null`. A router that guesses would hand "what is my rent"
// to the traffic engine and produce a confident board about the wrong thing.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, routeAnalystQuery, routeQuestion, SUGGESTIONS } from './askRouter.js';

test('operator questions route to the engine that answers them', () => {
  const cases = [
    ['Where is a promo worth running right now?', 'get_cool_off_opportunities'],
    ['what should I run today', 'get_cool_off_opportunities'],
    ['what will fuel cost me in two weeks', 'get_fuel_price_outlook'],
    ['who are my competitors here', 'analyze_competitors'],
    ['how is my whole portfolio doing', 'get_portfolio_health'],
    ['any construction near my stores', 'get_traffic_delays_and_construction'],
    ['how is this view doing', 'get_view_health'],
    ['how busy is the Strait of Hormuz right now', 'inspect_chokepoint'],
    ['what is happening at this chokepoint', 'inspect_chokepoint'],
  ];
  for (const [question, action] of cases) {
    assert.equal(routeQuestion(question).action, action, question);
  }
});

test('a store question carries its own specifics through as arguments', () => {
  // The typed front door must not lose what the sentence said. "Build me a
  // 99 cent coffee offer" that arrives at the offer studio as `{}` builds
  // whatever ranks first, and the operator watches a fountain drink appear.
  const build = routeQuestion('build me a 99 cent coffee offer');
  assert.equal(build.action, 'create_offer');
  assert.equal(build.args.description, 'build me a 99 cent coffee offer');

  assert.equal(routeQuestion('how did the store do today').args.period, 'today');
  assert.equal(routeQuestion('how is this store doing this week').args.period, 'week');
  assert.equal(routeQuestion('how was the store this month').args.period, 'month');

  assert.equal(routeQuestion('who is on the loyalty file').args.focus, 'segments');
  assert.equal(routeQuestion('show me a member').args.focus, 'member');
  assert.equal(routeQuestion('can you identify that transaction').args.focus, 'identity');
});

test('a named chokepoint in the question is passed through as an argument', () => {
  const hormuz = routeQuestion('how busy is the strait of hormuz right now');
  assert.equal(hormuz.action, 'inspect_chokepoint');
  assert.equal(hormuz.args.chokepoint, 'hormuz');

  const malacca = routeQuestion('what will fuel cost given traffic through the strait of malacca');
  assert.equal(malacca.action, 'get_fuel_price_outlook');
  assert.equal(malacca.args.chokepoint, 'malacca');

  const noName = routeQuestion('what will fuel cost me in two weeks');
  assert.equal(noName.action, 'get_fuel_price_outlook');
  assert.equal(noName.args.chokepoint, undefined);
});

test('the more specific intent wins when two patterns could match', () => {
  // "promo" and "traffic" both appear; the recommendation is what was asked for.
  assert.equal(routeQuestion('should I run a promo given this traffic?').action, 'get_cool_off_opportunities');
  // "portfolio" beats the generic health phrasing.
  assert.equal(routeQuestion('how is my portfolio doing').action, 'get_portfolio_health');
});

test('counting questions over a rendered layer become a structured analyst query', () => {
  const routed = routeQuestion('how many ships in view');
  assert.equal(routed.action, 'analyst_query');
  assert.deepEqual(routed.args.layers, ['ais-live-vessels']);
  assert.deepEqual(routed.args.scope, { kind: 'view' });

  const global = routeQuestion('how many tankers worldwide');
  assert.deepEqual(global.args.scope, { kind: 'anywhere' });
});

test('a counting question with no known layer is not forced into an analyst query', () => {
  assert.equal(routeAnalystQuery('how many customers do I have'), null);
});

test('an unroutable question declines instead of guessing', () => {
  const routed = routeQuestion('what is my commercial rent this quarter');
  assert.equal(routed.action, null);
  assert.equal(routed.matched, null);
  assert.equal(routed.question, 'what is my commercial rent this quarter');
});

test('empty input declines', () => {
  assert.equal(routeQuestion('   ').action, null);
  assert.equal(routeQuestion(undefined).action, null);
});

test('every advertised suggestion actually routes', () => {
  for (const suggestion of SUGGESTIONS) {
    assert.ok(routeQuestion(suggestion).action, `"${suggestion}" must be answerable`);
  }
});

test('intents are ordered specific-first and reference real actions', () => {
  const actions = INTENTS.map((intent) => intent.action);
  assert.equal(new Set(actions).size, actions.length, 'one intent per action');
  assert.ok(actions.indexOf('get_view_health') === actions.length - 1, 'the catch-all health intent is last');
});
