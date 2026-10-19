// Atom properties on the chemistry canvas: radicals, atom lists, enhanced-stereo groups and query features,
// between ChemDraw's CDXML attributes (CDX SDK property reference) and OpenChemLib. The oracle: a structure
// built in OCL, written to a page and read back, has the SAME idcode; what ChemDraw has no form for is
// refused by name, never dropped.
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { blankPageCdxml, findById, setAtomLabel, setAtomProps, setBondProps, writeCdxml } from "../cdxmlEdit";
import { moleculeToPage, pageToMolecule } from "../cdxmlMol";
import { renderCdx } from "../cdxmlRender";

const blank = (): CdxDoc => {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
/** OCL → page → OCL: the idcode read back, or the refusal. */
const roundTrip = (m: Molecule): string => {
  const d = blank();
  m.inventCoordinates();
  const w = moleculeToPage(d, m);
  if (!w.ok) return `REFUSED: ${w.reason}`;
  const again = readCdxmlTree(d.root);
  if (!again.ok) return `REREAD: ${again.reason}`;
  const r = pageToMolecule(again.doc);
  return r.ok ? r.value.mol.getIDCode() : `READ: ${r.reason}`;
};
const query = (smiles: string, set: (m: Molecule) => void): Molecule => {
  const m = Molecule.fromSmiles(smiles);
  m.setFragment(true);
  set(m);
  return m;
};
const centres = (m: Molecule): number[] => {
  m.ensureHelperArrays(Molecule.cHelperParities);
  const out: number[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) if (m.isAtomStereoCenter(a)) out.push(a);
  return out;
};

describe("enhanced-stereo groups (AND / OR) round-trip exactly", () => {
  test.each([
    ["AND 1 (racemic) alanine", "C[C@H](N)C(=O)O", [[Molecule.cESRTypeAnd, 0]]],
    ["OR 1 (relative) alanine", "C[C@H](N)C(=O)O", [[Molecule.cESRTypeOr, 0]]],
    ["two centres, AND 1 and OR 2", "C[C@H](N)[C@@H](O)C", [[Molecule.cESRTypeAnd, 0], [Molecule.cESRTypeOr, 1]]],
    ["two centres in one OR group", "C[C@H](N)[C@@H](O)C", [[Molecule.cESRTypeOr, 0], [Molecule.cESRTypeOr, 0]]],
  ])("%s", (_n, smi, groups) => {
    const m = Molecule.fromSmiles(smi as string);
    const cs = centres(m);
    (groups as number[][]).forEach(([t, g], i) => m.setAtomESR(cs[i], t, g));
    const want = m.getIDCode();
    expect(want).not.toBe(Molecule.fromSmiles(smi as string).getIDCode()); // the group is in the idcode
    expect(roundTrip(m)).toBe(want);
  });
  test("ChemDraw's attributes on a wedged centre read as the group", () => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0" EnhancedStereoType="And" EnhancedStereoGroupNum="1"/><n id="3" p="45 -26" Element="7" NumHydrogens="2"/><n id="4" p="45 26"/><n id="5" p="60 0" Element="8" NumHydrogens="1"/><b id="6" B="1" E="2"/><b id="7" B="2" E="3" Display="WedgeBegin"/><b id="8" B="2" E="4"/><b id="9" B="4" E="5"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    const r = pageToMolecule(d.doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = centres(r.value.mol);
    expect(c.length).toBe(1);
    expect(r.value.mol.getAtomESRType(c[0])).toBe(Molecule.cESRTypeAnd);
    expect(r.value.query).toBe(false);
  });
});

