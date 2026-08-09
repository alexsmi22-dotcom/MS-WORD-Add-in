// The v2.106.0 geometry suite — oracle tests against closed forms.
//
// Covers the four additions: the circle toolkit (the half of Tier 1 the design
// brief named and no release built), the solids beyond sphere/cylinder/cone/box,
// triangle inradius/circumradius, conic vertices/directrices/parabola-vertex,
// 2D homogeneous transforms, and the point-in-polygon routing.
//
// Every oracle here is a value computable by hand: a 3-4-5 triangle has r = 1
// and R = 5/2; a 60° sector of r = 6 has area 6π and a chord of exactly 6.

import { solveGeometry } from "../geometryParse";
import { solveTriangle, classifyConic } from "../geometry";
import { parseExpr, evalAst } from "../solve";
import { ratInt } from "../cas";

const val = (r: ReturnType<typeof solveGeometry>, label: string) => {
  const v = r?.values.find((x) => x.label === label);
  expect(v).toBeDefined();
  return v!;
};

describe("circle toolkit — sector, segment, arc", () => {
  test("sector r=6 angle=60: area 6π, arc 2π, chord exactly 6", () => {
    const r = solveGeometry("sector r=6 angle=60")!;
    expect(r.degenerate).toBeUndefined();
    expect(val(r, "area").exact).toBe("6*pi");
    expect(val(r, "area").value).toBeCloseTo(6 * Math.PI, 10);
    expect(val(r, "arc length").exact).toBe("2*pi");
    expect(val(r, "chord").value).toBeCloseTo(6, 10); // 2·6·sin30° = 6
    expect(val(r, "perimeter").value).toBeCloseTo(2 * Math.PI + 12, 10);
    expect(r.figure).toEqual({ kind: "circle-feature", feature: "sector", r: 6, angleDeg: 60 });
  });

  test("segment r=2 angle=180: the half-disc, area 2π, chord = diameter", () => {
    const r = solveGeometry("segment r=2 angle=180")!;
    expect(val(r, "area").value).toBeCloseTo(2 * Math.PI, 10); // r²/2(π − sin π)
    expect(val(r, "chord").value).toBeCloseTo(4, 10);
    expect(val(r, "height").value).toBeCloseTo(2 * (1 - Math.cos(Math.PI / 2)), 10);
  });

  test("arc r=6 angle=120: length 4π, chord 6√3, one third of the circle", () => {
    const r = solveGeometry("arc r=6 angle=120")!;
    expect(val(r, "arc length").exact).toBe("4*pi");
    expect(val(r, "chord").value).toBeCloseTo(6 * Math.sqrt(3), 10);
    expect(val(r, "fraction of the circle").exact).toBe("1/3");
  });

  test("theta is accepted as an alias for angle", () => {
    const r = solveGeometry("sector r=6 theta=60")!;
    expect(val(r, "area").exact).toBe("6*pi");
  });

  test("positional form: sector 6 60 reads r then angle", () => {
    const r = solveGeometry("sector 6 60")!;
    expect(val(r, "area").exact).toBe("6*pi");
  });

  test("an angle beyond a full turn is refused by name, not wrapped", () => {
    const r = solveGeometry("sector r=5 angle=400")!;
    expect(r.degenerate).toMatch(/full turn/);
    expect(r.figure).toBeUndefined();
  });
});

