// The Bio/Assay quantitation calculators AS THE PANE RUNS THEM: the registry
// objects from assayQuantCalcs.ts (spread into ASSAY_CALCS — see INTEGRATION.md),
// fed either their shipped defaults or a Word table through the SAME conversion
// "Use table at cursor" applies to a `block` field (dataimport.gridToFieldText).
//
// Expected numbers: [oracle] = scratchpad assayquant-oracle/oracle.py (scipy
// 1.18.1 / statsmodels 0.15.0) on the same inputs; [L&S] = Livak & Schmittgen
// (2001) Table 1. Text values are those numbers at the precision the pane prints.
import * as fs from "fs";
import * as path from "path";
import { ASSAY_QUANT_CALCS, parseStandards, parseUnknowns, type QuantCalc, type QuantOutput } from "../assayQuantCalcs";
import { gridToFieldText } from "../dataimport";

const calc = (id: string): QuantCalc => {
  const c = ASSAY_QUANT_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
/** Runs a calculator with its defaults, overridden by `over` — the pane's read(k). */
function run(id: string, over: Record<string, string> = {}): QuantOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
/** A Word table as the table reader hands it over, through the block-field conversion. */
const feed = (rows: string[][]): string => gridToFieldText(rows, "block");

/** The pane's insertableResultText rule (taskpane.ts), restated: these three block insertion. */
function insertable(text: string): boolean {
  return !!text && !text.includes("—") && !text.includes("NaN") && !text.includes("Infinity");
}
/** Display contract: U+2212 for a negative number, a space before %. */
function typographyClean(text: string): string[] {
  const bad: string[] = [];
  if (/(^|[\s(=:;,])-\d/m.test(text)) bad.push("ASCII hyphen as a minus");
  if (/\d%/.test(text)) bad.push("no space before %");
  if (/\de[+-]?\d/i.test(text)) bad.push("e-notation");
  return bad;
}

describe("registry shape (what renderCalcFields and updateAssayPreview rely on)", () => {
  it("four calculators with unique ids that do not collide with the pane's own ASSAY_CALCS", () => {
    const ids = ASSAY_QUANT_CALCS.map((c) => c.id);
    expect(ids).toEqual(["stdcurve", "plate", "qpcr-livak", "qpcr-pfaffl"]);
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const start = pane.indexOf("const ASSAY_CALCS");
    const slice = pane.slice(start, pane.indexOf("\n];", start));
    const paneIds = [...slice.matchAll(/^\s+id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);
    expect(paneIds.length).toBeGreaterThan(10);
    for (const id of ids) expect(paneIds).not.toContain(id);
  });
  it("every table-shaped field is kind `block`, so a table reaches it verbatim (a `list` would drop “Undetermined”)", () => {
    for (const c of ASSAY_QUANT_CALCS) {
      for (const f of c.fields) {
        if (["stds", "unk", "plate", "layout", "cts", "tdil", "rdil"].includes(f.key)) expect(f.kind).toBe("block");
      }
    }
  });
  it("every non-select field with an empty default is marked optional (the preview blocks on an empty required field)", () => {
    for (const c of ASSAY_QUANT_CALCS) for (const f of c.fields) if (f.kind !== "select" && f.default === "") expect(f.optional).toBe(true);
  });
});

describe("every calculator's defaults compute, insert AND draw", () => {
  it.each(ASSAY_QUANT_CALCS.map((c) => c.id))("%s", (id) => {
    const out = run(id);
    expect(out.ok).not.toBe(false);
    expect(insertable(out.text)).toBe(true);
    expect(typographyClean(out.text)).toEqual([]);
    expect(out.svg).toMatch(/^<svg[^>]*width="\d/);
    expect(out.svg).not.toMatch(/NaN|Infinity/);
    expect((out.caveats ?? []).length).toBeGreaterThan(0);
  });
});

describe("Standard curve calculator [oracle: linear_default]", () => {
  const out = run("stdcurve");
  it("reports the back-calculated concentrations and the calibration interval at 4 significant figures", () => {
    expect(out.text).toContain("Sample 1: mean 0.4117, SD 0.0065, CV 1.6 % (n = 3) → 142.2 µg/mL (95 % CI 138.7 to 145.7 µg/mL)");
    expect(out.text).toContain("Sample 2: mean 0.231, SD 0.005, CV 2.2 % (n = 3) → 70.5 µg/mL (95 % CI 66.97 to 74.02 µg/mL)");
  });
  it("an unknown above the standards gets words, never a number", () => {
    expect(out.text).toContain("Sample 3: mean 1.401, SD 0.011, CV 0.79 % (n = 3) → above the highest standard (400 µg/mL); not extrapolated");
    expect(out.text).not.toMatch(/534/); // the oracle's extrapolated x0 is 534.5
    // The figure note wraps to the plot width.
    expect(out.svg).toContain("Not plotted (outside the standards, not extrapolated):");
    expect(out.svg).toContain(">Sample 3.</text>");
  });
  it("the figure carries the curve, the standards with SD bars and the unknowns", () => {
    expect(out.svg).toContain("standards (mean ± SD)");
    expect(out.svg).toContain("fitted curve");
    expect(out.svg).toContain("unknowns");
    expect(out.svg).toContain("Error bars: ±1 SD");
  });
  it("from a Word table with a header row (Conc | Rep 1 | Rep 2 | Rep 3) and an empty replicate cell", () => {
    const text = feed([
      ["Conc", "Rep 1", "Rep 2", "Rep 3"],
      ["0", "0.048", "0.052", "0.050"],
      ["25", "0.118", "0.111", ""],
      ["50", "0.176", "0.183", "0.180"],
      ["100", "0.309", "0.315", "0.305"],
    ]);
    const s = parseStandards(text);
    if (typeof s === "string") throw new Error(s);
    expect(s.map((x) => x.responses.length)).toEqual([3, 2, 3, 3]);
  });
  it("adversarial: NUMERIC sample IDs under a “Sample” header are names, not responses (through the table feed)", () => {
    const text = feed([
      ["Sample", "Rep 1", "Rep 2", "Rep 3"],
      ["101", "0.412", "0.405", "0.418"],
      ["102", "0.231", "0.226", "0.236"],
    ]);
    const u = parseUnknowns(text);
    if (typeof u === "string") throw new Error(u);
    expect(u).toEqual([
      { name: "101", responses: [0.412, 0.405, 0.418] },
      { name: "102", responses: [0.231, 0.226, 0.236] },
    ]);
    // And through the calculator: the same concentration as "Sample 1" in the defaults.
    const o = run("stdcurve", { unk: text });
    expect(o.text).toContain("101: mean 0.4117, SD 0.0065, CV 1.6 % (n = 3) → 142.2 µg/mL");
  });
  it("numeric IDs beside a row named in words are names too; a block of numbers only has no names", () => {
    const mixed = parseUnknowns("S1\t0.4\t0.41\n7\t0.2\t0.21");
    expect(mixed).toEqual([
      { name: "S1", responses: [0.4, 0.41] },
      { name: "7", responses: [0.2, 0.21] },
    ]);
    expect(parseUnknowns("0.4 0.41\n0.2 0.21")).toEqual([
      { name: "Unknown 1", responses: [0.4, 0.41] },
      { name: "Unknown 2", responses: [0.2, 0.21] },
    ]);
  });
  it("a typed name with a space takes a colon", () => {
    expect(parseUnknowns("Sample 1: 0.41 0.40\nSample 2: 0.2")).toEqual([
      { name: "Sample 1", responses: [0.41, 0.4] },
      { name: "Sample 2", responses: [0.2] },
    ]);
  });
  it("4PL on the linear default refuses (the plateaus are not determined), rather than inventing them", () => {
    const o = run("stdcurve", { model: "4pl" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/plateaus are not determined/);
  });
  it("a typed non-number in the standards is refused by line", () => {
    const o = run("stdcurve", { stds: "0 0.05\n10 0.1x\n20 0.2" });
    expect(o.ok).toBe(false);
    expect(o.text).toBe("Standards, line 2: “0.1x” is not a response.");
  });
});

describe("Plate calculator [oracle: plate_default]", () => {
  const out = run("plate");
  it("blank-subtracts, groups replicates and reads the samples off the 4PL", () => {
    expect(out.text).toContain("Plate: 96-well, 28 wells with a reading; 8 standards, 3 samples.");
    expect(out.text).toContain("Blank: mean 0.04067, SD 0.0015, CV 3.8 % (n = 3); subtracted");
    expect(out.text).toContain("bottom = 0.04803, top = 2.199, EC50 = 179.8 pg/mL, Hill slope = 1.1");
    expect(out.text).toContain("Sample 1: mean 0.78, SD 0.014, CV 1.7 % (n = 3) → 98.36 pg/mL (95 % CI 96.97 to 99.76 pg/mL)");
    expect(out.text).toContain("→ 36.94 pg/mL (95 % CI 36.01 to 37.87 pg/mL)");
    expect(out.text).toContain("→ 343.2 pg/mL (95 % CI 338 to 348.4 pg/mL)");
  });
  it("draws the plate heat map (heatmap.ts) above the standard curve, and words empty wells as wells", () => {
    expect(out.svg).toContain("Plate readings (raw), 96-well");
    expect(out.svg).toContain("Standard curve (4PL)");
    expect(out.caveats!.join(" ")).toMatch(/68 empty wells are left blank on the plate map/);
    expect(out.caveats!.join(" ")).not.toMatch(/not numeric/);
  });

  const head96 = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  const tableRows = (fill: (r: number, c: number) => string): string[][] => [
    head96,
    ..."ABCDEFGH".split("").map((L, r) => [L, ...Array.from({ length: 12 }, (_, c) => fill(r, c + 1))]),
  ];
  // Standards 10…50 in duplicate (cols 1–2), blanks col 3, one sample.
  const v: Record<string, string> = {
    A1: "0.15", A2: "0.17", B1: "0.35", B2: "0.33", C1: "0.55", C2: "0.57", D1: "0.75", D2: "0.73", E1: "0.95", E2: "0.97",
    A3: "0.05", B3: "0.04", C3: "0.06", A4: "0.45", A5: "0.47", A6: "0.46",
  };
  const layoutRows = [
    ["std 10", "A1-A2"],
    ["std 20", "B1-B2"],
    ["std 30", "C1-C2"],
    ["std 40", "D1-D2"],
    ["std 50", "E1-E2"],
    ["blank", "A3-C3"],
    ["S1", "A4-A6"],
  ];
  it("through the table feed: a plate table + a two-column layout table (label | wells)", () => {
    const o = run("plate", { model: "linear", plate: feed(tableRows((r, c) => v[`${"ABCDEFGH"[r]}${c}`] ?? "")), layout: feed(layoutRows) });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("5 standards, 1 sample.");
    expect(o.text).toMatch(/S1: mean 0\.41, SD 0\.01, CV 2\.4 % \(n = 3\) → /);
  });
  it("adversarial: a row of wholly empty wells keeps its letter, so later rows are not shifted", () => {
    const o = run("plate", {
      model: "linear",
      plate: feed(tableRows((r, c) => (r === 5 ? "" : v[`${"ABCDEFGH"[r]}${c}`] ?? ""))),
      layout: feed(layoutRows),
    });
    expect(o.ok).not.toBe(false);
  });
  it("adversarial: 384-well table through the feed, standards across row P", () => {
    const head = ["", ...Array.from({ length: 24 }, (_, i) => String(i + 1))];
    const rows = [head, ..."ABCDEFGHIJKLMNOP".split("").map((L) => [L, ...Array(24).fill("")])];
    const conc = [5, 10, 20, 40, 80];
    conc.forEach((c, i) => {
      rows[16][1 + 2 * i] = String(0.01 * c + 0.002);
      rows[16][2 + 2 * i] = String(0.01 * c - 0.002);
    });
    rows[1][24] = "0.3"; // A24, a sample
    const layout = conc.map((c, i) => `std ${c}: P${1 + 2 * i}-P${2 + 2 * i}`).join("\n") + "\nS1: A24";
    const o = run("plate", { model: "linear", plate: feed(rows), layout });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Plate: 384-well, 11 wells with a reading");
    expect(o.svg).toContain("Plate readings (raw), 384-well");
    // Closed form: the points lie on y = 0.01·x (±0.002 symmetric), so S1 reads 0.3/0.01 = 30.
    expect(o.text).toMatch(/S1: 0\.3 \(n = 1, no SD\) → 30 pg\/mL/);
  });
  it("a malformed grid is refused by name and nothing is inserted", () => {
    const o = run("plate", { plate: feed([head96.slice(0, 12), ["A", ...Array(11).fill("1")]]) });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/The plate has 11 columns/);
  });
});

describe("Livak calculator (defaults are L&S Table 1) [L&S, oracle: livak_table1]", () => {
  const out = run("qpcr-livak");
  it("prints ΔCt, ΔΔCt with U+2212 and the asymmetric fold-change range", () => {
    expect(out.text).toContain("Brain (calibrator): Ct 30.49 ± 0.15, GAPDH 23.63 ± 0.09; ΔCt 6.86 ± 0.17; ΔΔCt 0.00 ± 0.17; fold change 1.00 (0.886–1.13)");
    expect(out.text).toContain("Kidney: Ct 27.03 ± 0.06, GAPDH 22.66 ± 0.08; ΔCt 4.37 ± 0.10; ΔΔCt −2.50 ± 0.10; fold change 5.64 (5.28–6.02)");
  });
  it("states the efficiency assumption and the technical-replicate limit", () => {
    const c = out.caveats!.join(" ");
    expect(c).toMatch(/about 100 % efficiency/);
    expect(c).toMatch(/technical replicates/);
  });
  it("flags the reference gene that varies (GAPDH −0.96 cycles in kidney) and owns the threshold", () => {
    expect(out.caveats!.join(" ")).toMatch(/GAPDH shifts by −0\.96 cycles in Kidney.*a threshold of its own, not a published one/);
  });
  it("the bar chart writes 2^−ΔΔCt with a raised exponent and states what the bars are", () => {
    expect(out.svg).toContain(`2<tspan dy="-5" font-size="8">−ΔΔCt</tspan>`);
    expect(out.svg).toContain("Livak &amp; Schmittgen (2001)");
    expect(out.svg).toContain("Dashed line: no change (1).");
  });
  it("propagate mode: 5.64 (4.91–6.47) and the calibrator is 1 by definition", () => {
    const o = run("qpcr-livak", { cal: "propagate" });
    expect(o.text).toContain("ΔΔCt −2.50 ± 0.20; fold change 5.64 (4.91–6.47)");
    expect(o.text).toContain("fold change 1 (calibrator, defined without error)");
  });
  it("through the table feed: a long export with Undetermined wells", () => {
    const rows = [
      ["Well", "Sample Name", "Target Name", "CT"],
      ["A1", "Ctrl", "IL6", "28.10"],
      ["A2", "Ctrl", "IL6", "28.25"],
      ["A3", "Ctrl", "IL6", "Undetermined"],
      ["B1", "Ctrl", "ACTB", "17.02"],
      ["B2", "Ctrl", "ACTB", "16.95"],
      ["B3", "Ctrl", "ACTB", "17.10"],
      ["C1", "LPS", "IL6", "22.40"],
      ["C2", "LPS", "IL6", "22.31"],
      ["C3", "LPS", "IL6", "22.52"],
      ["D1", "LPS", "ACTB", "18.30"],
      ["D2", "LPS", "ACTB", "18.41"],
      ["D3", "LPS", "ACTB", "18.22"],
    ];
    const o = run("qpcr-livak", { cts: feed(rows), ref: "ACTB", ctrl: "Ctrl" });
    expect(o.ok).not.toBe(false);
    // [oracle: livak_adv] fold 132.667 (120.221–146.402).
    expect(o.text).toContain("ΔΔCt −7.05 ± 0.14; fold change 133 (120–146)");
    expect(o.caveats!.join(" ")).toMatch(/1 replicate is Undetermined/);
    expect(o.caveats!.join(" ")).toMatch(/ACTB shifts by 1\.29 cycles in LPS/);
  });
  it("an unknown reference gene is refused by name", () => {
    const o = run("qpcr-livak", { ref: "ACTB" });
    expect(o.ok).toBe(false);
    expect(o.text).toBe("No reference gene named “ACTB” in the table; it has “c-myc”, “GAPDH”.");
  });
});

describe("Pfaffl calculator [oracle: pfaffl_default]", () => {
  const out = run("qpcr-pfaffl");
  it("efficiencies with slope, R² and %; the ratio", () => {
    expect(out.text).toContain("c-myc (target): slope −3.396 cycles per log₁₀, R² = 0.9998, E = 1.97 (efficiency 97 %), 12 Cts at 4 dilutions");
    expect(out.text).toContain("GAPDH (reference): slope −3.352 cycles per log₁₀, R² = 0.9999, E = 1.988 (efficiency 98.8 %)");
    expect(out.text).toContain("Kidney: ΔCt c-myc 3.46, ΔCt GAPDH 0.96 → ratio 5.38");
  });
  it("gives no error bars and says why", () => {
    expect(out.caveats!.join(" ")).toMatch(/No error range is given: Pfaffl \(2001\) states no closed-form error/);
    expect(out.svg).toContain("No error bars: Pfaffl (2001)");
  });
  it("adversarial: dilution factors instead of amounts are refused", () => {
    const o = run("qpcr-pfaffl", { tdil: "1\t20.1\t20.2\n10\t23.5\t23.4\n100\t26.9\t26.8" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Target: Ct rises with the input amount/);
  });
  it("adversarial: an efficiency outside 80–120 % blocks the ratio", () => {
    const o = run("qpcr-pfaffl", { rdil: "1\t15\n0.1\t17.5\n0.01\t20" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Reference: efficiency 151 %/);
  });
});
