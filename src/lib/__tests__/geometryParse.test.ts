// The typed geometry grammar (geometryParse.ts).
//
// Two things are being tested: that ordinary phrasings resolve to the right
// computation, and — more importantly — that AMBIGUOUS or DEGENERATE input is
// refused or named rather than silently resolved to one reading. A geometry
// solver that quietly picks the acute SSA triangle, or calls three collinear
// points a triangle, is the same failure this product keeps designing out.

import { solveGeometry, quadraticCoeffs } from "../geometryParse";
import { parseExpr } from "../solve";
import { ratToNumber, RAT_ZERO } from "../cas";

const G = (s: string) => solveGeometry(s);
const val = (r: ReturnType<typeof solveGeometry>, label: string) =>
  r!.values.find((v) => v.label === label);

describe("quadratic coefficient extraction", () => {
  const co = (src: string) => {
    const m = quadraticCoeffs(parseExpr(src));
    if (!m) return null;
    const g = (i: number, j: number) => ratToNumber(m.get(`${i},${j}`) ?? RAT_ZERO);
    return { A: g(2, 0), B: g(1, 1), C: g(0, 2), D: g(1, 0), E: g(0, 1), F: g(0, 0) };
  };
  it("reads a plain conic", () => {
    expect(co("x^2 + y^2 - 4")).toEqual({ A: 1, B: 0, C: 1, D: 0, E: 0, F: -4 });
  });
  it("reads a cross term and linear terms", () => {
    expect(co("2*x^2 + 3*x*y - y^2 + 4*x - 5*y + 6")).toEqual({ A: 2, B: 3, C: -1, D: 4, E: -5, F: 6 });
  });
  it("expands a squared binomial", () => {
    // (x+1)^2 = x^2 + 2x + 1
    expect(co("(x+1)^2")).toEqual({ A: 1, B: 0, C: 0, D: 2, E: 0, F: 1 });
  });
  it("refuses degree 3 and transcendental terms", () => {
    expect(quadraticCoeffs(parseExpr("x^3"))).toBeNull();
    expect(quadraticCoeffs(parseExpr("sin(x) + y"))).toBeNull();
    expect(quadraticCoeffs(parseExpr("x^2*y"))).toBeNull();
  });
  it("refuses a third symbol", () => {
    expect(quadraticCoeffs(parseExpr("x^2 + y^2 + z"))).toBeNull();
  });
});

describe("conics from a bare equation, no keyword needed", () => {
  it("x^2 + y^2 = 4 → circle", () => {
    const r = G("x^2 + y^2 = 4")!;
    expect(r.title).toMatch(/circle/i);
    expect(val(r, "eccentricity")!.value).toBeCloseTo(0, 9);
  });
  it("x^2/9 + y^2/4 = 1 → ellipse with the right axes", () => {
    const r = G("x^2/9 + y^2/4 = 1")!;
    expect(r.title).toMatch(/ellipse/i);
    expect(val(r, "semi-axis a")!.value).toBeCloseTo(3, 8);
    expect(val(r, "semi-axis b")!.value).toBeCloseTo(2, 8);
  });
  it("x^2 - y^2 = 1 → hyperbola", () => {
    const r = G("x^2 - y^2 = 1")!;
    expect(r.title).toMatch(/hyperbola/i);
    expect(val(r, "eccentricity")!.value).toBeCloseTo(Math.SQRT2, 8);
  });
  it("y^2 = 4x → parabola", () => {
    expect(G("y^2 = 4*x")!.title).toMatch(/parabola/i);
  });
  it("x*y = 1 → hyperbola, and the rotation is reported", () => {
    const r = G("x*y = 1")!;
    expect(r.title).toMatch(/hyperbola/i);
    expect(Math.abs(val(r, "rotation (deg)")!.value)).toBeCloseTo(45, 6);
  });
  it("a degenerate conic is NAMED, not dressed up", () => {
    const pointConic = G("x^2 + y^2 = 0")!;
    expect(pointConic.title).toMatch(/point/i);
    expect(pointConic.degenerate).toBeTruthy();

    const empty = G("x^2 + y^2 = -1")!;
    expect(empty.title).toMatch(/empty/i);

    const pair = G("x^2 - y^2 = 0")!;
    expect(pair.title).toMatch(/line pair/i);
  });
  it("the general form and both invariants appear in the working", () => {
    const r = G("4*x^2 + 9*y^2 = 36")!;
    const s = r.steps.join(" ");
    expect(s).toMatch(/General form/);
    expect(s).toMatch(/δ/);
    expect(s).toMatch(/Canonical form/);
  });
});

