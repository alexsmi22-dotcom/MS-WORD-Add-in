// Drawing on a ChemDraw page (C4): chains, polymer brackets and arrows. Each is written into the
// document itself, read back as ChemDraw would read it, and saved. Documents are written by hand;
// the bracket form is the one ChemDraw writes (seen in ChemDraw files filed with USPTO patents).
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addArrow, addBondFrom, addBrackets, addChain, chainLength, chainPath, findById, fragmentsInBox, namesTiedTo, writeCdxml } from "../cdxmlEdit";
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
const angle = (a: number[], v: number[], b: number[]): number => {
  const p = [a[0] - v[0], a[1] - v[1]], q = [b[0] - v[0], b[1] - v[1]];
  return (Math.acos((p[0] * q[0] + p[1] * q[1]) / (Math.hypot(p[0], p[1]) * Math.hypot(q[0], q[1]))) * 180) / Math.PI;
};

describe("chains", () => {
  test("from an atom: n bonds, a bond length each, 120° at every carbon — the junction too — running along the drag", () => {
    const d = open();
    expect(addChain(d, { nodeId: "13" }, [300, 100], 4)).toBeNull();
    const f = frag(reread(d), "10");
    expect([f.nodes.length, f.bonds.length]).toEqual([7, 6]);
    const at = (id: string) => f.nodes.find((n) => n.id === id)!.p;
    const pts = ["12", "13", ...f.nodes.slice(3).map((n) => n.id)].map(at);
    for (let i = 2; i < pts.length; i++) expect(dist(pts[i], pts[i - 1])).toBeCloseTo(30, 1);
    // 12–13–new is 120° (it was drawn straight, 180°, before the review), and so is every bend after.
    for (let i = 2; i < pts.length; i++) expect(angle(pts[i - 2], pts[i - 1], pts[i])).toBeCloseTo(120, 0);
    expect(pts[5][0]).toBeGreaterThan(pts[1][0] + 90);
  });
  test("from empty space: a structure of its own (n + 1 atoms)", () => {
    const d = open();
    expect(addChain(d, { at: [300, 300] }, [300, 400], 3)).toBeNull();
    const f = reread(d).objects.flatMap((o) => o.items).filter((it) => it.kind === "fragment");
    expect(f).toHaveLength(2);
    expect(f[1].kind === "fragment" && [f[1].v.nodes.length, f[1].v.bonds.length]).toEqual([4, 3]);
  });
  test("the drag's length sets the bond count (L · cos 30° each), 1 to 50; the path is the one drawn", () => {
    const d = open();
    expect([chainLength(d, 0), chainLength(d, 26 * 3), chainLength(d, 1e9), chainLength(d, NaN)]).toEqual([1, 3, 50, 1]);
    expect(chainPath(d, { at: [0, 0] }, [100, 0], 2)?.points).toHaveLength(2);
    expect(chainPath(d, { nodeId: "99" }, [100, 0], 2)).toBeNull();
  });
  test("a chain that would run onto atoms already drawn is refused — they would stack, unjoined", () => {
    // An atom of another structure exactly where the chain's first new atom would go.
    const p = chainPath(open(), { nodeId: "13" }, [300, 100], 1)!.points[0];
    const d = open(SRC.replace("</page>", `<fragment id="60"><n id="61" p="${p[0]} ${p[1]}"/></fragment></page>`));
    const before = writeCdxml(d.root);
    expect(addChain(d, { nodeId: "13" }, [300, 100], 3)).toBe("the chain would run onto atoms already drawn — drag another way, or make it shorter");
    expect(addChain(d, { at: [100, 100] }, [100, 200], 2)).toBe("the chain would run onto atoms already drawn — drag another way, or make it shorter");
    expect(writeCdxml(d.root)).toBe(before);
  });
  test.each([
    ["a carbon with four bonds", '<n id="16" p="126 145"/><n id="17" p="110 140"/><b id="18" B="12" E="16"/><b id="19" B="12" E="17"/>', "12", "that C has no bond to spare"],
    ["N⁺ with four bonds", '<n id="16" p="126 145"/><n id="17" p="110 140"/><b id="18" B="12" E="16"/><b id="19" B="12" E="17"/>', "12", "that N⁺ has no bond to spare"],
    ["C⁺ with three bonds", '<n id="16" p="126 145"/><b id="18" B="12" E="16"/>', "12", "that C⁺ has no bond to spare"],
    ["O⁻ with one bond", "", "13", "that O⁻ has no bond to spare"],
  ])("refused by name: %s (its charge shifts its valence)", (_what, extra, atom, why) => {
    let src = SRC.replace('<b id="15" B="12" E="13"/>', '<b id="15" B="12" E="13"/>' + extra);
    if (why.includes("N⁺")) src = src.replace('<n id="12" p="126 115"/>', '<n id="12" p="126 115" Element="7" Charge="1"/>');
    if (why.includes("C⁺")) src = src.replace('<n id="12" p="126 115"/>', '<n id="12" p="126 115" Charge="1"/>');
    if (why.includes("O⁻")) src = src.replace('<n id="13" p="152 100"/>', '<n id="13" p="152 100" Element="8" Charge="-1"/>');
    const d = open(src);
    expect(addChain(d, { nodeId: atom }, [200, 250], 2)).toBe(why);
    // Add bond keeps the same rule.
    expect(addBondFrom(d, atom)).toEqual({ ok: false, reason: why });
  });
  test("a label that has its bond (Ph, OMe) takes no chain; an N with room does", () => {
    const ph = open(SRC.replace('<n id="13" p="152 100"/>', '<n id="13" p="152 100" NodeType="Nickname"><t p="149 103"><s font="3" size="10">Ph</s></t></n>'));
    expect(addChain(ph, { nodeId: "13" }, [300, 100], 2)).toBe("Ph is a label that already has its bond — a new bond starts from an atom");
    const n = open(SRC.replace('<n id="12" p="126 115"/>', '<n id="12" p="126 115" Element="7"/>'));
    expect(addChain(n, { nodeId: "12" }, [126, 250], 1)).toBeNull();
  });
  test("other refusals: no direction, a bad count, a gone atom", () => {
    const d = open();
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
  // Butane 11–12–13–14 in a row; the box round 12–13 cuts bonds 21 (left side) and 23 (right).
  const ROW = `<CDXML BondLength="30" CaptionSize="12" CaptionFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="130 100"/><n id="13" p="160 100"/><n id="14" p="190 100"/><b id="21" B="11" E="12"/><b id="22" B="12" E="13"/><b id="23" B="13" E="14"/></fragment>
</page></CDXML>`;
  const BOX: [number, number, number, number] = [115, 85, 175, 115];
  test("written as ChemDraw writes them: the right bracket carries the italic label; an SRU names its atoms, label and crossings", () => {
    const d = open(ROW);
    expect(addBrackets(d, BOX, "n")).toBeNull();
    const r = reread(d);
    expect(r.brackets).toHaveLength(1);
    const b = r.brackets[0];
    expect([b.usage, b.el.attrs.RepeatCount, b.el.attrs.SRULabel]).toEqual(["SRU", "2", "n"]);
    expect(b.objectIds).toEqual(["12", "13"]);
    const graphics = r.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "graphic" ? [it.v] : []));
    expect(graphics.map((g) => [g.kind, g.p1[0], g.el.attrs.BracketUsage ?? ""])).toEqual([["Bracket", 115, ""], ["Bracket", 175, "SRU"]]);
    const [left, right] = graphics;
    const tag = right.el.children.find((c) => c.name === "objecttag")!;
    expect(tag.attrs).toEqual({ TagType: "Unknown", Name: "bracketusage" });
    expect(tag.children[0].children[0].attrs.face).toBe("2");
    // Each bracket's crossing bonds, by bracket.
    const by = Object.fromEntries(b.attachments.map((a) => [a.graphicId, [a.bondId, a.innerAtomId]]));
    expect(by).toEqual({ [right.id]: ["23", "13"], [left.id]: ["21", "12"] });
    // Drawn: the label, and the lips turned in toward the atoms (none beyond the brackets' x).
    const svg = renderCdx(r)!.svg;
    expect(svg).toContain(">n</tspan>");
    const paths = [...svg.matchAll(/<path d="M([\d. L-]+)"/g)].map((m) => m[1].split("L").map((p) => p.trim().split(" ").map(Number)));
    const bracketPaths = paths.filter((pp) => pp.some(([x]) => x === 115 || x === 175));
    expect(bracketPaths).toHaveLength(2);
    for (const pp of bracketPaths) {
      const xs = pp.map(([x]) => x);
      if (xs.includes(175)) expect(Math.max(...xs)).toBe(175);
      else expect(Math.min(...xs)).toBe(115);
    }
    const again = readCdxml(writeCdxml(d.root));
    expect(again.ok && again.doc.brackets[0].attachments.map((a) => a.bondId)).toEqual(["23", "21"]);
  });
  test("an end group: one bond leaves the box — one bracket crosses it, the other has its attachment with none (as ChemDraw)", () => {
    const d = open(ROW);
    expect(addBrackets(d, [85, 85, 145, 115])).toBeNull();
    const b = reread(d).brackets[0];
    expect(b.attachments.map((a) => a.bondId)).toEqual(["22", ""]);
  });
  test("bracketing a structure makes ChemDraw's computed name for it out of date (it named the monomer)", () => {
    const d = open(ROW.replace("</page>", '<t id="30" p="100 160"><s font="3" size="12">butane</s></t><chemicalproperty id="31" ChemicalPropertyDisplayID="30" ChemicalPropertyType="1" BasisObjects="10"/></page>'));
    expect(fragmentsInBox(d, BOX)).toEqual(["10"]);
    expect(namesTiedTo(d, fragmentsInBox(d, BOX))).toEqual(["30"]);
  });
  test("a number label is the SRU's label; the repeat count stays ChemDraw's 2", () => {
    const d = open(ROW);
    expect(addBrackets(d, BOX, "3")).toBeNull();
    expect([reread(d).brackets[0].el.attrs.SRULabel, reread(d).brackets[0].el.attrs.RepeatCount]).toEqual(["3", "2"]);
  });
  test("a bond leaving through the box's top is refused: no bracket crosses it", () => {
    const d = open(ROW.replace('<b id="23"', '<n id="15" p="130 70"/><b id="24" B="12" E="15"/><b id="23"'));
    expect(addBrackets(d, BOX)).toBe("a bond leaves the box through its top or bottom, where no bracket crosses it — make the box taller, so only its sides cut the bonds that leave the repeat unit");
  });
  test("atoms of two structures in one box are refused; an abbreviation's own atoms are not the structure's", () => {
    const two = open(ROW.replace("</page>", '<fragment id="40"><n id="41" p="150 110"/><n id="42" p="300 110"/><b id="43" B="41" E="42"/></fragment></page>'));
    expect(addBrackets(two, BOX)).toBe("the box takes in atoms of more than one structure — drag it round one repeat unit");
    const abbr = open(ROW.replace('<n id="13" p="160 100"/>', '<n id="13" p="160 100" NodeType="Fragment"><fragment id="50"><n id="51" p="160 100"/><n id="52" p="165 105"/></fragment><t p="157 103"><s font="3" size="10">Et</s></t></n>'));
    expect(addBrackets(abbr, BOX)).toBeNull();
    expect(reread(abbr).brackets[0].objectIds).toEqual(["12", "13"]);
  });
  test("refused by name: nothing inside, nothing leaving it, a tiny box, a bad label — and nothing written", () => {
    const d = open(ROW);
    expect(addBrackets(d, [300, 300, 340, 340])).toBe("no atom is inside the box — drag it round the repeat unit");
    expect(addBrackets(d, [80, 80, 210, 120])).toBe("no bond leaves the box — a repeat unit is bonded on, through the brackets");
    expect(addBrackets(d, [115, 85, 116, 86])).toBe("drag a box round the repeat unit");
    expect(addBrackets(d, BOX, "  ")).toBe("the bracket's label must be 1 to 20 characters");
    expect(addBrackets(d, BOX, "n\u0007")).toBe("the bracket's label must be 1 to 20 characters");
    expect(reread(d).brackets).toHaveLength(0);
  });
  test("a ChemDraw file's bracket label (text in the bracket's object tag) is drawn", () => {
    const d = open(`<CDXML BondLength="30"><fonttable><font id="4" name="Arial"/></fonttable><page id="1">
<fragment id="10"><n id="11" p="10 40"/><n id="12" p="40 40"/><n id="13" p="70 40"/><n id="14" p="100 40"/><b id="15" B="11" E="12"/><b id="16" B="12" E="13"/><b id="17" B="13" E="14"/></fragment>
<graphic id="22" BoundingBox="25 50 25 30" GraphicType="Bracket" BracketType="Round"/>
<graphic id="23" BoundingBox="85 30 85 50" GraphicType="Bracket" BracketType="Round" BracketUsage="SRU"><objecttag TagType="Unknown" Name="bracketusage"><t p="87 52" BoundingBox="87 49 90 52"><s font="4" size="5.25" face="2">n</s></t></objecttag></graphic>
<bracketedgroup id="35" BracketedObjectIDs="12 13" BracketUsage="SRU" RepeatCount="2" SRULabel="n"><bracketattachment id="36" GraphicID="23"><crossingbond id="37" BondID="17" InnerAtomID="13"/></bracketattachment><bracketattachment id="38" GraphicID="22"><crossingbond id="39" BondID="15" InnerAtomID="12"/></bracketattachment></bracketedgroup>
</page></CDXML>`);
    expect(renderCdx(d)!.svg).toContain(">n</tspan>");
  });
});

