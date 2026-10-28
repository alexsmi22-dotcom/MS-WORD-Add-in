/**
 * THE FIGURE CONTEXT (2026-10-28, "fully inclusive" figure fix). One re-render context for every Finance and
 * Statistics figure, so a figure style (lib/figureStyle.ts presets, applied by insertCapability.prepareFigure) can
 * REDRAW a calculator's figure at the style's width and in black and white, instead of scaling the colour figure as
 * drawn and refusing it.
 *
 * HOW IT WORKS. The pane re-runs the calculator inside withFigCtx({ width, bw, style }). Every shared builder the
 * Finance and Statistics calculators draw with (plot.ts buildPlotSvg, statchart.ts box/forest/bar, mechchart.ts hBarSvg
 * and ladderSvg, treeSvg.ts, survivalFigure.ts …) reads currentFigCtx() and draws its canvas that wide (height in
 * proportion) and, when bw is set, in black and white. Finance's withFinFig/currentFinFig (financeFigures.ts) are this
 * same context under their old names, so the two halves cannot drift apart.
 *
 * styleFigureSvg then makes the redrawn figure meet the style's own rules where a builder cannot know them:
 *  - black and white (USPTO, 37 CFR 1.84(a)(1)): every ink pure black, every fill white, black or a hatch, no
 *    opacity, and super/subscript CHARACTERS (ₜpₓ, ²) set as full-size digits raised or lowered (their height is
 *    otherwise unmeasurable, 1.84(p)(3));
 *  - a text-size band (Nature 5–7 pt, Cell 6–8 pt, Thesis 8–12 pt): text larger than the band allows relative to the
 *    figure's smallest text is set smaller (titles come onto the body-text scale). Text only ever SHRINKS, so no label
 *    can grow into its neighbour.
 *
 * figureRenderer(compute) is the render callback the pane hands to prepareFigure / the panel tray, and the one the
 * figure-style gate test (figureStyleGate.test.ts) runs for every calculator, preset and width.
 */
import type { FigureStylePreset } from "./figureStyle";

export interface FigCtx {
  /** Canvas width, user units (px at 96 dpi). */
  width: number;
  /** Black-and-white line art (USPTO). */
  bw: boolean;
  /** The figure style being met, when there is one. */
  style?: FigureStylePreset | null;
  /** The printed width (mm) the style places the figure at, when known. */
  widthMm?: number;
  /**
   * Layout decisions taken on the FIRST render of a style fit, reused by every later render of that fit (key: the
   * decision's own name and order). A layout that switched with the canvas width (one column or two) made the size
   * fit oscillate between the two and never converge.
   */
  memo?: Map<string, number>;
}

/**
 * A layout decision that holds for the whole style fit: the first render decides (`decide()`), later renders of the
 * same fit reuse it. Outside a fit, `decide()` every time. `name` must be unique per decision within one figure.
 */
export function stickyLayout(name: string, decide: () => number): number {
  const memo = ctx?.memo;
  if (!memo) return decide();
  const seq = (seqCounter.get(name) ?? 0) + 1;
  seqCounter.set(name, seq);
  const key = `${name}#${seq}`;
  const got = memo.get(key);
  if (got !== undefined) return got;
  const v = decide();
  // Kept from the SECOND render on: the first is drawn at the full printed width, the second at the width the fit
  // measured the text for, which is close to the final one (a decision taken at full width under-estimated how tall
  // a USPTO stack ends up once its canvas narrows to letter the text 3.5 mm high).
  if ((memo.get(RENDERS) ?? 0) >= 2) memo.set(key, v);
  return v;
}
const RENDERS = "\u0000renders";
/** Per-render call counter for stickyLayout keys (reset at the start of every render). */
const seqCounter = new Map<string, number>();

let ctx: FigCtx | null = null;

/** Runs `fn` with every shared figure builder drawing at `fig`'s width and colour mode. `null` clears the context. */
export function withFigCtx<T>(fig: FigCtx | null, fn: () => T): T {
  const prev = ctx;
  ctx = fig && Number.isFinite(fig.width) && fig.width > 0 ? fig : null;
  try {
    return fn();
  } finally {
    ctx = prev;
  }
}

/** The current figure context, or null outside a re-render. */
export function currentFigCtx(): FigCtx | null {
  return ctx;
}

/**
 * A builder's canvas under the context: the context's width, the height scaled in proportion from the builder's own
 * default aspect (never below `minH`). Outside a context, the builder's own size, unchanged.
 */
export function ctxCanvas(w0: number, h0: number, minH = 0): { w: number; h: number; bw: boolean } {
  if (!ctx) return { w: w0, h: h0, bw: false };
  const w = ctx.width;
  return { w, h: Math.max(minH, Math.round((h0 * w) / w0)), bw: ctx.bw };
}

