// How a figure goes into Word: vector SVG or a PNG with a STATED resolution.
//
// THE DECISION IS PURE AND LIVES HERE because taskpane.ts imports Office and no
// test can reach it (the "taskpane parsers are untestable" lesson). The pane
// gathers three facts about the host and hands them over; this file says what to
// do with them and how to describe what was done.
//
// WHAT WORD DOCUMENTS (Microsoft Learn, fetched 2026-10-14; brief §A.3):
//   - Office.context.document.setSelectedDataAsync(svg, {coercionType: XmlSvg})
//     needs the ImageCoercion 1.2 requirement set, listed for Word on Windows
//     and Word on Mac only — NOT Word on the web, NOT Word on iPad. It is the
//     only documented vector route. It REPLACES the selection and returns no
//     picture handle, so the pane must find the new picture again and size it.
//   - Range.insertInlinePictureFromBase64 (WordApi 1.2) names no accepted
//     formats. Whether it takes an SVG is UNVERIFIED and is not relied on here;
//     it is an in-Word probe in docs/TEST-SCRIPT.md §0cj.
//
// AN UNKNOWN CAPABILITY IS RASTER. The pane's older wordApiSupported() helper
// answers "yes" when the check throws, which is right for gating an OOXML insert
// that degrades on its own and wrong here: a status line that says "vector" for
// a picture that is not would be a false claim the user cannot see through.

import {
  getPreset,
  presetWidthMm,
  renderAtPreset,
  checkSvgAgainstPreset,
  physicalSize,
  mmToPt,
  pxToMm,
  figureTitles,
  stripFigureTitles,
  type FigureStylePreset,
  type PresetWidth,
} from "./figureStyle";
import { composePanels } from "./panels";
import { figurePoints } from "./figures";
import { CATEGORICAL_PALETTE, worstPair } from "./categoricalPalette";
import { introducedLayoutFindings, findingSentence } from "./figureLayoutAudit";
import { beginFigureFit } from "./figContext";

/** What the pane could find out about the host. null = the check threw or was unavailable. */
export interface HostCapability {
  /** Office.context.platform: "PC", "Mac", "OfficeOnline", "iOS", "Android", "Universal"… */
  platform: string | null;
  /** Office.context.requirements.isSetSupported("ImageCoercion", "1.2"). */
  imageCoercion12: boolean | null;
  /** typeof Office.context.document.setSelectedDataAsync === "function". */
  hasSetSelectedData: boolean;
  /**
   * The user ticked "Insert as vector". OFF BY DEFAULT until the in-Word probe
   * (docs/TEST-SCRIPT.md §0cj) is recorded on Windows and Mac: setSelectedDataAsync
   * with XmlSvg is half-documented (no picture handle comes back; whether it lands
   * inline or floating, and whether imageWidth is px or pt, are unmeasured), and a
   * route that cannot be re-found and sized is worse than PNG (brief §E1). With it
   * off, every figure inserts as PNG exactly as before presets existed.
   */
  vectorRequested: boolean;
}

export type InsertRoute = { route: "svg"; reason: string } | { route: "png"; reason: string };

/** The desktop hosts the ImageCoercion 1.2 documentation lists for Word. */
const VECTOR_PLATFORMS = new Set(["PC", "Mac"]);

/**
 * Vector SVG only when ALL three hold: a desktop Word (Windows or Mac), the
 * ImageCoercion 1.2 set reported present (not merely "did not throw"), and the
 * insert function actually there. Anything else is PNG, with the reason.
 */
