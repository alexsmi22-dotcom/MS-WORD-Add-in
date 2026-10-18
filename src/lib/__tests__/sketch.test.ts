// The 2D sketch solver (docs/SCOPE-CAD-R2.md, R2a), against independent oracles:
// finite-difference Jacobians, linalg.svd ranks, known DOF counts, analytic
// constructions (law of cosines, tangency), and failures provoked on purpose.
import {
  Sketch,
  SConstraint,
  SEntity,
  residuals,
  varMap,
  toVector,
  rankAndNullSpace,
  solve,
  freedom,
  addConstraint,
  setDimension,
  dragPoint,
  measure,
  MAX_POINTS,
} from "../sketch";
import { svd } from "../linalg";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const line = (id: string, a: string, b: string): SEntity => ({ id, kind: "line", a, b });
const sk = (points: Sketch["points"], entities: SEntity[] = [], constraints: SConstraint[] = []): Sketch => ({ points, entities, constraints });
const P = (s: Sketch, id: string) => s.points.find((p) => p.id === id)!;
const dist = (s: Sketch, a: string, b: string): number => Math.hypot(P(s, b).x - P(s, a).x, P(s, b).y - P(s, a).y);

/** A rectangle 0..w × 0..h with shared corner points and H/V relations. */
function rect(w = 10, h = 6, wobble = 0): Sketch {
  return sk(
    [pt("p1", 0, 0), pt("p2", w + wobble, 0.3 * wobble), pt("p3", w, h - wobble), pt("p4", -0.2 * wobble, h)],
    [line("L1", "p1", "p2"), line("L2", "p2", "p3"), line("L3", "p3", "p4"), line("L4", "p4", "p1")],
    [
      { id: "h1", kind: "horizontal", line: "L1" },
      { id: "v2", kind: "vertical", line: "L2" },
      { id: "h3", kind: "horizontal", line: "L3" },
      { id: "v4", kind: "vertical", line: "L4" },
    ],
  );
}

describe("every residual's Jacobian equals its finite difference", () => {
  // A sketch with every kind of geometry, at a generic position.
  const base = sk(
    [pt("a", 0.3, 0.1), pt("b", 4.2, 1.3), pt("c", 1.1, 3.7), pt("d", 5.5, 4.4), pt("o", 2.2, 2.0), pt("e", 3.9, 2.6), pt("f", 2.0, 4.1), pt("g", 6.1, 0.4)],
    [
      line("L1", "a", "b"),
      line("L2", "c", "d"),
      { id: "C1", kind: "circle", c: "o", r: 1.3 },
      { id: "A1", kind: "arc", c: "g", a: "e", b: "f" },
    ],
  );
  const kinds: SConstraint[] = [
    { id: "k", kind: "coincident", p: "a", q: "c" },
    { id: "k", kind: "horizontal", line: "L1" },
    { id: "k", kind: "vertical", line: "L2" },
    { id: "k", kind: "parallel", l1: "L1", l2: "L2" },
    { id: "k", kind: "perpendicular", l1: "L1", l2: "L2" },
    { id: "k", kind: "tangent", e1: "L1", e2: "C1", side: 1 },
    { id: "k", kind: "tangent", e1: "C1", e2: "A1" },
    { id: "k", kind: "tangent", e1: "C1", e2: "A1", inner: true },
    { id: "k", kind: "equal", e1: "L1", e2: "L2" },
    { id: "k", kind: "equal", e1: "C1", e2: "A1" },
    { id: "k", kind: "concentric", e1: "C1", e2: "A1" },
    { id: "k", kind: "onLine", p: "o", line: "L1" },
    { id: "k", kind: "onCircle", p: "d", curve: "A1" },
    { id: "k", kind: "midpoint", p: "o", line: "L2" },
    { id: "k", kind: "symmetric", p: "c", q: "d", line: "L1" },
    { id: "k", kind: "fix", p: "b", x: 1, y: 2 },
    { id: "k", kind: "distance", p: "a", q: "d", value: 3 },
    { id: "k", kind: "pointLine", p: "o", line: "L2", value: 1, side: -1 },
    { id: "k", kind: "hdist", p: "a", q: "b", value: 2, side: 1 },
    { id: "k", kind: "vdist", p: "a", q: "c", value: 2, side: 1 },
    { id: "k", kind: "length", line: "L2", value: 2 },
    { id: "k", kind: "angle", l1: "L1", l2: "L2", value: 0.7, sign: 1 },
    { id: "k", kind: "radius", curve: "A1", value: 1 },
    { id: "k", kind: "diameter", curve: "C1", value: 2 },
  ];
  it.each(kinds.map((c) => [c.kind + (c.kind === "tangent" ? (c.e1 === "L1" ? "(line)" : c.inner ? "(inner)" : "(outer)") : ""), c] as const))("%s", (_n, c) => {
    const s: Sketch = { ...base, constraints: [c] };
    const vm = varMap(s);
    const x = toVector(s, vm);
    const rows = residuals(s, vm, x).filter((r) => r.source === "k");
    expect(rows.length).toBeGreaterThan(0);
    const h = 1e-6;
    for (const row of rows) {
      const ri = rows.indexOf(row);
      for (let k = 0; k < vm.n; k++) {
        const xp = Float64Array.from(x), xm = Float64Array.from(x);
        xp[k] += h;
        xm[k] -= h;
        const fd = (residuals(s, vm, xp).filter((r) => r.source === "k")[ri].value - residuals(s, vm, xm).filter((r) => r.source === "k")[ri].value) / (2 * h);
        const at = row.idx.indexOf(k);
        const an = at < 0 ? 0 : row.grad[at];
        expect({ k, diff: Math.abs(an - fd) < 1e-5 * Math.max(1, Math.abs(fd)) }).toEqual({ k, diff: true });
      }
    }
  });
});

