/**
 * Portfolio & risk and corporate finance engines (F1, gap items #4 and #5, defect D6) against scripts/portcorp-oracle.py
 * (fixtures/portcorp-oracle.json): numpy for performance and drawdown, statsmodels 0.15 for the CAPM regression
 * (classical, HC1, Newey–West HAC), numpy/scipy for VaR and CVaR with a 64-bit PCG32 port for the Monte Carlo draws,
 * PyPortfolioOpt 1.6.0 for the long-only frontier, numpy.roots for every IRR, numpy-financial for NPV/IRR/MIRR, and
 * independent Python transcriptions of payback, PI, EAA, WACC with Hamada and the multi-stage DCF.
 *
 * Tolerances: closed forms (performance, VaR historical/normal, NPV, MIRR, payback, PI, EAA, WACC, DCF) 1e-10 relative;
 * CAPM coefficients, SEs and p-values 1e-8 relative; Student t VaR/CVaR 1e-8 (the t quantile is a bisection on
 * incompleteBeta); Monte Carlo VaR/CVaR 1e-10 (the same PCG32 stream, so the same draws); IRR roots 1e-9 absolute as a
 * set; Markowitz: portfolio variance and Sharpe ratio 1e-6 relative to PyPortfolioOpt (cvxpy's solver tolerance; ours
 * is never worse by more than that), weights 2e-4 absolute; 32 random problems (40 generated, 8 that cvxpy itself could not
 * solve skipped, mostly nearly-equal means) held to objective bounds against cvxpy's weights clipped feasible.
 */
import * as fs from "fs";
import * as path from "path";
import { capmRegression, efficientReturn, frontierFromMoments, markowitz, performance, valueAtRisk } from "../portfolioRisk";
import { dcfValue, eaa, irrAll, mirr, npvAt, payback, profitabilityIndex, wacc } from "../corpFinance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any;
const FX: R = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "portcorp-oracle.json"), "utf8"));
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-300, Math.abs(b), 1e-12);
const near = (a: number, b: number, tol: number): void => {
  if (!(rel(a, b) < tol)) throw new Error(`${a} vs ${b} (rel ${rel(a, b)})`);
};
const pctList = (xs: number[]): number[] => xs.map((x) => x / 100);

describe.each((FX.perf as R[]).map((c, i) => [i, c] as const))("performance case %i", (_i, c) => {
  test("means, volatility, ratios, drawdown", () => {
    const p = performance(pctList(c.r), c.ppy, c.rf / 100, c.mar / 100, c.beta);
    if ("error" in p) throw new Error(p.error);
    near(p.meanAnnual, c.meanAnnual, 1e-10);
    near(p.geoAnnual, c.geoAnnual, 1e-10);
    near(p.volAnnual, c.volAnnual, 1e-10);
    near(p.sharpe!, c.sharpe, 1e-10);
    near(p.downsideDev, c.downsideDev, 1e-10);
    near(p.sortino!, c.sortino, 1e-10);
    near(p.treynor!, c.treynor, 1e-10);
    near(p.dd.max, c.maxDD, 1e-10);
    expect(p.dd.peak).toBe(c.peak);
    expect(p.dd.trough).toBe(c.trough);
    near(p.calmar!, c.calmar, 1e-10);
    near(p.totalReturn, c.total, 1e-10);
  });
});

describe.each((FX.capm as R[]).map((c) => [c.cov, c] as const))("CAPM %s", (_n, c) => {
  test("β, α, SEs, t, p, CI, R², Treynor, information ratio vs statsmodels", () => {
    const rf = (c.ra as number[]).map(() => c.rf / 100);
    const r = capmRegression(pctList(c.ra), pctList(c.rm), rf, c.ppy, c.cov);
    if ("error" in r) throw new Error(r.error);
    near(r.beta.coef, c.beta, 1e-10);
    near(r.beta.se, c.betaSe, 1e-8);
    near(r.beta.t, c.betaT, 1e-8);
    near(r.beta.lo, c.betaLo, 1e-8);
    near(r.beta.hi, c.betaHi, 1e-8);
    expect(Math.abs(r.beta.p - c.betaP)).toBeLessThan(1e-12);
    near(r.alpha.coef, c.alpha, 1e-9);
    near(r.alpha.se, c.alphaSe, 1e-8);
    near(r.alpha.t, c.alphaT, 1e-8);
    near(r.alpha.p, c.alphaP, 1e-8);
    near(r.r2, c.r2, 1e-10);
    near(r.treynor, c.treynor, 1e-10);
    near(r.infoRatio!, c.infoRatio, 1e-10);
    near(r.varIdio, c.varIdio, 1e-10);
  });
});