export function decideInsertRoute(cap: HostCapability): InsertRoute {
  // Not asked for: PNG, and the status line says nothing about vector at all.
  if (cap.vectorRequested !== true) return { route: "png", reason: "" };
  const p = cap.platform;
  if (p === "OfficeOnline") return { route: "png", reason: "Word on the web cannot insert vector pictures (ImageCoercion 1.2 is not available there)" };
  if (p === "iOS" || p === "Android") return { route: "png", reason: "Word on a tablet or phone cannot insert vector pictures (ImageCoercion 1.2 is not available there)" };
  if (p === null || !VECTOR_PLATFORMS.has(p)) return { route: "png", reason: "this Word host's vector support could not be confirmed" };
  if (cap.imageCoercion12 !== true) {
    return {
      route: "png",
      reason: cap.imageCoercion12 === false ? "this Word build does not support vector pictures (ImageCoercion 1.2)" : "this Word host's vector support could not be confirmed",
    };
  }
  if (!cap.hasSetSelectedData) return { route: "png", reason: "this Word host has no vector insert function" };
  return { route: "svg", reason: `Word for ${p === "PC" ? "Windows" : "Mac"} supports vector pictures (ImageCoercion 1.2)` };
}

// ---------------------------------------------------------------------------
// Finding the picture setSelectedDataAsync inserted
// ---------------------------------------------------------------------------

/** What the pane can read of each inline picture in the document body, in order. */
export interface PictureSignature {
  width: number;
  height: number;
  alt: string;
}

export type Refind = { ok: true; index: number } | { ok: false; inserted: number; reason: string };

const sameSig = (a: PictureSignature, b: PictureSignature): boolean =>
  Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01 && a.alt === b.alt;

/**
 * Which picture is new. The body's pictures are listed before and after the
 * insert; exactly ONE more must appear, and removing it from `after` must give
 * back `before`. Zero new pictures means nothing landed inline. More than one,
 * or a list that changed elsewhere, is refused.
 *
 * THE POSITION MUST BE UNIQUE, not merely consistent. When the new picture reads
 * the same as a neighbour (same width, height and alt — two fresh inserts with
 * empty alt text, say), removing EITHER of them gives back `before`, and the
 * first mismatch is not the new picture: the old loop returned the last index,
 * which was the neighbour, and would have resized the user's existing figure.
 * The candidates are counted (matching prefix and suffix) and anything other
 * than exactly one refuses — sizing a guess is the defect this step prevents.
 */
export function findInsertedPicture(before: PictureSignature[], after: PictureSignature[]): Refind {
  const d = after.length - before.length;
  if (d === 0) return { ok: false, inserted: 0, reason: "Word reported success but no new inline picture is in the document" };
  if (d < 0) return { ok: false, inserted: 0, reason: "the document has fewer pictures than before the insert" };
  if (d > 1) return { ok: false, inserted: d, reason: `${d} pictures appeared instead of one, so the figure cannot be identified to size it` };
  const n = after.length;
  // Longest prefix of `before` that `after` repeats, and longest suffix.
  let pre = 0;
  while (pre < before.length && sameSig(before[pre], after[pre])) pre++;
  let suf = 0;
  while (suf < before.length && sameSig(before[before.length - 1 - suf], after[n - 1 - suf])) suf++;
  // Position i is a valid "new picture" iff after[0..i) = before[0..i) and
  // after(i..n) = before[i..): i <= pre and n - 1 - i <= suf.
  const lo = Math.max(0, n - 1 - suf);
  const hi = Math.min(pre, n - 1);
  if (lo > hi) return { ok: false, inserted: 1, reason: "other pictures changed during the insert, so the new one cannot be identified" };
  if (lo !== hi) {
    return {
      ok: false,
      inserted: 1,
      reason: "the new picture looks the same as the one beside it (same size and alt text), so it cannot be told apart to size it",
    };
  }
  return { ok: true, index: lo };
}

/**
 * The pixel size of a PNG, read from its IHDR chunk in the base64 the pane
 * actually inserts. The dpi on the status line is computed from THIS, not from
 * the factor that was requested: the payload loop may have stepped it down, and
 * a canvas may have been clamped (brief §E9). null when it is not a PNG.
 */
