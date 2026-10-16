/**
 * Splines — the acceptance audit from docs/SCOPE-LP-SPLINES.md §D (Splines). Every
 * expected value there was computed independently of the engine (own M-form solve).
 * Inputs are verbatim; expected strings exact.
 */
import { parseExpr, evalAst } from "../solve";
import { trySpline, SPLINE_VERB_RE } from "../spline";
import { tryInterpolate } from "../interpolate";

const run = (q: string) => {
  const v = trySpline(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string): string => {
  const v = trySpline(q);
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered, not refused: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string): string => run(q).lines.map((l) => l.text).join("\n");
const mathLines = (q: string): string[] => run(q).lines.filter((l) => l.math).map((l) => l.text);
/** The piece polynomials, in order, with their intervals from the text layer. */
const pieces = (q: string): { on: string; S: string }[] => {
  const out: { on: string; S: string }[] = [];
  const ls = run(q).lines;
  for (let i = 0; i + 1 < ls.length; i++) {
    const m = /^Piece \d+, on (\[[^\]]+\]):$/.exec(ls[i].text);
    if (m && ls[i + 1].math && ls[i + 1].text.startsWith("S(x) = ")) out.push({ on: m[1], S: ls[i + 1].text.slice("S(x) = ".length) });
  }
  return out;
};
const M = (q: string): string => /Second derivatives at the knots: M = \(([^)]*)\)/.exec(text(q))?.[1] ?? "no M";
const value = (q: string): string => {
  const l = mathLines(q).find((t) => /^S\([^x)]+\) = /.test(t));
  if (!l) throw new Error("no S(v) line in\n" + text(q));
  return l.replace(/^S\([^)]+\) = /, "");
};
const num = (s: string, x: number): number => evalAst(parseExpr(s), { x });

describe("§D splines — natural", () => {
  it("natural cubic spline through (0, 0), (1, 1), (2, 0) → M = (0, -3, 0) and the two pieces", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0)";
    expect(run(q).title).toBe("Natural cubic spline, 3 knots, 2 pieces");
    expect(M(q)).toBe("0, -3, 0");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "3/2*x - 1/2*x^3" },
      { on: "[1, 2]", S: "1 - 3/2*(x - 1)^2 + 1/2*(x - 1)^3" },
    ]);
    expect(text(q)).toContain("End condition: natural (S'' = 0 at both ends)");
  });
  it("… evaluate at x = 0.5 → 11/16 = 0.6875 (NOT \"x = 1/2\")", () => {
    const q = "natural cubic spline through (0, 0), (1, 1), (2, 0) evaluate at x = 0.5";
    expect(value(q)).toBe("11/16");
    expect(text(q)).toContain("≈ 0.6875");
    expect(text(q)).not.toMatch(/^x = 1\/2$/m);
  });
  it("spline (0,0), (1,1), (2,0) at 1.5 → 11/16, natural assumed and SAID", () => {
    const q = "spline (0,0), (1,1), (2,0) at 1.5";
    expect(value(q)).toBe("11/16");
    expect(text(q)).toContain("End condition: natural (S'' = 0 at both ends) — say `clamped … with S'(a) = m0, S'(b) = m1` or `not-a-knot` to change it.");
  });
  it("natural cubic spline through (0, 1), (1, 3), (2, 2), (3, 4) → M = (0, -6, 6, 0); S(1.5) = 5/2", () => {
    const q = "natural cubic spline through (0, 1), (1, 3), (2, 2), (3, 4) at x = 1.5";
    expect(M(q)).toBe("0, -6, 6, 0");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "1 + 3*x - x^3" },
      { on: "[1, 2]", S: "3 - 3*(x - 1)^2 + 2*(x - 1)^3" },
      { on: "[2, 3]", S: "2 + 3*(x - 2)^2 - (x - 2)^3" },
    ]);
    expect(value(q)).toBe("5/2");
  });
  it("cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends → M = (0, 1, 0); S(3) = 19/4, not the parabola's 14/3", () => {
    const q = "cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends at x = 3";
    expect(M(q)).toBe("0, 1, 0");
    expect(pieces(q)).toEqual([
      { on: "[1, 2]", S: "2 + 5/6*(x - 1) + 1/6*(x - 1)^3" },
      { on: "[2, 4]", S: "3 + 4/3*(x - 2) + 1/2*(x - 2)^2 - 1/12*(x - 2)^3" },
    ]);
    expect(value(q)).toBe("19/4");
    expect(run(q).title).toMatch(/^Natural cubic spline/);
    // A spline is not the polynomial: the parabola through the same points gives 14/3 there.
    const p = tryInterpolate("interpolate (1, 2), (2, 3), (4, 7) at x = 3")!;
    expect(p.lines.map((l) => l.text)).toContain("p(3) = 14/3");
  });
  it("cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0 → M = (0, -9/2, 0)", () => {
    const q = "cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0";
    expect(M(q)).toBe("0, -9/2, 0");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "1 + 7/4*x - 3/4*x^3" },
      { on: "[1, 2]", S: "2 - 1/2*(x - 1) - 9/4*(x - 1)^2 + 3/4*(x - 1)^3" },
    ]);
  });
  it("S(x) natural cubic spline (0,1), (1,2), (2,0) find S(1.5) → 41/32", () => {
    expect(value("S(x) natural cubic spline (0,1), (1,2), (2,0) find S(1.5)")).toBe("41/32");
  });
  it("smooth curve through the points (0, 0), (1, 2), (2, 1), (3, 3) → natural, said", () => {
    const q = "smooth curve through the points (0, 0), (1, 2), (2, 1), (3, 3)";
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "3*x - x^3" },
      { on: "[1, 2]", S: "2 - 3*(x - 1)^2 + 2*(x - 1)^3" },
      { on: "[2, 3]", S: "1 + 3*(x - 2)^2 - (x - 2)^3" },
    ]);
    expect(text(q)).toContain("End condition: natural (S'' = 0 at both ends) — say");
    expect(run(q).caveats.join(" ")).toContain("\"Natural\" is a choice, not a property of the data");
  });
});

