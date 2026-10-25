/** v2.200.0: the publication table takes IV, panel, DiD, quantile, logit and probit lines beside OLS. */
import { econRegTableCalc } from "../econCalcs";
import { parseModelLine } from "../regTableModels";
import { iv2slsModel, IV_2SLS_DEFAULTS } from "../ivCalcs";
import { panelFeModel, panelReModel, panelDidModel, panelFeCalc, panelReCalc, PANEL_FE_DEFAULTS, PANEL_RE_DEFAULTS, PANEL_DID_DEFAULTS } from "../panelCalcs";
import { qregModels, QREG_DEFAULTS } from "../robustCalcs";
import { fmtFixed } from "../regTable";
import type { FittedModel } from "../regModel";
import type { StatOutput } from "../analyzeBlocks";

const table = (data: string, specs: string, extra: Record<string, string> = {}): StatOutput => {
  const f: Record<string, string> = { data, specs, se: "classical", decimals: "3", stars: "econ", constant: "yes", ...extra };
  return econRegTableCalc((k) => f[k] ?? "");
};
const model = (r: FittedModel | { error: string }): FittedModel => {
  if ("error" in r) throw new Error(r.error);
  return r;
};
const rowOf = (o: StatOutput, label: string): string[] => {
  const row = o.tables![0].rows.find((r) => r[0] === label);
  if (!row) throw new Error(`no row ${label}`);
  return row;
};
const coefCell = (m: FittedModel, name: string): string => fmtFixed(m.terms.find((t) => t.name === name)!.coef, 3);

describe("model lines", () => {
  test("prefixes, options and τ are read; a plain line is OLS", () => {
    const iv = parseModelLine("iv: y ~ x | endog = d | instruments = z1 + z2");
    expect(!("error" in iv) && iv.kind).toBe("iv");
    expect(!("error" in iv) && iv.opts.get("instruments")).toBe("z1 + z2");
    const qq = parseModelLine("q 0.25: y ~ x");
    expect(!("error" in qq) && qq.kind === "quantile" && qq.tau).toBe(0.25);
    const ols = parseModelLine("y ~ x1 + x2");
    expect(!("error" in ols) && ols.kind).toBe("ols");
    expect(!("error" in parseModelLine("2SLS: y ~ x | endog = d | instruments = z")) && "ok").toBe("ok");
  });
  test("refusals name the problem", () => {
    const err = (s: string): string => {
      const r = parseModelLine(s);
      if (!("error" in r)) throw new Error("expected a refusal");
      return r.error;
    };
    expect(err("iv: y ~ x | endog = d")).toContain("needs “instruments = …”");
    expect(err("fe: y ~ x | entity = f | time = t | colour = red")).toContain("“colour” is not an option of a fixed-effects line");
    expect(err("y ~ x | se = hc1")).toContain("An OLS line takes no options");
    expect(err("q 1.5: y ~ x")).toContain("between 0 and 1");
    expect(err("re: y ~ x | entity = f | entity = g | time = t")).toContain("given twice");
    expect(err("did: y ~ | entity = c | time = t | treat")).toContain("name = value");
  });
});

