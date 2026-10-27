/**
 * Release F2 #11 engines (src/lib/limdep.ts) against scripts/limdep-oracle.py (statsmodels 0.15 Poisson,
 * NegativeBinomial nb2, OrderedModel, MNLogit; an independent scipy tobit MLE; a numpy Heckman two-step following
 * Wooldridge 2010 §19.6). Tolerances (relative, with an absolute floor for values near zero):
 *   coefficients and log likelihoods 1e-6 (both sides converge to ~1e-9 of an SE);
 *   SEs of statsmodels' analytic-Hessian models (Poisson, NB2, MNLogit, Probit) 1e-6;
 *   SEs that the oracle takes from a NUMERICAL Hessian (tobit approx_hess3, OrderedModel) 2e-5;
 *   marginal-effect SEs 2e-5 (numerical Jacobians on one side or both).
 */
import * as fs from "fs";
import * as path from "path";
import { parseRegData, parseSpec, selectColumns } from "../regData";
import { fitCount, fitTobit, fitHeckman, fitOrdered, fitMnl, LimdepRefusal, lgamma, digamma, trigamma, normLogCdf, millsRatio, MILLS_NAME } from "../limdep";
import type { ModelTerm } from "../regModel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "limdep-oracle.json"), "utf8"));

function cols(text: string, spec: string): { y: number[]; X: number[][]; names: string[]; dep: string } {
  const d = parseRegData(text);
  if (!d.ok) throw new Error(d.reason);
  const s = parseSpec(spec);
  if ("error" in s) throw new Error(s.error);
  const c = selectColumns(d.data, s);
  if (!c.ok) throw new Error(c.reason);
  const y = Array.from(c.cols.y);
  return { y, X: y.map((_, i) => c.cols.X.map((col) => col[i])), names: c.cols.names, dep: c.cols.depName };
}
function column(text: string, name: string): number[] {
  const d = parseRegData(text);
  if (!d.ok) throw new Error(d.reason);
  const j = d.data.names.indexOf(name);
  return d.data.rows.map((r) => Number(r[j]));
}
function close(a: number, b: number, rel: number, abs = 1e-10): void {
  if (!(Math.abs(a - b) <= rel * Math.abs(b) + abs)) throw new Error(`${a} vs ${b} (rel ${Math.abs(a - b) / Math.abs(b)})`);
}
function closeAll(got: number[], want: number[], rel: number, abs = 1e-10): void {
  expect(got.length).toBe(want.length);
  got.forEach((g, i) => close(g, want[i], rel, abs));
}
const coefs = (ts: ModelTerm[]): number[] => ts.map((t) => t.coef);
const ses = (ts: ModelTerm[]): number[] => ts.map((t) => t.se);

describe("special functions", () => {
  test("lgamma, digamma, trigamma against known values", () => {
    close(lgamma(1), 0, 0, 1e-13);
    close(lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-15);
    close(lgamma(101), 363.73937555556347, 1e-15);
    close(lgamma(1e-8), 18.420680738180209, 1e-14);
    close(digamma(1), -0.5772156649015329, 1e-14);
    close(digamma(0.5), -1.9635100260214235, 1e-14);
    close(trigamma(1), (Math.PI * Math.PI) / 6, 1e-14);
    close(trigamma(0.5), (Math.PI * Math.PI) / 2, 1e-14);
  });
  test("log Φ and the Mills ratio deep in the tails", () => {
    close(normLogCdf(-40), -804.6084420137538, 1e-13);
    close(normLogCdf(10), -7.619853024160527e-24, 1e-10, 0);
    close(millsRatio(-40), 40.02497, 1e-6);
  });
});

