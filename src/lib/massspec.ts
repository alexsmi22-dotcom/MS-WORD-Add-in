// Mass-spectrometry helpers for a compound (name / formula / SMILES): exact
// monoisotopic and average masses, the theoretical isotope pattern, and common
// adduct m/z values. For proteomics / metabolomics / small-molecule MS work —
// all computed offline. Pure functions; no Office.js.
//
// THE MASS REFERENCE IS isotopes.ts (AME2020 masses, CIAAW 2024 compositions),
// NOT OpenChemLib (v2.138.0). OpenChemLib's per-element masses are wrong for some
// elements — Cu 10 mDa high (54 ppm on Cu(NO₃)₂), Pa 15 Da low — and it invents
// masses for Tc, Po and Ra, which have no stable isotope. OpenChemLib is still
// the SMILES PARSER; every monoisotopic, average and adduct mass, on the formula
// path and the SMILES path alike, is recomputed here from element counts.
//
// The isotope pattern is a pruned discrete convolution over EVERY element with a
// representative composition (84 elements), keyed by mass number, with M built
// from each element's MOST ABUNDANT isotope (IUPAC usage) — so peaks lighter than
// M are labelled M−1, M−2 … (selenium's ⁷⁴Se is M−6; boron's ¹⁰B is M−1). An
// element with no stable isotope, or Z > 92, is refused by name: no pattern and
// no monoisotopic mass. m/z of each adduct is exact arithmetic on the
// monoisotopic mass and an ion mass shift.

import { Molecule } from "openchemlib";
import { lookupSmiles, resolveChemInput, ChemReadMode, FormulaReading } from "./structures";
import { ELECTRON_MASS, elementIsotopes, elementRefusal, isotopeLabel, isotopeMass, monoisotopicElementMass } from "./isotopes";

const ELECTRON = ELECTRON_MASS;

/** Most-abundant-isotope mass from isotopes.ts; throws if absent (only for tabled elements). */
function mono(symbol: string): number {
  const m = monoisotopicElementMass(symbol);
  if (m === null) throw new Error(`no composition for ${symbol}`);
  return m;
}

/** Parses a molecular formula ("C9H8O4", "C22H24N2O8") into element→count. */
export function parseFormula(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};

  // A HYDRATE DOT SEPARATES FORMULAS; IT IS NOT PUNCTUATION TO BE DELETED.
  //
  // Stripping every non-alphanumeric character merged the parts of a hydrate and
  // joined the multiplier to the element before it: "CuSO4·5H2O" became "CuSO45H2O",
  // so "O4" and the leading "5" read as "O45" and the answer was
  // {Cu:1, S:1, O:46, H:2} instead of {Cu:1, S:1, O:9, H:10}.
  //
  // This was UNREACHABLE when found — the only caller feeds it OpenChemLib's already
  // clean mf.formula — which is exactly why it is worth fixing rather than leaving:
  // an exported function that is wrong only because nobody calls it that way is a
  // trap set for the next caller, and the count it returns feeds monoisotopic mass.
  //
  // Each dot-separated part is parsed on its own and multiplied by its leading
  // coefficient, which is what the notation means.
  //
  // UNICODE SUBSCRIPT DIGITS ARE ACCEPTED AS DIGITS. The pane displays every
  // formula scientifically — CH₄, C₈H₁₈ — and Word's own autocorrect produces
  // the same characters, so a user copying a displayed formula back into a
  // field is typing exactly what we showed them. Refusing ₄ while displaying
  // ₄ would make the correct rendering a round-trip trap.
  const SUB_DIGITS: Record<string, string> = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  };
  const normalized = formula.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => SUB_DIGITS[c]);
  const parts = normalized.split(/[·•.*]/).filter((t) => t.trim() !== "");
  for (const part of parts) {
    const trimmed = part.trim();
    // A leading integer multiplies the whole part: the 5 in "5H2O" is five waters.
    const lead = /^(\d+)/.exec(trimmed);
    const multiplier = lead ? parseInt(lead[1], 10) : 1;
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue;
    const body = lead ? trimmed.slice(lead[1].length) : trimmed;

    // BRACKET GROUPS CARRY THEIR OWN MULTIPLIER, and stripping the brackets threw it
    // away: "Cr2(SO4)3" became "Cr2SO43", so the group count 3 was read as part of
    // the oxygen subscript and gave O:43 instead of S:3, O:12. Fixing the hydrate dot
    // without this would have replaced one silent mis-parse with another.
    //
    // A stack of pending tallies, one level per open bracket. Every count is
    // multiplied out when its level closes, so nesting works — "((CH3)2CH)2O" and
    // "K3[Fe(C2O4)3]" included.
    const stack: Array<Record<string, number>> = [{}];
    const tok = /([A-Z][a-z]?)(\d*)|([([{])|([)\]}])(\d*)|(.)/g;
    let m: RegExpExecArray | null;
    let malformed = false;
    while ((m = tok.exec(body)) !== null) {
      if (m[1]) {
        const top = stack[stack.length - 1];
        top[m[1]] = (top[m[1]] ?? 0) + (m[2] ? parseInt(m[2], 10) : 1);
      } else if (m[3]) {
        stack.push({});
      } else if (m[4]) {
        if (stack.length < 2) {
          malformed = true;
          break;
        }
        const group = stack.pop() as Record<string, number>;
        const k = m[5] ? parseInt(m[5], 10) : 1;
        const top = stack[stack.length - 1];
        for (const [el, n] of Object.entries(group)) top[el] = (top[el] ?? 0) + n * k;
      }
      // m[6] is anything else — a charge sign or stray punctuation — and is ignored,
      // which is what the old character-class strip did for those.
    }
    // An unclosed bracket means the formula was not understood; adding up whatever
    // was parsed so far would be a guess presented as a count.
    if (malformed || stack.length !== 1) continue;
    for (const [el, n] of Object.entries(stack[0])) {
      counts[el] = (counts[el] ?? 0) + multiplier * n;
    }
  }
  return counts;
}