describe("mixed tables match each estimator's own calculator", () => {
  test("OLS, 2SLS and a median regression on the IV worked default", () => {
    const data = IV_2SLS_DEFAULTS.data;
    const o = table(data, ["lwage ~ educ + exper", "iv: lwage ~ exper | endog = educ | instruments = dist + sibs", "q 0.5: lwage ~ educ + exper"].join("\n"));
    expect(o.ok).not.toBe(false);
    expect(rowOf(o, "Estimator")).toEqual(["Estimator", "OLS", "2SLS", "Quantile τ = 0.5"]);
    const iv = model(iv2slsModel((k) => IV_2SLS_DEFAULTS[k] ?? ""));
    expect(rowOf(o, "educ")[2]).toMatch(new RegExp(`^${coefCell(iv, "educ").replace(".", "\\.")}`));
    const qf: Record<string, string> = { ...QREG_DEFAULTS, data, spec: "lwage ~ educ + exper", quantiles: "0.5" };
    const qm = qregModels((k) => qf[k] ?? "");
    if ("error" in qm) throw new Error(qm.error);
    expect(rowOf(o, "educ")[3]).toMatch(new RegExp(`^${coefCell(qm[0], "educ").replace(".", "\\.")}`));
    // The fit row names each kind's measure; the legend explains mixed t and z.
    expect(o.tables![0].rows.some((r) => r[0] === "R² / pseudo R¹")).toBe(true);
    expect(o.tables![0].note).toContain("p-values from each model's own reference distribution");
    expect(o.text).toContain("the OLS standard-error choice above applies to the OLS lines only");
    expect(o.text).toContain("pseudo R¹ (Koenker and Machado)");
  });
  test("pooled OLS, FE and RE on the panel worked default", () => {
    const data = PANEL_FE_DEFAULTS.data;
    const o = table(data, ["invest ~ sales + capital", "fe: invest ~ sales + capital | entity = firm | time = year", "re: invest ~ sales + capital | entity = firm | time = year"].join("\n"));
    expect(o.ok).not.toBe(false);
    expect(rowOf(o, "Estimator")).toEqual(["Estimator", "OLS", "FE", "RE"]);
    const fe = model(panelFeModel((k) => PANEL_FE_DEFAULTS[k] ?? ""));
    const re = model(panelReModel((k) => PANEL_RE_DEFAULTS[k] ?? ""));
    expect(rowOf(o, "sales")[2].startsWith(coefCell(fe, "sales"))).toBe(true);
    expect(rowOf(o, "sales")[3].startsWith(coefCell(re, "sales"))).toBe(true);
    expect(o.text).toContain("the R² row is the within R²");
  });
  test("a DiD line on the DiD worked default equals the DiD calculator's estimate", () => {
    const d = PANEL_DID_DEFAULTS;
    const o = table(d.data, `did: ${d.outcome} ~ | entity = ${d.entity} | time = ${d.time} | treat = ${d.treat}`);
    expect(o.ok).not.toBe(false);
    const did = model(panelDidModel((k) => d[k] ?? ""));
    expect(rowOf(o, d.treat)[1].startsWith(coefCell(did, d.treat))).toBe(true);
    expect(rowOf(o, "Estimator")[1]).toBe("DiD");
  });
  test("an all-OLS table is unchanged: no Estimator row, the old headline", () => {
    const o = table(IV_2SLS_DEFAULTS.data, "lwage ~ educ\nlwage ~ educ + exper");
    expect(o.tables![0].rows.some((r) => r[0] === "Estimator")).toBe(false);
    expect(o.text).toContain("2 OLS models of lwage");
  });
  test("panel-fe and panel-re now draw their comparison figures", () => {
    const fe = panelFeCalc((k) => PANEL_FE_DEFAULTS[k] ?? "");
    expect(fe.svg).toContain("Pooled OLS vs fixed effects");
    const re = panelReCalc((k) => PANEL_RE_DEFAULTS[k] ?? "");
    expect(re.svg).toContain("Fixed vs random effects");
    for (const s of [fe.svg!, re.svg!]) expect(s).not.toMatch(/NaN|Infinity|undefined/);
  });
  test("review: a | in an OLS column name still works; cluster = sets clustered errors; empty values refused", () => {
    const o = table("y\tx|1\n1\t2\n2\t3\n3\t5\n4\t4\n5\t7", "y ~ x|1");
    expect(o.ok).not.toBe(false);
    const c = parseModelLine("iv: y ~ x | endog = d | instruments = z | cluster = firm");
    expect(!("error" in c) && c.opts.get("se")).toBe("cluster");
    const fe = parseModelLine("fe: y ~ x | entity = f | time = t | cluster = state");
    expect(!("error" in fe) && fe.opts.get("se")).toBe("cluster-column");
    const bad = parseModelLine("iv: y ~ x | endog = d | instruments = z | cluster = firm | se = hc0");
    expect("error" in bad && bad.error).toContain("names a cluster column but asks for");
    const empty = parseModelLine("probit: y ~ x | se =");
    expect("error" in empty && empty.error).toContain("has no value");
  });
  test("review: no constant — the uncentered label covers only the columns without one; notes name their column", () => {
    const d = PANEL_FE_DEFAULTS.data;
    const o = table(d, ["invest ~ sales + capital", "fe: invest ~ sales + capital | entity = firm | time = year"].join("\n"), { constant: "no" });
    expect(o.ok).not.toBe(false);
    expect(o.tables![0].rows.some((r) => r[0] === "R² (uncentered where no constant)")).toBe(true);
    expect(o.text).toContain("FE, RE and DiD columns keep the intercept");
    expect(o.text).toMatch(/Model 2 \(FE\): /);
    const iv = table(IV_2SLS_DEFAULTS.data, "lwage ~ educ + exper\niv: lwage ~ exper | endog = educ | instruments = dist + sibs");
    expect(iv.tables![0].note).toContain("each model's own reference distribution");
  });
  test("a refused line names its model number", () => {
    const o = table(IV_2SLS_DEFAULTS.data, "lwage ~ educ\niv: lwage ~ exper | endog = educ | instruments = nosuch");
    expect(o.ok).toBe(false);
    expect(o.text).toContain("Model 2");
  });
});
