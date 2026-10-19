// The one-canvas fix round's own review (9 findings): each pinned. Typed labels count their hydrogens
// right (H, isotopes after a bond), abbreviations bonded at one atom read, every typed group reads on
// either side, and aromatic rings resolve by valence — the most double bonds where hydrogens are open.
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addBondFrom, findById, setAtomLabel } from "../cdxmlEdit";
import { pageToMolecule } from "../cdxmlMol";

const page = (inner: string): CdxDoc => {
  const r = readCdxml(`<CDXML BondLength="30" LabelSize="10" LabelFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1"><fragment id="10">${inner}</fragment></page></CDXML>`);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const formula = (d: CdxDoc): string => {
  const r = pageToMolecule(d);
  return r.ok ? r.value.mol.getMolecularFormula().formula : r.reason;
};
const labelOf = (d: CdxDoc, id: string): string => {
  const t = findById(d.root, id)!.el.children.find((c) => c.name === "t");
  return t ? t.children.filter((c) => c.name === "s").map((s) => s.text).join("") : "";
};
const ring = (n: number, order: string, attrs: Record<number, string> = {}): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += `<n id="${i + 1}" p="${(30 * Math.cos((2 * Math.PI * i) / n)).toFixed(2)} ${(30 * Math.sin((2 * Math.PI * i) / n)).toFixed(2)}" ${attrs[i] ?? ""}/>`;
  for (let i = 0; i < n; i++) s += `<b id="${100 + i}" B="${i + 1}" E="${((i + 1) % n) + 1}" Order="${order}"/>`;
  return s;
};
/** A chain end at x = 30 bonded to a carbon at x = 0: the end's label sits right of its bond. */
const ethane = (): CdxDoc => page('<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/>');
/** The same with the end at x = 0: its label sits left of its bond. */
const ethaneLeft = (): CdxDoc => page('<n id="1" p="30 0"/><n id="2" p="0 0"/><b id="3" B="1" E="2"/>');

describe("1. hydrogen typed on an atom is H, not HH₃", () => {
  test("H on a chain end: no hydrogens of its own, formula CH₄", () => {
    const d = ethane();
    expect(setAtomLabel(d, "2", "H").ok).toBe(true);
    expect(findById(d.root, "2")!.el.attrs.NumHydrogens).toBe("0");
    expect(labelOf(d, "2")).toBe("H");
    expect(formula(reread(d))).toBe("CH4");
  });
  test("2H (deuterium written as an isotope) the same", () => {
    const d = ethane();
    expect(setAtomLabel(d, "2", "2H").ok).toBe(true);
    expect(findById(d.root, "2")!.el.attrs.NumHydrogens).toBe("0");
    expect(labelOf(d, "2")).toBe("2H");
  });
});

test("2. a 13C label's hydrogens follow a new bond (13CH₃ → 13CH₂)", () => {
  const d = ethane();
  expect(setAtomLabel(d, "2", "13C").ok).toBe(true);
  expect(labelOf(d, "2")).toBe("13CH3");
  expect(addBondFrom(d, "2").ok).toBe(true);
  expect(labelOf(d, "2")).toBe("13CH2");
  expect(findById(d.root, "2")!.el.attrs.NumHydrogens).toBe("2");
  expect(formula(reread(d))).toBe("C3H8");
});

test("3. an abbreviation whose connection points are all on one atom takes all its bonds there (Cl₂Zr with four)", () => {
  const zr = `<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" Element="40"/><n id="22" p="0 10" Element="17"/><n id="23" p="0 -10" Element="17"/><n id="24" p="-10 0" NodeType="ExternalConnectionPoint"/><n id="25" p="10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22"/><b id="32" B="21" E="23"/><b id="33" B="21" E="24"/><b id="34" B="21" E="25"/></fragment><t p="0 0"><s font="3" size="10">Cl2Zr</s></t></n>
<n id="2" p="-30 0"/><n id="3" p="30 0"/><n id="4" p="0 30"/><n id="5" p="0 -30"/><b id="6" B="1" E="2"/><b id="7" B="1" E="3"/><b id="8" B="1" E="4"/><b id="9" B="1" E="5"/>`;
  expect(formula(page(zr))).toBe("C4H12Cl2Zr");
});

