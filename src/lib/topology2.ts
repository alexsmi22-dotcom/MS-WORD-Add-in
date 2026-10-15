// Advanced algebraic topology — GEOMETRY-TOPOLOGY-DESIGN.md Release A, tier A1.
//
// The brief splits the advanced list by COMPUTABILITY REGIME, and that split is
// the load-bearing part of the design. This module implements only tier A1 —
// the part that is exactly computable — and says so:
//
//   A1 (HERE): cellular homology, characteristic classes, cobordism invariants.
//              Exact integer and symmetric-polynomial algebra.
//   A2 (NOT):  spectral sequences. The E₂ page is computable; the differentials
//              and the extension problem at the abutment are NOT determined by
//              the algebra, so shipping a computed H* would be a fabrication.
//   A3 (NOT):  stable homotopy groups of spheres. Known only in a finite range,
//              at the cost of decades of work. Nothing here can compute them;
//              they could only ever be a cited table.
//
// The hard boundary from §0 stands throughout: the word problem for groups and
// the homeomorphism problem are UNDECIDABLE, so nothing here decides whether two
// spaces are the same. What it does decide, it decides exactly.

import { smithNormalForm } from "./homology";
// Import cycle (cobordism.ts reads partitions/binomials from here): every use on
// both sides is inside a function body, never at module load.
import { realProjectiveSwNumbers } from "./cobordism";
import { sup, sub } from "./kReal";

// ---------------------------------------------------------------------------
// Cellular homology.
//
// Why this is worth having when simplicial homology already exists: a CW
// structure needs far fewer cells. ℝP² is 6 vertices, 15 edges and 10 triangles
// simplicially, but ONE cell in each of dimensions 0, 1 and 2 as a CW complex.
// The boundary map is then the matrix of DEGREES of the attaching maps, which
// the user supplies, and the homology is the same exact integer linear algebra
// — just on a matrix small enough to read.
// ---------------------------------------------------------------------------

export interface CWComplex {
  name?: string;
  /** Number of cells in each dimension, index = dimension. */
  cells: number[];
  /**
   * Degree matrices. `boundaries[k]` is the matrix of ∂ₖ from k-cells to
   * (k−1)-cells: rows indexed by (k−1)-cells, columns by k-cells. Omitted or
   * empty means the zero map.
   */
  boundaries: Record<number, number[][]>;
}

export interface CellularResult {
  cells: number[];
  betti: number[];
  torsion: bigint[][];
  groups: string[];
  euler: number;
  eulerFromBetti: number;
  eulerAgrees: boolean;
  steps: string[];
  caveats: string[];
}

function formatGroup(beta: number, torsion: bigint[]): string {
  const parts: string[] = [];
  if (beta === 1) parts.push("Z");
  else if (beta > 1) parts.push(`Z^${beta}`);
  for (const d of torsion) parts.push(`Z/${d}`);
  return parts.length ? parts.join(" + ") : "0";
}

/**
 * Homology of a CW complex from its cellular boundary maps.
 * Identical algebra to the simplicial case — Smith Normal Form over ℤ, so
 * torsion survives — on a much smaller matrix.
 */
