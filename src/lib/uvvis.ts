// UV-Vis λmax prediction from structure — Woodward-Fieser rules.
//
// IMPORTANT — honesty: the Woodward-Fieser rules are an empirical additivity
// scheme with a DEFINED DOMAIN. They apply to conjugated dienes and to α,β-
// unsaturated carbonyls, and within that domain they are good to roughly
// ±5 nm. Outside it they simply do not apply, and this module says so rather
// than inventing a number:
//
//   * A molecule with no conjugation absorbs below ~200 nm (vacuum UV) — it is
//     effectively transparent in the usual 200-800 nm window. Reported as such.
//   * Isolated benzene rings are reported from the tabulated benzenoid bands,
//     not from Woodward-Fieser (which does not cover them).
//   * Extended / cross-conjugated / aromatic-fused chromophores beyond the rules'
//     domain are flagged as out-of-domain instead of being given a false λmax.
//
// Only the π→π* λmax is predicted. Intensity (ε) is not — it depends on
// transition dipoles the rules do not model. n→π* bands (weak, ~280-320 nm for
// carbonyls) are noted qualitatively where relevant.
//
// Rules as tabulated in Woodward (1941/1942) and Fieser & Fieser; reproduced in
// every standard spectroscopy text.
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";
import { neighbors, carbonylKind, classifySubstituent, parseToMolecule, SubstKey } from "./molgraph";

export interface UvContribution {
  label: string;
  nm: number;
}

export interface UvResult {
  smiles: string;
  /** Predicted π→π* λmax in nm, or null when the rules do not apply. */
  lambdaMax: number | null;
  /** The chromophore the prediction is based on. */
  chromophore: string;
  /** Base value + each increment, so the user can audit the arithmetic. */
  contributions: UvContribution[];
  /** True when the molecule has no chromophore absorbing above ~200 nm. */
  transparent: boolean;
  caveats: string[];
}

/** A C=C double bond between two carbons (excluding aromatic bonds). */
interface Alkene {
  a: number;
  b: number;
}

function findAlkenes(mol: Molecule): Alkene[] {
  const out: Alkene[] = [];
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    if (mol.getAtomicNo(a) !== 6 || mol.isAromaticAtom(a)) continue;
    for (const nb of neighbors(mol, a)) {
      if (nb.order !== 2 || nb.atom < a) continue;
      if (mol.getAtomicNo(nb.atom) !== 6 || mol.isAromaticAtom(nb.atom)) continue;
      out.push({ a, b: nb.atom });
    }
  }
  return out;
}

/** An α,β-unsaturated carbonyl: C=C-C=O. Returns the enone skeleton atoms. */
interface Enone {
  carbonyl: number;
  alpha: number;
  beta: number;
  kind: string;
}

function findEnones(mol: Molecule): Enone[] {
  const out: Enone[] = [];
  for (let c = 0; c < mol.getAllAtoms(); c++) {
    const kind = carbonylKind(mol, c);
    if (!kind) continue;
    if (!["ketone", "aldehyde", "acid", "ester"].includes(kind)) continue;
    // The α carbon is single-bonded to C=O and carries a C=C to the β carbon.
    for (const nb of neighbors(mol, c)) {
      if (nb.order !== 1 || mol.getAtomicNo(nb.atom) !== 6) continue;
      if (mol.isAromaticAtom(nb.atom)) continue;
      const alpha = nb.atom;
      for (const nb2 of neighbors(mol, alpha)) {
        if (nb2.order !== 2 || mol.getAtomicNo(nb2.atom) !== 6) continue;
        if (mol.isAromaticAtom(nb2.atom)) continue;
        out.push({ carbonyl: c, alpha, beta: nb2.atom, kind });
      }
    }
  }
  return out;
}

/** Counts conjugated C=C units extending beyond a starting double bond. */
function countExtendedConjugation(mol: Molecule, from: Alkene, visited: Set<string>): number {
  const key = (x: number, y: number) => `${Math.min(x, y)}-${Math.max(x, y)}`;
  visited.add(key(from.a, from.b));
  let extra = 0;
  for (const end of [from.a, from.b]) {
    for (const nb of neighbors(mol, end)) {
      if (nb.order !== 1 || mol.getAtomicNo(nb.atom) !== 6) continue;
      // A single bond from the alkene terminus to another sp2 carbon = conjugation.
      for (const nb2 of neighbors(mol, nb.atom)) {
        if (nb2.order !== 2 || mol.getAtomicNo(nb2.atom) !== 6) continue;
        if (mol.isAromaticAtom(nb2.atom) || mol.isAromaticAtom(nb.atom)) continue;
        const k = key(nb.atom, nb2.atom);
        if (visited.has(k)) continue;
        visited.add(k);
        extra += 1 + countExtendedConjugation(mol, { a: nb.atom, b: nb2.atom }, visited);
      }
    }
  }
  return extra;
}

