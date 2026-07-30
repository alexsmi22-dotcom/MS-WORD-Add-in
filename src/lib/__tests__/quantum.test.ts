// Quantum/entanglement tests. Every threshold is checked against its DEFINITION
// rather than against a remembered decimal: Tsirelson from 2*sqrt(2), the Werner
// separability point from where the concurrence formula crosses zero, and the
// BB84 threshold from where the binary entropy equals one half.

import {
  pureTwoQubit,
  chsh,
  wernerState,
  bb84KeyRate,
  binaryEntropy,
  BELL_STATES,
  cx,
} from "../quantum";

describe("two-qubit pure states", () => {
  test("every Bell state is maximally entangled: C = 1, E = 1 ebit", () => {
    for (const [name, amps] of Object.entries(BELL_STATES)) {
      const r = pureTwoQubit(...amps)!;
      expect(r.concurrence).toBeCloseTo(1, 12);
      expect(r.entropyEbits).toBeCloseTo(1, 12);
      expect(r.schmidt[0]).toBeCloseTo(0.5, 12);
      expect(r.separable).toBe(false);
      expect(name).toBeTruthy();
    }
  });

  test("a product state has zero entanglement", () => {
    const r = pureTwoQubit(cx(1), cx(0), cx(0), cx(0))!;
    expect(r.concurrence).toBeCloseTo(0, 15);
    expect(r.entropyEbits).toBeCloseTo(0, 15);
    expect(r.separable).toBe(true);
    expect(r.notes.join(" ")).toMatch(/PRODUCT state/);
  });

  test("a factorisable superposition is still separable — the case that looks entangled", () => {
    // (|0>+|1>)/sqrt2 (x) (|0>+|1>)/sqrt2 = (|00>+|01>+|10>+|11>)/2. All four
    // amplitudes are equal and non-zero, yet ad - bc = 1/4 - 1/4 = 0.
    const h = cx(0.5);
    const r = pureTwoQubit(h, h, h, h)!;
    expect(r.concurrence).toBeCloseTo(0, 12);
    expect(r.separable).toBe(true);
  });

  test("PHASE alone decides it — same magnitudes, opposite answers", () => {
    // (|00> + |01> + |10> + |11>)/2 is separable; flipping the sign of |11> is not.
    const sep = pureTwoQubit(cx(0.5), cx(0.5), cx(0.5), cx(0.5))!;
    const ent = pureTwoQubit(cx(0.5), cx(0.5), cx(0.5), cx(-0.5))!;
    expect(sep.concurrence).toBeCloseTo(0, 12);
    expect(ent.concurrence).toBeCloseTo(1, 12);
    // An imaginary phase does the same, which a real-only implementation would miss.
    const imag = pureTwoQubit(cx(0.5), cx(0.5), cx(0.5), cx(0, 0.5))!;
    expect(imag.concurrence).toBeGreaterThan(0.5);
  });

  test("partially entangled state matches the closed form", () => {
    // cos(t)|00> + sin(t)|11> has C = 2 sin t cos t = sin 2t.
    const t = Math.PI / 8;
    const r = pureTwoQubit(cx(Math.cos(t)), cx(0), cx(0), cx(Math.sin(t)))!;
    expect(r.concurrence).toBeCloseTo(Math.sin(2 * t), 12);
    // Schmidt eigenvalues are cos^2 t and sin^2 t.
    expect(r.schmidt[0]).toBeCloseTo(Math.cos(t) ** 2, 12);
    expect(r.entropyEbits).toBeCloseTo(binaryEntropy(Math.cos(t) ** 2), 12);
  });

  test("unnormalised input is normalised rather than rejected", () => {
    const r = pureTwoQubit(cx(5), cx(0), cx(0), cx(5))!;
    expect(r.concurrence).toBeCloseTo(1, 12);
  });

  test("the zero vector and non-finite amplitudes are refused", () => {
    expect(pureTwoQubit(cx(0), cx(0), cx(0), cx(0))).toBeNull();
    expect(pureTwoQubit(cx(NaN), cx(0), cx(0), cx(1))).toBeNull();
    expect(pureTwoQubit(cx(Infinity), cx(0), cx(0), cx(1))).toBeNull();
  });

  test("max CHSH follows Horodecki 2*sqrt(1+C^2) and respects Tsirelson", () => {
    const bell = pureTwoQubit(...BELL_STATES["Phi+"])!;
    expect(bell.maxChsh).toBeCloseTo(2 * Math.SQRT2, 12);
    const prod = pureTwoQubit(cx(1), cx(0), cx(0), cx(0))!;
    expect(prod.maxChsh).toBeCloseTo(2, 12);
  });
});

