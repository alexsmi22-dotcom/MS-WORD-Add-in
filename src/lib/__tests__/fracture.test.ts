// Linear elastic fracture mechanics — the damage-tolerance half of fatigue.
//
// Every result is pinned to a closed form, and the three gates that decide
// whether the mathematics APPLIES at all get their own cases: the plastic zone
// must stay small, the section must be thick enough for plane strain, and the
// crack must be above the growth threshold.

import { stressIntensity, parisGrowth, fractureTransition } from "../fracture";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("stress intensity and the critical crack", () => {
  const base = { stress: 200e6, crack: 0.003, Y: 1.12, kic: 50e6 };

  it("K = Y·σ·√(πa), exactly", () => {
    const r = ok(stressIntensity(base));
    expect(r.K).toBeCloseTo(1.12 * 200e6 * Math.sqrt(Math.PI * 0.003), 4);
    expect(r.ratio).toBeCloseTo(r.K / 50e6, 12);
  });

  it("the critical crack and critical stress are each other's inverse", () => {
    const r = ok(stressIntensity(base));
    // At the critical crack, this stress gives exactly K_IC.
    const atCritical = ok(stressIntensity({ ...base, crack: r.criticalCrack }));
    expect(atCritical.K).toBeCloseTo(50e6, 3);
    // At the critical stress, this crack gives exactly K_IC.
    const atStress = ok(stressIntensity({ ...base, stress: r.criticalStress }));
    expect(atStress.K).toBeCloseTo(50e6, 3);
  });

  it("FRACTURE IS A THRESHOLD — K rises only as the SQUARE ROOT of crack length", () => {
    // Quadrupling the crack merely doubles K. That is why a flaw can sit safely
    // for a long time and then become critical over a small further growth.
    const a = ok(stressIntensity(base));
    const b = ok(stressIntensity({ ...base, crack: 0.012 }));
    expect(b.K / a.K).toBeCloseTo(2, 9);
  });

  it("reports fracture when K reaches toughness, and not before", () => {
    expect(ok(stressIntensity(base)).fractures).toBe(false);
    const gone = ok(stressIntensity({ ...base, stress: 600e6 }));
    expect(gone.fractures).toBe(true);
    expect(gone.notes.join(" ")).toMatch(/AT OR ABOVE 1/);
  });

  it("A THIN SECTION IS FLAGGED AS CONSERVATIVE, because thin is tougher", () => {
    const thin = ok(stressIntensity({ ...base, yieldStrength: 500e6, thickness: 0.005 }));
    expect(thin.planeStrainValid).toBe(false);
    expect(thin.thicknessRequired).toBeCloseTo(2.5 * (50e6 / 500e6) ** 2, 9);
    expect(thin.notes.join(" ")).toMatch(/THIN PLATE IS TOUGHER/);
  });

  it("and a thick one is not", () => {
    const thick = ok(stressIntensity({ ...base, yieldStrength: 500e6, thickness: 0.05 }));
    expect(thick.planeStrainValid).toBe(true);
    expect(thick.notes.join(" ")).toMatch(/thick enough for plane strain/);
  });

  it("REFUSES when the plastic zone is not small — LEFM does not apply there", () => {
    // A tough, low-yield material with a tiny crack: the tip yields over a
    // region comparable to the crack itself, so every formula here is invalid.
    const r = stressIntensity({ stress: 400e6, crack: 0.0002, Y: 1.12, kic: 200e6, yieldStrength: 250e6 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/plastic zone/);
      expect(r.error).toMatch(/J-integral or CTOD/);
    }
  });

  it("refuses a compressive or zero stress, which does not open a crack", () => {
    expect(stressIntensity({ ...base, stress: -100e6 }).ok).toBe(false);
    expect(stressIntensity({ ...base, stress: 0 }).ok).toBe(false);
  });

  it("says Y is the user's input and depends on geometry", () => {
    expect(ok(stressIntensity(base)).notes.join(" ")).toMatch(/Y is YOUR input/);
  });
});

