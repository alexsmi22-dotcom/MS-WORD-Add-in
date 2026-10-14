// Group, permutation and homomorphism verbs (v2.134.0, SCOPE-ABSTRACT-ALGEBRA
// §B) — the readers (group names, elements, subgroups) and every verb that
// answers about a finite group. The front door is algebra.ts; this module
// never runs anything at load time (the import-cycle rule: discrete.ts
// imports every engine, every engine imports DiscreteError from discrete.ts).

import { DiscreteResult, DiscreteError } from "./discrete";
import {
  FiniteGroup, MAX_ORDER, MAX_ALL_SUBGROUPS_ORDER, op, cyclicGroup, unitsGroup, symmetricGroup, alternatingGroup, dihedralGroup, dicyclicGroup,
  quaternionGroup, kleinGroup, productGroup, power, elementOrder, allOrders, generated, subgroupWitness, cosets, normalWitness,
  nonCommutingPair, center, conjugacyClasses, generatorsOf, allSubgroups, coveringEdges, quotientGroup, orderStats, invariants, identify,
  compareGroups, catalogue, statsKey, statsText, GROUP_COUNTS, MAX_DECIDED_ORDER, abelianName, invariantFactors, smallGenerators,
  subDigits, supDigits, splitTop, gcdN, Subgroup, cyclicName,
} from "./algebraGroups";
import {
  Perm, MAX_DEGREE, parsePermProduct, composeFactors, cycleString, cycleType, permOrder, permSign, transpositions, inversePerm, oneLine,
  parseOneLine, assertPermRoundTrip, permEqual, composePerm, extendPerm, permCycles, lcmN, identityPerm, powerPerm,
} from "./algebraPerm";
import { parseAlgExpr, evalIntMod, Ast } from "./algebraFields";
import { cayleyTableSvg, MAX_TABLE, TableTooWideError } from "./cayleyTableSvg";
import { treeSvg } from "./treeSvg";
import { graphSvg, buildGraph } from "./graphs";

export const res = (title: string, display: string[], steps: string[] = [], caveats: string[] = [], svg?: string, alt?: string): DiscreteResult =>
  svg ? { title, display, steps, caveats, svg, alt: alt ?? title } : { title, display, steps, caveats };

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
const POLYGON: Record<number, string> = { 3: "triangle", 4: "square", 5: "pentagon", 6: "hexagon", 7: "heptagon", 8: "octagon", 9: "nonagon", 10: "decagon", 12: "dodecagon" };
const polygon = (n: number): string => POLYGON[n] ?? `regular ${n}-gon`;
const phiN = (n: number): number => { let c = 0; for (let k = 1; k <= n; k++) if (gcdN(k, n) === 1) c++; return n === 1 ? 1 : c; };

// ---------------------------------------------------------------------------
// The group reader

export interface GroupSpec {
  name: string;
  order: bigint;
  build: () => FiniteGroup;
  /** Convention notes and caveats the reader wants said. */
  caveats: string[];
  /** ℤ/n factors (for CRT): the moduli in order, or null when a factor is not cyclic-by-name. */
  cyclicFactors: number[] | null;
  /** The direct factors by name (a product), for the factor-swap isomorphism. */
  factorNames?: string[];
}

export interface ReadContext {
  /** The verb says "of order N" / "of the square" — resolves the Dₙ convention. */
  dihedralOrderHint?: number;
  squareHint?: boolean;
}

/** A typed number shown as typed (separators), cut in the middle with its digit count when very long. */
export function fmtBig(n: bigint): string {
  const s = n.toString();
  return s.length > 60 ? `${s.slice(0, 20)}…${s.slice(-10)} (${s.length} digits)` : n.toLocaleString("en-US");
}

function capRefuse(name: string, orderText: string): never {
  throw new DiscreteError(`${name} has order ${orderText} — above the cap |G| ≤ ${MAX_ORDER} for concrete groups (S₅ and A₅ are in; S₆ is not). Nothing was enumerated.`);
}

function capCheck(name: string, order: bigint): void {
  if (order > BigInt(MAX_ORDER)) capRefuse(name, fmtBig(order));
}

/** The number exactly as typed — never substituted (W1). */
const bigOf = (d: string): bigint => BigInt(d);

/** One factor of a product. Returns null when the text is not a group name; throws for a named group outside the scope. */
function readFactor(f0: string, ctx: ReadContext): GroupSpec | null {
  let f = f0.trim().replace(/^(?:the\s+)?(?:group\s+)?/i, "").trim();
  let m: RegExpExecArray | null;
  const wrap = /^\(\s*(.+?)\s*,\s*[+*·×]\s*\)$/.exec(f);
  if (wrap) f = wrap[1];
  if (/^\(.*\)$/.test(f) && !/^\(\s*Z/.test(f)) {
    const inner = f.slice(1, -1);
    if (splitTop(inner).length === 1) f = inner.trim();
  }
  // S0, A00, D654321: a leading zero or a five-digit index is a label (a
  // table column, a citation), not a group name — not claimed.
  if (/^(?:S|Sym|A|D|Dic)_?\s*\(?\s*(?:0\d*|\d{5,})\s*\)?$/.test(f)) return null;
  const cyclicSpec = (d: string): GroupSpec => {
    const n = bigOf(d);
    if (n === 0n) throw new DiscreteError("ℤ/0ℤ is ℤ itself, an infinite group — only finite groups are read here.");
    capCheck(`ℤ/${fmtBig(n).replace(/,/g, "")}ℤ`, n);
    const k = Number(n);
    return { name: cyclicName(k), order: n, build: () => cyclicGroup(k), caveats: [], cyclicFactors: [k] };
  };
  if (/^Z\s*\/\s*-\s*\d+\s*Z?$/.test(f) || /^U\s*\(\s*-\s*\d+\s*\)$/.test(f)) throw new DiscreteError("A modulus must be a positive integer — ℤ/nℤ and U(n) take n ≥ 1.");
  if ((m = /^Z\s*\/\s*(\d+)\s*Z?$/.exec(f)) || (m = /^Z_?(\d+)$/.exec(f)) || (m = /^integers\s+mod(?:ulo)?\s+(\d+)$/i.exec(f)) || (m = /^cyclic\s+group\s+of\s+order\s+(\d+)$/i.exec(f))) {
    return cyclicSpec(m[1]);
  }
  if ((m = /^U\s*\(\s*(\d+)\s*\)$/.exec(f)) || (m = /^\(\s*Z\s*\/\s*(\d+)\s*Z?\s*\)\s*(?:\^\s*)?(?:\*|×)$/.exec(f)) || (m = /^(?:(?:the\s+)?(?:multiplicative\s+)?group\s+)?of\s+units\s+(?:of|mod(?:ulo)?|in)\s+(?:Z\s*\/\s*)?(\d+)\s*Z?$/i.exec(f)) || (m = /^(?:multiplicative\s+)?group\s+of\s+units\s+(?:of|mod(?:ulo)?|in)\s+(?:Z\s*\/\s*)?(\d+)\s*Z?$/i.exec(f))) {
    const n = bigOf(m[1]);
    if (n === 0n) throw new DiscreteError("U(0) is not read: the units of ℤ are {±1}; give n ≥ 1.");
    if (n > 1_000_000n) capRefuse(`U(${fmtBig(n).replace(/,/g, "")})`, `φ(n), far above ${MAX_ORDER} for n this large`);
    const k = Number(n);
    const order = phiN(k);
    capCheck(`U(${k})`, BigInt(order));
    return { name: `U(${k})`, order: BigInt(order), build: () => unitsGroup(k), caveats: k === 1 ? ["U(1): in ℤ/1ℤ the elements 0 and 1 coincide, so the group of units is the trivial group {0}."] : [], cyclicFactors: null };
  }
  if ((m = /^(?:S|Sym)_?\s*\(?\s*(\d+)\s*\)?$/.exec(f)) || (m = /^symmetric\s+group\s+(?:S_?(\d+)|on\s+(\d+)\s+(?:letters|points|symbols|elements)|of\s+degree\s+(\d+))$/i.exec(f))) {
    const d = m[1] ?? m[2] ?? m[3];
    const n = bigOf(d);
    if (n === 0n) throw new DiscreteError("S₀ is not read — give n ≥ 1.");
    const name = "S" + subDigits(d);
    if (n > 5n) capRefuse(name, n <= 20n ? fact(Number(n)).toLocaleString("en-US") : `${n}!`);
    const k = Number(n);
    return { name, order: BigInt(fact(k)), build: () => symmetricGroup(k), caveats: [], cyclicFactors: null };
  }
  if ((m = /^A_?\s*(\d+)$/.exec(f)) || (m = /^alternating\s+group\s+(?:A_?)?(\d+)$/i.exec(f))) {
    const n = bigOf(m[1]);
    if (n === 0n) throw new DiscreteError("A₀ is not read — give n ≥ 1.");
    const name = "A" + subDigits(m[1]);
    if (n > 5n) capRefuse(name, n <= 20n ? (fact(Number(n)) / 2).toLocaleString("en-US") : `${n}!/2`);
    const k = Number(n);
    return { name, order: BigInt(k <= 1 ? 1 : fact(k) / 2), build: () => alternatingGroup(k), caveats: [], cyclicFactors: null };
  }
  let dihedralIndex: number | null = null;
  let typedD = "";
  if ((m = /^D_?(\d+)$/.exec(f))) { dihedralIndex = Number(bigOf(m[1]) > 1000n ? 1001n : bigOf(m[1])); typedD = m[0]; }
  else if ((m = /^dihedral\s+group\s+D_?(\d+)$/i.exec(f))) { dihedralIndex = Number(bigOf(m[1]) > 1000n ? 1001n : bigOf(m[1])); typedD = "D_" + m[1]; }
  else if ((m = /^dihedral\s+group\s+of\s+order\s+(\d+)$/i.exec(f))) {
    const N = Number(bigOf(m[1]) > 1000n ? 1001n : bigOf(m[1]));
    if (N % 2 !== 0 || N < 2) throw new DiscreteError(`A dihedral group has even order; there is no dihedral group of order ${m[1]}.`);
    capCheck(`the dihedral group of order ${N}`, BigInt(N));
    const n = N / 2;
    return { name: "D" + subDigits(n), order: BigInt(N), build: () => dihedralGroup(n), caveats: [`The dihedral group of order ${N} is the symmetry group of the ${polygon(n)}, written D${subDigits(n)} here (the n-gon convention).`], cyclicFactors: null };
  } else if ((m = /^(?:dihedral\s+group\s+of|symmetries\s+of|symmetry\s+group\s+of)\s+(?:the\s+|a\s+)?(?:regular\s+)?(triangle|square|pentagon|hexagon|heptagon|octagon|nonagon|decagon|dodecagon|(\d+)-gon)$/i.exec(f))) {
    const byName: Record<string, number> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10, dodecagon: 12 };
    const n = m[2] ? Number(m[2]) : byName[m[1].toLowerCase()];
    capCheck(`the dihedral group of the ${polygon(n)}`, BigInt(2 * n));
    return { name: "D" + subDigits(n), order: BigInt(2 * n), build: () => dihedralGroup(n), caveats: [], cyclicFactors: null };
  }
  if (dihedralIndex !== null) {
    const idx = dihedralIndex;
    if (idx === 0) throw new DiscreteError("D₀ is not read — the dihedral group Dₙ needs n ≥ 1.");
    // The order convention (Dummit & Foote: D₂ₙ has order 2n) only when the verb says so.
    const orderConv = (ctx.dihedralOrderHint === idx && idx % 2 === 0) || (ctx.squareHint && idx === 8);
    const n = orderConv ? idx / 2 : idx;
    capCheck("D" + subDigits(n), BigInt(2 * n));
    const caveats: string[] = [];
    if (orderConv) caveats.push(`${typedD} read in the ORDER convention (Dummit & Foote): the dihedral group of order ${idx}, the symmetries of the ${polygon(n)} — written D${subDigits(n)} here.`);
    else if (n === 4 && /^D4$/.test(typedD)) caveats.push("D4 read as the symmetries of the square (order 8); derangements: write derangements 4.");
    else if (n % 2 === 0 && n >= 6) caveats.push(`${typedD} read as the symmetries of the ${polygon(n)} (order ${2 * n}); for the group of order ${n} (the ${polygon(n / 2)}) write D${n / 2} or D_${n / 2} — the two conventions differ.`);
    else caveats.push(`${typedD} read as the symmetries of the ${polygon(n)} (order ${2 * n}), the n-gon convention${/^D\d+$/.test(typedD) ? `; derangements: write derangements ${n}` : ""}.`);
    return { name: "D" + subDigits(n), order: BigInt(2 * n), build: () => dihedralGroup(n), caveats, cyclicFactors: null };
  }
  if (/^Q_?8$/.test(f) || /^quaternion\s+group$/i.test(f)) return { name: "Q₈", order: 8n, build: quaternionGroup, caveats: [], cyclicFactors: null };
  if (/^V_?4$/.test(f) || /^klein(?:[-\s]+(?:four|4))?[-\s]+group$/i.test(f) || /^klein[-\s]+(?:four|4)$/i.test(f)) return { name: "V₄", order: 4n, build: kleinGroup, caveats: [], cyclicFactors: null };
  if ((m = /^Dic_?(\d+)$/.exec(f))) {
    const n = bigOf(m[1]);
    if (n === 0n) throw new DiscreteError("Dic₀ is not read — give n ≥ 1.");
    capCheck("Dic" + subDigits(m[1]), 4n * n);
    const k = Number(n);
    return { name: "Dic" + subDigits(k), order: BigInt(4 * k), build: () => dicyclicGroup(k), caveats: [], cyclicFactors: null };
  }
  return null;
}

