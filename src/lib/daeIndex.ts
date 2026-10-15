// DAE index reduction: Pantelides structural analysis, symbolic differentiation
// of the constraints, consistent initialisation, integration of the reduced
// index-1 system with ode.ts, projection back onto every constraint, and a
// drift report measured on the ORIGINAL and every HIDDEN constraint.
//
// WHY. The Cartesian pendulum
//     x' = u, y' = v, u' = -lam*x, v' = -lam*y - 9.81, 0 = x^2 + y^2 - 1
// is index 3. Hand-reducing it to index 1 and running implicit Euler gave
// x(10) = -0.734 against the true 0.2751, with x² + y² = 0.54 — the rod had
// lost 46% of its length — while the old solver certified "no drift by
// construction". It was measuring the DIFFERENTIATED constraint it was handed,
// which is not the one the user meant. Two lessons, both enforced here:
//   1. Drift is measured on every ORIGINAL constraint and every hidden one the
//      reduction produced, never only on the last level that was solved.
//   2. A first-order implicit method cannot be rescued by projection (SciPy:
//      implicit Euler + projection at 20 000 steps still gives x(10) = -0.035).
//      The reduced system is integrated with ode.ts (RK45, switching to the
//      Rosenbrock solver when stiff) at a tight, PRINTED tolerance.
//
// THE METHOD.
//   1. Incidence: which unknowns each equation mentions (freeVars on the AST).
//   2. Pantelides (1988, SIAM J. Sci. Stat. Comput. 9:213): augmenting-path
//      matching of equations to highest derivatives; an equation set that
//      cannot be matched is differentiated, until the matching is complete.
//      The structural index is the deepest constraint differentiation + 1.
//   3. Each constraint is differentiated symbolically along t, with the chain
//      rule over the STATES IT MENTIONS (x' replaced by its right-hand side),
//      as many times as Pantelides says. The last level determines the
//      algebraic unknowns; it is solved for them by Newton at every evaluation.
//   4. Numerical confirmation at t₀: the Jacobian of the last level with
//      respect to the algebraic unknowns must be nonsingular. When structure
//      says yes and the numbers say no, the system is REFUSED BY NAME — the
//      canonical case is x' = 1 - z, y' = z, 0 = x + y - t, where z cancels
//      and is not determined at any index.
//   5. The initial point is projected onto the original and hidden
//      constraints, level by level, moving only the states each level
//      introduces; every move is reported.
//   6. Integration in segments; after each segment the state is projected onto
//      the original and hidden constraints (Gauss–Newton, ≤ 3 iterations,
//      minimum-norm). The residual of every constraint is recorded BEFORE and
//      AFTER each projection, so the report shows both the drift the method
//      would have had and what remains.
//
// Every expression is an AST from solve.ts parseExpr and is evaluated with
// evalAst from the SAME AST — one grammar for structure and for numbers.
// Caps are checked before the work they bound: ≤ 12 unknowns, structural index
// ≤ 5, ≤ 20 000 AST nodes before each differentiation, bounded Newton and
// Gauss–Newton loops, a total ODE step budget.

import { Expr, evalAst, freeVars, derivative, simplify } from "./solve";
import { luSolve, isNearlySingular, solveDae } from "./dae";
import { solveOde } from "./ode";
import { DaeSystem, daePrettyName, DAE_MAX_UNKNOWNS } from "./daeParse";

export const DAE_MAX_INDEX = 5;
const MAX_NODES = 20000;
const INIT_GN_MAX = 50;
const STEP_GN_MAX = 3;
const NEWTON_Z_MAX = 30;
const MAX_POINTS = 5000;
const MAX_TEVAL = 1000;
const MAX_ODE_STEPS = 300000;
/** Total AST nodes evaluated per solve (≈ 1.5–3 s of evalAst; the pendulum at 2000 points uses ~1.4e7); see `ev`. */
export const DAE_WORK_BUDGET = 1e8;
const WORK_BUDGET = DAE_WORK_BUDGET;
/**
 * FREEZE GUARD ONLY. The result must not depend on machine load: under a full
 * test run a 2.5 s backstop stopped a 10 s pendulum at t = 4.76. The WORK budget
 * is the only normal stopping rule (deterministic); this clock check is far out
 * and, if it ever fires, says it was the clock and not the work.
 */
export const DAE_TIME_GUARD_MS = 15000;

export interface DaeDrift {
  /** The constraint, typeset, e.g. "x² + y² − 1". */
  constraint: string;
  /** 0 = an original constraint; k = its k-th time derivative (hidden). */
  level: number;
  /** Which original constraint it came from (index into system.cons). */
  source: number;
  /** Max |residual| over the run immediately BEFORE each projection. */
  before: number;
  /** Max |residual| over the run AFTER each projection (what is reported). */
  after: number;
  /** True for the last level, which is SOLVED for the algebraic unknowns. */
  solved: boolean;
}

export interface DaeAutoResult {
  /** Structural (differential) index, confirmed numerically at t₀. */
  index: number;
  /** How the index was found (Pantelides). */
  structural: string[];
  /** The reduced system that was integrated, typeset. */
  reduced: string[];
  /** Hidden constraints (each differentiated level), typeset, "… = 0". */
  hidden: string[];
  /** What happened to the initial point. Empty when it was already consistent. */
  projectedInit: string[];
  /** Column names: states (x, x′ …) then algebraic unknowns. */
  names: string[];
  t: number[];
  /** Trajectory per name (display label). */
  states: Record<string, number[]>;
  drift: DaeDrift[];
  method: string;
  steps: string[];
  caveats: string[];
  completed: boolean;
  /** The tolerances actually used. */
  rtol: number;
  atol: number;
  /** Work units charged (see DAE_WORK_BUDGET); for calibration and tests. */
  workUsed: number;
}

export type DaeAutoOutcome = { ok: true; result: DaeAutoResult } | { ok: false; error: string };

export interface DaeAutoOptions {
  rtol?: number;
  atol?: number;
  /** Report intervals over [t0, t1] (projection happens at each). Default 200. */
  points?: number;
  /** Times that must be grid points (values reported exactly there). */
  tEval?: number[];
  /** Default "projection". Baumgarte replaces the last level by a damped combination. */
  stabilise?: "projection" | { baumgarte: { alpha: number; beta?: number } };
  method?: "auto" | "rk45" | "stiff";
  /** Clock for the freeze guard (ms). Tests inject a slow one; default Date.now. */
  clock?: () => number;
}

// ---------------------------------------------------------------------------
// Pantelides
// ---------------------------------------------------------------------------

export interface PantelidesInput {
  /** All unknowns: states (each has a derivative) then algebraic ones. */
  unknowns: string[];
  /** Which unknowns are differential states. */
  isState: boolean[];
  /** Equations: differential ones first (eq i defines unknowns[stateOf[i]]'), then constraints. */
  eqs: { stateOf: number | null; uses: number[] }[];
}

export type PantelidesOutcome =
  | { ok: true; nu: number[]; index: number; derivedAlg: number[] }
  | { ok: false; error: string };

/**
 * Pantelides' algorithm on the semi-explicit structure. Returns, for each
 * original equation, how many times it must be differentiated (nu), and the
 * structural index (max nu over constraints, + 1 for the final algebraic solve).
 * `derivedAlg` lists algebraic unknowns whose DERIVATIVE the matching needed —
 * this file refuses those (they would become differential states).
 */