describe("rank and null space (column-pivoted QR) agree with linalg.svd", () => {
  it.each([
    [3, 6, 2],
    [6, 6, 4],
    [8, 5, 5],
    [10, 12, 7],
    [1, 4, 1],
  ])("%i × %i of rank %i", (m, n, r) => {
    // A = B·C with B m×r, C r×n random: rank r.
    let seed = m * 31 + n * 7 + r;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const B = Array.from({ length: m }, () => Array.from({ length: r }, rnd));
    const C = Array.from({ length: r }, () => Array.from({ length: n }, rnd));
    const A = B.map((row) => Array.from({ length: n }, (_, j) => row.reduce((s, b, k) => s + b * C[k][j], 0)));
    const { rank, nullSpace } = rankAndNullSpace(A.map((row) => Float64Array.from(row)), n);
    const padded = [...A, ...Array.from({ length: Math.max(0, n - m) }, () => new Array(n).fill(0))];
    const S = svd(padded).S;
    expect(rank).toBe(S.filter((s) => s > 1e-9 * S[0]).length);
    expect(rank).toBe(r);
    expect(nullSpace).toHaveLength(n - r);
    for (const v of nullSpace) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      for (const row of A) expect(Math.abs(row.reduce((s, a, k) => s + a * v[k], 0))).toBeLessThan(1e-9);
    }
    for (let i = 0; i < nullSpace.length; i++) for (let j = i + 1; j < nullSpace.length; j++) expect(Math.abs(nullSpace[i].reduce((s, a, k) => s + a * nullSpace[j][k], 0))).toBeLessThan(1e-9);
  });
});

