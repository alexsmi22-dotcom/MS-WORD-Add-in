// THE DERIVATIVE AND INTEGRAL KINDS READ THE TASK, NOT JUST THE EXPRESSION.
//
// The pane used to hand its raw text straight to differentiate()/antiderivative(),
// so the task words parsed as VARIABLES: "integrate x^2 from 0 to 3" came back as
// "0 + C" (integrate·x²·from·0·to·3 differentiated in x is a constant times x² … and
// the constant 0·… collapsed), "derivative of x^3" as 3·derivative·of·x², and
// "d/dx sin(x)" as d·cos(x)/dx — confident wrong answers (review 2026-10-24).
//
// This module strips the task prose and the d/dx / dx notation, reads
// "from a to b" as the limits of a DEFINITE integral, and REFUSES when a prose word
// survives the strip (it would otherwise be read as a constant factor).
//
// One function, called by the pane and by the tests (taskpane parsers are untestable).

import { parseExpr, type Expr } from "./solve";

export type CalcTask =
  | {
      ok: true;
      /** The expression the engine should see. */
      expr: string;
      /** The variable named by d/dx, dx, or "with respect to t", when one was. */
      variable?: string;
      /** Definite-integral limits as typed ("0", "pi/2"), when "from a to b" was given. */
      from?: string;
      to?: string;
      /** True when anything was stripped (so the pane can say what it read). */
      stripped: boolean;
    }
  | { ok: false; reason: string };

/** Multi-letter names that are mathematics, not prose. */
const MATH_NAMES = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "sec", "csc", "cot", "exp", "ln", "log", "log10", "log2", "sqrt", "cbrt", "abs", "sign", "floor", "ceil",
  "pi", "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "nu", "rho", "sigma", "tau",
  "phi", "chi", "psi", "omega", "kappa", "zeta", "eta", "xi",
]);

const LEAD_RE =
  /^(?:please\s+)?(?:(?:find|what\s+is|what's|evaluate|compute|calculate|determine|give|work\s+out|take)\s+)?(?:the\s+)?(?:(?:indefinite|definite)\s+)?(?:(?:first\s+)?derivative|integral|antiderivative|anti-derivative|primitive)(?:\s+of)?\s+|^(?:please\s+)?(?:differentiate|integrate)\s+/i;
const DDX_RE = /^d\s*(?:[a-zA-Z]\s*)?\/\s*d\s*([a-zA-Z])\s*(?:of\s+)?/;
const INT_SIGN_RE = /^(?:∫|int\s+(?=[^(,]))\s*/i;
const WRT_RE = /\s*,?\s*(?:with\s+respect\s+to|w\.?\s*r\.?\s*t\.?)\s+([a-zA-Z])\s*$/i;
const TRAIL_D_RE = /([\s*·)])\s*d([a-zA-Z])\s*$/;
// "from a to b" at the end, or right after the task words ("integral from 0 to 3 of x^2").
const FROM_TO_END_RE = /\s+from\s+(.+?)\s+to\s+(.+?)\s*$/i;
const FROM_TO_LEAD_RE = /^from\s+(\S+)\s+to\s+(\S+)\s+of\s+/i;
const TO_BOUNDS_RE = /\s+(?:over|on)\s*\[\s*([^,\]]+?)\s*,\s*([^\]]+?)\s*\]\s*$/i;

function identifiers(e: Expr, out: Set<string>): void {
  switch (e.t) {
    case "var": out.add(e.name); return;
    case "num": return;
    case "neg": identifiers(e.e, out); return;
    case "fn": identifiers(e.arg, out); return;
    default: identifiers(e.l, out); identifiers(e.r, out);
  }
}

/**
 * Reads a derivative / integral TASK. Returns null when the text carries no task words or calculus notation (the
 * caller then uses it as typed — nothing changes for a bare "sin(x^2)").
 */