export interface IsotopePeak {
  /**
   * Nominal-mass offset from M, the peak built from every element's MOST
   * ABUNDANT isotope (0 = M, −2 = M−2, +1 = M+1). Negative for isotopes lighter
   * than the most abundant one (⁵⁴Fe, ⁷⁴Se, ¹⁰B, ²⁰⁴Hg …).
   */
  offset: number;
  /** Intensity-weighted exact mass of the nominal-mass group (no fine structure). */
  mass: number;
  /** Relative intensity, base peak = 100. */
  intensity: number;
  /** "M", "M−2" (true minus, U+2212), "M+1". */
  label: string;
}

/** "M", "M−6", "M+2" — the display-contract label for an offset. */
export function peakLabel(offset: number): string {
  return offset === 0 ? "M" : offset < 0 ? `M−${-offset}` : `M+${offset}`;
}

/** Peaks kept by default: every one at or above this % of the base peak … */
export const PATTERN_MIN_INTENSITY = 0.1;
/** … up to this many (the most intense), with the rest COUNTED, never dropped silently. */
export const PATTERN_MAX_PEAKS = 60;
/**
 * Convolution pruning: after every convolution step, terms below this fraction
 * of that step's LARGEST term are discarded (relative, not absolute, so a
 * protein's tiny per-isotopologue probabilities are not all thrown away).
 * Far below the 0.1 % display cut: it changes no displayed peak.
 */
export const PATTERN_PRUNE = 1e-12;

/**
 * A dense distribution over nominal-mass offsets lo … lo + p.length − 1:
 * p = probability, m = Σ probability × exact mass (so a group's centroid is m/p).
 */
interface Dist {
  lo: number;
  p: Float64Array;
  m: Float64Array;
}

function prune(d: Dist): Dist {
  let max = 0;
  for (let i = 0; i < d.p.length; i++) if (d.p[i] > max) max = d.p[i];
  const floor = max * PATTERN_PRUNE;
  let a = 0;
  let b = d.p.length - 1;
  while (a < b && d.p[a] < floor) a++;
  while (b > a && d.p[b] < floor) b--;
  if (a === 0 && b === d.p.length - 1) return d;
  return { lo: d.lo + a, p: d.p.slice(a, b + 1), m: d.m.slice(a, b + 1) };
}

function convolve(a: Dist, b: Dist): Dist {
  const n = a.p.length + b.p.length - 1;
  const p = new Float64Array(n);
  const m = new Float64Array(n);
  for (let i = 0; i < a.p.length; i++) {
    const pa = a.p[i];
    if (pa === 0) continue;
    const ma = a.m[i];
    for (let j = 0; j < b.p.length; j++) {
      const pb = b.p[j];
      if (pb === 0) continue;
      p[i + j] += pa * pb;
      // Σ pa·pb·(mass_a + mass_b) over the pair = pa·mb + pb·ma.
      m[i + j] += pa * b.m[j] + pb * ma;
    }
  }
  return prune({ lo: a.lo + b.lo, p, m });
}

