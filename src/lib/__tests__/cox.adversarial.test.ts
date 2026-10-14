// Cox regression — the hostile pass (house rule: a separate adversarial file).
// Every refusal by name, tied times galore, conditioning, degenerate inputs, a
// performance bound, and two independent cross-checks (log-rank identity; a
// lifelines/statsmodels oracle on a heavily tied table).

import { coxRegression, coxReportLines, coxDummyCode, coxCurveProfiles, COX_MAX_SUBJECTS, type CoxFit, type CoxInput, type CoxResult, type CoxRefusal } from "../cox";
import { logRankTest } from "../survival";

function fit(r: CoxResult): CoxFit {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
}
function refused(r: CoxResult): CoxRefusal {
  if (r.ok) throw new Error("expected a refusal, got a fit");
  // A refusal is text, never a number dressed as an answer.
  expect(r.reason).not.toMatch(/NaN|undefined|Infinity/);
  return r;
}
function rel(actual: number, expected: number, r: number) {
  if (!(Math.abs(actual - expected) <= r * Math.abs(expected))) throw new Error(`expected ${expected} (rel ${r}), got ${actual}`);
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulated exponential survival with uniform censoring; times rounded to `dp` decimals (dp small → ties). */
function simulate(n: number, betas: number[], seed: number, dp = 6): CoxInput {
  const r = rng(seed);
  const p = betas.length;
  const cols = Array.from({ length: p }, () => new Array<number>(n));
  const times: number[] = [];
  const events: number[] = [];
  for (let i = 0; i < n; i++) {
    let eta = 0;
    for (let j = 0; j < p; j++) {
      const v = j % 2 === 0 ? r() * 2 - 1 : r() < 0.5 ? 1 : 0;
      cols[j][i] = v;
      eta += betas[j] * v;
    }
    const t = -Math.log(1 - r()) / Math.exp(eta);
    const c = r() * 3;
    const f = 10 ** dp;
    times.push(Math.round(Math.min(t, c) * f) / f + 1 / f);
    events.push(t <= c ? 1 : 0);
  }
  return { times, events, covariates: cols.map((values, j) => ({ name: `x${j + 1}`, values })) };
}

/** 80 subjects, 4-level Stage factor (reference I) + age; Stage I has NO events. */
function larynxLike(): CoxInput {
  const r = rng(21);
  const n = 80;
  const stage = Array.from({ length: n }, (_, i) => i % 4);
  const times = stage.map((s) => Math.round((r() * 10 + 0.1) / (1 + s) * 1000) / 1000);
  const events = stage.map((s, i) => (s === 0 ? 0 : i % 5 === 0 ? 0 : 1));
  return {
    times,
    events,
    covariates: [
      { name: "Stage_II", values: stage.map((s) => (s === 1 ? 1 : 0)) },
      { name: "Stage_III", values: stage.map((s) => (s === 2 ? 1 : 0)) },
      { name: "Stage_IV", values: stage.map((s) => (s === 3 ? 1 : 0)) },
      { name: "age", values: stage.map(() => Math.round(40 + r() * 40)) },
    ],
    factors: [{ name: "Stage", reference: "I", levels: ["II", "III", "IV"], columns: ["Stage_II", "Stage_III", "Stage_IV"] }],
  };
}

const gehan: CoxInput = {
  times: [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35, 1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23],
  events: [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, ...new Array(21).fill(1)],
  covariates: [{ name: "placebo", values: [...new Array(21).fill(0), ...new Array(21).fill(1)] }],
};

// ---------------------------------------------------------------------------------
describe("refusals by name — never a number", () => {
  test("size caps come before any work: n > 5,000 and > 20 parameters", () => {
    const big = COX_MAX_SUBJECTS + 1;
    const r1 = refused(coxRegression({ times: new Array(big).fill(1), events: new Array(big).fill(1), covariates: [{ name: "x", values: new Array(big).fill(0) }] }));
    expect(r1.code).toBe("size");
    expect(r1.reason).toMatch(/5,001 subjects is above the limit of 5,000/);
    const covs = Array.from({ length: 21 }, (_, j) => ({ name: `c${j}`, values: [1, 2, 3] }));
    const r2 = refused(coxRegression({ times: [1, 2, 3], events: [1, 1, 1], covariates: covs }));
    expect(r2.code).toBe("size");
    expect(r2.reason).toMatch(/21 parameters/);
  });
  test("no covariates; length mismatches; duplicate names; unknown ties", () => {
    expect(refused(coxRegression({ times: [1, 2], events: [1, 1], covariates: [] })).reason).toMatch(/at least one covariate/);
    expect(refused(coxRegression({ times: [1, 2], events: [1], covariates: [{ name: "x", values: [1, 2] }] })).reason).toMatch(/matching event indicator/);
    const mm = refused(coxRegression({ times: [1, 2], events: [1, 1], covariates: [{ name: "age", values: [1] }] }));
    expect(mm.reason).toMatch(/age has 1 values for 2 subjects/);
    const dup = refused(coxRegression({ ...gehan, covariates: [gehan.covariates[0], { name: "placebo", values: gehan.times.slice() }] }));
    expect(dup.reason).toMatch(/both named "placebo"/);
    expect(refused(coxRegression(gehan, { ties: "exact" as never })).reason).toMatch(/Unknown ties method/);
  });
  test("negative, NaN and infinite times are refused, naming the row", () => {
    const t = gehan.times.slice();
    t[4] = -7;
    expect(refused(coxRegression({ ...gehan, times: t })).reason).toMatch(/non-negative — row 5 has time −7/);
    t[4] = NaN;
    expect(refused(coxRegression({ ...gehan, times: t })).reason).toMatch(/row 5/);
    t[4] = Infinity;
    expect(refused(coxRegression({ ...gehan, times: t })).code).toBe("input");
  });
  test("a non-finite covariate cell is refused by row and column (no silent complete-case drop)", () => {
    const v = gehan.covariates[0].values.slice();
    v[9] = NaN;
    const r = refused(coxRegression({ ...gehan, covariates: [{ name: "placebo", values: v }] }));
    expect(r.reason).toMatch(/placebo has no usable number in row 10/);
    expect(r.covariates).toEqual(["placebo"]);
  });
  test("1/2 event coding: the reason is VERBATIM the one logRankTest gives (kept in sync)", () => {
    const ev = gehan.events.map((e) => (e ? 1 : 2));
    const cox = refused(coxRegression({ ...gehan, events: ev }));
    const lr = logRankTest([
      { times: gehan.times.slice(0, 21), events: ev.slice(0, 21) },
      { times: gehan.times.slice(21), events: ev.slice(21) },
    ]);
    expect(lr.ok).toBe(false);
    expect(cox.reason).toBe(lr.reason);
    expect(cox.code).toBe("event-coding");
  });
  test("all censored → no events; one subject; a single event", () => {
    expect(refused(coxRegression({ ...gehan, events: gehan.events.map(() => 0) })).code).toBe("no-events");
    expect(refused(coxRegression({ times: [3], events: [1], covariates: [{ name: "x", values: [1] }] })).code).toBe("too-few-events");
    expect(refused(coxRegression({ times: [3], events: [0], covariates: [{ name: "x", values: [1] }] })).code).toBe("no-events");
    const one = gehan.events.map((_, i) => (i === 25 ? 1 : 0));
    expect(refused(coxRegression({ ...gehan, events: one })).reason).toMatch(/Only 1 event/);
  });
  test("every event at one time → refused, naming the time", () => {
    const times = [5, 5, 5, 5, 5, 5, 8, 9, 10, 11, 12, 13];
    const events = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
    const r = refused(coxRegression({ times, events, covariates: [{ name: "x", values: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] }] }, { epvGate: false }));
    expect(r.code).toBe("one-event-time");
    expect(r.reason).toMatch(/same time \(t = 5\)/);
  });
  test("zero variance — including a large constant that rounding might wobble", () => {
    const r = refused(coxRegression({ ...gehan, covariates: [gehan.covariates[0], { name: "site", values: gehan.times.map(() => 3) }] }));
    expect(r.code).toBe("zero-variance");
    expect(r.reason).toMatch(/^site has the same value \(3\) for every subject/);
    const r2 = refused(coxRegression({ ...gehan, covariates: [{ name: "big", values: gehan.times.map(() => 1e6 + 0.1) }] }));
    expect(r2.covariates).toEqual(["big"]);
  });
  test("collinear pair is named with its relation (dose_mg = 1000 × dose)", () => {
    const dose = gehan.times.map((_, i) => (i * 7) % 5);
    const r = refused(
      coxRegression({ ...gehan, covariates: [gehan.covariates[0], { name: "dose", values: dose }, { name: "dose_mg", values: dose.map((d) => d * 1000) }] }),
    );
    expect(r.code).toBe("collinear");
    expect(r.reason).toMatch(/^dose_mg and dose are collinear \(dose_mg = 1000 × dose\)/);
    expect(r.covariates).toEqual(["dose_mg", "dose"]);
  });
  test("three-way collinearity names every column involved", () => {
    const a = gehan.times.map((_, i) => (i * 7) % 5);
    const b = gehan.times.map((_, i) => (i * 3) % 4);
    const r = refused(
      coxRegression({ ...gehan, covariates: [{ name: "a", values: a }, { name: "b", values: b }, { name: "total", values: a.map((v, i) => v + 2 * b[i] + 1) }] }),
    );
    expect(r.code).toBe("collinear");
    expect(r.reason).toMatch(/^total is an exact linear combination of a and b/);
  });
  test("a full set of indicators (no reference level left out) is collinear — and says why", () => {
    const g = gehan.times.map((_, i) => i % 3);
    const r = refused(
      coxRegression({
        ...gehan,
        covariates: [0, 1, 2].map((k) => ({ name: `arm_${k}`, values: g.map((v) => (v === k ? 1 : 0)) })),
      }),
    );
    expect(r.code).toBe("collinear");
    expect(r.reason).toMatch(/reference/);
  });
  test("separation toward ZERO (every event has the lowest x) is named", () => {
    const ev = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
    const r = refused(coxRegression({ times: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], events: ev, covariates: [{ name: "protect", values: ev.map((e) => 1 - e) }] }));
    expect(r.code).toBe("separation");
    expect(r.reason).toMatch(/^Every event occurred with protect = 0 while subjects with protect = 1 were still at risk/);
    expect(r.reason).toMatch(/hazard ratio for protect is zero/);
  });
  test("a RARE level (one subject with x = 1, failed first) is refused — and the text does NOT claim 'every event had x = 1'", () => {
    const times = Array.from({ length: 30 }, (_, i) => i + 1);
    const events = times.map((_, i) => (i % 3 === 2 ? 0 : 1));
    const rare = times.map((_, i) => (i === 0 ? 1 : 0));
    const r = refused(coxRegression({ times, events, covariates: [{ name: "rare", values: rare }] }));
    expect(r.code).toBe("separation");
    expect(r.reason).not.toMatch(/every event occurred with rare = 1/i);
    expect(r.reason).toMatch(/held the highest rare of everyone still at risk/);
    expect(r.reason).toMatch(/rare = 1 is held by only 1 subject, and no one with rare = 0 had an event while that subject was still at risk — merge this rare level/);
  });
  test("the REFERENCE level with no events is named (not whichever indicator diverged largest, e.g. 'III')", () => {
    const t = larynxLike();
    const r = refused(coxRegression(t));
    expect(r.code).toBe("separation");
    expect(r.reason).toMatch(/^No events occurred in Stage I, the reference level, so the hazard ratio of every other Stage level \(II, III and IV\) against I is infinite/);
    expect(r.covariates).toEqual(["Stage_II", "Stage_III", "Stage_IV"]);
  });
  test("…and WITHOUT factor metadata the same table is still refused as divergent (post-fit), never fitted", () => {
    const t = larynxLike();
    const r = refused(coxRegression({ ...t, factors: undefined }));
    expect(r.code).toBe("separation");
    expect(r.reason).toMatch(/is diverging/);
  });
  test("a STRONG but FINITE effect (|β|·SD > 10, converged, small SE) is FITTED with the strong-effect caveat — not refused", () => {
    // The independent review's case (stats.review.test.ts): statsmodels and lifelines
    // agree β = 16.106031, SE 2.513847 (z = 6.4); the old |β|·SD > 10 rule refused it.
    const times = [1369.516, 6557.849, 181.019, 27.836, 4.64, 65.164, 550.217, 1047.546, 12.32, 0.677, 42.469, 4297.34, 1818.417, 0.663, 68.065, 13055.365, 95.2, 2378.5, 841.156, 395.059, 666.707, 14.311, 134.251, 450.228, 21.29, 9.671, 10250.311, 199.288, 1892.628, 150.401, 4721.6, 131.34, 98.455, 181.882, 1465.224, 311.859, 2418.959, 6229.611, 45.365, 2473.923, 2.494, 10.231, 41717.54, 40.193, 2794.562, 145.663, 98.895, 26276.679, 310.698, 234.978, 4.41, 4342.792, 10.973, 2317.592, 230.596, 970.908, 1.311, 23.754, 0.063, 16.194];
    const events = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1];
    const x = [-0.8019, -1.3244, -0.2484, 0.4204, 1.136, 0.1097, -0.5526, -0.7848, 0.7487, 1.6348, 0.2728, -1.2333, -0.9583, 1.6, 0.2029, -1.7321, -0.0837, -1.1632, -0.6293, -0.488, -0.7133, 0.5534, -0.0631, -0.5894, 0.4096, 0.8299, -1.643, -0.2567, -0.9807, -0.1732, -1.2894, 0.0207, -0.0379, -0.3043, -1.0479, -0.3962, -1.0913, -1.3552, 0.2248, -1.1093, 1.1703, 0.7166, -1.9978, 0.2721, -1.1017, 0.0331, 0.0436, -1.9884, -0.2334, -0.2558, 0.962, -1.1814, 0.738, -1.099, -0.3313, -0.8405, 1.4487, 0.5682, 2.4317, 0.6419];
    const f = fit(coxRegression({ times, events, covariates: [{ name: "x1", values: x }] }));
    rel(f.coefficients[0].beta, 16.106031, 1e-6);
    rel(f.coefficients[0].se, 2.513847, 1e-6);
    const c = f.coefficients[0];
    expect(Math.abs(c.beta * c.sd)).toBeGreaterThan(10);
    expect(Math.abs(c.z)).toBeGreaterThan(5);
    expect(f.caveats.join("\n")).toMatch(/x1: a very strong effect \(β × SD = [\d.]+\) — the estimate is finite \(the fit converged, SE × SD = [\d.]+\) but imprecise; check for near-separation\./);
  });
  test("a NON-reference level with no events is named as that level", () => {
    const t = larynxLike();
    // Give Stage I its events back; take Stage III's away.
    const ev = t.events.map((e, i) => (t.covariates[1].values[i] === 1 ? 0 : i % 2 === 0 ? 1 : e));
    const r = refused(coxRegression({ ...t, events: ev }));
    expect(r.reason).toMatch(/^No events occurred in Stage III, so its hazard ratio against I is zero/);
  });
  test("separation on a CONTINUOUS covariate (each death has the highest value at risk)", () => {
    const times = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const events = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
    const x = [12, 11, 10, 9, 8, 7.5, 1, 2, 3, 4, 5, 6];
    const r = refused(coxRegression({ times, events, covariates: [{ name: "marker", values: x }] }));
    expect(r.code).toBe("separation");
    expect(r.reason).toMatch(/held the highest marker of everyone still at risk/);
  });
  test("separation by a COMBINATION (neither column alone) is caught post-fit and named, not reported as numbers", () => {
    const r0 = rng(7);
    const n = 40;
    const times = Array.from({ length: n }, (_, i) => i + 1);
    const events = times.map((_, i) => (i < 20 ? 1 : 0));
    const x1 = times.map(() => Math.round(r0() * 100) / 10);
    const x2 = x1.map((v, i) => (events[i] ? 1 : 0) - v); // x1 + x2 = event indicator
    const r = refused(coxRegression({ times, events, covariates: [{ name: "x1", values: x1 }, { name: "x2", values: x2 }] }, { epvGate: false }));
    expect(r.code).toBe("separation");
    expect(["x1", "x2"]).toContain(r.covariates![0]);
    expect(r.reason).toMatch(/is diverging/);
  });
  test("singular information: a covariate that varies only among subjects gone before the first event", () => {
    const times = [0.5, 0.5, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const events = [0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1];
    const g = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0];
    const x = [3, 7, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = refused(coxRegression({ times, events, covariates: [{ name: "g", values: g }, { name: "lab", values: x }] }, { epvGate: false }));
    expect(r.code).toBe("singular");
    expect(r.covariates).toEqual(["lab"]);
    expect(r.reason).toMatch(/singular at lab/);
  });
});

