/* global document, HTMLElement, HTMLButtonElement, HTMLInputElement, HTMLCanvasElement, HTMLSelectElement, window, KeyboardEvent */
/**
 * The sketch editor's controller (docs/SCOPE-CAD-R2.md, R2a): DOM wiring only.
 * Every decision — tools, snapping, relations, dimensions, refusals, the status
 * line, what is drawn — is made in tested src/lib modules (sketchEdit,
 * sketchRender, sketch, sketchDoc). Used by the pane and the large canvas
 * alike (cadPane.ts opens it).
 */
import { Sketch, Freedom, freedom } from "../lib/sketch";
import {
  EditState,
  RelationKind,
  SketchTool,
  applyDimension,
  applyRelation,
  cancel,
  click,
  deleteSelection,
  drag,
  editDimension,
  pick,
  startEdit,
  statusLine,
  formatDimension,
  dimensionFor,
} from "../lib/sketchEdit";
import { Snapped, fmt, gridLabel, gridStep, liveSize, parseTyped, placeTyped, promptFor, snapCursor, typedFields } from "../lib/sketchInput";
import { measure } from "../lib/sketch";
import { SketchView, frameSketch, sketchOps, toSketch } from "../lib/sketchRender";
import { SketchOp, sketchBody } from "../lib/sketchDoc";
import { fillet, chamfer, offset, mirror, linearPattern, circularPattern, clearSketch } from "../lib/sketchTools";

export interface SketchPanelHost {
  /** The sketch is done and makes a valid solid. */
  done(sketch: Sketch, op: SketchOp): void;
  /** Closed without keeping the changes. */
  cancelled(): void;
}

const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const STROKE: Record<string, string> = { free: "#2563eb", defined: "#111", construction: "#888", selected: "#d97706", pending: "#2563eb" };

