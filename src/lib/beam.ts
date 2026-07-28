// Beam analysis — reactions, shear, bending moment, slope and deflection.
//
// WHY THIS IS EXACT AND NOT NUMERIC. A statically loaded prismatic beam has a
// closed-form answer: shear and moment are piecewise polynomials in x, and for
// the loads a student actually types (point loads, uniform and trapezoidal
// distributed loads, applied couples) every coefficient is rational. Running a
// finite-element or finite-difference solve over that would replace an exact
// answer with an approximate one and then have to caveat it. So the whole
// engine runs on the CAS's exact BigInt rationals (`Rat`), and the reactions a
// student checks against their textbook come out as 3/8 wL, not 0.37499999996.
//
// THE METHOD is Macaulay's (singularity functions), carried with the support
// reactions left as UNKNOWNS. Every quantity is stored as a list of terms
//
//     coefficient · <x - a>^n        where <u>^n = u^n for u >= 0, else 0
//
// and each coefficient is AFFINE in the unknowns (a `Lin`: constants plus a
// coefficient on each unknown). Integrating a term list is then trivial, and
// the boundary conditions are linear equations in those same unknowns.
//
// The pleasant consequence is that DETERMINATE AND INDETERMINATE BEAMS ARE THE
// SAME CODE PATH. Counting unknowns against equations:
//
//   pin/roller  -> 1 unknown (vertical reaction), 1 condition (deflection = 0)
//   fixed       -> 2 unknowns (reaction + end moment), 2 conditions (v = 0, θ = 0)
//   plus C1, C2 from integrating twice -> 2 unknowns, and 2 equilibrium equations
//
// so the system is ALWAYS square, whatever the degree of indeterminacy. A
// propped cantilever and a fixed-fixed beam need no separate treatment, no
// force method, and no superposition table. A beam that is a MECHANISM (one
// roller, or two supports at the same point) makes the matrix singular, which
// is detected and reported rather than returned as a confident wrong answer.
//
// EQUILIBRIUM IS TAKEN FROM THE SAME TERMS, not written out separately as
// ΣF = 0 and ΣM = 0. Past the right-hand end every load and reaction is behind
// us, so V(L) = 0 and M(L) = 0 IS global equilibrium — expressed in the exact
// sign convention the terms were built with. Deriving it a second time by hand
// is how sign errors get in.
//
// SIGN CONVENTIONS (pinned by the oracle tests in beam.test.ts):
//   x runs left to right from 0 to L; y is up.
//   Downward loads are entered as POSITIVE magnitudes — that is what a student
//     reads off a figure — and reactions come back positive when they push UP.
//   Shear V and moment M are the usual beam conventions: sagging moment
//     positive, so a simply supported beam under gravity has M > 0 throughout.
//   An applied couple is positive COUNTERCLOCKWISE.
//
// EI: for a prismatic beam the flexural rigidity DIVIDES OUT of the boundary
// conditions, so reactions, shear and moment are independent of E and I even
// when the beam is indeterminate. This engine therefore returns slope and
// deflection multiplied by EI (exactly), and the caller divides by a real EI to
// get real units. That keeps the exact part exact and puts the only
// floating-point step at the very end, where the material property lives.

import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratInt, ratIsZero, ratNeg, ratSign, ratToNumber } from "./cas";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type SupportKind = "pin" | "roller" | "fixed";

export interface Support {
  kind: SupportKind;
  /** Distance from the left-hand end. */
  x: Rat;
}

export type Load =
  /** Concentrated force, positive downward. */
  | { kind: "point"; x: Rat; p: Rat }
  /** Distributed load of constant intensity `w` (per unit length) over [a, b], positive downward. */
  | { kind: "udl"; a: Rat; b: Rat; w: Rat }
  /** Distributed load varying linearly from `w1` at `a` to `w2` at `b`, positive downward. */
  | { kind: "ramp"; a: Rat; b: Rat; w1: Rat; w2: Rat }
  /** Applied couple, positive counterclockwise. */
  | { kind: "moment"; x: Rat; m: Rat };

