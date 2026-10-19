// Editing ChemDraw CDXML: every edit changes the tree, the model is read again from it, and the
// saved file holds the edit and everything else untouched. Documents are written by hand here.
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { writeCdxml, cloneTree, moveObjects, deleteObjects, setText, setAtomLabel, setBond, addBondFrom, deleteInStructure, setCharge, namesTiedTo, findById, addRingAt, addRingOnBond, addRingAtAtom } from "../cdxmlEdit";

const SRC = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="30" LabelSize="10" LabelFont="3" LabelFace="96" CaptionSize="12" SomethingNew="kept">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="126 115"/><n id="13" p="152 100"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/><futurething id="16" x="1"/></fragment>
<graphic id="20" BoundingBox="113 98 113 118" GraphicType="Bracket" BracketType="Square"/>
<bracketedgroup id="21" BracketedObjectIDs="12"><bracketattachment id="22" GraphicID="20"><crossingbond id="23" BondID="14" InnerAtomID="12"/></bracketattachment></bracketedgroup>
<t id="30" p="100 160"><s font="3" size="12" face="1">propane</s></t>
<chemicalproperty id="31" ChemicalPropertyDisplayID="30" ChemicalPropertyType="1" BasisObjects="10"/>
<arrow id="40" Head3D="300 160 0" Tail3D="200 160 0" ArrowheadHead="Full"/>
<scheme id="50"><step id="51" ReactionStepReactants="10" ReactionStepArrows="40"/></scheme>
</page></CDXML>`;

const open = (): CdxDoc => {
  const r = readCdxml(SRC);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const attr = (d: CdxDoc, id: string, k: string): string | undefined => findById(d.root, id)?.el.attrs[k];

describe("saving", () => {
  test("a file read and written back reads the same, and keeps what this release does not understand", () => {
    const d = open();
    const out = writeCdxml(d.root);
    expect(out).toContain('SomethingNew="kept"');
    expect(out).toContain('<futurething id="16" x="1"/>');
    const again = readCdxml(out);
    expect(again.ok && again.doc.objects.length).toBe(d.objects.length);
    expect(again.ok && writeCdxml(again.doc.root)).toBe(out);
  });
  test("text is escaped", () => {
    const d = open();
    setText(d, "30", 'A<B & "C"');
    expect(writeCdxml(d.root)).toContain(">A&lt;B &amp; \"C\"</s>");
  });
  test("cloneTree is a deep copy (undo)", () => {
    const d = open();
    const copy = cloneTree(d.root);
    moveObjects(d, ["40"], 10, 0);
    expect(findById(copy, "40")!.el.attrs.Head3D).toBe("300 160 0");
  });
});

describe("moving and deleting", () => {
  test("moving moves every position inside: atoms, boxes, arrow ends (z stays)", () => {
    const d = open();
    moveObjects(d, ["10", "20", "40"], 5, -2);
    expect(attr(d, "11", "p")).toBe("105 98");
    expect(attr(d, "20", "BoundingBox")).toBe("118 96 118 116");
    expect(attr(d, "40", "Head3D")).toBe("305 158 0");
    expect(attr(d, "30", "p")).toBe("100 160"); // not chosen: not moved
  });
  test("deleting a structure removes its bracket links, its reaction-step entries and its computed name", () => {
    const d = open();
    deleteObjects(d, ["10"]);
    const x = writeCdxml(d.root);
    expect(x).not.toContain("<bracketedgroup");
    expect(x).not.toContain("<chemicalproperty");
    expect(attr(d, "51", "ReactionStepReactants")).toBe("");
    expect(attr(d, "51", "ReactionStepArrows")).toBe("40");
    expect(reread(d).objects.map((o) => o.id)).toEqual(["20", "30", "40"]);
  });
});

describe("atoms and bonds", () => {
  test("an element label shows its implicit hydrogens as ChemDraw does (NH in a chain, OH at an end)", () => {
    const d = open();
    expect(setAtomLabel(d, "12", "N")).toEqual({ ok: true, note: null });
    expect(attr(d, "12", "Element")).toBe("7");
    expect(attr(d, "12", "NumHydrogens")).toBe("1");
    expect(writeCdxml(d.root)).toMatch(/<n id="12"[^>]*>[\s\S]*<s font="3" size="10" face="96">NH<\/s>/);
    setAtomLabel(d, "13", "O");
    expect(writeCdxml(d.root)).toContain(">OH</s>");
    // Read back: the label is drawn and the bond stops at it.
    const n = reread(d).objects.find((o) => o.id === "10")!.items[0];
    expect(n.kind === "fragment" && n.v.nodes.find((q) => q.id === "13")!.label!.runs[0].text).toBe("OH");
  });
  test("carbon makes it a bare vertex again; a charge changes the hydrogens (NH2+ in a chain)", () => {
    const d = open();
    setAtomLabel(d, "12", "N");
    expect(setCharge(d, "12", 1)).toBeNull();
    expect(writeCdxml(d.root)).toContain(">NH2</s>");
    setAtomLabel(d, "12", "C");
    expect(attr(d, "12", "Element")).toBeUndefined();
    expect(findById(d.root, "12")!.el.children).toEqual([]);
  });
  test("generic labels are generic nicknames; Ar is aryl, said so; other text is kept as text, said so", () => {
    const d = open();
    expect(setAtomLabel(d, "13", "R3")).toEqual({ ok: true, note: null });
    expect(attr(d, "13", "NodeType")).toBe("GenericNickname");
    expect(setAtomLabel(d, "13", "Ar")).toEqual({ ok: true, note: "Ar is read as a generic label (aryl), not argon." });
    expect(setAtomLabel(d, "13", "OMe")).toEqual({ ok: true, note: null /* a group label: read as methoxy for the formula (labelExpand) */ });
    expect(attr(d, "13", "NodeType")).toBe("Unspecified");
  });
  test("bonds: order, style, flip; an order this editor does not set is refused", () => {
    const d = open();
    expect(setBond(d, "14", { order: "2" })).toBeNull();
    expect(attr(d, "14", "Order")).toBe("2");
    setBond(d, "14", { display: "WedgeBegin", flip: true });
    expect([attr(d, "14", "Display"), attr(d, "14", "B"), attr(d, "14", "E")]).toEqual(["WedgeBegin", "12", "11"]);
    expect(setBond(d, "14", { order: "4" })).toBe("bond order 4 is not one this editor sets");
    setBond(d, "14", { order: "1", display: "Solid" });
    expect(attr(d, "14", "Order")).toBeUndefined();
    expect(attr(d, "14", "Display")).toBeUndefined();
  });
  test("a new bond from an end atom continues the zig-zag at 120°, one bond length long, with a fresh id", () => {
    const d = open();
    const r = addBondFrom(d, "13");
    expect(r.ok && [r.nodeId, r.bondId]).toEqual(["52", "53"]);
    const p = attr(d, "52", "p")!.split(" ").map(Number);
    expect(Math.hypot(p[0] - 152, p[1] - 100)).toBeCloseTo(30, 1);
    // 120° from the bond to atom 12 (which points down-left): the new one points down-right.
    expect(p[0]).toBeGreaterThan(152);
    expect(p[1]).toBeGreaterThan(100);
  });
  test("deleting a bond the bracket crosses drops the bracket's link (the bracket graphic stays drawn)", () => {
    const d = open();
    expect(deleteInStructure(d, "14")).toBeNull();
    expect(writeCdxml(d.root)).not.toContain("<bracketattachment");
    expect(reread(d).objects.map((o) => o.id)).toContain("20");
  });
  test("deleting an atom takes its bonds; a labelled neighbour's hydrogens follow", () => {
    const d = open();
    setAtomLabel(d, "12", "N"); // NH (two bonds)
    deleteInStructure(d, "13");
    expect(findById(d.root, "15")).toBeNull();
    expect(writeCdxml(d.root)).toContain(">NH2</s>");
  });
});

describe("ChemDraw-computed names", () => {
  test("a name computed from a structure is found from the structure, or anything inside it", () => {
    const d = open();
    expect(namesTiedTo(d, ["10"])).toEqual(["30"]);
    expect(namesTiedTo(d, ["40"])).toEqual([]);
  });
  test("text edits refuse empty words and control characters", () => {
    const d = open();
    expect(setText(d, "30", "  ")).toBe("the text is empty — delete the object instead");
    expect(setText(d, "30", "a\u0001b")).toBe("the text contains a control character");
    expect(setText(d, "99", "x")).toBe("that text is no longer in the document");
  });
});

describe("rings", () => {
  const counts = (d: CdxDoc, fragId: string): [number, number, number] => {
    const f = findById(d.root, fragId)!.el;
    const bonds = f.children.filter((c) => c.name === "b");
    return [f.children.filter((c) => c.name === "n").length, bonds.length, bonds.filter((b) => b.attrs.Order === "2").length];
  };
  test("a free benzene: six atoms one bond length apart, three double bonds", () => {
    const d = open();
    expect(addRingAt(d, [300, 300], "benzene")).toBeNull();
    const fr = d.root.children.find((c) => c.name === "page")!.children.slice(-1)[0];
    const atoms = fr.children.filter((c) => c.name === "n").map((n) => n.attrs.p!.split(" ").map(Number));
    expect(atoms).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const [a, b] = [atoms[i], atoms[(i + 1) % 6]];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(30, 1);
    }
    expect(counts(d, fr.attrs.id!)).toEqual([6, 6, 3]);
  });
  test("benzene fused onto a benzene bond: naphthalene (10 atoms, 11 bonds, the bond shared, 5 double bonds)", () => {
    const d = open();
    addRingAt(d, [300, 300], "benzene");
    const fr = d.root.children.find((c) => c.name === "page")!.children.slice(-1)[0];
    const single = fr.children.find((c) => c.name === "b" && c.attrs.Order !== "2")!;
    expect(addRingOnBond(d, single.attrs.id!, "benzene")).toBeNull();
    expect(counts(d, fr.attrs.id!)).toEqual([10, 11, 5]);
    // No two double bonds share an atom.
    const dbl = fr.children.filter((c) => c.name === "b" && c.attrs.Order === "2").flatMap((b) => [b.attrs.B, b.attrs.E]);
    expect(new Set(dbl).size).toBe(dbl.length);
  });
  test("a ring on a chain bond goes on the side away from the rest of the chain", () => {
    const d = open(); // propane 11–12–13 (12 below the line 11–13)
    expect(addRingOnBond(d, "15", "cyclopentane")).toBeNull();
    const f = findById(d.root, "10")!.el;
    const added = f.children.filter((c) => c.name === "n" && !["11", "12", "13"].includes(c.attrs.id!)).map((n) => n.attrs.p!.split(" ").map(Number));
    expect(added).toHaveLength(3);
    // Atom 11 lies left/below of 12→13; the new atoms lie on the other side.
    const side = (p: number[]): number => Math.sign((152 - 126) * (p[1] - 115) - (100 - 115) * (p[0] - 126));
    for (const p of added) expect(side(p)).toBe(-side([100, 100]));
  });
  test("a ring attached to an atom: one new bond, the ring centred on its line", () => {
    const d = open();
    expect(addRingAtAtom(d, "13", "cyclohexane")).toBeNull();
    const f = findById(d.root, "10")!.el;
    expect(f.children.filter((c) => c.name === "n")).toHaveLength(3 + 6);
    expect(f.children.filter((c) => c.name === "b")).toHaveLength(2 + 1 + 6);
    // The ring's centre lies on the line from atom 13 through the attachment atom.
    const atoms = f.children.filter((c) => c.name === "n").map((n) => n.attrs.p!.split(" ").map(Number));
    const ring = atoms.slice(4);
    const attach = atoms[3];
    const ctr = [ring.reduce((s, p) => s + p[0], attach[0]) / 6, ring.reduce((s, p) => s + p[1], attach[1]) / 6];
    const v1 = [attach[0] - 152, attach[1] - 100], v2 = [ctr[0] - 152, ctr[1] - 100];
    expect(Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) / (Math.hypot(...v1) * Math.hypot(...v2))).toBeLessThan(0.02);
  });
});
