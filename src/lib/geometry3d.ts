// 3D geometry for Solve — vectors, lines, planes and transformations
// (docs/GEOMETRY-TOPOLOGY-DESIGN.md, Tiers 3–4).
//
// EXACTNESS, same discipline as the 2D module: for rational input the
// interesting answers are themselves rational — dot products, cross products,
// scalar triple products, plane coefficients, tetrahedron volumes and the
// determinant of a transformation are all exact. Lengths carry a square root
// so they print as an exact surd plus a decimal; angles are transcendental and
// are numeric, which is honest rather than a shortcut.
//
// DEGENERACY IS NAMED, never silently divided through: three collinear points
// define no plane, two parallel planes never meet, four coplanar points bound
// no tetrahedron and lie on no unique sphere, and two lines may be parallel,
// intersecting, or genuinely SKEW — which is the case worth getting right,
// because the distance formula divides by |d₁ × d₂| and that vanishes exactly
// when the lines are parallel.

import {
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg,
  ratIsZero, ratSign, ratToNumber, ratFromNumber, RAT_ZERO,
} from "./cas";
import { fmtRat, fmtSqrtRat, GeoValue, GeoResult } from "./geometry";

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export interface Vec3 { x: Rat; y: Rat; z: Rat }

export const v3 = (x: number | Rat, y: number | Rat, z: number | Rat): Vec3 => ({
  x: typeof x === "number" ? ratFromNumber(x) : x,
  y: typeof y === "number" ? ratFromNumber(y) : y,
  z: typeof z === "number" ? ratFromNumber(z) : z,
});

const N = (a: Rat): number => ratToNumber(a);

export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: ratAdd(a.x, b.x), y: ratAdd(a.y, b.y), z: ratAdd(a.z, b.z) });
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: ratSub(a.x, b.x), y: ratSub(a.y, b.y), z: ratSub(a.z, b.z) });
export const vScale = (a: Vec3, k: Rat): Vec3 => ({ x: ratMul(a.x, k), y: ratMul(a.y, k), z: ratMul(a.z, k) });

/** Dot product — exact. */
export const dot = (a: Vec3, b: Vec3): Rat =>
  ratAdd(ratAdd(ratMul(a.x, b.x), ratMul(a.y, b.y)), ratMul(a.z, b.z));

/** Cross product — exact. Zero exactly when the vectors are parallel. */
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: ratSub(ratMul(a.y, b.z), ratMul(a.z, b.y)),
  y: ratSub(ratMul(a.z, b.x), ratMul(a.x, b.z)),
  z: ratSub(ratMul(a.x, b.y), ratMul(a.y, b.x)),
});

/** Scalar triple product a · (b × c) — the signed parallelepiped volume. */
export const tripleProduct = (a: Vec3, b: Vec3, c: Vec3): Rat => dot(a, cross(b, c));

export const isZeroVec = (a: Vec3): boolean => ratIsZero(a.x) && ratIsZero(a.y) && ratIsZero(a.z);

/** |v|² — exact, which is why every length test avoids the square root. */
export const normSquared = (a: Vec3): Rat => dot(a, a);

export function norm(a: Vec3): GeoValue {
  const n2 = normSquared(a);
  return { label: "magnitude", exact: fmtSqrtRat(n2) ?? undefined, value: Math.sqrt(N(n2)) };
}

export const fmtVec = (a: Vec3): string => `(${fmtRat(a.x)}, ${fmtRat(a.y)}, ${fmtRat(a.z)})`;

