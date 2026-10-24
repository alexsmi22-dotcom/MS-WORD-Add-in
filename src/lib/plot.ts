// Lightweight pure-SVG plotter: function plots (y = f(x)) and data plots (scatter
// / line, optional error bars), with axes, ticks, and labels. Includes a small,
// safe expression evaluator (no eval/Function) so the add-in stays offline and
// CSP-clean. The task pane rasterizes the SVG to PNG and inserts it as a picture.
//
// Pure logic — no Office.js — fully unit-testable.

// --- Expression evaluator ----------------------------------------------------

import { minOf, maxOf } from "./minmax";
import { linearAxis, logAxis, fmtValue, fmtSig, resolveLimits, outsideNote, type AxisLimits } from "./axis";
import { usptoMarkerSvg, USPTO_DASHES } from "./figureStyle";

/** Factorial for non-negative integers (else NaN). */
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  // 171! already overflows to Infinity, and the loop below is O(n): fact(1e12)
  // never returned (a frozen Word). Same value, bounded time.
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

import { foldAbsBars } from "./solve";
import { composePanels } from "./panels";
import { readDataBlock } from "./dataBlock";

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  // `log` is base 10, matching stats.ts, solve.ts and every spreadsheet.
  // It used to be the natural log here alone, so the same formula gave a
  // different curve in Plot than in Stats. `ln` is the natural log.
  log: Math.log10, ln: Math.log, log10: Math.log10, log2: Math.log2, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  fact: factorial, factorial,
};

/** Multi-argument functions. Arity is validated in the evaluator. */
const FUNCS_N: Record<string, { arity: number | "var"; fn: (a: number[]) => number }> = {
  atan2: { arity: 2, fn: (a) => Math.atan2(a[0], a[1]) },
  // True modulo: the result carries the sign of the divisor, matching
  // stats.ts. JS % is a remainder, so mod(-7, 3) was -1 here and 2 there.
  mod: { arity: 2, fn: (a) => a[0] - a[1] * Math.floor(a[0] / a[1]) },
  pow: { arity: 2, fn: (a) => Math.pow(a[0], a[1]) },
  hypot: { arity: "var", fn: (a) => Math.hypot(...a) },
  min: { arity: "var", fn: (a) => minOf(a) },
  max: { arity: "var", fn: (a) => maxOf(a) },
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/**
 * Evaluates a math expression in one variable `x`. Supports + - * / ^, unary
 * minus, parentheses, the functions in FUNCS, and the constants pi/e/tau. Throws
 * on a malformed expression.
 */
/**
 * Textbook notation the plotter's own grammar lacks, folded before parsing:
 * a leading "f(x) =" / "y =" definition prefix (this is a PLOTTER — the
 * definition is exactly what the user wants drawn), and |·| bars → abs(·).
 * Known function names never count as a definition prefix, so "sin(x) = …"
 * is untouched (and still refused, since an equation is not a curve).
 */
/**
 * Typed symbols the grammar spells in ASCII: U+2212 minus → "-", π → pi, θ → theta,
 * with the multiplication a textbook leaves implicit made explicit next to the
 * symbol only ("2θ" → 2*theta, "3π/2" → 3*pi/2, "θ(1 + θ)" → theta*(1 + theta)).
 * Every one of these characters was a parse error before, so no formula that
 * used to plot changes; the grammar's own rule (2x is refused) is untouched.
 */
export function foldPlotSymbols(expr: string): string {
  let s = expr.split(String.fromCharCode(0x2212)).join("-");
  for (const [code, name] of [
    [0x3b8, "theta"],
    [0x3c0, "pi"],
  ] as [number, string][]) {
    const ch = String.fromCharCode(code);
    if (!s.includes(ch)) continue;
    s = s.replace(new RegExp(`([0-9A-Za-z_.)])\\s*${ch}`, "g"), `$1*${ch}`);
    s = s.replace(new RegExp(`${ch}\\s*(?=[0-9A-Za-z_(${String.fromCharCode(0x3b8)}${String.fromCharCode(0x3c0)}])`, "g"), `${ch}*`);
    s = s.split(ch).join(name);
  }
  return s;
}

function normalizePlotExpr(expr: string): string {
  let s = foldAbsBars(foldPlotSymbols(expr));
  const def = /^\s*([A-Za-z_]\w*)\s*\(\s*x\s*\)\s*=\s*([^=]+)$/.exec(s);
  if (def && !(def[1].toLowerCase() in FUNCS) && !(def[1].toLowerCase() in FUNCS_N)) {
    s = def[2];
  } else {
    const yDef = /^\s*y\s*=\s*([^=]+)$/.exec(s);
    if (yDef) s = yDef[1];
  }
  return s;
}

export function evalExpr(expr: string, x: number): number {
  // ONE GRAMMAR. y = f(x) is the compiler below with the single variable x, so
  // Plot's new kinds (x(t), r(θ), z(x, y)) cannot parse a formula differently
  // from the plot the product has always drawn. Same folding, same errors, same
  // numbers — pinned against a frozen copy of the old evaluator in
  // plotKinds.test.ts.
  return compileRaw(normalizePlotExpr(expr), ["x"])([x]);
}

/** A parsed formula, evaluated per point with the variables in `vars` order. */
export type CompiledExpr = (vals: readonly number[]) => number;

/**
 * Parses `expr` ONCE in the variables `vars` and returns an evaluator.
 *
 * For grids (a 200 × 200 contour is 40 000 points) parsing per point is the cost
 * that matters, so the parse happens here and the closure only does arithmetic.
 * Any symbol that is not one of `vars` or a constant throws "Unknown symbol" at
 * compile time, exactly as `x` alone did in evalExpr: a contour formula that
 * mentions t is refused, not read as zero. No prefix folding is done here — a
 * caller strips its own "z =" / "r(θ) =" definition first.
 */
export function compileExpr(expr: string, vars: readonly string[]): CompiledExpr {
  return compileRaw(foldAbsBars(foldPlotSymbols(expr)), vars);
}

function compileRaw(src: string, vars: readonly string[]): CompiledExpr {
  let i = 0;
  const s = src.replace(/\s+/g, "");
  type N = CompiledExpr;

  function parseExpr(): N {
    let v = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const l = v;
      const r = parseTerm();
      v = op === "+" ? (e) => l(e) + r(e) : (e) => l(e) - r(e);
    }
    return v;
  }
  function parseTerm(): N {
    let v = parseUnary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const l = v;
      const r = parseUnary();
      v = op === "*" ? (e) => l(e) * r(e) : (e) => l(e) / r(e);
    }
    return v;
  }
  // Unary minus binds looser than ^, so -x^2 = -(x^2) (the usual convention).
  function parseUnary(): N {
    if (s[i] === "-") {
      i++;
      const a = parseUnary();
      return (e) => -a(e);
    }
    if (s[i] === "+") {
      i++;
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower(): N {
    const base = parseAtom();
    if (s[i] === "^") {
      i++;
      const ex = parseUnary(); // right-associative; exponent may be signed
      return (e) => Math.pow(base(e), ex(e));
    }
    return base;
  }
  function parseAtom(): N {
    if (s[i] === "(") {
      i++;
      const v = parseExpr();
      if (s[i] !== ")") throw new Error("Missing ')'");
      i++;
      return v;
    }
    // number
    const numMatch = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(s.slice(i));
    if (numMatch) {
      i += numMatch[0].length;
      const c = parseFloat(numMatch[0]);
      return () => c;
    }
    // identifier (variable, constant, or function)
    const idMatch = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (idMatch) {
      const id = idMatch[0];
      i += id.length;
      if (s[i] === "(") {
        i++;
        const args = [parseExpr()];
        while (s[i] === ",") {
          i++;
          args.push(parseExpr());
        }
        if (s[i] !== ")") throw new Error("Missing ')'");
        i++;
        const key = id.toLowerCase();
        if (FUNCS[key]) {
          if (args.length !== 1) throw new Error(`${id} takes 1 argument`);
          const f = FUNCS[key];
          const a = args[0];
          return (e) => f(a(e));
        }
        const nf = FUNCS_N[key];
        if (nf) {
          if (nf.arity !== "var" && args.length !== nf.arity) throw new Error(`${id} takes ${nf.arity} arguments`);
          if (nf.arity === "var" && args.length < 1) throw new Error(`${id} needs an argument`);
          const fn = nf.fn;
          return (e) => fn(args.map((a) => a(e)));
        }
        throw new Error(`Unknown function ${id}`);
      }
      const k = vars.indexOf(id);
      if (k >= 0) return (e) => e[k];
      if (id.toLowerCase() in CONSTS) {
        const c = CONSTS[id.toLowerCase()];
        return () => c;
      }
      throw new Error(`Unknown symbol ${id}`);
    }
    throw new Error(`Unexpected "${s[i] ?? "end"}"`);
  }

  const result = parseExpr();
  if (i !== s.length) throw new Error(`Unexpected "${s[i]}"`);
  return result;
}

export interface Point {
  x: number;
  y: number;
  err?: number;
  /** A line series starts a new piece here (no connector from the previous point): a pole or a gap. */
  gap?: boolean;
}

/**
 * Samples y = f(x) across [xmin, xmax], dropping non-finite points.
 *
 * POLES BREAK THE LINE (fix2-paf). tan(x) and 1/x used to be drawn with a
 * near-vertical connector from +big to −big across every pole, and samples
 * either side of a non-finite stretch were joined across it. A point after a
 * dropped sample, or after a sign-changing jump larger than twice the
 * function's robust (5th–95th percentile) span, starts a new piece.
 */
export function samplePlot(expr: string, xmin: number, xmax: number, samples = 200): Point[] {
  const pts: Point[] = [];
  const n = Math.max(2, Math.floor(samples));
  let dropped = false;
  for (let k = 0; k < n; k++) {
    const x = xmin + ((xmax - xmin) * k) / (n - 1);
    let y: number;
    try {
      y = evalExpr(expr, x);
    } catch {
      throw new Error("Could not evaluate the function.");
    }
    if (Number.isFinite(y)) {
      pts.push(dropped && pts.length ? { x, y, gap: true } : { x, y });
      dropped = false;
    } else dropped = true;
  }
  const r = robustRange(pts.map((p) => p.y));
  if (r) {
    const span = Math.max(r.hi - r.lo, 1e-300);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1].y;
      const b = pts[k].y;
      if (a * b < 0 && Math.abs(b - a) > 2 * span) pts[k].gap = true;
    }
  }
  return pts;
}

