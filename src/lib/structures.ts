// Resolves a chemical input to a 2D structure (SVG) using OpenChemLib, entirely
// offline. Input is interpreted in this order:
//   1. a known common name      (e.g. "aspirin", "water")
//   2. a known molecular formula (e.g. "H2O", "C6H6")
//   3. a raw SMILES string       (e.g. "CC(=O)O")
//
// SVG is produced here; converting it to a raster image for insertion into Word
// happens in the task pane (it needs the browser canvas API).

import { Molecule } from "openchemlib";
import { NAME_TO_SMILES, FORMULA_TO_SMILES } from "./compounds";
import { validateFormula, normalizeFormulaText, hillFormula } from "./chemValidate";
import { atomicNumber, elementName } from "./periodic";

export interface StructureResult {
  svg: string;
  smiles: string;
  /** How the input was interpreted — useful for messaging in the UI. */
  source: "name" | "formula" | "smiles";
  /** Molecular formula, OCL canonical ID code, and relative molecular weight (provenance). */
  formula: string;
  idcode: string;
  mw: number;
  /**
   * True when the SMILES carried two attachment points (*): a polymer's repeat unit. formula and mw are then PER
   * REPEAT UNIT (the two * are the bonds to the neighbouring units), never a molecule's.
   */
  repeatUnit?: boolean;
  /** True when one attachment point (*) marks a substituent's bond to its parent (DrawOptions.substituent): formula and mw are the group's. */
  substituent?: boolean;
}

/** Looks up a SMILES for a known name or formula. Returns null if not in the dictionaries. */
export function lookupSmiles(input: string): { smiles: string; source: "name" | "formula" } | null {
  const raw = input.trim();
  if (!raw) return null;

  const byName = NAME_TO_SMILES[raw.toLowerCase()];
  if (byName) return { smiles: byName, source: "name" };

  const byFormula = FORMULA_TO_SMILES[raw.replace(/\s+/g, "")];
  if (byFormula) return { smiles: byFormula, source: "formula" };

  return null;
}

// Reverse index (OCL canonical ID code → preferred dictionary name), built lazily
// once on first lookup. This gives an honest, reliable name for KNOWN compounds —
// it is dictionary-based recognition, not a general algorithmic IUPAC namer.
let idToName: Record<string, string> | null = null;

function reverseIndex(): Record<string, string> {
  if (idToName) return idToName;
  const map: Record<string, string> = {};
  for (const [name, smiles] of Object.entries(NAME_TO_SMILES)) {
    try {
      const mol = Molecule.fromSmiles(smiles);
      if (mol.getAllAtoms() === 0) continue;
      const id = mol.getIDCode();
      if (id && !map[id]) map[id] = name;
    } catch {
      /* skip unparseable dictionary entries */
    }
  }
  idToName = map;
  return map;
}

/** Title-cases the first character (dictionary names are stored lowercase). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Looks up a known compound name for an OCL ID code, or null if not in the dictionary. */
export function nameForIdcode(idcode: string): string | null {
  if (!idcode) return null;
  const name = reverseIndex()[idcode];
  return name ? capitalize(name) : null;
}

/**
 * Resolves a structure (name/formula/SMILES) to a known compound name via the
 * dictionary. Returns null when the structure isn't a recognized compound — this
 * is deliberately not a full IUPAC name generator.
 */
export function nameForStructure(input: string): string | null {
  const r = renderStructure(input);
  return r ? nameForIdcode(r.idcode) : null;
}

function safeFromSmiles(smiles: string): Molecule | null {
  try {
    const mol = Molecule.fromSmiles(smiles);
    return mol.getAllAtoms() > 0 ? mol : null;
  } catch {
    return null;
  }
}

/**
 * A SMILES parse for READING only (validity, formula, charge): no 2D layout. The resolver below never draws the
 * molecules it parses, and laying out a large one is what took minutes (a 5000-atom chain, scheme review).
 * Its idcode carries NO stereo (no coordinates to perceive it from): never name, compare or draw from it.
 */
function parseSmilesOnly(smiles: string): Molecule | null {
  try {
    const mol = Molecule.fromSmiles(smiles, { noCoordinates: true });
    return mol.getAllAtoms() > 0 ? mol : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// THE SMILES GATE (v2.193): validity, attachment points and the drawing cap
// ---------------------------------------------------------------------------
//
// OpenChemLib is a forgiving parser, and each forgiveness was a confident wrong answer:
//   - "C(" (an unclosed branch) parsed as methane;
//   - "CCC(C)(C)(C)C" (a carbon with five bonds) was drawn and given the formula C₇H₁₇;
//     "C[N](C)(C)(C)C" was drawn with a five-bonded neutral nitrogen;
//   - "*" (an attachment point) is read as a QUERY carbon: the molecule turns into a fragment, every atom loses its
//     implicit hydrogens, and "*CC*" came out as C₄;
//   - a long SMILES froze the pane: the default parse already lays the molecule out in 2D, and that layout grows
//     steeply ("C" × 800 took 27 s in the pane, "C" × 3000 over 5 minutes).
// So every SMILES is read FIRST without coordinates (milliseconds even for thousands of atoms), checked, and only
// then — under the heavy-atom cap — parsed for drawing.

/**
 * The heavy-atom cap for a 2D drawing, checked BEFORE any layout. The same 250 as the peptide pane
 * (chembioCalcs.PEPTIDE_DRAW_MAX_HEAVY_ATOMS: ≈ 0.5 s measured in jest at 251 atoms); the largest dictionary compound,
 * tannic acid, has 122 heavy atoms, vancomycin 101.
 */
export const STRUCTURE_DRAW_MAX_HEAVY_ATOMS = 250;

/** Above this, no dictionary name can match (largest entry: 122 heavy atoms), so no idcode is computed for one. */
const DICTIONARY_NAME_MAX_HEAVY_ATOMS = 150;

/** The element OpenChemLib parses in place of an attachment point "*" (oganesson: never in a real input). */
const WILDCARD_SENTINEL_Z = 118;
const WILDCARD_SENTINEL = "[Og]";

/**
 * The SMILES with every attachment point — a bare "*" or a bracket atom whose symbol is * ([*], [1*], [*:1]) —
 * replaced by the sentinel, and how many there were.
 */
function substituteWildcards(smiles: string): { text: string; count: number } {
  let out = "";
  let count = 0;
  for (let i = 0; i < smiles.length; i++) {
    const c = smiles[i];
    if (c === "[") {
      const j = smiles.indexOf("]", i);
      if (j < 0) return { text: out + smiles.slice(i), count };
      const inner = smiles.slice(i + 1, j);
      if (/^\d*\*/.test(inner)) {
        out += WILDCARD_SENTINEL;
        count++;
      } else out += smiles.slice(i, j + 1);
      i = j;
    } else if (c === "*") {
      out += WILDCARD_SENTINEL;
      count++;
    } else out += c;
  }
  return { text: out, count };
}

/** Unbalanced branch parentheses or atom brackets (outside atom brackets), named; or null. */
function bracketProblem(smiles: string): string | null {
  let depth = 0;
  for (let i = 0; i < smiles.length; i++) {
    const c = smiles[i];
    if (c === "[") {
      const j = smiles.indexOf("]", i);
      if (j < 0) return `the atom bracket “[” at position ${i + 1} is never closed`;
      i = j;
    } else if (c === "]") return `the “]” at position ${i + 1} closes no atom bracket`;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return `the “)” at position ${i + 1} closes no branch`;
      depth--;
    }
  }
  return depth ? `${depth} branch${depth === 1 ? "" : "es"} opened with “(” ${depth === 1 ? "is" : "are"} never closed (unbalanced parentheses)` : null;
}

/**
 * An atom of boron, carbon, nitrogen, oxygen or fluorine whose bonds plus hydrogens exceed its valence (charge
 * counted: N⁺ takes 4, C⁻ 3, B⁻ 4), named; or null. Second-row atoms only — they have no expanded octet, so a sixth
 * bond is never a valid structure; S, P, the halogens and the metals have real higher valences and are left to the
 * parser. A bracket atom with an explicit charge ([N+](C)(C)(C)C) is valid and passes.
 */
function valenceProblem(mol: Molecule): string | null {
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    const z = mol.getAtomicNo(i);
    if (z < 5 || z > 9) continue;
    const used = mol.getOccupiedValence(i) + mol.getImplicitHydrogens(i);
    const max = mol.getDefaultMaxValenceUncharged(i) + mol.getElectronValenceCorrection(i, used);
    if (used > max) {
      const q = mol.getAtomCharge(i);
      const charge = q ? ` with charge ${q > 0 ? "+" : "−"}${Math.abs(q) === 1 ? "" : Math.abs(q)}` : "";
      return `atom ${i + 1} (${mol.getAtomLabel(i)}${charge}) has ${used} bonds, above its valence of ${max} (abnormal valence)`;
    }
  }
  return null;
}

