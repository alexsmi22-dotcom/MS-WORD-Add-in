// Combinatorics — the counting engine behind the Discrete math kind.
//
// Owns one-line counting requests: binomials, permutations, factorials,
// multinomials, multiset permutations ("arrangements of MISSISSIPPI"),
// derangements, Catalan / Bell / Stirling numbers, integer partitions, power
// sets, and a deliberately SHORT list of textbook word problems ("how many
// ways to choose 3 of 10"). Anything else answers null so the front door can
// say what it accepts — a guessed count is worse than no count, so the prose
// patterns are conservative and every one of them names the model it used.
//
// House rules, as applied here:
//   * Every number is an exact BigInt. Nothing is ever rounded to a float; a
//     result longer than MAX_DISPLAY_DIGITS is shown cut, with its digit count.
//   * Every cap is named in the refusal that enforces it (see CAPS).
//   * Every result that has a second route is computed twice and the line
//     "verified: …" says which two routes agreed. A disagreement is surfaced
//     as "cross-check FAILED" in caveats — never silently resolved.
//   * This runs on every keystroke, so every path must return well under
//     200 ms: the caps are sized for that, and the O(n²) cross-checks are
//     themselves capped (by name) where the primary computation is O(n).

import { DiscreteError } from "./discrete";
import type { DiscreteResult } from "./discrete";

// ---------------------------------------------------------------------------
// Caps — every one is named in the message that enforces it.
// ---------------------------------------------------------------------------

export const CAPS = {
  /** n for C(n, k), P(n, k), stars-and-bars, power sets. */
  BINOMIAL_N: 10_000,
  /** n for n!, (n−1)! round tables, multiset permutations (word length). */
  FACTORIAL_N: 3_000,
  /** n for Catalan, Bell, derangements, Stirling numbers. */
  SPECIAL_N: 500,
  /** n for integer partitions p(n). */
  PARTITION_N: 2_000,
  /** Partitions are LISTED (not just counted) up to this n. */
  PARTITION_LIST_N: 12,
  /** Total n for a multinomial coefficient. */
  MULTINOMIAL_TOTAL: 3_000,
  /** Exponent for "k-letter words from b letters with repetition" (bᵏ). */
  POWER_EXPONENT: 10_000,
  /** Base for the same. */
  POWER_BASE: 10_000,
  /** Results longer than this are shown cut, with the digit count. */
  MAX_DISPLAY_DIGITS: 1_500,
  /** Longer inputs are not read at all (null) — the regexes stay cheap. Sized
   *  above FACTORIAL_N so a 3,000-letter word reaches its own cap by name. */
  MAX_INPUT_CHARS: 5_000,
  /** Pascal's-triangle cross-check of C(n, k) runs up to this n (O(n²)). */
  PASCAL_CHECK_N: 200,
  /** Convolution-recurrence cross-check of Catalan runs up to this n (O(n²)). */
  CATALAN_CONV_CHECK_N: 150,
  /** Coin-change DP cross-check of p(n) runs up to this n (O(n²)). */
  PARTITION_DP_CHECK_N: 400,
  /** Compositions-DP cross-check of stars-and-bars runs while n·k ≤ this. */
  STARS_DP_CHECK_PRODUCT: 200_000,
  /** Repeated-multiplication cross-check of bᵏ runs up to this k. */
  POWER_CHECK_EXPONENT: 2_000,
} as const;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Thousands separators; past MAX_DISPLAY_DIGITS the number is shown cut
 *  ("1234…789 (2,341 digits)") — never rounded. */
export function formatBig(v: bigint): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString();
  const sign = neg ? "−" : "";
  if (s.length > CAPS.MAX_DISPLAY_DIGITS) {
    return `${sign}${s.slice(0, 4)}…${s.slice(-3)} (${groupDigits(String(s.length))} digits)`;
  }
  return sign + groupDigits(s);
}

function fmtN(n: number): string {
  return groupDigits(String(n));
}

/** The verification contract: equal → a "verified" step; unequal → a
 *  "cross-check FAILED" caveat. Exported so the failure branch is testable. */
export function crossCheckLine(what: string, a: bigint, b: bigint): { ok: boolean; line: string } {
  if (a === b) return { ok: true, line: `verified: ${what} agree` };
  return {
    ok: false,
    line: `cross-check FAILED: ${what} disagree (${formatBig(a)} vs ${formatBig(b)}) — do not rely on this number.`,
  };
}

interface Acc {
  display: string[];
  steps: string[];
  caveats: string[];
}

function acc(): Acc {
  return { display: [], steps: [], caveats: [] };
}

function check(out: Acc, what: string, a: bigint, b: bigint): void {
  const r = crossCheckLine(what, a, b);
  (r.ok ? out.steps : out.caveats).push(r.line);
}

function finish(out: Acc): DiscreteResult {
  return { title: "Combinatorics", display: out.display, steps: out.steps, caveats: out.caveats };
}

function refuse(msg: string): never {
  throw new DiscreteError(msg);
}

function capCheck(label: string, value: number, cap: number, capName: string): void {
  if (!Number.isFinite(value) || value > cap) {
    const shown = Number.isFinite(value) ? fmtN(value) : "that";
    refuse(`${label} is capped at ${fmtN(cap)} here (${capName}); you asked for ${shown}. Exact arithmetic above the cap would not return within a keystroke.`);
  }
}

// ---------------------------------------------------------------------------
// Exact arithmetic — all BigInt. Exported for the tests' oracles.
// ---------------------------------------------------------------------------

export function factorial(n: number): bigint {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

/** Multiplicative formula, exactly k steps (no symmetry shortcut) — so that
 *  binomialRaw(n, k) and binomialRaw(n, n−k) are genuinely two routes. */
export function binomialRaw(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

export function binomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  return binomialRaw(n, Math.min(k, n - k));
}

/** Row n of Pascal's triangle by addition only — the independent route. */
export function pascalRow(n: number): bigint[] {
  let row: bigint[] = [1n];
  for (let i = 1; i <= n; i++) {
    const next = new Array<bigint>(i + 1);
    next[0] = 1n;
    next[i] = 1n;
    for (let j = 1; j < i; j++) next[j] = row[j - 1] + row[j];
    row = next;
  }
  return row;
}

/** P(n, k) = n·(n−1)·…·(n−k+1). */
export function permutations(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = n - k + 1; i <= n; i++) r *= BigInt(i);
  return r;
}

/** D(n) by the recurrence D(n) = (n−1)(D(n−1) + D(n−2)), D(0) = 1, D(1) = 0. */
export function derangementsRec(n: number): bigint {
  if (n === 0) return 1n;
  let a = 1n; // D(i−2)
  let b = 0n; // D(i−1)
  for (let i = 2; i <= n; i++) {
    const c = BigInt(i - 1) * (a + b);
    a = b;
    b = c;
  }
  return b;
}

/** D(n) by inclusion–exclusion: Σ (−1)ⁱ n!/i!, each term exact. */
export function derangementsIE(n: number): bigint {
  let term = factorial(n);
  let sum = 0n;
  for (let i = 0; i <= n; i++) {
    if (i > 0) term /= BigInt(i);
    sum += i % 2 === 0 ? term : -term;
  }
  return sum;
}

/** Catalan numbers C₀..Cₙ by the ratio recurrence Cₘ = Cₘ₋₁·2(2m−1)/(m+1). */
export function catalanSeq(n: number): bigint[] {
  const c: bigint[] = [1n];
  for (let m = 1; m <= n; m++) c.push((c[m - 1] * BigInt(2 * (2 * m - 1))) / BigInt(m + 1));
  return c;
}

/** Cₙ by the convolution recurrence Cₙ₊₁ = Σ Cᵢ·Cₙ₋ᵢ (O(n²)). */
export function catalanConvolution(n: number): bigint {
  const c: bigint[] = [1n];
  for (let m = 1; m <= n; m++) {
    let s = 0n;
    for (let i = 0; i < m; i++) s += c[i] * c[m - 1 - i];
    c.push(s);
  }
  return c[n];
}

/** Cₙ closed form C(2n, n)/(n+1). */
export function catalanClosed(n: number): bigint {
  return binomial(2 * n, n) / BigInt(n + 1);
}

/** Bell numbers B₀..Bₙ by the Bell (Aitken) triangle. */
export function bellSeq(n: number): bigint[] {
  const out: bigint[] = [1n];
  let row: bigint[] = [1n];
  for (let i = 1; i <= n; i++) {
    const next: bigint[] = [row[row.length - 1]];
    for (let j = 0; j < row.length; j++) next.push(next[j] + row[j]);
    row = next;
    out.push(row[0]);
  }
  return out;
}

