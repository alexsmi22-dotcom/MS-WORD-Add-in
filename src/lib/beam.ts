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
// EI: for a prismatic beam on RIGID supports the flexural rigidity DIVIDES OUT
// of the boundary conditions, so reactions, shear and moment are independent of
// E and I even when the beam is indeterminate. This engine therefore returns
// slope and deflection multiplied by EI (exactly), and the caller divides by a
// real EI to get real units. That keeps the exact part exact and puts the only
// floating-point step at the very end, where the material property lives.
//
// ELASTIC SUPPORTS AND SETTLEMENT ARE THE TWO CASES WHERE THAT BREAKS, and the
// break is physical rather than numerical. A rigid support contributes the
// homogeneous condition v = 0, which is why EI cancels. A spring contributes
// v = -R/k and a settlement contributes v = -delta, and neither is homogeneous:
// written in the EI·v that this engine actually carries they read
//
//     EI·v(x_s) + (EI/k)·R = 0        and        EI·v(x_s) = -EI·delta
//
// so EI appears as a COEFFICIENT on an unknown and as a term on the right-hand
// side. The reactions of such a beam genuinely depend on EI — a stiffer beam
// draws more reaction out of a settling support — so this is the model telling
// the truth, not a loss of generality. Both forms stay AFFINE in the unknowns
// and rational whenever EI, k and delta are, so the solve is still exact; the
// only change is that `ei` becomes required and the result is flagged
// `eiCoupled` so no caller repeats the "reactions need no EI" line for a beam
// where it is false.
//
// Two consequences worth knowing, both of which the tests pin:
//   - On a DETERMINATE beam, settlement and spring stiffness change no reaction
//     at all. Equilibrium alone fixes them, so the supports simply move. This
//     is the classic result and the best available oracle for the new path.
//   - On an INDETERMINATE beam they change everything, and the induced
//     reactions scale linearly with EI.

import {
  Rat,
  ratAdd,
  ratSub,
  ratMul,
  ratDiv,
  ratInt,
  ratIsZero,
  ratNeg,
  ratSign,
  ratToNumber,
  parseRatLiteral,
} from "./cas";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type SupportKind = "pin" | "roller" | "fixed";

