/**
 * The E2 fix round's pins (the adversarial pass on publishable regression): decimal commas, a predictor named
 * "Constant", extreme magnitudes, numerical rank, cluster ids compared as numbers, the omitted clustered F, the
 * uncentered R² label, and the Word layout (thousands grouped, centred model columns, "< 0.001" with a no-break
 * space). The near-collinearity numerics are pinned against mpmath in olsNearCollinear.test.ts.
 */
import { econOlsCalc, econRegTableCalc, LONGLEY_DEFAULT } from "../econCalcs";
import { fitOls } from "../olsInference";
import { parseRegData, parseSpec, selectColumns } from "../regData";
import { buildRegTable, fmtFixed, groupThousands } from "../regTable";
import { parseCellNumber } from "../dataimport";
import { buildResultOoxml } from "../resultOoxml";
import { insertableResultText } from "../insertGate";
import { tableCellsInsertable } from "../damagesInterest";
import type { StatOutput } from "../analyzeBlocks";
import type { FittedModel } from "../regModel";

const NB = String.fromCharCode(0xa0);

const reader =
  (over: Record<string, string>) =>
  (k: string): string =>
    over[k] ?? ({ constant: "yes", se: "classical", cluster: "", lag: "", decimals: "3", stars: "econ" } as Record<string, string>)[k] ?? "";
const ols = (data: string, spec: string, over: Record<string, string> = {}): StatOutput => econOlsCalc(reader({ data, spec, ...over }));

/** No blank computed cell, no NaN/e-notation, and the insert gate passes. */
function clean(out: StatOutput): string[] {
  const bad: string[] = [];
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])];
  for (const s of all) {
    if (/NaN|Infinity|undefined/.test(s)) bad.push(`broken: ${s}`);
    if (/\d[eE][-+]?\d/.test(s)) bad.push(`e-notation: ${s}`);
  }
  const coef = out.tables?.[0];
  if (coef) for (const r of coef.rows.slice(1)) r.forEach((c, j) => j > 0 && c === "" && bad.push(`blank cell in ${r[0]}`));
  if (!insertableResultText(out.text)) bad.push("gate: text");
  for (const t of out.tables ?? []) if (!tableCellsInsertable(t.rows)) bad.push(`gate: ${t.label}`);
  return bad;
}

const rnd = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648 - 0.5;
};
/** A small well-conditioned table: y = 2 + 0.5x + 0.3z + noise. */
function table(n = 30, sep = "\t", fmt: (v: number) => string = (v) => String(v)): string {
  const r = rnd(11);
  const lines = [["y", "x", "z"].join(sep)];
  for (let i = 0; i < n; i++) {
    const x = Math.round((5 + 4 * r()) * 1000) / 1000;
    const z = Math.round((2 + 3 * r()) * 1000) / 1000;
    const y = Math.round((2 + 0.5 * x + 0.3 * z + r()) * 1000) / 1000;
    lines.push([y, x, z].map(fmt).join(sep));
  }
  return lines.join("\n");
}

