// Persistent homology of a point cloud — GEOMETRY-TOPOLOGY-DESIGN Release T2,
// extended in v2.139.0 to coefficients in any prime field 𝔽p.
//
// This is the entry in the topology plan that earns its place for a working
// scientist, because its input is a PASTED TABLE OF POINTS — the same gesture
// as Stats and Analyze — and its output answers a question no summary
// statistic can: does this data have a HOLE in it? A ring of measurements and
// a filled blob have the same mean, the same covariance and very similar
// correlations; they differ in H₁, and that difference is what a barcode shows.
//
// HOW IT WORKS. Build the Vietoris–Rips filtration: every simplex enters at
// the scale equal to the largest pairwise distance among its vertices. Sort by
// that scale, build the boundary matrix, and reduce it left to right. A column
// that reduces to zero CREATES a homology class; a column that does not KILLS
// the class its lowest remaining entry created. The pair of scales is that
// feature's lifetime, and a feature that survives across a long range of
// scales is a real one rather than sampling noise.
//
// WHY 𝔽p (v2.139.0). Over 𝔽₂ a Klein bottle and a torus have the same barcode:
// H₁(K; 𝔽₂) = 𝔽₂² because H₁(K; ℤ) = ℤ ⊕ ℤ/2 and ℤ/2 ⊗ 𝔽₂ = 𝔽₂. Over 𝔽₃ the
// ℤ/2 vanishes and one long H₁ bar disappears; the torus (no torsion) loses
// nothing. Comparing two fields is therefore evidence of TORSION, and the
// result says so in words (universal coefficients).
//
// THE SCALE (v2.139.0). The old default grew the complex to the DIAMETER,
// which hit the simplex cap on any realistic cloud (> ~70 points) before a
// single triangle was kept — H₁ was then "NOT RELIABLE" on every real sample.
// The scale is now chosen BEFORE anything is built: the enclosing radius
// (past which the Rips complex is a cone, so nothing finite dies later), or —
// when the PROJECTED simplex count there exceeds the cap — the largest edge
// length whose complex fits. Caps before work, never after enumeration.
//
// HONEST LIMITS, all reported in the result rather than buried here:
//   * the Rips complex grows combinatorially, so the point count, the
//     dimension and the total simplex count are ALL capped, and any cap that
//     actually bites is REPORTED. The project rule is no silent truncation.
//   * prime fields only, p ≤ 46 337, so (p − 1)² < 2³¹ and every product is an
//     exact integer even under 32-bit coercion.
//   * a bar alive at the computed scale is CENSORED (death null), never drawn
//     as essential unless the scale reached the enclosing radius.
//   * the Rips complex is a proxy for the shape the points were sampled from,
//     not the shape itself; the metric is named because it determines the
//     answer. A bar is evidence of a feature at that scale, not proof of one,
//     and torsion read from two fields is evidence by universal coefficients.

import type { HomologyResult } from "./homology";
import { linearAxis, fmtValue } from "./axis";

export interface PersistencePair {
  dimension: number;
  birth: number;
  /**
   * Three distinct meanings, never conflated:
   *   * a finite number — the scale at which the class died;
   *   * Infinity — ESSENTIAL: the class never dies at any scale (for a Rips
   *     complex, only the one surviving H0 component);
   *   * null — CENSORED: still alive at the largest scale computed
   *     (`censoredAt`). It may well die later; nothing was computed past there.
   */
  death: number | null;
  /** death − birth; Infinity for an essential class; null for a censored one. */
  persistence: number | null;
  /** Only on a censored bar: the scale the computation stopped at. */
  censoredAt?: number;
}

/** A bar that was born and died inside the computed range. */
export type FinitePersistencePair = PersistencePair & { death: number; persistence: number };

export interface PersistenceResult {
  points: number;
  dimensions: number;
  /** Simplices actually built, by dimension. */
  cells: number[];
  /** The scale the filtration was built to (= scaleUsed; kept for old callers). */
  maxScale: number;
  /** The coefficient field 𝔽p the barcode was computed over. */
  field: number;
  /** The scale the filtration was built to. */
  scaleUsed: number;
  /** How that scale was chosen — always said in `steps`. */
  scaleSource: "enclosing radius" | "projected simplex cap" | "user";
  /** minᵢ maxⱼ d(i, j): past it the Rips complex is a cone, so nothing finite dies later. */
  enclosingRadius: number;
  diameter: number;
  /** Set when more than MAX_POINTS distinct points arrived: a farthest-point subsample. */
  subsample?: { from: number; kept: number; coveringRadius: number };
  pairs: PersistencePair[];
  /** The most persistent FINITE bar per dimension — the headline features. Censored and essential bars never appear here. */
  notable: FinitePersistencePair[];
  /** Number of censored bars (alive at scaleUsed < enclosingRadius). */
  censored: number;
  /** The same filtration over 𝔽₂, present whenever field ≠ 2 (the torsion comparison). */
  comparison?: { field: number; pairs: PersistencePair[] };
  /** Torsion evidence by universal coefficients, said in words; empty when none. */
  torsion: string[];
  /** Betti numbers at a chosen scale, if one was requested. */
  bettiAt?: { scale: number; betti: number[]; undetermined?: string };
  steps: string[];
  caveats: string[];
  /** Set when a cap changed what was computed. Never silent. */
  capped?: string;
}

export interface PersistenceOptions {
  /** Highest homology dimension to compute (H_0 … H_maxDim), at most 2. */
  maxDim?: number;
  /**
   * Largest scale to grow to. Omitted: chosen automatically BEFORE building —
   * the enclosing radius, or lower if the projected simplex count at that
   * radius would exceed the cap. Given: used as is (the user's scale wins).
   */
  maxScale?: number;
  /** Report Betti numbers at this scale as well as the full barcode. */
  bettiAt?: number;
  /** Prime field 𝔽p for the coefficients; default 2. */
  p?: number;
  /** Compare against 𝔽₂: computes over p (or 𝔽₃ when p is 2) with an 𝔽₂ comparison. */
  compare?: boolean;
}

/** A successfully read pasted request: the cloud plus its header lines. */
export interface PersistenceRequest {
  ok: true;
  cloud: number[][];
  /** Prime field; 2 unless a header said otherwise. */
  p: number;
  /** The user's explicit scale, when a header gave one. */
  maxScale?: number;
  maxDim: number;
  /** `compare`: run 𝔽₂ against 𝔽₃ (or against p). */
  compare: boolean;
  /** Letter-led lines that were not recognised — REPORTED, never silently dropped. */
  ignored: string[];
  /** The headers that were recognised, said back in words. */
  read: string[];
}

/** A pasted cloud whose header was refused by name (e.g. `mod 4`). */
export interface PersistenceRequestError {
  ok: false;
  error: string;
}

/** Result of reading "over F3", "mod 3", "Z/3", "coefficients in F3", "field 5". */
export type FieldSpec = { ok: true; p: number } | { ok: false; error: string };

/** Betti numbers over 𝔽p by the universal coefficient theorem. */
export interface FieldHomology {
  p: number;
  betti: number[];
  /** "𝔽₃", "𝔽₃²", "0" per dimension. */
  groups: string[];
  steps: string[];
}

/** Caps. Generous enough for real data, small enough to stay interactive. */
const MAX_POINTS = 150;
const MAX_SIMPLICES = 60000;
const MAX_DIM = 2;
/** (p − 1)² < 2³¹ for every admissible p: exact even under 32-bit coercion. */
export const MAX_PRIME = 46337;
/** Rows accepted before subsampling; the farthest-point pass is O(rows × 150). */
const MAX_INPUT_POINTS = 100000;
/** Rows × coordinates accepted: that product, × 150, is the subsample's work. */
const MAX_COORDINATES = 1_000_000;
/** Work budget for the 3-simplex projection (pair checks), checked as it runs. */
const PROJECTION_BUDGET = 60_000_000;

/** Euclidean distance in any dimension. */
export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

