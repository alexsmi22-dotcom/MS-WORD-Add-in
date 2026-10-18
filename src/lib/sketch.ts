/**
 * The 2D sketch and its constraint solver (docs/SCOPE-CAD-R2.md, R2a).
 *
 * A sketch is points, the lines / circles / arcs built on them, and the
 * relationships and driving dimensions between them. The only things that
 * move are point coordinates and circle radii (an arc's radius is its points').
 *
 * RESIDUALS are written once, over small forward-mode dual numbers, so the
 * analytic Jacobian comes from the same code as the value and can never drift
 * from it. They are differentiable by construction: coincident is two
 * equations (never dist = 0), parallel / perpendicular are cross / dot of unit
 * directions (never acos), an angle is atan2 − θ, tangency is a signed
 * distance whose side is fixed when the relation is made.
 *
 * THE SOLVER is Levenberg–Marquardt with minimum-norm steps (a drag or a new
 * value moves the least geometry), lengths normalised by the sketch's size,
 * iteration-capped. Every solve is VERIFIED (residuals recomputed unscaled,
 * no zero length, no zero radius) and checked for FLIPS (a loop turned inside
 * out, an arc swapped for its complement); either failure is refused by name
 * and the previous sketch kept.
 *
 * DEGREES OF FREEDOM are variables − rank(J) at the solution, by a column-
 * pivoted Householder QR of Jᵀ, whose trailing columns are the null space —
 * which names the entities still free.
 */

// ---- model ------------------------------------------------------------------------------

export interface SPoint {
  id: string;
  x: number;
  y: number;
}

export type SEntity =
  | { id: string; kind: "line"; a: string; b: string; construction?: boolean }
  | { id: string; kind: "circle"; c: string; r: number; construction?: boolean }
  /** Counter-clockwise from `a` to `b` about `c`; its radius is |a − c| = |b − c| (kept by the solver). */
  | { id: string; kind: "arc"; c: string; a: string; b: string; construction?: boolean };

export type SConstraint =
  | { id: string; kind: "coincident"; p: string; q: string }
  | { id: string; kind: "horizontal"; line: string }
  | { id: string; kind: "vertical"; line: string }
  | { id: string; kind: "parallel"; l1: string; l2: string }
  | { id: string; kind: "perpendicular"; l1: string; l2: string }
  /**
   * Line–curve: `side` is which side of the line the centre lies (+1 left of a→b).
   * Curve–curve: `inner` = internal tangency, `larger` = which curve (1 or 2) is the larger.
   * All three are fixed from the drawing when the relation is made (addConstraint).
   */
  | { id: string; kind: "tangent"; e1: string; e2: string; side?: 1 | -1; inner?: boolean; larger?: 1 | 2 }
  | { id: string; kind: "equal"; e1: string; e2: string }
  | { id: string; kind: "concentric"; e1: string; e2: string }
  | { id: string; kind: "onLine"; p: string; line: string }
  | { id: string; kind: "onCircle"; p: string; curve: string }
  | { id: string; kind: "midpoint"; p: string; line: string }
  | { id: string; kind: "symmetric"; p: string; q: string; line: string }
  | { id: string; kind: "fix"; p: string; x: number; y: number }
  // Driving dimensions (or driven, when `driven`: shown, never solved for).
  | { id: string; kind: "distance"; p: string; q: string; value: number; driven?: boolean }
  /** Signed: `side` keeps the point on the side of the line it was on. */
  | { id: string; kind: "pointLine"; p: string; line: string; value: number; side: 1 | -1; driven?: boolean }
  /** Horizontal / vertical distance from p to q, signed by `side` as created. */
  | { id: string; kind: "hdist"; p: string; q: string; value: number; side: 1 | -1; driven?: boolean }
  | { id: string; kind: "vdist"; p: string; q: string; value: number; side: 1 | -1; driven?: boolean }
  | { id: string; kind: "length"; line: string; value: number; driven?: boolean }
  /** Angle from l1 to l2 in radians, (0, π); `sign` keeps the turning direction as created. */
  | { id: string; kind: "angle"; l1: string; l2: string; value: number; sign: 1 | -1; driven?: boolean }
  | { id: string; kind: "radius"; curve: string; value: number; driven?: boolean }
  | { id: string; kind: "diameter"; curve: string; value: number; driven?: boolean };

export interface Sketch {
  points: SPoint[];
  entities: SEntity[];
  constraints: SConstraint[];
}

export type ConstraintKind = SConstraint["kind"];
export const DIMENSION_KINDS: ReadonlySet<ConstraintKind> = new Set(["distance", "pointLine", "hdist", "vdist", "length", "angle", "radius", "diameter"]);

/** Most points a sketch may have (a work bound: the solver and the DOF analysis must never freeze Word). */
export const MAX_POINTS = 150;

// ---- dual numbers (forward mode, local gradient) ------------------------------------------

class D {
  constructor(public v: number, public g: Float64Array) {}
}
const dc = (v: number, k: number): D => new D(v, new Float64Array(k));
const dadd = (a: D, b: D): D => {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = a.g[i] + b.g[i];
  return new D(a.v + b.v, g);
};
const dsub = (a: D, b: D): D => {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = a.g[i] - b.g[i];
  return new D(a.v - b.v, g);
};
const dmul = (a: D, b: D): D => {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = a.g[i] * b.v + a.v * b.g[i];
  return new D(a.v * b.v, g);
};
const dscale = (a: D, s: number): D => {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = a.g[i] * s;
  return new D(a.v * s, g);
};
const ddiv = (a: D, b: D): D => {
  const g = new Float64Array(a.g.length);
  const bb = b.v * b.v;
  for (let i = 0; i < g.length; i++) g[i] = (a.g[i] * b.v - a.v * b.g[i]) / bb;
  return new D(a.v / b.v, g);
};
const dsqrt = (a: D): D => {
  const r = Math.sqrt(a.v);
  const g = new Float64Array(a.g.length);
  const f = r > 0 ? 0.5 / r : 0;
  for (let i = 0; i < g.length; i++) g[i] = a.g[i] * f;
  return new D(r, g);
};
const datan2 = (y: D, x: D): D => {
  const den = x.v * x.v + y.v * y.v;
  const g = new Float64Array(y.g.length);
  for (let i = 0; i < g.length; i++) g[i] = den > 0 ? (x.v * y.g[i] - y.v * x.g[i]) / den : 0;
  return new D(Math.atan2(y.v, x.v), g);
};

/** Wraps an angle residual into (−π, π]; the gradient is unchanged. */
const wrap = (a: D): D => {
  let v = a.v;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v <= -Math.PI) v += 2 * Math.PI;
  return new D(v, a.g);
};

// ---- variables ----------------------------------------------------------------------------

