// Input grammar for Solve's geometry kind (docs/GEOMETRY-TOPOLOGY-DESIGN.md).
//
// Solve's contract is "type the thing you have and get an answer", so geometry
// is typed rather than driven by a form. The grammar is deliberately forgiving
// about order and separators, and STRICT about ambiguity: `triangle 6 8 30`
// could be SSS or SSA, so a bare three-number triangle is read as SSS and any
// angle must be named (`A=30`), which is the only reading that cannot be wrong.
//
// A bare equation in x and y needs no keyword at all — anything quadratic is
// classified as a conic, which is the single most useful thing this tool can do
// with an equation a user already has in front of them.

import { parseExpr, Expr } from "./solve";
import {
  Rat, ratAdd, ratMul, ratNeg, ratInt, ratDiv, ratFromNumber, ratIsZero, RAT_ZERO, ratToNumber, ratSign,
} from "./cas";
import {
  v3, Vec3, vSub, dot, cross, norm, normSquared, angleBetween, project, isZeroVec,
  planeFrom3, pointPlaneDistance, anglePlanes, fmtPlane, lineFrom2, classifyLines,
  linePlaneIntersect, tetrahedronVolume, parallelepipedVolume, triangleArea3,
  sphereFrom4, fmtVec, vectorReport,
  Mat3, mat3Apply, mat3Mul, scaleMatrix, reflectionMatrix, rotationMatrix, transformEffect,
} from "./geometry3d";
import {
  pt, Pt, GeoResult, GeoValue, distance, midpoint, lineThrough, lineIntersect,
  pointLineDistance, polygonArea, polygonCentroid, isConvex, convexHull,
  triangleCentres, circleFrom3Points, solveTriangle, classifyConic, shapeMetrics,
  fmtRat, fmtSqrtRat, sqrtRatToNumber, distanceSquared, collinear, pointInPolygon,
} from "./geometry";

// ---------------------------------------------------------------------------
// Bivariate quadratic extraction — for conic classification.
// ---------------------------------------------------------------------------

/** Coefficients of x^i·y^j, exactly, or null if not a polynomial of degree ≤ 2. */
export function quadraticCoeffs(e: Expr, xv = "x", yv = "y"): Map<string, Rat> | null {
  const out = new Map<string, Rat>();
  const add = (i: number, j: number, c: Rat) => {
    if (i + j > 2) throw new Deg();
    const k = `${i},${j}`;
    out.set(k, ratAdd(out.get(k) ?? RAT_ZERO, c));
  };

  class Deg extends Error {}

  // Returns a map for the subtree, or throws Deg when the degree is exceeded.
  function walk(n: Expr, scale: Rat): void {
    switch (n.t) {
      case "num":
        add(0, 0, ratMul(scale, ratFromNumber(n.v)));
        return;
      case "var":
        if (n.name === xv) return add(1, 0, scale);
        if (n.name === yv) return add(0, 1, scale);
        throw new Deg(); // a third symbol: not a plane conic
      case "neg":
        return walk(n.e, ratNeg(scale));
      case "add":
        walk(n.l, scale); walk(n.r, scale); return;
      case "sub":
        walk(n.l, scale); walk(n.r, ratNeg(scale)); return;
      case "mul": {
        // Only handle products where at least one side is constant, or both are
        // linear — enough for every genuine conic, and honest about the rest.
        const lc = constOf(n.l), rc = constOf(n.r);
        if (lc) return walk(n.r, ratMul(scale, lc));
        if (rc) return walk(n.l, ratMul(scale, rc));
        const a = linearOf(n.l), b = linearOf(n.r);
        if (!a || !b) throw new Deg();
        for (const [i1, j1, c1] of a) {
          for (const [i2, j2, c2] of b) add(i1 + i2, j1 + j2, ratMul(scale, ratMul(c1, c2)));
        }
        return;
      }
      case "div": {
        const rc = constOf(n.r);
        if (!rc || ratIsZero(rc)) throw new Deg();
        return walk(n.l, ratMul(scale, { n: rc.d, d: rc.n < 0n ? -rc.n : rc.n } as Rat));
      }
      case "pow": {
        const p = constOf(n.r);
        if (!p || p.d !== 1n) throw new Deg();
        const k = Number(p.n);
        if (k < 0 || k > 2 || !Number.isInteger(k)) throw new Deg();
        if (k === 0) return add(0, 0, scale);
        const base = linearOf(n.l);
        if (!base) throw new Deg();
        if (k === 1) { for (const [i, j, c] of base) add(i, j, ratMul(scale, c)); return; }
        for (const [i1, j1, c1] of base) {
          for (const [i2, j2, c2] of base) add(i1 + i2, j1 + j2, ratMul(scale, ratMul(c1, c2)));
        }
        return;
      }
      default:
        throw new Deg(); // a function of x or y is not a conic
    }
  }

  /** The constant value of a subtree, if it has no x or y. */
  function constOf(n: Expr): Rat | null {
    try {
      const m = new Map<string, Rat>();
      const saved = out;
      // cheap: re-walk into a scratch map
      const probe = collect(n);
      if (!probe) return null;
      for (const [k, v] of probe) if (k !== "0,0" && !ratIsZero(v)) return null;
      return probe.get("0,0") ?? RAT_ZERO;
    } catch {
      return null;
    }
  }

  /** [i, j, coeff] terms of a subtree if it is linear (degree ≤ 1). */
  function linearOf(n: Expr): [number, number, Rat][] | null {
    const m = collect(n);
    if (!m) return null;
    const terms: [number, number, Rat][] = [];
    for (const [k, v] of m) {
      const [i, j] = k.split(",").map(Number);
      if (i + j > 1) return null;
      if (!ratIsZero(v)) terms.push([i, j, v]);
    }
    return terms;
  }

  /** Full coefficient map of a subtree, or null if it is not polynomial ≤ 2. */
  function collect(n: Expr): Map<string, Rat> | null {
    const saveEntries = [...out.entries()];
    out.clear();
    let ok = true;
    try {
      walk(n, ratInt(1));
    } catch {
      ok = false;
    }
    const got = new Map(out);
    out.clear();
    for (const [k, v] of saveEntries) out.set(k, v);
    return ok ? got : null;
  }

  const res = collect(e);
  return res;
}

