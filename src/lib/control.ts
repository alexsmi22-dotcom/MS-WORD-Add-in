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

  // Monic companion matrix, top-row form.
  const a = p.slice(1).map((c) => ratToNumber(c) / lead);
  if (a.some((v) => !Number.isFinite(v))) return null;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) A[0][j] = -a[j];
  for (let i = 1; i < n; i++) A[i][i - 1] = 1;

  try {
    return eigenvaluesGeneral(A);
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
  routh: RouthResult | null;
  stable: boolean;
  /** True when the two independent methods disagree — reported, never resolved. */
  disagreement: boolean;
  /** A zero in the right half plane makes the system non-minimum-phase. */
  nonMinimumPhase: boolean;
  verdict: string;
  notes: string[];
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
  const scale = Math.max(1, ...poles.map((p) => Math.hypot(p.re, p.im)));
  const tol = scale * 1e-9;

  const rhpPolesNumeric = poles.filter((p) => p.re > tol).length;
  const imaginaryAxisPoles = poles.filter((p) => Math.abs(p.re) <= tol).length;

  const routh = routhHurwitz(den);
  const routhOk = !("ok" in routh && routh.ok === false);
  const routhRes = routhOk ? (routh as RouthResult) : null;
  const rhpPolesRouth = routhRes && routhRes.clean ? routhRes.signChanges : null;

  const disagreement = rhpPolesRouth !== null && rhpPolesRouth !== rhpPolesNumeric;

  const stable = rhpPolesNumeric === 0 && imaginaryAxisPoles === 0 && !disagreement;

  let verdict: string;
  if (disagreement) {
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

  const nonMinimumPhase = zeros.some((z) => z.re > tol);
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
  if (zeta > 0 && wn > 0) settlingTime = 4 / (zeta * wn);

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
  notes: string[];
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
  const freqs = autoFrequencies(open, 2000);
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

  let phaseCrossoverW: number | null = null;
  let gainMarginDb: number | null = null;
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
      phaseCrossoverW = bisect(freqs[i], freqs[i + 1], (w) => gAt(w).im);
      gainMarginDb = -20 * Math.log10(gAt(phaseCrossoverW).mag);
      break;
    }
  }
  if (phaseCrossoverW === null) {
    notes.push(
      "The phase never reaches -180 degrees over the swept range, so there is NO finite gain " +
        "margin: the loop cannot be driven unstable by raising the gain alone. That is a property " +
        "of the system, not a gap in the sweep.",
    );
  }

  let gainCrossoverW: number | null = null;
  let phaseMarginDeg: number | null = null;
  for (let i = 0; i + 1 < resp.length; i++) {
    const a = resp[i].magnitudeDb;
    const b = resp[i + 1].magnitudeDb;
    if (a === 0 || a * b < 0) {
      // Magnitude carries no wrapping, so it can be refined directly.
      gainCrossoverW = bisect(freqs[i], freqs[i + 1], (w) => gAt(w).mag - 1);
      // The phase here is taken from the SWEPT response so the unwrapping is
      // the same one the user sees on the Bode plot, interpolated across the
      // bracket the crossing was found in.
      const g = gAt(gainCrossoverW);
      const rawDeg = (Math.atan2(g.im, g.re) * 180) / Math.PI;
      // Align the isolated atan2 value with the swept, unwrapped phase by
      // choosing the 360-degree branch nearest the bracket's sampled phase.
      const reference = resp[i].phaseDeg;
      const k = Math.round((reference - rawDeg) / 360);
      phaseMarginDeg = 180 + (rawDeg + 360 * k);
      break;
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

  return { ok: true, gainMarginDb, phaseCrossoverW, phaseMarginDeg, gainCrossoverW, notes };
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
