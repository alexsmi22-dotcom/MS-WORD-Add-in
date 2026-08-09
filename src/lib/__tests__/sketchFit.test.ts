// Sketch data → function (src/lib/sketchFit.ts) — oracle tests.
//
// The two claims that matter: (1) known-generator data recovers its generator
// with R² ≈ 1 and a RE-PARSEABLE expression; (2) every refusal and skip is
// named, never a force-fit through an invalid transform.

import { fitSketch, SketchPt } from "../sketchFit";
import { sketchSurfaceSvg, sketchFitSvg, skSnapPt } from "../sketchChart";
import { parseExpr, evalAst } from "../solve";

const P = (list: [number, number][]): SketchPt[] => list.map(([x, y]) => ({ x, y }));

const fitOf = (out: ReturnType<typeof fitSketch>, model: string) => {
  const f = out.fits.find((x) => x.model === model);
  expect(f).toBeDefined();
  return f!;
};

describe("known generators are recovered", () => {
  test("a perfect line: linear fit R² = 1, expression evaluates back exactly", () => {
    const out = fitSketch(P([[-2, -3], [0, 1], [1, 3], [3, 7]])); // y = 2x + 1
    const lin = fitOf(out, "linear");
    expect(lin.r2).toBeCloseTo(1, 9);
    const ast = parseExpr(lin.expr);
    expect(evalAst(ast, { x: 5 })).toBeCloseTo(11, 6);
    // …and the ranking puts the line at (or tied for) the top by adjusted R².
    expect(out.fits[0].adjR2).toBeCloseTo(1, 9);
  });

  test("a parabola: quadratic recovers y = x² − 2x + 0.5", () => {
    const gen = (x: number): number => x * x - 2 * x + 0.5;
    const out = fitSketch(P([-2, -1, 0, 1, 2, 3].map((x) => [x, gen(x)] as [number, number])));
    const q = fitOf(out, "quadratic");
    expect(q.r2).toBeCloseTo(1, 6);
    const ast = parseExpr(q.expr);
    expect(evalAst(ast, { x: 4 })).toBeCloseTo(gen(4), 3);
  });

  test("exponential data recovers a·e^(bx), with the log-weighting caveat", () => {
    const gen = (x: number): number => 2 * Math.exp(0.5 * x);
    const out = fitSketch(P([0, 1, 2, 3, 4].map((x) => [x, gen(x)] as [number, number])));
    const e = fitOf(out, "exponential");
    expect(e.r2).toBeCloseTo(1, 4);
    expect(e.caveats.join(" ")).toMatch(/log/);
    expect(evalAst(parseExpr(e.expr), { x: 5 })).toBeCloseTo(gen(5), 1);
  });

  test("power data recovers a·x^b with a PARENTHESISED exponent", () => {
    const gen = (x: number): number => 3 * Math.pow(x, 1.5);
    const out = fitSketch(P([1, 2, 3, 4].map((x) => [x, gen(x)] as [number, number])));
    const pw = fitOf(out, "power");
    expect(pw.expr).toMatch(/x\^\(/);
    expect(pw.r2).toBeCloseTo(1, 4);
  });

  test("a negative power exponent still re-parses (the x^-0.5 trap)", () => {
    const gen = (x: number): number => 4 / Math.sqrt(x);
    const out = fitSketch(P([1, 2, 4, 8].map((x) => [x, gen(x)] as [number, number])));
    const pw = fitOf(out, "power");
    expect(() => parseExpr(pw.expr)).not.toThrow();
    expect(evalAst(parseExpr(pw.expr), { x: 9 })).toBeCloseTo(gen(9), 1);
  });

  test("logarithmic data recovers a + b·ln x", () => {
    const gen = (x: number): number => 1 + 2 * Math.log(x);
    const out = fitSketch(P([1, 2, 4, 8].map((x) => [x, gen(x)] as [number, number])));
    const lg = fitOf(out, "logarithmic");
    expect(lg.r2).toBeCloseTo(1, 6);
  });
});

describe("honesty: the R² shown belongs to the expression shown", () => {
  test("every fit's reported R² is reproducible from its own expr string", () => {
    const pts = P([[-3, 2.1], [-1, 0.4], [0, 0.2], [1, 0.9], [2, 3.1], [3, 6.8]]);
    const out = fitSketch(pts);
    expect(out.fits.length).toBeGreaterThan(1);
    for (const fit of out.fits) {
      const ast = parseExpr(fit.expr); // must not throw
      const mean = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      let ssRes = 0, ssTot = 0;
      for (const p of pts) {
        const yh = evalAst(ast, { x: p.x });
        ssRes += (p.y - yh) ** 2;
        ssTot += (p.y - mean) ** 2;
      }
      expect(1 - ssRes / ssTot).toBeCloseTo(fit.r2, 9);
    }
  });

  test("interpolation is named: 3 points, quadratic — 'not evidence of the model'", () => {
    const out = fitSketch(P([[0, 1], [1, 3], [2, 9]]));
    const q = fitOf(out, "quadratic");
    expect(q.caveats.join(" ")).toMatch(/interpolation/);
  });

  test("the ranking is by ADJUSTED R², so the cubic does not win on parameters alone", () => {
    // Noisy line: cubic always has ≥ the line's plain R², but adjusted should
    // keep the line competitive at the top.
    const pts = P([[-3, -4.9], [-2, -3.2], [-1, -0.8], [0, 1.1], [1, 2.9], [2, 5.2], [3, 6.8]]);
    const out = fitSketch(pts);
    const lin = fitOf(out, "linear");
    const cub = fitOf(out, "cubic");
    expect(cub.r2).toBeGreaterThanOrEqual(lin.r2 - 1e-12);
    expect(lin.adjR2).toBeGreaterThan(0.98);
  });
});

describe("defects found by the independent adversarial pass (v2.109.0), pinned", () => {
  test("1: adjusted R² is NaN — never plain R² in disguise — when n ≤ params + 1", () => {
    // 5 points: cubic (4 params) has no residual degrees of freedom for the
    // adjustment. The first cut substituted plain R² and the cubic won the
    // 'adjusted' ranking with an unpenalised number.
    const out = fitSketch(P([[-2, 3], [-1, -1], [0, 0.5], [1, 4], [2, -3]]));
    const cubic = fitOf(out, "cubic");
    expect(Number.isFinite(cubic.adjR2)).toBe(false);
    expect(cubic.caveats.join(" ")).toMatch(/undefined|interpolation/);
    // …and it ranks BELOW every model with a real adjusted value.
    const defined = out.fits.filter((f) => Number.isFinite(f.adjR2));
    expect(defined.length).toBeGreaterThan(0);
    const cubicIdx = out.fits.indexOf(cubic);
    for (const f of defined) expect(out.fits.indexOf(f)).toBeLessThan(cubicIdx);
  });

  test("1b: interpolation is caveated even when rounding degrades R² below the old gate", () => {
    // 4 points, 4 cubic parameters, jagged data: exact interpolation whose
    // ROUNDED expression scores well below 1 — the old caveat (r2 > 0.999999)
    // stayed silent here.
    const out = fitSketch(P([[6.5, -5], [7, 5], [7.5, -4.5], [8, 4.5]]));
    const cubic = out.fits.find((f) => f.model === "cubic");
    if (cubic) {
      expect(cubic.caveats.join(" ")).toMatch(/interpolation/);
      expect(Number.isFinite(cubic.adjR2)).toBe(false);
    }
  });

  test("3: the fit overlay reports 'n/a at this n' instead of a fabricated adjusted value", () => {
    const pts = P([[0, 1], [1, 3], [2, 9], [3, 20]]);
    const out = fitSketch(pts);
    const cubic = out.fits.find((f) => f.model === "cubic");
    if (cubic) {
      const svg = sketchFitSvg(pts, cubic);
      expect(svg).toContain("n/a at this n");
      expect(svg).not.toContain("adjusted NaN");
    }
  });
});

describe("refusals and skips are named", () => {
  test("fewer than three points refuses", () => {
    expect(fitSketch(P([[0, 1], [1, 2]])).refusal).toMatch(/THREE points/);
  });

  test("two points sharing an x with different y: not a function — refused", () => {
    const out = fitSketch(P([[1, 2], [1, 5], [3, 4]]));
    expect(out.refusal).toMatch(/no function of x/);
  });

  test("a duplicate identical point is deduplicated, not refused", () => {
    const out = fitSketch(P([[0, 1], [0, 1], [1, 3], [2, 5]]));
    expect(out.refusal).toBeUndefined();
    expect(fitOf(out, "linear").r2).toBeCloseTo(1, 9);
  });

  test("negative y skips exponential and power BY NAME, fits the rest", () => {
    const out = fitSketch(P([[-2, -3], [0, 1], [1, 3], [3, 7]]));
    expect(out.skipped.find((s) => s.model === "exponential")!.reason).toMatch(/y > 0/);
    expect(out.skipped.find((s) => s.model === "power")).toBeDefined();
    expect(out.fits.find((f) => f.model === "linear")).toBeDefined();
  });

  test("x ≤ 0 skips logarithmic by name", () => {
    const out = fitSketch(P([[-1, 1], [0, 2], [1, 3], [2, 5]]));
    expect(out.skipped.find((s) => s.model === "logarithmic")!.reason).toMatch(/x > 0/);
  });

  test("cubic is skipped, not force-fitted, below 4 distinct x-values", () => {
    const out = fitSketch(P([[0, 1], [1, 3], [2, 9]]));
    expect(out.skipped.find((s) => s.model === "cubic")!.reason).toMatch(/at least 4/);
  });
});

describe("the sketch surfaces", () => {
  test("the click surface renders four quadrants with axes and the footer readout", () => {
    const svg = sketchSurfaceSvg(P([[-2, -1], [0, 1], [3, 2]]), { x: 1, y: 1 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("(1, 1)");
    expect(svg).toContain("3 points");
    expect(svg).not.toContain("NaN");
  });

  test("skSnapPt clamps to the four-quadrant world and pins NaN", () => {
    expect(skSnapPt({ x: -99, y: 99 })).toEqual({ x: -8, y: 5 });
    expect(skSnapPt({ x: NaN, y: 2.24 })).toEqual({ x: 0, y: 2 });
  });

  test("the fit overlay draws the curve, the points and BOTH quality lines", () => {
    const pts = P([[0, 1], [1, 3], [2, 5], [3, 7]]);
    const out = fitSketch(pts);
    const svg = sketchFitSvg(pts, fitOf(out, "linear"));
    expect(svg).toContain("<path");
    expect(svg).toContain("R² = 1");
    expect(svg).toContain("displayed expression");
    expect(svg).not.toContain("NaN");
  });

  test("a log fit sampled across x ≤ 0 breaks the path instead of lying through it", () => {
    const pts = P([[0.5, 0.3], [1, 1], [2, 1.7], [4, 2.4]]);
    const out = fitSketch(pts);
    const lg = fitOf(out, "logarithmic");
    const svg = sketchFitSvg(pts, lg);
    expect(svg).not.toContain("NaN");
  });
});
