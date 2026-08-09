// Inequalities — the CAS brief's "later" list.
//
// THE METHOD is the only one that is actually correct for rational functions:
// move everything to one side, find every point where the expression can change
// sign — the roots of the NUMERATOR and, crucially, the roots of the
// DENOMINATOR — sort them, and test the sign on each open interval between.
//
// THE POLES ARE THE WHOLE DIFFICULTY. Multiplying `1/(x−2) > 0` through by
// (x−2) is the classic student error, because the direction of the inequality
// depends on a sign you do not know; and a pole is a place where the expression
// is UNDEFINED, so it can never be part of the solution set even when the
// inequality is non-strict. Both are handled here by construction: nothing is
// multiplied through, and a denominator root is always excluded.
//
// Endpoints follow from the comparison rather than being guessed: a root of the
// numerator is INCLUDED for ≤ and ≥ and EXCLUDED for < and >; a root of the
// denominator is excluded either way.

import { parseExpr, evalAst, format, Expr, domainHoles, foldAbsBars } from "./solve";
import {
  Rat, ratToNumber, ratIsZero, ratFromNumber,
  ratFunctionInVar, ratPolyRoots, ratPolyEval,
} from "./cas";
import { fmtRat } from "./geometry";

export type Comparison = "<" | "<=" | ">" | ">=" | "!=";

export interface Interval {
  lo: number | "-inf";
  hi: number | "inf";
  loClosed: boolean;
  hiClosed: boolean;
  /** Exact endpoint forms when the roots were rational. */
  loExact?: string;
  hiExact?: string;
}

export interface InequalityResult {
  expression: string;
  comparison: Comparison;
  variable: string;
  /** The solution set. Empty means no value satisfies it. */
  intervals: Interval[];
  display: string;
  /** Points where the expression is undefined — never in the solution. */
  poles: number[];
  steps: string[];
  caveats: string[];
  exact: boolean;
}

const OPPOSITE: Record<Comparison, Comparison> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "!=": "!=" };

/** Splits "expr <= expr" into its parts. */
export function parseInequality(text: string): { lhs: string; cmp: Comparison; rhs: string } | null {
  const m = /^(.*?)(<=|>=|!=|≤|≥|≠|<|>)(.*)$/.exec(text);
  if (!m) return null;
  const raw = m[2];
  const cmp: Comparison =
    raw === "≤" ? "<=" : raw === "≥" ? ">=" : raw === "≠" ? "!=" : (raw as Comparison);
  const lhs = m[1].trim(), rhs = m[3].trim();
  if (!lhs || !rhs) return null;
  return { lhs, cmp, rhs };
}

const fmtEnd = (v: number | "inf" | "-inf"): string =>
  v === "inf" ? "∞" : v === "-inf" ? "−∞" : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));

function fmtInterval(i: Interval): string {
  const l = `${i.loClosed ? "[" : "("}${i.loExact ?? fmtEnd(i.lo)}`;
  const h = `${i.hiExact ?? fmtEnd(i.hi)}${i.hiClosed ? "]" : ")"}`;
  return `${l}, ${h}`;
}

/** Intersection of two interval lists — for chained and |·| < c inequalities. */
function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  const loVal = (i: Interval): number => (i.lo === "-inf" ? -Infinity : i.lo);
  const hiVal = (i: Interval): number => (i.hi === "inf" ? Infinity : i.hi);
  for (const p of a) {
    for (const q of b) {
      const lo = Math.max(loVal(p), loVal(q));
      const hi = Math.min(hiVal(p), hiVal(q));
      if (lo > hi) continue;
      const loFrom = loVal(p) >= loVal(q) ? p : q;
      const hiFrom = hiVal(p) <= hiVal(q) ? p : q;
      const loClosed = (loVal(p) === loVal(q) ? p.loClosed && q.loClosed : loFrom.loClosed);
      const hiClosed = (hiVal(p) === hiVal(q) ? p.hiClosed && q.hiClosed : hiFrom.hiClosed);
      if (lo === hi && !(loClosed && hiClosed)) continue;
      out.push({
        lo: lo === -Infinity ? "-inf" : lo,
        hi: hi === Infinity ? "inf" : hi,
        loClosed: lo === -Infinity ? false : loClosed,
        hiClosed: hi === Infinity ? false : hiClosed,
        loExact: lo === -Infinity ? undefined : loFrom.loExact,
        hiExact: hi === Infinity ? undefined : hiFrom.hiExact,
      });
    }
  }
  return out.sort((x, y) => (x.lo === "-inf" ? -Infinity : x.lo) - (y.lo === "-inf" ? -Infinity : y.lo));
}