/** Where each moving quantity lives in the variable vector. */
export interface VarMap {
  /** Point id → index of its x (y is index + 1). */
  point: Map<string, number>;
  /** Circle entity id → index of its radius. */
  radius: Map<string, number>;
  /** What each variable is, for naming free geometry. */
  owner: Array<{ kind: "x" | "y"; point: string } | { kind: "r"; circle: string }>;
  n: number;
}

export function varMap(sk: Sketch): VarMap {
  const point = new Map<string, number>();
  const radius = new Map<string, number>();
  const owner: VarMap["owner"] = [];
  for (const p of sk.points) {
    point.set(p.id, owner.length);
    owner.push({ kind: "x", point: p.id }, { kind: "y", point: p.id });
  }
  for (const e of sk.entities) {
    if (e.kind === "circle") {
      radius.set(e.id, owner.length);
      owner.push({ kind: "r", circle: e.id });
    }
  }
  return { point, radius, owner, n: owner.length };
}

export function toVector(sk: Sketch, vm: VarMap): Float64Array {
  const x = new Float64Array(vm.n);
  for (const p of sk.points) {
    const i = vm.point.get(p.id)!;
    x[i] = p.x;
    x[i + 1] = p.y;
  }
  for (const e of sk.entities) if (e.kind === "circle") x[vm.radius.get(e.id)!] = e.r;
  return x;
}

export function fromVector(sk: Sketch, vm: VarMap, x: Float64Array): Sketch {
  return {
    points: sk.points.map((p) => {
      const i = vm.point.get(p.id)!;
      return { ...p, x: x[i], y: x[i + 1] };
    }),
    entities: sk.entities.map((e) => (e.kind === "circle" ? { ...e, r: x[vm.radius.get(e.id)!] } : e)),
    constraints: sk.constraints,
  };
}

// ---- residuals ----------------------------------------------------------------------------

/** One residual row: its value and its gradient by variable index. */
export interface Row {
  value: number;
  idx: number[];
  grad: number[];
  /** Which constraint it comes from (the arc's own radius relation is `arc:<id>`). */
  source: string;
  /** Length rows are divided by the sketch scale; angle rows are not. */
  isLength: boolean;
}

interface Ctx {
  vm: VarMap;
  x: Float64Array;
  ents: Map<string, SEntity>;
}

/** A local evaluation: the variables a residual touches, seeded as duals. */
class Local {
  idx: number[] = [];
  private pos = new Map<number, number>();
  constructor(private ctx: Ctx, wanted: number[]) {
    for (const w of wanted) {
      if (!this.pos.has(w)) {
        this.pos.set(w, this.idx.length);
        this.idx.push(w);
      }
    }
  }
  v(i: number): D {
    const k = this.idx.length;
    const g = new Float64Array(k);
    g[this.pos.get(i)!] = 1;
    return new D(this.ctx.x[i], g);
  }
  c(v: number): D {
    return dc(v, this.idx.length);
  }
}

const pointVars = (ctx: Ctx, p: string): number[] => {
  const i = ctx.vm.point.get(p);
  if (i === undefined) throw new Error(`no point ${p}`);
  return [i, i + 1];
};

/** The variables of an entity's geometry, and accessors over a Local. */
function lineOf(ctx: Ctx, id: string): { vars: number[]; get: (L: Local) => { ax: D; ay: D; bx: D; by: D } } {
  const e = ctx.ents.get(id);
  if (!e || e.kind !== "line") throw new Error(`${id} is not a line`);
  const [a, b] = [pointVars(ctx, e.a), pointVars(ctx, e.b)];
  return { vars: [...a, ...b], get: (L) => ({ ax: L.v(a[0]), ay: L.v(a[1]), bx: L.v(b[0]), by: L.v(b[1]) }) };
}

function curveOf(ctx: Ctx, id: string): { vars: number[]; get: (L: Local) => { cx: D; cy: D; r: D } } {
  const e = ctx.ents.get(id);
  if (!e || (e.kind !== "circle" && e.kind !== "arc")) throw new Error(`${id} is not a circle or arc`);
  const c = pointVars(ctx, e.c);
  if (e.kind === "circle") {
    const ri = ctx.vm.radius.get(e.id)!;
    return { vars: [...c, ri], get: (L) => ({ cx: L.v(c[0]), cy: L.v(c[1]), r: L.v(ri) }) };
  }
  const a = pointVars(ctx, e.a);
  return {
    vars: [...c, ...a],
    get: (L) => {
      const cx = L.v(c[0]), cy = L.v(c[1]);
      const dx = dsub(L.v(a[0]), cx), dy = dsub(L.v(a[1]), cy);
      return { cx, cy, r: dsqrt(dadd(dmul(dx, dx), dmul(dy, dy))) };
    },
  };
}

const hypot2 = (dx: D, dy: D): D => dsqrt(dadd(dmul(dx, dx), dmul(dy, dy)));

