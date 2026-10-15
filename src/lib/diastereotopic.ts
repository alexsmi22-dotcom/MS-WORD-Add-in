// Diastereotopic groups and geminal ²J — the TOPOLOGY, not the spectrum.
//
// WHAT WAS WRONG. nmr.ts groups nuclei by OpenChemLib's simple symmetry rank
// (molgraph.symmetryClasses → cHelperSymmetrySimple), which ignores stereo-
// chemistry. Two groups that no symmetry operation of the molecule exchanges
// were therefore merged whenever their constitution matched:
//
//   * valine's two isopropyl methyls came out as ONE 6H doublet (they are two 3H
//     doublets — the textbook diastereotopic pair, 17.5 and 19.1 ppm in ¹³C);
//   * the OCH₂ of acetaldehyde diethyl acetal came out as a clean quartet (its two
//     protons are diastereotopic — the textbook ABX₃ case);
//   * 2-butanol's C3 H₂ came out as a quintet, glycerol's CH₂ as a doublet.
//
// THE CLASSIFIER IS OPENCHEMLIB'S, not one written here. OCL 8.21 ships
// Molecule.getDiastereotopicAtomIDs(), which gives every atom of an H-EXPLICIT
// molecule an ID that is equal for homotopic and enantiotopic atoms and different
// for diastereotopic ones. Probed against the Eliel–Wilen substitution test on
// every case in docs/SCOPE-SPECTROSCOPY-BATCH.md §D4 — meso vs (2R,4R)-2,4-
// dichloropentane included — it agrees on all of them.
//
// THREE THINGS THIS MODULE ADDS AROUND THAT CALL:
//
// 1. It runs on a COPY. addImplicitHydrogens on the molecule nmr.ts is holding
//    would append atoms and shift nothing — but the helper arrays every later
//    lookup reads would be rebuilt over a different atom list. The copy's heavy-
//    atom indices are checked against the original atom for atom (atomic number
//    and neighbour set); any mismatch abandons the analysis rather than mapping
//    IDs onto the wrong atoms.
//
// 2. UNSPECIFIED RELATIVE CONFIGURATION. OCL answers for whatever configuration
//    it perceives, and an unspecified stereocentre is perceived as no centre at
//    all: CC(Cl)CC(C)Cl comes back "homotopic" — right for (2R,4R), wrong for the
//    meso form. When the molecule has two or more stereocentres and at least one
//    is unspecified, every relative configuration of the unspecified ones is
//    enumerated (one centre is held fixed when none is specified: a mirror image
//    never changes topicity). A group whose classification differs between the
//    configurations is reported as DEPENDING on relative configuration, by name,
//    and is not split. Nothing is picked.
//
// 3. BOUNDED WORK. getDiastereotopicAtomIDs canonicalises the H-explicit
//    molecule once per atom, so its cost grows much faster than the atom count.
//    Measured on an alkyl chain (the CH₂-rich worst case): in node ≈0.35 s at 20
//    heavy atoms, ≈1.1 s at 40, ≈2.9 s at 60, ≈10 s for tannic acid (122);
//    inside jest on an unloaded machine ≈0.5 s at 20, ≈1.5 s at 28, ≈3 s at 32
//    — and up to ten times that when the machine is busy. In a task pane that is
//    a frozen Word. The analysis therefore runs only under a cost cap
//    (configurations × heavy atoms² ≤ CAP_HEAVY²), says so when it does not, and
//    is cached per molecule because one pane action calls predictNmr up to
//    three times on the same input.
//
// HONEST LIMITS (stated in the UI by nmr.ts / nmr2d.ts):
//   * topology only — no Δδ between diastereotopic partners, no second-order
//     (AB/ABX) line positions, no ²J/³J from geometry (Karplus);
//   * no diastereotopicity for exchange-averaged groups (OH, NH);
//   * unspecified double-bond (E/Z) configuration is not enumerated;
//   * geminal |²J| is a TYPICAL range by class, not predicted from geometry.
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";

/** How a CH₂'s two protons relate. */
export type GeminalTopicity = "diastereotopic" | "equivalent" | "depends";

