/**
 * Release E3b: ARIMA and Holt–Winters pinned to statsmodels 0.15 (fixture from scripts/econ-ts-forecast-oracle.py).
 *
 * Optimisers differ, so fitted parameters are pinned loosely and the FUNCTIONS tightly:
 *  ARIMA  (a) llf at statsmodels' parameters to 1e−9 relative; (b) our maximised llf ≥ statsmodels' − 1e−6;
 *         (c) parameters within 1e−3; (d) forecasts and 95% intervals at statsmodels' parameters to 1e−8.
 *  ETS    SSE at statsmodels' parameters and initial states to 1e−9; our SSE ≤ statsmodels' × (1 + 1e−6); fitted
 *         values and forecasts at statsmodels' parameters to 1e−8 (forecasts against ETSModel at every horizon and
 *         ExponentialSmoothing where h is not a multiple of m — see the oracle script on statsmodels' h = m slip).
 */
import * as fs from "fs";
import * as path from "path";
import { arimaForecast, arimaLoglike, fitArima, kalmanArma, type ArimaSpec, type ArimaTrend } from "../arima";
import { fitHoltWinters, hwFilter, hwForecast, hwForecastVariance, hwIntervals, type HwSpec } from "../holtWinters";
import { ljungBox } from "../tsForecastCalcs";

interface ArimaCase {
  name: string;
  y: number[];
  p: number;
  d: number;
  q: number;
  trend: ArimaTrend;
  mu: number;
  phi: number[];
  theta: number[];
  sigma2: number;
  se: number[];
  llf: number;
  aic: number;
  aicc: number;
  bic: number;
  nobs: number;
  params2: { mu: number; phi: number[]; theta: number[]; sigma2: number };
  llf2: number;
  llfExactFilter: number;
  llf2ExactFilter: number;
  ljungBox: { lags: number; q: number; p: number };
  forecast: number[];
  forecastSe: number[];
  lower: number[];
  upper: number[];
}

interface EtsCase {
  name: string;
  y: number[];
  trend: "none" | "add";
  damped: boolean;
  seasonal: "none" | "add" | "mul";
  m: number;
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
  l0: number;
  b0: number;
  s0: number[];
  sse: number;
  fitted: number[];
  forecastHw: number[];
  forecastEts: number[];
  aic: number;
  aicc: number;
  bic: number;
  forecastVar?: number[];
  lower?: number[];
  upper?: number[];
}

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-ts-forecast-oracle.json"), "utf8")) as {
  arima: ArimaCase[];
  ets: EtsCase[];
};

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const specOf = (c: ArimaCase): ArimaSpec => ({ p: c.p, d: c.d, q: c.q, trend: c.trend });

describe("ARIMA vs statsmodels (simple differencing, mean form)", () => {
  expect(fx.arima.length).toBeGreaterThanOrEqual(3);
  for (const c of fx.arima) {
    describe(c.name, () => {
      const prm = { mu: c.mu, phi: c.phi, theta: c.theta, sigma2: c.sigma2 };
      it("(a) llf at statsmodels' parameters to 1e−9 relative, and at a second parameter vector", () => {
        // Against statsmodels' exact filter (ssm.tolerance = 0); its default steady-state freeze is within 1e−7.
        const l1 = arimaLoglike(c.y, specOf(c), prm) as number;
        const l2 = arimaLoglike(c.y, specOf(c), c.params2) as number;
        expect(rel(l1, c.llfExactFilter)).toBeLessThan(1e-9);
        expect(rel(l2, c.llf2ExactFilter)).toBeLessThan(1e-9);
        expect(Math.abs(l1 - c.llf)).toBeLessThan(1e-7);
        expect(Math.abs(l2 - c.llf2)).toBeLessThan(1e-7);
      });
      const fit = fitArima(c.y, specOf(c));
      it("(b) our maximum is never worse, (c) parameters within 1e−3, information criteria", () => {
        if (!fit.ok) throw new Error(fit.reason);
        expect(fit.llf).toBeGreaterThanOrEqual(c.llf - 1e-6);
        expect(fit.nobs).toBe(c.nobs);
        const mine = [...(c.trend !== "none" ? [fit.params.mu] : []), ...fit.params.phi, ...fit.params.theta, fit.params.sigma2];
        const theirs = [...(c.trend !== "none" ? [c.mu] : []), ...c.phi, ...c.theta, c.sigma2];
        mine.forEach((v, i) => expect(Math.abs(v - theirs[i])).toBeLessThan(1e-3 * Math.max(1, Math.abs(theirs[i]))));
        // AIC/AICc/BIC by statsmodels' definitions (k counts σ², N = n − d); compared at statsmodels' own llf.
        const shift = -2 * (fit.llf - c.llf);
        expect(fit.aic - shift).toBeCloseTo(c.aic, 6);
        expect((fit.aicc as number) - shift).toBeCloseTo(c.aicc, 6);
        expect(fit.bic - shift).toBeCloseTo(c.bic, 6);
      });
      it("SEs from the numerical Hessian agree with statsmodels cov_type='approx' (loosely)", () => {
        if (!fit.ok) throw new Error(fit.reason);
        expect(fit.se).not.toBeNull();
        (fit.se as number[]).forEach((v, i) => expect(rel(v, c.se[i])).toBeLessThan(2e-2));
      });
      it("(d) forecasts and 95% intervals at statsmodels' parameters to 1e−8", () => {
        const f = arimaForecast(c.y, specOf(c), prm, c.forecast.length);
        if (!f) throw new Error("no forecast");
        const tol = (a: number, b: number, s: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-8 * Math.max(Math.abs(b), s));
        const lev = Math.max(...c.y.map(Math.abs));
        f.mean.forEach((v, i) => tol(v, c.forecast[i], lev));
        f.se.forEach((v, i) => tol(v, c.forecastSe[i], c.forecastSe[0]));
        f.lower.forEach((v, i) => tol(v, c.lower[i], lev));
        f.upper.forEach((v, i) => tol(v, c.upper[i], lev));
      });
      it("Ljung–Box at statsmodels' parameters matches acorr_ljungbox exactly (through tsDiag.ljungBox)", () => {
        const w = c.d ? c.y.slice(1).map((v, i) => v - c.y[i]) : c.y.slice();
        const w2 = c.d === 2 ? w.slice(1).map((v, i) => v - w[i]) : w;
        const mu = c.trend === "none" ? 0 : c.mu;
        const f = kalmanArma(
          w2.map((v) => v - mu),
          c.phi,
          c.theta,
          true,
        );
        if (!f) throw new Error("filter failed");
        const lb = ljungBox(f.std as Float64Array, c.ljungBox.lags, c.p + c.q);
        if ("reason" in lb) throw new Error(lb.reason);
        expect(rel(lb.q, c.ljungBox.q)).toBeLessThan(1e-9);
        expect(Math.abs((lb.p as number) - c.ljungBox.p)).toBeLessThan(1e-9);
      });
      it("Ljung–Box on the standardized residuals (model df = p + q) matches acorr_ljungbox", () => {
        if (!fit.ok) throw new Error(fit.reason);
        // At our optimum the residuals differ from statsmodels' by the optimiser gap only.
        const lb = ljungBox(fit.stdResid, c.ljungBox.lags, c.p + c.q);
        if ("reason" in lb) throw new Error(lb.reason);
        expect(lb.q).toBeCloseTo(c.ljungBox.q, 2);
      });
    });
  }
});

