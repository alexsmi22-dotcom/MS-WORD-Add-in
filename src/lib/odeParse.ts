// Parsing and order-reduction for the ODE tool.
//
// The point of this module is that a user should be able to type the equation
// they actually have:
//
//     y'' = -y                       (a second-order ODE)
//     y'' + 0.1y' + y = 0            → typed as  y'' = -0.1*y' - y
//     x'' = -x ; m'' = -9.81         (several higher-order equations at once)
//
// ...rather than being made to hand-reduce it to a first-order system. Every
// numerical integrator only solves first-order systems, so the reduction has to
// happen somewhere; doing it here instead of in the user's head is the whole
// difference between a no-code tool and a homework exercise.
//
// Reduction is the standard one: for y of order n, introduce the state vector
// (y, y', …, y^(n-1)) and set each state's derivative to the next, with the
// user's right-hand side supplying the last one.
//
// Pure; no DOM. The expression strings it emits are evaluated by evalFormula.

/** One state variable of the reduced first-order system. */
export interface OdeState {
  /** Display name, e.g. "y" or "y'". */
  label: string;
  /** Internal variable name used inside expressions, e.g. "y" or "y__d1". */
  varName: string;
  /** Base function this came from ("y") and which derivative it is (0, 1, …). */
  base: string;
  order: number;
}

export interface OdeSystem {
  states: OdeState[];
  /** RHS expression per state, in evalFormula syntax over the internal names. */
  rhs: string[];
  /** Initial value per state. */
  y0: number[];
  /** True when any input equation was higher than first order. */
  reduced: boolean;
}

export type OdeParse = { ok: true; system: OdeSystem } | { ok: false; error: string };

/**
 * Rewrites an auxiliary expression written in the user's notation into the
 * system's internal state names — so a stop condition like "y' " or "y - 100"
 * resolves against the reduced system exactly as the equations do.
 */
export function rewriteStateExpression(expr: string, system: OdeSystem): string {
  const maxOrder = new Map<string, number>();
  for (const s of system.states) maxOrder.set(s.base, Math.max(maxOrder.get(s.base) ?? 0, s.order));
  return substituteDerivatives(expr, maxOrder);
}

/**
 * Parses a list of output times: either explicit values ("0, 1, 2.5") or a
 * MATLAB-style range ("0:0.5:10" = start:step:stop). Returns [] for blank input.
 */
export function parseTimeList(text: string): { ok: true; times: number[] } | { ok: false; error: string } {
  const s = text.trim();
  if (!s) return { ok: true, times: [] };
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => Number(x.trim()));
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
      return { ok: false, error: `Couldn't read "${s}". Use start:step:stop, e.g. 0:0.5:10` };
    }
    const [a, step, b] = parts;
    if (step === 0) return { ok: false, error: "The step in start:step:stop cannot be zero." };
    if ((b - a) / step < 0) return { ok: false, error: `"${s}" steps away from the stop value.` };
    const n = Math.floor((b - a) / step + 1e-9);
    if (n > 20000) return { ok: false, error: `"${s}" asks for over 20,000 points; use a larger step.` };
    const times: number[] = [];
    for (let i = 0; i <= n; i++) times.push(a + i * step);
    return { ok: true, times };
  }
  const times = s
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (times.some((x) => !Number.isFinite(x))) {
    return { ok: false, error: `Couldn't read the times "${s}". Use  0, 1, 2  or  0:0.5:10` };
  }
  return { ok: true, times };
}

/** Internal name for the k-th derivative of `base`. k = 0 is the function itself. */
function derivVar(base: string, k: number): string {
  return k === 0 ? base : `${base}__d${k}`;
}

/** Display label for the k-th derivative: y, y', y'', y'''… then y⁽⁴⁾. */
function derivLabel(base: string, k: number): string {
  if (k === 0) return base;
  if (k <= 3) return base + "'".repeat(k);
  return `${base}^(${k})`;
}

/**
 * Rewrites derivative tokens in an expression to their internal variable names,
 * so `-0.1*y' - y` becomes `-0.1*y__d1 - y`.
 *
 * Longest-first matters: replacing y' before y'' would turn y'' into y__d1'.
 */