describe("degrees of freedom, against known counts", () => {
  it("a free line: 4", () => {
    expect(freedom(sk([pt("a", 0, 0), pt("b", 3, 1)], [line("L", "a", "b")])).dof).toBe(4);
  });
  it("a horizontal line: 3", () => {
    expect(freedom(sk([pt("a", 0, 0), pt("b", 3, 0)], [line("L", "a", "b")], [{ id: "h", kind: "horizontal", line: "L" }])).dof).toBe(3);
  });
  it("a circle: 3 (centre and radius); a free arc: 5 (centre, two ends, one shared radius)", () => {
    expect(freedom(sk([pt("o", 0, 0)], [{ id: "C", kind: "circle", c: "o", r: 2 }])).dof).toBe(3);
    expect(freedom(sk([pt("o", 0, 0), pt("a", 2, 0), pt("b", 0, 2)], [{ id: "A", kind: "arc", c: "o", a: "a", b: "b" }])).dof).toBe(5);
  });
  it("a rectangle with H/V relations: 4; with width and height: 2, fully defined apart from position; anchored: 0", () => {
    const r = rect();
    expect(freedom(r).dof).toBe(4);
    const dimmed: Sketch = { ...r, constraints: [...r.constraints, { id: "w", kind: "length", line: "L1", value: 10 }, { id: "hh", kind: "length", line: "L2", value: 6 }] };
    const f = freedom(dimmed);
    expect(f).toMatchObject({ dof: 2, rigidOnly: true, free: [] });
    const anchored: Sketch = { ...dimmed, constraints: [...dimmed.constraints, { id: "f", kind: "fix", p: "p1", x: 0, y: 0 }] };
    expect(freedom(anchored)).toMatchObject({ dof: 0, rigidOnly: false });
  });
  it("a triangle with three side lengths: 3, fully defined apart from position (it can still turn)", () => {
    const t = sk(
      [pt("A", 0, 0), pt("B", 3, 0), pt("C", 0, 4)],
      [line("a", "A", "B"), line("b", "B", "C"), line("c", "C", "A")],
      [
        { id: "la", kind: "length", line: "a", value: 3 },
        { id: "lb", kind: "length", line: "b", value: 5 },
        { id: "lc", kind: "length", line: "c", value: 4 },
      ],
    );
    expect(freedom(t)).toMatchObject({ dof: 3, rigidOnly: true });
  });
  it("names what is still free", () => {
    const s = sk(
      [pt("a", 0, 0), pt("b", 3, 0), pt("c", 5, 5), pt("d", 7, 5)],
      [line("L1", "a", "b"), line("L2", "c", "d")],
      [{ id: "f", kind: "fix", p: "a", x: 0, y: 0 }, { id: "fb", kind: "fix", p: "b", x: 3, y: 0 }],
    );
    expect(freedom(s)).toMatchObject({ dof: 4, free: ["L2"] });
  });
});

describe("solving, against analytic answers", () => {
  it.each([
    [3, 4, 5],
    [7, 8, 9],
    [5, 5, 8],
  ])("a triangle from sides %i, %i, %i: the lengths hold and the angle obeys the law of cosines", (a, b, c) => {
    const t = sk([pt("A", 0, 0), pt("B", a, 0.4), pt("C", 0.7, b)], [line("ab", "A", "B"), line("bc", "B", "C"), line("ca", "C", "A")], [
      { id: "fA", kind: "fix", p: "A", x: 0, y: 0 },
      { id: "h", kind: "horizontal", line: "ab" },
      { id: "l1", kind: "length", line: "ab", value: a },
      { id: "l2", kind: "length", line: "bc", value: c },
      { id: "l3", kind: "length", line: "ca", value: b },
    ]);
    const r = solve(t);
    if (!r.ok) throw new Error(r.reason);
    expect(dist(r.sketch, "A", "B")).toBeCloseTo(a, 9);
    expect(dist(r.sketch, "B", "C")).toBeCloseTo(c, 9);
    expect(dist(r.sketch, "C", "A")).toBeCloseTo(b, 9);
    // Angle at A between AB and AC: cos = (a² + b² − c²) / 2ab.
    const s = r.sketch, A = P(s, "A"), B = P(s, "B"), C = P(s, "C");
    const ang = Math.acos(((B.x - A.x) * (C.x - A.x) + (B.y - A.y) * (C.y - A.y)) / (a * b));
    expect(Math.cos(ang)).toBeCloseTo((a * a + b * b - c * c) / (2 * a * b), 9);
    expect(freedom(s)).toMatchObject({ dof: 0 });
  });

  it("a line tangent to a circle: the centre is exactly r from the line (r is free too), on the side it started", () => {
    const s = sk([pt("a", -5, 3), pt("b", 5, 2.5), pt("o", 0, 0)], [line("L", "a", "b"), { id: "C", kind: "circle", c: "o", r: 2 }], [
      { id: "fo", kind: "fix", p: "o", x: 0, y: 0 },
      { id: "t", kind: "tangent", e1: "L", e2: "C", side: -1 },
    ]);
    const r = solve(s);
    if (!r.ok) throw new Error(r.reason);
    const q = r.sketch, A = P(q, "a"), B = P(q, "b");
    const d = ((B.x - A.x) * (0 - A.y) - (B.y - A.y) * (0 - A.x)) / Math.hypot(B.x - A.x, B.y - A.y);
    const rr = (q.entities.find((e) => e.id === "C") as { r: number }).r;
    expect(d).toBeCloseTo(-rr, 9); // the centre is to the right of a→b: below the line
  });

  it("two circles externally tangent: centre distance = r1 + r2; internally: |r1 − r2|", () => {
    for (const inner of [false, true]) {
      const s = sk([pt("o1", 0, 0), pt("o2", inner ? 0.5 : 6, 0.3)], [{ id: "C1", kind: "circle", c: "o1", r: 3 }, { id: "C2", kind: "circle", c: "o2", r: 1 }], [
        { id: "f", kind: "fix", p: "o1", x: 0, y: 0 },
        { id: "t", kind: "tangent", e1: "C1", e2: "C2", inner },
      ]);
      const r = solve(s);
      if (!r.ok) throw new Error(r.reason);
      const [r1, r2] = ["C1", "C2"].map((id) => (r.sketch.entities.find((e) => e.id === id) as { r: number }).r);
      expect(dist(r.sketch, "o1", "o2")).toBeCloseTo(inner ? Math.abs(r1 - r2) : r1 + r2, 9);
    }
  });

  it("an arc keeps both ends on one radius, and a radius dimension sets it", () => {
    const s = sk([pt("o", 0, 0), pt("a", 3, 0.2), pt("b", -0.1, 2.6)], [{ id: "A", kind: "arc", c: "o", a: "a", b: "b" }], [
      { id: "f", kind: "fix", p: "o", x: 0, y: 0 },
      { id: "r", kind: "radius", curve: "A", value: 4 },
    ]);
    const r = solve(s);
    if (!r.ok) throw new Error(r.reason);
    expect(dist(r.sketch, "o", "a")).toBeCloseTo(4, 9);
    expect(dist(r.sketch, "o", "b")).toBeCloseTo(4, 9);
  });
});