const fmtIntervalPub = (i: Interval): string => fmtInterval(i);

/**
 * Chained inequalities — the most common Algebra-1 shape: −3 < 2x+1 ≤ 7.
 * Split at the two comparators, solve each side, INTERSECT the solution sets.
 * A chain whose comparators point in different directions is refused by name.
 */
function solveChained(text: string, variable?: string): InequalityResult | null {
  const m = /^(.*?)(<=|>=|≤|≥|<|>)(.*?)(<=|>=|≤|≥|<|>)(.*)$/.exec(text);
  if (!m) return null;
  const norm = (raw: string): Comparison =>
    raw === "≤" ? "<=" : raw === "≥" ? ">=" : (raw as Comparison);
  const [, aTxt, op1raw, fTxt, op2raw, cTxt] = m;
  const op1 = norm(op1raw), op2 = norm(op2raw);
  if (!aTxt.trim() || !fTxt.trim() || !cTxt.trim()) return null;
  // Exactly two comparators. "a < b < c < d" spirals into misreads otherwise.
  if (/[<>≤≥]/.test(cTxt) || /[<>≤≥]/.test(aTxt) || /[<>≤≥]/.test(fTxt)) return null;
  const dir1 = op1 === "<" || op1 === "<=";
  const dir2 = op2 === "<" || op2 === "<=";
  if (dir1 !== dir2) {
    return {
      expression: text, comparison: op1, variable: variable ?? "x",
      intervals: [], display: "refused", poles: [], exact: false,
      steps: [],
      caveats: [
        `A chained inequality must run one way (a < f < b or a > f > b) — "${op1}" then "${op2}" ` +
        "mixes directions, and there is no single region it names.",
      ],
    };
  }
  // a op1 f  ⇔  f OPPOSITE(op1) a.
  const left = solveInequality(`${fTxt} ${OPPOSITE[op1]} ${aTxt}`, variable);
  const right = solveInequality(`${fTxt} ${op2} ${cTxt}`, variable);
  if (!left || !right) return null;
  const intervals = intersectIntervals(left.intervals, right.intervals);
  return {
    expression: text,
    comparison: op2,
    variable: right.variable,
    intervals,
    display: intervals.length ? intervals.map(fmtIntervalPub).join(" ∪ ") : "∅ (no solution)",
    poles: [...new Set([...left.poles, ...right.poles])].sort((x, y) => x - y),
    steps: [
      `A chained inequality is TWO conditions holding at once: ${fTxt.trim()} ${OPPOSITE[op1]} ${aTxt.trim()} AND ${fTxt.trim()} ${op2} ${cTxt.trim()}.`,
      `First condition: ${left.display}.`,
      `Second condition: ${right.display}.`,
      "The answer is their INTERSECTION.",
    ],
    caveats: [...new Set([...left.caveats, ...right.caveats])],
    exact: left.exact && right.exact,
  };
}

/**
 * Absolute-value inequalities, by the definition rather than a sign scan:
 * |g| < c  ⇔  −c < g < c (intersection);  |g| > c  ⇔  g > c OR g < −c (union).
 * A negative c makes the answer immediate and NAMED in both directions.
 */