/** The 5th and 95th percentiles of the finite values (null for fewer than 4). */
export function robustRange(values: number[]): { lo: number; hi: number } | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const q = (p: number): number => {
    const i = p * (v.length - 1);
    const f = Math.floor(i);
    return v[f] + (v[Math.min(f + 1, v.length - 1)] - v[f]) * (i - f);
  };
  return { lo: q(0.05), hi: q(0.95) };
}

/**
 * y-axis limits for sampled functions whose poles would otherwise set the
 * range (fix2-paf: tan(x) on [−5, 5] drew a flat line between ±10⁷ spikes).
 * When the extremes run more than three robust spans past the 5th–95th
 * percentiles, the axis is limited to those percentiles plus a quarter span
 * each side (points beyond are clipped at the frame and counted in a note).
 * Null when the range is already honest.
 */
export function robustYLimits(series: Series[]): AxisLimits | null {
  // ONLY WHERE A POLE OR A GAP WAS DETECTED (samplePlot's `gap`): a narrow
  // finite peak (a Lorentzian 1/(x² + 0.001)) is data, and clipping it would
  // misdraw it.
  if (!series.some((s) => s.points.some((p) => p.gap))) return null;
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
  const r = robustRange(ys);
  if (!r) return null;
  const span = r.hi - r.lo;
  if (!(span > 0)) return null;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  if (hi <= r.hi + 3 * span && lo >= r.lo - 3 * span) return null;
  return { min: Math.max(lo, r.lo - 0.25 * span), max: Math.min(hi, r.hi + 0.25 * span) };
}

/**
 * A y = f(x) expression as a legend label under the display contract (fix2-paf):
 * "x^2/50" → "x²/50", "exp(-x^2)" → "exp(−x²)", "2*x" → "2·x". Every hyphen
 * in an expression is a minus.
 */
export function typesetExprLabel(expr: string): string {
  const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
  return expr
    .replace(/\*\*/g, "^")
    .replace(/\^(?:\((-?\d+)\)|(-?\d+)(?![\d.]))/g, (_m, a: string | undefined, b: string | undefined) =>
      [...(a ?? b ?? "")].map((c) => SUP[c] ?? c).join(""),
    )
    .replace(/\s*\*\s*/g, "·")
    .replace(/-/g, "−");
}

/** Most data rows the y = f(x) data box reads (a figure of more points is not a figure anyone reads). */
export const PLOT_DATA_ROWS_MAX = 100_000;

export type PlotData = { ok: true; points: Point[]; notes: string[] } | { ok: false; error: string };

/**
 * Reads the y = f(x) data box: "x y [err]" per line, through RULE N (dataBlock.readDataBlock,
 * the one reader the two-y-axes data, titration and materials tools use). Release D: the old
 * splitter cut on every comma, so a European "2,5 3,5" became x = 2, y = 5, err = 3 — a
 * confident wrong figure. Now:
 *   - one field-separator decision per block (tab, else semicolon, else spaces and ", ", else
 *     bare commas), so "1,2" and "0, 1" still read as x, y and "2,5 3,5" reads as 2.5, 3.5;
 *   - a block mixing 2.5 and 3,5, an undecidable "1,000", a word inside the data, or a line
 *     with only one number is REFUSED by name (it used to be split, dropped or skipped silently);
 *   - a first line of words is a header (named in a note); lines starting with # are comments;
 *   - a missing x or y (-, NA, nan, ., an empty tab cell) leaves that line out, and a note says
 *     how many; a missing err only drops that point's bar; fields after the third are not
 *     plotted, and a note says so;
 *   - U+2212 and the en dash read as minus; 1×10³ and 50 % read as the product displays them.
 * Empty input (or only comments) is ok with no points: the box is optional.
 */
