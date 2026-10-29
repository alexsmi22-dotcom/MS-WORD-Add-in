// Scene modelling & pipeline: the curve engines. Bézier curves of any degree up to BEZIER_MAX_DEGREE (de Casteljau
// evaluation, the hodograph for tangent, normal and curvature, adaptive Gauss–Legendre arc length, subdivision,
// degree elevation and a tight bounding box from the derivative's roots) and B-spline / NURBS curves (Cox–de Boor
// knot validation, de Boor evaluation in homogeneous coordinates, the rational first derivative, Boehm knot
// insertion and the exact circular-arc test for a single rational quadratic span).
//
// spline.ts holds the INTERPOLATING cubic spline over exact rationals (in Solve) and refuses parametric curves; these
// are the parametric, control-point curves a modelling package draws. Pure functions over plain numbers (a point is
// an array of 2 or 3 coordinates); the pane glue is sceneCalcs.ts, the figures sceneCharts.ts.

export type Vec = number[];
export interface Fail {
  ok: false;
  error: string;
}

/** The highest Bézier degree accepted (21 control points): above it the Bernstein basis is a modelling smell. */
export const BEZIER_MAX_DEGREE = 20;
/** Arc length: adaptive Gauss–Legendre refined until a panel's two estimates agree to this fraction of the polygon length. */
export const ARC_REL_TOL = 1e-10;
/** NURBS caps: degree and control points. */
export const NURBS_MAX_DEGREE = 10;
export const NURBS_MAX_POINTS = 200;

// ---------------------------------------------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------------------------------------------

const sub = (a: Vec, b: Vec): Vec => a.map((v, i) => v - b[i]);
const scale = (a: Vec, s: number): Vec => a.map((v) => v * s);
export const dot = (a: Vec, b: Vec): number => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a: Vec): number => Math.sqrt(dot(a, a));
const lerp = (a: Vec, b: Vec, t: number): Vec => a.map((v, i) => (1 - t) * v + t * b[i]);
/** The cross product of two 3-vectors (2-vectors are padded with z = 0). */
export function cross3(a: Vec, b: Vec): Vec {
  const [a0, a1, a2 = 0] = a;
  const [b0, b1, b2 = 0] = b;
  return [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0];
}

/** Length of the control polygon. */
export function polygonLength(P: Vec[]): number {
  let s = 0;
  for (let i = 0; i + 1 < P.length; i++) s += norm(sub(P[i + 1], P[i]));
  return s;
}

/** The largest distance between two control points (a scale for the "is this zero" tests). */
function diameter(P: Vec[]): number {
  let d = 0;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) d = Math.max(d, norm(sub(P[i], P[j])));
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Bézier
// ---------------------------------------------------------------------------------------------------------------

/** Every level of de Casteljau's construction at t: level 0 is the control polygon, the last level the point. */
export function deCasteljau(P: Vec[], t: number): Vec[][] {
  const levels: Vec[][] = [P.map((p) => p.slice())];
  while (levels[levels.length - 1].length > 1) {
    const L = levels[levels.length - 1];
    const next: Vec[] = [];
    for (let i = 0; i + 1 < L.length; i++) next.push(lerp(L[i], L[i + 1], t));
    levels.push(next);
  }
  return levels;
}

/** The point C(t). */
export function bezierPoint(P: Vec[], t: number): Vec {
  const L = deCasteljau(P, t);
  return L[L.length - 1][0];
}

/** The hodograph: the control points of C′, degree n − 1 (n·ΔPᵢ). Empty for a single point. */
export function hodograph(P: Vec[]): Vec[] {
  const n = P.length - 1;
  const D: Vec[] = [];
  for (let i = 0; i < n; i++) D.push(scale(sub(P[i + 1], P[i]), n));
  return D;
}