export function pngPixelSize(base64: string): { width: number; height: number } | null {
  if (typeof base64 !== "string" || base64.length < 32) return null;
  // Bytes 0-23: 8 signature + 4 length + 4 "IHDR" + 4 width + 4 height = 24 bytes = 32 base64 chars.
  // Decoded by hand: 32 chars, no padding, and no dependence on atob/Buffer.
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 4) {
    const q = [0, 1, 2, 3].map((k) => ALPHA.indexOf(base64[i + k]));
    if (q.some((v) => v < 0)) return null;
    const v = (q[0] << 18) | (q[1] << 12) | (q[2] << 6) | q[3];
    bytes.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  }
  const bin = String.fromCharCode(...bytes);
  const b = (i: number): number => bytes[i];
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bin.length < 24 || sig.some((v, i) => b(i) !== v)) return null;
  if (bin.slice(12, 16) !== "IHDR") return null;
  const u32 = (i: number): number => ((b(i) << 24) >>> 0) + (b(i + 1) << 16) + (b(i + 2) << 8) + b(i + 3);
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The raster to render for a prepared figure: its PHYSICAL size in CSS px
 * (points / 0.75) times the site's own supersampling. As drawn that is the SVG's
 * own size, exactly what every site rendered before presets; under a preset it is
 * the preset's printed width, so the stated dpi is a dpi on the page.
 * `supersample` keeps the per-site factor some sites used (Stats and Finance
 * rendered at 2× their natural size before figureScale applied).
 */
export function rasterTarget(
  p: { widthPt: number; heightPt: number; pxW: number; pxH: number; presetNote: string },
  supersample = 1,
): { w: number; h: number } {
  const k = Number.isFinite(supersample) && supersample >= 1 && supersample <= 4 ? supersample : 1;
  // As drawn: the SVG's own px, untouched by a pt round trip (byte-identical PNG).
  if (p.presetNote === "") return { w: p.pxW * k, h: p.pxH * k };
  return { w: (p.widthPt / 0.75) * k, h: (p.heightPt / 0.75) * k };
}

// ---------------------------------------------------------------------------
// Resolution and the status line
// ---------------------------------------------------------------------------

/**
 * The resolution a PNG ACTUALLY has on the page: its pixel width over the width
 * it is inserted at. Measured from what was rendered, never from the factor that
 * was asked for — the payload cap can step the factor down (brief §E9).
 */
export function rasterDpi(pixelWidth: number, insertedWidthPt: number): number | null {
  if (!(pixelWidth > 0) || !(insertedWidthPt > 0) || !Number.isFinite(pixelWidth) || !Number.isFinite(insertedWidthPt)) return null;
  return Math.round(pixelWidth / (insertedWidthPt / 72));
}

/** "vector SVG" or "PNG at 384 dpi" — what the status line says was inserted. */
export function insertedDescription(route: "svg" | "png", dpi: number | null): string {
  if (route === "svg") return "vector SVG";
  return dpi === null ? "PNG" : `PNG at ${dpi} dpi`;
}

// ---------------------------------------------------------------------------
// Presets: what to insert, and at what size
// ---------------------------------------------------------------------------

/** "asdrawn" keeps the behaviour every figure had before presets existed. */
export type FigurePresetChoice = "asdrawn" | "nature" | "elsevier" | "acs" | "cell" | "thesis" | "uspto";

export const FIGURE_PRESET_CHOICES: readonly FigurePresetChoice[] = ["asdrawn", "nature", "elsevier", "acs", "cell", "thesis", "uspto"];

export interface FigureRequest {
  svg: string;
  preset: FigurePresetChoice;
  width: PresetWidth;
  /**
   * Re-render the SAME figure on a canvas `w` units wide. Without one, a preset
   * can only scale the figure as drawn and check it.
   */
  render?: (w: number, style?: FigureStylePreset, widthMm?: number) => string;
  /** Table→Chart kind, for the preset's refusal list (USPTO refuses heatmap, candlestick). */
  chartKind?: string;
}

