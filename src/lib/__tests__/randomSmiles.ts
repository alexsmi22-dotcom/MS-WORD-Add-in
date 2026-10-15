// Test helper (not a test): the same molecule written in a random atom order.
//
// Written from OpenChemLib's own graph. Every atom is bracketed with its
// explicit H count, charge and isotope, so no valence is left for the parser to
// guess; aromatic atoms are lowercase and aromatic bonds implicit (OCL's Kekulé
// bond orders are not trusted); stereo is DROPPED. The DFS start and neighbour
// order come from a seeded PRNG, so any failure is reproducible from its seed.
//
// Used by uvEnoneArms.test.ts and diastereotopic.test.ts to pin that an answer
// is a property of the molecule, not of how its SMILES happens to be written.

import { Molecule } from "openchemlib";

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function atomText(mol: Molecule, a: number): string {
  const arom = mol.isAromaticAtom(a);
  const label = mol.getAtomLabel(a);
  const sym = arom ? label.toLowerCase() : label;
  const h = mol.getAllHydrogens(a);
  const q = mol.getAtomCharge(a);
  const mass = mol.getAtomMass(a);
  const hs = h === 0 ? "" : h === 1 ? "H" : `H${h}`;
  const qs = q === 0 ? "" : q > 0 ? (q === 1 ? "+" : `+${q}`) : q === -1 ? "-" : `${q}`;
  return `[${mass ? mass : ""}${sym}${hs}${qs}]`;
}

function bondText(mol: Molecule, b: number): string {
  if (mol.isAromaticBond(b)) return "";
  const o = mol.getBondOrder(b);
  if (o === 2) return "=";
  if (o === 3) return "#";
  // A single bond between two aromatic atoms (biphenyl) must be explicit.
  return mol.isAromaticAtom(mol.getBondAtom(0, b)) && mol.isAromaticAtom(mol.getBondAtom(1, b)) ? "-" : "";
}

export function randomSmiles(input: string, seed: number): string {
  const mol = Molecule.fromSmiles(input);
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const rnd = prng(seed);
  const n = mol.getAllAtoms();
  const order: number[][] = [];
  for (let a = 0; a < n; a++) {
    const nbs: number[] = [];
    for (let i = 0; i < mol.getAllConnAtoms(a); i++) nbs.push(i);
    order.push(shuffle(nbs, rnd));
  }
  // Pass 1: the DFS tree, in the shuffled order.
  const seen = new Array<boolean>(n).fill(false);
  const treeBond = new Set<number>();
  const start = Math.floor(rnd() * n);
  const roots: number[] = [];
  const visit = (a: number): void => {
    seen[a] = true;
    for (const i of order[a]) {
      const nb = mol.getConnAtom(a, i);
      if (seen[nb]) continue;
      treeBond.add(mol.getConnBond(a, i));
      visit(nb);
    }
  };
  for (const a of [start, ...Array.from({ length: n }, (_, i) => i)]) {
    if (seen[a]) continue;
    roots.push(a);
    visit(a);
  }
  // Pass 2: write in the same order. A ring-closure digit opens at the first
  // atom of a back edge reached and closes at the second.
  const open = new Map<number, number>();
  const free: number[] = [];
  let next = 1;
  const written = new Array<boolean>(n).fill(false);
  const digit = (d: number) => (d < 10 ? String(d) : `%${d}`);
  const write = (a: number): string => {
    written[a] = true;
    let s = atomText(mol, a);
    for (const i of order[a]) {
      const b = mol.getConnBond(a, i);
      if (treeBond.has(b)) continue;
      if (open.has(b)) {
        const d = open.get(b)!;
        open.delete(b);
        free.push(d);
        s += digit(d);
      } else {
        const d = free.length ? free.shift()! : next++;
        open.set(b, d);
        s += bondText(mol, b) + digit(d);
      }
    }
    const kids = order[a]
      .map((i) => ({ nb: mol.getConnAtom(a, i), b: mol.getConnBond(a, i) }))
      .filter((k) => treeBond.has(k.b) && !written[k.nb]);
    kids.forEach((k, idx) => {
      const branch = bondText(mol, k.b) + write(k.nb);
      s += idx < kids.length - 1 ? `(${branch})` : branch;
    });
    return s;
  };
  return roots.map((r) => write(r)).join(".");
}

/** idcode of the molecule with stereo removed — the round-trip oracle. */
export function stereoFreeIdcode(smiles: string): string {
  return Molecule.fromSmiles(smiles.replace(/[@/\\]/g, "")).getIDCode();
}
