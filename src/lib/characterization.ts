// Characterization text for Example sections: ¹H / ¹³C NMR lists, HRMS, elemental
// analysis, yield, mp and Rf — read from what the chemist types or pastes, written in
// journal form, and checked the way a referee would check them (docs/SCOPE-CHARACTERIZATION.md).
//
// Every value printed is the chemist's own measurement: nothing here fills in a predicted
// shift or a plausible Found value. The only numbers this module computes are the ones a
// paper calls "Calcd" (from the formula) and the yield arithmetic.
//
// Output is ONE html string per line (<i>, <sub>, <sup> only), so the pane's preview and the
// Word insert (bibOoxml.inlineParagraphsOoxml → runs) are the same text.

import { Molecule } from "openchemlib";
import { resolveChemInput } from "./structures";
import { compositionFromMolecule } from "./massspec";
import { ELECTRON_MASS, elementIsotopes, elementRefusal, isotopeMass } from "./isotopes";
import { carbonEnvironmentCount } from "./nmr";
import { atomicNumber, atomicWeight } from "./periodic";

/** Where the format and the tolerances come from — shown in the pane. */
export const CHAR_SOURCE =
  "Format and tolerances: J. Org. Chem. Author Guidelines (ACS Researcher Resources, read 2026-10-20) — " +
  "¹H to 0.01 ppm, ¹³C to 0.1 ppm, ¹³C{¹H} for decoupled spectra, HRMS Found within 0.003 m/z, " +
  "C/H/N within 0.4 %. Calcd m/z: AME2020 isotope masses; molar mass and analysis: IUPAC conventional atomic weights.";

export type CharStyle = "joc" | "common";
export type Nucleus = "1H" | "13C";

export interface CharMessage {
  level: "error" | "warn" | "info";
  text: string;
}

/** HRMS Found tolerance, m/z units (JOC). */
export const HRMS_TOLERANCE = 0.003;
/** Elemental analysis tolerance, absolute percent (JOC). */
export const EA_TOLERANCE = 0.4;

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

/** Escapes user text for the html the formatter emits. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MINUS = "−";
const EN_DASH = "–";

/** A typed number with its sign written as a true minus. */
function signed(s: string): string {
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

/**
 * Rounds a typed decimal STRING half-up to `dp` places, by its digits (7.255 → 7.26, which
 * Number.toFixed gets wrong). A value typed with fewer places is left as typed — padding
 * 7.3 to 7.30 would claim a precision nobody measured.
 */
export function roundTyped(s: string, dp: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = ""] = m;
  if (frac.length <= dp) return s;
  const digits = (int + frac.slice(0, dp)).split("").map(Number);
  if (Number(frac[dp]) >= 5) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i] === 9) {
        digits[i] = 0;
        i--;
      } else {
        digits[i]++;
        break;
      }
    }
    if (i < 0) digits.unshift(1);
  }
  const all = digits.join("");
  const intPart = all.slice(0, all.length - dp) || "0";
  const out = dp ? `${intPart}.${all.slice(all.length - dp)}` : intPart;
  return /^0(\.0*)?$/.test(out) ? out : sign + out;
}

const decimals = (s: string): number => (s.split(".")[1] ?? "").length;

// ---------------------------------------------------------------------------
// The compound
// ---------------------------------------------------------------------------

export interface CharCompound {
  /** Natural-abundance element counts (may be fractional for a hydrate typed as a formula). */
  counts: Record<string, number>;
  /** Named isotopes ([2H] / D, [13C]). */
  labelled: { symbol: string; A: number; count: number }[];
  netCharge: number;
  fractional: boolean;
  /** The structure, when the input was one (null for a formula: structure checks are skipped). */
  mol: Molecule | null;
  /** Number of separate parts (a salt drawn as two ions is 2). */
  parts: number;
  /** The formula as html (Hill order, or as typed for a hydrate). */
  formulaHtml: string;
  note?: string;
}

/** Hill order: C, H (then D), the rest alphabetical; with no carbon, all alphabetical. */
function hillHtml(counts: Record<string, number>, labelled: CharCompound["labelled"]): string {
  const els = Object.keys(counts).filter((e) => counts[e] > 0);
  for (const l of labelled) if (!els.includes(l.symbol) && !(l.symbol === "H" && l.A === 2)) els.push(l.symbol);
  const hasC = els.includes("C") || labelled.some((l) => l.symbol === "C");
  const order = hasC
    ? ["C", "H", ...els.filter((e) => e !== "C" && e !== "H").sort()]
    : [...els].sort();
  const n = (k: number): string => (k === 1 ? "" : `<sub>${k}</sub>`);
  let out = "";
  for (const el of order) {
    const c = counts[el] ?? 0;
    if (c > 0) out += el + n(c);
    for (const l of labelled) {
      if (l.symbol !== el) continue;
      out += l.symbol === "H" && l.A === 2 ? `D${n(l.count)}` : l.symbol === "H" && l.A === 3 ? `T${n(l.count)}` : `<sup>${l.A}</sup>${el}${n(l.count)}`;
    }
  }
  if (!hasC || !order.includes("H")) {
    // D with no natural H written above only when H is in the order list.
    for (const l of labelled) if (l.symbol === "H" && l.A === 2 && !order.includes("H")) out += `D${n(l.count)}`;
  }
  return out;
}

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻";
/** A typeset Unicode formula (C₁₃H₁₇NO₃·½H₂O) as html runs. */
function unicodeFormulaHtml(s: string): string {
  let out = "";
  let mode: "" | "sub" | "sup" = "";
  for (const ch of s) {
    const sub = SUBS.indexOf(ch);
    const sup = SUPS.indexOf(ch);
    const want = sub >= 0 ? "sub" : sup >= 0 ? "sup" : "";
    if (want !== mode) {
      if (mode) out += `</${mode}>`;
      if (want) out += `<${want}>`;
      mode = want;
    }
    out += sub >= 0 ? String(sub) : sup >= 0 ? "0123456789+−"[sup] : esc(ch);
  }
  if (mode) out += `</${mode}>`;
  return out;
}

/** A typed formula without its "formula:" prefix. */
/** A typed formula without its "formula:" prefix, Unicode digits as ASCII (C₁₃H₁₇NO₃ → C13H17NO3). */
const typedFormula = (input: string): string => {
  let t = "";
  for (const ch of input.trim().replace(/^formula:\s*/i, "")) {
    const sub = SUBS.indexOf(ch);
    const sup = SUPS.indexOf(ch);
    t += sub >= 0 ? String(sub) : sup >= 0 ? "0123456789+-"[sup] : ch;
  }
  return t;
};

/**
 * A typed formula with every part separator written "·": "·", "•", "*", and a "." that is not a
 * decimal point — C13H17NO3.HCl and NO3.2HCl separate; the "." of a coefficient (·0.5H2O) does not.
 */
function dotted(input: string): string {
  const t = typedFormula(input);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "•" || ch === "*") {
      out += "·";
      continue;
    }
    if (ch === "." && /\d/.test(t[i + 1] ?? "")) {
      // Decimal point when the digits before it start a coefficient (after "·", a space or the start).
      let k = i;
      while (k > 0 && /\d/.test(t[k - 1])) k--;
      const before = k > 0 ? t[k - 1] : "";
      out += k < i && !/[A-Za-z)\]]/.test(before) ? "." : "·";
      continue;
    }
    out += ch === "." ? "·" : ch;
  }
  return out;
}

/** Parts of a typed formula: C13H17NO3·HCl, C13H17NO3.HCl, C13H17NO3*H2O → 2. */
function typedParts(input: string): number {
  return dotted(input).split("·").filter((x) => x.trim()).length;
}

/** A typed formula as html, as written (C13H17NO3·HCl): counts after an element or ")" lowered, coefficients not. */
function typedFormulaHtml(input: string): string {
  const t = dotted(input).replace(/\s*·\s*/g, "·");
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    // A charge at the end of a part (C4H12N+·Cl-) is raised, with a true minus.
    if ((ch === "+" || ch === "-") && (i + 1 === t.length || t[i + 1] === "·")) {
      out += `<sup>${ch === "+" ? "+" : MINUS}</sup>`;
      continue;
    }
    if (/\d/.test(ch) && i > 0 && /[A-Za-z)\]]/.test(t[i - 1])) {
      let j = i;
      while (j < t.length && /[\d.]/.test(t[j])) j++;
      out += `<sub>${t.slice(i, j)}</sub>`;
      i = j - 1;
    } else {
      out += esc(ch);
    }
  }
  return out;
}