/**
 * Typical geminal |²J(H,H)| range for a CH₂ class.
 *
 * TYPICAL, NOT PREDICTED FROM GEOMETRY. ²J depends on the H–C–H angle and on
 * the orientation of neighbouring π systems and lone pairs, none of which a flat
 * structure supplies.
 *
 * PROVENANCE, stated exactly. The four classes sp³ CH₂ 12–15, CH₂ next to C=O
 * or a π system 14–18, three-membered ring 4–9 and terminal =CH₂ 0–3 Hz are
 * taken from docs/SCOPE-SPECTROSCOPY-BATCH.md §B4, which names the Pretsch,
 * Bühlmann & Badertscher geminal-coupling table as their source. They were NOT
 * re-transcribed from that table for this module. The fifth class, CH₂ bearing
 * O, N or halogen 9–12 Hz, is an addition from commonly quoted values (an
 * electronegative α-substituent lowers |²J|; it is the acetal OCH₂ and glycerol
 * case) and is likewise unverified against the table. The SIGN (usually
 * negative for sp³) is not observable in a first-order spectrum, so the
 * magnitude is given.
 */
export interface GeminalJ {
  /** Smallest typical |²J|, Hz. */
  min: number;
  /** Largest typical |²J|, Hz. */
  max: number;
  /** The class the range is for, as shown to the user. */
  cls: string;
}

/** Per-carbon diastereotopicity report used by nmr.ts. */
export interface DiastereotopicAnalysis {
  /** False when the analysis did not run (cap, failure); `limit` then says why. */
  ran: boolean;
  /** Why it did not run, or what was not enumerated — a sentence for the caveats. */
  limit?: string;
  /**
   * One ID per heavy atom (index-aligned with the input molecule) under each
   * configuration examined. Atoms with equal IDs in EVERY configuration are
   * equivalent; atoms whose equality differs between configurations depend on
   * relative configuration.
   */
  idsPerConfig: string[][];
  /** For each carbon carrying exactly two H: how those two H relate. */
  ch2: Map<number, GeminalTopicity>;
}

/**
 * The cost cap: configurations × (heavy atoms)² must not exceed CAP_HEAVY².
 *
 * Calibrated from the timings in the header: one configuration at 30 heavy atoms
 * is ≈0.7 s in node and ≈2 s in jest, the most this module will spend on one
 * input. Two configurations bring the size limit to 21 heavy atoms, four to 15,
 * eight to 10 — each costing about the same. Covers the amino acids, terpenes,
 * ibuprofen-sized drugs and steroids up to ~30 heavy atoms (testosterone 21,
 * cholesterol 28); larger structures get the stated limit.
 */
export const CAP_HEAVY = 30;
const COST_CAP = CAP_HEAVY * CAP_HEAVY;

/** Unspecified stereocentres enumerated at most (2³ = 8 configurations). */
const MAX_FREE_CENTRES = 3;

// A small LRU cache. The key is the exact graph (atom order included), because
// a cached result is index-aligned: the same molecule written in another atom
// order is a different key, never a wrong hit.
const CACHE = new Map<string, DiastereotopicAnalysis>();
const CACHE_SIZE = 24;

function graphKey(mol: Molecule): string {
  mol.ensureHelperArrays(Molecule.cHelperParities);
  const parts: string[] = [];
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    parts.push(
      `${mol.getAtomicNo(a)}.${mol.getAtomCharge(a)}.${mol.getAtomMass(a)}.${mol.getAtomParity(a)}.${mol.getAllHydrogens(a)}`
    );
  }
  for (let b = 0; b < mol.getAllBonds(); b++) {
    parts.push(`${mol.getBondAtom(0, b)}-${mol.getBondAtom(1, b)}:${mol.getBondOrder(b)}:${mol.getBondParity(b)}`);
  }
  return parts.join("|");
}

/** Sorted heavy-neighbour list, used to prove the H-explicit copy kept indices. */
function heavyNeighbourSig(mol: Molecule, a: number, heavy: number): string {
  const out: number[] = [];
  for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
    const nb = mol.getConnAtom(a, i);
    if (nb < heavy && mol.getAtomicNo(nb) !== 1) out.push(nb);
  }
  return out.sort((x, y) => x - y).join(",");
}

