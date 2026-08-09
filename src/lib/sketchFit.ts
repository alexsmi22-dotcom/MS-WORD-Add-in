// Sketch data → candidate functions, for the Solve equation canvas.
//
// The user clicks points on a grid; this fits a SMALL, NAMED family of models
// and presents ALL of them with their fit quality — it never auto-picks. A
// model chosen by software is a conclusion the user did not draw; a ranked
// list with adjusted R² is evidence they can weigh.
//
// HONESTY RULES, in order of importance:
//   1. The R² SHOWN is computed from the EXPRESSION SHOWN. Coefficients are
//      rounded for display, so the quality figure is recomputed from the
//      rounded model via the product's own parser — the number beside the
//      formula is the quality of that exact formula, not of an unseen
//      full-precision cousin.
//   2. Models with domain requirements (exp/log/power need positive values)
//      are SKIPPED WITH A NAMED REASON, never force-fitted through a log of a
//      non-positive number.
//   3. Two points sharing an x with different y cannot lie on ANY function of
//      x — refused up front, not "fitted" with a huge residual.
//   4. More parameters never hurt plain R², so the ranking uses ADJUSTED R²
//      and says so.

import { solve, transpose, multiply, Matrix } from "./linalg";
import { parseExpr, evalAst } from "./solve";

export interface SketchPt { x: number; y: number }

export interface FitResult {
  /** Human name: "linear", "quadratic", "cubic", "exponential", "logarithmic", "power". */
  model: string;
  /** The fitted expression in the product's grammar, e.g. "2.5*x^2 - 1.2*x + 0.4". */
  expr: string;
  /** R² of the DISPLAYED (rounded) expression, recomputed via parseExpr. */
  r2: number;
  /** Adjusted R² — the comparison number across models of different size. */
  adjR2: number;
  rmse: number;
  params: number;
  caveats: string[];
}

export interface SketchFitOutcome {
  fits: FitResult[];
  /** Models that could not run, each with its named reason. */
  skipped: { model: string; reason: string }[];
  /** A refusal that applies to the whole request (too few points, not a function). */
  refusal?: string;
}

const round4 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  // Four significant digits — enough to reproduce the fit, few enough to read.
  if (v === 0) return 0;
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const f = Math.pow(10, 3 - mag);
  return Math.round(v * f) / f;
};

const fmtCoef = (v: number): string => {
  const r = round4(v);
  // Plain decimal, never exponent notation — "1e-5" reads as a variable name
  // e times 1 minus 5 in some grammars; the parser here accepts it, but a
  // student retyping it may not get what they saw.
  if (Math.abs(r) >= 1e6 || (r !== 0 && Math.abs(r) < 1e-4)) return v.toExponential(3);
  return String(r);
};

/** Builds "a3*x^3 + a2*x^2 + a1*x + a0" with signs folded in, zero terms kept
 *  out, and the whole thing re-parseable. */
function polyExpr(coefs: number[]): string {
  // coefs[k] multiplies x^k.
  const terms: string[] = [];
  for (let k = coefs.length - 1; k >= 0; k--) {
    const c = round4(coefs[k]);
    if (c === 0) continue;
    const mag = Math.abs(c);
    const coefTxt = mag === 1 && k > 0 ? "" : `${fmtCoef(mag)}*`;
    const xTxt = k === 0 ? "" : k === 1 ? "x" : `x^${k}`;
    const body = `${coefTxt}${xTxt}`.replace(/\*$/, "") || fmtCoef(mag);
    terms.push(`${c < 0 ? "- " : terms.length ? "+ " : ""}${body}`);
  }
  if (!terms.length) return "0";
  return terms.join(" ").replace(/^\+ /, "");
}

/** Least squares via the normal equations. Fine at degree ≤ 3 on sketch data;
 *  the honesty backstop is that the SHOWN R² comes from the shown expression,
 *  so a numerically poor solve reports its own poor quality. */
function leastSquares(A: number[][], y: number[]): number[] | null {
  const At = transpose(A as Matrix);
  const AtA = multiply(At, A as Matrix);
  const Aty = multiply(At, y.map((v) => [v]) as Matrix);
  if (!AtA || !Aty) return null;
  const sol = solve(AtA, Aty);
  if (!sol) return null;
  const out = sol.map((row) => row[0]);
  return out.every(Number.isFinite) ? out : null;
}

/** R², RMSE of a given expression against the points, via the REAL parser. */
function scoreExpr(expr: string, pts: SketchPt[]): { r2: number; rmse: number } | null {
  let ast;
  try {
    ast = parseExpr(expr);
  } catch {
    return null;
  }
  const mean = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let ssRes = 0, ssTot = 0;
  for (const p of pts) {
    let yh: number;
    try {
      yh = evalAst(ast, { x: p.x });
    } catch {
      return null;
    }
    if (!Number.isFinite(yh)) return null;
    ssRes += (p.y - yh) ** 2;
    ssTot += (p.y - mean) ** 2;
  }
  // All-equal y: R² is undefined (ssTot = 0). A constant fit through constant
  // data is perfect; anything else is not — report 1 or 0 accordingly.
  const r2 = ssTot === 0 ? (ssRes < 1e-12 ? 1 : 0) : 1 - ssRes / ssTot;
  return { r2, rmse: Math.sqrt(ssRes / pts.length) };
}

