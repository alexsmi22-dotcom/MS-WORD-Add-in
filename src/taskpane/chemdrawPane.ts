/**
 * Open ChemDraw file… in the structure Draw tab (docs/SCOPE-CHEMDRAW.md, C1 + C2): a CDXML document
 * shown as ChemDraw draws it; a click picks a structure with its brackets, labels and charges
 * (cdxmlSelect); the editing tools change the document itself (cdxmlEdit), so what is drawn is what
 * Save as .cdxml writes and ChemDraw opens again; Insert puts the selection — or the whole page —
 * into Word at ChemDraw's own size. The file is read on this machine and nothing of it leaves it.
 */
import { readCdxml, readCdxmlTree, CdxDoc, Box, Pt } from "../lib/cdxml";
import { readCdx } from "../lib/cdx";
import { renderCdx } from "../lib/cdxmlRender";
import { atomAt, bondAt, captionAt, objectAt, objectBoxes, withCompanions } from "../lib/cdxmlSelect";
import { addBondFrom, cloneTree, deleteInStructure, deleteObjects, findById, moveObjects, namesTiedTo, setAtomLabel, setBond, setCharge, setText, writeCdxml } from "../lib/cdxmlEdit";
import type { XNode } from "../lib/xmlLite";

export interface ChemdrawHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** Inserts an SVG as a picture (pixels at 96 per inch). */
  insertPicture(svg: string, widthPx: number, heightPx: number, alt: string): Promise<void>;
  /** Saves a file for the user (Save as .cdxml). */
  downloadFile?(blob: Blob, name: string): void;
}

/** Room on a Word page for a picture: 6.5 × 9 in, in points. */
export const PAGE_PT = { w: 468, h: 648 };
/** Below this fraction of ChemDraw's size a structure is too small to read: refused, not shrunk. */
export const MIN_FIT = 0.25;
const PX_PER_PT = 96 / 72;
export const CHEMDRAW_MAX_BYTES = 40 * 1024 * 1024;
const UNDO_DEPTH = 50;

/** A picked file's bytes → the document, or a refusal naming the file and the way to read it. */
export function openChemdrawFile(name: string, bytes: Uint8Array): { ok: true; doc: CdxDoc } | { ok: false; reason: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  // A binary ChemDraw file is known by its first bytes, whatever it is called.
  if (magic === "VjCD0100") {
    if (bytes.length > CHEMDRAW_MAX_BYTES) return { ok: false, reason: `${name}: the file is ${Math.ceil((bytes.length / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB` };
    const b = readCdx(bytes);
    if (!b.ok) return { ok: false, reason: `${name}: ${b.reason}` };
    const r = readCdxmlTree(b.root);
    if (!r.ok) return { ok: false, reason: `${name}: ${r.reason}` };
    r.doc.notes = [...b.notes.map((n) => `${n} (in the .cdx)`), ...r.doc.notes];
    if (!r.doc.objects.length) return { ok: false, reason: `${name}: the page has nothing drawn on it` };
    return r;
  }
  if (ext === "cdx") return { ok: false, reason: `${name}: it is not a ChemDraw CDX file (it does not start with VjCD0100)` };
  if (ext !== "cdxml" && ext !== "xml") return { ok: false, reason: `${name}: this opens ChemDraw files (.cdx and .cdxml)` };
  if (bytes.length > CHEMDRAW_MAX_BYTES) return { ok: false, reason: `${name}: the file is ${Math.ceil((bytes.length / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB` };
  const r = readCdxml(new TextDecoder("utf-8").decode(bytes));
  if (!r.ok) return { ok: false, reason: `${name}: ${r.reason}` };
  if (!r.doc.objects.length) return { ok: false, reason: `${name}: the page has nothing drawn on it` };
  return r;
}

