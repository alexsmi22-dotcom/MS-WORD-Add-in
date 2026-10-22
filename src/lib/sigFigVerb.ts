// Significant figures as a Solve verb (student pack, release A).
//
//   how many significant figures in 0.00450      → 3 (4, 5, 0)
//   sig figs in 1200                              → 2 to 4 — AMBIGUOUS, said so
//   round 0.0045678 to 3 sig figs                 → 0.00457
//   3.40 × 2.1 with sig figs                      → 7.1 (× ÷: fewest figures)
//   12.11 + 18.0 + 1.013 sig figs                 → 31.1 (+ −: fewest decimals)
//   12 eggs × 0.0450 kg with sig figs             → 0.540 kg (12 is a count)
//   round 10.0 ± 0.123 to the uncertainty         → 10.0 ± 0.1
//
// EXACT ARITHMETIC. Every value is a BigInt rational, so rounding is decided
// on the real digits: 2.675 really is a tie, which a binary double (2.67499…)
// would round the wrong way. The units.ts helpers (significantFigures,
// resultFigures, roundSig, formatSig) are NOT reused: they serve the
// calculators — 1200 silently counts 2, the result clamps to 2–6 figures,
// rounding is binary and trailing zeros are dropped — which is right for an
// engineering readout and wrong for a sig-fig lesson.
//
// READS THE RAW INPUT. The pane's paste fold drops a trailing "." ("1200." →
// "1200", four figures → an ambiguous two), so the pane hands this verb
// solveInput.value, never the folded text.
//
// Returns null for anything that is not a sig-fig question — a variable, an
// unknown word, no number — so every older Solve path keeps its inputs.

import type { VerbResult } from "./algebraTools";
import { parseCompoundUnit, formatUnit, lookup } from "./units";
import { superscript } from "./axis";

const MINUS = "−";
const TIMES = "×";
/** The largest power of ten a typed number may carry (|n| ≤ 1000), checked before any BigInt work. */
export const SIGFIG_EXP_CAP = 1000;
/** Bits any exact intermediate may reach (≈ 4200 decimal digits): a product chain cannot grow without bound. */
const BIT_CAP = 14000;
const bitLen = (x: bigint): number => (x === 0n ? 0 : (x < 0n ? -x : x).toString(16).length * 4);
/** No-break, thin and narrow no-break spaces (built from code points: never invisible literals in source). */
const SPACE_LIKE = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, "g");

// ---------------------------------------------------------------------------
// Exact rationals (BigInt). Small and local on purpose: only + − × ÷, compare
// and the decimal place arithmetic this verb needs.
// ---------------------------------------------------------------------------

export interface Q {
  n: bigint;
  d: bigint; // > 0
}

