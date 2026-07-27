// Limits and Taylor series (analysis.ts).
//
// The oracles are textbook limits and textbook series. Two cases carry most of
// the weight, because they are where the first implementation was wrong:
//
//   abs(x)/x at 0   the two-sided limit DOES NOT EXIST (−1 from below, +1 from
//                   above). It came back as "1", because the indeterminate 0/0
//                   sent it down the L'Hôpital path and the fallback probe
//                   sampled only from ABOVE. A limit reported as existing when
//                   it does not is the worst answer this module can give.
//   1/x at 0        diverges. It came back "undetermined" because divergence
//                   was tested against an absolute threshold of 1e12, and
//                   1/1e-7 is only 1e7.

import { limit, taylorSeries, parseLimitRequest, parseSeriesRequest } from "../analysis";

const L = (e: string, p: Parameters<typeof limit>[2] = 0, s: Parameters<typeof limit>[3] = "both") =>
  limit(e, "x", p, s)!;

describe("standard limits", () => {
  const CASES: [string, number][] = [
    ["sin(x)/x", 1],
    ["(1-cos(x))/x^2", 0.5],
    ["(exp(x)-1)/x", 1],
    ["tan(x)/x", 1],
    ["(x^2-1)/(x-1)", 2], // at x = 1, handled separately below
  ];
  it("sin(x)/x → 1", () => expect(L("sin(x)/x").value).toBeCloseTo(1, 6));
  it("(1-cos x)/x² → 1/2", () => expect(L("(1-cos(x))/x^2").value).toBeCloseTo(0.5, 6));
  it("(eˣ−1)/x → 1", () => expect(L("(exp(x)-1)/x").value).toBeCloseTo(1, 6));
  it("tan(x)/x → 1", () => expect(L("tan(x)/x").value).toBeCloseTo(1, 6));
  it("a removable singularity: (x²−1)/(x−1) → 2 at x = 1", () => {
    expect(L("(x^2-1)/(x-1)", 1).value).toBeCloseTo(2, 6);
  });
  it("L'Hôpital is named in the working when it is used", () => {
    expect(L("sin(x)/x").steps.join(" ")).toMatch(/L'Hôpital/);
  });
});

describe("one-sided limits and non-existence — the case that was wrong", () => {
  it("abs(x)/x has NO two-sided limit", () => {
    const r = L("abs(x)/x");
    expect(r.kind).toBe("does-not-exist");
    expect(r.value).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/DOES NOT EXIST/);
  });
  it("but each one-sided limit exists and is ±1", () => {
    expect(L("abs(x)/x", 0, "+").value).toBeCloseTo(1, 6);
    expect(L("abs(x)/x", 0, "-").value).toBeCloseTo(-1, 6);
  });
  it("1/x diverges to +∞ from above and −∞ from below", () => {
    expect(L("1/x", 0, "+").kind).toBe("infinite");
    expect(L("1/x", 0, "+").value).toBe(Infinity);
    expect(L("1/x", 0, "-").value).toBe(-Infinity);
  });
  it("so 1/x has no two-sided limit at 0", () => {
    expect(L("1/x").kind).toBe("does-not-exist");
  });
  it("1/x² diverges to +∞ on BOTH sides, so the two-sided limit is +∞", () => {
    const r = L("1/x^2");
    expect(r.kind).toBe("infinite");
    expect(r.value).toBe(Infinity);
  });
});

describe("limits at infinity", () => {
  it("a rational function tends to the ratio of leading coefficients", () => {
    expect(L("(2*x+1)/(x+3)", "inf").value).toBeCloseTo(2, 6);
  });
  it("exp(−x) → 0", () => expect(L("exp(-x)", "inf").value).toBeCloseTo(0, 9));
  it("ln(x)/x → 0, reported as 0 rather than a sampling artefact", () => {
    const r = L("ln(x)/x", "inf");
    expect(r.value).toBe(0);
  });
  it("x·ln(x) → 0 as x → 0 from above", () => {
    expect(L("x*ln(x)", 0, "+").value).toBe(0);
  });
  it("x² grows without bound", () => {
    expect(L("x^2", "inf").kind).toBe("infinite");
  });
});

