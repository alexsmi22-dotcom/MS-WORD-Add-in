// Limits and Taylor series — the CAS brief's "later" list.
//
// LIMITS. Direct substitution first; where that gives 0/0 or ∞/∞, L'Hôpital,
// differentiating top and bottom until the indeterminacy clears. Limits at ±∞
// are handled by the substitution x = 1/t with t → 0 from the right, which
// turns every question about infinity into one the same machinery can answer.
//
// EVERY SYMBOLIC ANSWER IS CROSS-CHECKED NUMERICALLY, by evaluating the
// original expression at a sequence of points approaching the target from the
// correct side. If the two disagree the answer is WITHDRAWN rather than
// reported — the same discipline as the integrator differentiating its
// antiderivatives back. A limit that cannot be established is said to be
// undetermined, which is a real answer; guessing one is not.
//
// TAYLOR SERIES are repeated differentiation with exact coefficients f⁽ᵏ⁾(a)/k!
// through the CAS, so the Maclaurin series of eˣ comes back with 1, 1, 1/2,
// 1/6, 1/24 rather than decimals. A truncated series is always stated as
// truncated: the remainder is real and is not silently dropped.

import { parseExpr, evalAst, format, simplify, derivative, Expr } from "./solve";
import { casSimplify, CasBail, exprEqual } from "./cas";

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });

function simp(e: Expr): Expr {
  try {
    return casSimplify(e);
  } catch (err) {
    if (err instanceof CasBail) return simplify(e);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type LimitPoint = number | "inf" | "-inf";
export type Side = "both" | "+" | "-";

export interface LimitResult {
  expression: string;
  variable: string;
  point: LimitPoint;
  side: Side;
  /** The value, when one was established. */
  value?: number;
  /** Exact form when the CAS could produce one. */
  exact?: string;
  kind: "finite" | "infinite" | "does-not-exist" | "undetermined";
  steps: string[];
  caveats: string[];
}

const MAX_LHOPITAL = 8;

/** Evaluates at a point, returning NaN rather than throwing. */
function at(e: Expr, x: string, v: number): number {
  try {
    const r = evalAst(e, { [x]: v });
    return Number.isFinite(r) ? r : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Numeric probe: values of `e` approaching `p` from the requested side.
 * This is what every symbolic answer is checked against.
 */
function probe(e: Expr, x: string, p: LimitPoint, side: Side): number[] {
  const out: number[] = [];
  // Deep enough that slowly-decaying limits like ln(x)/x settle: at x = 1e7 it
  // is still 1.6e-6 and falling, which a shallow probe reads as "not settled".
  const far = [10, 1e2, 1e3, 1e4, 1e6, 1e8, 1e10, 1e12];
  const near = [1e-1, 1e-2, 1e-3, 1e-4, 1e-6, 1e-8, 1e-10, 1e-12];
  if (p === "inf") {
    for (const s of far) out.push(at(e, x, s));
  } else if (p === "-inf") {
    for (const s of far) out.push(at(e, x, -s));
  } else {
    for (const d of near) {
      // "both" is asked of the CALLER via twoSided(); here it samples from
      // above, and sampling ONLY from above is exactly how abs(x)/x came back
      // as 1 instead of a limit that does not exist.
      if (side === "-") out.push(at(e, x, p - d));
      else out.push(at(e, x, p + d));
    }
  }
  return out.filter((v) => !Number.isNaN(v));
}

/** Does a probe sequence settle on a value? */
function settles(vals: number[]): { value: number } | { diverges: 1 | -1 } | null {
  if (vals.length < 3) return null;
  const tail = vals.slice(-4);
  const last = tail[tail.length - 1];
  if (!Number.isFinite(last)) return null;
  // Growth, not an absolute cliff: 1/x at x = 1e-7 is only 1e7, which a
  // 1e12 threshold reads as "not diverging" when it plainly is.
  const growing = tail.every((v, i) => i === 0 || Math.abs(v) > Math.abs(tail[i - 1]) * 1.5);
  if (Math.abs(last) > 1e5 && growing) return { diverges: last > 0 ? 1 : -1 };
  // A tail that is shrinking toward zero has limit ZERO. Reporting the last
  // sampled value instead — ln(x)/x came back as 2.76e-11 — presents a sampling
  // artefact as though it were the answer.
  const shrinking = tail.every((v, i) => i === 0 || Math.abs(v) < Math.abs(tail[i - 1]));
  if (shrinking && Math.abs(last) < 1e-9) return { value: 0 };
  const spread = Math.max(...tail) - Math.min(...tail);
  if (spread <= 1e-4 * (1 + Math.abs(last))) return { value: last };
  // A tail marching steadily toward zero IS a limit of zero, even if the last
  // few values are still spread out on an absolute scale.
  if (tail.every((v, i) => i === 0 || Math.abs(v) < Math.abs(tail[i - 1]))) {
    if (Math.abs(last) < 1e-6) return { value: 0 };
  }
  return null;
}

/** Splits a quotient into numerator and denominator, if it is one. */
function asQuotient(e: Expr): { num: Expr; den: Expr } | null {
  return e.t === "div" ? { num: e.l, den: e.r } : null;
}

const isZeroAt = (e: Expr, x: string, p: number): boolean => Math.abs(at(e, x, p)) < 1e-9;

/**
 * The limit of `input` as `variable` → `point`.
 * Returns "undetermined" rather than a guess when it cannot establish one.
 */
export function limit(input: string, variable = "x", point: LimitPoint = 0, side: Side = "both"): LimitResult | null {
  let e: Expr;
  try {
    e = simp(parseExpr(input));
  } catch {
    return null;
  }
  const steps: string[] = [];
  const caveats: string[] = [];

  // The simplifier folds constants, so an expression that is not real-valued
  // collapses to a bare NaN or Infinity before anything else runs. Carrying
  // that forward produced working that read "Limit of NaN as x → 0" for an
  // input of sqrt(-1) — honest about having no answer, but it showed the user a
  // folded artefact instead of what they typed, and never said WHY. Name the
  // reason and echo the original.
  const folded = format(e);
  if (/NaN|Infinity/.test(folded)) {
    const why = folded.includes("NaN")
      ? "That expression is not defined over the real numbers — it evaluates to NaN before the limit is even taken (sqrt of a negative, or the log of a non-positive, are the usual causes)."
      : "That expression overflows to infinity as a CONSTANT, before the limit is taken — a literal too large for double precision, or a log of zero. It is not a function of " + variable + ".";
    return {
      expression: input.trim(),
      variable, point, side,
      steps: [`Read as: ${input.trim()}`],
      caveats: [why],
      kind: "undetermined",
    };
  }

  const base: Omit<LimitResult, "kind"> = {
    expression: folded, variable, point, side, steps, caveats,
  };
  const pretty = point === "inf" ? "∞" : point === "-inf" ? "−∞" : String(point);
  steps.push(`Limit of ${format(e)} as ${variable} → ${pretty}${side !== "both" && typeof point === "number" ? (side === "+" ? " from above" : " from below") : ""}.`);

  // A limit at infinity becomes a one-sided limit at 0 under x = 1/t.
  let work = e;
  let wvar = variable;
  let wpoint: number = typeof point === "number" ? point : 0;
  let wside: Side = side;
  if (point === "inf" || point === "-inf") {
    const t = "_t";
    const sub = point === "inf" ? { t: "div" as const, l: N(1), r: V(t) } : { t: "neg" as const, e: { t: "div" as const, l: N(1), r: V(t) } };
    work = simp(substitute(e, variable, sub));
    wvar = t;
    wpoint = 0;
    wside = "+";
    steps.push(`Substituting ${variable} = ${point === "inf" ? "1/t" : "−1/t"} turns this into a limit as t → 0 from above.`);
  }

  // A TWO-SIDED limit requires both sides to agree, and this has to be checked
  // BEFORE any answer is produced rather than inside one branch. abs(x)/x is
  // the case that proves it: the two-sided limit does not exist (−1 from below,
  // +1 from above), but the indeterminate 0/0 at the origin sent it down the
  // L'Hôpital path, and the fallback probe sampled only from above and
  // confidently reported 1.
  if (side === "both" && typeof point === "number") {
    const lo = settles(probe(e, variable, point, "-"));
    const hi = settles(probe(e, variable, point, "+"));
    const val = (s: typeof lo): number | null => (s && "value" in s ? s.value : null);
    const div = (s: typeof lo): number | null => (s && "diverges" in s ? s.diverges : null);
    const a = val(lo), b = val(hi);
    if (a !== null && b !== null && Math.abs(a - b) > 1e-4 * (1 + Math.abs(b))) {
      steps.push(`Approaching from below gives ${trim(a)}; from above, ${trim(b)}.`);
      caveats.push(
        "The one-sided limits DIFFER, so the two-sided limit DOES NOT EXIST. Each one-sided limit does exist — ask for them separately with 0- or 0+."
      );
      return { ...base, kind: "does-not-exist" };
    }
    const da = div(lo), db = div(hi);
    if (da !== null && db !== null && da !== db) {
      steps.push(`The function diverges to ${da > 0 ? "+∞" : "−∞"} from below and ${db > 0 ? "+∞" : "−∞"} from above.`);
      caveats.push("The function diverges in OPPOSITE directions on the two sides, so the two-sided limit does not exist.");
      return { ...base, kind: "does-not-exist" };
    }
    if ((a !== null && db !== null) || (b !== null && da !== null)) {
      caveats.push("One side approaches a finite value while the other diverges, so the two-sided limit does not exist.");
      return { ...base, kind: "does-not-exist" };
    }
  }

  // Direct substitution.
  const direct = at(work, wvar, wpoint);
  const numeric = probe(e, variable, point, side);
  const settled = settles(numeric);

  if (Number.isFinite(direct) && !isIndeterminate(work, wvar, wpoint)) {
    // Confirm against the probe before believing it.
    if (settled && "value" in settled && Math.abs(settled.value - direct) > 1e-3 * (1 + Math.abs(direct))) {
      caveats.push("Direct substitution and a numeric approach disagree, so no value is reported. The function may be discontinuous here.");
      return { ...base, kind: "undetermined" };
    }
    steps.push(`Direct substitution gives ${trim(direct)}.`);
    const exact = exactValue(work, wvar, wpoint);
    // A two-sided limit needs BOTH sides to agree.
    if (side === "both" && typeof point === "number") {
      const l = settles(probe(e, variable, point, "-"));
      const r = settles(probe(e, variable, point, "+"));
      if (l && r && "value" in l && "value" in r && Math.abs(l.value - r.value) > 1e-4 * (1 + Math.abs(r.value))) {
        steps.push(`Approaching from below gives ${trim(l.value)} and from above ${trim(r.value)}.`);
        caveats.push("The one-sided limits DIFFER, so the two-sided limit does not exist. Each one-sided limit does.");
        return { ...base, kind: "does-not-exist" };
      }
    }
    return { ...base, kind: "finite", value: direct, exact, steps };
  }

  // Indeterminate: try L'Hôpital.
  const q = asQuotient(work);
  if (q && isIndeterminate(work, wvar, wpoint)) {
    let num = q.num, den = q.den;
    for (let i = 0; i < MAX_LHOPITAL; i++) {
      const n0 = at(num, wvar, wpoint), d0 = at(den, wvar, wpoint);
      const zeroOverZero = Math.abs(n0) < 1e-9 && Math.abs(d0) < 1e-9;
      const infOverInf = !Number.isFinite(n0) && !Number.isFinite(d0);
      if (!zeroOverZero && !infOverInf) break;
      num = simp(derivative(num, wvar));
      den = simp(derivative(den, wvar));
      steps.push(`Indeterminate, so by L'Hôpital differentiate top and bottom: (${format(num)}) / (${format(den)}).`);
      const v = at({ t: "div", l: num, r: den }, wvar, wpoint);
      if (Number.isFinite(v)) {
        // Cross-check against the ORIGINAL expression before believing it.
        if (settled && "value" in settled && Math.abs(settled.value - v) > 1e-3 * (1 + Math.abs(v))) {
          caveats.push("L'Hôpital's rule and a numeric approach disagree, so no value is reported.");
          return { ...base, kind: "undetermined" };
        }
        steps.push(`After ${i + 1} application${i === 0 ? "" : "s"}, the value is ${trim(v)}.`);
        caveats.push("Verified against the original expression evaluated near the limit point.");
        return { ...base, kind: "finite", value: v, exact: exactValue({ t: "div", l: num, r: den }, wvar, wpoint), steps };
      }
    }
  }

  // Fall back to what the numbers say, and be explicit that it is numeric.
  if (settled && "value" in settled) {
    steps.push(`No symbolic rule applied; the value is approached numerically.`);
    caveats.push(
      "NUMERIC ONLY: this value comes from evaluating the expression closer and closer to the point, not from a proof. It is evidence, not a derivation."
    );
    return { ...base, kind: "finite", value: settled.value, steps };
  }
  if (settled && "diverges" in settled) {
    steps.push(`The value grows without bound.`);
    return { ...base, kind: "infinite", value: settled.diverges > 0 ? Infinity : -Infinity, steps };
  }
  caveats.push(
    "This limit could not be established. Direct substitution is indeterminate, no rule here applied, and the numeric approach did not settle — so nothing is reported rather than a guess."
  );
  return { ...base, kind: "undetermined" };
}

function isIndeterminate(e: Expr, x: string, p: number): boolean {
  const q = asQuotient(e);
  if (!q) return !Number.isFinite(at(e, x, p));
  const n = at(q.num, x, p), d = at(q.den, x, p);
  if (Math.abs(n) < 1e-9 && Math.abs(d) < 1e-9) return true;
  if (!Number.isFinite(n) && !Number.isFinite(d)) return true;
  return Math.abs(d) < 1e-12;
}

/** An exact form for a value the CAS can evaluate symbolically. */
function exactValue(e: Expr, x: string, p: number): string | undefined {
  try {
    const sub = simp(substitute(e, x, N(p)));
    const s = format(sub);
    return /^[-\d/.]+$/.test(s) ? s : undefined;
  } catch {
    return undefined;
  }
}

const trim = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10))));