describe.each((FX.var as R[]).map((c, i) => [i, c] as const))("VaR case %i", (_i, c) => {
  test("historical, normal, Student t, Monte Carlo (same PCG32 draws)", () => {
    const v = valueAtRisk({ r: pctList(c.r), conf: c.conf, horizon: c.h, nu: c.nu, sims: c.sims, seed: c.seed });
    if ("error" in v) throw new Error(v.error);
    const [h, n, t, mc] = v.lines;
    near(h.var, c.hist[0], 1e-10);
    near(h.cvar, c.hist[1], 1e-10);
    near(n.var, c.normal[0], 1e-10);
    near(n.cvar, c.normal[1], 1e-10);
    near(t.var, c.t[0], 1e-8);
    near(t.cvar, c.t[1], 1e-8);
    near(mc.var, c.mc[0], 1e-10);
    near(mc.cvar, c.mc[1], 1e-10);
  });
});

const colsOf = (R2: number[][]): number[][] => R2[0].map((_, j) => R2.map((row) => row[j] / 100));

describe.each((FX.frontier as R[]).map((c, i) => [i, c] as const))("Markowitz case %i vs PyPortfolioOpt", (_i, c) => {
  const cols = colsOf(c.R);
  const f = markowitz(cols, c.ppy, c.rf / 100);
  test("minimum variance and tangency", () => {
    if ("error" in f) throw new Error(f.error);
    // Ours may be lower (better) than cvxpy's by its tolerance, never higher.
    expect(f.minVol.vol ** 2).toBeLessThanOrEqual(c.minVolVar * (1 + 1e-6));
    near(f.minVol.vol ** 2, c.minVolVar, 1e-6);
    f.minVol.w.forEach((w, i) => expect(Math.abs(w - c.minVolW[i])).toBeLessThan(2e-4));
    expect(f.tangency.sharpe).toBeGreaterThanOrEqual(c.tanSharpe * (1 - 1e-6));
    near(f.tangency.sharpe, c.tanSharpe, 1e-6);
    f.tangency.w.forEach((w, i) => expect(Math.abs(w - c.tanW[i])).toBeLessThan(2e-4));
    expect(Math.abs(f.tangency.w.reduce((s, x) => s + x, 0) - 1)).toBeLessThan(1e-12);
    for (const w of [...f.tangency.w, ...f.minVol.w]) expect(w).toBeGreaterThanOrEqual(0);
  });
  test.each((c.points as R[]).map((p) => [p.target, p] as const))("efficient return %f", (_t, p) => {
    if ("error" in f) throw new Error(f.error);
    const e = efficientReturn(f.mu, f.S, p.target);
    if ("error" in e) throw new Error(e.error);
    expect(Math.abs(e.ret - p.target)).toBeLessThan(1e-12);
    expect(e.vol).toBeLessThanOrEqual(p.vol * (1 + 1e-6));
    near(e.vol, p.vol, 1e-6);
    e.w.forEach((w, i) => expect(Math.abs(w - p.w[i])).toBeLessThan(2e-4));
  });
});

describe("Markowitz fuzz vs PyPortfolioOpt: 2 to 10 assets, equal and nearly equal means, 0.95 correlation", () => {
  test.each((FX.frontierFuzz as R[]).map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const f = frontierFromMoments(c.mu, c.S, c.rf);
    if ("error" in f) throw new Error(f.error);
    // cvxpy's weights can be slightly negative (to about −1e−6), which overstates its Sharpe ratio a little; its
    // weights clipped and renormalised are feasible, so the exact optimum is never worse than them, and it agrees
    // with cvxpy's own figures to 1e−5.
    expect(f.minVol.vol ** 2).toBeLessThanOrEqual(c.minVolVarFeasible * (1 + 1e-12));
    expect(f.tangency.sharpe).toBeGreaterThanOrEqual(c.tanSharpeFeasible * (1 - 1e-12));
    expect(rel(f.minVol.vol ** 2, c.minVolVar)).toBeLessThan(1e-5);
    expect(rel(f.tangency.sharpe, c.tanSharpe)).toBeLessThan(1e-5);
    const e = efficientReturn(f.mu, f.S, c.target);
    if ("error" in e) throw new Error(e.error);
    expect(e.vol ** 2).toBeLessThanOrEqual(c.targetVar * (1 + 1e-6) + 1e-15);
    for (const w of [...f.minVol.w, ...f.tangency.w, ...e.w]) expect(w).toBeGreaterThanOrEqual(0);
    expect(Math.abs(e.w.reduce((s, x) => s + x, 0) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(e.ret - c.target)).toBeLessThan(1e-12);
  });
});

