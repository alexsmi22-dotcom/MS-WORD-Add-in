// Cox proportional-hazards regression — acceptance values from
// docs/SCOPE-STATS-BATCH.md §D1. Every number below is the brief's, unchanged.
// Oracles (brief): lifelines 0.30.3 CoxPHFitter + statsmodels 0.15.0 PHReg agree to
// 6 s.f. on every coefficient, SE and global test. Rows the brief marks
// "single oracle" (concordance, Schoenfeld PH tests) are pinned at their printed
// precision and labelled as such: they need R before they are quoted in user docs.

import {
  coxRegression,
  coxSurvivalAt,
  coxAdjustedSurvival,
  coxCurveProfiles,
  coxForestData,
  coxReportLines,
  coxDummyCode,
  type CoxFit,
  type CoxInput,
  type CoxResult,
} from "../cox";
import larynxJson from "./fixtures/cox-larynx.json";
import rossiJson from "./fixtures/cox-rossi.json";

/** |actual − expected| ≤ rel·|expected|. 6 s.f. values use rel = 1e-5 (±1 in the 6th digit, with rounding slack). */
function rel(actual: number, expected: number, r = 1e-5) {
  const tol = r * Math.abs(expected);
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`expected ${expected} ± ${tol}, got ${actual}`);
  }
}
/** Absolute tolerance helper (printed-precision values). */
function abs(actual: number, expected: number, tol: number) {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`expected ${expected} ± ${tol}, got ${actual}`);
}
function fit(r: CoxResult): CoxFit {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
}
const coef = (f: CoxFit, name: string) => {
  const c = f.coefficients.find((x) => x.name === name);
  if (!c) throw new Error(`no coefficient ${name}`);
  return c;
};

