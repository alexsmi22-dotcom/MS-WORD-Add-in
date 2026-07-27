// 3D geometry (geometry3d.ts) — Tiers 3–4.
//
// Oracles rather than self-agreement: the standard basis vectors, the unit
// tetrahedron (volume 1/6), a 3-4-5 right triangle embedded in a plane, the
// unit sphere through four known points. The cases that earn the module its
// place are the DEGENERATE ones — collinear points define no plane, coplanar
// points bound no tetrahedron and lie on no unique sphere, and two lines can be
// parallel, intersecting or genuinely SKEW. The skew-distance formula divides
// by |d₁ × d₂|, which vanishes exactly when the lines are parallel, so getting
// that split right is the whole job.

import {
  v3, vAdd, vSub, dot, cross, tripleProduct, norm, normSquared, angleBetween,
  project, isZeroVec, planeFrom3, pointPlaneDistance, anglePlanes, fmtPlane,
  lineFrom2, classifyLines, linePlaneIntersect, parallelepipedVolume,
  tetrahedronVolume, triangleArea3, sphereFrom4, mat3Det, mat3Apply, mat3Mul,
  scaleMatrix, reflectionMatrix, rotationMatrix, transformEffect, fmtVec,
} from "../geometry3d";
import { fmtRat } from "../geometry";
import { ratToNumber, ratInt } from "../cas";

const N = (r: { n: bigint; d: bigint }) => ratToNumber(r);
const ex = v3(1, 0, 0), ey = v3(0, 1, 0), ez = v3(0, 0, 1);

describe("vector algebra is exact", () => {
  it("dot and cross of the standard basis", () => {
    expect(fmtRat(dot(ex, ey))).toBe("0");
    expect(fmtRat(dot(ex, ex))).toBe("1");
    expect(fmtVec(cross(ex, ey))).toBe("(0, 0, 1)");
    expect(fmtVec(cross(ey, ex))).toBe("(0, 0, -1)"); // anticommutative
    expect(isZeroVec(cross(ex, ex))).toBe(true);
  });
  it("cross product is perpendicular to both inputs", () => {
    const a = v3(1, 2, 3), b = v3(4, 5, 6);
    const c = cross(a, b);
    expect(fmtRat(dot(c, a))).toBe("0");
    expect(fmtRat(dot(c, b))).toBe("0");
  });
  it("scalar triple product equals the determinant, and detects coplanarity", () => {
    expect(fmtRat(tripleProduct(ex, ey, ez))).toBe("1");
    // Three coplanar vectors have triple product exactly zero.
    expect(fmtRat(tripleProduct(v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0)))).toBe("0");
  });
  it("magnitude keeps its surd", () => {
    expect(norm(v3(1, 2, 2)).exact).toBe("3");        // 1+4+4 = 9
    expect(norm(v3(1, 1, 1)).exact).toBe("sqrt(3)");
    expect(norm(v3(1, 1, 0)).value).toBeCloseTo(Math.SQRT2, 12);
  });
  it("angles: perpendicular is 90, parallel is 0, opposite is 180", () => {
    expect(angleBetween(ex, ey)!).toBeCloseTo(90, 9);
    expect(angleBetween(ex, v3(2, 0, 0))!).toBeCloseTo(0, 9);
    expect(angleBetween(ex, v3(-1, 0, 0))!).toBeCloseTo(180, 9);
    expect(angleBetween(ex, v3(0, 0, 0))).toBeNull(); // zero vector has no direction
  });
  it("projection splits a vector into parallel and perpendicular parts, exactly", () => {
    const a = v3(3, 4, 0);
    const p = project(a, ex)!;
    expect(fmtVec(p.proj)).toBe("(3, 0, 0)");
    expect(fmtVec(p.rej)).toBe("(0, 4, 0)");
    // The parts must reconstruct a, and be perpendicular.
    expect(fmtVec(vAdd(p.proj, p.rej))).toBe(fmtVec(a));
    expect(fmtRat(dot(p.proj, p.rej))).toBe("0");
  });
  it("projecting onto the zero vector is refused", () => {
    expect(project(v3(1, 1, 1), v3(0, 0, 0))).toBeNull();
  });
});

