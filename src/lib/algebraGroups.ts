// Finite groups as index tables (v2.134.0, SCOPE-ABSTRACT-ALGEBRA §C.2).
//
// Every group — constructed (ℤ/n, U(n), Sₙ, Aₙ, Dₙ, Q₈, V₄, Dicₙ, products)
// or typed as a Cayley table — becomes the same record: element labels, an
// n × n multiplication table of indices, the identity and the inverses. The
// table is checked by BRUTE FORCE for the four axioms before any verb runs
// (closure, identity, inverses, associativity on all n³ triples); a typed
// table that fails is refused naming the axiom and the place. Caps are on the
// ORDER, decided from the typed numbers before anything is enumerated:
// |G| ≤ 120 (S₅ in, S₆ out), all subgroups only for |G| ≤ 24.
//
// Isomorphism. "No" is a certificate (a distinguishing invariant, named).
// "Yes" is claimed only where the invariants are complete: abelian groups
// (the order statistics determine the invariant factors), or |G| ≤ 15 (the
// order statistics separate every pair of groups of each order ≤ 15 — proven
// in the test suite by building every such group; the first failure is order
// 16, ℤ/8ℤ × ℤ/2ℤ against M₁₆, also pinned there). Otherwise: undecided, said.

import { DiscreteError } from "./discrete";
import {
  Perm, identityPerm, composePerm, cycleString, permCycles, parsePermProduct, composeFactors, extendPerm, permSign, largestMoved,
} from "./algebraPerm";

export const MAX_ORDER = 120;
export const MAX_ALL_SUBGROUPS_ORDER = 24;
export const MAX_SUBGROUPS = 200;

export type GroupKind =
  | "cyclic" | "units" | "symmetric" | "alternating" | "dihedral" | "quaternion" | "klein" | "dicyclic"
  | "product" | "table" | "quotient" | "metacyclic";

export interface FiniteGroup {
  /** Display name (display contract: re-reads through the algebra reader where it is a typed name). */
  name: string;
  kind: GroupKind;
  n: number;
  labels: string[];
  /** Row-major: mul[a * n + b] = a·b. */
  mul: Int32Array;
  e: number;
  inv: Int32Array;
  /** Written additively (ℤ/n and products of additive groups). */
  additive: boolean;
  /** The parameter of the family (n in ℤ/n, U(n), Sₙ, Aₙ, Dₙ, Dicₙ). */
  param?: number;
  factors?: FiniteGroup[];
  perms?: Perm[];
  /** Element reader: text → index; null = not an element written in this group's notation. May throw DiscreteError naming why. */
  read: (s: string) => number | null;
}

export const op = (G: FiniteGroup, a: number, b: number): number => G.mul[a * G.n + b];

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const subDigits = (n: number | string): string => String(n).split("").map((d) => SUB[Number(d)] ?? d).join("");
export const supDigits = (n: number | string): string => String(n).split("").map((d) => (d === "-" ? "⁻" : SUP[Number(d)] ?? d)).join("");

// ---------------------------------------------------------------------------
// Axioms

export interface AxiomResult { e: number; inv: Int32Array }

/** Brute-force group axioms on an index table; throws DiscreteError naming the failing axiom and where. */
export function checkAxioms(labels: string[], mul: Int32Array, opName = "·"): AxiomResult {
  const n = labels.length;
  const L = (i: number): string => labels[i];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const v = mul[a * n + b];
    if (!(v >= 0 && v < n)) throw new DiscreteError(`Closure fails: ${L(a)} ${opName} ${L(b)} is not an element of the set, so this is not a group.`);
  }
  // Identity: two-sided.
  let e = -1;
  for (let c = 0; c < n && e < 0; c++) {
    let ok = true;
    for (let x = 0; x < n && ok; x++) if (mul[c * n + x] !== x || mul[x * n + c] !== x) ok = false;
    if (ok) e = c;
  }
  if (e < 0) {
    const lefts: string[] = [];
    for (let c = 0; c < n; c++) {
      let ok = true;
      for (let x = 0; x < n && ok; x++) if (mul[c * n + x] !== x) ok = false;
      if (ok) lefts.push(L(c));
    }
    throw new DiscreteError(`No identity: no element c has c ${opName} x = x ${opName} c = x for every x${lefts.length ? ` (${lefts.join(", ")} ${lefts.length > 1 ? "are left identities" : "is only a LEFT identity"}${lefts.length > 1 ? " — a group has exactly one identity" : ""})` : ""}, so this table is not a group.`);
  }
  const inv = new Int32Array(n).fill(-1);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) if (mul[a * n + b] === e && mul[b * n + a] === e) { inv[a] = b; break; }
    if (inv[a] < 0) throw new DiscreteError(`No inverse for ${L(a)}: no x has ${L(a)} ${opName} x = x ${opName} ${L(a)} = ${L(e)} (row ${L(a)} never reaches ${L(e)} on both sides), so this table is not a group.`);
  }
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const ab = mul[a * n + b];
    for (let c = 0; c < n; c++) {
      const l = mul[ab * n + c], r = mul[a * n + mul[b * n + c]];
      if (l !== r) throw new DiscreteError(`Associativity fails: (${L(a)} ${opName} ${L(b)}) ${opName} ${L(c)} = ${L(l)} but ${L(a)} ${opName} (${L(b)} ${opName} ${L(c)}) = ${L(r)} at a = ${L(a)}, b = ${L(b)}, c = ${L(c)}, so this table is not a group.`);
    }
  }
  return { e, inv };
}

