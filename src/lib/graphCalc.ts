// Graphing-calculator sampling for the equation canvas: each input line
// becomes one or two curves (a bare expression plots as y = f(x); an equation
// plots BOTH sides, so their crossings ARE the solutions on screen). Pure
// sampling — the drawing itself is the shared buildPlotSvg, the same plotter
// every other figure in the product uses.
//
// Honesty rules carried over from the pane's own plots: the sweep window is
// the user's, but the sample count is fixed and every non-finite or absurdly
// large value becomes a GAP rather than a spike to ±1e300 — a pole plotted as
// a wall is a lie about the function. Lines that cannot be graphed say why,
// per line, instead of vanishing.

import { parseExpr, evalAst, freeVars, Expr } from "./solve";
import { foldPastedMath } from "./pasteMath";
import { Series } from "./plot";

export interface GraphWindow {
  xMin: number;
  xMax: number;
}

export interface GraphResult {
  series: Series[];
  /** Per-line problems and global notes — shown, never swallowed. */
  notes: string[];
  /** The variable swept on the horizontal axis. */
  variable: string | null;
}

const N_SAMPLES = 241;
const Y_CLAMP = 1e8;
const MAX_LINES = 8;

const COLORS = ["#0c4a6e", "#b91c1c", "#15803d", "#7c3aed", "#b45309", "#0e7490", "#9d174d", "#374151"];

interface ParsedLine {
  label: string;
  exprs: Array<{ ast: Expr; label: string }>;
}

/** `y = x^2` → the x^2 side; `x^2 = 2x+1` → both sides; `x^2-3` → itself. */
function parseLine(raw: string): ParsedLine | { error: string } {
  const folded = foldPastedMath(raw).text.trim();
  if (!folded) return { error: "empty line" };
  const parts = folded.split("=").map((p) => p.trim());
  if (parts.length > 2) return { error: "more than one = sign" };
  try {
    if (parts.length === 2) {
      // `y = …` / `f(x) = …` is a labelled single curve, not a two-sided equation.
      if (/^(y|f\s*\(\s*[a-z]\s*\))$/i.test(parts[0])) {
        return { label: raw, exprs: [{ ast: parseExpr(parts[1]), label: raw.trim() }] };
      }
      return {
        label: raw,
        exprs: [
          { ast: parseExpr(parts[0]), label: parts[0] },
          { ast: parseExpr(parts[1]), label: parts[1] },
        ],
      };
    }
    return { label: raw, exprs: [{ ast: parseExpr(parts[0]), label: raw.trim() }] };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Samples every graphable line over the window. The sweep variable is the one
 * free variable the lines agree on (x preferred); a line with OTHER free
 * variables is reported, not guessed at.
 */
export function graphSeries(input: string, win: GraphWindow): GraphResult {
  const notes: string[] = [];
  const rawLines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!rawLines.length) return { series: [], notes: ["Nothing to graph yet."], variable: null };
  if (!(Number.isFinite(win.xMin) && Number.isFinite(win.xMax)) || win.xMax <= win.xMin) {
    return { series: [], notes: ["The window needs numeric bounds with x-from below x-to."], variable: null };
  }
  const lines = rawLines.slice(0, MAX_LINES);
  if (rawLines.length > MAX_LINES) {
    notes.push(`Graphing the first ${MAX_LINES} lines — ${rawLines.length - MAX_LINES} more were not drawn.`);
  }

  // Pick the sweep variable: x if any line uses it, else the single variable
  // shared across everything graphable.
  const parsed = lines.map(parseLine);
  const allVars = new Set<string>();
  for (const p of parsed) {
    if ("error" in p) continue;
    for (const e of p.exprs) for (const v of freeVars(e.ast)) allVars.add(v);
  }
  let variable: string | null = null;
  if (allVars.has("x")) variable = "x";
  else if (allVars.size === 1) variable = [...allVars][0];
  else if (allVars.size === 0) variable = "x"; // constants still draw as flat lines
  else {
    return {
      series: [],
      notes: [`Several different symbols (${[...allVars].join(", ")}) — a graph sweeps ONE variable; use x, or give the others values.`],
      variable: null,
    };
  }

  const series: Series[] = [];
  let color = 0;
  parsed.forEach((p, li) => {
    if ("error" in p) {
      notes.push(`Line ${li + 1} not graphed: ${p.error.replace(/\.$/, "")}.`);
      return;
    }
    for (const e of p.exprs) {
      const extra = freeVars(e.ast).filter((v) => v !== variable);
      if (extra.length) {
        notes.push(`"${e.label}" not graphed — it also contains ${extra.join(", ")} (the sweep is over ${variable}).`);
        continue;
      }
      // Contiguous finite runs become SEPARATE segments: the shared plotter
      // filters non-finite points and connects what remains, which would draw
      // a wall straight across a pole of 1/x. A gap must stay a gap.
      const segments: Array<Array<{ x: number; y: number }>> = [[]];
      let finite = 0;
      for (let i = 0; i < N_SAMPLES; i++) {
        const x = win.xMin + ((win.xMax - win.xMin) * i) / (N_SAMPLES - 1);
        let y = NaN;
        try {
          y = evalAst(e.ast, { [variable!]: x });
        } catch {
          /* non-finite — ends the current segment */
        }
        if (Number.isFinite(y) && Math.abs(y) <= Y_CLAMP) {
          segments[segments.length - 1].push({ x, y });
          finite++;
        } else if (segments[segments.length - 1].length) {
          segments.push([]);
        }
      }
      if (!finite) {
        notes.push(`"${e.label}" produced no finite values in this window.`);
        continue;
      }
      const c = COLORS[color++ % COLORS.length];
      let labelled = false;
      for (const seg of segments) {
        if (seg.length < 2) continue;
        series.push({ points: seg, type: "line", label: labelled ? undefined : e.label, color: c });
        labelled = true;
      }
      if (!labelled && finite) {
        // Only isolated single samples survived (a very spiky function) —
        // draw them as points rather than nothing.
        series.push({ points: segments.flat(), type: "scatter", label: e.label, color: c });
      }
    }
  });
  return { series, notes, variable };
}
