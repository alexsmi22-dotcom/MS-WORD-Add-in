// Finite sums and the algebra verbs (factor / expand / simplify) for Solve.
//
// SUMS: closed forms only — Σk, Σk², Σk³, constants, and the geometric series,
// with numeric bounds computed EXACTLY in bigints and a symbolic upper bound n
// answered with the formula. The harmonic series is refused by name rather
// than approximated: "no elementary closed form" is an answer.
//
// VERBS: routing to machinery the CAS has had all along — rational-root
// factoring with multiplicity (ratPolyRoots), exact expansion
// (rational-coefficient polynomial arithmetic), casSimplify. Every factored or
// expanded result is VERIFIED by re-expansion against the original
// coefficients before it is shown; a factorisation that does not multiply
// back is discarded, not displayed.

import { parseExpr, evalAst, format, Expr } from "./solve";
import {
  Rat, ratMake, ratInt, ratAdd, ratMul, ratNeg, ratIsZero, ratToNumber, ratEq,
  ratFunctionInVar, ratPolyRoots, casSimplify, CasBail,
} from "./cas";
import { fmtRat } from "./geometry";
import { extractExpression, hasProseWords } from "./pasteMath";

export interface SumResult {
  title: string;
  /** The value (exact when bounds are numeric) or the closed-form formula. */
  display: string;
  numeric?: number;
  steps: string[];
  caveats: string[];
}

const BIG = (v: string): bigint => BigInt(v);

/** Σ k^p for k = 1..n, exactly, p ∈ {0,1,2,3}. */
function powerSum(p: number, n: bigint): bigint {
  switch (p) {
    case 0: return n;
    case 1: return (n * (n + 1n)) / 2n;
    case 2: return (n * (n + 1n) * (2n * n + 1n)) / 6n;
    default: {
      const t = (n * (n + 1n)) / 2n;
      return t * t;
    }
  }
}

/**
 * Reads a finite-sum request. Accepted forms (case-insensitive):
 *   sum of 1 to 100 · sum from 1 to 100
 *   sum k from 1 to 100 · sum k^2 from 1 to n · sum k^3 from 5 to 20
 *   sum r^k from 0 to n (geometric, symbolic) · sum 2^k from 0 to 10
 *   sum 1/k from 1 to n → refused BY NAME (harmonic, no elementary form)
 * Returns null when the text is not a sum request at all.
 */