function solveAbsInequality(text: string, variable?: string): InequalityResult | null {
  const parts = parseInequality(text);
  if (!parts || parts.cmp === "!=") return null;
  // Accept abs(...) on either side; normalise to abs(g) cmp c.
  type StrictCmp = Exclude<Comparison, "!=">;
  let absSide = parts.lhs.trim(), constSide = parts.rhs.trim();
  let cmp: StrictCmp = parts.cmp as StrictCmp;
  const isAbsCall = (s: string): boolean => /^abs\(.*\)$/.test(s);
  if (!isAbsCall(absSide) && isAbsCall(constSide)) {
    [absSide, constSide] = [constSide, absSide];
    cmp = OPPOSITE[cmp] as StrictCmp; // the opposite of a strict/loose order is never "!="
  }
  if (!isAbsCall(absSide)) return null;
  let g: Expr, cE: Expr;
  try {
    g = parseExpr(absSide.slice(4, -1));
    cE = parseExpr(constSide);
  } catch {
    return null;
  }
  let c: number;
  try { c = evalAst(cE, {}); } catch { return null; }
  if (!Number.isFinite(c)) return null;
  const gTxt = absSide.slice(4, -1);
  const vars = new Set<string>();
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (n.name !== "pi" && n.name !== "e") vars.add(n.name); return;
      case "num": return;
      case "neg": return walk(n.e);
      case "fn": return walk(n.arg);
      default: walk(n.l); walk(n.r);
    }
  })(g);
  const x = variable ?? [...vars][0];
  if (!x || vars.size > 1) return null;

  const lessLike = cmp === "<" || cmp === "<=";
  if (c < 0) {
    return {
      expression: text, comparison: cmp, variable: x,
      intervals: lessLike ? [] : [{ lo: "-inf", hi: "inf", loClosed: false, hiClosed: false }],
      display: lessLike ? "∅ (no solution)" : "(−∞, ∞)",
      poles: [], exact: true,
      steps: [
        lessLike
          ? `|·| is never negative, so |${gTxt}| ${cmp} ${fmtEnd(c)} holds NOWHERE.`
          : `|·| is never negative, so |${gTxt}| ${cmp} ${fmtEnd(c)} holds for EVERY real ${x}.`,
      ],
      caveats: [],
    };
  }
  if (lessLike) {
    const a = solveInequality(`${gTxt} ${cmp} ${constSide}`, x);
    const b = solveInequality(`${gTxt} ${cmp === "<" ? ">" : ">="} -(${constSide})`, x);
    if (!a || !b) return null;
    const intervals = intersectIntervals(a.intervals, b.intervals);
    return {
      expression: text, comparison: cmp, variable: x, intervals,
      display: intervals.length ? intervals.map(fmtIntervalPub).join(" ∪ ") : "∅ (no solution)",
      poles: [...new Set([...a.poles, ...b.poles])].sort((p, q) => p - q),
      steps: [
        `|${gTxt}| ${cmp} ${constSide} means BOTH ${gTxt} ${cmp} ${constSide} AND ${gTxt} ${cmp === "<" ? ">" : ">="} −(${constSide}) — the definition of absolute value, no cases guessed.`,
        `The answer is the intersection.`,
      ],
      caveats: [...new Set([...a.caveats, ...b.caveats])],
      exact: a.exact && b.exact,
    };
  }
  const a = solveInequality(`${gTxt} ${cmp} ${constSide}`, x);
  const b = solveInequality(`${gTxt} ${cmp === ">" ? "<" : "<="} -(${constSide})`, x);
  if (!a || !b) return null;
  const merged = [...a.intervals, ...b.intervals].sort(
    (p, q) => (p.lo === "-inf" ? -Infinity : p.lo) - (q.lo === "-inf" ? -Infinity : q.lo)
  );
  return {
    expression: text, comparison: cmp, variable: x, intervals: merged,
    display: merged.length ? merged.map(fmtIntervalPub).join(" ∪ ") : "∅ (no solution)",
    poles: [...new Set([...a.poles, ...b.poles])].sort((p, q) => p - q),
    steps: [
      `|${gTxt}| ${cmp} ${constSide} means ${gTxt} ${cmp} ${constSide} OR ${gTxt} ${cmp === ">" ? "<" : "<="} −(${constSide}) — the two sides of zero, by definition.`,
      `The answer is the union.`,
    ],
    caveats: [...new Set([...a.caveats, ...b.caveats])],
    exact: a.exact && b.exact,
  };
}

