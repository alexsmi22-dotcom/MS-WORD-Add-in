/**
 * Picking things on a CDXML page (docs/SCOPE-CHEMDRAW.md, C1). In a ChemDraw file a structure's
 * brackets, its "n" / "x" labels and its ⊕ / ⊖ symbols are separate objects on the page, tied to it
 * only by meaning (a bracketed group naming its bonds, a symbol representing an atom's charge) or by
 * place. A click on a structure therefore picks it WITH those: inserting the bare structure would
 * drop the very brackets and charges a patent figure is about.
 */
import type { Box, CdxDoc, Pt } from "./cdxml";
import { renderCdx } from "./cdxmlRender";

/** The drawn box of every top-level object (document points). */
export function objectBoxes(doc: CdxDoc): Map<string, Box> {
  const out = new Map<string, Box>();
  renderCdx(doc, { boxes: out, pad: 0 });
  return out;
}

const inside = (b: Box, p: Pt, m = 0): boolean => p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;
const distToBox = (b: Box, p: Pt): number => Math.hypot(Math.max(0, b[0] - p[0], p[0] - b[2]), Math.max(0, b[1] - p[1], p[1] - b[3]));

/** The object under a point: the smallest box that holds it, else the nearest within `slop`. */
export function objectAt(doc: CdxDoc, boxes: Map<string, Box>, p: Pt, slop: number): string | null {
  let best: string | null = null, bestArea = Infinity;
  for (const o of doc.objects) {
    const b = boxes.get(o.id);
    if (!b || !inside(b, p)) continue;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area < bestArea) {
      bestArea = area;
      best = o.id;
    }
  }
  if (best) return best;
  let bestD = slop;
  for (const o of doc.objects) {
    const b = boxes.get(o.id);
    if (!b) continue;
    const d = distToBox(b, p);
    if (d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/**
 * An object and what belongs with it: for a structure, the bracket graphics its bracketed groups
 * draw, symbols that represent its atoms, and captions and symbols that sit against it (within
 * one and a quarter bond lengths of its box: the "n" beside a bracket, an X⊖ counter-ion, which is
 * itself a one-atom structure).
 */
export function withCompanions(doc: CdxDoc, boxes: Map<string, Box>, id: string): Set<string> {
  const out = new Set<string>([id]);
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return out;
  const atoms = new Set<string>(), bonds = new Set<string>();
  for (const it of obj.items)
    if (it.kind === "fragment") {
      for (const n of it.v.nodes) atoms.add(n.id);
      for (const b of it.v.bonds) bonds.add(b.id);
    }
  if (!atoms.size) return out;
  // Graphics by meaning: brackets on its bonds, symbols that represent its atoms.
  const graphicIds = new Set<string>();
  for (const bg of doc.brackets) for (const a of bg.attachments) if (bonds.has(a.bondId) || atoms.has(a.innerAtomId)) graphicIds.add(a.graphicId);
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind !== "graphic") continue;
      if (graphicIds.has(it.v.id)) out.add(o.id);
      const rep = it.v.el.children.find((c) => c.name === "represent");
      if (rep && atoms.has(rep.attrs.object ?? "")) out.add(o.id);
    }
  // Captions and symbols by place: against the structure's box — except text a reaction step names
  // as the conditions on its arrow ("(1) CH3I" under the arrow belongs to the arrow, not the product).
  const onArrows = new Set<string>();
  const visit = (x: typeof doc.root): void => {
    if (x.name === "step") for (const k of ["ReactionStepObjectsAboveArrow", "ReactionStepObjectsBelowArrow"]) for (const i of (x.attrs[k] ?? "").split(/\s+/)) if (i) onArrows.add(i);
    x.children.forEach(visit);
  };
  visit(doc.root);
  const fb = boxes.get(id);
  if (fb) {
    const reach = doc.style.bondLength * 1.25;
    for (const o of doc.objects) {
      // Other structures stay out, except a counter-ion or lone label (a structure of one or two atoms, such as X⊖).
      const big = o.items.some((it) => it.kind === "arrow" || (it.kind === "fragment" && it.v.nodes.length > 2));
      if (out.has(o.id) || big || onArrows.has(o.id)) continue;
      const b = boxes.get(o.id);
      if (!b) continue;
      const centre: Pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      if (inside(fb, centre, reach)) out.add(o.id);
    }
  }
  return out;
}

/** The union box of a set of objects. */
export function unionBox(boxes: Map<string, Box>, ids: Iterable<string>): Box | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const id of ids) {
    const q = boxes.get(id);
    if (!q) continue;
    l = Math.min(l, q[0]);
    t = Math.min(t, q[1]);
    r = Math.max(r, q[2]);
    b = Math.max(b, q[3]);
  }
  return l <= r ? [l, t, r, b] : null;
}

/** The atom nearest a point, within `r` points (in any structure). */
export function atomAt(doc: CdxDoc, p: Pt, r: number): string | null {
  let best: string | null = null, bestD = r;
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind !== "fragment") continue;
      for (const n of it.v.nodes) {
        const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
    }
  return best;
}

/** The bond nearest a point, within `r` points of its line. */
export function bondAt(doc: CdxDoc, p: Pt, r: number): string | null {
  let best: string | null = null, bestD = r;
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind !== "fragment") continue;
      const pos = new Map(it.v.nodes.map((n) => [n.id, n.p]));
      for (const b of it.v.bonds) {
        const a = pos.get(b.b), c = pos.get(b.e);
        if (!a || !c) continue;
        const dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
        const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d < bestD) {
          bestD = d;
          best = b.id;
        }
      }
    }
  return best;
}

/** A caption (a text object on the page) whose box holds the point. */
export function captionAt(doc: CdxDoc, p: Pt, slop: number): string | null {
  for (const o of doc.objects)
    for (const it of o.items)
      if (it.kind === "text" && it.v.box && inside(it.v.box, p, slop) && it.v.id) return it.v.id;
  return null;
}
