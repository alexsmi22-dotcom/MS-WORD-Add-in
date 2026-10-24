/**
 * Organometallic drawing on a ChemDraw page: η-bonds (a metal bound to a whole ring — a cyclopentadienyl, an arene),
 * rings drawn in perspective, and metallocene templates (docs/SCOPE-ORGANOMETALLIC.md).
 *
 * Written exactly as ChemDraw writes it: the η-bond is a node with
 * NodeType="MultiAttachment" at the centroid of the ring atoms it lists in Attachments, joined to the metal by a
 * plain bond; a Cp ring is five 1.5 bonds; a ring in perspective has its front edge Bold and the two edges beside it
 * wedged, narrow at the back. The edits in cdxmlEdit keep these valid (a deleted ring atom takes its η-bond with it,
 * moving the ring moves the centre).
 */
import type { XNode } from "./xmlLite";
import type { CdxDoc } from "./cdxml";
import { deleteObjects, fragmentOf, isHaptoCentre, nextIdFrom, setAtomLabel, syncHaptoCentres, writeBrackets } from "./cdxmlEdit";
import { symbolFor } from "./periodic";

type P2 = [number, number];
const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const posOf = (n: XNode): P2 => (n.attrs.p ?? "0 0").split(/\s+/).map(Number) as P2;
const node = (id: string, p: P2, attrs: Record<string, string> = {}): XNode => ({ name: "n", attrs: { id, p: `${fmt(p[0])} ${fmt(p[1])}`, ...attrs }, children: [], text: "", line: 0 });
const bond = (id: string, b: string, e: string, attrs: Record<string, string> = {}): XNode => ({ name: "b", attrs: { id, B: b, E: e, ...attrs }, children: [], text: "", line: 0 });
const bondsOf = (frag: XNode): XNode[] => frag.children.filter((c) => c.name === "b");

/** η² to η⁸: ChemDraw draws η-bonds to 2 – 8 atoms (an alkene to a cyclooctatetraene). */
const MAX_HAPTO = 8;

/**
 * A metal bound to several atoms at once (η-bond): a centre at their centroid, bonded to the metal. The atoms must be
 * 2 – 8 joined atoms of one structure (a ring, or an allyl chain), not already bound to that metal this way; the
 * metal must be a labelled atom. A ring in another structure joins the metal's structure.
 */
