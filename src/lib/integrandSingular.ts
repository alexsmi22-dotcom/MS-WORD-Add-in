// WHERE AN INTEGRAND BLOWS UP, AND WHAT THAT DOES TO ITS INTEGRAL.
//
// Review 2026-10-24 found a run of confident wrong definite integrals, all of one shape: a singularity that the
// old detector could not SEE (it found zeros of POLYNOMIAL denominators and the poles of tan/cot/sec/csc only,
// then sampled a grid — and sampling cannot find poles):
//   ∫₀² 1/cos x = 5.48 and ∫₀² 1/cos² x = 8.3×10¹⁶  (both diverge at π/2)
//   ∫₁⁴ 1/sin x, ∫₁⁴ x/sin x                        (diverge at π)
//   ∫₀¹ 1/(sin x − 0.5) "removable singularity"     (diverges at π/6)
//   ∫₀¹ 1/(eˣ − 2) "exact" by the fundamental theorem straight across the pole at ln 2
//   ∫₋₁¹ 1/√|x| = 3.985 and ∫₀² 1/√|x − 1| = 3.985  (both converge, to exactly 4)
//   ∫₀¹ sin(1/x) = 0.49988                          (0.5040671; bounded but oscillating without limit at 0)
//
// This module LOCATES the candidate points from the structure of the expression — every denominator, every
// negative-power base, the cos/sin behind tan/sec/cot/csc, every log argument — by bracketing sign changes AND
// local minima of |denominator| on a dense grid, refined by bisection / golden section. Then it CLASSIFIES each
// point from the integrand's own behaviour on each side, at a ladder of distances:
//   regular      finite and continuous there
//   removable    both one-sided limits exist and AGREE (never called without the two-sided check)
//   jump         both exist and differ
//   integrable   |f| grows like |x − t|^(−p) with p clearly below 1 (or logarithmically)
//   divergent    |f| grows like |x − t|^(−p) with p ≥ 1 — the integral does not exist, refused by name
//   oscillatory  bounded but with no limit (sin(1/x) at 0)
//   undecided    none of the above with margin — refused rather than guessed at
//   domain       undefined on one side (√ or ln of a negative number) — the caller's existing refusal applies
// and it integrates across the integrable ones by splitting at them and using tanh-sinh quadrature, which never
// evaluates an endpoint and converges for algebraic endpoint singularities; an oscillatory endpoint gets an honest
// error bound instead of false digits.
//
// Pure functions over a caller-supplied evaluator: no runtime import of solve.ts (which imports this file).

import type { Expr } from "./solve";

export type SingularKind =
  | "regular" | "removable" | "jump" | "integrable" | "divergent" | "oscillatory" | "undecided" | "domain" | "overflow";

export interface SingularPoint {
  at: number;
  kind: SingularKind;
  /** Growth order estimate (|f| ~ |x − t|^(−p)) on the worse side, when it grows. */
  p?: number;
  /** Interval endpoint (one-sided analysis) or interior point. */
  endpoint: boolean;
}

export interface SingularScan {
  points: SingularPoint[];
  /** First x where the integrand overflows to ±∞ away from every located singularity (eˣ² past x ≈ 26.6). */
  overflowAt?: number;
}

type Ev = (e: Expr, t: number) => number;

const GRID = 2048;
const MAX_DENOMS = 12;

function containsX(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num": return false;
    case "var": return e.name === x;
    case "neg": return containsX(e.e, x);
    case "fn": return containsX(e.arg, x);
    default: return containsX(e.l, x) || containsX(e.r, x);
  }
}

function constOf(e: Expr): number | null {
  if (e.t === "num") return e.v;
  if (e.t === "neg") {
    const v = constOf(e.e);
    return v === null ? null : -v;
  }
  if (e.t === "div") {
    const l = constOf(e.l), r = constOf(e.r);
    return l === null || r === null || r === 0 ? null : l / r;
  }
  return null;
}