export function trySum(input: string): SumResult | null {
  const text = input.trim().replace(/^Σ/i, "sum ");
  if (!/^sum\b/i.test(text)) return null;
  // No accepted sum form contains "=" — and a user whose VARIABLE is named
  // sum ("sum = 4") must keep the equation solver, not lose it to this parser.
  if (text.includes("=")) return null;

  // Harmonic — the honest refusal, checked before anything can misread it.
  const harm = /^sum\s+1\s*\/\s*([a-z])\s+from\s+1\s+to\s+(\w+)$/i.exec(text);
  if (harm) {
    return {
      title: `Σ 1/${harm[1]}, ${harm[1]} = 1 … ${harm[2]}`,
      display: "no elementary closed form",
      steps: [
        "The harmonic sum H_n = Σ 1/k has NO elementary closed form — it grows like ln(n) + γ, but that is an asymptotic, not a formula.",
      ],
      caveats: ["Refused rather than approximated. For a numeric value at a specific n, sum the terms directly."],
    };
  }

  // "sum of A to B" / "sum from A to B" — the plain arithmetic series Σ k.
  const plain = /^sum\s+(?:of|from)\s+(-?\d+)\s+to\s+(-?\d+)$/i.exec(text);
  if (plain) {
    return numericPowerSum(1, "k", plain[1], plain[2]);
  }

  // "sum of 3, 5, 8 and 12" — a plain total, added EXACTLY (decimals ride
  // rationals: 0.1 + 0.2 must display 0.3, not 0.30000000000000004).
  const list = /^sum\s+of\s+((?:-?\d+(?:\.\d+)?)(?:(?:\s*,\s*|\s+and\s+)-?\d+(?:\.\d+)?)+)[\s.?!]*$/i.exec(text);
  if (list) {
    const parts = list[1].split(/\s*,\s*|\s+and\s+/i);
    let acc = ratInt(0n);
    for (const p of parts) {
      const neg = p.startsWith("-");
      const body = neg ? p.slice(1) : p;
      let r: Rat;
      if (body.includes(".")) {
        const [w, fr] = body.split(".");
        r = ratMake(BIG(w + fr), 10n ** BigInt(fr.length));
      } else {
        r = ratInt(BIG(body));
      }
      acc = ratAdd(acc, neg ? ratNeg(r) : r);
    }
    return {
      title: `Sum of ${parts.length} values`,
      display: fmtRat(acc),
      numeric: ratToNumber(acc),
      steps: [`${parts.join(" + ").replace(/\+ -/g, "− ")} = ${fmtRat(acc)}`],
      caveats: [],
    };
  }

  // "sum k^p from A to B" with p ∈ {1 (implicit), 2, 3} — A,B numeric or upper symbolic.
  const pow = /^sum\s+([a-z])(?:\s*\^\s*([0-9]+))?\s+from\s+(-?\d+)\s+to\s+([a-z]\w*|-?\d+)$/i.exec(text);
  if (pow) {
    const p = pow[2] ? Number(pow[2]) : 1;
    if (p > 3) {
      return {
        title: `Σ ${pow[1]}^${p}`,
        display: "not built",
        steps: [`Closed forms are built through Σk³ (Faulhaber's formulas continue, but each degree is its own formula).`],
        caveats: ["Powers above 3 are refused by name rather than half-answered."],
      };
    }
    if (/^-?\d+$/.test(pow[4])) return numericPowerSum(p, pow[1], pow[3], pow[4]);
    // Symbolic upper bound: the formula, valid from 1.
    if (pow[3] !== "1") {
      return {
        title: `Σ ${pow[1]}${p > 1 ? `^${p}` : ""} from ${pow[3]} to ${pow[4]}`,
        display: "shift the lower bound to 1",
        steps: [
          `The closed forms below start at 1. Σ from ${pow[3]} to ${pow[4]} is (Σ from 1 to ${pow[4]}) − (Σ from 1 to ${Number(pow[3]) - 1}).`,
        ],
        caveats: [],
      };
    }
    const nUp = pow[4];
    const FORMULAE = [
      `${nUp}`,
      `${nUp}*(${nUp} + 1)/2`,
      `${nUp}*(${nUp} + 1)*(2*${nUp} + 1)/6`,
      `(${nUp}*(${nUp} + 1)/2)^2`,
    ];
    return {
      title: `Σ ${pow[1]}${p > 1 ? `^${p}` : ""}, ${pow[1]} = 1 … ${nUp}`,
      display: FORMULAE[p],
      steps: [
        p === 1 ? "The arithmetic series: n(n+1)/2."
          : p === 2 ? "The square-pyramidal formula: n(n+1)(2n+1)/6."
            : "The cube sum is the SQUARE of the triangular number: (n(n+1)/2)².",
      ],
      caveats: [],
    };
  }

  // Geometric: "sum r^k from 0 to n" (base symbolic or numeric).
  const geo = /^sum\s+([a-z0-9.\/]+)\s*\^\s*([a-z])\s+from\s+(0|1)\s+to\s+([a-z]\w*|\d+)$/i.exec(text);
  if (geo) {
    const base = geo[1], k = geo[2], lo = Number(geo[3]), up = geo[4];
    if (/^\d/.test(base) && /^\d+$/.test(up)) {
      // Fully numeric: exact rational value. The base must be EXACTLY one of
      // integer / decimal / fraction — "2.5.3" split naively kept "2" and "5"
      // and silently answered for 2.5, and 1/0 threw a raw CasBail.
      if (!/^(\d+|\d+\.\d+|\d+\/\d+)$/.test(base)) {
        return {
          title: `Σ ${base}^${k}`,
          display: "not read",
          steps: [],
          caveats: [`"${base}" is not a number this can read — use an integer (2), a decimal (0.5), or a fraction (1/2).`],
        };
      }
      if (/^\d+\/0+$/.test(base)) {
        return {
          title: `Σ ${base}^${k}`,
          display: "not read",
          steps: [],
          caveats: ["The base divides by zero."],
        };
      }
      let r: Rat;
      if (base.includes("/")) {
        const [a, b] = base.split("/");
        r = ratMake(BIG(a), BIG(b));
      } else if (base.includes(".")) {
        const [w, fr] = base.split(".");
        r = ratMake(BIG(w + fr), 10n ** BigInt(fr.length));
      } else {
        r = ratInt(BIG(base));
      }
      const n = Number(up);
      if (n - lo > 512) {
        return {
          title: `Σ ${base}^${k}`,
          display: "too many terms for the exact path",
          steps: [],
          caveats: [`${n - lo + 1} terms would build an enormous exact fraction; use r = ${base} in the formula (r^(n+1) − 1)/(r − 1) numerically.`],
        };
      }
      let acc = ratInt(0);
      let term = ratInt(1);
      for (let i = 0; i < lo; i++) term = ratMul(term, r);
      for (let i = lo; i <= n; i++) {
        acc = ratAdd(acc, term);
        term = ratMul(term, r);
      }
      return {
        title: `Σ ${base}^${k}, ${k} = ${lo} … ${n}`,
        display: fmtRat(acc),
        numeric: ratToNumber(acc),
        steps: [`Geometric series, summed exactly term by term (${n - lo + 1} terms).`],
        caveats: [],
      };
    }
    if (!/^\d/.test(base)) {
      const shift = lo === 1 ? ` − 1` : "";
      return {
        title: `Σ ${base}^${k}, ${k} = ${lo} … ${up}`,
        display: `(${base}^(${up} + 1) - 1)/(${base} - 1)${shift ? " - 1" : ""}`,
        steps: [
          `The geometric series: Σ r^k from 0 to n = (r^(n+1) − 1)/(r − 1).` +
          (lo === 1 ? " Starting at k = 1 subtracts the k = 0 term (which is 1)." : ""),
        ],
        caveats: [`Requires ${base} ≠ 1 — at ${base} = 1 the sum is simply the number of terms.`],
      };
    }
  }

  // The syntax help only fires for text that actually LOOKS like sum syntax
  // ("from … to", a power, a 1/k). Prose that merely starts with "sum of"
  // ("the sum of the interior angles of a hexagon") falls through to the
  // layers below instead of being taken hostage by this parser — the
  // cross-release sweep found every such question dead-ending here.
  if (/\bfrom\b[\s\S]*\bto\b/i.test(text) || text.includes("^") || /^sum\s+\d*\s*\//i.test(text)) {
    return {
      title: "Sum",
      display: "not read",
      steps: [],
      caveats: [
        "Couldn't read that sum. Accepted: sum of 1 to 100 · sum of 3, 5, 8 and 12 · sum k^2 from 1 to n · " +
        "sum k^3 from 1 to 20 · sum r^k from 0 to n · sum 2^k from 0 to 10. " +
        "Σ 1/k is refused by name (no elementary closed form).",
      ],
    };
  }
  return null;
}

