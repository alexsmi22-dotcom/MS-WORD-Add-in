/**
 * Linear programming — the `maximize … subject to …` verb of the equation kind,
 * with the LP nouns (shadow prices, dual, sensitivity, reduced costs, standard
 * form, simplex tableau, graphical solution) and the integer note.
 *
 * EXACT throughout: coefficients are cas.ts rationals (0.35 is 7/20), the
 * simplex is a two-phase tableau over Rat with Bland's rule (so degenerate
 * problems terminate; a 500-pivot cap is a formality that turns into an
 * `incomplete` REFUSAL, never a partial answer), duals and reduced costs are
 * read from the final tableau, and the sensitivity ranges are computed from
 * it for nondegenerate bases only.
 *
 * VERIFIED before anything is shown: every constraint re-evaluated at x*
 * exactly; dual feasibility; complementary slackness; strong duality
 * cᵀx* = bᵀy* exactly; and for two variables an INDEPENDENT exact vertex
 * enumeration (every pair of constraint lines) must agree on the optimum —
 * disagreement is a refusal.
 *
 * Refusals are BY NAME (the constraint that is not linear, the pair of
 * constraints that contradict, the clause the grammar did not read). A
 * nonlinear objective with equality constraints only is NOT ours — the verb
 * returns null so the Lagrange-multiplier verb can take it.
 *
 * `optimize.ts`'s nelderMead is "simplex" in name only and is not used here.
 */
import { parseExpr, format, Expr } from "./solve";
import { linearCoeffs } from "./systems";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratSign, ratEq, ratIsZero, ratInt, ratToNumber, RAT_ZERO, RAT_ONE } from "./cas";
import { fmtRat } from "./geometry";
import { hBarSvg } from "./mechchart";
import type { VerbResult } from "./algebraTools";
import { lpRegionSvg, LpFigureSpec, LpRel } from "./lpFigure";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** The §B guard, verbatim: a maximize/minimize whose text carries a constraint
 *  separator or a comparator, or an LP noun opener. Test it on the RAW input
 *  (before the paste fold, which rewrites 3x1 → 3x^1). */
export const LP_VERB_RE =
  /^\s*(?:lp\s*:\s*)?(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?)\b(?=[\s\S]*(?:\bsubject\s+to\b|\bs\.?\s?t\.?(?=\s)|\bsuch\s+that\b|\bgiven\b|\bwith\b|\bwhere\b|[\n,;][^\n]*[<>≤≥≦≧]|=[<>]))|^\s*(?:shadow\s+prices?|dual(?:\s+(?:problem|values?|of))?|sensitivity(?:\s+analysis)?|reduced\s+costs?|simplex(?:\s+tableau)?|two[-\s]phase|big[-\s]?M|standard\s+form|graphical(?:ly)?\s+solve)\b/i;

/** "diet problem:", "LP:", "Problem 3:" before the verb or noun. */
const LABEL_RE = /^\s*[A-Za-z][A-Za-z0-9 _-]{0,40}?\s*:\s*(?=(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?|shadow|dual|sensitivity|reduced|simplex|two[-\s]phase|big[-\s]?M|standard\s+form|graphical)\b)/i;

/** A bare objective with no constraints at all: the verb, an optional name, then the expression. */
const BARE_OBJECTIVE_RE = /^\s*(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?)\s+(?:(?:the\s+)?(?:total\s+)?(?:cost|profit|revenue|objective|function|value)\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([-+\s\d.A-Za-z_*()/]+)$/i;

/**
 * A bare `maximize <expression>` is ours only when the expression is LINEAR IN
 * AT LEAST ONE VARIABLE: `maximize 3x + 2y` (usage refusal), not `max of 3, 5,
 * 8`, `max 3, 5, 8` or `max 5` (a maximum-of-a-list request, which belongs to
 * the stats intent), and not `maximize x^2` (calculus).
 */
function isBareLinearObjective(text: string): boolean {
  const m = BARE_OBJECTIVE_RE.exec(text);
  if (!m) return false;
  const expr = m[1].trim();
  if (/^(?:of|the|a|an|among|between|from|in)\b/i.test(expr)) return false;
  try {
    const ast = parseExpr(expr);
    const names = varNames(ast);
    if (!names.length) return false;
    return linearCoeffs(ast, names) !== null;
  } catch {
    return false;
  }
}

/**
 * Homework shapes folded to the canonical one BEFORE anything is read:
 *   "z = 3x + 2y, maximize z subject to …"  → "maximize z = 3x + 2y subject to …"
 *   "Use the simplex method to maximize …"  → "maximize …"
 *   "… x, y >= 0 graphically" / "… please" / "… using the simplex method"
 *   "… y >= 0. What is the maximum?" / "… Find the shadow prices."
 * A trailing instruction or question is prose, not a variable; it is cut off
 * here so `graphically` can never become a free zero-column variable.
 */
const TRAILING_INSTRUCTION_RE = /[\s.,;]*\b(?:graphically|please|by\s+hand|using\s+(?:the\s+)?[A-Za-z -]*?(?:method|algorithm|simplex|tableau)|by\s+(?:the\s+)?[A-Za-z -]*?(?:method|simplex|tableau)|with\s+(?:the\s+)?simplex(?:\s+method)?|via\s+(?:the\s+)?[A-Za-z -]*?(?:method|simplex))\s*[.!?]?\s*$/i;
const SENTENCE_OPENERS = "find|what|determine|solve|show|compute|state|give|report|use|identify|calculate|how|which|then|also|interpret|explain|verify|draw|sketch|plot|graph|describe|discuss|obtain";
/** After a full stop any opener counts; mid-line only a Capitalised one does (a variable named `plot` stays a variable). */
const TRAILING_SENTENCE_RE = new RegExp(`[.?!]\\s*(?:${SENTENCE_OPENERS})\\b[^\\n]*$`, "i");
const TRAILING_CAPITAL_SENTENCE_RE = new RegExp(`\\s+(?:${SENTENCE_OPENERS.split("|").map((w) => w[0].toUpperCase() + w.slice(1)).join("|")})\\b[^\\n]*$`);
const LEADING_INSTRUCTION_RE = /^\s*(?:use|using|apply|applying|employ|solve|please)\b[^:\n]*?\b(?:to|:)\s*(?=(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?)\b)/i;
const OBJECTIVE_FIRST_RE = /^\s*([A-Za-z_]\w*)\s*=\s*([^,;\n]+?)\s*[,;\n]\s*(max(?:imi[sz]e)?|min(?:imi[sz]e)?)\s+\1\b\s*/i;

function normaliseShape(raw: string): string {
  let t = raw.replace(/\r/g, "");
  t = t.replace(OBJECTIVE_FIRST_RE, (_m, nm: string, ex: string, verb: string) => `${verb} ${nm} = ${ex} `);
  t = t.replace(LEADING_INSTRUCTION_RE, "");
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(TRAILING_INSTRUCTION_RE, "");
    t = t.replace(TRAILING_SENTENCE_RE, "");
    t = t.replace(TRAILING_CAPITAL_SENTENCE_RE, "");
    if (t === before) break;
  }
  return t;
}

/**
 * Whether the pane should hand this input to tryLp before anything else:
 * the §B guard on the raw text, the same after a "diet problem:" style label
 * or an instruction prefix, or a bare `maximize 3x + 2y` (which must reach
 * the usage refusal, never "more than one unknown (maximize, x, y)"). An LP
 * noun is claimed ONLY when a max/min objective follows it: `standard form of
 * x^2 + 6x + 2 = 0`, `dual numbers …`, `sensitivity 0.9, specificity 0.8` are
 * other engines' lines. For the tryLagrange stand-aside.
 */
export function isLpInput(raw: string): boolean {
  let t = normaliseShape(raw).replace(LABEL_RE, "");
  const noun = NOUN_RE.exec(t);
  if (noun) t = t.slice(noun[0].length).replace(LABEL_RE, "");
  if (!VERB_RE.test(t)) return false;
  return LP_VERB_RE.test(t) || isBareLinearObjective(t);
}

const MAX_VARS = 12;
const MAX_ROWS = 20;
const PIVOT_CAP = 500;
const BB_MAX_VARS = 4;
const BB_MAX_NODES = 50;
const MAX_SIG_DIGITS = 15;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Rel = LpRel;
type Mode = "solve" | "shadow" | "dual" | "sensitivity" | "reduced" | "tableau" | "standard" | "graphical";

const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const line = (text: string, math = false): { text: string; math?: boolean } => (math ? { text, math: true } : { text });
const sig6 = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));

const rLt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) < 0;
const rLe = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) <= 0;
const rGt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) > 0;
const rGe = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) >= 0;
const rMax = (a: Rat, b: Rat): Rat => (rGe(a, b) ? a : b);
const rMin = (a: Rat, b: Rat): Rat => (rLe(a, b) ? a : b);
const rFloor = (r: Rat): Rat => {
  let q = r.n / r.d;
  if (r.n < 0n && q * r.d !== r.n) q -= 1n;
  return ratInt(q);
};
const rIsInt = (r: Rat): boolean => r.d === 1n;
const dot = (a: Rat[], b: Rat[]): Rat => a.reduce((s, ai, i) => (ratIsZero(ai) || ratIsZero(b[i]) ? s : ratAdd(s, ratMul(ai, b[i]))), RAT_ZERO);

/** Exact rational for the TEXT layer: "7/2", "−3" (U+2212, one convention per string). */
const txt = (r: Rat): string => fmtRat(r).replace(/-/g, "−");
/** Exact rational for a MATH line (Solve grammar, ASCII minus). */
const mth = (r: Rat): string => fmtRat(r);
const withDec = (r: Rat): string => (r.d === 1n ? txt(r) : `${txt(r)} ≈ ${sig6(ratToNumber(r))}`);
const pointTxt = (x: Rat[]): string => `(${x.map(txt).join(", ")})`;

const RELSYM: Record<Rel, string> = { "<=": "≤", ">=": "≥", "=": "=" };
/** User input quoted in the TEXT layer keeps one minus convention (U+2212) and typeset comparators. */
const quoteSrc = (s: string): string => s.replace(/<=/g, "≤").replace(/>=/g, "≥").replace(/-/g, "−");

/**
 * A linear form in Solve grammar: integer coefficients juxtapose on
 * single-letter names (3x), everything else uses `*` (3/2*x, 3*x1) — `3/2x`
 * is refused by the parser's ambiguity gate, and 3x1 is what the paste fold
 * rewrites. `math` selects ASCII minus (re-parses) vs U+2212 (text layer).
 */
function linForm(coeffs: Rat[], names: string[], math: boolean, constant: Rat = RAT_ZERO, keepZeros = false): string {
  const parts: string[] = [];
  const minus = math ? "-" : "−";
  const term = (c: Rat, name: string | null): void => {
    const neg = ratSign(c) < 0;
    const mag = neg ? ratNeg(c) : c;
    let body: string;
    if (name === null) body = fmtRat(mag);
    else if (ratEq(mag, RAT_ONE)) body = name;
    else if (mag.d === 1n && name.length === 1) body = `${fmtRat(mag)}${name}`;
    else body = `${fmtRat(mag)}*${name}`;
    if (!parts.length) parts.push(neg ? `${minus}${body}` : body);
    else parts.push(`${neg ? minus : "+"} ${body}`);
  };
  coeffs.forEach((c, j) => {
    if (!ratIsZero(c) || keepZeros) term(c, names[j]);
  });
  if (!ratIsZero(constant)) term(constant, null);
  return parts.length ? parts.join(" ") : "0";
}

/** Names of every variable node, in order of first appearance (freeVars drops `e`). */
function varNames(e: Expr, out: string[] = []): string[] {
  switch (e.t) {
    case "var":
      if (!out.includes(e.name)) out.push(e.name);
      break;
    case "neg":
      varNames(e.e, out);
      break;
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "pow":
      varNames(e.l, out);
      varNames(e.r, out);
      break;
    case "fn":
      varNames(e.arg, out);
      break;
    default:
      break;
  }
  return out;
}

const hasVar = (e: Expr): boolean => varNames(e).length > 0;