/** Splits a product at top-level "×", "⊕", " x ", " * ". */
function splitProduct(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (depth === 0) {
      const mm = /^(?:\s*[×⊕]\s*|\s+x\s+|\s+\*\s+)/.exec(s.slice(i));
      if (mm) { out.push(cur); cur = ""; i += mm[0].length - 1; continue; }
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Reads a group name or a product of names; null when the text is not one. */
export function readGroup(text: string, ctx: ReadContext = {}): GroupSpec | null {
  let s = text.trim().replace(/[?.]+$/, "").trim();
  if (!s || s.length > 200) return null;
  const wrap = /^\(\s*(.+?)\s*,\s*[+*·×]\s*\)$/.exec(s);
  if (wrap) s = wrap[1];
  const parts = splitProduct(s);
  if (parts.some((p) => !p)) return null;
  const specs: GroupSpec[] = [];
  for (const p of parts) {
    const g = readFactor(p, ctx);
    if (!g) return null;
    specs.push(g);
  }
  if (specs.length === 1) return specs[0];
  const order = specs.reduce((a, g) => a * g.order, 1n);
  const name = specs.map((g) => (/×/.test(g.name) ? `(${g.name})` : g.name)).join(" × ");
  capCheck(name, order);
  return {
    name, order, caveats: specs.flatMap((g) => g.caveats),
    build: () => productGroup(specs.map((g) => g.build())),
    cyclicFactors: specs.every((g) => g.cyclicFactors && g.cyclicFactors.length === 1) ? specs.map((g) => g.cyclicFactors![0]) : null,
    factorNames: specs.map((g) => g.name),
  };
}

/** Builds the group with its display name. */
export function buildSpec(spec: GroupSpec): FiniteGroup {
  const G = spec.build();
  G.name = spec.name;
  return G;
}

// ---------------------------------------------------------------------------
// Elements and subgroups

export function readElement(G: FiniteGroup, s0: string, notes?: string[]): number {
  const s = s0.trim();
  let i: number | null = null;
  i = G.read(s);
  if (i === null) throw new DiscreteError(`"${s}" is not an element of ${G.name} as written — its elements are ${G.n <= 24 ? G.labels.join(", ") : G.labels.slice(0, 12).join(", ") + ", …"}.`);
  if (notes && G.kind === "cyclic" && G.labels[i] !== s.replace(/^\+/, "")) notes.push(`${s} read as its class ${G.labels[i]} in ${G.name}.`);
  return i;
}

export const setText = (G: FiniteGroup, H: number[]): string => `{${H.map((h) => G.labels[h]).join(", ")}}`;

export interface NamedSubgroup {
  elements: number[];
  name: string;
  /** How it was given: "<…>", "{…}", A_n, centre … */
  shown: string;
  /** A name that READS BACK through readSubgroup (display contract): the set itself for {…}, Z(G) for the centre. */
  full?: string;
}

const isPermGroup = (G: FiniteGroup): boolean => G.kind === "symmetric" || G.kind === "alternating";

/** ⟨a, b⟩ · {e, (1 2)} · A3 / A_n in Sₙ · center · the rotations in Dₙ. */
export function readSubgroup(G: FiniteGroup, s0: string): NamedSubgroup | null {
  const s = s0.trim();
  let m: RegExpExecArray | null;
  if ((m = /^<\s*(.*)\s*>$/.exec(s))) {
    const gens = splitTop(m[1]).filter(Boolean).map((g) => readElement(G, g));
    const H = generated(G, gens);
    const name = `⟨${gens.map((g) => G.labels[g]).join(", ")}⟩`;
    return { elements: H, name, shown: name };
  }
  if ((m = /^\{\s*(.*)\s*\}$/.exec(s))) {
    const els = [...new Set(splitTop(m[1]).filter(Boolean).map((g) => readElement(G, g)))].sort((a, b) => a - b);
    const w = subgroupWitness(G, els);
    if (w && "noIdentity" in w) throw new DiscreteError(`${setText(G, els)} is not a subgroup of ${G.name}: it does not contain the identity ${G.labels[G.e]}.`);
    if (w) throw new DiscreteError(`${setText(G, els)} is not a subgroup of ${G.name}: ${G.labels[w.a]}${G.additive ? " + " : "·"}${G.labels[w.b]} = ${G.labels[w.ab]} is not in it (not closed).`);
    return { elements: els, name: "H", shown: `H = ${setText(G, els)}`, full: setText(G, els) };
  }
  if ((m = /^A_?(\d+)$/.exec(s)) && isPermGroup(G)) {
    const n = Number(m[1]);
    if (n !== G.param) throw new DiscreteError(`A${subDigits(n)} is not a subgroup of ${G.name} as written — the alternating group inside ${G.name} is A${subDigits(G.param!)}.`);
    const H = G.perms!.map((p, i) => (permSign(p) === 1 ? i : -1)).filter((i) => i >= 0);
    return { elements: H, name: "A" + subDigits(n), shown: `A${subDigits(n)} = ${setText(G, H)}` };
  }
  // "Z", "Z(G)", "Z(D₄)" — in a subgroup slot Z is the centre (ℤ itself is not a subgroup of a finite group).
  if (/^(?:the\s+)?(?:center|centre)(?:\s+of\s+.+)?$/i.test(s) || /^Z(?:\s*\(.*\))?$/.test(s)) {
    const H = center(G);
    return { elements: H, name: "Z", shown: `Z(${G.name}) = ${setText(G, H)}`, full: `Z(${G.name})` };
  }
  if (/^(?:the\s+)?rotations$/i.test(s) && G.kind === "dihedral") {
    const H = generated(G, [G.read("r")!]);
    return { elements: H, name: "⟨r⟩", shown: `⟨r⟩ = ${setText(G, H)}` };
  }
  if (/^(?:the\s+)?trivial(?:\s+subgroup)?$/i.test(s)) return { elements: [G.e], name: `{${G.labels[G.e]}}`, shown: `{${G.labels[G.e]}}` };
  return null;
}

// ---------------------------------------------------------------------------
// Shared text

const opWord = (G: FiniteGroup): string =>
  G.kind === "cyclic" ? "addition mod " + G.param : G.kind === "units" ? `multiplication mod ${G.param}` : isPermGroup(G) ? "composition (right to left: in στ, τ is applied first)" : G.kind === "product" ? "componentwise" : G.kind === "table" ? "the given table" : "the group operation";

const prod = (G: FiniteGroup, a: string, b: string): string =>
  G.additive ? `${a} + ${b}` : isPermGroup(G) || ((G.kind === "dihedral" || G.kind === "dicyclic") && a !== "e" && b !== "e") ? `${a}${b}` : G.kind === "units" ? `${a} · ${b}` : `${a}·${b}`;

function listLabels(G: FiniteGroup, H: number[], cap = 60): string {
  return H.length <= cap ? H.map((h) => G.labels[h]).join(", ") : H.slice(0, cap).map((h) => G.labels[h]).join(", ") + `, … (${H.length} in all)`;
}

function tableOf(G: FiniteGroup): number[][] {
  return Array.from({ length: G.n }, (_, a) => Array.from({ length: G.n }, (_, b) => op(G, a, b)));
}

function tableFigure(G: FiniteGroup, caption: string, bands?: number[]): { svg?: string; caveat?: string } {
  if (G.n > MAX_TABLE) return { caveat: `The Cayley table (${G.n * G.n} entries) is not drawn — tables are drawn for at most ${MAX_TABLE} elements.` };
  try {
    return { svg: cayleyTableSvg(G.labels, tableOf(G), { caption, identity: G.e, op: G.additive ? "+" : "·", bands }) };
  } catch (err) {
    if (err instanceof TableTooWideError) return { caveat: err.message };
    throw err;
  }
}

function textTable(labels: string[], t: number[][], opSym: string): string[] {
  return [`${opSym} | ${labels.join(" | ")}`, ...t.map((row, i) => `${labels[i]}: ${row.map((x) => labels[x]).join(" | ")}`)];
}

/** "ℤ/2ℤ × ℤ/2ℤ (the Klein four-group)" etc., plus how it was decided. */
export function isoTypeLine(G: FiniteGroup): string {
  const inv = invariants(G);
  const id = identify(G, inv);
  if (id.how === "abelian") {
    const ds = id.factors!;
    const extra = ds.length === 2 && ds[0] === 2 && ds[1] === 2 ? " (the Klein four-group)" : ds.length <= 1 ? " (cyclic)" : "";
    return `${G.name === id.name ? "isomorphism type:" : G.name + " ≅"} ${id.name}${extra} — abelian: invariant factors ${ds.length ? ds.join(", ") : "none (trivial group)"}`;
  }
  if (id.how === "small") {
    const others = catalogue(G.n).filter((c) => c.name !== id.name).map((c) => ({ c, st: orderStats(c.build()) })).filter((x) => [...x.st.keys()].length && true);
    const nonab = others.filter((x) => !invariants(x.c.build()).abelian);
    let cmp = "";
    if (nonab.length) {
      const x = nonab[0];
      const keys = [...new Set([...inv.stats.keys(), ...x.st.keys()])].sort((a, b) => a - b).filter((k) => k > 1);
      const d = keys.find((k) => (inv.stats.get(k) ?? 0) !== (x.st.get(k) ?? 0));
      const c0 = inv.stats.get(d ?? 0) ?? 0;
      if (d !== undefined) cmp = `, ${c0 === 0 ? "no elements" : c0 === 1 ? "1 element" : `${c0} elements`} of order ${d} — ${x.c.name} has ${x.st.get(d) ?? 0}`;
    }
    return `isomorphism type: ${id.name} (order ${G.n}, non-abelian${cmp}): decided, |G| ≤ ${MAX_DECIDED_ORDER}`;
  }
  const byBuild = G.kind === "symmetric" || G.kind === "alternating" || G.kind === "dihedral" || G.kind === "dicyclic";
  return byBuild
    ? `isomorphism type: ${G.name} by construction (order ${G.n}, non-abelian) — above |G| = ${MAX_DECIDED_ORDER} the type is known from how the group was built, not decided from invariants`
    : `isomorphism type: not decided here (order ${G.n} > ${MAX_DECIDED_ORDER}, non-abelian; ${statsText(inv.stats)})`;
}

const dihedralRelations = (G: FiniteGroup): string | null =>
  G.kind === "dihedral" ? `r${supDigits(G.param!)} = s² = e, srs = r⁻¹ (r = rotation by 360°/${G.param}, s = a reflection; elements rᵏ and rᵏs)` : null;

function axiomLine(G: FiniteGroup): string {
  return `Verified by brute force on the table: closure, identity ${G.labels[G.e]}, inverses, and associativity on all ${G.n}³ = ${(G.n ** 3).toLocaleString("en-US")} triples.`;
}

// ---------------------------------------------------------------------------
// Verbs

export function describeGroup(spec: GroupSpec, G = buildSpec(spec), extraCaveats: string[] = []): DiscreteResult {
  const orders = allOrders(G);
  const gens = generatorsOf(G, orders);
  const nc = nonCommutingPair(G);
  const Z = center(G);
  const display: string[] = [];
  const opSet = G.kind === "units" ? " under multiplication mod " + G.param : G.kind === "cyclic" ? " under addition mod " + G.param : isPermGroup(G) ? " under composition" : "";
  display.push(`${G.name} = {${listLabels(G, identityPermOrder(G))}}${opSet}`);
  const maxOrd = Math.max(...orders);
  display.push(gens.length ? `cyclic: yes — generators ${listLabels(G, gens, 30)}` : `cyclic: NO — no element has order ${G.n} (every element has order ≤ ${maxOrd})`);
  if (nc) {
    const [a, b] = nc;
    display.push(`abelian: NO — ${prod(G, G.labels[a], G.labels[b])} ≠ ${prod(G, G.labels[b], G.labels[a])}: ${prod(G, G.labels[a], G.labels[b])} = ${G.labels[op(G, a, b)]}, ${prod(G, G.labels[b], G.labels[a])} = ${G.labels[op(G, b, a)]}`);
  } else display.push("abelian: yes");
  display.push(`Z(${G.name}) = ${setText(G, Z)}${Z.length === 1 ? " (trivial)" : Z.length === G.n ? " (the whole group)" : ""}`);
  display.push(isoTypeLine(G));
  const steps: string[] = [];
  const rel = dihedralRelations(G);
  if (rel) steps.push(rel);
  steps.push(`Operation: ${opWord(G)}.`);
  if (G.n <= 60) steps.push(`Order of each element: ${G.labels.map((l, i) => `${l}: ${orders[i]}`).join(" · ")}`);
  const occ = [...new Set(orders)].sort((a, b) => a - b);
  steps.push(`Lagrange: orders of elements divide ${G.n}: ${occ.join(", ")} occur.`);
  steps.push(axiomLine(G));
  const caveats = [...spec.caveats, ...extraCaveats];
  const fig = tableFigure(G, `Cayley table of ${G.name}${G.additive ? " (+)" : ""}; identity cells outlined`);
  if (fig.caveat) caveats.push(fig.caveat);
  return res(`Group ${G.name} (order ${G.n}, ${gens.length ? "cyclic, " : ""}${nc ? "non-abelian" : "abelian"})`, display, steps, caveats, fig.svg, `Cayley table of ${G.name}`);
}

/** The element order as stored (the constructors already put e first and group by type). */
function identityPermOrder(G: FiniteGroup): number[] {
  return Array.from({ length: G.n }, (_, i) => i);
}

export function cayleyTableVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const t = tableOf(G);
  const display: string[] = [];
  const caveats = [...spec.caveats];
  if (G.n <= 12) display.push(...textTable(G.labels, t, G.additive ? "+" : "·"));
  else caveats.push(`The text table is printed for at most 12 elements (${G.name} has ${G.n}).`);
  const sym = nonCommutingPair(G) === null;
  const steps = [`Row a, column b holds ${prod(G, "a", "b")} (${opWord(G)}).`, sym ? "The table is symmetric about its diagonal — the group is abelian." : "The table is NOT symmetric about its diagonal — the group is non-abelian.", axiomLine(G)];
  const fig = tableFigure(G, `Cayley table of ${G.name}; identity cells outlined`);
  if (fig.caveat) caveats.push(fig.caveat);
  if (!display.length) display.push(`${G.name}: ${G.n} × ${G.n} table${fig.svg ? " (drawn)" : ""}`);
  return res(`Cayley table of ${G.name}`, display, steps, caveats, fig.svg, `Cayley table of ${G.name}`);
}

function powersText(G: FiniteGroup, g: number): string {
  const out: string[] = [];
  let x = g;
  for (let k = 0; k < G.n; k++) { out.push(G.labels[x]); if (x === G.e) break; x = op(G, x, g); }
  return out.join(", ");
}

export function orderOfElementVerb(spec: GroupSpec, elText: string): DiscreteResult {
  const G = buildSpec(spec);
  const notes: string[] = [];
  const g = readElement(G, elText, notes);
  const o = elementOrder(G, g);
  if (G.n % o !== 0) throw new DiscreteError("Cross-check failed: an element order does not divide |G| — a defect in this tool.");
  const steps = [`Successive ${G.additive ? "multiples" : "powers"}: ${powersText(G, g)} — the first return to ${G.labels[G.e]} is at step ${o}.`, `Lagrange: ${o} divides |${G.name}| = ${G.n}.`];
  const p = G.perms ? G.perms[g] : null;
  if (p) steps.push(`As a permutation: cycle type [${cycleType(p).join(", ")}], order = lcm of the cycle lengths = ${o}.`);
  return res("Element order", [`order of ${G.labels[g]} in ${G.name} = ${o} (${powersText(G, g)})`], steps, [...spec.caveats, ...notes]);
}

export function allOrdersVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const orders = allOrders(G);
  const by = new Map<number, number[]>();
  orders.forEach((o, g) => { if (!by.has(o)) by.set(o, []); by.get(o)!.push(g); });
  const keys = [...by.keys()].sort((a, b) => a - b);
  const line = keys.map((k) => `order ${k}: ${listLabels(G, by.get(k)!, 40)}`).join(" · ");
  return res(`Element orders in ${G.name}`, [line, `Lagrange: every order divides ${G.n}.`], [`Counts: ${keys.map((k) => `${by.get(k)!.length} of order ${k}`).join(", ")}.`, axiomLine(G)], spec.caveats);
}

