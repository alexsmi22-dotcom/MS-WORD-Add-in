// Chemistry fix round 2 (fix2-chem) — every confirmed defect pinned by its exact input.
//
// Oracles:
//   RDKit 2024 (C:\Users\AlexanderSmith\jurislab-oracle-venv):
//     Chem.MolFromSmiles("c1ccnc1") / "n1cccc1" / "c1cccc1" / "c1ccccc1c" → None ("Can't kekulize mol"); "C1CC" → None
//       (unclosed ring); "c1cc[se]c1" → selenophene, "c1cc[te]c1" → tellurophene (valid aromatic Se/Te).
//     FindMolChiralCenters: D-ribopyranose C1[C@H]([C@H]([C@H](C(O1)O)O)O)O → R,R,R (+ open anomeric C);
//       D-fructopyranose C1[C@H]([C@H]([C@@H](C(O1)(CO)O)O)O)O → R,R,S (+ open anomeric C) — PubChem CIDs 10975657, 2723872.
//   OPSIN (https://opsin.ch.cam.ac.uk/opsin/<name>.smi), each read back and compared by RDKit canonical SMILES:
//     benzene-1,2,4,5-tetrol, butane-1,2,3,4-tetramine, hexane-1,2,3,4,5,6-hexol, pentane-1,2,3,4,5-pentol,
//     cyclohexane-1,2,4,5-tetrone, benzene-1,2,3,4,5,6-hexol, 3-methylidenepentane, 3-methylidenepentanoic acid,
//     5-methylidenenonane, 5-ethynylnonane, 2,6-dimethyl-4-(2-methylpropyl)heptane, 3,3-diethylpent-1-ene,
//     4-ethylhexa-1,3-diene, 1,4-di(propan-2-yl)cyclohexane, butan-2-yl acetate, 3-ethylidenepentane — all identical.
//   PubChem IUPACName (pug/compound/smiles/<smiles>/property/IUPACName): CCC(=C)CC 3-methylidenepentane, C=C(CC)CC(=O)O
//     3-methylidenepentanoic acid, C=C(CCCC)CCCC 5-methylidenenonane, C#CC(CCCC)CCCC 5-ethynylnonane,
//     CC(C)CC(CC(C)C)CC(C)C 2,6-dimethyl-4-(2-methylpropyl)heptane — all identical to the namer.
//   IUPAC Blue Book 2013: P-16.7.1(c) (benzenehexol, -tetramine), P-44.3 (chain length before unsaturation),
//     P-29.6.1 (tert-butyl IS a preferred prefix: "tert-butyldi(methyl)phosphane (PIN)"), P-29.6.3 (not isobutyl →
//     2-methylpropyl, not sec-butyl → butan-2-yl), P-61.2.3 ("di(propan-2-yl) (preferred prefix)").

import { Molecule } from "openchemlib";
import { readCdxml, readCdxmlTree } from "../cdxml";
import { addBrackets, blankPageCdxml, setAtomLabel, setCharge, writeCdxml } from "../cdxmlEdit";
import { moleculeToPage, pageToMolecule } from "../cdxmlMol";
import { renderCdx } from "../cdxmlRender";
import { checkSmiles, gallerySubstituent, renderStructure, resolveChemInput, resolveStructure, tidyOclCharges } from "../structures";
import { resultFromMolecule } from "../builder";
import { NAME_TO_SMILES } from "../compounds";
import { iupacName } from "../iupacName";
import { validateFormula } from "../chemValidate";
import { addMetalloceneTemplate } from "../organometal";

const blank = () => {
  const d = readCdxml(blankPageCdxml());
  if (!d.ok) throw new Error(d.reason);
  return d.doc;
};

/** Every atom's label as runs "text{face}", one entry per atom ("·" for a bare vertex), after moleculeToPage. */
function labelsOf(smiles: string): string[] {
  const doc = blank();
  const r = moleculeToPage(doc, Molecule.fromSmiles(smiles));
  if (!r.ok) throw new Error(r.reason);
  const frag = doc.root.children.find((c) => c.name === "page")!.children.find((c) => c.name === "fragment")!;
  return frag.children
    .filter((c) => c.name === "n")
    .map((n) => {
      const t = n.children.find((c) => c.name === "t");
      return t ? t.children.filter((s) => s.name === "s").map((s) => `${s.text}{${s.attrs.face}}`).join("") : "·";
    });
}

const nameOf = (smiles: string): string => {
  const r = iupacName(Molecule.fromSmiles(smiles)) as { name?: string; refusal?: string };
  return r.name ?? `REFUSED: ${r.refusal}`;
};

