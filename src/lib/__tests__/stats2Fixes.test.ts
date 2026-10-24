// Stats & Bio/Assay fix round 2 (2026-10-24). Each block pins one confirmed defect from the reviewer's pass.
//
// Oracles (C:\Users\AlexanderSmith\jurislab-oracle-venv, scipy 1.x + lifelines):
//   from scipy.stats import chi2_contingency
//   chi2_contingency([[30,20],[25,25]], correction=False)           -> 1.0101010101, p 0.3148786413
//   from lifelines.statistics import multivariate_logrank_test
//   multivariate_logrank_test(T, G, E) on the 3-group case below    -> 5.209718202568894, p 0.07391355078827605
//   multivariate_logrank_test on the 2-group default                -> 0.3225997960476417, p 0.5700494357172122
//   KaplanMeierFitter().fit(t, e).confidence_interval_ (log-log)    -> rows in KM_LIFELINES below
//   scipy.optimize.curve_fit, competitive model, default × 1e-9    -> Km 5.0091e-9, Ki 2.4810e-9 (fit is scale-free)
import * as fs from "fs";
import * as path from "path";
import { fitInhibition, inhibitionRefusal, type InhibitionFit } from "../assay";
import { chiSquareGoodnessOfFit, chiSquareIndependence, fisherExact2x2 } from "../stats2";
import { feedRows } from "../tableFeed";
import { feedTable } from "../tableFeed";
import {
  catalyticEfficiencyCalc,
  dilutionRefusal,
  proteinSequenceRefusal,
  readAssayScalar,
  readAssayScalars,
  serialRefusal,
} from "../assayInputs";
import { insertableResultText } from "../insertGate";
import { displayFormula, droppedTokensNote, lineEquation, nbspSeparators, regressionReport } from "../statsDisplay";
import { polynomialRegression, multipleRegression } from "../regression";
import { assaySig } from "../assayFormat";
import { kaplanMeier, logLogCI, logRankTest, readSurvivalRows, survivalCensorMarks, survivalCurvePoints } from "../survival";
import { rmAnovaCalc } from "../statsBatchCalcs";
import { kaplanMeierSvg } from "../survivalFigure";
import { twoSampleTTest } from "../stats";
import { bracketsFromPairwise, bracketLegend } from "../sigBrackets";
import { ASSAY_QUANT_CALCS } from "../assayQuantCalcs";
import { readNumberList } from "../numberList";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const assayBlock = PANE.slice(PANE.indexOf('id: "chengprusoff"'), PANE.indexOf('id: "stoich"'));

