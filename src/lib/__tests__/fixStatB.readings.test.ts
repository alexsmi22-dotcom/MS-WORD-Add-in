/**
 * Fix round, Stats fixer B: the independent reviewers' R6 (time series, macro/micro, IO, indices, inequality) and R5
 * (library econometrics) findings, each pinned to the reviewer's repro input (fixtures/fixStatB-repros.json, copied
 * from their case files) or to a minimal input that reaches the branch.
 */
import * as fs from "fs";
import * as path from "path";
import type { StatOutput } from "../analyzeBlocks";
import { readingProblems } from "../calcReading";
import { CAUSAL_STAT_CALCS } from "../causalStatCalcs";
import { GMM_STAT_CALCS } from "../gmmStatCalcs";
import { LIMDEP_STAT_CALCS } from "../limdepStatCalcs";
import { MICROMACRO_STAT_CALCS } from "../micromacroStatCalcs";
import { TS2_STAT_CALCS } from "../ts2StatCalcs";
import { TS_CALCULATORS } from "../tsCalcs";
import { tsArimaCalc, TS_ARIMA_DEFAULTS } from "../tsForecastCalcs";
import { concHhiCalc, ioLeontiefCalc, ineqGiniCalc, CONC_HHI_DEFAULTS, IO_LEONTIEF_DEFAULTS, INEQ_GINI_DEFAULTS, INEQ_MAX_ROWS } from "../econE5aCalcs";
import { microMarketCalc, microOligopolyCalc, MICRO_MARKET_DEFAULTS, MICRO_OLIGOPOLY_DEFAULTS } from "../microCalcs";
import { eventStudyReading } from "../econE3Calcs";
import { fitGarch, garchMaxN } from "../ts2";
import { fitArima } from "../arima";

type Calc = { id: string; fields?: { key: string; default: string }[]; compute: (r: (k: string) => string) => StatOutput };
const LIB = [...CAUSAL_STAT_CALCS, ...GMM_STAT_CALCS, ...LIMDEP_STAT_CALCS, ...MICROMACRO_STAT_CALCS, ...TS2_STAT_CALCS, ...TS_CALCULATORS] as unknown as Calc[];
const PANE: Record<string, [(r: (k: string) => string) => StatOutput, Record<string, string>]> = {
  "ts-arima": [tsArimaCalc, TS_ARIMA_DEFAULTS],
  "conc-hhi": [concHhiCalc, CONC_HHI_DEFAULTS],
  "io-leontief": [ioLeontiefCalc, IO_LEONTIEF_DEFAULTS],
  "ineq-gini": [ineqGiniCalc, INEQ_GINI_DEFAULTS],
  "micro-market": [microMarketCalc, MICRO_MARKET_DEFAULTS],
  "micro-oligopoly": [microOligopolyCalc, MICRO_OLIGOPOLY_DEFAULTS],
};
function run(id: string, over: Record<string, string> = {}): StatOutput {
  const p = PANE[id];
  if (p) return p[0]((k) => over[k] ?? p[1][k] ?? "");
  const c = LIB.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c.compute((k) => over[k] ?? c.fields?.find((f) => f.key === k)?.default ?? "");
}
const REPRO = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fixStatB-repros.json"), "utf8")) as Record<string, { id: string; over: Record<string, string> }>;
function repro(tag: string): StatOutput {
  const c = REPRO[tag];
  if (!c) throw new Error(`no repro ${tag}`);
  return run(c.id, c.over);
}
function ok(o: StatOutput): string {
  expect(o.ok).not.toBe(false);
  expect(readingProblems(o.reading)).toEqual([]);
  return o.reading ?? "";
}

describe("R6 #2: ts-unitroot decides and quotes ADF by its critical value", () => {
  test("adfb1 (τ −3.459 above the 5% value −3.491, MacKinnon p 0.044): no p in the reading, the text notes the disagreement", () => {
    const o = repro("cases_adfb:adfb1|ct|stat-3.4588|crit-3.4905|p0.0440");
    const r = ok(o);
    expect(r).toContain("ADF τ = −3.459 against the 5% critical value −3.491");
    expect(r).not.toMatch(/ADF p/);
    expect(o.text).toMatch(/Note: the ADF p \(0\.044\) is on the other side of 0\.05 from the critical-value decision/);
  });
});