/**
 * Diastereotopic IDs for one configuration, plus the H IDs on each carbon that
 * carries two H. Returns null if the H-explicit copy did not keep heavy indices.
 */
function idsFor(
  src: Molecule,
  ref: Molecule,
  heavy: number
): { ids: string[]; ch2Same: Map<number, boolean> } | null {
  const h = src.getCompactCopy();
  h.addImplicitHydrogens();
  const all = h.getDiastereotopicAtomIDs();
  h.ensureHelperArrays(Molecule.cHelperNeighbours);
  ref.ensureHelperArrays(Molecule.cHelperNeighbours);
  const ids: string[] = [];
  const ch2Same = new Map<number, boolean>();
  for (let a = 0; a < heavy; a++) {
    // Pin: the copy's atom a IS the original's atom a (`ref` is the molecule
    // nmr.ts holds; `src` may be a stereo-edited copy of it).
    if (h.getAtomicNo(a) !== ref.getAtomicNo(a)) return null;
    if (heavyNeighbourSig(h, a, heavy) !== heavyNeighbourSig(ref, a, heavy)) return null;
    ids.push(all[a]);
    if (src.getAtomicNo(a) !== 6) continue;
    // Natural-abundance protons only. A CHD carbon is not a CH₂: its H and D
    // trivially get different IDs, and calling that "diastereotopic" would be a
    // claim about two protons when there is one.
    const hs: string[] = [];
    let isotopic = false;
    for (let i = 0; i < h.getAllConnAtoms(a); i++) {
      const nb = h.getConnAtom(a, i);
      if (h.getAtomicNo(nb) !== 1) continue;
      if (h.getAtomMass(nb) > 1) isotopic = true;
      else hs.push(all[nb]);
    }
    if (hs.length === 2 && !isotopic) ch2Same.set(a, hs[0] === hs[1]);
  }
  return { ids, ch2Same };
}

/**
 * Runs the classification. Never throws: any OCL failure comes back as
 * `ran: false` with a limit sentence, and nmr.ts then keeps its old grouping.
 */
export function analyseDiastereotopicity(mol: Molecule): DiastereotopicAnalysis {
  let key: string;
  try {
    key = graphKey(mol);
  } catch {
    return { ran: false, limit: "Diastereotopic groups could not be analysed for this structure.", idsPerConfig: [], ch2: new Map() };
  }
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const result = analyseUncached(mol);
  CACHE.set(key, result);
  if (CACHE.size > CACHE_SIZE) CACHE.delete(CACHE.keys().next().value as string);
  return result;
}

/**
 * True only when no group in the molecule can be diastereotopic, decided from
 * the graph without OCL's per-atom canonicalisation. Deliberately narrow — any
 * one of these sends the molecule to the full analysis:
 *   * a ring (ring CH₂ in methylcyclohexane are diastereotopic, no stereocentre);
 *   * any multiple bond (propene's =CH₂; prochiral sp² faces);
 *   * any stereocentre, specified or not (a CH₂ next to one);
 *   * a HEAVY-ATOM prochiral sp³ centre — two constitutionally equivalent heavy
 *     ligands plus two different others (citric acid's C3, an isopropyl CH
 *     beside a chain) — which makes CH₂ protons elsewhere diastereotopic with
 *     no stereocentre at all (citric acid's CH₂ is the textbook AB system).
 * A saturated acyclic chain such as triacontane passes, and pays nothing.
 */