/**
 * Solves a polynomial or rational inequality exactly.
 * Returns null when the expression is not a rational function of one variable —
 * transcendental inequalities are refused rather than approximated.
 */
export function solveInequality(textRaw: string, variable?: string): InequalityResult | null {
  // |x − 1| < 3 must reach the abs machinery, whose shape test reads the TEXT
  // — so the bar fold happens here, before any dispatch, not only in the
  // parser.
  const text = foldAbsBars(textRaw);
  // Chained (-3 < 2x+1 <= 7) and absolute-value shapes first — both reduce to
  // ordinary inequalities and set operations on the results.
  const chained = solveChained(text, variable);
  if (chained) return chained;
  const viaAbs = solveAbsInequality(text, variable);
  if (viaAbs) return viaAbs;
  return solveInequalityCore(text, variable);
}

function solveInequalityCore(text: string, variable?: string): InequalityResult | null {
  const parts = parseInequality(text);
  if (!parts) return null;
  let lhs: Expr, rhs: Expr;
  try {
    lhs = parseExpr(parts.lhs);
    rhs = parseExpr(parts.rhs);
  } catch {
    return null;
  }
  // Everything to one side: f = LHS − RHS, then ask about the sign of f.
  const f: Expr = { t: "sub", l: lhs, r: rhs };
  const vars = new Set<string>();
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (n.name !== "pi" && n.name !== "e") vars.add(n.name); return;
      case "num": return;
      case "neg": return walk(n.e);
      case "fn": return walk(n.arg);
      default: walk(n.l); walk(n.r);
    }
  })(f);
  const x = variable ?? [...vars][0];
  if (!x || vars.size > 1) return null;

  const rf = ratFunctionInVar(f, x);
  if (!rf) return null; // not a rational function: refuse rather than guess

  const steps: string[] = [];
  const caveats: string[] = [];
  steps.push(`Move everything to one side: the question becomes the SIGN of (${format(f)}).`);

  // Critical points: numerator roots (where f = 0) and denominator roots (poles).
  const numRoots = ratPolyRoots(rf.num);
  const denRoots = ratPolyRoots(rf.den);
  const zeros = numRoots.roots.map((r) => ({ v: ratToNumber(r.root), exact: fmtRat(r.root), pole: false }));
  const poles = denRoots.roots.map((r) => ({ v: ratToNumber(r.root), exact: fmtRat(r.root), pole: true }));

  // HOLES THE CANCELLATION ERASED. ratFunctionInVar reduces by the GCD, so
  // (x²−1)/(x−1) arrives here with no denominator at all — yet the ORIGINAL
  // expression is 0/0 at x = 1, and `>= 0` answering [−1, ∞) with the hole
  // included was a wrong answer, not an unpolished one. The unreduced AST is
  // the authority on where the expression is defined.
  for (const h of domainHoles(f, x)) {
    if (!poles.some((p) => Math.abs(p.v - h) < 1e-9)) {
      poles.push({
        v: h,
        exact: Number.isInteger(h) ? String(h) : String(Number(h.toPrecision(10))),
        pole: true,
      });
    }
  }
  poles.sort((a, b) => a.v - b.v);

  // IRRATIONAL REAL ROOTS MUST STILL BE FOUND. ratPolyRoots returns only
  // RATIONAL roots, so x³ + x + 1 — whose only real root is about −0.682 —
  // yielded no critical point at all and the whole real line was reported as
  // satisfying `> 0`. That is a wrong answer, not an incomplete one. So the
  // function is scanned for sign changes the rational roots do not explain, and
  // any found are located by bisection and used as critical points.
  const known = [...zeros, ...poles].map((c) => c.v);
  const approx = findExtraSignChanges(f, x, known);
  let approximate = false;
  if (approx.length) {
    approximate = true;
    steps.push(
      `Sign changes at ${approx.map((v) => v.toPrecision(6)).join(", ")} are not at rational points, so they were located numerically.`
    );
  }

  const critical = [
    ...zeros,
    ...poles,
    ...approx.map((v) => ({ v, exact: String(Number(v.toPrecision(10))), pole: false })),
  ].sort((a, b) => a.v - b.v);
  const uniq: typeof critical = [];
  for (const c of critical) {
    const prev = uniq[uniq.length - 1];
    if (prev && Math.abs(prev.v - c.v) < 1e-12) { prev.pole = prev.pole || c.pole; continue; }
    uniq.push({ ...c });
  }

  if (poles.length) {
    steps.push(
      `The denominator vanishes at ${poles.map((p) => `${x} = ${p.exact}`).join(", ")}, so the expression is UNDEFINED there. Those points are excluded whatever the comparison — and note nothing was multiplied through, which is what makes that correct.`
    );
  }
  steps.push(
    uniq.length
      ? `Critical points: ${uniq.map((c) => `${c.exact}${c.pole ? " (pole)" : ""}`).join(", ")}. The sign can only change at these.`
      : "There are no critical points, so the sign is the same everywhere."
  );

  // Sample the sign strictly inside each interval.
  const bounds: (number | null)[] = [null, ...uniq.map((c) => c.v), null];
  const sample = (lo: number | null, hi: number | null): number => {
    if (lo === null && hi === null) return 0;
    if (lo === null) return hi! - 1;
    if (hi === null) return lo + 1;
    return (lo + hi) / 2;
  };
  const evalF = (v: number): number => {
    try {
      const r = evalAst(f, { [x]: v });
      return Number.isFinite(r) ? r : NaN;
    } catch {
      return NaN;
    }
  };
  const satisfies = (s: number): boolean => {
    switch (parts.cmp) {
      case "<": return s < 0;
      case "<=": return s < 0;
      case ">": return s > 0;
      case ">=": return s > 0;
      case "!=": return s !== 0;
    }
  };

  const intervals: Interval[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const s = evalF(sample(lo, hi));
    if (Number.isNaN(s) || !satisfies(s)) continue;
    const loC = uniq[i - 1];
    const hiC = uniq[i];
    intervals.push({
      lo: lo === null ? "-inf" : lo,
      hi: hi === null ? "inf" : hi,
      // A numerator root joins the set for ≤/≥; a POLE never does.
      loClosed: lo !== null && !!loC && !loC.pole && (parts.cmp === "<=" || parts.cmp === ">="),
      hiClosed: hi !== null && !!hiC && !hiC.pole && (parts.cmp === "<=" || parts.cmp === ">="),
      loExact: lo === null ? undefined : loC?.exact,
      hiExact: hi === null ? undefined : hiC?.exact,
    });
  }

  // For ≤ / ≥ the zeros themselves belong to the set, including isolated ones.
  if (parts.cmp === "<=" || parts.cmp === ">=") {
    for (const z of uniq) {
      if (z.pole) continue;
      const inside = intervals.some(
        (iv) => (iv.lo === "-inf" || z.v > iv.lo || (z.v === iv.lo && iv.loClosed)) &&
                (iv.hi === "inf" || z.v < iv.hi || (z.v === iv.hi && iv.hiClosed))
      );
      if (!inside) {
        intervals.push({ lo: z.v, hi: z.v, loClosed: true, hiClosed: true, loExact: z.exact, hiExact: z.exact });
      }
    }
    intervals.sort((a, b) => (a.lo === "-inf" ? -Infinity : a.lo) - (b.lo === "-inf" ? -Infinity : b.lo));
  }

  // x^2 >= 0 produced (−inf, 0] and [0, inf) as two pieces; they are one set.
  const merged = mergeIntervals(intervals);
  intervals.length = 0;
  intervals.push(...merged);

  const display = intervals.length
    ? intervals.map(fmtInterval).join(" ∪ ")
    : "no value satisfies this";

  if (!intervals.length) {
    caveats.push("NO value of the variable satisfies this inequality. That is the answer, not a failure to find one.");
  }
  if (approximate) {
    caveats.push(
      "Some critical points were located NUMERICALLY because they are not rational, so the endpoints shown are approximate to about ten digits. The shape of the answer — which intervals, and which endpoints are included — is right; the endpoint values are rounded."
    );
  }
  caveats.push(
    "Solved by SIGN ANALYSIS on the critical points — nothing was multiplied through by an expression whose sign is unknown, which is the usual way this goes wrong."
  );

  return {
    expression: format(f),
    comparison: parts.cmp,
    variable: x,
    intervals,
    display,
    poles: poles.map((p) => p.v),
    steps,
    caveats,
    exact: !approximate,
  };
}

