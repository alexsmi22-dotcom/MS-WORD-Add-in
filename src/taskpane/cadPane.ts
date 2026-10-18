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
import type { Callout } from "../lib/cadSheet";

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
  openLarge?(docJson: string): Promise<{ doc: string; insert: boolean } | null>;
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
}

/** The model stored in a drawing's alt text ("… Model: {json}"), or null. */
export function modelFromAlt(alt: string): string | null {
  const at = alt.lastIndexOf("Model: ");
  return at < 0 ? null : alt.slice(at + "Model: ".length).trim();
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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
  const popBtn = el<HTMLButtonElement>("cad-popout") as HTMLButtonElement | null;
  // Each window shows only what it can do: the pop-out cannot read the document or pop out again.
  if (!host.readSelectedAlt) openBtn.hidden = true;
  if (popBtn && !host.openLarge) popBtn.hidden = true;

  for (const id of Object.keys(DRAWING_STANDARDS) as StandardId[]) standardSel.add(new Option(DRAWING_STANDARDS[id].name, id));
  for (const id of SHAPE_IDS) shapeSel.add(new Option(SHAPES[id].name, id));

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

  let lastSheet: { svg: string; w: number; h: number; labels: string[]; model: string; stdName: string } | null = null;
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
    });
    previewEl.innerHTML = sh.svg;
    const svgEl = previewEl.querySelector("svg");
    if (svgEl) {
      svgEl.setAttribute("width", "100%");
      svgEl.removeAttribute("height");
    }
    const std0 = DRAWING_STANDARDS[doc.standard];
    lastSheet = sh.svg ? { svg: sh.svg, w: sh.widthPx, h: sh.heightPx, labels: sh.labels, model: serializeDoc(doc), stdName: std0.name } : null;
    insertBtn.disabled = !sheetCurrent() || inserting;
    if (!sh.svg) {
      // Refused (the views or callouts do not fit): the reason, as a warning, and nothing else.
      msgEl.className = "build-readout warn";
      msgEl.textContent = [...overlapNotes(doc, mesh), ...placed.notes, ...sh.notes].join(" ");
      return;
    }
    const std = DRAWING_STANDARDS[doc.standard];
    msgEl.className = "build-readout";
    msgEl.textContent = [
      `${std.name}. Scale ${formatScale(sh.scaleMmPerUnit)} on a ${std.areaMm.w} × ${std.areaMm.h} mm drawing area.`,
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
  addBtn.addEventListener("click", () => {
    const shape = shapeSel.value as ShapeId;
    // A new part sits beside the drawing so it is never hidden inside what is there.
    let x = 0;
    if (mesh) {
      const P = mesh.positions;
      for (let i = 0; i < P.length; i += 3) x = Math.max(x, P[i]);
      x += 10;
    }
    const part: CadPart = {
      id: `p${Date.now().toString(36)}${seq++}`,
      name: `Part ${doc.parts.length + 1}`,
      shape,
      params: defaultParams(shape),
      placement: { translate: [doc.parts.length ? x : 0, 0, 0], rotateDeg: [0, 0, 0] },
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
    controlsFromDoc();
    selected = 0;
    renderParts();
    renderEditor();
    renderCallouts();
    rebuild();
  }

  openBtn.addEventListener("click", async () => {
    if (!host.readSelectedAlt) return;
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
      // Provenance: the model the SHEET was drawn from travels with it, so it can be redrawn later.
      const alt = `Drawing (${sheet.stdName})${views ? `: ${views}` : ""}. Model: ${sheet.model}`;
      await host.insertPicture(sheet.svg, sheet.w, sheet.h, alt);
      host.setStatus(`Drawing inserted — ${sheet.stdName}.`, "success");
    } catch (e) {
      host.setStatus(`Could not insert the drawing: ${(e as Error).message}`, "error");
    } finally {
      inserting = false;
      if (popBtn) popBtn.disabled = largeOpen; // still off while the large canvas is open (fourth review)
      insertBtn.disabled = !sheetCurrent();
    }
  }
  insertBtn.addEventListener("click", () => void insertNow());

  // The large canvas: the same model, at working size, in its own window.
  popBtn?.addEventListener("click", async () => {
    if (!host.openLarge) return;
    popBtn.disabled = true;
    largeOpen = true;
    try {
      const back = await host.openLarge(serializeDoc(doc));
      if (!back) return;
      const r = parseDoc(back.doc);
      if (!r.ok) {
        host.setStatus(`Could not bring the drawing back: ${r.reason}.`, "error");
        return;
      }
      loadDoc(r.doc);
      if (back.insert) await insertNow();
      else host.setStatus("Drawing brought back from the large canvas.", "success");
    } catch (e) {
      host.setStatus(`Could not open the large canvas: ${(e as Error).message}`, "error");
    } finally {
      largeOpen = false;
      popBtn.disabled = inserting;
    }
  });

  let shown = false;
  return {
    load(json: string): string | null {
      const r = parseDoc(json);
      if (!r.ok) return r.reason;
      shown = true;
      loadDoc(r.doc);
      return null;
    },
    getDoc: () => serializeDoc(doc),
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