/** Angle between two vectors, in degrees. Transcendental, so numeric. */
export function angleBetween(a: Vec3, b: Vec3): number | null {
  const na = Math.sqrt(N(normSquared(a))), nb = Math.sqrt(N(normSquared(b)));
  if (na === 0 || nb === 0) return null; // the zero vector has no direction
  const c = Math.max(-1, Math.min(1, N(dot(a, b)) / (na * nb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Projection of a onto b, and the perpendicular rejection. Both EXACT, because
 * the scalar (a·b)/(b·b) is a ratio of two exact rationals.
 */
export function project(a: Vec3, b: Vec3): { proj: Vec3; rej: Vec3 } | null {
  const bb = normSquared(b);
  if (ratIsZero(bb)) return null; // cannot project onto the zero vector
  const k = ratDiv(dot(a, b), bb);
  const proj = vScale(b, k);
  return { proj, rej: vSub(a, proj) };
}

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

/** A plane as n·x = d, with an exact rational normal. */
export interface Plane { n: Vec3; d: Rat }

/** Plane through three points; null when they are COLLINEAR (no unique plane). */
export function planeFrom3(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const n = cross(vSub(b, a), vSub(c, a));
  if (isZeroVec(n)) return null;
  return { n, d: dot(n, a) };
}

export function pointPlaneDistance(p: Vec3, pl: Plane): GeoValue {
  const numr = ratSub(dot(pl.n, p), pl.d);
  const d2 = ratDiv(ratMul(numr, numr), normSquared(pl.n));
  return { label: "distance", exact: fmtSqrtRat(d2) ?? undefined, value: Math.sqrt(N(d2)) };
}

/** Angle between two planes (their dihedral angle), in degrees. */
export function anglePlanes(p: Plane, q: Plane): number | null {
  const a = angleBetween(p.n, q.n);
  if (a === null) return null;
  return a > 90 ? 180 - a : a; // report the acute dihedral angle
}

/** Formats a plane as ax + by + cz = d. */
export function fmtPlane(pl: Plane): string {
  const term = (co: Rat, v: string) => {
    if (ratIsZero(co)) return "";
    const s = fmtRat(co);
    return s === "1" ? ` + ${v}` : s === "-1" ? ` - ${v}` : ratSign(co) < 0 ? ` - ${fmtRat(ratNeg(co))}${v}` : ` + ${s}${v}`;
  };
  const body = (term(pl.n.x, "x") + term(pl.n.y, "y") + term(pl.n.z, "z")).replace(/^ \+ /, "").replace(/^ - /, "-");
  return `${body} = ${fmtRat(pl.d)}`;
}

// ---------------------------------------------------------------------------
// Lines in 3D — point + direction.
// ---------------------------------------------------------------------------

export interface Line3 { p: Vec3; dir: Vec3 }

export const lineFrom2 = (a: Vec3, b: Vec3): Line3 | null => {
  const dir = vSub(b, a);
  return isZeroVec(dir) ? null : { p: a, dir };
};

export type LineRelation =
  | { kind: "identical" }
  | { kind: "parallel"; distance: GeoValue }
  | { kind: "intersecting"; at: Vec3 }
  | { kind: "skew"; distance: GeoValue };

/**
 * Classifies two lines and gives the distance between them.
 *
 * The skew-line distance is |(p₂−p₁)·(d₁×d₂)| / |d₁×d₂|, and that denominator
 * vanishes EXACTLY when the directions are parallel — so the parallel case has
 * to be split off first rather than discovered as a division by zero. Because
 * the cross product is exact, the test is exact too: no tolerance to tune.
 */
export function classifyLines(l1: Line3, l2: Line3): LineRelation {
  const c = cross(l1.dir, l2.dir);
  const w = vSub(l2.p, l1.p);
  if (isZeroVec(c)) {
    // Parallel. Identical iff the offset is also parallel to the direction.
    if (isZeroVec(cross(w, l1.dir))) return { kind: "identical" };
    // Distance = |w × d| / |d|
    const wc = cross(w, l1.dir);
    const d2 = ratDiv(normSquared(wc), normSquared(l1.dir));
    return { kind: "parallel", distance: { label: "distance", exact: fmtSqrtRat(d2) ?? undefined, value: Math.sqrt(N(d2)) } };
  }
  const triple = dot(w, c);
  if (ratIsZero(triple)) {
    // Coplanar and non-parallel: they intersect. Solve for the parameter.
    const cc = normSquared(c);
    const t = ratDiv(dot(cross(w, l2.dir), c), cc);
    return { kind: "intersecting", at: vAdd(l1.p, vScale(l1.dir, t)) };
  }
  const d2 = ratDiv(ratMul(triple, triple), normSquared(c));
  return { kind: "skew", distance: { label: "distance", exact: fmtSqrtRat(d2) ?? undefined, value: Math.sqrt(N(d2)) } };
}

/** Where a line meets a plane: a point, or a named degenerate case. */
export function linePlaneIntersect(l: Line3, pl: Plane):
  | { kind: "point"; at: Vec3 }
  | { kind: "parallel" }
  | { kind: "in-plane" } {
  const denom = dot(pl.n, l.dir);
  if (ratIsZero(denom)) {
    return ratIsZero(ratSub(dot(pl.n, l.p), pl.d)) ? { kind: "in-plane" } : { kind: "parallel" };
  }
  const t = ratDiv(ratSub(pl.d, dot(pl.n, l.p)), denom);
  return { kind: "point", at: vAdd(l.p, vScale(l.dir, t)) };
}

// ---------------------------------------------------------------------------
// Volumes and spheres
// ---------------------------------------------------------------------------

/** Parallelepiped volume |a·(b×c)| — exact. Zero exactly when coplanar. */
export const parallelepipedVolume = (a: Vec3, b: Vec3, c: Vec3): Rat => {
  const t = tripleProduct(a, b, c);
  return ratSign(t) < 0 ? ratNeg(t) : t;
};

/** Tetrahedron volume from four vertices — exact, one sixth of the box. */
export function tetrahedronVolume(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Rat {
  return ratMul(parallelepipedVolume(vSub(b, a), vSub(c, a), vSub(d, a)), ratMake(1n, 6n));
}

/** Triangle area in 3D = |AB × AC| / 2 — exact as a surd. */
export function triangleArea3(a: Vec3, b: Vec3, c: Vec3): GeoValue {
  const n2 = normSquared(cross(vSub(b, a), vSub(c, a)));
  const quarter = ratMul(n2, ratMake(1n, 4n));
  return { label: "area", exact: fmtSqrtRat(quarter) ?? undefined, value: Math.sqrt(N(quarter)) };
}

/**
 * Sphere through four points; null when they are COPLANAR, which is exactly
 * when no unique sphere exists. Centre is exact (a rational linear solve).
 */
export function sphereFrom4(a: Vec3, b: Vec3, c: Vec3, d: Vec3): { centre: Vec3; r2: Rat } | null {
  if (ratIsZero(tripleProduct(vSub(b, a), vSub(c, a), vSub(d, a)))) return null;
  // Each pair gives 2(p−a)·x = |p|² − |a|². Solve the 3×3 system exactly.
  const rowOf = (p: Vec3): [Rat, Rat, Rat, Rat] => [
    ratMul(ratInt(2), ratSub(p.x, a.x)),
    ratMul(ratInt(2), ratSub(p.y, a.y)),
    ratMul(ratInt(2), ratSub(p.z, a.z)),
    ratSub(normSquared(p), normSquared(a)),
  ];
  const M: [Rat, Rat, Rat, Rat][] = [rowOf(b), rowOf(c), rowOf(d)];
  // Gaussian elimination over exact rationals.
  for (let col = 0; col < 3; col++) {
    let piv = -1;
    for (let r = col; r < 3; r++) if (!ratIsZero(M[r][col])) { piv = r; break; }
    if (piv < 0) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let k = col; k < 4; k++) M[col][k] = ratDiv(M[col][k], p);
    for (let r = 0; r < 3; r++) {
      if (r === col || ratIsZero(M[r][col])) continue;
      const f = M[r][col];
      for (let k = col; k < 4; k++) M[r][k] = ratSub(M[r][k], ratMul(f, M[col][k]));
    }
  }
  const centre: Vec3 = { x: M[0][3], y: M[1][3], z: M[2][3] };
  return { centre, r2: normSquared(vSub(centre, a)) };
}

// ---------------------------------------------------------------------------
// Transformations (Tier 4)
// ---------------------------------------------------------------------------

export type Mat3 = [Rat, Rat, Rat, Rat, Rat, Rat, Rat, Rat, Rat]; // row-major

export const mat3Det = (m: Mat3): Rat =>
  ratAdd(
    ratSub(
      ratMul(m[0], ratSub(ratMul(m[4], m[8]), ratMul(m[5], m[7]))),
      ratMul(m[1], ratSub(ratMul(m[3], m[8]), ratMul(m[5], m[6])))
    ),
    ratMul(m[2], ratSub(ratMul(m[3], m[7]), ratMul(m[4], m[6])))
  );

export const mat3Apply = (m: Mat3, v: Vec3): Vec3 => ({
  x: ratAdd(ratAdd(ratMul(m[0], v.x), ratMul(m[1], v.y)), ratMul(m[2], v.z)),
  y: ratAdd(ratAdd(ratMul(m[3], v.x), ratMul(m[4], v.y)), ratMul(m[5], v.z)),
  z: ratAdd(ratAdd(ratMul(m[6], v.x), ratMul(m[7], v.y)), ratMul(m[8], v.z)),
});

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(RAT_ZERO) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = RAT_ZERO;
      for (let k = 0; k < 3; k++) s = ratAdd(s, ratMul(a[r * 3 + k], b[k * 3 + c]));
      out[r * 3 + c] = s;
    }
  }
  return out;
}

/** Scaling — exact. */
export const scaleMatrix = (sx: number, sy: number, sz: number): Mat3 => [
  ratFromNumber(sx), RAT_ZERO, RAT_ZERO,
  RAT_ZERO, ratFromNumber(sy), RAT_ZERO,
  RAT_ZERO, RAT_ZERO, ratFromNumber(sz),
];

/** Reflection in a coordinate plane — exact (entries are ±1). */
export function reflectionMatrix(plane: "xy" | "yz" | "zx"): Mat3 {
  const one = ratInt(1), neg = ratInt(-1);
  if (plane === "xy") return [one, RAT_ZERO, RAT_ZERO, RAT_ZERO, one, RAT_ZERO, RAT_ZERO, RAT_ZERO, neg];
  if (plane === "yz") return [neg, RAT_ZERO, RAT_ZERO, RAT_ZERO, one, RAT_ZERO, RAT_ZERO, RAT_ZERO, one];
  return [one, RAT_ZERO, RAT_ZERO, RAT_ZERO, neg, RAT_ZERO, RAT_ZERO, RAT_ZERO, one];
}

/**
 * Rotation about a coordinate axis. The entries are cos/sin, which are
 * irrational for all but a few angles, so this one is genuinely NUMERIC and is
 * converted through the rational layer only so it can compose with the others.
 * The determinant is 1 up to floating error — stated, not implied to be exact.
 */
export function rotationMatrix(axis: "x" | "y" | "z", degrees: number): Mat3 {
  const t = (degrees * Math.PI) / 180;
  const c = ratFromNumber(Math.cos(t)), s = ratFromNumber(Math.sin(t));
  const one = ratInt(1);
  if (axis === "x") return [one, RAT_ZERO, RAT_ZERO, RAT_ZERO, c, ratNeg(s), RAT_ZERO, s, c];
  if (axis === "y") return [c, RAT_ZERO, s, RAT_ZERO, one, RAT_ZERO, ratNeg(s), RAT_ZERO, c];
  return [c, ratNeg(s), RAT_ZERO, s, c, RAT_ZERO, RAT_ZERO, RAT_ZERO, one];
}

/** How a transformation changes volume, and whether it flips orientation. */
export function transformEffect(m: Mat3): { det: Rat; volumeScale: number; flipsOrientation: boolean; singular: boolean } {
  const det = mat3Det(m);
  const v = N(det);
  return {
    det,
    volumeScale: Math.abs(v),
    flipsOrientation: ratSign(det) < 0,
    singular: ratIsZero(det),
  };
}

// ---------------------------------------------------------------------------
// Report builders — used by the parser.
// ---------------------------------------------------------------------------

const V = (label: string, value: number, exact?: string): GeoValue => ({ label, value, exact });

/** Full readout for two vectors. */
export function vectorReport(a: Vec3, b: Vec3): GeoResult {
  const d = dot(a, b);
  const c = cross(a, b);
  const ang = angleBetween(a, b);
  const values: GeoValue[] = [
    V("dot product", N(d), fmtRat(d)),
    V("cross product", NaN, fmtVec(c)),
    { ...norm(a), label: "|a|" },
    { ...norm(b), label: "|b|" },
  ];
  if (ang !== null) values.push(V("angle (deg)", ang));
  const steps: string[] = [
    `a = ${fmtVec(a)}, b = ${fmtVec(b)}.`,
    `a · b = ${fmtRat(d)}; a × b = ${fmtVec(c)}.`,
  ];
  const caveats: string[] = [];
  if (ratIsZero(d) && !isZeroVec(a) && !isZeroVec(b)) steps.push("The dot product is zero, so these vectors are PERPENDICULAR.");
  if (isZeroVec(c) && !isZeroVec(a) && !isZeroVec(b)) steps.push("The cross product is the zero vector, so these vectors are PARALLEL.");
  const area = norm(c);
  values.push(V("area of the parallelogram they span", area.value, area.exact));
  const pr = project(a, b);
  if (pr) steps.push(`Projection of a onto b: ${fmtVec(pr.proj)}; perpendicular part: ${fmtVec(pr.rej)}.`);
  else caveats.push("b is the zero vector, so a cannot be projected onto it.");
  return { title: "Vectors", values, steps, caveats };
}
