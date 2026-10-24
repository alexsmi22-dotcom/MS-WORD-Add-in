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
// That third bullet is now ENFORCED, and was not before (gap analysis 0.13):
// beta-carotene was given 534 nm against a real ≈450, under the caveat
// "typically ±5 nm within their domain", and anthracene was given benzene's
// tabulated 254 nm against a real ≈375. Precisely what is refused, and what is
// merely flagged:
//
//   REFUSED (lambdaMax null, outOfDomain true)
//     extended        — a conjugated system of more than WF_MAX_CONJUGATED_UNITS
//                       multiple bonds, counting C=C and conjugated C=O alike
//     cross-conjugated — the conjugated system BRANCHES (an atom with three
//                       neighbours inside it)
//     aromatic-fused  — any fused aromatic system (isFusedAromatic)
//
//   FLAGGED, and still given a value
//     cross-conjugated dienone — two unsaturations on one carbonyl. Refusing it
//       was tried and was WRONG: Woodward-Fieser tabulates that chromophore with
//       its own base value, and the ordinary-enone arithmetic already lands
//       within 1 nm for the steroid class (prednisone 239 vs 238 measured). What
//       this module lacks is the separate base, so it says so.
//
//   REFUSED BY NAME (v2.138.0)
//     quinone            — a ring of two C=O conjugated through ring C=C
//     aryl-conjugated enone — an aromatic atom bonded to any atom of an enone
//                       arm (chalcone, benzalacetone, cinnamaldehyde): these
//                       absorb ~60-100 nm above the enone arithmetic
//
//   EVERY ARM IS SCORED (v2.138.0): each enone C=O–Cα=Cβ path, and each
//   separate conjugated diene, gets its own ledger; λmax is the maximum, ties
//   broken by ledger text, so the answer cannot depend on atom order.
//
// The domain test is computed over the WHOLE molecule before a chromophore is
// chosen, so it cannot depend on which branch ran or on SMILES atom ordering.
//
// A refusal returns lambdaMax = null with outOfDomain = true — which is NOT the
// same result as `transparent`, and consumers must not render them the same way.
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
import {
  neighbors,
  carbonylKind,
  classifySubstituent,
  substKeyLabel,
  isFusedAromatic,
  parseToMolecule,
  SubstKey,
  type CarbonylKind,
} from "./molgraph";

/**
 * The size of conjugated system the Woodward-Fieser rules are calibrated for,
 * counted as conjugated multiple bonds (C=C and C=O together).
 *
 * The "+30 nm per extra double bond" increment is LINEAR and a real polyene's
 * λmax is not — it saturates — so there has to be a cut-off. Applied without
 * one, the increment gave beta-carotene (11 conjugated C=C) 534 nm against a
 * real ≈450: an 84 nm error printed under the caveat "typically ±5 nm within
 * their domain".
 *
 * WHERE THE CUT-OFF GOES IS A MEASURED QUESTION, NOT A REMEMBERED ONE. The
 * textbook "about four" was tried first and was wrong here, because it put the
 * boundary in the middle of the accuracy curve rather than at its knee — this
 * model's own error against literature values:
 *
 *   units  molecule        predicted   literature   error
 *     3    hexatriene        244          258        −14
 *     4    octatetraene      274          ~300       −26
 *     5    retinol           334           325        +9
 *     6    retinal           354           383       −29
 *    11    beta-carotene     534           450       +84
 *    11    lycopene          524           470       +54
 *
 * At a limit of 4 the gate REFUSED retinol's 9 nm answer while printing
 * octatetraene's 26 nm one — accuracy and acceptance running in opposite
 * directions, which is not a defensible domain boundary whichever way you argue
 * the chemistry. At 5 the worst kept error is 26 nm and the best refused error
 * is 29 nm, so the ordering is at least monotone and the boundary sits where the
 * model actually breaks down.
 *
 * The kept-but-degraded region is disclosed rather than silently accepted: see
 * EXTENDED_ACCURACY below, which fires for any system past a simple diene/enone.
 *
 * One number, quoted by every branch, so the limits can never drift apart.
 */
const WF_MAX_CONJUGATED_UNITS = 5;

/**
 * What "±5 nm" is actually worth once the system is extended.
 *
 * The rules' quoted accuracy is for the simple dienes and enones they were
 * fitted to. Each extension degrades it — measurably, in this model's own
 * numbers — and the fixed ±5 caveat was being printed over answers 26 nm out.
 */
const EXTENDED_ACCURACY =
  "This chromophore is EXTENDED (more than two conjugated multiple bonds), and the rules' usual ±5 nm does " +
  "not hold there: the +30 nm-per-unit increment is linear while a real polyene's λmax saturates, so the " +
  "prediction runs low and further low with each extension. Measured against literature values, this model " +
  "is about 14 nm low on a triene and 26 nm low on a tetraene. Treat the value as a region, not a figure.";

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
  /**
   * True when a chromophore IS present but sits outside the rules' calibrated
   * domain, so no λmax is predicted.
   *
   * This is NOT `transparent`, and a consumer must not render the two the same
   * way. `transparent` means "absorbs below 200 nm, effectively colourless in
   * the usual window". `outOfDomain` means "absorbs somewhere this model cannot
   * compute" — beta-carotene is orange, and reporting it as transparent would
   * replace one false statement with another.
   */
  outOfDomain: boolean;
  caveats: string[];
  /**
   * Every chromophore arm that was scored, longest wavelength first (enones:
   * one per C=O–Cα=Cβ path, so a cross-conjugated dienone has two; dienes: one
   * per separate conjugated system). λmax is arms[0]'s, and `contributions` is
   * arms[0]'s ledger. Absent on refusals and on the non-Woodward-Fieser
   * branches. The order is independent of SMILES atom order.
   */
  arms?: UvArm[];
}