/** Every residual row of the sketch's (non-driven) constraints, plus each arc's own radius relation. */
export function residuals(sk: Sketch, vm: VarMap, x: Float64Array): Row[] {
  const ctx: Ctx = { vm, x, ents: new Map(sk.entities.map((e) => [e.id, e])) };
  const rows: Row[] = [];
  const push = (L: Local, d: D, source: string, isLength: boolean): void => {
    rows.push({ value: d.v, idx: L.idx, grad: Array.from(d.g), source, isLength });
  };
  for (const e of sk.entities) {
    if (e.kind !== "arc") continue;
    const [c, a, b] = [pointVars(ctx, e.c), pointVars(ctx, e.a), pointVars(ctx, e.b)];
    const L = new Local(ctx, [...c, ...a, ...b]);
    const cx = L.v(c[0]), cy = L.v(c[1]);
    const ra = hypot2(dsub(L.v(a[0]), cx), dsub(L.v(a[1]), cy));
    const rb = hypot2(dsub(L.v(b[0]), cx), dsub(L.v(b[1]), cy));
    push(L, dsub(rb, ra), `arc:${e.id}`, true);
  }
  for (const c of sk.constraints) {
    if ("driven" in c && c.driven) continue;
    switch (c.kind) {
      case "coincident":
      case "fix": {
        const p = pointVars(ctx, c.p);
        if (c.kind === "coincident") {
          const q = pointVars(ctx, c.q);
          const L = new Local(ctx, [...p, ...q]);
          push(L, dsub(L.v(p[0]), L.v(q[0])), c.id, true);
          push(L, dsub(L.v(p[1]), L.v(q[1])), c.id, true);
        } else {
          const L = new Local(ctx, p);
          push(L, dsub(L.v(p[0]), L.c(c.x)), c.id, true);
          push(L, dsub(L.v(p[1]), L.c(c.y)), c.id, true);
        }
        break;
      }
      case "horizontal":
      case "vertical": {
        const l = lineOf(ctx, c.line);
        const L = new Local(ctx, l.vars);
        const { ax, ay, bx, by } = l.get(L);
        push(L, c.kind === "horizontal" ? dsub(by, ay) : dsub(bx, ax), c.id, true);
        break;
      }
      case "parallel":
      case "perpendicular":
      case "angle": {
        const l1 = lineOf(ctx, c.l1), l2 = lineOf(ctx, c.l2);
        const L = new Local(ctx, [...l1.vars, ...l2.vars]);
        const p = l1.get(L), q = l2.get(L);
        const ux = dsub(p.bx, p.ax), uy = dsub(p.by, p.ay), vx = dsub(q.bx, q.ax), vy = dsub(q.by, q.ay);
        const cross = dsub(dmul(ux, vy), dmul(uy, vx));
        const dot = dadd(dmul(ux, vx), dmul(uy, vy));
        const norm = dmul(hypot2(ux, uy), hypot2(vx, vy));
        if (c.kind === "parallel") push(L, ddiv(cross, norm), c.id, false);
        else if (c.kind === "perpendicular") push(L, ddiv(dot, norm), c.id, false);
        else push(L, wrap(dsub(datan2(cross, dot), L.c(c.sign * c.value))), c.id, false);
        break;
      }
      case "tangent": {
        const e1 = ctx.ents.get(c.e1), e2 = ctx.ents.get(c.e2);
        if (!e1 || !e2) throw new Error(`tangent ${c.id}: missing geometry`);
        if (e1.kind === "line" || e2.kind === "line") {
          const [lid, cid] = e1.kind === "line" ? [c.e1, c.e2] : [c.e2, c.e1];
          const l = lineOf(ctx, lid), k = curveOf(ctx, cid);
          const L = new Local(ctx, [...l.vars, ...k.vars]);
          const { ax, ay, bx, by } = l.get(L);
          const { cx, cy, r } = k.get(L);
          const dx = dsub(bx, ax), dy = dsub(by, ay);
          // Signed distance of the centre from the line (+ = left of a→b), minus side·r.
          const sd = ddiv(dsub(dmul(dx, dsub(cy, ay)), dmul(dy, dsub(cx, ax))), hypot2(dx, dy));
          push(L, dsub(sd, dscale(r, c.side ?? 1)), c.id, true);
        } else {
          const k1 = curveOf(ctx, c.e1), k2 = curveOf(ctx, c.e2);
          const L = new Local(ctx, [...k1.vars, ...k2.vars]);
          const a = k1.get(L), b = k2.get(L);
          const dist = hypot2(dsub(a.cx, b.cx), dsub(a.cy, b.cy));
          // Internal: |c1c2| = r_big − r_small with the larger curve fixed as made (smooth, and the
          // two can never swap roles: that would need a negative distance, so it is refused);
          // external: r1 + r2.
          const big = c.larger ?? (a.r.v >= b.r.v ? 1 : 2);
          const target = c.inner ? (big === 1 ? dsub(a.r, b.r) : dsub(b.r, a.r)) : dadd(a.r, b.r);
          push(L, dsub(dist, target), c.id, true);
        }
        break;
      }
      case "equal": {
        const e1 = ctx.ents.get(c.e1), e2 = ctx.ents.get(c.e2);
        if (!e1 || !e2) throw new Error(`equal ${c.id}: missing geometry`);
        if (e1.kind === "line" && e2.kind === "line") {
          const l1 = lineOf(ctx, c.e1), l2 = lineOf(ctx, c.e2);
          const L = new Local(ctx, [...l1.vars, ...l2.vars]);
          const p = l1.get(L), q = l2.get(L);
          push(L, dsub(hypot2(dsub(p.bx, p.ax), dsub(p.by, p.ay)), hypot2(dsub(q.bx, q.ax), dsub(q.by, q.ay))), c.id, true);
        } else {
          const k1 = curveOf(ctx, c.e1), k2 = curveOf(ctx, c.e2);
          const L = new Local(ctx, [...k1.vars, ...k2.vars]);
          push(L, dsub(k1.get(L).r, k2.get(L).r), c.id, true);
        }
        break;
      }
      case "concentric": {
        const k1 = curveOf(ctx, c.e1), k2 = curveOf(ctx, c.e2);
        const L = new Local(ctx, [...k1.vars, ...k2.vars]);
        const a = k1.get(L), b = k2.get(L);
        push(L, dsub(a.cx, b.cx), c.id, true);
        push(L, dsub(a.cy, b.cy), c.id, true);
        break;
      }
      case "onLine":
      case "midpoint":
      case "pointLine": {
        const p = pointVars(ctx, c.p), l = lineOf(ctx, c.line);
        const L = new Local(ctx, [...p, ...l.vars]);
        const { ax, ay, bx, by } = l.get(L);
        const px = L.v(p[0]), py = L.v(p[1]);
        if (c.kind === "midpoint") {
          push(L, dsub(px, dscale(dadd(ax, bx), 0.5)), c.id, true);
          push(L, dsub(py, dscale(dadd(ay, by), 0.5)), c.id, true);
        } else {
          const dx = dsub(bx, ax), dy = dsub(by, ay);
          const sd = ddiv(dsub(dmul(dx, dsub(py, ay)), dmul(dy, dsub(px, ax))), hypot2(dx, dy));
          push(L, c.kind === "onLine" ? sd : dsub(sd, L.c(c.side * c.value)), c.id, true);
        }
        break;
      }
      case "onCircle": {
        const p = pointVars(ctx, c.p), k = curveOf(ctx, c.curve);
        const L = new Local(ctx, [...p, ...k.vars]);
        const { cx, cy, r } = k.get(L);
        push(L, dsub(hypot2(dsub(L.v(p[0]), cx), dsub(L.v(p[1]), cy)), r), c.id, true);
        break;
      }
      case "symmetric": {
        const p = pointVars(ctx, c.p), q = pointVars(ctx, c.q), l = lineOf(ctx, c.line);
        const L = new Local(ctx, [...p, ...q, ...l.vars]);
        const { ax, ay, bx, by } = l.get(L);
        const dx = dsub(bx, ax), dy = dsub(by, ay), len = hypot2(dx, dy);
        const mx = dscale(dadd(L.v(p[0]), L.v(q[0])), 0.5), my = dscale(dadd(L.v(p[1]), L.v(q[1])), 0.5);
        // The midpoint of pq lies on the line, and pq is perpendicular to it.
        push(L, ddiv(dsub(dmul(dx, dsub(my, ay)), dmul(dy, dsub(mx, ax))), len), c.id, true);
        push(L, ddiv(dadd(dmul(dx, dsub(L.v(q[0]), L.v(p[0]))), dmul(dy, dsub(L.v(q[1]), L.v(p[1])))), len), c.id, true);
        break;
      }
      case "distance":
      case "hdist":
      case "vdist": {
        const p = pointVars(ctx, c.p), q = pointVars(ctx, c.q);
        const L = new Local(ctx, [...p, ...q]);
        const dx = dsub(L.v(q[0]), L.v(p[0])), dy = dsub(L.v(q[1]), L.v(p[1]));
        if (c.kind === "distance") push(L, dsub(hypot2(dx, dy), L.c(c.value)), c.id, true);
        else push(L, dsub(c.kind === "hdist" ? dx : dy, L.c(c.side * c.value)), c.id, true);
        break;
      }
      case "length": {
        const l = lineOf(ctx, c.line);
        const L = new Local(ctx, l.vars);
        const { ax, ay, bx, by } = l.get(L);
        push(L, dsub(hypot2(dsub(bx, ax), dsub(by, ay)), L.c(c.value)), c.id, true);
        break;
      }
      case "radius":
      case "diameter": {
        const k = curveOf(ctx, c.curve);
        const L = new Local(ctx, k.vars);
        const r = k.get(L).r;
        push(L, dsub(c.kind === "radius" ? r : dscale(r, 2), L.c(c.value)), c.id, true);
        break;
      }
    }
  }
  return rows;
}