describe("R6 #3: up-front caps", () => {
  test("ARIMA with p + q > 6 is refused by name before any work", () => {
    const y = Array.from({ length: 300 }, (_, i) => Math.sin(i / 3) + i * 0.01);
    const t0 = Date.now();
    const r = fitArima(y, { p: 5, d: 1, q: 5, trend: "none" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/p \+ q = 10 ARMA coefficients and needs more computation than the pane allows/);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  test("GARCH: Student-t and EGARCH stop at 1,200 returns, normal GARCH/GJR at 2,500", () => {
    expect(garchMaxN({ vol: "garch", dist: "normal" })).toBe(2500);
    expect(garchMaxN({ vol: "gjr", dist: "t" })).toBe(1200);
    expect(garchMaxN({ vol: "egarch", dist: "normal" })).toBe(1200);
    const y = Array.from({ length: 1300 }, (_, i) => Math.sin(i * 1.7) * (1 + (i % 7) / 10));
    const r = fitGarch(y, { vol: "egarch", dist: "t", mean: "constant" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("The series has 1,300 returns; EGARCH with Student-t errors takes at most 1,200 in the pane (its search is slower), so use the most recent 1,200, or choose normal errors.");
  });
  test("ineq-gini takes at most 50,000 rows", () => {
    expect(INEQ_MAX_ROWS).toBe(50000);
  });
});

describe("R6 #4, #5: ts-johansen wording", () => {
  test("rank 1 of 3: a relation links some combination of the series (not all of them)", () => {
    expect(ok(repro("cases_a:joh-0-1"))).toBe("Both tests find 1 long-run relation at 5%: a stable long-run relation links some combination of P, Q, R, even if each wanders on its own.");
  });
});

describe("R6 #6: Engle–Granger notes a p that disagrees with the critical value", () => {
  test("egb1 (τ −3.344 not below −3.452, MacKinnon p 0.049)", () => {
    const o = repro("cases_f:egb1|c|tau-3.3436|crit-3.4516|p0.0490");
    ok(o);
    expect(o.text).toMatch(/Note: the MacKinnon p = 0\.049 is on the other side of 0\.05 from the critical-value decision/);
  });
});

describe("R6 #7: conc-hhi keeps the legal caveat with long firm names", () => {
  test("hhi-long: the firms are named generically and the caveat stays", () => {
    const r = ok(repro("cases_e:hhi-long"));
    expect(r.length).toBeLessThanOrEqual(320);
    expect(r).toMatch(/^The merger of the three firms raises the HHI by 2,350 to 5,200/);
    expect(r).toContain("That presumption is a screen the parties can rebut, not a legal conclusion.");
  });
});

describe("R6 #15: conc-hhi does not print a change or share that rounds to 0.00", () => {
  test("two 0.001% firms merging", () => {
    const r = ok(run("conc-hhi", { data: "Firm\tShare\nA\t0.001\nB\t0.001\nC\t99.998", merging: "A\nB" }));
    expect(r).toMatch(/^The merger of A and B raises the HHI only negligibly \(by less than a hundredth of a point\), leaving it at 9,999\.60, with a combined share below a hundredth of a percent/);
    expect(r).not.toContain("0.00");
  });
});

describe("R6 #9: ts-hp refuses a constant series", () => {
  test("hp-const", () => {
    const o = repro("cases_e:hp-const");
    expect(o.ok).toBe(false);
    expect(o.text).toBe("“X” is constant, so it has no cycle around a trend.");
  });
});

describe("R6 #10: ts-garch leverage hedged at a bound, and says 'a return below its mean'", () => {
  test("GJR-t with a parameter on its bound", () => {
    const o = repro("cases_a:garch-gjr-t-constant");
    const r = ok(o);
    expect(o.text).toMatch(/On the boundary of the parameter space/);
    expect(r).toContain("Bad news (a return below its mean) appears to raise volatility more than good news (p = 0.003), but an estimate sits on the edge of its allowed range, so that p is not reliable.");
    expect(o.text).toMatch(/Leverage: a return below its mean raises next period's variance/);
  });
});

describe("R6 #11: ts-var with three series conditions on every series' past", () => {
  test("var-aic", () => {
    expect(ok(repro("cases_a:var-aic"))).toMatch(/^Past values of B help predict C beyond what its own past and the other series' pasts already predict \(p = 0\.006\)/);
  });
});

describe("R6 #15 minors", () => {
  test("one unit, both sectors, same prices, Cournot with an inactive firm", () => {
    expect(ok(repro("cases_e:fm-c0"))).toMatch(/^Each extra unit of government spending raises output by 1 unit and/);
    expect(ok(repro("cases_b:mm-0"))).toMatch(/supports 1 unit of money/);
    expect(ok(repro("cases_b:io-1"))).toContain("raises output across both sectors");
    expect(ok(repro("cases_b:pd-same"))).toMatch(/^Pricing each market on its own gives the same price in both \(60\)/);
    expect(ok(repro("cases_b:olig-exit"))).toMatch(/Cournot competition with only 1 of the 2 firms producing sets the price at 55/);
  });
  test("unit fields refuse numbers and non-number words; micro-cost's refusal has no em dash", () => {
    expect(repro("cases_h:micro-market|cur|NaN").text).toBe("Currency: “NaN” is not a unit name; enter one such as $, €, USD or tonnes.");
    expect(repro("cases_h:micro-oligopoly|cur|1e15").ok).toBe(false);
    expect(run("micro-market", { cur: "USD" }).ok).not.toBe(false);
    expect(run("micro-market", { qunit: "1000 tonnes" }).ok).not.toBe(false);
    const c = repro("cases_h:micro-cost|tc|NaN");
    expect(c.ok).toBe(false);
    expect(c.text).not.toContain("—");
  });
  test("ts-acf: the df column says n/a where the lag does not exceed the model df", () => {
    const o = run("ts-acf", { lags: "6", modelDf: "2" });
    const rows = (o.tables ?? [])[0].rows;
    expect([rows[1][5], rows[2][5], rows[3][5]]).toEqual(["n/a", "n/a", "1"]);
  });
  test("macro-phillips Conventions say how HC1/HAC p are formed", () => {
    expect(run("macro-phillips", { se: "hac" }).text).toContain("The HAC covariance includes the small-sample factor n/(n − k)");
    expect(run("macro-phillips", { se: "hc1" }).text).toContain("The coefficient t and p use the t distribution with n − k degrees of freedom.");
  });
});

describe("R5 BLOCKER 4: associational verbs on observational models", () => {
  const CAUSAL = /\b(raises|lowers|multiplies|shifts|increases|reduces|causes)\b/;
  test.each([
    ["count1-poisson", /^Each one-unit increase in x1 goes with the expected rate of cnt per unit of expo about 1\.5408 times as high/],
    ["tobit2", /goes with an expected h about 0\.3939 higher on average, counting the 27 observations held at the lower limit −1 and 5 at the upper limit 5\./],
    ["heck1", /each one-unit increase in e goes with lw about 0\.1351 higher \(p\s<\s0\.001\)/],
    ["ord1-logit", /^Higher x2 goes with r in the lower categories/],
    ["mnl1", /^Each one-unit increase in x1 goes with a probability that mode = 2 about 0\.1754 higher on average/],
  ])("%s", (tag, re) => {
    const r = ok(repro(tag));
    expect(r).toMatch(re);
    expect(r).not.toMatch(CAUSAL);
  });
});

describe("R5 MAJOR 1: econ-gmm flags weak instruments by first-stage F < 10, as iv-2sls does", () => {
  test("gmm-weak (first-stage p < 0.05 but F below 10)", () => {
    expect(ok(repro("gmm-weak"))).toContain("The instruments are weak for x (first-stage F = 9.15, below the rule-of-thumb 10), so the estimate is unreliable.");
  });
});

describe("R5 MAJOR 7: causal-pscore without replacement", () => {
  test("ps-noreplace-short: the reading names the matched treated units; the text no longer blames a caliper", () => {
    const o = repro("ps-noreplace-short");
    expect(ok(o)).toContain("among the 10 matched treated units (not all the treated)");
    expect(o.text).not.toMatch(/within the caliper dropped/);
  });
});

describe("R5 MAJOR 8: causal-synth outside the donors' hull", () => {
  test("synth-outside-hull: the gap is not called a reliable effect", () => {
    const o = repro("synth-outside-hull");
    expect(ok(o)).toBe(
      "After treatment, A ran on average 92.500 above its synthetic control, but the synthetic control did not track it before treatment (pre-period RMSPE 97.515), so that gap is not a reliable estimate of the effect.",
    );
    expect(o.text).toContain("so the post-period gap is not a reliable estimate of the effect.");
  });
});

describe("R5 MAJOR 9 / R6 p ≈ .05: decided on the printed p", () => {
  test("synth-p05: permutation p = 1/20 prints 0.050 and is borderline", () => {
    expect(ok(repro("synth-p05"))).toContain("(permutation p = 0.050), right at the conventional 5% threshold, so the evidence is borderline.");
  });
  test("es-event at p = 0.05 is borderline, not 'could be chance'", () => {
    const r = eventStudyReading(3, "−1 to +1", 0.012, 1.96, 0.0500001, (v) => (100 * v).toFixed(2));
    expect(r).toContain("right at the conventional 5% threshold");
    expect(readingProblems(r)).toEqual([]);
  });
});

describe("R5 minors", () => {
  test("rdd: an outcome of 10³⁰⁰ is refused by the outcome column's name", () => {
    const o = repro("rdd-cell-huge");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Column “y”: a value beyond 10¹⁵ in magnitude/);
  });
});