export type PreparedFigure =
  | {
      ok: true;
      svg: string;
      /** Size to insert at, in points. */
      widthPt: number;
      heightPt: number;
      /** The SVG's own width/height in px (what a raster is rendered from). */
      pxW: number;
      pxH: number;
      /** "" for as-drawn; else e.g. "Nature, 89 mm, text 5.0–7.0 pt". */
      presetNote: string;
    }
  | { ok: false; reason: string; problems: string[] };

/** The root <svg>'s own width/height, as the pane's readSvgDims reads them. */
export function svgRootSize(svg: string, fallbackW: number, fallbackH: number): { w: number; h: number } {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const wm = /\swidth="([\d.]+)/.exec(open);
  const hm = /\sheight="([\d.]+)/.exec(open);
  const w = wm ? parseFloat(wm[1]) : NaN;
  const h = hm ? parseFloat(hm[1]) : NaN;
  return { w: w > 0 ? w : fallbackW, h: h > 0 ? h : fallbackH };
}

const CHART_KIND_NAMES: Record<string, string> = { heatmap: "a heat map", candlestick: "a candlestick chart" };

const f1 = (n: number): string => n.toFixed(1);

/**
 * What to insert under the chosen preset. As drawn: the SVG unchanged, at its
 * natural size (0.75 pt per px), exactly as before presets existed. A preset:
 * re-rendered at the preset's printed width when the site can re-render
 * (renderAtPreset), else the figure as drawn scaled to that width — and in both
 * cases MEASURED (checkSvgAgainstPreset). Any violation refuses the insert and
 * names itself: a figure inserted under a journal's name must meet that
 * journal's rules, or the preset is a label, not a guarantee.
 */
