/**
 * Polynomial interpolation — the acceptance audit from docs/SCOPE-LP-SPLINES.md §D
 * (Interpolation). Every expected value there was computed independently of the
 * engine (own BigInt Vandermonde solve). Inputs are verbatim; expected strings exact.
 */
import { parseExpr, evalAst } from "../solve";
import { tryInterpolate, INTERP_VERB_RE } from "../interpolate";

const run = (q: string) => {
  const v = tryInterpolate(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string): string => {
  const v = tryInterpolate(q);
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered, not refused: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string): string => run(q).lines.map((l) => l.text).join("\n");
const mathLines = (q: string): string[] => run(q).lines.filter((l) => l.math).map((l) => l.text);
/** The first `p(x) = …` line's right-hand side. */
const poly = (q: string): string => {
  const l = mathLines(q).find((t) => t.startsWith("p(x) = "));
  if (!l) throw new Error("no p(x) line in\n" + text(q));
  return l.slice("p(x) = ".length);
};
/** The `p(v) = …` value line's right-hand side. */
const value = (q: string): string => {
  const l = mathLines(q).find((t) => /^p\([^x)]+\) = /.test(t));
  if (!l) throw new Error("no p(v) line in\n" + text(q));
  return l.replace(/^p\([^)]+\) = /, "");
};
const rhs = (s: string): string => (s.includes(" = ") ? s.split(" = ").slice(-1)[0] : s);
const num = (s: string): number => evalAst(parseExpr(s), { pi: Math.PI, e: Math.E });