beforeAll(() => {
  renderStructure("smiles:CCO");
});

describe("1 + 9 — isolated, isotopic, charged and radical carbons are labelled; masses are superscripts on the element", () => {
  test.each([
    ["O=[13C]=O", ["O{96}", "13{64}C{96}", "O{96}"]],
    ["[13CH3]O", ["13{64}CH3{96}", "HO{96}"]],
    ["C", ["CH4{96}"]],
    ["[CH3-]", ["CH3{96}"]],
    ["[CH3]", ["CH3{96}"]],
    ["C[15NH2]", ["·", "H2{96}15{64}N{96}"]],
    ["[15NH2]C", ["15{64}NH2{96}", "·"]],
  ])("%s", (smiles, want) => {
    expect(labelsOf(smiles)).toEqual(want);
  });

  test("c1cc[13cH]cc1: the ¹³C ring atom is labelled ¹³CH, the rest bare", () => {
    const l = labelsOf("c1cc[13cH]cc1");
    expect(l.filter((x) => x !== "·")).toEqual(["13{64}CH{96}"]);
    expect(l).toHaveLength(6);
  });

  test("no mass number is ever written as a subscript (face 0x20)", () => {
    for (const s of ["O=[13C]=O", "[13CH3]O", "C[15NH2]", "c1cc[13cH]cc1", "[2H]C([2H])([2H])[13CH3]"]) for (const l of labelsOf(s)) expect(l).not.toMatch(/\d\{32\}/);
  });

  test("the page reads back as the same molecule (isotope and charge kept)", () => {
    for (const s of ["O=[13C]=O", "[CH3-]", "[CH3]", "C", "c1cc[13cH]cc1", "C[15NH2]"]) {
      const doc = blank();
      const m = Molecule.fromSmiles(s);
      const r = moleculeToPage(doc, m);
      expect(r.ok).toBe(true);
      const back = readCdxmlTree(doc.root);
      expect(back.ok).toBe(true);
      if (!back.ok) continue;
      const read = pageToMolecule(back.doc);
      expect(read.ok && read.value.mol.getCanonizedIDCode(0)).toBe(m.getCanonizedIDCode(0));
    }
  });

  test("O=¹³C=O keeps both C=O bonds visible (the mass's bond is lengthened, letters clip per glyph)", () => {
    const doc = blank();
    moleculeToPage(doc, Molecule.fromSmiles("O=[13C]=O"));
    const back = readCdxmlTree(doc.root);
    if (!back.ok) throw new Error(back.reason);
    const svg = renderCdx(back.doc)!.svg;
    // Two double bonds: four bond lines.
    expect((svg.match(/<line /g) ?? []).length).toBe(4);
  });

  test("setAtomLabel '13C' and '15N' write a superscript mass before the element", () => {
    const doc = blank();
    moleculeToPage(doc, Molecule.fromSmiles("CN"));
    const frag = doc.root.children.find((c) => c.name === "page")!.children.find((c) => c.name === "fragment")!;
    const [c, n] = frag.children.filter((x) => x.name === "n");
    expect(setAtomLabel(doc, c.attrs.id!, "13C").ok).toBe(true);
    expect(setAtomLabel(doc, n.attrs.id!, "15N").ok).toBe(true);
    const x = writeCdxml(doc.root);
    expect(x).toMatch(/face="64">13<\/s>/);
    expect(x).toMatch(/face="64">15<\/s>/);
    expect(x).not.toMatch(/face="32">1[35]<\/s>/);
  });
});

describe("2 — non-kekulisable aromatic SMILES and unclosed rings are refused by name", () => {
  test.each([
    ["c1ccnc1", /does not kekulise.*\[nH\] \(c1cc\[nH\]c1\)/],
    ["n1cccc1", /does not kekulise.*\[nH\]/],
    ["c1cccc1", /does not kekulise.*\[cH-\]/],
    ["c1ccccc1c", /atom 7 \(c\) is written aromatic .* write it as C \(c1ccccc1C\)/],
    ["C1CC", /ring bond 1 is opened but never closed/],
  ])("%s", (smiles, why) => {
    const c = checkSmiles(smiles);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.message).toMatch(why);
    const r = resolveChemInput(smiles);
    expect(r.kind).toBe("none");
    expect(resolveStructure(smiles).kind).toBe("none");
  });

  test("valid aromatics still read: pyrrole [nH], cyclopentadienide, naphthalene, a radical written in brackets", () => {
    for (const s of ["c1cc[nH]c1", "[cH-]1cccc1", "c1ccc2ccccc2c1", "[CH3]", "c1ccncc1"]) expect(checkSmiles(s).ok).toBe(true);
  });

  test("selenophene and tellurophene ([se], [te]) are accepted", () => {
    expect(resolveStructure("c1cc[se]c1").kind === "ok" && (resolveStructure("c1cc[se]c1") as { result: { formula: string } }).result.formula).toBe("C4H4Se");
    expect(resolveStructure("c1cc[te]c1").kind === "ok" && (resolveStructure("c1cc[te]c1") as { result: { formula: string } }).result.formula).toBe("C4H4Te");
  });

  test("formulas with digits are still formulas (no ring-bond complaint)", () => {
    expect(resolveChemInput("C7H8O2").kind).toBe("formula");
    expect(resolveChemInput("Fe2O3").kind).toBe("formula");
  });

  test("H99999999999O is refused: element counts are capped", () => {
    const v = validateFormula("H99999999999O");
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/above the 10,000,000-atom limit/);
    expect(resolveChemInput("H99999999999O").kind).toBe("none");
    expect(validateFormula("C169719H270466N45688O52238S911").valid).toBe(true); // titin
  });
});