export function pantelides(inp: PantelidesInput): PantelidesOutcome {
  const vars: { u: number; order: number }[] = [];
  const A: number[] = [];
  const base: number[] = [];
  for (let u = 0; u < inp.unknowns.length; u++) {
    base[u] = vars.length;
    vars.push({ u, order: 0 });
    A.push(-1);
    if (inp.isState[u]) {
      A[base[u]] = vars.length;
      vars.push({ u, order: 1 });
      A.push(-1);
    }
  }
  const eqInc: number[][] = [];
  const eqNu: number[] = [];
  const eqOrig: number[] = [];
  const B: number[] = [];
  inp.eqs.forEach((e, k) => {
    const inc = new Set<number>(e.uses.map((u) => base[u]));
    if (e.stateOf !== null) inc.add(A[base[e.stateOf]]);
    eqInc.push([...inc]);
    eqNu.push(0);
    eqOrig.push(k);
    B.push(-1);
  });
  const assign: number[] = vars.map(() => -1);
  const MAX_EQS = inp.eqs.length * (DAE_MAX_INDEX + 2) + 8;

  let colV: Set<number>;
  let colE: Set<number>;
  const augment = (i: number): boolean => {
    colE.add(i);
    for (const j of eqInc[i]) {
      if (A[j] === -1 && assign[j] === -1) { assign[j] = i; return true; }
    }
    for (const j of eqInc[i]) {
      if (A[j] === -1 && !colV.has(j)) {
        colV.add(j);
        if (augment(assign[j])) { assign[j] = i; return true; }
      }
    }
    return false;
  };

  for (let k = 0; k < inp.eqs.length; k++) {
    let i = k;
    for (;;) {
      colV = new Set();
      colE = new Set();
      if (augment(i)) break;
      for (const l of colE) {
        if (eqNu[l] + 1 > DAE_MAX_INDEX) {
          return {
            ok: false,
            error:
              `Pantelides' structural analysis needs to differentiate an equation more than ${DAE_MAX_INDEX} times, so the structural index exceeds ${DAE_MAX_INDEX} ` +
              `(or the system is structurally singular — some unknown is not determined by any equation). Index > ${DAE_MAX_INDEX} is not solved here.`,
          };
        }
      }
      if (eqInc.length + colE.size > MAX_EQS) {
        return { ok: false, error: "Pantelides' structural analysis did not terminate within its equation budget; the system is structurally singular or its index exceeds the cap." };
      }
      for (const j of colV) {
        A[j] = vars.length;
        vars.push({ u: vars[j].u, order: vars[j].order + 1 });
        A.push(-1);
        assign.push(-1);
      }
      for (const l of colE) {
        const inc = new Set<number>();
        for (const v of eqInc[l]) {
          inc.add(v);
          if (A[v] !== -1) inc.add(A[v]);
        }
        B[l] = eqInc.length;
        eqInc.push([...inc]);
        eqNu.push(eqNu[l] + 1);
        eqOrig.push(eqOrig[l]);
        B.push(-1);
      }
      for (const j of colV) assign[A[j]] = B[assign[j]];
      i = B[i];
    }
  }
  const nu = inp.eqs.map(() => 0);
  for (let q = 0; q < eqInc.length; q++) nu[eqOrig[q]] = Math.max(nu[eqOrig[q]], eqNu[q]);
  const derivedAlg: number[] = [];
  for (let u = 0; u < inp.unknowns.length; u++) {
    if (!inp.isState[u] && A[base[u]] !== -1) derivedAlg.push(u);
  }
  let maxCons = 0;
  inp.eqs.forEach((e, k) => { if (e.stateOf === null) maxCons = Math.max(maxCons, nu[k]); });
  return { ok: true, nu, index: maxCons + 1, derivedAlg };
}

// ---------------------------------------------------------------------------
// Expression helpers
// ---------------------------------------------------------------------------

const NUM = (v: number): Expr => ({ t: "num", v });
const isZero = (e: Expr): boolean => e.t === "num" && e.v === 0;

/** AST node count, iteratively (the stack-depth lesson). Stops counting past `cap`. */
export function nodeCount(e: Expr, cap = Infinity): number {
  let n = 0;
  const stack: Expr[] = [e];
  while (stack.length) {
    const x = stack.pop() as Expr;
    if (++n > cap) return n;
    switch (x.t) {
      case "num": case "var": break;
      case "neg": stack.push(x.e); break;
      case "fn": stack.push(x.arg); break;
      default: stack.push(x.l, x.r);
    }
  }
  return n;
}

/** A display-friendly number: 12 significant figures, never 0.30000000000000004. */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(Math.abs(v));
  return String(Math.abs(Number(v.toPrecision(12))));
}

/** v as a short decimal (≤ 8 places, exact to 12 figures), or null. */
function shortDecimal(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const r = Number(v.toPrecision(12));
  const s = String(Math.abs(r));
  if (/e/.test(s)) return null;
  const dot = s.indexOf(".");
  if (dot >= 0 && s.length - dot - 1 > 8) return null;
  return r;
}

/** casSimplify writes 9.81 as 981/50; show the decimal the user typed. */
function foldDecimals(e: Expr): Expr {
  switch (e.t) {
    case "num": case "var": return e;
    case "neg": {
      const x = foldDecimals(e.e);
      return x.t === "num" ? NUM(-x.v) : { t: "neg", e: x };
    }
    case "fn": return { t: "fn", name: e.name, arg: foldDecimals(e.arg) };
    case "div": {
      const l = foldDecimals(e.l);
      const r = foldDecimals(e.r);
      if (r.t === "num" && r.v !== 0) {
        if (l.t === "num") { const q = shortDecimal(l.v / r.v); if (q !== null) return NUM(q); }
        if (l.t === "mul" && l.l.t === "num") {
          const q = shortDecimal(l.l.v / r.v);
          if (q !== null) return q === 1 ? l.r : { t: "mul", l: NUM(q), r: l.r };
        }
      }
      return { t: "div", l, r };
    }
    default: return { t: e.t, l: foldDecimals(e.l), r: foldDecimals(e.r) } as Expr;
  }
}

const SUPDIG = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number): string => (n < 0 ? "⁻" : "") + String(Math.abs(n)).split("").map((d) => SUPDIG[Number(d)]).join("");

/**
 * Typesets an expression for display: x² not x^2, u·x not u*x, − not -, x′
 * not x__d1. Everything it emits parses back through parseExpr (after the DAE
 * parser folds ′ to '), which the tests check.
 */
export function typesetDae(e0: Expr): string {
  const PREC: Record<Expr["t"], number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 2, pow: 3, fn: 4, num: 5, var: 5 };
  const prec = (e: Expr): number => (e.t === "num" && e.v < 0 ? 2 : PREC[e.t]);
  const go = (e: Expr): string => {
    const wrap = (c: Expr, p: number, parenIfSigned = false): string => {
      const s = go(c);
      return prec(c) < p || (parenIfSigned && s.startsWith("−")) ? `(${s})` : s;
    };
    switch (e.t) {
      case "num": return (e.v < 0 ? "−" : "") + fmtNum(e.v);
      case "var": return daePrettyName(e.name).replace(/'/g, "′");
      case "neg": return "−" + wrap(e.e, 2, true);
      case "add": {
        const r = go(e.r);
        if (r.startsWith("−") && !(e.r.t === "add" || e.r.t === "sub")) return `${go(e.l)} − ${r.slice(1)}`;
        return `${go(e.l)} + ${wrap(e.r, 1)}`;
      }
      case "sub": return `${go(e.l)} − ${wrap(e.r, 2, true)}`;
      case "mul": return `${wrap(e.l, 2)}·${wrap(e.r, 3, true)}`;
      case "div": return `${wrap(e.l, 2)}/${wrap(e.r, 3, true)}`;
      case "pow": {
        const b = wrap(e.l, 4, true);
        if (e.r.t === "num" && Number.isInteger(e.r.v) && Math.abs(e.r.v) < 100) return b + sup(e.r.v);
        if (e.r.t === "neg" && e.r.e.t === "num" && Number.isInteger(e.r.e.v) && e.r.e.v < 100) return b + sup(-e.r.e.v);
        return `${b}^${wrap(e.r, 4, true)}`;
      }
      case "fn": return `${e.name}(${go(e.arg)})`;
    }
  };
  return go(foldDecimals(e0));
}

