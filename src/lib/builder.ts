// Programmatic molecule building: turn a pasted molfile or a typed atom/bond
// list into a rendered 2D structure (plus derived SMILES and molecular formula),
// entirely offline via OpenChemLib. No drawing canvas — this is for importing or
// hand-specifying a structure.
//
// Atom/bond list format (case-insensitive keywords):
//
//   atoms: C C O          # element symbols, 1-indexed in listed order
//   bonds: 1-2 2=3        # i-j single, i=j double, i#j triple
//
// Atoms may carry a charge: e.g. `N+`, `O-`, `Fe2+`, `O2-`. Implicit hydrogens
// are filled in automatically from valence, so you usually only list heavy atoms.
//
// Generic / Markush atoms: a bracketed list `[C,N]` marks a variable position
// that may be any of the listed elements. This produces a generic (query)
// structure — e.g. a six-membered aromatic ring with one `[C,N]` atom is the
// genus that encompasses benzene (C) and pyridine (N):
//
//   atoms: [C,N] C C C C C
//   bonds: 1=2 2-3 3=4 4-5 5=6 6-1
//
// Molfile format: any standard MDL V2000/V3000 molfile (e.g. exported from
// another tool) is parsed directly.

import { Molecule } from "openchemlib";

export interface BuildResult {
  svg: string;
  smiles: string;
  formula: string;
  /** True when the structure is generic (contains a query/atom-list position). */
  generic: boolean;
}

export type BuildFormat = "auto" | "atombond" | "molfile";

const BOND_ORDER: Record<string, number> = { "-": 1, "=": 2, "#": 3 };

interface ParsedAtom {
  symbols: string[]; // one element, or several for a query atom list ([C,N])
  charge: number;
}
interface ParsedBond {
  a: number;
  b: number;
  order: number;
}

/** Parses the atom/bond list DSL into atoms and bonds. Throws on malformed input. */
export function parseAtomBondList(text: string): { atoms: ParsedAtom[]; bonds: ParsedBond[] } {
  const atomsMatch = /atoms?\s*:\s*([\s\S]*?)(?:bonds?\s*:|$)/i.exec(text);
  if (!atomsMatch) throw new Error('Expected an "atoms:" line, e.g. "atoms: C C O".');

  // Tokenize atoms, keeping bracketed lists like [C,N] together (commas inside
  // brackets must not split the token).
  const atomTokens = atomsMatch[1].trim().match(/\[[^\]]*\][^\s,]*|[^\s,]+/g) ?? [];
  if (atomTokens.length === 0) throw new Error("No atoms listed after \"atoms:\".");
  const atoms = atomTokens.map(parseAtomToken);

  const bonds: ParsedBond[] = [];
  const bondsMatch = /bonds?\s*:\s*([\s\S]*)$/i.exec(text);
  if (bondsMatch) {
    const bondTokens = bondsMatch[1].trim().split(/[\s,]+/).filter(Boolean);
    for (const token of bondTokens) {
      const m = /^(\d+)([-=#])(\d+)$/.exec(token);
      if (!m) throw new Error(`Could not parse bond "${token}" — use e.g. 1-2, 2=3, 1#2.`);
      const a = parseInt(m[1], 10);
      const b = parseInt(m[3], 10);
      if (a < 1 || a > atoms.length || b < 1 || b > atoms.length) {
        throw new Error(`Bond "${token}" refers to an atom number outside 1–${atoms.length}.`);
      }
      bonds.push({ a, b, order: BOND_ORDER[m[2]] });
    }
  }
  return { atoms, bonds };
}

function parseAtomToken(token: string): ParsedAtom {
  // Query atom list: [C,N] or [N,O,S] with optional trailing charge.
  if (token.startsWith("[")) {
    const m = /^\[([^\]]*)\](.*)$/.exec(token);
    if (!m) throw new Error(`Could not parse atom list "${token}" — use e.g. [C,N].`);
    const symbols = m[1].split(/[,\s]+/).filter(Boolean);
    if (symbols.length === 0) throw new Error(`Empty atom list "${token}".`);
    for (const s of symbols) {
      if (!/^[A-Z][a-z]?$/.test(s)) throw new Error(`Invalid element "${s}" in "${token}".`);
    }
    return { symbols, charge: parseCharge(m[2]) };
  }
  const m = /^([A-Z][a-z]?)(.*)$/.exec(token);
  if (!m) throw new Error(`Could not parse atom "${token}".`);
  return { symbols: [m[1]], charge: parseCharge(m[2]) };
}

/** Parses a trailing charge such as "+", "--", "2+", "+2", "2-". */
function parseCharge(s: string): number {
  if (!s) return 0;
  const signs = s.match(/[+-]/g);
  if (!signs) return 0;
  const sign = signs[0] === "-" ? -1 : 1;
  const num = s.match(/\d+/);
  return num ? sign * parseInt(num[0], 10) : sign * signs.length;
}

export function buildFromAtomBondList(text: string, width = 300, height = 230): BuildResult {
  const { atoms, bonds } = parseAtomBondList(text);
  const mol = new Molecule(atoms.length, bonds.length);

  // Any atom list makes this a generic (query) structure.
  const hasQuery = atoms.some((a) => a.symbols.length > 1);
  if (hasQuery) mol.setFragment(true);

  const indices = atoms.map((atom) => {
    const nums = atom.symbols.map((s) => {
      const n = Molecule.getAtomicNoFromLabel(s);
      if (!n) throw new Error(`Unknown element symbol "${s}".`);
      return n;
    });
    const idx = mol.addAtom(nums[0]);
    if (atom.charge) mol.setAtomCharge(idx, atom.charge);
    if (nums.length > 1) mol.setAtomList(idx, nums, false); // variable position (inclusion list)
    return idx;
  });

  for (const bond of bonds) {
    const b = mol.addBond(indices[bond.a - 1], indices[bond.b - 1]);
    mol.setBondOrder(b, bond.order);
  }

  return finish(mol, width, height, true);
}

export function buildFromMolfile(molfile: string, width = 300, height = 230): BuildResult {
  const mol = Molecule.fromMolfile(molfile);
  if (mol.getAllAtoms() === 0) throw new Error("Molfile contains no atoms.");
  // Molfiles carry their own coordinates, so don't reinvent them.
  return finish(mol, width, height, false);
}

function finish(mol: Molecule, width: number, height: number, needCoords: boolean): BuildResult {
  if (needCoords) {
    try {
      mol.inventCoordinates();
    } catch {
      // ignore — depiction will still attempt layout
    }
  }
  const svg = mol.toSVG(width, height);
  const generic = mol.isFragment();
  let smiles = "";
  let formula = "";
  try {
    smiles = mol.toSmiles();
  } catch {
    /* leave blank */
  }
  if (generic) {
    // A molecular formula isn't well-defined for a generic structure.
    formula = "generic structure";
  } else {
    try {
      formula = mol.getMolecularFormula().formula;
    } catch {
      /* leave blank */
    }
  }
  return { svg, smiles, formula, generic };
}

/** Heuristic: does this text look like an MDL molfile rather than an atom/bond list? */
export function looksLikeMolfile(text: string): boolean {
  return /\bV[23]000\b/.test(text) || /^M\s+END\s*$/m.test(text);
}

/** Builds a molecule from text, choosing the parser by format (or auto-detecting). */
export function build(text: string, format: BuildFormat, width = 300, height = 230): BuildResult {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to build yet.");
  const useMolfile = format === "molfile" || (format === "auto" && looksLikeMolfile(trimmed));
  return useMolfile ? buildFromMolfile(text, width, height) : buildFromAtomBondList(text, width, height);
}
