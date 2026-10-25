/**
 * The Release E2 regression calculators end to end (lib/econCalcs.ts): the shipped Longley defaults, the display
 * contract on every cell, the hostile inputs the brief lists, and the 50,000 × 20 timing case.
 */
import * as fs from "fs";
import * as path from "path";
import { econOlsCalc, econRegTableCalc, LONGLEY_DEFAULT, ECON_SPEC_DEFAULT, ECON_SPECS_DEFAULT } from "../econCalcs";
import { fitOls, olsDiagnostics } from "../olsInference";
import { parseRegData, parseSpec, parseSpecList, selectColumns } from "../regData";
import { buildRegTable, fmtFixed, fmtP, starsFor } from "../regTable";
import { insertableResultText } from "../insertGate";
import { tableCellsInsertable } from "../damagesInterest";
import type { StatOutput } from "../analyzeBlocks";
import type { FittedModel } from "../regModel";

/** U+00A0: "< 0.001" never breaks. */
const NB = String.fromCharCode(0xa0);

const reader =
  (over: Record<string, string>) =>
  (k: string): string =>
    over[k] ??
    ({
      data: LONGLEY_DEFAULT,
      spec: ECON_SPEC_DEFAULT,
      specs: ECON_SPECS_DEFAULT,
      constant: "yes",
      se: "classical",
      cluster: "",
      lag: "",
      decimals: "3",
      stars: "econ",
    } as Record<string, string>)[k] ??
    "";

