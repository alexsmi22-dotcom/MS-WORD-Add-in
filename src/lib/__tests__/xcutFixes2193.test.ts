// Cross-cutting insert and display fixes (v2.193.0). Each block pins one confirmed defect.
import * as fs from "fs";
import * as path from "path";
import { prepareEditableTable, prepareTableFigure, tableRowsNote } from "../tablefigure";
import { analyzeAntibodies, numberingRows } from "../antibodyReport";
import { parsePeakList, peakRows, WAVELENGTHS } from "../solidform";
import { analyzeSolid } from "../solidformAnalyze";
import { buildResultOoxml, packageBodyXml } from "../resultOoxml";
import { inlineParagraphsOoxml, schemeCaptionOoxml } from "../bibOoxml";
import { formatMatrix, formatMatrixCells, formatNum } from "../linalg";
import { insertableResultText, matrixBlocksFinite } from "../insertGate";
import { reportT, pairedTTest, twoSampleTTest } from "../stats";
import { finFixed, finMoney, finPct } from "../financeFigures";
import { solveHeat, solveWave } from "../pde";
import { polynomialRegression } from "../regression";
import { proseDashes } from "../proseDashes";
import { pictureNotKeptText } from "../insertKept";
import { rmAnovaCalc, coxCalc } from "../statsBatchCalcs";
import { ASSAY_QUANT_CALCS } from "../assayQuantCalcs";
import { stoichCalc } from "../chembioCalcs";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "antibody-numbering.json"), "utf8"));
const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("1. the editable Word table carries every row (its own grid, not the 40-row table figure's)", () => {
  test("Antibody numbering: every residue of trastuzumab VH is a row", () => {
    const a = analyzeAntibodies(FX.trastuzumab_H.seq);
    expect(a.errors).toEqual([]);
    const rows = numberingRows(a.chains[0], "imgt");
    expect(rows.length).toBe(121); // the header and one row per residue of this VH
    const g = prepareEditableTable(rows);
    expect(g.grid.length).toBe(rows.length);
    expect(g.grid).toEqual(rows);
    expect(prepareTableFigure(rows).grid.length).toBe(40); // the FIGURE still caps, as it should
    expect(tableRowsNote(rows, rows.length)).toBe(`${rows.length - 1} rows`);
  });

  test("Solid form: a 58-peak XRPD list inserts 58 data rows", () => {
    const list = Array.from({ length: 58 }, (_, i) => `${(4 + i * 0.6).toFixed(2)} ${100 - i}`).join("\n");
    const pk = parsePeakList(list, WAVELENGTHS.CuKa1.a);
    expect(pk.errors).toEqual([]);
    expect(pk.peaks.length).toBe(58);
    const res = analyzeSolid("xrpd", list);
    if (!res.ok) throw new Error("XRPD refused");
    const rows = res.rows; // what the pane's "Insert table" sends: the header and one row per peak
    expect(rows.slice(1)).toEqual(peakRows(pk.peaks, rows[1][0].split(".")[1]?.length ?? 1));
    const g = prepareEditableTable(rows);
    expect(g.grid.length).toBe(59);
    expect(g.hasHeader).toBe(true);
    expect(tableRowsNote(rows, 59)).toBe("58 rows");
    expect(tableRowsNote(rows, 41)).toBe("58 rows sent, but Word reports 40");
  });

  test("no section bands and no dropped first column: a one-cell row stays a row, the first column stays", () => {
    const rows = [["Group", "x", "y"], ["Alpha", "", ""], ["", "1", "2"], ["", "3", "4"]];
    expect(prepareTableFigure(rows).grid[0].length).toBe(2); // the figure drops the section column
    const g = prepareEditableTable(rows);
    expect(g.grid).toEqual(rows);
    expect(g.numericCol).toEqual([false, true, true]);
  });

  test("ragged rows are padded to the widest", () => {
    expect(prepareEditableTable([["a", "b", "c"], ["1"]]).grid).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });
});

