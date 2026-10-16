// Multi-panel figures (A/B/C) as ONE flat SVG document.
//
// NO NESTED <svg>. The old combineSvgs nested each child <svg> inside the root.
// That is valid SVG, but the figure-layout audit only follows
// `<g transform="translate(x,y)">` (scripts/figure-layout-audit.js), so a nested
// panel was measured at the origin and the Cox figure had to be audited panel by
// panel. Here every child root — and any <svg> nested inside a child — becomes a
// <g>: exactly `transform="translate(x,y)"` when no scaling is needed (the form
// the audit flattens), with an inner scale/viewBox group only when one is.
//
// CLIPPING. A nested <svg> clipped its content to its own viewport; a bare <g>
// does not, and an overrunning panel then painted into its neighbour's cell
// (adversarial review, v2.143.0). Each panel group is wrapped in a group clipped
// to its own cell (a root-level <clipPath> rect with no fill). The layout audit
// does not apply clip paths, so content that overruns its panel is still a
// layout defect it SEES; the reader just no longer sees it in the next panel.
//
// IDS. Two panels from the same builder carry the same ids (clip paths, USPTO
// hatch patterns `fi-diag`, gradients, markers). In one document the second
// definition loses and panel B silently paints with panel A's clip. Every id a
// child DEFINES is prefixed per panel (`p0-`, `p1-`, deterministic), and only
// exact references to those ids are rewritten: url(#id), url('#id'), href="#id",
// xlink:href="#id". An id the child does not define is left alone.
//
// LETTERS come from the preset (figureStyle.panelLetterSvg: case, weight, size),
// drawn in ROOT units outside any scaled group, in a band reserved above each
// panel so they never sit on a panel's title. The root is drawn at the preset's
// printed width in CSS px, so a letter's font-size is its true point size.

import {
  type FigureStylePreset,
  type PresetId,
  type PresetWidth,
  getPreset,
  presetWidthMm,
  mmToPx,
  pxToMm,
  fontPx,
  panelLetterSvg,
  panelLabel,
} from "./figureStyle";

const ROOT_OPEN = /^<svg\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/i;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Attributes that describe the viewport, not the content; they do not move to the <g>. */
const VIEWPORT_ATTRS = new Set(["xmlns", "width", "height", "viewbox", "x", "y", "preserveaspectratio", "version", "baseprofile", "overflow", "id"]);

const num = (v: number): string => {
  const r = +v.toFixed(4);
  return String(Object.is(r, -0) ? 0 : r);
};

function parseAttrs(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(text))) out.push([m[1], m[2] ?? m[3] ?? ""]);
  return out;
}

const getAttr = (a: Array<[string, string]>, name: string): string | undefined =>
  a.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

