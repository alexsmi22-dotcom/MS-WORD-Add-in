/**
 * The page ↔ OpenChemLib Molecule (docs/SCOPE-CHEM-CANVAS.md, stage 1). The canvas keeps a CDXML page
 * (structures, brackets, arrows, text, as ChemDraw draws them); everything chemical the pane reports —
 * formula, SMILES, idcode, Markush, Clean, 3D — is computed by OCL from the Molecule these give. So the
 * mapping is exact or refused by name, never approximate:
 *
 *   elements, charges, isotopes, radicals, explicit H, bond orders (aromatic bonds resolved into
 *   alternating single and double bonds, or refused when they cannot be), wedges (ChemDraw's narrow end
 *   at B for …Begin, at E for …End ↔ OCL up/down from bond atom 0), wavy bonds (the double bond they meet
 *   has unknown geometry), generic atoms R1–R16 (OCL 142, 143, 144 for R1–R3 and 129–141 for R4–R16),
 *   group labels read by the side of the bond they are written on (labelExpand), abbreviations expanded
 *   from the fragment ChemDraw keeps inside them, bonded at their numbered connection points.
 *
 * A labelled atom keeps the hydrogens it is drawn with (its valence set to match when OCL's usual one
 * differs, and said in the notes); one no valence can give is refused.
 */
import { Molecule } from "openchemlib/full";
import { readCdxmlTree, type CdxDoc } from "./cdxml";
import type { XNode } from "./xmlLite";
import { findById, nextIdFrom, setAtomLabel } from "./cdxmlEdit";
import { symbolFor } from "./periodic";
import { groupSmilesBySide } from "./labelExpand";
import { applyAtomQuery, applyBondQuery, ATOM_QUERY_ATTRS, atomQueryAttrs, baseBondType, bondQueryAttrs, elementListLabel, isQueryOrder, parseElementList, queryOrders, stereoGroupOf } from "./cdxQuery";
import { atomicNumber } from "./periodic";

const elementSymbol = (z: number): string => symbolFor(z) ?? `element ${z}`;

type P2 = [number, number];

/** A double bond of unknown (either) geometry: JurisLab's own bond attribute (ChemDraw ignores it). */
export const EITHER = "JurisLabEitherGeometry";

/** R1–R16 ↔ OCL's R-group atomic numbers (the editor's: 142 = R1, 143 = R2, 144 = R3, 129 = R4 …). */
const R_TO_Z = (n: number): number => (n <= 3 ? 141 + n : 125 + n);
const Z_TO_R = (z: number): number | null => (z >= 142 && z <= 144 ? z - 141 : z >= 129 && z <= 141 ? z - 125 : null);

const RADICAL_TO_OCL: Record<string, number> = { Singlet: Molecule.cAtomRadicalStateS, Doublet: Molecule.cAtomRadicalStateD, Triplet: Molecule.cAtomRadicalStateT };
const OCL_TO_RADICAL = new Map(Object.entries(RADICAL_TO_OCL).map(([k, v]) => [v, k]));

/** Search steps allowed to resolve one page's aromatic bonds (a work bound: never freeze Word). */
const AROMATIC_STEPS = 200_000;

const posOf = (n: XNode): P2 => (n.attrs.p ?? "0 0").trim().split(/\s+/).map(Number) as P2;
const labelWords = (n: XNode): string => n.children.find((c) => c.name === "t")?.children.filter((c) => c.name === "s").map((c) => c.text).join("").replace(/\s+/g, "") ?? "";
const quoted = (s: string): string => `“${s}”`;

export interface PageMolecule {
  mol: Molecule;
  /** Which page atom (node id) each Molecule atom came from ("" for atoms of an expanded abbreviation). */
  atomIds: string[];
  /** What the reading took as drawn but is unusual (a valence the drawn hydrogens force). */
  notes: string[];
  /** The page carries query features or atom lists: the Molecule is a query structure (OCL's fragment flag). */
  query: boolean;
}

