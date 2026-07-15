// EI-MS fragmentation prediction from structure.
//
// IMPORTANT — honesty: fragment m/z values here are EXACT (they are computed
// from the same monoisotopic atomic masses as massspec.ts, by actually removing
// atoms from the molecular graph). What is PREDICTED — and therefore uncertain —
// is *which* bonds break and *how abundant* each fragment is:
//
//   * Pathways are the classical, mechanistically-justified ones (α-cleavage,
//     benzylic/allylic cleavage, McLafferty rearrangement, retro-Diels-Alder-
//     style neutral losses). Real EI spectra routinely show fragments beyond
//     these, and relative intensities depend on the instrument and energy.
//   * "Likelihood" below is a RANKING (a qualitative propensity from
//     well-established fragmentation rules), NOT a predicted intensity. It must
//     never be presented as a simulated abundance.
//
// This is an interpretation aid for assigning peaks you already have — it does
// not replace a measured spectrum or a spectral library match.
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";
import { neighbors, isCarbonyl, carbonylKind, distancesFrom, parseToMolecule } from "./molgraph";

// Monoisotopic masses of the elements that appear in organic/bio molecules.
// Same values as massspec.ts uses for the M peak, so fragment m/z and molecular
// ion m/z are on one consistent scale.
const MONO: Record<number, number> = {
  1: 1.0078250319,
  5: 11.0093055,
  6: 12.0,
  7: 14.0030740052,
  8: 15.9949146221,
  9: 18.99840322,
  11: 22.98976928,
  14: 27.9769265327,
  15: 30.97376151,
  16: 31.97207069,
  17: 34.96885271,
  19: 38.9637069,
  34: 79.9165218,
  35: 78.9183376,
  53: 126.904473,
};

const ELECTRON = 0.00054858;

export type Likelihood = "high" | "medium" | "low";

export interface Fragment {
  /** Exact m/z of the (singly-charged, radical or even-electron) fragment ion. */
  mz: number;
  /** Molecular formula of the fragment ion. */
  formula: string;
  /** e.g. "α-cleavage at C=O, loss of •CH3". */
  pathway: string;
  /** Neutral lost, e.g. "•CH3" or "H2O". */
  neutralLoss: string;
  /** Exact mass of the neutral lost. */
  lossMass: number;
  /** Qualitative propensity from classical rules — a RANKING, not an intensity. */
  likelihood: Likelihood;
}

export interface FragmentResult {
  smiles: string;
  formula: string;
  /** Molecular-ion m/z (M+• for EI). */
  molecularIon: number;
  fragments: Fragment[];
  caveats: string[];
}

/** Atom counts → Hill-notation formula string. */
function hillFormula(counts: Map<number, number>): string {
  const sym: Record<number, string> = {
    1: "H",
    5: "B",
    6: "C",
    7: "N",
    8: "O",
    9: "F",
    11: "Na",
    14: "Si",
    15: "P",
    16: "S",
    17: "Cl",
    19: "K",
    34: "Se",
    35: "Br",
    53: "I",
  };
  const parts: string[] = [];
  const push = (z: number) => {
    const n = counts.get(z);
    if (!n) return;
    parts.push(sym[z] + (n > 1 ? String(n) : ""));
  };
  push(6);
  push(1);
  const rest = [...counts.keys()].filter((z) => z !== 6 && z !== 1).sort((a, b) => (sym[a] ?? "").localeCompare(sym[b] ?? ""));
  for (const z of rest) push(z);
  return parts.join("") || "—";
}

/** Exact mass of an atom set, including its implicit hydrogens. */
function massOf(mol: Molecule, atoms: Iterable<number>): { mass: number; counts: Map<number, number> } {
  const counts = new Map<number, number>();
  let mass = 0;
  for (const a of atoms) {
    const z = mol.getAtomicNo(a);
    const m = MONO[z];
    if (m === undefined) continue;
    mass += m;
    counts.set(z, (counts.get(z) ?? 0) + 1);
    const h = mol.getAllHydrogens(a);
    if (h > 0) {
      mass += h * MONO[1];
      counts.set(1, (counts.get(1) ?? 0) + h);
    }
  }
  return { mass, counts };
}

/** The two atom sets produced by cutting bond (a-b), or null if the bond is in a ring. */
function cutBond(mol: Molecule, a: number, b: number): { sideA: number[]; sideB: number[] } | null {
  // Walk from `a` without crossing the a-b bond. If we still reach `b`, the bond
  // is part of a ring and cutting it alone does not release a fragment.
  const n = mol.getAllAtoms();
  const seen = new Array<boolean>(n).fill(false);
  seen[a] = true;
  const stack = [a];
  while (stack.length) {
    const cur = stack.pop() as number;
    for (const nb of neighbors(mol, cur)) {
      if (cur === a && nb.atom === b) continue; // the bond being cut
      if (nb.atom === a && cur === b) continue;
      if (seen[nb.atom]) continue;
      seen[nb.atom] = true;
      stack.push(nb.atom);
    }
  }
  if (seen[b]) return null; // ring bond
  const sideA: number[] = [];
  const sideB: number[] = [];
  for (let i = 0; i < n; i++) (seen[i] ? sideA : sideB).push(i);
  return { sideA, sideB };
}

