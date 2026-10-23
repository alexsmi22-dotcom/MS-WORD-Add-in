// Engine tests for src/lib/assayQuant.ts: standard-curve back-calculation,
// plates, Livak 2^−ΔΔCt and the Pfaffl ratio.
//
// EXPECTED VALUES COME FROM ONE OF THREE PLACES, never from memory:
//   [oracle]  scratchpad assayquant-oracle/oracle.py (Python 3, scipy 1.18.1,
//             statsmodels 0.15.0, numpy 2.5.4), run on the same inputs. It is an
//             INDEPENDENT implementation: statsmodels OLS; the classical
//             calibration interval found by brentq ROOT-FINDING on its defining
//             equation (the TS code uses the closed form); the 4PL by
//             scipy.optimize.curve_fit with pcov (absolute_sigma=False), its
//             inverse by brentq, and the delta method with a numerical gradient.
//   [L&S]     Livak & Schmittgen (2001) Methods 25:402–408, Table 1 (raw Cts and
//             the printed averages / ranges), read from the paper's PDF.
//   [Pfaffl]  Pfaffl (2001) Nucleic Acids Res 29:e45, Tables 2–3 (mean CPs,
//             efficiencies printed to 2 decimals, ratios R). PROVENANCE: these
//             numbers came through a web-fetch extraction of the OUP HTML page,
//             not a reading of the PDF; they are corroborated by two independent
//             ratios (TyrA, PyrB) agreeing with equation 1 within 0.1 %.
import {
  standardCurve,
  inverseFourPL,
  replicateStats,
  readPlate,
  parseLayout,
  analysePlate,
  readCtTable,
  livak,
  pfaffl,
  readDilutionSeries,
  efficiencyFromDilution,
  qNum,
  type StandardCurveOk,
  type LivakResult,
  type PlateRead,
  type CtTable,
  type EfficiencyFit,
  type PfafflResult,
} from "../assayQuant";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);
const std = (rows: [number, number[]][]) => rows.map(([conc, responses]) => ({ conc, responses }));

function ok<T extends { ok: boolean }>(r: T | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`refused: ${(r as { error: string }).error}`);
  return r as T;
}

// ------------------------------------------------------------ linear

const LIN_STDS = std([
  [0, [0.048, 0.052, 0.05]],
  [25, [0.118, 0.111, 0.115]],
  [50, [0.176, 0.183, 0.18]],
  [100, [0.309, 0.315, 0.305]],
  [200, [0.561, 0.549, 0.57]],
  [400, [1.058, 1.071, 1.049]],
]);
const LIN_UNK = [
  { name: "Sample 1", responses: [0.412, 0.405, 0.418] },
  { name: "Sample 2", responses: [0.231, 0.226, 0.236] },
  { name: "Sample 3", responses: [1.402, 1.389, 1.411] },
];
// [oracle] linear_default
const O_LIN = { slope: 0.0025208725038402447, intercept: 0.05327619047619045, s: 0.006642757626065255, r2: 0.9996724383937636 };

describe("linear standard curve [oracle]", () => {
  const r = ok(standardCurve(LIN_STDS, LIN_UNK, "linear")) as StandardCurveOk;
  it("fits every replicate point (n = 18, df = 16) to the oracle's OLS", () => {
    if (r.curve.model !== "linear") throw new Error("model");
    expect(r.curve.n).toBe(18);
    expect(r.curve.df).toBe(16);
    expect(rel(r.curve.slope, O_LIN.slope)).toBeLessThan(1e-12);
    expect(rel(r.curve.intercept, O_LIN.intercept)).toBeLessThan(1e-12);
    expect(rel(r.curve.s, O_LIN.s)).toBeLessThan(1e-10);
    expect(rel(r.curve.rsquared, O_LIN.r2)).toBeLessThan(1e-12);
  });
  it("replicate mean, SD and CV % match", () => {
    const u = r.unknowns[0].stats;
    expect(rel(u.mean, 0.4116666666666666)).toBeLessThan(1e-14);
    expect(rel(u.sd, 0.006506407098647689)).toBeLessThan(1e-12);
    expect(rel(u.cv, 1.5805037486593576)).toBeLessThan(1e-12);
  });
  it("back-calculates and gives the classical calibration interval (oracle: brentq on the defining equation)", () => {
    const [s1, s2] = r.unknowns;
    expect(s1.status).toBe("ok");
    expect(rel(s1.conc!, 142.16921944466114)).toBeLessThan(1e-12);
    expect(rel(s1.ci![0], 138.68443527594252)).toBeLessThan(1e-9);
    expect(rel(s1.ci![1], 145.65639718708096)).toBeLessThan(1e-9);
    expect(rel(s2.conc!, 70.5009115903596)).toBeLessThan(1e-12);
    expect(rel(s2.ci![0], 66.9665871575965)).toBeLessThan(1e-9);
    expect(rel(s2.ci![1], 74.02443654313547)).toBeLessThan(1e-9);
  });
  it("REFUSES to extrapolate: Sample 3 (oracle x0 = 534.5) is reported as above the highest standard, with no number", () => {
    const s3 = r.unknowns[2];
    expect(s3.status).toBe("above");
    expect(s3.conc).toBeUndefined();
    expect(s3.ci).toBeUndefined();
    expect(s3.message).toBe("above the highest standard (400); not extrapolated");
  });
  it("the zero standard is fitted but the range starts at the lowest NON-ZERO standard (25)", () => {
    expect(r.range).toEqual([25, 400]);
    expect(r.notes.join(" ")).toMatch(/zero standard is fitted/);
  });
  it("names its interval method", () => {
    expect(r.intervalMethod).toMatch(/classical calibration \(inverse-prediction\) interval/);
    expect(r.intervalMethod).toMatch(/t on 16 df/);
  });
});