/** Heavy (non-hydrogen, non-attachment-point) atoms of a parsed molecule. */
function heavyAtomCount(mol: Molecule): number {
  let n = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    const z = mol.getAtomicNo(i);
    if (z !== 1 && z !== WILDCARD_SENTINEL_Z) n++;
  }
  return n;
}

export type SmilesCheck =
  | {
      ok: true;
      /** The SMILES with attachment points replaced by the sentinel — what is parsed. */
      parsed: string;
      /** The coordinate-free molecule (attachment points as the sentinel element). */
      mol: Molecule;
      /** Attachment points (*) in the input. */
      wildcards: number;
      heavyAtoms: number;
    }
  /** invalid: OpenChemLib would have accepted it, but it is not valid SMILES (brackets, valence). */
  | { ok: false; message: string; invalid?: boolean };

/**
 * The SMILES text as OpenChemLib is given it: aromatic selenium and tellurium ([se], [te]: selenophene c1cc[se]c1)
 * are valid SMILES that OpenChemLib does not read; written as [Se] / [Te] the ring's aromatic carbons kekulise around
 * them to the same molecule.
 */
function oclSmilesText(text: string): string {
  return text.replace(/\[(\d*)(se|te)(?=[^a-z])/g, (_m, iso: string, el: string) => `[${iso}${el === "se" ? "Se" : "Te"}`);
}

function radicalCount(mol: Molecule): number {
  let n = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomRadical(i)) n++;
  return n;
}

/**
 * Reads a SMILES WITHOUT 2D layout and checks it: balanced brackets, a parse, second-row valences. Attachment
 * points are counted, not judged — what they mean is the caller's (a repeat unit for Structure, a refusal for a
 * mass). Returns the coordinate-free molecule for reading counts; never draw from it.
 */
export function checkSmiles(smiles: string): SmilesCheck {
  const s = smiles.trim();
  if (!s) return { ok: false, message: "Type a SMILES string." };
  const br = bracketProblem(s);
  if (br) return { ok: false, message: `“${s}” is not valid SMILES: ${br}.`, invalid: true };
  const sub = substituteWildcards(s);
  if (sub.count && /\[\d*Og/.test(s)) return { ok: false, message: `“${s}” mixes attachment points (*) with oganesson, which this tool does not read.` };
  let parsed = oclSmilesText(sub.text);
  // An unclosed ring bond ("C1CC"): RDKit refuses it; OpenChemLib cannot read it either, and the string fell through to
  // the FORMULA reading "carbon, C₃". Said as a SMILES error where the string is written as SMILES (no bare H — a
  // formula's "C7H8O2" digits are counts, not ring bonds) and reads once the open labels are taken out.
  const ring = unclosedRing(s);
  if (ring && !readsAsFormula(s) && /^[BCNOPSFIbcnops]*$/.test(s.replace(/\[[^\]]*\]|Cl|Br/g, "").replace(/[^A-Za-z]/g, ""))) {
    if (parseSmilesOnly(parsed.replace(/%\d\d|\d(?![^[]*\])/g, ""))) return { ok: false, message: `“${s}” is not valid SMILES: ring bond ${ring} is opened but never closed (each ring-closure digit must appear twice).`, invalid: true };
  }
  let mol = parseSmilesOnly(parsed);
  if (!mol) return { ok: false, message: `“${s}” is not a SMILES string this tool can read.` };
  const v = valenceProblem(mol);
  if (v) return { ok: false, message: `“${s}” is not a valid structure: ${v}.`, invalid: true };
  // OpenChemLib's radical flag alone is not a refusal: its aromaticity resolver gives up on some systems that DO have
  // a Kekulé form (porphine, tetraphenylporphyrin, phthalocyanine, heme as RDKit writes it). A real Kekulé matching
  // over the SMILES's own aromatic atoms and bonds decides; where it finds one, the SMILES is read again in that
  // Kekulé form (so the drawing, which parses `parsed`, carries no leftover radical either).
  // The Kekulé form is drawn only when OpenChemLib reads it cleanly with fewer radicals than before (a radical written
  // in the SMILES stays); where the re-read fails, the molecule as first read is drawn.
  const kek = radicalCount(mol) > 0 ? kekuleSmiles(s) : null;
  let kekule: { parsed: string; mol: Molecule } | null = null;
  if (kek) {
    const kParsed = oclSmilesText(substituteWildcards(kek).text);
    const kMol = parseSmilesOnly(kParsed);
    // Radicals written in the SMILES ([CH3], [O], a nitroxide) survive the re-read; only the resolver's go.
    if (kMol && !valenceProblem(kMol) && radicalCount(kMol) < radicalCount(mol)) kekule = { parsed: kParsed, mol: kMol };
  }
  // A Kekulé form settles the aromatic system only when its re-read is usable; a re-read that fails (an [nH] given a
  // third bond) leaves the radical check to judge the SMILES as written.
  const k = inventedRadical(s, mol, kek === false ? false : kekule ? true : null);
  if (k) return { ok: false, message: `“${s}” is not valid SMILES: ${k}`, invalid: true };
  if (kekule) {
    mol = kekule.mol;
    parsed = kekule.parsed;
  }
  return { ok: true, parsed, mol, wildcards: sub.count, heavyAtoms: heavyAtomCount(mol) };
}

type SmilesGraphAtom = {
  el: string;
  aromatic: boolean;
  bracket: boolean;
  h: number;
  charge: number;
  /** Text range of the atom token, and where its element letters start (inside a bracket after any isotope). */
  start: number;
  end: number;
  elStart: number;
};
/** A bond; `open` and `close` are the text ranges of its written symbol (empty where none is written). */
type SmilesGraphBond = { a: number; b: number; sym: string; open: [number, number]; close: [number, number] | null };
type SmilesGraph = { atoms: SmilesGraphAtom[]; bonds: SmilesGraphBond[] };

/**
 * The SMILES's own graph: atoms (element, written aromatic, bracket H count and charge) and bonds with the symbol
 * written on each ("" when implicit), with the text positions a Kekulé rewrite edits. Read from the TEXT, because
 * OpenChemLib has already turned aromatic bonds into single/double ones and an explicit "-" between aromatic atoms
 * (biphenyl, phthalocyanine's "nc-2n1") looks like any other single bond there. Null on anything it does not understand.
 */
function smilesGraph(s: string): SmilesGraph | null {
  const atoms: SmilesGraphAtom[] = [];
  const bonds: SmilesGraphBond[] = [];
  const stack: number[] = [];
  const open = new Map<string, { atom: number; sym: string; range: [number, number] }>();
  let prev = -1;
  let pending = "";
  let pendingAt = -1;
  const symRange = (at: number): [number, number] => (pending ? [pendingAt, pendingAt + 1] : [at, at]);
  const addAtom = (atom: SmilesGraphAtom): void => {
    atoms.push(atom);
    const i = atoms.length - 1;
    if (prev >= 0) bonds.push({ a: prev, b: i, sym: pending, open: symRange(atom.start), close: null });
    pending = "";
    prev = i;
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) return null;
      const m = /^\[(\d*)(se|te|as|[cnospb]|[A-Z][a-z]?|\*)(@(?:@|TH[12]|AL[12]|SP[123]|TB\d\d?|OH\d\d?)?)?(?:H(\d*))?([+-]+\d*)?(?::\d+)?\]$/.exec(s.slice(i, j + 1));
      if (!m) return null;
      let charge = 0;
      if (m[5]) {
        const sign = m[5][0] === "+" ? 1 : -1;
        const digits = m[5].replace(/[+-]/g, "");
        charge = sign * (digits ? Number(digits) : m[5].replace(/\d/g, "").length);
      }
      const aromatic = /^[a-z]/.test(m[2]);
      const h = m[4] === undefined ? 0 : m[4] ? Number(m[4]) : 1;
      addAtom({ el: m[2].toLowerCase(), aromatic, bracket: true, h, charge, start: i, end: j + 1, elStart: i + 1 + m[1].length });
      i = j + 1;
    } else if (s.startsWith("Cl", i) || s.startsWith("Br", i)) {
      addAtom({ el: s.slice(i, i + 2).toLowerCase(), aromatic: false, bracket: false, h: 0, charge: 0, start: i, end: i + 2, elStart: i });
      i += 2;
    } else if (/[BCNOPSFIbcnops*]/.test(c)) {
      addAtom({ el: c.toLowerCase(), aromatic: /[a-z]/.test(c), bracket: false, h: 0, charge: 0, start: i, end: i + 1, elStart: i });
      i++;
    } else if (/[-=#$:/\\]/.test(c)) {
      pending = c;
      pendingAt = i;
      i++;
    } else if (c === "(") {
      if (prev < 0) return null;
      stack.push(prev);
      i++;
    } else if (c === ")") {
      if (!stack.length) return null;
      prev = stack.pop()!;
      pending = "";
      i++;
    } else if (c === ".") {
      prev = -1;
      pending = "";
      i++;
    } else if (/\d/.test(c) || c === "%") {
      const label = c === "%" ? s.slice(i, i + 3) : c;
      if (c === "%" && !/^%\d\d$/.test(label)) return null;
      if (prev < 0) return null;
      const o = open.get(label);
      if (o) {
        if (o.atom === prev) return null;
        bonds.push({ a: o.atom, b: prev, sym: pending || o.sym, open: o.range, close: symRange(i) });
        open.delete(label);
      } else open.set(label, { atom: prev, sym: pending, range: symRange(i) });
      pending = "";
      i += label.length;
    } else return null;
  }
  return open.size ? null : { atoms, bonds };
}