describe("tied times galore", () => {
  // Five distinct times for 60 subjects. Oracle computed this session (Python 3.14):
  // lifelines 0.30.3 CoxPHFitter (Efron) and statsmodels 0.15.0 PHReg (efron, breslow).
  const n = 60;
  const tied: CoxInput = {
    times: Array.from({ length: n }, (_, i) => 1 + ((i * 7) % 5)),
    events: Array.from({ length: n }, (_, i) => ((i * 3) % 4 === 0 ? 0 : 1)),
    covariates: [
      { name: "x1", values: Array.from({ length: n }, (_, i) => ((i * 13) % 17) / 4) },
      { name: "x2", values: Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 1 : 0)) },
    ],
  };
  test("Efron matches lifelines + statsmodels (β, SE, ℓ) and C matches lifelines", () => {
    const f = fit(coxRegression(tied));
    expect(f.events).toBe(45);
    rel(f.coefficients[0].beta, 0.04807741, 1e-6);
    rel(f.coefficients[1].beta, 0.01172315, 2e-6);
    rel(f.coefficients[0].se, 0.12444993, 1e-6);
    rel(f.coefficients[1].se, 0.31773622, 1e-6);
    rel(f.logLik, -146.42909246559705, 1e-10);
    rel(f.concordance.c, 0.5316872427983539, 1e-12);
  });
  test("Breslow matches statsmodels", () => {
    const f = fit(coxRegression(tied, { ties: "breslow" }));
    rel(f.coefficients[0].beta, 0.04321271, 1e-6);
    rel(f.coefficients[1].beta, 0.00692152, 2e-6);
    rel(f.coefficients[0].se, 0.12275663, 1e-6);
    rel(f.logLik, -154.84619914007095, 1e-10);
  });
  test("row order is irrelevant (shuffled input → identical fit)", () => {
    const a = fit(coxRegression(tied));
    const perm = Array.from({ length: n }, (_, i) => (i * 37) % n);
    const b = fit(
      coxRegression({
        times: perm.map((i) => tied.times[i]),
        events: perm.map((i) => tied.events[i]),
        covariates: tied.covariates.map((c) => ({ name: c.name, values: perm.map((i) => c.values[i]) })),
      }),
    );
    a.coefficients.forEach((c, k) => rel(b.coefficients[k].beta, c.beta, 1e-10));
    rel(b.logLik, a.logLik, 1e-12);
    expect(b.concordance.c).toBe(a.concordance.c);
  });
});