// ---- measurements (a dimension's current value; a driven dimension's display) --------------

const P = (sk: Sketch, id: string): SPoint => {
  const p = sk.points.find((q) => q.id === id);
  if (!p) throw new Error(`no point ${id}`);
  return p;
};
const E = (sk: Sketch, id: string): SEntity => {
  const e = sk.entities.find((q) => q.id === id);
  if (!e) throw new Error(`no entity ${id}`);
  return e;
};

/** The radius of a circle or arc as the sketch stands. */
export function radiusOf(sk: Sketch, id: string): number {
  const e = E(sk, id);
  if (e.kind === "circle") return e.r;
  if (e.kind === "arc") {
    const c = P(sk, e.c), a = P(sk, e.a);
    return Math.hypot(a.x - c.x, a.y - c.y);
  }
  throw new Error(`${id} is not a circle or arc`);
}

/** What a dimension measures right now (radians for an angle), sign-free. */
export function measure(sk: Sketch, c: SConstraint): number {
  switch (c.kind) {
    case "distance": {
      const p = P(sk, c.p), q = P(sk, c.q);
      return Math.hypot(q.x - p.x, q.y - p.y);
    }
    case "hdist":
      return Math.abs(P(sk, c.q).x - P(sk, c.p).x);
    case "vdist":
      return Math.abs(P(sk, c.q).y - P(sk, c.p).y);
    case "length": {
      const l = E(sk, c.line);
      if (l.kind !== "line") throw new Error("not a line");
      const a = P(sk, l.a), b = P(sk, l.b);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case "pointLine": {
      const l = E(sk, c.line);
      if (l.kind !== "line") throw new Error("not a line");
      const a = P(sk, l.a), b = P(sk, l.b), p = P(sk, c.p);
      return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    }
    case "angle": {
      const l1 = E(sk, c.l1), l2 = E(sk, c.l2);
      if (l1.kind !== "line" || l2.kind !== "line") throw new Error("not lines");
      const a = P(sk, l1.a), b = P(sk, l1.b), p = P(sk, l2.a), q = P(sk, l2.b);
      const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - p.x, vy = q.y - p.y;
      return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    }
    case "radius":
      return radiusOf(sk, c.curve);
    case "diameter":
      return 2 * radiusOf(sk, c.curve);
    default:
      return NaN;
  }
}

// ---- small dense linear algebra ----------------------------------------------------------

/** Solves the symmetric positive-definite system A y = b by Cholesky; null if not positive definite. */
function cholSolve(A: Float64Array[], b: Float64Array): Float64Array | null {
  const n = b.length;
  const L = A.map((r) => Float64Array.from(r));
  for (let j = 0; j < n; j++) {
    let s = L[j][j];
    for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
    if (!(s > 0)) return null;
    const d = Math.sqrt(s);
    L[j][j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = L[i][j];
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      L[i][j] = t / d;
    }
  }
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < i; k++) y[i] -= L[i][k] * y[k];
    y[i] /= L[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k < n; k++) y[i] -= L[k][i] * y[k];
    y[i] /= L[i][i];
  }
  return y;
}

/** Dense J (rows × n) from sparse rows, length rows scaled by 1/scale. */
function dense(rows: Row[], n: number, scale: number): { J: Float64Array[]; r: Float64Array } {
  const J = rows.map(() => new Float64Array(n));
  const r = new Float64Array(rows.length);
  rows.forEach((row, i) => {
    const s = row.isLength ? 1 / scale : 1;
    r[i] = row.value * s;
    row.idx.forEach((k, j) => (J[i][k] += row.grad[j] * s));
  });
  return { J, r };
}

/**
 * Rank and null space of J (m × n) by Householder QR of Jᵀ with column pivoting:
 * Jᵀ·Π = Q·R; the first `rank` columns of Q span J's row space, the rest its null space.
 */
export function rankAndNullSpace(J: Float64Array[], n: number, relTol = 1e-9): { rank: number; nullSpace: Float64Array[] } {
  const m = J.length;
  // A = Jᵀ, n × m, column-major as an array of columns (each column = one row of J).
  const cols = J.map((row) => Float64Array.from(row));
  const Q: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const c = new Float64Array(n);
    c[i] = 1;
    return c;
  }); // Q as columns
  const norms = cols.map((c) => c.reduce((s, v) => s + v * v, 0));
  const maxNorm = Math.sqrt(Math.max(0, ...norms));
  let rank = 0;
  for (let k = 0; k < Math.min(m, n); k++) {
    // Pivot: the remaining column of largest norm (in rows k..n−1).
    let best = -1, bestN = -1;
    for (let j = k; j < m; j++) {
      let s = 0;
      for (let i = k; i < n; i++) s += cols[j][i] * cols[j][i];
      if (s > bestN) [best, bestN] = [j, s];
    }
    if (best < 0 || Math.sqrt(bestN) <= relTol * Math.max(1, maxNorm)) break;
    [cols[k], cols[best]] = [cols[best], cols[k]];
    // Householder reflector zeroing cols[k][k+1..].
    const x = cols[k];
    let norm = 0;
    for (let i = k; i < n; i++) norm += x[i] * x[i];
    norm = Math.sqrt(norm);
    const alpha = x[k] > 0 ? -norm : norm;
    const v = new Float64Array(n);
    v[k] = x[k] - alpha;
    for (let i = k + 1; i < n; i++) v[i] = x[i];
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i] * v[i];
    if (vv > 0) {
      for (let j = k; j < m; j++) {
        let d = 0;
        for (let i = k; i < n; i++) d += v[i] * cols[j][i];
        const f = (2 * d) / vv;
        for (let i = k; i < n; i++) cols[j][i] -= f * v[i];
      }
      // Q ← Q·H (H symmetric): apply to each row of Q, i.e. to the columns' entries.
      for (let r = 0; r < n; r++) {
        let d = 0;
        for (let i = k; i < n; i++) d += Q[i][r] * v[i];
        const f = (2 * d) / vv;
        for (let i = k; i < n; i++) Q[i][r] -= f * v[i];
      }
    }
    rank++;
  }
  // Q here holds Hᵀ… applied as rows; column j of the orthogonal factor is (Q[0][j], …, Q[n−1][j]) transposed.
  const nullSpace: Float64Array[] = [];
  for (let j = rank; j < n; j++) {
    const c = new Float64Array(n);
    for (let i = 0; i < n; i++) c[i] = Q[j][i];
    nullSpace.push(c);
  }
  return { rank, nullSpace };
}

