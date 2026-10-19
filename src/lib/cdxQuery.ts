/**
 * Atom and bond properties beyond element and order — query features, atom lists, enhanced-stereo groups —
 * between ChemDraw's CDXML attributes (CDX SDK property reference: RingBondCount, SubstituentsExactly,
 * SubstituentsUpTo, FreeSites, UnsaturatedBonds, ElementList, EnhancedStereoType / EnhancedStereoGroupNum,
 * bond Topology, a bond Order listing several orders) and OpenChemLib's query features.
 *
 * Only what both sides can say exactly is converted; anything else is refused by name, never dropped. OCL
 * turns a Molecule into a query structure the moment a query feature or atom list is set (and then counts
 * no implicit hydrogens), so the converter applies these last.
 */
import { Molecule } from "openchemlib/full";

export type Attrs = Record<string, string>;

// OCL atom query-feature bits (all below 2^31, so they combine with | safely).
const NOT_CHAIN = 8, NOT2RB = 16, NOT3RB = 32, NOT4RB = 64;
const NO_MORE = 2048;
const NOT0P = 16384, NOT1P = 32768, NOT2P = 65536;
const NB = [131072, 262144, 524288, 1048576, 2097152]; // not 0, 1, 2, 3, 4-or-more heavy neighbours
// OCL bond query-feature bits.
const BQ_SINGLE = 1, BQ_DOUBLE = 2, BQ_TRIPLE = 4, BQ_DELOC = 8, BQ_NOT_RING = 128, BQ_RING = 256;

/** RingBondCount ↔ OCL's ring-state bits (each "not" bit excludes one count: 0, 2, 3, 4 or more). */
const RING_BONDS: Array<[string, number]> = [
  ["NoRingBonds", NOT2RB | NOT3RB | NOT4RB],
  ["SimpleRing", NOT_CHAIN | NOT3RB | NOT4RB],
  ["Fusion", NOT_CHAIN | NOT2RB | NOT4RB],
  ["SpiroOrHigher", NOT_CHAIN | NOT2RB | NOT3RB],
];
const UNSATURATION: Array<[string, number]> = [
  ["MustBeAbsent", NOT1P | NOT2P],
  ["MustBePresent", NOT0P],
];
/** Exactly k (k = 0…3) substituents: every neighbour count but k excluded. */
const exactly = (k: number): number => NB.reduce((m, bit, i) => (i === k ? m : m | bit), 0);
/** Up to k (k = 1…3): the counts above k excluded. */
const upTo = (k: number): number => NB.slice(k + 1).reduce((m, bit) => m | bit, 0);

/** The atom-level query attributes this module reads (a node carrying one makes the structure a query). */
export const ATOM_QUERY_ATTRS = ["RingBondCount", "SubstituentsExactly", "SubstituentsUpTo", "FreeSites", "UnsaturatedBonds"] as const;

const ORDER_BITS: Record<string, number> = { "1": BQ_SINGLE, "2": BQ_DOUBLE, "3": BQ_TRIPLE, "1.5": BQ_DELOC };
const BOND_TYPE: Record<string, number> = { "1": Molecule.cBondTypeSingle, "2": Molecule.cBondTypeDouble, "3": Molecule.cBondTypeTriple, "1.5": Molecule.cBondTypeDelocalized };

/** Whether a bond's Order lists several orders (a query bond). */
export const isQueryOrder = (order: string | undefined): boolean => /\s/.test((order ?? "").trim());

/** The orders a bond's Order lists, refused by name when one has no query form here. */
export function queryOrders(order: string): string[] | string {
  const parts = order.trim().split(/\s+/);
  for (const o of parts) if (!(o in ORDER_BITS)) return `a query bond lists order ${JSON.stringify(o)}, which has no query form here (single, double, triple and aromatic do)`;
  return parts;
}

/** A query bond's base type (the first order listed) for OCL's addBond. */
export const baseBondType = (orders: string[]): number => BOND_TYPE[orders[0]];

