// Structure edits driven from the 3D view (and template insertion for both
// tabs). Every function takes a molecule, returns a NEW molecule or a named
// refusal — the caller (the dialog) pushes the result through
// editor.setMolecule, which keeps the 2D editor, the undo stack, and the 3D
// regeneration in one chain with the molecule as the single source of truth.
//
// HONESTY RULE: an edit that would create impossible chemistry (a pentavalent
// carbon, a fluorine with two bonds) is refused BY NAME using the same
// complianceIssues() engine that annotates the pane — never applied silently
// so the picture "looks built" while the chemistry is broken. The check is a
// DELTA: editing a molecule that already carries a violation elsewhere is
// allowed, as long as this edit does not add a new one.
//
// Templates and attachable groups are real, published chemistry — plain
// SMILES of textbook rings, functional groups and named scaffolds. For
// attachable groups the FIRST ATOM in the SMILES is the attachment point,
// and a test pins that convention (benzene + "O" at a ring carbon must give
// exactly phenol's idcode).

import { Molecule } from "openchemlib/full";
import { complianceIssues } from "./builder";

export interface Mol3dEditResult {
  mol?: Molecule;
  error?: string;
}

const errorCount = (mol: Molecule): number => {
  try {
    return complianceIssues(mol).filter((i) => i.severity === "error").length;
  } catch {
    return 0;
  }
};

/** Runs an edit on a copy; refuses by name if it ADDS a compliance error.
 *  `reinvent` re-lays-out the 2D coordinates — only needed when NEW atoms
 *  arrived without coordinates. (Edits driven from the 3D view run on the
 *  canonical fromIDCode rebuild, whose layout is machine-invented already —
 *  the hand layout is preserved only for edits made on the editor's own
 *  molecule, and the editor's undo keeps every prior layout one Ctrl+Z away.) */
function guarded(mol: Molecule, edit: (copy: Molecule) => void, what: string, reinvent = false): Mol3dEditResult {
  const before = errorCount(mol);
  const copy = mol.getCompactCopy();
  try {
    edit(copy);
  } catch (e) {
    return { error: `Could not ${what}: ${(e as Error).message}` };
  }
  // Layout BEFORE the compliance delta: atoms added by the edit have no
  // coordinates yet, and counting their (0,0) pile-up as "drawn on top of
  // each other" would refuse perfectly legal chemistry.
  if (reinvent) copy.inventCoordinates();
  const after = errorCount(copy);
  if (after > before) {
    const issues = complianceIssues(copy).filter((i) => i.severity === "error");
    return {
      error:
        `That edit would create impossible chemistry — ${issues[issues.length - 1]?.message ?? "a valence violation"} ` +
        "Nothing was changed.",
    };
  }
  return { mol: copy };
}

/** Changes the element of one atom (implicit hydrogens re-derive). */
export function changeElement(mol: Molecule, atom: number, atomicNo: number): Mol3dEditResult {
  if (atom < 0 || atom >= mol.getAllAtoms()) return { error: "That atom no longer exists." };
  return guarded(mol, (m) => m.setAtomicNo(atom, atomicNo), "change the element");
}

/** Deletes one atom (its bonds go with it). */
export function deleteAtomIn(mol: Molecule, atom: number): Mol3dEditResult {
  if (atom < 0 || atom >= mol.getAllAtoms()) return { error: "That atom no longer exists." };
  const copy = mol.getCompactCopy();
  try {
    copy.deleteAtom(atom);
  } catch (e) {
    return { error: `Could not delete the atom: ${(e as Error).message}` };
  }
  return { mol: copy };
}

/** Sets a bond to single/double/triple; refuses valence-impossible orders. */
export function setBondOrderIn(mol: Molecule, bond: number, order: 1 | 2 | 3): Mol3dEditResult {
  if (bond < 0 || bond >= mol.getAllBonds()) return { error: "That bond no longer exists." };
  const type = order === 1 ? Molecule.cBondTypeSingle : order === 2 ? Molecule.cBondTypeDouble : Molecule.cBondTypeTriple;
  return guarded(mol, (m) => m.setBondType(bond, type), "change the bond order");
}

/** Deletes one bond (the molecule may fall into fragments — that is legal). */
export function deleteBondIn(mol: Molecule, bond: number): Mol3dEditResult {
  if (bond < 0 || bond >= mol.getAllBonds()) return { error: "That bond no longer exists." };
  const copy = mol.getCompactCopy();
  try {
    copy.deleteBond(bond);
  } catch (e) {
    return { error: `Could not delete the bond: ${(e as Error).message}` };
  }
  return { mol: copy };
}