describe("3. a reaction scheme is ONE package: caption (SEQ field, Caption style), picture, footnote", () => {
  const caption = packageBodyXml(schemeCaptionOoxml(2, "Synthesis of <b>5</b>"));
  const foot = packageBodyXml(inlineParagraphsOoxml(["<sup>a</sup>Reagents and conditions: <i>n</i>-BuLi."]));
  const pkg = buildResultOoxml([
    { kind: "xml", content: caption },
    { kind: "picture", caption: "", base64: "AAAA", widthPt: 100, heightPt: 50, alt: "scheme" },
    { kind: "xml", content: foot },
  ]);

  test("packageBodyXml lifts the body out of a builder's package", () => {
    expect(caption.startsWith("<w:p>")).toBe(true);
    expect(caption).toContain('<w:fldSimple w:instr=" SEQ Scheme \\* ARABIC ">');
    expect(packageBodyXml("<x/>")).toBe("");
  });

  test("order: caption, then the picture, then the footnote, in one document part", () => {
    const doc = pkg.ooxml;
    const iCap = doc.indexOf("SEQ Scheme"), iPic = doc.indexOf("<w:drawing>"), iFoot = doc.indexOf("Reagents and conditions");
    expect(iCap).toBeGreaterThan(0);
    expect(iPic).toBeGreaterThan(iCap);
    expect(iFoot).toBeGreaterThan(iPic);
    expect(pkg.pictures).toBe(1);
    expect(doc.match(/<w:document /g)).toHaveLength(1);
  });

  test("the package defines Word's built-in Caption style, so a new document keeps it (measured via COM: without it, Normal)", () => {
    expect(pkg.ooxml).toContain('pkg:name="/word/styles.xml"');
    expect(pkg.ooxml).toContain('<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/>');
    expect(pkg.ooxml).toContain('Target="styles.xml"');
  });

  test("a package with no Caption paragraph carries no styles part", () => {
    const plain = buildResultOoxml([{ kind: "text", content: "x" }]).ooxml;
    expect(plain).not.toContain("styles.xml");
    expect(plain).not.toContain("document.xml.rels");
  });

  test("the pane builds the scheme as one package (no chained ooxml items)", () => {
    const start = PANE.indexOf("async function insertReactionNow()");
    const body = PANE.slice(start, PANE.indexOf("mergeIntoRegister", start));
    expect(body).toContain("buildResultOoxml(items)");
    expect(body).not.toMatch(/kind: "ooxml", ooxml: schemeCaptionOoxml/);
    expect(body).not.toMatch(/kind: "ooxml", ooxml: inlineParagraphsOoxml/);
  });
});

