// Adversarial bug test — geometry (geometry.ts, geometryParse.ts).
//
// Written after v2.7.0 shipped WITHOUT an adversarial pass, which broke this
// project's own deploy rule. Probing it immediately found three real defects,
// all pinned below:
//
//   1. Exact forms were built from FLOAT products, so `circle r=0.1` reported
//      its area as 5000000000000001/500000000000000000·π instead of π/100.
//      The rational conversion was faithful; the double handed to it was not.
//   2. √(1/4) printed "(1)/2" — parentheses wrapped around a bare token.
//   3. SSA with a = b = altitude reported a "triangle" whose third side was 0
//      and whose area was 0. Two right angles leave nothing for the third
//      angle, so no triangle exists; returning one is a fabricated answer.

import { shapeMetrics, fmtSqrtRat, solveTriangle, polygonArea, convexHull, pt } from "../geometry";
import { solveGeometry } from "../geometryParse";
import { ratMake } from "../cas";

describe("exact forms must not carry float noise", () => {
  // 0.1*0.1 is 0.010000000000000002 as a double; 0.7*0.7 is 0.48999999999999994.
  const CASES: [number, string][] = [
    [0.1, "1/100*pi"], [0.3, "9/100*pi"], [0.7, "49/100*pi"],
    [1.5, "9/4*pi"], [2.5, "25/4*pi"], [3, "9*pi"],
  ];
  for (const [r, want] of CASES) {
    it(`circle r=${r} gives area ${want}`, () => {
      const m = shapeMetrics({ shape: "circle", dims: { r } })!;
      expect(m.values.find((v) => v.label === "area")!.exact).toBe(want);
    });
  }
  it("no exact form anywhere contains a 15+ digit integer", () => {
    const SHAPES: [string, Record<string, number>][] = [
      ["circle", { r: 0.1 }], ["sphere", { r: 0.7 }], ["cylinder", { r: 0.3, h: 1.1 }],
      ["cone", { r: 0.7, h: 0.3 }], ["box", { a: 0.1, b: 0.3, c: 0.7 }],
      ["rectangle", { a: 1.1, b: 2.2 }], ["square", { a: 0.7 }],
    ];
    for (const [shape, dims] of SHAPES) {
      const m = shapeMetrics({ shape, dims });
      if (!m) continue;
      for (const v of m.values) {
        if (v.exact) expect(`${shape}.${v.label}=${v.exact}`).not.toMatch(/\d{15,}/);
      }
    }
  });
});

describe("surd formatting has no redundant parentheses", () => {
  it("a bare rational square root prints plainly", () => {
    expect(fmtSqrtRat(ratMake(1n, 4n))).toBe("1/2");
    expect(fmtSqrtRat(ratMake(9n, 16n))).toBe("3/4");
    expect(fmtSqrtRat(ratMake(1n, 2n))).toBe("sqrt(2)/2");
    expect(fmtSqrtRat(ratMake(3n, 4n))).toBe("sqrt(3)/2");
  });
  it("a genuine product still gets its parentheses", () => {
    expect(fmtSqrtRat(ratMake(9n, 2n))).toBe("(3*sqrt(2))/2");
  });
});

describe("degenerate triangles are refused, not reported with zero area", () => {
  it("SSA where a = b = the altitude has NO triangle", () => {
    const r = solveTriangle({ kind: "SSA", a: 5, b: 5, A: 90 });
    expect(r.triangles.length).toBe(0);
    expect(r.impossible).toMatch(/collapses to zero/);
  });
  it("no solver path ever returns a triangle of zero area", () => {
    const CASES = [
      { kind: "SSA" as const, a: 5, b: 5, A: 90 },
      { kind: "SSA" as const, a: 1, b: 1, A: 90 },
      { kind: "SSA" as const, a: 2, b: 2, A: 90 },
      { kind: "SSS" as const, a: 1, b: 2, c: 3 },
      { kind: "SAS" as const, b: 1, c: 1, A: 180 },
    ];
    for (const c of CASES) {
      const r = solveTriangle(c as never);
      for (const t of r.triangles) {
        expect(`${JSON.stringify(c)} area=${t.area}`).not.toMatch(/area=0$/);
        expect(t.area).toBeGreaterThan(0);
      }
    }
  });
});