/**
 * The compound named by a name, formula or SMILES (the Mass Spec resolver). An ambiguous
 * input (CN: cyanide or HCN?) is refused with the resolver's own wording — the chemist
 * writes formula: or smiles: to choose.
 */
export function resolveCompound(input: string): CharCompound | { refusal: string } {
  const r = resolveChemInput(input, "auto", "massspec");
  if (r.kind === "none") return { refusal: r.message };
  if (r.kind === "ambiguous") return { refusal: r.message };
  if (r.kind === "formula") {
    const f = r.formula;
    const counts: Record<string, number> = {};
    const labelled: CharCompound["labelled"] = [];
    for (const [k, v] of Object.entries(f.counts)) {
      if (k === "D") labelled.push({ symbol: "H", A: 2, count: v });
      else if (k === "T") labelled.push({ symbol: "H", A: 3, count: v });
      else counts[k] = v;
    }
    return {
      counts,
      labelled,
      netCharge: f.charge,
      fractional: f.fractional,
      mol: null,
      // C13H17NO3·HCl is two parts: HRMS measures the parent, never the salt as one ion. Read from
      // what was TYPED — the reading's display merges whole adducts into one Hill formula.
      parts: typedParts(input),
      formulaHtml: typedParts(input) > 1 ? typedFormulaHtml(input) : /[·.]/.test(f.display) ? unicodeFormulaHtml(f.display) : hillHtml(counts, labelled),
      note: "Read as a formula: the checks that need the structure (exchangeable protons, distinct carbons) are skipped.",
    };
  }
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(r.smiles);
  } catch {
    return { refusal: `“${input.trim()}” could not be read as a structure.` };
  }
  if (!mol.getAllAtoms()) return { refusal: `“${input.trim()}” could not be read as a structure.` };
  return compoundFromMolecule(mol);
}

/** The compound for a drawn structure (Build). */
export function compoundFromMolecule(mol: Molecule): CharCompound | { refusal: string } {
  const comp = compositionFromMolecule(mol);
  if (typeof comp === "string") return { refusal: comp };
  let netCharge = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) netCharge += mol.getAtomCharge(i);
  const frag = new Array<number>(mol.getAllAtoms());
  const parts = mol.getAllAtoms() ? mol.getFragmentNumbers(frag, false, false) : 0;
  const labelled = comp.labelled ?? [];
  return {
    counts: comp.natural,
    labelled,
    netCharge,
    fractional: false,
    mol,
    parts,
    formulaHtml: hillHtml(comp.natural, labelled),
  };
}

function massOf(counts: Record<string, number>, labelled: CharCompound["labelled"], kind: "mono" | "average"): number | string {
  let m = 0;
  for (const [el, n] of Object.entries(counts)) {
    if (!n) continue;
    if (kind === "average") {
      // IUPAC conventional atomic weights — the same table as the Build readout's MW.
      const z = atomicNumber(el);
      const w = z === null ? null : atomicWeight(z);
      if (w === null) return `No atomic weight for ${el}.`;
      m += n * w;
      continue;
    }
    const e = elementIsotopes(el);
    if (!e) return elementRefusal(el) ?? `No isotope data for ${el}.`;
    m += n * e.mostAbundant.mass;
  }
  for (const l of labelled) {
    const lm = isotopeMass(l.symbol, l.A);
    if (lm === null) return `No mass for ${l.A}${l.symbol}.`;
    m += l.count * lm;
  }
  return m;
}

/** Average molar mass, g/mol. */
export function molarMass(c: CharCompound): number | string {
  return massOf(c.counts, c.labelled, "average");
}

/** ¹H atoms in the formula (deuterium and tritium are not ¹H). */
export function protonCount(c: CharCompound): number {
  return (c.counts.H ?? 0) + c.labelled.filter((l) => l.symbol === "H" && l.A === 1).reduce((s, l) => s + l.count, 0);
}

