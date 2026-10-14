// Radius of convergence — the §D acceptance values of docs/SCOPE-SYMBOLIC-BATCH.md,
// verbatim. Each R is hand-derived as the distance to the nearest singularity in ℂ
// (SymPy's series to order 40 with the root test only shows the trend, which is
// exactly why the engine never reads R from coefficients).

import { parseExpr, evalAst } from "../solve";
import { radiusOfFunction, radiusOfSeriesTerm, parseRadiusRequest, tryRadius, radiusSvg } from "../radius";

const F = (f: string, c: number | string = 0) => radiusOfFunction(f, "x", c);

describe("§D radius table — functions", () => {
  const rows: [string, number | string, string][] = [
    // R = 1
    ["1/(1-x)", 0, "1"],
    ["1/(1+x^2)", 0, "1"],
    ["ln(1+x)", 0, "1"],
    ["sqrt(1+x)", 0, "1"],
    ["atan(x)", 0, "1"],
    ["1/(1+x+x^2)", 0, "1"],
    ["1/x", 1, "1"],
    ["1/(1-x)^2", 0, "1"],
    // R = pi/2
    ["tan(x)", 0, "pi/2"],
    ["1/cos(x)", 0, "pi/2"],
    // R = 2
    ["1/(2-x)", 0, "2"],
    ["1/(x^2 - 5x + 6)", 0, "2"],
    ["ln(x)", 2, "2"],
    // R = sqrt(5)
    ["1/(x^2+4)", 1, "sqrt(5)"],
    // R = 2*pi
    ["x/(exp(x)-1)", 0, "2*pi"],
  ];
  it.each(rows)("%s about %s → R = %s (a theorem, exact)", (f, c, R) => {
    const r = F(f, c);
    expect(r.kind).toBe("finite");
    expect(r.exact).toBe(R);
    // The printed R is Solve grammar and re-parses to its value.
    expect(evalAst(parseExpr(R), {})).toBeCloseTo(r.value as number, 12);
    expect(r.theorem).toMatch(/Cauchy/);
  });

  it.each(["exp(x)", "sin(x)", "(x^2-1)/(x-1)"])("%s → R = ∞", (f) => {
    const r = F(f);
    expect(r.kind).toBe("infinite");
    expect(r.value).toBe(Infinity);
    expect(r.display).toBe("∞");
  });

  it("(x^2-1)/(x-1) names x = 1 as removable, not a singularity", () => {
    const r = F("(x^2-1)/(x-1)");
    expect(r.removable).toContain("x = 1");
    expect(r.line).toMatch(/removable/);
  });

  it("1/(1+x^2) gets the teaching line: smooth on the reals, radius set by complex poles", () => {
    const r = F("1/(1+x^2)");
    expect(r.line).toMatch(/pole at x = ±i \(distance 1\)/);
    expect(r.lines.join(" ")).toMatch(/smooth on the whole real line; the radius is set by complex poles/);
    expect(r.line).toMatch(/converges for \|x\| < 1 and diverges for \|x\| > 1/);
    expect(F("1/(x^2+4)", 1).line).toMatch(/converges for \|x - 1\| < sqrt\(5\)/);
  });

  it("the nearest points are named: e^{±2πi/3} for 1/(1+x+x^2), ±2πi for x/(e^x − 1)", () => {
    expect(F("1/(1+x+x^2)").line).toMatch(/x = -1\/2 ± sqrt\(3\)\/2\*i/);
    expect(F("x/(exp(x)-1)").line).toMatch(/x = ±2\*pi\*i/);
    expect(F("x/(exp(x)-1)").removable).toContain("x = 0");
  });
});