describe("atom lists", () => {
  test("[N,O] and NOT [F,Cl,Br] round-trip exactly", () => {
    for (const [list, not] of [[[7, 8], false], [[9, 17, 35], true]] as const) {
      const m = query("CCC", (q) => q.setAtomList(2, [...list], not));
      const want = m.getIDCode();
      expect(roundTrip(m)).toBe(want);
    }
  });
  test("ChemDraw's ElementList node (NOT 8, as in a USPTO file) reads as the excluded list", () => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0" NodeType="ElementList" ElementList="NOT 8"><t p="30 0"><s font="3" size="10">-O</s></t></n><b id="3" B="1" E="2"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    const r = pageToMolecule(d.doc);
    expect(r.ok && r.value.query).toBe(true);
    if (!r.ok) return;
    const a = r.value.atomIds.indexOf("2");
    expect([...(r.value.mol.getAtomList(a) ?? [])]).toEqual([8]);
  });
  test("typed on the canvas: [N,O] becomes ChemDraw's element-list node, said so", () => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    const r = setAtomLabel(d.doc, "2", "[N,O]");
    expect(r).toEqual({ ok: true, note: "An atom list: any one of N, O — the structure is a query (no single formula)." });
    expect(findById(d.doc.root, "2")!.el.attrs).toMatchObject({ NodeType: "ElementList", ElementList: "7 8" });
    expect(setAtomLabel(d.doc, "2", "[Xx,O]")).toEqual({ ok: false, reason: "the atom list \"[Xx,O]\" names \"Xx\", which is not an element" });
    expect(setAtomLabel(d.doc, "2", "[Ac]").ok).toBe(true); // one element in brackets: that element
    expect(findById(d.doc.root, "2")!.el.attrs.Element).toBe("89");
  });
});

describe("atom query features ChemDraw can say", () => {
  const N = Molecule;
  test.each([
    ["no ring bonds", N.cAtomQFNot2RingBonds | N.cAtomQFNot3RingBonds | N.cAtomQFNot4RingBonds],
    ["simple ring", N.cAtomQFNotChain | N.cAtomQFNot3RingBonds | N.cAtomQFNot4RingBonds],
    ["fusion", N.cAtomQFNotChain | N.cAtomQFNot2RingBonds | N.cAtomQFNot4RingBonds],
    ["spiro or higher", N.cAtomQFNotChain | N.cAtomQFNot2RingBonds | N.cAtomQFNot3RingBonds],
    ["exactly 2 substituents", N.cAtomQFNot0Neighbours | N.cAtomQFNot1Neighbour | N.cAtomQFNot3Neighbours | N.cAtomQFNot4Neighbours],
    ["up to 2 substituents", N.cAtomQFNot3Neighbours | N.cAtomQFNot4Neighbours],
    ["no more substituents than drawn", N.cAtomQFNoMoreNeighbours],
    ["saturated", N.cAtomQFNot1PiElectron | N.cAtomQFNot2PiElectrons],
    ["unsaturated", N.cAtomQFNot0PiElectrons],
  ])("%s", (_n, bits) => {
    const m = query("CC(C)CN", (q) => q.setAtomQueryFeature(1, bits, true));
    const want = m.getIDCode();
    expect(roundTrip(m)).toBe(want);
  });
  test.each([
    ["aromatic", Molecule.cAtomQFAromatic, "an atom carries a query feature (aromatic) that ChemDraw has no form for"],
    ["a hydrogen count", Molecule.cAtomQFNot0Hydrogen, "an atom carries a query feature (a hydrogen count) that ChemDraw has no form for"],
    ["a charge restriction", Molecule.cAtomQFNotChargeNeg, "an atom carries a query feature (a charge restriction) that ChemDraw has no form for"],
    ["two ring-bond counts", Molecule.cAtomQFNotChain, "an atom allows several ring-bond counts, which ChemDraw can say only one at a time"],
  ])("%s is refused by name", (_n, bits, why) => {
    expect(roundTrip(query("CCCN", (q) => q.setAtomQueryFeature(1, bits, true)))).toBe(`REFUSED: ${why}`);
  });
});