describe("Poisson and NB2 (statsmodels)", () => {
  const C = FX.count;
  const { y, X, names } = cols(C.data, "visits ~ age + income + female");
  const off = column(C.data, "years").map(Math.log);
  test("Poisson coefficients, classical and HC0 SEs, log likelihood, llnull", () => {
    const r = fitCount(y, X, names, { model: "poisson", offset: off, depName: "visits" });
    closeAll(coefs(r.model.terms), C.poisson.params, 1e-6);
    closeAll(ses(r.model.terms), C.poisson.bse, 1e-6);
    close(r.ll, C.poisson.llf, 1e-9);
    close(r.llNull, C.poisson.llnull, 1e-9);
    close(r.pearson, C.poisson.pearson, 1e-6);
    close(r.deviance, C.poisson.deviance, 1e-6);
    close(r.ct!.alpha, C.poisson.ct.alpha, 1e-6);
    close(r.ct!.se, C.poisson.ct.se, 1e-6);
    close(r.ct!.t, C.poisson.ct.t, 1e-6);
    close(r.ct!.p, C.poisson.ct.p, 1e-5);
    const h = fitCount(y, X, names, { model: "poisson", offset: off, se: "hc0" });
    closeAll(ses(h.model.terms), C.poisson.bseHC0, 1e-6);
    // IRR = exp(b), SE exp(b)·se, interval from the exponentiated bounds.
    r.irr.forEach((t, j) => {
      close(t.coef, Math.exp(C.poisson.params[j]), 1e-6);
      close(t.se, Math.exp(C.poisson.params[j]) * C.poisson.bse[j], 1e-6);
      close(t.ciLo, Math.exp(r.model.terms[j].ciLo), 1e-12);
    });
  });
  test("NB2 coefficients, α, classical and HC0 SEs, llnull, LR test of α = 0", () => {
    const r = fitCount(y, X, names, { model: "nb2", offset: off, depName: "visits" });
    const want = C.nb2.params;
    closeAll(coefs(r.model.terms), want.slice(0, -1), 1e-6);
    close(r.alpha!.est, want[want.length - 1], 1e-6);
    closeAll(ses(r.model.terms), C.nb2.bse.slice(0, -1), 1e-6);
    close(r.alpha!.se, C.nb2.bse[C.nb2.bse.length - 1], 1e-6);
    close(r.ll, C.nb2.llf, 1e-9);
    close(r.llNull, C.nb2.llnull, 1e-8);
    close(r.lrAlpha!.stat, C.nb2.lrAlpha, 1e-6);
    close(r.lrAlpha!.p, C.nb2.pAlpha, 1e-5, 1e-15);
    const h = fitCount(y, X, names, { model: "nb2", offset: off, se: "hc0" });
    closeAll(ses(h.model.terms), C.nb2.bseHC0.slice(0, -1), 1e-6);
    close(h.alpha!.se, C.nb2.bseHC0[C.nb2.bseHC0.length - 1], 1e-6);
  });
});

describe("tobit (independent scipy MLE)", () => {
  const T = FX.tobit;
  const { y, X, names } = cols(T.data, "hours ~ educ + age + kids");
  test("coefficients, σ, SEs, log likelihood, constant-only log likelihood, marginal effects", () => {
    const r = fitTobit(y, X, names, { lower: 0, upper: null, depName: "hours" });
    closeAll(coefs(r.model.terms), T.beta, 1e-6);
    close(r.sigma.est, T.sigma, 1e-6);
    closeAll(ses(r.model.terms), T.bse, 2e-5);
    close(r.sigma.se, T.seSigma, 2e-5);
    close(r.ll, T.llf, 1e-9);
    close(r.llNull, T.llnull, 1e-9);
    expect(r.nLeft).toBe(T.nLeft);
    r.ame.forEach((a, j) => {
      closeAll([a.unconditional.coef, a.conditional.coef, a.probability.coef], T.ame[j].est, 1e-6);
      closeAll([a.unconditional.se, a.conditional.se, a.probability.se], T.ame[j].se, 2e-5);
    });
  });
});

describe("Heckman two-step (numpy, Wooldridge 2010 §19.6)", () => {
  const H = FX.heckman;
  test("probit γ, outcome β with λ, corrected SEs, ρ, σ, Wald", () => {
    const sel = cols(H.data, "works ~ educ + exper + kids + married");
    const d = parseRegData(H.data);
    if (!d.ok) throw new Error(d.reason);
    const iw = d.data.names.indexOf("works");
    const selected = { ...d.data, rows: d.data.rows.filter((r) => r[iw] === "1") };
    const oc = selectColumns(selected, parseSpec("lwage ~ educ + exper") as never);
    if (!oc.ok) throw new Error(oc.reason);
    const yo = Array.from(oc.cols.y);
    const r = fitHeckman({
      s: sel.y,
      Z: sel.X,
      zNames: sel.names,
      selName: "works",
      y: yo,
      X: yo.map((_, i) => oc.cols.X.map((c) => c[i])),
      xNames: oc.cols.names,
      depName: "lwage",
    });
    closeAll(coefs(r.selection), H.gamma, 1e-6);
    closeAll(ses(r.selection), H.gammaSe, 1e-6);
    closeAll(coefs(r.model.terms), H.beta, 1e-6);
    closeAll(ses(r.model.terms), H.bse, 1e-6);
    expect(r.model.terms[2].name).toBe(MILLS_NAME);
    close(r.rho, H.rho, 1e-6);
    close(r.sigma, H.sigma, 1e-6);
    close(r.wald!.stat, H.wald, 1e-6);
    expect(r.truncated).toBe(H.truncated);
    expect(r.nSelected).toBe(H.nSel);
    close(r.probitLl, H.probitLl, 1e-9);
  });
});

