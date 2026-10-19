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
import { readCdxmlTree, type CdxDoc } from "./cdxml";
import type { XNode } from "./xmlLite";
import { findById, setAtomLabel, turnLabelForSide } from "./cdxmlEdit";
import { labelSide, pageToMolecule } from "./cdxmlMol";
import { groupSmilesBySide, leftwardOf, rightwardOf } from "./labelExpand";

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
  const dx = posOf(o)[0] - posOf(n)[0];
  // A bond within half a point of vertical has no side (a label is not turned for a rounding).
  if (Math.abs(dx) < 0.5) return null;
  return dx > 0 ? "left" : "right";
}

/** A stereo bond as the reader takes it (cdxmlMol addBondOf): a hashed or hollow plain bond is not one. */
const STEREO_DISPLAY = /^(Wedge|WedgedHash)(Begin|End)$/;

/**
 * The molecule a structure is laid out from: its chemistry where the page reads exactly, atom for atom; else
 * its skeleton, each label one atom of its own kind (a distinct stand-in element per distinct label text, so
 * OMe and OEt on one alkene carbon keep their E / Z). Its stereo is from the drawing as it is.
 */
function layoutMolecule(doc: CdxDoc, frag: XNode, id: string, L: number): { mol: Molecule; idOf: string[]; chem: boolean; keys: Map<string, string> } | string {
  const nodes = frag.children.filter((c) => c.name === "n" && c.attrs.id);
  const bonds = frag.children.filter((c) => c.name === "b");
  const chem = pageToMolecule(doc, new Set([id]));
  if (chem.ok && chem.value.atomIds.every((x) => x !== "")) {
    chem.value.mol.ensureHelperArrays(Molecule.cHelperParities);
    return { mol: chem.value.mol, idOf: chem.value.atomIds, chem: true, keys: new Map() };
  }
  if (bonds.some((b) => STEREO_DISPLAY.test(b.attrs.Display ?? ""))) return `a structure with wedges keeps its layout here, since its stereo could not be read (${chem.ok ? "it has labels standing for groups" : chem.reason}) — move its atoms by hand`;
  const mol = new Molecule(nodes.length, bonds.length);
  const idOf: string[] = [];
  const at = new Map<string, number>();
  // Stand-ins for labels: one element per distinct label, from the far end of the table (never a real atom here).
  const standIn = new Map<string, number>();
  const keys = new Map<string, string>();
  let next = 118;
  for (const n of nodes) {
    const type = n.attrs.NodeType ?? "Element";
    let z = type === "Element" ? Number(n.attrs.Element ?? 6) : 0;
    if (!z) {
      const words = (n.children.find((c) => c.name === "t")?.children.map((q) => q.text).join("") ?? "").replace(/\s+/g, "");
      // The group the label reads as on its own side (OMe right of a bond and MeO left of one are one group;
      // CN and NC, SCN and NCS are not), else its words; an unlabelled node by its type.
      // Read exactly as the converter reads it (labelSide: its justification, then its side, then its first letter).
      const side = labelSide(frag, n) ?? "right";
      const meaning = (words ? groupSmilesBySide(words, side) : null) ?? (words || type);
      const key = `${n.attrs.GenericNickname ?? ""}:${n.attrs.ElementList ?? ""}:${meaning}`;
      keys.set(n.attrs.id, key);
      if (!standIn.has(key)) standIn.set(key, next > 60 ? next-- : 6);
      z = standIn.get(key)!;
    }
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
  mol.ensureHelperArrays(Molecule.cHelperParities);
  return { mol, idOf, chem: false, keys };
}

/**
 * Lays out the page's structures (or those among `objectIds`) again in place. Null when done; a refusal names
 * the structure that could not be (the caller restores the page: nothing is half done).
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
    const lay = layoutMolecule(doc, frag, o.id, L);
    if (typeof lay === "string") return lay;
    const { mol, chem } = lay;
    // What the structure is before it moves: checked again after (the same reading), never changed by Clean.
    const before = mol.getIDCode();
    // Each atom tagged, so the page atoms still find theirs after OCL lays out (it drops drawn hydrogens).
    for (let a = 0; a < mol.getAllAtoms(); a++) mol.setAtomMapNo(a, a + 1, false);
    try {
      mol.inventCoordinates();
    } catch (e) {
      return `the structure could not be laid out (${(e as Error).message})`;
    }
    const n = mol.getAllAtoms();
    const idOf: string[] = [];
    for (let a = 0; a < n; a++) idOf.push(lay.idOf[mol.getAtomMapNo(a) - 1] ?? "");
    if (idOf.some((x) => !x)) return "the structure's atoms could not be matched to the page";
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
    const readingBefore = new Map<string, "left" | "right">();
    for (const nd of nodes)
      if (nd.children.some((c) => c.name === "t")) {
        sidesBefore.set(nd.attrs.id, sideOf(frag, nd));
        readingBefore.set(nd.attrs.id, labelSide(frag, nd) ?? "right");
      }
    const moved = new Map<string, P2>(); // node id → how far it moved
    const place = (nd: XNode, p: P2): void => {
      const was = old.get(nd.attrs.id)!;
      const d: P2 = [p[0] - was[0], p[1] - was[1]];
      nd.attrs.p = `${fmt(p[0])} ${fmt(p[1])}`;
      moved.set(nd.attrs.id, d);
      // Its label moves with it.
      for (const t of nd.children.filter((c) => c.name === "t")) {
        t.attrs.p = shiftPair(t.attrs.p, d)!;
        if (t.attrs.BoundingBox) t.attrs.BoundingBox = shiftPair(t.attrs.BoundingBox, d)!;
      }
    };
    const newPos = new Map<string, P2>();
    for (let a = 0; a < n; a++) {
      const nd = nodes.find((q) => q.attrs.id === idOf[a]);
      if (!nd) continue;
      const p: P2 = [ox + mol.getAtomX(a) * k - nx, oy + mol.getAtomY(a) * k - ny];
      newPos.set(nd.attrs.id, p);
      place(nd, p);
    }
    // Drawn atoms OCL dropped from its layout (plain hydrogens): beside their atom, away from its other bonds.
    const nbrOf = (id: string): string[] => bonds.filter((b) => b.attrs.B === id || b.attrs.E === id).map((b) => (b.attrs.B === id ? b.attrs.E : b.attrs.B));
    const spread = new Map<string, number>();
    const dropped: Array<{ node: XNode; parent: P2; ang: number }> = [];
    for (const nd of nodes) {
      if (newPos.has(nd.attrs.id)) continue;
      const parent = nbrOf(nd.attrs.id).find((q) => newPos.has(q));
      // One with no laid-out neighbour (a lone H, H₂): stays where it was drawn.
      if (!parent) continue;
      const pp = newPos.get(parent)!;
      let dx = 0, dy = 0;
      for (const q of nbrOf(parent)) {
        const qp = newPos.get(q);
        if (!qp) continue;
        const l = Math.hypot(qp[0] - pp[0], qp[1] - pp[1]) || 1;
        (dx -= (qp[0] - pp[0]) / l), (dy -= (qp[1] - pp[1]) / l);
      }
      let ang = Math.hypot(dx, dy) > 0.2 ? Math.atan2(dy, dx) : -Math.PI / 2;
      const k2 = spread.get(parent) ?? 0;
      spread.set(parent, k2 + 1);
      ang += (k2 % 2 ? -1 : 1) * Math.ceil(k2 / 2) * (Math.PI / 3);
      const p: P2 = [pp[0] + Math.cos(ang) * L, pp[1] + Math.sin(ang) * L];
      newPos.set(nd.attrs.id, p);
      place(nd, p);
      dropped.push({ node: nd, parent: pp, ang });
    }
    // The wedges drawn again from the stereo (the narrow end is OCL's bond atom 0).
    if (chem) {
      for (const b of bonds) if (STEREO_DISPLAY.test(b.attrs.Display ?? "")) delete b.attrs.Display;
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
    /** A rewritten label keeps its own attributes (colour, face …): only its text, geometry and justification are new. */
    const keepOwnAttrs = (id: string, old: XNode): void => {
      const t1 = findById(doc.root, id)?.el.children.find((c) => c.name === "t");
      if (!t1) return;
      const oldRun = old.children.find((q) => q.name === "s")?.attrs ?? {};
      t1.attrs = { ...old.attrs, p: t1.attrs.p, BoundingBox: t1.attrs.BoundingBox, LabelJustification: t1.attrs.LabelJustification };
      if (old.attrs.LabelAlignment) t1.attrs.LabelAlignment = t1.attrs.LabelJustification ?? "Left";
      const r1 = t1.children.find((q) => q.name === "s");
      if (r1) r1.attrs = { ...oldRun, ...(r1.attrs.face && !oldRun.face ? { face: r1.attrs.face } : {}) };
    };
    // Labels after the move. An element's label is turned for its new side, its hydrogens as drawn (OH ↔ HO).
    // A group label whose meaning depends on its side (OMe / MeO, SCN / NCS) must still read as the group it
    // did, with its bonded letter on the atom: kept if it does, rewritten for its side if a form reads the same,
    // else Clean refuses. Labels that read the same on either side (Ph, an abbreviation with its own structure,
    // a stacked or centred label, a generic R) are left exactly as they were.
    for (const nd of nodes) {
      const id = nd.attrs.id;
      const t0 = nd.children.find((c) => c.name === "t");
      if (!t0) continue;
      const type = nd.attrs.NodeType ?? "Element";
      const before = sidesBefore.get(id) ?? null, after = sideOf(frag, nd);
      if (type === "Element") {
        if (before && after && before !== after) turnLabelForSide(doc, id);
        continue;
      }
      if (type !== "Unspecified") continue;
      const words = t0.children.filter((q) => q.name === "s").map((q) => q.text).join("");
      const just = t0.attrs.LabelJustification ?? "";
      if (/[\r\n]/.test(words) || ["Center", "Above", "Below"].includes(just)) continue;
      const L = groupSmilesBySide(words, "left"), R = groupSmilesBySide(words, "right");
      if (L === R) continue; // the same group either side (or no group at all)
      const meant = groupSmilesBySide(words, readingBefore.get(id) ?? "right"); // what it read as (null: unreadable)
      if (!after) {
        // Straight above or below its bond: the reading kept by the justification (the letter on the atom).
        const was = readingBefore.get(id) ?? "right";
        if ((labelSide(frag, nd) ?? "right") !== was) t0.attrs.LabelJustification = was === "left" ? "Right" : "Left";
        continue;
      }
      if (groupSmilesBySide(words, after) === meant) {
        // It reads as before on its new side: its bonded letter put on the atom.
        const want = after === "left" ? "Right" : "Left";
        if (just !== want) {
          setAtomLabel(doc, id, words);
          keepOwnAttrs(id, t0);
        }
        continue;
      }
      const alt = after === "left" ? leftwardOf(words) : rightwardOf(words);
      if (meant && alt && groupSmilesBySide(alt, after) === meant) {
        setAtomLabel(doc, id, alt);
        keepOwnAttrs(id, t0);
        continue;
      }
      return "laying this structure out again would change what it reads as (a label that cannot be written for its new side) — it keeps its layout; move its atoms by hand";
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
    // The same reading after the move: the structure (its E / Z and R / S included) must be what it was.
    const same = (): boolean => {
      const re = readCdxmlTree(doc.root);
      const after = re.ok ? layoutMolecule(re.doc, findById(re.doc.root, o.id)!.el, o.id, L) : null;
      if (!after || typeof after === "string" || after.mol.getIDCode() !== before) return false;
      for (const [id, k] of lay.keys) if (after.keys.get(id) !== k) return false;
      return true;
    };
    let ok = same();
    // A drawn H placed back where it reads as the other centre: tried round its atom until it reads as drawn.
    if (!ok && dropped.length && dropped.length <= 8) {
      for (const h of dropped) {
        if (ok) break;
        for (let step = 1; step < 12 && !ok; step++) {
          const ang = h.ang + (step * Math.PI) / 6;
          place(h.node, [h.parent[0] + Math.cos(ang) * L, h.parent[1] + Math.sin(ang) * L]);
          ok = same();
        }
        if (!ok) place(h.node, [h.parent[0] + Math.cos(h.ang) * L, h.parent[1] + Math.sin(h.ang) * L]);
      }
    }
    if (!ok) return "laying this structure out again would change what it reads as (its stereo, or a label) — it keeps its layout; move its atoms by hand";
  }
  return null;
}
