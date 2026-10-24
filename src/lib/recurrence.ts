// Recurrence relations — closed forms, exact where the roots allow, and the
// master theorem for divide-and-conquer.
//
// a(n) = a(n-1) + a(n-2), a(0) = 0, a(1) = 1   → Binet, exact in Q(√5)
// a(n) = 2a(n-1) + 3, a(0) = 1                   → particular + homogeneous
// T(n) = T(n-1) + n, T(0) = 0                    → resonance with root 1
// T(n) = 2T(n/2) + n                             → master theorem, case 2
//
// LINEAR, CONSTANT COEFFICIENTS, ORDER ≤ 4. The characteristic polynomial is
// solved exactly where it can be: rational roots by the rational-root theorem
// (and deflation), a remaining quadratic by the formula in Q(√D). A remaining
// irreducible cubic or quartic, or complex roots, give a NUMERIC closed form
// and say so. Non-linear recurrences and variable coefficients are refused by
// name.
//
// EVERY CLOSED FORM IS VERIFIED against direct iteration for n = 0…15 (exact
// equality in the exact field; relative 10⁻⁷ in the numeric case). A closed
// form that fails that check is reported as FAILED, never shown as the answer.

import { DiscreteResult, DiscreteError } from "./discrete";
import { solveEquation } from "./solve";
import { gcd, factorize, divisorsFrom } from "./numtheory";

// ---------------------------------------------------------------------------
// Exact rationals

