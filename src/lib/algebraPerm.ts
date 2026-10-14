// Permutations — the object behind S_n, cycle notation and composition
// (v2.134.0, SCOPE-ABSTRACT-ALGEBRA §C.1).
//
// A permutation of degree n is an array p of length n with p[i] = the image
// of point i + 1 (0-based storage, points printed from 1). Every verb that
// can be checked two ways is: order by lcm of cycle lengths AND by iterating
// the composition; sign by transposition count AND by inversion count of the
// one-line form; a printed cycle string is re-parsed and compared point by
// point before it is shown (the display contract, enforced at run time).
//
// COMPOSITION CONVENTION. A product typed σ τ is read as functions, right to
// left: τ is applied first, (σ τ)(i) = σ(τ(i)). "left to right" in the input
// switches it. Every composition result says which convention was used.

import { DiscreteError } from "./discrete";

export const MAX_DEGREE = 30;

export type Perm = number[];

export function identityPerm(n: number): Perm {
  return Array.from({ length: n }, (_, i) => i);
}

/** Pads p with fixed points up to degree n. */
export function extendPerm(p: Perm, n: number): Perm {
  const out = p.slice();
  for (let i = p.length; i < n; i++) out.push(i);
  return out;
}

/** a ∘ b — apply b first, then a (right to left). Degrees are padded to the larger. */
export function composePerm(a: Perm, b: Perm): Perm {
  const n = Math.max(a.length, b.length);
  const A = extendPerm(a, n), B = extendPerm(b, n);
  return B.map((bi) => A[bi]);
}

export function inversePerm(p: Perm): Perm {
  const out = new Array<number>(p.length);
  p.forEach((v, i) => { out[v] = i; });
  return out;
}

export function isIdentity(p: Perm): boolean {
  return p.every((v, i) => v === i);
}

export function permEqual(a: Perm, b: Perm): boolean {
  const n = Math.max(a.length, b.length);
  const A = extendPerm(a, n), B = extendPerm(b, n);
  return A.every((v, i) => v === B[i]);
}

/** p^k for any integer k (negative = powers of the inverse); k is reduced mod the order first. */
export function powerPerm(p: Perm, k: number): Perm {
  const ord = permOrderLcm(p);
  let e = ((k % ord) + ord) % ord;
  let result = identityPerm(p.length);
  let base = p.slice();
  while (e > 0) {
    if (e & 1) result = composePerm(base, result);
    base = composePerm(base, base);
    e >>= 1;
  }
  return result;
}

/** Non-trivial cycles, 0-based, each starting at its smallest point, ordered by that point. */
export function permCycles(p: Perm): number[][] {
  const seen = new Array<boolean>(p.length).fill(false);
  const out: number[][] = [];
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    const c: number[] = [];
    let j = i;
    while (!seen[j]) { seen[j] = true; c.push(j); j = p[j]; }
    if (c.length > 1) out.push(c);
  }
  return out;
}

/** "(1 2 3)(4 5)", or "e" for the identity. */
export function cycleString(p: Perm): string {
  const cs = permCycles(p);
  if (!cs.length) return "e";
  return cs.map((c) => "(" + c.map((v) => v + 1).join(" ") + ")").join("");
}

/** Cycle lengths ≥ 2, largest first: (1 2 3)(4 5) → [3, 2]; the identity → []. */
export function cycleType(p: Perm): number[] {
  return permCycles(p).map((c) => c.length).sort((a, b) => b - a);
}

function gcdN(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}
export function lcmN(a: number, b: number): number {
  return (a / gcdN(a, b)) * b;
}

export function permOrderLcm(p: Perm): number {
  return cycleType(p).reduce((m, l) => lcmN(m, l), 1);
}

/** The order found by composing p with itself until the identity (independent of the cycle decomposition). */
export function permOrderIterated(p: Perm): number {
  let q = p.slice();
  let k = 1;
  while (!isIdentity(q)) {
    q = composePerm(p, q);
    k++;
    if (k > 1_000_000) throw new DiscreteError("A permutation order exceeded 10⁶ while iterating — a defect in this tool.");
  }
  return k;
}

