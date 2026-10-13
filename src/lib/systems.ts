// Systems of equations — the CAS brief's "later" list, and the most-requested
// thing a solver can lack.
//
// TWO PATHS, chosen by what the system actually is:
//
//   LINEAR  → exact. Reduced row echelon form over the CAS's rational numbers,
//             so `x/3 + y/7 = 1` is solved without a rounding error anywhere.
//             The classification is the valuable part: a linear system has
//             EXACTLY ONE solution, NO solution, or INFINITELY MANY, and which
//             one it is falls straight out of the rank. Reporting "x = 2.0000,
//             y = 1.0000" for a system that actually has a whole line of
//             solutions is the kind of confident wrong answer this project
//             keeps designing out — so an underdetermined system returns its
//             GENERAL solution with the free parameters named, and an
//             inconsistent one says which row proved it.
//
//   NONLINEAR → Newton's method from several starting points, and honest about
//             it: Newton finds A root near where it starts, not all of them.
//             Every root is verified by substituting it back, duplicates are
//             merged, and the result states plainly that other solutions may
//             exist. That is the same standard the transcendental single-
//             equation path already holds itself to.
//
// `linalg.ts` is not reused for the linear case for the same reason homology
// does not: it is IEEE double with a 1e-9 pivot cutoff, and the whole point
// here is to be exact and to make the rank test reliable.

import { parseExpr, evalAst, freeVars, Expr } from "./solve";
import {
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratSign, ratToNumber, ratFromNumber, RAT_ZERO, ratPolyAdd, ratPolyMul, ratPolyTrim, ratPolyDivMod, ratPolyRoots, ratPolyEval, ratEq, RAT_ONE,
} from "./cas";
import { fmtRat } from "./geometry";

