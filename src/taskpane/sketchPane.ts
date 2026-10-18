/* global document, HTMLElement, HTMLButtonElement, HTMLInputElement, HTMLCanvasElement, HTMLSelectElement, window, KeyboardEvent */
/**
 * The sketch editor's controller (docs/SCOPE-CAD-R2.md, R2a): DOM wiring only.
 * Every decision — tools, snapping, relations, dimensions, refusals, the status
 * line, what is drawn — is made in tested src/lib modules (sketchEdit,
 * sketchRender, sketch, sketchDoc). Used by the pane and the large canvas
 * alike (cadPane.ts opens it).
 */
import { Sketch, freedom } from "../lib/sketch";
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
} from "../lib/sketchEdit";
import { SketchView, frameSketch, sketchOps, toSketch } from "../lib/sketchRender";
import { SketchOp, sketchBody } from "../lib/sketchDoc";

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

  let st: EditState = startEdit();
  let view: SketchView = { ox: 0, oy: 0, s: 1 };
  let hover: { x: number; y: number } | null = null;
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

  function paint(): void {
    // The status line first: it is the text of the sketch's state, canvas or no canvas.
    statusEl.textContent = statusLine(st.sketch) + (axis ? ` Revolve axis: ${axis}.` : "");
    const ctx = canvas!.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    const free = st.sketch.points.length ? freedom(st.sketch).free : [];
    const pending = hover && st.pending.length ? [...st.pending, hover] : st.pending;
    for (const o of sketchOps(st.sketch, view, { selection: st.selection, free, pending, tool: st.tool })) {
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

  function apply(r: { ok: boolean; state: EditState; reason?: string }): void {
    if (r.ok) commit(r.state);
    else say(r.reason ?? "", true);
  }

  // Tools.
  for (const b of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) {
    b.addEventListener("click", () => {
      st = { ...cancel(st), tool: b.dataset.skTool as SketchTool };
      for (const o of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) o.classList.toggle("active", o === b);
      say("");
      paint();
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
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e);
    if (st.tool === "select") {
      const hit = pick(st.sketch, x, y, tolerance());
      if (hit && st.sketch.points.some((p) => p.id === hit)) {
        dragging = hit;
        history = [...history.slice(-49), st.sketch];
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      // A dimension's label: select it (to edit its value).
      const label = labelAt(e);
      if (label) {
        st = { ...st, selection: [label] };
        const c = st.sketch.constraints.find((k) => k.id === label) as { value?: number } | undefined;
        dimIn.value = c && typeof c.value === "number" ? String(+c.value.toFixed(4)) : "";
        say("Type the new value, then Dimension (or Enter).");
        return paint();
      }
    }
    apply(click(st, x, y, tolerance()));
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = at(e);
    hover = { x, y };
    if (dragging) {
      const r = drag(st, dragging, x, y);
      if (r.ok) st = r.state;
    }
    paint();
  });
  const endDrag = (): void => {
    if (dragging) {
      dragging = null;
      paint();
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    paint();
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
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Escape") {
      st = cancel(st);
      paint();
    } else if (e.key === "Delete" || e.key === "Backspace") apply(deleteSelection(st));
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
      open = true;
      panel.hidden = false;
      const { w, h } = size();
      view = frameSketch(st.sketch, w, h);
      say(sketch ? "" : "Pick a tool and click on the canvas. Relations and dimensions keep the shape; drag a point to see what is still free.");
      for (const o of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sk-tool]"))) o.classList.toggle("active", o.dataset.skTool === st.tool);
      paint();
      panel.focus();
    },
    isOpen: () => open,
  };
}