export function cellularHomology(cw: CWComplex): CellularResult {
  const steps: string[] = [];
  const caveats: string[] = [];

  // Validate before computing. A negative cell count produced a NEGATIVE Betti
  // number that formatted as the trivial group "0", and a degree of 2.7 was
  // silently truncated to 2 — both answering confidently for something the user
  // did not describe. Nonsense in must be refused, not rounded.
  cw.cells.forEach((c, k) => {
    if (!Number.isInteger(c) || c < 0) {
      throw new Error(`The cell count for dimension ${k} is ${c}; it must be a non-negative whole number.`);
    }
  });
  for (const key of Object.keys(cw.boundaries)) {
    const k = Number(key);
    if (k > cw.cells.length - 1) {
      throw new Error(
        `A boundary matrix was given for dimension ${k}, but the complex only has cells up to dimension ${cw.cells.length - 1}.`
      );
    }
    for (const row of cw.boundaries[k] ?? []) {
      for (const v of row) {
        if (!Number.isInteger(v)) {
          throw new Error(
            `The boundary matrix for dimension ${k} contains ${v}. Entries are DEGREES of attaching maps, so they must be whole numbers.`
          );
        }
      }
    }
  }

  const dim = cw.cells.length - 1;
  const rank: number[] = new Array(dim + 2).fill(0);
  const divisors: bigint[][] = new Array(dim + 2).fill(null).map(() => []);

  for (let k = 1; k <= dim; k++) {
    const m = cw.boundaries[k];
    if (!m || !m.length || !m[0]?.length) continue;
    // Shape check: a wrong-shaped degree matrix is a typo, not a space.
    if (m.length !== cw.cells[k - 1] || m[0].length !== cw.cells[k]) {
      throw new Error(
        `The boundary matrix for dimension ${k} is ${m.length}x${m[0].length}, but it must be ` +
        `${cw.cells[k - 1]}x${cw.cells[k]} — rows are the ${k - 1}-cells and columns the ${k}-cells.`
      );
    }
    const snf = smithNormalForm(m.map((row) => row.map((v) => BigInt(Math.trunc(v)))));
    rank[k] = snf.rank;
    divisors[k] = snf.divisors;
  }

  const betti: number[] = [];
  const torsion: bigint[][] = [];
  const groups: string[] = [];
  for (let k = 0; k <= dim; k++) {
    const b = cw.cells[k] - rank[k] - rank[k + 1];
    betti.push(b);
    const t = (divisors[k + 1] ?? []).filter((d) => d > 1n);
    torsion.push(t);
    groups.push(formatGroup(b, t));
  }

  const euler = cw.cells.reduce((s, c, k) => s + (k % 2 === 0 ? c : -c), 0);
  const eulerFromBetti = betti.reduce((s, b, k) => s + (k % 2 === 0 ? b : -b), 0);
  const eulerAgrees = euler === eulerFromBetti;

  steps.push(`Cells: ${cw.cells.map((c, k) => `${c} in dim ${k}`).join(", ")}.`);
  steps.push(`Euler characteristic from cell counts: ${euler}; from Betti numbers: ${eulerFromBetti}.`);
  if (eulerAgrees) steps.push("The two agree — the same independent check the simplicial path runs.");
  else caveats.push(
    `INTERNAL CHECK FAILED: χ from cells (${euler}) and from Betti numbers (${eulerFromBetti}) disagree. ` +
    `They are equal for every finite complex, so this result is not trustworthy — check the degree matrices.`
  );
  if (torsion.some((t) => t.length)) {
    caveats.push("This complex has TORSION, which is what the integer computation preserves and a field-coefficient Betti number would discard.");
  }
  caveats.push(
    "The boundary maps are the DEGREES OF THE ATTACHING MAPS, which you supplied — this computes the homology of the complex you described, and cannot check that the description matches the space you had in mind."
  );

  return { cells: cw.cells.slice(), betti, torsion, groups, euler, eulerFromBetti, eulerAgrees, steps, caveats };
}

/** CW structures small enough to read, with their textbook homology. */
export const CW_BUILTIN: Record<string, () => CWComplex> = {
  // One cell in each dimension; ∂₂ has degree 2 — the whole reason ℝP² has ℤ/2.
  rp2: () => ({ name: "ℝP² as a CW complex", cells: [1, 1, 1], boundaries: { 1: [[0]], 2: [[2]] } }),
  // The degree-n analogue: the pseudo-projective / Moore space with H₁ = ℤ/n.
  "moore-3": () => ({ name: "Moore space with H₁ = ℤ/3", cells: [1, 1, 1], boundaries: { 1: [[0]], 2: [[3]] } }),
  sphere: () => ({ name: "S² as a CW complex", cells: [1, 0, 1], boundaries: {} }),
  torus: () => ({
    name: "T² as a CW complex",
    // One vertex, two edges a and b, one face attached along aba⁻¹b⁻¹ — total
    // degree zero on each edge, which is why the torus is torsion-free.
    cells: [1, 2, 1],
    boundaries: { 1: [[0, 0]], 2: [[0], [0]] },
  }),
  klein: () => ({
    name: "Klein bottle as a CW complex",
    // Attached along abab⁻¹: degree 2 on a, 0 on b — the ℤ/2 comes straight out.
    cells: [1, 2, 1],
    boundaries: { 1: [[0, 0]], 2: [[2], [0]] },
  }),
  circle: () => ({ name: "S¹ as a CW complex", cells: [1, 1], boundaries: { 1: [[0]] } }),
  point: () => ({ name: "a point", cells: [1], boundaries: {} }),
};

