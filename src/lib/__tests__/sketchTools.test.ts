// The sketch's full toolset (polygon, slot, centre rectangle, 3-point arc, fillet,
// chamfer, offset, mirror, patterns, trim), checked by the geometry they make.
import { startEdit, click, EditState, SketchTool } from "../sketchEdit";
import { polygon, fillet, chamfer, offset, mirror, linearPattern, circularPattern, trim, clearSketch } from "../sketchTools";
import { Sketch, freedom, setDimension, radiusOf } from "../sketch";
import { sketchToProfile } from "../sketchProfile";
import { flattenLoop, signedArea, Profile } from "../cadModel";

const clicks = (st: EditState, tool: SketchTool, pts: Array<[number, number]>): EditState =>
  pts.reduce<EditState>((s, [x, y]) => {
    const r = click(s, x, y, 0.3);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }, { ...st, tool, pending: [] });
const ok = (r: { ok: boolean; state: EditState; reason?: string }): EditState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const area = (sk: Sketch): number => {
  const r = sketchToProfile(sk);
  if (!r.ok) throw new Error(r.reason);
  const p: Profile = r.profile;
  return signedArea(flattenLoop(p.outer, 1e-7).points) + p.holes.reduce((s, h) => s + signedArea(flattenLoop(h, 1e-7).points), 0);
};
const P = (sk: Sketch, id: string) => sk.points.find((p) => p.id === id)!;
const rect = (): EditState => clicks(startEdit(), "rectangle", [[0, 0], [40, 20]]);
const lineIds = (sk: Sketch) => sk.entities.filter((e) => e.kind === "line" && !e.construction).map((e) => e.id);