function lengthPx(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*(px)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseViewBox(v: string | undefined): [number, number, number, number] | null {
  if (!v) return null;
  const p = v.trim().split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0 ? (p as [number, number, number, number]) : null;
}

/** Strip an XML declaration, DOCTYPE and leading comments. */
function stripProlog(s: string): string {
  let t = s.trim();
  for (;;) {
    const before = t;
    t = t.replace(/^<\?xml[\s\S]*?\?>\s*/i, "").replace(/^<!DOCTYPE[^>]*>\s*/i, "").replace(/^<!--[\s\S]*?-->\s*/, "");
    if (t === before) return t;
  }
}

interface ParsedSvg {
  attrs: Array<[string, string]>;
  inner: string;
  w: number;
  h: number;
  viewBox: [number, number, number, number] | null;
}

/** A complete SVG document → its root attributes and content. Throws on anything else. */
export function parseSvgRoot(svg: string): ParsedSvg {
  const s = stripProlog(svg);
  const m = ROOT_OPEN.exec(s);
  if (!m) throw new TypeError("a panel must be an SVG document starting with <svg");
  const attrs = parseAttrs(m[1]);
  let inner = "";
  let end = m[0].length;
  if (!m[2]) {
    const c = balancedClose(s, m[0].length);
    if (!c) throw new TypeError("a panel SVG has no closing </svg>");
    inner = s.slice(m[0].length, c.innerEnd);
    end = c.closeEnd;
  }
  if (s.slice(end).trim()) throw new TypeError("a panel has content after its root </svg> (two documents concatenated?)");
  const viewBox = parseViewBox(getAttr(attrs, "viewBox"));
  const w = lengthPx(getAttr(attrs, "width")) ?? (viewBox ? viewBox[2] : 300);
  const h = lengthPx(getAttr(attrs, "height")) ?? (viewBox ? viewBox[3] : 150);
  return { attrs, inner, w, h, viewBox };
}

/** The content-to-viewport transform of a viewBox, per preserveAspectRatio. "" when identity. */
function viewBoxTransform(w: number, h: number, vb: [number, number, number, number] | null, par: string | undefined): string {
  if (!vb) return "";
  const [vx, vy, vw, vh] = vb;
  let sx = w / vw;
  let sy = h / vh;
  let tx = 0;
  let ty = 0;
  const p = (par ?? "xMidYMid meet").trim();
  if (!/^none\b/.test(p)) {
    const slice = /\bslice\b/.test(p);
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
    const align = /^(x(Min|Mid|Max)Y(Min|Mid|Max))/.exec(p);
    const ax = align ? align[2] : "Mid";
    const ay = align ? align[3] : "Mid";
    const fx = ax === "Min" ? 0 : ax === "Mid" ? 0.5 : 1;
    const fy = ay === "Min" ? 0 : ay === "Mid" ? 0.5 : 1;
    tx = (w - vw * s) * fx;
    ty = (h - vh * s) * fy;
  }
  const ops: string[] = [];
  if (Math.abs(tx) > 1e-9 || Math.abs(ty) > 1e-9) ops.push(`translate(${num(tx)},${num(ty)})`);
  if (Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9) ops.push(sx === sy ? `scale(${num(sx)})` : `scale(${num(sx)},${num(sy)})`);
  if (Math.abs(vx) > 1e-9 || Math.abs(vy) > 1e-9) ops.push(`translate(${num(-vx)},${num(-vy)})`);
  return ops.join(" ");
}

function inheritedAttrs(attrs: Array<[string, string]>): string {
  return attrs
    .filter(([k]) => !VIEWPORT_ATTRS.has(k.toLowerCase()) && !/^xmlns:/i.test(k))
    .map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`)
    .join("");
}

/**
 * An <svg> element as <g>: outer `translate(x,y)` (exactly that form), inner group
 * for the extra scale and the viewBox mapping when either is not the identity.
 */
function svgAsGroup(p: ParsedSvg, x: number, y: number, extraScale: number): string {
  const vbT = viewBoxTransform(p.w, p.h, p.viewBox, getAttr(p.attrs, "preserveAspectRatio"));
  const inner = flattenNestedSvgs(p.inner);
  const inh = inheritedAttrs(p.attrs);
  const sc = Math.abs(extraScale - 1) > 1e-9 ? `scale(${num(extraScale)})` : "";
  const t = [sc, vbT].filter(Boolean).join(" ");
  const open = `<g transform="translate(${num(x)},${num(y)})"`;
  if (!t) return `${open}${inh}>${inner}</g>`;
  return `${open}><g transform="${t}"${inh}>${inner}</g></g>`;
}

/**
 * The </svg> that closes an <svg> whose content starts at `from`: nested <svg ...>
 * opens (not self-closing) and closes are counted. null when it never closes.
 */
function balancedClose(markup: string, from: number): { innerEnd: number; closeEnd: number } | null {
  const TAG = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>|<\/svg\s*>/gi;
  TAG.lastIndex = from;
  let depth = 1;
  let t: RegExpExecArray | null;
  while ((t = TAG.exec(markup))) {
    if (t[0][1] === "/") depth--;
    else if (!t[1]) depth++;
    if (depth === 0) return { innerEnd: t.index, closeEnd: t.index + t[0].length };
  }
  return null;
}

/** Replace every <svg> element inside `markup` with an equivalent <g>, recursively. */
export function flattenNestedSvgs(markup: string): string {
  const OPEN = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi;
  let out = "";
  let pos = 0;
  for (;;) {
    OPEN.lastIndex = pos;
    const m = OPEN.exec(markup);
    if (!m) break;
    out += markup.slice(pos, m.index);
    const attrs = parseAttrs(m[1]);
    let inner = "";
    let end = m.index + m[0].length;
    if (!m[2]) {
      const c = balancedClose(markup, end);
      if (!c) throw new TypeError("a nested <svg> is not closed");
      inner = markup.slice(end, c.innerEnd);
      end = c.closeEnd;
    }
    const vb = parseViewBox(getAttr(attrs, "viewBox"));
    const p: ParsedSvg = {
      attrs,
      inner,
      viewBox: vb,
      w: lengthPx(getAttr(attrs, "width")) ?? (vb ? vb[2] : 0),
      h: lengthPx(getAttr(attrs, "height")) ?? (vb ? vb[3] : 0),
    };
    // A nested svg with no usable size and a viewBox cannot be mapped; draw unscaled.
    if (!(p.w > 0 && p.h > 0)) p.viewBox = null;
    out += svgAsGroup(p, Number(getAttr(attrs, "x") ?? 0) || 0, Number(getAttr(attrs, "y") ?? 0) || 0, 1);
    pos = end;
  }
  return out + markup.slice(pos);
}

/**
 * Prefix every id DEFINED in `markup`, and every exact reference to one of them.
 * References to ids the markup does not define are left alone.
 */
export function namespaceIds(markup: string, prefix: string): string {
  const defined = new Set<string>();
  const ID = /(\sid\s*=\s*)(["'])([^"']+)\2/g;
  let m: RegExpExecArray | null;
  while ((m = ID.exec(markup))) defined.add(m[3]);
  if (!defined.size) return markup;
  return (
    markup
      .replace(ID, (all, pre: string, q: string, id: string) => `${pre}${q}${prefix}${id}${q}`)
      // url(#id), url('#id'), url("#id") — and the entity-quoted forms an
      // attribute value carries: url(&quot;#id&quot;), url(&#39;#id&#39;).
      .replace(/url\(\s*(&quot;|&#34;|&apos;|&#39;|["']?)#([^"')\s&]+)\1\s*\)/g, (all, q: string, id: string) =>
        defined.has(id) ? `url(${q}#${prefix}${id}${q})` : all,
      )
      .replace(/(\s(?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/g, (all, pre: string, q: string, id: string) =>
        defined.has(id) ? `${pre}${q}#${prefix}${id}${q}` : all,
      )
      // #id selectors in a <style> sheet. Only ids the markup defines: "#fff" is
      // a colour unless something is actually called "fff". Runs after the url()
      // pass, whose rewritten "#p0-id" is not itself a defined id.
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (all, open: string, body: string, close: string) =>
        open + body.replace(/#([A-Za-z_][\w-]*)/g, (sel, id: string) => (defined.has(id) ? `#${prefix}${id}` : sel)) + close,
      )
  );
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface ComposeOptions {
  /** Columns in the grid (default 1 without a preset, min(n, 2) with one). */
  cols?: number;
  /** Journal preset (object or id). Sets the printed width and the letter style. */
  preset?: FigureStylePreset | PresetId;
  /** Printed width: a preset column ("single" default) or millimetres. Needs a preset unless in mm. */
  width?: PresetWidth | { mm: number };
  /** Gap between panels in root px (default 8). */
  gap?: number;
  /** Draw panel letters (default: true with a preset, false without). Requires a preset. */
  letters?: boolean;
  /** USPTO "FIG. 1A" numbering. */
  figureNumber?: number;
  /** Prefix for per-panel id namespaces (default "p" → "p0-", "p1-"). */
  idPrefix?: string;
}

export interface PlacedPanel {
  index: number;
  x: number;
  y: number;
  /** Drawn size in root px. */
  w: number;
  h: number;
  /** Panel units → root px. 1 means drawn at its own size. */
  scale: number;
  label: string | null;
}

export interface ComposedFigure {
  svg: string;
  width: number;
  height: number;
  panels: PlacedPanel[];
  /** Root px available to each panel; render panels at this width to avoid scaling their text. */
  cellWidth: number;
  /** Printed size, when a preset/width fixed one. */
  widthMm: number | null;
  heightMm: number | null;
  /** The composed figure is taller than the preset allows. */
  exceedsMaxHeight: boolean;
}

const MAX_PANELS = 52;

/**
 * Lay `panels` (complete SVG documents) out on a grid as ONE flat SVG.
 *
 * With a preset: the root is the preset's printed width in CSS px (so the figure
 * inserts at exactly that physical width), each panel is scaled to its cell width,
 * and a bold/lower-or-upper letter in the preset's size sits top-left of each cell.
 * Without one: panels keep their own size and are centred in their column.
 */
export function composePanels(panels: string[], opts: ComposeOptions = {}): ComposedFigure {
  if (!Array.isArray(panels)) throw new TypeError("panels must be an array of SVG strings");
  const list = panels.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  if (list.length === 0) throw new RangeError("no panels to compose");
  if (list.length > MAX_PANELS) throw new RangeError(`at most ${MAX_PANELS} panels, got ${list.length}`);

  const preset = typeof opts.preset === "string" ? getPreset(opts.preset) : opts.preset ?? null;
  if (typeof opts.preset === "string" && !preset) throw new RangeError(`unknown figure preset "${opts.preset}"`);
  const letters = opts.letters ?? !!preset;
  if (letters && !preset) throw new RangeError("panel letters need a preset (it sets their case, weight and size)");

  const gap = opts.gap ?? 8;
  if (!(Number.isFinite(gap) && gap >= 0 && gap <= 1000)) throw new RangeError(`gap must be 0-1000 px, got ${gap}`);
  const cols = opts.cols ?? (preset ? Math.min(list.length, 2) : 1);
  if (!(Number.isInteger(cols) && cols >= 1 && cols <= list.length)) {
    throw new RangeError(`cols must be a whole number from 1 to the panel count (${list.length}), got ${cols}`);
  }

  let widthMm: number | null = null;
  if (opts.width && typeof opts.width === "object") {
    if (!(Number.isFinite(opts.width.mm) && opts.width.mm > 0 && opts.width.mm <= 2000)) throw new RangeError(`width must be a positive number of mm, got ${opts.width.mm}`);
    widthMm = opts.width.mm;
  } else if (preset) {
    widthMm = presetWidthMm(preset, opts.width ?? "single");
    if (widthMm === null) throw new RangeError(`${preset.name} has no ${opts.width} width`);
  } else if (opts.width) {
    throw new RangeError("a named column width needs a preset");
  }

  const parsed = list.map((s) => parseSvgRoot(s));
  const rows = Math.ceil(parsed.length / cols);
  const letterPx = preset && letters ? fontPx(preset, "panelLetter") : 0;
  // Band above each panel for its letter: ascent of the letter plus a small gap.
  const band = letterPx ? Math.ceil(letterPx * 1.15) : 0;

  let W: number;
  let colW: number[];
  if (widthMm !== null) {
    W = mmToPx(widthMm);
    const cw = (W - gap * (cols - 1)) / cols;
    if (!(cw > 0)) throw new RangeError("the gaps leave no room for the panels at this width");
    colW = new Array(cols).fill(cw);
  } else {
    colW = new Array(cols).fill(0);
    parsed.forEach((p, k) => (colW[k % cols] = Math.max(colW[k % cols], p.w)));
    W = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  }
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, b) => a + b, 0) + gap * c);

  const placed: PlacedPanel[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    let rowH = 0;
    const inRow: PlacedPanel[] = [];
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (k >= parsed.length) break;
      const p = parsed[k];
      const scale = widthMm !== null ? colW[c] / p.w : 1;
      const w = p.w * scale;
      const h = p.h * scale;
      const x = widthMm !== null ? colX[c] : colX[c] + (colW[c] - w) / 2;
      const pl: PlacedPanel = { index: k, x, y: y + band, w, h, scale, label: null };
      if (letters && preset) pl.label = panelLabel(preset, k, opts.figureNumber ?? 1);
      inRow.push(pl);
      rowH = Math.max(rowH, band + h);
    }
    placed.push(...inRow);
    y += rowH + (r < rows - 1 ? gap : 0);
  }
  const H = y;

  const body: string[] = [];
  const clips: string[] = [];
  const pfx = opts.idPrefix ?? "p";
  if (!/^[A-Za-z_][\w-]*$/.test(pfx)) throw new RangeError(`idPrefix must be an XML name, got "${pfx}"`);
  placed.forEach((pl) => {
    const p = parsed[pl.index];
    if (letters && preset) {
      // Baseline at 0.9 em into the band: the letter's ascent fits, its top-left is the cell's.
      body.push(panelLetterSvg(preset, pl.index, +pl.x.toFixed(3), +(pl.y - band + letterPx * 0.9).toFixed(3), opts.figureNumber ?? 1));
    }
    const ns: ParsedSvg = { ...p, inner: namespaceIds(p.inner, `${pfx}${pl.index}-`) };
    // The panel's cell, in ROOT units. "<pfx>clip<k>" cannot collide with a
    // child's namespaced id, which is always "<pfx><digits>-…".
    const clipId = `${pfx}clip${pl.index}`;
    clips.push(`<clipPath id="${clipId}"><rect x="${num(pl.x)}" y="${num(pl.y)}" width="${num(pl.w)}" height="${num(pl.h)}"/></clipPath>`);
    body.push(`<g clip-path="url(#${clipId})">${svgAsGroup(ns, pl.x, pl.y, pl.scale)}</g>`);
  });

  const content = body.join("");
  const xlink = /\sxlink:/.test(content) ? ` xmlns:xlink="http://www.w3.org/1999/xlink"` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"${xlink} width="${num(W)}" height="${num(H)}" viewBox="0 0 ${num(W)} ${num(H)}">` +
    `<rect width="${num(W)}" height="${num(H)}" fill="#fff"/>` +
    `<defs>${clips.join("")}</defs>` +
    content +
    `</svg>`;

  const heightMm = widthMm !== null ? pxToMm(H) : null;
  return {
    svg,
    width: W,
    height: H,
    panels: placed,
    cellWidth: colW[0],
    widthMm,
    heightMm,
    exceedsMaxHeight: !!(preset && preset.maxHeightMm !== null && heightMm !== null && heightMm > preset.maxHeightMm + 1e-9),
  };
}
