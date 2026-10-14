// Independent adversarial suite for molgraph.ts — the shared exact
// structure-detection layer under NMR (nmr.ts, nmr2d.ts), IR (ir.ts), UV-Vis
// (uvvis.ts), MS fragmentation (fragment.ts) and pKa (pka.ts). A defect here is
// wrong in six tools at once and looks, from each of them, like a small
// modelling error rather than a bug.
//
// Method: a scratch probe PRINTED molgraph's answer on every structure below
// (observe, don't assert); surprises were read off the output and promoted here.
// Cross-checks never reuse molgraph's own logic. The oracles are
//   1. OpenChemLib primitives only — getConnAtom / getConnBondOrder /
//      getImplicitHydrogens / getAtomicNo / getAtomCharge / getRingSet —
//      used to verify that every atom index a detector RETURNS really carries
//      the claimed element/bond pattern, and that ring-fusion claims agree with
//      OCL's own ring set;
//   2. hand-verified textbook structures whose answer is not a matter of
//      opinion (ethyl acetate has one ester and nothing else);
//   3. index-free detection signatures, so the same molecule spelled two ways
//      (aromatic vs Kekulé, cis/trans/unmarked, R/S/unmarked, explicit [H],
//      charge-separated vs pentavalent nitro) must detect identically.
//
// Defects found by the probe and pinned below:
//   FIXED   distancesFrom(mol, from) with an out-of-range `from` wrote past the
//           array (a 3-atom molecule returned 100 entries padded with holes).
//   FIXED   carboxylate anions (acetate, benzoate, glycine zwitterion) were
//           classified "ester" — the acid/ester split read only the O-H count.
//           Now CarbonylKind "carboxylate"; every consumer handles it (see
//           the charge-aware section of carbonylCatchAll.test.ts for the
//           emitted spectra, fragments and pKa).
//   FIXED   phenoxide → "OR", anilinium/trimethylanilinium → "NH2"/"NR2": the
//           substituent classifier was charge-blind. Now "O-", "NH3+", "NR3+"
//           (and "COO-"); consumers price them only where a published value
//           exists and otherwise name and refuse them.
//   FIXED   an sp2 carbon whose double bond is to N (amidine, imine) was
//           classified "alkyl". Now "C=N", named and refused by the consumers.
//   FIXED   a nitrile oxide's nitrogen (C≡N+–O−) was reported as an isocyanide
//           nitrogen. tripleCNKind now reads the partner's element.
//   DECIDED parseToMolecule("CO") returns carbon monoxide: the formula lookup
//           runs before SMILES parsing and "CO" is both. A chemist typing CO
//           means carbon monoxide; kept, and pinned as a decision below.
//   SKIPPED diastereotopic methyls (valine's isopropyl) collapse to one
//           symmetry class under cHelperSymmetrySimple.

import { Molecule } from "openchemlib";
import {
  neighbors,
  isCarbonyl,
  carbonylOxygen,
  hasCarbonNeighbour,
  isCumulatedCentre,
  tripleCNKind,
  isAmideN,
  carbonylKind,
  isPlainAlkylCarbon,
  isConjugated,
  distancesFrom,
  aromaticRingDistances,
  isFusedAromatic,
  aromaticSubstituents,
  classifySubstituent,
  parseToMolecule,
  symmetryClasses,
  CarbonylKind,
  SubstKey,
} from "../molgraph";

// ---------------------------------------------------------------------------
// Helpers. Everything named ocl* touches ONLY OpenChemLib — no molgraph calls.
// ---------------------------------------------------------------------------

function mol(smiles: string): Molecule {
  const m = Molecule.fromSmiles(smiles);
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m;
}

interface OclNb {
  atom: number;
  order: number;
  z: number;
}

function oclNbrs(m: Molecule, a: number): OclNb[] {
  const out: OclNb[] = [];
  for (let i = 0; i < m.getConnAtoms(a); i++) {
    const atom = m.getConnAtom(a, i);
    out.push({ atom, order: m.getConnBondOrder(a, i), z: m.getAtomicNo(atom) });
  }
  return out;
}

/** Hydrogens on an atom per OCL: implicit plus any explicit H/D atoms bonded. */
function oclH(m: Molecule, a: number): number {
  return m.getImplicitHydrogens(a) + oclNbrs(m, a).filter((n) => n.z === 1).length;
}

/** True iff OCL says `c` is a carbon with exactly one O at bond order 2. */
function oclIsCarbonyl(m: Molecule, c: number): boolean {
  if (m.getAtomicNo(c) !== 6) return false;
  return oclNbrs(m, c).filter((n) => n.order === 2 && n.z === 8).length === 1;
}

/**
 * Checks, with OCL primitives only, that carbon `c` really carries the bond
 * pattern that `kind` names. Returns a reason string on mismatch, "" on success.
 */
function oclVerifyKind(m: Molecule, c: number, kind: CarbonylKind): string {
  if (!oclIsCarbonyl(m, c)) return `atom ${c} is not a C=O carbon per OCL`;
  const nb = oclNbrs(m, c);
  const co = nb.find((n) => n.order === 2 && n.z === 8)!;
  // Partners other than the carbonyl O and explicit hydrogens.
  const others = nb.filter((n) => n.atom !== co.atom && n.z !== 1);
  const singleO = others.filter((n) => n.order === 1 && n.z === 8);
  const singleN = others.filter((n) => n.order === 1 && n.z === 7);
  const singleS = others.filter((n) => n.order === 1 && n.z === 16);
  const halogen = others.filter((n) => [9, 17, 35, 53].includes(n.z));
  const carbons = others.filter((n) => n.order === 1 && n.z === 6);
  const multiple = others.filter((n) => n.order >= 2);
  const h = oclH(m, c);
  const oPartnerIsAcyl = (o: number): boolean =>
    oclNbrs(m, o).some((x) => x.atom !== c && oclIsCarbonyl(m, x.atom));
  switch (kind) {
    case "isocyanate":
      return multiple.length === 1 && multiple[0].z === 7 ? "" : "isocyanate needs C=N";
    case "carbonate":
      return singleO.length === 2 ? "" : "carbonate needs two single O";
    case "urea":
      return singleN.length === 2 ? "" : "urea needs two single N";
    case "carbamate":
      return singleO.length === 1 && singleN.length === 1 ? "" : "carbamate needs O and N";
    case "acidHalide":
      return halogen.length === 1 ? "" : "acid halide needs a halogen";
    case "anhydride":
      return singleO.length === 1 && oPartnerIsAcyl(singleO[0].atom) ? "" : "anhydride O must bridge two acyls";
    case "acid":
      if (singleO.length !== 1) return "acid needs exactly one single O";
      if (oclH(m, singleO[0].atom) < 1) return "acid O carries no H";
      if (m.getAtomCharge(singleO[0].atom) !== 0) return "acid O is charged";
      return "";
    case "carboxylate":
      if (singleO.length !== 1) return "carboxylate needs exactly one single O";
      if (m.getAtomCharge(singleO[0].atom) !== -1) return "carboxylate O is not O−";
      if (oclH(m, singleO[0].atom) !== 0) return "carboxylate O carries H";
      return "";
    case "ester":
      if (singleO.length !== 1) return "ester needs exactly one single O";
      if (oclH(m, singleO[0].atom) !== 0) return "ester O carries H";
      if (m.getAtomCharge(singleO[0].atom) !== 0) return "ester O is charged";
      if (oPartnerIsAcyl(singleO[0].atom)) return "ester O bridges to a second acyl";
      return "";
    case "amide":
      return singleN.length === 1 && singleO.length === 0 ? "" : "amide needs exactly one N";
    case "thioester":
      return singleS.length === 1 ? "" : "thioester needs one single S";
    case "aldehyde":
      return h >= 1 && singleO.length + singleN.length + singleS.length + halogen.length === 0 ? "" : "aldehyde needs H and no heteroatom partner";
    case "ketone":
      return carbons.length === 2 && others.length === 2 && h === 0 ? "" : "ketone needs two carbons";
  }
}