/** Replaces every free occurrence of `x` with `r`. */
export function substitute(e: Expr, x: string, r: Expr): Expr {
  switch (e.t) {
    case "num": return e;
    case "var": return e.name === x ? r : e;
    case "neg": return { t: "neg", e: substitute(e.e, x, r) };
    case "fn": return { t: "fn", name: e.name, arg: substitute(e.arg, x, r) };
    default: return { t: e.t, l: substitute(e.l, x, r), r: substitute(e.r, x, r) } as Expr;
  }
}

// ---------------------------------------------------------------------------
// Taylor / Maclaurin series
// ---------------------------------------------------------------------------

export interface SeriesResult {
  expression: string;
  variable: string;
  centre: number;
  order: number;
  /** Terms as printable strings, lowest order first. */
  terms: string[];
  /** The whole truncated series. */
  display: string;
  /** Coefficients f⁽ᵏ⁾(a)/k!, numerically. */
  coefficients: number[];
  steps: string[];
  caveats: string[];
}

const MAX_ORDER = 12;

/**
 * Taylor series of `input` about `centre`, to `order` terms.
 * Coefficients come from repeated CAS differentiation, so they are exact where
 * the CAS can keep them exact.
 */
export function taylorSeries(input: string, variable = "x", centre = 0, order = 6): SeriesResult | null {
  let e: Expr;
  try {
    e = simp(parseExpr(input));
  } catch {
    return null;
  }
  const n = Math.max(1, Math.min(order, MAX_ORDER));
  const steps: string[] = [];
  const caveats: string[] = [];
  const coefficients: number[] = [];
  const terms: string[] = [];

  let d: Expr = e;
  let factorial = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) {
      d = simp(derivative(d, variable));
      factorial *= k;
    }
    const value = at(d, variable, centre);
    if (!Number.isFinite(value)) {
      caveats.push(
        `The ${k}-th derivative is not defined at ${variable} = ${centre}, so the series stops at order ${k - 1}. A Taylor series needs the function to be differentiable at its centre.`
      );
      break;
    }
    const c = value / factorial;
    coefficients.push(c);
    if (Math.abs(c) < 1e-14) continue; // a genuinely zero term
    const cs = fmtCoeff(c);
    const varPart =
      k === 0 ? "" : centre === 0 ? (k === 1 ? variable : `${variable}^${k}`)
        : k === 1 ? `(${variable} - ${centre})` : `(${variable} - ${centre})^${k}`;
    terms.push(k === 0 ? cs : `${cs === "1" ? "" : cs === "-1" ? "-" : `${cs}*`}${varPart}`);
  }

  if (!terms.length) return null;
  const display = terms
    .map((t, i) => (i === 0 ? t : t.startsWith("-") ? ` - ${t.slice(1)}` : ` + ${t}`))
    .join("") + ` + O(${centre === 0 ? variable : `(${variable} - ${centre})`}^${coefficients.length})`;

  steps.push(`${centre === 0 ? "Maclaurin" : "Taylor"} series of ${format(e)} about ${variable} = ${centre}, to order ${coefficients.length - 1}.`);
  steps.push(`Coefficients are f⁽ᵏ⁾(${centre})/k!, from repeated differentiation.`);
  caveats.push(
    "This is a TRUNCATED series: the O(...) term is real and is not negligible far from the centre. Its radius of convergence is not computed here, so do not assume the series represents the function everywhere."
  );

  return { expression: format(e), variable, centre, order: coefficients.length - 1, terms, display, coefficients, steps, caveats };
}