describe("triangles", () => {
  it("SSS from three bare numbers", () => {
    const r = G("triangle 3 4 5")!;
    expect(r.title).toMatch(/SSS/);
    expect(val(r, "area")!.value).toBeCloseTo(6, 9);
    expect(val(r, "C")!.value).toBeCloseTo(90, 8);
  });
  it("SAS from two sides and the included angle", () => {
    const r = G("triangle b=4 c=3 A=90")!;
    expect(r.title).toMatch(/SAS/);
    expect(val(r, "a")!.value).toBeCloseTo(5, 8);
  });
  it("ASA from two angles and a side", () => {
    const r = G("triangle A=30 B=60 c=10")!;
    expect(r.title).toMatch(/ASA/);
    expect(val(r, "a")!.value).toBeCloseTo(5, 8);
  });
  it("SSA returns BOTH triangles, labelled", () => {
    const r = G("triangle a=6 b=8 A=30")!;
    expect(r.title).toMatch(/SSA/);
    expect(val(r, "a (solution 1)")).toBeTruthy();
    expect(val(r, "a (solution 2)")).toBeTruthy();
    expect(r.caveats.some((c) => /TWO triangles/i.test(c))).toBe(true);
  });
  it("an impossible triangle is refused with a reason", () => {
    const r = G("triangle 1 2 10")!;
    expect(r.values.length).toBe(0);
    expect(r.degenerate).toMatch(/triangle inequality/i);
  });
  it("triangle from coordinates gives centres and the Euler-line check", () => {
    const r = G("triangle (0,0) (4,0) (0,3)")!;
    expect(val(r, "area")!.exact).toBe("6");
    const s = r.steps.join(" ");
    expect(s).toMatch(/Euler line check/);
    expect(s).toMatch(/verified exactly/);
  });
  it("three collinear points are called out, not solved", () => {
    const r = G("triangle (0,0) (1,1) (2,2)")!;
    expect(r.caveats.some((c) => /COLLINEAR/i.test(c))).toBe(true);
  });
});

describe("points, lines, polygons", () => {
  it("distance between two points, exact", () => {
    const r = G("distance (0,0) (3,4)")!;
    expect(val(r, "distance")!.exact).toBe("5");
  });
  it("a line reports its equation and slope", () => {
    const r = G("line (0,0) (2,4)")!;
    expect(val(r, "slope")!.value).toBeCloseTo(2, 9);
    expect(r.steps.join(" ")).toMatch(/x \+|y =|x \+ /);
  });
  it("parallel lines are named", () => {
    const r = G("line (0,0) (1,1) (0,1) (1,2)")!;
    expect(r.steps.join(" ")).toMatch(/PARALLEL/);
  });
  it("polygon area is exact and respects the vertex ORDER", () => {
    // The listed order walks out to the interior point (2,2) last, cutting a
    // notch out of the square — so the enclosed area is 12, not the hull's 16.
    // Shoelace is order-dependent by definition, and that is the correct answer
    // for the polygon the user actually typed.
    const r = G("polygon (0,0) (4,0) (4,4) (0,4) (2,2)")!;
    expect(r.values.find((v) => v.label === "area")!.exact).toBe("12");
    expect(r.steps.join(" ")).toMatch(/Convex hull uses 4 of the 5/);
    expect(r.steps.join(" ")).toMatch(/Convex: no/);
  });

  it("the same points in convex order give the full square", () => {
    const r = G("polygon (0,0) (4,0) (4,4) (0,4)")!;
    expect(r.values.find((v) => v.label === "area")!.exact).toBe("16");
    expect(r.steps.join(" ")).toMatch(/Convex: yes/);
  });
  it("circle through three points, exact centre", () => {
    const r = G("circle (1,0) (0,1) (-1,0)")!;
    expect(val(r, "centre x")!.exact).toBe("0");
    expect(val(r, "radius")!.exact).toBe("1");
  });
  it("circle through three COLLINEAR points is refused", () => {
    const r = G("circle (0,0) (1,1) (2,2)")!;
    expect(r.degenerate).toMatch(/COLLINEAR/i);
  });
});

describe("mensuration by keyword", () => {
  it("circle r=3 keeps π exact", () => {
    const r = G("circle r=3")!;
    expect(val(r, "area")!.exact).toBe("9*pi");
  });
  it("sphere, cylinder, cone, box, rectangle, square all resolve", () => {
    expect(G("sphere r=3")).toBeTruthy();
    expect(G("cylinder r=2 h=5")).toBeTruthy();
    expect(G("cone r=3 h=4")).toBeTruthy();
    expect(G("box 1 2 3")).toBeTruthy();
    expect(G("rectangle 3 4")).toBeTruthy();
    expect(G("square a=2")).toBeTruthy();
  });
  it("regular polygon by n and a", () => {
    const r = G("polygon n=6 a=2")!;
    expect(val(r, "interior angle")!.value).toBeCloseTo(120, 9);
  });
});

describe("refusals", () => {
  it("returns null on input that is not geometry at all", () => {
    expect(G("")).toBeNull();
    expect(G("hello there")).toBeNull();
    expect(G("42")).toBeNull();
  });
  it("returns null rather than guessing on an under-specified triangle", () => {
    expect(G("triangle a=3")).toBeNull();
    expect(G("triangle A=30 B=60")).toBeNull();
  });
  it("a linear equation is not reported as a conic", () => {
    expect(G("2*x + 3*y = 6")).toBeNull();
  });
});
