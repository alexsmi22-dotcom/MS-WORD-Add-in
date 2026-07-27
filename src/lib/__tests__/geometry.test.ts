// Geometry (geometry.ts) — Tiers 1–2 of docs/GEOMETRY-TOPOLOGY-DESIGN.md.
//
// Tested against CLOSED-FORM ORACLES rather than against itself: the 3-4-5
// triangle, the equilateral area √3/4·s², a circle through three known points.
// Plus the property checks the design calls for — Euler-line collinearity,
// shoelace invariance under vertex rotation and sign flip under reversal — and
// the degenerate cases, which are the whole reason this module exists rather
// than a handful of formulas.

import {
  pt, distance, distanceSquared, midpoint, collinear, lineThrough, lineIntersect,
  pointLineDistance, polygonArea, polygonSignedArea, polygonCentroid, isConvex,
  pointInPolygon, convexHull, triangleCentres, circleFrom3Points, solveTriangle,
  classifyConic, shapeMetrics, fmtRat, fmtSqrtRat,
} from "../geometry";
import { ratInt, ratMake, ratToNumber, ratFromNumber } from "../cas";

const N = (r: { n: bigint; d: bigint }) => ratToNumber(r);
const R = (v: number) => ratFromNumber(v);

describe("exact formatting", () => {
  it("rationals print exactly", () => {
    expect(fmtRat(ratMake(7n, 2n))).toBe("7/2");
    expect(fmtRat(ratInt(3))).toBe("3");
  });
  it("square roots simplify rather than decimalise", () => {
    expect(fmtSqrtRat(ratInt(9))).toBe("3");
    expect(fmtSqrtRat(ratInt(12))).toBe("2*sqrt(3)");
    expect(fmtSqrtRat(ratInt(2))).toBe("sqrt(2)");
    expect(fmtSqrtRat(ratMake(1n, 4n))).toBe("(1)/2");
    expect(fmtSqrtRat(ratInt(-1))).toBeNull();
  });
});