/** Sub-expressions whose zeros can make the integrand blow up. */
function denominators(e: Expr, x: string, out: Expr[]): void {
  if (out.length >= MAX_DENOMS) return;
  switch (e.t) {
    case "num": case "var": return;
    case "neg": denominators(e.e, x, out); return;
    case "add": case "sub": case "mul":
      denominators(e.l, x, out); denominators(e.r, x, out); return;
    case "div":
      denominators(e.l, x, out); denominators(e.r, x, out);
      if (containsX(e.r, x)) out.push(e.r);
      return;
    case "pow": {
      denominators(e.l, x, out); denominators(e.r, x, out);
      const p = constOf(e.r);
      if (p !== null && p < 0 && containsX(e.l, x)) out.push(e.l);
      return;
    }
    case "fn":
      denominators(e.arg, x, out);
      if (!containsX(e.arg, x)) return;
      if (e.name === "tan" || e.name === "sec") out.push({ t: "fn", name: "cos", arg: e.arg });
      else if (e.name === "cot" || e.name === "csc") out.push({ t: "fn", name: "sin", arg: e.arg });
      else if (e.name === "ln" || e.name === "log" || e.name === "log10" || e.name === "log2") out.push(e.arg);
      return;
  }
}

/** Zeros of g on [lo, hi]: sign changes (bisection) and touching minima of |g| (golden section). */
function zerosOf(g: (t: number) => number, lo: number, hi: number): number[] {
  const n = GRID;
  const ts: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    let v: number;
    try { v = g(t); } catch { v = NaN; }
    ts.push(t);
    vs.push(v);
  }
  const finite = vs.filter((v) => Number.isFinite(v)).map(Math.abs);
  const scale = finite.length ? Math.max(...finite, 1e-300) : 1;
  const found: number[] = [];
  const g0 = (t: number): number => {
    try { return g(t); } catch { return NaN; }
  };
  for (let i = 0; i <= n; i++) {
    const v = vs[i];
    if (v === 0) { found.push(ts[i]); continue; }
    if (i < n && Number.isFinite(v) && Number.isFinite(vs[i + 1]) && vs[i + 1] !== 0 && (v > 0) !== (vs[i + 1] > 0)) {
      let p = ts[i], q = ts[i + 1], fp = v;
      for (let k = 0; k < 200 && q - p > 0; k++) {
        const m = (p + q) / 2;
        if (m === p || m === q) break;
        const fm = g0(m);
        if (!Number.isFinite(fm)) break;
        if (fm === 0) { p = q = m; break; }
        if ((fm > 0) === (fp > 0)) { p = m; fp = fm; } else q = m;
      }
      found.push((p + q) / 2);
      continue;
    }
    // A touching zero (cos², |x − c|^½): a local minimum of |g| far below the scale, refined by golden section.
    if (i > 0 && i < n && Number.isFinite(v) && Number.isFinite(vs[i - 1]) && Number.isFinite(vs[i + 1]) &&
        Math.abs(v) <= Math.abs(vs[i - 1]) && Math.abs(v) <= Math.abs(vs[i + 1]) && Math.abs(v) < 1e-3 * scale) {
      let a = ts[i - 1], b = ts[i + 1];
      const R = (Math.sqrt(5) - 1) / 2;
      let c = b - R * (b - a), d = a + R * (b - a);
      let fc = Math.abs(g0(c)), fd = Math.abs(g0(d));
      for (let k = 0; k < 200 && b - a > 0; k++) {
        if (!(fc <= fd)) { a = c; c = d; fc = fd; d = a + R * (b - a); fd = Math.abs(g0(d)); }
        else { b = d; d = c; fd = fc; c = b - R * (b - a); fc = Math.abs(g0(c)); }
        if (c === d || !(b - a > 1e-17 * Math.max(1, Math.abs(a)))) break;
      }
      const t = (a + b) / 2;
      const gv = Math.abs(g0(t));
      if (Number.isFinite(gv) && gv <= 1e-8 * scale) found.push(t);
    }
  }
  return found;
}

interface SideInfo {
  kind: "limit" | "grows" | "oscillates" | "nan" | "unclear" | "overflow";
  limit?: number;
  p?: number;
}