export function prepareFigure(req: FigureRequest, fallbackW = 380, fallbackH = 260): PreparedFigure {
  if (req.preset === "asdrawn") {
    const d = svgRootSize(req.svg, fallbackW, fallbackH);
    return { ok: true, svg: req.svg, widthPt: figurePoints(d.w), heightPt: figurePoints(d.h), pxW: d.w, pxH: d.h, presetNote: "" };
  }
  const preset = getPreset(req.preset);
  if (!preset) return { ok: false, reason: `unknown figure style "${req.preset}"`, problems: [] };
  // The chart kind from the caller (Table→Chart), else from the figure's own root (a builder that marks itself with
  // data-chart-kind, such as the DCF sensitivity heat map): one channel for the pane and the gate test alike.
  const chartKind = req.chartKind ?? /^\s*<svg\b[^>]*\sdata-chart-kind="([\w-]+)"/.exec(req.svg)?.[1];
  if (chartKind && preset.refusedChartKinds.includes(chartKind)) {
    const what = CHART_KIND_NAMES[chartKind] ?? `a ${chartKind} chart`;
    return {
      ok: false,
      reason:
        `${preset.name} cannot draw ${what}: it needs shading or colour to carry the values, and 37 CFR 1.84(a)(1) ` +
        `requires black-and-white line art. Choose a column, bar or line chart, or another figure style.`,
      problems: [],
    };
  }
  const widthMm = presetWidthMm(preset, req.width);
  if (widthMm === null) {
    return { ok: false, reason: `${preset.name} has no ${req.width === "oneAndHalf" ? "1.5-column" : req.width} width; choose single or double column`, problems: [] };
  }
  // No title in the artwork (USPTO): the marked title is removed from the figure
  // and from every re-render BEFORE fitting, so the figure is fitted as inserted.
  const noTitle = !preset.allowTitle;
  const hadTitle = noTitle && figureTitles(req.svg).length > 0;
  let svg = noTitle ? stripFigureTitles(req.svg) : req.svg;
  // The style is passed on (Release D): a builder that can draw in black and white (the plot kinds) does so for USPTO.
  const render =
    req.render && noTitle
      ? (w: number, st?: FigureStylePreset, mm?: number): string => stripFigureTitles((req.render as (w: number, st?: FigureStylePreset, mm?: number) => string)(w, st, mm))
      : req.render;
  let problems: string[];
  let ok: boolean;
  if (render) {
    // A re-render can refuse (significance brackets that no longer fit throw):
    // a named refusal, like every other rule this function enforces.
    let r: ReturnType<typeof renderAtPreset>;
    // One fit, one render budget (figContext.figureRenderer): reset on the caller's renderer, not the title wrapper.
    beginFigureFit(req.render);
    try {
      r = renderAtPreset(render, preset, widthMm);
    } catch (e) {
      return { ok: false, reason: `This figure could not be redrawn for ${preset.name} at ${widthMm} mm`, problems: [(e as Error).message] };
    }
    svg = r.svg;
    ok = r.ok;
    problems = r.reason ? [r.reason, ...r.check.problems] : r.check.problems;
  } else {
    const check = checkSvgAgainstPreset(svg, preset, widthMm);
    ok = check.ok;
    problems = check.problems.slice();
    if (!ok) problems.push("this figure cannot be redrawn at a new width, so it was checked as drawn, scaled to the column");
  }
  if (!ok) {
    return { ok: false, reason: `This figure does not meet ${preset.name} at ${widthMm} mm`, problems: problems.length ? problems : ["the check failed"] };
  }
  // LEGIBLE, NOT ONLY COMPLIANT (round 2): the redrawn figure is measured with the check:figures layout audit, and a
  // fit that ran labels into each other, off the canvas or under a line refuses by name. Only defects the style fit
  // INTRODUCED count: one the figure already has as drawn is the builder's own (recorded by the QC gate).
  const layout = layoutRefusal(req.svg, svg, { preset, width: req.width, widthMm });
  if (layout) return { ok: false, reason: `This figure does not meet ${preset.name} at ${widthMm} mm`, problems: layout };
  const size = physicalSize(svg, widthMm, preset);
  if (!size) return { ok: false, reason: "the figure's own size could not be read", problems: [] };
  if (size.exceedsMaxHeight) {
    return {
      ok: false,
      reason: `This figure does not meet ${preset.name} at ${widthMm} mm`,
      problems: [`it prints ${f1(size.heightMm)} mm tall, above the ${preset.maxHeightMm} mm maximum height`],
    };
  }
  const meas = checkSvgAgainstPreset(svg, preset, widthMm);
  const d = svgRootSize(svg, fallbackW, fallbackH);
  const textNote =
    meas.minPt === null
      ? ""
      : preset.minCharHeightMm !== null && meas.minCharHeightMm !== null
        ? `, characters at least ${meas.minCharHeightMm.toFixed(2)} mm high`
        : `, text ${f1(meas.minPt)}–${f1(meas.maxPt ?? meas.minPt)} pt`;
  return {
    ok: true,
    svg,
    widthPt: mmToPt(widthMm),
    heightPt: mmToPt(size.heightMm),
    pxW: d.w,
    pxH: d.h,
    presetNote: `${preset.name}, ${widthMm} mm${textNote}${hadTitle ? ", title left out (no title in the artwork)" : ""}`,
  };
}

/**
 * The layout defects a style fit introduced into `fitted` (relative to the figure as drawn), as the sentences a
 * refusal lists, or null when there are none. At most four are named; the rest are counted.
 */
export function layoutRefusal(asDrawn: string, fitted: string, at?: { preset: FigureStylePreset; width: PresetWidth; widthMm: number } | { panels: true }): string[] | null {
  const found = introducedLayoutFindings(asDrawn, fitted);
  if (!found.length) return null;
  // One sentence per distinct defect (a row of tick labels running together is one finding per neighbouring pair).
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const f of found) {
    const s = findingSentence(f);
    if (!seen.has(s)) {
      seen.add(s);
      sentences.push(s);
    }
  }
  const named = sentences.slice(0, 4);
  const more = sentences.length - named.length;
  // The remedy names only what can work: a wider column only when this style HAS a wider one than the one asked for
  // (USPTO single and double are both the 170 mm sight); in the panel tray, fewer panels to a row.
  let remedy = "choose another figure style, or As drawn";
  if (at && "panels" in at) remedy = "use fewer columns in the panel tray, another figure style, or As drawn";
  else if (at && at.width !== "double") {
    const dbl = presetWidthMm(at.preset, "double");
    if (dbl !== null && dbl > at.widthMm + 0.5) remedy = "choose the double-column width, another figure style, or As drawn";
  }
  return [`redrawn at this width it would not be legible: ${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}`, remedy];
}

