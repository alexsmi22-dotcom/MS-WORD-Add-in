// The one-canvas review (15 findings): each pinned. The chemistry the pane reports must be the drawing's —
// aromatic bonds resolved, wavy bonds honoured, abbreviations bonded where the file says, labels read by
// their side, nothing dropped silently.
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addBondAt, blankPageCdxml, deleteInStructure, findById, setAtomLabel } from "../cdxmlEdit";
import { moleculeToPage, pageToMolecule } from "../cdxmlMol";

const page = (inner: string): CdxDoc => {
  const r = readCdxml(`<CDXML BondLength="30" LabelSize="10" LabelFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1"><fragment id="10">${inner}</fragment></page></CDXML>`);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const formula = (d: CdxDoc): string => {
  const r = pageToMolecule(d);
  return r.ok ? r.value.mol.getMolecularFormula().formula : r.reason;
};
/** A ring of n atoms (elements by index, carbon by default) joined by `order` bonds, with node attrs per index. */
const ring = (n: number, order: string, attrs: Record<number, string> = {}): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += `<n id="${i + 1}" p="${(30 * Math.cos((2 * Math.PI * i) / n)).toFixed(2)} ${(30 * Math.sin((2 * Math.PI * i) / n)).toFixed(2)}" ${attrs[i] ?? ""}/>`;
  for (let i = 0; i < n; i++) s += `<b id="${100 + i}" B="${i + 1}" E="${((i + 1) % n) + 1}" Order="${order}"/>`;
  return s;
};

describe("1. aromatic bonds (Order 1.5) resolve into the right structure", () => {
  test.each([
    ["benzene", ring(6, "1.5"), "C6H6"],
    ["pyridine", ring(6, "1.5", { 0: 'Element="7" NumHydrogens="0"' }), "C5H5N"],
    ["pyrrole (NH)", ring(5, "1.5", { 0: 'Element="7" NumHydrogens="1"' }), "C4H5N"],
    ["furan", ring(5, "1.5", { 0: 'Element="8" NumHydrogens="0"' }), "C4H4O"],
    ["cyclopentadienide", ring(5, "1.5", { 0: 'Charge="-1"' }), "C5H5"],
    ["tropylium", ring(7, "1.5", { 0: 'Charge="1"' }), "C7H7"],
    ["pyridinium (NH⁺)", ring(6, "1.5", { 0: 'Element="7" Charge="1" NumHydrogens="1"' }), "C5H6N"],
  ])("%s", (_name, inner, f) => {
    expect(formula(page(inner))).toBe(f);
  });
  test("a ring that cannot alternate (five neutral carbons) is refused by name", () => {
    expect(formula(page(ring(5, "1.5")))).toBe("the bonds drawn as aromatic cannot be given alternating single and double bonds — as drawn, that ring is not aromatic (check its atoms, charges and hydrogens)");
  });
});

test("2. a wavy bond next to a double bond: its geometry unknown (not the E drawn)", () => {
  const trans = '<n id="1" p="0 0"/><n id="2" p="26 15"/><n id="3" p="52 0"/><n id="4" p="78 15"/><b id="11" B="1" E="2" Display="Wavy"/><b id="12" B="2" E="3" Order="2"/><b id="13" B="3" E="4"/>';
  const r = pageToMolecule(page(trans));
  const unknown = Molecule.fromSmiles("CC=CC");
  const e = Molecule.fromSmiles("C/C=C/C");
  expect(r.ok && r.value.mol.getIDCode()).toBe(unknown.getIDCode());
  expect(r.ok && r.value.mol.getIDCode()).not.toBe(e.getIDCode());
});

test("3. a Markush structure keeps its heteroatoms' hydrogens on the page (CCO stays CCO when unticked)", () => {
  const d = readCdxml(blankPageCdxml());
  if (!d.ok) throw new Error(d.reason);
  const m = Molecule.fromSmiles("CCO");
  m.inventCoordinates();
  m.setFragment(true);
  expect(moleculeToPage(d.doc, m).ok).toBe(true);
  const again = readCdxmlTree(d.doc.root);
  if (!again.ok) throw new Error(again.reason);
  expect(formula(again.doc)).toBe("C2H6O");
});

test("4. Ac, Pr, Ts typed on an atom are the groups (acetyl, propyl, tosyl), said so; [Ac] is the element", () => {
  const d = page('<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/>');
  const r = setAtomLabel(d, "2", "Ac");
  expect(r).toEqual({ ok: true, note: "Ac is read as the group (acetyl); for the element, type [Ac]." });
  const again = readCdxmlTree(d.root);
  expect(again.ok && formula(again.doc)).toBe("C3H6O");
  expect(setAtomLabel(d, "2", "[Ac]").ok).toBe(true);
  expect(findById(d.root, "2")!.el.attrs.Element).toBe("89");
});

