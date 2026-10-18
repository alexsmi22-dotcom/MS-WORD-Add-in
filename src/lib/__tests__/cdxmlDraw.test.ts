// Drawing on a ChemDraw page (C4): chains, polymer brackets and arrows. Each is written into the
// document itself, read back as ChemDraw would read it, and saved. Documents are written by hand.
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addArrow, addBrackets, addChain, chainLength, chainPoints, findById, writeCdxml } from "../cdxmlEdit";
import { renderCdx } from "../cdxmlRender";

// Propane (11–12–13) beside an empty stretch of page.
const SRC = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="30" LabelSize="10" LabelFont="3" CaptionSize="12" CaptionFont="3">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="126 115"/><n id="13" p="152 100"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/></fragment>
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
const frag = (d: CdxDoc, id: string) => {
  for (const o of d.objects) for (const it of o.items) if (it.kind === "fragment" && it.v.id === id) return it.v;
  throw new Error("no fragment " + id);
};
const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("chains", () => {
  test("from an atom: n bonds, each a bond length, 120° apart, zig-zagging along the drag", () => {
    const d = open();
    expect(addChain(d, { nodeId: "13" }, [300, 100], 4)).toBeNull();
    const f = frag(reread(d), "10");
    expect(f.nodes).toHaveLength(7);
    expect(f.bonds).toHaveLength(6);
    const pts = ["13", ...f.nodes.slice(3).map((n) => n.id)].map((id) => f.nodes.find((n) => n.id === id)!.p);
    for (let i = 1; i < pts.length; i++) expect(dist(pts[i], pts[i - 1])).toBeCloseTo(30, 1);
    for (let i = 2; i < pts.length; i++) {
      const a = [pts[i - 2][0] - pts[i - 1][0], pts[i - 2][1] - pts[i - 1][1]], b = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      expect((Math.acos((a[0] * b[0] + a[1] * b[1]) / 900) * 180) / Math.PI).toBeCloseTo(120, 0);
    }
    // It runs along the drag: the end is to the right, the zig-zag stays within half a bond of the line.
    expect(pts[4][0]).toBeGreaterThan(pts[0][0] + 90);
    for (const p of pts) expect(Math.abs(p[1] - 100)).toBeLessThan(16);
  });
  test("from empty space: a structure of its own (n + 1 atoms)", () => {
    const d = open();
    expect(addChain(d, { at: [300, 300] }, [300, 400], 3)).toBeNull();
    const r = reread(d);
    const f = r.objects.flatMap((o) => o.items).filter((it) => it.kind === "fragment");
    expect(f).toHaveLength(2);
    expect(f[1].kind === "fragment" && [f[1].v.nodes.length, f[1].v.bonds.length]).toEqual([4, 3]);
  });
  test("the drag's length sets the bond count (L · cos 30° each), 1 to 50", () => {
    const d = open();
    expect(chainLength(d, 0)).toBe(1);
    expect(chainLength(d, 26 * 3)).toBe(3);
    expect(chainLength(d, 1e9)).toBe(50);
    expect(chainLength(d, NaN)).toBe(1);
    expect(chainPoints(d, [0, 0], [100, 0], 2)).toHaveLength(2);
  });
  test("refused by name: a carbon with four bonds, no direction, a bad count, a gone atom", () => {
    const d = open(SRC.replace('<b id="15" B="12" E="13"/>', '<b id="15" B="12" E="13"/><n id="16" p="126 145"/><n id="17" p="110 140"/><b id="18" B="12" E="16"/><b id="19" B="12" E="17"/>'));
    expect(addChain(d, { nodeId: "12" }, [126, 200], 2)).toBe("that C has no bond to spare");
    expect(addChain(d, { nodeId: "13" }, [152, 100], 2)).toBe("drag away from the atom to show which way the chain goes");
    expect(addChain(d, { nodeId: "13" }, [300, 100], 0)).toBe("a chain is 1 to 50 bonds long");
    expect(addChain(d, { nodeId: "99" }, [300, 100], 2)).toBe("that atom is no longer in the document");
  });
  test("a labelled atom's hydrogens are counted again (OH with one more bond is O)", () => {
    const d = open(SRC.replace('<n id="13" p="152 100"/>', '<n id="13" p="152 100" Element="8" NumHydrogens="1"><t p="149 103.5"><s font="3" size="10" face="96">OH</s></t></n>'));
    expect(addChain(d, { nodeId: "13" }, [300, 100], 1)).toBeNull();
    const txt = findById(d.root, "13")!.el.children.find((c) => c.name === "t")!;
    expect(txt.children.map((s) => s.text).join("")).toBe("O");
  });
});