/**
 * Runs `fn` with the context narrowed to one cell of a `cols`-column grid (gap `gap` between cells), for a builder
 * that composes panels side by side: each panel is drawn at the cell width, so the grid is the context's width.
 * Outside a context it simply runs `fn`.
 */
export function withCellCtx<T>(cols: number, gap: number, fn: () => T): T {
  if (!ctx || !(cols > 1)) return fn();
  const w = Math.max(60, (ctx.width - gap * (cols - 1)) / cols);
  return withFigCtx({ ...ctx, width: w }, fn);
}

/** The render callback a figure style calls: re-run `compute` at canvas width `w` in that style, then fit the style. */
export function figureRenderer(compute: () => string | undefined | null): (w: number, style?: FigureStylePreset, widthMm?: number) => string {
  // One memo per (style, printed width): the renders of one style fit share their layout decisions (stickyLayout).
  const memos = new Map<string, Map<string, number>>();
  return (w: number, style?: FigureStylePreset, widthMm?: number): string => {
    let memo: Map<string, number> | undefined;
    if (style && widthMm !== undefined) {
      const key = `${style.id}@${widthMm}`;
      memo = memos.get(key);
      if (!memo) memos.set(key, (memo = new Map()));
      memo.set(RENDERS, (memo.get(RENDERS) ?? 0) + 1);
    }
    seqCounter.clear();
    const svg = withFigCtx({ width: w, bw: style?.color === "bw", style: style ?? null, widthMm, memo }, () => compute() ?? "");
    return svg ? styleFigure(svg, style ?? null) : "";
  };
}

// ---------------------------------------------------------------------------
// Style fitting
// ---------------------------------------------------------------------------

const SUP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "−", "⁺": "+",
  "ⁿ": "n", "ⁱ": "i",
};
const SUB: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₋": "−", "₊": "+",
  "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t",
  "ᵢ": "i", "ⱼ": "j", "ᵣ": "r", "ᵤ": "u", "ᵥ": "v",
};
const SUPSUB_ANY = new RegExp(`[${Object.keys(SUP).join("")}${Object.keys(SUB).join("")}]`);

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function unescText(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/**
 * A text run's super/subscript characters as full-size characters raised or lowered with tspans (as plot.ts
 * bwTextMarkup does for its own text). The baseline is restored at the end so following text is not shifted.
 */
export function supSubMarkup(raw: string, fontPx: number): string {
  const text = unescText(raw);
  if (!SUPSUB_ANY.test(text)) return raw;
  const shift = Math.round(fontPx * 0.38 * 10) / 10;
  const NBSP = String.fromCharCode(160);
  const runs: { level: number; s: string }[] = [];
  for (const ch of text) {
    const l = ch in SUP ? 1 : ch in SUB ? -1 : 0;
    const c = l > 0 ? SUP[ch] : l < 0 ? SUB[ch] : ch;
    if (runs.length && runs[runs.length - 1].level === l) runs[runs.length - 1].s += c;
    else runs.push({ level: l, s: c });
  }
  let out = "";
  let at = 0;
  for (const r of runs) {
    const dy = Math.round((at - r.level) * shift * 10) / 10;
    const body = escText(r.s.replace(/^ | $/g, NBSP));
    out += dy === 0 && out === "" ? body : `<tspan dy="${dy}">${body}</tspan>`;
    at = r.level;
  }
  return out;
}

const BW_PAINT_OK = /^(none|transparent|inherit|currentcolor|black|white|#000|#000000|#fff|#ffffff|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|url\(#[^)]+\))$/i;

const NAMED: Record<string, string> = {
  red: "#ff0000", green: "#008000", blue: "#0000ff", grey: "#808080", gray: "#808080", orange: "#ffa500", purple: "#800080",
  silver: "#c0c0c0", lightgrey: "#d3d3d3", lightgray: "#d3d3d3", darkgrey: "#a9a9a9", darkgray: "#a9a9a9",
  whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", navy: "#000080", teal: "#008080", maroon: "#800000",
};

/** Relative luminance 0–1 of a CSS colour, or null when it cannot be read. */
function luminance(c: string): number | null {
  let s = c.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let r: number, g: number, b: number;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    [r, g, b] = m[1].split("").map((h) => parseInt(h + h, 16));
  } else if ((m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s))) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s))) {
    r = +m[1];
    g = +m[2];
    b = +m[3];
  } else return null;
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Hatches for black-and-white fills: black lines on a TRANSPARENT ground, so a band over a curve never hides it. */
const HATCH_IDS = ["fx-h0", "fx-h1", "fx-h2", "fx-h3", "fx-h4", "fx-h5"];
function hatchDefs(used: number): string {
  const pats = [
    `<pattern id="fx-h0" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="1"/></pattern>`,
    `<pattern id="fx-h1" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="1"/></pattern>`,
    `<pattern id="fx-h2" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="0.8"/><line x1="0" y1="0" x2="5" y2="0" stroke="#000" stroke-width="0.8"/></pattern>`,
    `<pattern id="fx-h3" patternUnits="userSpaceOnUse" width="5" height="5"><line x1="0" y1="2.5" x2="5" y2="2.5" stroke="#000" stroke-width="1"/></pattern>`,
    `<pattern id="fx-h4" patternUnits="userSpaceOnUse" width="5" height="5"><line x1="2.5" y1="0" x2="2.5" y2="5" stroke="#000" stroke-width="1"/></pattern>`,
    `<pattern id="fx-h5" patternUnits="userSpaceOnUse" width="6" height="6"><circle cx="3" cy="3" r="1.1" fill="#000"/></pattern>`,
  ];
  return used ? `<defs>${pats.slice(0, Math.min(used, pats.length)).join("")}</defs>` : "";
}