describe("planes", () => {
  it("plane through three points, with the expected normal", () => {
    const pl = planeFrom3(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))!;
    expect(fmtVec(pl.n)).toBe("(0, 0, 1)");   // the xy-plane
    expect(fmtRat(pl.d)).toBe("0");
    expect(fmtPlane(pl)).toBe("z = 0");
  });
  it("COLLINEAR points define no plane", () => {
    expect(planeFrom3(v3(0, 0, 0), v3(1, 1, 1), v3(2, 2, 2))).toBeNull();
  });
  it("point-to-plane distance is exact", () => {
    const pl = planeFrom3(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))!; // z = 0
    expect(pointPlaneDistance(v3(5, 7, 3), pl).exact).toBe("3");
    expect(pointPlaneDistance(v3(5, 7, 0), pl).value).toBeCloseTo(0, 12);
    // x + y + z = 0, point (1,1,1): distance 3/√3 = √3
    const diag = planeFrom3(v3(0, 0, 0), v3(1, -1, 0), v3(0, 1, -1))!;
    expect(pointPlaneDistance(v3(1, 1, 1), diag).value).toBeCloseTo(Math.sqrt(3), 10);
  });
  it("angle between planes is the acute dihedral angle", () => {
    const xy = planeFrom3(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))!;
    const xz = planeFrom3(v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 1))!;
    expect(anglePlanes(xy, xz)!).toBeCloseTo(90, 9);
    expect(anglePlanes(xy, xy)!).toBeCloseTo(0, 9);
  });
});

describe("lines in 3D — the classification is the point", () => {
  it("identical lines", () => {
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 1, 1))!;
    const l2 = lineFrom2(v3(2, 2, 2), v3(3, 3, 3))!;
    expect(classifyLines(l1, l2).kind).toBe("identical");
  });
  it("parallel lines report their separation exactly", () => {
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 0, 0))!;   // the x-axis
    const l2 = lineFrom2(v3(0, 3, 0), v3(1, 3, 0))!;   // parallel, 3 away
    const r = classifyLines(l1, l2);
    expect(r.kind).toBe("parallel");
    if (r.kind === "parallel") expect(r.distance.exact).toBe("3");
  });
  it("intersecting lines report the meeting point", () => {
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 0, 0))!;   // x-axis
    const l2 = lineFrom2(v3(2, -1, 0), v3(2, 1, 0))!;  // crosses at (2,0,0)
    const r = classifyLines(l1, l2);
    expect(r.kind).toBe("intersecting");
    if (r.kind === "intersecting") expect(fmtVec(r.at)).toBe("(2, 0, 0)");
  });
  it("SKEW lines — the case the formula exists for", () => {
    // x-axis, and a line parallel to y through (0,0,1): skew, distance 1.
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 0, 0))!;
    const l2 = lineFrom2(v3(0, 0, 1), v3(0, 1, 1))!;
    const r = classifyLines(l1, l2);
    expect(r.kind).toBe("skew");
    if (r.kind === "skew") expect(r.distance.exact).toBe("1");
  });
  it("a skew pair with an irrational separation keeps the surd", () => {
    // x-axis, and a line through (0,0,1) in direction (1,1,1).
    // d₁×d₂ = (0,−1,1), w = (0,0,1), triple = 1 ≠ 0 so they are skew;
    // distance = 1/√2 = √2/2.
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 0, 0))!;
    const l2 = lineFrom2(v3(0, 0, 1), v3(1, 1, 2))!;
    const r = classifyLines(l1, l2);
    expect(r.kind).toBe("skew");
    if (r.kind === "skew") {
      expect(r.distance.value).toBeCloseTo(Math.SQRT2 / 2, 10);
      expect(r.distance.exact).toBe("sqrt(2)/2");
    }
  });

  it("coplanar-but-not-parallel lines INTERSECT, they are not skew", () => {
    // The pair I first mistook for skew: the triple product is exactly 0, so
    // they are coplanar and meet at the origin. Exact arithmetic makes that
    // distinction reliable — a tolerance-based test could go either way.
    const l1 = lineFrom2(v3(0, 0, 0), v3(1, 0, 0))!;
    const l2 = lineFrom2(v3(0, 1, 1), v3(0, 2, 2))!;
    const r = classifyLines(l1, l2);
    expect(r.kind).toBe("intersecting");
    if (r.kind === "intersecting") expect(fmtVec(r.at)).toBe("(0, 0, 0)");
  });
  it("two coincident points define no line", () => {
    expect(lineFrom2(v3(1, 1, 1), v3(1, 1, 1))).toBeNull();
  });
  it("line meets plane, is parallel to it, or lies inside it", () => {
    const xy = planeFrom3(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))!; // z = 0
    const through = lineFrom2(v3(1, 1, -2), v3(1, 1, 2))!;
    const r1 = linePlaneIntersect(through, xy);
    expect(r1.kind).toBe("point");
    if (r1.kind === "point") expect(fmtVec(r1.at)).toBe("(1, 1, 0)");

    const parallel = lineFrom2(v3(0, 0, 5), v3(1, 0, 5))!;
    expect(linePlaneIntersect(parallel, xy).kind).toBe("parallel");

    const inside = lineFrom2(v3(0, 0, 0), v3(1, 1, 0))!;
    expect(linePlaneIntersect(inside, xy).kind).toBe("in-plane");
  });
});