/** The k-th derivative at t (the zero vector once k passes the degree). */
export function bezierDerivative(P: Vec[], t: number, k: number): Vec {
  let Q = P;
  for (let i = 0; i < k; i++) Q = hodograph(Q);
  return Q.length ? bezierPoint(Q, t) : P[0].map(() => 0);
}

/** Split at t: the two halves' control points (each the same degree; together they trace the same curve). */
export function bezierSplit(P: Vec[], t: number): { left: Vec[]; right: Vec[] } {
  const L = deCasteljau(P, t);
  return { left: L.map((l) => l[0]), right: L.map((l) => l[l.length - 1]).reverse() };
}

/** Degree elevation by one: Qᵢ = (i/(n+1))Pᵢ₋₁ + (1 − i/(n+1))Pᵢ. The curve is unchanged. */
export function bezierElevate(P: Vec[]): Vec[] {
  const n = P.length - 1;
  const Q: Vec[] = [P[0].slice()];
  for (let i = 1; i <= n; i++) {
    const a = i / (n + 1);
    Q.push(P[i].map((v, k) => a * P[i - 1][k] + (1 - a) * v));
  }
  Q.push(P[n].slice());
  return Q;
}

/** A scalar Bernstein polynomial's value at t (de Casteljau on the coefficients). */
function bernsteinValue(c: number[], t: number): number {
  const b = c.slice();
  for (let r = 1; r < b.length; r++) for (let i = 0; i + r < b.length; i++) b[i] = (1 - t) * b[i] + t * b[i + 1];
  return b[0];
}

/** Split a scalar Bernstein polynomial at 1/2. */
function bernsteinHalves(c: number[]): [number[], number[]] {
  const L = deCasteljau(c.map((v) => [v]), 0.5);
  return [L.map((l) => l[0][0]), L.map((l) => l[l.length - 1][0]).reverse()];
}

/**
 * The roots in the open interval (0, 1) of a scalar polynomial in Bernstein form, isolated by subdivision: the
 * coefficients bound the polynomial (convex hull), so no sign change among them means no root, exactly one means
 * exactly one root (Descartes' rule for the Bernstein basis), which bisection then finds. Bounded depth.
 */
export function bernsteinRoots(c: number[]): number[] {
  const big = Math.max(...c.map(Math.abs));
  if (!(big > 0)) return [];
  const eps = 1e-13 * big;
  const out: number[] = [];
  const walk = (cc: number[], lo: number, hi: number, depth: number): void => {
    const s = cc.filter((v) => Math.abs(v) > eps);
    if (s.length === 0) return;
    let changes = 0;
    for (let i = 0; i + 1 < s.length; i++) if (Math.sign(s[i]) !== Math.sign(s[i + 1])) changes++;
    if (changes === 0) return;
    if (hi - lo < 1e-14 || depth > 60) {
      out.push((lo + hi) / 2);
      return;
    }
    const f0 = cc[0];
    const f1 = cc[cc.length - 1];
    if (changes === 1 && Math.abs(f0) > eps && Math.abs(f1) > eps && Math.sign(f0) !== Math.sign(f1)) {
      let a = 0;
      let b = 1;
      let fa = f0;
      for (let it = 0; it < 80 && b - a > 1e-16; it++) {
        const m = (a + b) / 2;
        const fm = bernsteinValue(cc, m);
        if (fm === 0) {
          a = b = m;
          break;
        }
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m;
          fa = fm;
        } else b = m;
      }
      out.push(lo + ((a + b) / 2) * (hi - lo));
      return;
    }
    const [L, R] = bernsteinHalves(cc);
    const mid = (lo + hi) / 2;
    walk(L, lo, mid, depth + 1);
    walk(R, mid, hi, depth + 1);
  };
  walk(c, 0, 1, 0);
  const sorted = out.filter((t) => t > 1e-12 && t < 1 - 1e-12).sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > 1e-10);
}

