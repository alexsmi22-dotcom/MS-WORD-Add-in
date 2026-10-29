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
/**
 * How long one renderer may spend re-running its calculator across a style fit (several widths, several styles)
 * before it refuses. A style fit re-runs the whole compute up to about seven times; on a large input (Tukey at 20
 * groups, IV at its row cap) that was tens of seconds of frozen Word (figure-track report 2026-10-28). The refusal
 * reaches the user through prepareFigure's "could not be redrawn" reason with this message.
 */
export const RENDER_BUDGET_MS = 4000;
export const RENDER_BUDGET_MESSAGE =
  "this result takes too long to recompute for a figure style; insert it with the style \"As drawn\", or use less data";

/**
 * `budgetMs` defaults to RENDER_BUDGET_MS. The style-compliance gate (figureStyleGate.test.ts) passes Infinity: jest
 * runs these calculators several times slower than the production bundle, and a loaded test machine must not turn a
 * compliance gate into a timing test.
 */
export type FigureRenderFn = ((w: number, style?: FigureStylePreset, widthMm?: number) => string) & {
  /**
   * Starts a new style fit (insertCapability.prepareFigure / composePanelFigure call it before renderAtPreset): the
   * time budget and the layout memos are per FIT, not per renderer (round 2: the budget accumulated across every styled
   * insert of one preview, so a 120 ms calculator was refused on its 18th insert).
   */
  beginFit: () => void;
};

/** Starts a new style fit on `render` when it is a figureRenderer (anything else has no budget to reset). */
export function beginFigureFit(render: unknown): void {
  const f = render as { beginFit?: unknown } | null | undefined;
  if (f && typeof f.beginFit === "function") (f.beginFit as () => void)();
}

export function figureRenderer(compute: () => string | undefined | null, budgetMs: number = RENDER_BUDGET_MS): FigureRenderFn {
  // One memo per (style, printed width): the renders of one style fit share their layout decisions (stickyLayout).
  const memos = new Map<string, Map<string, number>>();
  let spent = 0;
  const fn = (w: number, style?: FigureStylePreset, widthMm?: number): string => {
    if (spent > budgetMs) throw new Error(RENDER_BUDGET_MESSAGE);
    const t0 = Date.now();
    try {
      return renderOnce(w, style, widthMm);
    } finally {
      spent += Date.now() - t0;
    }
  };
  return Object.assign(fn, {
    beginFit: (): void => {
      spent = 0;
      memos.clear();
    },
  });
  function renderOnce(w: number, style?: FigureStylePreset, widthMm?: number): string {
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
  }
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

/** Dash patterns for coloured strokes in black and white (figureStyle.ts USPTO_DASHES, the patent line set). */
const BW_STROKE_DASHES = ["", "7 3", "2.5 2.5", "9 3 2.5 3", "12 4", "5 4 1.5 4"];

/** A colour with a real hue (not a grey): HSV saturation above 0.25 and not near black. */
function saturated(c: string): boolean {
  let s = c.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  let rgb: number[] | null = null;
  if (m) rgb = m[1].split("").map((h) => parseInt(h + h, 16));
  else if ((m = /^#([0-9a-f]{6})/.exec(s))) rgb = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
  else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s))) rgb = [+m[1], +m[2], +m[3]];
  if (!rgb) return false;
  const mx = Math.max(...rgb);
  const mn = Math.min(...rgb);
  return mx > 40 && (mx - mn) / mx > 0.25;
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
  // Saturated stroke colours, in order of appearance → dash patterns (the first stays solid).
  const dashFor = new Map<string, string>();
  const dashOf = (colour: string): string => {
    if (!saturated(colour)) return "";
    const k = colour.trim().toLowerCase();
    let d = dashFor.get(k);
    if (d === undefined) {
      d = BW_STROKE_DASHES[dashFor.size % BW_STROKE_DASHES.length];
      dashFor.set(k, d);
    }
    return d;
  };
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
    // A COLOURED line keeps its identity as a dash pattern keyed by its colour (the legend swatch drawn in the same
    // colour gets the same dash), so "demand" and "supply" stay two lines; a grey rule or axis is plain black.
    const sv = get("stroke");
    if (sv !== undefined && !BW_PAINT_OK.test(sv.trim()) && /^(line|path|polyline)$/.test(tag) && get("stroke-dasharray") === undefined) {
      const dash = dashOf(sv);
      if (dash) a += ` stroke-dasharray="${dash}"`;
      else if (!inDefs && !saturated(sv) && (luminance(sv) ?? 0) >= 0.55) {
        // A LIGHT GREY rule (a gridline, a faint guide) stays light (round 2): a thin dotted black line, not a full
        // black one that reads as data (io-leontief's grid, the forest plot's decade lines).
        a += ` stroke-dasharray="1 2"`;
        if (get("stroke-width") !== undefined) set("stroke-width", "0.5");
        else a += ` stroke-width="0.5"`;
      }
    }
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
  // A title the style prints (USPTO strips it) that is wider than the canvas wraps onto two lines (round 2).
  if (style.allowTitle) s = wrapFigureTitle(s);
  return s;
}