// ---------------------------------------------------------------------------
// Tokenising helpers
// ---------------------------------------------------------------------------

/** Pulls "(1,2)" / "(1, -2)" / "1,2" coordinate pairs out of a string. */
function parsePoints(s: string): Pt[] {
  const out: Pt[] = [];
  const re = /\(\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(pt(ratOf(m[1]), ratOf(m[2])));
  return out;
}

function numOf(t: string): number {
  if (t.includes("/")) {
    const [a, b] = t.split("/").map(Number);
    return a / b;
  }
  return Number(t);
}

/**
 * A typed coordinate as an EXACT rational.
 *
 * numOf() divides as a float, so "1/3" arrived as 0.3333333333333333 and the
 * exact layer then faithfully preserved that noise — a point typed (1/2,1/3)
 * reported its coordinate as 3333333333333333/10000000000000000. Coordinates
 * are the one place where the user's own fraction must survive intact, so they
 * are parsed straight into the rational layer instead of via a double.
 */
function ratOf(t: string): Rat {
  if (t.includes("/")) {
    const [a, b] = t.split("/");
    const num = ratFromNumber(Number(a));
    const den = ratFromNumber(Number(b));
    if (!ratIsZero(den)) return ratDiv(num, den);
  }
  return ratFromNumber(Number(t));
}


/** Named values: "r=5 h=2 A=30" → { r: 5, h: 2, A: 30 }. Case-sensitive. */
function parseNamed(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /\b([A-Za-z]\w*)\s*=\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = numOf(m[2]);
  return out;
}

/** The same named values, kept EXACT for callers that can use them. */
function parseNamedExact(s: string): Record<string, Rat> {
  const out: Record<string, Rat> = {};
  const re = /\b([A-Za-z]\w*)\s*=\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = ratOf(m[2]);
  return out;
}

/** Bare numbers not part of a name=value pair or a coordinate. */
function bareNumbers(s: string): number[] {
  const stripped = s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Za-z]\w*\s*=\s*-?\d+(?:\.\d+)?(?:\/\d+)?/g, " ");
  return (stripped.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).map(numOf);
}

/** The same positional numbers, kept EXACT (see ratOf). */
function bareRats(s: string): Rat[] {
  const stripped = s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Za-z]\w*\s*=\s*-?\d+(?:\.\d+)?(?:\/\d+)?/g, " ");
  return (stripped.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).map(ratOf);
}

const fmtPt = (p: Pt): string => `(${fmtRat(p.x)}, ${fmtRat(p.y)})`;
const V = (label: string, value: number, exact?: string): GeoValue => ({ label, value, exact });

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Interprets a typed geometry request. Returns null when nothing in the string
 * looks like geometry, so the caller can report that rather than guessing.
 */