describe("4. a group typed on either side of its bond reads as that group", () => {
  test.each([
    ["OPr", "C4H10O"],
    ["C6H5", "C7H8"],
    ["N3", "CH3N3"],
    ["SO2Cl", "CH3O2ClS"],
  ])("%s left of its bond", (label, f) => {
    const d = ethaneLeft();
    expect(setAtomLabel(d, "2", label).ok).toBe(true);
    expect(formula(reread(d))).toBe(f);
  });
  test("MeO typed right of its bond is written OMe; OMe typed left of it, MeO", () => {
    const r = ethane();
    expect(setAtomLabel(r, "2", "MeO").ok).toBe(true);
    expect(labelOf(r, "2")).toBe("OMe");
    expect(formula(reread(r))).toBe("C2H6O");
    const l = ethaneLeft();
    expect(setAtomLabel(l, "2", "OMe").ok).toBe(true);
    expect(labelOf(l, "2")).toBe("MeO");
    expect(formula(reread(l))).toBe("C2H6O");
  });
  test("SCN left of its bond is N-bonded (isothiocyanate), as ChemDraw reads it; right of it, thiocyanate — kept, never rewritten as its isomer", () => {
    const l = ethaneLeft();
    expect(setAtomLabel(l, "2", "SCN").ok).toBe(true);
    const m = pageToMolecule(reread(l));
    expect(m.ok && m.value.mol.getIDCode()).toBe(Molecule.fromSmiles("CN=C=S").getIDCode());
    const r = ethane();
    expect(setAtomLabel(r, "2", "SCN")).toEqual({ ok: true, note: "SCN written right of its bond reads from its first letter — not a group this knows that way (thiocyanate), so the structure has no single formula." });
    expect(labelOf(r, "2")).toBe("SCN");
    expect(formula(reread(r))).not.toMatch(/^C/);
    for (const iso of ["NC", "OCN"]) {
      const q = ethane();
      expect(setAtomLabel(q, "2", iso).ok).toBe(true);
      expect(labelOf(q, "2")).toBe(iso);
      expect(formula(reread(q))).not.toMatch(/^C/);
    }
  });
  test("a ChemDraw label's justification says which letter bonds: right-justified SCN right of its bond is still N-bonded", () => {
    const d = page('<n id="1" p="0 0"/><n id="2" p="30 0" NodeType="Unspecified"><t p="0 0" LabelJustification="Right"><s font="3" size="10">SCN</s></t></n><b id="3" B="1" E="2"/>');
    const m = pageToMolecule(d);
    expect(m.ok && m.value.mol.getIDCode()).toBe(Molecule.fromSmiles("CN=C=S").getIDCode());
  });
});

describe("6–8. aromatic rings resolved by valence", () => {
  test("tetrazole with no hydrogens drawn on its N: one NH (CH₂N₄), not three", () => {
    const n = 'Element="7"';
    expect(formula(page(ring(5, "1.5", { 0: n, 1: n, 2: n, 3: n })))).toBe("CH2N4");
    expect(formula(page(ring(5, "1.5", { 0: 'Element="7" NumHydrogens="1"', 1: n, 2: n, 3: n })))).toBe("CH2N4");
  });
  test("pyrrole and pyridine with no hydrogens drawn on N still read right", () => {
    expect(formula(page(ring(5, "1.5", { 0: 'Element="7"' })))).toBe("C4H5N");
    expect(formula(page(ring(6, "1.5", { 0: 'Element="7"' })))).toBe("C5H5N");
  });
  const withMethyls = (k: number): string => {
    let s = ring(6, "1.5", { 0: 'Element="7" Charge="1" NumHydrogens="0"' });
    for (let i = 0; i < k; i++) s += `<n id="${50 + i}" p="${60} ${i * 20}"/><b id="${60 + i}" B="1" E="${50 + i}"/>`;
    return s;
  };
  test("N-methylpyridinium reads; an N⁺ with four bonds is refused, never given a fifth", () => {
    expect(formula(page(withMethyls(1)))).toBe("C6H8N");
    expect(formula(page(withMethyls(2)))).toMatch(/^the bonds drawn as aromatic cannot be given alternating single and double bonds/);
  });
  test("2-pyridone drawn with aromatic ring bonds and its C=O reads (the C=O carbon takes no ring double bond)", () => {
    const s = ring(6, "1.5", { 0: 'Element="7" NumHydrogens="1"' }) + '<n id="50" p="40 40" Element="8"/><b id="60" B="2" E="50" Order="2"/>';
    expect(formula(page(s))).toBe("C5H5NO");
  });
});

test("9. a lone atom drawn with its hydrogens raises no valence note", () => {
  const r = pageToMolecule(page('<n id="1" p="0 0" Element="5" NumHydrogens="0"><t p="0 0"><s font="3" size="10">B</s></t></n>'));
  expect(r.ok && r.value.notes).toEqual([]);
});

