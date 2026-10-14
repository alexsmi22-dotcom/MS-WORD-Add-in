/**
 * The shared point-list reader for the interpolation and spline verbs.
 *
 * Every shape a human TYPES (the stats table-feed lesson: layouts people type,
 * not layouts the author imagines):
 *   (1, 2), (2, 3), (4, 7)        pairs, comma / space / "and" separated
 *   (1,2) (2,3) (4,7)
 *   f(2) = 4, f(3) = 9            function values
 *   x: 0, 1, 2; y: 1, 3, 2        columns (":" or "=", lists by comma or space)
 *   x = 0, 1, 2; y = 1, 3, 2
 *   x 1 2 4 y 2 3 7               bare columns ("interpolation table x … y …")
 *   1 2 ⏎ 2 3 ⏎ 4 7               pasted table rows (optional "x y" header)
 *   f(x) = 1/x at x = 1, 2, 4     a function sampled at nodes — EXACTLY, via the
 *                                 CAS (constantRat); a node whose value is not a
 *                                 rational number is refused by name
 *
 * Every coordinate is an exact Rat read with parseRatLiteral — "0.1" is 1/10,
 * never the nearest double. A coordinate that is not a decimal or a fraction is
 * tried as a constant expression (2^3, 1/2 + 1/3) and otherwise refused by name.
 *
 * Duplicate x with different y → refusal naming the x and both y's (no function
 * passes through both). Same x, same y → the duplicate is dropped and SAID.
 * Unsorted x → sorted and SAID. Nothing is silent.
 */
import { Rat, parseRatLiteral, ratEq, ratSign, ratSub, ratInt, ratMake, substituteVar } from "./cas";
import { parseExpr, freeVars, Expr } from "./solve";
import { constantRat, exactSimplify } from "./exact";
import { fmtRat } from "./geometry";

export interface PointList {
  /** Sorted by x, exact. */
  xs: Rat[];
  ys: Rat[];
  shape: "pairs" | "values" | "columns" | "rows" | "function";
  /** Facts the caller must surface: a duplicate dropped, the list sorted. */
  notes: string[];
  /** For the function shape: the sampled expression. */
  fn?: { text: string; expr: Expr; variable: string };
}

export interface PointListRefusal {
  refusal: string;
}

export type PointListResult = PointList | PointListRefusal | null;

export const isPointRefusal = (r: PointListResult): r is PointListRefusal => !!r && "refusal" in r;

/** A typed number: decimal, fraction, scientific. Exactly what parseRatLiteral reads. */
export const NUM_RE_SRC = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?(?:\\s*/\\s*\\d+)?";
const NUM = NUM_RE_SRC;
/** A list of at least two numbers separated by commas and/or spaces. */
const LIST = `${NUM}(?:\\s*,\\s*${NUM}|\\s+${NUM})+`;

/** Normalises the minus glyphs and primes a user types to ASCII. */
export function asciiMath(s: string): string {
  return s.replace(/[−–—]/g, "-").replace(/[′’]/g, "'").replace(/ /g, " ");
}

/** A Rat as an Expr the CAS can substitute (1/2 → div, not the double 0.5). */
export function ratToExprExact(r: Rat): Expr {
  const mag: Rat = ratSign(r) < 0 ? ratMake(-r.n, r.d) : r;
  const body: Expr = mag.d === 1n ? { t: "num", v: Number(mag.n) } : { t: "div", l: { t: "num", v: Number(mag.n) }, r: { t: "num", v: Number(mag.d) } };
  return ratSign(r) < 0 ? { t: "neg", e: body } : body;
}

/**
 * A typed coordinate as an exact rational: parseRatLiteral first, then a
 * constant expression through the CAS (2^3, 1/2 + 1/3, sqrt(4)); null when it
 * is not a rational number (pi, sqrt(2), a letter).
 */
export function readCoordinate(s: string): Rat | null {
  const t = asciiMath(s).trim();
  const lit = parseRatLiteral(t);
  if (lit) return lit;
  try {
    const e = parseExpr(t);
    if (freeVars(e).length) return null;
    return exactRat(e);
  } catch {
    return null;
  }
}