describe("conditioning", () => {
  test("a covariate ×10⁶: β ÷ 10⁶, HR per original unit consistent; z, p, LR, Wald, score, C, PH unchanged", () => {
    const a = fit(coxRegression(gehan));
    const b = fit(coxRegression({ ...gehan, covariates: [{ name: "placebo", values: gehan.covariates[0].values.map((v) => v * 1e6) }] }));
    rel(b.coefficients[0].beta * 1e6, a.coefficients[0].beta, 1e-10);
    rel(b.coefficients[0].se * 1e6, a.coefficients[0].se, 1e-10);
    rel(Math.pow(b.coefficients[0].hr, 1e6), a.coefficients[0].hr, 1e-6);
    rel(b.coefficients[0].z, a.coefficients[0].z, 1e-10);
    rel(b.likelihoodRatio.statistic, a.likelihoodRatio.statistic, 1e-10);
    rel(b.wald.statistic, a.wald.statistic, 1e-10);
    rel(b.score.statistic, a.score.statistic, 1e-10);
    rel(b.phTest.global.chi2, a.phTest.global.chi2, 1e-8);
    expect(b.concordance.c).toBe(a.concordance.c);
  });
  test("a huge offset (dates as numbers, 1e8 + x) changes nothing — centring, not luck", () => {
    const sim = simulate(300, [0.8, -0.5], 11);
    const a = fit(coxRegression(sim));
    const b = fit(coxRegression({ ...sim, covariates: sim.covariates.map((c) => ({ name: c.name, values: c.values.map((v) => v + 1e8) })) }));
    a.coefficients.forEach((c, k) => rel(b.coefficients[k].beta, c.beta, 1e-6));
    rel(b.logLik, a.logLik, 1e-9);
  });
  test("raw dose in µg with a real effect: no exp overflow (β·x far beyond 710), finite and correct", () => {
    const sim = simulate(400, [1.5], 5);
    const a = fit(coxRegression(sim));
    const ug = fit(coxRegression({ ...sim, covariates: [{ name: "dose_ug", values: sim.covariates[0].values.map((v) => v * 1e4 + 2e6) }] }));
    rel(ug.coefficients[0].beta * 1e4, a.coefficients[0].beta, 1e-8);
    expect(Number.isFinite(ug.logLik)).toBe(true);
  });
});