export class Rat {
  constructor(public num: bigint, public den: bigint = 1n) {
    if (den === 0n) throw new DiscreteError("Division by zero.");
    if (den < 0n) { num = -num; den = -den; }
    const g = gcd(num < 0n ? -num : num, den);
    this.num = g > 1n ? num / g : num;
    this.den = g > 1n ? den / g : den;
  }
  static of(n: number | bigint): Rat { return new Rat(BigInt(n)); }
  static parse(s: string): Rat {
    const t = s.replace(/\s/g, "").replace(/−/g, "-");
    let m: RegExpExecArray | null;
    if ((m = /^(-?\d+)\/(\d+)$/.exec(t))) return new Rat(BigInt(m[1]), BigInt(m[2]));
    if ((m = /^(-?)(\d*)\.(\d+)$/.exec(t))) return new Rat(BigInt((m[1] + (m[2] || "0") + m[3]).replace(/^(-?)0+(?=\d)/, "$1")), 10n ** BigInt(m[3].length));
    if (/^-?\d+$/.test(t)) return new Rat(BigInt(t));
    throw new DiscreteError(`"${s}" is not a number.`);
  }
  add(o: Rat): Rat { return new Rat(this.num * o.den + o.num * this.den, this.den * o.den); }
  sub(o: Rat): Rat { return new Rat(this.num * o.den - o.num * this.den, this.den * o.den); }
  mul(o: Rat): Rat { return new Rat(this.num * o.num, this.den * o.den); }
  div(o: Rat): Rat { if (o.num === 0n) throw new DiscreteError("Division by zero."); return new Rat(this.num * o.den, this.den * o.num); }
  neg(): Rat { return new Rat(-this.num, this.den); }
  isZero(): boolean { return this.num === 0n; }
  eq(o: Rat): boolean { return this.num === o.num && this.den === o.den; }
  isInt(): boolean { return this.den === 1n; }
  toNumber(): number { return Number(this.num) / Number(this.den); }
  pow(n: number): Rat { let r = Rat.of(1); let b: Rat = this; let e = n; while (e > 0) { if (e & 1) r = r.mul(b); b = b.mul(b); e >>= 1; } return r; }
  toString(): string { return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`; }
}
const R0 = Rat.of(0), R1 = Rat.of(1);

// ---------------------------------------------------------------------------
// Q(√D): a + b√D with D a square-free positive rational (D = 0 means Q).

class QN {
  constructor(public a: Rat, public b: Rat, public D: Rat) {}
  static rat(r: Rat, D: Rat): QN { return new QN(r, R0, D); }
  add(o: QN): QN { return new QN(this.a.add(o.a), this.b.add(o.b), this.D); }
  sub(o: QN): QN { return new QN(this.a.sub(o.a), this.b.sub(o.b), this.D); }
  mul(o: QN): QN { return new QN(this.a.mul(o.a).add(this.b.mul(o.b).mul(this.D)), this.a.mul(o.b).add(this.b.mul(o.a)), this.D); }
  div(o: QN): QN {
    const n = o.a.mul(o.a).sub(o.b.mul(o.b).mul(this.D)); // norm
    if (n.isZero()) throw new DiscreteError("Division by zero.");
    const conj = new QN(o.a, o.b.neg(), this.D);
    const p = this.mul(conj);
    return new QN(p.a.div(n), p.b.div(n), this.D);
  }
  isZero(): boolean { return this.a.isZero() && this.b.isZero(); }
  eq(o: QN): boolean { return this.a.eq(o.a) && this.b.eq(o.b); }
  pow(n: number): QN { let r = QN.rat(R1, this.D); let b: QN = this; let e = n; while (e > 0) { if (e & 1) r = r.mul(b); b = b.mul(b); e >>= 1; } return r; }
  toNumber(): number { return this.a.toNumber() + this.b.toNumber() * Math.sqrt(this.D.toNumber()); }
  toString(): string {
    const sq = `√${this.D.den === 1n ? this.D.num : `(${this.D})`}`;
    if (this.b.isZero()) return showRat(this.a);
    // p/q·√D is written p√D/q: "1/5√5" read as 1/(5√5) (review 2026-10-24).
    const surd = (m: Rat): string => (m.den === 1n ? `${m.eq(R1) ? "" : showRat(m)}${sq}` : `${m.num === 1n ? "" : m.num}${sq}/${m.den}`);
    const babs = new Rat(this.b.num < 0n ? -this.b.num : this.b.num, this.b.den);
    const bs = `${this.b.num < 0n ? "−" : ""}${surd(babs)}`;
    if (this.a.isZero()) return bs;
    const bpos = this.b.num > 0n;
    const bterm = surd(babs);
    return `(${showRat(this.a)} ${bpos ? "+" : "−"} ${bterm})`;
  }
}
function showRat(r: Rat): string {
  return r.toString().replace("-", "−");
}

// ---------------------------------------------------------------------------
// Parsing

interface Parsed {
  name: string;
  order: number;
  /** c_1 … c_k: a(n) = Σ c_i a(n−i) + forcing */
  coeffs: Rat[];
  /** forcing terms: coefficient × n^deg × base^n */
  forcing: { coef: Rat; deg: number; base: Rat }[];
  initial: Map<number, Rat>;
  raw: string;
}

const NAME = String.raw`([A-Za-z]\w*)`;

/** Normalises a_n, a_{n-1}, a[n-1], a(n−1) to NAME(n-1) and so on. */
function normaliseNames(s: string): string {
  return s
    .replace(/−/g, "-")
    .replace(new RegExp(String.raw`${NAME}_\{\s*([^}]+)\}`, "g"), "$1($2)")
    .replace(new RegExp(String.raw`${NAME}_\(\s*([^)]+)\)`, "g"), "$1($2)")
    .replace(new RegExp(String.raw`${NAME}\[\s*([^\]]+)\]`, "g"), "$1($2)")
    .replace(new RegExp(String.raw`${NAME}_(n(?:[-+]\d+)?|\d+)`, "g"), "$1($2)")
    .replace(/·|×/g, "*")
    .replace(/[ \t]+/g, " ");
}

function splitClauses(s: string): string[] {
  return s.split(/\s*(?:,|;|\n|\bwith\b|\bwhere\b|\band\b)\s*/i).map((c) => c.trim()).filter(Boolean);
}

/** Splits an expression into additive terms at the top level. */
function additiveTerms(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if ((c === "+" || c === "-") && depth === 0 && i > 0 && !/[*/^eE(]\s*$/.test(cur)) {
      out.push(cur.trim());
      cur = c;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

interface Term { coef: Rat; lag?: number; deg: number; base: Rat; other?: string }

function parseTerm(t: string, name: string): Term {
  // Spaces inside parentheses vanish; remaining spaces between factors are
  // multiplication (2 a(n-1), n^2 3^n). A leading (p/q) is a coefficient.
  let s = t.replace(/\(([^()]*)\)/g, (_, inner: string) => "(" + inner.replace(/\s+/g, "") + ")").trim()
    .replace(/\s*([-+*/^])\s*/g, "$1").replace(/\s+/g, "*").replace(/^\((\d+\/\d+)\)/, "$1");
  // "/k" after a factor divides the coefficient.
  s = s.replace(/\/(\d+)(?=\*|$)/g, "*1/$1");
  let sign = R1;
  while (s[0] === "+" || s[0] === "-") { if (s[0] === "-") sign = sign.neg(); s = s.slice(1); }
  const factors = s.split("*").filter(Boolean);
  let coef = sign;
  let lag: number | undefined;
  let deg = 0;
  let base = R1;
  const lagRe = new RegExp(String.raw`^${name}\((?:n-(\d+)|n)\)(?:\^(\d+))?$`);
  for (let f of factors) {
    let m: RegExpExecArray | null;
    while (f.length) {
      // A leading numeric coefficient glued to the rest: 3a(n-1), 2n, 3*2^n, 5n^2.
      if ((m = /^(\d+\.?\d*|\d*\.\d+|\d+\/\d+)(?=[A-Za-z(]|$)/.exec(f))) {
        coef = coef.mul(Rat.parse(m[1]));
        f = f.slice(m[0].length);
        continue;
      }
      if ((m = lagRe.exec(f))) {
        if (m[2]) throw new DiscreteError(`${name}(…)^${m[2]} makes this non-linear; only linear recurrences with constant coefficients have the closed forms computed here.`);
        const k = m[1] === undefined ? 0 : Number(m[1]);
        if (k === 0) throw new DiscreteError(`${name}(n) appears on both sides.`);
        if (lag !== undefined) throw new DiscreteError(`A product of two ${name} terms is non-linear.`);
        lag = k;
        f = "";
        continue;
      }
      if ((m = new RegExp(String.raw`^${name}\((n/(\d+)|[^)]*)\)`).exec(f))) {
        return { coef, deg: 0, base: R1, other: `${name}(${m[1]})` };
      }
      if ((m = /^n(?:\^(\d+))?/.exec(f))) {
        deg += m[1] ? Number(m[1]) : 1;
        f = f.slice(m[0].length);
        continue;
      }
      if ((m = /^\(?(-?\d+(?:\/\d+)?|\d*\.\d+)\)?\^n$/.exec(f)) || (m = /^\(?(-?\d+(?:\/\d+)?|\d*\.\d+)\)?\^n(?=[^A-Za-z0-9])/.exec(f))) {
        if (!base.eq(R1)) throw new DiscreteError("Two exponential bases in one term are not supported.");
        base = Rat.parse(m[1]);
        f = f.slice(m[0].length);
        continue;
      }
      if (/^[a-zA-Z]/.test(f)) return { coef, deg, base, other: f };
      throw new DiscreteError(`Could not read the term "${t}".`);
    }
  }
  return { coef, lag, deg, base };
}

const MASTER_RE_TAIL = String.raw`\(\s*n\s*/\s*(\d+(?:\.\d+)?|\d+/\d+)\s*\)\s*(?:\+\s*(.+))?$`;

export function parseRecurrence(input: string): Parsed | { master: { name: string; a: Rat; b: Rat; f: string } } | null {
  const text = normaliseNames(input.trim());
  const clauses = splitClauses(text);
  const recIdx = clauses.findIndex((c) => new RegExp(String.raw`^${NAME}\(n\)\s*=`).test(c));
  if (recIdx < 0) return null;
  const rec = clauses[recIdx];
  const name = (new RegExp(String.raw`^${NAME}\(n\)`).exec(rec) as RegExpExecArray)[1];
  const rhs = rec.slice(rec.indexOf("=") + 1).trim();
  // Master-theorem shape: a NAME(n/b) + f(n)
  const mm = new RegExp(String.raw`^(\d*)\s*\*?\s*${name}` + MASTER_RE_TAIL).exec(rhs.replace(/\s+/g, ""));
  if (mm) {
    return { master: { name, a: mm[1] ? Rat.parse(mm[1]) : R1, b: Rat.parse(mm[2]), f: mm[3] ?? "0" } };
  }
  const terms = additiveTerms(rhs).map((t) => parseTerm(t, name));
  const other = terms.find((t) => t.other);
  if (other) throw new DiscreteError(`The term "${other.other}" is outside what is solved here: linear recurrences with constant coefficients (a(n) = c₁a(n−1) + … + polynomial and exponential forcing) and the master theorem a·T(n/b) + f(n).`);
  const order = Math.max(0, ...terms.filter((t) => t.lag !== undefined).map((t) => t.lag as number));
  if (order === 0) throw new DiscreteError(`No ${name}(n−k) term on the right: this is not a recurrence.`);
  if (order > 4) throw new DiscreteError(`Order ${order} is above the order-4 cap (the characteristic polynomial would be degree ${order}).`);
  const coeffs: Rat[] = Array.from({ length: order }, () => R0);
  const forcing: Parsed["forcing"] = [];
  for (const t of terms) {
    if (t.lag !== undefined) {
      if (t.deg || !t.base.eq(R1)) throw new DiscreteError(`A coefficient that depends on n (as in n·${name}(n−1)) makes this a variable-coefficient recurrence, which is not solved here.`);
      coeffs[t.lag - 1] = coeffs[t.lag - 1].add(t.coef);
    } else {
      if (t.deg > 3) throw new DiscreteError("Forcing polynomials are supported up to degree 3.");
      const same = forcing.find((f) => f.deg === t.deg && f.base.eq(t.base));
      if (same) same.coef = same.coef.add(t.coef);
      else forcing.push({ coef: t.coef, deg: t.deg, base: t.base });
    }
  }
  const initial = new Map<number, Rat>();
  clauses.forEach((c, i) => {
    if (i === recIdx) return;
    const m = new RegExp(String.raw`^${name}\((\d+)\)\s*=\s*(-?[\d./]+)$`).exec(c.replace(/\s+/g, ""));
    if (!m) throw new DiscreteError(`"${c}" is not an initial condition like ${name}(0) = 1.`);
    if (initial.has(Number(m[1]))) throw new DiscreteError(`${name}(${m[1]}) is given twice.`);
    initial.set(Number(m[1]), Rat.parse(m[2]));
  });
  return { name, order, coeffs, forcing: forcing.filter((f) => !f.coef.isZero()), initial, raw: rec };
}

// ---------------------------------------------------------------------------
// Complex numbers (the numeric field) — declared early: the root polish uses it.

type C = { re: number; im: number };
interface Field<T> {
  zero: T; one: T;
  add(a: T, b: T): T; sub(a: T, b: T): T; mul(a: T, b: T): T; div(a: T, b: T): T;
  isZero(a: T): boolean; fromRat(r: Rat): T; show(a: T): string; pow(a: T, n: number): T;
  close(a: T, b: T): boolean;
}
function fmtNum(x: number): string {
  if (Number.isInteger(x)) return String(x);
  return Number(x.toPrecision(10)).toString();
}
const CField: Field<C> = {
  zero: { re: 0, im: 0 }, one: { re: 1, im: 0 },
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  div: (a, b) => { const d = b.re * b.re + b.im * b.im; if (d === 0) throw new DiscreteError("Division by zero."); return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
  isZero: (a) => Math.abs(a.re) < 1e-12 && Math.abs(a.im) < 1e-12,
  fromRat: (r) => ({ re: r.toNumber(), im: 0 }),
  show: (a) => Math.abs(a.im) < 1e-9 ? fmtNum(a.re) : `(${fmtNum(a.re)} ${a.im < 0 ? "−" : "+"} ${fmtNum(Math.abs(a.im))}i)`,
  pow: (a, n) => { let r = { re: 1, im: 0 }; for (let i = 0; i < n; i++) r = CField.mul(r, a); return r; },
  close: (a, b) => Math.hypot(a.re - b.re, a.im - b.im) <= 1e-7 * Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im)),
};
function qnField(D: Rat): Field<QN> {
  return {
    zero: QN.rat(R0, D), one: QN.rat(R1, D),
    add: (a, b) => a.add(b), sub: (a, b) => a.sub(b), mul: (a, b) => a.mul(b), div: (a, b) => a.div(b),
    isZero: (a) => a.isZero(), fromRat: (r) => QN.rat(r, D), show: (a) => a.toString(), pow: (a, n) => a.pow(n),
    close: (a, b) => a.eq(b),
  };
}
const RatField: Field<Rat> = {
  zero: R0, one: R1, add: (a, b) => a.add(b), sub: (a, b) => a.sub(b), mul: (a, b) => a.mul(b), div: (a, b) => a.div(b),
  isZero: (a) => a.isZero(), fromRat: (r) => r, show: (a) => a.toString(), pow: (a, n) => a.pow(n), close: (a, b) => a.eq(b),
};

/** Solves M c = v by Gaussian elimination over F. */
function solveLinear<T>(F: Field<T>, M: T[][], v: T[]): T[] | null {
  const n = v.length;
  const A = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let r = col; r < n; r++) if (!F.isZero(A[r][col])) { piv = r; break; }
    if (piv < 0) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col || F.isZero(A[r][col])) continue;
      const f = F.div(A[r][col], A[col][col]);
      for (let k = col; k <= n; k++) A[r][k] = F.sub(A[r][k], F.mul(f, A[col][k]));
    }
  }
  return A.map((row, i) => F.div(row[n], row[i]));
}

// ---------------------------------------------------------------------------
// Characteristic polynomial and its roots

/** `radical`: the root's exact closed form in radicals from the polynomial
 *  root engine (cubic/quartic formulas, v2.136.0) when the closed form below
 *  carries it numerically — shown, never used for arithmetic. */
interface RootInfo { exact?: QN; approx: C; mult: number; radical?: string }

/** Monic polynomial coefficients, highest degree first, over Rat. */
function charPoly(coeffs: Rat[]): Rat[] {
  return [R1, ...coeffs.map((c) => c.neg())];
}

function polyEval(p: Rat[], x: Rat): Rat {
  let r = R0;
  for (const c of p) r = r.mul(x).add(c);
  return r;
}
function deflate(p: Rat[], root: Rat): Rat[] {
  const out: Rat[] = [];
  let acc = R0;
  for (let i = 0; i < p.length - 1; i++) {
    acc = acc.mul(root).add(p[i]);
    out.push(acc);
  }
  return out;
}

function squareFreePart(n: bigint): { sq: bigint; rest: bigint } {
  const f = factorize(n);
  if (f.unfactored) return { sq: 1n, rest: n };
  let sq = 1n, rest = 1n;
  for (const [p, e] of f.factors) {
    sq *= p ** BigInt(Math.floor(e / 2));
    if (e % 2) rest *= p;
  }
  return { sq, rest };
}

/** Writes √D = scale · √d with d a square-free integer. */
function simplifySqrt(D: Rat): { scale: Rat; d: Rat } | null {
  if (D.num <= 0n) return null;
  if (D.num.toString().length > 30 || D.den.toString().length > 30) return null;
  // √(num/den) = √(num·den) / den
  const prod = squareFreePart(D.num * D.den);
  return { scale: new Rat(prod.sq, D.den), d: Rat.of(prod.rest) };
}

export function solveCharacteristic(coeffs: Rat[]): { roots: RootInfo[]; D: Rat | null; exactField: boolean; numericNotes: string[] } {
  let p = charPoly(coeffs);
  const roots: RootInfo[] = [];
  // Why each numerically-carried root is numeric — said, per factor.
  const numericNotes: string[] = [];
  const addRoot = (exact: QN | undefined, re: number, im: number, radical?: string): void => {
    const same = roots.find((r) => (exact && r.exact ? r.exact.eq(exact) : Math.abs(r.approx.re - re) < 1e-9 && Math.abs(r.approx.im - im) < 1e-9));
    if (same) same.mult++;
    else roots.push({ exact, approx: { re, im }, mult: 1, ...(radical ? { radical } : {}) });
  };
  const clear = (q: Rat[]): bigint[] => {
    let l = 1n;
    for (const c of q) l = (l / gcd(l, c.den)) * c.den;
    return q.map((c) => (c.num * l) / c.den);
  };
  let D: Rat | null = null;
  for (;;) {
    while (p.length > 1 && p[p.length - 1].isZero()) { addRoot(QN.rat(R0, R0), 0, 0); p = p.slice(0, -1); }
    if (p.length <= 1) break;
    if (p.length === 2) {
      const r = p[1].neg().div(p[0]);
      addRoot(QN.rat(r, R0), r.toNumber(), 0);
      p = [R1];
      break;
    }
    const ints = clear(p);
    const lead = ints[0] < 0n ? -ints[0] : ints[0];
    const last = ints[ints.length - 1] < 0n ? -ints[ints.length - 1] : ints[ints.length - 1];
    let found: Rat | null = null;
    const dl = divisorsFrom(factorize(last)) ?? [];
    const dq = divisorsFrom(factorize(lead)) ?? [];
    if (dl.length * dq.length <= 4000) {
      outer: for (const a of dl) for (const b of dq) for (const sgn of [1n, -1n]) {
        const cand = new Rat(sgn * a, b);
        if (polyEval(p, cand).isZero()) { found = cand; break outer; }
      }
    }
    if (found) { addRoot(QN.rat(found, R0), found.toNumber(), 0); p = deflate(p, found); continue; }
    if (p.length === 3) {
      // r² + b r + c = 0 with exact surd roots.
      const b = p[1].div(p[0]), c = p[2].div(p[0]);
      const disc = b.mul(b).sub(c.mul(Rat.of(4)));
      if (disc.num > 0n) {
        const sq = simplifySqrt(disc);
        if (sq && sq.d.eq(R1)) {
          // √disc is rational: both roots are, even when the divisor search was capped.
          const half = new Rat(1n, 2n);
          const r1 = b.neg().add(sq.scale).mul(half), r2 = b.neg().sub(sq.scale).mul(half);
          addRoot(QN.rat(r1, R0), r1.toNumber(), 0);
          addRoot(QN.rat(r2, R0), r2.toNumber(), 0);
          p = [R1];
          continue;
        }
        if (sq && (D === null || D.eq(sq.d))) {
          D = sq.d;
          const half = new Rat(1n, 2n);
          const r1 = new QN(b.neg().mul(half), sq.scale.mul(half), D);
          const r2 = new QN(b.neg().mul(half), sq.scale.mul(half).neg(), D);
          addRoot(r1, r1.toNumber(), 0);
          addRoot(r2, r2.toNumber(), 0);
          p = [R1];
          continue;
        }
      }
      // Complex, or a second surd field: numeric.
      numericNotes.push(
        disc.num < 0n
          ? "a quadratic factor with complex roots is carried numerically (the exact closed form here works in ℚ(√D) with D > 0)"
          : "a quadratic factor whose square root lies outside the field already in use is carried numerically (one ℚ(√D) per closed form)",
      );
      const bn = b.toNumber(), cn = c.toNumber();
      const dn = bn * bn - 4 * cn;
      if (dn < 0) { addRoot(undefined, -bn / 2, Math.sqrt(-dn) / 2); addRoot(undefined, -bn / 2, -Math.sqrt(-dn) / 2); }
      else { addRoot(undefined, (-bn + Math.sqrt(dn)) / 2, 0); addRoot(undefined, (-bn - Math.sqrt(dn)) / 2, 0); }
      p = [R1];
      continue;
    }
    // Degree ≥ 3 with no rational root: numeric, from the polynomial root engine,
    // then Newton-polished — its 1e-8 is not enough once a root is raised to the 15th power.
    const expr = p.map((c, i) => { const d = p.length - 1 - i; return `(${c.toString()})${d === 0 ? "" : d === 1 ? "*r" : `*r^${d}`}`; }).join(" + ");
    const sol = solveEquation(`${expr} = 0`, "r");
    if (!sol || !sol.roots.length) throw new DiscreteError("The characteristic polynomial could not be solved.");
    const pn = p.map((c) => c.toNumber());
    // v2.136.0: the root engine gives EXACT forms in radicals for degree 3–4
    // (and anything that factors into such pieces). The closed form below
    // still computes with the Newton-polished values — ℚ(√D) arithmetic cannot
    // hold a cube root — so the exact forms are SHOWN beside them, and a root
    // with no exact form says why.
    const deg = p.length - 1;
    const exactCount = sol.roots.filter((r) => r.exact).length;
    numericNotes.push(
      exactCount === sol.roots.length
        ? `the degree-${deg} factor's roots have exact forms in radicals (shown); the closed form carries them numerically, Newton-polished to double precision`
        : deg >= 5 && exactCount === 0
          ? `the degree-${deg} factor has no general formula in radicals (Abel–Ruffini; not tested for solvability), so its roots are numeric, Newton-polished`
          : `${exactCount ? "some of the" : "the"} degree-${deg} factor's roots have no closed form shown (${
              sol.steps.some((s) => /runs to \d+ characters/.test(s))
                ? "their closed form runs past the display cap"
                : sol.caveats.some((c) => /cube root of a complex number/.test(c))
                  ? "a closed form would need cube roots of complex numbers"
                  : "the root engine gave none"
            }), so ${exactCount ? "those are" : "they are"} numeric, Newton-polished`,
    );
    for (const r of sol.roots) {
      let z: C = { re: r.re, im: r.im };
      for (let it = 0; it < 8; it++) {
        let f: C = { re: 0, im: 0 };
        let df: C = { re: 0, im: 0 };
        for (const c of pn) { df = CField.add(CField.mul(df, z), f); f = CField.add(CField.mul(f, z), { re: c, im: 0 }); }
        if (CField.isZero(df)) break;
        z = CField.sub(z, CField.div(f, df));
      }
      // v2.136.0: solveEquation now reports a repeated root ONCE with its exact
      // multiplicity (square-free factorisation) instead of as several shattered
      // near-copies — so the multiplicity must be carried, or the n·rⁿ terms of
      // the general solution silently vanish.
      const radical = r.exact ? r.display.replace(/\s*\(×\d+\)\s*$/, "") : undefined;
      for (let m = 0; m < (r.mult ?? 1); m++) addRoot(undefined, z.re, z.im, radical);
    }
    p = [R1];
  }
  // Rational roots found alongside a surd pair live in the same field.
  if (D !== null) for (const r of roots) if (r.exact && r.exact.D.isZero()) r.exact = new QN(r.exact.a, r.exact.b, D);
  const exactField = roots.every((r) => r.exact);
  return { roots, D: exactField ? D : null, exactField, numericNotes };
}