/** Tight axis-aligned bounding box: the end points and the curve at every root of each coordinate's derivative. */
export function bezierBounds(P: Vec[]): { min: Vec; max: Vec; extremaT: number[][] } {
  const dim = P[0].length;
  const D = hodograph(P);
  const min = P[0].map((_, k) => Math.min(P[0][k], P[P.length - 1][k]));
  const max = P[0].map((_, k) => Math.max(P[0][k], P[P.length - 1][k]));
  const extremaT: number[][] = [];
  for (let k = 0; k < dim; k++) {
    const roots = D.length ? bernsteinRoots(D.map((d) => d[k])) : [];
    extremaT.push(roots);
    for (const t of roots) {
      const v = bezierPoint(P, t)[k];
      min[k] = Math.min(min[k], v);
      max[k] = Math.max(max[k], v);
    }
  }
  return { min, max, extremaT };
}

/** Five-point Gauss–Legendre nodes and weights on [−1, 1]. */
const GL5_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL5_W = [0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908];

function gl5(f: (t: number) => number, a: number, b: number): number {
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let s = 0;
  for (let i = 0; i < 5; i++) s += GL5_W[i] * f(m + h * GL5_X[i]);
  return s * h;
}

/**
 * ∫ f over [a, b] by adaptive 5-point Gauss–Legendre: a panel is accepted when the panel's estimate and the sum over
 * its two halves agree to `tol` (shared between halves on refinement). Panel count is bounded; `panels` reports it.
 */
export function adaptiveGL(f: (t: number) => number, a: number, b: number, tol: number): { value: number; panels: number; converged: boolean } {
  let panels = 0;
  let converged = true;
  const rec = (lo: number, hi: number, whole: number, tl: number, depth: number): number => {
    const mid = (lo + hi) / 2;
    const left = gl5(f, lo, mid);
    const right = gl5(f, mid, hi);
    panels += 2;
    if (Math.abs(left + right - whole) <= tl || depth >= 40 || panels > 200000) {
      if (Math.abs(left + right - whole) > tl) converged = false;
      return left + right;
    }
    return rec(lo, mid, left, tl / 2, depth + 1) + rec(mid, hi, right, tl / 2, depth + 1);
  };
  const value = rec(a, b, gl5(f, a, b), tol, 0);
  return { value, panels: panels + 1, converged };
}

export interface BezierResult {
  ok: true;
  degree: number;
  dim: number;
  t: number;
  point: Vec;
  d1: Vec;
  d2: Vec;
  /** Unit tangent (from C′, or from the first non-zero derivative where C′ vanishes); null when the curve is one point. */
  tangent: Vec | null;
  /** Where C′(t) = 0 and the tangent came from a higher derivative: its order. 1 when C′ is non-zero. */
  tangentOrder: number;
  /** Unit principal normal (toward the centre of curvature); null where undefined. */
  normal: Vec | null;
  /** Curvature: signed in 2-D (positive turning left), unsigned in 3-D; null where undefined (C′ = 0). */
  curvature: number | null;
  /** Why the curvature or normal is not given, when it is not. */
  curvatureNote: string | null;
  arcLength: number;
  arcPanels: number;
  arcConverged: boolean;
  polygonLength: number;
  chordLength: number;
  left: Vec[];
  right: Vec[];
  elevated: Vec[];
  bounds: { min: Vec; max: Vec; extremaT: number[][] };
  /** The de Casteljau construction at t. */
  levels: Vec[][];
  /** True when every control point coincides: the curve is a single point. */
  degenerate: boolean;
}