test("5. an abbreviation with more bonds than connection points is refused (the bonds would pile onto one point)", () => {
  const vo = `<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" Element="23"/><n id="22" p="0 10" Element="8"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><n id="24" p="10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22" Order="2"/><b id="32" B="21" E="23"/><b id="33" B="21" E="24"/></fragment><t p="0 0"><s font="3" size="10">VO</s></t></n>
<n id="2" p="-30 0"/><n id="3" p="30 0"/><n id="4" p="0 30"/><b id="5" B="1" E="2"/><b id="6" B="1" E="3"/><b id="7" B="1" E="4"/>`;
  expect(formula(page(vo))).toBe("“VO” has 3 bonds but 2 connection points in its structure, so where each bond goes is not in the file");
});

test("7. an AND (racemic) stereo group is refused, never turned absolute", () => {
  const m = Molecule.fromSmiles("C[C@H](N)C(=O)O");
  m.inventCoordinates();
  m.ensureHelperArrays(Molecule.cHelperParities);
  for (let a = 0; a < m.getAllAtoms(); a++) if (m.isAtomStereoCenter(a)) m.setAtomESR(a, Molecule.cESRTypeAnd, 0);
  const d = readCdxml(blankPageCdxml());
  if (!d.ok) throw new Error(d.reason);
  const r = moleculeToPage(d.doc, m);
  expect(r).toEqual({ ok: false, reason: "a stereocentre belongs to an AND / OR (relative or racemic) stereo group, which this page cannot draw yet — it would read as absolute" });
});

test("8. a valence taken from the drawn hydrogens is said in the notes", () => {
  const r = pageToMolecule(page('<n id="1" p="0 0" NumHydrogens="2"><t p="0 0"><s font="3" size="10">CH2</s></t></n><n id="2" p="30 0"/><n id="3" p="-30 0"/><n id="4" p="0 30"/><b id="5" B="1" E="2"/><b id="6" B="1" E="3"/><b id="7" B="1" E="4"/>'));
  expect(r.ok && r.value.notes).toEqual(["CH2 is drawn with 2 H on 3 bonds — an unusual valence for C, taken as drawn"]);
});

test("10. erasing a bond leaves both carbons shown (CH₄), never invisible atoms that still count", () => {
  const d0 = readCdxml(blankPageCdxml());
  if (!d0.ok) throw new Error(d0.reason);
  const b = addBondAt(d0.doc, [100, 100]);
  if (!b.ok) throw new Error(b.reason);
  expect(deleteInStructure(d0.doc, b.bondId)).toBeNull();
  const again = readCdxmlTree(d0.doc.root);
  if (!again.ok) throw new Error(again.reason);
  const labels = again.doc.objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => n.label?.runs.map((r) => r.text).join("")) : [])));
  expect(labels).toEqual(["CH4", "CH4"]);
});

test("11. an element outside the valence table shows the hydrogens it has (As on a chain end is AsH₂, as its formula)", () => {
  const d = page('<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/>');
  expect(setAtomLabel(d, "2", "As").ok).toBe(true);
  expect(findById(d.root, "2")!.el.attrs.NumHydrogens).toBe("2");
  const again = readCdxmlTree(d.root);
  expect(again.ok && formula(again.doc)).toBe("CH5As");
});

test("12. R and R1 on one page are refused (read as R-groups they would merge)", () => {
  const two = '<n id="1" p="0 0" NodeType="GenericNickname" GenericNickname="R"/><n id="2" p="30 0"/><n id="3" p="60 0" NodeType="GenericNickname" GenericNickname="R1"/><b id="4" B="1" E="2"/><b id="5" B="2" E="3"/>';
  expect(formula(page(two))).toBe("R and R1 are both on the page — they are different groups, but read as R-groups they would be the same one; rename R as R2 (or R1 as R)");
});

test("13. D and T are hydrogen's isotopes; 13C an isotope label", () => {
  const d = page('<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/>');
  expect(setAtomLabel(d, "2", "D").ok).toBe(true);
  let again = readCdxmlTree(d.root);
  let r = again.ok ? pageToMolecule(again.doc) : null;
  expect(r && r.ok && r.value.mol.getAtomMass(1)).toBe(2);
  expect(setAtomLabel(d, "1", "13C").ok).toBe(true);
  again = readCdxmlTree(d.root);
  r = again.ok ? pageToMolecule(again.doc) : null;
  expect(r && r.ok && r.value.mol.getAtomMass(0)).toBe(13);
});

test("15. query bond orders and lone group labels are refused by name", () => {
  expect(formula(page('<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2" Order="1 2"/>'))).toBe("a query bond (order “1 2”: any of several) has no single formula");
  expect(formula(page('<n id="1" p="0 0" NodeType="Unspecified"><t p="0 0"><s font="3" size="10">OMe</s></t></n>'))).toBe("“OMe” stands for a group bonded to something; alone it has no single formula");
});
