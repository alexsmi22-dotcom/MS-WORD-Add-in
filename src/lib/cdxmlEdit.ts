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

const escAttr = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escText = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tree as a CDXML file. Text is written only where it carries content (in `s` elements). */
export function writeCdxml(root: XNode): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n'];
  const write = (n: XNode, depth: number): void => {
    const pad = depth < 12 ? "\n" + " ".repeat(depth) : "";
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
    const text = n.text.trim() ? escText(n.text) : "";
    if (!n.children.length && !text) {
      out.push(`${pad}<${n.name}${attrs}/>`);
      return;
    }
    out.push(`${pad}<${n.name}${attrs}>`);
    if (text) out.push(n.name === "s" ? escText(n.text) : text);
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
  let max = 0;
  walk(root, (x) => {
    const v = Number(x.attrs.id);
    if (Number.isInteger(v) && v > max) max = v;
  });
  return () => String(++max);
}

const pageOf = (root: XNode): XNode | undefined => root.children.find((c) => c.name === "page");
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

// ---- moving and deleting ------------------------------------------------------------------

/** Attributes holding positions: points ("x y" / "x y z"), boxes and point lists, moved alike. */
const POSITIONAL = ["p", "BoundingBox", "Head3D", "Tail3D", "Center3D", "MajorAxisEnd3D", "MinorAxisEnd3D", "CurvePoints", "xyz"];

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
  // The old box no longer fits the words: the renderer places by p; a stale box would mislead.
  if (hit.el.attrs.p) delete hit.el.attrs.BoundingBox;
  return null;
}

// ---- atoms and bonds ----------------------------------------------------------------------

/** Generic labels ChemDraw treats as generic nicknames (R groups and the usual variables). */
const GENERIC = /^(R\d{0,2}|R'{1,3}|X|Y|Z|Q|A|G|Ar|M|E|L)$/;
/** Standard valences used to show implicit hydrogens on a labelled atom (as ChemDraw shows NH, OH). */
const VALENCE: Record<string, number> = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1, Si: 4, Se: 2 };

/** The sum of bond orders at an atom (aromatic 1.5; unknown orders count 1). */
function bondOrderSum(frag: XNode, nodeId: string): number {
  let s = 0;
  for (const b of frag.children)
    if (b.name === "b" && (b.attrs.B === nodeId || b.attrs.E === nodeId)) {
      const o = Number((b.attrs.Order ?? "1").split(/\s+/)[0]);
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
    const v = VALENCE[sym];
    const charge = Number(node.attrs.Charge ?? 0) || 0;
    // N⁺ takes one more bond (NH4⁺), O⁻ one fewer: valence + charge for N, P; valence − |charge| otherwise.
    const val = v === undefined ? 0 : sym === "N" || sym === "P" ? v + charge : v - Math.abs(charge);
    const h = Math.max(0, Math.round(val - bondOrderSum(frag, nodeId)));
    if (v !== undefined) node.attrs.NumHydrogens = String(h);
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
  const z = node.attrs.Element;
  if (!z || node.attrs.NodeType || !node.children.some((c) => c.name === "t")) return;
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