export interface SystemSolution {
  variables: string[];
  kind: "unique" | "infinite" | "none" | "nonlinear" | "unsolved" | "parametric";
  /** For a parametric system: the symbol treated as the parameter. */
  parameter?: string;
  /** For a unique solution: variable → exact value. */
  exact?: Record<string, string>;
  /** Numeric values, for every solved case. */
  numeric?: Record<string, number>[];
  /** For an underdetermined system: the variables left free. */
  freeVariables?: string[];
  /** General solution lines, e.g. "x = 3 - 2*z". */
  general?: string[];
  steps: string[];
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Linear extraction
// ---------------------------------------------------------------------------

/**
 * Coefficients of a LINEAR expression: variable → coefficient, plus a constant.
 * Null when the expression is not linear in the given variables — which is what
 * sends the system down the nonlinear path rather than producing a wrong
 * linearisation.
 */
export function linearCoeffs(e: Expr, vars: string[]): { coeff: Map<string, Rat>; constant: Rat } | null {
  const coeff = new Map<string, Rat>();
  let constant = RAT_ZERO;
  let failed = false;

  const add = (v: string | null, c: Rat) => {
    if (v === null) constant = ratAdd(constant, c);
    else coeff.set(v, ratAdd(coeff.get(v) ?? RAT_ZERO, c));
  };

  /** Returns the constant value of a subtree, or null if it involves a variable. */
  const constOf = (n: Expr): Rat | null => {
    const r = walkPure(n);
    if (!r) return null;
    return r.vars.size === 0 ? r.constant : null;
  };

  /** Linear form of a subtree: {vars, constant}, or null if nonlinear. */
  function walkPure(n: Expr): { vars: Map<string, Rat>; constant: Rat } | null {
    switch (n.t) {
      case "num":
        return { vars: new Map(), constant: ratFromNumber(n.v) };
      case "var": {
        if (!vars.includes(n.name)) return null; // pi/e or a stray symbol
        return { vars: new Map([[n.name, ratInt(1)]]), constant: RAT_ZERO };
      }
      case "neg": {
        const a = walkPure(n.e);
        if (!a) return null;
        return {
          vars: new Map([...a.vars].map(([k, v]) => [k, ratNeg(v)])),
          constant: ratNeg(a.constant),
        };
      }
      case "add": case "sub": {
        const a = walkPure(n.l), b = walkPure(n.r);
        if (!a || !b) return null;
        const sign = n.t === "add" ? 1 : -1;
        const out = new Map(a.vars);
        for (const [k, v] of b.vars) out.set(k, ratAdd(out.get(k) ?? RAT_ZERO, sign > 0 ? v : ratNeg(v)));
        return {
          vars: out,
          constant: sign > 0 ? ratAdd(a.constant, b.constant) : ratSub(a.constant, b.constant),
        };
      }
      case "mul": {
        const a = walkPure(n.l), b = walkPure(n.r);
        if (!a || !b) return null;
        // Linear × linear is only linear when one side is constant.
        if (a.vars.size && b.vars.size) return null;
        const k = a.vars.size ? b.constant : a.constant;
        const lin = a.vars.size ? a : b;
        return {
          vars: new Map([...lin.vars].map(([kk, v]) => [kk, ratMul(v, k)])),
          constant: ratMul(lin.constant, k),
        };
      }
      case "div": {
        const a = walkPure(n.l), b = walkPure(n.r);
        if (!a || !b || b.vars.size || ratIsZero(b.constant)) return null;
        return {
          vars: new Map([...a.vars].map(([k, v]) => [k, ratDiv(v, b.constant)])),
          constant: ratDiv(a.constant, b.constant),
        };
      }
      case "pow": {
        const p = constOf(n.r);
        if (!p || p.d !== 1n) return null;
        const k = Number(p.n);
        if (k === 0) return { vars: new Map(), constant: ratInt(1) };
        if (k === 1) return walkPure(n.l);
        const base = constOf(n.l);
        if (base && Math.abs(k) <= 64 && (k > 0 || !ratIsZero(base))) {
          // (−2)² x is linear: a substituted parameter value under a power.
          let acc = ratInt(1);
          for (let i = 0; i < Math.abs(k); i++) acc = ratMul(acc, base);
          return { vars: new Map(), constant: k > 0 ? acc : ratDiv(ratInt(1), acc) };
        }
        return null; // x², and anything higher, is not linear
      }
      default:
        return null; // sin(x) and friends
    }
  }

  const r = walkPure(e);
  if (!r || failed) return null;
  for (const [k, v] of r.vars) add(k, v);
  constant = ratAdd(constant, r.constant);
  return { coeff, constant };
}

// ---------------------------------------------------------------------------
// Exact reduced row echelon form over the rationals.
// ---------------------------------------------------------------------------

/**
 * RREF of an augmented matrix, exactly. Returns the pivot column of each row,
 * which is what makes the free variables and the consistency test readable.
 */
export function rref(m: Rat[][]): { rows: Rat[][]; pivots: number[] } {
  const rows = m.map((r) => r.slice());
  const nRows = rows.length;
  const nCols = nRows ? rows[0].length : 0;
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < nCols - 1 && r < nRows; c++) {
    let p = -1;
    for (let i = r; i < nRows; i++) if (!ratIsZero(rows[i][c])) { p = i; break; }
    if (p < 0) continue; // no pivot in this column: it becomes a free variable
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const lead = rows[r][c];
    for (let j = c; j < nCols; j++) rows[r][j] = ratDiv(rows[r][j], lead);
    for (let i = 0; i < nRows; i++) {
      if (i === r || ratIsZero(rows[i][c])) continue;
      const f = rows[i][c];
      for (let j = c; j < nCols; j++) rows[i][j] = ratSub(rows[i][j], ratMul(f, rows[r][j]));
    }
    pivots.push(c);
    r++;
  }
  return { rows, pivots };
}

