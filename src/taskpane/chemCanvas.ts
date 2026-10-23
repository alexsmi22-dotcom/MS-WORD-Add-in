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
import { arrowFromElement, readCdxml, readCdxmlTree, CdxDoc, CdxRun, CdxText, Box, Pt } from "../lib/cdxml";
import { arrowMarkup, renderCdx } from "../lib/cdxmlRender";
import { arcOf, type ArrowEnd } from "../lib/cdxArrows";
import { atomAt, bondAt, captionAt, objectAt, objectBoxes, withCompanions } from "../lib/cdxmlSelect";
import {
  addArrow, addCurvedArrow, arrowAnchors, curvedArrowElement, flipCurvedArrow, followAnchors, addAtomAt, addBondAt, addBondBetween, addBondFrom, addBondToward, addBrackets, addCaption, addChain, addRingAt, addRingAtAtom, addRingOnBond,
  ArrowKind, blankPageCdxml, chainLength, chainPath, cloneTree, deleteInStructure, deleteObjects, findById, moveObjects, RingKind,
  namesTiedTo, setAtomLabel, setAtomProps, setBond, setBondProps, setCharge, setText, writeCdxml, type AtomProps,
} from "../lib/cdxmlEdit";
import { moleculeToPage, pageToMolecule } from "../lib/cdxmlMol";
import { repeatUnitOf, type RepeatUnit } from "../lib/polymerUnit";
import { cleanStructures } from "../lib/cdxClean";
import { atomQueryMarks, bondQueryMarks, showsMarks, stereoGroupMark } from "../lib/cdxQuery";
import type { XNode } from "../lib/xmlLite";
import { addHapto, addMetalloceneTemplate, METALLOCENE_TEMPLATES, ringContaining, ringThrough, type MetalloceneTemplate } from "../lib/organometal";

export type CanvasTool = "select" | "atom" | "bond" | "chain" | "ring" | "charge+" | "charge-" | "bracket" | "arrow" | "text" | "erase" | "props" | "hapto" | "metallocene";

export interface ChemCanvasHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** Saves a file for the user (Save as .cdxml); without it the button is not shown. */
  downloadFile?(blob: Blob, name: string): void;
}

/** Why the canvas changed: a user edit, or a programmatic load (the pane keeps its status for the latter). */
export interface CanvasChange {
  isUserEvent: boolean;
  /** The canvas reported a problem during this change (a page it could not draw, an edit it undid): keep that message. */
  keepStatus?: boolean;
}

export interface ChemCanvas {
  /** The page's structures as one OCL Molecule (empty when there are none, or when they cannot be one — see chemistry()). */
  getMolecule(): Molecule;
  /** The page's structures (or the selection's) as a Molecule (with what was read as drawn but unusual), or why they have no single formula. */
  /** `ionic`: η-bonds written as ions (exact formula; the SMILES is an ionic representation). */
  chemistry(selectionOnly?: boolean): { ok: true; mol: Molecule; notes: string[]; ionic?: boolean } | { ok: false; reason: string; repeatUnit?: RepeatUnit };
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
  /** Replaces the page as one edit (undoable; names ChemDraw computed for changed structures are flagged): the large canvas's page coming back. */
  replacePage(doc: CdxDoc): boolean;
  /** Lays the page's structures (the selected ones, if any) out again in place, as one edit; everything else keeps its place. False when refused (said in the status). */
  clean(): boolean;
  /** Whether the page holds more than structures (brackets, arrows, text): it inserts as the drawing then. */
  hasDrawing(): boolean;
  /** The page (or the selection) drawn for insertion. */
  render(selectionOnly: boolean): { svg: string; widthPt: number; heightPt: number } | null;
  selection(): Set<string>;
  setTool(t: CanvasTool): void;
  /** Places a metallocene template beside what is drawn (or in view on an empty page), as one edit; false when refused. Page canvas only. */
  placeTemplate?(kind: MetalloceneTemplate): boolean;
  /** The Ring tool's ring (Cp for organometallics). Page canvas only. */
  setRingKind?(kind: RingKind): void;
  /** Names ChemDraw computed for structures changed since (their words): to check before inserting. */
  staleNames(): string[];
  /** The name the page is saved under (a ChemDraw file's name). */
  setName(name: string): void;
  /** Saved as .cdxml since it was loaded and not changed since. */
  wasSaved(): boolean;
  /** The smallest lettering on the page (or the selection) as drawn, in points: subscripts and charges count at the 75 % they are drawn at. */
  smallestTextPt(selectionOnly: boolean): number | null;
}

