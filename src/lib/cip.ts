/**
 * CIP stereodescriptors (docs/SCOPE-CIP.md): R/S on stereocentres and E/Z on double bonds, ranked by JurisLab's own
 * hierarchical digraph (IUPAC 2013 P-92: rule 1a atomic number with duplicate atoms, rule 1b root distance of
 * duplicates, rule 2 mass) and shown only when OpenChemLib's own answer agrees. Refused by name, never guessed:
 *
 *   - branches still tied after the whole digraph → "undecided — needs CIP rules 3–5" (like/unlike, pseudo-asymmetry);
 *   - a digraph past the work budget → "too complex to decide here" (cages explode; an unbounded loop freezes Word);
 *   - axial chirality (allenes, biaryls) and helicity → not given yet (M/P);
 *   - a centre drawn without a wedge → unspecified.
 *
 * Measured baseline (CIP Validation Suite, scripts/cip-suite.js): OpenChemLib alone gives 117–129 wrong labels in
 * 1,250 — every pseudo-asymmetric r/s and axial case, and some deep ties. The release gate is zero wrong labels.
 */
import { Molecule } from "openchemlib/full";
import { atomicWeight } from "./periodic";

export type CipLabel = "R" | "S" | "E" | "Z";

export interface CipCentre {
  kind: "atom" | "bond";
  /** The stereocentre (kind "atom"), or a double bond's first atom (kind "bond"), in the caller's atom numbering. */
  atom: number;
  /** A double bond's other atom (kind "bond"). */
  atom2?: number;
  /** The descriptor, or null when refused (reason says why). */
  label: CipLabel | null;
  reason: string | null;
  /** A stereocentre whose fourth ligand is a lone pair (S, P, N): toolkits differ on reading such centres from SMILES. */
  lonePair?: boolean;
}

export interface CipResult {
  centres: CipCentre[];
}

/** Digraph node visits allowed per molecule before refusing (cages and fused systems explode). */
export const CIP_BUDGET = 200_000;

class BudgetExceeded extends Error {}
/** Rule 2 deciding between a labelled isotope and an unlabelled atom of the same element (e.g. ¹⁶O vs O): the suite
 *  ranks these against the average-mass reading, so they are refused, not guessed (VS176). */
class IsotopeUnsure extends Error {}

interface Node {
  /** Atom index in the working copy; -1 for a phantom (or lone pair). */
  atom: number;
  z: number;
  mass: number;
  dup: boolean;
  /** Root distance used by rule 1b: of the duplicated atom for a duplicate, else the node's own. */
  rd: number;
  depth: number;
  parent: Node | null;
  /** Atoms on the path from the root to here (this one included). */
  path: Set<number>;
  kids?: Node[];
}

type Rule = (n: Node) => number;
const RULES: Array<{ key: Rule; name: string }> = [
  { key: (n) => n.z, name: "1a" },
  // Lower root distance precedes: negated so that "greater key = higher priority" holds for every rule.
  { key: (n) => (n.dup ? -n.rd : -n.depth), name: "1b" },
  { key: (n) => n.mass, name: "2" },
];

/**
 * The CIP descriptors of a molecule's stereocentres and stereogenic double bonds, each either a label (R/S/E/Z) both
 * rankings agree on, or a refusal with its reason. The molecule is not changed.
 */
export interface CipOptions {
  /**
   * The structure came from text (SMILES, an idcode), not a drawing: its layout is generated, so no degenerate-drawing
   * check; and E/Z in a ring of 8+ is refused — OpenChemLib's SMILES reader misreads such bonds in polyene macrocycles
   * (nystatin's E bonds read Z, both rankings then agreeing on the misread structure — review round 2).
   */
  fromText?: boolean;
}

