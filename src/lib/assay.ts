// Quantitative life-science assay toolkit for the Bio/Assay mode: enzyme
// kinetics, dose-response (IC50/EC50), receptor binding, plus the everyday
// closed-form lab calculators (Cheng-Prusoff, Henderson-Hasselbalch,
// Beer-Lambert, dilutions, nucleic-acid/protein quantitation).
//
// Pure numeric functions — no Office.js — fully unit-testable. The task pane
// formats and inserts the typeset equation, the fitted parameters, and (via the
// `predict` closure on each fit) a fitted curve overlaid on the Plot engine.
//
// The nonlinear fits share one Levenberg-Marquardt engine below; each model
// provides its own analytic initial guess (usually from a linearization) so the
// fit converges without the user supplying starting values.

// --- linear algebra helpers --------------------------------------------------

/** Solves the linear system A·x = b (A is n×n, row-major) by Gaussian
 *  elimination with partial pivoting. Returns null if A is singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on augmented copies so the inputs aren't mutated.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** Inverts an n×n matrix by Gauss-Jordan elimination. Returns null if singular.
 *  Used for the parameter covariance matrix (small: ≤4×4 here). */
function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

// --- ordinary least squares (linear) ----------------------------------------

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination. */
  rsquared: number;
  slopeSE: number;
  interceptSE: number;
}

/** Simple linear regression y = slope·x + intercept, with standard errors and R². */
export function linearRegression(x: number[], y: number[]): LinearFit {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const ssResid = syy - slope * sxy;
  const rsquared = syy === 0 ? 1 : 1 - ssResid / syy;
  const s2 = n > 2 ? ssResid / (n - 2) : NaN;
  const slopeSE = Math.sqrt(s2 / sxx);
  const interceptSE = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  return { slope, intercept, rsquared, slopeSE, interceptSE };
}

// --- nonlinear least squares (Levenberg-Marquardt) --------------------------

export type Model = (params: number[], x: number) => number;

export interface FitResult {
  /** Best-fit parameters, in the model's parameter order. */
  params: number[];
  /** Standard error of each parameter (√ of the covariance diagonal). */
  se: number[];
  /** Coefficient of determination against the raw y. */
  rsquared: number;
  /** Root-mean-square residual. */
  rmse: number;
  iterations: number;
  converged: boolean;
  /** Evaluate the fitted model at an arbitrary x (for drawing the curve). */
  predict: (x: number) => number;
}

export interface FitOptions {
  maxIter?: number;
  /** Relative-cost convergence tolerance. */
  tol?: number;
  /** Optional per-point weights (e.g. 1/variance); defaults to 1. */
  weights?: number[];
}

/**
 * Fits `model` to (x, y) by Levenberg-Marquardt least squares starting from
 * `initial`. The Jacobian is computed by central finite differences, so any
 * smooth model works without hand-coded derivatives. Standard errors come from
 * s²·(JᵀJ)⁻¹ with s² = SSR/(n − p). Robust for the small (≤4-parameter) models
 * here; `initial` should be a sensible analytic guess.
 */