export function readPlotData(text: string): PlotData {
  const src = (text ?? "").split(/\r\n?|\n/);
  // Comments become blank lines, so the reader's line numbers still match the paste.
  const clean = src.map((l) => (l.trim().startsWith("#") ? "" : l)).join("\n");
  if (!clean.trim()) return { ok: true, points: [], notes: [] };
  const b = readDataBlock(clean, "The data", { maxRows: PLOT_DATA_ROWS_MAX });
  if (!b.ok) return { ok: false, error: b.error };
  const points: Point[] = [];
  let skipped = 0;
  let extra = 0;
  for (let k = 0; k < b.rows.length; k++) {
    const r = b.rows[k];
    const filled = r.filter((v) => v !== null).length;
    if (r.length < 2 && filled === 1) {
      const line = b.lines[k];
      const typed = (src[line - 1] ?? "").trim();
      // "0,1" among lines separated by spaces is ONE comma-number (RULE N1 decides the separator per block).
      const why = typed.includes(",") ? " (a comma with no space after it is part of a number when other lines are separated by spaces, tabs or semicolons)" : "";
      return {
        ok: false,
        error: `The data: line ${line} ("${typed}") has one number${why}; write x and y on every line, separated the same way (x y, or x y err).`,
      };
    }
    const x = r[0] ?? null;
    const y = r[1] ?? null;
    if (x === null || y === null) {
      skipped++;
      continue;
    }
    const p: Point = { x, y };
    const e = r[2] ?? null;
    if (e !== null) p.err = Math.abs(e);
    if (r.length > 3 && r.slice(3).some((v) => v !== null)) extra++;
    points.push(p);
  }
  const notes = [...b.notes];
  if (skipped) notes.push(`${skipped} line${skipped === 1 ? "" : "s"} left out: no x or no y value.`);
  if (extra) notes.push(`${extra} line${extra === 1 ? " has" : "s have"} more than three columns; only x, y and the error (the first three) are plotted.`);
  return { ok: true, points, notes };
}

// --- SVG rendering -----------------------------------------------------------

export interface Series {
  points: Point[];
  type: "line" | "scatter";
  color?: string;
  /** Optional label shown in the legend. */
  label?: string;
}

export type AxisScale = "linear" | "log";

export interface PlotOptions {
  width?: number;
  height?: number;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  /**
   * Axis scales. "log" is base 10, matching the `log` function in every
   * evaluator and the log10[concentration] convention dose-response is defined
   * on. A log axis cannot show zero or negative values — see dropForScales.
   */
  xScale?: AxisScale;
  yScale?: AxisScale;
  /**
   * What the third data column MEANS. A bare error bar is not a fact — the same
   * numbers plotted as ±1 SD, ±1 SEM and a 95% CI tell a reader three different
   * things about the same experiment, and SEM bars are visibly the smallest,
   * which is why they get chosen. Every journal and every marking scheme
   * requires the choice to be stated, so the figure states it rather than
   * leaving it to a caption nobody writes.
   *
   * Leaving this unset does NOT buy silence: bars come from the data, so a
   * figure that has them and no kind says "kind not stated" — see
   * ERROR_BAR_UNSTATED. The only way to a figure with no declaration is a figure
   * with no bars.
   */
  errorBars?: ErrorBarKind;
  /**
   * How a tick VALUE becomes a tick LABEL — for axes whose plotted coordinate is
   * not the quantity the reader is meant to see.
   *
   * WHY THIS EXISTS. An axis that runs backwards (NMR δ, IR wavenumber: both
   * increase LEFTWARD by convention) is drawn by negating the coordinate, because
   * this plotter draws x ascending rightward and nothing else. The labels were
   * then formatted from the negated coordinate, so every predicted spectrum in
   * the product carried a NEGATIVE axis: `-4 -3.5 -3 …` under the label
   * "δ (ppm) — increases leftward", and −3.5 ppm is a real upfield shift, so it
   * reads as data rather than as a rendering fault.
   *
   * The function receives the value actually plotted (already snapped to zero
   * where float drift put it near zero) and returns the text drawn. A flipped
   * axis passes `v => fmtTick(-v)`. Left unset, labelling is byte-identical to
   * what it has always been.
   *
   * It governs the WIDTH MEASUREMENT as well as the drawing: the margins are
   * sized from the widest label, and sizing them from text the figure does not
   * contain is how a column comes out too narrow.
   */
  xTickLabel?: (v: number) => string;
  yTickLabel?: (v: number) => string;
  /**
   * Short notes drawn INTO the figure, beneath everything else.
   *
   * WHY THEY GO IN THE PICTURE. A caveat rendered next to the SVG in the task
   * pane does not exist for the reader of the document: the insert path takes the
   * SVG and nothing else. The case this was built for is the log axis — see
   * dropForScales, whose contract is that the caller MUST surface what was
   * discarded — where "3 points not plotted: a logarithmic x axis cannot show
   * zero or negative values" was computed correctly, shown in a <div>, and then
   * left behind. A titration series with a zero-concentration control hits it on
   * the first try, and the published figure is the one that lies.
   *
   * They STACK BELOW the error-bar declaration, in the same 9 px face, and they
   * are paid for by GROWING THE CANVAS — the same rule the legend gutter follows.
   * Word sizes an inserted picture from the SVG's own width/height, so a note
   * drawn outside the declared height is a note cropped off the figure.
   *
   * Long notes are wrapped; the block is bounded, because an unbounded caller
   * could otherwise ask for a canvas thousands of pixels tall.
   */
  notes?: string[];
  /**
   * User-set axis limits, in DATA units (axis.ts `AxisLimits`; `log` comes from
   * xScale/yScale, not from here). Invalid limits are refused by axis.ts with a
   * reason, which is written into the figure's notes, and the axis falls back
   * to automatic. Points outside valid limits are clipped at the frame and
   * counted in a note ("n points outside the axis limits").
   */
  xLimits?: AxisLimits;
  yLimits?: AxisLimits;
  /**
   * Black-and-white line art (USPTO, 37 CFR 1.84(a)(1)), fix2-paf: every paint
   * black, no grid, line series told apart by dash patterns and scatter series
   * by the USPTO marker set (●○■□▲△), legend swatches drawn the same way, and
   * lowercase lettering 1.4× (bwPx) so it prints as tall as the numerals.
   */
  bw?: boolean;
}

const SUP_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "−", "⁺": "+",
};
const SUB_ASCII: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₋": "−", "₊": "+",
};

/**
 * Text markup for a black-and-white (USPTO) figure: superscript and subscript
 * CHARACTERS (², ⁻¹, ₂) are set as full-size digits raised or lowered with a
 * tspan, as tablechart's patent multiplier already is — a Unicode superscript
 * glyph is a fraction of the letter height, so 37 CFR 1.84(p)(3) cannot be met
 * (the figure-style check refuses them as unmeasurable). Plain text is escaped
 * as usual.
 */
