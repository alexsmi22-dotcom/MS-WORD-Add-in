/**
 * Clean on a page that is more than its structures: each structure is laid out again in place (its centre
 * kept, at the page's bond length), and nothing else moves — captions, arrows and other structures keep their
 * places. The layout comes from the structure's chemistry where the page reads exactly (its stereo kept:
 * the wedges are drawn again from it); a structure with group labels (OMe, Ph …) or other labels is laid out
 * as its skeleton, each label one atom — never expanded. Refused by name: a structure in brackets (the
 * brackets would no longer fit it) and one with wedges whose chemistry cannot be read (its stereo would be
 * lost).
 */
import { Molecule } from "openchemlib/full";
import type { CdxDoc } from "./cdxml";
import type { XNode } from "./xmlLite";
import { findById, setAtomLabel } from "./cdxmlEdit";
import { pageToMolecule } from "./cdxmlMol";
import { groupSmilesBySide } from "./labelExpand";
import { symbolFor } from "./periodic";

type P2 = [number, number];
const posOf = (n: XNode): P2 => {
  const [x, y] = (n.attrs.p ?? "0 0").split(/\s+/).map(Number);
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
};
const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const shiftPair = (s: string | undefined, d: P2): string | undefined => {
  if (!s) return s;
  const v = s.split(/\s+/).map(Number);
  if (!v.every(Number.isFinite)) return s;
  return v.map((x, i) => fmt(x + d[i % 2])).join(" ");
};
const BOND_TYPE: Record<string, number> = { "1": Molecule.cBondTypeSingle, "2": Molecule.cBondTypeDouble, "3": Molecule.cBondTypeTriple, "1.5": Molecule.cBondTypeDelocalized };

/** Which side of its one bond a label sits on (left when its neighbour lies to its right). */
function sideOf(frag: XNode, n: XNode): "left" | "right" | null {
  const b = frag.children.find((q) => q.name === "b" && (q.attrs.B === n.attrs.id || q.attrs.E === n.attrs.id));
  const o = b ? frag.children.find((c) => c.name === "n" && c.attrs.id === (b.attrs.B === n.attrs.id ? b.attrs.E : b.attrs.B)) : undefined;
  if (!o) return null;
  return posOf(o)[0] - posOf(n)[0] > 1e-6 ? "left" : "right";
}

/**
 * Lays out the page's structures (or those among `objectIds`) again in place. Null when done; a refusal names
 * the structure that could not be.
 */
