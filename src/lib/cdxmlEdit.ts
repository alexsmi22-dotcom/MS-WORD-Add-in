/**
 * Editing a ChemDraw CDXML document (docs/SCOPE-CHEMDRAW.md, C2). Every edit changes the XML tree
 * the document was read from (cdxml.ts keeps it), and the model is read again from the tree — so
 * what is drawn is always what would be saved, and everything this release does not understand
 * survives an edit untouched. writeCdxml gives the tree back as a file ChemDraw opens.
 *
 * Edits that would leave a plausible wrong drawing are refused by name, and a ChemDraw-computed
 * name tied to a changed structure is reported (namesTiedTo) — an old IUPAC name beside a changed
 * structure is exactly the wrong answer a patent figure must not carry.
 */
import type { XNode } from "./xmlLite";
import type { CdxDoc } from "./cdxml";
import { atomicNumber, symbolFor } from "./periodic";
import { Molecule } from "openchemlib/full";
import { groupSmilesBySide, isGroupLabel, leftwardOf, rightwardOf } from "./labelExpand";
import { elementListLabel, parseElementList } from "./cdxQuery";
import { arrowFromElement, readCdxmlTree } from "./cdxml";
import { labelGeometry, stackedLabelGeometry } from "./cdxGlyphs";
import { arcOf, bowAndPlans, CURVED_HEAD, fishhookSide, planAxes, planCurved, type ArrowEnd, type CurvedPlan } from "./cdxArrows";

// ---- the tree --------------------------------------------------------------------------------

const escAttr = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
const escText = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tree as a CDXML file. Text is written only where it carries content (in `s` elements). */
export function writeCdxml(root: XNode, compact = false): string {
  // Compact (for the large canvas's address): no declaration, no indentation — text written exactly as ever.
  const out: string[] = compact ? [] : ['<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n'];
  const write = (n: XNode, depth: number): void => {
    const pad = compact ? "" : depth < 12 ? "\n" + " ".repeat(depth) : "";
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
    // A style run's text is written exactly (a run of one space is a space); elsewhere only content.
    const text = n.name === "s" ? escText(n.text) : n.text.trim() ? escText(n.text) : "";
    if (!n.children.length && !text) {
      out.push(`${pad}<${n.name}${attrs}/>`);
      return;
    }
    out.push(`${pad}<${n.name}${attrs}>`);
    if (text) out.push(text);
    for (const c of n.children) write(c, depth + 1);
    out.push(`${n.children.length ? pad : ""}</${n.name}>`);
  };
  write(root, 0);
  return out.join("") + (compact ? "" : "\n");
}

/** A deep copy (the editor's undo keeps whole trees: a document is small next to its drawing). */
export function cloneTree(n: XNode): XNode {
  return { name: n.name, attrs: { ...n.attrs }, text: n.text, line: n.line, children: n.children.map(cloneTree) };
}

function walk(n: XNode, f: (x: XNode, parent: XNode | null) => void, parent: XNode | null = null): void {
  f(n, parent);
  for (const c of n.children) walk(c, f, n);
}

/** Finds an element by id, with its parent. */
export function findById(root: XNode, id: string): { el: XNode; parent: XNode | null } | null {
  let hit: { el: XNode; parent: XNode | null } | null = null;
  walk(root, (x, p) => {
    if (!hit && x.attrs.id === id) hit = { el: x, parent: p };
  });
  return hit;
}

/** The next free numeric id in the document. */
export function nextIdFrom(root: XNode): () => string {
  // BigInt: an id past 2^53 would otherwise give two new objects the same id.
  let max = 0n;
  walk(root, (x) => {
    const v = x.attrs.id;
    if (v && /^\d{1,30}$/.test(v)) {
      const b = BigInt(v);
      if (b > max) max = b;
    }
  });
  return () => String(++max);
}

const pageOf = (root: XNode): XNode | undefined => root.children.find((c) => c.name === "page");
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

// ---- moving and deleting ------------------------------------------------------------------

/** Attributes holding positions: points ("x y" / "x y z"), boxes and point lists, moved alike. */
const POSITIONAL = ["p", "BoundingBox", "Head3D", "Tail3D", "Center3D", "MajorAxisEnd3D", "MinorAxisEnd3D", "CurvePoints", "CurvePoints3D", "xyz"];

/** Moves top-level objects (by id) by (dx, dy) points: every position inside them, labels included. */
export function moveObjects(doc: CdxDoc, ids: Iterable<string>, dx: number, dy: number): void {
  const movedIds = new Set<string>();
  const want = new Set(ids);
  // An arrow's older copy (a graphic it supersedes, never drawn) goes where the arrow goes.
  walk(doc.root, (x) => {
    if (x.name === "graphic" && x.attrs.SupersededBy && want.has(x.attrs.SupersededBy) && x.attrs.id) want.add(x.attrs.id);
  });
  const tied = arrowAnchors(doc.root);
  for (const id of want) {
    const top = findById(doc.root, id)?.el;
    if (!top) continue;
    walk(top, (x) => {
      if (x.attrs.id) movedIds.add(x.attrs.id);
      for (const k of POSITIONAL) {
        const v = x.attrs[k];
        if (v === undefined) continue;
        const nums = v.trim().split(/\s+/).map(Number);
        if (!nums.every(Number.isFinite)) continue;
        // x y (z): x, y move; z stays. A box / list: alternate x, y.
        const step = k.endsWith("3D") || k === "xyz" ? 3 : 2;
        x.attrs[k] = nums.map((n, i) => fmt(i % step === 0 ? n + dx : i % step === 1 ? n + dy : n)).join(" ");
      }
    });
  }
  // Only the η-bonds whose ring atoms moved follow them (an imported centre a hair off its centroid is left alone).
  syncHaptoCentres(doc.root, movedIds);
  // Mechanism arrows tied to atoms that moved follow them.
  followAnchors(doc.root, tied);
}

/**
 * Puts every η-bond's centre (ChemDraw's MultiAttachment node) back at the centroid of the atoms it binds — where
 * ChemDraw puts it — after some of those atoms moved. Returns how many centres moved.
 */
export function syncHaptoCentres(root: XNode, onlyFor?: ReadonlySet<string>): number {
  let moved = 0;
  walk(root, (f) => {
    if (f.name !== "fragment") return;
    const at = new Map<string, XNode>();
    for (const c of f.children) if (c.name === "n" && c.attrs.id) at.set(c.attrs.id, c);
    for (const c of f.children) {
      if (c.name !== "n" || c.attrs.NodeType !== "MultiAttachment") continue;
      const ids = (c.attrs.Attachments ?? "").split(/\s+/).filter(Boolean);
      if (onlyFor && !ids.some((i) => onlyFor.has(i))) continue;
      const pts = ids.map((i) => at.get(i)).filter((n): n is XNode => !!n).map(posOf);
      if (!pts.length) continue;
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const next = `${fmt(cx)} ${fmt(cy)}`;
      if (c.attrs.p !== next) {
        c.attrs.p = next;
        moved++;
      }
    }
  });
  return moved;
}

/** True for an η-bond's centre (ChemDraw's MultiAttachment node): a point, not an atom. */
export function isHaptoCentre(n: XNode): boolean {
  return n.name === "n" && n.attrs.NodeType === "MultiAttachment";
}
const HAPTO_CENTRE = "that point is the centre of an η-bond (where the metal binds the ring), not an atom — click a ring atom or the metal";
const HAPTO_BOND = "an η-bond is one plain line from the metal to the ring's centre (ChemDraw has no order or style for it) — erase it to remove it";
/** True for the bond from an η-bond's centre to its metal. */
function haptoBond(frag: XNode, b: XNode): boolean {
  return frag.children.some((c) => isHaptoCentre(c) && (c.attrs.id === b.attrs.B || c.attrs.id === b.attrs.E));
}

/**
 * Removes top-level objects, and every reference to what they held: bracketed groups whose bonds or
 * atoms went, reaction steps that listed them, chemical properties computed from them (their names
 * would describe something no longer drawn).
 */
export function deleteObjects(doc: CdxDoc, ids: Iterable<string>): void {
  const gone = new Set<string>();
  for (const id of new Set(ids)) {
    const hit = findById(doc.root, id);
    if (!hit || !hit.parent) continue;
    walk(hit.el, (x) => void (x.attrs.id && gone.add(x.attrs.id)));
    hit.parent.children = hit.parent.children.filter((c) => c !== hit.el);
  }
  // A group left empty goes too.
  const prune = (n: XNode): void => {
    n.children = n.children.filter((c) => !((c.name === "group" || c.name === "altgroup") && (prune(c), !c.children.length)));
  };
  const page = pageOf(doc.root);
  if (page) prune(page);
  dropReferences(doc.root, gone);
}

/** Cleans the semantic objects that pointed at ids no longer in the document. */
function dropReferences(root: XNode, gone: Set<string>): void {
  const page = pageOf(root);
  if (!page || !gone.size) return;
  const list = (v: string | undefined): string[] => (v ?? "").split(/\s+/).filter(Boolean);
  const keep = (v: string | undefined): string => list(v).filter((i) => !gone.has(i)).join(" ");
  const removeIds = new Set<string>();
  // First the η-bonds the deletion breaks — their centres and bonds are gone too, so every reference to them below
  // goes with them (review: a polymer's BracketedObjectIDs kept a deleted centre's id). An η-bond whose ring lost an
  // atom no longer says which atoms the metal binds; one whose bond to the metal was erased is a point bound to nothing.
  walk(page, (f) => {
    if (f.name !== "fragment") return;
    for (const c of f.children) {
      if (c.name !== "n" || c.attrs.NodeType !== "MultiAttachment" || gone.has(c.attrs.id ?? "")) continue;
      const toIt = f.children.filter((b) => b.name === "b" && (b.attrs.B === c.attrs.id || b.attrs.E === c.attrs.id) && !gone.has(b.attrs.id ?? ""));
      if (toIt.length && !list(c.attrs.Attachments).some((i) => gone.has(i))) continue;
      for (const x of [c, ...toIt]) {
        gone.add(x.attrs.id ?? "\u0000");
        removeIds.add(x.attrs.id ?? "\u0000");
      }
    }
  });
  walk(page, (x) => {
    if (x.name === "bracketedgroup") {
      x.children = x.children.filter((a) => {
        if (a.name !== "bracketattachment") return true;
        const cb = a.children.find((c) => c.name === "crossingbond");
        return !(gone.has(a.attrs.GraphicID ?? "") || gone.has(cb?.attrs.BondID ?? "") || gone.has(cb?.attrs.InnerAtomID ?? ""));
      });
      x.attrs.BracketedObjectIDs = keep(x.attrs.BracketedObjectIDs);
      if (!x.attrs.BracketedObjectIDs || !x.children.some((a) => a.name === "bracketattachment")) removeIds.add(x.attrs.id ?? "\u0000");
    } else if (x.name === "step") {
      for (const k of ["ReactionStepReactants", "ReactionStepProducts", "ReactionStepArrows", "ReactionStepObjectsAboveArrow", "ReactionStepObjectsBelowArrow", "ReactionStepPlusses"])
        if (x.attrs[k] !== undefined) x.attrs[k] = keep(x.attrs[k]);
    } else if (x.name === "chemicalproperty") {
      if (list(x.attrs.BasisObjects).some((i) => gone.has(i)) || gone.has(x.attrs.ChemicalPropertyDisplayID ?? "")) removeIds.add(x.attrs.id ?? "\u0000");
    } else if (x.name === "graphic" && x.children.some((c) => c.name === "represent" && gone.has(c.attrs.object ?? ""))) {
      // A ⊕ that showed a removed atom's charge would read as a charge on whatever is near it.
      removeIds.add(x.attrs.id ?? "\u0000");
    } else if (x.name === "graphic" && x.attrs.SupersededBy && gone.has(x.attrs.SupersededBy)) {
      // An arrow's older copy goes with the arrow.
      removeIds.add(x.attrs.id ?? "\u0000");
    } else if (x.name === "arrow") {
      // A mechanism arrow whose atom or bond was erased stays where it was drawn, tied to nothing at that end (the
      // chemist erased the atom, not the arrow; the arrow is erased on its own).
      if (gone.has(x.attrs.ArrowSource ?? "")) delete x.attrs.ArrowSource;
      if (gone.has(x.attrs.ArrowTarget ?? "")) delete x.attrs.ArrowTarget;
    }
  });
  const prune = (n: XNode): void => {
    n.children = n.children.filter((c) => !removeIds.has(c.attrs.id ?? ""));
    n.children.forEach(prune);
  };
  prune(page);
}

// ---- text -------------------------------------------------------------------------------