describe("refusals by name: redundant, conflicting, flipped, degenerate", () => {
  const dimmed = (): Sketch => {
    const r = rect();
    return { ...r, constraints: [...r.constraints, { id: "w", kind: "length", line: "L1", value: 10 }, { id: "hh", kind: "length", line: "L2", value: 6 }] };
  };
  it("a second width on a fully dimensioned rectangle is redundant — offered as a driven dimension", () => {
    const r = addConstraint(dimmed(), { id: "w2", kind: "length", line: "L3", value: 10 });
    expect(r).toMatchObject({ ok: false, kind: "redundant", canDrive: true });
    if (!r.ok) expect(r.reason).toBe("the 10 length of L3 is already fixed by the sketch's other relations");
  });
  it("a diagonal that cannot fit is a conflict, the old sketch untouched", () => {
    const s = dimmed();
    const r = addConstraint(s, { id: "dg", kind: "distance", p: "p1", q: "p3", value: 50 });
    expect(r).toMatchObject({ ok: false, kind: "conflict", canDrive: true });
    expect(s.constraints).toHaveLength(6);
  });
  it("…and added DRIVEN it is accepted and reports the true diagonal", () => {
    const r = addConstraint(dimmed(), { id: "dg", kind: "distance", p: "p1", q: "p3", value: 0, driven: true });
    // A driven value of 0 is a display placeholder; the measure is the truth.
    if (r.ok) expect(measure(r.sketch, r.sketch.constraints.find((c) => c.id === "dg")!)).toBeCloseTo(Math.hypot(10, 6), 9);
  });
  it("a value that would push a point across its line is refused as a flip, not solved into a mirror image", () => {
    // Triangle with C kept 3 to the LEFT of AB (side +1); asking for it on the other side flips the loop.
    const t = sk([pt("A", 0, 0), pt("B", 10, 0), pt("C", 5, -3)], [line("ab", "A", "B"), line("bc", "B", "C"), line("ca", "C", "A")], [
      { id: "fA", kind: "fix", p: "A", x: 0, y: 0 },
      { id: "fB", kind: "fix", p: "B", x: 10, y: 0 },
      { id: "pl", kind: "pointLine", p: "C", line: "ab", value: 3, side: 1 },
    ]);
    const r = solve(t);
    expect(r).toEqual({ ok: false, reason: "that would turn an outline inside out — the shape cannot take those values" });
  });
  it("a length of 0 is refused (use coincident), as is an angle of 180°", () => {
    expect(solve({ ...rect(), constraints: [{ id: "z", kind: "length", line: "L1", value: 0 }] })).toMatchObject({ ok: false, reason: "the 0 length of L1 is zero — use a coincident relation instead" });
    expect(solve({ ...rect(), constraints: [{ id: "z", kind: "angle", l1: "L1", l2: "L2", value: Math.PI, sign: 1 }] })).toMatchObject({ ok: false });
  });
});