/**
 * The sentence under the figure-style picker: what the chosen style will do, its
 * width, its source caveat, and — for the colour styles — the palette's measured
 * colour-blind separation (worstPair recomputes it; nothing is quoted from memory).
 */
export function figureStyleNote(choice: FigurePresetChoice, width: PresetWidth): string {
  if (choice === "asdrawn") return "Figures insert as drawn, at their natural size — the behaviour before figure styles existed.";
  const p = getPreset(choice);
  if (!p) return "";
  const mm = presetWidthMm(p, width);
  const size = mm === null ? `${p.name} has no ${width === "oneAndHalf" ? "1.5-column" : width} width; choose single or double column.` : `Inserted ${mm} mm wide.`;
  let colour: string;
  if (p.color === "bw") {
    colour = "Black and white only; heat maps and candlestick charts are refused.";
  } else {
    const w = worstPair(CATEGORICAL_PALETTE, ["protan", "deutan"], "adjacent");
    colour =
      `Table→Chart series use the Okabe–Ito colour-blind-safe palette with a marker and dash per series` +
      (w ? ` (closest neighbouring colours under red-green colour-blindness simulation: ΔE ${w.deltaE.toFixed(1)}).` : ".");
  }
  return `${p.description} ${size} ${colour} A figure that misses a rule is not inserted; the rule it misses is named.`;
}

/** One line for the status bar: the reason, then each violation by name. */
export function refusalText(p: { reason: string; problems: string[] }): string {
  return p.problems.length ? `${p.reason}: ${p.problems.join("; ")}.` : `${p.reason}.`;
}

// ---------------------------------------------------------------------------
// Multi-panel figures from the pane's panel tray
// ---------------------------------------------------------------------------

/** One figure the user added to the panel tray. */
export interface PanelItem {
  svg: string;
  /** Re-render at a canvas width (lets each panel meet the preset at its cell width), in that style. */
  render?: (w: number, style?: FigureStylePreset, widthMm?: number) => string;
  /** Caption text that travels with the panel (e.g. a bracket legend). */
  caption?: string;
  /** Where it came from, for messages ("Statistics", "Plot"). */
  source: string;
}

export type PanelFigure =
  | { ok: true; svg: string; caption: string; labels: string[] }
  | { ok: false; reason: string; problems: string[] };

/**
 * The tray's figures as ONE flat multi-panel SVG (panels.composePanels).
 *
 * Under a preset each panel is re-rendered so that it meets the preset AT ITS
 * CELL WIDTH (renderAtPreset at the cell's millimetres): scaling a whole-column
 * figure into half a column would halve its text, which is B.5 again. A panel
 * that cannot be re-rendered is checked as drawn at its cell width, and any
 * violation refuses the whole figure with the panel named. The composed figure
 * is then measured once more as a whole (panel letters exempt as letters).
 *
 * As drawn: the panels keep their own sizes, stacked on the grid, with NO
 * letters — letter case, weight and size belong to a style, and inventing one
 * would be a style the user did not choose. The caption says so.
 */
