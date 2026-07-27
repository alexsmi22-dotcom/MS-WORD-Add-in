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
}

/**
 * K⁰ and K¹ of the spaces where Bott periodicity settles the answer outright.
 * Returns null for anything else rather than guessing — this is deliberately a
 * narrow, honest capability.
 */
export function kTheory(query: string): KTheoryResult | null {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();

  // Spheres: complex K-theory is 2-periodic (Bott).
  const sphere = /(?:^|\s)s\s*\^?\s*(\d+)|sphere\s*\^?\s*(\d+)/.exec(q);
  if (sphere) {
    const n = parseInt(sphere[1] ?? sphere[2], 10);
    if (!Number.isFinite(n) || n < 0 || n > 64) return null;
    const even = n % 2 === 0;
    return {
      space: `S^${n}`,
      // K⁰(Sⁿ) = Z ⊕ Z for n even, Z for n odd (n > 0).
      k0: n === 0 ? "Z + Z" : even ? "Z + Z" : "Z",
      k1: n === 0 ? "0" : even ? "0" : "Z",
      reducedK0: n === 0 ? "Z" : even ? "Z" : "0",
      steps: [
        `Complex K-theory is 2-PERIODIC (Bott periodicity), so K*(S^${n}) depends only on ${n} mod 2.`,
        `${n} is ${even ? "even" : "odd"}, so the reduced K^0 is ${even ? "Z" : "0"} and K^1 is ${even ? "0" : "Z"}.`,
        `Adding back the trivial summand from a point gives K^0(S^${n}) = ${even ? "Z + Z" : "Z"}.`,
      ],
      caveats: [
        "This is COMPLEX K-theory. Real K-theory KO is 8-periodic instead, and is not computed here.",
        "Bott periodicity is what makes this a computation rather than a table: the answer follows from the dimension alone.",
      ],
    };
  }

  // Complex projective spaces: K⁰(ℂPⁿ) = Z^{n+1}, K¹ = 0.
  const cp = /(?:^|\s)cp\s*\^?\s*(\d+)|complex projective\s*\^?\s*(\d+)/.exec(q);
  if (cp) {
    const n = parseInt(cp[1] ?? cp[2], 10);
    if (!Number.isFinite(n) || n < 1 || n > 64) return null;
    return {
      space: `CP^${n}`,
      k0: n + 1 === 1 ? "Z" : `Z^${n + 1}`,
      k1: "0",
      reducedK0: n === 1 ? "Z" : `Z^${n}`,
      steps: [
        `CP^${n} has a CW structure with one cell in each even dimension 0, 2, ..., ${2 * n} and none in odd dimensions.`,
        `With no odd cells the Atiyah-Hirzebruch spectral sequence collapses, so K^1 = 0 and K^0 is free of rank ${n + 1}.`,
        `K^0(CP^${n}) = Z^${n + 1}, generated by powers of (H - 1) where H is the hyperplane bundle.`,
      ],
      caveats: [
        "The RING structure is Z[H]/(H-1)^(n+1), which carries more information than the group alone; only the group is reported here.",
        "This is COMPLEX K-theory; KO is not computed.",
      ],
    };
  }

  // A point, and the torus, as the two other cases worth answering.
  if (/^(point|pt)$/.test(q)) {
    return {
      space: "a point",
      k0: "Z", k1: "0", reducedK0: "0",
      steps: ["K^0 of a point is Z, generated by the trivial line bundle; K^1 is 0."],
      caveats: ["This is COMPLEX K-theory."],
    };
  }
  if (/^(torus|t\^?2)$/.test(q)) {
    return {
      space: "T^2 (torus)",
      k0: "Z^2", k1: "Z^2", reducedK0: "Z",
      steps: [
        "The torus is S^1 x S^1; the Kunneth formula for K-theory gives K^0 = Z^2 and K^1 = Z^2.",
      ],
      caveats: ["This is COMPLEX K-theory.", "The torus is torsion-free, so K-theory sees nothing homology does not here."],
    };
  }
  return null;
}
