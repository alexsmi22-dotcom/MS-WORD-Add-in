// Full chemical-formula validator: checks that every element symbol is a real
// element, that brackets/parentheses are balanced, and that the syntax is
// well-formed — then reports the per-element atom counts, the net charge, the
// normalized Hill-system formula, and the molecular weight.
//
// Handles nested groups Ca(OH)2 / K4[Fe(CN)6], charges (Na+, Ca2+, SO4^2-),
// and hydrate dots (CuSO4·5H2O, written with "·" or "."). Pure logic — no
// Office.js — fully unit-testable.

/** Standard atomic weights (IUPAC conventional values; [] masses for unstable). */
export const PERIODIC: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996,
  Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
  As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41,
  In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33,
  La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25,
  Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05, Lu: 174.97, Hf: 178.49,
  Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227,
  Th: 232.04, Pa: 231.04, U: 238.03, Np: 237, Pu: 244, Am: 243, Cm: 247, Bk: 247, Cf: 251,
  Es: 252, Fm: 257, Md: 258, No: 259, Lr: 262, Rf: 267, Db: 268, Sg: 269, Bh: 270, Hs: 269,
  Mt: 278, Ds: 281, Rg: 282, Cn: 285, Nh: 286, Fl: 289, Mc: 290, Lv: 293, Ts: 294, Og: 294,
};

/** True if `symbol` is a real element symbol (case-sensitive, e.g. Co ≠ CO). */
export function isElement(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(PERIODIC, symbol);
}

export interface FormulaValidation {
  valid: boolean;
  errors: string[];
  /** Element → total atom count (after resolving groups/hydrates). */
  counts: Record<string, number>;
  /** Net ionic charge (0 if neutral). */
  charge: number;
  /** Molecular weight in g/mol, or null if the formula is invalid. */
  mass: number | null;
  /**
   * Normalized Hill-system formula (C, H, then others alphabetical). When a
   * coefficient is not a whole number (CaSO4·0.5H2O) the counts are not whole
   * either, and a merged Hill string ("CaHO4.5S") would not re-parse — so the
   * parts are kept apart instead: "CaO4S·½H2O", which does.
   */
  hill: string;
  /**
   * True when some element count is not a whole number — a fractional hydrate
   * or a fractional leading coefficient. Callers that need whole atoms (an
   * integer composition matrix, a molecular ion) must check this.
   */
  fractional: boolean;
  /** Plain-language notes about how the input was read (e.g. a leading coefficient). */
  notes: string[];
}

interface SegmentResult {
  counts: Record<string, number>;
  errors: string[];
  charge: number;
}

const add = (m: Record<string, number>, k: string, c: number): void => {
  m[k] = (m[k] ?? 0) + c;
};
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

const SUB_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};
const SUP_CHARS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};

/**
 * Folds the typeset forms this product DISPLAYS back into the ASCII the parser
 * reads: subscript digits become plain counts, and a run of superscripts becomes
 * the parser's caret charge notation.
 *
 * THE CARET MATTERS. A superscript run is a CHARGE, and this parser spells a
 * charge "^2-" (see the `^` branch in parseSegment). Folding SO₄²⁻ to "SO42-"
 * would read the 2 as part of the oxygen count — a silently wrong formula, which
 * is worse than the refusal this function exists to remove. So the run is
 * emitted as "^2-", which the mono-ion path and the caret path both handle
 * identically to the ASCII spellings users already type.
 *
 * Anything else is left alone so it still reaches the parser's own error
 * messages — this normalises notation, it does not silently repair typos.
 */
export function normalizeFormulaText(input: string): string {
  return (
    input
      .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => SUB_DIGITS[c])
      // ONLY A WELL-FORMED CHARGE IS FOLDED: digits then at most one sign, or a
      // bare sign. A run that is anything else is left alone deliberately, so
      // `superscriptComplaint` below can say what is actually wrong instead of
      // the parser blaming a caret the user never typed.
      // The MAXIMAL run, not a greedy sub-match: matching "digits then one sign"
      // per occurrence split Fe³⁺⁺ into ³⁺ and ⁺, folded both, and summed them
      // to +4 — silently accepting a malformed charge and disagreeing with the
      // ASCII spelling. One run in, one decision out.
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) => {
        const ascii = [...run].map((c) => SUP_CHARS[c]).join("");
        return /^\d*[+-]$/.test(ascii) ? "^" + ascii : run;
      })
      .replace(/−/g, "-")
  );
}

