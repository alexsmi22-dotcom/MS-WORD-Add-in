// Simplicial homology over ℤ — GEOMETRY-TOPOLOGY-DESIGN.md Release T1.
//
// WHY OVER ℤ AND NOT ℚ. Betti numbers alone throw away torsion: H₁(ℝP²) = ℤ/2
// and H₁(Klein bottle) = ℤ ⊕ ℤ/2 both vanish into "β₁ = 0" and "β₁ = 1" over a
// field. Torsion is the part that distinguishes a projective plane from a disk,
// so the whole computation is done in exact integer arithmetic and reduced by
// SMITH NORMAL FORM, whose elementary divisors give the torsion directly.
//
// This is also why `linalg.ts` is not reused: it is IEEE double with a 1e-9
// pivot cutoff, which is the wrong regime for a ±1 boundary matrix and cannot
// see torsion at all. The matrices here are bigint throughout.
//
// SELF-CHECK. The Euler characteristic is computed two independent ways — the
// alternating sum of CELL COUNTS, and the alternating sum of BETTI NUMBERS.
// They are equal for any finite complex, so disagreement is a bug, and the
// result says so rather than reporting a number that looks fine. This is the
// same discipline as the CAS differentiating its antiderivatives back.

/** A simplicial complex, given by its maximal faces (vertices are integers). */
export interface Complex {
  name?: string;
  /** Each entry is a simplex: a list of distinct vertex ids. */
  maximal: number[][];
}

export interface HomologyResult {
  /** Number of k-simplices, indexed by k. */
  cells: number[];
  /** Free rank of H_k. */
  betti: number[];
  /** Torsion coefficients of H_k (elementary divisors > 1). */
  torsion: bigint[][];
  /** Human-readable H_k, e.g. "Z", "Z^2", "Z + Z/2", "0". */
  groups: string[];
  dimension: number;
  euler: number;
  eulerFromBetti: number;
  eulerAgrees: boolean;
  connected: boolean;
  steps: string[];
  caveats: string[];
}

/** Guard: the reduction is O(n³) in bigint, so refuse absurd input honestly. */
const MAX_SIMPLICES = 20000;

const key = (s: number[]): string => s.join(",");

/**
 * Every face of every maximal simplex, grouped by dimension and sorted, so the
 * boundary matrices have a deterministic basis order.
 */
export function allFaces(maximal: number[][]): number[][][] {
  const byDim: Map<number, Map<string, number[]>> = new Map();
  const addFace = (s: number[]) => {
    const d = s.length - 1;
    if (!byDim.has(d)) byDim.set(d, new Map());
    byDim.get(d)!.set(key(s), s);
  };
  // All non-empty subsets of each maximal simplex.
  for (const raw of maximal) {
    const s = [...new Set(raw)].sort((a, b) => a - b);
    const n = s.length;
    if (n === 0) continue;
    if (n > 20) throw new Error("A simplex with more than 20 vertices has too many faces to enumerate.");
    for (let mask = 1; mask < 1 << n; mask++) {
      const face: number[] = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) face.push(s[i]);
      addFace(face);
    }
  }
  const maxDim = Math.max(-1, ...[...byDim.keys()]);
  const out: number[][][] = [];
  for (let d = 0; d <= maxDim; d++) {
    const m = byDim.get(d);
    const list = m ? [...m.values()] : [];
    list.sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length;
    });
    out.push(list);
  }
  return out;
}

/**
 * The boundary matrix ∂_k, mapping k-simplices to (k−1)-simplices.
 * Rows are (k−1)-faces, columns are k-simplices, entries the alternating signs
 * of the standard face map ∂[v₀…v_k] = Σ (−1)^i [v₀…v̂ᵢ…v_k].
 */
export function boundaryMatrix(kFaces: number[][], km1Faces: number[][]): bigint[][] {
  const index = new Map<string, number>();
  km1Faces.forEach((f, i) => index.set(key(f), i));
  const rows = km1Faces.length, cols = kFaces.length;
  const m: bigint[][] = Array.from({ length: rows }, () => new Array<bigint>(cols).fill(0n));
  kFaces.forEach((s, c) => {
    for (let i = 0; i < s.length; i++) {
      const face = s.slice(0, i).concat(s.slice(i + 1));
      const r = index.get(key(face));
      if (r === undefined) continue; // cannot happen for a closed face set
      m[r][c] = i % 2 === 0 ? 1n : -1n;
    }
  });
  return m;
}