export function levenbergMarquardt(
  x: number[],
  y: number[],
  model: Model,
  initial: number[],
  opts: FitOptions = {}
): FitResult {
  const maxIter = opts.maxIter ?? 200;
  const tol = opts.tol ?? 1e-10;
  const n = x.length;
  const p = initial.length;
  const w = opts.weights ?? x.map(() => 1);
  const sw = w.map((wi) => Math.sqrt(wi));

  let params = [...initial];

  const residuals = (pr: number[]): number[] => x.map((xi, i) => sw[i] * (y[i] - model(pr, xi)));
  const cost = (pr: number[]): number => residuals(pr).reduce((a, r) => a + r * r, 0);

  // Central-difference Jacobian of the (weighted) residuals w.r.t. each param.
  const jacobian = (pr: number[]): number[][] => {
    const J: number[][] = Array.from({ length: n }, () => new Array(p).fill(0));
    for (let j = 0; j < p; j++) {
      const h = Math.max(1e-7, 1e-7 * Math.abs(pr[j]));
      const up = [...pr];
      const dn = [...pr];
      up[j] += h;
      dn[j] -= h;
      for (let i = 0; i < n; i++) {
        // ∂residual/∂p = −∂model/∂p (residual = y − model), weighted.
        J[i][j] = (-sw[i] * (model(up, x[i]) - model(dn, x[i]))) / (2 * h);
      }
    }
    return J;
  };

  let lambda = 1e-3;
  let currentCost = cost(params);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const J = jacobian(params);
    const r = residuals(params);
    // JᵀJ (p×p) and Jᵀr (p).
    const JtJ: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    const Jtr: number[] = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < p; a++) {
        Jtr[a] += J[i][a] * r[i];
        for (let b = 0; b < p; b++) JtJ[a][b] += J[i][a] * J[i][b];
      }
    }

    let stepAccepted = false;
    for (let inner = 0; inner < 20; inner++) {
      // Marquardt damping: scale the diagonal by (1 + λ).
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) : v)));
      const delta = solveLinear(A, Jtr);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      // Gauss-Newton/LM step is −(JᵀJ+λD)⁻¹·Jᵀr (Jtr is the gradient of ½‖r‖²).
      const trial = params.map((v, j) => v - delta[j]);
      const trialCost = cost(trial);
      if (trialCost < currentCost) {
        const rel = (currentCost - trialCost) / Math.max(currentCost, 1e-30);
        params = trial;
        currentCost = trialCost;
        lambda = Math.max(lambda / 10, 1e-12);
        stepAccepted = true;
        if (rel < tol) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e12) {
        stepAccepted = false;
        break;
      }
    }
    if (converged || !stepAccepted) {
      converged = converged || !stepAccepted; // a step we can't improve = a local min
      break;
    }
  }

  // Goodness of fit and parameter covariance from the final Jacobian.
  const my = y.reduce((a, b) => a + b, 0) / n;
  let ssResid = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssResid += (y[i] - model(params, x[i])) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  const rsquared = ssTot === 0 ? 1 : 1 - ssResid / ssTot;
  const rmse = Math.sqrt(ssResid / n);

  const se = new Array(p).fill(NaN);
  if (n > p) {
    const J = jacobian(params);
    const JtJ: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++)
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) JtJ[a][b] += J[i][a] * J[i][b];
    const cov = invertMatrix(JtJ);
    if (cov) {
      const s2 = ssResid / (n - p);
      for (let j = 0; j < p; j++) se[j] = Math.sqrt(Math.max(0, s2 * cov[j][j]));
    }
  }

  return {
    params,
    se,
    rsquared,
    rmse,
    iterations,
    converged,
    predict: (xi: number) => model(params, xi),
  };
}

// --- enzyme kinetics ---------------------------------------------------------

/** Michaelis-Menten velocity: v = Vmax·[S] / (Km + [S]). */
export function michaelisMenten(vmax: number, km: number, s: number): number {
  return (vmax * s) / (km + s);
}

export interface KineticsFit extends FitResult {
  vmax: number;
  km: number;
  vmaxSE: number;
  kmSE: number;
}

/**
 * Fits Michaelis-Menten to substrate/velocity data. The initial guess comes
 * from the Hanes-Woolf linearization ([S]/v vs [S]), which is the most
 * numerically stable of the three classic linear plots.
 */
export function fitMichaelisMenten(s: number[], v: number[]): KineticsFit {
  const hw = hanesWoolf(s, v);
  const vmax0 = hw.vmax > 0 && Number.isFinite(hw.vmax) ? hw.vmax : Math.max(...v);
  const km0 = hw.km > 0 && Number.isFinite(hw.km) ? hw.km : s[Math.floor(s.length / 2)] || 1;
  const fit = levenbergMarquardt(s, v, ([vmax, km], x) => michaelisMenten(vmax, km, x), [vmax0, km0]);
  return { ...fit, vmax: fit.params[0], km: fit.params[1], vmaxSE: fit.se[0], kmSE: fit.se[1] };
}

/** Hill (cooperative) velocity: v = Vmax·[S]ⁿ / (K^n + [S]ⁿ). */
export function hillEquation(vmax: number, k: number, n: number, s: number): number {
  const sn = Math.pow(s, n);
  return (vmax * sn) / (Math.pow(k, n) + sn);
}

export interface HillFit extends FitResult {
  vmax: number;
  /** Half-saturation constant (K, sometimes written K0.5 or Kd). */
  k: number;
  /** Hill coefficient (n > 1 positive cooperativity, < 1 negative). */
  hill: number;
}

/** Fits the Hill equation to substrate/velocity (or ligand/response) data. */
export function fitHill(s: number[], v: number[]): HillFit {
  const mm = fitMichaelisMenten(s, v);
  const vmax0 = mm.vmax > 0 ? mm.vmax : Math.max(...v);
  const k0 = mm.km > 0 ? mm.km : s[Math.floor(s.length / 2)] || 1;
  const fit = levenbergMarquardt(
    s,
    v,
    ([vmax, k, n], x) => hillEquation(vmax, k, n, x),
    [vmax0, k0, 1]
  );
  return { ...fit, vmax: fit.params[0], k: fit.params[1], hill: fit.params[2] };
}