const PAINT_ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color", "lighting-color"];
const OPACITY_ATTRS = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "flood-opacity"];

/**
 * The figure in pure black and white: inks (strokes, text) black; a shape's fill white when it is near white, black
 * on a marker (circle, ellipse), otherwise a hatch keyed by its colour (so two coloured series stay two patterns) with
 * a black outline; every opacity removed (black at 0.35 prints grey). Gradients and images cannot be made black and
 * white here and are left for the style check to refuse by name.
 */
export function blackAndWhite(svg: string, hatching = true): string {
  const hatchOf = new Map<string, string>();
  const hatch = (colour: string): string => {
    const k = colour.trim().toLowerCase();
    let id = hatchOf.get(k);
    if (!id) {
      id = HATCH_IDS[hatchOf.size % HATCH_IDS.length];
      hatchOf.set(k, id);
    }
    return `url(#${id})`;
  };
  let inDefs = 0;
  const out = svg.replace(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g, (whole, close: string, tagName: string, attrs: string, selfClose: string) => {
    const tag = tagName.toLowerCase();
    if (close) {
      if (tag === "defs" || tag === "pattern" || tag === "clippath" || tag === "mask") inDefs = Math.max(0, inDefs - 1);
      return whole;
    }
    const opens = (tag === "defs" || tag === "pattern" || tag === "clippath" || tag === "mask") && !selfClose;
    let a = attrs;
    // style="fill:…;stroke:…" → attributes, so the rules below see them.
    a = a.replace(/\sstyle="([^"]*)"/, (_m, st: string) => {
      const keep: string[] = [];
      let extra = "";
      for (const decl of st.split(";")) {
        const mm = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(decl);
        if (!mm) continue;
        if (PAINT_ATTRS.includes(mm[1]) || OPACITY_ATTRS.includes(mm[1])) extra += ` ${mm[1]}="${mm[2]}"`;
        else keep.push(`${mm[1]}:${mm[2]}`);
      }
      return (keep.length ? ` style="${keep.join(";")}"` : "") + extra;
    });
    // Opacity below 1 prints grey: removed (a hatch keeps a translucent band from hiding what lies under it).
    for (const p of OPACITY_ATTRS) a = a.replace(new RegExp(`\\s${p}="[^"]*"`, "g"), "");
    const get = (p: string): string | undefined => new RegExp(`\\s${p}="([^"]*)"`).exec(a)?.[1];
    const set = (p: string, v: string): void => {
      if (get(p) !== undefined) a = a.replace(new RegExp(`(\\s${p}=")[^"]*(")`), `$1${v}$2`);
      else a += ` ${p}="${v}"`;
    };
    for (const p of ["stroke", "stop-color", "color", "flood-color", "lighting-color"]) {
      const v = get(p);
      if (v !== undefined && !BW_PAINT_OK.test(v.trim())) set(p, "#000");
    }
    const fill = get("fill");
    if (fill !== undefined && !BW_PAINT_OK.test(fill.trim())) {
      const isInk = tag === "text" || tag === "tspan";
      const L = luminance(fill);
      if (isInk) set("fill", "#000");
      else if (inDefs) set("fill", L !== null && L > 0.5 ? "#fff" : "#000");
      else if (L !== null && L >= 0.8) set("fill", "#fff");
      else if (tag === "circle" || tag === "ellipse") set("fill", "#000");
      else if (!hatching) {
        // More colours than hatches (a heat map): left as drawn, so the style check refuses it by name rather than
        // cycling six hatches over a colour scale and printing a figure whose shading means nothing.
      } else {
        set("fill", hatch(fill));
        if (get("stroke") === undefined || get("stroke") === "none") {
          set("stroke", "#000");
          if (get("stroke-width") === undefined) a += ` stroke-width="0.8"`;
        }
      }
    }
    if (opens) inDefs++;
    return `<${tagName}${a}${selfClose}>`;
  });
  if (hatching && hatchOf.size > HATCH_IDS.length) return blackAndWhite(svg, false);
  if (!hatchOf.size) return out;
  return out.replace(/^(\s*<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>)/, `$1${hatchDefs(hatchOf.size)}`);
}

