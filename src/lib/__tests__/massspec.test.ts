import { Molecule } from "openchemlib";
import {
  parseFormula,
  computeMassSpec,
  adductMz,
  ADDUCTS,
  resolveMassSpec,
  isotopePattern,
  peakLabel,
  maxAtomsFor,
  MassSpecResult,
  compositionFromMolecule,
} from "../massspec";
import { elementIsotopes, tabulatedElements } from "../isotopes";
import { NAME_TO_SMILES, FORMULA_TO_SMILES } from "../compounds";
import { resolveChemInput, resolveStructure, duplicateRingClosure, renderStructure } from "../structures";

describe("parseFormula", () => {
  it("parses simple and multi-letter element formulas", () => {
    expect(parseFormula("C9H8O4")).toEqual({ C: 9, H: 8, O: 4 });
    expect(parseFormula("C22H24N2O8")).toEqual({ C: 22, H: 24, N: 2, O: 8 });
    expect(parseFormula("CH3Cl")).toEqual({ C: 1, H: 3, Cl: 1 });
    expect(parseFormula("NaCl")).toEqual({ Na: 1, Cl: 1 });
  });
});

describe("isotope-pattern M peak matches the monoisotopic mass", () => {
  it.each(["aspirin", "caffeine", "amoxicillin", "tetracycline"])("%s M-peak = monoisotopic", (name) => {
    const spec = computeMassSpec(name)!;
    // The M (offset 0) peak's centroid mass equals the OCL monoisotopic mass —
    // cross-checks the isotope table against OpenChemLib.
    const m = spec.pattern.find((p) => p.offset === 0)!;
    expect(m.mass).toBeCloseTo(spec.monoisotopicMass, 2);
  });
});

describe("computeMassSpec", () => {
  it("aspirin: exact masses and a sensible isotope pattern", () => {
    const s = computeMassSpec("aspirin")!;
    expect(s.formula).toBe("C9H8O4");
    expect(s.monoisotopicMass).toBeCloseTo(180.0423, 3);
    expect(s.averageMass).toBeCloseTo(180.159, 2);
    // M is the base peak (100); M+1 ~ 9-11% (nine carbons × 1.1%).
    expect(s.pattern[0].offset).toBe(0);
    expect(s.pattern[0].intensity).toBe(100);
    const m1 = s.pattern.find((p) => p.offset === 1)!;
    expect(m1.intensity).toBeGreaterThan(8);
    expect(m1.intensity).toBeLessThan(12);
  });

  it("chlorine gives the classic ~32% M+2 (37Cl)", () => {
    const s = computeMassSpec("CCl")!; // chloromethane CH3Cl
    expect(s.formula).toBe("CH3Cl");
    const m2 = s.pattern.find((p) => p.offset === 2)!;
    expect(m2.intensity).toBeGreaterThan(30);
    expect(m2.intensity).toBeLessThan(34);
  });

  it("sulfur raises M+2 (34S ~4.4%)", () => {
    const s = computeMassSpec("amoxicillin")!; // C16H19N3O5S
    const m2 = s.pattern.find((p) => p.offset === 2)!;
    expect(m2.intensity).toBeGreaterThan(4);
  });

  // REPLACED in v2.138.0. This test used to assert `unsupportedInPattern`
  // CONTAINS "Mg" — it pinned the defect itself (§E2): chlorophyll a's pattern was
  // drawn as though the magnesium were not there. Mg is now in the pattern, and
  // the assertion is the oracle's numbers (IsoSpecPy 2.5.0 run on the shipped
  // table; ²⁵Mg/²⁶Mg lift M+1 from ≈62 % to 74.6 %).
  it("chlorophyll a: Mg is IN the pattern (oracle values)", () => {
    const s = computeMassSpec("chlorophyll a")!; // C55H72MgN4O5
    expect(s.unsupportedInPattern).toEqual([]);
    expect(s.monoisotopicMass).toBeCloseTo(892.5353, 3);
    const want: Record<number, number> = { 0: 100, 1: 74.63, 2: 41.69, 3: 15.56, 4: 4.08, 5: 0.81, 6: 0.13 };
    for (const [o, v] of Object.entries(want)) {
      const pk = s.pattern.find((p) => p.offset === Number(o));
      expect({ o, i: pk && Math.abs(pk.intensity - v) <= 0.05 }).toEqual({ o, i: true });
    }
  });

  it("adduct m/z is exact arithmetic on the monoisotopic mass", () => {
    const s = computeMassSpec("aspirin")!;
    const mh = s.adducts.find((a) => a.name === "[M+H]+")!;
    const mna = s.adducts.find((a) => a.name === "[M+Na]+")!;
    const mmh = s.adducts.find((a) => a.name === "[M-H]-")!;
    const m2h = s.adducts.find((a) => a.name === "[M+2H]2+")!;
    expect(mh.mz).toBeCloseTo(181.0495, 3);
    expect(mna.mz).toBeCloseTo(203.0315, 3);
    expect(mmh.mz).toBeCloseTo(179.0350, 3);
    // Doubly charged ion appears at roughly half the mass.
    expect(m2h.mz).toBeCloseTo((s.monoisotopicMass + 2 * 1.007276) / 2, 3);
  });

  it("returns null for unresolvable input", () => {
    expect(computeMassSpec("not_a_compound_zzz")).toBeNull();
  });

  it("[M+NH4]+ is one proton/electron correct (no double electron subtraction)", () => {
    const s = computeMassSpec("aspirin")!;
    const nh4 = s.adducts.find((a) => a.name === "[M+NH4]+")!;
    // 180.0423 + (18.0343741 − electron) = 198.0761.
    expect(nh4.mz).toBeCloseTo(198.0761, 3);
  });

  // REPLACED in v2.138.0. This test asserted Fe was "untabled" and that the
  // single drawn peak was anchored to OpenChemLib's mass — the defect itself
  // (§E2). Iron is tabled now; the assertion is the oracle (IsoSpecPy on the
  // shipped CIAAW 2024 table): ⁵⁴Fe is M−2 at 6.37 %.
  it("[Fe]: the full iron pattern, labelled from ⁵⁶Fe (oracle values)", () => {
    const s = computeMassSpec("[Fe]")!;
    expect(s.unsupportedInPattern).toEqual([]);
    expect(s.monoisotopicMass).toBeCloseTo(55.934935537, 8);
    expect(s.pattern.map((p) => p.label)).toEqual(["M−2", "M", "M+1", "M+2"]);
    const by = (o: number) => s.pattern.find((p) => p.offset === o)!;
    expect(by(-2).intensity).toBeCloseTo(6.37, 2);
    expect(by(-2).mass).toBeCloseTo(53.9396, 4);
    expect(by(0).intensity).toBe(100);
    expect(by(1).intensity).toBeCloseTo(2.31, 2);
    expect(by(2).intensity).toBeCloseTo(0.31, 2);
  });

  it("reports a neutral molecule as netCharge 0 with a full adduct table", () => {
    const s = computeMassSpec("aspirin")!;
    expect(s.netCharge).toBe(0);
    expect(s.adducts.length).toBeGreaterThan(0);
  });

  it("omits ESI adducts for an already-charged cation (choline)", () => {
    const s = computeMassSpec("[N+](C)(C)(C)CCO")!;
    expect(s.netCharge).toBe(1);
    expect(s.adducts).toHaveLength(0);
    // Mass and pattern are still valid for the ion's formula.
    expect(s.monoisotopicMass).toBeCloseTo(104.1075, 3);
    expect(s.pattern[0].offset).toBe(0);
  });

  it("omits ESI adducts for an anion (acetate)", () => {
    const s = computeMassSpec("CC(=O)[O-]")!;
    expect(s.netCharge).toBe(-1);
    expect(s.adducts).toHaveLength(0);
  });

  it("keeps adducts for a net-neutral salt (charges balance)", () => {
    const s = computeMassSpec("[Na+].[Cl-]")!;
    expect(s.netCharge).toBe(0);
    expect(s.adducts.length).toBeGreaterThan(0);
  });
});

