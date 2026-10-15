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

import { parsePersistenceRequest, parseFieldSpec, homologyOverField } from "./persistence";
import { parseBraid, jonesPolynomial, wirtingerPresentation, KNOT_BRAIDS } from "./knots";
import { alexanderPolynomial, kTheory } from "./alexander";
import { koTheory, isKoQuery, normaliseTopologyText, typesetGroup, sub, spectrumHomotopy } from "./kReal";
import { cobordismQuery, isCobordismQuery, manifoldSummary } from "./cobordism";
import { serreE2, stableStem, SPECTRAL_SPACES, STABLE_RANGE } from "./spectral";
import {
  cellularHomology, CW_BUILTIN, realProjectiveTangentClass,
  complexProjectiveTangentClass, complexProjectivePontryaginClass, BEYOND,
} from "./topology2";

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
  // Check the PROJECTED face count before enumerating anything. A handful of
  // 18-vertex simplices is 2^18 faces each: building them and only then
  // noticing takes seconds and a million allocations, and Solve recomputes on
  // every keystroke. The bound has to come first.
  let projected = 0;
  for (const raw of maximal) {
    const n = new Set(raw).size;
    if (n > 20) throw new Error("A simplex with more than 20 vertices has too many faces to enumerate.");
    projected += 2 ** n - 1;
    if (projected > MAX_SIMPLICES) {
      throw new Error(
        `That complex would generate at least ${projected.toLocaleString()} faces, past this tool's limit of ` +
        `${MAX_SIMPLICES.toLocaleString()}. The reduction is cubic in exact integers, so it is capped up front ` +
        `rather than left to run. Use fewer or smaller maximal simplices.`
      );
    }
  }
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

  // Backstop against a non-terminating reduction. The structure below is
  // provably finite, but a silent infinite loop in a pane that recomputes on
  // every keystroke is bad enough to be worth an explicit guard.
  let guard = 0;
  const GUARD_MAX = 2_000_000;
  const tick = () => {
    if (++guard > GUARD_MAX) {
      throw new Error("The integer reduction did not converge; this matrix is past what this tool can reduce.");
    }
  };

  while (t < rows && t < cols) {
    // Pivot on the SMALLEST nonzero entry of the remaining submatrix.
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

    // ONE reduction pass over the pivot column and row, then re-pivot.
    //
    // This is the load-bearing detail. An earlier version looped the reduction
    // to completion against a FIXED pivot, which let the off-pivot entries grow
    // without bound — a random 7×7 integer matrix blew past BigInt's maximum
    // size after ~14 seconds. Division leaves every remainder strictly smaller
    // in absolute value than the pivot, so returning to the pivot search makes
    // the pivot magnitude strictly decrease each round. A strictly decreasing
    // positive integer terminates, and the entries stay small on the way down.
    let changed = false;
    for (let r = t + 1; r < rows; r++) {
      if (m[r][t] === 0n) continue;
      const q = m[r][t] / m[t][t];
      if (q !== 0n) for (let c = t; c < cols; c++) m[r][c] -= q * m[t][c];
      if (m[r][t] !== 0n) changed = true;
    }
    for (let c = t + 1; c < cols; c++) {
      if (m[t][c] === 0n) continue;
      const q = m[t][c] / m[t][t];
      if (q !== 0n) for (let r = t; r < rows; r++) m[r][c] -= q * m[r][t];
      if (m[t][c] !== 0n) changed = true;
    }
    if (changed) { tick(); continue; } // a smaller remainder exists — re-pivot

    // Row t and column t are now clean. Enforce d_t | every remaining entry,
    // which is what makes the divisors a divisibility chain.
    let bad = -1;
    for (let r = t + 1; r < rows && bad < 0; r++) {
      for (let c = t + 1; c < cols; c++) {
        if (m[r][c] % m[t][t] !== 0n) { bad = r; break; }
      }
    }
    if (bad >= 0) {
      for (let c = t; c < cols; c++) m[t][c] += m[bad][c];
      tick();
      continue; // same t, pivot again
    }

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

// People type the question, not just the object: "homology of the torus",
// "compute H_* of rp2". Strip the framing words so the lookup sees the
// space name alone. Nothing here changes WHICH spaces are known.
const FILLER =
  /\b(compute|calculate|find|give|show|what|is|are|the|of|for|please|homology|cohomology|groups?|h_?\*|h\d*)\b/g;
// "H_*" and "H*" cannot sit inside a word-boundary group — the asterisk is
// not a word character, so the trailing boundary never matches. Strip them
// first, on their own.
// "H_*" and "H*" cannot live inside the word-boundary group above: the
// asterisk is not a word character, so the trailing boundary never matches and
// the whole token survives. Strip that spelling on its own, first.
export const stripFiller = (s: string): string =>
  s.replace(/h_?\*/gi, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();


// ---------------------------------------------------------------------------
// Typed input for Solve's topology kind.
// ---------------------------------------------------------------------------

/** Friendly aliases for the built-in spaces. */
const ALIASES: Record<string, string> = {
  "s^1": "circle", "s1": "circle", "s^2": "sphere", "s2": "sphere", "s^3": "s3",
  "t^2": "torus", "t2": "torus",
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
export type TopologyOutcome =
  | { kind: "advanced"; title: string; display: string[]; steps: string[]; caveats: string[] }
  | ({ kind: "homology" } & TopologyReport)
  | {
      kind: "persistence";
      cloud: number[][];
      /** Prime field from a header ("over F3"); 2 when none was given. */
      p: number;
      /** The user's scale header, when given; otherwise the engine projects one. */
      maxScale?: number;
      maxDim: number;
      /** "compare": run 𝔽₂ against 𝔽₃ side by side. */
      compare: boolean;
      /** Letter-led lines that were not recognised — the pane must PRINT these. */
      ignored: string[];
      /** Recognised headers, said back in words. */
      read: string[];
    };

/** A coefficient-field phrase in a typed homology question ("over z/3", "mod 2"). */
const FIELD_PHRASE =
  /\b(?:with\s+)?(?:coeff(?:icient)?s?\s+(?:in|over)\s+|over\s+(?:the\s+)?(?:field\s+)?|in\s+)(?:f|gf|z)\s*[_/(]?\s*\d+\s*\)?(?:\s*z)?(?:\s+coeff(?:icient)?s)?|;\s*f\s*\d+|\bmod(?:ulo)?\s*\d+|\bfield\s*(?:f\s*)?\d+|\bwith\s+(?:f|z|gf)\s*[_/(]?\s*\d+\s*\)?\s+coeff(?:icient)?s/gi;
const INTEGER_PHRASE = /\b(?:over|with coefficients in|coefficients in|in)\s+(?:z|the integers)(?![\w/])/gi;

export function solveTopology(input: string): TopologyOutcome | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();

  // A pasted POINT CLOUD is persistent homology, not a simplicial complex.
  // Two or more rows of equal-length coordinates is unambiguous: a complex is
  // typed as bracketed vertex lists, and a space is a single word. Header lines
  // ("over F3", "scale 2", "H2", "compare") are read by persistence.ts's
  // parsePersistenceRequest — never dropped: a coefficient field that was
  // silently ignored is how "over F3" got answered over 𝔽₂.
  // …unless it is a typed SIMPLICIAL COMPLEX: integer vertex lists. "homology
  // of 0,1,2; 1,2,3; 0,2,3; 0,1,3" (the hollow tetrahedron, S²) used to be read
  // as a 3-point cloud with its first simplex swallowed as a header line.
  const typed = typedComplexRows(raw);
  if (typed) {
    const h = homology({ maximal: typed });
    return { kind: "homology", ...h, title: `Homology of the complex you gave (${typed.length} maximal simplices)` };
  }
  if (/[\n;]/.test(raw) && !raw.includes("[")) {
    const req = parsePersistenceRequest(raw);
    if (req && req.ok) {
      return {
        kind: "persistence", cloud: req.cloud, p: req.p, maxScale: req.maxScale, maxDim: req.maxDim,
        compare: req.compare, ignored: req.ignored, read: req.read,
      };
    }
    // A refused header is a refusal by name. Rows of unequal length with NO
    // letters at all are not a cloud — they may be a complex ("0,1,2; 1,2"),
    // so those fall through, exactly as before.
    if (req && !req.ok && /[a-z]/i.test(raw)) {
      return {
        kind: "advanced",
        title: "Persistent homology",
        display: [req.error],
        steps: [],
        caveats: ["Nothing was computed: a request that names a field, scale or dimension is never answered with a different one."],
      };
    }
  }

  const knot = knotQuery(raw, lower);
  if (knot) return knot;

  // π_n of a K-theory SPECTRUM (KO, KU, KSp) is Bott's row, not the sphere's
  // stable stem: this runs BEFORE the stem branch, whose /pi_?\d|homotopy/
  // used to answer "pi_3(KO)" with π₃ˢ = ℤ/24 (truth: 0).
  const spectrum = spectrumHomotopy(raw);
  if (spectrum) return { kind: "advanced", ...spectrum };

  // REAL K-theory, also before the stem and Serre branches: "KO of RP^4 via
  // the atiyah-hirzebruch spectral sequence" contains "spectral". And before
  // complex K: "real k-theory" contains "k-theory", and answering it with
  // complex K was a live wrong answer (K̃⁰(S¹) = 0 where K̃O⁰(S¹) = ℤ/2).
  if (isKoQuery(raw)) {
    const ko = koTheory(raw);
    if (ko) {
      return {
        kind: "advanced",
        title: ko.refused ? `Real K-theory KO of ${ko.space} — not computed` : `Real K-theory KO of ${ko.space}`,
        display: ko.display,
        steps: ko.steps,
        caveats: ko.caveats,
      };
    }
    return {
      kind: "advanced",
      title: "Real K-theory KO",
      display: ["Name a space — KO is computed here for a point, spheres Sⁿ (any n, by Bott periodicity) and K̃O⁰ of ℝPⁿ (Adams)."],
      steps: ["Try: \"KO of S¹\", \"KO(ℝP⁴)\", \"KO-theory of a point\", \"π₃(KO)\"."],
      caveats: ["Products, ℂPⁿ and graded KO of ℝPⁿ are refused by name, not guessed."],
    };
  }

  // A3: stable homotopy — a CITED table, and it says so.
  // The index gets written several ways in practice — "stable pi_3",
  // "pi_3^s", "stable homotopy 7" — so a keyword decides that a stem is
  // wanted and the first integer near it decides which one.
  // The displayed "\u03c0\u2083\u02e2" reads back: sub/superscript digits fold to ASCII here.
  const lowerDigits = lower
    .replace(/[\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089]/g, (d) => String("\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089".indexOf(d)))
    .replace(/[\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079]/g, (d) => String("\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079".indexOf(d)));
  const wantsStem = /\bstable\b|\bstem\b|homotopy|pi[_ ^]?\d|\u03c0/.test(lowerDigits);
  const stem = /(?:pi|\u03c0|stem|stable|homotopy)\D{0,12}?(\d+)/.exec(lowerDigits);
  if (stem && wantsStem) {
    const r = stableStem(parseInt(stem[1], 10));
    if (r) {
      return {
        kind: "advanced",
        title: `Stable homotopy group \u03c0${sub(r.n)}\u02e2`,
        display: [`\u03c0${sub(r.n)}\u02e2 = ${typesetGroup(r.group)}`],
        // spectral.ts writes "pi_3^s = Z/24"; the display contract is enforced
        // here, at the one place topology output leaves for the pane.
        steps: r.steps.map(typesetStemText),
        caveats: r.caveats.map(typesetStemText),
      };
    }
  }

  // A2: the E2 page of a Serre spectral sequence, differentials MARKED.
  // Filler words vary ("serre s2 s1", "spectral sequence of s2 s3"), so
  // rather than counting tokens by position, keep only the ones that name a
  // space in the table. The order written is base then fibre.
  if (/serre|spectral|fibration/.test(lower)) {
    const named = (lower.match(/[a-z][a-z0-9^]*/g) ?? []).filter((t) =>
      SPECTRAL_SPACES.includes(t.replace(/\^/g, ""))
    );
    const r =
      named.length >= 2
        ? serreE2(named[0], named[1]) ?? serreE2(named[1], named[0])
        : null;
    if (r) {
      return {
        kind: "advanced",
        title: `Serre spectral sequence: ${r.fibration}`,
        display: [
          r.collapses
            ? `The sequence COLLAPSES at E2 — proved, because every possible differential has a zero end.`
            : `${r.differentials.length} differential(s) remain UNDETERMINED, so no H*(E) is reported.`,
          ...(r.abutment ?? []),
        ],
        steps: [r.grid, ...r.steps, ...r.differentials.map((d) => `d_${d.r}: (${d.from.p},${d.from.q}) -> (${d.to.p},${d.to.q}) — UNDETERMINED.`)],
        caveats: r.caveats,
      };
    }
    return {
      kind: "advanced",
      title: "Serre spectral sequence",
      display: ["Those spaces are not in the table."],
      steps: [`Known spaces: ${SPECTRAL_SPACES.join(", ")}. Try: serre s2 s1 (for the fibration S^1 -> E -> S^2).`],
      caveats: [],
    };
  }

  // K-theory is keyword-led and cannot be confused with anything else here.
  // The displayed lines "K⁰(S²) = ℤ ⊕ ℤ" / "K̃⁰(S²) = ℤ" read back too.
  const kNotation = /^~?k\s*\^\s*-?\d+\s*\(/.test(normaliseTopologyText(raw));
  if (/k[- ]?theory/.test(lower) || kNotation) {
    const kt = kTheory(kNotation ? raw : lower.replace(/k[- ]?theory/, "").trim());
    if (kt && kt.refused) {
      return {
        kind: "advanced",
        title: `K-theory of ${kt.space} — not computed`,
        display: [kt.refused],
        steps: kt.steps,
        caveats: kt.caveats,
      };
    }
    if (kt) {
      return {
        kind: "advanced",
        title: `K-theory of ${kt.space}`,
        display: [`K⁰(${kt.space}) = ${kt.k0}`, `K¹(${kt.space}) = ${kt.k1}`, `K̃⁰(${kt.space}) = ${kt.reducedK0}`],
        steps: kt.steps,
        caveats: kt.caveats,
      };
    }
    return {
      kind: "advanced",
      title: "K-theory",
      display: ["Not computed for that space."],
      steps: ["K-theory is computed here only where Bott periodicity settles it outright: spheres Sⁿ, complex projective spaces ℂPⁿ, a point, tori, products of these (Künneth), and K̃⁰ of ℝPⁿ (Adams)."],
      caveats: ["Reporting the limit is deliberate — K-theory of an arbitrary space is not a computation this tool can do."],
    };
  }

  // Knot queries come first: a braid word is unambiguous once the keyword is
  // present, and "trefoil" must not be mistaken for a space name.

  // Cobordism, signature, Pontryagin / Stiefel–Whitney NUMBERS, Ω groups: the
  // ring engine in cobordism.ts. It runs BEFORE the characteristic-class
  // branch, because "stiefel whitney numbers of rp^2 x rp^2" contains "rp" and
  // used to be answered for one factor.
  if (isCobordismQuery(raw)) {
    const r = cobordismQuery(raw);
    if (r) return { kind: "advanced", ...r };
  }

  // Homology with FIELD coefficients ("homology of klein bottle over z/3",
  // "rp2 mod 2"): the coefficient phrase is read, removed, and the integral
  // answer converted by the universal coefficient theorem (persistence.ts's
  // homologyOverField). Never silently answered over ℤ.
  const fieldOutcome = fieldHomologyQuery(raw, lower);
  if (fieldOutcome) return fieldOutcome;

  // Advanced (A1) queries: characteristic classes and cellular homology. The
  // text is normalised (superscripts, ℝ/ℂ, ×) and a displayed "w(TℝP⁵) = …"
  // reads back by its left side.
  const adv = advancedQuery(normaliseTopologyText(raw).split("=")[0].trim());
  if (adv) return adv;

  // A named space.
  const named = resolveNamedSpace(lower);
  if (named && BUILTIN[named]) {
    const c = BUILTIN[named]();
    const h = homology(c);
    return { kind: "homology", ...h, title: `Homology of ${c.name ?? named}` };
  }

  // A manifold typed ALONE ("K3", "rp^2 x rp^2", "CP^2 # CP^2bar"): its
  // standard summary. Named spaces with a homology complex ("torus", "rp2",
  // "klein bottle") were answered above and keep their homology answer.
  const summary = manifoldSummary(raw);
  if (summary) return { kind: "advanced", ...summary };

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
  return { kind: "homology", ...h, title: `Homology of the complex you gave (${groups.length} maximal simplices)` };
}

/**
 * Integer vertex lists that are a SIMPLICIAL COMPLEX, not a point cloud.
 * A complex when every row is non-negative integers AND either
 *   * the text says so ("homology", "complex", "simplices", "simplicial"), or
 *   * rows are separated by ";" and written with commas ("0,1,2; 1,2,3").
 * A cloud needs coordinates — any decimal, a negative, or the words "points",
 * "cloud", "persistence", "barcode" keep it a cloud (so "0 0\n1 0\n1 1" stays
 * persistence, as before). Null when it is not a typed complex.
 */
function typedComplexRows(raw: string): number[][] | null {
  if (!/[\n;]/.test(raw) || raw.includes("[")) return null;
  const lower = raw.toLowerCase();
  if (/\b(points?|cloud|persisten\w*|barcode|scale|over|mod|field|compare)\b/.test(lower)) return null;
  const keyword = /\b(homology|complex|simplices|simplicial|simplex)\b/.test(lower);
  // Strip the framing words from the FIRST row only ("homology of 0,1,2").
  const body = lower.replace(/^\s*(?:(?:compute|find|the|of|for|simplicial|homology|complex|simplices|with|maximal|faces?|h_?\*|:)\s*)+/, "");
  const rows = body.split(/[;\n]/).map((r) => r.trim()).filter((r) => r.length);
  if (rows.length < 2) return null;
  const intRow = /^\d{1,6}(?:\s*,\s*\d{1,6})*$|^\d{1,6}(?:\s+\d{1,6})*$/;
  if (!rows.every((r) => intRow.test(r))) return null;
  const commaRows = /;/.test(raw) && rows.every((r) => r.includes(",") || /^\d+$/.test(r));
  if (!keyword && !commaRows) return null;
  return rows.map((r) => (r.match(/\d+/g) || []).map(Number));
}

/** "pi_3^s = Z/24" → "π₃ˢ = ℤ/24" (spectral.ts's ASCII, typeset for display). */
function typesetStemText(s: string): string {
  return typesetGroup(s.replace(/\bpi_\{?(\d+)\}?\^s\b/g, (_m, d: string) => `π${sub(d)}ˢ`));
}

/** The BUILTIN key a typed space name refers to, or null. */
function resolveNamedSpace(lower: string): string | null {
  const bare = stripFiller(lower);
  return (
    ALIASES[lower] ??
    (lower in BUILTIN ? lower : null) ??
    ALIASES[bare] ??
    (bare in BUILTIN ? bare : null) ??
    ALIASES[bare.replace(/ /g, "")] ??
    (bare.replace(/ /g, "") in BUILTIN ? bare.replace(/ /g, "") : null)
  );
}

/** Maximal simplices typed as "[0,1,2] [1,2,3]"; null when none are bracketed. */
function bracketedComplex(text: string): number[][] | null {
  const bracketed = text.match(/\[[^\]]*\]/g);
  if (!bracketed) return null;
  const groups: number[][] = [];
  for (const b of bracketed) {
    const nums = (b.match(/-?\d+/g) || []).map(Number);
    if (nums.length) groups.push(nums);
  }
  return groups.length ? groups : null;
}

/**
 * Simplicial homology with coefficients: "homology of klein bottle over z/3",
 * "… with coefficients in F3", "homology of rp2 mod 2", "[0,1,2] [1,2,3] over F5".
 * Null when the text names no coefficients, or names them for something that
 * is not a space this file knows (so other branches still get their turn).
 */
function fieldHomologyQuery(raw: string, lower: string): TopologyOutcome | null {
  // 𝔽₃ / ℤ/3 as typed or as displayed: fold to ASCII so one pattern reads both
  // (𝔽 is outside the BMP, so it never goes inside a character class).
  // A displayed "H₁(ℝP²; 𝔽₃) = 𝔽₃" reads back by its left side.
  const norm = lower.split("=")[0]
    .replace(/𝔽/g, "f").replace(/ℤ/g, "z")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)));
  INTEGER_PHRASE.lastIndex = 0;
  const integer = INTEGER_PHRASE.test(norm);
  INTEGER_PHRASE.lastIndex = 0;
  const fieldPhrase = norm.match(FIELD_PHRASE);
  if (!fieldPhrase && !integer) return null;
  const rest = norm.replace(FIELD_PHRASE, " ").replace(INTEGER_PHRASE, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  // The displayed "H₁(ℝP²; 𝔽₃)" reads back: ℝP² folds to rp^2, an alias.
  const named = resolveNamedSpace(rest) ?? resolveNamedSpace(normaliseTopologyText(rest));
  const groups = named ? null : bracketedComplex(raw);
  if (!named && !groups) return null;

  const complex: Complex = named ? BUILTIN[named]() : { maximal: groups! };
  // The label must read back, so the gloss "(projective plane)" is dropped.
  const label = named ? (complex.name ?? named).replace(/\s*\(.*\)$/, "") : `the complex you gave (${groups!.length} maximal simplices)`;
  const h = homology(complex);
  if (!fieldPhrase) {
    // "over Z" is the integral answer this file always gives — said so.
    return { kind: "homology", ...h, title: `Homology of ${label} (over ℤ)` };
  }
  const spec = parseFieldSpec(fieldPhrase[0].replace(/^;\s*/, ""));
  if (!spec) return null;
  if (!spec.ok) {
    return { kind: "advanced", title: `Homology of ${label}`, display: [spec.error], steps: [], caveats: [] };
  }
  let fh;
  try {
    fh = homologyOverField(h, spec.p);
  } catch (err) {
    return { kind: "advanced", title: `Homology of ${label}`, display: [(err as Error).message], steps: [], caveats: [] };
  }
  const F = `𝔽${sub(spec.p)}`;
  return {
    kind: "advanced",
    title: `Homology of ${label} over ${F}`,
    display: [
      ...fh.groups.map((g, k) => `H${sub(k)}(${label}; ${F}) = ${g}`),
      `Betti numbers over ${F}: ${fh.betti.join(", ")}`,
      `Over ℤ: ${h.groups.map((g, k) => `H${sub(k)} = ${typesetGroup(g)}`).join(", ")}`,
    ],
    steps: [...h.steps, ...fh.steps],
    caveats: [
      "Computed from the integral Smith-normal-form answer by the universal coefficient theorem — no second reduction is run.",
      ...h.caveats,
    ],
  };
}