export interface BeamInput {
  length: Rat;
  supports: Support[];
  loads: Load[];
}

/** How far from statically determinate the beam is, and what that means. */
export interface Determinacy {
  /** 0 = determinate; n > 0 = indeterminate to degree n. */
  degree: number;
  note: string;
}

export interface Extremum {
  x: number;
  value: number;
  /** True when the location is a breakpoint or an exactly rational stationary point. */
  exact: boolean;
}

export interface ReactionResult {
  x: number;
  kind: SupportKind;
  /** Vertical reaction, positive upward. */
  force: number;
  /**
   * Fixed-end moment as the INTERNAL BENDING MOMENT at the support face, in the
   * same sagging-positive convention as the moment diagram — so a cantilever
   * reads hogging (negative) at its wall whichever end the wall is on. Present
   * only for a fixed support.
   */
  moment?: number;
  /**
   * The couple the support applies TO the beam, counterclockwise positive — the
   * arrow that goes on a free-body diagram. This is NOT the same number as
   * `moment` and generally not even the same sign: the internal-moment
   * convention is defined relative to the face being cut, so a wall at the left
   * end and a wall at the right end relate to it oppositely.
   */
  couple?: number;
  forceExact: Rat;
  momentExact?: Rat;
  coupleExact?: Rat;
}

export interface BeamResult {
  ok: true;
  length: number;
  reactions: ReactionResult[];
  determinacy: Determinacy;
  /** Sample the internal shear force at x. */
  shearAt: (x: number) => number;
  /** Sample the internal bending moment at x. */
  momentAt: (x: number) => number;
  /** Slope θ(x) multiplied by EI — divide by a real EI for radians. */
  eiSlopeAt: (x: number) => number;
  /** Deflection v(x) multiplied by EI — divide by a real EI for a length. */
  eiDeflectionAt: (x: number) => number;
  maxShear: Extremum;
  maxMoment: Extremum;
  /** The most negative moment, reported separately: hogging governs the top fibre. */
  minMoment: Extremum;
  /** Largest |EI·v|, i.e. the deflection extremum before dividing by EI. */
  maxEiDeflection: Extremum;
  /** x values where the diagrams have a genuine break (supports, loads, ends). */
  breakpoints: number[];
  warnings: string[];
}