// ---------------------------------------------------------------------------
// Characteristic classes.
//
// Via the SPLITTING PRINCIPLE, which turns this into symmetric-polynomial
// algebra: pretend a rank-n bundle splits as a sum of line bundles with first
// Chern classes x₁…xₙ, and the total Chern class is ∏(1 + xᵢ). Any symmetric
// polynomial in the xᵢ is then a polynomial in the Chern classes, so the whole
// calculus of sums, duals and tensor products is exact arithmetic on
// coefficients. Nothing here is estimated.
// ---------------------------------------------------------------------------

/**
 * A total characteristic class as its list of graded components,
 * `[c₀, c₁, c₂, …]` with c₀ = 1. Coefficients are exact integers.
 */
export type TotalClass = number[];

/** Whitney sum: c(E ⊕ F) = c(E)·c(F). Polynomial multiplication, truncated. */
export function whitneySum(a: TotalClass, b: TotalClass, truncate = Infinity): TotalClass {
  const out: number[] = new Array(Math.min(a.length + b.length - 1, truncate + 1)).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (i + j < out.length) out[i + j] += a[i] * b[j];
    }
  }
  return out;
}

/**
 * Total Chern class of a sum of line bundles with the given first Chern
 * classes: ∏(1 + xᵢ). The coefficients are the elementary symmetric
 * polynomials, which IS the statement of the splitting principle.
 */
export function chernOfLineSum(roots: number[]): TotalClass {
  let out: TotalClass = [1];
  for (const x of roots) out = whitneySum(out, [1, x]);
  return out;
}

// swOfLineSum (chernOfLineSum mod 2) was RETIRED in v2.139.0: cobordism.ts
// computes every Stiefel–Whitney class now, and it had no caller left.

/**
 * Total Chern class of the tautological/standard bundle constructions on ℂPⁿ:
 * c(T ℂPⁿ) = (1 + x)^{n+1}, truncated at degree n because xⁿ⁺¹ = 0 in the
 * cohomology ring. That truncation is the geometry, not an approximation.
 */
export function chernComplexProjectiveTangent(n: number): TotalClass {
  // The Solve routing caps n before it reaches here, so this is not currently
  // reachable with a hostile value — but the cap lives in a different file, and
  // `i < Infinity + 1` with a polynomial multiply per step hangs outright.
  if (!Number.isFinite(n) || n < 0) return [1];
  n = Math.min(Math.floor(n), MAX_CHAR_CLASS_DIM);
  let out: TotalClass = [1];
  for (let i = 0; i < n + 1; i++) out = whitneySum(out, [1, 1], n);
  return out.slice(0, n + 1);
}

/**
 * Total Stiefel–Whitney class of the tangent bundle of ℝPⁿ:
 * w(T ℝPⁿ) = (1 + a)^{n+1} mod 2, truncated at degree n.
 * This is the classical computation behind the parallelisability and
 * immersion results, and it is exact binomial arithmetic mod 2.
 */
/**
 * Largest dimension a characteristic class is computed in. The Solve routing
 * caps n well below this; the bound is here so the functions cannot hang no
 * matter who calls them.
 */
export const MAX_CHAR_CLASS_DIM = 512;

export function swRealProjectiveTangent(n: number): TotalClass {
  if (!Number.isFinite(n) || n < 0) return [1];
  n = Math.min(Math.floor(n), MAX_CHAR_CLASS_DIM);
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(Number(binomialMod2(n + 1, k)));
  return out;
}

/** C(n, k) mod 2 — by Kummer/Lucas, it is 1 exactly when k's bits ⊆ n's bits. */
export function binomialMod2(n: number, k: number): 0 | 1 {
  return (k & ~n) === 0 ? 1 : 0;
}