/** The first sub-expression that makes `e` nonlinear, formatted — for the refusal. */
function nonlinearPart(e: Expr): string | null {
  switch (e.t) {
    case "num":
    case "var":
      return null;
    case "neg":
      return nonlinearPart(e.e);
    case "add":
    case "sub":
      return nonlinearPart(e.l) ?? nonlinearPart(e.r);
    case "mul":
      if (hasVar(e.l) && hasVar(e.r)) return format(e);
      return nonlinearPart(e.l) ?? nonlinearPart(e.r);
    case "div":
      if (hasVar(e.r)) return format(e);
      return nonlinearPart(e.l);
    case "pow":
      if (hasVar(e.l) || hasVar(e.r)) {
        const ex = e.r.t === "num" ? e.r.v : NaN;
        if (ex === 1 && !hasVar(e.r)) return nonlinearPart(e.l);
        return format(e);
      }
      return null;
    case "fn":
      return hasVar(e.arg) ? format(e) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The problem in user space
// ---------------------------------------------------------------------------

export interface LpRow {
  coeffs: Rat[];
  rel: Rel;
  rhs: Rat;
  /** Text-layer rendering, e.g. "x + y ≤ 4". */
  label: string;
}

export interface LpProblem {
  sense: "max" | "min";
  objName: string;
  vars: string[];
  c: Rat[];
  c0: Rat;
  rows: LpRow[];
  nonneg: boolean[];
  integer: boolean[];
  /** True when the input stated ANY sign restriction or "free". */
  signsStated: boolean;
  notes: string[];
  /** A row that reads 0 ≤ −1: infeasible before any arithmetic. */
  impossibleRow?: string;
}

function rowLabel(coeffs: Rat[], vars: string[], rel: Rel, rhs: Rat): string {
  return `${linForm(coeffs, vars, false)} ${RELSYM[rel]} ${txt(rhs)}`;
}

const NOUN_RE =
  /^\s*(?:(shadow\s+prices?)|(dual(?:\s+(?:problem|values?|variables?|lp))?)|(sensitivity(?:\s+analysis|\s+report)?)|(reduced\s+costs?)|(simplex(?:\s+tableau[sx]?|\s+method)?|two[-\s]phase(?:\s+simplex)?(?:\s+method)?|big[-\s]?M(?:\s+(?:method|simplex))?)|(standard\s+form)|(graphical(?:ly)?(?:\s+(?:solve|solution|method))?))\b\s*(?:(?:of|for|the|:|,)\s*)*(?:(?:the\s+)?(?:lp|linear\s+program(?:me)?|problem)\s*:?\s*)?/i;

const VERB_RE = /^\s*(max(?:imi[sz]e)?|min(?:imi[sz]e)?)\b\.?\s*/i;

const SEP_SRC = "(?:subject\\s+to|s\\.\\s?t\\.?|st|such\\s+that|given(?:\\s+that)?|where|under(?:\\s+the\\s+constraints?)?|with(?:\\s+the)?(?:\\s+constraints?)?|on|constraints?)\\b\\.?\\s*:?\\s*";
const SEP_RE = new RegExp("\\b" + SEP_SRC, "i");
const LEADING_SEP_RE = new RegExp("^\\s*" + SEP_SRC, "i");

const COMPARATOR_RE = /<=|>=|!=|≠|=|<|>/g;

function normaliseComparators(s: string): string {
  return s
    .replace(/=</g, "<=")
    .replace(/=>/g, ">=")
    .replace(/[≤≦⩽]/g, "<=")
    .replace(/[≥≧⩾]/g, ">=")
    .replace(/==/g, "=")
    .replace(/[−–]/g, "-");
}

/** Index of the first `,` or `;` at parenthesis depth 0, or -1. */
function depth0Index(s: string, chars: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && chars.includes(ch)) return i;
  }
  return -1;
}

