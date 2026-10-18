// A closed sketch → an R1 profile (docs/SCOPE-CAD-R2.md, R2a), checked by what the
// resulting body IS: its cap area against geometry, its extent, and every refusal.
import { Sketch, SEntity } from "../sketch";
import { sketchToProfile, sketchToRevolve } from "../sketchProfile";
import { tessellate, flattenLoop, signedArea, Profile, Assembly } from "../cadModel";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const line = (id: string, a: string, b: string, construction = false): SEntity => ({ id, kind: "line", a, b, ...(construction ? { construction } : {}) });
const sk = (points: Sketch["points"], entities: SEntity[]): Sketch => ({ points, entities, constraints: [] });

/** Exact area of a profile as flattened (outer − holes), and the tessellated body. */
function body(profile: Profile, kind: "extrude" | "revolve") {
  const spec = kind === "extrude" ? { kind: "extrude" as const, profile, depth: 5 } : { kind: "revolve" as const, profile };
  const a: Assembly = { version: 1, bodies: [{ id: "b", name: "b", spec, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }] };
  const t = tessellate(a);
  if (!t.ok) throw new Error(t.reason);
  const P = t.mesh.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], P[i]);
    hi[i % 3] = Math.max(hi[i % 3], P[i]);
  }
  return { mesh: t.mesh, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
/** Exact area of a profile as flattened at `tol` (no radius-relative coarsening: these are exact checks). */
const areaOf = (profile: Profile, tol = 1e-4): number =>
  signedArea(flattenLoop(profile.outer, tol).points) + profile.holes.reduce((s, h) => s + signedArea(flattenLoop(h, tol).points), 0);

const rectPts = (w: number, h: number, flip = false) =>
  flip ? [pt("p1", 0, 0), pt("p4", 0, h), pt("p3", w, h), pt("p2", w, 0)] : [pt("p1", 0, 0), pt("p2", w, 0), pt("p3", w, h), pt("p4", 0, h)];
const rectLines = () => [line("L1", "p1", "p2"), line("L2", "p2", "p3"), line("L3", "p3", "p4"), line("L4", "p4", "p1")];

describe("extrude profiles", () => {
  it.each([false, true])("a rectangle (drawn %s clockwise): outer counter-clockwise, area w·h, a 40 × 25 body", (cw) => {
    const s = sk(rectPts(40, 25, cw), cw ? [line("L1", "p1", "p4"), line("L2", "p4", "p3"), line("L3", "p3", "p2"), line("L4", "p2", "p1")] : rectLines());
    const r = sketchToProfile(s);
    if (!r.ok) throw new Error(r.reason);
    expect(areaOf(r.profile)).toBeCloseTo(1000, 9);
    expect(body(r.profile, "extrude").size).toEqual([40, 25, 5]);
  });

  it("a rectangle with a circular hole: one hole, clockwise; the area is w·h − the hole as flattened", () => {
    const s: Sketch = sk([...rectPts(40, 25), pt("o", 20, 12.5)], [...rectLines(), { id: "C", kind: "circle", c: "o", r: 5 }]);
    const r = sketchToProfile(s);
    if (!r.ok) throw new Error(r.reason);
    expect(r.profile.holes).toHaveLength(1);
    expect(signedArea(flattenLoop(r.profile.holes[0], 1e-4).points)).toBeLessThan(0);
    const holeFlat = -signedArea(flattenLoop(r.profile.holes[0], 1e-4).points);
    expect(areaOf(r.profile)).toBeCloseTo(1000 - holeFlat, 9);
    expect(holeFlat).toBeCloseTo(Math.PI * 25, 1);
    body(r.profile, "extrude");
  });

  it.each([false, true])("a slot — two lines and two arcs (one arc travelled backwards: %s): area = rectangle + circle", (back) => {
    // Straight sides from (0,0)-(20,0) and (20,10)-(0,10); right arc about (20,5), left arc about (0,5).
    const pts = [pt("a", 0, 0), pt("b", 20, 0), pt("c", 20, 10), pt("d", 0, 10), pt("o1", 20, 5), pt("o2", 0, 5)];
    const ents: SEntity[] = [
      line("L1", "a", "b"),
      { id: "A1", kind: "arc", c: "o1", a: "b", b: "c" }, // counter-clockwise b → c: the right end
      line("L2", "c", "d"),
      // Left end counter-clockwise from d to a; defined from a to d it would be the other half.
      back ? { id: "A2", kind: "arc", c: "o2", a: "d", b: "a" } : { id: "A2", kind: "arc", c: "o2", a: "d", b: "a" },
    ];
    const r = sketchToProfile(sk(pts, ents));
    if (!r.ok) throw new Error(r.reason);
    expect(areaOf(r.profile, 1e-6)).toBeCloseTo(200 + Math.PI * 25, 2);
    expect(body(r.profile, "extrude").size.map((v) => +v.toFixed(6))).toEqual([30, 10, 5]);
  });

  it("an arc whose stored direction runs against the loop is mapped to clockwise travel (same body as drawn the other way)", () => {
    // A D shape: line from (0,-5) up to (0,5), then the arc back down the right: stored a=(0,-5) → b=(0,5) counter-clockwise
    // about (0,0) is the RIGHT half; the loop travels it from b to a.
    const s = sk([pt("a", 0, -5), pt("b", 0, 5), pt("o", 0, 0)], [line("L", "a", "b"), { id: "A", kind: "arc", c: "o", a: "a", b: "b" }]);
    const r = sketchToProfile(s);
    if (!r.ok) throw new Error(r.reason);
    expect(areaOf(r.profile, 1e-6)).toBeCloseTo((Math.PI * 25) / 2, 2); // flattening caps at 512 steps a turn
    // Width to within the arc's facets (no vertex need fall exactly at its widest point).
    const sz = body(r.profile, "extrude").size;
    expect(sz[0]).toBeCloseTo(5, 2);
    expect(sz.slice(1)).toEqual([10, 5]);
  });

  it("construction lines are not part of the profile", () => {
    const s = sk([...rectPts(10, 10), pt("m1", 5, 0), pt("m2", 5, 10)], [...rectLines(), line("CL", "m1", "m2", true)]);
    const r = sketchToProfile(s);
    expect(r.ok).toBe(true);
  });
});

describe("refusals by name", () => {
  it("an open outline says where", () => {
    const s = sk(rectPts(10, 6), rectLines().slice(0, 3));
    expect(sketchToProfile(s)).toEqual({ ok: false, reason: "the outline is open at (0, 0) — close it, or make the loose line construction" });
  });
  it("a branch says where and how many", () => {
    const s = sk([...rectPts(10, 6), pt("x", 15, 0)], [...rectLines(), line("Lx", "p2", "x")]);
    const r = sketchToProfile(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^the outline (is open at \(15, 0\)|branches at \(10, 0\))/);
  });
  it("two separate outlines; an island inside a hole; crossing outlines; an empty sketch", () => {
    const two = sk([...rectPts(10, 6), pt("o", 30, 0)], [...rectLines(), { id: "C", kind: "circle", c: "o", r: 2 }]);
    expect(sketchToProfile(two)).toEqual({ ok: false, reason: "the sketch has 2 separate outlines — draw one part per sketch" });
    const island = sk([...rectPts(40, 40), pt("o", 20, 20)], [...rectLines(), { id: "C1", kind: "circle", c: "o", r: 10 }, { id: "C2", kind: "circle", c: "o", r: 4 }]);
    expect(sketchToProfile(island)).toEqual({ ok: false, reason: "an outline sits inside a hole — that is a separate part; draw it in its own sketch" });
    const cross = sk([...rectPts(10, 10), pt("o", 10, 5)], [...rectLines(), { id: "C", kind: "circle", c: "o", r: 3 }]);
    expect(sketchToProfile(cross)).toEqual({ ok: false, reason: "two outlines cross or touch — a profile's holes must sit wholly inside it" });
    expect(sketchToProfile(sk([pt("a", 0, 0), pt("b", 1, 0)], [line("L", "a", "b", true)]))).toEqual({ ok: false, reason: "the sketch has no outline yet — draw a closed shape (construction lines do not count)" });
  });
  it("a bow-tie crosses itself", () => {
    const s = sk([pt("a", 0, 0), pt("b", 10, 10), pt("c", 10, 0), pt("d", 0, 10)], [line("1", "a", "b"), line("2", "b", "c"), line("3", "c", "d"), line("4", "d", "a")]);
    expect(sketchToProfile(s)).toEqual({ ok: false, reason: "the outline crosses itself" });
  });
});

describe("revolve profiles", () => {
  // An L-shaped half section beside a vertical axis x = 0: r 10 for z 0..20, r 5 for z 20..50.
  const half = (sideSign: 1 | -1): Sketch =>
    sk(
      [pt("ax1", 0, -5), pt("ax2", 0, 60), pt("a", 0, 0), pt("b", 10 * sideSign, 0), pt("c", 10 * sideSign, 20), pt("d", 5 * sideSign, 20), pt("e", 5 * sideSign, 50), pt("f", 0, 50)],
      [line("axis", "ax1", "ax2", true), line("1", "a", "b"), line("2", "b", "c"), line("3", "c", "d"), line("4", "d", "e"), line("5", "e", "f"), line("6", "f", "a")],
    );
  it.each([1, -1] as const)("a stepped shaft from a half section (on the %p side of the axis): Ø20 × 50 overall", (sg) => {
    const r = sketchToRevolve(half(sg), "axis");
    if (!r.ok) throw new Error(r.reason);
    const b = body(r.profile, "revolve");
    expect(b.size[0]).toBeCloseTo(20, 6);
    expect(b.size[2]).toBeCloseTo(50, 6);
    expect(areaOf(r.profile)).toBeCloseTo(10 * 20 + 5 * 30, 9); // counter-clockwise in (r, z)
  });
  it("a half disc on the axis, with an arc: a sphere (the mirrored mapping turns the arc round correctly)", () => {
    const s = sk([pt("ax1", 0, -20), pt("ax2", 0, 20), pt("s", 0, -10), pt("n", 0, 10), pt("o", 0, 0)], [
      line("axis", "ax1", "ax2", true),
      line("diam", "s", "n"),
      { id: "A", kind: "arc", c: "o", a: "n", b: "s" }, // counter-clockwise n → s: the LEFT half (x < 0)
    ]);
    const r = sketchToRevolve(s, "axis");
    if (!r.ok) throw new Error(r.reason);
    const b = body(r.profile, "revolve");
    b.size.forEach((v) => expect(v).toBeCloseTo(20, 1));
    expect(areaOf(r.profile, 1e-6)).toBeCloseTo((Math.PI * 100) / 2, 2);
  });
  it("a rectangle revolved about one of its own sides (a solid edge, not construction): a Ø20 × 30 cylinder", () => {
    const r = sketchToRevolve(sk(rectPts(10, 30), rectLines()), "L4");
    if (!r.ok) throw new Error(r.reason);
    const b = body(r.profile, "revolve");
    expect(b.size[0]).toBeCloseTo(20, 6);
    expect(b.size[2]).toBeCloseTo(30, 6);
  });
  it("crossing the axis, lying on it, holes, and a missing axis are refused by name", () => {
    const crossing = sk([pt("ax1", 0, -5), pt("ax2", 0, 60), ...rectPts(10, 10).map((p) => ({ ...p, x: p.x - 5 }))], [line("axis", "ax1", "ax2", true), ...rectLines()]);
    expect(sketchToRevolve(crossing, "axis")).toEqual({ ok: false, reason: "the profile crosses the axis — it must lie on one side of it (touching is fine)" });
    const holed = sk([pt("ax1", 0, -5), pt("ax2", 0, 60), ...rectPts(10, 10).map((p) => ({ ...p, x: p.x + 2 })), pt("o", 7, 5)], [
      line("axis", "ax1", "ax2", true),
      ...rectLines(),
      { id: "C", kind: "circle", c: "o", r: 1 },
    ]);
    expect(sketchToRevolve(holed, "axis")).toEqual({ ok: false, reason: "a revolved profile cannot have holes — revolve the outline alone" });
    expect(sketchToRevolve(half(1), "nope")).toEqual({ ok: false, reason: "choose a line of the sketch as the axis to revolve about" });
  });
});

describe("revolve review findings", () => {
  it("B1: a shallow arc whose centre lies across the axis keeps its true radius (area 76.25, not 55.5)", () => {
    const s = sk([pt("ax1", 0, -50), pt("ax2", 0, 50), pt("a", 2, 0), pt("b", 10, 0), pt("c", 10, 10), pt("d", 2, 10), pt("o", -20, 5)], [
      line("axis", "ax1", "ax2", true),
      line("1", "a", "b"),
      line("2", "b", "c"),
      line("3", "c", "d"),
      { id: "A", kind: "arc", c: "o", a: "a", b: "d" },
    ]);
    const r = sketchToRevolve(s, "axis");
    if (!r.ok) throw new Error(r.reason);
    expect(areaOf(r.profile, 1e-6)).toBeCloseTo(76.25, 1);
    body(r.profile, "revolve");
  });
  it("D8: a long arc that dips across the axis between its ends is refused by name", () => {
    // Centre (2.5, 0), radius 4.61: the long way round from a to b reaches x = −2.1, across the axis.
    const s = sk([pt("ax1", 0, -50), pt("ax2", 0, 50), pt("a", 6, 3), pt("b", 6, -3), pt("o", 2.5, 0)], [
      line("axis", "ax1", "ax2", true),
      line("chord", "b", "a"),
      { id: "A", kind: "arc", c: "o", a: "a", b: "b" },
    ]);
    expect(sketchToRevolve(s, "axis")).toEqual({ ok: false, reason: "the profile crosses the axis — it must lie on one side of it (touching is fine)" });
  });
});