/** Every carbonyl kind claimed in the molecule, with its atom, verified on OCL. */
function kinds(smiles: string): { atom: number; kind: CarbonylKind }[] {
  const m = mol(smiles);
  const out: { atom: number; kind: CarbonylKind }[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const k = carbonylKind(m, a);
    if (!k) continue;
    const why = oclVerifyKind(m, a, k);
    if (why) throw new Error(`${smiles}: atom ${a} claimed ${k} but ${why}`);
    out.push({ atom: a, kind: k });
  }
  return out;
}

function kindList(smiles: string): CarbonylKind[] {
  return kinds(smiles)
    .map((k) => k.kind)
    .sort();
}

/** Substituent classes seen from aromatic atoms, with the OCL element of the root. */
function ringSubstituents(smiles: string): { z: number; charge: number; key: SubstKey }[] {
  const m = mol(smiles);
  const out: { z: number; charge: number; key: SubstKey }[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    if (!m.isAromaticAtom(a)) continue;
    for (const s of aromaticSubstituents(m, a)) {
      out.push({ z: m.getAtomicNo(s), charge: m.getAtomCharge(s), key: classifySubstituent(m, s, a) });
    }
  }
  return out;
}

function subKeys(smiles: string): SubstKey[] {
  return ringSubstituents(smiles)
    .map((s) => s.key)
    .sort();
}

const SYM: Record<number, string> = { 1: "H", 6: "C", 7: "N", 8: "O", 9: "F", 16: "S", 17: "Cl" };

/**
 * Index-free detection signature: every fact molgraph asserts about a molecule,
 * as sorted tokens. Two spellings of one molecule must give one signature.
 */
function signature(smiles: string): string {
  const m = mol(smiles);
  const tokens: string[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const z = m.getAtomicNo(a);
    const k = carbonylKind(m, a);
    if (k) tokens.push(`kind:${k}`);
    if (isAmideN(m, a)) tokens.push("amideN");
    if (tripleCNKind(m, a) === "isocyanide") tokens.push("isocyanideN");
    if (isCumulatedCentre(m, a)) tokens.push(`cumulated:${SYM[z] ?? z}`);
    if (isPlainAlkylCarbon(m, a)) tokens.push(`alkyl:h${m.getAllHydrogens(a)}`);
    if (z === 6 && isConjugated(m, a)) tokens.push("conj");
    if (m.isAromaticAtom(a)) {
      tokens.push(`arom:${SYM[z] ?? z}:${isFusedAromatic(m, a) ? "fused" : "single"}`);
      for (const s of aromaticSubstituents(m, a)) tokens.push(`sub:${classifySubstituent(m, s, a)}`);
    }
  }
  const carbons = [...Array(m.getAllAtoms()).keys()].filter((a) => m.getAtomicNo(a) === 6);
  tokens.push(`symC:${symmetryClasses(m, carbons).length}/${carbons.length}`);
  return tokens.sort().join(" ");
}

/** OCL's own view of ring fusion: an atom in two or more AROMATIC rings. */
function oclAromaticFused(m: Molecule): boolean {
  const rs = m.getRingSet();
  const count = new Array<number>(m.getAllAtoms()).fill(0);
  for (let r = 0; r < rs.getSize(); r++) {
    if (!rs.isAromatic(r)) continue;
    for (const a of rs.getRingAtoms(r)) count[a]++;
  }
  return count.some((c) => c >= 2);
}

// ---------------------------------------------------------------------------
// 1. Carbonyl classification on textbook structures, every claim OCL-verified.
// ---------------------------------------------------------------------------