/** Which side of its one bond a label is written on: left when its neighbour lies to its right. */
/** d- and f-block metals: the atoms a drawn complex may give more bonds than a main-group valence. */
const isComplexMetal = (z: number): boolean => (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || (z >= 89 && z <= 112);

function labelSide(f: XNode, n: XNode): "left" | "right" | null {
  // The label's justification says which letter sits on the atom (ChemDraw's own rule): left-justified,
  // the first (read as written right of a bond); right-justified, the last.
  const just = n.children.find((c) => c.name === "t")?.attrs.LabelJustification;
  if (just === "Left") return "right";
  if (just === "Right") return "left";
  const b = f.children.find((q) => q.name === "b" && (q.attrs.B === n.attrs.id || q.attrs.E === n.attrs.id));
  if (!b) return null;
  const other = f.children.find((c) => c.name === "n" && c.attrs.id === (b.attrs.B === n.attrs.id ? b.attrs.E : b.attrs.B));
  if (!other) return null;
  const dx = posOf(other)[0] - posOf(n)[0];
  // A label straight above or below its bond reads left to right, bonded at its first atom.
  return dx > 1e-6 ? "left" : "right";
}

/**
 * The structures of the page (or of the given top-level objects) as one OCL Molecule, coordinates in
 * bond lengths (y down, as on the page). Refused by name when something drawn has no exact Molecule form.
 */
export function pageToMolecule(doc: CdxDoc, objectIds?: ReadonlySet<string>): { ok: true; value: PageMolecule } | { ok: false; reason: string } {
  const mol = new Molecule(32, 32);
  const atomIds: string[] = [];
  const notes: string[] = [];
  const L = doc.style.bondLength || 30;
  const index = new Map<string, number>();
  const frags: XNode[] = [];
  /** Generic atom names seen (R and R1 are different groups: never merged). */
  const generics = new Set<string>();
  const wavy: number[] = [];
  // Applied last (OCL makes the Molecule a query as soon as one is set, and then counts no hydrogens):
  // atom query features, atom lists and stereo groups by page id; bond query features by their two atoms.
  const atomProps: Array<{ id: string; attrs: Record<string, string>; list?: { list: number[]; not: boolean } }> = [];
  const bondProps: Array<{ a0: number; a1: number; attrs: Record<string, string> }> = [];
  for (const o of doc.objects) {
    if (objectIds && !objectIds.has(o.id)) continue;
    for (const it of o.items) if (it.kind === "fragment") frags.push(it.v.el);
  }
  for (const f of frags) {
    // Atoms first.
    const expanded = new Map<string, { attach: Array<{ num: number | null; atom: number }>; words: string; bondOrder: string[] }>();
    for (const n of f.children) {
      if (n.name !== "n" || !n.attrs.id) continue;
      const type = n.attrs.NodeType ?? "Element";
      const [x, y] = posOf(n);
      const degree = f.children.filter((b) => b.name === "b" && (b.attrs.B === n.attrs.id || b.attrs.E === n.attrs.id)).length;
      if (type === "Element") {
        const z = Number(n.attrs.Element ?? 6);
        if (!Number.isInteger(z) || z < 1 || z > 118) return { ok: false, reason: `an atom has element number ${n.attrs.Element}, which is not an element` };
        const a = mol.addAtom(z);
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        const q = Number(n.attrs.Charge ?? 0);
        if (q) mol.setAtomCharge(a, q);
        const iso = Number(n.attrs.Isotope ?? 0);
        if (iso) mol.setAtomMass(a, iso);
        if (n.attrs.Radical) {
          const r = RADICAL_TO_OCL[n.attrs.Radical];
          if (r === undefined) return { ok: false, reason: `a ${n.attrs.Radical} radical has no exact form in a structure` };
          mol.setAtomRadical(a, r);
        }
        index.set(n.attrs.id, a);
        atomIds.push(n.attrs.id);
        const sg = stereoGroupOf(n.attrs);
        if (typeof sg === "string") return { ok: false, reason: sg };
        if (sg || ATOM_QUERY_ATTRS.some((k) => n.attrs[k] !== undefined)) atomProps.push({ id: n.attrs.id, attrs: n.attrs });
        continue;
      }
      if (type === "ElementList") {
        // An atom standing for any one of several elements (or any but them): a query structure.
        if (n.attrs.GenericList) return { ok: false, reason: "an atom list naming generic groups has no exact form in a structure" };
        const lst = parseElementList(n.attrs.ElementList, labelWords(n), atomicNumber);
        if (typeof lst === "string") return { ok: false, reason: lst };
        // The list says which elements; the atom under it is a carbon, as OCL's own lists are.
        const a = mol.addAtom(6);
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        index.set(n.attrs.id, a);
        atomIds.push(n.attrs.id);
        atomProps.push({ id: n.attrs.id, attrs: n.attrs, list: lst });
        continue;
      }
      if (type === "GenericNickname") {
        const nick = n.attrs.GenericNickname ?? labelWords(n);
        const m = /^R(\d{0,2})$/.exec(nick);
        const k = m ? (m[1] ? Number(m[1]) : 1) : 0;
        if (!(k >= 1 && k <= 16)) return { ok: false, reason: `the generic atom ${quoted(nick || "(unnamed)")} has no single formula — R1 to R16 are read as R-groups; others (X, A, M …) make the structure generic` };
        generics.add(nick);
        if (generics.has("R") && generics.has("R1")) return { ok: false, reason: "R and R1 are both on the page — they are different groups, but read as R-groups they would be the same one; rename R as R2 (or R1 as R)" };
        const a = mol.addAtom(R_TO_Z(k));
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        index.set(n.attrs.id, a);
        atomIds.push(n.attrs.id);
        continue;
      }
      if ((type === "Unspecified" || type === "Nickname" || type === "Fragment") && !n.children.some((c) => c.name === "fragment")) {
        // A label standing for a group (OMe, CO₂H, Ph …): its structure from the table, one bond to the rest,
        // read by the side of the bond it is written on.
        const words = labelWords(n);
        if (!degree) return { ok: false, reason: `${quoted(words || "a label")} stands for a group bonded to something; alone it has no single formula` };
        if (degree > 1) return { ok: false, reason: `${quoted(words)} stands for a group with one bond, but it is drawn with ${degree}` };
        const side = labelSide(f, n) ?? "right";
        const smi = groupSmilesBySide(words, side);
        if (!smi) {
          const other = groupSmilesBySide(words, side === "left" ? "right" : "left");
          return {
            ok: false,
            reason: other
              ? `${quoted(words)} is written to the ${side} of its bond, where it reads from its ${side === "left" ? "last" : "first"} letter — ChemDraw writes this group the other way round there; retype it (Atom tool) and it is written for its side`
              : `${quoted(words)} is not an element, an R-group or a group label this knows (OMe, Ph, Boc, CO2H …)`,
          };
        }
        let g: Molecule;
        try {
          g = Molecule.fromSmiles(smi);
        } catch {
          return { ok: false, reason: `${quoted(words)}: its group could not be built` };
        }
        g.inventCoordinates();
        const map = mol.addMolecule(g);
        // OCL reads a bracket atom's open bond (the [Si] of TMS, the [N+] of NO₂) as a radical; bonded here, it is not one.
        mol.setAtomRadical(map[0], 0);
        // Laid out beyond the label, away from the atom it is bonded to.
        const nbB = f.children.find((b) => b.name === "b" && (b.attrs.B === n.attrs.id || b.attrs.E === n.attrs.id));
        const other = nbB ? f.children.find((c) => c.name === "n" && c.attrs.id === (nbB.attrs.B === n.attrs.id ? nbB.attrs.E : nbB.attrs.B)) : undefined;
        const out = other ? Math.atan2(y - posOf(other)[1], x - posOf(other)[0]) : 0;
        const gl = g.getAllAtoms() > 1 ? g.getAverageBondLength(true) || 1 : 1;
        let cx = 0, cy = 0;
        for (let k = 0; k < g.getAllAtoms(); k++) (cx += g.getAtomX(k) - g.getAtomX(0)), (cy += g.getAtomY(k) - g.getAtomY(0));
        const turn = out - (cx || cy ? Math.atan2(cy, cx) : 0);
        for (let k = 0; k < g.getAllAtoms(); k++) {
          const dx = (g.getAtomX(k) - g.getAtomX(0)) / gl, dy = (g.getAtomY(k) - g.getAtomY(0)) / gl;
          mol.setAtomX(map[k], x / L + dx * Math.cos(turn) - dy * Math.sin(turn));
          mol.setAtomY(map[k], y / L + dx * Math.sin(turn) + dy * Math.cos(turn));
        }
        index.set(n.attrs.id, map[0]);
        atomIds.push(n.attrs.id, ...new Array(g.getAllAtoms() - 1).fill(""));
        continue;
      }
      if (type === "Nickname" || type === "Fragment") {
        // ChemDraw keeps the abbreviation's own structure inside it, with an external connection point
        // standing for each bond to the rest.
        const inner = n.children.find((c) => c.name === "fragment")!;
        const words = labelWords(n) || "an abbreviation";
        const map = new Map<string, number>();
        const points: Array<{ id: string; num: number | null }> = [];
        const innerPos = new Map<number, P2>();
        for (const c of inner.children) {
          if (c.name !== "n" || !c.attrs.id) continue;
          if (c.attrs.NodeType === "ExternalConnectionPoint") {
            const num = Number(c.attrs.ExternalConnectionNum);
            points.push({ id: c.attrs.id, num: Number.isFinite(num) ? num : null });
            continue;
          }
          if (c.attrs.NodeType && c.attrs.NodeType !== "Element") return { ok: false, reason: `${quoted(words)} holds an atom this cannot read (${c.attrs.NodeType})` };
          const a = mol.addAtom(Number(c.attrs.Element ?? 6));
          innerPos.set(a, posOf(c));
          const q = Number(c.attrs.Charge ?? 0);
          if (q) mol.setAtomCharge(a, q);
          const iso = Number(c.attrs.Isotope ?? 0);
          if (iso) mol.setAtomMass(a, iso);
          map.set(c.attrs.id, a);
          atomIds.push("");
        }
        for (const b of inner.children) {
          if (b.name !== "b") continue;
          const ia = map.get(b.attrs.B), ib = map.get(b.attrs.E);
          if (ia === undefined || ib === undefined) continue; // a bond to the connection point
          const why = addBondOf(mol, ia, ib, b, wavy);
          if (why) return { ok: false, reason: `${quoted(words)}: ${why}` };
        }
        // Each connection point: the inner atom bonded to it — in the fragment's ConnectionOrder when it gives one.
        const order = (inner.attrs.ConnectionOrder ?? "").split(/\s+/).filter(Boolean);
        if (order.length === points.length && order.every((id) => points.some((p) => p.id === id))) points.sort((p, q) => order.indexOf(p.id) - order.indexOf(q.id));
        const attach = points.map((cp) => {
          const b = inner.children.find((q) => q.name === "b" && (q.attrs.B === cp.id || q.attrs.E === cp.id));
          return { num: cp.num, atom: b ? map.get(b.attrs.B === cp.id ? b.attrs.E : b.attrs.B) : undefined };
        });
        if (!attach.length || attach.some((v) => v.atom === undefined)) return { ok: false, reason: `${quoted(words)} does not say where it is bonded` };
        // Several points on one inner atom: which bond meets which point does not matter — they meet that
        // atom. More bonds than points only on a d- or f-block metal (Cl₂Zr, CrCl₃ with their ligands); a main-group
        // atom would be given bonds past its valence.
        if (!degree) return { ok: false, reason: `${quoted(words || "a label")} stands for a group bonded to something; alone it has no single formula` };
        const oneAtom = attach.every((v) => v.atom === attach[0].atom);
        if (oneAtom && (degree === attach.length || isComplexMetal(mol.getAtomicNo(attach[0].atom!)))) attach.splice(1);
        // Otherwise its outer bonds must meet its connection points one to one (a bond to a point beyond the
        // last would pile onto it — a wrong structure); with several, the file must number them.
        else if (degree !== attach.length) return { ok: false, reason: `${quoted(words)} has ${degree} bond${degree === 1 ? "" : "s"} but ${attach.length} connection point${attach.length === 1 ? "" : "s"} in its structure, so where each bond goes is not in the file` };
        // Its atoms are laid out in their own frame: moved so the atom that bonds sits where the label is.
        const at = innerPos.get(attach[0].atom!)!;
        for (const [a, [ix, iy]] of innerPos) {
          mol.setAtomX(a, (ix - at[0] + x) / L);
          mol.setAtomY(a, (iy - at[1] + y) / L);
        }
        expanded.set(n.attrs.id, { attach: attach.map((v) => ({ num: v.num, atom: v.atom! })), words, bondOrder: (n.attrs.BondOrdering ?? "").split(/\s+/).filter(Boolean) });
        continue;
      }
      return { ok: false, reason: `an atom drawn as ${type} has no exact form in a structure` };
    }
    // Bonds: to an abbreviation, each bond at the connection point it names (BeginExternalNum /
    // EndExternalNum), or — with one point — at that point.
    const used = new Map<string, Set<number>>();
    const atomFor = (id: string, b: XNode, end: "B" | "E"): number | string | undefined => {
      if (index.has(id)) return index.get(id);
      const e = expanded.get(id);
      if (!e) return undefined;
      if (e.attach.length === 1) return e.attach[0].atom;
      // ChemDraw's rule: the node's BondOrdering lists its bonds in the order of the fragment's connection
      // points (ConnectionOrder). Without it, which bond goes to which point is not in the file.
      const k = e.bondOrder.indexOf(b.attrs.id ?? "");
      if (e.bondOrder.length !== e.attach.length || k < 0) return `${quoted(e.words)} is bonded at ${e.attach.length} points, but the file does not say which bond goes to which`;
      const seen = used.get(id) ?? used.set(id, new Set()).get(id)!;
      if (seen.has(k)) return `two bonds of ${quoted(e.words)} name the same connection point`;
      seen.add(k);
      return e.attach[k].atom;
    };
    for (const b of f.children) {
      if (b.name !== "b") continue;
      const ia = atomFor(b.attrs.B, b, "B"), ib = atomFor(b.attrs.E, b, "E");
      if (typeof ia === "string") return { ok: false, reason: ia };
      if (typeof ib === "string") return { ok: false, reason: ib };
      if (ia === undefined || ib === undefined) return { ok: false, reason: "a bond joins an atom that is not in the structure" };
      const why = addBondOf(mol, ia, ib, b, wavy);
      if (why) return { ok: false, reason: why };
      if (isQueryOrder(b.attrs.Order) || (b.attrs.Topology && b.attrs.Topology !== "Unspecified")) bondProps.push({ a0: ia, a1: ib, attrs: b.attrs });
    }
  }
  // Aromatic bonds (drawn as such) become alternating single and double bonds before anything is counted.
  const arom = resolveAromatic(mol, frags, index);
  if (arom) return { ok: false, reason: arom };
  // OCL moves hydrogen atoms (and their bonds) to the end when it builds its helper arrays: each atom is
  // tagged first, so the page's ids — and the wavy bonds — still name their own atoms afterwards.
  const wavyEnds = wavy.map((b) => [mol.getBondAtom(0, b), mol.getBondAtom(1, b)]);
  for (let a = 0; a < mol.getAllAtoms(); a++) mol.setAtomMapNo(a, a + 1, false);
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const moved = new Map<number, number>(); // index before → after
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    moved.set(mol.getAtomMapNo(a) - 1, a);
    mol.setAtomMapNo(a, 0, false);
  }
  for (const [id, a] of index) index.set(id, moved.get(a)!);
  const idsBefore = atomIds.slice();
  for (const [was, now] of moved) atomIds[now] = idsBefore[was];
  // A wavy single bond means the geometry of the double bond it meets is not known.
  if (wavyEnds.length) {
    mol.ensureHelperArrays(Molecule.cHelperRings);
    for (const wb of wavyEnds.map(([a0, a1]) => mol.getBond(moved.get(a0)!, moved.get(a1)!)))
      for (const end of [0, 1] as const) {
        const a = mol.getBondAtom(end, wb);
        for (let k = 0; k < mol.getConnAtoms(a); k++) {
          const cb = mol.getConnBond(a, k);
          if (cb !== wb && mol.getBondOrder(cb) === 2 && !(mol.isRingBond(cb) && mol.getBondRingSize(cb) < 8)) mol.setBondType(cb, Molecule.cBondTypeCross);
        }
      }
  }
  // Drawn hydrogens are the ones the structure has: where OCL's usual valence gives another count
  // (a hypervalent S or P drawn with its H), the atom takes the valence drawn — the formula is the one
  // drawn, and the notes say the valence is unusual.
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  for (const f of frags)
    for (const n of f.children) {
      if (n.name !== "n" || !n.attrs.id || n.attrs.NumHydrogens === undefined) continue;
      const a = index.get(n.attrs.id);
      if (a === undefined || (n.attrs.NodeType && n.attrs.NodeType !== "Element")) continue;
      const drawn = Number(n.attrs.NumHydrogens);
      if (!Number.isInteger(drawn) || drawn < 0 || drawn === mol.getImplicitHydrogens(a)) continue;
      let bonds = 0;
      for (let k = 0; k < mol.getConnAtoms(a); k++) bonds += mol.getConnBondOrder(a, k);
      mol.setAtomAbnormalValence(a, bonds + drawn);
      mol.ensureHelperArrays(Molecule.cHelperNeighbours);
      const sym = elementSymbol(Number(n.attrs.Element ?? 6));
      const has = mol.getImplicitHydrogens(a);
      if (has !== drawn) return { ok: false, reason: `${quoted(labelWords(n) || sym)} is drawn with ${drawn} H, which no valence of ${sym} with its bonds and charge gives — the formula would not be the one drawn` };
      if (bonds) notes.push(`${labelWords(n) || sym} is drawn with ${drawn} H on ${bonds} bond${bonds === 1 ? "" : "s"} — an unusual valence for ${sym}, taken as drawn`);
    }
  // Hydrogen takes one bond: one drawn with more (bonds piled onto it) is no structure.
  const hBonds = new Map<number, number>();
  for (let b = 0; b < mol.getAllBonds(); b++)
    for (const a of [mol.getBondAtom(0, b), mol.getBondAtom(1, b)]) if (mol.getAtomicNo(a) === 1) hBonds.set(a, (hBonds.get(a) ?? 0) + 1);
  for (const k of hBonds.values()) if (k > 1) return { ok: false, reason: `a hydrogen atom is drawn with ${k} bonds — hydrogen takes one` };
  // Stereo groups, then query features and atom lists (these make the Molecule a query structure).
  let query = false;
  if (atomProps.length || bondProps.length) {
    mol.ensureHelperArrays(Molecule.cHelperRings);
    const ringBonds = (a: number): number => {
      let k = 0;
      for (let j = 0; j < mol.getAllConnAtoms(a); j++) if (mol.isRingBond(mol.getConnBond(a, j))) k++;
      return k;
    };
    const plan: Array<() => string | null> = [];
    for (const p of atomProps) {
      const a = index.get(p.id);
      if (a === undefined) continue;
      const sg = stereoGroupOf(p.attrs);
      if (sg && typeof sg !== "string") mol.setAtomESR(a, sg.type, sg.group);
      const rb = ringBonds(a);
      plan.push(() => {
        if (p.list) mol.setAtomList(a, p.list.list, p.list.not);
        return applyAtomQuery(mol, a, p.attrs, () => rb);
      });
      if (p.list || ATOM_QUERY_ATTRS.some((k) => p.attrs[k] !== undefined && p.attrs[k] !== "Unspecified")) query = true;
    }
    for (const p of bondProps) {
      const a0 = moved.get(p.a0), a1 = moved.get(p.a1);
      const b = a0 === undefined || a1 === undefined ? -1 : mol.getBond(a0, a1);
      if (b < 0) continue;
      plan.push(() => applyBondQuery(mol, b, p.attrs));
      query = true;
    }
    for (const step of plan) {
      const why = step();
      if (why) return { ok: false, reason: why };
    }
  }
  return { ok: true, value: { mol, atomIds, notes, query } };
}