function substituteDerivatives(expr: string, maxOrder: Map<string, number>): string {
  const bases = [...maxOrder.keys()].sort((a, b) => b.length - a.length);
  let out = expr;
  for (const base of bases) {
    const highest = maxOrder.get(base) ?? 0;
    for (let k = highest; k >= 1; k--) {
      // Match `base` followed by exactly k primes and not more, as a whole token.
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(base)}'{${k}}(?!')`, "g");
      out = out.replace(re, derivVar(base, k));
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits "a, b" on commas that are not inside parentheses. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Parses the equation block and the initial-value line into a first-order
 * system, reducing any higher-order equations automatically.
 *
 * Equations:  NAME' = expr   |   NAME'' = expr   |   NAME''' = expr  …
 *             one per line (or separated by ";").
 * Initials:   y = 1, y' = 0    (or  y(0) = 1, y'(0) = 0)
 */
export function parseOdeSystem(eqsText: string, y0Text: string): OdeParse {
  const lines = splitTopLevel(eqsText.replace(/\n/g, ";"), ";");
  if (!lines.length) return { ok: false, error: "Enter at least one equation, e.g.  y' = -y" };

  // --- Pass 1: read each equation's base name, order, and RHS --------------
  const orderOf = new Map<string, number>();
  const rhsOf = new Map<string, string>();
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*('+)\s*=\s*(.+)$/.exec(line);
    if (!m) {
      const looksLikeNoPrime = /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);
      return {
        ok: false,
        error: looksLikeNoPrime
          ? `"${line}" has no derivative. Write the equation for a derivative, e.g.  y' = -y  or  y'' = -y`
          : `Couldn't parse "${line}". Use  y' = expression  (or y'' = … for second order).`,
      };
    }
    const base = m[1];
    const order = m[2].length;
    if (orderOf.has(base)) {
      return { ok: false, error: `"${base}" has more than one equation. Give exactly one equation per function.` };
    }
    if (order > 6) return { ok: false, error: `"${base}" is order ${order}; up to 6 is supported.` };
    orderOf.set(base, order);
    rhsOf.set(base, m[3].trim());
  }

  // --- Pass 2: build the reduced state vector -----------------------------
  // For y of order n the states are y, y', …, y^(n-1); the derivative of each is
  // simply the next state, and the user's RHS supplies the last one.
  const states: OdeState[] = [];
  const rhs: string[] = [];
  for (const [base, n] of orderOf) {
    for (let k = 0; k < n; k++) {
      states.push({ label: derivLabel(base, k), varName: derivVar(base, k), base, order: k });
      rhs.push(k < n - 1 ? derivVar(base, k + 1) : substituteDerivatives(rhsOf.get(base) as string, orderOf));
    }
  }

  // A right-hand side may only reference states that exist (plus t). Catch the
  // classic mistake — y'' = -y' where y' was never given an order — early and
  // by name, rather than as an opaque "unknown variable" at solve time.
  const known = new Set(states.map((s) => s.varName));
  for (let idx = 0; idx < rhs.length; idx++) {
    // Any prime left after substitution is a derivative the system does not
    // carry — e.g. y' = -y'' , where y is only order 1 so y'' is not a state.
    // Without this the stray "y''" survives into the expression and only fails
    // later, deep in the evaluator, with an opaque message.
    const stray = /([A-Za-z_][A-Za-z0-9_]*'+)/.exec(rhs[idx]);
    if (stray) {
      return {
        ok: false,
        error: `"${states[idx].label}' = ${rhsOf.get(states[idx].base)}" refers to "${stray[1]}", which isn't a state of this system. Raise the order of "${stray[1].replace(/'+$/, "")}" or check the primes.`,
      };
    }
    for (const tok of rhs[idx].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (tok === "t" || tok === "pi" || tok === "e") continue;
      if (known.has(tok)) continue;
      // Not a state: it must be a function call to be legal. A bare name is not.
      const isCall = new RegExp(`${escapeRe(tok)}\\s*\\(`).test(rhs[idx]);
      if (isCall) continue;
      const pretty = tok.replace(/__d(\d+)/, (_x, d) => "'".repeat(Number(d)));
      return {
        ok: false,
        error: `"${states[idx].label}' = ${rhsOf.get(states[idx].base)}" refers to "${pretty}", which isn't a state of this system. Add an equation for it, or check the spelling.`,
      };
    }
  }

  // --- Pass 3: initial values ---------------------------------------------
  // Accept  y = 1  and  y(0) = 1  and  y'(0) = 0.
  const initials = new Map<string, number>();
  for (const part of splitTopLevel(y0Text, ",")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*('*)\s*(?:\(\s*[^)]*\s*\))?\s*=\s*(.+)$/.exec(part);
    if (!m) return { ok: false, error: `Couldn't read the initial value "${part}". Use  y = 1, y' = 0` };
    const v = Number(m[3].trim());
    if (!Number.isFinite(v)) return { ok: false, error: `Initial value for "${m[1]}${m[2]}" must be a number.` };
    initials.set(derivVar(m[1], m[2].length), v);
  }

  const y0: number[] = [];
  for (const st of states) {
    const v = initials.get(st.varName);
    if (v === undefined) {
      const needed = states.map((x) => `${x.label} = …`).join(", ");
      return {
        ok: false,
        error: `Missing an initial value for "${st.label}". A system of order ${states.length} needs ${states.length}: ${needed}`,
      };
    }
    y0.push(v);
  }
  // An initial value naming something that isn't a state is a typo worth catching.
  for (const key of initials.keys()) {
    if (!known.has(key)) {
      const pretty = key.replace(/__d(\d+)/, (_x, d) => "'".repeat(Number(d)));
      return { ok: false, error: `Initial value given for "${pretty}", which isn't a state of this system.` };
    }
  }

  return {
    ok: true,
    system: { states, rhs, y0, reduced: [...orderOf.values()].some((n) => n > 1) },
  };
}