/**
 * A figure title (the one `data-figure-title` text) wider than its room on the canvas, set on TWO lines (the second
 * cut with an ellipsis only if it still does not fit), with the rest of the figure moved down a line and the canvas
 * grown by it. For the builders that draw a one-line title at a fixed size (box, forest, bar and ladder charts…):
 * at a narrow style width it ran off both edges. A title that fits, or two title lines already, is left as it is.
 */
export function wrapFigureTitle(svg: string): string {
  const titles = [...svg.matchAll(/<text\b([^>]*\bdata-figure-title="1"[^>]*)>([^<]*)<\/text>/g)];
  if (titles.length !== 1 || (svg.match(/data-figure-title="1"/g) ?? []).length !== 1) return svg;
  const m = titles[0];
  const attrs = m[1];
  const num = (k: string): number => Number(new RegExp(`\\s${k}="(-?[\\d.]+)`).exec(attrs)?.[1] ?? NaN);
  const x = num("x");
  const y = num("y");
  const fs = num("font-size");
  const root = /^\s*<svg\b[^>]*>/.exec(svg);
  if (!root || !Number.isFinite(x) || !Number.isFinite(y) || !(fs > 0)) return svg;
  const vb = /\sviewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(root[0]);
  const W = vb ? Number(vb[1]) + Number(vb[3]) : Number(/\swidth="([\d.]+)/.exec(root[0])?.[1] ?? NaN);
  const H = vb ? Number(vb[4]) : Number(/\sheight="([\d.]+)/.exec(root[0])?.[1] ?? NaN);
  if (!(W > 0) || !(H > 0)) return svg;
  const text = unescText(m[2]);
  const anchor = /\stext-anchor="(\w+)"/.exec(attrs)?.[1] ?? "start";
  const room = anchor === "middle" ? 2 * Math.min(x, W - x) - 4 : anchor === "end" ? x - 2 : W - x - 2;
  if (text.length * fs * 0.58 <= room) return svg;
  const lines = wrapLabel(text, room, fs);
  if (lines.length < 2) return svg.split(m[0]).join(`<text${attrs}>${escText(lines[0])}</text>`);
  const lh = Math.round(fs * 1.2 * 10) / 10;
  const dy = Math.round(lh * (lines.length - 1) * 10) / 10;
  // Inside the moved group the title's own lines are moved back up, so they stay at the top.
  const setY = (v: number): string => attrs.replace(/(\sy=")-?[\d.]+(")/, `$1${Math.round(v * 10) / 10}$2`);
  // Every line carries the title mark, so a style without titles strips them all and a second pass leaves them alone.
  const two = lines.map((l, i) => `<text${setY(y - dy + i * lh)}>${escText(l)}</text>`).join("");
  let body = svg.slice(root[0].length).split(m[0]).join(two);
  body = body.replace(/<\/svg>\s*$/, "");
  // The paper (a full-canvas rect drawn first) grows with the canvas instead of moving.
  let paper = "";
  const bg = /^\s*<rect\b([^>]*)\/>/.exec(body);
  if (bg && !/\s(x|y)="(?!0")/.test(bg[1]) && Number(/\sheight="([\d.]+)/.exec(bg[1])?.[1]) >= H - 0.5) {
    paper = `<rect${bg[1].replace(/(\sheight=")[\d.]+(")/, `$1${H + dy}$2`)}/>`;
    body = body.slice(bg[0].length);
  }
  let open = root[0].replace(/(\sheight=")([\d.]+)(")/, (_a, p: string, v: string, q: string) => `${p}${Number(v) + dy}${q}`);
  if (vb) open = open.replace(/(\sviewBox="\s*-?[\d.]+[\s,]+-?[\d.]+[\s,]+[\d.]+[\s,]+)([\d.]+)/, (_a, p: string, v: string) => `${p}${Number(v) + dy}`);
  return `${open}${paper}<g transform="translate(0,${dy})">${body}</g></svg>`;
}

/** The layout ctxFrameLayout returns: margins, wrapped axis titles, and (under a re-render) the legend's rows. */
export interface CtxFrameLayout {
  ML: number;
  MB: number;
  xLines: string[];
  yLines: string[];
  /** null as drawn (the caller draws its legend as it always did); else one entry per item, in order. */
  legend: { lines: string[]; dy: number }[] | null;
  /** Below the plot frame: where the first legend row's centre is (as drawn: the caller's own offset). */
  legendTop: number;
}

/**
 * For a builder that draws its own plot frame (10 px axis titles at x = 13 rotated and under the frame at +30, a legend
 * row under that at +48): under a figure-style re-render (round 2) the axis titles wrap to the canvas (the y title's
 * second line 13 px further right, so the left margin grows by 13), and the legend takes ONE ROW PER ITEM from x = 8,
 * text at x = 35, each item wrapped to the canvas (17 px a line). As drawn: the base margins, one line each, legend null.
 */
export function ctxFrameLayout(W: number, xTitle: string, yTitle: string, legendItems: string[], base: { ML: number; MB: number }): CtxFrameLayout {
  if (!ctx) return { ML: base.ML, MB: base.MB, xLines: [xTitle], yLines: [yTitle], legend: null, legendTop: 48 };
  const ML = base.ML + 13;
  const pw = W - ML - 14;
  const xLines = wrapLabel(xTitle, 2 * Math.min(ML + pw / 2, W - ML - pw / 2) - 4, 10);
  // The plot is at least 0.6 as tall as it is wide (the callers' rule); the y title stays inside that height, clear of
  // the figure title above.
  const yLines = wrapLabel(yTitle, 0.6 * pw, 10);
  const legendTop = 48 + 13 * (xLines.length - 1);
  let at = 0;
  const legend = legendItems.map((t) => {
    const lines = wrapLabel(t, W - 35 - 4, 10);
    const row = { lines, dy: at };
    at += 17 * lines.length;
    return row;
  });
  // Each y-title line past the first is 13 px further right; the margin grows by all of them.
  return { ML: base.ML + 13 * (yLines.length - 1), MB: legendTop + at - 17 + 14, xLines, yLines, legend, legendTop };
}

/**
 * An axis title in lines that fit `room` px at `fs` px (the layout audit's 0.58 em advance): one line when it fits,
 * else two broken at the space that best balances them, the second cut with an ellipsis if it still does not fit.
 * `minLines` 2 keeps a title that was wrapped on two lines even when one would now fit.
 */
export function wrapLabel(text: string, room: number, fs: number, minLines = 1): string[] {
  const max = Math.max(4, Math.floor(room / (0.58 * fs)));
  if (text.length <= max && minLines < 2) return [text];
  const spaces: number[] = [];
  for (let i = 1; i < text.length - 1; i++) if (text[i] === " ") spaces.push(i);
  if (!spaces.length) return text.length <= max ? [text] : [text.slice(0, max - 1) + "…"];
  // The break whose longer line is shortest, among breaks whose first line fits.
  let best = -1;
  let bestLen = Infinity;
  for (const i of spaces) {
    const a = i;
    const b = text.length - i - 1;
    if (a > max) continue;
    if (Math.max(a, b) < bestLen) {
      bestLen = Math.max(a, b);
      best = i;
    }
  }
  if (best < 0) return [text.slice(0, max - 1) + "…"];
  const first = text.slice(0, best).trimEnd();
  let rest = text.slice(best + 1).trim();
  if (rest.length <= max) return [first, rest];
  // Two lines are not enough: up to three, filled greedily (so a unit at the end, "(%)", is not cut), the third cut
  // with an ellipsis only if even that does not fit.
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= 3 && lines.every((l) => l.length <= max)) return lines;
  const three = lines.slice(0, 3).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));
  if (lines.length > 3) three[2] = (three[2].length >= max ? three[2].slice(0, max - 1) : three[2]).trimEnd() + "…";
  rest = rest.slice(0, max - 1).trimEnd() + "…";
  return three.length ? three : [first, rest];
}
