// Alexander polynomial and K-theory — completing the topology brief's T3, and
// the generalised-cohomology item listed under A1 but never built.
//
// THE ALEXANDER POLYNOMIAL comes from the REDUCED BURAU representation of the
// braid group. For a braid β on n strands, ψ(β) is an (n−1)×(n−1) matrix over
// ℤ[t, t⁻¹], and
//
//     Δ(t) · (1 + t + … + t^(n−1)) = ± t^k · det(ψ(β) − I)
//
// so the polynomial is a determinant followed by an exact division. Every
// coefficient is an integer and the arithmetic is Laurent-polynomial arithmetic
// throughout — no floating point appears anywhere.
//
// It is defined only up to multiplication by ±t^k, so the output is NORMALISED
// to a canonical representative (lowest degree zero, positive leading
// coefficient) and says that it has been. Comparing two knots means comparing
// normalised forms, not raw ones.
//
// HONESTY, unchanged from the Jones module: the Alexander polynomial is NOT a
// complete invariant, and it is weaker than Jones in one specific and famous
// way — it CANNOT distinguish a knot from its mirror image, because it is
// symmetric under t → t⁻¹ by construction. It also fails to detect the unknot:
// the Kinoshita–Terasaka knot has Alexander polynomial 1. Both are stated on
// every result.

import { Laurent, lZero, lOne, lMono, lAdd, lMul, lFormat, Braid } from "./knots";
import {
  normaliseTopologyText, stripSpaceFiller, splitProduct, parseSpaceFactor,
  MAX_SPACE_INDEX, SpaceFactor, sup, factorName,
} from "./kReal";

// ---------------------------------------------------------------------------
// Laurent matrix helpers
// ---------------------------------------------------------------------------

type LMatrix = Laurent[][];

const lNeg = (a: Laurent): Laurent => {
  const out: Laurent = new Map();
  for (const [e, c] of a) out.set(e, -c);
  return out;
};

const lSub = (a: Laurent, b: Laurent): Laurent => lAdd(a, lNeg(b));
const lIsZero = (a: Laurent): boolean => [...a.values()].every((c) => c === 0);

function identity(n: number): LMatrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? lOne() : lZero()))
  );
}

function matMul(a: LMatrix, b: LMatrix): LMatrix {
  const n = a.length, m = b[0]?.length ?? 0, k = b.length;
  const out: LMatrix = Array.from({ length: n }, () => Array.from({ length: m }, () => lZero()));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = lZero();
      for (let p = 0; p < k; p++) s = lAdd(s, lMul(a[i][p], b[p][j]));
      out[i][j] = s;
    }
  }
  return out;
}

/**
 * Determinant by cofactor expansion. Exponential in n, but the reduced Burau
 * matrix is (strands − 1) square and braids people type have few strands, so
 * this stays small — and it avoids needing division in ℤ[t, t⁻¹], which has no
 * general exact division.
 */
function determinant(m: LMatrix): Laurent {
  const n = m.length;
  if (n === 0) return lOne();
  if (n === 1) return m[0][0];
  if (n === 2) return lSub(lMul(m[0][0], m[1][1]), lMul(m[0][1], m[1][0]));
  let out = lZero();
  for (let c = 0; c < n; c++) {
    if (lIsZero(m[0][c])) continue;
    const minor = m.slice(1).map((row) => row.filter((_, j) => j !== c));
    const term = lMul(m[0][c], determinant(minor));
    out = c % 2 === 0 ? lAdd(out, term) : lSub(out, term);
  }
  return out;
}

/**
 * Reduced Burau matrix of a single generator σᵢ (or its inverse) on n strands.
 * The reduced representation acts on an (n−1)-dimensional space.
 */
function burauGenerator(n: number, gen: number): LMatrix {
  const size = n - 1;
  const m = identity(size);
  const i = Math.abs(gen) - 1; // 0-based index of the generator
  const t = lMono(1);
  const negT = lMono(1, -1);
  const inv = gen < 0;

  if (!inv) {
    // σᵢ: rows i−1, i, i+1 of the reduced representation.
    if (i > 0) m[i][i - 1] = t;
    m[i][i] = negT;
    if (i < size - 1) m[i][i + 1] = lOne();
  } else {
    // σᵢ⁻¹ is the inverse matrix; written out directly to stay exact.
    const tInv = lMono(-1);
    if (i > 0) m[i][i - 1] = lOne();
    m[i][i] = lMono(-1, -1);
    if (i < size - 1) m[i][i + 1] = tInv;
  }
  return m;
}