/** Replaces a text object's words, keeping the style of its first run (font, size, face, colour). */
export function setText(doc: CdxDoc, textId: string, text: string): string | null {
  const hit = findById(doc.root, textId);
  if (!hit || hit.el.name !== "t") return "that text is no longer in the document";
  if (!text.trim()) return "the text is empty — delete the object instead";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return "the text contains a control character";
  const first = hit.el.children.find((c) => c.name === "s");
  const s: XNode = { name: "s", attrs: { ...(first?.attrs ?? {}) }, children: [], text, line: 0 };
  hit.el.children = [...hit.el.children.filter((c) => c.name !== "s"), s];
  // The box is re-estimated for the new words from p (the left end of the first baseline).
  const p = (hit.el.attrs.p ?? "").split(/\s+/).map(Number);
  if (p.length >= 2 && p.every(Number.isFinite)) {
    const size = Number(s.attrs.size) || doc.style.captionSize;
    const lines = text.split(/\r\n|\r|\n/);
    const em = Math.max(...lines.map((l) => [...l].reduce((w, ch) => w + (/[A-Z0-9]/.test(ch) ? 0.72 : ch === " " ? 0.28 : 0.56), 0)));
    hit.el.attrs.BoundingBox = [p[0], p[1] - size * 0.8, p[0] + em * size, p[1] + size * 0.25 + (lines.length - 1) * size * 1.15].map(fmt).join(" ");
  }
  return null;
}

// ---- atoms and bonds ----------------------------------------------------------------------

/** Generic labels ChemDraw treats as generic nicknames (R groups and the usual variables). */
const GENERIC = /^(R\d{0,2}|R'{1,3}|X|Y|Z|Q|A|G|Ar|M|E|L)$/;
/** Standard valences used to show implicit hydrogens on a labelled atom (as ChemDraw shows NH, OH). */
const VALENCE: Record<string, number[]> = { B: [3], C: [4], N: [3], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1], Si: [4], Se: [2, 4, 6] };
/**
 * Hydrogens a labelled atom shows: its allowed valences shifted by its charge (an N⁺ or O⁺ takes
 * one more bond — NH4⁺, H3O⁺; an O⁻ or S⁻ one fewer; B⁻ one more — BH4⁻; C keeps 4 − |q|), the
 * smallest that holds its bonds, less those bonds.
 */
function implicitH(sym: string, charge: number, bonds: number): number | null {
  const vals = allowedValences(sym, charge);
  if (!vals) return null;
  const v = vals.find((x) => x >= bonds - 1e-9) ?? vals[vals.length - 1] ?? 0;
  return Math.max(0, Math.round(v - bonds));
}

/** An element's valences shifted by its charge (see implicitH); null for an element not in VALENCE. */
function allowedValences(sym: string, charge: number): number[] | null {
  const base = VALENCE[sym];
  if (!base) return null;
  const shift = sym === "C" || sym === "Si" ? -Math.abs(charge) : sym === "B" ? -charge : ["F", "Cl", "Br", "I"].includes(sym) ? -Math.abs(charge) : charge;
  return base.map((v) => v + shift).filter((v) => v >= 0);
}

/** The sum of bond orders at an atom (aromatic 1.5; unknown orders count 1). */
function bondOrderSum(frag: XNode, nodeId: string): number {
  let s = 0;
  for (const b of frag.children)
    if (b.name === "b" && (b.attrs.B === nodeId || b.attrs.E === nodeId)) {
      // Hydrogen and ionic bonds hold no valence; a dative bond holds one; an unknown order, one.
      const w = (b.attrs.Order ?? "1").split(/\s+/)[0];
      const o = w === "hydrogen" || w === "ionic" ? 0 : w === "dative" ? 1 : Number(w);
      s += Number.isFinite(o) ? o : 1;
    }
  return s;
}

export function fragmentOf(root: XNode, nodeId: string): { frag: XNode; node: XNode } | null {
  let out: { frag: XNode; node: XNode } | null = null;
  walk(root, (x, p) => {
    if (!out && x.name === "n" && x.attrs.id === nodeId && p && p.name === "fragment") out = { frag: p, node: x };
  });
  return out;
}

/**
 * A label's text object, placed as ChemDraw places it: the first character centred on the atom (right-aligned, written
 * left of its bond: the last). Its p and box from the page's glyph model (cdxGlyphs.labelGeometry), the one the
 * renderer draws with: the box runs exactly from the text's start to its advance end, so a bond stops the page's
 * margin from the letters themselves (an estimate of 0.72 em a capital made "Br" 2.7 pt too wide, and a Br–Br bond ran
 * into the second label).
 */
function labelText(doc: CdxDoc, node: XNode, text: string, rightAligned = false): XNode {
  const st = doc.style;
  const s: XNode = { name: "s", attrs: { font: String(st.labelFont), size: fmt(st.labelSize), face: String(st.labelFace) }, children: [], text, line: 0 };
  const t: XNode = { name: "t", attrs: { p: "", BoundingBox: "", LabelJustification: rightAligned ? "Right" : "Left" }, children: [s], text: "", line: 0 };
  fitLabel(doc, node, t);
  return t;
}

/**
 * Sets a one-line label's p and box for its runs as they now read (after hydrogens or an isotope are added), keeping
 * its justification: the letter that bonds centred on the atom — the last for a right-justified label, else the first
 * letter after a leading mass number. p is where ChemDraw puts it for that justification (the text's start, end or
 * middle on its baseline). A label over several lines is left as it is.
 */
export function fitLabel(doc: CdxDoc, node: XNode, t: XNode, centreLast = t.attrs.LabelJustification === "Right"): void {
  const runs = t.children.filter((c) => c.name === "s").map((c) => ({ text: c.text, face: Number(c.attrs.face ?? doc.style.labelFace) || 0, size: Number(c.attrs.size) || doc.style.labelSize }));
  const flat = runs.map((r) => r.text).join("");
  if (!flat || /[\r\n]/.test(flat)) return;
  const [x, y] = (node.attrs.p ?? "0 0").split(/\s+/).map(Number);
  const stack = t.attrs.LabelAlignment === "Below" || t.attrs.LabelAlignment === "Above";
  if (stack && runs.length === 1) {
    const sg = stackedLabelGeometry([x, y], runs[0], t.attrs.LabelAlignment === "Below");
    if (sg) {
      t.attrs.p = `${fmt(sg.p[0])} ${fmt(sg.p[1])}`;
      t.attrs.BoundingBox = sg.box.map(fmt).join(" ");
      return;
    }
  }
  const right = t.attrs.LabelJustification === "Right";
  const lead = runs.length > 1 && (runs[0].face & 0x60) !== 0x60 && (runs[0].face & 0x60) !== 0 ? [...runs[0].text].length : 0;
  const g = labelGeometry([x, y], runs, centreLast ? [...flat].length - 1 : lead);
  const px = right ? g.box[2] : t.attrs.LabelJustification === "Center" ? (g.box[0] + g.box[2]) / 2 : g.box[0];
  t.attrs.p = `${fmt(px)} ${fmt(g.p[1])}`;
  t.attrs.BoundingBox = g.box.map(fmt).join(" ");
}

/** ChemDraw's Radical values as OCL radical states. */
const RADICAL_STATE: Record<string, number> = { Singlet: Molecule.cAtomRadicalStateS, Doublet: Molecule.cAtomRadicalStateD, Triplet: Molecule.cAtomRadicalStateT };

/** A tetrahydrido ligand as labelled: BH4, AlH4, GaH4 (hydrogens as drawn, not counted from valence). */
const HYDRIDO = /^(B|Al|Ga)H4$/;

/** Group names that are also element symbols: in a structure drawing they are the group (ChemDraw's reading). */
const GROUP_OVER_ELEMENT = new Set(["Ac", "Pr", "Ts", "Bu"]);

/** The hydrogens an element atom shows with these bonds and charge: VALENCE where known, else OCL's own count. */
function hydrogensFor(z: number, charge: number, frag: XNode, nodeId: string): number | null {
  const sym = symbolFor(z);
  if (!sym) return null;
  const radical = RADICAL_STATE[frag.children.find((c) => c.name === "n" && c.attrs.id === nodeId)?.attrs.Radical ?? ""] ?? 0;
  if (z === 1) return charge || radical ? 0 : Math.max(0, 1 - bondOrderSum(frag, nodeId));
  const known = radical ? null : implicitH(sym, charge, bondOrderSum(frag, nodeId));
  if (known !== null) return known;
  try {
    const m = new Molecule(8, 8);
    const a = m.addAtom(z);
    if (charge) m.setAtomCharge(a, charge);
    if (radical) m.setAtomRadical(a, radical);
    for (const b of frag.children) {
      if (b.name !== "b" || (b.attrs.B !== nodeId && b.attrs.E !== nodeId)) continue;
      const w = (b.attrs.Order ?? "1").split(/\s+/)[0];
      const c = m.addAtom(6);
      const bond = m.addBond(a, c);
      m.setBondType(bond, w === "2" ? Molecule.cBondTypeDouble : w === "3" ? Molecule.cBondTypeTriple : Molecule.cBondTypeSingle);
    }
    m.ensureHelperArrays(Molecule.cHelperNeighbours);
    return m.getImplicitHydrogens(a);
  } catch {
    return null;
  }
}

/** Which side of its one bond a label sits on: "left" when its neighbour lies to its right. */
function sideOf(frag: XNode, node: XNode): "left" | "right" {
  const b = frag.children.find((q) => q.name === "b" && (q.attrs.B === node.attrs.id || q.attrs.E === node.attrs.id));
  const other = b ? frag.children.find((c) => c.name === "n" && c.attrs.id === (b.attrs.B === node.attrs.id ? b.attrs.E : b.attrs.B)) : undefined;
  return other && posOf(other)[0] - posOf(node)[0] > 1e-6 ? "left" : "right";
}

/**
 * Sets what an atom is: an element symbol ("N", "Cl"; "C" makes it a bare vertex again; "[Ac]" the element
 * where the name is also a group's), an isotope ("13C", D, T), a generic label (R1, X, Ar …), a group label
 * (OMe, Ph, Boc …: read as its group for the formula, written the way ChemDraw writes it on its side of the
 * bond — MeO on the left), or other text, kept as a label with no formula (said in the note).
 */
