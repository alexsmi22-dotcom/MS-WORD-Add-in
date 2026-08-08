// Show your work: line-by-line derivations for Solve results, the way a
// student would be required to write them — collect, isolate, factor,
// substitute into the formula, apply the named differentiation rule,
// evaluate F at the bounds.
//
// THE WORK IS DERIVED FROM THE ENGINE'S OWN ANSWER, AND VERIFIED AGAINST IT.
// Every function here checks its final line against the result the engine
// computed (numerically, at sample points); on any mismatch it returns NO
// work rather than plausible-looking algebra that disagrees with the answer
// — wrong work under a right answer is worse than no work.

import {
  Expr,
  parseExpr,
  evalAst,
  derivative as derivAst,
  simplify,
  format,
  polyCoeffs,
  freeVars,
  EquationResult,
  IntegralResult,
} from "./solve";

export interface WorkLine {
  text?: string;
  math?: string;
}

const TOL = 1e-9;

/** Trims a float for display: integers plain, else up to 6 significant digits. */
function fmtN(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const r = Number(v.toPrecision(6));
  return String(r);
}

/** ax term with a human coefficient: 1→x, −1→−x, else 3x. */
function coefTerm(a: number, v: string, power = 1): string {
  const p = power === 1 ? v : `${v}^${power}`;
  if (a === 1) return p;
  if (a === -1) return `-${p}`;
  return `${fmtN(a)}${p}`;
}

/** Is this root display a plain rational the factoring form can show? */
function rationalDisplay(d: string): boolean {
  return /^-?\d+(\/\d+)?$/.test(d);
}

// ---------------------------------------------------------------------------
// Equations.

/**
 * Worked solution for a single-variable polynomial equation, from the same
 * parsed form the engine solved. Rearrangements and transcendental equations
 * return [] — their honest work is the engine's own verified isolation steps,
 * already reported.
 */
