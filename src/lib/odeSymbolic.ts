// Symbolic ordinary differential equations — Release 1.
//
// Solves, EXACTLY and with the work shown, the four families a first course
// leans on:
//
//   y' = f(x)                    direct integration
//   y' = f(x)·g(y)               separable
//   y' = q(x) − p(x)·y           linear first order (integrating factor)
//   a y'' + b y' + c y = 0       constant-coefficient homogeneous
//
// Input notation: y' / y'' (dy/dx and d2y/dx2 are folded to primes); the
// unknown is y(x). Anything outside these families is refused BY NAME with
// the list of what this release solves — a wrong "solution" to an ODE is a
// worse outcome than a refusal, and the engine's integrals themselves
// (antiderivative) already discard unverifiable results.
//
// VERIFICATION: every general solution is substituted back — y is replaced by
// the solution expression, differentiated symbolically, and the ODE's residual
// is evaluated at sample points over random constants. A solution that does
// not verify is NOT shown.

import {
  Expr,
  parseExpr,
  evalAst,
  derivative as derivAst,
  simplify,
  format,
  freeVars,
  antiderivative,
  solveEquation,
} from "./solve";

export interface SymbolicOdeResult {
  /** Which family solved it, e.g. "separable". */
  classification: string;
  /** The general solution in Solve grammar — explicit (y = …) when possible,
   *  implicit (G(y) = F(x) + C) otherwise. */
  solution: string;
  /** True when `solution` is explicit y = …. */
  explicit: boolean;
  steps: Array<{ text?: string; math?: string }>;
  caveats: string[];
  /** How the answer was checked. "verified" = residual ≈ 0 at samples. */
  verified: "verified" | "implicit-form" | "unverified";
  /** For explicit solutions: family members (C substituted) for plotting. */
  family: Array<{ expr: string; label: string }>;
}

const SAMPLES = [0.3, 0.9, 1.7];
const TOL = 1e-6;