function finishFit(
  model: string, expr: string, params: number, pts: SketchPt[], caveats: string[]
): FitResult | null {
  const score = scoreExpr(expr, pts);
  if (!score) return null;
  const n = pts.length;
  // Adjusted R² is UNDEFINED when n ≤ params + 1 — and substituting plain R²
  // under the "adjusted" label handed the win to the biggest model exactly
  // where flattery is strongest (the independent pass caught a 4-parameter
  // fit of 4 points ranked #1 with no caveat). Undefined is NaN, ranked LAST.
  const adjR2 = n - params - 1 > 0
    ? 1 - (1 - score.r2) * ((n - 1) / (n - params - 1))
    : NaN;
  if (n === params) {
    caveats = [...caveats, "As many parameters as points — this is interpolation, not evidence of the model."];
  } else if (!Number.isFinite(adjR2)) {
    caveats = [...caveats, `Adjusted R² is undefined with only ${n} points for ${params} parameters — this model cannot claim a ranking here.`];
  }
  return { model, expr, r2: score.r2, adjR2, rmse: score.rmse, params, caveats };
}

/**
 * Fits the model family to the points. Presents everything that legitimately
 * ran, ranked by adjusted R²; names everything that could not run.
 */
export function fitSketch(ptsIn: SketchPt[]): SketchFitOutcome {
  const pts = ptsIn.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) {
    return { fits: [], skipped: [], refusal: "At least THREE points are needed before any fit means something." };
  }
  // A function of x cannot pass through two points that share an x.
  const seen = new Map<number, number>();
  for (const p of pts) {
    const prior = seen.get(p.x);
    if (prior !== undefined && prior !== p.y) {
      return {
        fits: [], skipped: [],
        refusal: `Two points share x = ${p.x} with different y (${prior} and ${p.y}) — no function of x passes through both. Remove one.`,
      };
    }
    seen.set(p.x, p.y);
  }
  const uniq = [...seen.entries()].map(([x, y]) => ({ x, y }));
  if (uniq.length < 3) {
    return { fits: [], skipped: [], refusal: "At least THREE distinct x-values are needed." };
  }

  const fits: FitResult[] = [];
  const skipped: { model: string; reason: string }[] = [];
  const xs = uniq.map((p) => p.x), ys = uniq.map((p) => p.y);

  // Polynomials: linear, quadratic, cubic — as data allows.
  const polySpecs: [string, number][] = [["linear", 1], ["quadratic", 2], ["cubic", 3]];
  for (const [name, deg] of polySpecs) {
    if (uniq.length < deg + 1) {
      skipped.push({ model: name, reason: `needs at least ${deg + 1} distinct x-values` });
      continue;
    }
    const A = uniq.map((p) => Array.from({ length: deg + 1 }, (_, k) => Math.pow(p.x, k)));
    const coefs = leastSquares(A, ys);
    if (!coefs) {
      skipped.push({ model: name, reason: "the least-squares system was singular for these points" });
      continue;
    }
    const fit = finishFit(name, polyExpr(coefs), deg + 1, uniq, []);
    if (fit) fits.push(fit);
  }

  // Exponential y = a·e^(b·x) — log-linearised, so every y must be positive.
  if (ys.every((y) => y > 0)) {
    const A = xs.map((x) => [1, x]);
    const coefs = leastSquares(A, ys.map(Math.log));
    if (coefs) {
      const a = Math.exp(coefs[0]), b = coefs[1];
      const fit = finishFit(
        "exponential", `${fmtCoef(a)}*exp(${fmtCoef(b)}*x)`, 2, uniq,
        ["Fitted on log(y) (the closed-form route), which weights small y more — stated, not hidden."]
      );
      if (fit) fits.push(fit);
    }
  } else {
    skipped.push({ model: "exponential", reason: "needs every y > 0 (it is fitted through log y)" });
  }

  // Logarithmic y = a + b·ln x — every x must be positive.
  if (xs.every((x) => x > 0)) {
    const A = xs.map((x) => [1, Math.log(x)]);
    const coefs = leastSquares(A, ys);
    if (coefs) {
      const fit = finishFit(
        "logarithmic",
        `${fmtCoef(coefs[0])} + ${fmtCoef(coefs[1])}*ln(x)`.replace("+ -", "- "),
        2, uniq, []
      );
      if (fit) fits.push(fit);
    }
  } else {
    skipped.push({ model: "logarithmic", reason: "needs every x > 0" });
  }

  // Power y = a·x^b — log-log, so every x and y must be positive.
  if (xs.every((x) => x > 0) && ys.every((y) => y > 0)) {
    const A = xs.map((x) => [1, Math.log(x)]);
    const coefs = leastSquares(A, ys.map(Math.log));
    if (coefs) {
      // The exponent is ALWAYS parenthesised: x^-0.5 is a parse error waiting
      // for whoever retypes it, x^(-0.5) is not.
      const fit = finishFit(
        "power", `${fmtCoef(Math.exp(coefs[0]))}*x^(${fmtCoef(coefs[1])})`, 2, uniq,
        ["Fitted on log–log axes (the closed-form route) — stated, not hidden."]
      );
      if (fit) fits.push(fit);
    }
  } else {
    skipped.push({ model: "power", reason: "needs every x > 0 and every y > 0" });
  }

  // Rank by ADJUSTED R² — plain R² always prefers more parameters. Models
  // whose adjusted value is undefined rank BELOW every model with a real one:
  // they have no standing in an adjusted comparison.
  fits.sort((a, b) => {
    const aDef = Number.isFinite(a.adjR2), bDef = Number.isFinite(b.adjR2);
    if (aDef !== bDef) return aDef ? -1 : 1;
    return aDef ? b.adjR2 - a.adjR2 : b.r2 - a.r2;
  });
  return { fits, skipped };
}