// ---- the solver ---------------------------------------------------------------------------

export interface SolveOptions {
  /** Residual tolerance, relative to the sketch's size (and absolute for angles). */
  tol?: number;
  maxIterations?: number;
  /** Crossings already here are allowed; any other is refused (default: the flip reference). */
  crossingReference?: Sketch;
}

export type SolveResult =
  | { ok: true; sketch: Sketch; iterations: number; maxResidual: number }
  | { ok: false; reason: string; source?: string };

/** The sketch's size: its bounding-box diagonal (and radii), never below 1e-9. */
export function sketchScale(sk: Sketch): number {
  if (!sk.points.length) return 1;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of sk.points) {
    lo = [Math.min(lo[0], p.x), Math.min(lo[1], p.y)];
    hi = [Math.max(hi[0], p.x), Math.max(hi[1], p.y)];
  }
  let s = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
  for (const e of sk.entities) if (e.kind === "circle") s = Math.max(s, 2 * Math.abs(e.r));
  return Math.max(s, 1e-9);
}

/** Levenberg–Marquardt with minimum-norm steps: δ = −Jᵀ (J Jᵀ + λI)⁻¹ r. */
/**
 * The residual tolerance actually reachable: the asked-for one, but never below what
 * float coordinates far from the origin can resolve (a 0.1 rectangle at x = 1e5).
 */
function effectiveTol(sk: Sketch, tol: number): number {
  let far = 0;
  for (const p of sk.points) far = Math.max(far, Math.abs(p.x), Math.abs(p.y));
  return Math.max(tol, (1e-14 * far) / sketchScale(sk));
}

function lm(sk: Sketch, opts: SolveOptions): { x: Float64Array; vm: VarMap; it: number; worst: number; rows: Row[]; capped: boolean } {
  const vm = varMap(sk);
  const scale = sketchScale(sk);
  const tol = effectiveTol(sk, opts.tol ?? 1e-12);
  const maxIt = opts.maxIterations ?? 300;
  let x = toVector(sk, vm);
  const evalAt = (v: Float64Array) => {
    const rows = residuals(sk, vm, v);
    const d = dense(rows, vm.n, scale);
    let ss = 0, worst = 0;
    for (const t of d.r) {
      ss += t * t;
      worst = Math.max(worst, Math.abs(t));
    }
    return { rows, ...d, ss, worst };
  };
  let cur = evalAt(x);
  let lambda = 1e-6;
  let it = 0;
  for (; it < maxIt && cur.worst > tol; it++) {
    const m = cur.r.length;
    // A = J Jᵀ (m × m).
    const A: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
    for (let i = 0; i < m; i++)
      for (let j = i; j < m; j++) {
        let s = 0;
        const Ji = cur.J[i], Jj = cur.J[j];
        for (let k = 0; k < vm.n; k++) s += Ji[k] * Jj[k];
        A[i][j] = A[j][i] = s;
      }
    let improved = false;
    for (let tries = 0; tries < 12 && !improved; tries++) {
      const Ad = A.map((row, i) => {
        const c = Float64Array.from(row);
        c[i] += lambda * (1 + row[i]);
        return c;
      });
      const y = cholSolve(Ad, cur.r);
      if (y) {
        const step = new Float64Array(vm.n);
        for (let i = 0; i < m; i++) for (let k = 0; k < vm.n; k++) step[k] -= cur.J[i][k] * y[i];
        // Lengths were scaled by 1/scale in J; variables are in sketch units, so the step is too.
        const xn = new Float64Array(vm.n);
        for (let k = 0; k < vm.n; k++) xn[k] = x[k] + step[k];
        const next = evalAt(xn);
        if (next.ss < cur.ss) {
          x = xn;
          cur = next;
          lambda = Math.max(1e-12, lambda / 3);
          improved = true;
          break;
        }
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return { x, vm, it, worst: cur.worst, rows: cur.rows, capped: it >= maxIt && cur.worst > tol };
}

/**
 * The turning direction at every corner of the drawn (non-construction) geometry:
 * for each node, each pair of pieces leaving it (lines by their direction, arcs by
 * their tangent), the sign of the cross product. A MIRROR flips several of these at
 * once; a single corner turning concave is a real shape change. Covers loops with
 * arcs and nodes where three or more pieces meet (the loop-area test did not).
 */
function cornerTurns(sk: Sketch): Map<string, number> {
  const root = unionCoincident(sk);
  const leaving = new Map<string, Array<{ id: string; d: [number, number] }>>();
  const add = (node: string, id: string, d: [number, number]): void => {
    const n = root(node);
    (leaving.get(n) ?? leaving.set(n, []).get(n)!).push({ id, d });
  };
  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.kind === "line") {
      const a = P(sk, e.a), b = P(sk, e.b);
      add(e.a, e.id + ">", [b.x - a.x, b.y - a.y]);
      add(e.b, e.id + "<", [a.x - b.x, a.y - b.y]);
    } else if (e.kind === "arc") {
      const c = P(sk, e.c), a = P(sk, e.a), b = P(sk, e.b);
      // Leaving a counter-clockwise; leaving b clockwise (back along the arc).
      add(e.a, e.id + ">", [-(a.y - c.y), a.x - c.x]);
      add(e.b, e.id + "<", [b.y - c.y, -(b.x - c.x)]);
    }
  }
  const out = new Map<string, number>();
  for (const [node, list] of leaving) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((p, q) => (p.id < q.id ? -1 : 1));
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const [u, v] = [sorted[i].d, sorted[j].d];
        const cr = (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
        out.set(`${node}|${sorted[i].id}|${sorted[j].id}`, Math.abs(cr) < 1e-9 ? 0 : Math.sign(cr));
      }
  }
  return out;
}