describe("ordered logit / probit (statsmodels OrderedModel)", () => {
  const O = FX.ordered;
  const { y, X, names } = cols(O.data, "rating ~ price + quality + online");
  test.each(["logit", "probit"] as const)("%s: β, cut points, SEs, log likelihood, mean probabilities", (link) => {
    const r = fitOrdered(y, X, names, link, { depName: "rating" });
    const W = O[link];
    closeAll(coefs(r.model.terms), W.beta, 1e-6);
    closeAll(coefs(r.cuts), W.cuts, 1e-6);
    closeAll(ses(r.model.terms), W.bse, 2e-5);
    closeAll(ses(r.cuts), W.cutSe, 2e-5);
    close(r.ll, W.llf, 1e-9);
    close(r.llNull, W.llnull, 1e-12);
    closeAll(r.meanProb, W.meanProb, 1e-6);
  });
});

describe("multinomial logit (statsmodels MNLogit)", () => {
  const M = FX.mnl;
  const { y, X, names } = cols(M.data, "mode ~ income + age");
  test.each([
    ["base1", 1],
    ["base2", 2],
  ] as const)("%s: coefficients, SEs, log likelihood, average marginal effects", (key, base) => {
    const r = fitMnl(y, X, names, { base, depName: "mode" });
    const W = M[key];
    expect(r.equations.map((e) => e.category)).toEqual(W.order.slice(1));
    r.equations.forEach((e, j) => {
      closeAll(coefs(e.terms), W.params[j], 1e-6);
      closeAll(ses(e.terms), W.bse[j], 1e-6);
    });
    close(r.ll, W.llf, 1e-9); // ours is the higher of the two (statsmodels stops at its own tolerance)
    close(r.llNull, W.llnull, 1e-9); // ours is the closed form Σ nⱼ ln(nⱼ/n); statsmodels fits the null model iteratively
    // statsmodels' margeff columns follow the recoded order (base first); ours are sorted by category value.
    W.order.forEach((cat: number, jcol: number) => {
      const a = r.ame.find((x) => x.category === cat)!;
      closeAll(coefs(a.terms), W.ame[jcol], 1e-6);
      closeAll(ses(a.terms), W.ameSe[jcol], 2e-5);
    });
  });
});

describe("refusals by name", () => {
  const C = FX.count;
  const { y, X, names } = cols(C.data, "visits ~ age + income + female");
  test("non-convergence is refused, never printed", () => {
    expect(() => fitCount(y, X, names, { model: "nb2", maxIter: 1 })).toThrow(/did not converge in 1 iteration/);
    expect(() => fitCount(y, X, names, { model: "poisson", maxIter: 1 })).toThrow(LimdepRefusal);
  });
  test("non-count outcomes and all-zero counts", () => {
    expect(() => fitCount([0, 1.5, 2, 3], [[1], [2], [3], [4]], ["x"], { model: "poisson" })).toThrow(/count .*row 2 has 1\.5/);
    expect(() => fitCount([0, -1, 2, 3], [[1], [2], [3], [4]], ["x"], { model: "poisson" })).toThrow(/row 2 has −1/);
    expect(() => fitCount([0, 0, 0, 0], [[1], [2], [3], [4]], ["x"], { model: "poisson" })).toThrow(/Every “y” is 0/);
  });
  test("Poisson zeros set apart by a predictor (estimate does not exist)", () => {
    const yy = [0, 0, 0, 0, 2, 3, 1, 4, 2, 5];
    const xx = [[0], [0], [0], [0], [1], [1], [1], [1], [1], [1]].map((r, i) => [r[0], i % 3]);
    expect(() => fitCount(yy, xx, ["d", "z"], { model: "poisson" })).toThrow(/does not exist|did not converge/);
  });
  test("collinear predictors are named", () => {
    const XX = X.map((r) => [r[0], r[1], 2 * r[0] + r[1]]);
    expect(() => fitCount(y, XX, ["a", "b", "c"], { model: "poisson" })).toThrow(/“c” is an exact linear combination of “a”, “b”/);
  });
});