/** The ElementList attribute (or the label text "[N,O]", "NOT [F,Cl]") as atomic numbers. */
export function parseElementList(attr: string | undefined, label: string, atomicNumber: (s: string) => number | null): { list: number[]; not: boolean } | string {
  let not = false;
  let nums: number[] = [];
  if (attr && attr.trim()) {
    const parts = attr.trim().split(/\s+/);
    if (parts[0] === "NOT") (not = true), parts.shift();
    nums = parts.map(Number);
  } else {
    const m = /^\s*(NOT\s*)?\[?\s*([A-Z][a-z]?(?:\s*,\s*[A-Z][a-z]?)*)\s*\]?\s*$/.exec(label);
    if (!m) return `the atom list ${JSON.stringify(label)} does not name its elements`;
    not = !!m[1];
    for (const s of m[2].split(/\s*,\s*/)) {
      const z = atomicNumber(s);
      if (z === null) return `the atom list ${JSON.stringify(label)} names ${JSON.stringify(s)}, which is not an element`;
      nums.push(z);
    }
  }
  if (!nums.length || nums.some((z) => !Number.isInteger(z) || z < 1 || z > 118)) return "an atom list names something that is not an element";
  if (!not && nums.length < 2) return "an atom list of one element is that element — draw it as the atom";
  return { list: [...new Set(nums)], not };
}

/** The text ChemDraw-style for a list: [N,O] or NOT [F,Cl,Br]. */
export const elementListLabel = (list: number[], not: boolean, symbol: (z: number) => string): string => `${not ? "NOT " : ""}[${list.map(symbol).join(",")}]`;

/**
 * Applies a node's query attributes to atom a. `ringBondsDrawn` gives the drawn count for RingBondCount
 * "AsDrawn". Null when done; a refusal names what has no exact form.
 */
export function applyAtomQuery(mol: Molecule, a: number, attrs: Attrs, ringBondsDrawn: () => number): string | null {
  let bits = 0;
  const rb = attrs.RingBondCount;
  if (rb && rb !== "Unspecified" && rb !== "-1") {
    let key = rb;
    if (rb === "AsDrawn" || rb === "1") {
      const k = ringBondsDrawn();
      key = k === 0 ? "NoRingBonds" : k === 2 ? "SimpleRing" : k === 3 ? "Fusion" : "SpiroOrHigher";
    }
    const named: Record<string, string> = { "0": "NoRingBonds", "2": "SimpleRing", "3": "Fusion", "4": "SpiroOrHigher" };
    const hit = RING_BONDS.find(([n]) => n === (named[key] ?? key));
    if (!hit) return `a ring-bond count of ${JSON.stringify(rb)} has no query form here`;
    bits |= hit[1];
  }
  const ex = attrs.SubstituentsExactly, up = attrs.SubstituentsUpTo;
  if (ex !== undefined && up !== undefined) return "an atom says both “exactly” and “up to” so many substituents";
  if (ex !== undefined) {
    const k = Number(ex);
    if (!(Number.isInteger(k) && k >= 0 && k <= 3)) return `exactly ${ex} substituents has no query form here (0 to 3 do)`;
    bits |= exactly(k);
  }
  if (up !== undefined) {
    const k = Number(up);
    if (!(Number.isInteger(k) && k >= 0 && k <= 3)) return `up to ${up} substituents has no query form here (0 to 3 do)`;
    bits |= k === 0 ? exactly(0) : upTo(k);
  }
  const fs = attrs.FreeSites;
  if (fs !== undefined) {
    if (fs !== "0") return `${fs} free sites has no query form here (0 — no more substituents than drawn — does)`;
    bits |= NO_MORE;
  }
  const un = attrs.UnsaturatedBonds;
  if (un && un !== "Unspecified" && un !== "0") {
    const named: Record<string, string> = { "1": "MustBeAbsent", "2": "MustBePresent" };
    const hit = UNSATURATION.find(([n]) => n === (named[un] ?? un));
    if (!hit) return `an unsaturation of ${JSON.stringify(un)} has no query form here`;
    bits |= hit[1];
  }
  if (bits) mol.setAtomQueryFeature(a, bits, true);
  return null;
}

