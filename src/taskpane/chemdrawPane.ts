/**
 * Open ChemDraw file… in the structure Draw tab (docs/SCOPE-CHEMDRAW.md, C1): a CDXML document shown
 * as ChemDraw draws it; a click picks a structure with its brackets, labels and charges (cdxmlSelect),
 * and it — or the whole page — goes into Word as a picture at ChemDraw's own size. The file is read
 * on this machine and nothing of it leaves it.
 */
import { readCdxml, CdxDoc, Box, Pt } from "../lib/cdxml";
import { renderCdx } from "../lib/cdxmlRender";
import { objectAt, objectBoxes, withCompanions } from "../lib/cdxmlSelect";

export interface ChemdrawHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** Inserts an SVG as a picture (pixels at 96 per inch). */
  insertPicture(svg: string, widthPx: number, heightPx: number, alt: string): Promise<void>;
}

/** Room on a Word page for a picture: 6.5 × 9 in, in points. */
export const PAGE_PT = { w: 468, h: 648 };
/** Below this fraction of ChemDraw's size a structure is too small to read: refused, not shrunk. */
export const MIN_FIT = 0.25;
const PX_PER_PT = 96 / 72;
export const CHEMDRAW_MAX_BYTES = 40 * 1024 * 1024;

/** A picked file's bytes → the document, or a refusal naming the file and the way to read it. */
export function openChemdrawFile(name: string, bytes: Uint8Array): { ok: true; doc: CdxDoc } | { ok: false; reason: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (ext === "cdx" || magic === "VjCD0100")
    return { ok: false, reason: `${name}: binary ChemDraw files (.cdx) are not read yet — in ChemDraw, use File ▸ Save As ▸ ChemDraw XML (.cdxml) and open that` };
  if (ext !== "cdxml" && ext !== "xml") return { ok: false, reason: `${name}: this opens ChemDraw XML files (.cdxml)` };
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
  if (!openBtn || !fileIn || !panel || !info || !preview || !insertBtn || !insertAllBtn || !closeBtn) return;

  let doc: CdxDoc | null = null;
  let name = "";
  let boxes = new Map<string, Box>();
  let selected = new Set<string>();
  let view: Box = [0, 0, 1, 1];
  let inserting = false;

  const setButtons = (): void => {
    insertBtn.disabled = inserting || !selected.size;
    insertAllBtn.disabled = inserting || !doc;
    openBtn.disabled = inserting;
    closeBtn.disabled = inserting;
  };
  /** The selection as outlines over the page. */
  const paintSelection = (): void => {
    const svg = preview.querySelector("svg");
    if (!svg) return;
    svg.querySelector("#chemdraw-sel")?.remove();
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", "chemdraw-sel");
    const pad = doc ? doc.style.bondLength * 0.15 : 3;
    for (const id of selected) {
      const b = boxes.get(id);
      if (!b) continue;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(b[0] - pad));
      r.setAttribute("y", String(b[1] - pad));
      r.setAttribute("width", String(b[2] - b[0] + 2 * pad));
      r.setAttribute("height", String(b[3] - b[1] + 2 * pad));
      r.setAttribute("fill", "rgba(37,99,235,0.08)");
      r.setAttribute("stroke", "#2563eb");
      r.setAttribute("stroke-width", String(Math.max(0.6, pad * 0.25)));
      g.appendChild(r);
    }
    svg.appendChild(g);
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
      return;
    }
    const r = renderCdx(doc, { pad: 6 });
    if (!r) return;
    const vb = /viewBox="([^"]+)"/.exec(r.svg)![1].split(" ").map(Number);
    view = [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
    preview.innerHTML = r.svg;
    applyZoom();
    paintSelection();
    const structures = doc.objects.filter((o) => o.items.some((it) => it.kind === "fragment")).length;
    info.textContent = [
      `${name}: ${structures} structure${structures === 1 ? "" : "s"} and ${doc.objects.length - structures} other object${doc.objects.length - structures === 1 ? "" : "s"}${doc.program ? ` (made by ${doc.program})` : ""}.`,
      ...doc.notes.map((n) => `Not shown: ${n}.`),
    ].join(" ");
    setButtons();
  };

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
        show();
        host.setStatus(`${file.name} opened — click a structure to select it (with its brackets, labels and charges), then Insert selected.`, "success");
      }, 0);
    };
    reader.readAsArrayBuffer(file);
  });
  zoomSel?.addEventListener("change", applyZoom);

  preview.addEventListener("click", (e) => {
    const svg = preview.querySelector("svg");
    if (!doc || !svg) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const k = (view[2] - view[0]) / r.width;
    const p: Pt = [view[0] + (e.clientX - r.left) * k, view[1] + (e.clientY - r.top) * k];
    const id = objectAt(doc, boxes, p, doc.style.bondLength * 0.3);
    if (!id) {
      if (!e.shiftKey) selected = new Set();
    } else if (e.shiftKey) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else selected = withCompanions(doc, boxes, id);
    paintSelection();
    setButtons();
  });

  const insert = async (ids: Set<string> | null): Promise<void> => {
    if (!doc || inserting) return;
    const r = renderCdx(doc, { ...(ids ? { objects: ids } : {}), pad: doc.style.lineWidth * 2 });
    if (!r) return host.setStatus("Nothing is selected to insert.", "error");
    const fit = chemdrawFit(r.widthPt, r.heightPt);
    if (!fit.ok) return host.setStatus(`${ids ? "The selection" : "The whole page"}: ${fit.reason}.`, "error");
    const what = ids ? `${ids.size} object${ids.size === 1 ? "" : "s"}` : "the whole page";
    const alt = `ChemDraw drawing from ${name} (${what}).`;
    inserting = true;
    setButtons();
    try {
      await host.insertPicture(r.svg, r.widthPt * PX_PER_PT * fit.k, r.heightPt * PX_PER_PT * fit.k, alt);
      host.setStatus(`Inserted ${what} from ${name}. ${fit.note}`, "success");
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
