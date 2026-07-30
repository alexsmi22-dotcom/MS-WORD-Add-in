// Mass-spectrometry helpers for a compound (name / formula / SMILES): exact
// monoisotopic and average masses, the theoretical isotope pattern, and common
// adduct m/z values. For proteomics / metabolomics / small-molecule MS work —
// all computed offline. Pure functions; no Office.js.
//
// Monoisotopic & average masses come from OpenChemLib (authoritative, already
// bundled). The isotope pattern is a discrete convolution over the stable-isotope
// abundances below (NIST/IUPAC standard values); m/z of each adduct is exact
// arithmetic on the monoisotopic mass and an ion mass shift.

import { Molecule } from "openchemlib";
import { lookupSmiles } from "./structures";

const ELECTRON = 0.00054858;

// Stable isotopes for the elements found in essentially all organic / bio /
// drug molecules: [nucleon mass, fractional abundance]. Standard NIST values.
interface Isotope {
  mass: number;
  abundance: number;
}
const ISOTOPES: Record<string, Isotope[]> = {
  H: [{ mass: 1.0078250319, abundance: 0.999885 }, { mass: 2.0141017779, abundance: 0.000115 }],
  C: [{ mass: 12.0, abundance: 0.9893 }, { mass: 13.0033548378, abundance: 0.0107 }],
  N: [{ mass: 14.0030740052, abundance: 0.99632 }, { mass: 15.0001088984, abundance: 0.00368 }],
  O: [
    { mass: 15.9949146221, abundance: 0.99757 },
    { mass: 16.9991315, abundance: 0.00038 },
    { mass: 17.9991604, abundance: 0.00205 },
  ],
  F: [{ mass: 18.99840322, abundance: 1.0 }],
  Na: [{ mass: 22.98976928, abundance: 1.0 }],
  Si: [
    { mass: 27.9769265327, abundance: 0.922297 },
    { mass: 28.97649472, abundance: 0.046832 },
    { mass: 29.97377022, abundance: 0.030872 },
  ],
  P: [{ mass: 30.97376151, abundance: 1.0 }],
  S: [
    { mass: 31.97207069, abundance: 0.9493 },
    { mass: 32.9714585, abundance: 0.0076 },
    { mass: 33.96786683, abundance: 0.0429 },
    { mass: 35.96708088, abundance: 0.0002 },
  ],
  Cl: [{ mass: 34.96885271, abundance: 0.7578 }, { mass: 36.9659026, abundance: 0.2422 }],
  K: [
    { mass: 38.9637069, abundance: 0.932581 },
    { mass: 39.96399867, abundance: 0.000117 },
    { mass: 40.96182597, abundance: 0.067302 },
  ],
  Br: [{ mass: 78.9183376, abundance: 0.5069 }, { mass: 80.916291, abundance: 0.4931 }],
  I: [{ mass: 126.904473, abundance: 1.0 }],
  B: [{ mass: 10.012937, abundance: 0.199 }, { mass: 11.0093055, abundance: 0.801 }],
  Se: [
    { mass: 73.9224766, abundance: 0.0089 },
    { mass: 75.9192141, abundance: 0.0937 },
    { mass: 76.9199146, abundance: 0.0763 },
    { mass: 77.9173095, abundance: 0.2377 },
    { mass: 79.9165218, abundance: 0.4961 },
    { mass: 81.9167, abundance: 0.0873 },
  ],
};

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
  const parts = formula.split(/[·•.*]/).filter((t) => t.trim() !== "");
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
  /** Nucleon offset from the monoisotopic peak (0 = M, 1 = M+1, …). */
  offset: number;
  /** Intensity-weighted exact mass of the peak. */
  mass: number;
  /** Relative intensity, base peak = 100. */
  intensity: number;
}

// A distribution keyed by integer nucleon count → {probability, Σ exact mass}.
type Dist = Map<number, { p: number; m: number }>;

function convolve(a: Dist, b: Dist): Dist {
  const out: Dist = new Map();
  for (const [na, va] of a) {
    for (const [nb, vb] of b) {
      const n = na + nb;
      const p = va.p * vb.p;
      if (p < 1e-12) continue;
      const cur = out.get(n);
      if (cur) {
        cur.p += p;
        cur.m += p * (va.m / va.p + vb.m / vb.p);
      } else {
        out.set(n, { p, m: p * (va.m / va.p + vb.m / vb.p) });
      }
    }
  }
  return out;
}

/** Distribution of one element repeated `count` times (exponentiation by squaring). */
function elementDist(el: string, count: number): Dist | null {
  const iso = ISOTOPES[el];
  if (!iso) return null;
  let base: Dist = new Map();
  for (const i of iso) {
    const n = Math.round(i.mass);
    const cur = base.get(n);
    if (cur) {
      cur.p += i.abundance;
      cur.m += i.abundance * i.mass;
    } else {
      base.set(n, { p: i.abundance, m: i.abundance * i.mass });
    }
  }
  let result: Dist = new Map([[0, { p: 1, m: 0 }]]);
  let b = base;
  let k = count;
  while (k > 0) {
    if (k & 1) result = convolve(result, b);
    k >>= 1;
    if (k > 0) b = convolve(b, b);
  }
  return result;
}

