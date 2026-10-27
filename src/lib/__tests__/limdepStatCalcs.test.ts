/**
 * Release F2 #11 registry (src/lib/limdepStatCalcs.ts): the pane's read path (fields AS TYPED, statSpreadContract's
 * run()), the printed defaults against the oracle fixture, hostile inputs, refusals by field, caps and timing.
 */
import * as fs from "fs";
import * as path from "path";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";
import { LIMDEP_STAT_CALCS } from "../limdepStatCalcs";
import { LIMDEP_COUNT_DEFAULT, LIMDEP_HECKMAN_DEFAULT, LIMDEP_MNL_DEFAULT, LIMDEP_ORDERED_DEFAULT, LIMDEP_TOBIT_DEFAULT } from "../limdepDefaults";
import { fmtFixed } from "../regTable";
import { Pcg32 } from "../prng";
import { LIMDEP_MAX_N, MNL_MAX_N } from "../limdep";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "limdep-oracle.json"), "utf8"));
const MINUS = "−";

const calc = (id: string): StatCalcDef => {
  const c = LIMDEP_STAT_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
/** statSpreadContract's run(): every field as typed. */
function run(c: StatCalcDef | string, over: Record<string, string> = {}): StatOutput {
  const cc = typeof c === "string" ? calc(c) : c;
  return cc.compute((k) => over[k] ?? cc.fields.find((f) => f.key === k)?.default ?? "");
}
function cell(o: StatOutput, table: number, rowLabel: string, col: number): string {
  const row = o.tables![table].rows.find((r) => r[0] === rowLabel);
  if (!row) throw new Error(`no row ${rowLabel}`);
  return row[col];
}

describe("contract (as statSpreadContract runs it)", () => {
  test.each(LIMDEP_STAT_CALCS.map((c) => [c.id, c] as const))("%s: defaults insertable, ≤ 6 columns, selects valid", (_id, c) => {
    for (const f of c.fields) if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
    const o = run(c);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toContain("—");
    expect(o.text).not.toMatch(/\d-\d|\s-\d/); // no hyphen-minus in printed numbers
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const x of row) if (x !== "") expect(insertableResultText(x)).toBe(true);
      }
    }
  });
  test("ids unique, registry form, no Math.random", () => {
    const ids = LIMDEP_STAT_CALCS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const src = fs.readFileSync(path.join(__dirname, "..", "limdepStatCalcs.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const id of ids) expect(src).toMatch(new RegExp(`^ {4}id: "${id}",`, "m"));
    expect(src.match(/compute: \(r\) => \{\n\s+\/\/ .+\n\s+return econ\w+Calc\(r\);/g)?.length).toBe(ids.length);
    for (const f of ["limdepStatCalcs.ts", "limdep.ts", "limdepDefaults.ts"]) expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
  });
  test("the defaults are exactly the text the oracle fitted", () => {
    expect(LIMDEP_COUNT_DEFAULT).toBe(FX.count.data);
    expect(LIMDEP_TOBIT_DEFAULT).toBe(FX.tobit.data);
    expect(LIMDEP_HECKMAN_DEFAULT).toBe(FX.heckman.data);
    expect(LIMDEP_ORDERED_DEFAULT).toBe(FX.ordered.data);
    expect(LIMDEP_MNL_DEFAULT).toBe(FX.mnl.data);
  });
});

describe("printed defaults agree with the oracle", () => {
  const f4 = (x: number): string => fmtFixed(x, 4);
  test("econ-count Poisson and NB2", () => {
    const o = run("econ-count");
    const P = FX.count.poisson;
    expect(cell(o, 0, "age", 1)).toBe(f4(P.params[0]));
    expect(cell(o, 0, "Constant", 2)).toBe(f4(P.bse[3]));
    expect(cell(o, 1, "age", 1)).toBe(f4(Math.exp(P.params[0])));
    expect(o.text).toContain(`Log likelihood = ${fmtFixed(P.llf, 3)}`);
    expect(o.text).toContain(`α̂ = ${f4(P.ct.alpha)} (SE ${f4(P.ct.se)})`);
    const nb = run("econ-count", { model: "nb2" });
    const N = FX.count.nb2;
    expect(cell(nb, 0, "female", 1)).toBe(f4(N.params[2]));
    expect(cell(nb, 0, "/alpha", 1)).toBe(f4(N.params[4]));
    expect(cell(nb, 0, "/alpha", 2)).toBe(f4(N.bse[4]));
    expect(nb.text).toContain(`LR = ${fmtFixed(N.lrAlpha, 3)}`);
    const h = run("econ-count", { se: "hc0" });
    expect(cell(h, 0, "income", 2)).toBe(f4(P.bseHC0[1]));
  });
  test("econ-tobit", () => {
    const o = run("econ-tobit");
    const T = FX.tobit;
    expect(cell(o, 0, "educ", 1)).toBe(f4(T.beta[0]));
    expect(cell(o, 0, "/sigma", 1)).toBe(f4(T.sigma));
    expect(cell(o, 1, "kids", 1)).toBe(f4(T.ame[2].est[0]));
    expect(cell(o, 1, "kids", 3)).toBe(f4(T.ame[2].est[2]));
    expect(o.text).toContain("37 left-censored at 0, 163 uncensored");
  });
  test("econ-heckman", () => {
    const o = run("econ-heckman");
    const H = FX.heckman;
    expect(cell(o, 0, "λ (inverse Mills ratio)", 1)).toBe(f4(H.beta[2]));
    expect(cell(o, 0, "λ (inverse Mills ratio)", 2)).toBe(f4(H.bse[2]));
    expect(cell(o, 1, "kids", 1)).toBe(f4(H.gamma[2]));
    expect(o.text).toContain(`ρ = ${f4(H.rho)}, σ = ${f4(H.sigma)}`);
    expect(o.text).toContain("not offered");
  });
  test("econ-ordered logit and probit", () => {
    for (const link of ["logit", "probit"]) {
      const o = run("econ-ordered", { link });
      const W = FX.ordered[link];
      expect(cell(o, 0, "quality", 1)).toBe(f4(W.beta[1]));
      expect(cell(o, 1, "cut2 (2 | 3)", 1)).toBe(f4(W.cuts[1]));
    }
  });
  test("econ-mlogit, base 1 and base 2", () => {
    const o = run("econ-mlogit");
    expect(cell(o, 0, "mode = 2: income", 1)).toBe(f4(FX.mnl.base1.params[0][0]));
    expect(cell(o, 2, "P(mode = 1): age", 1)).toBe(f4(FX.mnl.base1.ame[0][1]));
    const b2 = run("econ-mlogit", { base: "2" });
    expect(cell(b2, 0, "mode = 1: age", 1)).toBe(f4(FX.mnl.base2.params[0][1]));
    expect(b2.text).toContain("base category 2");
  });
});

describe("hostile inputs and refusals by field", () => {
  const bad = (o: StatOutput, re: RegExp): void => {
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(insertableResultText(o.text)).toBe(true);
  };
  test("blank data and spec errors", () => {
    for (const c of LIMDEP_STAT_CALCS) bad(run(c, { data: "" }), /Paste a table/);
    bad(run("econ-count", { spec: "visits ~ age + + female" }), /empty term/);
    bad(run("econ-count", { spec: "visits ~ nosuch" }), /No column is named “nosuch”/);
  });
  test("exposure: missing column, ≤ 0, also a predictor, also the response; offset kind", () => {
    bad(run("econ-count", { exposure: "yrs" }), /^Exposure column: No column is named “yrs”/);
    bad(run("econ-count", { spec: "visits ~ age + years" }), /“years” is the exposure column; it cannot also be a predictor/);
    bad(run("econ-count", { exposure: "visits" }), /is the response; it cannot also be the exposure column/);
    const zero = LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", "1 69 21.8 0 0");
    bad(run("econ-count", { data: zero }), /Exposure column “years”, row 1: 0 is not positive/);
    const neg = LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", `1 69 21.8 0 ${MINUS}0.79`);
    bad(run("econ-count", { data: neg }), /row 1: −0\.79 is not positive/);
    // "." spec with an exposure: every other column except the exposure.
    const dot = run("econ-count", { spec: "visits ~ ." });
    expect(dot.ok).not.toBe(false);
    expect(dot.text).toContain("on age, income, female (n = 200");
    // offset kind: ln(years) given directly as an offset reproduces the exposure fit.
    const lnTab = ["visits age income female lny", ...LIMDEP_COUNT_DEFAULT.split("\n").slice(1).map((r) => {
      const c = r.split(" ");
      return [...c.slice(0, 4), String(Math.log(Number(c[4])))].join(" ");
    })].join("\n");
    const off = run("econ-count", { data: lnTab, exposure: "lny", exposureKind: "offset" });
    expect(cell(off, 0, "age", 1)).toBe(cell(run("econ-count"), 0, "age", 1));
    // no exposure at all
    expect(run("econ-count", { exposure: "" }).ok).not.toBe(false);
  });
  test("counts: decimals, negatives, true minus, thousands, decimal commas, 1e400", () => {
    bad(run("econ-count", { data: LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", "1.5 69 21.8 0 0.79") }), /count .*row 1 has 1\.5/);
    bad(run("econ-count", { data: LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", `${MINUS}1 69 21.8 0 0.79`) }), /row 1 has −1/);
    bad(run("econ-count", { data: LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", "1e400 69 21.8 0 0.79") }), /“1e400” is not a number|not a number/);
    // a thousands separator in a count is read as the whole number
    const big = run("econ-count", { data: LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", "1,000 69 21.8 0 0.79") });
    expect(big.ok).not.toBe(false);
    // "21,8" (decimal comma) is read as 21.8: same as the default
    const dc = run("econ-count", { data: LIMDEP_COUNT_DEFAULT.replace("1 69 21.8 0 0.79", "1 69 21,8 0 0,79") });
    expect(cell(dc, 0, "age", 1)).toBe(cell(run("econ-count"), 0, "age", 1));
    expect(dc.text).toMatch(/decimal comma/);
    bad(run("econ-count", { data: "visits x\n0 1\n0 2\n0 3\n0 4", spec: "", exposure: "" }), /Every “visits” is 0/);
  });
  test("NB2 on data with no overdispersion is refused at the boundary", () => {
    const adv = FX.adv.countPoisson;
    bad(run("econ-count", { data: adv.data, model: "nb2" }), /boundary α = 0/);
    expect(run("econ-count", { data: adv.data, model: "poisson" }).ok).not.toBe(false);
  });
  test("tobit limits", () => {
    bad(run("econ-tobit", { lower: "", upper: "" }), /Lower limit and Upper limit are both blank/);
    bad(run("econ-tobit", { lower: "zero" }), /^Lower limit: “zero” is not a number/);
    bad(run("econ-tobit", { lower: "5", upper: "2" }), /lower limit \(5\) must be below the upper limit \(2\)/);
    bad(run("econ-tobit", { lower: `${MINUS}100` }), /nothing is censored/);
    bad(run("econ-tobit", { lower: "1000" }), /Every value of “hours” is censored/);
    const tl = run("econ-tobit", { lower: "0,0" });
    expect(tl.ok).not.toBe(false);
  });
  test("Heckman: selection spec blank or not 0/1, outcome without a name, missing regressor in a selected row", () => {
    bad(run("econ-heckman", { selection: "" }), /^Selection equation: write it/);
    bad(run("econ-heckman", { selection: "kids ~ married" }), /Selection indicator “kids”, row 3: 2 is not 0 or 1/);
    bad(run("econ-heckman", { spec: "~ educ" }), /no response/);
    const miss = LIMDEP_HECKMAN_DEFAULT.replace("1 2.667 18 29 0 0", "1 NA 18 29 0 0");
    const o = run("econ-heckman", { data: miss });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/1 selected row \(data row 1\) had a missing outcome or regressor and was dropped from BOTH equations/);
    expect(o.text).toContain("n = 299");
    const noExcl = run("econ-heckman", { selection: "works ~ educ + exper" });
    expect(noExcl.text).toMatch(/WARNING: every selection variable is also in the outcome equation/);
  });
  test("ordered and multinomial: categories, base", () => {
    bad(run("econ-mlogit", { base: "7" }), /base category 7 is not a value of “mode”; its categories are 1, 2, 3/);
    bad(run("econ-mlogit", { base: "one" }), /^Base category: “one” is not a number/);
    bad(run("econ-ordered", { spec: "price ~ quality + online" }), /accepts at most 10 outcome categories; “price” has \d+ distinct values/);
    bad(run("econ-mlogit", { spec: "online ~ price", data: LIMDEP_ORDERED_DEFAULT }), /only two categories/);
    bad(run("econ-ordered", { spec: "rating ~ price + price2", data: LIMDEP_ORDERED_DEFAULT.split("\n").map((r, i) => (i === 0 ? `${r} price2` : `${r} ${r.split(" ")[1]}`)).join("\n") }), /collinear|duplicates|exact linear combination/);
  });
});

describe("caps and timing", () => {
  function synth(n: number, k: number, seed: number, yOf: (eta: number, u: number, rng: Pcg32) => string): string {
    const rng = new Pcg32(seed);
    const u = (): number => rng.nextU32() / 4294967296;
    const lines = [["y", ...Array.from({ length: k }, (_, j) => `x${j + 1}`)].join(" ")];
    for (let i = 0; i < n; i++) {
      const x = Array.from({ length: k }, () => u() * 2 - 1);
      const eta = x.reduce((s, v, j) => s + (j % 3 === 0 ? 0.3 : -0.2) * v, 0);
      lines.push([yOf(eta, u(), rng), ...x.map((v) => v.toFixed(4))].join(" "));
    }
    return lines.join("\n");
  }
  test("row caps refuse by name", () => {
    const big = synth(LIMDEP_MAX_N + 1, 1, 1, (eta, u) => String(u < 0.5 ? 0 : 1));
    expect(run("econ-count", { data: big, spec: "", exposure: "" }).text).toMatch(/at most 10,000 rows; the data have 10,001/);
    const bigM = synth(MNL_MAX_N + 1, 1, 2, (eta, u) => String(1 + Math.floor(u * 3)));
    expect(run("econ-mlogit", { data: bigM, spec: "" }).text).toMatch(/at most 5,000 rows/);
    const wide = synth(100, 16, 3, (eta, u) => String(u < 0.5 ? 0 : 1));
    expect(run("econ-tobit", { data: wide, spec: "" }).text).toMatch(/at most 15 predictors; the model has 16/);
  });
  test("each calculator at its caps stays inside the time budget", () => {
    const pois = synth(LIMDEP_MAX_N, 15, 4, (eta, u) => String(Math.floor(-Math.log(1 - u) * Math.exp(eta) * 2)));
    const ord = synth(LIMDEP_MAX_N, 15, 5, (eta, u) => String(1 + Math.min(9, Math.floor(10 / (1 + Math.exp(-(eta + Math.log(u / (1 - u)))))))));
    const tob = synth(LIMDEP_MAX_N, 15, 6, (eta, u) => Math.max(0, eta + Math.log(u / (1 - u))).toFixed(3));
    const mnl = synth(MNL_MAX_N, 10, 7, (eta, u) => String(1 + Math.min(5, Math.floor(u * 6))));
    const cases: [string, Record<string, string>][] = [
      ["econ-count", { data: pois, spec: "", exposure: "", model: "nb2" }],
      ["econ-ordered", { data: ord, spec: "" }],
      ["econ-tobit", { data: tob, spec: "", lower: "0" }],
      ["econ-mlogit", { data: mnl, spec: "" }],
    ];
    for (const [id, over] of cases) {
      const t0 = Date.now();
      const o = run(id, over);
      const ms = Date.now() - t0;
      expect(o.ok).not.toBe(false);
      // 300 ms on a dev PC outside jest; jest's sandbox and a shared machine are several times slower.
      // eslint-disable-next-line no-console
      if (process.env.LIMDEP_TIMING) console.log(id, ms);
      expect(ms).toBeLessThan(3000);
    }
  });
});

describe("adversarial (after the build)", () => {
  test("a predictor near 10⁶: the constant's IRR is outside the double range and is left out by name", () => {
    const shifted = LIMDEP_COUNT_DEFAULT.split("\n").map((r, i) => {
      if (i === 0) return r;
      const c = r.split(" ");
      c[1] = String(Number(c[1]) + 1e6);
      return c.join(" ");
    }).join("\n");
    const o = run("econ-count", { data: shifted });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Not in the IRR table: Constant, whose exp\(b\)/);
    expect(o.tables![1].rows.map((r) => r[0])).toEqual(["Term", "age", "income", "female"]);
    // the age coefficient is unchanged by the shift
    expect(cell(o, 0, "age", 1)).toBe(cell(run("econ-count"), 0, "age", 1));
  });
  test("Heckman at the caps stays inside the time budget", () => {
    const rng = new Pcg32(11);
    const u = (): number => rng.nextU32() / 4294967296;
    const lines = ["s y " + Array.from({ length: 15 }, (_, j) => `z${j + 1}`).join(" ")];
    for (let i = 0; i < LIMDEP_MAX_N; i++) {
      const z = Array.from({ length: 15 }, () => u() * 2 - 1);
      const s = z[0] + z[1] - z[2] + Math.log(u() / (1 - u())) > 0 ? 1 : 0;
      lines.push([s, s ? (z[3] + z[4] + u()).toFixed(4) : "NA", ...z.map((v) => v.toFixed(4))].join(" "));
    }
    const t0 = Date.now();
    const o = run("econ-heckman", {
      data: lines.join("\n"),
      spec: "y ~ " + Array.from({ length: 13 }, (_, j) => `z${j + 3}`).join(" + "),
      selection: "s ~ " + Array.from({ length: 15 }, (_, j) => `z${j + 1}`).join(" + "),
    });
    expect(o.ok).not.toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("adversarial: the Heckman equations name each other's response", () => {
  test("“.” expands without the other equation's response; naming it explicitly is refused", () => {
    const dotOut = run("econ-heckman", { spec: "lwage ~ ." });
    // outcome on every column but lwage and works: educ, exper, kids, married (no exclusion restriction left)
    expect(dotOut.ok).not.toBe(false);
    expect(dotOut.text).toContain("lwage on educ, exper, kids, married");
    expect(dotOut.text).toMatch(/WARNING: every selection variable is also in the outcome equation/);
    const dotSel = run("econ-heckman", { selection: "works ~ ." });
    expect(dotSel.ok).not.toBe(false);
    expect(dotSel.text).toContain("selection: works on educ, exper, kids, married");
    const o1 = run("econ-heckman", { spec: "lwage ~ educ + works" });
    expect(o1.ok).toBe(false);
    expect(o1.text).toBe("Outcome equation: “works” is the selection indicator; it cannot also be a predictor here.");
    const o2 = run("econ-heckman", { selection: "works ~ educ + lwage" });
    expect(o2.text).toBe("Selection equation: “lwage” is the outcome; it cannot also be a predictor here.");
    expect(run("econ-heckman", { selection: "lwage ~ educ" }).text).toBe("“lwage” cannot be both the outcome and the selection indicator.");
  });
});
