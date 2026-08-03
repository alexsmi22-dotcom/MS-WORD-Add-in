// Thermal breadth: the rating problem, fins, transients and radiation.
//
// Each engine is checked against a CLOSED FORM rather than against itself, and
// the removable singularities (Cr = 1, Cr = 0, mL = 0, equal temperatures) get
// their own cases because those are the ones an ordinary design lands on.

import {
  effectivenessNtu,
  finPerformance,
  lumpedCapacitance,
  radiationExchange,
  SIGMA_SB,
  NtuFlow,
} from "../heat2";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("effectiveness-NTU", () => {
  const base = { cHot: 1000, cCold: 1000, thIn: 100, tcIn: 20, U: 100, A: 20 };

  it("BALANCED COUNTERFLOW IS A REMOVABLE SINGULARITY, not NaN", () => {
    // Cr = 1 makes the standard relation 0/0, and its limit is NTU/(1+NTU).
    // A balanced exchanger is an entirely ordinary design.
    const r = ok(effectivenessNtu({ ...base, flow: "counter" }));
    expect(r.cr).toBeCloseTo(1, 12);
    expect(r.ntu).toBeCloseTo(2, 12);
    expect(r.effectiveness).toBeCloseTo(2 / 3, 10);
  });

  it("Cr -> 0 IS A PHASE CHANGE, and every arrangement agrees there", () => {
    // A boiling or condensing stream holds its temperature, so its capacity
    // rate is effectively infinite.
    const eps: number[] = [];
    for (const flow of ["counter", "parallel", "crossboth", "shell"] as NtuFlow[]) {
      const r = ok(effectivenessNtu({ ...base, flow, cHot: 1e9, cCold: 1000, U: 100, A: 20 }));
      eps.push(r.effectiveness);
    }
    // cHot is large but finite, so Cr is 1e-6 rather than 0 - close, not exact.
    for (const e of eps) expect(e).toBeCloseTo(1 - Math.exp(-2), 5);
  });

  it("PARALLEL FLOW HAS A CEILING AND COUNTERFLOW DOES NOT", () => {
    // The entire argument for counterflow, in two numbers.
    const par = ok(effectivenessNtu({ ...base, flow: "parallel", A: 1e6 }));
    const cnt = ok(effectivenessNtu({ ...base, flow: "counter", A: 1e6 }));
    expect(par.effectiveness).toBeCloseTo(0.5, 6); // 1/(1+Cr) at Cr = 1
    expect(cnt.effectiveness).toBeCloseTo(1, 4);
  });

  it("conserves energy: what the hot stream loses, the cold stream gains", () => {
    for (const flow of ["counter", "parallel", "crossboth", "shell"] as NtuFlow[]) {
      const r = ok(effectivenessNtu({ flow, cHot: 2000, cCold: 1500, thIn: 150, tcIn: 30, U: 250, A: 12 }));
      expect(2000 * (150 - r.thOut)).toBeCloseTo(r.Q, 6);
      expect(1500 * (r.tcOut - 30)).toBeCloseTo(r.Q, 6);
    }
  });

  it("never exceeds the thermodynamic maximum", () => {
    for (const A of [0.1, 1, 12, 100, 1e5]) {
      const r = ok(effectivenessNtu({ ...base, flow: "counter", A }));
      expect(r.effectiveness).toBeGreaterThan(0);
      expect(r.effectiveness).toBeLessThanOrEqual(1 + 1e-12);
      expect(r.Q).toBeLessThanOrEqual(r.qMax + 1e-9);
      // No outlet may cross its opposite inlet.
      expect(r.thOut).toBeGreaterThanOrEqual(base.tcIn - 1e-9);
      expect(r.tcOut).toBeLessThanOrEqual(base.thIn + 1e-9);
    }
  });

  it("COUNTERFLOW BEATS PARALLEL AT EVERY AREA", () => {
    for (const A of [1, 5, 20, 100]) {
      const c = ok(effectivenessNtu({ ...base, flow: "counter", A }));
      const p = ok(effectivenessNtu({ ...base, flow: "parallel", A }));
      expect(c.effectiveness).toBeGreaterThan(p.effectiveness);
    }
  });

  it("says the return on area collapses past about NTU 3", () => {
    const big = ok(effectivenessNtu({ ...base, flow: "counter", A: 100 }));
    expect(big.notes.join(" ")).toMatch(/DOUBLING THE AREA/);
  });

  it("refuses a hot inlet that is not hotter", () => {
    expect(effectivenessNtu({ ...base, flow: "counter", thIn: 20, tcIn: 100 }).ok).toBe(false);
    expect(effectivenessNtu({ ...base, flow: "counter", cHot: 0 }).ok).toBe(false);
    expect(effectivenessNtu({ ...base, flow: "counter", A: 0 }).ok).toBe(false);
  });
});