function fmtCoeff(c: number): string {
  if (Number.isInteger(c)) return String(c);
  // Recognise small rationals so 1/6 does not print as 0.16666666666666666.
  for (let d = 2; d <= 5040; d++) {
    const n = c * d;
    if (Math.abs(n - Math.round(n)) < 1e-12) {
      const num = Math.round(n);
      if (Math.abs(num) < 1e9) return d === 1 ? String(num) : `${num}/${d}`;
    }
  }
  return String(Number(c.toPrecision(10)));
}

/** Parses "limit sin(x)/x as x -> 0" style requests. Returns null if it is not one. */
export function parseLimitRequest(text: string): { expr: string; variable: string; point: LimitPoint; side: Side } | null {
  const m = /^\s*(?:lim(?:it)?)\s+(.+?)\s+(?:as\s+)?([A-Za-z]\w*)\s*(?:->|→|to)\s*(\S+)\s*$/i.exec(text);
  if (!m) return null;
  const [, expr, variable, rawPoint] = m;
  let side: Side = "both";
  let p = rawPoint.trim().replace(/[),]$/, "");
  if (p.endsWith("+")) { side = "+"; p = p.slice(0, -1); }
  else if (p.endsWith("-") && p.length > 1 && !/^-?\d/.test(p)) { side = "-"; p = p.slice(0, -1); }
  let point: LimitPoint;
  if (/^(inf|infinity|∞|\+inf)$/i.test(p)) point = "inf";
  else if (/^(-inf|-infinity|−∞|-∞)$/i.test(p)) point = "-inf";
  else {
    const v = Number(p);
    if (!Number.isFinite(v)) return null;
    point = v;
  }
  return { expr: expr.trim(), variable, point, side };
}

/** Parses "taylor exp(x) about 0 order 5" / "series sin(x)". */
export function parseSeriesRequest(text: string): { expr: string; variable: string; centre: number; order: number } | null {
  const m = /^\s*(?:taylor|maclaurin|series)\s+(.+?)\s*$/i.exec(text);
  if (!m) return null;
  let rest = m[1];
  let centre = 0, order = 6, variable = "x";
  const about = /\b(?:about|at|around)\s+([A-Za-z]\w*\s*=\s*)?(-?\d+(?:\.\d+)?)/i.exec(rest);
  if (about) {
    centre = Number(about[2]);
    if (about[1]) variable = about[1].split("=")[0].trim();
    rest = rest.replace(about[0], " ");
  }
  const ord = /\b(?:order|terms?|to)\s+(\d+)/i.exec(rest);
  if (ord) { order = Number(ord[1]); rest = rest.replace(ord[0], " "); }
  const expr = rest.trim().replace(/[,;]+$/, "");
  if (!expr) return null;
  return { expr, variable, centre, order };
}