interface Simplex {
  verts: number[];
  dim: number;
  birth: number;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const subscript = (n: number): string => String(n).split("").map((c) => SUB[+c] ?? c).join("");
const superscript = (n: number): string => String(n).split("").map((c) => SUP[+c] ?? c).join("");
/** "𝔽₃" — the display name of a prime field. */
export const fieldName = (p: number): string => `𝔽${subscript(p)}`;
/** "H₁" — homology in degree k, typeset (display contract: never "H_1"). */
const Hk = (k: number): string => `H${subscript(k)}`;

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** The prime q when n = q^k with k ≥ 2, else null. */
function primePowerBase(n: number): number | null {
  if (!Number.isInteger(n) || n < 4) return null;
  for (let q = 2; q * q <= n; q++) {
    if (n % q !== 0) continue;
    let m = n;
    while (m % q === 0) m /= q;
    return m === 1 && isPrime(q) ? q : null;
  }
  return null;
}

/**
 * Why `p` is not an admissible coefficient field, or null when it is.
 * `notation` decides the wording: "F" (a field was named — 𝔽₉ exists but is not
 * ℤ/9) or "Z" (a ring ℤ/n was named — ℤ/4 is not a field at all).
 */
function fieldRefusal(p: number, notation: "F" | "Z" = "Z"): string | null {
  if (!Number.isFinite(p) || !Number.isInteger(p)) {
    return `p = ${p} is not a prime — coefficients must be a prime field 𝔽ₚ.`;
  }
  if (p < 2) {
    return `ℤ/${p} is not a field — a barcode needs field coefficients (a prime p ≥ 2).`;
  }
  // Trial division is O(√p): bound it BEFORE testing. Past 10¹² nothing about
  // primality is worth computing — no such p is admissible either way.
  if (p > 1e12) {
    return `p = ${p} is far above the cap ${MAX_PRIME.toLocaleString("en-US").replace(/,/g, " ")} for exact arithmetic; ` +
      `coefficients must be a prime field 𝔽ₚ with p ≤ ${MAX_PRIME.toLocaleString("en-US").replace(/,/g, " ")}.`;
  }
  if (isPrime(p)) {
    if (p > MAX_PRIME) {
      return `${fieldName(p)}: ${p} is prime but above the cap ${MAX_PRIME.toLocaleString("en-US").replace(/,/g, " ")} — ` +
        `the reduction keeps every product (p − 1)² below 2³¹ so the arithmetic stays exact.`;
    }
    return null;
  }
  const base = primePowerBase(p);
  if (notation === "F") {
    if (base !== null) {
      return `${fieldName(p)} is a field but not ℤ/${p}; only prime fields here (𝔽ₚ = ℤ/p for p prime, e.g. ${fieldName(base)}).`;
    }
    return `There is no field with ${p} elements (a finite field has prime-power order); use a prime, e.g. over F3.`;
  }
  return `ℤ/${p} is not a field — a barcode needs field coefficients, so p must be prime (e.g. over F3).`;
}

/** Throws a named Error unless p is an admissible prime. */
function requirePrime(p: number): void {
  const why = fieldRefusal(p, "F");
  if (why) throw new Error(why);
}

/** a⁻¹ mod p by Fermat (a^(p−2)), square-and-multiply on plain numbers. */
function modInverse(a: number, p: number): number {
  let base = a % p;
  let e = p - 2;
  let r = 1;
  // Every product is < p² ≤ 46336² < 2³¹: exact.
  while (e > 0) {
    if (e & 1) r = (r * base) % p;
    base = (base * base) % p;
    e = Math.floor(e / 2);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Point preparation: duplicates, subsampling, the metric
// ---------------------------------------------------------------------------

/**
 * Deterministic farthest-point (maxmin) subsample starting from point 0.
 * Returns the chosen indices in their ORIGINAL order and the covering radius
 * achieved (every input point is within it of a kept point), which bounds the
 * bottleneck distance between the two barcodes. Bounded: exactly `k` picks.
 */
function maxminSubsample(points: number[][], k: number): { idx: number[]; coveringRadius: number } {
  const n = points.length;
  const dim = n ? points[0].length : 0;
  // Flat, squared distances: this pass is the one that sees every row.
  const flat = new Float64Array(n * dim);
  for (let i = 0; i < n; i++) for (let t = 0; t < dim; t++) flat[i * dim + t] = points[i][t];
  const minD = new Float64Array(n).fill(Infinity);
  const chosen: number[] = [];
  let next = 0;
  for (let pick = 0; pick < k && pick < n; pick++) {
    chosen.push(next);
    const c = next * dim;
    let far = -1, farD = -1;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * dim;
      for (let t = 0; t < dim; t++) { const d = flat[o + t] - flat[c + t]; s += d * d; }
      if (s < minD[i]) minD[i] = s;
      if (minD[i] > farD) { farD = minD[i]; far = i; }
    }
    // Every row now coincides with a kept point: the rest would be duplicates.
    if (farD === 0) break;
    next = far;
  }
  let cover = 0;
  for (let i = 0; i < n; i++) if (minD[i] > cover) cover = minD[i];
  return { idx: chosen.slice().sort((a, b) => a - b), coveringRadius: Math.sqrt(cover) };
}

// ---------------------------------------------------------------------------
// The Rips complex
// ---------------------------------------------------------------------------

/**
 * Enumerates the Rips complex up to `maxDim` and `maxScale`.
 * On the automatic-scale route the projection guarantees the cap never bites;
 * it remains as a GUARD for a user's explicit scale, and reports which
 * dimension it stopped in rather than silently returning a partial answer.
 */
function ripsComplex(
  dist: number[][], n: number, maxDim: number, maxScale: number
): { simplices: Simplex[]; truncated: boolean; completedDim: number } {
  const simplices: Simplex[] = [];
  for (let i = 0; i < n; i++) simplices.push({ verts: [i], dim: 0, birth: 0 });

  // Edges within the scale.
  const edges: Simplex[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist[i][j] <= maxScale) edges.push({ verts: [i, j], dim: 1, birth: dist[i][j] });
    }
  }
  simplices.push(...edges);
  if (simplices.length > MAX_SIMPLICES) return { simplices, truncated: true, completedDim: 0 };

  // Higher simplices: a set of vertices forms one iff every pair is an edge,
  // and it enters at the largest of those pairwise distances.
  let previous: Simplex[] = edges;
  for (let d = 2; d <= maxDim; d++) {
    const next: Simplex[] = [];
    for (const s of previous) {
      const last = s.verts[s.verts.length - 1];
      for (let v = last + 1; v < n; v++) {
        let birth = s.birth;
        let ok = true;
        for (const u of s.verts) {
          const duv = dist[u][v];
          if (duv > maxScale) { ok = false; break; }
          if (duv > birth) birth = duv;
        }
        if (ok) next.push({ verts: [...s.verts, v], dim: d, birth });
      }
      if (simplices.length + next.length > MAX_SIMPLICES) {
        return { simplices, truncated: true, completedDim: d - 1 };
      }
    }
    simplices.push(...next);
    previous = next;
    if (!next.length) break;
  }
  return { simplices, truncated: false, completedDim: maxDim };
}

/**
 * Projects the simplex count of the Rips complex as a function of scale —
 * WITHOUT allocating a simplex — and returns the largest edge length whose
 * complex (vertices through `topDim`) has at most `cap` cells, never above
 * `limit`.
 *
 * Every k-simplex enters at its longest edge. Rank the edges by length; the
 * triangles born with edge (i, j) of rank r are the k with rank(i,k) < r and
 * rank(j,k) < r, and the tetrahedra are the pairs {k, l} of such k with
 * rank(k,l) < r. Equal lengths are a tie GROUP and enter together, so a scale
 * is only ever a whole group's length: the count at that scale is exactly what
 * ripsComplex builds with `dist <= scale`.
 *
 * Bounded: one pass over the edges up to `limit`, stopping as soon as the
 * running count passes the cap, plus a hard budget on 3-simplex pair checks.
 */