/** Reduced Burau matrix of a whole braid word. */
export function burauMatrix(braid: Braid): LMatrix {
  const size = braid.strands - 1;
  let acc = identity(size);
  for (const g of braid.word) acc = matMul(acc, burauGenerator(braid.strands, g));
  return acc;
}

/**
 * Normalises a Laurent polynomial to a canonical representative: lowest degree
 * shifted to zero and the leading coefficient made positive. The Alexander
 * polynomial is only defined up to ±t^k, so without this two correct answers
 * for the same knot can look different.
 */
export function normaliseLaurent(a: Laurent): Laurent {
  const entries = [...a.entries()].filter(([, c]) => c !== 0);
  if (!entries.length) return lZero();
  entries.sort((x, y) => x[0] - y[0]);
  const shift = entries[0][0];
  const lastCoeff = entries[entries.length - 1][1];
  const sign = lastCoeff < 0 ? -1 : 1;
  const out: Laurent = new Map();
  for (const [e, c] of entries) out.set(e - shift, c * sign);
  return out;
}

/** Exact division of Laurent polynomials; null when it does not divide. */
export function lDivide(num: Laurent, den: Laurent): Laurent | null {
  const n = [...num.entries()].filter(([, c]) => c !== 0);
  const d = [...den.entries()].filter(([, c]) => c !== 0);
  if (!d.length) return null;
  if (!n.length) return lZero();
  const rem = new Map(n);
  const dDeg = Math.max(...d.map(([e]) => e));
  const dLead = den.get(dDeg)!;
  const out: Laurent = new Map();
  for (let guard = 0; guard < 500; guard++) {
    const live = [...rem.entries()].filter(([, c]) => c !== 0);
    if (!live.length) break;
    const rDeg = Math.max(...live.map(([e]) => e));
    const rLead = rem.get(rDeg)!;
    if (rLead % dLead !== 0) return null; // not an exact division over ℤ
    const q = rLead / dLead;
    const shift = rDeg - dDeg;
    out.set(shift, (out.get(shift) ?? 0) + q);
    for (const [e, c] of d) {
      const k = e + shift;
      const v = (rem.get(k) ?? 0) - q * c;
      if (v === 0) rem.delete(k);
      else rem.set(k, v);
    }
  }
  return [...rem.values()].some((c) => c !== 0) ? null : out;
}

export interface AlexanderResult {
  polynomial: Laurent;
  display: string;
  /** True when Δ(t) = Δ(t⁻¹) up to normalisation, which it always should be. */
  symmetric: boolean;
  determinant: number;
  steps: string[];
  caveats: string[];
}

/**
 * Alexander polynomial of the closure of a braid, exactly.
 * Returns null when the reduced Burau route does not divide cleanly, which is
 * an honest refusal rather than a rounded answer.
 */
export function alexanderPolynomial(braid: Braid): AlexanderResult | null {
  const n = braid.strands;
  if (n < 2) {
    // The unknot as a 1-strand braid: Δ = 1 by convention.
    return {
      polynomial: lOne(),
      display: "1",
      symmetric: true,
      determinant: 1,
      steps: ["A one-strand braid closes to the unknot, whose Alexander polynomial is 1."],
      caveats: [alexanderCaveat, mirrorCaveat],
    };
  }
  const steps: string[] = [];
  const psi = burauMatrix(braid);
  const size = n - 1;
  // det(ψ(β) − I)
  const shifted: LMatrix = psi.map((row, i) => row.map((v, j) => (i === j ? lSub(v, lOne()) : v)));
  const det = determinant(shifted);
  steps.push(`Reduced Burau matrix of the braid: ${size}×${size} over Z[t, t^-1].`);
  steps.push(`det(psi(beta) - I) computed exactly by cofactor expansion.`);

  // Divide by 1 + t + … + t^(n−1).
  let sum = lZero();
  for (let k = 0; k < n; k++) sum = lAdd(sum, lMono(k));
  const quotient = lDivide(det, sum);
  if (!quotient) {
    return null;
  }
  const poly = normaliseLaurent(quotient);
  steps.push(`Divided by 1 + t + ... + t^${n - 1}, then normalised to lowest degree 0 with a positive leading coefficient.`);

  // Δ(−1) is the knot determinant, and it is always odd for a knot.
  let determinantValue = 0;
  for (const [e, c] of poly) determinantValue += c * Math.pow(-1, e);
  determinantValue = Math.abs(Math.round(determinantValue));

  // Δ(t) must equal Δ(t⁻¹) up to units — a genuine self-check on the algebra.
  const reversed: Laurent = new Map();
  for (const [e, c] of poly) reversed.set(-e, c);
  const symmetric = sameLaurent(normaliseLaurent(reversed), poly);
  if (!symmetric) {
    steps.push("WARNING: the result is not symmetric under t -> 1/t, which every Alexander polynomial must be. Treat it with suspicion.");
  } else {
    steps.push("Symmetry check: Delta(t) = Delta(1/t) up to units, as it must be.");
  }

  return {
    polynomial: poly,
    display: lFormat(poly, "t"),
    symmetric,
    determinant: determinantValue,
    steps,
    caveats: [alexanderCaveat, mirrorCaveat],
  };
}