export function initSketchPanel(host: SketchPanelHost): { open(sketch?: Sketch, op?: SketchOp): void; isOpen(): boolean } | null {
  const panel = el<HTMLElement>("cad-sketch");
  const canvas = el<HTMLCanvasElement>("cad-sketch-canvas");
  if (!panel || !canvas) return null;
  const statusEl = el<HTMLElement>("cad-sketch-status")!;
  const msgEl = el<HTMLElement>("cad-sketch-msg")!;
  const dimIn = el<HTMLInputElement>("cad-sketch-dim")!;
  const drivenChk = el<HTMLInputElement>("cad-sketch-driven")!;
  const constructionChk = el<HTMLInputElement>("cad-sketch-construction")!;
  const opSel = el<HTMLSelectElement>("cad-sketch-op")!;
  const depthIn = el<HTMLInputElement>("cad-sketch-depth")!;
  const doneBtn = el<HTMLButtonElement>("cad-sketch-done")!;
  const cancelBtn = el<HTMLButtonElement>("cad-sketch-cancel")!;
  const undoBtn = el<HTMLButtonElement>("cad-sketch-undo")!;
  const deleteBtn = el<HTMLButtonElement>("cad-sketch-delete")!;
  const dimBtn = el<HTMLButtonElement>("cad-sketch-dimension")!;
  const sidesIn = el<HTMLInputElement>("cad-sketch-sides");
  const countIn = el<HTMLInputElement>("cad-sketch-count");
  // The usability round: prompt bar, typed sizes, grid, fit.
  const promptEl = el<HTMLElement>("cad-sketch-prompt");
  const sizeIn = [el<HTMLInputElement>("cad-sketch-in1"), el<HTMLInputElement>("cad-sketch-in2")];
  const sizeLabel = [el<HTMLElement>("cad-sketch-in1-label"), el<HTMLElement>("cad-sketch-in2-label")];
  const sizeName = [el<HTMLElement>("cad-sketch-in1-name"), el<HTMLElement>("cad-sketch-in2-name")];
  const gridChk = el<HTMLInputElement>("cad-sketch-grid");
  const gridLabelEl = el<HTMLElement>("cad-sketch-gridlabel");
  const fitBtn = el<HTMLButtonElement>("cad-sketch-fit");

  /** A number typed in the value box (comma decimal accepted; sign allowed), or null. */
  const valueBox = (allowR = false, allowDeg = false): number | null => {
    let t = dimIn.value.trim().replace(",", ".").replace(allowDeg ? /\s*(°|º|deg)$/i : /(mm)$/i, "");
    if (allowR) t = t.replace(/^(R|r)/, "");
    // A Ø (a diameter) is not a radius or a distance: refused rather than stripped.
    return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
  };
  const selectedLines = (): string[] => st.selection.filter((id) => st.sketch.entities.some((e) => e.id === id && e.kind === "line"));
  const onClick = (id: string, run: () => void): void => el<HTMLButtonElement>(id)?.addEventListener("click", run);
  onClick("cad-sketch-fillet", () => {
    const r = valueBox(true);
    const ls = selectedLines();
    if (ls.length !== 2) return say("Select the two lines that meet at the corner, type the radius, then Fillet.", true);
    if (r === null) return say("Type the fillet radius in the value box (for example 5 or R5 — a radius, not Ø).", true);
    apply(fillet(st, ls[0], ls[1], r));
  });
  onClick("cad-sketch-chamfer", () => {
    const d = valueBox();
    const ls = selectedLines();
    if (ls.length !== 2) return say("Select the two lines that meet at the corner, type the distance, then Chamfer.", true);
    if (d === null) return say("Type the chamfer distance in the value box.", true);
    apply(chamfer(st, ls[0], ls[1], d));
  });
  onClick("cad-sketch-offset", () => {
    const d = valueBox();
    if (d === null) return say("Type the offset distance in the value box (negative goes the other way).", true);
    apply(offset(st, d));
  });
  onClick("cad-sketch-mirror", () => apply(mirror(st)));
  onClick("cad-sketch-pattern", () => {
    // dx, or dx and dy, separated by a space or ";" — a comma is a decimal ("2,5" = 2.5).
    const parts = dimIn.value.trim().split(/[;\s]+/).filter(Boolean).map((t) => Number(t.replace(",", ".")));
    const [dx, dy] = parts.length >= 2 ? parts : [parts[0], 0];
    if (!Number.isFinite(dx) || !Number.isFinite(dy ?? 0)) return say("Type the spacing in the value box: dx, or dx and dy with a space between (for example 20, or 0 15).", true);
    apply(linearPattern(st, Number(countIn?.value ?? 3), dx, dy ?? 0));
  });
  onClick("cad-sketch-circular", () => {
    const total = dimIn.value.trim() ? valueBox(false, true) : 360;
    if (total === null) return say("Type the pattern's total angle (for example 180°), or leave the box empty for all the way round.", true);
    apply(circularPattern(st, Number(countIn?.value ?? 3), total));
  });
  onClick("cad-sketch-clear", () => apply(clearSketch(st)));
  sidesIn?.addEventListener("change", () => {
    st = { ...st, sides: Number(sidesIn.value) };
  });

  let st: EditState = startEdit();
  let view: SketchView = { ox: 0, oy: 0, s: 1 };
  let hover: { x: number; y: number } | null = null;
  /** Where a click at the cursor would land (grid, points, alignment), with its guides. */
  let hoverSnap: Snapped | null = null;
  /** Smart Dimension is on (the engine's tool is Select underneath). */
  let dimTool = false;
  /** Panning: the press and the view it started from. */
  let panFrom: { cx: number; cy: number; view: SketchView } | null = null;
  let spaceDown = false;
  const gridOn = (): boolean => gridChk?.checked ?? false;
  let history: Sketch[] = [];
  let open = false;
  /** The revolve axis: a line chosen with "Revolve about the selected line". */
  let axis: string | null = null;

  const say = (text: string, warn = false): void => {
    msgEl.textContent = text;
    msgEl.className = warn ? "build-readout warn" : "build-readout";
  };
  const tolerance = (): number => 8 / view.s; // 8 px in sketch units

  function size(): { w: number; h: number; dpr: number } {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas!.clientWidth || 380, h = canvas!.clientHeight || 320;
    if (canvas!.width !== Math.round(w * dpr) || canvas!.height !== Math.round(h * dpr)) {
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }

  /** freedom() once per sketch: hover repaints reuse it (it costs tens of ms on a big sketch). */
  let freeFor: Sketch | null = null;
  let freeCache: Freedom = { dof: 0, rigidOnly: false, free: [] };
  const freedomOf = (sk: Sketch): Freedom => {
    if (freeFor !== sk) {
      freeCache = sk.points.length ? freedom(sk) : { dof: 0, rigidOnly: false, free: [] };
      freeFor = sk;
    }
    return freeCache;
  };

  function paint(): void {
    // The status line first: it is the text of the sketch's state, canvas or no canvas.
    statusEl.textContent = statusLine(st.sketch, freedomOf(st.sketch)) + (axis ? ` Revolve axis: ${axis}.` : "");
    if (promptEl) promptEl.textContent = promptFor(st, dimTool);
    const step = gridStep(view.s);
    if (gridLabelEl) gridLabelEl.textContent = gridOn() ? gridLabel(step) : "grid off";
    // The size fields show what the cursor would make, until something is typed.
    const live = liveSize(st.tool, st.pending[0], hoverSnap);
    sizeIn.forEach((inp, i) => {
      if (inp) inp.placeholder = live[i] !== undefined ? fmt(live[i]) : "";
    });
    const ctx = canvas!.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    // The grid: faint lines every step, the axes through the origin a little darker.
    if (step * view.s >= 8) {
      const [x0, y1] = toSketch(view, 0, 0), [x1, y0] = toSketch(view, w, h);
      ctx.lineWidth = 1;
      for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) {
        const px = Math.round(view.ox + gx * view.s) + 0.5;
        ctx.strokeStyle = Math.abs(gx) < step / 2 ? "#c7cdd6" : "#eef0f3";
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) {
        const py = Math.round(view.oy - gy * view.s) + 0.5;
        ctx.strokeStyle = Math.abs(gy) < step / 2 ? "#c7cdd6" : "#eef0f3";
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
    }
    // Inference: alignment guides and the snap marker.
    if (hoverSnap && st.tool !== "select") {
      ctx.strokeStyle = "#16a34a";
      ctx.setLineDash([4, 3]);
      for (const g of hoverSnap.guides) {
        ctx.beginPath();
        ctx.moveTo(view.ox + g.x1 * view.s, view.oy - g.y1 * view.s);
        ctx.lineTo(view.ox + g.x2 * view.s, view.oy - g.y2 * view.s);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const mx = view.ox + hoverSnap.x * view.s, my = view.oy - hoverSnap.y * view.s;
      if (hoverSnap.kind === "point") ctx.strokeRect(mx - 5, my - 5, 10, 10);
      else if (hoverSnap.kind === "midpoint") {
        ctx.beginPath();
        ctx.moveTo(mx, my - 6);
        ctx.lineTo(mx + 6, my + 4);
        ctx.lineTo(mx - 6, my + 4);
        ctx.closePath();
        ctx.stroke();
      }
      // The size under the cursor, beside it.
      if (live.length) {
        ctx.fillStyle = "#1f2937";
        ctx.font = "12px sans-serif";
        const text = st.tool === "line" ? `${fmt(live[0])} mm  ${fmt(live[1])}°` : st.tool === "circle" ? `Ø${fmt(live[0])}` : `${fmt(live[0])} × ${fmt(live[1])}`;
        ctx.fillText(text, mx + 12, my - 10);
      }
    }
    const free = freedomOf(st.sketch).free;
    const at0 = hoverSnap ?? hover;
    const pending = at0 && st.pending.length ? [...st.pending, at0] : st.pending;
    for (const o of sketchOps(st.sketch, view, { selection: st.selection, free, pending, tool: st.tool, sides: st.sides })) {
      if (o.op === "text") {
        ctx.fillStyle = o.kind === "glyph" ? "#6b7280" : o.kind === "driven" ? "#6b7280" : "#111";
        ctx.font = o.kind === "glyph" ? "11px sans-serif" : "13px sans-serif";
        ctx.fillText(o.text, o.x, o.y);
        continue;
      }
      ctx.strokeStyle = ctx.fillStyle = STROKE[o.style];
      ctx.lineWidth = o.style === "selected" ? 2.5 : 1.5;
      ctx.setLineDash(o.style === "construction" || o.style === "pending" ? [6, 4] : []);
      ctx.beginPath();
      if (o.op === "line") {
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.stroke();
      } else if (o.op === "arc") {
        ctx.arc(o.cx, o.cy, o.r, o.a0, o.a1, o.a1 < o.a0);
        ctx.stroke();
      } else {
        ctx.arc(o.x, o.y, o.style === "selected" ? 4 : 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
  }

  /** Every accepted change goes through here: undo keeps the sketch before it. */
  function commit(next: EditState, note?: string): void {
    if (next.sketch !== st.sketch) history = [...history.slice(-49), st.sketch];
    st = next;
    say(note ?? "");
    paint();
  }

  function apply(r: { ok: boolean; state: EditState; reason?: string; note?: string }): void {
    if (r.ok) commit(r.state, r.note);
    else say(r.reason ?? "", true);
  }

  // Tools.
  /** Shows the size fields the tool takes (W and H, length and angle, Ø), emptied. */
  function showSizeFields(): void {
    const fields = dimTool ? [] : typedFields(st.tool);
    sizeIn.forEach((inp, i) => {
      if (!inp) return;
      inp.value = "";
      if (sizeLabel[i]) sizeLabel[i]!.hidden = !fields[i];
      if (sizeName[i] && fields[i]) sizeName[i]!.textContent = fields[i].label;
    });
  }
  function setTool(tool: string): void {
    dimTool = tool === "dimension";
    st = { ...cancel(st), tool: (dimTool ? "select" : tool) as SketchTool, ...(dimTool ? { selection: [] } : {}) };
    for (const o of Array.from(panel!.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) o.classList.toggle("active", o.dataset.skTool === tool);
    showSizeFields();
    say("");
    paint();
  }
  for (const b of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) {
    b.addEventListener("click", () => setTool(b.dataset.skTool!));
  }
  /** The typed sizes, or the first refusal (named). */
  function typedSizes(): Array<number | null> | string {
    const fields = typedFields(st.tool);
    const out: Array<number | null> = [];
    for (let i = 0; i < fields.length; i++) {
      const v = parseTyped(sizeIn[i]?.value ?? "", fields[i].kind, fields[i].label);
      if (typeof v === "string") return v;
      out.push(v);
    }
    return out;
  }
  /** Draws at (x, y) with the typed sizes (if any): the one place a drawing click goes through. */
  function drawAt(x: number, y: number): void {
    const sizes = typedSizes();
    if (typeof sizes === "string") return say(sizes, true);
    if (sizes.some((v) => v !== null)) {
      const before = st.sketch;
      const r = placeTyped(st, sizes, { x, y }, tolerance());
      apply(r);
      // Once the shape is made, the fields are cleared for the next one.
      if (r.ok && r.state.sketch !== before && r.state.sketch.entities.length > before.entities.length) showSizeFields();
      return;
    }
    apply(click(st, x, y, tolerance()));
  }
  fitBtn?.addEventListener("click", () => {
    const { w, h } = size();
    view = frameSketch(st.sketch, w, h);
    paint();
  });
  gridChk?.addEventListener("change", () => paint());
  // Enter in a size field places the shape toward the cursor (or at it, before the first click).
  for (const inp of sizeIn) {
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const target = hoverSnap ?? (st.pending[0] ? { x: st.pending[0].x + 1, y: st.pending[0].y + 1 } : null);
        if (!target) return say("Click on the canvas where the shape goes.", true);
        drawAt(target.x, target.y);
        panel.focus();
      } else if (e.key === "Escape") {
        showSizeFields();
        panel.focus();
      }
    });
  }
  constructionChk.addEventListener("change", () => {
    st = { ...st, construction: constructionChk.checked };
  });
  // Relations on the selection.
  for (const b of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-rel]"))) {
    b.addEventListener("click", () => apply(applyRelation(st, b.dataset.skRel as RelationKind)));
  }
  dimBtn.addEventListener("click", () => {
    // One selected dimension label: edit its value. Otherwise dimension the selection.
    const only = st.selection.length === 1 ? st.sketch.constraints.find((c) => c.id === st.selection[0]) : undefined;
    if (only) apply(editDimension({ ...st, selection: [] }, only.id, dimIn.value));
    else apply(applyDimension(st, dimIn.value, drivenChk.checked));
  });
  dimIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") dimBtn.click();
  });
  deleteBtn.addEventListener("click", () => apply(deleteSelection(st)));
  undoBtn.addEventListener("click", () => {
    endDragNow(); // an Undo mid-drag ends the drag: the point no longer follows the pointer
    const prev = history.pop();
    if (!prev) return say("Nothing to undo.");
    st = { ...st, sketch: prev, selection: [], pending: [] };
    say("");
    paint();
  });
  opSel.addEventListener("change", () => {
    depthIn.disabled = opSel.value !== "extrude";
    if (opSel.value === "revolve") {
      const line = st.selection.find((id) => st.sketch.entities.some((e) => e.id === id && e.kind === "line"));
      if (line) axis = line;
      say(axis ? `Revolves about ${axis}.` : "Select the line to revolve about, then choose Revolve again.", !axis);
    }
    paint();
  });

  // The canvas: click with the tool; in Select, drag a point; wheel zooms about the cursor.
  let dragging: string | null = null;
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return toSketch(view, e.clientX - r.left, e.clientY - r.top);
  };
  /** A press on a point in Select: a CLICK selects it; it becomes a drag only once the pointer moves. */
  let pressed: { point: string; cx: number; cy: number; x: number; y: number } | null = null;
  let dragFrame = 0, dragTo: [number, number] | null = null, dragFrom: Sketch | null = null;
  const dragStep = (): void => {
    if (dragging && dragTo) {
      const r = drag(st, dragging, dragTo[0], dragTo[1]);
      if (r.ok) st = r.state;
    }
  };
  canvas.addEventListener("pointerdown", (e) => {
    // Pan: the middle button, or Space held with the left.
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      panFrom = { cx: e.clientX, cy: e.clientY, view };
      return;
    }
    if (e.button === 2) return; // the context menu ends the tool (below)
    const [x, y] = at(e);
    if (dimTool) {
      // Smart Dimension: the clicked element (a second line for an angle, a second point for a distance).
      const hit = pick(st.sketch, x, y, tolerance());
      if (!hit || st.sketch.constraints.some((c) => c.id === hit)) return say("Click a line, circle or arc — or two lines for an angle, two points for a distance.", true);
      // It pairs with the element clicked before when the two make a dimension and the first could
      // not stand alone (a point), or both are lines (an angle); otherwise it starts afresh.
      const prev = st.selection.length === 1 ? st.selection[0] : null;
      const pairs = !!prev && prev !== hit && typeof dimensionFor(st.sketch, [prev, hit]) !== "string" && (typeof dimensionFor(st.sketch, [prev]) === "string" || (kindIsLine(prev) && kindIsLine(hit)));
      st = { ...st, selection: pairs ? [prev!, hit] : [hit] };
      const spec = dimensionFor(st.sketch, st.selection);
      if (typeof spec === "string") {
        say("Click the second point (or line).");
        return paint();
      }
      dimIn.value = formatDimension({ ...spec, id: "_" } as never, (spec as { value: number }).value);
      say("Type the value and press Enter.");
      paint();
      dimIn.focus();
      dimIn.select();
      return;
    }
    if (st.tool === "select") {
      const hit = pick(st.sketch, x, y, tolerance());
      if (hit && st.sketch.points.some((p) => p.id === hit)) {
        pressed = { point: hit, cx: e.clientX, cy: e.clientY, x, y };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* no capture (a synthetic event): the drag still works inside the canvas */
        }
        return;
      }
      // A dimension's label: select it, its value in the box exactly as displayed (45°, Ø20, R5).
      const label = labelAt(e);
      if (label) {
        st = { ...st, selection: [label] };
        const c = st.sketch.constraints.find((k) => k.id === label);
        dimIn.value = c ? formatDimension(c, "driven" in c && c.driven ? measure(st.sketch, c) : (c as { value: number }).value) : "";
        say("Type the new value, then Dimension (or Enter).");
        return paint();
      }
    }
    const s = snapCursor(st.sketch, x, y, view.s, { grid: gridOn(), ...(st.pending[0] ? { anchor: st.pending[0] } : {}) });
    drawAt(s.x, s.y);
  });
  const kindIsLine = (id: string): boolean => st.sketch.entities.some((e) => e.id === id && e.kind === "line");
  canvas.addEventListener("pointermove", (e) => {
    if (panFrom) {
      view = { ...panFrom.view, ox: panFrom.view.ox + e.clientX - panFrom.cx, oy: panFrom.view.oy + e.clientY - panFrom.cy };
      return paint();
    }
    const [x, y] = at(e);
    hover = { x, y };
    hoverSnap = st.tool === "select" || dimTool ? null : snapCursor(st.sketch, x, y, view.s, { grid: gridOn(), ...(st.pending[0] ? { anchor: st.pending[0] } : {}) });
    if (pressed && !dragging && Math.hypot(e.clientX - pressed.cx, e.clientY - pressed.cy) > 3) {
      dragging = pressed.point;
      // The undo step goes on now (so an Undo or Delete mid-drag stays in order); taken off at release if nothing moved.
      dragFrom = st.sketch;
      history = [...history.slice(-49), st.sketch];
    }
    if (dragging) {
      // One solve per frame at most, whatever the pointer's event rate.
      dragTo = [x, y];
      if (!dragFrame) {
        dragFrame = window.setTimeout(() => {
          dragFrame = 0;
          if (dragging && dragTo) {
            dragStep();
            paint();
          }
        }, 16);
      }
      return;
    }
    paint();
  });
  /** Stops a drag where it is, without a further step (Undo pressed mid-drag). */
  const endDragNow = (): void => {
    if (dragFrame) window.clearTimeout(dragFrame);
    dragFrame = 0;
    pressed = null;
    dragging = null;
    dragFrom = null;
    dragTo = null;
  };
  const endDrag = (e?: { clientX: number; clientY: number }): void => {
    if (pressed && !dragging && e) {
      // It was a click on the point: select it.
      apply(click(st, pressed.x, pressed.y, tolerance()));
    }
    pressed = null;
    if (dragging) {
      // The pending step runs now, so the point ends where the pointer let go.
      if (dragFrame) {
        window.clearTimeout(dragFrame);
        dragFrame = 0;
        if (e) dragStep();
      }
      // An undo step only when a point really moved (a press that wandered back moved nothing).
      const from = dragFrom;
      const moved = !!from && st.sketch.points.some((q) => {
        const o = from.points.find((k) => k.id === q.id);
        return !o || Math.abs(o.x - q.x) > 1e-12 || Math.abs(o.y - q.y) > 1e-12;
      });
      if (from && !moved && history[history.length - 1] === from) history = history.slice(0, -1);
      dragging = null;
      dragFrom = null;
      dragTo = null;
      paint();
    }
  };
  canvas.addEventListener("pointerup", (e) => {
    if (panFrom) {
      panFrom = null;
      return;
    }
    endDrag(e);
  });
  canvas.addEventListener("pointercancel", () => {
    panFrom = null;
    endDrag();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    hoverSnap = null;
    paint();
  });
  // Right-click (or a double-click) ends the tool in progress — a line chain ends there.
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (st.pending.length) {
      st = cancel(st);
      paint();
    }
  });
  canvas.addEventListener("dblclick", () => {
    if (st.tool === "line" && st.pending.length) {
      st = cancel(st);
      paint();
    }
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const [x, y] = toSketch(view, cx, cy);
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      view = { s: view.s * f, ox: cx - x * view.s * f, oy: cy + y * view.s * f };
      paint();
    },
    { passive: false },
  );
  /** Solid Edge-style keys (never while a box has the typing focus). */
  const KEY_TOOL: Record<string, string> = { s: "select", l: "line", r: "rectangle", c: "circle", a: "arc", p: "point", t: "trim", d: "dimension" };
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === " ") {
      spaceDown = true;
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoBtn.click();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      // First Esc ends what is in progress; the next goes back to Select.
      if (st.pending.length || st.selection.length) st = { ...cancel(st), selection: [] };
      else if (st.tool !== "select" || dimTool) return setTool("select");
      paint();
    } else if (e.key === "Delete" || e.key === "Backspace") apply(deleteSelection(st));
    else if (/^[0-9.]$/.test(e.key) && typedFields(st.tool).length && !dimTool && sizeIn[0]) {
      // Typing a size goes straight into the first size field.
      e.preventDefault();
      sizeIn[0].focus();
      sizeIn[0].value = e.key;
    } else if (e.key.toLowerCase() === "f") fitBtn?.click();
    else if (e.key.toLowerCase() === "g" && gridChk) {
      gridChk.checked = !gridChk.checked;
      paint();
    } else if (KEY_TOOL[e.key.toLowerCase()]) setTool(KEY_TOOL[e.key.toLowerCase()]);
  });
  panel.addEventListener("keyup", (e: KeyboardEvent) => {
    if (e.key === " ") spaceDown = false;
  });

  /** A dimension label under the cursor (from the same draw list the canvas paints). */
  function labelAt(e: { clientX: number; clientY: number }): string | null {
    const r = canvas!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    for (const o of sketchOps(st.sketch, view)) {
      if (o.op === "text" && o.kind !== "glyph" && cx >= o.x - 4 && cx <= o.x + 8 * o.text.length && cy >= o.y - 14 && cy <= o.y + 4) return o.id;
    }
    return null;
  }

  // Done: the sketch must make a solid.
  doneBtn.addEventListener("click", () => {
    const op: SketchOp = opSel.value === "revolve" ? { kind: "revolve", axis: axis ?? "" } : { kind: "extrude", depth: Number(depthIn.value.replace(",", ".")) };
    if (op.kind === "revolve" && !axis) return say("Select the line to revolve about, then choose Revolve.", true);
    const r = sketchBody(st.sketch, op);
    if (!r.ok) return say(r.reason, true);
    open = false;
    panel.hidden = true;
    host.done(st.sketch, op);
  });
  cancelBtn.addEventListener("click", () => {
    open = false;
    panel.hidden = true;
    host.cancelled();
  });
  window.addEventListener("resize", () => {
    if (open) paint();
  });

  return {
    open(sketch?: Sketch, op?: SketchOp): void {
      st = startEdit(sketch);
      history = [];
      axis = op?.kind === "revolve" ? op.axis : null;
      opSel.value = op?.kind ?? "extrude";
      depthIn.value = String(op?.kind === "extrude" ? op.depth : 10);
      depthIn.disabled = opSel.value !== "extrude";
      constructionChk.checked = false;
      drivenChk.checked = false;
      st = { ...st, sides: Number(sidesIn?.value ?? 6) };
      open = true;
      panel.hidden = false;
      const { w, h } = size();
      view = frameSketch(st.sketch, w, h);
      say(sketch ? "" : "Pick a tool and click on the canvas. Relations and dimensions keep the shape; drag a point to see what is still free.");
      dimTool = false;
      hoverSnap = null;
      for (const o of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) o.classList.toggle("active", o.dataset.skTool === st.tool);
      showSizeFields();
      paint();
      panel.focus();
    },
    isOpen: () => open,
  };
}