/**
 * Aromatic (delocalized) bonds resolved into alternating single and double bonds: a ring atom that must
 * take a double bond (a neutral carbon, a pyridine-type N, an N⁺ or O⁺) is matched to one neighbour; one
 * that gives a lone pair instead (a pyrrole NH, the O of a furan, a charged carbon as in C₅H₅⁻ or C₇H₇⁺)
 * may stay single. No such pattern: refused by name. Bounded search (AROMATIC_STEPS). Null when done.
 */
function resolveAromatic(mol: Molecule, frags: XNode[], index: Map<string, number>): string | null {
  const nb = mol.getAllBonds();
  const deloc: number[] = [];
  for (let b = 0; b < nb; b++) if ((mol.getBondType(b) & Molecule.cBondTypeMaskSimple) === Molecule.cBondTypeDelocalized) deloc.push(b);
  if (!deloc.length) return null;
  // Drawn hydrogens per atom (labelled atoms only).
  const drawnH = new Map<number, number>();
  for (const f of frags)
    for (const n of f.children)
      if (n.name === "n" && n.attrs.id && n.attrs.NumHydrogens !== undefined && index.has(n.attrs.id)) drawnH.set(index.get(n.attrs.id)!, Number(n.attrs.NumHydrogens));
  const adj = new Map<number, Array<{ bond: number; other: number }>>();
  const otherOrder = new Map<number, number>();
  for (let b = 0; b < nb; b++) {
    const a0 = mol.getBondAtom(0, b), a1 = mol.getBondAtom(1, b);
    const isDeloc = deloc.includes(b);
    for (const [a, o] of [[a0, a1], [a1, a0]]) {
      if (isDeloc) (adj.get(a) ?? adj.set(a, []).get(a)!).push({ bond: b, other: o });
      else otherOrder.set(a, (otherOrder.get(a) ?? 0) + (mol.getAtomicNo(o) === 1 ? 1 : mol.getBondOrder(b)));
    }
  }
  type Role = "required" | "optional" | "forbidden";
  const role = new Map<number, Role>();
  // Atoms whose hydrogens the file leaves open (an N with no NumHydrogens): given a double bond where the
  // ring allows one — the most double bonds — so only the atoms that must be NH are (1H-tetrazole CH₂N₄).
  const openAll: number[] = [];
  for (const [a, edges] of adj) {
    const z = mol.getAtomicNo(a), q = mol.getAtomCharge(a), h = drawnH.get(a);
    // Valence already used: ring σ bonds, the other bonds by order (an exocyclic C=O counts 2), drawn H.
    const used = edges.length + (otherOrder.get(a) ?? 0) + (h ?? 0);
    const max = z === 6 ? 4 : z === 7 || z === 15 ? 3 + Math.sign(q) : z === 8 || z === 16 || z === 34 || z === 52 ? 2 + Math.sign(q) : Infinity;
    let r: Role;
    if (used + 1 > max) r = "forbidden"; // no room for a double bond (2-pyridone's C=O carbon, an N⁺ with four bonds)
    else if (z === 6) r = q === 0 ? "required" : "optional";
    else if (z === 7 || z === 15) r = q > 0 ? "required" : q < 0 ? "forbidden" : h === 0 ? "required" : "optional";
    else if (z === 8 || z === 16 || z === 34 || z === 52) r = q > 0 ? "required" : "forbidden";
    else r = "optional";
    role.set(a, r);
    if (r === "optional" && h === undefined && (z === 7 || z === 15)) openAll.push(a);
  }
  // Each connected aromatic system is resolved on its own (twenty imidazoles are twenty small searches).
  const comp = new Map<number, number>();
  for (const a0 of adj.keys()) {
    if (comp.has(a0)) continue;
    const stack = [a0];
    comp.set(a0, a0);
    while (stack.length) for (const e of adj.get(stack.pop()!)!) if (!comp.has(e.other)) comp.set(e.other, a0), stack.push(e.other);
  }
  const doubles = new Set<number>();
  let steps = 0;
  for (const root of new Set(comp.values())) {
    const r = matchSystem([...adj.keys()].filter((a) => comp.get(a) === root));
    if (typeof r === "string") return r;
    for (const b of r) doubles.add(b);
  }
  for (const b of deloc) mol.setBondType(b, doubles.has(b) ? Molecule.cBondTypeDouble : Molecule.cBondTypeSingle);
  return null;

  function matchSystem(atoms: number[]): Set<number> | string {
  const matched = new Map<number, number>(); // atom → bond
  const required = atoms.filter((a) => role.get(a) === "required");
  const open = openAll.filter((a) => comp.get(a) === comp.get(atoms[0]));
  let best: Map<number, number> | null = null;
  let bestScore = -1;
  // With every required atom matched: the open atoms, each matched where it can be or left single; the
  // matching with the most of them matched is kept. True stops the search (all matched).
  const extend = (i: number, score = 0): boolean | null => {
    if (++steps > AROMATIC_STEPS) return null;
    if (score + (open.length - i) <= bestScore) return false; // cannot beat the best so far
    if (i === open.length) {
      const score = open.filter((a) => matched.has(a)).length;
      if (score > bestScore) (bestScore = score), (best = new Map(matched));
      return score === open.length;
    }
    const a = open[i];
    if (matched.has(a)) return extend(i + 1, score + 1);
    for (const e of adj.get(a)!) {
      if (matched.has(e.other) || role.get(e.other) === "forbidden") continue;
      matched.set(a, e.bond);
      matched.set(e.other, e.bond);
      const r = extend(i + 1, score + 1);
      matched.delete(a);
      matched.delete(e.other);
      if (r !== false) return r;
    }
    return extend(i + 1, score);
  };
  const solve = (): boolean | null => {
    if (++steps > AROMATIC_STEPS) return null;
    // The unmatched required atom with the fewest ways to be matched.
    let pick = -1, best = Infinity;
    for (const a of required) {
      if (matched.has(a)) continue;
      const ways = adj.get(a)!.filter((e) => !matched.has(e.other) && role.get(e.other) !== "forbidden").length;
      if (ways < best) (best = ways), (pick = a);
      if (!ways) return false;
    }
    if (pick < 0) return extend(0);
    for (const e of adj.get(pick)!) {
      if (matched.has(e.other) || role.get(e.other) === "forbidden") continue;
      matched.set(pick, e.bond);
      matched.set(e.other, e.bond);
      const r = solve();
      if (r !== false) return r;
      matched.delete(pick);
      matched.delete(e.other);
    }
    return false;
  };
  const ok = solve();
  if (ok === null) return "the aromatic bonds are too many to resolve here — draw them as single and double bonds";
  if (!best) return "the bonds drawn as aromatic cannot be given alternating single and double bonds — as drawn, those atoms are not aromatic (check their atoms, charges and hydrogens)";
  return new Set((best as Map<number, number>).values());
  }
}