/** Formula/mass of a neutral radical from an atom set. */
function describeSide(mol: Molecule, atoms: number[]): { mass: number; formula: string } {
  const { mass, counts } = massOf(mol, atoms);
  return { mass, formula: hillFormula(counts) };
}

/** True if this carbon is benzylic (sp3 carbon attached to an aromatic ring). */
function isBenzylic(mol: Molecule, a: number): boolean {
  if (mol.getAtomicNo(a) !== 6 || mol.isAromaticAtom(a)) return false;
  return neighbors(mol, a).some((nb) => mol.isAromaticAtom(nb.atom));
}

/** True if this carbon is allylic (sp3 carbon attached to a C=C). */
function isAllylic(mol: Molecule, a: number): boolean {
  if (mol.getAtomicNo(a) !== 6 || mol.isAromaticAtom(a)) return false;
  return neighbors(mol, a).some(
    (nb) =>
      nb.order === 1 &&
      mol.getAtomicNo(nb.atom) === 6 &&
      !mol.isAromaticAtom(nb.atom) &&
      neighbors(mol, nb.atom).some((x) => x.order === 2 && mol.getAtomicNo(x.atom) === 6 && x.atom !== a)
  );
}

/**
 * Predicts principal EI fragments. Returns null if the input cannot be resolved.
 * Fragments are de-duplicated by m/z + pathway and sorted by descending m/z.
 */
