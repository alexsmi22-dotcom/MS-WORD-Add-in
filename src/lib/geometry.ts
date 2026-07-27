// Geometry for Solve — mensuration, triangle solving, analytic geometry and
// conic classification (docs/GEOMETRY-TOPOLOGY-DESIGN.md, Tiers 1–2).
//
// EXACTNESS. Coordinate geometry runs on the CAS's exact rationals, because for
// rational vertices the interesting answers are *themselves* rational: shoelace
// area, centroid, circumcentre, the conic invariants. Those are reported
// exactly and a decimal is offered alongside, never instead. Lengths involve a
// square root, so they are reported as an exact √ form plus a decimal. Angles
// are genuinely transcendental and are reported numerically, which is honest
// rather than a shortcut.
//
// DEGENERACY IS THE NORMAL CASE, not an edge case: collinear points have no
// circumcircle, SSA admits two triangles or none, a "conic" can be a point, a
// line pair or empty. Every one of those gets a named result instead of a
// number that looks fine and means nothing.

import {
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg,
  ratIsZero, ratSign, ratToNumber, ratFromNumber, RAT_ZERO,
} from "./cas";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface GeoValue {
  label: string;
  /** Exact form when one exists ("6*sqrt(3)", "25*pi/4", "7/2"). */
  exact?: string;
  /** Numeric value; NaN when the quantity is undefined for this input. */
  value: number;
  unit?: string;
}

export interface GeoResult {
  title: string;
  values: GeoValue[];
  steps: string[];
  caveats: string[];
  /** Distinguishes a genuine result from a named degenerate outcome. */
  degenerate?: string;
}

export type Pt = { x: Rat; y: Rat };

export const pt = (x: number | Rat, y: number | Rat): Pt => ({
  x: typeof x === "number" ? ratFromNumber(x) : x,
  y: typeof y === "number" ? ratFromNumber(y) : y,
});

// ---------------------------------------------------------------------------
// Exact helpers
// ---------------------------------------------------------------------------

const R2 = (a: Rat): Rat => ratMul(a, a);
const rAbs = (a: Rat): Rat => (ratSign(a) < 0 ? ratNeg(a) : a);

/** Formats an exact rational: "3", "7/2", "-5/4". */
export function fmtRat(a: Rat): string {
  return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
}

/**
 * Exact form of √(p/q) where possible: √(a/b) is simplified by pulling square
 * factors out of numerator and denominator, so √(48/9) prints 4*sqrt(3)/3
 * rather than a decimal. Returns null when the value is negative.
 */
export function fmtSqrtRat(a: Rat): string | null {
  if (ratSign(a) < 0) return null;
  if (ratIsZero(a)) return "0";
  // √(n/d) = √(n·d)/d
  const nd = a.n * a.d;
  const { sq, rest } = splitSquare(nd);
  const den = a.d;
  // result = sq·√rest / den
  const g = bgcd(sq, den);
  const num = sq / g;
  const dd = den / g;
  const numPart = rest === 1n ? `${num}` : num === 1n ? `sqrt(${rest})` : `${num}*sqrt(${rest})`;
  return dd === 1n ? numPart : `(${numPart})/${dd}`;
}

function bgcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1n;
}

/** Largest square factor: n = sq² · rest, rest square-free-ish (trial division). */
function splitSquare(n: bigint): { sq: bigint; rest: bigint } {
  if (n <= 0n) return { sq: 1n, rest: n };
  let sq = 1n;
  let rest = n;
  for (let p = 2n; p * p <= rest && p < 100000n; p++) {
    while (rest % (p * p) === 0n) {
      rest /= p * p;
      sq *= p;
    }
  }
  return { sq, rest };
}

const num = (a: Rat): number => ratToNumber(a);

// ---------------------------------------------------------------------------
// Points, lines, distances
// ---------------------------------------------------------------------------

/** Squared distance — EXACT, because it avoids the square root entirely. */
export function distanceSquared(a: Pt, b: Pt): Rat {
  return ratAdd(R2(ratSub(b.x, a.x)), R2(ratSub(b.y, a.y)));
}

export function distance(a: Pt, b: Pt): GeoValue {
  const d2 = distanceSquared(a, b);
  return { label: "distance", exact: fmtSqrtRat(d2) ?? undefined, value: Math.sqrt(num(d2)) };
}

export function midpoint(a: Pt, b: Pt): Pt {
  const half = ratMake(1n, 2n);
  return { x: ratMul(ratAdd(a.x, b.x), half), y: ratMul(ratAdd(a.y, b.y), half) };
}