/** The atoms whose list is an excluded ("NOT") list: OCL exposes it only in its molfile (M  ALS … T). */
function excludedLists(mol: Molecule): Set<number> {
  const out = new Set<number>();
  for (const m of mol.toMolfile().matchAll(/^M {2}ALS\s+(\d+)\s+\d+\s+([TF])/gm)) if (m[2] === "T") out.add(Number(m[1]) - 1);
  return out;
}

/** One page bond into the Molecule; a refusal (string) for an order or style with no exact form. */
function addBondOf(mol: Molecule, ia: number, ib: number, b: XNode, wavy: number[]): string | null {
  const raw = (b.attrs.Order ?? "1").trim();
  if (isQueryOrder(raw)) {
    // A query bond (several orders): its first order here; the others are added with the query features.
    const orders = queryOrders(raw);
    if (typeof orders === "string") return orders;
    if (/Wedge|Hash/.test(b.attrs.Display ?? "")) return "a wedge on a query bond has no meaning";
    mol.setBondType(mol.addBond(ia, ib), baseBondType(orders));
    return null;
  }
  const order = raw;
  const display = b.attrs.Display ?? "Solid";
  const wedge = /^Wedge(Begin|End)$/.exec(display), hash = /^WedgedHash(Begin|End)$/.exec(display);
  // The narrow end is bond atom 0 in OCL.
  const [a0, a1] = (wedge?.[1] ?? hash?.[1]) === "End" ? [ib, ia] : [ia, ib];
  const bond = mol.addBond(a0, a1);
  if (order === "1") {
    if (wedge || hash) {
      mol.setBondType(bond, wedge ? Molecule.cBondTypeUp : Molecule.cBondTypeDown);
      return null;
    }
    mol.setBondType(bond, Molecule.cBondTypeSingle);
    if (display === "Wavy") wavy.push(bond);
    return null;
  }
  if (wedge || hash) return "a wedge on a double or triple bond has no meaning";
  if (order === "2") return mol.setBondType(bond, b.attrs[EITHER] === "yes" ? Molecule.cBondTypeCross : Molecule.cBondTypeDouble), null;
  if (order === "3") return mol.setBondType(bond, Molecule.cBondTypeTriple), null;
  if (order === "1.5") return mol.setBondType(bond, Molecule.cBondTypeDelocalized), null;
  return `a bond of order ${quoted(order)} has no exact form in a structure`;
}