describe("adversarial: an unknown JUST outside the range", () => {
  // y at x = 400 from the oracle's line, nudged by ±1e-9 response units.
  const yAt400 = O_LIN.intercept + O_LIN.slope * 400;
  it("1e-9 above the response at the highest standard → above, not a number", () => {
    const r = ok(standardCurve(LIN_STDS, [{ name: "edge", responses: [yAt400 + 1e-9] }], "linear")) as StandardCurveOk;
    expect(r.unknowns[0].status).toBe("above");
  });
  it("1e-9 below it → inside, read as ≈ 400", () => {
    const r = ok(standardCurve(LIN_STDS, [{ name: "edge", responses: [yAt400 - 1e-9] }], "linear")) as StandardCurveOk;
    expect(r.unknowns[0].status).toBe("ok");
    expect(Math.abs(r.unknowns[0].conc! - 400)).toBeLessThan(1e-5);
  });
  it("between the zero standard and the 25 standard → below the lowest standard (25)", () => {
    const y = O_LIN.intercept + O_LIN.slope * 10;
    const r = ok(standardCurve(LIN_STDS, [{ name: "low", responses: [y] }], "linear")) as StandardCurveOk;
    expect(r.unknowns[0].status).toBe("below");
    expect(r.unknowns[0].message).toBe("below the lowest standard (25); not extrapolated");
  });
});

describe("adversarial: a flat curve is refused, not inverted [oracle: flat]", () => {
  const FLAT = std([
    [0, [0.5, 0.52, 0.49]],
    [10, [0.51, 0.48, 0.5]],
    [20, [0.49, 0.51, 0.52]],
    [30, [0.52, 0.5, 0.48]],
    [40, [0.5, 0.49, 0.51]],
  ]);
  it("linear: no significant trend, with the slope t and p the oracle gives (t = −0.1299, p = 0.8987)", () => {
    const r = standardCurve(FLAT, [{ name: "x", responses: [0.5] }], "linear");
    expect(r.ok).toBe(false);
    const e = (r as { error: string }).error;
    expect(e).toMatch(/no significant trend/);
    expect(e).toContain("t = −0.13 on 13 df");
    expect(e).toContain("p = 0.9");
    expect(e).toContain("critical t = ±2.16"); // oracle tcrit 2.1603686564627913
  });
  it("linear: an exactly flat line (slope 0) is refused by name", () => {
    const r = standardCurve(std([[1, [1, 1]], [2, [1, 1]], [3, [1, 1]]]), [], "linear");
    expect((r as { error: string }).error).toMatch(/flat \(slope 0\)/);
  });
  it("4PL: flat standards have undetermined plateaus and are refused", () => {
    const r = standardCurve(FLAT, [{ name: "x", responses: [0.5] }], "4pl");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/plateaus are not determined|did not fit|not identifiable/);
  });
  it("4PL: a fit that runs out of iterations is refused, not reported (a step function never converges)", () => {
    const r = standardCurve(std([[1, [0, 0]], [2, [0, 0]], [3, [0, 0]], [4, [1, 1]], [5, [1, 1]]]), [], "4pl");
    expect((r as { error: string }).error).toMatch(/did not converge/);
  });
  it("4PL: scattered data with no sigmoid is refused (the optimiser drives the Hill slope to −73, where nothing is identifiable)", () => {
    const r = standardCurve(std([[1, [1, 0.2]], [2, [0.3, 1.1]], [4, [0.9, 0.1]], [8, [0.2, 1]], [16, [1, 0.3]]]), [], "4pl");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/not identifiable|plateaus are not determined|Hill slope/);
  });
  it("too few standards are refused by count", () => {
    expect((standardCurve(std([[1, [1]], [2, [2]]]), [], "linear") as { error: string }).error).toMatch(/at least 3 different standard concentrations; only 2 were given/);
    expect((standardCurve(LIN_STDS.slice(0, 4), [], "4pl") as { error: string }).error).toMatch(/at least 5/);
  });
  it("a negative standard concentration is refused", () => {
    expect((standardCurve(std([[-1, [1]], [2, [2]], [3, [3]]]), [], "linear") as { error: string }).error).toMatch(/negative/);
  });
});

// ------------------------------------------------------------ 4PL