/** Row n of Stirling numbers of the second kind S(n, 0..n) by the recurrence
 *  S(n, k) = k·S(n−1, k) + S(n−1, k−1). */
export function stirling2Row(n: number): bigint[] {
  let row: bigint[] = [1n];
  for (let i = 1; i <= n; i++) {
    const next = new Array<bigint>(i + 1).fill(0n);
    for (let k = 1; k <= i; k++) next[k] = BigInt(k) * (row[k] ?? 0n) + row[k - 1];
    row = next;
  }
  return row;
}

/** S(n, k) by the explicit formula (1/k!) Σⱼ (−1)ᵏ⁻ʲ C(k, j) jⁿ — the independent route. */
export function stirling2Explicit(n: number, k: number): bigint {
  if (k > n) return 0n;
  if (n === 0 && k === 0) return 1n;
  if (k === 0) return 0n;
  let s = 0n;
  for (let j = 0; j <= k; j++) {
    const term = binomial(k, j) * BigInt(j) ** BigInt(n);
    s += (k - j) % 2 === 0 ? term : -term;
  }
  return s / factorial(k);
}

/** Row n of UNSIGNED Stirling numbers of the first kind c(n, 0..n) by
 *  c(n, k) = (n−1)·c(n−1, k) + c(n−1, k−1). */
export function stirling1Row(n: number): bigint[] {
  let row: bigint[] = [1n];
  for (let i = 1; i <= n; i++) {
    const next = new Array<bigint>(i + 1).fill(0n);
    for (let k = 1; k <= i; k++) next[k] = BigInt(i - 1) * (row[k] ?? 0n) + row[k - 1];
    row = next;
  }
  return row;
}

/** p(0..n) by Euler's pentagonal-number recurrence. */
export function partitionCounts(n: number): bigint[] {
  const p = new Array<bigint>(n + 1).fill(0n);
  p[0] = 1n;
  for (let m = 1; m <= n; m++) {
    let s = 0n;
    for (let k = 1; ; k++) {
      const g1 = (k * (3 * k - 1)) / 2;
      if (g1 > m) break;
      const sign = k % 2 === 1 ? 1n : -1n;
      s += sign * p[m - g1];
      const g2 = (k * (3 * k + 1)) / 2;
      if (g2 <= m) s += sign * p[m - g2];
    }
    p[m] = s;
  }
  return p;
}

/** p(n) by the coin-change DP over parts 1..n — the independent route (O(n²)). */
export function partitionDP(n: number): bigint {
  const dp = new Array<bigint>(n + 1).fill(0n);
  dp[0] = 1n;
  for (let part = 1; part <= n; part++) {
    for (let s = part; s <= n; s++) dp[s] += dp[s - part];
  }
  return dp[n];
}

/** All partitions of n, each as a non-increasing list of parts. Only for small n. */
export function listPartitions(n: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (rem: number, maxPart: number): void => {
    if (rem === 0) {
      out.push(cur.slice());
      return;
    }
    for (let p = Math.min(rem, maxPart); p >= 1; p--) {
      cur.push(p);
      rec(rem - p, p);
      cur.pop();
    }
  };
  rec(n, n);
  return out;
}

/** Letter counts of a word in order of first appearance (upper-cased). */
export function letterCounts(word: string): { letter: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const ch of word.toUpperCase()) {
    if (!counts.has(ch)) {
      order.push(ch);
      counts.set(ch, 0);
    }
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return order.map((letter) => ({ letter, count: counts.get(letter) ?? 0 }));
}

/** Multiset permutations n!/(c₁!·c₂!·…) by the factorial quotient. */
export function multisetPermutations(counts: number[]): bigint {
  const n = counts.reduce((a, b) => a + b, 0);
  let denom = 1n;
  for (const c of counts) denom *= factorial(c);
  return factorial(n) / denom;
}

/** The same count by successive binomials C(n,c₁)·C(n−c₁,c₂)·… — the independent route. */
export function multisetBySuccessiveBinomials(counts: number[]): bigint {
  let remaining = counts.reduce((a, b) => a + b, 0);
  let r = 1n;
  for (const c of counts) {
    r *= binomial(remaining, c);
    remaining -= c;
  }
  return r;
}

/** Weak compositions of n into k parts by a prefix-sum DP — the independent
 *  route for stars-and-bars. `atLeastOne` counts strict compositions. */
export function compositionsDP(n: number, k: number, atLeastOne: boolean): bigint {
  if (k === 0) return n === 0 ? 1n : 0n;
  let ways = new Array<bigint>(n + 1).fill(0n);
  ways[0] = 1n;
  for (let box = 0; box < k; box++) {
    const next = new Array<bigint>(n + 1).fill(0n);
    let prefix = 0n;
    for (let s = 0; s <= n; s++) {
      // next[s] = Σ_{j ≤ s (or j < s when each box needs ≥ 1)} ways[j]
      if (atLeastOne) {
        next[s] = prefix;
        prefix += ways[s];
      } else {
        prefix += ways[s];
        next[s] = prefix;
      }
    }
    ways = next;
  }
  return ways[n];
}

export function powerByMultiplication(base: number, exp: number): bigint {
  const b = BigInt(base);
  let r = 1n;
  for (let i = 0; i < exp; i++) r *= b;
  return r;
}

// ---------------------------------------------------------------------------
// Result builders — each produces answer line, working, verification.
// `model` is the one-sentence prose explanation for word problems.
// ---------------------------------------------------------------------------

function factorialTerm(n: number): string {
  return `${fmtN(n)}!`;
}

function buildBinomial(n: number, k: number, model?: string, label?: string): DiscreteResult {
  capCheck("n in C(n, k)", n, CAPS.BINOMIAL_N, "BINOMIAL_N");
  capCheck("k in C(n, k)", k, CAPS.BINOMIAL_N, "BINOMIAL_N");
  const out = acc();
  const value = binomial(n, k);
  out.display.push(`${label ?? `C(${fmtN(n)}, ${fmtN(k)})`} = ${formatBig(value)}`);
  if (model) out.steps.push(model);
  if (k > n) {
    out.steps.push(`k = ${fmtN(k)} exceeds n = ${fmtN(n)}: there is no way to choose more items than exist, so the count is 0.`);
    return finish(out);
  }
  if (n <= CAPS.FACTORIAL_N) {
    out.steps.push(
      `C(${fmtN(n)}, ${fmtN(k)}) = ${factorialTerm(n)} / (${factorialTerm(k)} · ${factorialTerm(n - k)}) = ` +
        `${formatBig(factorial(n))} / (${formatBig(factorial(k))} · ${formatBig(factorial(n - k))}) = ${formatBig(value)}`,
    );
  } else {
    const kk = Math.min(k, n - k);
    const num = kk <= 4
      ? Array.from({ length: kk }, (_, i) => fmtN(n - i)).join(" · ")
      : `${fmtN(n)} · ${fmtN(n - 1)} · … · ${fmtN(n - kk + 1)}`;
    const den = kk <= 4
      ? Array.from({ length: kk }, (_, i) => fmtN(i + 1)).join(" · ")
      : `1 · 2 · … · ${fmtN(kk)}`;
    out.steps.push(`C(${fmtN(n)}, ${fmtN(k)}) = (${num}) / (${den}) = ${formatBig(value)} (multiplicative form; ${fmtN(n)}! itself is past the ${fmtN(CAPS.FACTORIAL_N)} factorial cap, FACTORIAL_N)`);
  }
  // Symmetry: C(n, k) = C(n, n−k), each by its own k-step multiplicative run.
  check(out, `C(${fmtN(n)}, ${fmtN(k)}) and C(${fmtN(n)}, ${fmtN(n - k)}) (symmetry, each computed by its own multiplicative run)`, binomialRaw(n, k), binomialRaw(n, n - k));
  if (n <= CAPS.PASCAL_CHECK_N) {
    check(out, "the multiplicative formula and row " + fmtN(n) + " of Pascal's triangle", value, pascalRow(n)[k]);
  } else {
    out.caveats.push(`Pascal's-triangle cross-check is only run for n ≤ ${fmtN(CAPS.PASCAL_CHECK_N)} (PASCAL_CHECK_N); the symmetry check above still ran.`);
  }
  return finish(out);
}

