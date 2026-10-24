// v2.193 regression fixes (fix-reg). Each row pins the corrected outcome of a confirmed regression.

import * as fs from "fs";
import * as path from "path";
import { formatMatrix, formatMatrixCells, inverse, multiply } from "../linalg";
import { buildTableOfAuthorities } from "../toa";
import { parseMathAst } from "../mathParse";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { latexToDsl } from "../latex";
import { buildResultOoxml, packageBodyXml } from "../resultOoxml";
import { schemeCaptionOoxml } from "../bibOoxml";
import { parseNumberCell, parseTableData } from "../tablechart";
import { parseCellNumber } from "../dataimport";
import { classifyTable } from "../tableclassify";
import { tidyDisplay, tidySvgText, typesetMinus } from "../subscriptText";
import { levelSum } from "../audio";
import { exposureValue } from "../photometry";
import { modalAnalysis } from "../vibration";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
const HOST = fs.readFileSync(path.join(__dirname, "..", "..", "host", "wordFigures.ts"), "utf8").replace(/\r\n/g, "\n");

describe("1. a matrix is never snapped to 0 for display", () => {
  test("inverse(diag(10¹⁵, 1)) shows 1×10⁻¹⁵, not 0", () => {
    const inv = inverse([[1e15, 0], [0, 1]])!;
    expect(formatMatrixCells(inv, 6)).toEqual([["1×10⁻¹⁵", "0"], ["0", "1"]]);
  });
  test("[[6.02×10²³, 1], [1, 1]] keeps its 1s", () => {
    expect(formatMatrixCells([[6.02e23, 1], [1, 1]], 6)).toEqual([["6.02×10²³", "1"], ["1", "1"]]);
  });
  test("[[2×10¹¹, 0.001], [0.001, 1]] keeps its 0.001s", () => {
    expect(formatMatrixCells([[2e11, 0.001], [0.001, 1]], 6)).toEqual([["200000000000", "0.001"], ["0.001", "1"]]);
    expect(formatMatrix([[2e11, 0.001], [0.001, 1]])).toContain("0.001");
  });
  test("true minus and ×10ⁿ stay; non-finite stays the — the insert gate refuses", () => {
    expect(formatMatrixCells([[-2.5e-7, -3]], 6)).toEqual([["−2.5×10⁻⁷", "−3"]]);
    expect(formatMatrixCells([[NaN, Infinity]], 6)).toEqual([["—", "—"]]);
  });
  test("round-off residue is shown, not hidden (A·A⁻¹ is the caller's business)", () => {
    const a = [[4, 7], [2, 6]];
    const p = multiply(a, inverse(a)!)!;
    const cells = formatMatrixCells(p, 6);
    expect(cells[0][0]).toBe("1");
    expect(cells[1][1]).toBe("1");
  });
});

describe("2. spelled-out federal rules: singular and in range only", () => {
  const rules = (text: string): string[] =>
    buildTableOfAuthorities(text).groups.filter((g) => g.heading === "Rules").flatMap((g) => g.entries.map((e) => e.plain));
  test("the plural rule-set name with a year is not a rule", () => {
    expect(rules("The Federal Rules of Civil Procedure 2015 amendments changed discovery.")).toEqual([]);
    expect(rules("After the Federal Rules of Evidence 2011 restyling, the text changed.")).toEqual([]);
  });
  test("singular forms still list", () => {
    expect(rules("Rule 702 of the Federal Rules of Evidence applies.")).toEqual(["Fed. R. Evid. 702"]);
    expect(rules("Federal Rule of Civil Procedure 12(b)(6) applies.")).toEqual(["Fed. R. Civ. P. 12"]);
    expect(rules("Federal Rule of Bankruptcy Procedure 3001 applies.")).toEqual(["Fed. R. Bankr. P. 3001"]);
    expect(rules("Rule 48 of the Federal Rules of Appellate Procedure; Federal Rule of Criminal Procedure 61.")).toEqual([
      "Fed. R. App. P. 48",
      "Fed. R. Crim. P. 61",
    ]);
  });
  test.each([
    ["Federal Rule of Civil Procedure 87"],
    ["Federal Rule of Evidence 100"],
    ["Federal Rule of Evidence 1104"],
    ["Rule 62 of the Federal Rules of Criminal Procedure"],
    ["Rule 49 of the Federal Rules of Appellate Procedure"],
    ["Federal Rule of Bankruptcy Procedure 1000"],
    ["Federal Rule of Bankruptcy Procedure 9038"],
    ["Federal Rule of Civil Procedure 2015"],
  ])("out of range: %s → not a rule (refused by name)", (text) => {
    const t = buildTableOfAuthorities(`${text} applies.`);
    expect(t.groups.filter((g) => g.heading === "Rules")).toEqual([]);
    expect(t.refused?.some((r) => /runs from Rule/.test(r.reason))).toBe(true);
  });
  test("in-range edges list", () => {
    expect(rules("Federal Rule of Evidence 1103 and Federal Rule of Evidence 101.")).toEqual(["Fed. R. Evid. 101", "Fed. R. Evid. 1103"]);
    expect(rules("Federal Rule of Civil Procedure 86.")).toEqual(["Fed. R. Civ. P. 86"]);
    expect(rules("Federal Rule of Bankruptcy Procedure 9037.")).toEqual(["Fed. R. Bankr. P. 9037"]);
  });
});

