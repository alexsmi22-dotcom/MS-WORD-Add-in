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
  /** Normalized Hill-system formula (C, H, then others alphabetical). */
  hill: string;
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
      add(top(), sym, num ? parseInt(num, 10) : 1);
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
      const mult = sign ? 1 : num ? parseInt(num, 10) : 1;
      if (sign) charge += sign * (num ? parseInt(num, 10) : 1);
      for (const [k, v] of Object.entries(group)) add(top(), k, v * mult);
      continue;
    }
    if (ch === "^") {
      i++;
      const { num, sign } = readCount();
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
    if (ch === "=" || ch === "*" || ch === "·") {
      i++; // bond glyphs / stray middots
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
  const src = input.trim();
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let charge = 0;

  if (!src) {
    return { valid: false, errors: ["Enter a formula."], counts, charge: 0, mass: null, hill: "" };
  }

  // Monatomic ion (e.g. "Ca2+", "Fe3+"): the digit is the charge, not a count —
  // one atom, charge = ±digits. (Polyatomic ions like NH4+ parse normally.)
  const mono = /^([A-Z][a-z]?)(\d+)([+-])$/.exec(src);
  if (mono && isElement(mono[1])) {
    const el = mono[1];
    const q = (mono[3] === "-" ? -1 : 1) * parseInt(mono[2], 10);
    return { valid: true, errors: [], counts: { [el]: 1 }, charge: q, mass: PERIODIC[el], hill: el };
  }

  // Split on hydrate dots ("·" or "."); each part may carry a leading coefficient.
  for (const rawSeg of src.split(/[.·]/)) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    let j = 0;
    let coefStr = "";
    while (j < seg.length && isDigit(seg[j])) coefStr += seg[j++];
    const coef = coefStr ? parseInt(coefStr, 10) : 1;
    const res = parseSegment(seg.slice(j));
    errors.push(...res.errors);
    for (const [k, v] of Object.entries(res.counts)) add(counts, k, v * coef);
    charge += res.charge * coef;
  }

  if (!errors.length && !Object.keys(counts).length) errors.push("No elements found.");
  const valid = errors.length === 0;
  let mass: number | null = null;
  if (valid) {
    mass = 0;
    for (const [k, v] of Object.entries(counts)) mass += PERIODIC[k] * v;
  }
  return { valid, errors: dedupe(errors), counts, charge, mass, hill: hillFormula(counts) };
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