/** Pairs of drawn lines that cross (not at a shared end), as "L1|L2". */
function lineCrossings(sk: Sketch): Set<string> {
  const root = unionCoincident(sk);
  const lines = sk.entities.filter((e): e is Extract<SEntity, { kind: "line" }> => e.kind === "line" && !e.construction);
  const o = (a: SPoint, b: SPoint, c: SPoint): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const out = new Set<string>();
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const L = lines[i], M = lines[j];
      const ends = [root(L.a), root(L.b)];
      if (ends.includes(root(M.a)) || ends.includes(root(M.b))) continue;
      const a = P(sk, L.a), b = P(sk, L.b), c = P(sk, M.a), d = P(sk, M.b);
      const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) out.add(`${L.id}|${M.id}`);
    }
  return out;
}

/** Each arc's counter-clockwise sweep from a to b, in (0, 2π]. */
function arcSweeps(sk: Sketch): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of sk.entities) {
    if (e.kind !== "arc") continue;
    const c = P(sk, e.c), a = P(sk, e.a), b = P(sk, e.b);
    let s = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
    while (s <= 0) s += 2 * Math.PI;
    while (s > 2 * Math.PI) s -= 2 * Math.PI;
    out.set(e.id, s);
  }
  return out;
}

/** Point ids joined by coincident relations share one representative. */
export function unionCoincident(sk: Sketch): (id: string) => string {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of sk.constraints) if (c.kind === "coincident") {
    const a = find(c.p), b = find(c.q);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

/** Plain words for a constraint, for refusals ("the 20 mm length of line L3"). */
export function describe(sk: Sketch, c: SConstraint | undefined): string {
  if (!c) return "a relation";
  const val = (v: number): string => `${+v.toFixed(4)}`;
  switch (c.kind) {
    case "distance": return `the ${val(c.value)} distance between ${c.p} and ${c.q}`;
    case "hdist": return `the ${val(c.value)} horizontal distance between ${c.p} and ${c.q}`;
    case "vdist": return `the ${val(c.value)} vertical distance between ${c.p} and ${c.q}`;
    case "length": return `the ${val(c.value)} length of ${c.line}`;
    case "pointLine": return `the ${val(c.value)} distance from ${c.p} to ${c.line}`;
    case "angle": return `the ${val((c.value * 180) / Math.PI)}° angle between ${c.l1} and ${c.l2}`;
    case "radius": return `the R${val(c.value)} radius of ${c.curve}`;
    case "diameter": return `the Ø${val(c.value)} diameter of ${c.curve}`;
    case "coincident": return `${c.p} on ${c.q}`;
    case "fix": return `${c.p} fixed`;
    case "horizontal": return `${c.line} horizontal`;
    case "vertical": return `${c.line} vertical`;
    case "parallel": return `${c.l1} parallel to ${c.l2}`;
    case "perpendicular": return `${c.l1} perpendicular to ${c.l2}`;
    case "tangent": return `${c.e1} tangent to ${c.e2}`;
    case "equal": return `${c.e1} equal to ${c.e2}`;
    case "concentric": return `${c.e1} concentric with ${c.e2}`;
    case "onLine": return `${c.p} on ${c.line}`;
    case "onCircle": return `${c.p} on ${c.curve}`;
    case "midpoint": return `${c.p} at the middle of ${c.line}`;
    case "symmetric": return `${c.p} and ${c.q} symmetric about ${c.line}`;
  }
}

/** Every reason the sketch's shape is not allowed (refused by name). */
export function sketchProblems(sk: Sketch): string[] {
  const out: string[] = [];
  if (sk.points.length > MAX_POINTS) out.push(`the sketch has more than ${MAX_POINTS} points — split it into several sketches`);
  const ids = new Set<string>();
  for (const x of [...sk.points, ...sk.entities, ...sk.constraints]) {
    if (ids.has(x.id)) out.push(`two items share the id ${x.id}`);
    ids.add(x.id);
  }
  const pts = new Set(sk.points.map((p) => p.id));
  for (const p of sk.points) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) out.push(`point ${p.id} has no position`);
  for (const e of sk.entities) {
    const refs = e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b];
    for (const r of refs) if (!pts.has(r)) out.push(`${e.id} uses a missing point ${r}`);
    if (e.kind === "circle" && !(e.r > 0)) out.push(`${e.id} needs a radius greater than 0`);
  }
  for (const c of sk.constraints) {
    if ("value" in c && (!Number.isFinite(c.value) || (c.kind !== "angle" && c.value < 0))) out.push(`${describe(sk, c)} is not a usable value`);
    if ((c.kind === "distance" || c.kind === "length" || c.kind === "radius" || c.kind === "diameter") && c.value === 0)
      out.push(`${describe(sk, c)} is zero — use a coincident relation instead`);
    if (c.kind === "angle" && !(c.value > 0 && c.value < Math.PI)) out.push(`an angle must be between 0° and 180° (exclusive)`);
  }
  return out;
}

/**
 * Solves the sketch: every relation and driving dimension held, VERIFIED and
 * FLIP-CHECKED against the starting sketch; refused by name otherwise.
 */