describe.each((FX.budget as R[]).map((c) => [(c.cfs as number[]).slice(0, 4).join(", "), c] as const))("capital budgeting [%s …]", (_n, c) => {
  test("NPV, every IRR (numpy.roots), MIRR, payback, PI, EAA", () => {
    const v = npvAt(c.rate, c.cfs);
    near(v, c.npv, 1e-10);
    const x = irrAll(c.cfs);
    const found = [...x.roots, ...x.touches].sort((a, b) => a - b);
    expect(found.length).toBe(c.irrs.length);
    found.forEach((r, i) => expect(Math.abs(r - c.irrs[i])).toBeLessThan(1e-9));
    if (c.npfIrr !== null) expect(found.some((r) => Math.abs(r - c.npfIrr) < 1e-9)).toBe(true);
    const m = mirr(c.cfs, c.fr, c.rr);
    if (c.mirr === null) expect(m).toBeNull();
    else near(m!, c.mirr, 1e-10);
    const pb = payback(c.cfs).at;
    if (c.payback === null) expect(pb === null || pb === "start").toBe(true);
    else near(pb as number, c.payback, 1e-10);
    const disc = (c.cfs as number[]).map((f, t) => f / Math.pow(1 + c.rate, t));
    const dpb = payback(disc).at;
    if (c.dpayback === null) expect(dpb === null || dpb === "start").toBe(true);
    else near(dpb as number, c.dpayback, 1e-10);
    const pi = profitabilityIndex(c.rate, c.cfs);
    if (c.pi === null) expect(pi).toBeNull();
    else near(pi!, c.pi, 1e-10);
    near(eaa(c.rate, v, c.cfs.length - 1)!, c.eaa, 1e-10);
  });
});

// F1 review round 2: snapping turned repeated roots into false round numbers (triple root 10.00214% → 10.0000%, double
// root 0.00763% → 0.0100%). A repeated root is now reported unsnapped with its accuracy band; numpy.roots splits it
// into a cluster, so the check is: the exact constructed root and numpy's cluster centroid both lie within the band.
describe.each((FX.repeated as R[]).map((c) => [String(c.exact), c] as const))("repeated IRR at %s", (_n, c) => {
  test("reported unsnapped, within its stated ± of the exact root and of numpy.roots' cluster", () => {
    const x = irrAll(c.cfs);
    const near1 = [...x.roots, ...x.touches].filter((r) => Math.abs(r - c.exact) < 1e-3);
    expect(near1.length).toBe(1);
    const rep = (x.repeated ?? []).find((y) => y.rate === near1[0]);
    expect(rep).toBeDefined();
    expect(rep!.plusMinus).toBeLessThan(1e-3);
    expect(Math.abs(near1[0] - c.exact)).toBeLessThanOrEqual(rep!.plusMinus);
    expect(Math.abs(near1[0] - c.numpyCentroid)).toBeLessThanOrEqual(rep!.plusMinus + c.numpySpread);
  });
});

test("Microsoft's MIRR example cash flows (support.microsoft.com MIRR page; values from numpy-financial): 12.61%, −4.80%, 13.48%", () => {
  expect(FX.msMirr).toEqual([0.1261, -0.048, 0.1348]);
  expect(mirr([-120000, 39000, 30000, 21000, 37000, 46000], 0.1, 0.12)!.toFixed(4)).toBe("0.1261");
  expect(mirr([-120000, 39000, 30000, 21000], 0.1, 0.12)!.toFixed(4)).toBe("-0.0480");
  expect(mirr([-120000, 39000, 30000, 21000, 37000, 46000], 0.1, 0.14)!.toFixed(4)).toBe("0.1348");
});

test.each((FX.wacc as R[]).map((c) => [c.in[7], c] as const))("WACC (%s beta)", (_k, c) => {
  const [E, D, rd, tax, rf, mrp, beta, kind, peerDE, peerTax] = c.in;
  const w = wacc({ E, D, rd: rd / 100, tax: tax / 100, rf: rf / 100, mrp: mrp / 100, beta, betaKind: kind, peerDE, peerTax: (peerTax ?? tax) / 100 });
  if ("error" in w) throw new Error(w.error);
  near(w.betaU, c.betaU, 1e-12);
  near(w.betaL, c.betaL, 1e-12);
  near(w.re, c.re, 1e-12);
  near(w.wacc, c.wacc, 1e-12);
});

test.each((FX.dcf as R[]).map((c, i) => [i, c] as const))("DCF case %i", (_i, c) => {
  const [fcf, w, fade, fadeStart, terminal, g, multiple, metric, mid, netDebt, shares] = c.in;
  const d = dcfValue({ fcf, wacc: w / 100, fadeYears: fade, fadeStart: fadeStart / 100, terminal, g: g / 100, multiple, metric, midYear: mid, netDebt, shares });
  if ("error" in d) throw new Error(d.error);
  near(d.pvExplicit, c.pvExplicit, 1e-10);
  if (fade) near(d.pvFade, c.pvFade, 1e-10);
  near(d.tv, c.tv, 1e-10);
  near(d.pvTv, c.pvTv, 1e-10);
  near(d.ev, c.ev, 1e-10);
  near(d.equity, c.equity, 1e-10);
  if (c.perShare !== null) near(d.perShare!, c.perShare, 1e-10);
});
