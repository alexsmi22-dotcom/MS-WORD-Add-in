// Elementary number theory — exact, in BigInt, with the working shown.
//
// What a student actually types: gcd 84 36 · 7^100 mod 13 · inverse 3 mod 7 ·
// 3x ≡ 2 mod 7 · x ≡ 2 mod 3, x ≡ 3 mod 5 · factor 360 · is 97 prime ·
// primes to 100 · phi 36 · divisors 36 · order of 2 mod 7 · primitive root
// mod 7 · jacobi 5 21 · sqrt 2 mod 7 · 255 in binary.
//
// HONESTY RULES SPECIFIC TO THIS FILE.
// - Primality: Miller–Rabin with the first thirteen prime bases is a PROOF
//   below 3.3 × 10²⁴ (Sorenson–Webster); above that the same test is a
//   probable-prime verdict and is labelled as one. Nothing here says "prime"
//   about a large number without that label.
// - Factoring: trial division then Pollard's rho (Brent), under a budget.
//   A cofactor the budget did not split is reported as "not factored within
//   the budget" — it is never called prime, and the product check still has
//   to multiply back to n.
// - Every answer that can be checked is: Bézout coefficients are multiplied
//   back, an inverse is multiplied back, a CRT solution is reduced against
//   every congruence, a modular power is recomputed by a second route, an
//   order is confirmed minimal by construction.

import { DiscreteResult, DiscreteError } from "./discrete";

const MAX_DIGITS = 4000;
const SIEVE_MAX = 1_000_000;
const LIST_SHOWN = 400;
const TRIAL_LIMIT = 100_000n;
const RHO_BUDGET = 150_000;

// ---------------------------------------------------------------------------
// Formatting

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: bigint | number): string => String(n).split("").map((d) => (d === "-" ? "⁻" : SUP[Number(d)])).join("");
/** Thousands separators; a huge number is cut with its digit count. */
export function fmt(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString();
  if (s.length > 60) return `${neg ? "−" : ""}${s.slice(0, 20)}…${s.slice(-10)} (${s.length} digits)`;
  return (neg ? "−" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------------------------------
// Core arithmetic

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function egcd(a: bigint, b: bigint): { g: bigint; s: bigint; t: bigint } {
  let [r0, r1] = [a, b];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 < 0n) { r0 = -r0; s0 = -s0; t0 = -t0; }
  return { g: r0, s: s0, t: t0 };
}

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

export function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  let result = 1n;
  base = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % m;
    base = (base * base) % m;
    e >>= 1n;
  }
  return result;
}

export function modInverse(a: bigint, m: bigint): bigint | null {
  const { g, s } = egcd(mod(a, m), m);
  return g === 1n ? mod(s, m) : null;
}

/** Floor square root by Newton's method from an OVER-estimate, so the
 *  iteration descends monotonically and needs no linear correction. (A
 *  float seed is off by ~10⁹ above 2¹⁰⁶ and a step-by-step walk from it took
 *  eleven seconds on a 57-digit input.) */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2)); // ≥ √n
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
/** Below this, the thirteen bases are a deterministic proof. */
export const MR_DETERMINISTIC_BOUND = 3317044064679887385961981n;

export interface PrimalityVerdict {
  prime: boolean;
  /** true when the verdict is a proof, false when "probable prime". */
  certain: boolean;
  /** For composites: a factor if one was found cheaply, else a witness base. */
  factor?: bigint;
  witness?: bigint;
}

export function isPrime(n: bigint): PrimalityVerdict {
  if (n < 2n) return { prime: false, certain: true };
  for (const p of MR_BASES) {
    if (n === p) return { prime: true, certain: true };
    if (n % p === 0n) return { prime: false, certain: true, factor: p };
  }
  let d = n - 1n;
  let r = 0;
  while ((d & 1n) === 0n) { d >>= 1n; r++; }
  for (const a of MR_BASES) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return { prime: false, certain: true, witness: a };
  }
  return { prime: true, certain: n < MR_DETERMINISTIC_BOUND };
}

/** Pollard's rho (Brent's cycle finding) under an iteration budget. */
function rho(n: bigint, budget: { left: number }): bigint | null {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 20n; c++) {
    let y = 2n, x = 2n, g = 1n, q = 1n, ys = 2n;
    let r = 1;
    const f = (v: bigint): bigint => (v * v + c) % n;
    outer: while (g === 1n) {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      let k = 0;
      while (k < r && g === 1n) {
        ys = y;
        const lim = Math.min(128, r - k);
        for (let i = 0; i < lim; i++) {
          y = f(y);
          const diff = x > y ? x - y : y - x;
          q = (q * diff) % n;
          if (--budget.left <= 0) return null;
        }
        g = gcd(q, n);
        k += lim;
        if (budget.left <= 0) break outer;
      }
      r *= 2;
    }
    if (g === n) {
      // Backtrack one step at a time.
      do {
        ys = f(ys);
        const diff = x > ys ? x - ys : ys - x;
        g = gcd(diff, n);
        if (--budget.left <= 0) return null;
      } while (g === 1n);
    }
    if (g !== n && g !== 1n) return g;
    if (budget.left <= 0) return null;
  }
  return null;
}

export interface Factorization {
  /** prime → exponent, in increasing order of prime. */
  factors: [bigint, number][];
  /** A cofactor the budget could not split (composite, unfactored). */
  unfactored?: bigint;
}