describe("adductMz", () => {
  it("divides by the charge for multiply-charged ions", () => {
    const twoPlus = ADDUCTS.find((a) => a.name === "[M+2H]2+")!;
    expect(adductMz(1000, twoPlus)).toBeCloseTo((1000 + 2 * 1.007276) / 2, 4);
  });
});

// ===========================================================================
// v2.138.0 — every stable isotope (SCOPE-SPECTROSCOPY-BATCH §B3 / §D3)
// ===========================================================================

function ok(input: string): MassSpecResult {
  const r = resolveMassSpec(input, "auto");
  if (r.kind !== "ok") throw new Error(`${input}: expected ok, got ${r.kind}: ${"message" in r ? r.message : ""}`);
  return r.result;
}

type Row = { input: string; peaks: Record<number, number>; masses?: Record<number, number>; mono?: number };

// §D3, VERBATIM from the brief. Its oracles were IsoSpecPy 2.5.0, molmass and a
// hand convolution on the CIAAW table. Every row involves an interval element
// (H C N O Mg S Cl Br B), so the brief's tolerance is ±0.6 points; masses ±1 mDa.
// Labels count from M (the most abundant isotopes).
const D3: Row[] = [
  { input: "C10H10Fe", peaks: { [-2]: 6.37, [-1]: 0.7, 0: 100, 1: 13.3, 2: 1.1 }, masses: { [-2]: 184.0179, 0: 186.0132 } },
  { input: "FeCl3", peaks: { [-2]: 6.0, 0: 100, 1: 2.18, 2: 92.6, 4: 29.4, 6: 3.18 } },
  { input: "C6H4Br2", peaks: { 0: 51.35, 1: 3.37, 2: 100, 3: 6.55, 4: 48.77, 5: 3.19 }, masses: { 0: 233.868 } },
  { input: "CHCl3", peaks: { 0: 100, 2: 95.99, 4: 30.71, 6: 3.28 } },
  { input: "C2Cl4", peaks: { 0: 78.13, 2: 100, 4: 48.0, 6: 10.24, 8: 0.82 } },
  {
    input: "C5H11NO2Se",
    peaks: { [-6]: 1.8, [-4]: 18.85, [-3]: 16.47, [-2]: 48.81, [-1]: 2.96, 0: 100, 1: 6.0, 2: 18.11, 3: 1.08 },
    masses: { [-6]: 191.0015, 0: 196.9955 },
  },
  { input: "C6H7BO2", peaks: { [-1]: 24.5, 0: 100, 1: 6.7, 2: 0.6 }, masses: { [-1]: 121.0575, 0: 122.0539 } },
  {
    input: "C12H27ClSn",
    peaks: { [-8]: 2.31, [-6]: 2.33, [-4]: 35.2, [-3]: 23.2, [-2]: 71.4, [-1]: 35.6, 0: 100, 1: 19.5, 2: 37.5, 4: 17.6, 6: 4.55 },
    masses: { 0: 326.082 },
  },
  {
    input: "SnCl4",
    peaks: { [-4]: 22.0, [-2]: 59.7, [-1]: 25.7, 0: 100, 1: 21.7, 2: 86.9, 4: 48.3, 6: 20.4, 8: 6.2 },
    masses: { 0: 259.775 },
  },
  {
    input: "CH3HgCl",
    peaks: { [-4]: 26.7, [-3]: 45.3, [-2]: 70.7, [-1]: 50.4, 0: 100, 1: 12.4, 2: 44.0, 4: 5.9 },
    masses: { 0: 251.962 },
  },
  { input: "HgCl2", peaks: { [-4]: 22.1, [-3]: 36.9, [-2]: 64.6, [-1]: 52.5, 0: 100, 1: 22.3, 2: 62.1, 4: 16.3, 6: 1.54 } },
  {
    input: "Cl2H6N2Pt",
    peaks: { [-3]: 1.7, [-1]: 71.6, 0: 73.1, 1: 100, 2: 47.2, 3: 58.0, 5: 15.7 },
    masses: { 0: 298.9556 },
  },
  { input: "MgCl2", peaks: { 0: 100, 1: 12.7, 2: 77.9, 3: 8.1, 4: 19.2, 6: 1.43 } },
  { input: "W(CO)6", peaks: { [-2]: 82.9, [-1]: 50.3, 0: 100, 2: 90.3, 3: 6.1 }, masses: { 0: 351.9204 } },
  { input: "OsO4", peaks: { [-6]: 3.9, [-5]: 4.8, [-4]: 32.3, [-3]: 39.5, [-2]: 64.4, 0: 100 }, masses: { 0: 255.9411 } },
  { input: "Cu(NO3)2", peaks: { 0: 100, 2: 45.85 }, masses: { 0: 186.9052 }, mono: 186.9052 },
  { input: "C6Cl6", peaks: { 0: 52.0, 2: 100, 4: 80.1, 6: 34.2, 8: 8.24 }, masses: { 0: 281.8131 } },
  { input: "C6F6", peaks: { 0: 100, 1: 6.5 }, masses: { 0: 185.9904 } },
  { input: "C6Br6", peaks: { 0: 5.42, 2: 31.7, 4: 77.05, 6: 100, 8: 73.0 }, masses: { 0: 545.51 } },
];