/** Signed top-level terms of a sum. */
function terms(e: Expr, sign = 1, out: { s: number; e: Expr }[] = []): { s: number; e: Expr }[] {
  if (e.t === "add") { terms(e.l, sign, out); terms(e.r, sign, out); }
  else if (e.t === "sub") { terms(e.l, sign, out); terms(e.r, -sign, out); }
  else if (e.t === "neg") terms(e.e, -sign, out);
  else out.push({ s: sign, e });
  return out;
}

function coeffOf(e: Expr): number {
  if (e.t === "num") return e.v;
  if (e.t === "neg") return -coeffOf(e.e);
  if (e.t === "mul") return coeffOf(e.l) * (e.r.t === "num" ? e.r.v : 1);
  if (e.t === "div") return e.r.t === "num" ? coeffOf(e.l) / e.r.v : coeffOf(e.l);
  return 1;
}

/**
 * Divides a derived constraint by the gcd of its integer coefficients when
 * every other coefficient stays a short decimal: 2·u·x + 2·v·y → u·x + v·y,
 * and the pendulum's 2·u² … − 19.62·y → u² … − 9.81·y. It never introduces a
 * fraction an integer coefficient did not have (−4·t³ + x2 is left alone).
 * The zero set is unchanged; the residuals reported then match what is shown.
 */
function stripScale(e: Expr): Expr {
  const ts = terms(e);
  if (!ts.length) return e;
  const coeffs = ts.map((t) => Math.abs(coeffOf(t.e)));
  if (!coeffs.every((v) => Number.isFinite(v) && v > 0)) return e;
  const ints = coeffs.filter((v) => Number.isInteger(v) && v < 2 ** 31);
  if (!ints.length) return e;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const c = ints.reduce(gcd);
  if (c <= 1) return e;
  for (const v of coeffs) {
    const q = v / c;
    if (!(Number.isInteger(q) || shortDecimal(q) !== null)) return e;
  }
  try {
    const out = simplify({ t: "div", l: e, r: NUM(c) });
    return nodeCount(out, MAX_NODES) <= MAX_NODES ? out : e;
  } catch {
    return e;
  }
}

class DaeRefusal extends Error {}

function safeDerivative(e: Expr, x: string, what: string): Expr {
  try {
    return derivative(e, x);
  } catch (err) {
    const m = /No derivative rule for "([^"]+)"/.exec((err as Error).message);
    throw new DaeRefusal(
      m
        ? `${what} uses the function ${m[1]}(…), which has no symbolic derivative rule here, so it cannot be differentiated for index reduction.`
        : `${what} could not be differentiated: ${(err as Error).message}`,
    );
  }
}

/**
 * Symbolic work for the current solve: casSimplify costs ≈ 25 µs per input node
 * on a 6000-node level, so the node cap alone does not bound TIME — a run of
 * partial derivatives of big levels took over a second before integration
 * started. Charged per simplify call, capped, refused by name.
 */
const SYMBOLIC_BUDGET = 60000;
let symbolicWork = 0;

function safeSimplify(e: Expr, what: string): Expr {
  const size = nodeCount(e, MAX_NODES);
  if (size > MAX_NODES) {
    throw new DaeRefusal(`${what} has grown past ${MAX_NODES} expression nodes during differentiation; the reduction is refused before it runs away.`);
  }
  symbolicWork += size;
  if (symbolicWork > SYMBOLIC_BUDGET) {
    throw new DaeRefusal(
      `${what} is too large to reduce: differentiating and simplifying it and its derivatives exceeds the symbolic work budget (${SYMBOLIC_BUDGET} expression nodes in total). ` +
        `The reduction is refused before it freezes the pane; simplify the constraint or lower the index by hand.`,
    );
  }
  const s = simplify(e);
  if (nodeCount(s, MAX_NODES) > MAX_NODES) {
    throw new DaeRefusal(`${what} has grown past ${MAX_NODES} expression nodes during differentiation; the reduction is refused before it runs away.`);
  }
  return s;
}

const ordinal = (k: number): string => (k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : `${k}th`);
const dOrder = (k: number): string => (k === 1 ? "d/dt" : `d${sup(k)}/dt${sup(k)}`);
const fmtE = (v: number): string => (v === 0 ? "0" : v.toExponential(1).replace("-", "−"));
const fmtV = (v: number): string => String(Number(v.toPrecision(10))).replace("-", "−");

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

interface Level {
  e: Expr;
  /** ∂e/∂(state or alg), simplified, keyed by internal name; absent = zero. */
  partial: Map<string, Expr>;
}

/**
 * Solves a parsed DAE of any structural index ≤ 5 by index reduction.
 * Refuses by name: index > 5, > 12 unknowns, an undifferentiable function,
 * the structurally-fine-but-numerically-singular case, and a start that will
 * not project onto the constraints.
 */
export function solveDaeAuto(sys: DaeSystem, t0: number, t1: number, opts: DaeAutoOptions = {}): DaeAutoOutcome {
  try {
    return solveInner(sys, t0, t1, opts);
  } catch (err) {
    if (err instanceof DaeRefusal) return { ok: false, error: err.message };
    if (err instanceof RangeError) {
      return { ok: false, error: "The equations are nested too deeply to differentiate safely (the expression walker ran out of stack); simplify them or split them up." };
    }
    return { ok: false, error: `The DAE could not be solved: ${(err as Error).message}` };
  }
}

