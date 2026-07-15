// NMR prediction tests.
//
// These assert against REAL published shifts, not against whatever the model
// currently emits. A tolerance is given per case reflecting the honest accuracy
// of additivity (±2-4 ppm for 13C, ±0.3 ppm for 1H). If a refactor breaks the
// chemistry, these fail — which is the point.

import { predictNmr, nmrSticks } from "../nmr";

/** Finds the predicted signal nearest `ppm`. */
function near(shifts: number[], ppm: number): number {
  return shifts.reduce((best, s) => (Math.abs(s - ppm) < Math.abs(best - ppm) ? s : best), Infinity);
}

describe("13C prediction vs literature", () => {
  // [SMILES, name, [literature shifts], tolerance]
  const cases: [string, string, number[], number][] = [
    ["c1ccccc1", "benzene", [128.5], 1],
    ["Cc1ccccc1", "toluene", [137.8, 129.3, 128.5, 125.6, 21.4], 2],
    ["Oc1ccccc1", "phenol", [155.1, 129.9, 121.4, 115.7], 2],
    ["CCO", "ethanol", [57.8, 18.2], 4],
    ["CC(=O)O", "acetic acid", [178.1, 20.8], 3],
    ["CC(C)=O", "acetone", [206.0, 30.8], 4],
    ["CCCC", "butane", [25.0, 13.2], 2],
    ["O=Cc1ccccc1", "benzaldehyde", [192.0, 136.4, 134.5, 129.7, 128.9], 3],
  ];

  test.each(cases)("%s (%s)", (smiles, _name, lit, tol) => {
    const r = predictNmr(smiles, "13C");
    expect(r).not.toBeNull();
    const shifts = r!.signals.map((s) => s.shift);
    for (const l of lit) {
      expect(Math.abs(near(shifts, l) - l)).toBeLessThanOrEqual(tol);
    }
  });

  test("acetone: two methyls are one signal by symmetry", () => {
    const r = predictNmr("CC(C)=O", "13C")!;
    const ch3 = r.signals.find((s) => s.assignment === "CH3");
    expect(ch3).toBeDefined();
    expect(ch3!.count).toBe(2);
  });

  test("13C is reported proton-decoupled (singlets)", () => {
    const r = predictNmr("CCO", "13C")!;
    expect(r.signals.every((s) => s.multiplicity === "s")).toBe(true);
  });

  test("ester and ketone C=O are distinguished, not conflated", () => {
    const ester = predictNmr("CC(=O)OCC", "13C")!.signals[0].shift;
    const ketone = predictNmr("CC(=O)CC", "13C")!.signals[0].shift;
    // Ester C=O sits ~30 ppm upfield of a ketone — the classic distinction.
    expect(ketone - ester).toBeGreaterThan(20);
  });

  test("nitrile carbon near 118 ppm", () => {
    const r = predictNmr("CC#N", "13C")!;
    const cn = r.signals.find((s) => s.assignment.includes("nitrile"));
    expect(cn).toBeDefined();
    expect(Math.abs(cn!.shift - 117.7)).toBeLessThanOrEqual(3);
  });
});