/**
 * Sign changes of `f` that the known critical points do not account for.
 *
 * Rational-root finding sees only rational roots, so a cubic like x³ + x + 1
 * contributes no critical point and its interval comes out wrong. Scanning for
 * sign changes catches those, and bisection locates them. A scan cannot prove
 * there are none — so a result relying on it is marked approximate — but it
 * turns a silently wrong answer into an approximately right one.
 */
function findExtraSignChanges(f: Expr, x: string, known: number[]): number[] {
  const evalF = (v: number): number => {
    try {
      const r = evalAst(f, { [x]: v });
      return Number.isFinite(r) ? r : NaN;
    } catch {
      return NaN;
    }
  };
  const span = Math.max(10, ...known.map((k) => Math.abs(k) * 2 + 5));
  const STEPS = 2000;
  const out: number[] = [];
  let prevX = -span;
  let prevY = evalF(prevX);
  for (let i = 1; i <= STEPS; i++) {
    const cx = -span + (2 * span * i) / STEPS;
    const cy = evalF(cx);
    if (Number.isFinite(prevY) && Number.isFinite(cy) && prevY * cy < 0) {
      // Skip a change already explained by a known root or pole in this cell.
      if (!known.some((k) => k > prevX - 1e-9 && k < cx + 1e-9)) {
        let a = prevX, b = cx, fa = prevY;
        for (let it = 0; it < 100; it++) {
          const m = (a + b) / 2;
          const fm = evalF(m);
          if (!Number.isFinite(fm)) break;
          if (Math.abs(fm) < 1e-14 || (b - a) / 2 < 1e-12) { a = m; b = m; break; }
          if (fa * fm < 0) b = m; else { a = m; fa = fm; }
        }
        const root = (a + b) / 2;
        if (!out.some((v) => Math.abs(v - root) < 1e-7)) out.push(root);
      }
    }
    prevX = cx;
    prevY = cy;
  }
  return out;
}

/** Merges intervals that touch at a shared closed endpoint. */
function mergeIntervals(list: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of list) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.hi !== "inf" && iv.lo !== "-inf" &&
      Math.abs((prev.hi as number) - (iv.lo as number)) < 1e-12 &&
      (prev.hiClosed || iv.loClosed)
    ) {
      prev.hi = iv.hi;
      prev.hiClosed = iv.hiClosed;
      prev.hiExact = iv.hiExact;
      continue;
    }
    out.push({ ...iv });
  }
  return out;
}
