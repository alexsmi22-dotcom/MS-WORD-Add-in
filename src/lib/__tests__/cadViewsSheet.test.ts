// Section and perspective views on the sheet (docs/SCOPE-CAD-VIEWS.md §B, §C): the section view with its hatching,
// the cutting line on the view it is cut from (1.84(h)(3): broken line, arrows, ends named by the view number), the
// refusals as notes; the perspective view and its callouts; and both through the document's parse/serialize.
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Mesh, Placement, tessellate, tube } from "../cadModel";
import { HATCH_MIN_GAP_MM, layoutSheet, Sheet, SheetOptions, ViewSpec } from "../cadSheet";
import { defaultParams, parseDoc, serializeDoc, CadDoc } from "../cadShapes";

let seq = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++seq}`, name: `b${seq}`, spec, placement });
const at = (x: number, y: number, z: number): Placement => ({ translate: [x, y, z], rotateDeg: [0, 0, 0] });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
// A 40 × 20 × 10 block with a 10 × 10 × 20 post on its left end, at the front half (y 0..10): a cut across the
// post differs from a cut beside it, and is not symmetric left to right in the section.
const L = (): Mesh => meshOf(body(box(40, 20, 10)), body(box(10, 10, 20), at(0, 0, 10)));
const front: ViewSpec = { kind: "front" };
const sec = (a: [number, number], b: [number, number], more: Partial<{ label: string; flip: boolean; of: "front" | "top" }> = {}): ViewSpec => ({ kind: "section", label: more.label ?? "A", of: more.of ?? "front", a, b, ...(more.flip ? { flip: true } : {}) });
const sheet = (m: Mesh, o: Partial<SheetOptions> & { views: ViewSpec[] }): Sheet => layoutSheet(m, { standard: "uspto", lineBudgetMs: 600000, ...o });
const frameOf = (s: Sheet, view: string) => s.frames!.find((f) => f.view === view)!;
const count = (svg: string, re: RegExp): number => (svg.match(re) ?? []).length;
/** The first shaft of section `label`'s arrows: [x0, y0, x1, y1] on the sheet. */
const shaft = (svg: string, label: string): number[] => {
  const m = new RegExp(`data-arrow="${label}" d="M([\\d.]+) ([\\d.]+)L([\\d.]+) ([\\d.]+)"`).exec(svg)!;
  return m.slice(1, 5).map(Number);
};
const cutAcrossPost = sec([5, -5], [5, 40]); // x = 5, looking along +X (to the right of a line drawn upward)

describe("a section view on the sheet", () => {
  test("drawn, hatched, after the view it is cut from; the cutting line, two arrows and two labels on that view (USPTO: the FIG number)", () => {
    const s = sheet(L(), { views: [front, cutAcrossPost] });
    expect(s.svg).not.toBe("");
    expect(s.notes).toEqual([]);
    expect(s.labels).toEqual(["FIG. 1", "FIG. 2"]);
    expect(frameOf(s, "section:A")).toBeDefined();
    // Read after its parent: a row below it.
    expect(frameOf(s, "section:A").cell.y).toBeGreaterThan(frameOf(s, "front").cell.y);
    expect(count(s.svg, /data-hatch="1"/g)).toBe(1);
    expect(count(s.svg, /data-cutting="A"/g)).toBe(1);
    expect(count(s.svg, /data-arrow="A"/g)).toBe(4); // a shaft and a head at each end
    const ends = [...s.svg.matchAll(/data-cutting-label="A"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(ends).toEqual(["2", "2"]);
    // The cutting line is a broken line (dashed) and reaches past the part: the front view's box grew to hold it.
    expect(/data-cutting="A" d="[^"]*" fill="none" stroke="#000" stroke-width="[\d.]+" stroke-dasharray/.test(s.svg)).toBe(true);
    const plain = sheet(L(), { views: [front] });
    expect(frameOf(s, "front").minY).toBeLessThan(frameOf(plain, "front").minY);
  });

  test("ASME titles it SECTION A–A and names the line's ends A; ISO titles it A–A", () => {
    const asme = sheet(L(), { standard: "asme", views: [front, cutAcrossPost] });
    expect(asme.labels).toContain("SECTION A–A");
    expect([...asme.svg.matchAll(/data-cutting-label="A"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["A", "A"]);
    const iso = sheet(L(), { standard: "iso", views: [front, cutAcrossPost] });
    expect(iso.labels).toContain("A–A");
  });

  test("the arrows point the way the section looks; Flip turns them round and mirrors the section", () => {
    const s = sheet(L(), { views: [front, cutAcrossPost] });
    const f = sheet(L(), { views: [front, sec([5, -5], [5, 40], { flip: true })] });
    const [x0, , x1] = shaft(s.svg, "A"), [fx0, , fx1] = shaft(f.svg, "A");
    expect(x1).toBeGreaterThan(x0); // toward +X
    expect(fx1).toBeLessThan(fx0);
    // Looking along +X the post (y 0..10) is on the section's right (y runs right to left): x from −20 to 0.
    // Looking back along −X it is on the left: x from 0 to 20 — the mirror image.
    expect(frameOf(s, "section:A").minX).toBeCloseTo(-20, 6);
    expect(frameOf(f, "section:A").minX).toBeCloseTo(0, 6);
  });

  test("a different cutting line draws a different section (the drawing is cached by its plane)", () => {
    const m = L();
    const ratio = (s: Sheet): number => frameOf(s, "section:A").cell.h / frameOf(s, "front").cell.h;
    const across = sheet(m, { views: [front, cutAcrossPost] });
    const beside = sheet(m, { views: [front, sec([30, -5], [30, 40])] });
    const again = sheet(m, { views: [front, cutAcrossPost] });
    // Across the post the cut is 30 high; beside it, the block's 10.
    expect(ratio(beside)).toBeLessThan(ratio(across) * 0.6);
    expect(again.svg).toBe(across.svg);
  });

  test("a section of a view not on the sheet is left out, and said (1.84(h)(3))", () => {
    const s = sheet(L(), { views: [{ kind: "top" }, cutAcrossPost] });
    expect(s.labels).toEqual(["FIG. 1"]);
    expect(s.notes).toEqual(["Section A is cut from the front view, which is not on this sheet, so it is not drawn: tick that view too."]);
  });

  test("a line that misses the part, or has no length, is left out with a note naming the section", () => {
    const miss = sheet(L(), { views: [front, sec([100, -5], [100, 40])] });
    expect(miss.labels).toEqual(["FIG. 1"]);
    expect(miss.notes).toEqual(["Section A is not drawn: its cutting line does not cross the part — take it again across the part."]);
    const dot = sheet(L(), { views: [front, sec([5, 5], [5, 5], { label: "B" })] });
    expect(dot.notes[0]).toMatch(/^Section B is not drawn: its cutting line has no length/);
  });

  test("a part that is not closed where it is cut: the section is left out with a note naming the section and the part", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const keep: number[] = [], kn: number[] = [], kb: number[] = [];
    for (let t = 0; t < m.triangles.length / 3; t++) {
      const zs = [0, 1, 2].map((c) => m.positions[3 * m.triangles[3 * t + c] + 2]);
      if (zs.every((z) => Math.abs(z - zs[0]) < 1e-9)) continue; // no top or bottom: an open sleeve
      keep.push(m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]);
      kn.push(...m.cornerNormals.slice(9 * t, 9 * t + 9));
      kb.push(m.triBody[t]);
    }
    const open: Mesh = { ...m, triangles: keep, cornerNormals: kn, triBody: kb };
    const s = sheet(open, { views: [front, sec([20, -5], [20, 15])] });
    expect(s.labels).toEqual(["FIG. 1"]);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatch(/^Section A is not drawn: part 1 is not a closed solid where the plane cuts it/);
  });

  test("a callout on the part the section takes away is not drawn in the section", () => {
    // On the block's front face at x = 2, the near side of the plane x = 5: shown in the front view only.
    const callouts = [{ anchor: [2, 0, 5] as [number, number, number], label: "10" }];
    const both = sheet(L(), { views: [front, cutAcrossPost], callouts });
    const alone = sheet(L(), { views: [front], callouts });
    const numerals = (s: Sheet): number => count(/<g data-layer="callouts">.*?<\/g>/.exec(s.svg)![0], /<text/g);
    expect(numerals(alone)).toBe(1);
    expect(numerals(both)).toBe(1);
  });

  test("hatching on a part drawn small never closes up: the lines stay at least 1.5 mm apart on paper", () => {
    // A 1000 mm ring with a 2 mm wall, cut across: from its area alone the spacing would print at about 1 mm.
    const m = meshOf(body(tube(500, 498, 100)));
    const s = sheet(m, { views: [front, sec([-600, 50], [600, 50])] });
    expect(s.notes).toEqual([]);
    const d = /data-hatch="1" d="([^"]*)"/.exec(s.svg)![1];
    const cs = [...d.matchAll(/M([\d.]+) ([\d.]+)/g)].map((q) => (Number(q[1]) + Number(q[2])) / Math.SQRT2); // across 45° lines, px
    // One lane per hatch line (a line crosses the ring twice; its two pieces agree to the SVG's 0.01 px rounding).
    const lanes: number[] = [];
    for (const c of [...cs].sort((a, b) => a - b)) if (!lanes.length || c - lanes[lanes.length - 1] > 0.5) lanes.push(c);
    expect(lanes.length).toBeGreaterThan(10);
    const gapMm = Math.min(...lanes.slice(1).map((c, i) => c - lanes[i])) / (96 / 25.4);
    expect(gapMm).toBeGreaterThanOrEqual(HATCH_MIN_GAP_MM - 0.01);
  });

  test("hidden lines behind the cutting plane are left out of the section unless asked for", () => {
    // A small block on the base, behind the post's cut face: hidden in the section.
    const m = meshOf(body(box(40, 20, 10)), body(box(10, 10, 20), at(0, 0, 10)), body(box(4, 4, 4), at(20, 2, 10)));
    const hiddenPaths = (sh: Sheet): number => count(/<g data-layer="hidden">.*?<\/g>/.exec(sh.svg)?.[0] ?? "", /<path/g);
    const asme = sheet(m, { standard: "asme", views: [front, cutAcrossPost] });
    const asked = sheet(m, { standard: "asme", views: [front, cutAcrossPost], showHidden: true });
    expect(hiddenPaths(asked)).toBe(hiddenPaths(asme) + 1);
  });

  test("a sheet with no section or perspective is drawn as before (no cutting line, no hatching)", () => {
    const s = sheet(L(), { views: [front, { kind: "iso" }] });
    expect(s.svg).not.toMatch(/data-(hatch|cutting|arrow)/);
  });
});

describe("a perspective view on the sheet", () => {
  test("drawn as a pictorial view, titled", () => {
    const s = sheet(L(), { standard: "asme", views: [front, { kind: "perspective" }] });
    expect(s.notes).toEqual([]);
    expect(s.labels).toEqual(["FRONT", "PERSPECTIVE"]);
    expect(frameOf(s, "perspective")).toBeDefined();
  });

  test("its callouts are placed through the map and tested on the mapped model", () => {
    // From the isometric direction (front, right, above) the front face is seen and the back face is not.
    const seen = sheet(L(), { views: [{ kind: "perspective", distance: 2 }], callouts: [{ anchor: [20, 0, 5], label: "10" }] });
    expect(seen.notes).toEqual([]);
    const behind = sheet(L(), { views: [{ kind: "perspective", distance: 2 }], callouts: [{ anchor: [20, 20, 5], label: "12" }] });
    expect(behind.notes).toEqual(["Callout 12 is hidden in every view on this sheet, so it is not drawn."]);
  });

  test("the eye inside the model: the view is left out with a note (the pane's distances never reach it)", () => {
    const s = sheet(L(), { views: [front, { kind: "perspective", distance: 0.3 }] });
    expect(s.labels).toEqual(["FIG. 1"]);
    expect(s.notes).toEqual(["The perspective view is not drawn: the eye would be inside the model at this distance — choose a farther perspective."]);
  });
});

describe("section and perspective views in the saved drawing", () => {
  const doc = (views: unknown[]): string =>
    JSON.stringify({ v: 1, parts: [{ id: "p1", name: "Plate", shape: "plate", params: defaultParams("plate"), placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }], callouts: [], standard: "uspto", views });
  test("round trip", () => {
    const views = [{ kind: "front" }, { kind: "section", label: "A", of: "front", a: [5, -5], b: [5, 40], flip: true }, { kind: "perspective", distance: 2 }, { kind: "perspective" }];
    const r = parseDoc(doc(views));
    if (!r.ok) throw new Error(r.reason);
    expect(r.doc.views).toEqual(views);
    const again = parseDoc(serializeDoc(r.doc as CadDoc));
    expect(again.ok && again.doc.views).toEqual(views);
  });
  test.each([
    [{ kind: "section", label: "", of: "front", a: [0, 0], b: [1, 1] }, "a section view in the drawing is damaged"],
    [{ kind: "section", label: "ABCDE", of: "front", a: [0, 0], b: [1, 1] }, "a section view in the drawing is damaged"],
    [{ kind: "section", label: "A", of: "iso", a: [0, 0], b: [1, 1] }, "section view A in the drawing is damaged"],
    [{ kind: "section", label: "A", of: "front", a: [0, null], b: [1, 1] }, "section view A in the drawing is damaged"],
    [{ kind: "section", label: "A", of: "front", a: [0, 0], b: [1, 1, 2] }, "section view A in the drawing is damaged"],
    [{ kind: "section", label: "A", of: "front", a: [0, 0], b: [1, 1], flip: "yes" }, "section view A in the drawing is damaged"],
    [{ kind: "perspective", distance: 0.3 }, "the perspective view in the drawing is damaged"],
    [{ kind: "perspective", distance: "far" }, "the perspective view in the drawing is damaged"],
  ])("damaged: %j", (v, why) => {
    expect(parseDoc(doc([{ kind: "front" }, v]))).toEqual({ ok: false, reason: why });
  });
  test("two sections with one label are damaged (the sheet names views by label)", () => {
    const s = { kind: "section", label: "A", of: "front", a: [0, 0], b: [1, 1] };
    expect(parseDoc(doc([s, { ...s, a: [2, 2] }]))).toEqual({ ok: false, reason: "section view A in the drawing is damaged" });
  });
  test("a section and a detail sharing a letter are damaged, either order (review: one A on a circle and a cutting line)", () => {
    const s = { kind: "section", label: "A", of: "front", a: [0, 0], b: [1, 1] };
    const dt = { kind: "detail", letter: "A", of: "front", at: [0, 0], r: 1, factor: 2 };
    expect(parseDoc(doc([{ kind: "front" }, dt, s]))).toEqual({ ok: false, reason: "section view A in the drawing is damaged" });
    expect(parseDoc(doc([{ kind: "front" }, s, dt]))).toEqual({ ok: false, reason: "a detail view in the drawing is damaged" });
  });
  test("a perspective strength the pane does not offer is damaged (it was drawn as the default, silently)", () => {
    expect(parseDoc(doc([{ kind: "perspective", distance: 4 }]))).toEqual({ ok: false, reason: "the perspective view in the drawing is damaged" });
  });
});