describe("§D3 isotope patterns — the brief's oracle rows", () => {
  it.each(D3.map((r) => [r.input, r]))("%s", (_name, row) => {
    const r = ok((row as Row).input);
    const { peaks, masses, mono } = row as Row;
    for (const [o, want] of Object.entries(peaks)) {
      const pk = r.pattern.find((p) => p.offset === Number(o));
      const got = pk ? pk.intensity : NaN;
      expect({ peak: peakLabel(Number(o)), within: Math.abs(got - want) <= 0.6, got }).toEqual({
        peak: peakLabel(Number(o)),
        within: true,
        got,
      });
    }
    for (const [o, want] of Object.entries(masses ?? {})) {
      const pk = r.pattern.find((p) => p.offset === Number(o))!;
      expect(Math.abs(pk.mass - want)).toBeLessThanOrEqual(0.001);
    }
    if (mono !== undefined) expect(Math.abs(r.monoisotopicMass - mono)).toBeLessThanOrEqual(0.001);
    // Exactly one base peak at 100, and M exists.
    expect(r.pattern.filter((p) => p.intensity === 100)).toHaveLength(1);
    expect(r.pattern.some((p) => p.offset === 0)).toBe(true);
  });
});

// IsoSpecPy 2.5.0 run on the SHIPPED table (CIAAW 2024 + NIST interval values,
// AME2020 masses), grouped by Σ mass number — an independent algorithm on the
// same data, so it pins the convolution to ±0.05 points and ±0.1 mDa.
const ISOSPEC_SHIPPED: Record<string, [number, number, number][]> = {
  C5H11NO2Se: [[-6, 191.0015, 1.72], [-5, 192.0045, 0.1], [-4, 192.9982, 18.49], [-3, 193.9991, 16.32], [-2, 194.9964, 48.45], [-1, 195.9995, 2.93], [0, 196.9955, 100], [1, 197.9986, 5.97], [2, 198.9958, 18.22], [3, 199.9988, 1.08]],
  CH3HgCl: [[-6, 245.9582, 0.4], [-4, 247.9591, 27.01], [-3, 248.9606, 45.65], [-2, 249.9601, 71.06], [-1, 250.9612, 50.56], [0, 251.9619, 100], [1, 252.9602, 12.39], [2, 253.9624, 43.86], [3, 254.9659, 0.49], [4, 255.9629, 5.84]],
  HgCl2: [[-6, 265.9035, 0.33], [-4, 267.9044, 22.24], [-3, 268.906, 37.17], [-2, 269.905, 64.9], [-1, 270.9058, 52.68], [0, 271.9064, 100], [1, 272.9042, 22.3], [2, 273.9064, 61.92], [3, 274.9021, 2.96], [4, 275.9059, 16.26], [6, 277.9053, 1.53]],
  C254H377N65O75S6: [[0, 5729.6009, 16.01], [1, 5730.6037, 49.7], [2, 5731.606, 83.65], [3, 5732.608, 100], [4, 5733.6098, 94.47], [5, 5734.6114, 74.62], [6, 5735.6129, 51.04], [7, 5736.6143, 30.94], [8, 5737.6157, 16.91], [9, 5738.617, 8.44], [10, 5739.6183, 3.88], [11, 5740.6196, 1.66], [12, 5741.6208, 0.66], [13, 5742.6221, 0.25]],
  Cl2H6N2Pt: [[-3, 295.9518, 1.69], [-1, 297.9534, 71.61], [0, 298.9556, 73.06], [1, 299.9534, 100], [2, 300.9526, 47.18], [3, 301.9537, 58.01], [4, 302.9498, 7.88], [5, 303.9536, 15.7], [6, 304.9515, 0.13], [7, 305.9528, 1.62]],
  C6Br6: [[0, 545.51, 5.42], [1, 546.5134, 0.35], [2, 547.508, 31.67], [3, 548.5113, 2.05], [4, 549.5059, 77.05], [5, 550.5093, 5.0], [6, 551.5039, 100], [7, 552.5072, 6.48], [8, 553.5018, 73.03], [9, 554.5052, 4.73], [10, 555.4998, 28.48], [11, 556.5031, 1.84], [12, 557.4978, 4.65], [13, 558.5011, 0.3]],
};