export function setAtomLabel(doc: CdxDoc, nodeId: string, label: string): { ok: true; note: string | null } | { ok: false; reason: string } {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return { ok: false, reason: "that atom is no longer in the document" };
  let t = label.trim();
  if (!t) return { ok: false, reason: "type an element symbol or a label" };
  if (t.length > 40 || /[\u0000-\u001f]/.test(t)) return { ok: false, reason: "that label is too long or contains a control character" };
  const { frag, node } = hit;
  if (isHaptoCentre(node)) return { ok: false, reason: HAPTO_CENTRE };
  for (const k of ["Element", "NumHydrogens", "NodeType", "GenericNickname", "NeedsClean", "Warning", "Isotope", "ElementList", "GenericList"]) delete node.attrs[k];
  node.children = node.children.filter((c) => c.name !== "t" && c.name !== "fragment");
  const charge = Number(node.attrs.Charge ?? 0) || 0;
  // "[N,O]" or "NOT [F,Cl]": an atom list (any one of those elements, or any but them) — a query structure.
  if (/^(NOT\s*)?\[[^\]]*,[^\]]*\]$|^NOT\s*\[[^\]]+\]$/.test(t)) {
    const lst = parseElementList(undefined, t, atomicNumber);
    if (typeof lst === "string") return { ok: false, reason: lst };
    node.attrs.NodeType = "ElementList";
    node.attrs.ElementList = `${lst.not ? "NOT " : ""}${lst.list.join(" ")}`;
    node.children.push(labelText(doc, node, elementListLabel(lst.list, lst.not, (z) => symbolFor(z) ?? "?")));
    return { ok: true, note: `An atom list: ${lst.not ? "any element but" : "any one of"} ${lst.list.map((z) => symbolFor(z)).join(", ")} — the structure is a query (no single formula).` };
  }
  // D and T: hydrogen's isotopes, drawn as D and T.
  if (t === "D" || t === "T") {
    node.attrs.Element = "1";
    node.attrs.Isotope = t === "D" ? "2" : "3";
    node.children.push(labelText(doc, node, t));
    return { ok: true, note: null };
  }
  // "13C", "15N": an isotope.
  const iso = /^(\d{1,3})([A-Z][a-z]?)$/.exec(t);
  if (iso && atomicNumber(iso[2]) !== null) {
    const z = atomicNumber(iso[2])!;
    const mass = Number(iso[1]);
    if (!(mass >= 1)) return { ok: false, reason: `${t} has no mass number` };
    const h = hydrogensFor(z, charge, frag, nodeId) ?? 0;
    writeElementLabel(doc, nodeId, z, h, mass);
    return { ok: true, note: null };
  }
  // "[Ac]": the element itself, where its symbol is also a group's name.
  const forced = /^\[([A-Z][a-z]?)\]$/.exec(t);
  if (forced) t = forced[1];
  // "BH4", "AlH4", "GaH4": a tetrahydrido ligand on a metal (borohydride, alanate, gallate), where valence does not say
  // the count. Written as ChemDraw writes it — the element with NumHydrogens 4 — and kept as drawn when its bonds or
  // charge change (relabel recognises the label itself: no attribute of JurisLab's own, so a ChemDraw file's BH4 is
  // kept too). Only these three: a general "element + H count" rule gave NH3 on a carbon a confident wrong formula
  // (review). Other hydrides (NH3, PH3, SiH4) read as before.
  // A ligand: one bond at most (on a boron with two carbons, "BH4" would be a confident wrong count — review round 2).
  const hydrido = !forced && frag.children.filter((b) => b.name === "b" && (b.attrs.B === nodeId || b.attrs.E === nodeId)).length <= 1 ? HYDRIDO.exec(t) : null;
  if (hydrido) {
    const hz = atomicNumber(hydrido[1])!;
    node.attrs.Element = String(hz);
    node.attrs.NumHydrogens = "4";
    node.children.push(labelText(doc, node, `${hydrido[1]}H4`));
    return { ok: true, note: `${hydrido[1]}H₄: ${hydrido[1]} with 4 hydrogens as drawn (a ${hydrido[1] === "B" ? "borohydride" : hydrido[1] === "Al" ? "alanate" : "gallate"} ligand; ChemDraw writes it the same way).` };
  }
  const groupFirst = !forced && GROUP_OVER_ELEMENT.has(t);
  // "Ar" and "Y" are argon and yttrium, but in a structure drawing they are aryl and a variable:
  // read as generic labels, and said so.
  const ambiguous = !forced && (t === "Ar" || t === "Y");
  const z = ambiguous || groupFirst ? null : atomicNumber(t);
  if (z !== null) {
    if (z !== 6) node.attrs.Element = String(z);
    if (z === 6) return { ok: true, note: null }; // a carbon: a bare vertex
    const sym = symbolFor(z)!;
    const h = hydrogensFor(z, charge, frag, nodeId);
    if (h !== null) node.attrs.NumHydrogens = String(h);
    // Left of its bond, its hydrogens come first, right-aligned on the atom (HO, H2N), as ChemDraw writes it.
    const hs = h ? "H" + (h > 1 ? h : "") : "";
    // Its hydrogens on the side away from its bonds (hSide).
    const lt = labelText(doc, node, sym, false);
    placeHydrogens(doc, node, lt, sym, hs, hs ? hSide(frag, node) : "right");
    node.children.push(lt);
    return { ok: true, note: null };
  }
  if (GENERIC.test(t)) {
    node.attrs.NodeType = "GenericNickname";
    node.attrs.GenericNickname = t;
    node.children.push(labelText(doc, node, t));
    return { ok: true, note: ambiguous ? `${t} is read as a generic label (${t === "Ar" ? "aryl" : "a variable"}), not ${t === "Ar" ? "argon" : "yttrium"}.` : null };
  }
  node.attrs.NodeType = "Unspecified";
  if (isGroupLabel(t)) {
    // Written for its side of the bond, as ChemDraw writes it (OMe on the left reads MeO, MeO on the right
    // OMe), justified so the letter that bonds sits on the atom: the last for a leftward form, else the first.
    const left = sideOf(frag, node) === "left";
    const side = left ? "left" : "right";
    const shown = left ? leftwardOf(t) ?? t : groupSmilesBySide(t, "right") ? t : rightwardOf(t) ?? t;
    // Right-aligned (the last letter on the atom) only where the label reads leftward; a label with no
    // leftward reading (OPr) stays left-aligned and reads from its first letter wherever it sits.
    const rightAligned = left && !!groupSmilesBySide(shown, "left");
    node.children.push(labelText(doc, node, shown, rightAligned));
    if (!groupSmilesBySide(shown, rightAligned ? "left" : "right"))
      return { ok: true, note: `${t} written ${side} of its bond reads from its ${rightAligned ? "last" : "first"} letter — not a group this knows that way (${t === "SCN" ? "thiocyanate" : t === "NC" ? "isocyanide" : t === "OCN" ? "cyanate" : "draw its atoms"}), so the structure has no single formula.` };
    return { ok: true, note: groupFirst ? `${t} is read as the group (${t === "Ac" ? "acetyl" : t === "Pr" ? "propyl" : t === "Ts" ? "tosyl" : "butyl"}); for the element, type [${t}].` : null };
  }
  node.children.push(labelText(doc, node, t));
  return { ok: true, note: `${t} is drawn as text — not an element, an R-group or a group this knows (OMe, Ph, Boc …), so the structure has no single formula.` };
}

/** Sets a bond's order (1, 2, 3, 1.5) or its style (Solid, WedgeBegin, WedgedHashBegin, Wavy, Bold, Dash …). */
export function setBond(doc: CdxDoc, bondId: string, change: { order?: string; display?: string; flip?: boolean }): string | null {
  const hit = findById(doc.root, bondId);
  if (!hit || hit.el.name !== "b") return "that bond is no longer in the document";
  const b = hit.el;
  if (hit.parent && haptoBond(hit.parent, b)) return HAPTO_BOND;
  if (change.order !== undefined) {
    if (!["1", "2", "3", "1.5"].includes(change.order)) return `bond order ${change.order} is not one this editor sets`;
    if (change.order === "1") delete b.attrs.Order;
    else b.attrs.Order = change.order;
    delete b.attrs.DoublePosition;
  }
  if (change.display !== undefined) {
    if (change.display === "Solid") delete b.attrs.Display;
    else b.attrs.Display = change.display;
  }
  if (change.flip) {
    const B = b.attrs.B;
    b.attrs.B = b.attrs.E;
    b.attrs.E = B;
  }
  if (change.order !== undefined && hit.parent) {
    for (const id of [b.attrs.B, b.attrs.E]) {
      const n = hit.parent.children.find((c) => c.name === "n" && c.attrs.id === id);
      if (n) relabel(doc, n);
    }
  }
  return null;
}

/**
 * Adds a bond from an atom: a new carbon one bond length away, at the chain angle from the atom's
 * existing bonds (straight out from a single neighbour, into the widest gap otherwise).
 */
export function addBondFrom(doc: CdxDoc, nodeId: string): { ok: true; nodeId: string; bondId: string } | { ok: false; reason: string } {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return { ok: false, reason: "that atom is no longer in the document" };
  const { frag, node } = hit;
  const full = bondRoomRefusal(frag, node);
  if (full) return { ok: false, reason: full };
  const pos = (n: XNode): [number, number] => (n.attrs.p ?? "0 0").split(/\s+/).map(Number) as [number, number];
  const [x, y] = pos(node);
  const nb: Array<[number, number]> = [];
  for (const b of frag.children) {
    if (b.name !== "b") continue;
    const other = b.attrs.B === nodeId ? b.attrs.E : b.attrs.E === nodeId ? b.attrs.B : null;
    const on = other ? frag.children.find((c) => c.name === "n" && c.attrs.id === other) : undefined;
    if (on) nb.push(pos(on));
  }
  const angles = nb.map(([a, c]) => Math.atan2(c - y, a - x)).sort((p, q) => p - q);
  let dir: number;
  if (!angles.length) dir = -Math.PI / 6;
  else if (angles.length === 1) {
    // 120° either way from it: the side farther from the structure's other atoms (a zig-zag goes on).
    const all = frag.children.filter((c) => c.name === "n" && c.attrs.id !== nodeId).map(pos);
    const c1 = angles[0] + (2 * Math.PI) / 3, c2 = angles[0] - (2 * Math.PI) / 3;
    const L0 = doc.style.bondLength;
    const roomAt = (d: number): number => Math.min(...all.map(([a, c]) => Math.hypot(a - (x + L0 * Math.cos(d)), c - (y + L0 * Math.sin(d)))));
    dir = roomAt(c1) >= roomAt(c2) ? c1 : c2;
  }
  else {
    let best = 0, gapBest = -1;
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i], c = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
      if (c - a > gapBest) {
        gapBest = c - a;
        best = a + (c - a) / 2;
      }
    }
    dir = best;
  }
  const L = doc.style.bondLength;
  const id = nextIdFrom(doc.root);
  const nid = id(), bid = id();
  frag.children.push({ name: "n", attrs: { id: nid, p: `${fmt(x + L * Math.cos(dir))} ${fmt(y + L * Math.sin(dir))}` }, children: [], text: "", line: 0 });
  frag.children.push({ name: "b", attrs: { id: bid, B: nodeId, E: nid }, children: [], text: "", line: 0 });
  // A labelled atom's hydrogens change with its bonds.
  relabel(doc, node);
  return { ok: true, nodeId: nid, bondId: bid };
}

/** Removes an atom (and its bonds) or a bond, inside a structure. */
export function deleteInStructure(doc: CdxDoc, id: string): string | null {
  const hit = findById(doc.root, id);
  if (!hit || !hit.parent || hit.parent.name !== "fragment" || (hit.el.name !== "n" && hit.el.name !== "b")) return "that atom or bond is no longer in the document";
  const frag = hit.parent;
  const gone = new Set<string>([id]);
  const ends = new Set<string>();
  if (hit.el.name === "n") {
    walk(hit.el, (x) => void (x.attrs.id && gone.add(x.attrs.id)));
    for (const b of frag.children)
      if (b.name === "b" && (b.attrs.B === id || b.attrs.E === id)) {
        gone.add(b.attrs.id ?? "");
        ends.add(b.attrs.B === id ? b.attrs.E : b.attrs.B);
      }
  } else {
    ends.add(hit.el.attrs.B);
    ends.add(hit.el.attrs.E);
  }
  frag.children = frag.children.filter((c) => !gone.has(c.attrs.id ?? ""));
  dropReferences(doc.root, gone);
  for (const e of ends) {
    const n = frag.children.find((c) => c.name === "n" && c.attrs.id === e);
    if (!n) continue;
    relabel(doc, n);
    // An unlabelled carbon left with no bonds would be invisible yet still counted: it is shown, as
    // ChemDraw shows a lone carbon (CH₄).
    const lone = !frag.children.some((b) => b.name === "b" && (b.attrs.B === e || b.attrs.E === e));
    if (lone && !n.children.some((c) => c.name === "t") && (!n.attrs.NodeType || n.attrs.NodeType === "Element") && (n.attrs.Element ?? "6") === "6") {
      const h = Math.max(0, 4 - Math.abs(Number(n.attrs.Charge ?? 0) || 0));
      n.attrs.NumHydrogens = String(h);
      n.children.push(labelText(doc, n, "C" + (h ? "H" + (h > 1 ? h : "") : "")));
    }
  }
  return null;
}

/** Re-sets a labelled element atom's hydrogens after its bonds changed (generic and text labels stay). */
/**
 * Re-counts a labelled atom's hydrogens after its bonds or charge changed, keeping the label as it is
 * drawn: H first where it was (H3C, HO), stacked where it was, the same run's font and position. A
 * label that says more than its element and hydrogens (an isotope, a radical, other text) is left as
 * drawn — rewriting it would lose what it says.
 */
function relabel(doc: CdxDoc, node: XNode): void {
  if (node.attrs.NodeType && node.attrs.NodeType !== "Element") return;
  // A tetrahydrido ligand (BH4 on a metal, from JurisLab or from ChemDraw) keeps its hydrogens as drawn.
  const shown = node.children.find((c) => c.name === "t")?.children.filter((c) => c.name === "s").map((c) => c.text).join("") ?? "";
  if (HYDRIDO.test(shown.trim()) && node.attrs.NumHydrogens === "4") return;
  const t = node.children.find((c) => c.name === "t");
  if (!t) return;
  const sym = symbolFor(Number(node.attrs.Element ?? 6));
  if (!sym) return;
  const runs = t.children.filter((c) => c.name === "s");
  if (!runs.length) return;
  if (node.attrs.Isotope) {
    // "¹³CH₃" / "H₂¹⁵N" as writeElementLabel writes it: the mass number (one run) before the symbol, hydrogens beside.
    const massRuns = runs.filter((r) => r.text === node.attrs.Isotope);
    const rest = runs.filter((r) => r !== massRuns[0]).map((r) => r.text).join("");
    if (massRuns.length !== 1 || !new RegExp(`^(H\\d*)?${sym}(H\\d*)?$`).test(rest)) return;
    const f = fragmentOf(doc.root, node.attrs.id ?? "")?.frag;
    const hi = f ? hydrogensFor(Number(node.attrs.Element ?? 6), Number(node.attrs.Charge ?? 0) || 0, f, node.attrs.id ?? "") : null;
    if (hi === null) return;
    writeElementLabel(doc, node.attrs.id ?? "", Number(node.attrs.Element ?? 6), hi, Number(node.attrs.Isotope));
    return;
  }
  const text = runs.map((r) => r.text).join("");
  const flat = text.replace(/\n/g, "");
  const m = new RegExp(`^(H\\d*)?${sym}(H\\d*)?$`).exec(flat);
  if (!m || (m[1] && m[2])) return;
  const frag = fragmentOf(doc.root, node.attrs.id ?? "")?.frag;
  if (!frag) return;
  const h = hydrogensFor(Number(node.attrs.Element ?? 6), Number(node.attrs.Charge ?? 0) || 0, frag, node.attrs.id ?? "");
  if (h === null) return;
  const hs = h ? "H" + (h > 1 ? h : "") : "";
  const sep = text.includes("\n") ? "\n" : "";
  if (!sep) {
    // Its hydrogens set again on the side away from its bonds, which may have just changed (a bond added toward them).
    node.attrs.NumHydrogens = String(h);
    const s0 = runs[0];
    t.children = t.children.filter((c) => c.name !== "s" || c === s0);
    placeHydrogens(doc, node, t, sym, hs, hs ? hSide(frag, node) : "right");
    return;
  }
  const hFirst = !!m[1] || (!m[2] && t.attrs.LabelJustification === "Right");
  const next = !hs ? sym : hFirst ? hs + sep + sym : sym + sep + hs;
  node.attrs.NumHydrogens = String(h);
  if (next === text) return;
  runs[0].text = next;
  t.children = t.children.filter((c) => c.name !== "s" || c === runs[0]);

}