describe("§D interpolation — the polynomial", () => {
  it("interpolate (1, 2), (2, 3), (4, 7) → p(x) = 1/3*x^2 + 5/3, Newton form", () => {
    const q = "interpolate (1, 2), (2, 3), (4, 7)";
    expect(poly(q)).toBe("1/3*x^2 + 5/3");
    // §D wrote the Newton form as `2 + 1*(x - 1) + …`; the unit coefficient is dropped
    // here to match polyString's convention product-wide (decision recorded in the review).
    expect(mathLines(q)).toContain("p(x) = 2 + (x - 1) + 1/3*(x - 1)*(x - 2)");
    expect(text(q)).toContain("Degree 2 through 3 points");
    expect(run(q).title).toBe("Interpolating polynomial through 3 points");
  });
  it("… at x = 3 → 14/3 ≈ 4.66667 (NOT \"x = 3\")", () => {
    const q = "interpolate (1, 2), (2, 3), (4, 7) at x = 3";
    expect(value(q)).toBe("14/3");
    expect(text(q)).toContain("≈ 4.66667");
    expect(text(q)).not.toMatch(/^x = 3$/m);
  });
  it("lagrange polynomial through (0, 1), (1, 3), (2, 2) → -3/2*x^2 + 7/2*x + 1 with the basis", () => {
    const q = "lagrange polynomial through (0, 1), (1, 3), (2, 2)";
    expect(poly(q)).toBe("-3/2*x^2 + 7/2*x + 1");
    const m = mathLines(q);
    expect(m).toContain("L0(x) = (x - 1)*(x - 2)/2");
    expect(m).toContain("L1(x) = -x*(x - 2)");
    expect(m).toContain("L2(x) = x*(x - 1)/2");
    expect(run(q).title).toBe("Lagrange interpolation through 3 points");
  });
  it("… at x = 1.5 → 23/8 = 2.875", () => {
    const q = "lagrange polynomial through (0, 1), (1, 3), (2, 2) at x = 1.5";
    expect(value(q)).toBe("23/8");
    expect(text(q)).toContain("≈ 2.875");
  });
  it("neville's method … at x = 1.5 → 23/8 with the tableau", () => {
    const q = "neville's method (0,1), (1,3), (2,2) at x = 1.5";
    expect(value(q)).toBe("23/8");
    const t = text(q);
    expect(t).toContain("Neville tableau at x = 3/2");
    expect(t).toContain("x_0 = 0: 1");
    expect(t).toContain("x_1 = 1: 3 · 4");
    expect(t).toContain("x_2 = 2: 2 · 5/2 · 23/8");
    expect(run(q).caveats.join(" ")).toContain("Neville tableau's final entry equals p(v)");
  });
  it("lagrange interpolation (1, 1), (2, 8), (3, 27), (4, 64) → x^3", () => {
    expect(poly("lagrange interpolation (1, 1), (2, 8), (3, 27), (4, 64)")).toBe("x^3");
  });
  it("newton divided differences … → x^3, table 1 · 7, 19, 37 · 6, 9 · 1", () => {
    const q = "newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)";
    expect(poly(q)).toBe("x^3");
    expect(text(q)).toContain("Divided differences: order 0: 1, 8, 27, 64; order 1: 7, 19, 37; order 2: 6, 9; order 3: 1.");
    expect(mathLines(q)).toContain("p(x) = 1 + 7*(x - 1) + 6*(x - 1)*(x - 2) + (x - 1)*(x - 2)*(x - 3)");
    expect(run(q).title).toBe("Newton divided differences through 4 points");
  });
  it("x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial → x^2 + 1, \"degree 2, not 3\"", () => {
    const q = "x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial";
    expect(poly(q)).toBe("x^2 + 1");
    expect(text(q)).toContain("Degree 2, not 3: the 4 points lie on a parabola.");
  });
  it("polynomial through (0, 0), (1, 1), (2, 4), (3, 9) → x^2", () => {
    expect(poly("polynomial through (0, 0), (1, 1), (2, 4), (3, 9)")).toBe("x^2");
  });
  it("x = 1, 2, 3, 4; y = 1, 4, 9, 16 interpolating polynomial → x^2", () => {
    expect(poly("x = 1, 2, 3, 4; y = 1, 4, 9, 16 interpolating polynomial")).toBe("x^2");
  });
  it("degree 3 polynomial through (-1, 0), (0, 1), (1, 0), (2, 5) → 4/3*x^3 - x^2 - 4/3*x + 1", () => {
    expect(poly("degree 3 polynomial through (-1, 0), (0, 1), (1, 0), (2, 5)")).toBe("4/3*x^3 - x^2 - 4/3*x + 1");
  });
  it("interpolate points (1, 2.5), (2, 3.75), (3, 1.2) → exact: the decimals are rationals", () => {
    expect(poly("interpolate points (1, 2.5), (2, 3.75), (3, 1.2)")).toBe("-19/10*x^2 + 139/20*x - 51/20");
  });
  it("interpolating polynomial for f(x) = 1/x at x = 1, 2, 4 → 1/8*x^2 - 7/8*x + 7/4", () => {
    expect(poly("interpolating polynomial for f(x) = 1/x at x = 1, 2, 4")).toBe("1/8*x^2 - 7/8*x + 7/4");
  });
  it("line through (1, 2) and (3, 8) → 3*x - 1", () => {
    expect(poly("line through (1, 2) and (3, 8)")).toBe("3*x - 1");
  });
  it("interpolation table x 1 2 4 y 2 3 7 (the §A steal) → the same parabola", () => {
    expect(poly("interpolation table x 1 2 4 y 2 3 7")).toBe("1/3*x^2 + 5/3");
  });
});

describe("§D interpolation — linear", () => {
  it("linear interpolation between (1, 10) and (3, 20) at x = 2 → 15 with the proportion line", () => {
    const q = "linear interpolation between (1, 10) and (3, 20) at x = 2";
    expect(value(q)).toBe("15");
    expect(mathLines(q)).toContain("(x - 1)/(3 - 1) = (y - 10)/(20 - 10)");
    expect(poly(q)).toBe("5*x + 5");
    expect(run(q).title).toBe("Linear interpolation between (1, 10) and (3, 20)");
  });
  it("linearly interpolate at x = 2.5 from (2, 4) and (3, 9) → 13/2", () => {
    expect(value("linearly interpolate at x = 2.5 from (2, 4) and (3, 9)")).toBe("13/2");
  });
  it("estimate f(2.5) given f(2) = 4, f(3) = 9 by linear interpolation → 13/2", () => {
    const q = "estimate f(2.5) given f(2) = 4, f(3) = 9 by linear interpolation";
    expect(value(q)).toBe("13/2");
    expect(text(q)).toContain("≈ 6.5");
  });
});