function build(name: string, kind: GroupKind, labels: string[], f: (a: number, b: number) => number, read: (s: string) => number | null, additive: boolean, extra: Partial<FiniteGroup> = {}): FiniteGroup {
  const n = labels.length;
  if (n > MAX_ORDER) throw new DiscreteError(`${name} has order ${n}, above the cap |G| ≤ ${MAX_ORDER}.`);
  const mul = new Int32Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) mul[a * n + b] = f(a, b);
  const { e, inv } = checkAxioms(labels, mul, additive ? "+" : "·");
  return { name, kind, n, labels, mul, e, inv, additive, read, ...extra };
}

/** Integer token (optionally signed) → bigint, or null. */
function intToken(s: string): bigint | null {
  const t = s.trim().replace(/^\+/, "");
  if (!/^-?\d{1,30}$/.test(t)) return null;
  return BigInt(t);
}
const modB = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;
export function gcdN(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// ---------------------------------------------------------------------------
// Constructors

export const cyclicName = (n: number): string => `ℤ/${n}ℤ`;

export function cyclicGroup(n: number): FiniteGroup {
  const labels = Array.from({ length: n }, (_, i) => String(i));
  return build(cyclicName(n), "cyclic", labels, (a, b) => (a + b) % n, (s) => {
    const v = intToken(s);
    return v === null ? null : Number(modB(v, BigInt(n)));
  }, true, { param: n });
}

export function unitsGroup(n: number): FiniteGroup {
  const els: number[] = [];
  if (n === 1) els.push(0);
  else for (let k = 1; k < n; k++) if (gcdN(k, n) === 1) els.push(k);
  const idx = new Map<number, number>();
  els.forEach((v, i) => idx.set(v, i));
  return build(`U(${n})`, "units", els.map(String), (a, b) => idx.get((els[a] * els[b]) % n)!, (s) => {
    const v = intToken(s);
    if (v === null) return null;
    const r = Number(modB(v, BigInt(n)));
    const i = idx.get(r);
    if (i === undefined) throw new DiscreteError(`${s.trim()} is not in U(${n}): gcd(${r}, ${n}) = ${gcdN(r, n)} ≠ 1, so it has no inverse mod ${n}.`);
    return i;
  }, false, { param: n });
}

function allPerms(n: number): Perm[] {
  const out: Perm[] = [];
  const a = identityPerm(n);
  const rec = (k: number): void => {
    if (k === n) { out.push(a.slice()); return; }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      rec(k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  rec(0);
  return out;
}

/** Order of elements of Sₙ: by transposition length, then more cycles first, then the cycle string. */
function permSortKey(p: Perm): [number, number, string] {
  const cs = permCycles(p);
  const t = cs.reduce((s, c) => s + c.length - 1, 0);
  return [t, -cs.length, cycleString(p)];
}

function permGroup(n: number, alternating: boolean): FiniteGroup {
  let ps = allPerms(n);
  if (alternating) ps = ps.filter((p) => permSign(p) === 1);
  const keyed = ps.map((p) => ({ p, k: permSortKey(p) }));
  keyed.sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || (x.k[2] < y.k[2] ? -1 : x.k[2] > y.k[2] ? 1 : 0));
  ps = keyed.map((x) => x.p);
  const idx = new Map<string, number>();
  ps.forEach((p, i) => idx.set(p.join(","), i));
  const name = (alternating ? "A" : "S") + subDigits(n);
  return build(name, alternating ? "alternating" : "symmetric", ps.map(cycleString), (a, b) => idx.get(composePerm(ps[a], ps[b]).join(","))!, (s) => {
    const pp = parsePermProduct(s);
    if (!pp) return null;
    if (pp.degree > n) throw new DiscreteError(`${s.trim()} moves the point ${pp.degree}, which is not a point of ${name} (points 1 to ${n}).`);
    const p = composeFactors(pp.factors.map((f) => f.perm), n);
    const i = idx.get(extendPerm(p, n).join(","));
    if (i === undefined) throw new DiscreteError(`${s.trim()} = ${cycleString(p)} is an odd permutation, so it is not in ${name}.`);
    return i;
  }, false, { param: n, perms: ps });
}
export const symmetricGroup = (n: number): FiniteGroup => permGroup(n, false);
export const alternatingGroup = (n: number): FiniteGroup => permGroup(n, true);

/** Reads a word in one-letter generators with integer exponents: "r^2s", "r² s", "sr", "e". */
function readWord(s: string, letters: string): { letter: string; exp: number }[] | null {
  const t = s.replace(/\s+/g, "").replace(/[·*]/g, "");
  if (!t) return null;
  if (t === "e" || t === "1") return [];
  const re = new RegExp(`([${letters}])(?:\\^\\(?(-?\\d{1,6})\\)?)?`, "y");
  const out: { letter: string; exp: number }[] = [];
  let i = 0;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m) return null;
    out.push({ letter: m[1], exp: m[2] === undefined ? 1 : Number(m[2]) });
    i += m[0].length;
  }
  return out;
}