const alexanderCaveat =
  "The Alexander polynomial is NOT a complete invariant: distinct knots share it, and it FAILS TO DETECT THE UNKNOT — the Kinoshita-Terasaka knot has Alexander polynomial 1 despite being knotted. A match is evidence, never proof.";

const mirrorCaveat =
  "It also cannot distinguish a knot from its MIRROR IMAGE, because it is symmetric under t -> 1/t by construction. The Jones polynomial can, and does: the two trefoils have different Jones polynomials but the same Alexander polynomial. Use both.";

function sameLaurent(a: Laurent, b: Laurent): boolean {
  const ae = [...a.entries()].filter(([, c]) => c !== 0).sort((x, y) => x[0] - y[0]);
  const be = [...b.entries()].filter(([, c]) => c !== 0).sort((x, y) => x[0] - y[0]);
  if (ae.length !== be.length) return false;
  return ae.every(([e, c], i) => be[i][0] === e && be[i][1] === c);
}

// ---------------------------------------------------------------------------
// K-theory of simple spaces.
//
// Listed under A1 as computable and never built. It is computable precisely
// because BOTT PERIODICITY reduces it to a finite statement: complex K-theory
// is 2-periodic, so K⁰ and K¹ of a sphere are determined by its dimension mod 2
// and nothing else. That is a real theorem doing real work, not a lookup.
// ---------------------------------------------------------------------------

export interface KTheoryResult {
  space: string;
  k0: string;
  k1: string;
  reducedK0: string;
  steps: string[];
  caveats: string[];
  /** Set when the space was read but the answer is refused by name. */
  refused?: string;
}

const KO_POINTER =
  "This is COMPLEX K-theory, 2-periodic. Real K-theory KO is 8-periodic and gives different groups; it is computed separately — ask \"KO of S¹\".";

/** Ranks (K⁰, K¹) of a torsion-free factor, for the Künneth product. */
function kRanks(f: SpaceFactor): [bigint, bigint] | null {
  switch (f.kind) {
    case "point": return [1n, 0n];
    case "sphere": return f.n === 0 || f.n % 2 === 0 ? [2n, 0n] : [1n, 1n];
    case "cp": return [BigInt(f.n + 1), 0n];
    case "hp": return [BigInt(f.n + 1), 0n];
    case "torus": return f.n > 200 ? null : [1n << BigInt(f.n - 1), 1n << BigInt(f.n - 1)];
    case "rp": return null; // torsion: the Künneth formula has Tor terms
  }
}

// Display contract: every group and space below is TYPESET (ℤ², S², ℝP⁵, ×,
// ⊕) and reads back through kReal's parseGroup / parseSpaceFactor.
const zRank = (r: bigint): string => (r === 0n ? "0" : r === 1n ? "ℤ" : `ℤ${sup(String(r))}`);

const asciiName = factorName;

/**
 * K⁰ and K¹ of the spaces where Bott periodicity settles the answer outright,
 * products of torsion-free ones by Künneth, and K̃⁰(ℝPⁿ) cited from Adams.
 * Returns null when no space could be read; a space that WAS read but is out
 * of scope comes back with `refused` set.
 */