function cannotBeDiastereotopic(mol: Molecule): boolean {
  mol.ensureHelperArrays(Molecule.cHelperParities);
  const n = mol.getAllAtoms();
  for (let a = 0; a < n; a++) {
    if (mol.isRingAtom(a)) return false;
    if (mol.isAtomStereoCenter(a)) return false;
  }
  for (let b = 0; b < mol.getAllBonds(); b++) if (mol.getBondOrder(b) !== 1) return false;
  mol.ensureHelperArrays(Molecule.cHelperSymmetrySimple);
  for (let a = 0; a < n; a++) {
    const heavyRanks: number[] = [];
    for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
      const nb = mol.getConnAtom(a, i);
      if (mol.getAtomicNo(nb) !== 1) heavyRanks.push(mol.getSymmetryRank(nb));
    }
    // Fewer than three heavy ligands: any equivalent pair is H,H (or the atom
    // is a terminus), which is not a heavy-atom prochiral centre.
    if (heavyRanks.length < 3) continue;
    const count = new Map<number, number>();
    for (const r of heavyRanks) count.set(r, (count.get(r) ?? 0) + 1);
    if ([...count.values()].some((c) => c === 2)) return false;
  }
  return true;
}

function analyseUncached(mol: Molecule): DiastereotopicAnalysis {
  const heavy = mol.getAllAtoms();
  const notRun = (limit: string): DiastereotopicAnalysis => ({ ran: false, limit, idsPerConfig: [], ch2: new Map() });

  // FAST PATH, no OCL call: a molecule that is acyclic, saturated, free of
  // stereocentres and free of heavy-atom prochiral centres has no
  // diastereotopic group to find, however long it is (triacontane). See
  // cannotBeDiastereotopic for why each condition is needed.
  try {
    if (cannotBeDiastereotopic(mol)) return { ran: true, idsPerConfig: [], ch2: new Map() };
  } catch {
    /* fall through to the full analysis */
  }

  if (heavy * heavy > COST_CAP) {
    return notRun(
      `Diastereotopic groups were NOT analysed: the structure has ${heavy} heavy atoms and the analysis is ` +
        `capped at ${CAP_HEAVY} (its cost grows faster than the atom count). Groups that are diastereotopic ` +
        "are therefore merged here as if equivalent, and CH₂ multiplets follow the n+1 rule."
    );
  }

  try {
    mol.ensureHelperArrays(Molecule.cHelperParities);
    const unknown: number[] = [];
    let specified = 0;
    for (let a = 0; a < mol.getAtoms(); a++) {
      if (!mol.isAtomStereoCenter(a)) continue;
      if (mol.getAtomParity(a) === Molecule.cAtomParityUnknown) unknown.push(a);
      else specified++;
    }

    // Configurations to examine. With fewer than two stereocentres there is no
    // RELATIVE configuration: the one unspecified centre's two forms are mirror
    // images, and a mirror image never changes topicity.
    let configs: number[][] = [[]];
    if (unknown.length && unknown.length + specified >= 2) {
      // With none specified, hold the first unknown fixed — the remaining
      // assignments then cover every relative configuration exactly once.
      const free = specified === 0 ? unknown.slice(1) : unknown;
      const fixed = specified === 0 ? [unknown[0]] : [];
      const n = 1 << free.length;
      if (free.length > MAX_FREE_CENTRES || n * heavy * heavy > COST_CAP) {
        // Not even the single unenumerated call is made: OCL perceives an
        // unspecified centre as no centre, so its answer here is unreliable
        // (it calls the meso CH₂ homotopic) — and it is the expensive part.
        return notRun(
          `${unknown.length} stereocentres are unspecified, and their relative configurations were NOT ` +
            "enumerated (over the work cap), so diastereotopic groups were not analysed and are merged here as " +
            "if equivalent. Whether a CH₂ or a pair of groups is diastereotopic can depend on that configuration " +
            "(meso vs (R,R)); specify the stereocentres for a definite answer."
        );
      } else {
        configs = [];
        for (let mask = 0; mask < n; mask++) {
          const parities: number[] = [];
          for (const _ of fixed) parities.push(Molecule.cAtomParity1);
          for (let i = 0; i < free.length; i++) {
            parities.push((mask >> i) & 1 ? Molecule.cAtomParity2 : Molecule.cAtomParity1);
          }
          configs.push(parities);
        }
        const centres = [...fixed, ...free];
        const idsPerConfig: string[][] = [];
        const ch2Votes = new Map<number, Set<boolean>>();
        for (const parities of configs) {
          const c = mol.getCompactCopy();
          c.ensureHelperArrays(Molecule.cHelperParities);
          centres.forEach((a, i) => c.setAtomParity(a, parities[i], false));
          c.setParitiesValid(0);
          c.setStereoBondsFromParity();
          const r = idsFor(c, mol, heavy);
          if (!r) return notRun("Diastereotopic groups could not be analysed for this structure (atom mapping failed).");
          idsPerConfig.push(r.ids);
          for (const [a, same] of r.ch2Same) {
            if (!ch2Votes.has(a)) ch2Votes.set(a, new Set());
            ch2Votes.get(a)!.add(same);
          }
        }
        const ch2 = new Map<number, GeminalTopicity>();
        for (const [a, votes] of ch2Votes) {
          ch2.set(a, votes.size > 1 ? "depends" : votes.has(true) ? "equivalent" : "diastereotopic");
        }
        return { ran: true, idsPerConfig, ch2 };
      }
    }

    const r = idsFor(mol, mol, heavy);
    if (!r) return notRun("Diastereotopic groups could not be analysed for this structure (atom mapping failed).");
    const ch2 = new Map<number, GeminalTopicity>();
    for (const [a, same] of r.ch2Same) ch2.set(a, same ? "equivalent" : "diastereotopic");
    return { ran: true, idsPerConfig: [r.ids], ch2 };
  } catch {
    return notRun("Diastereotopic groups could not be analysed for this structure.");
  }
}