// [oracle] p1_inputs: true curve B 0.06, T 2.4, EC50 110, h 1.05 + fixed noise, rounded to 3 dp.
const P1 = std([
  [0, [0.072, 0.052]],
  [7.8, [0.202, 0.186]],
  [15.6, [0.336, 0.323]],
  [31.25, [0.56, 0.543]],
  [62.5, [0.896, 0.887]],
  [125, [1.318, 1.306]],
  [250, [1.711, 1.696]],
  [500, [2.008, 1.999]],
]);
const P1_UNK = [
  { name: "U1", responses: [0.95, 0.97, 0.96] },
  { name: "U2", responses: [0.21, 0.2, 0.22] },
  { name: "Over top", responses: [2.9, 2.92, 2.88] },
  { name: "Low", responses: [0.1, 0.11, 0.105] },
];
// [oracle] p2_inputs: a DECREASING (competitive) curve, B 2.0, T 0.1, EC50 50, h 1.2.
const P2 = std([
  [1, [1.998, 1.973, 1.987]],
  [3, [1.925, 1.945, 1.939]],
  [10, [1.753, 1.77, 1.756]],
  [30, [1.341, 1.318, 1.337]],
  [100, [0.683, 0.668, 0.677]],
  [300, [0.294, 0.31, 0.289]],
  [1000, [0.157, 0.149, 0.144]],
]);
const P2_UNK = [
  { name: "D1", responses: [1.2, 1.18, 1.22] },
  { name: "Above bottom", responses: [2.4, 2.38, 2.42] },
  { name: "Past highest", responses: [0.13, 0.135, 0.128] },
];

describe("4PL standard curve vs scipy curve_fit [oracle: p1, p2]", () => {
  const r1 = ok(standardCurve(P1, P1_UNK, "4pl")) as StandardCurveOk;
  const r2 = ok(standardCurve(P2, P2_UNK, "4pl")) as StandardCurveOk;
  it("parameters and standard errors (increasing curve)", () => {
    if (r1.curve.model !== "4pl") throw new Error("model");
    const p = [r1.curve.bottom, r1.curve.top, r1.curve.ec50, r1.curve.hill];
    const O = [0.06130745773041921, 2.3932777918970634, 109.3599775321716, 1.0549020512216403];
    const OSE = [0.005557567174776106, 0.02180543112701571, 2.3359611956802637, 0.015500269242132592];
    p.forEach((v, i) => expect(rel(v, O[i])).toBeLessThan(1e-6));
    r1.curve.se.forEach((v, i) => expect(rel(v, OSE[i])).toBeLessThan(1e-5));
    expect(rel(r1.curve.s, 0.008620664685939729)).toBeLessThan(1e-8);
    expect(r1.curve.df).toBe(12);
  });
  it("parameters and standard errors (decreasing curve)", () => {
    if (r2.curve.model !== "4pl") throw new Error("model");
    const p = [r2.curve.bottom, r2.curve.top, r2.curve.ec50, r2.curve.hill];
    const O = [2.0019374484261103, 0.0984094936248143, 49.94317995624709, 1.196373211710763];
    const OSE = [0.004849029856444573, 0.006760547058353932, 0.5585796488301441, 0.014982303525514842];
    p.forEach((v, i) => expect(rel(v, O[i])).toBeLessThan(1e-6));
    r2.curve.se.forEach((v, i) => expect(rel(v, OSE[i])).toBeLessThan(1e-5));
  });
  it("inverse concentrations and delta-method 95 % CIs", () => {
    const [u1, u2] = r1.unknowns;
    expect(rel(u1.conc!, 70.25700597743769)).toBeLessThan(1e-6);
    expect(rel(u1.ci![0], 68.62087380399582)).toBeLessThan(1e-6);
    expect(rel(u1.ci![1], 71.89313815087955)).toBeLessThan(1e-6);
    expect(rel(u2.conc!, 8.565749674332231)).toBeLessThan(1e-6);
    expect(rel(u2.ci![0], 7.798985404057704)).toBeLessThan(1e-6);
    expect(rel(u2.ci![1], 9.33251394460676)).toBeLessThan(1e-6);
    const d1 = r2.unknowns[0];
    expect(rel(d1.conc!, 38.30258917955587)).toBeLessThan(1e-6);
    expect(rel(d1.ci![0], 37.316139144164794)).toBeLessThan(1e-6);
    expect(rel(d1.ci![1], 39.28903921494695)).toBeLessThan(1e-6);
    expect(r1.intervalMethod).toMatch(/delta method/);
  });
  it("adversarial: a response BEYOND an asymptote is refused by the asymptote's name", () => {
    const over = r1.unknowns[2];
    expect(over.status).toBe("beyond-asymptote");
    expect(over.conc).toBeUndefined();
    expect(over.message).toMatch(/^above the fitted top asymptote \(2\.393\): the curve never reaches this response/);
    // Decreasing curve: the high plateau is the BOTTOM parameter (x → 0).
    const ab = r2.unknowns[1];
    expect(ab.status).toBe("beyond-asymptote");
    expect(ab.message).toMatch(/^above the fitted bottom asymptote \(2\.002\)/);
  });
  it("adversarial: inside the asymptotes but outside the standards → not extrapolated (oracle x0 2.566 < 7.8; 1475 > 1000)", () => {
    expect(r1.unknowns[3].status).toBe("below");
    expect(r1.unknowns[3].message).toBe("below the lowest standard (7.8); not extrapolated");
    expect(r2.unknowns[2].status).toBe("above");
    expect(r2.unknowns[2].message).toBe("above the highest standard (1000); not extrapolated");
  });
  it("inverseFourPL is the exact inverse (closed form round trip) and NaN outside the asymptotes", () => {
    const y = 0.06 + (2.4 - 0.06) / (1 + Math.pow(110 / 37, 1.05));
    expect(rel(inverseFourPL(0.06, 2.4, 110, 1.05, y), 37)).toBeLessThan(1e-12);
    expect(inverseFourPL(0.06, 2.4, 110, 1.05, 2.4)).toBeNaN();
    expect(inverseFourPL(0.06, 2.4, 110, 1.05, 0.06)).toBeNaN();
  });
});