/** Every display-contract rule the brief pins, over text, cells and notes. */
function contractViolations(out: StatOutput): string[] {
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])];
  const bad: string[] = [];
  for (const s of all) {
    if (/\d-\d|(^|[\s(\[=])-\d/.test(s)) bad.push(`hyphen minus: ${s}`);
    if (/\d[eE][-+]?\d/.test(s)) bad.push(`e-notation: ${s}`);
    if (/NaN|Infinity|undefined/.test(s)) bad.push(`broken: ${s}`);
    if (s.includes("—")) bad.push(`em dash: ${s}`);
    if (/R\^?2\b/.test(s)) bad.push(`R2: ${s}`);
    if (/p [=<] 0\.000\b|0\.000\*/.test(s)) bad.push(`zero p: ${s}`);
  }
  if (!insertableResultText(out.text)) bad.push("text fails the insert gate");
  for (const t of out.tables ?? []) if (!tableCellsInsertable(t.rows)) bad.push(`table ${t.label} fails the gate`);
  return bad;
}

describe("econ-ols on the Longley default", () => {
  const out = econOlsCalc(reader({}));
  test("ok, with the summary, two tables and the residual figure", () => {
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("OLS regression of TOTEMP on 6 predictors (n = 16)");
    expect(out.text).toContain("R² = 0.995, adjusted R² = 0.992");
    expect(out.text).toContain(`F(6, 9) = 330.285, p <${NB}0.001`);
    expect(out.tables?.map((t) => t.label)).toEqual(["Coefficients: TOTEMP, Classical", "Diagnostics"]);
    expect(out.svg).toContain("Residuals vs fitted");
  });
  test("the coefficient table: term, coef, SE, t, p, 95% CI, constant last", () => {
    const rows = out.tables![0].rows;
    expect(rows[0]).toEqual(["Term", "Coef.", "SE", "t", "p", "95% CI"]);
    expect(rows.map((r) => r[0])).toEqual(["Term", "GNPDEFL", "GNP", "UNEMP", "ARMED", "POP", "YEAR", "Constant"]);
    // statsmodels: UNEMP −2.0202 (SE 0.4884, t −4.136, p 0.0025); Constant −3482258.63.
    expect(rows[3]).toEqual(["UNEMP", "−2.020***", "0.488", "−4.136", "0.003", "[−3.125; −0.915]"]);
    expect(rows[7][1]).toBe("−3,482,258.635***");
    expect(out.tables![0].note).toContain("* p < 0.10, ** p < 0.05, *** p < 0.01");
  });
  test("diagnostics table, White skipped by name (28 auxiliary regressors, 16 rows)", () => {
    const rows = out.tables![1].rows;
    expect(rows[0]).toEqual(["Test", "Statistic", "df", "p"]);
    expect(rows.find((r) => r[0] === "White")![1]).toMatch(/^not computed: needs more rows than its 28 auxiliary regressors/);
    expect(rows.find((r) => r[0] === "Durbin–Watson")![1]).toBe("2.559");
    expect(rows.find((r) => r[0] === "VIF: GNP")![1]).toBe("1,788.51");
  });
  test("the display contract holds everywhere", () => {
    expect(contractViolations(out)).toEqual([]);
  });
  for (const se of ["hc0", "hc1", "hc2", "hc3", "hac"]) {
    test(`${se}: ok and clean`, () => {
      const o = econOlsCalc(reader({ se }));
      expect(o.ok).not.toBe(false);
      expect(contractViolations(o)).toEqual([]);
    });
  }
  test("conventions are printed", () => {
    expect(out.text).toContain("a constant is included (shown last");
    expect(out.text).toContain("listwise deletion");
    const hac = econOlsCalc(reader({ se: "hac" }));
    expect(hac.text).toContain("Newey–West HAC, lag 2");
    expect(hac.text).toContain("as Stata's newey");
  });
});

describe("econ-regtable on the Longley default", () => {
  const out = econRegTableCalc(reader({}));
  test("three models side by side", () => {
    expect(out.ok).not.toBe(false);
    const rows = out.tables![0].rows;
    expect(rows[0]).toEqual(["", "(1)", "(2)", "(3)"]);
    expect(rows[1]).toEqual(["", "TOTEMP", "TOTEMP", "TOTEMP"]);
    // GNPDEFL only in model 3: blank in (1) and (2).
    const i = rows.findIndex((r) => r[0] === "GNPDEFL");
    expect(rows[i].slice(1, 3)).toEqual(["", ""]);
    expect(rows[i + 1][0]).toBe("");
    expect(rows[i + 1][3]).toMatch(/^\(\d/);
    expect(rows.slice(-3).map((r) => r[0])).toEqual(["N", "R²", "SE type"]);
    expect(rows[rows.length - 3].slice(1)).toEqual(["16", "16", "16"]);
    expect(out.tables![0].note).toBe("Standard errors in parentheses. * p < 0.10, ** p < 0.05, *** p < 0.01.");
    expect(contractViolations(out)).toEqual([]);
  });
  test("a failing model is named", () => {
    const o = econRegTableCalc(reader({ specs: "TOTEMP ~ GNP\nTOTEMP ~ NOPE" }));
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Model 2 \(TOTEMP ~ NOPE\): No column is named “NOPE”/);
  });
});

describe("regTable", () => {
  const model = (over: Partial<FittedModel>): FittedModel => ({
    kind: "ols",
    depName: "y",
    n: 50,
    terms: [
      { name: "x", coef: 0.5, se: 0.1, stat: 5, p: 0.00001, ciLo: 0.3, ciHi: 0.7 },
      { name: "Constant", coef: 1, se: 0.5, stat: 2, p: 0.05, ciLo: 0, ciHi: 2 },
    ],
    statLabel: "t",
    df: 48,
    seLabel: "Classical",
    stats: [{ label: "R²", value: 0.4 }],
    notes: [],
    ...over,
  });
  test("star schemes", () => {
    expect([0.2, 0.09, 0.04, 0.009].map((p) => starsFor(p, "econ"))).toEqual(["", "*", "**", "***"]);
    expect([0.06, 0.04, 0.009, 0.0009].map((p) => starsFor(p, "sci"))).toEqual(["", "*", "**", "***"]);
    expect(starsFor(0.0001, "none")).toBe("");
  });
  test("numbers under the display contract", () => {
    expect(fmtFixed(-0.0004, 3)).toBe("−4.000×10⁻⁴");
    expect(fmtFixed(-0.0001, 0)).toBe("−1.000×10⁻⁴");
    expect(fmtFixed(-0.00001 + 0.00001, 3)).toBe("0.000");
    expect(fmtFixed(-1e-20 * 0, 3)).toBe("0.000");
    expect(fmtFixed(2.5e7, 2)).toBe("25,000,000.00");
    expect(fmtFixed(2.5e10, 2)).toBe("2.500×10¹⁰");
    expect(fmtFixed(-1.23456, 2)).toBe("−1.23");
    expect(fmtP(0.0004)).toBe(`<${NB}0.001`);
    expect(fmtP(0.0456)).toBe("0.046");
  });
  test("any FittedModel drops in: logit beside OLS uses pseudo R² and z", () => {
    const t = buildRegTable(
      [
        model({}),
        model({ kind: "logit", statLabel: "z", seLabel: "Classical (MLE)", stats: [{ label: "Pseudo R²", value: 0.21 }] }),
      ],
      { decimals: 2 },
    );
    const r2 = t.rows.find((r) => r[0] === "R² / pseudo R²")!;
    expect(r2).toEqual(["R² / pseudo R²", "0.40", "0.21"]);
    expect(t.rows[2]).toEqual(["x", "0.50***", "0.50***"]);
    expect(t.rows[3]).toEqual(["", "(0.10)", "(0.10)"]);
    expect(t.legend).toContain("t (OLS) or z (logit, probit)");
  });
  test("decimals option 2–4 and the no-star legend", () => {
    const t = buildRegTable([model({})], { decimals: 4, stars: "none" });
    expect(t.rows[2][1]).toBe("0.5000");
    expect(t.legend).toBe("Standard errors in parentheses.");
  });
});

describe("regData", () => {
  test("a header row of names; unnamed rows are y, x1, x2", () => {
    const a = parseRegData("wage educ\n10 12\n12 16");
    expect(a.ok && a.data.names).toEqual(["wage", "educ"]);
    const b = parseRegData("10 12 3\n12 16 4");
    expect(b.ok && b.data.names).toEqual(["y", "x1", "x2"]);
  });
  test("specs: one ~, names with spaces, '.' for all others, one per line", () => {
    expect(parseSpec("log wage ~ years of school + exper")).toEqual({ dep: "log wage", preds: ["years of school", "exper"], text: "log wage ~ years of school + exper" });
    expect("error" in parseSpec("y ~ a ~ b")).toBe(true);
    expect("error" in parseSpec("y ~ a + + b")).toBe(true);
    const l = parseSpecList("y ~ a\n\ny ~ a + b\n");
    expect(Array.isArray(l) && l.length).toBe(2);
    const d = parseRegData("y\ta\tb\tfirm\n1\t2\t3\tA\n2\t3\t5\tB")!;
    if (!d.ok) throw new Error();
    const s = parseSpec("y ~ .");
    if ("error" in s) throw new Error();
    const sel = selectColumns(d.data, s, { cluster: "firm" });
    expect(sel.ok && sel.cols.names).toEqual(["a", "b"]);
  });
  test("missing cells are dropped listwise with a note; text cells refused by column and row", () => {
    const d = parseRegData("y\tx\tz\n1\t2\t\n2\tNA\t1\n3\t4\t1\n4\t5\t2\n5\t7\t3");
    if (!d.ok) throw new Error();
    const s = parseSpec("y ~ x");
    if ("error" in s) throw new Error();
    const sel = selectColumns(d.data, s);
    expect(sel.ok && sel.cols.y.length).toBe(4); // z's blank does not drop row 1: z is unused
    expect(sel.ok && sel.cols.notes[0]).toMatch(/^1 row with a missing cell .* was dropped \(listwise deletion\); 4 used\./);
    const t = parseRegData("y\tx\n1\t2\n2\tabc\n3\t4");
    if (!t.ok) throw new Error();
    const r = selectColumns(t.data, s);
    expect(!r.ok && r.reason).toBe("Column “x”, row 2: “abc” is not a number.");
  });
  test("a short whitespace row is refused, not guessed", () => {
    const r = parseRegData("y x z\n1 2 3\n4 5");
    expect(!r.ok && r.reason).toMatch(/^Row 2 has 2 values but there are 3 columns/);
  });
  test("unknown and duplicate names", () => {
    const d = parseRegData("y x\n1 2\n2 3\n3 5");
    if (!d.ok) throw new Error();
    const r = selectColumns(d.data, { dep: "y", preds: ["q"], text: "" });
    expect(!r.ok && r.reason).toBe("No column is named “q”. The columns are “y”, “x”.");
    const r2 = selectColumns(d.data, { dep: "y", preds: ["x", "X"], text: "" });
    expect(!r2.ok && r2.reason).toBe("“x” is listed twice in the model.");
  });
});

describe("hostile inputs: named refusals, never a number that is not one", () => {
  const ols = (data: string, spec: string, over: Record<string, string> = {}) => econOlsCalc(reader({ data, spec, ...over }));
  test("perfect collinearity names the columns", () => {
    const o = ols("y a b c\n1 1 2 3\n3 2 1 3\n2 3 5 8\n5 4 4 8\n4 5 1 6\n6 6 3 9", "y ~ a + b + c");
    expect(o.ok).toBe(false);
    expect(o.text).toBe(
      "Perfect collinearity: “c” is an exact linear combination of “a” and “b”, so their separate effects cannot be estimated. Drop “c” or one of the others.",
    );
  });
  test("a constant column beside the constant", () => {
    const o = ols("y a k\n1 1 5\n3 2 5\n2 3 5\n5 4 5\n4 6 5", "y ~ a + k");
    expect(o.text).toBe('“k” is constant (every value is 5), so it is perfectly collinear with the constant. Remove it, or choose "no constant".');
  });
  test("n ≤ k", () => {
    const o = ols("y a b\n1 1 2\n3 2 1\n2 3 5", "y ~ a + b");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^n = 3 observations for 3 coefficients: OLS needs more observations than coefficients/);
  });
  test("an exact fit is refused, not printed with SE 0", () => {
    const o = ols("y a\n2 1\n4 2\n6 3\n8 4", "y ~ a");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^The data lie exactly on the fitted surface/);
  });
  test("a single cluster, and clusters of size 1", () => {
    const base = "y\ta\tg\n1\t1\tA\n3\t2\tA\n2\t3\tA\n5\t4\tA\n4\t6\tA";
    expect(ols(base, "y ~ a", { se: "cluster", cluster: "g" }).text).toBe(
      "Clustered standard errors need at least two clusters; “g” has one value in every row used.",
    );
    const ones = "y\ta\tg\n1\t1\tA\n3\t2\tB\n2\t3\tC\n5\t4\tD\n4\t6\tE";
    const o = ols(ones, "y ~ a", { se: "cluster", cluster: "g" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Every cluster holds one row");
    expect(contractViolations(o)).toEqual([]);
    expect(ols(ones, "y ~ a", { se: "cluster", cluster: "" }).text).toBe("Name the cluster column (clustered standard errors).");
  });
  test("HC2/HC3 refuse a row of leverage 1, by row", () => {
    // A dummy that is 1 in one row only gives that row leverage 1.
    const o = ols("y a d\n1 1 0\n3 2 0\n2 3 0\n5 4 0\n4 6 1", "y ~ a + d", { se: "hc3" });
    expect(o.text).toMatch(/^Row 5 has leverage 1/);
  });
  test("scale equivariance: predictors ×10⁻¹² and ×10¹² change only their slopes", () => {
    const d = parseRegData(LONGLEY_DEFAULT);
    if (!d.ok) throw new Error();
    const s = parseSpec(ECON_SPEC_DEFAULT);
    if ("error" in s) throw new Error();
    const sel = selectColumns(d.data, s);
    if (!sel.ok) throw new Error();
    const base = fitOls({ ...sel.cols, constant: true, se: "hc1" });
    const scales = [1e-12, 1e12, 1, 1e-12, 1e12, 1];
    const scaled = fitOls({ ...sel.cols, X: sel.cols.X.map((c, j) => c.map((v) => v * scales[j])), constant: true, se: "hc1" });
    if (!base.ok || !scaled.ok) throw new Error("fit failed");
    base.model.terms.forEach((t, j) => {
      const sc = j < 6 ? scales[j] : 1;
      expect(Math.abs(scaled.model.terms[j].coef * sc - t.coef) / Math.abs(t.coef)).toBeLessThan(1e-7);
      expect(Math.abs(scaled.model.terms[j].stat - t.stat) / Math.abs(t.stat)).toBeLessThan(1e-7);
    });
  });
  test("non-convergence cannot happen (closed form), and non-finite input is refused by the reader", () => {
    const o = ols("y a\n1 1\n2 1e400\n3 4", "y ~ a");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/is not a number/);
  });
  test("bad HAC lag and lag ≥ n", () => {
    expect(ols(LONGLEY_DEFAULT, ECON_SPEC_DEFAULT, { se: "hac", lag: "1.5" }).text).toMatch(/^Newey–West lag: “1.5” is not a whole number/);
    expect(ols(LONGLEY_DEFAULT, ECON_SPEC_DEFAULT, { se: "hac", lag: "16" }).text).toBe(
      "The Newey–West lag (16) must be less than the number of rows (16).",
    );
  });
  test("no constant: uncentered R² said, BP and White skipped by name", () => {
    const o = ols(LONGLEY_DEFAULT, "TOTEMP ~ GNP + POP", { constant: "no" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("R² is uncentered");
    const bp = o.tables![1].rows.find((r) => r[0] === "Breusch–Pagan (Koenker)")!;
    expect(bp[1]).toBe("not computed: needs a model with a constant");
  });
});

describe("50,000 rows × 20 predictors does not freeze the pane", () => {
  test("fit + diagnostics under about a second", () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const n = 50000;
    const X: Float64Array[] = Array.from({ length: 20 }, () => Float64Array.from({ length: n }, rnd));
    const y = Float64Array.from({ length: n }, (_, i) => X.reduce((s, c, j) => s + (j + 1) * c[i], 0) + rnd());
    const t0 = Date.now();
    const r = fitOls({ y, depName: "y", X, names: X.map((_, j) => `x${j + 1}`), constant: true, se: "hc1" });
    if (!r.ok) throw new Error(r.reason);
    const d = olsDiagnostics(r);
    const ms = Date.now() - t0;
    expect("skipped" in d.white && d.white.skipped).toMatch(/up to 10 predictors/);
    expect(r.model.terms[0].coef).toBeCloseTo(1, 1);
    // Measured 2026-10-25 (jest, 2 workers busy elsewhere): HC1 fit 354 ms + diagnostics 29 ms. Bound with headroom.
    expect(ms).toBeLessThan(1000);
    // Newey–West at the default lag (15 for n = 50,000): measured 410 ms (the z_t accumulation, not n·p²·(L + 1)).
    const t1 = Date.now();
    const h = fitOls({ y, depName: "y", X, names: X.map((_, j) => `x${j + 1}`), constant: true, se: "hac" });
    expect(h.ok && h.model.seLabel).toBe("Newey–West HAC, lag 15");
    expect(Date.now() - t1).toBeLessThan(1000);
  });
  test("the full calculator path on a 50,000-row pasted table", () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.round((seed / 2147483648) * 1000) / 100;
    };
    const lines = ["y\t" + Array.from({ length: 20 }, (_, j) => `x${j + 1}`).join("\t")];
    for (let i = 0; i < 50000; i++) lines.push(Array.from({ length: 21 }, rnd).join("\t"));
    const t0 = Date.now();
    const o = econOlsCalc(reader({ data: lines.join("\n"), spec: "" , se: "hc1" }));
    const ms = Date.now() - t0;
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("The figure shows every 25th row (2,000 of 50,000 points).");
    // Measured 808 ms end to end (read the 50,000 × 21 table, fit HC1, diagnostics, figure).
    expect(ms).toBeLessThan(1500);
  });
});

describe("the brief's fixtures are committed with their licence", () => {
  test("CSV fixtures exist and THIRD_PARTY_LICENSES quotes the statsmodels datasets' COPYRIGHT", () => {
    for (const f of ["longley.csv", "grunfeld.csv", "stackloss.csv", "econ-ols-oracle.json"]) {
      expect(fs.existsSync(path.join(__dirname, "fixtures", f))).toBe(true);
    }
    const lic = fs.readFileSync(path.join(__dirname, "..", "..", "..", "THIRD_PARTY_LICENSES.md"), "utf8");
    expect(lic).toContain("This is public domain.");
    expect(lic).toMatch(/longley/i);
  });
});
