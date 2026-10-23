/**
 * @jest-environment jsdom
 */
// Mechanism arrows (Release C, gap #5): the fixed case table. Each row is cumulative — a later fix keeps every row.
// Format facts are cited in cdxArrows.ts / cdxml.ts (legacyArrow). Documents are written by hand; the half-head and
// legacy-graphic rows use attribute values measured on a public ChemDraw 23.1 file (arrows.cdx in github.com/epam/Indigo,
// api/tests/integration/tests/formats/molecules/cdx/), not a copy of it.
import { readCdxml, readCdxmlTree, CdxArrow, CdxDoc } from "../cdxml";
import {
  addArrow, addAtomAt, addCurvedArrow, arrowAnchors, setCharge, deleteInStructure, deleteObjects, findById, flipCurvedArrow, followAnchors, moveObjects, writeCdxml,
} from "../cdxmlEdit";
import { arcOf, arrowTrace, distToTrace, planCurved } from "../cdxArrows";
import { renderCdx } from "../cdxmlRender";
import { chargeGlyph } from "../cdxGlyphs";
import { blankPageCdxml } from "../cdxmlEdit";
import { createChemCanvas } from "../../taskpane/chemCanvas";
import { TextDecoder as NodeTextDecoder } from "util";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

// Two structures, ACS 1996 style: hydroxide O⁻ (21) at left; CH3–Br (31–32, bond 33) at right; a lone page point area.
const SRC = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" LabelFont="3" LabelSize="10" CaptionFont="3" CaptionSize="10">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="20"><n id="21" p="60 100" Element="8" Charge="-1" NumHydrogens="1"><t p="56.4 103.5" BoundingBox="56.4 95 70.8 105" LabelJustification="Left"><s font="3" size="10" face="96">OH</s></t></n></fragment>
<fragment id="30"><n id="31" p="100 100"/><n id="32" p="114.4 100" Element="35" NumHydrogens="0"><t p="110.8 103.5" BoundingBox="110.8 95 123.6 105" LabelJustification="Left"><s font="3" size="10" face="96">Br</s></t></n><b id="33" B="31" E="32"/><n id="34" p="87.53 92.8"/><b id="35" B="34" E="31"/></fragment>
</page></CDXML>`;
const open = (src = SRC): CdxDoc => {
  const r = readCdxml(src);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
/** Written to a file and read back from it. */
const roundTrip = (d: CdxDoc): CdxDoc => open(writeCdxml(d.root));
const arrows = (d: CdxDoc): CdxArrow[] => d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "arrow" ? [it.v] : []));
const geom = (a: CdxArrow) => ({ head: a.head, tail: a.tail, center: a.center, major: a.major, minor: a.minor, angularSize: a.angularSize, headEnd: a.headEnd, tailEnd: a.tailEnd, headType: a.headType, shaftSpacing: a.shaftSpacing, source: a.el.attrs.ArrowSource, target: a.el.attrs.ArrowTarget });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe("write → read: identical geometry", () => {
  test.each([
    ["curved, full head, atom → atom", { atom: "21" }, { atom: "31" }, 2, false],
    ["curved, full head, bond → atom", { bond: "33" }, { atom: "32" }, 2, false],
    ["fishhook, bowed its default way", { atom: "21" }, { atom: "31" }, 1, false],
    ["fishhook, flipped (Shift)", { atom: "21" }, { atom: "31" }, 1, true],
    ["curved on an empty stretch of page (both ends in space)", { at: [200, 300] }, { at: [240, 300] }, 2, false],
  ] as const)("%s", (_n, from, to, electrons, flip) => {
    const d = open();
    const r = ok(addCurvedArrow(d, from as never, to as never, { electrons, flip }));
    const a = arrows(reread(d)).find((x) => x.id === r.arrowId)!;
    const b = arrows(roundTrip(d)).find((x) => x.id === r.arrowId)!;
    expect(geom(b)).toEqual(geom(a));
    expect(a.angularSize).not.toBe(0);
    // A fishhook's barb on the outside of its curve: bowed left (clockwise, negative AngularSize) is HalfLeft.
    if (electrons === 1) expect(a.headEnd).toBe(a.angularSize < 0 ? "HalfLeft" : "HalfRight");
    else expect(a.headEnd).toBe("Full");
    if (flip) {
      const other = open();
      ok(addCurvedArrow(other, from as never, to as never, { electrons, flip: false }));
      expect(Math.sign(arrows(reread(other))[0].angularSize)).toBe(-Math.sign(a.angularSize));
    }
    if ("atom" in from || "bond" in from) expect(a.el.attrs.ArrowSource).toBe("atom" in from ? from.atom : (from as { bond: string }).bond);
    else expect(a.el.attrs.ArrowSource).toBeUndefined();
    // Written as ChemDraw writes a curved arrow: the ellipse a circle with axes along x and y.
    const g = arcOf(a)!;
    expect(Math.abs(g.a[1]) + Math.abs(g.b[0])).toBe(0);
    // The arc runs from the tail to the head.
    const tr = arrowTrace(a);
    expect(Math.hypot(tr[tr.length - 1][0] - a.head[0], tr[tr.length - 1][1] - a.head[1])).toBeLessThan(0.05);
    expect(renderCdx(roundTrip(d))).not.toBeNull();
  });

  test("retrosynthetic ⇒: an open head over two shafts, and the older graphic it supersedes (ChemDraw 23 writes both)", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [260, 300], "retrosynthetic")).toBeNull();
    const back = roundTrip(d);
    const [a] = arrows(back);
    expect([a.headEnd, a.tailEnd, a.headType, a.shaftSpacing, a.angularSize]).toEqual(["Full", "None", "Angle", 200, 0]);
    expect(geom(a)).toEqual(geom(arrows(reread(d))[0]));
    const g = findById(back.root, String(Number(a.id) - 1))!.el;
    expect(g.attrs).toMatchObject({ SupersededBy: a.id, GraphicType: "Line", ArrowType: "RetroSynthetic", BoundingBox: "260 300 200 300" });
    // The superseded copy is never drawn: one arrow on the page.
    expect(arrows(back)).toHaveLength(1);
    const svg = renderCdx(back)!.svg;
    // Shafts 2.4 pt apart end on the head's arms (an open chevron, no fill).
    expect(svg).toContain('<line x1="200" y1="301.2" x2="258.8" y2="301.2"');
    expect(svg).toContain('<line x1="200" y1="298.8" x2="258.8" y2="298.8"');
    expect(svg).toContain('<path d="M257 303L260 300L257 297" fill="none"');
  });

  test("resonance ↔: a full head at each end, and its superseded graphic", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [260, 300], "resonance")).toBeNull();
    const back = roundTrip(d);
    const [a] = arrows(back);
    expect([a.headEnd, a.tailEnd, a.headType, a.shaftSpacing]).toEqual(["Full", "Full", "Solid", 0]);
    const g = findById(back.root, String(Number(a.id) - 1))!.el;
    expect(g.attrs).toMatchObject({ SupersededBy: a.id, ArrowType: "Resonance" });
  });

  test("equilibrium and reaction arrows are written exactly as before (byte-identical)", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [300, 300])).toBeNull();
    expect(addArrow(d, [200, 340], [300, 340], "equilibrium")).toBeNull();
    const out = writeCdxml(d.root);
    expect(out).toContain('<arrow id="36" Head3D="300 300 0" Tail3D="200 300 0" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250" ArrowheadHead="Full"/>');
    expect(out).toContain('<arrow id="37" Head3D="300 340 0" Tail3D="200 340 0" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250" ArrowheadHead="HalfLeft" ArrowheadTail="HalfLeft" ArrowShaftSpacing="300"/>');
    expect(out).not.toContain("SupersededBy");
  });
});

describe("ChemDraw's conventions, as measured", () => {
  const page = (inner: string): CdxDoc =>
    open(`<CDXML BondLength="30" LineWidth="1"><page id="1">${inner}</page></CDXML>`);
  test("a half head's barb: HalfLeft above a left-to-right shaft, HalfRight below (ChemDraw 23.1 boxes 20801 / 20802)", () => {
    const d = page(
      '<arrow id="1" ArrowheadType="Solid" ArrowheadHead="HalfLeft" HeadSize="2250" ArrowheadCenterSize="1969" ArrowheadWidth="563" Head3D="264.75 199.5 0" Tail3D="204.75 199.5 0"/>' +
        '<arrow id="2" ArrowheadType="Solid" ArrowheadHead="HalfRight" HeadSize="2250" ArrowheadCenterSize="1969" ArrowheadWidth="563" Head3D="264.75 240 0" Tail3D="204.75 240 0"/>',
    );
    // ChemDraw's own boxes: 193.27–200.1 (barb above the shaft at 199.5) and 239.4–245.63 (barb below 240). The barb
    // point: 22.5 pt back from the tip (HeadSize 2250 × LineWidth 1), 5.63 pt off the shaft (ArrowheadWidth 563).
    const svg = renderCdx(d)!.svg;
    expect(svg).toContain('<path d="M264.75 199.5L242.25 193.87L245.06 199.5Z"');
    expect(svg).toContain('<path d="M264.75 240L242.25 245.63L245.06 240Z"');
  });
  test("a straight arrow carries an ellipse too (as ChemDraw writes every arrow): with no AngularSize it stays straight", () => {
    const d = page('<arrow id="1" ArrowheadHead="Full" Head3D="255.75 111.75 0" Tail3D="195.75 111.75 0" Center3D="312.38 169.13 0" MajorAxisEnd3D="372.38 169.13 0" MinorAxisEnd3D="312.38 229.13 0"/>');
    expect(arcOf(arrows(d)[0])).toBeNull();
    expect(renderCdx(d)!.svg).toContain("<line x1=");
  });
  test("AngularSize positive turns anticlockwise on the page: from the left of the circle, down and round to the right", () => {
    const d = page('<arrow id="1" ArrowheadHead="Full" Head3D="10 0 0" Tail3D="0 0 0" Center3D="5 0 0" MajorAxisEnd3D="10 0 0" MinorAxisEnd3D="5 5 0" AngularSize="180"/>');
    const tr = arrowTrace(arrows(d)[0], 2);
    expect(tr[1][0]).toBeCloseTo(5, 6);
    expect(tr[1][1]).toBeCloseTo(5, 6); // y down: below
    const neg = page('<arrow id="1" ArrowheadHead="Full" Head3D="10 0 0" Tail3D="0 0 0" Center3D="5 0 0" MajorAxisEnd3D="10 0 0" MinorAxisEnd3D="5 5 0" AngularSize="-180"/>');
    expect(arrowTrace(arrows(neg)[0], 2)[1][1]).toBeCloseTo(-5, 6);
  });
  test.each([
    ["FullHead", "2250", "Full", "None", "Solid"],
    ["HalfHead", "2250", "HalfLeft", "None", "Solid"],
    ["HalfHead", "-2250", "HalfRight", "None", "Solid"],
    ["Resonance", "2250", "Full", "Full", "Solid"],
    ["RetroSynthetic", "600", "Full", "None", "Angle"],
    ["Equilibrium", "1000", "HalfLeft", "HalfLeft", "Solid"],
    ["Hollow", "1000", "Full", "None", "Hollow"],
  ])("an old-form <graphic> line, ArrowType %s, HeadSize %s, reads as its arrow (BoundingBox: head, then tail)", (type, hs, head, tail, headType) => {
    const d = page(`<graphic id="5" BoundingBox="255.75 111.75 195.75 111.75" GraphicType="Line" ArrowType="${type}" HeadSize="${hs}"/>`);
    const [a] = arrows(d);
    expect([a.head, a.tail, a.headEnd, a.tailEnd, a.headType]).toEqual([[255.75, 111.75], [195.75, 111.75], head, tail, headType]);
    // An arrow, so a page with it is a reaction drawing; and drawn with its head.
    expect(renderCdx(d)!.svg).toMatch(/<path d="M[^"]*255\.75 1\d\d(\.\d+)?/);
  });
  test("an old-form arc graphic with an ArrowType reads as a curved arrow from its end point through AngularSize", () => {
    const d = page('<graphic id="5" BoundingBox="100 100 110 100" GraphicType="Arc" ArrowType="FullHead" AngularSize="90"/>');
    const [a] = arrows(d);
    expect(a.tail).toEqual([110, 100]);
    // As a plain Arc graphic is drawn (the page's angle increasing by AngularSize): down (review R11).
    expect(a.head[0]).toBeCloseTo(100, 6);
    expect(a.head[1]).toBeCloseTo(110, 6);
  });
  test("an old-form line with no head stays a plain line; a superseded copy is never drawn", () => {
    const d = page('<graphic id="5" BoundingBox="0 0 10 0" GraphicType="Line" ArrowType="NoHead"/><graphic id="6" SupersededBy="7" BoundingBox="40 0 30 0" GraphicType="Line" ArrowType="FullHead" HeadSize="1000"/><arrow id="7" ArrowheadHead="Full" Head3D="40 0 0" Tail3D="30 0 0"/>');
    expect(arrows(d).map((a) => a.id)).toEqual(["7"]);
  });
});

describe("tied to atoms", () => {
  test("an arrow tied to atoms follows them when their structure moves (each end with its own atom)", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 2 }));
    const before = arrows(reread(d)).find((a) => a.id === r.arrowId)!;
    // The target's structure moves right 20 pt: the head goes with it, the tail stays, the shape kept (turn + scale).
    moveObjects(d, ["30"], 20, 0);
    const after = arrows(reread(d)).find((a) => a.id === r.arrowId)!;
    // The tail keeps to its O (the shape turns about it a little), clear of the label as before.
    const fromO = (p: [number, number]): number => Math.hypot(p[0] - 60, p[1] - 100);
    expect(Math.abs(fromO(after.tail) - fromO(before.tail))).toBeLessThan(fromO(before.tail) * 0.3);
    expect(after.head[0]).toBeGreaterThan(before.head[0] + 15);
    expect(Math.sign(after.angularSize)).toBe(Math.sign(before.angularSize)); // bowed the same way
    expect(after.el.attrs.ArrowTarget).toBe("31");
    // Both structures move together: the arrow shifts with them, exactly.
    moveObjects(d, ["20", "30"], 0, 10);
    const both = arrows(reread(d)).find((a) => a.id === r.arrowId)!;
    expect(both.head[1]).toBeCloseTo(after.head[1] + 10, 1);
    expect(both.tail[1]).toBeCloseTo(after.tail[1] + 10, 1);
  });
  test("an arrow moved on its own (its atoms left where they are) is no longer tied to them", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 2 }));
    moveObjects(d, [r.arrowId], 0, 30);
    const el = findById(d.root, r.arrowId)!.el;
    expect([el.attrs.ArrowSource, el.attrs.ArrowTarget]).toEqual([undefined, undefined]);
  });
  test("moved with its source structure only: the tail stays tied, the head is set free", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 2 }));
    moveObjects(d, [r.arrowId, "20"], 0, 30);
    const el = findById(d.root, r.arrowId)!.el;
    expect([el.attrs.ArrowSource, el.attrs.ArrowTarget]).toEqual(["21", undefined]);
  });
  test("after an edit that moves atoms in place (Clean), followAnchors carries the arrow", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { bond: "33" }, { atom: "32" }, { electrons: 2 }));
    const tied = arrowAnchors(d.root);
    const br = findById(d.root, "32")!.el, c = findById(d.root, "31")!.el;
    br.attrs.p = "114.4 110";
    c.attrs.p = "100 110";
    const t = br.children.find((x) => x.name === "t")!;
    t.attrs.BoundingBox = "110.8 105 123.6 115";
    t.attrs.p = "110.8 113.5";
    followAnchors(d.root, tied);
    const a = arrows(reread(d)).find((x) => x.id === r.arrowId)!;
    const was = arrows(open()).length; // no arrows in the source
    expect(was).toBe(0);
    expect(a.head[1]).toBeGreaterThan(100); // moved down 10 with its bond and atom
  });
  test("deleting an atom an arrow is tied to: the arrow stays where it was drawn, untied at that end", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { atom: "21" }, { atom: "32" }, { electrons: 2 }));
    const before = geom(arrows(reread(d)).find((a) => a.id === r.arrowId)!);
    expect(deleteInStructure(d, "32")).toBeNull();
    const a = arrows(reread(d)).find((x) => x.id === r.arrowId)!;
    expect([a.el.attrs.ArrowSource, a.el.attrs.ArrowTarget]).toEqual(["21", undefined]);
    expect([a.head, a.tail]).toEqual([before.head, before.tail]);
  });
  test("deleting a bond an arrow starts from: untied likewise; erasing a ⇒ erases its superseded copy too", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { bond: "33" }, { atom: "32" }, { electrons: 2 }));
    expect(deleteInStructure(d, "33")).toBeNull();
    expect(findById(d.root, r.arrowId)!.el.attrs.ArrowSource).toBeUndefined();
    expect(addArrow(d, [200, 300], [260, 300], "retrosynthetic")).toBeNull();
    const retro = arrows(reread(d)).find((a) => a.headType === "Angle")!;
    deleteObjects(d, [retro.id]);
    expect(writeCdxml(d.root)).not.toContain("RetroSynthetic");
  });
  test("moving a ⇒ moves its superseded copy with it", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [260, 300], "retrosynthetic")).toBeNull();
    const a = arrows(reread(d))[0];
    moveObjects(d, [a.id], 5, 5);
    expect(findById(d.root, String(Number(a.id) - 1))!.el.attrs.BoundingBox).toBe("265 305 205 305");
  });
});

describe("refusals and guards", () => {
  test("a zero-length drag does not make an arrow", () => {
    const d = open();
    const r = addCurvedArrow(d, { at: [200, 300] }, { at: [200, 300] }, { electrons: 2 });
    expect(r).toEqual({ ok: false, reason: "drag further: the arrow's two ends are in the same place" });
    expect(addArrow(d, [200, 300], [200, 300], "retrosynthetic")).toBe("drag further: an arrow needs some length");
    expect(arrows(reread(d))).toHaveLength(0);
  });
  test("from an atom to the same atom: refused by name", () => {
    const d = open();
    expect(addCurvedArrow(d, { atom: "21" }, { atom: "21" }, { electrons: 2 })).toEqual({ ok: false, reason: "a curved arrow runs from one atom or bond to another — it starts and ends on the same one here" });
  });
  test("an atom no longer on the page: refused by name", () => {
    expect(planCurved(open(), { atom: "999" }, { atom: "31" }, 1)).toBe("that atom or bond is no longer on the page");
  });
  test("flipping: the bow and a fishhook's barb change sides; twice is where it began", () => {
    const d = open();
    const r = ok(addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 1 }));
    const a0 = { ...findById(d.root, r.arrowId)!.el.attrs };
    expect(flipCurvedArrow(d, r.arrowId)).toBeNull();
    const a1 = { ...findById(d.root, r.arrowId)!.el.attrs };
    expect(Math.sign(Number(a1.AngularSize))).toBe(-Math.sign(Number(a0.AngularSize)));
    expect(a1.ArrowheadHead).toBe(a0.ArrowheadHead === "HalfLeft" ? "HalfRight" : "HalfLeft");
    expect(flipCurvedArrow(d, r.arrowId)).toBeNull();
    expect(findById(d.root, r.arrowId)!.el.attrs).toEqual(a0);
    // An untied arrow is mirrored in the line through its ends: its ends stay put.
    const free = ok(addCurvedArrow(d, { at: [200, 300] }, { at: [240, 300] }, { electrons: 2 }));
    const f0 = { ...findById(d.root, free.arrowId)!.el.attrs };
    expect(flipCurvedArrow(d, free.arrowId)).toBeNull();
    const f1 = findById(d.root, free.arrowId)!.el.attrs;
    expect([f1.Head3D, f1.Tail3D, Number(f1.AngularSize)]).toEqual([f0.Head3D, f0.Tail3D, -Number(f0.AngularSize)]);
    // A straight arrow does not bow.
    expect(addArrow(d, [200, 400], [260, 400])).toBeNull();
    const straight = arrows(reread(d)).find((a) => a.angularSize === 0)!;
    expect(flipCurvedArrow(d, straight.id)).toBe("only a curved arrow bows — this one is straight");
  });
});

describe("more rows", () => {
  test("a file whose AngularSize sign disagrees with its own Head3D: the arc is drawn the way that reaches the head", () => {
    // Tail at the circle's left, head at its top; AngularSize says +90 (anticlockwise: down), the head says up.
    const d = open('<CDXML BondLength="30" LineWidth="1"><page id="1"><arrow id="1" ArrowheadHead="Full" Head3D="5 -5 0" Tail3D="0 0 0" Center3D="5 0 0" MajorAxisEnd3D="10 0 0" MinorAxisEnd3D="5 5 0" AngularSize="90"/></page></CDXML>');
    const tr = arrowTrace(arrows(d)[0], 4);
    expect(tr[4][0]).toBeCloseTo(5, 6);
    expect(tr[4][1]).toBeCloseTo(-5, 6);
  });
  test("an arrow on an empty page (no atoms at all): tail and head in space, nothing tied", () => {
    const d = open(blankPageCdxml());
    const r = ok(addCurvedArrow(d, { at: [100, 100] }, { at: [140, 110] }, { electrons: 1 }));
    const a = arrows(roundTrip(d)).find((x) => x.id === r.arrowId)!;
    expect([a.tail, a.head]).toEqual([[100, 100], [140, 110]]);
    expect([a.el.attrs.ArrowSource, a.el.attrs.ArrowTarget]).toEqual([undefined, undefined]);
    expect(renderCdx(roundTrip(d))).not.toBeNull();
  });
  const guard = /^a page with arrows has no single formula — select one structure/;
  const withCanvas = (d: CdxDoc) => {
    document.body.innerHTML = '<div id="m"></div>';
    const c = createChemCanvas(document.getElementById("m")!, { setStatus: () => undefined });
    c.loadPage(d);
    return c;
  };
  test.each([
    ["curved", (d: CdxDoc) => void addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 2 })],
    ["fishhook", (d: CdxDoc) => void addCurvedArrow(d, { atom: "21" }, { atom: "31" }, { electrons: 1 })],
    ["retrosynthetic", (d: CdxDoc) => void addArrow(d, [200, 300], [260, 300], "retrosynthetic")],
    ["resonance", (d: CdxDoc) => void addArrow(d, [200, 300], [260, 300], "resonance")],
  ])("the 'no single formula' guard fires for a page with a %s arrow (worded for arrows, not a reaction)", (_k, add) => {
    const d = open();
    add(d);
    const r = withCanvas(roundTrip(d)).chemistry();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(guard);
  });
  test("…and for a page whose only arrow is ChemDraw's older form (a <graphic> line with an ArrowType) — it was read as a plain line before", () => {
    const src = SRC.replace("</page>", '<graphic id="90" BoundingBox="260 300 200 300" GraphicType="Line" ArrowType="FullHead" HeadSize="1000"/></page>');
    const r = withCanvas(open(src)).chemistry();
    // A reaction arrow keeps the reaction wording.
    expect(!r.ok && r.reason).toMatch(/^a reaction \(an arrow on the page\) has no single formula/);
  });
});

describe("review round 1 rows", () => {
  const S = (inner: string): CdxDoc =>
    open(`<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" LabelFont="3" LabelSize="10"><fonttable><font id="3" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 540 720">${inner}</page></CDXML>`);
  test("R11: an old-form arc with an ArrowType draws the same arc as the same arc without one", () => {
    const d = S('<graphic id="2" BoundingBox="100 100 120 100" GraphicType="Arc" AngularSize="90"/><graphic id="3" BoundingBox="200 100 220 100" GraphicType="Arc" AngularSize="90" ArrowType="FullHead" HeadSize="1000"/>');
    const svg = renderCdx(d)!.svg;
    // The plain arc: from (120, 100) a quarter turn to (100, 120).
    expect(svg).toContain('<path d="M120 100A20 20 0 0 1 100 120"');
    // The arrow: the same arc 100 pt to the right — from (220, 100), through (214.14, 114.14), to (200, 120).
    const [a] = arrows(d);
    const tr = arrowTrace(a, 2);
    expect(tr[0]).toEqual([220, 100]);
    expect(tr[1][0]).toBeCloseTo(214.14, 2);
    expect(tr[1][1]).toBeCloseTo(114.14, 2);
    expect(tr[2][0]).toBeCloseTo(200, 6);
    expect(tr[2][1]).toBeCloseTo(120, 6);
    expect(svg).toMatch(/<path d="M220 100A20 20 0 0 1 /);
  });

  // N, a benzene ring, then a chain: the arrow from N to the chain's first atom must clear the ring, either way bowed.
  const LONG_OVER = '<fragment id="80"><n id="81" p="40 100" Element="7" NumHydrogens="0"><t p="36.4 103.5" BoundingBox="36.4 95 42.9 105" LabelJustification="Left"><s font="3" size="10" face="96">N</s></t></n></fragment>' +
    '<fragment id="90"><n id="200" p="87.47 107.20"/><n id="201" p="75.00 114.40"/><n id="202" p="62.53 107.20"/><n id="203" p="62.53 92.80"/><n id="204" p="75.00 85.60"/><n id="205" p="87.47 92.80"/>' +
    '<b id="210" B="200" E="201"/><b id="211" B="201" E="202" Order="2"/><b id="212" B="202" E="203"/><b id="213" B="203" E="204" Order="2"/><b id="214" B="204" E="205"/><b id="215" B="205" E="200" Order="2"/></fragment>' +
    '<fragment id="85"><n id="86" p="120 100"/><n id="87" p="134.4 100"/><b id="88" B="86" E="87"/></fragment>';
  test.each([false, true])("R08: an arrow across a benzene ring clears every ring bond (flipped: %s)", (flip) => {
    const d = S(LONG_OVER);
    const r = ok(addCurvedArrow(d, { atom: "81" }, { atom: "86" }, { electrons: 2, flip }));
    const a = arrows(reread(d)).find((x) => x.id === r.arrowId)!;
    const tr = arrowTrace(a, 64);
    const ring: Array<[number, number][]> = [];
    const P: Record<string, [number, number]> = { 200: [87.47, 107.2], 201: [75, 114.4], 202: [62.53, 107.2], 203: [62.53, 92.8], 204: [75, 85.6], 205: [87.47, 92.8] };
    for (const [b, e] of [[200, 201], [201, 202], [202, 203], [203, 204], [204, 205], [205, 200]]) ring.push([P[b], P[e]]);
    const near = Math.min(...tr.map((q) => Math.min(...ring.map((sg) => distToTrace(sg, q)))));
    // The bonds' own half-width plus a clear gap: the shaft never touches the ring.
    expect(near).toBeGreaterThanOrEqual(0.2 * 14.4);
  });

  test("R09: a tail from a ring double bond starts clear of both its lines", () => {
    const d = S('<fragment id="10"><n id="100" p="112.47 107.20"/><n id="101" p="100.00 114.40"/><n id="102" p="87.53 107.20"/><n id="103" p="87.53 92.80"/><n id="104" p="100.00 85.60"/><n id="105" p="112.47 92.80"/>' +
      '<b id="110" B="100" E="101"/><b id="111" B="101" E="102" Order="2"/><b id="112" B="102" E="103"/><b id="113" B="103" E="104" Order="2"/><b id="114" B="104" E="105"/><b id="115" B="105" E="100" Order="2"/></fragment>');
    const r = ok(addCurvedArrow(d, { bond: "111" }, { bond: "114" }, { electrons: 2 }));
    const a = arrows(reread(d)).find((x) => x.id === r.arrowId)!;
    // Bond 111 (100, 114.4)–(87.53, 107.2); its second line 1.728 pt (BondSpacing 12 %) toward the ring's centre (100, 100).
    const pa: [number, number] = [100, 114.4], pb: [number, number] = [87.53, 107.2];
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l = Math.hypot(dx, dy);
    let nx = -dy / l, ny = dx / l;
    if (nx * (100 - pa[0]) + ny * (100 - pa[1]) < 0) (nx = -nx), (ny = -ny);
    const g = 0.12 * 14.4;
    const inner: [number, number][] = [[pa[0] + nx * g, pa[1] + ny * g], [pb[0] + nx * g, pb[1] + ny * g]];
    expect(distToTrace([pa, pb], a.tail)).toBeGreaterThanOrEqual(1.5);
    expect(distToTrace(inner, a.tail)).toBeGreaterThanOrEqual(1.5);
  });

  test("R09b: the same arrow's head keeps 0.15 bond length clear of every bond but its target, and 1.5 pt of every drawn inner line", () => {
    const d = S('<fragment id="10"><n id="100" p="112.47 107.20"/><n id="101" p="100.00 114.40"/><n id="102" p="87.53 107.20"/><n id="103" p="87.53 92.80"/><n id="104" p="100.00 85.60"/><n id="105" p="112.47 92.80"/>' +
      '<b id="110" B="100" E="101"/><b id="111" B="101" E="102" Order="2"/><b id="112" B="102" E="103"/><b id="113" B="103" E="104" Order="2"/><b id="114" B="104" E="105"/><b id="115" B="105" E="100" Order="2"/></fragment>');
    const r = ok(addCurvedArrow(d, { bond: "111" }, { bond: "114" }, { electrons: 2 }));
    const back = reread(d);
    const a = arrows(back).find((x) => x.id === r.arrowId)!;
    // The head as drawn: its tip, its barbs and its middle, read from the rendered path.
    const svg = renderCdx(back)!.svg;
    const m = /<path d="M([\d. ]+)L([\d. ]+)L([\d. ]+)L([\d. ]+)Z" fill="#000"/.exec(svg)!;
    const head = m.slice(1, 5).map((v) => v.trim().split(" ").map(Number) as [number, number]);
    const P: Record<string, [number, number]> = { 100: [112.47, 107.2], 101: [100, 114.4], 102: [87.53, 107.2], 103: [87.53, 92.8], 104: [100, 85.6], 105: [112.47, 92.8] };
    const g = 0.12 * 14.4;
    const lines: Array<[number, number][]> = [];
    const mainLine = new Set<number>();
    for (const [b, e, dbl] of [[100, 101, 0], [101, 102, 1], [102, 103, 0], [103, 104, 1], [105, 100, 1]] as const) {
      const pa = P[b], pb = P[e];
      mainLine.add(lines.length);
      lines.push([pa, pb]);
      if (dbl) {
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l = Math.hypot(dx, dy), n = [(-dy / l) * g, (dx / l) * g];
        lines.push([[pa[0] + n[0], pa[1] + n[1]], [pb[0] + n[0], pb[1] + n[1]]], [[pa[0] - n[0], pa[1] - n[1]], [pb[0] - n[0], pb[1] - n[1]]]);
      }
    }
    expect(a.el.attrs.ArrowTarget).toBe("114");
    // Bond lines: 0.15 bond length; a double bond's other line (the drawn ink beside it): 1.5 pt.
    for (const q of head) lines.forEach((ln, i) => expect(distToTrace(ln, q)).toBeGreaterThanOrEqual(mainLine.has(i) ? 0.15 * 14.4 - 0.05 : 1.5));
  });
});

describe("review round 2 rows", () => {
  const HEAD = '<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" LabelFont="3" LabelSize="10" CaptionFont="3" CaptionSize="10"><fonttable><font id="3" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 540 720">';
  /** A benzene ring of bare carbons centred (100, 100), as the review drew it: atoms 100–105, bonds 110–115 (odd ones double). */
  const RING = (() => {
    let s = '<fragment id="10">';
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      s += `<n id="${100 + i}" p="${(100 + 14.4 * Math.cos(a)).toFixed(2)} ${(100 + 14.4 * Math.sin(a)).toFixed(2)}"/>`;
    }
    for (let i = 0; i < 6; i++) s += `<b id="${110 + i}" B="${100 + i}" E="${100 + ((i + 1) % 6)}"${i % 2 ? ' Order="2"' : ""}/>`;
    return s + "</fragment>";
  })();
  const ring = (): CdxDoc => open(HEAD + RING + "</page></CDXML>");
  const boxDist = (q: number[], b: number[]): number => Math.hypot(Math.max(0, b[0] - q[0], q[0] - b[2]), Math.max(0, b[1] - q[1], q[1] - b[3]));
  /** The drawn head polygon (tip, barbs, notch) of the one curved arrow on the page. */
  const headOf = (d: CdxDoc): Array<[number, number]> => {
    const m = /<path d="M([\d. ]+)L([\d. ]+)L([\d. ]+)L([\d. ]+)Z" fill="#000"/.exec(renderCdx(d)!.svg)!;
    return m.slice(1, 5).map((v) => v.trim().split(" ").map(Number) as [number, number]);
  };
  test.each([
    ["E", 72, 135],
    ["Br", 70, 135],
    ["H", 72, 134],
    ["NO2", 68, 135],
  ])("R2-06: a π bond's arrow to %s⁺ (placed and charged in the editor) keeps 1.5 pt off its charge sign, shaft and head", (label, x, y) => {
    const d = ring();
    const at = ok(addAtomAt(d, [x, y], label));
    expect(setCharge(d, at.nodeId, 1)).toBeNull();
    const d2 = roundTrip(d);
    const r = ok(addCurvedArrow(d2, { bond: "111" }, { atom: at.nodeId }, { electrons: 2 }));
    const back = roundTrip(d2);
    const a = arrows(back).find((z) => z.id === r.arrowId)!;
    const node = back.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.nodes : [])).find((n) => n.id === at.nodeId)!;
    const charge = chargeGlyph(back.style, node).box;
    for (const q of [...arrowTrace(a, 48), ...headOf(back)]) expect(boxDist(q, charge)).toBeGreaterThanOrEqual(1.5);
  });

  /** Along-bond offset of a point from a bond's middle, and its distances to the bond's two drawn lines. */
  const bondFrame = (d: CdxDoc, bondId: string, q: [number, number]) => {
    const f = d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? [it.v] : []))[0];
    const bd = f.bonds.find((b) => b.id === bondId)!;
    const pa = f.nodes.find((n) => n.id === bd.b)!.p, pb = f.nodes.find((n) => n.id === bd.e)!.p;
    const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), u = [(pb[0] - pa[0]) / l, (pb[1] - pa[1]) / l];
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    let n = [-u[1], u[0]];
    if (n[0] * (100 - mid[0]) + n[1] * (100 - mid[1]) < 0) n = [-n[0], -n[1]]; // toward the ring's centre: the inner line
    const g = 0.12 * 14.4;
    const inner: [number, number][] = [[pa[0] + n[0] * g, pa[1] + n[1] * g], [pb[0] + n[0] * g, pb[1] + n[1] * g]];
    const along = Math.abs((q[0] - mid[0]) * u[0] + (q[1] - mid[1]) * u[1]);
    return { along, main: distToTrace([pa as [number, number], pb as [number, number]], q), inner: distToTrace(inner, q), double: bd.order === "2" };
  };
  test.each([
    ["R2-07: ring double bond → the bond across the ring", { bond: "111" }, { bond: "114" }],
    ["R2-07b: ring double bond → an atom across the ring", { bond: "111" }, { atom: "104" }],
    ["R09 again: the same, flipped", { bond: "111" }, { bond: "114" }],
  ] as const)("%s: the tail starts within a quarter bond of the bond's middle, 1.5 pt clear of both drawn lines", (name, from, to) => {
    const d = ring();
    const r = ok(addCurvedArrow(d, from as never, to as never, { electrons: 2, flip: name.includes("flipped") }));
    const a = arrows(reread(d)).find((z) => z.id === r.arrowId)!;
    const f = bondFrame(reread(d), "111", a.tail);
    expect(f.along).toBeLessThanOrEqual(0.25 * 14.4 + 1e-6);
    expect(f.main).toBeGreaterThanOrEqual(1.5);
    expect(f.inner).toBeGreaterThanOrEqual(1.5);
  });
  test("a head on a bond stops 0.8–1.5 pt short of its drawn lines (as a tip stops short of an atom's label)", () => {
    const d = ring();
    const r = ok(addCurvedArrow(d, { bond: "111" }, { bond: "114" }, { electrons: 2 }));
    const back = reread(d);
    const tip = headOf(back)[0];
    const f = bondFrame(back, "114", tip);
    expect(f.along).toBeLessThanOrEqual(0.25 * 14.4 + 1e-6);
    // Bond 114 is single: its one line, half a line width wide.
    const gap = f.main - 0.3;
    expect(gap).toBeGreaterThanOrEqual(0.8);
    expect(gap).toBeLessThanOrEqual(1.5);
    void r;
  });
});
