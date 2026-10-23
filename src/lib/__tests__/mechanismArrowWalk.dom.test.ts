/**
 * @jest-environment jsdom
 */
// The mechanism-arrow walk, driven as a chemist drives the canvas: structures on the page, then curved arrows, fishhooks,
// ⇒ and ↔ dragged with the Arrow tool. Each scene is the inserted figure (render(), the insert path) and must equal what
// the canvas shows. With MECH_WALK_OUT set, each scene's inserted SVG is also written there, to be rasterised and looked at.
import { TextDecoder as NodeTextDecoder } from "util";
import { writeFileSync } from "fs";
import { join } from "path";
import { createChemCanvas, ChemCanvas } from "../../taskpane/chemCanvas";
import { readCdxml, CdxDoc } from "../cdxml";
import { arrowTrace } from "../cdxArrows";
import { addAtomAt, addBondToward, addRingAt, curvedArrowElement, setAtomLabel, setCharge, writeCdxml, blankPageCdxml } from "../cdxmlEdit";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

function setup() {
  document.body.innerHTML = '<div id="mount"></div>';
  const status: Array<[string, string]> = [];
  const c: ChemCanvas = createChemCanvas(document.getElementById("mount")!, { setStatus: (m, k) => void status.push([m, k ?? ""]) });
  const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
  const at = (x: number, y: number): { clientX: number; clientY: number } => {
    const svg = surface.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { clientX: x - vx, clientY: y - vy };
  };
  const drag = (from: [number, number], to: [number, number], shift = false): void => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at(...from), button: 0, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointermove", { ...at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), buttons: 1, shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointermove", { ...at(...to), buttons: 1, shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at(...to), shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at(...to), shiftKey: shift, bubbles: true }));
  };
  const click = (x: number, y: number): void => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at(x, y), button: 0, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at(x, y), bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at(x, y), bubbles: true }));
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-chem-tool="${t}"]`)!.click();
  const arrowKind = (k: string): void => {
    tool("arrow");
    const sel = document.querySelector<HTMLSelectElement>("[data-chem-arrow]")!;
    sel.value = k;
    sel.dispatchEvent(new Event("change"));
  };
  const last = (): [string, string] => status[status.length - 1];
  const arrows = () => c.page().objects.flatMap((o) => o.items).filter((it) => it.kind === "arrow").map((it) => (it.kind === "arrow" ? it.v : null)!);
  return { c, surface, drag, click, tool, arrowKind, last, arrows, status };
}

function page(build: (d: CdxDoc) => void): CdxDoc {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  build(r.doc);
  const again = readCdxml(writeCdxml(r.doc.root));
  if (!again.ok) throw new Error(again.reason);
  return again.doc;
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const pos = (d: CdxDoc, id: string): [number, number] => {
  for (const o of d.objects) for (const it of o.items) if (it.kind === "fragment") for (const n of it.v.nodes) if (n.id === id) return n.p as [number, number];
  throw new Error("no atom " + id);
};
const OUT = process.env.MECH_WALK_OUT;
const save = (name: string, c: ChemCanvas): string => {
  const r = c.render(false)!;
  if (OUT) writeFileSync(join(OUT, `${name}.svg`), r.svg);
  return r.svg;
};
/** The page as the canvas shows it equals the inserted figure: the same primitives, in the same order. */
const sameInk = (t: ReturnType<typeof setup>): void => {
  const shown = t.surface.querySelector("svg")!.innerHTML.replace(/<rect[^>]*\/?>(<\/rect>)?/g, "").replace(/<g id="chem-(sel|ghost)"[\s\S]*$/, "");
  const inserted = t.c.render(false)!.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<rect[^>]*\/>/g, "");
  const norm = (x: string): string => x.replace(/\s*\/>/g, "/>").replace(/<(\w+)([^>]*)><\/\1>/g, "<$1$2/>");
  expect(norm(shown)).toBe(norm(inserted));
};

// Curved arrows and fishhooks are not offered in the menu this release (chemCanvas.ts CURVED_ARROWS_OFFERED);
// these walks drive them through the menu, so they wait for it. The geometry is pinned in mechanismArrowCases.
describe.skip("walk (a): SN2 at CH3Br with hydroxide", () => {
  test("O lone pair → C, C–Br bond → Br: two curved arrows tied to their atoms and bond", () => {
    const ids: Record<string, string> = {};
    const d = page((doc) => {
      const o = ok(addAtomAt(doc, [60, 100], "O"));
      ids.o = o.nodeId;
      setCharge(doc, o.nodeId, -1);
      const cx = ok(addAtomAt(doc, [100, 100], "C"));
      ids.c = cx.nodeId;
      const br = ok(addBondToward(doc, cx.nodeId, [130, 100], null));
      ids.br = br.nodeId;
      ids.cbr = br.bondId;
      setAtomLabel(doc, br.nodeId, "Br");
      setAtomLabel(doc, cx.nodeId, "CH3");
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("curved");
    // From the O's label to the carbon.
    t.drag(pos(d, ids.o), pos(d, ids.c));
    expect(t.last()[1]).toBe("success");
    const pc = pos(t.c.page(), ids.c), pb = pos(t.c.page(), ids.br);
    t.drag([(pc[0] + pb[0]) / 2, (pc[1] + pb[1]) / 2], pb);
    expect(t.last()[1]).toBe("success");
    const [a1, a2] = t.arrows();
    expect([a1.el.attrs.ArrowSource, a1.el.attrs.ArrowTarget, a1.headEnd]).toEqual([ids.o, ids.c, "Full"]);
    expect([a2.el.attrs.ArrowSource, a2.el.attrs.ArrowTarget]).toEqual([ids.cbr, ids.br]);
    expect(t.c.chemistry().ok).toBe(false);
    sameInk(t);
    save("a-sn2", t.c);
  });
});

describe.skip("walk (b): homolysis with two fishhooks", () => {
  test("Br–Br: a fishhook from the bond to each bromine, barbs outside their curves", () => {
    const ids: Record<string, string> = {};
    const d = page((doc) => {
      const a = ok(addAtomAt(doc, [100, 100], "C"));
      const b = ok(addBondToward(doc, a.nodeId, [130, 100], null));
      setAtomLabel(doc, a.nodeId, "Br");
      setAtomLabel(doc, b.nodeId, "Br");
      ids.a = a.nodeId;
      ids.b = b.nodeId;
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("fishhook");
    const pa = pos(d, ids.a), pb = pos(d, ids.b), mid: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    t.drag(mid, pa);
    t.drag(mid, pb);
    if (t.arrows().length < 2) throw new Error(JSON.stringify(t.status.slice(-3)));
    const [f1, f2] = t.arrows();
    expect([f1.headEnd, f2.headEnd].sort()).toEqual(["HalfLeft", "HalfRight"].sort());
    sameInk(t);
    save("b-homolysis", t.c);
  });
});

describe("walk (c): a retrosynthesis ⇒", () => {
  test("a ring on each side, ⇒ between", () => {
    const d = page((doc) => {
      addRingAt(doc, [60, 100], "benzene");
      addRingAt(doc, [160, 100], "cyclohexane");
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("retrosynthetic");
    t.drag([88, 100], [130, 100]);
    expect(t.last()).toEqual(["Retrosynthetic arrow drawn.", "success"]);
    sameInk(t);
    save("c-retro", t.c);
  });
});

describe("walk (d): a resonance pair ↔", () => {
  test("an enolate's two forms, ↔ between", () => {
    const d = page((doc) => {
      // ⁻O–C=C on the left, O=C–C⁻ on the right.
      for (const [x0, neg] of [[40, "O"], [140, "C"]] as const) {
        const c1 = ok(addAtomAt(doc, [x0 + 12.47, 100], "C"));
        const o = ok(addBondToward(doc, c1.nodeId, [x0, 93], null));
        const c2 = ok(addBondToward(doc, c1.nodeId, [x0 + 30, 93], null));
        const me = ok(addBondToward(doc, c1.nodeId, [x0 + 12.47, 130], null));
        setAtomLabel(doc, c1.nodeId, "C");
        setAtomLabel(doc, o.nodeId, "O");
        void me;
        const dbl = neg === "O" ? c2.bondId : o.bondId;
        const b = doc.root.children.find((x) => x.name === "page")!;
        const walkSet = (n: typeof b): void => {
          if (n.attrs.id === dbl) n.attrs.Order = "2";
          n.children.forEach(walkSet);
        };
        walkSet(b);
        setCharge(doc, neg === "O" ? o.nodeId : c2.nodeId, -1);
        setAtomLabel(doc, o.nodeId, "O");
      }
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("resonance");
    t.drag([88, 100], [128, 100]);
    expect(t.last()).toEqual(["Resonance arrow drawn.", "success"]);
    sameInk(t);
    save("d-resonance", t.c);
  });
});

describe("the arrow tool, hands-on", () => {
  test("the Arrow menu offers reaction, equilibrium, retrosynthetic and resonance arrows, not curved ones yet", () => {
    const t = setup();
    const kinds = Array.from(document.querySelectorAll<HTMLSelectElement>("[data-chem-arrow]")[0].options).map((o) => o.value);
    expect(kinds).toEqual(["reaction", "equilibrium", "retrosynthetic", "resonance"]);
    void t;
  });
  test.skip("a click (no drag) adds nothing; a click on a curved arrow flips it; a moved structure takes its arrow along", () => {
    const ids: Record<string, string> = {};
    const d = page((doc) => {
      const o = ok(addAtomAt(doc, [60, 100], "O"));
      ids.o = o.nodeId;
      setCharge(doc, o.nodeId, -1);
      const c1 = ok(addAtomAt(doc, [100, 100], "C"));
      const c2 = ok(addBondToward(doc, c1.nodeId, [130, 100], null));
      setAtomLabel(doc, c1.nodeId, "C");
      ids.c = c1.nodeId;
      ids.br = c2.nodeId;
      setAtomLabel(doc, c2.nodeId, "Br");
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("curved");
    const objects = t.c.page().objects.length;
    t.click(150, 150); // empty paper
    expect(t.c.page().objects.length).toBe(objects);
    expect(t.last()[1]).toBe("error");
    // A tiny drag is a click: no arrow.
    t.drag([150, 150], [151, 150]);
    expect(t.arrows()).toHaveLength(0);
    t.drag(pos(d, ids.o), pos(d, ids.c));
    const a0 = t.arrows()[0];
    // A click on the arrow's line bows it the other way.
    const mid = (() => {
      const g = a0;
      const tr = [g.tail, g.head];
      return [(tr[0][0] + tr[1][0]) / 2, (tr[0][1] + tr[1][1]) / 2] as [number, number];
    })();
    // The arc's top: the point on it farthest from the chord.
    const tr = arrowTrace(a0, 16);
    const top = tr.reduce((b, p) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) > Math.hypot(b[0] - mid[0], b[1] - mid[1]) ? p : b));
    t.click(top[0], top[1]);
    expect(t.last()[0]).toMatch(/^Curved arrow flipped/);
    expect(Math.sign(t.arrows()[0].angularSize)).toBe(-Math.sign(a0.angularSize));
    // Select the CH2Br structure and drag it 25 pt right: the arrow's head follows the carbon.
    t.tool("select");
    const pc = pos(t.c.page(), ids.c);
    t.click(pc[0], pc[1]);
    t.drag(pc, [pc[0] + 25, pc[1] + 8]);
    const a2 = t.arrows()[0];
    expect(a2.el.attrs.ArrowTarget).toBe(ids.c);
    expect(a2.head[0]).toBeGreaterThan(a0.head[0] + 15);
    sameInk(t);
    save("e-moved-and-flipped", t.c);
  });

  test("regression walk: a CDXML written here (structures + arrows) opens, an atom is edited, it inserts; valence still blocks", () => {
    // Written by hand: propan-2-ol beside a curved arrow and a ⇒ (ChemDraw's form, superseded copy included).
    const src = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="10">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="112.47 92.8"/><n id="13" p="124.94 100"/><n id="14" p="112.47 78.4"/><b id="15" B="11" E="12"/><b id="16" B="12" E="13"/><b id="17" B="12" E="14"/></fragment>
<arrow id="20" FillType="None" ArrowheadType="Solid" ArrowheadHead="Full" HeadSize="700" ArrowheadCenterSize="610" ArrowheadWidth="230" Head3D="124 70 0" Tail3D="104 72 0" Center3D="114.5 79 0" MajorAxisEnd3D="127.12 79 0" MinorAxisEnd3D="114.5 91.62 0" AngularSize="-110" ArrowSource="11" ArrowTarget="14"/>
<graphic id="21" SupersededBy="22" BoundingBox="190 90 150 90" GraphicType="Line" ArrowType="RetroSynthetic" HeadSize="500"/>
<arrow id="22" FillType="None" ArrowheadType="Angle" ArrowheadHead="Full" HeadSize="500" ArrowheadCenterSize="500" ArrowheadWidth="500" ArrowShaftSpacing="200" Head3D="190 90 0" Tail3D="150 90 0"/>
</page></CDXML>`;
    const r = readCdxml(src);
    if (!r.ok) throw new Error(r.reason);
    const t = setup();
    t.c.loadPage(r.doc);
    expect(t.arrows()).toHaveLength(2);
    // Edit an atom: the top carbon becomes O (propan-2-ol).
    document.querySelector<HTMLButtonElement>('[data-chem-element="O"]')!.click();
    t.click(112.47, 78.4);
    const o = t.c.page().objects.flatMap((x) => x.items).find((it) => it.kind === "fragment");
    expect(o && o.kind === "fragment" && o.v.nodes.find((n) => n.id === "14")!.element).toBe(8);
    // The page is a mechanism drawing: no single formula (the guard), but one structure selected reads.
    expect(t.c.chemistry()).toMatchObject({ ok: false, reason: expect.stringMatching(/^a page with arrows has no single formula/) });
    // Valence still blocks: the central carbon (3 bonds) takes one more, then refuses a fifth.
    t.tool("bond");
    t.click(112.47, 92.8);
    expect(t.last()[1]).not.toBe("error");
    t.click(112.47, 92.8);
    expect(t.last()).toEqual(["That C has no bond to spare.", "error"]);
    // Inserts: one SVG root, the arrows in it.
    const svg = t.c.render(false)!.svg;
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg).toContain(" A");
    sameInk(t);
    save("f-opened-edited", t.c);
  });

  test("a large page stays quick: 40 structures and 40 curved arrows draw in well under a second", () => {
    const d = page((doc) => {
      for (let i = 0; i < 40; i++) addRingAt(doc, [40 + (i % 8) * 60, 60 + Math.floor(i / 8) * 60], "benzene");
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("curved");
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      const x = 40 + (i % 8) * 60, y = 60 + Math.floor(i / 8) * 60;
      t.drag([x + 14, y - 30], [x + 50, y - 30]);
    }
    const drew = Date.now() - t0;
    // The preview while dragging (every pointer move) is one curvedArrowElement: well under a frame on this page.
    const t2 = Date.now();
    for (let i = 0; i < 50; i++) curvedArrowElement(t.c.page(), { at: [30, 20] }, { at: [80 + i, 25] }, { electrons: 2 });
    const perMove = (Date.now() - t2) / 50;
    if (OUT) writeFileSync(join(OUT, "ghost-ms.txt"), `${perMove}`);
    expect(perMove).toBeLessThan(8);
    expect(t.arrows()).toHaveLength(40);
    const t1 = Date.now();
    t.c.render(false);
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(drew / 40).toBeLessThan(250);
  });
});

