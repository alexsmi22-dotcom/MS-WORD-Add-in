// Systematic IUPAC names from structures — the SUBSET namer.
//
// ChemDraw's namer is decades of work; pretending to match it would produce
// confident wrong names, which for a patent document is worse than none.
// This module names a well-defined subset COMPLETELY and refuses everything
// else BY NAME:
//
//   IN COVERAGE
//   - acyclic hydrocarbons to C12, branched, with -ene/-yne unsaturation
//     (simple alkyl substituents incl. isopropyl/isobutyl/sec-/tert-butyl,
//     and phenyl as a substituent)
//   - ONE kind of principal characteristic group: -oic acid, -amide,
//     -nitrile, -al, -one, -ol, -amine (multiples of that kind allowed:
//     -dioic, -diol, -dione…)
//   - prefix substituents: fluoro/chloro/bromo/iodo, nitro, hydroxy, oxo,
//     amino, methoxy/ethoxy
//   - plain monocycles to CYCLOHEPTANE (OCL's ring perception stops at
//     7-rings; larger carbocycles refuse honestly), with prefix
//     substituents and an optional -ol/-one/-amine; benzene rings with
//     prefix substituents
//
//   Chain selection follows the traditional (1979) priority — maximum
//   unsaturation before maximum length — so a few 2013 PINs differ
//   (3-methylidenehexane names here as 2-ethylpent-1-ene); every emitted
//   name is unambiguous, correct general nomenclature.
//
//   REFUSED BY NAME (each with its reason)
//   - esters, anhydrides, N-substituted amines/amides, sulfur and other
//     elements, charged species (except the internal nitro pair), isotopes,
//     radicals, fused or hetero rings, ring unsaturation beyond benzene,
//     complex branched substituents, chains beyond C12
//
// The 359-compound dictionary is consulted FIRST by the caller — retained
// names (toluene, phenol, acetic acid) come from there; this module only
// speaks when systematic construction is safe. Stereodescriptors are NOT
// generated: when the structure carries specified stereo, the name is
// constitutional only and a caveat says so.
//
// Naming style: current IUPAC locant placement — pent-2-ene, propan-2-ol,
// hexane-2,4-dione — with the standard final-e elision before a vowel.

import { Molecule } from "openchemlib/full";
import { rgroupLabels } from "./builder";

export interface IupacNameResult {
  name?: string;
  refusal?: string;
  caveats: string[];
  /**
   * The parent chain's locants, as caller atom index → locant (an acyclic name only): what a stereodescriptor needs
   * to say where it is ((2R)-butan-2-ol). Absent for ring names and refusals.
   */
  locants?: Map<number, number>;
  /** Internal: the chosen chain, in the namer's working copy. */
  chain?: number[];
  /** The chain may be numbered from either end with the same name (locant L ↔ length + 1 − L). */
  reversible?: boolean;
}

const STEM = ["", "methan", "ethan", "propan", "butan", "pentan", "hexan", "heptan", "octan", "nonan", "decan", "undecan", "dodecan"];
const ALKYL = ["", "methyl", "ethyl", "propyl", "butyl", "pentyl", "hexyl", "heptyl", "octyl", "nonyl", "decyl"];
const MULT = ["", "", "di", "tri", "tetra", "penta", "hexa"];
const HALO: Record<number, string> = { 9: "fluoro", 17: "chloro", 35: "bromo", 53: "iodo" };
export const IUPAC_MAX_CHAIN = 12;

interface G {
  n: number;
  el: number[];
  adj: { to: number; order: number }[][];
  aromatic: boolean[];
  inRing: boolean[];
}

interface Group {
  kind: "acid" | "amide" | "nitrile" | "al" | "one" | "ol" | "amine";
  /** The chain carbon that anchors the group. */
  carbon: number;
  /** Group atoms outside the chain (O, N…) — never re-read as substituents. */
  satellites: number[];
  /** Terminal groups must sit at a chain end and take locant 1/end. */
  terminal: boolean;
}

const SENIORITY: Group["kind"][] = ["acid", "amide", "nitrile", "al", "one", "ol", "amine"];
const SUFFIX: Record<Group["kind"], string> = {
  acid: "oic acid", amide: "amide", nitrile: "nitrile", al: "al", one: "one", ol: "ol", amine: "amine",
};
const PREFIX_FORM: Partial<Record<Group["kind"], string>> = {
  one: "oxo", ol: "hydroxy", amine: "amino",
};

function refuse(why: string): IupacNameResult {
  return { refusal: why, caveats: [] };
}