export function elementsOfOrderVerb(spec: GroupSpec, k: number): DiscreteResult {
  const G = buildSpec(spec);
  const orders = allOrders(G);
  const els = orders.map((o, g) => (o === k ? g : -1)).filter((g) => g >= 0);
  if (!els.length) {
    const why = G.n % k !== 0 ? `${k} does not divide |${G.name}| = ${G.n} (Lagrange)` : `${k} divides ${G.n}, but no element has that order`;
    return res(`Elements of order ${k} in ${G.name}`, [`none — ${why}`], [], spec.caveats);
  }
  return res(`Elements of order ${k} in ${G.name}`, [`${listLabels(G, els)} (${els.length === 1 ? "one" : els.length})`], [`Orders of all elements: ${G.labels.map((l, i) => `${l}: ${orders[i]}`).join(" · ")}`], spec.caveats);
}

export function generatedVerb(spec: GroupSpec, gensText: string[]): DiscreteResult {
  const G = buildSpec(spec);
  const notes: string[] = [];
  const gens = gensText.map((t) => readElement(G, t, notes));
  const H = generated(G, gens);
  const name = `⟨${gens.map((g) => G.labels[g]).join(", ")}⟩`;
  if (G.n % H.length !== 0) throw new DiscreteError("Cross-check failed: |H| does not divide |G| — a defect in this tool.");
  const whole = H.length === G.n;
  const display = [whole ? `${name} = ${G.name} (the whole group)` : `${name} = ${setText(G, H)}, order ${H.length}, index ${G.n / H.length}`];
  const steps = [`Closure: start from ${G.labels[G.e]} and multiply by the generators until nothing new appears (bounded by |G| = ${G.n}).`, `Lagrange: ${H.length} divides ${G.n}; index [${G.name} : ${name}] = ${G.n / H.length}.`];
  return res("Generated subgroup", display, steps, [...spec.caveats, ...notes]);
}