export function cipDescriptors(input: Molecule, budget = CIP_BUDGET, opts: CipOptions = {}): CipResult {
  const mol = input.getCompactCopy();
  // Caller's numbering kept through OpenChemLib's helper arrays (they move explicit hydrogens to the end).
  for (let a = 0; a < mol.getAllAtoms(); a++) mol.setAtomMapNo(a, a + 1, false);
  // A structure with no layout (read from an idcode alone) gets one that keeps its stored stereo: E/Z is read from
  // the drawn geometry, and every atom at 0,0 would read as "in line".
  let laidOut = false;
  for (let a = 0; a < mol.getAllAtoms() && !laidOut; a++) if (mol.getAtomX(a) !== 0 || mol.getAtomY(a) !== 0) laidOut = true;
  if (!laidOut && mol.getAllAtoms() > 1) {
    mol.ensureHelperArrays(Molecule.cHelperParities);
    mol.inventCoordinates();
  }
  mol.ensureHelperArrays(Molecule.cHelperCIP);
  const callerIndex = (a: number): number => mol.getAtomMapNo(a) - 1;
  // Constitution-only ranks (every stereo feature stripped): two ligands of one rank are constitutionally the same, so
  // rules 1–2 cannot rank them — the centre needs rules 3–5 (pseudo-asymmetry, like/unlike). Both rankings once agreed
  // on R/S where the suite says r/s (VS215, VS216, VS234): this check does not rest on either ranking.
  const flat = mol.getCompactCopy();
  flat.stripStereoInformation();
  flat.ensureHelperArrays(Molecule.cHelperSymmetrySimple);
  const constRank = new Map<number, number>();
  for (let a = 0; a < flat.getAllAtoms(); a++) constRank.set(flat.getAtomMapNo(a) - 1, flat.getSymmetryRank(a));
  const sameConstitution = (atoms: number[]): boolean => {
    const ranks = atoms.filter((a) => a >= 0).map((a) => constRank.get(callerIndex(a)));
    return new Set(ranks).size < ranks.length;
  };

  const massOf = (a: number): number => {
    const iso = mol.getAtomMass(a);
    return iso > 0 ? iso : atomicWeight(mol.getAtomicNo(a)) ?? 0;
  };
  /**
   * Which bonds are averaged (no Kekulé-dependent duplicate; their atoms get one averaged duplicate instead, below):
   * aromatic bonds always; in the cross-check pass, every bond of a conjugated ring as well. A centre whose ranking
   * changes between the passes depends on where the double bonds happen to be drawn, and is refused — both rankings
   * once agreed on R/S at the cage centres where the suite says s (VS215, VS216), decided by the drawn double bonds.
   */
  let averageConjugatedRings = false;
  const averaged = (bd: number): boolean =>
    mol.isAromaticBond(bd) ||
    (averageConjugatedRings && mol.isRingBond(bd) && mol.getBondOrder(bd) <= 2 && mol.getAtomPi(mol.getBondAtom(0, bd)) > 0 && mol.getAtomPi(mol.getBondAtom(1, bd)) > 0);
  const bondOrder = (a: number, b: number): number => {
    const bd = mol.getBond(a, b);
    if (bd < 0 || averaged(bd)) return 1;
    // S=O, P=O, S=N … at a hypervalent P / S / Se / As: no duplicates (the 2013 rules, as OpenChemLib and RDKit read
    // them — duplicating made every sulfinate / phosphonate disagree and be refused: review).
    const za = mol.getAtomicNo(a), zb = mol.getAtomicNo(b);
    const hyper = (z: number): boolean => z === 15 || z === 16 || z === 33 || z === 34;
    if ((hyper(za) && [7, 8, 16, 34].includes(zb)) || (hyper(zb) && [7, 8, 16, 34].includes(za))) return 1;
    return Math.max(1, mol.getBondOrder(bd));
  };
  /**
   * IUPAC 2013 P-92.1.4.4: an atom of a mancude (aromatic) ring has one duplicate whose atomic number is the mean over
   * the atoms it could duplicate — independent of which Kekulé structure was drawn. Placing duplicates by the drawn
   * Kekulé structure told apart two branches that are the same (VS215, VS216: R/S where the suite says s). Null for an
   * atom with no aromatic bond.
   */
  const mancudeDup = (a: number): { z: number; mass: number } | null => {
    let zs = 0, ms = 0, k = 0, double = false;
    for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
      const nb = mol.getConnAtom(a, i);
      const bd = mol.getBond(a, nb);
      if (bd >= 0 && averaged(bd)) {
        zs += mol.getAtomicNo(nb);
        ms += massOf(nb);
        k++;
        if (mol.getBondOrder(bd) === 2) double = true;
      }
    }
    // Only an atom with a double bond among them has a duplicate (a pyrrole N has none).
    return k && double ? { z: zs / k, mass: ms / k } : null;
  };
  const hWeight = atomicWeight(1) ?? 1.008;
  let visits = 0;
  const phantom = (parent: Node): Node => ({ atom: -1, z: 0, mass: 0, dup: false, rd: parent.depth + 1, depth: parent.depth + 1, parent, path: parent.path, kids: [] });
  const dupOf = (atom: number, rd: number, parent: Node): Node => {
    const d: Node = { atom, z: mol.getAtomicNo(atom), mass: massOf(atom), dup: true, rd, depth: parent.depth + 1, parent, path: parent.path, kids: [] };
    d.kids = [phantom(d), phantom(d), phantom(d)];
    return d;
  };
  const depthOnPath = (node: Node, atom: number): number => {
    for (let x: Node | null = node; x; x = x.parent) if (x.atom === atom && !x.dup) return x.depth;
    return node.depth;
  };
  /** A node's substituents, generated once: neighbours (duplicates on ring closure), duplicates for multiple bonds, hydrogens, phantoms to three. */
  const kids = (node: Node): Node[] => {
    if (node.kids) return node.kids;
    if (++visits > budget) throw new BudgetExceeded();
    const out: Node[] = [];
    const a = node.atom;
    const from = node.parent?.atom ?? -2;
    for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
      const nb = mol.getConnAtom(a, i);
      const order = bondOrder(a, nb);
      if (nb === from) {
        // A multiple bond back to the parent: duplicates of the parent here.
        for (let k = 1; k < order; k++) out.push(dupOf(nb, node.depth - 1, node));
        continue;
      }
      if (node.path.has(nb)) {
        out.push(dupOf(nb, depthOnPath(node, nb), node));
        continue;
      }
      const path = new Set(node.path);
      path.add(nb);
      out.push({ atom: nb, z: mol.getAtomicNo(nb), mass: massOf(nb), dup: false, rd: node.depth + 1, depth: node.depth + 1, parent: node, path });
      // A multiple bond onward: duplicates of the neighbour here (the neighbour gets ours when it is expanded).
      for (let k = 1; k < order; k++) out.push(dupOf(nb, node.depth + 1, node));
    }
    const md = mancudeDup(a);
    if (md) {
      const d: Node = { atom: a, z: md.z, mass: md.mass, dup: true, rd: node.depth + 1, depth: node.depth + 1, parent: node, path: node.path, kids: [] };
      d.kids = [phantom(d), phantom(d), phantom(d)];
      out.push(d);
    }
    for (let h = 0; h < mol.getImplicitHydrogens(a); h++) out.push({ atom: -1, z: 1, mass: hWeight, dup: false, rd: node.depth + 1, depth: node.depth + 1, parent: node, path: node.path, kids: [] });
    while (out.length < 3) out.push(phantom(node));
    node.kids = out;
    return out;
  };
  /** A rule-2 decision between a labelled and an unlabelled atom of one element is refused (see IsotopeUnsure). */
  const isoGuard = (p: Node, q: Node, rule: Rule, d: number): number => {
    if (rule !== RULES[2].key || p.z !== q.z || p.z === 0) return d;
    const labelled = (k: Node): boolean => k.atom >= 0 && mol.getAtomMass(k.atom) > 0;
    if (labelled(p) !== labelled(q)) throw new IsotopeUnsure();
    return d;
  };
  /** Hierarchical comparison of two branches by one rule, sphere by sphere: > 0 when x has priority. */
  const sortCache = new Map<Node, Map<Rule, Node[]>>();
  const sorted = (node: Node, rule: Rule): Node[] => {
    let m = sortCache.get(node);
    if (!m) sortCache.set(node, (m = new Map()));
    let s = m.get(rule);
    if (!s) {
      s = [...kids(node)].sort((p, q) => compare(q, p, rule));
      m.set(rule, s);
    }
    return s;
  };
  const compare = (x: Node, y: Node, rule: Rule): number => {
    const d0 = rule(x) - rule(y);
    if (d0) return isoGuard(x, y, rule, d0);
    let level: Array<[Node, Node]> = [[x, y]];
    // Within a sphere the children sorted by their own key give the same key sequence as the full hierarchical sort
    // (a node's key is its first criterion), so a sphere is compared cheaply; the full sort — which explores deeper —
    // is paid only to pair children for the next sphere, once this one ties (review: a C60 adduct took 2–3 s).
    const byKey = (node: Node): Node[] => [...kids(node)].sort((p, q) => rule(q) - rule(p));
    while (level.length) {
      for (const [p, q] of level) {
        const sp = byKey(p), sq = byKey(q);
        const len = Math.max(sp.length, sq.length);
        for (let i = 0; i < len; i++) {
          const kp = sp[i] ? rule(sp[i]) : rule(phantom(p)), kq = sq[i] ? rule(sq[i]) : rule(phantom(q));
          if (kp !== kq) return sp[i] && sq[i] ? isoGuard(sp[i], sq[i], rule, kp - kq) : kp - kq;
        }
      }
      const next: Array<[Node, Node]> = [];
      for (const [p, q] of level) {
        const sp = sorted(p, rule), sq = sorted(q, rule);
        for (let i = 0; i < Math.min(sp.length, sq.length); i++) if (sp[i].atom >= 0 || sp[i].z) next.push([sp[i], sq[i]]);
      }
      level = next;
    }
    return 0;
  };
  /** Ranks branches (highest priority first) or returns null when two still tie after every rule. */
  const rank = (branches: Node[]): Node[] | null => {
    const order = [...branches];
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++) {
        let c = 0;
        for (const r of RULES) {
          c = compare(order[i], order[j], r.key);
          if (c) break;
        }
        if (c === 0) return null;
      }
    return order.sort((p, q) => {
      for (const r of RULES) {
        const c = compare(q, p, r.key);
        if (c) return c;
      }
      return 0;
    });
  };
  const rootOf = (atom: number): Node => ({ atom, z: mol.getAtomicNo(atom), mass: massOf(atom), dup: false, rd: 0, depth: 0, parent: null, path: new Set([atom]) });
  /** Branch nodes of a root's ligands (all but `skip`), plus implicit hydrogens and, for three ligands, a lone pair. */
  const ligands = (root: Node, skip = -1): Node[] => {
    const out: Node[] = [];
    // Neither the partner nor duplicates of it, nor the root's own averaged (mancude) duplicate — keeping that one
    // made every ring double bond of 8+ atoms look tied (review: (E)-cyclooctene, amphotericin's polyene refused).
    for (const k of kids(root)) if (k.atom !== skip && !(k.dup && k.atom === root.atom)) out.push(k);
    return out;
  };

  /** The cross-check pass: the same ligands ranked with every conjugated ring's bonds averaged. */
  const rankAveraged = (make: () => Node[]): Node[] | null => {
    averageConjugatedRings = true;
    try {
      return rank(make());
    } finally {
      averageConjugatedRings = false;
    }
  };
  const sig = (k: Node): string => (k.atom >= 0 ? String(k.atom) : k.z === 1 ? "H" : "lp");
  const sameOrder = (p: Node[] | null, q: Node[] | null): boolean => !!p && !!q && p.map(sig).join() === q.map(sig).join();

  const centres: CipCentre[] = [];
  const refuse = (c: Omit<CipCentre, "label" | "reason">, reason: string): void => void centres.push({ ...c, label: null, reason });

  // ---- cumulenes ----
  // OpenChemLib reports no stereo on a cumulene of three or more double bonds, so an odd one's cis/trans (C=C=C=C) and
  // an even one's axial chirality beyond the allene would be dropped silently — and a name would carry a prefix as if
  // complete (review). Each such chain with two different substituents at both ends is refused by name.
  {
    const centreOfCumulene = (x: number): boolean => {
      let doubles = 0;
      for (let i = 0; i < mol.getConnAtoms(x); i++) if (mol.getBondOrder(mol.getConnBond(x, i)) === 2) doubles++;
      return doubles === 2 && mol.getConnAtoms(x) === 2;
    };
    const distinctEnd = (x: number, inner: number): boolean => {
      const subs: number[] = [];
      for (let i = 0; i < mol.getAllConnAtoms(x); i++) if (mol.getConnAtom(x, i) !== inner) subs.push(mol.getConnAtom(x, i));
      const h = mol.getImplicitHydrogens(x);
      if (subs.length + h !== 2) return false;
      if (subs.length === 2) return !sameConstitution(subs);
      return subs.length === 1 && h === 1 && mol.getAtomicNo(subs[0]) !== 1;
    };
    for (let b = 0; b < mol.getBonds(); b++) {
      if (mol.getBondOrder(b) !== 2) continue;
      for (const [x, y] of [[mol.getBondAtom(0, b), mol.getBondAtom(1, b)], [mol.getBondAtom(1, b), mol.getBondAtom(0, b)]]) {
        if (centreOfCumulene(x) || !centreOfCumulene(y)) continue;
        // Walk the chain from end x through cumulated centres to the other end.
        let prev = x, cur = y, k = 1;
        while (centreOfCumulene(cur)) {
          let nxt = -1;
          for (let i = 0; i < mol.getConnAtoms(cur); i++) if (mol.getConnAtom(cur, i) !== prev) nxt = mol.getConnAtom(cur, i);
          if (nxt < 0 || ++k > 20) break;
          prev = cur;
          cur = nxt;
        }
        if (k < 3 || callerIndex(x) > callerIndex(cur) || !distinctEnd(x, y) || !distinctEnd(cur, prev)) continue;
        centres.push({ kind: "bond", atom: callerIndex(x), atom2: callerIndex(cur), label: null, reason: k % 2 ? "a cumulene's cis/trans (cumulated double bonds) is not given yet" : "axial chirality (a cumulene) — its M/P descriptor is not given yet" });
      }
    }
  }

  // ---- stereocentres ----
  for (let a = 0; a < mol.getAtoms(); a++) {
    const parity = mol.getAtomParity(a);
    if (parity === Molecule.cAtomParityNone) continue;
    const at = { kind: "atom" as const, atom: callerIndex(a) };
    // An allene's centre: a carbon with two double bonds (a sulfoximine's S has two too, and is an ordinary centre).
    if (mol.getAtomicNo(a) === 6 && mol.getAtomPi(a) === 2) {
      refuse(at, "axial chirality (an allene) — its M/P descriptor is not given yet");
      continue;
    }
    if (parity === Molecule.cAtomParityUnknown) {
      refuse(at, "unspecified — drawn without a wedge");
      continue;
    }
    if (mol.isAtomParityPseudo(a)) {
      refuse(at, "pseudo-asymmetric (r/s) — needs CIP rules 4–5, not given yet");
      continue;
    }
    try {
      // The ligands, fresh for each pass: neighbours (any multiple bond adds no ligand at a stereocentre), implicit H,
      // and a lone pair.
      const centreLigands = (): Node[] => {
        const root = rootOf(a);
        const out: Node[] = [];
        for (let i = 0; i < mol.getAllConnAtoms(a); i++) {
          const nb = mol.getConnAtom(a, i);
          const path = new Set(root.path);
          path.add(nb);
          out.push({ atom: nb, z: mol.getAtomicNo(nb), mass: massOf(nb), dup: false, rd: 1, depth: 1, parent: root, path });
        }
        for (let h = 0; h < mol.getImplicitHydrogens(a); h++) out.push({ atom: -1, z: 1, mass: hWeight, dup: false, rd: 1, depth: 1, parent: root, path: root.path, kids: [] });
        if (out.length === 3) out.push(phantom(root));
        return out;
      };
      const ligs = centreLigands();
      if (ligs.length !== 4) {
        refuse(at, `a centre with ${ligs.length} ligands has no R/S here`);
        continue;
      }
      // A degenerate drawing — two neighbours on top of each other, or pointing the same way — gives no reliable
      // parity (review: butan-2-ol with O and C3 at one point was labelled; a bridged steroid's bridgehead read wrong).
      // Only for a drawing: from text (SMILES, an idcode) the stereo comes from the text, not the generated layout
      // (review round 2: bridged steroids from SMILES lost right labels). In 3D the z coordinate counts.
      if (!opts.fromText && laidOut) {
        const d = (k: Node): [number, number, number] => [mol.getAtomX(k.atom) - mol.getAtomX(a), mol.getAtomY(k.atom) - mol.getAtomY(a), mol.getAtomZ(k.atom) - mol.getAtomZ(a)];
        const real = ligs.filter((k) => k.atom >= 0).map(d);
        const len = (v: number[]): number => Math.hypot(v[0], v[1], v[2]);
        const avg = mol.getAverageBondLength(true) || 1;
        let degenerate = real.some((v) => len(v) < avg * 0.1);
        for (let i = 0; i < real.length && !degenerate; i++)
          for (let j = i + 1; j < real.length && !degenerate; j++) {
            const p = real[i], q = real[j];
            const cos = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (len(p) * len(q));
            if (cos > Math.cos((8 * Math.PI) / 180) || len([p[0] - q[0], p[1] - q[1], p[2] - q[2]]) < avg * 0.1) degenerate = true;
          }
        if (degenerate) {
          refuse(at, "the drawing is degenerate here (two neighbours on top of each other or in one direction) — not given");
          continue;
        }
      }
      if (sameConstitution(ligs.map((k) => k.atom))) {
        refuse(at, "two ligands are constitutionally the same — pseudo-asymmetric or like/unlike (needs CIP rules 3–5), not given");
        continue;
      }
      const ranked = rank(ligs);
      if (!ranked) {
        refuse(at, "undecided — two ligands tie on CIP rules 1–2 (needs rules 3–5)");
        continue;
      }
      if (!sameOrder(ranked, rankAveraged(centreLigands))) {
        refuse(at, "the ranking depends on where the ring's double bonds are drawn — not given");
        continue;
      }
      // OpenChemLib's parity: highest atom index (implicit H, or the lone pair, counted highest) to the back; the
      // other three in ascending index clockwise → 1. Our label: that chirality times the sign of the permutation
      // from index order to priority order.
      const idx = (k: Node): number => (k.atom < 0 ? Number.MAX_SAFE_INTEGER - (k.z === 1 ? 0 : 1) : k.atom);
      const byIndex = [...ligs].sort((p, q) => idx(p) - idx(q));
      const perm = ranked.map((k) => byIndex.indexOf(k));
      let inversions = 0;
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (perm[i] > perm[j]) inversions++;
      const clockwiseByIndex = parity === Molecule.cAtomParity1;
      const isR = clockwiseByIndex === (inversions % 2 === 0);
      const ours: CipLabel = isR ? "R" : "S";
      const ocl = mol.getAtomCIPParity(a);
      const theirs = ocl === Molecule.cAtomCIPParityRorM ? "R" : ocl === Molecule.cAtomCIPParitySorP ? "S" : null;
      if (theirs !== ours) refuse(at, theirs ? `the two rankings disagree (${ours} / ${theirs}) — not given` : "OpenChemLib gives no descriptor here — not given");
      else centres.push({ ...at, label: ours, reason: null, ...(ligs.some((k) => k.atom < 0 && k.z === 0) ? { lonePair: true } : {}) });
    } catch (e) {
      if (e instanceof BudgetExceeded) refuse(at, "too complex to decide here (the ranking exceeded its work limit)");
      else if (e instanceof IsotopeUnsure) refuse(at, "isotope ranking between a labelled and an unlabelled atom of one element — not given");
      else throw e;
    }
  }

  // ---- double bonds (and axial bonds) ----
  for (let b = 0; b < mol.getBonds(); b++) {
    const parity = mol.getBondParity(b);
    if (parity === Molecule.cBondParityNone) continue;
    const a1 = mol.getBondAtom(0, b), a2 = mol.getBondAtom(1, b);
    const at = { kind: "bond" as const, atom: callerIndex(a1), atom2: callerIndex(a2) };
    if (mol.getBondOrder(b) !== 2) {
      refuse(at, "axial chirality (a hindered biaryl) — its M/P descriptor is not given yet");
      continue;
    }
    if (mol.isRingBond(b) && mol.getBondRingSize(b) < 8) continue; // fixed by the ring: no E/Z
    if (opts.fromText && mol.isRingBond(b)) {
      refuse(at, "E/Z in a large ring typed as text — SMILES readers misread these; draw the structure to have it given");
      continue;
    }
    if (parity === Molecule.cBondParityUnknown) {
      refuse(at, "unspecified — the double bond's geometry is not drawn");
      continue;
    }
    try {
      const top: Array<{ node: Node; flip: boolean } | null> = [];
      for (const [x, y] of [[a1, a2], [a2, a1]]) {
        const root = rootOf(x);
        const ligs = ligands(root, y).filter((k) => !(k.atom === y));
        if (ligs.length === 1) ligs.push(phantom(root));
        if (sameConstitution(ligs.slice(0, 2).map((k) => k.atom))) {
          top.push(null);
          continue;
        }
        const ranked = rank(ligs.slice(0, 2));
        const endLigands = (): Node[] => {
          const r = rootOf(x);
          const l = ligands(r, y).filter((k) => !(k.atom === y));
          if (l.length === 1) l.push(phantom(r));
          return l.slice(0, 2);
        };
        if (!ranked || !sameOrder(ranked, rankAveraged(endLigands))) {
          top.push(null);
          continue;
        }
        // Geometry from the drawn coordinates needs a real atom: a top-ranked hydrogen or lone pair → use the other, flipped.
        const real = ranked.find((k) => k.atom >= 0);
        top.push(real ? { node: real, flip: real !== ranked[0] } : null);
      }
      if (!top[0] || !top[1]) {
        refuse(at, "undecided — the ligands at one end tie on CIP rules 1–2 (needs rules 3–5)");
        continue;
      }
      const ax = mol.getAtomX(a1), ay = mol.getAtomY(a1), bx = mol.getAtomX(a2), by = mol.getAtomY(a2);
      const side = (p: number, ox: number, oy: number): number => Math.sign((bx - ax) * (mol.getAtomY(p) - oy) - (by - ay) * (mol.getAtomX(p) - ox));
      const s1 = side(top[0].node.atom, ax, ay), s2 = side(top[1].node.atom, bx, by);
      if (!s1 || !s2) {
        refuse(at, "unspecified — a substituent is drawn in line with the double bond");
        continue;
      }
      const cis = (s1 === s2) !== (top[0].flip !== top[1].flip);
      const ours: CipLabel = cis ? "Z" : "E";
      const ocl = mol.getBondCIPParity(b);
      const theirs = ocl === Molecule.cBondCIPParityEorP ? "E" : ocl === Molecule.cBondCIPParityZorM ? "Z" : null;
      if (theirs !== ours) refuse(at, theirs ? `the two rankings disagree (${ours} / ${theirs}) — not given` : "OpenChemLib gives no descriptor here — not given");
      else centres.push({ ...at, label: ours, reason: null });
    } catch (e) {
      if (e instanceof BudgetExceeded) refuse(at, "too complex to decide here (the ranking exceeded its work limit)");
      else if (e instanceof IsotopeUnsure) refuse(at, "isotope ranking between a labelled and an unlabelled atom of one element — not given");
      else throw e;
    }
  }

  return { centres };
}
