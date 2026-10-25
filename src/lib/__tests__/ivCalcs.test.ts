/**
 * iv-2sls (Release E4a): pinned to linearmodels 7.1 IV2SLS (scripts/econ-iv-oracle.py → fixtures/econ-iv-oracle.json),
 * every standard-error type × reference distribution, through the calculator from the table text (so NA cells and
 * listwise deletion go through the real reader), then the trap, the identification refusals and the hostile inputs.
 */
import * as fs from "fs";
import * as path from "path";
import { iv2slsCalc, iv2slsModel, ivFitFromRead, ivDefaultTable, IV_2SLS_DEFAULTS, IV_2SLS_FIELDS } from "../ivCalcs";
import { fitIv, IV_WALL_MS } from "../iv";
import { fitOls } from "../olsInference";

interface Run {
  se: string;
  small: boolean;
  n: number;
  terms: string[];
  params: number[];
  bse: number[];
  stat: number[];
  pvalues: number[];
  ci_lo: number[];
  ci_hi: number[];
  rsquared: number;
  rsquared_adj: number;
  s2: number;
  wald: { stat: number; df1: number; df2?: number; p: number; dist: string };
  first_stage: {
    endog: string;
    params: number[];
    bse: number[];
    stat: number[];
    pvalues: number[];
    ci_lo: number[];
    ci_hi: number[];
    rsquared: number;
    partial_rsquared: number;
    f_classical: number;
    f_classical_p: number;
    df_z: number;
    lm_f_unadjusted_nodebias?: number;
    wald_robust?: number;
    wald_robust_p?: number;
  }[];
  diag: Record<string, number[]>;
  naive?: { s2: number; bse: number[]; params: number[] };
}
interface Case {
  name: string;
  table: string;
  dep: string;
  exog: string[];
  endog: string[];
  instr: string[];
  cluster: string | null;
  constant: boolean;
  dropped: number;
  runs: Run[];
}
const ORACLE: { cases: Case[] } = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-iv-oracle.json"), "utf8"));

const reader = (o: Record<string, string>) => (k: string): string => o[k] ?? "";
function readerFor(c: Case, r: { se: string; small: boolean }): (k: string) => string {
  return reader({
    data: c.table,
    spec: `${c.dep} ~ ${c.exog.join(" + ")}`,
    endog: c.endog.join(" + "),
    instruments: c.instr.join(" + "),
    constant: c.constant ? "yes" : "no",
    se: r.se,
    cluster: r.se === "cluster" ? c.cluster ?? "" : "",
    small: r.small ? "t" : "z",
    decimals: "3",
  });
}

const REL = 1e-8;
function close(a: number, b: number, rel = REL, what = ""): void {
  const tol = rel * Math.max(Math.abs(b), 1e-300) + 1e-14;
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, oracle ${b} (|diff| ${Math.abs(a - b)} > ${tol})`);
}
function closeP(a: number, b: number, what: string): void {
  // p-values: relative 1e-7 (the incomplete beta / gamma), absolute 1e-13 for p near zero.
  const tol = 1e-7 * b + 1e-13;
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: p ${a} vs oracle ${b}`);
}