/**
 * Attaches a group (first SMILES atom = attachment point) to `atom` with a
 * single bond. Valence is the guard's problem; geometry is re-invented so the
 * 2D editor shows a sane layout and the 3D view regenerates its conformer.
 */
export function attachFragment(mol: Molecule, atom: number, smiles: string): Mol3dEditResult {
  if (atom < 0 || atom >= mol.getAllAtoms()) return { error: "That atom no longer exists." };
  let frag: Molecule;
  try {
    frag = Molecule.fromSmiles(smiles);
  } catch (e) {
    return { error: `The group could not be read: ${(e as Error).message}` };
  }
  if (frag.getAllAtoms() === 0) return { error: "The group is empty." };
  const firstNew = mol.getAllAtoms();
  return guarded(
    mol,
    (m) => {
      m.addMolecule(frag);
      const bond = m.addBond(atom, firstNew);
      m.setBondType(bond, Molecule.cBondTypeSingle);
      // A SMILES bracket atom whose H count leaves a valence slot open
      // ([N+](=O)[O-] standalone) gets that slot booked by the parser as a
      // RADICAL (probed: the nitro N arrives with radical state 32), and
      // some pin it via the abnormal-valence field instead. Both survive
      // addMolecule; both were true of the STANDALONE ion only. Left in
      // place they fail the valence check and encode a DIFFERENT idcode
      // than the same molecule drawn whole (benzene + nitro ≠ nitrobenzene
      // until cleared). The new bond now fills that slot — clear the
      // bookkeeping so normal charge-adjusted valence rules apply.
      for (let a = firstNew; a < m.getAllAtoms(); a++) {
        if (m.getAtomAbnormalValence(a) >= 0) m.setAtomAbnormalValence(a, -1);
        if (m.getAtomRadical(a) !== 0) m.setAtomRadical(a, 0);
      }
    },
    "attach the group",
    true, // new atoms arrived without coordinates
  );
}

/** Adds a template beside the current structure (or replaces nothing-yet). */
export function addTemplate(mol: Molecule | null, smiles: string): Mol3dEditResult {
  let frag: Molecule;
  try {
    frag = Molecule.fromSmiles(smiles);
  } catch (e) {
    return { error: `The template could not be read: ${(e as Error).message}` };
  }
  if (!mol || mol.getAllAtoms() === 0) {
    frag.inventCoordinates();
    return { mol: frag };
  }
  const copy = mol.getCompactCopy();
  copy.addMolecule(frag);
  copy.inventCoordinates();
  return { mol: copy };
}

// ---------------------------------------------------------------------------
// Libraries — textbook structures, plain SMILES.
// ---------------------------------------------------------------------------

export interface TemplateEntry {
  group: string;
  name: string;
  smiles: string;
}