// ---------------------------------------------------------------------------------------------------------------
describe("1. inhibition fit: molar data, convergence refusal", () => {
  const S = [1, 2, 5, 10, 20, 1, 2, 5, 10, 20];
  const I = [0, 0, 0, 0, 0, 5, 5, 5, 5, 5];
  const V = [1.67, 2.86, 5.0, 6.67, 8.0, 0.62, 1.11, 2.5, 4.0, 5.71];
  test.each([1, 1e-3, 1e-6, 1e-9, 1e-12, 1e6])("competitive at scale %p: Km 5.009, Ki 2.481 (× scale)", (sc) => {
    const f = fitInhibition(S.map((x) => x * sc), I.map((x) => x * sc), V, "competitive")!;
    expect(inhibitionRefusal(f)).toBeNull();
    expect(f.km / sc).toBeCloseTo(5.0091, 3);
    expect(f.ki / sc).toBeCloseTo(2.481, 3);
    expect(f.vmax).toBeCloseTo(10.011, 3);
    expect(f.se[2] / sc).toBeCloseTo(0.031374, 4); // the SE scales with the constant
  });
  test("molar default ×1e-9 prints Km 5.009×10⁻⁹ and Ki 2.481×10⁻⁹", () => {
    const f = fitInhibition(S.map((x) => x * 1e-9), I.map((x) => x * 1e-9), V, "competitive")!;
    expect(assaySig(f.km)).toBe("5.009×10⁻⁹");
    expect(assaySig(f.ki)).toBe("2.481×10⁻⁹");
  });
  test("mixed on competitive data: Ki′ runs away → refused, pointing at the simpler modes", () => {
    const f = fitInhibition(S.map((x) => x * 1e-9), I.map((x) => x * 1e-9), V, "mixed");
    const msg = inhibitionRefusal(f);
    expect(msg).toMatch(/Competitive/);
  });
  test("a converged fit with a negative constant is refused", () => {
    const fake = { converged: true, vmax: 10, km: 5, ki: -3, kiPrime: NaN, mode: "competitive" } as unknown as InhibitionFit;
    expect(inhibitionRefusal(fake)).toMatch(/positive/);
    expect(inhibitionRefusal({ ...fake, ki: 3, converged: false } as InhibitionFit)).toMatch(/did not converge/);
  });
  test("the pane refuses through inhibitionRefusal and prints Ki′, not Ki-prime", () => {
    expect(PANE).toMatch(/const refusal = inhibitionRefusal\(fit\);/);
    expect(PANE).not.toMatch(/Ki-prime =/);
    expect(PANE).toMatch(/`Ki′ = \$\{assayValSE\(fit\.kiPrime/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("2. chi-square: zero expected, zero margins, negative counts", () => {
  test("goodness of fit: expected 0 with observed > 0 is refused (was skipped but counted in df)", () => {
    const r = chiSquareGoodnessOfFit([5, 5], [10, 0]);
    expect(r.reason).toMatch(/expected count of 0/);
    expect(Number.isNaN(r.p)).toBe(true);
  });
  test("goodness of fit: negative observed refused", () => {
    expect(chiSquareGoodnessOfFit([5, -1, 3], [7 / 3, 7 / 3, 7 / 3]).reason).toMatch(/negative/);
  });
  test("goodness of fit: a 0/0 category is not counted in df", () => {
    const r = chiSquareGoodnessOfFit([5, 5, 0], [5, 5, 0]);
    expect(r.reason).toBeUndefined();
    expect(r.df).toBe(1);
    expect(r.chi2).toBe(0);
  });
  test("independence: a zero row margin is refused", () => {
    expect(chiSquareIndependence([[0, 0], [3, 4]]).reason).toMatch(/Row 1 has no observations/);
    expect(chiSquareIndependence([[0, 2], [0, 4]]).reason).toMatch(/Column 1 has no observations/);
  });
  test("independence: negative counts refused", () => {
    expect(chiSquareIndependence([[3, -1], [2, 4]]).reason).toMatch(/negative/);
  });
  test("Fisher on a zero-margin table: no test (was p = 1)", () => {
    expect(fisherExact2x2([[0, 0], [3, 4]])).toBeUndefined();
    expect(fisherExact2x2([[0, 5], [0, 4]])).toBeUndefined();
    expect(fisherExact2x2([[3, 1], [1, 3]])).toBeCloseTo(0.4857, 4); // the tea-tasting table still works
  });
  test("an ordinary 2×2 still matches scipy", () => {
    const r = chiSquareIndependence([[30, 20], [25, 25]]);
    expect(r.chi2).toBeCloseTo(1.0101010101, 8);
    expect(r.p).toBeCloseTo(0.3148786413, 6);
  });
  test("the chiind pane checks the engine's reason", () => {
    const at = PANE.indexOf("const res = chiSquareIndependence(table);");
    expect(PANE.slice(at, at + 200)).toMatch(/if \(res\.reason\) return \{ text: res\.reason, ok: false \}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("3. table feed counts: Total rows/columns are not data", () => {
  const p2x2 = (txt: string): number[][] => txt.split("\n").map((l) => l.split(" ").map(Number));
  test("labelled Total row and column dropped → the 2×2, df 1", () => {
    const f = feedRows(
      [
        ["", "Yes", "No", "Total"],
        ["A", "30", "20", "50"],
        ["B", "25", "25", "50"],
        ["Total", "55", "45", "100"],
      ],
      "counts",
    );
    if ("error" in f) throw new Error(f.error);
    expect(p2x2(f.text)).toEqual([[30, 20], [25, 25]]);
    expect(f.note).toMatch(/Marginal totals are not data/);
    const r = chiSquareIndependence(p2x2(f.text));
    expect(r.df).toBe(1);
    expect(r.p).toBeCloseTo(0.3148786413, 6);
  });
  test.each(["Sum", "ALL", "total", "Grand total"])("label %p is a margin", (lab) => {
    const f = feedRows([["", "x", "y"], ["a", "3", "4"], ["b", "5", "6"], [lab, "8", "10"]], "counts");
    if ("error" in f) throw new Error(f.error);
    expect(f.text).toBe("3 4\n5 6");
  });
  test("unlabelled: a last row and column equal to the sums of the others are dropped (and said)", () => {
    const f = feedRows([["30", "20", "50"], ["25", "25", "50"], ["55", "45", "100"]], "counts");
    if ("error" in f) throw new Error(f.error);
    expect(f.text).toBe("30 20\n25 25");
    expect(f.note).toMatch(/equals the sum of the rows above/);
    expect(f.note).toMatch(/equals the sum of the columns before/);
  });
  test("a 2-row table whose rows happen to be equal is NOT a margin", () => {
    const f = feedRows([["5", "5"], ["5", "5"]], "counts");
    if ("error" in f) throw new Error(f.error);
    expect(f.text).toBe("5 5\n5 5");
  });
  test("ND / n.d. are blanks, like the other placeholders", () => {
    const f = feedTable("groups", [["A", "B"], ["1.2", "2.2"], ["ND", "2.4"], ["1.5", "n.d."], ["1.1", "2.9"]]);
    if ("error" in f) throw new Error(f.error);
    expect(f.text.split(/\n\s*\n/)[0].split(/,\s*/).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("4/9. assay single values: validation and decimal commas", () => {
  test.each([
    ["0,001", 0.001],
    ["2,5", 2.5],
    ["−3", -3],
    ["1.5×10⁻³", 0.0015],
    ["1e-3", 0.001],
  ])("%p reads as %p", (t, v) => {
    const r = readAssayScalar(t, "x");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(v, 12);
  });
  test.each(["1,250", "12,500"])("%p is ambiguous → refused by name", (t) => {
    const r = readAssayScalar(t, "[Enzyme]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/);
  });
  test("two grouping commas can only be grouping: refused, offering the plain number", () => {
    const r = readAssayScalar("1,000,000", "[Enzyme]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type it without them \(1000000\)/);
  });
  test("a non-number is named, never a bare dash", () => {
    const r = readAssayScalar("abc", "A260");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("A260: “abc” is not a number.");
  });
  test("signs: negative A260 refused; zero ε refused", () => {
    const rd = (o: Record<string, string>) => (k: string) => o[k];
    const a = readAssayScalars(rd({ a: "-0.2" }), [{ key: "a", label: "A260", sign: "nonneg" }]);
    expect(a.ok).toBe(false);
    const e = readAssayScalars(rd({ e: "0" }), [{ key: "e", label: "ε", sign: "positive" }]);
    expect(e.ok).toBe(false);
  });
  test("dilution C2 > C1 refused; equal allowed", () => {
    expect(dilutionRefusal(0.1, 1)).toMatch(/impossible/);
    expect(dilutionRefusal(1, 1)).toBeNull();
  });
  test.each([
    [1, 5, /does not dilute/],
    [0.5, 3, /not a dilution/],
    [2, 2.5, /whole number/],
    [10, 0, /whole number/],
  ])("serial fold %p, n %p refused", (fold, n, re) => {
    expect(serialRefusal(fold as number, n as number)).toMatch(re as RegExp);
  });
  test("serial 10-fold × 6 is fine", () => expect(serialRefusal(10, 6)).toBeNull());
  test("protein sequence with B/Z/X/digits refused, naming them", () => {
    const m = proteinSequenceRefusal("MKWZXB1");
    expect(m).toMatch(/“Z”/);
    expect(m).toMatch(/“X”/);
    expect(m).toMatch(/“B”/);
    expect(proteinSequenceRefusal("mkw ycw yy")).toBeNull();
    expect(proteinSequenceRefusal(">sp|P1\nMKWV TFIS\nLLFL")).toBeNull();
    expect(proteinSequenceRefusal("1 mkwvtfisll 11 fssayrg")).toBeNull();
    expect(proteinSequenceRefusal("MKW1YY")).toMatch(/digits/);
  });
  test("every closed-form assay calc reads its fields once through readAssayScalars (no +r(...))", () => {
    expect(assayBlock.length).toBeGreaterThan(1000);
    expect(assayBlock).not.toMatch(/\+r\("/);
    for (const id of ["beer", "dilution", "serial", "na260", "protein280", "hh", "bufferratio", "efficiency"]) {
      const at = assayBlock.indexOf(`id: "${id}"`);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(assayBlock.slice(at, at + 4000)).toMatch(/readAssayScalars\(r, \[/);
    }
    expect(assayBlock).toMatch(/dilutionRefusal\(/);
    expect(assayBlock).toMatch(/serialRefusal\(/);
    expect(assayBlock).toMatch(/proteinSequenceRefusal\(seq\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("5. catalytic efficiency: units", () => {
  test("µM/s, µM, µM: kcat 12000 s⁻¹, kcat/Km 1.5×10⁹ M⁻¹ s⁻¹, compared with the limit", () => {
    const o = catalyticEfficiencyCalc({ vmax: 12, vmaxUnit: "uM/s", e: 0.001, eUnit: "uM", km: 8, kmUnit: "uM" });
    expect(o.ok).toBe(true);
    expect(o.text).toMatch(/kcat = 12000 s⁻¹/);
    expect(o.text).toMatch(/kcat\/Km = 1\.5×10⁹ M⁻¹ s⁻¹/);
    expect(o.text).toMatch(/diffusion limit/);
    expect(o.svg).toMatch(/diffusion limit/);
    expect(insertableResultText(o.text)).toBe(true);
  });
  test("per minute converts: 60 µM/min = 1 µM/s", () => {
    const o = catalyticEfficiencyCalc({ vmax: 60, vmaxUnit: "uM/min", e: 1, eUnit: "uM", km: 1, kmUnit: "mM" });
    expect(o.text).toMatch(/kcat = 1 s⁻¹/);
    expect(o.text).toMatch(/kcat\/Km = 1000 M⁻¹ s⁻¹/);
  });
  test("units not stated: no M⁻¹ s⁻¹ claim, no diffusion comparison, still a figure", () => {
    const o = catalyticEfficiencyCalc({ vmax: 12, vmaxUnit: "", e: 0.001, eUnit: "", km: 8, kmUnit: "" });
    expect(o.text).not.toMatch(/M⁻¹ s⁻¹ *$/m);
    expect(o.text).toMatch(/in your units/);
    expect(o.svg).toBeDefined();
    expect(o.svg).not.toMatch(/diffusion/);
  });
  test("zero enzyme refused", () => {
    expect(catalyticEfficiencyCalc({ vmax: 12, vmaxUnit: "", e: 0, eUnit: "", km: 8, kmUnit: "" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("6. the ignored-token warning does not trip the insert gate", () => {
  test("an echoed NaN token is quoted", () => {
    const note = droppedTokensNote(["NaN"]);
    expect(note).toMatch(/"NaN"/);
    expect(insertableResultText(`Mean = 2\n\n${note}`)).toBe(true);
    expect(insertableResultText(`Mean = NaN\n\n${note}`)).toBe(false); // a real NaN still blocks
  });
  test("the pane builds the warning with droppedTokensNote", () => {
    expect(PANE).toMatch(/droppedTokensNote\(dropped\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("7. rounding noise and display", () => {
  test("polynomial regression on exact data: exact fit, SE 0, t and F undefined, insertable", () => {
    const pr = polynomialRegression([1, 2, 3, 4, 5], [1, 8, 27, 64, 125], 3);
    expect(pr.exactFit).toBe(true);
    expect(pr.residualStandardError).toBe(0);
    const text = regressionReport(pr);
    expect(text).toMatch(/exact fit: SE 0; t and F undefined/);
    expect(text).not.toMatch(/10¹⁵|10³⁰|10⁻¹⁴/);
    expect(insertableResultText(text)).toBe(true);
  });
  test("noisy data is not an exact fit", () => {
    const r = multipleRegression([2.2, 4.1, 7.3, 11.8, 17.5], [[1, 2, 3, 4, 5]]);
    expect(r.exactFit).toBeUndefined();
    expect(regressionReport(r)).toMatch(/Overall F\(1, 3\)/);
  });
  test("polynomial note and cap agree with the dropdown (4)", () => {
    const pr = polynomialRegression([1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 2, 5, 4, 6, 8, 7], 6);
    expect(pr.degree).toBe(4);
    expect(pr.caveats.join(" ")).toMatch(/Degree 4 is the maximum offered/);
  });
  test("line equation: sign in the operator, ×10ⁿ", () => {
    expect(lineEquation(1.98, -1.98e9)).toBe("y = 1.98x − 1.98×10⁹");
    expect(lineEquation(2, 0.5)).toBe("y = 2x + 0.5");
    expect(lineEquation(-2, 0)).toBe("y = −2x");
  });
  test("assaySig: huge values as ×10ⁿ, never a 21-digit integer", () => {
    expect(assaySig(1e20)).toBe("1×10²⁰");
    expect(assaySig(-1.98e9)).toBe("−1.98×10⁹");
    expect(assaySig(1200000, 2)).toBe("1200000");
    expect(assaySig(12000)).toBe("12000");
  });
  test("uncertainty formula as displayed", () => {
    expect(displayFormula("a^2")).toBe("a²");
    expect(displayFormula("a*b/c")).toBe("a·b/c");
  });
  test("standard curve on exact data: residual SD 0, said to be exact", () => {
    const calc = ASSAY_QUANT_CALCS.find((c) => c.id === "stdcurve")!;
    const f: Record<string, string> = { model: "linear", stds: "0\t0\n10\t5\n20\t10\n30\t15", unk: "S1\t12.5", unit: "" };
    const out = calc.compute((k) => f[k] ?? "");
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/residual SD = 0 \(exact fit/);
    expect(out.text).not.toMatch(/10⁻¹[5-9]/);
  });
  test("pane strings: Cohen's d true minus, [A⁻]/[HA], log₁₀, ×, pIC50, Vₘ", () => {
    expect(PANE).toMatch(/Cohen's d = \$\{trueMinus\(String\(d\)\)\}/);
    expect(assayBlock).not.toMatch(/\[A-\]/);
    expect(assayBlock).not.toMatch(/"[^"\n]*log10\(/); // in a display string (Math.log10 is code)
    expect(assayBlock).toMatch(/xlabel: "log₁₀\(\[A⁻\]\/\[HA\]\)"/);
    expect(assayBlock).not.toMatch(/ x\$\{eps\.counts/);
    expect(assayBlock).not.toMatch(/" x " \+/);
    expect(PANE).toMatch(/`p\$\{label\} = \$\{assaySig\(fit\.pEC50, 3\)\}/);
    expect(PANE).toMatch(/out = \{ \.\.\.out, text: out\.text\.replace\(\/\\bV_m\\b\/g, "Vₘ"\) \};/);
    expect(PANE).not.toMatch(/(?:Friedman|subjects)[^\n`]*\} x \$\{/); // × for multiplication in titles
    expect(PANE).toMatch(/\$\{lineEquation\(res\.slope, res\.intercept\)\}/);
    expect(PANE).toMatch(/\$\{displayFormula\(formula\)\} = /);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("8. Kaplan–Meier: log-log CI, censored tail, fixed axis, censor ticks; exact k-group log-rank", () => {
  const D = "5 1\n6 1\n6 0\n8 1\n10 0\n12 1\n15 0\n18 1\n20 0\n24 0".split("\n").map((l) => l.split(" ").map(Number));
  const km = kaplanMeier(D.map((r) => r[0]), D.map((r) => r[1]));
  // lifelines KaplanMeierFitter, default (log-log) interval.
  const KM_LIFELINES: [number, number, number, number][] = [
    [5, 0.9, 0.473009, 0.985281],
    [6, 0.8, 0.408691, 0.945873],
    [8, 0.685714, 0.304585, 0.887148],
    [10, 0.685714, 0.304585, 0.887148],
    [12, 0.548571, 0.187256, 0.806377],
    [18, 0.365714, 0.064242, 0.691703],
    [24, 0.365714, 0.064242, 0.691703],
  ];
  test.each(KM_LIFELINES)("t = %p: S %p, CI [%p, %p] as lifelines", (t, s, lo, hi) => {
    const p = km.points.find((q) => q.time === t)!;
    expect(p.survival).toBeCloseTo(s, 5);
    expect(p.ci95[0]).toBeCloseTo(lo, 5);
    expect(p.ci95[1]).toBeCloseTo(hi, 5);
  });
  test("log-log CI edges: S = 1 → [1, 1]; S = 0 → none", () => {
    expect(logLogCI(1, 0)).toEqual([1, 1]);
    expect(logLogCI(0, Infinity).every(Number.isNaN)).toBe(true);
  });
  test("the curve runs to the last follow-up (24, censored), flat", () => {
    const pts = survivalCurvePoints(km);
    expect(pts[pts.length - 1]).toEqual({ x: 24, y: pts[pts.length - 2].y });
  });
  test("censor marks at each censoring time, on the curve", () => {
    const m = survivalCensorMarks(km);
    expect(m.map((q) => q.x)).toEqual([6, 10, 15, 20, 24]);
    expect(m[0].y).toBeCloseTo(0.8, 10);
  });
  test("the figure: y axis 0 to 1, + ticks, a censored legend entry", () => {
    const svg = kaplanMeierSvg([{ km, label: "S(t)" }], { title: "Kaplan-Meier" });
    expect(svg).toMatch(/>0<\/text>/);
    expect(svg).toMatch(/>1\.00<\/text>/);
    expect(svg).toMatch(/>25<\/text>/); // the axis reaches past the last censored time, so its tick is not clipped
    expect(svg).toMatch(/>censored<\/text>/);
    expect((svg.match(/<path d="M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ M/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(PANE).toMatch(/kaplanMeierSvg\(\[\{ km: res, label: "S\(t\)" \}\]/);
    expect(PANE).toMatch(/kaplanMeierSvg\(\s*groups\.map/);
  });
  const blocks = (s: string) =>
    s.split("\n\n").map((b) => {
      const rows = b.split("\n").map((l) => l.split(" ").map(Number));
      return { times: rows.map((r) => r[0]), events: rows.map((r) => r[1]) };
    });
  test("3-group log-rank is the exact (covariance) statistic: 5.2097 as lifelines (Pearson gave 4.58)", () => {
    const r = logRankTest(blocks("5 1\n8 1\n12 0\n20 1\n25 0\n30 1\n\n3 1\n4 1\n9 1\n10 0\n18 1\n22 1\n\n6 0\n15 1\n21 1\n28 0\n33 1\n40 0"));
    expect(r.ok).toBe(true);
    expect(r.df).toBe(2);
    expect(r.chi2).toBeCloseTo(5.209718202568894, 8);
    expect(r.p).toBeCloseTo(0.07391355078827605, 8);
    expect(r.caveats.join(" ")).not.toMatch(/APPROXIMATION|\^2/);
  });
  test("2-group log-rank unchanged (lifelines 0.3226)", () => {
    const r = logRankTest(blocks("5 1\n8 1\n12 1\n15 0\n20 0\n\n10 1\n14 1\n18 1\n22 0\n28 0"));
    expect(r.chi2).toBeCloseTo(0.3225997960476417, 8);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("9. small ones", () => {
  test("no-break spaces separate list numbers; no-break digit grouping stays one number", () => {
    expect(readNumberList(nbspSeparators("1\u00a02\u00a03\u00a04")).values).toEqual([1, 2, 3, 4]);
    expect(readNumberList(nbspSeparators("1\u202f2 3")).values).toEqual([1, 2, 3]);
    expect(nbspSeparators("1\u00a0200")).toBe("1\u00a0200");
    expect(nbspSeparators("plain 1 2")).toBe("plain 1 2");
    expect(PANE).toMatch(/readNumberList\(nbspSeparators\(s\), \{ cells, decimalField: cells \}\)/);
    expect(PANE).toMatch(/return finList\(nbspSeparators\(s\)\);/);
  });
  test("profile-plot condition labels longer than 12 characters end in an ellipsis", () => {
    const out = rmAnovaCalc(
      "Baseline_visit_one Week_four_follow_up Week_twelve_follow_up\n45 50 55\n42 42 45\n36 41 43\n39 35 40\n51 55 59\n44 49 56",
      "holm",
    );
    expect(out.ok).toBe(true);
    const labels = [...(out.svg ?? "").matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((t) => /…$/.test(t));
    expect(labels.length).toBe(3);
    for (const l of labels) expect([...l].length).toBeLessThanOrEqual(12);
  });
  test("survival rows separated by no-break spaces are read", () => {
    const r = readSurvivalRows("5 1\n6 0");
    expect(r).toEqual({ times: [5, 6], events: [1, 0] });
  });
  test("a censoring + on the top frame line is drawn whole (outside the clip)", () => {
    const k = kaplanMeier([2, 5, 6, 8], [0, 1, 1, 0]);
    const svg = kaplanMeierSvg([{ km: k, label: "S(t)" }], { title: "KM" });
    const clipEnd = svg.indexOf("</g>");
    const plusAtTop = /<path d="M[\d.]+,26\.0 L[\d.]+,26\.0 M/.exec(svg);
    expect(plusAtTop).not.toBeNull();
    expect(plusAtTop!.index).toBeGreaterThan(clipEnd);
  });
  test("efficiency pane default units: µM/s, µM, mM (an ordinary enzyme, below the limit)", () => {
    const at = PANE.indexOf('id: "efficiency"');
    expect(PANE.slice(at, at + 1200)).toMatch(/key: "kmu", label: "Km unit", default: "mM"/);
    const o = catalyticEfficiencyCalc({ vmax: 12, vmaxUnit: "uM/s", e: 0.001, eUnit: "uM", km: 8, kmUnit: "mM" });
    expect(o.text).toMatch(/kcat\/Km = 1500000 M⁻¹ s⁻¹/); // plain digits below 10⁹ (assaySig)
    expect(o.text).toMatch(/67-fold below/);
    const hi = catalyticEfficiencyCalc({ vmax: 12, vmaxUnit: "uM/s", e: 0.001, eUnit: "uM", km: 8, kmUnit: "uM" });
    expect(hi.text).toMatch(/at or slightly above/);
  });
  test("t-test brackets name Welch or Student", () => {
    const a = [1.2, 3.4, 2.2, 5.6, 4.1, 3.3];
    const b = [7.1, 6.5, 8.8, 9.0];
    const w = bracketLegend(bracketsFromPairwise([{ i: 0, j: 1, result: twoSampleTTest(a, b), kind: "t" }], "none"));
    const s = bracketLegend(bracketsFromPairwise([{ i: 0, j: 1, result: twoSampleTTest(a, b, true), kind: "t" }], "none"));
    expect(w).toMatch(/Welch t-test/);
    expect(s).toMatch(/Student t-test/);
  });
});