describe("circle toolkit — tangent and inscribed angle", () => {
  test("tangent r=3 d=5 is the 3-4-5 triangle: length exactly 4", () => {
    const r = solveGeometry("tangent r=3 d=5")!;
    expect(val(r, "tangent length").exact).toBe("4");
    expect(val(r, "tangent length").value).toBeCloseTo(4, 12);
    expect(val(r, "angle between the two tangents (deg)").value).toBeCloseTo(2 * Math.asin(3 / 5) * (180 / Math.PI), 10);
    expect(r.figure).toEqual({ kind: "circle-feature", feature: "tangent", r: 3, d: 5 });
  });

  test("a point inside the circle has no tangent — refused by name", () => {
    const r = solveGeometry("tangent r=5 d=3")!;
    expect(r.degenerate).toMatch(/INSIDE/);
  });

  test("a point ON the circle: length 0, exactly one tangent, said so", () => {
    const r = solveGeometry("tangent r=4 d=4")!;
    expect(val(r, "tangent length").value).toBe(0);
    expect(r.caveats.join(" ")).toMatch(/exactly one tangent/);
  });

  test("inscribed angle is half the central angle; Thales named at 180°", () => {
    const r = solveGeometry("inscribed angle=80")!;
    expect(val(r, "inscribed angle (deg)").exact).toBe("40");
    const th = solveGeometry("inscribed angle=180")!;
    expect(val(th, "inscribed angle (deg)").value).toBe(90);
    expect(th.steps.join(" ")).toMatch(/Thales/);
  });
});

describe("solids — closed-form oracles", () => {
  test("hemisphere r=3: V = 18π, curved 18π, total 27π", () => {
    const r = solveGeometry("hemisphere r=3")!;
    expect(val(r, "volume").exact).toBe("18*pi");
    expect(val(r, "curved surface area").exact).toBe("18*pi");
    expect(val(r, "total surface area").exact).toBe("27*pi");
  });

  test("pyramid a=6 h=4: V = 48, slant exactly 5, lateral 60, total 96", () => {
    const r = solveGeometry("pyramid a=6 h=4")!;
    expect(val(r, "volume").exact).toBe("48");
    expect(val(r, "slant height").exact).toBe("5");
    expect(val(r, "lateral surface area").value).toBeCloseTo(60, 10);
    expect(val(r, "total surface area").value).toBeCloseTo(96, 10);
  });

  test("prism b=4 h=3 l=10: V = 60, surface honestly refused", () => {
    const r = solveGeometry("prism b=4 h=3 l=10")!;
    expect(val(r, "volume").exact).toBe("60");
    expect(r.caveats.join(" ")).toMatch(/three SIDE lengths/);
    expect(r.values.find((v) => /surface/.test(v.label))).toBeUndefined();
  });

  test("frustum r1=2 r2=5 h=4: slant exactly 5, V = 52π, lateral 35π", () => {
    const r = solveGeometry("frustum r1=2 r2=5 h=4")!;
    expect(val(r, "slant height").exact).toBe("5");
    expect(val(r, "volume").exact).toBe("52*pi");
    expect(val(r, "lateral surface area").exact).toBe("35*pi");
    expect(val(r, "total surface area").value).toBeCloseTo(64 * Math.PI, 8);
  });

  test("frustum accepts r/R as aliases for r1/r2", () => {
    const r = solveGeometry("frustum r=2 R=5 h=4")!;
    expect(val(r, "volume").exact).toBe("52*pi");
  });

  test("spherical cap r=5 h=2: V = 52π/3, curved 20π, base radius 4", () => {
    const r = solveGeometry("cap r=5 h=2")!;
    expect(val(r, "volume").exact).toBe("52/3*pi");
    expect(val(r, "curved surface area").exact).toBe("20*pi");
    expect(val(r, "base radius").exact).toBe("4"); // √(2·(10−2)) = √16
  });

  test("a cap taller than the diameter is refused by name", () => {
    const r = solveGeometry("cap r=2 h=5")!;
    expect(r.degenerate).toMatch(/cannot exceed the diameter/);
  });

  test("torus R=3 r=1: V = 6π², S = 12π²", () => {
    const r = solveGeometry("torus R=3 r=1")!;
    expect(val(r, "volume").exact).toBe("6*pi^2");
    expect(val(r, "volume").value).toBeCloseTo(2 * Math.PI * Math.PI * 3, 8);
    expect(val(r, "surface area").exact).toBe("12*pi^2");
  });

  test("a spindle torus (R < r) is refused rather than double-counted", () => {
    const r = solveGeometry("torus R=1 r=3")!;
    expect(r.degenerate).toMatch(/spindle/);
  });

  test("ellipsoid 1 2 3: V = 8π exact; surface approximate and says so", () => {
    const r = solveGeometry("ellipsoid a=1 b=2 c=3")!;
    expect(val(r, "volume").exact).toBe("8*pi");
    // The true value is ≈ 48.88; Thomsen is within about 1%.
    const s = val(r, "surface area (approximate)").value;
    expect(s).toBeGreaterThan(48);
    expect(s).toBeLessThan(50);
    expect(r.caveats.join(" ")).toMatch(/approximation/);
  });

  test("regular tetrahedron a=2: V = (2√2)/3, S = 4√3, height (2√6)/3", () => {
    const r = solveGeometry("tetrahedron a=2")!;
    expect(val(r, "volume").value).toBeCloseTo((8 * Math.SQRT2) / 12, 10);
    expect(val(r, "volume").exact).toBe("(2*sqrt(2))/3");
    expect(val(r, "surface area").exact).toBe("4*sqrt(3)");
    expect(val(r, "height").exact).toBe("(2*sqrt(6))/3");
  });
});