describe("bond query features", () => {
  test.each([
    ["in a ring", (Molecule as unknown as Record<string, number>).cBondQFRing],
    ["in a chain", (Molecule as unknown as Record<string, number>).cBondQFNotRing],
    ["single or double", 1 | 2],
    ["double or aromatic (drawn double)", 2 | 8],
    ["any of single, double, triple, aromatic", 1 | 2 | 4 | 8],
  ])("%s round-trips exactly", (_n, bits) => {
    const m = query("CCCN", (q) => {
      if (bits === (2 | 8)) q.setBondType(1, Molecule.cBondTypeDouble);
      q.setBondQueryFeature(1, bits, true);
    });
    const want = m.getIDCode();
    expect(roundTrip(m)).toBe(want);
  });
  test("a query bond written as ChemDraw writes it (Order listing its orders) reads as the query, not refused", () => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2" Order="1 2" Topology="Ring"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    const r = pageToMolecule(d.doc);
    expect(r.ok && r.value.query).toBe(true);
  });
});

describe("radicals", () => {
  test.each([
    ["methyl radical (doublet)", "[CH3]", "CH3"],
    ["carbene (triplet)", "[CH2]", "CH2"],
    ["aminyl radical", "[NH2]", "H2N"],
  ])("%s round-trips exactly, its formula counting the radical", (_n, smi, f) => {
    const m = Molecule.fromSmiles(smi);
    const want = m.getIDCode();
    expect(m.getMolecularFormula().formula).toBe(f);
    expect(roundTrip(m)).toBe(want);
  });
  test("set on the canvas: an NH₂ made a radical shows NH and reads one H fewer", () => {
    const d = readCdxml('<CDXML BondLength="30" LabelSize="10"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0" Element="7" NumHydrogens="2"><t p="30 0"><s font="3" size="10" face="96">NH2</s></t></n><b id="3" B="1" E="2"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    expect(setAtomProps(d.doc, "2", { radical: "Doublet" })).toBeNull();
    const n = findById(d.doc.root, "2")!.el;
    expect(n.attrs.NumHydrogens).toBe("1");
    const again = readCdxmlTree(d.doc.root);
    const r = again.ok ? pageToMolecule(again.doc) : null;
    expect(r && r.ok && r.value.mol.getMolecularFormula().formula).toBe("CH4N");
  });
});

describe("the canvas's property setters write ChemDraw's attributes", () => {
  const two = (): CdxDoc => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    return d.doc;
  };
  test("atom: stereo group, substituents, ring bonds, unsaturation; cleared with empty values", () => {
    const d = two();
    expect(setAtomProps(d, "2", { stereo: { type: "Or", group: 2 }, substituents: "u2", ringBonds: "SimpleRing", unsaturation: "MustBePresent" })).toBeNull();
    expect(findById(d.root, "2")!.el.attrs).toMatchObject({ EnhancedStereoType: "Or", EnhancedStereoGroupNum: "2", SubstituentsUpTo: "2", RingBondCount: "SimpleRing", UnsaturatedBonds: "MustBePresent" });
    expect(d.root.attrs).toMatchObject({ ShowAtomQuery: "yes", ShowAtomEnhancedStereo: "yes" });
    expect(setAtomProps(d, "2", { stereo: { type: "Absolute", group: 1 }, substituents: "", ringBonds: "", unsaturation: "" })).toBeNull();
    const a = findById(d.root, "2")!.el.attrs;
    for (const k of ["EnhancedStereoType", "EnhancedStereoGroupNum", "SubstituentsUpTo", "RingBondCount", "UnsaturatedBonds"]) expect(a[k]).toBeUndefined();
    expect(setAtomProps(d, "2", { stereo: { type: "And", group: 40 } })).toBe("a stereo group is numbered 1 to 32");
  });
  test("bond: several orders make a query bond; one order a plain bond; topology", () => {
    const d = two();
    expect(setBondProps(d, "3", { orders: ["1", "2"], topology: "Chain" })).toBeNull();
    expect(findById(d.root, "3")!.el.attrs).toMatchObject({ Order: "1 2", Topology: "Chain" });
    expect(setBondProps(d, "3", { orders: ["1"], topology: "" })).toBeNull();
    expect(findById(d.root, "3")!.el.attrs.Order).toBeUndefined();
    expect(findById(d.root, "3")!.el.attrs.Topology).toBeUndefined();
    expect(setBondProps(d, "3", { orders: [] })).toBe("choose at least one of single, double, triple, aromatic");
  });
});

