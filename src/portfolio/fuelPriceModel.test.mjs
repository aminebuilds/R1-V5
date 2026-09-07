import test from 'node:test';
import assert from 'node:assert/strict';

import {
  alignSeries,
  backtest,
  describeModel,
  fitPassThrough,
  forecastPassThrough,
  ordinaryLeastSquares,
  seasonTerm,
  solveLinearSystem,
} from './fuelPriceModel.js';

/**
 * Build a weekly aligned series where retail responds to spot with a KNOWN
 * asymmetric lag structure, so the fit can be checked against ground truth
 * rather than merely "produced a number".
 */
function syntheticSeries({
  weeks = 400,
  upCoefficients = [0.010, 0.006, 0.003],
  downCoefficients = [0.004, 0.002, 0.001],
  noise = 0,
} = {}) {
  // Deterministic pseudo-random spot walk — a fixed LCG, so the test is stable.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };

  const rows = [];
  let spot = 70;
  let retail = 3.0;
  const spotMoves = [];

  for (let i = 0; i < weeks; i++) {
    const move = rand() * 6;
    spot = Math.max(20, spot + move);
    spotMoves.push(move);

    let delta = 0;
    for (let k = 0; k < upCoefficients.length; k++) {
      const past = spotMoves[spotMoves.length - 1 - k];
      if (past === undefined) continue;
      delta += past > 0 ? upCoefficients[k] * past : downCoefficients[k] * past;
    }
    if (noise) delta += rand() * noise;
    retail = Math.max(1, retail + delta);

    const date = new Date(Date.UTC(2015, 0, 5) + i * 7 * 86400000);
    rows.push({ period: date.toISOString().slice(0, 10), retail, spot });
  }
  return rows;
}

test('solveLinearSystem solves a small system', () => {
  const solution = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
  assert.ok(Math.abs(solution[0] - 1) < 1e-9);
  assert.ok(Math.abs(solution[1] - 3) < 1e-9);
});

test('solveLinearSystem returns null for a singular system', () => {
  assert.equal(solveLinearSystem([[1, 2], [2, 4]], [3, 6]), null);
});

test('ordinaryLeastSquares recovers a known linear relationship', () => {
  // y = 2 + 3x
  const design = [];
  const target = [];
  for (let x = 0; x < 20; x++) {
    design.push([1, x]);
    target.push(2 + 3 * x);
  }
  const coefficients = ordinaryLeastSquares(design, target);
  assert.ok(Math.abs(coefficients[0] - 2) < 1e-6);
  assert.ok(Math.abs(coefficients[1] - 3) < 1e-6);
});

test('ordinaryLeastSquares refuses an underdetermined system', () => {
  assert.equal(ordinaryLeastSquares([[1, 2, 3]], [1]), null);
  assert.equal(ordinaryLeastSquares([], []), null);
});

test('seasonTerm marks the summer RVP window only', () => {
  assert.equal(seasonTerm('2026-07-15'), 1);
  assert.equal(seasonTerm('2026-06-01'), 1);
  assert.equal(seasonTerm('2026-09-30'), 1);
  assert.equal(seasonTerm('2026-01-15'), 0);
  assert.equal(seasonTerm('2026-10-01'), 0);
  assert.equal(seasonTerm(''), 0);
});

test('alignSeries pairs each retail print with the latest preceding spot', () => {
  const aligned = alignSeries(
    [{ period: '2026-01-05', value: 3.1 }, { period: '2026-01-12', value: 3.2 }],
    [
      { period: '2026-01-02', value: 70 },
      { period: '2026-01-04', value: 71 },
      { period: '2026-01-09', value: 75 },
    ],
  );
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].spot, 71, 'the 04th print, not the 02nd');
  assert.equal(aligned[1].spot, 75);
});

test('alignSeries drops retail prints with no preceding spot', () => {
  const aligned = alignSeries(
    [{ period: '2026-01-05', value: 3.1 }],
    [{ period: '2026-02-01', value: 70 }],
  );
  assert.deepEqual(aligned, []);
});

test('fitPassThrough refuses to fit a short history', () => {
  const fit = fitPassThrough(syntheticSeries({ weeks: 20 }));
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /at least/);
  assert.equal(fit.passThroughUp, 0);
});

test('fitPassThrough recovers a known asymmetry from synthetic truth', () => {
  const fit = fitPassThrough(syntheticSeries(), { maxLag: 6 });
  assert.equal(fit.ok, true);

  // Ground truth: up coefficients sum to 0.019, down to 0.007.
  assert.ok(Math.abs(fit.passThroughUp - 0.019) < 0.004,
    `expected ~0.019 up, got ${fit.passThroughUp}`);
  assert.ok(Math.abs(fit.passThroughDown - 0.007) < 0.004,
    `expected ~0.007 down, got ${fit.passThroughDown}`);

  // And the asymmetry — the thing the model exists to capture — is positive.
  assert.ok(fit.asymmetry > 0.005, `expected a clear positive asymmetry, got ${fit.asymmetry}`);
});