export function solveGeometry(input: string): GeoResult | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // 3D comes FIRST, because a triple like (1,2,3) is unambiguous: the 2D
  // grammar only ever produces pairs, so there is no reading to lose.
  const solid = solveGeometry3D(raw, lower);
  if (solid) return solid;

  // 1. A bare equation in x and y → conic classification. Checked FIRST because
  //    it needs no keyword, and it is the highest-value single answer here.
  if (raw.includes("=") && /[xy]/.test(lower) && !/^[a-z]+\s/.test(lower)) {
    const conic = tryConic(raw);
    if (conic) return conic;
  }

  const named = parseNamed(raw);
  const pts = parsePoints(raw);
  const bare = bareNumbers(raw);

  // 2. Keyword-led shapes.
  const kw = (lower.match(/^[a-z-]+/) || [""])[0];

  if (kw === "triangle") return triangleRequest(raw, named, bare, pts);

  if (kw === "distance") {
    if (pts.length < 2) return null;
    const d = distance(pts[0], pts[1]);
    return {
      title: `Distance ${fmtPt(pts[0])} → ${fmtPt(pts[1])}`,
      values: [d, ...(pts.length >= 2 ? [] : [])],
      steps: ["d = √((x₂−x₁)² + (y₂−y₁)²)."],
      caveats: [],
    };
  }

  if (kw === "midpoint") {
    if (pts.length < 2) return null;
    const m = midpoint(pts[0], pts[1]);
    return {
      title: `Midpoint of ${fmtPt(pts[0])} and ${fmtPt(pts[1])}`,
      values: [V("x", Number(fmtRat(m.x).includes("/") ? evalFrac(fmtRat(m.x)) : Number(fmtRat(m.x))), fmtRat(m.x)),
        V("y", evalFrac(fmtRat(m.y)), fmtRat(m.y))],
      steps: ["Midpoint = ((x₁+x₂)/2, (y₁+y₂)/2)."], caveats: [],
    };
  }

  if (kw === "line") {
    if (pts.length < 2) return null;
    const l = lineThrough(pts[0], pts[1]);
    if (!l) return { title: "Line", values: [], steps: [], caveats: [], degenerate: "The two points coincide, so they do not define a line." };
    const steps = [`Line through ${fmtPt(pts[0])} and ${fmtPt(pts[1])}: ${fmtRat(l.a)}x + ${fmtRat(l.b)}y = ${fmtRat(l.c)}.`];
    const vals: GeoValue[] = [];
    if (!ratIsZero(l.b)) {
      const slope = { n: -l.a.n * l.b.d, d: l.a.d * l.b.n } as Rat;
      vals.push(V("slope", evalFrac(fmtRat(normRat(slope))), fmtRat(normRat(slope))));
    } else steps.push("The line is vertical, so its slope is undefined.");
    if (pts.length >= 4) {
      const m = lineThrough(pts[2], pts[3]);
      if (m) {
        const r = lineIntersect(l, m);
        steps.push(
          r.kind === "point" ? `Intersection with the second line: ${fmtPt(r.p)}.`
            : r.kind === "parallel" ? "The two lines are PARALLEL — they never meet."
              : "The two lines are the SAME line — every point is an intersection."
        );
      }
    }
    return { title: "Line", values: vals, steps, caveats: [] };
  }

  if (kw === "polygon" || kw === "points" || kw === "hull") {
    if (pts.length >= 3) return polygonRequest(kw, pts);
    // "polygon n=6 a=2" is the regular polygon instead.
    if (named.n && named.a) {
      return shapeMetrics({ shape: "regular-polygon", dims: { n: named.n, a: named.a }, exact: parseNamedExact(raw) });
    }
    return null;
  }

  if (kw === "circle" && (named.r || bare.length === 1) && pts.length === 0) {
    return shapeMetrics({ shape: "circle", dims: { r: named.r ?? bare[0] },
      exact: { r: parseNamedExact(raw).r ?? bareRats(raw)[0] } });
  }
  if (kw === "circle" && pts.length >= 3) {
    const c = circleFrom3Points(pts[0], pts[1], pts[2]);
    if (!c) {
      return { title: "Circle through three points", values: [], steps: [], caveats: [],
        degenerate: "Those three points are COLLINEAR, so no circle passes through all three." };
    }
    const r2 = c.r2;
    return {
      title: `Circle through ${fmtPt(pts[0])}, ${fmtPt(pts[1])}, ${fmtPt(pts[2])}`,
      values: [
        V("centre x", evalFrac(fmtRat(c.centre.x)), fmtRat(c.centre.x)),
        V("centre y", evalFrac(fmtRat(c.centre.y)), fmtRat(c.centre.y)),
        V("radius", sqrtRatToNumber(r2), fmtSqrtRat(r2) ?? undefined),
        V("area", Math.PI * evalFrac(fmtRat(r2)), `${fmtRat(r2)}*pi`),
      ],
      steps: ["Centre = the circumcentre (intersection of the perpendicular bisectors), computed exactly."],
      caveats: [],
    };
  }

  // Mensuration by keyword.
  const SHAPES: Record<string, string[]> = {
    square: ["a"], rectangle: ["a", "b"], sphere: ["r"], box: ["a", "b", "c"],
    cylinder: ["r", "h"], cone: ["r", "h"],
  };
  if (kw in SHAPES) {
    const keys = SHAPES[kw];
    const dims: Record<string, number> = {};
    keys.forEach((k, i) => { dims[k] = named[k] ?? bare[i]; });
    // Exactness must survive the positional form too: `box 1/2 1/3 1/4` has no
    // name=value pairs at all, so the fractions live only in the bare list.
    const exact: Record<string, Rat> = parseNamedExact(raw);
    const bareEx = bareRats(raw);
    keys.forEach((k, i) => { if (exact[k] === undefined && bareEx[i] !== undefined) exact[k] = bareEx[i]; });
    const res = shapeMetrics({ shape: kw, dims, exact });
    if (res) return res;
    return null;
  }

  // 3. Bare coordinates with no keyword → treat as a point set.
  if (pts.length >= 3) return polygonRequest("points", pts);
  if (pts.length === 2) {
    const d = distance(pts[0], pts[1]);
    const m = midpoint(pts[0], pts[1]);
    return {
      title: `Two points ${fmtPt(pts[0])}, ${fmtPt(pts[1])}`,
      values: [d, V("midpoint x", evalFrac(fmtRat(m.x)), fmtRat(m.x)), V("midpoint y", evalFrac(fmtRat(m.y)), fmtRat(m.y))],
      steps: [], caveats: [],
    };
  }

  // 4. Last resort: an equation that might still be a conic.
  if (raw.includes("=")) return tryConic(raw);
  return null;
}

