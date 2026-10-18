// The table release's adversarial review: each finding pinned (cadSheet, cadExplode, cadMate).
import { tessellate, Mesh, Vec3 } from "../cadModel";
import { CadDoc, CadPart, defaultParams, docToAssembly } from "../cadShapes";
import { explodeTrails } from "../cadExplode";
import { layoutSheet } from "../cadSheet";
import { faceAt } from "../cadMate";

const box = (id: string, w: number, d: number, h: number, t: Vec3): CadPart => ({ id, name: id, shape: "box", params: { ...defaultParams("box"), w, d, h }, placement: { translate: t, rotateDeg: [0, 0, 0] } });
const TABLE = (): CadDoc => ({
  v: 1,
  parts: [box("top", 100, 60, 4, [0, 0, 70]), box("leg1", 5, 5, 70, [0, 0, 0]), box("leg2", 5, 5, 70, [95, 0, 0]), box("leg3", 5, 5, 70, [95, 55, 0]), box("leg4", 5, 5, 70, [0, 55, 0])],
  callouts: [],
  standard: "uspto",
  views: [],
});
const meshOf = (d: CadDoc): Mesh => {
  const a = docToAssembly(d);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
};

test("an exploded view with nothing apart: only its own note — no false 'no parts' note, no 'add a part' refusal", () => {
  const m = meshOf(TABLE());
  expect(layoutSheet(m, { standard: "uspto", views: [{ kind: "iso" }, { kind: "exploded" }] }).notes).toEqual(["The exploded view needs the parts apart: press Auto explode, or give a part an explode distance."]);
  expect(layoutSheet(m, { standard: "uspto", views: [{ kind: "exploded" }] }).notes).toEqual(["The exploded view needs the parts apart: press Auto explode, or give a part an explode distance."]);
});

test("a detail of an orthographic view keeps that view's hidden lines (ASME, ISO show them; the detail does too)", () => {
  const d: CadDoc = { ...TABLE(), parts: [box("wall", 100, 5, 100, [0, 0, 0]), box("block", 20, 20, 20, [40, 50, 40])] };
  for (const standard of ["asme", "iso"] as const) {
    const sh = layoutSheet(meshOf(d), { standard, views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [50, 50], r: 15, factor: 2 }] });
    const hidden = /<g data-layer="hidden">([\s\S]*?)<\/g>/.exec(sh.svg)?.[1] ?? "";
    expect([standard, (hidden.match(/<path /g) ?? []).length]).toEqual([standard, 2]);
  }
});

test("ASME balloons with no pictorial view go on the front, not into a detail", () => {
  const d = TABLE();
  d.callouts = [{ anchor: [2.5, 0, 35], label: "1" }];
  const sh = layoutSheet(meshOf(d), { standard: "asme", views: [{ kind: "front" }, { kind: "top" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 35], r: 6, factor: 2 }], callouts: d.callouts });
  const front = sh.frames!.find((f) => f.view === "front")!;
  const cy = Number(/<circle cx="[\d.]+" cy="([\d.]+)" r="[\d.]+" fill="#fff"/.exec(sh.svg)![1]);
  expect(cy).toBeGreaterThanOrEqual(front.cell.y);
  expect(cy).toBeLessThanOrEqual(front.cell.y + front.cell.h);
});

test("a detail's marks are kept in its parent's plane: a new enlargement keeps them on what they point at; strays are named in words", () => {
  const m = meshOf(TABLE());
  const marks = [{ kind: "text" as const, view: "detail:A", at: [2.5, 70] as [number, number], text: "JOINT" }];
  const at = (factor: number): [number, number] => {
    const sh = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r: 8, factor }], marks });
    const f = sh.frames!.find((q) => q.view === "detail:A")!;
    const t = /<text x="([\d.]+)" y="([\d.]+)"[^>]*><tspan[^>]*>JOINT</.exec(sh.svg)!;
    // Relative to the detail's centre on the sheet (the centre maps to itself at any enlargement).
    return [Number(t[1]) - (f.ox + (2.5 - f.minX) * f.k), Number(t[2]) - (f.oyBottom - (70 - f.minY) * f.k)];
  };
  // The text sits at the centre of the circle at 2× and at 4×.
  for (const fct of [2, 4]) for (const v of at(fct)) expect(Math.abs(v)).toBeLessThan(1);
  const stray = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }], marks });
  expect(stray.notes).toContain("1 hand-drawn mark belongs to detail A, which is not on this sheet.");
});

test("a diagonal move's trail starts on the part's face, where the move leaves it", () => {
  const d = TABLE();
  const [t] = explodeTrails(d, meshOf(d), { top: [40, 0, 40] });
  // From the centre (50, 30, 72) back along (−1, 0, −1)/√2: the underside z = 70 is reached first (2 units down).
  expect(t[1].map((x) => +x.toFixed(6))).toEqual([48, 30, 70]);
  expect(t[0].map((x) => +x.toFixed(6))).toEqual([88, 30, 110]);
});