/** (a1 a2 … ak) = (a1 ak)(a1 a(k−1))…(a1 a2), right to left; 1-based pairs. */
export function transpositions(p: Perm): [number, number][] {
  const out: [number, number][] = [];
  for (const c of permCycles(p)) {
    for (let j = c.length - 1; j >= 1; j--) out.push([c[0] + 1, c[j] + 1]);
  }
  return out;
}

export function signByTranspositions(p: Perm): number {
  return transpositions(p).length % 2 === 0 ? 1 : -1;
}

export function signByInversions(p: Perm): number {
  let inv = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inv++;
  return inv % 2 === 0 ? 1 : -1;
}

/** Sign by both counts; they must agree. */
export function permSign(p: Perm): number {
  const a = signByTranspositions(p), b = signByInversions(p);
  if (a !== b) throw new DiscreteError(`Cross-check failed: the sign of ${cycleString(p)} by transpositions (${a}) and by inversions (${b}) disagree — a defect in this tool, so nothing is printed.`);
  return a;
}

export function permOrder(p: Perm): number {
  const a = permOrderLcm(p), b = permOrderIterated(p);
  if (a !== b) throw new DiscreteError(`Cross-check failed: the order of ${cycleString(p)} by lcm (${a}) and by iteration (${b}) disagree — a defect in this tool.`);
  return a;
}