const powLabel = (letter: string, k: number): string => (k === 0 ? "" : k === 1 ? letter : letter + supDigits(k));

/** Dₙ: the symmetries of the regular n-gon, order 2n; elements rᵏ and rᵏs. */
export function dihedralGroup(n: number): FiniteGroup {
  const labels: string[] = [];
  for (let f = 0; f < 2; f++) for (let k = 0; k < n; k++) labels.push(powLabel("r", k) + (f ? "s" : "") || "e");
  const mulIdx = (a: number, b: number): number => {
    const ka = a % n, fa = Math.floor(a / n), kb = b % n, fb = Math.floor(b / n);
    const k = (((ka + (fa ? -kb : kb)) % n) + n) % n;
    return k + n * (fa ^ fb);
  };
  return build("D" + subDigits(n), "dihedral", labels, mulIdx, (s) => {
    const w = readWord(s, "rs");
    if (!w) return null;
    let acc = 0;
    for (const { letter, exp } of w) {
      let g = 0;
      if (letter === "r") g = ((exp % n) + n) % n;
      else g = Math.abs(exp) % 2 === 1 ? n : 0;
      acc = mulIdx(acc, g);
    }
    return acc;
  }, false, { param: n });
}

/** Dicₘ: order 4m, ⟨a, x | a^{2m} = e, x² = aᵐ, x a x⁻¹ = a⁻¹⟩; Dic₂ = Q₈. */
function dicyclicMul(m: number): (a: number, b: number) => number {
  const M = 2 * m;
  return (a, b) => {
    const i = a % M, f = Math.floor(a / M), j = b % M, g = Math.floor(b / M);
    if (!f) return ((i + j) % M) + M * g;
    if (!g) return ((((i - j) % M) + M) % M) + M;
    return (((i - j + m) % M) + M) % M;
  };
}

export function dicyclicGroup(m: number): FiniteGroup {
  const M = 2 * m;
  const labels: string[] = [];
  for (let f = 0; f < 2; f++) for (let k = 0; k < M; k++) labels.push(powLabel("a", k) + (f ? "x" : "") || "e");
  const f = dicyclicMul(m);
  return build("Dic" + subDigits(m), "dicyclic", labels, f, (s) => {
    const w = readWord(s, "ax");
    if (!w) return null;
    let acc = 0;
    for (const { letter, exp } of w) {
      let g = 0;
      if (letter === "a") g = ((exp % M) + M) % M;
      else {
        // x^k: x² = a^m, so x^k = a^{m·⌊k/2⌋} x^{k mod 2} (k ≥ 0); negative k through x⁻¹ = x³.
        const k = ((exp % 4) + 4) % 4;
        g = 0;
        for (let t = 0; t < k; t++) g = f(g, M);
      }
      acc = f(acc, g);
    }
    return acc;
  }, false, { param: m });
}

export function quaternionGroup(): FiniteGroup {
  // Dic₂ with a = i, x = j: indices 1, i, −1, −i, j, k, −j, −k.
  const labels = ["1", "i", "−1", "−i", "j", "k", "−j", "−k"];
  const norm = (s: string): string => s.replace(/\s+/g, "").replace(/−/g, "-").replace(/^\+/, "");
  const ascii = labels.map(norm);
  return build("Q₈", "quaternion", labels, dicyclicMul(2), (s) => {
    const i = ascii.indexOf(norm(s));
    return i < 0 ? null : i;
  }, false);
}

export function kleinGroup(): FiniteGroup {
  const labels = ["e", "a", "b", "c"];
  return build("V₄", "klein", labels, (a, b) => a ^ b, (s) => {
    const i = labels.indexOf(s.trim());
    return i < 0 ? null : i;
  }, false);
}

