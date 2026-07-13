// Programmatic molecule building: turn a pasted molfile or a typed atom/bond
// list into a rendered 2D structure (plus derived SMILES and molecular formula),
// entirely offline via OpenChemLib. No drawing canvas — this is for importing or
// hand-specifying a structure.
//
// Atom/bond list format (case-insensitive keywords):
//
//   atoms: C C O          # element symbols, 1-indexed in listed order
//   bonds: 1-2 2=3        # i-j single, i=j double, i#j triple, i~j undefined/any
//
// Atoms may carry a charge: e.g. `N+`, `O-`, `Fe2+`, `O2-`. Implicit hydrogens
// are filled in automatically from valence, so you usually only list heavy atoms.
//
// Generic / Markush atoms make a generic (query) structure:
//   [C,N]   a variable position that may be any of the listed elements
//   X       halogen (F/Cl/Br/I)
//   A       any atom
//   Q       any heteroatom (not carbon)
//   R, R1…  an R-group / substituent attachment point
// e.g. a six-membered aromatic ring with one `[C,N]` atom is the genus that
// encompasses benzene (C) and pyridine (N):
//   atoms: [C,N] C C C C C
//   bonds: 1=2 2-3 3=4 4-5 5=6 6-1
//
// Query features (a trailing `{…}` block) constrain a position for a rigorous
// Markush genus — atoms: `{ar}` aromatic, `{!ar}` aliphatic, `{har}` hetero-
// aromatic, `{ring}` in-ring, `{!ring}`/`{chain}` not-in-ring, `{r5}`/`{r6}`…
// ring size (list several for "5 or 6"), `{sub}` bears a further substituent,
// `{nosub}` no further substitution. Bonds: `{ring}`, `{chain}`, `{ar}`.
// e.g. a benzene ring whose position 1 must stay aromatic and unsubstituted:
//   atoms: C{ar,nosub} C C C C C
//   bonds: 1=2 2-3 3=4 4-5 5=6 6-1
//
// Stereo bonds in a build: `i>j` wedge (up), `i<j` hash (down). For precise
// stereochemistry, prefer entering an isomeric SMILES in Chemical mode (@/@@,
// /\), which is depicted with wedges automatically.
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
  /** OpenChemLib canonical ID code — a deterministic structure fingerprint for provenance. */
  idcode: string;
  /** Relative molecular weight (0 for generic structures). */
  mw: number;
  /** Distinct R-group labels present (e.g. ["R1","R2"]), for a definition legend. */
  rgroups: string[];
}

/** Single-letter Markush shorthands that expand to an atom list. */
const SHORTHANDS: Record<string, string[]> = {
  X: ["F", "Cl", "Br", "I"], // halogen
};

export type BuildFormat = "auto" | "atombond" | "molfile";

const BOND_ORDER: Record<string, number> = { "-": 1, "=": 2, "#": 3 };

// Atom query-feature tokens (in a trailing `{…}` block) → OpenChemLib constant
// name. These encode a rigorous Markush genus: aromaticity, ring membership,
// ring size, and open/closed substitution at a position.
const ATOM_QF: Record<string, string> = {
  ar: "cAtomQFAromatic", // aromatic
  "!ar": "cAtomQFNotAromatic", // aliphatic (non-aromatic)
  al: "cAtomQFNotAromatic",
  har: "cAtomQFHeteroAromatic", // hetero-aromatic
  ring: "cAtomQFNotChain", // must be in a ring
  "!ring": "cAtomQFRingSize0", // must not be in any ring (chain)
  chain: "cAtomQFRingSize0",
  sub: "cAtomQFMoreNeighbours", // bears at least one further substituent
  nosub: "cAtomQFNoMoreNeighbours", // no further substitution (closed position)
  r3: "cAtomQFRingSize3",
  r4: "cAtomQFRingSize4",
  r5: "cAtomQFRingSize5",
  r6: "cAtomQFRingSize6",
  r7: "cAtomQFRingSize7",
};

// Bond query-feature tokens → OpenChemLib constant name.
const BOND_QF: Record<string, string> = {
  ring: "cBondQFRing",
  chain: "cBondQFNotRing",
  ar: "cBondQFAromatic",
  "!ar": "cBondQFNotAromatic",
};

interface ParsedAtom {
  symbols: string[]; // one element, or several for a query atom list ([C,N])
  charge: number;
  any?: boolean; // A — any atom
  excludeC?: boolean; // Q — any heteroatom (not carbon)
  rlabel?: string; // R / R1 / R2 … — R-group label
  query?: string[]; // query-feature tokens from a {…} block (ar, ring, r6, nosub…)
}
interface ParsedBond {
  a: number;
  b: number;
  order: number;
  any?: boolean; // undefined/any bond (~) — makes a generic query structure
  stereo?: "up" | "down"; // wedge (>) or hash (<)
  query?: string[]; // bond query-feature tokens (ring, chain, ar)
}