describe("triangle inradius and circumradius", () => {
  test("3-4-5: r = 1 exactly, R = 5/2 exactly", () => {
    const s = solveTriangle({ kind: "SSS", a: 3, b: 4, c: 5 });
    const t = s.triangles[0];
    expect(t.inradius).toBeCloseTo(1, 12);
    expect(t.inradiusExact).toBe("1");
    expect(t.circumradius).toBeCloseTo(2.5, 12);
    expect(t.circumradiusExact).toBe("5/2");
  });

  test("13-14-15: area 84, r = 4, R = 65/8", () => {
    const s = solveTriangle({ kind: "SSS", a: 13, b: 14, c: 15 });
    const t = s.triangles[0];
    expect(t.area).toBeCloseTo(84, 10);
    expect(t.inradiusExact).toBe("4");
    expect(t.circumradiusExact).toBe("65/8");
  });

  test("equilateral side 2: r = √3/3, R = 2√3/3 — and R = 2r", () => {
    const s = solveTriangle({ kind: "SSS", a: 2, b: 2, c: 2 });
    const t = s.triangles[0];
    expect(t.inradius).toBeCloseTo(Math.sqrt(3) / 3, 12);
    expect(t.circumradius).toBeCloseTo((2 * Math.sqrt(3)) / 3, 12);
    expect(t.circumradius).toBeCloseTo(2 * t.inradius, 12);
  });

  test("the pane surfaces both radii for a typed triangle", () => {
    const r = solveGeometry("triangle 3 4 5")!;
    expect(val(r, "inradius").exact).toBe("1");
    expect(val(r, "circumradius").exact).toBe("5/2");
    expect(r.steps.join(" ")).toMatch(/abc\/\(4·area\)/);
  });
});

