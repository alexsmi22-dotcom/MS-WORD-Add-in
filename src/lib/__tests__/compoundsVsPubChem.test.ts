// Every compound-dictionary name, checked against PubChem's structure.
//
// WHY THIS EXISTS
// compounds.test.ts and validate-compounds.mjs only assert that each SMILES
// *parses* (getAllAtoms() > 0). A SMILES that is perfectly valid but is the WRONG
// MOLECULE for its name sails straight through — and then feeds a confident wrong
// structure, mass, spectrum and pKa into Chemical, Spectra, Mass Spec and pKa
// modes. A plausible wrong number is the worst thing this product can emit.
//
// That is not hypothetical. The first run of this check found:
//   * "alpha-tocopherol"/"vitamin e" carried only TWO aromatic methyls — alpha is
//     the 5,7,8-TRImethyl vitamer. We were shipping beta/gamma-tocopherol:
//     C28H48O2 / MW 416.69 against a true C29H50O2 / MW 430.71. A 14 Da error.
//   * "epsom salt" was anhydrous MgSO4 (MW 120.37), byte-identical to the
//     "magnesium sulfate" entry. Epsom salt IS the heptahydrate (MW 246.47).
//   * "glucose" and "galactose" had IDENTICAL SMILES — with no stereo they are
//     indistinguishable, yet they are different sugars (C4 epimers).
//
// METHOD
// Compare OUR SMILES and PUBCHEM'S SMILES by parsing BOTH through the same OCL
// canonicalizer and comparing ID codes. This is exact on connectivity: a formula
// check alone would pass a wrong isomer (1-propanol and 2-propanol are both
// C3H8O). Runs OFFLINE against a cached fixture, so it is deterministic and fast.
// Refresh the fixture with: node scripts/verify-compounds-pubchem.mjs --refresh
//
// PubChem is authoritative but NOT infallible — see FOLATE below. Every exception
// here is a reviewed human judgement, not a silenced failure.

import { Molecule } from "openchemlib";
import compounds from "../compounds.json";
import pubchem from "./fixtures/pubchem-names.json";

type PC = { cid?: number; formula?: string | null; smiles?: string | null; notFound?: boolean; error?: string };
const CACHE = pubchem as Record<string, PC>;
const NAMES = (compounds as { names: Record<string, string> }).names;

const idcode = (smiles: string): string | null => {
  try {
    const m = Molecule.fromSmiles(smiles);
    return m.getAllAtoms() ? m.getIDCode() : null;
  } catch {
    return null;
  }
};