function splitDepth0(s: string, chars: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && chars.includes(ch)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Literals with more than 15 significant digits lose precision in the parser's double. */
function oversizedLiteral(s: string): string | null {
  for (const m of s.matchAll(/\d+(?:\.\d+)?|\.\d+/g)) {
    const digits = m[0].replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
    if (digits.length > MAX_SIG_DIGITS) return m[0];
  }
  return null;
}

const ID_LIST = "[A-Za-z_]\\w*(?:\\s*(?:,|and|&)\\s*[A-Za-z_]\\w*)*";
const TAIL_PFX = "(?:\\b(?:with|where|and|,|;)\\s*)?(?:all\\s+)?(?:(?:the\\s+)?(?:variables?|vars?)\\s+)?";
const NONNEG_TAIL = new RegExp(`${TAIL_PFX}(?:(${ID_LIST})\\s+)?(?:are\\s+|being\\s+|is\\s+|must\\s+be\\s+)?non-?\\s?negativ(?:e|ity)(?:\\s+constraints?)?\\b`, "gi");
const INTEGER_TAIL = new RegExp(`${TAIL_PFX}(?:(${ID_LIST})\\s+)?(?:are\\s+|being\\s+|is\\s+|must\\s+be\\s+)?(?:integers?|integral|integer[- ]valued|in\\s+Z\\b|∈\\s*Z\\b|in\\s+ℤ|∈\\s*ℤ)\\b`, "gi");
const BINARY_TAIL = new RegExp(`${TAIL_PFX}(?:(${ID_LIST})\\s+)?(?:are\\s+|being\\s+|is\\s+|must\\s+be\\s+)?(?:binary|in\\s*\\{\\s*0\\s*,\\s*1\\s*\\}|∈\\s*\\{\\s*0\\s*,\\s*1\\s*\\})\\b`, "gi");
const FREE_TAIL = new RegExp(`${TAIL_PFX}(?:(${ID_LIST})\\s+)?(?:are\\s+|being\\s+|is\\s+)?(?:free|unrestricted(?:\\s+in\\s+sign)?|urs|unsigned)\\b`, "gi");

const splitIds = (s: string): string[] => s.split(/\s*(?:,|\band\b|&)\s*/).map((x) => x.trim()).filter(Boolean);

interface RawRow {
  lhs: string;
  rel: Rel;
  rhs: string;
  src: string;
}

/** Splits the constraint text into (lhs, rel, rhs) triples; expands "x, y >= 0". */
function splitConstraints(text: string, title: string): { rows: RawRow[]; tails: { nonneg: string[] | "all" | null; integer: string[] | "all" | null; binary: string[] | "all" | null; free: string[] | "all" | null } } | VerbResult {
  let t = text;
  const tailOf = (re: RegExp): string[] | "all" | null => {
    let found: string[] | "all" | null = null;
    t = t.replace(re, (_m, ids: string | undefined) => {
      const list = ids ? splitIds(ids) : "all";
      if (found === null) found = list;
      else if (found !== "all" && list !== "all") found = [...found, ...list];
      else found = "all";
      return " ";
    });
    return found;
  };
  const nonneg = tailOf(NONNEG_TAIL);
  const integer = tailOf(INTEGER_TAIL);
  const binary = tailOf(BINARY_TAIL);
  const free = tailOf(FREE_TAIL);
  t = t.replace(/^\s*(?:the\s+)?(?:following\s+)?(?:constraints?)?\s*:?\s*/i, "");
  // "… x + 3y <= 6 where x, y >= 0" / "with" / "for" / "given": a separator, not a factor
  t = t.replace(/\s+(?:where|with|for|given|such\s+that|subject\s+to|s\.t\.)\s*:?\s+/gi, ", ");
  // "(x and y are integers)" leaves "( )" once the tail is consumed
  t = t.replace(/\(\s*\)/g, " ");

  const pieces = splitDepth0(t, ",;\n")
    .flatMap((p) => p.split(/\band\b/i))
    .map((p) => p.replace(/^\s*(?:also|and|the|constraint\s*\d*\s*:?)\s*/i, "").trim())
    .map((p) => p.replace(/\.\s*$/, "").trim())
    .filter(Boolean);
  const rows: RawRow[] = [];
  let pending: string[] = [];
  const isId = (s: string): boolean => /^[A-Za-z_]\w*$/.test(s.trim());
  for (const piece of pieces) {
    const comps = [...piece.matchAll(COMPARATOR_RE)];
    if (!comps.length) {
      if (isId(piece)) {
        pending.push(piece.trim());
        continue;
      }
      return refuse(title, `Could not read “${piece}” as a constraint. Each constraint is a linear expression, a comparator (<=, >=, =) and a linear expression, e.g. x + 2y <= 8; separate them with commas, semicolons or new lines.`);
    }
    for (const c of comps) {
      if (c[0] === "<" || c[0] === ">") return refuse(title, `“${piece}” uses a strict inequality (${c[0]}). A linear program's feasible set must be closed — the optimum of x < 4 does not exist. Write ${c[0]}= if that is what was meant.`);
      if (c[0] === "!=" || c[0] === "≠") return refuse(title, `“${piece}” uses ≠, which is not a linear constraint (its feasible set is not convex). Write two problems, one with ≤ and one with ≥, if that is what was meant.`);
    }
    const segs = piece.split(COMPARATOR_RE).map((s) => s.trim());
    const rels = comps.map((c) => c[0] as Rel);
    if (comps.length > 2) return refuse(title, `“${piece}” chains ${comps.length} comparators; at most two (a ≤ expression ≤ b) are read.`);
    if (comps.length === 2) {
      if (rels[0] !== rels[1] || rels[0] === "=") return refuse(title, `“${piece}” mixes comparator directions in one chain; write it as two constraints.`);
      if (!segs[0] || !segs[1] || !segs[2]) return refuse(title, `“${piece}” has an empty side.`);
      if (pending.length) return refuse(title, `“${pending.join(", ")}” was listed without a relation before “${piece}”.`);
      rows.push({ lhs: segs[0], rel: rels[0], rhs: segs[1], src: `${segs[0]} ${rels[0]} ${segs[1]}` });
      rows.push({ lhs: segs[1], rel: rels[1], rhs: segs[2], src: `${segs[1]} ${rels[1]} ${segs[2]}` });
      continue;
    }
    const [lhs, rhs] = segs;
    if (!lhs || !rhs) return refuse(title, `“${piece}” has an empty side of the comparator.`);
    if (pending.length) {
      if (!isId(lhs)) return refuse(title, `“${pending.join(", ")}” was listed without a relation before “${piece}” — a shared relation needs a plain variable on the left (x, y >= 0).`);
      for (const id of pending) rows.push({ lhs: id, rel: rels[0], rhs, src: `${id} ${rels[0]} ${rhs}` });
      pending = [];
    }
    rows.push({ lhs, rel: rels[0], rhs, src: piece });
  }
  if (pending.length) return refuse(title, `“${pending.join(", ")}” was listed without a relation (write x, y >= 0, or "x, y nonnegative").`);
  return { rows, tails: { nonneg, integer, binary, free } };
}

interface Parsed {
  mode: Mode;
  twoPhaseAsked: boolean;
  problem: LpProblem;
  /** The objective as typed (normalised), for titles. */
  objectiveText: string;
  constraintText: string;
}

/**
 * Reads the whole input. Returns the parsed problem, a refusal (VerbResult
 * with no lines), or null when the input is not an LP at all (nonlinear
 * objective with equality constraints, no verb, …) so other verbs can take it.
 */
function readInput(raw: string): Parsed | VerbResult | null {
  let text = normaliseShape(raw);
  text = text.replace(LABEL_RE, "");
  let mode: Mode = "solve";
  let twoPhaseAsked = false;
  const nounM = NOUN_RE.exec(text);
  if (nounM) {
    if (nounM[1]) mode = "shadow";
    else if (nounM[2]) mode = "dual";
    else if (nounM[3]) mode = "sensitivity";
    else if (nounM[4]) mode = "reduced";
    else if (nounM[5]) {
      mode = "tableau";
      twoPhaseAsked = /two[-\s]phase|big[-\s]?M/i.test(nounM[5]);
    } else if (nounM[6]) mode = "standard";
    else if (nounM[7]) mode = "graphical";
    text = text.slice(nounM[0].length);
    text = text.replace(LABEL_RE, "");
  }
  const nounTitle = `Linear program${mode === "solve" ? "" : ` — ${mode === "shadow" ? "shadow prices" : mode === "dual" ? "dual" : mode === "sensitivity" ? "sensitivity analysis" : mode === "reduced" ? "reduced costs" : mode === "tableau" ? "simplex tableau" : mode === "standard" ? "standard form" : "graphical solution"}`}`;
  const verbM = VERB_RE.exec(text);
  // An LP noun with no max/min objective after it is another engine's line
  // ("standard form of x^2 + 6x + 2 = 0", "dual numbers …", "sensitivity 0.9,
  // specificity 0.8"): stand aside rather than refuse.
  if (!verbM) return null;
  const sense: "max" | "min" = /^max/i.test(verbM[1]) ? "max" : "min";
  let rest = text.slice(verbM[0].length);
  const notes: string[] = [];
  if (/\$/.test(rest)) {
    rest = rest.replace(/\$\s*(?=[\d.])/g, "");
    notes.push("Money signs were stripped from the numbers: the objective is in $.");
  }
  rest = normaliseComparators(rest);
  const big = oversizedLiteral(rest);
  if (big) return refuse(nounTitle, `The number ${big} has more than ${MAX_SIG_DIGITS} significant digits; the expression parser reads numbers as doubles, so it cannot be kept exact here. Scale the problem or shorten the number.`);

  // --- objective / constraints split: the earliest of a keyword, a newline, a depth-0 comma/semicolon
  let objText: string;
  let conText: string;
  const kw = SEP_RE.exec(rest);
  const kwPos = kw ? kw.index : -1;
  const nl = rest.indexOf("\n");
  const comma = depth0Index(rest, ",;");
  // "max 3x + 2y: x + y <= 4, …" — a colon reads as "subject to" when constraints follow it
  const colonAt = rest.indexOf(":");
  const colon = colonAt >= 0 && /[<>=]/.test(rest.slice(colonAt + 1)) && !/[<>=]/.test(rest.slice(0, colonAt)) ? colonAt : -1;
  const candidates = [kwPos, nl, comma, colon].filter((i) => i >= 0);
  if (!candidates.length) {
    objText = rest.trim();
    conText = "";
  } else {
    const cut = Math.min(...candidates);
    objText = rest.slice(0, cut).trim();
    conText = rest.slice(cut);
    if (cut === kwPos && kw) conText = rest.slice(cut + kw[0].length);
    else {
      conText = conText.replace(/^[,;:\n]\s*/, "");
      conText = conText.replace(LEADING_SEP_RE, "");
      // "max 3, 5, 8" is a list, not an objective plus constraints: with no
      // comparator anywhere after the comma there are no constraints at all.
      if (!/[<>=]/.test(conText)) {
        objText = rest.trim();
        conText = "";
      }
    }
  }
  // "max of 3, 5, 8" / "maximize of …": a maximum-of-a-list request, not an LP.
  if (/^(?:of|the|a|an|among|between|from|in)\b/i.test(objText) && !conText.trim()) return null;
  // objective name and noun words
  let objName: string | null = null;
  const nameM = /^(?:the\s+)?(?:total\s+)?(?:(?:cost|profit|revenue|objective|function|value)\s+)?([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(objText);
  // "maximize 3x + 2y = z": the name on the right
  const nameRight = /^([\s\S]+?)\s*=\s*([A-Za-z_]\w*)$/.exec(objText);
  if (nameM && !/[<>]/.test(objText)) {
    objName = nameM[1];
    objText = nameM[2].trim();
  } else if (nameRight && !/[<>]/.test(objText) && /[-+*/\d]/.test(nameRight[1])) {
    objName = nameRight[2];
    objText = nameRight[1].trim();
  } else {
    objText = objText.replace(/^(?:the\s+)?(?:total\s+)?(?:(?:daily|weekly|monthly|annual|expected)\s+)?(?:cost|profit|revenue|objective(?:\s+function)?|function|value)\b\s*(?:of\s+|:\s*)?/i, "").trim();
  }
  if (!objText) return refuse(nounTitle, "No objective: write maximize 3x + 2y subject to ….");
  if (/[<>=]/.test(objText)) {
    // "maximize f(x) = x^2 - 4x" is single-variable calculus, not ours.
    if (!conText.trim()) return null;
    return refuse(nounTitle, `The objective “${objText}” contains a comparator; the objective is an expression and the constraints follow "subject to".`);
  }
  let objAst: Expr;
  try {
    objAst = parseExpr(objText);
  } catch (err) {
    if (!conText.trim()) return null;
    return refuse(nounTitle, `Could not read the objective “${objText}”: ${(err as Error).message}`);
  }
  if (!conText.trim()) {
    // bare "maximize 3x + 2y": linear → usage refusal; nonlinear → not ours.
    const names = varNames(objAst);
    const lin = linearCoeffs(objAst, names);
    if (!lin || !names.length) return null;
    return refuse(nounTitle, `No constraints — an LP needs "subject to …": e.g. ${sense === "max" ? "maximize" : "minimize"} ${objText} subject to ${names.slice(0, 2).join(" + ")} <= 4, ${names.map((n) => n).join(", ")} >= 0.`);
  }

  const split = splitConstraints(conText, nounTitle);
  if ("lines" in split) return split;
  const rawRows = split.rows;
  if (!rawRows.length && !split.tails.nonneg && !split.tails.integer) return refuse(nounTitle, `No constraint was read after the objective in “${conText.trim()}”.`);

  // parse every side, collect names
  const sides: { l: Expr; r: Expr; raw: RawRow }[] = [];
  for (const rr of rawRows) {
    try {
      sides.push({ l: parseExpr(rr.lhs), r: parseExpr(rr.rhs), raw: rr });
    } catch (err) {
      return refuse(nounTitle, `Could not read the constraint “${rr.src}”: ${(err as Error).message}`);
    }
  }
  const names = varNames(objAst);
  for (const s of sides) {
    varNames(s.l, names);
    varNames(s.r, names);
  }
  const inequalityPresent = rawRows.some((r) => r.rel !== "=");
  // Guard ORDER (v2.136.0): a problem that is NONLINEAR even with π read as a
  // number, and has only equality constraints, is Lagrange's — return null
  // BEFORE any coefficient refusal. `maximize x y subject to x^2 + y^2 = pi`
  // was stolen by the π refusal below (v2.132 regression). The test replaces
  // pi by a rational stand-in, so `maximize pi*x + y subject to x + y <= 4`
  // (linear once π is a number) still reaches the π refusal by name.
  // With inequalities, a NONLINEAR OBJECTIVE that mentions π is not a linear
  // program either (review, v2.136.0): `maximize x^2 subject to x <= pi`
  // returns null rather than being refused for π.
  if (names.includes("pi") || names.includes("lambda")) {
    const PI_STANDIN: Expr = { t: "num", v: 3 };
    const subPi = (e: Expr): Expr => {
      switch (e.t) {
        case "var":
          return e.name === "pi" ? PI_STANDIN : e;
        case "neg":
          return { t: "neg", e: subPi(e.e) };
        case "add":
        case "sub":
        case "mul":
        case "div":
        case "pow":
          return { t: e.t, l: subPi(e.l), r: subPi(e.r) };
        case "fn":
          return { t: "fn", name: e.name, arg: subPi(e.arg) };
        default:
          return e;
      }
    };
    const varsNoPi = names.filter((n) => n !== "pi");
    const objNonlinear = !linearCoeffs(subPi(objAst), varsNoPi);
    const conNonlinear = sides.some((s) => !linearCoeffs(subPi(s.l), varsNoPi) || !linearCoeffs(subPi(s.r), varsNoPi));
    if (objNonlinear || (!inequalityPresent && conNonlinear)) return null; // not a linear program (Lagrange's, or nonlinear programming)
  }
  for (const n of names) {
    if (n === "pi") return refuse(nounTitle, "“pi” (the constant π) cannot appear in an exact linear program: every coefficient here is a rational number. Write a decimal such as 3.1416 if an approximation is acceptable, or rename the variable if pi was meant as a name.");
    if (n === "lambda") return refuse(nounTitle, "“lambda” is a reserved name here (the Lagrange multiplier) — rename that variable.");
  }
  const objLin = linearCoeffs(objAst, names);
  if (!objLin) {
    const part = nonlinearPart(objAst) ?? objText;
    if (!inequalityPresent) return null; // Lagrange's problem
    return refuse(nounTitle, `The objective is not linear: ${part}. A linear program needs a linear objective and linear constraints; with inequality constraints this is nonlinear programming, which is not solved here.`);
  }
  if (names.length > MAX_VARS) return refuse(nounTitle, `${names.length} variables: up to ${MAX_VARS} here (the exact rational tableau keeps every entry printable).`);
  if (rawRows.length > 4 * MAX_ROWS) return refuse(nounTitle, `${rawRows.length} constraint lines: up to ${MAX_ROWS} constraints here.`);
  const bases = new Map<string, Set<string>>();
  for (const n of names) {
    const m = /^([A-Za-z]+)(_?)(\d+)$/.exec(n);
    if (m) {
      const set = bases.get(m[1]) ?? new Set<string>();
      set.add(m[2] ? "x_1" : "x1");
      bases.set(m[1], set);
    }
  }
  for (const [b, set] of bases) if (set.size === 2) notes.push(`Both spellings ${b}1 and ${b}_1 appear: they are read as DIFFERENT variables here (${names.filter((n) => n.startsWith(b)).join(", ")}). Use one spelling if one variable was meant.`);
  if (names.includes("e")) notes.push("“e” is read as a variable here, not Euler's number.");

  const c = names.map((n) => objLin.coeff.get(n) ?? RAT_ZERO);
  const c0 = objLin.constant;
  if (c.every(ratIsZero)) return refuse(nounTitle, `The objective “${objText}” has no variable in it — nothing to optimise.`);

  const nonneg = names.map(() => false);
  const integer = names.map(() => false);
  let signsStated = false;
  const rows: LpRow[] = [];
  let impossibleRow: string | undefined;
  const applyList = (list: string[] | "all" | null, flag: boolean[], what: string): VerbResult | null => {
    if (!list) return null;
    if (list === "all") {
      flag.fill(true);
      return null;
    }
    for (const id of list) {
      const j = names.indexOf(id);
      if (j < 0) return refuse(nounTitle, `“${id}” is declared ${what} but does not appear in the objective or any constraint.`);
      flag[j] = true;
    }
    return null;
  };
  const e1 = applyList(split.tails.nonneg, nonneg, "nonnegative");
  if (e1) return e1;
  if (split.tails.nonneg) signsStated = true;
  const e2 = applyList(split.tails.integer, integer, "integer");
  if (e2) return e2;
  const binaryFlags = names.map(() => false);
  const e3 = applyList(split.tails.binary, binaryFlags, "binary");
  if (e3) return e3;
  const freeFlags = names.map(() => false);
  const e4 = applyList(split.tails.free, freeFlags, "free");
  if (e4) return e4;
  if (split.tails.free) signsStated = true;

  for (const s of sides) {
    const ll = linearCoeffs(s.l, names);
    const rl = linearCoeffs(s.r, names);
    if (!ll || !rl) {
      const part = nonlinearPart(ll ? s.r : s.l) ?? s.raw.src;
      if (!inequalityPresent) return null;
      return refuse(nounTitle, `This constraint is not linear: ${part} (in “${s.raw.src}”). A linear program needs every constraint linear in the variables.`);
    }
    const coeffs = names.map((n) => ratSub(ll.coeff.get(n) ?? RAT_ZERO, rl.coeff.get(n) ?? RAT_ZERO));
    const rhs = ratSub(rl.constant, ll.constant);
    const rel = s.raw.rel;
    const nz = coeffs.map((v, j) => (ratIsZero(v) ? -1 : j)).filter((j) => j >= 0);
    if (!nz.length) {
      const holds = rel === "<=" ? rLe(RAT_ZERO, rhs) : rel === ">=" ? rGe(RAT_ZERO, rhs) : ratIsZero(rhs);
      if (holds) {
        notes.push(`“${quoteSrc(s.raw.src)}” has no variable left once simplified (it reads 0 ${RELSYM[rel]} ${txt(rhs)}) — vacuous, dropped.`);
        continue;
      }
      impossibleRow = `“${quoteSrc(s.raw.src)}” has no variable left once simplified and reads 0 ${RELSYM[rel]} ${txt(rhs)}, which never holds`;
      continue;
    }
    // a sign restriction: x >= 0 (or -x <= 0)
    if (nz.length === 1 && ratIsZero(rhs) && rel !== "=") {
      const j = nz[0];
      const a = coeffs[j];
      if ((rel === ">=" && ratSign(a) > 0) || (rel === "<=" && ratSign(a) < 0)) {
        nonneg[j] = true;
        signsStated = true;
        continue;
      }
    }
    rows.push({ coeffs, rel, rhs, label: rowLabel(coeffs, names, rel, rhs) });
  }
  if (freeFlags.some(Boolean)) for (let j = 0; j < names.length; j++) if (freeFlags[j]) nonneg[j] = false;
  for (let j = 0; j < names.length; j++) {
    if (binaryFlags[j]) {
      integer[j] = true;
      nonneg[j] = true;
      signsStated = true;
      const coeffs = names.map((_, k) => (k === j ? RAT_ONE : RAT_ZERO));
      rows.push({ coeffs, rel: "<=", rhs: RAT_ONE, label: rowLabel(coeffs, names, "<=", RAT_ONE) });
      notes.push(`${names[j]} binary: read as 0 ≤ ${names[j]} ≤ 1 and integer.`);
    }
  }
  if (rows.length > MAX_ROWS) return refuse(nounTitle, `${rows.length} constraints: up to ${MAX_ROWS} here.`);
  // A name whose every coefficient is 0 is a parse artefact (a stray word read
  // as 0·word), never a variable: refuse it by name rather than invent a free
  // variable that flips the verdict.
  for (let j = 0; j < names.length; j++) {
    if (ratIsZero(c[j]) && rows.every((r) => ratIsZero(r.coeffs[j]))) {
      return refuse(nounTitle, `“${names[j]}” is not a constraint or a variable: it appears with coefficient 0 everywhere (in no constraint and not in the objective). Remove the word, or give the variable a coefficient.`);
    }
  }
  const problem: LpProblem = { sense, objName: objName ?? (names.includes("z") ? "obj" : "z"), vars: names, c, c0, rows, nonneg, integer, signsStated, notes, impossibleRow };
  return { mode, twoPhaseAsked, problem, objectiveText: linForm(c, names, false, c0), constraintText: conText.trim() };
}

// ---------------------------------------------------------------------------
// Internal standard form and the exact tableau simplex
// ---------------------------------------------------------------------------

interface Internal {
  /** Internal structural columns: user var j → cols[j] = [plus] or [plus, minus]. */
  colsOf: number[][];
  colNames: string[];
  colUser: number[];
  colSign: number[];
  c: Rat[];
  A: Rat[][];
  b: Rat[];
  rel: Rel[];
  rowSign: number[];
  objSign: number;
}

function toInternal(p: LpProblem, extra: LpRow[] = []): Internal {
  const colsOf: number[][] = [];
  const colNames: string[] = [];
  const colUser: number[] = [];
  const colSign: number[] = [];
  p.vars.forEach((v, j) => {
    if (p.nonneg[j]) {
      colsOf.push([colNames.length]);
      colNames.push(v);
      colUser.push(j);
      colSign.push(1);
    } else {
      colsOf.push([colNames.length, colNames.length + 1]);
      colNames.push(`${v}'`, `${v}''`);
      colUser.push(j, j);
      colSign.push(1, -1);
    }
  });
  const objSign = p.sense === "max" ? 1 : -1;
  const c = colNames.map((_, k) => ratMul(ratInt(objSign * colSign[k]), p.c[colUser[k]]));
  const A: Rat[][] = [];
  const b: Rat[] = [];
  const rel: Rel[] = [];
  const rowSign: number[] = [];
  for (const r of [...p.rows, ...extra]) {
    let row = colNames.map((_, k) => ratMul(ratInt(colSign[k]), r.coeffs[colUser[k]]));
    let rhs = r.rhs;
    let rr: Rel = r.rel;
    let sgn = 1;
    if (ratSign(rhs) < 0) {
      row = row.map(ratNeg);
      rhs = ratNeg(rhs);
      rr = rr === "<=" ? ">=" : rr === ">=" ? "<=" : "=";
      sgn = -1;
    }
    A.push(row);
    b.push(rhs);
    rel.push(rr);
    rowSign.push(sgn);
  }
  return { colsOf, colNames, colUser, colSign, c, A, b, rel, rowSign, objSign };
}

interface Col {
  kind: "x" | "s" | "a";
  name: string;
  /** For s/a columns: the internal row they were created for. */
  row: number;
  /** +1 slack, −1 surplus. */
  sign: number;
}

interface Tableau {
  T: Rat[][];
  rhs: Rat[];
  basis: number[];
  /** Internal row index of each tableau row (rows may be dropped as redundant). */
  rowOf: number[];
  cols: Col[];
  obj: Rat[];
  objVal: Rat;
}

interface SimplexOut {
  status: "optimal" | "unbounded" | "infeasible" | "incomplete";
  tb: Tableau;
  x: Rat[];
  z: Rat;
  phase1Ran: boolean;
  w: Rat;
  pivots: number;
  enterCol?: number;
  droppedRows: number[];
  artificialNames: string[];
  snapshots: { label: string; rows: string[] }[];
}

function cloneTableau(tb: Tableau): Tableau {
  return { T: tb.T.map((r) => r.slice()), rhs: tb.rhs.slice(), basis: tb.basis.slice(), rowOf: tb.rowOf.slice(), cols: tb.cols, obj: tb.obj.slice(), objVal: tb.objVal };
}

function pivot(tb: Tableau, r: number, cidx: number): void {
  const pv = tb.T[r][cidx];
  tb.T[r] = tb.T[r].map((v) => ratDiv(v, pv));
  tb.rhs[r] = ratDiv(tb.rhs[r], pv);
  for (let i = 0; i < tb.T.length; i++) {
    if (i === r || ratIsZero(tb.T[i][cidx])) continue;
    const f = tb.T[i][cidx];
    tb.T[i] = tb.T[i].map((v, j) => ratSub(v, ratMul(f, tb.T[r][j])));
    tb.rhs[i] = ratSub(tb.rhs[i], ratMul(f, tb.rhs[r]));
  }
  if (!ratIsZero(tb.obj[cidx])) {
    const f = tb.obj[cidx];
    tb.obj = tb.obj.map((v, j) => ratSub(v, ratMul(f, tb.T[r][j])));
    tb.objVal = ratSub(tb.objVal, ratMul(f, tb.rhs[r]));
  }
  tb.basis[r] = cidx;
}

/** Recomputes the objective row for cost vector `cost` (z_j − c_j) and the value. */
function setObjective(tb: Tableau, cost: Rat[]): void {
  tb.obj = tb.cols.map((_, j) => {
    let s = RAT_ZERO;
    for (let i = 0; i < tb.T.length; i++) if (!ratIsZero(cost[tb.basis[i]]) && !ratIsZero(tb.T[i][j])) s = ratAdd(s, ratMul(cost[tb.basis[i]], tb.T[i][j]));
    return ratSub(s, cost[j]);
  });
  tb.objVal = tb.basis.reduce((s, bj, i) => ratAdd(s, ratMul(cost[bj], tb.rhs[i])), RAT_ZERO);
}

/** Bland's rule iteration. Returns the status; on "unbounded" the entering column. */
function iterate(tb: Tableau, allowed: (j: number) => boolean, budget: { left: number }): { status: "optimal" | "unbounded" | "incomplete"; enter?: number } {
  while (budget.left > 0) {
    let enter = -1;
    for (let j = 0; j < tb.cols.length; j++) {
      if (!allowed(j) || tb.basis.includes(j)) continue;
      if (ratSign(tb.obj[j]) < 0) {
        enter = j;
        break;
      }
    }
    if (enter < 0) return { status: "optimal" };
    let leave = -1;
    let best: Rat | null = null;
    for (let i = 0; i < tb.T.length; i++) {
      const a = tb.T[i][enter];
      if (ratSign(a) <= 0) continue;
      const ratio = ratDiv(tb.rhs[i], a);
      if (best === null || rLt(ratio, best) || (ratEq(ratio, best) && tb.basis[i] < tb.basis[leave])) {
        best = ratio;
        leave = i;
      }
    }
    if (leave < 0) return { status: "unbounded", enter };
    pivot(tb, leave, enter);
    budget.left--;
  }
  return { status: "incomplete" };
}

function tableauRows(tb: Tableau, objLabel: string): string[] {
  const head = ["basis", ...tb.cols.map((c) => c.name), "rhs"];
  const body = tb.T.map((row, i) => [tb.cols[tb.basis[i]].name, ...row.map(txt), txt(tb.rhs[i])]);
  const objRow = [objLabel, ...tb.obj.map(txt), txt(tb.objVal)];
  const all = [head, ...body, objRow];
  const widths = head.map((_, j) => Math.max(...all.map((r) => r[j].length)));
  const fmtRow = (r: string[]): string => r.map((cell, j) => (j === 0 ? cell.padEnd(widths[j]) : cell.padStart(widths[j]))).join("  ");
  return all.map((r, i) => (i === 0 ? fmtRow(r) : fmtRow(r)));
}

function simplex(int: Internal, slackPrefix: string, artPrefix: string, wantSnapshots: boolean): SimplexOut {
  const m = int.A.length;
  const cols: Col[] = int.colNames.map((name) => ({ kind: "x" as const, name, row: -1, sign: 1 }));
  const slackCol: number[] = [];
  const artCol: number[] = [];
  let sCount = 0;
  let aCount = 0;
  for (let i = 0; i < m; i++) {
    slackCol.push(-1);
    artCol.push(-1);
    if (int.rel[i] === "<=") {
      slackCol[i] = cols.length;
      cols.push({ kind: "s", name: `${slackPrefix}${++sCount}`, row: i, sign: 1 });
    } else if (int.rel[i] === ">=") {
      slackCol[i] = cols.length;
      cols.push({ kind: "s", name: `${slackPrefix}${++sCount}`, row: i, sign: -1 });
    }
  }
  for (let i = 0; i < m; i++) {
    if (int.rel[i] !== "<=") {
      artCol[i] = cols.length;
      cols.push({ kind: "a", name: `${artPrefix}${++aCount}`, row: i, sign: 1 });
    }
  }
  const n = cols.length;
  const T: Rat[][] = [];
  const basis: number[] = [];
  for (let i = 0; i < m; i++) {
    const row = cols.map(() => RAT_ZERO);
    int.A[i].forEach((v, j) => (row[j] = v));
    if (slackCol[i] >= 0) row[slackCol[i]] = ratInt(cols[slackCol[i]].sign);
    if (artCol[i] >= 0) row[artCol[i]] = RAT_ONE;
    T.push(row);
    basis.push(artCol[i] >= 0 ? artCol[i] : slackCol[i]);
  }
  const tb: Tableau = { T, rhs: int.b.slice(), basis, rowOf: int.A.map((_, i) => i), cols, obj: cols.map(() => RAT_ZERO), objVal: RAT_ZERO };
  const budget = { left: PIVOT_CAP };
  const snapshots: { label: string; rows: string[] }[] = [];
  const phase1Ran = aCount > 0;
  const artificialNames = cols.filter((c) => c.kind === "a").map((c) => c.name);
  const droppedRows: number[] = [];
  let w = RAT_ZERO;
  const cost2 = cols.map((c, j) => (c.kind === "x" ? int.c[j] : RAT_ZERO));
  if (phase1Ran) {
    const cost1 = cols.map((c) => (c.kind === "a" ? ratInt(-1) : RAT_ZERO));
    setObjective(tb, cost1);
    if (wantSnapshots) snapshots.push({ label: "Phase 1 — initial tableau (maximise −Σ artificials)", rows: tableauRows(tb, "w") });
    const r1 = iterate(tb, () => true, budget);
    if (r1.status === "incomplete") return { status: "incomplete", tb, x: [], z: RAT_ZERO, phase1Ran, w, pivots: PIVOT_CAP - budget.left, droppedRows, artificialNames, snapshots };
    if (r1.status === "unbounded") throw new Error("phase 1 reported unbounded — impossible for −Σ artificials");
    w = ratNeg(tb.objVal);
    if (wantSnapshots) snapshots.push({ label: "Phase 1 — final tableau", rows: tableauRows(tb, "w") });
    if (ratSign(w) > 0) return { status: "infeasible", tb, x: [], z: RAT_ZERO, phase1Ran, w, pivots: PIVOT_CAP - budget.left, droppedRows, artificialNames, snapshots };
    // drive artificials out of the basis at value 0; a row with no other entry is redundant
    for (let i = tb.T.length - 1; i >= 0; i--) {
      if (tb.cols[tb.basis[i]].kind !== "a") continue;
      let c = -1;
      for (let j = 0; j < n; j++) if (tb.cols[j].kind !== "a" && !ratIsZero(tb.T[i][j]) && !tb.basis.includes(j)) { c = j; break; }
      if (c >= 0) pivot(tb, i, c);
      else {
        droppedRows.push(tb.rowOf[i]);
        tb.T.splice(i, 1);
        tb.rhs.splice(i, 1);
        tb.basis.splice(i, 1);
        tb.rowOf.splice(i, 1);
      }
    }
  }
  setObjective(tb, cost2);
  if (wantSnapshots) snapshots.push({ label: phase1Ran ? "Phase 2 — initial tableau" : "Initial tableau", rows: tableauRows(tb, "z") });
  const r2 = iterate(tb, (j) => tb.cols[j].kind !== "a", budget);
  const pivots = PIVOT_CAP - budget.left;
  if (r2.status === "incomplete") return { status: "incomplete", tb, x: [], z: RAT_ZERO, phase1Ran, w, pivots, droppedRows, artificialNames, snapshots };
  const x = int.colNames.map(() => RAT_ZERO);
  tb.basis.forEach((bj, i) => {
    if (tb.cols[bj].kind === "x") x[bj] = tb.rhs[i];
  });
  if (wantSnapshots) snapshots.push({ label: r2.status === "unbounded" ? "Tableau at which unboundedness was detected" : "Final tableau", rows: tableauRows(tb, "z") });
  return { status: r2.status, tb, x, z: tb.objVal, phase1Ran, w, pivots, enterCol: r2.enter, droppedRows, artificialNames, snapshots };
}

// ---------------------------------------------------------------------------
// Solving in user space: optimum, duals, ranges, alternatives, verification
// ---------------------------------------------------------------------------

interface Range {
  lo: Rat | null;
  hi: Rat | null;
}

export interface LpSolution {
  status: "optimal" | "unbounded" | "infeasible" | "incomplete";
  x?: Rat[];
  z?: Rat;
  slack?: Rat[];
  binding?: boolean[];
  duals?: Rat[];
  reduced?: Rat[];
  degenerate: boolean;
  activeCount?: number;
  cRange?: (Range | null)[];
  bRange?: (Range | null)[];
  alternatives?: Rat[][];
  altUnboundedFace?: boolean;
  ray?: { from: Rat[]; dir: Rat[] };
  infeasibleNames?: string[];
  /** A constraint that reads 0 ≤ −1: infeasible before any arithmetic. */
  impossible?: string;
  w?: Rat;
  phase1Ran: boolean;
  artificialNames: string[];
  redundantRows: number[];
  snapshots: { label: string; rows: string[] }[];
  pivots: number;
  slackNames: string[];
  vertices?: Rat[][];
  verification: string[];
}

function slackPrefixFor(p: LpProblem): { s: string; a: string } {
  const s = p.vars.some((v) => /^s\d+$/.test(v)) ? "slack" : "s";
  const a = p.vars.some((v) => /^a\d+$/.test(v)) ? "art" : "a";
  return { s, a };
}

/** Objective value including the constant, in the user's sense. */
const objectiveAt = (p: LpProblem, x: Rat[]): Rat => ratAdd(dot(p.c, x), p.c0);

function rowValue(r: LpRow, x: Rat[]): Rat {
  return dot(r.coeffs, x);
}

function rowHolds(r: LpRow, x: Rat[]): boolean {
  const v = rowValue(r, x);
  return r.rel === "<=" ? rLe(v, r.rhs) : r.rel === ">=" ? rGe(v, r.rhs) : ratEq(v, r.rhs);
}

function feasible(p: LpProblem, x: Rat[]): boolean {
  if (p.nonneg.some((nn, j) => nn && ratSign(x[j]) < 0)) return false;
  return p.rows.every((r) => rowHolds(r, x));
}

/** Exact vertex enumeration for two variables: every pair of constraint lines. */
function enumerateVertices(p: LpProblem): Rat[][] {
  const lines: { a: Rat[]; b: Rat }[] = p.rows.map((r) => ({ a: r.coeffs, b: r.rhs }));
  if (p.nonneg[0]) lines.push({ a: [RAT_ONE, RAT_ZERO], b: RAT_ZERO });
  if (p.nonneg[1]) lines.push({ a: [RAT_ZERO, RAT_ONE], b: RAT_ZERO });
  const out: Rat[][] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [a1, b1] = lines[i].a;
      const [a2, b2] = lines[j].a;
      const det = ratSub(ratMul(a1, b2), ratMul(a2, b1));
      if (ratIsZero(det)) continue;
      const x = ratDiv(ratSub(ratMul(lines[i].b, b2), ratMul(lines[j].b, b1)), det);
      const y = ratDiv(ratSub(ratMul(a1, lines[j].b), ratMul(a2, lines[i].b)), det);
      const v = [x, y];
      if (!feasible(p, v)) continue;
      if (!out.some((u) => ratEq(u[0], x) && ratEq(u[1], y))) out.push(v);
    }
  }
  return out;
}

function solveProblem(p: LpProblem, opts: { light?: boolean; snapshots?: boolean } = {}): LpSolution {
  const { s: sp, a: ap } = slackPrefixFor(p);
  const base: LpSolution = { status: "incomplete", degenerate: false, phase1Ran: false, artificialNames: [], redundantRows: [], snapshots: [], pivots: 0, slackNames: [], verification: [] };
  if (p.impossibleRow) return { ...base, status: "infeasible", impossible: p.impossibleRow };
  const int = toInternal(p);
  const out = simplex(int, sp, ap, !!opts.snapshots);
  const slackNames = out.tb.cols.filter((c) => c.kind === "s").map((c) => c.name);
  const common = { ...base, phase1Ran: out.phase1Ran, artificialNames: out.artificialNames, redundantRows: out.droppedRows, snapshots: out.snapshots, pivots: out.pivots, slackNames };
  if (out.status === "incomplete") return { ...common, status: "incomplete" };
  if (out.status === "infeasible") {
    const sol: LpSolution = { ...common, status: "infeasible", w: out.w };
    if (!opts.light && p.rows.length <= 3) sol.infeasibleNames = minimalInfeasibleSubset(p);
    return sol;
  }
  const n = p.vars.length;
  const xUser = (xi: Rat[]): Rat[] => p.vars.map((_, j) => int.colsOf[j].reduce((s, k) => ratAdd(s, ratMul(ratInt(int.colSign[k]), xi[k])), RAT_ZERO));
  if (out.status === "unbounded") {
    const tb = out.tb;
    const enter = out.enterCol!;
    const dirInt = int.colNames.map(() => RAT_ZERO);
    if (tb.cols[enter].kind === "x") dirInt[enter] = RAT_ONE;
    tb.basis.forEach((bj, i) => {
      if (tb.cols[bj].kind === "x") dirInt[bj] = ratNeg(tb.T[i][enter]);
    });
    const from = xUser(out.x);
    const dir = xUser(dirInt);
    // verify the ray exactly: feasible direction, improving objective
    for (const r of p.rows) {
      const v = dot(r.coeffs, dir);
      const ok = r.rel === "<=" ? rLe(v, RAT_ZERO) : r.rel === ">=" ? rGe(v, RAT_ZERO) : ratIsZero(v);
      if (!ok) throw new Error(`the unbounded ray violates ${r.label}`);
    }
    if (p.nonneg.some((nn, j) => nn && ratSign(dir[j]) < 0)) throw new Error("the unbounded ray leaves the nonnegative orthant");
    if (!feasible(p, from)) throw new Error("the ray's starting point is infeasible");
    const gain = dot(p.c, dir);
    if (p.sense === "max" ? ratSign(gain) <= 0 : ratSign(gain) >= 0) throw new Error("the unbounded ray does not improve the objective");
    const sol: LpSolution = { ...common, status: "unbounded", ray: { from, dir }, x: from, z: objectiveAt(p, from) };
    sol.verification.push("the ray's direction satisfies every constraint homogeneously and strictly improves the objective (exact)");
    if (n === 2 && !opts.light) sol.vertices = enumerateVertices(p);
    return sol;
  }
  // --- optimal ---
  const tb = out.tb;
  const x = xUser(out.x);
  const z = objectiveAt(p, x);
  const sol: LpSolution = { ...common, status: "optimal", x, z };
  sol.slack = p.rows.map((r) => (r.rel === "<=" ? ratSub(r.rhs, rowValue(r, x)) : r.rel === ">=" ? ratSub(rowValue(r, x), r.rhs) : RAT_ZERO));
  sol.binding = sol.slack.map((s, i) => ratIsZero(s) || p.rows[i].rel === "=");
  // duals from the identity column of each internal row
  const yInt: Rat[] = int.A.map(() => RAT_ZERO);
  for (let i = 0; i < int.A.length; i++) {
    if (out.droppedRows.includes(i)) continue;
    const colIdx = tb.cols.findIndex((c) => c.row === i && (int.rel[i] === "<=" ? c.kind === "s" : c.kind === "a"));
    if (colIdx < 0) throw new Error("no identity column for a row");
    yInt[i] = tb.obj[colIdx];
  }
  sol.duals = yInt.map((y, i) => ratMul(ratInt(int.objSign * int.rowSign[i]), y));
  // reduced costs c_j − z_j in the user's sense
  sol.reduced = p.vars.map((_, j) => {
    if (!p.nonneg[j]) return RAT_ZERO;
    const k = int.colsOf[j][0];
    return ratMul(ratInt(int.objSign), ratNeg(tb.obj[k]));
  });
  sol.degenerate = tb.rhs.some(ratIsZero);
  sol.activeCount = sol.binding.filter(Boolean).length + p.nonneg.filter((nn, j) => nn && ratIsZero(x[j])).length;
  if (!opts.light) {
    // --- ranging (nondegenerate bases only) ---
    if (!sol.degenerate) {
      sol.cRange = p.vars.map((_, j) => {
        if (!p.nonneg[j]) return null;
        const k = int.colsOf[j][0];
        const ck = int.c[k];
        let lo: Rat | null = null;
        let hi: Rat | null = null;
        const r = tb.basis.indexOf(k);
        if (r < 0) {
          hi = tb.obj[k];
          lo = null;
          // internal: c_k ∈ (−∞, c_k + obj_k]
          const rng: Range = { lo: null, hi: ratAdd(ck, hi) };
          return int.objSign === 1 ? rng : { lo: ratNeg(rng.hi!), hi: null };
        }
        for (let j2 = 0; j2 < tb.cols.length; j2++) {
          if (tb.basis.includes(j2) || tb.cols[j2].kind === "a") continue;
          const t = tb.T[r][j2];
          if (ratIsZero(t)) continue;
          const bound = ratNeg(ratDiv(tb.obj[j2], t));
          if (ratSign(t) > 0) lo = lo === null ? bound : rMax(lo, bound);
          else hi = hi === null ? bound : rMin(hi, bound);
        }
        const rng: Range = { lo: lo === null ? null : ratAdd(ck, lo), hi: hi === null ? null : ratAdd(ck, hi) };
        return int.objSign === 1 ? rng : { lo: rng.hi === null ? null : ratNeg(rng.hi), hi: rng.lo === null ? null : ratNeg(rng.lo) };
      });
      sol.bRange = p.rows.map((_, i) => {
        if (out.droppedRows.includes(i)) return null;
        const colIdx = tb.cols.findIndex((c) => c.row === i && (int.rel[i] === "<=" ? c.kind === "s" : c.kind === "a"));
        let lo: Rat | null = null;
        let hi: Rat | null = null;
        for (let r = 0; r < tb.T.length; r++) {
          const t = tb.T[r][colIdx];
          if (ratIsZero(t)) continue;
          const bound = ratNeg(ratDiv(tb.rhs[r], t));
          if (ratSign(t) > 0) lo = lo === null ? bound : rMax(lo, bound);
          else hi = hi === null ? bound : rMin(hi, bound);
        }
        const bi = int.b[i];
        const rng: Range = { lo: lo === null ? null : ratAdd(bi, lo), hi: hi === null ? null : ratAdd(bi, hi) };
        return int.rowSign[i] === 1 ? rng : { lo: rng.hi === null ? null : ratNeg(rng.hi), hi: rng.lo === null ? null : ratNeg(rng.lo) };
      });
    }
    // --- alternative optima: zero reduced cost on a nonbasic non-artificial column ---
    const alts: Rat[][] = [];
    for (let j = 0; j < tb.cols.length; j++) {
      if (tb.basis.includes(j) || tb.cols[j].kind === "a" || !ratIsZero(tb.obj[j])) continue;
      const hasPositive = tb.T.some((row) => ratSign(row[j]) > 0);
      if (!hasPositive) {
        // moving along this column keeps z and never hits a bound
        const dirInt = int.colNames.map(() => RAT_ZERO);
        if (tb.cols[j].kind === "x") dirInt[j] = RAT_ONE;
        tb.basis.forEach((bj, i) => {
          if (tb.cols[bj].kind === "x") dirInt[bj] = ratNeg(tb.T[i][j]);
        });
        const d = xUser(dirInt);
        if (d.some((v) => !ratIsZero(v))) sol.altUnboundedFace = true;
        continue;
      }
      const copy = cloneTableau(tb);
      let leave = -1;
      let best: Rat | null = null;
      for (let i = 0; i < copy.T.length; i++) {
        const a = copy.T[i][j];
        if (ratSign(a) <= 0) continue;
        const ratio = ratDiv(copy.rhs[i], a);
        if (best === null || rLt(ratio, best)) {
          best = ratio;
          leave = i;
        }
      }
      pivot(copy, leave, j);
      const xi = int.colNames.map(() => RAT_ZERO);
      copy.basis.forEach((bj, i) => {
        if (copy.cols[bj].kind === "x") xi[bj] = copy.rhs[i];
      });
      const x2 = xUser(xi);
      if (x2.some((v, k) => !ratEq(v, x[k])) && !alts.some((a) => a.every((v, k) => ratEq(v, x2[k])))) {
        if (!feasible(p, x2) || !ratEq(objectiveAt(p, x2), z)) throw new Error("an alternative optimum failed re-evaluation");
        alts.push(x2);
      }
    }
    if (alts.length) sol.alternatives = alts;
    if (n === 2) sol.vertices = enumerateVertices(p);
  }
  // --- verification ---
  verifyOptimum(p, sol);
  return sol;
}

function verifyOptimum(p: LpProblem, sol: LpSolution): void {
  const x = sol.x!;
  const z = sol.z!;
  const y = sol.duals!;
  for (const r of p.rows) if (!rowHolds(r, x)) throw new Error(`${r.label} fails at x*`);
  p.nonneg.forEach((nn, j) => {
    if (nn && ratSign(x[j]) < 0) throw new Error(`${p.vars[j]} < 0 at x*`);
  });
  if (!ratEq(objectiveAt(p, x), z)) throw new Error("objective re-evaluation differs");
  const isMax = p.sense === "max";
  // dual feasibility: sign of y_i by relation, Aᵀy vs c by variable sign
  p.rows.forEach((r, i) => {
    const s = ratSign(y[i]);
    if (r.rel === "<=" && (isMax ? s < 0 : s > 0)) throw new Error(`dual sign on ${r.label}`);
    if (r.rel === ">=" && (isMax ? s > 0 : s < 0)) throw new Error(`dual sign on ${r.label}`);
  });
  const aty = p.vars.map((_, j) => p.rows.reduce((s, r, i) => ratAdd(s, ratMul(r.coeffs[j], y[i])), RAT_ZERO));
  p.vars.forEach((v, j) => {
    const d = ratSub(aty[j], p.c[j]);
    if (!p.nonneg[j]) {
      if (!ratIsZero(d)) throw new Error(`dual constraint for free variable ${v}`);
    } else if (isMax ? ratSign(d) < 0 : ratSign(d) > 0) throw new Error(`dual feasibility Aᵀy ${isMax ? "≥" : "≤"} c fails at ${v}`);
    // complementary slackness on the variable
    if (!ratIsZero(ratMul(d, x[j]))) throw new Error(`complementary slackness fails at ${v}`);
  });
  p.rows.forEach((r, i) => {
    if (!ratIsZero(ratMul(y[i], sol.slack![i]))) throw new Error(`complementary slackness fails on ${r.label}`);
  });
  // strong duality: cᵀx* = bᵀy* (the objective constant aside)
  const bty = p.rows.reduce((s, r, i) => ratAdd(s, ratMul(r.rhs, y[i])), RAT_ZERO);
  if (!ratEq(ratAdd(bty, p.c0), z)) throw new Error(`strong duality: bᵀy = ${fmtRat(bty)} but cᵀx* = ${fmtRat(ratSub(z, p.c0))}`);
  sol.verification.push("every constraint re-evaluated at x* exactly", "dual feasibility and complementary slackness exact", `strong duality cᵀx* = bᵀy* = ${txt(ratSub(z, p.c0))} exact`);
  if (sol.vertices) {
    if (sol.vertices.length) {
      let best: Rat | null = null;
      for (const v of sol.vertices) {
        const val = objectiveAt(p, v);
        if (best === null || (isMax ? rGt(val, best) : rLt(val, best))) best = val;
      }
      if (!ratEq(best!, z)) throw new Error(`independent vertex enumeration gives ${fmtRat(best!)}, the simplex ${fmtRat(z)}`);
      sol.verification.push(`independent vertex enumeration (${sol.vertices.length} feasible vertices from every pair of constraint lines) agrees on the optimum`);
    }
  }
}

/**
 * Exact redundancy test: a ≤ row is redundant when maximising its left side
 * over the OTHER constraints cannot exceed its bound (≥ rows: minimising
 * cannot fall below). Unbounded or exceeding → the row does cut the region.
 */
function isRedundantRow(p: LpProblem, i: number): boolean {
  const r = p.rows[i];
  if (r.rel === "=") return false;
  const q: LpProblem = { ...p, sense: r.rel === "<=" ? "max" : "min", c: r.coeffs, c0: RAT_ZERO, rows: p.rows.filter((_, k) => k !== i), integer: p.integer.map(() => false), impossibleRow: undefined };
  try {
    const out = solveProblem(q, { light: true });
    if (out.status !== "optimal") return false;
    return r.rel === "<=" ? rLe(out.z!, r.rhs) : rGe(out.z!, r.rhs);
  } catch {
    return false;
  }
}

/** The smallest set of constraints (with the sign restrictions) that is already infeasible. */
function minimalInfeasibleSubset(p: LpProblem): string[] {
  const m = p.rows.length;
  const idx = p.rows.map((_, i) => i);
  const subsets: number[][] = [];
  for (let size = 1; size <= Math.min(3, m); size++) {
    const rec = (start: number, cur: number[]): void => {
      if (cur.length === size) {
        subsets.push(cur.slice());
        return;
      }
      for (let i = start; i < m; i++) rec(i + 1, [...cur, i]);
    };
    rec(0, []);
  }
  for (const sub of subsets) {
    const q: LpProblem = { ...p, rows: sub.map((i) => p.rows[i]), c: p.c.map(() => RAT_ZERO), integer: p.integer.map(() => false) };
    // a zero objective still needs one nonzero coefficient for readInput's sake; solveProblem does not care
    const out = simplex(toInternal(q), "s", "a", false);
    if (out.status === "infeasible") return sub.map((i) => p.rows[i].label);
  }
  return idx.map((i) => p.rows[i].label);
}

// ---------------------------------------------------------------------------
// Branch and bound
// ---------------------------------------------------------------------------

interface BBResult {
  complete: boolean;
  nodes: number;
  best?: { x: Rat[]; z: Rat };
  log: string[];
}

function branchAndBound(p: LpProblem, relax: LpSolution): BBResult {
  const isMax = p.sense === "max";
  const log: string[] = [];
  let best: { x: Rat[]; z: Rat } | undefined;
  let nodes = 0;
  const better = (z: Rat): boolean => (best === undefined ? true : isMax ? rGt(z, best.z) : rLt(z, best.z));
  const stack: { rows: LpRow[]; path: string[] }[] = [{ rows: [], path: [] }];
  const fractional = (x: Rat[]): number => p.vars.findIndex((_, j) => p.integer[j] && !rIsInt(x[j]));
  while (stack.length) {
    if (nodes >= BB_MAX_NODES) return { complete: false, nodes, best, log };
    const node = stack.pop()!;
    nodes++;
    const q: LpProblem = { ...p, rows: [...p.rows, ...node.rows] };
    const tag = node.path.length ? node.path.join(", ") : "LP relaxation";
    let sol: LpSolution;
    if (!node.rows.length) sol = relax;
    else sol = solveProblem(q, { light: true });
    if (sol.status === "infeasible") {
      log.push(`${tag}: infeasible`);
      continue;
    }
    if (sol.status === "unbounded") {
      log.push(`${tag}: unbounded`);
      return { complete: false, nodes, best, log };
    }
    if (sol.status === "incomplete") return { complete: false, nodes, best, log };
    const x = sol.x!;
    const z = sol.z!;
    if (!better(z) && !(best && ratEq(z, best.z))) {
      log.push(`${tag}: ${pointTxt(x)}, ${p.objName} = ${txt(z)} — pruned (cannot beat ${txt(best!.z)})`);
      continue;
    }
    if (best && ratEq(z, best.z) && !better(z)) {
      log.push(`${tag}: ${pointTxt(x)}, ${p.objName} = ${txt(z)} — pruned (cannot beat ${txt(best.z)})`);
      continue;
    }
    const j = fractional(x);
    if (j < 0) {
      best = { x, z };
      log.push(`${tag}: ${pointTxt(x)}, ${p.objName} = ${txt(z)} — integer, new incumbent`);
      continue;
    }
    log.push(`${tag}: ${pointTxt(x)}, ${p.objName} = ${txt(z)} — ${p.vars[j]} fractional, branch`);
    const fl = rFloor(x[j]);
    const ce = ratAdd(fl, RAT_ONE);
    const unit = p.vars.map((_, k) => (k === j ? RAT_ONE : RAT_ZERO));
    const le: LpRow = { coeffs: unit, rel: "<=", rhs: fl, label: `${p.vars[j]} ≤ ${txt(fl)}` };
    const ge: LpRow = { coeffs: unit, rel: ">=", rhs: ce, label: `${p.vars[j]} ≥ ${txt(ce)}` };
    stack.push({ rows: [...node.rows, ge], path: [...node.path, ge.label] });
    stack.push({ rows: [...node.rows, le], path: [...node.path, le.label] });
  }
  return { complete: true, nodes, best, log };
}

/** Exhaustive lattice check for two bounded variables (independent of B&B). */
function latticeOptimum(p: LpProblem, vertices: Rat[][]): { x: Rat[]; z: Rat } | null | "too-big" {
  if (!vertices.length) return null;
  const xs = vertices.map((v) => v[0]);
  const ys = vertices.map((v) => v[1]);
  const lo0 = rFloor(xs.reduce(rMin));
  const hi0 = rFloor(xs.reduce(rMax));
  const lo1 = rFloor(ys.reduce(rMin));
  const hi1 = rFloor(ys.reduce(rMax));
  const w0 = Number(ratSub(hi0, lo0).n) + 2;
  const w1 = Number(ratSub(hi1, lo1).n) + 2;
  if (w0 * w1 > 4000) return "too-big";
  let best: { x: Rat[]; z: Rat } | null = null;
  for (let i = 0; i <= w0; i++) {
    for (let j = 0; j <= w1; j++) {
      const x = [ratAdd(lo0, ratInt(i)), ratAdd(lo1, ratInt(j))];
      if (!feasible(p, x)) continue;
      const z = objectiveAt(p, x);
      if (!best || (p.sense === "max" ? rGt(z, best.z) : rLt(z, best.z))) best = { x, z };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The dual
// ---------------------------------------------------------------------------

/**
 * Dual variable names: u, v for one or two rows; u1, u2, … for three or more
 * (never a name the primal uses). The dual OBJECTIVE is w unless a primal or
 * dual variable is called w, then w_dual — the same rule as the primal's z/obj.
 */
function dualText(p: LpProblem): { text: string; names: string[]; objName: string } {
  const m = p.rows.length;
  const taken = new Set(p.vars);
  let names: string[];
  if (m <= 2 && ["u", "v"].slice(0, m).every((n) => !taken.has(n))) names = ["u", "v"].slice(0, m);
  else {
    const pfx = ["u", "y", "d"].find((q) => !p.vars.some((v) => new RegExp(`^${q}\\d+$`).test(v))) ?? "dual";
    names = p.rows.map((_, i) => `${pfx}${i + 1}`);
  }
  const objName = taken.has("w") || names.includes("w") ? "w_dual" : "w";
  const isMax = p.sense === "max";
  const b = p.rows.map((r) => r.rhs);
  // every dual variable is written, 0u included, so the re-read keeps b's order
  const obj = linForm(b, names, true, RAT_ZERO, true);
  const cons: string[] = [];
  p.vars.forEach((v, j) => {
    const col = p.rows.map((r) => r.coeffs[j]);
    const rel = !p.nonneg[j] ? "=" : isMax ? ">=" : "<=";
    cons.push(`${linForm(col, names, true)} ${rel} ${mth(p.c[j])}`);
  });
  const signs: string[] = [];
  p.rows.forEach((r, i) => {
    if (r.rel === "=") signs.push(`${names[i]} free`);
    else if ((isMax && r.rel === "<=") || (!isMax && r.rel === ">=")) signs.push(`${names[i]} >= 0`);
    else signs.push(`${names[i]} <= 0`);
  });
  // compact the nonnegative list: u, v >= 0
  const nn = p.rows.map((_, i) => i).filter((i) => signs[i].endsWith(">= 0"));
  const rest = signs.filter((s) => !s.endsWith(">= 0"));
  const signText = [...(nn.length ? [`${nn.map((i) => names[i]).join(", ")} >= 0`] : []), ...rest];
  return { text: `${isMax ? "minimize" : "maximize"} ${obj} subject to ${[...cons, ...signText].join(", ")}`, names, objName };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

function figureFor(p: LpProblem, sol: LpSolution, caption: string, integerPoint?: Rat[]): { svg: string; alt: string } | null {
  const n = p.vars.length;
  if (n === 2) {
    const f = (r: Rat): number => ratToNumber(r);
    const spec: LpFigureSpec = {
      vars: [p.vars[0], p.vars[1]],
      rows: p.rows.map((r) => ({ a: [f(r.coeffs[0]), f(r.coeffs[1])], rel: r.rel, b: f(r.rhs), label: r.label })),
      nonneg: [p.nonneg[0], p.nonneg[1]],
      vertices: (sol.vertices ?? []).map((v) => [f(v[0]), f(v[1])] as [number, number]),
      c: [f(p.c[0]), f(p.c[1])],
      sense: p.sense,
      status: sol.status === "optimal" ? "optimal" : sol.status === "unbounded" ? "unbounded" : "infeasible",
      caption,
    };
    if (sol.status === "optimal" && sol.x) {
      spec.optimum = [f(sol.x[0]), f(sol.x[1])];
      spec.optimumLabel = `${pointTxt(sol.x)}, ${p.objName} = ${txt(sol.z!)}`;
      if (sol.alternatives?.length) spec.altEdge = [spec.optimum, [f(sol.alternatives[0][0]), f(sol.alternatives[0][1])]];
    }
    if (sol.status === "unbounded" && sol.ray) spec.ray = { from: [f(sol.ray.from[0]), f(sol.ray.from[1])], dir: [f(sol.ray.dir[0]), f(sol.ray.dir[1])] };
    if (integerPoint) spec.integerPoint = [f(integerPoint[0]), f(integerPoint[1])];
    return { svg: lpRegionSvg(spec), alt: `Feasible region of the linear program in ${p.vars[0]} and ${p.vars[1]}: ${caption}` };
  }
  if (sol.status === "optimal" && sol.x) {
    const rows = [
      ...p.vars.map((v, j) => ({ name: v, value: ratToNumber(sol.x![j]), colour: "#2563eb" })),
      ...p.rows.map((r, i) => ({ name: `slack: ${r.label}`, value: ratToNumber(sol.slack![i]), colour: "#9DB3C4" })),
    ];
    return { svg: hBarSvg(rows, { title: caption, unit: "" }), alt: `Bar chart of the optimum ${pointTxt(sol.x)} and the slack of each constraint.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function rangeTxt(r: Range | null): string {
  if (!r) return "—";
  const lo = r.lo === null ? "(−∞" : `[${txt(r.lo)}`;
  const hi = r.hi === null ? "∞)" : `${txt(r.hi)}]`;
  return `${lo}, ${hi}`;
}

function standardFormLines(p: LpProblem, sol: LpSolution | null): { text: string; math?: boolean }[] {
  const out: { text: string; math?: boolean }[] = [];
  const { s: sp, a: ap } = slackPrefixFor(p);
  const slackNames: string[] = [];
  const freeVars = p.vars.filter((_, j) => !p.nonneg[j]);
  let sCount = 0;
  const parts: string[] = [];
  const rowsMath: string[] = [];
  let flipped = 0;
  p.rows.forEach((r) => {
    const names = p.vars.slice();
    // a negative right-hand side is multiplied through by −1 (the tableau needs b ≥ 0)
    const neg = ratSign(r.rhs) < 0;
    const coeffs = neg ? r.coeffs.map(ratNeg) : r.coeffs.slice();
    const rhs = neg ? ratNeg(r.rhs) : r.rhs;
    const rel: Rel = neg ? (r.rel === "<=" ? ">=" : r.rel === ">=" ? "<=" : "=") : r.rel;
    if (neg) flipped++;
    let extraName = "";
    if (rel !== "=") {
      extraName = `${sp}${++sCount}`;
      slackNames.push(extraName);
      names.push(extraName);
      coeffs.push(rel === "<=" ? RAT_ONE : ratInt(-1));
      parts.push(`${extraName} ${rel === "<=" ? "slack" : "surplus"} of ${r.label}${neg ? ` (× −1: ${rowLabel(coeffs.slice(0, p.vars.length), p.vars, rel, rhs)})` : ""}`);
    }
    rowsMath.push(`${linForm(coeffs, names, true)} = ${mth(rhs)}`);
  });
  // artificial variables belong to the rows that are ≥ or = AFTER the sign flip
  const artRows = p.rows.filter((r) => (ratSign(r.rhs) < 0 ? r.rel !== ">=" : r.rel !== "<=")).length;
  const head = [`Standard form${slackNames.length ? ` (${parts.join("; ")})` : ""}${artRows ? `; ${artRows} artificial variable${artRows > 1 ? "s" : ""} ${Array.from({ length: artRows }, (_, i) => `${ap}${i + 1}`).join(", ")} for phase 1` : ""}:`];
  out.push(line(head[0]));
  if (flipped) out.push(line(`${flipped} constraint${flipped > 1 ? "s" : ""} with a negative right-hand side ${flipped > 1 ? "were" : "was"} multiplied through by −1 (a ≤ becomes ≥ and vice versa) so every right-hand side is non-negative.`));
  if (p.sense === "min") out.push(line(`minimize ${linForm(p.c, p.vars, false, p.c0)}  ≡  maximize ${linForm(p.c.map(ratNeg), p.vars, false, ratNeg(p.c0))}`));
  out.push(line(`${p.objName} = ${linForm(p.c, p.vars, true, p.c0)}`, true));
  rowsMath.forEach((m) => out.push(line(m, true)));
  const nn = [...p.vars.filter((_, j) => p.nonneg[j]), ...slackNames];
  if (nn.length) out.push(line(`${nn.join(", ")} ≥ 0`));
  for (const v of freeVars) out.push(line(`${v} is free (no sign restriction stated): ${v} = ${v}' − ${v}'' with ${v}', ${v}'' ≥ 0`));
  if (sol?.redundantRows.length) out.push(line(`Redundant (linearly dependent) constraint${sol.redundantRows.length > 1 ? "s" : ""} dropped in phase 1: ${sol.redundantRows.map((i) => p.rows[i].label).join("; ")}`));
  return out;
}

function optimumLines(p: LpProblem, sol: LpSolution, heading: string): { text: string; math?: boolean }[] {
  const out: { text: string; math?: boolean }[] = [];
  out.push(line(heading));
  p.vars.forEach((v, j) => out.push(line(`${v} = ${mth(sol.x![j])}`, true)));
  out.push(line(`${p.objName} = ${mth(sol.z!)}`, true));
  if (sol.x!.some((v) => v.d !== 1n) || sol.z!.d !== 1n) out.push(line(`≈ (${sol.x!.map((v) => sig6(ratToNumber(v))).join(", ")}), ${p.objName} ≈ ${sig6(ratToNumber(sol.z!))}`));
  return out;
}

function statusLine(p: LpProblem, sol: LpSolution): string {
  if (sol.status === "optimal") {
    if (sol.altUnboundedFace) return `Status: optimal, not unique — the optimal set is unbounded (a whole ray of points gives ${p.objName} = ${txt(sol.z!)}).`;
    if (sol.alternatives?.length) {
      const a = sol.alternatives[0];
      const more = sol.alternatives.length > 1 ? `; also ${sol.alternatives.slice(1).map(pointTxt).join(", ")}` : "";
      return `Status: ALTERNATIVE OPTIMA along the edge from ${pointTxt(sol.x!)} to ${pointTxt(a)} — every point on it gives ${p.objName} = ${txt(sol.z!)}${more}.`;
    }
    if (sol.degenerate) return `Status: unique optimum at a DEGENERATE vertex (${sol.activeCount} constraints meet at ${pointTxt(sol.x!)}, more than the ${p.vars.length} needed) — the shadow prices are not unique here.`;
    return "Status: unique optimum.";
  }
  return "";
}

function analysisLines(p: LpProblem, sol: LpSolution, lead: Mode): { text: string; math?: boolean }[] {
  const out: { text: string; math?: boolean }[] = [];
  const table = (): void => {
    if (!p.rows.length) return;
    out.push(line("At the optimum:"));
    p.rows.forEach((r, i) => {
      const lhs = rowValue(r, sol.x!);
      out.push(line(`${r.label}: LHS ${txt(lhs)}, bound ${txt(r.rhs)}, slack ${txt(sol.slack![i])} — ${sol.binding![i] ? "binding" : "not binding"}${sol.redundantRows.includes(i) ? " (redundant)" : ""}`));
    });
  };
  const shadow = (): void => {
    if (!p.rows.length) return;
    const vals = p.rows.map((r, i) => `${r.label} → ${txt(sol.duals![i])}`).join("; ");
    if (sol.degenerate) out.push(line(`Shadow prices are NOT unique here: the vertex ${pointTxt(sol.x!)} is degenerate (${sol.activeCount} constraints meet at it). The final tableau gives ${vals} — one valid set of dual values among several.`));
    else out.push(line(`Shadow prices (dual values, ∂${p.objName}*/∂b): ${vals}`));
    p.rows.forEach((r, i) => {
      if (sol.binding![i] || !ratIsZero(sol.duals![i]) || ratIsZero(sol.slack![i])) return;
      const red = isRedundantRow(p, i);
      if (red === true) out.push(line(`${r.label} is redundant (slack ${txt(sol.slack![i])}, shadow price 0): the other constraints already imply it everywhere on the feasible region.`));
      else out.push(line(`${r.label} is not binding here (slack ${txt(sol.slack![i])}, shadow price 0), but it does cut the feasible region elsewhere — not redundant.`));
    });
  };
  const reduced = (): void => {
    const parts = p.vars.map((v, j) => {
      if (!p.nonneg[j]) return `${v}: 0 (free variable)`;
      const basic = !ratIsZero(sol.x![j]) || ratIsZero(sol.reduced![j]);
      return `${v}: ${txt(sol.reduced![j])}${basic && ratIsZero(sol.reduced![j]) ? " (basic)" : ""}`;
    });
    out.push(line(`Reduced costs (c_j − z_j): ${parts.join("; ")}`));
  };
  const ranges = (): void => {
    if (sol.degenerate) {
      out.push(line("Sensitivity ranges are not given: the optimal basis is degenerate, so several bases describe the same vertex and no single range is THE range."));
      return;
    }
    if (sol.cRange) out.push(line(`Objective-coefficient ranges (the optimal vertex stays optimal): ${p.vars.map((v, j) => `c_${v} ∈ ${rangeTxt(sol.cRange![j])}`).join("; ")}`));
    if (sol.bRange && p.rows.length) out.push(line(`Right-hand-side ranges (the shadow prices stay valid): ${p.rows.map((r, i) => `${r.label}: b ∈ ${rangeTxt(sol.bRange![i])}`).join("; ")}`));
    if (sol.alternatives?.length) out.push(line("Ranges refer to the basis shown; with alternative optima a tie in the objective row sits at the edge of the coefficient range."));
  };
  const order: (() => void)[] = lead === "shadow" ? [shadow, table, reduced, ranges] : lead === "reduced" ? [reduced, shadow, table, ranges] : lead === "sensitivity" ? [ranges, shadow, reduced, table] : [table, shadow, reduced, ranges];
  for (const f of order) f();
  return out;
}

/** "1 + t", "-t", "4 - 2t": the constant first, as a ray is read. */
function rayForm(from: Rat, dir: Rat, param: string, math: boolean): string {
  const minus = math ? "-" : "−";
  const mag = ratSign(dir) < 0 ? ratNeg(dir) : dir;
  const dirBody = ratIsZero(dir) ? "" : ratEq(mag, RAT_ONE) ? param : mag.d === 1n ? `${fmtRat(mag)}${param}` : `${fmtRat(mag)}*${param}`;
  if (ratIsZero(dir)) return math ? mth(from) : txt(from);
  if (ratIsZero(from)) return ratSign(dir) < 0 ? `${minus}${dirBody}` : dirBody;
  return `${math ? mth(from) : txt(from)} ${ratSign(dir) < 0 ? minus : "+"} ${dirBody}`;
}

function unboundedLines(p: LpProblem, sol: LpSolution, param: string, label: string): { text: string; math?: boolean }[] {
  const out: { text: string; math?: boolean }[] = [];
  const { from, dir } = sol.ray!;
  const objAlong = rayForm(objectiveAt(p, from), dot(p.c, dir), param, false);
  out.push(line(`${label}UNBOUNDED: along the ray below (${param} ≥ 0) the objective ${objAlong} ${p.sense === "max" ? "grows" : "decreases"} without bound.`));
  p.vars.forEach((v, j) => out.push(line(`${v} = ${rayForm(from[j], dir[j], param, true)}`, true)));
  return out;
}

function infeasibleLines(p: LpProblem, sol: LpSolution, label: string): { text: string; math?: boolean }[] {
  const out: { text: string; math?: boolean }[] = [];
  const nn = p.vars.filter((_, j) => p.nonneg[j]);
  if (sol.impossible) {
    out.push(line(`${label}INFEASIBLE: ${sol.impossible}.`));
    return out;
  }
  if (sol.infeasibleNames?.length) {
    const names = sol.infeasibleNames;
    const withNn = nn.length ? ` with ${nn.join(", ")} ≥ 0` : "";
    if (names.length === 1) out.push(line(`${label}INFEASIBLE: ${names[0]} cannot hold${withNn}.`));
    else out.push(line(`${label}INFEASIBLE: ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} cannot ${names.length === 2 ? "both" : "all"} hold${withNn}.`));
    if (sol.phase1Ran) out.push(line(`Phase 1 of the simplex ended at w = ${txt(sol.w ?? RAT_ZERO)} > 0 (the artificial variable${sol.artificialNames.length > 1 ? "s" : ""} ${sol.artificialNames.join(", ")} cannot reach 0); the contradiction was then isolated to the constraint${names.length > 1 ? "s" : ""} named.`));
  } else {
    const many = sol.artificialNames.length > 1;
    out.push(line(`${label}INFEASIBLE: phase 1 ended at w = ${txt(sol.w ?? RAT_ZERO)} > 0 — the artificial variable${many ? "s" : ""} ${sol.artificialNames.join(", ")} cannot ${many ? "all " : ""}be driven to 0, so no point satisfies every constraint${nn.length ? ` with ${nn.join(", ")} ≥ 0` : ""}.`));
  }
  return out;
}

function paramName(p: LpProblem): string {
  for (const t of ["t", "k", "q", "r", "m"]) if (!p.vars.includes(t)) return t;
  return "param";
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

export function tryLp(raw: string): VerbResult | null {
  const parsed = readInput(raw);
  if (parsed === null) return null;
  if ("lines" in parsed) return parsed;
  const { mode, problem: p } = parsed;
  const n = p.vars.length;
  const m = p.rows.length;
  const allNonneg = p.nonneg.every(Boolean);
  const title = `Linear program — ${p.sense === "max" ? "maximize" : "minimize"} ${parsed.objectiveText} (${n} variable${n === 1 ? "" : "s"}, ${m} constraint${m === 1 ? "" : "s"}${allNonneg ? " + non-negativity" : p.nonneg.some(Boolean) ? " + partial sign restrictions" : ""})`;
  const caveats: string[] = [...p.notes];
  const lines: { text: string; math?: boolean }[] = [];

  if (mode === "graphical" && n !== 2) return refuse(title, `A graphical solution needs exactly two variables; this problem has ${n} (${p.vars.join(", ")}). Drop "graphically" to solve it by the simplex method.`);

  if (mode === "standard") {
    lines.push(...standardFormLines(p, null));
    if (p.sense === "min") lines.push(line("The minimisation is written as the maximisation of the negated objective; the optimum value of the original is the negative of the converted one."));
    if (!p.signsStated) lines.push(line("No sign restriction was stated, so every variable is free and is split as above; add x, y >= 0 if non-negativity was intended."));
    caveats.push("Conversion only — nothing was solved. Drop \"standard form of\" to solve it.");
    return { title, lines, caveats };
  }

  let sol: LpSolution;
  try {
    sol = solveProblem(p, { snapshots: mode === "tableau" });
  } catch (err) {
    return refuse(title, `Verification FAILED — withheld rather than guessed: ${(err as Error).message}.`);
  }
  if (sol.status === "incomplete") return refuse(title, `The simplex did not finish within ${PIVOT_CAP} pivots (incomplete) — nothing is reported rather than a partial answer. Bland's rule rules out cycling, so please report this problem.`);

  // The two-part answer when no sign restriction was stated and the problem is unbounded as typed.
  let nonnegSol: LpSolution | null = null;
  let pNN: LpProblem | null = null;
  if (!p.signsStated && sol.status === "unbounded") {
    pNN = { ...p, nonneg: p.vars.map(() => true), signsStated: true };
    try {
      nonnegSol = solveProblem(pNN);
    } catch (err) {
      return refuse(title, `Verification FAILED on the non-negative version — withheld: ${(err as Error).message}.`);
    }
    if (nonnegSol.status === "incomplete") nonnegSol = null;
  }

  if (mode === "dual") {
    const d = dualText(p);
    lines.push(line(`Dual LP (dual variable${m === 1 ? "" : "s"} ${d.names.join(", ")}, one per constraint):`));
    lines.push(line(d.text));
    const dualParsed = readInput(d.text);
    const allZeroB = p.rows.every((r) => ratIsZero(r.rhs));
    if (!dualParsed || "lines" in dualParsed) {
      if (!allZeroB) return refuse(title, "The dual could not be re-read by this grammar — withheld.");
    }
    let dsol: LpSolution | null = null;
    if (dualParsed && !("lines" in dualParsed)) {
      try {
        dsol = solveProblem(dualParsed.problem, { light: true });
      } catch (err) {
        return refuse(title, `Verification FAILED on the dual — withheld: ${(err as Error).message}.`);
      }
    }
    if (dsol && dualParsed && !("lines" in dualParsed) && dsol.status === "optimal" && sol.status === "optimal") {
      const w = dsol.z!;
      if (!ratEq(ratSub(w, dualParsed.problem.c0), ratSub(sol.z!, p.c0))) return refuse(title, `Strong duality FAILED: primal ${txt(sol.z!)}, dual ${txt(w)} — withheld.`);
      // The dual was re-read by NAME: its variables are mapped back by name, never by position.
      const dvars = dualParsed.problem.vars;
      const dx = d.names.map((nm) => {
        const k = dvars.indexOf(nm);
        return k < 0 ? RAT_ZERO : dsol!.x![k];
      });
      lines.push(line("Dual optimum:"));
      d.names.forEach((nm, i) => lines.push(line(`${nm} = ${mth(dx[i])}`, true)));
      lines.push(line(`${d.objName} = ${mth(w)}`, true));
      lines.push(line(`Strong duality: ${p.objName}* = ${d.objName}* = ${txt(sol.z!)}; the dual optimum ${pointTxt(dx)} is the vector of shadow prices${sol.degenerate ? " (one valid set — the primal vertex is degenerate)" : ""}.`));
      if (!sol.degenerate && !dx.every((v, i) => ratEq(v, sol.duals![i]))) caveats.push("The dual's own optimum differs from the tableau's dual values: the dual has alternative optima (the primal is degenerate in the dual sense).");
    } else if (allZeroB && sol.status === "optimal") {
      lines.push(line(`Every right-hand side is 0, so the dual objective is identically 0 and ${d.objName}* = ${p.objName}* = 0; the shadow prices below are one optimal dual vector.`));
    } else if (!dsol) {
      lines.push(line("The dual has a zero objective; its feasibility follows the primal's status."));
    } else if (sol.status === "unbounded") lines.push(line(`The primal is unbounded, so the dual is infeasible (${dsol.status === "infeasible" ? "confirmed" : "dual status: " + dsol.status}).`));
    else if (sol.status === "infeasible") lines.push(line(`The primal is infeasible, so the dual is ${dsol.status === "unbounded" ? "unbounded" : dsol.status === "infeasible" ? "also infeasible" : dsol.status}.`));
    lines.push(line("Primal:"));
  }

  if (mode === "tableau") {
    for (const s of sol.snapshots) {
      lines.push(line(`${s.label}:`));
      for (const r of s.rows) lines.push(line(r));
    }
    if (sol.phase1Ran) lines.push(line(`Phase 1 ran: artificial variable${sol.artificialNames.length > 1 ? "s" : ""} ${sol.artificialNames.join(", ")} (w = ${txt(sol.w ?? RAT_ZERO)} at the end of phase 1${ratIsZero(sol.w ?? RAT_ZERO) ? ", so a basic feasible solution exists" : ""}).`));
    if (parsed.twoPhaseAsked && /big[-\s]?M/i.test(raw)) caveats.push("Big-M is not used here: the two-phase method reaches the same optimum without the arbitrary large constant; the tableaux shown are two-phase.");
    caveats.push(`${sol.pivots} pivot${sol.pivots === 1 ? "" : "s"} (Bland's rule: lowest-index entering and leaving variables).`);
  }

  lines.push(...standardFormLines(p, sol));

  const param = paramName(p);
  let integerPoint: Rat[] | undefined;
  if (sol.status === "unbounded") {
    const label = nonnegSol ? "As stated (no sign restriction): " : "";
    lines.push(...unboundedLines(p, sol, param, label));
    if (nonnegSol && pNN) {
      const label2 = `With ${p.vars.join(", ")} ≥ 0 (the textbook convention, which you did not state): `;
      if (nonnegSol.status === "optimal") {
        lines.push(...optimumLines(pNN, nonnegSol, `${label2}optimum ${pointTxt(nonnegSol.x!)}, ${p.objName} = ${txt(nonnegSol.z!)}`));
        lines.push(line(statusLine(pNN, nonnegSol)));
        lines.push(...analysisLines(pNN, nonnegSol, mode));
      } else if (nonnegSol.status === "unbounded") lines.push(...unboundedLines(pNN, nonnegSol, param, label2));
      else lines.push(...infeasibleLines(pNN, nonnegSol, label2));
      caveats.push(`Two answers because the sign restrictions were not stated: as typed the variables are free; with ${p.vars.join(", ")} ≥ 0 the standard textbook form. Add ${p.vars.join(", ")} >= 0 to get only the second.`);
    }
  } else if (sol.status === "infeasible") {
    lines.push(...infeasibleLines(p, sol, ""));
  } else {
    const anyInteger = p.integer.some(Boolean);
    lines.push(...optimumLines(p, sol, anyInteger ? `LP relaxation (integrality ignored): optimum ${pointTxt(sol.x!)}, ${p.objName} = ${txt(sol.z!)}` : `Optimum${sol.alternatives?.length ? " (one of several)" : ""}:`));
    lines.push(line(statusLine(p, sol)));
    lines.push(...analysisLines(p, sol, mode));
    if (!p.signsStated) caveats.push(`No sign restriction was stated, so the variables were treated as free (unrestricted in sign) — the usual textbook form adds ${p.vars.join(", ")} >= 0.`);
    if (anyInteger) {
      const intVars = p.vars.filter((_, j) => p.integer[j]);
      const relaxIntegral = intVars.every((v) => rIsInt(sol.x![p.vars.indexOf(v)]));
      if (relaxIntegral) {
        lines.push(line(`Integer requirement (${intVars.join(", ")}): the LP relaxation is already integral, so it is the integer optimum.`));
        integerPoint = sol.x;
      } else if (n > BB_MAX_VARS) {
        lines.push(line(`LP relaxation only; the integer optimum was not searched: branch-and-bound runs here for up to ${BB_MAX_VARS} variables and this problem has ${n}. The relaxation's value ${txt(sol.z!)} is a bound on the integer optimum.`));
      } else {
        const bb = branchAndBound(p, sol);
        lines.push(line(`Branch and bound (${bb.nodes} node${bb.nodes === 1 ? "" : "s"}, depth-first, lowest-index fractional variable first):`));
        for (const l of bb.log) lines.push(line(`  ${l}`));
        if (!bb.complete) {
          lines.push(line(`LP relaxation only; the integer optimum was not searched to completion (node cap ${BB_MAX_NODES}).${bb.best ? ` Best integer point found: ${pointTxt(bb.best.x)}, ${p.objName} = ${txt(bb.best.z)} — not proven optimal.` : ""}`));
        } else if (!bb.best) {
          lines.push(line("No integer point is feasible: the integer program is INFEASIBLE (every branch closed)."));
        } else {
          // verify: feasible, integral, and for two bounded variables an exhaustive lattice check
          if (!feasible(p, bb.best.x) || intVars.some((v) => !rIsInt(bb.best!.x[p.vars.indexOf(v)]))) return refuse(title, "Verification FAILED on the integer optimum — withheld.");
          if (!ratEq(objectiveAt(p, bb.best.x), bb.best.z)) return refuse(title, "Verification FAILED: integer objective re-evaluation — withheld.");
          let extra = "";
          if (n === 2 && p.integer.every(Boolean) && sol.vertices) {
            const lat = latticeOptimum(p, sol.vertices);
            if (lat && lat !== "too-big") {
              if (!ratEq(lat.z, bb.best.z)) return refuse(title, `Verification FAILED: exhaustive lattice search gives ${txt(lat.z)} at ${pointTxt(lat.x)}, branch-and-bound ${txt(bb.best.z)} — withheld.`);
              extra = " Verified against an exhaustive search of the integer points of the feasible region.";
            }
          }
          lines.push(line(`Integer optimum: ${pointTxt(bb.best.x)}, ${p.objName} = ${txt(bb.best.z)}.${extra}`));
          p.vars.forEach((v, j) => lines.push(line(`${v} = ${mth(bb.best!.x[j])}`, true)));
          lines.push(line(`${p.objName} = ${mth(bb.best.z)}`, true));
          integerPoint = bb.best.x;
        }
      }
    }
  }

  // --- caveats: verification, phase 1, notes ---
  if (sol.phase1Ran && mode !== "tableau" && sol.status !== "infeasible") {
    // the rows that needed an artificial variable, AFTER the sign flip (-x <= -1 is x >= 1 to the tableau)
    const artRows = p.rows.filter((r) => (ratSign(r.rhs) < 0 ? r.rel !== ">=" : r.rel !== "<="));
    const rels = artRows.map((r) => (ratSign(r.rhs) < 0 && r.rel === "<=" ? "≥" : RELSYM[r.rel])).filter((v, i, a) => a.indexOf(v) === i);
    const flipped = artRows.filter((r) => ratSign(r.rhs) < 0 && r.rel === "<=").map((r) => `${r.label} is ${rowLabel(r.coeffs.map(ratNeg), p.vars, ">=", ratNeg(r.rhs))} after multiplying by −1`);
    caveats.push(`Phase 1 ran (artificial variable${sol.artificialNames.length > 1 ? "s" : ""} ${sol.artificialNames.join(", ")} for the ${rels.join("/")} constraints${flipped.length ? `: ${flipped.join("; ")}` : ""}), then phase 2 on the original objective.`);
  }
  if (sol.verification.length) caveats.push(`Verified: ${sol.verification.join("; ")}.`);
  if (sol.status === "infeasible" && n === 2 && !sol.infeasibleNames) caveats.push("Independent check: no pair of constraint lines meets at a feasible point.");

  // --- figure ---
  const captionSol = nonnegSol && pNN ? nonnegSol : sol;
  const captionP = nonnegSol && pNN ? pNN : p;
  const caption =
    captionSol.status === "optimal"
      ? `${p.sense === "max" ? "max" : "min"} ${parsed.objectiveText}: ${p.objName}* = ${txt(captionSol.z!)} at ${pointTxt(captionSol.x!)}${nonnegSol ? " (with x ≥ 0)" : ""}`
      : captionSol.status === "unbounded"
        ? `${p.sense === "max" ? "max" : "min"} ${parsed.objectiveText}: unbounded`
        : `${p.sense === "max" ? "max" : "min"} ${parsed.objectiveText}: feasible region empty`;
  const fig = figureFor(captionP, captionSol, caption, integerPoint);
  return { title, lines, caveats, ...(fig ? { svg: fig.svg, alt: fig.alt } : {}) };
}