describe("arrows", () => {
  test("a reaction arrow: tail and head where dragged, a full solid head", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [300, 300])).toBeNull();
    const a = reread(d).objects.flatMap((o) => o.items).find((it) => it.kind === "arrow");
    expect(a?.kind === "arrow" && [a.v.tail, a.v.head, a.v.el.attrs.ArrowheadHead]).toEqual([[200, 300], [300, 300], "Full"]);
    // The head (10 pt long, 2.5 pt each side at a 1 pt line: ChemDraw's 1000 / 250 hundredths) ends at the drop point.
    expect(renderCdx(reread(d))!.svg).toContain('<path d="M300 300L290 302.5L291.25 300L290 297.5Z"');
  });
  test("an equilibrium arrow (⇌): two shafts, each ending in a half head whose barb points outward", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [300, 300], "equilibrium")).toBeNull();
    const el = reread(d).objects.flatMap((o) => o.items).find((it) => it.kind === "arrow");
    expect(el?.kind === "arrow" && [el.v.el.attrs.ArrowheadHead, el.v.el.attrs.ArrowheadTail]).toEqual(["HalfLeft", "HalfLeft"]);
    const svg = renderCdx(reread(d))!.svg;
    // Upper shaft (y 297.5) ends at the head, its barb above it; lower (y 302.5) at the tail, barb below.
    expect(svg).toContain('<path d="M300 297.5L290 295L291.25 297.5Z"');
    expect(svg).toContain('<path d="M200 302.5L210 305L208.75 302.5Z"');
    expect(svg).toContain('<line x1="200" y1="297.5" x2="291.25" y2="297.5"');
    expect(svg).toContain('<line x1="208.75" y1="302.5" x2="300" y2="302.5"');
  });
  test("refused by name: too short, or not on the page", () => {
    const d = open();
    expect(addArrow(d, [200, 300], [205, 300])).toBe("drag further: an arrow needs some length");
    expect(addArrow(d, [NaN, 300], [205, 300])).toBe("that is not a place on the page");
  });
});