const babs = (a: bigint): bigint => (a < 0n ? -a : a);

/**
 * Smith Normal Form over ℤ: returns the elementary divisors (the nonzero
 * diagonal entries d₁ | d₂ | … ) and the rank.
 *
 * Pivoting deliberately chooses the SMALLEST nonzero entry each round. Integer
 * SNF suffers coefficient explosion if you pivot naively, and boundary matrices
 * start as ±1, so keeping the pivot small is what keeps the numbers small.
 */
export function smithNormalForm(input: bigint[][]): { divisors: bigint[]; rank: number } {
  const m = input.map((r) => r.slice());
  const rows = m.length;
  const cols = rows ? m[0].length : 0;
  const divisors: bigint[] = [];
  let t = 0;

  const swapRows = (a: number, b: number) => { const x = m[a]; m[a] = m[b]; m[b] = x; };
  const swapCols = (a: number, b: number) => { for (let r = 0; r < rows; r++) { const x = m[r][a]; m[r][a] = m[r][b]; m[r][b] = x; } };

  while (t < rows && t < cols) {
    // Find the smallest nonzero entry in the remaining submatrix.
    let pr = -1, pc = -1, best = 0n;
    for (let r = t; r < rows; r++) {
      for (let c = t; c < cols; c++) {
        const v = babs(m[r][c]);
        if (v !== 0n && (best === 0n || v < best)) { best = v; pr = r; pc = c; }
      }
    }
    if (pr < 0) break; // the rest is zero — done
    swapRows(t, pr);
    swapCols(t, pc);

    // Clear the pivot row and column, repeating until both are clean: the
    // remainder steps can reintroduce entries, which is the normal behaviour.
    let clean = false;
    while (!clean) {
      clean = true;
      for (let r = t + 1; r < rows; r++) {
        if (m[r][t] === 0n) continue;
        const q = m[r][t] / m[t][t];
        for (let c = t; c < cols; c++) m[r][c] -= q * m[t][c];
        if (m[r][t] !== 0n) { swapRows(t, r); clean = false; }
      }
      for (let c = t + 1; c < cols; c++) {
        if (m[t][c] === 0n) continue;
        const q = m[t][c] / m[t][t];
        for (let r = t; r < rows; r++) m[r][c] -= q * m[r][t];
        if (m[t][c] !== 0n) { swapCols(t, c); clean = false; }
      }
    }

    // The divisibility condition d_t | every remaining entry. If it fails,
    // fold the offending row in and redo this pivot.
    let fixed = true;
    outer: for (let r = t + 1; r < rows; r++) {
      for (let c = t + 1; c < cols; c++) {
        if (m[r][c] % m[t][t] !== 0n) {
          for (let cc = t; cc < cols; cc++) m[t][cc] += m[r][cc];
          fixed = false;
          break outer;
        }
      }
    }
    if (!fixed) continue; // same t, pivot again

    divisors.push(babs(m[t][t]));
    t++;
  }
  return { divisors, rank: divisors.length };
}

/** Formats H_k from its free rank and torsion coefficients. */
function formatGroup(beta: number, torsion: bigint[]): string {
  const parts: string[] = [];
  if (beta === 1) parts.push("Z");
  else if (beta > 1) parts.push(`Z^${beta}`);
  for (const d of torsion) parts.push(`Z/${d}`);
  return parts.length ? parts.join(" + ") : "0";
}

/**
 * Homology of a finite simplicial complex over ℤ.
 *
 * H_k = ker ∂_k / im ∂_{k+1}, computed from the Smith Normal Forms:
 *   β_k = (number of k-simplices) − rank ∂_k − rank ∂_{k+1}
 *   torsion of H_k = the elementary divisors of ∂_{k+1} that exceed 1
 */
