// Linear control systems — transfer functions, stability, time response and
// frequency-domain margins.
//
// COEFFICIENTS RUN HIGHEST POWER FIRST, which is MATLAB's `tf([1],[1 2 1])`
// convention and the one every control textbook prints. The CAS in this repo
// stores polynomials the other way round (index = degree), so the two must
// never be mixed: reversing a coefficient array silently turns s^2 + 2s + 3
// into 3s^2 + 2s + 1, which is a different plant that still factors, still
// plots and still looks reasonable. This module therefore does NOT reuse the
// CAS polynomial helpers at all — it carries its own polyMul/polyAdd/trimPoly
// in this convention, and nothing here reverses an array. The only thing taken
// from the CAS is the exact rational type and its arithmetic, which has no
// ordering to get wrong.
//
// COEFFICIENTS ARE EXACT RATIONALS, and that is not decoration. Routh-Hurwitz
// is a tabulation of differences of products: it is precisely the algorithm
// where a coefficient that is 1e-17 instead of 0 changes the sign count and
// therefore the verdict from "stable" to "unstable". Run in floating point it
// is unreliable near the stability boundary, which is the only place anyone
// ever runs it. Run over rationals it is exact, and the marginal cases become
// exactly detectable rather than a tolerance nobody can choose.
//
// TWO INDEPENDENT ANSWERS TO THE SAME QUESTION, AND THEY ARE COMPARED. The
// number of closed-loop poles in the right half plane is computed twice: once
// exactly by Routh-Hurwitz, and once numerically by finding the poles as
// eigenvalues of the companion matrix. These share no code and no arithmetic.
// When they agree the verdict is reported plainly; WHEN THEY DISAGREE, BOTH ARE
// REPORTED AND NEITHER IS PICKED, because a disagreement means the system is so
// close to the imaginary axis that the numerical roots are not trustworthy —
// which is itself the most useful thing to be told, and is exactly the case a
// single method would answer confidently and wrongly.
//
// WHAT IS REFUSED, AND WHY EACH IS REAL RATHER THAN NUMERICAL:
//   - An IMPROPER transfer function (numerator degree above denominator) is not
//     realisable: it differentiates its input, so its step response contains a
//     delta and no state-space realisation exists. It is refused rather than
//     simulated as something else.
//   - A zero denominator is not a system.
//   - Gain and phase margins that DO NOT EXIST are reported as not existing.
//     A system whose phase never reaches -180 degrees has infinite gain margin,
//     and reporting a number there — or silently reporting the margin at the
//     edge of the swept range — is the standard way to be wrong about it.

import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratInt, ratIsZero, ratNeg, ratSign, ratToNumber, parseRatLiteral } from "./cas";
import { Complex, eigenvaluesGeneral } from "./linalg";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** G(s) = num(s)/den(s), coefficients HIGHEST power of s first. */
export interface TransferFunction {
  num: Rat[];
  den: Rat[];
}

export interface ControlError {
  ok: false;
  error: string;
}

/** Hard caps. A pane recomputes on every keystroke. */
const MAX_ORDER = 20;
const MAX_SAMPLES = 4000;

// ---------------------------------------------------------------------------
// Polynomial helpers (highest power first)
// ---------------------------------------------------------------------------

/** Drops leading zero coefficients, which are not part of the polynomial. */
export function trimPoly(p: Rat[]): Rat[] {
  let i = 0;
  while (i < p.length - 1 && ratIsZero(p[i])) i++;
  return p.slice(i);
}

export function polyMul(a: Rat[], b: Rat[]): Rat[] {
  if (!a.length || !b.length) return [ratInt(0)];
  const out: Rat[] = new Array(a.length + b.length - 1).fill(ratInt(0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] = ratAdd(out[i + j], ratMul(a[i], b[j]));
    }
  }
  return trimPoly(out);
}

export function polyAdd(a: Rat[], b: Rat[]): Rat[] {
  const n = Math.max(a.length, b.length);
  const out: Rat[] = new Array(n).fill(ratInt(0));
  // Aligned from the RIGHT, because the arrays are highest-power-first and the
  // constant term is the last element of each.
  for (let i = 0; i < a.length; i++) out[n - a.length + i] = ratAdd(out[n - a.length + i], a[i]);
  for (let i = 0; i < b.length; i++) out[n - b.length + i] = ratAdd(out[n - b.length + i], b[i]);
  return trimPoly(out);
}

/** Degree of a polynomial; -1 for the zero polynomial. */
export function polyDegree(p: Rat[]): number {
  const t = trimPoly(p);
  return t.length === 1 && ratIsZero(t[0]) ? -1 : t.length - 1;
}