export function bwTextMarkup(text: string, fontPx: number): string {
  const shift = Math.round(fontPx * 0.38 * 10) / 10;
  // Runs of one level (−1 sub, 0 base, +1 sup); every run after the first is a
  // tspan whose dy moves the baseline from the previous run's level to its own.
  const runs: { level: number; s: string }[] = [];
  for (const ch of text) {
    const l = ch in SUP_ASCII ? 1 : ch in SUB_ASCII ? -1 : 0;
    const c = l > 0 ? SUP_ASCII[ch] : l < 0 ? SUB_ASCII[ch] : ch;
    if (runs.length && runs[runs.length - 1].level === l) runs[runs.length - 1].s += c;
    else runs.push({ level: l, s: c });
  }
  if (runs.every((r) => r.level === 0)) return escapeXml(text);
  let out = "";
  let at = 0;
  for (const r of runs) {
    if (r.level === at && out === "") {
      out += escapeXml(r.s);
      continue;
    }
    const dy = Math.round((at - r.level) * shift * 10) / 10;
    // A space at a tspan's edge collapses ("10³ m" drew as "10³m"): kept as a no-break space.
    const NBSP = String.fromCharCode(160);
    out += `<tspan dy="${dy}">${escapeXml(r.s.replace(/^ | $/g, NBSP))}</tspan>`;
    at = r.level;
  }
  return out;
}

/** Dash patterns for black-and-white line series, in order (solid first). */
export const BW_DASHES = USPTO_DASHES;

/** What an error bar represents. `custom` is for a half-width the caller computed. */
export type ErrorBarKind = "sd" | "sem" | "ci95" | "range" | "custom";

const ERROR_BAR_LABEL: Record<ErrorBarKind, string> = {
  sd: "Error bars: ±1 SD",
  sem: "Error bars: ±1 SEM",
  ci95: "Error bars: 95% CI",
  range: "Error bars: full range",
  custom: "Error bars: as supplied",
};

/**
 * What a figure says when bars were drawn and no kind was given.
 *
 * The comment on `errorBars` above said every figure states what its bars mean.
 * It was not true of the DEFAULT: bars are drawn from `p.err` alone, the
 * declaration was gated on `options.errorBars`, and the pane leaves that empty
 * until the user picks something — so out of the box a journal figure carried
 * undeclared bars, the exact thing the comment says cannot happen.
 *
 * The alternative was to refuse to draw the bars at all. Rejected: this function
 * returns a bare string, so there is NO channel to tell the caller why a column
 * of the user's data vanished, and a silent drop is the failure mode the log-axis
 * rule (see dropForScales) exists to forbid. Drawing them under an explicit
 * "not stated" invents nothing — it says exactly what is and is not known, and
 * puts the missing choice in front of the person who can make it.
 */
const ERROR_BAR_UNSTATED = "Error bars: kind not stated";

/** What a log axis had to discard, so the caller can say so. */
export interface ScaleFilterResult {
  series: Series[];
  /** Points removed because an axis is logarithmic and the value was <= 0. */
  dropped: number;
  /** Which axis or axes caused it, for the message. */
  axes: string[];
}

/**
 * Removes points a logarithmic axis cannot represent.
 *
 * log10 is undefined at 0 and for negatives, so a log axis necessarily discards
 * those points. Callers MUST surface `dropped`: quietly plotting 7 of 10 points
 * and labelling the axis "log" is a graph that lies, and a titration series
 * containing a zero-concentration control hits this on the first try.
 *
 * Error bars are clipped too — a bar reaching below zero cannot be drawn on a
 * log axis, so its lower end is brought up rather than the point being lost.
 */
export function dropForScales(series: Series[], options: PlotOptions = {}): ScaleFilterResult {
  const logX = options.xScale === "log";
  const logY = options.yScale === "log";
  if (!logX && !logY) return { series, dropped: 0, axes: [] };

  let dropped = 0;
  const axes = new Set<string>();
  const out = series.map((s) => ({
    ...s,
    points: s.points.filter((p) => {
      const badX = logX && !(p.x > 0);
      const badY = logY && !(p.y > 0);
      if (badX) axes.add("x");
      if (badY) axes.add("y");
      if (badX || badY) {
        dropped++;
        return false;
      }
      return true;
    }),
  }));
  return { series: out, dropped, axes: [...axes] };
}

// plot.logTicks and plot.fmtLogTick were REMOVED in v2.143.0: after the axis-engine
// migration nothing called them (the reachability ratchet flagged both as dead).
// Log axes are axis.ts `logDecades` (placement) and `logAxis` (labels, as a row).

/**
 * ONE number, labelled alone — axis.ts `fmtValue`: U+2212 for negatives, thin
 * spaces in 5-digit-plus integers, ×10ⁿ outside 10⁻³ … 10⁶, never e-notation.
 *
 * A per-value compatibility wrapper for prose and for callers that pass their
 * own `xTickLabel`. It CANNOT hold decimals constant along an axis (B.4), so the
 * plotter's default tick labels come from axis.ts `linearAxis` instead.
 */
export function fmtTick(v: number): string {
  return fmtValue(v);
}

/** One axis's labelled ticks, decided once and shared by the margins and the drawing. */
export interface PlotAxisTicks {
  ticks: { v: number; text: string }[];
  /** Log axes: unlabelled decades and 2–9 minors (gridlines only). */
  minor: number[];
  /** "" or "×10ⁿ", appended to the axis title. */
  multiplier: string;
}

/**
 * THE ONE DECISION about an axis's ticks. The margins and the drawing code
 * both consume this, so the column reserved for the labels is sized from
 * exactly the text drawn in it.
 *
 * `lo`/`hi` are in TRANSFORMED units (log10 on a log axis). A caller-supplied
 * `custom` label function is applied per value, as it always was — those
 * callers own their precision.
 */
export function plotAxisTicks(
  lo: number,
  hi: number,
  log: boolean,
  target: number,
  custom: ((v: number) => string) | undefined,
  step: number | undefined,
): PlotAxisTicks {
  if (log) {
    const ax = logAxis(lo, hi);
    const labelled = new Set(ax.labelled.map((t) => t.v));
    return {
      ticks: ax.labelled.map((t) => ({ v: t.v, text: custom ? custom(t.v) : t.text })),
      minor: [...ax.minor, ...ax.major].filter((v) => !labelled.has(v)),
      multiplier: "",
    };
  }
  // OFFSET NOTATION (fix2-paf): on [10⁹, 10⁹ + 1] every tick read
  // "1 000 000 000.2" and the labels ran into each other. When the span is
  // under a thousandth of the magnitude, the ticks are labelled relative to a
  // round offset (the first tick floored to a power of ten above the span) and
  // the axis title says "ticks + offset".
  const mag = Math.max(Math.abs(lo), Math.abs(hi));
  if (!custom && step === undefined && hi > lo && mag > 0 && (hi - lo) / mag < 1e-3) {
    // The roundest offset (fewest significant figures) that leaves every tick
    // within 100 spans of it, so the labels are short and the offset exact.
    const span = hi - lo;
    let off = NaN;
    let sig = 0;
    for (let d = 1; d <= 15; d++) {
      const cand = Number(((lo + hi) / 2).toPrecision(d));
      if (Math.abs(cand - lo) <= 100 * span && Math.abs(hi - cand) <= 100 * span) {
        off = cand;
        sig = d;
        break;
      }
    }
    if (Number.isFinite(off) && off !== 0) {
      const shifted = linearAxis(lo - off, hi - off, { target });
      const offText = fmtSig(Math.abs(off), sig);
      const sign = off < 0 ? "−" : "+";
      return {
        ticks: shifted.values.map((v, i) => ({ v: v + off, text: shifted.labels[i] })),
        minor: [],
        multiplier: shifted.multiplier ? `ticks ${shifted.multiplier} ${sign} ${offText}` : `ticks ${sign} ${offText}`,
      };
    }
  }
  const row = linearAxis(lo, hi, { target, step });
  return {
    ticks: row.values.map((v, i) => ({ v, text: custom ? custom(snapNearZero(v, row.step || 1)) : row.labels[i] })),
    minor: [],
    multiplier: custom ? "" : row.multiplier,
  };
}