/** The integrand's behaviour approaching t from side s (+1 right, −1 left), starting H away. */
function side(f: (t: number) => number, t: number, s: number, H: number): SideInfo {
  const hs: number[] = [];
  for (let k = 0; k <= 10; k++) hs.push(H * Math.pow(10, -k / 2)); // five decades
  const vs: number[] = [];
  for (const h of hs) {
    let v: number;
    try { v = f(t + s * h); } catch { v = NaN; }
    if (Number.isNaN(v)) return { kind: "nan" };
    vs.push(v);
  }
  // Infinite already at the FARTHEST probe is overflow (eˣ² near 30), not a pole: a pole is finite away from it.
  if (!Number.isFinite(vs[0])) return { kind: "overflow" };
  if (vs.some((v) => !Number.isFinite(v))) return { kind: "grows", p: Infinity };
  const a = vs.map(Math.abs);
  const n = vs.length;
  // A LIMIT: some window of four consecutive probes agrees to 10⁻⁴, and nothing nearer grows away from it.
  // Not just the nearest four — cancellation ((1 − cos x)/x² at 10⁻⁷) turns the nearest probes into noise around
  // a perfectly good limit, and that noise must not read as oscillation.
  for (let i = 1; i + 4 <= n; i++) {
    const w = vs.slice(i, i + 4);
    const L = w[3];
    const tol = 1e-4 * Math.max(1, Math.abs(L));
    if (Math.max(...w) - Math.min(...w) > tol) continue;
    const rest = a.slice(i + 4);
    if (rest.every((r) => r <= 2 * Math.max(1, Math.abs(L)))) return { kind: "limit", limit: L };
  }
  let monotone = true;
  for (let i = 4; i < n; i++) if (!(a[i] > a[i - 1])) monotone = false;
  if (monotone && a[n - 1] > a[4]) {
    // Order of growth over the last two decades, and over the two before — they must tell one story.
    const p2 = Math.log(a[n - 1] / a[n - 5]) / Math.log(hs[n - 5] / hs[n - 1]);
    const p1 = Math.log(a[n - 5] / a[n - 9]) / Math.log(hs[n - 9] / hs[n - 5]);
    return { kind: "grows", p: Math.max(p1, p2) };
  }
  // Judged on the NEAR half of the ladder only: the far probes can sit outside the asymptotic regime (sin(100x)
  // approaching π swings through a whole period at the first probes and then settles linearly to 0).
  // Monotone with shrinking steps (√h → 0 approaching 0) is slow convergence to a limit, not oscillation.
  const T = 4;
  let mono = true, shrinking = true, turns = 0;
  const dir = Math.sign(vs[n - 1] - vs[T]);
  for (let i = T + 1; i < n; i++) {
    if (Math.sign(vs[i] - vs[i - 1]) !== dir && vs[i] !== vs[i - 1]) mono = false;
    if (i >= T + 2 && Math.abs(vs[i] - vs[i - 1]) > Math.abs(vs[i - 1] - vs[i - 2]) * 1.0001) shrinking = false;
    if (i >= T + 2 && Math.sign(vs[i] - vs[i - 1]) * Math.sign(vs[i - 1] - vs[i - 2]) < 0) turns++;
  }
  if (mono && shrinking) return { kind: "limit", limit: vs[n - 1] };
  const env0 = Math.max(...a.slice(0, 4)), env1 = Math.max(...a.slice(n - 4));
  if (turns >= 2 && env1 <= 10 * env0 + 1e-300) return { kind: "oscillates" };
  return { kind: "unclear" };
}