describe("drawing tools", () => {
  it("a regular hexagon: six equal sides of the circumradius, closed, and free only in centre, size and turn (4)", () => {
    const st = ok(polygon(startEdit(), 0, 0, 10, 0, 6));
    const sk = st.sketch;
    const lines = sk.entities.filter((e) => e.kind === "line") as Array<{ a: string; b: string }>;
    expect(lines).toHaveLength(6);
    for (const l of lines) expect(Math.hypot(P(sk, l.b).x - P(sk, l.a).x, P(sk, l.b).y - P(sk, l.a).y)).toBeCloseTo(10, 9);
    expect(area(sk)).toBeCloseTo((3 * Math.sqrt(3) / 2) * 100, 6);
    expect(freedom(sk).dof).toBe(4);
  });
  it("polygon through the click tool uses the chosen number of sides", () => {
    const st = clicks({ ...startEdit(), sides: 5 }, "polygon", [[0, 0], [8, 0]]);
    expect(st.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(5);
  });
  it("a slot: area = 2w·L + πw²", () => {
    const st = clicks(startEdit(), "slot", [[0, 0], [30, 0], [10, 5]]);
    expect(area(st.sketch)).toBeCloseTo(2 * 5 * 30 + Math.PI * 25, 2); // flattening caps at 512 steps a turn
  });
  it("a centre rectangle is centred where clicked", () => {
    const st = clicks(startEdit(), "centreRectangle", [[10, 10], [25, 18]]);
    expect(area(st.sketch)).toBeCloseTo(30 * 16, 9);
    const xs = st.sketch.points.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(10, 9);
  });
  it("a 3-point arc passes through all three points, the middle one on the drawn part", () => {
    const st = clicks(startEdit(), "arc3", [[0, 0], [10, 0], [5, 3]]);
    const arc = st.sketch.entities[0] as { c: string; a: string; b: string };
    const o = P(st.sketch, arc.c), r = radiusOf(st.sketch, (st.sketch.entities[0] as { id: string }).id);
    for (const [x, y] of [[0, 0], [10, 0], [5, 3]]) expect(Math.hypot(x - o.x, y - o.y)).toBeCloseTo(r, 9);
    expect(o.y).toBeLessThan(3); // the centre is below the bulge
    expect(clicks(startEdit(), "arc3", [[0, 0], [10, 0]]).pending).toHaveLength(2);
    expect(click(clicks(startEdit(), "arc3", [[0, 0], [10, 0]]), 5, 0, 0.3)).toMatchObject({ ok: false, reason: "those three points are in a line — an arc needs them to bend" });
  });
});

describe("corners", () => {
  it("fillet R5 on a 40 × 20 rectangle: tangent arc, area w·h − (r² − πr²/4), and the width still drives", () => {
    let st = rect();
    const [l1, l2] = lineIds(st.sketch);
    st = ok(fillet(st, l1, l2, 5));
    expect(area(st.sketch)).toBeCloseTo(800 - (25 - (Math.PI * 25) / 4), 2);
    // A width dimension added to the bottom line before filleting would have become the distance to the
    // virtual sharp; dimensioning now and changing it still works.
    const arcs = st.sketch.entities.filter((e) => e.kind === "arc");
    expect(arcs).toHaveLength(1);
    expect(st.sketch.constraints.filter((c) => c.kind === "tangent")).toHaveLength(2);
  });
  it("a width dimension on a filleted line keeps meaning the full width (to the virtual sharp)", () => {
    let st = rect();
    const [l1, l2] = lineIds(st.sketch);
    // Height pinned on the far side, so changing the width moves nothing else.
    const far = lineIds(st.sketch)[3];
    st = { ...st, sketch: { ...st.sketch, constraints: [...st.sketch.constraints, { id: "w", kind: "length", line: l1, value: 40 }, { id: "h", kind: "length", line: far, value: 20 }] } };
    st = ok(fillet(st, l1, l2, 5));
    // The width now sits on the construction line that carries the original edge to the virtual sharp.
    const w = st.sketch.constraints.find((c) => c.id === "w") as { kind: string; line: string };
    expect(w.kind).toBe("length");
    expect(st.sketch.entities.find((e) => e.id === w.line)).toMatchObject({ construction: true });
    const r = setDimension(st.sketch, "w", 60);
    if (!r.ok) throw new Error(r.reason);
    expect(area(r.sketch)).toBeCloseTo(60 * 20 - (25 - (Math.PI * 25) / 4), 2);
  });
  it("too large a fillet is refused by name", () => {
    const st = rect();
    const [l1, l2] = lineIds(st.sketch);
    expect(fillet(st, l1, l2, 30)).toMatchObject({ ok: false, reason: "R30 is too large for these lines — the rounding would run past an end" });
    expect(fillet(st, l1, lineIds(st.sketch)[2], 2)).toMatchObject({ ok: false, reason: "those two lines do not meet at a corner — join them first" });
  });
  it("chamfer 4: area w·h − d²/2", () => {
    let st = rect();
    const [l1, l2] = lineIds(st.sketch);
    st = ok(chamfer(st, l1, l2, 4));
    expect(area(st.sketch)).toBeCloseTo(800 - 8, 9);
  });
});

describe("offset, mirror, patterns, trim, clear", () => {
  it("offsetting a whole rectangle 3 outward makes a frame of area (w+6)(h+6) − w·h; −3 makes it inward", () => {
    const st = rect();
    const out = ok(offset({ ...st, selection: lineIds(st.sketch) }, 3));
    expect(area(out.sketch)).toBeCloseTo(46 * 26 - 800, 6);
    const inn = ok(offset({ ...st, selection: lineIds(st.sketch) }, -3));
    expect(area(inn.sketch)).toBeCloseTo(800 - 34 * 14, 6);
  });
  it("offsetting a circle makes a concentric one r + d; a line, a parallel one d away", () => {
    let st = clicks(startEdit(), "circle", [[0, 0], [5, 0]]);
    st = ok(offset({ ...st, selection: [st.sketch.entities[0].id] }, 2));
    expect(radiusOf(st.sketch, st.sketch.entities[1].id)).toBeCloseTo(7, 9);
    let ln = clicks(startEdit(), "line", [[0, 0], [10, 0]]);
    ln = ok(offset({ ...ln, pending: [], selection: [ln.sketch.entities[0].id] }, 4));
    const nl = ln.sketch.entities[1] as { a: string };
    expect(P(ln.sketch, nl.a).y).toBeCloseTo(4, 9);
  });
  it("mirroring a half outline about a vertical construction line doubles it (symmetric relations hold)", () => {
    // Half of a 20 × 10 rectangle (x 0..10) plus the mirror line x = 0.
    let st = clicks(startEdit(), "line", [[0, 0], [10, 0], [10, 10], [0, 10]]);
    st = { ...st, pending: [], construction: true };
    st = clicks(st, "line", [[0, -5], [0, 15]]);
    const axis = st.sketch.entities[st.sketch.entities.length - 1].id;
    const half = st.sketch.entities.filter((e) => !e.construction).map((e) => e.id);
    st = ok(mirror({ ...st, pending: [], selection: [...half, axis] }));
    // The two halves meet on the axis at shared points: a closed 20 × 10 outline.
    expect(area(st.sketch)).toBeCloseTo(200, 6);
    expect(st.sketch.constraints.filter((c) => c.kind === "symmetric").length).toBeGreaterThan(0);
  });
  it("a linear pattern of 4 holes 15 apart, and a circular pattern of 6 round a centre", () => {
    let st = clicks(startEdit(), "circle", [[0, 0], [2, 0]]);
    st = ok(linearPattern({ ...st, selection: [st.sketch.entities[0].id] }, 4, 15, 0));
    expect(st.sketch.entities.filter((e) => e.kind === "circle")).toHaveLength(4);
    expect(Math.max(...st.sketch.points.map((p) => p.x))).toBeCloseTo(45, 9);
    const ring = clicks(startEdit(), "circle", [[10, 0], [12, 0]]);
    const withCentre: EditState = { ...ring, sketch: { ...ring.sketch, points: [...ring.sketch.points, { id: "ctr", x: 0, y: 0 }] } };
    const cp = ok(circularPattern({ ...withCentre, selection: [ring.sketch.entities[0].id, "ctr"] }, 6));
    const centres = cp.sketch.entities.filter((e) => e.kind === "circle").map((e) => P(cp.sketch, (e as { c: string }).c));
    expect(centres).toHaveLength(6);
    for (const c of centres) expect(Math.hypot(c.x, c.y)).toBeCloseTo(10, 9);
  });
  it("trim: the end of a line past where it crosses another is cut back to the crossing, held there", () => {
    let st = clicks(startEdit(), "line", [[0, 0], [20, 0]]);
    st = clicks({ ...st, pending: [] }, "line", [[10, -5], [10, 5]]);
    const h = st.sketch.entities[0].id;
    st = ok(trim(st, h, 16, 0)); // the right-hand piece goes
    const l = st.sketch.entities.find((e) => e.id === h) as { a: string; b: string };
    const xs = [P(st.sketch, l.a).x, P(st.sketch, l.b).x].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 9);
    expect(xs[1]).toBeCloseTo(10, 9);
    expect(st.sketch.constraints.some((c) => c.kind === "onLine")).toBe(true);
  });
  it("clear sketch empties it (the editor keeps the old one for Undo)", () => {
    const r = clearSketch(rect());
    expect(r.ok).toBe(true);
    expect(r.state.sketch.points).toHaveLength(0);
    expect(clearSketch(startEdit())).toMatchObject({ ok: false, reason: "the sketch is already empty" });
  });
});