describe("decimal commas are never misread", () => {
  const coefs = (out: StatOutput) => out.tables![0].rows.slice(1).map((r) => r[1]);
  const base = ols(table(), "y ~ x + z");
  test("a semicolon-separated table reads every comma as a decimal comma, and says so", () => {
    const o = ols(table(30, ";", (v) => String(v).replace(".", ",")), "y ~ x + z");
    expect(o.ok).not.toBe(false);
    expect(coefs(o)).toEqual(coefs(base));
    expect(o.text).toContain("The table is separated by semicolons, so its commas were read as decimal commas");
    // "1,500" in a semicolon table is one and a half; "1.234,5" groups thousands with points.
    const d = parseRegData("y;x\n1,500;1.234,5\n2;3");
    if (!d.ok) throw new Error(d.reason);
    const s = selectColumns(d.data, { dep: "y", preds: ["x"], text: "" });
    expect(s.ok && Array.from(s.cols.y)).toEqual([1.5, 2]);
    expect(s.ok && Array.from(s.cols.X[0])).toEqual([1234.5, 3]);
  });
  test("the brief's case: y;x / 0,125;1,5 reads 0.125, not 125", () => {
    const d = parseRegData("y;x\n0,125;1,5\n0,25;2,5\n0,5;3,5\n0,625;4,25");
    if (!d.ok) throw new Error(d.reason);
    const s = selectColumns(d.data, { dep: "y", preds: ["x"], text: "" });
    expect(s.ok && Array.from(s.cols.y)).toEqual([0.125, 0.25, 0.5, 0.625]);
    expect(s.ok && Array.from(s.cols.X[0])).toEqual([1.5, 2.5, 3.5, 4.25]);
  });
  test("in tab and whitespace tables a leading-zero comma cell is a decimal (0,125; −0,5), with a note", () => {
    for (const sep of ["\t", " "]) {
      const d = parseRegData(["y", "x"].join(sep) + "\n" + [["0,125", "1"], ["−0,5", "2"], ["0,75", "3"]].map((r) => r.join(sep)).join("\n"));
      if (!d.ok) throw new Error(d.reason);
      const s = selectColumns(d.data, { dep: "y", preds: ["x"], text: "" });
      if (!s.ok) throw new Error(s.reason);
      expect(Array.from(s.cols.y)).toEqual([0.125, -0.5, 0.75]);
      expect(s.cols.notes.join(" ")).toMatch(/3 cells with a decimal comma were read as decimals/);
    }
  });
  test("thousands separators alone stay thousands, without a note", () => {
    const d = parseRegData("y\tx\n1,500\t1\n2,750\t2\n12,345,678\t3");
    if (!d.ok) throw new Error(d.reason);
    const s = selectColumns(d.data, { dep: "y", preds: ["x"], text: "" });
    if (!s.ok) throw new Error(s.reason);
    expect(Array.from(s.cols.y)).toEqual([1500, 2750, 12345678]);
    expect(s.cols.notes).toEqual([]);
  });
  test("a column mixing a decimal comma with a thousands-shaped cell is refused by name", () => {
    const o = ols("y\tx\n1\t1,5\n2\t1,500\n3\t2,25\n4\t3", "y ~ x");
    expect(o.ok).toBe(false);
    expect(o.text).toBe(
      "Column “x” mixes a decimal comma (“1,5”, row 1) with a thousands separator (“1,500”, row 2), so which one a comma means is " +
        "ambiguous. Write decimals with a point, or separate the table with semicolons so that every comma is a decimal comma.",
    );
  });
  test("the shared cell reader is unchanged for the rest of the product", () => {
    expect(parseCellNumber("0,125")).toBe(125);
    expect(parseCellNumber("1,5")).toBe(1.5);
  });
});

describe("a predictor named Constant", () => {
  test("is refused by name, with or without a constant", () => {
    const data = "y\tConstant\tx\n1\t3\t1\n2\t5\t2\n4\t4\t3\n3\t8\t4\n6\t7\t5";
    for (const constant of ["yes", "no"]) {
      const o = ols(data, "y ~ Constant + x", { constant });
      expect(o.text).toBe("A predictor is named “Constant”, the name the tables give the constant term. Rename the column.");
    }
    const r = fitOls({ y: [1, 2, 4, 3, 6], depName: "y", X: [[3, 5, 4, 8, 7]], names: ["CONSTANT"], constant: true, se: "classical" });
    expect(!r.ok && r.reason).toMatch(/^A predictor is named “CONSTANT”/);
  });
});

describe("extreme magnitudes: refused by name outside 10⁻¹⁰⁰…10¹⁰⁰, exact inside", () => {
  const scaled = (sy: number, sx: number) =>
    table()
      .split("\n")
      .map((l, i) => (i === 0 ? l : l.split("\t").map((v, j) => String(Number(v) * (j === 0 ? sy : sx))).join("\t")))
      .join("\n");
  test("y near 10¹⁶⁰, y near 10⁻²⁰⁰ and x near 10³⁰⁸ are refused by name (they printed blanks, 'constant', 'no information')", () => {
    expect(ols(scaled(1e160, 1), "y ~ x + z").text).toMatch(/^“y”, row 1: .*×10¹⁶⁰ is outside the magnitudes this regression accepts \(10⁻¹⁰⁰ to 10¹⁰⁰, or 0\)/);
    expect(ols(scaled(1e-200, 1), "y ~ x + z").text).toMatch(/^“y”, row 1: .*×10⁻²⁰⁰ is outside the magnitudes/);
    expect(ols(scaled(1, 1e300), "y ~ x + z").text).toMatch(/^“x”, row 1: .*×10³⁰⁰ is outside the magnitudes/);
  });
  test("inside the range, rescaling y and x changes only the units: every cell filled, every SE and t exact", () => {
    const base = fitOls(fromTable(table()));
    for (const [sy, sx] of [
      [1e95, 1e-95],
      [1e-95, 1e95],
      [1e-90, 1e-90],
    ]) {
      const r = fitOls(fromTable(scaled(sy, sx)));
      if (!base.ok || !r.ok) throw new Error(r.ok ? "" : r.reason);
      r.model.terms.forEach((t, j) => {
        const unit = t.name === "Constant" ? sy : sy / sx;
        expect(Math.abs(t.coef / unit - base.model.terms[j].coef) / Math.abs(base.model.terms[j].coef)).toBeLessThan(1e-12);
        expect(Math.abs(t.se / unit - base.model.terms[j].se) / base.model.terms[j].se).toBeLessThan(1e-12);
      });
      const o = ols(scaled(sy, sx), "y ~ x + z");
      expect(o.ok).not.toBe(false);
      expect(clean(o)).toEqual([]);
    }
  });
  function fromTable(t: string) {
    const d = parseRegData(t);
    if (!d.ok) throw new Error(d.reason);
    const s = parseSpec("y ~ x + z");
    if ("error" in s) throw new Error(s.error);
    const c = selectColumns(d.data, s);
    if (!c.ok) throw new Error(c.reason);
    return { ...c.cols, constant: true, se: "hc1" as const };
  }
});