describe("carbonyl classification — textbook structures, OCL-verified indices", () => {
  const TABLE: [string, string, CarbonylKind[]][] = [
    ["acetic acid", "CC(=O)O", ["acid"]],
    ["formic acid", "O=CO", ["acid"]],
    ["benzoic acid", "OC(=O)c1ccccc1", ["acid"]],
    ["glycine (neutral)", "NCC(=O)O", ["acid"]],
    ["ethyl acetate", "CC(=O)OCC", ["ester"]],
    ["methyl benzoate", "COC(=O)c1ccccc1", ["ester"]],
    ["phenyl acetate", "CC(=O)Oc1ccccc1", ["ester"]],
    ["γ-butyrolactone", "O=C1CCCO1", ["ester"]],
    ["acetamide", "CC(=O)N", ["amide"]],
    ["benzamide", "NC(=O)c1ccccc1", ["amide"]],
    ["acetanilide", "CC(=O)Nc1ccccc1", ["amide"]],
    ["2-pyrrolidone (lactam)", "O=C1CCCN1", ["amide"]],
    ["diacetamide (imide)", "CC(=O)NC(=O)C", ["amide", "amide"]],
    ["phthalimide", "O=C1NC(=O)c2ccccc12", ["amide", "amide"]],
    ["acetaldehyde", "CC=O", ["aldehyde"]],
    ["formaldehyde", "C=O", ["aldehyde"]],
    ["benzaldehyde", "O=Cc1ccccc1", ["aldehyde"]],
    ["cyclohexanone", "O=C1CCCCC1", ["ketone"]],
    ["acetone", "CC(C)=O", ["ketone"]],
    ["acetophenone", "CC(=O)c1ccccc1", ["ketone"]],
    ["benzoquinone", "O=C1C=CC(=O)C=C1", ["ketone", "ketone"]],
    ["tropone", "O=C1C=CC=CC=C1", ["ketone"]],
    ["testosterone", "C[C@]12CC[C@H]3[C@@H](CCC4=CC(=O)CC[C@@]34C)[C@@H]1CC[C@@H]2O", ["ketone"]],
    ["acetyl chloride", "CC(=O)Cl", ["acidHalide"]],
    ["acetyl bromide", "CC(=O)Br", ["acidHalide"]],
    ["acetic anhydride", "CC(=O)OC(=O)C", ["anhydride", "anhydride"]],
    ["dimethyl carbonate", "COC(=O)OC", ["carbonate"]],
    ["carbonic acid", "OC(=O)O", ["carbonate"]],
    ["urea", "NC(=O)N", ["urea"]],
    ["methyl carbamate", "COC(=O)N", ["carbamate"]],
    ["S-methyl thioacetate", "CC(=O)SC", ["thioester"]],
    ["methyl isocyanate", "CN=C=O", ["isocyanate"]],
    ["phenyl isocyanate", "O=C=Nc1ccccc1", ["isocyanate"]],
  ];
  test.each(TABLE)("%s %s → %j", (_label, smiles, expected) => {
    expect(kindList(smiles)).toEqual([...expected].sort());
  });

  test("an ester is one ester — never also a ketone, ether, acid or amide", () => {
    const m = mol("CC(=O)OCC");
    const named = kinds("CC(=O)OCC");
    expect(named).toHaveLength(1);
    expect(named[0].kind).toBe("ester");
    // Every OTHER atom answers null, and carbonylOxygen is -1 off the acyl carbon.
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (a === named[0].atom) continue;
      expect(carbonylKind(m, a)).toBeNull();
      expect(isCarbonyl(m, a)).toBe(false);
      expect(carbonylOxygen(m, a)).toBe(-1);
    }
    // The alkoxy oxygen is not an amide nitrogen, not an isocyanide, not cumulated.
    for (let a = 0; a < m.getAllAtoms(); a++) {
      expect(isAmideN(m, a)).toBe(false);
      expect(tripleCNKind(m, a) === "isocyanide").toBe(false);
      expect(isCumulatedCentre(m, a)).toBe(false);
    }
  });

  test("carbonylOxygen returns the O that OCL says is double-bonded", () => {
    for (const smi of ["CC(=O)OCC", "CC(=O)N", "O=C1CCCCC1", "CC(=O)OC(=O)C"]) {
      const m = mol(smi);
      for (const { atom } of kinds(smi)) {
        const o = carbonylOxygen(m, atom);
        expect(m.getAtomicNo(o)).toBe(8);
        const back = oclNbrs(m, o).find((n) => n.atom === atom);
        expect(back?.order).toBe(2);
      }
    }
  });

  test("the number of named carbonyls equals the number of OCL C=O carbons", () => {
    for (const smi of ["CC(=O)OCC", "CC(=O)OC(=O)C", "O=C1NC(=O)c2ccccc12", "O=C1C=CC(=O)C=C1", "CC(=O)CC(=O)OCC", "OC(=O)CC(=O)O"]) {
      const m = mol(smi);
      let ocl = 0;
      for (let a = 0; a < m.getAllAtoms(); a++) if (oclIsCarbonyl(m, a)) ocl++;
      expect(kinds(smi).length).toBe(ocl);
    }
  });

  test("ethyl acetoacetate: one ketone AND one ester, each on its own carbon", () => {
    expect(kindList("CC(=O)CC(=O)OCC")).toEqual(["ester", "ketone"]);
  });
});