/** A symmetry class after refinement. */
export interface RefinedGroup {
  atoms: number[];
  /**
   * "split" — this group was cut out of a larger symmetry class because its
   * members are diastereotopic to the rest; "depends" — the class was kept whole
   * but whether it should split depends on unspecified relative configuration.
   */
  status?: "split" | "depends" | "mirror";
}

/**
 * Refines symmetry classes by topicity, in two steps.
 *
 * 1. SPLIT a class whose members are diastereotopic to each other (valine's
 *    methyls). Only `canSplit` classes are split — OH/NH never are.
 * 2. MERGE classes that OCL's IDs say are equivalent in EVERY configuration
 *    examined. This repairs a WRONG answer in molgraph.symmetryClasses (read-
 *    only here): its stereo-aware rank tells the two mirror-image halves of a
 *    meso compound apart, so meso-2,4-dichloropentane gave 5 ¹³C rows for 3
 *    environments. Mirror-related (enantiotopic) nuclei are ISOCHRONOUS in an
 *    achiral solvent, so they are one signal. A merged group is marked "mirror".
 *    Genuinely diastereotopic groups have different IDs and are never merged.
 *
 * A molecule with neither situation comes back with exactly the classes it went
 * in with, in the same order (a merged group sits where its first part was).
 */
export function refineClasses(
  groups: number[][],
  an: DiastereotopicAnalysis,
  canSplit: (atom: number) => boolean = () => true
): RefinedGroup[] {
  if (!an.ran || !an.idsPerConfig.length) return groups.map((atoms) => ({ atoms }));
  const split = splitClasses(groups, an, canSplit);
  // Step 2: merge by the per-configuration ID tuple of each group's atoms.
  const keyOf = (g: RefinedGroup): string | null => {
    if (g.status === "depends") return null;
    const keys = new Set(g.atoms.map((a) => an.idsPerConfig.map((ids) => ids[a]).join("\u0001")));
    return keys.size === 1 ? [...keys][0] : null;
  };
  const out: RefinedGroup[] = [];
  const byKey = new Map<string, RefinedGroup>();
  for (const g of split) {
    const k = keyOf(g);
    const into = k === null ? undefined : byKey.get(k);
    if (into) {
      into.atoms = [...into.atoms, ...g.atoms];
      into.status = "mirror";
      continue;
    }
    const copy: RefinedGroup = { atoms: g.atoms.slice(), status: g.status };
    if (copy.status === undefined) delete copy.status;
    if (k !== null) byKey.set(k, copy);
    out.push(copy);
  }
  return out;
}

