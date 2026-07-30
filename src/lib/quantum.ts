// Quantum optics and entanglement — the parts that are exactly computable.
//
// WHAT THIS IS NOT. It is not a quantum simulator, it does not model a source,
// and it does not know anything about a particular crystal or detector. What it
// does is the closed-form entanglement and Bell-test arithmetic that a
// specification or an office action actually turns on: how entangled a two-qubit
// state is, whether a set of measured correlations beats the classical bound,
// and what a measured error rate leaves as a secure key rate.
//
// Every bound here is a theorem, not a fitted constant: the classical CHSH bound
// is 2, the quantum maximum is Tsirelson's 2*sqrt(2), a Werner state is entangled
// above p = 1/3 and violates CHSH only above p = 1/sqrt(2), and the
// Shor-Preskill key rate hits zero at a QBER of about 11%. Those numbers are
// derived below rather than typed, and the tests check them against their own
// definitions.

/** A complex number, carried explicitly because entanglement depends on phase. */
export interface Cx {
  re: number;
  im: number;
}

const cx = (re: number, im = 0): Cx => ({ re, im });
const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);

/** Binary Shannon entropy in bits. h(0) = h(1) = 0 by continuity. */
export function binaryEntropy(p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

export interface TwoQubitResult {
  /** Wootters concurrence, 0 (separable) to 1 (maximally entangled). */
  concurrence: number;
  /** Entanglement entropy of either half, in ebits. */
  entropyEbits: number;
  /** Eigenvalues of the reduced density matrix of one qubit. */
  schmidt: [number, number];
  separable: boolean;
  /** Largest CHSH value this state can produce, by the Horodecki criterion. */
  maxChsh: number;
  notes: string[];
}

/**
 * A pure two-qubit state written as a|00> + b|01> + c|10> + d|11>.
 *
 * CONCURRENCE OF A PURE STATE IS 2|ad - bc| — the modulus of a determinant, which
 * is why the relative PHASE matters and why the amplitudes are complex here. Two
 * states with identical magnitudes and different phases can be maximally
 * entangled and completely separable respectively, so a real-only version of this
 * function would silently answer the wrong question.
 *
 * The state is normalised internally; a zero vector is refused.
 */
export function pureTwoQubit(a: Cx, b: Cx, c: Cx, d: Cx): TwoQubitResult | null {
  for (const z of [a, b, c, d]) {
    if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return null;
  }
  const norm2 = cAbs(a) ** 2 + cAbs(b) ** 2 + cAbs(c) ** 2 + cAbs(d) ** 2;
  if (!(norm2 > 0) || !Number.isFinite(norm2)) return null;
  const s = Math.sqrt(norm2);
  const [A, B, C, D] = [a, b, c, d].map((z) => cx(z.re / s, z.im / s));

  // C = 2|ad - bc|, clamped only against floating-point overshoot past 1.
  const det = cSub(cMul(A, D), cMul(B, C));
  const concurrence = Math.min(1, 2 * cAbs(det));

  // Reduced-density eigenvalues follow from the concurrence for a pure state.
  const root = Math.sqrt(Math.max(0, 1 - concurrence * concurrence));
  const l1 = (1 + root) / 2;
  const l2 = (1 - root) / 2;
  const entropyEbits = binaryEntropy(l1);

  const notes: string[] = [];
  const separable = concurrence < 1e-12;
  if (separable) {
    notes.push(
      "Concurrence is zero: this is a PRODUCT state, not an entangled one. It can be written " +
        "as a state of qubit A times a state of qubit B, and measuring one tells you nothing " +
        "about the other.",
    );
  } else if (Math.abs(concurrence - 1) < 1e-12) {
    notes.push(
      "Concurrence is 1: this is a MAXIMALLY entangled state, equivalent to a Bell state up to " +
        "local unitaries. Its entanglement entropy is exactly 1 ebit.",
    );
  }

  // Horodecki: a pure state of concurrence C reaches S = 2*sqrt(1 + C^2).
  const maxChsh = 2 * Math.sqrt(1 + concurrence * concurrence);
  notes.push(
    `The largest CHSH value this state can produce is 2*sqrt(1 + C^2) = ${maxChsh.toPrecision(6)}, ` +
      "with ideal measurements. Reaching it requires the right measurement angles; a lower " +
      "measured S does not by itself mean the state is less entangled.",
  );

  return { concurrence, entropyEbits, schmidt: [l1, l2], separable, maxChsh, notes };
}

export interface ChshResult {
  s: number;
  /** |S| > 2 rules out local hidden variables. */
  violatesLocalRealism: boolean;
  /** |S| > 2*sqrt(2) is impossible for quantum mechanics too. */
  exceedsTsirelson: boolean;
  classicalBound: number;
  tsirelsonBound: number;
  /** How far past the classical bound, in units of the reported uncertainty. */
  sigmas: number | null;
  notes: string[];
}

/**
 * The CHSH combination S = E(a,b) - E(a,b') + E(a',b) + E(a',b') from four
 * measured correlation values, each in [-1, 1].
 *
 * TWO BOUNDS, AND BOTH MATTER. |S| <= 2 is what local hidden variables allow, so
 * exceeding it is the Bell violation. |S| <= 2*sqrt(2) is Tsirelson's bound, which
 * QUANTUM MECHANICS itself cannot exceed — so a value above it is not a stronger
 * result, it is evidence of an error in the data or the analysis, and it is
 * flagged as such rather than celebrated.
 *
 * `uncertainty` is the standard error on S if known; a violation is only a claim
 * about the world when it is large compared with it.
 */
export function chsh(
  e1: number,
  e2: number,
  e3: number,
  e4: number,
  uncertainty?: number,
): ChshResult | null {
  const es = [e1, e2, e3, e4];
  if (!es.every((e) => Number.isFinite(e))) return null;
  const notes: string[] = [];
  if (es.some((e) => e < -1 || e > 1)) {
    return null; // a correlation coefficient outside [-1, 1] is not a measurement
  }

  const s = e1 - e2 + e3 + e4;
  const classicalBound = 2;
  const tsirelsonBound = 2 * Math.SQRT2;
  const abs = Math.abs(s);

  const violatesLocalRealism = abs > classicalBound;
  const exceedsTsirelson = abs > tsirelsonBound + 1e-12;

  if (exceedsTsirelson) {
    notes.push(
      `|S| = ${abs.toPrecision(6)} exceeds Tsirelson's bound of 2*sqrt(2) = ` +
        `${tsirelsonBound.toPrecision(6)}. No quantum state can do this, so this is not a ` +
        "stronger violation — it indicates a problem with the correlations or with the sign " +
        "convention used to combine them.",
    );
  } else if (violatesLocalRealism) {
    notes.push(
      `|S| = ${abs.toPrecision(6)} > 2, so these correlations cannot be reproduced by any local ` +
        "hidden-variable model. This is a Bell violation.",
    );
  } else {
    notes.push(
      `|S| = ${abs.toPrecision(6)} does not exceed the classical bound of 2, so these ` +
        "correlations ARE reproducible by a local hidden-variable model. That is not evidence " +
        "of no entanglement — the state may be entangled and the measurement settings poorly " +
        "chosen.",
    );
  }

  let sigmas: number | null = null;
  if (uncertainty !== undefined) {
    if (!Number.isFinite(uncertainty) || uncertainty <= 0) return null;
    sigmas = (abs - classicalBound) / uncertainty;
    notes.push(
      `That is ${sigmas.toPrecision(4)} standard errors beyond the classical bound. A violation ` +
        "of a couple of sigma is not a result; the loophole-free experiments report many.",
    );
  }

  notes.push(
    "This arithmetic assumes fair sampling and space-like separated settings. The detection and " +
      "locality loopholes are properties of the APPARATUS, not of these numbers, and closing " +
      "them is what made the 2015 experiments hard.",
  );

  return { s, violatesLocalRealism, exceedsTsirelson, classicalBound, tsirelsonBound, sigmas, notes };
}

export interface WernerResult {
  p: number;
  concurrence: number;
  entangled: boolean;
  violatesChsh: boolean;
  maxChsh: number;
  notes: string[];
}

/**
 * The Werner state: a Bell state mixed with white noise,
 * rho = p |Phi+><Phi+| + (1 - p) I/4.
 *
 * THE TWO THRESHOLDS ARE DIFFERENT, AND THAT IS THE POINT. The state is entangled
 * for p > 1/3, but it violates CHSH only for p > 1/sqrt(2) ~ 0.7071. Between
 * those, the state IS entangled and yet no CHSH test can show it — entanglement
 * and Bell nonlocality are not the same property. A tool that reported only
 * "no violation" would be reporting the absence of a signature, not the absence
 * of entanglement.
 */
export function wernerState(p: number): WernerResult | null {
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  const concurrence = Math.max(0, (3 * p - 1) / 2);
  const entangled = concurrence > 0;
  const maxChsh = 2 * Math.SQRT2 * p;
  const violatesChsh = maxChsh > 2 + 1e-12;
  const notes: string[] = [];

  if (!entangled) {
    notes.push(`p = ${p} is at or below 1/3, so this Werner state is SEPARABLE — the noise has ` + "destroyed the entanglement entirely.");
  } else if (!violatesChsh) {
    notes.push(
      `p = ${p} is above 1/3 so the state IS entangled (concurrence ${concurrence.toPrecision(4)}), ` +
        "but it is at or below 1/sqrt(2) = 0.7071, so it CANNOT violate CHSH. Entanglement and " +
        "Bell nonlocality are different properties, and this is the range that separates them.",
    );
  } else {
    notes.push(
      `p = ${p} exceeds 1/sqrt(2) = 0.7071, so this state both is entangled and can violate ` +
        `CHSH, reaching S = 2*sqrt(2)*p = ${maxChsh.toPrecision(6)}.`,
    );
  }
  return { p, concurrence, entangled, violatesChsh, maxChsh, notes };
}

export interface QkdResult {
  qber: number;
  /** Asymptotic secure fraction per sifted bit; 0 when no key can be distilled. */
  keyRate: number;
  secure: boolean;
  /** QBER above which the rate is zero, ~0.11 for BB84. */
  thresholdQber: number;
  notes: string[];
}

/**
 * BB84 asymptotic secure key rate by the Shor-Preskill bound, r = 1 - 2h(Q).
 *
 * The 11% figure everyone quotes is the root of that expression, not an input:
 * it is where h(Q) = 1/2. It is computed here by bisection on the same formula
 * that produces the rate, so the threshold and the rate cannot disagree.
 *
 * This is the ASYMPTOTIC one-way bound. A real system with finite key length,
 * imperfect sources and two-way post-processing does better or worse, and the
 * number here is a ceiling for comparison rather than a system specification.
 */
export function bb84KeyRate(qber: number): QkdResult | null {
  // Domain is [0, 0.5], NOT [0, 1]. h(Q) is symmetric about 0.5, so 1 - 2h(Q)
  // turns POSITIVE again above Q ~ 0.89 and a 95% error rate was reporting a
  // 0.43 "secure" key rate beside its own 11% threshold. A QBER above one half
  // is not a channel that leaks — it is one whose bits are anticorrelated, and
  // Shor-Preskill says nothing about it.
  if (!Number.isFinite(qber) || qber < 0 || qber > 0.5) return null;

  const rate = (q: number) => 1 - 2 * binaryEntropy(q);
  // Bisect for the root of 1 - 2h(Q) on [0, 0.5], where h is monotone increasing.
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) > 0) lo = mid;
    else hi = mid;
  }
  const thresholdQber = (lo + hi) / 2;

  const keyRate = Math.max(0, rate(qber));
  const secure = keyRate > 0;
  const notes: string[] = [];
  if (!secure) {
    notes.push(
      `A QBER of ${(qber * 100).toPrecision(4)}% is at or above the ${(thresholdQber * 100).toPrecision(4)}% ` +
        "threshold, so NO secure key can be distilled: an eavesdropper could in principle hold " +
        "as much information as the legitimate parties. The rate is zero, not merely small.",
    );
  } else {
    notes.push(
      `${(keyRate * 100).toPrecision(4)}% of each sifted bit survives error correction and ` +
        "privacy amplification, in the asymptotic limit.",
    );
  }
  notes.push(
    "Shor-Preskill is a one-way asymptotic bound. Finite key lengths cost more, and it assumes " +
      "a single-photon source — a weak coherent pulse without decoy states is vulnerable to " +
      "photon-number splitting regardless of what this rate says.",
  );
  return { qber, keyRate, secure, thresholdQber, notes };
}

/** The four Bell states, for use as reference inputs. */
export const BELL_STATES: Record<string, [Cx, Cx, Cx, Cx]> = {
  "Phi+": [cx(Math.SQRT1_2), cx(0), cx(0), cx(Math.SQRT1_2)],
  "Phi-": [cx(Math.SQRT1_2), cx(0), cx(0), cx(-Math.SQRT1_2)],
  "Psi+": [cx(0), cx(Math.SQRT1_2), cx(Math.SQRT1_2), cx(0)],
  "Psi-": [cx(0), cx(Math.SQRT1_2), cx(-Math.SQRT1_2), cx(0)],
};

export { cx };