test("3b. bonds piled onto a hydrogen (an abbreviation bonded at its H) are refused, never taken as an unusual valence", () => {
  const hx = `<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" Element="1"/><n id="22" p="0 10" Element="17"/><n id="24" p="-10 0" NodeType="ExternalConnectionPoint"/><n id="25" p="10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22"/><b id="33" B="21" E="24"/><b id="34" B="21" E="25"/></fragment><t p="0 0"><s font="3" size="10">HCl</s></t></n>
<n id="2" p="-30 0"/><n id="3" p="30 0"/><b id="6" B="1" E="2"/><b id="7" B="1" E="3"/>`;
  expect(formula(page(hx))).toBe("a hydrogen atom is drawn with 3 bonds — hydrogen takes one");
});

test("an explicit H drawn before the other atoms: drawn hydrogens still apply to their own atom (OCL reorders H atoms)", () => {
  // H–C–S(H)… : the S drawn with 3 H on 1 bond (hypervalent, as drawn) — the note names S, and the formula counts its H.
  const d = page('<n id="1" p="0 0" Element="1" NumHydrogens="0"><t p="0 0"><s font="3" size="10">H</s></t></n><n id="2" p="30 0"/><n id="3" p="60 0" Element="16" NumHydrogens="3"><t p="0 0"><s font="3" size="10">SH3</s></t></n><b id="4" B="1" E="2"/><b id="5" B="2" E="3"/>');
  const r = pageToMolecule(d);
  expect(r.ok && r.value.notes).toEqual(["SH3 is drawn with 3 H on 1 bond — an unusual valence for S, taken as drawn"]);
  expect(r.ok && r.value.mol.getMolecularFormula().formula).toBe("CH6S");
  expect(r.ok && r.value.atomIds.filter(Boolean).sort()).toEqual(["1", "2", "3"]);
  expect(r.ok && r.value.mol.getAtomicNo(r.value.atomIds.indexOf("3"))).toBe(16);
});

describe("third review", () => {
  const ome = (bonds: number): string => {
    let s = '<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" Element="8"/><n id="22" p="10 0"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22"/><b id="32" B="21" E="23"/></fragment><t p="0 0"><s font="3" size="10">OMe</s></t></n>';
    for (let i = 0; i < bonds; i++) s += `<n id="${50 + i}" p="${-30} ${i * 20}"/><b id="${60 + i}" B="1" E="${50 + i}"/>`;
    return s;
  };
  test("an abbreviation with one connection point takes exactly one bond: two refused, none refused", () => {
    expect(formula(page(ome(1)))).toBe("C2H6O");
    expect(formula(page(ome(2)))).toBe("“OMe” has 2 bonds but 1 connection point in its structure, so where each bond goes is not in the file");
    expect(formula(page(ome(0)))).toMatch(/^“OMe” has 0 bonds/);
  });
  test("several points on one main-group atom take no more bonds than points", () => {
    const two = '<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" Element="8"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><n id="24" p="10 0" NodeType="ExternalConnectionPoint"/><b id="32" B="21" E="23"/><b id="33" B="21" E="24"/></fragment><t p="0 0"><s font="3" size="10">O</s></t></n><n id="2" p="-30 0"/><n id="3" p="30 0"/><n id="4" p="0 30"/><b id="5" B="1" E="2"/><b id="6" B="1" E="3"/><b id="7" B="1" E="4"/>';
    expect(formula(page(two))).toMatch(/has 3 bonds but 2 connection points/);
  });
  test("twenty separate imidazoles with no hydrogens drawn each resolve (one NH apiece)", () => {
    let s = "";
    for (let k = 0; k < 20; k++)
      for (let i = 0; i < 5; i++) s += `<n id="${k * 10 + i + 1}" p="${(k * 100 + 30 * Math.cos((2 * Math.PI * i) / 5)).toFixed(2)} ${(30 * Math.sin((2 * Math.PI * i) / 5)).toFixed(2)}"${i === 0 || i === 2 ? ' Element="7"' : ""}/>`;
    for (let k = 0; k < 20; k++) for (let i = 0; i < 5; i++) s += `<b id="${1000 + k * 10 + i}" B="${k * 10 + i + 1}" E="${k * 10 + ((i + 1) % 5) + 1}" Order="1.5"/>`;
    expect(formula(page(s))).toBe("C60H80N40");
  });
});