function numericPowerSum(p: number, varName: string, loS: string, hiS: string): SumResult {
  const lo = BIG(loS), hi = BIG(hiS);
  if (lo > hi) {
    return {
      title: `Σ ${varName}${p > 1 ? `^${p}` : ""}, ${varName} = ${loS} … ${hiS}`,
      display: "0",
      numeric: 0,
      steps: [`The lower bound exceeds the upper, so this is the EMPTY sum, which is 0 by convention.`],
      caveats: [],
    };
  }
  // Σ from lo to hi = Σ(1..hi) − Σ(1..lo−1). The negative prefix is a CLOSED
  // FORM too — the first cut looped once per term, and a pasted
  // "sum k from -1000000000 to 0" would have frozen Word for a minute
  // (the unbounded-loops rule this codebase has already paid for).
  // Σ_{k=n+1}^{0} k^p for n ≤ 0 substitutes j = −k:
  //   p = 0 → count of terms = −n;  p ≥ 1 → (−1)^p · powerSum(p, −n−1).
  const negPrefix = (pp: number, n: bigint): bigint => {
    if (pp === 0) return n; // −(count) = −(−n) = n
    const inner = powerSum(pp, -n - 1n);
    return pp % 2 === 0 ? -inner : inner;
  };
  const pref = (n: bigint): bigint => (n >= 1n ? powerSum(p, n) : negPrefix(p, n));
  const total = pref(hi) - pref(lo - 1n);
  return {
    title: `Σ ${varName}${p > 1 ? `^${p}` : ""}, ${varName} = ${loS} … ${hiS}`,
    display: total.toString(),
    numeric: Number(total),
    steps: [
      p === 1 && lo === 1n
        ? `n(n+1)/2 with n = ${hiS}.`
        : `Σ(${loS}…${hiS}) = Σ(1…${hiS}) − Σ(1…${(lo - 1n).toString()}), each by the closed form.`,
    ],
    caveats: Number.isSafeInteger(Number(total)) ? [] : ["The exact value exceeds safe double precision; the digits shown are exact."],
  };
}