describe("IsoSpec on the shipped table — every peak, exactly", () => {
  it.each(Object.keys(ISOSPEC_SHIPPED))("%s", (f) => {
    const r = ok(f);
    const want = ISOSPEC_SHIPPED[f];
    // The same peak set (every peak ≥ 0.1 %), nothing extra, nothing missing.
    expect(r.pattern.map((p) => p.offset)).toEqual(want.map((w) => w[0]));
    for (const [o, m, i] of want) {
      const pk = r.pattern.find((p) => p.offset === o)!;
      expect(Math.abs(pk.intensity - i)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(pk.mass - m)).toBeLessThanOrEqual(0.0001);
    }
  });

  // The brief's insulin row (IsoSpec with ITS OWN default table: M 15.7 · M+1
  // 49.1 · M+2 83.2 · M+3 100 · M+4 95.0 · M+5 75.4 · M+6 51.8 · M+7 31.5 · M+8
  // 17.3 · M+9 8.7) is NOT reproduced to ±0.6 at M+5/M+6 (0.76/0.75 points):
  // IsoSpec's default ¹³C abundance is 0.010788, ours is NIST's 0.0107 — both
  // inside CIAAW's interval [0.0096, 0.0116], and with 254 carbons the
  // difference moves the envelope. The same algorithm on the SHIPPED table
  // (above) agrees to 0.01. What the brief required of insulin — M+6…M+9 all
  // shown, not cut off at M+5 — is pinned here.
  it("insulin keeps M+6 … M+9 (the six-peak cut is gone)", () => {
    const r = ok("C254H377N65O75S6");
    for (const o of [6, 7, 8, 9]) expect(r.pattern.some((p) => p.offset === o && p.intensity > 5)).toBe(true);
    expect(r.pattern.find((p) => p.intensity === 100)!.label).toBe("M+3");
  });
});

/**
 * Independent exact convolution: atom by atom, no squaring, no pruning, over the
 * shipped isotopes.ts data. Different algorithm, same data.
 */