function classify(f: (t: number) => number, t: number, lo: number, hi: number, room: number): SingularPoint {
  const endpoint = t <= lo || t >= hi;
  const H = Math.max(1e-300, Math.min(1e-2 * Math.max(1, Math.abs(t)), room / 4));
  let atT: number;
  try { atT = f(t); } catch { atT = NaN; }
  // CONTINUOUS AT t — finite there and matching its nearest neighbours — is regular, whatever the far probes do.
  if (Number.isFinite(atT)) {
    const hmin = H * 1e-5;
    const near = [t > lo ? -1 : 0, t < hi ? 1 : 0].filter((s) => s !== 0).map((s) => {
      try { return f(t + s * hmin); } catch { return NaN; }
    });
    if (near.every((v) => Number.isFinite(v) && Math.abs(v - atT) <= 1e-3 * Math.max(1, Math.abs(atT)))) {
      return { at: t, kind: "regular", endpoint };
    }
  }
  const sides: SideInfo[] = [];
  if (t > lo) sides.push(side(f, t, -1, H));
  if (t < hi) sides.push(side(f, t, 1, H));
  if (sides.some((s) => s.kind === "nan")) return { at: t, kind: "domain", endpoint };
  if (sides.some((s) => s.kind === "overflow")) return { at: t, kind: "overflow", endpoint };
  const grows = sides.filter((s) => s.kind === "grows");
  if (grows.length) {
    const p = Math.max(...grows.map((s) => s.p ?? Infinity));
    if (p >= 0.95) return { at: t, kind: "divergent", p, endpoint };
    if (p > 0.9) return { at: t, kind: "undecided", p, endpoint };
    if (sides.some((s) => s.kind === "oscillates" || s.kind === "unclear")) return { at: t, kind: "undecided", p, endpoint };
    return { at: t, kind: "integrable", p, endpoint };
  }
  if (sides.some((s) => s.kind === "unclear")) return { at: t, kind: "undecided", endpoint };
  if (sides.some((s) => s.kind === "oscillates")) return { at: t, kind: "oscillatory", endpoint };
  // Every side has a limit — but a limit approached through endless sign changes (x·sin(1/x) at 0) still defeats
  // quadrature near t: Gauss-Legendre "converged" there to 0.3785061 against a true 0.3785300. Count sign changes
  // of f over four decades of distance; many of them make the point oscillatory (integrated with an error bound).
  for (const s of t > lo && t < hi ? [-1, 1] : t <= lo ? [1] : [-1]) {
    let changes = 0, prevSign = 0;
    for (let k = 0; k < 200; k++) {
      let v: number;
      try { v = f(t + s * H * Math.pow(10, (-4 * k) / 199)); } catch { v = NaN; }
      if (!Number.isFinite(v) || v === 0) continue;
      const sg = v > 0 ? 1 : -1;
      if (prevSign !== 0 && sg !== prevSign) changes++;
      prevSign = sg;
    }
    if (changes >= 6) return { at: t, kind: "oscillatory", endpoint };
  }
  const lims = sides.map((s) => s.limit as number);
  const agree = lims.every((l) => Math.abs(l - lims[0]) <= 1e-4 * Math.max(1, Math.abs(lims[0])));
  if (!agree) return { at: t, kind: "jump", endpoint };
  if (Number.isFinite(atT) && Math.abs(atT - lims[0]) <= 1e-4 * Math.max(1, Math.abs(lims[0]))) return { at: t, kind: "regular", endpoint };
  return { at: t, kind: "removable", endpoint };
}

/**
 * Locates and classifies every point of [lo, hi] where the integrand can fail to be a nice function. Bounded work:
 * at most MAX_DENOMS denominators × (GRID + refinement) evaluations, plus one grid of the integrand.
 */
export function scanSingularities(e: Expr, x: string, lo: number, hi: number, ev: Ev): SingularScan {
  const f = (t: number): number => ev(e, t);
  const dens: Expr[] = [];
  denominators(e, x, dens);
  const cands: number[] = [];
  for (const d of dens) for (const z of zerosOf((t) => ev(d, t), lo, hi)) cands.push(z);
  // Endpoints are always looked at (one-sided), and so is every grid point where the integrand itself is not finite.
  cands.push(lo, hi);
  const grid: Array<{ t: number; v: number }> = [];
  for (let i = 0; i <= GRID; i++) {
    const t = lo + ((hi - lo) * (i + (i > 0 && i < GRID ? 0.381966011250105 : 0))) / GRID;
    let v: number;
    try { v = f(t); } catch { v = NaN; }
    grid.push({ t, v });
  }
  cands.sort((p, q) => p - q);
  const uniq: number[] = [];
  const tol = (hi - lo) * 1e-9;
  for (const c of cands) if (!uniq.length || c - uniq[uniq.length - 1] > tol) uniq.push(c);
  const points: SingularPoint[] = [];
  for (let i = 0; i < uniq.length; i++) {
    const t = uniq[i];
    const prev = i > 0 ? t - uniq[i - 1] : Infinity;
    const next = i < uniq.length - 1 ? uniq[i + 1] - t : Infinity;
    const room = Math.min(prev, next, hi - lo);
    const pt = classify(f, t, lo, hi, room);
    if (pt.kind !== "regular") points.push(pt);
  }
  // Non-finite grid samples that no located point explains: ±∞ is OVERFLOW (eˣ²), NaN is a domain gap the caller's
  // own scan names.
  const poles = points.filter((p) => p.kind !== "overflow").map((p) => p.at);
  const near = (t: number): boolean => poles.some((c) => Math.abs(c - t) <= ((hi - lo) / GRID) * 2);
  let overflowAt: number | undefined;
  const sawOverflowPoint = points.some((p) => p.kind === "overflow");
  for (const g of grid) {
    if (Number.isFinite(g.v) || near(g.t)) continue;
    if (g.v === Infinity || g.v === -Infinity) {
      overflowAt = g.t;
      break;
    }
  }
  if (sawOverflowPoint && overflowAt === undefined) overflowAt = points.find((p) => p.kind === "overflow")!.at;
  return { points: points.filter((p) => p.kind !== "overflow"), overflowAt };
}

