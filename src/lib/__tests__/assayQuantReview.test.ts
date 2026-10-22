// Pins for the adversarial review of the assay-quantitation code (standard
// curves, plates, Livak, Pfaffl). Each block names the finding it pins. Most
// tests failed before their fix; the rest are regression guards for the
// behaviour each fix must keep (1,000 beside dot decimals, “-” wells, the L&S
// default staying on a linear axis, the stdcurve/plate defaults' clean text).
import { standardCurve, readPlate, parseLayout, analysePlate, readCtTable, livak, pfaffl, readDilutionSeries, type StandardCurveOk, type PlateRead, type CtTable, type LivakResult, type PfafflResult } from "../assayQuant";
import { ASSAY_QUANT_CALCS, parseStandards, pfafflReport, type QuantOutput } from "../assayQuantCalcs";

function run(id: string, over: Record<string, string> = {}): QuantOutput {
  const c = ASSAY_QUANT_CALCS.find((x) => x.id === id)!;
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const std = (rows: [number, number[]][]) => rows.map(([conc, responses]) => ({ conc, responses }));
const all = (o: QuantOutput): string => [o.text, ...(o.caveats ?? [])].join("\n");

describe("B1: a decimal comma before exactly three digits is a decimal, not a thousands separator", () => {
  const COMMA_STDS = "0 0,051 0,049\n10 0,212 0,208\n20 0,411 0,415\n40 0,803 0,791\n80 1,602 1,612";
  const DOT_STDS = COMMA_STDS.replace(/,/g, ".");
  it("the reviewer's repro reads 24.29 µg/mL, identical to the same data with dots, and says commas were read as decimals", () => {
    const comma = run("stdcurve", { stds: COMMA_STDS, unk: "Sample X: 0,512 0,5 0,498" });
    const dot = run("stdcurve", { stds: DOT_STDS, unk: "Sample X: 0.512 0.5 0.498" });
    expect(comma.ok).not.toBe(false);
    expect(comma.text).toContain("→ 24.29 µg/mL");
    expect(comma.text).toBe(dot.text);
    expect((comma.caveats ?? []).join(" ")).toMatch(/commas .*read as decimal points/i);
  });
  it("a block whose only commas are d,ddd and that has no other evidence is refused, asking for a point", () => {
    const o = run("stdcurve", { stds: "0 1,250 1,300\n10 2,500 2,400\n20 3,750 3,800", unk: "S: 2,000" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/1,250.*decimal point/);
  });
  it("regression: 1,000 beside dot decimals is still one thousand", () => {
    const s = parseStandards("1,000\t0.51\t0.52\n10\t0.1\t0.11");
    if (typeof s === "string") throw new Error(s);
    expect(s[0].conc).toBe(1000);
  });
  it("the plate and the layout labels: 0,123 is 0.123 and “std 0,125” is 0.125", () => {
    const head = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
    const rows = "ABCDEFGH".split("").map((L, r) => [L, r === 0 ? "0,123" : "", ...Array(11).fill("")].join("\t"));
    const p = readPlate([head, ...rows].join("\n")) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.wells.get("A1")).toBe(0.123);
    const g = parseLayout("std 0,125: A1\nstd 1,5: B1", 8, 12);
    if (!Array.isArray(g)) throw new Error(g.error);
    expect(g.map((x) => x.conc)).toEqual([0.125, 1.5]);
  });
  it("Ct tables and dilution series: 27,063 beside 27,1 is 27.063", () => {
    const t = readCtTable("C\tG\t27,063\t27,1") as CtTable;
    expect(t.records.map((x) => x.ct)).toEqual([27.063, 27.1]);
    const d = readDilutionSeries("1\t20,110\t20,05\n0,1\t23,4", "T");
    if (!Array.isArray(d)) throw new Error(d.error);
    expect(d[0].cts).toEqual([20.11, 20.05]);
    expect(d[1].amount).toBe(0.1);
  });
});

describe("B2: a tab-joined plate with a 1–12 header and no row letters is not shifted by an empty first well", () => {
  it("A1 empty stays empty; A2 keeps its value", () => {
    const head = Array.from({ length: 12 }, (_, i) => String(i + 1)).join("\t");
    const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 12 }, (_, c) => (r === 0 && c === 0 ? "" : String(r * 12 + c + 1))).join("\t"));
    const p = readPlate([head, ...rows].join("\n")) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.wells.get("A1")).toBeNull();
    expect(p.wells.get("A2")).toBe(2);
    expect(p.wells.get("A12")).toBe(12);
  });
});