describe("§D radius table — explicit general terms (ratio test)", () => {
  const rows: [string, string, string | null][] = [
    ["x^n/n", "1", "[-1, 1)"],
    ["x^n/n^2", "1", "[-1, 1]"],
    ["n*x^n", "1", "(-1, 1)"],
    ["(x-3)^n/(n*2^n)", "2", "[1, 5)"],
    ["x^n/3^n", "3", "(-3, 3)"],
  ];
  it.each(rows)("sum %s → R = %s, interval %s", (term, R, iv) => {
    const r = radiusOfSeriesTerm(term);
    expect(r.kind).toBe("finite");
    expect(r.exact).toBe(R);
    expect(r.interval?.text).toBe(iv);
    expect(r.theorem).toMatch(/ratio test/);
  });

  it("sum x^n/n: harmonic at 1, alternating at −1", () => {
    const r = radiusOfSeriesTerm("x^n/n");
    const why = r.interval!.reasons.join(" ");
    expect(why).toMatch(/At x = 1: diverges .*harmonic/);
    expect(why).toMatch(/At x = -1: converges conditionally — alternating series test/);
  });
  it("sum x^n/n^2: p-series at both ends", () => {
    expect(radiusOfSeriesTerm("x^n/n^2").interval!.reasons.join(" ")).toMatch(/p-series .*p = 2 > 1/);
  });
  it("sum n*x^n: divergence test at both ends", () => {
    expect(radiusOfSeriesTerm("n*x^n").interval!.reasons.every((s) => /divergence test/.test(s))).toBe(true);
  });
  it("sum x^n/factorial(n) → ∞; sum factorial(n)*x^n → 0, converges only at x = 0", () => {
    const a = radiusOfSeriesTerm("x^n/factorial(n)");
    expect(a.kind).toBe("infinite");
    const b = radiusOfSeriesTerm("factorial(n)*x^n");
    expect(b.kind).toBe("zero");
    expect(b.exact).toBe("0");
    expect(b.line).toMatch(/converges only at x = 0/);
    expect(radiusOfSeriesTerm("x^n/n!").kind).toBe("infinite");
  });
});

describe("§D must refuse", () => {
  it("taylor abs(x) — refused by name", () => {
    const r = F("abs(x)");
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(/abs\(…\) is not analytic/);
    expect(r.lines.join(" ")).toMatch(/reading it from the computed coefficients would be sampling/);
  });
  it("radius of convergence gamma(x) — refused by name", () => {
    const v = tryRadius("radius of convergence gamma(x)")!;
    expect(v).not.toBeNull();
    expect(v.lines[0].text).toMatch(/gamma\(…\) is outside the singularity table/);
    expect(v.svg).toBeUndefined();
  });
});

describe("requests", () => {
  it("parses the phrasings", () => {
    expect(parseRadiusRequest("radius of convergence of 1/(1-x)")).toMatchObject({ kind: "function", expr: "1/(1-x)", centre: "0", mode: "radius" });
    expect(parseRadiusRequest("radius of convergence of 1/(x^2+4) about 1")).toMatchObject({ expr: "1/(x^2+4)", centre: "1" });
    expect(parseRadiusRequest("radius of convergence sum x^n/n")).toMatchObject({ kind: "sum", expr: "x^n/n" });
    expect(parseRadiusRequest("radius of convergence Σ x^n/n^2 from n=1 to infinity")).toMatchObject({ kind: "sum", expr: "x^n/n^2" });
    expect(parseRadiusRequest("interval of convergence of sum (x-3)^n/(n*2^n)")).toMatchObject({ kind: "sum", mode: "interval" });
    expect(parseRadiusRequest("radius of convergence of the taylor series of ln(x) about 2")).toMatchObject({ expr: "ln(x)", centre: "2" });
    expect(parseRadiusRequest("x^2 - 1 = 0")).toBeNull();
    expect(parseRadiusRequest("taylor 1/(1-x)")).toBeNull();
  });
  it("the verb answers with R, the theorem and a figure", () => {
    const v = tryRadius("radius of convergence of 1/(1+x^2)")!;
    expect(v.title).toBe("Radius of convergence");
    expect(v.lines[0]).toEqual({ text: "R = 1", math: true });
    expect(v.lines.map((l) => l.text).join(" ")).toMatch(/Theorem: Cauchy/);
    expect(v.svg).toMatch(/^<svg/);
    const w = tryRadius("interval of convergence of sum (x-3)^n/(n*2^n)")!;
    expect(w.title).toBe("Interval of convergence");
    expect(w.lines.map((l) => l.text).join(" ")).toMatch(/\[1, 5\)/);
  });
  it("the figure labels the singularities within 2R and marks open/closed ends", () => {
    const svg = radiusSvg(F("ln(1+x)"));
    expect(svg).toMatch(/branch pt/);
    expect(svg).toMatch(/\(-1, 1\]/);
    expect(radiusSvg(F("exp(x)"))).toBe("");
    expect(radiusSvg(F("abs(x)"))).toBe("");
  });
});