export function addHapto(doc: CdxDoc, atomIds: string[], metalId: string): { ok: true; centreId: string; bondId: string } | { ok: false; reason: string } {
  const ids = [...new Set(atomIds)];
  if (ids.length < 2 || ids.length > MAX_HAPTO) return { ok: false, reason: `an η-bond binds 2 to ${MAX_HAPTO} atoms (η⁵ for a cyclopentadienyl ring)` };
  const metal = fragmentOf(doc.root, metalId);
  if (!metal) return { ok: false, reason: "that metal atom is no longer in the document" };
  if (isHaptoCentre(metal.node)) return { ok: false, reason: "click the metal itself, not the centre of another η-bond" };
  if (!metal.node.children.some((c) => c.name === "t")) return { ok: false, reason: "label the metal first (Zr, Hf, Ti, Fe …) — an η-bond joins a ring to a metal atom" };
  if (ids.includes(metalId)) return { ok: false, reason: "the metal cannot be one of the ring atoms it binds" };
  const hits = ids.map((i) => fragmentOf(doc.root, i));
  if (hits.some((h) => !h)) return { ok: false, reason: "one of those ring atoms is no longer in the document" };
  const ring = hits[0]!.frag;
  if (hits.some((h) => h!.frag !== ring)) return { ok: false, reason: "the atoms of an η-bond belong to one ring or chain" };
  if (hits.some((h) => isHaptoCentre(h!.node))) return { ok: false, reason: "the centre of an η-bond cannot itself be bound" };
  // Joined: every atom reachable from the first through bonds among them.
  const inSet = new Set(ids);
  const seen = new Set([ids[0]]);
  const queue = [ids[0]];
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of bondsOf(ring)) {
      const o = b.attrs.B === a ? b.attrs.E : b.attrs.E === a ? b.attrs.B : null;
      if (o && inSet.has(o) && !seen.has(o)) {
        seen.add(o);
        queue.push(o);
      }
    }
  }
  if (seen.size !== ids.length) return { ok: false, reason: "the atoms of an η-bond must be joined to one another (a ring, or a chain such as allyl)" };
  // Already bound to this metal through the same atoms.
  const key = [...ids].sort().join(" ");
  const already = metal.frag.children.some(
    (c) => isHaptoCentre(c) && (c.attrs.Attachments ?? "").split(/\s+/).filter(Boolean).sort().join(" ") === key && bondsOf(metal.frag).some((b) => (b.attrs.B === c.attrs.id && b.attrs.E === metalId) || (b.attrs.E === c.attrs.id && b.attrs.B === metalId)),
  );
  if (already) return { ok: false, reason: "that ring is already bound to this metal" };
  if (ring !== metal.frag) {
    // Two structures become one: the ring's atoms and bonds move into the metal's structure.
    // Removed as any object is, so a reaction step or property that named it loses the reference (review).
    metal.frag.children.push(...ring.children);
    ring.children = [];
    if (ring.attrs.id) deleteObjects(doc, [ring.attrs.id]);
    else {
      // A structure without an id (an imported file may hold one): removed where it sits (review round 2).
      const page = doc.root.children.find((c) => c.name === "page");
      if (page) page.children = page.children.filter((c) => c !== ring);
    }
  }
  const id = nextIdFrom(doc.root);
  const centreId = id(), bondId = id();
  metal.frag.children.push(node(centreId, [0, 0], { NodeType: "MultiAttachment", Attachments: ids.join(" ") }), bond(bondId, centreId, metalId));
  // A main-group centre labelled with its own hydrogens (a Si placed alone reads "SiH4"): the ring takes one of its
  // bonds, so one H fewer — the label and the formula would otherwise keep a hydrogen that is not there (review).
  const z = Number(metal.node.attrs.Element ?? 0), h = Number(metal.node.attrs.NumHydrogens ?? 0);
  const dfBlock = (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || (z >= 89 && z <= 112);
  if (h > 0 && !dfBlock) {
    const sym = symbolFor(z);
    // Written on the node as the editor writes an element with its hydrogens (setAtomLabel would read "SiH3" as text).
    const t = metal.node.children.find((c) => c.name === "t");
    const runs = t?.children.filter((c) => c.name === "s") ?? [];
    if (sym && runs.length) {
      metal.node.attrs.NumHydrogens = String(h - 1);
      runs[0].text = `${sym}${h - 1 ? `H${h - 1 > 1 ? h - 1 : ""}` : ""}`;
      for (const r of runs.slice(1)) r.text = "";
    }
  }
  syncHaptoCentres(doc.root);
  return { ok: true, centreId, bondId };
}

/**
 * The smallest ring (3 – 8 atoms) through an atom or a bond, in ring order — what the η tool binds when a ring is
 * clicked. Null when the atom or bond is in no ring.
 */
export function ringThrough(doc: CdxDoc, id: string): string[] | null {
  let frag: XNode | null = null;
  let start: string[] = [];
  const asAtom = fragmentOf(doc.root, id);
  if (asAtom && !isHaptoCentre(asAtom.node)) {
    frag = asAtom.frag;
    start = [id];
  } else {
    for (const f of walkFragments(doc.root)) {
      const b = bondsOf(f).find((x) => x.attrs.id === id);
      if (b) {
        frag = f;
        start = [b.attrs.B, b.attrs.E];
      }
    }
  }
  if (!frag || !start.length) return null;
  const nb = new Map<string, string[]>();
  for (const b of bondsOf(frag)) {
    const ends = [b.attrs.B, b.attrs.E];
    if (ends.some((e) => isHaptoCentre(frag!.children.find((c) => c.attrs.id === e) ?? ({ name: "", attrs: {}, children: [], text: "", line: 0 } as XNode)))) continue;
    for (const [a, o] of [ends, [ends[1], ends[0]]]) nb.set(a, [...(nb.get(a) ?? []), o]);
  }
  // Shortest path a → b avoiding the edge a–b, for each edge at the start: the ring is that path.
  const edges = start.length === 2 ? [[start[0], start[1]]] : (nb.get(start[0]) ?? []).map((o) => [start[0], o]);
  let best: string[] | null = null;
  for (const [a, b] of edges) {
    const prev = new Map<string, string>([[a, ""]]);
    const queue = [a];
    while (queue.length && !prev.has(b)) {
      const x = queue.shift()!;
      for (const y of nb.get(x) ?? []) {
        if (prev.has(y) || (x === a && y === b)) continue;
        prev.set(y, x);
        queue.push(y);
      }
    }
    if (!prev.has(b)) continue;
    const path: string[] = [];
    for (let x: string = b; x; x = prev.get(x)!) path.push(x);
    if (path.length >= 3 && path.length <= MAX_HAPTO && (!best || path.length < best.length)) best = path.reverse();
  }
  return best;
}