/** Bonds that lie on a ring (not bridges of the graph): only those can carry an aromatic ring's double bonds. */
function ringBonds(g: SmilesGraph): boolean[] {
  const n = g.atoms.length;
  const adj: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  g.bonds.forEach((b, k) => {
    adj[b.a].push([b.b, k]);
    adj[b.b].push([b.a, k]);
  });
  const disc = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const inRing = new Array<boolean>(g.bonds.length).fill(true);
  let time = 0;
  // Iterative depth-first search (a long polymer would overflow a recursive one).
  for (let root = 0; root < n; root++) {
    if (disc[root] >= 0) continue;
    disc[root] = low[root] = time++;
    const stack: Array<{ v: number; via: number; next: number }> = [{ v: root, via: -1, next: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.next < adj[top.v].length) {
        const [w, k] = adj[top.v][top.next++];
        if (k === top.via) continue;
        if (disc[w] < 0) {
          disc[w] = low[w] = time++;
          stack.push({ v: w, via: k, next: 0 });
        } else low[top.v] = Math.min(low[top.v], disc[w]);
      } else {
        stack.pop();
        if (stack.length) {
          const parent = stack[stack.length - 1].v;
          low[parent] = Math.min(low[parent], low[top.v]);
          if (low[top.v] > disc[parent]) inRing[top.via] = false;
        }
      }
    }
  }
  return inRing;
}

/**
 * A perfect matching of the graph (adjacency lists), or null when none exists: Edmonds' blossom algorithm, polynomial
 * (no search budget), run one connected component at a time with an odd component refused at once. A root that no
 * augmenting path reaches can never be matched, so the first such root ends the search.
 */
function perfectMatching(adj: number[][]): number[] | null {
  const n = adj.length;
  const match = new Array<number>(n).fill(-1);
  const comp = new Array<number>(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const members = [s];
    comp[s] = s;
    for (let h = 0; h < members.length; h++) {
      for (const w of adj[members[h]]) {
        if (comp[w] < 0) {
          comp[w] = s;
          members.push(w);
        }
      }
    }
    if (members.length % 2) return null;
    // Greedy start (most-constrained first), then augment from each atom left free.
    const order = [...members].sort((x, y) => adj[x].length - adj[y].length);
    for (const v of order) {
      if (match[v] >= 0) continue;
      for (const w of adj[v]) {
        if (match[w] < 0) {
          match[v] = w;
          match[w] = v;
          break;
        }
      }
    }
    for (const v of members) if (match[v] < 0 && !augment(adj, match, members, v)) return null;
  }
  return match;
}

/** One augmenting-path search from a free root (blossoms contracted through `base`); true when the matching grew. */
function augment(adj: number[][], match: number[], members: number[], root: number): boolean {
  const n = adj.length;
  const parent = new Map<number, number>();
  const base = new Map<number, number>();
  for (const v of members) base.set(v, v);
  const used = new Set<number>([root]);
  const queue = [root];
  const baseOf = (v: number): number => base.get(v)!;
  const lca = (a0: number, b0: number): number => {
    const seen = new Set<number>();
    let a = a0;
    for (;;) {
      a = baseOf(a);
      seen.add(a);
      if (match[a] < 0) break;
      a = parent.get(match[a])!;
    }
    let b = b0;
    for (;;) {
      b = baseOf(b);
      if (seen.has(b)) return b;
      b = parent.get(match[b])!;
    }
  };
  for (let h = 0; h < queue.length; h++) {
    const v = queue[h];
    for (const to of adj[v]) {
      if (baseOf(v) === baseOf(to) || match[v] === to) continue;
      if (to === root || (match[to] >= 0 && parent.has(match[to]))) {
        const cur = lca(v, to);
        const blossom = new Set<number>();
        const markPath = (x0: number, child0: number): void => {
          let x = x0;
          let child = child0;
          while (baseOf(x) !== cur) {
            blossom.add(baseOf(x));
            blossom.add(baseOf(match[x]));
            parent.set(x, child);
            child = match[x];
            x = parent.get(match[x])!;
          }
        };
        markPath(v, to);
        markPath(to, v);
        for (const i of members) {
          if (blossom.has(baseOf(i))) {
            base.set(i, cur);
            if (!used.has(i)) {
              used.add(i);
              queue.push(i);
            }
          }
        }
      } else if (!parent.has(to)) {
        parent.set(to, v);
        if (match[to] < 0) {
          let u = to;
          while (u >= 0) {
            const pv = parent.get(u)!;
            const next = match[pv];
            match[u] = pv;
            match[pv] = u;
            u = next;
          }
          return true;
        }
        used.add(match[to]);
        queue.push(match[to]);
      }
    }
  }
  return false;
}

/** RDKit's valences for the aromatic elements, before the charge adjustment. */
const AROMATIC_VALENCES: Record<string, number[]> = { b: [3], c: [4], n: [3], p: [3, 5, 7], as: [3, 5, 7], o: [2], s: [2, 4, 6], se: [2, 4, 6], te: [2, 4, 6] };

/**
 * Which aromatic atoms must take one ring double bond — RDKit's kekulisation candidates: the atom's valence (charge
 * adjusted as RDKit does: B counts the charge reversed, C loses one either way) exceeds its single bonds plus
 * hydrogens. [cH-] (cyclopentadienide) and [nH] are full; [c-], [n], [nH+], [o+] and a bare [c] are not.
 */
function kekuleCandidates(g: SmilesGraph): boolean[] {
  const sbo = new Array<number>(g.atoms.length).fill(0);
  for (const b of g.bonds) {
    const o = b.sym === "=" ? 2 : b.sym === "#" ? 3 : b.sym === "$" ? 4 : 1;
    sbo[b.a] += o;
    sbo[b.b] += o;
  }
  return g.atoms.map((a, i): boolean => {
    if (!a.aromatic) return false;
    const vals = AROMATIC_VALENCES[a.el];
    if (!vals) return false;
    // An unbracketed aromatic c takes the hydrogen that leaves it one bond short; the others take none.
    if (!a.bracket) {
      if (a.el === "c") return sbo[i] <= 3;
      if (a.el === "b") return sbo[i] <= 2;
    }
    const used = sbo[i] + a.h;
    let q = a.charge;
    if (a.el === "b") q = -q;
    else if (a.el === "c") q = -Math.abs(q);
    const dv = vals.map((v) => v + q).find((v) => v >= used);
    return dv !== undefined && dv - used >= 1;
  });
}

/** Kekulé forms already worked out, by SMILES text (a structure is checked, drawn and resolved several times). */
const KEKULE_CACHE = new Map<string, string | false | null>();

/**
 * The SMILES rewritten in Kekulé form (aromatic atoms in capitals, the ring double bonds written "="), decided by a
 * real perfect matching of the kekulisation candidates over ring bonds (RDKit's "Can't kekulize mol" test). False
 * when no Kekulé form exists; null when the SMILES could not be read here or has no aromatic atom (the caller keeps
 * OpenChemLib's judgement). A bond between aromatic atoms that is in no ring is single, as RDKit reads it.
 */
function kekuleSmiles(s: string): string | false | null {
  const hit = KEKULE_CACHE.get(s);
  if (hit !== undefined) return hit;
  const out = kekuleSmilesUncached(s);
  if (KEKULE_CACHE.size >= 64) KEKULE_CACHE.delete(KEKULE_CACHE.keys().next().value as string);
  KEKULE_CACHE.set(s, out);
  return out;
}