export function iupacName(mol0: Molecule): IupacNameResult {
  if (mol0.getAllAtoms() === 0) return refuse("Nothing to name — the structure is empty.");
  if (mol0.isFragment() || rgroupLabels(mol0).length > 0) {
    return refuse("A generic structure (R-groups/query features) has no single name.");
  }
  const mol = mol0.getCompactCopy();
  // The caller's atom numbers ride through the removal of explicit hydrogens (it renumbers): for the chain's locants.
  for (let i = 0; i < mol.getAllAtoms(); i++) mol.setAtomMapNo(i, i + 1, false);
  try {
    mol.removeExplicitHydrogens(false);
  } catch {
    // keep going with whatever we have
  }
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const n = mol.getAllAtoms();

  // Multiple fragments have no single substitutive name.
  const fragNo = new Array(n);
  if (mol.getFragmentNumbers(fragNo, false, false) > 1) {
    return refuse("Two or more separate molecules — name each on its own.");
  }

  // Element and per-atom screens (nitro's internal +/- pair is exempted later).
  for (let i = 0; i < n; i++) {
    const z = mol.getAtomicNo(i);
    if (![6, 7, 8, 9, 17, 35, 53].includes(z)) {
      return refuse(`${mol.getAtomLabel(i)} is outside the namer's subset (C, H, N, O and halogens only).`);
    }
    if (mol.getAtomMass(i) !== 0) return refuse("Isotope labels are outside the namer's subset.");
    if (mol.getAtomRadical(i) !== 0) return refuse("Radicals are outside the namer's subset.");
  }

  const g: G = {
    n,
    el: Array.from({ length: n }, (_, i) => mol.getAtomicNo(i)),
    adj: Array.from({ length: n }, () => []),
    aromatic: Array.from({ length: n }, (_, i) => mol.isAromaticAtom(i)),
    inRing: Array.from({ length: n }, (_, i) => mol.isRingAtom(i)),
  };
  for (let b = 0; b < mol.getAllBonds(); b++) {
    const a1 = mol.getBondAtom(0, b), a2 = mol.getBondAtom(1, b);
    const order = mol.getBondOrder(b);
    g.adj[a1].push({ to: a2, order });
    g.adj[a2].push({ to: a1, order });
  }

  // Nitro groups become a unit BEFORE the charge screen (they are commonly
  // stored as an internal [N+][O-] pair whose charges cancel).
  const nitroN = new Set<number>();
  const nitroSat = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (g.el[i] !== 7) continue;
    const os = g.adj[i].filter((e) => g.el[e.to] === 8 && g.adj[e.to].length === 1);
    const cs = g.adj[i].filter((e) => g.el[e.to] === 6);
    if (os.length === 2 && cs.length === 1 && os.reduce((s, e) => s + e.order, 0) >= 3) {
      nitroN.add(i);
      os.forEach((e) => nitroSat.add(e.to));
    }
  }
  for (let i = 0; i < n; i++) {
    const c = mol.getAtomCharge(i);
    if (c !== 0 && !nitroN.has(i) && !nitroSat.has(i)) {
      return refuse("Charged species are outside the namer's subset (ions carry their own nomenclature).");
    }
  }

  // Ring routing.
  const rings = mol.getRingSet();
  const ringCount = rings.getSize();
  if (ringCount > 1) return refuse("Fused or multiple rings are outside the namer's subset.");
  // OCL's ring set only perceives rings up to 7 atoms — larger rings leave
  // ring-flagged atoms with ringCount 0, and pretending they are chains
  // would misname them (adversarial pass: cyclooctane read "no carbon
  // chain"). The honest boundary is cycloheptane.
  if (ringCount === 0 && g.inRing.some(Boolean)) {
    return refuse("Rings beyond cycloheptane are outside the namer's subset.");
  }

  const caveats: string[] = [];
  let stereo = false;
  for (let i = 0; i < n; i++) if (mol.getAtomParity(i) !== 0) stereo = true;
  for (let b = 0; b < mol.getAllBonds(); b++) if (mol.getBondParity(b) !== 0) stereo = true;
  if (stereo) {
    caveats.push(
      "The structure carries stereochemistry; this name is CONSTITUTIONAL — its CIP stereodescriptors ((R/S), (E/Z)) are added from lib/cip.ts where every stereo element is given (stereoText).",
    );
  }
  caveats.push("Systematic name from the offline subset namer — verify against your house style before filing.");

  const finish = (name: string, chain?: number[], reversible?: boolean): IupacNameResult => {
    if (!chain) return { name, caveats };
    const locants = new Map<number, number>();
    chain.forEach((a, i) => locants.set(mol.getAtomMapNo(a) - 1, i + 1));
    return { name, caveats, locants, ...(reversible ? { reversible: true } : {}) };
  };

  if (ringCount === 1) {
    const size = rings.getRingSize(0);
    const members: number[] = Array.from(rings.getRingAtoms(0));
    const allC = members.every((a) => g.el[a] === 6);
    if (!allC) return refuse("Heteroatom rings are outside the namer's subset (the dictionary covers common ones).");
    const isBenzene = size === 6 && members.every((a) => g.aromatic[a]);
    if (!isBenzene) {
      for (const a of members) {
        for (const e of g.adj[a]) {
          if (g.inRing[e.to] && e.order !== 1) {
            return refuse("Ring double bonds (beyond benzene) are outside the namer's subset.");
          }
        }
      }
    }
    // A benzene ring on a chain that carries a principal group is a PHENYL
    // SUBSTITUENT (2-phenylethan-1-ol), not the parent — route to the chain
    // namer, which classifies the ring through isPlainPhenyl.
    if (isBenzene) {
      const det = detectGroups(g, nitroN, nitroSat);
      // Only when every principal group sits on the CHAIN — a group on the
      // ring itself (phenol, aniline) belongs to the ring path's retained-
      // name refusal, not to a chain that does not exist.
      if (!det.refusal && det.groups.length > 0 && det.groups.every((gr) => !g.inRing[gr.carbon])) {
        const r = nameAcyclic(g, nitroN, nitroSat, null);
        return r.refusal ? r : finish(r.name!, r.chain, r.reversible);
      }
    }
    const r = nameWithOneRing(g, members, isBenzene, nitroN, nitroSat);
    return r.refusal ? r : finish(r.name!);
  }

  const r = nameAcyclic(g, nitroN, nitroSat, null);
  return r.refusal ? r : finish(r.name!, r.chain, r.reversible);
}