/**
 * One element repeated `count` times (exponentiation by squaring), keyed by mass
 * number relative to the element's most abundant isotope — so the LIGHTEST
 * isotope sits at a negative offset and nothing assumes it is the monoisotopic
 * one (the v2.137.0 selenium/boron defect).
 */
function elementDist(symbol: string, count: number): Dist | null {
  const el = elementIsotopes(symbol);
  if (!el) return null;
  const A0 = el.mostAbundant.A;
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of el.isotopes) {
    lo = Math.min(lo, i.A - A0);
    hi = Math.max(hi, i.A - A0);
  }
  const base: Dist = { lo, p: new Float64Array(hi - lo + 1), m: new Float64Array(hi - lo + 1) };
  for (const i of el.isotopes) {
    base.p[i.A - A0 - lo] += i.abundance;
    base.m[i.A - A0 - lo] += i.abundance * i.mass;
  }
  let result: Dist = { lo: 0, p: Float64Array.of(1), m: Float64Array.of(0) };
  let b = base;
  let k = count;
  while (k > 0) {
    if (k & 1) result = convolve(result, b);
    k = Math.floor(k / 2);
    if (k > 0) b = convolve(b, b);
  }
  return result;
}

/** A composition: natural-abundance element counts plus explicitly named isotopes. */
export interface Composition {
  natural: Record<string, number>;
  /** Atoms the input NAMED by mass number ([13C], [2H], [99Tc]): each a single isotope. */
  labelled?: { symbol: string; A: number; count: number }[];
}

export interface IsotopePatternResult {
  peaks: IsotopePeak[];
  /** Elements with no composition in the table (callers refuse these by name). */
  unsupported: string[];
  /** Computed peaks below the display threshold, counted rather than dropped silently. */
  belowThreshold: number;
  /** Peaks at or above the threshold beyond the peak cap (the least intense), counted. */
  beyondCap: number;
  /** What was cut and why, for the pane and the inserted text. */
  note: string;
}

/**
 * Theoretical isotope pattern, as nominal-mass peaks labelled from M (the
 * most-abundant-isotope peak), with intensity-weighted exact masses and
 * intensities relative to the base peak (100). Every peak ≥ minIntensity % is
 * kept up to maxPeaks; what is not shown is counted in the result and the note.
 */
export function isotopePattern(
  counts: Record<string, number>,
  opts: { maxPeaks?: number; minIntensity?: number; labelled?: Composition["labelled"] } = {}
): IsotopePatternResult {
  const maxPeaks = opts.maxPeaks ?? PATTERN_MAX_PEAKS;
  const minIntensity = opts.minIntensity ?? PATTERN_MIN_INTENSITY;
  const unsupported: string[] = [];
  let total: Dist = { lo: 0, p: Float64Array.of(1), m: Float64Array.of(0) };
  for (const [el, n] of Object.entries(counts)) {
    if (!(n > 0)) continue;
    const d = elementDist(el, n);
    if (!d) {
      unsupported.push(el);
      continue;
    }
    total = convolve(total, d);
  }
  // A named isotope is a single isotope: it shifts every peak's mass by its own
  // exact mass and does not broaden the pattern.
  let fixed = 0;
  for (const l of opts.labelled ?? []) {
    const m = isotopeMass(l.symbol, l.A);
    if (m === null) {
      unsupported.push(isotopeLabel(l.symbol, l.A));
      continue;
    }
    fixed += l.count * m;
  }
  let maxP = 0;
  for (let i = 0; i < total.p.length; i++) if (total.p[i] > maxP) maxP = total.p[i];
  const all: IsotopePeak[] = [];
  for (let i = 0; i < total.p.length; i++) {
    if (!(total.p[i] > 0)) continue;
    const offset = total.lo + i;
    all.push({ offset, mass: total.m[i] / total.p[i] + fixed, intensity: (total.p[i] / maxP) * 100, label: peakLabel(offset) });
  }
  const shown = all.filter((pk) => pk.intensity >= minIntensity);
  const belowThreshold = all.length - shown.length;
  let beyondCap = 0;
  let peaks = shown;
  if (shown.length > maxPeaks) {
    peaks = [...shown].sort((a, b) => b.intensity - a.intensity).slice(0, maxPeaks);
    beyondCap = shown.length - maxPeaks;
  }
  peaks.sort((a, b) => a.offset - b.offset);
  const parts = [
    `Nominal-mass peaks (no fine structure), labelled from M = the most abundant isotope of every element; ` +
      `natural representative composition (CIAAW 2024; AME2020 masses).`,
  ];
  if (belowThreshold) parts.push(`${belowThreshold} further peak${belowThreshold === 1 ? "" : "s"} below ${minIntensity} % of the base not listed.`);
  if (beyondCap) parts.push(`${beyondCap} further peak${beyondCap === 1 ? "" : "s"} at or above ${minIntensity} % beyond the ${maxPeaks}-peak cap not listed.`);
  return { peaks, unsupported, belowThreshold, beyondCap, note: parts.join(" ") };
}