const UNDO_DEPTH = 100;
const SUPER_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
const ELEMENTS = ["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "I"];
const RINGS: Array<[RingKind, string]> = [["benzene", "Benzene"], ["cyclohexane", "Cyclohexane"], ["cyclopentane", "Cyclopentane"], ["cyclobutane", "Cyclobutane"], ["cyclopropane", "Cyclopropane"], ["cycloheptane", "Cycloheptane"], ["cyclopentadienyl", "Cyclopentadienyl (Cp)"]];
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
  arrow: "Arrow: choose the kind, then drag from the tail to the head.",
  text: "Text: type the words in the box, then click empty paper for a new caption, or a caption to change it.",
  erase: "Erase: click an atom, a bond, or anything else on the page.",
  hapto: "η-bond: click inside a ring (a Cp ring), then the metal it binds — or the metal first, then the ring. Label the metal first (Zr, Hf, Ti, Fe …).",
  metallocene: "Metallocene: choose a template, then click the page to place it. Change the metal, a ligand or the bridge with the Atom tool (Hf, BH4, C, Z …).",
  props: "Properties: click an atom for its radical, stereo group (AND / OR) and query features, or a bond for its query orders and ring / chain. For an atom list, type [N,O] or NOT [F,Cl] with the Atom tool.",
};
const DRAG_TOOLS = new Set<CanvasTool>(["bond", "chain", "bracket", "arrow"]);
/** The Arrow tool's kinds: [value, menu name, what a drawn one is called, how to draw it]. */
const ARROW_KINDS: Array<[string, string, string, string]> = [
  ["reaction", "Reaction arrow →", "Reaction arrow", "drag from the tail to the head."],
  ["equilibrium", "Equilibrium arrow ⇌", "Equilibrium arrow", "drag from the tail to the head."],
  ["retrosynthetic", "Retrosynthetic arrow ⇒", "Retrosynthetic arrow", "drag from the target back toward what it is made from."],
  ["resonance", "Resonance arrow ↔", "Resonance arrow", "drag between the two resonance forms."],
  ["curved", "Curved arrow (electron pair)", "Curved arrow", "drag from a lone pair (its atom) or a bond to the atom or bond the electrons go to; the ends snap to them. Shift while dragging bows it the other way; click a curved arrow to flip it."],
  ["fishhook", "Fishhook (one electron)", "Fishhook arrow", "drag from an atom or a bond to where the electron goes; the ends snap to them. Shift while dragging bows it the other way; click a curved arrow to flip it."],
];
/**
 * Curved electron-pushing arrows and fishhooks are NOT offered in the menu yet (Release C review, final round): on
 * several everyday mechanisms (an arenium C–H to the ring, a tilted O–O homolysis, a leaving group in most bond
 * directions, a carbonyl addition beside another arrow) neither bow drew cleanly, and a drawing has no refusal mode.
 * The geometry, the file format and the attachment stay in place; arrows of these kinds in a file still open and draw.
 */
const CURVED_ARROWS_OFFERED = false;
const SVGNS = "http://www.w3.org/2000/svg";

function blankDoc(): CdxDoc {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}

