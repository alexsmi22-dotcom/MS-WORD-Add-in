// Cobordism as a RING — SCOPE-NUMERICS-TOPOLOGY §B3.
//
// WHY A RING. The defect this file closes: "does RP^2 # RP^2 bound" answered
// with the verdict for RP^2, because the old route read the FIRST "rp^n" in
// the question. A connected sum is a SUM in the cobordism ring (M # N is
// cobordant to M ⊔ N) and a product is a PRODUCT, so a manifold expression is
// parsed into a formal sum of products of generators, and every characteristic
// number is computed for the element it actually names.
//
// HOW THE NUMBERS ARE COMPUTED. Each generator carries the part of its
// cohomology ring that its characteristic classes live in, as a truncated
// monomial ring (ℝPⁿ: 𝔽₂[a]/(aⁿ⁺¹); ℂPⁿ: [x]/(xⁿ⁺¹); the Wu manifold:
// 𝔽₂[x₂, x₃]/(x₂², x₃²)), with its total Stiefel–Whitney class and its total
// Pontryagin class (rational; torsion dropped). A product lives in the tensor
// product ring, w(M×N) = w(M)·w(N) and p(M×N) = p(M)·p(N) (mod 2-torsion), and
// a characteristic number is the coefficient of the top monomial. Partitions
// are walked depth-first so each step reuses its parent's running product, and
// every monomial multiplication is counted against a hard budget.
//
// VERDICTS.
//   * Unoriented (all elements): bounds ⇔ every SW number vanishes (Thom 1954 —
//     complete).
//   * Oriented (orientable elements only): Pontryagin numbers; the signature by
//     Hirzebruch's L-genus; the class in Ω^SO_n decided only for n ≤ 8, where
//     the groups are a CITED table and Pontryagin + SW numbers are complete
//     (Wall 1960). Beyond 8 a NONZERO number still proves "does not bound" —
//     that direction needs no table — but "bounds" is refused by name.
//
// CROSS-CHECKS, each independent of the number computation, each a refusal on
// disagreement:
//   1. the top SW number wₙ[M] equals χ(M) mod 2, with χ tracked STRUCTURALLY
//      (multiplicative under ×, additive under ⊔, χ(M)+χ(N)−χ(Sⁿ) under #);
//   2. the signature from the L-genus equals the signature tracked structurally
//      (multiplicative under ×, additive under # and ⊔, negated by −, from the
//      intersection form of each generator);
//   3. a single product term bounds (unoriented) iff one of its factors does —
//      𝔑_* is a polynomial ring, hence an integral domain (Thom);
//   4. a group that the cited table says is 0 must see only zero numbers;
//   5. coordinates in Ω₄ and Ω₈ must come out INTEGERS in the cited basis.
//
// ℍPⁿ IS NOT A GENERATOR this release: its Pontryagin class formula
// (Borel–Hirzebruch 1958 §15) could not be confirmed against the source, and
// the brief's rule is that an unconfirmed citation is dropped, not shipped.

// Import cycle with topology2 (it calls realProjectiveSwNumbers here): every
// use on both sides is at call time, never at module load.
import { partitions, binomialMod2, binomial, realProjectiveCobordism } from "./topology2";
import { normaliseTopologyText, sup } from "./kReal";

// ---------------------------------------------------------------------------
// Small exact arithmetic
// ---------------------------------------------------------------------------

const babs = (a: bigint): bigint => (a < 0n ? -a : a);
const bgcd = (a: bigint, b: bigint): bigint => {
  a = babs(a); b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

/** An exact rational, always normalised (d > 0, gcd 1). */
export interface Rat { n: bigint; d: bigint }
export const rat = (n: bigint, d: bigint = 1n): Rat => {
  if (d === 0n) throw new Error("division by zero in an exact rational");
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const radd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const rmul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
const rneg = (a: Rat): Rat => ({ n: -a.n, d: a.d });
const RZERO: Rat = { n: 0n, d: 1n };
/** An integer for display: the minus sign is U+2212, never ASCII '-'. */
export const num = (v: bigint): string => (v < 0n ? `−${-v}` : String(v));
export const ratStr = (r: Rat): string => (r.d === 1n ? num(r.n) : `${num(r.n)}/${r.d}`);
/** "a·[X] + b·[Y]" with a true minus when b < 0: "1·[X] − 16·[Y]". */
const combo = (a: bigint, x: string, b: bigint, y: string): string =>
  `${num(a)}·[${x}] ${b < 0n ? "−" : "+"} ${b < 0n ? -b : b}·[${y}]`;

const SUBS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const subscript = (n: number): string => Array.from(String(n)).map((c) => SUBS[+c] ?? c).join("");

// ---------------------------------------------------------------------------
// Multiplicative sequences (L-genus) by exp ∘ log, from Bernoulli numbers
// ---------------------------------------------------------------------------

/** Bernoulli numbers B₀…B_m (B₁ = −1/2), by Σ_{k≤m} C(m+1, k) B_k = 0. */
function bernoulli(m: number): Rat[] {
  const B: Rat[] = [rat(1n)];
  for (let k = 1; k <= m; k++) {
    let s = RZERO;
    for (let j = 0; j < k; j++) s = radd(s, rmul(rat(binomial(k + 1, j)), B[j]));
    B.push(rat(-s.n, s.d * BigInt(k + 1)));
  }
  return B;
}

const factorialB = (n: number): bigint => {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
};

/** A polynomial in p₁, p₂, … keyed by its partition ("2,1,1" = p₂p₁²). */
type PPoly = Map<string, Rat>;
const pkey = (parts: number[]): string => parts.slice().sort((a, b) => b - a).join(",");
const pweight = (key: string): number => (key ? key.split(",").reduce((s, x) => s + +x, 0) : 0);

function ppAdd(a: PPoly, b: PPoly, scale: Rat = rat(1n)): PPoly {
  const out: PPoly = new Map(a);
  for (const [k, v] of b) {
    const nv = radd(out.get(k) ?? RZERO, rmul(v, scale));
    if (nv.n === 0n) out.delete(k); else out.set(k, nv);
  }
  return out;
}
function ppMul(a: PPoly, b: PPoly, maxW: number): PPoly {
  const out: PPoly = new Map();
  for (const [ka, va] of a) {
    for (const [kb, vb] of b) {
      if (pweight(ka) + pweight(kb) > maxW) continue;
      const parts = [...(ka ? ka.split(",").map(Number) : []), ...(kb ? kb.split(",").map(Number) : [])];
      const k = pkey(parts);
      const nv = radd(out.get(k) ?? RZERO, rmul(va, vb));
      if (nv.n === 0n) out.delete(k); else out.set(k, nv);
    }
  }
  return out;
}

const L_CACHE = new Map<number, PPoly[]>();
/** Hirzebruch's largest weight here: dim 40 = weight 10. */
export const MAX_L_WEIGHT = 10;

/**
 * The L-polynomials L₁…L_K in the Pontryagin classes, derived — not typed in —
 * from the characteristic series Q(z) = √z / tanh √z:
 *   ∏ Q(zᵢ) = exp(Σ_j g_j s_j), g = log Q, s_j = Σ zᵢ^j by Newton's identities
 *   in the elementary symmetric functions p_i. Pinned against Milnor–Stasheff
 *   §19's L₁, L₂, L₃ in the tests.
 */
export function lPolynomials(K: number = MAX_L_WEIGHT): PPoly[] {
  K = Math.max(1, Math.min(MAX_L_WEIGHT, Math.floor(K)));
  const hit = L_CACHE.get(K);
  if (hit) return hit;
  const B = bernoulli(2 * K);
  // Q(z) = Σ 2^{2j} B_{2j} z^j / (2j)!
  const f: Rat[] = [];
  for (let j = 0; j <= K; j++) f.push(rmul(B[2 * j], rat(1n << BigInt(2 * j), factorialB(2 * j))));
  // g = log f, f₀ = 1: g_k = f_k − (1/k) Σ_{i<k} i g_i f_{k−i}
  const g: Rat[] = [RZERO];
  for (let k = 1; k <= K; k++) {
    let s = RZERO;
    for (let i = 1; i < k; i++) s = radd(s, rmul(rat(BigInt(i)), rmul(g[i], f[k - i])));
    g.push(radd(f[k], rneg(rmul(s, rat(1n, BigInt(k))))));
  }
  // Newton: s_k = (−1)^{k−1} k e_k + Σ_{i=1}^{k−1} (−1)^{i−1} e_i s_{k−i}
  const s: PPoly[] = [new Map()];
  for (let k = 1; k <= K; k++) {
    let sk: PPoly = new Map([[String(k), rat(BigInt((k % 2 === 1 ? 1 : -1) * k))]]);
    for (let i = 1; i < k; i++) {
      const ei: PPoly = new Map([[String(i), rat(i % 2 === 1 ? 1n : -1n)]]);
      sk = ppAdd(sk, ppMul(ei, s[k - i], K));
    }
    s.push(sk);
  }
  let X: PPoly = new Map();
  for (let j = 1; j <= K; j++) X = ppAdd(X, s[j], g[j]);
  // exp(X) = Σ X^m / m!, X has no constant term, so m ≤ K suffices.
  let total: PPoly = new Map([["", rat(1n)]]);
  let power: PPoly = new Map([["", rat(1n)]]);
  for (let m = 1; m <= K; m++) {
    power = ppMul(power, X, K);
    total = ppAdd(total, power, rat(1n, factorialB(m)));
  }
  const out: PPoly[] = [];
  for (let k = 0; k <= K; k++) {
    const part: PPoly = new Map();
    for (const [key, v] of total) if (pweight(key) === k) part.set(key, v);
    out.push(part);
  }
  L_CACHE.set(K, out);
  return out;
}

/** "(7p₂ − p₁²)/45" style display of L_k. */
export function formatLPolynomial(k: number): string {
  const Lk = lPolynomials(Math.max(k, 1))[k];
  let den = 1n;
  for (const v of Lk.values()) den = (den * v.d) / bgcd(den, v.d);
  const terms = [...Lk.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, v]) => {
      const c = (v.n * den) / v.d;
      const mono = pMonoName(key.split(",").map(Number));
      const mag = babs(c) === 1n ? "" : String(babs(c));
      return { neg: c < 0n, text: `${mag}${mono}` };
    });
  const body = terms.map((t, i) => (i === 0 ? (t.neg ? "−" : "") + t.text : (t.neg ? " − " : " + ") + t.text)).join("");
  if (den === 1n) return body;
  return terms.length === 1 && !terms[0].neg ? `${body}/${den}` : `(${body})/${den}`;
}