function buildPermutation(n: number, k: number, model?: string, label?: string): DiscreteResult {
  capCheck("n in P(n, k)", n, CAPS.BINOMIAL_N, "BINOMIAL_N");
  capCheck("k in P(n, k)", k, CAPS.BINOMIAL_N, "BINOMIAL_N");
  const out = acc();
  const value = permutations(n, k);
  out.display.push(`${label ?? `P(${fmtN(n)}, ${fmtN(k)})`} = ${formatBig(value)}`);
  if (model) out.steps.push(model);
  if (k > n) {
    out.steps.push(`k = ${fmtN(k)} exceeds n = ${fmtN(n)}: there is no way to arrange more items than exist, so the count is 0.`);
    return finish(out);
  }
  if (n <= CAPS.FACTORIAL_N) {
    out.steps.push(
      `P(${fmtN(n)}, ${fmtN(k)}) = ${factorialTerm(n)} / ${factorialTerm(n - k)} = ${formatBig(factorial(n))} / ${formatBig(factorial(n - k))} = ${formatBig(value)}`,
    );
    check(out, "the falling product n·(n−1)·…·(n−k+1) and the quotient n!/(n−k)!", value, factorial(n) / factorial(n - k));
  } else {
    const terms = k <= 4
      ? Array.from({ length: k }, (_, i) => fmtN(n - i)).join(" · ")
      : `${fmtN(n)} · ${fmtN(n - 1)} · … · ${fmtN(n - k + 1)}`;
    out.steps.push(`P(${fmtN(n)}, ${fmtN(k)}) = ${terms} = ${formatBig(value)} (falling product; ${fmtN(n)}! itself is past the ${fmtN(CAPS.FACTORIAL_N)} factorial cap, FACTORIAL_N)`);
    if (k <= CAPS.FACTORIAL_N) {
      check(out, "the falling product and C(n, k)·k!", value, binomial(n, k) * factorial(k));
    } else {
      out.caveats.push(`No second route was available: both n and k exceed the ${fmtN(CAPS.FACTORIAL_N)} factorial cap (FACTORIAL_N), so the falling product was computed once.`);
    }
  }
  return finish(out);
}

function trailingZeros(v: bigint): number {
  const s = v.toString();
  let z = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "0"; i--) z++;
  return z;
}

function legendreTrailingZeros(n: number): number {
  let z = 0;
  for (let p = 5; p <= n; p *= 5) z += Math.floor(n / p);
  return z;
}

function buildFactorial(n: number, model?: string, label?: string): DiscreteResult {
  capCheck("n in n!", n, CAPS.FACTORIAL_N, "FACTORIAL_N");
  const out = acc();
  const value = factorial(n);
  out.display.push(`${label ?? factorialTerm(n)} = ${formatBig(value)}`);
  if (model) out.steps.push(model);
  const terms = n <= 6
    ? Array.from({ length: Math.max(n, 1) }, (_, i) => fmtN(n - i)).join(" · ")
    : `${fmtN(n)} · ${fmtN(n - 1)} · ${fmtN(n - 2)} · … · 2 · 1`;
  out.steps.push(`${factorialTerm(n)} = ${n === 0 ? "1 (empty product)" : `${terms} = ${formatBig(value)}`}`);
  const digits = value.toString().length;
  const zeros = trailingZeros(value);
  out.steps.push(`${factorialTerm(n)} has ${fmtN(digits)} digits and ends in ${fmtN(zeros)} trailing zero${zeros === 1 ? "" : "s"}.`);
  // Legendre: the number of trailing zeros is Σ ⌊n/5ⁱ⌋ — an independent check on the product.
  check(out, "the trailing-zero count of the product and Legendre's formula Σ⌊n/5ⁱ⌋", BigInt(zeros), BigInt(legendreTrailingZeros(n)));
  if (n >= 2) {
    const h = Math.floor(n / 2);
    check(out, `n! and C(n, ⌊n/2⌋)·⌊n/2⌋!·⌈n/2⌉! (= C(${fmtN(n)}, ${fmtN(h)})·${fmtN(h)}!·${fmtN(n - h)}!)`, value, binomial(n, h) * factorial(h) * factorial(n - h));
  }
  return finish(out);
}

function buildCircular(n: number, model: string): DiscreteResult {
  capCheck("n for a round table", n, CAPS.FACTORIAL_N, "FACTORIAL_N");
  const out = acc();
  if (n === 0) refuse("A round table with no one at it has no seating to count — give the number of people.");
  const value = factorial(n - 1);
  out.display.push(`(${fmtN(n)} − 1)! = ${factorialTerm(n - 1)} = ${formatBig(value)}`);
  out.steps.push(model);
  out.steps.push(`Fix one person to remove the rotations, then arrange the remaining ${fmtN(n - 1)} in order: (${fmtN(n)} − 1)! = ${factorialTerm(n - 1)} = ${formatBig(value)}`);
  check(out, "(n−1)! and n!/n", value, factorial(n) / BigInt(n));
  out.caveats.push("Rotations are counted as the same seating; reflections (mirror images) are counted as different. If reflections should also be identified, halve the answer for n ≥ 3.");
  return finish(out);
}

function buildMultinomial(n: number, parts: number[]): DiscreteResult {
  capCheck("the total n in a multinomial", n, CAPS.MULTINOMIAL_TOTAL, "MULTINOMIAL_TOTAL");
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== n) {
    refuse(`The parts of a multinomial must sum to n: ${parts.map(fmtN).join(" + ")} = ${fmtN(sum)}, but n = ${fmtN(n)}. Fix the parts (or the total) and try again.`);
  }
  const out = acc();
  let denom = 1n;
  for (const p of parts) denom *= factorial(p);
  const value = factorial(n) / denom;
  out.display.push(`(${fmtN(n)}; ${parts.map(fmtN).join(", ")}) = ${formatBig(value)}`);
  out.steps.push(
    `${factorialTerm(n)} / (${parts.map(factorialTerm).join(" · ")}) = ${formatBig(factorial(n))} / (${parts.map((p) => formatBig(factorial(p))).join(" · ")}) = ${formatBig(value)}`,
  );
  check(out, "the factorial quotient and the product of successive binomials C(n, k₁)·C(n−k₁, k₂)·…", value, multisetBySuccessiveBinomials(parts));
  return finish(out);
}

function buildMultiset(word: string, model?: string): DiscreteResult {
  const upper = word.toUpperCase();
  capCheck(`the length of "${upper.length > 20 ? upper.slice(0, 20) + "…" : upper}"`, upper.length, CAPS.FACTORIAL_N, "FACTORIAL_N");
  const out = acc();
  const counts = letterCounts(upper);
  const n = upper.length;
  const value = multisetPermutations(counts.map((c) => c.count));
  out.display.push(`Distinct arrangements of ${upper} = ${formatBig(value)}`);
  if (model) out.steps.push(model);
  out.steps.push(`${upper} has ${fmtN(n)} letters: ${counts.map((c) => `${c.letter}×${c.count}`).join(", ")}`);
  out.steps.push(
    `${factorialTerm(n)} / (${counts.map((c) => factorialTerm(c.count)).join(" · ")}) = ` +
      `${formatBig(factorial(n))} / (${counts.map((c) => formatBig(factorial(c.count))).join(" · ")}) = ${formatBig(value)}`,
  );
  check(out, "the factorial quotient and the product of successive binomials (place each letter's copies in turn)", value, multisetBySuccessiveBinomials(counts.map((c) => c.count)));
  return finish(out);
}