/** The whole Bézier analysis at t. */
export function bezierAnalyse(P: Vec[], t: number): BezierResult | Fail {
  if (P.length < 2) return { ok: false, error: "A Bézier curve needs at least two control points (degree 1, a straight segment)." };
  if (P.length - 1 > BEZIER_MAX_DEGREE)
    return { ok: false, error: `${P.length} control points is degree ${P.length - 1}; the cap is degree ${BEZIER_MAX_DEGREE} (${BEZIER_MAX_DEGREE + 1} points). Split the shape into several lower-degree curves (a modelling package joins cubics).` };
  const dim = P[0].length;
  if (dim !== 2 && dim !== 3) return { ok: false, error: "Each control point needs 2 coordinates (x, y) or 3 (x, y, z)." };
  if (P.some((p) => p.length !== dim)) return { ok: false, error: `Every control point needs the same number of coordinates; the first has ${dim}.` };
  if (P.some((p) => p.some((v) => !Number.isFinite(v)))) return { ok: false, error: "A control point has a coordinate that is not a finite number." };
  if (!(t >= 0 && t <= 1)) return { ok: false, error: `t = ${t} is outside [0, 1], the parameter range of a Bézier curve.` };
  const big = Math.max(...P.flat().map(Math.abs));
  if (big > 1e150) return { ok: false, error: "A coordinate is beyond 10¹⁵⁰: rescale the model (the curvature squares and cubes the coordinates)." };
  const diam = diameter(P);
  const degenerate = diam === 0;
  const levels = deCasteljau(P, t);
  const point = levels[levels.length - 1][0];
  const d1 = bezierDerivative(P, t, 1);
  const d2 = bezierDerivative(P, t, 2);
  const zeroTol = 1e-12 * Math.max(diam, 1e-300);
  let tangent: Vec | null = null;
  let tangentOrder = 1;
  let normal: Vec | null = null;
  let curvature: number | null = null;
  let curvatureNote: string | null = null;
  if (degenerate) {
    curvatureNote = "All control points coincide, so the curve is a single point: it has no tangent, normal or curvature.";
  } else {
    const n1 = norm(d1);
    if (n1 > zeroTol) {
      tangent = scale(d1, 1 / n1);
    } else {
      for (let k = 2; k <= P.length - 1; k++) {
        const dk = bezierDerivative(P, t, k);
        const nk = norm(dk);
        if (nk > zeroTol) {
          tangent = scale(dk, 1 / nk);
          tangentOrder = k;
          break;
        }
      }
      curvatureNote = `C′(t) = 0 at t = ${t} (coincident control points at an end, or a cusp), so the curvature |C′ × C″|/|C′|³ is not defined there; the tangent direction given is the limit, from the first non-zero derivative (order ${tangentOrder}).`;
    }
    if (n1 > zeroTol) {
      const c = cross3(d1, d2);
      if (dim === 2) {
        curvature = c[2] / (n1 * n1 * n1);
        const left = [-(tangent as Vec)[1], (tangent as Vec)[0]];
        if (Math.abs(curvature) * diam > 1e-12) normal = curvature >= 0 ? left : scale(left, -1);
        else {
          curvature = 0;
          normal = null;
          curvatureNote = "The curve is straight at this t (curvature 0): there is no centre of curvature, so no principal normal (the left normal is (−Tᵧ, Tₓ)).";
        }
      } else {
        curvature = norm(c) / (n1 * n1 * n1);
        const perp = sub(d2, scale(tangent as Vec, dot(d2, tangent as Vec)));
        const np = norm(perp);
        if (curvature * diam > 1e-12 && np > 0) normal = scale(perp, 1 / np);
        else {
          curvature = 0;
          normal = null;
          curvatureNote = "The curve is straight at this t (curvature 0): the principal normal is not defined.";
        }
      }
    }
  }
  const D = hodograph(P);
  const plen = polygonLength(P);
  const arc = degenerate ? { value: 0, panels: 0, converged: true } : adaptiveGL((u) => norm(bezierPoint(D, u)), 0, 1, ARC_REL_TOL * plen);
  const { left, right } = bezierSplit(P, t);
  return {
    ok: true,
    degree: P.length - 1,
    dim,
    t,
    point,
    d1,
    d2,
    tangent,
    tangentOrder,
    normal,
    curvature,
    curvatureNote,
    arcLength: arc.value,
    arcPanels: arc.panels,
    arcConverged: arc.converged,
    polygonLength: plen,
    chordLength: norm(sub(P[P.length - 1], P[0])),
    left,
    right,
    elevated: bezierElevate(P),
    bounds: bezierBounds(P),
    levels,
    degenerate,
  };
}