// ---------------------------------------------------------------------------
// Quadrature across the integrable points.
// ---------------------------------------------------------------------------

/**
 * Tanh-sinh (double-exponential) quadrature on [a, b]. Never evaluates a or b; nodes crowd toward both ends with
 * doubly-exponentially small weights, which is what makes |x − a|^(−p), p < 1, converge. Distances to the ends are
 * computed directly (d·e^(−u)/cosh u), not as b − x, so they do not cancel. Returns null when two successive levels
 * do not agree (or a node is non-finite).
 */
export function tanhSinh(f: (t: number) => number, a: number, b: number): number | null {
  if (!(b > a)) return b === a ? 0 : null;
  // FLOATING POINT HIDES THE LAST SLIVER. Within a few ulps of a non-zero end, a + s rounds and f cannot be sampled
  // there at all — for |x − 1|^(−½) the sliver [1, 1 + ulp] holds 2√ulp ≈ 3×10⁻⁸ of the mass, which every level
  // misses alike (so the levels "agree" on a wrong value). So a non-zero end is pulled in by δ = 2⁻³⁰·|end|, the
  // quadrature runs on the shrunk interval (whose ends the integrand is finite at), and each sliver's mass is taken
  // from the local power law f ≈ C·s^(−p) fitted at δ and 16δ: ∫₀^δ f = f(δ)·δ/(1 − p). An end of exactly 0 needs
  // no floor: offsets from 0 are representable down to 10⁻³⁰⁸.
  const floorA = a === 0 ? 0 : Math.abs(a) * Math.pow(2, -30);
  const floorB = b === 0 ? 0 : Math.abs(b) * Math.pow(2, -30);
  if (!(b - a > 64 * (floorA + floorB))) return null;
  const sliver = (end: number, dir: number, delta: number): number | null => {
    if (delta === 0) return 0;
    let f1: number, f16: number;
    try { f1 = f(end + dir * delta); f16 = f(end + dir * 16 * delta); } catch { return null; }
    if (!Number.isFinite(f1) || !Number.isFinite(f16)) return null;
    if (f1 === 0) return 0;
    const ratio = Math.abs(f1) / Math.max(Math.abs(f16), 1e-300);
    const p = ratio > 1 ? Math.log(ratio) / Math.log(16) : 0;
    if (!(p < 0.95)) return null;
    return (f1 * delta) / (1 - p);
  };
  const A = a + floorA, B = b - floorB;
  const c = (A + B) / 2, d = (B - A) / 2;
  const term = (t: number): number | null => {
    const u = (Math.PI / 2) * Math.sinh(t);
    const cu = Math.cosh(u);
    const w = ((Math.PI / 2) * Math.cosh(t)) / (cu * cu);
    if (!Number.isFinite(w) || w === 0) return 0;
    const dist = (d * Math.exp(-u)) / cu;
    if (!(dist > 0)) return 0;
    // Each side on its own: near 0 a node 0 + 10⁻³⁰⁰ still exists while B − 10⁻³⁰⁰ has rounded to B.
    let s = 0;
    for (const xv of [A + dist, B - dist]) {
      if (!(xv > A) || !(xv < B)) continue;
      let fv: number;
      try { fv = f(xv); } catch { return null; }
      if (!Number.isFinite(fv)) return null;
      s += fv;
    }
    return w * s;
  };
  let f0: number;
  try { f0 = f(c); } catch { return null; }
  if (!Number.isFinite(f0)) return null;
  const TMAX = 6.5;
  let sum = (Math.PI / 2) * f0;
  let h = 1;
  for (let t = h; t <= TMAX; t += h) {
    const v = term(t);
    if (v === null) return null;
    sum += v;
  }
  let prev = h * sum * d;
  for (let level = 1; level <= 9; level++) {
    h /= 2;
    for (let t = h; t <= TMAX; t += 2 * h) {
      const v = term(t);
      if (v === null) return null;
      sum += v;
    }
    const est = h * sum * d;
    if (level >= 3 && Math.abs(est - prev) <= 1e-10 * Math.max(Math.abs(est), 1e-300) + 1e-14 * d) {
      const sa = sliver(a, 1, floorA), sb = sliver(b, -1, floorB);
      return sa === null || sb === null ? null : est + sa + sb;
    }
    prev = est;
  }
  return null;
}

