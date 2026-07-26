// Multiple and polynomial regression.
//
// Anchored on cases with known exact answers — an exactly-determined plane, a
// perfect quadratic, agreement with the existing simple-linear fit — rather than
// on whatever the solver produces. A least-squares routine that is subtly wrong
// still returns plausible coefficients, which is the whole danger.

import { multipleRegression, polynomialRegression, leastSquares, probit, qqPoints } from "../regression";
import { linearRegression } from "../stats";

describe("it agrees with the simple-linear fit it generalises", () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8];
  const y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1];

  test("one predictor reproduces linearRegression's slope and intercept", () => {
    const simple = linearRegression(x, y);
    const multi = multipleRegression(y, [x]);
    expect(multi.ok).toBe(true);
    expect(multi.coefficients[1].estimate).toBeCloseTo(simple.slope, 10);
    expect(multi.coefficients[0].estimate).toBeCloseTo(simple.intercept, 10);
    expect(multi.rSquared).toBeCloseTo(simple.rSquared, 10);
    // The slope's standard error must match too, not just the point estimate.
    expect(multi.coefficients[1].standardError).toBeCloseTo(simple.slopeSE, 10);
    expect(multi.coefficients[1].p).toBeCloseTo(simple.slopeP, 10);
  });
});

describe("exact fits are recovered exactly", () => {
  test("a plane through points with no noise", () => {
    // y = 3 + 2*x1 - 1*x2, exactly.
    const x1 = [1, 2, 3, 4, 5, 6];
    const x2 = [2, 1, 4, 3, 6, 5];
    const y = x1.map((v, i) => 3 + 2 * v - x2[i]);
    const r = multipleRegression(y, [x1, x2]);
    expect(r.ok).toBe(true);
    expect(r.coefficients[0].estimate).toBeCloseTo(3, 8);
    expect(r.coefficients[1].estimate).toBeCloseTo(2, 8);
    expect(r.coefficients[2].estimate).toBeCloseTo(-1, 8);
    expect(r.rSquared).toBeCloseTo(1, 10);
    for (const res of r.residuals) expect(Math.abs(res)).toBeLessThan(1e-8);
  });

  test("a quadratic is recovered by degree 2", () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7];
    const y = x.map((v) => 5 - 2 * v + 0.5 * v * v);
    const r = polynomialRegression(x, y, 2);
    expect(r.ok).toBe(true);
    expect(r.rSquared).toBeCloseTo(1, 10);
    // Coefficients are on the centred scale; check the FIT rather than restating
    // the algebra, which is what a user actually relies on.
    for (let i = 0; i < y.length; i++) expect(r.fitted[i]).toBeCloseTo(y[i], 8);
  });

  test("a straight line is not improved by a quadratic term", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = x.map((v) => 4 + 3 * v);
    const quad = polynomialRegression(x, y, 2);
    // The quadratic coefficient should be ~0 on exactly-linear data.
    const last = quad.coefficients[quad.coefficients.length - 1];
    expect(Math.abs(last.estimate)).toBeLessThan(1e-8);
  });
});

describe("R squared and its adjustment", () => {
  test("adjusted R² is below R², and falls when a useless predictor is added", () => {
    // The reason both are reported: plain R² can only rise.
    const x1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 4.1, 5.9, 8.2, 9.8, 12.1, 14.2, 15.8, 18.1, 20];
    const noise = [5, 3, 9, 1, 7, 2, 8, 4, 6, 10];

    const one = multipleRegression(y, [x1]);
    const two = multipleRegression(y, [x1, noise]);

    expect(two.rSquared).toBeGreaterThanOrEqual(one.rSquared - 1e-12); // never falls
    expect(two.adjustedRSquared).toBeLessThan(one.adjustedRSquared); // but this does
    expect(one.adjustedRSquared).toBeLessThan(one.rSquared);
  });

  test("the overall F test rejects for a real relationship and not for noise", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const real = multipleRegression(x.map((v) => 2 * v + 1), [x]);
    expect(real.pOverall).toBeLessThan(0.001);

    const flat = multipleRegression([5, 5.1, 4.9, 5, 5.05, 4.95, 5, 5.02, 4.98, 5], [x]);
    expect(flat.pOverall).toBeGreaterThan(0.05);
  });
});