describe("§D interpolation — error bound", () => {
  it("error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic → sqrt(3)/216 ≈ 0.00801875, M = 1 stated", () => {
    const q = "error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic";
    const v = run(q);
    expect(v.lines[0]).toEqual({ text: "sqrt(3)/216", math: true });
    expect(num("sqrt(3)/216")).toBeCloseTo(0.00801875, 8);
    const t = text(q);
    expect(t).toContain("|f(x) - p(x)| ≤ 1/6 · sqrt(3)/36 = sqrt(3)/216 ≈ 0.00801875");
    expect(t).toContain("M = 1: |cos(x)| ≤ 1 everywhere — provable, not sampled.");
    expect(t).toContain("max|w(x)| on [0, 1] = sqrt(3)/36 ≈ 0.0481125");
    expect(mathLines(q)).toContain("w(x) = x^3 - 3/2*x^2 + 1/2*x");
    expect(mathLines(q)).toContain("-cos(x)");
    expect(v.title).toBe("Error bound for interpolating sin(x) at 3 nodes");
  });
});

describe("§D interpolation — refusals and FIT vs INTERPOLANT", () => {
  it("interpolate (1, 2), (1, 3), (2, 4) → refusal naming x = 1", () => {
    expect(refusal("interpolate (1, 2), (1, 3), (2, 4)")).toBe("x = 1 appears twice (y = 2 and y = 3): no function passes through both.");
  });
  it("fit a polynomial through (0,1), (1,3), (2,2) → the interpolant + the caveat", () => {
    const q = "fit a polynomial through (0,1), (1,3), (2,2)";
    expect(poly(q)).toBe("-3/2*x^2 + 7/2*x + 1");
    expect(run(q).caveats.join(" ")).toMatch(/through every point exactly.*least-squares FIT is a different thing/);
  });
  it("least squares line through (1,2), (2,3), (3,5) → refusal pointing at Sketch data / Stats regression", () => {
    const r = refusal("least squares line through (1,2), (2,3), (3,5)");
    expect(r).toContain("Sketch data → function");
    expect(r).toContain("Stats mode regression");
    expect(r).toContain("INTERPOLANT passes through every point");
  });
  it("fit without through, regression, best fit → the same refusal", () => {
    expect(refusal("fit a quadratic to (1,2), (2,3), (3,5)")).toContain("A FIT is least squares");
    expect(refusal("regression line for (1,2), (2,3), (3,5)")).toContain("A FIT is least squares");
    expect(refusal("best fit line (1,2), (2,3), (3,5)")).toContain("A FIT is least squares");
  });
  it("bare `interpolate` → usage refusal", () => {
    expect(refusal("interpolate")).toContain("Give the points to interpolate");
  });
});