type HSide = "right" | "left" | "below" | "above";
/**
 * Where a labelled atom's hydrogens go, as ChemDraw puts them: on the side away from its bonds. Right (NH2) or left
 * (H2N), whichever keeps farther from every bond (right on a tie) — and where both keep within 60° of a bond (bonds
 * leaving both ways), stacked below or above the element if that side is freer. A lone atom: right.
 */
function hSide(frag: XNode, node: XNode): HSide {
  const p = posOf(node), id = node.attrs.id;
  const dirs: number[] = [];
  for (const b of frag.children) {
    if (b.name !== "b" || (b.attrs.B !== id && b.attrs.E !== id)) continue;
    const o = frag.children.find((c) => c.name === "n" && c.attrs.id === (b.attrs.B === id ? b.attrs.E : b.attrs.B));
    if (o) dirs.push(Math.atan2(posOf(o)[1] - p[1], posOf(o)[0] - p[0]));
  }
  if (!dirs.length) return "right";
  const clear = (a: number): number => Math.min(...dirs.map((d) => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d)))));
  const r = clear(0), l = clear(Math.PI), dn = clear(Math.PI / 2), up = clear(-Math.PI / 2);
  const side: HSide = l > r + 1e-9 ? "left" : "right";
  if (Math.max(r, l) >= Math.PI / 3 - 1e-9) return side;
  if (Math.max(dn, up) > Math.max(r, l) + 1e-9) return dn >= up - 1e-9 ? "below" : "above";
  return side;
}

/**
 * Writes a label's element and hydrogens for a side: NH2 left-justified (the N on the atom), H2N right-justified, or
 * stacked — the element on the atom, its hydrogens centred below or above, centre-justified with LabelAlignment Below
 * or Above as ChemDraw writes a stacked label. Its p and box from the glyph model.
 */
function placeHydrogens(doc: CdxDoc, node: XNode, t: XNode, sym: string, hs: string, side: HSide): void {
  const s0 = t.children.find((c) => c.name === "s");
  if (!s0) return;
  const stacked = !!hs && (side === "below" || side === "above");
  s0.text = !hs ? sym : side === "left" ? hs + sym : sym + hs;
  const just = !hs ? "Left" : side === "left" ? "Right" : stacked ? "Center" : "Left";
  t.attrs.LabelJustification = just;
  if (stacked) t.attrs.LabelAlignment = side === "below" ? "Below" : "Above";
  else if (t.attrs.LabelAlignment) t.attrs.LabelAlignment = just;
  fitLabel(doc, node, t);
}

/**
 * Writes an element atom's label with the hydrogens it shows and its mass number — any element, carbon included (an
 * isolated, isotopic, charged or radical carbon is labelled, as ChemDraw labels it: CH₄, ¹³CH₃, CH₃⁻). The mass number
 * is a SUPERSCRIPT (face 0x40) set immediately before the element symbol: ¹³CH₃, H₂¹⁵N (never ¹⁵H₂N — the mass belongs
 * to the element, not to its hydrogens). An isotopic label keeps its hydrogens beside it (right or left), not stacked.
 */
export function writeElementLabel(doc: CdxDoc, nodeId: string, z: number, h: number, mass = 0): boolean {
  const hit = fragmentOf(doc.root, nodeId);
  const sym = symbolFor(z);
  if (!hit || !sym) return false;
  const { frag, node } = hit;
  node.children = node.children.filter((c) => c.name !== "t");
  if (z === 6) delete node.attrs.Element;
  else node.attrs.Element = String(z);
  node.attrs.NumHydrogens = String(h);
  if (mass) node.attrs.Isotope = String(mass);
  else delete node.attrs.Isotope;
  const hs = h ? "H" + (h > 1 ? h : "") : "";
  const t = labelText(doc, node, sym, false);
  let side = hs ? hSide(frag, node) : "right";
  if (mass && (side === "below" || side === "above")) side = "right";
  placeHydrogens(doc, node, t, sym, hs, side);
  if (mass) {
    const s0 = t.children.find((c) => c.name === "s")!;
    const sup: XNode = { name: "s", attrs: { ...s0.attrs, face: String(0x40) }, children: [], text: String(mass), line: 0 };
    if (hs && side === "left") {
      // H₂ ¹⁵N: hydrogens, then the mass, then the element (the element letter stays on the atom: right-justified).
      const el: XNode = { ...s0, attrs: { ...s0.attrs }, text: sym };
      s0.text = hs;
      t.children.splice(t.children.indexOf(s0) + 1, 0, sup, el);
    } else t.children.splice(t.children.indexOf(s0), 0, sup);
    fitLabel(doc, node, t);
  }
  node.children.push(t);
  return true;
}

/** Sets an atom's charge (−9…9); a labelled atom's hydrogens follow. */
export function setCharge(doc: CdxDoc, nodeId: string, charge: number): string | null {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return "that atom is no longer in the document";
  if (isHaptoCentre(hit.node)) return HAPTO_CENTRE;
  if (!Number.isInteger(charge) || Math.abs(charge) > 9) return "a charge is a whole number from −9 to 9";
  // B, C, N, O, F have no expanded octet: with e valence electrons left after the charge, an atom holds at most
  // min(e, 8 − e) bonds and hydrogens together (N⁺ 4, C⁺ 3, O⁻ 1). N³⁺ on methylamine came out as "NH₅³⁺".
  const z0 = Number(hit.node.attrs.Element ?? 6);
  if ((!hit.node.attrs.NodeType || hit.node.attrs.NodeType === "Element") && z0 >= 5 && z0 <= 9 && charge) {
    const e = z0 - 2 - charge;
    const bonds = bondOrderSum(hit.frag, nodeId);
    const sym = symbolFor(z0)!;
    const max = e < 0 || e > 8 ? -1 : Math.min(e, 8 - e);
    const h = hit.node.children.some((c) => c.name === "t") ? (implicitH(sym, charge, bonds) ?? 0) : 0;
    if (max < 0 || bonds > max + 1e-9 || bonds + h > max + 1e-9) {
      const q = `${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge > 0 ? "+" : "−"}`;
      return `${sym} with a ${q} charge can hold at most ${Math.max(0, max)} bond${max === 1 ? "" : "s"} and hydrogens (it has no expanded octet) — an impossible valence here`;
    }
  }
  if (charge) hit.node.attrs.Charge = String(charge);
  else delete hit.node.attrs.Charge;
  const symbols: Array<{ el: XNode; parent: XNode | null }> = [];
  walk(doc.root, (x, p) => {
    if (x.name === "graphic" && x.children.some((c) => c.name === "represent" && c.attrs.attribute === "Charge" && c.attrs.object === nodeId)) symbols.push({ el: x, parent: p });
  });
  for (const s of symbols) {
    if (charge === 1 || charge === -1) {
      s.el.attrs.SymbolType = charge > 0 ? "CirclePlus" : "CircleMinus";
    } else if (s.parent) s.parent.children = s.parent.children.filter((c) => c !== s.el); // drawn by the atom instead
  }
  relabel(doc, hit.node);
  return null;
}

/** An atom's properties beyond element and charge, as the canvas's Properties panel sets them ("" clears). */
export interface AtomProps {
  radical?: "" | "Doublet" | "Singlet" | "Triplet";
  /** Enhanced-stereo group: Absolute (none), And n, Or n. */
  stereo?: { type: "Absolute" | "And" | "Or"; group: number };
  /** e0–e3 exactly, u1–u3 up to, f0 no more than drawn. */
  substituents?: "" | "e0" | "e1" | "e2" | "e3" | "u1" | "u2" | "u3" | "f0";
  ringBonds?: "" | "NoRingBonds" | "SimpleRing" | "Fusion" | "SpiroOrHigher" | "AsDrawn";
  unsaturation?: "" | "MustBeAbsent" | "MustBePresent";
}

/** Sets an atom's radical, stereo group and query properties (ChemDraw's attributes); its hydrogens follow. */
export function setAtomProps(doc: CdxDoc, nodeId: string, p: AtomProps): string | null {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return "that atom is no longer in the document";
  const a = hit.node.attrs;
  const type = a.NodeType ?? "Element";
  if (type !== "Element" && type !== "ElementList") return "only an element atom or an atom list takes these properties (not a label or abbreviation)";
  if (p.radical !== undefined) {
    if (p.radical && type !== "Element") return "a radical belongs on an element atom";
    if (p.radical) a.Radical = p.radical;
    else delete a.Radical;
  }
  if (p.stereo) {
    if (p.stereo.type === "Absolute") delete a.EnhancedStereoType, delete a.EnhancedStereoGroupNum;
    else {
      if (!(Number.isInteger(p.stereo.group) && p.stereo.group >= 1 && p.stereo.group <= 32)) return "a stereo group is numbered 1 to 32";
      a.EnhancedStereoType = p.stereo.type;
      a.EnhancedStereoGroupNum = String(p.stereo.group);
    }
  }
  if (p.substituents !== undefined) {
    delete a.SubstituentsExactly, delete a.SubstituentsUpTo, delete a.FreeSites;
    const m = /^([euf])(\d)$/.exec(p.substituents);
    if (m) a[m[1] === "e" ? "SubstituentsExactly" : m[1] === "u" ? "SubstituentsUpTo" : "FreeSites"] = m[2];
  }
  if (p.ringBonds !== undefined) {
    if (p.ringBonds) a.RingBondCount = p.ringBonds;
    else delete a.RingBondCount;
  }
  if (p.unsaturation !== undefined) {
    if (p.unsaturation) a.UnsaturatedBonds = p.unsaturation;
    else delete a.UnsaturatedBonds;
  }
  const query = ["SubstituentsExactly", "SubstituentsUpTo", "FreeSites", "RingBondCount", "UnsaturatedBonds"].some((k) => a[k] !== undefined);
  // ChemDraw draws query marks and stereo-group labels when the document says to show them.
  if (query) doc.root.attrs.ShowAtomQuery ??= "yes";
  if (a.EnhancedStereoType) doc.root.attrs.ShowAtomEnhancedStereo ??= "yes";
  relabel(doc, hit.node);
  return null;
}

/** A bond's query properties: the orders it may be (several make it a query bond) and ring / chain. */
export function setBondProps(doc: CdxDoc, bondId: string, p: { orders?: string[]; topology?: "" | "Ring" | "Chain" }): string | null {
  const hit = findById(doc.root, bondId);
  if (!hit || hit.el.name !== "b") return "that bond is no longer in the document";
  const b = hit.el;
  if (hit.parent && haptoBond(hit.parent, b)) return HAPTO_BOND;
  if (p.orders !== undefined) {
    const ok = ["1", "2", "3", "1.5"];
    const orders = ok.filter((o) => p.orders!.includes(o));
    if (!orders.length || orders.length !== p.orders.length) return "choose at least one of single, double, triple, aromatic";
    if (orders.length > 1 && /Wedge|Hash/.test(b.attrs.Display ?? "")) return "a wedged bond cannot be a query bond — make it plain first (Bond tool)";
    if (orders.length === 1 && orders[0] === "1") delete b.attrs.Order;
    else b.attrs.Order = orders.join(" ");
    if (orders.length > 1) doc.root.attrs.ShowBondQuery ??= "yes";
  }
  if (p.topology !== undefined) {
    if (p.topology) b.attrs.Topology = p.topology;
    else delete b.attrs.Topology;
    if (p.topology) doc.root.attrs.ShowBondQuery ??= "yes";
  }
  // The atoms' hydrogens follow the bond's (first) order.
  const frag = fragmentOf(doc.root, b.attrs.B ?? "");
  for (const id of [b.attrs.B, b.attrs.E]) {
    const n = frag?.frag.children.find((c) => c.name === "n" && c.attrs.id === id);
    if (n) relabel(doc, n);
  }
  return null;
}

/**
 * An element label written for the side of its one bond, its drawn hydrogens kept (CH3 ↔ H3C, OH ↔ HO,
 * NH2 ↔ H2N): the text order and justification only. False when the label is not that simple form.
 */
export function turnLabelForSide(doc: CdxDoc, nodeId: string): boolean {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return false;
  const { frag, node } = hit;
  if ((node.attrs.NodeType ?? "Element") !== "Element" || node.attrs.Isotope) return false;
  if (frag.children.filter((b) => b.name === "b" && (b.attrs.B === nodeId || b.attrs.E === nodeId)).length !== 1) return false;
  const t = node.children.find((c) => c.name === "t");
  const runs = t?.children.filter((c) => c.name === "s") ?? [];
  if (!t || runs.length !== 1) return false;
  const sym = symbolFor(Number(node.attrs.Element ?? 6));
  const m = sym ? new RegExp(`^(?:(H\\d*)${sym}|${sym}(H\\d*))$`).exec(runs[0].text) : null;
  if (!m) return false;
  const hs = m[1] ?? m[2];
  if (!hs) return false;
  const left = sideOf(frag, node) === "left";
  const text = left ? hs + sym : sym + hs;
  if (text === runs[0].text && (t.attrs.LabelJustification === "Right") === left) return true;
  const fresh = labelText(doc, node, text, left);
  // The label keeps its own attributes (colour, alignment, id …) and its run its style; only the geometry and
  // justification are new.
  fresh.attrs = { ...t.attrs, p: fresh.attrs.p, BoundingBox: fresh.attrs.BoundingBox, LabelJustification: fresh.attrs.LabelJustification };
  if (t.attrs.LabelAlignment) fresh.attrs.LabelAlignment = fresh.attrs.LabelJustification;
  fresh.children[0].attrs = { ...runs[0].attrs };
  node.children = node.children.map((c) => (c === t ? fresh : c));
  return true;
}

