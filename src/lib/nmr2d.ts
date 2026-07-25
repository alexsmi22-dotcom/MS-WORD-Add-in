// NMR depth: scalar coupling constants (J) and 2D correlation maps (COSY, HSQC).
//
// This sits on top of nmr.ts. The 1D predictor (predictNmr) already finds the
// symmetry-distinct proton and carbon environments and their shifts; this module
// adds the through-bond RELATIONSHIPS between them:
//
//   * J-coupling  — for each 1H environment, which other environments split it,
//                   with a typical coupling constant and a refined multiplet name
//                   ("dd", "td", ...) instead of the plain n+1 letter.
//   * COSY        — a 1H-1H map: a cross-peak wherever two proton environments
//                   share an observable coupling.
//   * HSQC        — a 1H-13C map: one cross-peak per protonated carbon, pairing
//                   its proton shift with its own carbon shift (a one-bond
//                   correlation, exact from the graph).
//
// HONESTY (same standard as nmr.ts / pka.ts). The COUPLING TOPOLOGY is exact —
// it is read from the bond graph, so two protons couple in the prediction iff a
// real coupling path exists. The coupling VALUES are typical literature figures
// by relationship class, NOT computed from geometry:
//
//   * Aromatic ortho/meta/para J are well defined and reliable (±1 Hz).
//   * Aliphatic vicinal 3J is reported as the ~7 Hz freely-rotating average; the
//     true value follows the Karplus relation (0-12 Hz by dihedral) which a flat
//     structure cannot supply. Flagged approximate.
//   * Alkene 3J depends on cis (~6-12) vs trans (~12-18) geometry. Without a
//     defined double-bond configuration we report a nominal value and say so,
//     rather than guess a configuration the input did not specify.
//   * Geminal coupling in a CH2 is only observed when the two protons are
//     diastereotopic; that is not detected here and is called out in caveats.
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";
import {
  neighbors,
  aromaticRingDistances,
  parseToMolecule,
  isPlainAlkylCarbon,
} from "./molgraph";
import { predictNmr, NmrResult, NmrSignal } from "./nmr";

// ---------------------------------------------------------------------------
// Typical coupling constants (Hz), by relationship. Standard textbook figures
// (Pretsch/Bühlmann/Badertscher; Silverstein). Where a single value cannot be
// honest (dihedral- or geometry-dependent) it is marked approximate downstream.
// ---------------------------------------------------------------------------
const J_AROMATIC = [0, 7.8, 1.5, 0.6]; // index = ring distance: 1 ortho, 2 meta, 3 para
const J_VICINAL_SP3 = 7.0; // freely-rotating average; really Karplus(dihedral)
const J_ALKENE_NOMINAL = 12.0; // cis ~10, trans ~16 — reported nominal, see caveats
const J_ALLYLIC_VICINAL = 6.5; // H-C=C-C-H style 3J onto an sp3 neighbour

export interface Coupling {
  /** Index of the coupled environment in the signals array. */
  partner: number;
  /** Chemical shift of the coupled environment (ppm). */
  partnerShift: number;
  /** Number of partner protons that split THIS environment (drives multiplicity). */
  nH: number;
  /** Typical coupling constant, Hz. */
  J: number;
  /** Relationship: "ortho" | "meta" | "para" | "vicinal" | "alkene" | "allylic". */
  kind: string;
  /** True when J is a nominal figure (dihedral/geometry not knowable from the graph). */
  approximate?: boolean;
}

export interface CoupledSignal {
  shift: number;
  count: number;
  assignment: string;
  atoms: number[];
  /** Refined multiplet from the resolved couplings, e.g. "t", "dd", "td". */
  multiplet: string;
  /** J values matching the multiplet letters, downfield/large-J first (Hz). */
  J: number[];
  couplings: Coupling[];
  variable?: boolean;
}

export interface CouplingResult {
  smiles: string;
  signals: CoupledSignal[];
  caveats: string[];
}

export interface Peak2D {
  /** Direct (F2) axis — always the 1H shift (ppm). */
  f2: number;
  /** Indirect (F1) axis — 1H for COSY, 13C for HSQC (ppm). */
  f1: number;
  label: string;
  kind: "diagonal" | "cross";
  /** A weak (long-range / small-J) correlation, drawn faintly. */
  weak?: boolean;
}