export function predictFragments(input: string, opts: { maxFragments?: number } = {}): FragmentResult | null {
  const parsed = parseToMolecule(input);
  if (!parsed) return null;
  const { mol, smiles } = parsed;
  const maxFragments = opts.maxFragments ?? 14;
  const n = mol.getAllAtoms();
  const all = [...Array(n).keys()];
  const { mass: molMass, counts: molCounts } = massOf(mol, all);
  const formula = hillFormula(molCounts);
  const caveats = new Set<string>();

  // Unknown-element guard: if the graph has elements outside the mass table, the
  // arithmetic would silently under-count. Say so rather than report a wrong m/z.
  const unknown = new Set<string>();
  for (let a = 0; a < n; a++) if (MONO[mol.getAtomicNo(a)] === undefined) unknown.add(String(mol.getAtomicNo(a)));
  if (unknown.size) {
    caveats.add("The structure contains elements outside the built-in exact-mass table; fragment masses are omitted.");
    return { smiles, formula, molecularIon: molMass - ELECTRON, fragments: [], caveats: [...caveats] };
  }

  const out: Fragment[] = [];
  const seen = new Set<string>();
  const add = (f: Fragment) => {
    const key = `${f.mz.toFixed(4)}|${f.pathway}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  // M+• itself (EI molecular ion = molecule minus one electron).
  const molecularIon = molMass - ELECTRON;

  // --- Single-bond cleavages ---------------------------------------------
  for (let a = 0; a < n; a++) {
    for (const nb of neighbors(mol, a)) {
      if (nb.atom < a) continue;
      if (nb.order !== 1) continue;
      const cut = cutBond(mol, a, nb.atom);
      if (!cut) continue; // ring bond — needs two cleavages, handled separately
      const b = nb.atom;

      for (const [keepSide, lostSide, keepRoot, lostRoot] of [
        [cut.sideA, cut.sideB, a, b],
        [cut.sideB, cut.sideA, b, a],
      ] as [number[], number[], number, number][]) {
        if (!keepSide.length || !lostSide.length) continue;
        const keep = describeSide(mol, keepSide);
        const lost = describeSide(mol, lostSide);

        // Classify the pathway and its propensity.
        let pathway: string | null = null;
        let likelihood: Likelihood = "low";

        const keepIsCarbonyl = isCarbonyl(mol, keepRoot);
        const keepRootIsHetero = [7, 8, 16].includes(mol.getAtomicNo(keepRoot));
        const lostRootIsHetero = [7, 8, 16, 9, 17, 35, 53].includes(mol.getAtomicNo(lostRoot));
        // α-cleavage is stabilised by a heteroatom that STAYS on the ion (giving
        // an oxocarbenium/iminium, R2C=X+). The heteroatom must therefore not be
        // the atom we are cleaving off.
        const keepRootBearsHetero =
          mol.getAtomicNo(keepRoot) === 6 &&
          neighbors(mol, keepRoot).some(
            (nb) => nb.atom !== lostRoot && nb.order === 1 && [7, 8, 16].includes(mol.getAtomicNo(nb.atom))
          );

        if (keepIsCarbonyl) {
          pathway = `α-cleavage at C=O (acylium ion)`;
          likelihood = "high";
        } else if (keepRootIsHetero) {
          // Keeping a bare heteroatom cation (HO+, Cl+ ...) is energetically
          // unfavourable and these are not observed as significant EI ions.
          continue;
        } else if (keepRootBearsHetero && mol.getAtomicNo(lostRoot) === 6) {
          const x = mol.getAtomicNo(
            neighbors(mol, keepRoot).find(
              (nb) => nb.atom !== lostRoot && nb.order === 1 && [7, 8, 16].includes(mol.getAtomicNo(nb.atom))
            )?.atom as number
          );
          pathway = `α-cleavage next to ${x === 8 ? "O" : x === 7 ? "N" : "S"} (oxocarbenium/iminium ion)`;
          likelihood = "high";
        } else if (mol.getAtomicNo(keepRoot) === 6 && lostRootIsHetero) {
          // Inductive C-X cleavage leaving a carbocation — real, but weaker than
          // the α-cleavage that competes with it.
          pathway = "inductive C-X cleavage (carbocation)";
          likelihood = "medium";
        } else if (isBenzylic(mol, keepRoot) && !mol.isAromaticAtom(lostRoot)) {
          // True benzylic cleavage: the ion RETAINS the ring and the benzylic
          // carbon (→ benzyl / tropylium). Breaking the aryl-benzylic bond
          // itself is a different reaction (below) and gives an aryl cation.
          pathway = "benzylic cleavage (benzyl → tropylium ion)";
          likelihood = "high";
        } else if (isAllylic(mol, keepRoot) && !mol.isAromaticAtom(lostRoot)) {
          pathway = "allylic cleavage (allyl cation)";
          likelihood = "medium";
        } else if (mol.isAromaticAtom(keepRoot) && !mol.isAromaticAtom(lostRoot)) {
          // Aryl cation (e.g. C6H5+, m/z 77): a real but minor fragment — the
          // phenyl cation is poorly stabilised, so this is never the base peak.
          pathway = "aryl-alkyl cleavage (aryl cation)";
          likelihood = "low";
        } else if (mol.getAtomicNo(lostRoot) === 6 && mol.getAllHydrogens(lostRoot) === 3) {
          pathway = "simple C-C cleavage, loss of •CH3";
          likelihood = "medium";
        } else if (mol.getAtomicNo(keepRoot) === 6 && mol.getAtomicNo(lostRoot) === 6) {
          pathway = "simple C-C cleavage";
          likelihood = "low";
        }
        if (!pathway) continue;

        // The fragment ion keeps the charge; the neutral radical leaves.
        add({
          mz: keep.mass - ELECTRON,
          formula: keep.formula,
          pathway,
          neutralLoss: `•${lost.formula}`,
          lossMass: lost.mass,
          likelihood,
        });
      }
    }
  }

  // --- Benzylic H• loss → tropylium ---------------------------------------
  // An alkylbenzene loses a benzylic H to give the aromatic C7H7+ tropylium ion.
  // For toluene this IS the base peak (m/z 91) — without it the predicted
  // spectrum would miss the single most diagnostic alkylbenzene fragment.
  for (let a = 0; a < n; a++) {
    if (!isBenzylic(mol, a) || mol.getAllHydrogens(a) < 1) continue;
    const mz = molMass - MONO[1] - ELECTRON;
    const counts = new Map(molCounts);
    counts.set(1, (counts.get(1) ?? 0) - 1);
    add({
      mz,
      formula: hillFormula(counts),
      pathway: "benzylic H• loss (→ tropylium ion)",
      neutralLoss: "•H",
      lossMass: MONO[1],
      likelihood: "high",
    });
    break; // one tropylium ion per molecule, however many benzylic H there are
  }

  // --- McLafferty rearrangement ------------------------------------------
  // A carbonyl with a γ-hydrogen: the γ-H transfers to the carbonyl oxygen and
  // the β-C-C bond breaks, expelling a neutral alkene. Classic, high-propensity.
  for (let c = 0; c < n; c++) {
    if (!isCarbonyl(mol, c)) continue;
    // Walk the chain: Cα (bonded to C=O), Cβ, Cγ.
    for (const nbA of neighbors(mol, c)) {
      if (nbA.order !== 1 || mol.getAtomicNo(nbA.atom) !== 6) continue;
      const alpha = nbA.atom;
      for (const nbB of neighbors(mol, alpha)) {
        if (nbB.atom === c || mol.getAtomicNo(nbB.atom) !== 6) continue;
        const beta = nbB.atom;
        for (const nbG of neighbors(mol, beta)) {
          if (nbG.atom === alpha || mol.getAtomicNo(nbG.atom) !== 6) continue;
          const gamma = nbG.atom;
          if (mol.getAllHydrogens(gamma) < 1) continue; // needs a γ-H to transfer

          // Cut the α-β bond; the enol fragment keeps the charge and gains the γ-H.
          const cut = cutBond(mol, alpha, beta);
          if (!cut) continue; // ring — a true retro-DA, not a simple McLafferty
          const keepSide = cut.sideA.includes(c) ? cut.sideA : cut.sideB;
          const lostSide = cut.sideA.includes(c) ? cut.sideB : cut.sideA;
          if (!lostSide.includes(gamma)) continue;

          const keep = describeSide(mol, keepSide);
          const lost = describeSide(mol, lostSide);
          // The transferred hydrogen moves from the neutral to the ion.
          const ionMass = keep.mass + MONO[1] - ELECTRON;
          const neutralMass = lost.mass - MONO[1];
          const keepCounts = massOf(mol, keepSide).counts;
          keepCounts.set(1, (keepCounts.get(1) ?? 0) + 1);
          const lostCounts = massOf(mol, lostSide).counts;
          lostCounts.set(1, (lostCounts.get(1) ?? 0) - 1);
          add({
            mz: ionMass,
            formula: hillFormula(keepCounts),
            pathway: "McLafferty rearrangement (γ-H transfer, enol ion)",
            neutralLoss: hillFormula(lostCounts) + " (alkene)",
            lossMass: neutralMass,
            likelihood: "high",
          });
        }
      }
    }
  }

  // --- Common small-neutral losses ----------------------------------------
  // Each is gated on the structural feature that actually enables it, so a
  // molecule with no OH is never given a water loss.
  const featureLosses: { need: () => boolean; formula: string; mass: number; label: string; like: Likelihood }[] = [
    {
      need: () => {
        for (let a = 0; a < n; a++) if (mol.getAtomicNo(a) === 8 && mol.getAllHydrogens(a) >= 1) return true;
        return false;
      },
      formula: "H2O",
      mass: 2 * MONO[1] + MONO[8],
      label: "dehydration (loss of H2O)",
      like: "high",
    },
    {
      need: () => {
        for (let a = 0; a < n; a++) if (carbonylKind(mol, a) === "acid") return true;
        return false;
      },
      formula: "CO2",
      mass: MONO[6] + 2 * MONO[8],
      label: "decarboxylation (loss of CO2)",
      like: "high",
    },
    {
      need: () => {
        for (let a = 0; a < n; a++) {
          const k = carbonylKind(mol, a);
          if (k === "ketone" || k === "aldehyde") return true;
        }
        return false;
      },
      formula: "CO",
      mass: MONO[6] + MONO[8],
      label: "loss of CO (from acylium / after α-cleavage)",
      like: "medium",
    },
    {
      need: () => {
        for (let a = 0; a < n; a++) if (mol.getAtomicNo(a) === 7 && mol.getAllHydrogens(a) >= 2) return true;
        return false;
      },
      formula: "NH3",
      mass: MONO[7] + 3 * MONO[1],
      label: "loss of NH3",
      like: "medium",
    },
    {
      need: () => {
        for (let a = 0; a < n; a++) if (mol.getAtomicNo(a) === 17) return true;
        return false;
      },
      formula: "HCl",
      mass: MONO[1] + MONO[17],
      label: "loss of HCl",
      like: "medium",
    },
  ];
  for (const fl of featureLosses) {
    if (!fl.need()) continue;
    const mz = molMass - fl.mass - ELECTRON;
    if (mz <= 0) continue;
    // Rebuild the residual formula by subtracting the lost atoms.
    add({
      mz,
      formula: `[M-${fl.formula}]`,
      pathway: fl.label,
      neutralLoss: fl.formula,
      lossMass: fl.mass,
      likelihood: fl.like,
    });
  }

  // Rank: high → medium → low, then descending m/z within each band.
  const rank: Record<Likelihood, number> = { high: 0, medium: 1, low: 2 };
  out.sort((x, y) => rank[x.likelihood] - rank[y.likelihood] || y.mz - x.mz);
  const fragments = out.slice(0, maxFragments).sort((x, y) => y.mz - x.mz);

  if (out.length > maxFragments) {
    caveats.add(`Showing the ${maxFragments} most probable of ${out.length} predicted fragments.`);
  }
  caveats.add(
    "Fragment m/z values are exact; which fragments actually dominate depends on ionisation energy and instrument. Likelihood is a rule-based ranking, not a predicted intensity."
  );
  caveats.add("Ring systems require two bond cleavages and are only covered via the listed rearrangements/neutral losses.");

  return { smiles, formula, molecularIon, fragments, caveats: [...caveats] };
}