function subgroupName(G: FiniteGroup, s: Subgroup): string {
  if (s.elements.length === 1) return `{${G.labels[G.e]}}`;
  if (s.elements.length === G.n) return G.name;
  if (isPermGroup(G) && G.kind === "symmetric") {
    const An = G.perms!.map((p, i) => (permSign(p) === 1 ? i : -1)).filter((i) => i >= 0);
    if (An.length === s.elements.length && An.every((x, i) => x === s.elements[i]) && G.param! >= 3) return "A" + subDigits(G.param!);
  }
  return `⟨${s.gens.map((g) => G.labels[g]).join(", ")}⟩`;
}

export function subgroupsVerb(spec: GroupSpec, opts: { order?: number; lattice?: boolean; lagrange?: boolean }): DiscreteResult {
  if (spec.order > BigInt(MAX_ALL_SUBGROUPS_ORDER)) {
    const known: Record<string, number> = { "S₅": 156, "A₅": 59, "S₄": 30 };
    const k = known[spec.name];
    throw new DiscreteError(`All subgroups of ${spec.name}${k ? ` (${k} of them)` : ""} are above the cap |G| ≤ ${MAX_ALL_SUBGROUPS_ORDER} (|${spec.name}| = ${spec.order}); ask for \`subgroup generated by …\`, \`cosets of …\`, or \`is … normal\`.`);
  }
  const G = buildSpec(spec);
  const subs = allSubgroups(G);
  const caveats = [...spec.caveats];
  const gens = generatorsOf(G);
  const cyclic = gens.length > 0;
  const divisors = Array.from({ length: G.n }, (_, i) => i + 1).filter((d) => G.n % d === 0);
  if (cyclic && subs.length !== divisors.length) throw new DiscreteError("Cross-check failed: a cyclic group must have exactly one subgroup per divisor of its order — a defect in this tool.");
  const lineOf = (s: Subgroup): string => {
    const nm = subgroupName(G, s);
    return nm === `{${G.labels[G.e]}}` ? nm : nm === G.name ? `${G.name} (the whole group)` : `${setText(G, s.elements)} = ${nm}`;
  };
  if (opts.order !== undefined) {
    const k = opts.order;
    const hit = subs.filter((s) => s.elements.length === k);
    let display: string[];
    if (hit.length) display = [`Subgroups of order ${k} in ${G.name}: ${hit.map(lineOf).join("; ")} (${hit.length})`];
    else if (G.n % k !== 0) display = [`none — ${k} does not divide ${G.n} (Lagrange)`];
    else display = [`none of order ${k} in ${G.name} even though ${k} | ${G.n}: Lagrange's converse fails`];
    return res(`Subgroups of order ${k}`, display, [`Lagrange: the order of every subgroup divides |${G.name}| = ${G.n}.`, `Every subgroup was enumerated by joining cyclic subgroups (each re-checked for closure) and those of order ${k} kept.`], caveats);
  }
  const byOrder = new Map<number, Subgroup[]>();
  for (const s of subs) { const k = s.elements.length; if (!byOrder.has(k)) byOrder.set(k, []); byOrder.get(k)!.push(s); }
  const display: string[] = [];
  for (const [k, list] of [...byOrder.entries()].sort((a, b) => a[0] - b[0])) display.push(`order ${k}: ${list.map(lineOf).join("; ")}`);
  display.push(cyclic ? `${subs.length} subgroups — one for each divisor of ${G.n} (cyclic)` : `${subs.length} subgroups`);
  const steps = [`Every subgroup is a join of cyclic subgroups: the ${new Set(subs.filter((s) => s.gens.length <= 1).map((s) => s.elements.join(","))).size} cyclic subgroups were joined until nothing new appeared; each result re-checked for closure.`, `Lagrange: the subgroup orders ${[...byOrder.keys()].sort((a, b) => a - b).join(", ")} all divide ${G.n}.`];
  if (opts.lagrange) steps.unshift(`Lagrange's theorem: for a subgroup H of a finite group G, |H| divides |G| — here every subgroup order divides ${G.n}.`);
  let svg: string | undefined;
  const edges = coveringEdges(subs);
  if (subs.length <= 40) {
    const id = (i: number): string => "H" + i;
    svg = treeSvg({
      nodes: subs.map((s, i) => ({ id: id(i), label: subgroupName(G, s), highlight: s.elements.length === 1 || s.elements.length === G.n })),
      edges: edges.map(([small, big]) => ({ from: id(big), to: id(small) })),
      caption: `Subgroup lattice of ${G.name} (Hasse diagram: ${G.name} at the top, the trivial subgroup at the bottom, covering relations only)`,
      dag: true,
    });
    steps.push(`Covering relations (by order): ${edges.map(([a, b]) => `${subs[a].elements.length}–${subs[b].elements.length}`).join(", ")}.`);
  } else caveats.push(`The lattice (${subs.length} subgroups) is not drawn — the Hasse diagram is drawn for at most 40.`);
  return res(opts.lattice ? `Subgroup lattice of ${G.name}` : `Subgroups of ${G.name}`, display, steps, caveats, svg, `Subgroup lattice of ${G.name}`);
}

export function cyclicVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const orders = allOrders(G);
  const gens = generatorsOf(G, orders);
  const iso = isoTypeLine(G);
  if (gens.length) {
    const g = gens[0];
    const pw: string[] = [];
    let x = g;
    for (let k = 1; k <= G.n && pw.length < 16; k++) { pw.push(G.additive ? `${k}·${G.labels[g]} = ${G.labels[x]}` : `${G.labels[g]}${supDigits(k)} = ${G.labels[x]}`); x = op(G, x, g); }
    return res(`Is ${G.name} cyclic?`, [`${G.name} is cyclic: generators ${listLabels(G, gens, 30)} (${pw.join(", ")}${G.n > 16 ? ", …" : ""}). ${G.name} ≅ ${cyclicName(G.n)}.`], [`An element of order |G| = ${G.n} generates G.`, iso], spec.caveats);
  }
  const els = G.labels.join(", ");
  return res(`Is ${G.name} cyclic?`, [`${G.name} is NOT cyclic: its elements ${G.n <= 24 ? els : "…"} have orders ${G.n <= 24 ? orders.join(", ") : "≤ " + Math.max(...orders)} — none has order ${G.n}, so no element of order ${G.n}. ${iso.replace(/^isomorphism type:?\s*/, "")}`], ["A group is cyclic exactly when some element has order |G|."], spec.caveats);
}