const groupedName = (sym: string, parts: number[]): string => {
  if (!parts.length) return "1";
  const counts = new Map<number, number>();
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([p, c]) => `${sym}${subscript(p)}${c > 1 ? sup(c) : ""}`)
    .join("");
};
const pMonoName = (parts: number[]): string => groupedName("p", parts);
const wMonoName = (parts: number[]): string => groupedName("w", parts);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface Mono { e: number[]; c: bigint }
type Poly = Map<string, Mono>;

export interface Generator {
  key: string;
  /** Display, in notation the parser reads back. */
  name: string;
  dim: number;
  orientable: boolean;
  /** Degrees of the ring generators. */
  degs: number[];
  /** Exponents of the top (fundamental) monomial. */
  top: number[];
  /** Total SW class, monomials with coefficient 1 (mod 2). */
  w: number[][];
  /** Total Pontryagin class (rational; 2-torsion dropped). */
  p: { e: number[]; c: bigint }[];
  chi: bigint;
  /** Signature from the intersection form (0 when dim ≢ 0 mod 4). */
  sigma: bigint;
  cite?: string;
}

/**
 * 40 = topology2's MAX_PARTITION_N. A LITERAL, not a reference: topology2 and
 * this file import each other, and a top-level read of the other module's
 * export is undefined under whichever load order comes second. A test pins the
 * two equal.
 */
export const MAX_COBORDISM_DIM = 40;

function rpGen(n: number): Generator {
  const w: number[][] = [];
  for (let k = 0; k <= n; k++) if (binomialMod2(n + 1, k)) w.push([k]);
  return {
    key: `RP^${n}`, name: `ℝP${sup(n)}`, dim: n, orientable: n % 2 === 1,
    degs: [1], top: [n], w, p: [{ e: [0], c: 1n }],
    chi: n % 2 === 0 ? 1n : 0n, sigma: 0n,
  };
}
function cpGen(n: number): Generator {
  const w: number[][] = [];
  for (let k = 0; k <= n; k++) if (binomialMod2(n + 1, k)) w.push([k]);
  const p: { e: number[]; c: bigint }[] = [];
  for (let j = 0; 2 * j <= n; j++) p.push({ e: [2 * j], c: binomial(n + 1, j) });
  return {
    key: `CP^${n}`, name: `ℂP${sup(n)}`, dim: 2 * n, orientable: true,
    degs: [2], top: [n], w, p, chi: BigInt(n + 1), sigma: n % 2 === 0 ? 1n : 0n,
  };
}
const sphereGen = (n: number): Generator => ({
  key: `S^${n}`, name: `S${sup(n)}`, dim: n, orientable: true,
  degs: [n], top: [1], w: [[0]], p: [{ e: [0], c: 1n }],
  chi: n % 2 === 0 ? 2n : 0n, sigma: 0n,
});
const torusGen = (n: number): Generator => ({
  key: `T^${n}`, name: `T${sup(n)}`, dim: n, orientable: true,
  degs: [n], top: [1], w: [[0]], p: [{ e: [0], c: 1n }],
  chi: 0n, sigma: 0n,
});
const K3: Generator = {
  key: "K3", name: "K3", dim: 4, orientable: true,
  degs: [4], top: [1], w: [[0]], p: [{ e: [0], c: 1n }, { e: [1], c: -48n }],
  chi: 24n, sigma: -16n,
  cite: "K3 surface: p₁ = −48, σ = −16, χ = 24, spin (w₂ = 0) — CITED (intersection form 2(−E₈) ⊕ 3H; Milnor–Husemoller, Symmetric Bilinear Forms; Kodaira), not computed.",
};
const WU: Generator = {
  key: "Wu", name: "Wu", dim: 5, orientable: true,
  degs: [2, 3], top: [1, 1], w: [[0, 0], [1, 0], [0, 1]], p: [{ e: [0, 0], c: 1n }],
  chi: 0n, sigma: 0n,
  cite: "Wu manifold SU(3)/SO(3): H*(·; 𝔽₂) has classes in degrees 0, 2, 3, 5 with w = 1 + w₂ + w₃ and w₂w₃ ≠ 0 (the de Rham invariant); it generates Ω₅ˢᴼ = ℤ/2 — CITED (Wall 1960; Manifold Atlas \"Wu manifold\").",
};
const POINT: Generator = {
  key: "pt", name: "pt", dim: 0, orientable: true,
  degs: [], top: [], w: [[]], p: [{ e: [], c: 1n }], chi: 1n, sigma: 1n,
};

// ---------------------------------------------------------------------------
// Elements of the cobordism ring
// ---------------------------------------------------------------------------

export interface Term { coef: bigint; gens: Generator[] }

export interface CobordismElement {
  /** Display, in notation the parser reads back. */
  name: string;
  dim: number;
  orientable: boolean;
  terms: Term[];
  /** Structural invariants, tracked through the operations (cross-checks). */
  chi: bigint;
  sigma: bigint;
  /** Notes the parser adds ("ℝP² # ℝP² is the Klein bottle"). */
  notes: string[];
  cites: string[];
}

const MAX_TERMS = 64;
const MAX_FACTORS = 12;