/** Twice the signed area of triangle ABC — the orientation primitive. */
export function cross2(a: Pt, b: Pt, c: Pt): Rat {
  return ratSub(
    ratMul(ratSub(b.x, a.x), ratSub(c.y, a.y)),
    ratMul(ratSub(b.y, a.y), ratSub(c.x, a.x))
  );
}

export const collinear = (a: Pt, b: Pt, c: Pt): boolean => ratIsZero(cross2(a, b, c));

/** A line as ax + by = c, with exact rational coefficients. */
export interface Line { a: Rat; b: Rat; c: Rat }

export function lineThrough(p: Pt, q: Pt): Line | null {
  const a = ratSub(q.y, p.y);
  const b = ratSub(p.x, q.x);
  if (ratIsZero(a) && ratIsZero(b)) return null; // the two points coincide
  const c = ratAdd(ratMul(a, p.x), ratMul(b, p.y));
  return { a, b, c };
}

export function lineIntersect(l: Line, m: Line): { kind: "point"; p: Pt } | { kind: "parallel" } | { kind: "same" } {
  const det = ratSub(ratMul(l.a, m.b), ratMul(l.b, m.a));
  if (ratIsZero(det)) {
    // Same line iff the constants are proportional too.
    const d2 = ratSub(ratMul(l.a, m.c), ratMul(l.c, m.a));
    const d3 = ratSub(ratMul(l.b, m.c), ratMul(l.c, m.b));
    return ratIsZero(d2) && ratIsZero(d3) ? { kind: "same" } : { kind: "parallel" };
  }
  const x = ratDiv(ratSub(ratMul(l.c, m.b), ratMul(l.b, m.c)), det);
  const y = ratDiv(ratSub(ratMul(l.a, m.c), ratMul(l.c, m.a)), det);
  return { kind: "point", p: { x, y } };
}

/** Distance from a point to a line — exact as √(rational). */
export function pointLineDistance(p: Pt, l: Line): GeoValue {
  const numr = ratSub(ratAdd(ratMul(l.a, p.x), ratMul(l.b, p.y)), l.c);
  const d2 = ratDiv(R2(numr), ratAdd(R2(l.a), R2(l.b)));
  return { label: "distance", exact: fmtSqrtRat(d2) ?? undefined, value: Math.sqrt(num(d2)) };
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

/** Shoelace area — EXACT for rational vertices. Sign carries orientation. */
export function polygonSignedArea(ps: Pt[]): Rat {
  let acc = RAT_ZERO;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    acc = ratAdd(acc, ratSub(ratMul(a.x, b.y), ratMul(b.x, a.y)));
  }
  return ratMul(acc, ratMake(1n, 2n));
}

export function polygonArea(ps: Pt[]): Rat {
  return rAbs(polygonSignedArea(ps));
}

export function polygonCentroid(ps: Pt[]): Pt | null {
  const A = polygonSignedArea(ps);
  if (ratIsZero(A)) return null; // degenerate (zero area)
  let cx = RAT_ZERO, cy = RAT_ZERO;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    const w = ratSub(ratMul(a.x, b.y), ratMul(b.x, a.y));
    cx = ratAdd(cx, ratMul(ratAdd(a.x, b.x), w));
    cy = ratAdd(cy, ratMul(ratAdd(a.y, b.y), w));
  }
  const f = ratDiv(ratInt(1), ratMul(ratInt(6), A));
  return { x: ratMul(cx, f), y: ratMul(cy, f) };
}

