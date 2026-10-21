// Electrochemistry: Nernst against the textbook 59.16 mV per decade, Butler–Volmer limits, and a Tafel fit that
// recovers the transfer coefficients and exchange current density it was built from.
import { butlerVolmer, butlerVolmerCurve, nernst, tafelFit, thermalVoltage } from "../electrochem";

describe("nernst", () => {
  test("RT/F at 25 °C is 25.693 mV, and the slope 59.16 mV per decade for one electron", () => {
    expect(thermalVoltage(25) * 1000).toBeCloseTo(25.6926, 3);
    const r = nernst(0, 1, 25, [{ a: 1, nu: 1 }], [{ a: 10, nu: 1 }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.slopePerDecade * 1000).toBeCloseTo(59.159, 2);
    expect(r.E * 1000).toBeCloseTo(59.159, 2);
  });
  test("Cu²⁺ + 2e⁻ → Cu at a(Cu²⁺) = 0.01: E = 0.340 − (RT/2F)·ln 100", () => {
    const r = nernst(0.34, 2, 25, [], [{ a: 0.01, nu: 1 }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.E).toBeCloseTo(0.34 - (thermalVoltage(25) / 2) * Math.log(100), 12);
    expect(r.E).toBeCloseTo(0.2808, 4);
  });
  test("coefficients raise the activities to their powers", () => {
    const r = nernst(1.23, 4, 25, [{ a: 1, nu: 2 }], [{ a: 0.21, nu: 1 }, { a: 1e-7, nu: 4 }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.lnQ).toBeCloseTo(-(Math.log(0.21) + 4 * Math.log(1e-7)), 12);
  });
  test("refusals", () => {
    expect(nernst(0.34, 0, 25, [], [{ a: 1, nu: 1 }])).toMatch(/whole number/);
    expect(nernst(0.34, 2, 25, [], [{ a: 0, nu: 1 }])).toMatch(/above zero/);
    expect(nernst(0.34, 2, -300, [], [{ a: 1, nu: 1 }])).toMatch(/absolute zero/);
  });
});

describe("Butler–Volmer and Tafel", () => {
  const p = { j0: 1e-3, alphaA: 0.6, alphaC: 0.4, tC: 25 };
  test("zero current at zero overpotential; the linear limit j ≈ j₀(αa+αc)Fη/RT", () => {
    expect(butlerVolmer(0, p)).toBe(0);
    const eta = 1e-5;
    expect(butlerVolmer(eta, p) / ((p.j0 * (p.alphaA + p.alphaC) * eta) / thermalVoltage(25))).toBeCloseTo(1, 4);
    expect(butlerVolmerCurve(p, -0.3, 0.3, 11)).toHaveLength(11);
  });
  test("the Tafel fit recovers αa, αc and j₀ from Butler–Volmer data well past the linear region", () => {
    const data: Array<[number, number]> = [];
    for (let eta = -0.4; eta <= 0.4001; eta += 0.02) data.push([eta, butlerVolmer(eta, p)]);
    const r = tafelFit(data, 25, 0.2);
    if (typeof r === "string") throw new Error(r);
    expect(r.anodic!.alpha).toBeCloseTo(0.6, 3);
    expect(r.cathodic!.alpha).toBeCloseTo(0.4, 2);
    expect(r.anodic!.slope * 1000).toBeCloseTo((2.302585 * thermalVoltage(25) * 1000) / 0.6, 0);
    expect(Math.log10(r.j0)).toBeCloseTo(-3, 2);
  });
  test("one branch is enough; no usable branch is refused", () => {
    const an: Array<[number, number]> = [0.15, 0.2, 0.25, 0.3].map((e) => [e, butlerVolmer(e, p)]);
    const r = tafelFit(an, 25);
    expect(typeof r === "string" ? null : r.cathodic).toBeNull();
    expect(tafelFit([[0.01, 1], [0.02, 2], [0.03, 3], [0.04, 4]], 25)).toMatch(/no branch/);
  });
});