export function abelianVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const nc = nonCommutingPair(G);
  if (!nc) return res(`Is ${G.name} abelian?`, [`yes — ${G.name} is abelian (every pair commutes; checked on all ${G.n}² pairs)`], [isoTypeLine(G)], spec.caveats);
  const [a, b] = nc;
  const A = G.labels[a], B = G.labels[b];
  return res(`Is ${G.name} abelian?`, [`no — ${prod(G, A, B)} ≠ ${prod(G, B, A)}: ${prod(G, A, B)} = ${G.labels[op(G, a, b)]}, ${prod(G, B, A)} = ${G.labels[op(G, b, a)]}`], [`The first non-commuting pair in element order; Z(${G.name}) = ${setText(G, center(G))}.`], spec.caveats);
}

export function generatorsVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const gens = generatorsOf(G);
  if (gens.length) {
    const phiLine = G.kind === "cyclic" ? `φ(${G.n}) = ${gens.length} generators` : `${gens.length} generator${gens.length === 1 ? "" : "s"} (φ(${G.n}) = ${phiN(G.n)}, as for every cyclic group of order ${G.n})`;
    if (gens.length !== phiN(G.n)) throw new DiscreteError("Cross-check failed: a cyclic group of order n has φ(n) generators — a defect in this tool.");
    return res(`Generators of ${G.name}`, [`${listLabels(G, gens)} — ${phiLine}`], ["An element generates G exactly when its order is |G|."], spec.caveats);
  }
  const set = smallGenerators(G, Array.from({ length: G.n }, (_, i) => i));
  return res(`Generators of ${G.name}`, [`${G.name} is not cyclic — no single generator; a generating SET is {${set.map((g) => G.labels[g]).join(", ")}}`], [`Checked: ⟨${set.map((g) => G.labels[g]).join(", ")}⟩ = ${G.name} by closure.`], spec.caveats);
}

export function isGeneratorVerb(spec: GroupSpec, elText: string): DiscreteResult {
  const G = buildSpec(spec);
  const notes: string[] = [];
  const g = readElement(G, elText, notes);
  const o = elementOrder(G, g);
  const yes = o === G.n;
  return res(`Is ${G.labels[g]} a generator of ${G.name}?`, [`${yes ? "yes" : "no"} — ${G.labels[g]} has order ${o}${yes ? ` = |${G.name}|` : ` < |${G.name}| = ${G.n}`} (${powersText(G, g)})`], [], [...spec.caveats, ...notes]);
}

function cosetName(G: FiniteGroup, rep: number, Hname: string, side: "left" | "right"): string {
  const r = G.labels[rep];
  if (G.additive) return `${r} + ${Hname}`;
  if (rep === G.e) return Hname;
  return side === "left" ? `${r}${Hname}` : `${Hname}${r}`;
}

export function cosetsVerb(spec: GroupSpec, Htext: string, side: "left" | "right" | null): DiscreteResult {
  const G = buildSpec(spec);
  const H = readSubgroup(G, Htext);
  if (!H) throw new DiscreteError(`"${Htext}" is not read as a subgroup — write ⟨g⟩, <g, h>, {e, (1 2)}, A3, or center.`);
  const abelian = nonCommutingPair(G) === null;
  const L = cosets(G, H.elements, "left");
  const R = cosets(G, H.elements, "right");
  const hn = H.name;
  const show = (cs: number[][], sd: "left" | "right"): string[] => cs.map((c) => `${cosetName(G, c[0], hn, sd)} = ${setText(G, [...c].sort((a, b) => a - b))}`);
  const display: string[] = [];
  const steps: string[] = [];
  if (H.shown !== hn) steps.push(H.shown);
  const lag = `|G| = |H| · [G : H]: ${G.n} = ${H.elements.length} · ${L.length}`;
  if (abelian || side === "left") display.push(...show(L, "left"));
  if (side === "right") display.push(...show(R, "right"));
  if (!abelian && side === null) { display.push("Left cosets: " + show(L, "left").join(" · ")); display.push("Right cosets: " + show(R, "right").join(" · ")); }
  display.push(lag);
  if (!abelian) {
    let diff: string | null = null;
    for (const c of L) {
      const rep = c[0];
      const rc = R.find((x) => x.includes(rep))!;
      const ls = [...c].sort((a, b) => a - b).join(","), rs = [...rc].sort((a, b) => a - b).join(",");
      if (ls !== rs) { diff = `${cosetName(G, rep, hn, "left")} = ${setText(G, [...c].sort((a, b) => a - b))} but ${cosetName(G, rep, hn, "right")} = ${setText(G, [...rc].sort((a, b) => a - b))}`; break; }
    }
    display.push(diff ? `left and right cosets differ: ${diff} — so ${hn} is not normal` : `left and right cosets agree — ${hn} is normal in ${G.name}`);
  } else steps.push("In an abelian group left and right cosets coincide.");
  steps.push(`Verified: the ${L.length} cosets partition ${G.name} (pairwise disjoint, each of size ${H.elements.length}, union = G).`);
  return res(`Cosets of ${hn} in ${G.name}`, display, steps, spec.caveats);
}

export function normalVerb(spec: GroupSpec, Htext: string): DiscreteResult {
  const G = buildSpec(spec);
  const H = readSubgroup(G, Htext);
  if (!H) throw new DiscreteError(`"${Htext}" is not read as a subgroup — write ⟨g⟩, <g, h>, {e, (1 2)}, A3, or center.`);
  const w = normalWitness(G, H.elements);
  const steps = [H.shown, `Checked g·h·g⁻¹ ∈ ${H.name} for every g ∈ ${G.name}, h ∈ ${H.name}.`];
  if (w) {
    const g = G.labels[w.g], h = G.labels[w.h], c = G.labels[w.c];
    const expr = isPermGroup(G) ? `${g}${h}${g}⁻¹` : G.additive ? `${g} + ${h} − ${g}` : `${g}·${h}·${g}⁻¹`;
    return res(`Is ${H.name} normal in ${G.name}?`, [`NOT normal: ${expr} = ${c} ∉ ${H.name}`], steps, spec.caveats);
  }
  const idx = G.n / H.elements.length;
  const why = nonCommutingPair(G) === null ? "every subgroup of an abelian group is normal" : idx === 2 ? "index 2 — every subgroup of index 2 is normal" : `every conjugate stays in ${H.name}`;
  return res(`Is ${H.name} normal in ${G.name}?`, [`normal: ${why}`], steps, spec.caveats);
}

export function quotientVerb(spec: GroupSpec, Htext: string): DiscreteResult {
  const G = buildSpec(spec);
  const H = readSubgroup(G, Htext);
  if (!H) throw new DiscreteError(`"${Htext}" is not read as a subgroup — write ⟨g⟩, <g, h>, {e, (1 2)}, A3, or center.`);
  const { Q, cosetList } = quotientGroup(G, H.elements, H.full && H.full.length <= 16 ? H.full : H.name);
  Q.name = `${G.name} / ${H.full ?? H.name}`;
  const inv = invariants(Q);
  const id = identify(Q, inv);
  const gens = generatorsOf(Q, inv.orders);
  let typeLine: string;
  if (id.how === "abelian") typeLine = `${Q.name} ≅ ${id.name} (order ${Q.n}${gens.length ? `, cyclic: generated by ${Q.labels[gens[0]]}` : ""})`;
  else if (id.how === "small") typeLine = `${Q.name} ≅ ${id.name} (order ${Q.n}, non-abelian; decided, |G| ≤ ${MAX_DECIDED_ORDER})`;
  else typeLine = `${Q.name} has order ${Q.n}; its isomorphism type is not decided here`;
  const display = [`elements (cosets): ${cosetList.map((c) => setText(G, [...c].sort((a, b) => a - b))).join(", ")}`, typeLine];
  const steps = [H.shown, `${H.name} is normal in ${G.name}, so the coset product (aH)(bH) = (ab)H is well defined — checked on every pair of members.`, `|${G.name}| / |${H.name}| = ${G.n} / ${H.elements.length} = ${Q.n}.`, `The quotient's table was re-checked as a group by brute force (closure, identity, inverses, associativity).`];
  const caveats = [...spec.caveats];
  let svg: string | undefined;
  const fig = tableFigure(Q, `Cayley table of ${Q.name}`);
  svg = fig.svg;
  if (fig.caveat) caveats.push(fig.caveat);
  return res(`Quotient ${Q.name}`, display, steps, caveats, svg, `Cayley table of ${Q.name}`);
}

export function centerVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const Z = center(G);
  return res(`Centre of ${G.name}`, [`Z(${G.name}) = ${setText(G, Z)}${Z.length === 1 ? " (trivial)" : Z.length === G.n ? " (the whole group — abelian)" : ""}`], [`z ∈ Z(G) when z·g = g·z for every g — checked on all ${G.n}² pairs.`], spec.caveats);
}

const typePattern = (ct: number[]): string => {
  if (!ct.length) return "e";
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let k = 0;
  return ct.map((l) => "(" + Array.from({ length: l }, () => letters[k++ % 26]).join(" ") + ")").join("");
};

export function classesVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const cls = conjugacyClasses(G);
  const sizes = cls.map((c) => c.length);
  const display: string[] = [];
  if (G.n <= 24) display.push(...cls.map((c) => `${setText(G, c)} (size ${c.length})`));
  else display.push(`${cls.length} classes of sizes ${sizes.join(", ")}`);
  display.push(`class equation: ${G.n} = ${sizes.join(" + ")}`);
  const steps: string[] = [];
  if (isPermGroup(G) && G.kind === "symmetric") {
    const pats = cls.map((c) => typePattern(cycleType(G.perms![c[0]])));
    steps.push(`${G.name}: ${sizes.join(" + ")} = ${G.n} — classes by cycle type: ${pats.join(" · ")}`);
  }
  steps.push("Verified: every class size divides |G|, the sizes sum to |G|, and the classes of size 1 are exactly the centre.");
  return res(`Conjugacy classes of ${G.name}`, display, steps, spec.caveats);
}