const GLN = [
  -0.9739065285171717, -0.8650633666889845, -0.6794095682990244, -0.4333953941292472, -0.14887433898163122,
  0.14887433898163122, 0.4333953941292472, 0.6794095682990244, 0.8650633666889845, 0.9739065285171717,
];
const GLW = [
  0.06667134430868814, 0.14945134915058059, 0.219086362515982, 0.2692667193099963, 0.29552422471475287,
  0.29552422471475287, 0.2692667193099963, 0.219086362515982, 0.14945134915058059, 0.06667134430868814,
];

function gl10(f: (t: number) => number, a: number, b: number): number {
  const m = (a + b) / 2, r = (b - a) / 2;
  let s = 0;
  for (let i = 0; i < 10; i++) s += GLW[i] * f(m + r * GLN[i]);
  return s * r;
}

/** Adaptive Gauss-Legendre with a hard evaluation budget (an oscillating integrand must not freeze Word). */
function adaptiveGL(f: (t: number) => number, a: number, b: number, tol: number, budget: { left: number }): number | null {
  const rec = (p: number, q: number, whole: number, tl: number, depth: number): number | null => {
    if (budget.left <= 0) return null;
    const m = (p + q) / 2;
    budget.left -= 20;
    const l = gl10(f, p, m), r = gl10(f, m, q);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
    if (Math.abs(l + r - whole) <= tl || depth <= 0) return l + r;
    const L = rec(p, m, l, tl / 2, depth - 1);
    if (L === null) return null;
    const R = rec(m, q, r, tl / 2, depth - 1);
    return R === null ? null : L + R;
  };
  const w = gl10(f, a, b);
  if (!Number.isFinite(w)) return null;
  return rec(a, b, w, tol, 60);
}

export interface SplitIntegral {
  value: number;
  /** Absolute error bound when an oscillatory endpoint was cut off (the value is good to about this). */
  errorBound?: number;
  /** Σ |piece| — the yardstick for "these pieces cancelled to zero". */
  scale: number;
}

/**
 * ∫ over [lo, hi] split at the special points (interior integrable / jump / removable / oscillatory ones, and
 * integrable or oscillatory endpoints). Returns null when any piece fails to converge.
 */
export function integrateAcross(f: (t: number) => number, lo: number, hi: number, special: SingularPoint[]): SplitIntegral | null {
  const cuts = [lo, ...special.filter((s) => !s.endpoint).map((s) => s.at).sort((p, q) => p - q), hi];
  const osc = (t: number): boolean => special.some((s) => s.kind === "oscillatory" && Math.abs(s.at - t) <= 1e-12 * Math.max(1, Math.abs(t)));
  let total = 0;
  let absSum = 0;
  let bound = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const p = cuts[i], q = cuts[i + 1];
    if (!(q > p)) continue;
    const op = osc(p), oq = osc(q);
    if (op || oq) {
      if (op && oq) return null; // oscillating at both ends of one piece: refuse rather than stack two bounds
      const t = op ? p : q;
      const s = op ? 1 : -1;
      const delta = Math.min(1e-4 * Math.max(1, Math.abs(t)), (q - p) / 10);
      const near = t + s * delta;
      const budget = { left: 400000 };
      const v = op ? adaptiveGL(f, near, q, 1e-10, budget) : adaptiveGL(f, p, near, 1e-10, budget);
      if (v === null) return null;
      // |∫ over the cut-off sliver| ≤ δ · sup |f| there.
      let M = 0;
      for (let k = 1; k <= 400; k++) {
        let y: number;
        try { y = f(t + s * delta * (k / 400)); } catch { return null; }
        if (!Number.isFinite(y)) return null;
        M = Math.max(M, Math.abs(y));
      }
      total += v;
      absSum += Math.abs(v);
      bound += delta * M;
      continue;
    }
    const v = tanhSinh(f, p, q);
    if (v === null) return null;
    total += v;
    absSum += Math.abs(v);
  }
  return bound > 0 ? { value: total, errorBound: bound, scale: absSum } : { value: total, scale: absSum };
}