// ---------------------------------------------------------------------------
// The algebra verbs.
// ---------------------------------------------------------------------------

export interface VerbResult {
  title: string;
  /** Result lines; `math` marks ones worth typesetting. */
  lines: { text: string; math?: boolean }[];
  caveats: string[];
}

const fmtCoefTerm = (c: Rat, varName: string, k: number, first: boolean): string => {
  const neg = c.n < 0n;
  const mag = neg ? ratNeg(c) : c;
  const magS = fmtRat(mag);
  const xPart = k === 0 ? "" : k === 1 ? varName : `${varName}^${k}`;
  const coefPart = k > 0 && magS === "1" ? "" : `${magS}${k > 0 ? "*" : ""}`;
  const body = `${coefPart}${xPart}`;
  if (first) return neg ? `-${body}` : body;
  return `${neg ? "- " : "+ "}${body}`;
};

function polyString(coeffs: Rat[], varName: string): string {
  const parts: string[] = [];
  for (let k = coeffs.length - 1; k >= 0; k--) {
    if (ratIsZero(coeffs[k])) continue;
    parts.push(fmtCoefTerm(coeffs[k], varName, k, parts.length === 0));
  }
  return parts.length ? parts.join(" ") : "0";
}

/** The single variable of an expression, or null (pi/e are constants). */
function soleVar(e: Expr): string | null {
  const vars = new Set<string>();
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (n.name !== "pi" && n.name !== "e") vars.add(n.name); return;
      case "num": return;
      case "neg": return walk(n.e);
      case "fn": return walk(n.arg);
      default: walk(n.l); walk(n.r);
    }
  })(e);
  return vars.size === 1 ? [...vars][0] : null;
}

/**
 * factor / expand / simplify. Returns null when the input has no verb prefix;
 * a verb with an unusable body returns a NAMED refusal instead.
 */
