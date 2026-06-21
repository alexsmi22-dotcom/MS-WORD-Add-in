// Lightweight pure-SVG plotter: function plots (y = f(x)) and data plots (scatter
// / line, optional error bars), with axes, ticks, and labels. Includes a small,
// safe expression evaluator (no eval/Function) so the add-in stays offline and
// CSP-clean. The task pane rasterizes the SVG to PNG and inserts it as a picture.
//
// Pure logic — no Office.js — fully unit-testable.

// --- Expression evaluator ----------------------------------------------------

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
  log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
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
        const arg = parseExpr();
        if (s[i] !== ")") throw new Error("Missing ')'");
        i++;
        const fn = FUNCS[id.toLowerCase()];
        if (!fn) throw new Error(`Unknown function ${id}`);
        return fn(arg);
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

export interface PlotOptions {
  width?: number;
  height?: number;
  title?: string;
  xlabel?: string;
  ylabel?: string;
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function fmtTick(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders one or more series to an SVG string with axes, ticks, and labels. */
export function buildPlotSvg(series: Series[], options: PlotOptions = {}): string {
  const W = options.width ?? 380;
  const H = options.height ?? 270;
  const ml = 48;
  const mr = 14;
  const mt = options.title ? 26 : 12;
  const mb = options.xlabel ? 42 : 30;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const all: Point[] = [];
  for (const s of series) for (const p of s.points) all.push(p);
  if (!all.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No data to plot</text></svg>`;
  }

  let xmin = Math.min(...all.map((p) => p.x));
  let xmax = Math.max(...all.map((p) => p.x));
  let ymin = Math.min(...all.map((p) => p.y - (p.err ?? 0)));
  let ymax = Math.max(...all.map((p) => p.y + (p.err ?? 0)));
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

  const sx = (x: number): number => ml + ((x - xmin) / (xmax - xmin)) * pw;
  const sy = (y: number): number => mt + ph - ((y - ymin) / (ymax - ymin)) * ph;

  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#fff"/>`];
  // Plot frame.
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="#888" stroke-width="1"/>`);

  // Ticks + gridlines.
  const xstep = niceStep(xmax - xmin, 6);
  for (let t = Math.ceil(xmin / xstep) * xstep; t <= xmax + 1e-9; t += xstep) {
    const px = sx(t);
    parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#eee"/>`);
    parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="#888"/>`);
    parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(t)}</text>`);
  }
  const ystep = niceStep(ymax - ymin, 5);
  for (let t = Math.ceil(ymin / ystep) * ystep; t <= ymax + 1e-9; t += ystep) {
    const py = sy(t);
    parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#eee"/>`);
    parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="#888"/>`);
    parts.push(`<text x="${ml - 7}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(t)}</text>`);
  }

  // Series.
  const palette = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e"];
  series.forEach((sObj, idx) => {
    const color = sObj.color ?? palette[idx % palette.length];
    const pts = sObj.points.filter((p) => Number.isFinite(p.y));
    if (sObj.type === "line") {
      const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
    } else {
      for (const p of pts) {
        if (p.err) {
          parts.push(`<line x1="${sx(p.x).toFixed(1)}" y1="${sy(p.y - p.err).toFixed(1)}" x2="${sx(p.x).toFixed(1)}" y2="${sy(p.y + p.err).toFixed(1)}" stroke="${color}" stroke-width="1"/>`);
        }
        parts.push(`<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.6" fill="${color}"/>`);
      }
    }
  });

  // Legend (top-right inside the plot area) for any labeled series.
  const labeled = series.filter((s) => s.label && s.label.trim());
  if (labeled.length) {
    const lh = 14;
    const maxChars = 22;
    const labelOf = (s: Series): string => {
      const t = (s.label as string).trim();
      return t.length > maxChars ? t.slice(0, maxChars - 1) + "…" : t;
    };
    const maxRows = Math.max(1, Math.floor((ph - 10) / lh));
    const shown = labeled.slice(0, maxRows);
    const lw = Math.min(14 + Math.max(...shown.map((s) => labelOf(s).length)) * 6 + 8, pw - 8);
    const lx = ml + pw - lw - 4;
    const ly = mt + 4;
    parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="${shown.length * lh + 6}" fill="#fff" fill-opacity="0.82" stroke="#ccc"/>`);
    shown.forEach((s, i) => {
      const color = s.color ?? palette[series.indexOf(s) % palette.length];
      const cyl = ly + 9 + i * lh;
      parts.push(`<line x1="${lx + 6}" y1="${cyl}" x2="${lx + 20}" y2="${cyl}" stroke="${color}" stroke-width="2"/>`);
      parts.push(`<text x="${lx + 24}" y="${cyl + 3.5}" font-family="sans-serif" font-size="10" fill="#333">${escapeXml(labelOf(s))}</text>`);
    });
  }

  // Labels.
  if (options.title) {
    parts.push(`<text x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#222">${escapeXml(options.title)}</text>`);
  }
  if (options.xlabel) {
    parts.push(`<text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#333">${escapeXml(options.xlabel)}</text>`);
  }
  if (options.ylabel) {
    const cx = 14;
    const cy = mt + ph / 2;
    parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#333" transform="rotate(-90 ${cx} ${cy})">${escapeXml(options.ylabel)}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}