/** Splits at top-level commas (outside (), [], {}). */
export function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<" || ch === "⟨") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">" || ch === "⟩") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export function productGroup(fs: FiniteGroup[]): FiniteGroup {
  const sizes = fs.map((g) => g.n);
  const total = sizes.reduce((a, b) => a * b, 1);
  if (total > MAX_ORDER) throw new DiscreteError(`The product ${fs.map((g) => g.name).join(" × ")} has order ${total}, above the cap |G| ≤ ${MAX_ORDER}.`);
  const decode = (x: number): number[] => {
    const out: number[] = new Array(fs.length);
    for (let i = fs.length - 1; i >= 0; i--) { out[i] = x % sizes[i]; x = Math.floor(x / sizes[i]); }
    return out;
  };
  const encode = (v: number[]): number => v.reduce((acc, xi, i) => acc * sizes[i] + xi, 0);
  const labels = Array.from({ length: total }, (_, x) => "(" + decode(x).map((xi, i) => fs[i].labels[xi]).join(", ") + ")");
  const additive = fs.every((g) => g.additive);
  return build(fs.map((g) => g.name).join(" × "), "product", labels, (a, b) => {
    const da = decode(a), db = decode(b);
    return encode(da.map((x, i) => op(fs[i], x, db[i])));
  }, (s) => {
    const t = s.trim();
    if (!/^\(.*\)$/.test(t)) return null;
    const parts = splitTop(t.slice(1, -1));
    if (parts.length !== fs.length) return null;
    const v: number[] = [];
    for (let i = 0; i < fs.length; i++) {
      const x = fs[i].read(parts[i]);
      if (x === null) return null;
      v.push(x);
    }
    return encode(v);
  }, additive, { factors: fs });
}

/** A group given by its Cayley table: labels and rows of entry labels. Axioms checked; failures named. */
export function tableGroup(labels: string[], rows: string[][]): FiniteGroup {
  const n = labels.length;
  if (n > MAX_ORDER) throw new DiscreteError(`A table of ${n} elements is above the cap |G| ≤ ${MAX_ORDER}.`);
  const idx = new Map<string, number>();
  labels.forEach((l, i) => {
    if (idx.has(l)) throw new DiscreteError(`The element "${l}" heads two rows of the table.`);
    idx.set(l, i);
  });
  if (rows.length !== n) throw new DiscreteError(`The table has ${n} column headings but ${rows.length} rows — a Cayley table is square.`);
  const mul = new Int32Array(n * n);
  for (let a = 0; a < n; a++) {
    if (rows[a].length !== n) throw new DiscreteError(`Row ${labels[a]} has ${rows[a].length} entries; the table has ${n} columns.`);
    for (let b = 0; b < n; b++) {
      const v = idx.get(rows[a][b]);
      if (v === undefined) throw new DiscreteError(`Closure fails: ${labels[a]} · ${labels[b]} = "${rows[a][b]}", which is not one of the elements ${labels.join(", ")}, so this table is not a group.`);
      mul[a * n + b] = v;
    }
  }
  const { e, inv } = checkAxioms(labels, mul, "·");
  return { name: "G", kind: "table", n, labels, mul, e, inv, additive: false, read: (s) => { const i = idx.get(s.trim()); return i === undefined ? null : i; } };
}

// ---------------------------------------------------------------------------
// Verbs on a group

export function power(G: FiniteGroup, g: number, k: number): number {
  let r = G.e;
  let b = k < 0 ? G.inv[g] : g;
  let e = Math.abs(k);
  while (e > 0) {
    if (e & 1) r = op(G, r, b);
    b = op(G, b, b);
    e >>= 1;
  }
  return r;
}

export function elementOrder(G: FiniteGroup, g: number): number {
  let x = g, k = 1;
  while (x !== G.e) { x = op(G, x, g); k++; if (k > G.n) throw new DiscreteError("An element order exceeded |G| — a defect in this tool."); }
  return k;
}

export function allOrders(G: FiniteGroup): number[] {
  const out = Array.from({ length: G.n }, (_, g) => elementOrder(G, g));
  // Lagrange cross-check: every order divides |G|.
  out.forEach((o, g) => { if (G.n % o !== 0) throw new DiscreteError(`Cross-check failed: ${G.labels[g]} has order ${o}, which does not divide |G| = ${G.n} (Lagrange) — a defect in this tool.`); });
  return out;
}

/** The subgroup generated by gens: closure under the operation, as sorted indices. */
export function generated(G: FiniteGroup, gens: number[]): number[] {
  const inSet = new Uint8Array(G.n);
  const list = [G.e];
  inSet[G.e] = 1;
  for (let i = 0; i < list.length; i++) {
    for (const s of gens) {
      const y = op(G, list[i], s);
      if (!inSet[y]) { inSet[y] = 1; list.push(y); }
    }
  }
  return list.sort((a, b) => a - b);
}

