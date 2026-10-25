/**
 * quantReg.ts (through the qreg calculator's runQreg) against scripts/econ-boot-qreg-oracle.py: the exact LP optimum
 * from scipy.optimize.linprog (HiGHS), the vertex recovered from it, and statsmodels 0.15 QuantReg's covariance
 * formula evaluated at that vertex with numpy.
 *
 * Objective pinned on every case (≤ the HiGHS optimum × (1 + 1e−10)); coefficients, standard errors, t, p, intervals,
 * bandwidth, sparsity and pseudo R¹ only on NON-degenerate data (continuous y, n·τ not whole), where the minimiser is
 * unique.
 */
import * as fs from "fs";
import * as path from "path";
import { runQreg, qregCalc, type QregRun } from "../robustCalcs";
import { fitQuantileLp, checkObjective, interceptOnlyObjective, qrCovariance, qrDesign, QR_MAX_ROWS } from "../quantReg";
import { fmtFixed } from "../regTable";
import { Pcg32 } from "../prng";
import { fitOls } from "../olsInference";
import { budget } from "./timeBudget";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-boot-qreg-oracle.json"), "utf8"));

interface QFit {
  tau: number;
  objectiveLp: number;
  objectiveVertex: number;
  beta: number[];
  se: number[];
  t: number[];
  p: number[];
  ciLo: number[];
  ciHi: number[];
  bandwidth: number;
  sparsity: number;
  r1: number;
}
interface QCase {
  name: string;
  data: string;
  spec: string;
  quantiles: string;
  se: string;
  constant: string;
  degenerate: boolean;
  n: number;
  fits: QFit[];
}

const rel = (got: number, want: number, scale: number, tol: number): void => {
  const err = Math.abs(got - want);
  if (!(err <= tol * scale)) throw new Error(`got ${got}, want ${want} (|err| ${err} > ${tol}·${scale})`);
};

function fit(c: QCase): QregRun {
  const fields: Record<string, string> = { data: c.data, spec: c.spec, quantiles: c.quantiles, se: c.se, constant: c.constant };
  const r = runQreg((k) => fields[k] ?? "");
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("qreg: exact LP and statsmodels' standard errors, pinned to the oracle", () => {
  const cases: QCase[] = FX.qreg;
  it("has non-degenerate, awkward-scale, no-constant and degenerate cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases.some((c) => c.degenerate)).toBe(true);
    expect(cases.some((c) => c.constant === "no")).toBe(true);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = fit(c);
      expect(r.fits.length).toBe(c.fits.length);
      r.fits.forEach((f, j) => {
        const o = c.fits[j];
        expect(f.tau).toBe(o.tau);
        // The LP optimum: never above HiGHS's (HiGHS stops within its tolerance, so ours may be a hair below).
        expect(f.objective).toBeLessThanOrEqual(o.objectiveLp * (1 + 1e-10));
        expect(f.objective).toBeGreaterThanOrEqual(o.objectiveLp * (1 - 1e-8));
        // Our reported objective is the check function of our residuals.
        rel(checkObjective(f.resid, f.tau), f.objective, f.objective, 1e-14);
        if (c.degenerate) {
          expect(r.notes.join(" ")).toMatch(/may not be unique/);
          return;
        }
        rel(f.objective, o.objectiveVertex, o.objectiveVertex, 1e-12);
        const m = f.model;
        m.terms.forEach((t, k) => {
          const scale = Math.max(Math.abs(o.beta[k]), o.se[k]);
          rel(t.coef, o.beta[k], scale, 1e-10);
          rel(t.se, o.se[k], o.se[k], 1e-9);
          rel(t.stat, o.t[k], Math.max(1, Math.abs(o.t[k])), 1e-8);
          rel(t.p, o.p[k], Math.max(1e-6, o.p[k]), 1e-6);
          rel(t.ciLo, o.ciLo[k], scale, 1e-9);
          rel(t.ciHi, o.ciHi[k], scale, 1e-9);
        });
        rel(f.bandwidth, o.bandwidth, o.bandwidth, 1e-12);
        rel(f.sparsity, o.sparsity, o.sparsity, 1e-10);
        rel(f.r1, o.r1, 1, 1e-9);
        expect(m.kind).toBe("quantile");
        expect(m.statLabel).toBe("t");
        expect(m.df).toBe(c.n - m.terms.length);
      });
    });
  }
});