describe("refusal texts and numerical rank", () => {
  test("a constant column's value is quoted with ×10ⁿ, never e-notation", () => {
    expect(ols("y a\n1 1e-7\n3 1e-7\n2 1e-7\n5 1e-7", "y ~ a").text).toBe(
      '“a” is constant (every value is 1×10⁻⁷), so it is perfectly collinear with the constant. Remove it, or choose "no constant".',
    );
    expect(ols("y a\n1 -1e21\n3 -1e21\n2 -1e21\n5 -1e21", "y ~ a").text).toMatch(/every value is −1×10²¹\)/);
  });
  test("a column one unit in the last place from another (below max(n, p)·ε) is refused as collinear, naming both", () => {
    const r = rnd(5);
    const p1 = Array.from({ length: 20 }, () => 50 + r());
    // One ulp of a value in [32, 64) is 2⁻⁴⁷: the part of p2 outside p1 is then about 5×10⁻¹⁵ of its norm.
    const p2 = p1.map((v, i) => (i === 4 ? v + Math.pow(2, -47) : v));
    expect(p2[4]).not.toBe(p1[4]);
    const y = p1.map((v) => 3 + 0.5 * v + r());
    const fit = fitOls({ y, depName: "y", X: [p1, p2], names: ["p1", "p2"], constant: true, se: "hc1" });
    expect(!fit.ok && fit.reason).toBe(
      "Perfect collinearity: “p2” is an exact linear combination of “p1”, so their separate effects cannot be estimated. Drop “p2” or one of the others.",
    );
  });
});