export function tryAlgebraVerb(input: string): VerbResult | null {
  const m = /^(factor|expand|simplify)\b[:\s]\s*(.+)$/i.exec(input.trim());
  if (!m) return null;
  // "factor = 2" is an EQUATION whose variable happens to be named factor —
  // no verb grammar contains "=", so it falls through to the solver.
  if (m[2].includes("=")) return null;
  const verb = m[1].toLowerCase();
  const body = m[2].trim();
  const refuse = (why: string): VerbResult => ({
    title: `${verb} ${body}`,
    lines: [],
    caveats: [why],
  });

  // "factor the expression x² − 5x + 6": prose words PARSE as variables
  // (the·expression·x²), so the extraction must run BEFORE parsing — a parse
  // that cannot fail can never trigger a fallback.
  let effBody = body;
  if (hasProseWords(body)) {
    const ex = extractExpression(body);
    if (ex) effBody = ex;
  }
  let e: Expr;
  try {
    e = parseExpr(effBody);
  } catch (err) {
    return refuse(`Couldn't parse the expression: ${(err as Error).message}`);
  }

  if (verb === "simplify") {
    try {
      const s = casSimplify(e);
      const caveats = ["Simplification is the CAS's canonical form — algebraically equal, not necessarily the shortest possible writing."];
      if (body.includes("/")) {
        caveats.push(
          "Cancelling a factor can remove points where the ORIGINAL was undefined (0/0) — the equality is algebraic, not pointwise everywhere."
        );
      }
      return {
        title: `simplify ${body}`,
        lines: [{ text: format(s), math: true }],
        caveats,
      };
    } catch (err) {
      if (err instanceof CasBail) return refuse(`The CAS cannot canonicalise this: ${err.message}`);
      throw err;
    }
  }

  const x = soleVar(e);
  if (!x) return refuse(`${verb} works on a polynomial in ONE variable — this has ${soleVar(e) === null ? "none or several" : ""} (pi and e count as constants).`);
  const rf = ratFunctionInVar(e, x);
  if (!rf || rf.den.length !== 1 || !ratEq(rf.den[0], ratInt(1))) {
    // A constant non-1 denominator is fine — fold it into the numerator.
    if (rf && rf.den.length === 1 && !ratIsZero(rf.den[0])) {
      rf.num = rf.num.map((c) => ratMul(c, ratMake(rf.den[0].d, rf.den[0].n)));
      rf.den = [ratInt(1)];
    } else {
      return refuse(
        `${verb} needs a POLYNOMIAL in ${x} — this is not one (or divides by ${x}). ` +
        `Note: integer powers are handled up to ^64.`
      );
    }
  }
  const coeffs = rf.num;

  // EXACT verification: re-parse the result and compare coefficient lists in
  // rationals. The first cut checked 5 float sample points, and (x+1)^58 —
  // a CORRECT exact expansion — was refused because its >2^53 coefficients
  // cancel catastrophically at s = −1. Exact against exact, no floats.
  const sameCoeffs = (result: string): boolean => {
    let back;
    try {
      back = ratFunctionInVar(parseExpr(result), x);
    } catch {
      return false;
    }
    if (!back || back.den.length !== 1 || !ratEq(back.den[0], ratInt(1))) return false;
    if (back.num.length !== coeffs.length) return false;
    // Exact where possible; above 2^53 the PARSER stores doubles, so the
    // re-parsed value can only be the double of the exact coefficient —
    // accept that, and the output carries the precision caveat below.
    return back.num.every((c, i) => {
      if (ratEq(c, coeffs[i])) return true;
      const a = ratToNumber(c), b = ratToNumber(coeffs[i]);
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
    });
  };
  const beyondDouble = coeffs.some((c) => Math.abs(ratToNumber(c)) > 2 ** 53);

  if (verb === "expand") {
    const out = polyString(coeffs, x);
    if (!sameCoeffs(out)) {
      return refuse("Internal check failed — the expansion did not match the original exactly, so it is not shown.");
    }
    return {
      title: `expand ${body}`,
      lines: [{ text: `${out}`, math: true }],
      caveats: beyondDouble
        ? ["Some coefficients exceed 2⁵³: the DIGITS shown are exact, but re-typing them into a float calculator loses precision past 15 digits."]
        : [],
    };
  }

  // factor
  const { roots, rest, incomplete } = ratPolyRoots(coeffs);
  if (!roots.length && rest.length === coeffs.length) {
    return {
      title: `factor ${body}`,
      lines: [{ text: polyString(coeffs, x), math: true }],
      caveats: [
        incomplete
          ? "The rational-root search was capped, so a rational factor may exist beyond it — this is 'not found', not 'proven none'."
          : "No RATIONAL roots exist (checked exhaustively), so there are no linear factors with rational coefficients. Irrational or complex factorisations are not attempted.",
      ],
    };
  }
  const lead = rest.length ? rest[rest.length - 1] : ratInt(1);
  const factors: string[] = [];
  for (const r of roots) {
    const root = r.root;
    const term = ratIsZero(root)
      ? x
      : `(${x} ${root.n < 0n ? "+" : "-"} ${fmtRat(root.n < 0n ? ratNeg(root) : root)})`;
    factors.push(r.mult > 1 ? `${term}^${r.mult}` : term);
  }
  // Remaining polynomial after deflation (monic-ish handling): rest holds the
  // deflated remainder INCLUDING its leading coefficient.
  let head = "";
  let tail = "";
  if (rest.length > 1) {
    tail = `*(${polyString(rest, x)})`;
  } else if (ratEq(lead, ratInt(-1))) {
    head = "-"; // "-(x - 1)*(x + 1)", not "-1*(…)"
  } else if (!ratEq(lead, ratInt(1))) {
    head = `${fmtRat(lead)}*`;
  }
  const factored = `${head}${factors.join("*")}${tail}`;
  // THE ANTI-LIE CHECK, exact: the factored form must multiply back to the
  // ORIGINAL coefficient list, rational against rational.
  if (!sameCoeffs(factored)) {
    return refuse("Internal check failed — the factorisation did not multiply back to the original, so it is not shown.");
  }
  const caveats: string[] = [];
  if (rest.length > 1) {
    caveats.push(
      incomplete
        ? "The remaining factor's rational-root search was capped — it may factor further."
        : "The remaining factor has no rational roots (checked exhaustively); it may still factor over the reals (e.g. x² − 2) — only RATIONAL factorisation is claimed."
    );
  }
  return {
    title: `factor ${body}`,
    lines: [{ text: factored, math: true }],
    caveats,
  };
}
