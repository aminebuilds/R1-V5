/**
 * @file The fuel-price pass-through model.
 *
 * Deliberately NOT machine learning. A transparent lagged regression on free
 * EIA history captures most of the explainable variance, fits in milliseconds
 * in the browser, and — the part that actually matters commercially — can show
 * its own coefficients on screen. A gradient-boosted model an operator cannot
 * interrogate is worth less to them than a linear one they can argue with.
 *
 * Three layers, each inspectable on its own:
 *
 *   L1 ANCHOR   The regional weekly retail price, straight from EIA. Not a
 *               prediction — the ground-truth level everything else is
 *               expressed relative to.
 *
 *   L2 LEAD     Pump prices follow crude/wholesale spot with a lag, and
 *               ASYMMETRICALLY: increases pass through faster and more
 *               completely than decreases. Fitting separate positive and
 *               negative coefficients is the whole trick — the asymmetry is
 *               the signal, and a symmetric model throws it away.
 *
 *   L3 RISK     Not a price forecast. A widening of the upper band, driven by
 *               a disruption index (see disruptionIndex.js). The claim made is
 *               "risk has risen", never "the price will be $X".
 *
 * Validation is not optional here: `backtest()` reports mean absolute error in
 * cents/gallon against a naive "price stays flat" baseline, and the caller is
 * expected to put that number on screen next to the forecast. A model that
 * cannot beat naive must say so.
 *
 * @module portfolio/fuelPriceModel
 */

/** Weeks of lag the regression considers. */
export const DEFAULT_MAX_LAG = 6;

/**
 * Solve a least-squares system via Gaussian elimination with partial pivoting.
 *
 * Small, dense, and well-conditioned at this size (≤ 15 columns), so the
 * normal equations are fine and a QR implementation would be ceremony.
 * @param {number[][]} matrix Square coefficient matrix (mutated).
 * @param {number[]} rhs Right-hand side (mutated).
 * @returns {number[]|null} Solution, or null when the system is singular.
 */
export function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(matrix[pivotRow][col]) < 1e-12) return null;
    if (pivotRow !== col) {
      [matrix[col], matrix[pivotRow]] = [matrix[pivotRow], matrix[col]];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]];
    }
    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row][col] / matrix[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) matrix[row][k] -= factor * matrix[col][k];
      rhs[row] -= factor * rhs[col];
    }
  }
  const out = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * out[k];
    out[row] = sum / matrix[row][row];
  }
  return out;
}

/**
 * Ordinary least squares via the normal equations. `design` includes its own
 * intercept column if one is wanted.
 * @param {number[][]} design Rows of predictors.
 * @param {number[]} target
 * @returns {number[]|null} Coefficients, or null when unsolvable.
 */