describe("clusters", () => {
  const base = (ids: string[]) =>
    ["y\tx\tg", ...ids.map((g, i) => `${(i * 7) % 5 + i / 3}\t${(i * 3) % 7}\t${g}`)].join("\n");
  test("ids that all read as numbers are compared as numbers (01, 1, 1.0 are one cluster), said in the notes", () => {
    const messy = ["01", "1", "1.0", "2", "02", "2.0", "3", "03", "3.00", "4", "04", "4.0"];
    const tidy = messy.map((s) => String(Number(s)));
    const a = ols(base(messy), "y ~ x", { se: "cluster", cluster: "g" });
    const b = ols(base(tidy), "y ~ x", { se: "cluster", cluster: "g" });
    expect(a.ok).not.toBe(false);
    expect(a.text).toContain("Standard errors: Clustered by g, 4 clusters");
    expect(a.tables![0].rows).toEqual(b.tables![0].rows);
    expect(a.text).toContain("Every cluster id in “g” reads as a number, so the ids are compared as numbers (“01”, “1” and “1.0” are one cluster): 12 distinct spellings, 4 clusters.");
  });
  test("text ids stay text", () => {
    const o = ols(base(["a", "A", "b", "B", "a", "A", "b", "B", "c", "C", "c", "C"]), "y ~ x", { se: "cluster", cluster: "g" });
    expect(o.text).toContain("6 clusters");
    expect(o.text).not.toContain("reads as a number");
  });
  test("a clustered F with more restrictions than G − 1 is omitted, as Stata does, and the notes say so", () => {
    const r = rnd(3);
    const lines = ["y\ta\tb\tc\tg"];
    for (let i = 0; i < 18; i++) lines.push([r() + i / 4, r(), r(), r(), ["A", "B", "C"][i % 3]].join("\t"));
    const o = ols(lines.join("\n"), "y ~ a + b + c", { se: "cluster", cluster: "g" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("F is not reported: 3 restrictions exceed G − 1 = 2 (as Stata).");
    expect(o.text).toContain("The clustered Wald F is omitted, as Stata does: its 3 restrictions exceed G − 1 = 2");
    const t = econRegTableCalc(reader({ data: lines.join("\n"), specs: "y ~ a + b + c", se: "cluster", cluster: "g" }));
    expect(t.text).toContain("The clustered Wald F is omitted, as Stata does");
  });
});

describe("the publication table", () => {
  const out = econRegTableCalc(reader({ data: LONGLEY_DEFAULT, specs: "TOTEMP ~ GNP + POP\nTOTEMP ~ GNP + POP + UNEMP" }));
  test("model columns are centred, the term column left", () => {
    expect(out.tables![0].align).toEqual(["left", "center", "center"]);
  });
  test("in Word the coefficient, its (SE) and the (1) header share the centred alignment", () => {
    const t = out.tables![0];
    const { ooxml } = buildResultOoxml([{ kind: "table", label: t.label, rows: t.rows, align: t.align }]);
    const cell = (text: string) => new RegExp(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>(?:<w:rPr>.*?</w:rPr>)?<w:t[^>]*>${text.replace(/[()*.]/g, "\\$&")}</w:t>`);
    // "(1)", the dependent-variable row, a coefficient and the "(0.011)" under it.
    expect(t.rows[3][1]).toMatch(/^\(\d/);
    for (const c of ["(1)", "TOTEMP", t.rows[2][1], t.rows[3][1]]) expect(ooxml).toMatch(cell(c));
    // Without align, the old rule: numbers right, words left.
    const plain = buildResultOoxml([{ kind: "table", label: "", rows: [["a", "1.5"]] }]).ooxml;
    expect(plain).toContain('<w:jc w:val="right"/>');
  });
  test("thousands are grouped in cells and N", () => {
    const m: FittedModel = {
      kind: "ols",
      depName: "y",
      n: 50000,
      terms: [{ name: "Constant", coef: -3482258.635, se: 1109615.441, stat: -3.1, p: 0.002, ciLo: 0, ciHi: 1 }],
      statLabel: "t",
      df: 49999,
      seLabel: "Classical",
      stats: [{ label: "R²", value: 0.5 }],
      notes: [],
    };
    const t = buildRegTable([m]);
    expect(t.rows.find((r) => r[0] === "Constant")![1]).toBe("−3,482,258.635***");
    expect(t.rows.find((r) => r[0] === "Constant") && t.rows[t.rows.findIndex((r) => r[0] === "Constant") + 1][1]).toBe("(1,109,615.441)");
    expect(t.rows.find((r) => r[0] === "N")![1]).toBe("50,000");
    expect(groupThousands("-1234.5")).toBe("-1,234.5");
    expect(fmtFixed(999.9996, 3)).toBe("1,000.000");
    // Grouped values still read back as the same number.
    expect(parseCellNumber("1,109,615.441")).toBe(1109615.441);
  });
  test("a model without a constant labels the row R² (uncentered)", () => {
    const o = econRegTableCalc(reader({ data: LONGLEY_DEFAULT, specs: "TOTEMP ~ GNP + POP", constant: "no" }));
    expect(o.tables![0].rows.find((r) => r[0].startsWith("R²"))![0]).toBe("R² (uncentered)");
    expect(out.tables![0].rows.find((r) => r[0].startsWith("R²"))![0]).toBe("R²");
  });
  test("p < 0.001 carries a no-break space in the text and the cells, and passes the insert gate", () => {
    const o = ols(LONGLEY_DEFAULT, "TOTEMP ~ GNP + POP");
    expect(o.text).toMatch(new RegExp(`p <${NB}0\\.001`));
    expect(o.text).not.toMatch(/< 0\.001/);
    expect(o.tables![0].rows.flat().some((c) => c === `<${NB}0.001`)).toBe(true);
    expect(insertableResultText(o.text)).toBe(true);
  });
});

describe("notes are truthful", () => {
  test("no-constant VIF: the uncentred VIF, statsmodels standardize=False", () => {
    const o = ols(LONGLEY_DEFAULT, "TOTEMP ~ GNP + POP", { constant: "no" });
    expect(o.text).toContain("statsmodels variance_inflation_factor with standardize=False");
    expect(o.text).not.toContain("as statsmodels does");
  });
  test("the default Newey–West lag is called a rule of thumb, not a Stata or statsmodels default", () => {
    const o = ols(LONGLEY_DEFAULT, "TOTEMP ~ GNP + POP", { se: "hac" });
    expect(o.text).toContain("the rule of thumb of Newey and West, 1994");
  });
});