// ---------------------------------------------------------------------------
// Substituent classification (shared by chains and rings)
// ---------------------------------------------------------------------------

interface Sub {
  /** Prefix name, e.g. "methyl", "chloro", "methoxy", "phenyl". */
  name: string;
  /** Alphabetization key (sec-/tert- ignored). */
  key: string;
}

/** Collects the subtree atoms hanging off `root` away from `from`. */
function subtree(g: G, root: number, from: number): number[] {
  const seen = new Set<number>([from, root]);
  const out = [root];
  const stack = [root];
  while (stack.length) {
    const a = stack.pop()!;
    for (const e of g.adj[a]) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        out.push(e.to);
        stack.push(e.to);
      }
    }
  }
  return out;
}

/** Names a substituent rooted at `root` (attached from `from`), or a refusal string. */
function classifySub(g: G, root: number, from: number, nitroN: Set<number>): Sub | string {
  const z = g.el[root];
  if (z in HALO) return { name: HALO[z], key: HALO[z] };
  if (nitroN.has(root)) return { name: "nitro", key: "nitro" };
  if (z === 8) {
    const others = g.adj[root].filter((e) => e.to !== from);
    if (others.length === 0) return { name: "hydroxy", key: "hydroxy" };
    if (others.length === 1 && g.el[others[0].to] === 6 && others[0].order === 1) {
      const tail = subtree(g, others[0].to, root);
      if (tail.every((a) => g.el[a] === 6) && isPlainAlkane(g, tail)) {
        if (tail.length === 1) return { name: "methoxy", key: "methoxy" };
        if (tail.length === 2) return { name: "ethoxy", key: "ethoxy" };
      }
      return "Ether groups beyond methoxy/ethoxy are outside the namer's subset.";
    }
    return "This oxygen arrangement is outside the namer's subset.";
  }
  if (z === 7) {
    const others = g.adj[root].filter((e) => e.to !== from);
    if (others.length === 0 && g.adj[root][0].order === 1) return { name: "amino", key: "amino" };
    return "Substituted amines are outside the namer's subset.";
  }
  // Carbon branch: plain alkyl, or phenyl.
  const atoms = subtree(g, root, from);
  if (atoms.some((a) => g.inRing[a])) {
    if (isPlainPhenyl(g, atoms, root)) return { name: "phenyl", key: "phenyl" };
    return "Ring substituents other than plain phenyl are outside the namer's subset.";
  }
  if (!atoms.every((a) => g.el[a] === 6)) return "This substituent carries its own groups — outside the namer's subset.";
  if (!isPlainAlkane(g, atoms)) return "Unsaturated substituents are outside the namer's subset.";
  return alkylName(g, root, from, atoms);
}

function isPlainAlkane(g: G, atoms: number[]): boolean {
  const set = new Set(atoms);
  return atoms.every((a) =>
    g.adj[a].every((e) => !set.has(e.to) || e.order === 1),
  );
}

function isPlainPhenyl(g: G, atoms: number[], root: number): boolean {
  return atoms.length === 6 && atoms.every((a) => g.el[a] === 6 && g.aromatic[a] && g.inRing[a]) && g.inRing[root];
}