const absB = (x: bigint): bigint => (x < 0n ? -x : x);
function gcdB(a: bigint, b: bigint): bigint {
  a = absB(a);
  b = absB(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function q(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new Error("division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdB(n, d);
  return { n: n / g, d: d / g };
}
const qAdd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qSub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const qMul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const qDiv = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
const qNeg = (a: Q): Q => ({ n: -a.n, d: a.d });
const qIsZero = (a: Q): boolean => a.n === 0n;
const pow10 = (k: number): bigint => 10n ** BigInt(k);
const qPow10 = (k: number): Q => (k >= 0 ? q(pow10(k)) : q(1n, pow10(-k)));

/** ⌊log₁₀|x|⌋ exactly, x ≠ 0. */
export function floorLog10(x: Q): number {
  const a = absB(x.n);
  const b = x.d;
  let k = a.toString().length - b.toString().length;
  const below = k >= 0 ? a < b * pow10(k) : a * pow10(-k) < b;
  if (below) k -= 1;
  return k;
}

/**
 * x rounded to a multiple of 10^place, halves AWAY FROM ZERO (the "5 rounds
 * up" rule school texts teach). Returns the integer M with x ≈ M·10^place,
 * whether the dropped part was exactly one half, and what round-half-to-even
 * would have given.
 */
export function roundToPlace(x: Q, place: number): { M: bigint; tie: boolean; evenM: bigint } {
  const s = qDiv(x, qPow10(place)); // exact
  const neg = s.n < 0n;
  const a = absB(s.n);
  const fl = a / s.d;
  const rem2 = (a % s.d) * 2n;
  const tie = rem2 === s.d;
  let up = rem2 >= s.d ? fl + 1n : fl;
  const even = tie ? (fl % 2n === 0n ? fl : fl + 1n) : up;
  if (neg) {
    up = -up;
    return { M: up, tie, evenM: -even };
  }
  return { M: up, tie, evenM: even };
}

/** M·10^place as plain decimal text, U+2212 minus. */
function plainDigits(M: bigint, place: number): string {
  // Zero at a place ≥ 10⁰ is just "0" — never "00" for 0 at the tens.
  if (M === 0n && place >= 0) return "0";
  const neg = M < 0n;
  let s = absB(M).toString();
  if (place >= 0) s += "0".repeat(place);
  else {
    const k = -place;
    if (s.length <= k) s = "0".repeat(k - s.length + 1) + s;
    s = `${s.slice(0, s.length - k)}.${s.slice(s.length - k)}`;
  }
  return (neg && /[1-9]/.test(s) ? MINUS : "") + s;
}

/** M·10^place in scientific form m×10ⁿ keeping every digit of M. */
function sciDigits(M: bigint, place: number): string {
  const neg = M < 0n;
  const s = absB(M).toString();
  const e = place + s.length - 1;
  const mant = s.length > 1 ? `${s[0]}.${s.slice(1)}` : s;
  return `${neg ? MINUS : ""}${mant}${e === 0 ? "" : `${TIMES}10${superscript(e)}`}`;
}

/**
 * The display of a rounded measured value carrying exactly `sf` figures.
 * Plain when that is unambiguous; scientific when the plain form would end in
 * placeholder zeros (12 000 at 2 figures is 1.2×10⁴) or a significant zero at
 * the units place that only a trailing point could show (120 at 3 → 1.20×10²),
 * and for very small values. Returns the primary form and, when helpful, the
 * plain spelling.
 */
export function displayRounded(M: bigint, place: number): { main: string; plain: string } {
  const plain = plainDigits(M, place);
  if (M === 0n) return { main: plain, plain };
  const digits = absB(M).toString();
  const lead = place + digits.length - 1; // exponent of the leading digit
  if (place > 0 || (place === 0 && digits.endsWith("0") && digits.length > 1) || lead < -4) {
    return { main: sciDigits(M, place), plain };
  }
  return { main: plain, plain };
}

/** A rational shown to ~`sig` figures for a step line, with ≈ when inexact. */
function approx(x: Q, sig = 8): string {
  if (qIsZero(x)) return "0";
  const lead = floorLog10(x);
  const place = lead - sig + 1;
  const r = roundToPlace(x, place);
  const back = qMul(q(r.M), qPow10(place));
  const exact = back.n === x.n && back.d === x.d;
  let s = plainDigits(r.M, place);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (lead > 9 || lead < -6) {
    // Trim trailing zeros of M for the scientific spelling.
    let M = r.M;
    let p = place;
    while (M !== 0n && M % 10n === 0n) {
      M /= 10n;
      p += 1;
    }
    s = sciDigits(M, p);
  }
  return exact ? s : `≈ ${s}`;
}

/**
 * A double shown at the decimal place 10^place, rounded on its DECIMAL digits
 * (nine significant — finite-difference noise in a GUM u sits near the tenth:
 * 1.04999999996 is 1.05), halves away from zero: 1.05 → "1.1", where the binary
 * 1.0499999999999998 would give toFixed's "1.0". U+2212 minus, never "−0".
 */
export function formatAtPlace(x: number, place: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "NaN" : x > 0 ? "∞" : `${MINUS}∞`;
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(x.toPrecision(9));
  if (!m) return String(x);
  const frac = m[3] ?? "";
  let value = q(BigInt(m[2] + frac), pow10(frac.length));
  value = qMul(value, qPow10(parseInt(m[4] ?? "0", 10)));
  if (m[1]) value = qNeg(value);
  return plainDigits(roundToPlace(value, place).M, place);
}

/** "= 7.14" or "≈ 33.333333" for a step line. */
function eq(x: Q): string {
  const a = approx(x);
  return a.startsWith("≈") ? a : `= ${a}`;
}

// ---------------------------------------------------------------------------
// Reading a typed number, figures and all.
// ---------------------------------------------------------------------------

export interface SigNumber {
  /** As typed, typeset (U+2212, ×10ⁿ). */
  shown: string;
  value: Q;
  /** A counted or defined number: unlimited figures. */
  exact: boolean;
  /** Figures certainly significant, and the most the text could mean. */
  sfMin: number;
  sfMax: number;
  ambiguous: boolean;
  /** Power of ten of the last CERTAIN significant digit (conservative). */
  place: number;
  /** Power of ten of the last digit written (the finest reading). */
  finePlace: number;
  zero: boolean;
  /** The significant digits, for the step that lists them. */
  sigDigits: string;
  /** The unit as DISPLAYED (a spelled word as typed; a symbol typeset). */
  unit?: string;
  /** What decides "same unit" for + − (ft and feet are one unit). */
  unitKey?: string;
  countNoun?: string;
  /** How the word after the number was read, for the steps. */
  reading?: string;
}

const SUP_TO_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+",
};

/** One number at the start of `s`: sign, mantissa, optional e/×10ⁿ exponent. */
const NUM_SRC =
  String.raw`([+\-−]?)(\d+(?:\.\d*)?|\.\d+)(?:\s*(?:[eE]([+\-−]?\d+)|[×xX*·]\s*10\s*(?:\^\s*\(?\s*([+\-−]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))))?`;
const NUM_AT = new RegExp("^" + NUM_SRC);

function readExp(m: RegExpExecArray): number {
  const raw = m[3] ?? m[4] ?? (m[5] ? [...m[5]].map((c) => SUP_TO_ASCII[c] ?? "").join("") : "0");
  return parseInt(raw.replace("−", "-"), 10);
}

/** Parses the number token match into a SigNumber (exactness decided later). */
function sigNumberFrom(m: RegExpExecArray): SigNumber {
  const neg = m[1] === "-" || m[1] === "−";
  const mant = m[2];
  const hasExp = m[3] !== undefined || m[4] !== undefined || m[5] !== undefined;
  const exp = hasExp ? readExp(m) : 0;
  const hasPoint = mant.includes(".");
  const decimals = hasPoint ? mant.length - mant.indexOf(".") - 1 : 0;
  const digits = mant.replace(".", "");
  let value = q(BigInt(digits || "0"), pow10(decimals));
  value = qMul(value, qPow10(exp));
  if (neg) value = qNeg(value);
  const firstSig = digits.search(/[1-9]/);
  const finePlace = exp - decimals;
  const shown = `${neg ? MINUS : ""}${mant}${hasExp ? `${TIMES}10${superscript(exp)}` : ""}`;
  if (firstSig < 0) {
    return { shown, value, exact: false, sfMin: 0, sfMax: 0, ambiguous: false, place: finePlace, finePlace, zero: true, sigDigits: "" };
  }
  const tail = digits.slice(firstSig);
  if (hasPoint) {
    return { shown, value, exact: false, sfMin: tail.length, sfMax: tail.length, ambiguous: false, place: finePlace, finePlace, zero: false, sigDigits: tail };
  }
  const trailing = (/0+$/.exec(tail)?.[0] ?? "").length;
  const sfMin = tail.length - trailing;
  return {
    shown,
    value,
    exact: false,
    sfMin,
    sfMax: tail.length,
    ambiguous: trailing > 0,
    place: finePlace + trailing,
    finePlace,
    zero: false,
    sigDigits: tail.slice(0, sfMin),
  };
}

// ---------------------------------------------------------------------------
// Routing: the decision the pane makes, shared with the tests.
// ---------------------------------------------------------------------------

/** The sig-fig words. Word-led only — no bare "x ± u" is ever claimed. */
export const SIGFIG_WORD_RE =
  /\bsignificant\s+(?:figures?|digits?)\b|\bsig\.?\s*figs?\b|\bsigfigs?\b|\bs\.\s?f\.|\b\d+\s*s\.?f\.?(?![a-z])|\bround(?:ed|ing)?\b[\s\S]*\bto\s+(?:the\s+)?uncertaint(?:y|ies)\b/i;

/** Filler a sig-fig question is phrased with; nothing here is a quantity. */
const FILLER = new Set(
  (
    "how many much what whats is are there in of the a an with using use to by for find count calculate compute work out " +
    "evaluate give report write express answer number numbers correct proper right appropriate sig figs fig significant figures " +
    "figure digits digit sf rules rule please result value product sum quotient difference rounded round rounding according " +
    "textbook apply applying do does have has it this that into following than s.f and or each then also only both"
  ).split(/\s+/),
);

/**
 * Words that name COUNTED things: a whole number of them is exact. Anything
 * else after a whole number is a unit or a measured label — "1500 feet" is a
 * measurement, never a count — unless the user writes "exact".
 */
const COUNT_WORDS = new Set(
  (
    "apple apples egg eggs student students person people persons child children trial trials sample samples item items " +
    "object objects molecule molecules atom atoms ion ions electron electrons photon photons cell cells coin coins car cars " +
    "book books pencil pencils marble marbles cookie cookies orange oranges banana bananas dog dogs cat cats bottle bottles " +
    "box boxes ball balls card cards player players worker workers page pages tablet tablets pill pills bead beads dice die " +
    "tree trees chair chairs desk desks pen pens bag bags thing things piece pieces test tests run runs experiment experiments " +
    "patient patients subject subjects mouse mice rat rats plant plants seed seeds flask flasks beaker beakers tube tubes"
  ).split(/\s+/),
);

/**
 * Spelled measurement words (singular) → a unit symbol units.ts knows, or ""
 * when the word is a unit with no symbol here (a bare year is deliberately
 * not a unit in units.ts; ounce is mass or fluid). Only the IDENTITY matters
 * for sig figs: display and "same unit" for + −.
 */
const MEASURE_WORDS: Record<string, string> = {
  foot: "ft", feet: "ft", inch: "in", mile: "mi", yard: "yd", newton: "N", calorie: "cal", kilocalorie: "kcal",
  meter: "m", metre: "m", kilometer: "km", kilometre: "km", centimeter: "cm", centimetre: "cm", millimeter: "mm", millimetre: "mm",
  liter: "L", litre: "L", milliliter: "mL", millilitre: "mL", gram: "g", kilogram: "kg", milligram: "mg",
  second: "s", minute: "min", hour: "h", joule: "J", kilojoule: "kJ", watt: "W", volt: "V", pascal: "Pa", kilopascal: "kPa",
  mole: "mol", pound: "lb", gallon: "gal", kelvin: "K", ampere: "A", amp: "A", hertz: "Hz",
  ounce: "", year: "", month: "", decade: "", century: "", centuries: "", pint: "", quart: "", cup: "", tablespoon: "",
  teaspoon: "", acre: "", hectare: "", ton: "", tonne: "", degree: "", lightyear: "", parsec: "",
  // Abbreviations and older units (e67d34a review: read as counts, the unit lost).
  lbs: "lb", hr: "h", hrs: "h", yr: "", yrs: "", amu: "", kph: "", mph: "", bpm: "", tsp: "", tbsp: "", decibel: "",
  fmol: "", pmol: "", kmol: "", dyn: "", dyne: "", erg: "", angstrom: "", dpi: "", floz: "", bbl: "", barrel: "",
  psi: "", atm: "", rpm: "", carat: "", grain: "", furlong: "", fathom: "", slug: "", stone: "",
};

interface UnitWord {
  unit: string;
  key: string;
  /** A spelled word (feet), not a symbol (ft). */
  spelled: boolean;
}

function compoundKey(word: string): string | null {
  const c = parseCompoundUnit(word);
  if (!c) return null;
  const dims = Object.keys(c.dims)
    .filter((k) => c.dims[k] !== 0)
    .sort()
    .map((k) => `${k}${c.dims[k]}`)
    .join(",");
  return `c:${dims}|${c.factor}`;
}

/** The word as a unit (symbol, spelled name, plural, temperature), or null. */
function unitWord(word: string): UnitWord | null {
  // A spelled-out unit NAME (meters, hours) is shown as typed; a SYMBOL (umol,
  // degC, kPa, min) is typeset (µmol, °C). Names here are lowercase words of
  // five or more letters; shorter names are found by the MEASURE_WORDS list.
  const named = /^[a-z]{5,}$/.test(word) && formatUnit(word) === word;
  const display = named ? word : formatUnit(word);
  const ck = compoundKey(word);
  if (ck) return { unit: display, key: ck, spelled: named };
  const def = lookup(word);
  if (def) return { unit: display, key: `u:${def.dim}|${def.factor}|${def.offset ?? 0}`, spelled: named };
  if (!/^[A-Za-z]{3,}$/.test(word)) return null;
  const w = word.toLowerCase();
  // Singular forms: "-s" first ("miles" → mile, never "mil"), then "-es" (inches → inch).
  const cands = [w];
  if (w.length >= 4 && w.endsWith("s")) cands.push(w.slice(0, -1));
  if (w.length >= 5 && w.endsWith("es")) cands.push(w.slice(0, -2));
  for (const c of cands) {
    if (c in MEASURE_WORDS) {
      const sym = MEASURE_WORDS[c];
      const k = sym ? compoundKey(sym) : null;
      return { unit: word, key: k ?? `w:${c === "feet" ? "foot" : c}`, spelled: true };
    }
    if (c !== w && c.length >= 3) {
      const k2 = compoundKey(c);
      if (k2) return { unit: word, key: k2, spelled: true };
    }
  }
  return null;
}

type Tok =
  | { t: "num"; n: SigNumber }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "pow"; k: number }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "pm" };