export interface Cosy2D {
  smiles: string;
  peaks: Peak2D[];
  caveats: string[];
}

export interface Hsqc2D {
  smiles: string;
  peaks: Peak2D[];
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Coupling-partner detection. Mirrors nmr.ts's multiplicity(): a coupling is
// only observable between INEQUIVALENT nuclei (different symmetry rank), because
// magnetically equivalent protons do not split one another.
// ---------------------------------------------------------------------------

interface RawPartner {
  atom: number;
  J: number;
  kind: string;
  approximate?: boolean;
}

/** Raw coupling partners of the proton(s) on heavy atom `a`. */
function rawPartners(mol: Molecule, a: number, selfRank: number): RawPartner[] {
  const out: RawPartner[] = [];
  const isC = mol.getAtomicNo(a) === 6;

  // --- Aromatic ring protons: ortho (3J), meta (4J), para (5J) --------------
  if (isC && mol.isAromaticAtom(a)) {
    const dist = aromaticRingDistances(mol, a);
    for (let b = 0; b < mol.getAllAtoms(); b++) {
      if (b === a) continue;
      if (!mol.isAromaticAtom(b) || mol.getAtomicNo(b) !== 6) continue;
      if (mol.getAllHydrogens(b) === 0) continue;
      const d = dist[b];
      if (d < 1 || d > 3) continue;
      if (mol.getSymmetryRank(b) === selfRank) continue;
      out.push({ atom: b, J: J_AROMATIC[d], kind: d === 1 ? "ortho" : d === 2 ? "meta" : "para" });
    }
    return out;
  }

  // --- Alkene proton: 3J across the double bond, and onto sp3 neighbours -----
  const dbl = isC ? neighbors(mol, a).find((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6) : undefined;
  if (dbl) {
    if (mol.getAllHydrogens(dbl.atom) > 0 && mol.getSymmetryRank(dbl.atom) !== selfRank) {
      out.push({ atom: dbl.atom, J: J_ALKENE_NOMINAL, kind: "alkene", approximate: true });
    }
    for (const nb of neighbors(mol, a)) {
      if (nb.atom === dbl.atom) continue;
      if (!isPlainAlkylCarbon(mol, nb.atom) || mol.getAllHydrogens(nb.atom) === 0) continue;
      if (mol.getSymmetryRank(nb.atom) === selfRank) continue;
      out.push({ atom: nb.atom, J: J_ALLYLIC_VICINAL, kind: "allylic", approximate: true });
    }
    return out;
  }

  // --- sp3 proton: vicinal 3J onto neighbouring protonated carbons ----------
  // Only through plain sp3/sp2-carbon neighbours; a proton three bonds away
  // across a carbonyl or heteroatom does not give a first-order vicinal coupling
  // the way H-C-C-H does. Aromatic ipso neighbours carry no H, so benzylic
  // methyls correctly show no vicinal partner and stay singlets.
  if (isC && !mol.isAromaticAtom(a)) {
    for (const nb of neighbors(mol, a)) {
      if (mol.getAtomicNo(nb.atom) !== 6) continue;
      if (mol.isAromaticAtom(nb.atom)) continue;
      if (mol.getAllHydrogens(nb.atom) === 0) continue;
      if (mol.getSymmetryRank(nb.atom) === selfRank) continue;
      // An sp2 (alkene) neighbour is the mirror image of the allylic case above.
      const neighbourIsAlkene = neighbors(mol, nb.atom).some(
        (x) => x.order === 2 && mol.getAtomicNo(x.atom) === 6
      );
      out.push({
        atom: nb.atom,
        J: neighbourIsAlkene ? J_ALLYLIC_VICINAL : J_VICINAL_SP3,
        kind: neighbourIsAlkene ? "allylic" : "vicinal",
        approximate: true,
      });
    }
  }
  return out;
}

/** Builds a multiplet name and its J list from a signal's resolved couplings. */
function multipletName(couplings: Coupling[]): { multiplet: string; J: number[] } {
  // Couplings with negligible J (para, <1 Hz) are real but not resolved in a
  // routine 1D spectrum — they do not contribute a splitting letter.
  const active = couplings.filter((c) => c.nH > 0 && c.J >= 1);
  if (!active.length) return { multiplet: "s", J: [] };

  // Merge equal-J couplings: n partners at the same J give a single (n+1)
  // multiplet (the classic n+1 rule), not two separate splittings.
  const byJ = new Map<number, number>();
  for (const c of active) {
    const key = Math.round(c.J * 10) / 10;
    byJ.set(key, (byJ.get(key) ?? 0) + c.nH);
  }
  const entries = [...byJ.entries()].sort((x, y) => y[0] - x[0]); // large J first
  const LETTER = ["", "d", "t", "q", "quint", "sext", "sept"];
  const multiplet = entries.map(([, n]) => (n < LETTER.length ? LETTER[n] : "m")).join("");
  return { multiplet, J: entries.map(([j]) => j) };
}

// ---------------------------------------------------------------------------
// Public: J-coupling
// ---------------------------------------------------------------------------

/**
 * Predicts the 1H spectrum WITH scalar couplings resolved: a refined multiplet
 * name and typical J values per environment. Returns null if the input cannot
 * be resolved to a structure.
 */
export function predictCoupling(input: string): CouplingResult | null {
  const base = predictNmr(input, "1H");
  if (!base) return null;
  const parsed = parseToMolecule(input);
  if (!parsed) return null;
  const { mol } = parsed;
  mol.ensureHelperArrays(Molecule.cHelperSymmetrySimple);

  // Map every proton-bearing heavy atom to the index of its 1H environment.
  const atomToSignal = new Map<number, number>();
  base.signals.forEach((s, i) => s.atoms.forEach((at) => atomToSignal.set(at, i)));

  const caveats = new Set<string>(base.caveats);
  let sawApprox = false;
  let sawAlkene = false;
  let sawCH2 = false;

  const signals: CoupledSignal[] = base.signals.map((s) => {
    // Exchangeable protons (OH/NH) are reported as broad singlets: their coupling
    // is usually averaged away by exchange. Keep them singlets, as nmr.ts does.
    if (s.variable || mol.getAtomicNo(s.atoms[0]) !== 6) {
      return { ...toCoupled(s), multiplet: "s (br)", J: [], couplings: [] };
    }
    const rep = s.atoms[0];
    const selfRank = mol.getSymmetryRank(rep);
    if (mol.getAllHydrogens(rep) === 2) sawCH2 = true;

    // Aggregate raw partners into per-environment couplings.
    const perSignal = new Map<number, { nH: number; J: number; kind: string; approximate?: boolean }>();
    for (const p of rawPartners(mol, rep, selfRank)) {
      const idx = atomToSignal.get(p.atom);
      if (idx === undefined) continue;
      const h = mol.getAllHydrogens(p.atom);
      const cur = perSignal.get(idx);
      if (cur) cur.nH += h;
      else perSignal.set(idx, { nH: h, J: p.J, kind: p.kind, approximate: p.approximate });
      if (p.approximate) sawApprox = true;
      if (p.kind === "alkene") sawAlkene = true;
    }

    const couplings: Coupling[] = [...perSignal.entries()]
      .map(([partner, v]) => ({
        partner,
        partnerShift: base.signals[partner].shift,
        nH: v.nH,
        J: v.J,
        kind: v.kind,
        approximate: v.approximate,
      }))
      .sort((x, y) => y.J - x.J);

    const { multiplet, J } = multipletName(couplings);
    return { ...toCoupled(s), multiplet, J, couplings };
  });

  if (sawApprox)
    caveats.add(
      "Coupling constants are typical literature values by relationship, not computed: vicinal 3J follows the Karplus relation (0-12 Hz by dihedral angle) and is reported as the ~7 Hz freely-rotating average."
    );
  if (sawAlkene)
    caveats.add(
      "Alkene 3J depends on double-bond geometry (cis ~6-12 Hz, trans ~12-18 Hz); a nominal value is shown because the configuration is not specified in the structure."
    );
  if (sawCH2)
    caveats.add(
      "Geminal coupling within a CH2 is only observed when its two protons are diastereotopic; that is not modelled here."
    );
  caveats.add("First-order analysis assumed (Δδ ≫ J); strongly coupled spins show second-order patterns.");

  return { smiles: base.smiles, signals, caveats: [...caveats] };
}

function toCoupled(s: NmrSignal): CoupledSignal {
  return {
    shift: s.shift,
    count: s.count,
    assignment: s.assignment,
    atoms: s.atoms,
    multiplet: "s",
    J: [],
    couplings: [],
    variable: s.variable,
  };
}

// ---------------------------------------------------------------------------
// Public: COSY (1H-1H)
// ---------------------------------------------------------------------------

/**
 * Predicts a 1H-1H COSY: a diagonal peak per proton environment and an
 * off-diagonal cross-peak (both mirror images) wherever two environments share
 * an observable coupling. Para (5J) couplings are omitted as unresolved.
 */
export function predictCosy(input: string): Cosy2D | null {
  const c = predictCoupling(input);
  if (!c) return null;
  const peaks: Peak2D[] = [];

  for (const s of c.signals) {
    peaks.push({ f2: s.shift, f1: s.shift, label: `${s.shift.toFixed(2)} (diagonal)`, kind: "diagonal" });
  }

  const seen = new Set<string>();
  c.signals.forEach((s, i) => {
    for (const cp of s.couplings) {
      if (cp.kind === "para" || cp.J < 1) continue; // not resolved as a cross-peak
      const key = i < cp.partner ? `${i}-${cp.partner}` : `${cp.partner}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = s.shift;
      const b = cp.partnerShift;
      const weak = cp.J < 3; // meta / weak long-range
      const label = `${a.toFixed(2)} ↔ ${b.toFixed(2)} (${cp.kind}, J≈${cp.J.toFixed(1)} Hz)`;
      peaks.push({ f2: a, f1: b, label, kind: "cross", weak });
      peaks.push({ f2: b, f1: a, label, kind: "cross", weak });
    }
  });

  const caveats = [...c.caveats];
  caveats.unshift("COSY cross-peaks mark 1H-1H scalar couplings (mainly 3-bond); peak positions are predicted shifts.");
  return { smiles: c.smiles, peaks, caveats };
}

// ---------------------------------------------------------------------------
// Public: HSQC (1H-13C, one-bond)
// ---------------------------------------------------------------------------

/**
 * Predicts a 1H-13C HSQC: one cross-peak per protonated carbon, pairing its
 * predicted proton shift with its predicted carbon shift. The C-H bonds are read
 * from the graph, so the correlation topology is exact; only the shift values
 * carry the additivity-model uncertainty. Non-protonated carbons and
 * exchangeable X-H protons do not appear (there is no one-bond C-H to correlate).
 */
export function predictHsqc(input: string): Hsqc2D | null {
  const h = predictNmr(input, "1H");
  const cSpec = predictNmr(input, "13C");
  if (!h || !cSpec) return null;

  // carbon atom index -> its 13C shift
  const carbonShift = new Map<number, number>();
  for (const cs of cSpec.signals) for (const at of cs.atoms) carbonShift.set(at, cs.shift);

  const peaks: Peak2D[] = [];
  const parsed = parseToMolecule(input);
  const mol = parsed?.mol ?? null;

  for (const s of h.signals) {
    if (s.variable) continue; // exchangeable X-H: no attached carbon
    const carbon = s.atoms[0];
    if (mol && mol.getAtomicNo(carbon) !== 6) continue;
    const dC = carbonShift.get(carbon);
    if (dC === undefined) continue;
    const nH = mol ? mol.getAllHydrogens(carbon) : 1;
    const type = nH === 3 ? "CH3" : nH === 2 ? "CH2" : "CH";
    peaks.push({
      f2: s.shift,
      f1: dC,
      label: `${type}: δH ${s.shift.toFixed(2)} / δC ${dC.toFixed(1)}`,
      kind: "cross",
    });
  }

  const caveats = [
    "HSQC shows one-bond 1H-13C correlations: each protonated carbon gives one cross-peak. The C-H connectivity is exact; the shift values are additivity estimates.",
    ...h.caveats,
  ];
  return { smiles: h.smiles, peaks, caveats };
}