/**
 * Theoretical isotope pattern for a formula, as peaks (M, M+1, …) with exact
 * centroid masses and intensities normalized to the base peak (100). Elements
 * outside the built-in isotope table are skipped for the *pattern shape* (their
 * absence is reported via `unsupported`), though masses/adducts remain exact.
 */
export function isotopePattern(
  counts: Record<string, number>,
  opts: { maxPeaks?: number; minIntensity?: number } = {}
): { peaks: IsotopePeak[]; unsupported: string[] } {
  const maxPeaks = opts.maxPeaks ?? 6;
  const minIntensity = opts.minIntensity ?? 0.1;
  const unsupported: string[] = [];
  let total: Dist = new Map([[0, { p: 1, m: 0 }]]);
  for (const [el, n] of Object.entries(counts)) {
    if (n <= 0) continue;
    const d = elementDist(el, n);
    if (!d) {
      unsupported.push(el);
      continue;
    }
    total = convolve(total, d);
  }
  const entries = [...total.entries()].sort((a, b) => a[0] - b[0]);
  if (!entries.length) return { peaks: [], unsupported };
  const baseNucleon = entries[0][0];
  const maxProb = Math.max(...entries.map(([, v]) => v.p));
  const peaks: IsotopePeak[] = entries
    .map(([n, v]) => ({ offset: n - baseNucleon, mass: v.m / v.p, intensity: (v.p / maxProb) * 100 }))
    .filter((pk) => pk.intensity >= minIntensity)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, maxPeaks);
  return { peaks, unsupported };
}

export interface Adduct {
  name: string;
  charge: number;
  /** Mass added to (or removed from) the neutral M, before dividing by charge. */
  massShift: number;
}

// Common ESI adducts. Mass shifts use the exact ion mass (± electron for the
// gained/lost charge). m/z = (M + massShift) / |charge|.
export const ADDUCTS: Adduct[] = [
  { name: "[M+H]+", charge: 1, massShift: 1.0078250319 - ELECTRON },
  { name: "[M+Na]+", charge: 1, massShift: 22.98976928 - ELECTRON },
  { name: "[M+K]+", charge: 1, massShift: 38.9637069 - ELECTRON },
  { name: "[M+NH4]+", charge: 1, massShift: 18.0343741 - ELECTRON },
  { name: "[M+2H]2+", charge: 2, massShift: 2 * (1.0078250319 - ELECTRON) },
  { name: "[M-H]-", charge: 1, massShift: -(1.0078250319 - ELECTRON) },
  { name: "[M+Cl]-", charge: 1, massShift: 34.96885271 + ELECTRON },
  { name: "[M+HCOO]-", charge: 1, massShift: 44.9976542 + ELECTRON },
  { name: "[M-2H]2-", charge: 2, massShift: -2 * (1.0078250319 - ELECTRON) },
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
}

/**
 * Full MS readout for an input (dictionary name, formula, or SMILES). Returns
 * null if the input can't be resolved to a structure.
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

  const mf = mol.getMolecularFormula();
  const monoisotopicMass = mf.absoluteWeight;
  const averageMass = mf.relativeWeight;
  const counts = parseFormula(mf.formula);
  const { peaks: rawPeaks, unsupported } = isotopePattern(counts);
  // The convolution only sums tabled elements, so anchor the peak masses to the
  // OCL monoisotopic mass (which includes every element) — the M peak lands at
  // the true mass and each M+n keeps its exact nucleon spacing. Also covers the
  // all-untabled case, where the raw M peak would otherwise report mass 0.
  const base = rawPeaks.length ? rawPeaks[0].mass : 0;
  const peaks = rawPeaks.length
    ? rawPeaks.map((p) => ({ ...p, mass: monoisotopicMass + (p.mass - base) }))
    : [{ offset: 0, mass: monoisotopicMass, intensity: 100 }];

  // The ESI adduct m/z table assumes a neutral M. If the drawn structure already
  // carries a net formal charge, protonation/cationization adducts are physically
  // meaningless, so omit them (mass and pattern above remain exact).
  let netCharge = 0;
  for (let i = 0; i < mol.getAllAtoms(); i++) netCharge += mol.getAtomCharge(i);
  const adducts =
    netCharge === 0
      ? ADDUCTS.map((a) => ({ name: a.name, mz: adductMz(monoisotopicMass, a), charge: a.charge }))
      : [];

  return {
    formula: mf.formula,
    monoisotopicMass,
    averageMass,
    pattern: peaks,
    unsupportedInPattern: unsupported,
    netCharge,
    adducts,
  };
}