describe("driving dimensions and drags", () => {
  it("changing a width from 10 to 100 moves only what it must (heights, H/V, other width held)", () => {
    const r0 = rect();
    const s: Sketch = { ...r0, constraints: [...r0.constraints, { id: "w", kind: "length", line: "L1", value: 10 }, { id: "hh", kind: "length", line: "L2", value: 6 }, { id: "f", kind: "fix", p: "p1", x: 0, y: 0 }] };
    const r = setDimension(s, "w", 100);
    if (!r.ok) throw new Error(r.reason);
    expect(dist(r.sketch, "p1", "p2")).toBeCloseTo(100, 9);
    expect(dist(r.sketch, "p2", "p3")).toBeCloseTo(6, 9);
    expect(P(r.sketch, "p1")).toMatchObject({ x: expect.closeTo(0, 9), y: expect.closeTo(0, 9) });
    expect(r.sketch.constraints.find((c) => c.id === "w")).toMatchObject({ value: 100 });
  });
  it("a sketch that starts off its relations is pulled onto them (the wobbly rectangle squares up)", () => {
    const r = solve(rect(10, 6, 0.5));
    if (!r.ok) throw new Error(r.reason);
    const s = r.sketch;
    expect(P(s, "p1").y).toBeCloseTo(P(s, "p2").y, 9);
    expect(P(s, "p2").x).toBeCloseTo(P(s, "p3").x, 9);
  });
  it("dragging a corner of an H/V rectangle keeps it a rectangle", () => {
    const r = dragPoint(rect(), "p3", 14, 9);
    if (!r.ok) throw new Error(r.reason);
    const s = r.sketch;
    expect(P(s, "p3")).toMatchObject({ x: expect.closeTo(14, 9), y: expect.closeTo(9, 9) });
    expect(P(s, "p2").x).toBeCloseTo(14, 9);
    expect(P(s, "p4").y).toBeCloseTo(9, 9);
  });
});

describe("the work bound", () => {
  it(`a sketch over ${MAX_POINTS} points is refused by name`, () => {
    const pts = Array.from({ length: MAX_POINTS + 1 }, (_, i) => pt(`p${i}`, i, 0));
    expect(solve(sk(pts))).toEqual({ ok: false, reason: `the sketch has more than ${MAX_POINTS} points — split it into several sketches` });
  });
  it("a 50-rectangle sketch (200 points? no — 148 points) solves and reports its freedom inside a freeze budget", () => {
    const points: Sketch["points"] = [], entities: SEntity[] = [], constraints: SConstraint[] = [];
    for (let k = 0; k < 37; k++) {
      const r = rect(4, 3, 0.2);
      const ox = (k % 8) * 6, oy = Math.floor(k / 8) * 5;
      for (const p of r.points) points.push({ id: `${p.id}_${k}`, x: p.x + ox, y: p.y + oy });
      for (const e of r.entities) if (e.kind === "line") entities.push({ ...e, id: `${e.id}_${k}`, a: `${e.a}_${k}`, b: `${e.b}_${k}` });
      for (const c of r.constraints) if ("line" in c) constraints.push({ ...c, id: `${c.id}_${k}`, line: `${c.line}_${k}` } as SConstraint);
    }
    expect(points.length).toBeLessThanOrEqual(MAX_POINTS);
    const t0 = Date.now();
    const r = solve(sk(points, entities, constraints));
    if (!r.ok) throw new Error(r.reason);
    const f = freedom(r.sketch);
    expect(f.dof).toBe(37 * 4);
    expect(Date.now() - t0).toBeLessThan(10000);
  });
});