describe("fins", () => {
  it("efficiency is tanh(mLc)/mLc", () => {
    const r = ok(finPerformance({ h: 40, k: 200, L: 0.05, t: 0.003, width: 1, excessK: 60 }));
    expect(r.efficiency).toBeCloseTo(Math.tanh(r.mLc) / r.mLc, 12);
    // m = sqrt(hP/(kA)) with P = 2(w+t), A = w*t.
    const P = 2 * (1 + 0.003);
    const Ac = 1 * 0.003;
    expect(r.m).toBeCloseTo(Math.sqrt((40 * P) / (200 * Ac)), 10);
  });

  it("A PERFECT CONDUCTOR HAS EFFICIENCY 1 — the mL -> 0 limit", () => {
    const r = ok(finPerformance({ h: 1e-9, k: 1e6, L: 0.001, t: 0.01, width: 1, excessK: 10 }));
    expect(r.efficiency).toBeCloseTo(1, 8);
  });

  it("A FIN CAN MAKE THINGS WORSE, and says so", () => {
    // High h, poor conductivity, short and stubby: the conduction resistance
    // the fin adds beats the area it adds.
    const r = ok(finPerformance({ h: 5000, k: 15, L: 0.01, t: 0.01, width: 1, excessK: 60 }));
    expect(r.effectiveness).toBeLessThan(1);
    expect(r.notes.join(" ")).toMatch(/BELOW 1/);
  });

  it("and a good fin is worth many times the bare surface", () => {
    const r = ok(finPerformance({ h: 40, k: 200, L: 0.05, t: 0.003, width: 1, excessK: 60 }));
    expect(r.effectiveness).toBeGreaterThan(10);
    expect(r.notes.join(" ")).toMatch(/fins pay when h is LOW/i);
  });

  it("efficiency falls as the fin gets longer, and the tip stops earning", () => {
    let prev = 1.1;
    for (const L of [0.01, 0.05, 0.2, 0.5]) {
      const r = ok(finPerformance({ h: 40, k: 200, L, t: 0.003, width: 1, excessK: 60 }));
      expect(r.efficiency).toBeLessThan(prev);
      prev = r.efficiency;
    }
    const long = ok(finPerformance({ h: 40, k: 200, L: 0.5, t: 0.003, width: 1, excessK: 60 }));
    expect(long.notes.join(" ")).toMatch(/LONGER ADDS WEIGHT AND NO HEAT/);
  });

  it("the corrected length adds half the thickness, as the tip correction requires", () => {
    const r = ok(finPerformance({ h: 40, k: 200, L: 0.05, t: 0.004, width: 1, excessK: 60 }));
    expect(r.lCorrected).toBeCloseTo(0.052, 12);
  });

  it("refuses non-positive geometry", () => {
    expect(finPerformance({ h: 0, k: 200, L: 0.05, t: 0.003, width: 1, excessK: 60 }).ok).toBe(false);
    expect(finPerformance({ h: 40, k: 200, L: 0.05, t: 0, width: 1, excessK: 60 }).ok).toBe(false);
  });
});

describe("lumped capacitance", () => {
  const base = { h: 20, k: 200, rho: 2700, cp: 900, volume: 1e-4, area: 0.06, tInit: 200, tAmbient: 25, timeS: 600 };

  it("REFUSES ABOVE Biot 0.1 rather than returning a plausible wrong curve", () => {
    const r = lumpedCapacitance({ ...base, h: 5000, k: 1, volume: 1e-3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Biot/);
      expect(r.error).toMatch(/right SHAPE of answer, not merely an imprecise one/);
    }
  });

  it("follows the exponential exactly, and one time constant is 63% of the way", () => {
    const r = ok(lumpedCapacitance(base));
    expect(r.tau).toBeCloseTo((2700 * 1e-4 * 900) / (20 * 0.06), 9);
    const atTau = ok(lumpedCapacitance({ ...base, timeS: r.tau }));
    expect(atTau.fractionRemaining).toBeCloseTo(Math.exp(-1), 10);
    expect((atTau.temperature - 25) / (200 - 25)).toBeCloseTo(Math.exp(-1), 10);
  });

  it("the Biot number is h·(V/A)/k", () => {
    const r = ok(lumpedCapacitance(base));
    expect(r.lc).toBeCloseTo(1e-4 / 0.06, 12);
    expect(r.biot).toBeCloseTo((20 * (1e-4 / 0.06)) / 200, 12);
  });

  it("approaches ambient and never crosses it", () => {
    const r = ok(lumpedCapacitance({ ...base, timeS: 1e5 }));
    // At 500 time constants the exponential underflows to exactly zero, so the
    // body reaches ambient rather than merely approaching it. That is the
    // arithmetic being right, not the physics being wrong.
    expect(r.temperature).toBeGreaterThanOrEqual(25);
    expect(r.temperature).toBeCloseTo(25, 6);
    for (const c of r.curve) expect(c.T).toBeGreaterThanOrEqual(25 - 1e-9);
  });

  it("HEATING WORKS TOO — the same exponential with the sign reversed", () => {
    const r = ok(lumpedCapacitance({ ...base, tInit: 20, tAmbient: 200 }));
    expect(r.temperature).toBeGreaterThan(20);
    expect(r.temperature).toBeLessThan(200);
    for (const c of r.curve) expect(c.T).toBeLessThanOrEqual(200 + 1e-9);
  });

  it("energy removed is m·cp·ΔT", () => {
    const r = ok(lumpedCapacitance(base));
    expect(r.energyJ).toBeCloseTo(2700 * 1e-4 * 900 * (200 - r.temperature), 6);
  });

  it("refuses non-positive properties and a negative time", () => {
    expect(lumpedCapacitance({ ...base, rho: 0 }).ok).toBe(false);
    expect(lumpedCapacitance({ ...base, timeS: -1 }).ok).toBe(false);
  });
});