/** "Price" + "×10⁶" → "Price (×10⁶)"; no title → the multiplier alone. */
function withMultiplier(label: string | undefined, mult: string): string | undefined {
  if (!mult) return label;
  return label ? `${label} (${mult})` : mult;
}

/** Unique clipPath ids, for figures that sit side by side in one pane. */
let clipSeq = 0;

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders one or more series to an SVG string with axes, ticks, and labels. */
/**
 * Stacks several SVG figures into ONE valid SVG document.
 *
 * WHY THIS EXISTS. Code that wanted two figures concatenated their markup —
 * `resid + qq` — which is fine as innerHTML, because a browser happily renders
 * two sibling <svg> elements. It is NOT a valid SVG document: it has two root
 * elements. So the pane preview looked right while rasterising it for Word failed
 * outright with "Could not rasterize the structure image", which meant the
 * regression diagnostic plots could never be inserted at all.
 *
 * The parts become children of one root, each offset in y and centred in x.
 * Returns the combined markup plus the dimensions a caller needs to size the
 * raster.
 *
 * FLAT SINCE THE JOURNAL-FIGURES WORK: each part is now a
 * `<g transform="translate(x,y)">`, not a nested <svg> (panels.composePanels,
 * no preset, one column). The layout audit follows translate groups and not
 * nested viewports, and each part's ids are namespaced so two panels from the
 * same builder no longer share a clipPath. Same signature, same dimensions.
 */
export function combineSvgs(parts: string[], gap = 8): { svg: string; width: number; height: number } {
  const items = parts.map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return { svg: "", width: 0, height: 0 };
  if (items.length === 1) {
    // Passed through untouched, sized exactly as before (300 × 190 when unstated).
    const s = items[0];
    return {
      svg: s,
      width: Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(s)?.[1] ?? 300),
      height: Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(s)?.[1] ?? 190),
    };
  }
  const c = composePanels(items, { cols: 1, gap });
  return { svg: c.svg, width: c.width, height: c.height };
}

/**
 * How much room the y-axis tick labels need on the left.
 *
 * Measured from the labels themselves rather than guessed: the tick VALUES
 * depend only on the data range and the scale, both of which are known before
 * any drawing happens, so the widest label can be formatted and counted up
 * front. 6 px per character at 10 px sans-serif is a safe over-estimate, and
 * the floor keeps small-number plots looking as they always have.
 */
function leftMarginFor(yAxis: PlotAxisTicks, options: PlotOptions): number {
  // THE SAME TICKS THE DRAWING CODE DRAWS — the one PlotAxisTicks decision,
  // computed once from the drawing domain. (The first version re-derived its
  // own domain, missed error bars and the 6% padding, and over 20,000 random
  // plots under-sized 2.6% of margins and pushed 36 labels off the canvas.)
  if (!yAxis.ticks.length) return 48;
  let widest = 0;
  for (const t of yAxis.ticks) widest = Math.max(widest, t.text.length);
  // Label width, the 7 px gap to the axis, and room for the rotated title.
  //
  // THE TITLE RESERVE IS MEASURED, NOT GUESSED. The y title is drawn at x = 14
  // in an 11 px face, so its rotated box reaches x = 14 + 11·0.78/2 ≈ 18.3. The
  // first draft reserved 16, which is less than that, and a five-character
  // negative tick then grazed it in about 4% of ranges — a real overlap, small
  // enough to be missed by eye and not by a detector.
  const titleSize = options.ylabel ? bwPx(options.ylabel, Y_TITLE_SIZE, options.bw === true) : Y_TITLE_SIZE;
  const titleRight = options.ylabel ? Y_TITLE_X + (titleSize * 0.78) / 2 : 0;
  const needed = widest * 6 + 7 + (options.ylabel ? titleRight + 4 : 4);
  return Math.min(Math.max(48, Math.ceil(needed)), 130);
}

/**
 * How much room the LAST x tick label needs to the right of the plot frame.
 *
 * The left margin has been computed from its widest label since the margin
 * work; the right one was a flat 14 px, and x tick labels are centred on their
 * tick. A tick sitting on the right edge therefore hangs half its width off the
 * canvas, and "2.5e+4" is 36 px wide — the reliability figures put a 25,000-hour
 * mission on the x axis and clipped, but the defect is in the shared plotter
 * and every wide-numbered x axis in the product had it.
 *
 * Conservative by design: it assumes the last tick lands exactly on the edge
 * rather than solving for where it lands, because that solve depends on the
 * margin being computed. The cost of the assumption is a few pixels of plot
 * width on the plots that need it and nothing at all on the ones that do not.
 */
function rightMarginFor(xAxis: PlotAxisTicks): number {
  const DEFAULT = 14;
  if (!xAxis.ticks.length) return DEFAULT;
  let widest = 0;
  for (const t of xAxis.ticks) widest = Math.max(widest, t.text.length);
  return Math.min(Math.max(DEFAULT, Math.ceil((widest * 6) / 2) + 2), 60);
}

/**
 * THE TICK LOOPS ARE BOUNDED, AND THEIR SLACK IS RELATIVE.
 *
 * Both walks used `t <= max + 1e-9` — an ABSOLUTE epsilon, on axes whose whole
 * range may be far smaller than 1e-9. Femtoseconds and nanoamps are ordinary
 * pasted data, and at an x span of 1e-14 that slack is a billion steps wide:
 * measured, 500,007 tick labels and a 128 MB SVG for one plot, every one of the
 * extra ticks off the canvas. In a task pane that is not a bad-looking chart,
 * it is a frozen Word.
 *
 * Relative slack makes the epsilon mean what it was meant to mean — "include a
 * tick that floating-point arithmetic landed a hair past the end" — at every
 * magnitude. The count cap is the backstop, because a slack that depends on the
 * step being sane is not a bound. Six or seven ticks is the design; 200 is far
 * past anything legible and still finite.
 *
 * EXPORTED because this module is not the only one that walks an axis:
 * tablechart.ts and candlestick.ts have their own tick loops, and both shipped
 * with the absolute-epsilon, no-cap form this comment describes — 2,000,011 tick
 * labels and a 510 MB SVG on femtosecond-magnitude data. One pair of constants,
 * one explanation, three loops that cannot drift apart.
 */
