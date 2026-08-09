// Adversarial pass over the v2.106.0 geometry suite — the author's own attempt
// to break it BEFORE the independent pass runs. Each block tries to force a
// wrong number, a silent substitution, or a lie of omission.

import { solveGeometry } from "../geometryParse";
import { solveTriangle } from "../geometry";
import { geometryFigureSvg } from "../geometryChart";

const val = (r: ReturnType<typeof solveGeometry>, label: string) =>
  r?.values.find((x) => x.label === label);

describe("boundary angles", () => {
  test("sector angle=360 IS the circle: area πr², arc 2πr, and it says so", () => {
    const r = solveGeometry("sector r=2 angle=360")!;
    expect(val(r, "area")!.value).toBeCloseTo(4 * Math.PI, 10);
    expect(val(r, "area")!.exact).toBe("4*pi");
    expect(val(r, "arc length")!.value).toBeCloseTo(4 * Math.PI, 10);
    expect(val(r, "chord")!.value).toBeCloseTo(0, 10);
    expect(r.caveats.join(" ")).toMatch(/whole circle/);
  });

  test("segment angle=360: the full disc, area πr² — sector and segment agree", () => {
    const r = solveGeometry("segment r=2 angle=360")!;
    expect(val(r, "area")!.value).toBeCloseTo(4 * Math.PI, 8);
  });

  test("chord at 180° is the diameter, exactly", () => {
    const r = solveGeometry("arc r=5 angle=180")!;
    expect(val(r, "chord")!.value).toBeCloseTo(10, 12);
  });

  test("angle=360.5 refused; angle=360 accepted — the fence sits exactly at 360", () => {
    expect(solveGeometry("sector r=5 angle=360.5")!.degenerate).toMatch(/full turn/);
    expect(solveGeometry("sector r=5 angle=360")!.degenerate).toBeUndefined();
  });

  test("a zero or negative dimension is refused BY NAME, never area 0 or NaN", () => {
    // First cut returned null here, so the pane said "couldn't read that"
    // about input it read perfectly well — the independent pass called it out.
    expect(solveGeometry("sector r=5 angle=0")!.degenerate).toMatch(/angle = 0/);
    expect(solveGeometry("sector r=-5 angle=60")!.degenerate).toMatch(/r = -5/);
    expect(solveGeometry("torus R=0 r=1")!.degenerate).toMatch(/R = 0/);
  });

  test("a typed unit is flagged as dropped, not silently unit-checked", () => {
    const r = solveGeometry("sector r=5in angle=60")!;
    expect(r.caveats.join(" ")).toMatch(/unitless/);
  });
});

describe("degenerate solids stay consistent with their parents", () => {
  test("cap h=2r is the whole sphere: V matches 4πr³/3 exactly", () => {
    const capr = solveGeometry("cap r=3 h=6")!;
    expect(val(capr, "volume")!.value).toBeCloseTo((4 / 3) * Math.PI * 27, 10);
    expect(val(capr, "volume")!.exact).toBe("36*pi");
    expect(capr.caveats.join(" ")).toMatch(/whole sphere/);
    expect(val(capr, "base radius")!.value).toBeCloseTo(0, 12);
  });

  test("frustum r1=r2 is a cylinder: slant = h, lateral = 2πrh, and named", () => {
    const f = solveGeometry("frustum r1=3 r2=3 h=7")!;
    expect(val(f, "slant height")!.exact).toBe("7");
    expect(val(f, "lateral surface area")!.value).toBeCloseTo(2 * Math.PI * 3 * 7, 10);
    expect(val(f, "volume")!.value).toBeCloseTo(Math.PI * 9 * 7, 10);
    expect(f.caveats.join(" ")).toMatch(/cylinder/);
  });

  test("horn torus R=r computes and names itself", () => {
    const t = solveGeometry("torus R=2 r=2")!;
    expect(t.degenerate).toBeUndefined();
    expect(val(t, "volume")!.exact).toBe("16*pi^2");
    expect(t.caveats.join(" ")).toMatch(/horn torus/);
  });

  test("a sphere-shaped ellipsoid's approximate surface matches the exact sphere", () => {
    // Thomsen's formula is exact when a=b=c; if the approximation drifts from
    // 4πr² here, the implementation (not the formula) is wrong.
    const e = solveGeometry("ellipsoid a=2 b=2 c=2")!;
    expect(val(e, "surface area (approximate)")!.value).toBeCloseTo(16 * Math.PI, 6);
  });

  test("hemisphere volume is half the sphere's, by the two engines' own numbers", () => {
    const h = solveGeometry("hemisphere r=7")!;
    const s = solveGeometry("sphere r=7")!;
    expect(val(h, "volume")!.value * 2).toBeCloseTo(val(s, "volume")!.value, 8);
  });
});