export const MOL_TEMPLATES: TemplateEntry[] = [
  // Carbocycles
  { group: "Rings", name: "Benzene", smiles: "c1ccccc1" },
  { group: "Rings", name: "Cyclopropane", smiles: "C1CC1" },
  { group: "Rings", name: "Cyclobutane", smiles: "C1CCC1" },
  { group: "Rings", name: "Cyclopentane", smiles: "C1CCCC1" },
  { group: "Rings", name: "Cyclohexane", smiles: "C1CCCCC1" },
  { group: "Rings", name: "Cyclohexene", smiles: "C1=CCCCC1" },
  { group: "Rings", name: "Naphthalene", smiles: "c1ccc2ccccc2c1" },
  { group: "Rings", name: "Anthracene", smiles: "c1ccc2cc3ccccc3cc2c1" },
  { group: "Rings", name: "Biphenyl", smiles: "c1ccc(-c2ccccc2)cc1" },
  // Heterocycles
  { group: "Heterocycles", name: "Pyridine", smiles: "c1ccncc1" },
  { group: "Heterocycles", name: "Pyrimidine", smiles: "c1cncnc1" },
  { group: "Heterocycles", name: "Pyrrole", smiles: "c1cc[nH]c1" },
  { group: "Heterocycles", name: "Imidazole", smiles: "c1c[nH]cn1" },
  { group: "Heterocycles", name: "Pyrazole", smiles: "c1cc[nH]n1" },
  { group: "Heterocycles", name: "Furan", smiles: "c1ccoc1" },
  { group: "Heterocycles", name: "Thiophene", smiles: "c1ccsc1" },
  { group: "Heterocycles", name: "Oxazole", smiles: "c1cnco1" },
  { group: "Heterocycles", name: "Thiazole", smiles: "c1cncs1" },
  { group: "Heterocycles", name: "Indole", smiles: "c1ccc2c(c1)cc[nH]2" },
  { group: "Heterocycles", name: "Quinoline", smiles: "c1ccc2c(c1)cccn2" },
  { group: "Heterocycles", name: "Purine", smiles: "c1ncc2[nH]cnc2n1" },
  { group: "Heterocycles", name: "Piperidine", smiles: "C1CCNCC1" },
  { group: "Heterocycles", name: "Piperazine", smiles: "C1CNCCN1" },
  { group: "Heterocycles", name: "Morpholine", smiles: "C1COCCN1" },
  { group: "Heterocycles", name: "Tetrahydrofuran", smiles: "C1CCOC1" },
  { group: "Heterocycles", name: "Tetrahydropyran", smiles: "C1CCOCC1" },
  // Named scaffolds — the "complex builds"
  { group: "Scaffolds", name: "Adamantane", smiles: "C1C2CC3CC1CC(C2)C3" },
  { group: "Scaffolds", name: "Cubane", smiles: "C12C3C4C1C5C2C3C45" },
  { group: "Scaffolds", name: "Norbornane", smiles: "C1CC2CCC1C2" },
  { group: "Scaffolds", name: "Decalin", smiles: "C1CCC2CCCCC2C1" },
  { group: "Scaffolds", name: "Porphine", smiles: "C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2" },
  { group: "Scaffolds", name: "18-crown-6", smiles: "C1COCCOCCOCCOCCOCCO1" },
  { group: "Scaffolds", name: "Glucose (pyranose)", smiles: "OCC1OC(O)C(O)C(O)C1O" },
];

export interface AttachGroupEntry {
  name: string;
  /** First atom is the attachment point — pinned by test. */
  smiles: string;
}

export const ATTACH_GROUPS: AttachGroupEntry[] = [
  { name: "Methyl —CH₃", smiles: "C" },
  { name: "Ethyl —C₂H₅", smiles: "CC" },
  { name: "Isopropyl —CH(CH₃)₂", smiles: "C(C)C" },
  { name: "tert-Butyl —C(CH₃)₃", smiles: "C(C)(C)C" },
  { name: "Vinyl —CH=CH₂", smiles: "C=C" },
  { name: "Ethynyl —C≡CH", smiles: "C#C" },
  { name: "Phenyl —C₆H₅", smiles: "c1ccccc1" },
  { name: "Benzyl —CH₂C₆H₅", smiles: "Cc1ccccc1" },
  { name: "Hydroxyl —OH", smiles: "O" },
  { name: "Methoxy —OCH₃", smiles: "OC" },
  { name: "Amino —NH₂", smiles: "N" },
  { name: "Dimethylamino —N(CH₃)₂", smiles: "N(C)C" },
  { name: "Nitro —NO₂", smiles: "[N+](=O)[O-]" },
  { name: "Cyano —C≡N", smiles: "C#N" },
  { name: "Formyl —CHO", smiles: "C=O" },
  { name: "Carboxyl —COOH", smiles: "C(=O)O" },
  { name: "Ester —COOCH₃", smiles: "C(=O)OC" },
  { name: "Acetyl —COCH₃", smiles: "C(=O)C" },
  { name: "Amide —CONH₂", smiles: "C(=O)N" },
  { name: "Trifluoromethyl —CF₃", smiles: "C(F)(F)F" },
  { name: "Fluoro —F", smiles: "F" },
  { name: "Chloro —Cl", smiles: "Cl" },
  { name: "Bromo —Br", smiles: "Br" },
  { name: "Iodo —I", smiles: "I" },
  { name: "Thiol —SH", smiles: "S" },
  { name: "Methylthio —SCH₃", smiles: "SC" },
  { name: "Sulfonic acid —SO₃H", smiles: "S(=O)(=O)O" },
];

/** Elements offered in the 3D element palette. */
export const EDIT_ELEMENTS: { symbol: string; atomicNo: number }[] = [
  { symbol: "C", atomicNo: 6 },
  { symbol: "N", atomicNo: 7 },
  { symbol: "O", atomicNo: 8 },
  { symbol: "P", atomicNo: 15 },
  { symbol: "S", atomicNo: 16 },
  { symbol: "F", atomicNo: 9 },
  { symbol: "Cl", atomicNo: 17 },
  { symbol: "Br", atomicNo: 35 },
  { symbol: "I", atomicNo: 53 },
];