describe("radiation exchange", () => {
  it("a small object in large surroundings uses only its OWN emissivity", () => {
    const r = ok(radiationExchange({ geometry: "large", t1C: 526.85, t2C: 26.85, eps1: 0.8, eps2: 0.2, area: 1 }));
    expect(r.factor).toBeCloseTo(0.8, 12);
    expect(r.Q).toBeCloseTo(0.8 * SIGMA_SB * (800 ** 4 - 300 ** 4), 4);
    // The surroundings' emissivity must not matter here.
    const other = ok(radiationExchange({ geometry: "large", t1C: 526.85, t2C: 26.85, eps1: 0.8, eps2: 0.9, area: 1 }));
    expect(other.Q).toBeCloseTo(r.Q, 9);
  });

  it("two parallel surfaces need BOTH emissivities, and the result beats neither", () => {
    const r = ok(radiationExchange({ geometry: "parallel", t1C: 527, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1 }));
    expect(r.factor).toBeCloseTo(1 / (1 / 0.8 + 1 / 0.8 - 1), 12);
    expect(r.factor).toBeLessThan(0.8);
  });

  it("N EQUAL SHIELDS CUT THE EXCHANGE BY N+1, and they are thin", () => {
    const none = ok(radiationExchange({ geometry: "shields", t1C: 527, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1, shields: 0, epsShield: 0.8 }));
    for (const n of [1, 2, 5]) {
      const s = ok(radiationExchange({ geometry: "shields", t1C: 527, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1, shields: n, epsShield: 0.8 }));
      expect(none.Q / s.Q).toBeCloseTo(n + 1, 6);
    }
  });

  it("a LOW-emissivity shield does far better than that", () => {
    const plain = ok(radiationExchange({ geometry: "shields", t1C: 527, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1, shields: 1, epsShield: 0.8 }));
    const shiny = ok(radiationExchange({ geometry: "shields", t1C: 527, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1, shields: 1, epsShield: 0.05 }));
    expect(shiny.Q).toBeLessThan(plain.Q / 10);
  });

  it("USES ABSOLUTE TEMPERATURE — Celsius would be wrong by orders of magnitude", () => {
    const r = ok(radiationExchange({ geometry: "large", t1C: 100, t2C: 20, eps1: 1, eps2: 1, area: 1 }));
    expect(r.Q).toBeCloseTo(SIGMA_SB * (373.15 ** 4 - 293.15 ** 4), 6);
    // The naive Celsius version would give a wildly different number.
    expect(r.Q).not.toBeCloseTo(SIGMA_SB * (100 ** 4 - 20 ** 4), 0);
    expect(r.notes.join(" ")).toMatch(/converted to absolute/);
  });

  it("equal temperatures give zero net exchange and a finite equivalent h", () => {
    const r = ok(radiationExchange({ geometry: "parallel", t1C: 200, t2C: 200, eps1: 0.9, eps2: 0.9, area: 2 }));
    expect(r.Q).toBeCloseTo(0, 9);
    expect(Number.isFinite(r.hRadiation)).toBe(true);
    expect(r.hRadiation).toBeGreaterThan(0);
  });

  it("the direction reverses when the second surface is hotter", () => {
    const r = ok(radiationExchange({ geometry: "large", t1C: 27, t2C: 527, eps1: 0.8, eps2: 1, area: 1 }));
    expect(r.Q).toBeLessThan(0);
  });

  it("refuses an emissivity outside (0, 1] and a sub-absolute-zero temperature", () => {
    expect(radiationExchange({ geometry: "large", t1C: 100, t2C: 20, eps1: 0, eps2: 1, area: 1 }).ok).toBe(false);
    expect(radiationExchange({ geometry: "large", t1C: 100, t2C: 20, eps1: 1.2, eps2: 1, area: 1 }).ok).toBe(false);
    expect(radiationExchange({ geometry: "large", t1C: -300, t2C: 20, eps1: 1, eps2: 1, area: 1 }).ok).toBe(false);
  });

  it("says emissivity is a measured input, not a prediction", () => {
    const r = ok(radiationExchange({ geometry: "large", t1C: 500, t2C: 20, eps1: 0.8, eps2: 1, area: 1 }));
    expect(r.notes.join(" ")).toMatch(/YOUR MEASURED INPUT/);
  });
});