/** null when H (nonempty) is a subgroup; otherwise a witness a, b with a·b ∉ H, or the missing identity. */
export function subgroupWitness(G: FiniteGroup, H: number[]): { a: number; b: number; ab: number } | { noIdentity: true } | null {
  const set = new Set(H);
  if (!set.has(G.e)) return { noIdentity: true };
  for (const a of H) for (const b of H) { const ab = op(G, a, b); if (!set.has(ab)) return { a, b, ab }; }
  return null;
}

export function cosets(G: FiniteGroup, H: number[], side: "left" | "right"): number[][] {
  const covered = new Uint8Array(G.n);
  const out: number[][] = [];
  for (let g = 0; g < G.n; g++) {
    if (covered[g]) continue;
    const c = H.map((h) => (side === "left" ? op(G, g, h) : op(G, h, g)));
    const cs = [...new Set(c)];
    // rep first, then the rest in index order
    cs.sort((a, b) => a - b);
    const ordered = [g, ...cs.filter((x) => x !== g)];
    for (const x of ordered) covered[x] = 1;
    out.push(ordered);
  }
  // Partition check: sizes, disjointness, union.
  const seen = new Uint8Array(G.n);
  for (const c of out) {
    if (c.length !== H.length) throw new DiscreteError("Cross-check failed: a coset's size differs from |H| — a defect in this tool.");
    for (const x of c) { if (seen[x]) throw new DiscreteError("Cross-check failed: two cosets overlap — a defect in this tool."); seen[x] = 1; }
  }
  if (out.length * H.length !== G.n) throw new DiscreteError("Cross-check failed: |G| ≠ |H|·[G : H] — a defect in this tool.");
  return out;
}

/** A conjugate g h g⁻¹ ∉ H, or null when H is normal. */
export function normalWitness(G: FiniteGroup, H: number[]): { g: number; h: number; c: number } | null {
  const set = new Set(H);
  for (let g = 0; g < G.n; g++) {
    if (set.has(g)) continue;
    for (const h of H) {
      const c = op(G, op(G, g, h), G.inv[g]);
      if (!set.has(c)) return { g, h, c };
    }
  }
  return null;
}

export function nonCommutingPair(G: FiniteGroup): [number, number] | null {
  for (let a = 0; a < G.n; a++) for (let b = a + 1; b < G.n; b++) if (op(G, a, b) !== op(G, b, a)) return [a, b];
  return null;
}

export function center(G: FiniteGroup): number[] {
  const out: number[] = [];
  for (let z = 0; z < G.n; z++) {
    let ok = true;
    for (let g = 0; g < G.n && ok; g++) if (op(G, z, g) !== op(G, g, z)) ok = false;
    if (ok) out.push(z);
  }
  return out;
}

export function conjugacyClasses(G: FiniteGroup): number[][] {
  const seen = new Uint8Array(G.n);
  const out: number[][] = [];
  for (let x = 0; x < G.n; x++) {
    if (seen[x]) continue;
    const cls = new Set<number>();
    for (let g = 0; g < G.n; g++) cls.add(op(G, op(G, g, x), G.inv[g]));
    const arr = [...cls].sort((a, b) => a - b);
    for (const y of arr) seen[y] = 1;
    out.push(arr);
  }
  // Class-equation checks: sizes divide |G|, sum to |G|, the singletons are the centre.
  const sum = out.reduce((s, c) => s + c.length, 0);
  if (sum !== G.n || out.some((c) => G.n % c.length !== 0)) throw new DiscreteError("Cross-check failed: the class sizes do not satisfy the class equation — a defect in this tool.");
  const singles = out.filter((c) => c.length === 1).map((c) => c[0]).sort((a, b) => a - b);
  const z = center(G);
  if (singles.join(",") !== z.join(",")) throw new DiscreteError("Cross-check failed: the classes of size 1 are not the centre — a defect in this tool.");
  return out;
}

export function generatorsOf(G: FiniteGroup, orders = allOrders(G)): number[] {
  return orders.map((o, g) => (o === G.n ? g : -1)).filter((g) => g >= 0);
}

export interface Subgroup {
  elements: number[];
  gens: number[];
}

/** A small generating set of H: one element when cyclic, else the first pair that generates, else greedy. */
export function smallGenerators(G: FiniteGroup, H: number[]): number[] {
  if (H.length === 1) return [];
  for (const g of H) if (elementOrder(G, g) === H.length) return [g];
  const nonId = H.filter((h) => h !== G.e);
  if (H.length <= 48) {
    for (let i = 0; i < nonId.length; i++) for (let j = i + 1; j < nonId.length; j++) {
      if (generated(G, [nonId[i], nonId[j]]).length === H.length) return [nonId[i], nonId[j]];
    }
  }
  const gens: number[] = [];
  let cur = [G.e];
  for (const h of nonId) {
    if (cur.includes(h)) continue;
    gens.push(h);
    cur = generated(G, gens);
    if (cur.length === H.length) break;
  }
  return gens;
}