export function solve(sk: Sketch, opts: SolveOptions = {}, reference: Sketch = sk): SolveResult {
  const bad = sketchProblems(sk);
  if (bad.length) return { ok: false, reason: bad[0] };
  let res: ReturnType<typeof lm>;
  try {
    res = lm(sk, opts);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const scale = sketchScale(sk);
  const tol = effectiveTol(sk, opts.tol ?? 1e-12);
  const out = fromVector(sk, res.vm, res.x);
  // Verify: the ORIGINAL residuals, unscaled, recomputed at the answer.
  const rows = residuals(out, res.vm, res.x);
  let worst = 0, worstRow: Row | undefined;
  for (const r of rows) {
    const v = Math.abs(r.value) / (r.isLength ? scale : 1);
    if (v > worst) [worst, worstRow] = [v, r];
  }
  if (!(worst <= tol * 100)) {
    if (res.capped) return { ok: false, reason: "the sketch did not settle within the solver's limit — change the value in smaller steps" };
    const c = worstRow && sk.constraints.find((k) => k.id === worstRow!.source);
    return { ok: false, reason: `these relations cannot all hold — ${describe(sk, c)} could not be met`, source: worstRow?.source };
  }
  // No line of zero length, no zero radius.
  for (const e of out.entities) {
    if (e.kind === "line") {
      const a = P(out, e.a), b = P(out, e.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9 * scale) return { ok: false, reason: `${e.id} would shrink to nothing` };
    } else if (radiusOf(out, e.id) <= 1e-9 * scale) return { ok: false, reason: `${e.id} would shrink to a point` };
  }
  // Flips: corners keep their turning direction (two or more turning over = a mirror image).
  const t0 = cornerTurns(reference), t1 = cornerTurns(out);
  let flipped = 0;
  for (const [k, v] of t0) if (v !== 0 && t1.has(k) && t1.get(k) !== 0 && t1.get(k) !== v) flipped++;
  if (flipped >= 2) return { ok: false, reason: "that would turn an outline inside out — the shape cannot take those values" };
  // No new crossings: an outline that starts clean stays clean.
  const x0 = lineCrossings(opts.crossingReference ?? reference);
  for (const k of lineCrossings(out)) if (!x0.has(k)) return { ok: false, reason: `that would make ${k.replace("|", " cross ")} — the shape cannot take those values` };
  const a0 = arcSweeps(reference), a1 = arcSweeps(out);
  for (const [id, sw] of a0) {
    const nw = a1.get(id);
    if (nw !== undefined && Math.abs(nw - sw) > Math.PI) return { ok: false, reason: `that would flip ${id} to its other side — the shape cannot take those values` };
  }
  return { ok: true, sketch: out, iterations: res.it, maxResidual: worst };
}

// ---- degrees of freedom --------------------------------------------------------------------

export interface Freedom {
  /** Variables − rank: how many independent ways the sketch can still move. */
  dof: number;
  /** True when the only freedom left is moving (and, if not fixed by a relation, turning) the whole sketch: "fully defined apart from position". */
  rigidOnly: boolean;
  /** Entities (and loose points) that can still move without breaking a relation. */
  free: string[];
}

/** DOF of a (solved) sketch, by definition: variables − rank(J) at the solution. */
export function freedom(sk: Sketch): Freedom {
  const vm = varMap(sk);
  const x = toVector(sk, vm);
  const scale = sketchScale(sk);
  const rows = residuals(sk, vm, x);
  const { J } = dense(rows, vm.n, scale);
  const { rank, nullSpace } = rankAndNullSpace(J, vm.n);
  const dof = vm.n - rank;
  // Rigid motions: translate x, translate y, rotate about the origin (radii unchanged).
  const rigid: Float64Array[] = [0, 1, 2].map((k) => {
    const v = new Float64Array(vm.n);
    for (const p of sk.points) {
      const i = vm.point.get(p.id)!;
      if (k === 0) v[i] = 1;
      else if (k === 1) v[i + 1] = 1;
      else {
        v[i] = -p.y / scale;
        v[i + 1] = p.x / scale;
      }
    }
    return v;
  });
  // A rigid motion lies in the null space when J·v = 0.
  const inNull = (v: Float64Array): boolean => J.every((row) => Math.abs(row.reduce((s, a, k) => s + a * v[k], 0)) <= 1e-7 * Math.max(1, Math.hypot(...v)));
  // "Apart from position": every freedom left is a rigid motion — the free rigid motions
  // span as many dimensions as there are degrees of freedom (counted by RANK: for a single
  // point, turning about the origin is just a translation).
  // Unit length first: with a single point the sketch size is tiny and the turn would swamp the rank test.
  const rigidIn = rigid.filter(inNull).map((v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
  });
  const rigidRank = rigidIn.length ? rankAndNullSpace(rigidIn, vm.n).rank : 0;
  const rigidOnly = dof > 0 && dof === rigidRank;
  // Free variables: a component in the null space, beyond the rigid motions when those are the freedom.
  const freeVar = new Float64Array(vm.n);
  for (const v of nullSpace) for (let i = 0; i < vm.n; i++) freeVar[i] += v[i] * v[i];
  const freePts = new Set<string>(), freeRad = new Set<string>();
  vm.owner.forEach((o, i) => {
    if (freeVar[i] <= 1e-8) return;
    if (o.kind === "r") freeRad.add(o.circle);
    else freePts.add(o.point);
  });
  const free: string[] = [];
  if (!rigidOnly) {
    for (const e of sk.entities) {
      const pts = e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b];
      if (pts.some((p) => freePts.has(p)) || (e.kind === "circle" && freeRad.has(e.id))) free.push(e.id);
    }
    const used = new Set(sk.entities.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b])));
    for (const p of sk.points) if (!used.has(p.id) && freePts.has(p.id)) free.push(p.id);
  }
  return { dof, rigidOnly, free };
}

// ---- adding a relation, one at a time -----------------------------------------------------

export type AddResult =
  | { ok: true; sketch: Sketch; freedom: Freedom }
  | { ok: false; reason: string; kind: "redundant" | "conflict" | "invalid"; canDrive?: boolean };

/**
 * Adds ONE relation or dimension and solves. Refused by name when it is
 * REDUNDANT (the rank does not rise: the sketch already fixes it) or CONFLICTS
 * (the residual cannot reach zero); a dimension so refused may be added driven.
 */
/** A tangent relation with its side / inner / larger taken from the drawing as it stands. */
function asDrawn(sk: Sketch, c: SConstraint): SConstraint {
  if (c.kind !== "tangent") return c;
  const e1 = sk.entities.find((e) => e.id === c.e1), e2 = sk.entities.find((e) => e.id === c.e2);
  if (!e1 || !e2) return c;
  if (e1.kind === "line" || e2.kind === "line") {
    if (c.side) return c;
    const [l, k] = (e1.kind === "line" ? [e1, e2] : [e2, e1]) as [Extract<SEntity, { kind: "line" }>, Extract<SEntity, { kind: "circle" | "arc" }>];
    const a = P(sk, l.a), b = P(sk, l.b), o = P(sk, k.c);
    return { ...c, side: (b.x - a.x) * (o.y - a.y) - (b.y - a.y) * (o.x - a.x) >= 0 ? 1 : -1 };
  }
  const r1 = radiusOf(sk, c.e1), r2 = radiusOf(sk, c.e2);
  const o1 = P(sk, (e1 as { c: string }).c), o2 = P(sk, (e2 as { c: string }).c);
  const inner = c.inner ?? Math.hypot(o1.x - o2.x, o1.y - o2.y) < Math.max(r1, r2);
  return { ...c, inner, ...(inner ? { larger: c.larger ?? (r1 >= r2 ? 1 : 2) } : {}) };
}

/**
 * Does the relation still hold after the sketch moves a little along its other
 * relations? Two seeded perturbations: a relation that holds only by coincidence
 * at this geometry (a tangent point) fails one; an implied one holds in both.
 */