/** Points along the curve for drawing. */
export function bezierPolyline(P: Vec[], n = 200): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(bezierPoint(P, i / n));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// B-spline / NURBS
// ---------------------------------------------------------------------------------------------------------------

/** The clamped uniform knot vector for n control points of degree p: p+1 zeros, evenly spaced interior, p+1 ones. */
export function clampedUniformKnots(n: number, p: number): number[] {
  const U: number[] = [];
  const spans = n - p;
  for (let i = 0; i <= p; i++) U.push(0);
  for (let i = 1; i < spans; i++) U.push(i / spans);
  for (let i = 0; i <= p; i++) U.push(1);
  return U;
}

export interface KnotCheck {
  ok: true;
  /** Parameter domain [U[p], U[n]]. */
  lo: number;
  hi: number;
  clamped: boolean;
  /** Distinct interior knots in the domain with multiplicity and the continuity there (C^(p−m)). */
  interior: Array<{ u: number; mult: number; continuity: number }>;
  /** Interior knots of multiplicity exactly p: the curve is only C⁰ there (it passes through a control point). */
  c0: number[];
}

/** Validate a knot vector against n control points of degree p. */
export function checkKnots(U: number[], n: number, p: number): KnotCheck | Fail {
  const need = n + p + 1;
  if (U.length !== need)
    return { ok: false, error: `The knot vector has ${U.length} knots; ${n} control points of degree ${p} need n + p + 1 = ${need}. Leave it blank for the clamped uniform vector.` };
  if (U.some((u) => !Number.isFinite(u))) return { ok: false, error: "A knot is not a finite number." };
  for (let i = 0; i + 1 < U.length; i++)
    if (U[i + 1] < U[i]) return { ok: false, error: `The knot vector decreases at position ${i + 2} (${U[i]} then ${U[i + 1]}): knots must be non-decreasing.` };
  const lo = U[p];
  const hi = U[n];
  if (!(hi > lo)) return { ok: false, error: `The parameter domain [u(p), u(n)] = [${lo}, ${hi}] is empty: the knots from position ${p + 1} to ${n + 1} are all equal.` };
  // Multiplicities.
  const mult = (u: number): number => U.filter((v) => v === u).length;
  for (const u of new Set(U)) {
    const m = mult(u);
    if (m > p + 1) return { ok: false, error: `The knot ${u} appears ${m} times; no knot may appear more than p + 1 = ${p + 1} times.` };
  }
  const interior: KnotCheck["interior"] = [];
  const c0: number[] = [];
  for (const u of [...new Set(U)].filter((v) => v > lo && v < hi)) {
    const m = mult(u);
    if (m >= p + 1)
      return { ok: false, error: `The interior knot ${u} has multiplicity ${m} = p + 1: the curve breaks into two separate pieces there (a gap, not a joint). Use at most p = ${p} for a C⁰ corner.` };
    interior.push({ u, mult: m, continuity: p - m });
    if (m === p) c0.push(u);
  }
  const clamped = U.slice(0, p + 1).every((v) => v === U[0]) && U.slice(U.length - p - 1).every((v) => v === U[U.length - 1]);
  return { ok: true, lo, hi, clamped, interior, c0 };
}