// ------------------------------------------------------------ plates

const HEAD96 = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
function plate96(fill: (row: number, col: number) => string): string {
  return [HEAD96, ..."ABCDEFGH".split("").map((L, r) => [L, ...Array.from({ length: 12 }, (_, c) => fill(r, c + 1))].join("\t"))].join("\n");
}

describe("readPlate", () => {
  it("reads a 96-well table with row letters and a column header", () => {
    const p = readPlate(plate96((r, c) => (r === 0 && c === 1 ? "1.5" : r === 7 && c === 12 ? "0,25" : ""))) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.rows).toBe(8);
    expect(p.cols).toBe(12);
    expect(p.wells.get("A1")).toBe(1.5);
    expect(p.wells.get("H12")).toBe(0.25); // decimal comma
    expect(p.wells.get("B2")).toBeNull();
    expect(p.wells.size).toBe(96);
  });
  it("adversarial: a 384-well (16 × 24) grid", () => {
    const head = ["", ...Array.from({ length: 24 }, (_, i) => String(i + 1))].join("\t");
    const body = "ABCDEFGHIJKLMNOP".split("").map((L, r) => [L, ...Array.from({ length: 24 }, (_, c) => String(r * 24 + c + 1))].join("\t"));
    const p = readPlate([head, ...body].join("\n")) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.rows * p.cols).toBe(384);
    expect(p.wells.get("P24")).toBe(384);
    expect(p.wells.get("I1")).toBe(193);
  });
  it("a bare 8 × 12 block with no labels is read from A1, and says so", () => {
    const text = Array.from({ length: 8 }, (_, r) => Array.from({ length: 12 }, (_, c) => String(r * 12 + c)).join(" ")).join("\n");
    const p = readPlate(text) as PlateRead;
    expect(p.wells.get("H12")).toBe(95);
    expect(p.notes.join(" ")).toMatch(/No row letters/);
  });
  it("rows absent from a lettered table are EMPTY, not shifted", () => {
    const text = [HEAD96, ["A", "1", ...Array(11).fill("")].join("\t"), ["C", "3", ...Array(11).fill("")].join("\t")].join("\n");
    const p = readPlate(text) as PlateRead;
    expect(p.wells.get("C1")).toBe(3);
    expect(p.wells.get("B1")).toBeNull();
    expect(p.notes.join(" ")).toMatch(/Rows B, D, E, F, G, H not in the table/);
  });
  it.each([
    ["11 columns", [["", ...Array.from({ length: 11 }, (_, i) => String(i + 1))].join("\t"), ["A", ...Array(11).fill("1")].join("\t")].join("\n"), /has 11 columns.*96-well plate has 12/],
    ["row past H on a 96", [HEAD96, ["I", ...Array(12).fill("1")].join("\t")].join("\n"), /Row I is past H/],
    ["duplicate row", [HEAD96, ["A", ...Array(12).fill("1")].join("\t"), ["A", ...Array(12).fill("1")].join("\t")].join("\n"), /Row A appears twice/],
    ["rows out of order", [HEAD96, ["B", ...Array(12).fill("1")].join("\t"), ["A", ...Array(12).fill("1")].join("\t")].join("\n"), /Row A comes after row B/],
    ["column header out of order", ["\t1\t2\t4\t3\t5\t6\t7\t8\t9\t10\t11\t12", ["A", ...Array(12).fill("1")].join("\t")].join("\n"), /header 3 reads 4/],
    ["text in a well", plate96((r, c) => (r === 2 && c === 5 ? "abc" : "1")), /Well C5 holds “abc”, which is not a number/],
    ["saturated well", plate96((r, c) => (r === 3 && c === 4 ? "OVER" : "1")), /Well D4 reads “OVER”: the detector saturated/],
    ["7 unlabelled rows", Array.from({ length: 7 }, () => Array(12).fill("1").join(" ")).join("\n"), /7 rows of 12 but no row letters/],
  ])("refuses a malformed grid by name: %s", (_n, text, re) => {
    const r = readPlate(text as string);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(re as RegExp);
  });
});