/**
 * The smallest ring whose outline encloses a page point — the η tool's "click inside the ring" (aiming at a ring's
 * edge within a few points missed it in a walkthrough). Null when the point is inside no ring.
 */
export function ringContaining(doc: CdxDoc, p: P2): string[] | null {
  let best: string[] | null = null;
  const seen = new Set<string>();
  for (const f of walkFragments(doc.root)) {
    const at = new Map(f.children.filter((c) => c.name === "n" && !isHaptoCentre(c)).map((c) => [c.attrs.id!, posOf(c)] as const));
    for (const b of bondsOf(f)) {
      if (!at.has(b.attrs.B) || !at.has(b.attrs.E)) continue;
      const ring = ringThrough(doc, b.attrs.id!);
      if (!ring) continue;
      const key = [...ring].sort().join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      // Even–odd test against the ring's outline.
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = at.get(ring[i])!, [xj, yj] = at.get(ring[j])!;
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside && (!best || ring.length < best.length)) best = ring;
    }
  }
  return best;
}

function walkFragments(root: XNode): XNode[] {
  const out: XNode[] = [];
  const go = (n: XNode, parent: XNode | null): void => {
    if (n.name === "fragment" && (!parent || parent.name !== "n")) out.push(n);
    for (const c of n.children) go(c, n);
  };
  go(root, null);
  return out;
}

/**
 * Draws a ring as seen in perspective, as ChemDraw does for a ring bound edge-on to a metal: the front edge (the one
 * lowest on the page) Bold, the two edges beside it wedged with the narrow end at the back.
 */
export function setRingPerspective(doc: CdxDoc, ringIds: string[]): string | null {
  if (ringIds.length < 3) return "choose a ring";
  const hit = fragmentOf(doc.root, ringIds[0]);
  if (!hit) return "that ring is no longer in the document";
  const at = new Map(hit.frag.children.filter((c) => c.name === "n").map((c) => [c.attrs.id!, c] as const));
  const edge = (i: number): { b: XNode; a: string; c: string } | null => {
    const a = ringIds[i], c = ringIds[(i + 1) % ringIds.length];
    const b = bondsOf(hit.frag).find((x) => (x.attrs.B === a && x.attrs.E === c) || (x.attrs.B === c && x.attrs.E === a));
    return b ? { b, a, c } : null;
  };
  const edges = ringIds.map((_, i) => edge(i));
  if (edges.some((e) => !e)) return "those atoms do not form a closed ring";
  const y = (i: string): number => posOf(at.get(i)!)[1];
  let front = 0;
  edges.forEach((e, i) => {
    if (y(e!.a) + y(e!.c) > y(edges[front]!.a) + y(edges[front]!.c)) front = i;
  });
  for (const e of edges) delete e!.b.attrs.Display;
  edges[front]!.b.attrs.Display = "Bold";
  // The edge before the front one ends at the front edge's first atom; the one after starts at its second.
  const frontAtoms = new Set([edges[front]!.a, edges[front]!.c]);
  for (const k of [(front + edges.length - 1) % edges.length, (front + 1) % edges.length]) {
    const b = edges[k]!.b;
    // Narrow at the back atom (the one not on the front edge): WedgeBegin when that is the bond's B.
    b.attrs.Display = frontAtoms.has(b.attrs.B) ? "WedgeEnd" : "WedgeBegin";
  }
  return null;
}

