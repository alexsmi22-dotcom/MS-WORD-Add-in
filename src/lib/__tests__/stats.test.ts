import {
  describe as describeStats,
  mean,
  stdev,
  median,
  twoSampleTTest,
  pairedTTest,
  oneWayAnova,
  linearRegression,
  tTestP,
  fTestP,
  incompleteBeta,
  formatP,
  reportT,
  evalFormula,
  propagateUncertainty,
} from "../stats";

describe("descriptive statistics", () => {
  const data = [2, 4, 4, 4, 5, 5, 7, 9]; // textbook set: mean 5, sd 2.138
  it("matches known values", () => {
    expect(mean(data)).toBe(5);
    expect(stdev(data)).toBeCloseTo(2.138, 3);
    expect(median(data)).toBe(4.5);
    const d = describeStats(data);
    expect(d.n).toBe(8);
    expect(d.sem).toBeCloseTo(0.7559, 3);
    expect(d.variance).toBeCloseTo(4.5714, 3);
    // 95% CI = mean ± t(.05,7)·sem, t≈2.365 → ±1.788.
    expect(d.ci95[0]).toBeCloseTo(3.212, 2);
    expect(d.ci95[1]).toBeCloseTo(6.788, 2);
  });
});

describe("incomplete beta / distribution tails", () => {
  it("incompleteBeta is symmetric at the midpoint", () => {
    expect(incompleteBeta(0.5, 3, 3)).toBeCloseTo(0.5, 6);
  });
  it("Student-t two-tailed p is calibrated", () => {
    // t = 2.306 at df 8 is the .05 two-tailed critical value.
    expect(tTestP(2.306, 8)).toBeCloseTo(0.05, 3);
    expect(tTestP(2.0, 8)).toBeCloseTo(0.0805, 3);
  });
  it("F upper-tail p is calibrated", () => {
    expect(fTestP(27, 2, 6)).toBeCloseTo(0.001, 3);
  });
});

describe("t-tests", () => {
  it("pooled two-sample t-test", () => {
    const r = twoSampleTTest([1, 2, 3, 4, 5], [3, 4, 5, 6, 7], true);
    expect(r.t).toBeCloseTo(-2.0, 4);
    expect(r.df).toBe(8);
    expect(r.p).toBeCloseTo(0.0805, 3);
    expect(r.meanDifference).toBe(-2);
  });
  it("paired t-test on a real within-subject difference", () => {
    const r = pairedTTest([5, 6, 7, 8], [4, 4, 6, 5]); // diffs [1,2,1,3], mean 1.75
    expect(r.meanDifference).toBeCloseTo(1.75, 6);
    expect(r.df).toBe(3);
    expect(r.t).toBeCloseTo(3.657, 2);
    expect(Number.isFinite(r.p)).toBe(true);
  });
});

describe("ANOVA and regression", () => {
  it("one-way ANOVA F and df", () => {
    const r = oneWayAnova([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(r.f).toBeCloseTo(27, 4);
    expect(r.dfBetween).toBe(2);
    expect(r.dfWithin).toBe(6);
    expect(r.p).toBeLessThan(0.01);
  });
  it("linear regression recovers a clean line", () => {
    const r = linearRegression([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r.slope).toBeCloseTo(2, 6);
    expect(r.intercept).toBeCloseTo(0, 6);
    expect(r.rSquared).toBeCloseTo(1, 6);
    expect(r.slopeP).toBeLessThan(0.001);
  });
});

describe("reporting", () => {
  it("APA p-value and t formatting", () => {
    expect(formatP(0.027)).toBe("p = .027");
    expect(formatP(0.0004)).toBe("p < .001");
    expect(reportT({ t: 2.41, df: 18, p: 0.027, meanDifference: 1 })).toBe("t(18) = 2.41, p = .027");
  });

  it("formatP shows n/a (not 'p = NaN') for a non-finite p-value", () => {
    expect(formatP(NaN)).toBe("p = n/a");
    expect(formatP(Infinity)).toBe("p = n/a");
  });
});

describe("degenerate inputs produce non-finite statistics the UI must gate", () => {
  it("CV is undefined (non-finite) when the mean is zero", () => {
    const d = describeStats([-5, 5]);
    expect(d.mean).toBe(0);
    expect(Number.isFinite(d.cv)).toBe(false); // UI shows "n/a", never "Infinity%"
  });

  it("a zero-variance two-sample t-test yields a non-finite t", () => {
    const res = twoSampleTTest([5, 5], [7, 7]);
    expect(Number.isFinite(res.t)).toBe(false); // UI reports "undefined", not "t(NaN) = -Infinity"
  });

  it("regression on constant x yields a non-finite slope", () => {
    const res = linearRegression([3, 3, 3], [1, 2, 3]);
    expect(Number.isFinite(res.slope)).toBe(false); // UI reports "undefined"
  });
});

describe("evalFormula", () => {
  it("evaluates named variables, functions, and precedence", () => {
    expect(evalFormula("a*b + c", { a: 2, b: 3, c: 4 })).toBe(10);
    expect(evalFormula("sqrt(a^2 + b^2)", { a: 3, b: 4 })).toBe(5);
    expect(evalFormula("2*pi", {})).toBeCloseTo(6.2832, 3);
    expect(evalFormula("-x^2", { x: 3 })).toBe(-9); // unary minus looser than ^
  });
  it("throws on unknown names", () => {
    expect(() => evalFormula("a+z", { a: 1 })).toThrow();
  });
  it("user variables named e or pi are NOT shadowed by the constants", () => {
    expect(evalFormula("e", { e: 5 })).toBe(5);
    expect(evalFormula("pi*2", { pi: 10 })).toBe(20);
    // With no such variable, the constant is still available.
    expect(evalFormula("e", {})).toBeCloseTo(Math.E, 6);
  });
});

describe("describe edge cases", () => {
  it("empty input yields all-NaN, not Infinity min/max", () => {
    const d = describeStats([]);
    expect(d.n).toBe(0);
    expect(Number.isNaN(d.min)).toBe(true);
    expect(Number.isNaN(d.max)).toBe(true);
    expect(Number.isNaN(d.mean)).toBe(true);
  });
});

describe("propagateUncertainty", () => {
  it("product: relative errors add in quadrature", () => {
    // z = a·b, a = 10±0.1, b = 20±0.2 → z = 200, σ = √((20·0.1)² + (10·0.2)²) = √8.
    const r = propagateUncertainty("a*b", { a: { value: 10, uncertainty: 0.1 }, b: { value: 20, uncertainty: 0.2 } });
    expect(r.value).toBeCloseTo(200, 6);
    expect(r.uncertainty).toBeCloseTo(Math.sqrt(8), 4);
    // Equal contributions here.
    expect(r.contributions[0].contribution).toBeCloseTo(4, 4);
  });
  it("sum: absolute errors add in quadrature", () => {
    const r = propagateUncertainty("a+b", { a: { value: 5, uncertainty: 0.3 }, b: { value: 7, uncertainty: 0.4 } });
    expect(r.value).toBeCloseTo(12, 6);
    expect(r.uncertainty).toBeCloseTo(0.5, 4); // √(0.3²+0.4²)
  });
});