/** One scored Woodward-Fieser arm, for listing beside the winning ladder. */
export interface UvArm {
  chromophore: string;
  lambdaMax: number;
  contributions: UvContribution[];
  /** The arm's arithmetic as one line, e.g. "… arm: base 215 + β-alkyl ×2 24 = 239 nm". */
  ledger: string;
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
    // "carboxylate" is collected so the enone branch can REFUSE it by name:
    // Woodward-Fieser tabulates a base for α,β-unsaturated acids and esters
    // (195 nm), not for the COO⁻ anion, and before carboxylates were their own
    // class they were "ester" and got that base.
    if (!["ketone", "aldehyde", "acid", "ester", "carboxylate"].includes(kind)) continue;
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

/** One maximal conjugated system of C=C bonds, with what is attached to it. */
interface ConjugatedSystem {
  atoms: Set<number>;
  /** Conjugated C=C bonds in the system. */
  ccCount: number;
  /**
   * Carbonyls that EXTEND the chain — one at most per end of it.
   *
   * Counting every carbonyl bonded to the system was wrong, and measurably so:
   * ethylenetetracarboxylic acid is ONE C=C carrying four -COOH, and came out as
   * a "5 conjugated unit" extended polyene and was refused, against a real λmax
   * near 230 nm. A carbonyl hanging off the middle of a chain, or a third one on
   * an end, is cross-conjugation — it does not lengthen the chain the Woodward
   * increments run along, so it must not count toward the chain's length.
   */
  carbonylCount: number;
  /** True when the system BRANCHES — an atom with three system neighbours. */
  branched: boolean;
  /**
   * True when the conjugation closes a RING: a fully conjugated macrocycle or
   * annulene (a porphyrin, azulene), not a chain.
   *
   * Used only to name the refusal correctly, never to decide it. Calling heme a
   * "cross-conjugated polyene" and azulene an "extended polyene" was wrong about
   * the chemistry even though refusing both was right, and the refusal text is
   * on screen. A homoannular diene inside a cyclohexadiene ring is NOT this:
   * its ring closes through sp3 carbons that are not part of the π system.
   */
  cyclic: boolean;
}

/**
 * Every maximal conjugated C=C system in the molecule.
 *
 * WHY EVERY ONE, not just the first. The diene branch below returns on the
 * first conjugated system it meets in ATOM ORDER, so a size check made inside it
 * is decided by how the SMILES happens to be written: measured, the same
 * molecule written "C=CC=CCCCCCC=CC=CC=CC=CC=C" was given a confident 219 nm
 * while "C=CC=CC=CC=CC=CCCCCCC=CC=C" was refused. Worse, the enone branch runs
 * first and only ever inspects one enone, so a molecule carrying a small enone
 * AND a long polyene escaped the limit entirely. The domain test has to be a
 * property of the MOLECULE, so it is computed here and applied before either
 * branch chooses anything.
 */
function conjugatedSystems(mol: Molecule): ConjugatedSystem[] {
  const key = (x: number, y: number) => `${Math.min(x, y)}-${Math.max(x, y)}`;
  const claimed = new Set<string>();
  const systems: ConjugatedSystem[] = [];

  for (const alk of findAlkenes(mol)) {
    if (claimed.has(key(alk.a, alk.b))) continue;
    const visited = new Set<string>();
    countExtendedConjugation(mol, alk, visited);
    for (const k of visited) claimed.add(k);

    const atoms = new Set<number>();
    for (const k of visited) for (const p of k.split("-")) atoms.add(Number(p));

    // Only a carbonyl on an END of the chain extends it, and only one per end:
    // the chain has two ends, so a carbonyl can add at most 2 units however many
    // are bonded to the system. An END is an atom with at most one neighbour
    // inside the system (both atoms of an isolated C=C are ends; a ring has
    // none).
    let carbonylCount = 0;
    for (const x of atoms) {
      if (neighbors(mol, x).filter((nb) => atoms.has(nb.atom)).length > 1) continue;
      const extends_ = neighbors(mol, x).some(
        (nb) => nb.order === 1 && !atoms.has(nb.atom) && carbonylKind(mol, nb.atom) !== null
      );
      if (extends_) carbonylCount++;
    }

    const branched = [...atoms].some(
      (x) => neighbors(mol, x).filter((nb) => atoms.has(nb.atom)).length >= 3
    );

    // A tree of n atoms has n-1 edges; anything more closes a cycle.
    let internalBonds = 0;
    for (const x of atoms) internalBonds += neighbors(mol, x).filter((nb) => atoms.has(nb.atom)).length;
    const cyclic = internalBonds / 2 >= atoms.size;

    systems.push({ atoms, ccCount: visited.size, carbonylCount, branched, cyclic });
  }
  return systems;
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

/**
 * The caveat for a charge-aware substituent with no tabulated increment (see
 * untabulatedAuxochrome in predictUvVis — the same sentence, so an arm scored
 * here and the diene branch can never word it differently).
 */
function untabulatedAuxochromeText(key: SubstKey, where: string): string | null {
  const label = substKeyLabel(key);
  if (!label) return null;
  return (
    `${label} on the ${where} position of the chromophore has NO Woodward-Fieser increment tabulated ` +
    "here and was OMITTED from the sum — the value is for the chromophore without that group, and a " +
    "charged auxochrome can move λmax by tens of nm."
  );
}

/** One scored enone arm: its own ledger, kept so every arm can be listed. */
interface ScoredArm {
  enone: Enone;
  lambdaMax: number;
  contributions: UvContribution[];
  /** Caveats this arm's arithmetic raised (extension, untabulated groups). */
  caveats: string[];
  /** The arm's C=C bonds (α=β and any extension), for the exocyclic count. */
  cc: [number, number][];
  chromophore: string;
  /** "base 215 + β-alkyl / ring residue ×2 24 = 239 nm" — no atom indices. */
  ledger: string;
}

/** The base value and label for an enone arm, by carbonyl class and ring size. */
function enoneBase(mol: Molecule, e: Enone): { base: number; label: string } {
  if (e.kind === "aldehyde") return { base: 210, label: "α,β-unsaturated aldehyde base" };
  if (e.kind === "acid" || e.kind === "ester") return { base: 195, label: "α,β-unsaturated acid/ester base" };
  if (mol.isRingAtom(e.carbonyl) && mol.getAtomRingSize(e.carbonyl) === 5) return { base: 202, label: "5-ring enone base" };
  return { base: 215, label: "6-ring / acyclic enone base" };
}

/** The C=C bonds an arm's conjugation runs through: α=β plus every extension. */
function enoneConjugation(mol: Molecule, e: Enone): { extra: number; cc: [number, number][] } {
  const visited = new Set<string>([`${Math.min(e.alpha, e.beta)}-${Math.max(e.alpha, e.beta)}`]);
  const extra = countExtendedConjugation(mol, { a: e.alpha, b: e.beta }, visited);
  const cc = [...visited].map((k) => k.split("-").map(Number) as [number, number]);
  return { extra, cc };
}

/** Next C=C along a chain from `from` (single bond out, then a C=C), excluding `used`. */
function nextCC(mol: Molecule, from: number, used: Set<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const nb of neighbors(mol, from)) {
    if (nb.order !== 1 || used.has(nb.atom) || mol.getAtomicNo(nb.atom) !== 6 || mol.isAromaticAtom(nb.atom)) continue;
    if (carbonylKind(mol, nb.atom)) continue;
    for (const nb2 of neighbors(mol, nb.atom)) {
      if (nb2.order !== 2 || used.has(nb2.atom) || mol.getAtomicNo(nb2.atom) !== 6 || mol.isAromaticAtom(nb2.atom)) continue;
      out.push([nb.atom, nb2.atom]);
    }
  }
  return out;
}

/**
 * The enone's chromophore chain in Woodward-Fieser order — [α, β, γ, δ, ε, …] —
 * followed from β. `branched` is set when the extension forks (two ways on
 * from one atom) and `throughAlpha` when a C=C hangs off α (cross-conjugation
 * through α): neither is in the enone table, and both are refused by name.
 */
function enoneChain(mol: Molecule, e: Enone): { atoms: number[]; branched: boolean; throughAlpha: boolean } {
  const atoms = [e.alpha, e.beta];
  const used = new Set<number>([e.carbonyl, e.alpha, e.beta]);
  let branched = false;
  let cur = e.beta;
  for (let guard = 0; guard < 64; guard++) {
    const next = nextCC(mol, cur, used);
    if (!next.length) break;
    if (next.length > 1) {
      branched = true;
      break;
    }
    const [g, d] = next[0];
    atoms.push(g, d);
    used.add(g);
    used.add(d);
    cur = d;
  }
  const throughAlpha = nextCC(mol, e.alpha, used).length > 0;
  return { atoms, branched, throughAlpha };
}

/** Consecutive chain C=C pairs that share one ring: each is a homoannular diene component. */
function homoannularPairs(mol: Molecule, chain: number[]): number {
  const rs = mol.getRingSet();
  let n = 0;
  for (let i = 0; i + 3 < chain.length; i += 2) {
    const four = chain.slice(i, i + 4);
    for (let r = 0; r < rs.getSize(); r++) {
      const ring = rs.getRingAtoms(r);
      if (four.every((a) => ring.includes(a))) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Every atom of an arm's chromophore: C=O carbon, α, β, and the extension. */
function enoneChromophoreAtoms(mol: Molecule, e: Enone): Set<number> {
  const atoms = new Set<number>([e.carbonyl, e.alpha, e.beta]);
  for (const [x, y] of enoneConjugation(mol, e).cc) {
    atoms.add(x);
    atoms.add(y);
  }
  return atoms;
}

/**
 * True when an aromatic atom is bonded to ANY atom of the chromophore — the C=O
 * carbon (chalcone's PhC=O), α, β (benzalacetone's styryl), or an extension.
 * An aromatic ring merely elsewhere in the molecule (a benzyl group on an
 * enone) is not conjugated to it and does not trigger this.
 */
function arylConjugated(mol: Molecule, chromophore: Set<number>): boolean {
  for (const x of chromophore) {
    for (const nb of neighbors(mol, x)) {
      if (chromophore.has(nb.atom)) continue;
      if (mol.isAromaticAtom(nb.atom)) return true;
    }
  }
  return false;
}

/**
 * A quinone: a ring holding two or more ketone C=O, every ring atom sp² (a C=O
 * carbon or a carbon double-bonded to another ring atom, or aromatic), with an
 * enone arm inside it. p-Benzoquinone, toluquinone, duroquinone. Cyclohexa-2,5-
 * dienone (one C=O) and cyclohexene-1,4-dione (two sp³ ring carbons) are not.
 */
function quinoneRing(mol: Molecule, enones: Enone[]): boolean {
  const rs = mol.getRingSet();
  for (let r = 0; r < rs.getSize(); r++) {
    const ring = rs.getRingAtoms(r);
    const inRing = new Set(ring);
    let ketones = 0;
    let allSp2 = true;
    for (const a of ring) {
      if (carbonylKind(mol, a) === "ketone") {
        ketones++;
        continue;
      }
      const sp2 =
        mol.isAromaticAtom(a) ||
        neighbors(mol, a).some((nb) => nb.order === 2 && inRing.has(nb.atom) && mol.getAtomicNo(nb.atom) === 6);
      if (!sp2) allSp2 = false;
    }
    if (ketones >= 2 && allSp2 && enones.some((e) => inRing.has(e.carbonyl) && inRing.has(e.alpha))) return true;
  }
  return false;
}

/**
 * How many (C=C, ring) pairs are EXOCYCLIC: the double bond has exactly one of
 * its atoms in that ring. A graph property — testosterone's C4=C5 lies in ring A
 * and leaves ring B at C5 — so no 3D context is needed to find it.
 */
function exocyclicCount(mol: Molecule, cc: [number, number][]): number {
  const rs = mol.getRingSet();
  let n = 0;
  for (const [x, y] of cc) {
    for (let r = 0; r < rs.getSize(); r++) {
      const ring = rs.getRingAtoms(r);
      if (ring.includes(x) !== ring.includes(y)) n++;
    }
  }
  return n;
}

/**
 * DECISION D-1 (docs/SCOPE-SPECTROSCOPY-BATCH.md §E7): the +5 nm exocyclic
 * increment is NOT applied. Applying it moves prednisone from 239 to 244 nm
 * against a measured 238, outside the ±5 the rules are quoted at, so the
 * caveat is made true instead. It used to say the increment "requires 3D ring
 * context", which was false: exocyclicity is read from the bond graph.
 */
function exocyclicCaveat(n: number): string {
  return (
    `This chromophore has ${n === 1 ? "an exocyclic C=C" : `${n} exocyclic C=C placements`} (a double bond ` +
    "leaving a ring, found from the bond graph). Woodward-Fieser adds +5 nm for each; that increment is NOT " +
    "applied here, because on the steroid enones it moves the value away from the measured one (prednisone " +
    "239 → 244 nm against a measured 238)."
  );
}

/** Scores one enone arm with its own ledger. Pure: no shared caveat state. */
function scoreEnoneArm(mol: Molecule, e: Enone): ScoredArm {
  const contributions: UvContribution[] = [];
  const caveats: string[] = [];

  const { base, label } = enoneBase(mol, e);
  contributions.push({ label, nm: base });
  let lambda = base;

  // THE CHROMOPHORE CHAIN, in order: α, β, then γ, δ, … along the extension
  // from β. Every chain atom is PART of the chromophore and is excluded from
  // the substituent counts — counting the γ carbon as a "β-alkyl" (+12) was the
  // defect that put hexa-2,4-dienal at 252 instead of 258 and 6,6-dimethyl-
  // cyclohexa-2,4-dienone 45 nm low.
  const { cc } = enoneConjugation(mol, e);
  const chain = enoneChain(mol, e);
  const skeletonAll = new Set([e.carbonyl, ...chain.atoms]);
  const extra = chain.atoms.length / 2 - 1;
  if (extra > 0) {
    contributions.push({ label: `Extended conjugation ×${extra}`, nm: 30 * extra });
    lambda += 30 * extra;
    caveats.push(EXTENDED_ACCURACY);
  }
  // Homoannular diene component (+39): two consecutive chain C=C in one ring.
  const homo = homoannularPairs(mol, chain.atoms);
  if (homo) {
    contributions.push({ label: `Homoannular diene component${homo > 1 ? ` ×${homo}` : ""}`, nm: 39 * homo });
    lambda += 39 * homo;
  }

  // Alkyl substituents / ring residues by position: α +10, β +12, γ and
  // higher +18 (Pavia, Lampman & Kriz, "Introduction to Spectroscopy", and
  // Silverstein, Woodward-Fieser enone table).
  const posName = (i: number) => (i === 0 ? "α" : i === 1 ? "β" : i === 2 ? "γ" : "δ");
  const alkylByPos = new Map<string, number>();
  chain.atoms.forEach((atom, i) => {
    // At γ and beyond, a C=O carbon is not an "alkyl" (muconic acid's second
    // COOH sits on the δ carbon); α/β keep their long-standing count.
    const exclude = [...skeletonAll];
    if (i >= 2) for (const nb of neighbors(mol, atom)) if (carbonylKind(mol, nb.atom)) exclude.push(nb.atom);
    const n = alkylSubstituentCount(mol, atom, exclude);
    if (!n) return;
    const key = i <= 1 ? posName(i) : "γ/δ";
    alkylByPos.set(key, (alkylByPos.get(key) ?? 0) + n);
  });
  for (const key of ["α", "β", "γ/δ"]) {
    const n = alkylByPos.get(key);
    if (!n) continue;
    const per = key === "α" ? 10 : key === "β" ? 12 : 18;
    const lbl = key === "γ/δ" ? "γ-or-higher alkyl / ring residue" : `${key}-alkyl / ring residue`;
    contributions.push({ label: `${lbl} ×${n}`, nm: per * n });
    lambda += per * n;
  }

  // Polar auxochromes by position (same table). Within one position they are
  // sorted by label: a carbon can carry two, and neighbour order is atom order.
  const POLAR: Record<string, Record<string, number>> = {
    α: { OH: 35, OR: 35, OAc: 6, Cl: 15, Br: 25, NR2: 0 },
    β: { OH: 30, OR: 30, OAc: 6, Cl: 12, Br: 30, NR2: 95, SR: 85 },
    γ: { OR: 17, OAc: 6 },
    δ: { OH: 50, OR: 31, OAc: 6 },
  };
  for (const [pos, atom, incs] of chain.atoms.map(
    (a, i) => [posName(i), a, POLAR[posName(i)]] as [string, number, Record<string, number>]
  )) {
    const here: UvContribution[] = [];
    const hereCaveats: string[] = [];
    for (const nb of neighbors(mol, atom)) {
      if (skeletonAll.has(nb.atom)) continue;
      const key = classifySubstituent(mol, nb.atom, atom);
      const inc = incs[key];
      if (inc === undefined) {
        const t = untabulatedAuxochromeText(key, pos);
        if (t) hereCaveats.push(t);
      }
      if (inc === undefined || inc === 0) continue;
      here.push({ label: `${pos}-${key}`, nm: inc });
      lambda += inc;
    }
    here.sort((x, y) => (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
    contributions.push(...here);
    caveats.push(...hereCaveats.sort());
  }

  const chromophore = `α,β-unsaturated ${e.kind === "acid" || e.kind === "ester" ? "acid/ester" : e.kind}`;
  const ledger = `${chromophore} arm: ${contributions.map((c) => `${c.label} ${c.nm}`).join(" + ")} = ${lambda} nm`;
  return { enone: e, lambdaMax: lambda, contributions, caveats, cc, chromophore, ledger };
}

/** Longest wavelength first; ties by ledger text, which carries no atom index. */
function compareArms(x: ScoredArm, y: ScoredArm): number {
  if (y.lambdaMax !== x.lambdaMax) return y.lambdaMax - x.lambdaMax;
  return x.ledger < y.ledger ? -1 : x.ledger > y.ledger ? 1 : 0;
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
  let hasFusedAromatic = false;
  let hasHeteroAromatic = false;
  let hasExtendedAromaticRing = false;
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    if (!mol.isAromaticAtom(a)) continue;
    hasAromatic = true;
    if (isFusedAromatic(mol, a)) hasFusedAromatic = true;
    // A ring atom that is not carbon makes the ring heteroaromatic, whatever
    // else is true of it.
    if (mol.getAtomicNo(a) !== 6) hasHeteroAromatic = true;
    // The aromatic ring is FUSED INTO ANOTHER CONJUGATED RING: a non-aromatic
    // RING bond leaving an aromatic atom, to a partner that is itself part of a
    // π system (a heteroatom, an aromatic atom, or an atom bearing a multiple
    // bond).
    //
    // isFusedAromatic only sees fusion that OpenChemLib perceives as ONE
    // aromatic system, which is why it misses anthraquinone (two benzo rings
    // joined through a non-aromatic quinone ring) and caffeine (only the
    // imidazole is perceived aromatic). This is the same class and the same
    // consequence — a π system far larger than an isolated benzene ring being
    // handed benzene's tabulated 254 nm.
    //
    // The "partner is π" requirement is what keeps tetralin and indane, whose
    // second ring is saturated and does not extend anything.
    //
    // A HETEROATOM ALONE IS NOT ENOUGH, and the first draft of this had it as
    // enough. That refused morphine, codeine, strychnine, tocopherol and
    // catechin — all benzene rings fused to a ring holding a saturated O or N —
    // while phenol, aniline and anisole, which are the SAME donating group
    // attached acyclically, kept the benzenoid value under the existing "
    // substituents shift these bands" caveat. Refusing the cyclic form and
    // keeping the acyclic one is not a domain boundary, it is an inconsistency;
    // strychnine's real λmax is 254, the exact value being thrown away. The
    // partner must actually carry π: aromatic, or bearing a multiple bond.
    for (const nb of neighbors(mol, a)) {
      if (nb.aromatic || !mol.isRingBond(nb.bond)) continue;
      const other = nb.atom;
      const partnerIsPi =
        mol.isAromaticAtom(other) || neighbors(mol, other).some((x) => x.order >= 2);
      if (partnerIsPi) hasExtendedAromaticRing = true;
    }
  }

  /**
   * The honest out-of-domain answer: a chromophore IS present, and this model
   * declines to put a number on it.
   *
   * NOT `transparent`. Beta-carotene is orange; saying "absorbs below 200 nm"
   * about it would swap one false statement for another. And no contributions:
   * there is no arithmetic to audit when there is no answer.
   */
  /**
   * A charge-aware substituent (phenoxide O⁻, ammonio NH₃⁺/NR₃⁺, carboxylate,
   * an imine carbon) sitting on the chromophore. Woodward-Fieser tabulates no
   * increment for any of them and none is invented: the group is named and the
   * sum below is explicitly for the chromophore WITHOUT it. (An enolate O⁻ on
   * a β carbon is a very large effect; silence would have been the worst
   * possible answer.)
   */
  const refuse = (chromophore: string, why: string): UvResult => {
    caveats.add(why);
    caveats.add(
      "No λmax is predicted for this structure. The Woodward-Fieser rules are an additivity scheme with a " +
        "defined domain, and this chromophore is outside it — a number from them here would carry no useful " +
        "accuracy, and the ±5 nm the rules are quoted at would not apply to it."
    );
    return {
      smiles,
      lambdaMax: null,
      chromophore,
      contributions: [],
      transparent: false,
      outOfDomain: true,
      caveats: [...caveats],
    };
  };

  // --- Fused aromatic systems --------------------------------------------
  // Naphthalene, anthracene, indole, a purine: their bands are NOT the isolated
  // benzene B-band, and Woodward-Fieser does not cover aromatics at all. The
  // aromatic branch below used to hand every one of them a flat tabulated
  // 254 nm — anthracene really absorbs near 375 nm, naphthalene near 275/312.
  if (hasFusedAromatic) {
    return refuse(
      "fused aromatic ring system (outside the model's domain)",
      "Fused aromatic ring system (naphthalene / anthracene / indole type). Its absorption is not the " +
        "isolated-benzene B-band — fusion extends the π system and moves the bands substantially to longer " +
        "wavelength — and the tabulated benzene value does not apply. Fused-ring λmax values are a separate " +
        "tabulation this module does not carry."
    );
  }

  // --- Heteroaromatic rings ------------------------------------------------
  // A pyridine is not a benzene ring, and neither is a furan, a thiophene, a
  // pyrrole, an imidazole, a pyrimidine, or the imidazole of caffeine and
  // guanine. Every one of them was being returned as 254 nm under the literal
  // label "benzene ring (B-band)" — furan's real λmax is ≈208, caffeine's ≈273,
  // riboflavin's 445/375/267 (it is bright yellow, and the tool called it a
  // colourless benzene). The benzenoid table covers a benzene ring; nothing in
  // this module covers a heteroaromatic one.
  if (hasHeteroAromatic) {
    return refuse(
      "heteroaromatic ring (outside the model's domain)",
      "Heteroaromatic ring (pyridine, furan, thiophene, pyrrole, imidazole, pyrimidine, purine …). Its " +
        "bands are NOT benzene's: the heteroatom's lone pair and electronegativity move them, and each ring " +
        "system has its own tabulated values — from ≈208 nm for furan to well past 300 nm for a fused " +
        "purine. This module carries the benzenoid table only, so no λmax is predicted rather than " +
        "benzene's, which would be a value for a different molecule."
    );
  }

  // --- Aromatic rings fused into another conjugated ring -------------------
  if (hasExtendedAromaticRing) {
    return refuse(
      "polycyclic conjugated aromatic system (outside the model's domain)",
      "The aromatic ring here is fused into a second CONJUGATED ring, so the π system is much larger than " +
        "an isolated benzene ring — anthraquinone and a coumarin are the common cases, and anthraquinone " +
        "really absorbs near 325 nm against benzene's tabulated 254. That tabulated value describes an " +
        "isolated ring and does not transfer. (A benzene fused to a SATURATED ring — tetralin, indane — is " +
        "not this: nothing there extends the π system, and it keeps the benzenoid value.)"
    );
  }

  // --- Domain limits, computed over the WHOLE molecule --------------------
  // Before either branch picks a chromophore, so the answer cannot depend on
  // which one it picked or on SMILES atom ordering.
  for (const sys of conjugatedSystems(mol)) {
    const units = sys.ccCount + sys.carbonylCount;
    // A fully conjugated RING is refused for the same reason but is not a
    // polyene chain, and must not be described as one: azulene is a
    // non-benzenoid aromatic (OCL does not perceive it as aromatic, so
    // isFusedAromatic misses it) and heme and chlorophyll are conjugated
    // macrocycles. The refusal is unchanged; only the reason given is.
    if (sys.cyclic && (units > WF_MAX_CONJUGATED_UNITS || sys.branched)) {
      return refuse(
        `fully conjugated ring system, ${units} conjugated units (outside the model's domain)`,
        `The conjugation closes a RING here (${units} conjugated multiple bonds), as in an annulene, ` +
          "azulene, or a porphyrin macrocycle such as heme or chlorophyll. Woodward-Fieser covers acyclic " +
          "and simple-ring dienes and enones, whose increments run along an open chain; a conjugated ring " +
          "system has its own spectroscopy (azulene 270/580 nm, a porphyrin's Soret band near 400 nm with " +
          "Q bands beyond) that these rules do not reach."
      );
    }
    if (units > WF_MAX_CONJUGATED_UNITS) {
      return refuse(
        `extended conjugation, ${units} conjugated units (outside the model's domain)`,
        `This molecule contains a chromophore of ${units} conjugated multiple bonds (${sys.ccCount} C=C` +
          `${sys.carbonylCount ? ` and ${sys.carbonylCount} conjugated C=O` : ""}). The Woodward-Fieser ` +
          `rules are calibrated for systems of up to about ${WF_MAX_CONJUGATED_UNITS}; beyond that the flat ` +
          "+30 nm-per-unit increment breaks down, because a real polyene's λmax saturates rather than " +
          "rising linearly. Beta-carotene came out at 534 nm this way against a real ≈450. A long polyene " +
          "needs the Fieser-Kuhn relation or a measurement — neither is done here."
      );
    }
    // CROSS-CONJUGATION in a polyene: the conjugated system BRANCHES. Every atom
    // of a linear chain has at most two neighbours inside the system; a branch
    // point has three. The increments are additive along one chain only.
    if (sys.branched) {
      return refuse(
        // Not "polyene": the branch test also catches a fully conjugated
        // macrocycle (a porphyrin — heme, chlorophyll), which is a branched π
        // system but is nobody's idea of a cross-conjugated polyene.
        "branched (cross-conjugated) π system — outside the model's domain",
        "Cross-conjugated chromophore: the conjugated system branches rather than running in a single " +
          "chain. Woodward-Fieser increments are additive along one chain only, so there is no defined " +
          "value for a branched system. A conjugated macrocycle also lands here — a porphyrin such as " +
          "heme or chlorophyll branches at its meso positions — and its Soret and Q bands are a different " +
          "spectroscopy from anything these rules describe."
      );
    }
  }

  // --- α,β-unsaturated carbonyl (Woodward-Fieser enone rules) -------------
  if (enones.some((x) => x.kind === "carboxylate")) {
    return refuse(
      "α,β-unsaturated carboxylate, COO⁻ (outside the model's domain)",
      "A C=C conjugated to a CARBOXYLATE anion (COO⁻). Woodward-Fieser gives a base value for an " +
        "α,β-unsaturated acid or ester (195 nm), not for the anion, whose two equivalent C-O bonds are a " +
        "different chromophore. No value is tabulated for it here, so none is predicted rather than the " +
        "neutral acid's."
    );
  }
  if (enones.length) {
    // REFUSALS FIRST, before anything is added to the caveat set: a refusal must
    // never carry a caveat written for a value it did not produce.
    //
    // And refuse the WHOLE molecule if any arm is out of domain. λmax is the
    // maximum over the arms, and a maximum cannot be taken over an arm whose
    // value is unknown — an aryl enone really absorbs 60-100 nm above anything
    // the enone arithmetic gives, so it would be the maximum.
    if (quinoneRing(mol, enones)) {
      return refuse(
        "quinone chromophore — not a Woodward-Fieser enone",
        "Quinone chromophore — not a Woodward-Fieser enone. The ring holds two C=O conjugated through the ring " +
          "C=C (p-benzoquinone, a methyl- or tetramethyl-quinone), which is a single cyclic chromophore with its " +
          "own bands, not an α,β-unsaturated ketone with a β-alkyl substituent. Scored as one, p-benzoquinone " +
          "came out at 227 nm and duroquinone at 249 under a ±5 nm caveat, from rules that do not describe them."
      );
    }
    if (enones.some((x) => arylConjugated(mol, enoneChromophoreAtoms(mol, x)))) {
      return refuse(
        "aryl-conjugated enone — Woodward-Fieser does not apply",
        "Aryl-conjugated enone — Woodward-Fieser does not apply; no value is given. An aromatic ring conjugated " +
          "to the enone (a styryl or aryl-ketone system: benzalacetone, chalcone, cinnamaldehyde, " +
          "dibenzylideneacetone) is a much longer chromophore than the enone the rules describe, and absorbs " +
          "roughly 60-100 nm above the enone arithmetic (which gives 227 nm for the three ketones and 222 for " +
          "cinnamaldehyde). Scott's rules cover " +
          "aryl carbonyls ArCOX, not styryl systems, and neither is carried here."
      );
    }

    // Extensions the enone table does not describe: a fork in the chain, or a
    // C=C conjugated through α. Refused by name rather than scored under a
    // ±5 nm label that would not apply.
    if (enones.some((x) => { const c = enoneChain(mol, x); return c.branched || c.throughAlpha; })) {
      return refuse(
        "cross-conjugated extended enone — outside the Woodward-Fieser enone table",
        "Cross-conjugated extended enone: the conjugation forks, or a C=C is conjugated through the α carbon " +
          "rather than along the chain from β. The Woodward-Fieser enone increments (+30 per extending C=C, " +
          "+18 for γ/δ substituents, +39 for a homoannular diene component) are tabulated for a single chain " +
          "running from β, so no value is given."
      );
    }

    // EVERY arm is scored, each with its own ledger, and λmax is the maximum.
    //
    // Scoring only enones[0] made the answer depend on SMILES ATOM ORDER — the
    // header above promised it could not. One molecule with two separate enones
    // came out 227 nm written one way and 239 the other; androsta-1,4-diene-3,17-
    // dione got 227 (its C1=C2 arm) while prednisone, the same chromophore, got
    // 239 (its C4=C5 arm). Arms are sorted by λ, then by their ledger text (which
    // carries no atom index), so the winner, the tie-break, the arm listing and
    // the caveat order are all independent of how the input was written.
    const arms = enones.map((x) => scoreEnoneArm(mol, x)).sort(compareArms);
    const best = arms[0];
    const e = best.enone;

    // Two unsaturations on ONE carbonyl is the cross-conjugated dienone. It is
    // NOT refused: Woodward-Fieser tabulates that chromophore explicitly, with
    // its own base value, and refusing it threw away answers that were RIGHT —
    // prednisone and dexamethasone both came out at 239 nm against measured 238
    // and 239. What this module lacks is the separate base, so it says so and
    // reports the single-enone arithmetic as indicative.
    const perCarbonyl = new Map<number, number>();
    for (const x of enones) perCarbonyl.set(x.carbonyl, (perCarbonyl.get(x.carbonyl) ?? 0) + 1);
    if ([...perCarbonyl.values()].some((c) => c > 1)) {
      caveats.add(
        "Cross-conjugated dienone: one carbonyl carries two separate unsaturations. Woodward-Fieser " +
          "tabulates a SEPARATE base value for that chromophore (the steroidal 1,4-dien-3-one), which this " +
          "module does not carry — the value below is built from the ordinary enone base and is indicative " +
          "for this class rather than accurate to the usual ±5 nm."
      );
    }
    if (arms.length > 1) {
      // Every arm is listed with its own value, so the user can see which one
      // set λmax and by how much the others fall short.
      caveats.add(
        `${arms.length} enone arms were each scored (${arms.map((a) => a.lambdaMax).join(", ")} nm); λmax is ` +
          `the longest-wavelength arm, whose arithmetic is shown. Every arm: ${arms.map((a) => a.ledger).join("; ")}.`
      );
    }
    for (const a of arms) for (const c of a.caveats) caveats.add(c);

    const exo = exocyclicCount(mol, best.cc);
    if (exo > 0) caveats.add(exocyclicCaveat(exo));

    if (hasAromatic) {
      // Any ring CONJUGATED to an arm was refused above, so a ring reaching this
      // point is elsewhere in the molecule.
      caveats.add(
        "A benzene ring is present but is not conjugated to the enone; its own weak B-band near 254 nm is a " +
          "separate absorption and is not part of this λmax."
      );
    }
    // The ±5 nm claim is made only for the simple enones it was fitted to; an
    // extended (dienone/dienal) arm carries EXTENDED_ACCURACY instead.
    if (!best.contributions.some((c) => c.label.startsWith("Extended conjugation"))) {
      caveats.add("Woodward-Fieser enone rules: typically ±5 nm within their domain (ethanol solution).");
    }
    contributions.push(...best.contributions);
    return {
      smiles,
      lambdaMax: best.lambdaMax,
      chromophore: `α,β-unsaturated ${e.kind === "acid" || e.kind === "ester" ? "acid/ester" : e.kind}`,
      contributions,
      transparent: false,
      outOfDomain: false,
      caveats: [...caveats],
      arms: arms.map((a) => ({ chromophore: a.chromophore, lambdaMax: a.lambdaMax, contributions: a.contributions, ledger: a.ledger })),
    };
  }

  // --- Conjugated diene (Woodward-Fieser diene rules) ---------------------
  // A diene needs two C=C joined by a single bond.
  //
  // EVERY conjugated system is scored and the longest wavelength wins, as for
  // the enone arms. This loop used to RETURN on the first diene in atom order,
  // so a molecule with two separate dienes got whichever the SMILES listed first.
  // Starting from any C=C of one system reaches the same system and the same
  // sum, so scoring every alkene and sorting is exactly "max over systems".
  const dienes: ScoredArm[] = [];
  const seenSystems = new Set<string>();
  for (const alk of alkenes) {
    const visited = new Set<string>();
    const extra = countExtendedConjugation(mol, alk, visited);
    if (extra < 1) continue; // isolated alkene, not a diene
    const sysKey = [...visited].sort().join("|");
    if (seenSystems.has(sysKey)) continue;
    seenSystems.add(sysKey);

    const conjAtoms = new Set<number>();
    for (const k of visited) for (const p of k.split("-")) conjAtoms.add(Number(p));
    const contribs: UvContribution[] = [];
    const armCaveats: string[] = [];

    // Size and branching are enforced above, over the whole molecule.
    // Homoannular (both C=C in the same ring, cisoid) base 253; else 214.
    const ringAtoms = [...conjAtoms].filter((x) => mol.isRingAtom(x));
    const homoannular =
      ringAtoms.length >= 4 &&
      new Set(ringAtoms.map((x) => mol.getAtomRingSize(x))).size === 1 &&
      ringAtoms.length === conjAtoms.size;
    const base = homoannular ? 253 : 214;
    contribs.push({ label: homoannular ? "Homoannular diene base" : "Acyclic/heteroannular diene base", nm: base });
    let lambda = base;

    if (extra > 1) {
      contribs.push({ label: `Extended conjugation ×${extra - 1}`, nm: 30 * (extra - 1) });
      lambda += 30 * (extra - 1);
      armCaveats.push(EXTENDED_ACCURACY);
    }

    // +5 nm per alkyl substituent / ring residue on the conjugated system.
    // Auxochromes are collected and SORTED by label: walking conjAtoms visits
    // them in atom order, and the ladder must not depend on that.
    let alkyl = 0;
    const auxContribs: UvContribution[] = [];
    const auxCaveats: string[] = [];
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
        if (!aux) {
          const t = untabulatedAuxochromeText(key, "diene");
          if (t) auxCaveats.push(t);
        }
        if (aux && aux.nm > 0) {
          auxContribs.push({ label: aux.label, nm: aux.nm });
          lambda += aux.nm;
        }
      }
    }
    auxContribs.sort((x, y) => (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
    contribs.push(...auxContribs);
    armCaveats.push(...auxCaveats.sort());
    if (alkyl) {
      contribs.push({ label: `Alkyl / ring residue ×${alkyl}`, nm: 5 * alkyl });
      lambda += 5 * alkyl;
    }
    const chromophore = homoannular ? "homoannular conjugated diene" : "conjugated diene";
    dienes.push({
      enone: { carbonyl: -1, alpha: alk.a, beta: alk.b, kind: "diene" },
      lambdaMax: lambda,
      contributions: contribs,
      caveats: armCaveats,
      cc: [...visited].map((k) => k.split("-").map(Number) as [number, number]),
      chromophore,
      ledger: `${chromophore}: ${contribs.map((c) => `${c.label} ${c.nm}`).join(" + ")} = ${lambda} nm`,
    });
  }
  if (dienes.length) {
    dienes.sort(compareArms);
    const best = dienes[0];
    if (dienes.length > 1) {
      caveats.add(
        `${dienes.length} separate conjugated dienes were each scored (${dienes.map((d) => d.lambdaMax).join(", ")} nm); ` +
          `λmax is the longest-wavelength one, whose arithmetic is shown. Every system: ${dienes.map((d) => d.ledger).join("; ")}.`
      );
    }
    for (const d of dienes) for (const c of d.caveats) caveats.add(c);
    if (hasAromatic) {
      caveats.add("An aromatic ring is present; if it is conjugated to the diene the rules do not strictly apply.");
    }
    caveats.add("Woodward-Fieser diene rules: typically ±5 nm within their domain (ethanol solution).");
    const exo = exocyclicCount(mol, best.cc);
    if (exo > 0) caveats.add(exocyclicCaveat(exo));
    contributions.push(...best.contributions);
    return {
      smiles,
      lambdaMax: best.lambdaMax,
      chromophore: best.chromophore,
      contributions,
      transparent: false,
      outOfDomain: false,
      caveats: [...caveats],
      arms: dienes.map((a) => ({ chromophore: a.chromophore, lambdaMax: a.lambdaMax, contributions: a.contributions, ledger: a.ledger })),
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
      outOfDomain: false,
      caveats: [...caveats],
    };
  }

  // --- Isolated carbonyl ---------------------------------------------------
  // The n→π* band of an isolated C=O depends on the CLASS: a heteroatom on the carbonyl (OH, OR, NR₂) raises the
  // π* level and moves the band far to the blue. Every carbonyl used to be handed the ketone's 280 nm, so acetic acid
  // and ethyl acetate were "280 nm" — 75 nm off. Tabulated n→π* (Silverstein, Spectrometric Identification of
  // Organic Compounds, simple-chromophore table; Pavia, Introduction to Spectroscopy): acetone 279, acetaldehyde 290,
  // acetic acid 204, ethyl acetate 207, acetamide 214 nm. Classes with no value tabulated here (anhydride, acid halide,
  // carbonate, urea, carbamate, thioester, isocyanate) are named, never given a guessed band.
  const ISOLATED_NPI: Partial<Record<CarbonylKind, { nm: number; name: string }>> = {
    aldehyde: { nm: 290, name: "aldehyde" },
    ketone: { nm: 280, name: "ketone" },
    amide: { nm: 214, name: "amide" },
    ester: { nm: 207, name: "ester" },
    acid: { nm: 204, name: "carboxylic acid" },
  };
  const tabulated = new Map<string, number>();
  const untabulated = new Set<string>();
  let isolatedCarboxylate = false;
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    const k = carbonylKind(mol, a);
    if (!k) continue;
    if (k === "carboxylate") {
      isolatedCarboxylate = true;
      continue;
    }
    const t = ISOLATED_NPI[k];
    if (t) tabulated.set(t.name, t.nm);
    else untabulated.add(k);
  }
  if (tabulated.size) {
    // The longest-wavelength tabulated band is λmax (a ketone's 280 over an ester's 207 in a keto ester).
    const [bestName, bestNm] = [...tabulated.entries()].sort((p, q) => q[1] - p[1])[0];
    // An untabulated class might absorb longer than an ester/acid/amide band: then λmax is not known.
    if (untabulated.size && bestNm < 280) {
      return refuse(
        `isolated carbonyl (${[...untabulated].join(", ")}: no tabulated band)`,
        `The structure has an isolated ${[...untabulated].join(", ")} carbonyl, whose n→π* band is not tabulated here, ` +
          `so the longest-wavelength band cannot be named (the ${bestName} band alone is ≈ ${bestNm} nm).`
      );
    }
    caveats.add(
      `An isolated (unconjugated) ${bestName} C=O has only a weak n→π* band (ε ≈ 10–100), tabulated near ${bestNm} nm; its strong π→π* band is below 200 nm.`
    );
    if (tabulated.size > 1) {
      caveats.add(`Other isolated carbonyls: ${[...tabulated.entries()].filter(([n]) => n !== bestName).map(([n, nm]) => `${n} ≈ ${nm} nm`).join(", ")}.`);
    }
    if (untabulated.size) caveats.add(`No band is tabulated here for the isolated ${[...untabulated].join(", ")} carbonyl.`);
    return {
      smiles,
      lambdaMax: bestNm,
      chromophore: `isolated carbonyl, ${bestName} (weak n→π*)`,
      contributions: [{ label: `n→π* of isolated ${bestName} C=O (tabulated, weak)`, nm: bestNm }],
      transparent: false,
      outOfDomain: false,
      caveats: [...caveats],
    };
  }
  if (untabulated.size) {
    return refuse(
      `isolated carbonyl (${[...untabulated].join(", ")}: no tabulated band)`,
      `The only carbonyl here is an isolated ${[...untabulated].join(", ")}, whose n→π* band is not tabulated here ` +
        `(it is not the ketone's 280 nm).`
    );
  }

  // --- Isolated carboxylate: not the 280 nm n→π* of a C=O ------------------
  // A COO⁻ has no C=O; its two equivalent C-O bonds are a different chromophore
  // whose n→π* this module does not tabulate. Until carboxylates were their own
  // class they were "ester" and were handed the 280 nm line above.
  if (isolatedCarboxylate) {
    return refuse(
      "isolated carboxylate, COO⁻ (no tabulated band)",
      "The only carbonyl-type group here is a carboxylate anion (COO⁻). It is not an isolated C=O, so the " +
        "tabulated 280 nm n→π* of ketones/aldehydes does not apply, and no value for the anion is " +
        "tabulated here."
    );
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
    outOfDomain: false,
    caveats: [...caveats],
  };
}
