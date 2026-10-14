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
import { validateFormula, normalizeFormulaText } from "./chemValidate";
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
 * Renders a 2D structure SVG for the given input, or returns null when the input
 * is neither a known name/formula nor a parseable SMILES string.
 */
export function renderStructure(input: string, width = 280, height = 220): StructureResult | null {
  // An explicit "smiles:" prefix bypasses the name/formula dictionary. The
  // lookup order (name → formula → SMILES) is right for TYPED input, but a
  // string that is ALREADY a structure must be able to say so: drawn
  // methanol arrives as SMILES "CO", and the formula table would silently
  // render it as carbon monoxide — a different molecule than was drawn.
  const explicit = input.trim().match(/^smiles:\s*(.+)$/i);
  const looked = explicit ? null : lookupSmiles(input);

  let mol: Molecule | null = null;
  let smiles = "";
  let source: StructureResult["source"] = "smiles";

  if (explicit) {
    const candidate = explicit[1].trim();
    mol = safeFromSmiles(candidate);
    smiles = candidate;
  } else if (looked) {
    mol = safeFromSmiles(looked.smiles);
    smiles = looked.smiles;
    source = looked.source;
  } else {
    // Fall back to treating the raw input as SMILES.
    const candidate = input.trim();
    mol = safeFromSmiles(candidate);
    smiles = candidate;
    source = "smiles";
  }

  if (!mol) return null;

  try {
    mol.inventCoordinates();
  } catch {
    // Coordinates may already be present; ignore.
  }

  // autoCrop trims the wide empty margins OpenChemLib leaves around a molecule
  // (the structure itself is drawn at its natural size — we just remove the
  // surrounding whitespace so the inserted image is tight to the structure).
  // Suppress the R/S/"abs" stereo-descriptor text labels: the wedge bonds already
  // convey stereochemistry, and on a stereo-rich molecule (e.g. paclitaxel, 11
  // centres) the CIP/ESR tags pile onto the bonds and read as overlapping clutter.
  const svg = mol.toSVG(width, height, undefined, {
    autoCrop: true,
    autoCropMargin: 8,
    suppressChiralText: true,
    suppressCIPParity: true,
    suppressESR: true,
  });

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
    const mf = mol.getMolecularFormula();
    formula = mf.formula;
    mw = Math.round(mf.relativeWeight * 100) / 100;
  } catch {
    /* ignore */
  }

  return { svg, smiles: canonicalSmiles, source, formula, idcode, mw };
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
  if (charge) {
    const mag = Math.abs(charge) === 1 ? "" : [...String(Math.abs(charge))].map((d) => SUPERSCRIPT[d]).join("");
    out += mag + (charge > 0 ? "⁺" : "⁻");
  }
  return out;
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

/** A valid SMILES reading's molecule, or null. */
function readAsSmiles(input: string): Molecule | null {
  const s = input.trim();
  if (!s || !aromaticAtomsCanBeInRings(s)) return null;
  return safeFromSmiles(s);
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
  try {
    name = nameForIdcode(mol.getIDCode());
  } catch {
    name = null;
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
    return safeFromSmiles(s)
      ? { kind: "smiles", smiles: s }
      : { kind: "none", message: `“${s}” is not a SMILES string this tool can read.` };
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
      const dict = safeFromSmiles(looked.smiles);
      if (asSmiles && dict && !sameCounts(oclCounts(asSmiles.getMolecularFormula().formula), oclCounts(dict.getMolecularFormula().formula))) {
        note = `Read as the formula ${typesetHill(validateFormula(raw).hill)}. As SMILES, “${raw}” would be ${describeSmiles(asSmiles)} — write smiles:${raw} for that.`;
      }
    }
    return { kind: "dictionary", source: looked.source, smiles: looked.smiles, note };
  }

  if (mode === "smiles") {
    return safeFromSmiles(raw)
      ? { kind: "smiles", smiles: raw }
      : { kind: "none", message: `“${raw}” is not a known name or a SMILES string this tool can read.` };
  }

  const f = readAsFormula(raw);
  if (mode === "formula") {
    if (f) return { kind: "formula", formula: f };
    const v = validateFormula(raw);
    return { kind: "none", message: `“${raw}” is not a known name or a formula: ${v.errors.join("; ") || "SMILES-only syntax"}.` };
  }

  const mol = readAsSmiles(raw);
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
    if (safeFromSmiles(raw)) {
      note = `Read as a formula. “${raw}” is not valid SMILES: a lowercase (aromatic) atom must sit in a ring.`;
    }
    return { kind: "formula", formula: f, note };
  }
  if (mol) return { kind: "smiles", smiles: raw };
  const v = validateFormula(raw);
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
export function resolveStructure(input: string, mode: ChemReadMode = "auto", width = 280, height = 220): StructureResolution {
  const r = resolveChemInput(input, mode, "structure");
  switch (r.kind) {
    case "none":
      return r;
    case "dictionary": {
      const res = renderStructure(input, width, height);
      return res ? { kind: "ok", result: res, note: r.note } : { kind: "none", message: `The dictionary entry for “${input.trim()}” could not be drawn.` };
    }
    case "smiles": {
      const res = renderStructure(`smiles:${r.smiles}`, width, height);
      return res ? { kind: "ok", result: res, note: r.note } : { kind: "none", message: `“${r.smiles}” could not be drawn.` };
    }
    case "formula":
      return {
        kind: "formula",
        formula: r.formula,
        message:
          `“${input.trim()}” is a formula — ${describeFormula(r.formula)} — and a formula has no single structure to draw. ` +
          `For a structure, type a name or a SMILES string.`,
      };
    case "ambiguous": {
      const res = renderStructure(`smiles:${r.smiles}`, width, height);
      if (!res) return { kind: "formula", formula: r.formula, message: r.message };
      return { kind: "ambiguous", formula: r.formula, smiles: res, message: r.message };
    }
  }
}