describe("1H prediction vs literature", () => {
  const cases: [string, string, number[], number][] = [
    ["c1ccccc1", "benzene", [7.26], 0.15],
    ["Cc1ccccc1", "toluene", [7.2, 2.34], 0.3],
    ["CCO", "ethanol", [3.7, 1.22], 0.3],
    ["CC(C)=O", "acetone", [2.17], 0.3],
    ["CC(=O)OCC", "ethyl acetate", [4.12, 2.04, 1.26], 0.35],
    ["CCCC", "butane", [0.89], 0.3],
  ];

  test.each(cases)("%s (%s)", (smiles, _name, lit, tol) => {
    const r = predictNmr(smiles, "1H");
    expect(r).not.toBeNull();
    const shifts = r!.signals.map((s) => s.shift);
    for (const l of lit) {
      expect(Math.abs(near(shifts, l) - l)).toBeLessThanOrEqual(tol);
    }
  });

  test("benzene is a singlet — equivalent protons do not split each other", () => {
    const r = predictNmr("c1ccccc1", "1H")!;
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].multiplicity).toBe("s");
    expect(r.signals[0].count).toBe(6);
  });

  test("p-xylene aromatic protons are a 4H singlet", () => {
    const r = predictNmr("Cc1ccc(C)cc1", "1H")!;
    const ar = r.signals.find((s) => s.assignment.includes("aromatic"))!;
    expect(ar.count).toBe(4);
    expect(ar.multiplicity).toBe("s");
  });

  test("ethanol: CH2 quartet, CH3 triplet (classic n+1)", () => {
    const r = predictNmr("CCO", "1H")!;
    const ch2 = r.signals.find((s) => s.assignment.startsWith("CH2"))!;
    const ch3 = r.signals.find((s) => s.assignment.startsWith("CH3"))!;
    expect(ch2.multiplicity).toBe("q");
    expect(ch3.multiplicity).toBe("t");
  });

  test("integration counts every proton in the molecule", () => {
    // Ethyl acetate C4H8O2 → 8 protons total.
    const r = predictNmr("CC(=O)OCC", "1H")!;
    const total = r.signals.reduce((s, x) => s + x.count, 0);
    expect(total).toBe(8);
  });

  test("exchangeable OH/COOH are flagged variable, not passed off as predictions", () => {
    const acid = predictNmr("CC(=O)O", "1H")!;
    const cooh = acid.signals.find((s) => s.assignment.includes("COOH"))!;
    expect(cooh.variable).toBe(true);
    expect(cooh.assignment).toMatch(/variable/);
  });

  test("aldehyde proton is downfield past 9 ppm", () => {
    const r = predictNmr("O=Cc1ccccc1", "1H")!;
    const cho = r.signals.find((s) => s.assignment.includes("aldehyde"))!;
    expect(cho.shift).toBeGreaterThan(9.0);
  });
});

describe("robustness and honesty", () => {
  test("unresolvable input returns null rather than a fabricated spectrum", () => {
    expect(predictNmr("not-a-molecule-!!!", "13C")).toBeNull();
    expect(predictNmr("", "1H")).toBeNull();
  });

  test("resolves dictionary names as well as SMILES", () => {
    const r = predictNmr("caffeine", "13C");
    expect(r).not.toBeNull();
    expect(r!.signals.length).toBeGreaterThan(3);
  });

  test("signals are sorted downfield-first, as a spectrum reads", () => {
    const r = predictNmr("CC(=O)Oc1ccccc1C(=O)O", "13C")!;
    const shifts = r.signals.map((s) => s.shift);
    const sorted = [...shifts].sort((a, b) => b - a);
    expect(shifts).toEqual(sorted);
  });

  test("polysubstituted-carbon weakness is surfaced as a caveat, not hidden", () => {
    const r = predictNmr("ClC(Cl)Cl", "1H")!;
    expect(r.caveats.join(" ")).toMatch(/over-count/i);
  });

  test("heteroaromatic rings are flagged as approximate", () => {
    const r = predictNmr("c1ccncc1", "13C")!;
    expect(r.caveats.join(" ")).toMatch(/Heteroaromatic/i);
  });

  test("methane: a single carbon with no neighbours still predicts", () => {
    const r = predictNmr("C", "13C")!;
    expect(r.signals).toHaveLength(1);
    // Methane is -2.3 ppm; the Grant-Paul intercept IS methane.
    expect(Math.abs(r.signals[0].shift - -2.3)).toBeLessThan(1);
  });

  test("stick spectrum has one stick per signal, at the right shift", () => {
    const r = predictNmr("CCO", "1H")!;
    const sticks = nmrSticks(r);
    expect(sticks).toHaveLength(r.signals.length);
    for (let i = 0; i < sticks.length; i++) {
      expect(sticks[i][0].x).toBeCloseTo(r.signals[i].shift, 6);
      expect(sticks[i][0].y).toBe(0);
      expect(sticks[i][1].y).toBeGreaterThan(0);
    }
  });
});