/** Protons on O, N and S — the ones that exchange in D₂O / CD₃OD and are often broad or missing. */
export function exchangeableProtons(c: CharCompound): number | null {
  if (!c.mol) return null;
  const mol = c.mol;
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  let n = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    const z = mol.getAtomicNo(i);
    if (z !== 7 && z !== 8 && z !== 16) continue;
    // ¹H only: an O–D (an explicit [2H] neighbour) gives no ¹H signal to miss.
    n += mol.getImplicitHydrogens(i);
    for (let k = 0; k < mol.getAllConnAtoms(i); k++) {
      const h = mol.getConnAtom(i, k);
      if (mol.getAtomicNo(h) === 1 && (mol.getAtomMass(h) === 0 || mol.getAtomMass(h) === 1)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Solvents
// ---------------------------------------------------------------------------

interface Solvent {
  key: string;
  html: string;
  aliases: string[];
  /** OH/NH protons exchange with the solvent's deuterium and usually vanish. */
  exchanges?: boolean;
}

export const SOLVENTS: Solvent[] = [
  { key: "CDCl3", html: "CDCl<sub>3</sub>", aliases: ["cdcl3", "chloroform-d", "chloroform-d1", "deuterochloroform", "chloroform"] },
  { key: "DMSO-d6", html: "DMSO-<i>d</i><sub>6</sub>", aliases: ["dmso-d6", "dmso", "dimethylsulfoxide-d6", "dimethylsulphoxide-d6", "(cd3)2so"] },
  { key: "CD3OD", html: "CD<sub>3</sub>OD", aliases: ["cd3od", "methanol-d4", "methanol-d", "meod-d4", "meod", "methanol"], exchanges: true },
  { key: "D2O", html: "D<sub>2</sub>O", aliases: ["d2o", "deuteriumoxide", "water-d2", "deuteratedwater"], exchanges: true },
  { key: "acetone-d6", html: "acetone-<i>d</i><sub>6</sub>", aliases: ["acetone-d6", "(cd3)2co", "acetone"] },
  { key: "C6D6", html: "C<sub>6</sub>D<sub>6</sub>", aliases: ["c6d6", "benzene-d6", "benzene"] },
  { key: "CD2Cl2", html: "CD<sub>2</sub>Cl<sub>2</sub>", aliases: ["cd2cl2", "dichloromethane-d2", "methylenechloride-d2", "dichloromethane"] },
  { key: "CD3CN", html: "CD<sub>3</sub>CN", aliases: ["cd3cn", "acetonitrile-d3", "acetonitrile"] },
  { key: "THF-d8", html: "THF-<i>d</i><sub>8</sub>", aliases: ["thf-d8", "tetrahydrofuran-d8"] },
  { key: "toluene-d8", html: "toluene-<i>d</i><sub>8</sub>", aliases: ["toluene-d8", "c7d8", "c6d5cd3"] },
  { key: "pyridine-d5", html: "pyridine-<i>d</i><sub>5</sub>", aliases: ["pyridine-d5", "c5d5n"] },
];

/** A solvent as typed (CDCl3, CDCl₃, Chloroform-d, DMSO-d₆) → its entry, or null. */
export function findSolvent(typed: string): Solvent | null {
  let k = "";
  for (const ch of typed.toLowerCase()) {
    const sub = SUBS.indexOf(ch);
    k += sub >= 0 ? String(sub) : ch === EN_DASH ? "-" : ch;
  }
  k = k.replace(/\s+/g, "");
  return SOLVENTS.find((s) => s.key.toLowerCase() === k || s.aliases.includes(k)) ?? null;
}

// ---------------------------------------------------------------------------
// NMR lists: parse
// ---------------------------------------------------------------------------

export interface NmrPeak {
  /** The shift as typed; for a range, the HIGH end. */
  shift: string;
  /** The low end of a range, as typed. */
  low?: string;
  /** Normalized multiplicity: s, d, dd, br s, app t, m, … */
  mult?: string;
  /** Coupling constants as typed, in order. */
  J: string[];
  /** The label of each J value ("" = none; HF, C–F), parallel to J. */
  jLabels: string[];
  /** The bond count of each J ("" = not given; "1" for ¹J), parallel to J. */
  jBonds: string[];
  /** Integration (¹H) as typed: "2" for 2H. */
  nH?: string;
  /** Carbon count (¹³C, "2C"), as typed. */
  nC?: string;
  /** Anything else in the parenthesis (an assignment), as typed. */
  assign?: string;
  /** The segment this peak was read from. */
  source: string;
}

export interface NmrParse {
  nucleus: Nucleus;
  /** The nucleus the pasted header named, when it named one. */
  headerNucleus?: Nucleus;
  freq?: string;
  /** The solvent as found in the header (an entry, or the typed text). */
  solvent?: Solvent | { typed: string };
  peaks: NmrPeak[];
  /** Segments that could not be read as a peak — named, never dropped. */
  unread: string[];
  /** Header items other than frequency and solvent (a temperature, TMS), printed as typed. */
  headerExtras?: string[];
  /** What could not be read safely as a whole (decimal commas, a second list) — said as errors. */
  issues: string[];
}

const MULT_WORDS: Record<string, string> = {
  singlet: "s", doublet: "d", triplet: "t", quartet: "q", quintet: "quint", pentet: "p",
  sextet: "sext", septet: "sept", heptet: "hept", multiplet: "m", quin: "quint",
};
const MULT_CORE = /^(?:s|d|t|q|p|m|quint|sext|sept|hept|(?:d|t|q|p){2,4})$/;

/** A multiplicity token → normalized form, or null when it is not one. */
export function normalizeMult(tok: string): string | null {
  let t = tok.trim().toLowerCase().replace(/\.(?=\s|$)/g, "").replace(/\s+/g, " ");
  if (!t) return null;
  let prefix = "";
  const pre = /^(br|broad|bs|brs|bd|bt|app|apparent)\b\s*/.exec(t);
  if (t === "bs" || t === "brs" || t === "br s") return "br s";
  if (t === "bd" || t === "brd" || t === "br d") return "br d";
  if (t === "bt" || t === "br t") return "br t";
  if (t === "br" || t === "broad") return "br";
  if (pre) {
    prefix = /^(br|broad)/.test(pre[1]) ? "br " : "app ";
    t = t.slice(pre[0].length);
    const more = /^(app|apparent)\s*/.exec(t);
    if (more && prefix === "br ") {
      prefix = "br app ";
      t = t.slice(more[0].length);
    }
  }
  t = t.replace(/\s+/g, " ");
  const words = t.split(" ").map((w) => MULT_WORDS[w] ?? w);
  const core = words.join(" ");
  if (core === "broad s") return "br s";
  if (MULT_CORE.test(core)) return prefix + core;
  if (/^(?:s|d|t|q|p|m)( (?:s|d|t|q|p|m))+$/.test(core)) return prefix + core;
  return null;
}

/** How many coupling constants a multiplicity names (dd → 2), or null for m / br. */
export function couplingsFor(mult: string): number | null {
  const core = mult.replace(/^(br app |br |app )/, "");
  if (core === "m" || mult === "br") return null;
  if (core === "s") return 0;
  if (["quint", "sext", "sept", "hept"].includes(core)) return 1;
  const letters = core.replace(/ /g, "");
  if (/^[dtqp]+$/.test(letters)) return letters.length;
  return null;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const NUM_POS = String.raw`\d+(?:\.\d+)?`;

// No-break, thin, narrow no-break and zero-width spaces — built from code points so no
// invisible character sits in this source.
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f, 0x200b)}]`, "g");

/** Normalizes dashes, minus signs, tildes, thin spaces and line ends. */
function normalizeText(s: string): string {
  return s
    .replace(/[‐‑‒–—]/g, EN_DASH)
    .replace(/−/g, "-")
    .replace(/[∼～]/g, "~")
    .replace(ODD_SPACES, " ")
    .replace(/\r\n?/g, "\n");
}

const HEADER = new RegExp(
  String.raw`^\s*(?:(1H|¹H|13C|¹³C)[\s-]*(?:\{\s*(?:1H|¹H)\s*\})?[\s-]*NMR\b)?\s*(?:(?:δ|delta)\s*(H|C)(?![a-z]))?\s*(?:\(([^)]*)\))?\s*:?\s*(?:δ|delta)?\s*(?:\(\s*ppm\s*\))?\s*(?:ppm)?\s*[:=]?\s*`,
  "i"
);

/** "353 K", "25 °C", "rt", "298K" — a temperature in a header. */
const TEMPERATURE = /^(?:-?\d+(?:\.\d+)?\s*(?:K|°\s*C|℃)|rt|r\.t\.|room temperature)$/i;

/** A second NMR heading inside a list ("… 2.10 (s, 3H). 13C NMR (101 MHz …"). */
const SECOND_HEADER = /(?:^|[\s.;,])((?:1H|¹H|13C|¹³C)[\s-]*(?:\{\s*(?:1H|¹H)\s*\})?[\s-]*NMR\b|δ\s*[HC](?![a-z]))/i;

/** Reads the header's parenthesis: frequency, solvent, and anything else (printed as typed). */
function readHeaderParts(inside: string, out: NmrParse): void {
  const extras: string[] = [];
  let typedSolvent: string | null = null;
  for (const part of inside.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    const f = new RegExp(String.raw`^(${NUM_POS})\s*MHz$`, "i").exec(part);
    if (f) {
      out.freq = f[1];
      continue;
    }
    const known = findSolvent(part);
    if (known && !(out.solvent && "key" in out.solvent)) {
      out.solvent = known;
      continue;
    }
    if (!known && !TEMPERATURE.test(part) && typedSolvent === null && !/^\d/.test(part)) {
      typedSolvent = part;
      continue;
    }
    extras.push(part);
  }
  // The first item that is not a frequency, a known solvent or a temperature is taken as the
  // solvent only when no known solvent was named; otherwise it is printed as typed, in place.
  if (typedSolvent !== null) {
    if (out.solvent) extras.unshift(typedSolvent);
    else out.solvent = { typed: typedSolvent };
  }
  if (extras.length) out.headerExtras = extras;
}

/**
 * Reads a pasted list: a MestReNova / journal paragraph ("¹H NMR (400 MHz, Chloroform-d) δ
 * 7.36 – 7.27 (m, 5H), …"), the RSC form ("δH (400 MHz; CDCl3) 7.26 (2H, d, J 8.4)") or one
 * signal per line ("7.26 d 8.0 2H"). Every segment is either a peak or listed in `unread`;
 * what cannot be read safely (decimal commas, a second list) is said in `issues`.
 */
export function parseNmr(text: string, nucleus: Nucleus): NmrParse {
  const out: NmrParse = { nucleus, peaks: [], unread: [], issues: [] };
  let body = normalizeText(text).trim();
  if (!body) return out;
  const h = HEADER.exec(body);
  if (h && h[0].trim()) {
    // Only treat the match as a header when it held something header-like; a bare list
    // starting "7.26 (d…" must not lose its first parenthesis to the header pattern.
    const isHeader = h[1] || h[2] || /δ|delta|ppm/i.test(h[0]) || (h[3] !== undefined && /MHz|[a-z]{2}/i.test(h[3]) && !/^\s*\d/.test(body));
    if (isHeader) {
      if (h[1]) out.headerNucleus = /^(1H|¹H)$/i.test(h[1]) ? "1H" : "13C";
      else if (h[2]) out.headerNucleus = /^h$/i.test(h[2]) ? "1H" : "13C";
      if (h[3] !== undefined) readHeaderParts(h[3], out);
      body = body.slice(h[0].length);
      // "1H NMR 400 MHz, CDCl3 δ 7.26 …" — the header's items without parentheses.
      const bare = h[3] === undefined ? /^([^δ()]{0,80}?MHz[^δ()]{0,60}?)\s*[:,]?\s*δ\s*:?\s*/i.exec(body) : null;
      if (bare) {
        readHeaderParts(bare[1], out);
        body = body.slice(bare[0].length);
      }
    }
  }
  // A second list pasted in the same box: cut there and say so — its numbers are not this nucleus's.
  // Only outside parentheses: "(s, 3H, assigned by 1H NMR NOE)" is an assignment, not a list.
  const at = topLevelIndex(body, SECOND_HEADER);
  if (at >= 0) {
    out.issues.push(`A second NMR list starts at “${body.slice(at, at + 24).trim()}…” — it was left out; paste it in its own box.`);
    body = body.slice(0, at);
  }
  body = body.replace(/[\s.;,]+$/, "").trim();
  // A comma between digits outside parentheses (7,26; 128,4; 77,160) is a decimal comma or a
  // missing space — either way the signals cannot be told apart: refused by name, nothing read.
  // Inside parentheses "J = 8,2 Hz" stays two integer couplings.
  // (Two decimals run together, "170.1,128.4", are a missing space only — read as two values.)
  if (topLevelIndex(body, /(?<![\d.])\d+,\d+(?![\d.])/) >= 0) {
    out.issues.push("A comma sits between digits with no space (7,26 or 128,4): decimal commas, or a missing space? Write decimal points (7.26) and separate signals with “, ”.");
    out.unread.push(body);
    return out;
  }
  const segs: string[] = [];
  for (const line of splitTopLevel(body, /\n/)) {
    // One signal per line ("6.90 dd 8.0, 2.0 1H"): a comma there may sit inside "J = 8.0, 2.1"
    // and must not split the signal. Decided per line, so a paste can mix the two forms.
    const lineFormat = !/[()]/.test(line) && new RegExp(String.raw`^${NUM}(?:\s*(?:${EN_DASH}|-|~|to)\s*${NUM})?\s+(?!ppm\b)[a-z]`, "i").test(line);
    if (!lineFormat) {
      segs.push(...splitTopLevel(line, /[;,]/));
      continue;
    }
    // In the line format a comma may sit inside "8.0, 2.0" — but a comma followed by a new
    // signal ("…1H, 6.90 d 2H": a shift, then a word) still separates two signals.
    const nextSignal = new RegExp(String.raw`,(?=\s*${NUM}(?:\s*(?:${EN_DASH}|-|~|to)\s*${NUM})?\s+(?!Hz\b)[A-Za-z])`);
    for (const part of splitTopLevel(line, /;/)) segs.push(...part.split(nextSignal).map((x) => x.trim()).filter(Boolean));
  }
  for (const seg of segs) {
    // A J value list split by a top-level comma ("…J = 8.0, 2.1 Hz" written without
    // parentheses): a bare "2.1 Hz" continues the previous peak's couplings.
    const jCont = new RegExp(String.raw`^(${NUM_POS})\s*Hz$`, "i").exec(seg);
    if (jCont && out.peaks.length && out.peaks[out.peaks.length - 1].J.length) {
      const prev = out.peaks[out.peaks.length - 1];
      prev.J.push(jCont[1]);
      prev.jLabels.push(prev.jLabels[prev.jLabels.length - 1] ?? "");
      prev.jBonds.push(prev.jBonds[prev.jBonds.length - 1] ?? "");
      prev.source += `, ${seg}`;
      continue;
    }
    if (/^ppm$/i.test(seg)) continue;
    // A ¹³C list separated by spaces only ("170.9 128.4 21.0"): each number is a signal.
    if (nucleus === "13C" && new RegExp(String.raw`^${NUM}(?:\s+${NUM})+$`).test(seg)) {
      for (const v of seg.split(/\s+/)) out.peaks.push({ shift: v, J: [], jLabels: [], jBonds: [], source: v });
      continue;
    }
    const p = parsePeak(seg, nucleus);
    if (p) out.peaks.push(p);
    else out.unread.push(seg);
  }
  return out;
}

/** The first index where `re` matches outside parentheses / brackets, or −1. */
function topLevelIndex(s: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const depthAt: number[] = [];
  let d = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") d++;
    depthAt.push(d);
    if ((ch === ")" || ch === "]") && d > 0) d--;
  }
  // depthAt is per UTF-16 unit only for BMP text; the inputs here are BMP (no astral characters).
  let m: RegExpExecArray | null;
  while ((m = g.exec(s))) {
    const i = m.index + (m[1] !== undefined ? m[0].indexOf(m[1]) : 0);
    if (!depthAt[i]) return i;
    if (m[0] === "") g.lastIndex++;
  }
  return -1;
}

/** A shift starting the text after a closing parenthesis: "3.50 (", "3.50," or a decimal shift. */
const NEXT_SHIFT = new RegExp(String.raw`^-?\d+(?:\.\d+(?![A-Za-z])|(?=\s*(?:\(|[,;]|$|\s+-?\d)))`);

/**
 * Splits at the separators outside parentheses — and after a closing parenthesis followed by a
 * new shift ("7.26 (s, 1H) 3.50 (s, 3H)" is two segments) or by words ("… (s, 1H) see SI": the
 * words become their own segment, named as unread). Digits that are not a shift ("(CH) 2C",
 * "(s, 6H) 2 × CH3") stay with the peak, which is then not read and is named whole.
 */
function splitTopLevel(s: string, separators: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (depth === 0 && /\)\s*$/.test(cur) && /\S/.test(ch) && !separators.test(ch)) {
      const ahead = s.slice(i);
      if (!/^\d/.test(ahead) || NEXT_SHIFT.test(ahead)) {
        out.push(cur);
        cur = "";
      }
    }
    if (ch === "(" || ch === "[") depth++;
    if ((ch === ")" || ch === "]") && depth > 0) depth--;
    if (depth === 0 && separators.test(ch)) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

/** One J value: a number, or a range "7.0–7.5" — never a number that is an integration (2H) or carbon count (2C). */
const J_VALUE = String.raw`\d+(?:\.\d+)?(?:\s*[${EN_DASH}-]\s*\d+(?:\.\d+)?)?(?![\d.]*\s*[HC]\b)`;

function parsePeak(seg: string, nucleus: Nucleus): NmrPeak | null {
  // A number run into a letter ("2C", "13C-labelled", "2H") is never a shift.
  const m = new RegExp(String.raw`^(${NUM})(?!(?!ppm)[A-Za-z×])(?:\s*(?:${EN_DASH}|-|~|to)\s*(${NUM})(?!(?!ppm)[A-Za-z×]))?\s*(?:ppm)?(.*)$`, "s").exec(seg);
  if (!m) return null;
  const peak: NmrPeak = { shift: m[1], J: [], jLabels: [], jBonds: [], source: seg };
  if (m[2] !== undefined) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === b) return null;
    peak.shift = a > b ? m[1] : m[2];
    peak.low = a > b ? m[2] : m[1];
  }
  let rest = m[3].trim();
  // "7.26 [d, J = 8.0 Hz, 2H]": square brackets read as parentheses.
  if (/^\[[^[\]]*\]$/.test(rest)) rest = `(${rest.slice(1, -1)})`;
  let inner = rest;
  if (rest.startsWith("(")) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "(") depth++;
      else if (rest[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    // Text after the parenthesis is never folded into the peak (splitTopLevel parts it off).
    if (end < 0 || rest.slice(end + 1).trim()) return null;
    inner = rest.slice(1, end);
  } else {
    rest = rest.replace(/^,\s*/, "");
    // "6.5 ± 0.1 (br s, 1H)", "3.50 and 3.45 (2 × s, 3H)": a parenthesis that does not follow
    // the shift belongs to something this reader does not take apart — not read, named.
    if (/[()]/.test(rest)) return null;
    // A ¹³C value carries its notes in parentheses; words after a bare value ("21.1 see SI",
    // "21.0. HRMS") are not an assignment — not read, named.
    if (nucleus === "13C" && rest) return null;
    inner = rest;
  }
  // Coupling constants: "J = 8.0, 2.1 Hz", "J = 8.0 Hz, J = 2.1 Hz", "JHF = 47.5 Hz", "J(C,F) = 245 Hz", "J 8.4".
  const jRe = new RegExp(
    String.raw`([¹²³⁴]|(?<![A-Za-z\d])\d(?=\s*J))?\s*J\s*(?:\d(?=\s*=))?\s*(?:\(\s*([^)]*)\)|_?\{?([A-Z][a-z]?\s*[${EN_DASH},-]?\s*[A-Z]?[a-z]?)\}?)?\s*=?\s*(${J_VALUE}(?:\s*(?:,|and|&|/)\s*${J_VALUE})*)\s*(?:Hz)?`,
    "g"
  );
  let jm: RegExpExecArray | null;
  let stripped = inner;
  while ((jm = jRe.exec(inner))) {
    // ¹J / ²J / ³J: the bond count is kept and printed (¹J_CF and ²J_CF are different couplings).
    const bond = jm[1] ? String("¹²³⁴".indexOf(jm[1]) >= 0 ? "¹²³⁴".indexOf(jm[1]) + 1 : jm[1]) : "";
    const label = (jm[2] ?? jm[3] ?? "").replace(/\s+/g, "").replace(/[,-]/g, EN_DASH);
    for (const v of jm[4].split(/\s*(?:,|and|&|\/)\s*/)) {
      if (!v) continue;
      peak.J.push(v.replace(/\s*[–-]\s*/, EN_DASH));
      peak.jLabels.push(label);
      peak.jBonds.push(bond);
    }
    stripped = stripped.replace(jm[0], " ");
  }
  // Split at commas — but not one between two digits, which belongs to an assignment (H-2,6; C-3,5).
  const toks = stripped
    .split(/(?<!\d),|,(?!\d)/)
    .map((t) => t.trim())
    .filter((t) => t && !/^Hz$/i.test(t));
  const left: string[] = [];
  for (const tok of toks) {
    const nH = new RegExp(String.raw`^(${NUM_POS})\s*H$`).exec(tok);
    const nC = new RegExp(String.raw`^(${NUM_POS})\s*C$`).exec(tok);
    const moreJ = new RegExp(String.raw`^(${NUM_POS})\s*Hz$`, "i").exec(tok);
    if (nH && peak.nH === undefined && nucleus === "1H") {
      peak.nH = nH[1];
      continue;
    }
    if (nC && peak.nC === undefined) {
      peak.nC = nC[1];
      continue;
    }
    // "J = 8.0 Hz, 2.0 Hz": a second value written with its own unit continues the couplings.
    if (moreJ && peak.J.length) {
      peak.J.push(moreJ[1]);
      peak.jLabels.push(peak.jLabels[peak.jLabels.length - 1] ?? "");
      peak.jBonds.push(peak.jBonds[peak.jBonds.length - 1] ?? "");
      continue;
    }
    const mult = peak.mult === undefined ? normalizeMult(tok) : null;
    if (mult) {
      peak.mult = mult;
      continue;
    }
    // Line format without parentheses: "7.26 d 8.0 2H" / "7.26 dd J=8.0 2H".
    if (!rest.startsWith("(")) {
      const words = tok.split(/\s+/);
      const unk: string[] = [];
      for (let k = 0; k < words.length; k++) {
        const w = words[k];
        const wH = new RegExp(String.raw`^(${NUM_POS})H$`).exec(w);
        const wC = new RegExp(String.raw`^(${NUM_POS})C$`).exec(w);
        // "br s", "app t": two words read together before either alone ("br" is a multiplicity too).
        const pair = peak.mult === undefined && k + 1 < words.length && /^(?:br|broad|app|apparent)\.?$/i.test(w) ? normalizeMult(`${w} ${words[k + 1]}`) : null;
        const wm = peak.mult === undefined ? normalizeMult(w) : null;
        if (pair) {
          peak.mult = pair;
          k++;
        }
        else if (wH && peak.nH === undefined && nucleus === "1H") peak.nH = wH[1];
        else if (wC && peak.nC === undefined) peak.nC = wC[1];
        else if (wm) peak.mult = wm;
        // A coupling comes after the multiplicity and before the integration; a number after
        // the integration is a stray value (a signal run in without its comma) — not read.
        else if (new RegExp(String.raw`^${NUM_POS}$`).test(w) && peak.mult && couplingsFor(peak.mult) && peak.nH === undefined && peak.nC === undefined) {
          peak.J.push(w);
          peak.jLabels.push("");
          peak.jBonds.push("");
        }
        else if (/^Hz$/i.test(w)) continue;
        // A number with no place in the line format (a second shift, a stray value) is not
        // folded into an assignment: the segment is not read, and is named.
        else if (new RegExp(String.raw`^[-±+]?${NUM_POS}$`).test(w) || w === "±") return null;
        else unk.push(w);
      }
      // "br s" typed as two words in line format.
      if (unk.length) {
        const joined = normalizeMult(unk.join(" "));
        if (joined && peak.mult === undefined) peak.mult = joined;
        else left.push(unk.join(" "));
      }
      continue;
    }
    left.push(tok);
  }
  if (left.length) peak.assign = left.join(", ");
  return peak;
}

// ---------------------------------------------------------------------------
// NMR lists: format
// ---------------------------------------------------------------------------

function shiftText(s: string, nucleus: Nucleus, style: CharStyle): string {
  return signed(style === "joc" ? roundTyped(s, nucleus === "1H" ? 2 : 1) : s);
}

function peakHtml(p: NmrPeak, nucleus: Nucleus, style: CharStyle): string {
  let s = shiftText(p.shift, nucleus, style);
  if (p.low !== undefined) {
    const low = shiftText(p.low, nucleus, style);
    // Rounding must never collapse a range (1.304–1.296 → 1.30–1.30): such a range keeps its typed digits.
    s = low === s ? `${signed(p.shift)}${EN_DASH}${signed(p.low)}` : `${s}${EN_DASH}${low}`;
  }
  const parts: string[] = [];
  // Consecutive values with the same label share one "J = a, b Hz"; a new label starts a new group.
  const groups: { label: string; bond: string; values: string[] }[] = [];
  p.J.forEach((v, i) => {
    const label = p.jLabels[i] ?? "";
    const bond = p.jBonds[i] ?? "";
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.bond === bond) last.values.push(v);
    else groups.push({ label, bond, values: [v] });
  });
  const jPart = groups
    .map((g) => `${g.bond ? `<sup>${esc(g.bond)}</sup>` : ""}<i>J</i>${g.label ? `<sub>${esc(g.label)}</sub>` : ""} = ${g.values.map(esc).join(", ")} Hz`)
    .join(", ");
  const count = p.nH !== undefined ? `${esc(p.nH)}H` : p.nC !== undefined ? `${esc(p.nC)}C` : "";
  if (p.mult) parts.push(esc(p.mult));
  if (style === "joc") {
    if (count) parts.push(count);
    if (jPart) parts.push(jPart);
  } else {
    if (jPart) parts.push(jPart);
    if (count) parts.push(count);
  }
  if (p.assign) parts.push(esc(p.assign));
  return parts.length ? `${s} (${parts.join(", ")})` : s;
}

export interface NmrFormatOptions {
  style: CharStyle;
  /** Overrides the header's frequency (MHz, as typed). */
  freq?: string;
  /** Overrides the header's solvent (a SOLVENTS key or typed text). */
  solvent?: string;
}

/** The frequency the line prints: the pane's (a number; "400 MHz" typed there is read as 400), else the header's. */
function freqOf(parse: NmrParse, o: NmrFormatOptions): string | undefined {
  const typed = (o.freq ?? "").trim().replace(/\s*MHz\s*$/i, "");
  if (typed && new RegExp(String.raw`^${NUM_POS}$`).test(typed)) return typed;
  return parse.freq;
}

/** A typed frequency that is not a number — said, and the header's (if any) used instead. */
function badFreq(o: NmrFormatOptions): string | null {
  const typed = (o.freq ?? "").trim().replace(/\s*MHz\s*$/i, "");
  return typed && !new RegExp(String.raw`^${NUM_POS}$`).test(typed) ? (o.freq ?? "").trim() : null;
}

/** The solvent the line prints: the pane's choice, else the pasted header's. */
function solventOf(parse: NmrParse, o: NmrFormatOptions): Solvent | { typed: string } | undefined {
  if (o.solvent && o.solvent.trim()) return findSolvent(o.solvent) ?? { typed: o.solvent.trim() };
  return parse.solvent;
}

/** The journal line, as html. Peaks are listed high δ to low, as journals list them. */
export function formatNmr(parse: NmrParse, o: NmrFormatOptions): string {
  const nucleus = parse.nucleus;
  const freq = freqOf(parse, o);
  const solv = solventOf(parse, o);
  const solvHtml = solv ? ("key" in solv ? solv.html : esc(solv.typed)) : "";
  const freqHtml = freq ? `${esc(freq)} MHz` : "";
  const head = nucleus === "1H" ? "<sup>1</sup>H NMR" : o.style === "joc" ? "<sup>13</sup>C{<sup>1</sup>H} NMR" : "<sup>13</sup>C NMR";
  const extras = (parse.headerExtras ?? []).map(esc);
  const inParen = [...(o.style === "joc" ? [solvHtml, freqHtml] : [freqHtml, solvHtml]), ...extras].filter(Boolean).join(", ");
  const lead = `${head}${inParen ? ` (${inParen})` : ""}${o.style === "joc" ? ":" : ""} δ `;
  const peaks = parse.peaks
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(b.p.shift) - Number(a.p.shift) || a.i - b.i)
    .map(({ p }) => peakHtml(p, nucleus, o.style));
  return `${lead}${peaks.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// NMR lists: checks
// ---------------------------------------------------------------------------

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** What a referee would query in a list — against the compound when there is one. */
export function checkNmr(parse: NmrParse, compound: CharCompound | null, o: NmrFormatOptions): CharMessage[] {
  const msgs: CharMessage[] = [];
  const nuc = parse.nucleus === "1H" ? "¹H" : "¹³C";
  if (parse.headerNucleus && parse.headerNucleus !== parse.nucleus) {
    msgs.push({ level: "error", text: `The pasted header says ${parse.headerNucleus === "1H" ? "¹H" : "¹³C"} NMR, but this is the ${nuc} box.` });
  }
  for (const i of parse.issues) msgs.push({ level: "error", text: i });
  for (const u of parse.unread) msgs.push({ level: "error", text: `Not read as a signal, and left out of the line: “${u}”.` });
  if (!parse.peaks.length) return msgs;
  const bad = badFreq(o);
  if (bad) msgs.push({ level: "warn", text: `Frequency “${bad}” is not a number of MHz — left out${parse.freq ? `; the header's ${parse.freq} MHz is used` : ""}.` });
  if (parse.headerExtras?.length) msgs.push({ level: "info", text: `From the header, printed as typed: ${parse.headerExtras.join(", ")}.` });
  const freq = freqOf(parse, o);
  if (!freq) msgs.push({ level: "warn", text: `No spectrometer frequency (MHz) — journals ask for it.` });
  const solv = solventOf(parse, o);
  if (!solv) msgs.push({ level: "warn", text: `No solvent — journals ask for it.` });
  else if (!("key" in solv)) msgs.push({ level: "info", text: `Solvent “${solv.typed}” is printed as typed (not one of the deuterated solvents this tool typesets).` });
  // The Solvent menu overrides the header — said when the two disagree.
  if (o.solvent && o.solvent.trim() && parse.solvent) {
    const hdr = "key" in parse.solvent ? parse.solvent.key : parse.solvent.typed;
    const menu = solv && "key" in solv ? solv.key : o.solvent.trim();
    if (hdr !== menu) msgs.push({ level: "warn", text: `The pasted header names ${hdr}; the Solvent menu's ${menu} is printed.` });
  }

  const lo = parse.nucleus === "1H" ? -5 : -50;
  const hi = parse.nucleus === "1H" ? 20 : 260;
  const shifts = parse.peaks.flatMap((p) => [p.shift, ...(p.low !== undefined ? [p.low] : [])]);
  const odd = shifts.filter((s) => Number(s) < lo || Number(s) > hi);
  if (odd.length) msgs.push({ level: "warn", text: `δ ${odd.map(signed).join(", ")} is outside the usual ${nuc} range (${signed(String(lo))} to ${hi} ppm) — wrong box?` });
  if (parse.nucleus === "13C" && parse.peaks.length >= 3 && parse.peaks.every((p) => Number(p.shift) < 13)) {
    msgs.push({ level: "warn", text: `Every shift is below 13 ppm — this looks like ¹H data in the ¹³C box.` });
  }
  const want = parse.nucleus === "1H" ? 2 : 1;
  const lowPrecision = parse.peaks.filter((p) => decimals(p.shift) < want).map((p) => signed(p.shift));
  if (o.style === "joc" && lowPrecision.length) {
    msgs.push({ level: "info", text: `${lowPrecision.join(", ")} given to fewer than ${want} decimal place${want > 1 ? "s" : ""}; JOC asks for ${nuc} to ${want === 2 ? "0.01" : "0.1"} ppm (printed as typed, not padded).` });
  }

  for (const p of parse.peaks) {
    const where = `δ ${signed(p.shift)}${p.low !== undefined ? EN_DASH + signed(p.low) : ""}`;
    if (parse.nucleus === "1H") {
      if (!p.mult) msgs.push({ level: "warn", text: `${where} has no multiplicity.` });
      if (p.nH === undefined) msgs.push({ level: "warn", text: `${where} has no integration (nH).` });
    }
    if (p.mult) {
      const n = couplingsFor(p.mult);
      if (n === 0 && p.J.length) msgs.push({ level: "warn", text: `${where} is a ${p.mult} but lists ${p.J.length === 1 ? "a J value" : `${p.J.length} J values`}.` });
      else if (n !== null && n > 0 && p.J.length !== n) {
        msgs.push({ level: "warn", text: `${where} is a ${p.mult}, which needs ${n} J value${n > 1 ? "s" : ""}; ${p.J.length || "none"} given.` });
      }
    }
    if (parse.nucleus === "1H") {
      const homo = (l: string): boolean => !l || /^H[–,]?H$/i.test(l);
      const big = p.J.filter((j, i) => homo(p.jLabels[i] ?? "") && (Number(j.split(EN_DASH).pop()) > 25 || Number(j.split(EN_DASH)[0]) <= 0));
      if (big.length) msgs.push({ level: "warn", text: `${where}: J = ${big.join(", ")} Hz is outside 0–25 Hz for ¹H–¹H coupling (a heteronuclear J? label it, e.g. J_HF).` });
    }
  }

  if (!compound) return msgs;
  if (parse.nucleus === "1H") {
    const given = parse.peaks.reduce((s, p) => s + (p.nH !== undefined ? Number(p.nH) : 0), 0);
    const total = protonCount(compound);
    const ex = exchangeableProtons(compound);
    if (compound.parts > 1) msgs.push({ level: "info", text: "The formula has more than one part (a salt or solvate): its ¹H count includes the protons of every part." });
    const exchanging = solv && "key" in solv && solv.exchanges;
    if (parse.peaks.some((p) => p.nH !== undefined)) {
      if (given > total + 1e-9) {
        msgs.push({ level: "error", text: `The integrations add up to ${fmtNum(given)}H, but the formula has ${total} ¹H — more protons than the compound has.` });
      } else if (given < total - 1e-9) {
        const missing = total - given;
        // OH/NH/SH protons the list already gives (by their assignment) cannot be the missing ones.
        const listedEx = parse.peaks
          .filter((p) => p.nH !== undefined && /\b(?:OH|NH2?|NH3|SH|CO2H|COOH)\b/.test(p.assign ?? ""))
          .reduce((s2, p) => s2 + Number(p.nH), 0);
        const exLeft = ex === null ? null : Math.max(0, ex - listedEx);
        let why = "";
        if (exLeft !== null && exLeft > 0) {
          const unlisted = listedEx ? ` not listed` : "";
          why = exchanging
            ? ` The structure has ${exLeft} OH/NH/SH proton${exLeft > 1 ? "s" : ""}${unlisted}, which exchange with ${solv && "key" in solv ? solv.html.replace(/<[^>]+>/g, "") : "the solvent"} and are expected to be absent${missing > exLeft ? `; that leaves ${fmtNum(missing - exLeft)}H unaccounted for` : ""}.`
            : ` The structure has ${exLeft} OH/NH/SH proton${exLeft > 1 ? "s" : ""}${unlisted}, which are often broad or not observed${missing > exLeft ? `; that leaves ${fmtNum(missing - exLeft)}H unaccounted for` : ""}.`;
        }
        msgs.push({ level: exLeft !== null && missing <= exLeft ? "info" : "warn", text: `The integrations add up to ${fmtNum(given)}H; the formula has ${total} ¹H (${fmtNum(missing)} not listed).${why}` });
      } else {
        msgs.push({ level: "info", text: `The integrations add up to ${total}H, matching the formula.` });
      }
    }
  } else {
    const carbons = (compound.counts.C ?? 0) + compound.labelled.filter((l) => l.symbol === "C").reduce((s, l) => s + l.count, 0);
    const listed = parse.peaks.reduce((s, p) => s + (p.nC !== undefined ? Number(p.nC) : 1), 0);
    const plain = parse.peaks.length;
    const env = compound.mol ? carbonEnvironmentCount(compound.mol) : null;
    if (listed > carbons) {
      msgs.push({ level: "error", text: `${listed} carbon${listed > 1 ? "s" : ""} listed, but the formula has ${carbons}.` });
    } else if (env !== null) {
      const split = parse.peaks.filter((p) => p.J.length).length;
      if (plain > env) {
        msgs.push({ level: "warn", text: `${plain} signals listed; the structure has ${env} symmetry-distinct carbons.${split ? ` ${split} entr${split > 1 ? "ies carry" : "y carries"} a J (C–F / C–P doublets count once each).` : " Rotamers, or a coupled carbon listed as two lines?"}` });
      } else if (plain < env) {
        msgs.push({ level: "info", text: `${plain} signals listed; the structure has ${env} symmetry-distinct carbons (overlapping signals are common).` });
      } else {
        msgs.push({ level: "info", text: `${plain} signals listed, matching the structure's ${env} symmetry-distinct carbons.` });
      }
      // "128.6 (2C)" counts carbons, not environments: checked against the formula when given.
      if (parse.peaks.some((p) => p.nC !== undefined) && listed !== carbons) {
        msgs.push({ level: "info", text: `With the nC counts, ${listed} of the formula's ${carbons} carbons are accounted for.` });
      }
    }
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// HRMS
// ---------------------------------------------------------------------------

export interface IonType {
  id: string;
  /** The bracket, as html: [M + H]<sup>+</sup>. */
  html: string;
  /** Plain label for the pane's select. */
  label: string;
  /** Signed charge. */
  z: number;
  /** Atoms added (negative: removed). */
  add: Record<string, number>;
  /** Written at the end of the formula rather than merged (JOC: C13H17NO3Na). */
  appended?: string;
  radical?: boolean;
}

export const ION_TYPES: IonType[] = [
  { id: "M+H", label: "[M + H]⁺", html: "[M + H]<sup>+</sup>", z: 1, add: { H: 1 } },
  { id: "M+Na", label: "[M + Na]⁺", html: "[M + Na]<sup>+</sup>", z: 1, add: { Na: 1 }, appended: "Na" },
  { id: "M+K", label: "[M + K]⁺", html: "[M + K]<sup>+</sup>", z: 1, add: { K: 1 }, appended: "K" },
  { id: "M+NH4", label: "[M + NH₄]⁺", html: "[M + NH<sub>4</sub>]<sup>+</sup>", z: 1, add: { N: 1, H: 4 } },
  { id: "M+2H", label: "[M + 2H]²⁺", html: "[M + 2H]<sup>2+</sup>", z: 2, add: { H: 2 } },
  { id: "M+", label: "[M] — the ion as drawn (a cation or anion)", html: "[M]<sup>+</sup>", z: 1, add: {} },
  { id: "M+.", label: "[M]⁺• (EI radical cation)", html: "[M]<sup>+•</sup>", z: 1, add: {}, radical: true },
  { id: "M-H", label: "[M − H]⁻", html: "[M − H]<sup>−</sup>", z: -1, add: { H: -1 } },
  { id: "M+Cl", label: "[M + Cl]⁻", html: "[M + Cl]<sup>−</sup>", z: -1, add: { Cl: 1 } },
  { id: "M+HCOO", label: "[M + HCOO]⁻", html: "[M + HCOO]<sup>−</sup>", z: -1, add: { C: 1, H: 1, O: 2 } },
  { id: "M-2H", label: "[M − 2H]²⁻", html: "[M − 2H]<sup>2−</sup>", z: -2, add: { H: -2 } },
];

export interface HrmsOptions {
  ion: string;
  source?: string;
  analyzer?: string;
  found?: string;
  style: CharStyle;
}

export interface HrmsResult {
  html: string;
  calcd: number;
  /** The ion's formula as html. */
  ionFormulaHtml: string;
  messages: CharMessage[];
  /** Found − Calcd, when a Found value was given. */
  delta?: number;
  ppm?: number;
}

/** The ion: its composition, formula and calculated m/z — or a refusal by name. */
export function ionOf(c: CharCompound, ionId: string): { ion: IonType; mz: number; formulaHtml: string } | { refusal: string } {
  const ion = ION_TYPES.find((i) => i.id === ionId);
  if (!ion) return { refusal: `Unknown ion type “${ionId}”.` };
  if (c.fractional) return { refusal: "The formula has a fractional part (a hydrate or solvate written with a fraction), which is not one ion. Enter the compound itself for HRMS." };
  if (c.parts > 1) {
    return {
      refusal: c.mol
        ? "The structure has more than one part (a salt drawn as separate ions). HRMS measures one ion: enter that ion alone (the cation, for [M]⁺)."
        : "The formula has more than one part (a salt or solvate, e.g. ·HCl). HRMS measures one ion: enter the parent compound (the free base or acid) alone.",
    };
  }
  let z = ion.z;
  if (c.netCharge !== 0) {
    if (ion.id !== "M+") {
      return { refusal: `The structure already carries a charge (${c.netCharge > 0 ? "+" : MINUS}${Math.abs(c.netCharge)}), so adduct ions do not apply. Choose [M] — the ion as drawn.` };
    }
    z = c.netCharge;
  } else if (ion.id === "M+") {
    return { refusal: "[M] is for a structure drawn as an ion (a quaternary ammonium, a phosphonium, a carboxylate). For a neutral compound choose [M + H]⁺, an adduct, or [M]⁺• for EI." };
  }
  const counts: Record<string, number> = { ...c.counts };
  const appendedPresent = ion.appended ? (counts[ion.appended] ?? 0) > 0 : false;
  for (const [el, n] of Object.entries(ion.add)) {
    const now = (counts[el] ?? 0) + n;
    if (now < 0) return { refusal: `${ion.label} removes ${-n} H, but the compound has ${counts[el] ?? 0} ¹H.` };
    counts[el] = now;
  }
  const mass = massOf(counts, c.labelled, "mono");
  if (typeof mass === "string") return { refusal: mass };
  const mz = (mass - z * ELECTRON_MASS) / Math.abs(z);
  let formulaHtml: string;
  if (ion.appended && !appendedPresent) {
    const base = { ...counts };
    delete base[ion.appended];
    formulaHtml = hillHtml(base, c.labelled) + ion.appended;
  } else {
    formulaHtml = hillHtml(counts, c.labelled);
  }
  const zHtml = Math.abs(z) === 1 ? (z > 0 ? "+" : MINUS) : `${Math.abs(z)}${z > 0 ? "+" : MINUS}`;
  // [M] takes its charge from the structure — an anion is [M]⁻, a dication [M]²⁺.
  const theIon = ion.id === "M+" ? { ...ion, z, html: `[M]<sup>${zHtml}</sup>` } : ion;
  return { ion: theIon, mz, formulaHtml };
}

/** The HRMS sentence, with the Found check. */
export function hrmsLine(c: CharCompound, o: HrmsOptions): HrmsResult | { refusal: string } {
  const got = ionOf(c, o.ion);
  if ("refusal" in got) return got;
  const msgs: CharMessage[] = [];
  const calcdText = got.mz.toFixed(4);
  const src = [o.source?.trim(), o.analyzer?.trim()].filter(Boolean).map((s) => esc(s as string)).join("/");
  const calcdWord = o.style === "joc" ? "Calcd" : "calcd";
  const foundWord = o.style === "joc" ? "Found" : "found";
  let html = `HRMS${src ? ` (${src})` : ""} <i>m</i>/<i>z</i>: ${got.ion.html} ${calcdWord} for ${got.formulaHtml} ${calcdText}`;
  const res: HrmsResult = { html: "", calcd: got.mz, ionFormulaHtml: got.formulaHtml, messages: msgs };
  const f = (o.found ?? "").trim();
  if (f) {
    if (!new RegExp(String.raw`^${NUM_POS}$`).test(f)) return { refusal: `Found “${f}” is not a number.` };
    html += `; ${foundWord} ${esc(f)}`;
    // Against the Calcd as printed (4 places), so "+0.0030" and "within 0.003" never disagree on the page.
    const delta = Math.round((Number(f) - Number(calcdText)) * 1e6) / 1e6;
    res.delta = delta;
    // ppm from the exact values (the tolerance above uses the printed Calcd).
    res.ppm = ((Number(f) - got.mz) / got.mz) * 1e6;
    // A ppm figure for a gross mismatch (a wrong ion, a typo) is noise: the Δ alone is said.
    const ppmText = Math.abs(res.ppm) < 1000 ? `${res.ppm >= 0 ? "+" : MINUS}${Math.abs(res.ppm).toFixed(1)} ppm` : "";
    if (decimals(f) < 4) msgs.push({ level: "warn", text: `Found is given to ${decimals(f)} decimal place${decimals(f) === 1 ? "" : "s"}; HRMS values are reported to 4.` });
    if (Math.abs(delta) <= HRMS_TOLERANCE + 1e-9) {
      msgs.push({ level: "info", text: `Found − Calcd = ${delta >= 0 ? "+" : MINUS}${Math.abs(delta).toFixed(4)} (${ppmText}), within JOC's 0.003 m/z.` });
    } else {
      msgs.push({ level: "error", text: `Found − Calcd = ${delta >= 0 ? "+" : MINUS}${Math.abs(delta).toFixed(4)}${ppmText ? ` (${ppmText})` : ""} — outside JOC's 0.003 m/z.` });
      for (const other of ION_TYPES) {
        if (other.id === got.ion.id || Math.sign(other.z) !== Math.sign(got.ion.z || 1)) continue;
        const alt = ionOf(c, other.id);
        if ("refusal" in alt) continue;
        if (Math.abs(Number(f) - alt.mz) <= HRMS_TOLERANCE) {
          msgs.push({ level: "warn", text: `Found matches ${other.label} (Calcd ${alt.mz.toFixed(4)}) — is that the ion observed?` });
        }
      }
    }
  } else {
    msgs.push({ level: "warn", text: "No Found value yet — the line ends at Calcd." });
  }
  res.html = `${html}.`;
  return res;
}

// ---------------------------------------------------------------------------
// Elemental analysis
// ---------------------------------------------------------------------------

export interface EaResult {
  html: string;
  calcd: Record<string, number>;
  messages: CharMessage[];
}

const EA_ELEMENTS = ["C", "H", "N", "S"];

/** "Anal. Calcd for …: C, 66.36; H, 7.28; N, 5.95. Found: C, …" — found values as typed. */
export function eaLine(c: CharCompound, found: Record<string, string>): EaResult | { refusal: string } {
  if (c.netCharge !== 0) return { refusal: "The compound is drawn or written as an ion; combustion analysis is of a neutral substance — enter the salt (cation and anion together)." };
  if (c.labelled.length) return { refusal: "The compound has labelled atoms (D, ¹³C); combustion-analysis Calcd values for labelled compounds are not computed here." };
  const mw = molarMass(c);
  if (typeof mw === "string") return { refusal: mw };
  const msgs: CharMessage[] = [];
  const given = EA_ELEMENTS.filter((e) => (found[e] ?? "").trim());
  for (const e of given) {
    if (!new RegExp(String.raw`^${NUM_POS}$`).test(found[e].trim())) return { refusal: `Found ${e} “${found[e].trim()}” is not a number.` };
  }
  const els = given.length ? given : EA_ELEMENTS.filter((e) => (c.counts[e] ?? 0) > 0);
  const calcd: Record<string, number> = {};
  for (const e of els) {
    const w = atomicWeight(atomicNumber(e) as number) as number;
    calcd[e] = (((c.counts[e] ?? 0) * w) / mw) * 100;
    if (!(c.counts[e] ?? 0) && given.includes(e)) msgs.push({ level: "warn", text: `Found ${e} given, but the formula has no ${e}.` });
  }
  let html = `Anal. Calcd for ${c.formulaHtml}: ${els.map((e) => `${e}, ${calcd[e].toFixed(2)}`).join("; ")}.`;
  if (given.length) {
    html += ` Found: ${given.map((e) => `${e}, ${esc(found[e].trim())}`).join("; ")}.`;
    for (const e of given) {
      const d = Number(found[e]) - calcd[e];
      if (Math.abs(d) > EA_TOLERANCE + 1e-9) msgs.push({ level: "error", text: `${e}: Found − Calcd = ${d >= 0 ? "+" : MINUS}${Math.abs(d).toFixed(2)} — outside JOC's 0.4 %.` });
    }
    if (!msgs.some((m) => m.level === "error")) msgs.push({ level: "info", text: "Every Found value is within 0.4 % of Calcd." });
  } else {
    msgs.push({ level: "warn", text: "No Found values yet — the line gives Calcd only." });
  }
  return { html, calcd, messages: msgs };
}

// ---------------------------------------------------------------------------
// Yield, mp, Rf
// ---------------------------------------------------------------------------

export interface PhysicalInput {
  /** Mass obtained, mg (as typed). */
  massMg?: string;
  /** Limiting reagent, mmol (as typed). */
  scaleMmol?: string;
  /** "white solid", "colorless oil". */
  state?: string;
  /** "123–125", "123-125 °C", "> 250 (dec)". */
  mp?: string;
  rf?: string;
  /** Eluent for Rf: "hexanes/EtOAc 4:1". */
  eluent?: string;
}

export interface PhysicalResult {
  /** Each sentence, html. */
  lines: string[];
  messages: CharMessage[];
  yieldPct?: number;
}

function sig3(n: number): string {
  if (n >= 100) return String(Math.round(n));
  const s = n.toPrecision(3);
  // Never exponent notation in an Example ("6.66e-8 mmol"): fixed digits to three figures.
  return s.includes("e") ? n.toFixed(Math.min(20, 2 - Math.floor(Math.log10(n)))) : s;
}

/** "a white solid", "an orange oil". */
function article(word: string): string {
  // "an 8:1 mixture", "an 11:1 mixture": the article goes by the sound of the number.
  // "a uniform solid", "a one-to-one mixture"; "an hour-old", "an unknown".
  if (/^(?:one|once|uni|use|usu|ure|ura|eu)/i.test(word)) return "a";
  return /^(?:[aeiou]|hour|honou?r|heir|8|11(?!\d)|18(?!\d))/i.test(word) ? "an" : "a";
}

/** The physical-data sentences: yield (mass, mmol, %), mp, Rf. */
export function physicalLines(c: CharCompound | null, p: PhysicalInput): PhysicalResult | { refusal: string } {
  const msgs: CharMessage[] = [];
  const lines: string[] = [];
  const res: PhysicalResult = { lines, messages: msgs };
  const mass = (p.massMg ?? "").trim();
  const scale = (p.scaleMmol ?? "").trim();
  const state = (p.state ?? "").trim();
  if (mass) {
    if (!new RegExp(String.raw`^${NUM_POS}$`).test(mass) || !(Number(mass) > 0)) return { refusal: `Mass “${mass}” is not a positive number of mg.` };
    const inner: string[] = [`${esc(mass)} mg`];
    if (c) {
      const mw = molarMass(c);
      if (typeof mw === "string") return { refusal: mw };
      const mmol = Number(mass) / mw;
      inner.push(`${sig3(mmol)} mmol`);
      if (scale) {
        if (!new RegExp(String.raw`^${NUM_POS}$`).test(scale) || !(Number(scale) > 0)) return { refusal: `Scale “${scale}” is not a positive number of mmol.` };
        const pct = (mmol / Number(scale)) * 100;
        res.yieldPct = pct;
        inner.push(pct >= 10 ? `${Math.round(pct)}%` : pct >= 0.1 ? `${pct.toFixed(1)}%` : "<0.1%");
        if (pct > 100.5) msgs.push({ level: "error", text: `The yield is ${Math.round(pct)}% — more than the limiting reagent allows (solvent, salt or wrong scale?).` });
      }
    } else if (scale) {
      msgs.push({ level: "warn", text: "No compound, so the mmol and the yield cannot be computed." });
    }
    lines.push(state ? `Obtained as ${article(state)} ${esc(state)} (${inner.join(", ")}).` : `Yield: ${inner.join(", ")}.`);
  } else if (state) {
    lines.push(`Obtained as ${article(state)} ${esc(state)}.`);
  }
  const mp = (p.mp ?? "").trim();
  if (mp) {
    let t = normalizeText(mp)
      .replace(/^mp\.?\s*:?\s*/i, "")
      .replace(/℃/g, "°C")
      .replace(/(\d)\s*(?:°\s*|o\s*)?C\b/g, "$1 °C")
      .replace(/(\d)\s*[-–]\s*(?=-?\d)/g, `$1${EN_DASH}`)
      .replace(/(^|[\s(–~])-(?=\d)/g, `$1${MINUS}`);
    // °C goes once, right after the temperatures ("123–125 °C (dec.)"), unless it is already there.
    if (!/°C/.test(t)) {
      const lead = new RegExp(String.raw`^([<>≤≥]?\s*${MINUS}?\d+(?:\.\d+)?(?:\s*(?:${EN_DASH}|to)\s*${MINUS}?\d+(?:\.\d+)?)?)`).exec(t);
      t = lead ? `${lead[1]} °C${t.slice(lead[1].length)}` : `${t} °C`;
    }
    lines.push(`mp ${esc(t)}.`);
  }
  const rf = (p.rf ?? "").trim();
  if (rf) {
    if (!/^(?:0?\.\d+|0|1(?:\.0+)?)$/.test(rf)) return { refusal: `R_f “${rf}” is not a value between 0 and 1.` };
    const el = (p.eluent ?? "").trim();
    lines.push(`<i>R</i><sub>f</sub> = ${esc(rf.startsWith(".") ? `0${rf}` : rf)}${el ? ` (${esc(el)})` : ""}.`);
    if (!el) msgs.push({ level: "warn", text: "An R_f without its eluent cannot be reproduced." });
  }
  return res;
}

/** Plain text of an html line (for search, tests and screen readers). */
export function htmlText(html: string): string {
  return html
    .replace(/<sup>1<\/sup>H/g, "¹H")
    .replace(/<sup>13<\/sup>C/g, "¹³C")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
