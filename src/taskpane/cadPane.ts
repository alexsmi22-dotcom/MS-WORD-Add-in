/* global document, HTMLElement, HTMLButtonElement, HTMLSelectElement, HTMLInputElement, HTMLCanvasElement, window */
/**
 * The Drawing (CAD) mode's controller (docs/SCOPE-CAD-CANVAS.md R1b).
 *
 * Built the way the chemical builder is: the model, the views, the sheet and
 * every refusal are decided in tested src/lib modules (cadShapes, cadModel,
 * cadLines, cadSheet, cadPreview, cadStandards); this file only wires the DOM.
 * It holds no Word code — the pane hands it `insertPicture`, which goes through
 * docHost like every other insert.
 *
 * The canvas orbits like the 3D molecule view: drag to turn, wheel to zoom,
 * click a part to edit it, or (with "Add callout" on) click a surface to
 * anchor a reference numeral / balloon there. While dragging it paints cheap
 * shading; when the drag ends it overlays the exact line drawing, and the
 * sheet below is what will be inserted.
 */
import { tessellate, Mesh } from "../lib/cadModel";
import { drawLines, STANDARD_VIEWS, CadView } from "../lib/cadLines";
import { fitView, previewOps, paintPreview, pickAt, orbit, Fit } from "../lib/cadPreview";
import { layoutSheet, ViewSpec } from "../lib/cadSheet";
import { DRAWING_STANDARDS, DEFAULT_STANDARD, StandardId } from "../lib/cadStandards";
import {
  SHAPES,
  SHAPE_IDS,
  ShapeId,
  CadDoc,
  CadPart,
  attachCallout,
  defaultParams,
  docToAssembly,
  overlapNotes,
  parseDoc,
  partProblems,
  resolveCallouts,
  shapeName,
  serializeDoc,
  starterDoc,
} from "../lib/cadShapes";
import { SWITCHABLE_LAYERS, type Callout } from "../lib/cadSheet";
import { checkTitleFields, SHEET_SIZES, SheetSizeId, sheetRefusal, sheetsFor, TitleFieldId, titleFieldsFor, TitleValues } from "../lib/cadFormats";
import { lineTypesFor } from "../lib/cadLineTypes";

/**
 * Engineering sheets go into Word fitted to a page's text column (PRODUCT: 159 × 229 mm fits
 * both Letter and A4 with 1-inch margins); the true-size sheet is the SVG download. The stated
 * scale holds on the sheet's own paper size, and the status and alt text say so.
 */
export const FIT_MM = { w: 159, h: 229 };
import { initSketchPanel } from "./sketchPane";

export interface CadPaneHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** The next free reference numeral from the document's Numerals table (patent callouts). */
  nextNumeral(taken: number[]): number;
  /** Inserts the sheet SVG as a picture at the cursor (rasterised by the pane at its physical size). */
  insertPicture(svg: string, widthPx: number, heightPx: number, alt: string): Promise<void>;
  /** The alt text of the selected picture (null = none selected), to re-open a drawing. Absent in the pop-out window, which cannot read the document. */
  readSelectedAlt?(): Promise<string | null>;
  /**
   * Opens the large canvas on this model (serializeDoc) and resolves with what it hands back:
   * the model, and whether the user pressed Insert there. Null = closed or cancelled. Absent
   * in the pop-out itself.
   */
  openLarge?(docJson: string, opts?: { sketch?: string }): Promise<{ doc: string; insert: boolean } | null>;
  /** Whether the large window can open here (Office dialogs supported); absent = assume it can. */
  largeAvailable?(): boolean;
  /** A sketch was closed: kept (Done) or not (Cancel). The large window, opened to sketch, returns on it. */
  sketchClosed?(kept: boolean): void;
  /** Downloads the sheet as a PowerPoint slide. Absent in the pop-out (a dialog cannot save files). */
  exportPpt?(svg: string, widthPx: number, heightPx: number, title: string): Promise<void>;
  /** Saves a file to the user's downloads (the true-size sheet SVG). Absent in the pop-out. */
  downloadFile?(blob: Blob, name: string): void;
}

export interface CadPaneApi {
  /** Builds on first show; rebuilds after. */
  show(): void;
  /** Loads a saved model (serializeDoc); returns the reason it was refused, or null. */
  load(json: string): string | null;
  /** The model as it stands (serializeDoc). */
  getDoc(): string;
  /** Inserts the current sheet, as the Insert button does. */
  insert(): Promise<void>;
  /** A sketch is open (its edits are not in the drawing yet). */
  isSketching(): boolean;
  /** Opens the sketch editor here on a part (by id), or on a new part (null). */
  startSketch(partId: string | null): void;
}