function synth(n: number, p: number, seed: number, integer = false): { y: Float64Array; cols: Float64Array[] } {
  const rng = new Pcg32(seed);
  const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
  const g = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const X = Array.from({ length: p }, () => Float64Array.from({ length: n }, g));
  const y = Float64Array.from({ length: n }, (_, i) => {
    let v = 1 + g() * (1 + Math.abs(X[0][i]));
    for (let k = 0; k < p; k++) v += (k + 1) * 0.3 * X[k][i];
    return integer ? Math.round(v) : v;
  });
  return { y, cols: [...X, new Float64Array(n).fill(1)] };
}

describe("quantile LP: optimality and the freeze guarantee", () => {
  it("is optimal from a poor start (rows in natural order): no coordinate step lowers the objective", () => {
    const { y, cols } = synth(3000, 3, 11);
    const a = fitQuantileLp({ y, cols, tau: 0.2 });
    if (!a.ok) throw new Error(a.reason);
    // Perturbing the solution in any coordinate never lowers the objective (a local check of optimality).
    for (let k = 0; k < cols.length; k++) {
      for (const h of [1e-6, -1e-6]) {
        const b = Float64Array.from(a.beta);
        b[k] += h;
        const r = y.map((v, i) => v - cols.reduce((s, col, kk) => s + col[i] * b[kk], 0));
        expect(checkObjective(r, 0.2)).toBeGreaterThanOrEqual(a.objective - 1e-9 * a.objective);
      }
    }
  });

  it("solves integer (tied) data without cycling and flags possible non-uniqueness only via notes", () => {
    const { y, cols } = synth(2000, 2, 12, true);
    const r = fitQuantileLp({ y, cols, tau: 0.5 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.pivots).toBeLessThan(2000);
  });

  it("the intercept-only objective uses the order statistic y₍⌈nτ⌉₎", () => {
    const y = Float64Array.from([5, 1, 4, 2, 3]);
    // τ = 0.5: ⌈2.5⌉ = 3rd smallest = 3; Σ|y − 3|/2 = (2 + 2 + 1 + 1 + 0)/2 = 3.
    expect(interceptOnlyObjective(y, 0.5)).toBe(3);
  });

  it("refuses a rank-deficient design by name", () => {
    const n = 50;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const r = fitQuantileLp({ y: Float64Array.from(x, (v) => v * 2 + (v % 3)), cols: [x, Float64Array.from(x, (v) => 3 * v), new Float64Array(n).fill(1)], tau: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/full rank|collinear/);
  });

  it("refuses by name when the step budget or the wall clock runs out", () => {
    const { y, cols } = synth(5000, 3, 13);
    const a = fitQuantileLp({ y, cols, tau: 0.05, maxWork: 1 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/did not converge within its step limit/);
    const b = fitQuantileLp({ y, cols, tau: 0.05, deadline: Date.now() - 1 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/time limit/);
  });

  it(`n = ${QR_MAX_ROWS.toLocaleString("en-US")} rows, 3 regressors: one fit finishes well inside the wall clock`, () => {
    // Measured on the build machine: 82–176 ms per quantile at n = 100,000 (OLS start). Bound at ≥ 3× with margin
    // for 4 parallel jest workers.
    // The calculator's start: rows nearest the OLS fit shifted to the τ-quantile of its residuals.
    const { y, cols } = synth(QR_MAX_ROWS, 3, 14);
    const n = y.length;
    const ols = fitOls({ y, depName: "y", X: cols.slice(0, 3), names: ["a", "b", "c"], constant: true, se: "classical" });
    if (!ols.ok) throw new Error(ols.reason);
    const shift = Float64Array.from(ols.resid).sort()[Math.floor(0.9 * (n - 1))];
    const dist = Float64Array.from(ols.resid, (v) => Math.abs(v - shift));
    const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => dist[a] - dist[b] || a - b);
    const t = Date.now();
    const r = fitQuantileLp({ y, cols, tau: 0.9, startOrder: order });
    const ms = Date.now() - t;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(budget(2000));
  });

  it("a poor start (rows in natural order) at 100,000 rows either solves or refuses by the clock, never hangs", () => {
    const { y, cols } = synth(QR_MAX_ROWS, 3, 15);
    const t = Date.now();
    const r = fitQuantileLp({ y, cols, tau: 0.9, wallMs: 1500 });
    expect(Date.now() - t).toBeLessThan(budget(4000));
    if (!r.ok) expect(r.reason).toMatch(/time limit/);
  });

  it("refuses more than the row cap up front", () => {
    const n = QR_MAX_ROWS + 1;
    const r = fitQuantileLp({ y: new Float64Array(n), cols: [new Float64Array(n).fill(1)], tau: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at most 100,000 rows/);
  });
});

/**
 * Adversarial review E4: uncentred polynomial designs. The covariance used to come from Gauss–Jordan on XᵀX (its
 * condition number squared) and printed SE 5,581.530 for the constant where 60-digit mpmath gives 5,581.686. Pinned
 * here against scripts/econ-e4fix-oracle.py: statsmodels' formula in mpmath at the SAME residual vector.
 */
describe("qreg covariance by QR on uncentred polynomial designs (mpmath oracle)", () => {
  interface QrFx { name: string; data: string; spec: string; tau: number; se: "robust" | "iid"; n: number; nTauWhole: boolean; beta: number[]; resid: number[]; seMp: number[]; bandwidth: number; sparsity: number }
  const FX2: { qreg: QrFx[] } = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-e4fix-oracle.json"), "utf8"));
  const columns = (data: string): Float64Array[] => {
    const lines = data.split("\n").slice(1).map((l) => l.split("\t").map(Number));
    return lines[0].map((_, j) => Float64Array.from(lines, (r) => r[j]));
  };
  for (const c of FX2.qreg) {
    it(`qrCovariance: ${c.name}`, () => {
      const [y, ...X] = columns(c.data);
      const cols = [...X, new Float64Array(y.length).fill(1)];
      const cov = qrCovariance(y, cols, Float64Array.from(c.resid), c.tau, c.se);
      if (!cov.ok) throw new Error(cov.reason);
      c.seMp.forEach((s, k) => rel(Math.sqrt(cov.cov[k][k]), s, s, 1e-9));
      rel(cov.bandwidth, c.bandwidth, c.bandwidth, 1e-12);
      rel(cov.sparsity, c.sparsity, c.sparsity, 1e-10);
    });
    if (!c.nTauWhole) {
      it(`end to end (unique vertex): ${c.name}`, () => {
        const fields: Record<string, string> = { data: c.data, spec: c.spec, quantiles: String(c.tau), se: c.se, constant: "yes" };
        const r = runQreg((k) => fields[k] ?? "");
        if (!r.ok) throw new Error(r.reason);
        const terms = r.fits[0].model.terms;
        terms.forEach((t, k) => {
          rel(t.coef, c.beta[k], Math.max(Math.abs(c.beta[k]), c.seMp[k]), 1e-9);
          rel(t.se, c.seMp[k], c.seMp[k], 1e-9);
        });
        // The printed SE digits are the oracle's.
        const out = qregCalc((k) => fields[k] ?? "");
        const rows = out.tables![0].rows.slice(1);
        rows.forEach((row, k) => expect(row[2]).toBe(fmtFixed(c.seMp[k], 3)));
        expect(out.text).toContain(`n − p = ${c.n - 3} degrees`);
      });
    }
  }

  it("a constant column that is not 1 (constant = no, a column of 2s) maps back exactly", () => {
    const c = FX2.qreg.find((q) => q.name.startsWith("year + year², tau 0.373"))!;
    const lines = c.data.split("\n");
    const data = [lines[0] + "\ttwo", ...lines.slice(1).map((l) => `${l}\t2`)].join("\n");
    const a = runQreg((k) => ({ data, spec: "y ~ year + year2 + two", quantiles: "0.373", se: "robust", constant: "no" })[k] ?? "");
    const b = runQreg((k) => ({ data, spec: "y ~ year + year2", quantiles: "0.373", se: "robust", constant: "yes" })[k] ?? "");
    if (!a.ok || !b.ok) throw new Error("refused");
    const ta = a.fits[0].model.terms;
    const tb = b.fits[0].model.terms;
    rel(ta[0].se, tb[0].se, tb[0].se, 1e-9);
    rel(ta[1].se, tb[1].se, tb[1].se, 1e-9);
    rel(2 * ta[2].se, tb[2].se, tb[2].se, 1e-9);
    rel(tb[2].se, c.seMp[2], c.seMp[2], 1e-9);
  });

  it("100,000 rows × 30 predictors: the design is factored once; six covariances cost little beyond it", () => {
    const { y, cols } = synth(QR_MAX_ROWS, 30, 30);
    const resid = Float64Array.from(y, (v, i) => v - 1 - 0.01 * i / QR_MAX_ROWS);
    let t = Date.now();
    const des = qrDesign(cols);
    const msDesign = Date.now() - t;
    if (!des.ok) throw new Error(des.reason);
    t = Date.now();
    for (const tau of [0.05, 0.1, 0.25, 0.5, 0.75, 0.95]) expect(qrCovariance(y, cols, resid, tau, "robust", des).ok).toBe(true);
    const msCov = Date.now() - t;
    // Measured 0.7–0.8 s for the design and 1.1 s for six covariances (1.9 s together); bounded at about 3×. runQreg
    // also checks its 6 s clock after the design and after every covariance, refusing by name past it.
    expect(msDesign + msCov).toBeLessThan(budget(6000));
  });
});