describe("parseLayout", () => {
  it("lines with ranges, blocks and single wells", () => {
    const g = parseLayout("std 100: A1-A3\nstd 50 ng/mL: B1:C2\nblank: H10 H11, H12\nSample 1: D4 - D6", 8, 12);
    if (!Array.isArray(g)) throw new Error(g.error);
    expect(g.find((x) => x.conc === 100)!.wells).toEqual(["A1", "A2", "A3"]);
    expect(g.find((x) => x.conc === 50)!.wells).toEqual(["B1", "B2", "C1", "C2"]);
    expect(g.find((x) => x.kind === "blank")!.wells).toEqual(["H10", "H11", "H12"]);
    expect(g.find((x) => x.name === "Sample 1")!.wells).toEqual(["D4", "D5", "D6"]);
  });
  it("a plate-shaped table of labels", () => {
    const grid = [HEAD96, ["A", "std 10", "std 10", "blank", "S1", ...Array(8).fill("")].join("\t")].join("\n");
    const g = parseLayout(grid, 8, 12);
    if (!Array.isArray(g)) throw new Error(g.error);
    expect(g.find((x) => x.kind === "standard")!.wells).toEqual(["A1", "A2"]);
    expect(g.find((x) => x.name === "S1")!.wells).toEqual(["A4"]);
  });
  it.each([
    ["a well twice", "std 1: A1-A3\nS1: A3", /Well A3 is assigned twice/],
    ["a well off the plate", "std 1: A13", /A13 is not on a 96-well plate/],
    ["a bad well token", "std 1: Z1", /“Z1” is not a well/],
    ["no standards", "blank: A1\nS1: B1", /names no standards/],
    ["unreadable concentration", "std abc: A1", /no readable concentration/],
    ["an ordinal standard name (Std1)", "Std1: A1-A2\nStd2: B1-B2", /“Std1” is ambiguous: a standard numbered 1, or a concentration of 1\?/],
  ])("refuses %s", (_n, text, re) => {
    const r = parseLayout(text as string, 8, 12);
    expect(Array.isArray(r)).toBe(false);
    expect((r as { error: string }).error).toMatch(re as RegExp);
  });
  it("“calibrator” is a sample name, not a standard", () => {
    const g = parseLayout("std 1: A1\ncalibrator: B1", 8, 12);
    if (!Array.isArray(g)) throw new Error(g.error);
    expect(g.find((x) => x.name === "calibrator")!.kind).toBe("sample");
  });
});

describe("analysePlate: blank subtraction, replicates, missing wells", () => {
  // Five standards in duplicate in columns 1–2, blanks in column 3, a sample in A4–A6.
  const vals: Record<string, string> = {
    A1: "0.15", A2: "0.17", B1: "0.35", B2: "0.33", C1: "0.55", C2: "0.57", D1: "0.75", D2: "0.73", E1: "0.95", E2: "",
    A3: "0.05", B3: "0.04", C3: "0.06", A4: "0.45", A5: "0.47", A6: "", H12: "9.9",
  };
  const text = plate96((r, c) => vals[`${"ABCDEFGH"[r]}${c}`] ?? "");
  const layout = "std 10: A1-A2\nstd 20: B1-B2\nstd 30: C1-C2\nstd 40: D1-D2\nstd 50: E1-E2\nblank: A3-C3\nS1: A4-A6";
  const a = analysePlate(text, layout, "linear");
  if (!a.ok) throw new Error(a.error);
  it("subtracts the blank mean (0.05) from every standard and sample well", () => {
    expect(a.blank!.mean).toBeCloseTo(0.05, 15);
    const s10 = a.groups.find((g) => g.conc === 10)!;
    expect(s10.corrected[0]).toBeCloseTo(0.1, 14);
    expect(s10.corrected[1]).toBeCloseTo(0.12, 14);
  });
  it("adversarial: empty assigned wells are named and left out of their group, not read as 0", () => {
    expect(a.groups.find((g) => g.conc === 50)!.corrected).toHaveLength(1);
    expect(a.groups.find((g) => g.name === "S1")!.corrected).toHaveLength(2);
    expect(a.notes.join(" ")).toMatch(/2 assigned wells are empty.*E2 \(std 50\), A6 \(S1\)/);
  });
  it("a reading outside the layout is reported, not used", () => {
    expect(a.notes.join(" ")).toMatch(/1 well holds a reading but is not in the layout, and is ignored: H12/);
  });
  it("feeds the standard curve: closed form, the corrected points lie on y = 0.02·x − 0.1 + noise-free", () => {
    // Corrected standards: 0.10/0.12, 0.30/0.28, 0.50/0.52, 0.70/0.68, 0.90 at 10…50.
    // Closed form OLS on these 9 points (hand-checkable): x̄ = 260/9, ȳ = 4.1/9.
    const xs = [10, 10, 20, 20, 30, 30, 40, 40, 50];
    const ys = [0.1, 0.12, 0.3, 0.28, 0.5, 0.52, 0.7, 0.68, 0.9];
    const mx = xs.reduce((p, v) => p + v, 0) / 9;
    const my = ys.reduce((p, v) => p + v, 0) / 9;
    let sxy = 0;
    let sxx = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i] - my);
      sxx += (x - mx) ** 2;
    });
    if (!a.curve.ok || a.curve.curve.model !== "linear") throw new Error("curve");
    expect(rel(a.curve.curve.slope, sxy / sxx)).toBeLessThan(1e-12);
    const s1 = a.curve.unknowns[0];
    expect(s1.stats.mean).toBeCloseTo(0.41, 14);
    const b = sxy / sxx;
    expect(rel(s1.conc!, (0.41 - (my - b * mx)) / b)).toBeLessThan(1e-12);
  });
  it("every blank well empty → refused", () => {
    const r = analysePlate(plate96((r, c) => (c === 3 ? "" : vals[`${"ABCDEFGH"[r]}${c}`] ?? "")), layout, "linear");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/Every blank well is empty/);
  });
});