export interface Support {
  kind: SupportKind;
  /** Distance from the left-hand end. */
  x: Rat;
  /**
   * Vertical spring stiffness (force per unit length). Null or absent means a
   * RIGID support, which is the usual assumption and the one that keeps the
   * reactions independent of EI. A finite stiffness replaces the condition
   * v = 0 with v = -R/k, which is still linear in the unknowns and still exact
   * — but it drags EI into the equations, so `ei` becomes required and the
   * reactions stop being an EI-free result. See `eiCoupled` on the result.
   */
  k?: Rat | null;
  /**
   * Prescribed support settlement, DOWNWARD POSITIVE to match the load sign
   * convention, so `settle 0.01` sinks the support by 0.01. Replaces v = 0 with
   * v = -settle. Like a spring this couples EI, and for the same reason.
   *
   * WITH A SPRING, `settle` MOVES THE SEAT, NOT THE BEAM. The two options
   * combine as
   *
   *     v(x_s) = -settle - R/k
   *
   * so the support's seat drops by `settle` and the spring then compresses by
   * R/k on top of it — a settling elastic foundation. The other reading a person
   * might expect, "the beam at this point ends up exactly `settle` below datum
   * whatever the spring does", is a DIFFERENT model and gives different
   * reactions; it is what you get by writing `settle` with no `k` at all. The
   * distinction is invisible in the output, so it is stated here, in the pane
   * hint and in the examples rather than left to be reverse-engineered.
   */
  settle?: Rat | null;
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
  /**
   * Flexural rigidity, as an EXACT rational. Required only when some support
   * has a spring stiffness or a settlement, because those are the two cases
   * where EI stops dividing out and enters the equations themselves. Supplying
   * it otherwise changes nothing: the solve does not use it.
   */
  ei?: Rat | null;
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
  /**
   * True when a spring or a settlement put EI into the SOLVE, so the answer
   * required an EI to compute at all — the module's normal "reactions are exact
   * without EI" contract does not apply to the calculation.
   *
   * It does NOT follow that the reactions depend on EI. On a statically
   * DETERMINATE beam they cannot: equilibrium alone fixes them, so a spring and
   * a settlement change the deflections and leave every force untouched, and
   * `eiCoupled` is true while the reactions are identical at EI = 1 and
   * EI = 1e6. Only when `determinacy.degree > 0` do the reactions genuinely
   * scale with EI. Callers wanting to warn about that must test BOTH, which is
   * the distinction the warnings below draw and an earlier version did not.
   */
  eiCoupled: boolean;
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

export function analyzeBeam(input: BeamInput, probe = false): BeamResult | BeamFailure {
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

  // --- elastic supports and settlement: the only place EI enters the solve ---
  for (const s of supports) {
    if (s.k != null && ratSign(s.k) <= 0)
      return {
        ok: false,
        error:
          "A support spring stiffness must be greater than zero. A stiffness of zero is not a soft " +
          "support, it is NO support — remove the support instead, or the beam is a mechanism.",
      };
  }
  const eiCoupled = supports.some((s) => s.k != null || (s.settle != null && !ratIsZero(s.settle)));
  const EI = input.ei ?? null;
  if (eiCoupled) {
    if (EI == null || ratSign(EI) <= 0)
      return {
        ok: false,
        error:
          "A spring support or a support settlement needs EI, and it must be positive. Unlike a " +
          "beam on rigid supports — where EI cancels out and the reactions are exact without it — " +
          "an elastic or settling support makes the reactions genuinely depend on the beam's " +
          "stiffness, so there is no EI-free answer to give.",
      };
  }

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
  // Support conditions. A rigid support is EI·v = 0; a spring adds (EI/k)·R to
  // the same row; a settlement moves EI·delta to the right-hand side. The row is
  // assembled as a `Lin` whose constant is negated into the RHS below, so a
  // downward settlement of `delta` (v = -delta, EI·v = -EI·delta) is applied by
  // ADDING EI·delta to the constant.
  supports.forEach((s, i) => {
    const row = evalTermsLin(DEF, s.x, N, true);
    if (s.k != null && EI != null) {
      const ri = reactionIdx[i];
      row.k[ri] = ratAdd(row.k[ri], ratDiv(EI, s.k));
    }
    if (s.settle != null && !ratIsZero(s.settle) && EI != null) {
      row.c = ratAdd(row.c, ratMul(EI, s.settle));
    }
    rows.push(row);
    // A fixed support still holds its rotation. A spring here is a VERTICAL
    // spring under a rotationally rigid end — a guided wall on a soft seat —
    // and the slope condition is untouched by both spring and settlement.
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
        "A single support of any kind, or two rollers with nothing resisting rotation, will " +
        "do this: a pin and a roller both restrain only vertically, so one of them leaves the " +
        "beam free to rotate. Add a second support, or make one of them fixed.",
    };
  }

  // --- determinacy, for the record ---
  const restraints = supports.reduce((n, s) => n + (s.kind === "fixed" ? 2 : 1), 0);
  const degree = restraints - 2;

  // DOES EI ACTUALLY CHANGE THE ANSWER? Measured, not assumed.
  //
  // `eiCoupled` says EI entered the SOLVE. It does not say the reactions depend
  // on it, and the difference is not a technicality: a three-support beam on a
  // spring under an antisymmetric load has v = 0 at the spring by symmetry, so
  // R = 0 there for every k and every EI, and equilibrium fixes the rest. The
  // reactions come out bit-identical at EI = 1 and EI = 1e6 while the note
  // asserted they were "specific to the EI you entered".
  //
  // Since the solve is exact and cheap, the honest thing is to run it again with
  // a different EI and compare the rationals. An assertion about EI-dependence
  // becomes a measurement of it. `probe` stops the recursion at one level.
  let eiDependent = false;
  let eiChecked = true;
  if (eiCoupled && EI != null && !probe) {
    const twin = analyzeBeam({ ...input, ei: ratMul(EI, ratInt(2)) }, true);
    if (twin.ok) {
      eiDependent = supports.some((_s, i) => {
        const a = sol[reactionIdx[i]];
        const b = twin.reactions[i].forceExact;
        return !ratIsZero(ratSub(a, b));
      });
    } else {
      // The twin should always solve — same structure, different EI. If it ever
      // does not, assume dependence (the conservative reading) but do NOT let
      // the note claim it was measured, because it was not.
      eiDependent = true;
      eiChecked = false;
    }
  }

  const determinacy: Determinacy = {
    degree,
    note:
      degree <= 0
        ? "Statically determinate — reactions follow from equilibrium alone." +
          (eiCoupled
            ? " Because it is determinate, the spring stiffness and any settlement move the beam " +
              "but change no reaction: equilibrium alone already fixed them."
            : "")
        : `Statically indeterminate to degree ${degree} — solved by compatibility ` +
          "(deflection conditions at the supports), not by equilibrium alone." +
          (eiCoupled
            ? eiDependent
              ? " The supports are elastic or displaced, so those compatibility conditions carry EI " +
                "and the reactions below are specific to the EI you entered" +
                (eiChecked ? " — checked by re-solving at a different EI and finding them changed." : ".")
              : " The supports are elastic or displaced, so EI entered the equations — but the " +
                "reactions below came out IDENTICAL when re-solved at a different EI, so for this " +
                "structure and this loading they do not depend on it after all."
            : ""),
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

  // THE PROBE STOPS HERE. Everything below samples the beam a few hundred times
  // to find the extremes of shear, moment and deflection — on an eight-support
  // beam that is about 80% of the whole solve — and the EI-dependence check
  // reads exactly one thing from its twin: `reactions[i].forceExact`. Computing
  // the rest and discarding it doubled the cost of every elastic or settling
  // beam in a pane that recomputes on each keystroke.
  //
  // The stub below is deliberately inert rather than plausible: zeroed extrema
  // and sampler functions that throw. A probe result must never be mistaken for
  // an answer, and a silent zero would be exactly that mistake.
  if (probe) {
    const nope = (): never => {
      throw new Error("probe result: only reactions are computed");
    };
    return {
      ok: true,
      length: ratToNumber(L),
      reactions,
      determinacy: { degree, note: "" },
      shearAt: nope,
      momentAt: nope,
      eiSlopeAt: nope,
      eiDeflectionAt: nope,
      maxShear: { x: 0, value: 0, exact: false },
      maxMoment: { x: 0, value: 0, exact: false },
      minMoment: { x: 0, value: 0, exact: false },
      maxEiDeflection: { x: 0, value: 0, exact: false },
      breakpoints: [],
      eiCoupled,
      warnings: [],
    };
  }

  const breaks = collectBreakpoints(L, supports, loads);
  const maxShear = extremeOf((x, inc) => num(V, x, inc), breaks, L, true);
  const mExt = extremeSigned((x) => num(M, x), breaks, L);
  const maxEiDeflection = extremeOf((x) => num(DEF, x), breaks, L, true);

  const warnings: string[] = [];
  if (degree > 0 && !eiCoupled)
    warnings.push(
      "Indeterminate beam: the reactions depend on the beam being PRISMATIC (constant EI) " +
        "and on the supports being RIGID. A support that settles or sits on a soft seat changes " +
        // The syntax quoted here MUST be syntax parseSupports accepts. It read
        // "settle 0.01" without the equals sign, which the parser rejects — and
        // this warning fires on every indeterminate rigid-support beam, so it
        // was the most-read instruction in the module and it failed when obeyed.
        "them — add \"settle=0.01\" or \"k=5e4\" to a support to model that instead of assuming it away.",
    );
  // ONLY on an indeterminate beam. A determinate one is EI-coupled in the solve
  // and still has EI-free RESULTS: equilibrium alone fixes its reactions, so the
  // spring and the settlement move the beam without changing a single force.
  // Gated on `eiCoupled` alone, this warning contradicted the determinacy note
  // printed a few lines above it in the same output, and asserted that numbers
  // "scale with EI" which were provably identical at EI = 1 and EI = 1e6.
  if (degree > 0 && eiDependent)
    warnings.push(
      "These reactions are NOT EI-free. A spring or a settlement puts EI into the compatibility " +
        "equations, so the numbers above belong to the EI you entered and change with it; on a " +
        "rigid-support beam they would not.",
    );
  if (eiCoupled && !eiDependent && degree > 0)
    warnings.push(
      "EI was needed to solve this beam, but the reactions turned out not to depend on it: " +
        "re-solving at a different EI gave exactly the same numbers. That is a property of this " +
        "particular structure and loading, not a general rule — change the load and it will not " +
        "hold.",
    );
  if (degree === 0 && eiCoupled)
    warnings.push(
      "EI was needed to place the beam, but not to find these reactions: the beam is statically " +
        "determinate, so equilibrium alone fixes them and they are the same for any EI. The spring " +
        "and the settlement changed the DEFLECTIONS only.",
    );
  // Requires an actual SETTLEMENT, not merely eiCoupled — which is also true of a
  // spring-only beam. This text is settlement-specific ("scale with the assumed
  // settlement"), so on an indeterminate spring-only beam it asserted a
  // settlement the user never entered.
  const hasSettlement = supports.some((s) => s.settle != null && !ratIsZero(s.settle));
  if (degree > 0 && hasSettlement)
    warnings.push(
      "Settlement-induced reactions are a real load case and are often the governing one, but they " +
        "are also the least certain number in a design: they scale linearly with EI and with the " +
        "assumed settlement, and both are estimates. Treat the magnitude as an order of magnitude.",
    );
  // A single non-fixed support used to warn here. It is UNREACHABLE: one pin or
  // one roller makes V(L) and M(L) proportional, so the matrix is singular and
  // the mechanism branch above has already returned. Left as a comment rather
  // than as code that reads like it fires.

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
    eiCoupled,
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
 * Exact rational from typed text, so "2.5" becomes 5/2 and not a float.
 * Returns null on anything unparseable — the caller must say so rather than
 * silently treating a typo as zero, which would quietly change the beam.
 *
 * This is the CAS's shared literal parser rather than a fourth private copy.
 * The local one this replaced accepted plain decimals only, which was invisible
 * until a spring stiffness had to be written as `k=5e4`: EI and support
 * stiffnesses are the two quantities in this module that nobody types in full,
 * and rejecting `5e4` would have made the new option unusable at exactly the
 * magnitudes it exists for.
 *
 * FRACTIONS. This parser accepts `1/3`, and as of the `NUM` pattern below every
 * support and load field does too, so a support at `8/3` is finally writable in
 * the one notation that is exact. That was not true when the shared parser was
 * first adopted — the fields still gated fractions out with decimal-only
 * patterns, and a comment here claimed otherwise for one release. The claim and
 * the behaviour now agree, and `beamFractions.test.ts` pins them together so
 * they cannot drift apart again. (An earlier draft of this sentence named
 * `beamElasticRegression.test.ts`, which contains no fraction test at all —
 * a false coverage claim inside the very comment apologising for a false claim.
 * Naming a file is itself an assertion; check it.)
 */
const parseRat = parseRatLiteral;

export interface ParsedBeam {
  supports: Support[];
  loads: Load[];
  errors: string[];
}

/**
 * What a number may look like in ANY beam field: a decimal, scientific notation,
 * or an exact FRACTION such as `1/3`.
 *
 * There is one of these rather than five copies because five copies is how the
 * fields drifted apart in the first place. Every numeric group in every support
 * and load pattern interpolates this constant, so a form accepted in one field
 * is accepted in all of them, and `parseRatLiteral` remains the single authority
 * on what the text actually means — the pattern's job is only to decide where
 * the number ENDS.
 *
 * Fractions matter here more than they would elsewhere. This engine computes
 * over exact rationals precisely so that a third stays a third, and until now a
 * support at L/3 could not be written down: `1/3` was rejected by the field
 * before the parser that handles it was ever reached, so the one notation that
 * is exact was the one notation refused. The truss parser has always taken them,
 * because it tokenises and hands each token straight to the shared parser — so
 * this also removes an inconsistency between two engines that share a CAS.
 *
 * The fraction form is deliberately INTEGER over INTEGER, matching what
 * `parseRatLiteral` accepts. `1.5/3` is matched by this pattern and then refused
 * by the parser with "is not a number", which is the honest outcome: writing it
 * as `3/6` or `0.5` is unambiguous, and silently reinterpreting it would not be.
 */
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*\/\s*[+-]?\d+)?`;

/**
 * Reads the support line, e.g. `pin 0, roller 8` or `fixed 0`.
 * `@` is accepted in place of a space because it is what people type.
 *
 * A support may carry either or both of two options, in any order after the
 * position:
 *
 *   roller 8 k=5e4          a vertical spring of that stiffness instead of rigid
 *   roller 8 settle=0.012   a prescribed settlement, DOWNWARD POSITIVE
 *
 * The options are pulled out first and the remainder is matched against the
 * plain form, so the position regex never has to grow to accommodate them —
 * which is how `settle=1e-3` would otherwise end up parsed as a coordinate.
 */
export function parseSupports(text: string): { supports: Support[]; errors: string[] } {
  const supports: Support[] = [];
  const errors: string[] = [];
  const parts = text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    // THE PART IS CUT IN TWO AT THE FIRST OPTION, rather than having options
    // plucked out of the middle of it.
    //
    // Plucking was subtly unsafe once positions could be fractions. The old
    // stripper replaced each `key=value` it matched with a SPACE, and `NUM`
    // tolerates whitespace around its slash — so anything the value pattern
    // could not swallow was left behind to REJOIN the position across that
    // space:
    //
    //     "roller 8 k=1/2/3"  ->  strip "k=1/2"  ->  "roller 8  /3"  ->  x = 8/3
    //
    // No error, no warning, a support silently moved to a third of where it was
    // asked for; on a two-support beam that flipped a reaction into uplift. The
    // same mechanism let an option sit INSIDE a position ("roller 8 k=1/2 /3").
    //
    // Cutting at the first `key=` makes both impossible by construction: the
    // position is whatever precedes it and cannot be assembled from fragments on
    // either side, and the option region must consist ENTIRELY of options or the
    // part is refused. It also enforces what the docstring always claimed — that
    // options come after the position.
    const optAt = p.search(/\b[a-z]+\s*=/i);
    const head = (optAt < 0 ? p : p.slice(0, optAt)).trim();
    const tail = optAt < 0 ? "" : p.slice(optAt);

    const opts = new Map<string, string>();
    let badOpt = false;
    const leftover = tail
      .replace(new RegExp(String.raw`\b([a-z]+)\s*=\s*(${NUM})(?=\s|$)`, "gi"), (_all, key: string, val: string) => {
        const name = key.toLowerCase();
        if (name === "k" || name === "spring" || name === "stiffness") opts.set("k", val);
        else if (name === "settle" || name === "settlement") opts.set("settle", val);
        else {
          errors.push(`"${key}" is not a support option. Use "k=" for a spring or "settle=" for a settlement.`);
          badOpt = true;
        }
        return " ";
      })
      .trim();
    if (badOpt) continue;
    if (leftover) {
      errors.push(
        `Could not read "${leftover}" in the support "${p}". An option is written "k=5e4" or ` +
          `"settle=0.01", and every option comes after the position.`,
      );
      continue;
    }

    const m = new RegExp(String.raw`^(pin|roller|fixed)\s*@?\s*(${NUM})$`, "i").exec(head);
    if (!m) {
      // No em dashes in a PARSER ERROR. The pane runs its result lines through
      // plainDashes, but an error short-circuits before that, so an em dash here
      // reaches the document unconverted. The Engineering audit flags it, which
      // is how this was caught.
      errors.push(
        `Could not read the support "${p}". Write it as "pin 0", "roller 8" or "fixed 0". ` +
          `The position may be a fraction such as "roller 8/3". Options: "k=5e4" for a spring, ` +
          `"settle=0.01" for a settlement.`,
      );
      continue;
    }
    const x = parseRat(m[2]);
    if (!x) {
      errors.push(`"${m[2]}" is not a number.`);
      continue;
    }

    const s: Support = { kind: m[1].toLowerCase() as SupportKind, x };
    const kRaw = opts.get("k");
    if (kRaw !== undefined) {
      const k = parseRat(kRaw);
      if (!k) {
        errors.push(`"${kRaw}" is not a spring stiffness.`);
        continue;
      }
      s.k = k;
    }
    const dRaw = opts.get("settle");
    if (dRaw !== undefined) {
      const d = parseRat(dRaw);
      if (!d) {
        errors.push(`"${dRaw}" is not a settlement.`);
        continue;
      }
      s.settle = d;
    }
    supports.push(s);
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

    let m = new RegExp(String.raw`^(?:point|p|force|f)\s+(${NUM})\s*(?:at|@)\s*(${NUM})$`, "i").exec(line);
    if (m) {
      const p = parseRat(m[1]);
      const x = parseRat(m[2]);
      if (p && x) loads.push({ kind: "point", x, p });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    // Varying intensity FIRST: "udl 0 to 9 from 0 to 6" also matches the uniform
    // pattern's prefix, so testing uniform first would silently drop the taper.
    m = new RegExp(
      String.raw`^(?:udl|w|load)\s+(${NUM})\s+to\s+(${NUM})\s+from\s+(${NUM})\s+to\s+(${NUM})$`,
      "i",
    ).exec(line);
    if (m) {
      const w1 = parseRat(m[1]);
      const w2 = parseRat(m[2]);
      const a = parseRat(m[3]);
      const b = parseRat(m[4]);
      if (w1 && w2 && a && b) loads.push({ kind: "ramp", a, b, w1, w2 });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    m = new RegExp(String.raw`^(?:udl|w|load)\s+(${NUM})\s+from\s+(${NUM})\s+to\s+(${NUM})$`, "i").exec(line);
    if (m) {
      const w = parseRat(m[1]);
      const a = parseRat(m[2]);
      const b = parseRat(m[3]);
      if (w && a && b) loads.push({ kind: "udl", a, b, w });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    m = new RegExp(String.raw`^(?:moment|couple|m)\s+(${NUM})\s*(?:at|@)\s*(${NUM})$`, "i").exec(line);
    if (m) {
      const mm = parseRat(m[1]);
      const x = parseRat(m[2]);
      if (mm && x) loads.push({ kind: "moment", x, m: mm });
      else errors.push(`Could not read the numbers in "${line}".`);
      continue;
    }

    errors.push(
      `Could not read "${line}". Use "point 30 at 6", "udl 5 from 0 to 8", ` +
        `"udl 0 to 9 from 0 to 6" or "moment 200 at 4". Any number may be a fraction, ` +
        `e.g. "point 30 at 8/3".`,
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