/** Turnover number: kcat = Vmax / [E]ₜₒₜₐₗ. */
export function kcat(vmax: number, enzymeConc: number): number {
  return enzymeConc === 0 ? NaN : vmax / enzymeConc;
}

/** Catalytic efficiency (specificity constant): kcat / Km. */
export function catalyticEfficiency(kcatValue: number, km: number): number {
  return km === 0 ? NaN : kcatValue / km;
}

// --- kinetics linearizations (closed form; also seed the nonlinear fit) -----

export interface Linearization {
  vmax: number;
  km: number;
  slope: number;
  intercept: number;
  rsquared: number;
}

/** Lineweaver-Burk (double-reciprocal): 1/v vs 1/[S]; slope = Km/Vmax, intercept = 1/Vmax. */
export function lineweaverBurk(s: number[], v: number[]): Linearization {
  const xs = s.map((si) => 1 / si);
  const ys = v.map((vi) => 1 / vi);
  const lr = linearRegression(xs, ys);
  const vmax = 1 / lr.intercept;
  const km = lr.slope * vmax;
  return { vmax, km, slope: lr.slope, intercept: lr.intercept, rsquared: lr.rsquared };
}

/** Eadie-Hofstee: v vs v/[S]; slope = −Km, intercept = Vmax. */
export function eadieHofstee(s: number[], v: number[]): Linearization {
  const xs = s.map((si, i) => v[i] / si);
  const lr = linearRegression(xs, v);
  return { vmax: lr.intercept, km: -lr.slope, slope: lr.slope, intercept: lr.intercept, rsquared: lr.rsquared };
}

/** Hanes-Woolf: [S]/v vs [S]; slope = 1/Vmax, intercept = Km/Vmax. */
export function hanesWoolf(s: number[], v: number[]): Linearization {
  const ys = s.map((si, i) => si / v[i]);
  const lr = linearRegression(s, ys);
  const vmax = 1 / lr.slope;
  const km = lr.intercept * vmax;
  return { vmax, km, slope: lr.slope, intercept: lr.intercept, rsquared: lr.rsquared };
}

// --- dose-response (four-parameter logistic) --------------------------------

/**
 * Four-parameter logistic on concentration x:
 *   y = bottom + (top − bottom) / (1 + (EC50 / x)^hill)
 * with bottom = response as x→0 and top = response as x→∞, and hill > 0. An
 * increasing (agonist) curve has bottom < top; an inhibition curve has
 * bottom > top and EC50 is then the IC50. Because orientation is carried by
 * which plateau is larger, the same positive-hill form fits both.
 */
export function fourPL(bottom: number, top: number, ec50: number, hill: number, x: number): number {
  if (x <= 0) return bottom;
  return bottom + (top - bottom) / (1 + Math.pow(ec50 / x, hill));
}

export interface DoseResponseFit extends FitResult {
  bottom: number;
  top: number;
  /** Half-maximal concentration (EC50 for agonists, IC50 for inhibitors). */
  ec50: number;
  hill: number;
  /** −log10(EC50) when concentrations are molar; NaN if EC50 ≤ 0. */
  pEC50: number;
}

/**
 * Fits a 4-parameter logistic to concentration/response data and reports EC50
 * (= IC50 for inhibition curves). Concentrations must be linear (not log).
 * Orientation is inferred from the data: the plateaus are seeded from the
 * responses at the lowest and highest concentrations (so a falling inhibition
 * curve fits with the same positive-hill model), and EC50 is seeded at the
 * concentration nearest the mid-response.
 */
export function fitDoseResponse(conc: number[], response: number[]): DoseResponseFit {
  let iLo = 0;
  let iHi = 0;
  for (let i = 1; i < conc.length; i++) {
    if (conc[i] < conc[iLo]) iLo = i;
    if (conc[i] > conc[iHi]) iHi = i;
  }
  const bottom0 = response[iLo]; // response as x→0
  const top0 = response[iHi]; // response as x→∞
  const mid = (bottom0 + top0) / 2;
  // Concentration whose response is closest to the midpoint → EC50 seed.
  let ec0 = conc[iHi];
  let best = Infinity;
  for (let i = 0; i < conc.length; i++) {
    const d = Math.abs(response[i] - mid);
    if (conc[i] > 0 && d < best) {
      best = d;
      ec0 = conc[i];
    }
  }
  const fit = levenbergMarquardt(
    conc,
    response,
    ([bottom, top, ec50, hill], x) => fourPL(bottom, top, ec50, hill, x),
    [bottom0, top0, ec0 || 1, 1]
  );
  const ec50 = fit.params[2];
  return {
    ...fit,
    bottom: fit.params[0],
    top: fit.params[1],
    ec50,
    hill: fit.params[3],
    pEC50: ec50 > 0 ? -Math.log10(ec50) : NaN,
  };
}