/** y'' → ypp, y' → yp (and dy/dx forms), so parseExpr can read the line. */
function foldPrimes(s: string): string {
  return s
    .replace(/d2y\s*\/\s*dx2|d\^2y\s*\/\s*dx\^2|d²y\s*\/\s*dx²/gi, " ypp ")
    .replace(/dy\s*\/\s*dx/gi, " yp ")
    // Third order first, or y''' folds to ypp with a stray quote whose parse
    // error ("unbalanced parentheses") blames the user's brackets.
    .replace(/y\s*'''|y‴|y′′′/g, " yppp ")
    .replace(/y\s*''|y″|y′′/g, " ypp ")
    .replace(/y\s*'|y′/g, " yp ");
}

function isConst(e: Expr): boolean {
  return freeVars(e).length === 0;
}

function onlyIn(e: Expr, v: string): boolean {
  return freeVars(e).every((x) => x === v);
}

const S2 = (e: Expr): Expr => simplify(simplify(e));
const neg = (e: Expr): Expr => ({ t: "neg", e });
const sub = (l: Expr, r: Expr): Expr => ({ t: "sub", l, r });
const mul = (l: Expr, r: Expr): Expr => ({ t: "mul", l, r });
const div = (l: Expr, r: Expr): Expr => ({ t: "div", l, r });

/** Multiplicative split of e into a pure-x part and a pure-y part, walking
 *  mul/div/neg. Returns null when any factor mixes x and y. */
function separate(e: Expr): { fx: Expr; gy: Expr } | null {
  const xNum: Expr[] = [];
  const xDen: Expr[] = [];
  const yNum: Expr[] = [];
  const yDen: Expr[] = [];
  let sign = 1;
  const walk = (n: Expr, inverted: boolean): boolean => {
    switch (n.t) {
      case "mul":
        return walk(n.l, inverted) && walk(n.r, inverted);
      case "div":
        return walk(n.l, inverted) && walk(n.r, !inverted);
      case "neg":
        sign = -sign;
        return walk(n.e, inverted);
      default: {
        const vars = freeVars(n);
        if (vars.every((v) => v === "x")) {
          (inverted ? xDen : xNum).push(n);
          return true;
        }
        if (vars.every((v) => v === "y")) {
          (inverted ? yDen : yNum).push(n);
          return true;
        }
        return false;
      }
    }
  };
  if (!walk(e, false)) return null;
  const prod = (parts: Expr[]): Expr => (parts.length ? parts.reduce((a, b) => mul(a, b)) : { t: "num", v: 1 });
  let fx: Expr = div(prod(xNum), prod(xDen));
  const gy: Expr = div(prod(yNum), prod(yDen));
  if (sign < 0) fx = neg(fx);
  return { fx: S2(fx), gy: S2(gy) };
}

/** Residual check: substitute y(x) = sol(x) into y' − rhs(x,y) at samples. */
function verifyFirstOrder(solution: string, rhs: Expr): boolean {
  let sol: Expr;
  let dsol: Expr;
  try {
    sol = parseExpr(solution);
    dsol = derivAst(sol, "x");
  } catch {
    return false;
  }
  let checked = 0;
  for (const C of [-1, 0.7, 2]) {
    for (const x of SAMPLES) {
      let y: number, yp: number, want: number;
      try {
        y = evalAst(sol, { x, C });
        yp = evalAst(dsol, { x, C });
        want = evalAst(rhs, { x, y });
      } catch {
        continue;
      }
      if (![y, yp, want].every(Number.isFinite)) continue;
      if (Math.abs(yp - want) > TOL * Math.max(1, Math.abs(want))) return false;
      checked++;
    }
  }
  return checked >= 3;
}

/** Residual check for a second-order candidate — against the ORIGINAL
 *  equation F(x, y, y', y'') = 0, never the extracted coefficients. A
 *  verification that re-derives its truth from the classification it is
 *  supposed to check would pass any misclassification (a forcing term
 *  vanishing at the two sampling points slipped through exactly that way). */
function verifySecondOrder(solution: string, F: Expr): boolean {
  let sol: Expr, d1: Expr, d2: Expr;
  try {
    sol = parseExpr(solution);
    d1 = derivAst(sol, "x");
    d2 = derivAst(d1, "x");
  } catch {
    return false;
  }
  let checked = 0;
  for (const [C1, C2] of [
    [1, 0],
    [0, 1],
    [0.6, -1.3],
  ]) {
    // More x-samples than the classifier uses, deliberately offset from them.
    for (const x of [0.25, 0.55, 0.85, 1.15, 1.45, 1.75]) {
      let r: number;
      try {
        const env = { x, C1, C2 };
        const y = evalAst(sol, env);
        const yp = evalAst(d1, env);
        const ypp = evalAst(d2, env);
        r = evalAst(F, { x, y, yp, ypp });
      } catch {
        continue;
      }
      if (!Number.isFinite(r)) continue;
      if (Math.abs(r) > TOL * 100) return false;
      checked++;
    }
  }
  return checked >= 3;
}

const REFUSAL_LIST =
  "This release solves: y' = f(x) (direct integration), y' = f(x)·g(y) (separable), " +
  "y' = q(x) − p(x)·y (linear first order), and a·y'' + b·y' + c·y = 0 (constant coefficients). " +
  "The unknown is y(x).";

function refuse(classification: string, why: string): SymbolicOdeResult {
  return {
    classification,
    solution: "",
    explicit: false,
    steps: [{ text: why }, { text: REFUSAL_LIST }],
    caveats: [],
    verified: "unverified",
    family: [],
  };
}

/**
 * Solves an ODE line. Returns null when the input does not read as an ODE at
 * all (no y'/y'' anywhere) — a refusal WITH a reason is returned for inputs
 * that are ODEs this release cannot solve.
 */
export function solveOdeSymbolic(input: string): SymbolicOdeResult | null {
  const folded = foldPrimes(input);
  if (!/\byp\b|\bypp\b|\byppp\b/.test(folded)) return null;
  if (/\byppp\b/.test(folded)) {
    return refuse("third order or higher", "Third- and higher-order equations are not solved in this release.");
  }
  const sides = folded.split("=");
  if (sides.length !== 2) {
    return refuse("unreadable", "An ODE needs exactly one '=' — e.g. y' = x*y, or y'' + 3y' + 2y = 0.");
  }
  let F: Expr;
  try {
    F = S2(parseExpr(`(${sides[0]}) - (${sides[1]})`));
  } catch (error) {
    return refuse("unreadable", `Could not read the equation: ${(error as Error).message}`);
  }
  const vars = freeVars(F);
  if (vars.some((v) => !["x", "y", "yp", "ypp"].includes(v))) {
    return refuse(
      "unsupported",
      `Only x and y(x) are supported — found ${vars.filter((v) => !["x", "y", "yp", "ypp"].includes(v)).join(", ")}.`,
    );
  }

  // ---- Second order: F must be a·ypp + b·yp + c·y with numeric a,b,c. ----
  if (vars.includes("ypp")) {
    const a = S2(derivAst(F, "ypp"));
    const b = S2(derivAst(F, "yp"));
    const c = S2(derivAst(F, "y"));
    const linear = [a, b, c].every(isConst);
    // The remainder after removing the linear part must be zero.
    let av = NaN, bv = NaN, cv = NaN, remainderZero = false;
    if (linear) {
      try {
        av = evalAst(a, {});
        bv = evalAst(b, {});
        cv = evalAst(c, {});
        remainderZero = [0.4, 1.3].every((s) => {
          const env = { x: s, y: 0.9 * s, yp: -0.7 * s, ypp: 1.1 * s };
          const whole = evalAst(F, env);
          const linPart = av * env.ypp + bv * env.yp + cv * env.y;
          return Math.abs(whole - linPart) <= 1e-9 * Math.max(1, Math.abs(whole));
        });
      } catch {
        remainderZero = false;
      }
    }
    if (!linear || !remainderZero || !Number.isFinite(av) || av === 0) {
      return refuse(
        "second order, unsupported",
        "Second-order equations are solved only in the constant-coefficient homogeneous form a·y'' + b·y' + c·y = 0.",
      );
    }
    // Characteristic equation a r² + b r + c = 0 — the existing quadratic engine.
    const chEq = `${av}*r^2 + ${bv}*r + ${cv} = 0`;
    const ch = solveEquation(chEq, "r");
    if (!ch || !ch.roots.length) return refuse("second order", "The characteristic equation could not be solved.");
    const steps: SymbolicOdeResult["steps"] = [
      { text: "Constant coefficients — substitute y = e^(r x); the ODE becomes its characteristic equation:" },
      { math: `${av} r^2 + ${bv} r + ${cv} = 0` },
    ];
    const disc = bv * bv - 4 * av * cv;
    // e^{0·x} is 1 — displayed mathematics never carries exp(0 x).
    const expTerm = (r: number): string => (r === 0 ? "" : ` * exp(${fmt(r)} x)`);
    let solution: string;
    if (Math.abs(disc) <= 1e-12 * Math.max(1, bv * bv)) {
      const r0 = -bv / (2 * av);
      steps.push({ text: `One repeated root r = ${fmt(r0)} — the second solution picks up a factor of x:` });
      solution = r0 === 0 ? "C1 + C2 x" : `(C1 + C2 x) * exp(${fmt(r0)} x)`;
    } else if (disc > 0) {
      const r1 = (-bv + Math.sqrt(disc)) / (2 * av);
      const r2 = (-bv - Math.sqrt(disc)) / (2 * av);
      steps.push({ text: `Two real roots r = ${fmt(r1)} and r = ${fmt(r2)}:` });
      solution = `C1${expTerm(r1)} + C2${expTerm(r2)}`;
    } else {
      const alpha = -bv / (2 * av);
      const beta = Math.sqrt(-disc) / (2 * av);
      steps.push({ text: `Complex roots r = ${fmt(alpha)} ± ${fmt(beta)}i — oscillation with envelope e^(${fmt(alpha)}x):` });
      solution = alpha === 0 ? `C1 * cos(${fmt(beta)} x) + C2 * sin(${fmt(beta)} x)` : `exp(${fmt(alpha)} x) * (C1 * cos(${fmt(beta)} x) + C2 * sin(${fmt(beta)} x))`;
    }
    if (!verifySecondOrder(solution, F)) {
      return refuse("second order", "The candidate solution failed the substitute-back check against the original equation and was discarded.");
    }
    steps.push({ text: "General solution (verified by substituting back):" });
    steps.push({ math: `y = ${solution}` });
    return {
      classification: "second order, constant coefficients",
      solution: `y = ${solution}`,
      explicit: true,
      steps,
      caveats: ["C1 and C2 are the two arbitrary constants — two initial conditions would fix them."],
      verified: "verified",
      family: [
        { expr: solution.replace(/\bC1\b/g, "(1)").replace(/\bC2\b/g, "(0)"), label: "C1=1, C2=0" },
        { expr: solution.replace(/\bC1\b/g, "(0)").replace(/\bC2\b/g, "(1)"), label: "C1=0, C2=1" },
        { expr: solution.replace(/\bC1\b/g, "(1)").replace(/\bC2\b/g, "(1)"), label: "C1=1, C2=1" },
      ],
    };
  }

  // ---- First order: solve F = 0 for yp, i.e. yp = rhs(x, y). ----
  const c1 = S2(derivAst(F, "yp"));
  if (freeVars(c1).includes("yp") || freeVars(c1).includes("ypp")) {
    return refuse("first order, nonlinear in y'", "y' appears nonlinearly — outside this release.");
  }
  let rhs: Expr;
  try {
    // F = c1·yp + rest  ⇒  yp = −rest/c1.
    const rest = S2(sub(F, mul(c1, { t: "var", name: "yp" })));
    if (freeVars(rest).includes("yp")) throw new Error("not linear in y'");
    rhs = S2(div(neg(rest), c1));
  } catch {
    return refuse("first order", "Could not isolate y'.");
  }
  if (freeVars(rhs).includes("yp")) return refuse("first order", "Could not isolate y'.");

  // Direct integration: no y on the right.
  if (onlyIn(rhs, "x")) {
    const F1 = antiderivative(format(rhs), "x");
    if (!F1) {
      return refuse(
        "direct integration",
        `y' depends only on x, but ∫(${format(rhs)}) dx has no elementary form this engine can verify.`,
      );
    }
    const solution = `y = ${F1.antiderivative} + C`;
    if (!verifyFirstOrder(`${F1.antiderivative} + C`, rhs)) {
      return refuse("direct integration", "The candidate solution failed the substitute-back check and was discarded.");
    }
    return {
      classification: "direct integration",
      solution,
      explicit: true,
      steps: [
        { text: `y' depends on x alone — integrate both sides: y = ∫(${format(rhs)}) dx.` },
        { math: solution },
      ],
      caveats: [`The integral was checked by differentiating back (${F1.verified}).`],
      verified: "verified",
      family: familyOf(`${F1.antiderivative} + C`),
    };
  }

  // Separable: rhs = f(x)·g(y).
  const sep = separate(rhs);
  if (sep) {
    const okSplit = SAMPLES.every((x) =>
      [0.4, 1.6].every((y) => {
        try {
          const whole = evalAst(rhs, { x, y });
          const split = evalAst(sep.fx, { x }) * evalAst(sep.gy, { y });
          return !Number.isFinite(whole) || Math.abs(whole - split) <= 1e-9 * Math.max(1, Math.abs(whole));
        } catch {
          return true;
        }
      }),
    );
    if (okSplit) {
      const G = antiderivative(format(div({ t: "num", v: 1 }, sep.gy)), "y");
      const Fx = antiderivative(format(sep.fx), "x");
      if (G && Fx) {
        const steps: SymbolicOdeResult["steps"] = [
          {
            text: `Separable: y' = (${format(sep.fx)}) · (${format(sep.gy)}). Separate — ∫ dy/(${format(sep.gy)}) = ∫ (${format(sep.fx)}) dx — and integrate both sides:`,
          },
          { math: `${G.antiderivative} = ${Fx.antiderivative} + C` },
        ];
        // The classroom special case ∫dy/y = ln|y|: exponentiate to explicit form.
        const lnLike = /^ln\((?:abs\()?y\)?\)$/.test(G.antiderivative.replace(/\s+/g, ""));
        if (lnLike) {
          const explicitSol = `C * exp(${Fx.antiderivative})`;
          if (verifyFirstOrder(explicitSol, rhs)) {
            steps.push({ text: "Exponentiating (C absorbs the sign and the constant):" });
            steps.push({ math: `y = ${explicitSol}` });
            return {
              classification: "separable",
              solution: `y = ${explicitSol}`,
              explicit: true,
              steps,
              caveats: [
                "y = 0 is also a solution (lost when dividing by y).",
                `Both integrals were checked by differentiating back (${G.verified}, ${Fx.verified}).`,
              ],
              verified: "verified",
              family: familyOf(explicitSol),
            };
          }
        }
        return {
          classification: "separable",
          solution: `${G.antiderivative} = ${Fx.antiderivative} + C`,
          explicit: false,
          steps,
          caveats: [
            "The solution is implicit — solve for y case-by-case if an explicit form is needed.",
            `Values of y where ${format(sep.gy)} = 0 are constant solutions lost in the division.`,
            `Both integrals were checked by differentiating back (${G.verified}, ${Fx.verified}).`,
          ],
          verified: "implicit-form",
          family: [],
        };
      }
      return refuse("separable", "One of the two integrals has no elementary form this engine can verify.");
    }
  }

  // Linear first order: rhs = q(x) − p(x)·y.
  const dRy = S2(derivAst(rhs, "y"));
  if (onlyIn(dRy, "x")) {
    const p = S2(neg(dRy)); // y' + p y = q
    const q = S2(sub(rhs, mul(dRy, { t: "var", name: "y" })));
    if (onlyIn(q, "x")) {
      const Pint = antiderivative(format(p), "x");
      if (!Pint) return refuse("linear first order", `∫p(x) dx = ∫(${format(p)}) dx has no elementary form here.`);
      const mu = `exp(${Pint.antiderivative})`;
      const integrand = `(${mu}) * (${format(q)})`;
      const Mint = antiderivative(integrand, "x");
      if (!Mint) {
        return refuse(
          "linear first order",
          `The integrating factor is ${mu}, but ∫ ${integrand} dx has no elementary form this engine can verify.`,
        );
      }
      const solution = `(${Mint.antiderivative} + C) / (${mu})`;
      if (!verifyFirstOrder(solution, rhs)) {
        return refuse("linear first order", "The candidate solution failed the substitute-back check and was discarded.");
      }
      return {
        classification: "linear first order",
        solution: `y = ${solution}`,
        explicit: true,
        steps: [
          { text: `Linear form y' + (${format(p)})·y = ${format(q)}. The integrating factor is:` },
          { math: `μ = exp(int(${format(p)}, dx)) = ${mu}` },
          { text: "Multiplying through makes the left side (μy)′; integrate both sides:" },
          { math: `μ y = ${Mint.antiderivative} + C` },
          { math: `y = ${solution}` },
        ],
        caveats: [`All integrals were checked by differentiating back (${Pint.verified}, ${Mint.verified}).`],
        verified: "verified",
        family: familyOf(solution),
      };
    }
  }

  return refuse("first order, unsupported", `y' = ${format(rhs)} does not fit a family this release solves.`);
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

/** Three family members for the plot: C = −1, 1/2, 2. Word-boundary
 *  replacement — a bare "C" only, never the c inside cos/exp. */
function familyOf(solutionWithC: string): SymbolicOdeResult["family"] {
  return [-1, 0.5, 2].map((C) => ({
    expr: solutionWithC.replace(/\bC\b/g, `(${C})`),
    label: `C = ${C}`,
  }));
}
