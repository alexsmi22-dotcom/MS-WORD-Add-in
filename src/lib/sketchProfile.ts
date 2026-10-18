/**
 * A closed sketch → the profile an R1 body is made of (docs/SCOPE-CAD-R2.md, R2a).
 *
 * The non-construction lines, arcs and circles must form closed loops: every
 * end shared by exactly two pieces. An open end or a branch is refused by
 * name, with where it is. Loops may not cross. Nesting decides holes (one
 * outline, any number of holes; an outline inside a hole is a separate part).
 * Loops are oriented as cadModel requires — outer counter-clockwise, holes
 * clockwise — and each arc's direction of travel becomes LoopSeg.cw.
 *
 * A REVOLVE maps the sketch into the (r, z) plane of its axis line: z along
 * the axis, r the distance from it. The profile must lie on one side of the
 * axis (touching it is fine) and has no holes. The mapping can be a
 * reflection, which turns every arc's direction round; that is accounted for.
 */
import type { Loop, LoopSeg, Profile, Pt2 } from "./cadModel";
import { Sketch, SEntity, SPoint, sketchScale, unionCoincident } from "./sketch";

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; reason: string };

type Piece =
  | { kind: "line"; id: string; a: string; b: string }
  | { kind: "arc"; id: string; c: string; a: string; b: string };

/** A traversed piece: from node to node, the arc's direction as travelled. */
interface Step {
  piece: Piece;
  from: string; // point id at the start of travel
  to: string;
  reversed: boolean;
}

const fmt = (v: number): string => `${+v.toFixed(3)}`;

export function sketchLoops(sk: Sketch): { ok: true; loops: Array<{ steps: Step[] } | { circle: Extract<SEntity, { kind: "circle" }> }> } | { ok: false; reason: string } {
  const pts = new Map(sk.points.map((p) => [p.id, p]));
  const scale = sketchScale(sk);
  const byRelation = unionCoincident(sk);
  // Points at the same place are one node too (snapped without a relation).
  const reps: SPoint[] = [];
  const nodeOf = new Map<string, string>();
  for (const p of sk.points) {
    const r = byRelation(p.id);
    const rp = pts.get(r)!;
    const same = reps.find((q) => Math.hypot(q.x - rp.x, q.y - rp.y) <= 1e-9 * scale);
    nodeOf.set(p.id, same ? same.id : (reps.push(rp), rp.id));
  }
  const node = (id: string): string => nodeOf.get(id)!;
  const pieces: Piece[] = [];
  const circles: Array<Extract<SEntity, { kind: "circle" }>> = [];
  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.kind === "line") pieces.push({ kind: "line", id: e.id, a: e.a, b: e.b });
    else if (e.kind === "arc") pieces.push({ kind: "arc", id: e.id, c: e.c, a: e.a, b: e.b });
    else circles.push(e);
  }
  if (!pieces.length && !circles.length) return { ok: false, reason: "the sketch has no outline yet — draw a closed shape (construction lines do not count)" };
  const at = new Map<string, Piece[]>();
  for (const pc of pieces) {
    if (node(pc.a) === node(pc.b)) return { ok: false, reason: `${pc.id} starts and ends at the same point` };
    for (const n of [node(pc.a), node(pc.b)]) (at.get(n) ?? at.set(n, []).get(n)!).push(pc);
  }
  for (const [n, list] of at) {
    const p = pts.get(n)!;
    if (list.length === 1) return { ok: false, reason: `the outline is open at (${fmt(p.x)}, ${fmt(p.y)}) — close it, or make the loose line construction` };
    if (list.length > 2) return { ok: false, reason: `the outline branches at (${fmt(p.x)}, ${fmt(p.y)}) — ${list.length} lines meet there; a profile needs exactly two` };
  }
  const used = new Set<string>();
  const loops: Array<{ steps: Step[] } | { circle: Extract<SEntity, { kind: "circle" }> }> = [];
  for (const first of pieces) {
    if (used.has(first.id)) continue;
    const steps: Step[] = [];
    const start = node(first.a);
    let pc = first, here = start;
    for (let guard = 0; guard <= pieces.length; guard++) {
      const forward = node(pc.a) === here;
      steps.push({ piece: pc, from: forward ? pc.a : pc.b, to: forward ? pc.b : pc.a, reversed: !forward });
      used.add(pc.id);
      here = node(forward ? pc.b : pc.a);
      if (here === start) break;
      pc = at.get(here)!.find((q) => q.id !== pc.id)!;
    }
    loops.push({ steps });
  }
  for (const c of circles) loops.push({ circle: c });
  return { ok: true, loops };
}

