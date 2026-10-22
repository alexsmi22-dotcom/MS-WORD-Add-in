// η-bonded organometallics read as chemistry (user bug report, 2026-10-21: "Formula: —" for Cp₂ZrCl₂). The formula
// counts the atoms, however they are bonded — exact; the SMILES is the ionic form databases write, since SMILES
// cannot say "bound to the whole ring". Weights are OpenChemLib's, as every weight in the app (review: a switch to the
// IUPAC abridged table matched PubChem LESS often over its 310 compounds; PubChem: Cp₂ZrCl₂ 292.31, ferrocene 186.03).
import { TextDecoder as NodeTextDecoder } from "util";
import { Molecule } from "openchemlib";
import { readCdxml, type CdxDoc } from "../cdxml";
import { addAtomAt, addBondBetween, addRingAt, blankPageCdxml, setAtomLabel, setBond, writeCdxml } from "../cdxmlEdit";
import { addHapto, addMetalloceneTemplate, METALLOCENE_TEMPLATES, type MetalloceneTemplate } from "../organometal";
import { pageToMolecule } from "../cdxmlMol";
import { resultFromMolecule } from "../builder";
import { compoundFromMolecule, monoisotopicMass } from "../characterization";
import { repeatUnitOf } from "../polymerUnit";
import type { XNode } from "../xmlLite";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

const reread = (doc: CdxDoc): CdxDoc => {
  const r = readCdxml(writeCdxml(doc.root));
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const blank = (): CdxDoc => reread(((): CdxDoc => {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
})());
const fragOf = (doc: CdxDoc): XNode => doc.root.children.find((c) => c.name === "page")!.children.find((c) => c.name === "fragment")!;
const labelled = (doc: CdxDoc, sym: string): XNode[] => fragOf(doc).children.filter((c) => c.name === "n" && c.children.some((t) => t.name === "t" && JSON.stringify(t).includes(`"${sym}"`)));
const kekule = (m: Molecule): string => (m as unknown as { toIsomericSmiles(o: { kekulizedOutput: boolean }): string }).toIsomericSmiles({ kekulizedOutput: true });
const totalCharge = (m: Molecule): number => {
  let q = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) q += m.getAtomCharge(a);
  return q;
};
function template(kind: MetalloceneTemplate, metal = "Zr", dropChlorides = false): CdxDoc {
  let doc = blank();
  expect(addMetalloceneTemplate(doc, [200, 200], kind)).toBeNull();
  doc = reread(doc);
  if (metal !== "Zr") expect(setAtomLabel(doc, labelled(doc, "Zr")[0].attrs.id!, metal).ok).toBe(true);
  if (dropChlorides) {
    const f = fragOf(doc);
    for (const c of labelled(doc, "Cl")) f.children = f.children.filter((x) => x !== c && !(x.name === "b" && (x.attrs.B === c.attrs.id || x.attrs.E === c.attrs.id)));
  }
  return reread(doc);
}
function read(doc: CdxDoc) {
  const r = pageToMolecule(doc);
  if (!r.ok) throw new Error(r.reason);
  const res = resultFromMolecule(r.value.mol);
  return { ...r.value, formula: res.formula, mw: res.mw, smiles: kekule(r.value.mol) };
}

describe("the report's cases: a formula and weight for η-bonded metallocenes, an ionic SMILES labelled as such", () => {
  test.each([
    ["Cp₂ZrCl₂", "Zr", false, "C10H10Cl2Zr", 292.32],
    ["Cp₂TiCl₂ (the metal swapped)", "Ti", false, "C10H10Cl2Ti", 248.96],
    ["Cp₂HfCl₂ (the metal swapped)", "Hf", false, "C10H10Cl2Hf", 379.59],
    ["ferrocene, Cp₂Fe", "Fe", true, "C10H10Fe", 186.03],
  ])("%s → its formula and average weight; the charges of the ionic form balance", (_n, metal, drop, formula, mw) => {
    const r = read(template("metallocene-dichloride", metal as string, drop as boolean));
    expect(r.formula).toBe(formula);
    expect(r.mw).toBe(mw);
    expect(totalCharge(r.mol)).toBe(0);
    expect(r.ionic).toBe(true);
    expect(r.notes.join(" ")).toMatch(/the formula and weight count the atoms, however they are bonded; the SMILES is an ionic representation .* since SMILES cannot express η bonding/);
  });
  test("the SMILES is the one databases write for zirconocene dichloride", () => {
    expect(read(template("metallocene-dichloride")).smiles).toBe("[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Cl-].[Cl-].[Zr+4]");
    expect(read(template("metallocene-dichloride", "Fe", true)).smiles).toBe("[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Fe+2]");
  });
  test("the template is named for its metal", () => {
    expect(METALLOCENE_TEMPLATES.find((t) => t.id === "metallocene-dichloride")!.label).toBe("Zirconocene dichloride (Cp₂ZrCl₂)");
  });
});