describe("exactness does not launder float noise", () => {
  test("fractional inputs stay exact: sector r=1/3 angle=60 has area π/54", () => {
    const r = solveGeometry("sector r=1/3 angle=60")!;
    expect(val(r, "area")!.exact).toBe("1/54*pi");
  });

  test("pyramid with a non-pythagorean slant keeps the surd", () => {
    const r = solveGeometry("pyramid a=2 h=3")!;
    // slant = √(9 + 1) = √10
    expect(val(r, "slant height")!.exact).toBe("sqrt(10)");
    expect(val(r, "lateral surface area")!.exact).toBe("4*sqrt(10)");
    expect(val(r, "total surface area")!.exact).toBe("4 + 4*sqrt(10)");
  });

  test("tetrahedron a=1/2 keeps its tiny exact volume", () => {
    const r = solveGeometry("tetrahedron a=1/2")!;
    // V = (1/8)·√2/12 = √2/96 = √(2/9216)
    expect(val(r, "volume")!.value).toBeCloseTo(Math.SQRT2 / 96, 12);
    expect(val(r, "volume")!.exact).toContain("sqrt(2)");
  });
});

describe("transform traps", () => {
  test("rotate 30 then rotate 60 lands EXACTLY where rotate 90 does — numerically", () => {
    const chained = solveGeometry("rotate 30 then rotate 60 (1,0)")!;
    expect(val(chained, "x")!.value).toBeCloseTo(0, 10);
    expect(val(chained, "y")!.value).toBeCloseTo(1, 10);
    // And it is honest that the chain is numeric, unlike a single rotate 90.
    expect(chained.caveats.join(" ")).toMatch(/NUMERIC/);
    expect(solveGeometry("rotate 90 (1,0)")!.caveats.join(" ")).not.toMatch(/NUMERIC/);
  });

  test("scale 0 collapses the plane and says it cannot be undone", () => {
    const r = solveGeometry("scale 0 (3,4)")!;
    expect(val(r, "x")!.exact).toBe("0");
    expect(val(r, "determinant")!.exact).toBe("0");
    expect(r.steps.join(" ")).toMatch(/COLLAPSES/);
  });

  test("reflect then reflect is the identity, exactly", () => {
    const r = solveGeometry("reflect y=x then reflect y=x (5,7)")!;
    expect(val(r, "x")!.exact).toBe("5");
    expect(val(r, "y")!.exact).toBe("7");
    expect(val(r, "determinant")!.exact).toBe("1");
  });

  test("order genuinely matters and the two orders differ", () => {
    const a = solveGeometry("rotate 90 then translate 1 0 (1,0)")!;
    const b = solveGeometry("translate 1 0 then rotate 90 (1,0)")!;
    expect(val(a, "x")!.exact).toBe("1");
    expect(val(a, "y")!.exact).toBe("1");
    expect(val(b, "x")!.exact).toBe("0");
    expect(val(b, "y")!.exact).toBe("2");
  });

  test("rotate about the point itself is a fixed point", () => {
    const r = solveGeometry("rotate 90 about (2,3) (2,3)")!;
    expect(val(r, "x")!.exact).toBe("2");
    expect(val(r, "y")!.exact).toBe("3");
  });

  test("a spare pair triggers the which-point caveat, not silence", () => {
    const r = solveGeometry("rotate 90 (1,1) (2,3)")!;
    expect(r.caveats.join(" ")).toMatch(/LAST/);
    // And the LAST pair was transformed: (2,3) → (−3,2).
    expect(val(r, "x")!.exact).toBe("-3");
  });

  test("shear y direction shears y, not x", () => {
    const r = solveGeometry("shear y 2 (3,1)")!;
    expect(val(r, "x")!.exact).toBe("3");
    expect(val(r, "y")!.exact).toBe("7"); // 1 + 2·3
  });
});