const fromGen = (g: Generator): CobordismElement => ({
  name: g.name, dim: g.dim, orientable: g.orientable, terms: [{ coef: 1n, gens: [g] }],
  chi: g.chi, sigma: g.sigma, notes: [], cites: g.cite ? [g.cite] : [],
});

const mergeNotes = (a: CobordismElement, b: CobordismElement) => ({
  notes: [...new Set([...a.notes, ...b.notes])],
  cites: [...new Set([...a.cites, ...b.cites])],
});

function multiply(a: CobordismElement, b: CobordismElement): CobordismElement | { error: string } {
  if (a.dim + b.dim > MAX_COBORDISM_DIM) {
    return { error: `The product has dimension ${a.dim + b.dim}; characteristic numbers are computed up to dimension ${MAX_COBORDISM_DIM}.` };
  }
  const terms: Term[] = [];
  for (const s of a.terms) for (const t of b.terms) {
    const gens = [...s.gens, ...t.gens].filter((g) => g.key !== "pt");
    if (gens.length > MAX_FACTORS) return { error: `More than ${MAX_FACTORS} factors in one product.` };
    terms.push({ coef: s.coef * t.coef, gens });
  }
  if (terms.length > MAX_TERMS) return { error: `The expression expands to more than ${MAX_TERMS} products.` };
  const wrap = (x: CobordismElement) => (x.name.includes(" # ") || x.name.includes(" + ") || x.name.includes(" − ") ? `(${x.name})` : x.name);
  return {
    name: `${wrap(a)} × ${wrap(b)}`, dim: a.dim + b.dim, orientable: a.orientable && b.orientable,
    terms, chi: a.chi * b.chi, sigma: a.sigma * b.sigma, ...mergeNotes(a, b),
  };
}

function add(a: CobordismElement, b: CobordismElement, op: "#" | "+" | "-"): CobordismElement | { error: string } {
  if (a.dim !== b.dim) {
    const what = op === "#" ? "connected sum" : op === "+" ? "disjoint union (a sum in the cobordism ring)" : "difference";
    return { error: `Dimension ${a.dim} vs ${b.dim} — a ${what} needs equal dimensions (${a.name} has dimension ${a.dim}, ${b.name} has ${b.dim}).` };
  }
  if (op === "#" && a.dim === 0) return { error: "A connected sum of 0-manifolds is not defined." };
  if (op === "-" && !b.orientable) {
    return { error: `${b.name} is not orientable — orientation reversal (−) does not apply. In unoriented cobordism every class is its own negative, so write + instead.` };
  }
  const bt = op === "-" ? b.terms.map((t) => ({ coef: -t.coef, gens: t.gens })) : b.terms;
  const terms = [...a.terms, ...bt];
  if (terms.length > MAX_TERMS) return { error: `The expression expands to more than ${MAX_TERMS} products.` };
  // χ(M # N) = χ(M) + χ(N) − χ(Sⁿ): two n-balls are removed and a cylinder glued.
  const chiS = a.dim % 2 === 0 ? 2n : 0n;
  const sym = op === "#" ? " # " : op === "+" ? " + " : " − ";
  // "A − (B # C)" must keep its parentheses or it re-parses as (A − B) # C.
  const bName = op === "-" && /[#+−]/.test(b.name) ? `(${b.name})` : b.name;
  return {
    name: `${a.name}${sym}${bName}`, dim: a.dim, orientable: a.orientable && b.orientable, terms,
    chi: op === "#" ? a.chi + b.chi - chiS : a.chi + b.chi,
    sigma: op === "-" ? a.sigma - b.sigma : a.sigma + b.sigma,
    ...mergeNotes(a, b),
  };
}

function negate(a: CobordismElement): CobordismElement | { error: string } {
  if (!a.orientable) {
    return { error: `${a.name} is not orientable — orientation reversal (−) does not apply. In unoriented cobordism every class is its own negative.` };
  }
  return {
    ...a, name: a.name.includes(" ") ? `−(${a.name})` : `−${a.name}`,
    terms: a.terms.map((t) => ({ coef: -t.coef, gens: t.gens })), sigma: -a.sigma,
  };
}

// ---------------------------------------------------------------------------
// Parsing manifold expressions
// ---------------------------------------------------------------------------

/** Names the parser knows, for the refusal that lists them. */
export const KNOWN_MANIFOLDS =
  "ℝPⁿ, ℂPⁿ (and −ℂPⁿ), Sⁿ, Tⁿ, torus, Klein bottle, Wu (SU(3)/SO(3)), K3, pt — combined with × (product), # (connected sum), + (disjoint union), − (reversed orientation), and parentheses";

type Tok =
  | { t: "gen"; el: CobordismElement }
  | { t: "int"; v: bigint }
  | { t: "op"; v: "#" | "+" | "-" | "x" | "(" | ")" };

function tokenize(s: string): Tok[] | { error: string } {
  const toks: Tok[] = [];
  let i = 0;
  const idx = (d: string, cap: number, what: string): number | { error: string } => {
    const n = d.length > 6 ? Infinity : parseInt(d, 10);
    if (!(n <= cap)) return { error: `${what} with index ${d} is outside the computed range (dimension ≤ ${MAX_COBORDISM_DIM}).` };
    return n;
  };
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue; }
    if ((m = /^[#+()*·⋅-]/.exec(rest))) {
      const c = m[0] === "*" || m[0] === "·" || m[0] === "⋅" ? "x" : m[0];
      toks.push({ t: "op", v: c as "#" });
      i += 1; continue;
    }
    if ((m = /^x(?![a-z0-9])/.exec(rest))) { toks.push({ t: "op", v: "x" }); i += 1; continue; }
    if ((m = /^(?:the )?klein(?: bottle)?/.exec(rest))) {
      const rp2 = fromGen(rpGen(2));
      const k = add(rp2, rp2, "#") as CobordismElement;
      k.name = "Klein bottle";
      k.notes = ["The Klein bottle is ℝP² # ℝP² — computed as that connected sum."];
      toks.push({ t: "gen", el: k }); i += m[0].length; continue;
    }
    if ((m = /^(?:the )?wu(?: manifold)?|^su\s*\(?3\)?\s*\/\s*so\s*\(?3\)?/.exec(rest))) {
      toks.push({ t: "gen", el: fromGen(WU) }); i += m[0].length; continue;
    }
    if ((m = /^k3(?: surface)?/.exec(rest))) { toks.push({ t: "gen", el: fromGen(K3) }); i += m[0].length; continue; }
    if ((m = /^(?:a )?(?:point|pt)\b/.exec(rest))) { toks.push({ t: "gen", el: fromGen(POINT) }); i += m[0].length; continue; }
    if ((m = /^(?:the )?torus\b/.exec(rest))) { toks.push({ t: "gen", el: fromGen(torusGen(2)) }); i += m[0].length; continue; }
    if ((m = /^(?:the )?circle\b/.exec(rest))) { toks.push({ t: "gen", el: fromGen(sphereGen(1)) }); i += m[0].length; continue; }
    // Spheres and tori by name: "the sphere" (S²), "the 3-sphere", "3-torus".
    if ((m = /^(?:the )?(?:(\d{1,2})-)?sphere\b/.exec(rest))) {
      const n = m[1] ? parseInt(m[1], 10) : 2;
      if (n > MAX_COBORDISM_DIM) return { error: `S${sup(n)} is outside the computed range (dimension ≤ ${MAX_COBORDISM_DIM}).` };
      if (n === 0) return { error: "Write the 0-sphere as S⁰ (two points)." };
      toks.push({ t: "gen", el: fromGen(sphereGen(n)) });
      i += m[0].length; continue;
    }
    if ((m = /^(?:the )?(\d{1,2})-torus\b/.exec(rest))) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > MAX_COBORDISM_DIM) return { error: `T${sup(n)} is outside the computed range.` };
      toks.push({ t: "gen", el: fromGen(torusGen(n)) }); i += m[0].length; continue;
    }
    if ((m = /^(?:the )?(?:real )?projective plane\b/.exec(rest))) { toks.push({ t: "gen", el: fromGen(rpGen(2)) }); i += m[0].length; continue; }
    if ((m = /^(rp|cp|hp|s|t)\s*\^?\s*\{?(\d+)\}?(\s*-?\s*bar\b|\s*conj(?:ugate)?\b)?/.exec(rest))) {
      const kind = m[1];
      const bar = !!m[3];
      if (kind === "hp") {
        return {
          error: "ℍPⁿ is not computed here: the formula for its Pontryagin class (attributed to Borel and Hirzebruch, 1958) could not be confirmed against the source, so no numbers are given for it.",
        };
      }
      const n = idx(m[2], kind === "cp" ? MAX_COBORDISM_DIM / 2 : MAX_COBORDISM_DIM, ({ rp: "ℝPⁿ", cp: "ℂPⁿ", s: "Sⁿ", t: "Tⁿ" } as Record<string, string>)[kind] ?? kind);
      if (typeof n !== "number") return n;
      let el: CobordismElement;
      if (kind === "rp") el = n === 0 ? fromGen(POINT) : fromGen(rpGen(n));
      else if (kind === "cp") el = n === 0 ? fromGen(POINT) : fromGen(cpGen(n));
      else if (kind === "s") {
        if (n === 0) {
          el = {
            name: "S⁰", dim: 0, orientable: true, terms: [], chi: 2n, sigma: 0n,
            notes: ["S⁰ is two points, oriented as the boundary of an interval (+pt and −pt), so its class is 0 in both theories."],
            cites: [],
          };
        } else el = fromGen(sphereGen(n));
      } else {
        if (n === 0) return { error: "T⁰ is not a torus; Tⁿ needs n ≥ 1." };
        el = fromGen(torusGen(n));
      }
      if (bar) {
        const neg = negate(el);
        if ("error" in neg) return neg;
        el = neg;
      }
      toks.push({ t: "gen", el });
      i += m[0].length;
      continue;
    }
    if ((m = /^\d+/.exec(rest))) {
      if (m[0].length > 6) return { error: `The multiplier ${m[0]} is too large.` };
      toks.push({ t: "int", v: BigInt(m[0]) }); i += m[0].length; continue;
    }
    const word = /^[^\s#+()*-]+/.exec(rest)?.[0] ?? rest[0];
    return { error: `"${word}" is not a manifold this tool knows. Known: ${KNOWN_MANIFOLDS}.` };
  }
  return toks;
}