// ------------------------------------------------------------ qPCR

// [L&S] Table 1: c-myc and GAPDH amplified in separate wells, six replicates each.
const LS_TABLE1 = [
  "Brain\tc-myc\t30.72\t30.34\t30.58\t30.34\t30.50\t30.43",
  "Brain\tGAPDH\t23.70\t23.56\t23.47\t23.65\t23.69\t23.68",
  "Kidney\tc-myc\t27.06\t27.03\t27.03\t27.10\t26.99\t26.94",
  "Kidney\tGAPDH\t22.76\t22.61\t22.62\t22.60\t22.61\t22.76",
].join("\n");

describe("Livak 2^−ΔΔCt: Livak & Schmittgen (2001) Table 1", () => {
  const t = readCtTable(LS_TABLE1) as CtTable;
  const r = ok(livak(t, "GAPDH", "Brain", "both")) as LivakResult;
  const brain = r.rows.find((x) => x.group === "Brain")!;
  const kidney = r.rows.find((x) => x.group === "Kidney")!;
  it("reproduces the paper's printed averages to the precision printed [L&S]", () => {
    expect(brain.targetCt.stats.mean.toFixed(2)).toBe("30.49");
    expect(brain.targetCt.stats.sd.toFixed(2)).toBe("0.15");
    expect(brain.refCt.stats.mean.toFixed(2)).toBe("23.63");
    expect(brain.refCt.stats.sd.toFixed(2)).toBe("0.09");
    expect(brain.dCt.toFixed(2)).toBe("6.86");
    expect(brain.dCtSD.toFixed(2)).toBe("0.17");
    expect(kidney.targetCt.stats.mean.toFixed(2)).toBe("27.03");
    expect(kidney.targetCt.stats.sd.toFixed(2)).toBe("0.06");
    expect(kidney.refCt.stats.mean.toFixed(2)).toBe("22.66");
    expect(kidney.refCt.stats.sd.toFixed(2)).toBe("0.08");
    expect(kidney.dCt.toFixed(2)).toBe("4.37");
    expect(kidney.dCtSD.toFixed(2)).toBe("0.10");
    expect(kidney.ddCt.toFixed(2)).toBe("-2.50");
    expect(kidney.ddCtSD.toFixed(2)).toBe("0.10");
    // "1.0 (0.9–1.1)" and "5.6 (5.3–6.0)".
    expect(brain.fold.toFixed(1)).toBe("1.0");
    expect(brain.foldLow.toFixed(1)).toBe("0.9");
    expect(brain.foldHigh.toFixed(1)).toBe("1.1");
    expect(kidney.fold.toFixed(1)).toBe("5.6");
    expect(kidney.foldLow.toFixed(1)).toBe("5.3");
    expect(kidney.foldHigh.toFixed(1)).toBe("6.0");
  });
  it("and the unrounded values agree with the oracle [oracle: livak_table1]", () => {
    expect(rel(kidney.dCtSD, 0.09544631999192062)).toBeLessThan(1e-12);
    expect(rel(kidney.fold, 5.6372830205680815)).toBeLessThan(1e-12);
    expect(rel(kidney.foldLow, 5.276399055034911)).toBeLessThan(1e-12);
    expect(rel(kidney.foldHigh, 6.022849963112755)).toBeLessThan(1e-12);
    expect(rel(brain.foldLow, 0.8864099513310567)).toBeLessThan(1e-12);
  });
  it("calibrator defined as 1 without error: ΔΔCt −2.50 ± 0.20, 5.6 with a range of 4.9 to 6.5 [L&S, text under Table 1]", () => {
    const p = ok(livak(t, "GAPDH", "Brain", "propagate")) as LivakResult;
    const k = p.rows.find((x) => x.group === "Kidney")!;
    expect(k.ddCtSD.toFixed(2)).toBe("0.20");
    expect(k.foldLow.toFixed(1)).toBe("4.9");
    expect(k.foldHigh.toFixed(1)).toBe("6.5");
    expect(rel(k.ddCtSD, 0.19841874911408966)).toBeLessThan(1e-12); // [oracle]
    expect(rel(k.foldLow, 4.912921715859259)).toBeLessThan(1e-12);
    const b = p.rows.find((x) => x.group === "Brain")!;
    expect(b.ddCtSD).toBe(0);
  });
});

