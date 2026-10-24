// Chemical equation balancer — exact, by the integer NULL SPACE of the
// element + charge conservation matrix.
//
// WHY A NULL SPACE AND NOT A SEARCH. A balancing is a vector x with A·x = 0,
// where A has one row per element plus a CHARGE row and one column per species
// (+ on the left, − on the right). The set of all balancings is the null space
// of A intersected with the positive orthant. Its dimension decides the answer:
//
//   dim 0   nothing balances it. We name the conserved quantity that fails
//           (an element on one side only; else the smallest set of rows that
//           together admit no solution).
//   dim 1   the unique balancing, scaled to the smallest positive integers —
//           or a refusal naming the species forced to 0 or to the wrong side.
//   dim ≥2  NO unique answer. Every positive combination of the independent
//           reactions balances it. chempy prints ONE "minimal" answer here
//           (C + O₂ → CO + CO₂ as 3, 2, 2, 1); we refuse by name and show the
//           extreme rays of the cone instead, which is the complete answer.
//
// EXACT ARITHMETIC. The rref is over BigInt fractions. The K₄Fe(CN)₆ case
// reaches 299, and rref intermediates pass 2⁵³ long before the coefficients
// do — a Number path would print wrong integers silently.
//
// OWN COMPOSITION READER. The shared validateFormula reads CaSO4·0.5H2O as
// 0 then 5 (H₁₀O₉), skips spaces silently (H2 O → H₂O) and counts a leading
// coefficient as a hydrate multiplier. Species are therefore read here, with
// rational hydrate coefficients, and cross-checked against validateFormula
// only where that reader is known to be right (integer hydrates).
//
// HONEST LIMITS. Mass and charge conservation only: nothing here says whether
// a reaction happens, which products form, or anything thermodynamic. Organic
// species are balanced by formula; constitution is ignored. No oxidation
// states are assigned.

import { Molecule } from "openchemlib";
import { PERIODIC, isElement, normalizeFormulaText, validateFormula } from "./chemValidate";
import { lookupSmiles } from "./structures";

// Hydrogen isotopes written as their own symbols (D₂O, NaOD, T₂). They are
// conserved separately from ¹H in a balance; masses are the AME2020 atomic
// masses of ²H and ³H.
const ISOTOPE_MASS: Record<string, number> = { D: 2.01410177812, T: 3.0160492779 };
function isElementOrIsotope(sym: string): boolean {
  return isElement(sym) || sym in ISOTOPE_MASS;
}

// ---------------------------------------------------------------- rationals

/** An exact rational number, always reduced, denominator > 0. */
export interface Rat {
  n: bigint;
  d: bigint;
}

const absB = (a: bigint): bigint => (a < 0n ? -a : a);
function gcdB(a: bigint, b: bigint): bigint {
  a = absB(a);
  b = absB(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new Error("zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdB(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const R0 = rat(0n);
const R1 = rat(1n);
const radd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const rsub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const rmul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
const rdiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
const rIsZero = (a: Rat): boolean => a.n === 0n;
const rEq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
/** Exact text: "3", "9/2". */
export function ratText(a: Rat): string {
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}
export function ratToNumber(a: Rat): number {
  return Number(a.n) / Number(a.d);
}

// -------------------------------------------------------------- typesetting

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const toSub = (digits: string): string => digits.replace(/\d/g, (c) => SUB[+c]);
const toSup = (digits: string): string => digits.replace(/\d/g, (c) => SUP[+c]);

function chargeDisplay(q: number): string {
  if (q === 0) return "";
  const sign = q > 0 ? "⁺" : "⁻";
  const m = Math.abs(q);
  return (m === 1 ? "" : toSup(String(m))) + sign;
}
function chargeAscii(q: number): string {
  if (q === 0) return "";
  // ALWAYS the caret form. "H2+" would re-read as the monatomic H²⁺, so the
  // ASCII spelling of H₂⁺ must be "H2^+".
  const m = Math.abs(q);
  return "^" + (m === 1 ? "" : String(m)) + (q > 0 ? "+" : "-");
}

// ------------------------------------------------------------------ species

export interface Species {
  /** The text as typed for this species (trimmed, coefficient included). */
  input: string;
  /** Canonical ASCII formula WITHOUT coefficient or state — re-parseable. */
  formula: string;
  /** Typeset formula WITHOUT coefficient, WITH state symbol: Fe₂O₃(s), MnO₄⁻. */
  display: string;
  /** Element → exact count (rational: CaSO₄·0.5H₂O has O = 9/2). */
  counts: Record<string, Rat>;
  /** Net charge. */
  charge: number;
  /** State symbol as typed, e.g. "(aq)", or null. */
  state: string | null;
  /** True for the electron e⁻. */
  electron: boolean;
  /** A coefficient typed in front of the species, or null. */
  coefficient: Rat | null;
  coefficientText: string | null;
  /** Set when the species was a dictionary NAME (e.g. "water"). */
  resolvedName: string | null;
  /** Hill formula of the composition, typeset (used to SAY what a name resolved to). */
  hillDisplay: string;
  /** g/mol from IUPAC conventional weights (electron: 0). */
  molarMass: number;
}

export type SpeciesParse = { ok: true; species: Species } | { ok: false; error: string };

const STATE_RE = /\s*\((s|l|g|aq|cr)\)\s*$/i;
const VULGAR: Record<string, [bigint, bigint]> = {
  "½": [1n, 2n], "⅓": [1n, 3n], "⅔": [2n, 3n], "¼": [1n, 4n], "¾": [3n, 4n], "⅛": [1n, 8n],
};

/** Reads a leading coefficient. Decimals and fractions only when `fractional`. */
function readCoefficient(s: string, fractional: boolean): { value: Rat; text: string; rest: string } | null {
  let m: RegExpExecArray | null;
  if (fractional) {
    if ((m = /^(\d+)\/(\d+)(?=\s)/.exec(s))) {
      if (BigInt(m[2]) === 0n) return null;
      return { value: rat(BigInt(m[1]), BigInt(m[2])), text: m[0], rest: s.slice(m[0].length) };
    }
    if ((m = /^(\d*)([½⅓⅔¼¾⅛])/.exec(s))) {
      const [a, b] = VULGAR[m[2]];
      const whole = m[1] ? BigInt(m[1]) : 0n;
      return { value: rat(whole * b + a, b), text: m[0], rest: s.slice(m[0].length) };
    }
    if ((m = /^(\d+)\.(\d+)/.exec(s))) {
      const scale = 10n ** BigInt(m[2].length);
      return { value: rat(BigInt(m[1]) * scale + BigInt(m[2]), scale), text: m[0], rest: s.slice(m[0].length) };
    }
  }
  if ((m = /^\d+/.exec(s))) return { value: rat(BigInt(m[0])), text: m[0], rest: s.slice(m[0].length) };
  return null;
}

interface Composition {
  counts: Record<string, Rat>;
  charge: number;
  formula: string;
  display: string;
  /** All hydrate coefficients integral and only "·" / "." used — the shared reader can be trusted. */
  sharedReaderComparable: boolean;
}

/** Nonmetals: a digit before "+" on one of these is a COUNT (H2+ = H₂⁺, O2+ = O₂⁺). */
const NONMETALS = new Set(["H", "He", "C", "N", "O", "F", "Ne", "P", "S", "Cl", "Ar", "Se", "Br", "Kr", "I", "Xe", "Rn"]);
/** Textbook monatomic anions and their charge magnitude: S2- is S²⁻, P3- is P³⁻. */
const MONO_ANIONS: Record<string, number> = { O: 2, S: 2, Se: 2, Te: 2, N: 3, P: 3, As: 3, C: 4 };
/** Spellings where the monatomic ion AND the polyatomic ion are both real. */
const AMBIGUOUS_MONO: Record<string, string> = {
  "O2-": "oxide O²⁻ or superoxide O₂⁻",
  "N3-": "nitride N³⁻ or azide N₃⁻",
};

/**
 * Splits a trailing charge off a normalized (ASCII, no-space) formula body.
 * Returns the core and the charge, or an error for an ambiguous spelling.
 */
function splitCharge(nb: string): { core: string; charge: number } | { error: string } {
  let m: RegExpExecArray | null;
  const sgn = (c: string): number => (c === "-" ? -1 : 1);
  // Fe^(3+), SO4^(2-), Fe^(+3): a bracketed caret charge.
  if ((m = /\^\((\d*)([+-])\)$/.exec(nb))) {
    return { core: nb.slice(0, m.index), charge: sgn(m[2]) * (m[1] ? parseInt(m[1], 10) : 1) };
  }
  if ((m = /\^\(([+-])(\d+)\)$/.exec(nb))) {
    return { core: nb.slice(0, m.index), charge: sgn(m[1]) * parseInt(m[2], 10) };
  }
  if ((m = /\^(\d*)([+-])$/.exec(nb))) {
    return { core: nb.slice(0, m.index), charge: sgn(m[2]) * (m[1] ? parseInt(m[1], 10) : 1) };
  }
  if ((m = /\^([+-])(\d+)$/.exec(nb))) {
    return { core: nb.slice(0, m.index), charge: sgn(m[1]) * parseInt(m[2], 10) };
  }
  // Fe+3, SO4-2: sign THEN digits at the very end.
  if ((m = /([+-])(\d+)$/.exec(nb)) && m.index > 0 && /[A-Za-z)\]}\d]/.test(nb[m.index - 1])) {
    return { core: nb.slice(0, m.index), charge: sgn(m[1]) * parseInt(m[2], 10) };
  }
  if ((m = /(\d*)(\++|-+)$/.exec(nb))) {
    const digits = m[1];
    const signs = m[2];
    const before = nb.slice(0, m.index);
    if (!before) return { error: "a charge needs a formula in front of it" };
    if (signs.length > 1) {
      // Fe++ (old notation): one unit per sign; any digits are a count.
      return { core: before + digits, charge: sgn(signs[0]) * signs.length };
    }
    if (!digits) return { core: before, charge: sgn(signs) };
    if (/^[A-Z][a-z]?$/.test(before) && isElement(before)) {
      // ONE ELEMENT, DIGITS, ONE SIGN: Fe2+ is Fe²⁺, but I3- is triiodide I₃⁻
      // and H2+ is H₂⁺ — I³⁻ and H²⁺ do not exist. The digit is the charge only
      // where that monatomic ion is real: a metal cation, or one of the
      // textbook monatomic anions. Where BOTH readings are real species the
      // spelling is refused by name.
      const d = parseInt(digits, 10);
      const both = AMBIGUOUS_MONO[`${before}${digits}${signs}`];
      if (both) return { error: `“${nb}” is ambiguous: ${both}. Write the charge as a superscript (O²⁻, O₂⁻) or after a caret “^”.` };
      const chargeReading = signs === "+" ? !NONMETALS.has(before) : MONO_ANIONS[before] === d;
      if (chargeReading) return { core: before, charge: sgn(signs) * d };
      return { core: before + digits, charge: sgn(signs) };
    }
    if (digits.length >= 2) {
      const lastIsCharge = toSub(before + digits.slice(0, -1)) + toSup(digits.slice(-1)) + (signs === "-" ? "⁻" : "⁺");
      const allCount = toSub(before + digits) + (signs === "-" ? "⁻" : "⁺");
      return {
        error:
          `“${nb}” is ambiguous: ${lastIsCharge} (the last digit is the charge) or ${allCount}? ` +
          `Write the charge as a superscript, as in SO₄²⁻, or after a caret “^”.`,
      };
    }
    if (/[)\]}]$/.test(before)) return { core: before, charge: sgn(signs) * parseInt(digits, 10) };
    // NH4+, MnO4-: the digit is the count of the last atom, charge ±1.
    return { core: before + digits, charge: sgn(signs) };
  }
  return { core: nb, charge: 0 };
}