// ---------------------------------------------------------------------------------------------------- adversarial
// Held out of development: second seeds and edge cases (scripts/limdep-oracle.py "adv"), first run after the build.
describe("held-out adversarial cases", () => {
  const A = FX.adv;
  test("Poisson-generated counts: Poisson matches; NB2 refused at the α = 0 boundary", () => {
    const { y, X, names } = cols(A.countPoisson.data, "visits ~ age + income + female");
    const off = column(A.countPoisson.data, "years").map(Math.log);
    const r = fitCount(y, X, names, { model: "poisson", offset: off });
    closeAll(coefs(r.model.terms), A.countPoisson.poisson.params, 1e-6);
    closeAll(ses(r.model.terms), A.countPoisson.poisson.bse, 1e-6);
    expect(() => fitCount(y, X, names, { model: "nb2", offset: off })).toThrow(/boundary α = 0/);
  });
  test("no constant and no exposure (Poisson and NB2), llnull as statsmodels", () => {
    for (const [key, spec, constant] of [
      ["countNoConst", "visits ~ age + female", false],
      ["countNoExposure", "visits ~ age + income + female", true],
    ] as const) {
      const W = A[key];
      const { y, X, names } = cols(W.data, spec);
      const p = fitCount(y, X, names, { model: "poisson", constant });
      closeAll(coefs(p.model.terms), W.poisson.params, 1e-6);
      closeAll(ses(p.model.terms), W.poisson.bse, 1e-6);
      close(p.ll, W.poisson.llf, 1e-9);
      close(p.llNull, W.poisson.llnull, 1e-9);
      const nb = fitCount(y, X, names, { model: "nb2", constant });
      closeAll(coefs(nb.model.terms), W.nb2.params.slice(0, -1), 1e-6);
      close(nb.alpha!.est, W.nb2.params[W.nb2.params.length - 1], 1e-6);
      closeAll(ses(nb.model.terms), W.nb2.bse.slice(0, -1), 1e-6);
      close(nb.ll, W.nb2.llf, 1e-9);
      close(nb.llNull, W.nb2.llnull, 1e-8);
    }
  });
  test("tobit censored only above, and at both limits", () => {
    for (const [key, spec, lower, upper] of [
      ["tobitUpper", "hours ~ educ + age + kids", null, 15],
      ["tobitTwoLimit", "hours ~ educ + kids", 0, 12],
    ] as const) {
      const W = A[key];
      const { y, X, names } = cols(W.data, spec);
      const r = fitTobit(y, X, names, { lower, upper });
      closeAll(coefs(r.model.terms), W.beta, 1e-6);
      close(r.sigma.est, W.sigma, 1e-6);
      closeAll(ses(r.model.terms), W.bse, 2e-5);
      close(r.ll, W.llf, 1e-9);
      close(r.llNull, W.llnull, 1e-9);
      expect(r.nLeft).toBe(W.nLeft);
      expect(r.nRight).toBe(W.nRight);
      r.ame.forEach((a, j) => {
        closeAll([a.unconditional.coef, a.conditional.coef, a.probability.coef], W.ame[j].est, 1e-6);
        closeAll([a.unconditional.se, a.conditional.se, a.probability.se], W.ame[j].se, 2e-5);
      });
    }
  });
  test("Heckman, second seed", () => {
    const W = A.heckman2;
    const sel = cols(W.data, "works ~ educ + exper + kids + married");
    const d = parseRegData(W.data);
    if (!d.ok) throw new Error(d.reason);
    const iw = d.data.names.indexOf("works");
    const oc = selectColumns({ ...d.data, rows: d.data.rows.filter((r) => r[iw] === "1") }, parseSpec("lwage ~ educ + exper") as never);
    if (!oc.ok) throw new Error(oc.reason);
    const yo = Array.from(oc.cols.y);
    const r = fitHeckman({ s: sel.y, Z: sel.X, zNames: sel.names, selName: "works", y: yo, X: yo.map((_, i) => oc.cols.X.map((c) => c[i])), xNames: oc.cols.names, depName: "lwage" });
    closeAll(coefs(r.model.terms), W.beta, 1e-6);
    closeAll(ses(r.model.terms), W.bse, 1e-6);
    close(r.rho, W.rho, 1e-6);
    close(r.wald!.stat, W.wald, 1e-6);
  });
  test("ordered probit with three categories", () => {
    const W = A.ordered3;
    const { y, X, names } = cols(W.data, "rating ~ price + online");
    const r = fitOrdered(y, X, names, "probit");
    closeAll(coefs(r.model.terms), W.probit.beta, 1e-6);
    closeAll(coefs(r.cuts), W.probit.cuts, 1e-6);
    closeAll(ses(r.cuts), W.probit.cutSe, 2e-5);
    close(r.ll, W.probit.llf, 1e-9);
  });
  test("J = 2 ordered model equals binary probit / logit (β same, cut = −constant)", () => {
    const W = A.ordered2;
    const { y, X, names } = cols(W.data, "rating ~ price + quality");
    for (const link of ["probit", "logit"] as const) {
      const r = fitOrdered(y, X, names, link);
      const B = W.binary[link];
      closeAll(coefs(r.model.terms), B.params.slice(0, 2), 1e-6);
      closeAll(ses(r.model.terms), B.bse.slice(0, 2), 1e-6);
      close(r.cuts[0].coef, -B.params[2], 1e-6);
      close(r.cuts[0].se, B.bse[2], 1e-6);
      close(r.ll, B.llf, 1e-9);
      closeAll(coefs(r.model.terms), W[link].beta, 1e-6);
    }
  });
  test("multinomial logit with the highest category as the base", () => {
    const W = A.mnlBase3.fit;
    const { y, X, names } = cols(A.mnlBase3.data, "mode ~ income + age");
    const r = fitMnl(y, X, names, { base: 3 });
    r.equations.forEach((e, j) => {
      expect(e.category).toBe(W.order[j + 1]);
      closeAll(coefs(e.terms), W.params[j], 1e-6);
      closeAll(ses(e.terms), W.bse[j], 1e-6);
    });
    W.order.forEach((cat: number, jcol: number) => {
      const a = r.ame.find((x) => x.category === cat)!;
      closeAll(coefs(a.terms), W.ame[jcol], 1e-6);
      closeAll(ses(a.terms), W.ameSe[jcol], 2e-5);
    });
    // AMEs sum to zero across categories.
    for (let j = 0; j < names.length; j++) close(r.ame.reduce((s, a) => s + a.terms[j].coef, 0), 0, 0, 1e-12);
  });
  test("separation in ordered and multinomial models is refused by name", () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    const yo = x.map((v) => (v < 10 ? 1 : v < 20 ? 2 : 3));
    const z = x.map((v) => (v * 7) % 5);
    expect(() => fitOrdered(yo, x.map((v, i) => [v, z[i]]), ["x", "z"], "logit")).toThrow(/does not exist|did not converge/);
    expect(() => fitMnl(yo, x.map((v, i) => [v, z[i]]), ["x", "z"])).toThrow(/does not exist|did not converge/);
  });
  test("a predictor of 10¹² + small variation stays identified (scaling)", () => {
    const { y, X, names } = cols(FX.count.data, "visits ~ age + income + female");
    const off = column(FX.count.data, "years").map(Math.log);
    const shifted = X.map((r) => [r[0] + 1e12, r[1], r[2]]);
    const a = fitCount(y, X, names, { model: "poisson", offset: off });
    const b = fitCount(y, shifted, names, { model: "poisson", offset: off });
    close(b.model.terms[0].coef, a.model.terms[0].coef, 1e-6);
    close(b.model.terms[0].se, a.model.terms[0].se, 1e-6);
    close(b.ll, a.ll, 1e-9);
  });
  test("Heckman: a selection indicator that a variable predicts perfectly is refused, naming the equation", () => {
    const s = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    const z = s.map((v, i) => [v === 1 ? 10 + i : i, (i * 3) % 4]);
    const sel = s.filter((v) => v === 1);
    expect(() =>
      fitHeckman({ s, Z: z, zNames: ["z1", "z2"], selName: "s", y: sel.map((_, i) => i * 0.3 + (i % 2)), X: sel.map((_, i) => [i % 3]), xNames: ["x"], depName: "y" }),
    ).toThrow(/^Selection equation \(probit of “s”\): Perfect separation/);
  });
});