/**
 * Parses a manifold expression into an element of the cobordism ring:
 *   expr := term (('#' | '+' | '-') term)*
 *   term := '-'? factor (('x' | juxtaposed) factor)*
 *   factor := generator | integer | '(' expr ')'
 * × binds tighter than # and +. An integer k is k points (k copies).
 */
export function parseManifold(expr: string): CobordismElement | { error: string } {
  const s = normaliseTopologyText(expr);
  if (!s) return { error: "Name a manifold." };
  const toks = tokenize(s);
  if ("error" in toks) return toks;
  if (!toks.length) return { error: "Name a manifold." };
  let pos = 0;
  const peek = () => toks[pos];

  const parseFactor = (): CobordismElement | { error: string } => {
    const t = peek();
    if (!t) return { error: "The expression ends where a manifold was expected." };
    if (t.t === "gen") { pos++; return t.el; }
    if (t.t === "int") {
      pos++;
      return {
        name: String(t.v), dim: 0, orientable: true, terms: [{ coef: t.v, gens: [] }],
        chi: t.v, sigma: t.v, notes: [], cites: [],
      };
    }
    if (t.v === "(") {
      pos++;
      const inner = parseExpr();
      if ("error" in inner) return inner;
      if (peek()?.t !== "op" || (peek() as { v: string }).v !== ")") return { error: "Unbalanced parentheses." };
      pos++;
      return inner; // the product's display adds the parentheses it needs
    }
    return { error: `"${t.v}" where a manifold was expected.` };
  };

  const parseTerm = (): CobordismElement | { error: string } => {
    let neg = false;
    while (peek()?.t === "op" && (peek() as { v: string }).v === "-") { neg = !neg; pos++; }
    let left = parseFactor();
    if ("error" in left) return left;
    for (;;) {
      const t = peek();
      const explicit = t?.t === "op" && t.v === "x";
      const juxtaposed = t && (t.t === "gen" || t.t === "int" || (t.t === "op" && t.v === "("));
      if (!explicit && !juxtaposed) break;
      if (explicit) pos++;
      // "ℂP² × −ℂP²": after an explicit ×, a leading − reverses that factor
      // (the tool prints products this way, so it must read them back).
      let negFactor = false;
      if (explicit) {
        while (peek()?.t === "op" && (peek() as { v: string }).v === "-") { negFactor = !negFactor; pos++; }
      }
      let right = parseFactor();
      if ("error" in right) return right;
      if (negFactor) {
        const nr = negate(right);
        if ("error" in nr) return nr;
        right = nr;
      }
      const prod = multiply(left, right);
      if ("error" in prod) return prod;
      // "2 CP^2" reads as two copies, printed "2·ℂP²"; a reversed or compound
      // factor is bracketed — "16·(−ℂP²)" — so it never reads as "16 − ℂP²".
      if (left.dim === 0 && left.terms.length === 1 && left.terms[0].gens.length === 0 && /^\d+$/.test(left.name)) {
        const wrapR = right.name.includes(" ") || right.name.startsWith("−");
        prod.name = `${left.name}·${wrapR ? `(${right.name})` : right.name}`;
      }
      left = prod;
    }
    if (neg) return negate(left);
    return left;
  };

  function parseExpr(): CobordismElement | { error: string } {
    let left = parseTerm();
    if ("error" in left) return left;
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v === "#" || t.v === "+" || t.v === "-")) break;
      pos++;
      const right = parseTerm();
      if ("error" in right) return right;
      const r = add(left, right, t.v);
      if ("error" in r) return r;
      left = r;
    }
    return left;
  }

  const el = parseExpr();
  if ("error" in el) return el;
  if (pos < toks.length) return { error: "Couldn't read the whole expression — check the operators between manifolds." };
  // ℝP² # ℝP² is the Klein bottle: say so.
  if (/^ℝP² # ℝP²$/.test(el.name)) el.notes.push("ℝP² # ℝP² is the Klein bottle.");
  return el;
}

// ---------------------------------------------------------------------------
// Characteristic numbers
// ---------------------------------------------------------------------------

class BudgetError extends Error {}
/** Monomial multiplications per report. Bounds time no matter what is typed. */
export const NUMBER_BUDGET = 3_000_000;

interface Ring { degs: number[]; top: number[]; ew: 0 | 1 }

function termRing(gens: Generator[]): Ring {
  const degs: number[] = [], top: number[] = [];
  for (const g of gens) { degs.push(...g.degs); top.push(...g.top); }
  return { degs, top, ew: 1 };
}

/** The product of each generator's total class, in the tensor-product ring. */
function embed(gens: Generator[], pick: (g: Generator) => { e: number[]; c: bigint }[]): Poly {
  const width = gens.reduce((s, g) => s + g.degs.length, 0);
  const zero = () => new Array(width).fill(0);
  let total: Poly = new Map([[zero().join(","), { e: zero(), c: 1n }]]);
  let offset = 0;
  for (const g of gens) {
    const p: Poly = new Map();
    for (const m of pick(g)) {
      const e = zero();
      m.e.forEach((x, i) => (e[offset + i] = x));
      p.set(e.join(","), { e, c: m.c });
    }
    total = mulPoly(total, p, null);
    offset += g.degs.length;
  }
  return total;
}

let budget = 0;
let ringTop: number[] = [];
let mod2 = false;