function splitClasses(groups: number[][], an: DiastereotopicAnalysis, canSplit: (atom: number) => boolean): RefinedGroup[] {
  const out: RefinedGroup[] = [];
  for (const g of groups) {
    if (g.length < 2 || !canSplit(g[0])) {
      out.push({ atoms: g });
      continue;
    }
    // The equivalence relation inside the group, per configuration.
    const partitionKey = (ids: string[]): string => {
      const firstOf = new Map<string, number>();
      return g.map((a) => {
        if (!firstOf.has(ids[a])) firstOf.set(ids[a], firstOf.size);
        return firstOf.get(ids[a]);
      }).join(",");
    };
    const keys = new Set(an.idsPerConfig.map(partitionKey));
    if (keys.size > 1) {
      out.push({ atoms: g, status: "depends" });
      continue;
    }
    const ids = an.idsPerConfig[0];
    const parts = new Map<string, number[]>();
    for (const a of g) {
      const cur = parts.get(ids[a]);
      if (cur) cur.push(a);
      else parts.set(ids[a], [a]);
    }
    if (parts.size === 1) {
      out.push({ atoms: g });
      continue;
    }
    for (const p of parts.values()) out.push({ atoms: p, status: "split" });
  }
  return out;
}

function ringSizesOf(mol: Molecule, a: number): number[] {
  const rs = mol.getRingSet();
  const sizes: number[] = [];
  for (let r = 0; r < rs.getSize(); r++) if (rs.getRingAtoms(r).includes(a)) sizes.push(rs.getRingSize(r));
  return sizes;
}

/**
 * Typical geminal |²J| for the two H of carbon `a`, by class.
 *
 * Order matters and runs from most to least specific: a three-membered ring
 * overrides everything (cyclopropane and epoxide CH₂ sit far below the sp³
 * norm), then an sp² =CH₂, then a CH₂ next to a π system (which increases the
 * magnitude), then one bearing an electronegative atom (which decreases it).
 */
export function geminalJ(mol: Molecule, a: number): GeminalJ {
  if (ringSizesOf(mol, a).includes(3)) return { min: 4, max: 9, cls: "three-membered ring CH₂" };
  let sp2 = false;
  let piNeighbour = false;
  let hetero = false;
  for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
    const nb = mol.getConnAtom(a, i);
    const order = mol.getBondOrder(mol.getConnBond(a, i));
    if (order >= 2) sp2 = true;
    const z = mol.getAtomicNo(nb);
    if (z === 1) continue;
    if (z === 7 || z === 8 || z === 9 || z === 17 || z === 35 || z === 53) hetero = true;
    if (mol.isAromaticAtom(nb)) piNeighbour = true;
    for (let j = 0; j < mol.getAllConnAtoms(nb); j++) {
      if (mol.getConnAtom(nb, j) === a) continue;
      if (mol.getBondOrder(mol.getConnBond(nb, j)) >= 2) piNeighbour = true;
    }
  }
  if (sp2) return { min: 0, max: 3, cls: "terminal =CH₂" };
  if (piNeighbour) return { min: 14, max: 18, cls: "CH₂ next to C=O or a π system" };
  if (hetero) return { min: 9, max: 12, cls: "CH₂ bearing O, N or halogen" };
  return { min: 12, max: 15, cls: "sp³ CH₂" };
}

/** The per-signal note for a diastereotopic CH₂ (one row, count 2, multiplet m). */
export function ch2Note(j: GeminalJ): string {
  return (
    `diastereotopic CH₂ (the AB part of an ABX-type system): the two protons are not equivalent, so they ` +
    `couple to each other — geminal ²J typically ${j.min}–${j.max} Hz for a ${j.cls} (typical, not predicted ` +
    "from geometry) — and their Δδ is not predicted."
  );
}

/** The per-signal note for one member of a diastereotopic pair of groups. */
export const PAIR_NOTE =
  "diastereotopic: no symmetry operation makes this group equivalent to its partner at the same δ, so the two " +
  "can differ; the difference is not predicted, and is often too small to resolve when the stereocentre is distant.";

/** The per-signal note when topicity depends on unspecified relative configuration. */
export const DEPENDS_NOTE =
  "depends on relative configuration: diastereotopic in some configurations of the unspecified stereocentres " +
  "and equivalent in others (meso vs (R,R)). Not split — specify the stereocentres for a definite answer.";