describe("§D splines — clamped, not-a-knot, linear, PCHIP", () => {
  it("clamped … with S'(0) = 1, S'(2) = -1 → M = (2, -4, 2); S(0.5) = 5/8; end slopes verified", () => {
    const q = "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1 at x = 0.5";
    expect(run(q).title).toBe("Clamped cubic spline, 3 knots, 2 pieces");
    expect(M(q)).toBe("2, -4, 2");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "x + x^2 - x^3" },
      { on: "[1, 2]", S: "1 - 2*(x - 1)^2 + (x - 1)^3" },
    ]);
    expect(value(q)).toBe("5/8");
    expect(run(q).caveats.join(" ")).toContain("S'(0) = 1 and S'(2) = -1");
  });
  it("cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0 → M = (21/2, -9, 15/2); S(1.5) = 83/32", () => {
    const q = "cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0 at x = 1.5";
    expect(M(q)).toBe("21/2, -9, 15/2");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "1 + 21/4*x^2 - 13/4*x^3" },
      { on: "[1, 2]", S: "3 + 3/4*(x - 1) - 9/2*(x - 1)^2 + 11/4*(x - 1)^3" },
    ]);
    expect(value(q)).toBe("83/32");
  });
  it("not-a-knot spline through (0,1), (1,3), (2,2), (3,4) → the single cubic, said; S(1.5) = 5/2; cross-checked", () => {
    const q = "not-a-knot spline through (0,1), (1,3), (2,2), (3,4) at x = 1.5";
    expect(mathLines(q)).toContain("S(x) = x^3 - 9/2*x^2 + 11/2*x + 1");
    expect(text(q)).toContain("Not-a-knot with 4 knots IS the interpolating cubic");
    expect(value(q)).toBe("5/2");
    expect(run(q).caveats.join(" ")).toContain("equals the interpolation engine's polynomial");
    // Each piece is that cubic on its interval.
    for (const p of pieces(q)) for (const x of [0.25, 1.5, 2.75]) expect(num(p.S, x)).toBeCloseTo(num("x^3 - 9/2*x^2 + 11/2*x + 1", x), 12);
  });
  it("linear spline through (0, 0), (1, 2), (3, 1) → 2*x on [0, 1]; 5/2 - 1/2*x on [1, 3]", () => {
    const q = "linear spline through (0, 0), (1, 2), (3, 1)";
    expect(run(q).title).toBe("Linear spline, 3 knots, 2 pieces");
    expect(pieces(q)).toEqual([
      { on: "[0, 1]", S: "2*x" },
      { on: "[1, 3]", S: "5/2 - 1/2*x" },
    ]);
  });
  it("cubic spline through (0, 0), (1, 1) → the chord y = x", () => {
    const q = "cubic spline through (0, 0), (1, 1)";
    expect(text(q)).toContain("A spline through two knots is the chord y = x");
    expect(mathLines(q)).toEqual(["S(x) = x"]);
  });
  it("pchip (0, 0), (1, 1), (2, 1), (3, 2) → slopes (3/2, 0, 0, 3/2), MATLAB end formula stated, monotone", () => {
    for (const q of ["pchip (0, 0), (1, 1), (2, 1), (3, 2)", "monotone cubic interpolation of (0, 0), (1, 1), (2, 1), (3, 2)"]) {
      expect(text(q)).toContain("Slopes at the knots: d = (3/2, 0, 0, 3/2)");
      expect(text(q)).toContain("MATLAB's pchip end formula");
      expect(text(q)).toContain("Fritsch–Carlson");
      expect(pieces(q)).toEqual([
        { on: "[0, 1]", S: "3/2*x - 1/2*x^3" },
        { on: "[1, 2]", S: "1" },
        { on: "[2, 3]", S: "1 + 3/2*(x - 2)^2 - 1/2*(x - 2)^3" },
      ]);
      expect(run(q).caveats.join(" ")).toContain("every piece is monotone");
      expect(run(q).title).toMatch(/^PCHIP/);
    }
  });
});

