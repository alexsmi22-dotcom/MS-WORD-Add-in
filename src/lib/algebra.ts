// Abstract algebra — the front door for the seventh Discrete-math engine
// (v2.134.0, docs/SCOPE-ABSTRACT-ALGEBRA.md): finite groups (ℤ/n, U(n), Sₙ,
// Aₙ, Dₙ, Q₈, V₄, Dicₙ, products, a typed Cayley table), permutations in
// cycle notation, homomorphisms between ℤ/n and U(n), ring arithmetic in
// ℤ/n, polynomials over 𝔽p, and the finite fields GF(pᵏ).
//
// CLAIM DISCIPLINE. This engine is meant to run FIRST in ENGINES (before
// number theory, which strips parentheses; before combinatorics, which reads
// D4 as a derangement count; before logic, which reads -> and ^). So it
// claims an input only when a verb below parses it COMPLETELY; everything
// else is null and falls through untouched. The number-theory boundary is a
// stand-aside list (the negative lookahead of ALGEBRA_RE) plus a run-time
// backstop: if tryNumberTheory answers or refuses the text, it is theirs.
//
// Every printed polynomial and permutation is re-read by this engine's own
// reader and compared before it is shown (the display contract, enforced at
// run time); every cap is checked from the typed numbers before any work.

import { DiscreteResult, DiscreteError, foldSuperscripts } from "./discrete";
import { tryNumberTheory, isPrime } from "./numtheory";
import {
  GroupSpec, readGroup, buildSpec, describeGroup, cayleyTableVerb, orderOfElementVerb, allOrdersVerb, elementsOfOrderVerb, generatedVerb,
  subgroupsVerb, cyclicVerb, abelianVerb, generatorsVerb, isGeneratorVerb, cosetsVerb, normalVerb, quotientVerb, centerVerb, classesVerb,
  isoTypeVerb, isomorphismVerb, findAllGroupsVerb, autVerb, tryPermutation, tryNamedPerms, homomorphismVerb, readSubgroup, res, isoTypeLine,
} from "./algebraGroupVerbs";
import { tableGroup, unitsGroup, cyclicName, gcdN, MAX_ORDER } from "./algebraGroups";
import {
  parseAlgExpr, freeVars, hasOperator, evalIntMod, evalIntExact, evalPolyMod, showPoly, polyString, P, ptrim, pdeg, pmul, pdivmod, peval,
  pegcd, decideIrreducible, factorFp, factorString, trialCandidates, TRIAL_CAP, RABIN_MAX_DEGREE, MAX_P, buildField, GField, elemName,
  elemPoly, polyElem, gfAdd, gfMul, gfInv, gfOrder, gfPow, minimalPolynomial, primePower, MAX_FIELD, isPrimeN, sub, pmonic, rabinIrreducible,
  assertPolyRoundTrip, FULL_FIELD_CHECK, pmod, peq, ppowmod, pgcd, psub, clip, invModB, evalField,
} from "./algebraFields";
import { cayleyTableSvg, MAX_TABLE, TableTooWideError } from "./cayleyTableSvg";

// ---------------------------------------------------------------------------
// Folding and the guard

const SUBS = "₀₁₂₃₄₅₆₇₈₉";

/** Subscript digits → _digits, so ℤ₁₂, 𝔽₉, S₃ (as this engine prints them) read back. */
export function foldSubscripts(s: string): string {
  return s.replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (run) => "_" + [...run].map((c) => String(SUBS.indexOf(c))).join(""));
}

/** The engine's normal form: subscripts and superscripts folded, ℤ → Z, 𝔽 → F, ⟨⟩ → <>, − → -, ↦ → ->. */
export function normalizeAlgebra(input: string): string {
  let s = foldSuperscripts(foldSubscripts(input.replace(/\r/g, "")));
  s = s.split("𝔽").join("F").replace(/ℤ/g, "Z").replace(/[⟨〈]/g, "<").replace(/[⟩〉]/g, ">").replace(/[−–—]/g, "-").replace(/↦|⟼|→/g, "->").replace(/≡/g, "=").replace(/[“”]/g, '"').replace(/[’]/g, "'");
  s = s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1)).join("\n").trim();
  return s;
}

const NB = "(?<![A-Za-z0-9_])";
/** Letter-by-letter case-insensitive alternation for a keyword (the guard is case-sensitive overall: D4 ≠ d4). */
function ci(word: string): string {
  return word.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
}

const NT_STAND_ASIDE = String.raw`^(?!\s*(?:(?:order|ord|inverse|inv|modular inverse|primitive roots?|generators?)\s+(?:of\s+)?\d+\s+mod\b|\d+\s*(?:\^|\*\*)\s*-?\d+\s*mod\b|\d+\s+mod\s+\d+\s*$|x\s*\^\s*2\s*=\s*-?\d+\s*mod\b|\d+\s*=\s*\d+\s*mod\b))`;

function buildGroupRe(): string {
  return [
    String.raw`(?:Z|ℤ)\s*\/\s*-?\d+`,
    `${NB}(?:Z|ℤ)_?\\d+\\b`,
    `${NB}(?:Z|ℤ)[₀₁₂₃₄₅₆₇₈₉]`,
    ci("integers") + String.raw`\s+mod`,
    `${NB}U\\s*\\(\\s*-?\\d+\\s*\\)`,
    `${NB}(?:S|Sym|A|D|Dic)_?\\d+\\b`,
    `${NB}(?:S|Sym|A|D|Dic)[₀₁₂₃₄₅₆₇₈₉]`,
    `${NB}(?:S|Sym)\\s*\\(\\s*\\d+\\s*\\)`,
    `${NB}[QV]_?[48]\\b`,
    `${NB}[QV][₄₈]`,
    ci("klein"),
    `${NB}GF\\s*\\(`,
    `${NB}(?:F|𝔽)_?\\d+\\b`,
    `(?:F|𝔽)[₀₁₂₃₄₅₆₇₈₉]`,
    `${ci("symmetric")}\\s+${ci("group")}|${ci("alternating")}\\s+${ci("group")}|${ci("dihedral")}\\s+${ci("group")}|${ci("quaternion")}\\s+${ci("group")}|${ci("cyclic")}\\s+${ci("group")}|${ci("symmetries")}\\s+${ci("of")}`,
  ].join("|");
}

const KEYWORDS = [
  "cayley", "multiplication table", "addition table", "operation table", "subgroup", "coset", "normal", "quotient", "center", "centre", "conjugacy",
  "class equation", "isomorphi", "homomorphism", "kernel", "image of", "generator", "cyclic", "abelian", "order of", "orders of", "elements of order",
  "permutation", "cycle type", "cycle diagram", "cycle structure", "sign of", "parity of", "compose", "inverse of", "units of", "zero divisor",
  "field", "irreducible", "minimal polynomial", "primitive element", "extended euclid", "groups of order", "chinese remainder", "transposition",
  "two-row", "two row", "aut(", "automorphism", "lagrange", "units mod", "units in",
];

