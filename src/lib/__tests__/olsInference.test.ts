/**
 * OLS inference (Release E2) against statsmodels 0.15: every expected number is read from
 * fixtures/econ-ols-oracle.json, written by scripts/econ-ols-oracle.py from the public-domain longley, grunfeld and
 * stackloss datasets bundled with statsmodels (fixtures/*.csv). Coefficients, standard errors, t, p, intervals, R²,
 * F and its p, root MSE, log likelihood, AIC and BIC to 1e-6 relative, under classical, HC0–HC3, clustered and
 * Newey–West standard errors; the diagnostics likewise.
 */
import * as fs from "fs";
import * as path from "path";
import { fitOls, olsDiagnostics, hacDefaultLag, type SeType, type OlsFit } from "../olsInference";
import { parseRegData, selectColumns, parseSpec } from "../regData";
import oracle from "./fixtures/econ-ols-oracle.json";

const FIX = path.join(__dirname, "fixtures");
const dataset = (name: string) => {
  const r = parseRegData(fs.readFileSync(path.join(FIX, `${name}.csv`), "utf8"));
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};
const DATA: Record<string, ReturnType<typeof dataset>> = {
  longley: dataset("longley"),
  grunfeld: dataset("grunfeld"),
  stackloss: dataset("stackloss"),
};

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
}
function close(a: number, b: number, tol = 1e-6): boolean {
  return rel(a, b) <= tol || Math.abs(a - b) <= 1e-12;
}

const COV: Record<string, SeType> = { nonrobust: "classical", HC0: "hc0", HC1: "hc1", HC2: "hc2", HC3: "hc3", HAC: "hac", cluster: "cluster" };