// ---- data -----------------------------------------------------------------------
// Gehan / Freireich 6-MP — the arrays used in statsAuthorities.test.ts.
const sixMP = {
  times: [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35],
  events: [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
};
const placebo = {
  times: [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23],
  events: new Array(21).fill(1),
};
export const gehan: CoxInput = {
  times: [...sixMP.times, ...placebo.times],
  events: [...sixMP.events, ...placebo.events],
  covariates: [{ name: "placebo", values: [...new Array(21).fill(0), ...new Array(21).fill(1)] }],
};

type Table = { columns: string[]; rows: number[][] };
function fromTable(t: Table, time: string, event: string, covs: string[]): CoxInput {
  const ci = (c: string) => t.columns.indexOf(c);
  return {
    times: t.rows.map((r) => r[ci(time)]),
    events: t.rows.map((r) => r[ci(event)]),
    covariates: covs.map((c) => ({ name: c, values: t.rows.map((r) => r[ci(c)]) })),
  };
}
const larynxT = larynxJson as Table;
const rossiT = rossiJson as Table;
export const larynx: CoxInput = {
  ...fromTable(larynxT, "time", "death", ["Stage_II", "Stage_III", "Stage_IV", "age"]),
  factors: [{ name: "Stage", reference: "I", levels: ["II", "III", "IV"], columns: ["Stage_II", "Stage_III", "Stage_IV"] }],
};
export const rossi = fromTable(rossiT, "week", "arrest", ["fin", "age", "race", "wexp", "mar", "paro", "prio"]);

// ---------------------------------------------------------------------------------
describe("fixtures are the lifelines datasets", () => {
  test("larynx: 90 patients, 50 deaths; rossi: 432 subjects, 114 arrests", () => {
    expect(larynx.times.length).toBe(90);
    expect(larynx.events.reduce((s, e) => s + e, 0)).toBe(50);
    expect(rossi.times.length).toBe(432);
    expect(rossi.events.reduce((s, e) => s + e, 0)).toBe(114);
  });
});

describe("§D1 Gehan / Freireich 6-MP, Efron", () => {
  const f = fit(coxRegression(gehan));
  const c = f.coefficients[0];
  test("β, SE, HR, CI, z, p", () => {
    rel(c.beta, 1.572125);
    rel(c.se, 0.412397);
    rel(c.hr, 4.81687);
    rel(c.ciLow, 2.14651);
    rel(c.ciHigh, 10.80931);
    rel(c.z, 3.8122, 2e-5);
    rel(c.p, 0.000137754, 2e-5);
  });
  test("ℓ and the three global tests", () => {
    rel(f.logLik, -85.008425, 1e-7);
    rel(f.likelihoodRatio.statistic, 16.3517, 1e-5);
    expect(f.likelihoodRatio.df).toBe(1);
    rel(f.likelihoodRatio.p, 5.26092e-5, 2e-5);
    rel(f.wald.statistic, 14.5326, 1e-5);
    rel(f.score.statistic, 17.2465, 1e-5);
  });
  test("the score test is NOT the log-rank 16.79 here: Efron with ties gives 17.25 (§C limits)", () => {
    expect(Math.abs(f.score.statistic - 16.79)).toBeGreaterThan(0.4);
  });
  test("concordance 0.690042 (single oracle: lifelines pair rule)", () => {
    abs(f.concordance.c, 0.690042, 1e-6);
  });
  test("PH test, KM transform: χ²(1) = 0.0043, p = 0.9476 (single oracle)", () => {
    expect(f.phTest.transform).toBe("km");
    abs(f.phTest.rows[0].chi2, 0.0043, 5e-5);
    abs(f.phTest.rows[0].p, 0.9476, 5e-5);
  });
  test("adjusted S(t), Breslow baseline: (6-MP, placebo) at t = 5, 10, 15, 22", () => {
    const want: [number, number, number][] = [
      [5, 0.91679, 0.65805],
      [10, 0.80962, 0.36158],
      [15, 0.69495, 0.17326],
      [22, 0.56873, 0.06598],
    ];
    for (const [t, s0, s1] of want) {
      abs(coxSurvivalAt(f, [0], t), s0, 6e-6);
      abs(coxSurvivalAt(f, [1], t), s1, 6e-6);
    }
  });
  test("the 6-MP arm's deaths AND censoring at t = 6 and t = 10 are ordered deaths-first (§E6)", () => {
    // A wrong order changes the fit; the pinned β above is the check. Here: the
    // risk set at 6 includes the subject censored at 6 — the baseline jump at 6
    // uses all 21 + 12 = 33 at risk.
    expect(f.baseline.some((b) => b.time === 6)).toBe(true);
  });
});

describe("§D1 Gehan, Breslow", () => {
  const f = fit(coxRegression(gehan, { ties: "breslow" }));
  test("β, SE, ℓ, LR, Wald, score", () => {
    expect(f.ties).toBe("breslow");
    rel(f.coefficients[0].beta, 1.509191);
    rel(f.coefficients[0].se, 0.409564);
    rel(f.logLik, -86.379622, 1e-7);
    rel(f.likelihoodRatio.statistic, 15.2109, 1e-5);
    rel(f.wald.statistic, 13.5783, 1e-5);
    rel(f.score.statistic, 15.9305, 1e-5);
  });
});

describe("§D1 Larynx (Klein & Moeschberger §1.8), Efron", () => {
  const f = fit(coxRegression(larynx));
  const table: [string, number, number, number, number, number, number][] = [
    ["Stage_II", 0.14004, 0.462486, 1.15032, 0.46468, 2.84766, 0.762043],
    ["Stage_III", 0.642382, 0.356111, 1.901, 0.94593, 3.82036, 0.0712496],
    ["Stage_IV", 1.70598, 0.421913, 5.50678, 2.4086, 12.59015, 5.26732e-5],
    ["age", 0.019031, 0.014258, 1.01921, 0.99112, 1.0481, 0.181966],
  ];
  test.each(table)("%s: β, SE, HR, CI, p", (name, b, se, hr, lo, hi, p) => {
    const c = coef(f, name);
    rel(c.beta, b, name === "age" ? 3e-5 : 1e-5); // age printed to 5 s.f.
    rel(c.se, se, 3e-5);
    rel(c.hr, hr);
    rel(c.ciLow, lo);
    rel(c.ciHigh, hi);
    rel(c.p, p, 2e-5);
  });
  test("ℓ, LR (df 4), Wald, score, C", () => {
    rel(f.logLik, -187.707365, 1e-7);
    rel(f.likelihoodRatio.statistic, 18.3122, 1e-5);
    expect(f.likelihoodRatio.df).toBe(4);
    rel(f.likelihoodRatio.p, 0.0010722, 5e-5);
    rel(f.wald.statistic, 21.149, 1e-5);
    rel(f.score.statistic, 24.7789, 1e-5);
    abs(f.concordance.c, 0.681882, 1e-6); // single oracle
  });
  test("EPV 12.5: fitted", () => {
    expect(f.eventsPerParameter).toBe(12.5);
  });
  test("PH test, KM (single oracle): per covariate and GLOBAL χ²(4) = 4.4670", () => {
    const want: Record<string, [number, number]> = {
      Stage_II: [0.0166, 0.8974],
      Stage_III: [3.1518, 0.0758],
      Stage_IV: [0.5665, 0.4516],
      age: [0.7768, 0.3781],
    };
    for (const r of f.phTest.rows) {
      abs(r.chi2, want[r.name][0], 5e-5);
      abs(r.p, want[r.name][1], 5e-5);
    }
    abs(f.phTest.global.chi2, 4.467, 5e-5);
    expect(f.phTest.global.df).toBe(4);
    abs(f.phTest.global.p, 0.3465, 5e-5);
  });
  test("adjusted S(t), age at its mean 64.6111, Stage I..IV, t = 1 and 5 (brief values; both are event times)", () => {
    abs(coef(f, "age").mean, 64.6111, 5e-5);
    const want: [number, number[]][] = [
      [1, [0.9158, 0.90377, 0.84602, 0.61608]],
      [5, [0.6821, 0.64398, 0.48322, 0.12163]],
    ];
    const { profiles, legendNote } = coxCurveProfiles(f);
    expect(profiles.map((p) => p.label)).toEqual(["Stage I", "Stage II", "Stage III", "Stage IV"]);
    expect(legendNote).toMatch(/age = 64\.61 \(mean\)/);
    for (const [t, s] of want) for (let k = 0; k < 4; k++) abs(coxSurvivalAt(f, profiles[k].x, t), s[k], 6e-6);
  });
  test("t = 3 is NOT an event time: the brief's (0.82183, 0.79794, 0.68865, 0.33940) is lifelines' LINEAR INTERPOLATION of H between 2.9 and 3.2 — the step estimate is pinned instead", () => {
    // DISCREPANCY WITH THE BRIEF, reported, not silently changed. lifelines'
    // predict_survival_function(times=[3]) calls np.interp on the cumulative hazard
    // over its index of ALL durations (2.9 is a censoring time, 3.2 the next event).
    // The Breslow estimator is a step function: S(3) = S(2.4), the last event time.
    // lifelines' own step value at 2.9 (= at 3): 0.827823, 0.804640, 0.698231, 0.353264.
    const { profiles } = coxCurveProfiles(f);
    const step = [0.827823, 0.80464, 0.698231, 0.353264];
    const brief = [0.82183, 0.79794, 0.68865, 0.3394];
    for (let k = 0; k < 4; k++) {
      abs(coxSurvivalAt(f, profiles[k].x, 3), step[k], 2e-6);
      // Reproduce the brief's number by the same interpolation, from this engine's own baseline.
      const H29 = -Math.log(coxSurvivalAt(f, profiles[k].x, 2.9));
      const H32 = -Math.log(coxSurvivalAt(f, profiles[k].x, 3.2));
      const interp = Math.exp(-(H29 + ((H32 - H29) * (3 - 2.9)) / (3.2 - 2.9)));
      abs(interp, brief[k], 6e-6);
    }
  });
});

describe("§D1 Larynx, Breslow", () => {
  test("Stage IV β = 1.693056, age β = 0.018902, LR 18.0670", () => {
    const f = fit(coxRegression(larynx, { ties: "breslow" }));
    rel(coef(f, "Stage_IV").beta, 1.693056);
    rel(coef(f, "age").beta, 0.018902, 3e-5);
    rel(f.likelihoodRatio.statistic, 18.067, 1e-5);
  });
});

describe("§D1 Rossi recidivism, Efron", () => {
  const f = fit(coxRegression(rossi));
  test("fin: β, SE, HR, CI, p", () => {
    const c = coef(f, "fin");
    rel(c.beta, -0.379422);
    rel(c.se, 0.191379);
    rel(c.hr, 0.68426);
    rel(c.ciLow, 0.47024);
    rel(c.ciHigh, 0.99568);
    rel(c.p, 0.0474161, 2e-5);
  });
  test("other coefficients", () => {
    rel(coef(f, "age").beta, -0.057438);
    rel(coef(f, "age").se, 0.021999, 3e-5);
    rel(coef(f, "race").beta, 0.3139, 1e-5);
    rel(coef(f, "wexp").beta, -0.149796);
    rel(coef(f, "mar").beta, -0.433704);
    rel(coef(f, "paro").beta, -0.084871);
    rel(coef(f, "prio").beta, 0.091497);
    rel(coef(f, "prio").se, 0.028649, 3e-5);
  });
  test("LR (df 7), Wald, score; C (single oracle)", () => {
    rel(f.likelihoodRatio.statistic, 33.2659, 1e-5);
    expect(f.likelihoodRatio.df).toBe(7);
    rel(f.wald.statistic, 32.1126, 1e-5);
    rel(f.score.statistic, 33.5287, 1e-5);
    abs(f.concordance.c, 0.640329, 1e-6);
  });
  test("PH (single oracle, KM): age 11.0303, wexp 7.4755, GLOBAL χ²(7) = 17.6584 — and the caveat fires", () => {
    const row = (n: string) => f.phTest.rows.find((r) => r.name === n)!;
    abs(row("age").chi2, 11.0303, 5e-5);
    abs(row("age").p, 0.0009, 5e-5);
    abs(row("wexp").chi2, 7.4755, 5e-5);
    abs(row("wexp").p, 0.0063, 5e-5);
    abs(f.phTest.global.chi2, 17.6584, 5e-5);
    abs(f.phTest.global.p, 0.0136, 5e-5);
    const text = f.caveats.join("\n");
    expect(text).toMatch(/age: χ²\(1\) = 11\.03, p = 0\.0009 — the effect of age changes over time; its single HR is an average/);
    expect(text).toMatch(/the effect of wexp changes over time/);
    expect(text).not.toMatch(/the effect of fin changes/);
  });
});

describe("§D1 refusals", () => {
  test("the 6-row Time|Status|Age|Dose|Sex table → EPV refusal quoting \"3 events for 3 parameters\"", () => {
    // The brief's own probe table (scratchpad probe/adj.py). No column is monotone,
    // so it reaches the EPV gate rather than the separation pre-check.
    const toy: CoxInput = {
      times: [5, 8, 12, 15, 20, 24],
      events: [1, 1, 0, 1, 0, 0],
      covariates: [
        { name: "Age", values: [54, 61, 47, 70, 58, 49] },
        { name: "Dose", values: [10, 20, 10, 20, 10, 20] },
        { name: "Sex", values: [0, 1, 1, 0, 0, 1] },
      ],
    };
    const r = coxRegression(toy);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("epv");
    expect(r.reason).toBe(
      "3 events for 3 parameters (1.0 per parameter); Cox estimates need about 10 events per parameter — drop covariates or collect more events.",
    );
    // With the gate OFF the engine reproduces the plausible wrong number the rule
    // exists to stop (brief: lifelines sex β = 0.741, SE 2.84). lifelines stops
    // early on this flat surface (0.741337); statsmodels 0.15.0 PHReg, run this
    // session, gives 0.74193855 (SE 2.83706178), which this engine matches.
    const ungated = fit(coxRegression(toy, { epvGate: false }));
    rel(coef(ungated, "Sex").beta, 0.74193855, 1e-6);
    rel(coef(ungated, "Sex").se, 2.83706178, 1e-6);
  });
  test("separation: x = event → refused naming x (oracles disagree: 26.47 vs 18.06)", () => {
    const ev = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
    const r = coxRegression({ times: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], events: ev, covariates: [{ name: "x", values: ev.slice() }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("separation");
    expect(r.covariates).toEqual(["x"]);
    expect(r.reason).toMatch(/every event occurred with x = 1/i);
    expect(r.reason).toMatch(/hazard ratio for x is infinite — no finite estimate exists/);
  });
  test("Larynx with Stage as TEXT I/II/III/IV → identical to the indicator version, note 'Stage: reference I'", () => {
    const stageText = larynxT.rows.map((r) => (r[5] ? "IV" : r[4] ? "III" : r[3] ? "II" : "I"));
    const d = coxDummyCode("Stage", stageText);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.note).toBe("Stage: reference I; II, III and IV as indicators");
    const viaText = fit(
      coxRegression({
        times: larynx.times,
        events: larynx.events,
        covariates: [...d.covariates, larynx.covariates[3]],
        factors: [d.factor],
      }),
    );
    const viaInd = fit(coxRegression(larynx));
    expect(viaText.coefficients.map((c) => c.name)).toEqual(["Stage_II", "Stage_III", "Stage_IV", "age"]);
    viaText.coefficients.forEach((c, k) => expect(c.beta).toBe(viaInd.coefficients[k].beta));
    expect(viaText.likelihoodRatio.statistic).toBe(viaInd.likelihoodRatio.statistic);
  });
  test("1/2 status coding → the existing survival.ts refusal text", () => {
    const r = coxRegression({ ...gehan, events: gehan.events.map((e) => (e === 1 ? 1 : 2)) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("event-coding");
    expect(r.reason).toMatch(/recode the 2s as 0/);
  });
  // The start/stop (counting-process) refusal is header-driven and belongs to the
  // integrator's table feed: the engine only ever sees (time, event, covariates).
});

describe("§D1 must FIT — guards against over-eager refusal (EPV gate OFF: these pin the separation detector)", () => {
  const times = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const x = [1, 0, 1, 1, 1, 0, 0, 0, 0, 0];
  test("event = 1,1,1,1,0,… → β = 1.739384 (SE 1.158889)", () => {
    const f = fit(coxRegression({ times, events: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0], covariates: [{ name: "x", values: x }] }, { epvGate: false }));
    rel(f.coefficients[0].beta, 1.739384);
    rel(f.coefficients[0].se, 1.158889);
  });
  test("event = 1,1,1,1,1,1,0,1,0,0 → β = 2.267651 (SE 1.138015)", () => {
    const f = fit(coxRegression({ times, events: [1, 1, 1, 1, 1, 1, 0, 1, 0, 0], covariates: [{ name: "x", values: x }] }, { epvGate: false }));
    rel(f.coefficients[0].beta, 2.267651);
    rel(f.coefficients[0].se, 1.138015);
  });
  test("…and with the gate ON both are refused for EPV, not separation", () => {
    const r = coxRegression({ times, events: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0], covariates: [{ name: "x", values: x }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("epv");
  });
});

describe("§D1 EPV boundary", () => {
  // A deterministic extra numeric column (not collinear with anything).
  const extra = (k: number) => larynx.times.map((_, i) => ((i * 37 + k * 11) % 23) / 7);
  test("50 events / 5 parameters = 10.0 → fits", () => {
    const f = fit(coxRegression({ ...larynx, covariates: [...larynx.covariates, { name: "extra", values: extra(1) }] }));
    expect(f.eventsPerParameter).toBe(10);
  });
  test("50 / 6 = 8.3 → refused", () => {
    const r = coxRegression({
      ...larynx,
      covariates: [...larynx.covariates, { name: "e1", values: extra(1) }, { name: "e2", values: extra(5) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^50 events for 6 parameters \(8\.3 per parameter\)/);
  });
  test("49 / 5 = 9.8 → refused", () => {
    const ev = larynx.events.slice();
    ev[ev.indexOf(1)] = 0;
    const r = coxRegression({ ...larynx, events: ev, covariates: [...larynx.covariates, { name: "extra", values: extra(1) }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^49 events for 5 parameters \(9\.8 per parameter\)/);
  });
});

describe("outputs for the integrator", () => {
  const f = fit(coxRegression(gehan));
  test("coxForestData: label, HR, CI, p", () => {
    const rows = coxForestData(fit(coxRegression(larynx)));
    expect(rows.map((r) => r.label)).toEqual(["Stage II vs I", "Stage III vs I", "Stage IV vs I", "age"]);
    rel(rows[2].hr, 5.50678);
    rel(rows[2].lo, 2.4086);
    rel(rows[2].hi, 12.59015);
    rel(rows[2].p, 5.26732e-5, 2e-5);
  });
  test("report text obeys the display contract: β, χ², 'to' in CIs, no en dash or hyphen ranges", () => {
    const lines = coxReportLines(f);
    expect(lines[0]).toBe("Cox regression (Efron ties): n = 42, 30 events, 1 parameter (30 events per parameter)");
    expect(lines[1]).toBe("placebo: β = 1.5721 (SE 0.4124), HR = 4.817 (95% CI 2.147 to 10.81), z = 3.81, p = 0.00014");
    expect(lines.join("\n")).toMatch(/Likelihood-ratio test: χ²\(1\) = 16\.35/);
    expect(lines.join("\n")).toMatch(/HR > 1: a one-unit increase in placebo multiplies the hazard by 4\.817/);
    // No ASCII chi2/^2, and no en dash / hyphen BETWEEN NUMBERS (reads as a minus in Word).
    expect(lines.join("\n")).not.toMatch(/chi2|\^2|\d\s?[–-]\s?\d/);
  });
  test("caveats name the ties method, Wald CI, concordance ≠ calibration, Peto, the PH approximation", () => {
    const t = f.caveats.join("\n");
    expect(t).toMatch(/Efron/);
    expect(t).toMatch(/Wald/);
    expect(t).toMatch(/not calibration/);
    expect(t).toMatch(/Peto/);
    expect(t).toMatch(/Grambsch–Therneau/);
  });
  test("Gehan (the calculator default): profiles are placebo = 0 and placebo = 1 — never the 0.5 'mean patient' — and reproduce §D", () => {
    const { profiles, legendNote, truncated } = coxCurveProfiles(f);
    expect(profiles.map((p) => p.label)).toEqual(["placebo = 0", "placebo = 1"]);
    expect(truncated).toBe(false);
    expect(legendNote).toBe("Breslow baseline.");
    const want: [number, number, number][] = [
      [5, 0.91679, 0.65805],
      [10, 0.80962, 0.36158],
      [15, 0.69495, 0.17326],
      [22, 0.56873, 0.06598],
    ];
    for (const [t, s0, s1] of want) {
      abs(coxSurvivalAt(f, profiles[0].x, t), s0, 6e-6);
      abs(coxSurvivalAt(f, profiles[1].x, t), s1, 6e-6);
    }
  });
  test("Rossi: fin (0/1) defines the curves; other 0/1 columns held at 0, continuous at the mean, all named", () => {
    const r = fit(coxRegression(rossi));
    const { profiles, legendNote } = coxCurveProfiles(r);
    expect(profiles.map((p) => p.label)).toEqual(["fin = 0", "fin = 1"]);
    expect(legendNote).toMatch(/^Other covariates held at age = 24\.6\d* \(mean\), race = 0, wexp = 0, mar = 0, paro = 0, prio = 2\.98\d* \(mean\)\. Breslow baseline\.$/);
    expect(profiles[1].x).toEqual([1, r.coefficients[1].mean, 0, 0, 0, 0, r.coefficients[6].mean]);
    const curve = coxAdjustedSurvival(r, profiles[1].x);
    expect(curve[0]).toEqual({ time: 0, survival: 1 });
    for (let k = 1; k < curve.length; k++) expect(curve[k].survival).toBeLessThanOrEqual(curve[k - 1].survival);
  });
  test("only continuous covariates: mean − 1 SD, mean, mean + 1 SD of the first", () => {
    const r = fit(coxRegression({ ...rossi, covariates: [rossi.covariates[1], rossi.covariates[6]] }));
    const { profiles } = coxCurveProfiles(r);
    expect(profiles.map((p) => p.label.replace(/ = [\d.]+/, " = v"))).toEqual(["age = v (mean − 1 SD)", "age = v (mean)", "age = v (mean + 1 SD)"]);
  });
  test("convergence is stated", () => {
    expect(f.convergence).toMatch(/converged in \d+ iterations? \(\|Δℓ\| ≤ 10⁻⁹·\|ℓ\|; cap 30\)/);
  });
});
