import { fitCurve, modelParameters } from "../curvefit";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("model parameter extraction", () => {
  it("finds free names in order, ignoring x and known functions", () => {
    expect(modelParameters("a*exp(-b*x) + c").names).toEqual(["a", "b", "c"]);
    expect(modelParameters("A/(1+exp(-k*(x-x0)))").names).toEqual(["A", "k", "x0"]);
    expect(modelParameters("sqrt(abs(m*x)) + log(n)").names).toEqual(["m", "n"]);
  });

  it("reports an unknown function call rather than fitting it as a parameter", () => {
    expect(modelParameters("wibble(x) + a").unknownCalls).toEqual(["wibble"]);
  });

  it("treats pi and e as constants, not parameters", () => {
    expect(modelParameters("a*sin(2*pi*x) + e").names).toEqual(["a"]);
  });
});

describe("fitting arbitrary models", () => {
  const xs = Array.from({ length: 20 }, (_, i) => i * 0.5);

  it("recovers an exponential decay exactly", () => {
    const ys = xs.map((x) => 5 * Math.exp(-0.7 * x) + 1.2);
    const r = ok(fitCurve(xs, ys, "a*exp(-b*x) + c", { start: { a: 4, b: 1, c: 1 } }));
    expect(r.names).toEqual(["a", "b", "c"]);
    expect(r.values[0]).toBeCloseTo(5, 4);
    expect(r.values[1]).toBeCloseTo(0.7, 4);
    expect(r.values[2]).toBeCloseTo(1.2, 4);
    expect(r.rSquared).toBeGreaterThan(0.9999);
    expect(r.converged).toBe(true);
  });

  it("recovers a logistic growth curve", () => {
    const ys = xs.map((x) => 10 / (1 + Math.exp(-1.5 * (x - 4))));
    const r = ok(fitCurve(xs, ys, "A/(1+exp(-k*(x-x0)))", { start: { A: 8, k: 1, x0: 3 } }));
    expect(r.values[0]).toBeCloseTo(10, 3);
    expect(r.values[1]).toBeCloseTo(1.5, 3);
    expect(r.values[2]).toBeCloseTo(4, 3);
  });

  it("recovers a power law", () => {
    const px = xs.filter((x) => x > 0);
    const ys = px.map((x) => 3 * Math.pow(x, 1.7));
    const r = ok(fitCurve(px, ys, "a*pow(x,b)", { start: { a: 1, b: 1 } }));
    expect(r.values[0]).toBeCloseTo(3, 3);
    expect(r.values[1]).toBeCloseTo(1.7, 3);
  });

  it("the predict function reproduces the fitted model", () => {
    const ys = xs.map((x) => 2 * x + 1);
    const r = ok(fitCurve(xs, ys, "m*x + b", { start: { m: 1, b: 0 } }));
    expect(r.predict(10)).toBeCloseTo(21, 6);
  });

  it("says when starting values were defaulted", () => {
    const ys = xs.map((x) => 2 * x + 1);
    const r = ok(fitCurve(xs, ys, "m*x + b"));
    expect(r.startWasDefaulted).toBe(true);
    expect(r.notes.join(" ")).toMatch(/defaulted to 1/);
    expect(r.notes.join(" ")).toMatch(/LOCAL/);
  });

  it("always warns that R-squared on a nonlinear fit is descriptive only", () => {
    const ys = xs.map((x) => 2 * x + 1);
    expect(ok(fitCurve(xs, ys, "m*x + b")).notes.join(" ")).toMatch(/descriptive only/);
  });

  it("flags a parameter whose standard error exceeds its value", () => {
    // Two parameters that trade off perfectly: a+b is identified, a and b are
    // not. NOISE IS REQUIRED for that to show — on an exact fit the residuals
    // are zero, so every standard error is zero however collinear the model is,
    // and the first version of this test asserted against noiseless data and
    // measured nothing.
    let seed = 42;
    const noise = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 0.4;
    };
    const ys = xs.map((x) => 3 * x + noise());
    const r = ok(fitCurve(xs, ys, "(a+b)*x", { start: { a: 1, b: 1 } }));
    const flagged =
      r.notes.join(" ").match(/not determined by this data/i) !== null ||
      r.errors.some((e, i) => Number.isFinite(e) && Math.abs(e) > Math.abs(r.values[i]));
    expect(flagged).toBe(true);
  });

  it("refuses a model with no parameters", () => {
    const r = fitCurve(xs, xs, "2*x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no parameters/);
  });

  it("refuses an unknown function with the list of real ones", () => {
    const r = fitCurve(xs, xs, "wibble(x)*a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a function this recognises/);
  });

  it("refuses more parameters than points", () => {
    const r = fitCurve([1, 2], [1, 2], "a*x + b + c");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/passes exactly through the data/);
  });

  it("refuses mismatched, too-short and non-finite input", () => {
    expect(fitCurve([1, 2], [1], "a*x").ok).toBe(false);
    expect(fitCurve([1], [1], "a*x").ok).toBe(false);
    expect(fitCurve([1, NaN], [1, 2], "a*x").ok).toBe(false);
    expect(fitCurve([1, 2], [1, 2], "   ").ok).toBe(false);
  });

  it("refuses a model that is undefined at the starting values", () => {
    const r = fitCurve(xs, xs, "ln(a-1)*x", { start: { a: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not evaluate to a finite number/);
  });
});