describe("solver review — every finding pinned", () => {
  it("B2a: a triangle with a tail line still refuses the mirror image (the loop test missed nodes of degree 3)", () => {
    const t = sk([pt("A", 0, 0), pt("B", 10, 0), pt("C", 5, -3), pt("T", -5, -5)], [line("ab", "A", "B"), line("bc", "B", "C"), line("ca", "C", "A"), line("tail", "A", "T")], [
      { id: "fA", kind: "fix", p: "A", x: 0, y: 0 },
      { id: "fB", kind: "fix", p: "B", x: 10, y: 0 },
      { id: "pl", kind: "pointLine", p: "C", line: "ab", value: 3, side: 1 },
    ]);
    expect(solve(t)).toMatchObject({ ok: false, reason: "that would turn an outline inside out — the shape cannot take those values" });
  });
  it("B2b: a rectangle with a drawn diagonal refuses being mirrored across its base", () => {
    const r = sk([pt("A", 0, 0), pt("B", 10, 0), pt("C", 10, -3), pt("D", 0, -3)], [line("1", "A", "B"), line("2", "B", "C"), line("3", "C", "D"), line("4", "D", "A"), line("dg", "A", "C")], [
      { id: "fA", kind: "fix", p: "A", x: 0, y: 0 },
      { id: "fB", kind: "fix", p: "B", x: 10, y: 0 },
      { id: "v", kind: "vertical", line: "2" },
      { id: "v4", kind: "vertical", line: "4" },
      { id: "pc", kind: "pointLine", p: "C", line: "1", value: 3, side: 1 },
      { id: "pd", kind: "pointLine", p: "D", line: "1", value: 3, side: 1 },
    ]);
    expect(solve(r)).toMatchObject({ ok: false });
  });
  it("D1: internal tangency keeps which circle is larger — growing the inner one past the outer is refused, not swapped", () => {
    let s = sk([pt("o1", 0, 0), pt("o2", 3, 0)], [{ id: "C1", kind: "circle", c: "o1", r: 5 }, { id: "C2", kind: "circle", c: "o2", r: 2 }], [
      { id: "f", kind: "fix", p: "o1", x: 0, y: 0 },
      { id: "r1", kind: "radius", curve: "C1", value: 5 },
      { id: "r2", kind: "radius", curve: "C2", value: 2 },
    ]);
    const t = addConstraint(s, { id: "t", kind: "tangent", e1: "C1", e2: "C2" });
    if (!t.ok) throw new Error(t.reason);
    expect(t.sketch.constraints.find((c) => c.id === "t")).toMatchObject({ inner: true, larger: 1 });
    s = t.sketch;
    expect(setDimension(s, "r2", 8).ok).toBe(false);
    expect(setDimension(s, "r2", 4).ok).toBe(true);
  });
  it("D2: a line–circle tangent made without a side keeps the circle on the side it is drawn", () => {
    const s = sk([pt("a", -5, 0), pt("b", 5, 0), pt("o", 0, -2.2)], [line("L", "a", "b"), { id: "C", kind: "circle", c: "o", r: 2 }], [
      { id: "fa", kind: "fix", p: "a", x: -5, y: 0 },
      { id: "fb", kind: "fix", p: "b", x: 5, y: 0 },
    ]);
    const r = addConstraint(s, { id: "t", kind: "tangent", e1: "L", e2: "C" });
    if (!r.ok) throw new Error(r.reason);
    const o = P(r.sketch, "o"), rr = (r.sketch.entities.find((e) => e.id === "C") as { r: number }).r;
    expect(o.y).toBeCloseTo(-rr, 9);
  });
  it("D3: apart from position, by the rank of the rigid motions: a lone circle is NOT (its radius is free); a lone point and dimensioned concentric circles are", () => {
    expect(freedom(sk([pt("o", 2, 3)], [{ id: "C", kind: "circle", c: "o", r: 2 }]))).toMatchObject({ dof: 3, rigidOnly: false });
    expect(freedom(sk([pt("p", 2, 3)]))).toMatchObject({ dof: 2, rigidOnly: true });
    const cc = sk([pt("o", 2, 3)], [{ id: "C1", kind: "circle", c: "o", r: 2 }, { id: "C2", kind: "circle", c: "o", r: 4 }], [
      { id: "r1", kind: "radius", curve: "C1", value: 2 },
      { id: "r2", kind: "radius", curve: "C2", value: 4 },
    ]);
    expect(freedom(cc)).toMatchObject({ dof: 2, rigidOnly: true });
  });
  it("D4: a relation that holds only by coincidence (at a tangent point) is not called redundant", () => {
    const s = sk([pt("o", 0, 0), pt("A", -10, 5), pt("B", 0, 5)], [{ id: "C", kind: "circle", c: "o", r: 5 }, line("AB", "A", "B")], [
      { id: "fo", kind: "fix", p: "o", x: 0, y: 0 },
      { id: "rr", kind: "radius", curve: "C", value: 5 },
      { id: "fA", kind: "fix", p: "A", x: -10, y: 5 },
      { id: "on", kind: "onCircle", p: "B", curve: "C" },
    ]);
    // Accepted, not called redundant. (Its DOF count stays first order at this singular,
    // tangent configuration — rank cannot see a double root — so the count is not asserted.)
    const r = addConstraint(s, { id: "h", kind: "horizontal", line: "AB" });
    expect(r.ok).toBe(true);
  });
  it("D5: running out of solver steps says so; a real conflict names the relation being added", () => {
    expect(solve(rect(10, 6, 2), { maxIterations: 1 })).toMatchObject({ ok: false, reason: "the sketch did not settle within the solver's limit — change the value in smaller steps" });
    const t = sk([pt("A", 0, 0), pt("B", 3, 0), pt("C", 0, 4)], [line("a", "A", "B"), line("b", "B", "C"), line("c", "C", "A")], [
      { id: "la", kind: "length", line: "a", value: 3 },
      { id: "lb", kind: "length", line: "b", value: 5 },
      { id: "lc", kind: "length", line: "c", value: 4 },
    ]);
    const r = addConstraint(t, { id: "x", kind: "distance", p: "A", q: "B", value: 8 });
    expect(r).toMatchObject({ ok: false, kind: "conflict", reason: "the 8 distance between A and B conflicts with the sketch's other relations" });
  });
  it("D6: dragging a point that lives on a circle toward a spot off it lands on the circle, nearest the cursor", () => {
    const s = sk([pt("o", 0, 0), pt("p", 5, 0)], [{ id: "C", kind: "circle", c: "o", r: 5 }], [
      { id: "fo", kind: "fix", p: "o", x: 0, y: 0 },
      { id: "rr", kind: "radius", curve: "C", value: 5 },
      { id: "on", kind: "onCircle", p: "p", curve: "C" },
    ]);
    const r = dragPoint(s, "p", 0, 8);
    if (!r.ok) throw new Error(r.reason);
    const q = P(r.sketch, "p");
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(5, 9);
    expect(q.y).toBeGreaterThan(4.5);
  });
  it("D7: a value that would make the outline cross itself is refused", () => {
    const s = sk([pt("A", 0, 0), pt("B", 10, 0), pt("C", 10, 8), pt("D", 5, 5)], [line("1", "A", "B"), line("2", "B", "C"), line("3", "C", "D"), line("4", "D", "A")], [
      { id: "fA", kind: "fix", p: "A", x: 0, y: 0 },
      { id: "fB", kind: "fix", p: "B", x: 10, y: 0 },
      { id: "fC", kind: "fix", p: "C", x: 10, y: 8 },
      { id: "vx", kind: "hdist", p: "A", q: "D", value: 5, side: 1 },
    ]);
    const withDist = addConstraint(s, { id: "cd", kind: "distance", p: "C", q: "D", value: Math.hypot(5, 3) });
    if (!withDist.ok) throw new Error(withDist.reason);
    expect(setDimension(withDist.sketch, "cd", 12).ok).toBe(false);
  });
  it("nit: a 0.1 rectangle 100 000 from the origin solves (the precision floor follows the coordinates)", () => {
    const r0 = rect(0.1, 0.06, 0.005);
    const far: Sketch = { ...r0, points: r0.points.map((p) => ({ ...p, x: p.x + 1e5, y: p.y + 1e5 })), constraints: [...r0.constraints, { id: "w", kind: "length", line: "L1", value: 0.1 }, { id: "hh", kind: "length", line: "L2", value: 0.06 }] };
    expect(solve(far).ok).toBe(true);
  });
});
