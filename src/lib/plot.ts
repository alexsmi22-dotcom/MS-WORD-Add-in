// Lightweight pure-SVG plotter: function plots (y = f(x)) and data plots (scatter
// / line, optional error bars), with axes, ticks, and labels. Includes a small,
// safe expression evaluator (no eval/Function) so the add-in stays offline and
// CSP-clean. The task pane rasterizes the SVG to PNG and inserts it as a picture.
//
// Pure logic — no Office.js — fully unit-testable.

// --- Expression evaluator ----------------------------------------------------

import { minOf, maxOf } from "./minmax";

/** Factorial for non-negative integers (else NaN). */
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

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
export function evalExpr(expr: string, x: number): number {
  let i = 0;
  const s = expr.replace(/\s+/g, "");

  function parseExpr(): number {
    let v = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = parseUnary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  // Unary minus binds looser than ^, so -x^2 = -(x^2) (the usual convention).
  function parseUnary(): number {
    if (s[i] === "-") {
      i++;
      return -parseUnary();
    }
    if (s[i] === "+") {
      i++;
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower(): number {
    const base = parseAtom();
    if (s[i] === "^") {
      i++;
      return Math.pow(base, parseUnary()); // right-associative; exponent may be signed
    }
    return base;
  }
  function parseAtom(): number {
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
      return parseFloat(numMatch[0]);
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
          return FUNCS[key](args[0]);
        }
        const nf = FUNCS_N[key];
        if (nf) {
          if (nf.arity !== "var" && args.length !== nf.arity) throw new Error(`${id} takes ${nf.arity} arguments`);
          if (nf.arity === "var" && args.length < 1) throw new Error(`${id} needs an argument`);
          return nf.fn(args);
        }
        throw new Error(`Unknown function ${id}`);
      }
      if (id === "x") return x;
      if (id.toLowerCase() in CONSTS) return CONSTS[id.toLowerCase()];
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
}

/** Samples y = f(x) across [xmin, xmax], dropping non-finite points. */
export function samplePlot(expr: string, xmin: number, xmax: number, samples = 200): Point[] {
  const pts: Point[] = [];
  const n = Math.max(2, Math.floor(samples));
  for (let k = 0; k < n; k++) {
    const x = xmin + ((xmax - xmin) * k) / (n - 1);
    let y: number;
    try {
      y = evalExpr(expr, x);
    } catch {
      throw new Error("Could not evaluate the function.");
    }
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

/** Parses "x y [err]" lines (whitespace- or comma-separated) into points. */
export function parseData(text: string): Point[] {
  const pts: Point[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const nums = t.split(/[\s,;]+/).map(Number);
    if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
      const p: Point = { x: nums[0], y: nums[1] };
      if (nums.length >= 3 && Number.isFinite(nums[2])) p.err = Math.abs(nums[2]);
      pts.push(p);
    }
  }
  return pts;
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
   */
  errorBars?: ErrorBarKind;
}

/** What an error bar represents. `custom` is for a half-width the caller computed. */
export type ErrorBarKind = "sd" | "sem" | "ci95" | "range" | "custom";

const ERROR_BAR_LABEL: Record<ErrorBarKind, string> = {
  sd: "Error bars: ±1 SD",
  sem: "Error bars: ±1 SEM",
  ci95: "Error bars: 95% CI",
  range: "Error bars: full range",
  custom: "Error bars: as supplied",
};

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

/**
 * Decade ticks for a log axis, with minor ticks at 2-9 inside each decade.
 *
 * The minor ticks are what make a log plot readable — without them a reader
 * cannot tell 2x10^3 from 5x10^3 by eye. They are returned separately because
 * they get a gridline but no label.
 */
export function logTicks(lo: number, hi: number): { major: number[]; minor: number[] } {
  const major: number[] = [];
  const minor: number[] = [];
  const first = Math.floor(lo);
  const last = Math.ceil(hi);
  // A guard against a pathological domain producing thousands of ticks.
  //
  // Checking only the SPAN is not enough: at a magnitude like 1e308, `d++` is
  // below the floating-point step size, so d never advances and `d <= last`
  // loops forever with a span of zero. Bound the magnitude as well — a decade
  // exponent outside +-320 is past the range of a double anyway.
  if (
    !Number.isFinite(first) || !Number.isFinite(last) ||
    last - first > 40 || Math.abs(first) > 320 || Math.abs(last) > 320
  ) {
    return { major: [], minor: [] };
  }
  for (let d = first; d <= last; d++) {
    const decade = Math.pow(10, d);
    if (d >= lo - 1e-9 && d <= hi + 1e-9) major.push(decade);
    // Only worth drawing minor ticks when the span is small enough to see them.
    if (last - first <= 6) {
      for (let m = 2; m <= 9; m++) {
        const v = Math.log10(m * decade);
        if (v >= lo && v <= hi) minor.push(m * decade);
      }
    }
  }
  return { major, minor };
}

/** Axis label for a decade: 10^n, or the plain number when it reads better. */
export function fmtLogTick(v: number): string {
  const e = Math.round(Math.log10(v));
  // The band must stop where fmtTick stops being plain. fmtTick switches to
  // exponential at |v| >= 1e4, and this used to delegate THROUGH e = 4 — so a
  // decade axis read 100, 1000, 1.0e+4, 10⁵: three different notations in one
  // row, with the odd one in the middle. An axis that changes notation twice
  // makes a reader check whether the scale changed too.
  if (e >= -3 && e <= 3) return fmtTick(v);
  const sup = String(e)
    .replace(/-/g, "\u207b")
    .replace(/[0-9]/g, (d) => "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079"[Number(d)]);
  return "10" + sup;
}

export function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

export function fmtTick(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
}

function escapeXml(s: string): string {
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
 * SVG nests, so the fix is to make the parts children of one root with a y
 * offset each. Returns the combined markup plus the dimensions a caller needs to
 * size the raster.
 */
export function combineSvgs(parts: string[], gap = 8): { svg: string; width: number; height: number } {
  const items = parts
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({
      s,
      w: Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(s)?.[1] ?? 300),
      h: Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(s)?.[1] ?? 190),
    }));
  if (items.length === 0) return { svg: "", width: 0, height: 0 };
  if (items.length === 1) return { svg: items[0].s, width: items[0].w, height: items[0].h };

  const width = Math.max(...items.map((i) => i.w));
  const height = items.reduce((a, i) => a + i.h, 0) + gap * (items.length - 1);

  let y = 0;
  const inner = items
    .map((i) => {
      // x/y are inserted into the child's own <svg> tag; its width/height/viewBox
      // are already correct, so nesting needs nothing else.
      const placed = i.s.replace(/^<svg\b/, `<svg x="${(width - i.w) / 2}" y="${y}"`);
      y += i.h + gap;
      return placed;
    })
    .join("");

  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/>` +
      inner +
      `</svg>`,
    width,
    height,
  };
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
function leftMarginFor(series: Series[], options: PlotOptions): number {
  const logY = options.yScale === "log";
  const ty = (y: number): number => (logY ? Math.log10(y) : y);
  // THE SAME DOMAIN THE DRAWING CODE USES, arrived at the same way. The first
  // version collected only `p.y` and applied its own ±10% expansion, so it
  // walked a DIFFERENT range: it missed error bars entirely (the drawing code
  // includes them unconditionally, whatever `options.errorBars` says) and
  // skipped the 6% padding. Over 20,000 random plots that under-sized 2.6% of
  // margins and pushed 36 labels off the canvas — the very symptom this
  // function exists to prevent.
  const all: Point[] = [];
  for (const s of series) for (const p of s.points) all.push(p);
  const finite = all.filter((p) => Number.isFinite(p.y));
  if (!finite.length) return 48;

  const lowY = (p: Point): number => {
    const raw = p.y - (p.err ?? 0);
    if (!logY) return raw;
    return ty(raw > 0 ? raw : p.y);
  };
  let ymin = minOf(finite.map(lowY));
  let ymax = maxOf(finite.map((p) => ty(p.y + (p.err ?? 0))));
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const ypad = (ymax - ymin) * 0.06;
  ymin -= ypad;
  ymax += ypad;
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return 48;

  let widest = 0;
  if (logY) {
    const { major } = logTicks(ymin, ymax);
    for (const v of major) widest = Math.max(widest, fmtLogTick(v).length);
  } else {
    const step = niceStep(ymax - ymin, 5);
    // Bounded, because `Number.isFinite` on the inputs is not a bound.
    for (let i = 0, t = Math.ceil(ymin / step) * step; i <= TICK_CAP && t <= ymax + step * TICK_EPS; i++, t += step) {
      widest = Math.max(widest, fmtTick(snapNearZero(t, step)).length);
    }
  }
  // Label width, the 7 px gap to the axis, and room for the rotated title.
  //
  // THE TITLE RESERVE IS MEASURED, NOT GUESSED. The y title is drawn at x = 14
  // in an 11 px face, so its rotated box reaches x = 14 + 11·0.78/2 ≈ 18.3. The
  // first draft reserved 16, which is less than that, and a five-character
  // negative tick then grazed it in about 4% of ranges — a real overlap, small
  // enough to be missed by eye and not by a detector.
  const titleRight = options.ylabel ? Y_TITLE_X + (Y_TITLE_SIZE * 0.78) / 2 : 0;
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
function rightMarginFor(series: Series[], options: PlotOptions): number {
  const DEFAULT = 14;
  const logX = options.xScale === "log";
  const tx = (x: number): number => (logX ? Math.log10(x) : x);
  const all: Point[] = [];
  for (const s of series) for (const p of s.points) all.push(p);
  const xs = all.map((p) => tx(p.x)).filter((v) => Number.isFinite(v));
  if (!xs.length) return DEFAULT;
  let xmin = minOf(xs);
  let xmax = maxOf(xs);
  if (xmin === xmax) {
    xmin -= 1;
    xmax += 1;
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax)) return DEFAULT;

  let widest = 0;
  if (logX) {
    const { major } = logTicks(xmin, xmax);
    for (const v of major) widest = Math.max(widest, fmtLogTick(v).length);
  } else {
    const step = niceStep(xmax - xmin, 6);
    // Bounded, for the same reason the left margin's walk is bounded.
    for (let i = 0, t = Math.ceil(xmin / step) * step; i <= TICK_CAP && t <= xmax + step * TICK_EPS; i++, t += step) {
      widest = Math.max(widest, fmtTick(snapNearZero(t, step)).length);
    }
  }
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
 */
const TICK_CAP = 200;
const TICK_EPS = 1e-6;

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

export function buildPlotSvg(series: Series[], options: PlotOptions = {}): string {
  const W = options.width ?? 380;
  const H = options.height ?? 270;
  // THE LEFT MARGIN HAS TO FIT THE LABELS THAT GO IN IT. A fixed 48 px is
  // ample for "0" and "100" and far too little for "1.0e+8", which then ran
  // back over the rotated y-axis title sitting at x = 12. The margin is
  // therefore computed from the WIDEST tick label this data will actually
  // produce, which is knowable before anything is drawn because the tick
  // values depend only on the data range.
  const ml = leftMarginFor(series, options);
  const mr = rightMarginFor(series, options);
  const mt = options.title ? 26 : 12;
  // The error-bar declaration needs its own line, or it lands on the x label.
  const hasErrNote = !!options.errorBars && series.some((s) => s.points.some((p) => p.err !== undefined));
  const mb = (options.xlabel ? 42 : 30) + (hasErrNote ? 13 : 0);
  const pw = W - ml - mr;
  const ph = H - mt - mb;

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
  if (!all.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No data to plot</text></svg>`;
  }

  // THE LEGEND LIVES OUTSIDE THE PLOT FRAME, in a gutter to its right. It used
  // to sit inside the top-right corner of the plot area, where the only
  // defensible rendering is an opaque box — and an opaque box over the plot is
  // data covered by its own key. The gutter is paid for by WIDENING THE
  // CANVAS, not by shrinking the plot: Word inserts figures at the SVG's
  // intrinsic size, so the data area every caller laid out for stays exactly
  // as large as it was, and an unlabeled plot's canvas does not change at all.
  const LEGEND_LH = 14;
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
  const legendW = legendRows.length ? Math.ceil(14 + maxOf(legendRows.map((s) => legendLabelOf(s).length)) * 7 + 10) : 0;
  const outW = legendRows.length ? W + 4 + legendW + 4 : W;

  // Everything below works in TRANSFORMED space: on a log axis the domain, the
  // padding and the tick placement are all computed on log10 values, which is
  // what makes a decade occupy equal width. Only tick LABELS return to data
  // space.
  const logX = options.xScale === "log";
  const logY = options.yScale === "log";
  const tx = (x: number): number => (logX ? Math.log10(x) : x);
  const ty = (y: number): number => (logY ? Math.log10(y) : y);

  let xmin = minOf(all.map((p) => tx(p.x)));
  let xmax = maxOf(all.map((p) => tx(p.x)));
  // On a log y axis an error bar may reach to or below zero, where log is
  // undefined; clamp its lower end into the domain instead of dropping a point
  // that is itself perfectly plottable.
  const lowY = (p: Point): number => {
    const raw = p.y - (p.err ?? 0);
    if (!logY) return raw;
    return ty(raw > 0 ? raw : p.y);
  };
  let ymin = minOf(all.map(lowY));
  let ymax = maxOf(all.map((p) => ty(p.y + (p.err ?? 0))));
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

  const sx = (x: number): number => ml + ((tx(x) - xmin) / (xmax - xmin)) * pw;
  const sy = (y: number): number => mt + ph - ((ty(y) - ymin) / (ymax - ymin)) * ph;

  const parts: string[] = [`<rect width="${outW}" height="${H}" fill="#fff"/>`];
  // Plot frame.
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="#888" stroke-width="1"/>`);

  // Ticks + gridlines.
  if (logX) {
    const { major, minor } = logTicks(xmin, xmax);
    for (const v of minor) {
      const px = sx(v);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#f5f5f5"/>`);
    }
    for (const v of major) {
      const px = sx(v);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#eee"/>`);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="#888"/>`);
      parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${fmtLogTick(v)}</text>`);
    }
  } else {
    const xstep = niceStep(xmax - xmin, 6);
    for (let i = 0, t = Math.ceil(xmin / xstep) * xstep; i <= TICK_CAP && t <= xmax + xstep * TICK_EPS; i++, t += xstep) {
      const px = sx(t);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#eee"/>`);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="#888"/>`);
      parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(snapNearZero(t, xstep))}</text>`);
    }
  }
  if (logY) {
    const { major, minor } = logTicks(ymin, ymax);
    for (const v of minor) {
      const py = sy(v);
      parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#f5f5f5"/>`);
    }
    for (const v of major) {
      const py = sy(v);
      parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#eee"/>`);
      parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="#888"/>`);
      parts.push(`<text x="${ml - 7}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">${fmtLogTick(v)}</text>`);
    }
  } else {
    const ystep = niceStep(ymax - ymin, 5);
    for (let i = 0, t = Math.ceil(ymin / ystep) * ystep; i <= TICK_CAP && t <= ymax + ystep * TICK_EPS; i++, t += ystep) {
      const py = sy(t);
      parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#eee"/>`);
      parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="#888"/>`);
      parts.push(`<text x="${ml - 7}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(snapNearZero(t, ystep))}</text>`);
    }
  }

  // Series.
  // 10 distinct colors (matplotlib "tab10") so series stay distinguishable.
  const palette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  series.forEach((sObj, idx) => {
    const color = sObj.color ?? palette[idx % palette.length];
    // Both coordinates, matching the domain filter above — a finite-y point
    // with Infinity x otherwise draws "LNaN,…" into the path.
    const pts = sObj.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (sObj.type === "line") {
      const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
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
        parts.push(`<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.6" fill="${color}"/>`);
      }
    }
  });

  // Legend, in the gutter right of the plot frame — outside the data area, so
  // it can never cover a curve. (Its predecessor sat inside the frame; opacity
  // kept the curves from striking out the labels, but the box still hid
  // whatever data lay beneath it.) ml + pw + mr === W, so x = W is the first
  // pixel past the tick-overhang reserve and the gutter begins there.
  if (legendRows.length) {
    const lx = W + 4;
    const ly = mt + 4;
    parts.push(`<rect x="${lx}" y="${ly}" width="${legendW}" height="${legendRows.length * LEGEND_LH + 6}" fill="#ffffff" stroke="#ccc"/>`);
    legendRows.forEach((s, i) => {
      const color = s.color ?? palette[series.indexOf(s) % palette.length];
      const cyl = ly + 9 + i * LEGEND_LH;
      parts.push(`<line x1="${lx + 6}" y1="${cyl}" x2="${lx + 20}" y2="${cyl}" stroke="${color}" stroke-width="2"/>`);
      parts.push(`<text x="${lx + 24}" y="${cyl + 3.5}" font-family="sans-serif" font-size="10" fill="#333">${escapeXml(legendLabelOf(s))}</text>`);
    });
  }

  // Labels.
  if (options.title) {
    parts.push(`<text x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#222">${escapeXml(options.title)}</text>`);
  }
  if (hasErrNote) {
    parts.push(
      `<text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#555">${escapeXml(ERROR_BAR_LABEL[options.errorBars as ErrorBarKind])}</text>`,
    );
  }
  if (options.xlabel) {
    parts.push(`<text x="${ml + pw / 2}" y="${H - (hasErrNote ? 21 : 8)}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#333">${escapeXml(options.xlabel)}</text>`);
  }
  if (options.ylabel) {
    // The same constants the margin reserves room from, so the two cannot
    // drift apart — which is how the title came to be wider than its space.
    const cx = Y_TITLE_X;
    const cy = mt + ph / 2;
    parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="${Y_TITLE_SIZE}" fill="#333" transform="rotate(-90 ${cx} ${cy})">${escapeXml(options.ylabel)}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${H}" viewBox="0 0 ${outW} ${H}">${parts.join("")}</svg>`;
}