describe("SF1: a group missing its reference or target gene rows is named, not dropped silently", () => {
  const T = readCtTable("Ctrl\tG\t25\t25.1\nCtrl\tR\t18\t18.1\nT1\tG\t23\t23.1\nT1\tR\t18\t18.2\nT2\tG\t22\t22.1") as CtTable;
  it("Livak", () => {
    const r = livak(T, "R", "Ctrl") as LivakResult;
    expect(r.ok).toBe(true);
    expect(r.skipped.join(" ")).toMatch(/T2.*R/);
  });
  it("Pfaffl", () => {
    const r = pfaffl(T, "G", "R", "Ctrl", 2, 2) as PfafflResult;
    expect(r.ok).toBe(true);
    expect(r.skipped.join(" ")).toMatch(/T2.*R/);
  });
});

describe("SF2/SF3: the straight-line calibration interval", () => {
  const S = std([[2, [0.3]], [4, [0.31]], [6, [0.62]], [8, [0.55]], [10, [0.93]]]);
  it("is withheld, with the reason, when it reaches zero or the slope is poorly determined (g ≈ 0.66)", () => {
    const r = standardCurve(S, [{ name: "u", responses: [0.25] }, { name: "v", responses: [0.6] }], "linear") as StandardCurveOk;
    expect(r.ok).toBe(true);
    for (const u of r.unknowns) {
      expect(u.status).toBe("ok");
      expect(u.ci).toBeUndefined();
      expect(u.ciMissing).toMatch(/no CI/);
    }
    expect(r.unknowns[1].ciMissing).toMatch(/slope/);
  });
  it("says the unknown's variance is the curve's residual s²/m (not its own replicates), and flags a high-CV unknown", () => {
    const r = standardCurve(std([[0, [0.05, 0.05]], [25, [0.11, 0.12]], [50, [0.18, 0.18]], [100, [0.31, 0.31]]]), [{ name: "noisy", responses: [0.15, 0.25, 0.2] }], "linear") as StandardCurveOk;
    expect(r.intervalMethod).not.toMatch(/unknown's own replicate variance/);
    expect(r.intervalMethod).toMatch(/residual/);
    expect(r.notes.join(" ")).toMatch(/noisy.*CV 25 %/);
  });
});

describe("SF4: hook-effect (non-monotone) standards are refused for a 4PL", () => {
  it("the means fall again after the peak", () => {
    const f = (c: number) => 0.05 + 2 / (1 + Math.pow(100 / c, 1.2));
    const hook = std([[3, [f(3), f(3) + 0.01]], [10, [f(10), f(10) + 0.01]], [30, [f(30), f(30) + 0.01]], [100, [f(100), f(100) + 0.01]], [300, [f(300), f(300) + 0.01]], [1000, [1.0, 1.01]], [3000, [0.6, 0.61]]]);
    const r = standardCurve(hook, [], "4pl");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/hook/);
  });
});

describe("SF5: typed plate rows shorter than the plate are refused by name; “-” is an empty well", () => {
  const head = Array.from({ length: 12 }, (_, i) => String(i + 1)).join(" ");
  it("a short typed row", () => {
    const r = readPlate(`${head}\nA 0.1 0.2`);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/Row A has 2 .*“-”/);
  });
  it("“-” keeps the columns", () => {
    const p = readPlate(`${head}\nA 0.1 - 0.3 ${Array(9).fill("-").join(" ")}`) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.wells.get("A2")).toBeNull();
    expect(p.wells.get("A3")).toBe(0.3);
  });
});

describe("SF6: an em dash in a user-supplied name does not make the result uninsertable", () => {
  it("unknown names", () => {
    const o = run("stdcurve", { unk: "Sample—1\t0.412\t0.405" });
    expect(all(o)).not.toContain("—");
    expect(o.text).toContain("Sample–1");
  });
  it("Ct group names, matched against the control field as typed", () => {
    const o = run("qpcr-livak", { cts: "Ctrl—1\tG\t25\t25.1\nCtrl—1\tR\t18\t18.1\nT\tG\t23\t23.1\nT\tR\t18\t18.2", ref: "R", ctrl: "Ctrl—1" });
    expect(o.ok).not.toBe(false);
    expect(all(o)).not.toContain("—");
  });
});