export interface Adduct {
  name: string;
  charge: number;
  /** Mass added to (or removed from) the neutral M, before dividing by charge. */
  massShift: number;
}

// Common ESI adducts. Mass shifts use the exact ion mass (± electron for the
// gained/lost charge), built from isotopes.ts masses — the same reference as M.
// m/z = (M + massShift) / |charge|.
const H1 = mono("H");
const NH4 = mono("N") + 4 * H1;
const HCOO = H1 + mono("C") + 2 * mono("O");
export const ADDUCTS: Adduct[] = [
  { name: "[M+H]+", charge: 1, massShift: H1 - ELECTRON },
  { name: "[M+Na]+", charge: 1, massShift: mono("Na") - ELECTRON },
  { name: "[M+K]+", charge: 1, massShift: mono("K") - ELECTRON },
  { name: "[M+NH4]+", charge: 1, massShift: NH4 - ELECTRON },
  { name: "[M+2H]2+", charge: 2, massShift: 2 * (H1 - ELECTRON) },
  { name: "[M-H]-", charge: 1, massShift: -(H1 - ELECTRON) },
  { name: "[M+Cl]-", charge: 1, massShift: mono("Cl") + ELECTRON },
  { name: "[M+HCOO]-", charge: 1, massShift: HCOO + ELECTRON },
  { name: "[M-2H]2-", charge: 2, massShift: -2 * (H1 - ELECTRON) },
];

/** m/z for an adduct given the neutral monoisotopic mass. */
export function adductMz(monoMass: number, adduct: Adduct): number {
  return (monoMass + adduct.massShift) / adduct.charge;
}

export interface MassSpecResult {
  formula: string;
  monoisotopicMass: number;
  averageMass: number;
  pattern: IsotopePeak[];
  unsupportedInPattern: string[];
  /**
   * Net formal charge of the input. The ESI adduct table assumes a NEUTRAL
   * precursor, so when this is non-zero the adducts don't apply and are omitted
   * (mass and isotope pattern are still valid for the given formula).
   */
  netCharge: number;
  adducts: { name: string; mz: number; charge: number }[];
  /** What the pattern leaves out and why (threshold, cap, no fine structure). */
  patternNote: string;
  /** Computed peaks below the display threshold (counted, not shown). */
  belowThreshold: number;
  /** Peaks above the threshold beyond the peak cap (counted, not shown). */
  beyondCap: number;
  /** Named isotopes in the input ([13C], [99Tc]), typeset: "¹³C × 1". */
  labelledIsotopes: string[];
  /** The mass reference, for provenance in the pane and the inserted text. */
  massSource: string;
}

/** Provenance line for every MS result. */
export const MASS_SOURCE = "Masses: AME2020 (Wang et al. 2021); compositions: CIAAW 2024 (interval elements: NIST representative values).";

/**
 * Full MS readout for an input (dictionary name, formula, or SMILES). Returns
 * null if the input can't be resolved to a structure, OR when it is refused (an
 * element with no stable isotope, Z > 92) — resolveMassSpec says why by name.
 */
export function computeMassSpec(input: string): MassSpecResult | null {
  const looked = lookupSmiles(input);
  const raw = looked ? looked.smiles : input.trim();
  if (!raw) return null;
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(raw);
  } catch {
    return null;
  }
  if (mol.getAllAtoms() === 0) return null;
  const r = massSpecFromMolecule(mol);
  return typeof r === "string" ? null : r;
}