/** Heavy-atom skeleton: bond orders, charges and stereo flattened. Tautomers share one. */
const skeleton = (smiles: string): string | null => {
  try {
    const m = Molecule.fromSmiles(smiles);
    if (!m.getAllAtoms()) return null;
    m.stripStereoInformation();
    for (let b = 0; b < m.getAllBonds(); b++) m.setBondType(b, Molecule.cBondTypeSingle);
    for (let a = 0; a < m.getAllAtoms(); a++) {
      m.setAtomCharge(a, 0);
      m.setAtomRadical(a, 0);
    }
    m.setFragment(true);
    m.ensureHelperArrays(Molecule.cHelperNeighbours);
    return m.getIDCode();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Reviewed exceptions. Each names WHY our depiction differs and is deliberate.
// Adding a name here is a chemistry decision — it must carry a reason.
// ---------------------------------------------------------------------------
const EXCEPTIONS: Record<string, string> = {
  // FOLATE: PubChem's record TITLED "Folate" (CID 135405876) is the (2R)
  // D-glutamate form. Natural folic acid is (2S) — CID 6037 — which is what we
  // ship. Matching PubChem here would INTRODUCE an error. Proof that "PubChem
  // said so" is not on its own a reason to change a structure.
  folate: "PubChem's 'Folate' title-match is (2R); natural folate is (2S) — ours is correct",

  // Tautomers: identical heavy-atom skeleton, H and double bonds placed
  // differently. Both depictions are legitimate; the substances are identical.
  //
  // arginine and histidine are deliberately NOT here. They differed by tautomer
  // AND were drawn achiral — the tautomer difference hid the missing stereo by
  // routing them out of the stereo sweep. They now carry PubChem's structure
  // outright and are covered by the exact-match test like any other entry.
  histamine: "imidazole tautomer — same skeleton",
  adenine: "purine tautomer — same skeleton",
  guanine: "purine tautomer — same skeleton",
  cytosine: "pyrimidine tautomer — same skeleton",
  heme: "porphyrin resonance/charge placement — same skeleton",
  haem: "porphyrin resonance/charge placement — same skeleton",

  // Deliberate depiction choices.
  hydrogen: "[H][H] vs PubChem's [HH] — same molecule, standard SMILES spelling",
  "calcium oxide": "ionic [Ca+2].[O-2] vs PubChem's covalent O=[Ca]; ionic is truer for CaO",
  quicklime: "ionic depiction — see calcium oxide",
  fructose: "open-chain keto form (textbook Fischer depiction); PubChem gives the cyclic form",
  ribose: "furanose — the form ribose takes in RNA, and the one this audience means",

  // Ambiguous names where PubChem picked a different member of the family.
  "sodium phosphate": "we give trisodium Na3PO4; PubChem's match is the monosodium salt",
  "iron oxide": "we give Fe2O3 (rust, the common meaning); PubChem's match is FeO2",
  "vitamin b6": "we give pyridoxine (the supplement form); PubChem's match is pyridoxal-5'-phosphate",

  // Not resolvable by this name in PubChem.
  asprin: "deliberate misspelling alias for aspirin",
  limestone: "CaCO3 — a mineral name, not a PubChem compound title",
  "vitamin d": "ambiguous between D2 and D3; we ship D3 (cholecalciferol)",
};

describe("compound dictionary vs PubChem", () => {
  const checked = Object.keys(NAMES).filter((n) => !(n in EXCEPTIONS));

  test("the fixture covers every dictionary name", () => {
    // A name with no fixture entry is an UNVERIFIED name — exactly the state this
    // whole check exists to end. Refresh the fixture or add a reviewed exception.
    const missing = Object.keys(NAMES).filter((n) => !CACHE[n] && !(n in EXCEPTIONS));
    expect(missing).toEqual([]);
  });

  test.each(checked)("%s matches PubChem's structure exactly", (name) => {
    const pc = CACHE[name];
    expect(pc).toBeDefined();
    expect(pc.notFound).toBeFalsy();
    expect(pc.smiles).toBeTruthy();

    const ours = idcode(NAMES[name]);
    const theirs = idcode(pc.smiles as string);
    expect(ours).not.toBeNull();
    expect(theirs).not.toBeNull();

    if (ours !== theirs) {
      // Give a diagnosable failure, not a bare "false !== true".
      throw new Error(
        `"${name}" does not match PubChem CID ${pc.cid}\n` +
          `  ours   : ${NAMES[name]}\n` +
          `  PubChem: ${pc.smiles}\n` +
          `  If this difference is deliberate (tautomer, naming ambiguity, or PubChem\n` +
          `  being wrong — see folate), add it to EXCEPTIONS with a reason.`
      );
    }
  });

  test("every exception is still a real dictionary entry", () => {
    // Stops EXCEPTIONS rotting into a list of names that no longer exist, which
    // would quietly stop covering anything.
    const stale = Object.keys(EXCEPTIONS).filter((n) => !(n in NAMES));
    expect(stale).toEqual([]);
  });

  test("tautomer exceptions really are tautomers, not wrong molecules", () => {
    // An exception must not become a place to hide a genuine error. For every
    // "same skeleton" exception, PROVE the skeleton actually matches.
    const claimed = Object.entries(EXCEPTIONS).filter(([, why]) => why.includes("same skeleton"));
    for (const [name] of claimed) {
      const pc = CACHE[name];
      if (!pc?.smiles) continue;
      expect(skeleton(NAMES[name])).toBe(skeleton(pc.smiles));
    }
  });
});

describe("regressions found by the first PubChem verification", () => {
  // These are pinned so the specific bugs that shipped can never come back.
  const mw = (smiles: string) => Molecule.fromSmiles(smiles).getMolecularFormula().relativeWeight;
  const formula = (smiles: string) => Molecule.fromSmiles(smiles).getMolecularFormula().formula;

  test("alpha-tocopherol is the 5,7,8-trimethyl vitamer, not beta/gamma", () => {
    for (const name of ["alpha-tocopherol", "vitamin e"]) {
      expect(formula(NAMES[name])).toBe("C29H50O2");
      expect(mw(NAMES[name])).toBeCloseTo(430.71, 1);
      // The defect was a missing aromatic methyl — count them directly.
      const m = Molecule.fromSmiles(NAMES[name]);
      m.ensureHelperArrays(Molecule.cHelperRings);
      let arMe = 0;
      for (let a = 0; a < m.getAllAtoms(); a++) {
        if (m.getAtomicNo(a) !== 6 || m.isAromaticAtom(a)) continue;
        if (m.getConnAtoms(a) !== 1 || m.getAllHydrogens(a) !== 3) continue;
        if (m.isAromaticAtom(m.getConnAtom(a, 0))) arMe++;
      }
      expect(arMe).toBe(3);
    }
  });

  test("epsom salt is the heptahydrate, and is NOT the same as magnesium sulfate", () => {
    expect(mw(NAMES["epsom salt"])).toBeCloseTo(246.47, 1);
    expect(mw(NAMES["magnesium sulfate"])).toBeCloseTo(120.37, 1);
    expect(NAMES["epsom salt"]).not.toBe(NAMES["magnesium sulfate"]);
  });

  test("glucose and galactose are distinct structures", () => {
    // They were byte-identical before stereo was added — C4 epimers collapse to
    // the same graph without it.
    expect(NAMES["glucose"]).not.toBe(NAMES["galactose"]);
    expect(idcode(NAMES["glucose"])).not.toBe(idcode(NAMES["galactose"]));
  });

  test("names that denote ONE stereoisomer actually carry stereo", () => {
    // naproxen is (S) — the (R) enantiomer is hepatotoxic. oleic acid is the cis
    // (Z) isomer; the trans isomer is elaidic acid, a different substance.
    const cip = (smiles: string) => {
      const m = Molecule.fromSmiles(smiles);
      m.ensureHelperArrays(Molecule.cHelperCIP);
      const out: string[] = [];
      for (let a = 0; a < m.getAllAtoms(); a++) {
        const p = m.getAtomCIPParity(a);
        if (p === 1) out.push("R");
        else if (p === 2) out.push("S");
      }
      return out;
    };
    expect(cip(NAMES["naproxen"])).toEqual(["S"]);
    expect(cip(NAMES["nicotine"])).toEqual(["S"]);
    expect(cip(NAMES["adrenaline"])).toEqual(["R"]);
    expect(cip(NAMES["alanine"])).toEqual(["S"]); // L-alanine

    // oleic acid: the C=C must be geometry-defined, not bare.
    const m = Molecule.fromSmiles(NAMES["oleic acid"]);
    m.ensureHelperArrays(Molecule.cHelperCIP);
    let defined = 0;
    for (let b = 0; b < m.getAllBonds(); b++) {
      if (m.getBondOrder(b) !== 2 || m.isAromaticBond(b)) continue;
      if ([1, 2].includes(m.getBondParity(b))) defined++;
    }
    expect(defined).toBeGreaterThanOrEqual(1);
  });

  test("every chiral amino acid actually carries stereochemistry", () => {
    // Glycine is the only achiral proteinogenic amino acid; every other name here
    // denotes the L form specifically, and an achiral drawing of it is wrong —
    // it depicts a racemate. arginine and histidine were the last two to be
    // caught, because their tautomer difference routed them past the stereo sweep.
    const CHIRAL = [
      "alanine", "valine", "leucine", "isoleucine", "proline", "serine",
      "threonine", "cysteine", "methionine", "aspartic acid", "glutamic acid",
      "asparagine", "glutamine", "lysine", "arginine", "histidine",
      "phenylalanine", "tyrosine", "tryptophan",
    ];
    const achiral: string[] = [];
    for (const name of CHIRAL) {
      const s = NAMES[name];
      if (!s) continue;
      const m = Molecule.fromSmiles(s);
      m.ensureHelperArrays(Molecule.cHelperCIP);
      let any = false;
      for (let a = 0; a < m.getAllAtoms(); a++) if ([1, 2].includes(m.getAtomCIPParity(a))) any = true;
      if (!any) achiral.push(name);
    }
    expect(achiral).toEqual([]);

    // Glycine must stay achiral — a stereocentre there would be an invention.
    if (NAMES["glycine"]) {
      const g = Molecule.fromSmiles(NAMES["glycine"]);
      g.ensureHelperArrays(Molecule.cHelperCIP);
      let any = false;
      for (let a = 0; a < g.getAllAtoms(); a++) if ([1, 2].includes(g.getAtomCIPParity(a))) any = true;
      expect(any).toBe(false);
    }
  });
});