/** The toolbar's icons (24-unit squares, drawn in the button's colour), keyed by tool or action. */
const TOOL_ICONS: Record<string, string> = {
  select: `<path d="M6 3l12 9-5.5 1L10 19z"/>`,
  atom: `<text x="12" y="18" text-anchor="middle" font-size="17" font-weight="600" font-family="Arial, sans-serif" fill="currentColor" stroke="none">C</text>`,
  bond: `<path d="M5 19L19 5"/>`,
  chain: `<path d="M2.5 15.5l4.75-7 4.75 7 4.75-7 4.75 7"/>`,
  ring: `<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>`,
  "charge+": `<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>`,
  "charge-": `<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>`,
  bracket: `<path d="M8 4H5v16h3M16 4h3v16h-3"/>`,
  hapto: `<text x="12" y="17" text-anchor="middle" font-size="17" font-style="italic" font-family="Times New Roman, serif" fill="currentColor" stroke="none">η</text>`,
  metallocene: `<ellipse cx="12" cy="5" rx="7" ry="2.6"/><ellipse cx="12" cy="19" rx="7" ry="2.6"/><path d="M12 7.6v2.4M12 14v2.4"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`,
  arrow: `<path d="M3 12h17M15 7l5 5-5 5"/>`,
  text: `<path d="M5 5h14M12 5v14M9 19h6"/>`,
  erase: `<path d="M14.5 4.5l5 5-9 9H6l-2.5-2.5z"/><path d="M9 10l5 5M11 18.5h9"/>`,
  props: `<path d="M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4"/>`,
  undo: `<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`,
  redo: `<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>`,
  "zoom-in": `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6M10.5 7.5v6"/>`,
  "zoom-out": `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>`,
  fit: `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`,
  save: `<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`,
};

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
    ["ring", "Ring", "Rings"], ["hapto", "η-bond", "η-bond: a metal bound to a whole ring (η⁵-Cp)"], ["metallocene", "Metallocene", "Metallocene templates (Cp₂ZrCl₂, ansa, half-sandwich, polymer-bound)"],
    ["charge+", "Raise charge", "Raise a charge"], ["charge-", "Lower charge", "Lower a charge"], ["bracket", "Brackets", "Polymer brackets"],
    ["arrow", "Arrow", "Reaction arrows"], ["text", "Text", "Captions"], ["erase", "Erase", "Remove"],
    ["props", "Properties", "Atom and bond properties: radical, stereo group, query features"],
  ];
  // A compact row of icons, as ChemDraw's tool palette (a user missed the icons: the worded row took three
  // lines of the pane). The name stays as the tooltip and for screen readers.
  const iconButton = (attrs: Record<string, string>, label: string): HTMLButtonElement => {
    const b = el("button", { type: "button", class: "insert-btn secondary chem-tool-icon", "aria-label": label, ...attrs });
    const key = attrs["data-chem-tool"] ?? attrs["data-chem-action"];
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TOOL_ICONS[key] ?? ""}</svg>`;
    b.appendChild(el("span", { class: "chem-tool-label" }, label));
    return b;
  };
  for (const [t, label, title] of toolNames) {
    const b = iconButton({ "data-chem-tool": t, "aria-pressed": "false", title }, label);
    b.addEventListener("click", () => setTool(t));
    toolBtns.set(t, b);
    bar.appendChild(b);
  }
  const undoBtn = iconButton({ "data-chem-action": "undo", title: "Undo (Ctrl+Z)" }, "Undo");
  const redoBtn = iconButton({ "data-chem-action": "redo", title: "Redo (Ctrl+Y)" }, "Redo");
  const zoomInBtn = iconButton({ "data-chem-action": "zoom-in", title: "Zoom in (Ctrl+wheel)" }, "Zoom in");
  const zoomOutBtn = iconButton({ "data-chem-action": "zoom-out", title: "Zoom out (Ctrl+wheel)" }, "Zoom out");
  const fitBtn = iconButton({ "data-chem-action": "fit", title: "Fit the drawing in view" }, "Fit");
  bar.append(undoBtn, redoBtn, zoomInBtn, zoomOutBtn, fitBtn);
  const saveBtn = iconButton({ "data-chem-action": "save", title: "Save as .cdxml — download the page as a ChemDraw XML file (ChemDraw opens it)" }, "Save as .cdxml");
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
  for (const [v, t] of ARROW_KINDS) if (CURVED_ARROWS_OFFERED || (v !== "curved" && v !== "fishhook")) arrowSel.add(new Option(t, v));
  arrowSel.addEventListener("change", () => host.setStatus(arrowHelp(), ""));
  const tplSel = el("select", { "aria-label": "Metallocene template", "data-chem-template": "" }) as HTMLSelectElement;
  for (const t of METALLOCENE_TEMPLATES) tplSel.add(new Option(t.label, t.id));
  opts.append(palette, valueIn, ringSel, tplSel, styleSel, arrowSel);
  // The Properties panel: what ChemDraw's Atom / Bond Properties set, for the atom or bond clicked.
  const selectOf = (label: string, key: string, options: Array<[string, string]>): HTMLSelectElement => {
    const s = el("select", { "aria-label": label, [`data-chem-prop`]: key }) as HTMLSelectElement;
    for (const [v, t] of options) s.add(new Option(t, v));
    return s;
  };
  const propsBox = el("div", { class: "chem-canvas-props", hidden: "" });
  const propsWhat = el("span", { class: "hint", "data-chem-prop-target": "" }, "Click an atom or a bond.");
  const atomProps = el("div", { class: "chem-canvas-props-atom", hidden: "" });
  const radSel = selectOf("Radical", "radical", [["", "No radical"], ["Doublet", "Radical • (doublet)"], ["Singlet", "Carbene : (singlet)"], ["Triplet", "Carbene : (triplet)"]]);
  const stereoSel = selectOf("Stereo group", "stereo", [["Absolute", "Stereo: absolute"], ["And", "Stereo: AND (racemic) group"], ["Or", "Stereo: OR (relative) group"]]);
  const groupIn = el("input", { type: "number", min: "1", max: "32", value: "1", class: "formula-input", "aria-label": "Stereo group number", "data-chem-prop": "group" }) as HTMLInputElement;
  const subSel = selectOf("Substituents", "substituents", [["", "Substituents: any"], ["e0", "exactly 0"], ["e1", "exactly 1"], ["e2", "exactly 2"], ["e3", "exactly 3"], ["u1", "up to 1"], ["u2", "up to 2"], ["u3", "up to 3"], ["f0", "no more than drawn"]]);
  const ringBSel = selectOf("Ring bonds", "ringbonds", [["", "Ring bonds: any"], ["NoRingBonds", "none (chain atom)"], ["SimpleRing", "2 (simple ring)"], ["Fusion", "3 (fusion)"], ["SpiroOrHigher", "4 or more (spiro)"], ["AsDrawn", "as drawn"]]);
  const unsatSel = selectOf("Unsaturation", "unsaturation", [["", "Unsaturation: any"], ["MustBeAbsent", "saturated (no multiple bonds)"], ["MustBePresent", "unsaturated (has a multiple bond)"]]);
  atomProps.append(radSel, stereoSel, groupIn, subSel, ringBSel, unsatSel);
  const bondProps = el("div", { class: "chem-canvas-props-bond", hidden: "" });
  const orderBoxes: Array<[string, HTMLInputElement]> = [];
  for (const [v, t] of [["1", "single"], ["2", "double"], ["3", "triple"], ["1.5", "aromatic"]] as const) {
    const lab = el("label", { class: "chem-canvas-check" });
    const box = el("input", { type: "checkbox", "data-chem-prop-order": v }) as HTMLInputElement;
    lab.append(box, document.createTextNode(` ${t}`));
    orderBoxes.push([v, box]);
    bondProps.append(lab);
  }
  const topoSel = selectOf("Ring or chain", "topology", [["", "Ring or chain: either"], ["Ring", "in a ring"], ["Chain", "in a chain"]]);
  bondProps.append(topoSel);
  propsBox.append(propsWhat, atomProps, bondProps);
  opts.append(propsBox);
  const surface = el("div", { class: "chem-canvas-surface", tabindex: "0", "aria-label": "Drawing page" });
  mount.append(bar, opts, surface);

  // ---- state ----------------------------------------------------------------------------------
  let doc: CdxDoc = blankDoc();
  let boxes = new Map<string, Box>();
  let selected = new Set<string>();
  let tool: CanvasTool = "bond";
  /** The η tool's first click: the ring or the metal, waiting for the other. */
  let haptoPick: { ring?: string[]; metal?: string } | null = null;
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
  /** The atom or bond the Properties panel is showing. */
  let propTarget: { kind: "atom" | "bond"; id: string } | null = null;
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

  // A problem reported while the change was made: the pane's status clear must not wipe it (review).
  let reported = false;
  /** An η-bond's centre within a third of a bond length of a page point (it has no label to click, nor to draw over). */
  const nearHaptoCentre = (p: Pt): boolean =>
    doc.objects.some((o) => o.items.some((it) => it.kind === "fragment" && it.v.nodes.some((n) => n.nodeType === "MultiAttachment" && Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) < L() * 0.35)));
  const fire = (isUserEvent: boolean): void => {
    // Any change to the drawing (an edit, undo, a page loaded) forgets the η tool's first click: its atom ids may now
    // name other atoms (review: a stale pick bound a ring the user never chose).
    haptoPick = null;
    const keepStatus = reported;
    reported = false;
    onChange?.(keepStatus ? { isUserEvent, keepStatus } : { isUserEvent });
  };
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
    // The Properties panel shows the page as it is (after Undo / Redo too): never stale values to resubmit.
    if (propTarget) showProps(propTarget);
    const r = (() => {
      try {
        return renderCdx(doc, { pad: 0 });
      } catch (e) {
        host.setStatus(`The page could not be drawn (${(e as Error).message}).`, "error");
        reported = true;
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
      reported = true;
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
  function edit(f: () => string | null, layoutOnly = false): boolean {
    reported = false; // only what THIS change reports is kept
    const step = snapshot();
    const before = step.root;
    const sigBefore = signatures();
    const propsBefore = doc.properties;
    const why = f();
    if (why) {
      // The page as it was — parsed again, so nothing the refused edit half did lingers in what is read.
      doc.root = before;
      const back = readCdxmlTree(doc.root);
      if (back.ok) doc = back.doc;
      boxes = objectBoxes(doc);
      draw();
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
    // A layout change (Clean) leaves every structure what it was: the names ChemDraw computed still hold.
    if (!layoutOnly) for (const id of namesTiedTo({ ...doc, root: before, properties: propsBefore } as CdxDoc, changed)) stale.add(id);
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
    // Only the active tool's options are shown: three greyed-out pickers and an empty box beside them read as
    // broken controls in a demo (walkthrough 2026-10-19). Hidden AND disabled, so no stray keypress reaches one.
    const show = (e: HTMLInputElement | HTMLSelectElement, on: boolean): void => {
      e.disabled = !on;
      e.hidden = !on;
    };
    show(valueIn, t === "atom" || t === "text" || t === "bracket");
    show(ringSel, t === "ring");
    show(tplSel, t === "metallocene");
    haptoPick = null;
    show(styleSel, t === "bond");
    show(arrowSel, t === "arrow");
    propsBox.hidden = t !== "props";
    if (t !== "props") propTarget = null;
    host.setStatus(t === "arrow" ? arrowHelp() : TOOL_HELP[t], "");
  }
  const arrowKind = (): (typeof ARROW_KINDS)[number] => ARROW_KINDS.find((k) => k[0] === arrowSel.value) ?? ARROW_KINDS[0];
  const curvedKind = (): boolean => arrowSel.value === "curved" || arrowSel.value === "fishhook";
  const arrowHelp = (): string => `${arrowKind()[2]}: ${arrowKind()[3]}`;
  /** Where a curved arrow's end goes: the atom under the point, else the bond, else the point itself. */
  const snapEnd = (p: Pt): ArrowEnd => {
    // An atom's own point first, then a bond's line, then anywhere on an atom's label: the middle of a short bond
    // between two labels (Br–Br) lies inside a label's box, and there the bond is meant (walkthrough: homolysis).
    let near: string | null = null, best = L() * 0.3;
    for (const o of doc.objects)
      for (const it of o.items)
        if (it.kind === "fragment")
          for (const n of it.v.nodes) {
            const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
            if (n.nodeType !== "MultiAttachment" && d < best) (best = d), (near = n.id);
          }
    if (near) return { atom: near };
    const b = bondAt(doc, p, L() * 0.2);
    if (b) return { bond: b };
    const a = atomAt(doc, p, L() * 0.3);
    return a ? { atom: a } : { at: p };
  };
  /** The curved arrow under a point (for a click that flips it). */
  const curvedArrowAt = (p: Pt): string | null => {
    const id = objectAt(doc, boxes, p, L() * 0.3);
    const o = id ? doc.objects.find((x) => x.id === id) : undefined;
    const it = o?.items.find((x) => x.kind === "arrow");
    return it && it.kind === "arrow" && it.v.el.name === "arrow" && arcOf(it.v) ? it.v.id : null;
  };

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
  type Sketch = { tool: CanvasTool; from: Pt; atom: string | null; to: Pt; moved: boolean; shift?: boolean };
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
      } else if (sketch.tool === "arrow" && curvedKind()) {
        // The curved arrow as it will be drawn (the same geometry and the same drawing code), and the atoms or bonds
        // its ends have snapped to.
        const a = snapEnd(from), b = snapEnd(to);
        const el = sketch.moved ? curvedArrowElement(doc, a, b, { electrons: arrowSel.value === "fishhook" ? 1 : 2, flip: !!sketch.shift }) : null;
        const ar = el && typeof el !== "string" ? arrowFromElement(el) : null;
        if (ar) {
          const m = document.createElementNS(SVGNS, "g");
          m.innerHTML = arrowMarkup(doc.style, ar, "#2563eb").svg;
          g.appendChild(m);
        } else line([from, to]);
        for (const e of [a, b]) {
          const q = "atom" in e ? atomPos(e.atom) : "bond" in e ? bondMid(e.bond) : null;
          if (!q) continue;
          const c = document.createElementNS(SVGNS, "circle");
          c.setAttribute("cx", String(q[0]));
          c.setAttribute("cy", String(q[1]));
          c.setAttribute("r", String(L() * 0.3));
          c.setAttribute("stroke-width", String(Math.max(0.3, doc.style.lineWidth * 0.6)));
          c.setAttribute("stroke-dasharray", `${L() * 0.08} ${L() * 0.08}`);
          g.appendChild(c);
        }
      } else line([sketch.tool === "bond" && sketch.atom ? atomPos(sketch.atom) ?? from : from, to]);
    }
    if (boxSel) line([boxSel.from, [boxSel.to[0], boxSel.from[1]], boxSel.to, [boxSel.from[0], boxSel.to[1]], boxSel.from]);
    svg.appendChild(g);
  };
  const bondMid = (id: string): Pt | null => {
    const b = findById(doc.root, id)?.el;
    const p = b ? atomPos(b.attrs.B ?? "") : null, q = b ? atomPos(b.attrs.E ?? "") : null;
    return p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : null;
  };
  let ghostPending = false;
  const ghostSoon = (): void => {
    if (ghostPending) return;
    ghostPending = true;
    const later = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
    later(() => {
      ghostPending = false;
      if (sketch) ghost();
    });
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
      const startAtom = tool === "bond" || tool === "chain" ? atomAt(doc, p, L() * 0.3) : null;
      // A bond or chain is not started on an η-bond's centre (review: it put a new atom on top of it).
      if ((tool === "bond" || tool === "chain") && !startAtom && nearHaptoCentre(p)) {
        suppressClick = true;
        host.setStatus("That is the centre of an η-bond, not an atom — start the bond from the metal or a ring atom.", "error");
        return;
      }
      sketch = { tool, from: p, atom: startAtom, to: p, moved: false };
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
      sketch.shift = e.shiftKey;
      if (Math.hypot(p[0] - sketch.from[0], p[1] - sketch.from[1]) > L() * 0.25) sketch.moved = true;
      // A curved arrow's preview is planned afresh each time: at most once a frame, however fast the pointer reports.
      if (sketch.tool === "arrow" && curvedKind()) ghostSoon();
      else ghost();
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
    if (!far && s.tool === "arrow" && curvedKind()) {
      // A click on a curved arrow bows it the other way.
      const hit = curvedArrowAt(s.from);
      if (hit) {
        if (edit(() => flipCurvedArrow(doc, hit))) host.setStatus("Curved arrow flipped to the other side; Undo takes it back.", "success");
        return;
      }
    }
    if (!far) return host.setStatus(s.tool === "arrow" ? arrowHelp() : TOOL_HELP[s.tool], "error");
    if (s.tool === "bracket") {
      const label = valueIn.value.trim() || "n";
      const box: [number, number, number, number] = [s.from[0], s.from[1], to[0], to[1]];
      if (edit(() => addBrackets(doc, box, label))) host.setStatus(`Brackets drawn round the repeat unit, labelled ${label}.`, "success");
      return;
    }
    if (curvedKind()) {
      const electrons = arrowSel.value === "fishhook" ? 1 : 2;
      const a = snapEnd(s.from), b = snapEnd(to);
      if (edit(() => {
        const r = addCurvedArrow(doc, a, b, { electrons, flip: e.shiftKey });
        return r.ok ? null : r.reason;
      })) host.setStatus(`${arrowKind()[2]} drawn. Click it to bow it the other way; Undo takes it back.`, "success");
      return;
    }
    const kind = (arrowSel.value || "reaction") as ArrowKind;
    if (edit(() => addArrow(doc, s.from, to, kind))) host.setStatus(`${arrowKind()[2]} drawn.`, "success");
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
    if (tool === "props") {
      if (!atom && !bond) return host.setStatus("Click an atom or a bond.", "error");
      showProps(atom ? { kind: "atom", id: atom } : { kind: "bond", id: bond! });
      return;
    }
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
      } else if (nearHaptoCentre(p)) {
        // Not a new atom stacked on the η-bond's (invisible) centre (review).
        host.setStatus("That is the centre of an η-bond, not an atom — click the metal or a ring atom to change it.", "error");
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
    if (tool === "metallocene") {
      const kind = tplSel.value as MetalloceneTemplate;
      if (edit(() => addMetalloceneTemplate(doc, p, kind))) host.setStatus("Placed. Change the metal, a ligand or the bridge with the Atom tool (Hf, BH4, C, Z …); Undo takes it back.", "success");
      return;
    }
    if (tool === "hapto") {
      // A ring (an atom or bond of it) and a labelled atom, in either order.
      // A ring atom or bond, or a click anywhere inside the ring.
      // (A click near a bound ring's centre lands on its η line, which is in no ring: the ring round the point.)
      const ring = (bond ? ringThrough(doc, bond) : atom ? ringThrough(doc, atom) : null) ?? (atom ? null : ringContaining(doc, p));
      const node = atom ? findById(doc.root, atom)?.el : undefined;
      const isMetal = !!node && node.children.some((c) => c.name === "t") && !ring;
      if (!ring && !isMetal) {
        // A miss keeps the first choice (re-picking the ring after a stray click was friction — walkthrough).
        if (haptoPick) return host.setStatus(haptoPick.ring ? `Ring of ${haptoPick.ring.length} still chosen — click the metal (anywhere on its label).` : "Metal still chosen — click inside the ring.", "error");
        return host.setStatus(atom ? "That atom is in no ring and has no label — click a ring, or label the metal first (Atom tool: Zr …)." : "Click inside a ring, or on the metal.", "error");
      }
      const pick = haptoPick;
      if (!pick || (ring && pick.ring) || (isMetal && pick.metal)) {
        haptoPick = ring ? { ring } : { metal: atom! };
        return host.setStatus(ring ? `Ring of ${ring.length} chosen — now click the metal.` : "Metal chosen — now click the ring.", "");
      }
      haptoPick = null;
      const ringIds = ring ?? pick.ring!, metalId = isMetal ? atom! : pick.metal!;
      if (edit(() => {
        const r = addHapto(doc, ringIds, metalId);
        return r.ok ? null : r.reason;
      })) host.setStatus(`η${SUPER_DIGITS[ringIds.length] ?? ringIds.length}-bond drawn — Undo takes it back.`, "success");
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

  /** Fills the Properties panel from the atom or bond's attributes (as ChemDraw keeps them). */
  function showProps(t: { kind: "atom" | "bond"; id: string } | null): void {
    propTarget = t;
    const node = t ? findById(doc.root, t.id)?.el : undefined;
    if (!t || !node) {
      propTarget = null;
      atomProps.hidden = bondProps.hidden = true;
      propsWhat.textContent = "Click an atom or a bond.";
      return;
    }
    const a = node.attrs;
    atomProps.hidden = t.kind !== "atom";
    bondProps.hidden = t.kind !== "bond";
    if (t.kind === "atom") {
      const words = node.children.find((c) => c.name === "t")?.children.map((s) => s.text).join("") || "C";
      propsWhat.textContent = `Atom ${words}:`;
      radSel.value = a.Radical ?? "";
      stereoSel.value = a.EnhancedStereoType === "And" || a.EnhancedStereoType === "Or" ? a.EnhancedStereoType : "Absolute";
      groupIn.value = a.EnhancedStereoGroupNum ?? "1";
      groupIn.disabled = stereoSel.value === "Absolute";
      subSel.value = a.SubstituentsExactly !== undefined ? `e${a.SubstituentsExactly}` : a.SubstituentsUpTo !== undefined ? `u${a.SubstituentsUpTo}` : a.FreeSites === "0" ? "f0" : "";
      ringBSel.value = a.RingBondCount ?? "";
      unsatSel.value = a.UnsaturatedBonds ?? "";
      radSel.disabled = (a.NodeType ?? "Element") !== "Element";
    } else {
      const orders = (a.Order ?? "1").trim().split(/\s+/);
      const plainOrders = orders.every((o) => ["1", "2", "3", "1.5"].includes(o));
      propsWhat.textContent = plainOrders ? "Bond — may be:" : `Bond (order ${orders.join(" ")}, kept):`;
      for (const [v, box] of orderBoxes) {
        box.checked = orders.includes(v);
        box.disabled = !plainOrders;
      }
      topoSel.value = a.Topology === "Ring" || a.Topology === "Chain" ? a.Topology : "";
    }
  }
  function applyProps(): void {
    const t = propTarget;
    if (!t) return;
    if (t.kind === "atom") {
      const gnum = Number(groupIn.value);
      if (stereoSel.value !== "Absolute" && !(Number.isInteger(gnum) && gnum >= 1 && gnum <= 32)) {
        host.setStatus("A stereo group is numbered 1 to 32.", "error");
        showProps(t);
        return;
      }
      const p: AtomProps = {
        radical: radSel.disabled ? undefined : (radSel.value as AtomProps["radical"]),
        stereo: { type: stereoSel.value as "Absolute" | "And" | "Or", group: stereoSel.value === "Absolute" ? 1 : gnum },
        substituents: subSel.value as AtomProps["substituents"],
        ringBonds: ringBSel.value as AtomProps["ringBonds"],
        unsaturation: unsatSel.value as AtomProps["unsaturation"],
      };
      if (edit(() => setAtomProps(doc, t.id, p))) host.setStatus("Atom properties set — Undo takes them back.", "success");
    } else {
      const plain = !orderBoxes[0][1].disabled;
      const orders = plain ? orderBoxes.filter(([, b]) => b.checked).map(([v]) => v) : undefined;
      if (edit(() => setBondProps(doc, t.id, { orders, topology: topoSel.value as "" | "Ring" | "Chain" }))) host.setStatus("Bond properties set — Undo takes them back.", "success");
    }
    showProps(t);
  }
  for (const c of [radSel, stereoSel, groupIn, subSel, ringBSel, unsatSel, topoSel, ...orderBoxes.map(([, b]) => b)]) c.addEventListener("change", applyProps);

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
    reported = false;
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
    reported = false;
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
  const chemistry = (selectionOnly = false): { ok: true; mol: Molecule; notes: string[]; ionic?: boolean } | { ok: false; reason: string; repeatUnit?: RepeatUnit } => {
    const scope = selectionOnly && selected.size ? selected : null;
    const inScope = (id: string): boolean => !scope || scope.has(id);
    // A reaction scheme (an arrow) or a polymer (brackets) is not one structure: its parts are read one at a time.
    const arrowsIn = doc.objects.filter((o) => inScope(o.id)).flatMap((o) => o.items.flatMap((it) => (it.kind === "arrow" ? [it.v] : [])));
    if (arrowsIn.length) {
      // Reaction and equilibrium arrows make a reaction; curved, ⇒ and ↔ arrows make a mechanism or a scheme.
      const reactionOnly = arrowsIn.every((a) => !a.angularSize && a.headType !== "Angle" && (a.tailEnd === "None" || (a.shaftSpacing > 0 && a.headEnd !== "Full")));
      return {
        ok: false,
        reason: reactionOnly
          ? "a reaction (an arrow on the page) has no single formula — select one structure (Select tool) to read its formula"
          : "a page with arrows has no single formula — select one structure (Select tool) to read its formula",
      };
    }
    const bracketed = new Set(doc.brackets.flatMap((g) => g.objectIds));
    const inPolymer = doc.objects.some((o) => inScope(o.id) && o.items.some((it) => it.kind === "fragment" && it.v.nodes.some((nd) => bracketed.has(nd.id))));
    if (inPolymer) {
      // A polymer has no single formula (it is not one molecule), but its repeat unit has one: given beside the refusal,
      // which the insert path and the rest still honour.
      const unit = (() => {
        try {
          return repeatUnitOf(doc, scope ?? undefined);
        } catch {
          return null;
        }
      })();
      return {
        ok: false,
        reason: unit?.ok ? "a polymer is not one molecule — the formula is per repeat unit" : `a structure in brackets has no single formula here (${unit && !unit.ok ? unit.reason : "it could not be read"})`,
        ...(unit?.ok ? { repeatUnit: unit.unit } : {}),
      };
    }
    let r: ReturnType<typeof pageToMolecule>;
    try {
      r = pageToMolecule(doc, selectionOnly && selected.size ? selected : undefined);
    } catch (e) {
      // A structure the chemistry library cannot take is a refusal, never a crash in the pane.
      return { ok: false, reason: `the structure could not be read as chemistry (${(e as Error).message})` };
    }
    if (!r.ok) return r;
    // A page with query features or atom lists is a query structure whatever the Markush box says (clearing
    // OCL's flag would delete them).
    r.value.mol.setFragment(fragmentFlag || r.value.query);
    return { ok: true, mol: r.value.mol, notes: r.value.notes, ...(r.value.ionic ? { ionic: true } : {}) };
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
      reported = false;
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
    clean: () => {
      const scope = selected.size ? new Set(selected) : undefined;
      return edit(() => {
        // Mechanism arrows tied to the atoms Clean moves follow them.
        const tied = arrowAnchors(doc.root);
        const why = cleanStructures(doc, scope);
        if (!why) followAnchors(doc.root, tied);
        return why;
      }, true);
    },
    replacePage: (d) =>
      edit(() => {
        doc.root = d.root;
        return null;
      }),
    hasDrawing: () => doc.objects.some((o) => o.items.some((it) => it.kind !== "fragment")) || doc.brackets.length > 0,
    render: (selectionOnly) => {
      if (selectionOnly && !selected.size) return null;
      const r = renderCdx(doc, { ...(selectionOnly && selected.size ? { objects: new Set(selected) } : {}), pad: doc.style.lineWidth * 2 });
      return r ? { svg: r.svg, widthPt: r.widthPt, heightPt: r.heightPt } : null;
    },
    selection: () => new Set(selected),
    setTool,
    placeTemplate: (kind) => {
      setTool("metallocene");
      tplSel.value = kind;
      // Placed, then moved so its own left edge clears what is drawn by two bond lengths (templates reach left by
      // different amounts: an ansa bridge ran into the structure beside it — walkthrough).
      const box = contentBox();
      const ok = edit(() => {
        const page = doc.root.children.find((c) => c.name === "page");
        const before = new Set(page?.children ?? []);
        const why = addMetalloceneTemplate(doc, [0, 0], kind);
        if (why) return why;
        // Everything the template added moves together: its structure and, for a polymer, its brackets (separate
        // page objects — left behind at the drop point otherwise, walkthrough).
        const added = (page?.children ?? []).filter((c) => !before.has(c) && c.attrs.id);
        const frag = added.find((c) => c.name === "fragment");
        if (!frag) return null;
        const xs: number[] = [], ys: number[] = [];
        const walkPts = (n: XNode): void => {
          if (n.name === "n" && n.attrs.p) {
            const [px, py] = n.attrs.p.split(/\s+/).map(Number);
            xs.push(px);
            ys.push(py);
          }
          n.children.forEach(walkPts);
        };
        walkPts(frag);
        const target: Pt = box ? [box[2] + 2 * L(), (box[1] + box[3]) / 2] : [(view[0] + view[2]) / 2, (view[1] + view[3]) / 2];
        const left = Math.min(...xs), midY = (Math.min(...ys) + Math.max(...ys)) / 2, midX = (left + Math.max(...xs)) / 2;
        moveObjects(doc, added.map((c) => c.attrs.id!), box ? target[0] - left : target[0] - midX, target[1] - midY);
        return null;
      });
      if (!ok) return false;
      // In view whatever it was placed beside.
      growView(true);
      draw();
      host.setStatus("Placed. Change the metal, a ligand or the bridge with the Atom tool (Hf, BH4, C, Z …); Undo takes it back.", "success");
      return true;
    },
    setRingKind: (kind) => {
      setTool("ring");
      ringSel.value = kind;
    },
    staleNames: () => [...stale].map((id) => (findById(doc.root, id)?.el.children.filter((c) => c.name === "s").map((s) => s.text).join("") ?? "").trim()).filter(Boolean),
    wasSaved: () => saved,
    smallestTextPt: (selectionOnly) => {
      const scope = selectionOnly && selected.size ? selected : null;
      let min = Infinity;
      const runSize = (r: { text: string; size: number; face: number }): number => {
        // Sub- and superscripts (and a formula label's digits) are drawn at 75 % (cdxmlRender).
        // Formula face: per line, as cdxmlRender sets it — digits, and + / − ending the line (not trimmed).
        const shifted = (r.face & 0x60) !== 0 && (r.face & 0x60) !== 0x60 ? true : (r.face & 0x60) === 0x60 && r.text.split(/\r\n|\r|\n/).some((ln) => /\d|[+\-−]$/.test(ln));
        return shifted ? r.size * 0.75 : r.size;
      };
      // A one-line label stacked Below / Above is redrawn in its first run's style, split at the element
      // symbol (cdxmlRender drawText): measured the same way.
      const stackedRuns = (tx: CdxText | null | undefined): CdxRun[] | null => {
        if (!tx || (tx.align !== "Below" && tx.align !== "Above") || !tx.runs.length) return null;
        // Drawn on one line where its box is one line tall (cdxmlRender).
        const sz = tx.runs.reduce((m, q) => Math.max(m, q.size), 1);
        if (tx.box && tx.box[3] - tx.box[1] < sz * 1.2) return null;
        const all = tx.runs.map((q) => q.text).join("");
        const m = /^([A-Z][a-z]?)(.+)$/.exec(all);
        if (!m || /\r|\n/.test(all)) return null;
        // The style is the first run with text (the renderer drops empty runs).
        const base = tx.runs.find((q) => q.text !== "");
        if (!base) return null;
        return [{ ...base, text: m[1] }, { ...base, text: m[2] }];
      };
      // A charge ChemDraw draws as a symbol (tied by a represent element) is not set as text (cdxmlRender).
      const chargeDrawn = new Set<string>();
      for (const o of doc.objects)
        for (const it of o.items)
          if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.attribute === "Charge" && c.attrs.object) chargeDrawn.add(c.attrs.object);
      for (const o of doc.objects) {
        if (scope && !scope.has(o.id)) continue;
        for (const it of o.items) {
          if (it.kind === "text") for (const r of it.v.runs) if (r.text.trim()) min = Math.min(min, runSize(r));
          if (it.kind === "fragment" && it.v.bonds.some((bd) => showsMarks(bd.el.attrs, doc.root.attrs, "ShowBondQuery") && bondQueryMarks(bd.el.attrs).length)) min = Math.min(min, doc.style.labelSize * 0.75);
          if (it.kind === "fragment")
            for (const nd of it.v.nodes) {
              for (const r of stackedRuns(nd.label) ?? nd.label?.runs ?? []) if (r.text.trim()) min = Math.min(min, runSize(r));
              if (nd.charge && !chargeDrawn.has(nd.id)) min = Math.min(min, doc.style.labelSize * 0.75);
              // Stereo-group labels (&1, or1) and query marks are drawn at 75 % of the label size.
              if ((showsMarks(nd.el.attrs, doc.root.attrs, "ShowAtomEnhancedStereo") && stereoGroupMark(nd.el.attrs)) || (showsMarks(nd.el.attrs, doc.root.attrs, "ShowAtomQuery") && atomQueryMarks(nd.el.attrs).length)) min = Math.min(min, doc.style.labelSize * 0.75);
            }
        }
      }
      return Number.isFinite(min) ? min : null;
    },
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