function kekuleSmilesUncached(s: string): string | false | null {
  const g = smilesGraph(s);
  if (!g || !g.atoms.some((a) => a.aromatic)) return null;
  const inRing = ringBonds(g);
  const aromaticBond = (b: SmilesGraphBond, k: number): boolean => inRing[k] && g.atoms[b.a].aromatic && g.atoms[b.b].aromatic && (b.sym === "" || b.sym === ":");
  const cand = kekuleCandidates(g);
  const local = new Array<number>(g.atoms.length).fill(-1);
  const ids: number[] = [];
  cand.forEach((c, i) => {
    if (c) {
      local[i] = ids.length;
      ids.push(i);
    }
  });
  const adj: number[][] = ids.map(() => []);
  g.bonds.forEach((b, k) => {
    if (aromaticBond(b, k) && cand[b.a] && cand[b.b]) {
      adj[local[b.a]].push(local[b.b]);
      adj[local[b.b]].push(local[b.a]);
    }
  });
  const m = perfectMatching(adj);
  if (!m) return false;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const a of g.atoms) {
    if (!a.aromatic) continue;
    edits.push({ start: a.elStart, end: a.elStart + 1, text: s[a.elStart].toUpperCase() });
  }
  g.bonds.forEach((b, k) => {
    if (!(g.atoms[b.a].aromatic && g.atoms[b.b].aromatic && (b.sym === "" || b.sym === ":"))) return;
    const dbl = aromaticBond(b, k) && cand[b.a] && cand[b.b] && ids[m[local[b.a]]] === b.b;
    const sym = dbl ? "=" : "";
    if (b.close) {
      edits.push({ start: b.open[0], end: b.open[1], text: "" });
      edits.push({ start: b.close[0], end: b.close[1], text: sym });
    } else edits.push({ start: b.open[0], end: b.open[1], text: sym });
  });
  // From the end, a replacement before an insertion at the same place (so "=" lands in front of the atom).
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let t = s;
  for (const e of edits) t = t.slice(0, e.start) + e.text + t.slice(e.end);
  return t;
}

/** The SMILES atoms in order: each one's text and whether it was written in brackets. Null on anything unexpected. */
function smilesAtomTokens(s: string): Array<{ text: string; bracket: boolean; start: number }> | null {
  const out: Array<{ text: string; bracket: boolean; start: number }> = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) return null;
      out.push({ text: s.slice(i, j + 1), bracket: true, start: i });
      i = j + 1;
    } else if (s.startsWith("Cl", i) || s.startsWith("Br", i)) {
      out.push({ text: s.slice(i, i + 2), bracket: false, start: i });
      i += 2;
    } else if (/[BCNOPSFIbcnops*]/.test(c)) {
      out.push({ text: c, bracket: false, start: i });
      i++;
    } else if (/[()\-=#$:/\\.%\d@+]/.test(c)) i++;
    else return null;
  }
  return out;
}

/**
 * True when the text reads as a molecular formula and has nothing only SMILES has: element symbols each written once,
 * each with an optional count other than 1 ("SF6", "CO2", "P4O10", "SO2Cl2"). Its digits are counts, not ring bonds.
 * "C1CC" stays SMILES: a count of 1 is never written in a formula, and the same element twice is a chain.
 */
function readsAsFormula(s: string): boolean {
  if (!/^(?:(?:Cl|Br|[BCNOPSFI])(?:[2-9]|[1-9]\d+)?)+$/.test(s)) return false;
  const els = s.match(/Cl|Br|[A-Z]/g) ?? [];
  return new Set(els).size === els.length;
}

/** The first ring-closure label (outside atom brackets) opened and never closed, or null. */
function unclosedRing(s: string): string | null {
  const open = new Set<string>();
  const order: string[] = [];
  const outside = s.replace(/\[[^\]]*\]/g, "A");
  for (const m of outside.matchAll(/%\d\d|\d/g)) {
    if (open.has(m[0])) open.delete(m[0]);
    else open.add(m[0]), order.push(m[0]);
  }
  return order.find((l) => open.has(l)) ?? null;
}

/**
 * A radical OpenChemLib invented where SMILES cannot write one — on an atom NOT in brackets (an organic-subset atom
 * takes its normal valence in hydrogens) — named with the repair; or null. It comes from an aromatic system that has
 * no Kekulé form: c1ccnc1 (pyrrole's N–H left out) came out as C₄H₄N with a radical nitrogen, c1ccccc1c as a benzyl
 * radical. RDKit refuses both ("Can't kekulize mol").
 */
function inventedRadical(s: string, mol: Molecule, kekulisable: boolean | null = null): string | null {
  if (!radicalCount(mol)) return null;
  const toks = smilesAtomTokens(s);
  const sameOrder = !!toks && toks.length === mol.getAllAtoms();
  mol.ensureHelperArrays(Molecule.cHelperRings);
  // An aromatic (lowercase) atom outside any ring ("Co", c1ccccc1c): named first — the commonest cause.
  if (sameOrder) {
    const j = toks!.findIndex((q, k) => !q.bracket && /^[a-z]/.test(q.text) && !mol.isRingAtom(k));
    if (j >= 0) {
      const q = toks![j];
      const up = q.text.toUpperCase();
      const fixed = s.slice(0, q.start) + up + s.slice(q.start + q.text.length);
      return `atom ${j + 1} (${q.text}) is written aromatic (lowercase) but is in no ring, so it would be left as a radical — an aromatic atom must sit in an aromatic ring; write it as ${up} (${fixed}).`;
    }
  }
  // A Kekulé form exists (kekuleSmiles found one): OpenChemLib's radicals were its resolver giving up, not the SMILES.
  if (kekulisable === true) return null;
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    if (!mol.getAtomRadical(i)) continue;
    const tok = sameOrder ? toks![i] : null;
    if (tok?.bracket) continue;
    // Atoms not matched to the text in order, and bracket atoms present: the radical cannot be pinned on one — left alone.
    if (!sameOrder && (!toks || toks.some((q) => q.bracket))) continue;
    const t = tok?.text ?? mol.getAtomLabel(i);
    const where = tok ? `atom ${i + 1} (${t})` : `an atom (${t})`;
    let fix: string;
    // A two-connected aromatic n not in brackets is the usual cause (pyrrole, indole, imidazole written without the N–H).
    const nTok = t === "n" ? tok : sameOrder ? toks!.find((q, j) => q.text === "n" && mol.getConnAtoms(j) === 2 && mol.isRingAtom(j)) : undefined;
    if (nTok || t === "n") {
      const fixed = nTok ? s.slice(0, nTok.start) + "[nH]" + s.slice(nTok.start + 1) : null;
      fix = `Write the pyrrole-type N–H as [nH]${fixed ? ` (${fixed})` : ""}.`;
    } else if (/^[a-z]/.test(t)) {
      fix = `Write the ring in Kekulé form (alternating = bonds), or give the odd atom its hydrogens or charge in brackets (e.g. [cH-] for cyclopentadienide, [nH] for pyrrole).`;
    } else fix = "Give the atom its hydrogens or charge in brackets.";
    return `its aromatic ring cannot be written with alternating double bonds (it does not kekulise) — ${where} would be left as a radical. ${fix}`;
  }
  // No Kekulé form exists (the matching proved it) though the radical sits on a bracket atom ([c-]1cccc1): still refused.
  if (kekulisable === false) {
    return "its aromatic ring cannot be written with alternating double bonds (it does not kekulise), so an atom would be left as a radical. Write the ring in Kekulé form (alternating = bonds), or give the odd atom its hydrogens or charge in brackets (e.g. [cH-] for cyclopentadienide, [nH] for pyrrole).";
  }
  return null;
}

/** Why a structure cannot be drawn (too large, or attachment points other than a repeat unit's two), or null. */
/** Drawing options: `substituent` lets one attachment point (*) stand for the bond to the parent (a gallery R group). */
export interface DrawOptions {
  substituent?: boolean;
}

export function drawRefusal(check: Extract<SmilesCheck, { ok: true }>, opts: DrawOptions = {}): string | null {
  if (check.heavyAtoms > STRUCTURE_DRAW_MAX_HEAVY_ATOMS) {
    return (
      `Structure not drawn: ${check.heavyAtoms} heavy atoms is above the ${STRUCTURE_DRAW_MAX_HEAVY_ATOMS}-atom drawing limit ` +
      `(2D layout time grows steeply with size and would freeze Word). Mass Spec gives its formula and masses.`
    );
  }
  if (check.wildcards) {
    if (check.wildcards !== 2 && !(opts.substituent && check.wildcards === 1)) {
      return (
        `The SMILES has ${check.wildcards} attachment point${check.wildcards === 1 ? "" : "s"} (*). Two * mark a polymer's ` +
        `repeat unit (*CC* is polyethylene's –[CH₂CH₂]ₙ–); ${check.wildcards === 1 ? "one marks a substituent, which" : "any other number"} has no formula of its own here.`
      );
    }
    const mol = check.mol;
    for (let i = 0; i < mol.getAllAtoms(); i++) {
      if (mol.getAtomicNo(i) !== WILDCARD_SENTINEL_Z) continue;
      if (mol.getConnAtoms(i) !== 1 || mol.getConnBondOrder(i, 0) !== 1 || mol.getAtomicNo(mol.getConnAtom(i, 0)) === WILDCARD_SENTINEL_Z) {
        return `Each attachment point (*) of a ${check.wildcards === 1 ? "substituent" : "repeat unit"} must hang from one atom by a single bond.`;
      }
    }
  }
  return null;
}