/** How a set of objects goes into Word: the factor that fits it on the page (1 = ChemDraw's size), or a refusal. */
export function chemdrawFit(widthPt: number, heightPt: number): { ok: true; k: number; note: string } | { ok: false; reason: string } {
  const k = Math.min(1, PAGE_PT.w / widthPt, PAGE_PT.h / heightPt);
  if (k < MIN_FIT) {
    return {
      ok: false,
      reason: `that is ${(widthPt / 72).toFixed(1)} × ${(heightPt / 72).toFixed(1)} in — on a page it would be drawn at ${Math.round(k * 100)} %, too small to read. Select fewer structures (click one, Shift+click to add)`,
    };
  }
  return { ok: true, k, note: k < 1 ? `It is inserted at ${Math.round(k * 100)} % to fit the page.` : "It is inserted at ChemDraw's size." };
}

type Tool = "select" | "atom" | "bond" | "add" | "charge+" | "charge-" | "text" | "erase";
const TOOL_HELP: Record<Tool, string> = {
  select: "Select: click a structure (with its brackets, labels and charges); Shift+click adds or removes; drag a selection to move it.",
  atom: "Atom: type an element or label (N, O, Cl, R1, X …) in the box, then click atoms.",
  bond: "Bond: click a bond to make it single → double → triple; choose a style to wedge, hash or wave it instead.",
  add: "Add bond: click an atom to draw a new bond from it.",
  "charge+": "Charge +: click an atom to raise its charge by one.",
  "charge-": "Charge −: click an atom to lower its charge by one.",
  text: "Text: type the new words in the box, then click a caption or name.",
  erase: "Erase: click an atom or bond to remove it, or anything else on the page.",
};