describe("volumes, areas and spheres", () => {
  it("the unit cube has volume 1 and the unit tetrahedron 1/6", () => {
    expect(fmtRat(parallelepipedVolume(ex, ey, ez))).toBe("1");
    expect(fmtRat(tetrahedronVolume(v3(0, 0, 0), ex, ey, ez))).toBe("1/6");
  });
  it("coplanar points bound no volume", () => {
    expect(fmtRat(tetrahedronVolume(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0)))).toBe("0");
  });
  it("triangle area in 3D matches the 2D answer when it lies in a plane", () => {
    // 3-4-5 right triangle in the xy-plane: area 6.
    expect(triangleArea3(v3(0, 0, 0), v3(4, 0, 0), v3(0, 3, 0)).exact).toBe("6");
    // An equilateral triangle of side √2 has area √3/2.
    const a = triangleArea3(ex, ey, ez);
    expect(a.value).toBeCloseTo(Math.sqrt(3) / 2, 10);
  });
  it("sphere through four points on the unit sphere", () => {
    const s = sphereFrom4(ex, ey, ez, v3(-1, 0, 0))!;
    expect(fmtVec(s.centre)).toBe("(0, 0, 0)");
    expect(fmtRat(s.r2)).toBe("1");
  });
  it("COPLANAR points lie on no unique sphere", () => {
    expect(sphereFrom4(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0))).toBeNull();
  });
});

describe("transformations", () => {
  it("scaling multiplies volume by the product of the factors", () => {
    const m = scaleMatrix(2, 3, 4);
    expect(fmtRat(mat3Det(m))).toBe("24");
    const e = transformEffect(m);
    expect(e.volumeScale).toBeCloseTo(24, 9);
    expect(e.flipsOrientation).toBe(false);
    expect(e.singular).toBe(false);
  });
  it("a reflection has determinant -1 and FLIPS orientation", () => {
    for (const p of ["xy", "yz", "zx"] as const) {
      const m = reflectionMatrix(p);
      expect(fmtRat(mat3Det(m))).toBe("-1");
      expect(transformEffect(m).flipsOrientation).toBe(true);
    }
  });
  it("a rotation preserves volume and lengths", () => {
    const m = rotationMatrix("z", 37);
    expect(ratToNumber(mat3Det(m))).toBeCloseTo(1, 9);
    const v = v3(3, 4, 5);
    expect(Math.sqrt(ratToNumber(normSquared(mat3Apply(m, v))))).toBeCloseTo(Math.sqrt(50), 8);
  });
  it("a 90 degree rotation about z sends x to y", () => {
    const r = mat3Apply(rotationMatrix("z", 90), ex);
    expect(ratToNumber(r.x)).toBeCloseTo(0, 9);
    expect(ratToNumber(r.y)).toBeCloseTo(1, 9);
  });
  it("composition multiplies determinants", () => {
    const a = scaleMatrix(2, 2, 2), b = reflectionMatrix("xy");
    expect(ratToNumber(mat3Det(mat3Mul(a, b)))).toBeCloseTo(8 * -1, 9);
  });
  it("a singular transformation is reported as such", () => {
    const flat = scaleMatrix(1, 1, 0);
    const e = transformEffect(flat);
    expect(e.singular).toBe(true);
    expect(e.volumeScale).toBeCloseTo(0, 12);
  });
});
