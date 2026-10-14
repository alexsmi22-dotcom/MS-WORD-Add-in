// Symbolic integration — CAS-DESIGN.md Release 2.
//
// Deliberately built second, because the three techniques here all stand on
// Release 1's canonical form:
//
//   * SUBSTITUTION needs canonical equality to recognise that a factor of the
//     integrand IS g'(x) for some inner g, and to replace every occurrence of
//     g by a fresh symbol;
//   * PARTIAL FRACTIONS needs exact-rational polynomial division and factoring
//     (cas.ts's Rat toolkit) — float coefficients would make a root test
//     unreliable at the 15th digit;
//   * and the CORRECTNESS NET is canonical equality itself: every antiderivative
//     this module produces is DIFFERENTIATED BACK and compared to the integrand
//     in canonical form. A candidate that does not match is discarded, not
//     returned. That makes aggressive heuristics safe — the worst outcome of a
//     wrong guess is falling back to numeric quadrature, never a wrong answer.
//
// The verification is the whole reason this module can be bold. Everything it
// returns has been checked; everything it cannot check, it refuses.
//
// `deriv` is injected rather than imported so this module stays free of a
// runtime cycle with solve.ts (which imports it).

import type { Expr } from "./solve";
import {
  casSimplify, CasBail, exprEqual, substituteVar,
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratIsOne,
  ratToExpr, ratSign, RAT_ZERO, RAT_ONE,
  ratFunctionInVar, ratPolyToExpr, ratPolyAdd, ratPolyMul, ratPolyScale, ratPolyTrim,
  ratPolyDivMod, ratPolyRoots, ratToNumber, ratEq, polyInVar, ratPolyEval } from "./cas";

type Deriv = (e: Expr, x: string) => Expr;

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });
const ZERO = N(0);

/** Canonical simplification that never throws (falls back to the input). */
function simp(e: Expr): Expr {
  try {
    return casSimplify(e);
  } catch (err) {
    if (err instanceof CasBail) return e;
    throw err;
  }
}

const add = (l: Expr, r: Expr): Expr => simp({ t: "add", l, r });
const sub = (l: Expr, r: Expr): Expr => simp({ t: "sub", l, r });
const mul = (l: Expr, r: Expr): Expr => simp({ t: "mul", l, r });
const div = (l: Expr, r: Expr): Expr => simp({ t: "div", l, r });
const neg = (e: Expr): Expr => simp({ t: "neg", e });
const pow = (l: Expr, r: Expr): Expr => simp({ t: "pow", l, r });
const fn = (name: string, arg: Expr): Expr => ({ t: "fn", name, arg });
const lnAbs = (u: Expr): Expr => fn("ln", fn("abs", u));

function mentions(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num": return false;
    case "var": return e.name === x;
    case "neg": return mentions(e.e, x);
    case "fn": return mentions(e.arg, x);
    default: return mentions(e.l, x) || mentions(e.r, x);
  }
}

const isZero = (e: Expr): boolean => exprEqual(e, ZERO) === true;

/** Elementary antiderivatives F with F' = f, for f applied to a bare symbol. */
const FN_INTEGRAL: Record<string, (u: Expr) => Expr> = {
  sin: (u) => neg(fn("cos", u)),
  cos: (u) => fn("sin", u),
  exp: (u) => fn("exp", u),
  sinh: (u) => fn("cosh", u),
  cosh: (u) => fn("sinh", u),
  tan: (u) => neg(lnAbs(fn("cos", u))),
  tanh: (u) => fn("ln", fn("cosh", u)),
};

/** Functions integrable by parts against dv = 1 (their derivative is algebraic). */
const BY_PARTS_SOLO = new Set(["ln", "log", "log2", "log10", "atan", "asin", "acos"]);

/** A fresh symbol for substitution; `_` prefixed so it cannot collide with user input. */
const U = "_u";

/**
 * Replaces every subexpression canonically equal to `g` with the variable
 * `name`. Deepest-first is wrong here — we want the LARGEST match, so each
 * node is tested before its children are visited.
 */
function replaceCanonical(e: Expr, g: Expr, name: string): Expr {
  if (exprEqual(e, g) === true) return V(name);
  switch (e.t) {
    case "num": case "var": return e;
    case "neg": return { t: "neg", e: replaceCanonical(e.e, g, name) };
    case "fn": return { t: "fn", name: e.name, arg: replaceCanonical(e.arg, g, name) };
    default:
      return { t: e.t, l: replaceCanonical(e.l, g, name), r: replaceCanonical(e.r, g, name) } as Expr;
  }
}