/** Display-contract violations in text that reaches the document. */
function violations(t: string): string[] {
  const v: string[] = [];
  if (/(^|[\s(=,;:[/×])-(?=\.?\d)/m.test(t)) v.push("ASCII minus");
  if (/\d(?:\.\d+)?e[+-]?\d/i.test(t)) v.push("e-notation");
  if (t.includes("^")) v.push("caret");
  if (/[A-Za-zα-ωΑ-Ω)\]]_[A-Za-z0-9{]/.test(t)) v.push("underscore subscript");
  if (t.includes("—")) v.push("em dash");
  return v;
}
/** The words an SVG draws. */
const svgText = (svg: string): string => [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join("\n");

describe("4. display contract outside Engineering", () => {
  test("formatNum: true minus and ×10ⁿ, digits as before; — stays the non-finite sentinel", () => {
    expect(formatNum(1.63376e-17, 6)).toBe("1.63376×10⁻¹⁷");
    expect(formatNum(-5.551e-17, 4)).toBe("−5.551×10⁻¹⁷");
    expect(formatNum(-2.5)).toBe("−2.5");
    expect(formatNum(1e21)).toBe("1×10²¹");
    expect(formatNum(0.000123456, 3)).toBe("0.000123");
    expect(formatNum(12345.678, 6)).toBe("12345.7");
    expect(formatNum(-1e-30)).toBe("−1×10⁻³⁰");
    expect(formatNum(-0.00001)).toBe("−0.00001");
    expect(formatNum(NaN)).toBe("—");
    expect(formatNum(-Infinity)).toBe("—");
  });

  test("a matrix snaps round-off to 0 below 10⁻¹⁴ of its scale; a non-finite entry still blocks the insert", () => {
    expect(formatMatrixCells([[1, 1.6e-17], [-5.5e-17, 1]], 6)).toEqual([["1", "0"], ["0", "1"]]);
    expect(formatMatrixCells([[1e-20, 2e-20]], 6)).toEqual([["1×10⁻²⁰", "2×10⁻²⁰"]]); // a small matrix is not round-off
    // An honest entry of a badly scaled matrix is never snapped to a confident 0 (the threshold is 10⁻¹⁴ of scale).
    expect(formatMatrixCells([[1e13, 0], [0, 1]], 6)).toEqual([["10000000000000", "0"], ["0", "1"]]);
    expect(formatMatrixCells([[1, 2e-15]], 6)).toEqual([["1", "0"]]);
    expect(formatMatrixCells([[1, 3e-14]], 6)).toEqual([["1", "3×10⁻¹⁴"]]);
    expect(formatMatrix([[1, -2]])).toBe(" 1  −2");
    const bad = [[1, NaN]];
    expect(formatMatrixCells(bad, 6)[0][1]).toBe("—");
    expect(insertableResultText(formatMatrix(bad))).toBe(false);
    expect(matrixBlocksFinite([{ kind: "matrix", m: bad }])).toBe(false);
    expect(matrixBlocksFinite([{ kind: "matrix", m: [[1, 2]] }, { kind: "line" }])).toBe(true);
    expect(matrixBlocksFinite(null)).toBe(true);
  });

  test("reportT: true minus, d(z) not d_z", () => {
    const after = [10, 12, 11, 13, 12], before = [12, 15, 13, 16, 15];
    const s = reportT(pairedTTest(after, before));
    expect(s).toMatch(/t\(4\) = −\d/);
    expect(s).toContain("d(z) = −");
    expect(s).toMatch(/95% CI \[−\d/);
    expect(violations(s)).toEqual([]);
    expect(violations(reportT(twoSampleTTest([1, 2, 3, 4], [3, 4, 5, 7])))).toEqual([]);
  });

  test("finance formatters: true minus, no negative zero", () => {
    expect(finFixed(-0.017612, 4)).toBe("−0.0176");
    expect(finFixed(-0.00001, 4)).toBe("0.0000");
    expect(finMoney(-1234.5)).toBe("−1,234.50");
    expect(finPct(-0.05)).toBe("−5.00%");
    expect(finPct(-0.00001)).toBe("0.00%");
    expect(finFixed(NaN, 2)).toBe("—");
  });

  test("pde, rm-ANOVA and polynomial regression write subscripts and powers, not _ and ^", () => {
    const heat = solveHeat(1, 1, 0.1, (x) => Math.sin(Math.PI * x), 0, 0, { nx: 20 });
    if (!heat.ok) throw new Error(heat.error);
    expect(heat.result.steps[0]).toContain("uₜ = 1 uₓₓ");
    const wave = solveWave(1, 1, 0.5, (x) => Math.sin(Math.PI * x), () => 0, 0, 0, { nx: 20, courant: 1 });
    if (!wave.ok) throw new Error(wave.error);
    for (const s of wave.result.steps) expect(s).not.toMatch(/u_/);
    expect(wave.result.steps[0]).toContain("uₜₜ = 1² uₓₓ");
    const pr = polynomialRegression([1, 2, 3, 4, 5, 6], [1, 4, 9, 16, 25, 36.5], 3);
    expect(pr.ok).toBe(true);
    if (pr.ok) {
      expect(pr.coefficients.map((c) => c.name)).toEqual(["Intercept", "(x − x̄)", "(x − x̄)²", "(x − x̄)³"]);
    }
  });

  test("proseDashes: a pair becomes commas, a single one a semicolon; en dashes untouched", () => {
    expect(proseDashes("that plateau — and the EC50 that depends on it — is extrapolation.")).toBe("that plateau, and the EC50 that depends on it, is extrapolation.");
    expect(proseDashes("stopped, not a best fit — do not report them.")).toBe("stopped, not a best fit; do not report them.");
    expect(proseDashes("IRR assumes reinvestment AT THE IRR — usually optimistic. Black–Scholes is European — no early exercise.")).toBe(
      "IRR assumes reinvestment AT THE IRR; usually optimistic. Black–Scholes is European; no early exercise.",
    );
    expect(proseDashes("a\nb — c")).toBe("a\nb; c");
  });

  test("the large-PNG message names the size", () => {
    expect(pictureNotKeptText(2_000_000)).toMatch(/1\.5 MB picture, over the size Word reliably accepts/);
    expect(pictureNotKeptText(400_000)).toMatch(/0\.3 MB picture\)/);
  });

  test("the pane's fixed strings: superscript units in the assay figure titles; notes and assumptions punctuated before they are inserted", () => {
    expect(PANE).not.toContain("(M^-1 s^-1)");
    expect(PANE).not.toContain("(M^-1 cm^-1)");
    expect(PANE).toContain("(M⁻¹ s⁻¹)");
    expect(PANE).toContain("assayNotes.map((c) => `Note: ${proseDashes(c)}`)");
    expect(PANE).toContain("`Assumes: ${proseDashes(calc.assumes)}`");
    expect(PANE).toContain("currentFinText = insertable && insertableResultText(composed) ? composed : \"\"");
  });
});

describe("4. gate: the library-side Stats, Bio/Assay and stoichiometry tools, on their defaults", () => {
  // Defaults copied from the pane's field definitions (Stats ▸ repeated-measures ANOVA, Cox; Bio/Assay ▸ stoichiometry).
  const RM = "Stick_insect Kangaroo_testicle Fish_eye Witchetty_grub\n8 7 1 6\n9 5 2 5\n6 2 3 8\n5 3 1 9\n8 4 5 8\n7 5 6 7\n10 2 7 2\n12 6 8 1";
  const COX =
    "time status placebo\n6 1 0\n6 1 0\n6 1 0\n6 0 0\n7 1 0\n9 0 0\n10 1 0\n10 0 0\n11 0 0\n13 1 0\n16 1 0\n17 0 0\n19 0 0\n20 0 0\n22 1 0\n23 1 0\n25 0 0\n32 0 0\n32 0 0\n34 0 0\n35 0 0\n1 1 1\n1 1 1\n2 1 1\n2 1 1\n3 1 1\n4 1 1\n4 1 1\n5 1 1\n5 1 1\n8 1 1\n8 1 1\n8 1 1\n8 1 1\n11 1 1\n11 1 1\n12 1 1\n12 1 1\n15 1 1\n17 1 1\n22 1 1\n23 1 1";
  type Out = { text: string; ok?: boolean; svg?: string; caveats?: string[] };
  const cases: Array<[string, () => Out]> = [
    ["rm-ANOVA", () => rmAnovaCalc(RM, "holm") as Out],
    ["Cox", () => coxCalc(COX, "efron") as Out],
    ["stoichiometry", () => stoichCalc("2 H2 + O2 -> 2 H2O", "H2: 10.0 g\nO2: 10.0 g", "", "IUPAC-STP") as Out],
    ...ASSAY_QUANT_CALCS.map((c): [string, () => Out] => [
      c.id,
      () => {
        const d: Record<string, string> = {};
        for (const f of c.fields) d[f.key] = (f as { default?: string }).default ?? "";
        return c.compute((k) => d[k] ?? "") as unknown as Out;
      },
    ]),
  ];
  test("the scan is not vacuous", () => expect(cases.length).toBeGreaterThan(5));
  test.each(cases)("%s: the inserted text and the figure's words keep the display contract", (id, run) => {
    const out = run();
    expect(out.ok).not.toBe(false);
    // What goes into the document: the text, plus the caveats the pane appends as "Note:" lines (proseDashes'd).
    const text = [out.text, ...(out.caveats ?? []).map((c) => `Note: ${proseDashes(c)}`)].join("\n");
    expect({ id, text: violations(text) }).toEqual({ id, text: [] });
    if (out.svg) expect({ id, svg: violations(svgText(out.svg)) }).toEqual({ id, svg: [] });
  });
});