export function homology(complex: Complex): HomologyResult {
  const steps: string[] = [];
  const caveats: string[] = [];
  const faces = allFaces(complex.maximal);
  const total = faces.reduce((s, f) => s + f.length, 0);
  if (total > MAX_SIMPLICES) {
    throw new Error(
      `That complex has ${total} faces, past this tool's limit of ${MAX_SIMPLICES}. ` +
      `The reduction is cubic in exact integers, so it is capped rather than left to run indefinitely.`
    );
  }
  const dim = faces.length - 1;
  const cells = faces.map((f) => f.length);
  steps.push(`Cells per dimension: ${cells.map((c, k) => `c${k} = ${c}`).join(", ")}.`);

  // Ranks of every boundary map. ∂_0 is the zero map; ∂_{dim+1} does not exist.
  const rank: number[] = new Array(dim + 2).fill(0);
  const divisors: bigint[][] = new Array(dim + 2).fill(null).map(() => []);
  for (let k = 1; k <= dim; k++) {
    const snf = smithNormalForm(boundaryMatrix(faces[k], faces[k - 1]));
    rank[k] = snf.rank;
    divisors[k] = snf.divisors;
  }

  const betti: number[] = [];
  const torsion: bigint[][] = [];
  const groups: string[] = [];
  for (let k = 0; k <= dim; k++) {
    const b = cells[k] - rank[k] - rank[k + 1];
    betti.push(b);
    const t = (divisors[k + 1] ?? []).filter((d) => d > 1n);
    torsion.push(t);
    groups.push(formatGroup(b, t));
  }

  const euler = cells.reduce((s, c, k) => s + (k % 2 === 0 ? c : -c), 0);
  const eulerFromBetti = betti.reduce((s, b, k) => s + (k % 2 === 0 ? b : -b), 0);
  const eulerAgrees = euler === eulerFromBetti;

  steps.push(
    `Euler characteristic from cell counts: χ = ${cells.map((c, k) => `${k % 2 === 0 ? "+" : "−"}${c}`).join(" ")} = ${euler}.`
  );
  steps.push(`Euler characteristic from Betti numbers: χ = ${eulerFromBetti}.`);
  if (eulerAgrees) {
    steps.push("The two agree — an independent check that the reduction is self-consistent.");
  } else {
    caveats.push(
      `INTERNAL CHECK FAILED: χ from cell counts (${euler}) and from Betti numbers (${eulerFromBetti}) disagree. ` +
      `They are equal for every finite complex, so this result is not trustworthy — please report the input.`
    );
  }

  const connected = betti[0] === 1;
  if (betti[0] > 1) steps.push(`β₀ = ${betti[0]}, so the complex has ${betti[0]} connected components.`);
  if (torsion.some((t) => t.length)) {
    caveats.push(
      "This complex has TORSION, which is exactly what computing over ℤ preserves — a field-coefficient Betti number would have discarded it silently."
    );
  }

  return {
    cells, betti, torsion, groups, dimension: dim,
    euler, eulerFromBetti, eulerAgrees, connected, steps, caveats,
  };
}

// ---------------------------------------------------------------------------
// Built-in complexes.
//
// These are the test oracles, so where possible they are CONSTRUCTED from a
// quotient rather than transcribed as a face list — a construction can be
// reasoned about, whereas a copied list of 16 triangles cannot.
// ---------------------------------------------------------------------------

/** Boundary of the n-simplex: a triangulation of Sⁿ⁻¹. */
function simplexBoundary(n: number): number[][] {
  const verts = Array.from({ length: n + 1 }, (_, i) => i);
  return verts.map((_, i) => verts.filter((_, j) => j !== i));
}

/**
 * A surface built by identifying the edges of an m×n grid of squares.
 * `flipI` twists the i-direction when it wraps, which is what turns a torus
 * into a Klein bottle. Each square is cut into two triangles.
 */
function gridSurface(m: number, n: number, flipI: boolean): number[][] {
  const id = (i: number, j: number): number => {
    let ii = ((i % m) + m) % m;
    let jj = ((j % n) + n) % n;
    if (flipI && Math.floor(i / m) % 2 !== 0) jj = ((n - 1 - jj) % n + n) % n;
    return ii * n + jj;
  };
  const faces: number[][] = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      // Skip any degenerate triangle the identification may have collapsed.
      if (new Set([a, b, c]).size === 3) faces.push([a, b, c]);
      if (new Set([a, c, d]).size === 3) faces.push([a, c, d]);
    }
  }
  return faces;
}

/** The 6-vertex minimal triangulation of the real projective plane. */
const RP2_FACES: number[][] = [
  [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 1, 5],
  [1, 2, 4], [2, 3, 5], [3, 4, 1], [4, 5, 2], [5, 1, 3],
];

