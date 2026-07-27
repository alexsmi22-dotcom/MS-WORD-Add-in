// Knot polynomials and π₁ presentations — GEOMETRY-TOPOLOGY-DESIGN §2, T3/T4.
//
// Input is a BRAID WORD, because it is the one knot notation a person can type
// without a diagram: `1 1 1` is σ₁σ₁σ₁, whose closure is the trefoil.
// A negative entry is the inverse crossing, so `1 -2 1 -2` is the figure-eight.
//
// THE JONES POLYNOMIAL is computed exactly, by the Kauffman bracket state sum:
// each crossing is smoothed two ways, every one of the 2^n states is a disjoint
// union of circles, and the bracket is Σ A^(a−b)·(−A²−A⁻²)^(loops−1). Then
// f = (−A³)^(−writhe)·⟨D⟩ and V(t) = f at A = t^(−1/4). Every coefficient is an
// exact integer; nothing here is numerical.
//
// It is EXPONENTIAL in the crossing number — 2^n states — so the crossing count
// is capped and the cap is reported rather than silently truncating a sum that
// would be wrong if cut short.
//
// HONESTY, and this is the part that matters: the Jones polynomial is NOT a
// complete invariant. Distinct knots share it (the Kinoshita–Terasaka and Conway
// pair is the classic example), and whether it detects the unknot is an open
// problem. So a match is EVIDENCE, never proof, and this module says so on every
// result. Likewise π₁ is PRESENTED and ABELIANISED, never identified — the word
// problem for groups is undecidable (Novikov–Boone), so no presentation here is
// ever claimed to be simplified or recognised.

// ---------------------------------------------------------------------------
// Laurent polynomials with exact integer coefficients.
// Represented as a map from exponent to coefficient, in quarter-powers where
// needed so t^(1/2) survives for links without introducing floats.
// ---------------------------------------------------------------------------

export type Laurent = Map<number, number>;

export const lZero = (): Laurent => new Map();
export const lOne = (): Laurent => new Map([[0, 1]]);
export const lMono = (exp: number, coeff = 1): Laurent => (coeff === 0 ? new Map() : new Map([[exp, coeff]]));

export function lAdd(a: Laurent, b: Laurent): Laurent {
  const out = new Map(a);
  for (const [e, c] of b) {
    const v = (out.get(e) ?? 0) + c;
    if (v === 0) out.delete(e);
    else out.set(e, v);
  }
  return out;
}

export function lMul(a: Laurent, b: Laurent): Laurent {
  const out: Laurent = new Map();
  for (const [ea, ca] of a) {
    for (const [eb, cb] of b) {
      const e = ea + eb;
      const v = (out.get(e) ?? 0) + ca * cb;
      if (v === 0) out.delete(e);
      else out.set(e, v);
    }
  }
  return out;
}

export function lPow(a: Laurent, n: number): Laurent {
  let out = lOne();
  for (let i = 0; i < n; i++) out = lMul(out, a);
  return out;
}

/** Scales every exponent — used to convert A-powers into t-powers. */
export function lSubstituteExponent(a: Laurent, factor: number): Laurent {
  const out: Laurent = new Map();
  for (const [e, c] of a) out.set(e * factor, c);
  return out;
}

/**
 * Prints a Laurent polynomial in `sym`, with quarter-exponents rendered as
 * fractions so a half-integer power of t reads as t^(1/2) rather than a decimal.
 */
export function lFormat(a: Laurent, sym = "t", denom = 1): string {
  const terms = [...a.entries()].sort((x, y) => x[0] - y[0]);
  if (!terms.length) return "0";
  const parts: string[] = [];
  for (const [e, c] of terms) {
    const num = e;
    let power: string;
    if (num === 0) power = "";
    else {
      const g = gcd(Math.abs(num), denom) || 1;
      const n = num / g, d = denom / g;
      power = d === 1 ? `${sym}^${n}` : `${sym}^(${n}/${d})`;
      if (d === 1 && n === 1) power = sym;
    }
    const coeff = power === "" ? String(c) : c === 1 ? "" : c === -1 ? "-" : String(c);
    parts.push(`${coeff}${power}`);
  }
  return parts
    .map((p, i) => (i === 0 ? p : p.startsWith("-") ? ` - ${p.slice(1)}` : ` + ${p}`))
    .join("");
}