/** The knot span index k with U[k] ≤ u < U[k+1] (the last non-empty span at u = hi). */
export function findSpan(U: number[], n: number, p: number, u: number): number {
  if (u >= U[n]) {
    let k = n - 1;
    while (k > p && U[k] === U[k + 1]) k--;
    return k;
  }
  let lo = p;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (u < U[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** de Boor's algorithm on homogeneous points (any dimension). */
function deBoor(U: number[], H: Vec[], p: number, u: number): Vec {
  const n = H.length;
  const k = findSpan(U, n, p, u);
  const d: Vec[] = [];
  for (let j = 0; j <= p; j++) d.push(H[j + k - p].slice());
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (u - U[i]) / den;
      d[j] = lerp(d[j - 1], d[j], a);
    }
  }
  return d[p];
}

const homog = (P: Vec[], w: number[]): Vec[] => P.map((p, i) => [...p.map((v) => v * w[i]), w[i]]);
const dehomog = (h: Vec): Vec => h.slice(0, -1).map((v) => v / h[h.length - 1]);

/** The curve point C(u) of a NURBS (weights all 1 is a plain B-spline). */
export function nurbsPoint(U: number[], P: Vec[], w: number[], p: number, u: number): Vec {
  return dehomog(deBoor(U, homog(P, w), p, u));
}

/** The derivative B-spline of homogeneous points: degree p − 1, knots U without its first and last entry. */
function derivativeCurve(U: number[], H: Vec[], p: number): { U: number[]; H: Vec[] } {
  const Q: Vec[] = [];
  for (let i = 0; i + 1 < H.length; i++) {
    const den = U[i + p + 1] - U[i + 1];
    Q.push(den === 0 ? H[i].map(() => 0) : scale(sub(H[i + 1], H[i]), p / den));
  }
  return { U: U.slice(1, -1), H: Q };
}

/** C′(u) of a NURBS: (A′ − w′C)/w in homogeneous terms. */
export function nurbsDerivative(U: number[], P: Vec[], w: number[], p: number, u: number): Vec {
  const H = homog(P, w);
  const h = deBoor(U, H, p, u);
  if (p === 0) return P[0].map(() => 0);
  const dc = derivativeCurve(U, H, p);
  const dh = deBoor(dc.U, dc.H, p - 1, u);
  const W = h[h.length - 1];
  const C = dehomog(h);
  const dW = dh[dh.length - 1];
  return C.map((c, i) => (dh[i] - dW * c) / W);
}

/** Boehm's knot insertion of u, r times: new knots, control points and weights; the curve is unchanged. */
export function insertKnot(U: number[], P: Vec[], w: number[], p: number, u: number, r: number): { U: number[]; P: Vec[]; w: number[] } {
  let curU = U.slice();
  let H = homog(P, w);
  for (let t = 0; t < r; t++) {
    const n = H.length;
    const k = findSpan(curU, n, p, u);
    const Q: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      if (i <= k - p) Q.push(H[i].slice());
      else if (i > k) Q.push(H[i - 1].slice());
      else {
        const den = curU[i + p] - curU[i];
        const a = den === 0 ? 0 : (u - curU[i]) / den;
        Q.push(lerp(H[i - 1], H[i], a));
      }
    }
    curU = [...curU.slice(0, k + 1), u, ...curU.slice(k + 1)];
    H = Q;
  }
  return { U: curU, P: H.map(dehomog), w: H.map((h) => h[h.length - 1]) };
}

export interface ArcCheck {
  centre: Vec;
  radius: number;
  sweepDeg: number;
  /** The weight that makes this control triangle an exact circular arc: cos(sweep/2). */
  circleWeight: number;
  /** Whether the given middle weight is that weight (and the legs are equal): an exact circle. */
  exact: boolean;
  /** Largest |distance from the centre − radius| over 2001 samples. */
  maxRadialError: number;
}

/**
 * For a single rational quadratic span (3 control points, Bézier knots): is it an exact circular arc? The control
 * triangle must be isosceles (|P₀P₁| = |P₁P₂|) and w₁/√(w₀w₂) = cos(θ/2), θ the arc's sweep (π − the angle at P₁).
 */