describe("Livak adversarial: Undetermined, a varying reference gene, refusals", () => {
  const ADV = [
    "Ctrl\tIL6\t28.10\t28.25\tUndetermined",
    "Ctrl\tACTB\t17.02\t16.95\t17.10",
    "LPS\tIL6\t22.40\t22.31\t22.52",
    "LPS\tACTB\t18.30\t18.41\t18.22",
  ].join("\n");
  const t = readCtTable(ADV) as CtTable;
  it("an Undetermined Ct is dropped from its mean (never read as 40) and said so", () => {
    expect(t.records.filter((x) => x.ct === null)).toHaveLength(1);
    expect(t.notes.join(" ")).toMatch(/1 replicate is Undetermined .* not replaced with 40/);
    const r = ok(livak(t, "ACTB", "Ctrl")) as LivakResult;
    const c = r.rows.find((x) => x.group === "Ctrl")!;
    expect(c.targetCt.stats.n).toBe(2);
    expect(c.targetCt.undetermined).toBe(1);
    // [oracle: livak_adv]
    expect(rel(c.targetCt.stats.mean, 28.175)).toBeLessThan(1e-14);
    const l = r.rows.find((x) => x.group === "LPS")!;
    expect(rel(l.ddCt, -7.051666666666669)).toBeLessThan(1e-12);
    expect(rel(l.fold, 132.66708478386693)).toBeLessThan(1e-12);
    expect(rel(l.foldLow, 120.2205706199381)).toBeLessThan(1e-12);
    expect(rel(l.foldHigh, 146.40219468506461)).toBeLessThan(1e-12);
  });
  it("a reference gene that varies is measured (ACTB +1.29 cycles in LPS)", () => {
    const r = ok(livak(t, "ACTB", "Ctrl")) as LivakResult;
    expect(r.refShift[0].group).toBe("LPS");
    expect(r.refShift[0].shift).toBeCloseTo(18.31 - 17.023333333333333, 12);
  });
  it("a group whose every target replicate is Undetermined is skipped BY NAME, the others still computed", () => {
    const t2 = readCtTable(ADV + "\nNTC\tIL6\tUndetermined\tUndetermined\nNTC\tACTB\tUndetermined") as CtTable;
    const r = ok(livak(t2, "ACTB", "Ctrl")) as LivakResult;
    expect(r.skipped.join(" ")).toMatch(/NTC, IL6: every IL6 replicate is Undetermined/);
    expect(r.rows.some((x) => x.group === "NTC")).toBe(false);
    expect(r.rows.some((x) => x.group === "LPS")).toBe(true);
  });
  it("Undetermined in the control's reference → refused", () => {
    const t3 = readCtTable("C\tG\t20\t20.1\nC\tR\tUndetermined\tN/A\nT\tG\t19\t19.2\nT\tR\t15\t15.1") as CtTable;
    expect((livak(t3, "R", "C") as { error: string }).error).toMatch(/reference gene R has no Ct in the control group C/);
  });
  it("names that are not in the table are refused with the names that are", () => {
    expect((livak(t, "GAPDH", "Ctrl") as { error: string }).error).toBe("No reference gene named “GAPDH” in the table; it has “IL6”, “ACTB”.");
    expect((livak(t, "ACTB", "Control") as { error: string }).error).toMatch(/No control group named “Control”/);
  });
  it("a Ct of 40 is a NUMBER, not Undetermined; text that is neither is refused", () => {
    const t4 = readCtTable("C\tG\t40\t39.8") as CtTable;
    expect(t4.records.map((x) => x.ct)).toEqual([40, 39.8]);
    expect((readCtTable("C\tG\t40\tlate") as { error: string }).error).toMatch(/“late” is not a Ct/);
    expect((readCtTable("C\tG\t-3") as { error: string }).error).toMatch(/not a cycle number/);
  });
  it("a long instrument export: Sample / Target / Ct with a Ct Mean summary column ignored", () => {
    const text = [
      "Well\tSample Name\tTarget Name\tCT\tCt Mean",
      "A1\tCtrl\tIL6\t28.10\t28.18",
      "A2\tCtrl\tIL6\tUndetermined\t28.18",
      "A3\tCtrl\tIL6\t28.25\t28.18",
      "B1\tCtrl\tACTB\t17.02\t17.02",
    ].join("\n");
    const t5 = readCtTable(text) as CtTable;
    expect(t5.ok).toBe(true);
    expect(t5.records).toHaveLength(4);
    expect(t5.notes.join(" ")).toMatch(/Summary columns ignored .*Ct Mean/);
  });
  it("typed text with two-word “No Ct” and blanks", () => {
    const t6 = readCtTable("Ctrl GAPDH 18.1 No Ct 18.3") as CtTable;
    expect(t6.records.map((x) => x.ct)).toEqual([18.1, null, 18.3]);
  });
});

// ------------------------------------------------------------ Pfaffl