/**
 * A label's justification (and its box) set for which letter sits on the atom — the first (left-justified) or
 * the last (right-justified) — its text and style runs untouched (subscripts and colour kept).
 */
export function realignLabel(doc: CdxDoc, nodeId: string, rightAligned: boolean): void {
  const node = findById(doc.root, nodeId)?.el;
  const t = node?.children.find((c) => c.name === "t");
  if (!node || !t) return;
  const text = t.children.filter((c) => c.name === "s").map((c) => c.text).join("").replace(/[\r\n]/g, "");
  const geo = labelText(doc, node, text, rightAligned);
  t.attrs.p = geo.attrs.p;
  t.attrs.BoundingBox = geo.attrs.BoundingBox;
  t.attrs.LabelJustification = rightAligned ? "Right" : "Left";
  if (t.attrs.LabelAlignment) t.attrs.LabelAlignment = t.attrs.LabelJustification;
}

// ---- ChemDraw-computed names ------------------------------------------------------------------

/** The text objects showing a name or property ChemDraw computed from these objects (or anything inside them). */
export function namesTiedTo(doc: CdxDoc, objectIds: Iterable<string>): string[] {
  const inside = new Set<string>();
  for (const id of objectIds) {
    const hit = findById(doc.root, id);
    if (hit) walk(hit.el, (x) => void (x.attrs.id && inside.add(x.attrs.id)));
  }
  return doc.properties.filter((p) => p.basis.some((b) => inside.has(b))).map((p) => p.displayId);
}

// ---- rings --------------------------------------------------------------------------------

export type RingKind = "benzene" | "cyclohexane" | "cyclopentane" | "cyclopropane" | "cyclobutane" | "cycloheptane" | "cyclopentadienyl";
const RING_SIZE: Record<RingKind, number> = { cyclopropane: 3, cyclobutane: 4, cyclopentane: 5, benzene: 6, cyclohexane: 6, cycloheptane: 7, cyclopentadienyl: 5 };

type P2 = [number, number];
const posOf = (n: XNode): P2 => (n.attrs.p ?? "0 0").split(/\s+/).map(Number) as P2;

/**
 * Puts a regular ring through the given vertices (in order) on a fragment, re-using any existing
 * atom within a fifth of a bond length of a vertex (so a ring fused onto a bond shares that bond,
 * and one closing onto an existing atom joins it), and adds the bonds that are not already there.
 * Benzene alternates double bonds where neither atom already has one.
 */
function placeRing(doc: CdxDoc, frag: XNode, verts: P2[], kind: RingKind, keep: string[] = []): string | null {
  const id = nextIdFrom(doc.root);
  const L = doc.style.bondLength;
  const atoms = frag.children.filter((c) => c.name === "n");
  // Existing atoms a new vertex lands on: they become ring atoms, and are checked below.
  const snapped: XNode[] = [];
  const ids = verts.map((v, i) => {
    if (keep[i]) return keep[i];
    const near = atoms.find((a) => {
      const p = posOf(a);
      return Math.hypot(p[0] - v[0], p[1] - v[1]) < L * 0.2;
    });
    if (near) {
      snapped.push(near);
      return near.attrs.id!;
    }
    const nid = id();
    const n: XNode = { name: "n", attrs: { id: nid, p: `${fmt(v[0])} ${fmt(v[1])}` }, children: [], text: "", line: 0 };
    frag.children.push(n);
    atoms.push(n);
    return nid;
  });
  const bondBetween = (a: string, b: string): XNode | undefined =>
    frag.children.find((c) => c.name === "b" && ((c.attrs.B === a && c.attrs.E === b) || (c.attrs.B === b && c.attrs.E === a)));
  const hasDouble = (a: string): boolean => frag.children.some((c) => c.name === "b" && (c.attrs.B === a || c.attrs.E === a) && c.attrs.Order === "2");
  const before = frag.children.length;
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    let bd = bondBetween(a, b);
    if (!bd) {
      bd = { name: "b", attrs: { id: id(), B: a, E: b }, children: [], text: "", line: 0 };
      frag.children.push(bd);
    }
  }
  if (frag.children.length === before) return "that ring is already there";
  // A ring may close onto a bare carbon where a vertex falls; never onto a labelled atom (a carbonyl O,
  // an OMe) — that would draw a ring through a substituent — nor onto a carbon with no bond to spare.
  for (const n of snapped) {
    if (n.children.some((c) => c.name === "t") || (n.attrs.Element && n.attrs.Element !== "6") || n.attrs.NodeType) {
      return "the ring would run into an atom already there (a labelled atom or a substituent) — fuse it onto another bond, or move that atom first";
    }
    if (bondOrderSum(frag, n.attrs.id ?? "") > 4) return "the ring would give a carbon already there more than four bonds — fuse it onto another bond";
  }
  /** Can this atom take one more bond order (a double instead of a single)? Generic labels cannot. */
  const canDouble = (a: string): boolean => {
    const n = atoms.find((x) => x.attrs.id === a);
    if (!n) return false;
    if (n.attrs.NodeType && n.attrs.NodeType !== "Element") return false;
    const sym = n.attrs.Element ? symbolFor(Number(n.attrs.Element)) : "C";
    const vals = sym ? VALENCE[sym] : undefined;
    if (!vals) return false;
    const q = Number(n.attrs.Charge ?? 0) || 0;
    const max = Math.max(...vals) + (sym === "C" ? -Math.abs(q) : sym === "B" ? -q : q);
    return bondOrderSum(frag, a) + 1 <= max;
  };
  let placed = false;
  // A cyclopentadienyl (Cp) ring, as ChemDraw draws one bound to a metal: five delocalised (1.5) bonds.
  if (kind === "cyclopentadienyl") {
    for (let i = 0; i < ids.length; i++) bondBetween(ids[i], ids[(i + 1) % ids.length])!.attrs.Order = "1.5";
    placed = true;
  }
  // Fused onto an aromatic (1.5) bond: the new ring is drawn aromatic too, as the structure it joins.
  const sharedBond = keep.length === 2 ? bondBetween(keep[0], keep[1]) : undefined;
  if (kind === "benzene" && sharedBond?.attrs.Order === "1.5") {
    for (let i = 0; i < ids.length; i++) {
      const bd = bondBetween(ids[i], ids[(i + 1) % ids.length])!;
      if (bd !== sharedBond) bd.attrs.Order = "1.5";
    }
    placed = true;
  } else if (kind === "benzene") {
    // Alternate double bonds round the ring. A bond of the plan may already be double, or have both
    // ends free of one; a bond the ring shares with a structure already there may also have both
    // ends already double-bonded (fusing onto a ring's single bond: naphthalene), and stays single.
    for (let start = 0; start < 2; start++) {
      const plan = [0, 2, 4].map((k) => [ids[(k + start) % 6], ids[(k + start + 1) % 6]]);
      const shared = (a: string, b: string): boolean => keep.includes(a) && keep.includes(b);
      const free = (a: string, b: string): boolean => !hasDouble(a) && !hasDouble(b) && canDouble(a) && canDouble(b);
      const ok = plan.every(([a, b]) => bondBetween(a, b)!.attrs.Order === "2" || free(a, b) || (shared(a, b) && hasDouble(a) && hasDouble(b)));
      if (ok) {
        for (const [a, b] of plan) if (free(a, b)) bondBetween(a, b)!.attrs.Order = "2";
        placed = true;
        break;
      }
    }
    // A "benzene" with no alternating double bonds would be a cyclohexane drawn under the wrong name.
    if (!placed) return "a benzene ring cannot go there: its double bonds cannot alternate with the bonds already there — choose Cyclohexane, or change the neighbouring bonds first";
  }
  for (const a of new Set(ids)) {
    const n = atoms.find((x) => x.attrs.id === a);
    if (n) relabel(doc, n);
  }
  return null;
}

/** The vertices of a regular ring with side A→B, on the side `sign` (+1 right of A→B, y down). */
function ringVerts(a: P2, b: P2, size: number, sign: number): P2[] {
  const out: P2[] = [a, b];
  const ang = (2 * Math.PI) / size;
  let p = b, dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 2; i < size; i++) {
    dir += sign * ang;
    p = [p[0] + L * Math.cos(dir), p[1] + L * Math.sin(dir)];
    out.push(p);
  }
  return out;
}

/** Fuses a ring onto a bond, on the side away from the bond's other neighbours. */
export function addRingOnBond(doc: CdxDoc, bondId: string, kind: RingKind): string | null {
  const hit = findById(doc.root, bondId);
  if (!hit || hit.el.name !== "b" || !hit.parent || hit.parent.name !== "fragment") return "that bond is no longer in the document";
  const frag = hit.parent;
  const na = frag.children.find((c) => c.name === "n" && c.attrs.id === hit.el.attrs.B);
  const nb = frag.children.find((c) => c.name === "n" && c.attrs.id === hit.el.attrs.E);
  if (!na || !nb) return "that bond's atoms are not in the document";
  // Never onto the η-bond line (its centre would become a ring atom — review), and a Cp ring is not fused: its five
  // delocalised bonds would overwrite the shared bond and overload its atoms (review). Fuse a benzene onto a Cp
  // ring for an indenyl; attach a Cp ring at an atom.
  if (haptoBond(frag, hit.el)) return "a ring cannot be fused onto an η-bond — click a ring bond or an atom";
  if (kind === "cyclopentadienyl") return "a Cp ring is placed on its own (click empty paper) or attached at an atom — for an indenyl, fuse a Benzene onto the Cp ring";
  const a = posOf(na), b = posOf(nb);
  if (!(Math.hypot(b[0] - a[0], b[1] - a[1]) > 0)) return "that bond has no length";
  // Which side has more of the structure: the ring goes on the other.
  const d: P2 = [b[0] - a[0], b[1] - a[1]];
  let s = 0;
  for (const c of frag.children) {
    if (c.name !== "n" || c === na || c === nb) continue;
    const p = posOf(c);
    s += Math.sign(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0]));
  }
  const sign = s > 0 ? -1 : 1;
  return placeRing(doc, frag, ringVerts(a, b, RING_SIZE[kind], sign), kind, [na.attrs.id!, nb.attrs.id!]);
}

/** Attaches a ring to an atom by a new single bond, pointing away from the atom's other bonds. */
export function addRingAtAtom(doc: CdxDoc, nodeId: string, kind: RingKind): string | null {
  const r = addBondFrom(doc, nodeId);
  if (!r.ok) return r.reason;
  const hit = fragmentOf(doc.root, r.nodeId);
  if (!hit) return "the new atom was not placed";
  const base = fragmentOf(doc.root, nodeId)!.node;
  const p0 = posOf(base), p1 = posOf(hit.node);
  // The ring's first side runs from the new atom, turned half a ring angle off the new bond.
  const size = RING_SIZE[kind];
  const L = doc.style.bondLength;
  const dir = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) - (Math.PI / 2 - Math.PI / size);
  const second: P2 = [p1[0] + L * Math.cos(dir), p1[1] + L * Math.sin(dir)];
  return placeRing(doc, hit.frag, ringVerts(p1, second, size, 1), kind, [r.nodeId]);
}

/** A new ring as a structure of its own, centred on a page point. */
export function addRingAt(doc: CdxDoc, at: P2, kind: RingKind): string | null {
  const page = doc.root.children.find((c) => c.name === "page");
  if (!page) return "the document has no page";
  if (!at.every(Number.isFinite)) return "that is not a place on the page";
  const size = RING_SIZE[kind];
  const L = doc.style.bondLength;
  const R = L / (2 * Math.sin(Math.PI / size));
  const id = nextIdFrom(doc.root);
  const frag: XNode = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
  page.children.push(frag);
  const verts: P2[] = [];
  for (let i = 0; i < size; i++) {
    const a = -Math.PI / 2 + Math.PI / size + (2 * Math.PI * i) / size;
    verts.push([at[0] + R * Math.cos(a), at[1] + R * Math.sin(a)]);
  }
  return placeRing(doc, frag, verts, kind);
}

// ---- chains, brackets, arrows ----------------------------------------------------------------

const MAX_CHAIN = 50;
const CONTROL = /[\x00-\x1f\x7f]/;
const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
/** An atom as a reader writes it: N⁺, O⁻, C²⁺. */
const atomName = (sym: string, q: number): string => sym + (q ? (Math.abs(q) === 1 ? "" : [...String(Math.abs(q))].map((d) => SUPER[d]).join("")) + (q > 0 ? "⁺" : "⁻") : "");