/** The largest moved point (1-based), or 0 for the identity. */
export function largestMoved(p: Perm): number {
  for (let i = p.length - 1; i >= 0; i--) if (p[i] !== i) return i + 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Reading

export interface PermFactor {
  perm: Perm;
  text: string;
}

export interface ParsedPermProduct {
  factors: PermFactor[];
  /** Largest point named anywhere (the degree read). */
  degree: number;
  notes: string[];
}

const CYCLE_TOKEN = /\(\s*[^()]*\)/y;

/**
 * Reads a product of cycles: `(1 2 3)(4 5)`, `(1,2,3)(4,5)`, `(1 2 3) * (1 2)`,
 * `(1 2 3) ∘ (1 2)`, `(12)(34)` (one digit per point, said), `e`, `id`, `()`,
 * each factor optionally raised `^k` / `^-1`. Returns null when the text is not
 * entirely such a product. Throws DiscreteError for a recognised product that
 * is malformed (a repeated point inside one cycle, point 0, a point above 30).
 */
export function parsePermProduct(text: string): ParsedPermProduct | null {
  const s = text.trim();
  if (!s) return null;
  // Syntax first, semantics second: a text that is not ENTIRELY a product of
  // cycles is null — never a refusal about one of its pieces ("(4, 0), z = 20"
  // is an LP answer, not a cycle naming the point 0).
  const CYC = String.raw`\(\s*(?:\d+(?:\s*,\s*\d+|\s+\d+)*)?\s*\)`;
  const FACTOR = String.raw`(?:${CYC}|e|id)(?:\s*\^\s*\(?\s*-?\d{1,9}\s*\)?)?`;
  if (!new RegExp(String.raw`^${FACTOR}(?:\s*[*∘·]?\s*${FACTOR})*$`).test(s)) return null;
  const factors: PermFactor[] = [];
  const notes: string[] = [];
  let degree = 0;
  let i = 0;
  const skipWs = (): void => { while (i < s.length && /\s/.test(s[i])) i++; };
  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;
    if (factors.length && (s[i] === "*" || s[i] === "∘" || s[i] === "·")) { i++; skipWs(); }
    let perm: Perm;
    let ftext: string;
    if (s[i] === "(") {
      CYCLE_TOKEN.lastIndex = i;
      const m = CYCLE_TOKEN.exec(s);
      if (!m) return null;
      ftext = m[0];
      i += m[0].length;
      const body = ftext.slice(1, -1).trim();
      if (!body) { perm = []; }
      else {
        if (!/^\d+(?:\s*,\s*\d+|\s+\d+)*$/.test(body)) return null;
        let pts: number[];
        const toks = body.split(/[\s,]+/).filter(Boolean);
        if (toks.length === 1 && toks[0].length >= 2) {
          pts = toks[0].split("").map(Number);
          if (toks[0].length === 2) notes.push(`(${toks[0]}) read as the transposition of ${pts[0]} and ${pts[1]}, one digit per point; for points ≥ 10 write spaces or commas.`);
          else notes.push(`(${toks[0]}) read as the cycle ${pts.join(" → ")} → ${pts[0]}, one digit per point; for points ≥ 10 write spaces or commas.`);
        } else {
          pts = toks.map((t) => (t.length > 4 ? Infinity : Number(t)));
        }
        for (const v of pts) {
          if (v === 0) throw new DiscreteError("Points of a permutation are numbered from 1 — the cycle " + ftext + " names 0.");
          if (v > MAX_DEGREE) throw new DiscreteError(`The cycle ${ftext} names the point ${Number.isFinite(v) ? v : toks.find((t) => t.length > 4)} — permutations are read up to degree ${MAX_DEGREE} (the cap, checked before any work).`);
        }
        const dup = pts.find((v, k) => pts.indexOf(v) !== k);
        if (dup !== undefined) throw new DiscreteError(`The cycle ${ftext} repeats the point ${dup} — a cycle lists each point once. Write a product of cycles instead, e.g. (1 2)(2 1).`);
        const n = Math.max(...pts);
        perm = identityPerm(n);
        if (pts.length >= 2) for (let k = 0; k < pts.length; k++) perm[pts[k] - 1] = pts[(k + 1) % pts.length] - 1;
        degree = Math.max(degree, n);
      }
    } else {
      const m = /^(?:e|id)(?![\w(])/.exec(s.slice(i));
      if (!m) return null;
      ftext = m[0];
      i += m[0].length;
      perm = [];
    }
    skipWs();
    const pm = /^\^\s*\(?\s*(-?\d{1,9})\s*\)?/.exec(s.slice(i));
    if (pm) {
      const k = Number(pm[1]);
      perm = powerPerm(perm, k);
      ftext += "^" + k;
      i += pm[0].length;
    }
    factors.push({ perm, text: ftext });
  }
  if (!factors.length) return null;
  return { factors, degree, notes };
}

/** Composes the factors of a parsed product. rightToLeft: the rightmost factor acts first. */
export function composeFactors(factors: Perm[], degree: number, rightToLeft = true): Perm {
  let acc = identityPerm(degree);
  if (rightToLeft) for (const f of factors) acc = composePerm(acc, extendPerm(f, degree));
  else for (const f of factors) acc = composePerm(extendPerm(f, degree), acc);
  return extendPerm(acc, degree);
}

/** Reads a one-line form "2 3 1" (image of 1, 2, 3, …). Throws on a non-permutation. */
export function parseOneLine(text: string): Perm | null {
  const toks = text.trim().split(/[\s,]+/).filter(Boolean);
  if (toks.length < 1 || !toks.every((t) => /^\d+$/.test(t))) return null;
  if (toks.length > MAX_DEGREE) throw new DiscreteError(`A one-line permutation of ${toks.length} points is above the degree cap of ${MAX_DEGREE}.`);
  const v = toks.map(Number);
  const n = v.length;
  const sorted = v.slice().sort((a, b) => a - b);
  if (!sorted.every((x, i) => x === i + 1)) {
    throw new DiscreteError(`"${toks.join(" ")}" is not a permutation of 1…${n}: a one-line form lists each of 1, …, ${n} exactly once.`);
  }
  return v.map((x) => x - 1);
}

/**
 * The display contract, at run time: re-read a printed cycle string and
 * compare it point by point with the permutation it claims to show.
 */
export function assertPermRoundTrip(printed: string, p: Perm): void {
  const back = parsePermProduct(printed);
  const ok = !!back && permEqual(composeFactors(back.factors.map((f) => f.perm), Math.max(back.degree, p.length)), extendPerm(p, Math.max(back.degree, p.length)));
  if (!ok) throw new DiscreteError(`Display check failed: "${printed}" does not read back as the permutation computed — a defect in this tool, so nothing is printed.`);
}

/** Two-row form: images of 1…n, n = degree. */
export function oneLine(p: Perm): string {
  return p.map((v) => v + 1).join(" ");
}