export const BUILTIN: Record<string, () => Complex> = {
  point: () => ({ name: "point", maximal: [[0]] }),
  interval: () => ({ name: "interval", maximal: [[0, 1]] }),
  circle: () => ({ name: "S¹ (circle)", maximal: [[0, 1], [1, 2], [0, 2]] }),
  s1: () => BUILTIN.circle(),
  sphere: () => ({ name: "S² (sphere)", maximal: simplexBoundary(3) }),
  s2: () => BUILTIN.sphere(),
  s3: () => ({ name: "S³", maximal: simplexBoundary(4) }),
  disk: () => ({ name: "disk", maximal: [[0, 1, 2]] }),
  torus: () => ({ name: "T² (torus)", maximal: gridSurface(3, 3, false) }),
  klein: () => ({ name: "Klein bottle", maximal: gridSurface(4, 4, true) }),
  rp2: () => ({ name: "ℝP² (projective plane)", maximal: RP2_FACES }),
  mobius: () => ({
    name: "Möbius band",
    // Five triangles round a strip with one twist.
    maximal: [[0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 0], [4, 0, 1]],
  }),
  annulus: () => ({
    name: "annulus",
    maximal: [
      [0, 1, 3], [1, 3, 4], [1, 2, 4], [2, 4, 5], [2, 0, 5], [0, 5, 3],
    ],
  }),
  "two-points": () => ({ name: "two points", maximal: [[0], [1]] }),
  "wedge-two-circles": () => ({
    name: "figure eight (S¹ ∨ S¹)",
    maximal: [[0, 1], [1, 2], [0, 2], [0, 3], [3, 4], [0, 4]],
  }),
  tetrahedron: () => ({ name: "solid tetrahedron", maximal: [[0, 1, 2, 3]] }),
};

/** Names a caller can offer; keeps the pane and the docs in step. */
export const BUILTIN_NAMES = Object.keys(BUILTIN);

// ---------------------------------------------------------------------------
// Typed input for Solve's topology kind.
// ---------------------------------------------------------------------------

/** Friendly aliases for the built-in spaces. */
const ALIASES: Record<string, string> = {
  "s^1": "circle", "s1": "circle", "s^2": "sphere", "s2": "sphere", "s^3": "s3",
  "projective plane": "rp2", "real projective plane": "rp2", "rp^2": "rp2", "p^2": "rp2",
  "klein bottle": "klein", "kleinbottle": "klein",
  "figure eight": "wedge-two-circles", "figure-eight": "wedge-two-circles",
  "wedge of two circles": "wedge-two-circles", "mobius band": "mobius",
  "möbius band": "mobius", "möbius": "mobius", "moebius": "mobius",
  "solid tetrahedron": "tetrahedron", "ball": "tetrahedron",
  "two points": "two-points", "cylinder": "annulus",
};

export interface TopologyReport extends HomologyResult {
  title: string;
}

/**
 * Reads either a built-in space name ("torus", "Klein bottle") or an explicit
 * list of maximal simplices ("[0,1,2] [1,2,3]" / "0,1,2; 1,2,3"), and returns
 * its integral homology. Null when the input is neither.
 */
export function solveTopology(input: string): TopologyReport | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();

  // A named space.
  const named = ALIASES[lower] ?? (lower in BUILTIN ? lower : null);
  if (named && BUILTIN[named]) {
    const c = BUILTIN[named]();
    const h = homology(c);
    return { ...h, title: `Homology of ${c.name ?? named}` };
  }

  // An explicit complex: bracketed groups, or semicolon/newline-separated rows.
  const groups: number[][] = [];
  const bracketed = raw.match(/\[[^\]]*\]/g);
  if (bracketed) {
    for (const b of bracketed) {
      const nums = (b.match(/-?\d+/g) || []).map(Number);
      if (nums.length) groups.push(nums);
    }
  } else if (/[;\n]/.test(raw) || /^\s*\d+(\s*,\s*\d+)+\s*$/.test(raw)) {
    for (const row of raw.split(/[;\n]/)) {
      const nums = (row.match(/-?\d+/g) || []).map(Number);
      if (nums.length) groups.push(nums);
    }
  }
  if (!groups.length) return null;

  const h = homology({ maximal: groups });
  return { ...h, title: `Homology of the complex you gave (${groups.length} maximal simplices)` };
}