function buildDerangements(n: number): DiscreteResult {
  capCheck("n in D(n)", n, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const value = derangementsRec(n);
  out.display.push(`D(${fmtN(n)}) = !${fmtN(n)} = ${formatBig(value)}`);
  out.steps.push(`Recurrence D(n) = (n − 1)·(D(n − 1) + D(n − 2)) with D(0) = 1, D(1) = 0${n >= 2 ? `: D(${fmtN(n)}) = ${fmtN(n - 1)} · (${formatBig(derangementsRec(n - 1))} + ${formatBig(derangementsRec(n - 2))}) = ${formatBig(value)}` : ""}`);
  out.steps.push(`Inclusion–exclusion: D(n) = n! · Σᵢ₌₀ⁿ (−1)ⁱ/i! = ${formatBig(derangementsIE(n))}`);
  check(out, "the recurrence and the inclusion–exclusion sum", value, derangementsIE(n));
  return finish(out);
}

/** The listed range's last index as subscript digits: the sequence shows terms 0..min(n, 10). */
function seqEndSub(n: number): string {
  return [...String(Math.min(n, 10))].map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
}

function buildCatalan(n: number): DiscreteResult {
  capCheck("n in Catalan(n)", n, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const seq = catalanSeq(n);
  const value = seq[n];
  out.display.push(`Catalan(${fmtN(n)}) = ${formatBig(value)}`);
  out.steps.push(`Closed form C(2n, n)/(n + 1) = C(${fmtN(2 * n)}, ${fmtN(n)}) / ${fmtN(n + 1)} = ${formatBig(binomial(2 * n, n))} / ${fmtN(n + 1)} = ${formatBig(catalanClosed(n))}`);
  out.steps.push(`Sequence C₀..C${seqEndSub(n)}: ${seq.slice(0, Math.min(seq.length, 11)).map(formatBig).join(", ")}${n > 10 ? ", …" : ""}`);
  check(out, "the ratio recurrence Cₘ = Cₘ₋₁·2(2m−1)/(m+1) and the closed form C(2n, n)/(n+1)", value, catalanClosed(n));
  if (n <= CAPS.CATALAN_CONV_CHECK_N) {
    check(out, "the convolution recurrence Cₙ₊₁ = Σ Cᵢ·Cₙ₋ᵢ and the closed form", catalanConvolution(n), catalanClosed(n));
  } else {
    out.caveats.push(`The O(n²) convolution-recurrence cross-check is only run for n ≤ ${fmtN(CAPS.CATALAN_CONV_CHECK_N)} (CATALAN_CONV_CHECK_N); the ratio-recurrence check above still ran.`);
  }
  return finish(out);
}

function buildBell(n: number): DiscreteResult {
  capCheck("n in Bell(n)", n, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const seq = bellSeq(n);
  const value = seq[n];
  out.display.push(`Bell(${fmtN(n)}) = ${formatBig(value)}`);
  out.steps.push(`Bell triangle (each row starts with the previous row's last entry; B(n) is the first entry of row n)`);
  out.steps.push(`Sequence B₀..B${seqEndSub(n)}: ${seq.slice(0, Math.min(seq.length, 11)).map(formatBig).join(", ")}${n > 10 ? ", …" : ""}`);
  const row = stirling2Row(n);
  const sumS = row.reduce((a, b) => a + b, 0n);
  out.steps.push(`Σₖ S(${fmtN(n)}, k) over Stirling numbers of the second kind = ${formatBig(sumS)}`);
  check(out, "the Bell triangle and Σₖ S(n, k)", value, sumS);
  return finish(out);
}

function buildStirling2(n: number, k: number): DiscreteResult {
  capCheck("n in S(n, k)", n, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const value = k > n ? 0n : stirling2Row(n)[k];
  out.display.push(`S(${fmtN(n)}, ${fmtN(k)}) = ${formatBig(value)}`);
  out.steps.push(`Stirling number of the SECOND kind: the number of ways to partition a ${fmtN(n)}-element set into ${fmtN(k)} non-empty blocks.`);
  if (k > n) {
    out.steps.push(`k = ${fmtN(k)} exceeds n = ${fmtN(n)}: ${fmtN(n)} elements cannot form ${fmtN(k)} non-empty blocks, so S = 0.`);
    return finish(out);
  }
  out.steps.push(`Recurrence S(n, k) = k·S(n−1, k) + S(n−1, k−1) gives ${formatBig(value)}; explicit formula (1/k!)·Σⱼ (−1)ᵏ⁻ʲ C(k, j)·jⁿ gives ${formatBig(stirling2Explicit(n, k))}`);
  check(out, "the recurrence and the explicit formula", value, stirling2Explicit(n, k));
  out.caveats.push("For the first kind (unsigned), write stirling1 n k or s(n, k) with a lower-case s.");
  return finish(out);
}

function buildStirling1(n: number, k: number): DiscreteResult {
  capCheck("n in s(n, k)", n, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const row = stirling1Row(n);
  const value = k > n ? 0n : row[k];
  out.display.push(`s(${fmtN(n)}, ${fmtN(k)}) = ${formatBig(value)} (unsigned, first kind)`);
  out.steps.push(`Unsigned Stirling number of the FIRST kind: the number of permutations of ${fmtN(n)} elements with exactly ${fmtN(k)} cycles.`);
  if (k > n) {
    out.steps.push(`k = ${fmtN(k)} exceeds n = ${fmtN(n)}: a permutation of ${fmtN(n)} elements has at most ${fmtN(n)} cycles, so s = 0.`);
    return finish(out);
  }
  out.steps.push(`Recurrence c(n, k) = (n−1)·c(n−1, k) + c(n−1, k−1) gives ${formatBig(value)}`);
  const rowSum = row.reduce((a, b) => a + b, 0n);
  check(out, `the row sum Σₖ c(${fmtN(n)}, k) and ${fmtN(n)}!`, rowSum, factorial(n));
  if (k === 1 && n >= 1) check(out, "c(n, 1) and (n−1)!", value, factorial(n - 1));
  if (k === n - 1 && n >= 2) check(out, "c(n, n−1) and C(n, 2)", value, binomial(n, 2));
  out.caveats.push("The signed first-kind value is (−1)ⁿ⁻ᵏ times this.");
  return finish(out);
}

function buildPartitions(n: number): DiscreteResult {
  capCheck("n in p(n)", n, CAPS.PARTITION_N, "PARTITION_N");
  const out = acc();
  const value = partitionCounts(n)[n];
  out.display.push(`p(${fmtN(n)}) = ${formatBig(value)}`);
  out.steps.push(`Integer partitions: the number of ways to write ${fmtN(n)} as a sum of positive integers, order ignored (Euler's pentagonal-number recurrence).`);
  if (n <= CAPS.PARTITION_LIST_N) {
    const parts = listPartitions(n);
    const byLength = new Map<number, string[]>();
    for (const p of parts) {
      const arr = byLength.get(p.length) ?? [];
      arr.push(p.join("+"));
      byLength.set(p.length, arr);
    }
    for (const [len, list] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
      out.steps.push(`${len} part${len === 1 ? "" : "s"} (${list.length}): ${list.join(", ")}`);
    }
    check(out, "the recurrence and the enumerated list", value, BigInt(parts.length));
  }
  if (n <= CAPS.PARTITION_DP_CHECK_N) {
    check(out, "the pentagonal recurrence and the coin-change dynamic programme", value, partitionDP(n));
  } else {
    out.caveats.push(`The O(n²) coin-change cross-check is only run for n ≤ ${fmtN(CAPS.PARTITION_DP_CHECK_N)} (PARTITION_DP_CHECK_N).`);
  }
  return finish(out);
}

function buildPowerSet(n: number, model?: string): DiscreteResult {
  capCheck("n for a power set", n, CAPS.BINOMIAL_N, "BINOMIAL_N");
  const out = acc();
  const value = 2n ** BigInt(n);
  out.display.push(`2^${fmtN(n)} = ${formatBig(value)}`);
  if (model) out.steps.push(model);
  out.steps.push(`Each of the ${fmtN(n)} elements is either in or out of a subset: 2 · 2 · … · 2 (${fmtN(n)} factors) = ${formatBig(value)}`);
  if (n <= CAPS.PASCAL_CHECK_N) {
    check(out, "2ⁿ and the row sum Σₖ C(n, k) of Pascal's triangle", value, pascalRow(n).reduce((a, b) => a + b, 0n));
  } else {
    check(out, "2ⁿ by exponentiation and by repeated doubling", value, powerByMultiplication(2, n));
  }
  return finish(out);
}

function buildPower(base: number, exp: number, model: string, label: string): DiscreteResult {
  capCheck("the exponent", exp, CAPS.POWER_EXPONENT, "POWER_EXPONENT");
  capCheck("the base", base, CAPS.POWER_BASE, "POWER_BASE");
  const out = acc();
  const value = BigInt(base) ** BigInt(exp);
  out.display.push(`${label} = ${fmtN(base)}^${fmtN(exp)} = ${formatBig(value)}`);
  out.steps.push(model);
  out.steps.push(`${fmtN(base)} choices for each of ${fmtN(exp)} positions: ${fmtN(base)} · ${fmtN(base)} · … (${fmtN(exp)} factors) = ${formatBig(value)}`);
  if (exp <= CAPS.POWER_CHECK_EXPONENT) {
    check(out, "exponentiation and repeated multiplication", value, powerByMultiplication(base, exp));
  } else {
    out.caveats.push(`The repeated-multiplication cross-check is only run for exponents ≤ ${fmtN(CAPS.POWER_CHECK_EXPONENT)} (POWER_CHECK_EXPONENT).`);
  }
  return finish(out);
}

function buildStarsAndBars(n: number, k: number, atLeastOne: boolean, things: string, boxes: string): DiscreteResult {
  capCheck("n + k − 1 for stars and bars", n + k - 1, CAPS.BINOMIAL_N, "BINOMIAL_N");
  if (k === 0) refuse(`There are no ${boxes} to put the ${things} into — give at least one.`);
  const out = acc();
  const value = atLeastOne ? binomial(n - 1, k - 1) : binomial(n + k - 1, k - 1);
  const label = atLeastOne ? `C(${fmtN(n)} − 1, ${fmtN(k)} − 1) = C(${fmtN(n - 1)}, ${fmtN(k - 1)})` : `C(${fmtN(n)} + ${fmtN(k)} − 1, ${fmtN(k)} − 1) = C(${fmtN(n + k - 1)}, ${fmtN(k - 1)})`;
  out.display.push(`${label} = ${formatBig(value)}`);
  out.steps.push(
    `The ${things} are identical and the ${boxes} are distinct, so only how many go in each ${boxes.replace(/s$/, "")} matters: this is stars and bars (${fmtN(n)} stars, ${fmtN(k - 1)} bars)` +
      (atLeastOne ? `, with one ${things.replace(/s$/, "")} placed in each ${boxes.replace(/s$/, "")} first (so ${fmtN(n - k < 0 ? 0 : n - k)} remain free): C(n − 1, k − 1).` : ": C(n + k − 1, k − 1)."),
  );
  if (atLeastOne && n < k) {
    out.steps.push(`${fmtN(n)} ${things} cannot give every one of ${fmtN(k)} ${boxes} at least one, so the count is 0.`);
    return finish(out);
  }
  const N = atLeastOne ? n - 1 : n + k - 1;
  const K = k - 1;
  if (N <= CAPS.FACTORIAL_N) {
    out.steps.push(`C(${fmtN(N)}, ${fmtN(K)}) = ${factorialTerm(N)} / (${factorialTerm(K)} · ${factorialTerm(N - K)}) = ${formatBig(factorial(N))} / (${formatBig(factorial(K))} · ${formatBig(factorial(N - K))}) = ${formatBig(value)}`);
  }
  if (n * k <= CAPS.STARS_DP_CHECK_PRODUCT) {
    check(out, "the binomial and a direct count of the compositions (dynamic programme)", value, compositionsDP(n, k, atLeastOne));
  } else {
    out.caveats.push(`The direct-count cross-check is only run while n·k ≤ ${fmtN(CAPS.STARS_DP_CHECK_PRODUCT)} (STARS_DP_CHECK_PRODUCT).`);
  }
  return finish(out);
}

/** Distinct things into distinct boxes with no box empty: surjections, k!·S(n, k). */
function buildSurjections(n: number, k: number, things: string, boxes: string): DiscreteResult {
  capCheck(`n for "each ${boxes.replace(/s$/, "")} at least one" with distinct ${things} (Stirling numbers)`, n, CAPS.SPECIAL_N, "SPECIAL_N");
  capCheck(`k for "each ${boxes.replace(/s$/, "")} at least one" with distinct ${things} (Stirling numbers)`, k, CAPS.SPECIAL_N, "SPECIAL_N");
  const out = acc();
  const s = k > n ? 0n : stirling2Row(n)[k];
  const value = factorial(k) * s;
  out.display.push(`${fmtN(k)}! · S(${fmtN(n)}, ${fmtN(k)}) = ${formatBig(factorial(k))} · ${formatBig(s)} = ${formatBig(value)}`);
  out.steps.push(`The ${things} are distinct and every ${boxes.replace(/s$/, "")} must receive at least one, so this counts surjections from ${fmtN(n)} ${things} onto ${fmtN(k)} ${boxes}: k!·S(n, k).`);
  if (k > n) out.steps.push(`${fmtN(n)} ${things} cannot cover ${fmtN(k)} ${boxes}, so the count is 0.`);
  // Inclusion–exclusion on empty boxes: Σⱼ (−1)ʲ C(k, j)(k−j)ⁿ.
  let ie = 0n;
  for (let j = 0; j <= k; j++) {
    const term = binomial(k, j) * BigInt(k - j) ** BigInt(n);
    ie += j % 2 === 0 ? term : -term;
  }
  check(out, "k!·S(n, k) and inclusion–exclusion Σⱼ (−1)ʲ C(k, j)·(k−j)ⁿ", value, ie);
  return finish(out);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g");

function wordsToDigits(s: string): string {
  return s.replace(NUMBER_WORD_RE, (w) => String(NUMBER_WORDS[w]));
}

/** Things a sibling engine owns. Anything carrying one of these is not ours. */
const FOREIGN_RE =
  /\b(?:mod|modulo|gcd|lcm|hcf|prime|primes|factor|factors|factorize|factorise|factorization|divisors?|divisible|phi|totient|inverse|primitive|root|congruen\w*|dfa|nfa|regex|regexp|automaton|minimi[sz]e|equivalent|shortest|path|mst|eulerian|bipartite|components|topological|hamiltonian|master\s+theorem)\b|[≡^~&|=<>]|->|\\/;

/** Parses a decimal literal; huge values come back as Infinity (so they hit a cap). */
function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : Infinity;
}

/** Exported so the front door's hint and the tests can see them; the engine itself
 *  only cares that each pattern claims exactly its own form. */
export function tryCombinatorics(input: string): DiscreteResult | null {
  if (typeof input !== "string") return null;
  if (input.length > CAPS.MAX_INPUT_CHARS) return null; // MAX_INPUT_CHARS: regexes stay cheap
  const raw = input.trim();
  if (!raw || /[\r\n]/.test(raw)) return null; // every form here is one line

  // Strip a trailing "= ?" / "?" / "." so "C(10,3) = ?" and "how many …?" read as typed.
  const base = raw.replace(/\s*=\s*\?*\s*$/, "").replace(/[?.\s]+$/, "").trim();
  if (!base) return null;
  if (FOREIGN_RE.test(base) || FOREIGN_RE.test(base.toLowerCase())) return null;
  const lower = base.toLowerCase().replace(/\s+/g, " ");
  const t = wordsToDigits(lower);

  return parseSymbolic(base, t) ?? parseProse(lower, t);
}

function parseSymbolic(original: string, t: string): DiscreteResult | null {
  let m: RegExpMatchArray | null;

  // --- binomial coefficient ---
  if ((m = t.match(/^(\d+) choose (\d+)$/)) || (m = t.match(/^(\d+)\s*choose\s*(\d+)$/))) return buildBinomial(num(m[1]), num(m[2]));
  if ((m = t.match(/^(?:c|ncr|binomial|binom|comb|combinations?)\s*\(\s*(\d+)\s*[,;]\s*(\d+)\s*\)$/))) return buildBinomial(num(m[1]), num(m[2]));
  if ((m = t.match(/^(?:ncr|binomial|binom|comb|combinations?)\s+(\d+)\s*[,\s]\s*(\d+)$/))) return buildBinomial(num(m[1]), num(m[2]));
  if ((m = t.match(/^(\d+)\s*(?:ncr|c)\s*(\d+)$/))) return buildBinomial(num(m[1]), num(m[2]));

  // --- permutations P(n, k) ---
  if ((m = t.match(/^(?:p|npr|perm|permutations?)\s*\(\s*(\d+)\s*[,;]\s*(\d+)\s*\)$/))) return buildPermutation(num(m[1]), num(m[2]));
  if ((m = t.match(/^(?:npr|perm)\s+(\d+)\s*[,\s]\s*(\d+)$/))) return buildPermutation(num(m[1]), num(m[2]));
  if ((m = t.match(/^(\d+)\s*(?:npr|p|permute)\s*(\d+)$/))) return buildPermutation(num(m[1]), num(m[2]));

  // --- derangements (before factorial: "!5" vs "5!") ---
  if ((m = t.match(/^!\s*(\d+)$/)) || (m = t.match(/^(?:derangements?|derange|subfactorial|d)\s*\(?\s*(\d+)\s*\)?$/))) return buildDerangements(num(m[1]));

  // --- factorial ---
  if ((m = t.match(/^(\d+)\s*!$/)) || (m = t.match(/^factorial\s*(?:of\s+)?\(?\s*(\d+)\s*\)?$/)) || (m = t.match(/^(\d+)\s+factorial$/))) {
    return buildFactorial(num(m[1]));
  }

  // --- multinomial 10: 3 2 5 / multinomial(10; 3, 2, 5) ---
  if ((m = t.match(/^multinomial\s*\(?\s*(\d+)\s*[:;]\s*([\d\s,]+?)\s*\)?$/))) {
    const parts = m[2].split(/[\s,]+/).filter(Boolean).map(num);
    if (parts.length === 0) return null;
    return buildMultinomial(num(m[1]), parts);
  }

  // --- multiset permutations of a word (matched on the text WITHOUT number-word
  //     substitution, so "anagrams of ONE" is a word, not a digit) ---
  const lw = original.toLowerCase().replace(/\s+/g, " ");
  if ((m = lw.match(/^(?:arrangements|permutations|anagrams|rearrangements|distinct arrangements)\s+of\s+(?:the\s+)?(?:word\s+|letters\s+(?:of|in)\s+(?:the\s+)?(?:word\s+)?)?([a-z]+)$/))) {
    return buildMultiset(m[1]);
  }
  if ((m = t.match(/^(?:arrangements|permutations|orderings)\s+of\s+(\d+)$/))) return buildFactorial(num(m[1]), undefined, `${fmtN(num(m[1]))}!`);

  // --- special sequences ---
  if ((m = t.match(/^catalan\s*\(?\s*(\d+)\s*\)?$/))) return buildCatalan(num(m[1]));
  if ((m = t.match(/^bell\s*\(?\s*(\d+)\s*\)?$/))) return buildBell(num(m[1]));
  if ((m = original.match(/^([sS])\s*\(\s*(\d+)\s*[,;]\s*(\d+)\s*\)$/))) {
    return m[1] === "S" ? buildStirling2(num(m[2]), num(m[3])) : buildStirling1(num(m[2]), num(m[3]));
  }
  // The kind digit must stand alone: "stirling 10 3" is S(10, 3), and a bare
  // `\s*(1|2)?` ate the first digit of n (S(0, 3) = 0, review 2026-10-24).
  if ((m = t.match(/^stirling(?:\s*(1|2)(?!\d))?(?:\s+(?:numbers?\s+)?(?:of\s+the\s+)?(first|second)\s+kind)?\s*\(?\s*(\d+)\s*[,\s]\s*(\d+)\s*\)?$/))) {
    const first = m[1] === "1" || m[2] === "first";
    return first ? buildStirling1(num(m[3]), num(m[4])) : buildStirling2(num(m[3]), num(m[4]));
  }
  if ((m = t.match(/^(?:p|partitions?|integer partitions?|partition number)\s*(?:of\s+)?\(?\s*(\d+)\s*\)?$/))) return buildPartitions(num(m[1]));

  // --- power set ---
  if ((m = t.match(/^(?:subsets|power\s*set|powerset)\s+(?:of\s+)?(?:a\s+|an\s+)?(\d+)(?:[- ]element\s+set)?$/))) return buildPowerSet(num(m[1]));

  return null;
}

// ---------------------------------------------------------------------------
// Modifier clauses the prose rules DO model. Each is written once here so the
// constraint guard below can strip exactly these before looking for conditions
// the engine does not model ("if two must sit together").
// ---------------------------------------------------------------------------

/** Optional clause opener: "so that …", "if …", "where …", "with …", "and …". */
const PFX = "(?:(?:so|such)\\s+that\\s+|if\\s+|where\\s+|when\\s+|provided\\s+(?:that\\s+)?|given\\s+that\\s+|assuming\\s+(?:that\\s+)?|with\\s+|and\\s+|but\\s+)?";
const SUBJ = "(?:(?:the\\s+)?(?:letters?|digits?|characters?|symbols?|items?|elements?|objects?|they|it)\\s+)?";

const WITH_REP_SRC =
  `\\b${PFX}(?:${SUBJ}(?:with\\s+(?:repetition|repeats?|replacement)|(?:repetition|repeats?|repeated\\s+(?:letters|digits)|reuse)\\s+(?:is\\s+|are\\s+)?(?:allowed|permitted|ok|possible)|(?:may|can|could)\\s+(?:be\\s+)?(?:repeated|repeat|reused)|allowing\\s+(?:repetition|repeats)))\\b`;
const WITHOUT_REP_SRC =
  `\\b${PFX}(?:${SUBJ}(?:without\\s+(?:repetition|repeating|repeats?|replacement)|no\\s+(?:repetition|repeats)|(?:may\\s+not|cannot|can't|must\\s+not|are\\s+not|is\\s+not|not)\\s+(?:be\\s+)?(?:repeated|repeat|reused)|no\\s+(?:letter|digit|character|symbol)\\s+(?:is\\s+|may\\s+be\\s+|can\\s+be\\s+)?(?:used|repeated|reused)(?:\\s+(?:more\\s+than\\s+once|twice))?|(?:all\\s+)?(?:are\\s+)?(?:distinct|different)|(?:is\\s+|are\\s+)?used\\s+(?:at\\s+most|only)\\s+once|each\\s+(?:letter|digit|character|symbol)\\s+(?:is\\s+)?used\\s+(?:at\\s+most\\s+|only\\s+)?once))\\b`;
const UNORDERED_SRC = `\\b${PFX}(?:order\\s+(?:does\\s+not|doesn't|does\\s+n't|is\\s+not|isn't|is\\s+n't)\\s+(?:matter|count)|order\\s+is\\s+(?:irrelevant|unimportant|ignored)|unordered|regardless\\s+of\\s+(?:the\\s+)?order|without\\s+regard\\s+to\\s+order|order\\s+ignored)\\b`;
const ORDERED_SRC = `\\b${PFX}(?:order\\s+(?:matters|counts|is\\s+important|is\\s+relevant)|in\\s+order|ordered)\\b`;
const AT_LEAST_ONE_SRC =
  `\\b${PFX}(?:(?:each|every)\\s+[a-z]+\\s+(?:[a-z]+\\s+){0,3}?at\\s+least\\s+1(?:\\s+[a-z]+)?|at\\s+least\\s+1\\s+(?:[a-z]+\\s+)?(?:in|per|to|for)\\s+(?:each|every)(?:\\s+[a-z]+)?|no\\s+[a-z]+\\s+(?:is\\s+|are\\s+|remains\\s+|left\\s+|stays\\s+|may\\s+be\\s+|can\\s+be\\s+)?empty|non-?empty|none\\s+(?:is\\s+|are\\s+)?empty)\\b`;

const WITH_REP_RE = new RegExp(WITH_REP_SRC);
const WITHOUT_REP_RE = new RegExp(WITHOUT_REP_SRC);
const UNORDERED_RE = new RegExp(UNORDERED_SRC);
const ORDERED_RE = new RegExp(ORDERED_SRC);
const AT_LEAST_ONE_RE = new RegExp(AT_LEAST_ONE_SRC);
/** "must be chosen" / "must be arranged" is an auxiliary verb, not a condition. */
const AUX_MUST_SRC = "\\bmust\\s+(?:be\\s+)?(?:chosen|selected|picked|drawn|formed|made|arranged|seated|placed|distributed|elected|appointed|filled|ordered|lined\\s+up)\\b";
const CONSUMED_RES = [WITHOUT_REP_SRC, WITH_REP_SRC, UNORDERED_SRC, ORDERED_SRC, AT_LEAST_ONE_SRC, AUX_MUST_SRC].map((s) => new RegExp(s, "g"));

/** Words that signal a condition the plain formulas do not model. */
const CONSTRAINT_RE =
  /\b(?:if|such\s+that|so\s+that|provided|given|where|unless|except|but|must|at\s+least|at\s+most|exactly|no|none|nor|neither|together|adjacent|next\s+to|apart|separated|not|never|only|same|particular|specific|certain|always|cannot|can't|without|including|includes|include|excluding|contains?|containing|vowels?|consonants?|even|odd|begins?|beginning|starts?|starting|ends?|ending|finish\w*|preceded|followed|first|last|and\s+(?:then\s+)?(?:seat\w*|form\w*|give\w*|assign\w*|rank\w*|arrang\w*|choose|select\w*|pick\w*|appoint\w*|elect\w*|a\s+(?:captain|leader|winner))|beside|opposite|alternat\w*|more\s+than|fewer\s+than|less\s+than|greater\s+than|refuses?|won't|will\s+not|sit\s+next|married|couples?|twins?)\b/;

/** The sentence with every modelled modifier clause blanked out. */
export function stripModelledClauses(t: string): string {
  let residual = t;
  for (const re of CONSUMED_RES) residual = residual.replace(re, " ");
  return residual;
}

/** The first unmodelled condition word in the sentence, or null. */
export function findUnmodelledCondition(t: string): string | null {
  const m = stripModelledClauses(t).match(CONSTRAINT_RE);
  return m ? m[0] : null;
}

/** Container nouns stars-and-bars will accept — distinguishable recipients.
 *  "groups" / "teams" / "parts" are NOT here: those are unlabelled, a different count. */
const CONTAINER_RE = /^(?:box(?:es)?|bins?|urns?|cells?|containers?|bags?|baskets?|jars?|buckets?|drawers?|shelves|shelf|slots?|piles?|pockets?|envelopes?|cups?|plates?|people|persons?|children|child|kids?|friends?|students?|recipients?|players?|members?|days?|machines?|servers?|processors?)$/;

// Word-problem patterns. `t` has number words as digits and is lower-cased;
// `lower` is the same text with the number words intact (for letter extraction).
function parseProse(lower: string, tRaw: string): DiscreteResult | null {
  let m: RegExpMatchArray | null;
  const t = tRaw.replace(/,/g, " ").replace(/\s+/g, " ");
  // The integers that remain once the modelled clauses ("each box at least
  // one") are removed: a rule may only answer when EXACTLY the numbers its
  // formula uses are present — "choose 3 of 10 and 2 of 5" is not "choose 3 of 10".
  const ints = (stripModelledClauses(t).match(/\d+/g) ?? []).map(num);

  // A prose rule that matches is only allowed to answer when the sentence
  // carries no condition the formula ignores; otherwise refuse by name. The
  // condition check runs BEFORE the integer count so a conditioned sentence
  // gets a refusal that quotes the condition rather than a bare null.
  const condition = findUnmodelledCondition(t);
  const refuseCondition = (): void => {
    if (condition !== null) {
      refuse(`This sentence has a condition ("${condition}") that the plain counting formulas here do not model — the count without that condition would be wrong. This engine answers the unconditioned forms only (choose k of n, arrange, committee, letters of a word, k-letter words with/without repetition, identical balls into boxes, round table, named offices, subsets).`);
    }
  };
  /** True when the sentence has exactly `expected` free integers; throws on a condition. */
  const guard = (expected: number): boolean => {
    refuseCondition();
    return ints.length === expected;
  };
  const claim = (fn: () => DiscreteResult): DiscreteResult => {
    refuseCondition();
    return fn();
  };

  // 1. k-letter words from an alphabet of b letters (needs with/without repetition).
  if (
    (m = t.match(
      /\b(\d+)[- ](?:letter|digit|character|symbol)\s+(?:words?|strings?|codes?|passwords?|sequences?|pins?|numbers?|plates?|labels?)?\b.*?\b(?:from|using|out of|over|with|drawn from)\s+(?:an?\s+|the\s+)?(?:alphabet\s+of\s+|set\s+of\s+|pool\s+of\s+)?(\d+)\s+(?:distinct\s+|different\s+)?(?:letters?|digits?|characters?|symbols?)\b/,
    ))
  ) {
    if (!guard(2)) return null;
    const k = num(m[1]);
    const b = num(m[2]);
    const without = WITHOUT_REP_RE.test(t);
    const withRep = WITH_REP_RE.test(t);
    const label = `${fmtN(k)}-letter words from ${fmtN(b)} letters`;
    if (without) {
      return claim(() => buildPermutation(b, k, `Order matters (the same letters in a different order make a different word) and nothing is repeated, so this is a permutation: P(${fmtN(b)}, ${fmtN(k)}).`, `${label} (without repetition)`));
    }
    if (withRep) {
      return claim(() => buildPower(b, k, `Order matters and each of the ${fmtN(k)} positions can take any of the ${fmtN(b)} letters independently, so the counts multiply: ${fmtN(b)}^${fmtN(k)}.`, `${label} (with repetition)`));
    }
    refuse(`"${fmtN(k)}-letter words from ${fmtN(b)} letters" has two answers: ${fmtN(b)}^${fmtN(k)} if letters may repeat, P(${fmtN(b)}, ${fmtN(k)}) if not. Add "with repetition" or "without repetition".`);
  }

  // 2. Letters of a word (multiset permutations).
  if (/\b(?:arrang|rearrang|permut|anagram|order|ways|distinct|different)/.test(lower)) {
    const w = lower.match(/\bletters\s+(?:of|in)\s+(?:the\s+)?(?:word\s+)?["'“”‘’]?([a-z]+)["'“”‘’]?/);
    if (w && !/^(?:alphabet|english|a|an|the)$/.test(w[1])) {
      // "arrange 4 of the letters of MISSISSIPPI" is a different count: no free integers allowed.
      if (!guard(0)) return null;
      return claim(() => buildMultiset(w[1], `The letters are arranged in order but repeated letters are indistinguishable, so this is a multiset permutation: n! divided by the factorial of each letter's count.`));
    }
  }

  // 3. Stars and bars: distribute n identical things into k distinct boxes.
  const starsA = t.match(/\b(?:distribute|distributing|put|putting|place|placing|divide|dividing|share|sharing|split|splitting|give|giving|allocate|allocating|drop|dropping)\s+(\d+)\s+(?:(identical|indistinguishable|distinct|different|distinguishable|labell?ed)\s+)?([a-z]+)\s+(?:into|among|between|to|in|amongst)\s+(\d+)\s+(?:(identical|indistinguishable|distinct|different|distinguishable|labell?ed)\s+)?([a-z]+)\b/);
  const starsB = t.match(/\b(\d+)\s+(?:(identical|indistinguishable|distinct|different|distinguishable|labell?ed)\s+)?([a-z]+)\s+(?:can\s+|could\s+|could\s+be\s+|to\s+)?be\s+(?:distributed|placed|put|divided|shared|split|allocated|dropped)\s+(?:into|among|between|amongst|in|to)\s+(\d+)\s+(?:(identical|indistinguishable|distinct|different|distinguishable|labell?ed)\s+)?([a-z]+)\b/);
  const stars = starsA ?? starsB;
  if (stars && CONTAINER_RE.test(stars[6])) {
    if (!guard(2)) return null;
    const n = num(stars[1]);
    const thingAdj = stars[2];
    const things = stars[3];
    const k = num(stars[4]);
    const boxAdj = stars[5];
    const boxes = stars[6];
    const sameKind = (a?: string): boolean => a === "identical" || a === "indistinguishable";
    const distinctKind = (a?: string): boolean => a === "distinct" || a === "different" || a === "distinguishable" || a === "labeled" || a === "labelled";
    if (sameKind(boxAdj)) {
      refuse(`Distributing into IDENTICAL ${boxes} is a partition-counting problem (partitions of ${fmtN(n)} into at most ${fmtN(k)} parts), not stars and bars — this engine does not count it. Say "distinct ${boxes}" if the ${boxes} are distinguishable.`);
    }
    if (!thingAdj) {
      refuse(`Say whether the ${fmtN(n)} ${things} are identical or distinct: identical ${things} into ${fmtN(k)} distinct ${boxes} is stars and bars, C(n + k − 1, k − 1); distinct ${things} is ${fmtN(k)}^${fmtN(n)}.`);
    }
    const atLeastOne = AT_LEAST_ONE_RE.test(t);
    if (distinctKind(thingAdj)) {
      if (atLeastOne) return claim(() => buildSurjections(n, k, things, boxes));
      return claim(() => buildPower(k, n, `The ${things} are distinct, so each of the ${fmtN(n)} ${things} independently picks one of the ${fmtN(k)} ${boxes}: ${fmtN(k)}^${fmtN(n)}.`, `${fmtN(n)} distinct ${things} into ${fmtN(k)} ${boxes}`));
    }
    return claim(() => buildStarsAndBars(n, k, atLeastOne, things, boxes));
  }

  // 4. Round table / circle: exactly one integer in the sentence.
  if (/\b(?:around|round|at)\s+(?:a|the)\s+(?:round|circular)\s+table\b|\bin\s+a\s+circle\b|\baround\s+(?:a|the)\s+table\b|\bcircular\s+(?:arrangements?|permutations?|seating)\b|\bround\s+table\b/.test(t)) {
    if (guard(1)) {
      return claim(() => buildCircular(ints[0], `Seatings that differ only by rotating everyone are the same, so fix one person and arrange the rest: (n − 1)!.`));
    }
    return null;
  }

  // 5. Named offices: president and vice-president from n.
  const roleRe = /\b(vice[- ]?president|president|vice[- ]?chair(?:man|person|woman)?|chair(?:man|person|woman)?|secretary|treasurer|captain|co-captain|leader|manager|coach|director|goalkeeper|spokesperson)\b/g;
  const roles = new Set<string>();
  for (const r of t.matchAll(roleRe)) roles.add(r[1].replace(/[- ]/g, ""));
  if (roles.size >= 2 && /\b(?:choose|chosen|select|selected|pick|picked|elect|elected|appoint|appointed|fill|filled|ways)\b/.test(t)) {
    if (guard(1)) {
      const n = ints[0];
      const k = roles.size;
      const list = [...roles].join(", ");
      return claim(() => buildPermutation(n, k, `The ${fmtN(k)} offices (${list}) are different, so who gets which matters: order matters and no one holds two offices, so this is a permutation P(${fmtN(n)}, ${fmtN(k)}).`, `${fmtN(k)} distinct offices from ${fmtN(n)} people`));
    }
    return null;
  }
  if ((m = t.match(/\b(?:fill|filling|assign|assigning)\s+(\d+)\s+(?:distinct\s+|different\s+)?(?:positions|offices|posts|roles|jobs)\s+(?:from|out of|with|using)\s+(?:a\s+(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/))) {
    if (!guard(2)) return null;
    const k = num(m[1]);
    const n = num(m[2]);
    return claim(() => buildPermutation(n, k, `The ${fmtN(k)} positions are different, so who gets which matters and no one takes two: this is a permutation P(${fmtN(n)}, ${fmtN(k)}).`, `${fmtN(k)} distinct positions from ${fmtN(n)}`));
  }

  // 6. Committee of k from n.
  if (
    (m = t.match(/\bcommittees?\s+of\s+(\d+)\s+(?:[a-z]+\s+){0,5}?(?:from|out of)\s+(?:a\s+(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/)) ||
    (m = t.match(/\b(\d+)[- ](?:person|member|people|student|man|woman)\s+committee\s+(?:[a-z]+\s+){0,4}?(?:from|out of|of)\s+(?:a\s+(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/))
  ) {
    if (!guard(2)) return null;
    const k = num(m[1]);
    const n = num(m[2]);
    return claim(() => buildBinomial(n, k, `A committee has no order among its members and nobody is chosen twice, so this is a combination C(${fmtN(n)}, ${fmtN(k)}).`, `Committee of ${fmtN(k)} from ${fmtN(n)}`));
  }

  // 7. Subsets of a set (whole power set, or subsets of a given size).
  if ((m = t.match(/\b(\d+)[- ](?:element|member)\s+subsets?\s+(?:of|from|does|can|in|has)\s+(?:a|an|the)?\s*(?:set\s+(?:of|with)\s+)?(\d+)/)) || (m = t.match(/\bsubsets?\s+(?:of\s+size|of\s+cardinality|with|having|containing)\s+(\d+)\s+(?:elements?\s+|members?\s+)?(?:from|of|in)\s+(?:a|an|the)?\s*(?:set\s+(?:of|with)\s+)?(\d+)/))) {
    if (!guard(2)) return null;
    const k = num(m[1]);
    const n = num(m[2]);
    return claim(() => buildBinomial(n, k, `A subset has no order among its elements and no repeats, so this is a combination C(${fmtN(n)}, ${fmtN(k)}).`, `${fmtN(k)}-element subsets of a ${fmtN(n)}-element set`));
  }
  if (/\b(?:subsets?|power\s*set|powerset)\b/.test(t) && guard(1)) {
    if (/\b(\d+)[- ]element\s+set\b|\bset\s+(?:with|of|containing|having)\s+(\d+)\s+(?:elements?|members?|items?|objects?)\b|\bsubsets\s+of\s+(?:a\s+)?(?:set\s+of\s+)?(\d+)\b/.test(t)) {
      return claim(() => buildPowerSet(ints[0], `Every element is independently in or out of a subset, so a ${fmtN(ints[0])}-element set has 2^${fmtN(ints[0])} subsets (the empty set and the whole set included).`));
    }
    return null;
  }

  // 8. Choose k of n (combination, or permutation when order is flagged).
  const chooseA = t.match(/\b(?:choose|choosing|select|selecting|pick|picking|take|taking|draw|drawing|chosen|selected|picked|drawn|taken|invite|inviting)\s+(?:a\s+(?:group|set|sample|subset|hand|team|committee|delegation)\s+of\s+)?(\d+)\s+(?:[a-z]+\s+){0,3}?(?:from|out of|of|among|amongst)\s+(?:a\s+(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/);
  const chooseB = t.match(/\b(\d+)\s+(?:[a-z]+\s+){0,2}?(?:can\s+|could\s+|to\s+|must\s+|will\s+|are\s+to\s+|is\s+to\s+)?be\s+(?:chosen|selected|picked|drawn|taken|invited)\s+(?:from|out of|among|amongst)\s+(?:a\s+(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/);
  const chooseC = t.match(/\b(\d+)[- ](?:card|element|person|member|people|item|object|book|ball)\s+(?:hands?|subsets?|teams?|groups?|samples?|committees?|selections?|collections?)\s+(?:[a-z]+\s+){0,2}?(?:from|out of|of)\s+(?:a\s+)?(?:(?:[a-z]+\s+){0,2}?of\s+)?(?:the\s+)?(\d+)\b/);
  const choose = chooseA ?? chooseB ?? chooseC;
  if (choose) {
    if (!guard(2)) return null;
    const k = num(choose[1]);
    const n = num(choose[2]);
    const ordered = (ORDERED_RE.test(t) || /\barrang|\bline\s+up\b|\brank/.test(t)) && !UNORDERED_RE.test(t);
    const withRep = WITH_REP_RE.test(t);
    if (withRep) {
      if (ordered) return claim(() => buildPower(n, k, `Order matters and each pick is independent (repetition allowed), so the counts multiply: ${fmtN(n)}^${fmtN(k)}.`, `${fmtN(k)} ordered picks from ${fmtN(n)} with repetition`));
      return claim(() => buildBinomial(n + k - 1, k, `Order does not matter but items may repeat, so this counts multisets of size ${fmtN(k)} from ${fmtN(n)} kinds: C(n + k − 1, k) = C(${fmtN(n + k - 1)}, ${fmtN(k)}).`, `Multisets of ${fmtN(k)} from ${fmtN(n)} (with repetition)`));
    }
    if (ordered) {
      return claim(() => buildPermutation(n, k, `Order matters and nothing is repeated, so this is a permutation P(${fmtN(n)}, ${fmtN(k)}).`, `Ordered selections of ${fmtN(k)} from ${fmtN(n)}`));
    }
    return claim(() => buildBinomial(n, k, `Order does not matter and nothing is repeated, so this is a combination C(${fmtN(n)}, ${fmtN(k)}).`, `Choose ${fmtN(k)} of ${fmtN(n)}`));
  }

  // 9. Arrangements: k of n in order (P), or all n in a row (n!).
  {
    let k = -1;
    let n = -1;
    if ((m = t.match(/\b(?:arrange|arranging|line\s+up|lining\s+up|seat|seating|rank|ranking|order)\s+(\d+)\s+(?:[a-z]+\s+){0,2}?(?:of|from|out of)\s+(?:the\s+)?(\d+)\b/))) {
      k = num(m[1]);
      n = num(m[2]);
    } else if ((m = t.match(/\b(\d+)\s+(?:[a-z]+\s+)?taken\s+(\d+)\s+at\s+a\s+time\b/))) {
      n = num(m[1]);
      k = num(m[2]);
    }
    if (n >= 0 && k >= 0) {
      if (!guard(2)) return null;
      return claim(() => buildPermutation(n, k, `Order matters (an arrangement is an ordered list) and nothing is repeated, so this is a permutation P(${fmtN(n)}, ${fmtN(k)}).`, `Arrange ${fmtN(k)} of ${fmtN(n)}`));
    }
  }
  if (
    (m = t.match(/\b(?:arrange|arranging|line\s+up|lining\s+up|seat|seating|rank|ranking|permute|shuffle|shuffling)\s+(?:all\s+)?(?:the\s+)?(\d+)\s+(?:distinct\s+|different\s+)?[a-z]+\b/)) ||
    (m = t.match(/\b(\d+)\s+(?:distinct\s+|different\s+)?[a-z]+\s+(?:can\s+|could\s+|to\s+|must\s+|will\s+)?(?:be\s+)?(?:arranged|ordered|lined\s+up|seated|ranked|placed\s+in\s+(?:a\s+)?(?:row|line|order)|stand\s+in\s+(?:a\s+)?(?:row|line)|sit\s+in\s+(?:a\s+)?(?:row|line)|line\s+up)\b/)) ||
    (m = t.match(/\b(?:arrangements|orderings|permutations|orders)\s+of\s+(?:the\s+)?(\d+)\s+(?:distinct\s+|different\s+)?[a-z]+\b/))
  ) {
    if (guard(1)) {
      const n = num(m[1]);
      return claim(() => buildFactorial(n, `All ${fmtN(n)} items are placed in order and each is used once, so this is a permutation of the whole set: ${fmtN(n)}!.`, `Arrangements of ${fmtN(n)}`));
    }
    return null;
  }

  return null;
}
