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
  PaletteGroup,
} from "../lib/palettes";
import { mathToHtml } from "../lib/mathHtml";
import { solveInputToTypesetLines, solveToTypesetDsl, isProseRequest } from "../lib/solveTypeset";
import { foldPastedMath } from "../lib/pasteMath";
import { graphSeries, GraphWindow } from "../lib/graphCalc";
import { buildPlotSvg } from "../lib/plot";
import { solveEquation, differentiate, antiderivative, integrate, parseExpr, evalAst } from "../lib/solve";
import { equationWork, derivativeWork, definiteIntegralWork, WorkLine } from "../lib/showWork";
import { limit as evalLimit, taylorSeries, parseLimitRequest, parseSeriesRequest } from "../lib/analysis";
import { solveInequality } from "../lib/inequalities";
import { splitEquations, solveSystem } from "../lib/systems";
import { solveGeometry } from "../lib/geometryParse";
import { solveComposite } from "../lib/compositeGeometry";
import { compositeShapeSvg } from "../lib/geometryChart";

type Kind = "equation" | "derivative" | "integral" | "geometry";

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
          ? "The figure draws below as you describe it."
          : "Type, click symbols, or PASTE from anywhere — a paper, Word, LaTeX. It draws here as real mathematics.";
      typeset.appendChild(hint);
      return;
    }
    if (kind === "geometry") {
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
          line(resultEl, g.title, "result-title");
          for (const v of g.values) {
            line(resultEl, `${v.label} = ${v.exact ?? v.value}${v.unit ? ` ${v.unit}` : ""}`, "result-line");
          }
          if (g.degenerate) line(resultEl, g.degenerate, "caveat");
        } else {
          status.textContent =
            "Not readable as geometry yet — try a shape (circle r=3) or a composite (rectangle 10 x 5 minus triangle b=4 h=3).";
        }
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

  /** The graphing calculator: every line a curve, the window the user's. */
  function renderGraph(): void {
    if (kind === "geometry") return;
    graphEl.replaceChildren();
    const raw = input.value;
    if (!raw.trim() || isProseRequest(foldPastedMath(raw.trim()).text)) {
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
    const folded = foldPastedMath(input.value.trim(), { geometry: kind === "geometry" });
    pasteNote.textContent = input.value.trim() ? folded.notes.join(" ") : "";
    renderTypeset(folded.text);
    renderResult(folded.text.trim());
    renderGraph();
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

  input.addEventListener("input", () => {
    varChoice = null;
    refresh();
  });
  graphFrom.addEventListener("input", renderGraph);
  graphTo.addEventListener("input", renderGraph);
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
    Office.context.ui.messageParent(JSON.stringify({ expr: input.value }));
  });

  byId<HTMLButtonElement>("cancel-btn").addEventListener("click", () => {
    Office.context.ui.messageParent(JSON.stringify({ cancel: true }));
  });
});