function buildAlgebraRe(): RegExp {
  const kw = KEYWORDS.map((k) => ci(k).replace(/ /g, "\\s+").replace(/\(/g, "\\(")).join("|");
  const cyc = String.raw`\(\s*\d+(?:[\s,]+\d+)*\s*\)`;
  const alts = [
    `[\\s\\S]*(?:${buildGroupRe()})`,
    `[\\s\\S]*(?:${kw}|≅)`,
    String.raw`\s*(?:e|id|${cyc})(?:\s*[*∘·]?\s*${cyc})*\s*(?:\^\s*\(?-?\d+\)?)?`,
    String.raw`[^\n]*[-+*×·^/÷][^\n]*\b${ci("mod")}(?:${ci("ulo")})?\s+-?\d+\s*\)?\s*$`,
    String.raw`\s*\[\s*\d+(?:[\s,]+\d+)+\s*\]\s*$`,
    String.raw`\s*(?:\d+\s+)+\d+\s*\/\s*(?:\d+\s+)+\d+\s*$`,
    String.raw`[\s\S]*\b[a-z]\s*\^\s*\d+\s*=\s*e\b`,
    String.raw`[\s\S]*<\s*[a-z](?:\s*,\s*[a-z])*\s*\|`,
    String.raw`\s*[a-z]\s*[*·]?\s*[a-z]\s*=\s*e\s*$`,
    String.raw`[\s\S]*[A-Za-zα-ω]\w*\s*=\s*\(\s*\d`,
  ];
  return new RegExp(`${NT_STAND_ASIDE}(?:${alts.join("|")})`);
}

/**
 * The algebra guard. Matches raw or normalised input (unicode spellings are
 * alternatives). The negative lookahead IS the number-theory boundary:
 * `order of 3 mod 7`, `inverse 5 mod 12`, `primitive roots mod 10`,
 * `7^100 mod 13`, `3^-1 mod 7`, `x^2 = 2 mod 7`, `5 = 2 mod 3`, `17 mod 5`
 * never match. A match is necessary, not sufficient: tryAlgebra still has to
 * parse the input completely.
 */
export const ALGEBRA_RE: RegExp = buildAlgebraRe();

/** The coarse SHAPE of a presentation; the decision is isPresentation (narrower: a lone x^2 = e is an equation). */
export const PRESENTATION_RE =/\b[a-z]\s*\^\s*\d+\s*=\s*e\b|<\s*[a-z](?:\s*,\s*[a-z])*\s*\||^\s*[a-z]\s*[*·]?\s*[a-z]\s*=\s*e\s*$/;

/**
 * A presentation is refused by name — but only when it is unmistakably one:
 * ⟨a, b | …⟩, two or more relations "… = e", or a product of two generator
 * letters "= e" (a * b = e). A single "x^2 = e" is an ordinary equation in
 * the Equation kind (e = Euler's number) and is left alone.
 */
export function isPresentation(t: string): boolean {
  if (/<\s*[a-z](?:\s*,\s*[a-z])*\s*\|/i.test(t)) return true;
  if (/[{}]/.test(t)) return false;
  const rels = t.split(/[,;\n]/).filter((p) => /^\s*[a-z](?:\s*\^\s*-?\d+)?(?:\s*[*·]?\s*[a-z](?:\s*\^\s*-?\d+)?)*\s*=\s*e\s*$/.test(p));
  if (rels.length >= 2 && rels.length === t.split(/[,;\n]/).filter((p) => p.trim()).length) return true;
  return /^\s*([a-wA-W])\s*[*·]?\s*([a-wA-W])\s*=\s*e\s*$/.test(t) && !/^\s*[xyzt]/.test(t);
}

/** True when number theory answers or refuses the text — then it is theirs. */
function numberTheoryOwns(text: string): boolean {
  if (!/\bmod(?:ulo)?\b|≡|%|\binverse\b|\binv\b|\border\b|\bord\b|\bprimitive\b|\bgenerators?\b|\bgcd\b|\blcm\b/i.test(text)) return false;
  try {
    return tryNumberTheory(text) !== null;
  } catch (err) {
    if (err instanceof DiscreteError) return true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Front door

export function tryAlgebra(input: string): DiscreteResult | null {
  const raw = input.replace(/\r/g, "").trim();
  if (!raw || raw.length > 4000) return null;
  const t = normalizeAlgebra(raw).replace(/[?]+$/, "").replace(/\.$/, "").trim();
  if (!t) return null;
  const block = tryCayleyBlock(t);
  if (block) return block;
  // x^2 = a mod n: number theory's square-root verb owns it — but it reads a
  // PRIME modulus only and refuses the rest; a composite modulus is answered
  // here by checking every residue (otherwise the line is an orphan).
  if (/^(?:solve\s+)?x\s*\^\s*2\s*=\s*-?\d+\s*\(?\s*mod(?:ulo)?\s*\d+\s*\)?$/i.test(t)) {
    try {
      if (tryNumberTheory(t)) return null;
    } catch (err) {
      if (!(err instanceof DiscreteError)) throw err;
      const r = tryRing(t);
      if (r) r.caveats.push("Number theory's square-root verb reads a prime modulus only; for this modulus every residue was checked.");
      return r;
    }
    return null;
  }
  if (!ALGEBRA_RE.test(t) && !ALGEBRA_RE.test(raw)) return null;
  if (numberTheoryOwns(foldSuperscripts(raw)) || numberTheoryOwns(t)) return null;
  if (isPresentation(t)) {
    throw new DiscreteError("Group presentations ⟨a, b | a² = b³ = e, …⟩ are not read: give the group concretely (Z/6, S3, D4, U(8), Z/2 x Z/4, or a Cayley table).");
  }
  const lines = t.split("\n");
  if (lines.length > 1) {
    const named = tryNamedPerms(t);
    if (named) return named;
    return null;
  }
  const handlers: ((s: string) => DiscreteResult | null)[] = [tryNamedPermsLine, tryField, tryPolynomial, tryRing, tryHomomorphism, tryPermutation, tryGroupVerb];
  for (const h of handlers) {
    const r = h(t);
    if (r) return r;
  }
  return null;
}

function tryNamedPermsLine(t: string): DiscreteResult | null {
  if (!/^[A-Za-zα-ω]\w*\s*=\s*\(/.test(t)) return null;
  return tryNamedPerms(t);
}

// ---------------------------------------------------------------------------
// A group given by its Cayley table

// Corner markers are NON-element symbols only — never a letter: "x y / y x" is ℤ/2 (W4).
const CORNER = new Set(["·", "*", "∘", "+", "×", "|", "-", "op"]);

function tryCayleyBlock(t: string): DiscreteResult | null {
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const head = /^(?:the\s+)?(?:(?:a\s+)?group\s+(?:with|given\s+by|defined\s+by)\s+(?:the\s+|this\s+)?)?(?:cayley|multiplication|operation|group)\s+table\s*:?\s*$/i.exec(lines[0]);
  const body = head ? lines.slice(1) : lines;
  const rows = body.map((l) => l.replace(/\|/g, " ").split(/[\s,]+/).filter(Boolean));
  if (rows.length < 1) return null;
  const tok = /^[A-Za-z0-9_'()^+-]{1,12}$/;
  if (!rows.every((r) => r.every((x) => tok.test(x) || CORNER.has(x)))) {
    if (head) throw new DiscreteError("A Cayley table is read as rows of element names separated by spaces (or |): the first row lists the elements, each row then gives that element's products.");
    return null;
  }
  let labels: string[] | null = null;
  let table: string[][] | null = null;
  const n0 = rows[0].length;
  // Form A: n rows of n entries, the first row and first column agreeing (the identity row/column).
  if (rows.length === n0 && rows.every((r) => r.length === n0) && n0 >= 2 && !CORNER.has(rows[0][0])) {
    const col0 = rows.map((r) => r[0]);
    if (col0.join(" ") === rows[0].join(" ")) { labels = rows[0]; table = rows; }
  }
  // Form B: a header row (optionally with a corner symbol), then rows "label entries…".
  if (!labels) {
    let hdr = rows[0];
    if (hdr.length && CORNER.has(hdr[0])) hdr = hdr.slice(1);
    const n = hdr.length;
    const rest = rows.slice(1);
    if (n >= 1 && rest.length === n && rest.every((r) => r.length === n + 1)) {
      const rowLabels = rest.map((r) => r[0]);
      if (rowLabels.join(" ") !== hdr.join(" ")) {
        if (!head) return null;
        throw new DiscreteError(`The row labels (${rowLabels.join(", ")}) do not match the column labels (${hdr.join(", ")}) — list the rows in the same order as the columns.`);
      }
      labels = hdr;
      table = rest.map((r) => r.slice(1));
    }
  }
  if (!labels || !table) {
    if (head) throw new DiscreteError("This Cayley table is not square: give n rows of n entries (first row = first column), or a header row followed by rows that start with their element.");
    return null;
  }
  if (!head) {
    // A bare grid is claimed only when it is a Latin square — every row a permutation of the labels.
    const set = labels.join(" ");
    const sorted = [...labels].sort().join(" ");
    if (new Set(labels).size !== labels.length || !table.every((r) => [...r].sort().join(" ") === sorted)) return null;
    void set;
  }
  if (labels.length > MAX_ORDER) throw new DiscreteError(`A table of ${labels.length} elements is above the cap |G| ≤ ${MAX_ORDER}.`);
  const G = tableGroup(labels, table);
  const spec: GroupSpec = { name: "G", order: BigInt(G.n), build: () => G, caveats: [], cyclicFactors: null };
  const r = describeGroup(spec, G);
  const typeLine = isoTypeLine(G);
  const m = /(?:≅|isomorphism type:?)\s*([^—(:]+)/.exec(typeLine);
  r.display.unshift(`a group of order ${G.n}${m ? ` ≅ ${m[1].trim()}` : ""} (axioms checked)`);
  r.title = `Group given by a Cayley table (order ${G.n})`;
  return r;
}

// ---------------------------------------------------------------------------
// Ring arithmetic in ℤ/n

/** "Z/12", "Z_12", "Z12", "integers mod 12", "F_7"/"GF(7)" (prime) → n. */
function readRingModulus(s0: string): bigint | null {
  const s = s0.trim().replace(/^the\s+(?:ring\s+)?/i, "");
  let m: RegExpExecArray | null;
  // The modulus is read EXACTLY as typed (BigInt) — never substituted.
  if ((m = /^Z\s*\/\s*(-?\d+)\s*Z?$/.exec(s)) || (m = /^Z_?(\d+)$/.exec(s)) || (m = /^integers\s+mod(?:ulo)?\s+(-?\d+)$/i.exec(s))) return BigInt(m[1]);
  if ((m = /^(?:F_?|GF\s*\(\s*)(\d+)\s*\)?$/.exec(s))) {
    const q = BigInt(m[1]);
    if (isPrime(q).prime) return q;
    return null;
  }
  return null;
}

function checkModulus(n: bigint): void {
  if (n === 0n) throw new DiscreteError("mod 0 is not a reduction: ℤ/0ℤ is ℤ itself — give a modulus n ≥ 1.");
  if (n < 0n) throw new DiscreteError(`A modulus must be positive (got ${n}); ℤ/nℤ = ℤ/(−n)ℤ, so write ${-n}.`);
}

const pretty = (s: string): string => s.replace(/\*\*/g, "^").replace(/\s*\*\s*/g, " · ").replace(/\s*×\s*/g, " · ").replace(/\s+/g, " ").trim();
const RING_TAIL = String.raw`(Z\s*\/\s*-?\d+\s*Z?|Z_?\d+|integers\s+mod(?:ulo)?\s+-?\d+|F_?\d+|GF\s*\(\s*\d+\s*\))`;

function ringArithmetic(expr: string, n: bigint, how: string): DiscreteResult | null {
  checkModulus(n);
  const sides = expr.split("=");
  if (sides.length > 2) return null;
  const asts = sides.map((x) => parseAlgExpr(x.trim()));
  if (asts.some((a) => !a)) return null;
  if (asts.some((a) => freeVars(a!).size)) return null;
  if (!asts.some((a) => hasOperator(a!)) && sides.length === 1) return null;
  const R = `ℤ/${n}ℤ`;
  const vals = asts.map((a) => evalIntMod(a!, n));
  const hasDiv = /\//.test(expr);
  // The exact value is shown only while it is readable (≤ 40 digits); beyond, the reduction is step by step.
  const exact = asts.map((a) => { const e = evalIntExact(a!); return e !== null && (e < 0n ? -e : e).toString().length <= 40 ? e : null; });
  const steps: string[] = [];
  const say = (i: number): string => {
    const e = exact[i];
    const p = pretty(sides[i]);
    if (e === null) return `${p} ≡ ${vals[i]} (mod ${n}) — reduced step by step (the exact value is not formed${/\^\s*-/.test(sides[i]) ? ": a negative power is an inverse" : ": it would be too large"})`;
    if (!hasOperator(asts[i]!)) return `${p} ≡ ${vals[i]} (mod ${n})`;
    const q = (e - vals[i]) / n;
    return `${p} = ${e} = ${q} · ${n} + ${vals[i]}, so ${p} ≡ ${vals[i]} (mod ${n})`;
  };
  if (sides.length === 2) {
    const holds = vals[0] === vals[1];
    steps.push(say(0), say(1), `Read as a statement in ${R} (${how}).`);
    const e0 = exact[0];
    const lhs = `${pretty(sides[0])}${e0 !== null && hasOperator(asts[0]!) ? ` = ${e0}` : ""} ≡ ${vals[0]} (mod ${n})`;
    const rhsPlain = !hasOperator(asts[1]!) && exact[1] === vals[1];
    const line = rhsPlain ? `${lhs}: ${holds ? "TRUE" : `FALSE (not ${vals[1]})`}` : `${lhs} and ${pretty(sides[1])} ≡ ${vals[1]}: ${holds ? "TRUE" : "FALSE"}`;
    return res(`Congruence in ${R}`, [line], steps, []);
  }
  steps.push(say(0), `Computed in ${R} (${how}).`);
  if (hasDiv) steps.push(`Division in ${R} is multiplication by the inverse: a / b = a · b⁻¹ (defined when gcd(b, ${n}) = 1).`);
  return res(`Arithmetic in ${R}`, [`${pretty(sides[0])} ≡ ${vals[0]} (mod ${n})`], steps, []);
}

function zeroDivisorWitness(a: bigint, n: bigint): bigint | null {
  const g = gcdB(a, n);
  if (g === 1n || a % n === 0n) return null;
  return n / g;
}
function gcdB(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; }

const RING_LIST_CAP = 10_000n;

function tryRing(t: string): DiscreteResult | null {
  let m: RegExpExecArray | null;
  // in Z/12: 7 + 9
  if ((m = new RegExp(String.raw`^in\s+${RING_TAIL}\s*:\s*(.+)$`, "i").exec(t))) {
    const n = readRingModulus(m[1]);
    if (n === null) return null;
    return ringArithmetic(m[2], n, `in ${m[1].trim()}`);
  }
  // inverse of 5 in Z/12 · 5^-1 in Z/12
  if ((m = new RegExp(String.raw`^(?:the\s+)?(?:multiplicative\s+)?inverse\s+of\s+(-?\d+)\s+(?:in|mod(?:ulo)?)\s+${RING_TAIL}$`, "i").exec(t)) || (m = new RegExp(String.raw`^(-?\d+)\s*\^\s*\(?-1\)?\s+in\s+${RING_TAIL}$`, "i").exec(t))) {
    const n = readRingModulus(m[2]);
    if (n === null) return null;
    checkModulus(n);
    const a = BigInt(m[1]);
    const ar = ((a % n) + n) % n;
    const g = gcdB(ar, n);
    const R = `ℤ/${n}ℤ`;
    if (n === 1n) return res(`Inverse in ${R}`, [`inverse of ${a} in ${R} = 0 — in the zero ring 0 = 1, so 0 is its own inverse`], [], []);
    if (g !== 1n) {
      const w = zeroDivisorWitness(ar, n);
      return res(`Inverse in ${R}`, [`none: gcd(${ar}, ${n}) = ${g}, so ${a} has no inverse in ${R}${w ? ` (${ar} is a zero divisor: ${ar} · ${w} = ${ar * w} ≡ 0)` : ""}`], [], []);
    }
    const iv = invModB(ar, n)!;
    if ((ar * iv) % n !== 1n % n) throw new DiscreteError("Cross-check failed: a · a⁻¹ ≢ 1 — a defect in this tool.");
    const nt = tryNumberTheory(`inverse ${ar} mod ${n}`);
    return res(`Inverse in ${R}`, [`inverse of ${a} in ${R} = ${iv} (${ar} · ${iv} = ${ar * iv} ≡ 1)`], nt ? nt.steps : [], [`The working is the number-theory engine's extended Euclid on \`inverse ${ar} mod ${n}\` (one implementation).`]);
  }
  // units / zero divisors
  if ((m = new RegExp(String.raw`^(?:the\s+)?(units|zero[\s-]divisors|invertible\s+elements)\s+(?:of|in)\s+${RING_TAIL}$`, "i").exec(t))) {
    const n = readRingModulus(m[2]);
    if (n === null) return null;
    checkModulus(n);
    if (n > RING_LIST_CAP) throw new DiscreteError(`Listing the ${/^units|^invert/i.test(m[1]) ? "units" : "zero divisors"} of ℤ/${n}ℤ is capped at n ≤ ${RING_LIST_CAP}.`);
    const N = Number(n);
    const R = cyclicName(N);
    if (/^units|^invert/i.test(m[1])) {
      const us: number[] = [];
      for (let k = 0; k < N; k++) if (gcdN(k, N) === 1 && N > 1) us.push(k);
      if (N === 1) us.push(0);
      const display = [`units of ${R} = {${us.join(", ")}} (φ(${N}) = ${us.length})`];
      if (us.length <= MAX_ORDER) display.push(isoTypeLine(Object.assign(unitsGroup(N), { name: `U(${N})` })));
      return res(`Units of ${R}`, display, ["k is a unit exactly when gcd(k, n) = 1."], N === 1 ? ["In ℤ/1ℤ, 0 = 1 is the only element."] : []);
    }
    const zs: string[] = [];
    const wit: string[] = [];
    for (let k = 1; k < N; k++) {
      const w = zeroDivisorWitness(BigInt(k), n);
      if (w !== null) { zs.push(String(k)); if (wit.length < 40) wit.push(`${k} · ${w} = ${BigInt(k) * w} ≡ 0`); }
    }
    return res(`Zero divisors of ${R}`, [zs.length ? `zero divisors of ${R} = {${zs.join(", ")}}` : `${R} has no zero divisors${N > 1 ? ` (${N} is prime — ${R} is a field)` : ""}`], wit.length ? [`Witnesses: ${wit.join(" · ")}`] : [], ["A nonzero a is a zero divisor when a · b ≡ 0 for some nonzero b — exactly when gcd(a, n) > 1."]);
  }
  // is a a unit / zero divisor in Z/n
  if ((m = new RegExp(String.raw`^is\s+(-?\d+)\s+(?:a\s+)?(unit|zero[\s-]divisor|invertible)\s+(?:in|of|mod(?:ulo)?)\s+${RING_TAIL}$`, "i").exec(t))) {
    const n = readRingModulus(m[3]);
    if (n === null) return null;
    checkModulus(n);
    const a = ((BigInt(m[1]) % n) + n) % n;
    const g = gcdB(a, n);
    const R = `ℤ/${n}ℤ`;
    if (/unit|invertible/i.test(m[2])) {
      if (g === 1n) {
        const iv = invModB(a, n) ?? 0n;
        return res(`Is ${m[1]} a unit in ${R}?`, [`yes — gcd(${a}, ${n}) = 1; ${a}⁻¹ = ${iv} (${a} · ${iv} ≡ 1)`], [], []);
      }
      return res(`Is ${m[1]} a unit in ${R}?`, [`no — gcd(${a}, ${n}) = ${g} ≠ 1`], [], []);
    }
    const w = zeroDivisorWitness(a, n);
    return res(`Is ${m[1]} a zero divisor in ${R}?`, [w ? `yes — ${a} · ${w} = ${a * w} ≡ 0 (mod ${n})` : `no — gcd(${a}, ${n}) = ${g}${a === 0n ? " (0 itself is not counted)" : ""}`], [], []);
  }
  // is Z/n a field / integral domain
  if ((m = new RegExp(String.raw`^is\s+${RING_TAIL}\s+(?:a\s+|an\s+)?(field|integral\s+domain|domain)$`, "i").exec(t))) {
    const n = readRingModulus(m[1]);
    if (n === null) return null;
    checkModulus(n);
    const R = `ℤ/${n}ℤ`;
    const what = /field/i.test(m[2]) ? "field" : "integral domain";
    const art = what === "field" ? "a" : "an";
    if (n === 1n) return res(`Is ${R} ${art} ${what}?`, [`${R} is NOT ${art} ${what}: it is the zero ring (1 = 0)`], [], []);
    const pv = isPrime(n);
    if (pv.prime) {
      const invs: string[] = [];
      if (n <= 50n) for (let k = 1n; k < n; k++) invs.push(String(invModB(k, n)));
      const why = pv.certain ? `${n} is prime` : `${n} is a PROBABLE prime — Miller–Rabin with 13 bases, not a proof at this size`;
      return res(`Is ${R} ${art} ${what}?`, [`${R} is ${art} ${what} (${why}${invs.length ? `: every nonzero element has an inverse — ${invs.join(", ")}` : ""})`], [pv.certain ? "Primality proven (deterministic Miller–Rabin)." : "Primality is a probable-prime verdict for a number this large."], pv.certain ? [] : ["probable prime: the verdict holds unless the Miller–Rabin test was fooled"]);
    }
    let d = pv.factor ?? 0n;
    if (!d && n < 10n ** 14n) for (let k = 2n; k * k <= n; k++) if (n % k === 0n) { d = k; break; }
    if (!d) return res(`Is ${R} ${art} ${what}?`, [`${R} is NOT ${art} ${what}: ${n} is composite (a Miller–Rabin witness, ${pv.witness ?? "found"}), so it has zero divisors`], ["No small factor was found; compositeness is certain from the witness."], []);
    const e = n / d;
    return res(`Is ${R} ${art} ${what}?`, [`${R} is NOT ${art} ${what}: ${d} · ${e} ≡ 0, a zero divisor, so ${d} has no inverse`], [`${n} = ${d} · ${e} is composite.`], []);
  }
  // multiplication table of Z/n (the ring's ×, a monoid)
  if ((m = new RegExp(String.raw`^(?:the\s+)?multiplication\s+table\s+(?:of|for)\s+(Z\s*\/\s*-?\d+\s*Z?|Z_?\d+|integers\s+mod(?:ulo)?\s+-?\d+)$`, "i").exec(t)) || (m = new RegExp(String.raw`^(Z\s*\/\s*-?\d+\s*Z?|Z_?\d+)\s+multiplication\s+table$`, "i").exec(t))) {
    const n = readRingModulus(m[1]);
    if (n === null) return null;
    checkModulus(n);
    if (n > BigInt(MAX_TABLE)) throw new DiscreteError(`The multiplication table of ℤ/${n}ℤ is drawn for n ≤ ${MAX_TABLE} (the table cap).`);
    const N = Number(n);
    const labels = Array.from({ length: N }, (_, i) => String(i));
    const tab = labels.map((_, a) => labels.map((__, b) => (a * b) % N));
    const display = N <= 12 ? [`× | ${labels.join(" | ")}`, ...tab.map((r, i) => `${i}: ${r.join(" | ")}`)] : [`ℤ/${N}ℤ under ×: ${N} × ${N} table (drawn)`];
    const us = labels.filter((_, k) => gcdN(k, N) === 1 && N > 1);
    const note = isPrimeN(N) ? `0 has no inverse — the GROUP of units is U(${N}) = {${us.join(", ")}}` : `under × this is a monoid, not a group: 0 has no inverse, and neither has any zero divisor — the group of units is U(${N}) = {${us.join(", ")}}`;
    const svg = cayleyTableSvg(labels, tab, { caption: `Multiplication table of ℤ/${N}ℤ (0 row and column in grey)`, identity: N > 1 ? 1 : 0, grey: 0, op: "×" });
    return res(`Multiplication table of ℤ/${N}ℤ`, display, [note], [], svg, `Multiplication table of ℤ/${N}ℤ`);
  }
  // equations with x: solve 3x = 2 in Z/7 · x^2 + 1 = 0 in Z/5 · x^2 + 1 = 0 mod 3
  if ((m = new RegExp(String.raw`^(?:solve\s+)?(.+=.+?)\s+(?:in|over)\s+${RING_TAIL}$`, "i").exec(t)) || (m = /^(?:solve\s+)?(.+=.+?)\s*\(?\s*mod(?:ulo)?\s+(-?\d+)\s*\)?$/i.exec(t))) {
    const n = /^-?\d+$/.test(m[2].trim()) ? BigInt(m[2]) : readRingModulus(m[2]);
    if (n === null) return null;
    const sides = m[1].split("=");
    if (sides.length !== 2) return null;
    const A = parseAlgExpr(sides[0]), B = parseAlgExpr(sides[1]);
    if (!A || !B) return null;
    const vars = new Set([...freeVars(A), ...freeVars(B)]);
    if (vars.size === 0) return ringArithmetic(m[1], n, "statement");
    if (vars.size !== 1) return null;
    checkModulus(n);
    const fieldNamed = /^(?:F|GF)/.test(m[2].trim()) && n < 1_000_000_000n && isPrimeN(Number(n));
    return solveInZn(sides[0], sides[1], A, B, [...vars][0], n, fieldNamed ? `𝔽${sub(Number(n))}` : undefined);
  }
  // 7 * 9 in Z/12 · 7 * 9 mod 12
  if ((m = new RegExp(String.raw`^(.+?)\s+in\s+${RING_TAIL}$`, "i").exec(t))) {
    const n = readRingModulus(m[2]);
    if (n === null) return null;
    return ringArithmetic(m[1], n, `in ${m[2].trim()}`);
  }
  if ((m = /^(.+?)\s*\(?\s*mod(?:ulo)?\s+(-?\d+)\s*\)?$/i.exec(t))) {
    return ringArithmetic(m[1], BigInt(m[2]), "mod");
  }
  return null;
}

const ROOT_SCAN_CAP = 1_000_000n;
/** n × degree evaluations allowed for a residue scan (checked before any work). */
const ROOT_SCAN_BUDGET = 20_000_000;

function solveInZn(lt: string, rt: string, A: ReturnType<typeof parseAlgExpr>, B: ReturnType<typeof parseAlgExpr>, v: string, n: bigint, ringName?: string): DiscreteResult {
  const pa = evalPolyMod(A!, v, n), pb = evalPolyMod(B!, v, n);
  const len = Math.max(pa.length, pb.length);
  const f: bigint[] = [];
  for (let i = 0; i < len; i++) f.push((((pa[i] ?? 0n) - (pb[i] ?? 0n)) % n + n) % n);
  while (f.length && f[f.length - 1] === 0n) f.pop();
  const R = ringName ?? `ℤ/${n}ℤ`;
  const fs = showPoly(f, n, v);
  if (!f.length) return res(`Equation in ${R}`, [`every ${v} in ${R} is a solution: both sides agree identically mod ${n}`], [], []);
  if (f.length === 1) return res(`Equation in ${R}`, [`no solution: the equation reduces to ${f[0]} ≡ 0 (mod ${n}), which is false`], [], []);
  if (f.length === 2) {
    // a·x + b = 0  →  a x ≡ −b: the number-theory linear congruence (one solver).
    const a = f[1], b = (n - f[0]) % n;
    const nt = tryNumberTheory(`${a}x = ${b} mod ${n}`);
    if (!nt) throw new DiscreteError("Number theory did not answer the rewritten congruence — a defect in this tool.");
    const disp = nt.display.map((d) => d.replace(/\bx\b/g, v));
    return res(`Equation in ${R}`, disp, [`${pretty(lt)} = ${pretty(rt)} in ${R} is the linear congruence ${a}${v} ≡ ${b} (mod ${n}).`, ...nt.steps], [`Solved by the number-theory engine's linear-congruence solver (rewritten as \`${a}x = ${b} mod ${n}\`).`, ...nt.caveats]);
  }
  if (n > ROOT_SCAN_CAP) throw new DiscreteError(`Polynomial equations in ℤ/nℤ are solved by checking every residue, capped at n ≤ ${ROOT_SCAN_CAP.toLocaleString("en-US")} (got ${clip(String(n), 60)}).`);
  const N = Number(n);
  let fn = f.map(Number);
  const deg = fn.length - 1;
  const steps = [`Moved to one side: ${clip(fs)} ≡ 0 (mod ${n}).`];
  // The work is n × degree evaluations — budgeted BEFORE any work. For a prime
  // modulus beyond the budget, the roots in 𝔽p are the linear factors of
  // g = gcd(f, x^p − x) (x^p mod f by repeated squaring), so only g is scanned.
  if (N * deg > ROOT_SCAN_BUDGET) {
    if (!isPrimeN(N) || deg > 600) {
      throw new DiscreteError(`Checking every residue of a degree-${deg} polynomial mod ${N} is ${(N * deg).toLocaleString("en-US")} evaluations — above the budget of ${ROOT_SCAN_BUDGET.toLocaleString("en-US")}${isPrimeN(N) ? "" : " (for a prime modulus the gcd with x^p − x would be used; this modulus is composite)"}.`);
    }
    const fm = pmonic(fn, N);
    const xp = ppowmod([0, 1], BigInt(N), fm, N);
    const g = pgcd(psub(xp, [0, 1], N), fm, N);
    steps.push(`Roots in 𝔽${sub(N)} are the linear factors of gcd(f, x^${N} − x) = ${clip(showPoly(g, N, v))} (x^${N} mod f by repeated squaring).`);
    if (pdeg(g) < 1) {
      return res(`Equation in ${R}`, [`no solution in ${R} — gcd(f, x^${N} − x) = 1, so f has no root in 𝔽${sub(N)}`], steps, []);
    }
    if (N * pdeg(g) > ROOT_SCAN_BUDGET) throw new DiscreteError(`f has ${pdeg(g)} distinct roots in 𝔽${sub(N)}, but locating them needs ${(N * pdeg(g)).toLocaleString("en-US")} evaluations — above the budget of ${ROOT_SCAN_BUDGET.toLocaleString("en-US")}.`);
    fn = g;
  }
  const roots: number[] = [];
  const vals = new Set<number>();
  for (let x = 0; x < N; x++) {
    let r = 0;
    for (let i = fn.length - 1; i >= 0; i--) r = (r * x + fn[i]) % N;
    if (N <= 30) vals.add(r);
    if (r === 0) roots.push(x);
  }
  steps.push(`Every residue 0 … ${N - 1} checked${fn.length - 1 !== deg ? " against the gcd" : ""}.`);
  if (roots.length) {
    steps.push(`Check: ${roots.slice(0, 6).map((x) => `${v} = ${x}`).join(", ")} make ${fs} ≡ 0.`);
    return res(`Equation in ${R}`, [`${v} = ${roots.slice(0, 200).join(", ")}${roots.length > 200 ? ", …" : ""} (${roots.length} solution${roots.length === 1 ? "" : "s"} in ${R})`], steps, []);
  }
  let extra = "";
  if (isPrimeN(N) && N < MAX_P && f.length - 1 >= 2) {
    try {
      const fp = fn as P;
      const d = fp.length - 1;
      const v2 = decideIrreducible(fp, N);
      if (v2.irreducible) extra = ` — ${fs} is irreducible of degree ${d} over 𝔽${sub(N)}, so its roots live in 𝔽${sub(N ** d <= 1e15 ? N ** d : `${N}^${d}`)}`;
    } catch (err) {
      if (!(err instanceof DiscreteError)) throw err;
    }
  }
  const valText = N <= 30 ? `: ${fs} takes only the values ${[...vals].sort((a, b) => a - b).join(", ")} mod ${N}` : "";
  return res(`Equation in ${R}`, [`no solution in ${R}${valText}${extra}`], steps, []);
}

// ---------------------------------------------------------------------------
// Polynomials over 𝔽p (or over ℤ/n for ring products)

/** "over F_3", "mod 3", "in Z/5", "in F_2[x]", "over GF(3)" → modulus; null if absent. */
const POLY_TAIL = String.raw`\s+(?:over|in|mod(?:ulo)?)\s+(F_?\d+(?:\s*\[\s*[a-z]\s*\])?|GF\s*\(\s*\d+\s*\)(?:\s*\[\s*[a-z]\s*\])?|Z\s*\/\s*-?\d+\s*Z?(?:\s*\[\s*[a-z]\s*\])?|Z_\d+|F\s+\d+|-?\d+)\s*$`;

interface PolyField { m: bigint; prime: boolean; name: string }

function readPolyModulus(s0: string): PolyField {
  const s = s0.trim().replace(/\s*\[\s*[a-z]\s*\]$/, "");
  let m: RegExpExecArray | null;
  let q: bigint;
  if ((m = /^-?\d+$/.exec(s))) q = BigInt(s);
  else if ((m = /^(?:F_?|F\s+|GF\s*\(\s*)(\d+)\s*\)?$/.exec(s))) {
    q = BigInt(m[1]);
    if (q < 2n) throw new DiscreteError(`𝔽${sub(m[1])} is not a field — fields have at least 2 elements.`);
    if (q > BigInt(MAX_P)) throw new DiscreteError(`Polynomial arithmetic is capped at moduli p ≤ ${MAX_P.toLocaleString("en-US")} (got ${clip(m[1], 60)}).`);
    const qq = Number(q);
    if (!isPrimeN(qq)) {
      const pp = primePower(qq);
      if (pp && pp.k > 1) throw new DiscreteError(`Polynomials with coefficients in 𝔽${sub(qq)} (not a prime field) are not read here — coefficients must lie in 𝔽p for a prime p. Element arithmetic in GF(${qq}) itself is: e.g. \`(a + 1)(a + 2) in GF(${qq})\`.`);
      throw new DiscreteError(`${m[1]} is not a prime power — there is no field 𝔽${sub(m[1])}.`);
    }
  } else if ((m = /^Z\s*\/\s*(-?\d+)\s*Z?$/.exec(s)) || (m = /^Z_(\d+)$/.exec(s))) q = BigInt(m[1]);
  else throw new DiscreteError(`"${s0}" is not read as a coefficient ring.`);
  checkModulus(q);
  if (q > BigInt(MAX_P)) throw new DiscreteError(`Polynomial arithmetic is capped at moduli p ≤ ${MAX_P.toLocaleString("en-US")} (got ${clip(String(q), 60)}).`);
  const prime = isPrimeN(Number(q));
  return { m: q, prime, name: prime ? `𝔽${sub(Number(q))}` : `ℤ/${q}ℤ` };
}

function polyOf(text: string, F: PolyField, preferVar?: string): { c: P; v: string } | null {
  const ast = parseAlgExpr(text.trim());
  if (!ast) return null;
  const vs = freeVars(ast);
  if (vs.size > 1) throw new DiscreteError(`The polynomial mixes the variables ${[...vs].join(", ")} — one variable is read.`);
  const v = vs.size ? [...vs][0] : preferVar ?? "x";
  const c = evalPolyMod(ast, v, F.m).map(Number);
  return { c: ptrim(c), v };
}

function needField(F: PolyField, verb: string): void {
  if (!F.prime) {
    const n = Number(F.m);
    let d = 2;
    while (n % d) d++;
    const e = n / d;
    throw new DiscreteError(`${F.name} is not a field — ${verb} needs coefficients in a field, and unique factorisation fails over ${F.name}${n === 6 ? " (x² = x·x = (x + 3)(x + 3)…)" : ` (${d} · ${e} ≡ 0)`}. Use a prime modulus.`);
  }
}

function polyCheckCaps(c: P, F: PolyField, verb: string): void {
  const d = pdeg(c);
  if (verb === "factor" && d > 1 && trialCandidates(d, Number(F.m)) > TRIAL_CAP && d > RABIN_MAX_DEGREE && Number(F.m) * d > 30_000_000) {
    throw new DiscreteError(`Factoring a degree-${d} polynomial over ${F.name} is beyond the caps (trial division ${F.m}^${Math.floor(d / 2)} > ${TRIAL_CAP.toLocaleString("en-US")}; Rabin's test to degree ${RABIN_MAX_DEGREE}).`);
  }
}


/**
 * The factorisation as printed; when it would read "x^2 = x^2" (a power of the
 * single-term irreducible x), the product is written out: x · x.
 */
function factorShown(fz: ReturnType<typeof factorFp>, p: number, v: string, fs: string): string {
  const s = factorString(fz, p, v);
  if (s.replace(/\s+/g, "") !== fs.replace(/\s+/g, "")) return s;
  const f0 = fz.factors[0];
  if (fz.factors.length === 1 && f0.e > 1 && f0.e <= 8) {
    const base = showPoly(f0.f, p, v);
    return (fz.lead !== 1 ? `${fz.lead} · ` : "") + Array.from({ length: f0.e }, () => base).join(" · ");
  }
  return s;
}

/** Candidates tested when LISTING the irreducibles of one degree (each by Rabin's test). */
const LIST_CAP = 2048;

function tryPolynomial(t: string): DiscreteResult | null {
  let m: RegExpExecArray | null;
  const tail = new RegExp(POLY_TAIL, "i");
  // irreducible polynomials of degree d over F_p
  if ((m = /^(?:list\s+|find\s+)?(?:all\s+)?(?:the\s+)?(?:monic\s+)?irreducible\s+polynomials\s+of\s+degree\s+(\d+)\s+(?:over|in|mod(?:ulo)?)\s+(.+)$/i.exec(t))) {
    const F = readPolyModulus(m[2]);
    needField(F, "irreducibility");
    const d = Number(m[1]), p = Number(F.m);
    if (d < 1) throw new DiscreteError("Give a degree ≥ 1.");
    if (p ** d > LIST_CAP) throw new DiscreteError(`Listing the irreducible polynomials of degree ${d} over ${F.name} means testing ${p}^${d} candidates — above the cap of ${LIST_CAP.toLocaleString("en-US")}.`);
    const out: string[] = [];
    let count = 0;
    for (let idx = 0; idx < p ** d; idx++) {
      const c: P = [];
      let x = idx;
      for (let i = 0; i < d; i++) { c.push(x % p); x = Math.floor(x / p); }
      c.push(1);
      // Rabin's test per candidate (the count is cross-checked against Gauss's formula below).
      if (d === 1 || rabinIrreducible(c, p)) { count++; if (out.length < 200) out.push(showPoly(c, p)); }
    }
    // Gauss's count of monic irreducibles: (1/d) Σ_{k|d} μ(k) p^{d/k}.
    const mu = (k: number): number => { let r = 1, x = k; for (let q = 2; q * q <= x; q++) if (x % q === 0) { x /= q; if (x % q === 0) return 0; r = -r; } if (x > 1) r = -r; return r; };
    let gauss = 0;
    for (let k = 1; k <= d; k++) if (d % k === 0) gauss += mu(k) * p ** (d / k);
    gauss /= d;
    if (gauss !== count) throw new DiscreteError("Cross-check failed: the count of irreducibles disagrees with Gauss's formula — a defect in this tool.");
    return res(`Irreducible polynomials of degree ${d} over ${F.name}`, [`${out.join(", ")}${count > out.length ? ", …" : ""} (${count === 1 ? "one" : count})`], [`All ${p ** d} monic polynomials of degree ${d} tested by Rabin's test.`, `Count checked against Gauss's formula (1/d) Σ μ(k) p^(d/k) = ${gauss}.`], []);
  }
  // is f irreducible over F_p
  if ((m = new RegExp(String.raw`^is\s+(.+?)\s+irreducible` + POLY_TAIL, "i").exec(t))) {
    const F = readPolyModulus(m[2]);
    needField(F, "irreducibility");
    const P0 = polyOf(m[1], F);
    if (!P0) return null;
    const p = Number(F.m);
    const fs = showPoly(P0.c, p, P0.v);
    const verdict = decideIrreducible(P0.c, p);
    if (verdict.irreducible) return res(`Is ${fs} irreducible over ${F.name}?`, [`yes — ${fs} is irreducible over ${F.name}`], verdict.methods.map((x) => `Method: ${x}.`), []);
    let fac = "";
    try { const fz = factorFp(P0.c, p); fac = `: ${fs} = ${factorShown(fz, p, P0.v, fs)}`; } catch (err) { if (!(err instanceof DiscreteError)) throw err; fac = verdict.divisor ? `: divisible by ${showPoly(verdict.divisor, p, P0.v)}` : ""; }
    return res(`Is ${fs} irreducible over ${F.name}?`, [`no${fac}`], verdict.methods.map((x) => `Method: ${x}.`), []);
  }
  // factor f over F_p
  if ((m = new RegExp(String.raw`^(?:factor|factori[sz]e|factori[sz]ation\s+of|the\s+factori[sz]ation\s+of)\s+(.+?)` + POLY_TAIL, "i").exec(t))) {
    const F = readPolyModulus(m[2]);
    needField(F, "factoring");
    const P0 = polyOf(m[1], F);
    if (!P0) return null;
    const p = Number(F.m);
    polyCheckCaps(P0.c, F, "factor");
    const fs = showPoly(P0.c, p, P0.v);
    if (pdeg(P0.c) < 1) throw new DiscreteError(`${fs} is a constant — nothing to factor.`);
    const fz = factorFp(P0.c, p);
    const one = fz.factors.length === 1 && fz.factors[0].e === 1;
    const out = factorShown(fz, p, P0.v, fs);
    assertPolyRoundTrip(out, P0.c, F.m, P0.v);
    const display = one ? [`${fs} is irreducible over ${F.name}`] : [`${fs} = ${out} over ${F.name}`];
    return res(`Factor over ${F.name}`, display, [...fz.method.map((x) => `Method: ${x}.`), "Verified: the factors multiply back to the polynomial, and the linear factors match the roots found by evaluation."], []);
  }
  // gcd / extended Euclid
  if ((m = new RegExp(String.raw`^(?:the\s+)?(gcd|extended\s+euclid(?:ean(?:\s+algorithm)?)?(?:\s+for|\s+of)?|egcd|bezout|bézout)\s+(?:of\s+)?(.+?)` + POLY_TAIL, "i").exec(t))) {
    const F = readPolyModulus(m[3]);
    needField(F, "Euclid's algorithm");
    const parts = /^(.+?)\s+and\s+(.+)$/.exec(m[2]) ?? /^(.+?)\s*,\s*(.+)$/.exec(m[2]);
    if (!parts) return null;
    const a = polyOf(parts[1], F), b = polyOf(parts[2], F, a?.v);
    if (!a || !b) return null;
    if (a.v !== b.v && pdeg(a.c) > 0 && pdeg(b.c) > 0) throw new DiscreteError("The two polynomials use different variables.");
    const p = Number(F.m), v = a.v;
    if (!a.c.length && !b.c.length) throw new DiscreteError("gcd(0, 0) is not defined as a monic polynomial.");
    const E = pegcd(a.c, b.c, p);
    const as = showPoly(a.c, p, v), bs = showPoly(b.c, p, v), gs = showPoly(E.gcd, p, v), ss = showPoly(E.s, p, v), ts = showPoly(E.t, p, v);
    const steps = E.steps.map((st, i) => `step ${i + 1}: quotient ${showPoly(st.q, p, v)}, remainder ${showPoly(st.r, p, v)}`);
    steps.push(`Verified: (${ss})·(${as}) + (${ts})·(${bs}) = ${gs} over ${F.name}.`);
    const bez = `${gs} = ${ss === "1" ? "" : `(${ss})·`}(${as}) + ${ts === "1" ? "" : `(${ts})·`}(${bs})`;
    const isGcd = /^gcd$/i.test(m[1]);
    return res(isGcd ? `gcd over ${F.name}` : `Extended Euclid over ${F.name}`, isGcd ? [`gcd(${as}, ${bs}) = ${gs} over ${F.name}`, `Bézout: ${bez}`] : [`gcd = ${gs}; ${bez}`], steps, []);
  }
  // f divided by g
  if ((m = new RegExp(String.raw`^(?:divide\s+)?(.+?)\s+(?:divided\s+by|by|÷)\s+(.+?)` + POLY_TAIL, "i").exec(t)) && /divided|÷|^divide/i.test(t)) {
    const F = readPolyModulus(m[3]);
    const a = polyOf(m[1], F), b = polyOf(m[2], F, a?.v);
    if (!a || !b) return null;
    const p = Number(F.m), v = a.v;
    if (!b.c.length) throw new DiscreteError("Division by the zero polynomial.");
    if (!F.prime && gcdN(b.c[b.c.length - 1], p) !== 1) needField(F, "division by a polynomial whose leading coefficient is not a unit");
    const { q, r } = pdivmod(a.c, b.c, p);
    const check = ptrim(pmul(q, b.c, p).map((x, i) => (x + (r[i] ?? 0)) % p).concat(r.slice(pmul(q, b.c, p).length)));
    if (!peq(check, a.c)) throw new DiscreteError("Cross-check failed: quotient·divisor + remainder ≠ dividend — a defect in this tool.");
    return res(`Division over ${F.name}`, [`${showPoly(a.c, p, v)} = (${showPoly(b.c, p, v)})·(${showPoly(q, p, v)}) + ${showPoly(r, p, v)}`, `quotient ${showPoly(q, p, v)}, remainder ${showPoly(r, p, v)}`], ["Verified: quotient · divisor + remainder = dividend."], []);
  }
  // roots of f
  if ((m = new RegExp(String.raw`^(?:the\s+)?(?:roots|zeros|zeroes)\s+of\s+(.+?)` + POLY_TAIL, "i").exec(t))) {
    const F = readPolyModulus(m[2]);
    const a = polyOf(m[1], F);
    if (!a) return null;
    return solveInZn(m[1], "0", parseAlgExpr(m[1]), parseAlgExpr("0"), a.v, F.m, F.name);
  }
  // a bare polynomial expression with a modulus: product / reduction
  if ((m = tail.exec(t)) && !/=/.test(t)) {
    const exprText = t.slice(0, m.index).trim();
    const ast = parseAlgExpr(exprText);
    if (!ast) return null;
    const vs = freeVars(ast);
    if (vs.size !== 1) return null;
    const F = readPolyModulus(m[1]);
    const v = [...vs][0];
    const p = Number(F.m);
    const c = evalPolyMod(ast, v, F.m).map(Number);
    // The over-ℤ aside is formed only when it is small (degree ≤ 30, short input) and
    // shown only when it is short; the answer itself is reduced mod p at every step.
    const exact = c.length <= 31 && exprText.length <= 200 ? (() => { try { return evalPolyMod(ast, v, 0n); } catch (err) { if (err instanceof DiscreteError) return null; throw err; } })() : null;
    const fs = showPoly(c, p, v);
    const steps: string[] = [];
    let unreduced: string | null = null;
    if (exact) {
      const u = polyString(exact, v);
      if (u.length <= 160) {
        unreduced = showPoly(exact, 0n, v);
        steps.push(`Expanded over ℤ: ${unreduced}; coefficients reduced mod ${p}.`);
      } else steps.push(`The expansion over ℤ (${u.length} characters) is not shown; coefficients were reduced mod ${p} at every multiplication.`);
    } else steps.push(`Coefficients reduced mod ${p} at every multiplication (the expansion over ℤ is not formed).`);
    const display: string[] = [];
    const same = exprText.replace(/\s+/g, "").replace(/\*/g, "") === fs.replace(/\s+/g, "");
    if (!same) display.push(`${pretty(exprText)} = ${fs} over ${F.name}${unreduced && unreduced !== fs ? ` (over ℤ: ${unreduced})` : ""}`);
    else display.push(`${fs} is already reduced over ${F.name}`);
    if (!F.prime) {
      return res(`Polynomial over ${F.name}`, display, steps, [`${F.name} is a ring, not a field (${p} is composite): products are fine, but irreducibility and factoring are not defined the usual way here.`]);
    }
    const d = pdeg(c);
    if (d >= 1 && p <= 50) {
      const roots: number[] = [];
      for (let a = 0; a < p; a++) if (peval(c, a, p) === 0) roots.push(a);
      if (d <= 3) {
        const irr = roots.length === 0 && d >= 2;
        const vtxt = Array.from({ length: p }, (_, a) => evalText(c, a, p)).join(", ");
        display.push(roots.length ? `roots in ${F.name}: ${roots.join(", ")}${d >= 2 ? " — so it is reducible" : ""}` : `it has no roots (${vtxt})${irr ? `, so it is irreducible of degree ${d}` : ""}`);
        if (irr) steps.push(`A polynomial of degree 2 or 3 with no root in ${F.name} has no linear factor, hence no factor at all.`);
      } else {
        display.push(roots.length ? `roots in ${F.name}: ${roots.join(", ")}` : `no roots in ${F.name}`);
      }
    }
    if (d >= 4 || (d >= 2 && p > 50)) {
      try {
        const vr = decideIrreducible(c, p);
        display.push(vr.irreducible ? `irreducible over ${F.name}` : `reducible over ${F.name}`);
        steps.push(...vr.methods.map((x) => `Method: ${x}.`));
      } catch (err) {
        if (!(err instanceof DiscreteError)) throw err;
      }
    }
    return res(`Polynomial over ${F.name}`, display, steps, []);
  }
  return null;
}

/** "2² + 1 = 2" style evaluation text for small p. */
function evalText(c: P, a: number, p: number): string {
  const terms: string[] = [];
  for (let i = c.length - 1; i >= 0; i--) {
    if (!c[i]) continue;
    const pw = i === 0 ? "" : i === 1 ? String(a) : `${a}${"⁰¹²³⁴⁵⁶⁷⁸⁹"[i] ?? "^" + i}`;
    terms.push(i === 0 ? String(c[i]) : (c[i] === 1 ? "" : `${c[i]}·`) + pw);
  }
  return `${terms.join(" + ")} = ${peval(c, a, p)}`;
}

// ---------------------------------------------------------------------------
// Finite fields GF(p^k)

interface FieldSpec { p: number; k: number; q: number; mod?: P; text: string }

/** GF(9) · GF(3^2) · F_9 · F_9 = F_3[x]/(x^2 + 1) · F_3[x]/(x^2+1) · GF(8) with a^3 = a + 1 · GF(2^3) modulo x^3 + x + 1. */
function readFieldSpec(s0: string): FieldSpec | null {
  let s = s0.trim();
  let m: RegExpExecArray | null;
  let q: number | null = null, pk: { p: number; k: number } | null = null;
  let modText: string | null = null;
  let modVar = "x";
  let modIsEquation = false;
  // trailing modulus forms
  if ((m = /^(.+?)\s*=\s*F_?(\d+)\s*\[\s*([a-z])\s*\]\s*\/\s*\(\s*(.+)\s*\)$/i.exec(s))) { s = m[1]; modText = m[4]; modVar = m[3]; pk = { p: Number(m[2]), k: 0 }; }
  else if ((m = /^F_?(\d+)\s*\[\s*([a-z])\s*\]\s*\/\s*\(\s*(.+)\s*\)$/i.exec(s))) { modText = m[3]; modVar = m[2]; pk = { p: Number(m[1]), k: 0 }; s = ""; }
  else if ((m = /^(.+?)\s+(?:with|where)\s+([a-z])\s*\^\s*(\d+)\s*=\s*(.+)$/i.exec(s))) { s = m[1]; modText = `${m[2]}^${m[3]} - (${m[4]})`; modVar = m[2]; modIsEquation = true; }
  else if ((m = /^(.+?)\s+(?:modulo|mod|with\s+modulus|defined\s+by)\s+(.+)$/i.exec(s)) && /[a-z]/i.test(m[2]) && /^(?:GF|F)/.test(m[1].trim())) { s = m[1]; modText = m[2]; }
  s = s.trim();
  if (s) {
    if ((m = /^GF\s*\(\s*(\d+)\s*\^\s*(\d+)\s*\)$/.exec(s)) || (m = /^F_?\{?\s*(\d+)\s*\^\s*(\d+)\s*\}?$/.exec(s))) {
      const p = Number(m[1]), k = Number(m[2]);
      if (!isPrimeN(p)) throw new DiscreteError(`${p} is not prime, so GF(${p}^${k}) is not written that way — the base of p^k must be prime.`);
      if (k < 1) throw new DiscreteError("GF(p^k) needs k ≥ 1.");
      if (k > 20 || p ** k > MAX_FIELD) throw new DiscreteError(`GF(${p}^${k}) has ${k > 20 ? "more than 10⁶" : (p ** k).toLocaleString("en-US")} elements — above the cap q ≤ ${MAX_FIELD}.`);
      q = p ** k;
      if (pk && pk.p !== p) throw new DiscreteError(`GF(${q}) has characteristic ${p}, but the modulus is over 𝔽${sub(pk.p)}.`);
      pk = { p, k };
    } else if ((m = /^GF\s*\(\s*(\d+)\s*\)$/.exec(s)) || (m = /^F_?(\d+)$/.exec(s)) || (m = /^(?:the\s+)?(?:finite\s+)?field\s+(?:with|of)\s+(\d+)\s+elements$/i.exec(s))) {
      if (m[1].length > 12) throw new DiscreteError(`GF(${m[1]}) is above the cap q ≤ ${MAX_FIELD}.`);
      q = Number(m[1]);
      const pp = primePower(q);
      if (!pp) throw new DiscreteError(q < 2 ? `There is no field with ${q} element${q === 1 ? "" : "s"} — a field has at least 2 (0 ≠ 1).` : `${q} is not a prime power — there is no field with ${q} elements.`);
      if (q > MAX_FIELD) throw new DiscreteError(`GF(${q}) is above the cap q ≤ ${MAX_FIELD} (element lists and orders; ${q} > ${MAX_FIELD}).`);
      if (pk && pk.p !== pp.p) throw new DiscreteError(`GF(${q}) has characteristic ${pp.p}, but the modulus is over 𝔽${sub(pk.p)}.`);
      pk = pp;
    } else return null;
  }
  if (!pk) return null;
  const p = pk.p;
  if (!isPrimeN(p)) throw new DiscreteError(`𝔽${sub(p)}[x] needs a prime ${p > 1 ? `(${p} is not prime)` : ""}.`);
  let mod: P | undefined;
  if (modText !== null) {
    const ast = parseAlgExpr(modText);
    if (!ast) throw new DiscreteError(`The modulus "${modText}" is not read as a polynomial.`);
    const vs = freeVars(ast);
    const v = vs.size ? [...vs][0] : modVar;
    if (vs.size > 1) throw new DiscreteError("The modulus mixes two variables.");
    mod = ptrim(evalPolyMod(ast, v, BigInt(p)).map(Number));
    if (modIsEquation && !mod.length) throw new DiscreteError("That relation reduces to 0 = 0.");
    const k = pdeg(mod);
    if (k < 1) throw new DiscreteError("The modulus must have degree ≥ 1.");
    if (pk.k === 0) {
      if (p ** k > MAX_FIELD) throw new DiscreteError(`𝔽${sub(p)}[x]/(degree ${k}) has ${p}^${k} elements — above the cap q ≤ ${MAX_FIELD}.`);
      pk = { p, k };
      q = p ** k;
    }
  }
  return { p, k: pk.k, q: q ?? p ** pk.k, mod, text: s0 };
}

const fieldName = (F: GField): string => (F.k === 1 ? `𝔽${sub(F.p)}` : `𝔽${sub(F.q)} = 𝔽${sub(F.p)}[x]/(${showPoly(F.mod, F.p, "x", true)})`);

function readFieldElement(F: GField, s: string): number {
  const ast = parseAlgExpr(s.trim());
  if (!ast) throw new DiscreteError(`"${s}" is not read as an element of GF(${F.q}) — write it in a (e.g. a + 1, 2a, a^3).`);
  // Evaluated IN the field: inverses, division and negative powers are allowed;
  // in a prime field GF(p) a letter is refused by name (there is no element a).
  return evalField(F, ast);
}

function fieldDescription(F: GField, spec: FieldSpec, what: "describe" | "elements"): DiscreteResult {
  const name = fieldName(F);
  const els = Array.from({ length: F.q }, (_, i) => i);
  const nm = (x: number): string => elemName(F, x);
  const display: string[] = [];
  const steps: string[] = [];
  const caveats: string[] = [];
  if (F.k > 1) {
    const ak = elemPoly(F, polyElem(F, ptrim(pmod(Array.from({ length: F.k + 1 }, (_, i) => (i === F.k ? 1 : 0)), F.mod, F.p))));
    display.push(`${name}, a = the class of x, a${"⁰¹²³⁴⁵⁶⁷⁸⁹"[F.k] ?? "^" + F.k} = ${showPoly(ak, F.p, "a", true)}`);
  } else display.push(`${name} = ℤ/${F.p}ℤ`);
  const orders = els.slice(1).map((x) => gfOrder(F, x));
  if (F.q <= 1024) {
    display.push(`${F.q} elements: ${F.q <= 64 ? els.map(nm).join(", ") : els.slice(0, 32).map(nm).join(", ") + ", …"}`);
    const shown = F.q <= 64 ? F.q - 1 : 40;
    const ordLine = els.slice(1, 1 + shown).map((x, i) => `${nm(x)}: ${orders[i]}`);
    steps.push(`Multiplicative orders: ${ordLine.join(" · ")}${F.q <= 64 ? "" : " · …"}`);
  }
  const prim = els.slice(1).filter((x, i) => orders[i] === F.q - 1);
  const aIdx = F.k > 1 ? F.p : -1;
  const aNote = aIdx > 0 ? (gfOrder(F, aIdx) === F.q - 1 ? " — a itself is primitive" : ` — a itself is NOT primitive (order ${gfOrder(F, aIdx)})`) : "";
  if (prim.length === F.q - 2 && F.q > 3) display.push(`every nonzero element except 1 has order ${F.q - 1} (primitive) — ${F.q - 1} is prime`);
  else display.push(`primitive elements (order ${F.q - 1}): ${prim.length <= 40 ? prim.map(nm).join(", ") : prim.slice(0, 40).map(nm).join(", ") + ", …"}${aNote}`);
  steps.push(`The multiplicative group 𝔽${sub(F.q)}* is cyclic of order ${F.q - 1}; φ(${F.q - 1}) = ${prim.length} primitive elements.`);
  if (F.k > 1) steps.push(`The modulus ${showPoly(F.mod, F.p, "x", true)} is irreducible over 𝔽${sub(F.p)} (re-checked).`);
  steps.push(F.fullCheck ? `Field axioms checked by brute force on every pair and triple (q = ${F.q} ≤ ${FULL_FIELD_CHECK}): every nonzero element has an inverse, × is associative, distributivity holds; log-table products agree with polynomial products.` : `Field axioms checked on a fixed sample of 10⁴ triples (q = ${F.q} > ${FULL_FIELD_CHECK}; full checks run to q ≤ ${FULL_FIELD_CHECK}) and every inverse checked.`);
  if (F.chosen && F.k > 1) caveats.push(`Constructed as 𝔽${sub(F.p)}[x]/(${showPoly(F.mod, F.p, "x", true)}) — the first irreducible monic of degree ${F.k}; say \`F_${F.q} = F_${F.p}[x]/(…)\` to choose another; the field is unique up to isomorphism, the element names are not.`);
  let svg: string | undefined;
  if (F.q <= 16) svg = fieldTableSvg(F, "mul");
  else caveats.push(`The multiplication table is drawn for q ≤ 16 (here q = ${F.q}).`);
  void what;
  return res(`Finite field GF(${F.q})`, display, steps, caveats, svg, `Multiplication table of GF(${F.q})`);
}

function fieldTable(F: GField, kind: "mul" | "add"): number[][] {
  return Array.from({ length: F.q }, (_, a) => Array.from({ length: F.q }, (_, b) => (kind === "mul" ? gfMul(F, a, b) : gfAdd(F, a, b))));
}

/**
 * The field's table figure. Polynomial labels first; when they would make the
 * text illegible (GF(16): "a^3 + a^2 + a + 1"), the cells show coefficient
 * strings c_{k−1}…c₀ instead and the caption says how to read them. Returns
 * undefined (the caller says why) only if even that is too wide.
 */
function fieldTableSvg(F: GField, kind: "mul" | "add"): string | undefined {
  const tab = fieldTable(F, kind);
  const base = { identity: kind === "mul" ? 1 : 0, grey: kind === "mul" ? 0 : undefined, op: kind === "mul" ? "×" : "+" };
  const title = `${kind === "mul" ? "Multiplication" : "Addition"} table of GF(${F.q})${kind === "mul" ? " (0 row and column in grey)" : ""}`;
  try {
    return cayleyTableSvg(Array.from({ length: F.q }, (_, i) => elemName(F, i)), tab, { ...base, caption: title });
  } catch (err) {
    if (!(err instanceof TableTooWideError)) throw err;
  }
  const code = (i: number): string => elemPoly(F, i).concat(new Array(F.k).fill(0)).slice(0, F.k).reverse().join("");
  const ex = F.q - 1;
  try {
    return cayleyTableSvg(Array.from({ length: F.q }, (_, i) => code(i)), tab, { ...base, caption: `${title}; cells show coefficient strings, highest power first: ${code(ex)} = ${elemName(F, ex)}` });
  } catch (err) {
    if (!(err instanceof TableTooWideError)) throw err;
    return undefined;
  }
}

function tryField(t: string): DiscreteResult | null {
  let m: RegExpExecArray | null;
  if (!/GF\s*\(|(?<![A-Za-z0-9_])F_?\d+|F_?\{|field\s+(?:with|of)\s+\d+\s+elements/i.test(t)) return null;
  const build = (spec: FieldSpec): GField => buildField(spec.p, spec.k, spec.mod);
  // is GF(9) a field
  if ((m = /^is\s+(.+?)\s+an?\s+(field|integral\s+domain)$/i.exec(t))) {
    const spec = readFieldSpec(m[1]);
    if (!spec) return null;
    const F = build(spec);
    const why = F.k === 1 ? `${F.p} is prime` : `the modulus ${showPoly(F.mod, F.p, "x", true)} is irreducible over 𝔽${sub(F.p)}, so 𝔽${sub(F.p)}[x]/(${showPoly(F.mod, F.p, "x", true)}) is a field`;
    return res(`Is GF(${F.q}) a field?`, [`yes — GF(${F.q}) is a field: ${why}`], [fieldName(F), F.fullCheck ? "Field axioms checked by brute force on every pair and triple." : "Field axioms checked on a fixed sample of 10⁴ triples and every inverse checked."], []);
  }
  // table verbs
  if ((m = /^(?:the\s+)?(multiplication|addition|\+|×|\*)\s+table\s+(?:of|for)\s+(.+)$/i.exec(t)) || (m = /^(.+?)\s+(multiplication|addition)\s+table$/i.exec(t))) {
    const kindWord = /multiplication|×|\*/i.test(m[1]) || /multiplication/i.test(m[2]) ? "mul" : "add";
    const specText = /table$/i.test(t) ? m[1] : m[2];
    const spec = readFieldSpec(specText);
    if (!spec) return null;
    if (spec.k === 1 && !/^(?:GF|F)/.test(specText.trim())) return null;
    if (spec.q > 64) throw new DiscreteError(`The ${kindWord === "mul" ? "multiplication" : "addition"} table of GF(${spec.q}) is printed for q ≤ 64 and drawn for q ≤ 16.`);
    const F = build(spec);
    const labels = Array.from({ length: F.q }, (_, i) => elemName(F, i));
    const tab = fieldTable(F, kindWord);
    const display = textTableRows(labels, tab, kindWord === "mul" ? "×" : "+");
    const caveats: string[] = [];
    if (F.chosen && F.k > 1) caveats.push(`Constructed as 𝔽${sub(F.p)}[x]/(${showPoly(F.mod, F.p, "x", true)}) — the first irreducible monic of degree ${F.k}.`);
    const svg = F.q <= 16 ? fieldTableSvg(F, kindWord) : undefined;
    if (!svg) caveats.push("Drawn for q ≤ 16.");
    return res(`${kindWord === "mul" ? "Multiplication" : "Addition"} table of GF(${F.q})`, [fieldName(F), ...display], [], caveats, svg, `${kindWord === "mul" ? "Multiplication" : "Addition"} table of GF(${F.q})`);
  }
  // primitive element(s)
  if ((m = /^(?:a\s+|the\s+)?primitive\s+(element|elements|root|roots)\s+(?:of|in|for)\s+(.+)$/i.exec(t))) {
    const spec = readFieldSpec(m[2]);
    if (!spec) return null;
    const F = build(spec);
    const els = Array.from({ length: F.q - 1 }, (_, i) => i + 1);
    const prim = els.filter((x) => gfOrder(F, x) === F.q - 1);
    const first = prim[0];
    // Verify by the cycle: the powers of the first primitive element visit every nonzero element.
    const seen = new Set<number>();
    let x = 1;
    for (let i = 0; i < F.q - 1; i++) { seen.add(x); x = gfMul(F, x, first); }
    if (seen.size !== F.q - 1) throw new DiscreteError("Cross-check failed: the primitive element's powers miss an element — a defect in this tool.");
    const aNote = F.k > 1 && gfOrder(F, F.p) !== F.q - 1 ? `; a is not (order ${gfOrder(F, F.p)})` : "";
    const display = [`${elemName(F, first)} (order ${F.q - 1})${aNote}`];
    if (/s$/i.test(m[1])) display.push(`all primitive elements: ${prim.slice(0, 60).map((y) => elemName(F, y)).join(", ")}${prim.length > 60 ? ", …" : ""} (φ(${F.q - 1}) = ${prim.length})`);
    return res(`Primitive element of GF(${F.q})`, display, [fieldName(F), `Its powers run through all ${F.q - 1} nonzero elements (checked by the cycle).`], F.chosen && F.k > 1 ? [`Constructed as 𝔽${sub(F.p)}[x]/(${showPoly(F.mod, F.p, "x", true)}) — the first irreducible monic of degree ${F.k}.`] : []);
  }
  // minimal polynomial / order / inverse of an element
  if ((m = /^(?:the\s+)?(minimal\s+polynomial|order|multiplicative\s+order|inverse|conjugates)\s+of\s+(.+?)\s+(?:in|over)\s+(.+)$/i.exec(t))) {
    const spec = readFieldSpec(m[3]);
    if (!spec) return null;
    const F = build(spec);
    const b = readFieldElement(F, m[2]);
    const bn = elemName(F, b);
    const head = fieldName(F);
    if (/minimal/i.test(m[1]) || /conjugates/i.test(m[1])) {
      const { poly, conjugates } = minimalPolynomial(F, b);
      const ps = showPoly(poly, F.p, "x");
      const conjText = conjugates.map((c, i) => {
        const pw = F.p ** i;
        return `${i === 0 ? pretty(m![2]) : `(${pretty(m![2])})^${pw}`} = ${elemName(F, c)}`;
      }).join(", ");
      return res(`Minimal polynomial over 𝔽${sub(F.p)}`, [`minimal polynomial of ${pretty(m[2])} = ${ps}`, `conjugates: ${conjText}`], [head, `${ps} = ∏ (x − c) over the ${conjugates.length} Frobenius conjugates c, expanded in the field; every coefficient lies in 𝔽${sub(F.p)}.`, `Verified: it vanishes at ${bn}, and it divides x^${F.q} − x over 𝔽${sub(F.p)}.`], []);
    }
    if (/inverse/i.test(m[1])) {
      const iv = gfInv(F, b);
      if (gfMul(F, b, iv) !== 1) throw new DiscreteError("Cross-check failed: β·β⁻¹ ≠ 1 — a defect in this tool.");
      return res(`Inverse in GF(${F.q})`, [`(${bn})⁻¹ = ${elemName(F, iv)}`], [head, `Verified: (${bn})(${elemName(F, iv)}) = 1.`], []);
    }
    const o = gfOrder(F, b);
    const pw: string[] = [];
    let x = b;
    for (let i = 1; i <= Math.min(o, 16); i++) { pw.push(elemName(F, x)); x = gfMul(F, x, b); }
    return res(`Order in GF(${F.q})`, [`order of ${bn} in GF(${F.q})* = ${o}`], [head, `Powers: ${pw.join(", ")}${o > 16 ? ", …" : ""}; ${o} divides ${F.q - 1}.`], []);
  }
  // elements of / the field alone
  if ((m = /^(?:the\s+)?(?:elements\s+of\s+|describe\s+)?(.+)$/i.exec(t))) {
    const body = m[1];
    const spec = (() => { try { return readFieldSpec(body); } catch (err) { if (err instanceof DiscreteError && /^(?:GF|F_?\d|field)/i.test(body.trim())) throw err; if (err instanceof DiscreteError) return null; throw err; } })();
    if (spec) {
      if (spec.k === 1 && !/^(?:elements\s+of\s+)?(?:GF|F)/i.test(t)) return null;
      return fieldDescription(build(spec), spec, /^elements/i.test(t) ? "elements" : "describe");
    }
  }
  // element arithmetic: (a + 1)(2a + 2) in GF(9)
  if ((m = /^(.+?)\s+(?:in|over)\s+(GF\s*\(.+\)|F_?\d+.*)$/i.exec(t))) {
    // A PRIME field named after "over/in" is 𝔽p[x] territory (any p ≤ 10⁶): the
    // GF(q) table cap must never refuse a polynomial verb.
    const pm = /^(?:F_?|GF\s*\(\s*)(\d+)\s*\)?$/.exec(m[2].trim());
    if (pm && isPrime(BigInt(pm[1])).prime) return null;
    const spec = readFieldSpec(m[2]);
    if (!spec || spec.k < 2) return null;
    const ast = parseAlgExpr(m[1]);
    if (!ast) return null;
    const vs = freeVars(ast);
    if (vs.size !== 1 || !vs.has("a")) return null;
    const F = build(spec);
    const x = evalField(F, ast);
    const steps = [fieldName(F)];
    let polyOnly = true;
    const walk = (y: typeof ast): void => { if (y.t === "div" || (y.t === "pow" && y.e < 0n)) polyOnly = false; if ("a" in y && typeof y.a === "object") walk(y.a); if ("b" in y) walk(y.b); };
    walk(ast);
    if (polyOnly) {
      const raw = evalPolyMod(ast, "a", BigInt(F.p)).map(Number);
      const red = ptrim(pmod(raw, F.mod, F.p));
      if (polyElem(F, red) !== x) throw new DiscreteError("Cross-check failed: polynomial reduction and field arithmetic disagree — a defect in this tool.");
      steps.push(`Expanded over 𝔽${sub(F.p)}: ${showPoly(raw, F.p, "a")}; reduced modulo ${showPoly(F.mod, F.p, "a")}: ${elemName(F, x)}.`);
    } else steps.push("Inverses and divisions computed in the field (a / b = a · b⁻¹; b⁻¹ = b^(q−2)).");
    return res(`Arithmetic in GF(${F.q})`, [`${pretty(m[1])} = ${elemName(F, x)} in GF(${F.q})`], steps, []);
  }
  return null;
}

function textTableRows(labels: string[], t: number[][], opSym: string): string[] {
  return [`${opSym} | ${labels.join(" | ")}`, ...t.map((row, i) => `${labels[i]}: ${row.map((x) => labels[x]).join(" | ")}`)];
}

// ---------------------------------------------------------------------------
// Homomorphisms

function tryHomomorphism(t: string): DiscreteResult | null {
  let m: RegExpExecArray | null;
  const MAP = String.raw`(?:f\s*\(\s*x\s*\)\s*=\s*|x\s*->\s*|f\s*:\s*x\s*->\s*|the\s+map\s+x\s*->\s*)`;
  if ((m = new RegExp(String.raw`^is\s+${MAP}(.+?)\s+an?\s+(?:group\s+)?homomorphism\s+from\s+(.+?)\s+to\s+(.+)$`, "i").exec(t))) {
    const G = readGroup(m[2]), K = readGroup(m[3]);
    if (!G || !K) return null;
    return homomorphismVerb("is", m[1], G, K);
  }
  if ((m = new RegExp(String.raw`^(?:the\s+)?(kernel|image)\s+of\s+${MAP}(.+?)\s+from\s+(.+?)\s+to\s+(.+)$`, "i").exec(t))) {
    const G = readGroup(m[3]), K = readGroup(m[4]);
    if (!G || !K) return null;
    return homomorphismVerb(/kernel/i.test(m[1]) ? "kernel" : "image", m[2], G, K);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Group verbs

function hintFrom(t: string): { text: string; ctx: { dihedralOrderHint?: number; squareHint?: boolean } } {
  let m: RegExpExecArray | null;
  if ((m = /(D_?(\d+))\s*,?\s*\(?\s*(?:of|with)\s+order\s+(\d+)\s*\)?/.exec(t))) {
    return { text: t.replace(m[0], m[1]), ctx: { dihedralOrderHint: Number(m[2]) === Number(m[3]) ? Number(m[3]) : undefined } };
  }
  if ((m = /(D_?(\d+))\s*,?\s*\(?\s*(?:the\s+)?(?:symmetries\s+)?of\s+the\s+square\s*\)?/.exec(t))) {
    return { text: t.replace(m[0], m[1]), ctx: { squareHint: true } };
  }
  return { text: t, ctx: {} };
}

function grp(s: string, ctx: { dihedralOrderHint?: number; squareHint?: boolean }): GroupSpec | null {
  return readGroup(s, ctx);
}

function trySubgroupLike(s: string): boolean {
  return /^\s*(?:<.*>|\{.*\}|A_?\d+|Z(?:\s*\(.*\))?|(?:the\s+)?(?:center|centre|rotations|trivial(?:\s+subgroup)?))\s*$/.test(s) || /^\s*(?:the\s+)?(?:center|centre|rotations|trivial(?:\s+subgroup)?)\s*$/i.test(s);
}

function tryGroupVerb(t0: string): DiscreteResult | null {
  let m: RegExpExecArray | null;
  // "subgroups of D4 of order 4" / "elements of D4 of order 2": the trailing
  // "of order k" is the FILTER, decided before the Dₙ convention hint can
  // read it as "D4, the group of order 4" (W2/W3).
  {
    const lg = /^lagrange(?:'s)?(?:\s+theorem)?\s*(?::|for|on|in)\s*/i.exec(t0);
    const body = lg ? t0.slice(lg[0].length).trim() : t0;
    if ((m = /^(?:the\s+|all\s+(?:the\s+)?)?(subgroups|elements)\s+of\s+(.+?)\s+of\s+order\s+(\d{1,6})$/i.exec(body))) {
      const g = readGroup(m[2]);
      if (g) return /^sub/i.test(m[1]) ? subgroupsVerb(g, { order: Number(m[3]), lagrange: !!lg }) : elementsOfOrderVerb(g, Number(m[3]));
    }
  }
  const { text, ctx } = hintFrom(t0);
  let t = text.trim();
  let lagrange = false;
  if ((m = /^lagrange(?:'s)?(?:\s+theorem)?\s*(?::|for|on|in)\s*/i.exec(t))) { lagrange = true; t = t.slice(m[0].length).trim(); if (readGroup(t, ctx)) t = `subgroups of ${t}`; }
  if ((m = /^(?:find\s+|list\s+)?(?:all\s+)?(?:the\s+)?groups\s+of\s+order\s+(\d+)(?:\s+up\s+to\s+isomorphism)?$/i.exec(t))) return findAllGroupsVerb(Number(m[1].length > 6 ? "999999" : m[1]));
  if ((m = /^(?:the\s+)?(?:cayley|multiplication|addition|operation|group)\s+table\s+(?:of|for)\s+(.+)$/i.exec(t)) || (m = /^(.+?)\s+(?:cayley|multiplication|addition|operation)\s+table$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? cayleyTableVerb(g) : null;
  }
  if ((m = /^(?:the\s+)?orders?\s+of\s+(?:all\s+)?(?:the\s+)?(?:elements|each\s+element|every\s+element)\s+(?:of|in)\s+(.+)$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? allOrdersVerb(g) : null;
  }
  if ((m = /^(?:the\s+|all\s+)?elements\s+of\s+order\s+(\d+)\s+(?:in|of)\s+(.+)$/i.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? elementsOfOrderVerb(g, Number(m[1])) : null;
  }
  if ((m = /^(?:the\s+)?(?:subgroup\s+generated\s+by|span\s+of)\s+(.+?)\s+in\s+(.+)$/i.exec(t)) || (m = /^<\s*(.*?)\s*>\s+in\s+(.+)$/.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? generatedVerb(g, splitTopLevel(m[1])) : null;
  }
  if ((m = /^(?:the\s+)?order\s+of\s+(.+?)\s+in\s+(.+)$/i.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? orderOfElementVerb(g, m[1]) : null;
  }
  if ((m = /^(?:the\s+)?order\s+of\s+(.+)$/i.exec(t)) || (m = /^\|\s*(.+?)\s*\|$/.exec(t))) {
    const g = grp(m[1], ctx);
    if (!g) return null;
    return res(`Order of ${g.name}`, [`|${g.name}| = ${g.order}`], [], g.caveats);
  }
  if ((m = /^(?:the\s+)?(?:(all|the)\s+)?subgroups\s+of\s+order\s+(\d+)\s+(?:in|of)\s+(.+)$/i.exec(t))) {
    const g = grp(m[3], ctx);
    return g ? subgroupsVerb(g, { order: Number(m[2]), lagrange }) : null;
  }
  if ((m = /^(?:the\s+)?(?:(?:all|list)\s+(?:the\s+)?)?(subgroups|subgroup\s+lattice|lattice\s+of\s+subgroups|hasse\s+diagram\s+of\s+subgroups)\s+(?:of|for|in)\s+(.+)$/i.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? subgroupsVerb(g, { lattice: /lattice|hasse/i.test(m[1]), lagrange }) : null;
  }
  if ((m = /^is\s+(.+?)\s+(cyclic|abelian|commutative)$/i.exec(t))) {
    const g = grp(m[1], ctx);
    if (!g) return null;
    return /cyclic/i.test(m[2]) ? cyclicVerb(g) : abelianVerb(g);
  }
  if ((m = /^is\s+(.+?)\s+a\s+generator\s+(?:of|for)\s+(.+)$/i.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? isGeneratorVerb(g, m[1]) : null;
  }
  if ((m = /^(?:the\s+|all\s+)?generators?\s+(?:of|for)\s+(.+)$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? generatorsVerb(g) : null;
  }
  if ((m = /^(?:the\s+|all\s+)?(left\s+|right\s+)?cosets\s+of\s+(.+?)\s+in\s+(.+)$/i.exec(t))) {
    const g = grp(m[3], ctx);
    if (!g) return null;
    return cosetsVerb(g, m[2], m[1] ? (/left/i.test(m[1]) ? "left" : "right") : null);
  }
  if ((m = /^is\s+(.+?)\s+(?:a\s+)?normal(?:\s+subgroup)?\s+(?:in|of)\s+(.+)$/i.exec(t))) {
    const g = grp(m[2], ctx);
    return g ? normalVerb(g, m[1]) : null;
  }
  {
    const q = /^(?:the\s+)?quotient(?:\s+group)?\s+(?:of\s+)?(.+)$/i.exec(t);
    const body = q ? q[1] : t;
    const split = splitQuotient(body, ctx);
    if (split) return quotientVerb(split.g, split.h);
    if (q) return null;
  }
  if ((m = /^(?:the\s+)?(?:center|centre)\s+of\s+(.+)$/i.exec(t)) || (m = /^Z\s*\(\s*(.+)\s*\)$/.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? centerVerb(g) : null;
  }
  if ((m = /^(?:the\s+)?(?:conjugacy\s+classes|class\s+equation|classes)\s+(?:of|for|in)\s+(.+)$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? classesVerb(g) : null;
  }
  if ((m = /^(?:the\s+)?(?:isomorphism\s+type|structure)\s+of\s+(.+)$/i.exec(t)) || (m = /^what\s+is\s+(.+?)\s+isomorphic\s+to$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? isoTypeVerb(g) : null;
  }
  if ((m = /^(?:(chinese\s+remainder(?:\s+theorem)?|crt)\s*:?\s*)?(?:is\s+)?(.+?)\s*(?:≅|~=|\bisomorphic\s+to\b|\biso(?:morphic)?\s+with\b)\s*(.+)$/i.exec(t))) {
    const a = grp(m[2], ctx), b = grp(m[3], ctx);
    if (!a || !b) return null;
    return isomorphismVerb(a, b, !!m[1]);
  }
  if ((m = /^(?:aut|the\s+automorphism\s+group\s+of|automorphism\s+group\s+of|automorphisms\s+of)\s*\(?\s*(.+?)\s*\)?$/i.exec(t))) {
    const g = grp(m[1], ctx);
    return g ? autVerb(g) : null;
  }
  // A name alone: the description.
  if ((m = /^(?:describe\s+)?(?:the\s+)?(?:group\s+)?(.+)$/i.exec(t))) {
    const g = grp(m[1], ctx);
    if (g) return describeGroup(g);
  }
  return null;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitQuotient(body: string, ctx: { dihedralOrderHint?: number; squareHint?: boolean }): { g: GroupSpec; h: string } | null {
  for (let i = 0; i < body.length; i++) {
    let L = -1, R = -1;
    if (body[i] === "/") { L = i; R = i + 1; }
    else if (/^\s+mod\s+/i.test(body.slice(i)) ) { const mm = /^\s+mod\s+/i.exec(body.slice(i))!; L = i; R = i + mm[0].length; }
    if (L < 0) continue;
    const left = body.slice(0, L).trim(), right = body.slice(R).trim();
    if (!left || !right || !trySubgroupLike(right)) continue;
    let g: GroupSpec | null = null;
    try { g = readGroup(left, ctx); } catch (err) { if (err instanceof DiscreteError) throw err; throw err; }
    if (g) return { g, h: right };
  }
  return null;
}

// Exposed for the tests and the switch.
export { readGroup, buildSpec, readSubgroup };
export const ALGEBRA_CAPS = { MAX_ORDER, MAX_TABLE, MAX_FIELD, TRIAL_CAP, RABIN_MAX_DEGREE };
