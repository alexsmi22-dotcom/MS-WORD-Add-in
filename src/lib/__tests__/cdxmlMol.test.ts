// The page ↔ OCL Molecule (docs/SCOPE-CHEM-CANVAS.md, stage 1). Oracles: the 359-compound dictionary
// round-trips Molecule → page → Molecule to the SAME idcode (stereo included), the public USPTO ChemDraw
// fixtures read page → Molecule → page → Molecule unchanged, and every refusal is by name.
import * as fs from "fs";
import * as path from "path";
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { readCdx } from "../cdx";
import { moleculeToPage, pageToMolecule } from "../cdxmlMol";
import { NAME_TO_SMILES } from "../compounds";

const EMPTY = `<CDXML BondLength="30" LabelSize="10" LabelFont="3" CaptionSize="12"><fonttable><font id="3" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 540 720"></page></CDXML>`;
const blank = (): CdxDoc => {
  const r = readCdxml(EMPTY);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const idOf = (m: Molecule): string => m.getIDCode();
/** Molecule → page → Molecule. */
function roundTrip(m: Molecule): { ok: true; id: string } | { ok: false; reason: string } {
  const d = blank();
  const w = moleculeToPage(d, m);
  if (!w.ok) return w;
  const r = pageToMolecule(reread(d));
  return r.ok ? { ok: true, id: idOf(r.value.mol) } : r;
}

describe("the compound dictionary, through the page and back", () => {
  test("every compound comes back with the same idcode (stereo, charges, isotopes included), or is refused by name", () => {
    const seen = new Set<string>();
    const refused = new Map<string, string[]>();
    let same = 0;
    const wrong: string[] = [];
    for (const [name, smiles] of Object.entries(NAME_TO_SMILES)) {
      if (seen.has(smiles)) continue;
      seen.add(smiles);
      let m: Molecule;
      try {
        m = Molecule.fromSmiles(smiles);
      } catch {
        continue;
      }
      m.inventCoordinates();
      const before = idOf(m);
      const r = roundTrip(m);
      if (!r.ok) (refused.get(r.reason) ?? refused.set(r.reason, []).get(r.reason)!).push(name);
      else if (r.id === before) same++;
      else wrong.push(`${name} (${smiles})`);
    }
    // A changed structure is a wrong answer: none allowed.
    expect(wrong).toEqual([]);
    // Refusals are rare and named.
    expect([...refused.keys()]).toEqual([]);
    expect(same).toBeGreaterThan(300);
  });
});

describe("wedges keep their direction", () => {
  // L-alanine drawn with its methyl on a wedge, the narrow end at the stereocentre.
  const ala = (display: string, swap: boolean): string => `<CDXML BondLength="30"><page id="1">
<fragment id="10"><n id="1" p="100 100"/><n id="2" p="126 85"/><n id="3" p="152 100" Element="7" NumHydrogens="2"/><n id="4" p="126 55"/>
<n id="5" p="100 130" Element="8" NumHydrogens="0"/><n id="6" p="74 85" Element="8" NumHydrogens="1"/>
<b id="11" B="1" E="2"/><b id="12" B="2" E="3"/><b id="13" ${swap ? 'B="4" E="2"' : 'B="2" E="4"'} Display="${display}"/><b id="14" B="1" E="6"/><b id="15" B="1" E="5" Order="2"/></fragment></page></CDXML>`;
  const read = (src: string): string => {
    const d = readCdxml(src);
    if (!d.ok) throw new Error(d.reason);
    const r = pageToMolecule(d.doc);
    if (!r.ok) throw new Error(r.reason);
    return idOf(r.value.mol);
  };
  test("…Begin from B is …End from E; a wedge and a hash are mirror images; plain is neither", () => {
    const up = read(ala("WedgeBegin", false));
    expect(read(ala("WedgeEnd", true))).toBe(up);
    const down = read(ala("WedgedHashBegin", false));
    expect(read(ala("WedgedHashEnd", true))).toBe(down);
    expect(down).not.toBe(up);
    expect(read(ala("Solid", false))).not.toBe(up);
  });
  test("and the direction is the real one: the wedge read is the stereoisomer OCL draws with the same wedge", () => {
    // Molecule from SMILES with its own wedges → page → Molecule: same idcode (both enantiomers).
    for (const s of ["C[C@H](N)C(=O)O", "C[C@@H](N)C(=O)O"]) {
      const m = Molecule.fromSmiles(s);
      m.inventCoordinates();
      const r = roundTrip(m);
      expect(r.ok && r.id).toBe(idOf(m));
    }
  });
});

describe("what the page holds that a Molecule cannot, refused by name", () => {
  const one = (inner: string): string => {
    const d = readCdxml(`<CDXML BondLength="30"><page id="1"><fragment id="10">${inner}</fragment></page></CDXML>`);
    if (!d.ok) throw new Error(d.reason);
    const r = pageToMolecule(d.doc);
    return r.ok ? `ok ${r.value.mol.getMolecularFormula().formula}` : r.reason;
  };
  test("drawn hydrogens are the structure's: a hypervalent atom keeps the H it is drawn with (what is drawn is the formula)", () => {
    expect(one('<n id="1" p="0 0" Element="7" NumHydrogens="2"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/>')).toBe("ok CH5N");
    // An N drawn NH on one bond (an aminyl): CH₄N as drawn, not methylamine's CH₅N.
    expect(one('<n id="1" p="0 0" Element="7" NumHydrogens="1"><t p="0 0"><s font="3" size="10">NH</s></t></n><n id="2" p="30 0"/><b id="3" B="1" E="2"/>')).toBe("ok CH4N");
    // SH₂ on two carbons (a hypervalent sulfurane drawn so): C₂H₈S.
    expect(one('<n id="1" p="0 0" Element="16" NumHydrogens="2"/><n id="2" p="30 0"/><n id="4" p="-30 0"/><b id="3" B="1" E="2"/><b id="5" B="1" E="4"/>')).toBe("ok C2H8S");
  });
  test("generic atoms other than R1–R16; bond orders with no exact form", () => {
    expect(one('<n id="1" p="0 0" NodeType="GenericNickname" GenericNickname="X"/>')).toBe("the generic atom X has no exact form in a structure (R1 to R16 do)");
    expect(one('<n id="1" p="0 0"/><n id="2" p="30 0" Element="26"/><b id="3" B="1" E="2" Order="dative"/>')).toBe('a bond of order "dative" has no exact form in a structure');
  });
  test("R1 is OCL's R1 (atomic number 142)", () => {
    const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0" NodeType="GenericNickname" GenericNickname="R1"/><n id="2" p="30 0"/><b id="3" B="1" E="2"/></fragment></page></CDXML>');
    const r = d.ok ? pageToMolecule(d.doc) : null;
    expect(r?.ok && r.value.mol.getAtomicNo(0)).toBe(142);
  });
  test("an abbreviation is expanded from the structure ChemDraw keeps inside it: Ph-OH is phenol", () => {
    const ph = `<n id="1" p="0 0" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0" NodeType="ExternalConnectionPoint"/><n id="22" p="30 0"/><n id="23" p="45 26"/><n id="24" p="75 26"/><n id="25" p="90 0"/><n id="26" p="75 -26"/><n id="27" p="45 -26"/><b id="31" B="21" E="22"/><b id="32" B="22" E="23" Order="2"/><b id="33" B="23" E="24"/><b id="34" B="24" E="25" Order="2"/><b id="35" B="25" E="26"/><b id="36" B="26" E="27" Order="2"/><b id="37" B="27" E="22"/></fragment><t p="0 0"><s font="3" size="10">Ph</s></t></n>`;
    expect(one(ph + '<n id="2" p="30 0" Element="8"/><b id="3" B="1" E="2"/>')).toBe("ok C6H6O");
    expect(one('<n id="1" p="0 0" NodeType="Nickname"><t p="0 0"><s font="3" size="10">Xyz</s></t></n>')).toBe("Xyz is an abbreviation this does not know as a group — its structure is not in the file");
  });
});

describe("ChemDraw drawings filed with USPTO patents (public fixtures)", () => {
  test.each(["US08262949-C00020.cdx", "US12128110-C00013.cdx"])("%s: page → Molecule → page → Molecule keeps the idcode, or is refused by name", (file) => {
    const b = readCdx(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", file))));
    if (!b.ok) throw new Error(b.reason);
    const t = readCdxmlTree(b.root);
    if (!t.ok) throw new Error(t.reason);
    const first = pageToMolecule(t.doc);
    if (!first.ok) {
      expect(first.reason).toMatch(/\S/);
      return;
    }
    const r = roundTrip(first.value.mol);
    expect(r.ok && r.id).toBe(idOf(first.value.mol));
  });
});