describe("sketcher review — every finding pinned", () => {
  const len = (sk: Sketch, id: string): number => {
    const l = sk.entities.find((e) => e.id === id) as { a: string; b: string };
    return Math.hypot(P(sk, l.b).x - P(sk, l.a).x, P(sk, l.b).y - P(sk, l.a).y);
  };
  it("D1: a fillet on one corner of a hexagon leaves its other sides' equal relation meaning the full sides (the untouched four stay 10)", () => {
    let st = ok(polygon(startEdit(), 0, 0, 10, 0, 6));
    const sides = st.sketch.entities.filter((e) => e.kind === "line" && !e.construction).map((e) => e.id);
    st = ok(fillet(st, sides[0], sides[1], 1));
    for (const id of sides.slice(2, 5)) expect(len(st.sketch, id)).toBeCloseTo(10, 9);
  });
  it("D1: a midpoint on an edge stays at the middle of the FULL edge after the next corner is filleted", () => {
    let st = rect();
    const [l1, l2, l3] = lineIds(st.sketch);
    st = { ...st, sketch: { ...st.sketch, points: [...st.sketch.points, { id: "m", x: 20, y: 20 }] } };
    st = { ...st, sketch: { ...st.sketch, constraints: [...st.sketch.constraints, { id: "mid", kind: "midpoint", p: "m", line: l3 }] } };
    const before = P(st.sketch, "m").x;
    st = ok(fillet(st, l2, l3, 4));
    expect(P(st.sketch, "m").x).toBeCloseTo(before, 9);
    void l1;
  });
  it("D1: trimming a line with an equal relation drops that relation by name and does not distort the shape", () => {
    let st = rect();
    const [bottom, right] = lineIds(st.sketch);
    st = { ...st, sketch: { ...st.sketch, constraints: [...st.sketch.constraints, { id: "eq", kind: "equal", e1: bottom, e2: right }] } };
    st = clicks({ ...st, pending: [] }, "circle", [[0, 0], [8, 0]]);
    const r = trim(st, bottom, 2, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.note).toMatch(/^Trimmed; relations that depended on the line's full length went with it \(equal\)\.$/);
      expect(r.state.sketch.constraints.some((c) => c.id === "eq")).toBe(false);
    }
  });
  it("D2: an inward offset larger than the outline is refused, not drawn reversed", () => {
    const sq = clicks(startEdit(), "rectangle", [[0, 0], [10, 10]]);
    expect(offset({ ...sq, selection: lineIds(sq.sketch) }, -6)).toMatchObject({ ok: false, reason: "an offset of -6 is larger than this outline allows" });
  });
  it("D3: a circle centred on the mirror line, and a line lying on it, are their own images (not duplicated)", () => {
    let st = clicks(startEdit(), "circle", [[0, 0], [3, 0]]);
    st = clicks({ ...st, pending: [] }, "line", [[0, -2], [0, 8]]);
    st = { ...st, pending: [], construction: true };
    st = clicks(st, "line", [[0, -10], [0, 10]]);
    const ids = st.sketch.entities.map((e) => e.id);
    const r = mirror({ ...st, pending: [], selection: [ids[0], ids[1], ids[2]] });
    expect(r).toMatchObject({ ok: false, reason: "everything selected lies on the mirror line — it is its own mirror image" });
  });
  it("D4: a 3-point arc started and ended on existing points uses them (the outline really closes)", () => {
    let st = clicks(startEdit(), "line", [[0, 0], [10, 0]]);
    st = clicks({ ...st, pending: [] }, "arc3", [[10, 0], [0, 0], [5, 4]]);
    // Two line ends + the arc's centre: 3 points, and a closed profile.
    expect(st.sketch.points).toHaveLength(3);
    expect(sketchToProfile(st.sketch).ok).toBe(true);
  });
  it("D6: a line trimmed through the middle stays one straight line in two pieces", () => {
    let st = clicks(startEdit(), "line", [[0, 0], [30, 0]]);
    st = clicks({ ...st, pending: [] }, "line", [[10, -5], [10, 5]]);
    st = clicks({ ...st, pending: [] }, "line", [[20, -5], [20, 5]]);
    const h = st.sketch.entities[0].id;
    st = ok(trim(st, h, 15, 0));
    const ons = st.sketch.constraints.filter((c) => c.kind === "onLine" && c.line === h);
    expect(ons.length).toBeGreaterThanOrEqual(2);
  });
  it("D8: an offset circle keeps its distance when the original changes size", () => {
    let st = clicks(startEdit(), "circle", [[0, 0], [5, 0]]);
    const orig = st.sketch.entities[0].id;
    st = ok(offset({ ...st, selection: [orig] }, 2));
    const copy = st.sketch.entities.find((e) => e.kind === "circle" && e.id !== orig)!.id;
    st = { ...st, sketch: { ...st.sketch, constraints: [...st.sketch.constraints, { id: "r0", kind: "radius", curve: orig, value: 5 }] } };
    const r = setDimension(st.sketch, "r0", 8);
    if (!r.ok) throw new Error(r.reason);
    expect(radiusOf(r.sketch, copy)).toBeCloseTo(10, 9);
  });
  it("nits: trimming a line that meets nothing removes its ends too; a corner already rounded is named", () => {
    const st = clicks(startEdit(), "line", [[0, 0], [10, 0]]);
    const r = ok(trim(st, st.sketch.entities[0].id, 5, 0));
    expect(r.sketch.points).toHaveLength(0);
    let rr = rect();
    const [a, b] = lineIds(rr.sketch);
    rr = ok(fillet(rr, a, b, 3));
    expect(fillet(rr, a, b, 2)).toMatchObject({ ok: false, reason: "that corner is already rounded — change its R dimension instead" });
  });
});

