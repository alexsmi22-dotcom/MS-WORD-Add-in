// The pop-out equation canvas — a working surface, not a fancy input box:
//
//   · paste from anywhere (math-italic 𝑥, Greek θ, LaTeX, Word linear format)
//     — foldPastedMath reads it and SAYS what it read
//   · the equation drawn as real mathematics while it is composed
//   · the SOLUTION live, from the same engines the pane uses — roots,
//     rearrangement chips, derivative, integral with bounds
//   · a graphing calculator: one curve per line, both sides of an equation
//     overlaid so the crossings are the solutions, window under your control
//   · the composite figure drawn live for the geometry kind
//
// "Use this equation" hands the text back; solving-for-insertion stays in the
// pane, where the derivation and the Insert button live.

import {
  SOLVE_SYMBOLS,
  SOLVE_EQUATIONS,
  SOLVE_SHAPES,
  SOLVE_CALCULUS,
  SOLVE_ODES,
  PaletteGroup,
} from "../lib/palettes";
import { mathToHtml } from "../lib/mathHtml";
import { solveInputToTypesetLines, solveToTypesetDsl, isProseRequest } from "../lib/solveTypeset";
import { foldPastedMath } from "../lib/pasteMath";
import { graphSeries, GraphWindow } from "../lib/graphCalc";
import { buildPlotSvg } from "../lib/plot";
import { solveEquation, differentiate, antiderivative, integrate, parseExpr, evalAst } from "../lib/solve";
import { equationWork, derivativeWork, definiteIntegralWork, WorkLine } from "../lib/showWork";
import { solveOdeSymbolic } from "../lib/odeSymbolic";
import { solveWithUnits } from "../lib/unitSolve";
import { limit as evalLimit, taylorSeries, parseLimitRequest, parseSeriesRequest } from "../lib/analysis";
import { solveInequality } from "../lib/inequalities";
import { splitEquations, solveSystem } from "../lib/systems";
import { solveGeometry } from "../lib/geometryParse";
import { solveComposite } from "../lib/compositeGeometry";
import { compositeShapeSvg, geometryFigureSvg } from "../lib/geometryChart";
import {
  DrawPt, DrawTool, HandleRef, emptyDrawState, setTool, clickAt, closePolygon, undo, clearAll,
  hitHandle, dragHandle, emitDsl, describePending, renderDrawSvg, snapPt, WORLD_W, WORLD_H,
  DRAW_VIEW, shapesDescribeEmit,
} from "../lib/geometryDraw";
import { fitSketch, SketchPt, FitResult } from "../lib/sketchFit";
import { sketchSurfaceSvg, sketchFitSvg, skSnapPt, SK_VIEW, SK_X0, SK_X1, SK_Y0, SK_Y1 } from "../lib/sketchChart";

type Kind = "equation" | "derivative" | "integral" | "ode" | "geometry";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