function solveInner(sys: DaeSystem, t0: number, t1: number, opts: DaeAutoOptions): DaeAutoOutcome {
  symbolicWork = 0;
  const clock = opts.clock ?? Date.now;
  const started = clock();
  // --- Caps and shape, before any work --------------------------------------
  if (![t0, t1].every(Number.isFinite)) return { ok: false, error: "The time interval must be finite." };
  if (t0 === t1) return { ok: false, error: "The time interval is empty — t0 and t1 are the same." };
  const states = sys.states.map((s) => s.varName);
  const alg = sys.alg.slice();
  const n = states.length;
  const m = alg.length;
  if (n + m > DAE_MAX_UNKNOWNS) return { ok: false, error: `${n + m} unknowns; the cap is ${DAE_MAX_UNKNOWNS}.` };
  if (!n) return { ok: false, error: "There must be at least one differential equation (name' = …)." };
  if (!sys.cons.length) return { ok: false, error: "There is no constraint. Without one this is an ODE — use the ODE solver." };
  const consShow = sys.cons.map((c) => typesetDae(c));
  const unknownSet = new Set([...states, ...alg]);
  for (let c = 0; c < sys.cons.length; c++) {
    if (nodeCount(sys.cons[c], MAX_NODES) > MAX_NODES) return { ok: false, error: `The constraint ${consShow[c]} is larger than ${MAX_NODES} expression nodes.` };
    if (!freeVars(sys.cons[c]).some((v) => unknownSet.has(v))) {
      return { ok: false, error: `The constraint 0 = ${consShow[c]} mentions no unknown, so it constrains nothing — it is either always or never true.` };
    }
  }
  if (sys.cons.length !== m) {
    return {
      ok: false,
      error: m === 0
        ? `There ${sys.cons.length === 1 ? "is 1 constraint" : `are ${sys.cons.length} constraints`} but no algebraic unknown — every name has a ' equation, so the constraint over-determines the system. ` +
          `A semi-explicit DAE needs one algebraic unknown (a name with no ' equation, such as lam) per constraint.`
        : `There ${sys.cons.length === 1 ? "is 1 constraint" : `are ${sys.cons.length} constraints`} but ${m} algebraic unknown${m === 1 ? "" : "s"} (${alg.join(", ")}). ` +
          `A semi-explicit DAE needs exactly as many constraints as algebraic unknowns — a misspelt name becomes an extra unknown.`,
    };
  }
  const points = Math.max(1, Math.min(MAX_POINTS, Math.floor(opts.points ?? 200)));
  const rtol = Math.min(1e-3, Math.max(1e-13, opts.rtol ?? 1e-10));
  const atol = Math.min(1e-3, Math.max(1e-15, opts.atol ?? 1e-12));
  const tEval = (opts.tEval ?? []).slice(0, MAX_TEVAL);
  if (!tEval.every(Number.isFinite)) return { ok: false, error: "Every requested output time must be finite." };

  const steps: string[] = [];
  const confirm: string[] = [];
  const caveats: string[] = [];
  steps.push(
    `Read as ${n} differential state${n === 1 ? "" : "s"} (${sys.states.map((s) => s.label.replace(/'/g, "′")).join(", ")}), ` +
      `${m} algebraic unknown${m === 1 ? "" : "s"} (${alg.join(", ")}) and ${sys.cons.length} constraint${sys.cons.length === 1 ? "" : "s"}. Every initial value was bound by name.`,
  );
  for (const note of sys.notes) steps.push(note);

  // --- 1–2. Incidence and Pantelides -----------------------------------------
  const unknowns = [...states, ...alg];
  const idx = new Map(unknowns.map((u, i) => [u, i]));
  const pin: PantelidesInput = {
    unknowns,
    isState: unknowns.map((_u, i) => i < n),
    eqs: [
      ...sys.stateRhs.map((r, i) => ({ stateOf: i, uses: freeVars(r).filter((v) => idx.has(v)).map((v) => idx.get(v) as number) })),
      ...sys.cons.map((c) => ({ stateOf: null, uses: freeVars(c).filter((v) => idx.has(v)).map((v) => idx.get(v) as number) })),
    ],
  };
  const pt = pantelides(pin);
  if (!pt.ok) return pt;
  if (pt.index > DAE_MAX_INDEX) {
    const deepest = sys.cons.map((_c, k) => pt.nu[n + k]).reduce((a, b, k, arr) => (b > arr[a] ? k : a), 0);
    return {
      ok: false,
      error:
        `Pantelides' structural analysis gives index ${pt.index}: 0 = ${typesetDae(sys.cons[deepest])} must be differentiated ${pt.index - 1} times before it determines ${alg.join(", ")}. ` +
        `Structural index above ${DAE_MAX_INDEX} is not solved here — each differentiation amplifies rounding error, and the reduced system is rarely what was meant.`,
    };
  }
  if (pt.derivedAlg.length) {
    const names = pt.derivedAlg.map((u) => unknowns[u]).join(", ");
    return {
      ok: false,
      error:
        `Pantelides' structural analysis needs the DERIVATIVE of the algebraic unknown${pt.derivedAlg.length === 1 ? "" : "s"} ${names}: a constraint that already contains ${names} must itself be differentiated, ` +
        `so ${names} would become a differential state. That form of index reduction (dummy derivatives) is not built here. Rewrite so that each constraint that must be differentiated does not mention the algebraic unknowns, or give ${names} its own ' equation.`,
    };
  }
  const nuCons = sys.cons.map((_c, k) => pt.nu[n + k]);
  const index = pt.index;
  const structural: string[] = [];
  structural.push("Structural analysis by Pantelides' algorithm (1988): equations are matched to the highest derivatives they contain; any set that cannot be matched is differentiated and the matching retried.");
  sys.cons.forEach((_c, k) => {
    const v = nuCons[k];
    structural.push(`0 = ${consShow[k]}: differentiated ${v === 0 ? "0 times (it determines the algebraic unknowns directly)" : v === 1 ? "once" : v === 2 ? "twice" : `${v} times`}.`);
  });
  const diffCounts = sys.stateRhs.map((_r, i) => pt.nu[i]);
  const diffd = sys.states.filter((_s, i) => diffCounts[i] > 0);
  if (diffd.length) {
    structural.push(
      `Differential equations differentiated along with them: ${diffd.map((s) => `${s.label.replace(/'/g, "′")}′ = … (${diffCounts[states.indexOf(s.varName)]}×)`).join(", ")} — used here by substituting each state's right-hand side for its derivative.`,
    );
  }
  structural.push(
    `Structural index ${index}: the deepest constraint is differentiated ${index - 1} time${index - 1 === 1 ? "" : "s"} before it determines ${alg.join(", ")}, ` +
      `and one more differentiation would give ${alg.map((a) => a + "′").join(", ")} — the system's index counts that last step.`,
  );

  // --- 3. Symbolic differentiation along t -----------------------------------
  const rhsOf = new Map(states.map((s, i) => [s, sys.stateRhs[i]]));
  const stateSet = new Set(states);
  const algSet = new Set(alg);
  const partialsOf = (e: Expr, what: string, over: string[]): Map<string, Expr> => {
    const out = new Map<string, Expr>();
    const fv = new Set(freeVars(e));
    for (const v of over) {
      if (!fv.has(v)) continue;
      const p = safeSimplify(safeDerivative(e, v, what), what);
      if (!isZero(p)) out.set(v, p);
    }
    return out;
  };
  /** Total time derivative with x' replaced by its right-hand side; chain rule only over the states e mentions. */
  const ddt = (lv: Level, what: string): Expr => {
    const fv = new Set(freeVars(lv.e));
    const parts: Expr[] = [];
    for (const s of states) {
      const p = lv.partial.get(s);
      if (!p) continue;
      const f = rhsOf.get(s) as Expr;
      parts.push(p.t === "num" && p.v === 1 ? f : { t: "mul", l: p, r: f });
    }
    if (fv.has("t")) {
      const pt0 = safeSimplify(safeDerivative(lv.e, "t", what), what);
      if (!isZero(pt0)) parts.push(pt0);
    }
    if (!parts.length) return NUM(0);
    return parts.reduce((a, b) => ({ t: "add", l: a, r: b }));
  };

  const levels: Level[][] = [];
  const rawFinal: Expr[] = [];
  const allVars = [...states, ...alg];
  for (let c = 0; c < sys.cons.length; c++) {
    const what = `The constraint 0 = ${consShow[c]}`;
    const L0 = { e: sys.cons[c], partial: partialsOf(sys.cons[c], what, allVars) };
    const ls: Level[] = [L0];
    let raw: Expr = sys.cons[c];
    for (let k = 1; k <= nuCons[c]; k++) {
      const prev = ls[k - 1];
      const zIn = freeVars(prev.e).filter((v) => algSet.has(v));
      if (zIn.length) {
        return {
          ok: false,
          error:
            `${what} must be differentiated ${nuCons[c]} times, but its ${k === 1 ? "original" : ordinal(k - 1) + "-derivative"} form already contains ${zIn.join(", ")}, ` +
            `so differentiating it would need ${zIn.map((z) => z + "′").join(", ")}. That form of index reduction is not built here.`,
        };
      }
      if (nodeCount(prev.e, MAX_NODES) > MAX_NODES) {
        return { ok: false, error: `${what}: its ${ordinal(k - 1)} derivative is larger than ${MAX_NODES} expression nodes; the reduction is refused before differentiating again.` };
      }
      raw = ddt(prev, what);
      const e = stripScale(safeSimplify(raw, what));
      ls.push({ e, partial: partialsOf(e, what, allVars) });
    }
    levels.push(ls);
    rawFinal.push(raw);
  }

  // --- Stabilisation choice --------------------------------------------------
  const st = opts.stabilise ?? "projection";
  let baum: { alpha: number; beta: number } | null = null;
  if (st !== "projection") {
    const alpha = st.baumgarte.alpha;
    const beta = st.baumgarte.beta ?? alpha;
    if (![alpha, beta].every((v) => Number.isFinite(v) && v >= 0)) {
      return { ok: false, error: "Baumgarte's α and β must be finite and non-negative." };
    }
    if (nuCons.some((v) => v > 2)) {
      return { ok: false, error: "Baumgarte stabilisation is offered for index 2 and 3 only (constraints differentiated at most twice). Use projection." };
    }
    baum = { alpha, beta };
  }

  // The last level of each constraint is SOLVED for the algebraic unknowns.
  const finalE: Expr[] = levels.map((ls, c) => {
    const v = nuCons[c];
    const top = ls[v].e;
    if (!baum || v === 0) return top;
    // ġ + 2α g = 0 (index 2); g̈ + 2α ġ + β² g = 0 (index 3).
    if (v === 1) return { t: "add", l: top, r: { t: "mul", l: NUM(2 * baum.alpha), r: ls[0].e } };
    return {
      t: "add",
      l: { t: "add", l: top, r: { t: "mul", l: NUM(2 * baum.alpha), r: ls[1].e } },
      r: { t: "mul", l: NUM(baum.beta * baum.beta), r: ls[0].e },
    };
  });
  const finalJ: Expr[][] = finalE.map((e, c) => alg.map((z) => levels[c][nuCons[c]].partial.get(z) ?? (freeVars(e).includes(z) ? safeSimplify(safeDerivative(e, z, "the final level"), "the final level") : NUM(0))));

  const hiddenRows: { c: number; k: number }[] = [];
  levels.forEach((ls, c) => { for (let k = 0; k < nuCons[c]; k++) hiddenRows.push({ c, k }); });

  // The differential part is printed at the order the user wrote it (x′′ = −lam·x),
  // NOT as the internal first-order chain (x′ = x′, x′′ = …): the chain's
  // "x′ = x′" does not read back through parseDaeSystem (display contract).
  // Every printed line re-parses with the same initial values (pinned).
  const reduced: string[] = sys.diff.map((d) => `${d.name}${"′".repeat(d.order)} = ${typesetDae(d.rhs)}`);
  // Each entry is a bare equation (it must parse back — display contract); where
  // each final level came from is said in `structural`.
  levels.forEach((_ls, c) => {
    reduced.push(`0 = ${typesetDae(finalE[c])}`);
    if (nuCons[c] > 0) {
      structural.push(`The final level of 0 = ${consShow[c]} is its ${dOrder(nuCons[c])}: 0 = ${typesetDae(finalE[c])}${baum ? " (Baumgarte-damped: lower levels added with the printed α, β)" : ""}.`);
    }
  });
  const hidden: string[] = [];
  levels.forEach((ls, c) => { for (let k = 1; k < ls.length; k++) hidden.push(`${typesetDae(ls[k].e)} = 0`); });
  const levelName = (c: number, k: number): string =>
    k === 0 ? `original constraint ${consShow[c]} = 0` : `hidden constraint ${typesetDae(levels[c][k].e)} = 0 (the ${ordinal(k)} derivative of ${consShow[c]} = 0)`;

  // --- Evaluation ------------------------------------------------------------
  const env = (t: number, X: number[], Z: number[]): Record<string, number> => {
    const v: Record<string, number> = { t };
    for (let i = 0; i < n; i++) v[states[i]] = X[i];
    for (let j = 0; j < m; j++) v[alg[j]] = Z[j];
    return v;
  };
  // WORK, NOT STEPS, IS THE BOUND. A step budget does not bound time: an
  // oscillator x' = 2000·u over [0, 100] spent 300 000 RK45 steps (~5 s, a
  // frozen Word) without finishing, and a 20 000-node constraint costs
  // thousands of times a pendulum's per step. Every evaluation is charged its
  // AST node count; past WORK_BUDGET every evaluation returns NaN, the
  // integrator stops, and the run says so by name. Deterministic (no clock).
  // Overheads (integrator bookkeeping, the env record, the Newton LU) are
  // charged too, calibrated so 1 unit ≈ 30–60 ns here (more for sin/pow-heavy ASTs). The wall clock is a
  // BACKSTOP only (checked every 256 charges): it fires on a machine far slower
  // than the calibration, and then the run says so rather than freezing.
  let work = 0;
  let workExhausted = false;
  let charges = 0;
  let timeGuardFired = false;
  const budgetNote = (t: number): string =>
    timeGuardFired
      ? `The run was stopped by the time guard at t = ${fmtV(t)} — the machine was slow (over ${DAE_TIME_GUARD_MS / 1000} s); the work budget was not reached. Run it again on a less loaded machine.`
      : `The work budget (${WORK_BUDGET.toExponential(0)} work units) ran out at t = ${fmtV(t)}. The solution needs too many steps at this tolerance — a fast oscillation or a long interval; shorten the interval or loosen rtol.`;
  const charge = (units: number): boolean => {
    work += units;
    if (work > WORK_BUDGET) workExhausted = true;
    else if ((++charges & 255) === 0 && clock() - started > DAE_TIME_GUARD_MS) { workExhausted = true; timeGuardFired = true; }
    return workExhausted;
  };
  const sizes = new WeakMap<Expr, number>();
  const ev = (e: Expr, vars: Record<string, number>): number => {
    let sz = sizes.get(e);
    if (sz === undefined) { sz = nodeCount(e) + 4; sizes.set(e, sz); }
    if (workExhausted || charge(sz)) return NaN;
    try { return evalAst(e, vars); } catch { return NaN; }
  };

  /** Newton on the final level for Z, from zStart. Null when it fails. */
  const solveZ = (t: number, X: number[], zStart: number[], maxIt = NEWTON_Z_MAX): number[] | null => {
    const z = zStart.slice();
    for (let it = 0; it < maxIt; it++) {
      if (charge(40 + 4 * (n + m) + 2 * m * m * m)) return null;
      const vars = env(t, X, z);
      const F = finalE.map((e) => ev(e, vars));
      if (!F.every(Number.isFinite)) return null;
      const J = finalJ.map((row) => row.map((e) => ev(e, vars)));
      if (!J.every((r) => r.every(Number.isFinite))) return null;
      const dz = luSolve(J, F.map((v) => -v));
      if (!dz) return null;
      let big = 0;
      for (let j = 0; j < m; j++) { z[j] += dz[j]; big = Math.max(big, Math.abs(dz[j]) / (1 + Math.abs(z[j]))); }
      if (!z.every(Number.isFinite)) return null;
      if (big <= 1e-14) return z;
    }
    // Accept a tiny residual even if the step test is noisy at round-off.
    const vars = env(t, X, z);
    const F = finalE.map((e) => ev(e, vars));
    const scale = 1 + Math.max(...z.map(Math.abs));
    return F.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e-10 * scale) ? z : null;
  };

  /** Gauss–Newton, minimum-norm, on `rows` moving only the states in `move`. */
  const project = (t: number, X: number[], rows: { c: number; k: number }[], move: number[], maxIt: number, tol: number): { X: number[]; ok: boolean } => {
    const x = X.slice();
    if (!rows.length || !move.length) return { X: x, ok: true };
    for (let it = 0; it < maxIt; it++) {
      if (charge(40 + 4 * n + 2 * rows.length * rows.length * (rows.length + move.length))) return { X: x, ok: false };
      const vars = env(t, x, []);
      const r = rows.map(({ c, k }) => ev(levels[c][k].e, vars));
      if (!r.every(Number.isFinite)) return { X: x, ok: false };
      if (Math.max(...r.map(Math.abs)) <= tol) return { X: x, ok: true };
      const J = rows.map(({ c, k }) => move.map((i) => { const p = levels[c][k].partial.get(states[i]); return p ? ev(p, vars) : 0; }));
      const JJt = J.map((a) => J.map((b) => a.reduce((s, v, q) => s + v * b[q], 0)));
      const y = luSolve(JJt, r);
      if (!y) return { X: x, ok: false };
      for (let q = 0; q < move.length; q++) {
        let d = 0;
        for (let p = 0; p < rows.length; p++) d += J[p][q] * y[p];
        x[move[q]] -= d;
      }
      if (!x.every(Number.isFinite)) return { X: x, ok: false };
    }
    const vars = env(t, x, []);
    const r = rows.map(({ c, k }) => ev(levels[c][k].e, vars));
    return { X: x, ok: r.every((v) => Number.isFinite(v) && Math.abs(v) <= tol) };
  };

  // --- 5. Consistent initial point ------------------------------------------
  const X0user = states.map((s) => sys.init[s]);
  if (!X0user.every(Number.isFinite)) return { ok: false, error: "Every initial value must be a finite number." };
  let X0 = X0user.slice();
  const projectedInit: string[] = [];
  const TOL0 = 1e-10;
  const maxLevel = Math.max(0, ...nuCons) - 1;
  const known = new Set<number>();
  const violations: string[] = [];
  {
    const vars = env(t0, X0user, []);
    for (const { c, k } of hiddenRows) {
      const r = ev(levels[c][k].e, vars);
      if (!Number.isFinite(r)) return { ok: false, error: `The ${levelName(c, k)} cannot be evaluated at the initial values.` };
      if (Math.abs(r) > TOL0) violations.push(`${levelName(c, k)}: residual ${fmtV(r)} at the values given`);
    }
  }
  for (let k = 0; k <= maxLevel; k++) {
    const rows = hiddenRows.filter((h) => h.k === k);
    if (!rows.length) continue;
    const used = new Set<number>();
    for (const { c } of rows) for (const v of freeVars(levels[c][k].e)) if (stateSet.has(v)) used.add(states.indexOf(v));
    const fresh = [...used].filter((i) => !known.has(i));
    const move = fresh.length ? fresh : [...used];
    const p = project(t0, X0, rows, move, INIT_GN_MAX, 1e-13);
    if (!p.ok) {
      const vars = env(t0, p.X, []);
      const worst = rows.map(({ c, k: kk }) => ({ c, kk, r: Math.abs(ev(levels[c][kk].e, vars)) })).sort((a, b) => b.r - a.r)[0];
      return {
        ok: false,
        error: `The initial values are inconsistent and could not be projected onto the ${levelName(worst.c, worst.kk)} — residual ${fmtV(worst.r)} after ${INIT_GN_MAX} Gauss–Newton iterations. Give initial values that satisfy it.`,
      };
    }
    X0 = p.X;
    for (const i of used) known.add(i);
  }
  // A last stacked pass in case a later level disturbed an earlier one.
  if (hiddenRows.length) {
    const p = project(t0, X0, hiddenRows, states.map((_s, i) => i), INIT_GN_MAX, 1e-13);
    if (!p.ok) {
      return { ok: false, error: "The initial values could not be projected onto all of the original and hidden constraints at once — they may be incompatible at t₀." };
    }
    X0 = p.X;
  }
  const moved = states.map((_s, i) => i).filter((i) => Math.abs(X0[i] - X0user[i]) > 1e-12 * (1 + Math.abs(X0user[i])));
  if (violations.length) {
    for (const v of violations) projectedInit.push(`The initial values violate the ${v}.`);
    for (const i of moved) {
      projectedInit.push(`${sys.states[i].label.replace(/'/g, "′")}₀ = ${fmtV(X0user[i])} was moved to ${sys.states[i].label.replace(/'/g, "′")}₀ = ${fmtV(X0[i])}.`);
    }
    projectedInit.push("A DAE does not accept arbitrary initial values: the start must lie on every original AND hidden constraint. Each level was projected (Gauss–Newton, minimum-norm) moving only the states that level introduces, so states fixed by an earlier level keep their values.");
    caveats.push("The initial values were MOVED onto the constraints (see above). The answer starts from the projected point, not the one entered.");
  }

  // --- 4. Numerical confirmation at t₀ ---------------------------------------
  const cancelMsg = (): string | null => {
    const out: string[] = [];
    levels.forEach((ls, c) => {
      const v = nuCons[c];
      const rawZ = freeVars(rawFinal[c]).filter((z) => algSet.has(z));
      for (const z of rawZ) {
        const p = ls[v].partial.get(z);
        if (!p) {
          out.push(
            v === 0
              ? `∂/∂${z} of the constraint ${consShow[c]} is identically 0 — ${z} appears in it but cancels`
              : `${dOrder(v)}(${consShow[c]}) = ${typesetDae(rawFinal[c])} loses ${z} by cancellation (it simplifies to ${typesetDae(ls[v].e)})`,
          );
        }
      }
    });
    return out.length ? out.join("; ") : null;
  };
  const singularRefusal = (detail: string | null, zs: string[]): DaeAutoOutcome => ({
    ok: false,
    error:
      `Structural analysis (Pantelides) reports index ${index}, but the differentiated system is numerically singular at t₀ = ${fmtV(t0)}` +
      (detail ? `: ${detail}` : `: the Jacobian of the final level with respect to ${alg.join(", ")} is singular there`) +
      `. The structural index is not the true index here, and the system may not determine ${zs.join(", ")} at all.`,
  });
  // Symbolically dead column or row: no Newton start can help.
  {
    const deadCols = alg.filter((_z, j) => finalJ.every((row) => isZero(row[j])));
    const deadRows = finalJ.some((row) => row.every(isZero));
    if (deadCols.length || deadRows) return singularRefusal(cancelMsg(), deadCols.length ? deadCols : alg);
  }
  const guess0 = alg.map((z) => (z in sys.guesses ? sys.guesses[z] : 0));
  let Z0: number[] | null = null;
  for (const shift of [0, 1, -1, 0.5, 2, -2]) {
    Z0 = solveZ(t0, X0, guess0.map((g) => g + shift), 60);
    if (Z0) break;
  }
  if (!Z0) {
    const vars = env(t0, X0, guess0);
    const J = finalJ.map((row) => row.map((e) => ev(e, vars)));
    if (isNearlySingular(J)) return singularRefusal(cancelMsg(), alg);
    return {
      ok: false,
      error: `Newton could not solve the final level for ${alg.join(", ")} at t₀ from the starting guess ${alg.map((z, j) => `${z} = ${fmtV(guess0[j])}`).join(", ")} (shifts of ±1, ±2 tried too). Give a better guess for ${alg.join(", ")}.`,
    };
  }
  {
    const vars = env(t0, X0, Z0);
    const J = finalJ.map((row) => row.map((e) => ev(e, vars)));
    if (isNearlySingular(J)) return singularRefusal(cancelMsg(), alg);
    confirm.push(
      `Numerical confirmation at t₀: the Jacobian of the final level with respect to ${alg.join(", ")} is nonsingular (${m === 1 ? `∂/∂${alg[0]} = ${fmtV(J[0][0])}` : `${m}×${m}, pivoted LU`}), so the structural index ${index} is the true index at t₀.`,
    );
  }
  confirm.push(`Consistent algebraic start: ${alg.map((z, j) => `${z}₀ = ${fmtV((Z0 as number[])[j])}`).join(", ")} (solved from the final level, not chosen).`);
  const nonlinearZ = finalJ.some((row) => row.some((e) => freeVars(e).some((v) => algSet.has(v))));
  if (nonlinearZ) caveats.push(`The final level is nonlinear in ${alg.join(", ")}, so it may have more than one root; Newton followed the one nearest the starting guess, continuously in t.`);

  // --- 6. Integrate the reduced system in segments ----------------------------
  const dir = t1 > t0 ? 1 : -1;
  const span = Math.abs(t1 - t0);
  const grid: number[] = [];
  for (let i = 0; i <= points; i++) grid.push(i === points ? t1 : t0 + ((t1 - t0) * i) / points);
  for (const te of tEval) if ((te - t0) * dir > 0 && (t1 - te) * dir > 0) grid.push(te);
  grid.sort((a, b) => (a - b) * dir);
  const times: number[] = [grid[0]];
  for (const g of grid) if (Math.abs(g - times[times.length - 1]) > 1e-12 * Math.max(1, span)) times.push(g);
  if (times[times.length - 1] !== t1) times[times.length - 1] = t1;

  let zAcc = Z0.slice();
  let newtonFailT: number | null = null;
  const f = (t: number, X: number[]): number[] => {
    // The integrator's own per-evaluation cost (stages, error norm, and for the
    // Rosenbrock path an FD Jacobian column and LU share) — measured, not guessed:
    // an oscillator at ω = 2000 costs ≈ 5 µs per call with 20 nodes of AST.
    if (charge(110 + 12 * (n + m))) return X.map(() => NaN);
    const Z = solveZ(t, X, zAcc);
    if (!Z) {
      if (workExhausted) return X.map(() => NaN);
      if (newtonFailT === null) newtonFailT = t;
      return X.map(() => NaN);
    }
    const vars = env(t, X, Z);
    return sys.stateRhs.map((e) => ev(e, vars));
  };

  const T: number[] = [t0];
  const XS: number[][] = [X0.slice()];
  const ZS: number[][] = [Z0.slice()];
  const driftBefore = hiddenRows.map(() => 0);
  const driftAfter = hiddenRows.map(() => 0);
  const finalRes = finalE.map(() => 0);
  {
    const vars = env(t0, X0, Z0);
    hiddenRows.forEach(({ c, k }, q) => { driftAfter[q] = Math.abs(ev(levels[c][k].e, vars)); driftBefore[q] = driftAfter[q]; });
    finalE.forEach((e, c) => { finalRes[c] = Math.abs(ev(e, vars)); });
  }
  let X = X0.slice();
  let completed = true;
  let budget = MAX_ODE_STEPS;
  let hNext: number | undefined;
  const methods = new Set<string>();
  let stopNote = "";
  let stopKind: "work" | "newton" | "steps" | "integrator" | "singular" | null = null;
  const allIdx = states.map((_s, i) => i);
  // SINGULARITY WATCH ON ∂(final level)/∂z, BETWEEN OUTPUT NODES.
  // Index 1 at t₀ is not index 1 everywhere. When the differential part does
  // not feed back through z (y' = −1, 0 = y·z − 1), Newton converges on BOTH
  // sides of the pole and the integrator never notices: the run used to claim
  // completion across t = 1 with z(2) = −1. So after every ACCEPTED step the
  // Jacobian's determinant is checked for a sign change or near-singularity
  // (Hadamard ratio), and a crossing is located by bisection inside the step.
  const detInfo = (t: number, Xv: number[], Zv: number[]): { det: number; ratio: number } => {
    const vars = env(t, Xv, Zv);
    const A = finalJ.map((row) => row.map((e) => ev(e, vars)));
    if (!A.every((r) => r.every(Number.isFinite))) return { det: NaN, ratio: NaN };
    let hadamard = 1;
    for (const r of A) hadamard *= Math.sqrt(r.reduce((s2, v) => s2 + v * v, 0));
    const M = A.map((r) => r.slice());
    let det = 1;
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (M[p][c] === 0) return { det: 0, ratio: 0 };
      if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; det = -det; }
      det *= M[c][c];
      for (let r = c + 1; r < m; r++) {
        const fct = M[r][c] / M[c][c];
        for (let q = c; q < m; q++) M[r][q] -= fct * M[c][q];
      }
    }
    return { det, ratio: hadamard > 0 ? Math.abs(det) / hadamard : 0 };
  };
  const SING_RATIO = 1e-10;
  let singularAt: { lo: number; hi: number } | null = null;
  let detPrev = detInfo(t0, X0, Z0).det;
  for (let s = 1; s < times.length; s++) {
    const ta = times[s - 1];
    const tb = times[s];
    newtonFailT = null;
    let zStep = zAcc.slice();
    const onStep = (tPrev: number, yPrev: number[], tNew: number, yNew: number[]): boolean => {
      if (singularAt || workExhausted) return false;
      const Zn = solveZ(tNew, yNew, zStep);
      const di = Zn ? detInfo(tNew, yNew, Zn) : { det: NaN, ratio: NaN };
      const flipped = Number.isFinite(di.det) && Number.isFinite(detPrev) && Math.sign(di.det) !== Math.sign(detPrev);
      if (Zn && !flipped && di.ratio > SING_RATIO) {
        zStep = Zn;
        detPrev = di.det;
        return true;
      }
      if (workExhausted) return false;
      // Locate the singular point inside [tPrev, tNew] by bisection on the
      // determinant's sign along the (linearly interpolated) step.
      let lo = tPrev, hi = tNew, zLo = zStep.slice();
      for (let it = 0; it < 50 && Math.abs(hi - lo) > 1e-12 * Math.max(1, Math.abs(hi)); it++) {
        const mid = (lo + hi) / 2;
        const w = (mid - tPrev) / (tNew - tPrev);
        const Xm = yPrev.map((v, i) => v + w * (yNew[i] - v));
        const Zm = solveZ(mid, Xm, zLo);
        const dm = Zm ? detInfo(mid, Xm, Zm) : { det: NaN, ratio: NaN };
        if (Zm && Number.isFinite(dm.det) && Math.sign(dm.det) === Math.sign(detPrev) && dm.ratio > SING_RATIO) { lo = mid; zLo = Zm; }
        else hi = mid;
      }
      if (workExhausted) return false; // a budget stop is not a singularity
      singularAt = { lo, hi };
      return false;
    };
    const res = solveOde(f, X, ta, tb, {
      rtol, atol, maxSteps: Math.max(1, budget), method: opts.method ?? "auto", onStep,
      ...(hNext ? { hInit: Math.min(Math.abs(tb - ta), hNext) * dir } : {}),
    });
    budget -= res.steps;
    if (res.method) methods.add(res.method);
    const yEnd = res.y[res.y.length - 1];
    if (singularAt) {
      const sa = singularAt as { lo: number; hi: number };
      completed = false;
      stopKind = "singular";
      stopNote =
        `∂g/∂${alg.length === 1 ? alg[0] : "z"} (the Jacobian of the final level with respect to ${alg.join(", ")}) is singular at t ≈ ${fmtV((sa.lo + sa.hi) / 2)} — ` +
        `no continuous solution beyond it, so the run stops there. The index-1 condition held at t₀ but fails at that point.`;
      break;
    }
    if (!res.completed || !yEnd.every(Number.isFinite)) {
      completed = false;
      const tStop = res.t[res.t.length - 1];
      stopKind = workExhausted ? "work" : newtonFailT !== null ? "newton" : budget <= 0 ? "steps" : "integrator";
      stopNote = workExhausted
        ? budgetNote(tStop)
        : newtonFailT !== null
          ? `Newton could not solve the final level for ${alg.join(", ")} near t = ${fmtV(newtonFailT)} — the index or the solution branch changes there (the numerical confirmation covers t₀ only).`
          : budget <= 0
            ? `The step budget (${MAX_ODE_STEPS} steps) ran out at t = ${fmtV(tStop)}.`
            : `The integrator stopped at t = ${fmtV(tStop)} (${res.stopReason ?? "step size underflow"}).`;
      break;
    }
    if (res.t.length >= 2) hNext = Math.abs(res.t[res.t.length - 1] - res.t[res.t.length - 2]);
    X = yEnd.slice();
    // Drift BEFORE projection, then project, then drift AFTER.
    {
      const vars = env(tb, X, []);
      hiddenRows.forEach(({ c, k }, q) => { driftBefore[q] = Math.max(driftBefore[q], Math.abs(ev(levels[c][k].e, vars))); });
    }
    if (!baum && hiddenRows.length) {
      const p = project(tb, X, hiddenRows, allIdx, STEP_GN_MAX, 0);
      if (p.X.every(Number.isFinite)) X = p.X;
    }
    const Z = solveZ(tb, X, zAcc);
    if (!Z) {
      completed = false;
      stopKind = workExhausted ? "work" : "newton";
      stopNote = workExhausted
        ? budgetNote(tb)
        : `Newton could not solve the final level for ${alg.join(", ")} at t = ${fmtV(tb)} — the index or the solution branch changes there (the numerical confirmation covers t₀ only).`;
      break;
    }
    zAcc = Z;
    detPrev = detInfo(tb, X, Z).det;
    const vars = env(tb, X, Z);
    hiddenRows.forEach(({ c, k }, q) => { driftAfter[q] = Math.max(driftAfter[q], Math.abs(ev(levels[c][k].e, vars))); });
    finalE.forEach((e, c) => { finalRes[c] = Math.max(finalRes[c], Math.abs(ev(e, vars))); });
    T.push(tb); XS.push(X.slice()); ZS.push(Z.slice());
  }

  let method = [...methods].join(", ") || "rk45";
  let usedFallback = false;
  // Index 1 only, and only when the INTEGRATOR gave up (step-size underflow on a
  // stiff problem) — never when the work budget ran out (a fast oscillation:
  // fixed-step implicit Euler would damp it into a confident wrong answer) and
  // never after a Newton failure (the index changed; Euler cannot fix that).
  // The fallback's error is ESTIMATED by step doubling and printed, never assumed.
  if (!completed && index === 1 && stopKind === "integrator") {
    const fF = (t: number, Y: number[], Zv: number[]) => sys.stateRhs.map((e) => ev(e, env(t, Y, Zv)));
    const gF = (t: number, Y: number[], Zv: number[]) => sys.cons.map((e) => ev(e, env(t, Y, Zv)));
    const coarse = solveDae(fF, gF, t0, t1, X0, Z0, { steps: 4000, reportPoints: points + 1 });
    const fine = solveDae(fF, gF, t0, t1, X0, Z0, { steps: 8000, reportPoints: points + 1 });
    if (coarse.ok && fine.ok && coarse.result.completed && fine.result.completed && !workExhausted) {
      const a = coarse.result.y[coarse.result.y.length - 1];
      const b = fine.result.y[fine.result.y.length - 1];
      const est = Math.max(...a.map((v, i) => Math.abs(v - b[i]) / Math.max(1, Math.abs(b[i]))));
      usedFallback = true;
      completed = true;
      T.length = 0; XS.length = 0; ZS.length = 0;
      fine.result.t.forEach((t, i) => { T.push(t); XS.push(fine.result.y[i]); ZS.push(fine.result.z[i]); });
      finalRes.fill(fine.result.maxConstraintResidual);
      method = "implicit Euler (fallback)";
      caveats.push(
        `The ODE integrators could not finish this stiff index-1 system (${stopNote}), so it was solved by FIRST-order implicit Euler with 8000 steps instead. ` +
          `Step doubling (4000 vs 8000 steps) estimates the relative error at the end as ${fmtE(est)} — that, not the tolerance above, is the accuracy statement.`,
      );
      stopNote = "";
      stopKind = null;
    }
  }

  // --- Report ------------------------------------------------------------------
  steps.push(...structural);
  if (hidden.length) steps.push(`Hidden constraints (each a time derivative of an original one; the solution must satisfy them all): ${hidden.join(";  ")}.`);
  steps.push(`Reduced system integrated: ${reduced.join(";  ")}. The final level is solved for ${alg.join(", ")} by Newton at every evaluation.`);
  steps.push(...projectedInit, ...confirm);
  const dt = span / points;
  if (!usedFallback) {
    steps.push(
      `Integrated with ode.ts solveOde (${method === "rk45" ? "Dormand–Prince RK45" : method}) at rtol ${rtol.toExponential(0)}, atol ${atol.toExponential(0)}, in ${times.length - 1} segments` +
        (hiddenRows.length
          ? baum
            ? `; Baumgarte stabilisation with α = ${baum.alpha}, β = ${baum.beta} (these change the answer; no projection).`
            : `; after each segment (every Δt ≈ ${fmtV(dt)}) the state was projected onto the original and hidden constraints (Gauss–Newton, at most ${STEP_GN_MAX} iterations, minimum-norm correction).`
          : "."),
    );
  }

  const drift: DaeDrift[] = [];
  hiddenRows.forEach(({ c, k }, q) => {
    drift.push({ constraint: k === 0 ? consShow[c] : typesetDae(levels[c][k].e), level: k, source: c, before: driftBefore[q], after: driftAfter[q], solved: false });
  });
  finalE.forEach((_e, c) => {
    const v = nuCons[c];
    drift.push({ constraint: v === 0 ? consShow[c] : typesetDae(levels[c][v].e), level: v, source: c, before: finalRes[c], after: finalRes[c], solved: true });
  });
  drift.sort((a, b) => a.source - b.source || a.level - b.level);
  for (const d of drift) {
    const label = d.level === 0 ? "Original constraint" : `Hidden constraint (${ordinal(d.level)} derivative)`;
    if (d.solved) {
      steps.push(`${label} ${d.constraint} = 0: solved for ${alg.join(", ")} at every evaluation — max residual ${fmtE(d.after)}.`);
    } else if (baum) {
      steps.push(`${label} ${d.constraint} = 0: drift ${fmtE(d.after)} (Baumgarte, no projection).`);
    } else {
      steps.push(`${label} ${d.constraint} = 0: drift before projection ${fmtE(d.before)}, after ${fmtE(d.after)}.`);
    }
  }
  const unsolved = drift.filter((d) => !d.solved);
  if (unsolved.length) {
    const worst = unsolved.reduce((a, b) => (b.after > a.after ? b : a));
    steps.push(`Worst constraint after stabilisation: ${worst.constraint} = 0, max |residual| ${fmtE(worst.after)}.`);
  }
  if (!completed) steps.push(`The run stopped early. ${stopNote}`);

  if (index === 1) {
    caveats.push(
      "Index 1 as typed: each constraint is solved for the algebraic unknowns at every evaluation, so its residual is Newton's. " +
        "If a constraint here was obtained by differentiating another one by hand (as 0 = u² + v² − lam·(x² + y²) − 9.81·y is for the pendulum's x² + y² − 1), " +
        "the original constraint is not among the equations and its drift cannot be checked — enter the original and let the reduction differentiate it.",
    );
  } else {
    caveats.push(
      `Projection is not energy-conserving: it keeps the solution on every constraint but is not a symplectic method. The drift lines above and rtol are the accuracy statement.`,
    );
  }
  caveats.push(`Pantelides can be fooled by cancellation; the numerical confirmation covers t₀ only — a loss of rank later shows up as a Newton failure, reported with its t.`);
  caveats.push(`Limits: structural index ≤ ${DAE_MAX_INDEX}, ≤ ${DAE_MAX_UNKNOWNS} unknowns, semi-explicit form (name' = … plus constraints), no events on algebraic unknowns.`);
  if (!completed) caveats.push("The run did NOT reach the final time. What is reported ends where it stopped.");

  const names = [...sys.states.map((s) => s.label), ...alg];
  const out: Record<string, number[]> = {};
  names.forEach((nm, j) => { out[nm] = T.map((_t, k) => (j < n ? XS[k][j] : ZS[k][j - n])); });

  return {
    ok: true,
    result: {
      index, structural, reduced, hidden, projectedInit, names,
      t: T, states: out, drift, method, steps, caveats, completed, rtol, atol, workUsed: work,
    },
  };
}