describe("degenerate but legal", () => {
  test("duplicate rows under Breslow: β identical, SE ÷ √2, LR doubled (the likelihood is exactly 2ℓ + const)", () => {
    const a = fit(coxRegression(gehan, { ties: "breslow" }));
    const dup: CoxInput = {
      times: [...gehan.times, ...gehan.times],
      events: [...gehan.events, ...gehan.events],
      covariates: [{ name: "placebo", values: [...gehan.covariates[0].values, ...gehan.covariates[0].values] }],
    };
    const b = fit(coxRegression(dup, { ties: "breslow" }));
    rel(b.coefficients[0].beta, a.coefficients[0].beta, 1e-8);
    rel(b.coefficients[0].se * Math.SQRT2, a.coefficients[0].se, 1e-8);
    rel(b.likelihoodRatio.statistic, 2 * a.likelihoodRatio.statistic, 1e-8);
    // Under Efron duplication CREATES ties, so β legitimately moves — not asserted.
  });
  test("tied times only between deaths and censorings (no tied deaths): Efron and Breslow are bit-identical", () => {
    const times = [1, 2, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    // At each tied time exactly one death.
    const events = [1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
    const x = times.map((_, i) => ((i * 5) % 7) / 3);
    const inp = { times, events, covariates: [{ name: "x", values: x }] };
    const e = fit(coxRegression(inp));
    const b = fit(coxRegression(inp, { ties: "breslow" }));
    expect(e.coefficients[0].beta).toBe(b.coefficients[0].beta);
    expect(e.coefficients[0].se).toBe(b.coefficients[0].se);
    expect(e.logLik).toBe(b.logLik);
    expect(e.score.statistic).toBe(b.score.statistic);
  });
  test("time 0 is allowed (a death on day 0 is data, not an error)", () => {
    const t = gehan.times.slice();
    t[21] = 0;
    expect(coxRegression({ ...gehan, times: t }).ok).toBe(true);
  });
  test("the report never prints NaN, Infinity or ASCII chi2", () => {
    const f = fit(coxRegression(simulate(300, [0.5, 0.3, -0.4], 3)));
    const t = coxReportLines(f).join("\n");
    expect(t).not.toMatch(/NaN|Infinity|undefined|chi2/);
  });
});

describe("independent cross-check: the Cox score test IS the log-rank test (untied data)", () => {
  // Identity: for one binary covariate and NO tied event times, the partial-
  // likelihood score statistic at β = 0, U(0)²/I(0), is exactly the log-rank
  // statistic (O₁ − E₁)²/V with the hypergeometric variance — the risk-set sums
  // of the Cox score are the log-rank observed-minus-expected terms. (With tied
  // times it is NOT: Gehan gives Efron 17.25, Breslow 15.93, log-rank 16.79.)
  test.each([1, 2, 3, 4])("seed %i: score = survival.ts log-rank χ² to 1e-10", (seed) => {
    const sim = simulate(80, [0.9], seed); // continuous times, 6 d.p.: untied
    const grp = sim.times.map((_, i) => (i % 2 === 0 ? 1 : 0));
    expect(new Set(sim.times).size).toBe(sim.times.length);
    const f = fit(coxRegression({ times: sim.times, events: sim.events, covariates: [{ name: "g", values: grp }] }, { epvGate: false }));
    const g0 = { times: [] as number[], events: [] as number[] };
    const g1 = { times: [] as number[], events: [] as number[] };
    sim.times.forEach((t, i) => {
      const g = grp[i] ? g1 : g0;
      g.times.push(t);
      g.events.push(sim.events[i]);
    });
    const lr = logRankTest([g0, g1]);
    expect(lr.ok).toBe(true);
    rel(f.score.statistic, lr.chi2, 1e-10);
  });
});

describe("performance: 2,000 subjects × 8 covariates", () => {
  test("fits in under 1 s (4 s gross-freeze bound here, since the full suite runs in parallel)", () => {
    const sim = simulate(2000, [0.4, -0.3, 0.2, 0.5, -0.2, 0.1, 0.3, -0.4], 42, 2); // 2 d.p. → ties too
    const t0 = Date.now();
    const f = fit(coxRegression(sim));
    const ms = Date.now() - t0;
    expect(f.parameters).toBe(8);
    expect(f.events).toBeGreaterThan(80);
    expect(ms).toBeLessThan(4000);
  });
});

describe("adjusted-curve cap is stated, never silent", () => {
  test("an 8-level factor → 6 curves and 'Showing 6 of 8 levels'", () => {
    const sim = simulate(800, [0.3], 9, 3);
    const lv = sim.times.map((_, i) => ["A", "B", "C", "D", "E", "F", "G", "H"][i % 8]);
    const d = coxDummyCode("Site", lv);
    if (!d.ok) throw new Error(d.reason);
    const f = fit(coxRegression({ ...sim, covariates: [...d.covariates, sim.covariates[0]], factors: [d.factor] }));
    const { profiles, legendNote, truncated } = coxCurveProfiles(f);
    expect(profiles.length).toBe(6);
    expect(truncated).toBe(true);
    expect(legendNote).toMatch(/Showing 6 of 8 levels of Site \(at most 6 curves\)/);
    expect(legendNote).toMatch(/x1 = .* \(mean\)/);
  });
});

describe("coxDummyCode (table-feed helper)", () => {
  test("first-appearance reference; >10 levels refused as an id; blank refused by row; single level refused", () => {
    const d = coxDummyCode("Arm", ["B", "A", "B", "C"], "first");
    expect(d.ok && d.factor.reference).toBe("B");
    const ids = coxDummyCode("Patient name", Array.from({ length: 11 }, (_, i) => `P${i}`));
    expect(!ids.ok && ids.reason).toMatch(/11 levels — an id, not a covariate/);
    const blank = coxDummyCode("Stage", ["I", "II", " ", "I"]);
    expect(!blank.ok && blank.reason).toMatch(/blank in row 3/);
    const one = coxDummyCode("Site", ["X", "X"]);
    expect(one.ok).toBe(false);
  });
  test("a level name with a space is sanitised in the column name", () => {
    const d = coxDummyCode("Dose group", ["low dose", "high dose", "low dose"]);
    expect(d.ok && d.factor.columns).toEqual(["Dose_group_low_dose"]);
  });
});