export function circularArcCheck(U: number[], P: Vec[], w: number[]): ArcCheck | null {
  if (P.length !== 3 || P[0].length !== 2) return null;
  const a = sub(P[0], P[1]);
  const b = sub(P[2], P[1]);
  const la = norm(a);
  const lb = norm(b);
  if (!(la > 0 && lb > 0)) return null;
  const cosPhi = Math.max(-1, Math.min(1, dot(a, b) / (la * lb)));
  const phi = Math.acos(cosPhi);
  if (!(phi > 1e-9 && phi < Math.PI - 1e-9)) return null;
  if (Math.abs(la - lb) > 1e-9 * Math.max(la, lb)) return null;
  const sweep = Math.PI - phi;
  const circleWeight = Math.cos(sweep / 2);
  // The circle touches both legs at P₀ and P₂: its centre is on the bisector of the angle φ at P₁, at distance
  // |P₀P₁|/cos(φ/2) from P₁, and its radius is |P₀P₁|·tan(φ/2).
  const ua = scale(a, 1 / la);
  const ub = scale(b, 1 / lb);
  const dir = [ua[0] + ub[0], ua[1] + ub[1]];
  const nd = norm(dir);
  const radius = la * Math.tan(phi / 2);
  const dist = la / Math.cos(phi / 2);
  const centre = [P[1][0] + (dir[0] / nd) * dist, P[1][1] + (dir[1] / nd) * dist];
  const effW = w[1] / Math.sqrt(w[0] * w[2]);
  let maxRadialError = 0;
  const lo = U[2];
  const hi = U[3];
  for (let i = 0; i <= 2000; i++) {
    const c = nurbsPoint(U, P, w, 2, lo + ((hi - lo) * i) / 2000);
    maxRadialError = Math.max(maxRadialError, Math.abs(norm(sub(c, centre)) - radius));
  }
  return { centre, radius, sweepDeg: (sweep * 180) / Math.PI, circleWeight, exact: Math.abs(effW - circleWeight) <= 1e-9, maxRadialError };
}

export interface NurbsResult {
  ok: true;
  degree: number;
  n: number;
  dim: number;
  knots: number[];
  knotsDefaulted: boolean;
  weights: number[];
  rational: boolean;
  check: KnotCheck;
  u: number;
  point: Vec;
  d1: Vec;
  tangent: Vec | null;
  /** Curve points at each distinct knot in the domain (the joints between polynomial pieces). */
  knotPoints: Array<{ u: number; point: Vec }>;
  inserted: { U: number[]; P: Vec[]; w: number[]; times: number; u: number } | null;
  /** Largest distance between the original curve and the curve after insertion, over 1001 samples. */
  insertionDeviation: number | null;
  arc: ArcCheck | null;
}