describe("SF7: fold-change bars on a log₂ axis so down-regulation is visible", () => {
  const DOWN = "Ctrl\tG\t25\t25.1\nCtrl\tR\t18\t18.1\nT\tG\t27\t27.1\nT\tR\t18\t18.2";
  it("auto: log₂ when a fold change is below 1", () => {
    const o = run("qpcr-livak", { cts: DOWN, ref: "R", ctrl: "Ctrl" });
    expect(o.svg).toContain("log₂");
    expect(o.svg).not.toMatch(/NaN|Infinity/);
    // T is about 4-fold down: the 0.25 tick is on the axis.
    expect(o.svg).toMatch(/>0\.25<\/text>/);
  });
  it("linear when asked, and the L&S default (all ≥ 1) stays linear", () => {
    expect(run("qpcr-livak", { cts: DOWN, ref: "R", ctrl: "Ctrl", axis: "linear" }).svg).not.toContain("log₂");
    expect(run("qpcr-livak").svg).not.toContain("log₂");
  });
  it("log₂ tick labels are exact powers of 2 (1024, not a rounded 1020)", () => {
    const o = run("qpcr-livak", { cts: "C\tG\t30\t30.1\nC\tR\t18\t18.1\nT\tG\t19.5\t19.6\nT\tR\t18\t18.1", ref: "R", ctrl: "C", axis: "log2" });
    expect(o.svg).toContain(">1024</text>");
    expect(o.svg).not.toMatch(/>1020<\/text>/);
  });
  it("a ratio of 999.7 prints as 1000, never as e-notation", () => {
    const dT = Math.log2(999.7);
    const t = readCtTable(`c\tG\t30\ns\tG\t${30 - dT}\nc\tR\t15\ns\tR\t15`) as CtTable;
    const r = pfaffl(t, "G", "R", "c", 2, 2) as PfafflResult;
    const fit = { ok: true as const, slope: -3.32, intercept: 30, rsquared: 0.999, E: 2, efficiencyPct: 100, n: 12, levels: 4, undetermined: 0, warnings: [] };
    const out = pfafflReport(r, fit, fit);
    expect(out.text).toContain("ratio 1000");
    expect(out.text).not.toMatch(/\de[+-]?\d/);
  });
  it("Pfaffl has the same choice", () => {
    expect(run("qpcr-pfaffl", { cts: DOWN, ref: "R", ctrl: "Ctrl", target: "G" }).svg).toContain("log₂");
  });
});