describe.skip("short hops: measured against the labels' ink boxes", () => {
  type B4 = [number, number, number, number];
  const boxes = (d: CdxDoc): B4[] =>
    d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.nodes.flatMap((n) => (n.label?.box && n.label.runs.some((r) => r.text.trim()) ? [n.label.box as B4] : [])) : []));
  const boxOf = (d: CdxDoc, id: string): B4 => {
    for (const o of d.objects) for (const it of o.items) if (it.kind === "fragment") for (const n of it.v.nodes) if (n.id === id) return n.label!.box as B4;
    throw new Error("no label " + id);
  };
  const dist = (p: number[], b: B4): number => Math.hypot(Math.max(0, b[0] - p[0], p[0] - b[2]), Math.max(0, b[1] - p[1], p[1] - b[3]));
  const aspect = (a: ReturnType<ReturnType<typeof setup>["arrows"]>[number]): number => {
    const tr = arrowTrace(a, 64);
    const xs = tr.map((q) => q[0]), ys = tr.map((q) => q[1]);
    return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs));
  };
  const check = (t: ReturnType<typeof setup>, a: ReturnType<ReturnType<typeof setup>["arrows"]>[number], target: string): void => {
    const d = t.c.page();
    for (const b of boxes(d)) expect(dist(a.tail, b)).toBeGreaterThanOrEqual(1.5);
    expect(aspect(a)).toBeGreaterThanOrEqual(0.45);
    expect(aspect(a)).toBeLessThanOrEqual(0.75);
    const tip = dist(a.head, boxOf(d, target));
    expect(tip).toBeGreaterThanOrEqual(0.5);
    expect(tip).toBeLessThanOrEqual(2);
  };
  test("CH3–Br: the C–Br bond to its Br", () => {
    const ids: Record<string, string> = {};
    const d = page((doc) => {
      const cx = ok(addAtomAt(doc, [100, 100], "C"));
      const br = ok(addBondToward(doc, cx.nodeId, [130, 100], null));
      ids.br = br.nodeId;
      setAtomLabel(doc, br.nodeId, "Br");
      setAtomLabel(doc, cx.nodeId, "CH3");
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("curved");
    t.drag([107.2, 100], pos(d, ids.br));
    const [a] = t.arrows();
    expect(a.el.attrs.ArrowTarget).toBe(ids.br);
    check(t, a, ids.br);
  });
  test("Br–Br homolysis: two fishhooks, mirror images, tails at least 2 pt apart", () => {
    const ids: Record<string, string> = {};
    const d = page((doc) => {
      const a = ok(addAtomAt(doc, [100, 100], "C"));
      const b = ok(addBondToward(doc, a.nodeId, [130, 100], null));
      setAtomLabel(doc, a.nodeId, "Br");
      setAtomLabel(doc, b.nodeId, "Br");
      ids.a = a.nodeId;
      ids.b = b.nodeId;
    });
    const t = setup();
    t.c.loadPage(d);
    t.arrowKind("fishhook");
    t.drag([107.2, 100], pos(d, ids.a));
    t.drag([107.2, 100], pos(d, ids.b));
    const [f1, f2] = t.arrows();
    check(t, f1, ids.a);
    check(t, f2, ids.b);
    expect(Math.hypot(f1.tail[0] - f2.tail[0], f1.tail[1] - f2.tail[1])).toBeGreaterThanOrEqual(2);
    // Mirror images about the bond's middle (x 107.2).
    expect(f1.tail[0] + f2.tail[0]).toBeCloseTo(2 * 107.2, 1);
    expect(f1.head[0] + f2.head[0]).toBeCloseTo(2 * 107.2, 1);
    expect(f1.head[1]).toBeCloseTo(f2.head[1], 2);
    expect(aspect(f1)).toBeCloseTo(aspect(f2), 3);
  });
});