/**
 * Why a new single bond cannot start at this atom, or null. Only what is certain is refused: a
 * carbon with no valence to spare (four bonds; three when charged), and an abbreviation (Ph,
 * OMe) that already has its bond. Other elements are left to the chemist — hypervalent iodine,
 * perchlorate chlorine, a nitro N drawn neutral, a dative bond to a metal are all drawn in
 * ChemDraw files.
 */
function bondRoomRefusal(frag: XNode, node: XNode): string | null {
  if (isHaptoCentre(node)) return HAPTO_CENTRE;
  const id = node.attrs.id ?? "";
  const bonds = bondOrderSum(frag, id);
  const type = node.attrs.NodeType;
  if (type === "Nickname" || type === "Fragment") {
    if (!bonds) return null;
    const words = node.children.find((c) => c.name === "t")?.children.map((c) => c.text).join("").trim();
    return `${words || "that abbreviation"} is an abbreviation that already has its bond — a new bond starts from an atom`;
  }
  if (type && type !== "Element") return null;
  const z = Number(node.attrs.Element ?? 6);
  if (z !== 6) return null;
  const q = Number(node.attrs.Charge ?? 0) || 0;
  if (bonds + 1 > 4 - Math.abs(q) + 1e-9) return `that ${atomName("C", q)} has no bond to spare`;
  return null;
}

/** The atoms of every structure on the page (not those inside an abbreviation's own fragment). */
function pageFragments(root: XNode): XNode[] {
  const out: XNode[] = [];
  walk(root, (x, parent) => {
    if (x.name === "fragment" && (!parent || parent.name !== "n")) out.push(x);
  });
  return out;
}

/** How many chain bonds a drag of `dist` points asks for (each bond advances L · cos 30° along the drag). */
export function chainLength(doc: CdxDoc, dist: number): number {
  if (!Number.isFinite(dist)) return 1;
  return Math.max(1, Math.min(MAX_CHAIN, Math.round(dist / (doc.style.bondLength * Math.cos(Math.PI / 6)))));
}

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The new atoms of a chain from `from` toward `toward`: a zig-zag of `n` bonds, a bond length
 * each, 120° between bonds. From an atom that has bonds, the first bond also makes 120° with them
 * (one bond) or bisects the widest gap (more), and the chain runs as near the drag as that allows.
 * Null when `from` is not an atom or a page point.
 */
export function chainPath(doc: CdxDoc, from: { nodeId: string } | { at: P2 }, toward: P2, n: number): { start: P2; points: P2[] } | null {
  const L = doc.style.bondLength;
  let start: P2, nb: P2[] = [];
  if ("nodeId" in from) {
    const hit = fragmentOf(doc.root, from.nodeId);
    if (!hit) return null;
    start = posOf(hit.node);
    for (const b of hit.frag.children) {
      if (b.name !== "b") continue;
      const other = b.attrs.B === from.nodeId ? b.attrs.E : b.attrs.E === from.nodeId ? b.attrs.B : null;
      const on = other ? hit.frag.children.find((c) => c.name === "n" && c.attrs.id === other) : undefined;
      if (on) nb.push(posOf(on));
    }
  } else start = from.at;
  const mouse = Math.atan2(toward[1] - start[1], toward[0] - start[0]);
  // Candidate first bonds; the chain's heading is 30° off the first bond, to either side.
  let firsts: number[];
  const angles = nb.map((p) => Math.atan2(p[1] - start[1], p[0] - start[0])).sort((p, q) => p - q);
  if (!angles.length) firsts = [];
  else if (angles.length === 1) firsts = [angles[0] + (2 * Math.PI) / 3, angles[0] - (2 * Math.PI) / 3];
  else {
    let best = 0, gap = -1;
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i], c = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
      if (c - a > gap) (gap = c - a), (best = a + (c - a) / 2);
    }
    firsts = [best];
  }
  let head = mouse, side = -1;
  if (firsts.length) {
    let bestD = Infinity;
    for (const f of firsts)
      for (const s of [-1, 1]) {
        const h = f - s * (Math.PI / 6);
        const d = Math.abs(wrapAngle(h - mouse));
        if (d < bestD) (bestD = d), (head = h), (side = s);
      }
  }
  const points: P2[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const dir = head + (i % 2 === 0 ? side : -side) * (Math.PI / 6);
    p = [p[0] + L * Math.cos(dir), p[1] + L * Math.sin(dir)];
    points.push(p);
  }
  return { start, points };
}

/**
 * A zig-zag chain of `n` carbons from an atom, or (with `from` a page point) as a structure of its
 * own, heading toward `toward`. Refused by name: an atom with no valence to spare, a label that
 * has its bond, or a chain that would run onto atoms already drawn (they would stack, unjoined).
 */
export function addChain(doc: CdxDoc, from: { nodeId: string } | { at: P2 }, toward: P2, n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHAIN) return `a chain is 1 to ${MAX_CHAIN} bonds long`;
  if (!toward.every(Number.isFinite) || ("at" in from && !from.at.every(Number.isFinite))) return "that is not a place on the page";
  const page = pageOf(doc.root);
  if (!page) return "the document has no page";
  let hit: { frag: XNode; node: XNode } | null = null;
  if ("nodeId" in from) {
    hit = fragmentOf(doc.root, from.nodeId);
    if (!hit) return "that atom is no longer in the document";
    const why = bondRoomRefusal(hit.frag, hit.node);
    if (why) return why;
  }
  const path = chainPath(doc, from, toward, n);
  if (!path) return "that atom is no longer in the document";
  if (Math.hypot(toward[0] - path.start[0], toward[1] - path.start[1]) < 1e-6) return "drag away from the atom to show which way the chain goes";
  // Nothing new may land on an atom already drawn (or, from empty paper, start on one).
  const L = doc.style.bondLength;
  const taken: P2[] = [];
  for (const fr of pageFragments(doc.root)) for (const c of fr.children) if (c.name === "n" && c.attrs.id !== hit?.node.attrs.id) taken.push(posOf(c));
  const check = "nodeId" in from ? path.points : [path.start, ...path.points];
  if (check.some((p) => taken.some((t) => Math.hypot(p[0] - t[0], p[1] - t[1]) < L * 0.3)))
    return "the chain would run onto atoms already drawn — drag another way, or make it shorter";
  const id = nextIdFrom(doc.root);
  let frag: XNode, prev: XNode;
  if (hit) {
    frag = hit.frag;
    prev = hit.node;
  } else {
    frag = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
    prev = { name: "n", attrs: { id: id(), p: `${fmt(path.start[0])} ${fmt(path.start[1])}` }, children: [], text: "", line: 0 };
    frag.children.push(prev);
    page.children.push(frag);
  }
  const first = prev;
  for (const p of path.points) {
    const nn: XNode = { name: "n", attrs: { id: id(), p: `${fmt(p[0])} ${fmt(p[1])}` }, children: [], text: "", line: 0 };
    frag.children.push(nn, { name: "b", attrs: { id: id(), B: prev.attrs.id!, E: nn.attrs.id! }, children: [], text: "", line: 0 });
    prev = nn;
  }
  relabel(doc, first);
  return null;
}

/**
 * Polymer brackets round a repeat unit: the atoms of one structure inside a page box. Written as
 * ChemDraw writes them (checked against ChemDraw files in USPTO filings): a square bracket on the
 * box's left and right sides, the right one carrying the label ("n", italic) in an object tag;
 * a bracketed group of usage SRU naming the atoms, its label, and for each bracket the bonds it
 * crosses (an end group crosses one). Refused by name: no atom inside, atoms of two structures, no
 * bond leaving the box, or a bond leaving through its top or bottom (a bracket would not cross it).
 */
export function addBrackets(doc: CdxDoc, box: [number, number, number, number], label = "n"): string | null {
  if (!box.every(Number.isFinite)) return "that is not a place on the page";
  const x0 = Math.min(box[0], box[2]), y0 = Math.min(box[1], box[3]), x1 = Math.max(box[0], box[2]), y1 = Math.max(box[1], box[3]);
  if (!(x1 - x0 > 2 && y1 - y0 > 2)) return "drag a box round the repeat unit";
  const text = label.trim();
  if (!text || text.length > 20 || CONTROL.test(text)) return "the bracket's label must be 1 to 20 characters";
  const page = pageOf(doc.root);
  if (!page) return "the document has no page";
  const inside = (p: P2): boolean => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const frags = pageFragments(doc.root).filter((f) => f.children.some((c) => c.name === "n" && inside(posOf(c))));
  if (!frags.length) return "no atom is inside the box — drag it round the repeat unit";
  if (frags.length > 1) return "the box takes in atoms of more than one structure — drag it round one repeat unit";
  const f = frags[0];
  const atoms = new Map<string, P2>();
  for (const c of f.children) if (c.name === "n" && c.attrs.id) atoms.set(c.attrs.id, posOf(c));
  const L = doc.style.bondLength;
  if ([...atoms.values()].some((p) => p[1] >= y0 && p[1] <= y1 && (Math.abs(p[0] - x0) < L * 0.1 || Math.abs(p[0] - x1) < L * 0.1)))
    return "a side of the box runs through an atom — a bracket crosses bonds, so put each side between two atoms";
  const insideIds = [...atoms].filter(([, p]) => inside(p)).map(([aid]) => aid);
  const crossings: Array<{ bond: string; inner: string; left: boolean }> = [];
  let throughEnds = false;
  for (const b of f.children) {
    if (b.name !== "b" || !b.attrs.id) continue;
    const pa = atoms.get(b.attrs.B), pb = atoms.get(b.attrs.E);
    if (!pa || !pb || inside(pa) === inside(pb)) continue;
    const [pin, pout] = inside(pa) ? [pa, pb] : [pb, pa];
    // Which side of the box the bond leaves through: the first edge its segment meets.
    const dx = pout[0] - pin[0], dy = pout[1] - pin[1];
    const tx = dx > 0 ? (x1 - pin[0]) / dx : dx < 0 ? (x0 - pin[0]) / dx : Infinity;
    const ty = dy > 0 ? (y1 - pin[1]) / dy : dy < 0 ? (y0 - pin[1]) / dy : Infinity;
    if (ty < tx) throughEnds = true;
    else crossings.push({ bond: b.attrs.id, inner: inside(pa) ? b.attrs.B : b.attrs.E, left: dx < 0 });
  }
  if (throughEnds) return "a bond leaves the box through its top or bottom, where no bracket crosses it — make the box taller, so only its sides cut the bonds that leave the repeat unit";
  if (!crossings.length) return "no bond leaves the box — a repeat unit is bonded on, through the brackets";
  // A repeat unit (–[A]ₙ–) is joined to its neighbours by exactly two bonds, one through each bracket: a box crossing
  // bonds on one side only, or more than one on a side, or cutting a ring, is not a repeat unit's.
  const nl = crossings.filter((c) => c.left).length, nr = crossings.length - nl;
  if (nl !== 1 || nr !== 1)
    return `the box's sides cross ${nl} bond${nl === 1 ? "" : "s"} on the left and ${nr} on the right — a repeat unit is joined by exactly one bond through each bracket; put each side across the one bond to the next unit`;
  for (const c of crossings) {
    const b = f.children.find((q) => q.name === "b" && q.attrs.id === c.bond)!;
    if (inCycle(f, b.attrs.B, b.attrs.E, c.bond)) return "a side of the box cuts a ring — a bracket crosses only the chain bond to the next repeat unit";
  }
  writeBrackets(doc, page, [x0, y0, x1, y1], insideIds, crossings, text);
  return null;
}

/** Is the bond a–b (id `skip`) in a ring: are a and b still joined without it (bounded by the fragment's size)? */
function inCycle(f: XNode, a: string, b: string, skip: string): boolean {
  const adj = new Map<string, string[]>();
  for (const q of f.children) {
    if (q.name !== "b" || q.attrs.id === skip || !q.attrs.B || !q.attrs.E) continue;
    (adj.get(q.attrs.B) ?? adj.set(q.attrs.B, []).get(q.attrs.B)!).push(q.attrs.E);
    (adj.get(q.attrs.E) ?? adj.set(q.attrs.E, []).get(q.attrs.E)!).push(q.attrs.B);
  }
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length) {
    const v = stack.pop()!;
    if (v === b) return true;
    for (const w of adj.get(v) ?? []) if (!seen.has(w)) (seen.add(w), stack.push(w));
  }
  return false;
}

/**
 * Polymer brackets as ChemDraw writes them: a left and a right bracket at the box's sides, the label (n) at the
 * right one's foot, and the bracketed group — the repeat unit's atoms (which may reach beyond the brackets drawn: a
 * pendant group hangs inside the unit) and the bonds each bracket crosses with their inner atoms.
 */