export const TICK_CAP = 200;
export const TICK_EPS = 1e-6;

/** Where the rotated y-axis title is drawn, and how big. Used by both the
 *  margin calculation and the drawing code, so they cannot drift apart. */
const Y_TITLE_X = 14;
const Y_TITLE_SIZE = 11;

/**
 * A tick that should be zero, printed as zero.
 *
 * Walking `t += step` accumulates float error, so a range straddling the origin
 * lands on -2.8e-17 instead of 0 about 2% of the time — an axis label that is
 * both meaningless and, at eight characters of exponent notation, wide enough
 * to collide with the axis title next to it. Anything within a millionth of a
 * step of zero IS zero for labelling purposes.
 */
function snapNearZero(t: number, step: number): number {
  return Math.abs(t) < Math.abs(step) * 1e-6 ? 0 : t;
}

/** The footnote block's face and line height — the error-bar declaration's face. */
export const NOTE_SIZE = 9;
export const NOTE_LH = 12;
/**
 * A bound on the footnote block.
 *
 * The canvas grows to fit the notes, so an unbounded list is an unbounded height:
 * a caller looping over "row N could not be drawn" would produce a figure taller
 * than the document. Twelve lines is more than any real caveat needs, and the cut
 * SAYS it was cut rather than quietly ending.
 */
const NOTE_MAX_LINES = 12;

/**
 * Greedy word wrap at 6.3 px per character in the 9 px face.
 *
 * 6.3 IS A BOUND, NOT AN AVERAGE — the legend's "7 px per character, not 6"
 * reasoning, in the smaller face. A 9 px sans glyph averages ~5 px and runs to
 * ~8.5 px for "M"/"W", and this block starts at x = 8 and runs toward the canvas
 * edge with no frame slack to absorb an underestimate. A caveat clipped off the
 * right of the figure is the very defect these notes exist to fix.
 */