/**
 * The composition of a parsed molecule, by WALKING ITS ATOMS — not by re-reading
 * OpenChemLib's formula string, which drops isotope labels ([13CH4] prints as
 * CH₄, [2H] as D). A labelled atom is a single named isotope; implicit
 * hydrogens are natural hydrogen.
 */
export function compositionFromMolecule(mol: Molecule): Composition | string {
  const natural: Record<string, number> = {};
  const lab = new Map<string, { symbol: string; A: number; count: number }>();
  const add = (sym: string, n: number) => {
    if (n > 0) natural[sym] = (natural[sym] ?? 0) + n;
  };
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    const z = mol.getAtomicNo(i);
    const sym = mol.getAtomLabel(i);
    if (!(z >= 1) || !/^[A-Z][a-z]?$/.test(sym)) return `The structure contains a non-element atom (“${sym}”), which has no mass.`;
    const A = mol.getAtomMass(i);
    if (A > 0) {
      const key = `${sym}-${A}`;
      const cur = lab.get(key);
      if (cur) cur.count++;
      else lab.set(key, { symbol: sym, A, count: 1 });
    } else {
      add(sym, 1);
    }
    add("H", mol.getImplicitHydrogens(i));
  }
  return { natural, labelled: [...lab.values()] };
}

function massSpecFromMolecule(mol: Molecule): MassSpecResult | string {
  const mf = mol.getMolecularFormula();
  // The ESI adduct m/z table assumes a neutral M. If the drawn structure already
  // carries a net formal charge, protonation/cationization adducts are physically
  // meaningless, so omit them (mass and pattern above remain exact).
  let netCharge = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) netCharge += mol.getAtomCharge(i);
  const comp = compositionFromMolecule(mol);
  if (typeof comp === "string") return comp;
  return assemble(mf.formula, comp, netCharge, mf.formula);
}

/**
 * Masses, pattern and adducts from a composition — ONE path for formula and
 * SMILES readings, with every mass from isotopes.ts. Returns a refusal string
 * (by name) for an element with no stable isotope, Z > 92, an isotope with no
 * stored mass, or a composition over the caps.
 */