export function isoTypeVerb(spec: GroupSpec): DiscreteResult {
  const G = buildSpec(spec);
  const inv = invariants(G);
  return res(`Isomorphism type of ${G.name}`, [isoTypeLine(G)], [`Order statistics: ${statsText(inv.stats)}.`, `Abelian: ${inv.abelian ? "yes" : "no"}; |Z| = ${inv.centerSize}; ${inv.classCount} conjugacy classes${inv.subgroupCount !== null ? `; ${inv.subgroupCount} subgroups` : ""}.`], spec.caveats);
}

/** Explicit CRT isomorphism ℤ/N → ℤ/n₁ × … for pairwise-coprime moduli; verified bijective and additive. */
function crtMap(N: number, mods: number[]): { lines: string[]; inverseLine: string } {
  const img = (x: number): number[] => mods.map((m) => x % m);
  const key = (v: number[]): string => v.join(",");
  const seen = new Map<string, number>();
  for (let x = 0; x < N; x++) {
    const k = key(img(x));
    if (seen.has(k)) throw new DiscreteError("Cross-check failed: the CRT map is not injective — a defect in this tool.");
    seen.set(k, x);
  }
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const lhs = img((a + b) % N), ia = img(a), ib = img(b);
    if (!lhs.every((v, i) => v === (ia[i] + ib[i]) % mods[i])) throw new DiscreteError("Cross-check failed: the CRT map is not additive — a defect in this tool.");
  }
  const tup = (v: number[]): string => `(${v.join(", ")})`;
  const lines = Array.from({ length: Math.min(N, 40) }, (_, x) => `${x} ↦ ${tup(img(x))}`);
  const last = img(N - 1);
  return { lines, inverseLine: `inverse: ${tup(last)} ↦ ${N - 1} (the unique x mod ${N} with ${mods.map((m, i) => `x ≡ ${last[i]} (mod ${m})`).join(", ")})` };
}

export function isomorphismVerb(a: GroupSpec, b: GroupSpec, crtAsked: boolean): DiscreteResult {
  const G = buildSpec(a), K = buildSpec(b);
  if (a.name === b.name && !crtAsked) {
    return res(`${G.name} ≅ ${K.name}?`, [`${G.name} ≅ ${K.name}: the same group — the identity map is an isomorphism`], [], [...a.caveats]);
  }
  // The same direct factors in another order: the coordinate permutation is an isomorphism (constructed, then checked).
  const fa = a.factorNames ?? [a.name], fb = b.factorNames ?? [b.name];
  if (!crtAsked && fa.length > 1 && fa.length === fb.length && [...fa].sort().join("|") === [...fb].sort().join("|")) {
    const used = new Set<number>();
    const perm = fa.map((nm) => { const j = fb.findIndex((x, k) => x === nm && !used.has(k)); used.add(j); return j; });
    // Map (g₁, …, gₘ) ↦ the tuple with g_i placed at position perm[i], via the labels.
    const map = G.labels.map((lab) => {
      const parts = splitTop(lab.slice(1, -1));
      const out: string[] = new Array(parts.length);
      parts.forEach((x, i) => { out[perm[i]] = x; });
      return K.labels.indexOf(`(${out.join(", ")})`);
    });
    const bij = map.every((j) => j >= 0) && new Set(map).size === K.n;
    let hom = bij;
    for (let x = 0; x < G.n && hom; x++) for (let y = 0; y < G.n && hom; y++) if (map[op(G, x, y)] !== op(K, map[x], map[y])) hom = false;
    if (hom) return res(`${G.name} ≅ ${K.name}?`, [`${G.name} ≅ ${K.name}: the same factors in another order — the coordinate swap is an isomorphism (constructed)`], [`Verified: the map is a bijection and a homomorphism on all ${G.n}² pairs.`], [...a.caveats, ...b.caveats]);
  }
  const v = compareGroups(G, K);
  const display: string[] = [];
  const steps = [`(i) element-order statistics — ${v.setA[0]}; ${v.setA[1]}`, `(ii) ${v.setB[0]}; ${v.setB[1]}`];
  // CRT: ℤ/N against a product of cyclic factors.
  const cyc = (s: GroupSpec): number[] | null => s.cyclicFactors;
  let crtDone = false;
  for (const [x, y] of [[a, b], [b, a]] as [GroupSpec, GroupSpec][]) {
    const fx = cyc(x), fy = cyc(y);
    if (!crtDone && fx && fx.length === 1 && fy && fy.length >= 2 && fy.reduce((p, q) => p * q, 1) === fx[0]) {
      const N = fx[0];
      const coprime = fy.every((m, i) => fy.every((n2, j) => i === j || gcdN(m, n2) === 1));
      const gtext = fy.length === 2 ? `gcd(${fy[0]}, ${fy[1]}) = ${gcdN(fy[0], fy[1])}` : `the moduli ${fy.join(", ")} are ${coprime ? "" : "NOT "}pairwise coprime`;
      if (coprime) {
        const { lines, inverseLine } = crtMap(N, fy);
        display.push(`${gtext}, so ${cyclicName(N)} ≅ ${fy.map(cyclicName).join(" × ")} by x ↦ (${fy.map((m) => `x mod ${m}`).join(", ")}) (Chinese remainder theorem)`);
        display.push(lines.join(", ") + (N > 40 ? ", …" : ""));
        display.push(inverseLine);
        steps.push("Verified: the map is a bijection and additive on all pairs.");
        if (v.verdict !== "isomorphic") throw new DiscreteError("Cross-check failed: the CRT map exists but the invariants disagree — a defect in this tool.");
      } else {
        if (v.verdict === "isomorphic") throw new DiscreteError("Cross-check failed: non-coprime moduli but the invariants agree — a defect in this tool.");
        display.push(`NOT isomorphic: ${fy.length === 2 ? gtext : gtext} — ${v.reason.replace(/^NOT isomorphic:\s*/, "")}`);
      }
      crtDone = true;
    }
  }
  if (!crtDone) {
    if (crtAsked) throw new DiscreteError("The Chinese remainder isomorphism is written ℤ/mnℤ ≅ ℤ/mℤ × ℤ/nℤ — give a cyclic group and a product of cyclic groups whose orders multiply to its order.");
    display.push(v.verdict === "isomorphic" ? `${G.name} ≅ ${K.name}: ${v.reason}` : v.verdict === "not" ? v.reason : `${G.name} vs ${K.name}: ${v.reason}`);
  }
  return res(`${G.name} ≅ ${K.name}?`, display, steps, [...a.caveats, ...b.caveats]);
}

export function findAllGroupsVerb(n: number): DiscreteResult {
  if (n < 1) throw new DiscreteError("Group orders are positive integers.");
  if (n > MAX_DECIDED_ORDER) {
    const c = GROUP_COUNTS[n];
    throw new DiscreteError(`Groups of order ${n}${c ? ` (${c} of them, up to isomorphism)` : ""} are beyond the built-in list, which holds every group of order ≤ ${MAX_DECIDED_ORDER}.`);
  }
  const cat = catalogue(n);
  const built = cat.map((c) => ({ name: c.name, G: c.build() }));
  const keys = built.map((b) => statsKey(orderStats(b.G)));
  if (new Set(keys).size !== keys.length) throw new DiscreteError("Cross-check failed: two listed groups share order statistics — a defect in this tool.");
  const ordersOf = (G: FiniteGroup): string => [...orderStats(G).values()].join(",");
  const word = ["", "one", "two", "three", "four", "five"][built.length] ?? String(built.length);
  return res(`Groups of order ${n}`, [`${word}: ${built.map((b) => b.name).join(" and ").replace(/ and (?=.* and )/g, ", ")}`, `order statistics ${built.map((b) => ordersOf(b.G)).join(" vs ")}`],
    [`Counts of elements by order: ${built.map((b) => `${b.name}: ${statsText(orderStats(b.G))}`).join("; ")}.`, `Up to isomorphism (OEIS A000001: ${GROUP_COUNTS[n]}).`], []);
}

export function autVerb(spec: GroupSpec): DiscreteResult {
  if (!spec.cyclicFactors || spec.cyclicFactors.length !== 1) throw new DiscreteError("Automorphism groups are not computed here; only Aut(ℤ/nℤ) ≅ U(n) is stated (the classification of automorphisms of cyclic groups).");
  const n = spec.cyclicFactors[0];
  return res(`Aut(${cyclicName(n)})`, [`Aut(${cyclicName(n)}) ≅ U(${n}) — stated, not computed: an automorphism sends 1 to a generator, and the generators are the units mod ${n}`], ["Other automorphism groups are not computed here."], []);
}

// ---------------------------------------------------------------------------
// Permutations

export interface PermRequest {
  factors: Perm[];
  factorText: string[];
  degree: number;
  leftToRight: boolean;
  notes: string[];
  inDegree?: number;
  focus: "simplify" | "inverse" | "sign" | "parity" | "type" | "order" | "diagram" | "transpositions" | "oneline" | "compose";
  label?: string;
}

function cycleDiagram(p: Perm, caption: string): string {
  const n = p.length;
  const names = Array.from({ length: n }, (_, i) => String(i + 1));
  const edges = p.map((v, i) => ({ from: String(i + 1), to: String(v + 1) }));
  const g = buildGraph(names, edges, true);
  return graphSvg(g, { caption });
}