describe("conics — vertices, directrices, and the parabola's anatomy", () => {
  test("x²/25 + y²/9 = 1: vertices at (±5, 0), directrix distance 25/4", () => {
    const r = solveGeometry("x^2/25 + y^2/9 = 1")!;
    const vx = r.values.filter((v) => /^vertex \d/.test(v.label));
    expect(vx).toHaveLength(2);
    expect(vx[0].exact).toContain("5.000000");
    expect(r.steps.join(" ")).toMatch(/Directrix/);
    expect(r.steps.join(" ")).toContain("6.25000"); // a/e = 25/4
  });

  test("y = x²/8: a parabola with vertex (0,0), focus (0,2), p = 2", () => {
    const r = solveGeometry("y = x^2/8")!;
    expect(r.title).toContain("parabola");
    expect(val(r, "vertex").exact).toBe("(0.000000, 0.000000)");
    expect(val(r, "focus").exact).toBe("(0.000000, 2.000000)");
    expect(val(r, "focal parameter").value).toBeCloseTo(2, 10);
    expect(r.steps.join(" ")).toMatch(/directrix/i);
    expect(r.figure).toMatchObject({ kind: "conic", conic: "parabola" });
    const fig = r.figure as Extract<NonNullable<typeof r.figure>, { kind: "conic" }>;
    expect(fig.axis!.x).toBeCloseTo(0, 8);
    expect(fig.axis!.y).toBeCloseTo(1, 8);
  });

  test("a shifted parabola's vertex is found by completing the square", () => {
    // y = (x − 3)² + 1 → vertex (3, 1), p = 1/4, focus (3, 1.25).
    const r = solveGeometry("y = x^2 - 6*x + 10")!;
    expect(val(r, "vertex").exact).toBe("(3.000000, 1.000000)");
    expect(val(r, "focus").exact).toBe("(3.000000, 1.250000)");
  });

  test("hyperbola x²/4 − y²/9 = 1: directrix distance a²/c = 4/√13", () => {
    const r = solveGeometry("x^2/4 - y^2/9 = 1")!;
    expect(r.steps.join(" ")).toMatch(/Directrix/);
    expect(r.steps.join(" ")).toContain((4 / Math.sqrt(13)).toPrecision(6));
    expect(r.figure).toMatchObject({ kind: "conic", conic: "hyperbola" });
  });

  test("a circle reports NO directrix — e = 0 puts it at infinity", () => {
    const c = classifyConic(ratInt(1), ratInt(0), ratInt(1), ratInt(0), ratInt(0), ratInt(-25));
    expect(c.kind).toBe("circle");
    expect(c.directrices).toBeUndefined();
  });
});

describe("2D transforms — homogeneous, exact at quarter turns", () => {
  test("rotate 90 (1,0) is EXACTLY (0,1)", () => {
    const r = solveGeometry("rotate 90 (1,0)")!;
    expect(val(r, "x").exact).toBe("0");
    expect(val(r, "y").exact).toBe("1");
    expect(val(r, "determinant").exact).toBe("1");
  });

  test("rotate -90 and rotate 450 normalise to exact quarter turns", () => {
    const a = solveGeometry("rotate -90 (1,0)")!;
    expect(val(a, "x").exact).toBe("0");
    expect(val(a, "y").exact).toBe("-1");
    const b = solveGeometry("rotate 450 (1,0)")!;
    expect(val(b, "y").exact).toBe("1");
  });

  test("rotate 90 about (1,1): the conjugated matrix, exactly", () => {
    const r = solveGeometry("rotate 90 about (1,1) (2,3)")!;
    expect(val(r, "x").exact).toBe("-1");
    expect(val(r, "y").exact).toBe("2");
  });

  test("reflect y=x swaps the coordinates and flips orientation", () => {
    const r = solveGeometry("reflect y=x (2,3)")!;
    expect(val(r, "x").exact).toBe("3");
    expect(val(r, "y").exact).toBe("2");
    expect(val(r, "determinant").exact).toBe("-1");
    expect(val(r, "area scale factor").exact).toBe("1");
    expect(r.steps.join(" ")).toMatch(/FLIPS ORIENTATION/);
  });

  test("translate is a matrix too, and contributes nothing to the determinant", () => {
    const r = solveGeometry("translate 3 -2 (2,3)")!;
    expect(val(r, "x").exact).toBe("5");
    expect(val(r, "y").exact).toBe("1");
    expect(val(r, "determinant").exact).toBe("1");
  });

  test("shear x 1/2 (2,3): x' = 2 + 3/2 = 7/2, area preserved", () => {
    const r = solveGeometry("shear x 1/2 (2,3)")!;
    expect(val(r, "x").exact).toBe("7/2");
    expect(val(r, "y").exact).toBe("3");
    expect(val(r, "area scale factor").exact).toBe("1");
  });

  test("chained ops compose left to right: rotate 90 then translate 1 0 (1,0)", () => {
    const r = solveGeometry("rotate 90 then translate 1 0 (1,0)")!;
    expect(val(r, "x").exact).toBe("1");
    expect(val(r, "y").exact).toBe("1");
    expect(r.caveats.join(" ")).toMatch(/ORDER MATTERS/);
  });

  test("scale 2 3 (1,1): anisotropic, determinant 6", () => {
    const r = solveGeometry("scale 2 3 (1,1)")!;
    expect(val(r, "x").exact).toBe("2");
    expect(val(r, "y").exact).toBe("3");
    expect(val(r, "determinant").exact).toBe("6");
  });

  test("a non-quarter rotation is numeric AND says so", () => {
    const r = solveGeometry("rotate 45 (1,0)")!;
    expect(val(r, "x").value).toBeCloseTo(Math.SQRT1_2, 10);
    expect(val(r, "x").exact).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/NUMERIC rather than exact/);
  });

  test("refusals name the missing piece instead of substituting", () => {
    expect(solveGeometry("rotate (1,2)")!.degenerate).toMatch(/rotation angle/);
    expect(solveGeometry("reflect z (1,2)")!.degenerate).toMatch(/mirror line/);
    expect(solveGeometry("translate 3 (1,2)")!.degenerate).toMatch(/TWO offsets/);
    expect(solveGeometry("scale 2 3 4 (1,2)")!.degenerate).toMatch(/scale factors/);
    expect(solveGeometry("rotate 90, scale 2 (1,2)")!.degenerate).toMatch(/more than one transformation/);
    expect(solveGeometry("translate 3 -2")!.degenerate).toMatch(/coordinate pair/);
  });

  test("the 3D transform grammar is untouched: triples still route to 3D", () => {
    const r = solveGeometry("rotate 90 z (1,2,3)")!;
    expect(r.title).toMatch(/^Transform of/);
  });
});