describe("PCR efficiency from a dilution series [oracle: pfaffl_default, scipy linregress]", () => {
  const TD = "1\t20.11\t20.05\t20.17\n0.1\t23.49\t23.55\t23.44\n0.01\t26.90\t26.82\t26.95\n0.001\t30.31\t30.22\t30.36";
  const e = ok(efficiencyFromDilution(readDilutionSeries(TD, "Target") as never, "Target")) as EfficiencyFit;
  it("slope, R², E = 10^(−1/slope) and efficiency %", () => {
    expect(rel(e.slope, -3.395666666666666)).toBeLessThan(1e-12);
    expect(rel(e.rsquared, 0.9998130341841741)).toBeLessThan(1e-12);
    expect(rel(e.E, 1.9701213673006377)).toBeLessThan(1e-12);
    expect(rel(e.efficiencyPct, 97.01213673006377)).toBeLessThan(1e-11);
    expect(e.n).toBe(12);
  });
  it("closed form: a slope of exactly −log2(10) cycles per decade is E = 2, 100 %", () => {
    const s = -1 / Math.log10(2); // −3.3219…
    const series = [1, 0.1, 0.01, 0.001].map((a, i) => ({ amount: a, cts: [20 - s * 0 + -s * i] }));
    const f = ok(efficiencyFromDilution(series, "x")) as EfficiencyFit;
    expect(f.E).toBeCloseTo(2, 12);
    expect(f.efficiencyPct).toBeCloseTo(100, 10);
  });
  it("input amounts: 1:10 and 1/100 notation", () => {
    // Through the public reader (Release D: the amount forms are peeled inside readDilutionSeries).
    const r = readDilutionSeries(["1:10\t20.1", "1/100\t23.5", "10^-3\t26.9"].join("\n"), "T") as { amount: number }[];
    expect(r[0].amount).toBe(0.1);
    expect(r[1].amount).toBe(0.01);
    expect(r[2].amount).toBeCloseTo(0.001, 15);
  });
  it("adversarial: dilution FACTORS (Ct rising with the number) are refused by name", () => {
    const r = efficiencyFromDilution(readDilutionSeries("1\t20.1\n10\t23.5\n100\t26.9", "T") as never, "Target");
    expect((r as { error: string }).error).toMatch(/Ct rises with the input amount .*enter the relative amounts/);
  });
  it("adversarial: an efficiency outside 80–120 % is refused (slope −2.5 → E = 10^0.4 = 2.512, 151 %)", () => {
    const series = [1, 0.1, 0.01].map((a, i) => ({ amount: a, cts: [20 + 2.5 * i] }));
    const r = efficiencyFromDilution(series, "Target");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/efficiency 151 % \(E = 2\.51, slope −2\.5\) is outside the 80–120 % window/);
  });
  it("80–90 % is accepted with a warning (slope −3.9 → E = 10^(1/3.9) = 1.806, 80.6 %)", () => {
    const series = [1, 0.1, 0.01].map((a, i) => ({ amount: a, cts: [20 + 3.9 * i] }));
    const r = ok(efficiencyFromDilution(series, "Target")) as EfficiencyFit;
    expect(rel(r.E, Math.pow(10, 1 / 3.9))).toBeLessThan(1e-12);
    expect(r.warnings.join(" ")).toMatch(/outside the 90–110 % range commonly cited/);
  });
  it("fewer than 3 dilutions are refused", () => {
    expect((efficiencyFromDilution([{ amount: 1, cts: [20] }, { amount: 0.1, cts: [23.3] }], "T") as { error: string }).error).toMatch(/at least 3 different dilutions/);
  });
});

describe("Pfaffl ratio", () => {
  it("the default case agrees with the oracle (ratio 5.383415330955257)", () => {
    const t = readCtTable(LS_TABLE1) as CtTable;
    const r = ok(pfaffl(t, "", "GAPDH", "Brain", 1.9701213673006377, 1.987601682068499)) as PfafflResult;
    const k = r.rows.find((x) => x.group === "Kidney")!;
    expect(rel(k.dCtTarget, 3.460000000000001)).toBeLessThan(1e-12);
    expect(rel(k.dCtRef, 0.9649999999999999)).toBeLessThan(1e-12);
    expect(rel(k.ratio, 5.383415330955257)).toBeLessThan(1e-12);
    expect(r.target).toBe("c-myc");
  });
  it("reproduces Pfaffl (2001) Table 3 to the precision his 2-decimal efficiencies allow (≤ 0.2 %) [Pfaffl]", () => {
    // Table 2, 20 ng: TyrA control 20.303 / sample 15.020, PyrB 11.720 / 16.031,
    // reference Gst 14.277 / 14.533; E(TyrA) 2.09, E(PyrB) 2.16, E(Gst) 1.99.
    // Table 3 prints R = 58.625 (TyrA) and 0.04312 (PyrB).
    const t = readCtTable(
      ["control\tTyrA\t20.303", "sample\tTyrA\t15.020", "control\tGst\t14.277", "sample\tGst\t14.533", "control\tPyrB\t11.720", "sample\tPyrB\t16.031"].join("\n"),
    ) as CtTable;
    const ty = ok(pfaffl(t, "TyrA", "Gst", "control", 2.09, 1.99)) as PfafflResult;
    expect(rel(ty.rows.find((x) => x.group === "sample")!.ratio, 58.625)).toBeLessThan(0.002);
    const py = ok(pfaffl(t, "PyrB", "Gst", "control", 2.16, 1.99)) as PfafflResult;
    expect(rel(py.rows.find((x) => x.group === "sample")!.ratio, 0.04312)).toBeLessThan(0.002);
  });
  it("several targets and none named → refused, asking which", () => {
    const t = readCtTable("c\tA\t20\nc\tB\t21\nc\tR\t15\ns\tA\t19\ns\tB\t20\ns\tR\t15") as CtTable;
    expect((pfaffl(t, "", "R", "c", 2, 2) as { error: string }).error).toMatch(/2 target genes \(A, B\); name the one/);
  });
});

describe("number formatting for messages", () => {
  it("qNum: U+2212, no e-notation", () => {
    expect(qNum(-2.5)).toBe("−2.5");
    expect(qNum(1.5e-7)).toBe("1.5×10⁻⁷");
    expect(qNum(2.4e7, 3)).toBe("2.4×10⁷");
  });
  it("replicateStats: one value has no SD", () => {
    const s = replicateStats([3]);
    expect(s.sd).toBeNaN();
    expect(s.cv).toBeNaN();
  });
});