export function permVerb(r: PermRequest): DiscreteResult {
  const deg = Math.max(r.degree, 1);
  if (deg > MAX_DEGREE) throw new DiscreteError(`Permutations are read up to degree ${MAX_DEGREE}.`);
  if (r.inDegree !== undefined && r.degree > r.inDegree) throw new DiscreteError(`${r.degree} is not a point of S${subDigits(r.inDegree)} (its points are 1 to ${r.inDegree}) — the permutation is not in S${subDigits(r.inDegree)}.`);
  const D = r.inDegree ?? deg;
  const sigma = composeFactors(r.factors, D, !r.leftToRight);
  const other = composeFactors(r.factors, D, r.leftToRight);
  // Composition cross-check: apply the factors to each point directly.
  const steps: string[] = [];
  const multi = r.factors.length > 1;
  for (let i = 0; i < D; i++) {
    let x = i;
    const trail = [x + 1];
    const order = r.leftToRight ? r.factors : [...r.factors].reverse();
    for (const f of order) { x = f[x] ?? x; trail.push(x + 1); }
    if (x !== sigma[i]) throw new DiscreteError("Cross-check failed: point-by-point application disagrees with the composed permutation — a defect in this tool.");
    if (multi && D <= 12) steps.push(trail.join(" → "));
  }
  const cs = cycleString(sigma);
  assertPermRoundTrip(cs, sigma);
  const ord = permOrder(sigma);
  const sg = permSign(sigma);
  const tr = transpositions(sigma);
  const ct = cycleType(sigma);
  const display: string[] = [];
  const typed = r.label ?? r.factorText.join("");
  const lcmText = ct.length > 1 ? `lcm(${ct.join(", ")})` : ct.length === 1 ? `the cycle length` : "the identity";
  const trText = tr.length ? tr.map(([a, b]) => `(${a} ${b})`).join("") : "e";
  const parityText = `${sg === 1 ? "even" : "odd"} (${tr.length} transposition${tr.length === 1 ? "" : "s"}: ${trText})`;
  const disjoint = multi && (() => {
    const seen = new Set<number>();
    for (const f of r.factors) for (const c of permCycles(f)) for (const x of c) { if (seen.has(x)) return false; seen.add(x); }
    return true;
  })();
  const powered = r.factors.some((f, i) => r.factorText[i].includes("^"));
  const head = disjoint && !powered ? `${cs} — already a product of disjoint cycles` : multi || powered ? `${typed} = ${cs}` : cs;
  const conv = (): string => {
    if (!multi) return "";
    const first = r.leftToRight ? r.factorText[0] : r.factorText[r.factorText.length - 1];
    const otherCs = cycleString(other);
    if (permEqual(sigma, other)) return `composed ${r.leftToRight ? "left to right" : "right to left"} (${first} applied first); the other order gives the same permutation`;
    return `composed ${r.leftToRight ? "left to right" : "right to left"}: ${first} is applied first — ${r.leftToRight ? "right to left" : "left to right"} would give ${otherCs}`;
  };
  const inv = inversePerm(sigma);
  switch (r.focus) {
    case "inverse": {
      const ics = cycleString(inv);
      assertPermRoundTrip(ics, inv);
      if (!permEqual(composePerm(sigma, inv), identityPerm(D))) throw new DiscreteError("Cross-check failed: σ·σ⁻¹ ≠ e — a defect in this tool.");
      display.push(`inverse of ${cs} = ${ics}`);
      steps.unshift(`Reverse each cycle: ${cs} → ${ics}. Verified: ${cs}${ics} = e.`);
      break;
    }
    case "sign": display.push(`sign of ${typed} = ${sg === 1 ? "+1" : "−1"} — ${parityText}`); break;
    case "parity": display.push(`${typed} is ${sg === 1 ? "even" : "odd"}, sign ${sg === 1 ? "+1" : "−1"} — ${tr.length} transposition${tr.length === 1 ? "" : "s"}: ${trText}`); break;
    case "type": display.push(`cycle type of ${typed} = [${ct.join(", ")}]${ct.length ? "" : " (the identity)"}`); break;
    case "order": display.push(`order of ${typed} = ${ord}${ct.length > 1 ? ` = ${lcmText}` : ""}`); break;
    case "transpositions": display.push(`${cs} = ${trText} (${tr.length} transposition${tr.length === 1 ? "" : "s"}, ${sg === 1 ? "even" : "odd"})`); break;
    default: display.push(head);
  }
  const c = conv();
  if (c) display.push(c);
  display.push(`order ${ord}${ct.length > 1 ? ` = ${lcmText}` : ""}, ${parityText}, sign ${sg === 1 ? "+1" : "−1"}, cycle type [${ct.join(", ")}]`);
  const top = Array.from({ length: D }, (_, i) => i + 1).join(" ");
  display.push(`two-row form: ${top} / ${oneLine(sigma)}`);
  if (r.inDegree !== undefined) display.push(`in S${subDigits(r.inDegree)}`);
  else display.push(`in S${subDigits(D)} (or S${subDigits(D + 1)}, S${subDigits(D + 2)} … with the remaining points fixed — degree taken as the largest point named)`);
  steps.push(`Order checked twice: ${lcmText === "the identity" ? "1" : lcmText} = ${ord}, and composing ${cs} with itself returns to e after ${ord} steps.`);
  steps.push(`Sign checked twice: by the ${tr.length} transpositions and by the inversions of the one-line form ${oneLine(sigma)} — both ${sg === 1 ? "even" : "odd"}.`);
  steps.push(`Display check: ${cs} re-read and compared point by point.`);
  const svg = cycleDiagram(sigma, `σ = ${cs}: i → σ(i); fixed points as loops`);
  return res(r.focus === "diagram" ? "Cycle diagram" : "Permutation", display, steps, r.notes, svg, `Cycle diagram of ${cs}`);
}