describe("nits", () => {
  it("4PL: an unknown exactly at the highest standard's response is read, not called above", () => {
    const P1 = std([[0, [0.072, 0.052]], [7.8, [0.202, 0.186]], [15.6, [0.336, 0.323]], [31.25, [0.56, 0.543]], [62.5, [0.896, 0.887]], [125, [1.318, 1.306]], [250, [1.711, 1.696]], [500, [2.008, 1.999]]]);
    const base = standardCurve(P1, [], "4pl") as StandardCurveOk;
    const ys = [7.8, 500].map((x) => base.curve.predict(x));
    const r = standardCurve(P1, ys.map((y, i) => ({ name: `e${i}`, responses: [y] })), "4pl") as StandardCurveOk;
    expect(r.unknowns.map((u) => u.status)).toEqual(["ok", "ok"]);
  });
  it("a “Detector” column is the gene column, not an ignored Ct summary", () => {
    const t = readCtTable("Sample\tDetector\tCt\nC\tG\t20\nC\tR\t15") as CtTable;
    expect(t.notes.join(" ")).not.toMatch(/Summary columns ignored/);
  });
  it("a header-less table whose first group is named “Treatment” is data", () => {
    const t = readCtTable("Treatment\tG\t20\t20.1\nTreatment\tR\t15\nControl\tG\t21\nControl\tR\t15") as CtTable;
    expect(t.ok).toBe(true);
    expect(t.records).toHaveLength(5);
  });
  it("flat 4PL standards get the flat-curve message, not “not identifiable”", () => {
    const r = standardCurve(std([[1, [0.5, 0.51]], [3, [0.5, 0.49]], [10, [0.51, 0.5]], [30, [0.49, 0.5]], [100, [0.5, 0.5]], [300, [0.5, 0.51]]]), [], "4pl");
    expect((r as { error: string }).error).toMatch(/flat/);
    expect((r as { error: string }).error).toMatch(/plateaus are not determined/);
  });
  it("the propagate caveat does not attribute the propagated SD to Livak & Schmittgen", () => {
    const c = (run("qpcr-livak", { cal: "propagate" }).caveats ?? [])[0];
    expect(c).not.toMatch(/SD calibrator²\) \(Livak & Schmittgen 2001\)/);
    expect(c).toMatch(/SD\(ΔΔCt\) = SD\(ΔCt\)/);
  });
  it("“1 sample”, not “1 samples”", () => {
    const head96 = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
    const v: Record<string, string> = { A1: "0.15", A2: "0.17", B1: "0.35", B2: "0.33", C1: "0.55", C2: "0.57", D1: "0.75", A4: "0.45" };
    const plate = [head96, ..."ABCDEFGH".split("").map((L) => [L, ...Array.from({ length: 12 }, (_, c) => v[`${L}${c + 1}`] ?? "")].join("\t"))].join("\n");
    const o = run("plate", { model: "linear", plate, layout: "std 10: A1-A2\nstd 20: B1-B2\nstd 30: C1-C2\nstd 40: D1\nS1: A4" });
    expect(o.text).toContain("4 standards, 1 sample.");
  });
  it("R² that rounds to 1 but is not 1 is shown as “> 0.99999”", () => {
    const o = run("stdcurve", { stds: "0 0.1\n10 0.2\n20 0.3000001\n30 0.4", unk: "S: 0.25" });
    expect(o.text).toContain("R² > 0.99999");
  });
  it("fold-change ranges keep 3 significant figures (1.00, not 1)", () => {
    expect(run("qpcr-livak").text).toContain("fold change 1.00 (0.886–1.13)");
  });
  it.each(ASSAY_QUANT_CALCS.map((c) => c.id))("%s: no caret, log10, em dash, NaN or Infinity in the text or caveats", (id) => {
    const t = all(run(id));
    expect(t).not.toMatch(/\^|log10|—|NaN|Infinity/);
  });
  it("a blank above a standard's readings is noted (corrected readings go negative)", () => {
    const head96 = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
    const v: Record<string, string> = { A1: "0.15", A2: "0.17", B1: "0.35", B2: "0.33", C1: "0.55", C2: "0.57", A3: "0.2", B3: "0.2", A4: "0.45" };
    const plate = [head96, ..."ABCDEFGH".split("").map((L) => [L, ...Array.from({ length: 12 }, (_, c) => v[`${L}${c + 1}`] ?? "")].join("\t"))].join("\n");
    const a = analysePlate(plate, "std 10: A1-A2\nstd 20: B1-B2\nstd 30: C1-C2\nblank: A3-B3\nS1: A4", "linear");
    if (!a.ok) throw new Error(a.error);
    expect(a.notes.join(" ")).toMatch(/blank .*std 10.*negative/);
  });
});