/** constantRat, after the exact simplifier has had its turn (sqrt(4) → 2, sin(0) → 0); null when not rational. */
function exactRat(e: Expr): Rat | null {
  const direct = constantRat(e);
  if (direct) return direct;
  try {
    return constantRat(exactSimplify(e));
  } catch {
    return null;
  }
}

/** Splits a comma/space list of typed numbers. */
function splitList(s: string): string[] {
  return s
    .trim()
    .split(/\s*,\s*|\s+/)
    .filter((x) => x.length > 0);
}

/**
 * Reads the points out of `text`. Returns null when no point list is present
 * (the verb then gives a usage refusal), a refusal when one is present but
 * unusable (a non-numeric coordinate, x repeated with two y's, columns of
 * different length), else the sorted exact list with its notes.
 */
export function readPointList(text: string): PointListResult {
  const t = asciiMath(text);

  // 1. Pairs (a, b) — a coordinate may carry one level of brackets (sqrt(2), (1/2)).
  const pairRe = /\(\s*((?:[^(),]|\([^()]*\))+?)\s*,\s*((?:[^(),]|\([^()]*\))+?)\s*\)/g;
  const pairs: { x: Rat; y: Rat }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(t))) {
    const x = readCoordinate(m[1]);
    const y = readCoordinate(m[2]);
    if (!x || !y) {
      const bad = !x ? m[1].trim() : m[2].trim();
      return { refusal: `The coordinate ${bad} in (${m[1].trim()}, ${m[2].trim()}) is not a number — points need rational coordinates (decimals and fractions are read exactly).` };
    }
    pairs.push({ x, y });
  }
  if (pairs.length) return finish(pairs, "pairs");

  // 2. Function values f(2) = 4, f(3) = 9.
  const valRe = new RegExp(`(?<![A-Za-z0-9_])([A-Za-z])\\s*\\(\\s*(${NUM})\\s*\\)\\s*=\\s*(${NUM})(?![\\d./])`, "g");
  const vals: { x: Rat; y: Rat }[] = [];
  while ((m = valRe.exec(t))) {
    const x = parseRatLiteral(m[2]);
    const y = parseRatLiteral(m[3]);
    if (x && y) vals.push({ x, y });
  }
  if (vals.length) return finish(vals, "values");

  // 3. Columns x: … ; y: …  (also x = …, and the bare "x 1 2 4 y 2 3 7").
  const colRe = (name: string): RegExp => new RegExp(`(?<![A-Za-z0-9_])${name}(?:[-\\s]?(?:values?|coords?|coordinates?|column|list))?\\s*(?:[:=]\\s*|\\s+)(${LIST})`, "gi");
  const longest = (name: string): string[] | null => {
    let best: string[] | null = null;
    const re = colRe(name);
    while ((m = re.exec(t))) {
      const items = splitList(m[1]);
      if (!best || items.length > best.length) best = items;
    }
    return best;
  };
  const xl = longest("x");
  const yl = longest("y");
  if (xl && yl) {
    if (xl.length !== yl.length) return { refusal: `x has ${xl.length} values but y has ${yl.length} — the two lists must pair up.` };
    const pts: { x: Rat; y: Rat }[] = [];
    for (let i = 0; i < xl.length; i++) {
      const x = parseRatLiteral(xl[i]);
      const y = parseRatLiteral(yl[i]);
      if (!x || !y) return { refusal: `The value ${!x ? xl[i] : yl[i]} is not a number.` };
      pts.push({ x, y });
    }
    return finish(pts, "columns");
  }

  // 4. Pasted table rows: lines of exactly two numbers, optional "x y" header.
  const rowRe = new RegExp(`^\\s*(${NUM})[\\s,;\\t]+(${NUM})\\s*$`);
  const rows: { x: Rat; y: Rat }[] = [];
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  let otherLines = 0;
  for (const l of lines) {
    const r = rowRe.exec(l);
    if (r) {
      const x = parseRatLiteral(r[1]);
      const y = parseRatLiteral(r[2]);
      if (x && y) { rows.push({ x, y }); continue; }
    }
    if (!/^\s*x[\s,;\t]+y\s*$/i.test(l)) otherLines++;
  }
  if (rows.length >= 2 && lines.length >= 2) return finish(rows, "rows");

  // 5. A function sampled at nodes: f(x) = expr at x = a, b, c.
  const fnRe = new RegExp(
    `(?<![A-Za-z0-9_])([A-Za-z]\\w*)\\s*\\(\\s*([A-Za-z]\\w*)\\s*\\)\\s*=\\s*(.+?)\\s+(?:at|for|on|using|with)\\s+(?:(?:the\\s+)?(?:nodes?|points?|values?)\\s+)?(?:(?:at\\s+)?\\2\\s*(?:=|in|∈)\\s*)?\\{?\\s*(${LIST})\\s*\\}?`,
    "i",
  );
  const fm = fnRe.exec(t);
  if (fm) {
    const nodes = splitList(fm[4]).map((s) => parseRatLiteral(s));
    if (nodes.every((n): n is Rat => !!n)) {
      const sampled = sampleFunction(fm[3].trim(), fm[2], nodes);
      if ("refusal" in sampled) return sampled;
      const pl = finish(sampled.points, "function");
      if (isPointRefusal(pl) || !pl) return pl;
      pl.fn = { text: fm[3].trim(), expr: sampled.expr, variable: fm[2] };
      return pl;
    }
  }
  void otherLines;
  return null;
}