export function initChemdrawPane(host: ChemdrawHost): void {
  const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
  const openBtn = $<HTMLButtonElement>("chemdraw-open");
  const fileIn = $<HTMLInputElement>("chemdraw-file");
  const panel = $<HTMLElement>("chemdraw-panel");
  const info = $<HTMLElement>("chemdraw-info");
  const preview = $<HTMLElement>("chemdraw-preview");
  const insertBtn = $<HTMLButtonElement>("chemdraw-insert");
  const insertAllBtn = $<HTMLButtonElement>("chemdraw-insert-all");
  const closeBtn = $<HTMLButtonElement>("chemdraw-close");
  const zoomSel = $<HTMLSelectElement>("chemdraw-zoom");
  const toolBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-cdx-tool]"));
  const valueIn = $<HTMLInputElement>("chemdraw-value");
  const styleSel = $<HTMLSelectElement>("chemdraw-bondstyle");
  const undoBtn = $<HTMLButtonElement>("chemdraw-undo");
  const redoBtn = $<HTMLButtonElement>("chemdraw-redo");
  const saveBtn = $<HTMLButtonElement>("chemdraw-save");
  if (!openBtn || !fileIn || !panel || !info || !preview || !insertBtn || !insertAllBtn || !closeBtn) return;

  let doc: CdxDoc | null = null;
  let name = "";
  let boxes = new Map<string, Box>();
  let selected = new Set<string>();
  let view: Box = [0, 0, 1, 1];
  let inserting = false;
  let tool: Tool = "select";
  let undo: XNode[] = [];
  let redo: XNode[] = [];
  /** Names ChemDraw computed from structures changed since (text object ids). */
  let stale = new Set<string>();

  const setButtons = (): void => {
    insertBtn.disabled = inserting || !selected.size;
    insertAllBtn.disabled = inserting || !doc;
    openBtn.disabled = inserting;
    closeBtn.disabled = inserting;
    if (undoBtn) undoBtn.disabled = !undo.length;
    if (redoBtn) redoBtn.disabled = !redo.length;
    if (saveBtn) saveBtn.disabled = !doc;
  };
  const outline = (ids: Iterable<string>, stroke: string, fill: string, groupId: string): void => {
    const svg = preview.querySelector("svg");
    if (!svg || !doc) return;
    svg.querySelector("#" + groupId)?.remove();
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", groupId);
    const pad = doc.style.bondLength * 0.15;
    for (const id of ids) {
      const b = boxes.get(id) ?? textBox(id);
      if (!b) continue;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(b[0] - pad));
      r.setAttribute("y", String(b[1] - pad));
      r.setAttribute("width", String(b[2] - b[0] + 2 * pad));
      r.setAttribute("height", String(b[3] - b[1] + 2 * pad));
      r.setAttribute("fill", fill);
      r.setAttribute("stroke", stroke);
      r.setAttribute("stroke-width", String(Math.max(0.6, pad * 0.25)));
      g.appendChild(r);
    }
    svg.appendChild(g);
  };
  /** A text object's box (a name can sit inside a group, so it may have no box of its own in `boxes`). */
  const textBox = (id: string): Box | null => {
    for (const o of doc?.objects ?? []) for (const it of o.items) if (it.kind === "text" && it.v.id === id) return it.v.box;
    return null;
  };
  const paintMarks = (): void => {
    outline(selected, "#2563eb", "rgba(37,99,235,0.08)", "chemdraw-sel");
    outline(stale, "#d97706", "rgba(217,119,6,0.10)", "chemdraw-stale");
  };
  const applyZoom = (): void => {
    const svg = preview.querySelector("svg");
    if (!svg) return;
    const z = Number(zoomSel?.value ?? "1") || 1;
    svg.setAttribute("width", `${Math.round(z * 100)}%`);
    svg.removeAttribute("height");
  };
  const show = (): void => {
    panel.hidden = !doc;
    if (!doc) {
      preview.textContent = "";
      setButtons();
      return;
    }
    const r = renderCdx(doc, { pad: 6 });
    if (!r) {
      preview.textContent = "";
      info.textContent = `${name}: the page is empty.`;
      setButtons();
      return;
    }
    const vb = /viewBox="([^"]+)"/.exec(r.svg)![1].split(" ").map(Number);
    view = [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
    preview.innerHTML = r.svg;
    applyZoom();
    paintMarks();
    const structures = doc.objects.filter((o) => o.items.some((it) => it.kind === "fragment")).length;
    info.textContent = [
      `${name}: ${structures} structure${structures === 1 ? "" : "s"} and ${doc.objects.length - structures} other object${doc.objects.length - structures === 1 ? "" : "s"}${doc.program ? ` (made by ${doc.program})` : ""}.`,
      ...doc.notes.map((n) => `Not shown: ${n}.`),
      ...(stale.size ? [`${stale.size} name${stale.size === 1 ? "" : "s"} ChemDraw computed ${stale.size === 1 ? "is" : "are"} outlined in orange: the structure changed since — check or edit ${stale.size === 1 ? "it" : "them"} (Text tool).`] : []),
    ].join(" ");
    setButtons();
  };
  /** After an edit: read the tree again, keep the selection that still exists, redraw. */
  const reread = (): void => {
    if (!doc) return;
    const r = readCdxmlTree(doc.root);
    if (!r.ok) {
      // Back to the state before the edit (its undo step), and say so.
      if (undo.length) doc.root = undo.pop()!;
      host.setStatus(`The edit left the document unreadable (${r.reason}) — it was undone.`, "error");
      const again = readCdxmlTree(doc.root);
      if (!again.ok) return;
      doc = again.doc;
    } else doc = r.doc;
    boxes = objectBoxes(doc);
    selected = new Set([...selected].filter((id) => boxes.has(id)));
    stale = new Set([...stale].filter((id) => !!findById(doc!.root, id)));
    show();
  };
  /** Runs an edit with an undo step; a refusal (string) leaves the document as it was. */
  const edit = (f: () => string | null, changed: string[] = []): boolean => {
    if (!doc) return false;
    const before = cloneTree(doc.root);
    const why = f();
    if (why) {
      doc.root = before;
      host.setStatus(why.charAt(0).toUpperCase() + why.slice(1) + ".", "error");
      return false;
    }
    undo.push(before);
    if (undo.length > UNDO_DEPTH) undo.shift();
    redo = [];
    // Names ChemDraw computed from a changed structure no longer describe it.
    for (const id of namesTiedTo(doc, changed)) stale.add(id);
    reread();
    return true;
  };
  /** The top-level object (structure) holding an atom or bond. */
  const objectHolding = (innerId: string): string | null => {
    for (const o of doc?.objects ?? [])
      for (const it of o.items) if (it.kind === "fragment" && (it.v.nodes.some((n) => n.id === innerId) || it.v.bonds.some((b) => b.id === innerId))) return o.id;
    return null;
  };

  const setTool = (t: Tool): void => {
    tool = t;
    for (const b of toolBtns) {
      const on = b.dataset.cdxTool === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    // The box and the style list keep their place (switching tools must not move the page under the mouse).
    if (valueIn) {
      valueIn.disabled = t !== "atom" && t !== "text";
      valueIn.placeholder = t === "atom" ? "Element or label, e.g. N, Cl, R1" : t === "text" ? "New words for a caption or name" : "(Atom and Text tools)";
    }
    if (styleSel) styleSel.disabled = t !== "bond";
    host.setStatus(TOOL_HELP[t], "");
  };
  for (const b of toolBtns) b.addEventListener("click", () => setTool(b.dataset.cdxTool as Tool));

  openBtn.addEventListener("click", () => {
    if (inserting) return;
    fileIn.value = ""; // the same file picked again still opens
    fileIn.click();
  });
  fileIn.addEventListener("change", () => {
    const file = fileIn.files?.[0];
    if (!file) return;
    if (file.size > CHEMDRAW_MAX_BYTES) return host.setStatus(`${file.name}: the file is ${Math.ceil((file.size / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB`, "error");
    host.setStatus(`Reading ${file.name}…`, "");
    const reader = new FileReader();
    reader.onerror = () => host.setStatus(`Could not read ${file.name}.`, "error");
    reader.onload = () => {
      // Yield once so "Reading…" is painted before a large file is drawn.
      window.setTimeout(() => {
        const r = openChemdrawFile(file.name, new Uint8Array(reader.result as ArrayBuffer));
        if (!r.ok) return host.setStatus(r.reason, "error");
        doc = r.doc;
        name = file.name;
        boxes = objectBoxes(doc);
        selected = new Set();
        undo = [];
        redo = [];
        stale = new Set();
        setTool("select");
        show();
        host.setStatus(`${file.name} opened — click a structure to select it (with its brackets, labels and charges), then Insert selected; the tools above the page edit it.`, "success");
      }, 0);
    };
    reader.readAsArrayBuffer(file);
  });
  zoomSel?.addEventListener("change", applyZoom);

  /** The page point under the mouse. */
  const pagePoint = (e: MouseEvent): Pt | null => {
    const svg = preview.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width) return null;
    const k = (view[2] - view[0]) / r.width;
    return [view[0] + (e.clientX - r.left) * k, view[1] + (e.clientY - r.top) * k];
  };

  // Select / move: a drag that starts on the selection moves it; a click picks.
  let drag: { from: Pt; moved: boolean } | null = null;
  preview.addEventListener("pointerdown", (e) => {
    if (!doc || tool !== "select" || e.button !== 0) return;
    const p = pagePoint(e);
    if (!p) return;
    const id = objectAt(doc, boxes, p, doc.style.bondLength * 0.3);
    if (id && selected.has(id) && !e.shiftKey) {
      drag = { from: p, moved: false };
      preview.setPointerCapture?.(e.pointerId);
    }
  });
  preview.addEventListener("pointermove", (e) => {
    if (!drag || !doc) return;
    const p = pagePoint(e);
    if (!p) return;
    const dx = p[0] - drag.from[0], dy = p[1] - drag.from[1];
    if (Math.hypot(dx, dy) > doc.style.bondLength * 0.1) drag.moved = true;
    const g = preview.querySelector("#chemdraw-sel");
    g?.setAttribute("transform", `translate(${dx} ${dy})`);
  });
  preview.addEventListener("pointerup", (e) => {
    if (!drag || !doc) return;
    const d = drag;
    drag = null;
    const p = pagePoint(e);
    if (!d.moved || !p) return;
    const ids = [...selected];
    edit(() => (moveObjects(doc!, ids, p[0] - d.from[0], p[1] - d.from[1]), null));
    suppressClick = true;
  });
  let suppressClick = false;

  preview.addEventListener("pointercancel", () => {
    drag = null;
    preview.querySelector("#chemdraw-sel")?.removeAttribute("transform");
  });
  preview.addEventListener("click", (e) => {
    preview.focus({ preventScroll: true });
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!doc) return;
    const p = pagePoint(e);
    if (!p) return;
    const L = doc.style.bondLength;
    if (tool === "select") {
      const id = objectAt(doc, boxes, p, L * 0.3);
      if (!id) {
        if (!e.shiftKey) selected = new Set();
      } else if (e.shiftKey) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else selected = withCompanions(doc, boxes, id);
      paintMarks();
      setButtons();
      return;
    }
    const atom = atomAt(doc, p, L * 0.3);
    const bond = atom ? null : bondAt(doc, p, L * 0.2);
    if (tool === "atom" || tool === "add" || tool === "charge+" || tool === "charge-") {
      if (!atom) return host.setStatus("Click on an atom (a corner or end of the structure, or a label).", "error");
      const holder = objectHolding(atom) ?? "";
      if (tool === "atom") {
        const v = (valueIn?.value ?? "").trim();
        if (!v) {
          valueIn?.focus();
          return host.setStatus("Type an element or label in the box first (N, O, Cl, R1, X …), then click the atom.", "error");
        }
        let note: string | null = null;
        if (edit(() => {
          const r = setAtomLabel(doc!, atom, v);
          if (!r.ok) return r.reason;
          note = r.note;
          return null;
        }, [holder])) host.setStatus(note ?? `Atom set to ${v}.`, note ? "" : "success");
      } else if (tool === "add") edit(() => {
        const r = addBondFrom(doc!, atom);
        return r.ok ? null : r.reason;
      }, [holder]);
      else {
        const n = findById(doc.root, atom)?.el;
        const q = (Number(n?.attrs.Charge ?? 0) || 0) + (tool === "charge+" ? 1 : -1);
        edit(() => setCharge(doc!, atom, q), [holder]);
      }
      return;
    }
    if (tool === "bond") {
      if (!bond) return host.setStatus("Click on a bond.", "error");
      const holder = objectHolding(bond) ?? "";
      const style = styleSel?.value ?? "";
      if (style) {
        // A stereo style clicked again on the same bond turns it round (narrow end to the other atom).
        const b = findById(doc.root, bond)?.el;
        const flip = !!b && (b.attrs.Display ?? "Solid") === style && /Wedge/.test(style);
        edit(() => setBond(doc!, bond, flip ? { flip: true } : { display: style, order: "1" }), [holder]);
      } else {
        const order = findById(doc.root, bond)?.el.attrs.Order ?? "1";
        const next = order === "1" ? "2" : order === "2" ? "3" : "1";
        edit(() => setBond(doc!, bond, { order: next, display: "Solid" }), [holder]);
      }
      return;
    }
    if (tool === "text") {
      const v = valueIn?.value ?? "";
      const tid = captionAt(doc, p, L * 0.15);
      if (!tid) return host.setStatus("Click on a caption or name to change its words.", "error");
      if (!v.trim()) {
        valueIn?.focus();
        return host.setStatus("Type the new words in the box first, then click the caption.", "error");
      }
      if (edit(() => setText(doc!, tid, v))) {
        stale.delete(tid);
        reread();
      }
      return;
    }
    if (tool === "erase") {
      if (atom || bond) {
        const id = (atom ?? bond)!;
        edit(() => deleteInStructure(doc!, id), [objectHolding(id) ?? ""]);
        return;
      }
      const id = objectAt(doc, boxes, p, L * 0.3);
      if (!id) return host.setStatus("Nothing to erase there.", "error");
      edit(() => (deleteObjects(doc!, [id]), null), [id]);
    }
  });

  // Keys act only on the page itself (it takes focus when clicked): Delete pressed in the structure
  // canvas beside it, or in another tool, must never reach this document.
  preview.tabIndex = 0;
  preview.addEventListener("keydown", (e) => {
    if (!doc || panel.hidden) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
      const ids = [...selected];
      if (edit(() => (deleteObjects(doc!, ids), null), ids)) selected = new Set();
      e.preventDefault();
    } else if (e.key === "Escape") setTool("select");
  });
  undoBtn?.addEventListener("click", () => {
    if (!doc || !undo.length) return;
    redo.push(cloneTree(doc.root));
    doc.root = undo.pop()!;
    reread();
  });
  redoBtn?.addEventListener("click", () => {
    if (!doc || !redo.length) return;
    undo.push(cloneTree(doc.root));
    doc.root = redo.pop()!;
    reread();
  });
  saveBtn?.addEventListener("click", () => {
    if (!doc || !host.downloadFile) return;
    const out = name.replace(/\.(cdxml|cdx|xml)$/i, "") + (undo.length ? " (edited)" : "") + ".cdxml";
    host.downloadFile(new Blob([writeCdxml(doc.root)], { type: "chemical/x-cdxml" }), out);
    host.setStatus(`Saved ${out} — it opens in ChemDraw.`, "success");
  });

  const insert = async (ids: Set<string> | null): Promise<void> => {
    if (!doc || inserting) return;
    const r = renderCdx(doc, { ...(ids ? { objects: ids } : {}), pad: doc.style.lineWidth * 2 });
    if (!r) return host.setStatus("Nothing is selected to insert.", "error");
    const fit = chemdrawFit(r.widthPt, r.heightPt);
    if (!fit.ok) return host.setStatus(`${ids ? "The selection" : "The whole page"}: ${fit.reason}.`, "error");
    // A name ChemDraw computed before the structure changed is said, by its words.
    const staleIn = [...stale].filter((id) => !ids || [...ids].some((o) => findById(findById(doc!.root, o)?.el ?? doc!.root, id)));
    const staleWords = staleIn.map((id) => (findById(doc!.root, id)?.el.children.filter((c) => c.name === "s").map((s) => s.text).join("") ?? "").trim()).filter(Boolean);
    const what = ids ? `${ids.size} object${ids.size === 1 ? "" : "s"}` : "the whole page";
    const alt = `ChemDraw drawing from ${name} (${what}).`;
    inserting = true;
    setButtons();
    try {
      await host.insertPicture(r.svg, r.widthPt * PX_PER_PT * fit.k, r.heightPt * PX_PER_PT * fit.k, alt);
      const warn = staleWords.length ? ` Check ${staleWords.map((w) => `“${w}”`).join(", ")}: ChemDraw computed ${staleWords.length === 1 ? "that name" : "those names"} before the structure changed.` : "";
      host.setStatus(`Inserted ${what} from ${name}. ${fit.note}${warn}`, warn ? "" : "success");
    } catch (err) {
      host.setStatus(`Could not insert the drawing: ${(err as Error).message}`, "error");
    } finally {
      inserting = false;
      setButtons();
    }
  };
  insertBtn.addEventListener("click", () => void insert(new Set(selected)));
  insertAllBtn.addEventListener("click", () => void insert(null));
  closeBtn.addEventListener("click", () => {
    if (inserting) return;
    doc = null;
    selected = new Set();
    show();
  });
}
