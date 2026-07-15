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
 * A guanidine/amidine carbon: sp2 carbon with one C=N and one or two further
 * single-bonded nitrogens.
 *
 * These MUST be recognised as one group, not as their individual nitrogens.
 * Arginine's guanidine has three N: the =N is skipped as an imine, and the other
 * two each fall through to "aliphatic amine". That reported arginine as THREE
 * amines at 10.6 and gave a net charge of +2.0 at pH 7.4 — the real answer is
 * one guanidinium at ~12.5 and +1.0. Guanidine is the most basic group in
 * biochemistry; getting it wrong is not a rounding error.
 *
 * Returns the nitrogens belonging to the group, or null if `c` isn't one.
 */
function guanidineNitrogens(mol: Molecule, c: number): { ns: number[]; kind: "guanidine" | "amidine" } | null {
  if (mol.getAtomicNo(c) !== 6 || mol.isAromaticAtom(c)) return null;
  const nbrs = neighbors(mol, c);
  const dblN = nbrs.filter((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 7);
  if (dblN.length !== 1) return null;
  const sglN = nbrs.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 7);
  if (!sglN.length) return null;
  // A nitrogen that is itself an amide N belongs to the amide, not here — this
  // keeps acylguanidines and ureas from being misread.
  if (dblN.some((nb) => isCarbonyl(mol, nb.atom))) return null;
  const ns = [dblN[0].atom, ...sglN.map((nb) => nb.atom)];
  // Three nitrogens = guanidine (arginine, ~12.5). Two = amidine (~11.6).
  return { ns, kind: sglN.length >= 2 ? "guanidine" : "amidine" };
}

/**
 * True if aromatic nitrogen `a` sits in an imidazole — a five-membered aromatic
 * ring with exactly two nitrogens.
 */
function isImidazoleN(mol: Molecule, a: number): boolean {
  if (!mol.isAromaticAtom(a) || mol.getAtomicNo(a) !== 7) return false;
  if (!mol.isRingAtom(a) || mol.getAtomRingSize(a) !== 5) return false;
  // Walk the aromatic ring this atom belongs to and count its nitrogens.
  const seen = new Set<number>([a]);
  const stack = [a];
  let nCount = 0;
  while (stack.length) {
    const x = stack.pop() as number;
    if (mol.getAtomicNo(x) === 7) nCount++;
    for (const nb of neighbors(mol, x)) {
      if (seen.has(nb.atom)) continue;
      if (!mol.isAromaticAtom(nb.atom) || !mol.isRingAtom(nb.atom)) continue;
      if (mol.getAtomRingSize(nb.atom) !== 5) continue;
      seen.add(nb.atom);
      stack.push(nb.atom);
    }
  }
  return seen.size === 5 && nCount === 2;
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

  // --- Pass 1: whole-group bases, before the per-atom walk -----------------
  // Guanidine and amidine must be claimed as ONE group. Left to the per-atom
  // loop, each of their nitrogens is separately mislabelled an "aliphatic
  // amine" — which reported arginine as three amines at 10.6 and a net charge
  // of +2.0 at pH 7.4, against a true +1.0.
  const consumedN = new Set<number>();
  for (let c = 0; c < n; c++) {
    if (mol.getAtomCharge(c) !== 0) continue;
    const g = guanidineNitrogens(mol, c);
    if (!g) continue;
    if (g.ns.some((x) => consumedN.has(x))) continue; // already part of a group
    for (const x of g.ns) consumedN.add(x);
    sites.push(
      g.kind === "guanidine"
        ? { group: "Guanidine (arginine-type)", kind: "base", pka: 12.5 }
        : { group: "Amidine", kind: "base", pka: 11.6 }
    );
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
      // A nitrogen already claimed by a guanidine/amidine group below is part of
      // that group, not an amine in its own right.
      if (consumedN.has(a)) continue;

      // Aromatic nitrogen: pyridine-type (no H, lone pair available) is basic;
      // pyrrole-type (bears an H) is not.
      if (mol.isAromaticAtom(a)) {
        if (hyd !== 0) continue;
        // Imidazole (histidine's side chain) is markedly more basic than
        // pyridine — pKaH ~6.0 vs ~5.2 — and it is THE physiologically
        // interesting one, being the only side chain that titrates near pH 7.
        sites.push(
          isImidazoleN(mol, a)
            ? { group: "Imidazole (histidine-type)", kind: "base", pka: 6.0 }
            : { group: "Aromatic N (pyridine-type)", kind: "base", pka: 5.2 }
        );
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