export function composePanelFigure(items: PanelItem[], choice: FigurePresetChoice, width: PresetWidth, cols: number): PanelFigure {
  if (!Array.isArray(items) || items.length < 2) {
    return { ok: false, reason: "A multi-panel figure needs at least two figures in the tray", problems: [] };
  }
  const n = items.length;
  const c = Math.max(1, Math.min(n, Math.round(cols) || 1));
  const captionFor = (labels: (string | null)[]): string =>
    items
      .map((it, i) => (it.caption ? `${labels[i] ?? `Panel ${i + 1}`}: ${it.caption}` : ""))
      .filter(Boolean)
      .join(" ");
  try {
    if (choice === "asdrawn") {
      const comp = composePanels(
        items.map((it) => it.svg),
        { cols: c },
      );
      const labels = items.map((_, i) => `Panel ${i + 1}`);
      return { ok: true, svg: comp.svg, caption: captionFor(labels), labels };
    }
    const preset = getPreset(choice);
    if (!preset) return { ok: false, reason: `unknown figure style "${choice}"`, problems: [] };
    const widthMm = presetWidthMm(preset, width);
    if (widthMm === null) {
      return { ok: false, reason: `${preset.name} has no ${width === "oneAndHalf" ? "1.5-column" : width} width; choose single or double column`, problems: [] };
    }
    // Each panel's re-render is one fit with its own budget (figContext.figureRenderer), reset on the panel's own
    // renderer before any title wrapper hides it.
    for (const it of items) beginFigureFit(it.render);
    // No title in the artwork (USPTO): a panel captured under As drawn carries its
    // title in both its SVG and its re-render; both lose it here, as in prepareFigure.
    if (!preset.allowTitle) {
      items = items.map((it) => {
        const r = it.render;
        return { ...it, svg: stripFigureTitles(it.svg), render: r ? (w: number, st?: FigureStylePreset, mm?: number): string => stripFigureTitles(r(w, st, mm)) : undefined };
      });
    }
    // A first layout gives the cell width; the panels are then drawn for it.
    const dry = composePanels(
      items.map((it) => it.svg),
      { cols: c, preset, width },
    );
    const cellMm = pxToMm(dry.cellWidth);
    const problems: string[] = [];
    const drawn = items.map((it, i) => {
      const name = `panel ${dry.panels[i]?.label ?? i + 1} (${it.source})`;
      if (it.render) {
        // A re-render can refuse (brackets that no longer fit a smaller cell
        // throw): that is this panel's problem, named, not a crash of the tray.
        let r: ReturnType<typeof renderAtPreset>;
        try {
          r = renderAtPreset(it.render, preset, cellMm);
        } catch (e) {
          problems.push(`${name} cannot be redrawn at ${cellMm.toFixed(1)} mm: ${(e as Error).message}`);
          return it.svg;
        }
        if (!r.ok) problems.push(`${name}: ${[r.reason, ...r.check.problems].filter(Boolean).join("; ")}`);
        else {
          const layout = layoutRefusal(it.svg, r.svg, { panels: true });
          if (layout) problems.push(`${name}: ${layout.join("; ")}`);
        }
        return r.svg;
      }
      const chk = checkSvgAgainstPreset(it.svg, preset, cellMm);
      if (!chk.ok) problems.push(`${name} cannot be redrawn at ${cellMm.toFixed(1)} mm and, as drawn, ${chk.problems.join("; ")}`);
      return it.svg;
    });
    if (problems.length) return { ok: false, reason: `These panels do not meet ${preset.name} at ${cellMm.toFixed(1)} mm per panel`, problems };
    const comp = composePanels(drawn, { cols: c, preset, width });
    if (comp.exceedsMaxHeight) {
      return {
        ok: false,
        reason: `This multi-panel figure does not meet ${preset.name} at ${widthMm} mm`,
        problems: [`it prints ${f1(comp.heightMm ?? 0)} mm tall, above the ${preset.maxHeightMm} mm maximum height; use more columns or fewer panels`],
      };
    }
    const whole = checkSvgAgainstPreset(comp.svg, preset, widthMm);
    if (!whole.ok) return { ok: false, reason: `This multi-panel figure does not meet ${preset.name} at ${widthMm} mm`, problems: whole.problems };
    const labels = comp.panels.map((p, i) => p.label ?? `Panel ${i + 1}`);
    return { ok: true, svg: comp.svg, caption: captionFor(labels), labels };
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) return { ok: false, reason: `The panels could not be composed: ${e.message}`, problems: [] };
    throw e;
  }
}