/** Exact binomial coefficient in bigint, for the integral classes. */
export function binomial(n: number, k: number): bigint {
  // `k > n` rejects the obvious nonsense but not a huge k with a huger n, and
  // each step here multiplies a bigint that is itself growing — so a large k
  // exhausts memory rather than merely taking a while. BigInt(Infinity) also
  // throws, which is a worse failure than an honest zero.
  if (!Number.isFinite(n) || !Number.isFinite(k)) return 0n;
  if (k < 0 || k > n || k > MAX_CHAR_CLASS_DIM) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

export interface CharClassResult {
  name: string;
  total: TotalClass;
  /** Human-readable, e.g. "1 + 3a + 3a² + a³". */
  display: string;
  steps: string[];
  caveats: string[];
}

const fmtClass = (c: TotalClass, sym: string): string => {
  const parts: string[] = [];
  c.forEach((v, i) => {
    if (v === 0) return;
    if (i === 0) parts.push(String(v));
    else {
      const coeff = v === 1 ? "" : String(v);
      parts.push(`${coeff}${sym}${i === 1 ? "" : sup(i)}`);
    }
  });
  return parts.length ? parts.join(" + ") : "0";
};

/**
 * Stiefel–Whitney class of T ℝPⁿ, with the classical consequences that follow
 * from it — each one a genuine deduction from the computed class, never a
 * looked-up fact.
 */
export function realProjectiveTangentClass(n: number): CharClassResult {
  const w = swRealProjectiveTangent(n);
  const R = `ℝP${sup(n)}`;
  const steps = [
    `w(T${R}) = (1 + a)${sup(n + 1)} truncated at degree ${n}, with coefficients mod 2.`,
    `Coefficients C(${n + 1}, k) mod 2: ${w.join(", ")}.`,
  ];
  const caveats: string[] = [];
  // w = 1 exactly when every binomial C(n+1, k) is even for 1 ≤ k ≤ n, which
  // happens precisely when n+1 is a power of 2.
  const trivial = w.slice(1).every((v) => v === 0);
  if (trivial) {
    steps.push(
      `Every coefficient above degree 0 vanishes, so w(T${R}) = 1. That happens exactly when ` +
      `${n + 1} is a power of two — a NECESSARY condition for ${R} to be parallelisable, though not a sufficient one.`
    );
    caveats.push(
      "A trivial total Stiefel–Whitney class does not prove parallelisability: it removes the obstruction this invariant can see, and others may remain. Only n = 1, 3 and 7 are actually parallelisable."
    );
  } else {
    const first = w.findIndex((v, i) => i > 0 && v !== 0);
    steps.push(
      `The first nonvanishing class above degree 0 is w${sub(first)} ≠ 0, which OBSTRUCTS parallelisability: ` +
      `${R} is not parallelisable.`
    );
  }
  return { name: `w(T${R})`, total: w, display: fmtClass(w, "a"), steps, caveats };
}

/**
 * Total Pontryagin class of T ℂPⁿ: p = (1 + x²)ⁿ⁺¹ truncated at x^{n+1} = 0
 * (Milnor–Stasheff, Characteristic Classes, 1974). Exact binomials.
 */
export function complexProjectivePontryaginClass(n: number): CharClassResult {
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) throw new Error(`ℂPⁿ needs a whole number n ≥ 1 (got ${n}).`);
  n = Math.min(n, MAX_CHAR_CLASS_DIM);
  // In x-degree units the class has terms x^{2i} for 2i ≤ n.
  const total: TotalClass = new Array(n + 1).fill(0);
  for (let i = 0; 2 * i <= n; i++) total[2 * i] = Number(binomial(n + 1, i));
  const C = `ℂP${sup(n)}`;
  return {
    name: `p(T${C})`,
    total,
    display: fmtClass(total, "x"),
    steps: [
      `p(T${C}) = (1 + x²)${sup(n + 1)}, truncated because x${sup(n + 1)} = 0 in H*(${C}).`,
      `pᵢ = C(${n + 1}, i)·x²ⁱ for 2i ≤ ${n}: ${total.filter((_, k) => k % 2 === 0).join(", ")}.`,
    ],
    caveats: [],
  };
}

/** Total Chern class of T ℂPⁿ, exact. */
export function complexProjectiveTangentClass(n: number): CharClassResult {
  const c = chernComplexProjectiveTangent(n);
  return {
    name: `c(TℂP${sup(n)})`,
    total: c,
    display: fmtClass(c, "x"),
    steps: [
      `c(TℂP${sup(n)}) = (1 + x)${sup(n + 1)}, truncated at degree ${n} because x${sup(n + 1)} = 0 in H*(ℂP${sup(n)}).`,
      `Coefficients C(${n + 1}, k): ${c.join(", ")}.`,
      `The top class c${sub(n)} = ${c[n]} is the Euler characteristic of ℂP${sup(n)}, which is ${n + 1}.`,
    ],
    caveats: [],
  };
}