export function cleanStructures(doc: CdxDoc, objectIds?: ReadonlySet<string>): string | null {
  const L = doc.style.bondLength || 30;
  const bracketed = new Set(doc.brackets.flatMap((g) => g.objectIds));
  const targets = doc.objects.filter((o) => (!objectIds || objectIds.has(o.id)) && o.items.some((it) => it.kind === "fragment"));
  if (!targets.length) return "there is no structure to clean";
  for (const o of targets) {
    const frag = findById(doc.root, o.id)?.el;
    if (!frag || frag.name !== "fragment") continue;
    const nodes = frag.children.filter((c) => c.name === "n" && c.attrs.id);
    const bonds = frag.children.filter((c) => c.name === "b");
    if (nodes.some((n) => bracketed.has(n.attrs.id))) return "a structure inside brackets keeps its layout (the brackets would no longer fit it) — move its atoms by hand";
    if (nodes.length < 2) continue;
    const wedged = bonds.some((b) => /Wedge|Hash/.test(b.attrs.Display ?? ""));
    // The layout: from the chemistry where the page reads exactly, atom for atom; else the skeleton.
    let mol: Molecule;
    let idOf: string[];
    const chem = pageToMolecule(doc, new Set([o.id]));
    if (chem.ok && chem.value.atomIds.every((id) => id !== "")) {
      mol = chem.value.mol;
      idOf = chem.value.atomIds;
    } else {
      if (wedged) return `a structure with wedges keeps its layout here, since its stereo could not be read (${chem.ok ? "it has labels standing for groups" : chem.reason}) — move its atoms by hand`;
      mol = new Molecule(nodes.length, bonds.length);
      idOf = [];
      const at = new Map<string, number>();
      for (const n of nodes) {
        const z = (n.attrs.NodeType ?? "Element") === "Element" ? Number(n.attrs.Element ?? 6) : 6;
        const a = mol.addAtom(Number.isInteger(z) && z >= 1 && z <= 118 ? z : 6);
        const [x, y] = posOf(n);
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        at.set(n.attrs.id, a);
        idOf.push(n.attrs.id);
      }
      for (const b of bonds) {
        const a0 = at.get(b.attrs.B), a1 = at.get(b.attrs.E);
        if (a0 === undefined || a1 === undefined || a0 === a1) continue;
        mol.setBondType(mol.addBond(a0, a1), BOND_TYPE[(b.attrs.Order ?? "1").split(/\s+/)[0]] ?? Molecule.cBondTypeSingle);
      }
      // A skeleton's atoms take no hydrogens or valence checks: the layout is all that is used.
      mol.setFragment(true);
    }
    // The stereo, from the drawing as it is, before the atoms move.
    mol.ensureHelperArrays(Molecule.cHelperParities);
    try {
      mol.inventCoordinates();
    } catch (e) {
      return `the structure could not be laid out (${(e as Error).message})`;
    }
    const n = mol.getAllAtoms();
    if (idOf.length !== n) return "the structure's atoms could not be matched to the page";
    const avg = n > 1 ? mol.getAverageBondLength(true) || 1 : 1;
    const k = L / avg;
    // The centre kept: the old atoms' centre, the new atoms' centre.
    let ox = 0, oy = 0, nx = 0, ny = 0;
    const old = new Map<string, P2>();
    for (const nd of nodes) {
      const p = posOf(nd);
      old.set(nd.attrs.id, p);
      (ox += p[0]), (oy += p[1]);
    }
    (ox /= nodes.length), (oy /= nodes.length);
    for (let a = 0; a < n; a++) (nx += mol.getAtomX(a) * k), (ny += mol.getAtomY(a) * k);
    (nx /= n), (ny /= n);
    const sidesBefore = new Map<string, "left" | "right" | null>();
    for (const nd of nodes) if (nd.children.some((c) => c.name === "t")) sidesBefore.set(nd.attrs.id, sideOf(frag, nd));
    const moved = new Map<string, P2>(); // node id → how far it moved
    for (let a = 0; a < n; a++) {
      const nd = nodes.find((q) => q.attrs.id === idOf[a]);
      if (!nd) continue;
      const p: P2 = [ox + mol.getAtomX(a) * k - nx, oy + mol.getAtomY(a) * k - ny];
      const was = old.get(nd.attrs.id)!;
      const d: P2 = [p[0] - was[0], p[1] - was[1]];
      nd.attrs.p = `${fmt(p[0])} ${fmt(p[1])}`;
      moved.set(nd.attrs.id, d);
      // Its label moves with it.
      for (const t of nd.children.filter((c) => c.name === "t")) {
        t.attrs.p = shiftPair(t.attrs.p, d)!;
        if (t.attrs.BoundingBox) t.attrs.BoundingBox = shiftPair(t.attrs.BoundingBox, d)!;
      }
    }
    // The wedges drawn again from the stereo (the narrow end is OCL's bond atom 0).
    if (chem.ok && mol === chem.value.mol) {
      for (const b of bonds) if (/Wedge|Hash/.test(b.attrs.Display ?? "")) delete b.attrs.Display;
      for (let bi = 0; bi < mol.getAllBonds(); bi++) {
        const t = mol.getBondType(bi);
        if (t !== Molecule.cBondTypeUp && t !== Molecule.cBondTypeDown) continue;
        const narrow = idOf[mol.getBondAtom(0, bi)], wide = idOf[mol.getBondAtom(1, bi)];
        const b = bonds.find((q) => (q.attrs.B === narrow && q.attrs.E === wide) || (q.attrs.B === wide && q.attrs.E === narrow));
        if (!b) continue;
        const kind = t === Molecule.cBondTypeUp ? "Wedge" : "WedgedHash";
        b.attrs.Display = `${kind}${b.attrs.B === narrow ? "Begin" : "End"}`;
      }
    }
    // A group label now on the other side of its bond is written for that side (OMe on the left reads MeO).
    for (const [id, before] of sidesBefore) {
      const nd = nodes.find((q) => q.attrs.id === id)!;
      const after = sideOf(frag, nd);
      const type = nd.attrs.NodeType ?? "Element";
      if (!before || !after || before === after) continue;
      // An element with hydrogens (OH, NH2) written for its new side (HO, H2N on the left).
      if (type === "Element" && !nd.attrs.Isotope && nd.attrs.NumHydrogens && nd.attrs.NumHydrogens !== "0") {
        const sym = symbolFor(Number(nd.attrs.Element ?? 6));
        if (sym) setAtomLabel(doc, id, sym);
        continue;
      }
      if (type !== "Unspecified" && type !== "Nickname") continue;
      const words = nd.children.find((c) => c.name === "t")?.children.filter((s) => s.name === "s").map((s) => s.text).join("") ?? "";
      if (words && (groupSmilesBySide(words, "left") || groupSmilesBySide(words, "right"))) setAtomLabel(doc, id, words);
    }
    // Symbols ChemDraw ties to an atom (a charge drawn as ⊕) move with it.
    const walk = (x: XNode): void => {
      for (const c of x.children) {
        if (c.name === "graphic") {
          const rep = c.children.find((r) => r.name === "represent" && r.attrs.object && moved.has(r.attrs.object));
          if (rep) {
            const d = moved.get(rep.attrs.object)!;
            if (c.attrs.BoundingBox) c.attrs.BoundingBox = shiftPair(c.attrs.BoundingBox, d)!;
            if (c.attrs.p) c.attrs.p = shiftPair(c.attrs.p, d)!;
          }
        }
        walk(c);
      }
    };
    walk(doc.root);
  }
  return null;
}