/**
 * Cheng-Prusoff: converts an IC50 to the true inhibition constant Ki.
 * Ki = IC50 / (1 + [substrate]/Km) — with (Km, [S]) for enzymes, or (Kd, [L])
 * for radioligand binding.
 */
export function chengPrusoff(ic50: number, substrate: number, km: number): number {
  return ic50 / (1 + substrate / km);
}

// --- receptor / saturation binding ------------------------------------------

/** One-site specific binding: B = Bmax·[L] / (Kd + [L]). */
export function oneSiteBinding(bmax: number, kd: number, ligand: number): number {
  return (bmax * ligand) / (kd + ligand);
}

export interface BindingFit extends FitResult {
  bmax: number;
  kd: number;
  bmaxSE: number;
  kdSE: number;
}

/** Fits one-site saturation binding (Bmax, Kd) to ligand/bound data. */
export function fitSaturationBinding(ligand: number[], bound: number[]): BindingFit {
  // Same hyperbola as Michaelis-Menten, so reuse its stable seeding.
  const seed = fitMichaelisMenten(ligand, bound);
  const bmax0 = seed.vmax > 0 ? seed.vmax : Math.max(...bound);
  const kd0 = seed.km > 0 ? seed.km : ligand[Math.floor(ligand.length / 2)] || 1;
  const fit = levenbergMarquardt(ligand, bound, ([bmax, kd], x) => oneSiteBinding(bmax, kd, x), [bmax0, kd0]);
  return { ...fit, bmax: fit.params[0], kd: fit.params[1], bmaxSE: fit.se[0], kdSE: fit.se[1] };
}

// --- everyday lab calculators (closed form) ---------------------------------

/**
 * Henderson-Hasselbalch: pH = pKa + log10([A⁻]/[HA]).
 * Pass the conjugate-base and acid concentrations (any consistent unit).
 */
export function hendersonHasselbalch(pka: number, base: number, acid: number): number {
  return pka + Math.log10(base / acid);
}

/** Base:acid ratio [A⁻]/[HA] needed to hit a target pH at a given pKa. */
export function bufferRatioForPh(pka: number, ph: number): number {
  return Math.pow(10, ph - pka);
}

/**
 * Beer-Lambert A = ε·c·l. Provide exactly one of {a, c} as null to solve for it;
 * ε in M⁻¹cm⁻¹, path length l in cm, concentration c in M.
 */
export function beerLambert(opts: { a?: number; epsilon: number; c?: number; l?: number }): number {
  const l = opts.l ?? 1;
  if (opts.a === undefined && opts.c !== undefined) return opts.epsilon * opts.c * l; // solve A
  if (opts.c === undefined && opts.a !== undefined) return opts.a / (opts.epsilon * l); // solve c
  return NaN;
}

/** Dilution C1·V1 = C2·V2 — returns the volume of stock (V1) needed. */
export function stockVolumeNeeded(c1: number, c2: number, v2: number): number {
  return c1 === 0 ? NaN : (c2 * v2) / c1;
}

export interface DilutionStep {
  step: number;
  concentration: number;
}

/**
 * Serial-dilution plan: `count` steps starting at `start`, each diluted by
 * `foldPerStep` (e.g. 10 for a 10-fold series). Returns the concentration at
 * each step (step 1 = the starting concentration).
 */
export function serialDilution(start: number, foldPerStep: number, count: number): DilutionStep[] {
  const out: DilutionStep[] = [];
  for (let i = 0; i < count; i++) out.push({ step: i + 1, concentration: start / Math.pow(foldPerStep, i) });
  return out;
}

export type NucleicAcidKind = "dsDNA" | "ssDNA" | "RNA";

const A260_FACTOR: Record<NucleicAcidKind, number> = { dsDNA: 50, ssDNA: 33, RNA: 40 };

/**
 * Nucleic-acid concentration from A260 (µg/mL): A260 × factor × dilution, where
 * the factor is 50 (dsDNA), 33 (ssDNA), or 40 (RNA) µg/mL per absorbance unit.
 */
export function nucleicAcidConc(a260: number, kind: NucleicAcidKind, dilution = 1): number {
  return a260 * A260_FACTOR[kind] * dilution;
}

/**
 * Protein concentration (M) from A280 via Beer-Lambert with a known molar
 * extinction coefficient ε (M⁻¹cm⁻¹) and path length l (cm).
 */
export function proteinConcFromA280(a280: number, epsilon: number, l = 1): number {
  return epsilon === 0 ? NaN : a280 / (epsilon * l);
}