function normRat(r: Rat): Rat {
  return r.d < 0n ? ({ n: -r.n, d: -r.d } as Rat) : r;
}

function evalFrac(s: string): number {
  if (!s.includes("/")) return Number(s);
  const [a, b] = s.split("/").map(Number);
  return a / b;
}

function triangleRequest(
  raw: string, named: Record<string, number>, bare: number[], pts: Pt[]
): GeoResult | null {
  // Coordinates given → centres and metrics.
  if (pts.length >= 3) return polygonRequest("triangle", pts);

  const has = (k: string) => typeof named[k] === "number";
  const angles = ["A", "B", "C"].filter(has);
  const sides = ["a", "b", "c"].filter(has);

  let sol;
  if (!angles.length && (sides.length === 3 || bare.length >= 3)) {
    const [a, b, c] = sides.length === 3 ? [named.a, named.b, named.c] : bare;
    sol = solveTriangle({ kind: "SSS", a, b, c });
  } else if (angles.length === 1 && sides.length === 2) {
    const ang = angles[0];
    // Included angle (SAS) when the angle is NOT opposite either given side.
    const opposite = ang.toLowerCase();
    sol = sides.includes(opposite)
      ? solveTriangle({ kind: "SSA", a: named[opposite], b: named[sides.find((s) => s !== opposite)!], A: named[ang] })
      : solveTriangle({ kind: "SAS", b: named[sides[0]], c: named[sides[1]], A: named[ang] });
  } else if (angles.length === 2 && sides.length === 1) {
    sol = solveTriangle({
      kind: "ASA", A: named[angles[0]], B: named[angles[1]],
      a: named.a, b: named.b, c: named.c,
    });
  } else {
    return null;
  }

  if (sol.impossible) {
    return { title: `Triangle (${sol.kind})`, values: [], steps: [], caveats: sol.caveats, degenerate: sol.impossible };
  }
  const values: GeoValue[] = [];
  const steps: string[] = [`Solved as ${sol.kind}.`];
  sol.triangles.forEach((t, i) => {
    const tag = sol!.triangles.length > 1 ? ` (solution ${i + 1})` : "";
    values.push(
      V(`a${tag}`, t.a), V(`b${tag}`, t.b), V(`c${tag}`, t.c),
      V(`A${tag}`, t.A), V(`B${tag}`, t.B), V(`C${tag}`, t.C),
      { label: `area${tag}`, value: t.area, exact: t.areaExact }
    );
  });
  return { title: `Triangle (${sol.kind})`, values, steps, caveats: sol.caveats };
}

function polygonRequest(kw: string, pts: Pt[]): GeoResult {
  const area = polygonArea(pts);
  const values: GeoValue[] = [
    { label: "area", value: evalFrac(fmtRat(area)), exact: fmtRat(area) },
  ];
  let perim = 0;
  for (let i = 0; i < pts.length; i++) perim += sqrtRatToNumber(distanceSquared(pts[i], pts[(i + 1) % pts.length]));
  values.push(V("perimeter", perim));

  const steps: string[] = [`${pts.length} points; area by the shoelace formula, exactly.`];
  const caveats: string[] = [];

  const cent = polygonCentroid(pts);
  if (cent) {
    values.push(V("centroid x", evalFrac(fmtRat(cent.x)), fmtRat(cent.x)));
    values.push(V("centroid y", evalFrac(fmtRat(cent.y)), fmtRat(cent.y)));
  } else {
    caveats.push("The points enclose zero area (they are collinear), so there is no centroid.");
  }
  steps.push(`Convex: ${isConvex(pts) ? "yes" : "no"}.`);

  const hull = convexHull(pts);
  if (hull.length && hull.length < pts.length) {
    steps.push(`Convex hull uses ${hull.length} of the ${pts.length} points: ${hull.map(fmtPt).join(" ")}.`);
  }

  // Three points → the full triangle-centre readout, including the Euler line.
  if (pts.length === 3) {
    const c = triangleCentres(pts[0], pts[1], pts[2]);
    if (!c) {
      caveats.push("These three points are COLLINEAR — there is no triangle, so no centres and no circumcircle.");
    } else {
      values.push(V("centroid", NaN));
      values.pop();
      steps.push(`Centroid ${fmtPt(c.centroid)}, circumcentre ${fmtPt(c.circumcentre!)}, orthocentre ${fmtPt(c.orthocentre!)}.`);
      if (c.incentre) steps.push(`Incentre ≈ (${c.incentre.x.toFixed(6)}, ${c.incentre.y.toFixed(6)}) — irrational in general, so numeric.`);
      steps.push(
        c.eulerLineCollinear
          ? "Euler line check: centroid, circumcentre and orthocentre are collinear — verified exactly."
          : "Euler line check FAILED, which should be impossible; treat this result with suspicion."
      );
      const circ = circleFrom3Points(pts[0], pts[1], pts[2]);
      if (circ) values.push(V("circumradius", sqrtRatToNumber(circ.r2), fmtSqrtRat(circ.r2) ?? undefined));
    }
  }
  return { title: `${kw === "triangle" ? "Triangle" : "Polygon"} from ${pts.length} points`, values, steps, caveats };
}