describe("3 — the substituent gallery reads as Structure mode does, one * allowed", () => {
  test("CO is read as Structure mode reads it (same molecule, same note)", () => {
    const g = gallerySubstituent("CO");
    const s = resolveStructure("CO");
    expect(g.ok && s.kind === "ok" && g.result.idcode === s.result.idcode).toBe(true);
  });
  test("Co (cobalt) is a formula, refused by name — not drawn as a radical", () => {
    const g = gallerySubstituent("Co");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.message).toMatch(/cobalt/);
  });
  test("one attachment point is a substituent: *OC → CH₃O, *c1ccccc1 → C₆H₅", () => {
    const a = gallerySubstituent("*OC"), b = gallerySubstituent("*c1ccccc1");
    expect(a.ok && a.result.formula).toBe("CH3O");
    expect(b.ok && b.result.formula).toBe("C6H5");
    expect(a.ok && a.result.svg).toMatch(/>\*</);
    // Structure mode itself still refuses a lone * (no formula of its own there).
    expect(resolveStructure("*OC").kind).toBe("none");
  });
});

describe("4 — formulas carry the net charge", () => {
  test("renderStructure: tetramethylammonium C₄H₁₂N⁺, acetylcholine C₇H₁₆NO₂⁺, acetate C₂H₃O₂⁻, sodium acetate neutral", () => {
    expect(renderStructure("smiles:C[N+](C)(C)C")!.formula).toBe("C4H12N⁺");
    expect(renderStructure("smiles:CC(=O)OCC[N+](C)(C)C")!.formula).toBe("C7H16NO2⁺");
    expect(renderStructure("smiles:CC(=O)[O-]")!.formula).toBe("C2H3O2⁻");
    expect(renderStructure("smiles:[O-]S(=O)(=O)[O-]")!.formula).toBe("O4S²⁻");
    expect(renderStructure("smiles:CC(=O)[O-].[Na+]")!.formula).toBe("C2H3NaO2");
  });
  test("Build ▸ Draw readout (resultFromMolecule) too", () => {
    expect(resultFromMolecule(Molecule.fromSmiles("C[N+](C)(C)C")).formula).toMatch(/⁺$/);
  });
});

describe("5 — ribose and fructose are single stereoisomers (PubChem's D forms)", () => {
  test("PubChem isomeric SMILES of the fixture CIDs", () => {
    expect(NAME_TO_SMILES["ribose"]).toBe("C1[C@H]([C@H]([C@H](C(O1)O)O)O)O");
    expect(NAME_TO_SMILES["fructose"]).toBe("C1[C@H]([C@H]([C@@H](C(O1)(CO)O)O)O)O");
  });
});