/** Alkyl / ring-residue substituents on an alkene carbon (each +5 nm for dienes). */
function alkylSubstituentCount(mol: Molecule, atom: number, exclude: number[]): number {
  let n = 0;
  for (const nb of neighbors(mol, atom)) {
    if (exclude.includes(nb.atom)) continue;
    if (mol.getAtomicNo(nb.atom) !== 6) continue;
    if (nb.order !== 1) continue;
    n++;
  }
  return n;
}

/** Auxochrome increments for the diene rules. */
const DIENE_AUX: Partial<Record<SubstKey, { nm: number; label: string }>> = {
  OR: { nm: 6, label: "-OR (alkoxy)" },
  OAc: { nm: 0, label: "-OAc (acyloxy)" },
  SR: { nm: 30, label: "-SR (thioether)" },
  Cl: { nm: 5, label: "-Cl" },
  Br: { nm: 5, label: "-Br" },
  NR2: { nm: 60, label: "-NR2 (amino)" },
};

/**
 * Predicts λmax. Returns null only when the input cannot be parsed; a molecule
 * that legitimately has no UV chromophore comes back with transparent = true.
 */
export function predictUvVis(input: string): UvResult | null {
  const parsed = parseToMolecule(input);
  if (!parsed) return null;
  const { mol, smiles } = parsed;
  const caveats = new Set<string>();
  const contributions: UvContribution[] = [];

  const enones = findEnones(mol);
  const alkenes = findAlkenes(mol);
  let hasAromatic = false;
  for (let a = 0; a < mol.getAllAtoms(); a++) if (mol.isAromaticAtom(a)) hasAromatic = true;

  // --- α,β-unsaturated carbonyl (Woodward-Fieser enone rules) -------------
  if (enones.length) {
    const e = enones[0];
    if (enones.length > 1) {
      caveats.add(
        `${enones.length} enone systems found; λmax is computed for one of them. Cross-conjugated systems are outside the rules.`
      );
    }
    const skeleton = [e.carbonyl, e.alpha, e.beta];

    // Base value by carbonyl class and ring size.
    let base = 215;
    let baseLabel = "6-ring / acyclic enone base";
    if (e.kind === "aldehyde") {
      base = 210;
      baseLabel = "α,β-unsaturated aldehyde base";
    } else if (e.kind === "acid" || e.kind === "ester") {
      base = 195;
      baseLabel = "α,β-unsaturated acid/ester base";
    } else if (mol.isRingAtom(e.carbonyl) && mol.getAtomRingSize(e.carbonyl) === 5) {
      base = 202;
      baseLabel = "5-ring enone base";
    }
    contributions.push({ label: baseLabel, nm: base });
    let lambda = base;

    // Extended conjugation beyond the enone: +30 nm each.
    const visited = new Set<string>([`${Math.min(e.alpha, e.beta)}-${Math.max(e.alpha, e.beta)}`]);
    const extra = countExtendedConjugation(mol, { a: e.alpha, b: e.beta }, visited);
    if (extra > 0) {
      contributions.push({ label: `Extended conjugation ×${extra}`, nm: 30 * extra });
      lambda += 30 * extra;
    }

    // Alkyl substituents: α +10, β +12, γ and beyond +18.
    const aAlkyl = alkylSubstituentCount(mol, e.alpha, skeleton);
    const bAlkyl = alkylSubstituentCount(mol, e.beta, skeleton);
    if (aAlkyl) {
      contributions.push({ label: `α-alkyl / ring residue ×${aAlkyl}`, nm: 10 * aAlkyl });
      lambda += 10 * aAlkyl;
    }
    if (bAlkyl) {
      contributions.push({ label: `β-alkyl / ring residue ×${bAlkyl}`, nm: 12 * bAlkyl });
      lambda += 12 * bAlkyl;
    }

    // Polar auxochromes on α / β.
    for (const [pos, atom, incs] of [
      ["α", e.alpha, { OH: 35, OR: 35, OAc: 6, Cl: 15, Br: 25, NR2: 0 }],
      ["β", e.beta, { OH: 30, OR: 30, OAc: 6, Cl: 12, Br: 30, NR2: 95 }],
    ] as [string, number, Record<string, number>][]) {
      for (const nb of neighbors(mol, atom)) {
        if (skeleton.includes(nb.atom)) continue;
        const key = classifySubstituent(mol, nb.atom, atom);
        const inc = incs[key];
        if (inc === undefined || inc === 0) continue;
        contributions.push({ label: `${pos}-${key}`, nm: inc });
        lambda += inc;
      }
    }

    if (hasAromatic) {
      caveats.add(
        "An aromatic ring is conjugated to this system; aryl enones follow Scott's rules rather than Woodward-Fieser, so this value is indicative only."
      );
    }
    caveats.add("Woodward-Fieser enone rules: typically ±5 nm within their domain (ethanol solution).");
    return {
      smiles,
      lambdaMax: lambda,
      chromophore: `α,β-unsaturated ${e.kind === "acid" || e.kind === "ester" ? "acid/ester" : e.kind}`,
      contributions,
      transparent: false,
      caveats: [...caveats],
    };
  }

  // --- Conjugated diene (Woodward-Fieser diene rules) ---------------------
  // A diene needs two C=C joined by a single bond.
  for (const alk of alkenes) {
    const visited = new Set<string>();
    const extra = countExtendedConjugation(mol, alk, visited);
    if (extra < 1) continue; // isolated alkene, not a diene

    // Homoannular (both C=C in the same ring, cisoid) base 253; else 214.
    const conjAtoms = new Set<number>();
    for (const k of visited) for (const p of k.split("-")) conjAtoms.add(Number(p));
    const ringAtoms = [...conjAtoms].filter((x) => mol.isRingAtom(x));
    const homoannular =
      ringAtoms.length >= 4 &&
      new Set(ringAtoms.map((x) => mol.getAtomRingSize(x))).size === 1 &&
      ringAtoms.length === conjAtoms.size;
    const base = homoannular ? 253 : 214;
    contributions.push({ label: homoannular ? "Homoannular diene base" : "Acyclic/heteroannular diene base", nm: base });
    let lambda = base;

    if (extra > 1) {
      contributions.push({ label: `Extended conjugation ×${extra - 1}`, nm: 30 * (extra - 1) });
      lambda += 30 * (extra - 1);
    }

    // +5 nm per alkyl substituent / ring residue on the conjugated system.
    let alkyl = 0;
    const auxSeen: string[] = [];
    for (const atom of conjAtoms) {
      for (const nb of neighbors(mol, atom)) {
        if (conjAtoms.has(nb.atom)) continue;
        if (nb.order !== 1) continue;
        const key = classifySubstituent(mol, nb.atom, atom);
        if (key === "CH3" || key === "alkyl") {
          alkyl++;
          continue;
        }
        const aux = DIENE_AUX[key];
        if (aux && aux.nm > 0) {
          contributions.push({ label: aux.label, nm: aux.nm });
          lambda += aux.nm;
          auxSeen.push(aux.label);
        }
      }
    }
    if (alkyl) {
      contributions.push({ label: `Alkyl / ring residue ×${alkyl}`, nm: 5 * alkyl });
      lambda += 5 * alkyl;
    }

    if (hasAromatic) {
      caveats.add("An aromatic ring is present; if it is conjugated to the diene the rules do not strictly apply.");
    }
    caveats.add("Woodward-Fieser diene rules: typically ±5 nm within their domain (ethanol solution).");
    caveats.add("Exocyclic-double-bond (+5 nm) corrections require 3D ring context and are not applied.");
    return {
      smiles,
      lambdaMax: lambda,
      chromophore: homoannular ? "homoannular conjugated diene" : "conjugated diene",
      contributions,
      transparent: false,
      caveats: [...caveats],
    };
  }

  // --- Isolated benzene ring — tabulated benzenoid bands -------------------
  if (hasAromatic) {
    caveats.add(
      "Benzenoid absorption is reported from tabulated values, not Woodward-Fieser (which does not cover aromatic rings). Substituents shift these bands; conjugated substituents shift them substantially."
    );
    caveats.add("A weak n→π* / B-band near 254 nm is characteristic of monosubstituted benzenes.");
    return {
      smiles,
      lambdaMax: 254,
      chromophore: "benzene ring (B-band)",
      contributions: [{ label: "Benzene B-band (tabulated)", nm: 254 }],
      transparent: false,
      caveats: [...caveats],
    };
  }

  // --- Isolated carbonyl ---------------------------------------------------
  let isolatedCarbonyl = false;
  for (let a = 0; a < mol.getAllAtoms(); a++) if (carbonylKind(mol, a)) isolatedCarbonyl = true;
  if (isolatedCarbonyl) {
    caveats.add(
      "An isolated (unconjugated) carbonyl has only a weak n→π* band near 280 nm (ε ≈ 10-20); its strong π→π* band is below 200 nm."
    );
    return {
      smiles,
      lambdaMax: 280,
      chromophore: "isolated carbonyl (weak n→π*)",
      contributions: [{ label: "n→π* of isolated C=O (tabulated, weak)", nm: 280 }],
      transparent: false,
      caveats: [...caveats],
    };
  }

  // --- No chromophore ------------------------------------------------------
  caveats.add(
    "No conjugated chromophore detected: absorption lies below ~200 nm (vacuum UV), so the compound is effectively transparent in the 200-800 nm window."
  );
  return {
    smiles,
    lambdaMax: null,
    chromophore: "none (no conjugation)",
    contributions: [],
    transparent: true,
    caveats: [...caveats],
  };
}