describe("CHSH", () => {
  test("the ideal quantum value is Tsirelson's bound", () => {
    // The textbook optimal settings give each |E| = 1/sqrt2.
    const e = Math.SQRT1_2;
    const r = chsh(e, -e, e, e)!;
    expect(r.s).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(r.violatesLocalRealism).toBe(true);
    expect(r.exceedsTsirelson).toBe(false);
    expect(r.notes.join(" ")).toMatch(/Bell violation/);
  });

  test("classical correlations do not violate, and are not called entangled", () => {
    const r = chsh(0.5, 0.5, 0.5, 0.5)!;
    expect(r.s).toBeCloseTo(1, 12);
    expect(r.violatesLocalRealism).toBe(false);
    expect(r.notes.join(" ")).toMatch(/not evidence of no entanglement/i);
  });

  test("exactly at the classical bound is NOT a violation", () => {
    const r = chsh(1, -1, 0, 0)!;
    expect(r.s).toBeCloseTo(2, 12);
    expect(r.violatesLocalRealism).toBe(false);
  });

  test("beyond Tsirelson is flagged as an error, not a better result", () => {
    const r = chsh(1, -1, 1, 1)!; // S = 4, the algebraic maximum
    expect(r.s).toBeCloseTo(4, 12);
    expect(r.exceedsTsirelson).toBe(true);
    expect(r.notes.join(" ")).toMatch(/No quantum state can do this/);
  });

  test("significance is reported against the classical bound", () => {
    const e = Math.SQRT1_2;
    const r = chsh(e, -e, e, e, 0.01)!;
    expect(r.sigmas!).toBeCloseTo((2 * Math.SQRT2 - 2) / 0.01, 9);
  });

  test("correlations outside [-1, 1] are not measurements and are refused", () => {
    expect(chsh(1.5, 0, 0, 0)).toBeNull();
    expect(chsh(0, 0, 0, -2)).toBeNull();
    expect(chsh(NaN, 0, 0, 0)).toBeNull();
    expect(chsh(0.5, 0.5, 0.5, 0.5, 0)).toBeNull();
  });
});

describe("Werner states — entanglement and nonlocality are different", () => {
  test("separability threshold is exactly p = 1/3", () => {
    expect(wernerState(1 / 3)!.entangled).toBe(false);
    expect(wernerState(1 / 3)!.concurrence).toBeCloseTo(0, 12);
    expect(wernerState(0.34)!.entangled).toBe(true);
    expect(wernerState(0)!.concurrence).toBe(0);
    expect(wernerState(1)!.concurrence).toBeCloseTo(1, 12);
  });

  test("the gap: entangled but provably unable to violate CHSH", () => {
    const w = wernerState(0.6)!;
    expect(w.entangled).toBe(true);
    expect(w.violatesChsh).toBe(false);
    expect(w.notes.join(" ")).toMatch(/different properties/);
  });

  test("CHSH violation threshold is p = 1/sqrt(2)", () => {
    expect(wernerState(Math.SQRT1_2)!.violatesChsh).toBe(false); // exactly at S = 2
    expect(wernerState(0.72)!.violatesChsh).toBe(true);
    expect(wernerState(1)!.maxChsh).toBeCloseTo(2 * Math.SQRT2, 12);
  });

  test("p outside [0,1] is refused", () => {
    expect(wernerState(-0.1)).toBeNull();
    expect(wernerState(1.1)).toBeNull();
    expect(wernerState(NaN)).toBeNull();
  });
});

describe("BB84 key rate", () => {
  test("the 11% threshold is derived, and the rate is zero at it", () => {
    const r = bb84KeyRate(0)!;
    expect(r.thresholdQber).toBeCloseTo(0.1100, 3);
    // At the threshold the binary entropy is exactly 1/2, by definition of the root.
    expect(binaryEntropy(r.thresholdQber)).toBeCloseTo(0.5, 9);
    expect(bb84KeyRate(r.thresholdQber + 1e-6)!.keyRate).toBe(0);
    expect(bb84KeyRate(r.thresholdQber + 1e-6)!.secure).toBe(false);
  });

  test("a perfect channel yields one bit per sifted bit", () => {
    const r = bb84KeyRate(0)!;
    expect(r.keyRate).toBeCloseTo(1, 12);
    expect(r.secure).toBe(true);
  });

  test("a typical 2% QBER matches 1 - 2h(0.02)", () => {
    const r = bb84KeyRate(0.02)!;
    expect(r.keyRate).toBeCloseTo(1 - 2 * binaryEntropy(0.02), 12);
    expect(r.keyRate).toBeCloseTo(0.7176, 3);
  });

  test("the rate is clamped at zero rather than going negative", () => {
    expect(bb84KeyRate(0.25)!.keyRate).toBe(0);
    expect(bb84KeyRate(0.5)!.keyRate).toBe(0);
    expect(bb84KeyRate(0.3)!.notes.join(" ")).toMatch(/NO secure key/);
  });

  test("out-of-range QBER is refused", () => {
    expect(bb84KeyRate(-0.01)).toBeNull();
    expect(bb84KeyRate(1.5)).toBeNull();
    expect(bb84KeyRate(NaN)).toBeNull();
  });

  test("the domain stops at one half — h(Q) is symmetric and the rate turns positive again", () => {
    // Found by an independent review. The guard was qber > 1, so 1 - 2h(Q)
    // recovered above Q ~ 0.89: a 95% error rate reported a 0.4272 SECURE key
    // rate while the same object reported its own 11% threshold.
    for (const q of [0.6, 0.89, 0.9, 0.95, 1]) {
      expect({ q, r: bb84KeyRate(q) }).toEqual({ q, r: null });
    }
    // The boundary itself is still a legitimate (zero-rate) answer.
    expect(bb84KeyRate(0.5)!.keyRate).toBe(0);
    expect(bb84KeyRate(0.5)!.secure).toBe(false);
  });
});

describe("binary entropy", () => {
  test("endpoints are zero by continuity and the peak is 1 bit at one half", () => {
    expect(binaryEntropy(0)).toBe(0);
    expect(binaryEntropy(1)).toBe(0);
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 15);
    expect(binaryEntropy(0.11)).toBeCloseTo(0.4999, 3);
  });

  test("it is symmetric about one half", () => {
    for (const p of [0.1, 0.25, 0.4]) {
      expect(binaryEntropy(p)).toBeCloseTo(binaryEntropy(1 - p), 15);
    }
  });
});