// ---- templates -------------------------------------------------------------------------------------------------

export type MetalloceneTemplate = "metallocene-dichloride" | "ansa-metallocene" | "half-sandwich" | "metallocene-borohydride" | "polymer-metallocene";

export const METALLOCENE_TEMPLATES: Array<{ id: MetalloceneTemplate; label: string }> = [
  { id: "metallocene-dichloride", label: "Zirconocene dichloride (Cp₂ZrCl₂)" },
  { id: "ansa-metallocene", label: "ansa-Metallocene (Me₂Si-bridged)" },
  { id: "half-sandwich", label: "Half-sandwich (CpZrCl₃)" },
  { id: "metallocene-borohydride", label: "Metallocene bis(borohydride) (Cp₂Zr(BH₄)₂)" },
  { id: "polymer-metallocene", label: "Polymer-bound metallocene (–[CH₂CH]ₙ–)" },
];

/** A Cp ring in perspective around a centre: five atoms (front edge at the bottom), five 1.5 bonds. */
function cpRing(frag: XNode, id: () => string, c: P2, L: number): string[] {
  // ChemDraw's size: a ring about 2.6 bond lengths across, seen at half height. At 1.7 across, the bold front edge
  // and the wedges swamped it (a black boat — walkthrough).
  const R = L * 1.35, flat = 0.5;
  const ids: string[] = [];
  for (let k = 0; k < 5; k++) {
    const a = ((126 + 72 * k) * Math.PI) / 180; // 126°, 198°, 270°, 342°, 54° — y down: the 54°–126° edge is the front
    const nid = id();
    frag.children.push(node(nid, [c[0] + R * Math.cos(a), c[1] + R * flat * Math.sin(a)]));
    ids.push(nid);
  }
  for (let k = 0; k < 5; k++) frag.children.push(bond(id(), ids[k], ids[(k + 1) % 5], { Order: "1.5" }));
  return ids;
}

/**
 * Places a metallocene template centred on a page point, as its own structure: Zr with its ligands, the Cp rings in
 * perspective bound η⁵. Relabel the metal (Hf, Ti), a ligand or the bridge (Si → C, or a generic Z) afterwards.
 */