describe("polymer brackets", () => {
  // Butane 11–12–13–14 in a row; the box round 12–13 cuts bonds 21 (left) and 23 (right).
  const ROW = `<CDXML BondLength="30" CaptionSize="12" CaptionFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="130 100"/><n id="13" p="160 100"/><n id="14" p="190 100"/><b id="21" B="11" E="12"/><b id="22" B="12" E="13"/><b id="23" B="13" E="14"/></fragment>
</page></CDXML>`;
  test("square brackets on the box's sides, the label at the right foot, a repeat unit naming its atoms and crossing bonds", () => {
    const d = open(ROW);
    expect(addBrackets(d, [115, 85, 175, 115], "n")).toBeNull();
    const r = reread(d);
    expect(r.brackets).toHaveLength(1);
    const b = r.brackets[0];
    expect(b.usage).toBe("SRU");
    expect(b.objectIds).toEqual(["12", "13"]);
    expect(b.attachments.map((a) => [a.bondId, a.innerAtomId])).toEqual([["21", "12"], ["23", "13"]]);
    const graphics = r.objects.flatMap((o) => o.items).filter((it) => it.kind === "graphic");
    expect(graphics.map((g) => g.kind === "graphic" && [g.v.kind, g.v.p1[0]])).toEqual([["Bracket", 115], ["Bracket", 175]]);
    // Each crossing bond's attachment names the bracket it crosses.
    const left = graphics[0].kind === "graphic" ? graphics[0].v.id : "";
    expect(b.attachments[0].graphicId).toBe(left);
    const svg = renderCdx(r)!.svg;
    expect(svg).toContain(">n</tspan>");
    // Saved and read again it is the same repeat unit.
    const again = readCdxml(writeCdxml(d.root));
    expect(again.ok && again.doc.brackets[0].attachments).toHaveLength(2);
  });
  test("a number label is the repeat count too", () => {
    const d = open(ROW);
    expect(addBrackets(d, [115, 85, 175, 115], "3")).toBeNull();
    expect(reread(d).brackets[0].el.attrs.RepeatCount).toBe("3");
  });
  test("refused by name: nothing inside, nothing leaving it, a tiny box, a bad label", () => {
    const d = open(ROW);
    expect(addBrackets(d, [300, 300, 340, 340])).toBe("no atom is inside the box — drag it round the repeat unit");
    expect(addBrackets(d, [80, 80, 210, 120])).toBe("no bond leaves the box — a repeat unit is bonded to the chain on each side");
    expect(addBrackets(d, [115, 85, 116, 86])).toBe("drag a box round the repeat unit");
    expect(addBrackets(d, [115, 85, 175, 115], "  ")).toBe("the bracket's label must be 1 to 20 characters");
    expect(addBrackets(d, [115, 85, 175, 115], "n\u0007")).toBe("the bracket's label must be 1 to 20 characters");
    expect(reread(d).brackets).toHaveLength(0);
  });
});

describe("arrows", () => {
  test("a reaction arrow: tail and head where dragged, a full solid head", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [300, 300])).toBeNull();
    const a = reread(d).objects.flatMap((o) => o.items).find((it) => it.kind === "arrow");
    expect(a?.kind === "arrow" && [a.v.tail, a.v.head]).toEqual([[200, 300], [300, 300]]);
    expect(a?.kind === "arrow" && a.v.el.attrs.ArrowheadHead).toBe("Full");
    // The head (10 pt long, 2.5 pt each side at a 1 pt line: ChemDraw's 1000 / 250 hundredths) ends at the drop point.
    expect(renderCdx(reread(d))!.svg).toContain('<path d="M300 300L290 302.5L291.25 300L290 297.5Z"');
  });
  test("an equilibrium arrow: half heads at both ends, two shafts", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [300, 300], "equilibrium")).toBeNull();
    const el = reread(d).objects.flatMap((o) => o.items).find((it) => it.kind === "arrow");
    expect(el?.kind === "arrow" && [el.v.el.attrs.ArrowheadHead, el.v.el.attrs.ArrowheadTail]).toEqual(["HalfLeft", "HalfLeft"]);
    const svg = renderCdx(reread(d))!.svg;
    // Two shafts, one above the other, between the arrow's ends.
    const shafts = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].filter((m) => Number(m[2]) > 250);
    expect(shafts).toHaveLength(2);
    expect(new Set(shafts.map((m) => m[2])).size).toBe(2);
  });
  test("refused by name: too short, or not on the page", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [205, 300])).toBe("drag further: an arrow needs some length");
    expect(addArrow(d, [NaN, 300], [205, 300])).toBe("that is not a place on the page");
  });
});
