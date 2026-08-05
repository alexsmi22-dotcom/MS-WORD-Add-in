// Direct tests for molgraph.ts — the shared structure-detection layer.
//
// This module had 14 exports and NO test file of its own. It was exercised only
// through the four spectra predictors that sit on top of it, which is the worst
// place to find a defect in it: a wrong ring walk or a mis-read substituent
// surfaces as a slightly-off chemical shift, and a slightly-off shift is
// indistinguishable from the additivity model's own error. A defect here is
// wrong in NMR, IR, UV-Vis and fragmentation at the same time, and looks like
// four small modelling inaccuracies rather than one bug.
//
// The tests are written against structures whose answer is not a matter of
// opinion: acetone has exactly one ketone, biphenyl's two rings are separate,
// naphthalene's are fused, and benzene's six carbons are one symmetry class.

import { Molecule } from "openchemlib/full";
import {
  neighbors,
  isCarbonyl,
  carbonylOxygen,
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

function mol(smiles: string): Molecule {
  const m = Molecule.fromSmiles(smiles);
  m.ensureHelperArrays(Molecule.cHelperRings);
  return m;
}

/** Indices of every carbon classified as a carbonyl of some kind. */
function carbonylKinds(smiles: string): CarbonylKind[] {
  const m = mol(smiles);
  const out: CarbonylKind[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const k = carbonylKind(m, a);
    if (k) out.push(k);
  }
  return out;
}

describe("neighbours and carbonyl detection", () => {
  test("neighbours are the bonded atoms, with their bond orders", () => {
    const m = mol("CC=O"); // acetaldehyde
    const ns = neighbors(m, 1);
    expect(ns.length).toBe(2);
    expect(ns.some((n) => n.order === 2)).toBe(true);
    expect(ns.some((n) => n.order === 1)).toBe(true);
  });

  test("a carbonyl carbon is one, and the carbon next to it is not", () => {
    const m = mol("CC(C)=O"); // acetone
    let carbonyls = 0;
    for (let a = 0; a < m.getAllAtoms(); a++) if (isCarbonyl(m, a)) carbonyls++;
    expect(carbonyls).toBe(1);
  });

  test("carbonylOxygen points at the doubly-bonded oxygen", () => {
    const m = mol("CC(C)=O");
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (!isCarbonyl(m, a)) continue;
      const o = carbonylOxygen(m, a);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(m.getAtomicNo(o)).toBe(8);
    }
  });

  test("an alcohol oxygen is not a carbonyl oxygen", () => {
    const m = mol("CCO");
    for (let a = 0; a < m.getAllAtoms(); a++) expect(isCarbonyl(m, a)).toBe(false);
  });

  test("an amide nitrogen is recognised, an amine nitrogen is not", () => {
    const amide = mol("CC(=O)N");
    const amine = mol("CCN");
    const anyAmideN = (m: Molecule): boolean => {
      for (let a = 0; a < m.getAllAtoms(); a++) if (m.getAtomicNo(a) === 7 && isAmideN(m, a)) return true;
      return false;
    };
    expect(anyAmideN(amide)).toBe(true);
    expect(anyAmideN(amine)).toBe(false);
  });
});

describe("carbonyl classification distinguishes the classes that matter", () => {
  const cases: [string, string, CarbonylKind][] = [
    ["acetone", "CC(C)=O", "ketone"],
    ["acetaldehyde", "CC=O", "aldehyde"],
    ["acetic acid", "CC(=O)O", "acid"],
    ["methyl acetate", "CC(=O)OC", "ester"],
    ["acetamide", "CC(=O)N", "amide"],
    ["acetyl chloride", "CC(=O)Cl", "acidHalide"],
    ["urea", "NC(=O)N", "urea"],
    ["dimethyl carbonate", "COC(=O)OC", "carbonate"],
    ["methyl carbamate", "COC(=O)N", "carbamate"],
    ["thioester", "CC(=O)SC", "thioester"],
  ];
  for (const [name, smiles, want] of cases) {
    test(`${name} is ${want}`, () => {
      expect({ name, kinds: carbonylKinds(smiles) }).toEqual({ name, kinds: [want] });
    });
  }

  test("an anhydride has two carbonyls and both are anhydride", () => {
    expect(carbonylKinds("CC(=O)OC(C)=O")).toEqual(["anhydride", "anhydride"]);
  });

  test("a carboxylate ester is not reported as an acid, which would move its IR band", () => {
    expect(carbonylKinds("CC(=O)OC")).not.toContain("acid");
  });

  test("a molecule with no carbonyl reports none", () => {
    expect(carbonylKinds("c1ccccc1")).toEqual([]);
    expect(carbonylKinds("CCO")).toEqual([]);
  });
});