function tryConic(raw: string): GeoResult | null {
  const parts = raw.split("=");
  if (parts.length !== 2) return null;
  let lhs: Expr, rhs: Expr;
  try {
    lhs = parseExpr(parts[0]);
    rhs = parseExpr(parts[1]);
  } catch {
    return null;
  }
  const coeffs = quadraticCoeffs({ t: "sub", l: lhs, r: rhs });
  if (!coeffs) return null;
  const g = (i: number, j: number): Rat => coeffs.get(`${i},${j}`) ?? RAT_ZERO;
  const A = g(2, 0), B = g(1, 1), C = g(0, 2), D = g(1, 0), E = g(0, 1), F = g(0, 0);
  if (ratIsZero(A) && ratIsZero(B) && ratIsZero(C)) return null; // linear, not a conic

  const r = classifyConic(A, B, C, D, E, F);
  const values: GeoValue[] = [];
  if (r.centre) {
    values.push(V("centre x", r.centre.x), V("centre y", r.centre.y));
  }
  if (typeof r.a === "number") values.push(V(r.kind === "parabola" ? "focal parameter" : "semi-axis a", r.a));
  if (typeof r.b === "number") values.push(V("semi-axis b", r.b));
  if (typeof r.eccentricity === "number") values.push(V("eccentricity", r.eccentricity));
  if (r.foci) r.foci.forEach((f, i) => values.push(V(`focus ${i + 1}`, NaN, `(${f.x.toFixed(6)}, ${f.y.toFixed(6)})`)));
  if (Math.abs(r.rotationDeg) > 1e-9) values.push(V("rotation (deg)", r.rotationDeg));

  const steps = [
    `General form: ${fmtRat(A)}x² + ${fmtRat(B)}xy + ${fmtRat(C)}y² + ${fmtRat(D)}x + ${fmtRat(E)}y + ${fmtRat(F)} = 0.`,
    ...r.steps,
    `Canonical form: ${r.canonical}.`,
  ];
  if (r.asymptotes) steps.push(`Asymptotes: ${r.asymptotes.join("; ")}.`);

  return {
    title: `Conic: ${r.kind}${r.degenerate ? " (degenerate)" : ""}`,
    values, steps, caveats: r.caveats,
    degenerate: r.degenerate ? `This is a degenerate conic: ${r.canonical}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// 3D — Tiers 3–4.
// ---------------------------------------------------------------------------

/** Pulls "(1,2,3)" triples out of a string. Pairs are left for the 2D grammar. */
function parseTriples(s: string): Vec3[] {
  const out: Vec3[] = [];
  const num = String.raw`-?\d+(?:\.\d+)?(?:\/\d+)?`;
  const re = new RegExp(String.raw`\(\s*(${num})\s*,\s*(${num})\s*,\s*(${num})\s*\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(v3(ratOf(m[1]), ratOf(m[2]), ratOf(m[3])));
  return out;
}

const V3 = (label: string, value: number, exact?: string): GeoValue => ({ label, value, exact });
const rnum = (r: { n: bigint; d: bigint }): number => evalFrac(fmtRat(r));

/**
 * 3D geometry from typed input. Returns null when the string contains no
 * coordinate triples, so the 2D grammar gets its turn.
 */
/**
 * Linear transformations of a point in space.
 *
 * A complete, tested 3-D transform toolkit shipped in `geometry3d.ts` with no
 * way for anyone to invoke it. This is the route in: a chain of named
 * operations applied to a point, composed by matrix multiplication, with the
 * determinant reported — because the determinant is the part people get wrong.
 * It is the volume scale factor, and its SIGN says whether the transformation
 * turned the space inside out. A reflection has determinant −1 and preserves
 * every length and angle, yet no rotation can reproduce it.
 *
 * Accepts, in any combination and order:
 *   rotate 90 z (1,2,3)          rotate 90 about the x-axis (1,2,3)
 *   scale 2 3 4 (1,2,3)          scale 1/2 (1,2,3) for uniform
 *   reflect xy (1,2,3)           mirror the point (1,2,3) in the yz plane
 *   rotate 90 z then scale 2 then reflect xy (1,2,3)
 *
 * Operations are separated by `then` or `;` — NOT by a comma, because a comma
 * already separates the factors of `scale 2, 3, 4`.
 *
 * ORDER MATTERS and the composition is stated: operations are applied left to
 * right, so the matrix is the product in the reverse of the reading order.
 * Rotation then reflection is not reflection then rotation, and quietly
 * choosing one convention would be the kind of silent decision this product
 * refuses elsewhere.
 *
 * IT REFUSES RATHER THAN SUBSTITUTING. Every earlier failure here was silent:
 * an axis it could not read became `z`, a scale factor it could not read became
 * the first number it recognised, and a two-factor scale quietly dropped one.
 * A transformation the user did not ask for, reported as though they had, is
 * worse than no answer.
 */
function transformRequest(raw: string, lower: string, P: Vec3[]): GeoResult | null {
  if (!P.length) return null;
  const point = P[0];
  // Remove only the COORDINATE TRIPLES, keeping any words written after them —
  // "mirror the point (1,2,3) in the yz plane" puts the plane at the end, and
  // cutting the string at the first "(" threw it away and silently reflected in
  // xy instead.
  const numPat = String.raw`-?\d+(?:\.\d+)?(?:\/\d+)?`;
  const tripleRe = new RegExp(String.raw`\(\s*${numPat}\s*,\s*${numPat}\s*,\s*${numPat}\s*\)`, "g");
  const headLower = lower.replace(tripleRe, " ");
  const steps: string[] = [];
  const caveats: string[] = [];
  const applied: string[] = [];

  const parts = headLower.split(/\bthen\b|;/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;

  /** Numbers a user might reasonably type: 90, 1.5, -3, 1/2, 1e3. */
  const readNums = (s: string): number[] =>
    (s.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\/\d+(?:\.\d+)?)?/g) || []).map((tok) => {
      if (tok.includes("/")) {
        const [a, b] = tok.split("/").map(Number);
        return b === 0 ? NaN : a / b;
      }
      return Number(tok);
    });

  let m: Mat3 | null = null;
  let anyNumeric = false;
  let refused: string | null = null;
  for (const part of parts) {
    // TWO OPERATIONS IN ONE PART MEANS A MISSING SEPARATOR. "rotate 90 z, scale
    // 2" reads as one step, and the first keyword matched used to win while the
    // other was dropped without a word. A comma cannot be the separator here,
    // because a comma already separates the factors of "scale 2, 3, 4" — so the
    // user is told which word to use instead.
    const verbs = (part.match(/\b(rotate|rotation|scale|dilate|reflect|mirror)\b/g) || []).length;
    if (verbs > 1) {
      refused =
        `"${part.trim()}" names more than one transformation at once. Separate them with ` +
        `"then" (or a semicolon) — a comma cannot do it, because a comma already separates the ` +
        "three factors of a scale.";
      break;
    }
    const nums = readNums(part);
    let step: Mat3 | null = null;
    if (/\brotate|rotation\b/.test(part)) {
      // An axis letter may be written on its own, hyphenated ("x-axis"), or
      // followed by a number. The old guard rejected the last two and fell back
      // to z WITHOUT SAYING SO, so "rotate about x 90" silently rotated about z.
      const axisM = /(?:^|[^a-z])([xyz])(?:[-\s]?axis)?(?![a-z])/.exec(part);
      if (!nums.length || !Number.isFinite(nums[0])) {
        refused = `"${part.trim()}" does not give a rotation angle I can read.`;
        break;
      }
      if (!axisM) {
        refused =
          `"${part.trim()}" does not name an axis. Write x, y or z — a rotation in space is ` +
          "meaningless without one, and guessing would silently give you a different rotation.";
        break;
      }
      step = rotationMatrix(axisM[1] as "x" | "y" | "z", nums[0]);
      anyNumeric = true;
      applied.push(`rotate ${nums[0]}° about ${axisM[1]}`);
    } else if (/\bscale|dilate\b/.test(part)) {
      if (!nums.length || nums.some((v) => !Number.isFinite(v))) {
        refused = `"${part.trim()}" does not give a scale factor I can read.`;
        break;
      }
      if (nums.length === 2 || nums.length > 3) {
        refused =
          `"${part.trim()}" gives ${nums.length} scale factors. Give ONE for a uniform scale or ` +
          "THREE for x, y and z; anything else would mean discarding a number you typed.";
        break;
      }
      const [sx, sy, sz] = nums.length === 3 ? nums : [nums[0], nums[0], nums[0]];
      step = scaleMatrix(sx, sy, sz);
      applied.push(nums.length === 3 ? `scale (${sx}, ${sy}, ${sz})` : `scale ×${sx} uniformly`);
      // A non-integer factor goes through the float layer like a rotation does.
      if (![sx, sy, sz].every(Number.isInteger)) anyNumeric = true;
    } else if (/\breflect|mirror\b/.test(part)) {
      const pm = /\b(xy|yx|yz|zy|zx|xz)\b/.exec(part);
      if (!pm) {
        refused =
          `"${part.trim()}" does not name a plane. Write xy, yz or zx — reflecting needs a ` +
          "mirror, and picking one for you would silently give a different transformation.";
        break;
      }
      const plane = (pm[1] === "yx" ? "xy" : pm[1] === "zy" ? "yz" : pm[1] === "xz" ? "zx" : pm[1]) as
        | "xy"
        | "yz"
        | "zx";
      step = reflectionMatrix(plane);
      applied.push(`reflect in the ${plane} plane`);
    }
    if (!step) continue;
    // Left to right application means the newest operation multiplies on the
    // LEFT of everything already accumulated.
    m = m === null ? step : mat3Mul(step, m);
  }
  if (refused) {
    return { title: "Transformation", values: [], steps: [], caveats: [], degenerate: refused };
  }
  if (!m || !applied.length) return null;
  if (P.length > 1) {
    caveats.push(
      `${P.length} points were given; only the first, ${fmtVec(point)}, was transformed. Ask for ` +
        "one point at a time.",
    );
  }

  const out = mat3Apply(m, point);
  const eff = transformEffect(m);

  // A ROTATION'S ENTRIES ARE NOT RATIONAL, and pretending otherwise is
  // unreadable rather than merely imprecise: cos 90° arrives as 6.1e-17, whose
  // faithful exact form is a sixty-digit fraction over a sixty-digit
  // denominator. The rational layer exists so these compose with the exact
  // ones, not so the noise gets printed. Numeric results are therefore shown as
  // decimals, and only genuinely exact ones keep their fraction.
  const num = (v: Rat): number => ratToNumber(v);
  const show = (v: Rat): string | undefined => (anyNumeric ? undefined : fmtRat(v));
  const showVec = (v: { x: Rat; y: Rat; z: Rat }): string =>
    anyNumeric
      ? `(${[v.x, v.y, v.z].map((c) => Number(num(c).toPrecision(6))).join(", ")})`
      : fmtVec(v);
  const detText = anyNumeric ? String(Number(num(eff.det).toPrecision(6))) : fmtRat(eff.det);

  steps.push(`Applied to ${showVec(point)}, in order: ${applied.join(", then ")}.`);
  steps.push(`Result: ${showVec(out)}.`);
  steps.push(
    `Determinant ${detText} — the factor by which the transformation multiplies VOLUME.`,
  );
  if (eff.singular) {
    steps.push(
      "The determinant is ZERO, so this transformation COLLAPSES space onto a plane, line or " +
        "point. It cannot be undone: different points before it now share the same image.",
    );
  } else if (eff.flipsOrientation) {
    steps.push(
      "The determinant is NEGATIVE, so the transformation FLIPS ORIENTATION — it turns a " +
        "right-handed frame into a left-handed one. A reflection does this while preserving " +
        "every length and angle, which is why no rotation can ever reproduce one.",
    );
  } else {
    steps.push("The determinant is positive, so orientation is preserved: this is a proper motion.");
  }
  if (applied.length > 1) {
    caveats.push(
      "ORDER MATTERS. These were applied left to right as written, so the matrix is the product " +
        "in the reverse of the reading order. Rotating then reflecting is not the same as " +
        "reflecting then rotating.",
    );
  }
  if (anyNumeric) {
    caveats.push(
      "A rotation's entries are cosines and sines, which are irrational for all but a few " +
        "angles, so this result is NUMERIC rather than exact. The determinant is 1 up to " +
        "floating-point error rather than exactly 1.",
    );
  }

  // THE SIGNED AND UNSIGNED QUANTITIES ARE DIFFERENT ROWS.
  //
  // These used to be one: the value was |det| while the exact string was the
  // SIGNED determinant, and the renderer prints "label = exact ≈ value"
  // whenever the two differ — so a reflection displayed, and INSERTED into the
  // document, "volume scale factor = -1  ≈ 1". A volume scale factor is
  // non-negative by definition. The sign belongs to the determinant, so the
  // determinant gets its own row and keeps it.
  const detNumeric = num(eff.det);
  const absDetExact = anyNumeric
    ? undefined
    : fmtRat(ratSign(eff.det) < 0 ? ratNeg(eff.det) : eff.det);
  return {
    title: `Transform of ${showVec(point)}`,
    values: [
      V3("x", num(out.x), show(out.x)),
      V3("y", num(out.y), show(out.y)),
      V3("z", num(out.z), show(out.z)),
      V3("determinant", detNumeric, show(eff.det)),
      V3("volume scale factor", eff.volumeScale, absDetExact),
    ],
    steps,
    caveats,
  };
}

export function solveGeometry3D(raw: string, lower: string): GeoResult | null {
  const P = parseTriples(raw);
  if (P.length === 0) return null;
  const kw = (lower.match(/^[a-z-]+/) || [""])[0];

  // Transformations, checked early: their keyword is unambiguous and they take
  // numeric arguments before the point, which the other branches would misread.
  if (/^(rotate|rotation|scale|dilate|reflect|mirror|transform)\b/.test(lower)) {
    const t = transformRequest(raw, lower, P);
    if (t) return t;
  }

  // Explicit vector operations on two triples.
  if ((kw === "vector" || kw === "vectors" || kw === "dot" || kw === "cross" || kw === "angle") && P.length >= 2) {
    return vectorReport(P[0], P[1]);
  }

  // A line and a plane needs FIVE points, so it is matched before the
  // two-line case below — otherwise `P.length >= 4` swallows it and reports a
  // pair of lines, one of which was meant to be the plane.
  if (kw === "line" && P.length === 5) {
    const l = lineFrom2(P[0], P[1]);
    const pl = planeFrom3(P[2], P[3], P[4]);
    if (!l || !pl) {
      return { title: "Line and plane", values: [], steps: [], caveats: [],
        degenerate: !l ? "The two line points coincide, so they define no line."
          : "The three plane points are COLLINEAR, so they define no plane." };
    }
    const r = linePlaneIntersect(l, pl);
    const steps = [`Line through ${fmtVec(P[0])} and ${fmtVec(P[1])}.`, `Plane: ${fmtPlane(pl)}.`];
    if (r.kind === "point") steps.push(`The line meets the plane at ${fmtVec(r.at)}.`);
    else if (r.kind === "parallel") steps.push("The line is PARALLEL to the plane and never meets it.");
    else steps.push("The line lies ENTIRELY IN the plane, so every point of it is an intersection.");
    return { title: `Line and plane — ${r.kind}`, values: [], steps, caveats: [] };
  }

  // Two lines, each from a pair of points: classify and measure.
  if ((kw === "line" || kw === "lines" || kw === "skew") && P.length >= 4) {
    const l1 = lineFrom2(P[0], P[1]), l2 = lineFrom2(P[2], P[3]);
    if (!l1 || !l2) {
      return { title: "Two lines in space", values: [], steps: [], caveats: [],
        degenerate: "A line needs two DISTINCT points; one of these pairs coincides." };
    }
    const r = classifyLines(l1, l2);
    const steps = [`Line 1 through ${fmtVec(P[0])} and ${fmtVec(P[1])}; line 2 through ${fmtVec(P[2])} and ${fmtVec(P[3])}.`];
    const values: GeoValue[] = [];
    switch (r.kind) {
      case "identical":
        steps.push("These are the SAME line — every point is shared.");
        break;
      case "parallel":
        steps.push("The directions are parallel, so the lines never meet.");
        values.push({ ...r.distance, label: "distance between them" });
        break;
      case "intersecting":
        steps.push(`The lines INTERSECT at ${fmtVec(r.at)}.`);
        values.push(V3("distance between them", 0, "0"));
        break;
      case "skew":
        steps.push("The lines are SKEW — not parallel, and they never meet. This is the case the distance formula exists for.");
        values.push({ ...r.distance, label: "distance between them" });
        break;
    }
    return { title: `Two lines in space — ${r.kind}`, values, steps, caveats: [] };
  }

  switch (P.length) {
    case 1: {
      const n = norm(P[0]);
      return {
        title: `Vector ${fmtVec(P[0])}`,
        values: [{ ...n, label: "magnitude" }],
        steps: [`|v|² = ${fmtRat(normSquared(P[0]))}.`],
        caveats: [],
      };
    }
    case 2: {
      // Two points: distance and the vector between, plus the vector readout.
      const d = vSub(P[1], P[0]);
      const dn = norm(d);
      const rep = vectorReport(P[0], P[1]);
      rep.title = `Two points ${fmtVec(P[0])}, ${fmtVec(P[1])}`;
      rep.values.unshift({ ...dn, label: "distance between the points" });
      rep.steps.unshift(`Displacement ${fmtVec(P[0])} → ${fmtVec(P[1])} is ${fmtVec(d)}.`);
      return rep;
    }
    case 3: {
      const pl = planeFrom3(P[0], P[1], P[2]);
      if (!pl) {
        return { title: "Three points in space", values: [], steps: [], caveats: [],
          degenerate: "These three points are COLLINEAR — they define no plane, and the triangle they would form has zero area." };
      }
      const area = triangleArea3(P[0], P[1], P[2]);
      const values: GeoValue[] = [{ ...area, label: "triangle area" }];
      const steps = [
        `Plane through the three points: ${fmtPlane(pl)}.`,
        `Normal ${fmtVec(pl.n)}.`,
      ];
      const sides = [norm(vSub(P[1], P[0])), norm(vSub(P[2], P[1])), norm(vSub(P[0], P[2]))];
      sides.forEach((s, i) => values.push({ ...s, label: `side ${i + 1}` }));
      return { title: "Three points in space (a plane and a triangle)", values, steps, caveats: [] };
    }
    default: {
      // Four or more: tetrahedron volume and the circumscribed sphere.
      const vol = tetrahedronVolume(P[0], P[1], P[2], P[3]);
      const values: GeoValue[] = [V3("tetrahedron volume", rnum(vol), fmtRat(vol))];
      const steps: string[] = [];
      const caveats: string[] = [];
      if (ratIsZero(vol)) {
        caveats.push("These four points are COPLANAR: they bound no volume, and no unique sphere passes through them.");
        steps.push("Volume is exactly zero, computed from the scalar triple product.");
        return { title: "Four points in space", values, steps, caveats, degenerate: "The four points are coplanar." };
      }
      steps.push("Volume = |(b−a) · ((c−a) × (d−a))| / 6, exactly.");
      const sph = sphereFrom4(P[0], P[1], P[2], P[3]);
      if (sph) {
        values.push(V3("sphere centre", NaN, fmtVec(sph.centre)));
        const r = fmtSqrtRat(sph.r2);
        values.push(V3("sphere radius", Math.sqrt(rnum(sph.r2)), r ?? undefined));
        steps.push(`The unique sphere through all four points is centred at ${fmtVec(sph.centre)}.`);
      }
      return { title: `Four points in space (tetrahedron)`, values, steps, caveats };
    }
  }
}