export interface BeamFailure {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Affine-in-the-unknowns scalars
// ---------------------------------------------------------------------------

/** `c` plus `k[i]` times unknown i. */
interface Lin {
  c: Rat;
  k: Rat[];
}

const ZERO = ratInt(0);
const ONE = ratInt(1);

function linConst(c: Rat, n: number): Lin {
  return { c, k: new Array(n).fill(ZERO) };
}

function linUnknown(i: number, n: number): Lin {
  const k = new Array(n).fill(ZERO);
  k[i] = ONE;
  return { c: ZERO, k };
}

function linAdd(a: Lin, b: Lin): Lin {
  return { c: ratAdd(a.c, b.c), k: a.k.map((v, i) => ratAdd(v, b.k[i])) };
}

function linScale(a: Lin, s: Rat): Lin {
  return { c: ratMul(a.c, s), k: a.k.map((v) => ratMul(v, s)) };
}

function linEval(a: Lin, values: Rat[]): Rat {
  let acc = a.c;
  for (let i = 0; i < a.k.length; i++) if (!ratIsZero(a.k[i])) acc = ratAdd(acc, ratMul(a.k[i], values[i]));
  return acc;
}

// ---------------------------------------------------------------------------
// Singularity-function term lists
// ---------------------------------------------------------------------------

/** coefficient · <x - a>^n */
interface Term {
  a: Rat;
  n: number;
  c: Lin;
}

/**
 * Integrate a term list: ∫ c<x-a>^n dx = c/(n+1) <x-a>^(n+1).
 * No constant of integration is added here — callers add named unknowns.
 */
function integrate(terms: Term[]): Term[] {
  return terms.map((t) => ({ a: t.a, n: t.n + 1, c: linScale(t.c, ratDiv(ONE, ratInt(t.n + 1))) }));
}

/**
 * Evaluate a term list at x. `inclusive` decides <0>^0: true counts a term whose
 * breakpoint is exactly x (the value just to the RIGHT of a discontinuity),
 * false excludes it (just to the LEFT). Shear jumps at a point load, so which
 * side you ask for is a real question and not a rounding detail.
 */
function evalTerms(terms: Term[], x: Rat, values: Rat[], inclusive: boolean): Rat {
  let acc = ZERO;
  for (const t of terms) {
    const u = ratSub(x, t.a);
    const s = ratSign(u);
    if (s < 0) continue;
    if (s === 0) {
      // <0>^n is 0 for n >= 1; <0>^0 is 1, but only on the inclusive side.
      if (t.n > 0) continue;
      if (!inclusive) continue;
      acc = ratAdd(acc, linEval(t.c, values));
      continue;
    }
    let p = ONE;
    for (let i = 0; i < t.n; i++) p = ratMul(p, u);
    acc = ratAdd(acc, ratMul(linEval(t.c, values), p));
  }
  return acc;
}

/** The same, symbolically: returns the affine form rather than a number. */
function evalTermsLin(terms: Term[], x: Rat, nUnknowns: number, inclusive: boolean): Lin {
  let acc = linConst(ZERO, nUnknowns);
  for (const t of terms) {
    const u = ratSub(x, t.a);
    const s = ratSign(u);
    if (s < 0) continue;
    if (s === 0) {
      if (t.n > 0) continue;
      if (!inclusive) continue;
      acc = linAdd(acc, t.c);
      continue;
    }
    let p = ONE;
    for (let i = 0; i < t.n; i++) p = ratMul(p, u);
    acc = linAdd(acc, linScale(t.c, p));
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Exact linear solve
// ---------------------------------------------------------------------------

/**
 * Gauss-Jordan over exact rationals. Returns null when the matrix is singular —
 * which for a beam means a mechanism (not enough restraint) or duplicated
 * supports, and must be reported rather than patched with a pseudo-inverse.
 */
function solveExact(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let r = col; r < n; r++) {
      if (!ratIsZero(m[r][col])) {
        pivot = r;
        break;
      }
    }
    if (pivot < 0) return null;
    if (pivot !== col) {
      const t = m[pivot];
      m[pivot] = m[col];
      m[col] = t;
    }
    const p = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] = ratDiv(m[col][j], p);
    for (let r = 0; r < n; r++) {
      if (r === col || ratIsZero(m[r][col])) continue;
      const f = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] = ratSub(m[r][j], ratMul(f, m[col][j]));
    }
  }
  return m.map((row) => row[n]);
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/** Hard caps. A pane recomputes on every keystroke; nothing here may grow without bound. */
const MAX_SUPPORTS = 12;
const MAX_LOADS = 60;
const SAMPLES = 400;