describe("3. deg is the degree sign only after a number", () => {
  test("90 deg → 90°; 25 deg C → 25° C", () => {
    expect(mathToHtml("90 deg")).toBe("90°");
    expect(mathToHtml("25 deg C")).toContain("25°");
  });
  test("deg f + deg g is the upright function name, never °", () => {
    const html = mathToHtml("deg f + deg g");
    expect(html).not.toContain("°");
    expect(html).toContain("deg");
    const ast = parseMathAst("deg f");
    expect(ast.k === "row" && ast.items[0].k === "text" && ast.items[0].plain && ast.items[0].v).toBe("deg");
  });
  test("LaTeX \\deg is always the function", () => {
    expect(mathToHtml(latexToDsl("\\deg p"))).not.toContain("°");
    expect(mathToHtml(latexToDsl("2\\deg"))).not.toContain("°");
    expect(mathToHtml(latexToDsl("\\deg(p+q)"))).not.toContain("°");
    expect(mathToHtml(latexToDsl("\\deg p"))).toContain("deg");
  });
});

describe("4. the scheme caption package carries no styles part", () => {
  const pkg = buildResultOoxml([
    { kind: "xml", content: packageBodyXml(schemeCaptionOoxml(1, "Synthesis")) },
    { kind: "picture", caption: "", base64: "AAAA", widthPt: 100, heightPt: 50, alt: "scheme" },
  ]);
  test("pStyle kept, no styles.xml, no styles relationship", () => {
    expect(pkg.ooxml).toContain('<w:pStyle w:val="Caption"/>');
    expect(pkg.ooxml).not.toContain("styles.xml");
    expect(pkg.ooxml).not.toContain("relationships/styles");
    expect(pkg.ooxml).not.toContain("<w:styles");
  });
  test("a caption-only package needs no rels part", () => {
    const only = buildResultOoxml([{ kind: "xml", content: packageBodyXml(schemeCaptionOoxml(1, "x")) }]).ooxml;
    expect(only).not.toContain("document.xml.rels");
  });
  test("the host styles the package's first paragraph by built-in Caption name when asked; the pane asks for the scheme", () => {
    // The first paragraph is loaded with the content, and styled in its OWN guarded batch after the main sync, only
    // when it really starts with the caption text (an insert at the end of "my text" merges into it — COM measured).
    expect(HOST).toMatch(/if \(item\.captionPrefix\)[\s\S]{0,200}inserted\.paragraphs\.getFirst\(\)[\s\S]{0,80}load\("text"\)/);
    const iMain = HOST.indexOf("anchor.select(Word.SelectionMode.end);\n    await context.sync();");
    const iStyle = HOST.indexOf("c.para.styleBuiltIn = Word.BuiltInStyleName.caption");
    expect(iMain).toBeGreaterThan(0);
    expect(iStyle).toBeGreaterThan(iMain);
    expect(HOST.slice(iMain, iStyle)).toMatch(/startsWith\(c\.prefix\)[\s\S]*try \{/);
    const start = PANE.indexOf("async function insertReactionNow()");
    const body = PANE.slice(start, PANE.indexOf("mergeIntoRegister", start));
    expect(body).toContain('captionPrefix: n > 0 ? "Scheme " : undefined');
  });
});

describe("5. derivation + figure: the figure renders first; a failure keeps the typeset derivation", () => {
  const start = PANE.indexOf("async function insertDerivationWithFigure(");
  const body = PANE.slice(start, PANE.indexOf("\n}\n", start));
  test("renderFigurePng runs before buildResultOoxml and outside the package try", () => {
    expect(body.indexOf("renderFigurePng(")).toBeGreaterThan(0);
    expect(body.indexOf("renderFigurePng(")).toBeLessThan(body.indexOf("buildResultOoxml("));
  });
  test("no plain-text fallback: failures go through insertDerivation (OMML)", () => {
    expect(body).not.toContain("insertPlainText(");
    expect(body.match(/insertDerivation\(blocks, plain, label\)/g)).toHaveLength(2);
    expect(body).toMatch(/figure could not be drawn/);
  });
});

describe("6. ×10ⁿ table cells read as the whole number", () => {
  test.each([
    ["3.3×10⁷", 3.3e7],
    ["2.5×10⁻⁷", 2.5e-7],
    ["−4×10³", -4e3],
    ["3x10^-4", 3e-4],
    ["1.5 × 10⁶", 1.5e6],
    ["(2×10³)", -2e3],
  ])("%s → %d", (cell, v) => {
    expect(parseNumberCell(cell)).toBeCloseTo(v, 12 - Math.round(Math.log10(Math.abs(v))));
    expect(parseNumberCell(cell)! / v).toBeCloseTo(1, 12);
  });
  test("agrees with dataimport.parseCellNumber", () => {
    for (const c of ["3.3×10⁷", "2.5×10⁻⁷", "−4×10³", "1,5×10⁻⁵"]) expect(parseNumberCell(c)).toBe(parseCellNumber(c));
  });
  test("a ×10ⁿ tail that cannot be read is refused, never its mantissa", () => {
    expect(parseNumberCell("3.3×10⁷kg")).toBeNull();
    expect(parseNumberCell("2×10³×10²")).toBeNull();
  });
  test("plain cells unchanged", () => {
    expect(parseNumberCell("1.2K")).toBe(1200);
    expect(parseNumberCell("12kg")).toBe(12);
    expect(parseNumberCell("1.2e5")).toBe(1.2e5);
    expect(parseNumberCell("-$300")).toBe(-300);
  });
  test("Table → Chart charts the whole value; tableclassify agrees with a plain-number column", () => {
    const rows = [["Sample", "Count"], ["A", "3.3×10⁷"], ["B", "2.5×10⁻⁷"], ["C", "−4×10³"]];
    expect(parseTableData(rows).series[0].values).toEqual([3.3e7, 2.5e-7, -4e3]);
    const plain = [["Sample", "Count"], ["A", "33000000"], ["B", "0.00000025"], ["C", "-4000"]];
    expect(classifyTable(rows).kind).toBe(classifyTable(plain).kind);
  });
  test("resultOoxml right-aligns a ×10ⁿ cell (looksNumeric agrees)", () => {
    const x = buildResultOoxml([{ kind: "table", label: "", rows: [["Count"], ["3.3×10⁷"], ["−4×10³"]] }]).ooxml;
    expect(x.match(/<w:jc w:val="right"\/>/g)).toHaveLength(2);
  });
});

describe("7. an e-notation number as the base of a power is bracketed", () => {
  test("1e-3^2 → (1×10⁻³)²", () => {
    const ast = parseMathAst("1e-3^2");
    expect(ast.k).toBe("sup");
    expect(ast.k === "sup" && ast.base.k).toBe("delim");
    expect(mathToHtml("1e-3^2")).toMatch(/^\(1<span class="m-op">×<\/span>10<sup>.*3<\/sup>\)<sup>2<\/sup>$/);
    expect(mathToOmml("1e-3^2")).toContain("<m:d>");
  });
  test("1e-3 alone is not bracketed", () => {
    expect(parseMathAst("1e-3").k).toBe("row");
  });
});

describe("low: dot, SVG mixed text, carets in prose, spaced ranges", () => {
  test("a dot (b × c) is the dot product; dot(x) is still the accent", () => {
    const ast = parseMathAst("a dot (b × c)");
    expect(JSON.stringify(ast)).toContain('"v":"·"');
    expect(JSON.stringify(ast)).not.toContain('"k":"acc"');
    expect(parseMathAst("dot(x)").k).toBe("acc");
    expect(parseMathAst("dot(a, b)").k).toBe("func");
  });
  test("tidySvgText reaches text after a </tspan>", () => {
    expect(tidySvgText("<text>a<tspan>b</tspan> 1e-3</text>")).toBe("<text>a<tspan>b</tspan> 1×10⁻³</text>");
    expect(tidySvgText('<g id="1e-3"><text x="1e-3">5e4</text></g>')).toBe('<g id="1e-3"><text x="1e-3">5×10⁴</text></g>');
  });
  test("no carets in the notes of audio-levelmath, light-exposure, vib-modal", () => {
    const sum = levelSum([80, 80, 74]);
    expect("notes" in sum && sum.notes.join(" ")).not.toContain("^");
    const ev = exposureValue(8, 1 / 125);
    expect(JSON.stringify(ev)).not.toContain("^");
    const modal = modalAnalysis([[2, 0], [0, 1]], [[6, -2], [-2, 4]]);
    expect(JSON.stringify(modal)).not.toContain("^");
    expect(JSON.stringify(modal)).toContain("φᵀMφ = 1");
  });
  test("a spaced range between plain numbers is an en dash only in a range context", () => {
    expect(typesetMinus("a range of 10 - 20 mm")).toBe("a range of 10–20 mm");
    expect(typesetMinus("between 1.5 - 2.5 V")).toBe("between 1.5–2.5 V");
    expect(typesetMinus("from 3 - 7")).toBe("from 3–7");
    expect(typesetMinus("Δ = 10 - 20")).toBe("Δ = 10 − 20");
    expect(typesetMinus("0-100 and 2019-2020")).toBe("0-100 and 2019-2020");
    expect(tidyDisplay("range of 10 - 20")).not.toContain("—");
  });
});