describe("hostile and degenerate input never throws", () => {
  it("polygon primitives survive empty, single, duplicate and collinear inputs", () => {
    const SETS = [
      [], [pt(0, 0)], [pt(0, 0), pt(1, 1)],
      [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3)],
      [pt(1, 1), pt(1, 1), pt(1, 1)],
    ];
    for (const ps of SETS) {
      expect(() => polygonArea(ps)).not.toThrow();
      expect(() => convexHull(ps)).not.toThrow();
      expect(convexHull(ps).length).toBeLessThanOrEqual(Math.max(1, ps.length));
    }
  });
  it("extreme triangle magnitudes and near-degenerate angles stay finite", () => {
    const CASES = [
      { kind: "SSS" as const, a: 1e-9, b: 1e-9, c: 1e-9 },
      { kind: "SSS" as const, a: 1e9, b: 1e9, c: 1e9 },
      { kind: "SAS" as const, b: 1, c: 1, A: 179.999 },
      { kind: "ASA" as const, A: 0.001, B: 0.001, c: 1 },
      { kind: "SSA" as const, a: 1, b: 1e6, A: 0.0001 },
    ];
    for (const c of CASES) {
      const r = solveTriangle(c as never);
      for (const t of r.triangles) {
        for (const v of [t.a, t.b, t.c, t.A, t.B, t.C, t.area]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
  it("conics with fractional and extreme coefficients still classify", () => {
    for (const s of ["0.5*x^2 + 0.25*y^2 = 1", "x^2/3 + y^2/7 = 1", "1000000*x^2 + y^2 = 1", "0.0001*x^2 + y^2 = 1"]) {
      const r = solveGeometry(s);
      expect(r).not.toBeNull();
      expect(r!.title).toMatch(/ellipse|circle|hyperbola|parabola/i);
    }
  });
});

describe("typed fractions must survive the parser exactly", () => {
  // Found in the Tier-3/4 sweep: numOf() divided as a FLOAT, so a coordinate
  // or dimension typed as 1/3 arrived as 0.3333333333333333 and the exact
  // layer then faithfully preserved that noise. Same class as the v2.8.1
  // circle-r=0.1 defect, one layer earlier — at the parse boundary rather
  // than in the arithmetic. Coordinates AND positional/named dimensions are
  // all affected, so all three paths are pinned.
  const val = (s: string, label: string) =>
    solveGeometry(s)!.values.find((v) => v.label === label);

  it("fractional COORDINATES stay exact", () => {
    expect(val("(1/2,1/3) (1/4,1/5)", "distance")!.exact).toBe("17/60");
    expect(val("triangle (0,0) (1/2,0) (0,1/3)", "area")!.exact).toBe("1/12");
  });
  it("fractional NAMED dimensions stay exact", () => {
    expect(val("circle r=1/3", "area")!.exact).toBe("1/9*pi");
    expect(val("sphere r=1/2", "volume")!.exact).toBe("1/6*pi");
    expect(val("cylinder r=1/3 h=3", "volume")!.exact).toBe("1/3*pi");
    expect(val("square a=1/4", "area")!.exact).toBe("1/16");
  });
  it("fractional POSITIONAL dimensions stay exact", () => {
    expect(val("box 1/2 1/3 1/4", "volume")!.exact).toBe("1/24");
    expect(val("rectangle 1/2 2/3", "area")!.exact).toBe("1/3");
    expect(val("circle 1/3", "area")!.exact).toBe("1/9*pi");
  });
  it("no exact form anywhere grows a runaway integer", () => {
    const INPUTS = [
      "circle r=1/3", "sphere r=1/7", "box 1/2 1/3 1/4", "cone r=1/3 h=1/7",
      "(1/2,1/3) (1/4,1/5)", "(1/2,1/3,1/4) (1/5,1/6,1/7)",
      "triangle (0,0) (1/3,0) (0,1/7)",
    ];
    for (const s of INPUTS) {
      const r = solveGeometry(s);
      if (!r) continue;
      for (const v of r.values) {
        if (v.exact) expect(`${s} ${v.label}=${v.exact}`).not.toMatch(/[0-9]{15,}/);
      }
    }
  });
  it("whole numbers are unaffected", () => {
    expect(val("circle r=3", "area")!.exact).toBe("9*pi");
    expect(val("box 1 2 3", "volume")!.exact).toBe("6");
  });
});