describe("6 — multiplier vowel elision (P-16.7.1(c))", () => {
  test.each([
    ["Oc1cc(O)c(O)cc1O", "benzene-1,2,4,5-tetrol"],
    ["NCC(N)C(N)CN", "butane-1,2,3,4-tetramine"],
    ["OCC(O)C(O)C(O)C(O)CO", "hexane-1,2,3,4,5,6-hexol"],
    ["OCC(O)C(O)C(O)CO", "pentane-1,2,3,4,5-pentol"],
    ["O=C1CC(=O)C(=O)CC1=O", "cyclohexane-1,2,4,5-tetrone"],
    ["Oc1c(O)c(O)c(O)c(O)c1O", "benzene-1,2,3,4,5,6-hexol"],
    ["OCC(O)CO", "propane-1,2,3-triol"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
});

describe("7 — principal chain: length before unsaturation (P-44.3)", () => {
  test.each([
    ["CCC(=C)CC", "3-methylidenepentane"],
    ["C=C(CC)CC(=O)O", "3-methylidenepentanoic acid"],
    ["C=C(CCCC)CCCC", "5-methylidenenonane"],
    ["C#CC(CCCC)CCCC", "5-ethynylnonane"],
    ["CCC(=CC)CC", "3-ethylpent-2-ene"], // two 5-chains: the one with the C=C wins (P-44.3 (c))
    ["CCC(CC)(C=C)CC", "3,3-diethylpent-1-ene"],
    ["C=CC=C(CC)CC", "4-ethylhexa-1,3-diene"],
    ["C=CC(C)CC", "3-methylpent-1-ene"],
    ["c1ccccc1C=C", "ethenylbenzene"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test("a longest chain that would need an unsupported prefix is refused, not named by a shorter chain", () => {
    expect(nameOf("CCCCC(=CCC)CCCC")).toMatch(/^REFUSED: .*double-bonded branch/);
  });
});

describe("8 — retired prefixes and di(propan-2-yl)", () => {
  test.each([
    ["CC(C)CC(CC(C)C)CC(C)C", "2,6-dimethyl-4-(2-methylpropyl)heptane"],
    ["CCC(C)OC(C)=O", "butan-2-yl acetate"],
    ["CC(C)COC(C)=O", "2-methylpropyl acetate"],
    ["CC(C)C1CCC(C(C)C)CC1", "1,4-di(propan-2-yl)cyclohexane"],
    ["CC(C)(C)OC(C)=O", "tert-butyl acetate"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test("deuterium is refused with a correct message (not 'H is outside the subset')", () => {
    const n = nameOf("C[C@H]([2H])O");
    expect(n).toMatch(/^REFUSED: Isotope labels \(deuterium, ²H\)/);
    expect(n).not.toMatch(/H is outside/);
  });
});

describe("lower — templates, brackets, charges, pictures", () => {
  test("polymer-bound metallocene: the CH₂ linker is bent (not collinear with the ring atom and the CH)", () => {
    const doc = blank();
    expect(addMetalloceneTemplate(doc, [150, 150], "polymer-metallocene")).toBeNull();
    const frag = doc.root.children.find((c) => c.name === "page")!.children.find((c) => c.name === "fragment")!;
    const pos = new Map(frag.children.filter((c) => c.name === "n").map((n) => [n.attrs.id!, n.attrs.p.split(" ").map(Number)]));
    const deg = new Map<string, string[]>();
    for (const b of frag.children.filter((c) => c.name === "b")) {
      (deg.get(b.attrs.B) ?? deg.set(b.attrs.B, []).get(b.attrs.B)!).push(b.attrs.E);
      (deg.get(b.attrs.E) ?? deg.set(b.attrs.E, []).get(b.attrs.E)!).push(b.attrs.B);
    }
    // Every two-bonded unlabelled carbon bends (a straight one would be an invisible vertex).
    for (const n of frag.children.filter((c) => c.name === "n" && !c.children.some((t) => t.name === "t") && !c.attrs.NodeType)) {
      const nb = deg.get(n.attrs.id!) ?? [];
      if (nb.length !== 2) continue;
      const p = pos.get(n.attrs.id!)!, a = pos.get(nb[0])!, b = pos.get(nb[1])!;
      const cos = ((a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1])) / (Math.hypot(a[0] - p[0], a[1] - p[1]) * Math.hypot(b[0] - p[0], b[1] - p[1]));
      expect(cos).toBeGreaterThan(-0.97);
    }
  });

  const POLY =
    '<fragment id="100"><n id="101" p="0 10"/><n id="102" p="12.5 3"/><n id="103" p="25 10"/><n id="104" p="45 3"/>' +
    [0, 1, 2, 3, 4, 5].map((k) => `<n id="${110 + k}" p="${(25 + 14.4 * Math.cos(((-90 + 60 * k) * Math.PI) / 180)).toFixed(2)} ${(38.8 + 14.4 * Math.sin(((-90 + 60 * k) * Math.PI) / 180)).toFixed(2)}"/>`).join("") +
    '<b id="120" B="101" E="102"/><b id="121" B="102" E="103"/><b id="122" B="103" E="104"/><b id="123" B="103" E="110"/>' +
    [0, 1, 2, 3, 4, 5].map((k) => `<b id="${130 + k}" B="${110 + k}" E="${110 + ((k + 1) % 6)}"${k % 2 ? ' Order="2"' : ""}/>`).join("") +
    "</fragment>";
  const polyDoc = () => {
    const d = readCdxml(blankPageCdxml().replace(/<page ([^>]*)\/>/, `<page $1>${POLY}</page>`));
    if (!d.ok) throw new Error(d.reason);
    return d.doc;
  };

  test("polystyrene brackets: one bond through each side", () => {
    expect(addBrackets(polyDoc(), [6, -5, 40, 56])).toBeNull();
  });
  test("a box crossing bonds on one side only is refused", () => {
    expect(addBrackets(polyDoc(), [6, -5, 60, 56])).toMatch(/1 bond on the left and 0 on the right/);
  });
  test("a box cutting the ring is refused", () => {
    expect(addBrackets(polyDoc(), [6, -5, 30, 56])).toMatch(/on the right/);
  });

  test("a bracket attachment that lists two crossing bonds is read whole", () => {
    const x = blankPageCdxml().replace(
      /<page ([^>]*)\/>/,
      `<page $1>${POLY}<graphic id="200" GraphicType="Bracket" BoundingBox="6 56 6 -5"/><bracketedgroup id="201" BracketedObjectIDs="102 103" BracketUsage="SRU"><bracketattachment id="202" GraphicID="200"><crossingbond id="203" BondID="120" InnerAtomID="102"/><crossingbond id="204" BondID="122" InnerAtomID="103"/></bracketattachment></bracketedgroup></page>`,
    );
    const d = readCdxml(x);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.doc.brackets[0].attachments.map((a) => a.bondId)).toEqual(["120", "122"]);
  });

  test("setCharge refuses N³⁺ on methylamine (no expanded octet); N⁺ is fine", () => {
    const doc = blank();
    moleculeToPage(doc, Molecule.fromSmiles("CN"));
    const frag = doc.root.children.find((c) => c.name === "page")!.children.find((c) => c.name === "fragment")!;
    const n = frag.children.filter((x) => x.name === "n")[1];
    expect(setCharge(doc, n.attrs.id!, 3)).toMatch(/impossible valence/);
    expect(setCharge(doc, n.attrs.id!, 1)).toBeNull();
    expect(writeCdxml(doc.root)).toMatch(/NH3|H3N/);
  });

  test("structure pictures: true minus signs, and diazomethane's + kept off the N=N bond", () => {
    const ac = renderStructure("smiles:CC(=O)[O-]")!.svg;
    expect(ac).toMatch(/>−<\/text>/);
    expect(ac).not.toMatch(/>-<\/text>/);
    expect(renderStructure("smiles:[O-2]")!.svg).toMatch(/>2−<\/text>/);
    const dz = renderStructure("smiles:C=[N+]=[N-]")!.svg;
    const plus = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>\+<\/text>/.exec(dz)!;
    const [px, py, fs] = [Number(plus[1]), Number(plus[2]), Number(plus[3])];
    // The + box against every drawn bond line.
    for (const m of dz.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="rgb\(0,0,0\)"/g)) {
      const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
      const overlapX = Math.min(x2, px + 0.6 * fs) - Math.max(x1, px) > 0;
      const overlapY = Math.min(y1, y2) <= py + 1 && Math.max(y1, y2) >= py - 0.72 * fs - 1;
      expect(overlapX && overlapY).toBe(false);
    }
    expect(tidyOclCharges("<svg><text x=\"1\" y=\"2\" font-size=\"9\">-</text></svg>")).toContain(">−</text>");
  });

  test("charged / radical carbons inside a ring or chain stay vertices with their sign (Cp⁻, tert-butyl cation)", () => {
    expect(labelsOf("[cH-]1cccc1").every((l) => l === "·")).toBe(true);
    expect(labelsOf("C[C+](C)C").every((l) => l === "·")).toBe(true);
    expect(labelsOf("CC(=O)[CH2-]")).toContain("H2C{96}");
  });

  test("Build ▸ Draw pictures use a true minus too", () => {
    const svg = resultFromMolecule(Molecule.fromSmiles("CC(=O)[O-]")).svg;
    expect(svg).toMatch(/>−<\/text>/);
    expect(svg).not.toMatch(/>-<\/text>/);
  });

  test("Co read as a formula keeps the plain SMILES reason (no rewrite to CO, which is another substance)", () => {
    const r = resolveChemInput("Co");
    expect(r.kind === "formula" && r.note).toMatch(/lowercase \(aromatic\) atom must sit in a ring/);
  });

  test("pictures written by JurisLab contain no control characters", () => {
    expect(/[\u0000-\u0008]/.test(renderStructure("smiles:C[N+](C)(C)C")!.svg)).toBe(false);
  });
});