/** Reads an uncharged formula core with hydrate parts into exact counts. */
function readComposition(nb: string): Composition | { error: string } {
  const split = splitCharge(nb);
  if ("error" in split) return split;
  const { core, charge } = split;
  if (!Number.isSafeInteger(charge) || Math.abs(charge) > 99) return { error: `a charge of ${Math.abs(charge) > 1e6 ? "that size" : charge} is not a chemical species` };
  // A count longer than 9 digits is not chemistry; refusing it also keeps the
  // shared reader (Number counts) out of territory where it loses integers.
  const longRun = /\d{10,}/.exec(core);
  if (longRun) return { error: `a count of ${longRun[0].length} digits is not a formula` };
  if (!core) return { error: "no formula found" };
  const counts: Record<string, Rat> = {};
  let formula = "";
  let display = "";
  let comparable = true;
  const n = core.length;
  let i = 0;
  let partIndex = 0;
  let separator: "strong" | "dot" | null = null;

  while (i < n || partIndex === 0) {
    // ---- start of a hydrate part: an optional coefficient (never on the first).
    let coef = R1;
    if (partIndex > 0) {
      const c = readCoefficient(core.slice(i), separator === "strong");
      if (c) {
        if (rIsZero(c.value)) return { error: "a hydrate coefficient of 0 is not a formula" };
        coef = c.value;
        if (coef.d !== 1n) comparable = false;
        formula += c.text;
        display += c.text;
        i += c.text.length;
      }
    }
    const stack: Array<Record<string, bigint>> = [{}];
    const opens: string[] = [];
    let partStart = i;
    while (i < n) {
      const ch = core[i];
      if (ch === "·" || ch === "•" || ch === "*") {
        if (ch !== "·") comparable = false;
        separator = "strong";
        break;
      }
      if (ch === ".") {
        const rest = core.slice(i + 1);
        if (/^\d+\./.test(rest)) {
          return {
            error:
              `“${core}”: a “.” followed by a decimal is ambiguous (a hydrate dot, or a decimal subscript as Python's chempy reads it). ` +
              `Write a decimal hydrate with “·”, as in CaSO₄·0.5H₂O.`,
          };
        }
        if (/^\d+[A-Z([{]/.test(rest)) {
          separator = "dot";
          break;
        }
        return { error: `“.” in “${core}” is not a hydrate dot — a “.” hydrate must be followed by a whole number and a formula (CuSO₄·5H₂O)` };
      }
      if (ch >= "A" && ch <= "Z") {
        let sym = ch;
        i++;
        while (i < n && core[i] >= "a" && core[i] <= "z") sym += core[i++];
        if (!isElementOrIsotope(sym)) return { error: `“${sym}” is not an element symbol` };
        let num = "";
        while (i < n && core[i] >= "0" && core[i] <= "9") num += core[i++];
        // Cu1.8S, Fe0.95O: a DECIMAL subscript (a nonstoichiometric phase), never
        // a hydrate dot. A count of 1 or 0 before "." cannot start a hydrate
        // (CuSO4.5H2O keeps its reading: 4 is a real count).
        if ((num === "1" || /^0+$/.test(num)) && core[i] === "." && /\d/.test(core[i + 1] ?? "")) {
          const frac = /^\.\d+/.exec(core.slice(i))![0];
          return {
            error: `${sym}${toSub(num)}.${toSub(frac.slice(1))} has a non-integer subscript — a nonstoichiometric formula is not balanced here (it is not a hydrate)`,
          };
        }
        if (num && BigInt(num) === 0n) return { error: `subscript 0 on ${sym} is not a formula` };
        // An explicit count of 1 is never written in a chemical formula; P1V1 is
        // a physics symbol, not phosphorus-vanadium.
        if (num === "1") return { error: `an explicit count of 1 (${sym}1) is not written in a chemical formula` };
        const top = stack[stack.length - 1];
        top[sym] = (top[sym] ?? 0n) + (num ? BigInt(num) : 1n);
        formula += sym + num;
        display += sym + toSub(num);
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        stack.push({});
        opens.push(ch);
        formula += ch;
        display += ch;
        i++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        const want = { ")": "(", "]": "[", "}": "{" }[ch];
        if (!opens.length || opens[opens.length - 1] !== want) return { error: `unmatched “${ch}” in “${core}”` };
        opens.pop();
        const group = stack.pop() as Record<string, bigint>;
        i++;
        let num = "";
        while (i < n && core[i] >= "0" && core[i] <= "9") num += core[i++];
        if (num && BigInt(num) === 0n) return { error: `a group multiplier of 0 is not a formula` };
        if (num === "1") return { error: `an explicit group multiplier of 1 is not written in a chemical formula` };
        const mult = num ? BigInt(num) : 1n;
        if (!Object.keys(group).length) return { error: `empty brackets in “${core}”` };
        const top = stack[stack.length - 1];
        for (const [k, v] of Object.entries(group)) top[k] = (top[k] ?? 0n) + v * mult;
        formula += ch + num;
        display += ch + toSub(num);
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        let num = "";
        while (i < n && core[i] >= "0" && core[i] <= "9") num += core[i++];
        return { error: `misplaced number “${num}” in “${core}”` };
      }
      if (/\s/.test(ch)) return { error: `a space inside “${core}” — a formula is written without spaces` };
      if (ch === "+" || ch === "-" || ch === "^") return { error: `a charge sign belongs at the end of the formula (“${core}”)` };
      return { error: `unexpected character “${ch}” in “${core}”` };
    }
    if (opens.length) return { error: `unclosed “${opens[opens.length - 1]}” in “${core}”` };
    const part = stack[0];
    if (!Object.keys(part).length || i === partStart) {
      return { error: partIndex === 0 ? `no element symbols in “${core}”` : `an empty hydrate part in “${core}”` };
    }
    for (const [k, v] of Object.entries(part)) counts[k] = radd(counts[k] ?? R0, rmul(rat(v), coef));
    partIndex++;
    if (i >= n) break;
    // consume the separator
    i++;
    formula += "·";
    display += "·";
    partStart = i;
    if (i >= n) return { error: `an empty hydrate part after the dot in “${core}”` };
  }
  // The shared reader multiplies a trailing charge by the last hydrate
  // coefficient, so a charged hydrate is not comparable.
  if (charge !== 0 && partIndex > 1) comparable = false;
  return { counts, charge, formula: formula + chargeAscii(charge), display: display + chargeDisplay(charge), sharedReaderComparable: comparable };
}

function hillOf(counts: Record<string, Rat>): { ascii: string; display: string } {
  const keys = Object.keys(counts).filter((k) => !rIsZero(counts[k]));
  keys.sort((a, b) => {
    if ("C" in counts) {
      if (a === "C") return -1;
      if (b === "C") return 1;
      if (a === "H") return -1;
      if (b === "H") return 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  let ascii = "";
  let display = "";
  for (const k of keys) {
    const c = counts[k];
    const t = rEq(c, R1) ? "" : c.d === 1n ? c.n.toString() : String(ratToNumber(c));
    ascii += k + t;
    display += k + (c.d === 1n ? toSub(t) : t);
  }
  return { ascii, display };
}

function massOf(counts: Record<string, Rat>): number {
  let m = 0;
  for (const [k, v] of Object.entries(counts)) m += (PERIODIC[k] ?? ISOTOPE_MASS[k]) * ratToNumber(v);
  return m;
}

/** Composition from a dictionary SMILES via OCL, charge summed from the atoms. */
function compositionFromSmiles(smiles: string): { counts: Record<string, Rat>; charge: number } | { error: string } {
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(smiles);
  } catch {
    return { error: "the dictionary structure could not be read" };
  }
  const counts: Record<string, bigint> = {};
  let charge = 0;
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    if (mol.getAtomMass(a)) return { error: "the dictionary structure names an isotope" };
    const lab = mol.getAtomLabel(a);
    if (!isElement(lab)) return { error: `the dictionary structure has an atom “${lab}”` };
    counts[lab] = (counts[lab] ?? 0n) + 1n;
    const h = mol.getImplicitHydrogens(a);
    if (h) counts.H = (counts.H ?? 0n) + BigInt(h);
    charge += mol.getAtomCharge(a);
  }
  const out: Record<string, Rat> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = rat(v);
  // Cross-check against OCL's own (charge-blind) formula.
  try {
    const f = mol.getMolecularFormula().formula.replace(/\./g, "");
    const re = /([A-Z][a-z]?)(\d*)/g;
    const ocl: Record<string, bigint> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(f))) if (m[1]) ocl[m[1]] = (ocl[m[1]] ?? 0n) + (m[2] ? BigInt(m[2]) : 1n);
    const keys = new Set([...Object.keys(ocl), ...Object.keys(counts)]);
    for (const k of keys) if ((ocl[k] ?? 0n) !== (counts[k] ?? 0n)) return { error: "the dictionary structure's atom count disagrees with its formula" };
  } catch {
    /* formula unavailable — the atom walk stands */
  }
  return { counts: out, charge };
}

function sameComposition(a: Record<string, Rat>, qa: number, b: Record<string, Rat>, qb: number): boolean {
  if (qa !== qb) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!rEq(a[k] ?? R0, b[k] ?? R0)) return false;
  return true;
}

function nameSpecies(
  input: string,
  name: string,
  smiles: string,
  state: string | null,
  coefficient: Rat | null,
  coefficientText: string | null,
): SpeciesParse {
  const oc = compositionFromSmiles(smiles);
  if ("error" in oc) return { ok: false, error: `“${name}”: ${oc.error}` };
  const hill = hillOf(oc.counts);
  return {
    ok: true,
    species: {
      input, formula: name, display: name + (state ?? ""), counts: oc.counts, charge: oc.charge, state,
      electron: false, coefficient, coefficientText, resolvedName: name,
      hillDisplay: hill.display + chargeDisplay(oc.charge), molarMass: massOf(oc.counts),
    },
  };
}

export interface ParseSpeciesOptions {
  /** Resolve dictionary names ("water"). Default true. Solve routing passes false. */
  allowNames?: boolean;
}

/**
 * Reads one species: optional coefficient, formula (or electron, or a
 * dictionary name), optional state symbol. Typeset input (H₂O, MnO₄⁻) is
 * accepted, so everything this module displays re-parses.
 */
export function parseSpecies(text: string, options: ParseSpeciesOptions = {}): SpeciesParse {
  const allowNames = options.allowNames !== false;
  const input = text.trim();
  if (!input) return { ok: false, error: "an empty species (two “+” in a row, or a “+” at the end of a side)" };
  let rest = input;
  let state: string | null = null;
  const sm = STATE_RE.exec(rest);
  if (sm) {
    state = sm[0].trim();
    rest = rest.slice(0, sm.index).trim();
  }
  let coefficient: Rat | null = null;
  let coefficientText: string | null = null;
  // A dictionary name that STARTS with a digit (a locant: 1-butanol,
  // 2-propanol) wins before the coefficient is stripped — otherwise "1" is
  // eaten as a coefficient and "-butanol" refused as a stray charge sign.
  if (allowNames && /^\d/.test(rest)) {
    const whole = lookupSmiles(rest);
    if (whole && whole.source === "name") return nameSpecies(input, rest, whole.smiles, state, null, null);
  }
  const c = readCoefficient(rest, true);
  if (c) {
    coefficient = c.value;
    coefficientText = c.text;
    rest = c.rest.trim();
    if (rIsZero(coefficient)) return { ok: false, error: `“${input}” has the coefficient 0` };
  }
  if (!rest) return { ok: false, error: `“${input}” is a number, not a chemical species` };

  const nb = normalizeFormulaText(rest).trim();
  // ---- the electron
  if (/^e(\^1?-|-)?$/.test(nb)) {
    return {
      ok: true,
      species: {
        input, formula: "e-", display: "e⁻" + (state ?? ""), counts: {}, charge: -1, state, electron: true,
        coefficient, coefficientText, resolvedName: null, hillDisplay: "e⁻", molarMass: 0,
      },
    };
  }
  if (/^e(\^1?\+|\+)$/.test(nb)) return { ok: false, error: "e⁺ (the positron) is not a chemical species here — write the electron as e⁻" };
  if (/^e\^?\d/.test(nb)) return { ok: false, error: `“${rest}”: the electron takes no count or multiple charge — write the number in front, e.g. 2 e⁻` };

  const comp = /\s/.test(nb) ? { error: `a space inside “${rest}” — a formula is written without spaces` } : readComposition(nb);
  const nameHit = allowNames || "error" in comp ? lookupSmiles(rest) : null;
  const byName = nameHit && nameHit.source === "name" ? nameHit : null;

  if ("error" in comp) {
    if (allowNames && byName) return nameSpecies(input, rest, byName.smiles, state, coefficient, coefficientText);
    return { ok: false, error: `“${rest}” is not a formula: ${comp.error}` };
  }

  // A dictionary NAME that is also a different valid formula is ambiguous.
  if (byName) {
    const oc = compositionFromSmiles(byName.smiles);
    if (!("error" in oc) && !sameComposition(oc.counts, oc.charge, comp.counts, comp.charge)) {
      return {
        ok: false,
        error: `“${rest}” is ambiguous: as a formula it is ${hillOf(comp.counts).display}, as the dictionary name it is ${hillOf(oc.counts).display} — write the formula you mean`,
      };
    }
  }

  // Cross-check against the shared reader where it is known to be right.
  if (comp.sharedReaderComparable) {
    const v = validateFormula(comp.formula);
    if (v.valid) {
      const vc: Record<string, Rat> = {};
      for (const [k, x] of Object.entries(v.counts)) vc[k] = rat(BigInt(x));
      if (!sameComposition(vc, v.charge, comp.counts, comp.charge)) {
        return {
          ok: false,
          error: `“${rest}”: the two formula readers disagree (${hillOf(comp.counts).display}, charge ${comp.charge} vs ${hillOf(vc).display}, charge ${v.charge}) — refusing rather than guessing`,
        };
      }
    }
  }
  const hill = hillOf(comp.counts);
  return {
    ok: true,
    species: {
      input, formula: comp.formula, display: comp.display + (state ?? ""), counts: comp.counts, charge: comp.charge,
      state, electron: false, coefficient, coefficientText, resolvedName: null,
      hillDisplay: hill.display + chargeDisplay(comp.charge), molarMass: massOf(comp.counts),
    },
  };
}

/** The typeset species (no coefficient): Fe₂O₃, MnO₄⁻, CuSO₄·5H₂O, e⁻, H₂O(l). */
export function formatSpecies(s: Species): string {
  return s.display;
}

// ------------------------------------------------------------------ equation

export type Side = "left" | "right";

export interface ParsedEquation {
  species: Species[];
  sides: Side[];
  /** "→" or "⇌" (reversible arrows typed as ⇌, <=>, <->, ⇋, ⇄). */
  arrow: "→" | "⇌";
}

const ARROW_TOKENS: Array<[string, "→" | "⇌"]> = [
  ["<=>", "⇌"], ["<->", "⇌"], ["-->", "→"], ["->", "→"], ["→", "→"], ["⟶", "→"],
  ["⇌", "⇌"], ["⇋", "⇌"], ["⇄", "⇌"], ["=", "→"],
];

interface ArrowHit {
  index: number;
  length: number;
  kind: "→" | "⇌";
  ambiguous: boolean;
}

function findArrows(s: string): ArrowHit[] {
  const hits: ArrowHit[] = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [tok, kind] of ARROW_TOKENS) {
      if (s.startsWith(tok, i)) {
        // "MnO4-->" — is the first "-" the charge? Refuse rather than guess.
        const ambiguous = tok === "-->" && i > 0 && !/\s/.test(s[i - 1]);
        hits.push({ index: i, length: tok.length, kind, ambiguous });
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return hits;
}

export const CAPS = {
  inputChars: 2000,
  species: 20,
  elementRows: 20,
  coefficient: 1_000_000,
  basisCombinations: 10_000,
  /** Zero sets × nullity² — bounds the ray search's time, not just its count. */
  basisWork: 500_000,
} as const;

export type EquationParse = ({ ok: true } & ParsedEquation) | { ok: false; error: string };

/** Splits an equation into species with sides. Never balances. */
export function parseEquation(input: string, options: ParseSpeciesOptions = {}): EquationParse {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter a reaction, e.g. Fe + O₂ → Fe₂O₃." };
  if (input.length > CAPS.inputChars) return { ok: false, error: `The reaction is longer than ${CAPS.inputChars} characters — refused before any work.` };
  const arrows = findArrows(text);
  if (!arrows.length) return { ok: false, error: "No reaction arrow — write an arrow (→, ⇌ or =; “->” is read as →) between the reactants and the products." };
  if (arrows.length > 1) return { ok: false, error: "More than one reaction arrow — balance one step at a time." };
  const a = arrows[0];
  if (a.ambiguous) {
    return { ok: false, error: "“-->” right after a formula: is the first “-” a charge? Put a space before the arrow (MnO₄⁻ → …)." };
  }
  const leftText = text.slice(0, a.index);
  const rightText = text.slice(a.index + a.length);
  const species: Species[] = [];
  const sides: Side[] = [];
  for (const [sideText, side] of [[leftText, "left"], [rightText, "right"]] as Array<[string, Side]>) {
    if (!sideText.trim()) return { ok: false, error: `The ${side} side of the arrow is empty.` };
    const tokens = sideText.split(/\s+\+\s+/);
    for (const tok of tokens) {
      const t = tok.trim();
      // An unspaced "+" between species: H2+O2. (The state symbol is set
      // aside first, so Na+(aq) is not mistaken for one.)
      const noState = t.replace(STATE_RE, "");
      if (/\+(?=\s*\d*\s*[A-Z([{])/.test(noState) || /\S\+\s+\S|\S\s+\+\S/.test(noState)) {
        return {
          ok: false,
          error: `Is “${t}” two species, or an ion next to a species? Put spaces around a “+” that separates species (H₂ + O₂); a charge sign is written against its formula (Fe²⁺, H⁺).`,
        };
      }
      const p = parseSpecies(t, options);
      if (!p.ok) return { ok: false, error: p.error.charAt(0).toUpperCase() + p.error.slice(1) + "." };
      species.push(p.species);
      sides.push(side);
    }
  }
  if (species.length > CAPS.species) return { ok: false, error: `More than ${CAPS.species} species — refused before any work.` };
  return { ok: true, species, sides, arrow: a.kind };
}

// --------------------------------------------------------- matrix and rref

export interface CompositionMatrix {
  /** Row labels: elements in order of first appearance, then "charge". */
  rows: string[];
  matrix: Rat[][];
}

/** One row per element (+ the charge row), one column per species, − on the right. */
export function compositionMatrix(species: Species[], sides: Side[], options: { chargeRow?: boolean } = {}): CompositionMatrix {
  const rows: string[] = [];
  for (const s of species) for (const k of Object.keys(s.counts)) if (!rows.includes(k)) rows.push(k);
  const withCharge = options.chargeRow !== false;
  if (withCharge) rows.push("charge");
  const matrix = rows.map((r) =>
    species.map((s, j) => {
      const v = r === "charge" ? rat(BigInt(s.charge)) : s.counts[r] ?? R0;
      return sides[j] === "right" ? rat(-v.n, v.d) : v;
    }),
  );
  return { rows, matrix };
}

function rref(m: Rat[][], ncols: number): { r: Rat[][]; pivots: number[] } {
  const r = m.map((row) => row.slice());
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < ncols && row < r.length; col++) {
    let p = -1;
    for (let k = row; k < r.length; k++) if (!rIsZero(r[k][col])) { p = k; break; }
    if (p < 0) continue;
    [r[row], r[p]] = [r[p], r[row]];
    const inv = rdiv(R1, r[row][col]);
    r[row] = r[row].map((x) => rmul(x, inv));
    for (let k = 0; k < r.length; k++) {
      if (k === row || rIsZero(r[k][col])) continue;
      const f = r[k][col];
      r[k] = r[k].map((x, j) => rsub(x, rmul(f, r[row][j])));
    }
    pivots.push(col);
    row++;
  }
  return { r, pivots };
}

/** An exact basis of the null space of `m` (ncols columns), one vector per free column. */
export function nullSpace(m: Rat[][], ncols: number): Rat[][] {
  const { r, pivots } = rref(m, ncols);
  const basis: Rat[][] = [];
  for (let f = 0; f < ncols; f++) {
    if (pivots.includes(f)) continue;
    const v: Rat[] = new Array(ncols).fill(R0);
    v[f] = R1;
    pivots.forEach((pc, i) => {
      v[pc] = rat(-r[i][f].n, r[i][f].d);
    });
    basis.push(v);
  }
  return basis;
}

/** Scales a rational vector to coprime integers (sign kept). */
function primitive(v: Rat[]): bigint[] {
  let l = 1n;
  for (const x of v) l = (l / gcdB(l, x.d)) * x.d;
  const ints = v.map((x) => (x.n * l) / x.d);
  let g = 0n;
  for (const x of ints) g = gcdB(g, x);
  return g ? ints.map((x) => x / g) : ints;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - k + i)) / i;
    if (c > 1e12) return Infinity;
  }
  return Math.round(c);
}

/**
 * The extreme rays of the cone {x ≥ 0, A·x = 0} — every non-negative balancing
 * is a non-negative combination of these. A ray has at least (nullity − 1)
 * zero coordinates; each candidate zero set is tried. null when the count of
 * candidate sets exceeds the cap (checked BEFORE any work).
 */
function extremeRays(basis: Rat[][], ncols: number): bigint[][] | null {
  // Work in null-space coordinates: x = Σ λᵢ·basisᵢ. Zeroing the coordinates
  // in Z is a (|Z| × d) system in λ — far smaller than re-reducing A per subset.
  const d = basis.length;
  const k = d - 1;
  // Two caps, both before any work: the number of zero sets, and that number
  // weighted by the d×d solve each one costs (Word's WebView is several times
  // slower than Node; a nullity-17 search measured 0.6 s in jest).
  const combos = choose(ncols, k);
  if (combos > CAPS.basisCombinations || combos * d * d > CAPS.basisWork) return null;
  const rays: bigint[][] = [];
  const seen = new Set<string>();
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    const sys = idx.map((z) => basis.map((b) => b[z]));
    const lam = nullSpace(sys, d);
    if (lam.length === 1) {
      const x: Rat[] = new Array(ncols).fill(R0).map((_, j) => {
        let s = R0;
        for (let i = 0; i < d; i++) if (!rIsZero(lam[0][i])) s = radd(s, rmul(lam[0][i], basis[i][j]));
        return s;
      });
      let v = primitive(x);
      if (v.some((x) => x < 0n)) v = v.map((x) => -x);
      if (v.every((x) => x >= 0n) && v.some((x) => x > 0n)) {
        const key = v.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          rays.push(v);
        }
      }
    }
    // next combination
    let i = k - 1;
    while (i >= 0 && idx[i] === ncols - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return rays;
}

// ------------------------------------------------------------------- output

export interface ConservationRow {
  /** Element symbol, or "charge". */
  quantity: string;
  left: Rat;
  right: Rat;
  /** Display text of the totals: "8", "9/2", "+3", "−1". */
  leftText: string;
  rightText: string;
  ok: boolean;
}

export interface BalanceOk {
  ok: true;
  species: Species[];
  sides: Side[];
  /** Smallest positive integer coefficients, in species order. */
  coefficients: number[];
  /** Typeset: "2 KMnO₄ + 16 HCl → 2 KCl + 2 MnCl₂ + 5 Cl₂ + 8 H₂O". */
  equation: string;
  arrow: "→" | "⇌";
  /** One row per element plus charge, recounted from the RE-PARSED display. */
  conservation: ConservationRow[];
  /** Set when the user typed coefficients. */
  asWritten: { balanced: boolean; message: string } | null;
  notes: string[];
  halfReaction?: { medium: "acid" | "base"; electrons: number; kind: "reduction" | "oxidation" | "none"; summary: string };
}

export type RefusalKind = "syntax" | "cap" | "impossible" | "not-unique" | "zero" | "wrong-side" | "both-sides" | "duplicate" | "internal";

export interface BalanceRefusal {
  ok: false;
  kind: RefusalKind;
  message: string;
  /** For "not-unique": the independent reactions (non-negative, primitive). */
  basis?: Array<{ coefficients: number[]; equation: string }>;
  basisNote?: string;
  nullity?: number;
  asWritten?: { balanced: boolean; message: string } | null;
}

export type BalanceResult = BalanceOk | BalanceRefusal;

function signedText(a: Rat, isCharge: boolean): string {
  const t = ratText(rat(absB(a.n), a.d));
  if (!isCharge) return a.n < 0n ? "−" + t : t;
  if (a.n === 0n) return "0";
  return (a.n > 0n ? "+" : "−") + t;
}

function formatEquation(species: Species[], sides: Side[], coefs: bigint[], arrow: "→" | "⇌"): string {
  const part = (side: Side): string =>
    species
      .map((s, j) => ({ s, c: coefs[j], side: sides[j] }))
      .filter((x) => x.side === side && x.c !== 0n)
      .map((x) => (x.c === 1n ? "" : `${x.c} `) + formatSpecies(x.s))
      .join(" + ");
  return `${part("left")} ${arrow} ${part("right")}`;
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/** Recounts both sides from species + coefficients. */
function conservationOf(species: Species[], sides: Side[], coefs: Rat[]): ConservationRow[] {
  const els: string[] = [];
  for (const s of species) for (const k of Object.keys(s.counts)) if (!els.includes(k)) els.push(k);
  const rows: ConservationRow[] = [];
  for (const q of [...els, "charge"]) {
    let left = R0;
    let right = R0;
    species.forEach((s, j) => {
      const v = q === "charge" ? rat(BigInt(s.charge)) : s.counts[q] ?? R0;
      const t = rmul(v, coefs[j]);
      if (sides[j] === "left") left = radd(left, t);
      else right = radd(right, t);
    });
    const isQ = q === "charge";
    rows.push({ quantity: q, left, right, leftText: signedText(left, isQ), rightText: signedText(right, isQ), ok: rEq(left, right) });
  }
  return rows;
}

/**
 * Re-parses the displayed equation and recounts every element and the charge.
 * This is both the verification and the round-trip pin: what we print must
 * parse back to the same species and the same coefficients, and conserve.
 */
function verifyDisplayed(equation: string, expected: bigint[]): { ok: true; rows: ConservationRow[] } | { ok: false; why: string } {
  const p = parseEquation(equation);
  if (!p.ok) return { ok: false, why: `the printed equation does not re-parse (${p.error})` };
  const nz = expected.filter((c) => c !== 0n);
  if (p.species.length !== nz.length) return { ok: false, why: "the printed equation re-parses to a different species list" };
  const coefs = p.species.map((s) => s.coefficient ?? R1);
  for (let j = 0; j < nz.length; j++) {
    if (!rEq(coefs[j], rat(nz[j]))) return { ok: false, why: "the printed coefficients re-parse differently" };
  }
  const rows = conservationOf(p.species, p.sides, coefs);
  const bad = rows.find((r) => !r.ok);
  if (bad) return { ok: false, why: `${bad.quantity} is not conserved in the printed equation (${bad.leftText} vs ${bad.rightText})` };
  return { ok: true, rows };
}

function asWrittenCheck(species: Species[], sides: Side[]): { balanced: boolean; message: string; vector: Rat[] } | null {
  if (!species.some((s) => s.coefficient)) return null;
  const vector = species.map((s) => s.coefficient ?? R1);
  const rows = conservationOf(species, sides, vector);
  const bad = rows.find((r) => !r.ok);
  if (!bad) return { balanced: true, message: "As written it is balanced.", vector };
  const what = bad.quantity === "charge" ? "charge" : bad.quantity;
  return {
    balanced: false,
    message: `As written it is NOT balanced: ${what} is ${bad.leftText} on the left and ${bad.rightText} on the right.`,
    vector,
  };
}

function coefficientNumbers(v: bigint[]): number[] {
  return v.map((x) => Number(x));
}

/** True when a ≈ positive multiple of b (exact). */
function isPositiveMultiple(a: Rat[], b: bigint[]): boolean {
  let ratio: Rat | null = null;
  for (let j = 0; j < a.length; j++) {
    if (b[j] === 0n) {
      if (!rIsZero(a[j])) return false;
      continue;
    }
    const r = rdiv(a[j], rat(b[j]));
    if (ratio === null) ratio = r;
    else if (!rEq(ratio, r)) return false;
  }
  return ratio !== null && ratio.n > 0n;
}

function finishOk(
  species: Species[],
  sides: Side[],
  coefs: bigint[],
  arrow: "→" | "⇌",
  notes: string[],
  asWritten: { balanced: boolean; message: string; vector: Rat[] } | null,
): BalanceResult {
  if (coefs.some((c) => c > BigInt(CAPS.coefficient))) {
    return { ok: false, kind: "cap", message: `The balancing needs a coefficient above 10⁶ (${coefs.map(String).join(", ")}) — refused rather than printed.` };
  }
  const equation = formatEquation(species, sides, coefs, arrow);
  if (equation.length > CAPS.inputChars) {
    return { ok: false, kind: "cap", message: `The balanced equation would be longer than ${CAPS.inputChars} characters — refused rather than printed.` };
  }
  const ver = verifyDisplayed(equation, coefs);
  if (!ver.ok) return { ok: false, kind: "internal", message: `Refused: ${ver.why}.` };
  let aw: { balanced: boolean; message: string } | null = null;
  if (asWritten) {
    if (asWritten.balanced) {
      const typed = asWritten.vector;
      const smallest = typed.every((x, j) => rEq(x, rat(coefs[j])));
      const fractional = species.filter((s) => s.coefficient && s.coefficient.d !== 1n);
      let msg = "As written it is balanced.";
      if (fractional.length) {
        msg += ` The fractional coefficient${fractional.length > 1 ? "s" : ""} (${fractional.map((s) => `${s.coefficientText} ${formatSpecies(s)}`).join(", ")}) balance it; the smallest whole numbers are shown.`;
      } else if (!smallest) {
        msg += ` The smallest whole-number coefficients are ${coefs.join(", ")}.`;
      }
      aw = { balanced: true, message: msg };
    } else {
      aw = { balanced: false, message: asWritten.message + " The balanced equation is below." };
    }
  }
  return {
    ok: true,
    species,
    sides,
    coefficients: coefficientNumbers(coefs),
    equation,
    arrow,
    conservation: ver.rows,
    asWritten: aw,
    notes,
  };
}

function resolvedNotes(species: Species[]): string[] {
  const notes: string[] = [];
  for (const s of species) {
    if (s.resolvedName) {
      notes.push(`“${s.resolvedName}” read from the compound dictionary as ${s.hillDisplay} (one form only — if you mean a hydrate or another form, type its formula).`);
    }
    if (s.coefficient && s.coefficient.d !== 1n) {
      notes.push(`The fractional coefficient ${s.coefficientText} on ${formatSpecies(s)} was read; balancing reports whole numbers.`);
    }
  }
  return notes;
}

function speciesKey(s: Species): string {
  const keys = Object.keys(s.counts).sort();
  return keys.map((k) => `${k}${ratText(s.counts[k])}`).join("") + `|${s.charge}|${(s.state ?? "").toLowerCase()}|${s.electron}`;
}

/**
 * Balances a reaction. `input` is an equation such as "Fe + O2 -> Fe2O3".
 * With `medium`, it is a half-reaction skeleton: H₂O, H⁺ (acid) or OH⁻ (base)
 * and e⁻ are added as free species, and the sign of each decides its side.
 */
export function balanceReaction(input: string, options: { medium?: "acid" | "base"; halfReaction?: boolean } = {}): BalanceResult {
  const p = parseEquation(input);
  if (!p.ok) return { ok: false, kind: p.error.includes("refused before any work") ? "cap" : "syntax", message: p.error };
  if (options.medium) return balanceHalf(p, options.medium, options.halfReaction === true);
  const { species, sides, arrow } = p;

  // A species on BOTH sides adds a trivial null vector (X → X). Refuse by name.
  for (let a = 0; a < species.length; a++) {
    for (let b = a + 1; b < species.length; b++) {
      if (sides[a] === sides[b] && speciesKey(species[a]) === speciesKey(species[b])) {
        return {
          ok: false,
          kind: "duplicate",
          message: `${formatSpecies(species[a])} is written twice on the ${sides[a]} side — write it once (with one coefficient).`,
        };
      }
      if (sides[a] !== sides[b] && speciesKey(species[a]) === speciesKey(species[b])) {
        return {
          ok: false,
          kind: "both-sides",
          message: `${formatSpecies(species[a])} appears on both sides — it cancels. Write it once, on the side where it is net consumed or produced.`,
        };
      }
    }
  }
  const { rows, matrix } = compositionMatrix(species, sides);
  if (rows.length - 1 > CAPS.elementRows) return { ok: false, kind: "cap", message: `More than ${CAPS.elementRows} elements — refused before any work.` };
  const n = species.length;
  const ns = nullSpace(matrix, n);
  const asWritten = asWrittenCheck(species, sides);
  const notes = resolvedNotes(species);
  const names = (idx: number[]): string => nameList(idx.map((j) => formatSpecies(species[j])));

  if (ns.length === 0) return impossible(species, sides, rows, matrix, asWritten);

  let vec: bigint[] | null = null;
  if (ns.length === 1) {
    vec = primitive(ns[0]);
  } else {
    const rays = extremeRays(ns, n);
    if (rays === null) {
      const basis = ns.map((v) => {
        const pv = primitive(v);
        return { coefficients: coefficientNumbers(pv), equation: signedEquation(species, sides, pv, arrow) };
      });
      return {
        ok: false,
        kind: "not-unique",
        nullity: ns.length,
        message: `This reaction has ${ns.length} independent balancings, so no single set of coefficients is THE answer. The search for non-negative independent reactions exceeds its cap; an exact basis (which may have negative entries — a negative coefficient means the species moves to the other side) is shown.`,
        basis,
        basisNote: "rref basis — not all entries non-negative",
        asWritten: asWritten ? { balanced: asWritten.balanced, message: asWritten.message } : null,
      };
    }
    if (rays.length === 0) {
      return {
        ok: false,
        kind: "impossible",
        message: `No set of positive coefficients balances this: every way of conserving ${nameList(rows.map((r) => (r === "charge" ? "charge" : r)))} puts some species on the other side.`,
      };
    }
    const never = species.map((_, j) => j).filter((j) => rays.every((r) => r[j] === 0n));
    if (never.length) {
      return {
        ok: false,
        kind: "zero",
        message: `${names(never)} take${never.length === 1 ? "s" : ""} no part — every balancing gives ${never.length === 1 ? "it" : "them"} the coefficient 0. Remove ${never.length === 1 ? "it" : "them"} or check the products.`,
      };
    }
    if (rays.length === 1) {
      vec = rays[0];
      notes.push(`The conservation equations allow ${ns.length} independent directions, but only one has every coefficient positive.`);
    } else {
      if (rays.some((r) => r.some((c) => c > BigInt(CAPS.coefficient)))) {
        return { ok: false, kind: "cap", nullity: ns.length, message: `This reaction has ${ns.length} independent balancings, and its independent reactions need coefficients above 10⁶ — refused rather than printed.` };
      }
      const SHOWN = 10;
      const shown = rays.slice(0, SHOWN);
      const count =
        rays.length === ns.length
          ? `the ${rays.length} reactions below`
          : rays.length <= SHOWN
            ? `the ${rays.length} reactions below (more reactions than independent directions: some are combinations of others with fewer species)`
            : `the ${rays.length} minimal reactions (the first ${SHOWN} are shown)`;
      // The equation as written — typed coefficients, or all 1 — may be one valid balancing; say so.
      let aw: { balanced: boolean; message: string } | null = asWritten ? { balanced: asWritten.balanced, message: asWritten.message } : null;
      if (!aw) {
        const ones = conservationOf(species, sides, species.map(() => R1));
        if (ones.every((r) => r.ok)) aw = { balanced: true, message: "As written (all coefficients 1) it is one valid balancing — but not the only one." };
      }
      return {
        ok: false,
        kind: "not-unique",
        nullity: ns.length,
        message:
          `This reaction has ${ns.length} independent balancings, so no single set of coefficients is THE answer — ` +
          `every positive combination of ${count} balances it. (A solver that prints one answer here has picked one arbitrarily.)`,
        basis: shown.map((r) => ({ coefficients: coefficientNumbers(r), equation: formatEquation(species, sides, r, arrow) })),
        basisNote: rays.length > SHOWN ? `${rays.length} minimal reactions in all; ${SHOWN} shown` : undefined,
        asWritten: aw,
      };
    }
  }

  // dim 1 (or a single ray): signs decide.
  const pos = vec.filter((x) => x > 0n).length;
  const neg = vec.filter((x) => x < 0n).length;
  if (neg > pos || (neg === pos && vec.find((x) => x !== 0n)! < 0n)) vec = vec.map((x) => -x);
  const zeros = vec.map((x, j) => (x === 0n ? j : -1)).filter((j) => j >= 0);
  const negs = vec.map((x, j) => (x < 0n ? j : -1)).filter((j) => j >= 0);
  if (negs.length) {
    return {
      ok: false,
      kind: "wrong-side",
      message: `This balances only with ${names(negs)} on the other side of the arrow.`,
    };
  }
  if (zeros.length) {
    return {
      ok: false,
      kind: "zero",
      message: `${names(zeros)} take${zeros.length === 1 ? "s" : ""} no part — the only balancing gives ${zeros.length === 1 ? "it" : "them"} the coefficient 0. Remove ${zeros.length === 1 ? "it" : "them"} or check the products.`,
    };
  }
  if (asWritten && asWritten.balanced && !isPositiveMultiple(asWritten.vector, vec)) {
    return { ok: false, kind: "internal", message: "Refused: the typed coefficients balance but disagree with the null space." };
  }
  return finishOk(species, sides, vec, arrow, notes, asWritten);
}

/**
 * Verifies the equation AS WRITTEN (typed coefficients; 1 where none is
 * typed) without solving anything. Used where the user's own balancing is
 * the input — e.g. stoichiometry on a reaction whose formulas alone admit
 * several balancings (aspirin synthesis: H and O are locked 2:1 in every
 * species, so the formulas cannot fix the ratio; the chemist's equation can).
 */
export function balanceAsWritten(input: string): BalanceResult {
  const p = parseEquation(input);
  if (!p.ok) return { ok: false, kind: p.error.includes("refused before any work") ? "cap" : "syntax", message: p.error };
  const vector = p.species.map((s) => s.coefficient ?? R1);
  const rows = conservationOf(p.species, p.sides, vector);
  const bad = rows.find((r) => !r.ok);
  if (bad) {
    return {
      ok: false,
      kind: "impossible",
      message: `As written it is NOT balanced: ${bad.quantity} is ${bad.leftText} on the left and ${bad.rightText} on the right.`,
    };
  }
  let ints = primitive(vector);
  if (ints.some((x) => x < 0n)) ints = ints.map((x) => -x);
  return finishOk(p.species, p.sides, ints, p.arrow, resolvedNotes(p.species), { balanced: true, message: "As written it is balanced.", vector });
}

/** An equation for a signed vector: negatives move to the other side. */
function signedEquation(species: Species[], sides: Side[], v: bigint[], arrow: "→" | "⇌"): string {
  const newSides = sides.map((s, j) => (v[j] < 0n ? (s === "left" ? "right" : "left") : s)) as Side[];
  return formatEquation(species, newSides, v.map((x) => absB(x)), arrow);
}

function impossible(
  species: Species[],
  sides: Side[],
  rows: string[],
  matrix: Rat[][],
  asWritten: { balanced: boolean; message: string } | null,
): BalanceRefusal {
  const aw = asWritten ? { balanced: asWritten.balanced, message: asWritten.message } : null;
  // An element (or charge) on one side only.
  for (let r = 0; r < rows.length; r++) {
    const onLeft = matrix[r].some((x, j) => !rIsZero(x) && sides[j] === "left");
    const onRight = matrix[r].some((x, j) => !rIsZero(x) && sides[j] === "right");
    if (onLeft !== onRight) {
      const where = onLeft ? "left" : "right";
      if (rows[r] === "charge") {
        return {
          ok: false, kind: "impossible", asWritten: aw,
          message: `Charge appears only on the ${where} — charge cannot be conserved. Add the missing ions or electrons (e⁻).`,
        };
      }
      return {
        ok: false, kind: "impossible", asWritten: aw,
        message: `${rows[r]} appears only on the ${where} — no coefficients can conserve it.`,
      };
    }
  }
  // The smallest set of rows that already admits no solution.
  let keep = rows.map((_, i) => i);
  for (const r of rows.map((_, i) => i)) {
    const trial = keep.filter((x) => x !== r);
    if (!trial.length) continue;
    if (nullSpace(trial.map((i) => matrix[i]), species.length).length === 0) keep = trial;
  }
  const labels = keep.map((i) => rows[i]);
  const ratios = species
    .filter((s) => labels.some((l) => (l === "charge" ? s.charge !== 0 : s.counts[l] && !rIsZero(s.counts[l]))))
    .map((s) => {
      const vals = labels.map((l) => (l === "charge" ? rat(BigInt(s.charge)) : s.counts[l] ?? R0));
      const pv = primitive(vals);
      return `${formatSpecies(s)} has ${labels.join(":")} = ${pv.join(":")}`;
    });
  return {
    ok: false,
    kind: "impossible",
    asWritten: aw,
    message: `No positive coefficients conserve ${nameList(labels)} together: ${ratios.join(", ")}.`,
  };
}

// ----------------------------------------------------------- half-reactions

function auxSpecies(text: string): Species {
  const p = parseSpecies(text, { allowNames: false });
  if (!p.ok) throw new Error(p.error);
  return p.species;
}

/**
 * The skeleton's own ratio, from its atoms other than H and O; when it has
 * none, from O, then from O and H. Positive primitive integers, or null when
 * those rows do not fix a unique positive ratio.
 */
function skeletonRatio(skel: Species[], sides: Side[]): bigint[] | null {
  const { rows, matrix } = compositionMatrix(skel, sides, { chargeRow: false });
  const heavy = rows.map((r, i) => (r !== "H" && r !== "O" ? i : -1)).filter((i) => i >= 0);
  const tries = heavy.length ? [heavy] : [rows.map((r, i) => (r === "O" ? i : -1)).filter((i) => i >= 0), rows.map((_, i) => i)];
  for (const sel of tries) {
    if (!sel.length) continue;
    const ns = nullSpace(sel.map((i) => matrix[i]), skel.length);
    if (ns.length !== 1) continue;
    let v = primitive(ns[0]);
    if (v.every((x) => x <= 0n)) v = v.map((x) => -x);
    if (v.every((x) => x > 0n)) return v;
  }
  return null;
}

/**
 * A FULL redox (or acid–base) equation in a medium: "MnO4^- + Fe^2+ -> Mn^2+ +
 * Fe^3+ in acid". Only H⁺ (or OH⁻) and H₂O are added — the electrons lost by
 * one species are gained by another, so the net equation carries no free e⁻.
 * Returns null when that does not give ONE positive balancing (then the
 * skeleton is a half-reaction and e⁻ are needed).
 */
function balanceFullInMedium(p: ParsedEquation, skel: Species[], skelSides: Side[], aux: Species[], medium: "acid" | "base"): BalanceResult | null {
  const all = [...skel, ...aux];
  const allSides: Side[] = [...skelSides, ...aux.map(() => "left" as Side)];
  const { matrix } = compositionMatrix(all, allSides);
  const ns = nullSpace(matrix, all.length);
  if (ns.length !== 1) return null;
  let v = primitive(ns[0]);
  if (v.slice(0, skel.length).every((x) => x <= 0n)) v = v.map((x) => -x);
  if (!v.slice(0, skel.length).every((x) => x > 0n)) return null;
  const species: Species[] = [];
  const sides: Side[] = [];
  const coefs: bigint[] = [];
  const push = (s: Species, side: Side, c: bigint): void => {
    species.push(s);
    sides.push(side);
    coefs.push(c);
  };
  skel.forEach((s, j) => skelSides[j] === "left" && push(s, "left", v[j]));
  aux.forEach((s, j) => v[skel.length + j] > 0n && push(s, "left", v[skel.length + j]));
  skel.forEach((s, j) => skelSides[j] === "right" && push(s, "right", v[j]));
  aux.forEach((s, j) => v[skel.length + j] < 0n && push(s, "right", -v[skel.length + j]));
  const notes = resolvedNotes(p.species);
  // Only the helpers that took a non-zero coefficient are named ("AgNO3 + NaCl -> AgCl + NaNO3 in acid" needs none).
  // A helper the equation already had as typed (HCl + NaOH -> NaCl + H2O) was not added either.
  const typed = new Set(p.species.map((s) => speciesKey({ ...s, state: null })));
  const added = aux.filter((a, j) => v[skel.length + j] !== 0n && !typed.has(speciesKey({ ...a, state: null }))).map((a) => a.display);
  const solution = medium === "acid" ? "acidic" : "basic";
  notes.push(
    added.length
      ? `Balanced in ${solution} solution: ${added.join(" and ")} ${added.length === 1 ? "was" : "were"} added where needed.`
      : `Balanced in ${solution} solution: no ${aux.map((a) => a.display).join(" or ")} had to be added.`,
  );
  // The electron sentence only where an oxidation state is shown to change (a precipitation is not a redox).
  if (redoxShown(species, sides)) notes.push("This is a full equation, so no free electrons appear: the electrons lost and gained cancel.");
  return finishOk(species, sides, coefs, p.arrow, notes, null);
}

/** Elements whose oxidation state in a compound is fixed by the usual rules. */
const FIXED_OXIDATION: Record<string, number> = { F: -1, Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Al: 3, Zn: 2, Ag: 1 };
const HYDRIDE_PARTNERS = new Set(["Li", "Na", "K", "Rb", "Cs", "Be", "Mg", "Ca", "Sr", "Ba", "Al"]);

/**
 * Each element's oxidation state in one species by the usual assignment rules (F −1; alkali +1; alkaline earth +2;
 * Al +3, Zn +2, Ag +1; H +1, or −1 in a metal hydride; O −2 unless bonded to F; Cl/Br/I −1 when no O or F is present;
 * the one element left over takes what balances the charge). Null when that does not settle every element.
 */
function oxidationStates(s: Species): Record<string, number> | null {
  const els = Object.keys(s.counts).map((e) => (e === "D" || e === "T" ? "H" : e));
  const count: Record<string, number> = {};
  for (const [e, c] of Object.entries(s.counts)) {
    const k = e === "D" || e === "T" ? "H" : e;
    count[k] = (count[k] ?? 0) + ratToNumber(c);
  }
  const uniq = [...new Set(els)];
  if (uniq.length === 1) return { [uniq[0]]: s.charge / count[uniq[0]] };
  const ox: Record<string, number> = {};
  for (const e of uniq) {
    if (e in FIXED_OXIDATION) ox[e] = FIXED_OXIDATION[e];
    else if (e === "H") ox[e] = uniq.every((x) => x === "H" || HYDRIDE_PARTNERS.has(x)) ? -1 : 1;
    else if (e === "O" && !uniq.includes("F")) ox[e] = -2;
    else if ((e === "Cl" || e === "Br" || e === "I") && !uniq.includes("O") && !uniq.includes("F") && uniq.filter((x) => x === "Cl" || x === "Br" || x === "I").length === 1) ox[e] = -1;
  }
  const open = uniq.filter((e) => !(e in ox));
  const fixedSum = uniq.filter((e) => e in ox).reduce((t, e) => t + ox[e] * count[e], 0);
  if (open.length === 1) {
    ox[open[0]] = (s.charge - fixedSum) / count[open[0]];
    return ox;
  }
  return open.length === 0 && Math.abs(fixedSum - s.charge) < 1e-9 ? ox : null;
}

/** True only when the balanced equation is SHOWN to change an oxidation state (else the electron sentence is left out). */
function redoxShown(species: Species[], sides: Side[]): boolean {
  const states: Array<Record<string, number> | null> = species.map((s) => (s.electron ? {} : oxidationStates(s)));
  const sets = (side: Side, e: string): string =>
    [...new Set(species.flatMap((_, j) => (sides[j] === side && states[j] && e in states[j]! ? [states[j]![e].toFixed(6)] : [])))].sort().join(",");
  const hydrogenOf = (e: string): string => (e === "D" || e === "T" ? "H" : e);
  const elements = [...new Set(species.flatMap((s) => Object.keys(s.counts).map(hydrogenOf)))];
  // An element changed when every species holding it is settled and its states differ between the two sides.
  return elements.some((e) => {
    const holders = species.map((_, j) => j).filter((j) => Object.keys(species[j].counts).some((k) => hydrogenOf(k) === e));
    return holders.every((j) => states[j]) && sets("left", e) !== sets("right", e);
  });
}

function balanceHalf(p: ParsedEquation, medium: "acid" | "base", forceHalf = false): BalanceResult {
  const aux = [auxSpecies(medium === "acid" ? "H+" : "OH-"), auxSpecies("H2O"), auxSpecies("e-")];
  const auxKeys = aux.map((a) => speciesKey({ ...a, state: null }));
  // Skeleton species that ARE an auxiliary become free-sign columns.
  const skel: Species[] = [];
  const skelSides: Side[] = [];
  p.species.forEach((s, j) => {
    if (!auxKeys.includes(speciesKey({ ...s, state: null }))) {
      skel.push(s);
      skelSides.push(p.sides[j]);
    }
  });
  if (!skel.length) return { ok: false, kind: "syntax", message: "The half-reaction has no species besides H₂O, H⁺/OH⁻ and e⁻." };
  if (p.species.some((s) => s.electron)) forceHalf = true;
  if (!forceHalf && skel.length >= 3) {
    const full = balanceFullInMedium(p, skel, skelSides, aux.slice(0, 2), medium);
    if (full) return full;
  }
  const all = [...skel, ...aux];
  const allSides: Side[] = [...skelSides, "left", "left", "left"];
  const { matrix } = compositionMatrix(all, allSides);
  let ns = nullSpace(matrix, all.length);
  const halfNotes: string[] = [];
  if (ns.length > 1) {
    // The extra freedom is H/O shuffling through the free H₂O column (H₂O₂ can
    // also disproportionate to H₂O). The textbook method fixes the SKELETON
    // first — balance its atoms other than H and O (or O, then H, when it has
    // nothing else) — and only then adds H₂O, H⁺/OH⁻ and e⁻. That fixes the
    // electron count by the skeleton's own change.
    const fixed = skeletonRatio(skel, skelSides);
    if (fixed) {
      const { matrix: full } = compositionMatrix(all, allSides);
      // Unknowns: a scale t on the fixed skeleton vector, then the 3 aux columns.
      const reduced = full.map((row) => {
        let s = R0;
        for (let j = 0; j < skel.length; j++) s = radd(s, rmul(row[j], rat(fixed[j])));
        return [s, ...row.slice(skel.length)];
      });
      const ns2 = nullSpace(reduced, 1 + aux.length);
      if (ns2.length === 1 && !rIsZero(ns2[0][0])) {
        const t = ns2[0][0];
        ns = [[...fixed.map((x) => rmul(rat(x), t)), ...ns2[0].slice(1)]];
        halfNotes.push("The skeleton's own atoms were balanced first, then H₂O, " + (medium === "acid" ? "H⁺" : "OH⁻") + " and e⁻ added (the textbook order); this fixes the electron count.");
      }
    }
  }
  if (ns.length === 0) {
    return { ok: false, kind: "impossible", message: `This half-reaction cannot be balanced with H₂O, ${medium === "acid" ? "H⁺" : "OH⁻"} and e⁻ — an element other than H and O is not conserved.` };
  }
  if (ns.length > 1) {
    return {
      ok: false,
      kind: "not-unique",
      nullity: ns.length,
      message: `This half-reaction skeleton has ${ns.length} independent balancings with H₂O, ${medium === "acid" ? "H⁺" : "OH⁻"} and e⁻ — give a skeleton that fixes the ratio of its species.`,
    };
  }
  let v = primitive(ns[0]);
  const sk = v.slice(0, skel.length);
  if (sk.every((x) => x <= 0n)) v = v.map((x) => -x);
  const skv = v.slice(0, skel.length);
  const zero = skv.map((x, j) => (x === 0n ? j : -1)).filter((j) => j >= 0);
  const neg = skv.map((x, j) => (x < 0n ? j : -1)).filter((j) => j >= 0);
  if (neg.length) return { ok: false, kind: "wrong-side", message: `This half-reaction balances only with ${nameList(neg.map((j) => formatSpecies(skel[j])))} on the other side.` };
  if (zero.length) return { ok: false, kind: "zero", message: `${nameList(zero.map((j) => formatSpecies(skel[j])))} take${zero.length === 1 ? "s" : ""} no part in this half-reaction.` };
  // Assemble: skeleton left, aux left (H⁺/OH⁻, H₂O, e⁻), skeleton right, aux right.
  const species: Species[] = [];
  const sides: Side[] = [];
  const coefs: bigint[] = [];
  const push = (s: Species, side: Side, c: bigint): void => {
    species.push(s);
    sides.push(side);
    coefs.push(c);
  };
  skel.forEach((s, j) => skelSides[j] === "left" && push(s, "left", skv[j]));
  aux.forEach((s, j) => v[skel.length + j] > 0n && push(s, "left", v[skel.length + j]));
  skel.forEach((s, j) => skelSides[j] === "right" && push(s, "right", skv[j]));
  aux.forEach((s, j) => v[skel.length + j] < 0n && push(s, "right", -v[skel.length + j]));
  const eIdx = species.findIndex((s) => s.electron);
  const electrons = eIdx >= 0 ? Number(coefs[eIdx]) : 0;
  const kind: "reduction" | "oxidation" | "none" = eIdx < 0 ? "none" : sides[eIdx] === "left" ? "reduction" : "oxidation";
  const notes = resolvedNotes(p.species);
  const ionName = medium === "acid" ? "H⁺" : "OH⁻";
  notes.push(`Balanced in ${medium === "acid" ? "acidic" : "basic"} solution: H₂O, ${ionName} and e⁻ were added where needed.`);
  notes.push(...halfNotes);
  const summary =
    kind === "none"
      ? "No electron transfer — this is not a redox half-reaction."
      : kind === "reduction"
        ? `Reduction (gains ${electrons} e⁻).`
        : `Oxidation (loses ${electrons} e⁻).`;
  const res = finishOk(species, sides, coefs, p.arrow, notes, null);
  if (res.ok) res.halfReaction = { medium, electrons, kind, summary };
  return res;
}

/**
 * Combines two half-reactions (one reduction, one oxidation) so the electrons
 * cancel, then cross-checks the net equation against balancing it directly.
 */
export function combineHalfReactions(first: string, second: string, medium: "acid" | "base"): BalanceResult {
  const a = balanceReaction(first, { medium, halfReaction: true });
  if (!a.ok) return { ...a, message: `First half-reaction: ${a.message}` };
  const b = balanceReaction(second, { medium, halfReaction: true });
  if (!b.ok) return { ...b, message: `Second half-reaction: ${b.message}` };
  const ha = a.halfReaction!;
  const hb = b.halfReaction!;
  if (ha.kind === "none" || hb.kind === "none" || ha.kind === hb.kind) {
    return { ok: false, kind: "impossible", message: "A redox pair needs one reduction (gains e⁻) and one oxidation (loses e⁻)." };
  }
  const ea = BigInt(ha.electrons);
  const eb = BigInt(hb.electrons);
  const g = gcdB(ea, eb);
  const lcm = (ea / g) * eb;
  const ma = lcm / ea;
  const mb = lcm / eb;
  // Net signed amount per species key (left positive).
  const net = new Map<string, { s: Species; c: bigint }>();
  const addAll = (r: BalanceOk, mult: bigint): void => {
    r.species.forEach((s, j) => {
      const key = speciesKey({ ...s, state: null });
      const c = BigInt(r.coefficients[j]) * mult * (r.sides[j] === "left" ? 1n : -1n);
      const prev = net.get(key);
      net.set(key, { s: prev ? prev.s : { ...s, coefficient: null, coefficientText: null }, c: (prev ? prev.c : 0n) + c });
    });
  };
  addAll(a, ma);
  addAll(b, mb);
  const species: Species[] = [];
  const sides: Side[] = [];
  const coefs: bigint[] = [];
  for (const side of ["left", "right"] as Side[]) {
    for (const { s, c } of net.values()) {
      if (c === 0n) continue;
      if ((c > 0n) === (side === "left")) {
        species.push(s);
        sides.push(side);
        coefs.push(absB(c));
      }
    }
  }
  if (species.some((s) => s.electron)) return { ok: false, kind: "internal", message: "Refused: the electrons did not cancel." };
  let gg = 0n;
  for (const c of coefs) gg = gcdB(gg, c);
  const prim = coefs.map((c) => c / gg);
  const notes = [
    `Electrons cancelled: ${ha.kind === "reduction" ? "reduction" : "oxidation"} × ${ma}, ${hb.kind === "reduction" ? "reduction" : "oxidation"} × ${mb} (${lcm} e⁻ transferred).`,
  ];
  // Cross-check: balance the net equation directly (no coefficients).
  const plain = formatEquation(species, sides, species.map(() => 1n), "→");
  const direct = balanceReaction(plain);
  if (direct.ok) {
    if (!direct.coefficients.every((c, j) => BigInt(c) === prim[j])) {
      return { ok: false, kind: "internal", message: `Refused: the half-reaction combination (${prim.join(", ")}) disagrees with the direct balance (${direct.coefficients.join(", ")}).` };
    }
    notes.push("Cross-checked: balancing the net equation directly gives the same coefficients.");
  } else if (direct.kind === "not-unique") {
    notes.push("Balancing the net equation alone has more than one answer; the electron transfer between the two half-reactions fixes this one.");
  } else {
    return { ok: false, kind: "internal", message: `Refused: the combined equation does not balance directly (${direct.message})` };
  }
  return finishOk(species, sides, prim, a.arrow, notes, null);
}

// --------------------------------------------------------- text front-ends

export interface BalanceRequest {
  kind: "balance" | "half-reaction" | "redox-pair";
  medium: "acid" | "base" | null;
  equations: string[];
  /** True when the verb itself said "half-reaction" (electrons always added). */
  explicitHalf?: boolean;
}

const VERB_RE = /^\s*(balance|half[- ]reactions?)\b(?:\s+(?:the\s+)?(?:chemical\s+)?(?:equation|reaction)\b)?\s*:?\s*/i;
// A trailing medium needs "in" (in acid, in basic solution) or the full
// "acidic/basic solution" — a bare trailing "acid" is a product name
// ("SO3 + H2O -> sulfuric acid"), never a medium.
const MEDIUM_RE = /(?:\bin\s+(acidic|basic|acid|base)(?:\s+(?:solution|medium|conditions))?|\b(acidic|basic)\s+(?:solution|medium|conditions))\s*\.?\s*$/i;
const MEDIUM_PREFIX_RE = /^\s*in\s+(acidic|basic|acid|base)(?:\s+(?:solution|medium|conditions))?\s*[:,]?\s*/i;

/** Reads "balance …", "half-reaction … in acid", "balance in base: A -> B; C -> D". */
export function readBalanceRequest(raw: string): BalanceRequest | null {
  let t = raw.trim();
  const verb = VERB_RE.exec(t);
  let half = false;
  if (verb) {
    half = /^half/i.test(verb[1]);
    t = t.slice(verb[0].length);
  }
  let medium: "acid" | "base" | null = null;
  const pre = MEDIUM_PREFIX_RE.exec(t);
  if (pre) {
    medium = /^acid/i.test(pre[1]) ? "acid" : "base";
    t = t.slice(pre[0].length);
  } else {
    const suf = MEDIUM_RE.exec(t);
    // Only a medium WORD, not a formula ending: require a preceding space or comma.
    if (suf && suf.index > 0 && /[\s,]/.test(t[suf.index - 1])) {
      medium = /^acid/i.test(suf[1] ?? suf[2]) ? "acid" : "base";
      t = t.slice(0, suf.index).replace(/[\s,]+$/, "");
    }
  }
  const eqs = t.split(/\s*[;\n]\s*/).map((x) => x.trim()).filter(Boolean);
  if (!eqs.length) return null;
  if (eqs.length > 2) return null;
  if (eqs.length === 2) return { kind: "redox-pair", medium, equations: eqs };
  return { kind: half || medium ? "half-reaction" : "balance", medium, equations: eqs, ...(half ? { explicitHalf: true } : {}) };
}

/** One entry point for Solve: verb, medium and one or two equations. */
export function balanceText(raw: string): BalanceResult {
  const req = readBalanceRequest(raw);
  if (!req) return { ok: false, kind: "syntax", message: "Enter one reaction, or two half-reactions separated by “;”." };
  if (req.kind === "redox-pair") {
    if (!req.medium) return { ok: false, kind: "syntax", message: "Combining two half-reactions needs the medium — say “in acid” or “in base”." };
    return combineHalfReactions(req.equations[0], req.equations[1], req.medium);
  }
  if (req.kind === "half-reaction") {
    if (!req.medium) return { ok: false, kind: "syntax", message: "A half-reaction is balanced in acid (H⁺, H₂O) or in base (OH⁻, H₂O) — say which." };
    return balanceReaction(req.equations[0], { medium: req.medium, halfReaction: req.explicitHalf === true });
  }
  return balanceReaction(req.equations[0]);
}

const TWO_LETTER = /[A-Z][a-z]/;

/**
 * Solve routing switch, run on the RAW text before any paste fold.
 *
 * WITH the verb ("balance …", "half-reaction …"), it fires whenever each
 * equation has an arrow: balanceText then gives the named chemistry refusal
 * (or resolves dictionary names) — "balance x -> y" deserves a chemistry
 * answer, not the generic one.
 *
 * WITHOUT the verb it fires only when (1) there is exactly one reaction arrow;
 * (2) every species reads as a formula (dictionary names are NOT consulted);
 * and (3) the arrow is not "=", or a medium is named, or some species carries
 * a digit, a charge, a hydrate dot or a two-letter element symbol. So
 * `x + y = 5`, `f(x) -> 0` and `C + O = CO` route exactly as before.
 */
export function chemistryKindFor(raw: string): "balance" | "half-reaction" | null {
  if (!raw || raw.length > CAPS.inputChars) return null;
  const hasVerb = VERB_RE.test(raw);
  const req = readBalanceRequest(raw);
  if (!req) return null;
  const kind = req.kind === "balance" ? "balance" : "half-reaction";
  if (hasVerb) return req.equations.every((eq) => findArrows(eq).length >= 1) ? kind : null;
  const hasMediumOnly = req.medium !== null;
  // Two lines without the verb or a medium are an edge list or a system, not a
  // redox pair ("S -> B\nB -> C" belongs to the graph switch).
  if (req.equations.length > 1 && !hasMediumOnly) return null;
  for (const eq of req.equations) {
    const arrows = findArrows(eq);
    if (arrows.length !== 1) return null;
    const p = parseEquation(eq, { allowNames: false });
    if (!p.ok) return null;
    const isEq = eq.slice(arrows[0].index, arrows[0].index + arrows[0].length) === "=";
    const marked = p.species.some((s) => {
      const body = s.input.replace(STATE_RE, "").replace(/^\s*\d+\s*/, "");
      return /\d/.test(normalizeFormulaText(body)) || s.charge !== 0 || /[·•]/.test(body) || TWO_LETTER.test(body) || s.electron;
    });
    if (isEq && !hasMediumOnly && !marked) return null;
  }
  return kind;
}