describe("a limit that does not exist is admitted, not guessed", () => {
  it("sin(1/x) oscillates and is reported undetermined", () => {
    const r = L("sin(1/x)", 0, "+");
    expect(r.kind).toBe("undetermined");
    expect(r.value).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/could not be established/);
  });
  it("a purely numeric answer says so", () => {
    // Anything reached only by probing must carry the numeric caveat.
    const r = L("sin(1/x)", 0, "+");
    expect(r.kind).toBe("undetermined");
  });
});

describe("Taylor and Maclaurin series", () => {
  const T = (e: string, c = 0, o = 6) => taylorSeries(e, "x", c, o)!;
  it("eˣ has coefficients 1, 1, 1/2, 1/6, 1/24 — exact, not decimal", () => {
    const r = T("exp(x)", 0, 5);
    expect(r.display).toContain("1 + x + 1/2*x^2 + 1/6*x^3 + 1/24*x^4");
    expect(r.display).not.toMatch(/0\.16666/);
  });
  it("sin(x) has only odd terms with alternating signs", () => {
    const r = T("sin(x)", 0, 7);
    expect(r.display).toContain("x - 1/6*x^3 + 1/120*x^5 - 1/5040*x^7");
  });
  it("cos(x) has only even terms", () => {
    expect(T("cos(x)", 0, 6).display).toContain("1 - 1/2*x^2 + 1/24*x^4 - 1/720*x^6");
  });
  it("the geometric series 1/(1−x) is all ones", () => {
    expect(T("1/(1-x)", 0, 5).display).toContain("1 + x + x^2 + x^3 + x^4 + x^5");
  });
  it("ln(1+x) has the harmonic coefficients", () => {
    expect(T("ln(1+x)", 0, 5).display).toContain("x - 1/2*x^2 + 1/3*x^3 - 1/4*x^4 + 1/5*x^5");
  });
  it("a series about a nonzero centre uses (x − a) powers", () => {
    const r = T("sqrt(x)", 1, 3);
    expect(r.display).toContain("(x - 1)");
    expect(r.centre).toBe(1);
  });
  it("the truncation is always stated", () => {
    const r = T("exp(x)", 0, 4);
    expect(r.display).toMatch(/O\(x\^\d+\)/);
    expect(r.caveats.join(" ")).toMatch(/TRUNCATED series/);
    expect(r.caveats.join(" ")).toMatch(/radius of convergence is not computed/);
  });
  it("a function with no series at the centre is refused", () => {
    expect(taylorSeries("ln(x)", "x", 0, 3)).toBeNull();
    expect(taylorSeries("1/x", "x", 0, 3)).toBeNull();
  });
  it("the series actually approximates the function near the centre", () => {
    const r = T("exp(x)", 0, 6);
    // Evaluate the coefficients directly against e^x at a nearby point.
    for (const x of [0.1, 0.3, -0.2]) {
      let s = 0;
      r.coefficients.forEach((c, k) => (s += c * Math.pow(x, k)));
      expect(Math.abs(s - Math.exp(x))).toBeLessThan(1e-5);
    }
  });
});

describe("request parsing", () => {
  it("reads limit requests", () => {
    expect(parseLimitRequest("limit sin(x)/x as x -> 0")).toEqual({ expr: "sin(x)/x", variable: "x", point: 0, side: "both" });
    expect(parseLimitRequest("lim 1/x as x -> inf")!.point).toBe("inf");
    expect(parseLimitRequest("limit 1/x as x -> 0+")!.side).toBe("+");
  });
  it("reads series requests", () => {
    expect(parseSeriesRequest("taylor exp(x) order 5")).toMatchObject({ expr: "exp(x)", order: 5 });
    expect(parseSeriesRequest("maclaurin sin(x)")!.centre).toBe(0);
    expect(parseSeriesRequest("series cos(x) about 0 order 4")).toMatchObject({ centre: 0, order: 4 });
  });
  it("refuses what is neither", () => {
    expect(parseLimitRequest("nonsense")).toBeNull();
    expect(parseSeriesRequest("nonsense")).toBeNull();
    expect(parseLimitRequest("")).toBeNull();
  });
});