describe("the other templates and the η-bond tool", () => {
  test.each([
    ["ansa-metallocene", "C12H14Cl2SiZr", 348.46],
    ["half-sandwich", "C5H5Cl3Zr", 262.68],
    ["metallocene-borohydride", "C10H18B2Zr", 251.1],
  ] as const)("%s → %s, %s g/mol, neutral overall", (kind, formula, mw) => {
    const r = read(template(kind));
    expect([r.formula, r.mw, totalCharge(r.mol)]).toEqual([formula, mw, 0]);
  });
  test("a Cp ring bound to a metal with the η-bond tool: each ring carbon keeps its one H", () => {
    const doc = blank();
    expect(addRingAt(doc, [100, 100], "cyclopentadienyl")).toBeNull();
    const ring = fragOf(doc).children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
    const zr = addAtomAt(doc, [100, 170], "Zr");
    if (!zr.ok) throw new Error(zr.reason);
    expect(addHapto(doc, ring, zr.nodeId).ok).toBe(true);
    const r = read(reread(doc));
    expect([r.formula, totalCharge(r.mol)]).toEqual(["C5H5Zr", 0]);
  });
  test("a Cp ring drawn with its single and double bonds (C=C–C=C–C) counts the same: C₅H₅, not a CH₂", () => {
    const doc = blank();
    expect(addRingAt(doc, [100, 100], "cyclopentane")).toBeNull();
    const f = fragOf(doc);
    const ring = f.children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
    const rb = f.children.filter((c) => c.name === "b");
    expect(setBond(doc, rb[0].attrs.id!, { order: "2" })).toBeNull();
    expect(setBond(doc, rb[2].attrs.id!, { order: "2" })).toBeNull();
    const fe = addAtomAt(doc, [100, 170], "Fe");
    if (!fe.ok) throw new Error(fe.reason);
    expect(addHapto(doc, ring, fe.nodeId).ok).toBe(true);
    expect(read(reread(doc)).formula).toBe("C5H5Fe");
  });
  test("a neutral arene bound η⁶ (bis(benzene)chromium half): no charge on the ring or the metal", () => {
    const doc = blank();
    expect(addRingAt(doc, [100, 100], "benzene")).toBeNull();
    const ring = fragOf(doc).children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
    const cr = addAtomAt(doc, [100, 170], "Cr");
    if (!cr.ok) throw new Error(cr.reason);
    expect(addHapto(doc, ring, cr.nodeId).ok).toBe(true);
    const r = read(reread(doc));
    expect(r.formula).toBe("C6H6Cr");
    for (let a = 0; a < r.mol.getAllAtoms(); a++) expect(r.mol.getAtomCharge(a)).toBe(0);
  });
});

describe("the two follow-ups: monoisotopic mass, and a polymer's formula per repeat unit", () => {
  test("Cp₂ZrCl₂'s monoisotopic mass is 289.9207 (⁹⁰Zr, ³⁵Cl)", () => {
    const c = compoundFromMolecule(read(template("metallocene-dichloride")).mol);
    if ("refusal" in c) throw new Error(c.refusal);
    const m = monoisotopicMass(c);
    expect(typeof m === "number" && m.toFixed(4)).toBe("289.9207");
  });
  test("the polymer-bound metallocene: (C₁₃H₁₄Cl₂Zr)ₙ — the backbone's CH₂–CH plus the metallocene, no end groups", () => {
    const r = repeatUnitOf(template("polymer-metallocene"));
    expect(r).toEqual({ ok: true, unit: { formula: "C13H14Cl2Zr", mw: 332.38 } });
  });
  test("no repeat unit without SRU brackets: a plain structure is refused by name", () => {
    expect(repeatUnitOf(template("metallocene-dichloride"))).toEqual({ ok: false, reason: expect.stringMatching(/one pair of brackets/) });
  });
});