describe("point in polygon — routed at last", () => {
  test("inside (1,1) polygon …: INSIDE, with the figure probe marked", () => {
    const r = solveGeometry("inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)")!;
    expect(r.steps[0]).toMatch(/INSIDE/);
    expect(r.figure).toMatchObject({ kind: "points", probe: { x: 1, y: 1, verdict: "inside" } });
  });

  test("polygon … contains (5,5): the probe is the LAST pair — OUTSIDE", () => {
    const r = solveGeometry("polygon (0,0) (4,0) (4,4) (0,4) contains (5,5)")!;
    expect(r.steps[0]).toMatch(/OUTSIDE/);
  });

  test("a point exactly on an edge is BOUNDARY, not rounded to a side", () => {
    const r = solveGeometry("inside (2,0) polygon (0,0) (4,0) (4,4) (0,4)")!;
    expect(r.steps[0]).toMatch(/ON THE BOUNDARY/);
  });
});

describe("every exact string re-parses and means its own decimal", () => {
  // The display contract, applied to the new suite: whatever is displayed must
  // parse back in the product's own grammar and evaluate to the decimal shown
  // beside it. This catches a malformed "52/3*pi" or "(2*sqrt(2))/3" at build
  // time instead of in a document.
  const INPUTS = [
    "sector r=6 angle=60", "segment r=2 angle=180", "arc r=6 angle=120",
    "tangent r=3 d=5", "inscribed angle=80",
    "hemisphere r=3", "pyramid a=6 h=4", "prism b=4 h=3 l=10",
    "frustum r1=2 r2=5 h=4", "cap r=5 h=2", "torus R=3 r=1",
    "ellipsoid a=1 b=2 c=3", "tetrahedron a=2",
    "triangle 3 4 5", "triangle 13 14 15",
    "rotate 90 about (1,1) (2,3)", "shear x 1/2 (2,3)",
    "sector r=1/2 angle=90", "cap r=5/2 h=1/2",
  ];
  test.each(INPUTS.map((s) => [s] as const))("%s", (input) => {
    const r = solveGeometry(input);
    expect(r).not.toBeNull();
    for (const v of r!.values) {
      if (!v.exact || !Number.isFinite(v.value)) continue;
      if (v.exact.startsWith("(") && v.exact.includes(",")) continue; // a point, not a scalar
      const ast = parseExpr(v.exact);
      const evaluated = evalAst(ast, { pi: Math.PI });
      expect(evaluated).toBeCloseTo(v.value, 8);
    }
  });
});