export function kTheory(query: string): KTheoryResult | null {
  // "of a point", "of the torus": the framing words are stripped BEFORE the
  // anchored match — leaving them in is how "k-theory of a point" was refused.
  // A displayed answer line ("K⁰(S²) = ℤ ⊕ ℤ") reads back by its left side:
  // the K⁰/K¹/K̃⁰ prefix is stripped like the word "k-theory".
  const q = stripSpaceFiller(
    normaliseTopologyText(query).split("=")[0]
      .replace(/~?\bk\s*\^\s*-?\d+/g, " ")
      .replace(/\b(complex )?k[- ]?theory\b/g, " ")
      .replace(/\b(topological )?k-?groups?\b/g, " ")
  );
  if (!q) return null;

  // A PRODUCT is detected before any single-space pattern runs, and is never
  // answered by one of its factors.
  const parts = splitProduct(q);
  if (parts.length > 1) {
    if (parts.length > 32) return null;
    const fs = parts.map(parseSpaceFactor);
    if (fs.some((f) => f === null)) return null;
    if (fs.some((f) => f === "too-large")) {
      return {
        space: parts.join(" × "), k0: "—", k1: "—", reducedK0: "—", steps: [], caveats: [],
        refused: `An index is above the display limit (${MAX_SPACE_INDEX}).`,
      };
    }
    const factors = fs as SpaceFactor[];
    const name = factors.map(asciiName).join(" × ");
    const rp = factors.find((f) => f.kind === "rp");
    const ranks = factors.map(kRanks);
    if (rp || ranks.some((r) => r === null)) {
      return {
        space: name, k0: "—", k1: "—", reducedK0: "—", steps: [], caveats: [KO_POINTER],
        refused: rp
          ? `K-theory of a product with ℝP${sup((rp as { n: number }).n)} is not computed: ℝPⁿ has torsion in K-theory, so the Künneth formula has a Tor term and the answer is not the tensor product of the factors.`
          : "A torus factor is too large to expand.",
      };
    }
    let a0 = 1n, a1 = 0n;
    const lines: string[] = [];
    for (let i = 0; i < factors.length; i++) {
      const [b0, b1] = ranks[i] as [bigint, bigint];
      lines.push(`K*(${asciiName(factors[i])}) has ranks (K⁰, K¹) = (${b0}, ${b1}).`);
      [a0, a1] = [a0 * b0 + a1 * b1, a0 * b1 + a1 * b0];
    }
    return {
      space: name,
      k0: zRank(a0),
      k1: zRank(a1),
      reducedK0: zRank(a0 - 1n),
      steps: [
        ...lines,
        "Every factor has torsion-free K-theory, so the Künneth formula is EXACT: K*(X × Y) = K*(X) ⊗ K*(Y) as ℤ/2-graded groups (Atiyah, K-Theory, 1967).",
        "Ranks multiply as (a₀, a₁)·(b₀, b₁) = (a₀b₀ + a₁b₁, a₀b₁ + a₁b₀) — even times odd is odd.",
        `K⁰(${name}) = ${zRank(a0)}, K¹(${name}) = ${zRank(a1)}.`,
      ],
      caveats: [KO_POINTER, "Only the groups are reported; the ring structure carries more."],
    };
  }

  const f = parseSpaceFactor(q);
  if (f === "too-large") {
    return {
      space: q, k0: "—", k1: "—", reducedK0: "—", steps: [], caveats: [KO_POINTER],
      refused: `The index is above the display limit (${MAX_SPACE_INDEX}). Complex K-theory of a sphere depends only on n mod 2.`,
    };
  }
  if (!f) return null;

  // Spheres: complex K-theory is 2-periodic (Bott). No cap on n: n mod 2 is all
  // that matters, so a cap would be a refusal for the wrong reason.
  if (f.kind === "sphere") {
    const n = f.n;
    const even = n % 2 === 0;
    const S = `S${sup(n)}`;
    return {
      space: S,
      // K⁰(Sⁿ) = ℤ ⊕ ℤ for n even, ℤ for n odd (n > 0).
      k0: even ? "ℤ ⊕ ℤ" : "ℤ",
      k1: even ? "0" : "ℤ",
      reducedK0: even ? "ℤ" : "0",
      steps: [
        `Complex K-theory is 2-PERIODIC (Bott periodicity), so K*(${S}) depends only on ${n} mod 2.`,
        `${n} is ${even ? "even" : "odd"}, so K̃⁰(${S}) = ${even ? "ℤ" : "0"} and K¹(${S}) = ${even ? "0" : "ℤ"}.`,
        `Adding back the trivial summand from a point gives K⁰(${S}) = ${even ? "ℤ ⊕ ℤ" : "ℤ"}.`,
      ],
      caveats: [
        KO_POINTER,
        "Bott periodicity is what makes this a computation rather than a table: the answer follows from the dimension alone.",
      ],
    };
  }

  // Complex projective spaces: K⁰(ℂPⁿ) = ℤⁿ⁺¹, K¹ = 0.
  if (f.kind === "cp" && f.n >= 1) {
    const n = f.n;
    const C = `ℂP${sup(n)}`;
    return {
      space: C,
      k0: zRank(BigInt(n + 1)),
      k1: "0",
      reducedK0: zRank(BigInt(n)),
      steps: [
        `${C} has a CW structure with one cell in each even dimension 0, 2, …, ${2 * n} and none in odd dimensions.`,
        `With no odd cells the Atiyah–Hirzebruch spectral sequence collapses, so K¹ = 0 and K⁰ is free of rank ${n + 1}.`,
        `K⁰(${C}) = ${zRank(BigInt(n + 1))}, generated by powers of (H − 1) where H is the hyperplane bundle.`,
      ],
      caveats: [
        "The RING structure is ℤ[H]/(H − 1)ⁿ⁺¹, which carries more information than the group alone; only the group is reported here.",
        KO_POINTER,
      ],
    };
  }

  // A point (ℂP⁰ and ℝP⁰ are points too).
  if (f.kind === "point" || ((f.kind === "cp" || f.kind === "rp" || f.kind === "hp") && f.n === 0)) {
    return {
      space: "a point",
      k0: "ℤ", k1: "0", reducedK0: "0",
      steps: [
        ...(f.kind !== "point" ? [`${asciiName(f)} is a single point.`] : []),
        "K⁰ of a point is ℤ, generated by the trivial line bundle; K¹ is 0.",
      ],
      caveats: [KO_POINTER],
    };
  }

  if (f.kind === "torus") {
    const n = f.n;
    if (n > 200) return null;
    const r = 1n << BigInt(n - 1);
    return {
      space: `T${sup(n)}`,
      k0: zRank(r), k1: zRank(r), reducedK0: zRank(r - 1n),
      steps: [
        `The torus T${sup(n)} is a product of ${n} circles, each with K⁰ = K¹ = ℤ.`,
        `Künneth (exact, everything torsion-free; Atiyah, K-Theory, 1967) gives K⁰ = K¹ = ${zRank(r)} (rank 2${sup(n - 1)}).`,
      ],
      caveats: [KO_POINTER, "The torus is torsion-free, so K-theory sees nothing homology does not here."],
    };
  }

  if (f.kind === "hp") {
    const n = f.n;
    return {
      space: `ℍP${sup(n)}`,
      k0: zRank(BigInt(n + 1)), k1: "0", reducedK0: zRank(BigInt(n)),
      steps: [
        `ℍP${sup(n)} has one cell in each dimension 0, 4, …, ${4 * n} and none in odd dimensions.`,
        `With no odd cells the Atiyah–Hirzebruch spectral sequence collapses: K¹ = 0 and K⁰ is free of rank ${n + 1}.`,
      ],
      caveats: [KO_POINTER],
    };
  }

  // ℝPⁿ, n ≥ 1: K̃⁰ cited (Adams), K¹ from the Atiyah–Hirzebruch argument.
  const n = f.n;
  const m = Math.floor(n / 2);
  const red = m === 0 ? "0" : m <= 30 ? `ℤ/${2 ** m}` : `ℤ/2${sup(m)}`;
  const odd = n % 2 === 1;
  const R = `ℝP${sup(n)}`;
  return {
    space: R,
    k0: red === "0" ? "ℤ" : `ℤ ⊕ ${red}`,
    k1: odd ? "ℤ" : "0",
    reducedK0: red,
    steps: [
      `K̃⁰(${R}) is cyclic of order 2 to the power ⌊${n}/2⌋ = ${m}, generated by L − 1 (L the complexified canonical line bundle): ${red}.`,
      `K¹: the only odd-degree integral cohomology of ${R} is ${odd ? `the top class H${sup(n)} = ℤ (n odd)` : "zero (n even)"}; in the Atiyah–Hirzebruch spectral sequence ${odd ? "no differential leaves the top degree; none can hit that ℤ from a ℤ/2 (a map ℤ/2 → ℤ is zero); and none starts in column 0, because H⁰ = K(pt) splits off through the basepoint. So the single odd entry survives and" : "there is no odd-degree entry at all, so"} K¹(${R}) = ${odd ? "ℤ" : "0"}.`,
    ],
    caveats: [
      "K̃⁰(ℝPⁿ) = ℤ/2 to the power ⌊n/2⌋: Adams, \"Vector fields on spheres\", Ann. of Math. 75 (1962). CITED, not derived.",
      KO_POINTER,
    ],
  };
}