test("regression (v2.156.0): a structure inserted from the old editor with an AND group reopens on the canvas, not refused", () => {
  const m = Molecule.fromSmiles("C[C@H](N)C(=O)O");
  m.setAtomESR(centres(m)[0], Molecule.cESRTypeAnd, 0);
  const coded = m.getIDCode();
  // Reopened as the pane does: from the idcode in the picture's alt text.
  const back = Molecule.fromIDCode(coded);
  expect(roundTrip(back)).toBe(coded);
});

test("a feature OCL holds but does not show (an excluded group) is caught by the read-back check and refused, never dropped", () => {
  const m = query("CCCN", (q) => q.setAtomQueryFeature(1, Molecule.cAtomQFExcludeGroup, true));
  expect(roundTrip(m)).toBe("REFUSED: the structure carries something this page cannot keep exactly (a query feature ChemDraw has no form for) — it is not redrawn without it");
});

describe("review of the atom properties (13 findings)", () => {
  const read = (inner: string) => {
    const d = readCdxml(`<CDXML BondLength="30"><page id="900">${inner}</page></CDXML>`);
    if (!d.ok) throw new Error(d.reason);
    return pageToMolecule(d.doc);
  };
  test("1. a query bond inside an abbreviation is refused, never read as its first order", () => {
    const et = '<fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0"/><n id="22" p="10 0"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22" Order="1 2"/><b id="32" B="21" E="23"/></fragment><t p="30 0"><s font="3" size="10">Et</s></t></n><b id="103" B="101" E="102"/></fragment>';
    expect(read(et)).toEqual({ ok: false, reason: "“Et” holds a query bond, which has no form inside an abbreviation here" });
  });
  test("2. an atom list keeps its charge; an isotope or radical on it is refused by name", () => {
    const base = (extra: string) => `<fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0" NodeType="ElementList" ElementList="7 8" ${extra}/><b id="103" B="101" E="102"/></fragment>`;
    const plain = read(base("")), charged = read(base('Charge="1"'));
    expect(plain.ok && charged.ok && plain.value.mol.getIDCode() !== charged.value.mol.getIDCode()).toBe(true);
    expect(read(base('Isotope="15"'))).toEqual({ ok: false, reason: "an atom list with an isotope has no exact form here" });
    expect(read(base('Radical="Doublet"'))).toEqual({ ok: false, reason: "an atom list with a radical has no exact form here" });
  });
  test("3. a query feature on an R-group or on an atom inside an abbreviation is refused, never dropped", () => {
    expect(read('<fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0" NodeType="GenericNickname" GenericNickname="R1" SubstituentsExactly="1"/><b id="103" B="101" E="102"/></fragment>')).toMatchObject({ ok: false });
    const inner = '<fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" UnsaturatedBonds="MustBePresent"/><n id="22" p="10 0"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22"/><b id="32" B="21" E="23"/></fragment><t p="30 0"><s font="3" size="10">Et</s></t></n><b id="103" B="101" E="102"/></fragment>';
    expect(read(inner)).toEqual({ ok: false, reason: "“Et” holds an atom with a query feature or a stereo group, which has no form inside an abbreviation here" });
  });
  test("4. an OCL atom list on an O (or N) atom is written, not falsely refused", () => {
    const m = query("CCO", (q) => q.setAtomList(2, [7, 8], false));
    expect(roundTrip(m)).not.toMatch(/^REFUSED/);
  });
  test("7. an aromatic five-ring with an atom list ([O,S] furan / thiophene) reads as a query", () => {
    let s = "";
    for (let i = 0; i < 5; i++) s += `<n id="${101 + i}" p="${(30 * Math.cos((2 * Math.PI * i) / 5)).toFixed(2)} ${(30 * Math.sin((2 * Math.PI * i) / 5)).toFixed(2)}"${i === 0 ? ' NodeType="ElementList" ElementList="8 16"' : ""}/>`;
    for (let i = 0; i < 5; i++) s += `<b id="${201 + i}" B="${101 + i}" E="${101 + ((i + 1) % 5)}" Order="1.5"/>`;
    const r = read(`<fragment id="10">${s}</fragment>`);
    expect(r.ok && r.value.query).toBe(true);
  });
  test("8. values meaning 'unspecified' set no query (the structure keeps its formula)", () => {
    const r = read('<fragment id="10"><n id="101" p="0 0" UnsaturatedBonds="0" RingBondCount="-1"/><n id="102" p="30 0"/><b id="103" B="101" E="102" Topology="RingOrChain"/></fragment>');
    expect(r.ok && r.value.query).toBe(false);
    expect(r.ok && r.value.mol.getMolecularFormula().formula).toBe("C2H6");
  });
  test("9. Radical=\"None\" (as the .cdx reader writes 0) is no radical", () => {
    const r = read('<fragment id="10"><n id="101" p="0 0" Radical="None"/><n id="102" p="30 0"/><b id="103" B="101" E="102"/></fragment>');
    expect(r.ok && r.value.mol.getMolecularFormula().formula).toBe("C2H6");
  });
  test("10. the listing order of a query bond's orders does not change the structure", () => {
    const ring = (o: string): string => {
      let s = "";
      for (let i = 0; i < 6; i++) s += `<n id="${101 + i}" p="${(30 * Math.cos((2 * Math.PI * i) / 6)).toFixed(2)} ${(30 * Math.sin((2 * Math.PI * i) / 6)).toFixed(2)}"/>`;
      for (let i = 0; i < 6; i++) s += `<b id="${201 + i}" B="${101 + i}" E="${101 + ((i + 1) % 6)}" Order="${i === 0 ? o : "1.5"}"/>`;
      return `<fragment id="10">${s}</fragment>`;
    };
    const a = read(ring("1.5 2")), b = read(ring("2 1.5"));
    expect(a.ok && b.ok && a.value.mol.getIDCode()).toBe(b.ok && b.value.mol.getIDCode());
  });
});