function wrapNote(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of text.split(/\s+/)) {
    let w = raw;
    if (!w) continue;
    // A single token longer than the line is hard-split; letting it run would put
    // it off the canvas, which is the one thing this block exists to prevent.
    while (w.length > maxChars) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * BLACK-AND-WHITE (USPTO) LETTERING, Release D. 37 CFR 1.84(p)(3) is about every letter, so the
 * figure style measures a lowercase run on its x-height (about 0.72 of the cap height in Arial):
 * a lowercase axis title or note at the numerals' size is the run that forces the whole figure to
 * be drawn larger, crowding it. The patent convention (tablechart.ts: numerals and capitals
 * 12 px, any lowercase 17 px) draws a run that has a lowercase letter 1.4× larger, so both print
 * alike. Notes in black and white are drawn at BW_NOTE_SIZE on BW_NOTE_LH lines.
 */
export const BW_LOWER_SCALE = 1.4;
export const BW_NOTE_SIZE = 13;
export const BW_NOTE_LH = 17;
/** The font size for `text` drawn at `base`: unchanged as drawn; 1.4× in black and white when it has a lowercase letter. */
export function bwPx(text: string, base: number, bw: boolean): number {
  return bw && /\p{Ll}/u.test(text) ? Math.round(base * BW_LOWER_SCALE * 10) / 10 : base;
}

/** Wraps and bounds the notes for a figure `width` px wide (drawn at `size` px; NOTE_SIZE by default). */
export function layoutNotes(notes: string[] | undefined, width: number, size: number = NOTE_SIZE): string[] {
  if (!notes || !notes.length) return [];
  const maxChars = Math.max(20, Math.floor((width - 16) / ((6.3 * size) / NOTE_SIZE)));
  const lines: string[] = [];
  for (const n of notes) {
    if (!n || !n.trim()) continue;
    lines.push(...wrapNote(n.trim(), maxChars));
  }
  if (lines.length <= NOTE_MAX_LINES) return lines;
  const kept = lines.slice(0, NOTE_MAX_LINES - 1);
  kept.push(`(+${lines.length - (NOTE_MAX_LINES - 1)} more lines not shown)`);
  return kept;
}

export function buildPlotSvg(series: Series[], options: PlotOptions = {}): string {
  const W = options.width ?? 380;
  const H = options.height ?? 270;

  // ONE NON-FINITE COORDINATE POISONS THE WHOLE PLOT. The domain below is
  // min/max over every point, and drawing filtered only non-finite y — so an
  // Infinity that reached x (an overflowed sweep bound; measured twice in one
  // release) made xmax Infinity and every coordinate NaN. Sanitised HERE, at
  // the one place all callers share, rather than at each of the fifty call
  // sites that would otherwise each need the same guard. A non-finite err is
  // kept as a point but loses its bar, because the point itself is plottable.
  const all: Point[] = [];
  for (const s of series)
    for (const p of s.points) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        all.push(p.err !== undefined && !Number.isFinite(p.err) ? { x: p.x, y: p.y } : p);
      }
    }

  // Everything below works in TRANSFORMED space: on a log axis the domain, the
  // padding and the tick placement are all computed on log10 values, which is
  // what makes a decade occupy equal width. Only tick LABELS return to data
  // space.
  const logX = options.xScale === "log";
  const logY = options.yScale === "log";
  const tx = (x: number): number => (logX ? Math.log10(x) : x);
  const ty = (y: number): number => (logY ? Math.log10(y) : y);

  // THE DOMAIN, decided once, before the margins: the margins are sized from the
  // tick labels, and the tick labels come from the domain.
  let xmin = 0;
  let xmax = 1;
  let ymin = 0;
  let ymax = 1;
  let xStep: number | undefined;
  let yStep: number | undefined;
  let clipped = false;
  const extraNotes: string[] = [];
  if (all.length) {
    xmin = minOf(all.map((p) => tx(p.x)));
    xmax = maxOf(all.map((p) => tx(p.x)));
    // On a log y axis an error bar may reach to or below zero, where log is
    // undefined; clamp its lower end into the domain instead of dropping a point
    // that is itself perfectly plottable.
    const lowY = (p: Point): number => {
      const raw = p.y - (p.err ?? 0);
      if (!logY) return raw;
      return ty(raw > 0 ? raw : p.y);
    };
    ymin = minOf(all.map(lowY));
    ymax = maxOf(all.map((p) => ty(p.y + (p.err ?? 0))));
    if (xmin === xmax) {
      xmin -= 1;
      xmax += 1;
    }
    if (ymin === ymax) {
      ymin -= 1;
      ymax += 1;
    }
    const ypad = (ymax - ymin) * 0.06;
    ymin -= ypad;
    ymax += ypad;

    // USER LIMITS (axis.ts). Refused limits are reported, with the reason, in
    // the figure itself — this function has no other channel — and the axis
    // stays automatic. Valid ones replace the domain exactly (no padding), and
    // whatever falls outside is clipped at the frame and counted.
    const applyLimits = (
      which: "x" | "y",
      lim: AxisLimits | undefined,
      log: boolean,
      vals: number[],
    ): { lo: number; hi: number; step?: number } | null => {
      if (!lim || (lim.min === undefined && lim.max === undefined && lim.step === undefined)) return null;
      const r = resolveLimits(minOf(vals), maxOf(vals), { ...lim, log }, vals);
      if (!r.ok) {
        extraNotes.push(`${which}-axis limits not applied: ${r.reason}.`);
        return null;
      }
      return { lo: log ? Math.log10(r.lo) : r.lo, hi: log ? Math.log10(r.hi) : r.hi, step: r.step };
    };
    const xl = applyLimits("x", options.xLimits, logX, all.map((p) => p.x));
    const yl = applyLimits("y", options.yLimits, logY, all.map((p) => p.y));
    if (xl) {
      xmin = xl.lo;
      xmax = xl.hi;
      xStep = xl.step;
      clipped = true;
    }
    if (yl) {
      ymin = yl.lo;
      ymax = yl.hi;
      yStep = yl.step;
      clipped = true;
    }
    if (xl || yl) {
      let n = 0;
      for (const p of all) {
        const X = tx(p.x);
        const Y = ty(p.y);
        if (X < xmin || X > xmax || Y < ymin || Y > ymax) n++;
      }
      const note = outsideNote(n);
      if (note) extraNotes.push(note + ".");
    }
  }
  const xAxis = all.length
    ? plotAxisTicks(xmin, xmax, logX, 6, options.xTickLabel, xStep)
    : { ticks: [], minor: [], multiplier: "" };
  const yAxis = all.length
    ? plotAxisTicks(ymin, ymax, logY, 5, options.yTickLabel, yStep)
    : { ticks: [], minor: [], multiplier: "" };
  // A ×10ⁿ multiplier is stated ONCE, on the axis title — never as e-notation
  // on every tick.
  options = {
    ...options,
    xlabel: withMultiplier(options.xlabel, xAxis.multiplier),
    ylabel: withMultiplier(options.ylabel, yAxis.multiplier),
    notes: extraNotes.length ? [...(options.notes ?? []), ...extraNotes] : options.notes,
  };

  // THE LEFT MARGIN HAS TO FIT THE LABELS THAT GO IN IT. A fixed 48 px is
  // ample for "0" and "100" and far too little for a wide label, which then ran
  // back over the rotated y-axis title sitting at x = 12. The margin is
  // therefore computed from the WIDEST tick label actually drawn.
  const ml = leftMarginFor(yAxis, options);
  const mr = rightMarginFor(xAxis);
  const mt = options.title ? 26 : 12;
  // The error-bar declaration needs its own line, or it lands on the x label.
  //
  // The predicate is EXACTLY the one the drawing code uses further down, not
  // `p.err !== undefined`: bars are drawn only for SCATTER series and only for a
  // truthy finite err, so a line series with an err column, an `err: 0` or an
  // `err: NaN` puts no bar on the figure — and a declaration about bars that are
  // not there is its own small lie. (This matters now that the declaration fires
  // by default: the pane's Plot mode reads a third column into `err` whatever
  // series type the user picked.)
  const hasErrNote = series.some((s) => s.type !== "line" && s.points.some((p) => !!p.err && Number.isFinite(p.err)));
  const mb = (options.xlabel ? 42 : 30) + (hasErrNote ? 13 : 0);
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  // The footnote block is paid for by GROWING THE CANVAS, not by shrinking the
  // plot — the legend gutter's rule, for the legend gutter's reason: every caller
  // laid out for the data area it asked for, and Word sizes the picture from the
  // SVG's own height, so the growth is what keeps the notes on the figure.
  // Wrapped to W rather than to the widened canvas, so the block stays in the
  // plot's own column whether or not there is a legend.
  const bw = options.bw === true;
  const noteSize = bw ? BW_NOTE_SIZE : NOTE_SIZE;
  const noteLh = bw ? BW_NOTE_LH : NOTE_LH;
  const noteLines = layoutNotes(options.notes, W, noteSize);
  const notesH = noteLines.length ? noteLines.length * noteLh + 4 : 0;
  const outH = H + notesH;
  /** The footnote block, drawn below the plot canvas in both return paths. */
  const notesSvg = (): string =>
    noteLines
      .map(
        (line, i) =>
          `<text x="8" y="${H + (bw ? 15 : 11) + i * noteLh}" font-family="sans-serif" font-size="${noteSize}" fill="${bw ? "#000" : "#555"}">${bw ? bwTextMarkup(line, noteSize) : escapeXml(line)}</text>`,
      )
      .join("");

  if (!all.length) {
    // The notes are drawn HERE TOO. "No data to plot" with the explanation left
    // behind is the worst version of this figure: a log axis that discarded every
    // point produces exactly that, and the reason is the only useful thing on it.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}"><rect width="${W}" height="${outH}" fill="#fff"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No data to plot</text>${notesSvg()}</svg>`;
  }

  // THE LEGEND LIVES OUTSIDE THE PLOT FRAME, in a gutter to its right. It used
  // to sit inside the top-right corner of the plot area, where the only
  // defensible rendering is an opaque box — and an opaque box over the plot is
  // data covered by its own key. The gutter is paid for by WIDENING THE
  // CANVAS, not by shrinking the plot: Word inserts figures at the SVG's
  // intrinsic size, so the data area every caller laid out for stays exactly
  // as large as it was, and an unlabeled plot's canvas does not change at all.
  const LEGEND_LH = bw ? 19 : 14;
  const legendLabelOf = (s: Series): string => {
    const maxChars = 22;
    const t = (s.label as string).trim();
    return t.length > maxChars ? t.slice(0, maxChars - 1) + "…" : t;
  };
  const labeled = series.filter((s) => s.label && s.label.trim());
  const legendRows = labeled.slice(0, Math.max(1, Math.floor((ph - 10) / LEGEND_LH)));
  // 7 px per character, not 6: a 10 px sans glyph averages ~5.5 px but runs to
  // ~9.4 px for "M"/"W", and out here the canvas edge is 4 px past the box —
  // there is no plot-frame slack left to absorb an underestimate, so a
  // capital-heavy label would be cut off by the viewport.
  const legendTextPx = (s: Series): number => bwPx(legendLabelOf(s), 10, bw);
  const legendW = legendRows.length
    ? Math.ceil(14 + maxOf(legendRows.map((s) => legendLabelOf(s).length * 0.7 * legendTextPx(s))) + 10)
    : 0;
  const outW = legendRows.length ? W + 4 + legendW + 4 : W;

  const sx = (x: number): number => ml + ((tx(x) - xmin) / (xmax - xmin)) * pw;
  const sy = (y: number): number => mt + ph - ((ty(y) - ymin) / (ymax - ymin)) * ph;

  const RULE = bw ? "#000" : "#888";
  const INK = bw ? "#000" : "#333";
  const parts: string[] = [`<rect width="${outW}" height="${outH}" fill="#fff"/>`];
  // Plot frame.
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${RULE}" stroke-width="1"/>`);

  // Ticks + gridlines: exactly the PlotAxisTicks the margins were sized from.
  // Tick POSITIONS are data values (log axes included); sx/sy transform them.
  // Black and white: no grid (patent figures carry none).
  for (const v of bw ? [] : xAxis.minor) {
    const px = sx(v);
    parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#f5f5f5"/>`);
  }
  for (const t of xAxis.ticks) {
    const px = sx(t.v);
    if (!bw) parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#eee"/>`);
    parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="${RULE}"/>`);
    parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 16}" text-anchor="middle" font-family="sans-serif" font-size="${bwPx(t.text, 10, bw)}" fill="${INK}">${bw ? bwTextMarkup(t.text, bwPx(t.text, 10, bw)) : escapeXml(t.text)}</text>`);
  }
  for (const v of bw ? [] : yAxis.minor) {
    const py = sy(v);
    parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#f5f5f5"/>`);
  }
  for (const t of yAxis.ticks) {
    const py = sy(t.v);
    if (!bw) parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#eee"/>`);
    parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="${RULE}"/>`);
    parts.push(`<text x="${ml - 7}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="${bwPx(t.text, 10, bw)}" fill="${INK}">${bw ? bwTextMarkup(t.text, bwPx(t.text, 10, bw)) : escapeXml(t.text)}</text>`);
  }

  // Under user limits the data may run past the frame: clip it there.
  const clipId = clipped ? `plotclip${++clipSeq}` : "";
  if (clipped) {
    parts.push(`<clipPath id="${clipId}"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath>`);
    parts.push(`<g clip-path="url(#${clipId})">`);
  }

  // Series.
  // 10 distinct colors (matplotlib "tab10") so series stay distinguishable.
  const palette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  // Black and white: the k-th line series takes the k-th dash, the k-th
  // scatter series the k-th USPTO marker — counted per type, so the first of
  // each is solid / a filled disc.
  const styleIdx = series.map((s, i) => series.slice(0, i).filter((o) => o.type === s.type).length);
  const colorOf = (s: Series, idx: number): string => (bw ? "#000" : s.color ?? palette[idx % palette.length]);
  const markerAt = (idx: number, x: number, y: number, color: string): string =>
    bw ? usptoMarkerSvg(styleIdx[idx], x, y) : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${color}"/>`;
  series.forEach((sObj, idx) => {
    const color = colorOf(sObj, idx);
    // Both coordinates, matching the domain filter above — a finite-y point
    // with Infinity x otherwise draws "LNaN,…" into the path.
    const pts = sObj.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (sObj.type === "line") {
      // A point marked `gap` (a pole, or samples left out) starts a new piece.
      const d = pts.map((p, k) => `${k === 0 || p.gap ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
      const dash = bw ? BW_DASHES[styleIdx[idx] % BW_DASHES.length] : "";
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    } else {
      for (const p of pts) {
        if (p.err && Number.isFinite(p.err)) {
          // On a log axis, y - err can be <= 0 where log is undefined; the bar
          // is drawn from the point itself rather than off the chart.
          const lo = logY && !(p.y - p.err > 0) ? p.y : p.y - p.err;
          const x = sx(p.x);
          const yLo = sy(lo);
          const yHi = sy(p.y + p.err);
          parts.push(
            `<line x1="${x.toFixed(1)}" y1="${yLo.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${color}" stroke-width="1"/>`,
          );
          // Caps. Without them two overlapping series' bars are impossible to
          // tell apart, and a bar that has been clipped at the axis reads as a
          // shorter bar rather than as a clipped one.
          const cap = 3;
          parts.push(
            `<line x1="${(x - cap).toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${(x + cap).toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${color}" stroke-width="1"/>`,
          );
          if (!(logY && !(p.y - p.err > 0)))
            parts.push(
              `<line x1="${(x - cap).toFixed(1)}" y1="${yLo.toFixed(1)}" x2="${(x + cap).toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${color}" stroke-width="1"/>`,
            );
        }
        parts.push(markerAt(idx, sx(p.x), sy(p.y), color));
      }
    }
  });
  if (clipped) parts.push(`</g>`);

  // Legend, in the gutter right of the plot frame — outside the data area, so
  // it can never cover a curve. (Its predecessor sat inside the frame; opacity
  // kept the curves from striking out the labels, but the box still hid
  // whatever data lay beneath it.) ml + pw + mr === W, so x = W is the first
  // pixel past the tick-overhang reserve and the gutter begins there.
  if (legendRows.length) {
    const lx = W + 4;
    const ly = mt + 4;
    parts.push(`<rect x="${lx}" y="${ly}" width="${legendW}" height="${legendRows.length * LEGEND_LH + 6}" fill="#ffffff" stroke="${bw ? "#000" : "#ccc"}"/>`);
    legendRows.forEach((s, i) => {
      const idx = series.indexOf(s);
      const color = colorOf(s, idx);
      const cyl = ly + 9 + i * LEGEND_LH + (bw ? 2 : 0);
      // THE SWATCH IS DRAWN LIKE THE DATA (fix2-paf): a scatter series showed a
      // line in its legend, and in black and white the line swatches carried
      // no dash, so neither could be matched to its curve.
      if (s.type === "line") {
        const dash = bw ? BW_DASHES[styleIdx[idx] % BW_DASHES.length] : "";
        parts.push(`<line x1="${lx + 6}" y1="${cyl}" x2="${lx + 20}" y2="${cyl}" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
      } else {
        parts.push(markerAt(idx, lx + 13, cyl, color));
      }
      parts.push(`<text x="${lx + 24}" y="${cyl + (bw ? 5 : 3.5)}" font-family="sans-serif" font-size="${legendTextPx(s)}" fill="${INK}">${bw ? bwTextMarkup(legendLabelOf(s), legendTextPx(s)) : escapeXml(legendLabelOf(s))}</text>`);
    });
  }

  // Labels.
  if (options.title) {
    parts.push(`<text data-figure-title="1" x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="${bw ? "#000" : "#222"}">${escapeXml(options.title)}</text>`);
  }
  if (hasErrNote) {
    const errText = options.errorBars ? ERROR_BAR_LABEL[options.errorBars] : ERROR_BAR_UNSTATED;
    parts.push(
      `<text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" font-family="sans-serif" font-size="${bw ? bwPx(errText, 10, true) : 9}" fill="${bw ? "#000" : "#555"}">${escapeXml(errText)}</text>`,
    );
  }
  if (options.xlabel) {
    parts.push(`<text x="${ml + pw / 2}" y="${H - (hasErrNote ? 21 : 8)}" text-anchor="middle" font-family="sans-serif" font-size="${bwPx(options.xlabel, 11, bw)}" fill="${INK}">${bw ? bwTextMarkup(options.xlabel, bwPx(options.xlabel, 11, bw)) : escapeXml(options.xlabel)}</text>`);
  }
  if (options.ylabel) {
    // The same constants the margin reserves room from, so the two cannot
    // drift apart — which is how the title came to be wider than its space.
    const cx = Y_TITLE_X;
    const cy = mt + ph / 2;
    parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="${bwPx(options.ylabel, Y_TITLE_SIZE, bw)}" fill="${INK}" transform="rotate(-90 ${cx} ${cy})">${bw ? bwTextMarkup(options.ylabel, bwPx(options.ylabel, Y_TITLE_SIZE, bw)) : escapeXml(options.ylabel)}</text>`);
  }

  parts.push(notesSvg());

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">${parts.join("")}</svg>`;
}