export function writeBrackets(doc: CdxDoc, page: XNode, box: [number, number, number, number], insideIds: string[], crossings: Array<{ bond: string; inner: string; left: boolean }>, text: string): void {
  const [x0, y0, x1, y1] = box;
  const id = nextIdFrom(doc.root);
  const size = doc.style.captionSize * 0.75;
  const tx = x1 + size * 0.25, ty = y1 + size * 0.5;
  const tag: XNode = {
    name: "objecttag",
    attrs: { TagType: "Unknown", Name: "bracketusage" },
    children: [
      {
        name: "t",
        attrs: { p: `${fmt(tx)} ${fmt(ty)}`, BoundingBox: `${fmt(tx)} ${fmt(ty - size * 0.75)} ${fmt(tx + text.length * size * 0.6)} ${fmt(ty + size * 0.25)}` },
        children: [{ name: "s", attrs: { font: String(doc.style.captionFont), size: fmt(size), face: "2" }, children: [], text, line: 0 }],
        text: "",
        line: 0,
      },
    ],
    text: "",
    line: 0,
  };
  const left: XNode = { name: "graphic", attrs: { id: id(), BoundingBox: `${fmt(x0)} ${fmt(y1)} ${fmt(x0)} ${fmt(y0)}`, GraphicType: "Bracket", BracketType: "Square" }, children: [], text: "", line: 0 };
  const right: XNode = { name: "graphic", attrs: { id: id(), BoundingBox: `${fmt(x1)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)}`, GraphicType: "Bracket", BracketType: "Square", BracketUsage: "SRU" }, children: [tag], text: "", line: 0 };
  const group: XNode = { name: "bracketedgroup", attrs: { id: id(), BracketedObjectIDs: insideIds.join(" "), BracketUsage: "SRU", RepeatCount: "2", SRULabel: text }, children: [], text: "", line: 0 };
  for (const g of [right, left]) {
    const att: XNode = { name: "bracketattachment", attrs: { id: id(), GraphicID: g.attrs.id! }, children: [], text: "", line: 0 };
    for (const c of crossings) if (c.left === (g === left)) att.children.push({ name: "crossingbond", attrs: { id: id(), BondID: c.bond, InnerAtomID: c.inner }, children: [], text: "", line: 0 });
    group.children.push(att);
  }
  page.children.push(left, right, group);
}

export type ArrowKind = "reaction" | "equilibrium" | "retrosynthetic" | "resonance";

/**
 * The retrosynthetic arrow (⇒): an open ("Angle") head over two shafts, as ChemDraw keeps it (ArrowheadType Angle,
 * ArrowShaftSpacing; its superseded copy says ArrowType RetroSynthetic). The proportions are JurisLab's, drawn to a
 * journal's ⇒ at the ACS 1996 line width: shafts 2.4 pt apart, the head's arms reaching 1.8 pt past them at 45°.
 */
export const RETRO_HEAD = { HeadSize: "500", ArrowheadCenterSize: "500", ArrowheadWidth: "500", ArrowShaftSpacing: "200" } as const;

/**
 * A reaction arrow from tail to head (a full solid head), an equilibrium arrow (two half-headed shafts), a
 * retrosynthetic arrow (⇒) or a resonance arrow (↔, a full head at each end). The last two are written as ChemDraw 23
 * writes them: the `<arrow>`, and before it the older `<graphic>` form it supersedes (a line, BoundingBox head then
 * tail, with its ArrowType), for readers that know only that.
 */
export function addArrow(doc: CdxDoc, tail: P2, head: P2, kind: ArrowKind = "reaction"): string | null {
  if (![...tail, ...head].every(Number.isFinite)) return "that is not a place on the page";
  if (Math.hypot(head[0] - tail[0], head[1] - tail[1]) < doc.style.bondLength * 0.5) return "drag further: an arrow needs some length";
  const page = pageOf(doc.root);
  if (!page) return "the document has no page";
  if (kind === "retrosynthetic" || kind === "resonance") {
    const id = nextIdFrom(doc.root);
    const gid = id(), aid = id();
    const retro = kind === "retrosynthetic";
    const sizes = retro ? RETRO_HEAD : CURVED_HEAD;
    const a: Record<string, string> = { id: aid, FillType: "None", ArrowheadType: retro ? "Angle" : "Solid", ArrowheadHead: "Full" };
    if (!retro) a.ArrowheadTail = "Full";
    Object.assign(a, { HeadSize: sizes.HeadSize, ArrowheadCenterSize: sizes.ArrowheadCenterSize, ArrowheadWidth: sizes.ArrowheadWidth });
    if (retro) a.ArrowShaftSpacing = RETRO_HEAD.ArrowShaftSpacing;
    a.Head3D = `${fmt(head[0])} ${fmt(head[1])} 0`;
    a.Tail3D = `${fmt(tail[0])} ${fmt(tail[1])} 0`;
    const g: Record<string, string> = { id: gid, SupersededBy: aid, BoundingBox: `${fmt(head[0])} ${fmt(head[1])} ${fmt(tail[0])} ${fmt(tail[1])}`, GraphicType: "Line", ArrowType: retro ? "RetroSynthetic" : "Resonance", HeadSize: sizes.HeadSize };
    page.children.push({ name: "graphic", attrs: g, children: [], text: "", line: 0 }, { name: "arrow", attrs: a, children: [], text: "", line: 0 });
    return null;
  }
  const attrs: Record<string, string> = {
    id: nextIdFrom(doc.root)(),
    Head3D: `${fmt(head[0])} ${fmt(head[1])} 0`,
    Tail3D: `${fmt(tail[0])} ${fmt(tail[1])} 0`,
    ArrowheadType: "Solid",
    HeadSize: "1000",
    ArrowheadCenterSize: "875",
    ArrowheadWidth: "250",
  };
  if (kind === "equilibrium") Object.assign(attrs, { ArrowheadHead: "HalfLeft", ArrowheadTail: "HalfLeft", ArrowShaftSpacing: "300" });
  else attrs.ArrowheadHead = "Full";
  page.children.push({ name: "arrow", attrs, children: [], text: "", line: 0 });
  return null;
}

// ---- mechanism arrows (cdxArrows.ts holds the geometry and its sources) ----------------------------

/** A plan's attributes as ChemDraw writes a curved arrow: a circle with its axes along x and y (a short hop: its ellipse). */
function curvedAttrs(p: CurvedPlan): Record<string, string> {
  const a: Record<string, string> = {
    Head3D: `${fmt(p.head[0])} ${fmt(p.head[1])} 0`,
    Tail3D: `${fmt(p.tail[0])} ${fmt(p.tail[1])} 0`,
    Center3D: `${fmt(p.center[0])} ${fmt(p.center[1])} 0`,
    MajorAxisEnd3D: `${fmt(planAxes(p).major[0])} ${fmt(planAxes(p).major[1])} 0`,
    MinorAxisEnd3D: `${fmt(planAxes(p).minor[0])} ${fmt(planAxes(p).minor[1])} 0`,
    AngularSize: fmt(p.angularSize),
  };
  if (p.source) a.ArrowSource = p.source;
  if (p.target) a.ArrowTarget = p.target;
  return a;
}

/**
 * A curved electron-pushing arrow (an electron pair: a full head) or a fishhook (one electron: a half head, its barb
 * on the outside of the curve), from an atom (a lone pair), a bond or a page point to another. Bowed to the side that
 * passes fewest atoms, or to the other with `flip`. Tied to the atom or bond at each end (ArrowSource / ArrowTarget),
 * so it follows them when they move.
 */
export function addCurvedArrow(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, o: { electrons: 1 | 2; flip?: boolean }): { ok: true; arrowId: string } | { ok: false; reason: string } {
  const page = pageOf(doc.root);
  if (!page) return { ok: false, reason: "the document has no page" };
  const el = curvedArrowElement(doc, from, to, o);
  if (typeof el === "string") return { ok: false, reason: el };
  el.attrs.id = nextIdFrom(doc.root)();
  page.children.push(el);
  return { ok: true, arrowId: el.attrs.id };
}

/** The curved arrow addCurvedArrow would add, not yet on the page (the canvas previews it while it is dragged). */
export function curvedArrowElement(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, o: { electrons: 1 | 2; flip?: boolean; quick?: boolean }): XNode | string {
  // quick: a coarse plan, for the preview while it is dragged (the arrow added on release is planned in full).
  let chosen = bowAndPlans(doc, from, to, { quick: !!o.quick, electrons: o.electrons });
  let bow = (o.flip ? -chosen.bow : chosen.bow) as 1 | -1;
  // Where the coarse plan finds nothing, the full one may: the preview never shows less than the release will draw.
  if (o.quick && typeof chosen.plans.get(bow) === "string") {
    chosen = bowAndPlans(doc, from, to, { electrons: o.electrons });
    bow = (o.flip ? -chosen.bow : chosen.bow) as 1 | -1;
  }
  const plan = chosen.plans.get(bow)!;
  if (typeof plan === "string") return plan;
  const attrs: Record<string, string> = {
    id: "",
    FillType: "None",
    ArrowheadType: "Solid",
    ArrowheadHead: o.electrons === 1 ? fishhookSide(bow) : "Full",
    ...CURVED_HEAD,
    ...curvedAttrs(plan),
  };
  return { name: "arrow", attrs, children: [], text: "", line: 0 };
}

/** The end of an arrow element as an ArrowEnd: its atom or bond if it is tied to one still on the page, else its point. */
function endOf(doc: CdxDoc, el: XNode, which: "tail" | "head"): ArrowEnd {
  const ref = el.attrs[which === "tail" ? "ArrowSource" : "ArrowTarget"];
  const hit = ref ? findById(doc.root, ref) : null;
  if (hit?.el.name === "n") return { atom: ref! };
  if (hit?.el.name === "b") return { bond: ref! };
  const v = (el.attrs[which === "tail" ? "Tail3D" : "Head3D"] ?? "").split(/\s+/).map(Number);
  return { at: [v[0], v[1]] };
}

/**
 * Bows a curved arrow the other way. One tied to atoms or bonds is drawn again from them (its ends leave and reach
 * them on the new side); any other is mirrored in the line through its ends. A fishhook's barb goes to the outside.
 */
export function flipCurvedArrow(doc: CdxDoc, arrowId: string): string | null {
  const hit = findById(doc.root, arrowId);
  const el = hit?.el;
  if (!el || el.name !== "arrow") return "that arrow is no longer on the page";
  const ar = arrowFromElement(el);
  const g = ar ? arcOf(ar) : null;
  if (!ar || !g) return "only a curved arrow bows — this one is straight";
  const swap = (v: string | undefined): string | undefined => (v === "HalfLeft" ? "HalfRight" : v === "HalfRight" ? "HalfLeft" : v);
  if (el.attrs.ArrowSource || el.attrs.ArrowTarget) {
    const bow = (ar.angularSize > 0 ? -1 : 1) as 1 | -1; // the bow it has: negative AngularSize = bowed left
    const plan = planCurved(doc, endOf(doc, el, "tail"), endOf(doc, el, "head"), (-bow) as 1 | -1, { exclude: arrowId, electrons: /^Half/.test(el.attrs.ArrowheadHead ?? "") ? 1 : 2 });
    if (typeof plan === "string") return plan;
    for (const k of ["ArrowSource", "ArrowTarget"]) delete el.attrs[k];
    Object.assign(el.attrs, curvedAttrs(plan));
  } else {
    // Mirrored in the line tail–head: the centre reflected, the turn reversed.
    const t = ar.tail, d = [ar.head[0] - t[0], ar.head[1] - t[1]];
    const dl = Math.hypot(d[0], d[1]);
    if (!(dl > 0)) return "that arrow has no length";
    const ux = d[0] / dl, uy = d[1] / dl;
    const refl = (p: P2): P2 => {
      const vx = p[0] - t[0], vy = p[1] - t[1], k = vx * ux + vy * uy;
      return [t[0] + 2 * k * ux - vx, t[1] + 2 * k * uy - vy];
    };
    const c = refl(g.c), ra = Math.hypot(g.a[0], g.a[1]), rb = Math.hypot(g.b[0], g.b[1]);
    const circle = Math.abs(ra - rb) < 1e-6 * Math.max(ra, rb);
    const major = circle ? ([c[0] + ra, c[1]] as P2) : refl([g.c[0] + g.a[0], g.c[1] + g.a[1]]);
    const minor = circle ? ([c[0], c[1] + ra] as P2) : refl([g.c[0] + g.b[0], g.c[1] + g.b[1]]);
    el.attrs.Center3D = `${fmt(c[0])} ${fmt(c[1])} 0`;
    el.attrs.MajorAxisEnd3D = `${fmt(major[0])} ${fmt(major[1])} 0`;
    el.attrs.MinorAxisEnd3D = `${fmt(minor[0])} ${fmt(minor[1])} 0`;
    // A reflection reverses the turn; a skewed ellipse's reflected axes also reverse their orientation, and so its sign.
    el.attrs.AngularSize = fmt(circle ? -ar.angularSize : ar.angularSize);
  }
  for (const k of ["ArrowheadHead", "ArrowheadTail"]) {
    const v = swap(el.attrs[k]);
    if (v !== undefined) el.attrs[k] = v;
  }
  return null;
}

/** Where an arrow's tied end is: its atom, or its bond's middle. Null when it is tied to nothing on the page. */
function anchorPoint(root: XNode, ref: string | undefined): P2 | null {
  if (!ref) return null;
  const hit = findById(root, ref);
  if (!hit) return null;
  if (hit.el.name === "n") return posOf(hit.el);
  if (hit.el.name === "b" && hit.parent) {
    const a = hit.parent.children.find((c) => c.name === "n" && c.attrs.id === hit.el.attrs.B);
    const b = hit.parent.children.find((c) => c.name === "n" && c.attrs.id === hit.el.attrs.E);
    if (!a || !b) return null;
    const pa = posOf(a), pb = posOf(b);
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  }
  return null;
}