function projectScale(
  dist: number[][], n: number, topDim: number, cap: number, limit: number
): { scale: number | null; count: number; reachedLimit: boolean; overBudget: boolean; countAtLimit?: number } {
  const edges: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (dist[i][j] <= limit) edges.push([dist[i][j], i, j]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const BIG = 0x7fffffff;
  const rank = new Int32Array(n * n).fill(BIG);
  edges.forEach(([, i, j], r) => { rank[i * n + j] = r; rank[j * n + i] = r; });

  let count = n;
  let best: number | null = n <= cap ? -Infinity : null; // -Infinity: only vertices fit
  let bestCount = n;
  let work = 0;
  const common: number[] = [];
  for (let r = 0; r < edges.length; r++) {
    const [len, i, j] = edges[r];
    count += 1;
    if (topDim >= 2) {
      common.length = 0;
      const ri = i * n, rj = j * n;
      for (let k = 0; k < n; k++) {
        if (rank[ri + k] < r && rank[rj + k] < r) common.push(k);
      }
      count += common.length;
      if (topDim >= 3) {
        for (let a = 0; a < common.length; a++) {
          const ra = common[a] * n;
          for (let b = a + 1; b < common.length; b++) if (rank[ra + common[b]] < r) count++;
        }
        work += (common.length * (common.length - 1)) / 2;
        if (work > PROJECTION_BUDGET) {
          return { scale: best === -Infinity ? null : best, count: bestCount, reachedLimit: false, overBudget: true };
        }
      }
    }
    const groupEnds = r === edges.length - 1 || edges[r + 1][0] !== len;
    if (!groupEnds) continue;
    if (count > cap) {
      return { scale: best === -Infinity ? null : best, count: bestCount, reachedLimit: false, overBudget: false, countAtLimit: undefined };
    }
    best = len;
    bestCount = count;
  }
  return { scale: best === -Infinity ? null : best, count: bestCount, reachedLimit: true, overBudget: false, countAtLimit: count };
}

// ---------------------------------------------------------------------------
// Reduction
// ---------------------------------------------------------------------------

/** Per column: the row it kills (its final low), or −1 when it reduced to zero. */
interface Reduction {
  low: Int32Array;
  /** Rows claimed as some column's low. */
  claimed: Uint8Array;
}

/**
 * Standard persistence reduction over 𝔽₂ — the pre-v2.139 path, kept as the
 * REFERENCE the production (cohomology) route is pinned against; the suite
 * also re-runs a verbatim copy of the old engine.
 *
 * Columns are processed in filtration order. A column is repeatedly reduced by
 * whichever earlier column shares its lowest nonzero row, until it is either
 * empty (this simplex CREATES a class) or its low is unclaimed (this simplex
 * KILLS the class that its low created). The subtlety is only in the
 * ordering, which must break ties by dimension so a face never follows the
 * simplex it bounds.
 */
function reduceF2(simplices: Simplex[]): Reduction {
  const n = simplices.length;
  const index = new Map<string, number>();
  simplices.forEach((s, i) => index.set(s.verts.join(","), i));

  // Boundary columns as sets of row indices, built when first needed (the
  // early exit below means most top-dimension columns never are). Over 𝔽₂
  // there are no signs.
  const cols: Set<number>[] = new Array(n);
  const column = (j: number): Set<number> => {
    let col = cols[j];
    if (col) return col;
    col = new Set<number>();
    const s = simplices[j];
    if (s.dim > 0) {
      for (let k = 0; k < s.verts.length; k++) {
        const face = s.verts.filter((_, m) => m !== k);
        const fi = index.get(face.join(","));
        if (fi !== undefined) col.add(fi);
      }
    }
    cols[j] = col;
    return col;
  };

  const lowOf = (c: Set<number>): number => {
    let mx = -1;
    for (const v of c) if (v > mx) mx = v;
    return mx;
  };

  const pairedBy = new Map<number, number>(); // low row -> the column that claimed it
  const low = new Int32Array(n).fill(-1);
  const claimed = new Uint8Array(n);
  const exit = earlyExit(simplices);

  for (let j = 0; j < n; j++) {
    if (exit.done(j)) break;
    column(j);
    let lw = lowOf(cols[j]);
    // Terminates: adding the pivot column cancels row `lw` and that column has
    // no row below `lw` (it is its own low), so `lw` strictly decreases.
    while (lw >= 0 && pairedBy.has(lw)) {
      const j2 = pairedBy.get(lw)!;
      // Symmetric difference: addition over 𝔽₂.
      for (const v of cols[j2]) {
        if (cols[j].has(v)) cols[j].delete(v);
        else cols[j].add(v);
      }
      lw = lowOf(cols[j]);
    }
    if (lw >= 0) {
      pairedBy.set(lw, j);
      low[j] = lw;
      claimed[lw] = 1;
    }
    exit.record(j, lw);
  }
  return { low, claimed };
}

/**
 * The early exit, identical for every field and changing no bar.
 *
 * Only the TOP dimension is built purely to kill classes one dimension down;
 * its own cycles are never reported (they would need simplices one dimension
 * higher still). Once every lower-dimensional simplex has been processed and
 * no class in dimension top − 1 is alive, each remaining top column's
 * boundary is already a boundary, so it must reduce to zero — an unreported
 * cycle. Stopping there is exact. On the §D clouds it skips the bulk of the
 * ~55 000 triangles, which all enter after the last H1 death.
 */
function earlyExit(simplices: Simplex[]): { done: (j: number) => boolean; record: (j: number, low: number) => void } {
  let top = 0;
  for (const s of simplices) if (s.dim > top) top = s.dim;
  let lastLower = -1;
  for (let j = 0; j < simplices.length; j++) if (simplices[j].dim < top) lastLower = j;
  let alive = 0; // classes alive in dimension top − 1
  return {
    done: (j) => top > 0 && j > lastLower && alive === 0,
    record: (j, lw) => {
      const d = simplices[j].dim;
      if (d === top - 1 && lw < 0) alive++;
      else if (d === top && lw >= 0) alive--;
    },
  };
}

/**
 * Signed boundary columns over 𝔽p: the face that omits vertex i of a simplex
 * [v₀ < … < v_k] carries (−1)^i, stored as 1 or p − 1, rows ascending.
 * Exported (via `_internals`) so the suite can check ∂∘∂ = 0 mod p.
 */
function signedBoundary(simplices: Simplex[], p: number): { rows: number[]; vals: number[] }[] {
  const col = boundaryColumns(simplices, p);
  return simplices.map((_, j) => col(j));
}

/** The same columns, built one at a time on demand. */
function boundaryColumns(simplices: Simplex[], p: number): (j: number) => { rows: number[]; vals: number[] } {
  let maxV = 0;
  for (const s of simplices) for (const v of s.verts) if (v > maxV) maxV = v;
  const B = maxV + 2;
  // Digits are v + 1 ≥ 1, so lists of different length never collide.
  const keyOf = (verts: number[], skip: number): number => {
    let k = 0;
    for (let m = 0; m < verts.length; m++) if (m !== skip) k = k * B + (verts[m] + 1);
    return k;
  };
  const index = new Map<number, number>();
  simplices.forEach((s, i) => index.set(keyOf(s.verts, -1), i));
  return (j: number) => {
    const s = simplices[j];
    const entries: [number, number][] = [];
    if (s.dim > 0) {
      for (let m = 0; m < s.verts.length; m++) {
        const fi = index.get(keyOf(s.verts, m));
        if (fi !== undefined) entries.push([fi, m % 2 === 0 ? 1 % p : p - 1]);
      }
    }
    entries.sort((a, b) => a[0] - b[0]);
    return { rows: entries.map((e) => e[0]), vals: entries.map((e) => e[1]) };
  };
}

/**
 * Persistence reduction over 𝔽p, columns as sorted (row, coefficient) arrays.
 *
 * Each pivot column is NORMALISED when it is stored, so its low coefficient is
 * 1; reducing column j by it is then col_j += (p − a)·pivot, where a is col_j's
 * low coefficient — no inverse inside the loop.
 *
 * TERMINATION (the SNF-divergence lesson: re-pivot every pass, and prove it).
 * Every pass reads the CURRENT low L of column j afresh. The pivot column for L
 * has L as its largest row, so the addition introduces no row above L, and the
 * coefficient at L becomes a + (p − a)·1 ≡ 0 (mod p), so row L is removed.
 * The new low is therefore strictly less than L. L is a non-negative integer,
 * so the loop runs at most L + 1 times, then the column is zero or its low is
 * unclaimed. No recursion anywhere.
 */
function reduceFp(simplices: Simplex[], p: number): Reduction {
  // With p not a prime (0, NaN) the pivot never cancels and the loop below
  // would not terminate: validate even on this test-only entry point.
  requirePrime(p);
  const n = simplices.length;
  const column = boundaryColumns(simplices, p);
  const pivotRows: (number[] | undefined)[] = new Array(n);
  const pivotVals: (number[] | undefined)[] = new Array(n);
  const low = new Int32Array(n).fill(-1);
  const claimed = new Uint8Array(n);
  const exit = earlyExit(simplices);

  for (let j = 0; j < n; j++) {
    if (exit.done(j)) break;
    let { rows, vals } = column(j);
    while (rows.length > 0) {
      const L = rows[rows.length - 1];
      const pr = pivotRows[L];
      if (!pr) break;
      const pv = pivotVals[L]!;
      const c = p - vals[vals.length - 1]; // in 1 … p − 1
      // Merge rows ∪ pr with vals + c·pv, dropping zeros. c·pv[·] ≤ (p−1)² < 2³¹.
      const nr: number[] = [];
      const nv: number[] = [];
      let a = 0, b = 0;
      while (a < rows.length || b < pr.length) {
        if (b >= pr.length || (a < rows.length && rows[a] < pr[b])) {
          nr.push(rows[a]); nv.push(vals[a]); a++;
        } else if (a >= rows.length || pr[b] < rows[a]) {
          nr.push(pr[b]); nv.push((c * pv[b]) % p); b++;
        } else {
          const v = (vals[a] + c * pv[b]) % p;
          if (v !== 0) { nr.push(rows[a]); nv.push(v); }
          a++; b++;
        }
      }
      rows = nr;
      vals = nv;
    }
    if (rows.length > 0) {
      const L = rows[rows.length - 1];
      const inv = modInverse(vals[vals.length - 1], p);
      pivotRows[L] = rows;
      pivotVals[L] = inv === 1 ? vals : vals.map((v) => (v * inv) % p);
      low[j] = L;
      claimed[L] = 1;
    }
    exit.record(j, rows.length > 0 ? rows[rows.length - 1] : -1);
  }
  return { low, claimed };
}

/**
 * The same pairing computed by reducing the COBOUNDARY matrix (persistent
 * cohomology, with clearing) — the dual Ripser uses. Over a field the pairs
 * are identical to the homology reduction's for the same total order (de
 * Silva, Morozov & Vejdemo-Johansson, 2011); the suite pins all three
 * reductions against each other. It is the fast route because only the
 * ~4 000 edges are reduced, not the ~55 000 triangles, and an edge that
 * already killed a component is CLEARED (its coboundary reduces to zero).
 *
 * Columns: a d-simplex σ, processed in DECREASING filtration order; rows: the
 * (d+1)-simplices τ ⊃ σ with coefficient [τ : σ] = (−1)^i, stored by the
 * reversed index N − 1 − τ so the pivot (the EARLIEST coface) is the last
 * entry. A nonzero reduced column pairs (σ, τ): σ creates, τ kills.
 *
 * TERMINATION: as in reduceFp — each pass cancels the current pivot R using a
 * stored column whose largest row is R, so the pivot strictly decreases; at
 * most R + 1 passes per column. No recursion.
 */
function reduceCohomology(simplices: Simplex[], p: number): Reduction {
  requirePrime(p); // a non-field p would make the pivot loop non-terminating
  const N = simplices.length;
  const column = boundaryColumns(simplices, p);
  let top = 0;
  for (const s of simplices) if (s.dim > top) top = s.dim;
  const cobRows: number[][] = Array.from({ length: N }, () => []);
  const cobVals: number[][] = Array.from({ length: N }, () => []);
  for (let t = 0; t < N; t++) {
    if (simplices[t].dim === 0) continue;
    const { rows, vals } = column(t);
    for (let e = 0; e < rows.length; e++) {
      cobRows[rows[e]].push(N - 1 - t);
      cobVals[rows[e]].push(vals[e]);
    }
  }
  const low = new Int32Array(N).fill(-1);
  const claimed = new Uint8Array(N);
  const pivotRows: (number[] | undefined)[] = new Array(N);
  const pivotVals: (number[] | undefined)[] = new Array(N);

  for (let d = 0; d < top; d++) {
    for (let s = N - 1; s >= 0; s--) {
      if (simplices[s].dim !== d) continue;
      if (low[s] >= 0) continue; // CLEARED: s killed a class one dimension down.
      // Rows were pushed in decreasing reversed index; make them ascending.
      let rows = cobRows[s].slice().reverse();
      let vals = cobVals[s].slice().reverse();
      while (rows.length > 0) {
        const R = rows[rows.length - 1];
        const pr = pivotRows[R];
        if (!pr) break;
        const pv = pivotVals[R]!;
        const c = p - vals[vals.length - 1];
        const nr: number[] = [];
        const nv: number[] = [];
        let a = 0, b = 0;
        while (a < rows.length || b < pr.length) {
          if (b >= pr.length || (a < rows.length && rows[a] < pr[b])) {
            nr.push(rows[a]); nv.push(vals[a]); a++;
          } else if (a >= rows.length || pr[b] < rows[a]) {
            nr.push(pr[b]); nv.push((c * pv[b]) % p); b++;
          } else {
            const v = (vals[a] + c * pv[b]) % p;
            if (v !== 0) { nr.push(rows[a]); nv.push(v); }
            a++; b++;
          }
        }
        rows = nr;
        vals = nv;
      }
      if (rows.length > 0) {
        const R = rows[rows.length - 1];
        const inv = modInverse(vals[vals.length - 1], p);
        pivotRows[R] = rows;
        pivotVals[R] = inv === 1 ? vals : vals.map((v) => (v * inv) % p);
        const t = N - 1 - R;
        low[t] = s;
        claimed[s] = 1;
      }
    }
  }
  return { low, claimed };
}

/**
 * The production reduction, for every field INCLUDING 𝔽₂: the cohomology
 * route. Why 𝔽₂ too: on a cloud whose loop outlives the computed scale (a
 * 150-point ring), nothing can stop the homology reduction early and the old
 * set path took ~1.8 s against ~0.4 s here — under a loaded Word that is the
 * difference between a pause and a freeze. The old set path (`reduceF2`) is
 * kept, unchanged, as the REFERENCE: the suite pins this route's 𝔽₂ bars
 * identical to it and to a verbatim copy of the pre-v2.139 engine.
 */
function reduceOver(simplices: Simplex[], p: number): Reduction {
  return reduceCohomology(simplices, p);
}

/**
 * Turns a reduction into bars, in dimensions 0 … maxDim only. (Before
 * v2.139.0 every top-dimension cycle — a 2-cycle when only H1 was asked for,
 * with no tetrahedra built to kill it — was reported as an ESSENTIAL H2 bar:
 * 1 771 of them for a 24-point circle, all drawn in the barcode.)
 *
 * A class alive at the end is ESSENTIAL only for the eldest vertex — row 0
 * can never be a low, since every nonzero reduced edge column has coefficient
 * sum 0 and so at least two entries. Every other surviving class is CENSORED
 * at `scale`. On a complete build past the enclosing radius the Rips complex
 * is a cone and nothing else survives; if anything ever did, "censored" is
 * still the honest reading, never "essential".
 */
function barsFrom(
  simplices: Simplex[], red: Reduction, maxDim: number, scale: number
): PersistencePair[] {
  const pairs: PersistencePair[] = [];
  const n = simplices.length;
  for (let j = 0; j < n; j++) {
    const L = red.low[j];
    if (L < 0) continue;
    const dim = simplices[L].dim;
    if (dim > maxDim) continue;
    const birth = simplices[L].birth;
    const death = simplices[j].birth;
    // A zero-length bar is an artefact of simultaneous entry, not a feature.
    if (death > birth) pairs.push({ dimension: dim, birth, death, persistence: death - birth });
  }
  for (let j = 0; j < n; j++) {
    if (red.low[j] >= 0 || red.claimed[j]) continue;
    const s = simplices[j];
    if (s.dim > maxDim) continue;
    if (j === 0 && s.dim === 0) {
      pairs.push({ dimension: 0, birth: s.birth, death: Infinity, persistence: Infinity });
    } else {
      pairs.push({ dimension: s.dim, birth: s.birth, death: null, persistence: null, censoredAt: scale });
    }
  }
  return pairs;
}

/** Sort: by dimension; essential, then censored (by birth), then finite by persistence. */
function sortBars(pairs: PersistencePair[]): void {
  const cls = (q: PersistencePair) => (q.death === Infinity ? 0 : q.death === null ? 1 : 2);
  pairs.sort((a, b) =>
    a.dimension - b.dimension || cls(a) - cls(b) ||
    (cls(a) === 2 ? (b.persistence as number) - (a.persistence as number) : 0) ||
    a.birth - b.birth || (a.death ?? 0) - (b.death ?? 0));
}

const fmt = (v: number): string => String(Number(v.toPrecision(6)));
const barText = (q: PersistencePair): string =>
  q.death === null ? `(${fmt(q.birth)} → ≥ ${fmt(q.censoredAt ?? q.birth)}, censored)` :
  `(${fmt(q.birth)} → ${Number.isFinite(q.death) ? fmt(q.death) : "∞"})`;

/**
 * Bars present over one field and absent over the other — each one is
 * evidence of torsion by universal coefficients. Long bars only: persistence
 * (or observed length, for a censored bar) above a quarter of the scale.
 */
function torsionEvidence(
  f2: PersistencePair[], fp: PersistencePair[], p: number, scale: number, maxDim: number
): string[] {
  const out: string[] = [];
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * (1 + Math.abs(x));
  const same = (a: PersistencePair, b: PersistencePair) =>
    a.dimension === b.dimension && close(a.birth, b.birth) &&
    (a.death === null ? b.death === null : b.death !== null && (a.death === b.death || close(a.death, b.death)));
  const length = (q: PersistencePair) =>
    q.death === null ? (q.censoredAt ?? scale) - q.birth : (q.persistence as number);
  const unmatched = (from: PersistencePair[], against: PersistencePair[]) => {
    const used = new Uint8Array(against.length);
    const left: PersistencePair[] = [];
    for (const a of from) {
      if (a.dimension < 1 || a.dimension > maxDim || !(length(a) > 0.25 * scale)) continue;
      let hit = -1;
      for (let i = 0; i < against.length; i++) if (!used[i] && same(a, against[i])) { hit = i; break; }
      if (hit >= 0) used[hit] = 1; else left.push(a);
    }
    return left;
  };
  // A class born at the same scale that merely LIVES LONGER over the other
  // field is that field's longer bar, not a new class: no claim in reverse.
  const outlived = (b: PersistencePair, other: PersistencePair[]) =>
    other.some((q) => q.dimension === b.dimension && close(q.birth, b.birth) && length(q) >= length(b) - 1e-12);
  const F2 = fieldName(2), FP = fieldName(p);
  const uct = "(universal coefficients: Hₖ(𝔽ₚ) = Hₖ ⊗ 𝔽ₚ ⊕ Tor(Hₖ₋₁, 𝔽ₚ))";
  const where = (k: number) => (k === 1 ? "in H₁ (H₀ is always free)" : `in ${Hk(k)} or ${Hk(k - 1)}`);
  for (const b of unmatched(f2, fp)) {
    out.push(
      `An ${Hk(b.dimension)} bar ${barText(b)} is present over ${F2} and absent over ${FP} (no bar there with the same birth and death): ` +
      `evidence of 2-torsion ${where(b.dimension)} at this scale ${uct} — evidence, not proof; the Rips complex is a proxy.`
    );
  }
  for (const b of unmatched(fp, f2)) {
    if (outlived(b, f2)) continue;
    out.push(
      `An ${Hk(b.dimension)} bar ${barText(b)} is present over ${FP} and absent over ${F2}: ` +
      `evidence of ${p}-torsion ${where(b.dimension)} at this scale ${uct} — evidence, not proof; the Rips complex is a proxy.`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Persistent homology of a point cloud over 𝔽p.
 * Throws only on structurally unusable input (named); every soft limit is reported.
 */
export function persistentHomology(
  points: number[][], opts: PersistenceOptions = {}
): PersistenceResult {
  const steps: string[] = [];
  const caveats: string[] = [];
  let capped: string | undefined;

  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("Persistent homology needs at least two points.");
  }
  if (points.length > MAX_INPUT_POINTS) {
    throw new Error(
      `${points.length.toLocaleString("en-US")} points is above the ${MAX_INPUT_POINTS.toLocaleString("en-US")}-row limit for one paste; ` +
      `subsample the data first (the barcode itself is built from at most ${MAX_POINTS} points).`
    );
  }
  const width = Array.isArray(points[0]) ? points[0].length : 0;
  if (points.length * width > MAX_COORDINATES) {
    throw new Error(
      `${points.length.toLocaleString("en-US")} rows × ${width} coordinates is above the ` +
      `${MAX_COORDINATES.toLocaleString("en-US")}-value limit for one paste; subsample the data first ` +
      `(the barcode itself is built from at most ${MAX_POINTS} points).`
    );
  }
  for (const row of points) {
    if (!Array.isArray(row) || !row.length || !row.every((v) => Number.isFinite(v))) {
      throw new Error("Every point must be a list of finite numbers.");
    }
    if (row.length !== width) {
      throw new Error("Every point must have the same number of coordinates, or the distance between them is meaningless.");
    }
  }

  // The field. compare: computed over p (𝔽₃ when p is 2), with an 𝔽₂ comparison.
  let p = opts.p ?? 2;
  requirePrime(p);
  if (opts.compare && p === 2) p = 3;

  const maxDim = Math.max(0, Math.min(Number.isFinite(opts.maxDim) ? Math.floor(opts.maxDim as number) : 1, MAX_DIM));
  if (opts.maxScale !== undefined && (Number.isNaN(opts.maxScale) || opts.maxScale < 0)) {
    throw new Error(`The scale must be a number ≥ 0 (got ${opts.maxScale}).`);
  }

  // Exact duplicates only ever add zero-length H0 bars (the duplicate and its
  // twin are joined at scale 0), so merging them changes no bar — and a cloud
  // of identical points would otherwise be one enormous simplex at scale 0.
  // Large pastes go straight to the farthest-point pass, which never picks a
  // duplicate (its distance to the kept twin is 0) and stops once every row
  // coincides with a kept point — so no per-row string key is ever built.
  let use: number[][];
  let dupes = 0;
  let subsample: PersistenceResult["subsample"];
  if (points.length > MAX_POINTS) {
    const { idx, coveringRadius } = maxminSubsample(points, MAX_POINTS);
    use = idx.map((i) => points[i]);
    if (coveringRadius === 0) {
      dupes = points.length - use.length; // every row is one of the kept points
    } else {
      subsample = { from: points.length, kept: use.length, coveringRadius };
      capped =
        `Only ${MAX_POINTS} of ${points.length} points were used — a farthest-point subsample starting from the first row, ` +
        `not the first ${MAX_POINTS} rows. Every point lies within ${fmt(coveringRadius)} of a kept one, and that covering radius ` +
        `bounds how far any bar can move (bottleneck stability). The Rips complex grows combinatorially, so the point count is ` +
        `capped — this is a reported limit, not a silent truncation.`;
    }
  } else {
    const seen = new Set<string>();
    use = [];
    for (const row of points) {
      const k = row.join(",");
      if (!seen.has(k)) { seen.add(k); use.push(row); }
    }
    dupes = points.length - use.length;
  }
  const m = use.length;

  // Distance matrix, diameter and enclosing radius.
  const dist: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  let diameter = 0;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const d = euclidean(use[i], use[j]);
      dist[i][j] = dist[j][i] = d;
      if (d > diameter) diameter = d;
    }
  }
  let enclosingRadius = m > 1 ? Infinity : 0;
  for (let i = 0; i < m; i++) {
    let mx = 0;
    for (let j = 0; j < m; j++) if (dist[i][j] > mx) mx = dist[i][j];
    if (m > 1 && mx < enclosingRadius) enclosingRadius = mx;
  }

  // A class in H_k is CREATED by a k-simplex and KILLED by a (k+1)-simplex, so
  // the complex must be built one dimension higher than the homology asked for.
  const topDim = maxDim + 1;
  steps.push(
    `${m} points in ${use[0].length}D` +
    (dupes ? ` (${dupes} exact duplicate row${dupes > 1 ? "s" : ""} merged — they only add zero-length H0 bars)` : "") +
    `; diameter ${fmt(diameter)}, enclosing radius ${fmt(enclosingRadius)}.`
  );

  // The scale — chosen BEFORE anything is built.
  let scale: number;
  let scaleSource: PersistenceResult["scaleSource"];
  if (opts.maxScale !== undefined) {
    scaleSource = "user";
    scale = opts.maxScale;
    if (scale > diameter) {
      steps.push(`Scale ${fmt(scale)} (yours) is past the diameter ${fmt(diameter)}, where the complex is already complete; built to the diameter.`);
      scale = diameter;
    } else {
      steps.push(`Scale ${fmt(scale)}, as you set it (the automatic choice would start from the enclosing radius ${fmt(enclosingRadius)}).`);
    }
  } else {
    const proj = projectScale(dist, m, topDim, MAX_SIMPLICES, enclosingRadius);
    if (proj.reachedLimit) {
      scaleSource = "enclosing radius";
      scale = enclosingRadius;
      steps.push(
        `Scale chosen automatically before building: the enclosing radius ${fmt(enclosingRadius)} — past it the Rips complex ` +
        `is a cone, so no finite bar dies later. Projected ${proj.count.toLocaleString("en-US")} simplices, within the ` +
        `${MAX_SIMPLICES.toLocaleString("en-US")} cap.`
      );
    } else {
      scaleSource = "projected simplex cap";
      scale = proj.scale ?? 0;
      const why = proj.overBudget
        ? `the 3-simplex projection reached its work budget`
        : `the projected simplex count at the enclosing radius ${fmt(enclosingRadius)} exceeds the ${MAX_SIMPLICES.toLocaleString("en-US")} cap`;
      if (proj.scale === null) {
        // Not even the shortest edge group fits: vertices only.
        scale = 0;
        steps.push(`Scale: ${why}, and even the shortest edge length brings in more than the cap, so only the vertices were built.`);
        capped = (capped ? capped + " " : "") +
          `Even the shortest edges of this cloud bring in more than ${MAX_SIMPLICES.toLocaleString("en-US")} simplices at once ` +
          `(many equal distances), so no edge could be built — every bar is censored at scale 0. Subsample or perturb the points.`;
      } else {
        steps.push(
          `Scale chosen automatically before building: ${why}, so the filtration stops at ${fmt(scale)} — the largest edge ` +
          `length whose complex stays under the cap (${proj.count.toLocaleString("en-US")} simplices, counted before anything was built). ` +
          `Bars still alive there are CENSORED, not essential.`
        );
        capped = (capped ? capped + " " : "") +
          `The scale was lowered to ${fmt(scale)}, below the enclosing radius ${fmt(enclosingRadius)}, to keep the complex under ` +
          `${MAX_SIMPLICES.toLocaleString("en-US")} simplices. Bars alive at ${fmt(scale)} are drawn censored ("≥ ${fmt(scale)}"): they may die later. ` +
          `Give a scale, or use fewer points, to see further.`;
      }
    }
  }
  steps.push(
    `Vietoris–Rips filtration up to scale ${fmt(scale)}, homology to ${Hk(maxDim)} over ${fieldName(p)} ` +
    `(simplices to dimension ${topDim}, since a class in ${Hk(maxDim)} can only be killed by a ${topDim}-simplex).`
  );

  const { simplices, truncated, completedDim } = ripsComplex(dist, m, topDim, scale);
  if (truncated) {
    capped = (capped ? capped + " " : "") +
      `The complex hit the ${MAX_SIMPLICES.toLocaleString()}-simplex cap and was cut short. `;
    // A cut that lands BELOW the killing dimension is not a small omission — it
    // changes the answer qualitatively. A loop can only be filled in by a
    // triangle, so if triangles were never built, every loop looks immortal and
    // the H1 barcode is not merely incomplete, it is misleading. Say which.
    if (completedDim < topDim) {
      const unreliable: number[] = [];
      for (let d = 0; d <= maxDim; d++) if (d + 1 > completedDim) unreliable.push(d);
      if (unreliable.length) {
        capped +=
          `Simplices were only completed up to dimension ${completedDim}, so ` +
          `H${unreliable.join(", H")} ${unreliable.length > 1 ? "are" : "is"} NOT RELIABLE here: ` +
          `a class in H${unreliable[0]} can only be killed by a ${unreliable[0] + 1}-simplex, and those were not all built, ` +
          `so features will appear to live forever whether or not they really do. ` +
          `Use fewer points or a smaller maximum scale before reading anything into those bars.`;
      }
    } else {
      capped += `Bars near the largest scales may be missing. Reduce the number of points or the maximum scale for a complete answer.`;
    }
  }

  // Filtration order: by birth, then by dimension so a face precedes its coface.
  simplices.sort((a, b) => a.birth - b.birth || a.dim - b.dim || a.verts.length - b.verts.length);

  const cells: number[] = [];
  for (const s of simplices) cells[s.dim] = (cells[s.dim] ?? 0) + 1;
  for (let d = 0; d < cells.length; d++) if (cells[d] === undefined) cells[d] = 0;
  steps.push(`Simplices built: ${cells.map((c, d) => `${c} in dim ${d}`).join(", ")}.`);

  const pairs = barsFrom(simplices, reduceOver(simplices, p), maxDim, scale);
  sortBars(pairs);

  let comparison: PersistenceResult["comparison"];
  let torsion: string[] = [];
  if (p !== 2) {
    const f2 = barsFrom(simplices, reduceOver(simplices, 2), maxDim, scale);
    sortBars(f2);
    comparison = { field: 2, pairs: f2 };
    torsion = torsionEvidence(f2, pairs, p, scale, maxDim);
    steps.push(
      torsion.length
        ? `Compared with ${fieldName(2)} on the same filtration: ${torsion.length} long bar${torsion.length > 1 ? "s differ" : " differs"} — see the torsion lines.`
        : `Compared with ${fieldName(2)} on the same filtration: no long bar differs, so no torsion evidence at this scale.`
    );
  }

  const censored = pairs.filter((q) => q.death === null).length;

  // The headline: the longest FINITE bar in each dimension.
  const notable: FinitePersistencePair[] = [];
  for (let d = 0; d <= maxDim; d++) {
    const finite = pairs.filter(
      (q): q is FinitePersistencePair => q.dimension === d && q.death !== null && Number.isFinite(q.death)
    );
    if (finite.length) notable.push(finite.reduce((a, b) => (b.persistence > a.persistence ? b : a)));
  }

  let bettiAt: PersistenceResult["bettiAt"];
  if (typeof opts.bettiAt === "number") {
    const s = opts.bettiAt;
    const betti: number[] = new Array(maxDim + 1).fill(0);
    for (const q of pairs) {
      const alive = q.death === null ? q.birth <= s : q.birth <= s && q.death > s;
      if (alive) betti[q.dimension] += 1;
    }
    bettiAt = { scale: s, betti };
    if (s > scale && censored > 0) {
      bettiAt.undetermined =
        `Scale ${fmt(s)} is past the computed scale ${fmt(scale)}: ${censored} censored bar${censored > 1 ? "s were" : " was"} ` +
        `counted as alive, but ${censored > 1 ? "they" : "it"} may have died by then — these Betti numbers are upper bounds.`;
      steps.push(`At scale ${s}: Betti numbers at most ${betti.join(", ")} (past the computed scale).`);
    } else {
      steps.push(`At scale ${s}: Betti numbers ${betti.join(", ")}.`);
    }
  }

  if (p === 2) {
    caveats.push(
      "Coefficients are 𝔽₂, so this detects holes but not orientation or torsion — a Klein bottle and a torus give the same " +
      "𝔽₂ barcode. Add a line \"over F3\" or \"compare\" to separate them."
    );
  } else {
    caveats.push(
      `Coefficients are ${fieldName(p)}. A bar present over 𝔽₂ but not over ${fieldName(p)} (or the reverse) is evidence of ` +
      `torsion by universal coefficients; a single field cannot tell torsion from a hole.`
    );
  }
  for (const t of torsion) caveats.push(t);
  if (censored) {
    caveats.push(
      `${censored} bar${censored > 1 ? "s were" : " was"} still alive at the largest scale computed (${fmt(scale)}) and ` +
      `${censored > 1 ? "are" : "is"} CENSORED — drawn with a dashed end labelled "≥ ${fmt(scale)}". Censored is not essential: ` +
      `nothing was computed past ${fmt(scale)}.`
    );
  }
  caveats.push(
    "The Vietoris–Rips complex is a PROXY for the shape the points were sampled from, not the shape itself, and the answer depends on the metric — Euclidean distance is what was used."
  );
  caveats.push(
    "A long bar is EVIDENCE of a feature at that scale, not proof of one. Short bars are usually sampling noise; the contrast between the longest bar and the rest is what carries the signal."
  );
  if (capped) caveats.push(capped);

  return {
    points: m, dimensions: use[0].length, cells, maxScale: scale,
    field: p, scaleUsed: scale, scaleSource, enclosingRadius, diameter, subsample,
    pairs, notable, censored, comparison, torsion, bettiAt, steps, caveats, capped,
  };
}

// ---------------------------------------------------------------------------
// Homology over 𝔽p from an integral result (universal coefficients)
// ---------------------------------------------------------------------------

/**
 * Homology over 𝔽p from an INTEGRAL result, by universal coefficients:
 * β_k(𝔽p) = β_k + #{torsion of H_k divisible by p} + #{torsion of H_{k−1} divisible by p}.
 * Reads `torsion` only — it never re-runs a reduction (one SNF in the tree).
 * Throws a named Error when p is not an admissible prime.
 */
export function homologyOverField(h: HomologyResult, p: number): FieldHomology {
  requirePrime(p);
  const P = BigInt(p);
  const ZERO = BigInt(0);
  const F = fieldName(p);
  const divisible = (ts: bigint[] | undefined) => (ts ?? []).filter((t) => t % P === ZERO);
  const betti: number[] = [];
  const groups: string[] = [];
  const steps: string[] = [
    `Universal coefficients: Hₖ(X; ${F}) = Hₖ(X) ⊗ ${F} ⊕ Tor(Hₖ₋₁(X), ${F}); ℤ/m ⊗ ${F} and Tor(ℤ/m, ${F}) are ${F} when ${p} divides m, else 0.`,
  ];
  for (let k = 0; k < h.betti.length; k++) {
    const own = divisible(h.torsion[k]);
    const below = k > 0 ? divisible(h.torsion[k - 1]) : [];
    const b = h.betti[k] + own.length + below.length;
    betti.push(b);
    groups.push(b === 0 ? "0" : b === 1 ? F : `${F}${superscript(b)}`);
    const parts = [`rank ${h.betti[k]} from the free part`];
    if (own.length) parts.push(`+${own.length} from ${own.map((t) => `ℤ/${t}`).join(", ")} ⊗ ${F} (torsion of ${Hk(k)})`);
    if (below.length) parts.push(`+${below.length} from Tor(${below.map((t) => `ℤ/${t}`).join(", ")}, ${F}) (torsion of ${Hk(k - 1)})`);
    steps.push(`${Hk(k)}(X; ${F}) = ${groups[k]}: ${parts.join(" ")}.`);
  }
  return { p, betti, groups, steps };
}

// ---------------------------------------------------------------------------
// Barcode figure.
//
// A dedicated builder rather than plot.ts's: a barcode is not a function plot.
// Each bar is a horizontal segment from birth to death at its own row, grouped
// by dimension. An ESSENTIAL bar runs off the right edge with an arrow; a
// CENSORED bar ends in a dashed stub with no arrow and the "≥ s" note, because
// "never dies" and "not computed past s" are different statements.
// ---------------------------------------------------------------------------

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHADE = ["#9DB3C4", "#0C4A6E", "#1A1A1A"];

function barcodePanel(
  pairs: PersistencePair[], xMaxIn: number, x0: number, y0: number, width: number, height: number, title: string
): string {
  const padL = 54, padR = 26, padT = 30, padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const bars = pairs.slice().sort((a, b) => a.dimension - b.dimension || a.birth - b.birth);
  let out = `<g transform="translate(${x0}, ${y0})">`;
  out += `<text x="${padL}" y="18" font-family="Georgia,serif" font-size="12" fill="#1b1b1f">${escapeXml(title)}</text>`;
  if (!bars.length) {
    out += `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Georgia,serif" font-size="13" fill="#5b5b66">No persistent features found.</text></g>`;
    return out;
  }
  const xMax = xMaxIn > 0 ? xMaxIn : 1;
  const x = (v: number) => padL + (Math.min(v, xMax) / xMax) * plotW;
  // Rows shrink to fit: a row floor would push bars below the frame and
  // through the tick labels (the v2.138 "line crosses 2.05" figure defect).
  const rowH = Math.min(12, plotH / bars.length);
  // Axis.
  out += `<g stroke="#1A1A1A" stroke-width="1" fill="none"><path d="M${padL} ${padT + plotH} H${padL + plotW}"/></g>`;
  // The scale axis is an axis.ts ROW on [0, xMax]: quarters of xMax labelled
  // one by one read `0 0.487 0.975 1.46 1.95` (mixed decimals, odd values).
  const row = linearAxis(0, xMax, { target: 5 });
  row.values.forEach((v, i) => {
    const px = x(v).toFixed(1);
    out += `<path d="M${px} ${padT + plotH} V${padT + plotH + 5}" stroke="#1A1A1A" stroke-width="1"/>`;
    out += `<text x="${px}" y="${padT + plotH + 18}" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#7B8C99">${row.labels[i]}</text>`;
  });
  const axisTitle = row.multiplier ? `scale (ε) (${row.multiplier})` : "scale (ε)";
  out += `<text x="${padL + plotW / 2}" y="${height - 6}" text-anchor="middle" font-family="Georgia,serif" font-size="10" fill="#7B8C99">${axisTitle}</text>`;

  // Bars, darker with increasing dimension so H0 and H1 are distinguishable in
  // black and white — this figure goes into patent-style documents.
  const sw = Math.max(0.6, rowH * 0.6);
  let anyCensored = false;
  bars.forEach((b, i) => {
    const y = padT + i * rowH + rowH / 2;
    const x1 = x(b.birth);
    const color = SHADE[Math.min(b.dimension, 2)];
    if (b.death === null) {
      anyCensored = true;
      const x2 = x(b.censoredAt ?? xMax);
      const stub = Math.min(10, Math.max(0, x2 - x1));
      out += `<path d="M${x1.toFixed(1)} ${y.toFixed(1)} H${(x2 - stub).toFixed(1)}" stroke="${color}" stroke-width="${sw.toFixed(1)}" stroke-linecap="butt"/>`;
      out += `<path d="M${(x2 - stub).toFixed(1)} ${y.toFixed(1)} H${x2.toFixed(1)}" stroke="${color}" stroke-width="${sw.toFixed(1)}" stroke-dasharray="2 2" stroke-linecap="butt"/>`;
      return;
    }
    const infinite = !Number.isFinite(b.death);
    const x2 = infinite ? padL + plotW : x(b.death);
    out += `<path d="M${x1.toFixed(1)} ${y.toFixed(1)} H${x2.toFixed(1)}" stroke="${color}" stroke-width="${sw.toFixed(1)}" stroke-linecap="butt"/>`;
    if (infinite) {
      out += `<path d="M${(x2 - 6).toFixed(1)} ${(y - 3).toFixed(1)} l6 3 l-6 3" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    }
  });

  // Legend: one swatch per dimension, then the censoring note when it applies.
  const dims = [...new Set(bars.map((b) => b.dimension))].sort();
  dims.forEach((d, i) => {
    out += `<g transform="translate(${padL + plotW - 60 - i * 56}, 18)">` +
      `<path d="M0 -4 H14" stroke="${SHADE[Math.min(d, 2)]}" stroke-width="3"/>` +
      `<text x="18" y="0" font-family="Georgia,serif" font-size="10" fill="#1b1b1f">H${escapeXml(subscript(d))}</text></g>`;
  });
  if (anyCensored) {
    // At the foot, LEFT-aligned and short. Right-aligned it ran under the
    // centred "scale (ε)" label, and on the title line it hit the H₀/H₁ keys —
    // both found by the figure gate's first censored barcode (v2.138.0
    // compare entry). Left of the axis label there is room for ~30 characters.
    out += `<text x="6" y="${height - 6}" font-family="Georgia,serif" font-size="9" fill="#5b5b66">` +
      `dashed: alive at ≥ ${escapeXml(fmtValue(xMax))} (censored)</text>`;
  }
  out += `</g>`;
  return out;
}

/**
 * The barcode. With `{ compare: true }` and an 𝔽₂ comparison on the result,
 * two panels are stacked — 𝔽₂ above, 𝔽p below, on the same scale axis — so
 * the bar a torsion class removes is visible as a row that is missing.
 * Field labels use ℤ/p (𝔽p is ℤ/p) because ℤ is in far more fonts than 𝔽.
 */
export function barcodeSvg(
  res: PersistenceResult, width = 460, height = 300, opts: { compare?: boolean } = {}
): string {
  const field = res.field ?? 2;
  const header = (f: number) => `Persistence barcode${f === 2 && !res.comparison ? "" : ` over ℤ/${f}`}`;
  const twoPanels = !!(opts.compare && res.comparison);
  const H = twoPanels ? height * 2 : height;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">`;
  out += `<rect width="${width}" height="${H}" fill="#fff"/>`;
  if (!res.pairs.length && !twoPanels) {
    out += `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Georgia,serif" font-size="13" fill="#5b5b66">No persistent features found.</text></svg>`;
    return out;
  }
  if (twoPanels) {
    out += barcodePanel(res.comparison!.pairs, res.maxScale, 0, 0, width, height, header(res.comparison!.field));
    out += barcodePanel(res.pairs, res.maxScale, 0, height, width, height, header(field));
  } else {
    out += barcodePanel(res.pairs, res.maxScale, 0, 0, width, height, header(field));
  }
  out += `</svg>`;
  return out;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Parses pasted rows of coordinates: "1 2", "1,2,3", one point per line. */
// The cloud-BODY reader: parsePersistenceRequest hands it the data rows after
// taking the header lines out (and reporting them). Rows are read by the same
// DATA_ROW / rowNumbers rules, so U+2212 minus is a minus, never dropped.
export function parsePointCloud(text: string): number[][] | null {
  const rows: number[][] = [];
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.trim();
    if (!line || !DATA_ROW.test(line)) continue; // skip blank lines and headers
    const nums = rowNumbers(line);
    if (nums.length >= 1 && nums.every(Number.isFinite)) rows.push(nums);
  }
  if (rows.length < 2) return null;
  // Every point must have the same dimension, or the metric is meaningless.
  const d = rows[0].length;
  if (!rows.every((r) => r.length === d)) return null;
  return rows;
}

/** 𝔽→F, ℤ→Z, subscript digits → digits, U+2212 → "-": one spelling for the matchers. */
function normaliseHeader(s: string): string {
  let t = s.replace(/𝔽/g, "F").replace(/ℤ/g, "Z").replace(/ℚ/g, "Q").replace(/ℝ/g, "R").replace(/ℂ/g, "C").replace(/−/g, "-");
  for (let d = 0; d <= 9; d++) t = t.split(SUB[d]).join(String(d));
  return t;
}

/**
 * Reads the field token at the START of `s` (already normalised): F3, F_3,
 * GF(3), Z/3, Z/3Z, Z_3, Z (the integers), Q/R/C. Null when none is there.
 */
function fieldToken(s: string, numericOnly = false): FieldSpec | null {
  let m = /^(?:F|GF)\s*_?\s*\(?\s*(\d+)\s*\)?/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    const why = fieldRefusal(n, "F");
    return why ? { ok: false, error: why } : { ok: true, p: n };
  }
  m = /^Z\s*(?:\/|_)\s*(\d+)/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    const why = fieldRefusal(n, "Z");
    return why ? { ok: false, error: why } : { ok: true, p: n };
  }
  // After a bare "in" only an explicit modulus counts: "points in Z^2" or
  // "data in R^3" is a description, not a coefficient request.
  if (numericOnly) return null;
  if (/^(?:Z|integers?)(?![A-Za-z0-9/_])/i.test(s)) {
    return {
      ok: false,
      error: "Over ℤ there is no barcode — persistence needs FIELD coefficients (the decomposition into bars is a theorem over a field). " +
        "To see integral torsion, compare two fields: add the line \"compare\" (𝔽₂ against 𝔽₃); a bar present over one and absent over the other is evidence of torsion.",
    };
  }
  if (/^(?:Q|R|C|rationals?|reals?|complex(?:es)?)(?![A-Za-z0-9])/i.test(s)) {
    return {
      ok: false,
      error: "Only the prime fields 𝔽ₚ are computed here; characteristic-0 coefficients (ℚ, ℝ, ℂ) are not. Use e.g. \"over F3\".",
    };
  }
  return null;
}

/**
 * Reads one coefficient-field phrase — "over F3", "over 𝔽₃", "mod 3", "Z/3",
 * "coefficients in F3", "with Z/3 coefficients", "field 5", or a line that is
 * just "F3". Null when the text names no field (so callers fall through).
 * A refusal is `{ok: false, error}` with the reason named: ℤ/4 is not a field,
 * 𝔽₉ is not ℤ/9, ℤ gives no barcode, p above the exact-arithmetic cap.
 */
export function parseFieldSpec(text: string): FieldSpec | null {
  const s = normaliseHeader(text).trim();
  // "mod 3", "modulo 3", "integers mod 3": a ring ℤ/n was named.
  let m = /\bmod(?:ulo)?\s*(\d+)\b/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    const why = fieldRefusal(n, "Z");
    return why ? { ok: false, error: why } : { ok: true, p: n };
  }
  // "field 5", "field F5", "field = 5".
  m = /\bfield\s*(?:=|:)?\s*(?:F\s*_?\s*)?(\d+)\b/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    const why = fieldRefusal(n, "F");
    return why ? { ok: false, error: why } : { ok: true, p: n };
  }
  // Keyword-anchored: over / in / coefficients (in|over|=) <field>.
  const kw = /\b(over|in|coeff(?:icient)?s?(?:\s+(?:in|over))?)\b\s*(?:=|:)?\s*(?:the\s+)?(?:field\s+)?/gi;
  let k: RegExpExecArray | null;
  while ((k = kw.exec(s)) !== null) {
    const tok = fieldToken(s.slice(k.index + k[0].length), k[1].toLowerCase() === "in");
    if (tok) return tok;
  }
  // "with Z/3 coefficients", "F3 coefficients".
  const coeffAfter = /\b((?:F|GF|Z)\s*[_/(]?\s*\d+\s*\)?(?:\s*Z)?|Z|Q|R|C)\s+coeff/i.exec(s);
  if (coeffAfter) {
    const tok = fieldToken(coeffAfter[1]);
    if (tok) return tok;
  }
  // A line that is only a field: "F3", "Z/3", "GF(5)".
  if (/^(?:F|GF|Z)\s*[_/(]?\s*\d+\s*\)?(?:\s*Z)?\.?$/i.test(s)) return fieldToken(s);
  return null;
}