describe("routing does not regress the neighbours", () => {
  test("the existing shapes still answer (no SHAPES-table collateral)", () => {
    expect(val(solveGeometry("circle r=3")!, "area")!.exact).toBe("9*pi");
    expect(val(solveGeometry("box 1 2 3")!, "volume")!.exact).toBe("6");
    expect(solveGeometry("triangle (0,0) (4,0) (0,3)")!.title).toContain("Triangle");
  });

  test("'segment' the keyword does not steal conic or composite inputs", () => {
    // A conic still classifies…
    expect(solveGeometry("x^2/9 + y^2/4 = 1")!.title).toContain("ellipse");
    // …and 'line segment' phrasing with points is not captured by the
    // mensuration table (kw is 'line', not 'segment').
    expect(solveGeometry("line (0,0) (2,4)")!.title).toBe("Line");
  });

  test("SSA still returns two triangles AND both carry both radii", () => {
    const s = solveTriangle({ kind: "SSA", a: 6, b: 8, A: 30 });
    expect(s.triangles).toHaveLength(2);
    for (const t of s.triangles) {
      expect(t.inradius).toBeGreaterThan(0);
      expect(t.circumradius).toBeGreaterThan(0);
      // Euler's inequality R ≥ 2r — a free cross-check on every triangle.
      expect(t.circumradius).toBeGreaterThanOrEqual(2 * t.inradius - 1e-9);
    }
  });

  test("an impossible triangle still refuses — radii did not break the path", () => {
    const s = solveTriangle({ kind: "SSS", a: 1, b: 1, c: 5 });
    expect(s.impossible).toMatch(/triangle inequality/);
    expect(s.triangles).toHaveLength(0);
  });

  test("degenerate conics still refuse a figure", () => {
    const r = solveGeometry("x^2 - y^2 = 0")!; // a crossed line pair
    expect(r.degenerate).toBeDefined();
    expect(r.figure).toBeUndefined();
  });
});