describe("points, lines and distance", () => {
  it("3-4-5: distance is exactly 5", () => {
    const d = distance(pt(0, 0), pt(3, 4));
    expect(d.value).toBeCloseTo(5, 12);
    expect(d.exact).toBe("5");
  });
  it("an irrational distance keeps its surd", () => {
    const d = distance(pt(0, 0), pt(1, 1));
    expect(d.exact).toBe("sqrt(2)");
    expect(d.value).toBeCloseTo(Math.SQRT2, 12);
  });
  it("midpoint is exact", () => {
    const m = midpoint(pt(0, 0), pt(3, 5));
    expect(fmtRat(m.x)).toBe("3/2");
    expect(fmtRat(m.y)).toBe("5/2");
  });
  it("line through two points, and intersection", () => {
    const l = lineThrough(pt(0, 0), pt(2, 2))!;
    const m = lineThrough(pt(0, 2), pt(2, 0))!;
    const r = lineIntersect(l, m);
    expect(r.kind).toBe("point");
    if (r.kind === "point") {
      expect(N(r.p.x)).toBeCloseTo(1, 12);
      expect(N(r.p.y)).toBeCloseTo(1, 12);
    }
  });
  it("parallel and identical lines are NAMED, not intersected", () => {
    const l = lineThrough(pt(0, 0), pt(1, 1))!;
    const par = lineThrough(pt(0, 1), pt(1, 2))!;
    const same = lineThrough(pt(2, 2), pt(3, 3))!;
    expect(lineIntersect(l, par).kind).toBe("parallel");
    expect(lineIntersect(l, same).kind).toBe("same");
  });
  it("two coincident points define no line", () => {
    expect(lineThrough(pt(1, 1), pt(1, 1))).toBeNull();
  });
  it("point-to-line distance, exact", () => {
    // x + y = 0, point (1,1): distance 2/√2 = √2
    const l = lineThrough(pt(0, 0), pt(1, -1))!;
    const d = pointLineDistance(pt(1, 1), l);
    expect(d.value).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe("polygons", () => {
  const unitSquare = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];
  const tri = [pt(0, 0), pt(4, 0), pt(0, 3)];

  it("shoelace area is exact", () => {
    expect(fmtRat(polygonArea(unitSquare))).toBe("1");
    expect(fmtRat(polygonArea(tri))).toBe("6");
  });
  it("area is invariant under vertex rotation and flips sign under reversal", () => {
    const a0 = polygonSignedArea(tri);
    const rotated = [tri[1], tri[2], tri[0]];
    expect(fmtRat(polygonSignedArea(rotated))).toBe(fmtRat(a0));
    const reversed = tri.slice().reverse();
    expect(N(polygonSignedArea(reversed))).toBeCloseTo(-N(a0), 12);
  });
  it("centroid of the unit square is its centre", () => {
    const c = polygonCentroid(unitSquare)!;
    expect(fmtRat(c.x)).toBe("1/2");
    expect(fmtRat(c.y)).toBe("1/2");
  });
  it("a zero-area polygon has no centroid", () => {
    expect(polygonCentroid([pt(0, 0), pt(1, 1), pt(2, 2)])).toBeNull();
  });
  it("convexity", () => {
    expect(isConvex(unitSquare)).toBe(true);
    // A chevron.
    expect(isConvex([pt(0, 0), pt(2, 0), pt(1, 1), pt(2, 2), pt(0, 2)])).toBe(false);
  });
  it("point-in-polygon distinguishes the BOUNDARY", () => {
    expect(pointInPolygon(pt(ratMake(1n, 2n), ratMake(1n, 2n)), unitSquare)).toBe("inside");
    expect(pointInPolygon(pt(2, 2), unitSquare)).toBe("outside");
    expect(pointInPolygon(pt(0, 0), unitSquare)).toBe("boundary");
    expect(pointInPolygon(pt(ratMake(1n, 2n), ratInt(0)), unitSquare)).toBe("boundary");
  });
  it("convex hull drops interior points", () => {
    const hull = convexHull([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4), pt(2, 2), pt(1, 1)]);
    expect(hull.length).toBe(4);
    expect(N(polygonArea(hull))).toBeCloseTo(16, 12);
  });
});

describe("triangle centres and the Euler line", () => {
  it("3-4-5 right triangle: centres are exact and the Euler line holds", () => {
    const c = triangleCentres(pt(0, 0), pt(4, 0), pt(0, 3))!;
    expect(fmtRat(c.centroid.x)).toBe("4/3");
    expect(fmtRat(c.centroid.y)).toBe("1");
    // Circumcentre of a right triangle is the hypotenuse midpoint.
    expect(N(c.circumcentre!.x)).toBeCloseTo(2, 12);
    expect(N(c.circumcentre!.y)).toBeCloseTo(1.5, 12);
    // Orthocentre of a right triangle is the right-angle vertex.
    expect(N(c.orthocentre!.x)).toBeCloseTo(0, 12);
    expect(N(c.orthocentre!.y)).toBeCloseTo(0, 12);
    expect(c.eulerLineCollinear).toBe(true);
  });
  it("the Euler line is collinear for many random rational triangles", () => {
    const TRIS: [number, number, number, number, number, number][] = [
      [0, 0, 5, 0, 2, 6], [1, 1, 7, 2, 3, 9], [-3, 0, 4, 1, 0, 5],
      [0, 0, 1, 0, 0, 1], [2, -3, 8, 1, -1, 4], [10, 0, 0, 7, -5, -2],
    ];
    for (const [ax, ay, bx, by, cx, cy] of TRIS) {
      const c = triangleCentres(pt(ax, ay), pt(bx, by), pt(cx, cy));
      expect(c).not.toBeNull();
      expect(c!.eulerLineCollinear).toBe(true);
    }
  });
  it("collinear points have no triangle centres", () => {
    expect(triangleCentres(pt(0, 0), pt(1, 1), pt(2, 2))).toBeNull();
    expect(circleFrom3Points(pt(0, 0), pt(1, 1), pt(2, 2))).toBeNull();
  });
  it("circle through three points on the unit circle has centre 0 and r² = 1", () => {
    const c = circleFrom3Points(pt(1, 0), pt(0, 1), pt(-1, 0))!;
    expect(N(c.centre.x)).toBeCloseTo(0, 12);
    expect(N(c.centre.y)).toBeCloseTo(0, 12);
    expect(N(c.r2)).toBeCloseTo(1, 12);
  });
});

describe("triangle solving", () => {
  it("SSS 3-4-5 is right-angled, area 6", () => {
    const r = solveTriangle({ kind: "SSS", a: 3, b: 4, c: 5 });
    expect(r.triangles.length).toBe(1);
    const t = r.triangles[0];
    expect(t.C).toBeCloseTo(90, 9);
    expect(t.area).toBeCloseTo(6, 9);
    expect(t.areaExact).toBe("6");
  });
  it("equilateral side 2 has area √3, exactly", () => {
    const t = solveTriangle({ kind: "SSS", a: 2, b: 2, c: 2 }).triangles[0];
    expect(t.A).toBeCloseTo(60, 9);
    expect(t.area).toBeCloseTo(Math.sqrt(3), 9);
    expect(t.areaExact).toBe("sqrt(3)");
  });
  it("the triangle inequality is enforced, with a reason", () => {
    const r = solveTriangle({ kind: "SSS", a: 1, b: 2, c: 10 });
    expect(r.triangles.length).toBe(0);
    expect(r.impossible).toMatch(/triangle inequality/i);
  });
  it("SAS", () => {
    // b=4, c=3, included A=90 → a=5
    const t = solveTriangle({ kind: "SAS", b: 4, c: 3, A: 90 }).triangles[0];
    expect(t.a).toBeCloseTo(5, 9);
    expect(t.area).toBeCloseTo(6, 9);
  });
  it("ASA/AAS reproduce a known triangle", () => {
    const t = solveTriangle({ kind: "ASA", A: 30, B: 60, c: 10 }).triangles[0];
    expect(t.C).toBeCloseTo(90, 9);
    expect(t.a).toBeCloseTo(5, 9);
    expect(t.b).toBeCloseTo(5 * Math.sqrt(3), 8);
  });
  it("angles that leave nothing for the third are refused", () => {
    const r = solveTriangle({ kind: "ASA", A: 120, B: 70, c: 4 });
    expect(r.impossible).toMatch(/less than 180/);
  });

  // The ambiguous case — the reason this function exists.
  it("SSA with TWO solutions returns both", () => {
    // a=6, b=8, A=30°: h = 8·sin30 = 4 < 6 < 8 → two triangles.
    const r = solveTriangle({ kind: "SSA", a: 6, b: 8, A: 30 });
    expect(r.triangles.length).toBe(2);
    expect(r.caveats.some((c) => /TWO triangles/i.test(c))).toBe(true);
    // Both must genuinely satisfy the law of sines.
    for (const t of r.triangles) {
      expect(t.a).toBeCloseTo(6, 6);
      expect(t.b).toBeCloseTo(8, 6);
      expect(t.A).toBeCloseTo(30, 4);
    }
    // and they must be different triangles
    expect(Math.abs(r.triangles[0].c - r.triangles[1].c)).toBeGreaterThan(1e-3);
  });
  it("SSA with NO solution says why", () => {
    // a=2, b=8, A=30°: h = 4 > 2 → cannot close.
    const r = solveTriangle({ kind: "SSA", a: 2, b: 8, A: 30 });
    expect(r.triangles.length).toBe(0);
    expect(r.impossible).toMatch(/altitude/i);
  });
  it("SSA with exactly ONE solution (right-angled boundary)", () => {
    // a = h exactly: a = 8·sin30 = 4
    const r = solveTriangle({ kind: "SSA", a: 4, b: 8, A: 30 });
    expect(r.triangles.length).toBe(1);
    expect(r.caveats.some((c) => /right-angled/i.test(c))).toBe(true);
  });
  it("SSA with a >= b gives exactly one triangle", () => {
    const r = solveTriangle({ kind: "SSA", a: 10, b: 8, A: 30 });
    expect(r.triangles.length).toBe(1);
  });
});

describe("conic classification", () => {
  const conic = (A: number, B: number, C: number, D: number, E: number, F: number) =>
    classifyConic(R(A), R(B), R(C), R(D), R(E), R(F));

  it("x² + y² = 4 is a circle", () => {
    const r = conic(1, 0, 1, 0, 0, -4);
    expect(r.kind).toBe("circle");
    expect(r.degenerate).toBe(false);
    expect(r.a).toBeCloseTo(2, 9);
    expect(r.eccentricity).toBeCloseTo(0, 9);
  });
  it("x²/9 + y²/4 = 1 is an ellipse with the right axes and eccentricity", () => {
    // 4x² + 9y² − 36 = 0
    const r = conic(4, 0, 9, 0, 0, -36);
    expect(r.kind).toBe("ellipse");
    expect(r.a).toBeCloseTo(3, 9);
    expect(r.b).toBeCloseTo(2, 9);
    expect(r.eccentricity!).toBeCloseTo(Math.sqrt(5) / 3, 8);
    expect(r.foci!.length).toBe(2);
  });
  it("x² − y² = 1 is a hyperbola with eccentricity √2", () => {
    const r = conic(1, 0, -1, 0, 0, -1);
    expect(r.kind).toBe("hyperbola");
    expect(r.eccentricity!).toBeCloseTo(Math.SQRT2, 8);
    expect(r.asymptotes!.length).toBeGreaterThan(0);
  });
  it("y² = 4x is a parabola, eccentricity exactly 1", () => {
    const r = conic(0, 0, 1, -4, 0, 0);
    expect(r.kind).toBe("parabola");
    expect(r.eccentricity).toBe(1);
    expect(r.centre).toBeUndefined();
  });
  it("xy = 1 is a hyperbola, found only by rotating", () => {
    const r = conic(0, 1, 0, 0, 0, -1);
    expect(r.kind).toBe("hyperbola");
    expect(Math.abs(r.rotationDeg)).toBeCloseTo(45, 6);
  });

  // Degenerate cases — named, not forced into a real conic.
  it("x² + y² = 0 is a POINT, not an ellipse", () => {
    const r = conic(1, 0, 1, 0, 0, 0);
    expect(r.kind).toBe("point");
    expect(r.degenerate).toBe(true);
    expect(r.caveats.some((c) => /DEGENERATE/i.test(c))).toBe(true);
  });
  it("x² − y² = 0 is a crossed LINE PAIR", () => {
    const r = conic(1, 0, -1, 0, 0, 0);
    expect(r.kind).toBe("line pair");
    expect(r.degenerate).toBe(true);
  });
  it("x² + y² = −1 is EMPTY over the reals, not an ellipse", () => {
    const r = conic(1, 0, 1, 0, 0, 1);
    expect(r.kind).toBe("empty");
    expect(r.caveats.some((c) => /no real solutions/i.test(c))).toBe(true);
  });
  it("no quadratic terms is reported as linear, not a conic", () => {
    const r = conic(0, 0, 0, 1, 1, -1);
    expect(r.kind).toBe("single line");
  });
  it("the invariants are reported in the steps", () => {
    const r = conic(4, 0, 9, 0, 0, -36);
    expect(r.steps.join(" ")).toMatch(/δ = B² − 4AC/);
    expect(r.steps.join(" ")).toMatch(/Δ/);
  });
});

describe("mensuration", () => {
  it("circle area and circumference stay exact in π", () => {
    const r = shapeMetrics({ shape: "circle", dims: { r: 3 } })!;
    const area = r.values.find((v) => v.label === "area")!;
    expect(area.exact).toBe("9*pi");
    expect(area.value).toBeCloseTo(Math.PI * 9, 12);
    expect(r.values.find((v) => v.label === "circumference")!.exact).toBe("6*pi");
  });
  it("sphere volume is 4πr³/3, exactly", () => {
    const r = shapeMetrics({ shape: "sphere", dims: { r: 3 } })!;
    const v = r.values.find((x) => x.label === "volume")!;
    expect(v.value).toBeCloseTo((4 / 3) * Math.PI * 27, 9);
    expect(v.exact).toBe("36*pi");
  });
  it("square diagonal keeps its surd", () => {
    const r = shapeMetrics({ shape: "square", dims: { a: 2 } })!;
    expect(r.values.find((v) => v.label === "diagonal")!.exact).toBe("2*sqrt(2)");
  });
  it("box metrics", () => {
    const r = shapeMetrics({ shape: "box", dims: { a: 1, b: 2, c: 3 } })!;
    expect(r.values.find((v) => v.label === "volume")!.value).toBeCloseTo(6, 12);
    expect(r.values.find((v) => v.label === "surface area")!.value).toBeCloseTo(22, 12);
  });
  it("regular polygon interior angle", () => {
    const r = shapeMetrics({ shape: "regular-polygon", dims: { n: 6, a: 2 } })!;
    expect(r.values.find((v) => v.label === "interior angle")!.value).toBeCloseTo(120, 9);
    // Regular hexagon of side 2 has area 6√3.
    expect(r.values.find((v) => v.label === "area")!.value).toBeCloseTo(6 * Math.sqrt(3), 6);
  });
  it("rejects non-positive or missing dimensions rather than returning nonsense", () => {
    expect(shapeMetrics({ shape: "circle", dims: { r: -1 } })).toBeNull();
    expect(shapeMetrics({ shape: "circle", dims: {} })).toBeNull();
    expect(shapeMetrics({ shape: "nope", dims: { r: 1 } })).toBeNull();
  });
});