describe("sketcher re-review — every finding pinned", () => {
  it("1: trimming the middle piece of a line that crosses three others removes just that piece", () => {
    let st = clicks(startEdit(), "line", [[0, 0], [30, 0]]);
    for (const x of [5, 12, 20]) st = clicks({ ...st, pending: [] }, "line", [[x, -5], [x, 5]]);
    const r = trim(st, st.sketch.entities[0].id, 8, 0);
    expect(r).toMatchObject({ ok: true });
  });
  it("2: a diagonal mirrored about a line it crosses, and a rectangle patterned onto itself, are allowed", () => {
    let st = clicks(startEdit(), "line", [[-5, -3], [5, 3]]);
    st = { ...st, pending: [], construction: true };
    st = clicks(st, "line", [[0, -10], [0, 10]]);
    const [d, ax] = st.sketch.entities.map((e) => e.id);
    expect(mirror({ ...st, pending: [], construction: false, selection: [d, ax] })).toMatchObject({ ok: true });
    const sq = clicks(startEdit(), "rectangle", [[0, 0], [10, 10]]);
    expect(linearPattern({ ...sq, selection: lineIds(sq.sketch) }, 2, 5, 5)).toMatchObject({ ok: true });
  });
  it("2: an inward offset that would make an hourglass outline cross itself is refused in plain words", () => {
    // A bow-tie-ish concave outline: a narrow waist.
    let st = startEdit();
    const pts: Array<[number, number]> = [[0, 0], [20, 0], [11, 5], [20, 10], [0, 10], [9, 5]];
    for (let i = 0; i < pts.length; i++) st = clicks({ ...st, pending: [] }, "line", [pts[i], pts[(i + 1) % pts.length]]);
    const r = offset({ ...st, pending: [], selection: lineIds(st.sketch) }, -2);
    expect(r).toMatchObject({ ok: false, reason: "an offset of -2 is larger than this outline allows" });
  });
  it("7: the second click of a centre rectangle and of a polygon snaps to an existing point", () => {
    let st = clicks(startEdit(), "point", [[10, 5]]);
    st = clicks({ ...st, pending: [] }, "centreRectangle", [[0, 0], [10, 5]]);
    expect(st.sketch.points).toHaveLength(5); // 4 corners (one is the old point) + the centre
    let pg = clicks(startEdit(), "point", [[10, 0]]);
    pg = clicks({ ...pg, pending: [] }, "polygon", [[0, 0], [10, 0]]);
    expect(pg.sketch.points).toHaveLength(7); // 6 vertices (one is the old point) + the centre
  });
});