/** The model stored in a drawing's alt text ("… Model: {json}"), or null. */
export function modelFromAlt(alt: string): string | null {
  // The FIRST "Model: ": what comes before it is the pane's own words, while the model after it may
  // carry the words "Model: " in a part name or a title block field.
  const at = alt.indexOf("Model: ");
  return at < 0 ? null : alt.slice(at + "Model: ".length).trim();
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Millimetres as the pane shows them: up to two decimals, no trailing zeros. */
const fmtMm = (v: number): string => String(+v.toFixed(2));

/**
 * How an engineering sheet goes into Word: the factor that fits it to the page (1 = as drawn)
 * and the sentence that says what the stated scale then means. Patent, journal and plain
 * figures are sized by their own rules and go in as drawn.
 */
export function fitNote(sheet: { standard: StandardId; wMm: number; hMm: number; sizeName?: string; scale: number }): { k: number; note: string } {
  const engineering = sheet.standard === "asme" || sheet.standard === "iso";
  const k = engineering ? Math.min(1, FIT_MM.w / sheet.wMm, FIT_MM.h / sheet.hMm) : 1;
  if (k >= 1) return { k: 1, note: "" };
  const pct = Math.round(k * 100);
  const scale = sheet.scale >= 1 ? `${+sheet.scale.toFixed(3)}:1` : `1:${+(1 / sheet.scale).toFixed(3)}`;
  return sheet.sizeName
    ? { k, note: `The ${sheet.sizeName} sheet is inserted at ${pct} % to fit the page; SCALE ${scale} holds when it is printed on ${sheet.sizeName}.` }
    : { k, note: `The drawing is inserted at ${pct} % to fit the page; SCALE ${scale} holds at full size (${fmtMm(sheet.wMm)} mm wide).` };
}

export function initCadPane(host: CadPaneHost, initial?: CadDoc): CadPaneApi {
  const standardSel = el<HTMLSelectElement>("cad-standard");
  const shapeSel = el<HTMLSelectElement>("cad-shape");
  const addBtn = el<HTMLButtonElement>("cad-add");
  const partsEl = el<HTMLElement>("cad-parts");
  const editorEl = el<HTMLElement>("cad-editor");
  const canvas = el<HTMLCanvasElement>("cad-canvas");
  const calloutBtn = el<HTMLButtonElement>("cad-callout");
  const calloutsEl = el<HTMLElement>("cad-callouts");
  const viewsEl = el<HTMLElement>("cad-views");
  const msgEl = el<HTMLElement>("cad-msg");
  const previewEl = el<HTMLElement>("cad-preview");
  const insertBtn = el<HTMLButtonElement>("cad-insert");
  const hiddenSel = el<HTMLSelectElement>("cad-hidden");
  const openBtn = el<HTMLButtonElement>("cad-open");
  const newBtn = el<HTMLButtonElement>("cad-new") as HTMLButtonElement | null;
  const pptBtn = el<HTMLButtonElement>("cad-ppt") as HTMLButtonElement | null;
  if (pptBtn && !host.exportPpt) pptBtn.hidden = true;
  const popBtn = el<HTMLButtonElement>("cad-popout") as HTMLButtonElement | null;
  // R2b: the sheet format, title block, layers and line types.
  const sheetSel = el<HTMLSelectElement>("cad-sheet") as HTMLSelectElement | null;
  const orientSel = el<HTMLSelectElement>("cad-orient") as HTMLSelectElement | null;
  const tbWrap = el<HTMLElement>("cad-titleblock-wrap") as HTMLElement | null;
  const tbEl = el<HTMLElement>("cad-titleblock") as HTMLElement | null;
  const layersEl = el<HTMLElement>("cad-layers") as HTMLElement | null;
  const ltEl = el<HTMLElement>("cad-linetypes") as HTMLElement | null;
  const svgBtn = el<HTMLButtonElement>("cad-svg") as HTMLButtonElement | null;
  if (svgBtn && !host.downloadFile) svgBtn.hidden = true;
  // Each window shows only what it can do: the pop-out cannot read the document or pop out again.
  if (!host.readSelectedAlt) openBtn.hidden = true;
  if (popBtn && !host.openLarge) popBtn.hidden = true;

  for (const id of Object.keys(DRAWING_STANDARDS) as StandardId[]) standardSel.add(new Option(DRAWING_STANDARDS[id].name, id));
  for (const id of SHAPE_IDS) shapeSel.add(new Option(SHAPES[id].name, id));
  // R2a: a part from a sketch of your own (lines, arcs, relations, dimensions).
  shapeSel.add(new Option("Sketch (draw your own)", "sketch"));

  let doc: CadDoc = initial ?? starterDoc(DEFAULT_STANDARD);
  standardSel.value = doc.standard;
  hiddenSel.value = doc.hidden ?? "";
  let selected = 0;
  let view: CadView = STANDARD_VIEWS.iso;
  let zoom = 1;
  let mesh: Mesh | null = null;
  let calloutMode = false;
  let seq = 1;
  let lineTimer = 0;
  let buildTimer = 0;
  /** A rebuild is scheduled and has not run: the mesh is of an older model. */
  let pending = false;
  /** The large canvas is open (one dialog per window: its button stays off). */
  let largeOpen = false;
  let nameTimer = 0;
  let inserting = false;
  /** The callouts where they are now (they follow their parts), and the notes about any not drawn. */
  let placed: { callouts: Callout[]; notes: string[] } = { callouts: [], notes: [] };

  // ---- the model -> mesh -> canvas + sheet --------------------------------------------

  function rebuild(): void {
    pending = false;
    const a = docToAssembly(doc);
    if (!a.ok) {
      mesh = null;
      msgEl.className = "build-readout warn";
      msgEl.textContent = a.reason;
      insertBtn.disabled = true;
      lastSheet = null; // nothing current to insert
      paintEmpty();
      previewEl.replaceChildren();
      return;
    }
    const t = tessellate(a.assembly);
    if (!t.ok) {
      mesh = null;
      msgEl.className = "build-readout warn";
      msgEl.textContent = t.reason;
      insertBtn.disabled = true;
      lastSheet = null; // nothing current to insert
      paintEmpty();
      previewEl.replaceChildren();
      return;
    }
    mesh = t.mesh;
    placed = resolveCallouts(doc, mesh);
    paint(true);
    renderSheet();
  }

  /** Every keystroke in a dimension lands here: the model is rebuilt once typing pauses (review D6). */
  function rebuildSoon(): void {
    window.clearTimeout(buildTimer);
    pending = true;
    insertBtn.disabled = true;
    buildTimer = window.setTimeout(rebuild, 150);
  }

  /**
   * Is the sheet on screen the drawing of the model AS IT STANDS? Insert inserts
   * only that (second review: an edit during an insert, or a rebuild still
   * waiting, re-enabled Insert on the previous sheet under the new model's alt text).
   */
  function sheetCurrent(): boolean {
    return !!lastSheet && !pending && mesh !== null && docProblem() === null && lastSheet.model === serializeDoc(doc);
  }

  /** The reason the document cannot be inserted as it stands, or null (review D1). */
  function docProblem(): string | null {
    const bad = doc.parts.flatMap((p) => partProblems(p).map((r) => `${p.name}: ${r}`));
    return bad.length ? bad.join("; ") : null;
  }

  function canvasSize(): { w: number; h: number; dpr: number } {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas.clientWidth || 380;
    const h = canvas.clientHeight || 300;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }

  function currentFit(): Fit | null {
    if (!mesh) return null;
    const { w, h } = canvasSize();
    return fitView(mesh, view, w, h, 20, zoom);
  }

  function paintEmpty(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = canvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }

  /** Shading now; the exact lines a moment after the last change (drags stay smooth). */
  function paint(withLines: boolean): void {
    const ctx = canvas.getContext("2d");
    const fit = currentFit();
    if (!ctx || !mesh || !fit) return;
    const { w, h, dpr } = canvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPreview(ctx, previewOps(mesh, view, fit), w, h, new Set([selected]), dpr, !withLines);
    // Callout anchors as small dots, so the user sees what they placed.
    ctx.fillStyle = "#b91c1c";
    for (const c of placed.callouts) {
      const R = view.rot;
      const x = fit.ox + (R[0] * c.anchor[0] + R[1] * c.anchor[1] + R[2] * c.anchor[2]) * fit.scale;
      const y = fit.oy - (R[3] * c.anchor[0] + R[4] * c.anchor[1] + R[5] * c.anchor[2]) * fit.scale;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    window.clearTimeout(lineTimer);
    if (!withLines) {
      lineTimer = window.setTimeout(() => paint(true), 180);
      return;
    }
    const d = drawLines(mesh, view);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const l of d.visible) {
      l.forEach(([x, y], i) => {
        const px = fit.ox + x * fit.scale, py = fit.oy - y * fit.scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
    }
    ctx.stroke();
  }

  function viewSpecs(): ViewSpec[] {
    const out: ViewSpec[] = [];
    for (const box of Array.from(viewsEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
      if (!box.checked) continue;
      if (box.value === "orbit") out.push({ kind: "orbit", rot: view.rot.slice(), name: "VIEW" });
      else out.push({ kind: box.value as ViewSpec["kind"] } as ViewSpec);
    }
    return out;
  }

  let lastSheet: {
    svg: string;
    w: number;
    h: number;
    labels: string[];
    model: string;
    stdName: string;
    standard: StandardId;
    wMm: number;
    hMm: number;
    sizeName?: string;
    scale: number;
  } | null = null;
  function renderSheet(): void {
    if (!mesh) return;
    doc.views = viewSpecs();
    // A dimension being typed that cannot be drawn: the sheet below is of the
    // LAST good model, so Insert stays off until the model is valid again.
    const problem = docProblem();
    if (problem) {
      lastSheet = null;
      insertBtn.disabled = true;
      msgEl.className = "build-readout warn";
      msgEl.textContent = problem;
      return;
    }
    const sh = layoutSheet(mesh, {
      standard: doc.standard,
      views: doc.views,
      callouts: placed.callouts,
      ...(doc.hidden ? { showHidden: doc.hidden === "show" } : {}),
      ...(doc.sheet ? { format: doc.sheet } : {}),
      ...(doc.layers ? { layers: doc.layers } : {}),
    });
    previewEl.innerHTML = sh.svg;
    const svgEl = previewEl.querySelector("svg");
    if (svgEl) {
      svgEl.setAttribute("width", "100%");
      svgEl.removeAttribute("height");
    }
    const std0 = DRAWING_STANDARDS[doc.standard];
    lastSheet = sh.svg
      ? {
          svg: sh.svg,
          w: sh.widthPx,
          h: sh.heightPx,
          labels: sh.labels,
          model: serializeDoc(doc),
          stdName: std0.name,
          standard: doc.standard,
          wMm: sh.widthMm ?? sh.widthPx / (96 / 25.4),
          hMm: sh.heightMm ?? sh.heightPx / (96 / 25.4),
          ...(sh.sizeName ? { sizeName: sh.sizeName } : {}),
          scale: sh.scaleMmPerUnit,
        }
      : null;
    insertBtn.disabled = !sheetCurrent() || inserting;
    if (!sh.svg) {
      // Refused (the views or callouts do not fit): the reason, as a warning, and nothing else.
      msgEl.className = "build-readout warn";
      msgEl.textContent = [...overlapNotes(doc, mesh), ...placed.notes, ...sh.notes].join(" ");
      return;
    }
    const std = DRAWING_STANDARDS[doc.standard];
    msgEl.className = "build-readout";
    // Mandatory ISO 7200 fields left empty: named, never filled in for the user.
    const missing = doc.sheet && doc.standard === "iso" ? checkTitleFields("iso", doc.sheet.title ?? {}).missing : [];
    msgEl.textContent = [
      sh.sizeName
        ? `${std.name}. Scale ${formatScale(sh.scaleMmPerUnit)} on an ${sh.sizeName} sheet (${fmtMm(sh.widthMm ?? 0)} × ${fmtMm(sh.heightMm ?? 0)} mm).`
        : `${std.name}. Scale ${formatScale(sh.scaleMmPerUnit)} on a ${std.areaMm.w} × ${std.areaMm.h} mm drawing area.`,
      ...(missing.length ? [`ISO 7200 asks the title block for: ${missing.join(", ")}.`] : []),
      ...overlapNotes(doc, mesh),
      ...placed.notes,
      ...sh.notes,
    ].join(" ");
  }

  // ---- parts list and editor ------------------------------------------------------------

  function renderParts(): void {
    partsEl.replaceChildren();
    doc.parts.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "cad-part" + (i === selected ? " selected" : "");
      const name = document.createElement("button");
      name.type = "button";
      name.className = "cad-part-name";
      name.textContent = `${p.name} — ${shapeName(p)}`;
      name.addEventListener("click", () => {
        selected = i;
        renderParts();
        renderEditor();
        paint(true);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "num-remove-btn";
      del.textContent = "×";
      del.title = "Remove this part";
      del.addEventListener("click", () => {
        if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
        const [gone] = doc.parts.splice(i, 1);
        // Its callouts go with it (review D2), and the user is told which.
        const dropped = doc.callouts.filter((c) => c.part === gone.id);
        doc.callouts = doc.callouts.filter((c) => c.part !== gone.id);
        if (dropped.length) host.setStatus(`Removed ${gone.name} and its callout${dropped.length > 1 ? "s" : ""} ${dropped.map((c) => c.label).join(", ")}.`, "");
        selected = Math.max(0, Math.min(selected, doc.parts.length - 1));
        renderParts();
        renderEditor();
        renderCallouts();
        rebuild();
      });
      row.append(name, del);
      partsEl.appendChild(row);
    });
  }

  function numberField(label: string, value: number, onChange: (v: number) => void, step = "any"): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "cad-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.className = "rgroup-input";
    input.value = String(value);
    input.addEventListener("input", () => {
      const v = input.value.trim() === "" ? NaN : Number(input.value);
      onChange(v);
    });
    wrap.append(span, input);
    return wrap;
  }

  function renderEditor(): void {
    editorEl.replaceChildren();
    const p = doc.parts[selected];
    if (!p) return;
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.className = "formula-input";
    nameIn.value = p.name;
    nameIn.setAttribute("aria-label", "Part name");
    nameIn.addEventListener("input", () => {
      p.name = nameIn.value || p.name;
      renderParts();
      // The name is part of the model the sheet carries (and of its notes): redraw once typing pauses.
      insertBtn.disabled = true;
      window.clearTimeout(nameTimer);
      nameTimer = window.setTimeout(renderSheet, 300);
    });
    editorEl.appendChild(nameIn);
    for (const pd of p.shape === "sketch" ? [] : SHAPES[p.shape].params) {
      editorEl.appendChild(
        numberField(pd.label, p.params[pd.key], (v) => {
          p.params[pd.key] = v;
          const probs = partProblems(p);
          if (probs.length) {
            window.clearTimeout(buildTimer);
            pending = false;
            msgEl.className = "build-readout warn";
            msgEl.textContent = `${p.name}: ${probs.join("; ")}`;
            insertBtn.disabled = true;
            return;
          }
          rebuildSoon();
        }, pd.integer ? "1" : "any"),
      );
    }
    if (p.shape === "sketch") {
      // A sketched part: what makes it, and the way back into its sketch.
      const info = document.createElement("p");
      info.className = "build-readout";
      info.textContent = p.op?.kind === "revolve" ? `Revolved about ${p.op.axis}.` : `Extruded ${p.op?.kind === "extrude" ? +p.op.depth.toFixed(4) : "?"} deep.`;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "insert-btn secondary";
      edit.textContent = "Edit sketch";
      const idx = selected;
      edit.addEventListener("click", () => openSketch(idx));
      editorEl.append(info, edit);
    }
    const place = document.createElement("div");
    place.className = "cad-place";
    (["X", "Y", "Z"] as const).forEach((ax, k) => {
      place.appendChild(numberField(`Move ${ax}`, p.placement.translate[k], (v) => {
        if (!Number.isFinite(v)) return;
        p.placement.translate[k] = v;
        rebuildSoon();
      }));
    });
    (["X", "Y", "Z"] as const).forEach((ax, k) => {
      place.appendChild(numberField(`Turn ${ax}°`, p.placement.rotateDeg[k], (v) => {
        if (!Number.isFinite(v)) return;
        p.placement.rotateDeg[k] = v;
        rebuildSoon();
      }));
    });
    editorEl.appendChild(place);
  }

  function renderCallouts(): void {
    calloutsEl.replaceChildren();
    doc.callouts.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "cad-part";
      const label = document.createElement("input");
      label.type = "text";
      label.className = "rgroup-input";
      label.value = c.label;
      label.setAttribute("aria-label", "Callout label");
      label.addEventListener("input", () => {
        c.label = label.value;
        if (mesh) placed = resolveCallouts(doc, mesh);
        renderSheet();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "num-remove-btn";
      del.textContent = "×";
      del.addEventListener("click", () => {
        doc.callouts.splice(i, 1);
        if (mesh) placed = resolveCallouts(doc, mesh);
        renderCallouts();
        paint(true);
        renderSheet();
      });
      row.append(label, del);
      calloutsEl.appendChild(row);
    });
  }

  // ---- events ------------------------------------------------------------------------

  standardSel.addEventListener("change", () => {
    doc.standard = standardSel.value as StandardId;
    if (doc.sheet && !sheetsFor(doc.standard).includes(doc.sheet.size)) {
      const why = sheetRefusal(doc.standard, doc.sheet.size) ?? "";
      if (doc.sheet.title) stashTitle = doc.sheet.title;
      host.setStatus(`The ${SHEET_SIZES[doc.sheet.size].designation} sheet was taken off: ${why}.`, "");
      delete doc.sheet;
    }
    renderSheetControls();
    renderSheet();
  });
  viewsEl.addEventListener("change", renderSheet);
  hiddenSel.addEventListener("change", () => {
    if (hiddenSel.value === "show" || hiddenSel.value === "hide") doc.hidden = hiddenSel.value;
    else delete doc.hidden;
    renderSheet();
  });
  // The canvas follows its window (the pop-out is resizable; the pane can be widened).
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (mesh) paint(true);
    }, 100);
  });
  /** Where a new part goes: beside the drawing, so it is never hidden inside what is there. */
  const besideX = (): number => {
    if (!mesh || !doc.parts.length) return 0;
    let x = 0;
    const P = mesh.positions;
    for (let i = 0; i < P.length; i += 3) x = Math.max(x, P[i]);
    return x + 10;
  };

  // The sketch editor: a new sketched part is added only on Done, when its sketch makes a solid.
  // The part being re-sketched, BY ID (an index went stale when parts were removed); null = a new part.
  let sketchTarget: string | null = null;
  const section = document.getElementById("cad-section");
  const sketching = (): boolean => section?.classList.contains("cad-sketching") ?? false;
  const sketchPanel = initSketchPanel({
    done: (sketch, op) => {
      section?.classList.remove("cad-sketching");
      resetNewBtn();
      const at = sketchTarget === null ? -1 : doc.parts.findIndex((p) => p.id === sketchTarget);
      if (at >= 0) {
        doc.parts[at] = { ...doc.parts[at], sketch, op };
        selected = at;
      } else {
        doc.parts.push({
          id: `p${Date.now().toString(36)}${seq++}`,
          name: `Part ${doc.parts.length + 1}`,
          shape: "sketch",
          params: {},
          placement: { translate: [besideX(), 0, 0], rotateDeg: [0, 0, 0] },
          sketch,
          op,
        });
        selected = doc.parts.length - 1;
      }
      sketchTarget = null;
      renderParts();
      renderEditor();
      rebuild();
      host.sketchClosed?.(true);
    },
    cancelled: () => {
      section?.classList.remove("cad-sketching");
      sketchTarget = null;
      paint(true);
      host.sketchClosed?.(false);
    },
  });
  const openSketch = (target: number | null): void => {
    if (!sketchPanel) return;
    if (sketching()) return host.setStatus("A sketch is already open — press Done or Cancel first.", "error");
    if (largeOpen) return host.setStatus("The drawing is open in the large canvas — sketch there, or close it first.", "error");
    const p = target !== null ? doc.parts[target] : undefined;
    // Room to draw: where the large window can open, the sketch opens there (90 % of the screen);
    // Done brings the part back here. Without it (the pop-out itself, or no dialogs), it opens here.
    if (host.openLarge && (host.largeAvailable?.() ?? true)) {
      void openLargeWith({ sketch: p ? p.id : "new" });
      return;
    }
    sketchHere(p ? p.id : null);
  };
  /** The sketch editor in this window, on a part (by id) or a new one. */
  function sketchHere(partId: string | null): void {
    if (!sketchPanel) return;
    const p = partId === null ? undefined : doc.parts.find((q) => q.id === partId);
    sketchTarget = p ? p.id : null;
    section?.classList.add("cad-sketching");
    sketchPanel.open(p?.sketch, p?.op);
  }

  // New drawing: the first click arms it, the second clears every part and callout; the button
  // then offers Undo for a while. No modal dialog (a blocking dialog would stall the pane).
  let armed = 0, undoDoc: CadDoc | null = null, newTimer = 0;
  const newLabel = "New drawing";
  const resetNewBtn = (): void => {
    armed = 0;
    undoDoc = null;
    if (newBtn) newBtn.textContent = newLabel;
  };
  newBtn?.addEventListener("click", () => {
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    window.clearTimeout(newTimer);
    if (undoDoc) {
      loadDoc(undoDoc);
      host.setStatus("The drawing is back.", "success");
      return resetNewBtn();
    }
    if (!armed) {
      if (!doc.parts.length && !doc.callouts.length) return host.setStatus("The drawing is already blank — add a part or a sketch.", "");
      armed = 1;
      newBtn.textContent = "Click again to clear everything";
      newTimer = window.setTimeout(resetNewBtn, 4000);
      return;
    }
    undoDoc = JSON.parse(serializeDoc(doc)) as CadDoc;
    doc = { ...doc, parts: [], callouts: [] };
    selected = 0;
    renderParts();
    renderEditor();
    renderCallouts();
    rebuild();
    newBtn.textContent = "Undo clear";
    host.setStatus("Drawing cleared. Add a part or a sketch to start — or Undo clear.", "");
    newTimer = window.setTimeout(resetNewBtn, 20000);
  });

  addBtn.addEventListener("click", () => {
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    resetNewBtn(); // the drawing changes: an Undo clear would now throw this part away
    if (shapeSel.value === "sketch") return openSketch(null);
    const shape = shapeSel.value as ShapeId;
    const x = besideX();
    const part: CadPart = {
      id: `p${Date.now().toString(36)}${seq++}`,
      name: `Part ${doc.parts.length + 1}`,
      shape,
      params: defaultParams(shape),
      placement: { translate: [x, 0, 0], rotateDeg: [0, 0, 0] },
    };
    doc.parts.push(part);
    selected = doc.parts.length - 1;
    renderParts();
    renderEditor();
    rebuild();
  });
  calloutBtn.addEventListener("click", () => {
    calloutMode = !calloutMode;
    calloutBtn.classList.toggle("active", calloutMode);
    calloutBtn.setAttribute("aria-pressed", String(calloutMode));
    host.setStatus(calloutMode ? "Click a visible surface on the drawing to place a callout." : "", "");
  });
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-cad-view]"))) {
    b.addEventListener("click", () => {
      const v = b.dataset.cadView as keyof typeof STANDARD_VIEWS;
      view = STANDARD_VIEWS[v] ?? STANDARD_VIEWS.iso;
      zoom = 1;
      paint(true);
      if (viewsEl.querySelector<HTMLInputElement>("input[value=orbit]")?.checked) renderSheet();
    });
  }

  // Drag to orbit; a click (no real movement) picks.
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX;
    lastY = e.clientY;
    if (moved > 3) {
      view = orbit(view, dx, dy);
      paint(false);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    if (moved > 3) {
      if (viewsEl.querySelector<HTMLInputElement>("input[value=orbit]")?.checked) renderSheet();
      return;
    }
    const fit = currentFit();
    if (!mesh || !fit) return;
    const r = canvas.getBoundingClientRect();
    const hit = pickAt(mesh, view, fit, e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    if (calloutMode) {
      // The shading under the cursor must be the model as it stands, or the point lands in the wrong place.
      if (pending || docProblem() !== null) {
        host.setStatus("Finish the dimension being edited (the drawing must update) before placing a callout.", "error");
        return;
      }
      const std = DRAWING_STANDARDS[doc.standard];
      const taken = doc.callouts.map((c) => Number(c.label)).filter((n) => Number.isFinite(n));
      const label = std.callouts === "balloon" ? String((taken.length ? Math.max(...taken) : 0) + 1) : String(host.nextNumeral(taken));
      doc.callouts.push(attachCallout(doc, hit.body, hit.point, label, mesh));
      placed = resolveCallouts(doc, mesh);
      renderCallouts();
      paint(true);
      renderSheet();
      return;
    }
    selected = hit.body;
    renderParts();
    renderEditor();
    paint(true);
  });
  // A drag the browser takes over (a touch scroll, a lost capture) ends without a pick.
  canvas.addEventListener("pointercancel", () => {
    if (!dragging) return;
    dragging = false;
    paint(true);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(8, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      paint(false);
    },
    { passive: false },
  );

  // Re-open a drawing this canvas inserted: its model travels in the alt text.
  /**
   * Sets every control from the model: standard, hidden lines, the views on the
   * sheet and the custom view's angle. The pop-out starts here too — it lost the
   * views when only loadDoc did this (third review).
   */
  function controlsFromDoc(): void {
    renderSheetControls();
    standardSel.value = doc.standard;
    hiddenSel.value = doc.hidden ?? "";
    const kinds = new Set(doc.views.map((v) => v.kind));
    for (const box of Array.from(viewsEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) box.checked = kinds.has(box.value as never);
    const orbitView = doc.views.find((v) => v.kind === "orbit" && "rot" in v && v.rot);
    if (orbitView && orbitView.kind === "orbit" && orbitView.rot) view = { name: "orbit", rot: orbitView.rot };
  }

  /** Puts a parsed model on the canvas, the parts list, the views and the sheet. */
  function loadDoc(d: CadDoc): void {
    doc = d;
    // Title block fields typed for another drawing never come back into this one (review D1).
    stashTitle = {};
    controlsFromDoc();
    selected = 0;
    renderParts();
    renderEditor();
    renderCallouts();
    rebuild();
  }

  openBtn.addEventListener("click", async () => {
    if (!host.readSelectedAlt) return;
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    try {
      const alt = await host.readSelectedAlt();
      if (alt === null) {
        host.setStatus("Select a drawing in the document first (click the picture), then Edit.", "error");
        return;
      }
      const json = modelFromAlt(alt);
      if (!json) {
        host.setStatus("That picture was not made by the Drawing tool, so there is no model to open.", "error");
        return;
      }
      const r = parseDoc(json);
      if (!r.ok) {
        host.setStatus(`Could not open the drawing: ${r.reason}.`, "error");
        return;
      }
      loadDoc(r.doc);
      host.setStatus("Drawing opened. Insert places the edited drawing after the selected one; delete the old one when you are happy.", "success");
    } catch (e) {
      host.setStatus(`Could not read the selected picture: ${(e as Error).message}`, "error");
    }
  });

  async function insertNow(): Promise<void> {
    if (sketching()) {
      host.setStatus("Finish the sketch first (Done or Cancel) — the drawing does not include it yet.", "error");
      return;
    }
    if (inserting) {
      host.setStatus("Another insert is still running; press Insert again when it finishes.", "error");
      return;
    }
    const problem = docProblem();
    if (problem) {
      host.setStatus(`Fix the drawing first: ${problem}`, "error");
      return;
    }
    const sheet = lastSheet;
    if (!sheet || !sheetCurrent()) {
      host.setStatus("The drawing is still updating; press Insert again in a moment.", "error");
      return;
    }
    inserting = true;
    insertBtn.disabled = true;
    if (popBtn) popBtn.disabled = true; // a pop-out returning with Insert would collide with this one
    host.setStatus("Inserting drawing…");
    try {
      const views = sheet.labels.filter(Boolean).join(", ");
      const fit = fitNote(sheet);
      // Provenance: the model the SHEET was drawn from travels with it, so it can be redrawn later.
      const alt = `Drawing (${sheet.stdName})${views ? `: ${views}` : ""}.${fit.note ? " " + fit.note : ""} Model: ${sheet.model}`;
      await host.insertPicture(sheet.svg, sheet.w * fit.k, sheet.h * fit.k, alt);
      host.setStatus(`Drawing inserted — ${sheet.stdName}.${fit.note ? " " + fit.note : ""}`, "success");
    } catch (e) {
      host.setStatus(`Could not insert the drawing: ${(e as Error).message}`, "error");
    } finally {
      inserting = false;
      if (popBtn) popBtn.disabled = largeOpen; // still off while the large canvas is open (fourth review)
      insertBtn.disabled = !sheetCurrent();
    }
  }
  insertBtn.addEventListener("click", () => void insertNow());

  // PowerPoint: the sheet as it stands (the same check as Insert: never a stale sheet).
  // ---- R2b: sheet format, title block, layers, line types -----------------------------------

  /** The title block fields typed before the sheet was taken off (a standard change), restored with the next sheet. */
  let stashTitle: TitleValues = {};
  let tbTimer = 0;
  const PANE_LABEL: Partial<Record<TitleFieldId, string>> = {
    sheets: "Number of sheets",
    creatorDate: "Drawn — date",
    checkerDate: "Checked — date",
    approverDate: "Approved — date",
  };
  function renderSheetControls(): void {
    if (!sheetSel) return;
    const offered = sheetsFor(doc.standard);
    sheetSel.replaceChildren(new Option(offered.length ? "None (the drawing area only)" : "None — this style has no sheet format", ""));
    for (const id of offered) sheetSel.add(new Option(SHEET_SIZES[id].name, id));
    sheetSel.disabled = !offered.length;
    sheetSel.title = offered.length ? "" : sheetRefusal(doc.standard, "A4") ?? "";
    sheetSel.value = doc.sheet?.size ?? "";
    const size = doc.sheet ? SHEET_SIZES[doc.sheet.size] : null;
    if (orientSel) {
      orientSel.replaceChildren(...(size?.orientations ?? []).map((o) => new Option(o === "landscape" ? "Landscape" : "Portrait (vertical)", o)));
      orientSel.hidden = !size || size.orientations.length < 2;
      orientSel.value = doc.sheet?.orientation ?? size?.orientations[0] ?? "";
    }
    if (tbWrap && tbEl) {
      tbWrap.hidden = !doc.sheet;
      tbEl.replaceChildren();
      for (const f of doc.sheet ? titleFieldsFor(doc.standard) : []) {
        const lab = document.createElement("label");
        lab.className = "field-label";
        lab.textContent = `${PANE_LABEL[f.id] ?? f.label}${f.mandatory ? " (required by ISO 7200)" : ""}`;
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "lib-input";
        inp.maxLength = f.max;
        inp.dataset.field = f.id;
        inp.value = doc.sheet?.title?.[f.id] ?? "";
        lab.appendChild(inp);
        tbEl.appendChild(lab);
      }
    }
    if (layersEl) {
      for (const old of Array.from(layersEl.querySelectorAll("label"))) old.remove();
      for (const l of SWITCHABLE_LAYERS) {
        const lab = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = l.id;
        box.checked = doc.layers?.[l.id as keyof NonNullable<CadDoc["layers"]>] !== false;
        lab.append(box, ` ${l.name}`);
        layersEl.appendChild(lab);
      }
    }
    if (ltEl) {
      ltEl.replaceChildren();
      for (const t of Object.values(lineTypesFor(DRAWING_STANDARDS[doc.standard]))) {
        const row = document.createElement("div");
        const pattern = t.dashMm.length ? `, pattern ${t.dashMm.map(fmtMm).join(" · ")} mm` : ", continuous";
        row.textContent = `${t.name} — ${t.designation}: ${fmtMm(t.widthMm)} mm${pattern}${t.product ? " (product choice)" : ""}`;
        ltEl.appendChild(row);
      }
    }
  }
  sheetSel?.addEventListener("change", () => {
    if (!sheetSel.value) {
      if (doc.sheet?.title) stashTitle = doc.sheet.title;
      delete doc.sheet;
    } else {
      const size = sheetSel.value as SheetSizeId;
      const title = doc.sheet?.title ?? stashTitle;
      doc.sheet = { size, ...(Object.keys(title).length ? { title } : {}) };
    }
    renderSheetControls();
    renderSheet();
  });
  orientSel?.addEventListener("change", () => {
    if (!doc.sheet) return;
    const size = SHEET_SIZES[doc.sheet.size];
    if (orientSel.value === size.orientations[0]) delete doc.sheet.orientation;
    else doc.sheet.orientation = orientSel.value as "landscape" | "portrait";
    renderSheet();
  });
  tbEl?.addEventListener("input", (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.dataset.field as TitleFieldId | undefined;
    if (!k || !doc.sheet) return;
    const title: TitleValues = { ...(doc.sheet.title ?? {}) };
    if (inp.value.trim()) title[k] = inp.value;
    else delete title[k];
    doc.sheet.title = title;
    // Typing redraws the sheet once it pauses (a sheet is the hidden-line engine on every view).
    window.clearTimeout(tbTimer);
    tbTimer = window.setTimeout(renderSheet, 250);
  });
  layersEl?.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    if (box.type !== "checkbox") return;
    const layers = { ...(doc.layers ?? {}) } as Record<string, boolean>;
    if (box.checked) delete layers[box.value];
    else layers[box.value] = false;
    if (Object.keys(layers).length) doc.layers = layers;
    else delete doc.layers;
    renderSheet();
  });
  svgBtn?.addEventListener("click", () => {
    if (!host.downloadFile) return;
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    const sheet = lastSheet;
    if (!sheet || !sheetCurrent()) return host.setStatus("The drawing is still updating (or has a problem) — try again in a moment.", "error");
    // The same drawing at its true printed size: the SVG states its size in millimetres.
    const svg = sheet.svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${fmtMm(sheet.wMm)}mm" height="${fmtMm(sheet.hMm)}mm"`);
    const base = (doc.sheet?.title?.number || doc.sheet?.title?.title || "drawing").replace(/[^\w.-]+/g, "_").slice(0, 60);
    host.downloadFile(new Blob([svg], { type: "image/svg+xml" }), `${base}${sheet.sizeName ? "-" + sheet.sizeName : ""}.svg`);
    host.setStatus(`Sheet saved at true size (${fmtMm(sheet.wMm)} × ${fmtMm(sheet.hMm)} mm) — check your Downloads folder.`, "success");
  });

  pptBtn?.addEventListener("click", async () => {
    if (!host.exportPpt) return;
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    const sheet = lastSheet;
    if (!sheet || !sheetCurrent()) return host.setStatus("The drawing is still updating (or has a problem) — try again in a moment.", "error");
    pptBtn.disabled = true;
    try {
      const title = `${doc.parts.map((p) => p.name).slice(0, 3).join(", ")}${doc.parts.length > 3 ? ", …" : ""} — ${sheet.stdName}`;
      await host.exportPpt(sheet.svg, sheet.w, sheet.h, title);
      host.setStatus("PowerPoint downloaded — check your Downloads folder.", "success");
    } catch (e) {
      host.setStatus(`Could not build the PowerPoint file: ${(e as Error).message}`, "error");
    } finally {
      pptBtn.disabled = false;
    }
  });

  // The large canvas: the same model, at working size, in its own window — or opened straight
  // into a sketch (opts.sketch: a part id, or "new").
  async function openLargeWith(opts?: { sketch?: string }): Promise<void> {
    if (!host.openLarge || largeOpen) return;
    if (popBtn) popBtn.disabled = true;
    largeOpen = true;
    try {
      const back = opts ? await host.openLarge(serializeDoc(doc), opts) : await host.openLarge(serializeDoc(doc));
      if (!back) return;
      const r = parseDoc(back.doc);
      if (!r.ok) {
        host.setStatus(`Could not bring the drawing back: ${r.reason}.`, "error");
        return;
      }
      loadDoc(r.doc);
      if (back.insert) await insertNow();
      else host.setStatus(opts?.sketch ? "Sketch brought back from the large window." : "Drawing brought back from the large canvas.", "success");
    } catch (e) {
      host.setStatus(`Could not open the large canvas: ${(e as Error).message}`, "error");
    } finally {
      largeOpen = false;
      if (popBtn) popBtn.disabled = inserting;
    }
  }
  popBtn?.addEventListener("click", () => {
    if (!host.openLarge) return;
    if (sketching()) return host.setStatus("Finish the sketch first (Done or Cancel).", "error");
    void openLargeWith();
  });

  let shown = false;
  return {
    load(json: string): string | null {
      if (sketching()) return "Finish the sketch first (Done or Cancel).";
      const r = parseDoc(json);
      if (!r.ok) return r.reason;
      shown = true;
      loadDoc(r.doc);
      return null;
    },
    getDoc: () => serializeDoc(doc),
    startSketch: (partId) => sketchHere(partId),
    isSketching: sketching,
    insert: insertNow,
    show(): void {
      // The canvas has no size until its section is visible: build on first show.
      if (!shown) {
        shown = true;
        if (initial) controlsFromDoc();
        renderParts();
        renderEditor();
        renderCallouts();
      }
      rebuild();
    },
  };
}

/** "1:2", "2:1", or the mm-per-unit when it is not a round ratio. */
function formatScale(mmPerUnit: number): string {
  if (!(mmPerUnit > 0)) return "—";
  if (mmPerUnit >= 1) return `${+mmPerUnit.toFixed(2)}:1`;
  return `1:${+(1 / mmPerUnit).toFixed(2)}`;
}