function gcd(a: number, b: number): number {
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

// ---------------------------------------------------------------------------
// Braid words
// ---------------------------------------------------------------------------

export interface Braid {
  /** Generators: +i is σᵢ, −i is σᵢ⁻¹. 1-based strand index. */
  word: number[];
  /** Number of strands; at least max|generator| + 1. */
  strands: number;
}

/** Parses "1 1 1", "s1 s1 s1", "1,-2,1,-2" or "σ1 σ2^-1" into a braid word. */
export function parseBraid(text: string): Braid | null {
  const cleaned = text
    .replace(/[σs]\s*/gi, "")
    .replace(/\^\s*-\s*1/g, "!")   // σᵢ^-1 → marker
    .replace(/[,;]/g, " ");
  // Refuse decimals outright. "1.5" was being split into the two generators
  // 1 and 5, silently answering for a braid nobody typed.
  if (/\d\.\d/.test(cleaned)) return null;
  const tokens = cleaned.match(/-?\d+!?/g);
  if (!tokens || !tokens.length) return null;
  const word: number[] = [];
  for (const t of tokens) {
    const inv = t.endsWith("!");
    const n = parseInt(t.replace("!", ""), 10);
    if (!Number.isFinite(n) || n === 0) return null;
    word.push(inv ? -Math.abs(n) : n);
  }
  const strands = Math.max(2, ...word.map((g) => Math.abs(g) + 1));
  if (strands > MAX_STRANDS) return null; // "999" would ask for a 1000-strand braid
  return { word, strands };
}

/**
 * Caps, both measured rather than guessed.
 *
 * The state sum is 2^n, and Solve recomputes on EVERY KEYSTROKE. Measured on
 * this machine: 16 crossings ~460ms, 18 ~2.9s, 20 ~13.2s. Twenty was the first
 * cap and it let a user freeze the pane for thirteen seconds a character, which
 * is the same class of defect as the quadrature hang. Sixteen is the last value
 * that stays usable.
 */
const MAX_CROSSINGS = 16;

/** A braid on hundreds of strands is a typo, not a knot. */
const MAX_STRANDS = 24;

// ---------------------------------------------------------------------------
// Kauffman bracket and the Jones polynomial
// ---------------------------------------------------------------------------

/** Union-find over the arc endpoints of a smoothed diagram. */
class DSU {
  private p: number[] = [];
  find(x: number): number {
    while (this.p[x] === undefined) this.p[x] = x;
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p[ra] = rb;
  }
}

/**
 * Counts the loops in one fully smoothed state of a braid closure.
 *
 * `bits` selects, per crossing, whether the CUP-CAP smoothing is applied
 * (bit 1) or the strands pass straight down (bit 0). Which of those counts as
 * the A-smoothing depends on the SIGN of the crossing — see `smoothingCounts`,
 * where getting that backwards silently corrupts any braid with mixed signs.
 * Closing the braid identifies the bottom of each strand with its own top.
 */
function stateLoops(braid: Braid, bits: number): number {
  const { word, strands } = braid;
  const dsu = new DSU();
  let next = strands;
  const current: number[] = Array.from({ length: strands }, (_, i) => i);

  word.forEach((g, k) => {
    const i = Math.abs(g) - 1;
    const cupCap = ((bits >> k) & 1) === 1;
    if (!cupCap) return; // strands pass straight down; nothing to join
    // Cup-cap: cap the two incoming ends together, start a fresh cup below.
    dsu.union(current[i], current[i + 1]);
    const a = next++, b = next++;
    dsu.union(a, b);
    current[i] = a;
    current[i + 1] = b;
  });

  // Close the braid: bottom of strand i rejoins top of strand i.
  for (let i = 0; i < strands; i++) dsu.union(current[i], i);

  const roots = new Set<number>();
  for (let x = 0; x < next; x++) roots.add(dsu.find(x));
  return roots.size;
}

/**
 * How many A- and B-smoothings a state uses.
 *
 * THE SIGN OF THE CROSSING SWAPS THEM. For a positive crossing σᵢ the
 * straight-through smoothing is the A one and the cup-cap is B; for σᵢ⁻¹ it is
 * the other way round. Treating every crossing alike is correct only for braids
 * whose crossings all share a sign — which is why an all-positive trefoil looked
 * nearly right while the mixed-sign figure-eight came out missing terms.
 */
function smoothingCounts(word: number[], bits: number): { a: number; b: number } {
  let a = 0, b = 0;
  word.forEach((g, k) => {
    const cupCap = ((bits >> k) & 1) === 1;
    const isA = g > 0 ? !cupCap : cupCap;
    if (isA) a++;
    else b++;
  });
  return { a, b };
}

export interface KnotResult {
  braid: Braid;
  crossings: number;
  writhe: number;
  /** Kauffman bracket in A. */
  bracket: Laurent;
  bracketDisplay: string;
  /** Jones polynomial; exponents are QUARTER powers of t. */
  jones: Laurent;
  jonesDisplay: string;
  /** Components of the closure — 1 means a knot, more means a link. */
  components: number;
  steps: string[];
  caveats: string[];
}

/**
 * Jones polynomial of the closure of a braid, exactly.
 * Throws when the crossing count exceeds the cap, because a truncated state sum
 * would be a wrong polynomial rather than an incomplete one.
 */
export function jonesPolynomial(braid: Braid): KnotResult {
  const n = braid.word.length;
  if (n > MAX_CROSSINGS) {
    throw new Error(
      `That braid has ${n} crossings, and the Kauffman bracket is a sum over 2^n = ${2 ** n} states. ` +
      `The cap is ${MAX_CROSSINGS} crossings (${2 ** MAX_CROSSINGS} states), which is where it stays interactive. A truncated state sum would ` +
      `be a WRONG polynomial rather than an incomplete one, so it is refused.`
    );
  }
  const steps: string[] = [];
  const A = lMono(1);
  const Ainv = lMono(-1);
  // δ = −A² − A⁻²  is the loop value.
  const delta = lAdd(lMono(2, -1), lMono(-2, -1));

  let bracket = lZero();
  for (let bits = 0; bits < 1 << n; bits++) {
    const { a, b } = smoothingCounts(braid.word, bits);
    const loops = stateLoops(braid, bits);
    // A^(a−b) · δ^(loops−1)
    const term = lMul(lMono(a - b), lPow(delta, loops - 1));
    bracket = lAdd(bracket, term);
  }

  const writhe = braid.word.reduce((s, g) => s + (g > 0 ? 1 : -1), 0);
  // f = (−A³)^(−writhe)·⟨D⟩. The exponent is NEGATIVE writhe: raising to +writhe
  // instead gives a polynomial with half-integer t-powers for a knot, which is
  // impossible and is how the error announced itself.
  let factor = lOne();
  const per = writhe > 0 ? lMono(-3, -1) : lMono(3, -1); // (−A³)^∓1
  for (let i = 0; i < Math.abs(writhe); i++) factor = lMul(factor, per);
  const f = lMul(factor, bracket);

  // V(t) = f with A = t^(−1/4): every A-exponent e becomes t^(−e/4).
  // Exponents are kept as QUARTER powers so nothing is rounded.
  const jones = lSubstituteExponent(f, -1);

  const components = stateLoops({ word: [], strands: braid.strands }, 0) === braid.strands
    ? countClosureComponents(braid)
    : countClosureComponents(braid);

  steps.push(`Braid word ${braid.word.map(fmtGen).join(" ")} on ${braid.strands} strands, ${n} crossing${n === 1 ? "" : "s"}.`);
  steps.push(`Kauffman bracket: a sum over all 2^${n} = ${2 ** n} smoothings, computed exactly.`);
  steps.push(`Writhe = ${writhe}; V(t) = (−A³)^(−writhe)·⟨D⟩ evaluated at A = t^(−1/4).`);
  steps.push(`The closure has ${components} component${components === 1 ? "" : "s"} — ${components === 1 ? "a knot" : "a link"}.`);

  const caveats = [
    "The Jones polynomial is NOT a complete invariant: distinct knots can share it (the Kinoshita–Terasaka and Conway pair is the standard example), and whether it detects the unknot is an OPEN PROBLEM. Two knots with the same polynomial are not thereby proved equivalent — a match is evidence, never proof.",
    "Different braid words can close to the same knot (Markov moves), so a different-looking input may legitimately give the same polynomial.",
  ];

  return {
    braid,
    crossings: n,
    writhe,
    bracket,
    bracketDisplay: lFormat(bracket, "A"),
    jones,
    jonesDisplay: lFormat(jones, "t", 4),
    components,
    steps,
    caveats,
  };
}

const fmtGen = (g: number): string => (g > 0 ? `σ${g}` : `σ${-g}⁻¹`);

/** Components of the braid closure = cycles of the underlying permutation. */
export function countClosureComponents(braid: Braid): number {
  const perm = Array.from({ length: braid.strands }, (_, i) => i);
  for (const g of braid.word) {
    const i = Math.abs(g) - 1;
    const t = perm[i]; perm[i] = perm[i + 1]; perm[i + 1] = t;
  }
  const seen = new Array(braid.strands).fill(false);
  let cycles = 0;
  for (let i = 0; i < braid.strands; i++) {
    if (seen[i]) continue;
    cycles++;
    let j = i;
    while (!seen[j]) { seen[j] = true; j = perm[j]; }
  }
  return cycles;
}

// ---------------------------------------------------------------------------
// π₁ of the knot complement — Wirtinger presentation.
//
// SCOPED HARD, on purpose. The presentation is computable and so is its
// abelianisation; SIMPLIFYING it, or deciding whether the group is trivial, is
// not — the word problem for groups is undecidable (Novikov–Boone). So this
// reports a presentation and the abelianisation, and explicitly does not claim
// to have identified the group.
// ---------------------------------------------------------------------------

export interface WirtingerResult {
  generators: string[];
  relations: string[];
  /** H₁ of the complement — always ℤ for a knot, ℤ^k for a k-component link. */
  abelianisation: string;
  steps: string[];
  caveats: string[];
}

/**
 * Wirtinger presentation from a braid word. One generator per strand-segment,
 * one relation per crossing, and the abelianisation computed from them.
 */
export function wirtingerPresentation(braid: Braid): WirtingerResult {
  const { word, strands } = braid;
  const gens: string[] = [];
  const current: string[] = [];
  let counter = 0;
  const fresh = (): string => `x${++counter}`;
  for (let i = 0; i < strands; i++) { const g = fresh(); gens.push(g); current[i] = g; }

  const relations: string[] = [];
  for (const g of word) {
    const i = Math.abs(g) - 1;
    const a = current[i], b = current[i + 1];
    const c = fresh();
    gens.push(c);
    // At a crossing the under-strand is conjugated by the over-strand.
    relations.push(g > 0 ? `${c} = ${a} ${b} ${a}^-1` : `${c} = ${a}^-1 ${b} ${a}`);
    current[i] = b;
    current[i + 1] = c;
  }
  // Closing the braid identifies the bottom of each strand with its top.
  for (let i = 0; i < strands; i++) {
    if (current[i] !== gens[i]) relations.push(`${current[i]} = ${gens[i]}`);
  }

  const components = countClosureComponents(braid);
  const abelianisation = components === 1 ? "Z" : `Z^${components}`;

  return {
    generators: gens,
    relations,
    abelianisation,
    steps: [
      `${gens.length} generators, one per arc; ${relations.length} relations, one per crossing plus the closure.`,
      `Every Wirtinger relation conjugates the under-strand by the over-strand.`,
      `Abelianised, all generators become equal, so H₁ of the complement is ${abelianisation} — ${components === 1 ? "as it is for every knot" : `one Z per component of the ${components}-component link`}.`,
    ],
    caveats: [
      "This is a PRESENTATION, not an identification. Simplifying a group presentation, or deciding whether the group is trivial, is UNDECIDABLE in general (the word problem — Novikov–Boone), so this tool never claims to recognise the group it has written down.",
      "The ABELIANISATION is fully computable and is the reliable part: H₁ of a knot complement is always Z, which is exactly why H₁ alone distinguishes no knots at all.",
    ],
  };
}

// ---------------------------------------------------------------------------
// A small table of braid words people actually want to type.
// ---------------------------------------------------------------------------

export const KNOT_BRAIDS: Record<string, { word: number[]; strands: number; note: string }> = {
  unknot: { word: [], strands: 1, note: "the trivial knot; V = 1" },
  // Which closure you call "right-handed" depends on the diagram convention, so
  // these are named for the braid word and the chirality is stated rather than
  // assumed. What matters, and what the tool demonstrates, is that the two
  // mirror images have DIFFERENT Jones polynomials (t ↔ t⁻¹) — the classic
  // demonstration that the invariant sees chirality where homology cannot.
  trefoil: { word: [-1, -1, -1], strands: 2, note: "3₁ as σ₁⁻³; V = −t⁻⁴ + t⁻³ + t⁻¹" },
  "trefoil-mirror": { word: [1, 1, 1], strands: 2, note: "the mirror image, σ₁³; V = t + t³ − t⁴" },
  "figure-8": { word: [1, -2, 1, -2], strands: 3, note: "4₁, amphichiral — its V is palindromic" },
  "hopf-link": { word: [1, 1], strands: 2, note: "the two-component Hopf link" },
  cinquefoil: { word: [1, 1, 1, 1, 1], strands: 2, note: "5₁, the (2,5) torus knot" },
  "solomon-link": { word: [1, 1, 1, 1], strands: 2, note: "the (2,4) torus link" },
};