/** Super/subscript characters in every text run set as raised or lowered full-size characters (black and white). */
function supSubAll(svg: string): string {
  if (!SUPSUB_ANY.test(svg)) return svg;
  // The innermost text-bearing element: a <text> or <tspan> whose content (up to the next tag) has the characters.
  return svg.replace(/(<(?:text|tspan)\b((?:[^>"']|"[^"]*"|'[^']*')*)>)([^<]+)/g, (whole, open: string, attrs: string, body: string) => {
    if (!SUPSUB_ANY.test(body)) return whole;
    const fs = /\sfont-size="([\d.]+)/.exec(attrs);
    return open + supSubMarkup(body, fs ? parseFloat(fs[1]) : 10);
  });
}

/**
 * Text sizes brought inside the style's band: no run larger than `ratio` times the smallest run (ratio a hair under
 * the band's max/min so the fit has room). Larger runs (titles, axis titles) are set smaller; nothing grows.
 */
export function fitTextBand(svg: string, ratio: number): string {
  if (!(ratio > 1)) return svg;
  // Sizes are compared as DRAWN: a font-size inside a scaled group (a panel fitted into a grid cell) prints at
  // size × scale, so the walk keeps the stack of group scales.
  const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const scaleOf = (attrs: string): number => {
    const t = /\stransform="([^"]*)"/.exec(attrs)?.[1];
    if (!t) return 1;
    let s = 1;
    for (const m of t.matchAll(/scale\(\s*([\d.eE+-]+)(?:[\s,]+([\d.eE+-]+))?\s*\)/g)) s *= Math.abs(parseFloat(m[2] ?? m[1]));
    return Number.isFinite(s) && s > 0 ? s : 1;
  };
  const walk = (visit: (attrs: string, scale: number) => string): string => {
    const stack: { tag: string; scale: number }[] = [{ tag: "#root", scale: 1 }];
    return svg.replace(TAG, (whole, close: string, tagName: string, attrs: string, self: string) => {
      const tag = tagName.toLowerCase();
      if (close) {
        for (let i = stack.length - 1; i > 0; i--)
          if (stack[i].tag === tag) {
            stack.length = i;
            break;
          }
        return whole;
      }
      const scale = stack[stack.length - 1].scale * scaleOf(attrs);
      if (!self) stack.push({ tag, scale });
      return tag === "text" || tag === "tspan" ? `<${tagName}${visit(attrs, scale)}${self}>` : whole;
    });
  };
  const drawn: number[] = [];
  walk((attrs, scale) => {
    const m = /\sfont-size="([\d.]+)(?:px)?"/.exec(attrs);
    if (m && parseFloat(m[1]) > 0) drawn.push(parseFloat(m[1]) * scale);
    return attrs;
  });
  if (!drawn.length) return svg;
  const cap = Math.min(...drawn) * ratio;
  if (Math.max(...drawn) <= cap) return svg;
  return walk((attrs, scale) =>
    attrs.replace(/(\sfont-size=")([\d.]+)((?:px)?")/, (whole, a: string, v: string, b: string) =>
      parseFloat(v) * scale > cap ? `${a}${Math.floor((cap / scale) * 100) / 100}${b}` : whole,
    ),
  );
}

/** A redrawn figure fitted to `style`: black and white when the style requires it, text inside the style's band. */
export function styleFigure(svg: string, style: FigureStylePreset | null): string {
  if (!style || !svg) return svg;
  let s = svg;
  // The style's own typeface (Arial/Helvetica, or Times for the thesis): the size fit is computed for it, and a
  // builder's "Segoe UI, Arial" stack has smaller capitals, so its letters missed the USPTO 3.52 mm by 1.7 %.
  if (style.fontFamily && !style.fontFamily.includes('"')) s = s.replace(/(\sfont-family=")[^"]*(")/g, `$1${style.fontFamily}$2`);
  if (style.color === "bw") s = supSubAll(blackAndWhite(s));
  const { min, max } = style.sizesPt;
  if (max !== null && min > 0) s = fitTextBand(s, (max / min) * 0.985);
  return s;
}
