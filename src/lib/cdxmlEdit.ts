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
  const base = VALENCE[sym];
  if (!base) return null;
  const shift = sym === "C" || sym === "Si" ? -Math.abs(charge) : sym === "B" ? -charge : ["F", "Cl", "Br", "I"].includes(sym) ? -Math.abs(charge) : charge;
  const vals = base.map((v) => v + shift).filter((v) => v >= 0);
  const v = vals.find((x) => x >= bonds - 1e-9) ?? vals[vals.length - 1] ?? 0;
  return Math.max(0, Math.round(v - bonds));
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
function labelText(doc: CdxDoc, node: XNode, text: string): XNode {
  const st = doc.style;
  const [x, y] = (node.attrs.p ?? "0 0").split(/\s+/).map(Number);
  const size = st.labelSize;
  const firstW = /^[A-Z]/.test(text) ? 0.72 * size : 0.56 * size;
  const width = [...text].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 0.72 : /\d/.test(ch) ? 0.42 : 0.56) * size, 0);
  const left = x - firstW / 2;
  const s: XNode = { name: "s", attrs: { font: String(st.labelFont), size: fmt(size), face: String(st.labelFace) }, children: [], text, line: 0 };
  return {
    name: "t",
    attrs: { p: `${fmt(left)} ${fmt(y + 0.35 * size)}`, BoundingBox: `${fmt(left)} ${fmt(y - 0.5 * size)} ${fmt(left + width)} ${fmt(y + 0.5 * size)}`, LabelJustification: "Left" },
    children: [s],
    text: "",
    line: 0,
  };
}

/**
 * Sets what an atom is: an element symbol ("N", "Cl"; "C" makes it a bare vertex again), a generic
 * label (R1, X, Ar …) or other text (OMe), which is kept as a label ChemDraw treats as text — said
 * in the returned note, never passed off as the group it names.
 */
export function setAtomLabel(doc: CdxDoc, nodeId: string, label: string): { ok: true; note: string | null } | { ok: false; reason: string } {
  const hit = fragmentOf(doc.root, nodeId);
  if (!hit) return { ok: false, reason: "that atom is no longer in the document" };
  const t = label.trim();
  if (!t) return { ok: false, reason: "type an element symbol or a label" };
  if (t.length > 40 || /[\u0000-\u001f]/.test(t)) return { ok: false, reason: "that label is too long or contains a control character" };
  const { frag, node } = hit;
  for (const k of ["Element", "NumHydrogens", "NodeType", "GenericNickname", "NeedsClean", "Warning"]) delete node.attrs[k];
  node.children = node.children.filter((c) => c.name !== "t" && c.name !== "fragment");
  // "Ar" and "Y" are argon and yttrium, but in a structure drawing they are aryl and a variable:
  // read as generic labels, and said so.
  const ambiguous = t === "Ar" || t === "Y";
  const z = ambiguous ? null : atomicNumber(t);
  if (z !== null) {
    if (z !== 6) node.attrs.Element = String(z);
    if (z === 6) return { ok: true, note: null }; // a carbon: a bare vertex
    const sym = symbolFor(z)!;
    const charge = Number(node.attrs.Charge ?? 0) || 0;
    const h = implicitH(sym, charge, bondOrderSum(frag, nodeId));
    if (h !== null) node.attrs.NumHydrogens = String(h);
    node.children.push(labelText(doc, node, sym + (h ? "H" + (h > 1 ? h : "") : "")));
    return { ok: true, note: null };
  }
  if (GENERIC.test(t)) {
    node.attrs.NodeType = "GenericNickname";
    node.attrs.GenericNickname = t;
    node.children.push(labelText(doc, node, t));
    return { ok: true, note: ambiguous ? `${t} is read as a generic label (${t === "Ar" ? "aryl" : "a variable"}), not ${t === "Ar" ? "argon" : "yttrium"}.` : null };
  }
  node.attrs.NodeType = "Unspecified";
  node.children.push(labelText(doc, node, t));
  return { ok: true, note: `${t} is drawn as a label; ChemDraw will read it as text, not as the group it names.` };
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
    if (n) relabel(doc, n);
  }
  return null;
}

/** Re-sets a labelled element atom's hydrogens after its bonds changed (generic and text labels stay). */
function relabel(doc: CdxDoc, node: XNode): void {
  // A labelled carbon (CH3, no Element attribute) re-counts too.
  const z = node.attrs.Element ?? "6";
  if (node.attrs.NodeType || !node.children.some((c) => c.name === "t")) return;
  if (z === "6") {
    // A labelled carbon keeps its label, with its hydrogens re-counted (CH3 → CH2).
    const frag = fragmentOf(doc.root, node.attrs.id ?? "")?.frag;
    if (!frag) return;
    const h = implicitH("C", Number(node.attrs.Charge ?? 0) || 0, bondOrderSum(frag, node.attrs.id ?? "")) ?? 0;
    node.attrs.NumHydrogens = String(h);
    node.children = node.children.filter((c) => c.name !== "t");
    node.children.push(labelText(doc, node, "C" + (h ? "H" + (h > 1 ? h : "") : "")));
    return;
  }
  const sym = symbolFor(Number(z));
  if (sym && VALENCE[sym] !== undefined) setAtomLabel(doc, node.attrs.id ?? "", sym);
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
  const ids = verts.map((v, i) => {
    if (keep[i]) return keep[i];
    const near = atoms.find((a) => {
      const p = posOf(a);
      return Math.hypot(p[0] - v[0], p[1] - v[1]) < L * 0.2;
    });
    if (near) return near.attrs.id!;
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
  if (kind === "benzene") {
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