// THE ASSERTION THIS FILE WAS MISSING.
//
// carbonylKind carries a twenty-line comment explaining that it returns null —
// deliberately — for every acyl environment it cannot positively NAME, so that
// callers predict nothing rather than a plausible wrong band. Every test above
// pins a kind it DOES name. None pinned the null, which is the behaviour the
// comment exists to defend, and that gap is why nmr.ts could quietly fall
// through to a generic sp2 δ 160.0 for carbon dioxide behind four green spectra
// suites (gap analysis 0.12).
describe("carbonylKind returns NULL for what it cannot name — the contract callers rely on", () => {
  /** carbonylKind for every carbon, nulls included, in atom order. */
  function everyCarbon(smiles: string): (CarbonylKind | null)[] {
    const m = mol(smiles);
    const out: (CarbonylKind | null)[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (m.getAtomicNo(a) !== 6) continue;
      out.push(carbonylKind(m, a));
    }
    return out;
  }

  test("carbon dioxide's carbon is null, not a ketone and not any other name", () => {
    // Reachable from the dictionary by typing "CO2" or "carbon dioxide".
    expect(everyCarbon("O=C=O")).toEqual([null]);
  });

  test("a ketene's carbonyl carbon is null", () => {
    expect(everyCarbon("C=C=O")).toEqual([null, null]);
  });

  test("carbon suboxide is two nulls, not two ketones", () => {
    expect(everyCarbon("O=C=C=C=O")).toEqual([null, null, null]);
  });

  test("an acyl silane's acyl carbon is null — a ketone needs two carbons on it", () => {
    // CH3 first, then the acyl carbon: only the acyl carbon is a candidate.
    expect(everyCarbon("CC(=O)[SiH3]")).toEqual([null, null]);
  });

  test("a selenoester's acyl carbon is null", () => {
    expect(everyCarbon("CC(=O)[Se]C")).toEqual([null, null, null]);
  });

  test("phosgene is null — two halides is not an acid halide", () => {
    expect(everyCarbon("O=C(Cl)Cl")).toEqual([null]);
  });

  test("an isocyanate IS named, because its band is real and distinctive", () => {
    // The null is for the unnamed; the cumulene branch still names R-N=C=O.
    expect(everyCarbon("CN=C=O")).toEqual([null, "isocyanate"]);
  });
});

describe("alkyl and conjugation", () => {
  test("a methyl on a chain is plain alkyl; a carbonyl carbon is not", () => {
    const m = mol("CCC(C)=O");
    const plain: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) if (isPlainAlkylCarbon(m, a)) plain.push(a);
    for (const a of plain) expect(isCarbonyl(m, a)).toBe(false);
    expect(plain.length).toBeGreaterThan(0);
  });

  test("an enone carbonyl is conjugated and a saturated ketone is not", () => {
    const enone = mol("CC(=O)C=C");
    const saturated = mol("CC(=O)CC");
    const anyConjugated = (m: Molecule): boolean => {
      for (let a = 0; a < m.getAllAtoms(); a++) if (isCarbonyl(m, a) && isConjugated(m, a)) return true;
      return false;
    };
    expect(anyConjugated(enone)).toBe(true);
    expect(anyConjugated(saturated)).toBe(false);
  });
});

describe("graph distances and ring topology", () => {
  test("distancesFrom counts bonds, and is zero at the start atom", () => {
    const m = mol("CCCC");
    const d = distancesFrom(m, 0);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(1);
    expect(d[3]).toBe(3);
  });

  test("benzene's ring distances are ortho, meta, para", () => {
    const m = mol("c1ccccc1");
    const d = aromaticRingDistances(m, 0).slice().sort((a, b) => a - b);
    // The origin is included at distance 0, as a distance map should be; the
    // other five are two ortho, two meta and one para.
    expect(d).toEqual([0, 1, 1, 2, 2, 3]);
  });

  // THE ONE THAT WAS A REAL BUG ONCE: the ring walk crossing biphenyl's
  // inter-ring bond, which merged two independent rings into one ten-membered
  // system and flattened every shift to 128.5.
  test("biphenyl's rings are separate and neither is fused", () => {
    const m = mol("c1ccccc1-c1ccccc1");
    const raw = aromaticRingDistances(m, 0);
    // The array is indexed by atom, with -1 for anything the walk cannot reach.
    // The FAR ring must be entirely -1: the walk stops at the inter-ring bond.
    // If it crossed, those six would come back as real distances running out to
    // 6, and every aromatic shift would collapse toward a flat 128.5 — which is
    // exactly the defect fixed in v1.54.0.
    const reachable = raw.filter((x) => x >= 0).sort((a, b) => a - b);
    const unreachable = raw.filter((x) => x < 0).length;
    expect({ reachable, unreachable }).toEqual({ reachable: [0, 1, 1, 2, 2, 3], unreachable: 6 });
    for (let a = 0; a < m.getAllAtoms(); a++) if (m.isAromaticAtom(a)) expect(isFusedAromatic(m, a)).toBe(false);
  });

  test("naphthalene HAS fused atoms and benzene does not", () => {
    const naph = mol("c1ccc2ccccc2c1");
    let fused = 0;
    for (let a = 0; a < naph.getAllAtoms(); a++) if (isFusedAromatic(naph, a)) fused++;
    expect(fused).toBeGreaterThan(0);
    const benz = mol("c1ccccc1");
    for (let a = 0; a < benz.getAllAtoms(); a++) expect(isFusedAromatic(benz, a)).toBe(false);
  });

  test("aromaticSubstituents finds the ring's attachments and no ring atoms", () => {
    const m = mol("Cc1ccccc1"); // toluene
    let found = 0;
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (!m.isAromaticAtom(a)) continue;
      for (const s of aromaticSubstituents(m, a)) {
        expect(m.isAromaticAtom(s)).toBe(false);
        found++;
      }
    }
    expect(found).toBe(1);
  });
});