describe("Holt–Winters vs statsmodels", () => {
  expect(fx.ets.length).toBeGreaterThanOrEqual(3);
  for (const c of fx.ets) {
    describe(c.name, () => {
      const spec: HwSpec = { trend: c.trend, damped: c.damped, seasonal: c.seasonal, m: c.m };
      const prm = { alpha: c.alpha, beta: c.beta, gamma: c.gamma, phi: c.phi, l0: c.l0, b0: c.b0, s0: c.s0 };
      const lev = Math.max(...c.y.map(Math.abs));
      it("SSE and fitted values at statsmodels' parameters and initial states", () => {
        const f = hwFilter(c.y, spec, prm);
        expect(rel(f.sse, c.sse)).toBeLessThan(1e-9);
        f.fitted.forEach((v, i) => expect(Math.abs(v - c.fitted[i])).toBeLessThan(1e-8 * lev));
      });
      it("forecasts at statsmodels' parameters (ETSModel every horizon; ExponentialSmoothing off the h = m slip)", () => {
        const f = hwForecast(c.y, spec, prm, c.forecastEts.length);
        f.forEach((v, i) => {
          expect(Math.abs(v - c.forecastEts[i])).toBeLessThan(1e-8 * lev);
          if (!c.m || (i + 1) % c.m !== 0) expect(Math.abs(v - c.forecastHw[i])).toBeLessThan(1e-8 * lev);
        });
      });
      if (c.forecastVar) {
        it("analytic forecast variances and 95% bounds match ETSModel", () => {
          const v = hwForecastVariance(spec, prm, c.sse, c.y.length, c.forecastVar!.length) as number[];
          v.forEach((x, i) => expect(rel(x, c.forecastVar![i])).toBeLessThan(1e-9));
          const b = hwIntervals(c.forecastEts, v);
          b.lower.forEach((x, i) => expect(Math.abs(x - c.lower![i])).toBeLessThan(1e-8 * lev));
          b.upper.forEach((x, i) => expect(Math.abs(x - c.upper![i])).toBeLessThan(1e-8 * lev));
        });
      } else {
        it("multiplicative seasonality has no closed-form interval", () => {
          expect(hwForecastVariance(spec, prm, c.sse, c.y.length, 8)).toBeNull();
        });
      }
      it("our SSE ≤ statsmodels' × (1 + 1e−6); information criteria by statsmodels' definitions", () => {
        const fit = fitHoltWinters(c.y, spec);
        if (!fit.ok) throw new Error(fit.reason);
        expect(fit.sse).toBeLessThanOrEqual(c.sse * (1 + 1e-6));
        // Parameters loosely, where both optimisers reached the same minimum (on "holt" statsmodels stops at
        // β = α with an SSE 0.28% above ours, so there the parameters legitimately differ).
        if (fit.sse > c.sse * (1 - 1e-7)) {
          const p = fit.params;
          expect(Math.abs(p.alpha - c.alpha)).toBeLessThan(1e-3);
          expect(Math.abs(p.beta - c.beta)).toBeLessThan(1e-3);
          expect(Math.abs(p.gamma - c.gamma)).toBeLessThan(1e-3);
          expect(Math.abs(p.phi - c.phi)).toBeLessThan(1e-3);
        } else {
          expect(c.name).toBe("holt");
        }
        const n = c.y.length;
        const d = n * Math.log(fit.sse / n) - n * Math.log(c.sse / n);
        expect(fit.aic - d).toBeCloseTo(c.aic, 6);
        expect(fit.bic - d).toBeCloseTo(c.bic, 6);
        if (fit.aicc !== null) expect(fit.aicc - d).toBeCloseTo(c.aicc, 6);
      });
    });
  }
});
