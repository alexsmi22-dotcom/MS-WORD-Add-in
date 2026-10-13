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
  ratPolyDivMod, ratPolyRoots, ratToNumber, ratEq } from "./cas";

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
        const s = fn("sqrt", ratToExpr(s2));
        out = add(out, scale(mul(div(ratToExpr(rest2), s), fn("atan", div(shift, s)))));
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
  try {
    F = integ(e, x, deriv, 0);
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }
  if (!F) return null;

  // Canonical check: d/dx F − f ≡ 0.
  let back: Expr;
  try {
    back = deriv(F, x);
  } catch {
    return null;
  }
  const eq = exprEqual(simp(back), simp(e));
  if (eq === true) return { F, verified: true };

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
  if (numericallyEqual(back, e, x)) return { F, verified: false };
  return null;
}

/** Fixed sample points; deterministic, no RNG. */
const SAMPLES = [0.37, 0.81, 1.23, 1.87, 2.41, -0.53, -1.29, 3.14];

/** Numeric identity check of two expressions in one variable. */
function numericallyEqual(a: Expr, b: Expr, x: string): boolean {
  let checked = 0;
  for (const s of SAMPLES) {
    let va: number, vb: number;
    try {
      va = evalNumeric(a, { [x]: s });
      vb = evalNumeric(b, { [x]: s });
    } catch {
      continue;
    }
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    const tol = 1e-7 * (1 + Math.abs(vb));
    if (Math.abs(va - vb) > tol) return false;
    checked++;
  }
  return checked >= 3;
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