/** A node's enhanced-stereo group: OCL's ESR type and 0-based group, or null for absolute / none. */
export function stereoGroupOf(attrs: Attrs): { type: number; group: number } | null | string {
  const t = attrs.EnhancedStereoType;
  if (!t || t === "Unspecified" || t === "None" || t === "Absolute" || t === "0" || t === "1" || t === "2") return null;
  const type = t === "Or" || t === "3" ? Molecule.cESRTypeOr : t === "And" || t === "4" ? Molecule.cESRTypeAnd : -1;
  if (type < 0) return `an enhanced-stereo type ${JSON.stringify(t)} has no form here`;
  const g = attrs.EnhancedStereoGroupNum === undefined ? 1 : Number(attrs.EnhancedStereoGroupNum);
  if (!(Number.isInteger(g) && g >= 1 && g <= Molecule.cESRMaxGroups)) return `an enhanced-stereo group numbered ${attrs.EnhancedStereoGroupNum} has no form here (1 to ${Molecule.cESRMaxGroups} do)`;
  return { type, group: g - 1 };
}

/** Applies a bond's Topology and its query orders to bond b. */
export function applyBondQuery(mol: Molecule, b: number, attrs: Attrs): string | null {
  let bits = 0;
  const t = attrs.Topology;
  if (t && t !== "Unspecified" && t !== "RingOrChain" && t !== "0" && t !== "3") {
    if (t === "Ring" || t === "1") bits |= BQ_RING;
    else if (t === "Chain" || t === "2") bits |= BQ_NOT_RING;
    else return `a bond topology of ${JSON.stringify(t)} has no query form here`;
  }
  if (isQueryOrder(attrs.Order)) {
    const orders = queryOrders(attrs.Order!);
    if (typeof orders === "string") return orders;
    for (const o of orders) bits |= ORDER_BITS[o];
  }
  if (bits) mol.setBondQueryFeature(b, bits, true);
  return null;
}

/** The names of OCL atom query features with no CDXML form. */
const UNMAPPED_ATOM: Array<[string, string]> = [
  ["aromatic", "aromatic"], ["notAromatic", "not aromatic"], ["moreNeighbours", "more substituents than drawn"], ["matchStereo", "match stereo"],
  ["not0Hydrogen", "a hydrogen count"], ["not1Hydrogen", "a hydrogen count"], ["not2Hydrogen", "a hydrogen count"], ["not3Hydrogen", "a hydrogen count"],
  ["notChargeNeg", "a charge restriction"], ["notCharge0", "a charge restriction"], ["noChargePos", "a charge restriction"],
  ["ringSize0", "a ring size"], ["ringSize3", "a ring size"], ["ringSize4", "a ring size"], ["ringSize5", "a ring size"], ["ringSize6", "a ring size"], ["ringSize7", "a ring size"], ["ringSizeLarge", "a ring size"],
];

/** Atom a's query features as CDXML attributes, or a refusal naming the one with no ChemDraw form. */
export function atomQueryAttrs(mol: Molecule, a: number): Attrs | string {
  const q = mol.getAtomQueryFeaturesObject(a) as unknown as Record<string, boolean>;
  const out: Attrs = {};
  for (const [k, name] of UNMAPPED_ATOM) if (q[k]) return `an atom carries a query feature (${name}) that ChemDraw has no form for`;
  const ring = (q.notChain ? NOT_CHAIN : 0) | (q.not2RingBonds ? NOT2RB : 0) | (q.not3RingBonds ? NOT3RB : 0) | (q.not4RingBonds ? NOT4RB : 0);
  if (ring) {
    const hit = RING_BONDS.find(([, v]) => v === ring);
    if (!hit) return "an atom allows several ring-bond counts, which ChemDraw can say only one at a time";
    out.RingBondCount = hit[0];
  }
  const nb = NB.reduce((m, bit, i) => (q[["not0Neighbours", "not1Neighbour", "not2Neighbours", "not3Neighbours", "not4Neighbours"][i]] ? m | bit : m), 0);
  if (nb) {
    let done = false;
    for (let k = 0; k <= 3 && !done; k++) if (nb === exactly(k)) (out.SubstituentsExactly = String(k)), (done = true);
    for (let k = 1; k <= 3 && !done; k++) if (nb === upTo(k)) (out.SubstituentsUpTo = String(k)), (done = true);
    if (!done) return "an atom's substituent count has no ChemDraw form (exactly 0–3 or up to 1–3 do)";
  }
  if (q.noMoreNeighbours) out.FreeSites = "0";
  const pi = (q.not0PiElectrons ? NOT0P : 0) | (q.not1PiElectron ? NOT1P : 0) | (q.not2PiElectrons ? NOT2P : 0);
  if (pi) {
    const hit = UNSATURATION.find(([, v]) => v === pi);
    if (!hit) return "an atom's π-electron restriction has no ChemDraw form (saturated or unsaturated do)";
    out.UnsaturatedBonds = hit[0];
  }
  return out;
}