function bruteForce(counts: Record<string, number>): Map<number, { p: number; pm: number }> {
  let dist = new Map<number, { p: number; pm: number }>([[0, { p: 1, pm: 0 }]]);
  for (const [el, n] of Object.entries(counts)) {
    const iso = elementIsotopes(el)!;
    const A0 = iso.mostAbundant.A;
    for (let k = 0; k < n; k++) {
      const next = new Map<number, { p: number; pm: number }>();
      for (const [o, v] of dist) {
        for (const i of iso.isotopes) {
          const key = o + i.A - A0;
          const cur = next.get(key) ?? { p: 0, pm: 0 };
          cur.p += v.p * i.abundance;
          cur.pm += v.pm * i.abundance + v.p * i.abundance * i.mass;
          next.set(key, cur);
        }
      }
      dist = next;
    }
  }
  return dist;
}

describe("pattern = an independent exact convolution (Fe, Br₂, Cl₃, Sn, Hg, Se, B, Pt, Br₆)", () => {
  it.each(["C10H10Fe", "FeCl3", "C6H4Br2", "CHCl3", "C12H27ClSn", "SnCl4", "CH3HgCl", "HgCl2", "C5H11NO2Se", "C6H7BO2", "Cl2H6N2Pt", "C6Br6", "Fe2O3"])(
    "%s",
    (f) => {
      const counts = parseFormula(f);
      const got = isotopePattern(counts);
      const ref = bruteForce(counts);
      const max = Math.max(...[...ref.values()].map((v) => v.p));
      const refPeaks = [...ref.entries()]
        .filter(([, v]) => (v.p / max) * 100 >= 0.1)
        .sort((a, b) => a[0] - b[0]);
      expect(got.peaks.map((p) => p.offset)).toEqual(refPeaks.map(([o]) => o));
      for (const [o, v] of refPeaks) {
        const pk = got.peaks.find((p) => p.offset === o)!;
        expect(Math.abs(pk.intensity - (v.p / max) * 100)).toBeLessThan(1e-6);
        expect(Math.abs(pk.mass - v.pm / v.p)).toBeLessThan(1e-7);
      }
    }
  );
});

describe("labels, threshold and cap — never a silent cut", () => {
  it("labels use a true minus and count from M", () => {
    expect(peakLabel(-6)).toBe("M−6");
    expect(peakLabel(0)).toBe("M");
    expect(peakLabel(3)).toBe("M+3");
    const se = ok("C5H11NO2Se");
    expect(se.pattern.map((p) => p.label).join(" ")).not.toMatch(/-/);
    expect(se.pattern.find((p) => p.intensity === 100)!.label).toBe("M");
  });

  it("C₂Cl₄ keeps its 10 % M+6 and its M+8 (§A-10)", () => {
    const r = ok("C2Cl4");
    expect(r.pattern.find((p) => p.offset === 6)!.intensity).toBeCloseTo(10.24, 1);
    expect(r.pattern.some((p) => p.offset === 8)).toBe(true);
  });

  it("what is not shown is counted and said", () => {
    const r = ok("C10H10Fe");
    expect(r.belowThreshold).toBeGreaterThan(0);
    expect(r.patternNote).toMatch(new RegExp(`${r.belowThreshold} further peaks below 0.1 %`));
    expect(r.massSource).toMatch(/AME2020/);
    expect(r.massSource).toMatch(/CIAAW 2024/);
  });

  it("a pattern wider than the cap keeps the 60 most intense and says how many more", () => {
    const r = isotopePattern({ Se: 10000 });
    expect(r.peaks).toHaveLength(60);
    expect(r.beyondCap).toBeGreaterThan(0);
    expect(r.note).toMatch(/beyond the 60-peak cap/);
    // The base peak is among those kept.
    expect(r.peaks.some((p) => p.intensity === 100)).toBe(true);
  });
});