function mulPoly(a: Poly, b: Poly, _unused: null): Poly {
  const out: Poly = new Map();
  for (const x of a.values()) {
    for (const y of b.values()) {
      if (--budget < 0) throw new BudgetError();
      const e = x.e.map((v, i) => v + y.e[i]);
      let ok = true;
      for (let i = 0; i < e.length; i++) if (e[i] > ringTop[i]) { ok = false; break; }
      if (!ok) continue;
      const k = e.join(",");
      const prev = out.get(k);
      let c = (prev ? prev.c : 0n) + x.c * y.c;
      if (mod2) c = c & 1n;
      if (c === 0n) out.delete(k); else out.set(k, { e, c });
    }
  }
  return out;
}

/**
 * Σ over partitions I of `weight` of ⟨∏ class_{i}, [term]⟩, into `acc`.
 * `unit` is the degree of class index 1 (1 for w, 4 for p).
 */
function termNumbers(
  gens: Generator[], kind: "w" | "p", weight: number, coef: bigint, acc: Map<string, bigint>,
): void {
  const ring = termRing(gens);
  ringTop = ring.top;
  mod2 = kind === "w";
  const unit = kind === "w" ? 1 : 4;
  const total = embed(gens, (g) => (kind === "w" ? g.w.map((e) => ({ e, c: 1n })) : g.p));
  // Graded components class_i.
  const comps: Poly[] = Array.from({ length: weight + 1 }, () => new Map());
  for (const [k, m] of total) {
    let d = 0;
    m.e.forEach((x, i) => (d += x * ring.degs[i]));
    if (d % unit === 0 && d / unit <= weight) comps[d / unit].set(k, m);
  }
  const topKey = ring.top.join(",");
  const width = ring.top.length;
  const one: Poly = new Map([[new Array(width).fill(0).join(","), { e: new Array(width).fill(0), c: 1n }]]);
  const parts: number[] = [];
  const walk = (left: number, max: number, cur: Poly) => {
    if (left === 0) {
      const v = cur.get(topKey)?.c ?? 0n;
      if (v !== 0n) {
        const key = pkey(parts);
        const add = coef * v;
        acc.set(key, (acc.get(key) ?? 0n) + add);
      }
      return;
    }
    for (let i = Math.min(left, max); i >= 1; i--) {
      if (comps[i].size === 0) continue;
      const next = mulPoly(cur, comps[i], null);
      if (next.size === 0) continue; // every number below this node is zero
      parts.push(i);
      walk(left - i, i, next);
      parts.pop();
    }
  };
  walk(weight, weight, one);
}

export interface NumberEntry { partition: number[]; label: string; value: bigint }

function collect(el: CobordismElement, kind: "w" | "p"): NumberEntry[] {
  const weight = kind === "w" ? el.dim : el.dim / 4;
  const acc = new Map<string, bigint>();
  for (const t of el.terms) {
    // The signed count of the evaluation: a generator's top class evaluates to 1.
    termNumbers(t.gens, kind, weight, t.coef, acc);
  }
  const out: NumberEntry[] = [];
  for (const [key, v0] of acc) {
    const v = kind === "w" ? ((v0 % 2n) + 2n) % 2n : v0;
    if (v === 0n) continue;
    const partition = key ? key.split(",").map(Number) : [];
    out.push({ partition, label: kind === "w" ? wMonoName(partition) : pMonoName(partition), value: v });
  }
  out.sort((a, b) => (pkey(a.partition) < pkey(b.partition) ? 1 : -1));
  return out;
}

// ---------------------------------------------------------------------------
// The cited oriented cobordism table
// ---------------------------------------------------------------------------

/** Ω^SO_n, n = 0…8 — CITED (Thom 1954; Wall 1960; Milnor–Stasheff §17). */
export const OMEGA_SO: readonly string[] = ["ℤ", "0", "0", "0", "ℤ", "ℤ/2", "0", "0", "ℤ ⊕ ℤ"];
export const OMEGA_SO_GENERATORS: Record<number, string> = {
  0: "a point",
  4: "ℂP² (detected by the signature, σ = p₁/3)",
  5: "the Wu manifold SU(3)/SO(3) (detected by the de Rham invariant w₂w₃)",
  8: "ℂP⁴ and ℂP² × ℂP² (detected by p₁² and p₂)",
};
export const OMEGA_CITE =
  "Ωₙˢᴼ for n = 0…8 is ℤ, 0, 0, 0, ℤ, ℤ/2, 0, 0, ℤ ⊕ ℤ — CITED: Thom (1954); Wall, \"Determination of the cobordism ring\", Ann. of Math. (1960); Milnor–Stasheff, Characteristic Classes (1974).";

/** Number of partitions of n (p(n)), exact. */
export function partitionCount(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 400) return NaN;
  const p = new Array(n + 1).fill(0);
  p[0] = 1;
  for (let k = 1; k <= n; k++) for (let i = k; i <= n; i++) p[i] += p[i - k];
  return p[n];
}

/** dim 𝔑_n: partitions of n into parts not of the form 2^j − 1 (Thom 1954). */
export function unorientedRank(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 400) return NaN;
  const p = new Array(n + 1).fill(0);
  p[0] = 1;
  for (let k = 1; k <= n; k++) {
    if (((k + 1) & k) === 0) continue; // k = 2^j − 1
    for (let i = k; i <= n; i++) p[i] += p[i - k];
  }
  return p[n];
}

export interface Report { title: string; display: string[]; steps: string[]; caveats: string[] }

