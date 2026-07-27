// The 3D branch of the typed geometry grammar.
//
// A coordinate TRIPLE is unambiguous — the 2D grammar only ever produces pairs
// — so 3D is dispatched first and there is no reading to lose. What matters
// here is that the classification reaches the user correctly, especially the
// skew/intersecting/parallel split and the degenerate refusals.

import { solveGeometry } from "../geometryParse";

const G = (s: string) => solveGeometry(s);
const val = (r: ReturnType<typeof solveGeometry>, label: string) =>
  r!.values.find((v) => v.label === label);
const steps = (r: ReturnType<typeof solveGeometry>) => r!.steps.join(" ");

describe("vectors", () => {
  it("two vectors give dot, cross, magnitudes and angle", () => {
    const r = G("vector (1,0,0) (0,1,0)")!;
    expect(val(r, "dot product")!.exact).toBe("0");
    expect(val(r, "cross product")!.exact).toBe("(0, 0, 1)");
    expect(val(r, "angle (deg)")!.value).toBeCloseTo(90, 9);
  });
  it("perpendicular and parallel are called out in the working", () => {
    expect(steps(G("vector (1,0,0) (0,1,0)"))).toMatch(/PERPENDICULAR/);
    expect(steps(G("vector (1,2,3) (2,4,6)"))).toMatch(/PARALLEL/);
  });
  it("a single vector reports its magnitude exactly", () => {
    expect(val(G("(1,2,2)"), "magnitude")!.exact).toBe("3");
  });
  it("two bare points give the distance between them", () => {
    const r = G("(0,0,0) (1,2,2)")!;
    expect(val(r, "distance between the points")!.exact).toBe("3");
  });
});

describe("lines in space", () => {
  it("SKEW lines are identified and measured", () => {
    const r = G("lines (0,0,0) (1,0,0) (0,0,1) (1,1,2)")!;
    expect(r.title).toMatch(/skew/);
    expect(val(r, "distance between them")!.exact).toBe("sqrt(2)/2");
    expect(steps(r)).toMatch(/SKEW/);
  });
  it("intersecting lines report the meeting point, not a distance formula", () => {
    const r = G("lines (0,0,0) (1,0,0) (2,-1,0) (2,1,0)")!;
    expect(r.title).toMatch(/intersecting/);
    expect(steps(r)).toMatch(/INTERSECT at \(2, 0, 0\)/);
  });
  it("parallel lines report their separation", () => {
    const r = G("lines (0,0,0) (1,0,0) (0,3,0) (1,3,0)")!;
    expect(r.title).toMatch(/parallel/);
    expect(val(r, "distance between them")!.exact).toBe("3");
  });
  it("identical lines are named as such", () => {
    expect(G("lines (0,0,0) (1,1,1) (2,2,2) (3,3,3)")!.title).toMatch(/identical/);
  });
  it("a line and a plane: meeting point, parallel, or contained", () => {
    expect(steps(G("line (1,1,-2) (1,1,2) (0,0,0) (1,0,0) (0,1,0)"))).toMatch(/meets the plane at \(1, 1, 0\)/);
    expect(steps(G("line (0,0,5) (1,0,5) (0,0,0) (1,0,0) (0,1,0)"))).toMatch(/PARALLEL to the plane/);
    expect(steps(G("line (0,0,0) (1,1,0) (0,0,0) (1,0,0) (0,1,0)"))).toMatch(/ENTIRELY IN the plane/);
  });
});

describe("planes and solids", () => {
  it("three points give the plane equation, normal and triangle area", () => {
    const r = G("(0,0,0) (4,0,0) (0,3,0)")!;
    expect(steps(r)).toMatch(/z = 0/);
    expect(val(r, "triangle area")!.exact).toBe("6");
  });
  it("three COLLINEAR points are refused with the reason", () => {
    const r = G("(0,0,0) (1,1,1) (2,2,2)")!;
    expect(r.degenerate).toMatch(/COLLINEAR/);
  });
  it("four points give the tetrahedron volume and its circumscribed sphere", () => {
    const r = G("(0,0,0) (1,0,0) (0,1,0) (0,0,1)")!;
    expect(val(r, "tetrahedron volume")!.exact).toBe("1/6");
    expect(val(r, "sphere centre")).toBeTruthy();
  });
  it("four COPLANAR points bound no volume and lie on no unique sphere", () => {
    const r = G("(0,0,0) (1,0,0) (0,1,0) (1,1,0)")!;
    expect(val(r, "tetrahedron volume")!.exact).toBe("0");
    expect(r.caveats.some((c) => /COPLANAR/.test(c))).toBe(true);
    expect(r.degenerate).toBeTruthy();
  });
  it("the unit sphere through four of its points", () => {
    const r = G("(1,0,0) (0,1,0) (0,0,1) (-1,0,0)")!;
    expect(val(r, "sphere centre")!.exact).toBe("(0, 0, 0)");
    expect(val(r, "sphere radius")!.exact).toBe("1");
  });
});

describe("2D is unaffected by the 3D branch", () => {
  it("pairs still route to the 2D grammar", () => {
    expect(G("triangle (0,0) (4,0) (0,3)")!.values.find((v) => v.label === "area")!.exact).toBe("6");
    expect(G("distance (0,0) (3,4)")!.values.find((v) => v.label === "distance")!.exact).toBe("5");
  });
  it("conics, shapes and triangles by numbers are untouched", () => {
    expect(G("x^2/9 + y^2/4 = 1")!.title).toMatch(/ellipse/i);
    expect(G("circle r=3")!.values.find((v) => v.label === "area")!.exact).toBe("9*pi");
    expect(G("triangle 3 4 5")!.title).toMatch(/SSS/);
  });
});