describe("§D splines — refusals", () => {
  it("natural spline through (0, 0), (0, 1), (1, 2) → refusal naming x = 0", () => {
    expect(refusal("natural spline through (0, 0), (0, 1), (1, 2)")).toBe("x = 0 appears twice (y = 0 and y = 1): no function passes through both.");
  });
  it("quadratic spline through (0,0), (1,1), (2,0) → refusal by name", () => {
    expect(refusal("quadratic spline through (0,0), (1,1), (2,0)")).toMatch(/^Quadratic splines are not built here.*extra condition that nobody states the same way/);
  });
  it("spline → usage refusal, never \"spline = 0\"", () => {
    const r = refusal("spline");
    expect(r).toContain("Give the knots");
    expect(r).not.toContain("spline = 0");
  });
  it("smooth curve through one point → refusal", () => {
    expect(refusal("smooth curve through the points (1, 2)")).toMatch(/One point \(1, 2\)/);
  });
});

describe("display contract, verification and the figure", () => {
  const ALL = [
    "natural cubic spline through (0, 0), (1, 1), (2, 0) evaluate at x = 0.5",
    "natural cubic spline through (0, 1), (1, 3), (2, 2), (3, 4) at x = 1.5",
    "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1 at x = 0.5",
    "cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0 at x = 1.5",
    "not-a-knot spline through (0,1), (1,3), (2,2), (3,4) at x = 1.5",
    "cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends at x = 3",
    "linear spline through (0, 0), (1, 2), (3, 1)",
    "pchip (0, 0), (1, 1), (2, 1), (3, 2)",
    "cubic spline through (0, 0), (1, 1)",
  ];
  it("every math line's right-hand side re-parses, with one minus convention", () => {
    for (const q of ALL) {
      for (const l of mathLines(q)) {
        expect(l).toMatch(/^S\([^)]+\) = /);
        expect(() => parseExpr(l.replace(/^S\([^)]+\) = /, ""))).not.toThrow();
        expect(l.includes("−")).toBe(false);
      }
    }
  });
  it("every verb result carries the exact-verification sentence", () => {
    for (const q of ALL) expect(run(q).caveats.join(" ")).toContain("Verified exactly (rational arithmetic)");
  });
  it("adjacent printed pieces meet at the knot (value and slope) when re-parsed", () => {
    for (const q of ALL.slice(0, 6)) {
      const ps = pieces(q);
      for (let i = 0; i + 1 < ps.length; i++) {
        const knot = Number(ps[i].on.slice(1, -1).split(", ")[1]);
        expect(num(ps[i].S, knot)).toBeCloseTo(num(ps[i + 1].S, knot), 10);
        const h = 1e-6;
        const dl = (num(ps[i].S, knot) - num(ps[i].S, knot - h)) / h;
        const dr = (num(ps[i + 1].S, knot + h) - num(ps[i + 1].S, knot)) / h;
        expect(Math.abs(dl - dr)).toBeLessThan(1e-4);
      }
    }
  });
  it("no spline figure carries a title wider than the 380 px frame (gate estimate: chars × 13 × 0.58)", () => {
    const knots50 = Array.from({ length: 50 }, (_, i) => `(${i}, ${i % 3})`).join(", ");
    for (const q of [...ALL, `natural cubic spline through ${knots50}`, "monotone cubic interpolation of (0, 0), (1, 1), (2, 1), (3, 2)"]) {
      const title = /<text(?: data-figure-title="1")? x="190" y="16" text-anchor="middle"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/.exec(run(q).svg!)?.[1] ?? "";
      expect(title.length).toBeGreaterThan(0);
      expect(title.length * 13 * 0.58).toBeLessThanOrEqual(380);
    }
  });
  it("the figure is the verb's own: pieces, knots, query point, clamped tangents", () => {
    const v = run("clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1 at x = 0.5");
    expect(v.svg).toMatch(/^<svg/);
    expect(v.svg).toContain("3 knots");
    expect(v.svg).toContain("end tangents");
    expect(v.svg).toContain("S(1/2) = 5/8");
    expect(v.plot).toBeUndefined();
    expect(run("natural cubic spline through (0, 0), (1, 1), (2, 0)").svg).not.toContain("end tangents");
  });
});

