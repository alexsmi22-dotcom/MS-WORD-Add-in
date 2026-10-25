/**
 * The Release E4c calculators end to end: boot-ci and qreg, from field strings to the StatOutput — defaults, the
 * display contract, hostile tables and hostile parameter fields, 100,000-row inputs, and the FittedModel hand-off.
 */
import { bootCiCalc, qregCalc, qregModels, runQreg, BOOT_CI_DEFAULTS, BOOT_CI_FIELDS, QREG_DEFAULTS, QREG_FIELDS, readCount, readConfidence, readQuantiles } from "../robustCalcs";
import type { StatOutput } from "../analyzeBlocks";
import { Pcg32 } from "../prng";

const reader = (base: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => (k in over ? over[k] : base[k] ?? "");
const boot = (over: Record<string, string> = {}): StatOutput => bootCiCalc(reader(BOOT_CI_DEFAULTS, over));
const qreg = (over: Record<string, string> = {}): StatOutput => qregCalc(reader(QREG_DEFAULTS, over));

/** Every string an ok result shows: text and every table cell. */
function shown(o: StatOutput): string {
  return [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
}

function expectDisplayContract(o: StatOutput): void {
  expect(o.ok).not.toBe(false);
  const s = shown(o);
  expect(s).not.toMatch(/NaN|Infinity/);
  // "undefined" may appear as an English word in the prose ("left the statistic undefined"), never as a value.
  expect(s).not.toMatch(/[=:[;]\s*(undefined|null)\b/);
  for (const t of o.tables ?? []) for (const cell of t.rows.flat()) expect(cell).not.toMatch(/^(undefined|null)$/);
  expect(s).not.toMatch(/\d[eE][+-]?\d/); // no e-notation
  expect(s).not.toMatch(/(^|[\s([;:=,])-\d/m); // a true minus, never a hyphen, before a number
  expect(s).not.toContain("—"); // no em dash in an ok result
  for (const t of o.tables ?? []) {
    expect(t.align).toBeDefined();
    expect(t.align!.length).toBe(t.rows[0].length);
    expect(t.align![0]).toBe("left");
    for (const r of t.rows) expect(r.length).toBe(t.rows[0].length);
  }
}

function table(rows: number, f: (i: number) => string, header: string): string {
  return [header, ...Array.from({ length: rows }, (_, i) => f(i))].join("\n");
}

describe("field declarations", () => {
  it("declare data/stat/vars/B/conf/seed/method and data/spec/quantiles/se/constant, with defaults for each", () => {
    expect(BOOT_CI_FIELDS.map((f) => f.key)).toEqual(["data", "stat", "vars", "B", "conf", "seed", "method"]);
    expect(QREG_FIELDS.map((f) => f.key)).toEqual(["data", "spec", "quantiles", "se", "constant"]);
    for (const f of BOOT_CI_FIELDS) expect(BOOT_CI_DEFAULTS[f.key]).toBeDefined();
    for (const f of QREG_FIELDS) expect(QREG_DEFAULTS[f.key]).toBeDefined();
    for (const f of [...BOOT_CI_FIELDS, ...QREG_FIELDS]) if (f.kind === "select") expect(f.options!.length).toBeGreaterThan(1);
  });
});

describe("boot-ci", () => {
  it("the worked default runs, keeps the display contract and draws the histogram", () => {
    const o = boot();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Bootstrap 95% confidence interval for the median of spend \(n = 40, B = 2,000, seed 12345\)/);
    expect(o.text).toMatch(/BCa interval: \[/);
    expect(o.text).toMatch(/PCG32/);
    expect(o.text).toMatch(/Hyndman–Fan type 7/);
    expect(o.tables![0].rows.map((r) => r[0])).toEqual(["Method", "Percentile", "Basic", "Normal (bias-corrected)", "BCa"]);
    expect(o.svg).toMatch(/^<svg/);
    expect(o.svg).toContain("BCa bounds");
  });

  it("is reproducible: the same inputs give identical output, another seed differs", () => {
    expect(boot().text).toBe(boot().text);
    expect(boot({ seed: "999" }).tables![0].rows).not.toEqual(boot().tables![0].rows);
  });

  it("every statistic runs on the default table (two-column ones on spend ~ income)", () => {
    for (const stat of ["mean", "median", "sd", "var", "trim10"]) expectDisplayContract(boot({ stat, B: "500" }));
    for (const stat of ["corr", "ratio", "slope"]) {
      const o = boot({ stat, vars: "spend ~ income", B: "500" });
      expectDisplayContract(o);
      expect(o.text).toMatch(/spend/);
    }
    // Blank vars: the first column (one-column) / first two columns (two-column).
    expect(boot({ vars: "", stat: "mean", B: "200" }).text).toMatch(/mean of income/);
    expect(boot({ vars: "", stat: "corr", B: "200" }).text).toMatch(/correlation of income and spend/);
  });

  it("each headline method can be chosen; all four stay tabulated", () => {
    for (const method of ["percentile", "basic", "normal"]) {
      const o = boot({ method, B: "300" });
      expect(o.text).toMatch(new RegExp(`^${method[0].toUpperCase()}${method.slice(1)} interval: \\[`, "m"));
      expect(o.tables![0].rows).toHaveLength(5);
    }
  });

  it("reads decimal commas, U+2212, ×10ⁿ and NA cells as the OLS calculator does", () => {
    const data = "v\n1,5\n−2,25\n3,0\nNA\n4,75\n2,5×10⁰\n0,5\n";
    const o = boot({ data, vars: "v", stat: "mean", B: "200" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/n = 6/);
    expect(o.text).toMatch(/decimal comma/);
    expect(o.text).toMatch(/1 row with a missing cell/);
  });

  it("hostile tables are refused by name", () => {
    expect(boot({ data: "v\n1\n2\n3\n4", vars: "v" }).text).toMatch(/at least 5 complete rows/);
    expect(boot({ data: "v\n3\n3\n3\n3\n3\n3", vars: "v" }).text).toMatch(/constant/);
    expect(boot({ vars: "nosuch" }).text).toMatch(/No column is named “nosuch”/);
    expect(boot({ stat: "corr", vars: "spend" }).text).toMatch(/Write the model|exactly one column/);
    expect(boot({ stat: "mean", vars: "spend ~ income" }).text).toMatch(/uses one column/);
    expect(boot({ stat: "ratio", data: "y\tx\n1\t1\n2\t−1\n3\t2\n4\t−2\n5\t0", vars: "y ~ x" }).text).toMatch(/mean of “x” is 0/);
    expect(boot({ data: "v\n1\n2\n1e400\n4\n5\n6", vars: "v" }).ok).toBe(false);
    expect(boot({ data: "v\n1\n2\n1×10²⁰⁰\n4\n5\n6", vars: "v" }).text).toMatch(/outside the magnitudes/);
    for (const o of [boot({ data: "" }), boot({ data: "v\nabc\n1\n2\n3\n4\n5", vars: "v" })]) expect(o.ok).toBe(false);
  });

  it("huge and tiny scales give scaled, contract-clean output (10¹² and 10⁻¹²)", () => {
    const big = table(30, (i) => String(1e12 + ((i * 7919) % 1000) * 1000), "v");
    const o1 = boot({ data: big, vars: "v", stat: "mean", B: "300" });
    expectDisplayContract(o1);
    expect(o1.text).toMatch(/×10¹²|1,000,000/);
    const tiny = table(30, (i) => `${(1 + ((i * 37) % 11) / 10).toFixed(2)}×10⁻¹²`, "v");
    const o2 = boot({ data: tiny, vars: "v", stat: "sd", B: "300" });
    expectDisplayContract(o2);
    expect(o2.text).toMatch(/×10⁻¹³|×10⁻¹²/);
  });

  it("parameter rubbish is refused by name; blank takes the default; 2,000 and 95% read", () => {
    for (const B of ["abc", "−1", "-1", "1e400", "2.5", "99", "20,001", "1,0000"]) expect(boot({ B }).text).toMatch(/^Replicates B: /);
    for (const conf of ["abc", "−1", "1e400", "1", "100", "40", "0.9999"]) expect(boot({ conf }).text).toMatch(/^Confidence: /);
    for (const seed of ["abc", "−1", "1e400", "1.5", "9007199254740992"]) expect(boot({ seed }).text).toMatch(/^Seed: /);
    expect(boot({ stat: "nonsense" }).ok).toBe(false);
    expect(boot({ method: "nonsense" }).ok).toBe(false);
    expect(readCount("", "B", 2000, 100, 20000)).toBe(2000);
    expect(readCount("2,000", "B", 0, 100, 20000)).toBe(2000);
    expect(readCount("2 000", "B", 0, 100, 20000)).toBe(2000);
    expect(readConfidence("95%")).toBe(0.95);
    expect(readConfidence("0.95")).toBe(0.95);
    expect(readConfidence("90")).toBe(0.9);
    expect(readConfidence("")).toBe(0.95);
    expect(boot({ conf: "90%", B: "300" }).text).toMatch(/^Bootstrap 90% confidence/);
  });

  it("an undefined BCa is reported by name in its row and the headline falls back to the percentile interval", () => {
    const o = boot({ data: "v\n1\n5\n5\n5\n5\n5\n9", vars: "v", stat: "median", B: "300" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/BCa is not available: all the jackknife values are equal/);
    expect(o.text).toMatch(/^Percentile interval: /m);
    expect(o.tables![0].rows[4][1]).toMatch(/^not available: /);
  });

  it("dropped (undefined) resamples are counted in the text", () => {
    const data = table(9, (i) => `${(1 + 2 * (i >= 6 ? 1 : 0) + ((i * 13) % 7) / 10).toFixed(2)}\t${i >= 6 ? 1 : 0}`, "y\tx");
    const o = boot({ data, stat: "slope", vars: "y ~ x" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/resamples left the statistic undefined and were dropped/);
  });

  it("100,000 rows: refused up front by the work limit at B = 20,000, and answered at B = 200, within bounds", () => {
    const rng = new Pcg32(3);
    const data = table(100000, () => String(rng.nextU32() % 100000), "v");
    let t = Date.now();
    const a = boot({ data, vars: "v", stat: "median", B: "20000" });
    const msA = Date.now() - t;
    expect(a.text).toMatch(/more work than the bootstrap allows/);
    t = Date.now();
    const b = boot({ data, vars: "v", stat: "mean", B: "200" });
    const msB = Date.now() - t;
    if (b.ok === false) throw new Error(b.text);
    expectDisplayContract(b);
    // Measured under jest on the build machine: refusal ≈ 0.08 s, mean at B = 200 ≈ 0.45 s (table read included).
    expect(msA).toBeLessThan(1500);
    expect(msB).toBeLessThan(3000);
  });
});

describe("qreg", () => {
  it("the worked default runs, keeps the display contract, and draws the quantile process (3 quantiles)", () => {
    const o = qreg();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Quantile regression of wage on 2 predictors at τ = 0.25, 0.5, 0.75 \(n = 150\)/);
    expect(o.text).toMatch(/kernel="epa", bandwidth="hsheather"/);
    expect(o.text).toMatch(/Pseudo R¹ \(Koenker–Machado\)/);
    expect(o.tables!.filter((t) => t.label.startsWith("Coefficients"))).toHaveLength(3);
    expect(o.svg).toMatch(/^<svg/);
    expect(o.svg).toContain("OLS (dashed)");
  });

  it("one or two quantiles with one predictor draw the fitted lines; with two predictors there is no figure, said so", () => {
    const one = qreg({ spec: "wage ~ educ", quantiles: "0.5" });
    expectDisplayContract(one);
    expect(one.svg).toContain("τ = 0.5");
    const two = qreg({ quantiles: "0.1, 0.9" });
    expectDisplayContract(two);
    expect(two.svg).toBeUndefined();
    expect(two.text).toMatch(/No figure/);
  });

  it("iid standard errors and no constant run", () => {
    expectDisplayContract(qreg({ se: "iid" }));
    const o = qreg({ constant: "no" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/R¹ can be negative/);
    expect(o.tables![0].rows.map((r) => r[0])).toEqual(["Term", "educ", "exper"]);
  });

  it("hands each quantile to the publication table as a FittedModel of kind quantile", () => {
    const ms = qregModels(reader(QREG_DEFAULTS));
    if (!Array.isArray(ms)) throw new Error(ms.error);
    expect(ms).toHaveLength(3);
    for (const m of ms) {
      expect(m.kind).toBe("quantile");
      expect(m.terms.map((t) => t.name)).toEqual(["educ", "exper", "Constant"]);
      expect(m.stats.find((s) => s.label === "Pseudo R¹")).toBeDefined();
    }
    expect(qregModels(reader(QREG_DEFAULTS, { spec: "wage ~ nope" }))).toEqual({ error: expect.stringMatching(/No column/) });
  });

  it("hostile tables are refused by name", () => {
    expect(qreg({ data: "y\tx\n1\t2\n2\t3\n3\t5" , spec: "y ~ x" }).text).toMatch(/needs at least 7 complete rows/);
    const constY = table(20, (i) => `5\t${i}`, "y\tx");
    expect(qreg({ data: constY, spec: "y ~ x" }).text).toMatch(/constant/);
    const constX = table(20, (i) => `${i}\t3`, "y\tx");
    expect(qreg({ data: constX, spec: "y ~ x" }).ok).toBe(false);
    const coll = table(30, (i) => `${(i * 1.7) % 5}\t${i}\t${2 * i}`, "y\ta\tb");
    expect(qreg({ data: coll, spec: "y ~ a + b" }).text).toMatch(/collinear|“b”/i);
    expect(qreg({ spec: "wage ~ nosuch" }).text).toMatch(/No column is named “nosuch”/);
    expect(qreg({ data: "y\tx\n1\tNA\nNA\t2" , spec: "y ~ x" }).ok).toBe(false);
    expect(qreg({ data: "y\tx\n1\t1×10²⁰⁰\n2\t3\n3\t4\n4\t5\n5\t6\n6\t7\n7\t8", spec: "y ~ x" }).text).toMatch(/outside the magnitudes/);
  });

  it("NA cells drop rows (listwise) and are said", () => {
    const lines = QREG_DEFAULTS.data.split("\n");
    lines[3] = lines[3].replace(/\t[^\t]+$/, "\tNA");
    const o = qreg({ data: lines.join("\n") });
    expectDisplayContract(o);
    expect(o.text).toMatch(/n = 149/);
    expect(o.text).toMatch(/1 row with a missing cell/);
  });

  it("an extreme τ with few rows is refused by name (the bandwidth leaves (0, 1))", () => {
    const o = qreg({ quantiles: "0.01" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/Hall–Sheather bandwidth/);
  });

  it("huge and tiny scales (10¹² and 10⁻¹²) fit and stay contract-clean", () => {
    const rng = new Pcg32(8);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const data = table(
      200,
      (i) => {
        const x = 1 + (i % 17) + u();
        const y = 1e12 * (2 + 0.5 * x + u() * x);
        return `${Math.round(y)}\t${(x * 1e-12).toFixed(30).replace(/0+$/, "")}`;
      },
      "y\tx",
    );
    const o = qreg({ data, spec: "y ~ x", quantiles: "0.5" });
    expectDisplayContract(o);
    // The slope is ≈ 10²⁴ per unit of x: printed as m×10ⁿ in the table.
    expect(o.tables![0].rows[1][1]).toMatch(/^\d\.\d{3}×10²[³⁴]$/);
  });

  it("parameter rubbish is refused by name; blank and semicolon-decimal quantiles read", () => {
    for (const quantiles of ["abc", "−1", "-0.5", "1e400", "1", "0", "25%", "0.5, 0.5"]) expect(qreg({ quantiles }).text).toMatch(/^Quantiles: /);
    expect(readQuantiles("")).toEqual([0.25, 0.5, 0.75]);
    expect(readQuantiles("0,25; 0,5")).toEqual([0.25, 0.5]);
    expect(readQuantiles("0.9 0.1")).toEqual([0.1, 0.9]);
    expect(qreg({ se: "nonsense" }).ok).toBe(false);
    expect(qreg({ constant: "maybe" }).ok).toBe(false);
    expect(qreg({ spec: "" }).ok).not.toBe(false); // blank spec: first column on all the others
  });

  it("100,000 rows × 3 quantiles: answered within bounds; 20 quantiles of 100,000 rows refused up front", () => {
    const rng = new Pcg32(21);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const data = table(
      100000,
      () => {
        const a = u() * 10;
        const b = u() * 5;
        const c = u();
        return `${(1 + a + 0.5 * b - c + (1 + a / 5) * (u() - 0.5)).toFixed(4)}\t${a.toFixed(4)}\t${b.toFixed(4)}\t${c.toFixed(4)}`;
      },
      "y\ta\tb\tc",
    );
    let t = Date.now();
    const o = qreg({ data, spec: "y ~ a + b + c" });
    const ms = Date.now() - t;
    if (o.ok === false) throw new Error(o.text);
    expectDisplayContract(o);
    // Measured on the build machine: ≈ 1.5 s (read, OLS, three LPs, SEs). Bound with margin for 4 parallel workers.
    expect(ms).toBeLessThan(6000);
    t = Date.now();
    const many = qreg({ data, spec: "y ~ a + b + c", quantiles: Array.from({ length: 19 }, (_, i) => ((i + 1) / 20).toFixed(2)).join(", ") });
    expect(many.text).toMatch(/row-quantiles/);
    expect(Date.now() - t).toBeLessThan(4000);
    const r = runQreg(reader(QREG_DEFAULTS, { data: data + "\n1\t1\t1\t1", spec: "y ~ a + b + c" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at most 100,000 rows/);
  });
});