/**
 * A specific complaint about superscripts that are not a charge, or null.
 *
 * Two real cases, both of which previously produced a message naming a "^" the
 * user never typed, because the fold had already rewritten their input:
 *
 *   ¹⁴C, ²H, H₂¹⁸O   an ISOTOPE prefix. This parser has no isotope support at
 *                    all — mass numbers are not in PERIODIC — so the honest
 *                    answer names the limitation rather than the syntax.
 *   Fe³⁺⁺            a malformed charge. Silently summing the two signs gave
 *                    +4, while the ASCII spelling Fe3++ gave +2: the same
 *                    notation meaning two different things is exactly what the
 *                    round-trip rule exists to prevent, so it is refused.
 */
function superscriptComplaint(src: string): string | null {
  if (!/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/.test(src)) return null;
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s*[A-Z]/.test(src)) {
    return (
      "Isotope notation such as ¹⁴C is not supported — this tool uses standard atomic weights, " +
      "so enter the element without its mass number."
    );
  }
  return "That superscript is not a charge. Write a charge as digits then one sign, e.g. SO₄²⁻ or Fe³⁺.";
}

/** Parses one hydrate segment (no leading coefficient) into counts + charge. */
function parseSegment(body: string): SegmentResult {
  const errors: string[] = [];
  const stack: Record<string, number>[] = [{}];
  let charge = 0;
  let i = 0;
  const n = body.length;
  const top = (): Record<string, number> => stack[stack.length - 1];

  const readCount = (): { num: string; sign: number } => {
    let num = "";
    while (i < n && isDigit(body[i])) num += body[i++];
    // A DECIMAL SUBSCRIPT (nonstoichiometric phase: Cu1.8S, Fe0.95O). Only when
    // the integer part is 0 or 1: nobody writes an integer count of 0 or 1 before
    // a hydrate dot, so "Cu1.8S" can only mean Cu₁.₈S (chempy agrees), while
    // "CuSO4.5H2O" stays the pinned pentahydrate. splitHydrateParts keeps the
    // same "." unsplit (isDecimalSubscriptDot) so both readers agree.
    if ((num === "0" || num === "1") && body[i] === "." && isDigit(body[i + 1] ?? "")) {
      num += body[i++];
      while (i < n && isDigit(body[i])) num += body[i++];
    }
    let sign = 0;
    if (i < n && (body[i] === "+" || body[i] === "-")) {
      sign = body[i] === "-" ? -1 : 1;
      i++;
    }
    return { num, sign };
  };

  while (i < n) {
    const ch = body[i];
    if (ch === " ") {
      i++;
      continue;
    }
    if (isUpper(ch)) {
      let sym = ch;
      i++;
      while (i < n && isLower(body[i])) sym += body[i++];
      if (!isElement(sym)) errors.push(`Unknown element “${sym}”`);
      const { num, sign } = readCount();
      // Digits after an atom are its subscript count; a bare trailing sign is a
      // ±1 charge (NH4+ → H:4, charge +1; NO3- → O:3, charge −1). A monatomic
      // metal cation like "Ca2+" (digit = charge) is handled in validateFormula.
      // A subscript of zero is not chemistry. "H0" used to validate clean with a
      // molar mass of 0 and a Hill formula of "H0", and "C0H4" likewise -- an
      // impossible formula certified as correct, which is worse than a refusal.
      const count = num ? Number(num) : 1;
      if (count === 0) errors.push(`Subscript 0 on “${sym}” is not a formula — remove the element or give it a count of 1 or more`);
      add(top(), sym, count);
      if (sign) charge += sign;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({});
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length < 2) {
        errors.push(`Unmatched “${ch}”`);
        i++;
        continue;
      }
      const group = stack.pop() as Record<string, number>;
      i++;
      const { num, sign } = readCount();
      const mult = sign ? 1 : num ? Number(num) : 1;
      if (sign && num.includes(".")) errors.push(`A charge cannot be a decimal (“${num}”)`);
      if (sign) charge += sign * (num ? parseInt(num, 10) : 1);
      if (!sign && num && mult === 0) errors.push(`Subscript 0 on a group is not a formula — remove the group`);
      for (const [k, v] of Object.entries(group)) add(top(), k, v * mult);
      continue;
    }
    if (ch === "^") {
      i++;
      const { num, sign } = readCount();
      if (sign && num.includes(".")) errors.push(`A charge cannot be a decimal (“${num}”)`);
      if (sign) charge += sign * (num ? parseInt(num, 10) : 1);
      else errors.push("“^” must be followed by a charge, e.g. ^2-");
      continue;
    }
    if (ch === "+" || ch === "-") {
      charge += ch === "-" ? -1 : 1;
      i++;
      continue;
    }
    if (isDigit(ch)) {
      let num = "";
      while (i < n && isDigit(body[i])) num += body[i++];
      errors.push(`Misplaced number “${num}”`);
      continue;
    }
    if (ch === "=" || ch === "*" || ch === "·" || ch === "•") {
      i++; // bond glyphs / stray middots (hydrate dots are split off before this)
      continue;
    }
    errors.push(`Unexpected character “${ch}”`);
    i++;
  }
  while (stack.length > 1) {
    errors.push("Unclosed “(”");
    stack.pop();
  }
  return { counts: stack[0], errors, charge };
}