describe("carbonyl classification — things that are NOT acyl", () => {
  test.each([
    ["carbon dioxide", "O=C=O"],
    ["ketene", "C=C=O"],
    ["carbon suboxide", "O=C=C=C=O"],
    ["carbon disulfide", "S=C=S"],
    ["methyl isothiocyanate", "CN=C=S"],
    ["thioacetone", "CC(=S)C"],
    ["acetyl silane", "CC(=O)[SiH3]"],
    ["carbon monoxide", "[C-]#[O+]"],
    ["acetonitrile", "CC#N"],
    ["methanol", "CO"],
    ["dimethyl ether", "COC"],
    ["vinyl alcohol (enol)", "C=CO"],
  ])("%s %s names no acyl carbonyl", (_label, smiles) => {
    expect(kindList(smiles)).toEqual([]);
  });

  test("cumulated centres: the middle carbons of allene, butatriene, CO2, ketene; never a Kekulé ring atom", () => {
    const expectCumulated = (smi: string, want: number) => {
      const m = mol(smi);
      let n = 0;
      for (let a = 0; a < m.getAllAtoms(); a++) {
        if (!isCumulatedCentre(m, a)) continue;
        n++;
        // OCL: two or more bonds of order 2 on this atom, and it is not aromatic.
        expect(oclNbrs(m, a).filter((x) => x.order === 2).length).toBeGreaterThanOrEqual(2);
        expect(m.isAromaticAtom(a)).toBe(false);
      }
      expect(n).toBe(want);
    };
    expectCumulated("C=C=C", 1);
    expectCumulated("C=C=C=C", 2);
    expectCumulated("O=C=O", 1);
    expectCumulated("C=C=O", 1);
    expectCumulated("O=C=C=C=O", 3);
    expectCumulated("c1ccccc1", 0);
    expectCumulated("C1=CC=CC=C1", 0);
    expectCumulated("C=CC=C", 0);
  });

  test("the enol tautomer of acetylacetone has one ketone, the enol carbon is not a carbonyl", () => {
    const m = mol("CC(O)=CC(C)=O");
    expect(kindList("CC(O)=CC(C)=O")).toEqual(["ketone"]);
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (carbonylKind(m, a)) expect(oclIsCarbonyl(m, a)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Aromatic and conjugated carbonyls.
// ---------------------------------------------------------------------------

describe("aromatic carbonyls and conjugation", () => {
  test("aryl carbonyls are conjugated; their aliphatic twins are not", () => {
    const conj = (smi: string): boolean[] => {
      const m = mol(smi);
      return kinds(smi).map((k) => isConjugated(m, k.atom));
    };
    expect(conj("CC(=O)c1ccccc1")).toEqual([true]);
    expect(conj("O=Cc1ccccc1")).toEqual([true]);
    expect(conj("OC(=O)c1ccccc1")).toEqual([true]);
    expect(conj("NC(=O)c1ccccc1")).toEqual([true]);
    expect(conj("COC(=O)c1ccccc1")).toEqual([true]);
    expect(conj("C/C=C/C(=O)O")).toEqual([true]); // crotonic acid, enone-type
    expect(conj("CC(=O)C")).toEqual([false]);
    expect(conj("O=C1CCCCC1")).toEqual([false]);
    expect(conj("CC(=O)O")).toEqual([false]);
    expect(conj("CC(=O)OCC")).toEqual([false]);
    // Phenyl acetate: the ring hangs off the OXYGEN, so the C=O is not conjugated.
    expect(conj("CC(=O)Oc1ccccc1")).toEqual([false]);
  });

  test("2-pyridone is an amide and 4-pyridone a (vinylogous) ketone, in either spelling", () => {
    expect(kindList("O=c1cccc[nH]1")).toEqual(["amide"]);
    expect(kindList("O=C1C=CC=CN1")).toEqual(["amide"]);
    expect(kindList("O=c1cc[nH]cc1")).toEqual(["ketone"]);
    expect(kindList("O=C1C=CNC=C1")).toEqual(["ketone"]);
  });

  test("isConjugated is ADJACENCY to a C=C or ring: butadiene inner carbons and an allylic CH2 yes, a homoallylic CH3 no", () => {
    const bd = mol("C=CC=C");
    expect(isConjugated(bd, 1)).toBe(true);
    expect(isConjugated(bd, 2)).toBe(true);
    // 1-butene: C(0)=C(1)-C(2)-C(3). Atom 2 sits on a C=C, so by the documented
    // definition it is "conjugated" (the function is meant for carbonyl carbons,
    // where that adjacency IS conjugation); atom 3 is one bond further and is not.
    const bu = mol("C=CCC");
    expect(isConjugated(bu, 2)).toBe(true);
    expect(isConjugated(bu, 3)).toBe(false);
    // Atom 0 of propane has no C=C or ring anywhere.
    expect(isConjugated(mol("CCC"), 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Amide vs amine, nitrile vs isonitrile.
// ---------------------------------------------------------------------------

describe("amide nitrogen vs amine nitrogen", () => {
  const amideNs = (smi: string): number[] => {
    const m = mol(smi);
    const out: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (!isAmideN(m, a)) continue;
      // OCL: nitrogen, single-bonded to a carbon that carries a double-bonded O.
      expect(m.getAtomicNo(a)).toBe(7);
      expect(oclNbrs(m, a).some((n) => n.order === 1 && oclIsCarbonyl(m, n.atom))).toBe(true);
      out.push(a);
    }
    return out;
  };
  test.each([
    ["acetamide", "CC(=O)N", 1],
    ["acetanilide", "CC(=O)Nc1ccccc1", 1],
    ["urea (both N)", "NC(=O)N", 2],
    ["2-pyrrolidone", "O=C1CCCN1", 1],
    ["diacetamide", "CC(=O)NC(=O)C", 1],
    ["methyl carbamate", "COC(=O)N", 1],
    ["methylamine", "CN", 0],
    ["aniline", "Nc1ccccc1", 0],
    ["N-methylaniline", "CNc1ccccc1", 0],
    ["pyrrole", "[nH]1cccc1", 0],
    ["pyridine", "n1ccccc1", 0],
    ["aminoacetone (N on the CH2, not the C=O)", "CC(=O)CN", 0],
    ["methanesulfonanilide (S acyl, not C)", "CS(=O)(=O)Nc1ccccc1", 0],
    ["acetonitrile", "CC#N", 0],
    ["methyl isocyanate (N=C, not N-C)", "CN=C=O", 0],
  ])("%s %s has %i amide N", (_label, smiles, n) => {
    expect(amideNs(smiles)).toHaveLength(n);
  });
});

describe("nitrile vs isonitrile", () => {
  const isoNs = (smi: string): number[] => {
    const m = mol(smi);
    const out: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (tripleCNKind(m, a) !== "isocyanide") continue;
      expect(m.getAtomicNo(a)).toBe(7);
      expect(oclNbrs(m, a).some((n) => n.order === 3 && n.z === 6)).toBe(true);
      expect(m.getConnAtoms(a)).toBe(2);
      out.push(a);
    }
    return out;
  };
  test("acetonitrile, benzonitrile, HCN and cyanide have NO isocyanide nitrogen", () => {
    expect(isoNs("CC#N")).toEqual([]);
    expect(isoNs("N#Cc1ccccc1")).toEqual([]);
    expect(isoNs("C#N")).toEqual([]);
    expect(isoNs("[C-]#N")).toEqual([]);
  });
  test("methyl isocyanide is flagged whether written charge-separated or neutral", () => {
    expect(isoNs("C[N+]#[C-]")).toHaveLength(1);
    expect(isoNs("CN#C")).toHaveLength(1);
    expect(isoNs("[C-]#[N+]c1ccccc1")).toHaveLength(1);
  });
  test("as ring substituents: C≡N is 'CN', N≡C is 'other' (not an amine)", () => {
    expect(subKeys("N#Cc1ccccc1")).toEqual(["CN"]);
    expect(subKeys("[C-]#[N+]c1ccccc1")).toEqual(["other"]);
  });
  // FIXED DEFECT (low): the partner's element was never checked, so a nitrile
  // oxide (R-C≡N+–O−) — nitrogen triple-bonded to carbon AND bonded to oxygen —
  // was reported as an isocyanide nitrogen. tripleCNKind now names it.
  test("PINNED FIX: a nitrile oxide's nitrogen is not an isocyanide nitrogen, and is not a nitrile either", () => {
    expect(isoNs("CC#[N+][O-]")).toEqual([]);
    const m = mol("CC#[N+][O-]");
    const kinds = [...Array(m.getAllAtoms()).keys()].map((a) => tripleCNKind(m, a)).filter((k) => k !== null);
    expect(kinds).toEqual(["nitrileOxide"]);
    expect(tripleCNKind(m, 2)).toBe("nitrileOxide");
    // The three real classes, each OCL-verified for its partner element.
    const only = (smi: string) =>
      [...Array(mol(smi).getAllAtoms()).keys()].map((a) => tripleCNKind(mol(smi), a)).filter((k) => k !== null);
    expect(only("CC#N")).toEqual(["nitrile"]);
    expect(only("C[N+]#[C-]")).toEqual(["isocyanide"]);
    expect(only("[C-]#[N+]c1ccccc1")).toEqual(["isocyanide"]);
    expect(only("[O-][N+]#Cc1ccccc1")).toEqual(["nitrileOxide"]);
    // As a ring substituent the nitrile oxide carbon is NOT "CN" (benzonitrile's row).
    expect(subKeys("[O-][N+]#Cc1ccccc1")).toEqual(["other"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Charge-blind classification (pinned, not fixed).
// ---------------------------------------------------------------------------

describe("carboxylic acid vs carboxylate", () => {
  test("neutral acids are acids, including a deuterated O–D acid and explicit-H spelling", () => {
    expect(kindList("CC(=O)O")).toEqual(["acid"]);
    expect(kindList("CC(=O)O[2H]")).toEqual(["acid"]);
    expect(kindList("[H]C([H])([H])C(=O)O[H]")).toEqual(["acid"]);
    expect(kindList("OC(=O)c1ccccc1")).toEqual(["acid"]);
  });
  test("the acid O really carries a hydrogen per OCL, the ester O really does not", () => {
    for (const [smi, want] of [
      ["CC(=O)O", 1],
      ["CC(=O)OCC", 0],
    ] as [string, number][]) {
      const m = mol(smi);
      const c = kinds(smi)[0].atom;
      const o = oclNbrs(m, c).find((n) => n.order === 1 && n.z === 8)!;
      expect(oclH(m, o.atom)).toBe(want);
    }
  });
  // FIXED DEFECT (medium): the acid/ester split was "does the single O carry an
  // H"; a carboxylate O− carries none, so every carboxylate was an "ester" and
  // got an ester's 1740 cm-1 band and ester shifts. The glycine zwitterion — a
  // dictionary amino acid — was affected. Now CarbonylKind "carboxylate".
  test("PINNED FIX: carboxylate anions are carboxylates, not esters (OCL-verified O−)", () => {
    const m = mol("CC(=O)[O-]");
    const c = kinds("CC(=O)[O-]")[0]?.atom ?? 1;
    expect(m.getAtomCharge(oclNbrs(m, c).find((n) => n.order === 1 && n.z === 8)!.atom)).toBe(-1);
    expect(kindList("CC(=O)[O-]")).toEqual(["carboxylate"]);
    expect(kindList("[O-]C(=O)c1ccccc1")).toEqual(["carboxylate"]);
    expect(kindList("[NH3+]CC(=O)[O-]")).toEqual(["carboxylate"]);
    expect(kindList("CC(=O)O")).toEqual(["acid"]);
    expect(kindList("CC(=O)OC")).toEqual(["ester"]);
    // A dianion (oxalate) and a half-neutralised diacid (hydrogen malonate).
    expect(kindList("[O-]C(=O)C(=O)[O-]")).toEqual(["carboxylate", "carboxylate"]);
    expect(kindList("OC(=O)CC(=O)[O-]")).toEqual(["acid", "carboxylate"]);
    // As a ring substituent it is "COO-", never benzoate-as-"COOR".
    expect(subKeys("[O-]C(=O)c1ccccc1")).toEqual(["COO-"]);
  });
});

describe("charged ring substituents", () => {
  test("neutral: phenol OH, aniline NH2, N-methylaniline NR2, dimethylaniline NR2", () => {
    expect(subKeys("Oc1ccccc1")).toEqual(["OH"]);
    expect(subKeys("Nc1ccccc1")).toEqual(["NH2"]);
    expect(subKeys("CNc1ccccc1")).toEqual(["NR2"]);
    expect(subKeys("CN(C)c1ccccc1")).toEqual(["NR2"]);
  });
  // FIXED DEFECT (medium): classifySubstituent never read the charge. Phenoxide
  // (O−, a far stronger donor than OH) became "OR"; anilinium (NH3+) and
  // trimethylanilinium (NMe3+), both strongly WITHDRAWING, became "NH2"/"NR2",
  // the strongest DONORS in the table — the increment was applied with the
  // wrong sign. Same shape as the nitroso→NR2 bug already fixed in this file.
  test("PINNED FIX: phenoxide, anilinium and trimethylanilinium are O-, NH3+, NR3+ (charge OCL-verified)", () => {
    expect(ringSubstituents("[O-]c1ccccc1")[0].charge).toBe(-1);
    expect(subKeys("[O-]c1ccccc1")).toEqual(["O-"]);
    expect(ringSubstituents("[NH3+]c1ccccc1")[0].charge).toBe(1);
    expect(subKeys("[NH3+]c1ccccc1")).toEqual(["NH3+"]);
    expect(subKeys("C[N+](C)(C)c1ccccc1")).toEqual(["NR3+"]);
    // Partly alkylated ammonium: no table anywhere carries it — "other", named.
    expect(subKeys("C[NH2+]c1ccccc1")).toEqual(["other"]);
    // Charge on S and an N⁻ are not thioether / amine either.
    expect(subKeys("C[S+](C)c1ccccc1")).toEqual(["other"]);
    expect(subKeys("[NH-]c1ccccc1")).toEqual(["other"]);
    // Charged nitro is still nitro, and a diazonium is still "other".
    expect(subKeys("[O-][N+](=O)c1ccccc1")).toEqual(["NO2"]);
    expect(subKeys("N#[N+]c1ccccc1")).toEqual(["other"]);
    // The neutral parents are untouched.
    expect(subKeys("Oc1ccccc1")).toEqual(["OH"]);
    expect(subKeys("COc1ccccc1")).toEqual(["OR"]);
    expect(subKeys("Nc1ccccc1")).toEqual(["NH2"]);
    expect(subKeys("CN(C)c1ccccc1")).toEqual(["NR2"]);
  });
  // FIXED DEFECT (low): the "vinyl" test looked only for C=C; an sp2 carbon whose
  // double bond goes to N (benzamidine, an aryl imine) fell through to the sp3
  // branch and was called "alkyl". An amidinium is withdrawing, alkyl is donating.
  test("PINNED FIX: an amidine/imine carbon substituent is 'C=N', not 'alkyl'", () => {
    expect(subKeys("[NH2+]=C(N)c1ccccc1")).toEqual(["C=N"]);
    expect(subKeys("N=C(N)c1ccccc1")).toEqual(["C=N"]);
    expect(subKeys("CC(=N)c1ccccc1")).toEqual(["C=N"]); // aryl ketimine
    expect(subKeys("ON=Cc1ccccc1")).toEqual(["C=N"]); // benzaldoxime
    // Styrene and ethylbenzene keep their classes.
    expect(subKeys("C=Cc1ccccc1")).toEqual(["vinyl"]);
    expect(subKeys("CCc1ccccc1")).toEqual(["alkyl"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Substituent keys — every key reached, root element OCL-verified.
// ---------------------------------------------------------------------------

describe("classifySubstituent reaches every key with the right root element", () => {
  const TABLE: [string, string, SubstKey, number][] = [
    ["fluorobenzene", "Fc1ccccc1", "F", 9],
    ["chlorobenzene", "Clc1ccccc1", "Cl", 17],
    ["bromobenzene", "Brc1ccccc1", "Br", 35],
    ["iodobenzene", "Ic1ccccc1", "I", 53],
    ["phenol", "Oc1ccccc1", "OH", 8],
    ["anisole", "COc1ccccc1", "OR", 8],
    ["phenyl vinyl ether", "C=COc1ccccc1", "OR", 8],
    ["phenyl acetate", "CC(=O)Oc1ccccc1", "OAc", 8],
    ["aniline", "Nc1ccccc1", "NH2", 7],
    ["N,N-dimethylaniline", "CN(C)c1ccccc1", "NR2", 7],
    ["acetanilide", "CC(=O)Nc1ccccc1", "NHAc", 7],
    ["nitrobenzene (charge-separated)", "[O-][N+](=O)c1ccccc1", "NO2", 7],
    ["nitrobenzene (pentavalent)", "O=N(=O)c1ccccc1", "NO2", 7],
    ["benzonitrile", "N#Cc1ccccc1", "CN", 6],
    ["benzaldehyde", "O=Cc1ccccc1", "CHO", 6],
    ["acetophenone", "CC(=O)c1ccccc1", "COR", 6],
    ["benzoyl chloride", "ClC(=O)c1ccccc1", "COR", 6],
    ["benzoic acid", "OC(=O)c1ccccc1", "COOH", 6],
    ["methyl benzoate", "COC(=O)c1ccccc1", "COOR", 6],
    ["benzamide", "NC(=O)c1ccccc1", "CONH2", 6],
    ["thiophenol", "Sc1ccccc1", "SH", 16],
    ["thioanisole", "CSc1ccccc1", "SR", 16],
    ["methyl phenyl sulfone", "CS(=O)(=O)c1ccccc1", "other", 16],
    ["benzenesulfonic acid", "OS(=O)(=O)c1ccccc1", "other", 16],
    ["methanesulfonanilide", "CS(=O)(=O)Nc1ccccc1", "other", 7],
    ["nitrosobenzene", "O=Nc1ccccc1", "other", 7],
    ["phenyl azide", "[N-]=[N+]=Nc1ccccc1", "other", 7],
    ["phenyl isocyanate", "O=C=Nc1ccccc1", "other", 7],
    ["phenyl phosphate (seen as O-R)", "OP(=O)(O)Oc1ccccc1", "OR", 8],
    ["styrene", "C=Cc1ccccc1", "vinyl", 6],
    ["phenylacetylene", "C#Cc1ccccc1", "alkynyl", 6],
    ["toluene", "Cc1ccccc1", "CH3", 6],
    ["ethylbenzene", "CCc1ccccc1", "alkyl", 6],
    ["benzyl radical", "[CH2]c1ccccc1", "alkyl", 6],
    ["trifluoromethylbenzene", "FC(F)(F)c1ccccc1", "alkyl", 6],
    ["deuterobenzene", "[2H]c1ccccc1", "other", 1],
  ];
  test.each(TABLE)("%s %s → %s", (_label, smiles, key, z) => {
    const subs = ringSubstituents(smiles);
    expect(subs).toHaveLength(1);
    expect(subs[0].key).toBe(key);
    expect(subs[0].z).toBe(z);
  });

  test("biphenyl: each ring sees the other as one Ph substituent, via a NON-aromatic bond", () => {
    const m = mol("c1ccc(cc1)-c1ccccc1");
    const subs = ringSubstituents("c1ccc(cc1)-c1ccccc1");
    expect(subs.map((s) => s.key)).toEqual(["Ph", "Ph"]);
    // OCL: the inter-ring bond has order 1 and joins two aromatic atoms.
    for (let a = 0; a < m.getAllAtoms(); a++) {
      for (const s of aromaticSubstituents(m, a)) {
        expect(m.isAromaticAtom(s)).toBe(true);
        expect(oclNbrs(m, a).find((n) => n.atom === s)?.order).toBe(1);
      }
    }
  });

  test("ring heteroatoms with implicit H have NO substituent (pyrrole N-H, imidazole N-H)", () => {
    for (const smi of ["[nH]1cccc1", "c1cnc[nH]1", "n1ccccc1", "o1cccc1", "s1cccc1"]) {
      const m = mol(smi);
      for (let a = 0; a < m.getAllAtoms(); a++) {
        expect(m.isAromaticAtom(a)).toBe(true);
        expect(aromaticSubstituents(m, a)).toEqual([]);
      }
    }
  });

  test("aromatic heterocycle hydrogen counts match the textbook (OCL foundation the predictors rely on)", () => {
    const hOn = (smi: string, z: number): number[] => {
      const m = mol(smi);
      const out: number[] = [];
      for (let a = 0; a < m.getAllAtoms(); a++) if (m.getAtomicNo(a) === z) out.push(oclH(m, a));
      return out.sort();
    };
    expect(hOn("n1ccccc1", 7)).toEqual([0]);
    expect(hOn("[nH]1cccc1", 7)).toEqual([1]);
    expect(hOn("c1cnc[nH]1", 7)).toEqual([0, 1]);
    expect(hOn("c1cnc[nH]1", 6)).toEqual([1, 1, 1]);
    expect(hOn("o1cccc1", 8)).toEqual([0]);
    expect(hOn("c1ccc2[nH]ccc2c1", 6)).toEqual([0, 0, 1, 1, 1, 1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// 6. Ring topology vs OCL's ring set.
// ---------------------------------------------------------------------------

describe("ring fusion and ring distances vs OCL's ring set", () => {
  test.each([
    ["naphthalene", "c1ccc2ccccc2c1"],
    ["indole", "c1ccc2[nH]ccc2c1"],
    ["quinoline", "n1cccc2ccccc12"],
    ["pyrene", "c1cc2ccc3cccc4ccc(c1)c2c34"],
    ["anthracene", "c1ccc2cc3ccccc3cc2c1"],
    ["biphenyl", "c1ccc(cc1)-c1ccccc1"],
    ["benzene", "c1ccccc1"],
    ["pyridine", "n1ccccc1"],
    ["decalin (no aromatic ring)", "C1CCC2CCCCC2C1"],
    ["azulene (OCL does not perceive 5+7 aromaticity; molgraph must agree, not invent)", "c1ccc2cccc2cc1"],
  ])("%s: isFusedAromatic agrees with OCL's rings-per-atom on every atom", (_label, smiles) => {
    const m = mol(smiles);
    const ocl = oclAromaticFused(m);
    for (let a = 0; a < m.getAllAtoms(); a++) {
      const claim = isFusedAromatic(m, a);
      if (!m.isAromaticAtom(a)) expect(claim).toBe(false);
      else expect(claim).toBe(ocl);
    }
  });

  test("benzene ring distances equal the shortest way round OCL's ring (2 ortho, 2 meta, 1 para)", () => {
    const m = mol("c1ccccc1");
    const ring = m.getRingSet().getRingAtoms(0);
    expect(ring).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const d = aromaticRingDistances(m, ring[i]);
      for (let j = 0; j < 6; j++) {
        const around = Math.min(Math.abs(i - j), 6 - Math.abs(i - j));
        expect(d[ring[j]]).toBe(around);
      }
      const counts = d.filter((x) => x > 0).sort();
      expect(counts).toEqual([1, 1, 2, 2, 3]);
    }
  });

  test("biphenyl: the walk never crosses the inter-ring single bond", () => {
    const m = mol("c1ccc(cc1)-c1ccccc1");
    const rs = m.getRingSet();
    expect(rs.getSize()).toBe(2);
    const ringA = new Set(rs.getRingAtoms(0));
    const ringB = new Set(rs.getRingAtoms(1));
    for (const a of ringA) {
      const d = aromaticRingDistances(m, a);
      for (const b of ringB) expect(d[b]).toBe(-1);
      for (const b of ringA) expect(d[b]).toBeGreaterThanOrEqual(0);
    }
  });

  test("distancesFrom with an `allow` that excludes the start answers -1 everywhere (no 0 leak)", () => {
    const m = mol("CCO");
    const d = distancesFrom(m, 0, () => false);
    expect(d).toEqual([-1, -1, -1]);
    expect(aromaticRingDistances(m, 0)).toEqual([-1, -1, -1]);
  });

  test("distancesFrom is a plain BFS: ethyl acetate distances from the carbonyl carbon", () => {
    const m = mol("CC(=O)OCC");
    const c = kinds("CC(=O)OCC")[0].atom;
    const d = distancesFrom(m, c);
    expect(d[c]).toBe(0);
    expect(d.filter((x) => x === 1)).toHaveLength(3);
    expect(Math.max(...d)).toBe(3);
    expect(d).toHaveLength(m.getAllAtoms());
  });
});

// ---------------------------------------------------------------------------
// 7. Hostile inputs: empty, invalid, disconnected, out-of-range, huge.
// ---------------------------------------------------------------------------

describe("hostile inputs", () => {
  test("parseToMolecule: empty, whitespace, invalid and nonsense inputs return null", () => {
    expect(parseToMolecule("")).toBeNull();
    expect(parseToMolecule("   ")).toBeNull();
    expect(parseToMolecule("C1CC")).toBeNull(); // unclosed ring
    expect(parseToMolecule("xyz")).toBeNull();
    expect(parseToMolecule("Na")).toBeNull(); // bare metal: not a SMILES organic-subset atom
  });

  test("parseToMolecule: dictionary names win, whitespace and newlines are trimmed", () => {
    expect(parseToMolecule("ethanol")?.smiles).toBe("CCO");
    expect(parseToMolecule(" CCO ")?.smiles).toBe("CCO");
    expect(parseToMolecule("CCO\n")?.smiles).toBe("CCO");
    expect(parseToMolecule("salt")?.mol.getAllAtoms()).toBe(2);
  });

  // DECISION (design): the formula table is consulted BEFORE the SMILES parser,
  // and "CO" is both the formula of carbon monoxide and the SMILES of methanol.
  // A chemist typing "CO" means carbon monoxide, so the formula wins — this
  // test pins that choice so a change to the lookup order is a deliberate one.
  // "CS", "CN", "NO" are not in the formula table and parse as SMILES; the
  // trap is specific to CO, and methanol is reachable by name or as "CO" with
  // an explicit hydrogen ("[CH3]O" / "OC").
  test("DECIDED: the input 'CO' is carbon monoxide (formula lookup first), methanol needs its name or 'OC'", () => {
    const co = parseToMolecule("CO")!;
    expect(co.mol.getAllAtoms()).toBe(2);
    // OCL writes carbon monoxide as [C-]#[O+]: one triple bond, no hydrogens.
    expect(co.mol.getAllHydrogens(0) + co.mol.getAllHydrogens(1)).toBe(0);
    expect(co.mol.getBondOrder(0)).toBe(3);
    expect(parseToMolecule("methanol")?.smiles).toBe("CO");
    expect(parseToMolecule("OC")?.smiles).toBe("CO");
  });

  test("sodium chloride: every detector answers falsy/empty and nothing throws", () => {
    const r = parseToMolecule("[Na+].[Cl-]");
    expect(r).not.toBeNull();
    const m = r!.mol;
    expect(m.getAllAtoms()).toBe(2);
    for (let a = 0; a < 2; a++) {
      expect(neighbors(m, a)).toEqual([]);
      expect(isCarbonyl(m, a)).toBe(false);
      expect(carbonylOxygen(m, a)).toBe(-1);
      expect(carbonylKind(m, a)).toBeNull();
      expect(hasCarbonNeighbour(m, a)).toBe(false);
      expect(isCumulatedCentre(m, a)).toBe(false);
      expect(tripleCNKind(m, a) === "isocyanide").toBe(false);
      expect(isAmideN(m, a)).toBe(false);
      expect(isPlainAlkylCarbon(m, a)).toBe(false);
      expect(isConjugated(m, a)).toBe(false);
      expect(isFusedAromatic(m, a)).toBe(false);
      expect(aromaticSubstituents(m, a)).toEqual([]);
      expect(aromaticRingDistances(m, a)).toEqual([-1, -1]);
    }
    // Fragments are unreachable from each other.
    expect(distancesFrom(m, 0)).toEqual([0, -1]);
    expect(distancesFrom(m, 1)).toEqual([-1, 0]);
    expect(symmetryClasses(m, [0, 1])).toEqual([[0], [1]]);
    expect(symmetryClasses(m, [])).toEqual([]);
  });

  test("hasCarbonNeighbour: the halogen of NaCl, HCl and PF6− has none; C–Cl and C–O do", () => {
    const only = (smi: string, z: number): boolean[] => {
      const m = mol(smi);
      const out: boolean[] = [];
      for (let a = 0; a < m.getAllAtoms(); a++) if (m.getAtomicNo(a) === z) out.push(hasCarbonNeighbour(m, a));
      return out;
    };
    expect(only("[Na+].[Cl-]", 17)).toEqual([false]);
    expect(only("Cl", 17)).toEqual([false]);
    expect(only("F[P-](F)(F)(F)(F)F", 9)).toEqual([false, false, false, false, false, false]);
    expect(only("CCl", 17)).toEqual([true]);
    expect(only("CCO", 8)).toEqual([true]);
    expect(only("C", 6)).toEqual([false]); // methane's carbon has no CARBON neighbour
  });

  test("a zero-atom Molecule: nothing throws", () => {
    const m = Molecule.fromSmiles("");
    expect(m.getAllAtoms()).toBe(0);
    expect(neighbors(m, 0)).toEqual([]);
    expect(carbonylKind(m, 0)).toBeNull();
    expect(isCarbonyl(m, 0)).toBe(false);
    expect(isPlainAlkylCarbon(m, 0)).toBe(false);
    expect(symmetryClasses(m, [])).toEqual([]);
    expect(distancesFrom(m, 0)).toEqual([]);
  });

  test("PINNED FIX: distancesFrom with an out-of-range start never grows the array", () => {
    const m = mol("CCO");
    // Old code: dist[99] = 0 produced a 100-entry array with 96 holes.
    expect(distancesFrom(m, 99)).toEqual([-1, -1, -1]);
    expect(distancesFrom(m, 3)).toEqual([-1, -1, -1]);
    expect(distancesFrom(m, -1)).toEqual([-1, -1, -1]);
    expect(distancesFrom(Molecule.fromSmiles(""), 0)).toEqual([]);
    expect(neighbors(m, 99)).toEqual([]);
    expect(carbonylKind(m, 99)).toBeNull();
  });

  test("200-atom chain: a full sweep of every detector over every atom stays well under 2 s", () => {
    const m = mol("C".repeat(200));
    expect(m.getAllAtoms()).toBe(200);
    const t0 = Date.now();
    for (let a = 0; a < 200; a++) {
      carbonylKind(m, a);
      isPlainAlkylCarbon(m, a);
      isConjugated(m, a);
      isFusedAromatic(m, a);
      isCumulatedCentre(m, a);
      distancesFrom(m, a);
      aromaticRingDistances(m, a);
      for (const nb of neighbors(m, a)) classifySubstituent(m, nb.atom, a);
    }
    const classes = symmetryClasses(m, [...Array(200).keys()]);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2000);
    // A linear chain is symmetric end to end: 100 classes of 2.
    expect(classes).toHaveLength(100);
    expect(classes.every((c) => c.length === 2)).toBe(true);
    // Every carbon is plain alkyl and the chain's far end is 199 bonds away.
    expect(distancesFrom(m, 0)[199]).toBe(199);
    for (let a = 0; a < 200; a++) expect(isPlainAlkylCarbon(m, a)).toBe(true);
  });

  test("a 20-ring polyacene: every atom fused, sweep bounded", () => {
    const m = mol("c1ccc2cc3cc4cc5cc6cc7cc8cc9cc%10cc%11ccccc%11cc%10cc9cc8cc7cc6cc5cc4cc3cc2c1");
    const t0 = Date.now();
    for (let a = 0; a < m.getAllAtoms(); a++) {
      expect(isFusedAromatic(m, a)).toBe(true);
      expect(aromaticRingDistances(m, a).every((d) => d >= 0)).toBe(true);
    }
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(oclAromaticFused(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Provenance: one molecule, several spellings, one detection signature.
// ---------------------------------------------------------------------------

describe("provenance — the spelling of a SMILES must not change what is detected", () => {
  test.each([
    ["benzene", ["c1ccccc1", "C1=CC=CC=C1"]],
    ["pyridine", ["n1ccccc1", "N1=CC=CC=C1", "c1ccncc1"]],
    ["furan", ["o1cccc1", "O1C=CC=C1"]],
    ["thiophene", ["s1cccc1", "S1C=CC=C1"]],
    ["pyrrole", ["[nH]1cccc1", "N1C=CC=C1"]],
    ["imidazole", ["c1cnc[nH]1", "C1=CN=CN1"]],
    ["naphthalene", ["c1ccc2ccccc2c1", "C1=CC=C2C=CC=CC2=C1"]],
    ["2-butene", ["C/C=C\\C", "C/C=C/C", "CC=CC"]],
    ["crotonic acid", ["C/C=C/C(=O)O", "CC=CC(=O)O", "OC(=O)/C=C/C"]],
    ["lactic acid", ["C[C@@H](O)C(=O)O", "C[C@H](O)C(=O)O", "CC(O)C(=O)O"]],
    ["acetic acid", ["CC(=O)O", "[H]C([H])([H])C(=O)O[H]", "OC(C)=O"]],
    ["acetaldehyde", ["CC=O", "[H]C(=O)C", "O=CC"]],
    ["nitrobenzene", ["[O-][N+](=O)c1ccccc1", "O=N(=O)c1ccccc1", "c1ccc(cc1)[N+](=O)[O-]"]],
    ["methyl isocyanide", ["C[N+]#[C-]", "CN#C"]],
    ["2-pyridone", ["O=c1cccc[nH]1", "O=C1C=CC=CN1"]],
    ["ethyl acetate", ["CC(=O)OCC", "CCOC(C)=O", "O=C(C)OCC"]],
    ["acetanilide", ["CC(=O)Nc1ccccc1", "c1ccccc1NC(C)=O"]],
    [
      "testosterone",
      [
        "C[C@]12CC[C@H]3[C@@H](CCC4=CC(=O)CC[C@@]34C)[C@@H]1CC[C@@H]2O",
        "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O",
      ],
    ],
  ])("%s", (_label, spellings) => {
    const sigs = spellings.map(signature);
    for (const s of sigs) expect(s).toBe(sigs[0]);
  });

  test("the signature is not vacuous: different molecules give different signatures", () => {
    expect(signature("CC(=O)O")).not.toBe(signature("CC(=O)OC"));
    expect(signature("c1ccccc1")).not.toBe(signature("n1ccccc1"));
    expect(signature("Nc1ccccc1")).not.toBe(signature("CC(=O)Nc1ccccc1"));
  });
});

// ---------------------------------------------------------------------------
// 9. Symmetry classes and plain-alkyl boundary.
// ---------------------------------------------------------------------------

describe("symmetry classes", () => {
  const classCount = (smi: string): number => {
    const m = mol(smi);
    const carbons = [...Array(m.getAllAtoms()).keys()].filter((a) => m.getAtomicNo(a) === 6);
    return symmetryClasses(m, carbons).length;
  };
  test.each([
    ["benzene", "c1ccccc1", 1],
    ["toluene (ipso, o, m, p, CH3)", "Cc1ccccc1", 5],
    ["ethanol", "CCO", 2],
    ["acetone", "CC(C)=O", 2],
    ["naphthalene (α, β, fusion)", "c1ccc2ccccc2c1", 3],
    ["biphenyl", "c1ccc(cc1)-c1ccccc1", 4],
    ["cyclohexane", "C1CCCCC1", 1],
    ["cyclohexanone", "O=C1CCCCC1", 4],
    ["p-xylene", "Cc1ccc(C)cc1", 3],
    ["13C-ethanol (label does not split carbons by rank)", "[13CH3]CO", 2],
    ["testosterone (no symmetry)", "C[C@]12CC[C@H]3[C@@H](CCC4=CC(=O)CC[C@@]34C)[C@@H]1CC[C@@H]2O", 19],
  ])("%s %s → %i carbon classes", (_label, smiles, n) => {
    expect(classCount(smiles)).toBe(n);
  });

  test("every class holds atoms from the requested list only, and the classes partition it", () => {
    const m = mol("Cc1ccc(C)cc1");
    const atoms = [0, 1, 2, 3];
    const cls = symmetryClasses(m, atoms);
    const flat = cls.flat().sort();
    expect(flat).toEqual([0, 1, 2, 3]);
  });

  // KNOWN SIMPLIFICATION (low): cHelperSymmetrySimple ignores stereochemistry,
  // so valine's two diastereotopic methyls (17.5 and 19.1 ppm in 13C) collapse to
  // one class and are reported as one signal. Pinned so the choice is visible.
  it.skip("diastereotopic methyls next to a stereocentre are separate classes", () => {
    expect(classCount("CC(C)[C@H](N)C(=O)O")).toBe(5);
  });
});

describe("plain alkyl carbon boundary (Grant-Paul skeleton)", () => {
  test("alkyl yes: ethanol, cyclohexane, acetone's methyls, the CH2 next to a carbonyl", () => {
    for (const [smi, atoms] of [
      ["CCO", [0, 1]],
      ["C1CCCCC1", [0, 1, 2, 3, 4, 5]],
      ["CC(C)=O", [0, 2]],
      ["CC(=O)CC", [0, 3, 4]],
    ] as [string, number[]][]) {
      const m = mol(smi);
      for (const a of atoms) {
        expect(isPlainAlkylCarbon(m, a)).toBe(true);
        // OCL: carbon, every bond order 1, not aromatic.
        expect(m.getAtomicNo(a)).toBe(6);
        expect(oclNbrs(m, a).every((n) => n.order === 1)).toBe(true);
        expect(m.isAromaticAtom(a)).toBe(false);
      }
    }
  });
  test("alkyl no: carbonyl C, nitrile C, alkene C, alkyne C, aromatic C, cumulated C, heteroatoms", () => {
    const check = (smi: string, atom: number) => {
      const m = mol(smi);
      expect(isPlainAlkylCarbon(m, atom)).toBe(false);
    };
    check("CC(=O)C", 1);
    check("CC#N", 1);
    check("CC=C", 1);
    check("CC#C", 1);
    check("c1ccccc1", 0);
    check("C1=CC=CC=C1", 0);
    check("C=C=C", 1);
    check("CCO", 2);
    check("CN", 1);
  });
  test("every carbon that is NOT plain alkyl has a multiple bond or aromatic flag per OCL (no silent exclusion)", () => {
    for (const smi of ["CC(=O)OCC", "CC(C)[C@H](N)C(=O)O", "C/C=C/C(=O)O", "Cc1ccccc1", "CC#N"]) {
      const m = mol(smi);
      for (let a = 0; a < m.getAllAtoms(); a++) {
        if (m.getAtomicNo(a) !== 6 || isPlainAlkylCarbon(m, a)) continue;
        const reason = m.isAromaticAtom(a) || oclNbrs(m, a).some((n) => n.order > 1);
        expect(reason).toBe(true);
      }
    }
  });
});