export function factorize(n: bigint): Factorization {
  if (n < 1n) throw new DiscreteError("Factorisation is defined for positive integers.");
  const factors = new Map<bigint, number>();
  const bump = (p: bigint): void => { factors.set(p, (factors.get(p) ?? 0) + 1); };
  let m = n;
  for (let p = 2n; p <= TRIAL_LIMIT && p * p <= m; p += p === 2n ? 1n : 2n) {
    while (m % p === 0n) { bump(p); m /= p; }
  }
  const budget = { left: RHO_BUDGET };
  const stack: bigint[] = m > 1n ? [m] : [];
  let unfactored: bigint | undefined;
  while (stack.length) {
    const v = stack.pop() as bigint;
    if (v === 1n) continue;
    const pv = isPrime(v);
    if (pv.prime) { bump(v); continue; }
    if (pv.factor) { bump(pv.factor); stack.push(v / pv.factor); continue; }
    // Perfect powers first: rho fails on p^2.
    const root = isqrt(v);
    if (root * root === v) { stack.push(root, root); continue; }
    const d = rho(v, budget);
    if (d === null) { unfactored = unfactored ? unfactored * v : v; continue; }
    stack.push(d, v / d);
  }
  const list = [...factors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return unfactored ? { factors: list, unfactored } : { factors: list };
}

function showFactorization(f: Factorization): string {
  const parts = f.factors.map(([p, e]) => (e === 1 ? fmt(p) : `${fmt(p)}${sup(e)}`));
  if (f.unfactored) parts.push(`${fmt(f.unfactored)} (composite, not factored within the budget)`);
  return parts.length ? parts.join(" × ") : "1";
}

export function totientFrom(f: Factorization): bigint | null {
  if (f.unfactored) return null;
  let phi = 1n;
  for (const [p, e] of f.factors) phi *= (p - 1n) * p ** BigInt(e - 1);
  return phi;
}

export function divisorsFrom(f: Factorization): bigint[] | null {
  if (f.unfactored) return null;
  let divs = [1n];
  for (const [p, e] of f.factors) {
    const next: bigint[] = [];
    let pk = 1n;
    for (let k = 0; k <= e; k++) {
      for (const d of divs) next.push(d * pk);
      pk *= p;
    }
    divs = next;
  }
  return divs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function sieve(limit: number): number[] {
  const flags = new Uint8Array(limit + 1);
  const out: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (flags[i]) continue;
    out.push(i);
    for (let j = i * i; j <= limit; j += i) flags[j] = 1;
  }
  return out;
}

/** Multiplicative order of a mod m (gcd must be 1). */
export function multiplicativeOrder(a: bigint, m: bigint): bigint | null {
  if (m < 2n) return null;
  a = mod(a, m);
  if (gcd(a, m) !== 1n) return null;
  const fm = factorize(m);
  const phi = totientFrom(fm);
  if (phi === null) return null;
  const fphi = factorize(phi);
  if (fphi.unfactored) return null;
  // Start from φ(m) and strip every prime factor that still leaves a^k ≡ 1.
  let k = phi;
  for (const [p] of fphi.factors) {
    while (k % p === 0n && modPow(a, k / p, m) === 1n) k /= p;
  }
  return k;
}

/** Jacobi symbol (a/n), n odd positive. */
export function jacobi(a: bigint, n: bigint): number {
  if (n <= 0n || n % 2n === 0n) throw new DiscreteError("The Jacobi symbol (a/n) needs an odd positive n.");
  a = mod(a, n);
  let result = 1;
  while (a !== 0n) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) result = -result;
    }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) result = -result;
    a = a % n;
  }
  return n === 1n ? result : 0;
}