describe("review: rendering", () => {
  const svgOf = (inner: string, rootAttrs = ""): string => {
    const d = readCdxml(`<CDXML BondLength="30" LabelSize="10"${rootAttrs}><page id="900">${inner}</page></CDXML>`);
    if (!d.ok) throw new Error(d.reason);
    return renderCdx(d.doc)!.svg;
  };
  test("5. a connection point keeps its diamond (also beside a mark)", () => {
    expect(svgOf('<fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0" NodeType="ExternalConnectionPoint"/><b id="103" B="101" E="102"/></fragment>')).toMatch(/<path d="M30 -/);
  });
  test("13. a node's own ShowAtomQuery=\"no\" hides its marks; the document's \"no\" hides all, a node's \"yes\" shows its own", () => {
    const frag = (show: string) => `<fragment id="10"><n id="101" p="0 0" SubstituentsExactly="2"${show}/><n id="102" p="30 0"/><b id="103" B="101" E="102"/></fragment>`;
    expect(svgOf(frag(""))).toContain(">s2<");
    expect(svgOf(frag(' ShowAtomQuery="no"'))).not.toContain(">s2<");
    expect(svgOf(frag(""), ' ShowAtomQuery="no"')).not.toContain(">s2<");
    expect(svgOf(frag(' ShowAtomQuery="yes"'), ' ShowAtomQuery="no"')).toContain(">s2<");
  });
  test("9. Radical=\"None\" draws no dots", () => {
    expect(svgOf('<fragment id="10"><n id="101" p="0 0" Radical="None"/><n id="102" p="30 0"/><b id="103" B="101" E="102"/></fragment>')).not.toContain("<circle");
  });
});

test("an element typed on a left-hand chain end is written with its hydrogens first (HO), right-aligned", () => {
  const d = readCdxml('<CDXML BondLength="30"><page id="900"><fragment id="10"><n id="101" p="30 0"/><n id="102" p="0 0"/><b id="103" B="101" E="102"/></fragment></page></CDXML>');
  if (!d.ok) throw new Error(d.reason);
  expect(setAtomLabel(d.doc, "102", "O").ok).toBe(true);
  const t = findById(d.doc.root, "102")!.el.children.find((c) => c.name === "t")!;
  expect(t.children.map((s) => s.text).join("")).toBe("HO");
  expect(t.attrs.LabelJustification).toBe("Right");
});

test("review: an N with two bonds is written NH whichever bond is listed first (H first only for one bond, left of it)", () => {
  for (const bonds of ['<b id="104" B="101" E="102"/><b id="105" B="102" E="103"/>', '<b id="105" B="102" E="103"/><b id="104" B="101" E="102"/>']) {
    const d = readCdxml(`<CDXML BondLength="30"><page id="900"><fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0"/><n id="103" p="60 0"/>${bonds}</fragment></page></CDXML>`);
    if (!d.ok) throw new Error(d.reason);
    expect(setAtomLabel(d.doc, "102", "N").ok).toBe(true);
    const t = findById(d.doc.root, "102")!.el.children.find((c) => c.name === "t")!;
    expect(t.children.map((s) => s.text).join("")).toBe("NH");
  }
});

test("review: the compact form keeps a caption's line break (written, never stripped after)", () => {
  const d = readCdxml('<CDXML BondLength="30"><page id="900"><t id="20" p="0 0"><s font="3" size="10">Title</s><s font="3" size="10">\n</s><s font="3" size="10">Body</s></t></page></CDXML>');
  if (!d.ok) throw new Error(d.reason);
  const again = readCdxml(writeCdxml(d.doc.root, true));
  expect(again.ok && again.doc.objects[0].items[0].kind === "text" && again.doc.objects[0].items[0].v.runs.map((r) => r.text).join("")).toBe("Title\nBody");
  expect(writeCdxml(d.doc.root, true).startsWith("<CDXML")).toBe(true);
});

describe("review: marks clear of bonds", () => {
  test.each([3, 4])("%i-bond centre with query marks and a stereo group, 24 rotations: the marks' box crosses no bond", (nb) => {
    for (let k = 0; k < 24; k++) {
      const rot = (k * Math.PI) / 12;
      let s = '<n id="101" p="100 100" SubstituentsUpTo="3" RingBondCount="SimpleRing" UnsaturatedBonds="MustBeAbsent" EnhancedStereoType="And" EnhancedStereoGroupNum="1"/>';
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < nb; i++) {
        const a = rot + (2 * Math.PI * i) / nb;
        const p: [number, number] = [100 + 30 * Math.cos(a), 100 + 30 * Math.sin(a)];
        pts.push(p);
        s += `<n id="${110 + i}" p="${p[0].toFixed(2)} ${p[1].toFixed(2)}"/><b id="${120 + i}" B="101" E="${110 + i}"/>`;
      }
      const d = readCdxml(`<CDXML BondLength="30" LabelSize="10"><page id="900"><fragment id="10">${s}</fragment></page></CDXML>`);
      if (!d.ok) throw new Error(d.reason);
      const svg = renderCdx(d.doc)!.svg;
      for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(start|middle|end)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)<\/text>/g)) {
        const [x, y, anchor, size, txt] = [Number(m[1]), Number(m[2]), m[3], Number(m[4]), m[5].replace(/&amp;/g, "&")];
        const w = txt.length * size * 0.6;
        const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
        const box = [x0, y - size, x0 + w, y + size * 0.25];
        for (const p of pts) {
          // The bond from the centre to p, sampled: no point of it inside the box.
          for (let t = 0.15; t <= 1; t += 0.05) {
            const q = [100 + (p[0] - 100) * t, 100 + (p[1] - 100) * t];
            expect([nb, k, txt, q[0] >= box[0] && q[0] <= box[2] && q[1] >= box[1] && q[1] <= box[3]]).toEqual([nb, k, txt, false]);
          }
        }
      }
    }
  });
});