/** Reads the permutation forms; null when the text is not one. */
export function tryPermutation(t0: string): DiscreteResult | null {
  let t = t0.trim().replace(/[?.]+$/, "").trim();
  let leftToRight = false;
  const ltr = /\s*,?\s*(?:composed\s+|composing\s+|read\s+)?(left[\s-]+to[\s-]+right|right[\s-]+to[\s-]+left)\s*$/i.exec(t);
  if (ltr) { leftToRight = /^left/i.test(ltr[1]); t = t.slice(0, ltr.index).trim(); }
  let inDegree: number | undefined;
  const inS = /\s+in\s+S_?(\d+)$/.exec(t);
  if (inS) { inDegree = Number(inS[1]); t = t.slice(0, inS.index).trim(); }
  if (inDegree !== undefined && (inDegree < 1 || inDegree > MAX_DEGREE)) throw new DiscreteError(`S${subDigits(inS![1])}: permutations are read up to degree ${MAX_DEGREE}.`);
  let focus: PermRequest["focus"] = "simplify";
  let m: RegExpExecArray | null;
  const verbs: [RegExp, PermRequest["focus"]][] = [
    [/^(?:the\s+)?inverse\s+of\s+/i, "inverse"],
    [/^(?:the\s+)?sign(?:ature)?\s+of\s+/i, "sign"],
    [/^(?:the\s+)?parity\s+of\s+/i, "parity"],
    [/^(?:the\s+)?cycle\s+(?:type|structure|shape)\s+of\s+/i, "type"],
    [/^(?:the\s+)?order\s+of\s+/i, "order"],
    [/^(?:the\s+)?cycle\s+(?:diagram|graph)\s+of\s+/i, "diagram"],
    [/^(?:write\s+)?(?:the\s+)?(?:transposition\s+decomposition|decomposition\s+into\s+transpositions)\s+of\s+/i, "transpositions"],
    [/^(?:the\s+)?two[\s-]row\s+form\s+of\s+/i, "oneline"],
    [/^(?:simplify|disjoint\s+cycles\s+of|compute|evaluate)\s+/i, "simplify"],
  ];
  for (const [re, f] of verbs) if ((m = re.exec(t))) { focus = f; t = t.slice(m[0].length).trim(); break; }
  const asTr = /\s+as\s+(?:a\s+product\s+of\s+)?transpositions$/i.exec(t);
  if (asTr) { focus = "transpositions"; t = t.slice(0, asTr.index).trim(); }
  // compose A and B / A composed with B
  if ((m = /^compose\s+(.+?)\s+(?:and|with)\s+(.+)$/i.exec(t)) || (m = /^(.+?)\s+composed\s+with\s+(.+)$/i.exec(t))) {
    t = `${m[1].trim()} ${m[2].trim()}`;
    focus = "compose";
  }
  // one-line forms
  let one: Perm | null = null;
  if ((m = /^permutation\s+((?:\d+[\s,]+)+\d+)$/i.exec(t))) one = parseOneLine(m[1]);
  else if ((m = /^\[\s*((?:\d+\s+)+\d+)\s*\]$/.exec(t))) {
    // "[2 3 1]" — spaces only: "[1, 2]" is an interval and "[1, 2, 3]" a list.
    try {
      one = parseOneLine(m[1]);
    } catch (err) {
      if (err instanceof DiscreteError && focus === "simplify") return null;
      throw err;
    }
  }
  else if ((m = /^((?:\d+\s+)+\d+)\s*\/\s*((?:\d+\s+)+\d+)$/.exec(t))) {
    const top = m[1].trim().split(/\s+/).map(Number), bot = m[2].trim().split(/\s+/).map(Number);
    if (top.length !== bot.length) throw new DiscreteError("The two rows of a two-row permutation must have the same length.");
    if (top.length > MAX_DEGREE) throw new DiscreteError(`Permutations are read up to degree ${MAX_DEGREE}.`);
    const n = Math.max(...top, ...bot);
    if ([...top].sort((a, b) => a - b).join() !== [...bot].sort((a, b) => a - b).join() || new Set(top).size !== top.length || top.some((v) => v < 1)) throw new DiscreteError("The two rows must list the same points, each once.");
    one = identityPerm(n);
    top.forEach((v, i) => { one![v - 1] = bot[i] - 1; });
  }
  if (one) {
    return permVerb({ factors: [one], factorText: [cycleString(one)], degree: one.length, leftToRight: false, notes: [`One-line form read as the images of 1, 2, …, ${one.length}: ${one.map((v, i) => `${i + 1} → ${v + 1}`).join(", ")}.`], inDegree, focus: focus === "simplify" ? "oneline" : focus, label: cycleString(one) });
  }
  if (!/^\(|^(?:e|id)\b/.test(t)) return null;
  if (focus === "simplify" && !inS && !ltr) {
    // Bare forms that are something else in the rest of the product:
    // "(1, 2) (2, 3)" is a point list and "(0, 0, 1)" a vector — comma cycles
    // are read bare only when glued ")(" or joined by * / ∘; "(12)" alone is
    // the number 12 in parentheses (the digit-per-point rule needs a product).
    if (/\(\s*\d+\s*,/.test(t) && !/\)\s*[*∘·]\s*\(|\)\(/.test(t)) return null;
    if (/^\(\s*\d{2,}\s*\)(?:\s*\^\s*-?\d+)?$/.test(t)) return null;
  }
  const pp = parsePermProduct(t);
  if (!pp) return null;
  if (focus === "simplify" && !pp.factors.some((f) => /^\(\s*\d+[\s,]+\d+|^\(\d\d/.test(f.text))) return null;
  // A bare "(10 3)" — one pair, larger first — is the binomial coefficient
  // (n k) to combinatorics; a transposition is written smaller point first.
  const pair = /^\(\s*(\d+)[\s,]+(\d+)\s*\)$/.exec(t);
  if (pair && focus === "simplify" && Number(pair[1]) > Number(pair[2])) return null;
  if (pair && focus === "simplify") pp.notes.push(`A single pair (${pair[1]} ${pair[2]}) is read as the transposition; for the binomial coefficient write C(${pair[1]}, ${pair[2]}) or ${pair[1]} choose ${pair[2]}.`);
  return permVerb({ factors: pp.factors.map((f) => f.perm), factorText: pp.factors.map((f) => f.text), degree: pp.degree, leftToRight, notes: pp.notes, inDegree, focus });
}

/** "sigma = (1 2 3), tau = (1 2), sigma * tau" — named permutations, then an expression in the names. */
export function tryNamedPerms(t: string): DiscreteResult | null {
  const parts = t.split(/\n|,(?![^()]*\))|;/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const defs = new Map<string, { perm: Perm; text: string; degree: number }>();
  const notes: string[] = [];
  const NAME = String.raw`[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ω']*`;
  for (const p of parts.slice(0, -1)) {
    const m = new RegExp(`^(${NAME})\\s*=\\s*(.+)$`).exec(p);
    if (!m) return null;
    const pp = parsePermProduct(m[2]);
    if (!pp) return null;
    notes.push(...pp.notes);
    defs.set(m[1], { perm: composeFactors(pp.factors.map((f) => f.perm), pp.degree), text: cycleString(composeFactors(pp.factors.map((f) => f.perm), pp.degree)), degree: pp.degree });
  }
  let last = parts[parts.length - 1];
  let leftToRight = false;
  const ltr = /\s*,?\s*(left[\s-]+to[\s-]+right|right[\s-]+to[\s-]+left)\s*$/i.exec(last);
  if (ltr) { leftToRight = /^left/i.test(ltr[1]); last = last.slice(0, ltr.index).trim(); }
  const toks = last.split(/\s*[*∘·]\s*|\s+/).filter(Boolean);
  if (!toks.length) return null;
  const factors: Perm[] = [];
  const texts: string[] = [];
  let degree = 0;
  for (const tk of toks) {
    const m = new RegExp(`^(${NAME}?)(?:\\^\\(?(-?\\d+)\\)?)?$`).exec(tk);
    if (!m || !defs.has(m[1])) return null;
    const d = defs.get(m[1])!;
    const k = m[2] === undefined ? 1 : Number(m[2]);
    factors.push(powerPerm(d.perm, k));
    texts.push(m[2] === undefined ? `(${m[1]} = ${d.text})` : `${m[1]}^${k}`);
    degree = Math.max(degree, d.degree);
  }
  const r = permVerb({ factors, factorText: toks.map((tk) => tk), degree, leftToRight, notes, focus: factors.length > 1 ? "compose" : "simplify", label: toks.join(leftToRight ? " · " : " ") });
  r.steps.unshift(`Read: ${[...defs.entries()].map(([k, v]) => `${k} = ${v.text}`).join(", ")}.`);
  return r;
}

// ---------------------------------------------------------------------------
// Homomorphisms between ℤ/n and U(n)

export function homomorphismVerb(kind: "is" | "kernel" | "image", exprText: string, dom: GroupSpec, cod: GroupSpec): DiscreteResult {
  const G = buildSpec(dom), K = buildSpec(cod);
  const intKinds = (X: FiniteGroup): boolean => X.kind === "cyclic" || X.kind === "units";
  if (!intKinds(G) || !intKinds(K)) throw new DiscreteError("Maps are read here only between ℤ/nℤ and U(n) (x -> 2x, x -> x^2); for permutation groups the named maps are sign and conjugation, which are not computed as formulas.");
  const ast = parseAlgExpr(exprText.replace(/\s+/g, " "));
  if (!ast) throw new DiscreteError(`"${exprText}" is not read as a formula in x (e.g. 2x, 3x, x^2).`);
  const sub = (a: Ast, x: bigint): Ast => {
    switch (a.t) {
      case "var": if (a.name !== "x") throw new DiscreteError(`The map uses "${a.name}" — write it in x.`); return { t: "num", v: x };
      case "num": return a;
      case "neg": return { t: "neg", a: sub(a.a, x) };
      case "pow": return { t: "pow", a: sub(a.a, x), e: a.e };
      default: return { t: a.t, a: sub(a.a, x), b: sub(a.b, x) };
    }
  };
  const m = BigInt(G.param!), n = BigInt(K.param!);
  const f = (x: bigint): bigint => evalIntMod(sub(ast, x), n);
  const steps: string[] = [];
  const disp = `x ↦ ${exprText.trim()}`;
  // Well-definedness: representatives that differ by the modulus of G must have the same image.
  for (let i = 0; i < G.n; i++) {
    const x = BigInt(G.labels[i]);
    const a = f(x), b = f(x + m);
    if (a !== b) {
      return res("Homomorphism", [`NOT well defined: ${x} ≡ ${x + m} in ${G.name} but f(${x}) = ${a} ≠ f(${x + m}) = ${b} in ${K.name}`], [`f must give equal values on representatives of the same class.`], [...dom.caveats, ...cod.caveats]);
    }
  }
  const onGen = G.kind === "cyclic" ? ` (on the generator: ${G.param}·f(1) = ${(BigInt(G.param!) * f(1n)) % n} ≡ 0 in ${K.name}${(BigInt(G.param!) * f(1n)) % n === 0n ? "" : " — FAILS"})` : "";
  steps.push(`Well defined: f(x) = f(x + ${m}) for every representative x${onGen}.`);
  const image: number[] = [];
  for (let i = 0; i < G.n; i++) {
    const v = f(BigInt(G.labels[i]));
    const j = K.labels.indexOf(String(v));
    if (j < 0) return res("Homomorphism", [`NOT a map into ${K.name}: f(${G.labels[i]}) = ${v} is not an element of ${K.name}`], steps, []);
    image.push(j);
  }
  if (image[G.e] !== K.e) {
    return res("Homomorphism", [`NOT a homomorphism: f(${G.labels[G.e]}) = ${K.labels[image[G.e]]} ≠ ${K.labels[K.e]} (a homomorphism sends the identity to the identity)`], steps, []);
  }
  for (let a = 0; a < G.n; a++) for (let b = 0; b < G.n; b++) {
    const lhs = image[op(G, a, b)], rhs = op(K, image[a], image[b]);
    if (lhs !== rhs) {
      const o1 = G.additive ? "+" : "·", o2 = K.additive ? "+" : "·";
      return res("Homomorphism", [`NOT a homomorphism: f(${G.labels[a]} ${o1} ${G.labels[b]}) = ${K.labels[lhs]} but f(${G.labels[a]}) ${o2} f(${G.labels[b]}) = ${K.labels[rhs]}`], steps, []);
    }
  }
  steps.push(`f(a ${G.additive ? "+" : "·"} b) = f(a) ${K.additive ? "+" : "·"} f(b) checked on all ${G.n}² pairs.`);
  const ker = image.map((j, i) => (j === K.e ? i : -1)).filter((i) => i >= 0);
  const im = [...new Set(image)].sort((a, b) => a - b);
  if (ker.length * im.length !== G.n) throw new DiscreteError("Cross-check failed: |G| ≠ |ker f| · |im f| — a defect in this tool.");
  const imCyclic = K.kind === "cyclic" ? ` ≅ ${cyclicName(im.length)}` : "";
  const kerText = setText(G, ker), imText = setText(K, im);
  const display: string[] = [];
  if (kind === "is") display.push(`yes — ${disp} is a homomorphism from ${G.name} to ${K.name}`);
  if (kind === "kernel") display.push(`ker f = ${kerText}`);
  if (kind === "image") display.push(`im f = ${imText}${imCyclic}`);
  if (kind !== "kernel") display.push(`ker f = ${kerText}`);
  if (kind !== "image") display.push(`im f = ${imText}${imCyclic}`);
  display.push(`First isomorphism theorem: ${G.name} / ker f ≅ im f: ${G.name} / ${kerText} ≅ ${imText} (|G| = |ker f| · |im f|: ${G.n} = ${ker.length} · ${im.length})`);
  return res("Homomorphism", display, steps, [...dom.caveats, ...cod.caveats]);
}