describe("the guard", () => {
  it("claims every §D spline input and stands aside otherwise", () => {
    for (const q of [
      "natural cubic spline through (0, 0), (1, 1), (2, 0)",
      "spline (0,0), (1,1), (2,0) at 1.5",
      "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1",
      "cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0",
      "not-a-knot spline through (0,1), (1,3), (2,2), (3,4)",
      "cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0",
      "S(x) natural cubic spline (0,1), (1,2), (2,0) find S(1.5)",
      "smooth curve through the points (0, 0), (1, 2), (2, 1), (3, 3)",
      "linear spline through (0, 0), (1, 2), (3, 1)",
      "pchip (0, 0), (1, 1), (2, 1), (3, 2)",
      "monotone cubic interpolation of (0, 0), (1, 1), (2, 1), (3, 2)",
      "quadratic spline through (0,0), (1,1), (2,0)",
      "spline",
    ]) {
      expect(SPLINE_VERB_RE.test(q)).toBe(true);
      expect(trySpline(q)).not.toBeNull();
      // tryInterpolate runs first in the chain and must stand aside.
      expect(tryInterpolate(q)).toBeNull();
    }
    for (const q of ["interpolate (1, 2), (2, 3), (4, 7)", "x^2 - 5x + 6 = 0", "maximize 3x + 2y subject to x + y <= 4"]) {
      expect(SPLINE_VERB_RE.test(q)).toBe(false);
      expect(trySpline(q)).toBeNull();
    }
  });
});
