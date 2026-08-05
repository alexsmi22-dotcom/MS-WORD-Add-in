// Defect 0.15 — a NUMERIC limit must not print more significant digits than its
// acceptance tolerance justifies.
//
// The reproduction, preserved verbatim: `limit((1+1/x)^x, x -> inf)` used to come
// back as 2.7185235 — eight significant digits, wrong from the fifth, against a
// true value of e = 2.718281828…. The tail the convergence test accepted was
//
//   [2.7182804690957534, 2.7182817983473577, 2.7182820532347876, 2.7185234960372378]
//
// whose spread is 2.43e-4. Rounding that value to FOUR significant figures still
// prints 2.719 where e is 2.718, because the uncertainty band straddles the
// rounding boundary; only at three figures (2.72) is every printed digit a digit
// of e. So the test below is written as "every digit printed matches e", not as
// "the value is close to e" — closeness is what shipped the defect.

import { limit } from "../analysis";

describe("defect 0.15 — numeric limits report only the digits the tolerance supports", () => {
  it("limit((1+1/x)^x, x -> inf): every printed digit is a digit of e", () => {
    const r = limit("(1+1/x)^x", "x", "inf");
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("finite");
    // This is the NUMERIC fallback branch: no symbolic/exact form was produced.
    expect(r!.exact).toBeUndefined();

    const digits = r!.significantDigits;
    expect(digits).toBeDefined();
    expect(digits!).toBeGreaterThanOrEqual(1);
    expect(digits!).toBeLessThanOrEqual(4);

    // The value itself is rounded, so it is right no matter how the caller prints
    // it — including the pane's trimNum, which is toPrecision(8).
    expect(r!.value).toBe(Number(Math.E.toPrecision(digits!)));
    expect(Number(r!.value!.toPrecision(8))).toBe(Number(Math.E.toPrecision(digits!)));
    expect(String(r!.value)).not.toContain("2.7185");
  });

  it("states the tolerance it was accepted under", () => {
    const r = limit("(1+1/x)^x", "x", "inf");
    const caveats = r!.caveats.join(" ");
    expect(caveats).toContain("1e-4");
    expect(caveats).toMatch(/significant figure/i);
  });

  it("the digit rule is SCALE-FREE — 1e8x and 1e-8x report the same figures", () => {
    // The trap being avoided: a rule built from the ABSOLUTE spread would read a
    // spread of 2.4e4 on a value of 2.7e8 as catastrophic and collapse to one
    // significant figure, while reading the same relative error on a tiny value as
    // perfect. A constant factor cannot change how well a limit is known — the same
    // invariance the convergence test itself was rewritten for.
    const big = limit("1e8*(1+1/x)^x", "x", "inf");
    const small = limit("1e-8*(1+1/x)^x", "x", "inf");
    expect(big!.significantDigits).toBe(3);
    expect(small!.significantDigits).toBe(3);
    expect(big!.value).toBe(Number((Math.E * 1e8).toPrecision(3)));
    expect(small!.value).toBe(Number((Math.E * 1e-8).toPrecision(3)));
  });

  it("a limit that shrinks to zero is exactly 0, not a rounded sample", () => {
    // These take the early-return branches of settles(), which carry no spread, so
    // nothing is rounded and no precision claim is made.
    for (const [expr, at] of [["ln(x)/x", "inf"], ["x*sin(1/x)", 0]] as [string, "inf" | number][]) {
      const r = limit(expr, "x", at);
      expect(r!.kind).toBe("finite");
      expect(r!.value).toBe(0);
      expect(r!.significantDigits).toBeUndefined();
    }
  });

  it("reports NO value when the samples do not agree to even one figure", () => {
    // tan(x) as x → ∞ has no limit. Scaled by 1e-6 the tail slips under the absolute
    // floor in the acceptance test (`spread <= 1e-4 * (1 + |last|)`), so this branch
    // was reached with samples that do not agree on the SIGN — and it reported
    // -8e-7 with a caveat claiming one significant figure was supported.
    const r = limit("1e-6*tan(x)", "x", "inf");
    expect(r!.kind).toBe("undetermined");
    expect(r!.value).toBeUndefined();
    expect(r!.significantDigits).toBeUndefined();
    expect(r!.caveats.join(" ")).toMatch(/do not agree/i);
  });

  it("does NOT round a limit established symbolically (L'Hopital)", () => {
    // sin(x)/x clears by L'Hopital, which is not tolerance-limited: full precision.
    const r = limit("sin(x)/x", "x", 0);
    expect(r!.kind).toBe("finite");
    expect(r!.value).toBeCloseTo(1, 12);
    expect(r!.significantDigits).toBeUndefined();
  });

  it("does NOT round a limit established by direct substitution", () => {
    const r = limit("x^2 + 1", "x", 3);
    expect(r!.kind).toBe("finite");
    expect(r!.value).toBe(10);
    expect(r!.significantDigits).toBeUndefined();
  });
});