/** Splits an atoms line on whitespace/commas, but not inside [...] or {...}. */
function splitAtomTokens(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let brack = 0;
  let brace = 0;
  for (const ch of s) {
    if (ch === "[") brack++;
    else if (ch === "]") brack = Math.max(0, brack - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    if ((ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") && brack === 0 && brace === 0) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Pulls a trailing `{a,b,c}` query block off a token, returning the rest + features. */
function extractQuery(token: string, kind: "atom" | "bond"): { rest: string; query?: string[] } {
  const m = /\{([^}]*)\}/.exec(token);
  if (!m) return { rest: token };
  const feats = m[1].split(/[,\s]+/).filter(Boolean);
  const table = kind === "atom" ? ATOM_QF : BOND_QF;
  for (const f of feats) {
    if (!table[f.toLowerCase()]) {
      throw new Error(`Unknown ${kind} query feature "${f}" in "${token}".`);
    }
  }
  const rest = token.replace(/\{[^}]*\}/, "");
  if (/[{}]/.test(rest)) {
    throw new Error(`Malformed query block in "${token}" — use a single {…} with comma-separated features.`);
  }
  return { rest, query: feats.map((f) => f.toLowerCase()) };
}

/** Parses the atom/bond list DSL into atoms and bonds. Throws on malformed input. */
export function parseAtomBondList(text: string): { atoms: ParsedAtom[]; bonds: ParsedBond[] } {
  const atomsMatch = /atoms?\s*:\s*([\s\S]*?)(?:bonds?\s*:|$)/i.exec(text);
  if (!atomsMatch) throw new Error('Expected an "atoms:" line, e.g. "atoms: C C O".');

  // Tokenize atoms, keeping bracketed lists like [C,N] and query blocks like
  // C{ar,r6} together (commas inside [] or {} must not split the token).
  const atomTokens = splitAtomTokens(atomsMatch[1].trim());
  if (atomTokens.length === 0) throw new Error("No atoms listed after \"atoms:\".");
  const atoms = atomTokens.map(parseAtomToken);

  const bonds: ParsedBond[] = [];
  const bondsMatch = /bonds?\s*:\s*([\s\S]*)$/i.exec(text);
  if (bondsMatch) {
    const bondTokens = bondsMatch[1].trim().split(/[\s,]+/).filter(Boolean);
    for (const token of bondTokens) {
      const { rest, query } = extractQuery(token, "bond");
      const m = /^(\d+)([-=#~><])(\d+)$/.exec(rest);
      if (!m) throw new Error(`Could not parse bond "${token}" — use e.g. 1-2, 2=3, 1#2, 1~2, 1>2, 1<2.`);
      const a = parseInt(m[1], 10);
      const b = parseInt(m[3], 10);
      if (a < 1 || a > atoms.length || b < 1 || b > atoms.length) {
        throw new Error(`Bond "${token}" refers to an atom number outside 1–${atoms.length}.`);
      }
      const op = m[2];
      if (op === "~") {
        bonds.push({ a, b, order: 1, any: true, query });
      } else if (op === ">") {
        bonds.push({ a, b, order: 1, stereo: "up", query });
      } else if (op === "<") {
        bonds.push({ a, b, order: 1, stereo: "down", query });
      } else {
        bonds.push({ a, b, order: BOND_ORDER[op], query });
      }
    }
  }
  return { atoms, bonds };
}

function parseAtomToken(rawToken: string): ParsedAtom {
  // Pull off any trailing {…} query block first, then parse the element part.
  const { rest: token, query } = extractQuery(rawToken, "atom");

  // Query atom list: [C,N] or [N,O,S] with optional trailing charge.
  if (token.startsWith("[")) {
    const m = /^\[([^\]]*)\](.*)$/.exec(token);
    if (!m) throw new Error(`Could not parse atom list "${rawToken}" — use e.g. [C,N].`);
    const symbols = m[1].split(/[,\s]+/).filter(Boolean);
    if (symbols.length === 0) throw new Error(`Empty atom list "${rawToken}".`);
    for (const s of symbols) {
      if (!/^[A-Z][a-z]?$/.test(s)) throw new Error(`Invalid element "${s}" in "${rawToken}".`);
    }
    return { symbols, charge: parseCharge(m[2]), query };
  }
  const m = /^([A-Z][a-z]?)(.*)$/.exec(token);
  if (!m) throw new Error(`Could not parse atom "${rawToken}".`);
  const head = m[1];
  const rest = m[2];

  // Markush shorthands (only when the token is exactly the shorthand, so real
  // elements like Ar, Al, Rb, Ru are unaffected).
  if (head === "R") return { symbols: ["C"], charge: 0, rlabel: "R" + rest, query }; // R, R1, R2…
  if (token === "A") return { symbols: ["C"], charge: 0, any: true, query }; // any atom
  if (token === "Q") return { symbols: ["N"], charge: 0, excludeC: true, query }; // any heteroatom
  const shorthand = SHORTHANDS[head];
  if (shorthand) return { symbols: shorthand, charge: parseCharge(rest), query }; // X = halogen

  return { symbols: [head], charge: parseCharge(rest), query };
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

/** Resolves an OpenChemLib query-feature constant by name (throws if absent). */
function qfFlag(constName: string): number {
  const v = (Molecule as unknown as Record<string, unknown>)[constName];
  if (typeof v !== "number") throw new Error(`Query feature ${constName} is not supported by this OpenChemLib build.`);
  return v;
}

export function buildFromAtomBondList(text: string, width = 300, height = 230): BuildResult {
  const { atoms, bonds } = parseAtomBondList(text);
  const mol = new Molecule(atoms.length, bonds.length);

  // Atom lists, query atoms (A/Q), R-groups, query features, or an undefined/
  // query bond make this a generic (query) structure.
  const hasQuery =
    atoms.some((a) => a.symbols.length > 1 || a.any || a.excludeC || a.rlabel || a.query?.length) ||
    bonds.some((b) => b.any || b.query?.length);
  if (hasQuery) mol.setFragment(true);

  const indices = atoms.map((atom) => {
    const nums = atom.symbols.map((s) => {
      const n = Molecule.getAtomicNoFromLabel(s);
      if (!n) throw new Error(`Unknown element symbol "${s}".`);
      return n;
    });
    const idx = mol.addAtom(nums[0]);
    if (atom.charge) mol.setAtomCharge(idx, atom.charge);
    if (atom.rlabel) {
      mol.setAtomCustomLabel(idx, atom.rlabel); // R-group attachment point
    } else if (atom.any) {
      mol.setAtomQueryFeature(idx, Molecule.cAtomQFAny, true); // A — any atom
    } else if (atom.excludeC) {
      mol.setAtomList(idx, [6], true); // Q — any heteroatom (exclude carbon)
    } else if (nums.length > 1) {
      mol.setAtomList(idx, nums, false); // [C,N] / X — inclusion list
    }
    for (const f of atom.query ?? []) {
      mol.setAtomQueryFeature(idx, qfFlag(ATOM_QF[f]), true);
    }
    return idx;
  });

  for (const bond of bonds) {
    const b = mol.addBond(indices[bond.a - 1], indices[bond.b - 1]);
    if (bond.any) {
      mol.setBondQueryFeature(b, Molecule.cBondQFBondTypes, true); // ~ undefined/any bond
    } else if (bond.stereo === "up") {
      mol.setBondType(b, Molecule.cBondTypeUp); // wedge
    } else if (bond.stereo === "down") {
      mol.setBondType(b, Molecule.cBondTypeDown); // hash
    } else {
      mol.setBondOrder(b, bond.order);
    }
    for (const f of bond.query ?? []) {
      mol.setBondQueryFeature(b, qfFlag(BOND_QF[f]), true);
    }
  }

  const rgroups = uniqueSorted(atoms.map((a) => a.rlabel).filter((l): l is string => !!l));
  return finish(mol, width, height, true, rgroups);
}

function uniqueSorted(values: string[]): string[] {
  const set: Record<string, true> = {};
  for (const v of values) set[v] = true;
  return Object.keys(set).sort();
}

export function buildFromMolfile(molfile: string, width = 300, height = 230): BuildResult {
  const mol = Molecule.fromMolfile(molfile);
  if (mol.getAllAtoms() === 0) throw new Error("Molfile contains no atoms.");
  // Molfiles carry their own coordinates, so don't reinvent them.
  return finish(mol, width, height, false, []);
}

function finish(mol: Molecule, width: number, height: number, needCoords: boolean, rgroups: string[]): BuildResult {
  if (needCoords) {
    try {
      mol.inventCoordinates();
    } catch {
      // ignore — depiction will still attempt layout
    }
  }
  // autoCrop removes OpenChemLib's wide empty margins, keeping the structure at
  // its natural drawn size with the surrounding whitespace trimmed. The stereo
  // R/S/"abs" text tags are suppressed (wedge bonds already show configuration;
  // the tags clutter dense structures) — query/R-group labels are unaffected.
  const svg = mol.toSVG(width, height, undefined, {
    autoCrop: true,
    autoCropMargin: 8,
    suppressChiralText: true,
    suppressCIPParity: true,
    suppressESR: true,
  });
  const generic = mol.isFragment();
  let smiles = "";
  try {
    smiles = mol.toIsomericSmiles();
  } catch {
    try {
      smiles = mol.toSmiles();
    } catch {
      /* leave blank */
    }
  }
  let idcode = "";
  try {
    idcode = mol.getIDCode();
  } catch {
    /* leave blank */
  }
  let formula = "";
  let mw = 0;
  if (generic) {
    // A molecular formula / weight isn't well-defined for a generic structure.
    formula = "generic structure";
  } else {
    try {
      const mf = mol.getMolecularFormula();
      formula = mf.formula;
      mw = Math.round(mf.relativeWeight * 100) / 100;
    } catch {
      /* leave blank */
    }
  }
  return { svg, smiles, formula, generic, idcode, mw, rgroups };
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