interface Lexed {
  toks: Tok[];
  /** Every number token, in order (for the count and round modes). */
  nums: SigNumber[];
  roundTo: number | null;
  /** The question named "round … to the uncertainty". */
  toUncertainty: boolean;
  notes: string[];
}

/** A word right after a number: a unit, a count noun, an exactness marker, or a refusal. */
type Tail =
  | { kind: "unit"; unit: string; key: string; reading?: string }
  | { kind: "count"; noun: string; reading?: string }
  | { kind: "exact" }
  | { kind: "filler" }
  | { kind: "bad"; why: string };

function classifyTailWord(word: string, n: SigNumber): Tail {
  const w = word.toLowerCase();
  if (w === "exact" || w === "exactly" || w === "defined" || w === "(exact)" || w === "(defined)") return { kind: "exact" };
  if (FILLER.has(w)) return { kind: "filler" };
  const isInteger = n.value.d === 1n && !n.shown.includes(".") && !n.shown.includes(TIMES);
  // A counted number of things: a whole number of a COUNT word ("12 eggs") is
  // exact; "2.5 eggs" is not a count.
  if (COUNT_WORDS.has(w)) {
    if (isInteger) return { kind: "count", noun: word };
    return { kind: "bad", why: `“${n.shown} ${word}” is not a count (a count is a whole number) and “${word}” is not a unit this recognises.` };
  }
  const uw = unitWord(word);
  if (uw) {
    return {
      kind: "unit",
      unit: uw.unit,
      key: uw.key,
      // Said only where it changes the reading: a whole number before a
      // spelled unit NAME (1500 feet) is a measurement, not a count.
      reading: uw.spelled && isInteger ? `“${word}” is a unit, so ${n.shown} ${word} is a MEASUREMENT, not a count of things.` : undefined,
    };
  }
  // Any other word after a WHOLE number names counted things (12 donuts,
  // 3 dozen, 4 legs): exact, as a textbook counts them; the step says so.
  // Only words the unit recognition knows are measurements. After a decimal
  // ("2.5 widgets") the word is a measured label.
  if (/^[a-z]{3,}$/i.test(word)) {
    // Shaped like an abbreviation (no vowel, or all capitals: "pkts", "PSI") — a unit this does not know, not a count.
    const abbreviation = !/[aeiouy]/i.test(word) || word === word.toUpperCase();
    if (isInteger && abbreviation) {
      return {
        kind: "unit",
        unit: word,
        key: `w:${w}`,
        reading: `“${word}” looks like a unit this does not recognise, so ${n.shown} ${word} is read as a MEASUREMENT; if it counts things, write “${n.shown} ${word} exact”.`,
      };
    }
    if (isInteger) {
      return {
        kind: "count",
        noun: word,
        reading: `“${word}” is not a unit this recognises, so ${n.shown} ${word} is read as a COUNT (exact); if it is a measured amount, type the number alone.`,
      };
    }
    return { kind: "unit", unit: word, key: `w:${w}` };
  }
  return { kind: "bad", why: `“${word}” after ${n.shown} is not a unit this recognises.` };
}

/** A typed thousands separator, decimal comma or digit-group space, refused by name. */
function groupingProblem(s: string): string | null {
  const c = /(^|[^\d.])(\d+(?:,\d+)+)(\.\d+)?/.exec(s);
  if (c) {
    const text = c[2] + (c[3] ?? "");
    const groups = c[2].split(",");
    if (groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3)) {
      return `“${text}”: write ${groups.join("")}${c[3] ?? ""} without the comma: a thousands separator is not read here (and if it is a decimal comma, write ${groups[0]}.${groups.slice(1).join("")}).`;
    }
    if (groups.length === 2 && !c[3]) return `“${text}” has a decimal comma: write ${groups[0]}.${groups[1]} with a point.`;
    return `“${text}”: write each number without commas inside it, and join numbers with + − × ÷.`;
  }
  const g = /(^|[^\d.,])(\d{1,3})((?: \d{3})+)(\.\d+)?(?![\d,])/.exec(s);
  if (g) {
    const joined = g[2] + g[3].replace(/ /g, "") + (g[4] ?? "");
    return `“${g[2]}${g[3]}${g[4] ?? ""}”: write ${joined} without the space: a digit-group space is not read here.`;
  }
  return null;
}