/**
 * Validates a chemical formula and reports atom counts, net charge, molecular
 * weight, and the Hill-system formula. `valid` is false if any element symbol
 * is not a real element, brackets are unbalanced, or the syntax is malformed.
 */
export function validateFormula(input: string): FormulaValidation {
  // UNICODE SUB/SUPERSCRIPTS ARE ACCEPTED, for the same reason massspec.ts
  // accepts them (see its SUB_DIGITS comment): the pane displays every formula
  // scientifically — H₂O, C₈H₁₈ — Word's autocorrect produces the same
  // characters, and Engineering's formatFormula() renders CH₄. A user pasting
  // any of those back into this box is typing exactly what we showed them.
  // Refusing ₂ while displaying ₂ makes the correct rendering a round-trip trap,
  // and it did: "H₂O" returned 'Unexpected character "₂"' with no mass.
  //
  // Superscripts are folded too, because a displayed charge (SO₄²⁻) is subject
  // to the identical trap.
  const src = normalizeFormulaText(input).trim();
  const errors: string[] = [];
  // Any superscript that survived the fold was not a charge. Say what it was.
  const supComplaint = superscriptComplaint(src);
  const fail = (errs: string[]): FormulaValidation => ({
    valid: false, errors: errs, counts: {}, charge: 0, mass: null, hill: "", fractional: false, notes: [],
  });
  if (supComplaint) return fail([supComplaint]);
  const counts: Record<string, number> = {};
  let charge = 0;

  if (!src) return fail(["Enter a formula."]);

  // Monatomic ion (e.g. "Ca2+", "Fe3+"): the digit is the charge, not a count —
  // one atom, charge = ±digits. (Polyatomic ions like NH4+ parse normally.)
  const mono = /^([A-Z][a-z]?)(\d+)([+-])$/.exec(src);
  if (mono && isElement(mono[1])) {
    const el = mono[1];
    const q = (mono[3] === "-" ? -1 : 1) * parseInt(mono[2], 10);
    return { valid: true, errors: [], counts: { [el]: 1 }, charge: q, mass: PERIODIC[el], hill: el, fractional: false, notes: [] };
  }

  // HYDRATE PARTS. Each part may carry a leading coefficient, which is a NUMBER
  // — an integer, a decimal, a fraction a/b, or a vulgar-fraction glyph — that
  // multiplies the part's composition. The old split on every "." read the
  // decimal point of CaSO4·0.5H2O as a hydrate dot and the 0 and the 5 as two
  // integer coefficients: "✓ Valid, 226.209" for plaster of Paris (145.142).
  const split = splitHydrateParts(src);
  if (split.error) return fail([split.error]);
  const notes: string[] = [];
  const parts: { coef: Rational; counts: Record<string, number> }[] = [];
  for (const part of split.parts) {
    const c = readCoefficient(part.text);
    if (c.error) {
      errors.push(c.error);
      continue;
    }
    if (part.sep === "." && c.text && c.text.includes(".")) {
      // chempy reads "CaSO4.0.5H2O" as an O₄.₀ subscript; this parser would read
      // a hydrate. Two tools, two answers: refuse instead of guessing.
      return fail([
        `“${src}” puts a decimal coefficient after a “.” — write the hydrate dot as · ` +
          `(e.g. CaSO₄·0.5H₂O) so the number cannot be read as part of a subscript.`,
      ]);
    }
    const res = parseSegment(c.rest);
    errors.push(...res.errors);
    for (const [k, v] of Object.entries(res.counts)) {
      // Only reachable by repeating an element that has a decimal subscript
      // (Cu1.8SCu); its count could not be printed so that it re-parses.
      if (!Number.isInteger(v) && v >= 2) errors.push(`“${k}” has a decimal subscript and appears again — write its total count once.`);
    }
    const coef = c.coef;
    const value = coef.n / coef.d;
    for (const [k, v] of Object.entries(res.counts)) add(counts, k, v * value);
    const q = res.charge * value;
    if (!Number.isInteger(q)) errors.push(`A fractional coefficient (${c.text}) on a charged part gives a fractional charge.`);
    charge += q;
    parts.push({ coef, counts: res.counts });
    if (split.parts.length === 1 && c.text) {
      notes.push(
        `Leading coefficient ${c.text} read as ${c.text} × ${typesetPlain(hillFormula(res.counts))}: the counts and ` +
          `mass are for ${c.text} ${typesetPlain(hillFormula(res.counts))}, not one formula unit.`
      );
    }
  }

  if (!errors.length && !Object.keys(counts).length) errors.push("No elements found.");
  const valid = errors.length === 0;
  let mass: number | null = null;
  if (valid) {
    mass = 0;
    for (const [k, v] of Object.entries(counts)) mass += PERIODIC[k] * v;
  }
  const fractional = Object.values(counts).some((v) => !Number.isInteger(v));
  // A fractional composition — or a fractional COEFFICIENT, even when the counts
  // come out whole (1.5O2 is 1½ O₂, not ozone) — keeps its parts apart, so the
  // shown Hill form re-parses and never names a different molecule.
  const hill = fractional || parts.some((p) => p.coef.n % p.coef.d !== 0)
    ? parts.map((p) => coefficientGlyph(p.coef) + hillFormula(p.counts)).join("·")
    : hillFormula(counts);
  return { valid, errors: dedupe(errors), counts, charge, mass, hill, fractional, notes: valid ? notes : [] };
}

