// pKa estimation from structure — a deterministic functional-group detector.
//
// IMPORTANT — honesty: this is NOT a compound-specific quantitative pKa
// prediction (that needs a QSAR/ML model). It recognizes ionizable functional
// groups from the molecular graph and reports the TYPICAL literature pKa for
// each group. Detection is exact (walks OpenChemLib's atom/bond graph, so an
// ester is never mistaken for a carboxylic acid, nor an amide for an amine); the
// pKa *values* are representative group averages, and the UI must label them so.
//
// Values are widely-tabulated group averages (Perrin/CRC-style). Pure; offline.

import { Molecule } from "openchemlib";
import { lookupSmiles } from "./structures";

export interface PkaSite {
  group: string;
  kind: "acid" | "base";
  /** Representative literature pKa. For a base this is the pKa of its conjugate acid (pKaH). */
  pka: number;
}

export interface PkaResult {
  smiles: string;
  sites: PkaSite[];
  /** Estimated net charge at pH 7.4 (Henderson–Hasselbalch per site). */
  netChargeAt74: number;
}

interface Neighbor {
  atom: number;
  order: number;
}

function neighbors(mol: Molecule, a: number): Neighbor[] {
  const out: Neighbor[] = [];
  const n = mol.getConnAtoms(a);
  for (let i = 0; i < n; i++) out.push({ atom: mol.getConnAtom(a, i), order: mol.getConnBondOrder(a, i) });
  return out;
}

/** True if carbon `c` bears a double-bonded oxygen (a carbonyl). */
function isCarbonyl(mol: Molecule, c: number): boolean {
  if (mol.getAtomicNo(c) !== 6) return false;
  return neighbors(mol, c).some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 8);
}

/**
 * Detects ionizable groups and returns their representative pKa values. Returns
 * null if the input can't be resolved to a structure.
 */
export function predictPka(input: string): PkaResult | null {
  const looked = lookupSmiles(input);
  const raw = looked ? looked.smiles : input.trim();
  if (!raw) return null;
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(raw);
  } catch {
    return null;
  }
  const n = mol.getAllAtoms();
  if (n === 0) return null;
  mol.ensureHelperArrays(Molecule.cHelperRings);

  const sites: PkaSite[] = [];
  let smiles = raw;
  try {
    smiles = mol.toIsomericSmiles();
  } catch {
    /* keep raw */
  }

  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const nbrs = neighbors(mol, a);
    const hyd = mol.getAllHydrogens(a);
    const charge = mol.getAtomCharge(a);
    if (charge !== 0) continue; // an already-charged atom is not a neutral ionizable site

    // --- Carboxylic acid: C(=O)-O(H), the -OH oxygen terminal ---------------
    if (z === 8 && hyd >= 1 && mol.getConnAtoms(a) === 1) {
      const c = nbrs[0].atom;
      if (mol.getAtomicNo(c) === 6 && nbrs[0].order === 1) {
        // Distinguish acid (carbon is a carbonyl) from phenol/alcohol.
        // Sulfur/phosphorus oxo-acids handled separately below.
        if (isCarbonyl(mol, c)) {
          sites.push({ group: "Carboxylic acid", kind: "acid", pka: 4.5 });
          continue;
        }
        if (mol.isAromaticAtom(c)) {
          sites.push({ group: "Phenol", kind: "acid", pka: 10.0 });
          continue;
        }
        sites.push({ group: "Alcohol (very weak; ~non-ionizable in water)", kind: "acid", pka: 16.0 });
        continue;
      }
      // Oxo-acid -OH on S or P
      if (mol.getAtomicNo(c) === 16) {
        const doubleO = neighbors(mol, c).filter((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 8).length;
        if (doubleO >= 2) sites.push({ group: "Sulfonic acid", kind: "acid", pka: -1.5 });
        else sites.push({ group: "Sulfinic/sulfonic acid", kind: "acid", pka: 2.0 });
        continue;
      }
      if (mol.getAtomicNo(c) === 15) {
        sites.push({ group: "Phosphate/phosphonic acid", kind: "acid", pka: 2.0 });
        continue;
      }
    }

    // --- Thiol: S(H) on carbon ---------------------------------------------
    if (z === 16 && hyd >= 1 && mol.getConnAtoms(a) === 1 && mol.getAtomicNo(nbrs[0].atom) === 6) {
      sites.push({ group: "Thiol", kind: "acid", pka: 10.5 });
      continue;
    }

    // --- Nitrogen bases -----------------------------------------------------
    if (z === 7) {
      // Aromatic nitrogen: pyridine-type (no H, lone pair available) is basic;
      // pyrrole-type (bears an H) is not.
      if (mol.isAromaticAtom(a)) {
        if (hyd === 0) sites.push({ group: "Aromatic N (pyridine-type)", kind: "base", pka: 5.2 });
        continue;
      }
      // Skip imines/nitriles/nitro (any multiple bond from N) and amides.
      if (nbrs.some((nb) => nb.order >= 2)) continue;
      const amide = nbrs.some((nb) => isCarbonyl(mol, nb.atom));
      if (amide) continue; // amide N is not basic
      const onAromatic = nbrs.some((nb) => mol.getAtomicNo(nb.atom) === 6 && mol.isAromaticAtom(nb.atom));
      if (onAromatic) sites.push({ group: "Aniline (aromatic amine)", kind: "base", pka: 4.6 });
      else sites.push({ group: "Aliphatic amine", kind: "base", pka: 10.6 });
      continue;
    }
  }

  // Net charge at pH 7.4 via Henderson–Hasselbalch on each site.
  const pH = 7.4;
  let net = 0;
  for (const s of sites) {
    if (s.kind === "acid") net -= 1 / (1 + Math.pow(10, s.pka - pH)); // fraction deprotonated
    else net += 1 / (1 + Math.pow(10, pH - s.pka)); // fraction protonated
  }
  return { smiles, sites, netChargeAt74: net };
}