/** Every subgroup (|G| ≤ 24), by joining cyclic subgroups until nothing new appears; ordered by size then elements. */
export function allSubgroups(G: FiniteGroup): Subgroup[] {
  if (G.n > MAX_ALL_SUBGROUPS_ORDER) throw new DiscreteError(`All subgroups are listed only for |G| ≤ ${MAX_ALL_SUBGROUPS_ORDER}; ${G.name} has order ${G.n}.`);
  const key = (H: number[]): string => H.join(",");
  const found = new Map<string, number[]>();
  const cyclics: number[][] = [];
  for (let g = 0; g < G.n; g++) {
    const H = generated(G, [g]);
    if (!found.has(key(H))) { found.set(key(H), H); cyclics.push(H); }
  }
  const queue = [...found.values()];
  for (let i = 0; i < queue.length; i++) {
    for (const C of cyclics) {
      const J = generated(G, [...new Set([...queue[i], ...C])]);
      const k = key(J);
      if (!found.has(k)) {
        if (found.size >= MAX_SUBGROUPS) throw new DiscreteError(`More than ${MAX_SUBGROUPS} subgroups — above the listing cap.`);
        found.set(k, J);
        queue.push(J);
      }
    }
  }
  const subs = [...found.values()].sort((a, b) => a.length - b.length || (key(a) < key(b) ? -1 : 1));
  for (const H of subs) {
    if (subgroupWitness(G, H) !== null) throw new DiscreteError("Cross-check failed: an enumerated subgroup is not closed — a defect in this tool.");
    if (G.n % H.length !== 0) throw new DiscreteError("Cross-check failed: a subgroup order does not divide |G| — a defect in this tool.");
  }
  return subs.map((H) => ({ elements: H, gens: smallGenerators(G, H) }));
}

/** Covering pairs [smaller, larger] (indices into subs). */
export function coveringEdges(subs: Subgroup[]): [number, number][] {
  const sets = subs.map((s) => new Set(s.elements));
  const contains = (big: number, small: number): boolean => subs[small].elements.every((x) => sets[big].has(x));
  const out: [number, number][] = [];
  for (let i = 0; i < subs.length; i++) for (let j = 0; j < subs.length; j++) {
    if (i === j || subs[i].elements.length >= subs[j].elements.length || !contains(j, i)) continue;
    let covered = true;
    for (let k = 0; k < subs.length && covered; k++) {
      if (k === i || k === j) continue;
      const nk = subs[k].elements.length;
      if (nk > subs[i].elements.length && nk < subs[j].elements.length && contains(k, i) && contains(j, k)) covered = false;
    }
    if (covered) out.push([i, j]);
  }
  return out;
}

/** G/H for a normal H; the coset product is checked to be well defined and the result re-checked as a group. */
export function quotientGroup(G: FiniteGroup, H: number[], Hname: string): { Q: FiniteGroup; cosetList: number[][] } {
  const w = normalWitness(G, H);
  if (w) throw new DiscreteError(`${Hname} is not normal in ${G.name}: ${G.labels[w.g]}·${G.labels[w.h]}·${G.labels[w.g]}⁻¹ = ${G.labels[w.c]} ∉ ${Hname}, so ${G.name} / ${Hname} is not a group.`);
  const cs = cosets(G, H, "left");
  const which = new Int32Array(G.n);
  cs.forEach((c, i) => c.forEach((x) => { which[x] = i; }));
  const m = cs.length;
  const mul = new Int32Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) {
    // Well-definedness: every product of members lands in one coset.
    const target = which[op(G, cs[a][0], cs[b][0])];
    for (const x of cs[a]) for (const y of cs[b]) {
      if (which[op(G, x, y)] !== target) throw new DiscreteError(`Cross-check failed: the coset product is not well defined at ${G.labels[x]}, ${G.labels[y]} — a defect in this tool.`);
    }
    mul[a * m + b] = target;
  }
  const labels = cs.map((c) => (G.additive ? `${G.labels[c[0]]} + ${Hname}` : c[0] === G.e ? Hname : `${G.labels[c[0]]}${Hname}`));
  const { e, inv } = checkAxioms(labels, mul, G.additive ? "+" : "·");
  const Q: FiniteGroup = { name: `${G.name} / ${Hname}`, kind: "quotient", n: m, labels, mul, e, inv, additive: G.additive, read: (s) => { const i = labels.indexOf(s.trim()); return i < 0 ? null : i; } };
  return { Q, cosetList: cs };
}