/** A data row: starts with a number (optionally signed, optionally in parentheses). */
const DATA_ROW = /^[(\s]*[+\-−]?(?:\d|\.\d)/;

/** Every number on a data row; U+2212 minus is read as a minus, never dropped. */
function rowNumbers(line: string): number[] {
  const t = line.replace(/−/g, "-");
  return (t.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(Number);
}

/**
 * Reads a pasted point cloud together with its header lines ("over F3",
 * "scale 2", "H2", "compare"). Null when the text is not a point cloud at all,
 * so routing can fall through; `{ok: false}` when it IS a cloud but a header
 * was refused by name. Every letter-led line that is not a recognised header
 * is returned in `ignored` — never silently dropped.
 */
export function parsePersistenceRequest(raw: string): PersistenceRequest | PersistenceRequestError | null {
  if (typeof raw !== "string") return null;
  const rows: number[][] = [];
  const dataLines: string[] = [];
  const headers: string[] = [];
  for (const piece of raw.split(/[\n;]/)) {
    const line = piece.trim();
    if (!line) continue;
    if (DATA_ROW.test(line)) {
      const nums = rowNumbers(line);
      if (nums.length >= 1 && nums.every(Number.isFinite)) { rows.push(nums); dataLines.push(line); }
      else headers.push(line);
    } else {
      headers.push(line);
    }
  }
  if (rows.length < 2) return null;
  // The body goes through the one cloud reader; null here can only mean ragged.
  const cloud = parsePointCloud(dataLines.join("\n"));
  const d = rows[0].length;
  const ragged = rows.findIndex((r) => r.length !== d);
  if (!cloud && ragged >= 0) {
    return {
      ok: false,
      error: `Row ${ragged + 1} of the points has ${rows[ragged].length} coordinate${rows[ragged].length > 1 ? "s" : ""} but row 1 has ${d} — ` +
        `every point needs the same dimension, or the distance between them is meaningless.`,
    };
  }

  let p = 2;
  let pSet = false;
  let maxScale: number | undefined;
  let maxDim = 1;
  let compare = false;
  const ignored: string[] = [];
  const read: string[] = [];
  for (const line of headers) {
    const s = normaliseHeader(line);
    let used = false;

    const field = parseFieldSpec(s);
    if (field) {
      if (!field.ok) return { ok: false, error: field.error };
      if (pSet && field.p !== p) {
        return { ok: false, error: `Two different fields were named (${fieldName(p)} and ${fieldName(field.p)}); name one, or write "compare".` };
      }
      p = field.p; pSet = true; used = true;
      read.push(`coefficients ${fieldName(p)}`);
    }

    const sc = /\b(?:max(?:imum)?\s*)?(?:scale|threshold|epsilon|eps|ε)\s*(?:=|:|of|to|is)?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i.exec(s);
    if (sc) {
      const v = Number(sc[1]);
      if (!Number.isFinite(v) || v < 0) return { ok: false, error: `The scale must be a number ≥ 0 (got ${sc[1]}).` };
      maxScale = v; used = true;
      read.push(`scale ${v} (yours, used as given)`);
    }

    const dims: number[] = [];
    const hRe = /\bH\s*_?\s*\{?\s*(\d+)\s*\}?(?![\d.])/g;
    let hm: RegExpExecArray | null;
    while ((hm = hRe.exec(s)) !== null) dims.push(Number(hm[1]));
    const dm = /\b(?:max(?:imum)?\s*)?(?:homology\s+)?dim(?:ension)?\s*(?:=|:|of|to|up to)?\s*(\d+)\b/i.exec(s);
    if (dm) dims.push(Number(dm[1]));
    if (dims.length) {
      const want = Math.max(...dims);
      if (want > MAX_DIM) {
        return { ok: false, error: `${Hk(want)} is not computed here: persistence runs H₀–${Hk(MAX_DIM)} (an ${Hk(want)} class needs ${want + 1}-simplices, and the Rips complex grows as C(n, ${want + 2})).` };
      }
      maxDim = want; used = true;
      read.push(`homology up to ${Hk(want)}`);
    }

    if (/\bcompare\b/i.test(s)) {
      compare = true; used = true;
      read.push("compare 𝔽₂ against another field");
    }

    if (!used) ignored.push(line);
  }

  return { ok: true, cloud: cloud ?? rows, p, maxScale, maxDim, compare, ignored, read };
}

/**
 * Test-only access to the stages, so the suite can check them in isolation:
 * the signed boundary (∂∘∂ = 0 mod p), the raw reductions on an explicit
 * complex with every simplex at birth 0 (essential classes = Betti numbers
 * over 𝔽p — the second route for §D), and the up-front projection.
 */
export const _internals = {
  signedBoundary,
  reduceF2,
  reduceFp,
  reduceCohomology,
  projectScale,
  maxminSubsample,
  modInverse,
  isPrime,
};