function assemble(formula: string, comp: Composition, netCharge: number, display: string): MassSpecResult | string {
  // Refusals first, by name, before any work.
  for (const el of Object.keys(comp.natural)) {
    if (!(comp.natural[el] > 0)) continue;
    const why = elementRefusal(el);
    if (why) return why;
  }
  for (const l of comp.labelled ?? []) {
    if (isotopeMass(l.symbol, l.A) === null) {
      return (
        `No AME2020 mass is stored for ${isotopeLabel(l.symbol, l.A)}: the table holds the natural isotopes ` +
        `of every element up to uranium and a list of common radiolabels.`
      );
    }
  }
  // Caps, before any work: the convolution's time grows with each element's
  // count (its distribution widens), so an atom cap alone bounds memory, not time.
  let atoms = 0;
  for (const [el, n] of Object.entries(comp.natural)) {
    atoms += n;
    const cap = maxAtomsFor(el);
    if (n > cap) {
      return `${display} has ${n} ${el} atoms — above the ${cap}-atom-per-element limit for an isotope pattern.`;
    }
  }
  for (const l of comp.labelled ?? []) atoms += l.count;
  if (atoms > MAX_FORMULA_ATOMS) return `${display} has ${atoms} atoms — above the ${MAX_FORMULA_ATOMS}-atom limit for an isotope pattern.`;
  const work = patternWorkEstimate(comp.natural);
  if (work > MAX_PATTERN_WORK) {
    return (
      `${display}'s isotope pattern would take about ${Math.round(work / 1e6)} million convolution steps — above the ` +
      `${MAX_PATTERN_WORK / 1e6}-million limit that keeps the pane responsive (many atoms of several multi-isotope elements).`
    );
  }

  let monoisotopicMass = 0;
  let averageMass = 0;
  for (const [el, n] of Object.entries(comp.natural)) {
    const e = elementIsotopes(el);
    if (!e) return elementRefusal(el) ?? `No isotope data for ${el}.`;
    monoisotopicMass += n * e.mostAbundant.mass;
    averageMass += n * e.averageMass;
  }
  const labelledIsotopes: string[] = [];
  for (const l of comp.labelled ?? []) {
    const m = isotopeMass(l.symbol, l.A) as number;
    monoisotopicMass += l.count * m;
    averageMass += l.count * m;
    labelledIsotopes.push(`${isotopeLabel(l.symbol, l.A)} × ${l.count}`);
  }

  const pat = isotopePattern(comp.natural, { labelled: comp.labelled });
  const adducts =
    netCharge === 0
      ? ADDUCTS.map((a) => ({ name: a.name, mz: adductMz(monoisotopicMass, a), charge: a.charge }))
      : [];

  return {
    formula,
    monoisotopicMass,
    averageMass,
    pattern: pat.peaks,
    unsupportedInPattern: pat.unsupported,
    netCharge,
    adducts,
    // The natural-composition note is not true of a labelled atom: say that the
    // named isotopes are fixed (100 %), and that the rest is natural.
    patternNote: labelledIsotopes.length
      ? `${pat.note} Labelled atoms (${labelledIsotopes.join(", ")}) are fixed at their named isotope (100 %, no enrichment distribution); only the unlabelled atoms follow natural composition.`
      : pat.note,
    belowThreshold: pat.belowThreshold,
    beyondCap: pat.beyondCap,
    labelledIsotopes,
    massSource: MASS_SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Mode-aware entry point for TYPED input (v2.137.0, §A-18 / §E6)
// ---------------------------------------------------------------------------
//
// computeMassSpec above keeps its legacy order (dictionary → SMILES) because it
// is fed SMILES by construction elsewhere. resolveMassSpec applies the
// formula-vs-SMILES rule of structures.resolveChemInput: "Co" is cobalt, not
// CH₃O; "CN" is ambiguous and BOTH readings are computed so the pane can show
// them; "Fe2O3", which has no structure, now has masses from its formula.

export type MassSpecResolution =
  | { kind: "ok"; reading: "dictionary" | "formula" | "smiles"; result: MassSpecResult; note?: string }
  | {
      kind: "ambiguous";
      message: string;
      /** formula is null only when the formula reading has no molecular ion (fractional). */
      readings: { formula: MassSpecResult | null; smiles: MassSpecResult };
    }
  | { kind: "none"; message: string };

/**
 * Bounds on a reading, set BEFORE any work: the isotope convolution's time grows
 * with each element's count (its distribution widens), so an atom cap alone
 * bounds memory, not time. Se99999 was 640 ms in v2.137.0 — a frozen Word pane
 * for a 7-character input.
 *
 * Elements with 7–10 isotopes (Sn spans 12 Da; Xe, Te, Cd, Hg 8–12 Da) widen the
 * distribution fastest. ONE element at the per-element cap is cheap (Sn10000
 * ≈ 35–75 ms), but SEVERAL of them together are not: measured in Node on this
 * machine, five of the widest × 10000 took 331 ms, twenty × 2500 took 423 ms,
 * and the spectroscopy review measured 811 ms in jest (10 × 5000) and 1.3 s in
 * Node (33 × 1515) — atom caps alone do not bound the time. So a THIRD cap,
 * patternWorkEstimate ≤ MAX_PATTERN_WORK, is checked before any work.
 * Calibration (2026-10-14, 30 shapes from 1 to 63 elements): time is linear in
 * the estimate — ≈ 2.7 ms per million on an idle machine and at most 20 ms per
 * million with the machine saturated by parallel test runs. The 40-million bound
 * is therefore ≈ 110 ms idle and ≤ 0.8 s saturated; both review inputs (≈ 110 M
 * and ≈ 100 M) are refused. Ordinary inputs are far below it (insulin ≈ 0.01 M;
 * Sn10000 ≈ 14 M; Se10000Br10000S10000O10000Cl9999 ≈ 20 M).
 */
const MAX_FORMULA_ATOMS = 50000;
const MAX_ATOMS_PER_ELEMENT = 10000;
const MAX_PATTERN_WORK = 40e6;

/**
 * A work estimate for the convolution, computable BEFORE any work, following the
 * code's own order: an element of n atoms has a distribution about
 * w = 12·σ·√n + span wide (σ = one atom's mass-number SD; the pruned tails reach
 * ≈ ±6σ), its squaring steps cost ≈ 2w², and folding it into the running total
 * costs (running width) × w, where the running width grows like 12·√(Σ n·σ²).
 */
export function patternWorkEstimate(counts: Record<string, number>): number {
  let variance = 0;
  let work = 0;
  for (const [el, n] of Object.entries(counts)) {
    const e = elementIsotopes(el);
    if (!e || !(n > 0) || e.isotopes.length < 2) continue;
    const As = e.isotopes.map((i) => i.A);
    const span = Math.max(...As) - Math.min(...As);
    const mean = e.isotopes.reduce((s, i) => s + i.abundance * i.A, 0);
    const v1 = e.isotopes.reduce((s, i) => s + i.abundance * (i.A - mean) ** 2, 0);
    const w = 12 * Math.sqrt(v1 * n) + span + 1;
    const running = 12 * Math.sqrt(variance) + 1;
    work += 2 * w * w + running * w;
    variance += n * v1;
  }
  return work;
}

/** The per-element atom cap for an isotope pattern (see above). */
export function maxAtomsFor(_symbol: string): number {
  return MAX_ATOMS_PER_ELEMENT;
}

function massSpecFromFormula(f: FormulaReading): MassSpecResult | string {
  if (f.fractional) {
    return (
      `${f.display} has a fractional composition, so it is not one molecule and has no molecular ion. ` +
      `Enter whole formula units — e.g. 2CaSO4·H2O for the hemihydrate.`
    );
  }
  return assemble(f.hill, formulaComposition(f.counts), f.charge, f.display);
}

/**
 * D and T in a formula (CDCl₃, D₂O) are NAMED isotopes, ²H and ³H — single
 * isotopes at their AME2020 masses, never natural hydrogen (chemValidate keeps
 * them as their own keys). Everything else is natural abundance.
 */
const HYDROGEN_ISOTOPE_KEYS: Record<string, number> = { D: 2, T: 3 };
function formulaComposition(counts: Record<string, number>): Composition {
  const natural: Record<string, number> = {};
  const labelled: { symbol: string; A: number; count: number }[] = [];
  for (const [k, n] of Object.entries(counts)) {
    const A = HYDROGEN_ISOTOPE_KEYS[k];
    if (A) labelled.push({ symbol: "H", A, count: n });
    else natural[k] = n;
  }
  return { natural, labelled };
}

/** The reading said: "D read as deuterium, ²H (2.014102 u), not natural hydrogen." */
function hydrogenIsotopeNote(counts: Record<string, number>): string | undefined {
  const parts: string[] = [];
  if (counts.D) parts.push(`D read as deuterium, ²H (${(isotopeMass("H", 2) as number).toFixed(6)} u)`);
  if (counts.T) parts.push(`T read as tritium, ³H (${(isotopeMass("H", 3) as number).toFixed(6)} u)`);
  return parts.length ? `${parts.join("; ")} — a named isotope, not natural hydrogen.` : undefined;
}

const joinNotes = (...n: (string | undefined)[]): string | undefined => {
  const kept = n.filter((x): x is string => !!x);
  return kept.length ? kept.join(" ") : undefined;
};

function smilesSpec(smiles: string): MassSpecResult | string | null {
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(smiles);
  } catch {
    return null;
  }
  return mol.getAllAtoms() ? massSpecFromMolecule(mol) : null;
}

/** The MS readout for typed input, reading formulas as formulas (see above). */
export function resolveMassSpec(input: string, mode: ChemReadMode = "auto"): MassSpecResolution {
  const r = resolveChemInput(input, mode, "massspec");
  switch (r.kind) {
    case "none":
      return r;
    case "dictionary":
    case "smiles": {
      const spec = smilesSpec(r.smiles);
      if (!spec) return { kind: "none", message: `“${input.trim()}” could not be read as a structure.` };
      if (typeof spec === "string") return { kind: "none", message: spec };
      return { kind: "ok", reading: r.kind, result: spec, note: r.note };
    }
    case "formula": {
      const spec = massSpecFromFormula(r.formula);
      if (typeof spec === "string") return { kind: "none", message: spec };
      return { kind: "ok", reading: "formula", result: spec, note: joinNotes(r.note, hydrogenIsotopeNote(r.formula.counts)) };
    }
    case "ambiguous": {
      const smiles = smilesSpec(r.smiles);
      const formula = massSpecFromFormula(r.formula);
      if (!smiles || typeof smiles === "string") {
        if (typeof formula !== "string") {
          return { kind: "ok", reading: "formula", result: formula, note: hydrogenIsotopeNote(r.formula.counts) };
        }
        return { kind: "none", message: typeof smiles === "string" ? `${formula} ${smiles}` : formula };
      }
      return { kind: "ambiguous", message: r.message, readings: { formula: typeof formula === "string" ? null : formula, smiles } };
    }
  }
}
