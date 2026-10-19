/**
 * The chemistry canvas (docs/SCOPE-CHEM-CANVAS.md, stage 2): JurisLab's own drawing surface for the
 * Structure ▸ Draw tab, replacing OpenChemLib's editor. A page holds structures, brackets, arrows and
 * text exactly as ChemDraw keeps them (a CDXML tree, cdxml / cdxmlEdit / cdxmlRender); everything chemical
 * the pane reports comes from the page's structures through the exact converter (cdxmlMol).
 *
 * DOM-only: it builds its own toolbar and drawing surface inside the element it is mounted in, so the
 * pane and the large window run the same code. It offers the five calls the pane made on the OCL editor
 * (getMolecule, setMolecule, clearAll, moleculeChanged, setOnChangeListener), plus the page itself.
 */
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc, Box, Pt } from "../lib/cdxml";
import { renderCdx } from "../lib/cdxmlRender";
import { atomAt, bondAt, captionAt, objectAt, objectBoxes, withCompanions } from "../lib/cdxmlSelect";
import {
  addArrow, addAtomAt, addBondAt, addBondBetween, addBondFrom, addBondToward, addBrackets, addCaption, addChain, addRingAt, addRingAtAtom, addRingOnBond,
  ArrowKind, blankPageCdxml, chainLength, chainPath, cloneTree, deleteInStructure, deleteObjects, findById, moveObjects, RingKind,
  namesTiedTo, setAtomLabel, setBond, setCharge, setText, writeCdxml,
} from "../lib/cdxmlEdit";
import { moleculeToPage, pageToMolecule } from "../lib/cdxmlMol";
import type { XNode } from "../lib/xmlLite";

export type CanvasTool = "select" | "atom" | "bond" | "chain" | "ring" | "charge+" | "charge-" | "bracket" | "arrow" | "text" | "erase";

export interface ChemCanvasHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** Saves a file for the user (Save as .cdxml); without it the button is not shown. */
  downloadFile?(blob: Blob, name: string): void;
}

/** Why the canvas changed: a user edit, or a programmatic load (the pane keeps its status for the latter). */
export interface CanvasChange {
  isUserEvent: boolean;
}

export interface ChemCanvas {
  /** The page's structures as one OCL Molecule (empty when there are none, or when they cannot be one — see chemistry()). */
  getMolecule(): Molecule;
  /** The page's structures (or the selection's) as a Molecule (with what was read as drawn but unusual), or why they have no single formula. */
  chemistry(selectionOnly?: boolean): { ok: true; mol: Molecule; notes: string[] } | { ok: false; reason: string };
  /** Replaces the page with this structure. */
  setMolecule(mol: Molecule): void;
  /** Empties the page (one undo step). */
  clearAll(): void;
  /** Redraws after the Markush flag changed. */
  moleculeChanged(): void;
  setOnChangeListener(cb: (e: CanvasChange) => void): void;
  /** The Markush (query structure) flag carried on the Molecule. */
  setFragment(on: boolean): void;
  isFragment(): boolean;
  /** The page, and loading one (a ChemDraw file or picture). */
  page(): CdxDoc;
  loadPage(doc: CdxDoc): void;
  /** Whether the page holds more than structures (brackets, arrows, text): it inserts as the drawing then. */
  hasDrawing(): boolean;
  /** The page (or the selection) drawn for insertion. */
  render(selectionOnly: boolean): { svg: string; widthPt: number; heightPt: number } | null;
  selection(): Set<string>;
  setTool(t: CanvasTool): void;
  /** Names ChemDraw computed for structures changed since (their words): to check before inserting. */
  staleNames(): string[];
  /** The name the page is saved under (a ChemDraw file's name). */
  setName(name: string): void;
  /** Saved as .cdxml since it was loaded and not changed since. */
  wasSaved(): boolean;
}

