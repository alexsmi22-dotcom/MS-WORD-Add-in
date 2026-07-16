// finance.ts ships models that are only valid under conditions its inputs cannot
// express, and for a long time it disclosed none of them to the user.
//
// The source was never dishonest — blackScholes() is documented as "European
// option (no dividends)" right in the file. But a source comment is not a
// disclosure. Nothing reached the pane: the words "European" and "dividend"
// appeared nowhere a user could see them. Someone pricing an American put got a
// number that is simply too low, with nothing on screen to say so.
//
// These tests assert the BEHAVIOUR the disclosures describe, so the warnings stay
// true rather than becoming decorative text nobody re-checks. The wording lives in
// taskpane.ts (FinCalc.assumes); the maths it warns about lives here.

import { blackScholes, irr, npv, bondPrice, bondAnalytics, impliedVolatility, normCdf } from "../finance";

describe("Black–Scholes: the European/no-dividend limit is real, not pedantry", () => {
  test("put-call parity holds — confirming this IS the European model", () => {
    // C - P = S - K e^(-r t) is the defining European relationship. An American
    // put breaks it (early exercise), which is exactly why the disclosure matters.
    const S = 100, K = 95, t = 1, r = 0.05, sigma = 0.25;
    const c = blackScholes("call", S, K, t, r, sigma);
    const p = blackScholes("put", S, K, t, r, sigma);
    expect(c - p).toBeCloseTo(S - K * Math.exp(-r * t), 6);
  });

  test("a deep in-the-money put is worth LESS than immediate exercise", () => {
    // The concrete harm the disclosure names. An American holder would exercise
    // now and take K - S; this European price is below that. Anyone pricing an
    // American put with this is underpricing it, and the number looks perfectly
    // reasonable.
    const S = 40, K = 100, t = 2, r = 0.08, sigma = 0.2;
    const european = blackScholes("put", S, K, t, r, sigma);
    const exerciseNow = K - S;
    expect(european).toBeLessThan(exerciseNow);
    // Not a rounding difference — a large, material gap.
    expect(exerciseNow - european).toBeGreaterThan(5);
  });

  test("the model has no dividend input at all", () => {
    // blackScholes(type, S, K, t, r, sigma) — six parameters, no q. A dividend
    // payer's call is worth less than this returns and the function cannot know.
    expect(blackScholes.length).toBe(6);
  });

  test("degenerate inputs fall back to intrinsic value rather than NaN", () => {
    expect(blackScholes("call", 110, 100, 0, 0.05, 0.2)).toBe(10);
    expect(blackScholes("put", 90, 100, 1, 0.05, 0)).toBe(10);
  });

  test("normCdf meets the ~1e-7 accuracy its own docstring claims", () => {
    // Abramowitz–Stegun 26.2.17. Asserted against the DOCUMENTED tolerance, not a
    // tighter one invented here: an earlier draft demanded 9 decimals and "failed"
    // on normCdf(0) = 0.4999999995 — off by 5e-10, i.e. 200x better than promised.
    // Testing a spec the code never claimed just manufactures false alarms.
    const cases: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447461],
      [-1, 0.1586552539],
      [1.96, 0.9750021049],
      [-1.96, 0.0249978951],
      [2.5, 0.9937903347],
      [-3, 0.0013498980],
    ];
    for (const [x, want] of cases) expect(Math.abs(normCdf(x) - want)).toBeLessThan(1e-7);
    // Symmetry is exact in the true CDF; the approximation should preserve it well.
    for (const x of [0.3, 1.1, 2.2]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 7);
  });
});

describe("IRR: the reinvestment and multiple-root warnings are true", () => {
  test("IRR is the rate that zeroes NPV — which is what makes it reinvest at itself", () => {
    const flows = [-1000, 500, 500, 500];
    const r = irr(flows);
    expect(r).not.toBeNull();
    expect(npv(r as number, flows)).toBeCloseTo(0, 6);
  });

  test("sign changes really can admit more than one IRR", () => {
    // The disclosure says "several valid IRRs and this reports only the first
    // found; compare NPV instead when signs alternate". Prove the premise: this
    // classic flow has roots near 25% and 400%.
    const flows = [-100, 500, -500];
    const f = (rate: number) => npv(rate, flows);
    // Two distinct rates both zero the NPV.
    const roots: number[] = [];
    let prev = f(0.01);
    for (let x = 0.02; x < 6; x += 0.01) {
      const cur = f(x);
      if (prev === 0 || prev * cur < 0) roots.push(x);
      prev = cur;
    }
    expect(roots.length).toBeGreaterThanOrEqual(2);
    // ...and irr() returns only one of them, silently.
    const single = irr(flows);
    if (single !== null) expect(npv(single, flows)).toBeCloseTo(0, 6);
  });

  test("no-solution is reported, not faked", () => {
    // All-positive flows have no IRR. The disclosure says "Returns no solution"
    // — it must not invent one.
    expect(irr([100, 100, 100])).toBeNull();
  });
});

describe("Bonds: the clean-price and flat-curve conventions", () => {
  test("bondPrice returns the CLEAN price — no accrued interest", () => {
    // Priced on a coupon date, clean == dirty, so the check that this excludes
    // accrual is structural: a par bond prices exactly at par.
    expect(bondPrice(1000, 0.05, 0.05, 10, 2)).toBeCloseTo(1000, 6);
  });

  test("price moves inversely to yield, and a discount bond prices below par", () => {
    expect(bondPrice(1000, 0.05, 0.06, 10, 2)).toBeLessThan(1000);
    expect(bondPrice(1000, 0.05, 0.04, 10, 2)).toBeGreaterThan(1000);
  });

  test("duration is a PARALLEL-shift first-order estimate and understates large moves", () => {
    // The disclosure says duration/convexity "understate risk for large moves".
    // Show it: the linear duration estimate misses the true repricing.
    const face = 1000, cpn = 0.05, y = 0.05, yrs = 10;
    const risk = bondAnalytics(face, cpn, y, yrs, 2);
    const p0 = bondPrice(face, cpn, y, yrs, 2);
    const dy = 0.02; // a big move — 200bp
    const actual = bondPrice(face, cpn, y + dy, yrs, 2);
    const linear = p0 * (1 - risk.modified * dy);
    // Convexity means the true price is ABOVE the straight-line estimate.
    expect(actual).toBeGreaterThan(linear);
  });
});

describe("Implied volatility inherits every Black–Scholes assumption", () => {
  test("round-trips: price -> sigma -> same price", () => {
    const S = 100, K = 100, t = 0.5, r = 0.03, sigma = 0.3;
    const price = blackScholes("call", S, K, t, r, sigma);
    const iv = impliedVolatility("call", price, S, K, t, r);
    expect(iv).not.toBeNull();
    expect(iv as number).toBeCloseTo(sigma, 4);
  });

  test("a price outside the model's bounds returns no solution rather than a number", () => {
    // A call cannot be worth more than the spot. The disclosure promises "no
    // solution" here; a silent wrong sigma would be far worse.
    expect(impliedVolatility("call", 500, 100, 100, 1, 0.03)).toBeNull();
  });
});
