// Statistics and uncertainty toolkit for the Stats mode: descriptive statistics,
// the common inferential tests (t-tests, one-way ANOVA, linear regression) with
// real p-values, and error propagation through a formula. Aimed at turning
// experimental data into a paper-ready result + reported statistic, offline.
//
// P-values use the regularized incomplete beta function (Student-t and F
// distributions). Pure functions; no Office.js.

// --- basic descriptive statistics -------------------------------------------

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Sample variance (n − 1 denominator). */
export function variance(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1);
}

export function stdev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Descriptive {
  n: number;
  mean: number;
  sd: number;
  /** Standard error of the mean. */
  sem: number;
  variance: number;
  median: number;
  min: number;
  max: number;
  /** Coefficient of variation (sd/mean), as a fraction. */
  cv: number;
  /** 95% confidence interval for the mean (t-based). */
  ci95: [number, number];
}

/** Full descriptive summary of a sample. */
export function describe(xs: number[]): Descriptive {
  const n = xs.length;
  if (n === 0) {
    return { n: 0, mean: NaN, sd: NaN, sem: NaN, variance: NaN, median: NaN, min: NaN, max: NaN, cv: NaN, ci95: [NaN, NaN] };
  }
  const m = mean(xs);
  const sd = stdev(xs);
  const sem = sd / Math.sqrt(n);
  const t = n > 1 ? tCritical(0.05, n - 1) : NaN;
  return {
    n,
    mean: m,
    sd,
    sem,
    variance: variance(xs),
    median: median(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    cv: sd / m,
    ci95: [m - t * sem, m + t * sem],
  };
}

// --- distribution functions (via the regularized incomplete beta) -----------

/** Continued-fraction expansion for the incomplete beta (Numerical Recipes). */
function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Two-tailed p-value for a Student-t statistic with `df` degrees of freedom. */
export function tTestP(t: number, df: number): number {
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

/** Upper-tail p-value for an F statistic (ANOVA / regression). */
export function fTestP(f: number, df1: number, df2: number): number {
  if (f <= 0) return 1;
  return incompleteBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Critical two-tailed t value for significance `alpha` (bisection on tTestP). */
export function tCritical(alpha: number, df: number): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTestP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- inferential tests -------------------------------------------------------

export interface TTestResult {
  t: number;
  df: number;
  p: number;
  meanDifference: number;
}

/**
 * Independent two-sample t-test. Welch's (unequal variances) by default;
 * `pooled` gives Student's pooled-variance test.
 */
export function twoSampleTTest(a: number[], b: number[], pooled = false): TTestResult {
  const na = a.length;
  const nb = b.length;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  let t: number;
  let df: number;
  if (pooled) {
    const sp2 = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
    t = (ma - mb) / Math.sqrt(sp2 * (1 / na + 1 / nb));
    df = na + nb - 2;
  } else {
    const se = Math.sqrt(va / na + vb / nb);
    t = (ma - mb) / se;
    df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1));
  }
  return { t, df, p: tTestP(Math.abs(t), df), meanDifference: ma - mb };
}

/** Paired (dependent) t-test on equal-length samples. */
export function pairedTTest(a: number[], b: number[]): TTestResult {
  const diffs = a.map((x, i) => x - b[i]);
  const n = diffs.length;
  const md = mean(diffs);
  const t = md / (stdev(diffs) / Math.sqrt(n));
  const df = n - 1;
  return { t, df, p: tTestP(Math.abs(t), df), meanDifference: md };
}

export interface AnovaResult {
  f: number;
  dfBetween: number;
  dfWithin: number;
  p: number;
}

/** One-way ANOVA across ≥2 groups. */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const k = groups.length;
  const all = groups.reduce<number[]>((acc, g) => acc.concat(g), []);
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  let n = 0;
  for (const g of groups) {
    const mg = mean(g);
    ssBetween += g.length * (mg - grand) ** 2;
    for (const x of g) ssWithin += (x - mg) ** 2;
    n += g.length;
  }
  const dfBetween = k - 1;
  const dfWithin = n - k;
  const f = ssBetween / dfBetween / (ssWithin / dfWithin);
  return { f, dfBetween, dfWithin, p: fTestP(f, dfBetween, dfWithin) };
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  slopeSE: number;
  /** Two-tailed p-value for the slope ≠ 0. */
  slopeP: number;
  n: number;
}