/**
 * Samples `exprText` at exact nodes through the CAS. Each value must come out
 * as a rational number (constantRat) — f(1) = sin(1) is refused BY NAME rather
 * than replaced by a double under an "exact" heading.
 */
export function sampleFunction(exprText: string, variable: string, nodes: Rat[]): { points: { x: Rat; y: Rat }[]; expr: Expr } | PointListRefusal {
  let expr: Expr;
  try {
    expr = parseExpr(asciiMath(exprText));
  } catch (err) {
    return { refusal: `Couldn't read the function ${exprText}: ${(err as Error).message}` };
  }
  const fv = freeVars(expr).filter((v) => v !== variable);
  if (fv.length) return { refusal: `The function ${exprText} has other symbols (${fv.join(", ")}) besides ${variable} — a function of ${variable} alone can be sampled.` };
  const points: { x: Rat; y: Rat }[] = [];
  const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  for (const x of nodes) {
    // The Expr layer carries doubles: a node beyond 2^53 cannot be substituted exactly.
    if (x.n > SAFE || -x.n > SAFE || x.d > SAFE) return { refusal: `${variable} = ${fmtRat(x)} is too large to substitute into ${exprText} exactly — type the values at the nodes yourself.` };
    const at = substituteVar(expr, variable, ratToExprExact(x));
    const y = exactRat(at);
    if (!y) {
      return { refusal: `${variable} = ${fmtRat(x)}: the value of ${exprText} there is not a rational number, so it cannot be interpolated exactly — type the values yourself (as decimals or fractions, read exactly as typed) if an approximate table is what you mean.` };
    }
    points.push({ x, y });
  }
  return { points, expr };
}

/** Duplicate detection, then the sort — both SAID. */
function finish(pts: { x: Rat; y: Rat }[], shape: PointList["shape"]): PointListResult {
  const notes: string[] = [];
  const kept: { x: Rat; y: Rat }[] = [];
  for (const p of pts) {
    const same = kept.find((q) => ratEq(q.x, p.x));
    if (same) {
      if (ratEq(same.y, p.y)) {
        notes.push(`(${fmtRat(p.x)}, ${fmtRat(p.y)}) was listed twice — kept once.`);
        continue;
      }
      return { refusal: `x = ${fmtRat(p.x)} appears twice (y = ${fmtRat(same.y)} and y = ${fmtRat(p.y)}): no function passes through both.` };
    }
    kept.push(p);
  }
  const sorted = kept.slice().sort((a, b) => ratSign(ratSub(a.x, b.x)));
  const moved = sorted.some((p, i) => p !== kept[i]);
  if (moved) notes.push(`Points sorted by x (typed order was x = ${kept.map((p) => fmtRat(p.x)).join(", ")}).`);
  return { xs: sorted.map((p) => p.x), ys: sorted.map((p) => p.y), shape, notes };
}

/** The exact integer 0 and 1 as Rat, for callers that build matrices. */
export const R0: Rat = ratInt(0);
export const R1: Rat = ratInt(1);