/** A loop as cadModel's Loop, in the given point map (identity for an extrude, (r, z) for a revolve). */
function toLoop(
  sk: Sketch,
  lp: { steps: Step[] } | { circle: Extract<SEntity, { kind: "circle" }> },
  map: (p: { x: number; y: number }) => Pt2,
  mirrored: boolean,
): Loop {
  const P = (id: string): SPoint => sk.points.find((q) => q.id === id)!;
  if ("circle" in lp) {
    const c = map(P(lp.circle.c)), r = lp.circle.r;
    // Start on the circle in the mapped plane; two half arcs counter-clockwise.
    return { start: [c[0] + r, c[1]], segs: [{ kind: "arc", to: [c[0] - r, c[1]], center: c }, { kind: "arc", to: [c[0] + r, c[1]], center: c }] };
  }
  const start = map(P(lp.steps[0].from));
  const segs: LoopSeg[] = lp.steps.map((s, i) => {
    // End exactly where the next step starts (the shared node's coordinates).
    const to = i === lp.steps.length - 1 ? start : map(P(lp.steps[i + 1].from));
    if (s.piece.kind === "line") return { kind: "line", to };
    // The arc runs counter-clockwise a → b in the sketch; travelled backwards it is clockwise;
    // a mirrored map turns both round.
    const cw = s.reversed !== mirrored;
    return { kind: "arc", to, center: map(P(s.piece.c)), cw };
  });
  return { start, segs };
}

/** Points along a loop (arcs sampled), for orientation, nesting and crossing tests. */
function sample(loop: Loop): Pt2[] {
  const out: Pt2[] = [];
  let from = loop.start;
  for (const s of loop.segs) {
    out.push(from);
    if (s.kind === "arc") {
      const r = Math.hypot(from[0] - s.center[0], from[1] - s.center[1]);
      let a0 = Math.atan2(from[1] - s.center[1], from[0] - s.center[0]);
      let a1 = Math.atan2(s.to[1] - s.center[1], s.to[0] - s.center[0]);
      if (!s.cw) while (a1 <= a0) a1 += 2 * Math.PI;
      else while (a1 >= a0) a1 -= 2 * Math.PI;
      for (let k = 1; k < 24; k++) {
        const t = a0 + ((a1 - a0) * k) / 24;
        out.push([s.center[0] + r * Math.cos(t), s.center[1] + r * Math.sin(t)]);
      }
      a0 = a1;
    }
    from = s.to;
  }
  return out;
}

const area = (pts: Pt2[]): number => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;