/** Formats an exact rational coefficient into a term like "- 2*z" or "+ 1/3*z". */
function term(c: Rat, name: string): string {
  const neg = ratSign(c) < 0;
  const a = neg ? ratNeg(c) : c;
  const mag = fmtRat(a);
  const body = mag === "1" ? name : `${mag}*${name}`;
  return `${neg ? " - " : " + "}${body}`;
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

/**
 * Solves a system of equations given as "LHS = RHS" strings.
 * Linear systems are exact; anything else goes to Newton and says so.
 */
export function solveSystem(equations: string[], varOrder?: string[]): SystemSolution | null {
  const parsed: Expr[] = [];
  for (const raw of equations) {
    const parts = raw.split("=");
    if (parts.length !== 2) return null;
    try {
      // Move everything to the left: f = LHS − RHS, solve f = 0.
      parsed.push({ t: "sub", l: parseExpr(parts[0]), r: parseExpr(parts[1]) });
    } catch {
      return null;
    }
  }
  if (!parsed.length) return null;

  const varSet = new Set<string>();
  for (const e of parsed) for (const v of freeVars(e)) varSet.add(v);
  const variables = varOrder ?? [...varSet].sort();
  if (!variables.length) return null;

  const steps: string[] = [];
  const caveats: string[] = [];

  // `e` and `pi` are CONSTANTS in this grammar, so `e = 4` is not an equation
  // in an unknown — it is a false statement about Euler's number. freeVars()
  // excludes them, so without this the system silently loses an unknown and
  // then blames Newton for the mismatch. Name the real problem instead.
  const reserved = [...new Set(parsed.flatMap((e) => reservedNamesIn(e)))];
  if (reserved.length) {
    return {
      variables,
      kind: "unsolved",
      steps,
      caveats: [
        `${reserved.join(" and ")} ${reserved.length > 1 ? "are" : "is"} a built-in CONSTANT here ` +
        `(e = 2.71828…, pi = 3.14159…), not an unknown, so ${reserved.length > 1 ? "they cannot" : "it cannot"} ` +
        `be solved for. Rename the unknown — u, v or w are safe — and try again.`,
      ],
    };
  }

  // A parameter with the unknowns in their conventional letters is read as a
  // parameter even where the plain linear path could absorb it as one more
  // unknown ("x + y = a; x − y = 1"): the answer for every a is what was asked.
  {
    const unk = variables.filter((v) => UNKNOWN_NAMES.includes(v));
    const prm = variables.filter((v) => !UNKNOWN_NAMES.includes(v));
    if (!varOrder && prm.length === 1 && unk.length >= 1 && parsed.length >= unk.length) {
      const early = parametricSystem(parsed, variables, equations);
      if (early) return early;
    }
  }

  // Try the exact linear path first.
  const rowsRat: Rat[][] = [];
  let allLinear = true;
  for (const e of parsed) {
    const lc = linearCoeffs(e, variables);
    if (!lc) { allLinear = false; break; }
    const row: Rat[] = variables.map((v) => lc.coeff.get(v) ?? RAT_ZERO);
    // f = Σ aᵢxᵢ + k = 0  ⟹  Σ aᵢxᵢ = −k
    row.push(ratNeg(lc.constant));
    rowsRat.push(row);
  }

  if (allLinear) {
    steps.push(`${parsed.length} linear equation${parsed.length === 1 ? "" : "s"} in ${variables.length} unknown${variables.length === 1 ? "" : "s"} (${variables.join(", ")}).`);
    steps.push("Solved EXACTLY by row reduction over the rationals — no rounding anywhere.");
    const { rows, pivots } = rref(rowsRat);
    const n = variables.length;

    // Inconsistent iff some row reads 0 … 0 | nonzero.
    for (let i = 0; i < rows.length; i++) {
      const allZero = rows[i].slice(0, n).every(ratIsZero);
      if (allZero && !ratIsZero(rows[i][n])) {
        return {
          variables,
          kind: "none",
          steps: [...steps, `Row ${i + 1} reduces to 0 = ${fmtRat(rows[i][n])}, which is impossible.`],
          caveats: ["The equations CONTRADICT each other, so no assignment of values can satisfy them all. This is a property of the system, not a failure to find a solution."],
        };
      }
    }

    const freeIdx = [...Array(n).keys()].filter((c) => !pivots.includes(c));
    if (freeIdx.length === 0) {
      const exact: Record<string, string> = {};
      const numeric: Record<string, number> = {};
      pivots.forEach((c, i) => {
        exact[variables[c]] = fmtRat(rows[i][n]);
        numeric[variables[c]] = ratToNumber(rows[i][n]);
      });
      steps.push(`Rank ${pivots.length} equals the number of unknowns, so the solution is UNIQUE.`);
      return { variables, kind: "unique", exact, numeric: [numeric], steps, caveats };
    }

    // Underdetermined: report the GENERAL solution, not one arbitrary point.
    const free = freeIdx.map((i) => variables[i]);
    const general: string[] = [];
    pivots.forEach((c, i) => {
      let rhs = fmtRat(rows[i][n]);
      if (rhs === "0") rhs = "";
      for (const f of freeIdx) {
        const co = rows[i][f];
        if (ratIsZero(co)) continue;
        rhs += term(ratNeg(co), variables[f]); // move to the other side
      }
      rhs = rhs.replace(/^ \+ /, "").replace(/^ - /, "-").trim() || "0";
      general.push(`${variables[c]} = ${rhs}`);
    });
    for (const f of free) general.push(`${f} is free`);
    steps.push(`Rank ${pivots.length} is less than the ${n} unknowns, so there are INFINITELY MANY solutions.`);
    return {
      variables, kind: "infinite", freeVariables: free, general, steps,
      caveats: [
        `This system does not pin down a single answer: ${free.join(" and ")} can take any value, and the others follow. Reporting one particular solution would misrepresent that.`,
      ],
    };
  }

  // A PARAMETER: one symbol outside the conventional unknown names, with the
  // equations linear in the unknowns and polynomial in it — solved over the
  // rational functions ℚ(a), with the values of a where that fails listed.
  const param = parametricSystem(parsed, variables, equations);
  if (param) return param;

  // Nonlinear: Newton from several starts.
  steps.push(`${parsed.length} equation${parsed.length === 1 ? "" : "s"} in ${variables.length} unknown${variables.length === 1 ? "" : "s"}; at least one is NOT linear, so this is solved numerically by Newton's method.`);
  if (parsed.length !== variables.length) {
    caveats.push(
      `There are ${parsed.length} equations and ${variables.length} unknowns. Newton's method needs as many equations as unknowns, so this cannot be solved that way.`
    );
    return { variables, kind: "unsolved", steps, caveats };
  }
  const roots = newtonSystem(parsed, variables);
  if (!roots.length) {
    return {
      variables, kind: "unsolved", steps,
      caveats: [
        "Newton's method did not converge from any of the starting points tried. That does NOT mean the system has no solution — only that none was found from where the search began.",
      ],
    };
  }
  return {
    variables,
    kind: "nonlinear",
    numeric: roots,
    steps: [...steps, `Found ${roots.length} distinct solution${roots.length === 1 ? "" : "s"}; each is verified by substituting it back.`],
    caveats: [
      "NUMERIC, and incomplete by nature: Newton's method finds a solution NEAR where it starts, so other solutions may exist that these starting points never reached. Every value shown has been substituted back and satisfies the equations to within 1e-9.",
      "Solutions closer together than about 1e-3 are reported as ONE. Where the equations are flat at a root the method cannot localise it more tightly than that, and listing the same root several times over would be worse than merging two genuinely distinct ones.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Parametric linear systems: coefficients in ℚ(a).
// ---------------------------------------------------------------------------

/** Letters conventionally used as unknowns; everything else is a parameter. */
const UNKNOWN_NAMES = ["x", "y", "z", "w", "u", "v"];

/** A rational function in one parameter: num/den, den monic, gcd reduced. */
interface RF { num: Rat[]; den: Rat[] }
const RF_ZERO: RF = { num: [], den: [RAT_ONE] };
const rfIsZero = (r: RF): boolean => ratPolyTrim(r.num).length === 0;
function polyGcd(a: Rat[], b: Rat[]): Rat[] {
  let x = ratPolyTrim(a), y = ratPolyTrim(b);
  while (y.length) { const { r } = ratPolyDivMod(x, y); x = y; y = ratPolyTrim(r); }
  if (!x.length) return [RAT_ONE];
  const lead = x[x.length - 1];
  return x.map((c) => ratDiv(c, lead));
}
function rfNorm(r: RF): RF {
  let num = ratPolyTrim(r.num), den = ratPolyTrim(r.den);
  if (!den.length) throw new Error("zero denominator");
  if (!num.length) return RF_ZERO;
  const gcd = polyGcd(num, den);
  if (gcd.length > 1) { num = ratPolyDivMod(num, gcd).q; den = ratPolyDivMod(den, gcd).q; }
  const lead = den[den.length - 1];
  return { num: num.map((c) => ratDiv(c, lead)), den: den.map((c) => ratDiv(c, lead)) };
}
const rfAdd = (a: RF, b: RF): RF => rfNorm({ num: ratPolyAdd(ratPolyMul(a.num, b.den), ratPolyMul(b.num, a.den)), den: ratPolyMul(a.den, b.den) });
const rfNeg = (a: RF): RF => ({ num: a.num.map(ratNeg), den: a.den });
const rfSub = (a: RF, b: RF): RF => rfAdd(a, rfNeg(b));
const rfMul = (a: RF, b: RF): RF => rfNorm({ num: ratPolyMul(a.num, b.num), den: ratPolyMul(a.den, b.den) });
function rfDiv(a: RF, b: RF): RF { if (rfIsZero(b)) throw new Error("divide by zero RF"); return rfNorm({ num: ratPolyMul(a.num, b.den), den: ratPolyMul(a.den, b.num) }); }
const rfConst = (c: Rat): RF => ({ num: ratIsZero(c) ? [] : [c], den: [RAT_ONE] });
const rfParam: RF = { num: [RAT_ZERO, RAT_ONE], den: [RAT_ONE] };

/** Linear form over ℚ(a): unknown → RF coefficient, plus an RF constant; null if not linear in the unknowns. */
function linearOverParam(e: Expr, unknowns: string[], a: string): { coeff: Map<string, RF>; constant: RF } | null {
  type Lin = { vars: Map<string, RF>; constant: RF };
  const walk = (n: Expr): Lin | null => {
    switch (n.t) {
      case "num": return { vars: new Map(), constant: rfConst(ratFromNumber(n.v)) };
      case "var":
        if (n.name === a) return { vars: new Map(), constant: rfParam };
        if (unknowns.includes(n.name)) return { vars: new Map([[n.name, rfConst(ratInt(1))]]), constant: RF_ZERO };
        return null;
      case "neg": { const r = walk(n.e); return r ? { vars: new Map([...r.vars].map(([k, v]) => [k, rfNeg(v)])), constant: rfNeg(r.constant) } : null; }
      case "add": case "sub": {
        const l = walk(n.l), r = walk(n.r);
        if (!l || !r) return null;
        const out = new Map(l.vars);
        for (const [k, v] of r.vars) out.set(k, n.t === "add" ? rfAdd(out.get(k) ?? RF_ZERO, v) : rfSub(out.get(k) ?? RF_ZERO, v));
        return { vars: out, constant: n.t === "add" ? rfAdd(l.constant, r.constant) : rfSub(l.constant, r.constant) };
      }
      case "mul": {
        const l = walk(n.l), r = walk(n.r);
        if (!l || !r) return null;
        if (l.vars.size && r.vars.size) return null;
        const k = l.vars.size ? r.constant : l.constant;
        const lin = l.vars.size ? l : r;
        return { vars: new Map([...lin.vars].map(([kk, v]) => [kk, rfMul(v, k)])), constant: rfMul(lin.constant, k) };
      }
      case "div": {
        const l = walk(n.l), r = walk(n.r);
        if (!l || !r || r.vars.size || rfIsZero(r.constant)) return null;
        return { vars: new Map([...l.vars].map(([kk, v]) => [kk, rfDiv(v, r.constant)])), constant: rfDiv(l.constant, r.constant) };
      }
      case "pow": {
        const base = walk(n.l), ex = walk(n.r);
        if (!base || !ex || ex.vars.size || !rfIsPolyConst(ex.constant)) return null;
        const k = Number(ex.constant.num[0]?.n ?? 0n);
        if (k === 0) return { vars: new Map(), constant: rfConst(ratInt(1)) };
        if (k === 1) return base;
        if (base.vars.size || k < 0 || k > 64) return null;
        let acc = rfConst(ratInt(1));
        for (let i = 0; i < k; i++) acc = rfMul(acc, base.constant);
        return { vars: new Map(), constant: acc };
      }
      default: return null;
    }
  };
  const r = walk(e);
  return r ? { coeff: r.vars, constant: r.constant } : null;
}
function rfIsPolyConst(r: RF): boolean { return r.den.length === 1 && ratPolyTrim(r.num).length <= 1 && (r.num.length === 0 || r.num[0].d === 1n); }

/** Leading coefficient made positive (for "≠ 0" conditions and root finding). */
function monic(p: Rat[]): Rat[] {
  const lead = p[p.length - 1];
  return ratSign(lead) < 0 ? p.map(ratNeg) : p;
}

function rfText(r: RF, a: string): string {
  const num = ratPolyTrim(r.num), den = ratPolyTrim(r.den);
  if (!num.length) return "0";
  const n = polyStr(num, a), d = polyStr(den, a);
  if (den.length === 1 && ratEq(den[0], RAT_ONE)) return n;
  const wrap = (s: string, p: Rat[]): string => (p.length > 1 && (s.includes(" ") || s.includes("+") || s.includes("−")) ? `(${s})` : s);
  return `${wrap(n, num)}/${wrap(d, den)}`;
}
function polyStr(p: Rat[], a: string): string {
  const parts: string[] = [];
  for (let k = p.length - 1; k >= 0; k--) {
    const c = p[k];
    if (ratIsZero(c)) continue;
    const neg = ratSign(c) < 0;
    const mag = neg ? ratNeg(c) : c;
    const magS = fmtRat(mag);
    const coef = ratEq(mag, RAT_ONE) ? "" : mag.d === 1n ? magS : `(${magS})`;
    const body = k === 0 ? magS : coef + a + (k === 1 ? "" : k === 2 ? "²" : k === 3 ? "³" : `^${k}`);
    parts.push((parts.length ? (neg ? " − " : " + ") : neg ? "−" : "") + body);
  }
  return parts.join("") || "0";
}

function parametricSystem(parsed: Expr[], variables: string[], equations: string[]): SystemSolution | null {
  const unknowns = variables.filter((v) => UNKNOWN_NAMES.includes(v));
  const params = variables.filter((v) => !UNKNOWN_NAMES.includes(v));
  if (params.length !== 1 || unknowns.length === 0) return null;
  const a = params[0];
  const rows: RF[][] = [];
  for (const e of parsed) {
    const lc = linearOverParam(e, unknowns, a);
    if (!lc) return null;
    rows.push([...unknowns.map((u) => lc.coeff.get(u) ?? RF_ZERO), rfNeg(lc.constant)]);
  }
  const n = unknowns.length;
  const bail = (why: string): SystemSolution => ({ variables: unknowns, kind: "unsolved", steps: [], caveats: [why] });
  // Exact arithmetic over rational functions grows fast: bounded by name.
  // Measured before the cap: 5 unknowns with quadratic coefficients 2.7 s,
  // 6 unknowns 24 s, and 6 unknowns with degree-8 coefficients never
  // returned — in a task pane that recomputes per keystroke, a frozen Word.
  const MAX_PARAM_UNKNOWNS = 4, MAX_PARAM_DEGREE = n <= 2 ? 16 : 8;
  if (n > MAX_PARAM_UNKNOWNS) return bail(`A system with a parameter is solved exactly over rational functions of ${a}, which is bounded to ${MAX_PARAM_UNKNOWNS} unknowns; this one has ${n} (${unknowns.join(", ")}). Give ${a} a value, or reduce the system.`);
  let maxDeg = 0;
  for (const row of rows) for (const cell of row) maxDeg = Math.max(maxDeg, ratPolyTrim(cell.num).length - 1, ratPolyTrim(cell.den).length - 1);
  if (maxDeg > MAX_PARAM_DEGREE) return bail(`A system with a parameter is solved exactly over rational functions of ${a}, bounded to coefficient polynomials of degree ${MAX_PARAM_DEGREE}; this one reaches degree ${maxDeg}.`);
  // Values of the parameter where the equations themselves are undefined (a divisor vanishes).
  const undefinedAt = new Map<string, Rat>();
  for (const row of rows) for (const cell of row) if (ratPolyTrim(cell.den).length > 1) { for (const { root } of ratPolyRoots(cell.den).roots) undefinedAt.set(fmtRat(root), root); }
  const steps: string[] = [`${parsed.length} equation${parsed.length === 1 ? "" : "s"} in ${n} unknown${n === 1 ? "" : "s"} (${unknowns.join(", ")}) with the parameter ${a}: solved exactly over the rational functions of ${a} by row reduction.`];
  const caveats: string[] = [];
  // RREF over RF, recording each pivot's numerator (a polynomial in a) as a "≠ 0" condition.
  const pivotPolys: Rat[][] = [];
  const pivots: number[] = [];
  let r = 0;
  const m = rows.map((row) => row.slice());
  for (let col = 0; col < n && r < m.length; col++) {
    // Prefer a pivot that does not depend on the parameter: a pivot that
    // does would make its roots look like special values when a constant
    // alternative in the same column shows they are not.
    let piv = -1;
    for (let i = r; i < m.length; i++) if (!rfIsZero(m[i][col]) && ratPolyTrim(m[i][col].num).length === 1) { piv = i; break; }
    if (piv < 0) for (let i = r; i < m.length; i++) if (!rfIsZero(m[i][col])) { piv = i; break; }
    if (piv < 0) continue;
    [m[r], m[piv]] = [m[piv], m[r]];
    const p = m[r][col];
    if (ratPolyTrim(p.num).length > 1) pivotPolys.push(monic(ratPolyTrim(p.num)));
    for (let c = col; c <= n; c++) m[r][c] = rfDiv(m[r][c], p);
    for (let i = 0; i < m.length; i++) {
      if (i === r || rfIsZero(m[i][col])) continue;
      const f = m[i][col];
      for (let c = col; c <= n; c++) m[i][c] = rfSub(m[i][c], rfMul(f, m[r][c]));
    }
    pivots.push(col);
    r++;
  }
  const general: string[] = [];
  // Consistency in the generic case.
  for (let i = 0; i < m.length; i++) {
    if (m[i].slice(0, n).every(rfIsZero) && !rfIsZero(m[i][n])) {
      general.push(`Generic ${a}: no solution (a row reduces to 0 = ${rfText(m[i][n], a)}).`);
      // Still worth listing the special values where that right side vanishes.
      pivotPolys.push(monic(ratPolyTrim(m[i][n].num)));
      break;
    }
  }
  const freeIdx = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  const generic: string[] = [];
  if (!general.length) {
    pivots.forEach((c, i) => {
      let rhs = rfText(m[i][n], a);
      for (const f of freeIdx) {
        const co = m[i][f];
        if (rfIsZero(co)) continue;
        const t = rfText(rfNeg(co), a);
        rhs += ` + (${t})·${unknowns[f]}`;
      }
      generic.push(`${unknowns[c]} = ${rhs.replace(/^0 \+ /, "")}`);
    });
    for (const f of freeIdx) generic.push(`${unknowns[f]} is free`);
  }
  // Special values: rational roots of every pivot numerator and of the denominators in the answer.
  const specials = new Map<string, Rat>();
  let searchCapped = false;
  const addRoots = (p: Rat[]): void => { const { roots, incomplete } = ratPolyRoots(p); if (incomplete) searchCapped = true; for (const { root } of roots) specials.set(fmtRat(root), root); };
  for (const p of pivotPolys) addRoots(p);
  for (const row of m) for (const cell of row) if (ratPolyTrim(cell.den).length > 1) addRoots(cell.den);
  for (const [k, v] of undefinedAt) specials.set(k, v);
  const sorted = [...specials.entries()].sort((x, y) => ratToNumber(x[1]) - ratToNumber(y[1]));
  // Classify each special value by substituting it into the ORIGINAL
  // equations (a value next to a digit, "2a", needs an explicit ×).
  const classified: { label: string; line: string; covered: boolean }[] = [];
  const rfAt = (f: RF, v: Rat): Rat | null => { const d = ratPolyEval(f.den, v); return ratIsZero(d) ? null : ratDiv(ratPolyEval(f.num, v), d); };
  for (const [labelAscii, value] of sorted) {
    const label = labelAscii.replace("-", "−");
    if (undefinedAt.has(labelAscii)) { classified.push({ label, line: `${a} = ${label}: the equations are UNDEFINED (a divisor vanishes).`, covered: false }); continue; }
    const sub = equations.map((eq) => eq.replace(new RegExp(`(?<![A-Za-z_])${a}(?![A-Za-z0-9_])`, "g"), (_m: string, offset: number, str: string) => (/[0-9)]/.test(str[offset - 1] ?? "") ? `*(${fmtRat(value)})` : `(${fmtRat(value)})`)));
    const s = solveSystem(sub, unknowns);
    if (!s) { classified.push({ label, line: `${a} = ${label}: could not be classified.`, covered: false }); continue; }
    if (s.kind === "unique" && s.exact) {
      // If the generic formula is defined here and gives this very solution,
      // the value is not special at all — the pivot choice merely made it
      // look so. Say nothing and leave it out of the ∉ list.
      let covered = !general.length && freeIdx.length === 0;
      if (covered) {
        pivots.forEach((col, i) => { const v = rfAt(m[i][n], value); if (!v || fmtRat(v) !== s.exact![unknowns[col]]) covered = false; });
      }
      classified.push({ label, line: `${a} = ${label}: unique — ${unknowns.map((u) => `${u} = ${s.exact![u]}`).join(", ")}`, covered });
    }
    else if (s.kind === "none") classified.push({ label, line: `${a} = ${label}: NO solution (the equations contradict).`, covered: false });
    else if (s.kind === "infinite") classified.push({ label, line: `${a} = ${label}: INFINITELY MANY — ${(s.general ?? []).join("; ")}`, covered: false });
    else classified.push({ label, line: `${a} = ${label}: ${s.kind === "nonlinear" ? "not classified (the substituted system was not recognised as linear — a defect, please report the input)" : "could not be classified"}.`, covered: false });
  }
  const special = classified.filter((c) => !c.covered);
  const keptLabels = new Set(special.map((c) => c.label));
  const liveConditions = pivotPolys
    .filter((p) => ratPolyRoots(p).roots.some(({ root }) => keptLabels.has(fmtRat(root).replace("-", "−"))))
    .map((p) => `${polyStr(p, a)} ≠ 0`);
  if (!general.length) {
    general.push(`For ${special.length ? `${a} ∉ {${special.map((c) => c.label).join(", ")}}` : `every ${a}`}${liveConditions.length ? ` (${[...new Set(liveConditions)].join(", ")})` : ""}:`);
    general.push(...generic.map((g) => "  " + g));
  }
  for (const c of special) general.push(c.line);
  // Irrational special values exist only where a pivot polynomial has a real
  // root that is not rational: a leftover quadratic with negative discriminant
  // (a² + 1) vanishes nowhere real, and is no caveat.
  const mayHaveIrrational = pivotPolys.some((p) => {
    const rest = ratPolyTrim(ratPolyRoots(p).rest);
    if (rest.length <= 2) return false;
    if (rest.length === 3) { const disc = ratSub(ratMul(rest[1], rest[1]), ratMul(ratInt(4), ratMul(rest[2], rest[0]))); return ratSign(disc) >= 0; }
    return true;
  });
  if (mayHaveIrrational) caveats.push(`A pivot polynomial may also vanish at irrational values of ${a}; those special cases are not listed by value — substitute the number and solve.`);
  if (searchCapped) caveats.push(`The search for rational special values of ${a} was capped (large coefficients), so some may be missing.`);
  caveats.push(`${a} is read as a PARAMETER because it is not one of the usual unknown letters (x, y, z, w, u, v). The generic solution divides by expressions in ${a}; the listed special values are exactly where those vanish, each classified separately.`);
  return { variables: unknowns, kind: "parametric", parameter: a, general, steps, caveats };
}

/** Fixed starting values — deterministic, so results never vary between runs. */
const STARTS = [0, 1, -1, 2, -2, 0.5, -0.5, 3, -3, 5, -5, 10, -10];

/**
 * Start vectors, deliberately ASYMMETRIC across coordinates.
 *
 * Giving every coordinate the same value (or the same small offset) makes
 * symmetric systems degenerate: x² + y² = 25 with x + y = 7 has the two
 * solutions (3,4) and (4,3), and starts that treat x and y alike converge to
 * the same one every time — so only one of a symmetric pair gets found. Walking
 * the coordinates through the start list at different strides breaks that.
 */
function startVectors(n: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < STARTS.length; k++) {
    for (const stride of [0, 1, 3]) {
      const v = Array.from({ length: n }, (_, i) => STARTS[(k + i * stride) % STARTS.length]);
      // Nudge so an exactly-zero Jacobian at the origin is avoided.
      out.push(v.map((x, i) => x + (stride === 0 ? i * 0.37 : 0.11)));
    }
  }
  return out;
}

function newtonSystem(fs: Expr[], vars: string[]): Record<string, number>[] {
  const n = vars.length;
  const out: Record<string, number>[] = [];

  const evalAt = (x: number[]): number[] => {
    const env: Record<string, number> = {};
    vars.forEach((v, i) => (env[v] = x[i]));
    return fs.map((f) => {
      try { return evalAst(f, env); } catch { return NaN; }
    });
  };

  for (const start of startVectors(n)) {
    let x = start.slice();
    let ok = false;
    for (let iter = 0; iter < 200; iter++) {
      const f = evalAt(x);
      if (f.some((v) => !Number.isFinite(v))) break;
      const norm = Math.max(...f.map(Math.abs));
      if (norm < 1e-12) { ok = true; break; }
      // Numeric Jacobian by central differences.
      const J: number[][] = [];
      for (let i = 0; i < n; i++) J.push(new Array(n).fill(0));
      let bad = false;
      for (let j = 0; j < n && !bad; j++) {
        const h = Math.max(1e-7, Math.abs(x[j]) * 1e-7);
        const xp = x.slice(); xp[j] += h;
        const xm = x.slice(); xm[j] -= h;
        const fp = evalAt(xp), fm = evalAt(xm);
        for (let i = 0; i < n; i++) {
          const d = (fp[i] - fm[i]) / (2 * h);
          if (!Number.isFinite(d)) { bad = true; break; }
          J[i][j] = d;
        }
      }
      if (bad) break;
      const step = solveFloat(J, f.map((v) => -v));
      if (!step) break;
      let moved = 0;
      for (let i = 0; i < n; i++) { x[i] += step[i]; moved = Math.max(moved, Math.abs(step[i])); }
      if (!x.every(Number.isFinite)) break;
      if (moved < 1e-14) { ok = Math.max(...evalAt(x).map(Math.abs)) < 1e-9; break; }
    }
    if (!ok) continue;
    // Verify independently, then merge duplicates.
    const resid = evalAt(x);
    if (resid.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e-9)) continue;
    const rounded = x.map((v) => Math.round(v * 1e9) / 1e9);
    // MERGE AT THE ACCURACY ACTUALLY ACHIEVABLE, not far below it. Where the
    // Jacobian is singular at the root the function is flat there, so a
    // residual under 1e-9 is satisfied by points ~1e-4 away: sin(x) = x
    // reported the single root (0,1) as TWENTY-EIGHT distinct solutions, and
    // x^2 = y^2 = 0 reported the origin three times. Telling someone there are
    // 28 solutions when there is one is worse than finding none.
    const MERGE = 1e-3;
    if (out.some((prev) => vars.every((v, i) => Math.abs(prev[v] - rounded[i]) <= MERGE * (1 + Math.abs(rounded[i]))))) continue;
    const rec: Record<string, number> = {};
    vars.forEach((v, i) => (rec[v] = rounded[i]));
    out.push(rec);
  }
  return out;
}

/** Small dense float solve with partial pivoting, for the Newton step only. */
function solveFloat(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) return null; // singular Jacobian
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Splits a multi-line input into equations, ignoring blanks. */
export function splitEquations(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("="));
}

/** Names that look like unknowns but are reserved constants in this grammar. */
function reservedNamesIn(e: Expr): string[] {
  const out: string[] = [];
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (n.name === "e" || n.name === "pi") out.push(n.name); return;
      case "num": return;
      case "neg": return walk(n.e);
      case "fn": return walk(n.arg);
      default: walk(n.l); walk(n.r);
    }
  })(e);
  return out;
}