/** Tokenises a sig-fig question, or null when it is not one (a variable, a stray word). */
function lex(raw: string): Lexed | { refuse: string } | null {
  let s = raw.replace(SPACE_LIKE, " ");
  const notes: string[] = [];
  let roundTo: number | null = null;
  // "the 3 sf rule" names a target count, never the number 3.
  const rule = /\b(?:the\s+)?(\d+)\s*-?\s*(?:significant[\s-]+(?:figures?|digits?)|sig\.?\s*figs?|sigfigs?|s\.?\s?f\.?)\s*-?\s*rules?\b/i.exec(s);
  if (rule) {
    roundTo = parseInt(rule[1], 10);
    s = s.slice(0, rule.index) + " " + s.slice(rule.index + rule[0].length);
  }
  // "to 3 sig figs" / "to 3 significant figures" / "to 3 s.f." — the target count.
  const rt = roundTo === null ? /\b(?:to|with|using)\s+(\d+)\s*(?:significant\s+(?:figures?|digits?)|sig\.?\s*figs?|sigfigs?|s\.?\s?f\.?)(?![a-z])/i.exec(s) : null;
  if (rt) {
    roundTo = parseInt(rt[1], 10);
    s = s.slice(0, rt.index) + " " + s.slice(rt.index + rt[0].length);
  }
  const unc = /\bto\s+(?:the\s+)?uncertaint(?:y|ies)\b/i.exec(s);
  if (unc) s = s.slice(0, unc.index) + " " + s.slice(unc.index + unc[0].length);
  // Operators in words, as a worksheet phrases them.
  s = s
    .replace(/\b(?:multiplied\s+by|times)\b/gi, " × ")
    .replace(/\bdivided\s+by\b/gi, " ÷ ")
    .replace(/\bplus\b/gi, " + ")
    .replace(/\bminus\b/gi, " − ");
  s = s.replace(/\bs\.\s?f\./gi, " sf ").replace(/\bsig\.\s*figs?\.?/gi, " sig figs ").replace(/[?:=]\s*$/, " ");
  // "= ?" asks for the answer; a colon after a word ("Sig figs: 0.00450") only introduces it.
  s = s.replace(/=\s*\?/g, " ").replace(/[?]/g, " ").replace(/([A-Za-z]\.?)\s*:/g, "$1 ");
  // A trailing sentence full stop after a word ("… figures.") — never after a
  // digit, where it is the decimal point that makes 1200. four figures.
  s = s.replace(/([A-Za-z])\.\s*$/, "$1 ");
  const toks: Tok[] = [];
  const nums: SigNumber[] = [];
  let i = 0;
  let last: Tok | null = null;
  while (i < s.length) {
    const ch = s[i];
    if (/\s|,/.test(ch)) {
      i++;
      continue;
    }
    const rest = s.slice(i);
    // A number — but a sign is part of it only where an operand is expected.
    const operandExpected = !last || last.t === "op" || last.t === "lp" || last.t === "pm";
    const m = NUM_AT.exec(rest);
    if (m && (operandExpected || !m[1])) {
      // A power of ten is capped BEFORE any BigInt is built: 10^9999999 would freeze Word.
      if (m[3] !== undefined || m[4] !== undefined || m[5] !== undefined) {
        const e = readExp(m);
        if (!Number.isFinite(e) || Math.abs(e) > SIGFIG_EXP_CAP) {
          const which = Number.isFinite(e) && Math.abs(e) < 1e7 ? `A power of ten of 10${superscript(e)}` : "A power of ten with more than seven digits";
          return { refuse: `${which} is beyond what this handles exactly (powers from 10${superscript(-SIGFIG_EXP_CAP)} to 10${superscript(SIGFIG_EXP_CAP)}).` };
        }
      }
      const n = sigNumberFrom(m);
      i += m[0].length;
      // The word(s) right after it — but an "x" before a number is the times sign (2.0x3.0).
      const after = s.slice(i);
      // A unit may run on through "/" before a letter (m/s²) or a bracketed
      // group of unit symbols (W/(m²·K), J/(mol·K)), with an optional power.
      const wm = /^\s*(\(exact\)|\(defined\)|[A-Za-zµμΩ°%](?:[A-Za-z0-9µμΩ°%^·⁰¹²³⁴⁵⁶⁷⁸⁹⁻\-]|\/(?=[A-Za-zµμΩ°])|\/\([A-Za-zµμΩ°][A-Za-z0-9µμΩ°%^·*⁰¹²³⁴⁵⁶⁷⁸⁹⁻\-]*\)(?:[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+|\^-?\d+)?)*)/.exec(after);
      if (wm && !/^x$/i.test(wm[1]) && !/^\s*x\s*[\d.(]/i.test(after)) {
        const word = wm[1].replace(/[.,]+$/, "");
        const tail = classifyTailWord(word, n);
        if (tail.kind === "bad") return /[a-z]/i.test(word) && !SIGFIG_WORD_RE.test(raw) ? null : { refuse: tail.why };
        if (tail.kind !== "filler") {
          i += wm[0].length;
          if (tail.kind === "exact") n.exact = true;
          else if (tail.kind === "count") {
            n.exact = true;
            n.countNoun = tail.noun;
          } else {
            n.unit = tail.unit;
            n.unitKey = tail.key;
          }
          // "12 eggs (exact)" — a marker after the noun is welcome too.
          const mk = /^\s*(\(exact\)|\(defined\)|exact(?:ly)?\b|defined\b)/i.exec(s.slice(i));
          if (mk) {
            i += mk[0].length;
            n.exact = true;
          }
          if (tail.kind === "unit" && tail.reading && !n.exact) n.reading = tail.reading;
          if (tail.kind === "count" && tail.reading && !mk) n.reading = tail.reading;
        }
      }
      const tok: Tok = { t: "num", n };
      toks.push(tok);
      nums.push(n);
      last = tok;
      continue;
    }
    if (ch === "±" || rest.startsWith("+/-") || rest.startsWith("+-")) {
      const tok: Tok = { t: "pm" };
      toks.push(tok);
      last = tok;
      i += ch === "±" ? 1 : rest.startsWith("+/-") ? 3 : 2;
      continue;
    }
    // A whole-number power: 2.0^2, 2.0 ^ (−1), 2.0².
    const afterOperand = !!last && (last.t === "num" || last.t === "rp");
    const sup = afterOperand ? /^[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(rest) : null;
    if (ch === "^" || sup) {
      if (!afterOperand) return null;
      // 2.0^2^3 is 2.0^(2^3) = 256, not (2.0²)³ = 64: a chained power is refused rather than misread.
      if (toks[toks.length - 1]?.t === "pow") {
        return { refuse: "A power of a power is not read here: give the exponent as one whole number (2.0⁸), or bracket the base ((2.0²)³)." };
      }
      let k: number;
      if (sup) {
        k = parseInt([...sup[0]].map((c) => SUP_TO_ASCII[c] ?? "").join(""), 10);
        i += sup[0].length;
      } else {
        const pm = /^\^\s*(?:\(\s*([+\-−]?\d+)\s*\)|([+\-−]?\d+))(?![\d.])/.exec(rest);
        if (!pm) {
          return { refuse: "Only a whole-number power (2.0², 3.00⁻¹) is applied by the sig-fig rules here; a fractional or symbolic power has no textbook rule." };
        }
        k = parseInt((pm[1] ?? pm[2]).replace("−", "-"), 10);
        i += pm[0].length;
      }
      if (!Number.isFinite(k) || Math.abs(k) > 100) return { refuse: "A power is applied here only up to 100 (a whole number from −100 to 100)." };
      const tok: Tok = { t: "pow", k };
      toks.push(tok);
      last = { t: "rp" };
      continue;
    }
    if ("+-−*×·/÷".includes(ch)) {
      const v = ch === "+" ? "+" : ch === "-" || ch === "−" ? "-" : ch === "/" || ch === "÷" ? "/" : "*";
      const tok: Tok = { t: "op", v };
      toks.push(tok);
      last = tok;
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") {
      toks.push({ t: "lp" });
      last = toks[toks.length - 1];
      i++;
      continue;
    }
    if (ch === ")" || ch === "]") {
      toks.push({ t: "rp" });
      last = toks[toks.length - 1];
      i++;
      continue;
    }
    const wm = /^[A-Za-z][A-Za-z'’.]*/.exec(rest);
    if (wm) {
      const w = wm[0].replace(/[.'’]+$/, "").toLowerCase();
      // A lone "x" between two numbers is the times sign typed on a keyboard.
      if (w === "x" && last && last.t === "num" && /^x(?=\s*[\d.(])/i.test(rest)) {
        const tok: Tok = { t: "op", v: "*" };
        toks.push(tok);
        last = tok;
        i += 1;
        continue;
      }
      if (FILLER.has(w) || w === "s.f" || w === "sig." || w === "uncertainty") {
        i += wm[0].length;
        continue;
      }
      return null; // a variable or an unknown word: not a sig-fig question
    }
    if (ch === "." && i === s.length - 1) {
      i++;
      continue;
    }
    return null;
  }
  return { toks, nums, roundTo, toUncertainty: !!unc, notes };
}

// ---------------------------------------------------------------------------
// The four modes.
// ---------------------------------------------------------------------------

const TITLE = "Significant figures";
const refuse = (why: string, extra: string[] = []): VerbResult => ({ title: TITLE, lines: [], caveats: [why, ...extra] });
const L = (text: string): { text: string } => ({ text });
const fig = (n: number): string => `${n} significant figure${n === 1 ? "" : "s"}`;
const TIE_RULE = "Rounding rule: a dropped part of exactly one half rounds AWAY from zero (“5 rounds up”).";

function withUnit(s: string, n: { unit?: string; countNoun?: string }): string {
  if (n.unit) return `${s} ${n.unit}`;
  if (n.countNoun) return `${s} ${n.countNoun}`;
  return s;
}

/** The count mode: how many figures does this one number carry? */
function countMode(n: SigNumber): VerbResult {
  const head = withUnit(n.shown, n);
  if (n.exact) {
    return {
      title: TITLE,
      lines: [L(`${head}: exact — unlimited significant figures`)],
      caveats: [
        n.countNoun
          ? `“${n.shown} ${n.countNoun}” is read as a COUNT of things, which is exact: it never limits the figures of a result.`
          : `${n.shown} was marked exact (a defined or counted number), so it never limits the figures of a result.`,
      ],
    };
  }
  if (n.zero) {
    return {
      title: TITLE,
      lines: [L(`${head}: no significant figures in the usual count`)],
      caveats: [
        "A zero has no non-zero digit to start the count from. What its written form records is the decimal PLACE it is known to" +
          (n.finePlace < 0 ? ` (here 10${superscript(n.finePlace)}), which is what limits a sum or difference.` : "."),
      ],
    };
  }
  const lines = [] as { text: string }[];
  const steps: string[] = [];
  const digitsTyped = n.shown.replace(/^−/, "").replace(/×10.*$/, "");
  const bare = digitsTyped.replace(".", "");
  if (/^0/.test(bare)) steps.push("Leading zeros only place the decimal point — not significant.");
  if (/[1-9]0+[1-9]/.test(bare)) steps.push("Zeros between non-zero digits are significant.");
  if (digitsTyped.includes(".") && /0$/.test(digitsTyped)) steps.push("Trailing zeros after a decimal point are significant — they were measured.");
  if (n.shown.includes(TIMES)) steps.push(`In scientific notation only the mantissa counts; ×10${n.shown.split("×10")[1]} just places the point.`);
  if (n.ambiguous) {
    const zeros = n.sfMax - n.sfMin;
    lines.push(L(`${head}: ${n.sfMin} to ${n.sfMax} significant figures — AMBIGUOUS`));
    steps.push(
      `Certain: ${n.sigDigits.split("").join(", ")} (${fig(n.sfMin)}). The ${zeros === 1 ? "trailing zero" : `${zeros} trailing zeros`} of a whole number written without a decimal point may be measured or may only hold the place — the text cannot say which.`,
    );
    const M = BigInt(n.sigDigits + "0".repeat(n.sfMax - n.sfMin));
    const all = sciDigits(n.value.n < 0n ? -M : M, n.place - (n.sfMax - n.sfMin));
    steps.push(`Write ${n.shown.replace(/^−/, MINUS)}. (with a trailing point) or ${all} if all ${n.sfMax} are measured; ${sciDigits(n.value.n < 0n ? -BigInt(n.sigDigits) : BigInt(n.sigDigits), n.place)} if only ${n.sfMin}.`);
  } else {
    lines.push(L(`${head}: ${fig(n.sfMin)}`));
    steps.push(`Significant digits: ${n.sigDigits.split("").join(", ")}.`);
  }
  return { title: TITLE, lines: [...lines, ...steps.map(L)], caveats: n.reading ? [n.reading] : [] };
}

/** Round one number to n figures. */
function roundMode(n: SigNumber, to: number): VerbResult {
  if (!Number.isInteger(to) || to < 1 || to > 30) return refuse(`Round to between 1 and 30 significant figures — “${to}” is not a count of figures this rounds to.`);
  if (n.zero) return refuse("Zero has no significant figures to round to; it stays 0.");
  if (!n.exact && to > n.sfMax) {
    return refuse(
      `${n.shown} carries only ${fig(n.sfMax)}; quoting it to ${to} would add digits that were never measured. ` +
        "Rounding can only remove figures.",
    );
  }
  const lead = floorLog10(n.value);
  let place = lead - to + 1;
  const r = roundToPlace(n.value, place);
  let M = r.M;
  // 9.996 → 10.0 at 3 figures: a carry adds a digit; drop the extra zero.
  if (absB(M).toString().length > to) {
    M /= 10n;
    place += 1;
  }
  const disp = displayRounded(M, place);
  const lines = [L(`${withUnit(n.shown, n)} → ${withUnit(disp.main, n)}  (${fig(to)})`)];
  if (disp.main !== disp.plain && disp.plain.length <= 40) lines.push(L(`Written out that is ${disp.plain}, whose trailing zeros would read as ambiguous — the scientific form states exactly ${fig(to)}.`));
  lines.push(L(`Keep ${to} digit${to === 1 ? "" : "s"} from the first non-zero one; the next digit decides the rounding (last kept place: 10${superscript(place)}).`));
  const caveats = [TIE_RULE];
  if (r.tie && r.evenM !== r.M) {
    caveats.push(`This one IS a tie: the round-half-to-even rule some texts use would give ${displayRounded(r.evenM, place).main} instead.`);
  }
  if (n.ambiguous && to > n.sfMin) caveats.push(`${n.shown} has ambiguous trailing zeros; ${fig(to)} assumes ${to - n.sfMin === 1 ? "that zero was" : "those zeros were"} measured.`);
  return { title: TITLE, lines, caveats };
}

// --- arithmetic --------------------------------------------------------------

interface Node {
  value: Q;
  exact: boolean;
  /** Figures (Infinity when exact). */
  sf: number;
  /** Last significant place (−Infinity when exact). */
  place: number;
  /** The unit as displayed, and what makes two units the same. */
  unit: string | null;
  unitKey: string | null;
  label: string;
  /** The last rule applied was × ÷ (or a power): a carry keeps the figure count. */
  mulRule?: boolean;
}

class SigArithError extends Error {}

/** Refuses an exact intermediate that has grown beyond BIT_CAP (a 10⁹⁹⁹ product chain). */
function sizeError(big: boolean, label: string): SigArithError {
  return new SigArithError(
    `${label.length > 80 ? "The calculation" : label}: the numbers grow too ${big ? "large" : "small"} to carry exactly (beyond about 10${superscript(big ? 4000 : -4000)}).`,
  );
}
function checkSize(value: Q, label: string): void {
  if (bitLen(value.n) > BIT_CAP || bitLen(value.d) > BIT_CAP) throw sizeError(bitLen(value.n) > bitLen(value.d), label);
}

function leafNode(n: SigNumber, notes: string[]): Node {
  const unit = n.unit ?? null;
  const unitKey = n.unitKey ?? null;
  if (n.exact) return { value: n.value, exact: true, sf: Infinity, place: -Infinity, unit, unitKey, label: withUnit(n.shown, n) };
  if (n.zero) {
    // A measured zero has a place (0.0 is known to tenths) but no figures.
    return { value: n.value, exact: false, sf: 0, place: n.finePlace, unit, unitKey, label: withUnit(n.shown, n) };
  }
  if (n.ambiguous) {
    notes.push(
      `${n.shown} has ambiguous trailing zeros; it is read with the ${fig(n.sfMin)} that ${n.sfMin === 1 ? "is" : "are"} certain (write ${n.shown}. or scientific notation if all ${n.sfMax} were measured).`,
    );
  } else if (!n.unit && !n.countNoun && !n.shown.includes(".") && !n.shown.includes(TIMES)) {
    // A bare whole number: measured by default, which a student may not expect.
    notes.push(
      `${n.shown.replace(/^−/, "")} is read as a MEASURED value (${fig(n.sfMin)}, known to 10${superscript(n.place)}); if it is a count or a defined number, write “${n.shown.replace(/^−/, "")} exact”.`,
    );
  }
  return { value: n.value, exact: false, sf: n.sfMin, place: n.place, unit, unitKey, label: withUnit(n.shown, n) };
}

function combine(op: "+" | "-" | "*" | "/", a: Node, b: Node, steps: string[]): Node {
  const sym = op === "*" ? TIMES : op === "/" ? "÷" : op === "-" ? MINUS : "+";
  const label = `${a.label} ${sym} ${b.label}`;
  let unit: string | null;
  let unitKey: string | null;
  if (op === "+" || op === "-") {
    if ((a.unitKey ?? "") !== (b.unitKey ?? "")) {
      throw new SigArithError(
        `${a.label} ${sym} ${b.label}: ${op === "+" ? "adding" : "subtracting"} quantities in different units (${a.unit ?? "none"} and ${b.unit ?? "none"}) is not done here — convert first.`,
      );
    }
    unit = a.unit;
    unitKey = a.unitKey;
  } else {
    if (a.unit && b.unit) throw new SigArithError(`${a.label} ${sym} ${b.label}: combining two units is not done by the sig-fig rules — type the numbers alone; the figures rule is the same.`);
    if (op === "/" && b.unit) throw new SigArithError(`${a.label} ÷ ${b.label}: a unit in the divisor is not carried here — type the numbers alone; the figures rule is the same.`);
    unit = a.unit ?? b.unit;
    unitKey = a.unitKey ?? b.unitKey;
  }
  // Bound the exact work BEFORE multiplying: the result's size is about the sum of the operands'.
  const nb = bitLen(a.value.n) + bitLen(b.value.n);
  const db = bitLen(a.value.d) + bitLen(b.value.d);
  if (nb + db > 2 * BIT_CAP + 64) throw sizeError(nb >= db, label);
  let value: Q;
  if (op === "+") value = qAdd(a.value, b.value);
  else if (op === "-") value = qSub(a.value, b.value);
  else if (op === "*") value = qMul(a.value, b.value);
  else {
    if (qIsZero(b.value)) throw new SigArithError(`${a.label} ÷ ${b.label}: division by zero.`);
    value = qDiv(a.value, b.value);
  }
  checkSize(value, label);
  if (a.exact && b.exact) {
    steps.push(`${label} ${eq(value)}  (both exact → exact)`);
    return { value, exact: true, sf: Infinity, place: -Infinity, unit, unitKey, label: approx(value).replace(/^≈ /, "") };
  }
  let sf: number;
  let place: number;
  const mulRule = op === "*" || op === "/";
  if (!mulRule) {
    place = Math.max(a.place, b.place);
    sf = qIsZero(value) ? 0 : floorLog10(value) - place + 1;
    const why = [a, b].filter((x) => !x.exact).map((x) => `${x.label} to 10${superscript(x.place)}`);
    steps.push(
      `${label} ${eq(value)}  (+ − rule: the FEWEST DECIMAL PLACES — ${why.join(", ")} → last place 10${superscript(place)}${sf > 0 ? `, ${fig(sf)}` : ""})`,
    );
  } else {
    if ((!a.exact && a.sf <= 0) || (!b.exact && b.sf <= 0)) {
      throw new SigArithError(`${label}: ${a.sf <= 0 ? a.label : b.label} has no significant figures left, so the product or quotient carries none either.`);
    }
    sf = Math.min(a.sf, b.sf);
    place = qIsZero(value) ? 0 : floorLog10(value) - sf + 1;
    const why = [a, b].map((x) => (x.exact ? `${x.label} exact` : `${x.label} has ${x.sf}`));
    steps.push(`${label} ${eq(value)}  (× ÷ rule: the FEWEST SIGNIFICANT FIGURES — ${why.join(", ")} → ${fig(sf)})`);
  }
  return { value, exact: false, sf, place, unit, unitKey, label: approx(value).replace(/^≈ /, ""), mulRule };
}

/** b^k exactly, k a whole number; the figures are the base's (the × ÷ rule applied k times). */
function powNode(b: Node, k: number, steps: string[]): Node {
  const base = /\s/.test(b.label) || b.label.startsWith(MINUS) ? `(${b.label})` : b.label;
  const label = `${base}${superscript(k)}`;
  if (b.unit) throw new SigArithError(`${label}: a power of a quantity with a unit is not carried here; type the number alone (the figures rule is the same).`);
  if (!b.exact && b.sf <= 0) throw new SigArithError(`${label}: ${b.label} has no significant figures, so its power carries none either.`);
  if (qIsZero(b.value) && k < 0) throw new SigArithError(`${label}: a negative power of zero is a division by zero.`);
  if ((bitLen(b.value.n) + bitLen(b.value.d)) * Math.abs(k) > 2 * BIT_CAP) throw sizeError((absB(b.value.n) > b.value.d) === k > 0, label);
  const kk = BigInt(Math.abs(k));
  let value = q(b.value.n ** kk, b.value.d ** kk);
  if (k < 0) value = q(value.d, value.n);
  checkSize(value, label);
  if (b.exact) {
    steps.push(`${label} ${eq(value)}  (exact base → exact)`);
    return { value, exact: true, sf: Infinity, place: -Infinity, unit: null, unitKey: null, label: approx(value).replace(/^≈ /, "") };
  }
  const sf = b.sf;
  const place = qIsZero(value) ? 0 : floorLog10(value) - sf + 1;
  steps.push(`${label} ${eq(value)}  (a power keeps the base's figures: ${b.label} has ${b.sf} → ${fig(sf)})`);
  return { value, exact: false, sf, place, unit: null, unitKey: null, label: approx(value).replace(/^≈ /, ""), mulRule: true };
}

function parseArith(toks: Tok[], notes: string[], steps: string[]): Node {
  let i = 0;
  const peek = (): Tok | undefined => toks[i];
  const expr = (): Node => {
    let left = term();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      i++;
      left = combine(t.v, left, term(), steps);
    }
    return left;
  };
  const term = (): Node => {
    let left = factor();
    for (let t = peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      i++;
      left = combine(t.v, left, factor(), steps);
    }
    return left;
  };
  const primary = (): Node => {
    const t = toks[i++];
    if (!t) throw new SigArithError("The expression ends where a number was expected.");
    if (t.t === "num") {
      const nx = toks[i];
      if (nx && (nx.t === "num" || nx.t === "lp")) throw new SigArithError("Two numbers with no operator between them — write × or + explicitly.");
      return leafNode(t.n, notes);
    }
    if (t.t === "lp") {
      const inner = expr();
      const close = toks[i++];
      if (!close || close.t !== "rp") throw new SigArithError("Unbalanced parentheses.");
      return { ...inner, label: `(${inner.label})` };
    }
    throw new SigArithError("The expression could not be read as + − × ÷ of numbers.");
  };
  const factor = (): Node => {
    const t = toks[i];
    if (t && t.t === "op" && t.v === "-") {
      i++;
      const inner = factor();
      return { ...inner, value: qNeg(inner.value), label: `${MINUS}${inner.label}` };
    }
    // −2.0² is −(2.0²) = −4: a sign the lexer read into the number binds looser than the power.
    const t0 = toks[i];
    const next = toks[i + 1];
    if (t0 && t0.t === "num" && t0.n.value.n < 0n && next && next.t === "pow") {
      const pos: SigNumber = { ...t0.n, value: qNeg(t0.n.value), shown: t0.n.shown.replace(/^−/, "") };
      const at = i;
      toks[at] = { t: "num", n: pos };
      const inner = factor();
      toks[at] = t0;
      return { ...inner, value: qNeg(inner.value), label: `${MINUS}${inner.label}` };
    }
    let base = primary();
    for (let p = peek(); p && p.t === "pow"; p = peek()) {
      i++;
      base = powNode(base, p.k, steps);
    }
    return base;
  };
  const out = expr();
  if (i !== toks.length) throw new SigArithError("The expression could not be read as + − × ÷ of numbers.");
  return out;
}

/** The final rounding by the rules: to the tracked place, a × ÷ carry keeping the figure count. */
function ruleRound(res: Node): { M: bigint; place: number; sf: number; tie: boolean; evenM: bigint; rawM: bigint } {
  let place = res.place;
  const r = roundToPlace(res.value, place);
  let M = r.M;
  let sf = absB(M).toString().length;
  // A carry (9.96 → 10.0) adds a digit to a × ÷ result; keep the figure count.
  if (res.mulRule !== false && sf > res.sf) {
    M /= 10n;
    place += 1;
    sf -= 1;
  }
  return { M, place, sf, tie: r.tie, evenM: r.evenM, rawM: r.M };
}

/** A calculation rounded to a count of figures the user ASKED for ("2/3 to 3 sig figs"). */
function askedRounding(res: Node, to: number, steps: string[], notes: string[], lx: Lexed): VerbResult {
  if (!Number.isInteger(to) || to < 1 || to > 30) return refuse(`Round to between 1 and 30 significant figures — “${to}” is not a count of figures this rounds to.`);
  if (qIsZero(res.value)) return refuse("The result is exactly 0, which has no significant figures to round to.");
  const unitOf = { unit: res.unit ?? undefined };
  let place = floorLog10(res.value) - to + 1;
  const r = roundToPlace(res.value, place);
  let M = r.M;
  if (absB(M).toString().length > to) {
    M /= 10n;
    place += 1;
  }
  const disp = displayRounded(M, place);
  const lines = [L(`= ${withUnit(disp.main, unitOf)}  (${fig(to)}, as asked)`)];
  if (disp.main !== disp.plain && disp.plain.length <= 40) lines.push(L(`Written out that is ${withUnit(disp.plain, unitOf)}, whose trailing zeros would read as ambiguous — the scientific form states exactly ${fig(to)}.`));
  lines.push(...steps.map(L));
  lines.push(L(`Unrounded value ${approx(res.value)}, rounded ONCE to ${fig(to)} as asked (last kept place 10${superscript(place)}).`));
  const caveats: string[] = [];
  if (res.exact) caveats.push("Every input is exact, so the asked rounding is the only one applied.");
  else if (res.sf <= 0) caveats.push("By the sig-fig rules for MEASURED inputs no significant figures survive this calculation; the asked rounding treats the inputs as exact.");
  else {
    const rr = ruleRound(res);
    caveats.push(
      `By the sig-fig rules for MEASURED inputs the result carries ${fig(rr.sf)} (${withUnit(displayRounded(rr.M, rr.place).main, unitOf)})` +
        (to > rr.sf ? `; ${to} figures were given because they were asked for, and the inputs do not support all of them.` : `; ${to} were given because they were asked for.`),
    );
  }
  caveats.push(...notes, TIE_RULE);
  if (r.tie && r.evenM !== r.M) caveats.push(`The rounding IS a tie: round-half-to-even would give ${displayRounded(r.evenM, place).main}.`);
  caveats.push(...lx.nums.map((n) => n.reading).filter((x): x is string => !!x));
  return { title: TITLE, lines, caveats };
}

function arithMode(lx: Lexed, roundTo: number | null = null): VerbResult {
  const notes: string[] = [];
  const steps: string[] = [];
  let res: Node;
  try {
    res = parseArith(lx.toks, notes, steps);
  } catch (e) {
    if (e instanceof SigArithError) return refuse(e.message);
    throw e;
  }
  if (roundTo !== null) return askedRounding(res, roundTo, steps, notes, lx);
  const caveats = [...notes, ...lx.nums.map((n) => n.reading).filter((x): x is string => !!x)];
  const unitOf = { unit: res.unit ?? undefined };
  if (res.exact) {
    const a = approx(res.value, 12);
    const head = a.startsWith("≈ ") ? `≈ ${withUnit(a.slice(2), unitOf)}` : `= ${withUnit(a, unitOf)}`;
    return {
      title: TITLE,
      lines: [L(`${head}  (every input is exact, so the result is exact)`), ...steps.map(L)],
      caveats,
    };
  }
  if (res.sf <= 0) {
    const r = roundToPlace(res.value, res.place);
    const p = plainDigits(r.M, res.place);
    const shown = p.length <= 40 ? p : r.M === 0n ? "0" : sciDigits(r.M, res.place);
    return {
      title: TITLE,
      lines: [L(`= ${withUnit(shown, unitOf)}  — no significant figures survive`), ...steps.map(L)],
      caveats: [
        `The difference is smaller than the last decimal place the inputs are known to (10${superscript(res.place)}), so the result is zero to within its precision.`,
        ...caveats,
      ],
    };
  }
  const rr = ruleRound(res);
  const { M, place, sf } = rr;
  const disp = displayRounded(M, place);
  const lines = [L(`= ${withUnit(disp.main, unitOf)}  (${fig(sf)})`)];
  if (disp.main !== disp.plain && disp.plain.length <= 40) lines.push(L(`Written out that is ${withUnit(disp.plain, unitOf)}, whose trailing zeros would read as ambiguous — the scientific form states exactly ${fig(sf)}.`));
  lines.push(...steps.map(L));
  lines.push(L(`Unrounded value ${approx(res.value)}, rounded ONCE at the end to the last significant place 10${superscript(place)}.`));
  caveats.push(
    "Intermediate results are carried unrounded and only the FINAL answer is rounded; each step's figures (× ÷: fewest significant figures; + −: fewest decimal places) are tracked through the whole expression.",
    TIE_RULE,
  );
  if (rr.tie && rr.evenM !== rr.rawM) caveats.push(`The final rounding IS a tie: round-half-to-even would give ${displayRounded(rr.evenM, res.place).main}.`);
  const exacts = lx.nums.filter((n) => n.exact);
  if (exacts.length) caveats.push(`Exact (not limiting): ${exacts.map((n) => withUnit(n.shown, n)).join(", ")}${exacts.some((n) => n.countNoun) ? " — a count of things is exact" : ""}.`);
  return { title: TITLE, lines, caveats };
}

/**
 * Round a measured value to its uncertainty. Convention, stated in every
 * answer: the uncertainty keeps ONE significant figure, or TWO when its
 * leading digit is 1 (0.123 → 0.12, 0.0234 → 0.02); the value is then rounded
 * to the uncertainty's last place. A value can never GAIN digits it was not
 * given: when it was typed more coarsely than that place (10.0 against 0.12)
 * both are quoted at the value's own last place (10.0 ± 0.1).
 */
function uncertaintyMode(v: SigNumber, u: SigNumber, opts: { oneFigure: boolean }): VerbResult {
  if (u.value.n < 0n) return refuse(`An uncertainty is a magnitude — write ${u.shown.replace(/^−/, "")}, not ${u.shown}.`);
  if (u.zero) return refuse("A zero uncertainty has nothing to round to; the value stands as written.");
  if ((v.unitKey ?? "") !== (u.unitKey ?? "") && v.unit && u.unit) return refuse(`The value is in ${v.unit} and the uncertainty in ${u.unit} — give both in the same unit.`);
  const unit = { unit: v.unit ?? u.unit };
  const lines: { text: string }[] = [];
  const caveats: string[] = [];
  const uLead = floorLog10(u.value);
  // The leading digit as WRITTEN (0.0196 starts with 1, even though it rounds to 0.02).
  const scaled = qDiv(u.value, qPow10(uLead));
  const trueLead = Number(absB(scaled.n) / scaled.d);
  const keep = opts.oneFigure ? 1 : trueLead === 1 ? 2 : 1;
  let uPlace = uLead - keep + 1;
  let ur = roundToPlace(u.value, uPlace).M;
  if (absB(ur).toString().length > keep) {
    // 0.096 at one figure → 0.10: the carry makes the leading digit 1; the
    // two-figure rule then keeps 0.10 as it stands.
    if (!(keep === 1 && !opts.oneFigure)) {
      ur /= 10n;
      uPlace += 1;
    }
  }
  const convention = opts.oneFigure
    ? "Convention used: the uncertainty to ONE significant figure (as asked), and the value to the same decimal place."
    : "Convention used: the uncertainty to ONE significant figure, or TWO when its leading digit is 1; the value is rounded to the same decimal place as the uncertainty.";
  // The value's finest written place (ambiguous trailing zeros of a whole
  // number are taken as written — the coarser reading is noted).
  const valuePlace = v.finePlace;
  // Bounded output: a value and an uncertainty thousands of places apart
  // (1×10¹⁰⁰⁰ ± 1×10⁻¹⁰⁰⁰) would print thousands of digits.
  const span = Math.max(v.zero ? uLead : floorLog10(v.value), uLead) - Math.max(uPlace, valuePlace) + 1;
  if (span > 60) {
    return refuse(
      `${v.shown} ± ${u.shown}: quoting the value to its uncertainty's place would take ${span} digits, more than the 60 this writes out. Check the powers of ten.`,
    );
  }
  lines.push(L(`Uncertainty ${u.shown}: leading digit ${trueLead} → keep ${fig(keep)} → ${displayRounded(ur, uPlace).main} (last place 10${superscript(uPlace)}).`));
  let place = uPlace;
  if (valuePlace > place) {
    // Cannot pad the value: quote both at the value's own last place.
    const ur2 = roundToPlace(u.value, valuePlace).M;
    if (ur2 === 0n) {
      return refuse(
        `${v.shown} is stated only to 10${superscript(valuePlace)}, coarser than its uncertainty ${u.shown} — rounded to that place the uncertainty would be 0. Give the value with more digits (it must be known at least to the uncertainty's place).`,
        [convention],
      );
    }
    lines.push(
      L(
        `Value ${v.shown} is stated only to 10${superscript(valuePlace)} — it cannot gain a digit it was not given, so both are quoted to 10${superscript(valuePlace)}: the uncertainty ${displayRounded(ur, uPlace).main} → ${displayRounded(ur2, valuePlace).main}.`,
      ),
    );
    place = valuePlace;
    ur = ur2;
    caveats.push("The uncertainty was rounded to nearest at the value's place; some texts round an uncertainty UP instead (never understating it).");
  }
  const vr = roundToPlace(v.value, place);
  let vText = plainDigits(vr.M, place);
  const uText = plainDigits(ur, place);
  let main = `${vText} ± ${uText}`;
  // The leading power of the pair: the value's, or the uncertainty's when the value rounds to 0.
  const e = place + Math.max(absB(vr.M === 0n ? ur : vr.M).toString().length, 1) - 1;
  if (place > 0 || e < -4) {
    // 1230 ± 20 would leave the zeros ambiguous, and 0.0000012 ± 0.0000003 is
    // hard to read: factor the power out.
    const vq = plainDigits(vr.M, place - e);
    const uq = plainDigits(ur, place - e);
    main = `(${vq} ± ${uq})${TIMES}10${superscript(e)}`;
    if (e < -4 && vr.M !== 0n) vText = sciDigits(vr.M, place);
  }
  lines.unshift(L(`${withUnit(`${v.shown} ± ${u.shown}`, unit)} → ${unit.unit ? `${main} ${unit.unit}` : main}`));
  if (valuePlace <= uPlace) lines.push(L(`Value ${v.shown} rounded to 10${superscript(place)} → ${vText}.`));
  caveats.unshift(convention);
  caveats.push(TIE_RULE);
  if (vr.tie && vr.evenM !== vr.M) {
    caveats.push(`The value's rounding IS a tie: round-half-to-even would give ${e < -4 && vr.evenM !== 0n ? sciDigits(vr.evenM, place) : plainDigits(vr.evenM, place)}.`);
  }
  if (v.ambiguous) caveats.push(`${v.shown} has trailing zeros without a decimal point; they were taken as written (known to 10${superscript(v.finePlace)}).`);
  return { title: `${TITLE} — rounding to the uncertainty`, lines, caveats };
}

// ---------------------------------------------------------------------------
// The verb.
// ---------------------------------------------------------------------------

/** True when the RAW Solve input names significant figures (or rounding to an uncertainty). */
export function isSigFigRequest(raw: string): boolean {
  return SIGFIG_WORD_RE.test(raw);
}

/**
 * The significant-figures verb. Pass the RAW Solve input. Null when the line
 * is not a sig-fig question, so the older Solve paths keep everything else.
 */
export function trySigFigs(raw: string): VerbResult | null {
  if (!isSigFigRequest(raw)) return null;
  if (raw.length > 2000) return refuse("That is too long for a sig-fig question — one number or one expression at a time.");
  const lx = lex(raw);
  if (lx === null) return null;
  // The lexer reads a comma or a space as a separator, so 1,200 and 1 200
  // would be two numbers: name the separator instead.
  const grouping = groupingProblem(raw.replace(SPACE_LIKE, " "));
  if (grouping) return refuse(grouping);
  if ("refuse" in lx) return refuse(lx.refuse);
  const { toks, nums } = lx;
  if (!nums.length) return null;
  const pm = toks.findIndex((t) => t.t === "pm");
  if (pm >= 0) {
    if (toks.length !== 3 || toks[0].t !== "num" || toks[2].t !== "num" || pm !== 1) {
      return refuse("Write one measured value and its uncertainty, e.g. “round 10.0 ± 0.123 to the uncertainty”.");
    }
    const oneFigure = lx.roundTo === 1;
    if (lx.roundTo !== null && lx.roundTo !== 1) {
      return refuse(`An uncertainty is quoted to one significant figure (two when it starts with 1); “${lx.roundTo} sig figs” is not a convention this applies.`);
    }
    return uncertaintyMode((toks[0] as { n: SigNumber }).n, (toks[2] as { n: SigNumber }).n, { oneFigure });
  }
  const hasOp = toks.some((t) => t.t === "op" || t.t === "lp" || t.t === "rp" || t.t === "pow");
  if (lx.roundTo !== null) {
    // A calculation rounded to an asked count: exact arithmetic, one rounding, the rules' answer noted.
    if (hasOp) return arithMode(lx, lx.roundTo);
    if (nums.length !== 1) {
      return refuse(
        "Round one number at a time (“round 0.0045678 to 3 sig figs”). For a calculation, ask it with the rules: “3.40 × 2.1 with sig figs”.",
      );
    }
    return roundMode(nums[0], lx.roundTo);
  }
  if (lx.toUncertainty) return refuse("Rounding to the uncertainty needs a value and its uncertainty: “round 10.0 ± 0.123 to the uncertainty”.");
  if (!hasOp) {
    if (nums.length !== 1) return refuse("Count the figures of one number at a time, or join numbers with + − × ÷ to calculate with them.");
    return countMode(nums[0]);
  }
  return arithMode(lx);
}