/** Tonelli–Shanks: x with x² ≡ a (mod p), p an odd prime. */
export function sqrtMod(a: bigint, p: bigint): bigint | null {
  a = mod(a, p);
  if (a === 0n) return 0n;
  if (p === 2n) return a;
  if (modPow(a, (p - 1n) / 2n, p) !== 1n) return null;
  if (p % 4n === 3n) return modPow(a, (p + 1n) / 4n, p);
  let q = p - 1n;
  let s = 0n;
  while (q % 2n === 0n) { q /= 2n; s++; }
  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) z++;
  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(a, q, p);
  let r = modPow(a, (q + 1n) / 2n, p);
  while (t !== 1n) {
    let i = 0n;
    let tt = t;
    while (tt !== 1n) { tt = (tt * tt) % p; i++; if (i === m) return null; }
    let b = c;
    for (let j = 0n; j < m - i - 1n; j++) b = (b * b) % p;
    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Parsing helpers

const INT = String.raw`-?\d+`;
function big(s: string): bigint {
  const clean = s.replace(/[,_\s]/g, "");
  if (clean.replace("-", "").length > MAX_DIGITS) throw new DiscreteError(`${clean.slice(0, 12)}… has more than ${MAX_DIGITS} digits, which is the cap here.`);
  return BigInt(clean);
}
function positive(n: bigint, what: string): bigint {
  if (n <= 0n) throw new DiscreteError(`${what} must be a positive integer (got ${fmt(n)}).`);
  return n;
}
function toNum(n: bigint, cap: number, what: string): number {
  if (n > BigInt(cap)) throw new DiscreteError(`${what} is capped at ${cap.toLocaleString("en-US")} (got ${fmt(n)}).`);
  return Number(n);
}

function result(title: string, display: string[], steps: string[] = [], caveats: string[] = []): DiscreteResult {
  return { title, display, steps, caveats };
}

// ---------------------------------------------------------------------------
// Engines, one per surface form

function euclidSteps(a: bigint, b: bigint): string[] {
  const steps: string[] = [];
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  if (x < y) [x, y] = [y, x];
  let n = 0;
  while (y !== 0n && n < 60) {
    const q = x / y;
    const r = x % y;
    steps.push(`${fmt(x)} = ${fmt(q)} × ${fmt(y)} + ${fmt(r)}`);
    [x, y] = [y, r];
    n++;
  }
  if (y !== 0n) steps.push("… (further steps not listed)");
  return steps;
}

function doGcd(nums: bigint[], lcm: boolean): DiscreteResult {
  if (nums.some((n) => n === 0n) && lcm) throw new DiscreteError("lcm with 0 is 0 by convention, but it carries no information — give non-zero integers.");
  let g = nums[0];
  for (const n of nums.slice(1)) g = gcd(g, n);
  if (lcm) {
    let l = nums[0] < 0n ? -nums[0] : nums[0];
    for (const n of nums.slice(1)) l = (l / gcd(l, n)) * (n < 0n ? -n : n);
    const steps = nums.length === 2 ? [`lcm(a, b) = |a·b| / gcd(a, b) = ${fmt((nums[0] < 0n ? -nums[0] : nums[0]) * (nums[1] < 0n ? -nums[1] : nums[1]))} / ${fmt(g)}`, ...euclidSteps(nums[0], nums[1]).map((s) => "gcd: " + s)] : [`gcd(${nums.map(fmt).join(", ")}) = ${fmt(g)}; the lcm is accumulated pairwise, lcm(x, y) = x·y / gcd(x, y).`];
    return result("Least common multiple", [`lcm(${nums.map(fmt).join(", ")}) = ${fmt(l)}`], steps);
  }
  const display = [`gcd(${nums.map(fmt).join(", ")}) = ${fmt(g)}`];
  const steps = euclidSteps(nums[0], nums[1]);
  const caveats: string[] = [];
  if (nums.length === 2) {
    const { g: g2, s, t } = egcd(nums[0], nums[1]);
    const check = nums[0] * s + nums[1] * t;
    display.push(`Bézout: ${fmt(nums[0])} × (${fmt(s)}) + ${fmt(nums[1])} × (${fmt(t)}) = ${fmt(check)}`);
    if (check !== g2 || g2 !== g) caveats.push("CROSS-CHECK FAILED: the Bézout identity does not multiply back to the gcd — a defect in this tool.");
    else steps.push("Verified: the Bézout coefficients multiply back to the gcd.");
    if (g === 1n) display.push(`${fmt(nums[0])} and ${fmt(nums[1])} are coprime.`);
  } else {
    steps.push(`Then gcd of that result with each further number in turn: ${fmt(g)}.`);
  }
  return result("Greatest common divisor", display, steps, caveats);
}

function doMod(a: bigint, m: bigint): DiscreteResult {
  positive(m, "The modulus");
  const r = mod(a, m);
  const q = (a - r) / m;
  return result("Remainder", [`${fmt(a)} mod ${fmt(m)} = ${fmt(r)}`], [`${fmt(a)} = ${fmt(q)} × ${fmt(m)} + ${fmt(r)}, with 0 ≤ ${fmt(r)} < ${fmt(m)} (the least non-negative residue, so a negative dividend still gives a non-negative remainder).`]);
}

function doPow(a: bigint, e: bigint, m: bigint): DiscreteResult {
  positive(m, "The modulus");
  if (e < 0n) {
    const inv = modInverse(a, m);
    if (inv === null) throw new DiscreteError(`${fmt(a)}${sup(e)} mod ${fmt(m)} needs an inverse of ${fmt(a)}, and gcd(${fmt(a)}, ${fmt(m)}) ≠ 1, so none exists.`);
    const r = modPow(inv, -e, m);
    return result("Modular power", [`${fmt(a)}${sup(e)} ≡ ${fmt(r)} (mod ${fmt(m)})`], [`${fmt(a)}⁻¹ ≡ ${fmt(inv)} (mod ${fmt(m)}), then raised to the ${fmt(-e)}.`]);
  }
  const r = modPow(a, e, m);
  // Square-and-multiply, shown, for the binary expansion of e.
  const bits = e.toString(2);
  const steps: string[] = [`e = ${fmt(e)} = ${bits.length > 64 ? bits.slice(0, 64) + "…" : bits}₂ — square-and-multiply, left to right:`];
  let acc = 1n;
  const base = mod(a, m);
  const shown = Math.min(bits.length, 40);
  for (let i = 0; i < bits.length; i++) {
    const before = acc;
    acc = (acc * acc) % m;
    const sq = acc;
    if (bits[i] === "1") acc = (acc * base) % m;
    if (i < shown) steps.push(`bit ${bits[i]}: ${fmt(before)}² ≡ ${fmt(sq)}${bits[i] === "1" ? `, × ${fmt(base)} ≡ ${fmt(acc)}` : ""} (mod ${fmt(m)})`);
  }
  if (bits.length > shown) steps.push(`… ${bits.length - shown} more bits.`);
  const caveats: string[] = [];
  if (acc !== r) caveats.push("CROSS-CHECK FAILED: left-to-right and right-to-left exponentiation disagree — a defect in this tool.");
  else steps.push("Verified: left-to-right and right-to-left square-and-multiply agree.");
  const display = [`${fmt(a)}${sup(e)} ≡ ${fmt(r)} (mod ${fmt(m)})`];
  // Fermat / Euler shortcut, when it applies and is informative.
  const pm = m < 10n ** 30n ? isPrime(m) : null;
  if (pm && pm.prime && pm.certain && gcd(a, m) === 1n && e >= m - 1n) {
    const red = e % (m - 1n);
    display.push(`Fermat: ${fmt(m)} is prime and gcd = 1, so the exponent reduces mod ${fmt(m - 1n)}: ${fmt(a)}${sup(red)} ≡ ${fmt(modPow(a, red, m))}.`);
  }
  return result("Modular power", display, steps, caveats);
}

function doInverse(a: bigint, m: bigint): DiscreteResult {
  positive(m, "The modulus");
  const g = gcd(a, m);
  if (g !== 1n) throw new DiscreteError(`${fmt(a)} has no inverse mod ${fmt(m)}: gcd(${fmt(a)}, ${fmt(m)}) = ${fmt(g)} ≠ 1.`);
  const inv = modInverse(a, m) as bigint;
  const { s, t } = egcd(mod(a, m), m);
  const steps = euclidSteps(mod(a, m), m);
  steps.push(`Back-substitution gives ${fmt(mod(a, m))} × (${fmt(s)}) + ${fmt(m)} × (${fmt(t)}) = 1, so the inverse is ${fmt(s)} ≡ ${fmt(inv)} (mod ${fmt(m)}).`);
  const check = mod(a * inv, m);
  const caveats = check === 1n ? [] : ["CROSS-CHECK FAILED: a × a⁻¹ is not 1 — a defect in this tool."];
  if (!caveats.length) steps.push(`Verified: ${fmt(a)} × ${fmt(inv)} = ${fmt(a * inv)} ≡ 1 (mod ${fmt(m)}).`);
  return result("Modular inverse", [`${fmt(a)}⁻¹ ≡ ${fmt(inv)} (mod ${fmt(m)})`], steps, caveats);
}

function doLinearCongruence(a: bigint, b: bigint, m: bigint): DiscreteResult {
  positive(m, "The modulus");
  const g = gcd(a, m);
  const steps = [`gcd(${fmt(a)}, ${fmt(m)}) = ${fmt(g)}.`];
  if (mod(b, g) !== 0n) {
    return result("Linear congruence", [`${fmt(a)}x ≡ ${fmt(b)} (mod ${fmt(m)}) has NO solution.`], [...steps, `A solution exists only if the gcd divides ${fmt(b)}, and ${fmt(g)} does not.`]);
  }
  const a1 = a / g, b1 = b / g, m1 = m / g;
  const inv = modInverse(a1, m1) as bigint;
  const x0 = mod(b1 * inv, m1);
  const sols: bigint[] = [];
  const count = toNum(g, 10_000, "The number of solutions (the gcd)");
  for (let k = 0; k < Math.min(count, 50); k++) sols.push(x0 + BigInt(k) * m1);
  steps.push(`Divide through by the gcd: ${fmt(a1)}x ≡ ${fmt(b1)} (mod ${fmt(m1)}); ${fmt(a1)}⁻¹ ≡ ${fmt(inv)} (mod ${fmt(m1)}); x₀ = ${fmt(b1)} × ${fmt(inv)} ≡ ${fmt(x0)} (mod ${fmt(m1)}).`);
  const display = [
    `x ≡ ${fmt(x0)} (mod ${fmt(m1)})`,
    g === 1n ? "Exactly one solution mod the modulus." : `${fmt(g)} solutions mod ${fmt(m)}: ${sols.map(fmt).join(", ")}${count > 50 ? ", …" : ""}`,
  ];
  const bad = sols.filter((x) => mod(a * x - b, m) !== 0n);
  const caveats = bad.length ? ["CROSS-CHECK FAILED: a listed solution does not satisfy the congruence — a defect in this tool."] : [];
  if (!bad.length) steps.push("Verified: every listed solution satisfies the original congruence.");
  return result("Linear congruence", display, steps, caveats);
}

function doCrt(pairs: [bigint, bigint][]): DiscreteResult {
  for (const [, m] of pairs) positive(m, "Each modulus");
  // Garner-style pairwise merge, general (moduli need not be coprime).
  let r = mod(pairs[0][0], pairs[0][1]);
  let M = pairs[0][1];
  const steps: string[] = [`Start: x ≡ ${fmt(r)} (mod ${fmt(M)}).`];
  for (const [a, m] of pairs.slice(1)) {
    const g = gcd(M, m);
    if (mod(a - r, g) !== 0n) {
      return result("Chinese remainder theorem", ["NO solution: the congruences are incompatible."], [...steps, `x ≡ ${fmt(r)} (mod ${fmt(M)}) and x ≡ ${fmt(a)} (mod ${fmt(m)}) need ${fmt(r)} ≡ ${fmt(a)} (mod gcd = ${fmt(g)}), which fails.`]);
    }
    const lcm = (M / g) * m;
    const inv = modInverse(M / g, m / g) as bigint;
    const k = mod(((a - r) / g) * inv, m / g);
    r = mod(r + M * k, lcm);
    steps.push(`Combine with x ≡ ${fmt(a)} (mod ${fmt(m)})${g !== 1n ? ` (moduli share gcd ${fmt(g)}, compatible)` : ""}: x ≡ ${fmt(r)} (mod ${fmt(lcm)}).`);
    M = lcm;
  }
  const bad = pairs.filter(([a, m]) => mod(r - a, m) !== 0n);
  const caveats = bad.length ? ["CROSS-CHECK FAILED: the solution does not satisfy every congruence — a defect in this tool."] : [];
  if (!bad.length) steps.push("Verified: the solution satisfies every congruence given.");
  const coprime = pairs.every(([, m], i) => pairs.every(([, n], j) => i === j || gcd(m, n) === 1n));
  if (!coprime) caveats.push("The moduli are not pairwise coprime, so this is the general form of the theorem: the solution is unique mod their lcm, not mod their product.");
  return result("Chinese remainder theorem", [`x ≡ ${fmt(r)} (mod ${fmt(M)})`, `Smallest non-negative solution: ${fmt(r)}.`], steps, caveats);
}

function doFactor(n: bigint): DiscreteResult {
  positive(n, "The number");
  if (n.toString().length > 60) throw new DiscreteError("Factoring is attempted up to 60 digits; beyond that the budget would be spent on nothing.");
  const f = factorize(n);
  const display = [`${fmt(n)} = ${showFactorization(f)}`];
  const steps: string[] = [];
  const caveats: string[] = [];
  let prod = f.unfactored ?? 1n;
  for (const [p, e] of f.factors) prod *= p ** BigInt(e);
  if (prod !== n) caveats.push("CROSS-CHECK FAILED: the factors do not multiply back to n — a defect in this tool.");
  else steps.push("Verified: the factors multiply back to the number.");
  if (f.unfactored) {
    caveats.push(`${fmt(f.unfactored)} is composite (Miller–Rabin) but was not split within the budget (trial division to ${fmt(TRIAL_LIMIT)} then Pollard's rho, ${RHO_BUDGET.toLocaleString("en-US")} iterations). τ, σ and φ are therefore not given.`);
  } else {
    const divs = divisorsFrom(f) as bigint[];
    const sigma = divs.reduce((s, d) => s + d, 0n);
    const phi = totientFrom(f) as bigint;
    display.push(`τ(n) = ${divs.length} divisors · σ(n) = ${fmt(sigma)} · φ(n) = ${fmt(phi)}`);
    if (f.factors.length === 1 && f.factors[0][1] === 1) display.push(f.factors[0][0] >= MR_DETERMINISTIC_BOUND ? `${fmt(n)} is a PROBABLE prime (see the note).` : `${fmt(n)} is prime.`);
    // The deterministic range is n < bound: the bound itself is a composite that passes all thirteen bases.
    const big = f.factors.filter(([p]) => p >= MR_DETERMINISTIC_BOUND);
    if (big.length) caveats.push(`Factor${big.length > 1 ? "s" : ""} above 3.3 × 10²⁴ (${big.map(([p]) => fmt(p)).join(", ")}) ${big.length > 1 ? "are" : "is a"} PROBABLE prime${big.length > 1 ? "s" : ""} (Miller–Rabin, 13 bases), not proven.`);
  }
  return result("Prime factorisation", display, steps, caveats);
}

function doIsPrime(n: bigint): DiscreteResult {
  const v = isPrime(n);
  if (n < 2n) return result("Primality", [`${fmt(n)} is not prime (primes start at 2).`]);
  if (v.prime) {
    return result("Primality", [v.certain ? `${fmt(n)} is prime.` : `${fmt(n)} is a PROBABLE prime.`], [
      v.certain
        ? (n < 1764n ? "Trial division by the first thirteen primes settles it." : "Miller–Rabin with bases 2…41 is a deterministic proof below 3.3 × 10²⁴ (Sorenson–Webster 2015).")
        : "Miller–Rabin with the thirteen fixed bases 2…41 passed. Above 3.3 × 10²⁴ that is strong evidence, not a proof: composites that pass all thirteen exist (the bound itself is one), so treat the verdict as “probable”.",
    ]);
  }
  const steps: string[] = [];
  if (v.factor) steps.push(`${fmt(n)} = ${fmt(v.factor)} × ${fmt(n / v.factor)}.`);
  else if (v.witness) steps.push(`Base ${fmt(v.witness)} is a Miller–Rabin witness: the sequence a^d, a^2d, … never reaches −1 before reaching 1, which no prime allows. (The test proves compositeness without finding a factor — use “factor ${fmt(n)}” for the factors.)`);
  return result("Primality", [`${fmt(n)} is composite.`], steps);
}

function doPrimesTo(lo: bigint, hi: bigint): DiscreteResult {
  if (hi < 2n) return result("Primes", [`There are no primes up to ${fmt(hi)} — the primes start at 2.`]);
  const h = toNum(hi, SIEVE_MAX, "The sieve limit");
  const l = Math.max(2, toNum(lo, SIEVE_MAX, "The lower bound"));
  const all = sieve(h).filter((p) => p >= l);
  const shown = all.slice(0, LIST_SHOWN);
  const display = [`${all.length.toLocaleString("en-US")} primes ${l > 2 ? `between ${l.toLocaleString("en-US")} and ` : "up to "}${h.toLocaleString("en-US")}${l <= 2 ? ` (π(${h.toLocaleString("en-US")}) = ${all.length.toLocaleString("en-US")})` : ""}.`];
  const steps = [shown.join(", ") + (all.length > shown.length ? `, … (${(all.length - shown.length).toLocaleString("en-US")} more not listed)` : "")];
  return result("Primes", display, steps, ["Sieve of Eratosthenes; every listed number is prime by construction."]);
}

function doTotient(n: bigint): DiscreteResult {
  positive(n, "n");
  const f = factorize(n);
  const phi = totientFrom(f);
  if (phi === null) throw new DiscreteError(`φ(${fmt(n)}) needs the full factorisation, and ${fmt(f.unfactored as bigint)} was not factored within the budget.`);
  const steps = [`${fmt(n)} = ${showFactorization(f)}`, `φ(n) = n × ∏(1 − 1/p) = ${f.factors.map(([p, e]) => (e === 1 ? `(${fmt(p)} − 1)` : `${fmt(p)}${sup(e - 1)}(${fmt(p)} − 1)`)).join(" × ")}`];
  return result("Euler's totient", [`φ(${fmt(n)}) = ${fmt(phi)}`, `${fmt(phi)} of the integers 1…${fmt(n)} are coprime to ${fmt(n)}.`], steps);
}

function doDivisors(n: bigint): DiscreteResult {
  positive(n, "n");
  const f = factorize(n);
  const divs = divisorsFrom(f);
  if (!divs) throw new DiscreteError(`The divisors of ${fmt(n)} need its full factorisation, and ${fmt(f.unfactored as bigint)} was not factored within the budget.`);
  if (divs.length > 5000) throw new DiscreteError(`${fmt(n)} has ${divs.length.toLocaleString("en-US")} divisors, above the 5,000 listed here.`);
  const sigma = divs.reduce((s, d) => s + d, 0n);
  const shown = divs.slice(0, LIST_SHOWN);
  const kind = sigma === 2n * n ? " — a PERFECT number (σ(n) = 2n)" : sigma > 2n * n ? " — abundant" : " — deficient";
  return result("Divisors", [`${fmt(n)} has ${divs.length} divisors; their sum σ(n) = ${fmt(sigma)}${kind}.`], [`${fmt(n)} = ${showFactorization(f)}; τ(n) = ∏(e + 1) = ${f.factors.map(([, e]) => `(${e} + 1)`).join(" × ") || "1"} = ${divs.length}.`, shown.map(fmt).join(", ") + (divs.length > shown.length ? ", …" : "")]);
}

function doOrder(a: bigint, m: bigint): DiscreteResult {
  positive(m, "The modulus");
  if (m === 1n) throw new DiscreteError("Mod 1 every number is 0; the order is not defined.");
  if (gcd(a, m) !== 1n) throw new DiscreteError(`The order of ${fmt(a)} mod ${fmt(m)} is undefined: gcd(${fmt(a)}, ${fmt(m)}) = ${fmt(gcd(a, m))} ≠ 1, so no power of ${fmt(a)} is ≡ 1.`);
  const k = multiplicativeOrder(a, m);
  if (k === null) throw new DiscreteError("The order needs φ(m) fully factored, and that was not possible within the budget.");
  const phi = totientFrom(factorize(m)) as bigint;
  const steps = [`φ(${fmt(m)}) = ${fmt(phi)}; the order divides φ(m) (Lagrange), so only its divisors need testing.`];
  if (k <= 40n) {
    const powers: string[] = [];
    let x = 1n;
    for (let i = 1n; i <= k; i++) { x = (x * mod(a, m)) % m; powers.push(`${fmt(a)}${sup(i)} ≡ ${fmt(x)}`); }
    steps.push(powers.join(", ") + " (mod " + fmt(m) + ").");
  }
  const display = [`ord_${fmt(m)}(${fmt(a)}) = ${fmt(k)}`];
  if (k === phi) display.push(`${fmt(a)} is a primitive root mod ${fmt(m)} (its order equals φ(m)).`);
  const caveats = modPow(a, k, m) === 1n ? [] : ["CROSS-CHECK FAILED: a^k is not 1 — a defect in this tool."];
  if (!caveats.length) steps.push(`Verified: ${fmt(a)}${sup(k)} ≡ 1 (mod ${fmt(m)}), and no proper divisor of ${fmt(k)} works (by construction).`);
  return result("Multiplicative order", display, steps, caveats);
}

function doPrimitiveRoot(m: bigint, all: boolean): DiscreteResult {
  positive(m, "The modulus");
  if (m === 1n) throw new DiscreteError("Mod 1 there is one residue and no generator.");
  const fm = factorize(m);
  if (fm.unfactored) throw new DiscreteError("Primitive roots need the modulus factored, and that was not possible within the budget.");
  // Primitive roots exist iff m = 1, 2, 4, p^k, 2p^k (p odd).
  const odd = fm.factors.filter(([p]) => p !== 2n);
  const twoExp = fm.factors.find(([p]) => p === 2n)?.[1] ?? 0;
  const exists = m === 2n || m === 4n || (odd.length === 1 && twoExp <= 1);
  if (!exists) {
    return result("Primitive roots", [`No primitive root exists mod ${fmt(m)}.`], [`${fmt(m)} = ${showFactorization(fm)}. Primitive roots exist only for 1, 2, 4, pᵏ and 2pᵏ with p an odd prime (the multiplicative group is cyclic exactly then).`]);
  }
  const phi = totientFrom(fm) as bigint;
  const fphi = factorize(phi);
  if (fphi.unfactored) throw new DiscreteError("Testing a primitive root needs φ(m) factored, and that was not possible within the budget.");
  const isRoot = (g: bigint): boolean => gcd(g, m) === 1n && fphi.factors.every(([q]) => modPow(g, phi / q, m) !== 1n);
  let first: bigint | null = null;
  const cap = m < 1_000_000n ? m : 1_000_000n;
  for (let g = 1n; g < cap; g++) if (isRoot(g)) { first = g; break; }
  if (first === null) throw new DiscreteError("No primitive root found below 10⁶ — the search is capped there.");
  const count = totientFrom(fphi) as bigint;
  const display = [`Smallest primitive root mod ${fmt(m)}: ${fmt(first)}`, `There are φ(φ(${fmt(m)})) = φ(${fmt(phi)}) = ${fmt(count)} primitive roots.`];
  const steps = [`φ(${fmt(m)}) = ${fmt(phi)} = ${showFactorization(fphi)}. g is a primitive root iff g^(φ/q) ≢ 1 for every prime q | φ: tested q = ${fphi.factors.map(([q]) => fmt(q)).join(", ")}.`];
  if (all && count <= 200n && m < 100_000n) {
    const roots: bigint[] = [];
    for (let g = 1n; g < m; g++) if (isRoot(g)) roots.push(g);
    steps.push(`All primitive roots: ${roots.map(fmt).join(", ")}.`);
  } else if (all) {
    steps.push("Listing all of them is capped at 200 roots and m < 100,000.");
  }
  return result("Primitive roots", display, steps);
}

function doJacobi(a: bigint, n: bigint, legendre: boolean): DiscreteResult {
  if (legendre) {
    const v = isPrime(n);
    if (!v.prime || n === 2n) throw new DiscreteError(`The Legendre symbol needs an odd prime below; ${fmt(n)} is ${n === 2n ? "2" : "not prime"}. Use “jacobi ${fmt(a)} ${fmt(n)}” for the Jacobi symbol.`);
  }
  const j = jacobi(a, n);
  const display = [`(${fmt(a)} / ${fmt(n)}) = ${j}`];
  const steps: string[] = ["Computed by quadratic reciprocity (the law for Jacobi symbols, with the supplements for −1 and 2)."];
  const pn = isPrime(n);
  if (pn.prime && pn.certain) {
    if (j === 1) {
      const root = sqrtMod(a, n);
      display.push(`${fmt(mod(a, n))} IS a quadratic residue mod ${fmt(n)}: ${root !== null ? `${fmt(root)}² ≡ ${fmt(mod(a, n))}` : "a square root exists"}.`);
    } else if (j === -1) display.push(`${fmt(mod(a, n))} is NOT a quadratic residue mod ${fmt(n)}.`);
    else display.push(`${fmt(n)} divides ${fmt(a)}.`);
  } else if (!legendre) {
    steps.push(`${fmt(n)} is not prime, so this is a Jacobi symbol: −1 proves “not a residue”, but +1 does NOT prove “residue” (e.g. (2/15) = 1 while 2 is a non-residue mod 15).`);
  }
  return result(legendre ? "Legendre symbol" : "Jacobi symbol", display, steps);
}

function doSqrtMod(a: bigint, p: bigint): DiscreteResult {
  positive(p, "The modulus");
  const v = isPrime(p);
  if (!v.prime) throw new DiscreteError(`Square roots mod a composite need its factorisation (and are not unique); ${fmt(p)} is composite. This tool does primes only.`);
  const r = sqrtMod(a, p);
  if (r === null) return result("Modular square root", [`${fmt(mod(a, p))} is not a quadratic residue mod ${fmt(p)}: no square root exists.`], [`Euler's criterion: ${fmt(mod(a, p))}^((p−1)/2) ≡ −1 (mod ${fmt(p)}).`]);
  const other = mod(-r, p);
  const check = mod(r * r - a, p) === 0n;
  const [lo, hi] = r < other ? [r, other] : [other, r];
  const display = [`x ≡ ${fmt(lo)}${hi !== lo ? ` or ${fmt(hi)}` : ""} (mod ${fmt(p)})`];
  const steps = [p === 2n ? "Mod 2 every residue is its own square root." : p % 4n === 3n ? `p ≡ 3 (mod 4), so x = a^((p+1)/4) directly.` : "Tonelli–Shanks (p ≡ 1 mod 4)."];
  if (check) steps.push(`Verified: ${fmt(r)}² ≡ ${fmt(mod(a, p))} (mod ${fmt(p)}).`);
  return result("Modular square root", display, steps, check ? [] : ["CROSS-CHECK FAILED: the root does not square back — a defect in this tool."], );
}

const BASE_NAMES: Record<string, number> = { binary: 2, bin: 2, octal: 8, oct: 8, decimal: 10, dec: 10, hex: 16, hexadecimal: 16 };
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

function doBase(nText: string, fromBase: number, toBase: number): DiscreteResult {
  if (toBase < 2 || toBase > 36 || fromBase < 2 || fromBase > 36) throw new DiscreteError("Bases 2 to 36 are supported.");
  const clean = nText.toLowerCase().replace(/^0[xbo]/, "");
  let n = 0n;
  for (const ch of clean) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= fromBase) throw new DiscreteError(`"${ch}" is not a base-${fromBase} digit.`);
    n = n * BigInt(fromBase) + BigInt(d);
  }
  const out = n.toString(toBase).toUpperCase();
  const steps: string[] = [];
  if (fromBase !== 10) steps.push(`Value in decimal: ${fmt(n)}.`);
  if (toBase !== 10) {
    // Repeated division, shown (first 40 steps).
    let v = n;
    const lines: string[] = [];
    while (v > 0n && lines.length < 40) {
      const q = v / BigInt(toBase);
      const r = v % BigInt(toBase);
      lines.push(`${fmt(v)} ÷ ${toBase} = ${fmt(q)} remainder ${DIGITS[Number(r)].toUpperCase()}`);
      v = q;
    }
    steps.push(...lines);
    steps.push("Read the remainders from last to first.");
  }
  const name = (b: number): string => ({ 2: "binary", 8: "octal", 10: "decimal", 16: "hexadecimal" } as Record<number, string>)[b] ?? `base ${b}`;
  return result("Base conversion", [`${nText} (${name(fromBase)}) = ${out} (${name(toBase)})`], steps);
}