// ---------------------------------------------------------------------------
// Unoriented cobordism.
//
// Thom: the unoriented cobordism ring is a polynomial algebra over 𝔽₂, and the
// STIEFEL–WHITNEY NUMBERS ARE A COMPLETE INVARIANT of an unoriented cobordism
// class. So "are these two manifolds cobordant?" is genuinely DECIDABLE here —
// one of the few equivalence questions in this whole area that is, which is
// exactly why it is worth implementing and worth saying out loud.
// ---------------------------------------------------------------------------

export interface CobordismResult {
  dimension: number;
  /** Stiefel–Whitney numbers, keyed by the partition that indexes them. */
  numbers: { partition: number[]; value: 0 | 1 }[];
  boundsAManifold: boolean;
  steps: string[];
  caveats: string[];
}

/** Partitions of n, used to index the Stiefel–Whitney numbers. */
/**
 * Largest n this enumerates partitions of. p(n) grows fast — p(40) is already
 * 37,338 lists and p(100) is 190 million — so the bound is about memory, not
 * just about Infinity. Well past the dimensions the cobordism route uses.
 */
export const MAX_PARTITION_N = 40;

export function partitions(n: number): number[][] {
  // `p--` on Infinity stays Infinity and `left === 0` is never reached, so the
  // recursion below never bottoms out.
  if (!Number.isFinite(n) || n < 0 || n > MAX_PARTITION_N) return [];
  const out: number[][] = [];
  const walk = (left: number, max: number, acc: number[]) => {
    if (left === 0) { out.push(acc.slice()); return; }
    for (let p = Math.min(left, max); p >= 1; p--) {
      acc.push(p);
      walk(left - p, p, acc);
      acc.pop();
    }
  };
  walk(n, n, []);
  return out;
}

/**
 * Stiefel–Whitney numbers of ℝPⁿ, and the resulting cobordism verdict.
 *
 * A closed manifold bounds iff ALL its Stiefel–Whitney numbers vanish (Thom).
 * For ℝPⁿ the classical answer is that it bounds exactly when n is ODD, and
 * this computes rather than asserts that: it evaluates each number from the
 * total class w = (1+a)^{n+1} in H*(ℝPⁿ; 𝔽₂) = 𝔽₂[a]/(a^{n+1}).
 */
export function realProjectiveCobordism(n: number): CobordismResult {
  // n itself is NEVER clamped — clamping 513 to 512 flips the verdict. Only
  // the displayed class is capped (swRealProjectiveTangent caps internally).
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`ℝPⁿ needs a whole number n ≥ 0 (got ${n}).`);
  }
  if (n === 0) {
    return {
      dimension: 0,
      numbers: [{ partition: [], value: 1 }],
      boundsAManifold: false,
      steps: ["ℝP⁰ is a single point; its only Stiefel–Whitney number is the point count mod 2 = 1, so it does NOT bound."],
      caveats: ["Stiefel–Whitney numbers are a COMPLETE invariant of unoriented cobordism (Thom), so this is genuinely decidable."],
    };
  }
  const w = swRealProjectiveTangent(n);
  const R = `ℝP${sup(n)}`;
  const steps = [
    n <= MAX_CHAR_CLASS_DIM
      ? `w(T${R}) = ${fmtClass(w, "a")} in 𝔽₂[a]/(a${sup(n + 1)}).`
      : `w(T${R}) = (1 + a)${sup(n + 1)} in 𝔽₂[a]/(a${sup(n + 1)}) (not expanded above degree ${MAX_CHAR_CLASS_DIM}).`,
  ];
  const wName = (part: number[]) => part.map((p) => `w${sub(p)}`).join("");
  // The numbers come from the cobordism RING engine (cobordism.ts), the same
  // code that answers products and connected sums — one engine, not two.
  // Above its dimension cap the verdict is the THEOREM, stated as such: the
  // old loop returned an EMPTY list there, and "every number vanishes" over an
  // empty list said "RP^42 bounds".
  const numbers: { partition: number[]; value: 0 | 1 }[] =
    n >= 1 && n <= MAX_PARTITION_N ? realProjectiveSwNumbers(n) : [];

  let boundsAManifold: boolean;
  if (numbers.length) {
    boundsAManifold = numbers.every((x) => x.value === 0);
    steps.push(
      boundsAManifold
        ? `Every Stiefel–Whitney number vanishes, so ${R} BOUNDS a compact manifold — it is null-cobordant.`
        : `At least one Stiefel–Whitney number is nonzero (${numbers.filter((x) => x.value).map((x) => wName(x.partition)).join(", ")}), so ${R} does NOT bound.`
    );
  } else {
    boundsAManifold = n % 2 === 1;
    steps.push(
      boundsAManifold
        ? `${R} BOUNDS a compact manifold: for n odd it is the circle bundle of the Hopf map over ℂP${sup((n - 1) / 2)}, hence the boundary of the associated disc bundle. (Above dimension ${MAX_PARTITION_N} the numbers are not enumerated; this is the geometric proof.)`
        : `${R} does NOT bound: its top number w${sub(n)}[${R}] = χ(${R}) mod 2 = 1. (Above dimension ${MAX_PARTITION_N} only this number is evaluated.)`
    );
  }
  steps.push(`This matches the classical result that ℝPⁿ bounds exactly when n is odd: ${n} is ${n % 2 === 0 ? "even" : "odd"}.`);

  return {
    dimension: n,
    numbers,
    boundsAManifold,
    steps,
    caveats: [
      "Stiefel–Whitney numbers are a COMPLETE invariant of unoriented cobordism (Thom), so two closed manifolds are unorientedly cobordant exactly when all of these agree. That makes this one of the few equivalence questions in algebraic topology that is genuinely decidable — unlike homeomorphism or homotopy equivalence, which are not.",
      `ORIENTED cobordism is a different question: ${R} is ${n % 2 === 1 ? "orientable (n odd)" : "NOT orientable (n even), so it has no oriented class at all"}. Oriented cobordism (Pontryagin numbers, signature, the cited Ωₙˢᴼ table for n ≤ 8) is answered separately — ask "oriented cobordism of …".`,
    ],
  };
}