/** Bond b's query features as CDXML attributes (Topology, Order listing several), or a refusal. */
export function bondQueryAttrs(mol: Molecule, b: number, ownOrder: string): Attrs | string {
  const q = mol.getBondQueryFeaturesObject(b) as unknown as Record<string, boolean | number>;
  for (const [k, name] of [["aromatic", "aromatic"], ["nonAromatic", "not aromatic"], ["metalLigand", "metal–ligand"], ["quadruple", "quadruple"], ["quintuple", "quintuple"]] as const)
    if (q[k]) return `a bond carries a query feature (${name}) that ChemDraw has no form for`;
  if (q.ringSize || q.brigdeMin || q.brigdeSpan) return "a bond carries a query feature (ring size or bridge) that ChemDraw has no form for";
  const raw = Number(mol.getBondQueryFeatures(b));
  if (raw & 1048576) return "a bond carries a query feature (match stereo) that ChemDraw has no form for";
  const out: Attrs = {};
  if (q.ring && q.notRing) return "a bond is required to be both in a ring and not";
  if (q.ring) out.Topology = "Ring";
  else if (q.notRing) out.Topology = "Chain";
  const listed = [["1", q.single], ["2", q.double], ["3", q.triple], ["1.5", q.delocalized]].filter(([, on]) => on).map(([o]) => o as string);
  if (listed.length) {
    // The orders OCL lists are the ones the bond may be; its own order leads where it is one of them.
    const orders = listed.includes(ownOrder) ? [ownOrder, ...listed.filter((o) => o !== ownOrder)] : listed;
    if (orders.length > 1 || orders[0] !== ownOrder) out.Order = orders.join(" ");
  }
  return out;
}

/** Short marks for a node's query attributes, as drawn beside the atom (MDL's s / rb / u notation). */
export function atomQueryMarks(attrs: Attrs): string[] {
  const m: string[] = [];
  if (attrs.SubstituentsExactly !== undefined) m.push(`s${attrs.SubstituentsExactly}`);
  if (attrs.SubstituentsUpTo !== undefined) m.push(`s≤${attrs.SubstituentsUpTo}`);
  if (attrs.FreeSites === "0") m.push("s*");
  const rb: Record<string, string> = { NoRingBonds: "rb0", SimpleRing: "rb2", Fusion: "rb3", SpiroOrHigher: "rb4+", AsDrawn: "rb*", "0": "rb0", "2": "rb2", "3": "rb3", "4": "rb4+", "1": "rb*" };
  if (attrs.RingBondCount && rb[attrs.RingBondCount]) m.push(rb[attrs.RingBondCount]);
  if (attrs.UnsaturatedBonds === "MustBePresent" || attrs.UnsaturatedBonds === "2") m.push("u");
  if (attrs.UnsaturatedBonds === "MustBeAbsent" || attrs.UnsaturatedBonds === "1") m.push("u0");
  return m;
}

/** Short marks for a bond's query attributes (S/D, ring, chain). */
export function bondQueryMarks(attrs: Attrs): string[] {
  const m: string[] = [];
  if (isQueryOrder(attrs.Order)) {
    const names: Record<string, string> = { "1": "S", "2": "D", "3": "T", "1.5": "A" };
    const parts = attrs.Order!.trim().split(/\s+/);
    m.push(parts.length >= 4 && ["1", "2", "3", "1.5"].every((o) => parts.includes(o)) ? "Any" : parts.map((o) => names[o] ?? o).join("/"));
  }
  if (attrs.Topology === "Ring" || attrs.Topology === "1") m.push("ring");
  if (attrs.Topology === "Chain" || attrs.Topology === "2") m.push("chain");
  return m;
}

/** A stereo group as drawn beside its centre: &1, or1. */
export function stereoGroupMark(attrs: Attrs): string | null {
  const t = attrs.EnhancedStereoType;
  const g = attrs.EnhancedStereoGroupNum ?? "1";
  if (t === "And" || t === "4") return `&${g}`;
  if (t === "Or" || t === "3") return `or${g}`;
  return null;
}
