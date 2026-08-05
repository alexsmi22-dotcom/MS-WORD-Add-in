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
//     separate enone systems, aryl enones (Scott's rules) — as before.
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
  isFusedAromatic,
  parseToMolecule,
  SubstKey,
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
  if (enones.length) {
    const e = enones[0];
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
    if (enones.length > 1) {
      // Genuinely separate enones, not cross-conjugation: the rules DO apply to
      // each, and what is observed is the longest-wavelength one. Say that,
      // rather than the old text, which called every such molecule
      // cross-conjugated whether or not it was.
      caveats.add(
        `${enones.length} separate enone systems found; λmax is computed for one of them. The observed λmax ` +
          "is that of the longest-wavelength chromophore, which need not be the one below."
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
    // The size limit is enforced above, over the whole molecule.
    if (extra > 0) {
      contributions.push({ label: `Extended conjugation ×${extra}`, nm: 30 * extra });
      lambda += 30 * extra;
      caveats.add(EXTENDED_ACCURACY);
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
      outOfDomain: false,
      caveats: [...caveats],
    };
  }

  // --- Conjugated diene (Woodward-Fieser diene rules) ---------------------
  // A diene needs two C=C joined by a single bond.
  for (const alk of alkenes) {
    const visited = new Set<string>();
    const extra = countExtendedConjugation(mol, alk, visited);
    if (extra < 1) continue; // isolated alkene, not a diene

    const conjAtoms = new Set<number>();
    for (const k of visited) for (const p of k.split("-")) conjAtoms.add(Number(p));

    // Size and branching are enforced above, over the whole molecule.
    // Homoannular (both C=C in the same ring, cisoid) base 253; else 214.
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
      caveats.add(EXTENDED_ACCURACY);
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
      outOfDomain: false,
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
      outOfDomain: false,
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
      outOfDomain: false,
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
    outOfDomain: false,
    caveats: [...caveats],
  };
}