// ---------------------------------------------------------------------------
// The boundary of what is computable — stated, not implemented.
// ---------------------------------------------------------------------------

export interface NotComputable {
  topic: string;
  whatIsComputable: string;
  whatIsNot: string;
  why: string;
}

/**
 * The A2/A3 boundary, as data rather than prose, so a caller can show it
 * instead of quietly returning nothing. Reporting a limit is a feature here:
 * the alternative is a tool that appears to answer and does not.
 */
export const BEYOND: Record<string, NotComputable> = {
  "spectral sequence": {
    topic: "Spectral sequences",
    whatIsComputable:
      "The E₂ page of a Serre, Mayer–Vietoris or Atiyah–Hirzebruch spectral sequence is computable from homology input, and displaying that page is genuinely useful.",
    whatIsNot:
      "The differentials, and the extension problem at the abutment, are NOT determined by the algebra. Two different spaces can share an E₂ page and differ in d₂.",
    why:
      "So an honest tool shows E₂ and marks which differentials remain undetermined; it never hands over a computed H* as though the sequence had collapsed. Not implemented here.",
  },
  "stable homotopy": {
    topic: "Stable homotopy groups of spheres",
    whatIsComputable: "Nothing, by computation from first principles at this scale.",
    whatIsNot:
      "πₙˢ is known only in a finite range, and that range is the product of decades of work (Adams spectral sequence, motivic methods).",
    why:
      "If these ever appear here they must be a CITED LITERATURE TABLE with the known range stated — held to the same standard as the NMR predictions, which say what they are.",
  },
  "fundamental group": {
    topic: "The fundamental group",
    whatIsComputable:
      "A presentation (edge-path group, or Wirtinger for a knot), and its abelianisation — which is H₁, and is fully computable.",
    whatIsNot:
      "Simplifying a presentation, or deciding whether the group is trivial. The word problem for groups is undecidable (Novikov–Boone).",
    why:
      "So π₁ can be presented and abelianised, never identified. Nothing here claims to name a group.",
  },
  homeomorphism: {
    topic: "Deciding whether two spaces are the same",
    whatIsComputable: "Invariants — homology, characteristic classes, cobordism class — which can tell spaces APART.",
    whatIsNot: "Homeomorphism and homotopy equivalence, which are undecidable for manifolds of dimension ≥ 4 (Markov).",
    why:
      "Matching invariants are evidence, never proof, of equivalence. This tool will say two spaces DIFFER when an invariant differs; it will never say they are the same.",
  },
};