describe("substituent classification", () => {
  /** The substituent hanging off the first aromatic carbon that has one. */
  function firstSubstituent(smiles: string): SubstKey | null {
    const m = mol(smiles);
    for (let a = 0; a < m.getAllAtoms(); a++) {
      if (!m.isAromaticAtom(a)) continue;
      const subs = aromaticSubstituents(m, a);
      if (subs.length) return classifySubstituent(m, subs[0], a);
    }
    return null;
  }

  const cases: [string, string, SubstKey][] = [
    ["toluene", "Cc1ccccc1", "CH3"],
    ["phenol", "Oc1ccccc1", "OH"],
    ["anisole", "COc1ccccc1", "OR"],
    ["aniline", "Nc1ccccc1", "NH2"],
    ["nitrobenzene", "O=[N+]([O-])c1ccccc1", "NO2"],
    ["benzonitrile", "N#Cc1ccccc1", "CN"],
    ["benzaldehyde", "O=Cc1ccccc1", "CHO"],
    ["benzoic acid", "OC(=O)c1ccccc1", "COOH"],
    ["chlorobenzene", "Clc1ccccc1", "Cl"],
    ["bromobenzene", "Brc1ccccc1", "Br"],
    ["fluorobenzene", "Fc1ccccc1", "F"],
    ["thiophenol", "Sc1ccccc1", "SH"],
  ];
  for (const [name, smiles, want] of cases) {
    test(`${name} carries ${want}`, () => {
      expect({ name, key: firstSubstituent(smiles) }).toEqual({ name, key: want });
    });
  }

  test("an unclassifiable substituent falls back to other rather than guessing", () => {
    const key = firstSubstituent("[Si](C)(C)(C)c1ccccc1");
    expect(key).toBe("other");
  });
});

describe("parsing and symmetry", () => {
  test("parseToMolecule accepts SMILES and returns a canonical form", () => {
    const r = parseToMolecule("CCO");
    expect(r).not.toBeNull();
    expect(r?.smiles.length).toBeGreaterThan(0);
  });

  test("nonsense input returns null rather than an empty molecule", () => {
    expect(parseToMolecule("")).toBeNull();
    expect(parseToMolecule("not a molecule at all !!!")).toBeNull();
  });

  test("benzene's six carbons are ONE symmetry class", () => {
    // If they were not, the predicted spectrum would show six aromatic signals
    // where a real one shows a single peak.
    const m = mol("c1ccccc1");
    const carbons: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) if (m.getAtomicNo(a) === 6) carbons.push(a);
    const classes = symmetryClasses(m, carbons);
    expect({ groups: classes.length, total: classes.reduce((n, g) => n + g.length, 0) }).toEqual({
      groups: 1,
      total: 6,
    });
  });

  test("toluene's ring carbons are NOT all equivalent", () => {
    const m = mol("Cc1ccccc1");
    const aromatics: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) if (m.isAromaticAtom(a)) aromatics.push(a);
    const classes = symmetryClasses(m, aromatics);
    // ipso, ortho, meta, para — four environments, not six signals and not one.
    expect(classes.length).toBe(4);
    expect(classes.reduce((n, g) => n + g.length, 0)).toBe(6);
  });

  test("every atom appears in exactly one class", () => {
    const m = mol("CC(=O)Oc1ccccc1C(=O)O"); // aspirin
    const all: number[] = [];
    for (let a = 0; a < m.getAllAtoms(); a++) all.push(a);
    const classes = symmetryClasses(m, all);
    const seen = new Set<number>();
    for (const g of classes) for (const a of g) {
      expect(seen.has(a)).toBe(false);
      seen.add(a);
    }
    expect(seen.size).toBe(all.length);
  });
});