function alkylName(g: G, root: number, from: number, atoms: number[]): Sub | string {
  // Unbranched?
  const set = new Set(atoms);
  const degIn = (a: number): number => g.adj[a].filter((e) => set.has(e.to)).length;
  const branched = atoms.some((a) => degIn(a) > 2);
  if (!branched) {
    // Is root an END of the path? (attachment mid-chain would be sec-.)
    if (degIn(root) <= 1) {
      const len = atoms.length;
      if (len < ALKYL.length) return { name: ALKYL[len], key: ALKYL[len] };
      return "Substituent chains beyond decyl are outside the namer's subset.";
    }
    if (atoms.length === 3) return { name: "propan-2-yl", key: "propanyl" };
    if (atoms.length === 4 && degIn(root) === 2) return { name: "sec-butyl", key: "butyl" };
    return "This attachment pattern is outside the namer's subset.";
  }
  // Small named branched alkyls, recognized by shape from the root.
  const rootDeg = degIn(root);
  if (atoms.length === 4 && rootDeg === 3) return { name: "tert-butyl", key: "butyl" };
  if (atoms.length === 4 && rootDeg === 1) {
    // CH2-CH(CH3)2
    const next = g.adj[root].find((e) => set.has(e.to))!.to;
    if (degIn(next) === 3) return { name: "isobutyl", key: "isobutyl" };
  }
  return "Complex branched substituents are outside the namer's subset.";
}

const MULT_COMPLEX = ["", "", "bis", "tris", "tetrakis", "pentakis", "hexakis"];

/** Assembles "3-chloro-2,2-dimethyl…" from locant→name pairs, or a refusal
 *  when the multiplier tables run out (never a garbled "7-fold-"). Names
 *  that contain their own locants (propan-2-yl) get enclosing marks and
 *  bis/tris multipliers, per the rules. */
function prefixString(subs: { loc: number | null; name: string; key: string }[]): string | { refusal: string } {
  const byName = new Map<string, { locs: (number | null)[]; key: string }>();
  for (const s of subs) {
    const cur = byName.get(s.name) ?? { locs: [], key: s.key };
    cur.locs.push(s.loc);
    byName.set(s.name, cur);
  }
  const parts: string[] = [];
  for (const [name, { locs }] of [...byName.entries()].sort((a, b) => a[1].key.localeCompare(b[1].key))) {
    const count = locs.length;
    const complex = /\d/.test(name);
    const multTable = complex ? MULT_COMPLEX : MULT;
    if (count >= multTable.length || (count > 1 && !multTable[count])) {
      return { refusal: `More than ${multTable.length - 1} identical substituents is outside the namer's subset.` };
    }
    const mult = count > 1 ? multTable[count] : "";
    const shown = complex ? `(${name})` : name;
    const withLoc = locs.every((l) => l !== null)
      ? `${(locs as number[]).sort((x, y) => x - y).join(",")}-`
      : "";
    parts.push(`${withLoc}${mult}${shown}`);
  }
  // Hyphens separate locants from words; two word-parts join directly
  // (chlorodifluoromethane), a following locant re-introduces the hyphen
  // (3-chloro-2-methylpentane).
  return parts.reduce((acc, p) => (acc === "" ? p : /^[0-9(]/.test(p) ? `${acc}-${p}` : `${acc}${p}`), "");
}

// ---------------------------------------------------------------------------
// Acyclic naming
// ---------------------------------------------------------------------------

function detectGroups(g: G, nitroN: Set<number>, nitroSat: Set<number>): { groups: Group[]; refusal?: string } {
  const groups: Group[] = [];
  for (let c = 0; c < g.n; c++) {
    if (g.el[c] !== 6 || g.inRing[c]) continue;
    const dblO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 2 && !nitroSat.has(e.to));
    const singleO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 1 && !nitroSat.has(e.to));
    const dblN = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 2 && !nitroN.has(e.to));
    const nS = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 1 && !nitroN.has(e.to));
    const tripleN = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 3);
    const cN = g.adj[c].filter((e) => g.el[e.to] === 6);
    // C=N is NOT in the subset, and skipping it silently would name a
    // different chemical formula (ethanimine came out "ethane" in the
    // adversarial pass) — the exact worst case for a patent tool.
    if (dblN.length > 0) {
      return { groups, refusal: "C=N groups (imines, oximes, amidines) are outside the namer's subset." };
    }
    if (tripleN.length === 1) {
      groups.push({ kind: "nitrile", carbon: c, satellites: [tripleN[0].to], terminal: true });
      continue;
    }
    if (dblO.length === 0) continue;
    // From here the carbon is a CARBONYL carbon — every decoration must be
    // accounted for, or refused. An unmatched pattern must never fall
    // through (urea and carbonic acid lost their =O entirely).
    if (dblO.length > 1) return { groups, refusal: "This carbonyl arrangement (CO₂-like) is outside the namer's subset." };
    if (g.adj[c].some((e) => g.el[e.to] in HALO)) {
      return { groups, refusal: "Acyl halides are outside the namer's subset." };
    }
    if (cN.some((e) => e.order !== 1)) {
      return { groups, refusal: "Cumulated carbonyls (ketene-like C=C=O) are outside the namer's subset." };
    }
    if (singleO.length === 1 && nS.length === 0) {
      const o = singleO[0].to;
      const oOthers = g.adj[o].filter((e) => e.to !== c);
      if (oOthers.length > 0) return { groups, refusal: "Ester/anhydride linkages are outside the namer's subset." };
      groups.push({ kind: "acid", carbon: c, satellites: [dblO[0].to, o], terminal: true });
      continue;
    }
    if (nS.length === 1 && singleO.length === 0) {
      const nn = nS[0].to;
      const nOthers = g.adj[nn].filter((e) => e.to !== c);
      if (nOthers.length > 0) return { groups, refusal: "N-substituted amides are outside the namer's subset." };
      groups.push({ kind: "amide", carbon: c, satellites: [dblO[0].to, nn], terminal: true });
      continue;
    }
    if (singleO.length === 0 && nS.length === 0) {
      groups.push({ kind: cN.length <= 1 ? "al" : "one", carbon: c, satellites: [dblO[0].to], terminal: cN.length <= 1 });
      continue;
    }
    return {
      groups,
      refusal: "This carbonyl arrangement (carbonic acid, urea, carbamate…) is outside the namer's subset.",
    };
  }
  // -OH and -NH2 anchored on carbons not already claimed.
  const claimed = new Set(groups.flatMap((gr) => gr.satellites));
  for (let i = 0; i < g.n; i++) {
    if (claimed.has(i) || nitroSat.has(i) || nitroN.has(i)) continue;
    if (g.el[i] === 8 && g.adj[i].length === 1 && g.adj[i][0].order === 1 && g.el[g.adj[i][0].to] === 6) {
      groups.push({ kind: "ol", carbon: g.adj[i][0].to, satellites: [i], terminal: false });
    }
    if (g.el[i] === 7 && g.adj[i].length === 1 && g.adj[i][0].order === 1 && g.el[g.adj[i][0].to] === 6) {
      groups.push({ kind: "amine", carbon: g.adj[i][0].to, satellites: [i], terminal: false });
    }
  }
  return { groups };
}