/** Simple linear regression with the slope's significance test. */
export function linearRegression(x: number[], y: number[]): RegressionResult {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
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
  const rSquared = syy === 0 ? 1 : 1 - ssResid / syy;
  const df = n - 2;
  const slopeSE = Math.sqrt(ssResid / df / sxx);
  const t = slope / slopeSE;
  return { slope, intercept, rSquared, slopeSE, slopeP: tTestP(Math.abs(t), df), n };
}

// --- reporting helpers -------------------------------------------------------

/** APA-style p-value string ("p < .001", "p = .027"). */
export function formatP(p: number): string {
  if (p < 0.001) return "p < .001";
  return `p = ${p.toFixed(3).replace(/^0/, "")}`;
}

/** APA-style t report, e.g. "t(18) = 2.41, p = .027". */
export function reportT(r: TTestResult): string {
  return `t(${r.df.toFixed(r.df % 1 ? 1 : 0)}) = ${r.t.toFixed(2)}, ${formatP(r.p)}`;
}

/** APA-style F report, e.g. "F(2, 27) = 4.31, p = .024". */
export function reportF(r: AnovaResult): string {
  return `F(${r.dfBetween}, ${r.dfWithin}) = ${r.f.toFixed(2)}, ${formatP(r.p)}`;
}

// --- uncertainty propagation -------------------------------------------------

/**
 * Evaluates an arithmetic expression with named variables. Supports + − × ÷,
 * ^ (right-assoc), parentheses, unary minus, and the functions sqrt, exp, ln,
 * log, sin, cos, tan, abs. Used by the uncertainty propagator; throws on a
 * malformed expression or an unknown name.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number {
  const s = expr.replace(/\s+/g, "");
  let i = 0;
  const fns: Record<string, (v: number) => number> = {
    sqrt: Math.sqrt,
    exp: Math.exp,
    ln: Math.log,
    log: Math.log10,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
  };
  function expr_(): number {
    let v = term();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = unary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = unary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function unary(): number {
    if (s[i] === "-") {
      i++;
      return -unary();
    }
    if (s[i] === "+") {
      i++;
      return unary();
    }
    return power();
  }
  function power(): number {
    const base = atom();
    if (s[i] === "^") {
      i++;
      return Math.pow(base, unary());
    }
    return base;
  }
  function atom(): number {
    if (s[i] === "(") {
      i++;
      const v = expr_();
      if (s[i] !== ")") throw new Error("Unbalanced parentheses.");
      i++;
      return v;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (m) {
      const name = m[0];
      i += name.length;
      if (s[i] === "(") {
        i++;
        const arg = expr_();
        if (s[i] !== ")") throw new Error("Unbalanced parentheses.");
        i++;
        const fn = fns[name];
        if (!fn) throw new Error(`Unknown function "${name}".`);
        return fn(arg);
      }
      // User variables win over the built-in constants, so a quantity named
      // "e" (elementary charge, eccentricity) or "pi" isn't silently shadowed.
      if (name in vars) return vars[name];
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      throw new Error(`Unknown variable "${name}".`);
    }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    throw new Error("Could not parse the expression.");
  }
  const result = expr_();
  if (i !== s.length) throw new Error("Unexpected trailing characters.");
  return result;
}

export interface UncertaintyResult {
  value: number;
  uncertainty: number;
  /** Per-variable contribution to the combined variance (largest first). */
  contributions: { name: string; contribution: number }[];
}

/**
 * Propagates independent measurement uncertainties through `expr` using the
 * standard first-order (partial-derivative-in-quadrature) method, with the
 * partials computed by central finite differences. `inputs` maps each variable
 * to its value and 1σ uncertainty.
 */
export function propagateUncertainty(
  expr: string,
  inputs: Record<string, { value: number; uncertainty: number }>
): UncertaintyResult {
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(inputs)) values[k] = v.value;
  const value = evalFormula(expr, values);

  let varianceSum = 0;
  const contributions: { name: string; contribution: number }[] = [];
  for (const [name, { value: v0, uncertainty }] of Object.entries(inputs)) {
    const h = Math.max(1e-8, 1e-6 * Math.abs(v0));
    const up = { ...values, [name]: v0 + h };
    const dn = { ...values, [name]: v0 - h };
    const partial = (evalFormula(expr, up) - evalFormula(expr, dn)) / (2 * h);
    const contribution = (partial * uncertainty) ** 2;
    varianceSum += contribution;
    contributions.push({ name, contribution });
  }
  contributions.sort((a, b) => b.contribution - a.contribution);
  return { value, uncertainty: Math.sqrt(varianceSum), contributions };
}