// ---------------------------------------------------------------------------
// Invariants and isomorphism

export function orderStats(G: FiniteGroup, orders = allOrders(G)): Map<number, number> {
  const m = new Map<number, number>();
  for (const o of orders) m.set(o, (m.get(o) ?? 0) + 1);
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}
export const statsKey = (m: Map<number, number>): string => [...m.entries()].map(([o, c]) => `${o}:${c}`).join(" ");
export const statsText = (m: Map<number, number>): string => `orders ${[...m.keys()].join(", ")} occur ${[...m.values()].join(", ")} times`;

function primeFactorsN(n: number): number[] {
  const out: number[] = [];
  for (let p = 2; p * p <= n; p++) if (n % p === 0) { out.push(p); while (n % p === 0) n /= p; }
  if (n > 1) out.push(n);
  return out;
}

/** Invariant factors d₁ | d₂ | … of an ABELIAN group, from its order statistics alone. */
export function invariantFactors(n: number, orders: number[]): number[] {
  const perPrime: number[][] = [];
  const primes = primeFactorsN(n);
  for (const p of primes) {
    const c = [0];
    for (let k = 1; k < 64; k++) {
      const pk = p ** k;
      const cnt = orders.filter((o) => pk % o === 0).length;
      const lg = Math.round(Math.log(cnt) / Math.log(p));
      if (p ** lg !== cnt) throw new DiscreteError("Cross-check failed: an abelian p-part is not a power of p — a defect in this tool.");
      c.push(lg);
      if (lg === c[k - 1]) break;
    }
    const conj: number[] = [];
    for (let k = 1; k < c.length; k++) conj.push(c[k] - c[k - 1]);
    const parts: number[] = [];
    for (let i = 1; i <= (conj[0] ?? 0); i++) parts.push(conj.filter((x) => x >= i).length);
    perPrime.push(parts); // descending exponents
  }
  const m = Math.max(0, ...perPrime.map((x) => x.length));
  const ds: number[] = [];
  for (let j = 0; j < m; j++) ds.push(primes.reduce((acc, p, i) => acc * p ** (perPrime[i][j] ?? 0), 1));
  ds.reverse();
  if (ds.reduce((a, b) => a * b, 1) !== n) throw new DiscreteError("Cross-check failed: the invariant factors do not multiply to |G| — a defect in this tool.");
  return ds;
}

export const abelianName = (ds: number[]): string => (ds.length ? ds.map(cyclicName).join(" × ") : cyclicName(1));

export interface Invariants {
  n: number;
  orders: number[];
  stats: Map<number, number>;
  abelian: boolean;
  centerSize: number;
  classCount: number;
  subgroupCount: number | null;
}

export function invariants(G: FiniteGroup): Invariants {
  const orders = allOrders(G);
  return {
    n: G.n, orders, stats: orderStats(G, orders), abelian: nonCommutingPair(G) === null, centerSize: center(G).length,
    classCount: conjugacyClasses(G).length, subgroupCount: G.n <= MAX_ALL_SUBGROUPS_ORDER ? allSubgroups(G).length : null,
  };
}

/** The groups of each order ≤ 15, by name (built lazily — never at module load). */
export function catalogue(n: number): { name: string; build: () => FiniteGroup }[] {
  const ab: Record<number, number[][]> = {
    1: [[]], 2: [[2]], 3: [[3]], 4: [[4], [2, 2]], 5: [[5]], 6: [[6]], 7: [[7]], 8: [[8], [2, 4], [2, 2, 2]], 9: [[9], [3, 3]],
    10: [[10]], 11: [[11]], 12: [[12], [2, 6]], 13: [[13]], 14: [[14]], 15: [[15]],
  };
  if (!(n in ab)) return [];
  const out: { name: string; build: () => FiniteGroup }[] = ab[n].map((ds) => ({
    name: abelianName(ds),
    build: () => (ds.length <= 1 ? cyclicGroup(ds[0] ?? 1) : productGroup(ds.map(cyclicGroup))),
  }));
  if (n === 6) out.push({ name: "S₃", build: () => symmetricGroup(3) });
  if (n === 8) out.push({ name: "D₄", build: () => dihedralGroup(4) }, { name: "Q₈", build: () => quaternionGroup() });
  if (n === 10) out.push({ name: "D₅", build: () => dihedralGroup(5) });
  if (n === 12) out.push({ name: "A₄", build: () => alternatingGroup(4) }, { name: "D₆", build: () => dihedralGroup(6) }, { name: "Dic₃", build: () => dicyclicGroup(3) });
  if (n === 14) out.push({ name: "D₇", build: () => dihedralGroup(7) });
  return out;
}

