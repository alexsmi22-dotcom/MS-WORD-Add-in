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

// ---- the tree --------------------------------------------------------------------------------

const escAttr = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
const escText = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tree as a CDXML file. Text is written only where it carries content (in `s` elements). */
export function writeCdxml(root: XNode): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n'];
  const write = (n: XNode, depth: number): void => {
    const pad = depth < 12 ? "\n" + " ".repeat(depth) : "";
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
  return out.join("") + "\n";
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
  for (const id of new Set(ids)) {
    const top = findById(doc.root, id)?.el;
    if (!top) continue;
    walk(top, (x) => {
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

function fragmentOf(root: XNode, nodeId: string): { frag: XNode; node: XNode } | null {
  let out: { frag: XNode; node: XNode } | null = null;
  walk(root, (x, p) => {
    if (!out && x.name === "n" && x.attrs.id === nodeId && p && p.name === "fragment") out = { frag: p, node: x };
  });
  return out;
}

/** A label's text object, placed as ChemDraw places it: the first character centred on the atom. */
function labelText(doc: CdxDoc, node: XNode, text: string, rightAligned = false): XNode {
  const st = doc.style;
  const [x, y] = (node.attrs.p ?? "0 0").split(/\s+/).map(Number);
  const size = st.labelSize;
  const charW = (ch: string): number => (/[A-Z]/.test(ch) ? 0.72 : /\d/.test(ch) ? 0.42 : 0.56) * size;
  const width = [...text].reduce((w, ch) => w + charW(ch), 0);
  // Left-aligned: the first letter centred on the atom; right-aligned (written left of its bond): the last.
  const left = rightAligned ? x - (width - charW(text[text.length - 1] ?? "C") / 2) : x - charW(text[0] ?? "C") / 2;
  const s: XNode = { name: "s", attrs: { font: String(st.labelFont), size: fmt(size), face: String(st.labelFace) }, children: [], text, line: 0 };
  return {
    name: "t",
    attrs: { p: `${fmt(left)} ${fmt(y + 0.35 * size)}`, BoundingBox: `${fmt(left)} ${fmt(y - 0.5 * size)} ${fmt(left + width)} ${fmt(y + 0.5 * size)}`, LabelJustification: rightAligned ? "Right" : "Left" },
    children: [s],
    text: "",
    line: 0,
  };
}

/** ChemDraw's Radical values as OCL radical states. */
const RADICAL_STATE: Record<string, number> = { Singlet: Molecule.cAtomRadicalStateS, Doublet: Molecule.cAtomRadicalStateD, Triplet: Molecule.cAtomRadicalStateT };

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
    node.attrs.Element = String(z);
    node.attrs.Isotope = iso[1];
    const h = hydrogensFor(z, charge, frag, nodeId) ?? 0;
    node.attrs.NumHydrogens = String(h);
    const lt = labelText(doc, node, iso[2] + (h ? "H" + (h > 1 ? h : "") : ""));
    const s0 = lt.children[0];
    lt.children.unshift({ name: "s", attrs: { ...s0.attrs, face: String(0x20) }, children: [], text: iso[1], line: 0 });
    node.children.push(lt);
    return { ok: true, note: null };
  }
  // "[Ac]": the element itself, where its symbol is also a group's name.
  const forced = /^\[([A-Z][a-z]?)\]$/.exec(t);
  if (forced) t = forced[1];
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
    const left = !!hs && sideOf(frag, node) === "left";
    node.children.push(labelText(doc, node, left ? hs + sym : sym + hs, left));
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
  const t = node.children.find((c) => c.name === "t");
  if (!t) return;
  const sym = symbolFor(Number(node.attrs.Element ?? 6));
  if (!sym) return;
  const runs = t.children.filter((c) => c.name === "s");
  if (!runs.length) return;
  if (node.attrs.Isotope) {
    // "13CH3" as setAtomLabel writes it: the mass number, then the symbol and its hydrogens.
    if (runs.length !== 2 || runs[0].text !== node.attrs.Isotope || !new RegExp(`^${sym}(H\\d*)?$`).test(runs[1].text)) return;
    const f = fragmentOf(doc.root, node.attrs.id ?? "")?.frag;
    const hi = f ? hydrogensFor(Number(node.attrs.Element ?? 6), Number(node.attrs.Charge ?? 0) || 0, f, node.attrs.id ?? "") : null;
    if (hi === null) return;
    node.attrs.NumHydrogens = String(hi);
    runs[1].text = sym + (hi ? "H" + (hi > 1 ? hi : "") : "");
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
  const hFirst = !!m[1] || (!m[2] && t.attrs.LabelJustification === "Right");
  const sep = text.includes("\n") ? "\n" : "";
  const next = !hs ? sym : hFirst ? hs + sep + sym : sym + sep + hs;
  node.attrs.NumHydrogens = String(h);
  if (next === text) return;
  // The box grows or shrinks on the side away from the atom.
  const size = Number(runs[0].attrs.size) || doc.style.labelSize;
  const delta = (next.replace(/\n/g, "").length - flat.length) * size * 0.6;
  const box = (t.attrs.BoundingBox ?? "").split(/\s+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && !sep) {
    if (hFirst) box[0] -= delta;
    else box[2] += delta;
    t.attrs.BoundingBox = box.map(fmt).join(" ");
  }
  runs[0].text = next;
  t.children = t.children.filter((c) => c.name !== "s" || c === runs[0]);
}

/** Sets an atom's charge (−9…9); a labelled atom's hydrogens follow. */
export function setCharge(doc: CdxDoc, nodeId: string, charge: number): string | null {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return "that atom is no longer in the document";
  if (!Number.isInteger(charge) || Math.abs(charge) > 9) return "a charge is a whole number from −9 to 9";
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

export type RingKind = "benzene" | "cyclohexane" | "cyclopentane" | "cyclopropane" | "cyclobutane" | "cycloheptane";
const RING_SIZE: Record<RingKind, number> = { cyclopropane: 3, cyclobutane: 4, cyclopentane: 5, benzene: 6, cyclohexane: 6, cycloheptane: 7 };

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
  return null;
}

export type ArrowKind = "reaction" | "equilibrium";

/** A reaction arrow from tail to head (a full solid head), or an equilibrium arrow (two half-headed shafts). */
export function addArrow(doc: CdxDoc, tail: P2, head: P2, kind: ArrowKind = "reaction"): string | null {
  if (![...tail, ...head].every(Number.isFinite)) return "that is not a place on the page";
  if (Math.hypot(head[0] - tail[0], head[1] - tail[1]) < doc.style.bondLength * 0.5) return "drag further: an arrow needs some length";
  const page = pageOf(doc.root);
  if (!page) return "the document has no page";
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