test("the circle's tag stays inside its figure's cell (it ran off the sheet at the right edge)", () => {
  const sh = layoutSheet(meshOf(TABLE()), { standard: "uspto", views: [{ kind: "front" }, { kind: "right" }, { kind: "detail", letter: "A", of: "right", at: [60, 72], r: 6, factor: 2 }] });
  const right = sh.frames!.find((f) => f.view === "right")!;
  const tag = [...sh.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(FIG\. \d)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
  const fig = sh.labels[sh.labels.length - 1];
  const beside = tag.filter((q) => q.t === fig && q.y < right.cell.y + right.cell.h + 1);
  expect(beside).toHaveLength(1);
  expect(beside[0].x + fig.length * 18.59 * 0.62).toBeLessThanOrEqual(right.cell.x + right.cell.w + 0.5);
  expect(beside[0].x + 1).toBeLessThan(sh.widthPx);
});

test("a face's centre snap stays on the face clicked: a U part's two arm tops are two faces", () => {
  // A U from three boxes would be three bodies; a sketch U is one: built as one extruded profile here.
  const u: CadPart = {
    id: "u",
    name: "u",
    shape: "sketch",
    params: {},
    placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] },
  } as unknown as CadPart;
  void u; // (the sketch shape is built through the sketcher in its own tests; here two coplanar boxes in ONE mesh)
  const m = meshOf({ ...TABLE(), parts: [box("a", 10, 10, 30, [0, 0, 0]), box("b", 10, 10, 30, [40, 0, 0])] });
  // Merge the two bodies into one for the test: faceAt groups by body.
  const merged: Mesh = { ...m, triBody: m.triBody.map(() => 0) };
  let tri = -1;
  for (let t = 0; t < merged.triangles.length / 3 && tri < 0; t++) {
    const z = [0, 1, 2].map((k) => merged.positions[3 * merged.triangles[3 * t + k] + 2]);
    const x = merged.positions[3 * merged.triangles[3 * t]];
    if (z.every((v) => Math.abs(v - 30) < 1e-9) && x < 20) tri = t;
  }
  const r = faceAt(merged, tri, [5, 5, 30], 100);
  // Snapped to the centre of the first top (5, 5, 30) or one of its corners — never to the gap at x = 25.
  expect(r.ok && r.hit.point[0]).toBeLessThanOrEqual(10);
});

test("the USPTO bracket round an exploded view stands beyond its callout column (no lead line crosses it)", () => {
  const d = TABLE();
  d.callouts = [{ anchor: [100, 30, 74], label: "10" }];
  const m = meshOf(d);
  const em = meshOf({ ...d, parts: d.parts.map((p, i) => (i === 0 ? { ...p, placement: { ...p.placement, translate: [0, 0, 100] as Vec3 } } : p)) });
  const sh = layoutSheet(m, { standard: "uspto", views: [{ kind: "iso" }, { kind: "exploded" }], callouts: d.callouts, exploded: { mesh: em, anchors: [[100, 30, 104]], trails: [] } });
  const br = /<path d="M([\d.]+) [\d.]+L([\d.]+) [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+M([\d.]+) [\d.]+L([\d.]+) /.exec(sh.svg)!;
  const xr = Number(br[4]);
  const numerals = [...sh.svg.matchAll(/<text x="([\d.]+)"[^>]*>10<\/text>/g)].map((q) => Number(q[1]));
  // The exploded figure's numeral (the right-most one) is inside the bracket.
  expect(Math.max(...numerals)).toBeLessThan(xr);
});

test("second review: text on a standard-scale sheet with a detail fits as it did (the scale search reports the scale it drew)", () => {
  const d: CadDoc = { ...TABLE(), parts: [box("top", 54, 32.4, 2.16, [0, 0, 37.8]), box("leg1", 2.7, 2.7, 37.8, [0, 0, 0])] };
  const m = meshOf(d);
  const views = [{ kind: "front" as const }, { kind: "top" as const }, { kind: "detail" as const, letter: "A", of: "front" as const, at: [1.35, 37.8] as [number, number], r: 4.32, factor: 4 }];
  for (const text of ["NOTE TEXT HERE", "A LONGER NOTE ON THE JOINT BETWEEN THE TOP AND THE LEG"]) {
    const sh = layoutSheet(m, { standard: "iso", views, marks: [{ kind: "text", view: "front", at: [27, 43.2], text }] });
    expect([text, sh.notes.filter((n) => /does not fit/.test(n))]).toEqual([text, []]);
    expect(sh.svg).toContain(text.split(" ")[0]);
  }
});