// ---------------------------------------------------------------------------
// The surface forms

export function tryNumberTheory(input: string): DiscreteResult | null {
  // Newlines read as commas (a CRT system may be typed one congruence per
  // line); a comma between a digit and exactly three digits is a thousands
  // separator, as the tool's own output prints them.
  // (A comma-separated argument list, pow(7,100,13), is not a thousands
  // separator: the fold applies only to a group that is not followed by ",digit".)
  const text = input.trim().replace(/\s*\n\s*/g, ", ").replace(/\b(\d{1,3})((?:,\d{3})+)\b(?!,\d)/g, (_, a: string, b: string) => a + b.replace(/,/g, "")).replace(/\s+/g, " ");
  if (!text) return null;
  let t = text.toLowerCase().replace(/≡/g, "=").replace(/\(mod\s+(-?\d+)\)/g, "mod $1").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  // "gcd of 84 and 36": only in the list forms, where "and" can mean nothing else.
  if (/^(?:gcd|hcf|lcm|extended gcd|bezout|bézout)\b/.test(t)) t = t.replace(/(\d)\s+and\s+(-?\d)/g, "$1 $2");
  let m: RegExpExecArray | null;

  // A congruence STATEMENT between numbers: 5 ≡ 2 (mod 3) — true or false, with the difference shown.
  if ((m = new RegExp(String.raw`^(${INT})\s*=\s*(${INT})\s*(?:mod|modulo)\s*(${INT})$`).exec(t))) {
    const a = big(m[1]), b = big(m[2]), mod_ = positive(big(m[3]), "The modulus");
    const diff = a - b;
    const holds = mod(diff, mod_) === 0n;
    return result("Congruence", [`${fmt(a)} ≡ ${fmt(b)} (mod ${fmt(mod_)}) is ${holds ? "TRUE" : "FALSE"}.`],
      [`${fmt(a)} − ${fmt(b)} = ${fmt(diff)}${holds ? ` = ${fmt(diff / mod_)} × ${fmt(mod_)}` : `, which is not a multiple of ${fmt(mod_)} (remainder ${fmt(mod(diff, mod_))})`}.`]);
  }

  // gcd / lcm of two or more
  if ((m = /^(gcd|hcf|lcm|extended gcd|bezout|bézout)\s*(?:of\s+)?((?:-?\d[\d,_]*\s*[,\s]\s*)+-?\d[\d,_]*)$/.exec(t))) {
    const nums = m[2].split(/[,\s]+/).filter(Boolean).map(big);
    if (nums.length < 2) return null;
    if (nums.every((n) => n === 0n)) throw new DiscreteError("gcd(0, 0) is 0 by convention and lcm is undefined.");
    return doGcd(nums, m[1] === "lcm");
  }
  // a^e mod m (also pow a e mod m)
  if ((m = new RegExp(String.raw`^(?:pow\s+)?(${INT})\s*(?:\^|\*\*)\s*(${INT})\s*(?:mod|%)\s*(${INT})$`).exec(t)) || (m = new RegExp(String.raw`^pow[\s,]+(${INT})[\s,]+(${INT})[\s,]+(?:mod\s+)?(${INT})$`).exec(t))) {
    return doPow(big(m[1]), big(m[2]), big(m[3]));
  }
  // inverse
  if ((m = new RegExp(String.raw`^(?:inverse|inv|modular inverse)\s+(?:of\s+)?(${INT})\s+(?:mod|modulo)\s+(${INT})$`).exec(t)) || (m = new RegExp(String.raw`^(${INT})\s*\^\s*-1\s*(?:mod|%)\s*(${INT})$`).exec(t)) || (m = new RegExp(String.raw`^(${INT})⁻¹\s*(?:mod|%)\s*(${INT})$`).exec(t))) {
    return doInverse(big(m[1]), big(m[2]));
  }
  // CRT: x = a mod m, x = b mod n [, ...]
  if (/^x\s*=\s*-?\d+\s*mod\s*-?\d+(\s*[,;]\s*x\s*=\s*-?\d+\s*mod\s*-?\d+)+$/.test(t)) {
    const pairs = [...t.matchAll(/x\s*=\s*(-?\d+)\s*mod\s*(-?\d+)/g)].map((mm) => [big(mm[1]), big(mm[2])] as [bigint, bigint]);
    return doCrt(pairs);
  }
  // linear congruence a x = b mod m
  if ((m = new RegExp(String.raw`^(?:solve\s+)?(${INT})\s*\*?\s*x\s*=\s*(${INT})\s*(?:mod|modulo)\s*(${INT})$`).exec(t)) || (m = new RegExp(String.raw`^(?:solve\s+)?x\s*=\s*(${INT})\s*(?:mod|modulo)\s*(${INT})$`).exec(t))) {
    if (m.length === 4) return doLinearCongruence(big(m[1]), big(m[2]), big(m[3]));
    return doLinearCongruence(1n, big(m[1]), big(m[2]));
  }
  // a mod m
  if ((m = new RegExp(String.raw`^(${INT})\s*(?:mod|modulo|%)\s*(${INT})$`).exec(t))) return doMod(big(m[1]), big(m[2]));
  // factor
  if ((m = new RegExp(String.raw`^(?:factor|factorise|factorize|factors of|prime factori[sz]ation of|prime factors of)\s+(${INT})$`).exec(t))) return doFactor(big(m[1]));
  // primality
  if ((m = new RegExp(String.raw`^(?:is\s+(${INT})\s+(?:a\s+)?prime(?:\s+number)?\??|(?:isprime|prime\?|is prime|primality)\s+(${INT})|(${INT})\s+prime\??)$`).exec(t))) return doIsPrime(big(m[1] ?? m[2] ?? m[3]));
  // primes to / between
  if ((m = new RegExp(String.raw`^primes?\s+(?:up\s+)?(?:to|below|under|less than)\s+(${INT})$`).exec(t))) return doPrimesTo(2n, big(m[1]));
  if ((m = new RegExp(String.raw`^primes?\s+(?:between|from)\s+(${INT})\s+(?:and|to)\s+(${INT})$`).exec(t))) return doPrimesTo(big(m[1]), big(m[2]));
  // totient
  if ((m = new RegExp(String.raw`^(?:phi|φ|totient|euler'?s? totient|euler phi)\s*(?:of\s+)?(${INT})$`).exec(t))) return doTotient(big(m[1]));
  // divisors
  if ((m = new RegExp(String.raw`^(?:divisors|factors|all divisors|number of divisors|sum of divisors|sigma|σ|tau|τ)\s*(?:of\s+)?(${INT})$`).exec(t))) return doDivisors(big(m[1]));
  // order
  if ((m = new RegExp(String.raw`^(?:order|ord|multiplicative order)\s*(?:of\s+)?(${INT})\s+(?:mod|modulo)\s+(${INT})$`).exec(t))) return doOrder(big(m[1]), big(m[2]));
  // primitive roots
  if ((m = new RegExp(String.raw`^(?:(all\s+)?primitive\s+roots?|generators?)\s+(?:of\s+|mod(?:ulo)?\s+)?(?:mod(?:ulo)?\s+)?(${INT})$`).exec(t))) return doPrimitiveRoot(big(m[2]), !!m[1] || /roots|generators/.test(t));
  // jacobi / legendre
  if ((m = new RegExp(String.raw`^(jacobi|legendre)\s*(?:symbol\s+)?(${INT})\s*[,/ ]\s*(${INT})$`).exec(t))) return doJacobi(big(m[2]), big(m[3]), m[1] === "legendre");
  // sqrt mod p
  if ((m = new RegExp(String.raw`^(?:sqrt|square root(?:s)? of|√)\s*(${INT})\s+(?:mod|modulo)\s+(${INT})$`).exec(t)) || (m = new RegExp(String.raw`^(?:solve\s+)?x\s*\^\s*2\s*=\s*(${INT})\s*(?:mod|modulo)\s*(${INT})$`).exec(t))) return doSqrtMod(big(m[1]), big(m[2]));
  // base conversion: 255 in binary · 0xff to decimal · ff hex to binary · 255 to base 7 · binary 1011 to decimal
  if ((m = /^(?:convert\s+)?(?:(binary|octal|hex|hexadecimal|decimal|base\s+\d+)\s+)?(0x[0-9a-f]+|0b[01]+|0o[0-7]+|[0-9a-z]+)\s*(?:(binary|octal|hex|hexadecimal|decimal|base\s+\d+)\s+)?(?:in|to|into|as)\s+(binary|octal|hex|hexadecimal|decimal|base\s+\d+)$/.exec(t))) {
    const baseOf = (s: string | undefined): number | null => (s ? (s.startsWith("base") ? Number(s.slice(4).trim()) : BASE_NAMES[s]) : null);
    const lit = m[2];
    let from = baseOf(m[1]) ?? baseOf(m[3]);
    if (from === null) from = lit.startsWith("0x") ? 16 : lit.startsWith("0b") ? 2 : lit.startsWith("0o") ? 8 : /^[0-9]+$/.test(lit) ? 10 : null;
    if (from === null) throw new DiscreteError(`Say which base "${lit}" is in (e.g. “hex ${lit} to binary”).`);
    const to = baseOf(m[4]) as number;
    return doBase(lit, from, to);
  }
  return null;
}
