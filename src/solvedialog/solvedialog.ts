// The pop-out equation canvas: compose a Solve input at size, with the
// equation DRAWN as real mathematics (radical signs, stacked fractions,
// relation glyphs) while you build it, and — for the geometry kind — the
// composite figure drawn live. Opened by the pane via Office's dialog API
// with the current input in the `expr` query parameter and the solve kind in
// `kind`; "Use this equation" hands the text back through messageParent.
//
// The dialog VALIDATES with the same engines the pane will use, so its
// "reads as…" line is a promise the pane keeps — but it deliberately does not
// duplicate the pane's full result rendering: composing happens here,
// solving happens where the derivation and the Insert button live.

import {
  SOLVE_SYMBOLS,
  SOLVE_EQUATIONS,
  SOLVE_SHAPES,
  PaletteGroup,
} from "../lib/palettes";
import { mathToHtml } from "../lib/mathHtml";
import { solveInputToTypesetLines, isProseRequest } from "../lib/solveTypeset";
import { solveEquation, parseExpr } from "../lib/solve";
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
  const status = byId<HTMLElement>("status");
  const info = byId<HTMLElement>("info");

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
      : `Equation canvas — ${kind === "equation" ? "solve / rearrange / systems / inequalities" : kind}`;

  /** The typeset view: every input line drawn as mathematics. */
  function renderTypeset(): void {
    typeset.replaceChildren();
    const raw = input.value;
    if (!raw.trim()) {
      typeset.style.display = "block";
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent =
        kind === "geometry"
          ? "The figure draws below as you describe it."
          : "The equation draws here as you build it — √, fractions and powers as they will look.";
      typeset.appendChild(hint);
      return;
    }
    if (kind === "geometry") {
      // Geometry input is a shape DSL, not an equation — the FIGURE is its
      // drawing. Hide the strip rather than leaving a blank band.
      typeset.style.display = "none";
      return;
    }
    typeset.style.display = "block";
    // Limit/series prose is not an expression — showing it "typeset" would
    // draw the keywords as juxtaposed variables.
    if (isProseRequest(raw)) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = "Limit/series requests are prose — they solve as typed.";
      typeset.appendChild(hint);
      return;
    }
    for (const line of solveInputToTypesetLines(raw)) {
      const div = document.createElement("div");
      div.className = "line";
      try {
        div.innerHTML = mathToHtml(line);
      } catch {
        div.textContent = line; // untypesettable mid-edit states show as-is
      }
      typeset.appendChild(div);
    }
  }

  /** The validation line: what the pane's engines will read this as. */
  function renderStatus(): void {
    const text = input.value.trim();
    status.classList.remove("bad");
    if (!text) {
      status.textContent = "";
      figure.style.display = "none";
      return;
    }
    try {
      if (kind === "geometry") {
        const comp = solveComposite(text);
        if (comp && !comp.incomplete) {
          figure.innerHTML = compositeShapeSvg(comp);
          figure.style.display = "block";
          status.textContent = "Reads as a composite figure — drawn above.";
          return;
        }
        figure.style.display = "none";
        if (comp && comp.incomplete) {
          status.classList.add("bad");
          status.textContent = `Almost there — ${comp.incomplete}.`;
          return;
        }
        status.textContent = solveGeometry(text)
          ? "Reads as geometry."
          : "Not readable as geometry yet — try a shape (circle r=3) or a composite (rectangle 10 x 5 minus triangle b=4 h=3).";
        return;
      }
      figure.style.display = "none";
      if (kind === "equation") {
        if (/[<>≤≥≠]|!=/.test(text) && !text.includes("\n")) {
          status.textContent = solveInequality(text)
            ? "Reads as an inequality."
            : "Not readable as an inequality yet.";
          return;
        }
        const eqs = splitEquations(text);
        if (eqs.length > 1) {
          status.textContent = solveSystem(eqs)
            ? `Reads as a system of ${eqs.length} equations.`
            : "Not readable as a system yet.";
          return;
        }
        const r = solveEquation(text);
        if (r) {
          const unknowns = r.unknowns && r.unknowns.length > 1 ? ` — unknowns: ${r.unknowns.join(", ")}` : "";
          status.textContent = `Reads as an equation${unknowns}.`;
          return;
        }
        // An expression without "=" is still useful input mid-composition.
        parseExpr(text.replace(/=.*$/, "").trim() || text);
        status.textContent = "Parses — add “= …” to make it an equation.";
        return;
      }
      // derivative / integral: limit and Taylor/Maclaurin PROSE is valid
      // derivative-kind input — the pane accepts it, so this line must too
      // (its whole point is being a promise the pane keeps).
      if (kind === "derivative" && isProseRequest(text)) {
        status.textContent = "Reads as a limit / series request.";
        return;
      }
      parseExpr(text);
      status.textContent = kind === "integral" ? "Parses — the integrand is read." : "Parses.";
    } catch (error) {
      status.classList.add("bad");
      status.textContent = (error as Error).message;
    }
  }

  function refresh(): void {
    renderTypeset();
    renderStatus();
  }

  function insertAtCursor(snippet: string, caret?: number): void {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + snippet + input.value.slice(end);
    const pos = start + (caret ?? snippet.length);
    input.focus();
    input.setSelectionRange(pos, pos);
    refresh();
  }

  // Palette: same data the pane renders, at dialog size. Symbols insert at
  // the caret; equation/shape templates replace the input.
  const palette = byId<HTMLElement>("palette");
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
            input.focus();
            refresh();
          } else {
            insertAtCursor(item.snippet, item.caret);
          }
        });
        row.appendChild(btn);
      }
      palette.appendChild(row);
    }
  };
  if (kind === "geometry") {
    renderGroups(SOLVE_SHAPES, true);
  } else {
    renderGroups(SOLVE_SYMBOLS, false);
    if (kind === "equation") renderGroups(SOLVE_EQUATIONS, true);
  }

  input.addEventListener("input", refresh);
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
