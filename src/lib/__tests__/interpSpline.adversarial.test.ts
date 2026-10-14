/**
 * Adversarial pass over the interpolation and spline verbs (house rule: a separate
 * hostile pass, not the author's happy paths). Degenerate and hostile inputs, the
 * name=number steal, limits at the boundary, extrapolation SAID, and — for every
 * spline — an INDEPENDENT numeric check: the printed piece polynomials are re-parsed
 * through the CAS and evaluated at 20 points per piece against the exact M-form
 * evaluation from the engine's own piece objects.
 */
import { parseExpr, evalAst } from "../solve";
import { tryInterpolate } from "../interpolate";
import { trySpline, buildSpline, pieceEval, SplineKind } from "../spline";
import { readPointList, isPointRefusal } from "../pointList";
import { ratToNumber, ratFromNumber, parseRatLiteral, Rat } from "../cas";

const ask = (q: string) => tryInterpolate(q) ?? trySpline(q);
const run = (q: string) => {
  const v = ask(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string): string => {
  const v = ask(q);
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered, not refused: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string): string => run(q).lines.map((l) => l.text).join("\n");
const caveats = (q: string): string => run(q).caveats.join(" | ");
const mathLines = (q: string): string[] => run(q).lines.filter((l) => l.math).map((l) => l.text);
const poly = (q: string): string => {
  const l = mathLines(q).find((t) => t.startsWith("p(x) = "));
  if (!l) throw new Error("no p(x) line in\n" + text(q));
  return l.slice("p(x) = ".length);
};
const val = (fn: string, q: string): string => {
  // The argument may carry one level of brackets (p(sqrt(2))); `p(x) = …` is the definition, not a value.
  const re = new RegExp(`^${fn}\\(((?:[^()]|\\([^()]*\\))+)\\) = (.*)$`);
  const l = mathLines(q).find((t) => re.test(t) && re.exec(t)![1] !== "x");
  if (!l) throw new Error(`no ${fn}(v) line in\n` + text(q));
  return re.exec(l)![2];
};
const num = (s: string, x: number): number => evalAst(parseExpr(s), { x });
const pieces = (q: string): { lo: number; hi: number; S: string }[] => {
  const out: { lo: number; hi: number; S: string }[] = [];
  const ls = run(q).lines;
  for (let i = 0; i + 1 < ls.length; i++) {
    const m = /^Piece \d+, on \[([^,]+), ([^\]]+)\]:$/.exec(ls[i].text);
    if (m && ls[i + 1].math) out.push({ lo: ratToNumber(parseRatLiteral(m[1])!), hi: ratToNumber(parseRatLiteral(m[2])!), S: ls[i + 1].text.slice("S(x) = ".length) });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Independent numeric check of every printed spline against the M-form engine.
// ---------------------------------------------------------------------------

describe("every printed spline piece re-parses and matches the M-form evaluation at 20 points per piece", () => {
  const CASES: [string, SplineKind, { m0: string; m1: string } | undefined][] = [
    ["natural cubic spline through (0, 0), (1, 1), (2, 0)", "natural", undefined],
    ["natural cubic spline through (0, 1), (1, 3), (2, 2), (3, 4)", "natural", undefined],
    ["cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends", "natural", undefined],
    ["cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0", "natural", undefined],
    ["smooth curve through the points (0, 0), (1, 2), (2, 1), (3, 3)", "natural", undefined],
    ["natural cubic spline through (-2, 1), (-1, -3), (0.5, 2), (3, 0), (7, 7)", "natural", undefined],
    ["natural cubic spline through (0.1, 0), (0.2, 1), (0.3, 0), (0.7, 5)", "natural", undefined],
    ["clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1", "clamped", { m0: "1", m1: "-1" }],
    ["cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0", "clamped", { m0: "0", m1: "0" }],
    ["clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1000000, S'(2) = -1000000", "clamped", { m0: "1000000", m1: "-1000000" }],
    ["clamped cubic spline through (0, 0), (1, 1) with S'(0) = 0, S'(1) = 0", "clamped", { m0: "0", m1: "0" }],
    ["not-a-knot spline through (0,1), (1,3), (2,2), (3,4)", "not-a-knot", undefined],
    ["not-a-knot spline through (0,1), (1,3), (2,2), (3,4), (5, -1), (6, 2)", "not-a-knot", undefined],
    ["linear spline through (0, 0), (1, 2), (3, 1)", "linear", undefined],
    ["pchip (0, 0), (1, 1), (2, 1), (3, 2)", "pchip", undefined],
    ["pchip (0, 0), (1, 1), (2, 0)", "pchip", undefined],
    ["pchip (0, 0), (1, 1), (3, 5), (4, 5.5), (6, 9)", "pchip", undefined],
  ];
  for (const [q, kind, clamp] of CASES) {
    it(q, () => {
      const pl = readPointList(q.replace(/with S'.*$|with end slopes.*$/, ""));
      if (!pl || isPointRefusal(pl)) throw new Error("points not read");
      const s = buildSpline(pl.xs, pl.ys, kind, clamp ? { m0: parseRatLiteral(clamp.m0)!, m1: parseRatLiteral(clamp.m1)! } : undefined);
      if (typeof s === "string") throw new Error(s);
      const printed = pieces(q);
      expect(printed.length).toBe(s.pieces.length);
      printed.forEach((p, i) => {
        expect(p.lo).toBe(ratToNumber(s.pieces[i].x0));
        expect(p.hi).toBe(ratToNumber(s.pieces[i].x1));
        for (let k = 0; k <= 20; k++) {
          const x = p.lo + ((p.hi - p.lo) * k) / 20;
          const exact = ratToNumber(pieceEval(s.pieces[i], ratFromNumber(x)));
          const parsed = num(p.S, x);
          expect(Math.abs(parsed - exact)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(exact)));
        }
      });
      // And the knots themselves: S(x_i) = y_i from the printed strings.
      pl.xs.forEach((x, i) => {
        const p = printed[Math.min(i, printed.length - 1)];
        expect(num(p.S, ratToNumber(x))).toBeCloseTo(ratToNumber(pl.ys[i]), 6);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Hostile and degenerate inputs.
// ---------------------------------------------------------------------------

describe("the name=number steal and bare verbs", () => {
  it("`interpolate … at x = 1.5` answers p(3/2), never \"x = 3/2\"", () => {
    const q = "interpolate (0, 1), (1, 3), (2, 2) at x = 1.5";
    expect(val("p", q)).toBe("23/8");
    expect(text(q)).not.toMatch(/^x = 3\/2$/m);
  });
  it("`spline … at x = 0.5` answers S(1/2), never \"x = 1/2\"", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0) at x = 0.5";
    expect(val("S", q)).toBe("11/16");
    expect(text(q)).not.toMatch(/^x = 1\/2$/m);
  });
  it("`S(0.5) = ?` and `find S(0.5)` are queries, not points", () => {
    expect(val("S", "natural cubic spline through (0,0), (1,1), (2,0), S(0.5) = ?")).toBe("11/16");
    expect(val("S", "natural cubic spline through (0,0), (1,1), (2,0) find S(0.5)")).toBe("11/16");
  });
  it("bare `spline`, `cubic spline`, `interpolate`, `lagrange` → usage refusals", () => {
    expect(refusal("spline")).toContain("Give the knots");
    expect(refusal("cubic spline")).toContain("Give the knots");
    expect(refusal("interpolate")).toContain("Give the points");
    expect(refusal("lagrange interpolation")).toContain("Give the points");
    expect(refusal("spline")).not.toContain("spline = 0");
  });
  it("a negative query point parses as a number, not a minus sign on the list", () => {
    expect(val("p", "interpolate (0, 0), (1, 1), (2, 4) at x = -1")).toBe("1");
  });
  it("a function sampled at nodes AND a query: the node list is not the query", () => {
    const q = "interpolate f(x) = x^2 at x = 0, 1, 2 at x = 1.5";
    expect(poly(q)).toBe("x^2");
    expect(val("p", q)).toBe("9/4");
  });
});

describe("limits at the boundary", () => {
  const spaced = (n: number): string => Array.from({ length: n }, (_, i) => `(${i}, ${i * i})`).join(", ");
  it("12 points interpolate; 13 → Runge refusal naming splines", () => {
    expect(poly(`interpolate ${spaced(12)}`)).toBe("x^2");
    expect(text(`interpolate ${spaced(12)}`)).toContain("Degree 2, not 11");
    const r = refusal(`interpolate ${spaced(13)}`);
    expect(r).toMatch(/13 points: Runge/);
    expect(r).toContain("spline");
  });
  it("50 knots build; 51 → refusal by name", () => {
    const knots = (n: number): string => Array.from({ length: n }, (_, i) => `(${i}, ${i % 3})`).join(", ");
    const t0 = Date.now();
    const v = run(`natural cubic spline through ${knots(50)}`);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(v.title).toBe("Natural cubic spline, 50 knots, 49 pieces");
    expect(v.svg).toMatch(/^<svg/);
    expect(refusal(`natural cubic spline through ${knots(51)}`)).toMatch(/51 knots: up to 50/);
  });
  it("one point → refusal; two points → the chord for every non-clamped kind", () => {
    expect(refusal("interpolate (1, 2)")).toMatch(/One point \(1, 2\)/);
    expect(refusal("smooth curve through the points (1, 2)")).toMatch(/One point/);
    for (const q of ["natural cubic spline through (0, 0), (2, 1)", "pchip (0, 0), (2, 1)", "not-a-knot spline through (0, 0), (2, 1)", "linear spline through (0, 0), (2, 1)"]) {
      expect(mathLines(q)).toEqual(["S(x) = 1/2*x"]);
      expect(text(q)).toContain("the chord");
    }
  });
  it("not-a-knot needs 4 knots: 3 → refusal by name pointing at the parabola", () => {
    expect(refusal("not-a-knot spline through (0,0), (1,1), (2,0)")).toMatch(/Not-a-knot needs at least 4 knots/);
  });
  it("huge rationals stay exact in the printed polynomial", () => {
    const big = "123456789012345678901234567890";
    const q = `interpolate (0, 0), (1, ${big}), (2, ${big}0)`;
    const p = poly(q);
    // (0, 0), (1, N), (2, 10N): p(x) = 4N*x^2 - 3N*x, every digit exact.
    expect(p).toBe("493827156049382715604938271560*x^2 - 370370367037037036703703703670*x");
    expect(() => parseExpr(p)).not.toThrow();
    expect(caveats(q)).toContain("p(x_i) = y_i for every point");
  });
  it("a tiny decimal step: 0.1 is 1/10 and the parabola is exact", () => {
    expect(poly("interpolate (0.1, 1), (0.2, 2), (0.3, 3)")).toBe("10*x");
    expect(poly("interpolate (0.1, 0.01), (0.2, 0.04), (0.3, 0.09)")).toBe("x^2");
  });
});

describe("degenerate geometry, order and duplicates", () => {
  it("colinear points: degree 1, not 3, said", () => {
    const q = "polynomial through (0, 0), (1, 1), (2, 2), (3, 3)";
    expect(poly(q)).toBe("x");
    expect(text(q)).toContain("Degree 1, not 3: the 4 points lie on a line.");
  });
  it("all the same y: degree 0, the constant", () => {
    const q = "interpolate (0, 5), (1, 5), (2, 5)";
    expect(poly(q)).toBe("5");
    expect(text(q)).toContain("Degree 0, not 2");
  });
  it("negative and zero x: pieces print (x + 2) and x", () => {
    expect(poly("interpolate (-2, 4), (0, 0), (2, 4)")).toBe("x^2");
    const ps = pieces("natural cubic spline through (-2, 0), (0, 1), (2, 0)");
    expect(ps[0].S).toMatch(/\(x \+ 2\)/);
    expect(ps[1].S).not.toContain("(x - 0)");
  });
  it("unsorted knots are sorted and SAID; the spline is the sorted one", () => {
    const q = "spline (2, 0), (0, 0), (1, 1) at 0.5";
    expect(val("S", q)).toBe("11/16");
    expect(caveats(q)).toContain("Points sorted by x (typed order was x = 2, 0, 1).");
  });
  it("a repeated identical point is dropped and SAID; a repeated x with another y is refused", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0), (1, 1)";
    expect(run(q).title).toBe("Natural cubic spline, 3 knots, 2 pieces");
    expect(caveats(q)).toContain("(1, 1) was listed twice — kept once.");
    expect(refusal("natural cubic spline through (0, 0), (1, 1), (2, 0), (1, 2)")).toMatch(/x = 1 appears twice \(y = 1 and y = 2\)/);
    expect(refusal("interpolate (0.5, 1), (1/2, 2)")).toMatch(/x = 1\/2 appears twice/);
  });
  it("a non-numeric coordinate is refused by name, not read as a variable", () => {
    expect(refusal("interpolate (pi, 1), (2, 3)")).toMatch(/coordinate pi/);
    expect(refusal("natural cubic spline through (a, 1), (2, 3), (3, 1)")).toMatch(/coordinate a/);
  });
});

describe("extrapolation is SAID", () => {
  it("a query outside the nodes — interpolant", () => {
    const q = "interpolate (1, 2), (2, 3), (4, 7) at x = 10";
    expect(val("p", q)).toBe("35");
    expect(caveats(q)).toContain("x = 10 is OUTSIDE the nodes [1, 4]: this is extrapolation");
  });
  it("a query outside the knots — spline, the end piece continued", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0) at x = 5";
    // piece 2 continued: 1 - 3/2·4^2 + 1/2·4^3 = 9
    expect(val("S", q)).toBe("9");
    expect(caveats(q)).toContain("x = 5 is OUTSIDE the knots [0, 2]: this is EXTRAPOLATION");
    const q2 = "natural cubic spline through (0, 0), (1, 1), (2, 0) at x = -1";
    expect(val("S", q2)).toBe("-1");
    expect(caveats(q2)).toContain("EXTRAPOLATION");
  });
  it("linear interpolation outside the pair", () => {
    const q = "linear interpolation between (1, 10) and (3, 20) at x = 5";
    expect(val("p", q)).toBe("30");
    expect(caveats(q)).toContain("linear EXTRAPOLATION");
  });
  it("a query inside is not flagged", () => {
    expect(caveats("interpolate (1, 2), (2, 3), (4, 7) at x = 3")).not.toContain("extrapolation");
    expect(caveats("natural cubic spline through (0, 0), (1, 1), (2, 0) at x = 2")).not.toContain("EXTRAPOLATION");
  });
});

describe("clamped end conditions", () => {
  it("enormous slopes are exact and verified", () => {
    const q = "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1000000, S'(2) = -1000000";
    expect(text(q)).toContain("S'(0) = 1000000, S'(2) = -1000000");
    expect(caveats(q)).toContain("S'(0) = 1000000 and S'(2) = -1000000");
    const ps = pieces(q);
    const h = 1e-7;
    expect((num(ps[0].S, h) - num(ps[0].S, 0)) / h).toBeCloseTo(1000000, 0);
  });
  it("slopes given in reverse knot order are matched to their knots", () => {
    const q = "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(2) = -1, S'(0) = 1";
    expect(/M = \(([^)]*)\)/.exec(text(q))![1]).toBe("2, -4, 2");
  });
  it("slopes at a non-end knot → refusal by name", () => {
    expect(refusal("clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(1) = -1")).toMatch(/must be given at the two END knots x = 0 and x = 2/);
  });
  it("clamped without slopes → refusal naming the syntax; one slope → refusal", () => {
    expect(refusal("clamped cubic spline through (0, 0), (1, 1), (2, 0)")).toMatch(/needs both end slopes/);
    expect(refusal("clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1")).toMatch(/exactly two end slopes; 1 given/);
  });
  it("slopes given but the spline named natural → refusal, say which", () => {
    expect(refusal("natural cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1")).toMatch(/named natural .* CLAMPED/);
  });
  it("clamped through two knots is the Hermite cubic, not the chord", () => {
    const q = "clamped cubic spline through (0, 0), (1, 1) with S'(0) = 0, S'(1) = 0";
    expect(mathLines(q)).toEqual(["S(x) = 3*x^2 - 2*x^3"]);
  });
  it("the clamped tangents are drawn only for clamped splines", () => {
    expect(run("clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1").svg).toContain("end tangents");
    expect(run("pchip (0, 0), (1, 1), (2, 1), (3, 2)").svg).not.toContain("end tangents");
  });
});

describe("kinds refused by name", () => {
  it("quadratic, periodic, parametric, 2-D, triples", () => {
    expect(refusal("quadratic spline through (0,0), (1,1), (2,0)")).toMatch(/^Quadratic splines are not built here/);
    expect(refusal("periodic spline through (0,0), (1,1), (2,0)")).toMatch(/^Periodic splines/);
    expect(refusal("parametric spline through (0,0), (1,1), (2,0)")).toMatch(/Parametric/);
    expect(refusal("2D spline through (0,0), (1,1), (2,0)")).toMatch(/Parametric \/ 2-D/);
    expect(refusal("cubic spline through (0, 0, 1), (1, 1, 2), (2, 0, 3)")).toMatch(/three coordinates/);
  });
});

describe("PCHIP", () => {
  it("three knots that turn: the turning knot gets slope 0 and the ends the MATLAB estimate", () => {
    const q = "pchip (0, 0), (1, 1), (2, 0)";
    expect(text(q)).toContain("Slopes at the knots: d = (2, 0, -2)");
    expect(caveats(q)).toContain("every piece is monotone");
    expect(caveats(q)).toContain("C¹: PCHIP does not make S'' continuous");
  });
  it("monotone data stay monotone on every piece (sampled S')", () => {
    const q = "monotone cubic interpolation of (0, 0), (1, 1), (3, 5), (4, 5.5), (6, 9)";
    for (const p of pieces(q)) {
      for (let k = 0; k < 20; k++) {
        const a = p.lo + ((p.hi - p.lo) * k) / 20, b = p.lo + ((p.hi - p.lo) * (k + 1)) / 20;
        expect(num(p.S, b)).toBeGreaterThanOrEqual(num(p.S, a) - 1e-12);
      }
    }
  });
});

describe("linear interpolation edge cases", () => {
  it("more than two points: the bracketing pair is used and SAID; without a query, refused by name", () => {
    const q = "linear interpolation (0, 0), (1, 10), (2, 0) at x = 1.5";
    expect(val("p", q)).toBe("5");
    expect(caveats(q)).toContain("Used the two nodes bracketing x = 3/2: (1, 10) and (2, 0).");
    expect(refusal("linear interpolation (0, 0), (1, 10), (2, 0)")).toMatch(/add `at x = v`/);
  });
  it("a horizontal pair has no proportion line (it would divide by zero) and says so", () => {
    const q = "linear interpolation between (1, 5) and (3, 5) at x = 2";
    expect(val("p", q)).toBe("5");
    expect(text(q)).toContain("horizontal");
    expect(mathLines(q)).not.toContain("(x - 1)/(3 - 1) = (y - 5)/(5 - 5)");
  });
});

describe("requested degree vs the data", () => {
  it("degree 2 through 4 non-parabolic points → refusal naming the actual degree", () => {
    expect(refusal("degree 2 polynomial through (0,0), (1,1), (2,4), (3,10)")).toMatch(/No polynomial of degree 2 passes through these 4 points — the interpolant has degree 3/);
  });
  it("degree 5 through 3 points → not unique, refusal", () => {
    expect(refusal("degree 5 polynomial through (0,0), (1,1), (2,4)")).toMatch(/3 points fix a polynomial of degree ≤ 2/);
  });
  it("quadratic through 3 points on a line: satisfied with a zero leading coefficient, said", () => {
    const q = "quadratic through (0, 0), (1, 1), (2, 2)";
    expect(poly(q)).toBe("x");
    expect(text(q)).toContain("zero leading coefficient");
  });
});

describe("error bound — hostile functions", () => {
  it("1/x at 1, 2, 4: M = 6 from the exact endpoint, max|w| exact in ℚ(√Δ)", () => {
    const q = "error bound for interpolating 1/x at x = 1, 2, 4";
    const v = run(q);
    expect(text(q)).toContain("M = 6: |-6/x^4| is largest at an endpoint of [1, 4]");
    expect(v.lines[0].math).toBe(true);
    expect(() => parseExpr(v.lines[0].text)).not.toThrow();
    // max|w| for (x-1)(x-2)(x-4) on [1,4] is at x = (7 + sqrt(7))/3 ≈ 3.215: |w| ≈ 2.1126.
    expect(evalAst(parseExpr(v.lines[0].text), {})).toBeCloseTo(2.1126, 3);
  });
  it("a derivative with a pole inside the node interval → refusal by name", () => {
    expect(refusal("error bound for interpolating 1/x at x = 0, 1, 2")).toMatch(/not finite at x/);
  });
  it("degree word that disagrees with the node count → refusal", () => {
    expect(refusal("error bound for interpolating sin(x) at x = 0, 0.5, 1 with a cubic")).toMatch(/3 nodes give a degree-2 interpolant, not degree 3/);
  });
  it("a polynomial of lower degree than the interpolant: the bound is exactly 0", () => {
    const q = "error bound for interpolating x^2 at x = 0, 1, 2";
    expect(run(q).lines[0].text).toBe("0");
  });
  it("four nodes: the critical points are not all rational, so max|w| is numeric and SAID", () => {
    const q = "error bound for interpolating cos(x) at x = 0, 1, 2, 3";
    expect(caveats(q)).toContain("numeric search");
    expect(text(q)).toContain("M = 1");
    // max |x(x-1)(x-2)(x-3)| on [0,3] is 1 (at x = (3 ± sqrt(5))/2); bound = 1/24.
    // A numeric bound is never a bare decimal under an exactness heading: the first
    // line is TEXT, labelled ≈ on the same line, and there is no math line for it.
    const first = run(q).lines[0];
    expect(first.math).toBeUndefined();
    expect(first.text).toMatch(/^≈ 0\.0416667 \(numeric bound/);
    expect(Number(/≈ ([\d.e+-]+)/.exec(first.text)![1])).toBeCloseTo(1 / 24, 5);
  });
});

describe("methods and shapes", () => {
  it("`using lagrange` prints the basis; `using newton` the table; neville without a query says so", () => {
    expect(mathLines("interpolate (1, 2), (2, 3), (4, 7) using lagrange")).toContain("L0(x) = (x - 2)*(x - 4)/3");
    expect(run("interpolate (1, 2), (2, 3), (4, 7) using newton").title).toBe("Newton divided differences through 3 points");
    expect(caveats("neville's method (0,1), (1,3), (2,2)")).toContain("add `at x = v`");
  });
  it("pasted table rows under the verb", () => {
    expect(poly("interpolate\n1 2\n2 3\n4 7")).toBe("1/3*x^2 + 5/3");
    expect(run("natural cubic spline\nx y\n0 0\n1 1\n2 0").title).toBe("Natural cubic spline, 3 knots, 2 pieces");
  });
  it("scientific notation and Unicode minus", () => {
    expect(poly("interpolate (1e1, 1), (2e1, 2)")).toBe("1/10*x");
    expect(poly("interpolate (−1, 1), (0, 0), (1, 1)")).toBe("x^2");
  });
  it("no math line ever carries U+2212, and every one re-parses", () => {
    for (const q of [
      "interpolate (−1, 1), (0, 0), (1, 1) at x = −2",
      "natural cubic spline through (−2, 0), (0, 1), (2, 0) at x = −1",
      "error bound for interpolating sin(x) at x = 0, 0.5, 1",
    ]) {
      for (const l of mathLines(q)) {
        expect(l.includes("−")).toBe(false);
        expect(() => parseExpr(l.replace(/^[A-Za-z]\d?\([^)]*\) = /, ""))).not.toThrow();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Review round: symbolic and multiple query points, routing, cosmetic.
// ---------------------------------------------------------------------------

describe("symbolic and multiple query points are never dropped silently", () => {
  it("at x = pi: p(π) exact as a polynomial in pi, plus ≈", () => {
    const q = "interpolate (0, 1), (1, 3), (2, 2) at x = pi";
    const v = val("p", q);
    expect(v).toMatch(/pi/);
    expect(evalAst(parseExpr(v), { pi: Math.PI })).toBeCloseTo(-1.5 * Math.PI ** 2 + 3.5 * Math.PI + 1, 10);
    expect(text(q)).toContain("≈ " + Number((-1.5 * Math.PI ** 2 + 3.5 * Math.PI + 1).toPrecision(6)));
    expect(caveats(q)).toContain("x = pi is OUTSIDE the nodes [0, 2]");
  });
  it("at x = sqrt(2): exact in sqrt(2) through the CAS", () => {
    const v = val("p", "interpolate (0, 1), (1, 3), (2, 2) at x = sqrt(2)");
    expect(evalAst(parseExpr(v), {})).toBeCloseTo(-1.5 * 2 + 3.5 * Math.SQRT2 + 1, 10);
    expect(v).toContain("sqrt(2)");
  });
  it("a point with no exact closed form (sin(1)) is refused BY NAME, the polynomial still shown", () => {
    const q = "interpolate (0, 1), (1, 3), (2, 2) at x = sin(1)";
    expect(poly(q)).toBe("-3/2*x^2 + 7/2*x + 1");
    expect(caveats(q)).toContain("The query point sin(1) is not a rational number and has no exact closed form here");
    expect(mathLines(q).some((l) => /^p\(sin/.test(l))).toBe(false);
  });
  it("two query points: both answered, both marked", () => {
    const q = "interpolate (0, 1), (1, 3), (2, 2) at x = 1.5 and x = 2.5";
    const m = mathLines(q);
    expect(m).toContain("p(3/2) = 23/8");
    // -3/2·25/4 + 7/2·5/2 + 1 = 3/8
    expect(m).toContain("p(5/2) = 3/8");
    expect(run(q).svg).toContain("p(5/2) = 3/8");
    expect(caveats(q)).toContain("x = 5/2 is OUTSIDE");
  });
  it("spline at x = pi: the end piece continued, exact in pi, extrapolation said", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0) at x = pi";
    const v = val("S", q);
    expect(v).toMatch(/pi/);
    const u = Math.PI - 1;
    expect(evalAst(parseExpr(v), { pi: Math.PI })).toBeCloseTo(1 - 1.5 * u * u + 0.5 * u ** 3, 10);
    expect(caveats(q)).toContain("x = pi is OUTSIDE the knots [0, 2]");
  });
  it("spline with two points: `at 0.5 and x = 1.5`", () => {
    const m = mathLines("natural cubic spline through (0, 0), (1, 1), (2, 0) at 0.5 and x = 1.5");
    expect(m).toContain("S(1/2) = 11/16");
    expect(m).toContain("S(3/2) = 11/16");
  });
  it("a node list after a query is still a node list", () => {
    expect(poly("interpolate f(x) = x^2 at x = 0, 1, 2 at x = pi")).toBe("x^2");
    expect(val("p", "interpolate f(x) = x^2 at x = 0, 1, 2 at x = pi")).toBe("pi^2");
  });
});

describe("routing: lines that are not this verb's", () => {
  it("line geometry (slope / parallel / perpendicular) returns null", () => {
    expect(tryInterpolate("line through (1,2) with slope 3")).toBeNull();
    expect(tryInterpolate("line through (1,2) parallel to y = 2x")).toBeNull();
    expect(tryInterpolate("line through (1, 2) perpendicular to y = 2x + 1")).toBeNull();
  });
  it("a variable named after the verb, in an equation, returns null", () => {
    expect(tryInterpolate("interpolate = 3")).toBeNull();
    expect(tryInterpolate("interpolation = 2x + 1")).toBeNull();
    expect(trySpline("spline = 2")).toBeNull();
    expect(trySpline("spline = 2")).toBeNull();
  });
  it("B-spline basis functions are refused BY NAME", () => {
    expect(refusal("b-spline basis functions of degree 2")).toMatch(/^B-spline basis functions .* are not built here/);
    expect(refusal("B-spline of degree 3")).toMatch(/B-spline/);
  });
});

describe("error bound cosmetics", () => {
  it("e^x: ln(e) is folded; M = e (monotone exponential, right endpoint) is exact; bound e/8", () => {
    const q = "error bound for interpolating e^x at x = 0, 1";
    expect(mathLines(q).some((l) => /ln\(e\)/.test(l))).toBe(false);
    // The CAS writes e^x as exp(x); M = exp(1) is exact (not a sampled 2.71828).
    expect(text(q)).toMatch(/M = (?:exp\(1\)|e) ≈ 2\.71828: (?:exp\(x\)|e\^x) is monotone/);
    expect(caveats(q)).not.toContain("not a theorem");
    const first = run(q).lines[0];
    expect(first.math).toBe(true);
    expect(first.text).toMatch(/^(?:exp\(1\)|e)\/8$/);
    expect(evalAst(parseExpr(first.text), { e: Math.E })).toBeCloseTo(Math.E / 8, 12);
  });
  it("e^x at three nodes: M = e^2", () => {
    const q = "error bound for interpolating e^x at x = 0, 1, 2";
    expect(text(q)).toMatch(/M = (?:exp\(2\)|e\^2) ≈ 7\.38906/);
    expect(run(q).lines[0].math).toBe(true);
    expect(evalAst(parseExpr(run(q).lines[0].text), { e: Math.E })).toBeCloseTo((Math.E ** 2 / 6) * (2 / (3 * Math.sqrt(3))), 8);
  });
  it("1/x: the text line parenthesises the sum max|w|", () => {
    const l = run("error bound for interpolating 1/x at x = 1, 2, 4").lines.map((x) => x.text).find((t) => t.startsWith("|f(x) - p(x)| ≤"))!;
    expect(l).toMatch(/· \(20\/27 \+ \(14\*sqrt\(7\)\)\/27\) =/);
  });
});

/** Rat → number helper kept for readability in the numeric checks. */
export const toNum = (r: Rat): number => ratToNumber(r);