describe("display contract and figure", () => {
  const ALL = [
    "interpolate (1, 2), (2, 3), (4, 7) at x = 3",
    "lagrange polynomial through (0, 1), (1, 3), (2, 2) at x = 1.5",
    "neville's method (0,1), (1,3), (2,2) at x = 1.5",
    "newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)",
    "degree 3 polynomial through (-1, 0), (0, 1), (1, 0), (2, 5)",
    "interpolate points (1, 2.5), (2, 3.75), (3, 1.2)",
    "interpolating polynomial for f(x) = 1/x at x = 1, 2, 4",
    "linear interpolation between (1, 10) and (3, 20) at x = 2",
    "error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic",
  ];
  it("every math line's right-hand side re-parses through the Solve grammar, with one minus convention", () => {
    for (const q of ALL) {
      for (const l of mathLines(q)) {
        const sides = l.split(" = ");
        for (const side of sides.slice(l.startsWith("L") || l.startsWith("p(") || l.startsWith("w(") ? 1 : 0)) {
          expect(() => parseExpr(side)).not.toThrow();
        }
        expect(l.includes("−")).toBe(false);
      }
    }
  });
  it("the explicit polynomial and the Newton form are the same function", () => {
    for (const q of ALL.slice(0, 7)) {
      const m = mathLines(q).filter((t) => t.startsWith("p(x) = ")).map(rhs);
      expect(m.length).toBe(2);
      for (const x of [-1.3, 0.2, 0.7, 1.9, 3.1, 4.4]) expect(num(m[1].replace(/x/g, `(${x})`))).toBeCloseTo(num(m[0].replace(/x/g, `(${x})`)), 9);
    }
  });
  it("a 12-point interpolant's svg title fits the canvas (the figure gate's estimate: chars × 13 px × 0.58, centred on the 380 px frame)", () => {
    const q = "interpolate (-5, 1/26), (-4, 1/17), (-3, 1/10), (-2, 1/5), (-1, 1/2), (0, 1), (1, 1/2), (2, 1/5), (3, 1/10), (4, 1/17), (5, 1/26), (6, 1/37) at x = 4.5";
    const v = run(q);
    const title = /<text x="190" y="16" text-anchor="middle"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/.exec(v.svg!)?.[1];
    expect(title).toBe("Interpolating polynomial through 12 points");
    expect(title!.length * 13 * 0.58).toBeLessThanOrEqual(380);
    expect(title).not.toContain("p(x) =");
    // The polynomial itself stays in the result lines.
    expect(mathLines(q)[0]).toMatch(/^p\(x\) = /);
  });
  it("no verb figure in this file carries a title wider than the frame", () => {
    for (const q of ALL) {
      const v = run(q);
      if (!v.svg) continue;
      const title = /<text x="190" y="16" text-anchor="middle"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/.exec(v.svg)?.[1] ?? "";
      expect(title.length * 13 * 0.58).toBeLessThanOrEqual(380);
    }
  });
  it("the figure is there: a curve, the points, the query point", () => {
    const v = run("interpolate (1, 2), (2, 3), (4, 7) at x = 3");
    expect(v.svg).toMatch(/^<svg/);
    expect(v.svg).toContain("p(3) = 14/3");
    expect(v.svg).toContain("3 points");
    expect(v.alt).toContain("p(3)");
    expect(v.plot).toBeUndefined();
  });
});

describe("the guard", () => {
  it("claims every §D interpolation input and no equation", () => {
    for (const q of [
      "interpolate (1, 2), (2, 3), (4, 7)",
      "lagrange polynomial through (0, 1), (1, 3), (2, 2)",
      "neville's method (0,1), (1,3), (2,2) at x = 1.5",
      "newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)",
      "x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial",
      "polynomial through (0, 0), (1, 1), (2, 4), (3, 9)",
      "degree 3 polynomial through (-1, 0), (0, 1), (1, 0), (2, 5)",
      "interpolating polynomial for f(x) = 1/x at x = 1, 2, 4",
      "linear interpolation between (1, 10) and (3, 20) at x = 2",
      "linearly interpolate at x = 2.5 from (2, 4) and (3, 9)",
      "estimate f(2.5) given f(2) = 4, f(3) = 9 by linear interpolation",
      "error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic",
      "line through (1, 2) and (3, 8)",
      "interpolation table x 1 2 4 y 2 3 7",
    ]) expect(INTERP_VERB_RE.test(q)).toBe(true);
    for (const q of ["x^2 - 5x + 6 = 0", "maximize 3x + 2y subject to x + y <= 4", "natural cubic spline through (0, 0), (1, 1), (2, 0)", "x = 3"]) {
      expect(INTERP_VERB_RE.test(q)).toBe(false);
      expect(tryInterpolate(q)).toBeNull();
    }
  });
});