// ---------------------------------------------------------------------------
// Particular solution by undetermined coefficients (over Rat)

interface PartTerm { base: Rat; m: number; poly: Rat[] } // n^m (poly[0] + poly[1] n + …) base^n

function binom(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

/** Coefficients of (n − i)^p as a polynomial in n. */
function shiftPow(p: number, i: number): Rat[] {
  const out: Rat[] = Array.from({ length: p + 1 }, () => R0);
  for (let k = 0; k <= p; k++) out[k] = new Rat(binom(p, k) * (-BigInt(i)) ** BigInt(p - k));
  return out;
}

function particular(coeffs: Rat[], forcing: Parsed["forcing"], rootMult: (base: Rat) => number): PartTerm[] {
  const bases = new Map<string, { base: Rat; deg: number }>();
  for (const f of forcing) {
    const key = f.base.toString();
    const cur = bases.get(key);
    if (!cur) bases.set(key, { base: f.base, deg: f.deg });
    else cur.deg = Math.max(cur.deg, f.deg);
  }
  const parts: PartTerm[] = [];
  for (const { base, deg } of bases.values()) {
    const m = rootMult(base);
    const unknowns = deg + 1; // b_0..b_deg
    // L[P](n) = P(n) − Σ c_i P(n−i) base^{−i}, with P(n) = n^m Σ b_j n^j, all over base^n,
    // collected as a polynomial in n whose coefficients are linear forms in b.
    const maxDeg = m + deg;
    const forms: Rat[][] = Array.from({ length: maxDeg + 1 }, () => Array.from({ length: unknowns }, () => R0));
    const addPoly = (scale: Rat, shift: number): void => {
      for (let j = 0; j < unknowns; j++) {
        const sp = shiftPow(m + j, shift);
        sp.forEach((c, k) => { forms[k][j] = forms[k][j].add(c.mul(scale)); });
      }
    };
    addPoly(R1, 0);
    coeffs.forEach((c, idx) => {
      const i = idx + 1;
      if (c.isZero()) return;
      addPoly(c.neg().div(base.pow(i)), i);
    });
    const rhs: Rat[] = Array.from({ length: maxDeg + 1 }, () => R0);
    for (const f of forcing) if (f.base.eq(base)) rhs[f.deg] = rhs[f.deg].add(f.coef);
    // The operator annihilates n^j base^n for j < m, so applying it to
    // n^m q(n) base^n leaves a polynomial of degree deg(q) exactly: the
    // equations are the coefficients of n^0 … n^deg (the higher ones vanish).
    const rows = forms.slice(0, unknowns);
    const v = rhs.slice(0, unknowns);
    const sol = solveLinear(RatField, rows, v);
    if (!sol) throw new DiscreteError("The particular solution's coefficient system is singular — not expected; please report the input.");
    parts.push({ base, m, poly: sol });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Display helpers

const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const sup = (n: number): string => String(n).split("").map((d) => SUPS[Number(d)]).join("");
const sub = (n: number): string => String(n).split("").map((d) => SUBS[Number(d)]).join("");
function nPow(k: number): string { return k === 0 ? "" : k === 1 ? "n" : `n${sup(k)}`; }

interface Signed { neg: boolean; body: string }

/** Joins signed terms: the first negative term is glued ("−3"), later ones
 *  are spaced ("… − 3"); empty input is "0". */
function joinSigned(terms: Signed[]): string {
  if (!terms.length) return "0";
  return terms.map((t, i) => (i === 0 ? (t.neg ? "−" : "") + t.body : ` ${t.neg ? "−" : "+"} ${t.body}`)).join("");
}
/** Inverse of joinSigned for already-rendered pieces. */
function signedTerms(text: string): Signed[] {
  if (!text || text === "0") return [];
  return text.split(/ (?=[+−] )/).map((piece, i) => {
    if (i === 0) return piece.startsWith("−") ? { neg: true, body: piece.slice(1) } : { neg: false, body: piece };
    return { neg: piece.startsWith("−"), body: piece.slice(2) };
  });
}

function showPolyRat(poly: Rat[], shift: number): string {
  const parts: Signed[] = [];
  poly.forEach((c, j) => {
    if (c.isZero()) return;
    const k = j + shift;
    const mag = new Rat(c.num < 0n ? -c.num : c.num, c.den);
    // A fractional coefficient goes OVER the power: n/2 + n²/2, never "1/2n + 1/2n²",
    // which reads as 1/(2n) (review 2026-10-24).
    const body = k === 0
      ? showRat(mag)
      : mag.eq(R1)
        ? nPow(k)
        : mag.den === 1n
          ? `${showRat(mag)}${nPow(k)}`
          : `${mag.num === 1n ? "" : mag.num}${nPow(k)}/${mag.den}`;
    parts.push({ neg: c.num < 0n, body });
  });
  return joinSigned(parts);
}

// ---------------------------------------------------------------------------
// The solver

/** Iterates from the lowest given index; needs `order` consecutive conditions
 *  there. Any further condition is checked against the iteration. */
function iterate(p: Parsed, count: number): { base: number; vals: Rat[] } | null {
  if (!p.initial.size) return null;
  const base = Math.min(...p.initial.keys());
  const need = Array.from({ length: p.order }, (_, i) => base + i);
  if (!need.every((i) => p.initial.has(i))) return null;
  const vals: Rat[] = need.map((i) => p.initial.get(i) as Rat);
  for (let n = base + p.order; n < base + count; n++) {
    let v = R0;
    p.coeffs.forEach((c, i) => { v = v.add(c.mul(vals[n - base - i - 1])); });
    for (const f of p.forcing) v = v.add(f.coef.mul(Rat.of(n).pow(f.deg)).mul(f.base.pow(n)));
    vals.push(v);
  }
  for (const [k, given] of p.initial) {
    const idx = k - base;
    if (idx >= p.order && idx < vals.length && !vals[idx].eq(given)) {
      throw new DiscreteError(`${p.name}(${k}) is given as ${given}, but the recurrence and the earlier conditions give ${vals[idx]} — the conditions are inconsistent.`);
    }
  }
  return { base, vals };
}

function solveLinearRecurrence(p: Parsed): DiscreteResult {
  const { roots, D, exactField, numericNotes } = solveCharacteristic(p.coeffs);
  const display: string[] = [];
  const steps: string[] = [];
  const caveats: string[] = [];
  const name = p.name;
  const cp = charPoly(p.coeffs);
  steps.push(`Characteristic equation: ${cp.map((c, i) => { const d = cp.length - 1 - i; if (c.isZero()) return ""; const mag = new Rat(c.num < 0n ? -c.num : c.num, c.den); const body = d === 0 ? showRat(mag) : (mag.eq(R1) ? "" : showRat(mag)) + (d === 1 ? "r" : `r${sup(d)}`); return (c.num < 0n ? "− " : i === 0 ? "" : "+ ") + body; }).filter(Boolean).join(" ")} = 0`);
  const rootText = roots.map((r) => `${r.exact ? r.exact.toString() : CField.show(r.approx)}${r.radical ? ` = ${r.radical}` : ""}${r.mult > 1 ? ` (multiplicity ${r.mult})` : ""}`).join(", ");
  steps.push(`Roots: ${rootText}${exactField ? "" : ` (${[...new Set(numericNotes)].join("; ")})`}`);

  // Homogeneous basis: n^j r^n for each root r and j < mult.
  const basis: { root: RootInfo; j: number }[] = [];
  for (const r of roots) for (let j = 0; j < r.mult; j++) basis.push({ root: r, j });
  const rootMult = (b: Rat): number => roots.find((r) => (r.exact ? r.exact.b.isZero() && r.exact.a.eq(b) : Math.abs(r.approx.re - b.toNumber()) < 1e-12 && Math.abs(r.approx.im) < 1e-12))?.mult ?? 0;
  const parts = particular(p.coeffs, p.forcing, rootMult);

  const generalHom = joinSigned(basis.map((bs, i) => {
    const rs = bs.root.exact ? bs.root.exact.toString() : CField.show(bs.root.approx);
    return { neg: false, body: `C${sub(i + 1)}${bs.j ? `·${nPow(bs.j)}` : ""}·${/^\(.*\)$/.test(rs) ? rs : `(${rs})`}ⁿ` };
  }));
  const partText = joinSigned(parts.map((pt) => {
    const poly = showPolyRat(pt.poly, pt.m);
    const nonzero = pt.poly.filter((c) => !c.isZero()).length;
    if (pt.base.eq(R1)) return signedTerms(poly);
    const wrapped = nonzero > 1 ? `(${poly})` : poly.replace(/^−/, "");
    return [{ neg: nonzero === 1 && poly.startsWith("−"), body: `${wrapped}·(${showRat(pt.base)})ⁿ` }];
  }).flat());
  display.push(`General solution: ${name}(n) = ${joinSigned([...signedTerms(generalHom), ...signedTerms(partText)])}`);
  if (parts.length) steps.push(`Particular solution (undetermined coefficients${parts.some((pt) => pt.m) ? ", with an extra n-factor where the forcing base is a characteristic root — resonance" : ""}): ${partText}`);

  const it = iterate(p, 16);
  if (!it) {
    const have = [...p.initial.keys()].sort((a, b) => a - b);
    const from = have.length ? have[0] : 0;
    display.push(`Give ${p.order} consecutive initial condition${p.order > 1 ? "s" : ""} (${Array.from({ length: p.order }, (_, i) => `${name}(${from + i})`).join(", ")}) to fix the constants${have.length ? ` — only ${have.map((k) => `${name}(${k})`).join(", ")} given` : ""}.`);
    return { title: "Recurrence relation", display, steps, caveats };
  }
  const base = it.base;
  const terms = it.vals;
  const solveWith = <T>(F: Field<T>, rootVal: (r: RootInfo) => T): { consts: T[]; closed: (n: number) => T } => {
    const M: T[][] = [];
    const v: T[] = [];
    const partAt = (n: number): T => {
      let pv = F.zero;
      for (const pt of parts) {
        let poly = F.zero;
        pt.poly.forEach((c, j) => { poly = F.add(poly, F.mul(F.fromRat(c), F.fromRat(Rat.of(n).pow(pt.m + j)))); });
        pv = F.add(pv, F.mul(poly, F.fromRat(pt.base.pow(n))));
      }
      return pv;
    };
    for (let i = 0; i < basis.length; i++) {
      const n = base + i;
      M.push(basis.map((bs) => F.mul(F.fromRat(Rat.of(n).pow(bs.j)), F.pow(rootVal(bs.root), n))));
      v.push(F.sub(F.fromRat(terms[i]), partAt(n)));
    }
    const consts = solveLinear(F, M, v);
    if (!consts) throw new DiscreteError("The initial conditions do not determine the constants (singular system).");
    const closed = (n: number): T => {
      let s = F.zero;
      basis.forEach((bs, i) => { s = F.add(s, F.mul(F.mul(consts[i], F.fromRat(Rat.of(n).pow(bs.j))), F.pow(rootVal(bs.root), n))); });
      return F.add(s, partAt(n));
    };
    return { consts, closed };
  };

  let closedText: string;
  let verified = true;
  if (exactField) {
    const F = qnField(D ?? R0);
    const { consts, closed } = solveWith(F, (r) => new QN((r.exact as QN).a, (r.exact as QN).b, F.zero.D));
    closedText = joinSigned(basis.map((bs, i): Signed | null => {
      const c = consts[i];
      if (c.isZero()) return null;
      const root = bs.root.exact as QN;
      const rootS = root.b.isZero() ? showRat(root.a) : root.toString();
      // A constant with one non-zero part carries its sign to the join
      // (−3, or −1/5√5); a mixed one keeps its own parenthesised sign.
      const neg = (c.b.isZero() && c.a.num < 0n) || (c.a.isZero() && c.b.num < 0n);
      const mag = neg ? new QN(c.a.neg(), c.b.neg(), c.D) : c;
      const cs = mag.a.eq(R1) && mag.b.isZero() ? "" : `${mag.toString()}·`;
      // QN.toString already brackets a two-part root: no "((1/2 + √5/2))ⁿ".
      const base = /^\(.*\)$/.test(rootS) ? rootS : `(${rootS})`;
      return { neg, body: `${cs}${bs.j ? `${nPow(bs.j)}·` : ""}${base}ⁿ` };
    }).filter((x): x is Signed => x !== null));
    for (let i = 0; i < 16; i++) if (!F.close(closed(base + i), F.fromRat(terms[i]))) verified = false;
  } else {
    const { consts, closed } = solveWith(CField, (r) => r.approx);
    closedText = joinSigned(basis.map((bs, i): Signed | null => {
      const c = consts[i];
      if (CField.isZero(c)) return null;
      const neg = Math.abs(c.im) < 1e-9 && c.re < 0;
      const mag = neg ? { re: -c.re, im: c.im } : c;
      return { neg, body: `${CField.show(mag)}·${bs.j ? `${nPow(bs.j)}·` : ""}(${CField.show(bs.root.approx)})ⁿ` };
    }).filter((x): x is Signed => x !== null));
    for (let i = 0; i < 16; i++) if (!CField.close(closed(base + i), CField.fromRat(terms[i]))) verified = false;
    caveats.push("Numeric closed form (roots are not expressible exactly here); constants shown to 10 significant figures.");
    if (roots.some((r) => Math.abs(r.approx.im) > 1e-12)) caveats.push("Complex conjugate roots: the complex terms pair up into real cosines and sines; the real sequence is what the iteration shows.");
  }
  if (verified || exactField) {
    display.splice(0, 0, `${name}(n) = ${joinSigned([...signedTerms(closedText), ...signedTerms(partText)])}`);
  } else {
    // Floating-point constants from an ill-conditioned Vandermonde solve
    // (roots spanning many orders of magnitude): not an answer, so not shown.
    display.splice(0, 0, `${name}(n): closed form NOT shown — the numeric constants could not be determined reliably (the roots span too many orders of magnitude for double precision). The iterated terms below are exact.`);
  }
  display.push(`First terms${base ? ` (from ${name}(${base}))` : ""}: ${terms.slice(0, 12).map((t) => t.toString()).join(", ")}, …`);
  if (verified) steps.push(`Verified: the closed form reproduces ${name}(${base}) … ${name}(${base + 15}) from direct iteration${exactField ? " exactly" : " to 10⁻⁷"}.`);
  else if (exactField) caveats.push("CROSS-CHECK FAILED: the closed form does not reproduce the iterated terms — a defect in this tool; use the iterated terms.");
  if (exactField && D && !D.isZero()) caveats.push(`Exact in ℚ(√${D}); the irrational parts cancel in every term, which the verification confirms.`);
  return { title: "Recurrence relation", display, steps, caveats };
}

// ---------------------------------------------------------------------------
// Master theorem

function masterTheorem(name: string, a: Rat, b: Rat, fText: string): DiscreteResult {
  if (a.num <= 0n) throw new DiscreteError("a must be positive.");
  if (b.toNumber() <= 1) throw new DiscreteError("b must be greater than 1 (the subproblem must shrink).");
  // f(n) = c · n^k · (log n)^p
  const f = fText.replace(/\s+/g, "").replace(/−/g, "-").replace(/\*/g, "");
  let m: RegExpExecArray | null;
  let k: Rat;
  let pLog = 0;
  let c = R1;
  if (f === "0" || f === "") { k = R0; pLog = 0; c = R0; }
  else if ((m = /^(\d+(?:\/\d+)?|\d*\.\d+)?(?:n(?:\^(\d+(?:\/\d+)?))?)?(?:(?:\(log\(?n\)?\)|log\(?n\)?)(?:\^(\d+))?|log\^(\d+)\(?n\)?)?$/.exec(f)) && m[0] === f) {
    c = m[1] ? Rat.parse(m[1]) : R1;
    const hasN = /n/.test(f.replace(/log(?:\^\d+)?\(?n\)?/g, ""));
    k = hasN ? (m[2] ? Rat.parse(m[2]) : R1) : R0;
    pLog = /log/.test(f) ? (m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : 1) : 0;
  } else if ((m = /^(\d+)?sqrt\(?n\)?$/.exec(f))) { c = m[1] ? Rat.parse(m[1]) : R1; k = new Rat(1n, 2n); }
  else throw new DiscreteError(`The master theorem here needs f(n) of the form c·nᵏ·(log n)ᵖ (e.g. n, n^2, n log n, 1, sqrt n); "${fText}" is not.`);
  // E = log_b a, exact when a and b are integer powers of a common base.
  let E: Rat | null = null;
  if (a.eq(R1)) E = R0;
  if (E === null && a.isInt() && b.isInt()) {
    for (let q = 1; q <= 6 && E === null; q++) for (let p = 0; p <= 40; p++) {
      if (b.num ** BigInt(p) === a.num ** BigInt(q)) { E = new Rat(BigInt(p), BigInt(q)); break; }
    }
  }
  const Enum = Math.log(a.toNumber()) / Math.log(b.toNumber());
  const Etext = E ? E.toString() : Enum.toPrecision(4);
  const nE = E ? (E.isZero() ? "1" : E.eq(R1) ? "n" : `n^(${E})`) : `n^${Etext}`;
  const display: string[] = [];
  const fShape = `${k.isZero() ? "" : k.eq(R1) ? "n" : `n^${k}`}${pLog ? `${k.isZero() ? "" : " "}log${pLog > 1 ? `^${pLog}` : ""} n` : ""}${k.isZero() && !pLog ? "1" : ""}`;
  const steps = [`${name}(n) = ${showRat(a)}·${name}(n/${showRat(b)}) + ${fText || "0"}: a = ${showRat(a)}, b = ${showRat(b)}, log_b a = ${Etext}${E ? " (exact)" : " (≈)"}, f(n) = Θ(${fShape}).`];
  const caveats: string[] = ["Master theorem (CLRS form, with the extended case 2 for log factors). It says nothing about constants or lower-order terms, and the regularity condition in case 3 is checked for this polynomial-log f only."];
  const cmp = E ? (k.sub(E).num < 0n ? -1 : k.sub(E).num > 0n ? 1 : 0) : (k.toNumber() < Enum - 1e-12 ? -1 : k.toNumber() > Enum + 1e-12 ? 1 : 0);
  const logs = (p: number): string => (p === 0 ? "" : p === 1 ? " log n" : ` log${sup(p)} n`);
  // Θ(1 · log n) reads as Θ(log n).
  const theta = (base: string, l: string): string => `Θ(${base === "1" && l ? l.trim() : base + l})`;
  if (c.isZero()) {
    display.push(`${name}(n) = ${theta(nE, "")}`);
    steps.push("No work outside the recursive calls: the cost is the number of leaves, n^(log_b a).");
  } else if (cmp < 0) {
    display.push(`Case 1: f(n) is polynomially smaller than ${nE} — ${name}(n) = ${theta(nE, "")}`);
    steps.push(`k = ${k} < log_b a = ${Etext}: the leaves dominate (a^(log_b n) = ${nE} of them).`);
  } else if (cmp === 0) {
    display.push(`Case 2: f(n) = ${theta(nE, logs(pLog))} — ${name}(n) = ${theta(nE, logs(pLog + 1))}`);
    steps.push("k = log_b a: every one of the log_b n levels costs Θ(f(n)), so one more log factor.");
  } else {
    display.push(`Case 3: f(n) is polynomially larger than ${nE} — ${name}(n) = ${theta(k.isZero() ? "1" : k.eq(R1) ? "n" : `n^${k}`, logs(pLog))}`);
    steps.push(`k = ${k} > log_b a = ${Etext}; regularity a·f(n/b) ≤ c·f(n) holds since a/b^k = ${(a.toNumber() / Math.pow(b.toNumber(), k.toNumber())).toPrecision(4)} < 1: the root dominates.`);
  }
  steps.push(`Recursion tree: level i has a^i subproblems of size n/b^i; depth log_b n; leaves n^(log_b a) = ${nE}.`);
  return { title: "Master theorem", display, steps, caveats };
}

// ---------------------------------------------------------------------------

export function tryRecurrence(input: string): DiscreteResult | null {
  const text = input.trim();
  if (!text) return null;
  if (!/[A-Za-z]\w*\s*(?:\(\s*n\s*\)|_n|_\{n\}|\[\s*n\s*\])\s*=/.test(text.replace(/−/g, "-"))) return null;
  const parsed = parseRecurrence(text);
  if (!parsed) return null;
  if ("master" in parsed) return masterTheorem(parsed.master.name, parsed.master.a, parsed.master.b, parsed.master.f);
  return solveLinearRecurrence(parsed);
}