describe("defects found by the independent adversarial pass (v2.106.0), pinned", () => {
  test("1: a major-along-y ellipse DRAWS along y — the foci sit inside the curve", () => {
    // 25x² + 4y² = 100 has its major axis along y. The first cut always drew
    // semi-axis a along x', which rendered both foci OUTSIDE the ellipse.
    const g = solveGeometry("25*x^2 + 4*y^2 = 100")!;
    const fig = g.figure as Extract<NonNullable<typeof g.figure>, { kind: "conic" }>;
    expect(fig.alongX).toBe(false);
    const svg = geometryFigureSvg(fig);
    const curve = /<path d="([^"]+)" fill="none" stroke="#0c4a6e"/.exec(svg)![1];
    const coords = [...curve.matchAll(/[ML](-?\d+\.?\d*) (-?\d+\.?\d*)/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const w = Math.max(...coords.map((c) => c.x)) - Math.min(...coords.map((c) => c.x));
    const h = Math.max(...coords.map((c) => c.y)) - Math.min(...coords.map((c) => c.y));
    // Equal-scale projection: the drawn ellipse must be TALLER than wide (5 vs 2).
    expect(h / w).toBeGreaterThan(2);
  });

  test("1b: a y-transverse hyperbola opens along y", () => {
    const g = solveGeometry("y^2/4 - x^2/9 = 1")!;
    const fig = g.figure as Extract<NonNullable<typeof g.figure>, { kind: "conic" }>;
    expect(fig.alongX).toBe(false);
    // The vertices reported are (0, ±2); the drawn branch through t=0 must
    // pass through a vertex, i.e. the branches part along y, not x.
    const svg = geometryFigureSvg(fig);
    expect(svg).toContain("both branches");
  });

  test("1c: the x-major exemplars keep alongX true (no overcorrection)", () => {
    const e = solveGeometry("x^2/9 + y^2/4 = 1")!;
    expect((e.figure as { alongX?: boolean }).alongX).toBe(true);
    const hy = solveGeometry("x^2/4 - y^2/9 = 1")!;
    expect((hy.figure as { alongX?: boolean }).alongX).toBe(true);
  });

  test("2: near-degenerate SSA never leaks NaN angles, Infinity radii, or a NaN figure", () => {
    const g = solveGeometry("triangle a=1 b=1 A=0.0001")!;
    for (const v of g.values) {
      expect(v.value).not.toBe(Infinity);
      expect(v.value).not.toBe(-Infinity);
    }
    // The flat pseudo-solution has no circumcircle: NaN (undefined), shown "—".
    const flatR = g.values.find((v) => /circumradius/.test(v.label));
    expect(flatR).toBeDefined();
    expect(Number.isNaN(flatR!.value)).toBe(true);
    // And no figure is drawn from a zero-area triangle.
    expect(g.figure).toBeUndefined();
  });

  test("2b: the clamp keeps every SSA-built angle finite (SSS c=2 still refuses)", () => {
    // Exact degeneracy is refused by the triangle inequality — that path is
    // untouched. The clamp exists for the SSA float path, where the law of
    // sines builds a side a few ulps PAST the inequality and acos went NaN.
    expect(solveTriangle({ kind: "SSS", a: 1, b: 1, c: 2 }).impossible).toMatch(/triangle inequality/);
    const s = solveTriangle({ kind: "SSA", a: 1, b: 1, A: 0.0001 });
    expect(s.triangles.length).toBeGreaterThan(0);
    for (const t of s.triangles) {
      expect([t.A, t.B, t.C].every(Number.isFinite)).toBe(true);
      expect(t.A + t.B + t.C).toBeCloseTo(180, 6);
      expect(t.circumradius).not.toBe(Infinity);
    }
  });

  test("3: 'rotate 90 (2,3) about (1,1)' transforms (2,3), not the centre", () => {
    const r = solveGeometry("rotate 90 (2,3) about (1,1)")!;
    expect(val(r, "x")!.exact).toBe("-1");
    expect(val(r, "y")!.exact).toBe("2");
  });

  test("3b: a transform whose only pair is the centre asks for a point", () => {
    expect(solveGeometry("rotate 90 about (1,1)")!.degenerate).toMatch(/point to transform/);
  });

  test("4: extra numbers refuse instead of silently dropping", () => {
    expect(solveGeometry("rotate 90 45 (1,0)")!.degenerate).toMatch(/ONE angle/);
    expect(solveGeometry("shear x 1 2 (1,0)")!.degenerate).toMatch(/ONE factor/);
  });

  test("4b: scientific notation reads as one number — rotate 1e3 is 1000°", () => {
    const r = solveGeometry("rotate 1e3 (1,0)")!;
    // 1000° ≡ 280°; under the old tokenizer this read as 1° and dropped the 3.
    expect(val(r, "x")!.value).toBeCloseTo(Math.cos((280 * Math.PI) / 180), 8);
  });
});

describe("figure builders survive hostile shapes", () => {
  test("a needle triangle (10, 10, 19.9) still renders finite coordinates", () => {
    const g = solveGeometry("triangle 10 10 19.9")!;
    const svg = geometryFigureSvg(g.figure!);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  test("a huge-coordinate polygon scales down without NaN", () => {
    const g = solveGeometry("polygon (0,0) (1000000,0) (1000000,500000) (0,500000)")!;
    const svg = geometryFigureSvg(g.figure!);
    expect(svg).not.toContain("NaN");
  });

  test("a tiny sector (r=1/1000) draws — the projector normalises scale", () => {
    const g = solveGeometry("sector r=1/1000 angle=45")!;
    const svg = geometryFigureSvg(g.figure!);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });

  test("collinear 'polygon' points: zero area reported, figure still finite", () => {
    const g = solveGeometry("polygon (0,0) (1,1) (2,2) (3,3)")!;
    expect(g.caveats.join(" ")).toMatch(/collinear/);
    const svg = geometryFigureSvg(g.figure!);
    expect(svg).not.toContain("NaN");
  });
});