describe("held-out: counts in the hundreds (NB2's lgamma/digamma/trigamma path for y > 64)", () => {
  test("Poisson and NB2 match statsmodels", () => {
    const W = FX.adv.countLarge;
    const { y, X, names } = cols(W.data, "visits ~ age + income + female");
    const off = column(W.data, "years").map(Math.log);
    expect(Math.max(...y)).toBeGreaterThan(64);
    const nb = fitCount(y, X, names, { model: "nb2", offset: off });
    closeAll(coefs(nb.model.terms), W.nb2.params.slice(0, -1), 1e-6);
    close(nb.alpha!.est, W.nb2.params[W.nb2.params.length - 1], 1e-6);
    closeAll(ses(nb.model.terms), W.nb2.bse.slice(0, -1), 1e-6);
    close(nb.alpha!.se, W.nb2.bse[W.nb2.bse.length - 1], 1e-6);
    close(nb.ll, W.nb2.llf, 1e-9);
    const h = fitCount(y, X, names, { model: "nb2", offset: off, se: "hc0" });
    closeAll(ses(h.model.terms), W.nb2.bseHC0.slice(0, -1), 1e-6);
  });
});

describe("adversarial (review): tobit separation and the Heckman ρ truncation", () => {
  const T = FX.tobit;
  const { y, X, names } = cols(T.data, "hours ~ educ + age + kids");
  test("a dummy that is 1 only on censored rows has no finite coefficient: refused (lower and upper limits)", () => {
    let flag = 0;
    const Xd = X.map((r, i) => [...r, y[i] <= 0 && flag++ % 2 === 0 ? 1 : 0]);
    expect(() => fitTobit(y, Xd, [...names, "d"], { lower: 0, upper: null })).toThrow(/does not exist|did not converge/);
    const U = FX.adv.tobitUpper;
    const up = cols(U.data, "hours ~ educ + age + kids");
    let f2 = 0;
    const Xu = up.X.map((r, i) => [...r, up.y[i] >= 15 && f2++ % 2 === 0 ? 1 : 0]);
    expect(() => fitTobit(up.y, Xu, [...up.names, "d"], { lower: null, upper: 15 })).toThrow(/does not exist|did not converge/);
    // the same dummy spread over censored and uncensored rows is fine
    const Xok = X.map((r, i) => [...r, i % 2]);
    expect(() => fitTobit(y, Xok, [...names, "d"], { lower: 0, upper: null })).not.toThrow();
  });
  test("|ρ| > 1 truncated to ±1 with σ = |b_λ| (no exclusion restriction), against the oracle's same rule", () => {
    const W = FX.adv.heckmanTrunc;
    const sel = cols(W.data, "works ~ educ + exper");
    const d = parseRegData(W.data);
    if (!d.ok) throw new Error(d.reason);
    const iw = d.data.names.indexOf("works");
    const oc = selectColumns({ ...d.data, rows: d.data.rows.filter((r) => r[iw] === "1") }, parseSpec("lwage ~ educ + exper") as never);
    if (!oc.ok) throw new Error(oc.reason);
    const yo = Array.from(oc.cols.y);
    const r = fitHeckman({ s: sel.y, Z: sel.X, zNames: sel.names, selName: "works", y: yo, X: yo.map((_, i) => oc.cols.X.map((c) => c[i])), xNames: oc.cols.names, depName: "lwage" });
    expect(W.truncated).toBe(true);
    expect(r.truncated).toBe(true);
    closeAll(coefs(r.model.terms), W.beta, 1e-6);
    closeAll(ses(r.model.terms), W.bse, 1e-6);
    close(r.rho, W.rho, 0, 0);
    close(r.sigma, W.sigma, 1e-6);
    close(r.wald!.stat, W.wald, 1e-6);
    expect(r.excluded).toEqual([]);
  });
});

describe("count frequencies (the figure's data) against scipy.stats pmfs", () => {
  test("Poisson and NB2 mean fitted probability of each count; null above the cap", () => {
    const C = FX.count;
    const { y, X, names } = cols(C.data, "visits ~ age + income + female");
    const off = column(C.data, "years").map(Math.log);
    for (const [model, want] of [
      ["poisson", C.poisson.freqPred],
      ["nb2", C.nb2.freqPred],
    ] as const) {
      const r = fitCount(y, X, names, { model, offset: off });
      closeAll(r.freq!.map((f) => f.predicted), want, 1e-6, 1e-12);
      expect(r.freq!.reduce((s, f) => s + f.observed, 0)).toBeCloseTo(1, 12);
    }
    const big = cols(FX.adv.countLarge.data, "visits ~ age + income + female");
    expect(fitCount(big.y, big.X, big.names, { model: "poisson" }).freq).toBeNull();
  });
});