function nameAcyclic(
  g: G,
  nitroN: Set<number>,
  nitroSat: Set<number>,
  phenylOf: null,
): IupacNameResult {
  const det = detectGroups(g, nitroN, nitroSat);
  if (det.refusal) return refuse(det.refusal);

  // The principal kind is the most senior present; everything junior must
  // have a prefix form or the molecule is refused.
  const present = SENIORITY.filter((k) => det.groups.some((gr) => gr.kind === k));
  const principalKind = present[0];
  const principal = det.groups.filter((gr) => gr.kind === principalKind);
  const junior = det.groups.filter((gr) => gr.kind !== principalKind);
  for (const j of junior) {
    if (!PREFIX_FORM[j.kind]) {
      return refuse(`A ${SUFFIX[j.kind]} group alongside a more senior group is outside the namer's subset.`);
    }
  }

  const satAtoms = new Set(det.groups.flatMap((gr) => gr.satellites));

  // Candidate chains: carbon paths (the carbon skeleton is a tree here).
  const carbons: number[] = [];
  for (let i = 0; i < g.n; i++) if (g.el[i] === 6 && !g.inRing[i]) carbons.push(i);
  if (carbons.length === 0) return refuse("No carbon chain to name.");
  const cAdj = new Map<number, number[]>();
  for (const c of carbons) {
    cAdj.set(c, g.adj[c].filter((e) => g.el[e.to] === 6 && !g.inRing[e.to]).map((e) => e.to));
  }
  const pathBetween = (a: number, b: number): number[] | null => {
    const prev = new Map<number, number>([[a, -1]]);
    const q = [a];
    while (q.length) {
      const x = q.shift()!;
      if (x === b) break;
      for (const y of cAdj.get(x) ?? []) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
    }
    if (!prev.has(b)) return null;
    const path = [b];
    let cur = b;
    while (prev.get(cur) !== -1) { cur = prev.get(cur)!; path.push(cur); }
    return path.reverse();
  };
  const candidates: number[][] = [];
  for (let i = 0; i < carbons.length; i++) {
    for (let j = i; j < carbons.length; j++) {
      const p = pathBetween(carbons[i], carbons[j]);
      if (p) candidates.push(p);
    }
  }

  const principalCarbons = principal.map((p) => p.carbon);
  const terminal = principal.length > 0 && principal[0].terminal;
  const viable = candidates.filter((chain) => {
    const set = new Set(chain);
    if (!principalCarbons.every((c) => set.has(c))) return false;
    if (terminal) {
      // Terminal groups must sit at chain ends.
      const ends = [chain[0], chain[chain.length - 1]];
      if (!principalCarbons.every((c) => ends.includes(c))) return false;
    }
    return true;
  });
  if (viable.length === 0) {
    return refuse("The principal groups cannot all lie on one chain — outside the namer's subset.");
  }

  interface Scored {
    chain: number[];
    unsat: { loc: number; order: number }[];
    suffixLocs: number[];
    subs: { loc: number; name: string; key: string }[];
    scoreKey: number[];
    /** Both numbering directions give the same name: the chain may be numbered from either end. */
    reversible?: boolean;
  }

  const analyse = (chainIn: number[]): Scored | string => {
    // Try both directions; keep the better numbering.
    let best: Scored | null = null;
    for (const chain of [chainIn, [...chainIn].reverse()]) {
      const pos = new Map(chain.map((a, i) => [a, i + 1]));
      const set = new Set(chain);
      // Unsaturation within the chain.
      const unsat: { loc: number; order: number }[] = [];
      let exo = false;
      for (const a of chain) {
        for (const e of g.adj[a]) {
          if (e.order === 1) continue;
          if (g.el[e.to] === 6 && !set.has(e.to) && !g.inRing[e.to]) exo = true;
          if (set.has(e.to) && pos.get(e.to)! === pos.get(a)! + 1) unsat.push({ loc: pos.get(a)!, order: e.order });
        }
      }
      if (exo) return "An exocyclic/branch double bond is outside the namer's subset.";
      // Suffix locants.
      const suffixLocs = principal.map((p) => pos.get(p.carbon)!).sort((x, y) => x - y);
      // Substituents (junior groups in prefix form + everything else).
      const subs: { loc: number; name: string; key: string }[] = [];
      for (const j of junior) {
        const nm = PREFIX_FORM[j.kind]!;
        subs.push({ loc: pos.get(j.carbon)!, name: nm, key: nm });
      }
      let subRefusal: string | null = null;
      for (const a of chain) {
        for (const e of g.adj[a]) {
          if (set.has(e.to) || satAtoms.has(e.to)) continue;
          if (g.el[e.to] === 6 && !set.has(e.to) && g.inRing[e.to]) {
            const cls = classifySub(g, e.to, a, nitroN);
            if (typeof cls === "string") { subRefusal = cls; break; }
            subs.push({ loc: pos.get(a)!, ...cls });
            continue;
          }
          if (e.order !== 1 && g.el[e.to] !== 6) {
            // Every legitimate heteroatom multiple bond was claimed as a
            // group satellite above — anything still here is outside the
            // subset, and silently skipping it would drop atoms from the
            // name (the imine trap).
            return "A heteroatom multiple bond here is outside the namer's subset.";
          }
          const cls = classifySub(g, e.to, a, nitroN);
          if (typeof cls === "string") { subRefusal = cls; break; }
          subs.push({ loc: pos.get(a)!, ...cls });
        }
        if (subRefusal) break;
      }
      if (subRefusal) return subRefusal;
      // Alphabetical, and by locant within one name: identical groups listed in array order made the two directions of
      // a symmetric chain (tartaric acid's two OH) score differently, so it was never seen as reversible (review).
      const alphaLocs = [...subs].sort((x, y) => x.key.localeCompare(y.key) || x.loc - y.loc).map((s) => s.loc);
      const scoreKey = [
        ...suffixLocs,
        99, ...unsat.map((u) => u.loc).sort((x, y) => x - y),
        // ene/yne tie: when the combined locant set ties in both directions,
        // the DOUBLE bonds take the lower locants (pent-1-en-4-yne, from
        // either input order — without this the winner was enumeration
        // order, a nondeterministic wrong name).
        99, ...unsat.filter((u) => u.order === 2).map((u) => u.loc).sort((x, y) => x - y),
        99, ...subs.map((s) => s.loc).sort((x, y) => x - y),
        99, ...alphaLocs,
      ];
      const cand: Scored = { chain, unsat, suffixLocs, subs, scoreKey };
      // The same name either way (a symmetric chain): IUPAC P-31.1.4.3.4 then lets the stereodescriptors choose.
      const sameName = (p: Scored, q: Scored): boolean =>
        p.scoreKey.join() === q.scoreKey.join() &&
        JSON.stringify([...p.subs].map((x) => [x.loc, x.name]).sort()) === JSON.stringify([...q.subs].map((x) => [x.loc, x.name]).sort()) &&
        JSON.stringify(p.unsat) === JSON.stringify(q.unsat) &&
        p.suffixLocs.join() === q.suffixLocs.join();
      if (best && sameName(cand, best)) best.reversible = true;
      else if (!best || lexLess(cand.scoreKey, best.scoreKey)) best = cand;
    }
    return best!;
  };

  const lexLess = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? Infinity, y = b[i] ?? Infinity;
      if (x !== y) return x < y;
    }
    return false;
  };

  // Chain selection: most unsaturation in chain → longest → most substituents
  // → best locant key.
  let chosen: Scored | null = null;
  let refusalSeen: string | null = null;
  let refusalLen = -1;
  for (const cand of viable) {
    const a = analyse(cand);
    if (typeof a === "string") {
      // Keep the refusal from the LONGEST failing chain — a one-carbon
      // stub's complaint ("substituent carries groups") must not shadow the
      // real story ("substituted amines are outside the subset").
      if (cand.length > refusalLen) { refusalSeen = a; refusalLen = cand.length; }
      continue;
    }
    if (!chosen) { chosen = a; continue; }
    const better =
      a.unsat.length !== chosen.unsat.length ? a.unsat.length > chosen.unsat.length :
      a.chain.length !== chosen.chain.length ? a.chain.length > chosen.chain.length :
      a.subs.length !== chosen.subs.length ? a.subs.length > chosen.subs.length :
      lexLess(a.scoreKey, chosen.scoreKey);
    if (better) chosen = a;
  }
  if (!chosen) return refuse(refusalSeen ?? "No viable chain found.");

  const len = chosen.chain.length;
  if (len >= STEM.length) return refuse(`Chains beyond C${IUPAC_MAX_CHAIN} are outside the namer's subset.`);

  // Assemble.
  const stemBase = STEM[len].slice(0, -2); // "butan" → "but"
  const enes = chosen.unsat.filter((u) => u.order === 2).map((u) => u.loc).sort((a, b) => a - b);
  const ynes = chosen.unsat.filter((u) => u.order === 3).map((u) => u.loc).sort((a, b) => a - b);
  let parent: string;
  if (enes.length === 0 && ynes.length === 0) {
    parent = STEM[len]; // saturated: "butan"
  } else {
    let s = stemBase;
    // Ethene/ethyne: a two-carbon chain has only one possible position, so
    // the locant is omitted (prop-1-ene and up keep theirs — PIN style).
    if (enes.length) s += len <= 2 ? "en" : (enes.length > 1 ? `a-${enes.join(",")}-${MULT[enes.length]}en` : `-${enes.join(",")}-en`);
    if (ynes.length) s += len <= 2 ? "yn" : (ynes.length > 1 ? `a-${ynes.join(",")}-${MULT[ynes.length]}yn` : `-${ynes.join(",")}-yn`);
    parent = s;
  }

  let name: string;
  if (!principalKind) {
    name = parent + (enes.length || ynes.length ? "e" : "e");
  } else {
    const suffix = SUFFIX[principalKind];
    const count = chosen.suffixLocs.length;
    if (count >= MULT.length) {
      return refuse(`More than ${MULT.length - 1} identical principal groups is outside the namer's subset.`);
    }
    const mult = count > 1 ? MULT[count] : "";
    // Terminal suffixes (-oic acid, -al…) never take locants. Short chains
    // drop the locant ONLY when nothing else in the name is numbered:
    // "ethanol", but "2-aminoethan-1-ol" (PIN keeps the 1). A ONE-carbon
    // parent has no meaningful locants at all (phenylmethanol, not
    // phenylmethan-1-ol).
    const bare = len <= 2 && chosen.subs.length === 0 && chosen.unsat.length === 0 && count === 1;
    const needLocants = !principal[0].terminal && !bare && len > 1;
    const locStr = needLocants ? `-${chosen.suffixLocs.join(",")}-` : "";
    const suffixPart = `${locStr}${mult}${suffix}`;
    // Final-e elision: the stem keeps its "e" before a consonant-initial
    // suffix (butanenitrile, pentane-2,4-dione) and drops it before a
    // vowel-initial one (butanal, propan-2-ol).
    name = /^[-0-9,]*(d|n|t|h|p)/.test(suffixPart)
      ? `${parent}e${suffixPart}`
      : `${parent}${suffixPart}`;
  }

  // Locant omission where positions are unambiguous: every locant on a
  // one-carbon parent (tetrachloromethane), or a lone substituent on a
  // two-carbon parent (chloroethane, methoxyethane).
  const subList: { loc: number | null; name: string; key: string }[] =
    chosen.subs.map((s) => ({ loc: s.loc, name: s.name, key: s.key }));
  if (len === 1) {
    for (const s of subList) s.loc = null;
  } else if (!principalKind && chosen.unsat.length === 0 && len <= 2 && subList.length === 1) {
    subList[0].loc = null;
  }
  const prefixes = prefixString(subList);
  if (typeof prefixes !== "string") return refuse(prefixes.refusal);
  const full = prefixes ? `${prefixes}${/^[0-9]/.test(name) ? "-" : ""}${name}` : name;
  return { name: full, caveats: [], chain: chosen.chain, reversible: chosen.reversible };
}