/** Inner subexpressions worth trying as a substitution u = g(x). */
function substitutionCandidates(e: Expr, x: string, out: Expr[] = []): Expr[] {
  const push = (c: Expr) => {
    if (!mentions(c, x)) return;
    if (c.t === "var") return; // u = x is the identity substitution
    if (out.some((o) => exprEqual(o, c) === true)) return;
    out.push(c);
  };
  switch (e.t) {
    case "fn":
      // Both the argument (u = x² in cos(x²)) and the call itself
      // (u = sin(x) in sin(x)·cos(x), where du = cos(x) dx).
      push(e.arg);
      push(e);
      substitutionCandidates(e.arg, x, out);
      break;
    case "pow":
      push(e.l);
      push(e);
      substitutionCandidates(e.l, x, out);
      substitutionCandidates(e.r, x, out);
      break;
    case "mul":
      // Each factor of a product is a candidate in its own right.
      push(e.l);
      push(e.r);
      substitutionCandidates(e.l, x, out);
      substitutionCandidates(e.r, x, out);
      break;
    case "div":
      push(e.r); // u = denominator catches g'/g → ln|g|
      substitutionCandidates(e.l, x, out);
      substitutionCandidates(e.r, x, out);
      break;
    case "neg":
      substitutionCandidates(e.e, x, out);
      break;
    case "num": case "var":
      break;
    default:
      substitutionCandidates(e.l, x, out);
      substitutionCandidates(e.r, x, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Partial fractions over exact rationals.
// ---------------------------------------------------------------------------

/** One basis term of a partial-fraction decomposition. */
type PFTerm =
  | { kind: "linear"; root: Rat; power: number }
  | { kind: "quadratic"; b: Rat; c: Rat; power: number }; // (x² + b·x + c)^power, irreducible over ℚ

/** A solved decomposition: num/den = polyPart + Σ A/(x−r)^k + Σ (Bx+C)/(x²+bx+c)^k. */
export interface PartialFractions {
  polyPart: Rat[];
  terms: ({ kind: "linear"; root: Rat; power: number; A: Rat } | { kind: "quadratic"; b: Rat; c: Rat; power: number; B: Rat; C: Rat })[];
  /** Why no decomposition was produced (null when terms are valid). */
  refusal?: string;
}

/**
 * Monic quadratic factors of a polynomial over ℚ, with multiplicity, by
 * bounded trial division: scaled to a primitive integer polynomial, every
 * quadratic factor can be taken with integer coefficients (Gauss), its
 * leading coefficient dividing the leading coefficient, its constant term
 * dividing the constant term, and its middle coefficient bounded by the
 * Cauchy root bound. Returns the factors found and the cofactor; a cofactor
 * of degree 3 or 4 left over is then irreducible over ℚ (it has no rational
 * root and no quadratic factor), while one of degree ≥ 5 merely has no factor
 * of degree ≤ 2 — the caller words those differently.
 */
export function quadraticFactorsOverQ(pIn: Rat[]): { factors: { b: Rat; c: Rat; mult: number }[]; rest: Rat[]; capped: boolean } {
  let p = ratPolyTrim(pIn);
  const factors: { b: Rat; c: Rat; mult: number }[] = [];
  let capped = false;
  const bAbs = (n: bigint): bigint => (n < 0n ? -n : n);
  const bGcd = (a: bigint, b: bigint): bigint => { a = bAbs(a); b = bAbs(b); while (b) [a, b] = [b, a % b]; return a; };
  const smallDivisors = (v: bigint): bigint[] => {
    v = bAbs(v);
    if (v === 0n) return [1n];
    const out = new Set<bigint>();
    let i = 1n;
    for (; i * i <= v && i <= 20000n; i++) if (v % i === 0n) { out.add(i); out.add(v / i); }
    if (i * i <= v) capped = true;
    return [...out];
  };
  let budget = 60000;
  while (p.length >= 4) {
    // Primitive integer form.
    let lcm = 1n;
    for (const c of p) lcm = (lcm / bGcd(lcm, c.d)) * c.d;
    let ints = p.map((c) => (c.n * lcm) / c.d);
    let content = 0n;
    for (const v of ints) content = bGcd(content, v);
    if (content > 1n) ints = ints.map((v) => v / content);
    const n = ints.length - 1;
    const an = ints[n];
    let a0 = ints[0];
    if (a0 === 0n) break; // a rational root (x = 0) — the caller handles those first
    const R = 1 + Math.max(...ints.slice(0, n).map((v) => Number(bAbs(v)) / Number(bAbs(an))));
    let found: { b: Rat; c: Rat } | null = null;
    outer: for (const a of smallDivisors(an)) {
      const bMax = BigInt(Math.ceil(2 * Number(a) * R)) + 1n;
      for (const cAbsV of smallDivisors(a0)) {
        for (const cc of [cAbsV, -cAbsV]) {
          for (let b = -bMax; b <= bMax; b++) {
            if (--budget < 0) { capped = true; break outer; }
            const q: Rat[] = [ratMake(cc, 1n), ratMake(b, 1n), ratMake(a, 1n)];
            const { r } = ratPolyDivMod(p, q);
            if (!ratPolyTrim(r).length) { found = { b: ratMake(b, a), c: ratMake(cc, a) }; break outer; }
          }
        }
      }
    }
    if (!found) break;
    const q: Rat[] = [found.c, found.b, RAT_ONE];
    let mult = 0;
    for (;;) {
      const { q: quo, r } = ratPolyDivMod(p, q);
      if (ratPolyTrim(r).length) break;
      p = ratPolyTrim(quo);
      mult++;
    }
    factors.push({ b: found.b, c: found.c, mult });
    a0 = 0n;
  }
  return { factors, rest: p, capped };
}

/**
 * Partial fractions over ℚ: rational roots of the denominator (with
 * multiplicity) and one remaining quadratic. A remaining factor of degree
 * three or more that has no rational root is refused BY NAME — splitting it
 * would need algebraic numbers, and guessing is worse than refusing.
 */
export function partialFractionDecompose(numIn: Rat[], denIn: Rat[]): PartialFractions | null {
  let num = ratPolyTrim(numIn);
  const den = ratPolyTrim(denIn);
  if (!den.length || den.length === 1) return null;
  let polyPart: Rat[] = [];
  if (num.length >= den.length) {
    const { q, r } = ratPolyDivMod(num, den);
    polyPart = q;
    num = ratPolyTrim(r);
  }
  if (!num.length) return { polyPart, terms: [] };
  const { roots, rest, incomplete } = ratPolyRoots(den);
  const terms: PFTerm[] = [];
  for (const { root, mult } of roots) for (let k = 1; k <= mult; k++) terms.push({ kind: "linear", root, power: k });
  let restT = ratPolyTrim(rest);
  if (incomplete && restT.length > 1) {
    return { polyPart, terms: [], refusal: `the rational-root search for the denominator was capped (its coefficients are too large to factor exhaustively), so the factorisation over ℚ is not established` };
  }
  if (restT.length === 3) {
    const a2 = restT[2];
    terms.push({ kind: "quadratic", b: ratDiv(restT[1], a2), c: ratDiv(restT[0], a2), power: 1 });
    restT = [];
  } else if (restT.length > 3) {
    const qf = quadraticFactorsOverQ(restT);
    for (const f of qf.factors) for (let k = 1; k <= f.mult; k++) terms.push({ kind: "quadratic", b: f.b, c: f.c, power: k });
    restT = ratPolyTrim(qf.rest);
    if (restT.length === 3) { const a2 = restT[2]; terms.push({ kind: "quadratic", b: ratDiv(restT[1], a2), c: ratDiv(restT[0], a2), power: 1 }); restT = []; }
    if (restT.length > 1) {
      const d = restT.length - 1;
      const why = qf.capped
        ? `the search for quadratic factors of a degree-${d} factor of the denominator was capped (coefficients too large)`
        : d <= 4
          ? `the denominator has a factor of degree ${d} that is irreducible over ℚ (no rational root, no quadratic factor with rational coefficients); splitting it needs algebraic numbers, which this tool does not invent`
          : `the denominator has a factor of degree ${d} with no rational root and no quadratic factor with rational coefficients; splitting it would need algebraic numbers or a factor of higher degree, which this tool does not search for`;
      return { polyPart, terms: [], refusal: why };
    }
  }
  if (!terms.length) return null;
  const unknownCount = terms.reduce((s, t) => s + (t.kind === "linear" ? 1 : 2), 0);
  const degDen = den.length - 1;
  if (unknownCount !== degDen) return null;
  const cols: Rat[][] = [];
  for (const t of terms) {
    if (t.kind === "linear") {
      let acc: Rat[] = [RAT_ONE];
      for (let k = 0; k < t.power; k++) acc = ratPolyMul(acc, [ratNeg(t.root), RAT_ONE]);
      const { q, r } = ratPolyDivMod(den, acc);
      if (r.length) return null;
      cols.push(q);
    } else {
      let acc: Rat[] = [RAT_ONE];
      for (let k = 0; k < t.power; k++) acc = ratPolyMul(acc, [t.c, t.b, RAT_ONE]);
      const { q, r } = ratPolyDivMod(den, acc);
      if (r.length) return null;
      cols.push(ratPolyMul(q, [RAT_ZERO, RAT_ONE]));
      cols.push(q);
    }
  }
  const A: Rat[][] = [];
  for (let r = 0; r < degDen; r++) A.push(cols.map((col) => col[r] ?? RAT_ZERO));
  const rhs: Rat[] = [];
  for (let r = 0; r < degDen; r++) rhs.push(num[r] ?? RAT_ZERO);
  const sol = solveExact(A, rhs);
  if (!sol) return null;
  const out: PartialFractions["terms"] = [];
  let si = 0;
  for (const t of terms) {
    if (t.kind === "linear") out.push({ kind: "linear", root: t.root, power: t.power, A: sol[si++] });
    else { const B = sol[si++]; const C = sol[si++]; out.push({ kind: "quadratic", b: t.b, c: t.c, power: t.power, B, C }); }
  }
  // Self-check: the pieces must recombine to num/den exactly.
  let recombined: Rat[] = [];
  let ci = 0;
  for (const t of out) {
    if (t.kind === "linear") recombined = ratPolyAdd(recombined, ratPolyScale(cols[ci++], t.A));
    else { recombined = ratPolyAdd(recombined, ratPolyScale(cols[ci++], t.B)); recombined = ratPolyAdd(recombined, ratPolyScale(cols[ci++], t.C)); }
  }
  const numT = ratPolyTrim(num), recT = ratPolyTrim(recombined);
  if (numT.length !== recT.length || !numT.every((c, i) => ratEq(c, recT[i]))) return null;
  return { polyPart, terms: out };
}

/** Exact Gaussian elimination; returns null if singular. */
function solveExact(A: Rat[][], rhs: Rat[]): Rat[] | null {
  const n = rhs.length;
  const m = A.map((row, i) => [...row, rhs[i]]);
  for (let col = 0, row = 0; col < n && row < n; col++, row++) {
    let piv = -1;
    for (let r = row; r < n; r++) if (!ratIsZero(m[r][col])) { piv = r; break; }
    if (piv < 0) return null;
    [m[row], m[piv]] = [m[piv], m[row]];
    const p = m[row][col];
    for (let c = col; c <= n; c++) m[row][c] = ratDiv(m[row][c], p);
    for (let r = 0; r < n; r++) {
      if (r === row || ratIsZero(m[r][col])) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] = ratSub(m[r][c], ratMul(f, m[row][c]));
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Decomposes num/den into partial fractions over the rationals and integrates
 * each piece. Returns null when the denominator cannot be split into rational
 * linear factors and irreducible quadratics (higher irreducible factors are
 * refused rather than approximated).
 */
function integrateRational(numIn: Rat[], denIn: Rat[], x: string): Expr | null {
  let num = ratPolyTrim(numIn);
  const den = ratPolyTrim(denIn);
  if (!den.length) return null;
  if (!num.length) return ZERO;
  if (den.length === 1) {
    // Constant denominator: a plain polynomial integral.
    return integratePolynomial(num.map((c) => ratDiv(c, den[0])), x);
  }

  // Improper fraction: divide first, integrate the polynomial part separately.
  let polyPart: Expr = ZERO;
  if (num.length >= den.length) {
    const { q, r } = ratPolyDivMod(num, den);
    polyPart = integratePolynomial(q, x);
    num = r;
    if (!num.length) return polyPart;
  }

  // Factor the denominator: rational roots with multiplicity, then whatever is left.
  const { roots, rest } = ratPolyRoots(den);
  const terms: PFTerm[] = [];
  for (const { root, mult } of roots) {
    for (let k = 1; k <= mult; k++) terms.push({ kind: "linear", root, power: k });
  }
  const restT = ratPolyTrim(rest);
  if (restT.length === 3) {
    // Monic-ise: x² + b x + c. Irreducible over ℝ is not required (a real-root
    // quadratic would have been caught above only if its roots were rational —
    // an irrational-root quadratic still integrates via the same formulas, with
    // the completed square giving a real 's'; that case is handled below).
    const a2 = restT[2];
    terms.push({ kind: "quadratic", b: ratDiv(restT[1], a2), c: ratDiv(restT[0], a2), power: 1 });
  } else if (restT.length > 1) {
    return null; // an unfactored cubic-or-higher: refuse rather than guess
  }
  if (!terms.length) return null;

  // Unknowns: one per linear term, two per quadratic term.
  const unknownCount = terms.reduce((s, t) => s + (t.kind === "linear" ? 1 : 2), 0);
  const degDen = den.length - 1;
  if (unknownCount !== degDen) return null;

  // Build the basis polynomials: den divided by this term's factor.
  const basis: Rat[][] = [];
  for (const t of terms) {
    let factor: Rat[];
    if (t.kind === "linear") {
      factor = [ratNeg(t.root), RAT_ONE]; // (x − root)
      let acc: Rat[] = [RAT_ONE];
      for (let k = 0; k < t.power; k++) acc = ratPolyMul(acc, factor);
      const { q, r } = ratPolyDivMod(den, acc);
      if (r.length) return null;
      basis.push(q);
    } else {
      const quad: Rat[] = [t.c, t.b, RAT_ONE];
      const { q, r } = ratPolyDivMod(den, quad);
      if (r.length) return null;
      basis.push(q);               // coefficient of B·x → x·q
      basis.push(q);               // coefficient of C   → q     (shifted below)
    }
  }

  // Coefficient-matching system: Σ unknown_i · basisPoly_i = num.
  const cols: Rat[][] = [];
  let bi = 0;
  for (const t of terms) {
    if (t.kind === "linear") {
      cols.push(basis[bi++]);
    } else {
      const q = basis[bi];
      bi += 2;
      cols.push(ratPolyMul(q, [RAT_ZERO, RAT_ONE])); // B·x·q
      cols.push(q);                                  // C·q
    }
  }
  const rows = degDen;
  const A: Rat[][] = [];
  for (let r = 0; r < rows; r++) {
    A.push(cols.map((col) => col[r] ?? RAT_ZERO));
  }
  const rhs: Rat[] = [];
  for (let r = 0; r < rows; r++) rhs.push(num[r] ?? RAT_ZERO);
  const sol = solveExact(A, rhs);
  if (!sol) return null;

  // Integrate each basis term.
  let out: Expr = polyPart;
  const exactAtan: Expr[] = [];
  let si = 0;
  // NO EXTRA SCALING. The leading coefficient is ALREADY ACCOUNTED FOR.
  //
  // The factors below are built MONIC — (x - root) and x^2 + bx + c — so each basis
  // polynomial is den/f_i and carries den's leading coefficient with it. The
  // coefficient-matching system then solves num = SUM A_i * (den/f_i), which means
  // num/den = SUM A_i/f_i exactly. Dividing again by the leading coefficient makes
  // the answer wrong by that factor, the self-verification gate correctly rejects
  // it, and symbolicIntegrate returns null.
  //
  // The effect was a silently LOST CAPABILITY rather than a wrong number, and the
  // reason no test caught it is that every monic sibling works — and every existing
  // test used a monic denominator. Refused before this: 1/(2x+3), 1/(4x^2-1),
  // 1/(3x^2+5x+2), x/(2x+1), 1/(9x^2+1), 1/(6x^2-5x+1), 5/(2x^2+3x+1),
  // 1/(4x^2+4x+2), 1/(3-2x). All elementary.
  //
  // Worked through for 1/(2x+3): the single factor is (x + 3/2), the basis is
  // [2], so 2*A0 = 1 and A0 = 1/2, giving (1/2)*ln|x + 3/2| — whose derivative is
  // (1/2)/(x + 3/2) = 1/(2x+3). Correct. With the extra division it came out as
  // (1/4)*ln|x + 3/2|, wrong by two.
  //
  // Consistency note: polyPart above was never scaled, so improper fractions were
  // scaled inconsistently with proper ones. Removing this removes that too.
  const scale = (e: Expr): Expr => e;
  for (const t of terms) {
    if (t.kind === "linear") {
      const A0 = sol[si++];
      if (ratIsZero(A0)) continue;
      const shifted: Expr = ratIsZero(t.root) ? V(x) : sub(V(x), ratToExpr(t.root));
      if (t.power === 1) {
        out = add(out, scale(mul(ratToExpr(A0), lnAbs(shifted))));
      } else {
        // ∫ A/(x−r)^k dx = −A/((k−1)(x−r)^(k−1))
        const k = t.power;
        out = add(out, scale(neg(div(ratToExpr(A0), mul(N(k - 1), pow(shifted, N(k - 1)))))));
      }
    } else {
      const B = sol[si++];
      const C = sol[si++];
      const quadExpr = add(add(pow(V(x), N(2)), mul(ratToExpr(t.b), V(x))), ratToExpr(t.c));
      // ∫ (Bx + C)/(x² + bx + c) dx
      //   = (B/2)·ln(x² + bx + c) + (C − Bb/2)·∫ dx/((x + b/2)² + s²)
      if (!ratIsZero(B)) {
        out = add(out, scale(mul(div(ratToExpr(B), N(2)), fn("ln", fn("abs", quadExpr)))));
      }
      const rest2 = ratSub(C, ratDiv(ratMul(B, t.b), ratInt(2)));
      if (ratIsZero(rest2)) continue;
      // s² = c − b²/4
      const s2 = ratSub(t.c, ratDiv(ratMul(t.b, t.b), ratInt(4)));
      const shift = add(V(x), ratToExpr(ratDiv(t.b, ratInt(2))));
      if (ratSign(s2) > 0) {
        // (C − Bb/2)/s · atan((x + b/2)/s), s = √s2 — kept EXACT (v2.136.0):
        // through the simplifier sqrt(2) became 0.707106781187. A rational s
        // may be simplified; an irrational one is assembled raw and appended
        // after every simplified piece (exactAtan) so nothing folds it.
        const inv = ratSqrtExpr(ratDiv(RAT_ONE, s2)); // 1/s
        if (!hasSqrt(inv)) {
          out = add(out, scale(mul(mul(ratToExpr(rest2), inv), fn("atan", mul(inv, shift)))));
        } else {
          // coefficient rest2/s = ±√(rest2²/s2), one radical rather than (1/2)·sqrt(6)/3
          const mag = ratSqrtExpr(ratDiv(ratMul(rest2, rest2), s2));
          const coef: Expr = ratSign(rest2) < 0 ? { t: "neg", e: mag } : mag;
          exactAtan.push({ t: "mul", l: coef, r: fn("atan", { t: "mul", l: inv, r: shift }) });
        }
      } else if (ratSign(s2) < 0) {
        // Real distinct irrational roots: (1/2s)·ln|(u − s)/(u + s)|
        const s = fn("sqrt", ratToExpr(ratNeg(s2)));
        out = add(
          out,
          scale(mul(div(ratToExpr(rest2), mul(N(2), s)), lnAbs(div(sub(shift, s), add(shift, s)))))
        );
      } else {
        // Repeated real root: ∫ du/u² = −1/u
        out = add(out, scale(neg(div(ratToExpr(rest2), shift))));
      }
    }
  }
  for (const t of exactAtan) out = isZero(out) ? t : { t: "add", l: out, r: t };
  return out;
}

/** ∫ of an exact-rational polynomial, term by term. */
function integratePolynomial(coeffs: Rat[], x: string): Expr {
  const out: Rat[] = [RAT_ZERO];
  coeffs.forEach((c, k) => {
    out[k + 1] = ratDiv(c, ratInt(k + 1));
    for (let i = 0; i <= k; i++) if (out[i] === undefined) out[i] = RAT_ZERO;
  });
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = RAT_ZERO;
  return ratPolyToExpr(ratPolyTrim(out), x);
}

// ---------------------------------------------------------------------------
// The recursive integrator.
// ---------------------------------------------------------------------------

const MAX_DEPTH = 5;

function integ(e0: Expr, x: string, deriv: Deriv, depth: number): Expr | null {
  if (depth > MAX_DEPTH) return null;
  const e = simp(e0);

  // A subexpression free of x integrates to c·x.
  if (!mentions(e, x)) return mul(e, V(x));

  switch (e.t) {
    case "var":
      return div(pow(V(x), N(2)), N(2));
    case "neg": {
      const a = integ(e.e, x, deriv, depth);
      return a ? neg(a) : null;
    }
    case "add": case "sub": {
      const l = integ(e.l, x, deriv, depth);
      if (!l) break;
      const r = integ(e.r, x, deriv, depth);
      if (!r) break;
      return e.t === "add" ? add(l, r) : sub(l, r);
    }
    case "mul": {
      // Constant factors pull straight out.
      if (!mentions(e.l, x)) {
        const r = integ(e.r, x, deriv, depth);
        if (r) return mul(e.l, r);
      }
      if (!mentions(e.r, x)) {
        const l = integ(e.l, x, deriv, depth);
        if (l) return mul(e.r, l);
      }
      break;
    }
    case "div": {
      if (!mentions(e.r, x)) {
        const l = integ(e.l, x, deriv, depth);
        if (l) return div(l, e.r);
      }
      // An x-free numerator pulls out: y/((x − 0.3)² + ε) is y·∫1/(…) — the
      // partial-fraction path cannot see past the symbol y in the numerator.
      if (!mentions(e.l, x) && symbolsOf(e.l).size > 0 && depth < MAX_DEPTH) {
        const r = integ({ t: "div", l: N(1), r: e.r }, x, deriv, depth + 1);
        if (r) return mul(e.l, r);
      }
      break;
    }
    case "pow": {
      if (!mentions(e.r, x) && e.l.t === "var" && e.l.name === x) {
        const p = e.r;
        // ∫ x^n dx = x^(n+1)/(n+1), except n = −1 → ln|x|
        if (isZero(add(p, N(1)))) return lnAbs(V(x));
        return div(pow(V(x), add(p, N(1))), add(p, N(1)));
      }
      if (!mentions(e.l, x) && e.r.t === "var" && e.r.name === x) {
        // ∫ a^x dx = a^x / ln(a)
        return div(e, fn("ln", e.l));
      }
      break;
    }
    case "fn": {
      const F = FN_INTEGRAL[e.name];
      if (F && e.arg.t === "var" && e.arg.name === x) return F(V(x));
      if (e.name === "sqrt" && e.arg.t === "var" && e.arg.name === x) {
        return div(mul(N(2), pow(V(x), div(N(3), N(2)))), N(3));
      }
      break;
    }
  }

  // Rational function in x alone → partial fractions.
  const rf = ratFunctionInVar(e, x);
  if (rf) {
    const viaPF = integrateRational(rf.num, rf.den, x);
    if (viaPF) return viaPF;
  }

  // k/√(A·x² + B·x + C) with A < 0 → an arcsine (v2.136.0; before it, even
  // ∫ 1/√(1 − x²) fell to numeric quadrature).
  const viaAsin = tryArcsine(e, x, deriv, depth);
  if (viaAsin) return viaAsin;

  // k/(A·x² + k′·a²) with a symbol a: the atan twin of √(a² − x²).
  const viaAtan = tryArctanSymbolic(e, x, deriv);
  if (viaAtan) return viaAtan;

  // Substitution: e = h(g(x))·g'(x).
  const viaSub = trySubstitution(e, x, deriv, depth);
  if (viaSub) return viaSub;

  // Power reduction: sin²/cos² rewritten via the double angle — the identity
  // canonical form cannot prove is APPLIED instead, and the differentiate-back
  // gate downstream still owns correctness.
  const viaTrigPower = tryTrigPower(e, x, deriv, depth);
  if (viaTrigPower) return viaTrigPower;

  // Cyclic-by-parts family: ∫e^(ax+b)·sin/cos(cx+d) in closed form. Plain
  // by-parts loops on these (each pass returns the original integral), which
  // is why they were refused for so long.
  const viaExpTrig = tryExpTrig(e, x, deriv);
  if (viaExpTrig) return viaExpTrig;

  // Integration by parts.
  const viaParts = tryByParts(e, x, deriv, depth);
  if (viaParts) return viaParts;

  return null;
}

// ---------------------------------------------------------------------------
// The arcsine rule: ∫ k/√(A·x² + B·x + C) dx with A < 0.
// ---------------------------------------------------------------------------

/**
 * Notes the rules attach to an antiderivative (a domain of validity, an
 * equivalent form). Collected per symbolicIntegrate call — the recursion is
 * synchronous, so a module-level list cannot leak between calls.
 */
let pendingNotes: string[] = [];
/** Parameters a rule ASSUMED positive; the verification gate binds them (and only them). */
let pendingPositive = new Set<string>();
/** Sample points inside a rule's stated domain, for the gate's fallback only. */
let pendingSamples: number[] = [];

/** Free symbols of e other than pi and e. */
function symbolsOf(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.t) {
    case "num": return out;
    case "var": if (e.name !== "pi" && e.name !== "e") out.add(e.name); return out;
    case "neg": return symbolsOf(e.e, out);
    case "fn": return symbolsOf(e.arg, out);
    default: symbolsOf(e.l, out); return symbolsOf(e.r, out);
  }
}

/**
 * √(k·a² − b·x²) with b, k positive rationals and a ONE symbol: the radicand
 * of ∫ 1/√(a² − x²) = asin(x/a). Recognised by derivatives (Q″/2 = −b, Q′(0)
 * = 0, Q(0) = k·a²) and confirmed by exprEqual(Q, k·a² − b·x²).
 */
function symbolicRadicand(q: Expr, x: string, deriv: Deriv): { b: Rat; h: Rat; scale: Expr; halfWidth: string; param: string } | null {
  try {
    const d1 = simp(deriv(q, x));
    const d2 = simp(deriv(d1, x));
    if (symbolsOf(d2).size || mentions(d2, x)) return null;
    const d2v = evalNumeric(d2, {});
    if (!Number.isInteger(d2v) || d2v >= 0 || Math.abs(d2v) > 1e9) return null;
    const b = ratMake(BigInt(-d2v), 2n);
    if (!isZero(simp(substituteVar(d1, x, ZERO)))) return null;
    const C = simp(substituteVar(q, x, ZERO));
    const syms = [...symbolsOf(C)];
    if (syms.length !== 1 || syms[0] === x) return null;
    const a = syms[0];
    const kE0 = simp(div(C, pow(V(a), N(2))));
    if (symbolsOf(kE0).size) return null;
    const kv = evalNumeric(kE0, {});
    if (!Number.isInteger(kv) || kv <= 0 || kv > 1e9) return null;
    const kE = N(kv);
    const k = ratInt(kv);
    if (exprEqual(q, sub(mul(kE, pow(V(a), N(2))), mul(ratToExpr(b), pow(V(x), N(2))))) !== true) return null;
    const s = ratSqrtExpr(ratDiv(b, k)); // √(b/k); the scale is √(b/k)/a
    const scale: Expr = hasSqrt(s) ? { t: "div", l: s, r: V(a) } : div(s, V(a));
    const w = ratSqrtExpr(ratDiv(k, b));
    const halfWidth = isOne(w) ? a : `${format0(w)}*${a}`;
    return { b, h: RAT_ZERO, scale, halfWidth, param: a };
  } catch {
    return null;
  }
}

/** ⌊√n⌋ for a non-negative bigint. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/** n = out²·inside with `inside` free of small square factors (trial division, bounded). */
function splitSquare(n: bigint): { out: bigint; inside: bigint } {
  let out = 1n;
  let inside = n;
  for (let p = 2n; p * p <= inside && p < 2000n; p++) {
    while (inside % (p * p) === 0n) {
      inside /= p * p;
      out *= p;
    }
  }
  const r = isqrt(inside);
  if (r * r === inside) {
    out *= r;
    inside = 1n;
  }
  return { out, inside };
}

/**
 * √q for a positive rational, EXACTLY: a rational when q is a square, else
 * (a/d)·sqrt(m) built from raw nodes. It must NOT pass through casSimplify,
 * which folds sqrt of a constant into a float-derived rational.
 */
function ratSqrtExpr(q: Rat): Expr {
  // √(n/d) = √(n·d)/d
  const { out, inside } = splitSquare(q.n * q.d);
  const coef = ratMake(out, q.d);
  if (inside === 1n) return ratToExpr(coef);
  const root: Expr = { t: "fn", name: "sqrt", arg: N(Number(inside)) };
  if (ratIsOne(coef)) return root;
  if (coef.n === 1n) return { t: "div", l: root, r: N(Number(coef.d)) };
  return { t: "div", l: { t: "mul", l: N(Number(coef.n)), r: root }, r: N(Number(coef.d)) };
}

/** The radicands of x-dependent square roots in e: sqrt(u) and u^(±1/2). */
function sqrtRadicands(e: Expr, x: string, out: Expr[] = []): Expr[] {
  const push = (u: Expr) => {
    if (mentions(u, x) && !out.some((o) => exprEqual(o, u) === true)) out.push(u);
  };
  switch (e.t) {
    case "num": case "var": return out;
    case "neg": return sqrtRadicands(e.e, x, out);
    case "fn":
      if (e.name === "sqrt") push(e.arg);
      return sqrtRadicands(e.arg, x, out);
    case "pow": {
      if (!mentions(e.r, x)) {
        let p = NaN;
        try { p = evalNumeric(e.r, {}); } catch { /* not a number */ }
        if (Math.abs(Math.abs(p) - 0.5) < 1e-15) push(e.l);
      }
      sqrtRadicands(e.l, x, out);
      return sqrtRadicands(e.r, x, out);
    }
    default:
      sqrtRadicands(e.l, x, out);
      return sqrtRadicands(e.r, x, out);
  }
}

/**
 * ∫ k/√Q(x) dx with Q = A·x² + B·x + C over ℚ, A < 0 and Q positive at its
 * vertex h = −B/(2A). Completing the square, Q = Q(h) − b·(x − h)² with
 * b = −A > 0, so
 *
 *     ∫ k/√Q dx = (k/√b)·asin(√(b/Q(h))·(x − h)),   valid for |x − h| < √(Q(h)/b).
 *
 * k must be free of x. The candidate goes through symbolicIntegrate's
 * differentiate-back gate like every other one; the radicals are kept exact
 * (raw sqrt nodes) rather than folded to floats.
 */
function tryArcsine(e: Expr, x: string, deriv: Deriv, depth: number): Expr | null {
  for (const q of sqrtRadicands(e, x)) {
    let p: Rat[] | null = null;
    try { p = polyInVar(q, x); } catch { p = null; }
    // The completed square: b = −A, vertex h, scale = √(b/Q(h)), and the
    // half-width √(Q(h)/b) of the domain. A symbolic C = k·a² (√(a² − x²))
    // is taken with a > 0 ASSUMED and said.
    let form: { b: Rat; h: Rat; scale: Expr; halfWidth: string; param?: string } | null = null;
    if (p) {
      p = ratPolyTrim(p);
      if (p.length !== 3) continue;
      const [, B, A] = p;
      if (ratSign(A) >= 0) continue; // A > 0 is the asinh/ln family — not this rule
      const b0 = ratNeg(A);
      const h0 = ratDiv(ratNeg(B), ratMul(ratInt(2), A));
      const Qh = ratPolyEval(p, h0);
      if (ratSign(Qh) <= 0) continue; // Q < 0 everywhere: no real domain
      form = { b: b0, h: h0, scale: ratSqrtExpr(ratDiv(b0, Qh)), halfWidth: format0(ratSqrtExpr(ratDiv(Qh, b0))) };
    } else {
      form = symbolicRadicand(q, x, deriv);
    }
    if (!form) continue;
    // k = e·√Q, found by naming the radical: every sqrt(Q) becomes r and every
    // Q^(±1/2) becomes r^(±1), so k = (that)·r must mention neither x nor r.
    const named = nameRadical(e, q, RAD);
    const kk = mul(named, V(RAD));
    if (mentions(kk, x) || mentions(kk, RAD)) {
      // The simplifier merges x + 1/√Q into ONE fraction, (x·√Q + 1)/√Q, and
      // (1 + x)/√Q is a classic in its own right: split the numerator into its
      // terms and integrate each over √Q — every piece must succeed.
      // A merged fraction (sqrt(4 − x²) + r)/sqrt(4 − x²) — what two arcsines
      // summed come back as — splits its NUMERATOR over the shared denominator.
      const terms = kk.t === "div" && additiveTerms(kk.l).length >= 2
        ? additiveTerms(kk.l).map((t) => ({ t: "div", l: t, r: kk.r }) as Expr)
        : additiveTerms(kk);
      if (terms.length < 2 || terms.length > 6 || depth >= MAX_DEPTH) continue;
      const sq = fn("sqrt", q);
      let total: Expr | null = ZERO;
      for (const t of terms) {
        const piece = div(substituteVar(t, RAD, sq), sq);
        const Fi = integ(piece, x, deriv, depth + 1);
        if (!Fi) { total = null; break; }
        total = add(total, Fi);
      }
      if (total) return total;
      continue;
    }
    const k = kk;
    if (isZero(k)) continue;
    const { b, h, scale } = form;
    const outer = ratSqrtExpr(ratDiv(RAT_ONE, b));
    const shifted: Expr = ratIsZero(h) ? V(x) : sub(V(x), ratToExpr(h));
    // Rational pieces may go through the simplifier; a piece holding sqrt(m)
    // is assembled raw so it stays exact.
    const arg: Expr = hasSqrt(scale) ? { t: "mul", l: scale, r: shifted } : mul(scale, shifted);
    const coef: Expr = hasSqrt(outer) ? (isOne(k) ? outer : { t: "mul", l: k, r: outer }) : mul(k, outer);
    const asinPart: Expr = { t: "fn", name: "asin", arg };
    const negCoef = coef.t === "neg" ? coef.e : coef.t === "num" && coef.v < 0 ? N(-coef.v) : null;
    const F: Expr = isOne(coef) ? asinPart
      : negCoef && isOne(negCoef) ? { t: "neg", e: asinPart }
      : { t: "mul", l: coef, r: asinPart };
    const hv = ratToNumber(h);
    const centre = ratIsZero(h) ? x : hv > 0 ? `${x} - ${format0(ratToExpr(h))}` : `${x} + ${format0(ratToExpr(ratNeg(h)))}`;
    pendingNotes.push(`Valid where the square root is real: |${centre}| < ${form.halfWidth}.`);
    if (!form.param) {
      // Points inside THIS rule's domain for the gate's fallback: a shifted
      // domain (|x + 3| < 2) holds almost none of the fixed samples.
      const w = Math.sqrt(ratToNumber(ratDiv(ratPolyEval(p ?? [], h), b)));
      if (Number.isFinite(w) && w > 0) for (const t of [0.13, -0.41, 0.67, -0.83, 0.29]) pendingSamples.push(hv + t * w);
    }
    if (form.param) {
      pendingPositive.add(form.param);
      pendingNotes.push(`Assumes ${form.param} > 0, as the textbook formula does; for ${form.param} < 0 replace ${form.param} by |${form.param}| (as written, the answer would have the wrong sign there).`);
    }
    let kNeg = false;
    try { kNeg = evalNumeric(k, { pi: Math.PI, e: Math.E }) < 0; } catch { /* symbolic k */ }
    if (kNeg) {
      const pos: Expr = negCoef ?? simp({ t: "neg", e: coef });
      const acosForm = isOne(pos) ? `acos(${format0(arg)})` : `${wrap0(pos)}*acos(${format0(arg)})`;
      pendingNotes.push(`acos(u) = π/2 − asin(u), so −asin(u) and acos(u) differ only by a constant: ${acosForm} is an equally valid antiderivative.`);
    }
    return F;
  }
  return null;
}

const RAD = "_r";

/** Replaces √q (as sqrt(q) or q^(±1/2)) by the symbol `name` (or its reciprocal). */
function nameRadical(e: Expr, q: Expr, name: string): Expr {
  switch (e.t) {
    case "num": case "var": return e;
    case "neg": return { t: "neg", e: nameRadical(e.e, q, name) };
    case "fn":
      if (e.name === "sqrt" && exprEqual(e.arg, q) === true) return V(name);
      return { t: "fn", name: e.name, arg: nameRadical(e.arg, q, name) };
    case "pow": {
      if (exprEqual(e.l, q) === true) {
        let p = NaN;
        try { p = evalNumeric(e.r, {}); } catch { /* symbolic */ }
        if (p === 0.5) return V(name);
        if (p === -0.5) return { t: "div", l: N(1), r: V(name) };
      }
      return { t: "pow", l: nameRadical(e.l, q, name), r: nameRadical(e.r, q, name) };
    }
    default:
      return { t: e.t, l: nameRadical(e.l, q, name), r: nameRadical(e.r, q, name) } as Expr;
  }
}

/** The top-level additive terms of e (sub and neg folded into signed terms). */
function additiveTerms(e: Expr, sign = 1, out: Expr[] = []): Expr[] {
  if (e.t === "add") {
    additiveTerms(e.l, sign, out);
    additiveTerms(e.r, sign, out);
  } else if (e.t === "sub") {
    additiveTerms(e.l, sign, out);
    additiveTerms(e.r, -sign, out);
  } else if (e.t === "neg") {
    additiveTerms(e.e, -sign, out);
  } else {
    out.push(sign < 0 ? { t: "neg", e } : e);
  }
  return out;
}

const isOne = (e: Expr): boolean => e.t === "num" && e.v === 1;
function hasSqrt(e: Expr): boolean {
  switch (e.t) {
    case "num": case "var": return false;
    case "neg": return hasSqrt(e.e);
    case "fn": return e.name === "sqrt" || hasSqrt(e.arg);
    default: return hasSqrt(e.l) || hasSqrt(e.r);
  }
}

/**
 * ∫ k/(A·x² + c·a²) dx with A, c positive rationals, k free of x, and a ONE
 * symbol (assumed > 0, and said):  k/(a·√(A·c)) · atan(√(A/c)·x/a).
 * The rational-coefficient case is integrateRational's (exact since v2.136.0).
 */
function tryArctanSymbolic(e: Expr, x: string, deriv: Deriv): Expr | null {
  if (e.t !== "div" || mentions(e.l, x) || !mentions(e.r, x)) return null;
  const k = e.l;
  const q = e.r;
  try {
    const d1 = simp(deriv(q, x));
    const d2 = simp(deriv(d1, x));
    if (symbolsOf(d2).size || mentions(d2, x)) return null;
    const d2v = evalNumeric(d2, {});
    if (!Number.isInteger(d2v) || d2v <= 0 || d2v > 1e9) return null;
    const A = ratMake(BigInt(d2v), 2n);
    if (!isZero(simp(substituteVar(d1, x, ZERO)))) return null;
    const C = simp(substituteVar(q, x, ZERO));
    const syms = [...symbolsOf(C)];
    if (syms.length !== 1 || syms[0] === x) return null;
    const a = syms[0];
    if (mentions(k, a) && symbolsOf(k).size > 1) return null;
    const c0 = simp(div(C, pow(V(a), N(2))));
    if (symbolsOf(c0).size) return null;
    const cv = evalNumeric(c0, {});
    if (!Number.isInteger(cv) || cv <= 0 || cv > 1e9) return null;
    const c = ratInt(cv);
    if (exprEqual(q, add(mul(ratToExpr(A), pow(V(x), N(2))), mul(N(cv), pow(V(a), N(2))))) !== true) return null;
    const outer = ratSqrtExpr(ratDiv(RAT_ONE, ratMul(A, c))); // 1/√(A·c)
    const sc = ratSqrtExpr(ratDiv(A, c)); // √(A/c)
    const arg: Expr = hasSqrt(sc) ? { t: "mul", l: sc, r: { t: "div", l: V(x), r: V(a) } } : mul(sc, div(V(x), V(a)));
    const coefBase: Expr = hasSqrt(outer) ? { t: "div", l: outer, r: V(a) } : div(outer, V(a));
    const coef: Expr = isOne(k) ? coefBase : hasSqrt(outer) ? { t: "mul", l: k, r: coefBase } : mul(k, coefBase);
    pendingPositive.add(a);
    // Unlike the arcsine, (1/a)·atan(x/a) is unchanged by a → −a, so it holds for every a ≠ 0.
    pendingNotes.push(`Stated, as in the textbook, for ${a} > 0 — and valid for every ${a} ≠ 0, since the formula is unchanged under ${a} → −${a}; at ${a} = 0 the integrand is 1/x² (a different integral).`);
    return { t: "mul", l: coef, r: { t: "fn", name: "atan", arg } };
  } catch {
    return null;
  }
}

/** A tiny formatter for notes, independent of solve.ts (no runtime cycle). */
function format0(e: Expr): string {
  switch (e.t) {
    case "num": return String(e.v);
    case "var": return e.name;
    case "neg": return `-${format0(e.e)}`;
    case "fn": return `${e.name}(${format0(e.arg)})`;
    case "add": return `${format0(e.l)} + ${format0(e.r)}`;
    case "sub": return `${format0(e.l)} - ${e.r.t === "add" || e.r.t === "sub" ? `(${format0(e.r)})` : format0(e.r)}`;
    case "mul": return `${wrap0(e.l)}*${wrap0(e.r)}`;
    case "div": return `${wrap0(e.l)}/${wrap0(e.r, true)}`;
    case "pow": return `${wrap0(e.l, true)}^${wrap0(e.r, true)}`;
  }
}
function wrap0(e: Expr, strict = false): string {
  const s = format0(e);
  if (e.t === "add" || e.t === "sub" || (strict && (e.t === "mul" || e.t === "div" || e.t === "neg"))) return `(${s})`;
  return s;
}

/** e as a·x + b with both free of x, via differentiation — or null. */
function linearIn(e: Expr, x: string, deriv: Deriv): { a: Expr; b: Expr } | null {
  let a: Expr;
  try {
    a = simp(deriv(e, x));
  } catch {
    return null;
  }
  if (mentions(a, x) || isZero(a)) return null;
  const b = sub(e, mul(a, V(x)));
  if (mentions(simp(b), x)) return null;
  return { a, b: simp(b) };
}

/**
 * sin(u)² → (1 − cos(2u))/2 and cos(u)² → (1 + cos(2u))/2, then integrate
 * the rewrite. The rewrite is exact for EVERY u; whether the result
 * integrates is the recursion's problem (linear u does, via the existing
 * machinery), and the final differentiate-back check guards the whole.
 */
function tryTrigPower(e: Expr, x: string, deriv: Deriv, depth: number): Expr | null {
  if (depth >= MAX_DEPTH) return null;
  if (e.t !== "pow" || e.l.t !== "fn" || !isZero(sub(e.r, N(2)))) return null;
  const u = e.l.arg;
  if (!mentions(u, x)) return null;
  let rewritten: Expr | null = null;
  if (e.l.name === "sin") rewritten = div(sub(N(1), fn("cos", mul(N(2), u))), N(2));
  else if (e.l.name === "cos") rewritten = div(add(N(1), fn("cos", mul(N(2), u))), N(2));
  if (!rewritten) return null;
  return integ(rewritten, x, deriv, depth + 1);
}

/**
 * ∫e^(ax+b)·sin(cx+d) dx = e^(ax+b)·(a·sin(cx+d) − c·cos(cx+d))/(a²+c²),
 * and the cos twin with (a·cos + c·sin). The classic "solve for the
 * integral" result of applying by parts twice — emitted directly, verified
 * by differentiating back like every other candidate.
 */
function tryExpTrig(e: Expr, x: string, deriv: Deriv): Expr | null {
  // Flatten the product, splitting off x-free constant factors.
  const factors: Expr[] = [];
  let constant: Expr = N(1);
  let sign = 1;
  const walk = (n: Expr): void => {
    if (n.t === "mul") {
      walk(n.l);
      walk(n.r);
    } else if (n.t === "neg") {
      sign = -sign;
      walk(n.e);
    } else if (!mentions(n, x)) {
      constant = mul(constant, n);
    } else {
      factors.push(n);
    }
  };
  walk(e);
  if (factors.length !== 2) return null;
  const expF = factors.find((f) => f.t === "fn" && f.name === "exp");
  const trigF = factors.find((f) => f.t === "fn" && (f.name === "sin" || f.name === "cos"));
  if (!expF || !trigF || expF === trigF || expF.t !== "fn" || trigF.t !== "fn") return null;
  const L1 = linearIn(expF.arg, x, deriv);
  const L2 = linearIn(trigF.arg, x, deriv);
  if (!L1 || !L2) return null;
  const a = L1.a;
  const c = L2.a;
  const denom = add(mul(a, a), mul(c, c));
  if (isZero(denom)) return null;
  const s = fn("sin", trigF.arg);
  const co = fn("cos", trigF.arg);
  const core =
    trigF.name === "sin"
      ? div(mul(expF, sub(mul(a, s), mul(c, co))), denom)
      : div(mul(expF, add(mul(a, co), mul(c, s))), denom);
  const withConst = mul(constant, core);
  return sign < 0 ? neg(withConst) : withConst;
}

function trySubstitution(e: Expr, x: string, deriv: Deriv, depth: number): Expr | null {
  if (depth >= MAX_DEPTH) return null;
  for (const g of substitutionCandidates(e, x)) {
    let gp: Expr;
    try {
      gp = simp(deriv(g, x));
    } catch {
      continue;
    }
    if (isZero(gp)) continue;
    let h: Expr;
    try {
      h = div(e, gp);
    } catch {
      continue;
    }
    const hu = replaceCanonical(h, g, U);
    if (mentions(hu, x)) continue; // h was not a function of g alone
    const Hu = integ(hu, U, deriv, depth + 1);
    if (!Hu) continue;
    return simp(substituteVar(Hu, U, g));
  }
  return null;
}

function tryByParts(e: Expr, x: string, deriv: Deriv, depth: number): Expr | null {
  if (depth >= MAX_DEPTH) return null;

  // ∫ ln(x) dx and friends: u = f(x), dv = 1.
  if (e.t === "fn" && BY_PARTS_SOLO.has(e.name)) {
    const V0 = V(x);
    const du = simp(deriv(e, x));
    const rest = integ(mul(V0, du), x, deriv, depth + 1);
    if (rest) return sub(mul(V0, e), rest);
    return null;
  }

  if (e.t !== "mul") return null;
  // Try each factor as u (differentiate) with the other as dv (integrate).
  const pairs: [Expr, Expr][] = [[e.l, e.r], [e.r, e.l]];
  for (const [u, dv] of pairs) {
    if (!mentions(u, x)) continue;
    const Vp = integ(dv, x, deriv, depth + 1);
    if (!Vp) continue;
    let du: Expr;
    try {
      du = simp(deriv(u, x));
    } catch {
      continue;
    }
    if (isZero(du)) continue;
    const rest = integ(mul(Vp, du), x, deriv, depth + 1);
    if (!rest) continue;
    return sub(mul(u, Vp), rest);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point — with the verification gate.
// ---------------------------------------------------------------------------

export interface AntiderivResult {
  /** F with F' = f, verified. */
  F: Expr;
  /** True when d/dx F was proved canonically equal to the integrand. */
  verified: boolean;
  /**
   * What a rule knows about its answer that F alone does not say: a domain of
   * validity ("|x| < 2" for an arcsine), an equivalent form (acos beside
   * −asin). Absent when no rule spoke. Callers should show these as caveats.
   */
  notes?: string[];
}

/**
 * Symbolic antiderivative of `e` with respect to `x`, or null if none was
 * found OR the candidate failed verification.
 *
 * VERIFICATION IS MANDATORY: the result is differentiated back and compared to
 * the integrand in canonical form. Where canonical comparison is inconclusive
 * (an opaque atom on both sides), it falls back to a numeric identity check at
 * sample points. A candidate that fails both is discarded — the caller then
 * uses numeric quadrature, which is honest, rather than a wrong closed form.
 */
export function symbolicIntegrate(e: Expr, x: string, deriv: Deriv): AntiderivResult | null {
  let F: Expr | null;
  pendingNotes = [];
  pendingPositive = new Set();
  pendingSamples = [];
  try {
    F = integ(e, x, deriv, 0);
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }
  if (!F) return null;
  // A note is kept only when its rule's asin survived into F (a split whose
  // second piece failed, or an abandoned branch, can leave one behind) and
  // never when it names an internal substitution symbol (_u, _r).
  const ruleFnSurvived = hasFnNamed(F, "asin") || hasFnNamed(F, "atan");
  const notes = ruleFnSurvived ? [...new Set(pendingNotes)].filter((n) => !/\b_[ur]\b/.test(n)) : [];
  pendingNotes = [];
  // The same survival test for what a rule ASSUMED: a positivity assumption or
  // domain samples from an abandoned branch must not verify a different F.
  const asinSurvived = ruleFnSurvived;
  const positive = asinSurvived ? [...pendingPositive].filter((p) => mentions(F as Expr, p)) : [];
  pendingPositive = new Set();
  const domainSamples = asinSurvived ? pendingSamples : [];
  pendingSamples = [];
  const withNotes = (r: AntiderivResult): AntiderivResult => (notes.length ? { ...r, notes } : r);

  // Canonical check: d/dx F − f ≡ 0.
  let back: Expr;
  try {
    back = deriv(F, x);
  } catch {
    return null;
  }
  const eq = exprEqual(simp(back), simp(e));
  if (eq === true) return withNotes({ F, verified: true });

  // Inconclusive or unequal — decide numerically before discarding, because
  // canonical equality is only as strong as the module's cancellation power
  // (it will not, for instance, prove sin²+cos² = 1).
  //
  // `verified` IS FALSE HERE, and that distinction is the whole point of the
  // flag. It used to be `true` on this branch too, which made the field a
  // constant and its doc comment false — and a caller that reported "proved
  // identically zero" on the strength of it was overclaiming for every answer
  // canonical equality could not settle. tan(x), tanh(x) and sqrt(x) all land
  // here: they survive on eight float samples, which is evidence and not proof.
  if (numericallyEqual(back, e, x, positive, domainSamples)) return withNotes({ F, verified: false });
  return null;
}

function hasFnNamed(e: Expr, name: string): boolean {
  switch (e.t) {
    case "num": case "var": return false;
    case "neg": return hasFnNamed(e.e, name);
    case "fn": return e.name === name || hasFnNamed(e.arg, name);
    default: return hasFnNamed(e.l, name) || hasFnNamed(e.r, name);
  }
}

/** Fixed sample points; deterministic, no RNG. */
const SAMPLES = [0.37, 0.81, 1.23, 1.87, 2.41, -0.53, -1.29, 3.14];
/**
 * Consulted ONLY when fewer than three of SAMPLES were usable: an integrand
 * defined on a narrow interval (1/√(1 − 100x²) lives on |x| < 0.1) would
 * otherwise be refused for lack of evidence, never for a disagreement. These
 * cannot loosen a check that already had its three points.
 */
const NARROW_SAMPLES = [0.037, 0.081, -0.053, 0.0123, -0.0187, 0.0041, 0.37 + 1 / 3, 1.5 - 0.0137];

/**
 * Numeric identity check of two expressions in one variable. `positive`
 * names parameters a rule has ASSUMED positive (the arcsine rule's a in
 * √(a² − x²)); only those are bound, at two different positive values, and
 * the identity must hold at both. Any other free symbol still makes every
 * sample throw, exactly as before.
 */
function numericallyEqual(a: Expr, b: Expr, x: string, positive: string[] = [], extra: number[] = []): boolean {
  const assignments: Record<string, number>[] = positive.length
    ? [Object.fromEntries(positive.map((p, i) => [p, 1.7 + 0.6 * i])), Object.fromEntries(positive.map((p, i) => [p, 2.9 + 0.4 * i]))]
    : [{}];
  return assignments.every((params) => {
    let checked = 0;
    const probe = (s: number): boolean => {
      let va: number, vb: number;
      try {
        va = evalNumeric(a, { ...params, [x]: s });
        vb = evalNumeric(b, { ...params, [x]: s });
      } catch {
        return true;
      }
      if (!Number.isFinite(va) || !Number.isFinite(vb)) return true;
      const tol = 1e-7 * (1 + Math.abs(vb));
      if (Math.abs(va - vb) > tol) return false;
      checked++;
      return true;
    };
    for (const s of SAMPLES) if (!probe(s)) return false;
    if (checked >= 3) return true;
    for (const s of [...NARROW_SAMPLES, ...extra]) if (!probe(s)) return false;
    return checked >= 3;
  });
}

/** Minimal evaluator — kept local so this module needs nothing from solve.ts at runtime. */
const EVAL_FN: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function evalNumeric(e: Expr, vars: Record<string, number>): number {
  switch (e.t) {
    case "num": return e.v;
    case "var":
      if (e.name in vars) return vars[e.name];
      if (e.name in CONSTS) return CONSTS[e.name];
      throw new Error(`unknown ${e.name}`);
    case "neg": return -evalNumeric(e.e, vars);
    case "add": return evalNumeric(e.l, vars) + evalNumeric(e.r, vars);
    case "sub": return evalNumeric(e.l, vars) - evalNumeric(e.r, vars);
    case "mul": return evalNumeric(e.l, vars) * evalNumeric(e.r, vars);
    case "div": return evalNumeric(e.l, vars) / evalNumeric(e.r, vars);
    case "pow": return Math.pow(evalNumeric(e.l, vars), evalNumeric(e.r, vars));
    case "fn": {
      const f = EVAL_FN[e.name];
      if (!f) throw new Error(`unknown fn ${e.name}`);
      return f(evalNumeric(e.arg, vars));
    }
  }
}