/** Evaluates at a complex point by Horner's rule. */
function polyEvalComplex(p: Rat[], re: number, im: number): Complex {
  let ar = 0;
  let ai = 0;
  for (const c of p) {
    // a = a*s + c
    const nr = ar * re - ai * im + ratToNumber(c);
    const ni = ar * im + ai * re;
    ar = nr;
    ai = ni;
  }
  return { re: ar, im: ai };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Reads a polynomial in s, either as a coefficient list ("1 2 1", "1, 2, 1") or
 * written out ("s^2 + 2*s + 1", "s^2+2s+1"). Highest power first, always.
 *
 * The two notations are told apart by whether an "s" appears at all, which is
 * unambiguous and needs no mode switch in the UI. Parentheses and factored
 * forms are NOT supported and are refused by name rather than mis-parsed: a
 * silently dropped bracket in "(s+1)(s+2)" would give a different plant that
 * still runs.
 */
export function parsePoly(text: string): Rat[] | ControlError {
  const t = text.trim();
  if (!t) return { ok: false, error: "This polynomial is empty." };
  if (t.includes("(") || t.includes(")")) {
    return {
      ok: false,
      error:
        "Factored form is not supported — write the polynomial expanded " +
        '("s^2+3*s+2" rather than "(s+1)*(s+2)"), or give the coefficients highest power first ("1 3 2").',
    };
  }

  if (!/s/i.test(t)) {
    const parts = t.split(/[\s,]+/).filter(Boolean);
    const out: Rat[] = [];
    for (const p of parts) {
      const q = parseRatLiteral(p);
      if (!q) return { ok: false, error: `"${p}" is not a number.` };
      out.push(q);
    }
    if (!out.length) return { ok: false, error: "No coefficients were given." };
    if (out.length - 1 > MAX_ORDER)
      return { ok: false, error: `Order ${out.length - 1} is above the limit of ${MAX_ORDER}.` };
    return trimPoly(out);
  }

  // Written out: split into signed terms, then read each as coeff * s^power.
  const cleaned = t.replace(/\s+/g, "").replace(/\*/g, "");
  // Split into signed terms with a single match rather than by inserting a
  // separator and splitting on it. A sentinel character is how a literal
  // control byte gets into source and then into a regex that can never match —
  // a bug this codebase has already shipped once. No sentinel, no sentinel bug.
  const terms = cleaned.match(/[+-]?[^+-]+/g) ?? [];
  const byPower = new Map<number, Rat>();
  for (const term of terms) {
    const m = /^([+-]?)([\d./]*)(?:s(?:\^(\d+))?)?$/i.exec(term);
    if (!m) return { ok: false, error: `"${term}" is not a term in s.` };
    const hasS = /s/i.test(term);
    if (!hasS && !m[2]) return { ok: false, error: `"${term}" is not a term in s.` };
    const sign = m[1] === "-" ? -1 : 1;
    const coeffText = m[2] || "1";
    const base = parseRatLiteral(coeffText);
    if (!base) return { ok: false, error: `"${coeffText}" is not a number.` };
    const power = hasS ? (m[3] ? parseInt(m[3], 10) : 1) : 0;
    if (!Number.isFinite(power) || power > MAX_ORDER)
      return { ok: false, error: `The power s^${m[3]} is above the limit of ${MAX_ORDER}.` };
    const signed = sign < 0 ? ratNeg(base) : base;
    byPower.set(power, ratAdd(byPower.get(power) ?? ratInt(0), signed));
  }
  const top = Math.max(...byPower.keys());
  const out: Rat[] = [];
  for (let p = top; p >= 0; p--) out.push(byPower.get(p) ?? ratInt(0));
  return trimPoly(out);
}

/** Builds a transfer function from two polynomial texts. */
export function parseTf(numText: string, denText: string): TransferFunction | ControlError {
  const num = parsePoly(numText);
  if ("ok" in num) return { ok: false, error: `Numerator: ${num.error}` };
  const den = parsePoly(denText);
  if ("ok" in den) return { ok: false, error: `Denominator: ${den.error}` };
  if (polyDegree(den) < 0) return { ok: false, error: "The denominator is zero, which is not a system." };
  return { num, den };
}

// ---------------------------------------------------------------------------
// Poles and zeros
// ---------------------------------------------------------------------------

/**
 * Roots of a polynomial, as eigenvalues of its companion matrix.
 *
 * This deliberately reuses the Francis double-shift QR already in linalg.ts
 * rather than adding a second root finder. It handles complex-conjugate pairs,
 * it is the method a numerical library would use, and — the point here — it
 * shares no arithmetic with the exact Routh tabulation it is cross-checked
 * against, so agreement between the two is real evidence rather than the same
 * mistake twice.
 */
export function polyRoots(poly: Rat[]): Complex[] | null {
  const p = trimPoly(poly);
  const n = p.length - 1;
  if (n <= 0) return [];
  if (n > MAX_ORDER) return null;
  const lead = ratToNumber(p[0]);
  if (!Number.isFinite(lead) || lead === 0) return null;

  // BALANCE FIRST. The companion matrix of a badly scaled polynomial is badly
  // conditioned, and the QR iteration then returns garbage — an 8th-order
  // Butterworth at 100 rad/s has coefficients spanning 10^16, and six of its
  // eight roots came back as exactly ZERO, which reads as "poles on the
  // imaginary axis" and turned a perfectly stable filter into a marginally
  // stable one. Substituting s = lambda*u with lambda the geometric mean root
  // magnitude, (|a_n|/|a_0|)^(1/n), makes the first and last coefficients equal
  // and the root magnitudes O(1); the roots are then scaled back at the end.
  // Found by cross-checking a designed filter against this analysis.
  const tail = ratToNumber(p[p.length - 1]);
  let lambda = 1;
  if (Number.isFinite(tail) && tail !== 0) {
    const candidate = Math.pow(Math.abs(tail / lead), 1 / n);
    if (Number.isFinite(candidate) && candidate > 0) lambda = candidate;
  }

  // Coefficients of the polynomial in u, where s = lambda*u, then made MONIC.
  // Both steps are needed: balancing alone leaves a leading coefficient of
  // lambda^n, and a companion matrix built from a non-monic polynomial is not
  // that polynomial's companion matrix at all.
  const scaled = p.map((c, i) => ratToNumber(c) * Math.pow(lambda, n - i));
  const scaledLead = scaled[0];
  if (!Number.isFinite(scaledLead) || scaledLead === 0) return null;
  const a = scaled.slice(1).map((v) => v / scaledLead);
  if (a.some((v) => !Number.isFinite(v))) return null;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) A[0][j] = -a[j];
  for (let i = 1; i < n; i++) A[i][i - 1] = 1;

  try {
    const roots = eigenvaluesGeneral(A);
    // Undo the balancing substitution.
    return roots ? roots.map((z) => ({ re: z.re * lambda, im: z.im * lambda })) : null;
  } catch {
    // eigenvaluesGeneral throws only if QR fails to converge, which must be
    // reported as "no answer" rather than as a root at the origin.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routh-Hurwitz
// ---------------------------------------------------------------------------

export interface RouthResult {
  ok: true;
  /** The Routh array, first column first within each row. */
  rows: Rat[][];
  /** Sign changes in the first column = number of roots in the right half plane. */
  signChanges: number;
  /** True when the tabulation ran without needing a special case. */
  clean: boolean;
  /** A row that vanished entirely, meaning roots symmetric about the origin. */
  zeroRowAt: number | null;
  /** A leading zero that forced the epsilon method. */
  epsilonAt: number | null;
  notes: string[];
}

/**
 * The Routh array of a denominator polynomial, over exact rationals.
 *
 * THE TWO DEGENERATE CASES ARE THE INTERESTING ONES, and both are real
 * statements about the system rather than arithmetic accidents:
 *
 *   A ROW OF ZEROS means the polynomial has roots symmetric about the origin —
 *   a pair on the imaginary axis, or a matched pair straddling it. This is the
 *   marginal-stability case, and it is exactly what a student is looking for
 *   when sweeping a gain. The tabulation continues using the derivative of the
 *   auxiliary polynomial from the row above, which is the standard treatment,
 *   and the auxiliary polynomial's own roots ARE those symmetric roots.
 *
 *   A ZERO IN THE FIRST COLUMN ONLY stalls the division. The textbook fix is to
 *   replace it with a small positive epsilon and continue. Rather than carry a
 *   symbolic infinitesimal, this reports that the case occurred and leaves the
 *   verdict to the pole computation, which is independent and does not
 *   degenerate. Guessing a sign here would be inventing the answer.
 */
export function routhHurwitz(den: Rat[]): RouthResult | ControlError {
  const p = trimPoly(den);
  const n = p.length - 1;
  if (n < 0) return { ok: false, error: "The denominator is zero." };
  if (n > MAX_ORDER) return { ok: false, error: `Order ${n} is above the limit of ${MAX_ORDER}.` };

  const notes: string[] = [];
  if (n === 0) {
    return { ok: true, rows: [[p[0]]], signChanges: 0, clean: true, zeroRowAt: null, epsilonAt: null, notes };
  }

  // First two rows: alternate coefficients.
  const r0: Rat[] = [];
  const r1: Rat[] = [];
  for (let i = 0; i < p.length; i += 2) r0.push(p[i]);
  for (let i = 1; i < p.length; i += 2) r1.push(p[i]);
  while (r1.length < r0.length) r1.push(ratInt(0));

  const rows: Rat[][] = [r0, r1];
  let zeroRowAt: number | null = null;
  let epsilonAt: number | null = null;

  for (let k = 2; k <= n; k++) {
    const above = rows[k - 2];
    const prev = rows[k - 1];

    // An entirely zero row: replace with the derivative of the auxiliary
    // polynomial formed from the row above it.
    if (prev.every((v) => ratIsZero(v))) {
      zeroRowAt = k - 1;
      const order = n - (k - 2);
      const aux: Rat[] = [];
      for (let i = 0; i < above.length; i++) {
        const power = order - 2 * i;
        if (power < 0) break;
        aux.push(ratMul(above[i], ratInt(power)));
      }
      // Every entry zero as well means the row above was zero too; stop.
      if (aux.every((v) => ratIsZero(v))) {
        notes.push("The tabulation degenerated completely; the polynomial has a repeated factor.");
        break;
      }
      for (let i = 0; i < prev.length; i++) prev[i] = aux[i] ?? ratInt(0);
      notes.push(
        `Row ${k - 1} of the array vanished. That means the polynomial has roots SYMMETRIC ABOUT ` +
          "THE ORIGIN — an imaginary-axis pair, or a matched pair straddling it — so the system is " +
          "marginally stable at best. The tabulation continued with the derivative of the auxiliary " +
          "polynomial, which is the standard treatment; the auxiliary polynomial's roots are those " +
          "symmetric roots.",
      );
    }

    if (ratIsZero(prev[0])) {
      epsilonAt = k - 1;
      notes.push(
        `The first entry of row ${k - 1} is zero, so the array cannot be continued by division. ` +
          "The textbook fix replaces it with a small positive epsilon; rather than guess the sign " +
          "that produces, the verdict below is taken from the pole locations, which are computed " +
          "independently and do not degenerate here.",
      );
      break;
    }

    const row: Rat[] = [];
    for (let i = 0; i + 1 < prev.length; i++) {
      const a = above[i + 1] ?? ratInt(0);
      const b = prev[i + 1] ?? ratInt(0);
      row.push(ratNeg(ratDiv(ratSub(ratMul(above[0], b), ratMul(prev[0], a)), prev[0])));
    }
    while (row.length < prev.length) row.push(ratInt(0));
    rows.push(row);
  }

  // Sign changes down the first column.
  let signChanges = 0;
  let last = 0;
  for (const row of rows) {
    const s = ratSign(row[0]);
    if (s === 0) continue;
    if (last !== 0 && s !== last) signChanges++;
    last = s;
  }

  return {
    ok: true,
    rows,
    signChanges,
    clean: zeroRowAt === null && epsilonAt === null,
    zeroRowAt,
    epsilonAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

export interface StabilityResult {
  ok: true;
  poles: Complex[];
  zeros: Complex[];
  /** Poles strictly in the right half plane, counted numerically. */
  rhpPolesNumeric: number;
  /** Poles on the imaginary axis to within the tolerance used. */
  imaginaryAxisPoles: number;
  /** Right-half-plane count from the exact Routh tabulation, when it was clean. */
  rhpPolesRouth: number | null;
  /**
   * True when the denominator has a repeated root, established EXACTLY over the
   * rationals via gcd(p, p') rather than by inspecting the computed poles — which
   * would be circular, since the reason this matters is that the numeric root
   * finder cannot be trusted on a repeated root.
   */
  repeatedPole: boolean;
  routh: RouthResult | null;
  stable: boolean;
  /** True when the two independent methods disagree — reported, never resolved. */
  disagreement: boolean;
  /** A zero in the right half plane makes the system non-minimum-phase. */
  nonMinimumPhase: boolean;
  verdict: string;
  notes: string[];
}

/**
 * Formal derivative, in this module's HIGHEST-POWER-FIRST coefficient order.
 *
 * The order matters and the first version of this got it wrong: written for
 * ascending coefficients it returned the derivative of the reversed polynomial,
 * which happens to be right for a palindrome like (s^2+1)^n — so the (s^2+1)^3
 * case it was written for passed — and wrong for s^2, which it reported as having
 * no repeated root. A helper that is correct only on the example it was built from
 * is the failure mode this project keeps finding; caught here by adding s^2 and
 * (s+1)(s+2)(s+3) to the check.
 *
 * p[0] is the coefficient of s^n with n = p.length - 1, so d/ds drops the constant
 * term and multiplies each remaining coefficient by its own power.
 */
function polyDeriv(p: Rat[]): Rat[] {
  const t = trimPoly(p);
  const n = t.length - 1;
  if (n < 1) return [ratInt(0)];
  const out: Rat[] = [];
  for (let i = 0; i < n; i++) out.push(ratMul(t[i], ratInt(BigInt(n - i))));
  return trimPoly(out);
}

/** Remainder of a divided by b, both highest-power-first. Exact over Q. */
function polyRemainder(a: Rat[], b: Rat[]): Rat[] {
  const db = polyDegree(b);
  if (db < 0) return trimPoly(a);
  const bt = trimPoly(b);
  const lead = bt[0];
  if (ratIsZero(lead)) return trimPoly(a);
  let r = trimPoly(a).slice();
  // Each step removes at least one degree, so deg(a)+1 iterations is a hard
  // ceiling. A bound is not optional in a task pane: a loop that never returns is
  // a frozen Word, not an error message.
  for (let guard = 0; guard <= 64; guard++) {
    const dr = polyDegree(r);
    if (dr < db) return r;
    const c = ratDiv(r[0], lead);
    for (let j = 0; j <= db; j++) r[j] = ratSub(r[j], ratMul(c, bt[j]));
    const next = trimPoly(r);
    if (polyDegree(next) >= dr) return next; // no progress; bail rather than spin
    r = next.slice();
  }
  return r;
}

/**
 * Does this polynomial have a REPEATED root? Answered exactly, over the rationals.
 *
 * gcd(p, p') has positive degree exactly when p has a repeated factor — a theorem,
 * not a heuristic, and it costs nothing here because the coefficients are already
 * exact rationals. Doing it numerically would be circular: the whole reason the
 * question matters is that the numeric root finder cannot be trusted on a repeated
 * root.
 *
 * Why it matters: Durand-Kerner resolves a root of multiplicity m to about
 * eps^(1/m), so a triple root lands roughly 6e-6 from its true position. For
 * `(s^2+1)^3` — three double poles at +/-i, marginally stable — the computed real
 * parts came out near 1e-5 instead of 0 and the verdict read "UNSTABLE, 2 poles in
 * the right half plane". No per-pole tolerance can fix that: 1e-5 is genuinely far
 * from zero, and moving the threshold only changes which repeated-root system is
 * misjudged. Routh cannot arbitrate either, because roots on the imaginary axis
 * produce a zero row and make its tabulation unusable.
 */
function hasRepeatedRoot(p: Rat[]): boolean {
  const a = trimPoly(p);
  if (polyDegree(a) < 2) return false;
  const b = polyDeriv(a);
  if (polyDegree(b) < 1) {
    // p' is a non-zero constant: p is linear, already excluded. p' identically
    // zero cannot happen for a non-constant polynomial over Q.
    return false;
  }
  let u = a;
  let v = b;
  for (let guard = 0; guard <= 64; guard++) {
    if (polyDegree(v) < 0) break;
    const r = polyRemainder(u, v);
    u = v;
    if (polyDegree(r) < 0) break;
    v = r;
  }
  return polyDegree(u) >= 1;
}

export function analyzeStability(tf: TransferFunction): StabilityResult | ControlError {
  const den = trimPoly(tf.den);
  if (polyDegree(den) < 0) return { ok: false, error: "The denominator is zero, which is not a system." };
  if (polyDegree(den) > MAX_ORDER)
    return { ok: false, error: `Order ${polyDegree(den)} is above the limit of ${MAX_ORDER}.` };

  const poles = polyRoots(den);
  if (!poles) return { ok: false, error: "The poles could not be computed for this denominator." };
  const zerosRaw = polyRoots(tf.num);
  const zeros = zerosRaw ?? [];

  const notes: string[] = [];

  // The axis tolerance is relative to the pole magnitudes: an absolute epsilon
  // calls a pole at -1e-9 stable for a slow system and unstable for a fast one.
  // PER-POLE TOLERANCE, NOT ONE SCALED BY THE LARGEST POLE.
  //
  // A single tolerance of 1e-9 times the biggest |pole| means a fast pole sets the
  // yardstick for a slow one. `1/((s+1)(s+2)(s+1e10))` therefore had its two
  // ordinary poles — at -1 and -2, strictly in the left half plane — measured
  // against a tolerance of 10, and was reported "MARGINALLY STABLE, 2 poles on
  // the imaginary axis" for a plainly stable plant. The knock-on was worse than
  // the label: `timeResponse` then refuses to quote a final value, and the pane
  // prints that verdict directly above a pole list where every pole is tagged
  // "(stable)".
  //
  // The cross-check could not catch it either, because `disagreement` compares
  // only RHP counts — Routh said 0 and the numeric method said 0, so they
  // "agreed" while the verdict was wrong. This is the same shape as the
  // eigenvalue threshold in vibration.ts: a tolerance relative to the largest
  // element cannot answer a question about an individual one.
  //
  // Scaling each pole by its own magnitude asks the right question — is this
  // pole's real part negligible compared with THIS pole? — and leaves an absolute
  // floor for a pole genuinely at the origin.
  const poleTol = (p: { re: number; im: number }): number =>
    Math.max(1e-12, 1e-9 * Math.hypot(p.re, p.im));

  const rhpPolesNumeric = poles.filter((p) => p.re > poleTol(p)).length;
  const imaginaryAxisPoles = poles.filter((p) => Math.abs(p.re) <= poleTol(p)).length;

  // A REPEATED POLE MEANS THE NUMERIC REAL PARTS CANNOT BE TRUSTED TO THIS
  // PRECISION, so the verdict is withheld rather than asserted. See
  // hasRepeatedRoot for why no tolerance can rescue this case.
  const repeated = hasRepeatedRoot(den);

  const routh = routhHurwitz(den);
  const routhOk = !("ok" in routh && routh.ok === false);
  const routhRes = routhOk ? (routh as RouthResult) : null;
  const rhpPolesRouth = routhRes && routhRes.clean ? routhRes.signChanges : null;

  const disagreement = rhpPolesRouth !== null && rhpPolesRouth !== rhpPolesNumeric;

  // A repeated pole is only a problem for the NUMERIC method, and only when it sits
  // where the multiplicity error could change the answer.
  //
  // Three conditions, and all three are needed — refusing on repetition alone
  // discards verdicts that are perfectly sound. `(s^2-1)^2` has double poles at
  // +/-1, which Durand-Kerner places to about 1e-8: the real parts are unmistakably
  // positive and UNSTABLE is the right answer, even though Routh cannot tabulate
  // it. And `s^2` has a double pole exactly AT the origin, which is exactly known
  // because the polynomial simply has a factor of s^2.
  //
  // What is genuinely unresolvable is a repeated pole NEAR the axis but not on it:
  // multiplicity m costs about eps^(1/m) of accuracy, so a real part computed as
  // 1e-5 could be zero or could be positive, and nothing here can tell which.
  const axisDoubt = poles.some((pole) => {
    const mag = Math.hypot(pole.re, pole.im);
    if (!Number.isFinite(mag) || mag === 0) return false; // exactly at the origin
    const rel = Math.abs(pole.re) / mag;
    // rel === 0 means the real part came out exactly zero, which is a definite
    // answer, not a doubtful one. The upper bound is eps^(1/4) rounded up, which
    // covers multiplicity 4 and below.
    return rel > 0 && rel < 1e-3;
  });
  const unresolvable = repeated && rhpPolesRouth === null && axisDoubt;

  const stable =
    !unresolvable && rhpPolesNumeric === 0 && imaginaryAxisPoles === 0 && !disagreement;

  let verdict: string;
  if (unresolvable) {
    verdict =
      "UNDETERMINED — this system has a REPEATED pole, and neither method can resolve its " +
      "stability. Computing the poles numerically cannot place a repeated root accurately: a " +
      "root of multiplicity m is found only to about the m-th root of machine precision, so a " +
      "triple root lands roughly 1e-5 away from where it belongs and its computed real part " +
      "carries that error. The exact Routh-Hurwitz tabulation would settle it, but a polynomial " +
      "with roots on the imaginary axis produces a zero row, which is exactly the case it cannot " +
      "complete. Treat this as MARGINAL. Nothing here is precise enough to justify calling it " +
      "stable or unstable, and asserting either would be a guess wearing a verdict.";
    notes.push(
      "For the record, the numerically computed poles are listed below and the real parts you see " +
        "near zero are the multiplicity error, not evidence of instability. (s^2+1)^3 reaches this " +
        "branch: it is three double poles at +/-i, marginally stable, and it was previously " +
        "reported as UNSTABLE with 2 poles in the right half plane.",
    );
  } else if (disagreement) {
    verdict =
      `UNCERTAIN — the two methods disagree. The exact Routh-Hurwitz tabulation finds ` +
      `${rhpPolesRouth} pole(s) in the right half plane; computing the poles numerically finds ` +
      `${rhpPolesNumeric}. That happens when a pole sits so close to the imaginary axis that its ` +
      "computed real part is not trustworthy, which means this system is on the edge of stability " +
      "and should be treated as marginal rather than as either answer.";
    notes.push(
      "A disagreement here is information, not a failure: it is precisely the case where a single " +
        "method would give a confident answer and be wrong.",
    );
  } else if (rhpPolesNumeric > 0) {
    verdict = `UNSTABLE — ${rhpPolesNumeric} pole(s) in the right half plane.`;
  } else if (imaginaryAxisPoles > 0) {
    verdict =
      `MARGINALLY STABLE — ${imaginaryAxisPoles} pole(s) on the imaginary axis and none to the ` +
      "right of it. The response neither decays nor grows; a repeated pair on the axis grows " +
      "without bound, and an integrator (a pole at the origin) means the output ramps.";
  } else {
    verdict = "STABLE — every pole is in the left half plane.";
  }

  // Same per-zero yardstick, for the same reason.
  const nonMinimumPhase = zeros.some((z) => z.re > poleTol(z));
  if (nonMinimumPhase) {
    notes.push(
      "This system is NON-MINIMUM-PHASE: it has a zero in the right half plane. Its step response " +
        "initially moves the WRONG WAY before recovering, and no amount of gain fixes that — " +
        "increasing gain makes it worse and eventually unstable. It also costs phase, so the " +
        "achievable bandwidth is limited in a way the magnitude plot alone does not show.",
    );
  }

  if (routhRes) notes.push(...routhRes.notes);

  return {
    ok: true,
    poles,
    zeros,
    rhpPolesNumeric,
    imaginaryAxisPoles,
    rhpPolesRouth,
    routh: routhRes,
    repeatedPole: repeated,
    stable,
    disagreement,
    nonMinimumPhase,
    verdict,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** G1 * G2 in series. */
export function series(a: TransferFunction, b: TransferFunction): TransferFunction {
  return { num: polyMul(a.num, b.num), den: polyMul(a.den, b.den) };
}

/**
 * Negative-feedback closed loop: G/(1 + G*H).
 * H defaults to unity feedback, which is what "closed loop" means unqualified.
 */
export function feedback(g: TransferFunction, h?: TransferFunction): TransferFunction {
  const H = h ?? { num: [ratInt(1)], den: [ratInt(1)] };
  return {
    num: polyMul(g.num, H.den),
    den: polyAdd(polyMul(g.den, H.den), polyMul(g.num, H.num)),
  };
}

/**
 * A PID controller, Kp + Ki/s + Kd*s, as a transfer function.
 *
 * THE INTEGRATOR IS CANCELLED WHEN Ki IS ZERO, and that is a correctness fix
 * rather than tidying. Written as (Kd s^2 + Kp s + Ki)/s, a P or PD controller
 * keeps a denominator of s and a numerator that is divisible by s — so the
 * stability analysis sees a POLE AT THE ORIGIN and reports a pure proportional
 * gain as "marginally stable". The pole and the zero cancel exactly, so the
 * cancellation is performed here rather than left to produce a wrong verdict
 * downstream. Caught by an oracle test on a P-only controller.
 */
export function pidTf(kp: Rat, ki: Rat, kd: Rat): TransferFunction {
  if (ratIsZero(ki)) {
    // (Kd s^2 + Kp s)/s = Kd s + Kp — no integrator, so no pole at the origin.
    return { num: trimPoly([kd, kp]), den: [ratInt(1)] };
  }
  return { num: trimPoly([kd, kp, ki]), den: [ratInt(1), ratInt(0)] };
}

// ---------------------------------------------------------------------------
// Time response
// ---------------------------------------------------------------------------

export interface TimeResponse {
  ok: true;
  t: number[];
  y: number[];
  /** Final value from the final-value theorem, or null when it does not apply. */
  finalValue: number | null;
  peak: { t: number; y: number };
  notes: string[];
}

/**
 * Step or impulse response, by integrating the controllable canonical state
 * space with fixed-step RK4.
 *
 * WHY A STATE SPACE AND NOT A PARTIAL-FRACTION CLOSED FORM. The closed form
 * needs the poles, and it needs them factored into distinct and repeated
 * groups; a repeated pole makes the residue formula different, and a nearly
 * repeated pole makes it numerically explosive while the system itself is
 * perfectly well behaved. Integrating the realisation has none of those cases —
 * it does not care whether poles repeat.
 *
 * THE STEP SIZE IS CHOSEN FROM THE FASTEST POLE, not fixed, because a system
 * with poles at -1 and -1000 needs 1000x smaller steps to be stable in RK4 and
 * a fixed step would silently return a diverging garbage curve that looks like
 * an unstable system. The number of steps is HARD CAPPED, and if the cap binds
 * the result says the trace is under-resolved rather than presenting it as
 * accurate.
 */
export function timeResponse(
  tf: TransferFunction,
  kind: "step" | "impulse",
  tEnd: number,
  samples = 400,
): TimeResponse | ControlError {
  const num = trimPoly(tf.num);
  const den = trimPoly(tf.den);
  const n = polyDegree(den);
  const m = polyDegree(num);

  if (n < 0) return { ok: false, error: "The denominator is zero, which is not a system." };
  if (n === 0) return { ok: false, error: "A transfer function with no dynamics has no time response to plot." };
  if (m > n) {
    return {
      ok: false,
      error:
        "This transfer function is IMPROPER — the numerator's degree is higher than the " +
        "denominator's. Such a system differentiates its input, so it has no state-space " +
        "realisation and its step response contains an impulse. It is not realisable and is not " +
        "simulated here.",
    };
  }
  if (n > MAX_ORDER) return { ok: false, error: `Order ${n} is above the limit of ${MAX_ORDER}.` };
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { ok: false, error: "The end time must be a positive number." };
  const nSamples = Math.max(2, Math.min(Math.floor(samples) || 400, MAX_SAMPLES));

  const notes: string[] = [];

  // Controllable canonical form for a strictly proper part, plus a direct
  // feedthrough term when the degrees are equal.
  const a0 = ratToNumber(den[0]);
  if (!Number.isFinite(a0) || a0 === 0) return { ok: false, error: "The denominator's leading coefficient is zero." };
  const a = den.slice(1).map((c) => ratToNumber(c) / a0);
  const bFull = new Array(n + 1).fill(0);
  const numArr = num.map((c) => ratToNumber(c) / a0);
  for (let i = 0; i < numArr.length; i++) bFull[n - (numArr.length - 1 - i)] = numArr[i];
  const d = bFull[0];
  const b = bFull.slice(1).map((v, i) => v - d * a[i]);

  if (a.some((v) => !Number.isFinite(v)) || b.some((v) => !Number.isFinite(v))) {
    return { ok: false, error: "These coefficients overflow double precision." };
  }

  /** dx/dt for the companion form. */
  const deriv = (x: number[], u: number): number[] => {
    const dx = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) dx[i] = x[i + 1];
    let acc = u;
    for (let i = 0; i < n; i++) acc -= a[n - 1 - i] * x[i];
    dx[n - 1] = acc;
    return dx;
  };

  // Step size from the fastest pole. Without this a stiff plant diverges.
  const poles = polyRoots(den);
  const fastest = poles && poles.length ? Math.max(...poles.map((p) => Math.hypot(p.re, p.im))) : 1;
  const dtStable = fastest > 0 ? 0.1 / fastest : tEnd / nSamples;
  const dtSample = tEnd / (nSamples - 1);
  let sub = Math.ceil(dtSample / Math.max(dtStable, 1e-300));
  if (!Number.isFinite(sub) || sub < 1) sub = 1;

  // TWO CAPS, because the per-sample one does not bound the total work. Capping
  // sub-steps alone bounds memory and nothing else: 400 samples x 2000 sub-steps
  // is 800,000 RK4 evaluations, which measured at 2.4 SECONDS — and this runs on
  // every keystroke, where 2.4 seconds is not slow, it is the pane hanging. The
  // total-step cap is the one that actually bounds the time. Found by timing the
  // adversarial pass rather than by reading the code, which is the only way this
  // kind of bound gets found.
  const MAX_SUB = 2000;
  const MAX_TOTAL_STEPS = 120000;
  let capped = false;
  if (sub > MAX_SUB) {
    sub = MAX_SUB;
    capped = true;
  }
  const byTotal = Math.max(1, Math.floor(MAX_TOTAL_STEPS / nSamples));
  if (sub > byTotal) {
    sub = byTotal;
    capped = true;
  }
  if (capped) {
    notes.push(
      "The poles of this system span a very wide range of speeds, so the trace is UNDER-RESOLVED: " +
        "the fastest mode needs a smaller step than the interactive step budget allows. Shorten " +
        "the end time to see the fast transient, or treat the fast mode as instantaneous.",
    );
  }
  const h = dtSample / sub;

  const x = new Array(n).fill(0);
  // An impulse into the controllable canonical form is an initial condition on
  // the last state; simulating a tall narrow pulse instead would make the answer
  // depend on the pulse width, which is a modelling choice, not a fact.
  if (kind === "impulse") x[n - 1] = 1;
  const u = kind === "step" ? 1 : 0;

  const t: number[] = [0];
  const outAt = (xs: number[]): number => {
    let y = d * u;
    for (let i = 0; i < n; i++) y += b[n - 1 - i] * xs[i];
    return y;
  };
  const y: number[] = [outAt(x)];

  for (let k = 1; k < nSamples; k++) {
    for (let s = 0; s < sub; s++) {
      const k1 = deriv(x, u);
      const x2 = x.map((v, i) => v + (h / 2) * k1[i]);
      const k2 = deriv(x2, u);
      const x3 = x.map((v, i) => v + (h / 2) * k2[i]);
      const k3 = deriv(x3, u);
      const x4 = x.map((v, i) => v + h * k3[i]);
      const k4 = deriv(x4, u);
      for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    if (x.some((v) => !Number.isFinite(v))) {
      notes.push(
        "The response overflowed before the end time — this system is unstable and its output " +
          "grows without bound. The trace is truncated where it left double precision.",
      );
      break;
    }
    t.push(k * dtSample);
    y.push(outAt(x));
  }

  // Final value theorem: lim s->0 of s*G(s)/s = G(0) for a step, and it applies
  // only when the closed loop is stable. Quoting it for an unstable system is a
  // classic way to report a settling value a diverging signal never reaches.
  let finalValue: number | null = null;
  const st = analyzeStability(tf);
  if (st.ok && st.stable && kind === "step") {
    const dc = ratToNumber(den[den.length - 1]);
    finalValue = dc !== 0 ? ratToNumber(num[num.length - 1]) / dc : null;
  } else if (kind === "step") {
    notes.push(
      "The final-value theorem is NOT quoted here, because it only applies to a stable system. " +
        "Applying it anyway is how a diverging response gets reported with a tidy settling value.",
    );
  }

  let peak = { t: t[0], y: y[0] };
  for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(peak.y)) peak = { t: t[i], y: y[i] };

  return { ok: true, t, y, finalValue, peak, notes };
}

// ---------------------------------------------------------------------------
// Second-order metrics
// ---------------------------------------------------------------------------

export interface SecondOrderMetrics {
  ok: true;
  /** Undamped natural frequency, rad/s. */
  wn: number;
  /** Damping ratio. */
  zeta: number;
  /** Damped natural frequency, rad/s; 0 when overdamped. */
  wd: number;
  kind: "underdamped" | "critically damped" | "overdamped" | "undamped" | "unstable";
  /** Fractional overshoot (0.163 = 16.3%); null unless underdamped. */
  overshoot: number | null;
  peakTime: number | null;
  /** 2% settling time, the usual convention. */
  settlingTime: number | null;
  /** 0-100% rise time for an underdamped system. */
  riseTime: number | null;
  exact: boolean;
  notes: string[];
}

/**
 * 2% settling time of a critically damped or overdamped second-order step
 * response, found by solving for the crossing rather than approximating it.
 *
 * The unit step response of 1/(s^2 + 2*zeta*wn*s + wn^2) normalised to a final
 * value of 1:
 *
 *   zeta = 1   y(t) = 1 - (1 + wn*t) * exp(-wn*t)
 *   zeta > 1   y(t) = 1 - (p2*exp(-p1*t) - p1*exp(-p2*t)) / (p2 - p1)
 *
 * with p1 = zeta*wn - wn*sqrt(zeta^2-1) the SLOW pole and p2 the fast one. The
 * error 1 - y(t) is positive and strictly decreasing for both, so the 2% crossing
 * is unique and bisection on it is exact to the precision asked for — no envelope
 * approximation, and no rule of thumb that breaks down near zeta = 1.
 *
 * Returns null rather than guessing if the crossing cannot be bracketed.
 */
function settlingTimeHeavilyDamped(zeta: number, wn: number, tolerance = 0.02): number | null {
  if (!(zeta >= 1) || !(wn > 0) || !Number.isFinite(zeta) || !Number.isFinite(wn)) return null;

  const err = (t: number): number => {
    if (zeta === 1) return (1 + wn * t) * Math.exp(-wn * t);
    const r = wn * Math.sqrt(zeta * zeta - 1);
    const p1 = zeta * wn - r; // slow
    const p2 = zeta * wn + r; // fast
    if (!(p1 > 0) || !Number.isFinite(p2) || p2 === p1) return NaN;
    // Written so the dominant term is evaluated directly; for large zeta,
    // p2*exp(-p1*t)/(p2-p1) is the whole answer and the other term underflows
    // harmlessly.
    return (p2 * Math.exp(-p1 * t) - p1 * Math.exp(-p2 * t)) / (p2 - p1);
  };

  // Bracket by doubling from the slow pole's time constant. A bound is essential:
  // an unbounded search inside a task pane is a frozen Word, not an error message.
  const slow = zeta === 1 ? wn : zeta * wn - wn * Math.sqrt(zeta * zeta - 1);
  if (!(slow > 0) || !Number.isFinite(slow)) return null;
  let hi = 1 / slow;
  let guard = 0;
  while (err(hi) > tolerance) {
    hi *= 2;
    if (++guard > 200 || !Number.isFinite(hi)) return null;
  }
  let lo = 0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (err(mid) > tolerance) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return Number.isFinite(t) && t >= 0 ? t : null;
}

/**
 * Damping ratio, natural frequency and the transient metrics that follow.
 *
 * FOR A GENUINE SECOND-ORDER DENOMINATOR these are exact identities. For
 * anything higher they are computed from the DOMINANT pole pair — the complex
 * pair closest to the imaginary axis — and that is an approximation which is
 * good when the other poles are several times faster and poor when they are
 * not. The result says which case it is rather than presenting an estimate as a
 * result, because "overshoot 16%" reads identically whether it was derived or
 * guessed.
 *
 * A ZERO NEAR THE DOMINANT PAIR BREAKS THESE FORMULAS, and that is flagged: a
 * left-half-plane zero increases overshoot substantially, and the standard
 * formulas know nothing about zeros at all.
 */
export function secondOrderMetrics(tf: TransferFunction): SecondOrderMetrics | ControlError {
  const den = trimPoly(tf.den);
  const n = polyDegree(den);
  if (n < 1) return { ok: false, error: "This has no dynamics to characterise." };

  const notes: string[] = [];
  let wn: number;
  let zeta: number;
  let exact = false;

  if (n === 2) {
    const a = ratToNumber(den[0]);
    const b = ratToNumber(den[1]);
    const c = ratToNumber(den[2]);
    if (a === 0 || !Number.isFinite(a)) return { ok: false, error: "The leading coefficient is zero." };
    // s^2 + 2*zeta*wn*s + wn^2
    const p = b / a;
    const q = c / a;
    if (q < 0) {
      return {
        ok: false,
        error:
          "This second-order system has a negative wn^2 term, so its poles are real and of " +
          "opposite sign — it is unstable and the damping-ratio description does not apply to it.",
      };
    }
    wn = Math.sqrt(q);
    zeta = wn > 0 ? p / (2 * wn) : Infinity;
    exact = true;
  } else {
    const poles = polyRoots(den);
    if (!poles) return { ok: false, error: "The poles could not be computed." };
    const complexPairs = poles.filter((z) => Math.abs(z.im) > 1e-12 && z.re < 0);
    if (!complexPairs.length) {
      return {
        ok: false,
        error:
          "This system has no stable complex pole pair, so it has no oscillatory mode and the " +
          "damping-ratio description does not apply. Its response is a sum of exponentials.",
      };
    }
    // Dominant = smallest |Re|, i.e. slowest to decay.
    const dom = complexPairs.reduce((best, z) => (Math.abs(z.re) < Math.abs(best.re) ? z : best));
    wn = Math.hypot(dom.re, dom.im);
    zeta = wn > 0 ? -dom.re / wn : 0;
    const others = poles.filter((z) => z !== dom && Math.abs(z.im - -dom.im) > 1e-12);
    const ratio = others.length ? Math.min(...others.map((z) => Math.abs(z.re))) / Math.abs(dom.re) : Infinity;
    notes.push(
      `This is order ${n}, so these figures come from the DOMINANT pole pair and are an ` +
        "approximation, not an identity.",
    );
    if (Number.isFinite(ratio) && ratio < 5) {
      notes.push(
        `The next pole is only ${ratio.toFixed(1)}x faster than the dominant pair. The dominant-pole ` +
          "approximation needs a factor of about 5 to be trustworthy, so treat the overshoot and " +
          "settling figures below as indicative only — simulate the step response for the real numbers.",
      );
    }
  }

  if (!Number.isFinite(wn) || !Number.isFinite(zeta)) {
    return { ok: false, error: "The natural frequency or damping ratio is not finite for this system." };
  }

  let kind: SecondOrderMetrics["kind"];
  if (zeta < 0) kind = "unstable";
  else if (zeta === 0) kind = "undamped";
  else if (zeta < 1) kind = "underdamped";
  else if (Math.abs(zeta - 1) < 1e-12) kind = "critically damped";
  else kind = "overdamped";

  const wd = zeta < 1 && zeta >= 0 ? wn * Math.sqrt(1 - zeta * zeta) : 0;

  let overshoot: number | null = null;
  let peakTime: number | null = null;
  let riseTime: number | null = null;
  let settlingTime: number | null = null;

  if (kind === "underdamped" && wd > 0) {
    overshoot = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    peakTime = Math.PI / wd;
    riseTime = (Math.PI - Math.acos(zeta)) / wd;
  }
  // SETTLING TIME: THE ENVELOPE FORMULA IS ONLY VALID FOR zeta < 1.
  //
  // `4/(zeta*wn)` comes from the decaying envelope exp(-zeta*wn*t) of an
  // UNDERDAMPED response. Applied to an overdamped system it is not merely
  // approximate, it runs the wrong way: as damping rises the reported settling
  // time FALLS, when a heavily damped system settles more slowly. Measured, with
  // wn = 1:
  //
  //     zeta      reported     true
  //     1         4            5.83
  //     2         2            14.9
  //     5         0.8          39.6
  //     20        0.2          160
  //
  // At zeta = 20 that is 800x optimistic, and it was flagged `exact`. Anyone
  // sizing a controller from it is told the loop settles almost instantly when it
  // crawls.
  //
  // For zeta > 1 the two poles are real at -zeta*wn +/- wn*sqrt(zeta^2-1), and the
  // response is a sum of two decaying exponentials dominated by the SLOWER one —
  // the pole nearer the origin, which is the one the envelope formula ignores.
  // Note that for large zeta the slow pole tends to -wn/(2*zeta), so the settling
  // time grows roughly as 8*zeta/wn: the opposite of what was reported.
  //
  // The 2% crossing is solved numerically rather than with the 4/|Re| rule of
  // thumb, because the second exponential's coefficient is large enough to matter
  // near zeta = 1 and the critically damped case has a t*exp(-t) term that no
  // single-pole approximation captures at all.
  if (zeta > 0 && wn > 0) {
    if (zeta < 1) {
      settlingTime = 4 / (zeta * wn);
    } else {
      settlingTime = settlingTimeHeavilyDamped(zeta, wn);
      if (settlingTime === null) {
        notes.push(
          "The 2% settling time could not be bracketed for this system; no value is reported " +
            "rather than one from the underdamped envelope formula, which does not apply when " +
            "zeta >= 1.",
        );
      }
    }
  }

  if (kind === "undamped") {
    notes.push("Zero damping: this oscillates for ever at wn and never settles.");
  }
  if (kind === "unstable") {
    notes.push("Negative damping: the oscillation GROWS. The transient metrics do not apply.");
  }

  // Zeros invalidate the standard formulas, and the effect is not small.
  const zeros = polyRoots(tf.num) ?? [];
  const near = zeros.filter((z) => Math.hypot(z.re, z.im) < 5 * wn && Math.hypot(z.re, z.im) > 0);
  if (near.length) {
    notes.push(
      "This system has a zero close to the dominant poles. The overshoot and rise-time formulas " +
        "above are derived for a system with NO zeros, and a nearby left-half-plane zero increases " +
        "overshoot substantially — often by more than the damping ratio suggests. Simulate the step " +
        "response rather than trusting these figures.",
    );
  }

  return { ok: true, wn, zeta, wd, kind, overshoot, peakTime, settlingTime, riseTime, exact, notes };
}

// ---------------------------------------------------------------------------
// Frequency response and margins
// ---------------------------------------------------------------------------

export interface FrequencyPoint {
  w: number;
  magnitude: number;
  magnitudeDb: number;
  phaseDeg: number;
}

/** Evaluates G(jw) over a list of frequencies, with the phase unwrapped. */
export function frequencyResponse(tf: TransferFunction, freqs: number[]): FrequencyPoint[] {
  const out: FrequencyPoint[] = [];
  let unwrap = 0;
  let prevRaw = NaN;
  for (const w of freqs) {
    const nu = polyEvalComplex(tf.num, 0, w);
    const de = polyEvalComplex(tf.den, 0, w);
    const dmag2 = de.re * de.re + de.im * de.im;
    const re = dmag2 === 0 ? Infinity : (nu.re * de.re + nu.im * de.im) / dmag2;
    const im = dmag2 === 0 ? Infinity : (nu.im * de.re - nu.re * de.im) / dmag2;
    const magnitude = Math.hypot(re, im);
    let raw = (Math.atan2(im, re) * 180) / Math.PI;
    // Unwrap: a Bode phase that jumps 360 degrees at a crossing is an artefact
    // of atan2, and reading a margin off a wrapped plot is a standard error.
    if (Number.isFinite(prevRaw)) {
      const diff = raw + unwrap - (prevRaw + unwrap);
      if (diff > 180) unwrap -= 360;
      else if (diff < -180) unwrap += 360;
    }
    prevRaw = raw;
    raw += unwrap;
    out.push({
      w,
      magnitude,
      magnitudeDb: magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity,
      phaseDeg: raw,
    });
  }
  return out;
}

/** Log-spaced frequencies, decades either side of the interesting dynamics. */
export function autoFrequencies(tf: TransferFunction, count = 300): number[] {
  const roots = [...(polyRoots(tf.den) ?? []), ...(polyRoots(tf.num) ?? [])];
  const mags = roots.map((r) => Math.hypot(r.re, r.im)).filter((m) => m > 1e-12 && Number.isFinite(m));
  const lo = mags.length ? Math.min(...mags) / 100 : 0.01;
  const hi = mags.length ? Math.max(...mags) * 100 : 100;
  const n = Math.max(10, Math.min(count, MAX_SAMPLES));
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  return Array.from({ length: n }, (_, i) => Math.pow(10, a + ((b - a) * i) / (n - 1)));
}

export interface Margins {
  ok: true;
  /** Gain margin in dB; null when the phase never reaches -180 degrees. */
  gainMarginDb: number | null;
  /** Frequency at which the phase crosses -180 degrees. */
  phaseCrossoverW: number | null;
  /** Phase margin in degrees; null when the magnitude never crosses 0 dB. */
  phaseMarginDeg: number | null;
  /** Frequency at which the magnitude crosses 0 dB. */
  gainCrossoverW: number | null;
  /**
   * EVERY 0 dB crossing with its phase margin, lowest frequency first.
   *
   * `phaseMarginDeg` above is the minimum of these, because that is the margin
   * that binds. The full list is exposed so a caller can show it: three crossings
   * at 33, 149 and 23 degrees is a different engineering situation from a single
   * crossing at 23, even though the reported margin is the same.
   */
  gainCrossings: Array<{ w: number; marginDeg: number }>;
  /** Every -180 degree crossing with its gain margin, lowest frequency first. */
  phaseCrossings: Array<{ w: number; marginDb: number }>;
  notes: string[];
}

/**
 * The frequency range a MARGIN calculation needs, which is not the range a Bode
 * plot needs.
 *
 * `autoFrequencies` spans two decades either side of the pole and zero
 * magnitudes. That is right for plotting and wrong for margins, because those
 * magnitudes DO NOT MOVE WHEN THE GAIN CHANGES and the gain crossover does. For
 * `1e12/(s+1)^3` every pole sits at 1, so the sweep stopped at 100 — while the
 * true 0 dB crossing is at omega = 10005. The result was "the magnitude never
 * crosses 0 dB over the swept range, so there is no phase margin", reported for a
 * loop that has one. A bounded sweep silently became a wrong answer, which is
 * exactly what this function's own docstring warns about for the gain margin.
 *
 * So the range is EXTENDED until |L| actually brackets 1, rather than assumed to.
 * The extension is bounded — a task pane that recomputes on every keystroke cannot
 * afford an unbounded search, and a loop that never returns is a frozen Word, not
 * an error message.
 */
function marginSweep(open: TransferFunction, count = 2000): number[] {
  const base = autoFrequencies(open, count);
  if (!base.length || base.some((f) => !Number.isFinite(f))) return base;

  const magAt = (w: number): number => {
    const nu = polyEvalComplex(open.num, 0, w);
    const de = polyEvalComplex(open.den, 0, w);
    const d2 = de.re * de.re + de.im * de.im;
    if (d2 === 0) return Infinity;
    return Math.hypot(
      (nu.re * de.re + nu.im * de.im) / d2,
      (nu.im * de.re - nu.re * de.im) / d2,
    );
  };

  let lo = base[0];
  let hi = base[base.length - 1];
  const wantsBracket = (): boolean => {
    const a = magAt(lo);
    const b = magAt(hi);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    // Already straddles 0 dB somewhere between the ends.
    return (a - 1) * (b - 1) < 0;
  };

  // Push out by a decade at a time, up to 12 decades each way. Beyond about 1e15
  // the double arithmetic in polyEvalComplex stops being meaningful anyway, so a
  // wider search would buy noise rather than answers.
  let guard = 0;
  while (!wantsBracket() && guard < 24) {
    const aboveAtHi = magAt(hi) > 1;
    const aboveAtLo = magAt(lo) > 1;
    if (aboveAtHi && aboveAtLo) {
      // |L| is above 0 dB at both ends: the crossing, if any, is at higher
      // frequency, where a proper transfer function must eventually roll off.
      hi *= 10;
    } else if (!aboveAtHi && !aboveAtLo) {
      // Below 0 dB at both ends: look lower, where an integrator would lift it.
      lo /= 10;
    } else {
      break;
    }
    if (!Number.isFinite(hi) || lo <= 0 || !Number.isFinite(1 / lo)) break;
    guard++;
  }

  const n = Math.max(10, Math.min(count, MAX_SAMPLES));
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return base;
  return Array.from({ length: n }, (_, i) => Math.pow(10, a + ((b - a) * i) / (n - 1)));
}

/**
 * Gain and phase margins of an OPEN-LOOP transfer function.
 *
 * THESE ARE OPEN-LOOP QUANTITIES THAT PREDICT CLOSED-LOOP BEHAVIOUR, which is
 * the single most common confusion about them: they are read off L(s) = G*H and
 * they tell you about the loop closed around it. Passing a closed-loop transfer
 * function here produces numbers that mean nothing, so the caller is told.
 *
 * A margin that DOES NOT EXIST is reported as not existing. A first-order lag's
 * phase never reaches -180 degrees, so its gain margin is infinite and no
 * finite number is correct; reporting the value at the end of whatever range
 * happened to be swept is how a bounded sweep becomes a wrong answer.
 */
export function margins(open: TransferFunction): Margins | ControlError {
  const freqs = marginSweep(open);
  if (!freqs.length || freqs.some((f) => !Number.isFinite(f))) {
    return { ok: false, error: "A sensible frequency range could not be chosen for this system." };
  }
  const resp = frequencyResponse(open, freqs);
  const notes: string[] = [];

  /** G(jw) as a complex number, with no phase bookkeeping at all. */
  const gAt = (w: number): { re: number; im: number; mag: number } => {
    const nu = polyEvalComplex(open.num, 0, w);
    const de = polyEvalComplex(open.den, 0, w);
    const d2 = de.re * de.re + de.im * de.im;
    if (d2 === 0) return { re: Infinity, im: Infinity, mag: Infinity };
    const re = (nu.re * de.re + nu.im * de.im) / d2;
    const im = (nu.im * de.re - nu.re * de.im) / d2;
    return { re, im, mag: Math.hypot(re, im) };
  };

  /**
   * Bisects on a log frequency axis for a sign change of `f`.
   *
   * The bracket comes from the sampled sweep; only the refinement happens here,
   * and the iteration count is FIXED rather than tolerance-driven because this
   * runs on every keystroke and a convergence loop that fails to converge in a
   * task pane is a frozen Word.
   */
  const bisect = (lo: number, hi: number, f: (w: number) => number): number => {
    let a = lo;
    let b = hi;
    let fa = f(a);
    for (let k = 0; k < 80; k++) {
      const mid = Math.sqrt(a * b);
      const fm = f(mid);
      if (fm === 0 || !Number.isFinite(fm)) return mid;
      if (fa * fm < 0) {
        b = mid;
      } else {
        a = mid;
        fa = fm;
      }
    }
    return Math.sqrt(a * b);
  };

  // ALL CROSSINGS, THEN THE WORST ONE. NOT THE FIRST ONE.
  //
  // A loop whose magnitude is not monotonic crosses 0 dB more than once, and it
  // has a phase margin at each crossing. The stability margin is the SMALLEST of
  // them — that is what the word margin means. Reporting the first gave
  // `100*(s^2+0.02s+1)/(s+1)^4` a phase margin of 32.5 degrees when its three
  // crossings are at 33.0, 148.8 and 23.1 degrees, so the binding margin is 23.1.
  // A number that says "comfortable" about a loop that is not is worse than no
  // number.
  //
  // The same argument applies to the gain margin at multiple phase crossovers, so
  // both loops now collect everything and take the minimum, and both say how many
  // they found — because "3 crossings, worst of them 23 degrees" is a different
  // engineering situation from "one crossing at 23 degrees" even though the margin
  // is the same.
  const phaseCrossings: Array<{ w: number; marginDb: number }> = [];
  for (let i = 0; i + 1 < resp.length; i++) {
    const a = resp[i].phaseDeg + 180;
    const b = resp[i + 1].phaseDeg + 180;
    if (a === 0 || a * b < 0) {
      // REFINE ON Im(G), NOT ON THE PHASE. The phase reported by
      // frequencyResponse is unwrapped ACROSS THE WHOLE SWEEP, so evaluating a
      // single frequency in isolation restarts the unwrapping and returns
      // +179.9 where the swept value is -180.1 — and the bisection then walks
      // away from the crossing instead of into it. Phase = -180 degrees is
      // exactly "G is real and negative", so Im(G) = 0 locates the same point
      // with no phase bookkeeping to get wrong. Found by an oracle test that
      // knew the answer algebraically.
      const w = bisect(freqs[i], freqs[i + 1], (w2) => gAt(w2).im);
      const mag = gAt(w).mag;
      if (Number.isFinite(w) && w > 0 && Number.isFinite(mag) && mag > 0) {
        phaseCrossings.push({ w, marginDb: -20 * Math.log10(mag) });
      }
    }
  }
  // The worst gain margin is the smallest one; a negative value means the loop is
  // already unstable, and that must not be hidden behind a comfortable crossing
  // found earlier in the sweep.
  let phaseCrossoverW: number | null = null;
  let gainMarginDb: number | null = null;
  if (phaseCrossings.length) {
    const worst = phaseCrossings.reduce((m, c) => (c.marginDb < m.marginDb ? c : m));
    phaseCrossoverW = worst.w;
    gainMarginDb = worst.marginDb;
    if (phaseCrossings.length > 1) {
      notes.push(
        `The phase crosses -180 degrees at ${phaseCrossings.length} frequencies ` +
          `(${phaseCrossings.map((c) => c.w.toPrecision(4)).join(", ")} rad/s). The gain margin ` +
          `reported is the WORST of them, which is the one that binds; the others are larger.`,
      );
    }
  }
  if (phaseCrossoverW === null) {
    notes.push(
      "The phase never reaches -180 degrees over the swept range, so there is NO finite gain " +
        "margin: the loop cannot be driven unstable by raising the gain alone. That is a property " +
        "of the system, not a gap in the sweep.",
    );
  }

  const gainCrossings: Array<{ w: number; marginDeg: number }> = [];
  for (let i = 0; i + 1 < resp.length; i++) {
    const a = resp[i].magnitudeDb;
    const b = resp[i + 1].magnitudeDb;
    if (a === 0 || a * b < 0) {
      // Magnitude carries no wrapping, so it can be refined directly.
      const w = bisect(freqs[i], freqs[i + 1], (w2) => gAt(w2).mag - 1);
      // The phase here is taken from the SWEPT response so the unwrapping is
      // the same one the user sees on the Bode plot, interpolated across the
      // bracket the crossing was found in.
      const g = gAt(w);
      const rawDeg = (Math.atan2(g.im, g.re) * 180) / Math.PI;
      // Align the isolated atan2 value with the swept, unwrapped phase by
      // choosing the 360-degree branch nearest the bracket's sampled phase.
      const reference = resp[i].phaseDeg;
      const k = Math.round((reference - rawDeg) / 360);
      const marginDeg = 180 + (rawDeg + 360 * k);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(marginDeg)) {
        gainCrossings.push({ w, marginDeg });
      }
    }
  }
  let gainCrossoverW: number | null = null;
  let phaseMarginDeg: number | null = null;
  if (gainCrossings.length) {
    const worst = gainCrossings.reduce((m, c) => (c.marginDeg < m.marginDeg ? c : m));
    gainCrossoverW = worst.w;
    phaseMarginDeg = worst.marginDeg;
    if (gainCrossings.length > 1) {
      notes.push(
        `The magnitude crosses 0 dB at ${gainCrossings.length} frequencies ` +
          `(${gainCrossings.map((c) => c.w.toPrecision(4)).join(", ")} rad/s), with phase margins of ` +
          `${gainCrossings.map((c) => `${c.marginDeg.toFixed(1)}`).join(", ")} degrees. The figure ` +
          `reported is the SMALLEST, because that is the one that binds. A loop with several ` +
          `crossings is usually resonant, and the comfortable-looking crossings say nothing about ` +
          `its stability.`,
      );
    }
  }
  if (gainCrossoverW === null) {
    notes.push(
      "The magnitude never crosses 0 dB over the swept range, so there is no gain crossover and " +
        "no phase margin to report.",
    );
  }

  if (gainMarginDb !== null && gainMarginDb < 0) {
    notes.push(
      "The gain margin is NEGATIVE, which means the loop is already unstable at this gain — the " +
        "gain must be REDUCED by that many dB to reach the stability boundary, not increased.",
    );
  }
  if (phaseMarginDeg !== null && phaseMarginDeg > 0 && phaseMarginDeg < 30) {
    notes.push(
      `A phase margin of ${phaseMarginDeg.toFixed(1)} degrees is small. Below about 30 degrees the ` +
        "closed loop is very oscillatory and intolerant of any unmodelled lag; 45 to 60 degrees is " +
        "the usual design target.",
    );
  }

  return {
    ok: true,
    gainMarginDb,
    phaseCrossoverW,
    phaseMarginDeg,
    gainCrossoverW,
    gainCrossings,
    phaseCrossings,
    notes,
  };
}

/**
 * The same polynomial in the pane's MATH syntax, so it can be typeset as a real
 * equation rather than printed with carets.
 *
 * The only difference from polyToString is that a fractional coefficient is
 * PARENTHESISED: "1/2s^2" would parse as 1/(2s^2) — a different polynomial that
 * still looks plausible — whereas "(1/2)s^2" is unambiguous. Exactness is kept
 * rather than decimalised, because a coefficient the user typed as 1/2 should
 * come back as 1/2.
 */
export function polyToMath(p: Rat[]): string {
  const t = trimPoly(p);
  const n = t.length - 1;
  const parts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const c = t[i];
    if (ratIsZero(c)) continue;
    const power = n - i;
    const neg = ratSign(c) < 0;
    const mag = neg ? ratNeg(c) : c;
    const isOne = mag.n === 1n && mag.d === 1n;
    const coeff =
      isOne && power > 0 ? "" : mag.d === 1n ? String(mag.n) : `(${mag.n}/${mag.d})`;
    const sPart = power === 0 ? "" : power === 1 ? "s" : `s^${power}`;
    parts.push((parts.length ? (neg ? " - " : " + ") : neg ? "-" : "") + coeff + sPart);
  }
  return parts.length ? parts.join("") : "0";
}

/** Formats a polynomial in s for display, highest power first. */
export function polyToString(p: Rat[]): string {
  const t = trimPoly(p);
  const n = t.length - 1;
  const parts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const c = t[i];
    if (ratIsZero(c)) continue;
    const power = n - i;
    const neg = ratSign(c) < 0;
    const mag = neg ? ratNeg(c) : c;
    const isOne = mag.n === 1n && mag.d === 1n;
    const coeff = isOne && power > 0 ? "" : mag.d === 1n ? String(mag.n) : `${mag.n}/${mag.d}`;
    const sPart = power === 0 ? "" : power === 1 ? "s" : `s^${power}`;
    parts.push((parts.length ? (neg ? " - " : " + ") : neg ? "-" : "") + coeff + sPart);
  }
  return parts.length ? parts.join("") : "0";
}