export function nurbsAnalyse(opts: { P: Vec[]; w: number[] | null; p: number; U: number[] | null; u: number; insert: number | null; times: number }): NurbsResult | Fail {
  const { P, p, u } = opts;
  const n = P.length;
  if (!Number.isInteger(p) || p < 1) return { ok: false, error: `Degree ${p}: give a whole number of at least 1 (1 is a polyline, 2 quadratic, 3 cubic).` };
  if (p > NURBS_MAX_DEGREE) return { ok: false, error: `Degree ${p} is above the cap of ${NURBS_MAX_DEGREE}; production curves are cubic or quintic.` };
  if (n < p + 1) return { ok: false, error: `Degree ${p} needs at least p + 1 = ${p + 1} control points; ${n} given.` };
  if (n > NURBS_MAX_POINTS) return { ok: false, error: `${n} control points is above the cap of ${NURBS_MAX_POINTS}.` };
  const dim = P[0].length;
  if (dim !== 2 && dim !== 3) return { ok: false, error: "Each control point needs 2 coordinates (x, y) or 3 (x, y, z)." };
  if (P.some((q) => q.length !== dim)) return { ok: false, error: `Every control point needs the same number of coordinates; the first has ${dim}.` };
  if (P.some((q) => q.some((v) => !Number.isFinite(v)))) return { ok: false, error: "A control point has a coordinate that is not a finite number." };
  const w = opts.w ?? P.map(() => 1);
  if (w.length !== n) return { ok: false, error: `${w.length} weights for ${n} control points: give one weight per point (or leave the weights blank for all 1).` };
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(w[i])) return { ok: false, error: `Weight ${i + 1} is not a finite number.` };
    if (w[i] === 0) return { ok: false, error: `Weight ${i + 1} is 0. A zero weight puts that control point at infinity, and the curve's denominator Σ Nᵢ(u)wᵢ can then vanish (the curve has no point there): give every weight > 0.` };
    if (w[i] < 0) return { ok: false, error: `Weight ${i + 1} is negative (${w[i]}). With a negative weight the denominator Σ Nᵢ(u)wᵢ can pass through zero, sending the curve to infinity, and the convex-hull property is lost: give every weight > 0.` };
  }
  const knotsDefaulted = opts.U === null;
  const U = opts.U ?? clampedUniformKnots(n, p);
  const check = checkKnots(U, n, p);
  if (!check.ok) return check;
  if (!(u >= check.lo && u <= check.hi)) return { ok: false, error: `u = ${u} is outside the curve's domain [${check.lo}, ${check.hi}] (from knot u(p) to u(n)).` };
  const point = nurbsPoint(U, P, w, p, u);
  const d1 = nurbsDerivative(U, P, w, p, u);
  const nd = norm(d1);
  const diam = diameter(P);
  const tangent = nd > 1e-12 * Math.max(diam, 1e-300) ? scale(d1, 1 / nd) : null;
  const knotPoints = [...new Set(U.filter((k) => k >= check.lo && k <= check.hi))].map((k) => ({ u: k, point: nurbsPoint(U, P, w, p, k) }));
  let inserted: NurbsResult["inserted"] = null;
  let insertionDeviation: number | null = null;
  if (opts.insert !== null) {
    const ui = opts.insert;
    if (!(ui > check.lo && ui < check.hi)) return { ok: false, error: `The knot to insert, ${ui}, must lie strictly inside the domain (${check.lo}, ${check.hi}).` };
    const have = U.filter((k) => k === ui).length;
    const r = opts.times;
    if (!Number.isInteger(r) || r < 1) return { ok: false, error: "Insert the knot a whole number of times (at least 1)." };
    if (have + r > p) return { ok: false, error: `${ui} already appears ${have} time${have === 1 ? "" : "s"}; inserting it ${r} more would make ${have + r}, above p = ${p} (the most an interior knot can have and keep the curve joined).` };
    const ins = insertKnot(U, P, w, p, ui, r);
    inserted = { ...ins, times: r, u: ui };
    let dev = 0;
    for (let i = 0; i <= 1000; i++) {
      const uu = check.lo + ((check.hi - check.lo) * i) / 1000;
      dev = Math.max(dev, norm(sub(nurbsPoint(U, P, w, p, uu), nurbsPoint(ins.U, ins.P, ins.w, p, uu))));
    }
    insertionDeviation = dev;
  }
  const rational = w.some((x) => x !== w[0]);
  const arc = p === 2 && check.clamped && U.length === 6 ? circularArcCheck(U, P, w) : null;
  return { ok: true, degree: p, n, dim, knots: U, knotsDefaulted, weights: w, rational, check, u, point, d1, tangent, knotPoints, inserted, insertionDeviation, arc };
}

/** Points along a NURBS curve for drawing. */
export function nurbsPolyline(U: number[], P: Vec[], w: number[], p: number, lo: number, hi: number, n = 300): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(nurbsPoint(U, P, w, p, lo + ((hi - lo) * i) / n));
  return out;
}