const UNDO_DEPTH = 100;
const ELEMENTS = ["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "I"];
const RINGS: Array<[RingKind, string]> = [["benzene", "Benzene"], ["cyclohexane", "Cyclohexane"], ["cyclopentane", "Cyclopentane"], ["cyclobutane", "Cyclobutane"], ["cyclopropane", "Cyclopropane"], ["cycloheptane", "Cycloheptane"]];
const STYLES: Array<[string, string]> = [["", "Single → double → triple"], ["WedgeBegin", "Wedge"], ["WedgedHashBegin", "Hashed wedge"], ["Wavy", "Wavy"], ["Bold", "Bold"], ["Dash", "Dashed"]];
const TOOL_HELP: Record<CanvasTool, string> = {
  select: "Select: click a structure; Shift+click adds; drag on empty paper to box-select; drag the selection to move it; Delete removes it.",
  atom: "Atom: pick an element (or type a label: N, Cl, R1, OMe …), then click an atom to change it, or empty paper to place one.",
  bond: "Bond: click empty paper for a bond; drag from an atom to draw one (to another atom to join them); click a bond to change it.",
  chain: "Chain: drag from an atom or empty paper — the chain follows the mouse, one bond per step.",
  ring: "Ring: click a bond to fuse a ring onto it, an atom to attach one, or empty paper to place one.",
  "charge+": "Charge +: click an atom to raise its charge by one.",
  "charge-": "Charge −: click an atom to lower its charge by one.",
  bracket: "Brackets: drag a box round a repeat unit (blank label = n).",
  arrow: "Arrow: drag from the tail to the head.",
  text: "Text: type the words in the box, then click empty paper for a new caption, or a caption to change it.",
  erase: "Erase: click an atom, a bond, or anything else on the page.",
};
const DRAG_TOOLS = new Set<CanvasTool>(["bond", "chain", "bracket", "arrow"]);
const SVGNS = "http://www.w3.org/2000/svg";

function blankDoc(): CdxDoc {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}

export function createChemCanvas(mount: HTMLElement, host: ChemCanvasHost): ChemCanvas {
  // ---- DOM ------------------------------------------------------------------------------------
  mount.replaceChildren();
  mount.classList.add("chem-canvas");
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    return e;
  };
  const bar = el("div", { class: "chem-canvas-tools", role: "toolbar", "aria-label": "Draw a structure" });
  const toolBtns = new Map<CanvasTool, HTMLButtonElement>();
  const toolNames: Array<[CanvasTool, string, string]> = [
    ["select", "Select", "Select and move"], ["atom", "Atom", "Place or change atoms"], ["bond", "Bond", "Draw bonds; change a bond"], ["chain", "Chain", "Drag a zig-zag chain"],
    ["ring", "Ring", "Rings"], ["charge+", "+", "Raise a charge"], ["charge-", "−", "Lower a charge"], ["bracket", "Brackets", "Polymer brackets"],
    ["arrow", "Arrow", "Reaction arrows"], ["text", "Text", "Captions"], ["erase", "Erase", "Remove"],
  ];
  for (const [t, label, title] of toolNames) {
    const b = el("button", { type: "button", class: "insert-btn secondary", "data-chem-tool": t, "aria-pressed": "false", title }, label);
    b.addEventListener("click", () => setTool(t));
    toolBtns.set(t, b);
    bar.appendChild(b);
  }
  const undoBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "undo", title: "Undo (Ctrl+Z)" }, "Undo");
  const redoBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "redo", title: "Redo (Ctrl+Y)" }, "Redo");
  const zoomInBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "zoom-in", title: "Zoom in (Ctrl+wheel)" }, "Zoom +");
  const zoomOutBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "zoom-out", title: "Zoom out (Ctrl+wheel)" }, "Zoom −");
  const fitBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "fit", title: "Fit the drawing in view" }, "Fit");
  bar.append(undoBtn, redoBtn, zoomInBtn, zoomOutBtn, fitBtn);
  const saveBtn = el("button", { type: "button", class: "insert-btn secondary", "data-chem-action": "save", title: "Download the page as a ChemDraw XML file (ChemDraw opens it)" }, "Save as .cdxml");
  if (host.downloadFile) bar.append(saveBtn);
  const opts = el("div", { class: "chem-canvas-options" });
  const palette = el("div", { class: "chem-canvas-palette", role: "group", "aria-label": "Element" });
  for (const sym of ELEMENTS) {
    const b = el("button", { type: "button", class: "insert-btn secondary", "data-chem-element": sym }, sym);
    b.addEventListener("click", () => {
      valueIn.value = sym;
      setTool("atom");
    });
    palette.appendChild(b);
  }
  const valueIn = el("input", { type: "text", class: "formula-input", maxlength: "200", "aria-label": "Atom label or text", "data-chem-value": "" }) as HTMLInputElement;
  const ringSel = el("select", { "aria-label": "Ring", "data-chem-ring": "" }) as HTMLSelectElement;
  for (const [v, t] of RINGS) ringSel.add(new Option(t, v));
  const styleSel = el("select", { "aria-label": "Bond style", "data-chem-bondstyle": "" }) as HTMLSelectElement;
  for (const [v, t] of STYLES) styleSel.add(new Option(t, v));
  const arrowSel = el("select", { "aria-label": "Arrow", "data-chem-arrow": "" }) as HTMLSelectElement;
  arrowSel.add(new Option("Reaction arrow", "reaction"));
  arrowSel.add(new Option("Equilibrium arrow", "equilibrium"));
  opts.append(palette, valueIn, ringSel, styleSel, arrowSel);
  const surface = el("div", { class: "chem-canvas-surface", tabindex: "0", "aria-label": "Drawing page" });
  mount.append(bar, opts, surface);

  // ---- state ----------------------------------------------------------------------------------
  let doc: CdxDoc = blankDoc();
  let boxes = new Map<string, Box>();
  let selected = new Set<string>();
  let tool: CanvasTool = "bond";
  type Step = { root: XNode; frag: boolean };
  let undo: Step[] = [];
  let redo: Step[] = [];
  const snapshot = (): Step => ({ root: cloneTree(doc.root), frag: fragmentFlag });
  let fragmentFlag = false;
  let onChange: ((e: CanvasChange) => void) | null = null;
  /** The page area in view (points). It only grows to take in what is drawn, so the page never jumps under the mouse. */
  const START_VIEW: Box = [0, 0, 180, 120];
  let view: Box = [...START_VIEW] as Box;
  let suppressClick = false;
  let pageName = "drawing";
  /** Changed by the user since it was loaded (Save names an edited file so). */
  let edited = false;
  let saved = false;
  /** Names ChemDraw computed (text object ids) whose structure changed since. */
  let stale = new Set<string>();
  /** Each structure as written, to see which ones an edit changed. */
  const signatures = (): Map<string, string> => {
    const m = new Map<string, string>();
    for (const o of doc.objects) for (const it of o.items) if (it.kind === "fragment") m.set(o.id, writeCdxml(it.v.el));
    return m;
  };

  const fire = (isUserEvent: boolean): void => onChange?.({ isUserEvent });
  const contentBox = (): Box | null => {
    let b: Box | null = null;
    for (const v of boxes.values()) b = b ? [Math.min(b[0], v[0]), Math.min(b[1], v[1]), Math.max(b[2], v[2]), Math.max(b[3], v[3])] : [...v] as Box;
    return b;
  };
  /** The view grown to hold what is drawn, with two bond lengths of paper round it. */
  const growView = (fit = false): void => {
    const c = contentBox();
    const pad = doc.style.bondLength * 2;
    if (!c) return;
    let want: Box = [c[0] - pad, c[1] - pad, c[2] + pad, c[3] + pad];
    // Never closer than 120 × 80 pt of paper (a lone bond must not fill the window).
    const minW = 120, minH = 80;
    if (want[2] - want[0] < minW) want = [(want[0] + want[2]) / 2 - minW / 2, want[1], (want[0] + want[2]) / 2 + minW / 2, want[3]];
    if (want[3] - want[1] < minH) want = [want[0], (want[1] + want[3]) / 2 - minH / 2, want[2], (want[1] + want[3]) / 2 + minH / 2];
    view = fit ? want : [Math.min(view[0], want[0]), Math.min(view[1], want[1]), Math.max(view[2], want[2]), Math.max(view[3], want[3])];
  };

  function draw(): void {
    const r = (() => {
      try {
        return renderCdx(doc, { pad: 0 });
      } catch (e) {
        host.setStatus(`The page could not be drawn (${(e as Error).message}).`, "error");
        return null;
      }
    })();
    const w = view[2] - view[0], h = view[3] - view[1];
    const inner = r ? r.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<rect[^>]*fill="#fff"\/>/, "") : "";
    surface.innerHTML = `<svg xmlns="${SVGNS}" viewBox="${view[0]} ${view[1]} ${w} ${h}" width="100%" preserveAspectRatio="xMinYMin meet"><rect x="${view[0]}" y="${view[1]}" width="${w}" height="${h}" fill="#fff"/>${inner}</svg>`;
    paintSelection();
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
  }
  function paintSelection(): void {
    const svg = surface.querySelector("svg");
    if (!svg) return;
    svg.querySelector("#chem-sel")?.remove();
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("id", "chem-sel");
    const pad = doc.style.bondLength * 0.15;
    for (const id of selected) {
      const b = boxes.get(id);
      if (!b) continue;
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", String(b[0] - pad));
      r.setAttribute("y", String(b[1] - pad));
      r.setAttribute("width", String(b[2] - b[0] + 2 * pad));
      r.setAttribute("height", String(b[3] - b[1] + 2 * pad));
      r.setAttribute("fill", "rgba(37,99,235,0.08)");
      r.setAttribute("stroke", "#2563eb");
      r.setAttribute("stroke-width", String(Math.max(0.4, pad * 0.25)));
      g.appendChild(r);
    }
    svg.appendChild(g);
  }
  /** After an edit: read the tree again, keep the selection that still exists, redraw. */
  function reread(): void {
    const r = readCdxmlTree(doc.root);
    if (!r.ok) {
      if (undo.length) doc.root = undo.pop()!.root;
      host.setStatus(`The edit left the page unreadable (${r.reason}) — it was undone.`, "error");
      const again = readCdxmlTree(doc.root);
      if (!again.ok) return;
      doc = again.doc;
    } else doc = r.doc;
    boxes = objectBoxes(doc);
    selected = new Set([...selected].filter((id) => boxes.has(id)));
    growView();
    draw();
  }
  /** Runs an edit with an undo step; a refusal (string) leaves the page as it was and says why. */
  function edit(f: () => string | null): boolean {
    const step = snapshot();
    const before = step.root;
    const sigBefore = signatures();
    const propsBefore = doc.properties;
    const why = f();
    if (why) {
      doc.root = before;
      host.setStatus(why.charAt(0).toUpperCase() + why.slice(1) + ".", "error");
      return false;
    }
    undo.push(step);
    if (undo.length > UNDO_DEPTH) undo.shift();
    redo = [];
    reread();
    edited = true;
    saved = false;
    // A name ChemDraw computed for a structure that changed (or went) no longer describes it.
    const sigAfter = signatures();
    const changed = [...sigBefore.keys()].filter((id) => sigAfter.get(id) !== sigBefore.get(id));
    for (const id of namesTiedTo({ ...doc, root: before, properties: propsBefore } as CdxDoc, changed)) stale.add(id);
    stale = new Set([...stale].filter((id) => !!findById(doc.root, id)));
    fire(true);
    return true;
  }

  function setTool(t: CanvasTool): void {
    tool = t;
    sketch = null;
    for (const [k, b] of toolBtns) {
      b.classList.toggle("active", k === t);
      b.setAttribute("aria-pressed", String(k === t));
    }
    valueIn.placeholder = t === "atom" ? "Element or label: N, Cl, R1, OMe …" : t === "text" ? "Words for a caption" : t === "bracket" ? "Bracket label (blank = n)" : "";
    valueIn.disabled = t !== "atom" && t !== "text" && t !== "bracket";
    ringSel.disabled = t !== "ring";
    styleSel.disabled = t !== "bond";
    arrowSel.disabled = t !== "arrow";
    host.setStatus(TOOL_HELP[t], "");
  }

  // ---- pointer --------------------------------------------------------------------------------
  const pagePoint = (e: MouseEvent): Pt | null => {
    const svg = surface.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width) return null;
    const k = (view[2] - view[0]) / r.width;
    return [view[0] + (e.clientX - r.left) * k, view[1] + (e.clientY - r.top) * k];
  };
  const L = (): number => doc.style.bondLength;
  type Sketch = { tool: CanvasTool; from: Pt; atom: string | null; to: Pt; moved: boolean };
  let sketch: Sketch | null = null;
  let moving: { from: Pt; moved: boolean } | null = null;
  let boxSel: { from: Pt; to: Pt } | null = null;

  const ghost = (): void => {
    const svg = surface.querySelector("svg");
    svg?.querySelector("#chem-ghost")?.remove();
    if (!svg) return;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("id", "chem-ghost");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", "#2563eb");
    g.setAttribute("stroke-width", String(Math.max(0.4, doc.style.lineWidth)));
    const line = (pts: Pt[]): void => {
      const pl = document.createElementNS(SVGNS, "polyline");
      pl.setAttribute("points", pts.map((q) => `${q[0]},${q[1]}`).join(" "));
      g.appendChild(pl);
    };
    if (sketch) {
      const { from, to } = sketch;
      if (sketch.tool === "chain") {
        const path = chainPath(doc, sketch.atom ? { nodeId: sketch.atom } : { at: from }, to, chainOf(sketch));
        if (path) line([path.start, ...path.points]);
      } else if (sketch.tool === "bracket") {
        line([from, [to[0], from[1]], to, [from[0], to[1]], from]);
      } else line([sketch.tool === "bond" && sketch.atom ? atomPos(sketch.atom) ?? from : from, to]);
    }
    if (boxSel) line([boxSel.from, [boxSel.to[0], boxSel.from[1]], boxSel.to, [boxSel.from[0], boxSel.to[1]], boxSel.from]);
    svg.appendChild(g);
  };
  const atomPos = (id: string): Pt | null => {
    const p = findById(doc.root, id)?.el.attrs.p?.split(/\s+/).map(Number);
    return p && p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null;
  };
  const chainOf = (s: Sketch): number => {
    const p = s.atom ? atomPos(s.atom) ?? s.from : s.from;
    return chainLength(doc, Math.hypot(s.to[0] - p[0], s.to[1] - p[1]));
  };

  surface.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (e.button !== 0) return;
    const p = pagePoint(e);
    if (!p) return;
    if (DRAG_TOOLS.has(tool)) {
      sketch = { tool, from: p, atom: tool === "bond" || tool === "chain" ? atomAt(doc, p, L() * 0.3) : null, to: p, moved: false };
      surface.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === "select") {
      const id = objectAt(doc, boxes, p, L() * 0.3);
      if (id && selected.has(id) && !e.shiftKey) moving = { from: p, moved: false };
      else if (!id) boxSel = { from: p, to: p };
      surface.setPointerCapture?.(e.pointerId);
    }
  });
  surface.addEventListener("pointermove", (e) => {
    const p = pagePoint(e);
    if (!p) return;
    if ((sketch || moving || boxSel) && e.buttons === 0) return cancelDrag();
    if (sketch) {
      sketch.to = p;
      if (Math.hypot(p[0] - sketch.from[0], p[1] - sketch.from[1]) > L() * 0.25) sketch.moved = true;
      ghost();
    } else if (moving) {
      const dx = p[0] - moving.from[0], dy = p[1] - moving.from[1];
      if (Math.hypot(dx, dy) > L() * 0.1) moving.moved = true;
      surface.querySelector("#chem-sel")?.setAttribute("transform", `translate(${dx} ${dy})`);
    } else if (boxSel) {
      boxSel.to = p;
      ghost();
    }
  });
  const cancelDrag = (): void => {
    sketch = null;
    moving = null;
    boxSel = null;
    surface.querySelector("#chem-ghost")?.remove();
    surface.querySelector("#chem-sel")?.removeAttribute("transform");
  };
  surface.addEventListener("pointercancel", cancelDrag);
  surface.addEventListener("pointerup", (e) => {
    const p = pagePoint(e);
    if (moving) {
      const m = moving;
      cancelDrag();
      if (m.moved && p) {
        suppressClick = true;
        const ids = [...selected];
        edit(() => (moveObjects(doc, ids, p[0] - m.from[0], p[1] - m.from[1]), null));
      }
      return;
    }
    if (boxSel) {
      const b = boxSel;
      cancelDrag();
      if (p && Math.hypot(p[0] - b.from[0], p[1] - b.from[1]) > L() * 0.25) {
        suppressClick = true;
        const x0 = Math.min(b.from[0], p[0]), y0 = Math.min(b.from[1], p[1]), x1 = Math.max(b.from[0], p[0]), y1 = Math.max(b.from[1], p[1]);
        if (!e.shiftKey) selected = new Set();
        for (const [id, q] of boxes) if (q[0] < x1 && q[2] > x0 && q[1] < y1 && q[3] > y0) selected.add(id);
        paintSelection();
      }
      return;
    }
    if (!sketch) return;
    const s = sketch;
    cancelDrag();
    const to = p ?? s.to;
    suppressClick = true;
    const far = Math.hypot(to[0] - s.from[0], to[1] - s.from[1]) > L() * 0.25;
    if (s.tool === "bond") return bondGesture(s, to, far);
    if (s.tool === "chain") {
      if (!far) {
        if (!s.atom) return host.setStatus("Drag to draw a chain: from an atom to grow it, or from empty paper to start one.", "error");
        const a = s.atom;
        edit(() => {
          const r = addBondFrom(doc, a);
          return r.ok ? null : r.reason;
        });
        return;
      }
      const n = chainOf({ ...s, to });
      if (edit(() => addChain(doc, s.atom ? { nodeId: s.atom } : { at: s.from }, to, n))) host.setStatus(`Chain of ${n} bond${n === 1 ? "" : "s"} drawn.`, "success");
      return;
    }
    if (!far) return host.setStatus(TOOL_HELP[s.tool], "error");
    if (s.tool === "bracket") {
      const label = valueIn.value.trim() || "n";
      const box: [number, number, number, number] = [s.from[0], s.from[1], to[0], to[1]];
      if (edit(() => addBrackets(doc, box, label))) host.setStatus(`Brackets drawn round the repeat unit, labelled ${label}.`, "success");
      return;
    }
    const kind = (arrowSel.value || "reaction") as ArrowKind;
    if (edit(() => addArrow(doc, s.from, to, kind))) host.setStatus(kind === "equilibrium" ? "Equilibrium arrow drawn." : "Reaction arrow drawn.", "success");
  });

  /** The bond tool: a click (bond on empty paper, a bond from an atom, a bond changed) or a drag. */
  function bondGesture(s: Sketch, to: Pt, far: boolean): void {
    const style = styleSel.value;
    if (!far) {
      if (s.atom) {
        const a = s.atom;
        edit(() => {
          const r = addBondFrom(doc, a);
          return r.ok ? null : r.reason;
        });
        return;
      }
      const bond = bondAt(doc, s.from, L() * 0.2);
      if (bond) {
        const b = findById(doc.root, bond)?.el;
        if (style) {
          // A stereo style clicked again on the same bond turns it round.
          const flip = !!b && (b.attrs.Display ?? "Solid") === style && /Wedge/.test(style);
          edit(() => setBond(doc, bond, flip ? { flip: true } : { display: style, order: "1" }));
        } else {
          const order = b?.attrs.Order ?? "1";
          edit(() => setBond(doc, bond, { order: order === "1" ? "2" : order === "2" ? "3" : "1", display: "Solid" }));
        }
        return;
      }
      edit(() => {
        const r = addBondAt(doc, s.from);
        if (r.ok && style) return setBond(doc, r.bondId, { display: style, order: "1" });
        return r.ok ? null : r.reason;
      });
      return;
    }
    if (!s.atom) {
      // A drag from empty paper: a bond from where it began to where it ends (snapped at the end atom).
      edit(() => {
        const first = addAtomAt(doc, s.from, "C");
        if (!first.ok) return first.reason;
        // The placed carbon is a bare vertex once it has a bond.
        const node = findById(doc.root, first.nodeId)!.el;
        node.children = node.children.filter((c) => c.name !== "t");
        delete node.attrs.NumHydrogens;
        const r = addBondToward(doc, first.nodeId, to, atomAt(doc, to, L() * 0.3));
        if (!r.ok) return r.reason;
        return style ? setBond(doc, r.bondId, { display: style, order: "1" }) : null;
      });
      return;
    }
    const a = s.atom;
    const target = atomAt(doc, to, L() * 0.3);
    edit(() => {
      const r = addBondToward(doc, a, to, target);
      if (!r.ok) return r.reason;
      return style ? setBond(doc, r.bondId, { display: style, order: "1" }) : null;
    });
  }

  surface.addEventListener("click", (e) => {
    surface.focus({ preventScroll: true });
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (DRAG_TOOLS.has(tool)) return;
    const p = pagePoint(e);
    if (!p) return;
    if (tool === "select") {
      const id = objectAt(doc, boxes, p, L() * 0.3);
      if (!id) {
        if (!e.shiftKey) selected = new Set();
      } else if (e.shiftKey) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else selected = withCompanions(doc, boxes, id);
      paintSelection();
      return;
    }
    const atom = atomAt(doc, p, L() * 0.3);
    const bond = atom ? null : bondAt(doc, p, L() * 0.2);
    if (tool === "atom") {
      const v = valueIn.value.trim() || "C";
      if (atom) {
        let note: string | null = null;
        if (edit(() => {
          const r = setAtomLabel(doc, atom, v);
          if (!r.ok) return r.reason;
          note = r.note;
          return null;
        }) && note) host.setStatus(note, "");
      } else edit(() => {
        const r = addAtomAt(doc, p, v);
        return r.ok ? null : r.reason;
      });
      return;
    }
    if (tool === "charge+" || tool === "charge-") {
      if (!atom) return host.setStatus("Click on an atom.", "error");
      const n = findById(doc.root, atom)?.el;
      const q = (Number(n?.attrs.Charge ?? 0) || 0) + (tool === "charge+" ? 1 : -1);
      edit(() => setCharge(doc, atom, q));
      return;
    }
    if (tool === "ring") {
      const kind = (ringSel.value || "benzene") as RingKind;
      if (bond) edit(() => addRingOnBond(doc, bond, kind));
      else if (atom) edit(() => addRingAtAtom(doc, atom, kind));
      else edit(() => addRingAt(doc, p, kind));
      return;
    }
    if (tool === "text") {
      const v = valueIn.value;
      const tid = captionAt(doc, p, L() * 0.15);
      if (!v.trim()) {
        valueIn.focus();
        return host.setStatus("Type the words in the box first, then click.", "error");
      }
      if (tid) edit(() => setText(doc, tid, v));
      else edit(() => {
        const r = addCaption(doc, p, v);
        return r.ok ? null : r.reason;
      });
      return;
    }
    if (tool === "erase") {
      if (atom || bond) {
        const id = (atom ?? bond)!;
        edit(() => deleteInStructure(doc, id));
        return;
      }
      const id = objectAt(doc, boxes, p, L() * 0.3);
      if (!id) return host.setStatus("Nothing to erase there.", "error");
      edit(() => (deleteObjects(doc, [id]), null));
    }
  });

  surface.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
      const ids = [...selected];
      if (edit(() => (deleteObjects(doc, ids), null))) selected = new Set();
      e.preventDefault();
    } else if (e.key === "Escape") {
      cancelDrag();
      setTool("select");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      doRedo();
    }
  });
  function doUndo(): void {
    if (!undo.length) return;
    redo.push(snapshot());
    const u = undo.pop()!;
    doc.root = u.root;
    fragmentFlag = u.frag;
    reread();
    edited = true;
    saved = false;
    fire(true);
  }
  function doRedo(): void {
    if (!redo.length) return;
    undo.push(snapshot());
    const u = redo.pop()!;
    doc.root = u.root;
    fragmentFlag = u.frag;
    reread();
    edited = true;
    saved = false;
    fire(true);
  }
  undoBtn.addEventListener("click", doUndo);
  redoBtn.addEventListener("click", doRedo);
  /** Zoom about a page point: k < 1 shows less paper (closer), > 1 more. Bounded, so it never runs away. */
  const zoom = (k: number, about?: Pt): void => {
    const w = view[2] - view[0], h = view[3] - view[1];
    const nw = Math.min(5000, Math.max(30, w * k)), f = nw / w;
    const c = about ?? [(view[0] + view[2]) / 2, (view[1] + view[3]) / 2];
    view = [c[0] - (c[0] - view[0]) * f, c[1] - (c[1] - view[1]) * f, c[0] + (view[2] - c[0]) * f, c[1] + (view[3] - c[1]) * f];
    draw();
  };
  zoomInBtn.addEventListener("click", () => zoom(1 / 1.25));
  zoomOutBtn.addEventListener("click", () => zoom(1.25));
  fitBtn.addEventListener("click", () => {
    if (!contentBox()) view = [...START_VIEW] as Box;
    else growView(true);
    draw();
  });
  surface.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return; // plain wheel scrolls the page
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 / 1.15 : 1.15, pagePoint(e) ?? undefined);
    },
    { passive: false },
  );

  // ---- API ------------------------------------------------------------------------------------
  const chemistry = (selectionOnly = false): { ok: true; mol: Molecule; notes: string[] } | { ok: false; reason: string } => {
    const scope = selectionOnly && selected.size ? selected : null;
    const inScope = (id: string): boolean => !scope || scope.has(id);
    // A reaction scheme (an arrow) or a polymer (brackets) is not one structure: its parts are read one at a time.
    if (doc.objects.some((o) => inScope(o.id) && o.items.some((it) => it.kind === "arrow")))
      return { ok: false, reason: "a reaction (an arrow on the page) has no single formula — select one structure (Select tool) to read its formula" };
    const bracketed = new Set(doc.brackets.flatMap((g) => g.objectIds));
    const inPolymer = doc.objects.some((o) => inScope(o.id) && o.items.some((it) => it.kind === "fragment" && it.v.nodes.some((nd) => bracketed.has(nd.id))));
    if (inPolymer) return { ok: false, reason: "a polymer drawn with brackets has no single formula (its repeat unit repeats n times)" };
    let r: ReturnType<typeof pageToMolecule>;
    try {
      r = pageToMolecule(doc, selectionOnly && selected.size ? selected : undefined);
    } catch (e) {
      // A structure the chemistry library cannot take is a refusal, never a crash in the pane.
      return { ok: false, reason: `the structure could not be read as chemistry (${(e as Error).message})` };
    }
    if (!r.ok) return r;
    r.value.mol.setFragment(fragmentFlag);
    return { ok: true, mol: r.value.mol, notes: r.value.notes };
  };
  const api: ChemCanvas = {
    getMolecule: () => {
      const r = chemistry();
      if (r.ok) return r.mol;
      const m = new Molecule(0, 0);
      m.setFragment(fragmentFlag);
      return m;
    },
    chemistry,
    setMolecule: (mol) => {
      const before = snapshot();
      const fresh = blankDoc();
      // The page keeps its own style (a ChemDraw file's bond length, fonts): only its content is replaced.
      if (doc.objects.length) {
        fresh.root.attrs = { ...doc.root.attrs };
        const keep = doc.root.children.filter((c) => c.name === "fonttable" || c.name === "colortable").map(cloneTree);
        fresh.root.children = [...keep, ...fresh.root.children.filter((c) => c.name !== "fonttable" && c.name !== "colortable")];
        const re = readCdxmlTree(fresh.root);
        if (re.ok) Object.assign(fresh, re.doc);
      }
      const w = moleculeToPage(fresh, mol);
      if (!w.ok) return host.setStatus(`The structure could not be put on the page: ${w.reason}.`, "error");
      undo.push(before);
      if (undo.length > UNDO_DEPTH) undo.shift();
      redo = [];
      doc = fresh;
      edited = false;
      fragmentFlag = mol.isFragment();
      selected = new Set();
      const r = readCdxmlTree(doc.root);
      if (r.ok) doc = r.doc;
      boxes = objectBoxes(doc);
      growView(true);
      draw();
      fire(false);
    },
    clearAll: () => {
      undo.push(snapshot());
      if (undo.length > UNDO_DEPTH) undo.shift();
      redo = [];
      doc = blankDoc();
      boxes = new Map();
      selected = new Set();
      view = [...START_VIEW] as Box;
      draw();
      fire(true);
    },
    moleculeChanged: () => {
      draw();
      fire(false);
    },
    setOnChangeListener: (cb) => void (onChange = cb),
    setFragment: (on) => void (fragmentFlag = on),
    isFragment: () => fragmentFlag,
    page: () => doc,
    loadPage: (d) => {
      undo.push(snapshot());
      if (undo.length > UNDO_DEPTH) undo.shift();
      redo = [];
      doc = d;
      selected = new Set();
      stale = new Set();
      edited = false;
      saved = false;
      boxes = objectBoxes(doc);
      view = [...START_VIEW] as Box;
      growView(true);
      draw();
      fire(false);
    },
    hasDrawing: () => doc.objects.some((o) => o.items.some((it) => it.kind !== "fragment")) || doc.brackets.length > 0,
    render: (selectionOnly) => {
      if (selectionOnly && !selected.size) return null;
      const r = renderCdx(doc, { ...(selectionOnly && selected.size ? { objects: new Set(selected) } : {}), pad: doc.style.lineWidth * 2 });
      return r ? { svg: r.svg, widthPt: r.widthPt, heightPt: r.heightPt } : null;
    },
    selection: () => new Set(selected),
    setTool,
    staleNames: () => [...stale].map((id) => (findById(doc.root, id)?.el.children.filter((c) => c.name === "s").map((s) => s.text).join("") ?? "").trim()).filter(Boolean),
    wasSaved: () => saved,
    setName: (n) => void (pageName = n.replace(/\.(cdxml|cdx|xml)$/i, "") || "drawing"),
  };
  saveBtn.addEventListener("click", () => {
    if (!host.downloadFile) return;
    const out = `${pageName}${edited ? " (edited)" : ""}.cdxml`;
    host.downloadFile(new Blob([writeCdxml(doc.root)], { type: "chemical/x-cdxml" }), out);
    saved = true;
    host.setStatus(`Saved ${out} — it opens in ChemDraw.`, "success");
  });
  setTool("bond");
  draw();
  return api;
}