/** An exact positive rational coefficient. */
interface Rational {
  n: number;
  d: number;
}

const VULGAR: Record<string, [number, number]> = {
  "½": [1, 2], "⅓": [1, 3], "⅔": [2, 3], "¼": [1, 4], "¾": [3, 4], "⅕": [1, 5], "⅖": [2, 5],
  "⅗": [3, 5], "⅘": [4, 5], "⅙": [1, 6], "⅚": [5, 6], "⅛": [1, 8], "⅜": [3, 8], "⅝": [5, 8], "⅞": [7, 8],
};
const VULGAR_BY_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(VULGAR).map(([g, [n, d]]) => [`${n}/${d}`, g])
);

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The display form of a coefficient: "" for 1, "5", "½", "1½", "2/7". Every form re-parses. */
function coefficientGlyph(c: Rational): string {
  const g = gcd(c.n, c.d);
  const n = c.n / g;
  const d = c.d / g;
  if (d === 1) return n === 1 ? "" : String(n);
  const whole = Math.floor(n / d);
  const rem = n - whole * d;
  const glyph = VULGAR_BY_VALUE[`${rem}/${d}`];
  if (glyph) return (whole ? String(whole) : "") + glyph;
  return `${n}/${d}`;
}

/** Subscripts the digits of a plain Hill string, for messages (display contract). */
function typesetPlain(hill: string): string {
  return hill.replace(/\d/g, (ch) => "₀₁₂₃₄₅₆₇₈₉"[Number(ch)]);
}

/** Longest digit run accepted in one coefficient field — a bound, not a chemistry limit. */
const MAX_COEF_DIGITS = 9;

/**
 * Reads a part's leading coefficient. Returns the coefficient (1 when absent),
 * the text as typed ("" when absent), and the rest of the part; or a named
 * refusal for a coefficient that is zero, negative, a division by zero, or not
 * followed by a formula.
 */
