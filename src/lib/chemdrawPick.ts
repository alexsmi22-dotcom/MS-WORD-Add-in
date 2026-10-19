/**
 * Picking one structure out of a ChemDraw file (user, live demo 2026-10-19: "the file opened … but it was very large
 * and i could not edit the structure"). A patent ChemDraw file is a document — the demo file was 93 structures, 229
 * arrows and lines and 149 captions on a page 29 × 290 cm — and putting all of it on the canvas shrank every atom to
 * a few pixels. Here the file's structures become a gallery: each one is drawn once, small, and the one picked opens
 * on its own at full size — in the structure editor when it is exactly a molecule, on the page canvas when it is
 * not (a generic atom, a nickname), and never as the whole document.
 */
import type { Molecule } from "openchemlib";
import { readCdxmlTree, type CdxDoc } from "./cdxml";
import { cloneTree, deleteObjects } from "./cdxmlEdit";
import { pageToMolecule } from "./cdxmlMol";
import { renderCdx } from "./cdxmlRender";
import { withCompanions } from "./cdxmlSelect";

/** One structure of a ChemDraw page, ready to show in the gallery. */
export interface PageStructure {
  /** The structure's top-level object id. */
  id: string;
  /** It and what belongs to it (its brackets, its attached labels). */
  ids: Set<string>;
  /** A small picture of it (the page's own renderer). */
  svg: string;
  /** Exactly a molecule: it opens in the structure editor. */
  mol: Molecule | null;
  /** Why it is not a molecule (it opens on the page canvas instead). */
  reason: string;
  /**
   * The structure itself as a molecule, its brackets and attached labels left out (null when even that is not one):
   * a polymer opens on the page canvas with its brackets, and this lets its repeat unit be edited in the editor.
   */
  bare: Molecule | null;
}

/** The gallery holds at most this many (a work bound: each is drawn once). */
export const MAX_PICK = 200;

/** The page's structures, in reading order (top to bottom, left to right), each drawn and converted once. */
export function pageStructures(doc: CdxDoc): { structures: PageStructure[]; more: number } {
  const boxes = new Map<string, [number, number, number, number]>();
  renderCdx(doc, { boxes });
  const ids = doc.objects.filter((o) => o.items.some((it) => it.kind === "fragment")).map((o) => o.id);
  // Reading order: rows by top edge (a band of half a line's height), then left to right.
  const band = Math.max(doc.style.bondLength, 1) * 2;
  ids.sort((a, b) => {
    const p = boxes.get(a), q = boxes.get(b);
    if (!p || !q) return 0;
    const row = Math.floor(p[1] / band) - Math.floor(q[1] / band);
    return row || p[0] - q[0];
  });
  const structures: PageStructure[] = [];
  for (const id of ids.slice(0, MAX_PICK)) {
    const own = withCompanions(doc, boxes, id);
    const pic = renderCdx(doc, { objects: own, pad: doc.style.lineWidth * 2 });
    if (!pic) continue;
    // One structure the chemistry library cannot read is that structure's refusal, never the whole gallery's.
    let m: ReturnType<typeof pageToMolecule>;
    try {
      m = pageToMolecule(doc, new Set([id]));
    } catch (error) {
      m = { ok: false, reason: `it could not be read (${(error as Error).message})` };
    }
    const bare = m.ok ? m.value.mol : null;
    // Something belongs to it (polymer brackets, an attached label or a counter-ion): the page canvas keeps it — the
    // structure editor would open the bare structure, a polymer's brackets silently gone (review). The bare structure
    // stays on offer, said as what it is.
    if (heldByPage(doc, own, id) || inBrackets(doc, id)) {
      structures.push({ id, ids: own, svg: pic.svg, mol: null, reason: "it has polymer brackets or a counter-ion with it, which the structure editor cannot hold", bare });
      continue;
    }
    structures.push({ id, ids: own, svg: pic.svg, mol: bare, reason: m.ok ? "" : m.reason, bare });
  }
  return { structures, more: Math.max(0, ids.length - MAX_PICK) };
}

/**
 * Whether what belongs to a structure is part of the chemistry the editor would lose: brackets (a polymer's), a second
 * structure (a counter-ion), a drawn charge symbol. A caption or label beside it is not — the structure opens in the
 * editor and the caption stays on the page (83 of the demo file's 93 went to the page canvas for a caption alone).
 */
function heldByPage(doc: CdxDoc, own: ReadonlySet<string>, id: string): boolean {
  for (const x of own) {
    if (x === id) continue;
    const o = doc.objects.find((q) => q.id === x);
    if (!o) return true; // a bracket group or anything that is not a plain object
    if (o.items.some((it) => it.kind !== "text")) return true;
  }
  return false;
}

/** Whether a bracket group (a polymer's) encloses this structure or any of its atoms. */
function inBrackets(doc: CdxDoc, id: string): boolean {
  if (!doc.brackets.length) return false;
  const obj = doc.objects.find((o) => o.id === id);
  const ids = new Set<string>([id]);
  for (const it of obj?.items ?? []) if (it.kind === "fragment") for (const n of it.v.nodes) ids.add(n.id);
  return doc.brackets.some((b) => b.objectIds.some((x) => ids.has(x)));
}

/** A page holding only these objects (the rest deleted from a copy): one structure on the page canvas, at its size. */
export function subsetPage(doc: CdxDoc, keep: ReadonlySet<string>): CdxDoc | null {
  const copy = readCdxmlTree(cloneTree(doc.root));
  if (!copy.ok) return null;
  deleteObjects(copy.doc, copy.doc.objects.filter((o) => !keep.has(o.id)).map((o) => o.id));
  const again = readCdxmlTree(copy.doc.root);
  return again.ok ? again.doc : null;
}