function impliedAfterWiggle(sk: Sketch, c: SConstraint): boolean {
  const scale = sketchScale(sk);
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let trial = 0; trial < 2; trial++) {
    const moved: Sketch = {
      ...sk,
      points: sk.points.map((p) => ({ ...p, x: p.x + 1e-3 * scale * rnd(), y: p.y + 1e-3 * scale * rnd() })),
      entities: sk.entities.map((e) => (e.kind === "circle" ? { ...e, r: e.r * (1 + 1e-3 * rnd()) } : e)),
    };
    const r = solve(moved, { maxIterations: 100 }, moved);
    if (!r.ok) continue; // could not wiggle: no evidence either way
    const vm = varMap({ ...r.sketch, constraints: [c] });
    const own = residuals({ ...r.sketch, constraints: [c] }, vm, toVector(r.sketch, vm));
    if (own.some((row) => Math.abs(row.value) / (row.isLength ? scale : 1) > 1e-7)) return false;
  }
  return true;
}

export function addConstraint(sk: Sketch, c0: SConstraint, opts: SolveOptions = {}): AddResult {
  const c = asDrawn(sk, c0);
  const isDim = DIMENSION_KINDS.has(c.kind);
  if ("driven" in c && c.driven) {
    const next = { ...sk, constraints: [...sk.constraints, c] };
    const bad = sketchProblems(next);
    if (bad.length) return { ok: false, reason: bad[0], kind: "invalid" };
    return { ok: true, sketch: next, freedom: freedom(next) };
  }
  const before = freedom(sk);
  const next: Sketch = { ...sk, constraints: [...sk.constraints, c] };
  const bad = sketchProblems(next);
  if (bad.length) return { ok: false, reason: bad[0], kind: "invalid" };
  // Redundancy is a property of the relation at the CURRENT geometry when it already holds.
  const vm = varMap(next);
  const x = toVector(next, vm);
  const own = residuals(next, vm, x).filter((r) => r.source === c.id);
  const scale = sketchScale(next);
  const holds = own.every((r) => Math.abs(r.value) / (r.isLength ? scale : 1) <= 1e-9);
  if (holds) {
    const f = freedom(next);
    // First order says nothing new; confirm by moving the sketch along its relations.
    if (f.dof === before.dof && impliedAfterWiggle(sk, c)) {
      return { ok: false, reason: `${describe(next, c)} is already fixed by the sketch's other relations`, kind: "redundant", canDrive: isDim };
    }
    return { ok: true, sketch: next, freedom: f };
  }
  const solved = solveToward(sk, next, c, opts);
  if (!solved.ok) {
    // Name the relation being added: it is the one that does not fit (unless the solver ran out of steps).
    const why = solved.reason.startsWith("these relations cannot all hold") ? `${describe(next, c)} conflicts with the sketch's other relations` : solved.reason;
    return { ok: false, reason: why, kind: "conflict", canDrive: isDim };
  }
  const f = freedom(solved.sketch);
  if (f.dof === before.dof) {
    // Held after solving but removed no freedom: it duplicates what is there (e.g. a second equal length).
    return { ok: false, reason: `${describe(next, c)} is already fixed by the sketch's other relations`, kind: "redundant", canDrive: isDim };
  }
  return { ok: true, sketch: solved.sketch, freedom: f };
}

/**
 * Solves `next` (= `prev` plus the relation `c`); a DIMENSION far from its
 * current measure is approached in steps, so the sketch stays on its branch.
 */
function solveToward(prev: Sketch, next: Sketch, c: SConstraint, opts: SolveOptions): SolveResult {
  if (!("value" in c) || c.kind === "angle") {
    if (c.kind === "angle") {
      const cur = measure(prev, { ...c, driven: true } as SConstraint);
      return stepped(prev, next, c, cur, c.value, opts);
    }
    return solve(next, opts);
  }
  const cur = measure(prev, { ...c, driven: true } as SConstraint);
  return stepped(prev, next, c, cur, c.value, opts);
}

function stepped(prev: Sketch, next: Sketch, c: SConstraint & { value: number }, from: number, to: number, opts: SolveOptions): SolveResult {
  const ratio = from > 0 ? Math.abs(to - from) / Math.max(from, to) : 1;
  const steps = !Number.isFinite(from) || ratio < 0.2 ? 1 : Math.min(16, Math.ceil(ratio / 0.2));
  let cur: Sketch = prev;
  let iterations = 0, maxResidual = 0;
  for (let k = 1; k <= steps; k++) {
    const v = from + ((to - from) * k) / steps;
    const trial: Sketch = { ...cur, constraints: [...prev.constraints, { ...c, value: k === steps ? to : v } as SConstraint] };
    const r = solve(trial, opts);
    if (!r.ok) return r;
    iterations += r.iterations;
    maxResidual = Math.max(maxResidual, r.maxResidual);
    cur = { ...r.sketch, constraints: next.constraints };
  }
  return { ok: true, sketch: cur, iterations, maxResidual };
}

/** Changes a dimension's value (driving) and re-solves in steps; refused by name, the old sketch kept. */
export function setDimension(sk: Sketch, id: string, value: number, opts: SolveOptions = {}): SolveResult {
  const c = sk.constraints.find((k) => k.id === id);
  if (!c || !("value" in c)) return { ok: false, reason: `no dimension ${id}` };
  const others = sk.constraints.filter((k) => k.id !== id);
  const next: Sketch = { ...sk, constraints: [...others, { ...c, value } as SConstraint] };
  if (c.driven) {
    const bad = sketchProblems(next);
    return bad.length ? { ok: false, reason: bad[0] } : { ok: true, sketch: next, iterations: 0, maxResidual: 0 };
  }
  const base: Sketch = { ...sk, constraints: others };
  const r = stepped(base, next, { ...c, value } as SConstraint & { value: number }, c.value, value, opts);
  if (!r.ok) return r;
  // Keep the constraint order the user made.
  return { ...r, sketch: { ...r.sketch, constraints: sk.constraints.map((k) => (k.id === id ? { ...c, value } as SConstraint : k)) } };
}

/** Moves a point toward (x, y) as far as the relations allow (a drag): the solver keeps every relation. */
export function dragPoint(sk: Sketch, id: string, x: number, y: number, opts: SolveOptions = {}): SolveResult {
  const pin: SConstraint = { id: "__drag__", kind: "fix", p: id, x, y };
  const pulled = solve({ ...sk, constraints: [...sk.constraints, pin] }, opts, sk);
  if (pulled.ok) return { ...pulled, sketch: { ...pulled.sketch, constraints: sk.constraints } };
  // It cannot reach the cursor exactly (a point on a circle dragged off it): put it there and
  // let the relations pull it back — the minimum-norm solve lands it as near as they allow.
  const moved: Sketch = { ...sk, points: sk.points.map((p) => (p.id === id ? { ...p, x, y } : p)) };
  const near = solve(moved, opts, sk);
  if (near.ok) return near;
  return { ok: false, reason: "that point cannot go there without breaking a relation" };
}