export function equationWork(input: string, result: EquationResult): WorkLine[] {
  if (!result.roots.length) return [];
  const sides = input.split("=");
  if (sides.length !== 2) return [];
  let e: Expr;
  try {
    e = parseExpr(`(${sides[0]}) - (${sides[1]})`);
  } catch {
    return [];
  }
  const v = result.variable;
  if (freeVars(e).some((x) => x !== v)) return []; // symbolic rearrangement — engine steps own it
  const coeffs = polyCoeffs(e, v);
  if (!coeffs) return [];
  // Trim trailing zero coefficients to the true degree.
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < TOL) coeffs.pop();
  const degree = coeffs.length - 1;

  if (degree === 1) {
    const [c0, c1] = coeffs;
    const rhs = -c0;
    const root = rhs / c1;
    // The final line must BE the engine's answer.
    const engineRoot = result.roots[0];
    if (!Number.isFinite(engineRoot.re) || Math.abs(engineRoot.re - root) > 1e-6 * Math.max(1, Math.abs(root))) return [];
    // "x = 5" needs no work — showing "collect… x = 5" then "x = 5" again is noise.
    if (c1 === 1 && /^\s*[A-Za-z]\w*\s*=/.test(input)) return [];
    const lines: WorkLine[] = [];
    lines.push({ text: `Collect the ${v} terms on the left and the constants on the right:` });
    lines.push({ math: `${coefTerm(c1, v)} = ${fmtN(rhs)}` });
    if (c1 !== 1) {
      lines.push({ text: `Divide both sides by ${fmtN(c1)}:` });
    }
    lines.push({ math: `${v} = ${engineRoot.display}` });
    return lines;
  }

  if (degree === 2) {
    const [c0, c1, c2] = coeffs;
    const lines: WorkLine[] = [];
    const std = [coefTerm(c2, v, 2), c1 ? ` ${c1 > 0 ? "+" : "-"} ${coefTerm(Math.abs(c1), v)}` : "", c0 ? ` ${c0 > 0 ? "+" : "-"} ${fmtN(Math.abs(c0))}` : ""].join("");
    lines.push({ text: "Standard form:" });
    lines.push({ math: `${std} = 0` });

    // Factoring, when both roots are plain rationals — the way it would be
    // done by hand. Verified by expanding at sample points before showing.
    const [r1, r2] = result.roots;
    const factor = (d: string): string => (d === "0" ? v : d.startsWith("-") ? `(${v} + ${d.slice(1)})` : `(${v} - ${d})`);
    const leadPrefix = (a: number): string => (a === 1 ? "" : a === -1 ? "-" : fmtN(a));
    if (r1 && r2 && rationalDisplay(r1.display) && rationalDisplay(r2.display)) {
      const shown = `${leadPrefix(c2)}${factor(r1.display)}${factor(r2.display)}`;
      const ok = [0.7, 1.3, -2.1].every((x) => {
        const lhs = c2 * (x - r1.re) * (x - r2.re);
        const rhs = c2 * x * x + c1 * x + c0;
        return Math.abs(lhs - rhs) <= 1e-6 * Math.max(1, Math.abs(rhs));
      });
      if (ok) {
        lines.push({ text: "Factor:" });
        lines.push({ math: `${shown} = 0` });
        lines.push({ text: "A product is zero exactly when one of its factors is zero:" });
        return lines;
      }
    }

    const disc = c1 * c1 - 4 * c2 * c0;
    // A zero discriminant means one repeated root — the formula with ± around
    // sqrt(0) reads as two answers that happen to agree; say what it is.
    if (disc === 0 && r1) {
      lines.push({ text: "The discriminant b² − 4ac is zero, so there is ONE repeated root:" });
      lines.push({ math: `${v} = ${r1.display}` });
      return lines;
    }
    // Otherwise the quadratic formula, with the numbers substituted.
    const denom = 2 * c2 === 1 ? "" : `/${fmtN(2 * c2)}`;
    lines.push({ text: `Quadratic formula with a = ${fmtN(c2)}, b = ${fmtN(c1)}, c = ${fmtN(c0)}:` });
    lines.push({ math: `${v} = (-b ± sqrt(b^2 - 4 a c))/(2 a)` });
    lines.push({ math: `${v} = (${fmtN(-c1)} ± sqrt(${fmtN(disc)}))${denom}` });
    if (disc < 0) lines.push({ text: "The discriminant is negative, so the roots are a complex conjugate pair." });
    return lines;
  }

  // Degree ≥ 3: factoring display when every root is a plain rational.
  if (degree >= 3 && result.roots.length === degree && result.roots.every((r) => rationalDisplay(r.display))) {
    const lead = coeffs[degree];
    const factor = (d: string): string => (d === "0" ? v : d.startsWith("-") ? `(${v} + ${d.slice(1)})` : `(${v} - ${d})`);
    const shown = `${lead === 1 ? "" : lead === -1 ? "-" : fmtN(lead)}${result.roots.map((r) => factor(r.display)).join("")}`;
    const ok = [0.7, 1.3, -2.1].every((x) => {
      const lhs = lead * result.roots.reduce((acc, r) => acc * (x - r.re), 1);
      const rhs = coeffs.reduce((acc, c, i) => acc + c * Math.pow(x, i), 0);
      return Math.abs(lhs - rhs) <= 1e-6 * Math.max(1, Math.abs(rhs));
    });
    if (ok) {
      return [
        { text: "Every root is rational, so the polynomial factors completely:" },
        { math: `${shown} = 0` },
        { text: "A product is zero exactly when one of its factors is zero:" },
      ];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Derivatives: the rule applied at each level of the expression, top down.

const FN_DERIVS: Record<string, string> = {
  sin: "cos(u)",
  cos: "-sin(u)",
  tan: "1/cos(u)^2",
  exp: "exp(u)",
  ln: "1/u",
  log: "1/(u ln(10))",
  sqrt: "1/(2 sqrt(u))",
  asin: "1/sqrt(1-u^2)",
  acos: "-1/sqrt(1-u^2)",
  atan: "1/(1+u^2)",
  sinh: "cosh(u)",
  cosh: "sinh(u)",
  tanh: "1/cosh(u)^2",
};

function isConstIn(e: Expr, v: string): boolean {
  return !freeVars(e).includes(v);
}

/**
 * Rule-by-rule derivation for d/dv of the input. Depth-limited; the final
 * result line is the ENGINE's derivative (derivAst + format), so the work can
 * never disagree with the answer it explains.
 */
export function derivativeWork(input: string, variable: string): WorkLine[] {
  let e: Expr;
  try {
    e = parseExpr(input);
  } catch {
    return [];
  }
  const v = variable;
  const lines: WorkLine[] = [];
  /** The engine's own SIMPLIFIED sub-derivative — the same double-simplify
   *  the user-facing result gets, so u′ lines never show `2*x^(2 - 1)*1`. */
  const D = (x: Expr): string | null => {
    try {
      return format(simplify(simplify(derivAst(x, v))));
    } catch {
      return null;
    }
  };
  const pushD = (label: string, x: Expr): void => {
    const d = D(x);
    if (d !== null) lines.push({ math: `${label}' = ${d}` });
  };
  let saidTermByTerm = false;

  const walk = (n: Expr, depth: number): void => {
    if (lines.length >= 8 || depth > 3) return;
    // An entirely-constant subtree differentiates to zero — say that, rather
    // than descending into it and describing rules for functions of constants.
    if (isConstIn(n, v)) {
      lines.push({ math: `d/d${v} (${format(n)}) = 0` });
      return;
    }
    switch (n.t) {
      case "add":
      case "sub":
        if (!saidTermByTerm) {
          lines.push({ text: "Differentiate term by term:" });
          saidTermByTerm = true;
        }
        walk(n.l, depth + 1);
        walk(n.r, depth + 1);
        return;
      case "neg":
        walk(n.e, depth);
        return;
      case "mul": {
        const lc = isConstIn(n.l, v);
        if (lc || isConstIn(n.r, v)) {
          const c = lc ? n.l : n.r;
          const rest = lc ? n.r : n.l;
          lines.push({ text: `The constant factor ${format(c)} carries through:` });
          walk(rest, depth + 1);
          return;
        }
        lines.push({ text: `Product rule, (uv)' = u'v + uv', with u = ${format(n.l)} and v = ${format(n.r)}:` });
        pushD("u", n.l);
        pushD("v", n.r);
        return;
      }
      case "div":
        if (isConstIn(n.r, v)) {
          walk(n.l, depth);
          return;
        }
        lines.push({ text: `Quotient rule, (u/v)' = (u'v - uv')/v^2, with u = ${format(n.l)} and v = ${format(n.r)}:` });
        pushD("u", n.l);
        pushD("v", n.r);
        return;
      case "pow": {
        if (isConstIn(n.r, v) && n.l.t === "var" && n.l.name === v) {
          const d = D(n);
          lines.push({ text: "Power rule:" });
          if (d !== null) lines.push({ math: `d/d${v} ${format(n)} = ${d}` });
          return;
        }
        if (isConstIn(n.r, v)) {
          lines.push({ text: `Power rule, then the chain rule on the inside u = ${format(n.l)}:` });
          pushD("u", n.l);
          return;
        }
        lines.push({ text: `A variable exponent — differentiated via exp(ln): ${format(n)} = exp(${format(n.r)} ln(${format(n.l)})).` });
        return;
      }
      case "fn": {
        const table = FN_DERIVS[n.name];
        if (!(n.arg.t === "var" && n.arg.name === v)) {
          lines.push({ text: `Chain rule, with u = ${format(n.arg)}:` });
          if (table) lines.push({ math: `d/du ${n.name}(u) = ${table}` });
          pushD("u", n.arg);
          return;
        }
        if (table) {
          lines.push({ math: `d/d${v} ${n.name}(${v}) = ${table.split("u").join(v)}` });
        }
        return;
      }
      case "var":
        if (n.name === v && depth > 0) lines.push({ math: `d/d${v} ${v} = 1` });
        return;
      case "num":
        return;
    }
  };
  walk(e, 0);
  if (!lines.length) return [];
  lines.push({ text: "Assembled and simplified:" });
  try {
    lines.push({ math: `d/d${v} (${input.trim()}) = ${format(simplify(simplify(derivAst(e, v))))}` });
  } catch {
    return [];
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Definite integrals: F at the bounds, numbers shown.

/**
 * The evaluation lines for ∫ from a to b when a symbolic antiderivative
 * exists: F(b) − F(a) with both values substituted, verified against the
 * engine's value before anything is shown.
 */
export function definiteIntegralWork(
  result: IntegralResult,
  a: number,
  b: number,
  aLabel?: string,
  bLabel?: string,
): WorkLine[] {
  if (!result.antiderivative) return [];
  // NO VALUE MEANS NO WORK. `NaN > tol` is false, so a subtraction-style
  // guard silently PASSES an integral the engine says does not exist —
  // showing FTC work ending "= NaN" while the caveat below explains the
  // endpoint difference is NOT the integral (the ∫1/x² from −1 to 1 trap).
  if (!Number.isFinite(result.value)) return [];
  let F: Expr;
  try {
    F = parseExpr(result.antiderivative);
  } catch {
    return [];
  }
  const v = result.variable;
  let Fb: number;
  let Fa: number;
  try {
    Fb = evalAst(F, { [v]: b });
    Fa = evalAst(F, { [v]: a });
  } catch {
    return [];
  }
  if (!Number.isFinite(Fb) || !Number.isFinite(Fa)) return [];
  // The work must reproduce the engine's own value — inverted so an
  // unexpected NaN anywhere FAILS the guard rather than slipping past it.
  if (!(Math.abs(Fb - Fa - result.value) <= 1e-6 * Math.max(1, Math.abs(result.value)))) return [];
  const lo = aLabel?.trim() || fmtN(a);
  const hi = bLabel?.trim() || fmtN(b);
  return [
    { text: "By the fundamental theorem of calculus, evaluate F at the bounds:" },
    { math: `F(${hi}) - F(${lo}) = ${fmtN(Fb)} - (${fmtN(Fa)}) = ${fmtN(result.value)}` },
  ];
}