/**
 * OpenChemLib's structure SVG with its charge signs set properly: the minus as a true minus (U+2212, never the ASCII
 * hyphen "-"), and each sign moved to the first place around its atom that keeps clear of the atom's bonds and of every
 * label — OpenChemLib always sets it upper right, where diazomethane's "+" sat on the N=N bond. Places tried: upper
 * right, upper left, above, lower right, lower left, below, right, left; the clearest if none is clear.
 */
export function tidyOclCharges(svg: string): string {
  const num = (s: string | undefined): number => Number(s ?? NaN);
  const atoms: Array<[number, number]> = [];
  for (const m of svg.matchAll(/<circle id="[^"]*:Atom:\d+"[^>]*\bcx="([-\d.]+)" cy="([-\d.]+)"/g)) atoms.push([num(m[1]), num(m[2])]);
  const segs: Array<[number, number, number, number]> = [];
  for (const m of svg.matchAll(/<line id="[^"]*:Bond:\d+"[^>]*\bx1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) segs.push([num(m[1]), num(m[2]), num(m[3]), num(m[4])]);
  type T = { full: string; x: number; y: number; fs: number; text: string; idx: number };
  const texts: T[] = [];
  for (const m of svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"([^>]*?)font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)) texts.push({ full: m[0], x: num(m[1]), y: num(m[2]), fs: num(m[4]), text: m[6], idx: m.index ?? 0 });
  const isCharge = (t: T): boolean => /^\d*[+-]$/.test(t.text);
  const boxOf = (x: number, y: number, fs: number, n: number): [number, number, number, number] => [x, y - 0.72 * fs, x + 0.6 * fs * n, y + 0.05 * fs];
  const labels = texts.filter((t) => !isCharge(t)).map((t) => boxOf(t.x, t.y, t.fs, t.text.length));
  const segBox = (s: [number, number, number, number], b: [number, number, number, number]): number => {
    // Distance from a segment to a box (sampled; boxes and bonds are a few points across).
    let best = Infinity;
    for (let k = 0; k <= 20; k++) {
      const px = s[0] + ((s[2] - s[0]) * k) / 20, py = s[1] + ((s[3] - s[1]) * k) / 20;
      best = Math.min(best, Math.hypot(Math.max(0, b[0] - px, px - b[2]), Math.max(0, b[1] - py, py - b[3])));
    }
    return best;
  };
  const boxBox = (a: number[], b: number[]): number => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));
  if (!texts.some(isCharge)) return svg;
  let out = svg;
  let [vx, vy, vw, vh] = (/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg) ?? []).slice(1).map(Number);
  for (const t of texts.filter(isCharge).reverse()) {
    const sign = t.text.replace("-", "−");
    let moved = t.full.replace(/>([^<]*)<\/text>$/, `>${sign}</text>`);
    if (atoms.length) {
      // Its atom: the nearest atom centre to the sign's own box.
      const own = boxOf(t.x, t.y, t.fs, t.text.length);
      const mid: [number, number] = [(own[0] + own[2]) / 2, (own[1] + own[3]) / 2];
      const atom = atoms.reduce((p, q) => (Math.hypot(q[0] - mid[0], q[1] - mid[1]) < Math.hypot(p[0] - mid[0], p[1] - mid[1]) ? q : p));
      const mine = segs.filter((s) => Math.hypot(s[0] - atom[0], s[1] - atom[1]) < 0.5 || Math.hypot(s[2] - atom[0], s[3] - atom[1]) < 0.5);
      const others = labels.filter((b) => !(atom[0] >= b[0] - 1 && atom[0] <= b[2] + 1 && atom[1] >= b[1] - 1 && atom[1] <= b[3] + 1));
      const w = own[2] - own[0], h = own[3] - own[1];
      const ownLabel = labels.find((b) => atom[0] >= b[0] - 1 && atom[0] <= b[2] + 1 && atom[1] >= b[1] - 1 && atom[1] <= b[3] + 1);
      const r = ownLabel ? Math.max(ownLabel[2] - ownLabel[0], ownLabel[3] - ownLabel[1]) / 2 + 0.6 * Math.max(w, h) : 0.9 * t.fs;
      const angles = [-45, -135, -90, 45, 135, 90, 0, 180];
      let best: { x: number; y: number; score: number } | null = null;
      for (const deg of angles) {
        const a = (deg * Math.PI) / 180;
        const cx = atom[0] + r * Math.cos(a), cy = atom[1] + r * Math.sin(a);
        const b: [number, number, number, number] = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        const clear = Math.min(Infinity, ...mine.map((s) => segBox(s, b)), ...segs.filter((s) => !mine.includes(s)).map((s) => segBox(s, b)), ...others.map((o) => boxBox(o, b)));
        if (!best || clear > best.score + 1e-9) best = { x: b[0], y: b[3] - 0.05 * t.fs, score: clear };
        if (clear >= 0.4 * t.fs) {
          best = { x: b[0], y: b[3] - 0.05 * t.fs, score: clear };
          break;
        }
      }
      if (best) {
        moved = moved.replace(/^<text x="[-\d.]+" y="[-\d.]+"/, `<text x="${best.x.toFixed(2)}" y="${best.y.toFixed(2)}"`);
        const b = boxOf(best.x, best.y, t.fs, t.text.length);
        if (Number.isFinite(vx)) {
          const nx0 = Math.min(vx, b[0] - 2), ny0 = Math.min(vy, b[1] - 2), nx1 = Math.max(vx + vw, b[2] + 2), ny1 = Math.max(vy + vh, b[3] + 2);
          [vx, vy, vw, vh] = [nx0, ny0, nx1 - nx0, ny1 - ny0];
        }
      }
    }
    out = out.slice(0, t.idx) + moved + out.slice(t.idx + t.full.length);
  }
  if (Number.isFinite(vx)) {
    const f = (v: number): string => String(Math.round(v * 100) / 100);
    out = out.replace(/viewBox="[^"]*"/, `viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}"`).replace(/width="[\d.]+px" height="[\d.]+px"/, `width="${f(vw)}px" height="${f(vh)}px"`);
  }
  return out;
}

/** OpenChemLib's formula string ("C2H3O2Na") in Hill order ("C2H3NaO2"; with no carbon, all alphabetical). */
export function hillFromOcl(formula: string): string {
  return formula ? hillFormula(oclCounts(formula)) : formula;
}

/**
 * Renders a 2D structure SVG for the given input, or returns null when the input
 * is neither a known name/formula nor a parseable SMILES string — or is refused
 * (invalid SMILES, over the drawing cap, attachment points other than a repeat
 * unit's two; resolveStructure says why by name).
 */
export function renderStructure(input: string, width = 280, height = 220, opts: DrawOptions = {}): StructureResult | null {
  // An explicit "smiles:" prefix bypasses the name/formula dictionary. The
  // lookup order (name → formula → SMILES) is right for TYPED input, but a
  // string that is ALREADY a structure must be able to say so: drawn
  // methanol arrives as SMILES "CO", and the formula table would silently
  // render it as carbon monoxide — a different molecule than was drawn.
  const explicit = input.trim().match(/^smiles:\s*(.+)$/i);
  const looked = explicit ? null : lookupSmiles(input);

  let smiles = "";
  let source: StructureResult["source"] = "smiles";

  if (explicit) {
    smiles = explicit[1].trim();
    // Never draw OpenChemLib's reading of an invalid ring closure (C6Cl6 → CH₃Cl).
    if (duplicateRingClosure(smiles) !== null) return null;
  } else if (looked) {
    smiles = looked.smiles;
    source = looked.source;
  } else {
    // Fall back to treating the raw input as SMILES.
    smiles = input.trim();
    source = "smiles";
  }

  // The gate, BEFORE any parse that lays the molecule out.
  const check = checkSmiles(smiles);
  if (!check.ok || drawRefusal(check, opts)) return null;
  // check.parsed is already the Kekulé form where OpenChemLib's own resolver left radicals (porphine).
  const mol = safeFromSmiles(check.parsed);
  if (!mol) return null;

  try {
    mol.inventCoordinates();
  } catch {
    // Coordinates may already be present; ignore.
  }
  // Attachment points are drawn as "*" (OpenChemLib would draw its query atom as "?").
  const repeatUnit = check.wildcards === 2;
  const substituent = !!opts.substituent && check.wildcards === 1;
  if (repeatUnit || substituent) {
    for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomicNo(i) === WILDCARD_SENTINEL_Z) mol.setAtomCustomLabel(i, "*");
  }

  // autoCrop trims the wide empty margins OpenChemLib leaves around a molecule
  // (the structure itself is drawn at its natural size — we just remove the
  // surrounding whitespace so the inserted image is tight to the structure).
  // Suppress the R/S/"abs" stereo-descriptor text labels: the wedge bonds already
  // convey stereochemistry, and on a stereo-rich molecule (e.g. paclitaxel, 11
  // centres) the CIP/ESR tags pile onto the bonds and read as overlapping clutter.
  const svg = tidyOclCharges(mol.toSVG(width, height, undefined, {
    autoCrop: true,
    autoCropMargin: 8,
    suppressChiralText: true,
    suppressCIPParity: true,
    suppressESR: true,
  }));

  // Provenance: canonical SMILES, OCL ID code, formula, and molecular weight.
  let canonicalSmiles = smiles;
  let idcode = "";
  let formula = "";
  let mw = 0;
  try {
    canonicalSmiles = mol.toIsomericSmiles();
  } catch {
    /* keep input smiles */
  }
  try {
    idcode = mol.getIDCode();
  } catch {
    /* ignore */
  }
  try {
    if (repeatUnit || substituent) {
      // Per repeat unit: cap each * with a hydrogen (the bond it stands for holds a valence, as any bond does), then
      // take those two hydrogens back off — *CC* → C₂H₆ → C₂H₄. A substituent the same with its one: *OC → CH₃O.
      const k = check.wildcards;
      const capped = mol.getCompactCopy();
      for (let i = 0; i < capped.getAllAtoms(); i++) if (capped.getAtomicNo(i) === WILDCARD_SENTINEL_Z) capped.setAtomicNo(i, 1);
      const mf = capped.getMolecularFormula();
      const counts = oclCounts(mf.formula);
      counts.H = (counts.H ?? 0) - k;
      if (!counts.H) delete counts.H;
      formula = hillFormula(counts) + chargeSuffix(netCharge(capped));
      const hWeight = Molecule.fromSmiles("[H][H]", { noCoordinates: true }).getMolecularFormula().relativeWeight / 2;
      mw = Math.round((mf.relativeWeight - k * hWeight) * 100) / 100;
      canonicalSmiles = canonicalSmiles.split(WILDCARD_SENTINEL).join("*");
      // The idcode would carry the sentinel element: no name lookup, namer or canvas may read it as a compound.
      idcode = "";
    } else {
      const mf = mol.getMolecularFormula();
      // The net charge raised after the formula (C₄H₁₂N⁺, acetylcholine C₇H₁₆NO₂⁺): the Hill string alone dropped it.
      formula = hillFromOcl(mf.formula) + chargeSuffix(netCharge(mol));
      mw = Math.round(mf.relativeWeight * 100) / 100;
    }
  } catch {
    /* ignore */
  }

  return { svg, smiles: canonicalSmiles, source, formula, idcode, mw, ...(repeatUnit ? { repeatUnit: true } : {}), ...(substituent ? { substituent: true } : {}) };
}

// ---------------------------------------------------------------------------
// FORMULA vs SMILES — the reading of a dictionary miss (v2.137.0, §A-18 / §E6)
// ---------------------------------------------------------------------------
//
// renderStructure and computeMassSpec fall back to SMILES on a dictionary miss,
// and a FORMULA is very often also parseable SMILES: "Co" (cobalt) became CH₃O,
// "CN" (cyanide) became methylamine, "No" (nobelium) H₂NO. Those two legacy entry
// points are kept unchanged on purpose — several callers feed them SMILES by
// construction (drawn structures, peptide SMILES, reaction components, internal
// cross-checks) — and the TYPED-input paths call the mode-aware resolver below.
//
// THE RULE (mode "auto"):
//   1. "smiles:…" / "formula:…" prefixes choose the reading outright.
//   2. A dictionary hit (name, or a formula the dictionary knows) wins, as today.
//      If that string is ALSO valid SMILES for a different substance, the other
//      reading is NAMED in a note (CO: carbon monoxide; as SMILES, methanol).
//   3. On a miss, the string is read both ways:
//        - as a FORMULA: real, case-sensitive element symbols (validateFormula),
//          with no SMILES-only syntax (= # @ % \ $ :, a lowercase atom, a sign
//          inside brackets);
//        - as SMILES: OpenChemLib parses it AND it is valid SMILES — an aromatic
//          (lowercase) atom must sit in a ring, so a lowercase atom with no
//          ring-closure digit is not SMILES at all. OpenChemLib accepts "Co" as
//          C + aromatic o anyway; RDKit and the OpenSMILES spec refuse it.
//      One valid reading → that reading. Both, with the same composition and
//      charge → they agree ([Fe], FF), so the drawable SMILES reading is kept.
//      Both, DIFFERENT → picked by the PANE (context), with the other reading
//      and the override NAMED in a note — never a silent pick, never a refusal:
//      Structure → SMILES; Mass Spec → the formula only when the string looks
//      written as one (looksWrittenAsFormula), else SMILES. The "ambiguous"
//      kind stays in the type for callers, but these rules always decide.
//
// Mode "smiles" is the legacy order (name → dictionary formula → SMILES) for
// panes that are structure-only (the Reaction "Structures" toggle); mode
// "formula" never reads SMILES (names still resolve through the dictionary).

export type ChemReadMode = "auto" | "smiles" | "formula";

/** A formula reading of an input: composition from validateFormula (IUPAC weights). */
export interface FormulaReading {
  counts: Record<string, number>;
  charge: number;
  /** Hill form, ASCII (re-parseable; fractional parts kept apart). */
  hill: string;
  /** Hill form typeset for display (subscript counts, superscript charge). */
  display: string;
  /** Average molar mass in g/mol (IUPAC conventional weights). */
  mass: number;
  /** True when a count is not whole (fractional hydrate). */
  fractional: boolean;
  /** The element's name when the formula is one element (Co → "cobalt"). */
  elementName?: string;
}

export type ChemResolution =
  | { kind: "dictionary"; source: "name" | "formula"; smiles: string; note?: string }
  | { kind: "smiles"; smiles: string; note?: string }
  | { kind: "formula"; formula: FormulaReading; note?: string }
  | {
      kind: "ambiguous";
      formula: FormulaReading;
      smiles: string;
      /** The SMILES reading's molecular formula as OpenChemLib writes it (e.g. "CH5N"). */
      smilesFormula: string;
      message: string;
    }
  | { kind: "none"; message: string };

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

/** Typesets a Hill string (plus a net charge) for messages: CH₅N, MnO₄⁻, Fe²⁺. */
export function typesetHill(hill: string, charge = 0): string {
  // A digit is a subscript count unless it begins a part (a hydrate coefficient).
  let out = "";
  let partStart = true;
  for (const ch of hill) {
    if (ch >= "0" && ch <= "9") out += partStart ? ch : SUBSCRIPT[Number(ch)];
    else {
      out += ch;
      // "·" starts a part; "/" continues a fractional coefficient ("2/7H2O").
      partStart = ch === "·" || ch === "/";
    }
  }
  return out + chargeSuffix(charge);
}

/** A net charge as raised text after a formula: "" for 0, ⁺, ²⁺, ⁻ (the superscript minus), ³⁻. */
export function chargeSuffix(charge: number): string {
  if (!charge || !Number.isFinite(charge)) return "";
  const mag = Math.abs(charge) === 1 ? "" : [...String(Math.abs(charge))].map((d) => SUPERSCRIPT[d]).join("");
  return mag + (charge > 0 ? "⁺" : "⁻");
}

/** Element → count from an OpenChemLib formula string ("CH5N", "O3Fe2"). */
function oclCounts(formula: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) out[m[1]] = (out[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  return out;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a).filter((k) => a[k] !== 0);
  const kb = Object.keys(b).filter((k) => b[k] !== 0);
  return ka.length === kb.length && ka.every((k) => Math.abs(a[k] - (b[k] ?? 0)) < 1e-9);
}

/** A strict FORMULA reading, or null when the string is not a formula. */
export function readAsFormula(input: string): FormulaReading | null {
  const src = normalizeFormulaText(input).trim();
  if (!src) return null;
  // SMILES-only syntax: bonds, stereo, ring-closure %nn, explicit H counts in
  // atoms, reaction/escape characters, any lowercase-initial atom.
  if (/[=#@%\\$:]/.test(src)) return null;
  // A charge belongs at the END of a part (MnO4-, [Fe(CN)6]4-, SO4^2-). A sign
  // anywhere else ([Na+].[Cl-], [N+](C)…) is SMILES bracket-atom syntax.
  for (const part of src.split(/[·•*.]/)) {
    const body = part.trim().replace(/\^?\d*[+-]$/, "");
    if (/[+-]/.test(body)) return null;
  }
  const v = validateFormula(src);
  if (!v.valid || v.mass === null) return null;
  const els = Object.keys(v.counts);
  let name: string | undefined;
  if (els.length === 1) {
    const z = atomicNumber(els[0]);
    const nm = z ? elementName(z) : null;
    if (nm) name = nm.toLowerCase();
  }
  return {
    counts: v.counts,
    charge: v.charge,
    hill: v.hill,
    display: typesetHill(v.hill, v.charge),
    mass: v.mass,
    fractional: v.fractional,
    elementName: name,
  };
}

/**
 * True when every lowercase (aromatic) organic-subset atom outside brackets
 * could sit in a ring — i.e. the string has a ring-closure digit. An aromatic
 * atom outside any ring is not valid SMILES (OpenSMILES; RDKit refuses it),
 * even though OpenChemLib accepts it.
 */
function aromaticAtomsCanBeInRings(s: string): boolean {
  const outside = s.replace(/\[[^\]]*\]/g, "");
  // Cl and Br are the only two-letter organic-subset atoms; consume them first.
  const tokens = outside.replace(/Cl|Br/g, "");
  const hasAromatic = /[bcnops]/.test(tokens);
  return !hasAromatic || /\d|%/.test(outside);
}

/**
 * Mass Spec's tie-break when a string is BOTH a valid formula and valid SMILES:
 * an explicit count (a digit run other than a lone "1" after an element or a
 * closing bracket) or a two-letter element symbol other than Cl/Br.
 */
function looksWrittenAsFormula(s: string): boolean {
  const src = normalizeFormulaText(s);
  // RING-CLOSURE PAIRS ARE NOT COUNTS. This is only asked when the string is
  // already valid SMILES; if every ring-bond label (each digit, or %nn) occurs an
  // even number of times, the digits are the rings OpenChemLib closed —
  // decalin C1CCC2CCCCC2C1 is C₁₀H₁₈, not C₁₂; cubane C12C3C4C1C5C2C3C45 is
  // C₈H₈, not C₇₅. Only an unpaired digit can be a formula count.
  const labels: Record<string, number> = {};
  for (const m of src.replace(/\[[^\]]*\]/g, "").matchAll(/%\d\d|\d/g)) labels[m[0]] = (labels[m[0]] ?? 0) + 1;
  const digits = Object.keys(labels);
  if (digits.length && digits.every((k) => labels[k] % 2 === 0)) return false;
  for (const m of src.matchAll(/([A-Z][a-z]?|[)\]}])(\d+)/g)) if (m[2] !== "1") return true;
  for (const m of src.matchAll(/[A-Z][a-z]/g)) if (m[0] !== "Cl" && m[0] !== "Br") return true;
  return false;
}

/**
 * The ring-closure label of the first closure that joins two atoms ALREADY
 * bonded (or an atom to itself), or null when there is none.
 *
 * WHY (v2.138.0, §A-13). OpenChemLib accepts such a closure and silently drops
 * the duplicate bond, so "C6Cl6" parsed as SMILES — C, ring-open 6, Cl, ring-close
 * 6 back onto the C it is already bonded to — and came out as CH₃Cl. Mass Spec
 * then answered chloromethane for hexachlorobenzene's formula (C6F6 → CH₃F,
 * C6Br6 → CH₃Br). OpenSMILES forbids it and RDKit rejects it ("ring closure 6
 * duplicates bond between atom 0 and atom 1"), so such a string is NOT SMILES and
 * the formula reading stands alone.
 *
 * A small scanner, not OpenChemLib's bond count (explicit [H] handling makes
 * that unreliable): atoms (bracket, Cl/Br, the organic subset, aromatic, *),
 * branches, '.', bond symbols before a label, single digits and %nn, label
 * reuse after a close, and self-closure (C11). Anything it does not recognise
 * returns null and is left to the parser.
 */
export function duplicateRingClosure(smiles: string): string | null {
  return scanDuplicateClosure(smiles)?.label ?? null;
}

/** The refusal for an explicit SMILES request whose ring closure duplicates a bond, or null. */
export function duplicateClosureRefusal(smiles: string): string | null {
  const d = scanDuplicateClosure(smiles);
  if (!d) return null;
  const s = smiles.trim();
  const what =
    d.self
      ? `ring closure ${d.label} would bond the ${d.a} atom to itself`
      : `ring closure ${d.label} duplicates the bond ${d.a}–${d.b}, which the chain already makes`;
  const f = readAsFormula(s);
  const asFormula = f ? ` As a formula it is ${f.display}; type formula:${s} for that.` : "";
  return `“${s}” is not valid SMILES: ${what}.${asFormula}`;
}

function scanDuplicateClosure(smiles: string): { label: string; a: string; b: string; self: boolean } | null {
  const s = smiles.trim();
  const sym: string[] = [];
  const bracketSymbol = (t: string): string => {
    const m = /^\[\d*([A-Z][a-z]?|[a-z][a-z]?|\*)/.exec(t);
    return m ? m[1] : t;
  };
  const bonded = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const open = new Map<string, number>();
  const stack: (number | null)[] = [];
  let prev: number | null = null;
  let atoms = 0;
  let i = 0;
  const atom = (symbol: string) => {
    const cur = atoms++;
    sym.push(symbol);
    if (prev !== null) bonded.add(key(prev, cur));
    prev = cur;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) return null;
      atom(bracketSymbol(s.slice(i, j + 1)));
      i = j + 1;
    } else if (s.startsWith("Cl", i) || s.startsWith("Br", i)) {
      atom(s.slice(i, i + 2));
      i += 2;
    } else if (/[BCNOPSFIbcnops*]/.test(c)) {
      atom(c);
      i += 1;
    } else if (c === "(") {
      stack.push(prev);
      i += 1;
    } else if (c === ")") {
      if (!stack.length) return null;
      prev = stack.pop() as number | null;
      i += 1;
    } else if (c === ".") {
      prev = null;
      i += 1;
    } else if (/[-=#$:/\\]/.test(c)) {
      i += 1;
    } else if (/\d/.test(c) || (c === "%" && /^%\d\d/.test(s.slice(i)))) {
      const label = c === "%" ? s.slice(i, i + 3) : c;
      i += label.length;
      if (prev === null) return null;
      const other = open.get(label);
      if (other === undefined) {
        open.set(label, prev);
      } else {
        open.delete(label);
        if (other === prev || bonded.has(key(other, prev))) {
          return { label, a: sym[other], b: sym[prev], self: other === prev };
        }
        bonded.add(key(other, prev));
      }
    } else {
      return null;
    }
  }
  return null;
}

/** A valid SMILES reading's molecule, or null. */
function readAsSmiles(input: string): Molecule | null {
  const s = input.trim();
  if (!s || !aromaticAtomsCanBeInRings(s)) return null;
  if (duplicateRingClosure(s) !== null) return null;
  const c = checkSmiles(s);
  return c.ok ? c.mol : null;
}

/**
 * Why a string OpenChemLib would accept is still not valid SMILES (unbalanced brackets, an abnormal valence), or
 * null when it is valid or not SMILES-like at all.
 */
function invalidSmilesReason(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const c = checkSmiles(s);
  return !c.ok && c.invalid ? c.message : null;
}

function netCharge(mol: Molecule): number {
  let q = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) q += mol.getAtomCharge(i);
  return q;
}

function describeFormula(f: FormulaReading): string {
  const what = f.elementName ? `${f.elementName} (${f.display})` : f.display;
  return `${what}, ${f.mass.toFixed(3)} g/mol`;
}

function describeSmiles(mol: Molecule): string {
  const mf = mol.getMolecularFormula();
  let name: string | null = null;
  // The idcode (canonicalisation) of a long chain takes tens of seconds (48 s for "C" × 3000), and nothing that size
  // is in the dictionary (its largest entry, tannic acid, has 122 heavy atoms): no name lookup above 150.
  if (heavyAtomCount(mol) <= DICTIONARY_NAME_MAX_HEAVY_ATOMS) {
    try {
      name = nameForIdcode(mol.getIDCode());
    } catch {
      name = null;
    }
  }
  const q = netCharge(mol);
  const formula = typesetHill(mf.formula, q);
  return name ? `${name.toLowerCase()} (${formula})` : formula;
}

/**
 * Reads a typed chemical input as a dictionary entry, a formula or a SMILES
 * string, by the rule above. Pure; no drawing.
 */
export function resolveChemInput(
  input: string,
  mode: ChemReadMode = "auto",
  context: "structure" | "massspec" = "structure"
): ChemResolution {
  const raw = input.trim();
  if (!raw) return { kind: "none", message: "Type a name, a formula, or a SMILES string." };

  const smilesPrefix = /^smiles:\s*(.+)$/i.exec(raw);
  if (smilesPrefix) {
    const s = smilesPrefix[1].trim();
    // An explicit SMILES request does not make an invalid SMILES valid: OCL would
    // silently drop the duplicate bond and draw a different molecule (C6Cl6 → CH₃Cl).
    const dup = duplicateClosureRefusal(s);
    if (dup) return { kind: "none", message: dup };
    const c = checkSmiles(s);
    return c.ok ? { kind: "smiles", smiles: s } : { kind: "none", message: c.message };
  }
  const formulaPrefix = /^formula:\s*(.+)$/i.exec(raw);
  if (formulaPrefix) {
    const f = readAsFormula(formulaPrefix[1]);
    if (f) return { kind: "formula", formula: f };
    const v = validateFormula(formulaPrefix[1]);
    return { kind: "none", message: `“${formulaPrefix[1].trim()}” is not a formula: ${v.errors.join("; ") || "SMILES-only syntax"}.` };
  }

  const looked = lookupSmiles(raw);
  if (looked) {
    let note: string | undefined;
    if (mode === "auto" && looked.source === "formula") {
      const asSmiles = readAsSmiles(raw);
      const dict = parseSmilesOnly(looked.smiles);
      if (asSmiles && dict && !sameCounts(oclCounts(asSmiles.getMolecularFormula().formula), oclCounts(dict.getMolecularFormula().formula))) {
        note = `Read as the formula ${typesetHill(validateFormula(raw).hill)}. As SMILES, “${raw}” would be ${describeSmiles(asSmiles)} — write smiles:${raw} for that.`;
      }
    }
    return { kind: "dictionary", source: looked.source, smiles: looked.smiles, note };
  }

  if (mode === "smiles") {
    const dup = duplicateClosureRefusal(raw);
    if (dup) return { kind: "none", message: dup };
    const c = checkSmiles(raw);
    if (c.ok) return { kind: "smiles", smiles: raw };
    return { kind: "none", message: c.invalid ? c.message : `“${raw}” is not a known name or a SMILES string this tool can read.` };
  }

  const f = readAsFormula(raw);
  if (mode === "formula") {
    if (f) return { kind: "formula", formula: f };
    const v = validateFormula(raw);
    return { kind: "none", message: `“${raw}” is not a known name or a formula: ${v.errors.join("; ") || "SMILES-only syntax"}.` };
  }

  const mol = readAsSmiles(raw);
  // Valid SMILES with attachment points (*CC*): the * are atoms, not hydrate dots, so there is no formula reading to
  // weigh against it ("*CC*" is not "carbon, C₂"). A real hydrate (CuSO4*5H2O) is never valid SMILES.
  if (mol && [...Array(mol.getAllAtoms()).keys()].some((i) => mol.getAtomicNo(i) === WILDCARD_SENTINEL_Z)) {
    return { kind: "smiles", smiles: raw };
  }
  if (f && mol) {
    const mf = mol.getMolecularFormula();
    if (sameCounts(f.counts, oclCounts(mf.formula)) && f.charge === netCharge(mol)) {
      // The readings agree ([Fe], FF), so nothing is being guessed — keep the
      // drawable one.
      return { kind: "smiles", smiles: raw, note: `“${raw}” reads the same as a formula and as SMILES.` };
    }
    // BOTH VALID AND DIFFERENT: pick by the pane, never refuse, always name the
    // other reading and the override. Ordinary typed SMILES (CCO, CCl, C1CC1,
    // O) are the commonest input in both panes, so refusing them is wrong.
    //   structure: SMILES wins — it is a structure tool.
    //   massspec:  the FORMULA wins only when the string looks written as a
    //              formula — an explicit count (a digit run other than "1"
    //              after an element or group: a lone "1" is the ring-closure
    //              digit of C1CC1) or a two-letter element symbol other than
    //              Cl/Br (which are SMILES organic-subset atoms: CCl is
    //              chloromethane). Otherwise SMILES wins.
    const formulaNote =
      `Read as the formula ${describeFormula(f)}. As SMILES, “${raw}” would be ${describeSmiles(mol)} — type smiles:${raw} for that.`;
    const smilesNote =
      `Read as SMILES: ${describeSmiles(mol)}. As a formula, “${raw}” would be ${describeFormula(f)} — type formula:${raw} for that.`;
    if (context === "massspec" && looksWrittenAsFormula(raw)) return { kind: "formula", formula: f, note: formulaNote };
    return { kind: "smiles", smiles: raw, note: smilesNote };
  }
  if (f) {
    let note: string | undefined;
    const dup = duplicateRingClosure(raw);
    const invalid = invalidSmilesReason(raw);
    // Written as SMILES (no explicit counts) but not valid SMILES: say so, rather than answer for a formula reading
    // nobody meant — "CCC(C)(C)(C)C" is a five-bonded carbon, not "carbon, C₇".
    if (invalid && !looksWrittenAsFormula(raw)) {
      return { kind: "none", message: `${invalid} As a formula it would be ${describeFormula(f)} — type formula:${raw} for that.` };
    }
    if (invalid) {
      // A lowercase atom in no ring ("Co"): the plain reason — a suggested SMILES rewrite ("CO") would name another substance.
      note = !aromaticAtomsCanBeInRings(raw) ? `Read as a formula. “${raw}” is not valid SMILES: a lowercase (aromatic) atom must sit in a ring.` : `Read as a formula. As SMILES: ${invalid}`;
    } else if (dup !== null && parseSmilesOnly(raw)) {
      note =
        `Read as a formula. “${raw}” is not valid SMILES: ring closure ${dup} would join two atoms that are already bonded.`;
    } else if (parseSmilesOnly(raw)) {
      note = `Read as a formula. “${raw}” is not valid SMILES: a lowercase (aromatic) atom must sit in a ring.`;
    }
    return { kind: "formula", formula: f, note };
  }
  if (mol) return { kind: "smiles", smiles: raw };
  const invalid = invalidSmilesReason(raw);
  const v = validateFormula(raw);
  if (invalid) {
    // A typo'd FORMULA (Fe2(SO4 3) keeps its formula diagnosis beside the SMILES one.
    return { kind: "none", message: `${invalid}${v.errors.length ? ` As a formula: ${v.errors.join("; ")}.` : ""}` };
  }
  const why = v.errors.length ? ` As a formula: ${v.errors.join("; ")}.` : "";
  return { kind: "none", message: `“${raw}” is not a known name, a formula, or a SMILES string this tool can read.${why}` };
}

export type StructureResolution =
  | { kind: "ok"; result: StructureResult; note?: string }
  /** A formula has no single structure to draw. */
  | { kind: "formula"; formula: FormulaReading; message: string }
  /** Both readings are valid and differ; the SMILES reading is drawn for reference only. */
  | { kind: "ambiguous"; formula: FormulaReading; smiles: StructureResult; message: string }
  | { kind: "none"; message: string };

/**
 * Structure mode's mode-aware resolver for TYPED input. renderStructure keeps
 * its legacy order for callers that pass SMILES by construction.
 */
export function resolveStructure(input: string, mode: ChemReadMode = "auto", width = 280, height = 220, opts: DrawOptions = {}): StructureResolution {
  const r = resolveChemInput(input, mode, "structure");
  // The drawing refusals by NAME (too large to lay out, attachment points other than a repeat unit's two), before
  // renderStructure would only say null.
  const refusalFor = (smiles: string): string | null => {
    const c = checkSmiles(smiles);
    return c.ok ? drawRefusal(c, opts) : c.message;
  };
  const repeatNote = (res: StructureResult, note?: string): string | undefined =>
    res.repeatUnit
      ? [note, "Formula and MW are per repeat unit: the two * are the bonds to the neighbouring units (end groups not counted)."]
          .filter(Boolean)
          .join(" ")
      : note;
  switch (r.kind) {
    case "none":
      return r;
    case "dictionary": {
      const why = refusalFor(r.smiles);
      if (why) return { kind: "none", message: why };
      const res = renderStructure(input, width, height, opts);
      return res ? { kind: "ok", result: res, note: r.note } : { kind: "none", message: `The dictionary entry for “${input.trim()}” could not be drawn.` };
    }
    case "smiles": {
      const why = refusalFor(r.smiles);
      if (why) return { kind: "none", message: why };
      const res = renderStructure(`smiles:${r.smiles}`, width, height, opts);
      return res ? { kind: "ok", result: res, note: repeatNote(res, r.note) } : { kind: "none", message: `“${r.smiles}” could not be drawn.` };
    }
    case "formula":
      return {
        kind: "formula",
        formula: r.formula,
        message:
          `“${input.trim()}” is a formula — ${describeFormula(r.formula)} — and a formula has no single structure to draw. ` +
          `For a structure, type a name or a SMILES string.${r.note && /not valid/.test(r.note) ? ` ${r.note}` : ""}`,
      };
    case "ambiguous": {
      const res = renderStructure(`smiles:${r.smiles}`, width, height, opts);
      if (!res) return { kind: "formula", formula: r.formula, message: r.message };
      return { kind: "ambiguous", formula: r.formula, smiles: res, message: r.message };
    }
  }
}

/**
 * One substituent of the Markush gallery (R = …), read exactly as Structure mode reads the same text (resolveStructure:
 * "CO" is what Structure mode draws, "Co" cobalt — a formula, refused by name — never the legacy formula-first
 * renderer's carbon monoxide or radical), with one attachment point (*) allowed for the bond to the parent (*OC).
 */
export function gallerySubstituent(input: string, width = 160, height = 120): { ok: true; result: StructureResult; note?: string } | { ok: false; message: string } {
  const r = resolveStructure(input, "auto", width, height, { substituent: true });
  if (r.kind === "ok") return { ok: true, result: r.result, note: r.note };
  if (r.kind === "ambiguous") return { ok: true, result: r.smiles, note: r.message };
  return { ok: false, message: r.message };
}