describe("Paris-law crack growth", () => {
  const base = { initialCrack: 0.002, stressRange: 150e6, Y: 1.12, C: 6.9e-12, m: 3, kic: 50e6 };

  it("matches the closed-form integral, in the units C is published in", () => {
    const r = ok(parisGrowth(base));
    // The integral with delta-K in MPa*sqrt(m), which is how every source
    // quotes C. Using pascals here would be wrong by 10^18 at m = 3.
    const B = 6.9e-12 * Math.pow(1.12 * 150 * Math.sqrt(Math.PI), 3);
    const p = 1 - 3 / 2;
    const oracle = (Math.pow(r.finalCrack, p) - Math.pow(0.002, p)) / (B * p);
    expect(r.cycles).toBeCloseTo(oracle, 0);
  });

  it("GIVES AN ENGINEERING ANSWER, not one off by eighteen orders", () => {
    // The unit trap this module documents: a 2 mm crack in steel at 150 MPa is
    // a life of order 10^5 cycles. The first draft reported 1.8e-13.
    const r = ok(parisGrowth(base));
    expect(r.cycles).toBeGreaterThan(1e4);
    expect(r.cycles).toBeLessThan(1e7);
  });

  it("MOST OF THE LIFE IS SPENT WHILE THE CRACK IS SMALL", () => {
    const r = ok(parisGrowth(base));
    // The first doubling of a 2 mm crack takes a large share of the whole life,
    // while the growth rate at the end is far higher than at the start.
    expect(r.firstDoublingFraction).toBeGreaterThan(0.3);
    expect(r.rateFinal / r.rateInitial).toBeGreaterThan(10);
    expect(r.notes.join(" ")).toMatch(/inspection interval set from the TOTAL life is worthless/);
  });

  it("m = 2 IS A LOGARITHM, not a division by zero", () => {
    const r = ok(parisGrowth({ ...base, m: 2, C: 1e-11 }));
    const B = 1e-11 * Math.pow(1.12 * 150 * Math.sqrt(Math.PI), 2);
    expect(r.cycles).toBeCloseTo(Math.log(r.finalCrack / 0.002) / B, 3);
    expect(Number.isFinite(r.cycles)).toBe(true);
  });

  it("a bigger stress range gives a shorter life, steeply", () => {
    let prev = Infinity;
    for (const s of [100e6, 150e6, 200e6, 300e6]) {
      const r = ok(parisGrowth({ ...base, stressRange: s }));
      expect(r.cycles).toBeLessThan(prev);
      prev = r.cycles;
    }
  });

  it("REFUSES below the growth threshold — that is an answer, not a failure", () => {
    const r = parisGrowth({ ...base, initialCrack: 0.0001, stressRange: 20e6, deltaKth: 5e6 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/BELOW the threshold/);
      expect(r.error).toMatch(/damage-tolerant design/);
    }
  });

  it("refuses a crack already past critical", () => {
    const r = parisGrowth({ ...base, initialCrack: 0.05 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ALREADY at or past the critical size/);
  });

  it("the growth curve starts and ends where it says", () => {
    const r = ok(parisGrowth(base));
    expect(r.curve[0].a).toBeCloseTo(0.002, 9);
    expect(r.curve[r.curve.length - 1].a).toBeCloseTo(r.finalCrack, 6);
    expect(r.curve[r.curve.length - 1].n).toBeCloseTo(r.cycles, 6);
    // Monotone: a crack does not shrink.
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i].a).toBeGreaterThanOrEqual(r.curve[i - 1].a - 1e-15);
    }
  });

  it("states the constant-Y limit and the units C is quoted in", () => {
    const notes = ok(parisGrowth(base)).notes.join(" ");
    expect(notes).toMatch(/Y is treated as CONSTANT/);
    expect(notes).toMatch(/C IS QUOTED FOR ΔK IN MPa√m/);
  });

  it("refuses an absurd exponent", () => {
    expect(parisGrowth({ ...base, m: 20 }).ok).toBe(false);
  });
});

describe("the yielding / fracture transition", () => {
  const base = { kic: 50e6, yieldStrength: 500e6, Y: 1.12 };

  it("the transition crack is (1/π)(K_IC/(Y·σy))²", () => {
    const r = ok(fractureTransition(base));
    expect(r.transitionCrack).toBeCloseTo((1 / Math.PI) * (50e6 / (1.12 * 500e6)) ** 2, 12);
  });

  it("A TOUGHER MATERIAL TOLERATES A BIGGER CRACK before fracture governs", () => {
    // That is what toughness buys - not immunity from cracking.
    const plain = ok(fractureTransition(base));
    const tough = ok(fractureTransition({ ...base, kic: 150e6 }));
    expect(tough.transitionCrack).toBeGreaterThan(plain.transitionCrack * 8);
    expect(plain.notes.join(" ")).toMatch(/A tough material has a LARGE transition size/);
  });

  it("names which mechanism governs on each side of it", () => {
    const r = ok(fractureTransition(base));
    const small = ok(fractureTransition({ ...base, crack: r.transitionCrack / 4 }));
    const big = ok(fractureTransition({ ...base, crack: r.transitionCrack * 4 }));
    expect(small.governs).toBe("yielding");
    expect(big.governs).toBe("fracture");
    expect(big.notes.join(" ")).toMatch(/without any warning deformation/);
  });

  it("without a crack it reports the size and nothing about a case", () => {
    const r = ok(fractureTransition(base));
    expect(r.governs).toBe("neither given");
    expect(r.fractureStress).toBeNull();
  });

  it("the fracture stress at the transition size IS the yield strength", () => {
    const r = ok(fractureTransition(base));
    const at = ok(fractureTransition({ ...base, crack: r.transitionCrack }));
    expect(at.fractureStress).toBeCloseTo(500e6, 2);
  });

  it("refuses non-positive inputs", () => {
    expect(fractureTransition({ ...base, kic: 0 }).ok).toBe(false);
    expect(fractureTransition({ ...base, crack: -1 }).ok).toBe(false);
  });
});