export function isConvex(ps: Pt[]): boolean {
  if (ps.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < ps.length; i++) {
    const s = ratSign(cross2(ps[i], ps[(i + 1) % ps.length], ps[(i + 2) % ps.length]));
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/**
 * Point-in-polygon by WINDING NUMBER rather than ray casting: exact in rational
 * arithmetic, and unambiguous for a point lying exactly on the boundary, which
 * ray casting reports inconsistently depending on which edge it hits.
 */
export function pointInPolygon(p: Pt, ps: Pt[]): "inside" | "outside" | "boundary" {
  let wind = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    const side = cross2(a, b, p);
    // On the segment?
    if (ratIsZero(side)) {
      const withinX = ratSign(ratMul(ratSub(p.x, a.x), ratSub(p.x, b.x))) <= 0;
      const withinY = ratSign(ratMul(ratSub(p.y, a.y), ratSub(p.y, b.y))) <= 0;
      if (withinX && withinY) return "boundary";
    }
    if (ratSign(ratSub(a.y, p.y)) <= 0) {
      if (ratSign(ratSub(b.y, p.y)) > 0 && ratSign(side) > 0) wind++;
    } else if (ratSign(ratSub(b.y, p.y)) <= 0 && ratSign(side) < 0) {
      wind--;
    }
  }
  return wind === 0 ? "outside" : "inside";
}

/** Convex hull, Andrew's monotone chain — exact, so no tolerance to tune. */
export function convexHull(ps: Pt[]): Pt[] {
  const uniq: Pt[] = [];
  for (const p of ps) {
    if (!uniq.some((q) => ratIsZero(ratSub(q.x, p.x)) && ratIsZero(ratSub(q.y, p.y)))) uniq.push(p);
  }
  if (uniq.length < 3) return uniq.slice();
  const sorted = uniq.slice().sort((u, v) => {
    const dx = ratSign(ratSub(u.x, v.x));
    return dx !== 0 ? dx : ratSign(ratSub(u.y, v.y));
  });
  const build = (src: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of src) {
      while (out.length >= 2 && ratSign(cross2(out[out.length - 2], out[out.length - 1], p)) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build(sorted.slice().reverse())];
}

// ---------------------------------------------------------------------------
// Triangle centres — all EXACT for rational vertices.
// ---------------------------------------------------------------------------

export interface TriangleCentres {
  centroid: Pt;
  circumcentre: Pt | null;
  orthocentre: Pt | null;
  incentre: { x: number; y: number } | null; // irrational in general (side lengths)
  eulerLineCollinear: boolean;
}

export function triangleCentres(A: Pt, B: Pt, C: Pt): TriangleCentres | null {
  if (collinear(A, B, C)) return null; // degenerate triangle
  const third = ratMake(1n, 3n);
  const centroid: Pt = {
    x: ratMul(ratAdd(ratAdd(A.x, B.x), C.x), third),
    y: ratMul(ratAdd(ratAdd(A.y, B.y), C.y), third),
  };

  // Circumcentre: intersection of two perpendicular bisectors, exactly.
  const d = ratMul(ratInt(2), cross2(A, B, C));
  const aa = ratAdd(R2(A.x), R2(A.y));
  const bb = ratAdd(R2(B.x), R2(B.y));
  const cc = ratAdd(R2(C.x), R2(C.y));
  const ux = ratDiv(
    ratAdd(ratAdd(ratMul(aa, ratSub(B.y, C.y)), ratMul(bb, ratSub(C.y, A.y))), ratMul(cc, ratSub(A.y, B.y))),
    d
  );
  const uy = ratDiv(
    ratAdd(ratAdd(ratMul(aa, ratSub(C.x, B.x)), ratMul(bb, ratSub(A.x, C.x))), ratMul(cc, ratSub(B.x, A.x))),
    d
  );
  const circumcentre: Pt = { x: ux, y: uy };

  // Orthocentre H = A + B + C − 2·O  (vector identity, exact).
  const orthocentre: Pt = {
    x: ratSub(ratAdd(ratAdd(A.x, B.x), C.x), ratMul(ratInt(2), ux)),
    y: ratSub(ratAdd(ratAdd(A.y, B.y), C.y), ratMul(ratInt(2), uy)),
  };

  // Incentre needs the side LENGTHS, which are irrational in general.
  const a = Math.sqrt(num(distanceSquared(B, C)));
  const b = Math.sqrt(num(distanceSquared(C, A)));
  const c = Math.sqrt(num(distanceSquared(A, B)));
  const per = a + b + c;
  const incentre = per > 0
    ? {
        x: (a * num(A.x) + b * num(B.x) + c * num(C.x)) / per,
        y: (a * num(A.y) + b * num(B.y) + c * num(C.y)) / per,
      }
    : null;

  // The Euler line: centroid, circumcentre and orthocentre are collinear.
  // Checked EXACTLY — a free self-test on every call.
  const eulerLineCollinear = collinear(centroid, circumcentre, orthocentre);

  return { centroid, circumcentre, orthocentre, incentre, eulerLineCollinear };
}

/** Circle through three points; null when they are collinear. */
export function circleFrom3Points(A: Pt, B: Pt, C: Pt): { centre: Pt; r2: Rat } | null {
  const cent = triangleCentres(A, B, C);
  if (!cent || !cent.circumcentre) return null;
  return { centre: cent.circumcentre, r2: distanceSquared(cent.circumcentre, A) };
}

// ---------------------------------------------------------------------------
// Triangle solving — SSS, SAS, ASA, AAS, and the ambiguous SSA.
// ---------------------------------------------------------------------------

/** A solved triangle. Sides a,b,c face angles A,B,C. Angles in degrees. */
export interface SolvedTriangle {
  a: number; b: number; c: number;
  A: number; B: number; C: number;
  area: number;
  /** Exact area when the sides are rational and Heron's radicand is rational. */
  areaExact?: string;
}

export interface TriangleSolution {
  kind: "SSS" | "SAS" | "ASA" | "AAS" | "SSA";
  triangles: SolvedTriangle[];
  caveats: string[];
  /** Set when no triangle exists, explaining why. */
  impossible?: string;
}

const DEG = 180 / Math.PI;
const toRad = (d: number) => d / DEG;

function finishFromSides(a: number, b: number, c: number): SolvedTriangle {
  const A = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * DEG;
  const B = Math.acos((a * a + c * c - b * b) / (2 * a * c)) * DEG;
  const C = 180 - A - B;
  const s = (a + b + c) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  const out: SolvedTriangle = { a, b, c, A, B, C, area };
  // Heron exactly, when the sides are rational: area = √(s(s−a)(s−b)(s−c)).
  try {
    const rs = [a, b, c].map(ratFromNumber);
    const S = ratMul(ratAdd(ratAdd(rs[0], rs[1]), rs[2]), ratMake(1n, 2n));
    const rad = ratMul(
      ratMul(S, ratSub(S, rs[0])),
      ratMul(ratSub(S, rs[1]), ratSub(S, rs[2]))
    );
    const ex = fmtSqrtRat(rad);
    if (ex) out.areaExact = ex;
  } catch {
    /* leave it numeric */
  }
  return out;
}

/**
 * Solves a triangle from three given parts.
 *
 * SSA is the case this exists for. It is the "ambiguous case": depending on the
 * numbers it yields TWO triangles, exactly one, or none at all. A solver that
 * quietly returns the acute solution is wrong roughly half the time it matters,
 * so every solution is returned and the impossible configuration is named.
 */
export function solveTriangle(spec: {
  kind: TriangleSolution["kind"];
  /** Sides a,b,c and angles A,B,C in degrees; undefined where unknown. */
  a?: number; b?: number; c?: number;
  A?: number; B?: number; C?: number;
}): TriangleSolution {
  const caveats: string[] = [];
  const bad = (msg: string): TriangleSolution => ({ kind: spec.kind, triangles: [], caveats, impossible: msg });
  const pos = (v: number | undefined): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;

  switch (spec.kind) {
    case "SSS": {
      const { a, b, c } = spec;
      if (!pos(a) || !pos(b) || !pos(c)) return bad("Three positive side lengths are required.");
      const [x, y, z] = [a!, b!, c!];
      if (x + y <= z || x + z <= y || y + z <= x) {
        return bad(`No triangle has sides ${x}, ${y}, ${z} — the two shorter sides must sum to more than the longest (triangle inequality).`);
      }
      return { kind: "SSS", triangles: [finishFromSides(x, y, z)], caveats };
    }
    case "SAS": {
      // Two sides and the angle BETWEEN them.
      const { b, c, A } = spec;
      if (!pos(b) || !pos(c) || !pos(A)) return bad("Two positive sides and the included angle are required.");
      if (A! >= 180) return bad("The included angle must be less than 180°.");
      const a = Math.sqrt(b! * b! + c! * c! - 2 * b! * c! * Math.cos(toRad(A!)));
      return { kind: "SAS", triangles: [finishFromSides(a, b!, c!)], caveats };
    }
    case "ASA": case "AAS": {
      const { A, B, a, b } = spec;
      if (!pos(A) || !pos(B)) return bad("Two positive angles are required.");
      const C = 180 - A! - B!;
      if (C <= 0) return bad(`Angles ${A}° and ${B}° leave nothing for the third angle — they must sum to less than 180°.`);
      // Need one side. ASA gives the side between the angles (c); AAS gives a or b.
      let k: number; // circumdiameter, from the law of sines
      if (pos(spec.c)) k = spec.c! / Math.sin(toRad(C));
      else if (pos(a)) k = a! / Math.sin(toRad(A!));
      else if (pos(b)) k = b! / Math.sin(toRad(B!));
      else return bad("One side length is required as well as the two angles.");
      const sa = k * Math.sin(toRad(A!));
      const sb = k * Math.sin(toRad(B!));
      const sc = k * Math.sin(toRad(C));
      return { kind: spec.kind, triangles: [finishFromSides(sa, sb, sc)], caveats };
    }
    case "SSA": {
      // Given a, b and angle A (opposite a) — the ambiguous case.
      const { a, b, A } = spec;
      if (!pos(a) || !pos(b) || !pos(A)) return bad("Two positive sides and a non-included angle are required.");
      if (A! >= 180) return bad("The angle must be less than 180°.");
      const h = b! * Math.sin(toRad(A!)); // altitude from C to side c
      if (a! < h - 1e-12) {
        return bad(`No triangle: side a = ${a} is shorter than the altitude ${h.toFixed(6)} needed to reach the opposite side, so it cannot close.`);
      }
      caveats.push(
        "SSA is the ambiguous case: two sides and a NON-included angle can describe two different triangles, one, or none. Every solution that exists is listed."
      );
      const triangles: SolvedTriangle[] = [];
      if (Math.abs(a! - h) < 1e-12) {
        // Exactly one, right-angled at B.
        const c = Math.sqrt(Math.max(0, b! * b! - a! * a!));
        triangles.push(finishFromSides(a!, b!, c));
        caveats.push("Exactly one triangle: side a equals the altitude, so the triangle is right-angled.");
        return { kind: "SSA", triangles, caveats };
      }
      const sinB = (b! * Math.sin(toRad(A!))) / a!;
      if (sinB > 1 + 1e-12) return bad("No triangle: the given parts are inconsistent (sin B > 1).");
      const B1 = Math.asin(Math.min(1, sinB)) * DEG;
      const B2 = 180 - B1;
      for (const B of [B1, B2]) {
        const C = 180 - A! - B;
        if (C <= 1e-9) continue; // this branch does not close
        const c = (a! * Math.sin(toRad(C))) / Math.sin(toRad(A!));
        if (c > 0) triangles.push(finishFromSides(a!, b!, c));
      }
      if (!triangles.length) return bad("No triangle satisfies these three parts.");
      if (triangles.length === 2) {
        caveats.push("TWO triangles satisfy these measurements — an acute and an obtuse solution. Both are valid; choose using information the three given parts do not contain.");
      }
      return { kind: "SSA", triangles, caveats };
    }
  }
}

// ---------------------------------------------------------------------------
// Conic classification — the Tier-2 centrepiece.
// ---------------------------------------------------------------------------

export type ConicKind =
  | "ellipse" | "circle" | "parabola" | "hyperbola"
  | "point" | "line pair" | "parallel lines" | "single line" | "empty";

export interface ConicResult {
  kind: ConicKind;
  degenerate: boolean;
  /** Rotation applied to remove the xy term, in degrees. */
  rotationDeg: number;
  centre?: { x: number; y: number };
  /** Semi-axes for ellipse/hyperbola; for a parabola, the focal parameter. */
  a?: number;
  b?: number;
  eccentricity?: number;
  foci?: { x: number; y: number }[];
  vertices?: { x: number; y: number }[];
  asymptotes?: string[];
  canonical: string;
  steps: string[];
  caveats: string[];
}

/**
 * Classifies A x² + B xy + C y² + D x + E y + F = 0.
 *
 * Uses the invariants, which is what makes the answer trustworthy rather than a
 * guess from the shape of the equation:
 *   δ = B² − 4AC        — the type (negative ellipse, zero parabola, positive hyperbola)
 *   Δ = det of the 3×3 matrix — zero exactly when the conic is DEGENERATE
 * Degenerate cases are named (a point, a crossed line pair, parallel lines,
 * empty) rather than being forced into an ellipse with imaginary axes.
 */
export function classifyConic(
  A: Rat, B: Rat, C: Rat, D: Rat, E: Rat, F: Rat
): ConicResult {
  const steps: string[] = [];
  const caveats: string[] = [];

  if (ratIsZero(A) && ratIsZero(B) && ratIsZero(C)) {
    return {
      kind: ratIsZero(D) && ratIsZero(E) ? "empty" : "single line",
      degenerate: true, rotationDeg: 0,
      canonical: ratIsZero(D) && ratIsZero(E) ? "no quadratic or linear terms" : `${fmtRat(D)}x + ${fmtRat(E)}y + ${fmtRat(F)} = 0`,
      steps: ["No quadratic terms — this is not a conic but a linear equation."],
      caveats,
    };
  }

  // δ = B² − 4AC
  const delta = ratSub(R2(B), ratMul(ratInt(4), ratMul(A, C)));
  // Δ = determinant of [[A, B/2, D/2], [B/2, C, E/2], [D/2, E/2, F]] · 4 (kept integral)
  const half = ratMake(1n, 2n);
  const b2 = ratMul(B, half), d2 = ratMul(D, half), e2 = ratMul(E, half);
  const Det = ratAdd(
    ratSub(ratMul(A, ratSub(ratMul(C, F), R2(e2))), ratMul(b2, ratSub(ratMul(b2, F), ratMul(e2, d2)))),
    ratMul(d2, ratSub(ratMul(b2, e2), ratMul(C, d2)))
  );
  steps.push(`Invariants: δ = B² − 4AC = ${fmtRat(delta)}; Δ (3×3 determinant) = ${fmtRat(Det)}.`);

  const degenerate = ratIsZero(Det);
  const dSign = ratSign(delta);

  // Rotation angle that removes the xy term: cot(2θ) = (A − C)/B.
  let rotationDeg = 0;
  if (!ratIsZero(B)) {
    rotationDeg = (0.5 * Math.atan2(num(B), num(A) - num(C))) * DEG;
    steps.push(`B ≠ 0, so rotate by θ = ½·atan2(B, A−C) = ${rotationDeg.toFixed(4)}° to remove the xy term.`);
  }

  // Rotated quadratic coefficients (eigenvalues of the 2×2 quadratic form).
  const th = toRad(rotationDeg);
  const cos = Math.cos(th), sin = Math.sin(th);
  const nA = num(A) * cos * cos + num(B) * cos * sin + num(C) * sin * sin;
  const nC = num(A) * sin * sin - num(B) * cos * sin + num(C) * cos * cos;
  const nD = num(D) * cos + num(E) * sin;
  const nE = -num(D) * sin + num(E) * cos;
  const nF = num(F);

  // Centre, where one exists (δ ≠ 0): solve the 2×2 system.
  let centre: { x: number; y: number } | undefined;
  if (dSign !== 0) {
    const den = num(delta);
    const cx = (2 * num(C) * num(D) - num(B) * num(E)) / -den;
    const cy = (2 * num(A) * num(E) - num(B) * num(D)) / -den;
    centre = { x: cx, y: cy };
    steps.push(`δ ≠ 0, so there is a centre at (${cx.toFixed(6)}, ${cy.toFixed(6)}).`);
  }

  if (degenerate) {
    caveats.push("Δ = 0, so this conic is DEGENERATE — it is not a genuine ellipse, parabola or hyperbola.");
    let kind: ConicKind;
    if (dSign < 0) kind = "point";
    else if (dSign > 0) kind = "line pair";
    else kind = "parallel lines";
    steps.push(
      kind === "point"
        ? "δ < 0 with Δ = 0: the locus is a single point."
        : kind === "line pair"
          ? "δ > 0 with Δ = 0: the locus is two lines crossing at the centre."
          : "δ = 0 with Δ = 0: the locus is a parallel line pair, one line, or empty."
    );
    return { kind, degenerate: true, rotationDeg, centre, canonical: describeDegenerate(kind), steps, caveats };
  }

  if (dSign === 0) {
    // Parabola.
    steps.push("δ = 0 with Δ ≠ 0: a parabola.");
    // In rotated coords one squared term vanishes; the other gives 4p.
    const sq = Math.abs(nA) > Math.abs(nC) ? nA : nC;
    const lin = Math.abs(nA) > Math.abs(nC) ? nE : nD;
    const p = lin !== 0 ? -lin / (4 * sq) : NaN;
    return {
      kind: "parabola", degenerate: false, rotationDeg,
      a: Number.isFinite(p) ? Math.abs(p) : undefined,
      eccentricity: 1,
      canonical: Math.abs(nA) > Math.abs(nC)
        ? `${nA.toPrecision(6)}·x'² + ${nE.toPrecision(6)}·y' + ${nF.toPrecision(6)} = 0`
        : `${nC.toPrecision(6)}·y'² + ${nD.toPrecision(6)}·x' + ${nF.toPrecision(6)} = 0`,
      steps, caveats: [...caveats, "A parabola has eccentricity exactly 1 and no centre."],
    };
  }

  // Central conic: translate to the centre and normalise.
  const cxr = centre!.x, cyr = centre!.y;
  // Constant term after translating to the centre.
  const Fc = num(F) + (num(D) * cxr + num(E) * cyr) / 2;
  // Rotate the centre into the primed frame is unnecessary: use eigenvalues nA, nC.
  const lam1 = nA, lam2 = nC;
  if (Math.abs(Fc) < 1e-14) {
    caveats.push("The translated constant term is ~0, which is the degenerate boundary; treat the classification with care.");
  }
  const r1 = -Fc / lam1, r2 = -Fc / lam2;

  if (dSign < 0) {
    // Ellipse (or circle).
    const isCircle = ratIsZero(B) && !ratIsZero(A) && !ratIsZero(C) && ratIsZero(ratSub(A, C));
    if (r1 <= 0 && r2 <= 0) {
      return {
        kind: "empty", degenerate: false, rotationDeg, centre,
        canonical: "no real points satisfy this equation",
        steps: [...steps, "δ < 0 but both normalised terms are negative — the locus is EMPTY over the reals."],
        caveats: [...caveats, "This equation has no real solutions; the 'ellipse' is imaginary."],
      };
    }
    const aa = Math.sqrt(Math.max(r1, r2));
    const bb = Math.sqrt(Math.min(r1, r2));
    const ecc = aa > 0 ? Math.sqrt(Math.max(0, 1 - (bb * bb) / (aa * aa))) : 0;
    const cdist = Math.sqrt(Math.max(0, aa * aa - bb * bb));
    steps.push(`δ < 0: an ${isCircle ? "ellipse that is in fact a circle" : "ellipse"}; semi-axes a = ${aa.toFixed(6)}, b = ${bb.toFixed(6)}.`);
    return {
      kind: isCircle ? "circle" : "ellipse", degenerate: false, rotationDeg, centre,
      a: aa, b: bb, eccentricity: ecc,
      foci: fociFor(centre!, cdist, rotationDeg, r1 >= r2),
      vertices: verticesFor(centre!, aa, rotationDeg, r1 >= r2),
      canonical: `x'²/${(Math.max(r1, r2)).toPrecision(6)} + y'²/${(Math.min(r1, r2)).toPrecision(6)} = 1`,
      steps, caveats,
    };
  }

  // Hyperbola.
  const posR = r1 > 0 ? r1 : r2;
  const negR = r1 > 0 ? r2 : r1;
  const aa = Math.sqrt(Math.abs(posR));
  const bb = Math.sqrt(Math.abs(negR));
  const cdist = Math.sqrt(aa * aa + bb * bb);
  steps.push(`δ > 0: a hyperbola; a = ${aa.toFixed(6)}, b = ${bb.toFixed(6)}.`);
  return {
    kind: "hyperbola", degenerate: false, rotationDeg, centre,
    a: aa, b: bb,
    eccentricity: aa > 0 ? cdist / aa : NaN,
    foci: fociFor(centre!, cdist, rotationDeg, r1 > 0),
    vertices: verticesFor(centre!, aa, rotationDeg, r1 > 0),
    asymptotes: [`slope ±${(bb / aa).toFixed(6)} through the centre (in the rotated frame)`],
    canonical: `x'²/${Math.abs(posR).toPrecision(6)} − y'²/${Math.abs(negR).toPrecision(6)} = 1`,
    steps, caveats,
  };
}

function describeDegenerate(kind: ConicKind): string {
  switch (kind) {
    case "point": return "a single point";
    case "line pair": return "two intersecting lines";
    case "parallel lines": return "two parallel lines, one line, or empty";
    default: return "degenerate";
  }
}

function fociFor(c: { x: number; y: number }, dist: number, rotDeg: number, alongX: boolean): { x: number; y: number }[] {
  const th = toRad(rotDeg);
  const ux = alongX ? Math.cos(th) : -Math.sin(th);
  const uy = alongX ? Math.sin(th) : Math.cos(th);
  return [
    { x: c.x + dist * ux, y: c.y + dist * uy },
    { x: c.x - dist * ux, y: c.y - dist * uy },
  ];
}

function verticesFor(c: { x: number; y: number }, a: number, rotDeg: number, alongX: boolean): { x: number; y: number }[] {
  return fociFor(c, a, rotDeg, alongX);
}

// ---------------------------------------------------------------------------
// Mensuration — exact where π and √ can be carried symbolically.
// ---------------------------------------------------------------------------

export interface ShapeSpec {
  shape: string;
  /** Named dimensions, e.g. { r: 5 } or { a: 3, b: 4, h: 2 }. */
  dims: Record<string, number>;
}

/** Area/perimeter/volume for the standard shapes. Exact forms carry π. */
export function shapeMetrics(spec: ShapeSpec): GeoResult | null {
  const d = spec.dims;
  const V = (label: string, value: number, exact?: string): GeoValue => ({ label, value, exact });
  const need = (...keys: string[]): boolean => keys.every((k) => typeof d[k] === "number" && Number.isFinite(d[k]) && d[k] > 0);
  const rExact = (n: number): string => fmtRat(ratFromNumber(n));

  switch (spec.shape) {
    case "circle": {
      if (!need("r")) return null;
      const r = d.r;
      return {
        title: `Circle, r = ${r}`,
        values: [
          V("area", Math.PI * r * r, `${rExact(r * r)}*pi`),
          V("circumference", 2 * Math.PI * r, `${rExact(2 * r)}*pi`),
          V("diameter", 2 * r, rExact(2 * r)),
        ],
        steps: ["A = πr², C = 2πr."], caveats: [],
      };
    }
    case "square": {
      if (!need("a")) return null;
      return {
        title: `Square, side ${d.a}`,
        values: [V("area", d.a * d.a, rExact(d.a * d.a)), V("perimeter", 4 * d.a, rExact(4 * d.a)),
          V("diagonal", d.a * Math.SQRT2, fmtSqrtRat(ratFromNumber(2 * d.a * d.a)) ?? undefined)],
        steps: ["A = a², P = 4a, diagonal = a√2."], caveats: [],
      };
    }
    case "rectangle": {
      if (!need("a", "b")) return null;
      return {
        title: `Rectangle ${d.a} × ${d.b}`,
        values: [V("area", d.a * d.b, rExact(d.a * d.b)), V("perimeter", 2 * (d.a + d.b), rExact(2 * (d.a + d.b))),
          V("diagonal", Math.hypot(d.a, d.b), fmtSqrtRat(ratFromNumber(d.a * d.a + d.b * d.b)) ?? undefined)],
        steps: ["A = ab, P = 2(a+b)."], caveats: [],
      };
    }
    case "sphere": {
      if (!need("r")) return null;
      const r = d.r;
      return {
        title: `Sphere, r = ${r}`,
        values: [
          V("volume", (4 / 3) * Math.PI * r ** 3, `${fmtRat(ratMul(ratMake(4n, 3n), ratFromNumber(r ** 3)))}*pi`),
          V("surface area", 4 * Math.PI * r * r, `${rExact(4 * r * r)}*pi`),
        ],
        steps: ["V = 4πr³/3, S = 4πr²."], caveats: [],
      };
    }
    case "cylinder": {
      if (!need("r", "h")) return null;
      const { r, h } = d;
      return {
        title: `Cylinder, r = ${r}, h = ${h}`,
        values: [
          V("volume", Math.PI * r * r * h, `${rExact(r * r * h)}*pi`),
          V("surface area", 2 * Math.PI * r * (r + h), `${rExact(2 * r * (r + h))}*pi`),
          V("lateral area", 2 * Math.PI * r * h, `${rExact(2 * r * h)}*pi`),
        ],
        steps: ["V = πr²h, S = 2πr(r+h)."], caveats: [],
      };
    }
    case "cone": {
      if (!need("r", "h")) return null;
      const { r, h } = d;
      const l = Math.hypot(r, h);
      return {
        title: `Cone, r = ${r}, h = ${h}`,
        values: [
          V("volume", (Math.PI * r * r * h) / 3, `${fmtRat(ratDiv(ratFromNumber(r * r * h), ratInt(3)))}*pi`),
          V("slant height", l, fmtSqrtRat(ratFromNumber(r * r + h * h)) ?? undefined),
          V("surface area", Math.PI * r * (r + l)),
        ],
        steps: ["V = πr²h/3, slant l = √(r²+h²), S = πr(r+l)."], caveats: [],
      };
    }
    case "box": {
      if (!need("a", "b", "c")) return null;
      const { a, b, c } = d;
      return {
        title: `Box ${a} × ${b} × ${c}`,
        values: [
          V("volume", a * b * c, rExact(a * b * c)),
          V("surface area", 2 * (a * b + b * c + a * c), rExact(2 * (a * b + b * c + a * c))),
          V("space diagonal", Math.sqrt(a * a + b * b + c * c), fmtSqrtRat(ratFromNumber(a * a + b * b + c * c)) ?? undefined),
        ],
        steps: ["V = abc, S = 2(ab+bc+ca)."], caveats: [],
      };
    }
    case "regular-polygon": {
      if (!need("n", "a") || d.n < 3 || !Number.isInteger(d.n)) return null;
      const { n, a } = d;
      const apothem = a / (2 * Math.tan(Math.PI / n));
      return {
        title: `Regular ${n}-gon, side ${a}`,
        values: [
          V("area", (n * a * apothem) / 2),
          V("perimeter", n * a, rExact(n * a)),
          V("interior angle", ((n - 2) * 180) / n, rExact(((n - 2) * 180) / n)),
          V("apothem", apothem),
          V("circumradius", a / (2 * Math.sin(Math.PI / n))),
        ],
        steps: [`Interior angle = (n−2)·180/n; area = n·a·apothem/2.`], caveats: [],
      };
    }
    default:
      return null;
  }
}