const ARROW_POINTS = ["Head3D", "Tail3D", "Center3D", "MajorAxisEnd3D", "MinorAxisEnd3D"];
const pointOf = (v: string | undefined): P2 | null => {
  const a = (v ?? "").trim().split(/\s+/).map(Number);
  return a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]) ? [a[0], a[1]] : null;
};

/** Every tied arrow and where its ends' atoms or bonds are (before an edit moves atoms). */
export function arrowAnchors(root: XNode): Map<XNode, { tail: P2 | null; head: P2 | null; own: string }> {
  const out = new Map<XNode, { tail: P2 | null; head: P2 | null; own: string }>();
  walk(root, (x) => {
    if (x.name !== "arrow" || (!x.attrs.ArrowSource && !x.attrs.ArrowTarget)) return;
    out.set(x, { tail: anchorPoint(root, x.attrs.ArrowSource), head: anchorPoint(root, x.attrs.ArrowTarget), own: `${x.attrs.Tail3D}|${x.attrs.Head3D}` });
  });
  return out;
}

/**
 * After atoms moved: each tied arrow follows its atoms or bonds, keeping its shape — carried by the turn, scale and
 * shift that take its ends' old places to their new ones (an untied end stays where it is). An arrow that was moved
 * itself while what it is tied to stayed is no longer tied to it (it was put somewhere else on purpose).
 */
export function followAnchors(root: XNode, before: Map<XNode, { tail: P2 | null; head: P2 | null; own: string }>): void {
  // The page as it now is (read once, when a curved arrow needs drawing again from its atoms' new places).
  let page: CdxDoc | null | undefined;
  const now = (): CdxDoc | null => {
    if (page === undefined) {
      const r = readCdxmlTree(root);
      page = r.ok ? r.doc : null;
    }
    return page;
  };
  for (const [el, was] of before) {
    const nowT = anchorPoint(root, el.attrs.ArrowSource), nowH = anchorPoint(root, el.attrs.ArrowTarget);
    const movedSelf = `${el.attrs.Tail3D}|${el.attrs.Head3D}` !== was.own;
    const same = (a: P2 | null, b: P2 | null): boolean => !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
    if (movedSelf) {
      // Each end on its own: one whose atom moved with the arrow (both selected) stays tied; one left behind is not.
      if (was.tail && nowT && same(was.tail, nowT)) delete el.attrs.ArrowSource;
      if (was.head && nowH && same(was.head, nowH)) delete el.attrs.ArrowTarget;
      continue;
    }
    if (same(was.tail, nowT) && same(was.head, nowH)) continue;
    // A curved arrow is drawn again from its atoms' new places, bowed the same way: its ends keep their clear gaps (a
    // shape merely carried along stretches them — walkthrough). Anything else is carried by the similarity below.
    const ang = Number(el.attrs.AngularSize ?? 0);
    const fresh = ang && Number.isFinite(ang) ? now() : null;
    if (fresh) {
      const plan = planCurved(fresh, endOf(fresh, el, "tail"), endOf(fresh, el, "head"), ang < 0 ? 1 : -1, { exclude: el.attrs.id, electrons: /^Half/.test(el.attrs.ArrowheadHead ?? "") ? 1 : 2 });
      if (typeof plan !== "string") {
        Object.assign(el.attrs, curvedAttrs(plan));
        continue;
      }
    }
    const tail = pointOf(el.attrs.Tail3D), head = pointOf(el.attrs.Head3D);
    if (!tail || !head) continue;
    const a0 = was.tail ?? tail, b0 = was.head ?? head;
    const a1 = nowT ?? (was.tail ? a0 : tail), b1 = nowH ?? (was.head ? b0 : head);
    // The similarity z ↦ s·R·(z − a0) + a1 with R, s from (b0 − a0) → (b1 − a1); a pure shift when the ends coincide.
    const ox = b0[0] - a0[0], oy = b0[1] - a0[1], nx = b1[0] - a1[0], ny = b1[1] - a1[1];
    const o2 = ox * ox + oy * oy;
    const [cr, ci] = o2 > 1e-12 ? [(nx * ox + ny * oy) / o2, (ny * ox - nx * oy) / o2] : [1, 0];
    const map = (p: P2): P2 => {
      const vx = p[0] - a0[0], vy = p[1] - a0[1];
      return [a1[0] + cr * vx - ci * vy, a1[1] + ci * vx + cr * vy];
    };
    for (const k of ARROW_POINTS) {
      const p = pointOf(el.attrs[k]);
      if (p) {
        const q = map(p);
        el.attrs[k] = `${fmt(q[0])} ${fmt(q[1])} 0`;
      }
    }
  }
}

// ---- drawing from a blank page (docs/SCOPE-CHEM-CANVAS.md, stage 2) ---------------------------

/**
 * A blank page in ChemDraw's "ACS Document 1996" style (the journals' and the USPTO filings' usual
 * style): bond length 14.4 pt, line 0.6 pt, bold 2 pt, hash spacing 2.5 pt, Arial 10 pt labels.
 */
export function blankPageCdxml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" ?>\n' +
    '<CDXML CreationProgram="JurisLab" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" BondSpacing="18" ' +
    'LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="10" ChainAngle="120">' +
    '<fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable>' +
    '<page id="1" BoundingBox="0 0 540 720" HeaderPosition="36" FooterPosition="36" PrintTrimMarks="yes" HeightPages="1" WidthPages="1"/>' +
    "</CDXML>"
  );
}

const newFragment = (doc: CdxDoc, id: () => string): XNode | null => {
  const page = pageOf(doc.root);
  if (!page) return null;
  const frag: XNode = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
  page.children.push(frag);
  return frag;
};

/**
 * A new atom on empty paper: a structure of its own. A carbon alone is shown as ChemDraw shows it
 * (CH₄, a label, since a bare vertex with no bonds would be invisible); any other label as setAtomLabel
 * sets it (N → NH₃, R1, X …).
 */
export function addAtomAt(doc: CdxDoc, at: P2, label: string): { ok: true; nodeId: string } | { ok: false; reason: string } {
  if (!at.every(Number.isFinite)) return { ok: false, reason: "that is not a place on the page" };
  const text = label.trim() || "C";
  const id = nextIdFrom(doc.root);
  const frag = newFragment(doc, id);
  if (!frag) return { ok: false, reason: "the document has no page" };
  const node: XNode = { name: "n", attrs: { id: id(), p: `${fmt(at[0])} ${fmt(at[1])}` }, children: [], text: "", line: 0 };
  frag.children.push(node);
  if (text === "C") {
    node.children.push(labelText(doc, node, "CH4"));
    node.attrs.NumHydrogens = "4";
    return { ok: true, nodeId: node.attrs.id! };
  }
  const r = setAtomLabel(doc, node.attrs.id!, text);
  if (!r.ok) {
    page0(doc).children.pop();
    return { ok: false, reason: r.reason };
  }
  return { ok: true, nodeId: node.attrs.id! };
}
const page0 = (doc: CdxDoc): XNode => pageOf(doc.root)!;

/** A new single bond on empty paper (two carbons), drawn up and to the right at 30°, as ChemDraw's bond tool draws it. */
export function addBondAt(doc: CdxDoc, at: P2): { ok: true; bondId: string } | { ok: false; reason: string } {
  if (!at.every(Number.isFinite)) return { ok: false, reason: "that is not a place on the page" };
  const L = doc.style.bondLength;
  const id = nextIdFrom(doc.root);
  const frag = newFragment(doc, id);
  if (!frag) return { ok: false, reason: "the document has no page" };
  const a: XNode = { name: "n", attrs: { id: id(), p: `${fmt(at[0])} ${fmt(at[1])}` }, children: [], text: "", line: 0 };
  const b: XNode = { name: "n", attrs: { id: id(), p: `${fmt(at[0] + L * Math.cos(Math.PI / 6))} ${fmt(at[1] - L * Math.sin(Math.PI / 6))}` }, children: [], text: "", line: 0 };
  const bond: XNode = { name: "b", attrs: { id: id(), B: a.attrs.id!, E: b.attrs.id! }, children: [], text: "", line: 0 };
  frag.children.push(a, b, bond);
  return { ok: true, bondId: bond.attrs.id! };
}

/** Is there a bond between these two atoms already? */
const bondBetween = (frag: XNode, a: string, b: string): boolean => frag.children.some((c) => c.name === "b" && ((c.attrs.B === a && c.attrs.E === b) || (c.attrs.B === b && c.attrs.E === a)));

/**
 * A bond between two atoms already drawn (closing a ring, or joining two structures into one). Refused
 * by name: the same atom, a bond already there, or an atom with no bond to spare.
 */
export function addBondBetween(doc: CdxDoc, a: string, b: string): { ok: true; bondId: string } | { ok: false; reason: string } {
  if (a === b) return { ok: false, reason: "a bond joins two different atoms" };
  const ha = fragmentOf(doc.root, a), hb = fragmentOf(doc.root, b);
  if (!ha || !hb) return { ok: false, reason: "that atom is no longer in the document" };
  if (ha.frag === hb.frag && bondBetween(ha.frag, a, b)) return { ok: false, reason: "those atoms are bonded already — click the bond to change its order" };
  for (const h of [ha, hb]) {
    const why = bondRoomRefusal(h.frag, h.node);
    if (why) return { ok: false, reason: why };
  }
  if (ha.frag !== hb.frag) {
    // Two structures become one: the second's atoms and bonds move into the first.
    for (const c of hb.frag.children) ha.frag.children.push(c);
    hb.frag.children = [];
    deleteObjects(doc, [hb.frag.attrs.id ?? ""]);
  }
  const id = nextIdFrom(doc.root)();
  ha.frag.children.push({ name: "b", attrs: { id, B: a, E: b }, children: [], text: "", line: 0 });
  relabel(doc, ha.node);
  relabel(doc, hb.node);
  return { ok: true, bondId: id };
}

/**
 * A bond from an atom toward a page point (the bond tool dragged from an atom): to an atom already
 * near the point, or to a new carbon one bond length away, its direction snapped to 30° as ChemDraw
 * snaps it.
 */
export function addBondToward(doc: CdxDoc, nodeId: string, to: P2, near: string | null): { ok: true; bondId: string; nodeId: string } | { ok: false; reason: string } {
  if (near && near !== nodeId) {
    const r = addBondBetween(doc, nodeId, near);
    return r.ok ? { ok: true, bondId: r.bondId, nodeId: near } : r;
  }
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return { ok: false, reason: "that atom is no longer in the document" };
  if (!to.every(Number.isFinite)) return { ok: false, reason: "that is not a place on the page" };
  const why = bondRoomRefusal(hit.frag, hit.node);
  if (why) return { ok: false, reason: why };
  const p0 = posOf(hit.node);
  const raw = Math.atan2(to[1] - p0[1], to[0] - p0[0]);
  if (!Number.isFinite(raw) || Math.hypot(to[0] - p0[0], to[1] - p0[1]) < 1e-6) return { ok: false, reason: "drag away from the atom to show which way the bond goes" };
  const step = Math.PI / 6;
  const dir = Math.round(raw / step) * step;
  const L = doc.style.bondLength;
  const p: P2 = [p0[0] + L * Math.cos(dir), p0[1] + L * Math.sin(dir)];
  const id = nextIdFrom(doc.root);
  const nn: XNode = { name: "n", attrs: { id: id(), p: `${fmt(p[0])} ${fmt(p[1])}` }, children: [], text: "", line: 0 };
  const bond: XNode = { name: "b", attrs: { id: id(), B: nodeId, E: nn.attrs.id! }, children: [], text: "", line: 0 };
  hit.frag.children.push(nn, bond);
  relabel(doc, hit.node);
  return { ok: true, bondId: bond.attrs.id!, nodeId: nn.attrs.id! };
}

/** A new caption on the page (the Text tool clicked on empty paper). */
export function addCaption(doc: CdxDoc, at: P2, text: string): { ok: true; textId: string } | { ok: false; reason: string } {
  if (!at.every(Number.isFinite)) return { ok: false, reason: "that is not a place on the page" };
  const words = text.replace(/\r/g, "");
  if (!words.trim()) return { ok: false, reason: "type the words first" };
  if (words.length > 2000 || CONTROL.test(words.replace(/\n/g, ""))) return { ok: false, reason: "a caption holds up to 2,000 characters of text" };
  const page = pageOf(doc.root);
  if (!page) return { ok: false, reason: "the document has no page" };
  const size = doc.style.captionSize;
  const lines = words.split("\n");
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.55;
  const id = nextIdFrom(doc.root)();
  page.children.push({
    name: "t",
    attrs: { id, p: `${fmt(at[0])} ${fmt(at[1])}`, BoundingBox: `${fmt(at[0])} ${fmt(at[1] - size * 0.8)} ${fmt(at[0] + w)} ${fmt(at[1] + size * (lines.length - 1) * 1.2 + size * 0.25)}`, CaptionJustification: "Left" },
    children: [{ name: "s", attrs: { font: String(doc.style.captionFont), size: fmt(size), face: "0" }, children: [], text: words, line: 0 }],
    text: "",
    line: 0,
  });
  return { ok: true, textId: id };
}