/**
 * The Molecule as a new structure on the page (a fragment appended to the page), bond length `L` points,
 * placed with its top-left at `origin`. Refused by name for what a page cannot draw exactly (query
 * features, atom lists, custom atom labels, enhanced-stereo groups).
 */
export function moleculeToPage(doc: CdxDoc, mol: Molecule, origin: P2 = [60, 60]): { ok: true; fragmentId: string } | { ok: false; reason: string } {
  const page = doc.root.children.find((c) => c.name === "page");
  if (!page) return { ok: false, reason: "the document has no page" };
  mol.ensureHelperArrays(Molecule.cHelperParities);
  const n = mol.getAllAtoms(), nb = mol.getAllBonds();
  // Query features, atom lists and stereo groups as ChemDraw's attributes (cdxQuery); what ChemDraw cannot
  // say is refused by name.
  const atomExtra: Array<Record<string, string>> = [];
  for (let a = 0; a < n; a++) {
    if (mol.getAtomCustomLabel(a)) return { ok: false, reason: `an atom carries the text label ${quoted(mol.getAtomCustomLabel(a))}, which this page cannot draw as chemistry` };
    const qa = atomQueryAttrs(mol, a);
    if (typeof qa === "string") return { ok: false, reason: qa };
    if (mol.isAtomStereoCenter(a) && mol.getAtomESRType(a) !== Molecule.cESRTypeAbs) {
      qa.EnhancedStereoType = mol.getAtomESRType(a) === Molecule.cESRTypeAnd ? "And" : "Or";
      qa.EnhancedStereoGroupNum = String(mol.getAtomESRGroup(a) + 1);
    }
    atomExtra.push(qa);
  }
  for (let b = 0; b < nb; b++) if (mol.getBondESRType(b) === Molecule.cESRTypeAnd || mol.getBondESRType(b) === Molecule.cESRTypeOr) return { ok: false, reason: "an axis belongs to an AND / OR stereo group, which ChemDraw has no form for" };
  // Hydrogens are counted as for a structure, whatever the Markush flag (OCL counts none on a query).
  const counted = mol.getCompactCopy();
  counted.setFragment(false);
  counted.ensureHelperArrays(Molecule.cHelperNeighbours);
  const sameAtoms = counted.getAllAtoms() === n;
  const L = doc.style.bondLength || 30;
  const avg = n > 1 ? mol.getAverageBondLength(true) || 1 : 1;
  const k = L / avg;
  let minX = Infinity, minY = Infinity;
  for (let a = 0; a < n; a++) (minX = Math.min(minX, mol.getAtomX(a))), (minY = Math.min(minY, mol.getAtomY(a)));
  const id = nextIdFrom(doc.root);
  const fmt = (v: number): string => String(Math.round(v * 100) / 100);
  const frag: XNode = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
  const nodeIds: string[] = [];
  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const nid = id();
    nodeIds.push(nid);
    const attrs: Record<string, string> = { id: nid, p: `${fmt(origin[0] + (mol.getAtomX(a) - minX) * k)} ${fmt(origin[1] + (mol.getAtomY(a) - minY) * k)}` };
    const q = mol.getAtomCharge(a);
    if (q) attrs.Charge = String(q);
    const r = mol.getAtomRadical(a);
    if (r) {
      const name = OCL_TO_RADICAL.get(r);
      if (!name) return { ok: false, reason: "an atom's radical state has no CDXML form" };
      attrs.Radical = name;
    }
    if (Z_TO_R(z) === null && z !== 6) {
      if (z < 1 || z > 118) return { ok: false, reason: `an atom (number ${z}) is not an element or R1–R16` };
      attrs.Element = String(z);
    }
    Object.assign(attrs, atomExtra[a]);
    frag.children.push({ name: "n", attrs, children: [], text: "", line: 0 });
  }
  for (let b = 0; b < nb; b++) {
    const a0 = mol.getBondAtom(0, b), a1 = mol.getBondAtom(1, b);
    const type = mol.getBondType(b);
    const attrs: Record<string, string> = { id: id(), B: nodeIds[a0], E: nodeIds[a1] };
    if (type === Molecule.cBondTypeCross) {
      // ChemDraw has no mark for a double bond of unknown geometry (it reads the drawn geometry as the
      // stereo); OCL does. The page keeps it in its own attribute, drawn crossed.
      attrs.Order = "2";
      attrs[EITHER] = "yes";
    } else if (type === Molecule.cBondTypeUp) attrs.Display = "WedgeBegin";
    else if (type === Molecule.cBondTypeDown) attrs.Display = "WedgedHashBegin";
    else if ((type & Molecule.cBondTypeMaskSimple) === Molecule.cBondTypeDelocalized) attrs.Order = "1.5";
    else {
      const o = mol.getBondOrder(b);
      if (o === 0) return { ok: false, reason: "a metal–ligand bond has no exact CDXML form here yet" };
      if (o > 3) return { ok: false, reason: `a bond of order ${o} has no CDXML form` };
      if (o !== 1) attrs.Order = String(o);
    }
    if (mol.getBondQueryFeatures(b)) {
      const qb = bondQueryAttrs(mol, b, attrs.Order ?? "1");
      if (typeof qb === "string") return { ok: false, reason: qb };
      if (qb.Order && attrs.Display && /Wedge|Hash/.test(attrs.Display)) return { ok: false, reason: "a wedge on a query bond has no meaning" };
      Object.assign(attrs, qb);
    }
    frag.children.push({ name: "b", attrs, children: [], text: "", line: 0 });
  }
  page.children.push(frag);
  // Labels as ChemDraw draws them: heteroatoms and charged / isotopic carbons with their hydrogens; R groups.
  let notLists: Set<number> | null = null;
  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const rk = Z_TO_R(z);
    const node = findById(doc.root, nodeIds[a])!.el;
    const list = mol.getAtomList(a);
    if (list && list.length) {
      const not = (notLists ??= excludedLists(mol)).has(a);
      const r = setAtomLabel(doc, nodeIds[a], elementListLabel([...list], not, elementSymbol));
      if (!r.ok) return { ok: false, reason: r.reason };
      continue;
    }
    if (rk !== null) {
      const r = setAtomLabel(doc, nodeIds[a], `R${rk}`);
      if (!r.ok) return { ok: false, reason: r.reason };
      continue;
    }
    const mass = mol.getAtomMass(a);
    const unusual = mol.getAtomAbnormalValence(a) !== -1;
    if (z === 6 && !mass && !node.attrs.Radical && !unusual) continue;
    const r = setAtomLabel(doc, nodeIds[a], z === 1 && mass === 2 ? "D" : z === 1 && mass === 3 ? "T" : elementSymbol(z));
    if (!r.ok) return { ok: false, reason: r.reason };
    const fresh = findById(doc.root, nodeIds[a])!.el;
    if (z === 1 && (mass === 2 || mass === 3)) continue; // D / T: their own label
    // The hydrogens are the Molecule's own (an atom of unusual valence keeps its count), in the label too.
    const h = sameAtoms ? counted.getImplicitHydrogens(a) : mol.getImplicitHydrogens(a);
    if (fresh.attrs.NumHydrogens !== String(h)) {
      fresh.attrs.NumHydrogens = String(h);
      const t = fresh.children.find((c) => c.name === "t");
      const runs = t?.children.filter((c) => c.name === "s") ?? [];
      if (t && runs.length) {
        runs[0].text = elementSymbol(z) + (h ? "H" + (h > 1 ? h : "") : "");
        t.children = t.children.filter((c) => c.name !== "s" || c === runs[0]);
      }
    }
    if (mass) {
      fresh.attrs.Isotope = String(mass);
      const t = fresh.children.find((c) => c.name === "t");
      const s0 = t?.children.find((c) => c.name === "s");
      if (t && s0) t.children.unshift({ name: "s", attrs: { ...s0.attrs, face: String(0x20) }, children: [], text: String(mass), line: 0 });
    }
  }
  // The page must say exactly what the Molecule does: read back, the same idcode — else something it holds
  // (a query feature OCL keeps but does not show, say) would be lost, and it is refused instead.
  const back = readCdxmlTree(doc.root);
  const read = back.ok ? pageToMolecule(back.doc, new Set([frag.attrs.id])) : null;
  if (read?.ok && mol.isFragment() && !read.value.mol.isFragment()) read.value.mol.setFragment(true);
  if (!read?.ok || read.value.mol.getIDCode() !== mol.getIDCode()) {
    page.children = page.children.filter((c) => c !== frag);
    return { ok: false, reason: read && !read.ok ? read.reason : "the structure carries something this page cannot keep exactly (a query feature ChemDraw has no form for) — it is not redrawn without it" };
  }
  return { ok: true, fragmentId: frag.attrs.id };
}