export function ordinaryLeastSquares(design, target) {
  if (!Array.isArray(design) || design.length === 0) return null;
  const cols = design[0].length;
  if (design.length < cols) return null;

  const xtx = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const xty = new Array(cols).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i];
    for (let a = 0; a < cols; a++) {
      xty[a] += row[a] * target[i];
      for (let b = a; b < cols; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  // Mirror the upper triangle.
  for (let a = 0; a < cols; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];

  // Tiny ridge term: collinear lags are common in price series and would
  // otherwise make the system singular on short histories.
  for (let a = 1; a < cols; a++) xtx[a][a] += 1e-8;

  return solveLinearSystem(xtx, xty);
}

/**
 * Align a daily/irregular spot series onto a weekly retail series.
 *
 * For each retail print, take the most recent spot observation at or before
 * it. Retail prints weekly (Mondays); spot prints daily — pairing them by
 * nearest-preceding is what makes the lag structure meaningful.
 * @param {Array<{period: string, value: number}>} retail
 * @param {Array<{period: string, value: number}>} spot
 * @returns {Array<{period: string, retail: number, spot: number}>}
 */
export function alignSeries(retail, spot) {
  const retailRows = [...(retail || [])].sort((a, b) => a.period.localeCompare(b.period));
  const spotRows = [...(spot || [])].sort((a, b) => a.period.localeCompare(b.period));
  const out = [];
  let cursor = 0;
  let lastSpot = null;
  for (const row of retailRows) {
    while (cursor < spotRows.length && spotRows[cursor].period <= row.period) {
      lastSpot = spotRows[cursor].value;
      cursor += 1;
    }
    if (lastSpot === null) continue;
    out.push({ period: row.period, retail: row.value, spot: lastSpot });
  }
  return out;
}

/**
 * Seasonal term: the summer/winter RVP blend switch moves the pump on a
 * CALENDAR, not on the market, so it must not be attributed to crude.
 *
 * Summer-blend gasoline is costlier to produce and is required roughly
 * June–September in the US; this returns 1 inside that window and 0 outside.
 * @param {string} period ISO-ish date string.
 * @returns {number}
 */
export function seasonTerm(period) {
  const month = Number(String(period || '').slice(5, 7));
  return month >= 6 && month <= 9 ? 1 : 0;
}

/**
 * Fit the asymmetric pass-through model.
 *
 *   Δretail(t) = α + Σ β⁺ₖ·max(Δspot(t−k),0) + Σ β⁻ₖ·min(Δspot(t−k),0) + γ·season(t)
 *
 * Working in FIRST DIFFERENCES rather than levels, because both series are
 * strongly trending and a levels regression would report a spectacular R²
 * that is mostly just "both went up over ten years".
 *
 * @param {Array<{period: string, retail: number, spot: number}>} aligned
 * @param {{maxLag?: number}} [opts]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   intercept: number,
 *   positive: number[],
 *   negative: number[],
 *   season: number,
 *   maxLag: number,
 *   observations: number,
 *   passThroughUp: number,
 *   passThroughDown: number,
 *   asymmetry: number
 * }}
 */
export function fitPassThrough(aligned, { maxLag = DEFAULT_MAX_LAG } = {}) {
  const rows = Array.isArray(aligned) ? aligned : [];
  // Need the lag window plus enough left over to actually estimate 2·maxLag+2
  // coefficients without fitting noise.
  const minRows = maxLag + 2 * maxLag + 30;
  if (rows.length < minRows) {
    return {
      ok: false,
      reason: `need at least ${minRows} aligned observations to fit ${2 * maxLag + 2} coefficients, got ${rows.length}`,
      intercept: 0,
      positive: [],
      negative: [],
      season: 0,
      maxLag,
      observations: rows.length,
      passThroughUp: 0,
      passThroughDown: 0,
      asymmetry: 0,
    };
  }

  const dRetail = [];
  const dSpot = [];
  for (let i = 1; i < rows.length; i++) {
    dRetail.push(rows[i].retail - rows[i - 1].retail);
    dSpot.push(rows[i].spot - rows[i - 1].spot);
  }

  const design = [];
  const target = [];
  for (let t = maxLag; t < dRetail.length; t++) {
    const row = [1];
    for (let k = 0; k <= maxLag; k++) row.push(Math.max(dSpot[t - k], 0));
    for (let k = 0; k <= maxLag; k++) row.push(Math.min(dSpot[t - k], 0));
    row.push(seasonTerm(rows[t + 1].period));
    design.push(row);
    target.push(dRetail[t]);
  }

  const coefficients = ordinaryLeastSquares(design, target);
  if (!coefficients) {
    return {
      ok: false,
      reason: 'the normal equations were singular — the lag columns are collinear',
      intercept: 0,
      positive: [],
      negative: [],
      season: 0,
      maxLag,
      observations: design.length,
      passThroughUp: 0,
      passThroughDown: 0,
      asymmetry: 0,
    };
  }

  const positive = coefficients.slice(1, maxLag + 2);
  const negative = coefficients.slice(maxLag + 2, 2 * maxLag + 3);
  const passThroughUp = positive.reduce((a, b) => a + b, 0);
  const passThroughDown = negative.reduce((a, b) => a + b, 0);

  return {
    ok: true,
    intercept: coefficients[0],
    positive,
    negative,
    season: coefficients[coefficients.length - 1],
    maxLag,
    observations: design.length,
    // Cumulative pass-through: how much of a sustained $1/bbl move reaches the
    // pump over the whole lag window, up versus down.
    passThroughUp,
    passThroughDown,
    // Positive means rises pass through more completely than falls — the
    // "rockets and feathers" asymmetry this model exists to exploit.
    asymmetry: passThroughUp - passThroughDown,
  };
}

/**
 * Project the retail price forward.
 *
 * Returns a BAND, never a point estimate. The band starts from the residual
 * spread of the fit and is widened upward by the disruption index — which is
 * the only thing L3 is allowed to do.
 *
 * @param {object} fit From `fitPassThrough`.
 * @param {Array<{period: string, retail: number, spot: number}>} aligned
 * @param {{weeks?: number, disruptionIndex?: number|null}} [opts]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   anchor: number,
 *   weeks: number,
 *   points: Array<{week: number, central: number, low: number, high: number}>,
 *   riskWidenedCents: number,
 *   confidence: string
 * }}
 */
export function forecastPassThrough(fit, aligned, { weeks = 4, disruptionIndex = null } = {}) {
  const rows = Array.isArray(aligned) ? aligned : [];
  if (!fit?.ok || rows.length < fit.maxLag + 2) {
    return {
      ok: false,
      reason: fit?.reason || 'not enough aligned history to project',
      anchor: rows.length ? rows[rows.length - 1].retail : 0,
      weeks: 0,
      points: [],
      riskWidenedCents: 0,
      confidence: 'unavailable',
    };
  }

  const anchor = rows[rows.length - 1].retail;
  const dSpot = [];
  for (let i = 1; i < rows.length; i++) dSpot.push(rows[i].spot - rows[i - 1].spot);

  // In-sample residual spread sets the base band. No spot forecast is made:
  // the projection carries ALREADY-OBSERVED spot moves through the remaining
  // lag structure. That is the honest use of a lagged model — it says what is
  // still in the pipeline, not what crude will do next.
  const residuals = [];
  for (let t = fit.maxLag; t < dSpot.length; t++) {
    let predicted = fit.intercept + fit.season * seasonTerm(rows[t + 1].period);
    for (let k = 0; k <= fit.maxLag; k++) {
      predicted += fit.positive[k] * Math.max(dSpot[t - k], 0);
      predicted += fit.negative[k] * Math.min(dSpot[t - k], 0);
    }
    residuals.push((rows[t + 1].retail - rows[t].retail) - predicted);
  }
  const meanAbsResidual = residuals.length
    ? residuals.reduce((a, b) => a + Math.abs(b), 0) / residuals.length
    : 0;

  // Risk overlay: widen the UPPER bound only, proportional to how far the
  // disruption index has broken its threshold. Never moves the central path.
  const riskFactor = Number.isFinite(disruptionIndex) && disruptionIndex > 50
    ? (disruptionIndex - 50) / 50
    : 0;

  const points = [];
  let level = anchor;
  for (let week = 1; week <= weeks; week++) {
    let delta = fit.intercept;
    for (let k = 0; k <= fit.maxLag; k++) {
      const idx = dSpot.length - 1 - (k - week);
      // Only lags whose spot move has ALREADY happened contribute.
      if (idx < 0 || idx >= dSpot.length) continue;
      delta += fit.positive[k] * Math.max(dSpot[idx], 0);
      delta += fit.negative[k] * Math.min(dSpot[idx], 0);
    }
    level += delta;
    // Uncertainty compounds with the square root of horizon.
    const spread = meanAbsResidual * Math.sqrt(week) * 1.5;
    const extraUp = spread * riskFactor;
    points.push({
      week,
      central: Math.round(level * 1000) / 1000,
      low: Math.round((level - spread) * 1000) / 1000,
      high: Math.round((level + spread + extraUp) * 1000) / 1000,
    });
  }

  return {
    ok: true,
    anchor,
    weeks,
    points,
    riskWidenedCents: Math.round(meanAbsResidual * Math.sqrt(weeks) * 1.5 * riskFactor * 100),
    confidence: riskFactor > 0 ? 'modelled-with-risk-overlay' : 'modelled',
  };
}

/**
 * Backtest against a naive "price stays flat" baseline.
 *
 * Fits on everything before the holdout window, then walks it forward one
 * period at a time. Reports mean absolute error in CENTS PER GALLON for both
 * the model and naive, plus the improvement between them.
 *
 * If `beatsNaive` is false, say so on screen. An operator who catches one
 * unfalsifiable number stops believing all of them.
 *
 * @param {Array<{period: string, retail: number, spot: number}>} aligned
 * @param {{holdoutWeeks?: number, maxLag?: number}} [opts]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   modelMaeCents: number,
 *   naiveMaeCents: number,
 *   improvementPct: number,
 *   beatsNaive: boolean,
 *   holdoutWeeks: number,
 *   trainedOn: number
 * }}
 */
export function backtest(aligned, { holdoutWeeks = 104, maxLag = DEFAULT_MAX_LAG } = {}) {
  const rows = Array.isArray(aligned) ? aligned : [];
  const splitAt = rows.length - holdoutWeeks;
  const minTrain = maxLag + 2 * maxLag + 30;
  if (splitAt < minTrain) {
    return {
      ok: false,
      reason: `need ${minTrain + holdoutWeeks} aligned observations for a ${holdoutWeeks}-week holdout, got ${rows.length}`,
      modelMaeCents: 0,
      naiveMaeCents: 0,
      improvementPct: 0,
      beatsNaive: false,
      holdoutWeeks,
      trainedOn: Math.max(0, splitAt),
    };
  }

  const fit = fitPassThrough(rows.slice(0, splitAt), { maxLag });
  if (!fit.ok) {
    return {
      ok: false,
      reason: fit.reason,
      modelMaeCents: 0,
      naiveMaeCents: 0,
      improvementPct: 0,
      beatsNaive: false,
      holdoutWeeks,
      trainedOn: splitAt,
    };
  }

  let modelError = 0;
  let naiveError = 0;
  let scored = 0;

  for (let t = splitAt; t < rows.length; t++) {
    if (t < maxLag + 1) continue;
    let delta = fit.intercept + fit.season * seasonTerm(rows[t].period);
    for (let k = 0; k <= maxLag; k++) {
      const i = t - k;
      if (i - 1 < 0) continue;
      const move = rows[i].spot - rows[i - 1].spot;
      delta += fit.positive[k] * Math.max(move, 0);
      delta += fit.negative[k] * Math.min(move, 0);
    }
    const predicted = rows[t - 1].retail + delta;
    const actual = rows[t].retail;
    modelError += Math.abs(predicted - actual);
    // Naive: tomorrow looks like today.
    naiveError += Math.abs(rows[t - 1].retail - actual);
    scored += 1;
  }

  if (scored === 0) {
    return {
      ok: false,
      reason: 'the holdout window scored no periods',
      modelMaeCents: 0,
      naiveMaeCents: 0,
      improvementPct: 0,
      beatsNaive: false,
      holdoutWeeks,
      trainedOn: splitAt,
    };
  }

  const modelMaeCents = (modelError / scored) * 100;
  const naiveMaeCents = (naiveError / scored) * 100;

  return {
    ok: true,
    modelMaeCents: Math.round(modelMaeCents * 100) / 100,
    naiveMaeCents: Math.round(naiveMaeCents * 100) / 100,
    improvementPct: naiveMaeCents > 0
      ? Math.round(((naiveMaeCents - modelMaeCents) / naiveMaeCents) * 1000) / 10
      : 0,
    beatsNaive: modelMaeCents < naiveMaeCents,
    holdoutWeeks,
    trainedOn: splitAt,
  };
}

/**
 * One line describing a fit and its report card, for narration.
 * @param {object} fit
 * @param {object} validation
 * @returns {string}
 */
export function describeModel(fit, validation) {
  if (!fit?.ok) return `PRICE MODEL — not fitted: ${fit?.reason || 'insufficient history'}.`;
  const up = Math.round(fit.passThroughUp * 100) / 100;
  const down = Math.round(fit.passThroughDown * 100) / 100;
  const asym = fit.asymmetry > 0
    ? 'rises pass through more completely than falls, as expected'
    : 'no upward asymmetry in this window — unusual, treat the fit with suspicion';
  const card = !validation?.ok
    ? `not validated (${validation?.reason || 'no holdout'})`
    : validation.beatsNaive
      ? `holdout MAE ${validation.modelMaeCents}¢/gal vs naive ${validation.naiveMaeCents}¢ — ${validation.improvementPct}% better`
      : `holdout MAE ${validation.modelMaeCents}¢/gal vs naive ${validation.naiveMaeCents}¢ — DOES NOT beat a flat-price baseline`;
  return `PRICE MODEL — fitted on ${fit.observations} weekly observations, ${fit.maxLag}-week lag. Cumulative pass-through ${up} up / ${down} down; ${asym}. ${card}.`;
}