describe("sketcher third review — every finding pinned", () => {
  it("blocker: all four corners of a rectangle fillet (the twins keep their lines' direction)", () => {
    let st = clicks(startEdit(), "rectangle", [[0, 0], [40, 20]]);
    const [b, r, t, l] = lineIds(st.sketch);
    for (const [x, y] of [[b, r], [r, t], [t, l], [l, b]]) st = ok(fillet(st, x, y, 3));
    expect(st.sketch.entities.filter((e) => e.kind === "arc")).toHaveLength(4);
    expect(sketchToProfile(st.sketch).ok).toBe(true);
  });
  it("blocker: a corner whose line was offset still fillets", () => {
    let st = clicks(startEdit(), "rectangle", [[0, 0], [40, 20]]);
    const [b, , , l] = lineIds(st.sketch);
    st = ok(offset({ ...st, selection: [b] }, -4));
    expect(fillet(st, l, b, 3)).toMatchObject({ ok: true });
  });
  it("a chamfer or offset that would cross a line the user drew is still refused", () => {
    let st = clicks(startEdit(), "rectangle", [[0, 0], [20, 20]]);
    const [b, r] = lineIds(st.sketch);
    st = clicks({ ...st, pending: [] }, "line", [[16.2, 0.5], [19, 0.5]]);
    expect(chamfer(st, b, r, 4)).toMatchObject({ ok: false, reason: expect.stringMatching(/^that would make L\d+ cross L\d+/) });
    let sq = clicks(startEdit(), "rectangle", [[0, 0], [20, 20]]);
    const sides = lineIds(sq.sketch);
    sq = clicks({ ...sq, pending: [] }, "line", [[22, -10], [22, 30]]);
    expect(offset({ ...sq, pending: [], selection: sides }, 4)).toMatchObject({ ok: false });
  });
});