/** Number of groups of each order 1…32 (OEIS A000001), for naming what the built-in list does not hold. */
export const GROUP_COUNTS = [0, 1, 1, 1, 2, 1, 2, 1, 5, 2, 2, 1, 5, 1, 2, 1, 14, 1, 5, 1, 5, 2, 2, 1, 15, 2, 2, 5, 4, 1, 4, 1, 51];

export const MAX_DECIDED_ORDER = 15;

export interface Identification {
  name: string;
  /** "abelian" — invariant factors; "small" — |G| ≤ 15 by order statistics; null — undecided. */
  how: "abelian" | "small" | null;
  factors?: number[];
}

export function identify(G: FiniteGroup, inv = invariants(G)): Identification {
  if (inv.abelian) {
    const ds = invariantFactors(G.n, inv.orders);
    return { name: abelianName(ds), how: "abelian", factors: ds };
  }
  if (G.n <= MAX_DECIDED_ORDER) {
    const key = statsKey(inv.stats);
    for (const c of catalogue(G.n)) {
      const K = c.build();
      if (statsKey(orderStats(K)) === key) return { name: c.name, how: "small" };
    }
    throw new DiscreteError(`Cross-check failed: a group of order ${G.n} matches no entry of the built-in list — a defect in this tool.`);
  }
  return { name: "", how: null };
}

export interface IsoVerdict {
  verdict: "isomorphic" | "not" | "undecided";
  reason: string;
  setA: [string, string];
  setB: [string, string];
}

const countWord = (c: number): string => (c === 0 ? "none" : String(c));

export function compareGroups(G: FiniteGroup, K: FiniteGroup): IsoVerdict {
  const a = invariants(G), b = invariants(K);
  const setB = (x: Invariants): string => `${x.abelian ? "abelian" : "non-abelian"}, |Z| = ${x.centerSize}, ${x.classCount} conjugacy classes${x.subgroupCount !== null ? `, ${x.subgroupCount} subgroups` : ""}`;
  const setA: [string, string] = [`${G.name}: ${statsText(a.stats)}`, `${K.name}: ${statsText(b.stats)}`];
  const sb: [string, string] = [`${G.name}: ${setB(a)}`, `${K.name}: ${setB(b)}`];
  if (G.n !== K.n) return { verdict: "not", reason: `NOT isomorphic: |${G.name}| = ${G.n} but |${K.name}| = ${K.n}.`, setA, setB: sb };
  if (statsKey(a.stats) !== statsKey(b.stats)) {
    const ordersAll = [...new Set([...a.stats.keys(), ...b.stats.keys()])].sort((x, y) => y - x);
    // The most telling difference: the largest order whose counts differ.
    const d = ordersAll.find((o) => (a.stats.get(o) ?? 0) !== (b.stats.get(o) ?? 0))!;
    const ca = a.stats.get(d) ?? 0, cb = b.stats.get(d) ?? 0;
    const many = (c: number): string => (c === 0 ? "no elements" : c === 1 ? "1 element" : `${c} elements`);
    return { verdict: "not", reason: `NOT isomorphic: ${G.name} has ${many(ca)} of order ${d} and ${K.name} has ${countWord(cb)}.`, setA, setB: sb };
  }
  const bDiff = a.abelian !== b.abelian ? "abelian flag" : a.centerSize !== b.centerSize ? "centre size" : a.classCount !== b.classCount ? "class count" : a.subgroupCount !== b.subgroupCount ? "subgroup count" : null;
  if (bDiff) {
    if ((a.abelian && b.abelian) || G.n <= MAX_DECIDED_ORDER) {
      throw new DiscreteError(`Cross-check failed: the order statistics agree but the ${bDiff} differs, which the completeness claim rules out — a defect in this tool, so no verdict is printed.`);
    }
    return { verdict: "not", reason: `NOT isomorphic: the ${bDiff} differs (${sb[0]}; ${sb[1]}).`, setA, setB: sb };
  }
  if (a.abelian && b.abelian) {
    const ds = invariantFactors(G.n, a.orders);
    return { verdict: "isomorphic", reason: `isomorphic: both abelian with invariant factors ${ds.join(", ") || "none (trivial)"} — ${abelianName(ds)} (the classification of finite abelian groups).`, setA, setB: sb };
  }
  if (G.n <= MAX_DECIDED_ORDER) {
    return { verdict: "isomorphic", reason: `isomorphic: the order statistics agree, and for |G| ≤ ${MAX_DECIDED_ORDER} they separate every pair of groups of the same order.`, setA, setB: sb };
  }
  return { verdict: "undecided", reason: `the invariants agree; whether the groups are isomorphic cannot be decided here (|G| = ${G.n} > ${MAX_DECIDED_ORDER}: from order 16 on, the order statistics no longer separate groups — ℤ/8ℤ × ℤ/2ℤ and M₁₆ share them).`, setA, setB: sb };
}