describe("review round 1: ligands as the ions (or neutral donors) databases write", () => {
  /** A Cp ring bound η⁵ to a metal labelled `metal`, then `more` adds ligands; read as chemistry. */
  function cpComplex(metal: string, more: (doc: CdxDoc, m: string) => void, rings = 1) {
    const doc = blank();
    const ringIds: string[][] = [];
    for (let k = 0; k < rings; k++) {
      expect(addRingAt(doc, [100 + 200 * k, 100], "cyclopentadienyl")).toBeNull();
      const all = doc.root.children.find((c) => c.name === "page")!.children.filter((c) => c.name === "fragment");
      ringIds.push(all[all.length - 1].children.filter((c) => c.name === "n").map((n) => n.attrs.id!));
    }
    const m = addAtomAt(doc, [100, 170], metal);
    if (!m.ok) throw new Error(m.reason);
    for (const ring of ringIds) expect(addHapto(doc, ring, m.nodeId).ok).toBe(true);
    more(doc, m.nodeId);
    return read(reread(doc));
  }
  const ligand = (doc: CdxDoc, m: string, label: string, at: [number, number]): string => {
    const a = addAtomAt(doc, at, label);
    if (!a.ok) throw new Error(a.reason);
    const b = addBondBetween(doc, m, a.nodeId);
    if (!b.ok) throw new Error(b.reason);
    return a.nodeId;
  };
  /** An atom drawn with a hydrogen count (as ChemDraw writes "NH3", "OH", "ZrH": the element, NumHydrogens). */
  const withH = (doc: CdxDoc, id: string, h: number): void => {
    const n = fragOf(doc).children.find((c) => c.attrs.id === id) ?? doc.root.children.find((c) => c.name === "page")!.children.flatMap((f) => f.children).find((c) => c.attrs.id === id)!;
    n.attrs.NumHydrogens = String(h);
  };
  const carbonyl = (doc: CdxDoc, m: string, at: [number, number]): void => {
    const c = ligand(doc, m, "C", at);
    const o = addAtomAt(doc, [at[0], at[1] + 30], "O");
    if (!o.ok) throw new Error(o.reason);
    const b = addBondBetween(doc, c, o.nodeId);
    if (!b.ok) throw new Error(b.reason);
    expect(setBond(doc, b.bondId, { order: "3" })).toBeNull();
  };
  test("CpMn(CO)₃: CO written [C-]#[O+] and the metal Mn⁺ (Mn(I)), not Mn⁴⁺", () => {
    const r = cpComplex("Mn", (doc, m) => [0, 1, 2].forEach((k) => carbonyl(doc, m, [60 + 40 * k, 220])));
    expect(r.formula).toBe("C8H5O3Mn");
    expect(r.smiles).toContain("[C-]#[O+]");
    expect(r.smiles).toContain("[Mn+]");
    expect(totalCharge(r.mol)).toBe(0);
  });
  test("an NH₃ drawn with its three H is a neutral donor (it was refused); an OH is hydroxide", () => {
    const r = cpComplex("Zr", (doc, m) => {
      withH(doc, ligand(doc, m, "N", [60, 220]), 3);
      withH(doc, ligand(doc, m, "O", [140, 220]), 1);
    });
    expect(r.formula).toBe("C5H9NOZr");
    expect(r.smiles).toContain("[OH-]");
    expect(totalCharge(r.mol)).toBe(0);
  });
  test("Schwartz's reagent Cp₂ZrHCl, the H drawn as an atom or in the label: H⁻, and the right formula", () => {
    const asAtom = cpComplex("Zr", (doc, m) => {
      ligand(doc, m, "H", [60, 220]);
      ligand(doc, m, "Cl", [140, 220]);
    }, 2);
    const inLabel = cpComplex("Zr", (doc, m) => {
      ligand(doc, m, "Cl", [140, 220]);
      withH(doc, m, 1); // after the bond: bonding an atom sets its drawn H again
    }, 2);
    for (const r of [asAtom, inLabel]) {
      expect(r.formula).toBe("C10H11ClZr");
      expect(r.smiles).toContain("[H-]");
      expect(r.smiles).toContain("[Zr+4]");
      expect(totalCharge(r.mol)).toBe(0);
    }
  });
  test("an oxo (Cp₂Ti=O) is O²⁻ with Ti⁴⁺ — not refused, and not a hydroxide", () => {
    const r = cpComplex("Ti", (doc, m) => {
      const o = ligand(doc, m, "O", [100, 230]);
      const f = fragOf(doc).children.find((c) => c.name === "b" && (c.attrs.B === o || c.attrs.E === o))!;
      expect(setBond(doc, f.attrs.id!, { order: "2" })).toBeNull();
    }, 2);
    expect([r.formula, totalCharge(r.mol)]).toEqual(["C10H10OTi", 0]);
    expect(r.smiles).toContain("[O-2]");
  });
  test("a chloride bridging two metals keeps no hydrogen", () => {
    const doc = blank();
    const ids: string[] = [];
    for (const x of [100, 300]) {
      expect(addRingAt(doc, [x, 100], "cyclopentadienyl")).toBeNull();
      const frags = doc.root.children.find((c) => c.name === "page")!.children.filter((c) => c.name === "fragment");
      const ring = frags[frags.length - 1].children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
      const m = addAtomAt(doc, [x, 170], "Zr");
      if (!m.ok) throw new Error(m.reason);
      expect(addHapto(doc, ring, m.nodeId).ok).toBe(true);
      ids.push(m.nodeId);
    }
    const cl = addAtomAt(doc, [200, 200], "Cl");
    if (!cl.ok) throw new Error(cl.reason);
    for (const m of ids) expect(addBondBetween(doc, m, cl.nodeId).ok).toBe(true);
    const r = read(reread(doc));
    expect(r.formula).toBe("C10H10ClZr2");
    expect(totalCharge(r.mol)).toBe(0);
  });
  test("an η-bond to a non-metal is refused by name", () => {
    const doc = blank();
    expect(addRingAt(doc, [100, 100], "cyclopentadienyl")).toBeNull();
    const ring = fragOf(doc).children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
    const c = addAtomAt(doc, [100, 170], "S");
    if (!c.ok) throw new Error(c.reason);
    expect(addHapto(doc, ring, c.nodeId).ok).toBe(true);
    expect(pageToMolecule(reread(doc))).toEqual({ ok: false, reason: "an η-bond binds a ring to a metal — S is not one" });
  });
});