describe("what it refuses, rather than fitting noise", () => {
  test("collinear predictors are refused, not silently resolved", () => {
    const x1 = [1, 2, 3, 4, 5, 6];
    const x2 = x1.map((v) => 2 * v); // exact duplicate information
    const r = multipleRegression([1, 3, 2, 5, 4, 6], [x1, x2]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/collinear/);
  });

  test("a constant predictor is refused", () => {
    const r = multipleRegression([1, 2, 3, 4, 5], [[7, 7, 7, 7, 7]]);
    expect(r.ok).toBe(false);
  });

  test("as many parameters as observations is refused", () => {
    // Fits perfectly and means nothing.
    const r = multipleRegression([1, 2, 3], [[1, 2, 3], [4, 5, 7]]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/degrees of freedom/);
  });

  test("mismatched lengths are refused", () => {
    expect(multipleRegression([1, 2, 3, 4], [[1, 2, 3]]).ok).toBe(false);
  });

  test("too few observations", () => {
    expect(multipleRegression([1, 2], [[1, 2]]).ok).toBe(false);
  });
});

describe("numerical conditioning", () => {
  test("a cubic on large x still fits, because x is centred", () => {
    // Uncentred, the design columns span 10^0 to 10^9 and the fit collapses.
    const x = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009];
    const y = x.map((v) => 2 + 3 * (v - 1004.5) + 0.5 * Math.pow(v - 1004.5, 3));
    const r = polynomialRegression(x, y, 3);
    expect(r.ok).toBe(true);
    expect(r.rSquared).toBeGreaterThan(0.9999);
    for (let i = 0; i < y.length; i++) expect(r.fitted[i]).toBeCloseTo(y[i], 4);
  });

  test("leastSquares reports rank deficiency instead of guessing", () => {
    expect(leastSquares([[1, 1], [1, 1], [1, 1]], [1, 2, 3])).toBeNull();
  });
});

describe("Q-Q machinery", () => {
  test("probit inverts the normal CDF at known points", () => {
    expect(probit(0.5)).toBeCloseTo(0, 12);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 5);
    expect(probit(0.995)).toBeCloseTo(2.575829, 5);
  });

  test("probit refuses values outside (0,1) rather than returning Infinity", () => {
    for (const bad of [0, 1, -0.1, 1.1, NaN]) expect(probit(bad)).toBeNaN();
  });

  test("Q-Q points are sorted and finite", () => {
    const pts = qqPoints([3, -1, 0, 2, -2, 1]);
    expect(pts).toHaveLength(6);
    for (const p of pts) {
      expect(Number.isFinite(p.theoretical)).toBe(true);
      expect(Number.isFinite(p.sample)).toBe(true);
    }
    // Sorted by sample value.
    for (let i = 1; i < pts.length; i++) expect(pts[i].sample).toBeGreaterThanOrEqual(pts[i - 1].sample);
    // The plotting position never reaches probability 1, whose quantile is infinite.
    expect(Math.abs(pts[pts.length - 1].theoretical)).toBeLessThan(4);
  });

  test("normal residuals lie near the line; skewed ones do not", () => {
    // A Q-Q plot is only useful if it distinguishes these.
    const normalish = [-1.5, -0.9, -0.4, 0, 0.4, 0.9, 1.5];
    const skewed = [-0.2, -0.15, -0.1, -0.05, 0, 0.5, 5];
    const corr = (pts: ReturnType<typeof qqPoints>): number => {
      const tx = pts.map((p) => p.theoretical);
      const sy = pts.map((p) => p.sample);
      const mx = tx.reduce((a, b) => a + b, 0) / tx.length;
      const my = sy.reduce((a, b) => a + b, 0) / sy.length;
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < tx.length; i++) {
        num += (tx[i] - mx) * (sy[i] - my);
        dx += (tx[i] - mx) ** 2;
        dy += (sy[i] - my) ** 2;
      }
      return num / Math.sqrt(dx * dy);
    };
    expect(corr(qqPoints(normalish))).toBeGreaterThan(0.99);
    expect(corr(qqPoints(skewed))).toBeLessThan(0.95);
  });
});

describe("residuals", () => {
  test("standardized residuals are the residuals over the residual SE", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1];
    const r = multipleRegression(y, [x]);
    for (let i = 0; i < r.residuals.length; i++) {
      expect(r.standardizedResiduals[i]).toBeCloseTo(r.residuals[i] / r.residualStandardError, 10);
    }
  });

  test("residuals sum to zero when an intercept is fitted", () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [3, 5, 4, 8, 9, 11, 10];
    const r = multipleRegression(y, [x]);
    expect(r.residuals.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 8);
  });

  test("fitted plus residual returns the original observation", () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [3, 5, 4, 8, 9, 11, 10];
    const r = multipleRegression(y, [x]);
    for (let i = 0; i < y.length; i++) expect(r.fitted[i] + r.residuals[i]).toBeCloseTo(y[i], 10);
  });
});