test('fitPassThrough finds no asymmetry when the truth is symmetric', () => {
  const symmetric = syntheticSeries({
    upCoefficients: [0.008, 0.004, 0.002],
    downCoefficients: [0.008, 0.004, 0.002],
  });
  const fit = fitPassThrough(symmetric, { maxLag: 6 });
  assert.equal(fit.ok, true);
  // A model that "finds" asymmetry in symmetric data would be worse than
  // useless — it would justify a pricing play that has no basis.
  assert.ok(Math.abs(fit.asymmetry) < 0.004, `expected ~0 asymmetry, got ${fit.asymmetry}`);
});

test('forecastPassThrough returns a band, never a bare point', () => {
  const rows = syntheticSeries({ noise: 0.01 });
  const fit = fitPassThrough(rows);
  const forecast = forecastPassThrough(fit, rows, { weeks: 4 });
  assert.equal(forecast.ok, true);
  assert.equal(forecast.points.length, 4);
  for (const point of forecast.points) {
    assert.ok(point.low <= point.central, 'low must not exceed central');
    assert.ok(point.high >= point.central, 'high must not fall below central');
  }
});

test('the forecast band widens with the horizon', () => {
  const rows = syntheticSeries({ noise: 0.02 });
  const fit = fitPassThrough(rows);
  const { points } = forecastPassThrough(fit, rows, { weeks: 4 });
  const width = (p) => p.high - p.low;
  assert.ok(width(points[3]) > width(points[0]), 'week 4 must be less certain than week 1');
});

test('the disruption overlay widens the band UPWARD only and never moves the centre', () => {
  const rows = syntheticSeries({ noise: 0.02 });
  const fit = fitPassThrough(rows);
  const calm = forecastPassThrough(fit, rows, { weeks: 4, disruptionIndex: 10 });
  const stressed = forecastPassThrough(fit, rows, { weeks: 4, disruptionIndex: 90 });

  for (let i = 0; i < 4; i++) {
    assert.equal(stressed.points[i].central, calm.points[i].central,
      'risk must not move the central path — the claim is "risk rose", not "price will rise"');
    assert.equal(stressed.points[i].low, calm.points[i].low, 'the lower bound is untouched');
    assert.ok(stressed.points[i].high > calm.points[i].high, 'the upper bound widens');
  }
  assert.ok(stressed.riskWidenedCents > 0);
  assert.equal(stressed.confidence, 'modelled-with-risk-overlay');
  assert.equal(calm.confidence, 'modelled');
});

test('forecastPassThrough reports its own failure on an unfitted model', () => {
  const forecast = forecastPassThrough({ ok: false, reason: 'nope' }, []);
  assert.equal(forecast.ok, false);
  assert.equal(forecast.confidence, 'unavailable');
  assert.deepEqual(forecast.points, []);
});

test('backtest beats a flat-price baseline on data with real structure', () => {
  const rows = syntheticSeries({ weeks: 500, noise: 0.005 });
  const result = backtest(rows, { holdoutWeeks: 104 });
  assert.equal(result.ok, true);
  assert.ok(result.modelMaeCents > 0);
  assert.ok(result.naiveMaeCents > 0);
  assert.equal(result.beatsNaive, true, `model ${result.modelMaeCents}¢ vs naive ${result.naiveMaeCents}¢`);
  assert.ok(result.improvementPct > 0);
});

test('backtest refuses a holdout it cannot support', () => {
  const result = backtest(syntheticSeries({ weeks: 60 }), { holdoutWeeks: 104 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /need \d+ aligned observations/);
  assert.equal(result.beatsNaive, false);
});

test('backtest trains only on pre-holdout data', () => {
  const rows = syntheticSeries({ weeks: 400 });
  const result = backtest(rows, { holdoutWeeks: 104 });
  assert.equal(result.trainedOn, rows.length - 104);
});

test('describeModel states plainly when the model loses to naive', () => {
  const line = describeModel(
    { ok: true, observations: 300, maxLag: 6, passThroughUp: 0.02, passThroughDown: 0.01, asymmetry: 0.01 },
    { ok: true, beatsNaive: false, modelMaeCents: 9.1, naiveMaeCents: 7.4, improvementPct: -23 },
  );
  assert.match(line, /DOES NOT beat a flat-price baseline/);
});

test('describeModel flags a missing upward asymmetry as suspicious', () => {
  const line = describeModel(
    { ok: true, observations: 300, maxLag: 6, passThroughUp: 0.01, passThroughDown: 0.02, asymmetry: -0.01 },
    { ok: false, reason: 'no holdout' },
  );
  assert.match(line, /unusual, treat the fit with suspicion/);
  assert.match(line, /not validated/);
});

test('describeModel reports an unfitted model as unfitted', () => {
  assert.match(describeModel({ ok: false, reason: 'too short' }, null), /not fitted: too short/);
});