function fitCase(c: (typeof oracle.cases)[number]): OlsFit {
  const ds = DATA[c.name.split(" ")[0]];
  const spec = parseSpec(`${c.y} ~ ${c.x.join(" + ")}`);
  if ("error" in spec) throw new Error(spec.error);
  const sel = selectColumns(ds, spec, { cluster: c.cluster ?? undefined });
  if (!sel.ok) throw new Error(sel.reason);
  const r = fitOls({
    y: sel.cols.y,
    depName: sel.cols.depName,
    X: sel.cols.X,
    names: sel.cols.names,
    constant: c.const,
    se: COV[c.cov],
    clusters: sel.cols.clusters,
    clusterName: sel.cols.clusterName,
    hacLag: c.lag ?? undefined,
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("OLS matches statsmodels under every standard-error type", () => {
  test("the oracle covers every SE type on three datasets", () => {
    const covs = new Set(oracle.cases.map((c) => c.cov));
    expect([...covs].sort()).toEqual(["HAC", "HC0", "HC1", "HC2", "HC3", "cluster", "nonrobust"]);
    expect(oracle.cases.length).toBeGreaterThanOrEqual(20);
  });
  for (const c of oracle.cases) {
    test(c.name, () => {
      const r = fitCase(c);
      const m = r.model;
      const bad: string[] = [];
      expect(m.terms.map((t) => t.name)).toEqual(c.terms);
      m.terms.forEach((t, j) => {
        if (!close(t.coef, c.params[j])) bad.push(`coef ${t.name} ${t.coef} vs ${c.params[j]}`);
        if (!close(t.se, c.bse[j])) bad.push(`se ${t.name} ${t.se} vs ${c.bse[j]}`);
        if (!close(t.stat, c.tvalues[j])) bad.push(`t ${t.name} ${t.stat} vs ${c.tvalues[j]}`);
        if (!close(t.p, c.pvalues[j])) bad.push(`p ${t.name} ${t.p} vs ${c.pvalues[j]}`);
        if (!close(t.ciLo, c.ci_lo[j])) bad.push(`ciLo ${t.name} ${t.ciLo} vs ${c.ci_lo[j]}`);
        if (!close(t.ciHi, c.ci_hi[j])) bad.push(`ciHi ${t.name} ${t.ciHi} vs ${c.ci_hi[j]}`);
      });
      if (!close(r.r2, c.rsquared)) bad.push(`r2 ${r.r2} vs ${c.rsquared}`);
      if (!close(r.adjR2, c.rsquared_adj)) bad.push(`adj ${r.adjR2} vs ${c.rsquared_adj}`);
      if (!r.f) bad.push(`no F (${r.fWhy})`);
      else {
        if (!close(r.f.value, c.fvalue)) bad.push(`F ${r.f.value} vs ${c.fvalue}`);
        if (!close(r.f.p, c.f_pvalue)) bad.push(`Fp ${r.f.p} vs ${c.f_pvalue}`);
        expect(r.f.df2).toBe(c.df_resid_inference);
      }
      expect(m.df).toBe(c.df_resid_inference);
      const st = (l: string) => m.stats.find((s) => s.label === l)!.value;
      if (!close(st("Root MSE"), c.root_mse)) bad.push("root mse");
      if (!close(st("Log likelihood"), c.llf)) bad.push("llf");
      if (!close(st("AIC"), c.aic)) bad.push("aic");
      if (!close(st("BIC"), c.bic)) bad.push("bic");
      expect(m.n).toBe(c.nobs);
      expect(bad).toEqual([]);
    });
  }
  test("default Newey–West lag is floor(4(n/100)^(2/9))", () => {
    expect(hacDefaultLag(16)).toBe(oracle.meta.hac_default["16"]);
    expect(hacDefaultLag(220)).toBe(oracle.meta.hac_default["220"]);
  });
});

describe("diagnostics match statsmodels", () => {
  for (const g of oracle.diagnostics) {
    test(g.name, () => {
      const c = oracle.cases.find((x) => x.name === `${g.name} nonrobust`)!;
      const d = olsDiagnostics(fitCase(c));
      const bad: string[] = [];
      if (!close(d.durbinWatson, g.dw)) bad.push(`dw ${d.durbinWatson} vs ${g.dw}`);
      if ("skipped" in d.breuschPagan) bad.push("bp skipped");
      else {
        if (!close(d.breuschPagan.stat, g.bp_lm)) bad.push(`bp ${d.breuschPagan.stat} vs ${g.bp_lm}`);
        if (!close(d.breuschPagan.p, g.bp_p)) bad.push(`bp p ${d.breuschPagan.p} vs ${g.bp_p}`);
        expect(d.breuschPagan.df).toBe(g.bp_df);
      }
      if ("white_lm" in g) {
        if ("skipped" in d.white) bad.push(`white skipped: ${d.white.skipped}`);
        else {
          if (!close(d.white.stat, g.white_lm as number)) bad.push(`white ${d.white.stat} vs ${g.white_lm}`);
          if (!close(d.white.p, g.white_p as number)) bad.push(`white p ${d.white.p} vs ${g.white_p}`);
          expect(d.white.df).toBe(g.white_df);
        }
      } else expect("skipped" in d.white).toBe(true);
      d.vif.forEach((v, j) => {
        if (!close(v.vif, g.vif[j])) bad.push(`vif ${v.name} ${v.vif} vs ${g.vif[j]}`);
      });
      // RESET against the standardised-powers oracle (identical to statsmodels' linear_reset except on longley,
      // where statsmodels' pinv loses rank on fitted³ ≈ 2×10¹⁴ and reports F(2, 8) = 6.949 for the true F(2, 7)).
      if ("skipped" in d.reset) bad.push("reset skipped");
      else {
        if (!close(d.reset.f, g.reset_scaled_f)) bad.push(`reset ${d.reset.f} vs ${g.reset_scaled_f}`);
        if (!close(d.reset.p, g.reset_scaled_p)) bad.push(`reset p ${d.reset.p} vs ${g.reset_scaled_p}`);
        expect(d.reset.df2).toBe(g.reset_scaled_df2);
      }
      if (!close(d.jarqueBera.jb, g.jb)) bad.push("jb");
      if (!close(d.jarqueBera.p, g.jb_p)) bad.push("jb p");
      if (!close(d.jarqueBera.skew, g.skew)) bad.push("skew");
      if (!close(d.jarqueBera.kurtosis, g.kurtosis)) bad.push("kurt");
      expect(bad).toEqual([]);
    });
  }
  test("statsmodels' own RESET agrees where its design keeps full rank", () => {
    for (const g of oracle.diagnostics.filter((x) => x.name !== "longley")) {
      expect(close(g.reset_f, g.reset_scaled_f, 1e-9)).toBe(true);
    }
  });
});