describe("R3-8: thousands commas in whole-number readings, decimal commas in Cts, read on evidence", () => {
  const RLU = "0 120 125\n10 1,234 1,250\n100 12,345 12,400";
  const RLU_PLAIN = "0 120 125\n10 1234 1250\n100 12345 12400";
  it("luminescence RLU standards with English thousands read as thousands, identical to the comma-free data, with a note", () => {
    const comma = run("stdcurve", { model: "linear", stds: RLU, unk: "S: 6,000 6,100", unit: "nM" });
    const plain = run("stdcurve", { model: "linear", stds: RLU_PLAIN, unk: "S: 6000 6100", unit: "nM" });
    expect(comma.ok).not.toBe(false);
    expect(comma.text).toBe(plain.text);
    expect(all(comma)).toMatch(/read as thousands separators: the readings are whole numbers \(“120”\).*“1,234” is 1234/);
    const s = parseStandards(RLU);
    if (typeof s === "string") throw new Error(s);
    expect(s.map((x) => x.responses)).toEqual([[120, 125], [1234, 1250], [12345, 12400]]);
  });
  it("a plate of whole-number counts reads 1,234 as 1234", () => {
    const head = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
    const rows = "ABCDEFGH".split("").map((L, r) => [L, r === 0 ? "1,234" : "", r === 0 ? "150" : "", ...Array(10).fill("")].join("\t"));
    const p = readPlate([head, ...rows].join("\n")) as PlateRead;
    expect(p.ok).toBe(true);
    expect(p.wells.get("A1")).toBe(1234);
    expect(p.notes.join(" ")).toMatch(/thousands separators/);
  });
  it("still refused with no whole-number reading ≥ 100 (concentrations do not count as evidence)", () => {
    expect(run("stdcurve", { stds: "0 1,250 1,300\n10 2,500 2,400\n100 3,750 3,800", unk: "S: 2,000" }).ok).toBe(false);
  });
  it("a Ct of 18,123 must be 18.123 (a Ct cannot exceed 60), with the reason in the note", () => {
    const t = readCtTable("Sample\tGene\tCt\nC\tG\t18,123\nC\tR\t20,456") as CtTable;
    expect(t.ok).toBe(true);
    expect(t.records.map((x) => x.ct)).toEqual([18.123, 20.456]);
    expect(t.notes.join(" ")).toMatch(/“18,123” is 18\.123 \(a Ct cannot exceed 60 cycles\)/);
    const h = readCtTable("C G 18,123 18,200") as CtTable;
    expect(h.records.map((x) => x.ct)).toEqual([18.123, 18.2]);
    const d = readDilutionSeries("1\t18,123\n10\t21,456", "T");
    if (!Array.isArray(d)) throw new Error(d.error);
    expect(d.map((x) => x.cts[0])).toEqual([18.123, 21.456]);
    expect(d.map((x) => x.amount)).toEqual([1, 10]);
  });
  it("a Ct table with dot decimals AND a d,ddd Ct is still refused as mixed", () => {
    const t = readCtTable("C\tG\t18,123\t18.2");
    expect(t.ok).toBe(false);
  });
});

describe("R3-8b: the thousands reading end to end, and only for reading cells", () => {
  const plateOf = (cells: Record<string, string>): string => {
    const head = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
    const rows = "ABCDEFGH".split("").map((L) => [L, ...Array.from({ length: 12 }, (_, c) => cells[`${L}${c + 1}`] ?? "")].join("\t"));
    return [head, ...rows].join("\n");
  };
  const COMMA = { A1: "120", A2: "125", B1: "1,234", B2: "1,250", C1: "12,345", C2: "12,400", D1: "6,000", D2: "6,100" };
  const PLAIN = Object.fromEntries(Object.entries(COMMA).map(([k, v]) => [k, v.replace(",", "")]));
  const LAYOUT = "std 0: A1-A2\nstd 10: B1-B2\nstd 100: C1-C2\nSample 1: D1-D2";
  it("the plate calculator reads an RLU plate with English thousands like the comma-free plate", () => {
    const comma = run("plate", { model: "linear", plate: plateOf(COMMA), layout: LAYOUT, unit: "nM" });
    const plain = run("plate", { model: "linear", plate: plateOf(PLAIN), layout: LAYOUT, unit: "nM" });
    expect(comma.ok).not.toBe(false);
    expect(comma.text).toBe(plain.text);
    expect(all(comma)).toMatch(/thousands separators/);
  });
  it("a layout concentration “std 1,250” beside whole-number readings is still refused", () => {
    const o = run("plate", { model: "linear", plate: plateOf(PLAIN), layout: "std 0: A1-A2\nstd 1,250: B1-B2\nstd 100: C1-C2\nSample 1: D1-D2" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/1,250/);
  });
  it("standards whose CONCENTRATIONS are d,ddd stay refused even with whole-number readings", () => {
    const o = run("stdcurve", { model: "linear", stds: "1,250 1200 1300\n2,500 2400 2450\n5,000 4800 4900", unk: "S: 3000" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/1,250/);
  });
  it("unknowns typed without names (tab-joined) read their own first cell as a reading", () => {
    const o = run("stdcurve", { model: "linear", stds: "0\t120\t125\n10\t1,234\t1,250\n100\t12,345\t12,400", unk: "6,000\t6,100" });
    expect(o.ok).not.toBe(false);
  });
});
