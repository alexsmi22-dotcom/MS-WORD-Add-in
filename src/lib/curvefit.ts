// Fit an ARBITRARY model, typed by the user, to measured data.
//
// WHY THIS IS THE GAP IT IS. The product has had a real Levenberg-Marquardt
// engine since the assay work — analytic covariance, standard errors, the lot —
// reachable only through five hard-coded biochemistry models. Anyone whose data
// was an exponential decay, a logistic growth curve, a power law or a Gaussian
// peak had nothing, and that is the most-used numerical verb after "plot" in
// any analysis package. The engine did not need improving; it needed a door.
//
// The expression evaluator (stats.ts `evalFormula`) already understands the
// vocabulary — exp, log, trig, powers, if() — so the model is just text with
// named parameters in it.
//
// STARTING VALUES ARE THE HARD PART OF NONLINEAR FITTING, and this module is
// honest about that rather than pretending otherwise: a converged fit from a
// poor start is the classic silently-wrong result. The user may supply starts;
// where they do not, every parameter begins at 1 and the result SAYS so, along
// with what to look at if the fit is poor.

import { evalFormula } from "./stats";
import { levenbergMarquardt, FitResult } from "./assay";

/** Names the evaluator already binds, which are therefore not parameters. */
const RESERVED = new Set([
  "x", "pi", "e", "exp", "ln", "log", "log2", "log10", "logbase", "sqrt", "cbrt",
  "abs", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh",
  "tanh", "asinh", "acosh", "atanh", "floor", "ceil", "round", "trunc", "sign",
  "min", "max", "clamp", "hypot", "pow", "mod", "step", "if", "and", "or", "not",
]);

export interface CurveFitError {
  ok: false;
  error: string;
}

export interface CurveFitResult {
  ok: true;
  /** Parameter names, in the order they appear in the expression. */
  names: string[];
  values: number[];
  /** Standard error per parameter, from the covariance diagonal. */
  errors: number[];
  rSquared: number;
  rmse: number;
  iterations: number;
  converged: boolean;
  /** The starting values actually used. */
  start: number[];
  startWasDefaulted: boolean;
  /** Evaluate the fitted model, for drawing. */
  predict: (x: number) => number;
  notes: string[];
}

/**
 * Free identifiers in an expression, in order of first appearance.
 *
 * Deliberately simple: anything that looks like a name, is not reserved, and is
 * not immediately followed by "(" (which would make it a function call the
 * evaluator does not know — a typo worth reporting rather than fitting).
 */
export function modelParameters(expr: string): { names: string[]; unknownCalls: string[] } {
  const names: string[] = [];
  const unknownCalls: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const name = m[1];
    const isCall = m[2] === "(";
    if (RESERVED.has(name)) continue;
    if (isCall) {
      if (!unknownCalls.includes(name)) unknownCalls.push(name);
      continue;
    }
    if (!names.includes(name)) names.push(name);
  }
  return { names, unknownCalls };
}

export interface CurveFitOptions {
  /** Starting value per parameter name. Missing names default to 1. */
  start?: Record<string, number>;
}

/**
 * Fits `expr` (a function of x and named parameters) to (xs, ys).
 *
 * The model is evaluated through the same expression engine the plot, ODE and
 * optimiser tools use, so anything they accept works here too.
 */
export function fitCurve(
  xs: number[],
  ys: number[],
  expr: string,
  opts: CurveFitOptions = {},
): CurveFitResult | CurveFitError {
  if (xs.length !== ys.length) return { ok: false, error: "x and y must have the same number of values." };
  if (xs.length < 2) return { ok: false, error: "Fitting needs at least two points." };
  if ([...xs, ...ys].some((v) => !Number.isFinite(v))) {
    return { ok: false, error: "Every x and y must be a finite number." };
  }
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a model, for example a*exp(-b*x) + c." };

  const { names, unknownCalls } = modelParameters(trimmed);
  if (unknownCalls.length) {
    return {
      ok: false,
      error:
        `"${unknownCalls[0]}(" is not a function this recognises. Available: exp, ln, log, log10, ` +
        "sqrt, cbrt, abs, sin, cos, tan and their inverses, hyperbolics, floor, ceil, round, min, " +
        "max, hypot, pow, mod, step and if(condition, a, b).",
    };
  }
  if (!names.length) {
    return {
      ok: false,
      error:
        "That model has no parameters to fit — every symbol in it is either x or a known function. " +
        "Use letters for the quantities you want fitted, e.g. a*exp(-b*x) + c.",
    };
  }
  if (names.length > 8) {
    return { ok: false, error: `That model has ${names.length} parameters; more than 8 will not identify.` };
  }
  if (names.length >= xs.length) {
    return {
      ok: false,
      error:
        `There are ${names.length} parameters and only ${xs.length} points. A fit with at least as ` +
        "many parameters as observations passes exactly through the data and means nothing.",
    };
  }

  // One evaluation, checked up front, so a typo in the model is reported as a
  // model error rather than surfacing later as a non-convergent fit.
  const evaluate = (params: number[], x: number): number => {
    const vars: Record<string, number> = { x };
    names.forEach((n, i) => (vars[n] = params[i]));
    return evalFormula(trimmed, vars);
  };
  const startWasDefaulted = !opts.start || names.some((n) => !Number.isFinite(opts.start?.[n] as number));
  const start = names.map((n) => {
    const v = opts.start?.[n];
    return Number.isFinite(v as number) ? (v as number) : 1;
  });
  try {
    const probe = evaluate(start, xs[0]);
    if (!Number.isFinite(probe)) {
      return {
        ok: false,
        error:
          "The model does not evaluate to a finite number at the starting values. Give starting " +
          "values that are physically sensible — a fit cannot begin from a point where the model " +
          "is undefined.",
      };
    }
  } catch (e) {
    return { ok: false, error: `That model could not be evaluated: ${(e as Error).message}` };
  }

  const fit: FitResult = levenbergMarquardt(xs, ys, (params, x) => evaluate(params, x), start);

  const notes: string[] = [];
  if (startWasDefaulted) {
    notes.push(
      "Starting values defaulted to 1 for every parameter. Nonlinear fitting finds a LOCAL " +
        "minimum near where it starts, so a poor fit here is very often a starting-value problem " +
        "rather than a wrong model — supply rough estimates and try again.",
    );
  }
  if (!fit.converged) {
    notes.push(
      "The fit did NOT converge, so these numbers are wherever the search stopped rather than a " +
        "best fit. Do not report them.",
    );
  }
  const bigSE = fit.se
    .map((s, i) => ({ s, i }))
    .filter((o) => Number.isFinite(o.s) && Math.abs(o.s) > Math.abs(fit.params[o.i]));
  if (bigSE.length) {
    notes.push(
      `Standard error exceeds the value itself for ${bigSE.map((o) => names[o.i]).join(", ")} — ` +
        "that parameter is not determined by this data. The model is probably too flexible for the " +
        "number of points, or two parameters are trading off against each other.",
    );
  }
  notes.push(
    "R² on a NONLINEAR fit is descriptive only. It does not test the model, it cannot be compared " +
      "across different models on the same data the way it can for nested linear ones, and a high " +
      "value does not mean the parameters are meaningful.",
  );

  return {
    ok: true,
    names,
    values: fit.params,
    errors: fit.se,
    rSquared: fit.rsquared,
    rmse: fit.rmse,
    iterations: fit.iterations,
    converged: fit.converged,
    start,
    startWasDefaulted,
    predict: fit.predict,
    notes: [...notes, ...fit.caveats],
  };
}