export function analyzeBeam(input: BeamInput): BeamResult | BeamFailure {
  const { length: L, supports, loads } = input;

  if (ratSign(L) <= 0) return { ok: false, error: "Beam length must be greater than zero." };
  if (supports.length === 0) return { ok: false, error: "A beam needs at least one support." };
  if (supports.length > MAX_SUPPORTS) return { ok: false, error: `At most ${MAX_SUPPORTS} supports.` };
  if (loads.length > MAX_LOADS) return { ok: false, error: `At most ${MAX_LOADS} loads.` };

  for (const s of supports) {
    if (ratSign(s.x) < 0 || ratSign(ratSub(s.x, L)) > 0)
      return { ok: false, error: "Every support must lie on the beam, between 0 and the length." };
  }
  for (const l of loads) {
    const bad =
      (l.kind === "point" && (ratSign(l.x) < 0 || ratSign(ratSub(l.x, L)) > 0)) ||
      (l.kind === "moment" && (ratSign(l.x) < 0 || ratSign(ratSub(l.x, L)) > 0)) ||
      ((l.kind === "udl" || l.kind === "ramp") &&
        (ratSign(l.a) < 0 || ratSign(ratSub(l.b, L)) > 0 || ratSign(ratSub(l.b, l.a)) <= 0));
    if (bad) return { ok: false, error: "Every load must lie on the beam, and a distributed load needs b > a." };
  }
  // Two supports at the same point are a duplicated restraint, not a stiffer one.
  for (let i = 0; i < supports.length; i++)
    for (let j = i + 1; j < supports.length; j++)
      if (ratIsZero(ratSub(supports[i].x, supports[j].x)))
        return { ok: false, error: "Two supports share the same position — remove one." };

  // --- unknowns: reaction per support, moment for each fixed, then C1, C2 ---
  const reactionIdx: number[] = [];
  const momentIdx: number[] = [];
  let nUnknowns = 0;
  for (const s of supports) {
    reactionIdx.push(nUnknowns++);
    momentIdx.push(s.kind === "fixed" ? nUnknowns++ : -1);
  }
  const c1 = nUnknowns++;
  const c2 = nUnknowns++;
  const N = nUnknowns;

  // --- shear terms ---
  const V: Term[] = [];
  supports.forEach((s, i) => V.push({ a: s.x, n: 0, c: linUnknown(reactionIdx[i], N) }));
  for (const l of loads) {
    if (l.kind === "point") {
      V.push({ a: l.x, n: 0, c: linConst(ratNeg(l.p), N) });
    } else if (l.kind === "udl") {
      V.push({ a: l.a, n: 1, c: linConst(ratNeg(l.w), N) });
      V.push({ a: l.b, n: 1, c: linConst(l.w, N) });
    } else if (l.kind === "ramp") {
      const d = ratSub(l.b, l.a);
      const s = ratDiv(ratSub(l.w2, l.w1), d);
      const half = ratDiv(s, ratInt(2));
      // uniform part w1 over [a,b]
      V.push({ a: l.a, n: 1, c: linConst(ratNeg(l.w1), N) });
      V.push({ a: l.b, n: 1, c: linConst(l.w1, N) });
      // triangular part of slope s, cancelled beyond b so the tail stays constant
      V.push({ a: l.a, n: 2, c: linConst(ratNeg(half), N) });
      V.push({ a: l.b, n: 2, c: linConst(half, N) });
      V.push({ a: l.b, n: 1, c: linConst(ratMul(s, d), N) });
    }
  }

  // --- moment terms: ∫V, plus couples and fixed-end moments (which V never sees) ---
  const M: Term[] = integrate(V);
  supports.forEach((s, i) => {
    if (momentIdx[i] >= 0) M.push({ a: s.x, n: 0, c: linUnknown(momentIdx[i], N) });
  });
  // A couple enters the INTERNAL moment with the opposite sign to the applied
  // one: +m<x-c>^0 would make M(L) = 0 read as "applied couple + reaction couple
  // = 0 with both the same sense", which is not equilibrium. Pinned by
  // `couple at midspan` in beam.test.ts, where the reactions must form an equal
  // and opposite couple.
  for (const l of loads) if (l.kind === "moment") M.push({ a: l.x, n: 0, c: linConst(ratNeg(l.m), N) });

  // --- EIθ = ∫M + C1 ; EIv = ∫EIθ + C2 ---
  const TH: Term[] = integrate(M);
  TH.push({ a: ZERO, n: 0, c: linUnknown(c1, N) });
  const DEF: Term[] = integrate(TH);
  DEF.push({ a: ZERO, n: 0, c: linUnknown(c2, N) });

  // --- equations ---
  const rows: Lin[] = [];
  // Global equilibrium, read off the same terms: past the right end, V and M vanish.
  rows.push(evalTermsLin(V, L, N, true));
  rows.push(evalTermsLin(M, L, N, true));
  // Support conditions.
  supports.forEach((s, i) => {
    rows.push(evalTermsLin(DEF, s.x, N, true));
    if (momentIdx[i] >= 0) rows.push(evalTermsLin(TH, s.x, N, true));
  });

  if (rows.length !== N) {
    return { ok: false, error: `Internal: ${rows.length} equations for ${N} unknowns.` };
  }

  const A = rows.map((r) => r.k);
  const rhs = rows.map((r) => ratNeg(r.c));
  const sol = solveExact(A, rhs);
  if (!sol) {
    return {
      ok: false,
      error:
        "This beam is a mechanism — the supports cannot hold it in equilibrium. " +
        "A single roller, or two rollers with nothing resisting rotation, will do this. " +
        "Add a pin or a fixed support.",
    };
  }

  // --- determinacy, for the record ---
  const restraints = supports.reduce((n, s) => n + (s.kind === "fixed" ? 2 : 1), 0);
  const degree = restraints - 2;
  const determinacy: Determinacy = {
    degree,
    note:
      degree <= 0
        ? "Statically determinate — reactions follow from equilibrium alone."
        : `Statically indeterminate to degree ${degree} — solved by compatibility ` +
          "(deflection conditions at the supports), not by equilibrium alone.",
  };

  // --- readouts ---
  const num = (t: Term[], x: number, inclusive = true): number =>
    ratToNumber(evalTerms(t, ratFromFloat(x), sol, inclusive));

  const reactions: ReactionResult[] = supports.map((s, i) => {
    const f = sol[reactionIdx[i]];
    const mi = momentIdx[i];
    if (mi < 0) return { x: ratToNumber(s.x), kind: s.kind, force: ratToNumber(f), forceExact: f };
    // The raw unknown is the coefficient of Mr<x - xs>^0, which activates only to
    // the RIGHT of the support. At a left-hand wall that term is live across the
    // whole span and so IS the internal moment there; at a right-hand wall it is
    // live only past the end, and the internal moment at the face is the value
    // just to the LEFT. Reporting the raw unknown gave +48 on a right-fixed
    // cantilever where the textbook says -48 — found by the equilibrium check in
    // beam.adversarial.test.ts, which is what that check exists for.
    const atRightEnd = ratIsZero(ratSub(s.x, L));
    const internal = evalTerms(M, s.x, sol, !atRightEnd);
    // The couple the support applies to the beam is minus the raw unknown, on
    // BOTH sides — that relation is the one global equilibrium is written in.
    const couple = ratNeg(sol[mi]);
    return {
      x: ratToNumber(s.x),
      kind: s.kind,
      force: ratToNumber(f),
      forceExact: f,
      moment: ratToNumber(internal),
      momentExact: internal,
      couple: ratToNumber(couple),
      coupleExact: couple,
    };
  });

  const breaks = collectBreakpoints(L, supports, loads);
  const maxShear = extremeOf((x, inc) => num(V, x, inc), breaks, L, true);
  const mExt = extremeSigned((x) => num(M, x), breaks, L);
  const maxEiDeflection = extremeOf((x) => num(DEF, x), breaks, L, true);

  const warnings: string[] = [];
  if (degree > 0)
    warnings.push(
      "Indeterminate beam: the reactions depend on the beam being PRISMATIC (constant EI) " +
        "and on the supports being rigid. A settling support changes them.",
    );
  if (supports.every((s) => s.kind !== "fixed") && supports.length === 1)
    warnings.push("A single pin cannot resist rotation — check this is the beam you meant.");

  return {
    ok: true,
    length: ratToNumber(L),
    reactions,
    determinacy,
    shearAt: (x) => num(V, x),
    momentAt: (x) => num(M, x),
    eiSlopeAt: (x) => num(TH, x),
    eiDeflectionAt: (x) => num(DEF, x),
    maxShear,
    maxMoment: mExt.max,
    minMoment: mExt.min,
    maxEiDeflection,
    breakpoints: breaks.map(ratToNumber),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exact rational from a float, via its decimal string (see cas.ts). */
function ratFromFloat(v: number): Rat {
  if (!Number.isFinite(v)) return ZERO;
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(v));
  if (!m) return ZERO;
  const [, sign, int, frac = "", expStr] = m;
  const exp = (expStr ? parseInt(expStr, 10) : 0) - frac.length;
  let n = BigInt(int + frac);
  if (sign === "-") n = -n;
  return exp >= 0 ? ratMul(ratInt(n), ratInt(10n ** BigInt(exp))) : ratDiv(ratInt(n), ratInt(10n ** BigInt(-exp)));
}

function collectBreakpoints(L: Rat, supports: Support[], loads: Load[]): Rat[] {
  const xs: Rat[] = [ZERO, L];
  for (const s of supports) xs.push(s.x);
  for (const l of loads) {
    if (l.kind === "point" || l.kind === "moment") xs.push(l.x);
    else {
      xs.push(l.a);
      xs.push(l.b);
    }
  }
  const seen = new Set<string>();
  const out: Rat[] = [];
  for (const x of xs) {
    const key = `${x.n}/${x.d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  out.sort((a, b) => ratSign(ratSub(a, b)));
  return out;
}

/**
 * Largest magnitude of f over the beam. Breakpoints are checked on BOTH sides —
 * shear is discontinuous at a point load, and the peak is one of the two
 * one-sided values, never the average.
 */
function extremeOf(
  f: (x: number, inclusive: boolean) => number,
  breaks: Rat[],
  L: Rat,
  bothSides: boolean,
): Extremum {
  let best: Extremum = { x: 0, value: 0, exact: true };
  let seen = false;
  const consider = (x: number, v: number, exact: boolean) => {
    if (!Number.isFinite(v)) return;
    if (!seen || Math.abs(v) > Math.abs(best.value)) {
      best = { x, value: v, exact };
      seen = true;
    }
  };
  for (const b of breaks) {
    const x = ratToNumber(b);
    consider(x, f(x, true), true);
    if (bothSides) consider(x, f(x, false), true);
  }
  const len = ratToNumber(L);
  for (let i = 1; i < SAMPLES; i++) {
    const x = (len * i) / SAMPLES;
    consider(x, f(x, true), false);
  }
  return best;
}

/** Both signed extremes of f: sagging and hogging govern opposite fibres. */
function extremeSigned(f: (x: number) => number, breaks: Rat[], L: Rat): { max: Extremum; min: Extremum } {
  let max: Extremum = { x: 0, value: -Infinity, exact: true };
  let min: Extremum = { x: 0, value: Infinity, exact: true };
  const consider = (x: number, exact: boolean) => {
    const v = f(x);
    if (!Number.isFinite(v)) return;
    if (v > max.value) max = { x, value: v, exact };
    if (v < min.value) min = { x, value: v, exact };
  };
  for (const b of breaks) consider(ratToNumber(b), true);
  const len = ratToNumber(L);
  for (let i = 1; i < SAMPLES; i++) consider((len * i) / SAMPLES, false);
  if (!Number.isFinite(max.value)) max = { x: 0, value: 0, exact: true };
  if (!Number.isFinite(min.value)) min = { x: 0, value: 0, exact: true };
  return { max, min };
}

// ---------------------------------------------------------------------------
// Parsing what a student types
// ---------------------------------------------------------------------------

/**
 * Exact rational from a typed decimal, so "2.5" becomes 5/2 and not a float.
 * Returns null on anything unparseable — the caller must say so rather than
 * silently treating a typo as zero, which would quietly change the beam.
 */
function parseRat(s: string): Rat | null {
  const t = s.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const neg = t.startsWith("-");
  const body = t.replace(/^[+-]/, "");
  const [int, frac = ""] = body.split(".");
  const digits = (int || "0") + frac;
  let n = BigInt(digits === "" ? "0" : digits);
  if (neg) n = -n;
  return ratDiv(ratInt(n), ratInt(10n ** BigInt(frac.length)));
}

export interface ParsedBeam {
  supports: Support[];
  loads: Load[];
  errors: string[];
}

/**
 * Reads the support line, e.g. `pin 0, roller 8` or `fixed 0`.
 * `@` is accepted in place of a space because it is what people type.
 */
export function parseSupports(text: string): { supports: Support[]; errors: string[] } {
  const supports: Support[] = [];
  const errors: string[] = [];
  const parts = text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const m = /^(pin|roller|fixed)\s*@?\s*([+-]?[\d.]+)$/i.exec(p);
    if (!m) {
      errors.push(`Could not read the support "${p}". Write it as "pin 0", "roller 8" or "fixed 0".`);
      continue;
    }
    const x = parseRat(m[2]);
    if (!x) {
      errors.push(`"${m[2]}" is not a number.`);
      continue;
    }
    supports.push({ kind: m[1].toLowerCase() as SupportKind, x });
  }
  return { supports, errors };
}

/**
 * Reads the load list, one per line:
 *   point 30 at 6          concentrated force (downward positive)
 *   udl 5 from 0 to 8      uniform intensity
 *   udl 0 to 9 from 0 to 6 linearly varying intensity
 *   moment 200 at 4        applied couple (counterclockwise positive)
 */
export function parseLoads(text: string): { loads: Load[]; errors: string[] } {
  const loads: Load[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;

    let m = /^(?:point|p|force|f)\s+([+-]?[\d.]+)\s*(?:at|@)\s*([+-]?[\d.]+)$/i.exec(line);
    if (m) {
      const p = parseRat(m[1]);
      const x = parseRat(m[2]);
      if (p && x) loads.push({ kind: "point", x, p });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    // Varying intensity FIRST: "udl 0 to 9 from 0 to 6" also matches the uniform
    // pattern's prefix, so testing uniform first would silently drop the taper.
    m = /^(?:udl|w|load)\s+([+-]?[\d.]+)\s+to\s+([+-]?[\d.]+)\s+from\s+([+-]?[\d.]+)\s+to\s+([+-]?[\d.]+)$/i.exec(line);
    if (m) {
      const w1 = parseRat(m[1]);
      const w2 = parseRat(m[2]);
      const a = parseRat(m[3]);
      const b = parseRat(m[4]);
      if (w1 && w2 && a && b) loads.push({ kind: "ramp", a, b, w1, w2 });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    m = /^(?:udl|w|load)\s+([+-]?[\d.]+)\s+from\s+([+-]?[\d.]+)\s+to\s+([+-]?[\d.]+)$/i.exec(line);
    if (m) {
      const w = parseRat(m[1]);
      const a = parseRat(m[2]);
      const b = parseRat(m[3]);
      if (w && a && b) loads.push({ kind: "udl", a, b, w });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    m = /^(?:moment|couple|m)\s+([+-]?[\d.]+)\s*(?:at|@)\s*([+-]?[\d.]+)$/i.exec(line);
    if (m) {
      const mm = parseRat(m[1]);
      const x = parseRat(m[2]);
      if (mm && x) loads.push({ kind: "moment", x, m: mm });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    errors.push(
      `Could not read "${line}". Use "point 30 at 6", "udl 5 from 0 to 8", ` +
        `"udl 0 to 9 from 0 to 6" or "moment 200 at 4".`,
    );
  }
  return { loads, errors };
}

/** Exact rational from typed text, exported for the pane's length field. */
export function parseLength(text: string): Rat | null {
  return parseRat(text);
}

/** Total downward load, for the equilibrium line in the write-up. */
export function totalLoad(loads: Load[]): number {
  let t = 0;
  for (const l of loads) {
    if (l.kind === "point") t += ratToNumber(l.p);
    else if (l.kind === "udl") t += ratToNumber(ratMul(l.w, ratSub(l.b, l.a)));
    else if (l.kind === "ramp")
      t += ratToNumber(ratMul(ratDiv(ratAdd(l.w1, l.w2), ratInt(2)), ratSub(l.b, l.a)));
  }
  return t;
}