export function parseCalculusTask(raw: string, kind: "derivative" | "integral"): CalcTask | null {
  let s = raw.trim().replace(/[?.;:]+\s*$/, "").trim();
  if (!s) return null;
  let stripped = false;
  let variable: string | undefined;
  let from: string | undefined, to: string | undefined;

  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(LEAD_RE, "");
    const dd = DDX_RE.exec(s);
    if (dd) {
      if (kind === "integral") return { ok: false, reason: "“d/dx” asks for a DERIVATIVE — switch to the Derivative kind for that." };
      variable = dd[1];
      s = s.slice(dd[0].length);
    }
    if (kind === "integral") s = s.replace(INT_SIGN_RE, "");
    const ft = FROM_TO_LEAD_RE.exec(s);
    if (ft) {
      from = ft[1];
      to = ft[2];
      s = s.slice(ft[0].length);
    }
    if (s !== before) stripped = true;
    else break;
  }
  // Trailing clauses: "with respect to t", "from 0 to 3", "over [0, 3]", "dx" — in any order the prose allows.
  for (let i = 0; i < 4; i++) {
    const before = s;
    const w = WRT_RE.exec(s);
    if (w) {
      if (variable && variable !== w[1]) return { ok: false, reason: `Two different variables were named (${variable} and ${w[1]}).` };
      variable = w[1];
      s = s.slice(0, w.index);
    }
    const ft = FROM_TO_END_RE.exec(s) ?? TO_BOUNDS_RE.exec(s);
    if (ft) {
      if (kind === "derivative") return { ok: false, reason: "A derivative has no limits — “from a to b” belongs to an integral." };
      from = ft[1].trim();
      to = ft[2].trim();
      s = s.slice(0, ft.index);
    }
    if (kind === "integral") {
      const dm = TRAIL_D_RE.exec(s);
      // "x^2 dx": the d must start its own word (or follow * / · / a bracket) — "2d" with a variable d is not "dx".
      if (dm && dm.index + dm[1].length > 0) {
        if (variable && variable !== dm[2]) return { ok: false, reason: `Two different variables were named (${variable} and ${dm[2]}).` };
        variable = dm[2];
        s = s.slice(0, dm.index + (dm[1] === ")" ? 1 : 0));
      }
    }
    s = s.trim().replace(/,$/, "").trim();
    if (s !== before) stripped = true;
    else break;
  }
  // "(x^2) dx" → strip one pair of outer brackets left over from ∫(…)dx.
  if (stripped && /^\(.*\)$/.test(s)) {
    let depth = 0, wraps = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") { depth--; if (depth === 0 && i < s.length - 1) { wraps = false; break; } }
    }
    if (wraps) s = s.slice(1, -1).trim();
  }
  if (!stripped) {
    // Nothing to strip. A prose word in a bare expression still must not become a constant factor — but text that
    // does not even parse is left to the pane's sentence extractor ("dy/dx of y = x^2" style prose).
    const stray = strayWord(s, false, true);
    return stray ? { ok: false, reason: strayReason(stray) } : null;
  }
  // "dy/dx of y = x^2": the dependent variable's own "y =" is not part of the expression.
  if (kind === "derivative") s = s.replace(/^y\s*=\s*(?=\S)/, "");
  if (!s) return { ok: false, reason: `No expression was found to ${kind === "derivative" ? "differentiate" : "integrate"}.` };
  const stray = strayWord(s, true);
  if (stray) return { ok: false, reason: strayReason(stray) };
  if ((from === undefined) !== (to === undefined)) return { ok: false, reason: "Give both limits: from a to b." };
  if ([from, to].some((b) => b !== undefined && /inf|∞/i.test(b))) {
    return { ok: false, reason: "An infinite limit is not supported here — the definite integral needs finite limits (numbers, or expressions like pi/2)." };
  }
  return { ok: true, expr: s, variable, from, to, stripped };
}

const PROSE = new Set([
  "integrate", "integral", "antiderivative", "derivative", "differentiate", "of", "from", "to", "the", "find",
  "with", "respect", "wrt", "and", "over", "on", "between", "evaluate", "compute", "calculate", "what", "is",
  "dx", "dt", "dy", "dz", "du", "ds", "dtheta", "d", "by", "for", "at", "in", "function", "expression",
]);

/**
 * A word the engine would read as a constant factor: a known prose word — or, once task prose has been stripped
 * (so the line is a sentence), any all-lower-case multi-letter non-math name ("then", "square"). Parameter names in
 * a bare formula (Vmax, Km, k1) are left alone.
 */
function strayWord(s: string, inProse: boolean, parsedOnly = false): string | null {
  let e: Expr;
  try {
    e = parseExpr(s);
  } catch {
    // Unparseable text is the engine's to refuse; only report a prose word we can see.
    if (parsedOnly) return null;
    const w = (s.match(/[A-Za-z]+/g) ?? []).find((x) => PROSE.has(x.toLowerCase()) && x.length > 1);
    return w ?? null;
  }
  const ids = new Set<string>();
  identifiers(e, ids);
  for (const id of ids) {
    if (PROSE.has(id.toLowerCase()) && id.length > 1) return id;
    if (inProse && /^[a-z]{2,}$/.test(id) && !MATH_NAMES.has(id)) return id;
  }
  return null;
}

function strayReason(word: string): string {
  return `“${word}” is not part of a formula — it would be read as a constant factor. Type just the expression (for example x^2), with d/dx, dx or “from a to b” if you want them.`;
}