describe("iv-2sls against linearmodels 7.1", () => {
  for (const c of ORACLE.cases) {
    for (const run of c.runs) {
      const label = `${c.name} ${run.se} ${run.small ? "t" : "z"}`;
      test(label, () => {
        const r = ivFitFromRead(readerFor(c, run));
        if ("error" in r) throw new Error(r.error);
        const f = r.fit;
        const m = f.model;
        expect(m.kind).toBe("iv");
        expect(m.n).toBe(run.n);
        expect(m.statLabel).toBe(run.small ? "t" : "z");
        expect(m.terms.map((t) => t.name)).toEqual(run.terms);
        m.terms.forEach((t, i) => {
          close(t.coef, run.params[i], REL, `${label} coef ${t.name}`);
          close(t.se, run.bse[i], REL, `${label} se ${t.name}`);
          close(t.stat, run.stat[i], REL, `${label} stat ${t.name}`);
          closeP(t.p, run.pvalues[i], `${label} ${t.name}`);
          close(t.ciLo, run.ci_lo[i], REL, `${label} ciLo ${t.name}`);
          close(t.ciHi, run.ci_hi[i], REL, `${label} ciHi ${t.name}`);
        });
        close(f.r2, run.rsquared, REL, "R²");
        close(f.adjR2, run.rsquared_adj, REL, "adj R²");
        close(f.s2, run.s2, REL, "s2");
        expect(f.wald).not.toBeNull();
        close(f.wald!.stat, run.wald.stat, REL, "Wald");
        closeP(f.wald!.p, run.wald.p, "Wald p");
        expect(f.wald!.dist).toBe(run.wald.dist);
        // First stage.
        expect(f.firstStage.map((x) => x.endog)).toEqual(run.first_stage.map((x) => x.endog));
        f.firstStage.forEach((fs0, j) => {
          const o = run.first_stage[j];
          fs0.terms.forEach((t, i) => {
            close(t.coef, o.params[i], REL, `${label} fs coef`);
            close(t.se, o.bse[i], REL, `${label} fs se`);
            closeP(t.p, o.pvalues[i], `${label} fs p`);
            close(t.ciLo, o.ci_lo[i], REL, `${label} fs ciLo`);
          });
          close(fs0.r2, o.rsquared, REL, "fs R²");
          close(fs0.partialR2, o.partial_rsquared, REL, "partial R²");
          close(fs0.fClassical.value, o.f_classical, REL, "textbook F");
          closeP(fs0.fClassical.p, o.f_classical_p, "textbook F p");
          expect(fs0.fClassical.df2).toBe(o.df_z);
          if (o.lm_f_unadjusted_nodebias !== undefined) {
            // linearmodels' own unadjusted f.stat without debiasing is n/(n − k) times the textbook F we print.
            close(o.lm_f_unadjusted_nodebias, fs0.fClassical.value * (run.n / o.df_z), 1e-8, "lm F relation");
          }
          if (o.wald_robust !== undefined) {
            expect(fs0.fRobust).toBeDefined();
            close(fs0.fRobust!.wald, o.wald_robust, REL, "robust Wald");
            close(fs0.fRobust!.value, o.wald_robust / fs0.terms.length, REL, "robust F");
            closeP(fs0.fRobust!.p, o.wald_robust_p!, "robust Wald p");
          } else expect(fs0.fRobust).toBeUndefined();
        });
        // Diagnostics.
        const byName = (nm: string) => f.diagnostics.find((x) => x.name === nm)!;
        const chk = (nm: string, o: number[] | undefined, F = false) => {
          const t = byName(nm);
          if (!o) {
            expect(t && "skipped" in t ? t.skipped : "").toBe("exactly identified");
            return;
          }
          if ("skipped" in t) throw new Error(`${nm} skipped: ${t.skipped}`);
          close(t.stat, o[0], 1e-7, nm);
          expect(t.df).toBe(o[1]);
          if (F) expect(t.df2).toBe(o[2]);
          closeP(t.p, o[F ? 3 : 2], nm);
        };
        chk("Durbin (endogeneity)", run.diag.durbin);
        chk("Wu–Hausman (endogeneity)", run.diag.wu_hausman, true);
        chk("Sargan (overidentification)", run.diag.sargan);
        chk("Basmann (overidentification)", run.diag.basmann);
        if (run.se === "classical") {
          expect(f.diagnostics.some((x) => x.name.startsWith("Wooldridge"))).toBe(false);
        } else {
          chk("Wooldridge score (endogeneity)", run.diag.wooldridge_score);
          chk("Wooldridge score (overidentification)", run.diag.wooldridge_overid);
        }
      });
    }
  }

  test("the awkward case dropped its NA rows by listwise deletion", () => {
    const c = ORACLE.cases.find((x) => x.name === "awkward")!;
    expect(c.dropped).toBe(3);
    const out = iv2slsCalc(readerFor(c, { se: "hc0", small: false }));
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("3 rows with a missing cell");
  });
});

describe("the 2SLS trap: residuals use the actual X", () => {
  test("σ² and the SEs match linearmodels and differ from OLS on X̂", () => {
    const c = ORACLE.cases.find((x) => x.name === "overid")!;
    for (const small of [false, true]) {
      const run = c.runs.find((x) => x.se === "classical" && x.small === small)!;
      const r = ivFitFromRead(readerFor(c, run));
      if ("error" in r) throw new Error(r.error);
      close(r.fit.s2, run.s2, REL, "s2");
      // Same β as OLS on X̂ …
      run.naive!.params.forEach((b, i) => close(r.fit.model.terms[i].coef, b, 1e-8, "β"));
      // … but a different σ² and different SEs, by a wide margin on these data.
      expect(Math.abs(r.fit.s2 / run.naive!.s2 - 1)).toBeGreaterThan(0.2);
      expect(Math.abs(r.fit.model.terms[0].se / run.naive!.bse[0] - 1)).toBeGreaterThan(0.1);
      close(r.fit.model.terms[0].se, run.bse[0], REL, "se");
    }
  });
});