export function addMetalloceneTemplate(doc: CdxDoc, at: P2, kind: MetalloceneTemplate): string | null {
  if (!at.every(Number.isFinite)) return "that is not a place on the page";
  if (!METALLOCENE_TEMPLATES.some((t) => t.id === kind)) return `${String(kind)} is not a template this knows`;
  const page = doc.root.children.find((c) => c.name === "page");
  if (!page) return "the document has no page";
  const L = doc.style.bondLength;
  const id = nextIdFrom(doc.root);
  const frag: XNode = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
  page.children.push(frag);
  const [x, y] = at;
  const add = (p: P2): string => {
    const nid = id();
    frag.children.push(node(nid, p));
    return nid;
  };
  const link = (a: string, b: string): void => void frag.children.push(bond(id(), a, b));
  const labels: Array<[string, string]> = [];
  const hapto: Array<[string[], string]> = [];
  const perspective: string[][] = [];
  const metal = add([x, y]);
  labels.push([metal, "Zr"]);
  const sandwich = (apart = 2): { top: string[]; bottom: string[] } => {
    const top = cpRing(frag, id, [x - 0.35 * L, y - apart * L], L);
    const bottom = cpRing(frag, id, [x - 0.35 * L, y + apart * L], L);
    hapto.push([top, metal], [bottom, metal]);
    perspective.push(top, bottom);
    return { top, bottom };
  };
  const ligands = (sym: string, n: number): void => {
    // Well out from the metal: its label and the ligand's each cover part of the bond, and a full-length bond between
    // two labels all but vanished (walkthrough). Two ligands fan out ±35° to the right at 1.7 bond lengths; three hang
    // below at 2, so their labels do not crowd the metal's.
    const r = (n === 2 ? 1.7 : 2) * L, c35 = Math.cos((35 * Math.PI) / 180), s35 = Math.sin((35 * Math.PI) / 180);
    const spots: P2[] = n === 2 ? [[x + r * c35, y - r * s35], [x + r * c35, y + r * s35]] : [[x - r * 0.87, y + r * 0.5], [x, y + r], [x + r * 0.87, y + r * 0.5]];
    for (const p of spots) {
      const l = add(p);
      link(metal, l);
      labels.push([l, sym]);
    }
  };
  if (kind === "metallocene-dichloride" || kind === "metallocene-borohydride") {
    sandwich();
    ligands(kind === "metallocene-dichloride" ? "Cl" : "BH4", 2);
  } else if (kind === "ansa-metallocene") {
    // The rings closer (1.6 bond lengths from the metal) and the bridge between the two ring atoms nearest each other —
    // the top ring's front-left (126°) and the bottom ring's back-left (198°): with the rings 2 apart and both left
    // atoms bridged, the Si bonds ran to twice a bond length (review). Me₂Si, the methyls drawn as lines.
    const { top, bottom } = sandwich(1.6);
    const si = add([x - 1.8 * L, y + 0.17 * L]);
    link(si, top[0]);
    link(si, bottom[1]);
    link(si, add([x - 2.65 * L, y - 0.33 * L]));
    link(si, add([x - 2.65 * L, y + 0.67 * L]));
    labels.push([si, "Si"]);
    ligands("Cl", 2);
  } else if (kind === "half-sandwich") {
    const top = cpRing(frag, id, [x, y - 2 * L], L);
    hapto.push([top, metal]);
    perspective.push(top);
    ligands("Cl", 3);
  } else {
    const { top } = sandwich();
    // –[CH₂–CH]ₙ– above the top ring, its CH carrying a CH₂ down to the ring's back (270°) atom.
    const ring = posOf(frag.children.find((c) => c.attrs.id === top[2])!);
    // The CH₂ linker set off to the right (150° at it): straight above the ring atom and below the CH, its vertex
    // lay on one line and the CH₂ was invisible. Everything above follows it.
    const back: P2 = [ring[0] + 0.5 * L, ring[1] + 0.13 * L];
    const linker = add([ring[0] + 0.5 * L, ring[1] - 0.87 * L]);
    link(linker, top[2]);
    const ch = add([back[0], back[1] - 2 * L]);
    link(ch, linker);
    const ch2 = add([back[0] - 0.87 * L, back[1] - 2.5 * L]);
    link(ch2, ch);
    const outL = add([back[0] - 1.73 * L, back[1] - 2 * L]);
    const outR = add([back[0] + 0.87 * L, back[1] - 2.5 * L]);
    const bl = id(), br = id();
    frag.children.push(bond(bl, outL, ch2), bond(br, ch, outR));
    ligands("Cl", 2);
    // Brackets across the two bonds to the outside atoms; the repeat unit is everything else, metallocene included.
    const midL: P2 = [back[0] - 1.3 * L, back[1] - 2.25 * L], midR: P2 = [back[0] + 0.43 * L, back[1] - 2.25 * L];
    const h = 0.55 * L;
    const inside = frag.children.filter((c) => c.name === "n" && c.attrs.id !== outL && c.attrs.id !== outR).map((c) => c.attrs.id!);
    // Labels first (they set the hydrogens), then the η-bonds and brackets, which list ids already final.
    for (const [nid, t] of labels) {
      const r = setAtomLabel(doc, nid, t);
      if (!r.ok) return r.reason;
    }
    for (const [ring, m] of hapto) {
      const r = addHapto(doc, ring, m);
      if (!r.ok) return r.reason;
      inside.push(r.centreId);
    }
    for (const ring of perspective) setRingPerspective(doc, ring);
    writeBrackets(doc, page, [midL[0], midL[1] - h, midR[0], midR[1] + h], inside, [{ bond: bl, inner: ch2, left: true }, { bond: br, inner: ch, left: false }], "n");
    return null;
  }
  for (const [nid, t] of labels) {
    const r = setAtomLabel(doc, nid, t);
    if (!r.ok) return r.reason;
  }
  for (const [ring, m] of hapto) {
    const r = addHapto(doc, ring, m);
    if (!r.ok) return r.reason;
  }
  for (const ring of perspective) setRingPerspective(doc, ring);
  return null;
}
