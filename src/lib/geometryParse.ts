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
  Rat, ratAdd, ratMul, ratNeg, ratInt, ratFromNumber, ratIsZero, RAT_ZERO,
} from "./cas";
import {
  pt, Pt, GeoResult, GeoValue, distance, midpoint, lineThrough, lineIntersect,
  pointLineDistance, polygonArea, polygonCentroid, isConvex, convexHull,
  triangleCentres, circleFrom3Points, solveTriangle, classifyConic, shapeMetrics,
  fmtRat, fmtSqrtRat, distanceSquared, collinear, pointInPolygon,
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
  while ((m = re.exec(s))) out.push(pt(numOf(m[1]), numOf(m[2])));
  return out;
}

function numOf(t: string): number {
  if (t.includes("/")) {
    const [a, b] = t.split("/").map(Number);
    return a / b;
  }
  return Number(t);
}

/** Named values: "r=5 h=2 A=30" → { r: 5, h: 2, A: 30 }. Case-sensitive. */
function parseNamed(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /\b([A-Za-z]\w*)\s*=\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = numOf(m[2]);
  return out;
}

/** Bare numbers not part of a name=value pair or a coordinate. */
function bareNumbers(s: string): number[] {
  const stripped = s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Za-z]\w*\s*=\s*-?\d+(?:\.\d+)?(?:\/\d+)?/g, " ");
  return (stripped.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).map(numOf);
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
      return shapeMetrics({ shape: "regular-polygon", dims: { n: named.n, a: named.a } });
    }
    return null;
  }

  if (kw === "circle" && (named.r || bare.length === 1) && pts.length === 0) {
    return shapeMetrics({ shape: "circle", dims: { r: named.r ?? bare[0] } });
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
        V("radius", Math.sqrt(evalFrac(fmtRat(r2))), fmtSqrtRat(r2) ?? undefined),
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
    const res = shapeMetrics({ shape: kw, dims });
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
  for (let i = 0; i < pts.length; i++) perim += Math.sqrt(evalFrac(fmtRat(distanceSquared(pts[i], pts[(i + 1) % pts.length]))));
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
      if (circ) values.push(V("circumradius", Math.sqrt(evalFrac(fmtRat(circ.r2))), fmtSqrtRat(circ.r2) ?? undefined));
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