describe("the mass reference is AME2020, not OpenChemLib (§A-12)", () => {
  it("Cu, Pa and Cu(NO₃)₂", () => {
    expect(ok("[Cu]").monoisotopicMass).toBeCloseTo(62.9296, 4);
    expect(ok("Pa").monoisotopicMass).toBeCloseTo(231.03588, 4);
    expect(ok("Cu(NO3)2").monoisotopicMass).toBeCloseTo(186.90523, 4);
    // Every adduct is computed from the same reference.
    const cu = ok("Cu(NO3)2");
    const mh = cu.adducts.find((a) => a.name === "[M+H]+")!;
    expect(mh.mz).toBeCloseTo(186.90523 + 1.007825031898 - 0.000548579909065, 5);
  });

  it("the SMILES path walks atoms: isotope labels are kept", () => {
    expect(computeMassSpec("[13CH4]")!.monoisotopicMass).toBeCloseTo(17.0347, 4);
    // CD₄: 12 + 4 × 2.014101777844 (OpenChemLib's own figure is 20.0560).
    expect(computeMassSpec("[2H]C([2H])([2H])[2H]")!.monoisotopicMass).toBeCloseTo(20.056407111, 8);
    const tc = ok("[99Tc]");
    expect(tc.monoisotopicMass).toBeCloseTo(98.906249681, 8);
    expect(tc.pattern).toHaveLength(1);
    expect(tc.labelledIsotopes).toEqual(["⁹⁹Tc × 1"]);
  });

  it("an OpenChemLib mass that disagrees by > 1 mDa is LOGGED, never used and never a refusal", () => {
    const h = Molecule.fromSmiles("[H]").getMolecularFormula().absoluteWeight;
    const off: string[] = [];
    for (const el of tabulatedElements()) {
      let ocl: number;
      try {
        const mol = Molecule.fromSmiles(`[${el}]`);
        let nH = 0;
        for (let i = 0; i < mol.getAllAtoms(); i++) nH += mol.getImplicitHydrogens(i);
        ocl = mol.getMolecularFormula().absoluteWeight - nH * h;
      } catch {
        continue;
      }
      const ours = elementIsotopes(el)!.mostAbundant.mass;
      if (Math.abs(ocl - ours) > 0.001) off.push(`${el}: OpenChemLib ${ocl.toFixed(5)} vs AME2020 ${ours.toFixed(5)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`OpenChemLib monoisotopic masses off by > 1 mDa (not used):\n  ${off.join("\n  ")}`);
    expect(off.some((s) => s.startsWith("Cu:"))).toBe(true);
    expect(off.some((s) => s.startsWith("Pa:"))).toBe(true);
    expect(ok("[Cu]").pattern.length).toBeGreaterThan(1);
  });
});

describe("every dictionary compound: the atom walk agrees with OpenChemLib's formula (no silent atom drop)", () => {
  it("counts match and masses agree to 1 mDa except where OpenChemLib is wrong (Cu, Pa)", () => {
    const off: string[] = [];
    let n = 0;
    for (const smi of new Set([...Object.values(NAME_TO_SMILES), ...Object.values(FORMULA_TO_SMILES)])) {
      let mol: Molecule;
      try {
        mol = Molecule.fromSmiles(smi);
      } catch {
        continue;
      }
      n++;
      const mf = mol.getMolecularFormula();
      const comp = compositionFromMolecule(mol);
      expect({ smi, refused: typeof comp === "string" }).toEqual({ smi, refused: false });
      if (typeof comp === "string") continue;
      const walked: Record<string, number> = { ...comp.natural };
      for (const l of comp.labelled ?? []) walked[l.symbol] = (walked[l.symbol] ?? 0) + l.count;
      const ocl = parseFormula(mf.formula);
      // OpenChemLib prints deuterium as D; it is hydrogen.
      if (ocl.D) {
        ocl.H = (ocl.H ?? 0) + ocl.D;
        delete ocl.D;
      }
      expect({ smi, counts: walked }).toEqual({ smi, counts: ocl });
      const r = resolveMassSpec(`smiles:${smi}`, "auto");
      expect({ smi, kind: r.kind }).toEqual({ smi, kind: "ok" });
      if (r.kind !== "ok") continue;
      if (Math.abs(r.result.monoisotopicMass - mf.absoluteWeight) > 0.001) {
        off.push(`${mf.formula}: ours ${r.result.monoisotopicMass.toFixed(5)}, OpenChemLib ${mf.absoluteWeight.toFixed(5)}`);
        expect({ smi, cuOrPa: /Cu|Pa/.test(mf.formula) }).toEqual({ smi, cuOrPa: true });
      }
    }
    expect(n).toBeGreaterThan(300);
    // eslint-disable-next-line no-console
    console.log(`Dictionary sweep: ${n} structures; OpenChemLib off by > 1 mDa (not used): ${off.join("; ") || "none"}`);
  });
});

describe("D and T in a formula are ²H and ³H — named isotopes, not natural hydrogen", () => {
  it("CDCl₃: 12 + ²H + 3 × ³⁵Cl (AME2020) = 118.920660, the reading said", () => {
    const r = resolveMassSpec("CDCl3", "auto");
    expect(r.kind === "ok" && r.reading).toBe("formula");
    if (r.kind !== "ok") return;
    // AME2020: 12 + 2.014101777844 + 3 × 34.968852694 = 118.92065986. (The
    // brief's 118.920664 is the same sum with an older ³⁵Cl mass, 34.96885268.)
    expect(r.result.monoisotopicMass).toBeCloseTo(118.92065986, 7);
    expect(Math.abs(r.result.monoisotopicMass - 118.920664)).toBeLessThan(1e-5);
    expect(r.result.labelledIsotopes).toEqual(["²H × 1"]);
    expect(r.note).toMatch(/D read as deuterium, ²H \(2\.014102 u\).*not natural hydrogen/);
    // D is NOT natural H: CHCl₃ is 1.006 Da lighter, and D adds no ²H/¹H spread.
    expect(r.result.monoisotopicMass - ok("CHCl3").monoisotopicMass).toBeCloseTo(2.014101777844 - 1.007825031898, 9);
  });

  it("D₂O, C₆D₆ and T₂O", () => {
    expect(ok("D2O").monoisotopicMass).toBeCloseTo(2 * 2.014101777844 + 15.99491461926, 9);
    expect(ok("C6D6").monoisotopicMass).toBeCloseTo(72 + 6 * 2.014101777844, 9);
    const t = resolveMassSpec("T2O", "auto");
    expect(t.kind === "ok" && t.result.monoisotopicMass).toBeCloseTo(2 * 3.01604928132 + 15.99491461926, 9);
    expect(t.kind === "ok" && t.note).toMatch(/T read as tritium, ³H/);
  });
});

describe("no stable isotope, or Z > 92: refused by name — no pattern and no mass", () => {
  it.each([
    ["TcO4", /technetium.*no stable isotope/],
    ["PoCl2", /polonium.*no stable isotope/],
    ["RaCl2", /radium.*no stable isotope/],
    ["Ac", /actinium.*no stable isotope/],
    ["Pm", /promethium.*no stable isotope/],
    ["Np", /neptunium.*Z = 93.*beyond/],
    ["[Tc]", /technetium.*\[99Tc\]/],
  ])("%s", (input, re) => {
    const r = resolveMassSpec(input, "auto");
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.message).toMatch(re);
  });

  it.each(["[Tc]", "[Pm]", "[Po]", "[At]", "[Rn]", "[Fr]", "[Ra]", "[Ac]", "[Np]", "[Pu]", "[Tc]=O"])(
    "the legacy SMILES entry point refuses %s too (no invented mass)",
    (s) => {
      expect(computeMassSpec(s)).toBeNull();
    }
  );

  it("an isotope with no stored mass is refused by name, not sent to OpenChemLib", () => {
    const r = resolveMassSpec("smiles:[100Tc]", "auto");
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.message).toMatch(/¹⁰⁰Tc/);
  });
});

describe("the perhalo regression (§A-13): a ring closure that duplicates a bond is not SMILES", () => {
  // First-call setup (dictionary, OpenChemLib depiction) costs seconds; pay it
  // here so no single test carries it.
  beforeAll(() => {
    resolveStructure("C1CC1", "auto");
    resolveMassSpec("aspirin", "auto");
  }, 30000);

  it("duplicateRingClosure", () => {
    expect(duplicateRingClosure("C6Cl6")).toBe("6");
    expect(duplicateRingClosure("C6F6")).toBe("6");
    expect(duplicateRingClosure("C6Br6")).toBe("6");
    expect(duplicateRingClosure("C2Cl2")).toBe("2");
    expect(duplicateRingClosure("C11")).toBe("1");
    expect(duplicateRingClosure("CC1C1")).toBe("1");
    expect(duplicateRingClosure("C%10Cl%10")).toBe("%10");
    for (const s of ["C1CC1", "C1CCCCC1", "C1CCC2CCCCC2C1", "C12C3C4C1C5C2C3C45", "c1ccccc1", "C1.C1", "C(C1)C1", "C%10CC%10", "CCO", "O=C1CCCCC1"]) {
      expect({ s, dup: duplicateRingClosure(s) }).toEqual({ s, dup: null });
    }
  });

  it.each([
    ["C6Cl6", "C6Cl6", 281.8131],
    ["C6F6", "C6F6", 185.9904],
    ["C6Br6", "C6Br6", 545.51],
    ["C2Br2", "C2Br2", 181.8367],
    ["C3Br3", "C3Br3", 272.755],
    ["C2Cl2", "C2Cl2", 93.9377],
  ])("Mass Spec: %s is the formula %s", (input, hill, mono) => {
    const r = resolveMassSpec(input, "auto");
    expect(r.kind === "ok" && r.reading).toBe("formula");
    if (r.kind !== "ok") return;
    expect(r.result.formula).toBe(hill);
    expect(Math.abs(r.result.monoisotopicMass - mono)).toBeLessThan(0.001);
    if (r.note) expect(r.note).not.toMatch(/aromatic/);
  });

  it("the note gives the real reason", () => {
    const r = resolveMassSpec("C6Cl6", "auto");
    expect(r.kind === "ok" && r.note).toMatch(/ring closure 6 would join two atoms that are already bonded/);
  });

  it.each(["smiles:C6Cl6", "smiles:C6F6", "smiles:C6Br6"])("an explicit %s is REFUSED by name, never drawn as the OpenChemLib reading", (input) => {
    const body = input.slice(7);
    for (const r of [resolveChemInput(input, "auto", "structure"), resolveMassSpec(input, "auto"), resolveStructure(input, "auto")]) {
      expect(r.kind).toBe("none");
      if (r.kind === "none") {
        expect(r.message).toMatch(new RegExp(`“${body}” is not valid SMILES: ring closure 6 duplicates the bond C–(Cl|F|Br)`));
        expect(r.message).toContain(`type formula:${body}`);
      }
    }
    expect(renderStructure(input)).toBeNull();
  });

  it("Reaction mode's Structures toggle (mode \"smiles\") refuses it the same way", () => {
    for (const s of ["C6Cl6", "C2Cl2", "CC1C1", "C11"]) {
      const r = resolveChemInput(s, "smiles", "structure");
      expect({ s, kind: r.kind }).toEqual({ s, kind: r.kind === "dictionary" ? "dictionary" : "none" });
      if (r.kind === "none") expect(r.message).toMatch(/is not valid SMILES: ring closure/);
      if (r.kind === "dictionary") expect(resolveStructure(s, "smiles").kind).toBe("ok");
    }
    expect(resolveChemInput("C11", "smiles", "structure")).toMatchObject({ kind: "none", message: expect.stringMatching(/bond the C atom to itself/) });
    for (const s of ["C1CC1", "C1CCCCC1", "C1CCC2CCCCC2C1", "C12C3C4C1C5C2C3C45", "c1ccccc1"]) {
      expect({ s, kind: resolveStructure(s, "smiles").kind }).toEqual({ s, kind: "ok" });
      expect({ s, kind: resolveStructure(`smiles:${s}`, "auto").kind }).toEqual({ s, kind: "ok" });
    }
  });

  it("Structure mode reads C6Cl6 as a formula too", () => {
    expect(resolveChemInput("C6Cl6", "auto", "structure").kind).toBe("formula");
    expect(resolveStructure("C6Cl6", "auto").kind).toBe("formula");
  });

  it("real ring SMILES are unaffected (as v2.137.0)", () => {
    const cases: [string, string][] = [["C1CC1", "C3H6"], ["C1CCC2CCCCC2C1", "C10H18"], ["C1CCCCC1", "C6H12"], ["C12C3C4C1C5C2C3C45", "C8H8"], ["CCO", "C2H6O"], ["CN", "CH5N"]];
    for (const [s, f] of cases) {
      const r = resolveMassSpec(s, "auto");
      expect({ s, reading: r.kind === "ok" && r.reading, f: r.kind === "ok" && r.result.formula }).toEqual({ s, reading: "smiles", f });
      expect({ s, st: resolveStructure(s, "auto").kind }).toEqual({ s, st: "ok" });
    }
    const co = resolveMassSpec("Co", "auto");
    expect(co.kind === "ok" && co.reading).toBe("formula");
  });
});

describe("caps — re-measured inside jest for the widest elements (§B3)", () => {
  // Measured in jest on this machine (2026-10-14): Sn10000 74 ms, Hg 46, Xe 68,
  // Cd 36, Te 72, Se 40 — inside the 200 ms design target that set the cap. The
  // ASSERTION is the 4 s bound: a 200 ms assertion flakes under a parallel
  // full-suite run (the 600 ms → 5 s flake lesson), and 4 s still catches a
  // convolution that has gone quadratic in the count.
  it.each(["Sn", "Hg", "Xe", "Cd", "Te", "Se"])("%s at the per-element cap answers within 4 s", (el) => {
    const n = maxAtomsFor(el);
    expect(n).toBe(10000);
    isotopePattern({ [el]: 50 }); // warm the JIT
    const t0 = Date.now();
    const r = isotopePattern({ [el]: n });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.peaks.length).toBeGreaterThan(0);
  });

  it("several wide elements together are bounded by the work cap, refused BEFORE any work", () => {
    // The review's measurements: 10 × 5000 took 811 ms in jest, 33 × 1515 took 1.3 s in Node.
    const heavy = ["Sn", "Xe", "Te", "Cd", "Hg", "Mo", "Ba", "Nd", "Sm", "Gd"];
    for (const f of [
      "Sn10000Hg10000Xe10000Cd10000Te10000",
      heavy.map((e) => `${e}5000`).join(""),
      "SnXeTeCdHgMoBaNdSmGdDyErYbOsPtRuPdKrSeZnGeNiCaTiCrZrSrWHfCeSiS".replace(/([A-Z][a-z]?)/g, "$11515"),
    ]) {
      const t0 = Date.now();
      const r = resolveMassSpec(f, "auto");
      // Refused before any convolution: well inside the 4 s bound (≈ 1 ms idle).
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(r.kind).toBe("none");
      if (r.kind === "none") expect(r.message).toMatch(/million convolution steps — above the 40-million limit/);
    }
    // Just under the bound (≈ 31 M) it answers, inside the 4 s bound (≈ 85 ms idle, ≤ 0.65 s saturated).
    const t1 = Date.now();
    expect(resolveMassSpec("Sn6000Hg6000Xe6000", "auto").kind).toBe("ok");
    expect(Date.now() - t1).toBeLessThan(4000);
    const t0 = Date.now();
    expect(resolveMassSpec("Se10000Br10000S10000O10000Cl9999", "auto").kind).toBe("ok");
    expect(Date.now() - t0).toBeLessThan(4000);
    const over = resolveMassSpec("Sn10001", "auto");
    expect(over.kind).toBe("none");
    if (over.kind === "none") expect(over.message).toMatch(/10000-atom-per-element limit/);
  }, 30000);
});