/** "oriented cobordism group dimension n" / "Omega^SO_n" / "unoriented cobordism group n". */
export function cobordismGroupReport(n: number, unoriented = false): Report {
  if (unoriented) {
    if (!(n >= 0 && n <= 400)) {
      return { title: "Unoriented cobordism group", display: ["Give a dimension 0–400."], steps: [], caveats: [] };
    }
    const r = unorientedRank(n);
    return {
      title: `Unoriented cobordism group 𝔑${subscript(n)}`,
      display: [`𝔑${subscript(n)} = ${r === 0 ? "0" : r === 1 ? "ℤ/2" : `(ℤ/2)${sup(r)}`}`],
      steps: [
        "Thom: 𝔑∗ = 𝔽₂[xᵢ : i ≠ 2ʲ − 1], one generator in each degree that is not one less than a power of two.",
        `So dim 𝔑${subscript(n)} = the number of partitions of ${n} into parts not of the form 2ʲ − 1 = ${r}.`,
      ],
      caveats: ["Thom, \"Quelques propriétés globales des variétés différentiables\", Comment. Math. Helv. 28 (1954) — a proved structure theorem, computed here, not looked up."],
    };
  }
  if (!(n >= 0 && n <= 400)) {
    return { title: "Oriented cobordism group", display: ["Give a dimension 0–400."], steps: [], caveats: [] };
  }
  const om = `Ω${subscript(n)}ˢᴼ`;
  const title = `Oriented cobordism group ${om}`;
  if (n <= 8) {
    return {
      title,
      display: [`${om} = ${OMEGA_SO[n]}`, ...(OMEGA_SO_GENERATORS[n] ? [`Generator(s): ${OMEGA_SO_GENERATORS[n]}`] : [])],
      steps: [
        n % 4 === 0 ? `Rank ${partitionCount(n / 4)} = p(${n / 4}), the number of partitions of ${n / 4} (Thom: Ω ⊗ ℚ = ℚ[ℂP², ℂP⁴, …]) — computed, and it agrees with the table.` : `${n} ≢ 0 (mod 4), so the rank is 0 (Thom); the table supplies the torsion.`,
      ],
      caveats: [OMEGA_CITE],
    };
  }
  const rank = n % 4 === 0 ? partitionCount(n / 4) : 0;
  return {
    title,
    display: [
      `Rank of ${om} = ${rank}${n % 4 === 0 ? ` = p(${n / 4})` : ` (${n} ≢ 0 mod 4)`} — proved (Thom: Ω ⊗ ℚ = ℚ[ℂP², ℂP⁴, …]).`,
      `The TORSION of ${om} is not given: n ≥ 9 is outside the cited table.`,
    ],
    steps: [
      "Wall (1960) proved all torsion in Ω∗ˢᴼ has order 2, but the number of ℤ/2 summands for n ≥ 9 has not been checked against Wall (1960) or Milnor–Stasheff here, so it is not given.",
    ],
    caveats: [OMEGA_CITE],
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface CobordismAnalysis {
  element: CobordismElement;
  /** Nonzero SW numbers (mod 2). null when the budget refused the enumeration. */
  sw: NumberEntry[] | null;
  /** Total count of SW numbers (p(n)). */
  swCount: number;
  unorientedBounds: boolean | null;
  /** Nonzero Pontryagin numbers; null when not applicable. */
  pontryagin: NumberEntry[] | null;
  signature: bigint | null;
  orientedBounds: boolean | null;
  /** Coordinates in the cited basis of Ω₄ / Ω₈. */
  coordinates?: string;
  /** Set when a cross-check disagreed: the verdict is withheld. */
  contradiction?: string;
  steps: string[];
  caveats: string[];
}

function signatureFromL(p: NumberEntry[], k: number): Rat {
  const Lk = lPolynomials(Math.max(k, 1))[k];
  const byKey = new Map(p.map((e) => [pkey(e.partition), e.value]));
  let s = RZERO;
  for (const [key, c] of Lk) s = radd(s, rmul(c, rat(byKey.get(key) ?? 0n)));
  return s;
}

/** Characteristic numbers, verdicts and cross-checks for one element. */
export function analyseCobordism(el: CobordismElement): CobordismAnalysis {
  const steps: string[] = [];
  const caveats: string[] = [...el.cites];
  const n = el.dim;
  steps.push(...el.notes);
  if (el.terms.length > 1 || el.name.includes("#")) {
    steps.push("M # N is cobordant to M ⊔ N (attach a 1-handle), so connected sums and disjoint unions ADD characteristic numbers; products multiply total classes: w(M×N) = w(M)·w(N), p(M×N) = p(M)·p(N) modulo 2-torsion.");
  }

  // ---- Stiefel–Whitney numbers (unoriented)
  let sw: NumberEntry[] | null = null;
  budget = NUMBER_BUDGET;
  try {
    sw = collect(el, "w");
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    sw = null;
  }
  const swCount = partitionCount(n);
  let unorientedBounds: boolean | null = sw ? sw.length === 0 : null;
  let contradiction: string | undefined;

  // Cross-check 3: a single product term — 𝔑_* is an integral domain.
  if (el.terms.length === 1 && el.terms[0].gens.length > 1) {
    const t = el.terms[0];
    const odd = t.coef % 2n !== 0n;
    let factorBounds: boolean | null = !odd;
    const factorLines: string[] = [];
    if (odd) {
      let unknown = false;
      for (const g of t.gens) {
        budget = NUMBER_BUDGET;
        let fb: boolean | null;
        try { fb = collect(fromGen(g), "w").length === 0; } catch { fb = null; }
        if (fb === null) { unknown = true; factorLines.push(`${g.name}: over budget`); continue; }
        factorLines.push(`${g.name} ${fb ? "bounds" : "does not bound"}`);
        if (fb) factorBounds = true;
      }
      // "No factor bounds" is only a verdict when every factor was decided.
      if (!factorBounds && unknown) factorBounds = null;
    }
    steps.push(`Independent check (Thom: 𝔑_* is a polynomial ring over 𝔽₂, so [M × N] = 0 exactly when [M] = 0 or [N] = 0): ${factorLines.join("; ") || "even multiplicity"} ⇒ the product ${factorBounds === null ? "is not decided" : factorBounds ? "bounds" : "does not bound"}.`);
    if (unorientedBounds === null) unorientedBounds = factorBounds;
    else if (factorBounds !== null && unorientedBounds !== factorBounds) {
      contradiction = `the Stiefel–Whitney numbers say the product ${unorientedBounds ? "bounds" : "does not bound"}, but the factor-wise check says it ${factorBounds ? "bounds" : "does not"}`;
    }
  }

  if (sw) {
    if (n === 0) {
      steps.push(`A 0-manifold's only Stiefel–Whitney number is its point count mod 2: ${sw.length ? 1 : 0}.`);
    } else {
      steps.push(sw.length
        ? `Nonzero Stiefel–Whitney numbers (of ${swCount}): ${sw.slice(0, 30).map((x) => `${x.label}[M] = 1`).join(", ")}${sw.length > 30 ? `, … (${sw.length} in all)` : ""}.`
        : `All ${swCount} Stiefel–Whitney numbers vanish.`);
    }
    // Cross-check 1: wₙ[M] = χ(M) mod 2.
    if (n > 0) {
      const wn = sw.some((x) => x.partition.length === 1 && x.partition[0] === n) ? 1n : 0n;
      const chi2 = ((el.chi % 2n) + 2n) % 2n;
      steps.push(`Check: the top number w${subscript(n)}[M] = ${wn} equals χ(M) mod 2 = ${el.chi} mod 2 = ${chi2} (χ tracked through the operations, not from the numbers).`);
      if (wn !== chi2) contradiction = `w${subscript(n)}[M] = ${wn} but χ(M) = ${el.chi} is ${chi2 === 0n ? "even" : "odd"}`;
    }
  } else {
    steps.push(`The Stiefel–Whitney numbers were not enumerated: the computation exceeds its budget of ${NUMBER_BUDGET.toLocaleString("en-US")} monomial products.`);
  }

  // ---- Pontryagin numbers and signature (oriented)
  let pontryagin: NumberEntry[] | null = null;
  let signature: bigint | null = null;
  let orientedBounds: boolean | null = null;
  let coordinates: string | undefined;
  if (el.orientable) {
    if (n % 4 === 0) {
      budget = NUMBER_BUDGET;
      try {
        pontryagin = collect(el, "p");
      } catch (e) {
        if (!(e instanceof BudgetError)) throw e;
        pontryagin = null;
      }
      if (pontryagin) {
        const k = n / 4;
        steps.push(pontryagin.length
          ? `Pontryagin numbers: ${pontryagin.map((x) => `${x.label}[M] = ${num(x.value)}`).join(", ")}${partitionCount(k) > pontryagin.length ? " (all others 0)" : ""}.`
          : `All ${partitionCount(k)} Pontryagin numbers vanish.`);
        if (k === 0) {
          signature = pontryagin.length ? pontryagin[0].value : 0n;
          steps.push(`A 0-manifold's signature is its signed point count: ${signature}.`);
        } else if (k <= MAX_L_WEIGHT) {
          const s = signatureFromL(pontryagin, k);
          steps.push(`Hirzebruch signature theorem: σ = ⟨L${subscript(k)}, [M]⟩ with L${subscript(k)} = ${formatLPolynomial(k)}, giving σ = ${ratStr(s)}.`);
          if (s.d !== 1n) contradiction = `the L-genus gave the non-integer ${ratStr(s)}`;
          else {
            signature = s.n;
            steps.push(`Check: the signature tracked from the intersection forms (multiplicative under ×, additive under #, negated by −) is ${num(el.sigma)}.`);
            if (s.n !== el.sigma) contradiction = `the L-genus gives σ = ${num(s.n)} but the intersection forms give ${num(el.sigma)}`;
          }
        }
      } else {
        steps.push(`The Pontryagin numbers were not enumerated: over the budget of ${NUMBER_BUDGET.toLocaleString("en-US")} monomial products.`);
      }
    } else {
      steps.push(`Dimension ${n} ≢ 0 (mod 4): there are no Pontryagin numbers and the signature is 0 by definition.`);
      pontryagin = [];
      signature = 0n;
    }

    // ---- Oriented verdict
    const anyP = pontryagin ? pontryagin.length > 0 : null;
    const anyW = sw ? sw.length > 0 : unorientedBounds === null ? null : !unorientedBounds;
    if (anyP === true || anyW === true) {
      orientedBounds = false; // a nonzero number is an obstruction in ANY dimension
    } else if (anyP === false && anyW === false && n <= 8) {
      orientedBounds = true; // Wall: complete for the cited range
    } else {
      orientedBounds = null;
    }
    if (n <= 8) {
      // Cross-check 4: a zero group sees only zero numbers.
      if (OMEGA_SO[n] === "0" && orientedBounds === false) {
        contradiction = `Ω${subscript(n)}ˢᴼ = 0 (cited), yet a characteristic number is nonzero`;
      }
      if (n === 4 && pontryagin) {
        const p1 = pontryagin.find((x) => pkey(x.partition) === "1")?.value ?? 0n;
        if (p1 % 3n !== 0n) contradiction = `p₁ = ${p1} is not divisible by 3, so the class is not an integer multiple of [ℂP²]`;
        else coordinates = `[M] = ${num(p1 / 3n)}·[ℂP²] in Ω₄ˢᴼ = ℤ (p₁[ℂP²] = 3).`;
      }
      if (n === 8 && pontryagin) {
        const p11 = pontryagin.find((x) => pkey(x.partition) === "1,1")?.value ?? 0n;
        const p2 = pontryagin.find((x) => pkey(x.partition) === "2")?.value ?? 0n;
        // a·(25, 10) + b·(18, 9) = (p₁², p₂); determinant 25·9 − 18·10 = 45.
        const aN = 9n * p11 - 18n * p2, bN = 25n * p2 - 10n * p11;
        if (aN % 45n !== 0n || bN % 45n !== 0n) {
          contradiction = `(p₁², p₂) = (${p11}, ${p2}) is not an integer combination of ℂP⁴ (25, 10) and ℂP² × ℂP² (18, 9)`;
        } else {
          coordinates = `[M] = ${combo(aN / 45n, "ℂP⁴", bN / 45n, "ℂP² × ℂP²")} in Ω₈ˢᴼ = ℤ ⊕ ℤ (ℂP⁴: p₁² = 25, p₂ = 10; ℂP² × ℂP²: p₁² = 18, p₂ = 9).`;
        }
      }
      if (n === 5) {
        const dr = sw?.some((x) => pkey(x.partition) === "3,2") ?? false;
        steps.push(`Ω₅ˢᴼ = ℤ/2 is detected by the de Rham invariant w₂w₃[M] = ${dr ? 1 : 0}.`);
      }
      if (coordinates) steps.push(coordinates);
      caveats.push(OMEGA_CITE);
    } else if (orientedBounds === null && anyP === false && anyW === false) {
      steps.push(`Every Pontryagin and Stiefel–Whitney number vanishes, but dimension ${n} ≥ 9 is outside the cited table, so "bounds (oriented)" is NOT claimed. (Wall proved these numbers are complete; the table that would confirm the groups here was not verified.)`);
    }
  } else {
    steps.push(`${el.name} is not orientable — only unoriented cobordism applies.`);
  }

  if (contradiction) {
    unorientedBounds = null;
    orientedBounds = null;
    signature = null;
  }

  caveats.push(
    "Stiefel–Whitney numbers are a COMPLETE invariant of unoriented cobordism (Thom 1954), so whether a closed manifold bounds is genuinely decidable — unlike homeomorphism, which is not, and is never claimed here.",
  );
  return {
    element: el, sw, swCount, unorientedBounds, pontryagin, signature, orientedBounds,
    coordinates, contradiction, steps, caveats,
  };
}

/** The display lines and title for a cobordism question. */
export function cobordismReport(el: CobordismElement, mode: "both" | "oriented" | "unoriented" = "both"): Report {
  const a = analyseCobordism(el);
  const name = el.name;
  const display: string[] = [];
  if (a.contradiction) {
    return {
      title: `Cobordism of ${name}`,
      display: [`No verdict: an internal cross-check disagreed (${a.contradiction}). Refused rather than reporting either answer.`],
      steps: a.steps,
      caveats: a.caveats,
    };
  }
  const oriented = mode === "oriented";
  if (mode !== "oriented" || !el.orientable) {
    display.push(
      a.unorientedBounds === null
        ? `Unoriented: not decided — the Stiefel–Whitney numbers exceed the computation budget.`
        : a.unorientedBounds
          ? `Unoriented: ${name} BOUNDS (null-cobordant) — every Stiefel–Whitney number vanishes.`
          : `Unoriented: ${name} does NOT bound — ${el.dim === 0 ? "it is an odd number of points (its only Stiefel–Whitney number is the point count mod 2 = 1)" : a.sw && a.sw.length ? a.sw.slice(0, 6).map((x) => `${x.label} = 1`).join(", ") : "a Stiefel–Whitney number is nonzero"}.`,
    );
  }
  if (el.orientable && mode !== "unoriented") {
    const pn = a.pontryagin && a.pontryagin.length
      ? a.pontryagin.map((x) => `${x.label} = ${num(x.value)}`).join(", ")
      : null;
    if (el.dim === 0) {
      display.push(`Signed point count: ${a.signature === null ? "—" : num(a.signature)}.`);
    } else if (el.dim % 4 === 0 && a.pontryagin) {
      display.push(`Pontryagin numbers: ${pn ?? "all 0"}; signature σ = ${a.signature === null ? "—" : num(a.signature)}.`);
    }
    display.push(
      a.orientedBounds === null
        ? `Oriented: not decided — ${el.dim >= 9 ? `dimension ${el.dim} is outside the cited table (n ≤ 8), and every number computed vanishes` : "the characteristic numbers exceed the computation budget"}.`
        : a.orientedBounds
          ? `Oriented: ${name} BOUNDS — its class in Ω${subscript(el.dim)}ˢᴼ${" = "}${el.dim <= 8 ? OMEGA_SO[el.dim] : "?"} is zero.`
          : `Oriented: ${name} does NOT bound — ${el.dim === 0 ? `its signed point count is ${a.signature === null ? "nonzero" : num(a.signature)}` : a.pontryagin && a.pontryagin.length ? "a Pontryagin number is nonzero" : "a Stiefel–Whitney number is nonzero"}.`,
    );
    if (a.coordinates) display.push(a.coordinates);
  } else if (!el.orientable && oriented) {
    display.push(`${name} is not orientable — only unoriented cobordism applies, and that answer is given above.`);
  }
  const title = oriented && el.orientable ? `Oriented cobordism of ${name}` : `Unoriented cobordism of ${name}`;
  return { title, display, steps: a.steps, caveats: a.caveats };
}

// ---------------------------------------------------------------------------
// Typed questions
// ---------------------------------------------------------------------------

/** True when the text is a cobordism / signature / Pontryagin / Ω question. */
export function isCobordismQuery(text: string): boolean {
  const s = normaliseTopologyText(text);
  // A characteristic CLASS ("pontryagin classes of cp^3") is not a cobordism
  // question — the class branch answers it. Numbers are.
  if (/\bclass(es)?\b/.test(s) && !/\bnumbers?\b|\bcobord|\bbound/.test(s)) return false;
  if (UNORIENTED_GROUP.test(s)) return true;
  // "omega_5": the underscore is a word character, so omega gets a lookahead,
  // not a trailing \b.
  return /\b(cobord\w*|bounds?|null-?cobordant|signature|pontr[yj]agin)\b|\bomega(?![a-z])/.test(s) ||
    /\b(stiefel|sw)\b.*\bnumbers?\b/.test(s);
}

/**
 * The unoriented group by its printed name: "𝔑₅" (folds to "unoriented
 * omega_5"), and the pane's fold of it, "N₅" / "N_5" — the whole text.
 */
const UNORIENTED_GROUP = /^(?:unoriented\s+)?n\s*_\s*\{?\s*(\d{1,4})\s*\}?\s*(?:=.*)?$/;

const QUESTION_WORDS =
  /\b(does|do|is|are|the|of|bound|bounds|boundary|null-?cobordant|cobordism|cobordant|class|classes|oriented|unoriented|signature|pontr[yj]agin|stiefel|whitney|sw|numbers?|compute|calculate|find|what|show|give|please|manifold|in|ring|group)\b|[?]/g;

/**
 * Answers a typed cobordism question, or returns null when it is not one.
 * Never answers a product or a sum with one of its parts.
 */
export function cobordismQuery(text: string): Report | null {
  if (!isCobordismQuery(text)) return null;
  const s = normaliseTopologyText(text);
  const unorientedAsked = /\bunoriented\b/.test(s);
  const orientedAsked = !unorientedAsked && (/\boriented\b/.test(s) || /\b(signature|pontr[yj]agin)\b/.test(s));

  // Groups: Ω^SO_n, "omega_5", "oriented cobordism group dimension 5", "unoriented cobordism group 3".
  const nGroup = UNORIENTED_GROUP.exec(s);
  if (nGroup) return cobordismGroupReport(parseInt(nGroup[1], 10), true);
  const om = /\bomega\s*(?:\^?\s*\{?\s*so\s*\}?)?\s*_?\s*\{?\s*(\d{1,4})\s*\}?/.exec(s);
  const grp = /\bcobordism groups?\b(?:\s*(?:in|of|for)?\s*(?:dimension|dim|degree|n\s*=)?\s*(\d{1,4}))?/.exec(s);
  if (om || (grp && grp[1] !== undefined)) {
    const n = parseInt((om ? om[1] : grp![1]) as string, 10);
    const unor = unorientedAsked || /\bomega\s*\^?\s*\{?\s*o\s*\}?\s*_/.test(s) || /\bn_\d/.test(s);
    return cobordismGroupReport(n, unor);
  }

  // "is A cobordant to B": the difference (oriented) / sum (unoriented) bounds.
  const cob = /\bcobordant (?:to|with)\b/.exec(s);
  if (cob) {
    const left = s.slice(0, cob.index).replace(QUESTION_WORDS, " ").trim();
    const right = s.slice(cob.index + cob[0].length).replace(QUESTION_WORDS, " ").trim();
    const A = parseManifold(left);
    const B = parseManifold(right);
    if ("error" in A) return errorReport(A.error);
    if ("error" in B) return errorReport(B.error);
    if (A.dim !== B.dim) {
      return {
        title: `Is ${A.name} cobordant to ${B.name}?`,
        display: [`No — they have different dimensions (${A.dim} and ${B.dim}); cobordism compares manifolds of the same dimension.`],
        steps: [], caveats: [],
      };
    }
    const both = A.orientable && B.orientable && !unorientedAsked;
    const diff = both ? add(A, B, "-") : add(A, B, "+");
    if ("error" in diff) return errorReport(diff.error);
    const a = analyseCobordism(diff);
    const display: string[] = [];
    if (a.contradiction) display.push(`No verdict: an internal cross-check disagreed (${a.contradiction}).`);
    else {
      display.push(a.unorientedBounds === null
        ? "Unoriented: not decided (budget)."
        : `Unoriented: ${a.unorientedBounds ? "COBORDANT — every Stiefel–Whitney number agrees" : "NOT cobordant — their Stiefel–Whitney numbers differ"}.`);
      if (both) {
        display.push(a.orientedBounds === null
          ? `Oriented: not decided — ${A.dim >= 9 ? "dimension ≥ 9 is outside the cited table" : "budget"}.`
          : `Oriented: ${a.orientedBounds ? "COBORDANT" : "NOT cobordant — their numbers differ"}.`);
      }
    }
    return {
      title: `Is ${A.name} cobordant to ${B.name}?`,
      display,
      steps: [`Compared through the ${both ? "difference" : "sum"} ${diff.name}: two manifolds are cobordant exactly when it bounds.`, ...a.steps],
      caveats: a.caveats,
    };
  }

  const body = s.replace(QUESTION_WORDS, " ").replace(/\s+/g, " ").trim();
  if (!body) {
    return {
      title: "Cobordism",
      display: ["Name a manifold — for example \"does ℝP² # ℝP² bound\", \"oriented cobordism of ℂP² × ℂP²\", \"signature of ℂP⁴\" or \"Ω₅ˢᴼ\"."],
      steps: [`Known manifolds: ${KNOWN_MANIFOLDS}.`],
      caveats: [
        "UNORIENTED cobordism is decided by Stiefel–Whitney numbers (Thom); ORIENTED cobordism by Pontryagin and Stiefel–Whitney numbers, with the verdict given for dimension ≤ 8 (the cited table).",
      ],
    };
  }
  const el = parseManifold(body);
  if ("error" in el) {
    // A single ℝPⁿ above the ring engine's dimension cap is still decided —
    // by the theorem (wₙ = χ mod 2 for n even; the Hopf disc bundle for n
    // odd), through topology2's realProjectiveCobordism.
    const big = /^(?:rp|real projective)\s*\^?\s*\{?(\d{1,6})\}?$/.exec(body);
    if (big && parseInt(big[1], 10) > MAX_COBORDISM_DIM && parseInt(big[1], 10) <= 512) {
      const n = parseInt(big[1], 10);
      const r = realProjectiveCobordism(n);
      return {
        title: `Unoriented cobordism of ℝP${sup(n)}`,
        display: [`Unoriented: ℝP${sup(n)} ${r.boundsAManifold ? "BOUNDS" : "does NOT bound"}.`],
        steps: r.steps,
        caveats: r.caveats,
      };
    }
    return errorReport(el.error);
  }
  return cobordismReport(el, orientedAsked ? "oriented" : unorientedAsked ? "unoriented" : "both");
}

/**
 * A manifold typed ALONE ("rp^2 x rp^2", "K3", "CP^2 # CP^2bar") in the
 * topology kind: its standard summary — dimension, orientability, χ, σ (oriented
 * 4k), the characteristic numbers and both cobordism verdicts. Null when the
 * text is not a manifold expression (so other topology input is untouched).
 * The printed title "Manifold summary: X" reads back to the same summary.
 */
export function manifoldSummary(text: string): Report | null {
  const s = normaliseTopologyText(text).replace(/^manifold summary\s*:?\s*/, "").trim();
  if (!/[a-z]/.test(s)) return null; // "2" alone is not a manifold question
  const el = parseManifold(s);
  if ("error" in el) return null;
  const a = analyseCobordism(el);
  const rep = cobordismReport(el, "both");
  const facts = [
    `Dimension ${el.dim}; ${el.orientable ? "orientable" : "not orientable"}; Euler characteristic χ = ${num(el.chi)}.`,
  ];
  // σ and the Pontryagin numbers come from cobordismReport's own line below.
  if (a.sw) {
    facts.push(a.sw.length
      ? `Nonzero Stiefel–Whitney numbers: ${a.sw.slice(0, 12).map((x) => `${x.label} = 1`).join(", ")}${a.sw.length > 12 ? `, … (${a.sw.length})` : ""}.`
      : "Every Stiefel–Whitney number vanishes.");
  }
  return {
    title: `Manifold summary: ${el.name}`,
    display: [...facts, ...rep.display],
    steps: rep.steps,
    caveats: rep.caveats,
  };
}

const errorReport = (msg: string): Report => ({
  title: "Cobordism",
  display: [msg],
  steps: [`Known manifolds: ${KNOWN_MANIFOLDS}.`],
  caveats: [],
});

/** Stiefel–Whitney numbers of ℝPⁿ with every partition listed (topology2's thin wrapper). */
export function realProjectiveSwNumbers(n: number): { partition: number[]; value: 0 | 1 }[] {
  if (!Number.isFinite(n) || n < 1 || n > MAX_COBORDISM_DIM) return [];
  budget = NUMBER_BUDGET;
  const nz = new Set(collect(fromGen(rpGen(n)), "w").map((x) => pkey(x.partition)));
  return partitions(n).map((p) => ({ partition: p, value: nz.has(pkey(p)) ? 1 : 0 }));
}