// ---------------------------------------------------------------------------
// Advanced (Release A1) queries — characteristic classes and cobordism.
//
// Typed, like everything else in Solve: "w(RP^5)", "chern CP^3", "does RP^5
// bound", "cellular rp2". Anything in tier A2/A3 is answered with the honest
// statement of WHY it is not computed, rather than silently returning nothing.
// ---------------------------------------------------------------------------

function advancedQuery(lower: string): TopologyOutcome | null {
  const dimOf = (re: RegExp): number | null => {
    const m = re.exec(lower);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 1 && n <= 200 ? n : null;
  };

  // A product or connected sum must never be answered with one factor's class
  // (the dimOf regex reads the FIRST rp^n it sees). The total class of a
  // product is w(M)·w(N) in the tensor product — not reported here; the
  // NUMBERS are, by the cobordism engine.
  const charClassAsked =
    (/\b(w|stiefel|sw)\b/.test(lower) && /rp|projective/.test(lower)) ||
    (/\b(c|chern)\b/.test(lower) && /cp|complex projective/.test(lower)) ||
    (/\b(p|pontr[yj]agin)\b/.test(lower) && /cp|complex projective/.test(lower));
  if (charClassAsked && /\s(x|#)\s|[×#*]|\bx\b(?=\s*[a-z(])|\d\s*x\s*[a-z]/.test(lower)) {
    return {
      kind: "advanced",
      title: "Characteristic class of a product or connected sum — not computed",
      display: [
        "The total class of a product lives in the tensor product of the factors' cohomology (w(M × N) = w(M) × w(N)), and is not reported here; one factor's class is never given in its place.",
      ],
      steps: [
        "The characteristic NUMBERS of products and connected sums ARE computed: ask \"stiefel whitney numbers of RP^2 x RP^2\" or \"pontryagin numbers of CP^2 x CP^2\".",
      ],
      caveats: [],
    };
  }

  // Stiefel-Whitney class of a real projective space.
  if (/\b(w|stiefel|sw)\b/.test(lower) && /rp|projective/.test(lower)) {
    const n = dimOf(/(?:rp|p)\s*\^?\s*(\d+)/);
    if (n !== null) {
      const r = realProjectiveTangentClass(n);
      return {
        kind: "advanced",
        title: `Stiefel-Whitney class ${r.name}`,
        display: [`${r.name} = ${r.display}`],
        steps: r.steps,
        caveats: r.caveats,
      };
    }
  }

  // Pontryagin class of a complex projective space (the CLASS — the numbers
  // and verdicts are cobordism.ts's, reached by "pontryagin numbers of …").
  if (/\b(p|pontr[yj]agin)\b/.test(lower) && /cp|complex projective/.test(lower) && !/\bnumbers?\b/.test(lower)) {
    const n = dimOf(/(?:cp|p)\s*\^?\s*(\d+)/);
    if (n !== null) {
      const r = complexProjectivePontryaginClass(n);
      return {
        kind: "advanced",
        title: `Pontryagin class ${r.name}`,
        display: [`${r.name} = ${r.display}`],
        steps: r.steps,
        caveats: r.caveats,
      };
    }
  }

  // Chern class of a complex projective space.
  if (/\b(c|chern)\b/.test(lower) && /cp|complex projective/.test(lower)) {
    const n = dimOf(/(?:cp|p)\s*\^?\s*(\d+)/);
    if (n !== null) {
      const r = complexProjectiveTangentClass(n);
      return {
        kind: "advanced",
        title: `Chern class ${r.name}`,
        display: [`${r.name} = ${r.display}`],
        steps: r.steps,
        caveats: r.caveats,
      };
    }
  }

  // Cobordism is answered by cobordism.ts before this function is reached
  // (solveTopology routes it), so products and connected sums are never read
  // as their first factor here.

  // Cellular homology of a named CW complex.
  if (/^cellular\b/.test(lower)) {
    const key = stripFiller(lower.replace(/^cellular\s*/, "")).replace(/\s+/g, "");
    const make = CW_BUILTIN[key] ?? CW_BUILTIN[key.replace(/[^a-z0-9-]/g, "")];
    if (make) {
      const cw = make();
      const r = cellularHomology(cw);
      return {
        kind: "advanced",
        title: `Cellular homology of ${cw.name ?? key}`,
        display: r.groups.map((g, k) => `H${sub(k)} = ${typesetGroup(g)}`),
        steps: [...r.steps, `Only ${cw.cells.reduce((a, b) => a + b, 0)} cells were needed.`],
        caveats: r.caveats,
      };
    }
  }

  // The honest boundary: name what is NOT computable rather than returning null.
  for (const key of Object.keys(BEYOND)) {
    const probe = key.split(" ")[0];
    if (lower.includes(key) || lower.includes(probe)) {
      const b = BEYOND[key];
      return {
        kind: "advanced",
        title: `${b.topic} — not computed here, and why`,
        display: [`This is outside what this tool computes.`],
        steps: [
          `What IS computable: ${b.whatIsComputable}`,
          `What is NOT: ${b.whatIsNot}`,
          b.why,
        ],
        caveats: [
          "Reporting this limit is deliberate. A tool that appeared to answer here would be inventing mathematics that nobody can compute.",
        ],
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Knot queries: "knot trefoil", "jones 1 1 1", "braid 1 -2 1 -2", "pi1 trefoil".
// ---------------------------------------------------------------------------

function knotQuery(raw: string, lower: string): TopologyOutcome | null {
  const wantsKnot = /\b(knot|jones|braid|link|wirtinger|alexander|pi1|π1|fundamental group of)\b/.test(lower);
  if (!wantsKnot) return null;

  // A named knot, or a braid word typed out.
  let braid: { word: number[]; strands: number } | null = null;
  let label = "";
  for (const name of Object.keys(KNOT_BRAIDS)) {
    if (lower.includes(name) || lower.includes(name.replace(/-/g, " "))) {
      const b = KNOT_BRAIDS[name];
      braid = { word: b.word, strands: b.strands };
      label = `${name} (${b.note})`;
      break;
    }
  }
  if (!braid) {
    const parsed = parseBraid(raw.replace(/\b(knot|jones|braid|link|wirtinger|pi1|π1|of|the|fundamental|group)\b/gi, " "));
    if (parsed) {
      braid = parsed;
      label = `the closure of the braid you gave`;
    }
  }
  if (!braid) {
    return {
      kind: "advanced",
      title: "Knot invariants",
      display: ["Couldn't read that as a knot."],
      steps: [
        `Give a braid word — "1 1 1" is the trefoil, "1 -2 1 -2" the figure-eight — or a name: ${Object.keys(KNOT_BRAIDS).join(", ")}.`,
      ],
      caveats: [],
    };
  }

  // The Alexander polynomial, when asked for by name.
  if (/alexander/.test(lower)) {
    const a = alexanderPolynomial(braid);
    if (!a) {
      return {
        kind: "advanced",
        title: "Alexander polynomial",
        display: ["The Burau route did not divide cleanly for this braid, so no polynomial is reported."],
        steps: [],
        caveats: ["An honest refusal: a rounded answer here would not be an Alexander polynomial."],
      };
    }
    return {
      kind: "advanced",
      title: `Alexander polynomial of ${label}`,
      display: [`Delta(t) = ${a.display}`, `knot determinant |Delta(-1)| = ${a.determinant}`],
      steps: a.steps,
      caveats: a.caveats,
    };
  }

  // π₁ was asked for specifically.
  if (/\b(pi1|π1|wirtinger|fundamental group)\b/.test(lower)) {
    const w = wirtingerPresentation(braid);
    return {
      kind: "advanced",
      title: `π₁ of the complement of ${label}`,
      display: [
        `Generators: ${w.generators.join(", ")}`,
        `H₁ (abelianisation) = ${w.abelianisation}`,
      ],
      steps: [...w.relations.map((r) => `Relation: ${r}`), ...w.steps],
      caveats: w.caveats,
    };
  }

  let r;
  try {
    r = jonesPolynomial(braid);
  } catch (err) {
    return {
      kind: "advanced",
      title: "Knot invariants",
      display: [(err as Error).message],
      steps: [],
      caveats: [],
    };
  }
  return {
    kind: "advanced",
    title: `Jones polynomial of ${label}`,
    display: [
      `V(t) = ${r.jonesDisplay}`,
      `Kauffman bracket = ${r.bracketDisplay}`,
      `${r.components} component${r.components === 1 ? " (a knot)" : "s (a link)"}, writhe ${r.writhe}`,
    ],
    steps: r.steps,
    caveats: r.caveats,
  };
}