describe("review round 2: atom order, donors, cyanide, boranes, main-group centres", () => {
  function cp(metal: string, rings = 1): { doc: CdxDoc; m: string } {
    const doc = blank();
    const ringIds: string[][] = [];
    for (let k = 0; k < rings; k++) {
      expect(addRingAt(doc, [100 + 200 * k, 100], "cyclopentadienyl")).toBeNull();
      const all = doc.root.children.find((c) => c.name === "page")!.children.filter((c) => c.name === "fragment");
      ringIds.push(all[all.length - 1].children.filter((c) => c.name === "n").map((n) => n.attrs.id!));
    }
    const m = addAtomAt(doc, [100, 170], metal);
    if (!m.ok) throw new Error(m.reason);
    for (const ring of ringIds) expect(addHapto(doc, ring, m.nodeId).ok).toBe(true);
    return { doc, m: m.nodeId };
  }
  const atom = (doc: CdxDoc, label: string, at: [number, number]): string => {
    const a = addAtomAt(doc, at, label);
    if (!a.ok) throw new Error(a.reason);
    return a.nodeId;
  };
  const join = (doc: CdxDoc, a: string, b: string, order = "1"): void => {
    const r = addBondBetween(doc, a, b);
    if (!r.ok) throw new Error(r.reason);
    if (order !== "1") expect(setBond(doc, r.bondId, { order })).toBeNull();
  };
  test("an explicit H drawn BEFORE the metal: every atom still read as itself (hydroxide, Zr⁴⁺)", () => {
    const doc = blank();
    const h = atom(doc, "H", [40, 240]);
    const o = atom(doc, "O", [70, 240]);
    join(doc, h, o);
    expect(addRingAt(doc, [100, 100], "cyclopentadienyl")).toBeNull();
    const frags = doc.root.children.find((c) => c.name === "page")!.children.filter((c) => c.name === "fragment");
    const ring = frags[frags.length - 1].children.filter((c) => c.name === "n").map((n) => n.attrs.id!);
    const zr = atom(doc, "Zr", [100, 170]);
    expect(addHapto(doc, ring, zr).ok).toBe(true);
    join(doc, zr, o);
    join(doc, zr, atom(doc, "Cl", [140, 220]));
    const r = read(reread(doc));
    expect(r.formula).toBe("C5H6OClZr");
    expect(r.smiles).toContain("[OH-]");
    expect(r.smiles).toContain("[Zr+3]");
    expect(totalCharge(r.mol)).toBe(0);
  });
  test("PMe₃ is a neutral donor with no phantom P–H; terminal cyanide is [C-]#N", () => {
    const { doc, m } = cp("Zr");
    const p = atom(doc, "P", [60, 230]);
    for (const [x, y] of [[30, 230], [60, 260], [90, 260]] as const) join(doc, p, atom(doc, "C", [x, y]));
    join(doc, m, p);
    const c = atom(doc, "C", [150, 220]);
    join(doc, m, c);
    join(doc, c, atom(doc, "N", [180, 220]), "3");
    const r = read(reread(doc));
    expect(r.formula).toBe("C9H14NPZr");
    expect(r.smiles).not.toMatch(/PH/);
    expect(r.smiles).toContain("[C-]#N");
    expect(totalCharge(r.mol)).toBe(0);
  });
  test("the bis(borohydride) template: [BH4-] twice and Zr⁴⁺", () => {
    const r = read(template("metallocene-borohydride"));
    expect(r.smiles).toBe("[CH-]1C=CC=C1.[CH-]1C=CC=C1.[BH4-].[BH4-].[Zr+4]");
  });
  test("a Si bound to two Cp rings loses one label H per ring (SiH4 → SiH2): the label and formula agree", () => {
    const { doc, m } = cp("Si", 2);
    const n = doc.root.children.find((c) => c.name === "page")!.children.flatMap((f) => f.children).find((c) => c.attrs.id === m)!;
    expect(n.attrs.NumHydrogens).toBe("2");
    expect(read(reread(doc)).formula).toBe("C10H12Si");
  });
});