function readCoefficient(part: string): { coef: Rational; text: string; rest: string; error?: string } {
  const one: Rational = { n: 1, d: 1 };
  const neg = /^-\s*[\d.½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.exec(part);
  if (neg) {
    const m = /^-\s*[\d./½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+/.exec(part)!;
    return { coef: one, text: "", rest: part, error: `Negative coefficient “${m[0].replace("-", "−")}” — a hydrate coefficient counts formula units and must be positive.` };
  }
  let m: RegExpExecArray | null;
  let coef: Rational | null = null;
  let text = "";
  if ((m = /^(\d*)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/.exec(part))) {
    const [vn, vd] = VULGAR[m[2]];
    const whole = m[1] ? Number(m[1]) : 0;
    coef = { n: whole * vd + vn, d: vd };
    text = m[0].replace(/\s+/g, "");
  } else if ((m = /^(\d+)\s*\/\s*(\d+)/.exec(part))) {
    coef = { n: Number(m[1]), d: Number(m[2]) };
    text = `${m[1]}/${m[2]}`;
    if (m[1].length > MAX_COEF_DIGITS || m[2].length > MAX_COEF_DIGITS) {
      return { coef: one, text: "", rest: part, error: `Coefficient “${text}” is too long.` };
    }
    if (coef.d === 0) return { coef: one, text: "", rest: part, error: `Coefficient “${text}” divides by zero.` };
  } else if ((m = /^(\d*)\.(\d+)/.exec(part))) {
    if (m[1].length > MAX_COEF_DIGITS || m[2].length > MAX_COEF_DIGITS) {
      return { coef: one, text: "", rest: part, error: `Coefficient “${m[0]}” is too long.` };
    }
    coef = { n: Number((m[1] || "0") + m[2]), d: 10 ** m[2].length };
    text = m[0];
  } else if ((m = /^(\d+)/.exec(part))) {
    if (m[1].length > MAX_COEF_DIGITS) return { coef: one, text: "", rest: part, error: `Coefficient “${m[1]}” is too long.` };
    coef = { n: Number(m[1]), d: 1 };
    text = m[1];
  }
  if (!coef) return { coef: one, text: "", rest: part };
  const rest = part.slice(m![0].length).trim();
  if (coef.n === 0) {
    return { coef: one, text: "", rest, error: `Coefficient zero (“${text}”) — a part present zero times is not in the formula; remove it.` };
  }
  if (!rest) return { coef: one, text: "", rest, error: `Coefficient “${text}” has no formula after it.` };
  return { coef, text, rest };
}

/**
 * Splits a formula into hydrate parts. "·", "•" and "*" always separate. A "."
 * separates too — EXCEPT where it is the decimal point of a leading coefficient:
 * the part so far is only digits (or empty) and a digit follows. That keeps
 * "0.5H2O", "CaSO4·0.5H2O" and "1.5O2" whole while "CuSO4.5H2O" (pinned since
 * v1) and "MgSO4.H2O" stay hydrates.
 */
/**
 * True when a "." is the decimal point of a SUBSCRIPT (Cu1.8S, Fe0.95O): it
 * follows an element or group whose count so far is exactly 0 or 1, and a digit
 * follows. balance.ts's species reader must make the same call (it composes
 * through validateFormula, so it inherits this reading).
 */
function isDecimalSubscriptDot(before: string, next: string): boolean {
  return /[A-Za-z)\]}][01]$/.test(before) && isDigit(next);
}

function splitHydrateParts(src: string): { parts: { text: string; sep: string }[]; error?: string } {
  const parts: { text: string; sep: string }[] = [];
  let cur = "";
  let sep = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const isSep =
      ch === "·" || ch === "•" || ch === "*" ||
      (ch === "." &&
        !(/^\s*-?\s*\d*\s*$/.test(cur) && isDigit(src[i + 1] ?? "")) &&
        !isDecimalSubscriptDot(cur, src[i + 1] ?? ""));
    if (isSep) {
      if (cur.trim()) parts.push({ text: cur.trim(), sep });
      cur = "";
      sep = ch;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push({ text: cur.trim(), sep });
  return { parts };
}

function dedupe(a: string[]): string[] {
  return a.filter((x, k) => a.indexOf(x) === k);
}

/** Hill system: carbon first, hydrogen second, then all others alphabetically. */
export function hillFormula(counts: Record<string, number>): string {
  const keys = Object.keys(counts);
  if (!keys.length) return "";
  const order = keys.slice().sort((a, b) => {
    if (a === b) return 0;
    if ("C" in counts) {
      if (a === "C") return -1;
      if (b === "C") return 1;
      if (a === "H") return -1;
      if (b === "H") return 1;
    }
    return a.localeCompare(b);
  });
  return order.map((k) => (counts[k] === 1 ? k : `${k}${counts[k]}`)).join("");
}