Office.onReady(() => {
  const params = new URLSearchParams(window.location.search);
  const kind = (params.get("kind") as Kind) || "equation";
  const input = byId<HTMLTextAreaElement>("input");
  const typeset = byId<HTMLElement>("typeset");
  const figure = byId<HTMLElement>("figure");
  const graphEl = byId<HTMLElement>("graph");
  const graphControls = byId<HTMLElement>("graph-controls");
  const graphFrom = byId<HTMLInputElement>("graph-from");
  const graphTo = byId<HTMLInputElement>("graph-to");
  const boundsRow = byId<HTMLElement>("bounds-row");
  const boundA = byId<HTMLInputElement>("bound-a");
  const boundB = byId<HTMLInputElement>("bound-b");
  const pasteNote = byId<HTMLElement>("paste-note");
  const resultEl = byId<HTMLElement>("result");
  const status = byId<HTMLElement>("status");
  const info = byId<HTMLElement>("info");

  /** The solve-for choice for multi-unknown equations (chips below the result). */
  let varChoice: string | null = null;
  /**
   * When the geometry input was DRAWN and still matches the drawing, "Use this
   * equation" carries the shapes back so the pane can render the figure at the
   * TRUE drawn placement instead of disclaiming "placement illustrative".
   */
  let drawingToCarry: () => unknown = () => undefined;

  if (params.get("tooLarge")) {
    const err = byId<HTMLElement>("error");
    err.textContent =
      "The pane's input was too large to carry into this window, so it starts blank — “Use this equation” will REPLACE the pane's input.";
    err.style.display = "block";
  }
  input.value = params.get("expr") ?? "";
  info.textContent =
    kind === "geometry"
      ? "Geometry canvas — shapes and composite figures"
      : `Equation canvas — ${kind === "equation" ? "solve / rearrange / systems / inequalities / graph" : kind}`;
  boundsRow.style.display = kind === "integral" ? "flex" : "none";
  graphControls.style.display = kind === "geometry" ? "none" : "flex";

  const line = (parent: HTMLElement, text: string, cls = ""): void => {
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    parent.appendChild(div);
  };
  const mathLine = (parent: HTMLElement, math: string, fallback: string): void => {
    const div = document.createElement("div");
    div.className = "result-math";
    try {
      div.innerHTML = mathToHtml(solveToTypesetDsl(math));
    } catch {
      div.textContent = fallback;
    }
    parent.appendChild(div);
  };
  /** Show-your-work lines: prose as prose, mathematics typeset. */
  const workLines = (parent: HTMLElement, work: WorkLine[]): void => {
    for (const w of work) {
      if (w.math) mathLine(parent, w.math, w.math);
      else if (w.text) line(parent, w.text, "result-line");
    }
  };

  /** The typeset view: every input line drawn as mathematics. */
  function renderTypeset(folded: string): void {
    typeset.replaceChildren();
    if (!folded.trim()) {
      typeset.style.display = "block";
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent =
        kind === "geometry"
          ? "DRAW on the grid below (or type) — the request writes itself, solves live, and the figure follows."
          : "Type, click symbols, or PASTE from anywhere — a paper, Word, LaTeX. It draws here as real mathematics.";
      typeset.appendChild(hint);
      return;
    }
    if (kind === "geometry" || kind === "ode") {
      // Geometry input is a shape DSL; ODE primes (y′) have no typeset
      // reading — the worked result below is the mathematics.
      typeset.style.display = "none";
      return;
    }
    typeset.style.display = "block";
    if (isProseRequest(folded)) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = "Limit/series requests are prose — the result below is the mathematics.";
      typeset.appendChild(hint);
      return;
    }
    for (const l of solveInputToTypesetLines(folded)) {
      const div = document.createElement("div");
      div.className = "line";
      try {
        div.innerHTML = mathToHtml(l);
      } catch {
        div.textContent = l;
      }
      typeset.appendChild(div);
    }
  }

  /** Live SOLVING — the same engines the pane runs, rendered compactly. */
  function renderResult(folded: string): void {
    resultEl.replaceChildren();
    status.classList.remove("bad");
    status.textContent = "";
    if (!folded.trim()) return;
    try {
      if (kind === "geometry") {
        const comp = solveComposite(folded);
        if (comp && !comp.incomplete) {
          figure.innerHTML = compositeShapeSvg(comp);
          figure.style.display = "block";
          for (const v of comp.values) {
            line(resultEl, `${v.label} = ${v.exact ?? v.value}${v.unit ? ` ${v.unit}` : ""}`, "result-line");
          }
          for (const c of comp.caveats) line(resultEl, c, "caveat");
          return;
        }
        figure.style.display = "none";
        if (comp?.incomplete) {
          status.classList.add("bad");
          status.textContent = `Almost there — ${comp.incomplete}.`;
          return;
        }
        const g = solveGeometry(folded);
        if (g) {
          // Plain geometry draws live in the canvas too — same builder,
          // same figure the pane will preview and Word will receive.
          const gsvg = g.figure ? geometryFigureSvg(g.figure) : "";
          if (gsvg) {
            figure.innerHTML = gsvg;
            figure.style.display = "block";
          }
          line(resultEl, g.title, "result-title");
          for (const v of g.values) {
            // Mirror the pane: an undefined quantity shows as "—", never as a
            // raw "NaN" or "Infinity" presented like a number.
            const shown = v.exact ?? (Number.isFinite(v.value) ? String(v.value) : "—");
            line(resultEl, `${v.label} = ${shown}${v.unit ? ` ${v.unit}` : ""}`, "result-line");
          }
          if (g.degenerate) line(resultEl, g.degenerate, "caveat");
        } else {
          status.textContent =
            "Not readable as geometry yet — try a shape (circle r=3) or a composite (rectangle 10 x 5 minus triangle b=4 h=3).";
        }
        return;
      }

      if (kind === "ode") {
        const r = solveOdeSymbolic(folded);
        if (!r) {
          status.textContent = "Type an ODE — y' = x*y, dy/dx = cos(x), or y'' + 3y' + 2y = 0.";
          return;
        }
        line(resultEl, `ODE — ${r.classification}`, "result-title");
        workLines(resultEl, r.steps);
        if (r.solution) {
          mathLine(resultEl, r.solution, r.solution);
          if (r.verified === "verified") line(resultEl, "Verified by substituting back.", "result-line");
        }
        for (const c of r.caveats) line(resultEl, c, "caveat");
        return;
      }

      if (kind === "equation") {
        if (/[<>≤≥≠]|!=/.test(folded) && !folded.includes("\n")) {
          const iq = solveInequality(folded);
          if (!iq) return void (status.textContent = "Not readable as an inequality yet.");
          line(resultEl, `${iq.variable} ∈ ${iq.display}`, "result-title");
          for (const s of iq.steps.slice(0, 4)) line(resultEl, s, "result-line");
          return;
        }
        if (folded.includes(String.fromCharCode(10))) {
          const us = solveWithUnits(folded);
          if (us) {
            line(resultEl, `Solve with units — for ${us.unknown}`, "result-title");
            workLines(resultEl, us.steps);
            if (us.refusal) line(resultEl, us.refusal, "caveat");
            for (const c of us.caveats) line(resultEl, c, "caveat");
            return;
          }
        }
        const eqs = splitEquations(folded);
        if (eqs.length > 1) {
          const sys = solveSystem(eqs);
          if (!sys) return void (status.textContent = "Not readable as a system yet.");
          const heading =
            sys.kind === "unique"
              ? "One solution, exactly"
              : sys.kind === "none"
                ? "No solution — the equations are inconsistent"
                : sys.kind === "infinite"
                  ? `Infinitely many solutions (free: ${(sys.freeVariables ?? []).join(", ") || "—"})`
                  : sys.kind === "nonlinear"
                    ? "Nonlinear system — numeric solutions"
                    : "System";
          line(resultEl, heading, "result-title");
          if (sys.exact) {
            for (const [v, val] of Object.entries(sys.exact)) mathLine(resultEl, `${v} = ${val}`, `${v} = ${val}`);
          }
          for (const g of sys.general ?? []) mathLine(resultEl, g, g);
          for (const n of sys.numeric ?? []) {
            line(resultEl, Object.entries(n).map(([v, val]) => `${v} = ${val}`).join(", "), "result-line");
          }
          for (const c of sys.caveats.slice(0, 2)) line(resultEl, c, "caveat");
          return;
        }
        const r = solveEquation(folded, varChoice ?? undefined);
        if (!r) {
          // An expression mid-composition is not an error — say what it needs.
          parseExpr(folded.replace(/=[^\n]*$/, "").trim() || folded);
          status.textContent = "Parses — add “= …” to make it an equation.";
          return;
        }
        line(resultEl, `Solved for ${r.variable} (${r.method})`, "result-title");
        workLines(resultEl, equationWork(folded, r));
        for (const root of r.roots.slice(0, 6)) {
          mathLine(resultEl, `${r.variable} = ${root.display}`, `${r.variable} = ${root.display}`);
        }
        if (r.roots.length > 6) line(resultEl, `…and ${r.roots.length - 6} more roots.`, "result-line");
        for (const c of r.caveats.slice(0, 3)) line(resultEl, c, "caveat");
        // Solve-for chips: the other unknowns, one click away.
        if (r.unknowns && r.unknowns.length > 1) {
          const row = document.createElement("div");
          row.className = "chip-row";
          const lab = document.createElement("span");
          lab.textContent = "Solve for: ";
          row.appendChild(lab);
          for (const u of r.unknowns) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "chip" + (u === r.variable ? " is-on" : "");
            chip.textContent = u;
            chip.addEventListener("click", () => {
              varChoice = u;
              refresh();
            });
            row.appendChild(chip);
          }
          resultEl.appendChild(row);
        }
        return;
      }

      if (kind === "derivative") {
        const lim = parseLimitRequest(folded);
        if (lim) {
          const res = evalLimit(lim.expr, lim.variable, lim.point, lim.side);
          if (res) {
            const shown = res.exact ?? (res.value !== undefined ? String(res.value) : null);
            line(resultEl, shown !== null ? `limit = ${shown}` : "The limit could not be established.", "result-title");
            for (const c of res.caveats.slice(0, 2)) line(resultEl, c, "caveat");
          }
          status.textContent = "Reads as a limit.";
          return;
        }
        const ser = parseSeriesRequest(folded);
        if (ser) {
          const res = taylorSeries(ser.expr, ser.variable, ser.centre, ser.order);
          if (res) mathLine(resultEl, res.display, res.display);
          status.textContent = "Reads as a series.";
          return;
        }
        const d = differentiate(folded);
        if (!d) {
          parseExpr(folded); // throws with the real reason
          return;
        }
        workLines(resultEl, derivativeWork(folded, d.variable));
        mathLine(resultEl, `d/d${d.variable}: ${d.derivative}`, d.derivative);
        for (const c of d.caveats.slice(0, 2)) line(resultEl, c, "caveat");
        return;
      }

      // integral
      const a = boundA.value.trim();
      const b = boundB.value.trim();
      if (!a && !b) {
        const F = antiderivative(folded);
        if (!F) {
          parseExpr(folded);
          status.textContent = "Parses — no elementary antiderivative was found (the pane offers numeric integration with bounds).";
          return;
        }
        mathLine(resultEl, `F(${F.variable}) = ${F.antiderivative} + C`, F.antiderivative);
        line(resultEl, `Checked by differentiating back (${F.verified}).`, "result-line");
        return;
      }
      const av = a ? evalAst(parseExpr(a), {}) : NaN;
      const bv = b ? evalAst(parseExpr(b), {}) : NaN;
      if (!Number.isFinite(av) || !Number.isFinite(bv)) {
        status.textContent = "Both bounds are needed for a definite integral (or clear both for the antiderivative).";
        return;
      }
      const ig = integrate(folded, av, bv);
      if (!ig) {
        parseExpr(folded);
        status.textContent = "The integral could not be evaluated on this interval.";
        return;
      }
      line(resultEl, `∫ = ${ig.value} (${ig.method})`, "result-title");
      if (ig.antiderivative) mathLine(resultEl, `F = ${ig.antiderivative}`, ig.antiderivative);
      workLines(resultEl, definiteIntegralWork(ig, av, bv));
      for (const c of ig.caveats.slice(0, 2)) line(resultEl, c, "caveat");
    } catch (error) {
      status.classList.add("bad");
      status.textContent = (error as Error).message;
    }
  }

  /** The graphing calculator: every line a curve, the window the user's.
   *  Runs on the FOLDED text, so a reassembled stacked-fraction paste graphs
   *  as its two sides rather than as three broken lines. */
  function renderGraph(foldedText?: string): void {
    if (kind === "geometry") return;
    graphEl.replaceChildren();
    let raw = foldedText ?? foldPastedMath(input.value.trim(), { stackedFractions: true }).text;
    // For an ODE, the graphable thing is the SOLUTION family, not the input.
    if (kind === "ode") {
      const r = raw.trim() ? solveOdeSymbolic(raw) : null;
      raw = r && r.family.length ? r.family.map((f) => f.expr).join("\n") : "";
    }
    if (!raw.trim() || isProseRequest(raw)) {
      graphEl.style.display = "none";
      return;
    }
    const win: GraphWindow = { xMin: Number(graphFrom.value), xMax: Number(graphTo.value) };
    const g = graphSeries(raw, win);
    if (!g.series.length) {
      graphEl.style.display = g.notes.length ? "block" : "none";
      for (const n of g.notes) line(graphEl, n, "graph-note");
      return;
    }
    graphEl.style.display = "block";
    const svgWrap = document.createElement("div");
    svgWrap.innerHTML = buildPlotSvg(g.series, {
      width: 660,
      height: 340,
      xlabel: g.variable ?? "x",
      ylabel: "y",
    });
    graphEl.appendChild(svgWrap);
    for (const n of g.notes) line(graphEl, n, "graph-note");
  }

  function refresh(): void {
    const folded = foldPastedMath(input.value.trim(), {
      geometry: kind === "geometry",
      ode: kind === "ode",
      stackedFractions: kind !== "geometry" && kind !== "ode",
      extractFromProse: kind === "equation",
    });
    pasteNote.textContent = input.value.trim() ? folded.notes.join(" ") : "";
    renderTypeset(folded.text);
    renderResult(folded.text.trim());
    renderGraph(folded.text);
  }

  function insertAtCursor(snippet: string, caret?: number): void {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + snippet + input.value.slice(end);
    const pos = start + (caret ?? snippet.length);
    input.focus();
    input.setSelectionRange(pos, pos);
    varChoice = null;
    refresh();
  }

  // Palette + searchable library.
  const palette = byId<HTMLElement>("palette");
  const search = byId<HTMLInputElement>("lib-search");
  interface Rendered {
    btn: HTMLButtonElement;
    hay: string;
    row: HTMLElement;
    labelEl: HTMLElement;
  }
  const rendered: Rendered[] = [];
  const renderGroups = (groups: PaletteGroup[], template: boolean): void => {
    for (const group of groups) {
      const label = document.createElement("div");
      label.className = "group-label";
      label.textContent = group.name;
      palette.appendChild(label);
      const row = document.createElement("div");
      row.className = "group";
      for (const item of group.items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pal-btn";
        btn.textContent = item.label;
        if (item.title) btn.title = item.title;
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => {
          if (template) {
            input.value = item.snippet;
            varChoice = null;
            input.focus();
            refresh();
          } else {
            insertAtCursor(item.snippet, item.caret);
          }
        });
        row.appendChild(btn);
        rendered.push({
          btn,
          hay: `${item.label} ${item.title ?? ""} ${item.snippet}`.toLowerCase(),
          row,
          labelEl: label,
        });
      }
      palette.appendChild(row);
    }
  };
  if (kind === "geometry") {
    renderGroups(SOLVE_SHAPES, true);
  } else {
    renderGroups(SOLVE_SYMBOLS, false);
    if (kind === "equation") renderGroups(SOLVE_EQUATIONS, true);
    if (kind === "derivative") renderGroups(SOLVE_CALCULUS, true);
    if (kind === "ode") renderGroups(SOLVE_ODES, true);
  }
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const visibleLabels = new Set<HTMLElement>();
    for (const r of rendered) {
      const show = !q || r.hay.includes(q);
      r.btn.style.display = show ? "" : "none";
      if (show) visibleLabels.add(r.labelEl);
    }
    // Hide group headings whose every button is filtered out.
    const labels = new Set(rendered.map((r) => r.labelEl));
    for (const l of labels) l.style.display = visibleLabels.has(l) ? "" : "none";
    for (const r of rendered) r.row.style.display = ""; // rows collapse naturally
  });

  // ---- Draw-to-solve (geometry kind only) -----------------------------------
  //
  // The drawing surface is an INPUT METHOD: every gesture becomes text in the
  // geometry grammar (src/lib/geometryDraw.ts), written into the input box so
  // the ordinary live-solve path runs on it — one engine, one source of truth,
  // and the user sees the request they could have typed. Events are deferred
  // to requestAnimationFrame, the pattern the chemistry CanvasEditor settled
  // on: pointermove at input rate re-rendered synchronously janks the dialog.
  if (kind === "geometry") {
    const wrap = byId<HTMLElement>("draw-wrap");
    const toolsEl = byId<HTMLElement>("draw-tools");
    const surface = byId<HTMLElement>("draw-surface");
    const note = byId<HTMLElement>("draw-note");
    wrap.style.display = "block";

    let draw = emptyDrawState("triangle");
    let hover: DrawPt | null = null;
    let dragging: HandleRef | null = null;
    let frame = 0;
    let needSync = false;

    const TOOL_DEFS: { id: DrawTool | "close" | "undo" | "clear"; label: string; title: string }[] = [
      { id: "select", label: "Select", title: "Drag any handle to reshape — the numbers follow" },
      { id: "triangle", label: "Triangle", title: "Three clicks" },
      { id: "rectangle", label: "Rectangle", title: "Two opposite corners" },
      { id: "circle", label: "Circle", title: "Click the centre, then the rim" },
      { id: "polygon", label: "Polygon", title: "Click vertices; double-click or Close to finish" },
      { id: "segment", label: "Segment", title: "Two endpoints — a second segment intersects the two lines" },
      { id: "close", label: "Close shape", title: "Finish the pending polygon" },
      { id: "undo", label: "Undo", title: "Remove the last point or shape" },
      { id: "clear", label: "Clear", title: "Start over" },
    ];
    const toolBtns = new Map<string, HTMLButtonElement>();
    const markActive = (): void => {
      for (const [id, b] of toolBtns) b.classList.toggle("is-on", id === draw.tool);
    };

    const paint = (): void => {
      surface.innerHTML = renderDrawSvg(draw, hover);
      note.textContent = draw.pending.length || !draw.shapes.length
        ? describePending(draw)
        : emitDsl(draw).note;
    };
    const syncInput = (): void => {
      // Unconditional: a WITHHELD emission (self-crossing polygon → "") must
      // clear the previous request, not leave stale numbers under a drawing
      // that no longer means them.
      input.value = emitDsl(draw).text;
      varChoice = null;
      refresh();
    };
    const schedule = (sync: boolean): void => {
      if (sync) needSync = true;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
        if (needSync) {
          needSync = false;
          syncInput();
        }
      });
    };

    for (const def of TOOL_DEFS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "draw-btn";
      btn.textContent = def.label;
      btn.title = def.title;
      btn.addEventListener("click", () => {
        if (def.id === "close") draw = closePolygon(draw);
        else if (def.id === "undo") draw = undo(draw);
        else if (def.id === "clear") draw = clearAll(draw);
        else draw = setTool(draw, def.id);
        markActive();
        schedule(true);
      });
      toolsEl.appendChild(btn);
      toolBtns.set(def.id, btn);
    }
    markActive();

    const toWorld = (ev: PointerEvent): DrawPt => {
      // Through the viewBox, not the world box: the SVG carries a grid-free
      // footer strip below the canvas, so rect.height covers MORE than
      // WORLD_H units and mapping straight to WORLD_H would skew every y.
      const svg = surface.querySelector("svg");
      const r = (svg ?? surface).getBoundingClientRect();
      const unitsPerPx = DRAW_VIEW.w / WORLD_W; // svg px per world unit
      const svgX = ((ev.clientX - r.left) / Math.max(1, r.width)) * DRAW_VIEW.w;
      const svgY = ((ev.clientY - r.top) / Math.max(1, r.height)) * DRAW_VIEW.h;
      return { x: svgX / unitsPerPx, y: WORLD_H - svgY / unitsPerPx };
    };

    surface.addEventListener("pointerdown", (ev) => {
      const w = toWorld(ev);
      // The footer strip (below the grid) maps to y < 0 — clicking the
      // coordinate readout must not mint a clamped vertex on the x-axis.
      if (w.y < 0) return;
      if (draw.tool === "select") {
        dragging = hitHandle(draw, w);
        if (dragging) surface.setPointerCapture(ev.pointerId);
        return;
      }
      draw = clickAt(draw, w);
      schedule(true);
    });
    surface.addEventListener("pointermove", (ev) => {
      const w = toWorld(ev);
      hover = w.y < 0 ? null : snapPt(w);
      if (dragging) {
        const next = dragHandle(draw, dragging, w);
        if (next !== draw) {
          draw = next;
          schedule(true);
          return;
        }
      }
      schedule(false);
    });
    surface.addEventListener("pointerup", () => {
      if (dragging) {
        dragging = null;
        schedule(true);
      }
    });
    surface.addEventListener("pointercancel", () => {
      // A cancelled pointer (touch scroll, window switch) must not leave a
      // phantom drag that follows the next hover with no button held.
      dragging = null;
      schedule(false);
    });
    surface.addEventListener("pointerleave", () => {
      hover = null;
      schedule(false);
    });
    surface.addEventListener("dblclick", () => {
      draw = closePolygon(draw);
      schedule(true);
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && draw.pending.length) {
        draw = setTool(draw, draw.tool); // clears pending, keeps the tool
        schedule(false);
      }
    });

    // Only a drawing that still MATCHES the text AND is fully described by it
    // travels — the first-shape-only fallback (overlapping cutouts, strays)
    // must not carry shapes the answer ignores into the inserted figure.
    drawingToCarry = () =>
      shapesDescribeEmit(draw.shapes) && emitDsl(draw).text === input.value.trim()
        ? draw.shapes
        : undefined;

    paint();
  }

  // ---- Sketch data → function (equation kind only) --------------------------
  //
  // Click points on a four-quadrant grid; every model that legitimately runs
  // is presented as a chip with its adjusted R² — NEVER auto-picked. Choosing
  // a chip shows the overlay (points + that exact curve) and writes
  // "y = <expression>" into the input, so Use / typeset / insert all run on
  // the formula the user chose. The R² beside each formula is computed FROM
  // the displayed expression (rounded coefficients), not a hidden one.
  if (kind === "equation") {
    const wrap = byId<HTMLElement>("draw-wrap");
    const toolsEl = byId<HTMLElement>("draw-tools");
    const surface = byId<HTMLElement>("draw-surface");
    const note = byId<HTMLElement>("draw-note");

    let sketchOn = false;
    let pts: SketchPt[] = [];
    let hover: SketchPt | null = null;
    let chosen: FitResult | null = null;
    let frame = 0;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "draw-btn";
    toggleBtn.textContent = "Sketch data → function";
    toggleBtn.title = "Click data points on a grid; candidate fits are ranked by adjusted R² — you choose";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "draw-btn";
    clearBtn.textContent = "Clear points";
    clearBtn.style.display = "none";
    const chips = document.createElement("div");
    chips.className = "chip-row";
    toolsEl.appendChild(toggleBtn);
    toolsEl.appendChild(clearBtn);
    toolsEl.appendChild(chips);
    wrap.style.display = "block";
    surface.style.display = "none";

    const paint = (): void => {
      surface.innerHTML = sketchSurfaceSvg(pts, hover);
    };
    const renderFits = (): void => {
      chips.replaceChildren();
      // Changing the data invalidates the chosen fit — and the OVERLAY must
      // go with it, or it keeps plotting points that are no longer the drawn
      // set (its own stated rule, applied to itself).
      if (chosen) figure.style.display = "none";
      chosen = null;
      if (pts.length < 3) {
        note.textContent = pts.length
          ? `${pts.length} point${pts.length === 1 ? "" : "s"} — three or more unlock the fits.`
          : "Click points on the grid; the candidate functions appear here.";
        return;
      }
      const outcome = fitSketch(pts);
      if (outcome.refusal) {
        note.textContent = outcome.refusal;
        return;
      }
      for (const fit of outcome.fits) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = Number.isFinite(fit.adjR2)
          ? `${fit.model} R²adj ${Math.round(fit.adjR2 * 1000) / 1000}`
          : `${fit.model} R² ${Math.round(fit.r2 * 1000) / 1000} (adj n/a)`;
        chip.title = `y = ${fit.expr}`;
        chip.addEventListener("click", () => {
          chosen = fit;
          for (const c of chips.children) c.classList.toggle("is-on", c === chip);
          figure.innerHTML = sketchFitSvg(pts, fit);
          figure.style.display = "block";
          input.value = `y = ${fit.expr}`;
          varChoice = null;
          refresh();
          note.textContent = fit.caveats.join(" ") ||
            "Ranked by ADJUSTED R² — extra parameters always flatter plain R². The choice stays yours.";
        });
        chips.appendChild(chip);
      }
      const skippedTxt = outcome.skipped.map((s) => `${s.model} (${s.reason})`).join("; ");
      note.textContent =
        `${outcome.fits.length} fit${outcome.fits.length === 1 ? "" : "s"} — click one to see it and use it.` +
        (skippedTxt ? ` Skipped: ${skippedTxt}.` : "");
    };
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };

    toggleBtn.addEventListener("click", () => {
      sketchOn = !sketchOn;
      toggleBtn.classList.toggle("is-on", sketchOn);
      surface.style.display = sketchOn ? "block" : "none";
      clearBtn.style.display = sketchOn ? "inline-block" : "none";
      if (sketchOn) {
        paint();
        renderFits();
      } else {
        note.textContent = "";
        chips.replaceChildren();
      }
    });
    clearBtn.addEventListener("click", () => {
      pts = [];
      chosen = null;
      figure.style.display = "none";
      paint();
      renderFits();
    });

    const toSketchWorld = (ev: PointerEvent): SketchPt => {
      const svg = surface.querySelector("svg");
      const r = (svg ?? surface).getBoundingClientRect();
      const unitsPerPx = SK_VIEW.w / (SK_X1 - SK_X0);
      const svgX = ((ev.clientX - r.left) / Math.max(1, r.width)) * SK_VIEW.w;
      const svgY = ((ev.clientY - r.top) / Math.max(1, r.height)) * SK_VIEW.h;
      return { x: SK_X0 + svgX / unitsPerPx, y: SK_Y1 - svgY / unitsPerPx };
    };

    surface.addEventListener("pointerdown", (ev) => {
      if (!sketchOn) return;
      const w = toSketchWorld(ev);
      if (w.y < SK_Y0) return; // the footer strip
      const q = skSnapPt(w);
      const at = pts.findIndex((z) => z.x === q.x && z.y === q.y);
      if (at >= 0) pts.splice(at, 1); // click a point to remove it
      else pts.push(q);
      paint();
      renderFits();
    });
    surface.addEventListener("pointermove", (ev) => {
      if (!sketchOn) return;
      const w = toSketchWorld(ev);
      hover = w.y < SK_Y0 ? null : skSnapPt(w);
      schedule();
    });
    surface.addEventListener("pointerleave", () => {
      hover = null;
      schedule();
    });
    // A hand-edited input no longer means the chosen fit — the overlay must
    // not keep asserting a curve the request stopped describing.
    input.addEventListener("input", () => {
      if (chosen && input.value.trim() !== `y = ${chosen.expr}`) {
        chosen = null;
        figure.style.display = "none";
        for (const c of chips.children) c.classList.remove("is-on");
      }
    });
  }

  input.addEventListener("input", () => {
    varChoice = null;
    refresh();
  });
  graphFrom.addEventListener("input", () => renderGraph());
  graphTo.addEventListener("input", () => renderGraph());
  boundA.addEventListener("input", refresh);
  boundB.addEventListener("input", refresh);
  refresh();

  byId<HTMLButtonElement>("use-btn").addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) {
      const err = byId<HTMLElement>("error");
      err.textContent = "Nothing composed yet — build an equation, or Cancel.";
      err.style.display = "block";
      return;
    }
    Office.context.ui.messageParent(JSON.stringify({ expr: input.value, drawing: drawingToCarry() }));
  });

  byId<HTMLButtonElement>("cancel-btn").addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ cancel: true }));
  });
});