function inside(pt: Pt2, poly: Pt2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Proper crossing; with `touching`, also an end on the other segment (two different loops may not even touch). */
function segsCross(p1: Pt2, p2: Pt2, q1: Pt2, q2: Pt2, touching = false): boolean {
  const o = (a: Pt2, b: Pt2, c: Pt2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(q1, q2, p1), d2 = o(q1, q2, p2), d3 = o(p1, p2, q1), d4 = o(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (!touching) return false;
  const span = Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), Math.hypot(q2[0] - q1[0], q2[1] - q1[1]));
  const eps = 1e-12 * span * span;
  const onSeg = (a: Pt2, b: Pt2, c: Pt2, d: number): boolean =>
    Math.abs(d) <= eps && Math.min(a[0], b[0]) - 1e-12 * span <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-12 * span && Math.min(a[1], b[1]) - 1e-12 * span <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-12 * span;
  return onSeg(q1, q2, p1, d1) || onSeg(q1, q2, p2, d2) || onSeg(p1, p2, q1, d3) || onSeg(p1, p2, q2, d4);
}

const reverse = (lp: Loop): Loop => {
  // Walk the same segments backwards: each segment's end becomes a start; arcs change direction.
  const nodes: Pt2[] = [lp.start, ...lp.segs.map((s) => s.to)]; // nodes[i] → nodes[i+1] is segs[i]
  const segs: LoopSeg[] = [];
  for (let i = lp.segs.length - 1; i >= 0; i--) {
    const s = lp.segs[i];
    const to = nodes[i];
    segs.push(s.kind === "line" ? { kind: "line", to } : { kind: "arc", to, center: s.center, cw: !s.cw });
  }
  return { start: lp.start, segs };
};

function assemble(loops: Loop[], allowHoles: boolean): ProfileResult {
  const samples = loops.map(sample);
  // No two loops (or a loop with itself) may cross.
  for (let i = 0; i < samples.length; i++)
    for (let j = i; j < samples.length; j++) {
      const A = samples[i], B = samples[j];
      for (let a = 0; a < A.length; a++)
        for (let b = 0; b < B.length; b++) {
          if (i === j && Math.abs(a - b) <= 1) continue;
          if (i === j && ((a === 0 && b === A.length - 1) || (b === 0 && a === A.length - 1))) continue;
          if (segsCross(A[a], A[(a + 1) % A.length], B[b], B[(b + 1) % B.length], i !== j)) {
            return { ok: false, reason: i === j ? "the outline crosses itself" : "two outlines cross or touch — a profile's holes must sit wholly inside it" };
          }
        }
    }
  const depth = samples.map((s, i) => samples.filter((t, j) => j !== i && inside(s[0], t)).length);
  const outers = depth.map((d, i) => (d === 0 ? i : -1)).filter((i) => i >= 0);
  if (outers.length !== 1) return { ok: false, reason: `the sketch has ${outers.length} separate outlines — draw one part per sketch` };
  if (depth.some((d) => d > 1)) return { ok: false, reason: "an outline sits inside a hole — that is a separate part; draw it in its own sketch" };
  const holes = depth.map((d, i) => (d === 1 ? i : -1)).filter((i) => i >= 0);
  if (holes.length && !allowHoles) return { ok: false, reason: "a revolved profile cannot have holes — revolve the outline alone" };
  const o = outers[0];
  const outer = area(samples[o]) > 0 ? loops[o] : reverse(loops[o]);
  const hs = holes.map((h) => (area(samples[h]) < 0 ? loops[h] : reverse(loops[h])));
  return { ok: true, profile: { outer, holes: hs } };
}

/** The sketch's closed outline (and holes) as an extrude profile, in sketch coordinates. */
export function sketchToProfile(sk: Sketch): ProfileResult {
  const r = sketchLoops(sk);
  if (!r.ok) return r;
  return assemble(r.loops.map((lp) => toLoop(sk, lp, (p) => [p.x, p.y], false)), true);
}

/** The sketch revolved about its line `axis`: the profile in (r, z), r ≥ 0 from the axis, z along it. */
export function sketchToRevolve(sk: Sketch, axis: string): ProfileResult {
  const ax = sk.entities.find((e) => e.id === axis);
  if (!ax || ax.kind !== "line") return { ok: false, reason: "choose a line of the sketch as the axis to revolve about" };
  const A = sk.points.find((p) => p.id === ax.a)!, B = sk.points.find((p) => p.id === ax.b)!;
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  if (!(L > 0)) return { ok: false, reason: "the axis line has no length" };
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
  // A construction axis is not part of the profile (construction never is); a solid edge ON the axis is
  // — revolving a rectangle about one of its own sides is how a cylinder is drawn.
  const body: Sketch = sk;
  const r = sketchLoops(body);
  if (!r.ok) return r;
  const scale = sketchScale(sk);
  const side = (p: { x: number; y: number }): number => ux * (p.y - A.y) - uy * (p.x - A.x); // + left of the axis
  const used = body.entities.filter((e) => !e.construction).flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "arc" ? [e.a, e.b] : [e.c]));
  const sides = used.map((id) => side(body.points.find((p) => p.id === id)!));
  // An arc bulges away from its ends: its middle counts too (a half disc has both ends on the axis).
  for (const e of body.entities) if (e.kind === "arc" && !e.construction) {
    const P = (id: string) => body.points.find((p) => p.id === id)!;
    const c = P(e.c), pa = P(e.a), pb = P(e.b);
    const r = Math.hypot(pa.x - c.x, pa.y - c.y);
    const t0 = Math.atan2(pa.y - c.y, pa.x - c.x);
    let t1 = Math.atan2(pb.y - c.y, pb.x - c.x);
    while (t1 <= t0) t1 += 2 * Math.PI;
    const tm = (t0 + t1) / 2;
    sides.push(side({ x: c.x + r * Math.cos(tm), y: c.y + r * Math.sin(tm) }));
  }
  // Circles reach r beyond their centre.
  for (const e of body.entities) if (e.kind === "circle" && !e.construction) {
    const c = body.points.find((p) => p.id === e.c)!;
    sides.push(side(c) + e.r, side(c) - e.r);
  }
  const tol = 1e-9 * scale;
  const pos = sides.some((s) => s > tol), neg = sides.some((s) => s < -tol);
  if (pos && neg) return { ok: false, reason: "the profile crosses the axis — it must lie on one side of it (touching is fine)" };
  if (!pos && !neg) return { ok: false, reason: "the profile lies on the axis — it has nothing to revolve" };
  const sg = pos ? 1 : -1;
  // (r, z): r = sg·(left distance), z = along the axis. det of [[−sg·uy, sg·ux], [ux, uy]] = −sg: mirrored when sg = +1.
  const map = (p: { x: number; y: number }): Pt2 => [Math.max(0, sg * side(p)), ux * (p.x - A.x) + uy * (p.y - A.y)];
  const mirrored = sg === 1;
  return assemble(r.loops.map((lp) => toLoop(body, lp, map, mirrored)), false);
}