describe("the calculator's default", () => {
  test("fields and defaults", () => {
    const keys = IV_2SLS_FIELDS.map((f) => f.key);
    expect(keys).toEqual(["data", "spec", "endog", "instruments", "constant", "se", "cluster", "small", "decimals"]);
    for (const k of keys) expect(IV_2SLS_DEFAULTS[k]).toBeDefined();
    expect(IV_2SLS_DEFAULTS.se).toBe("hc0");
    expect(IV_2SLS_DEFAULTS.small).toBe("z");
    // The default table is the oracle's (the LCG port reproduces it bit for bit).
    expect(ivDefaultTable()).toBe(ORACLE.cases.find((x) => x.name === "default")!.table);
  });

  test("the default result obeys the display contract", () => {
    const out = iv2slsCalc(reader(IV_2SLS_DEFAULTS));
    expect(out.ok).not.toBe(false);
    const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
    expect(all).not.toMatch(/NaN|Infinity|undefined|—/);
    expect(all).not.toMatch(/\d[eE][-+]?\d/);
    // No ASCII hyphen-minus in front of a number (a true minus everywhere).
    expect(all).not.toMatch(/(^|[\s(\[;=])-\d/m);
    expect(out.text).toContain("Robust (HC0)");
    expect(out.text).toContain("z statistics");
    expect(out.text).toContain("Staiger");
    expect(out.text).toContain("were derived for the NON-robust F");
    for (const t of out.tables ?? []) {
      expect(t.align).toBeDefined();
      expect(t.align!.length).toBe(t.rows[0].length);
    }
    expect(out.svg).toContain("<svg");
    expect(out.svg).not.toMatch(/NaN|Infinity/);
    expect(out.svg).toContain("95% CI");
    // OLS is biased upward by the omitted ability; 2SLS should be closer to the true 0.09.
    const m = iv2slsModel(reader(IV_2SLS_DEFAULTS));
    if ("error" in m) throw new Error(m.error);
    expect(m.kind).toBe("iv");
    expect(m.terms[0].name).toBe("educ");
  });

  test("classical SEs print the Staiger–Stock guidance on the non-robust F", () => {
    const out = iv2slsCalc(reader({ ...IV_2SLS_DEFAULTS, se: "classical", small: "t" }));
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("the rule of thumb F < 10 (Staiger and Stock, 1997) applies to it");
    expect(out.text).toContain("t statistics with 197 df");
    expect(out.text).toContain("non-robust F(2, 196)");
    expect(out.text).not.toContain("Wooldridge score (endogeneity)");
  });

  test("exactly identified: overidentification tests are skipped by name", () => {
    const out = iv2slsCalc(reader({ ...IV_2SLS_DEFAULTS, instruments: "dist" }));
    expect(out.ok).not.toBe(false);
    const diag = out.tables!.find((t) => t.label === "Diagnostics")!;
    expect(diag.rows.flat().join(" ")).toContain("not computed: exactly identified");
  });

  test("empty right-hand side = constant only", () => {
    const out = iv2slsCalc(reader({ ...IV_2SLS_DEFAULTS, spec: "lwage ~" }));
    expect(out.ok).not.toBe(false);
    const coef = out.tables![0].rows.map((r) => r[0]);
    expect(coef).toEqual(["Term", "educ", "Constant"]);
    const bare = iv2slsCalc(reader({ ...IV_2SLS_DEFAULTS, spec: "lwage" }));
    expect(bare.ok).not.toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ refusals

/** A small synthetic table for the refusal tests (deterministic). */
function smallTable(n: number, extra?: (i: number, row: Record<string, number>) => void): string {
  let s = 12345;
  const u = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  const cols = ["y", "d", "d2", "x1", "z1", "z2", "z3"];
  const lines = [cols.join("\t")];
  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = {};
    row.x1 = u();
    row.z1 = u();
    row.z2 = u();
    row.z3 = u();
    const v = u();
    row.d = row.z1 + 0.5 * row.z2 + 0.3 * row.x1 + v;
    row.d2 = row.z2 - row.z3 + u();
    row.y = 1 + 2 * row.d - row.d2 + row.x1 + v + u();
    extra?.(i, row);
    lines.push(cols.map((c) => String(row[c])).join("\t"));
  }
  return lines.join("\n");
}
const base = (over: Record<string, string> = {}): Record<string, string> => ({
  data: smallTable(80),
  spec: "y ~ x1",
  endog: "d",
  instruments: "z1 + z2",
  constant: "yes",
  se: "classical",
  cluster: "",
  small: "z",
  decimals: "3",
  ...over,
});
const refusal = (o: Record<string, string>): string => {
  const out = iv2slsCalc(reader(o));
  expect(out.ok).toBe(false);
  return out.text;
};

describe("identification refusals", () => {
  test("under-identified (order condition)", () => {
    expect(refusal(base({ endog: "d + d2", instruments: "z1" }))).toMatch(/Under-identified: 1 excluded instrument for 2 endogenous/);
  });
  test("an instrument that is also a regressor", () => {
    expect(refusal(base({ instruments: "z1 + x1" }))).toMatch(/both an exogenous regressor and an instrument/);
    expect(refusal(base({ instruments: "z1 + d" }))).toMatch(/cannot be both an endogenous regressor and an instrument/);
    expect(refusal(base({ endog: "x1" }))).toMatch(/cannot be both an exogenous regressor and an endogenous regressor/);
    expect(refusal(base({ instruments: "z1 + z1" }))).toMatch(/listed twice as an instrument/);
    expect(refusal(base({ instruments: "z1 + y" }))).toMatch(/cannot be both the response and an instrument/);
  });
  test("instruments collinear with the exogenous regressors", () => {
    const data = smallTable(80, (_i, r) => {
      r.z2 = 2 * r.x1 + 3;
    });
    expect(refusal(base({ data }))).toMatch(/instrument “z2” is an exact linear combination of the exogenous regressors and the other instruments \(“x1”\)/);
    const data2 = smallTable(80, (_i, r) => {
      r.z2 = r.z1 - r.x1;
    });
    expect(refusal(base({ data: data2 }))).toMatch(/instrument “z2” is an exact linear combination/);
  });
  test("rank condition: the instruments move only one of two endogenous regressors", () => {
    // d2 = 2·d + (a part orthogonal to the instruments): the fitted values of d2 are exactly twice those of d.
    const raw = smallTable(80);
    const rows = raw.split("\n").slice(1).map((l) => l.split("\t").map(Number));
    const n = rows.length;
    const col = (j: number) => rows.map((r) => r[j]);
    const noise = rows.map((_, i) => Math.sin(i * 1.7));
    const o = fitOls({ y: noise, depName: "w", X: [col(3), col(4), col(5)], names: ["x1", "z1", "z2"], constant: true, se: "classical" });
    if (!o.ok) throw new Error(o.reason);
    const lines = ["y\td\td2\tx1\tz1\tz2"];
    for (let i = 0; i < n; i++) lines.push([rows[i][0], rows[i][1], 2 * rows[i][1] + o.resid[i], rows[i][3], rows[i][4], rows[i][5]].join("\t"));
    expect(refusal(base({ data: lines.join("\n"), endog: "d + d2" }))).toMatch(/rank condition fails/);
  });
  test("an endogenous regressor the instruments fit exactly", () => {
    const data = smallTable(80, (_i, r) => {
      r.d = r.z1 + 2 * r.x1;
    });
    expect(refusal(base({ data }))).toMatch(/first stage fits exactly/);
  });
  test("no endogenous regressor, no instrument", () => {
    expect(refusal(base({ endog: "" }))).toMatch(/at least one endogenous regressor/);
    expect(refusal(base({ instruments: "" }))).toMatch(/at least one excluded instrument/);
  });
});

describe("weak instruments", () => {
  test("a first-stage F below 10 is flagged, naming the regressor and which F", () => {
    const data = smallTable(80, (i, r) => {
      r.d = r.x1 + 0.02 * r.z1 + 0.02 * r.z2 + Math.sin(i * 1.3);
      r.y = 1 + 2 * r.d + r.x1 + Math.cos(i * 0.9);
    });
    const c = iv2slsCalc(reader(base({ data })));
    expect(c.ok).not.toBe(false);
    expect(c.text).toMatch(/Weak instruments: the first-stage F for d is below 10/);
    const h = iv2slsCalc(reader(base({ data, se: "hc1" })));
    expect(h.text).toMatch(/Weak instruments: the first-stage robust F for d is below 10/);
    expect(h.text).toContain("were derived for the NON-robust F");
  });
});

describe("hostile inputs", () => {
  test("too few rows", () => {
    expect(refusal(base({ data: smallTable(4) }))).toMatch(/needs more observations than instruments/);
  });
  test("a constant column", () => {
    const data = smallTable(80, (_i, r) => {
      r.x1 = 7;
    });
    expect(refusal(base({ data }))).toMatch(/“x1” is constant \(every value is 7\)/);
    const z = smallTable(80, (_i, r) => {
      r.z2 = 0;
    });
    expect(refusal(base({ data: z }))).toMatch(/instrument “z2” is zero in every row/);
  });
  test("collinear regressors", () => {
    const data = smallTable(80, (_i, r) => {
      r.d2 = 3 * r.x1 - 1;
    });
    expect(refusal(base({ data, spec: "y ~ x1 + d2" }))).toMatch(/Perfect collinearity among the exogenous regressors: “d2”/);
  });
  test("a column name that does not exist", () => {
    expect(refusal(base({ instruments: "z1 + nope" }))).toMatch(/Instrument: No column is named “nope”/);
    expect(refusal(base({ spec: "nope ~ x1" }))).toMatch(/Response: No column is named “nope”/);
    expect(refusal(base({ se: "cluster", cluster: "nope" }))).toMatch(/Cluster column: No column is named “nope”/);
    expect(refusal(base({ se: "cluster", cluster: "" }))).toMatch(/Name the cluster column/);
    expect(refusal(base({ spec: "y ~ ." }))).toMatch(/List the exogenous regressors by name/);
    expect(refusal(base({ spec: "" }))).toMatch(/Write the model/);
  });
  test("NA cells are dropped, a non-number is refused by name", () => {
    const rows = smallTable(80).split("\n");
    rows[3] = rows[3].replace(/^[^\t]+/, "NA");
    const out = iv2slsCalc(reader(base({ data: rows.join("\n") })));
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("1 row with a missing cell");
    rows[5] = rows[5].replace(/^[^\t]+/, "abc");
    expect(refusal(base({ data: rows.join("\n") }))).toMatch(/“abc” is not a number/);
  });
  test("rubbish in the parameter fields", () => {
    for (const v of ["abc", "−1", "1e400"]) {
      expect(refusal(base({ se: v }))).toMatch(/Unknown standard-error type/);
      expect(refusal(base({ small: v }))).toMatch(/Unknown reference distribution/);
      expect(refusal(base({ decimals: v }))).toMatch(/Decimals/);
      expect(refusal(base({ constant: v }))).toMatch(/Constant/);
    }
    // Empty selects take the defaults.
    const out = iv2slsCalc(reader(base({ se: "", small: "", decimals: "", constant: "" })));
    expect(out.ok).not.toBe(false);
    expect(out.text).toContain("Robust (HC0)");
    expect(refusal(base({ endog: "d + " }))).toMatch(/empty name/);
  });
  test("huge and tiny scales: the fit is scale-equivariant", () => {
    const ref = ivFitFromRead(reader(base()));
    if ("error" in ref) throw new Error(ref.error);
    for (const s of [1e-12, 1e12]) {
      const rows = smallTable(80).split("\n");
      const scaled = [rows[0], ...rows.slice(1).map((l) => {
        const c = l.split("\t").map(Number);
        c[0] *= s; // y
        c[5] *= s; // z2
        return c.join("\t");
      })].join("\n");
      const r = ivFitFromRead(reader(base({ data: scaled })));
      if ("error" in r) throw new Error(r.error);
      r.fit.model.terms.forEach((t, i) => {
        const t0 = ref.fit.model.terms[i];
        close(t.coef, t0.coef * s, 1e-9, "scaled coef");
        close(t.stat, t0.stat, 1e-9, "scaled t");
      });
      close(r.fit.firstStage[0].terms[1].coef, ref.fit.firstStage[0].terms[1].coef / s, 1e-9, "fs coef");
      close(r.fit.firstStage[0].fClassical.value, ref.fit.firstStage[0].fClassical.value, 1e-9, "fs F");
      const out = iv2slsCalc(reader(base({ data: scaled })));
      expect(out.text).not.toMatch(/\d[eE][-+]?\d|NaN|Infinity/);
    }
    // Beyond the accepted magnitudes: refused by name.
    const rows = smallTable(80).split("\n");
    rows[2] = rows[2].replace(/^[^\t]+/, "1e200");
    expect(refusal(base({ data: rows.join("\n") }))).toMatch(/outside the magnitudes/);
  });
  test("a constant response, an exact fit", () => {
    const data = smallTable(80, (_i, r) => {
      r.y = 3;
    });
    expect(refusal(base({ data }))).toMatch(/exactly on the fitted surface|is constant/);
    const exact = smallTable(80, (_i, r) => {
      r.y = 1 + 2 * r.d + r.x1;
    });
    expect(refusal(base({ data: exact }))).toMatch(/exactly on the fitted surface/);
  });
  test("one cluster refused, a column named Constant refused", () => {
    const rows = smallTable(80).split("\n");
    const data = [rows[0] + "\tg", ...rows.slice(1).map((l) => l + "\tA")].join("\n");
    expect(refusal(base({ data, se: "cluster", cluster: "g" }))).toMatch(/at least two clusters/);
    const renamed = smallTable(80).replace(/^y\td\td2\tx1/, "y\td\td2\tConstant");
    expect(refusal(base({ data: renamed, spec: "y ~ Constant" }))).toMatch(/name the tables give the constant/);
  });
  test("the wall clock refuses by name", () => {
    let t = 0;
    const now = () => (t += IV_WALL_MS);
    const n = 50;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i));
    const z = Array.from({ length: n }, (_, i) => Math.cos(i * 1.3));
    const d = x.map((v, i) => v + z[i] + Math.sin(i * 0.7));
    const y = d.map((v, i) => 2 * v + Math.cos(i * 2.1));
    const r = fitIv({ y, depName: "y", exog: [x], exogNames: ["x"], endog: [d], endogNames: ["d"], instr: [z], instrNames: ["z"], constant: true, se: "hc0", small: false, now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ran past its 6 s limit/);
  });
  test("too many columns, refused up front", () => {
    const n = 60;
    const cols = Array.from({ length: 41 }, (_, j) => Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (j + 1))));
    const r = fitIv({
      y: cols[0], depName: "y", exog: cols.slice(1, 31), exogNames: cols.slice(1, 31).map((_, j) => `x${j}`),
      endog: [cols[30]], endogNames: ["d"], instr: cols.slice(31), instrNames: cols.slice(31).map((_, j) => `z${j}`),
      constant: true, se: "classical", small: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/At most 40 columns/);
  });
});

describe("100,000 rows", () => {
  test("the calculator finishes well inside the pane's budget", () => {
    let s = 99;
    const u = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296 - 0.5;
    };
    const lines = ["y\td\tx1\tx2\tz1\tz2\tz3\tg"];
    for (let i = 0; i < 100000; i++) {
      const x1 = u(), x2 = u(), z1 = u(), z2 = u(), z3 = u(), v = u();
      const d = z1 + z2 - z3 + x1 + v;
      const y = 1 + 2 * d + x1 - x2 + v + u();
      lines.push([y, d, x1, x2, z1, z2, z3, `c${i % 500}`].map((c) => (typeof c === "number" ? c.toFixed(6) : c)).join("\t"));
    }
    const data = lines.join("\n");
    const t0 = Date.now();
    const out = iv2slsCalc(reader({ data, spec: "y ~ x1 + x2", endog: "d", instruments: "z1 + z2 + z3", constant: "yes", se: "cluster", cluster: "g", small: "t", decimals: "3" }));
    const ms = Date.now() - t0;
    expect(out.ok).not.toBe(false);
    // Measured 1.3–1.9 s on the build machine with other builders running (parse ≈ 0.2 s, column selection ≈ 0.35 s,
    // the 2SLS fit with first stage and every diagnostic ≈ 0.4–0.6 s, the OLS fit for the figure ≈ 0.4 s); bounded at
    // 3× the slowest measurement.
    expect(ms).toBeLessThan(6000);
  });
});