// ---------------------------------------------------------------------------
// Single-ring naming (benzene + cycloalkanes)
// ---------------------------------------------------------------------------

function nameWithOneRing(
  g: G,
  members: number[],
  isBenzene: boolean,
  nitroN: Set<number>,
  nitroSat: Set<number>,
): IupacNameResult {
  // Anything hanging off the ring must be a prefix substituent, or for
  // cycloalkanes optionally ONE -ol/-one/-amine suffix.
  const memberSet = new Set(members);
  // Order members around the ring.
  const ring: number[] = [members[0]];
  while (ring.length < members.length) {
    const cur = ring[ring.length - 1];
    const next = g.adj[cur].map((e) => e.to).find((a) => memberSet.has(a) && !ring.includes(a));
    if (next === undefined) break;
    ring.push(next);
  }
  if (ring.length !== members.length) return refuse("Could not walk the ring — outside the namer's subset.");

  interface RingSub { idx: number; name: string; key: string; suffix?: "ol" | "one" | "amine" }
  const subs: RingSub[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    for (const e of g.adj[a]) {
      if (memberSet.has(e.to)) continue;
      if (!isBenzene && g.el[e.to] === 8 && e.order === 2) {
        subs.push({ idx: i, name: "", key: "", suffix: "one" });
        continue;
      }
      if (g.el[e.to] === 8 && e.order === 1 && g.adj[e.to].length === 1) {
        if (isBenzene) return refuse("Phenols and other benzene principal groups are retained names — the dictionary covers common ones.");
        subs.push({ idx: i, name: "", key: "", suffix: "ol" });
        continue;
      }
      if (g.el[e.to] === 7 && !nitroN.has(e.to) && e.order === 1 && g.adj[e.to].length === 1) {
        if (isBenzene) return refuse("Anilines and other benzene principal groups are retained names — the dictionary covers common ones.");
        subs.push({ idx: i, name: "", key: "", suffix: "amine" });
        continue;
      }
      // classifySub never sees bond orders — an exocyclic double bond
      // (methylidenecyclohexane) must not be read as a saturated alkyl.
      if (e.order !== 1) {
        return refuse("An exocyclic double bond on the ring is outside the namer's subset.");
      }
      const cls = classifySub(g, e.to, a, nitroN);
      if (typeof cls === "string") return refuse(cls);
      subs.push({ idx: i, ...cls });
    }
  }
  const suffixSubs = subs.filter((s) => s.suffix);
  if (suffixSubs.length > 1) return refuse("More than one principal group on a ring is outside the namer's subset.");
  const prefixSubs = subs.filter((s) => !s.suffix);

  const size = ring.length;
  if (size >= STEM.length) return refuse(`Rings beyond C${IUPAC_MAX_CHAIN} are outside the namer's subset.`);
  const parent = isBenzene ? "benzene" : `cyclo${STEM[size]}e`;
  if (subs.length === 0) return { name: parent, caveats: [] };

  // Choose numbering: all rotations, both directions; suffix carbon gets 1.
  let best: { locs: { loc: number; name: string; key: string }[]; sufLoc: number | null; key: number[] } | null = null;
  const dirs = [1, -1];
  for (const dir of dirs) {
    for (let start = 0; start < size; start++) {
      const locOf = (idx: number): number => ((idx - start) * dir + size * 10) % size + 1;
      const sufLoc = suffixSubs.length ? locOf(suffixSubs[0].idx) : null;
      if (sufLoc !== null && sufLoc !== 1) continue;
      const locs = prefixSubs.map((s) => ({ loc: locOf(s.idx), name: s.name, key: s.key }));
      const sorted = locs.map((l) => l.loc).sort((a, b) => a - b);
      const alpha = [...locs].sort((a, b) => a.key.localeCompare(b.key)).map((l) => l.loc);
      const key = [...sorted, 99, ...alpha];
      if (!best || lexLessArr(key, best.key)) best = { locs, sufLoc, key };
    }
  }
  if (!best) return refuse("Could not number the ring.");

  const prefixes = prefixString(best.locs);
  if (typeof prefixes !== "string") return refuse(prefixes.refusal);
  if (suffixSubs.length === 0) {
    // Monosubstituted rings need no locant.
    const clean = prefixSubs.length === 1 ? prefixes.replace(/^1-/, "") : prefixes;
    return { name: `${clean}${parent}`, caveats: [] };
  }
  const kind = suffixSubs[0].suffix!;
  const stem = parent.slice(0, -1); // "cyclohexan"
  const suffix = kind === "one" ? "-1-one" : kind === "ol" ? "-1-ol" : "-1-amine";
  const name = `${typeof prefixes === "string" && prefixes ? prefixes : ""}${stem}${suffix}`;
  return { name, caveats: [] };
}

const lexLessArr = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? Infinity, y = b[i] ?? Infinity;
    if (x !== y) return x < y;
  }
  return false;
};
