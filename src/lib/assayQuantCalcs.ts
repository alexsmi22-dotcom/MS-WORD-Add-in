// Pane glue for the Bio/Assay quantitation calculators — reading unknowns off
// a standard curve, a 96/384-well plate through a layout map, and qPCR
// relative quantification (Livak 2^−ΔΔCt, Pfaffl). Kept OUT of taskpane.ts so
// the exact objects the pane registers can be tested (nothing can import the
// pane under jest), the same pattern as chembioCalcs.ts.
//
// Each entry is shaped exactly like the pane's AssayCalc: `fields` render
// through renderCalcFields, and every table-shaped field is kind "block", so
// "Use table at cursor" hands the grid over VERBATIM (dataimport.gridToFieldText
// joins it with tabs). A `list` field would keep only the numeric cells and an
// "Undetermined" Ct or an empty well would vanish with every later value shifted.
//
// No number is computed here: assayQuant.ts owns them all. What this file adds
// is wording (the display contract: U+2212 minus, Ct, ΔΔCt, a space before %),
// and the figures — the standard curve with error bars and the unknowns on it,
// the plate heat map (heatmap.ts), and the fold-change bar chart.
//
// THE RESULT TEXT NEVER CONTAINS AN EM DASH, "NaN" OR "Infinity": the pane's
// insertableResultText() refuses to insert any text that does, so one such
// character would make the whole result uninsertable. Ranges use an en dash.

import {
  standardCurve,
  analysePlate,
  readCtTable,
  livak,
  pfaffl,
  readDilutionSeries,
  efficiencyFromDilution,
  qNum,
  commaReading,
  readNum,
  commaNotes,
  blockTokens,
  cleanName,
  REF_SHIFT_FLAG,
  type CurveModel,
  type StandardCurveOk,
  type StandardInput,
  type UnknownInput,
  type PlateRead,
  type LivakResult,
  type PfafflResult,
  type EfficiencyFit,
  type ReplicateStats,
} from "./assayQuant";
import { buildPlotSvg, combineSvgs, dropForScales, type Point, type Series, type PlotOptions } from "./plot";
import { buildHeatmapSvg } from "./heatmap";
import type { TableChart } from "./tablechart";
import { linearAxis } from "./axis";

/** The pane's AssayField, structurally (taskpane.ts does not export it). */
export interface QuantField {
  key: string;
  label: string;
  default: string;
  kind?: "number" | "list" | "select" | "text" | "line" | "block";
  options?: { value: string; label: string }[];
  optional?: boolean;
}
/** The pane's AssayOutput (the `svg` route: these are not plain curve fits). */
export interface QuantOutput {
  text: string;
  svg?: string;
  ok?: boolean;
  caveats?: string[];
}
export interface QuantCalc {
  id: string;
  name: string;
  fields: QuantField[];
  compute: (read: (k: string) => string) => QuantOutput;
}

// ------------------------------------------------------------- formatting

const MINUS = "−";
/** Ct-domain values: two decimals, U+2212. */
function ct2(x: number): string {
  const s = Math.abs(x) < 0.005 ? "0.00" : x.toFixed(2);
  return s.replace(/^-/, MINUS);
}
/** "mean ± SD" for a Ct, or "mean (n = 1)" when there is no SD. */
function ctMeanSD(s: ReplicateStats): string {
  return Number.isFinite(s.sd) ? `${ct2(s.mean)} ± ${ct2(s.sd)}` : `${ct2(s.mean)} (n = 1)`;
}
function signedCt(x: number, sd: number): string {
  return Number.isFinite(sd) ? `${ct2(x)} ± ${ct2(sd)}` : ct2(x);
}
/** Fold changes and ratios: 3 significant figures. */
const f3 = (x: number): string => qNum(x, 3);
/** 3 significant figures KEPT (1.00, 0.500), so a fold change and its range read at one precision. */
function f3k(x: number): string {
  const a = Math.abs(x);
  if (!Number.isFinite(x) || a < 1e-3) return qNum(x, 3);
  // 999.5 rounds UP to four digits and toPrecision then switches to "1.00e+3": refused, qNum instead.
  const s = x.toPrecision(3);
  return /e/i.test(s) ? qNum(x, 3) : s.replace(/^-/, MINUS);
}
/** "R² = 0.9998", and "R² > 0.9999" for a value that rounds to 1 but is not 1. */
function r2Text(r2: number, sig: number): string {
  const s = qNum(r2, sig);
  return s === "1" && r2 < 1 ? `R² > 0.${"9".repeat(sig)}` : `R² = ${s}`;
}
function unitSuffix(u: string): string {
  return u.trim() ? ` ${cleanName(u.trim())}` : "";
}
function repLine(s: ReplicateStats): string {
  if (s.n < 2) return `${qNum(s.mean)} (n = 1, no SD)`;
  const cv = Number.isFinite(s.cv) ? `CV ${qNum(s.cv, 2)} %` : "CV not defined (mean ≤ 0)";
  return `mean ${qNum(s.mean)}, SD ${qNum(s.sd, 2)}, ${cv} (n = ${s.n})`;
}

// --------------------------------------------------------- parsing blocks

function blockLines(text: string): { cells: string[]; line: number }[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tabbed = lines.some((l) => l.includes("\t"));
  const out: { cells: string[]; line: number }[] = [];
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    const cells = tabbed ? l.split("\t").map((c) => c.trim()) : l.trim().split(/[\s;]+/);
    out.push({ cells, line: i + 1 });
  });
  return out;
}
const BLANKISH = /^(|-|–|n\/?a|na|nan)$/i;

/**
 * The reading cells of a standards or unknowns block, as evidence for its
 * commas: every cell after the first of each line (the first is a
 * concentration or a sample name/ID, never a reading).
 */
export function readingCells(text: string): string[] {
  return blockLines(text).flatMap((r) => r.cells.slice(1));
}

/**
 * "conc  r1  r2  r3" per line; a non-numeric first line is a header. Commas
 * are read for the whole block (assayQuant.commaReading), with `context` (the
 * companion block of the same assay) as further evidence; a note goes to `notes`.
 */
export function parseStandards(text: string, notes?: string[], context: string[] = [], contextReadings: string[] = []): StandardInput[] | string {
  const rows = blockLines(text);
  const commas = commaReading([...rows.flatMap((r) => r.cells), ...context], "Standards", {
    integerReadings: [...readingCells(text), ...contextReadings],
    // The unknowns' every cell is a reading or a name (never a concentration).
    readingCells: [...readingCells(text), ...context],
  });
  if ("ok" in commas) return commas.error;
  if (notes) notes.push(...commaNotes("standards", commas));
  const num = (c: string): number => readNum(c, commas.mode);
  const out: StandardInput[] = [];
  for (const [k, r] of rows.entries()) {
    const conc = num(r.cells[0] ?? "");
    if (!Number.isFinite(conc)) {
      if (k === 0 && r.cells.every((c) => !Number.isFinite(num(c)))) continue;
      return `Standards, line ${r.line}: “${r.cells[0]}” is not a concentration. Each line is a concentration, then its replicate responses.`;
    }
    const responses: number[] = [];
    for (const c of r.cells.slice(1)) {
      if (BLANKISH.test(c)) continue;
      const v = num(c);
      if (!Number.isFinite(v)) return `Standards, line ${r.line}: “${c}” is not a response.`;
      responses.push(v);
    }
    if (!responses.length) return `Standards, line ${r.line}: concentration ${qNum(conc)} has no responses after it.`;
    out.push({ conc, responses });
  }
  if (!out.length) return "Enter the standards: one line per standard, its concentration then its replicate responses.";
  return out;
}

/** "name  r1  r2" per line (the name optional); a header line of words is skipped. */
export function parseUnknowns(text: string, notes?: string[], context: string[] = [], contextReadings: string[] = []): UnknownInput[] | string {
  // Typed text splits on spaces, so a name with a space is written with a
  // colon: "Sample 1: 0.41 0.40". (A table at the cursor arrives tab-joined.)
  if (!text.includes("\t") && /:/.test(text)) {
    text = text
      .split(/\r?\n/)
      .map((l) => {
        const i = l.indexOf(":");
        const vals = (i >= 0 ? l.slice(i + 1) : l).trim().split(/[\s;]+/).filter(Boolean);
        return i >= 0 ? [l.slice(0, i).trim(), ...vals].join("\t") : vals.join("\t");
      })
      .join("\n");
  }
  let rows = blockLines(text);
  const commas = commaReading([...rows.flatMap((r) => r.cells), ...context], "Unknowns", {
    integerReadings: [...readingCells(text), ...contextReadings],
    readingCells: [...rows.flatMap((r) => r.cells), ...contextReadings],
  });
  if ("ok" in commas) return commas.error;
  if (notes) notes.push(...commaNotes("unknowns", commas));
  const num = (c: string): number => readNum(c, commas.mode);
  const isNum = (c: string): boolean => Number.isFinite(num(c));
  // A header row: every cell a word ("Sample | Rep 1 | Rep 2").
  let header: string[] | null = null;
  if (rows.length && rows[0].cells.every((c) => c === "" || !isNum(c))) {
    header = rows[0].cells;
    rows = rows.slice(1);
  }
  // THE NAME COLUMN IS DECIDED FOR THE WHOLE BLOCK, never row by row: numeric
  // sample IDs (101, 102) under a "Sample" header, or beside other rows named
  // in words, are names — read row by row, 101 became a response and moved
  // the mean (the defect tableFeed.ts records as "numeric ids read as values").
  const NAME_HEAD = /^(sample|samples|name|id|sample id|sample name|unknown|unknowns|specimen|well|tube|subject|patient|animal|#|no\.?)$/i;
  const named = (header !== null && (NAME_HEAD.test((header[0] ?? "").trim()) || (header[0] ?? "").trim() === "")) || rows.some((r) => !isNum(r.cells[0] ?? ""));
  const out: UnknownInput[] = [];
  for (const r of rows) {
    let cells = r.cells;
    let name = `Unknown ${out.length + 1}`;
    if (named) {
      name = cleanName((cells[0] ?? "").trim()) || name;
      cells = cells.slice(1);
    }
    const responses: number[] = [];
    for (const c of cells) {
      if (BLANKISH.test(c)) continue;
      const v = num(c);
      if (!Number.isFinite(v)) return `Unknowns, line ${r.line} (${name}): “${c}” is not a response.`;
      responses.push(v);
    }
    out.push({ name, responses });
  }
  return out;
}

// ----------------------------------------------------- standard-curve text

function curveHeadline(r: StandardCurveOk, unit: string): string[] {
  const c = r.curve;
  const lines: string[] = [];
  if (c.model === "linear") {
    const sign = c.intercept < 0 ? MINUS : "+";
    lines.push(`Standard curve: straight line, response = ${qNum(c.slope)}·concentration ${sign} ${qNum(Math.abs(c.intercept))}`);
  } else {
    lines.push(
      `Standard curve: 4-parameter logistic, bottom = ${qNum(c.bottom)}, top = ${qNum(c.top)}, ` +
        `EC50 = ${qNum(c.ec50)}${unitSuffix(unit)}, Hill slope = ${qNum(c.hill, 3)}`,
    );
  }
  lines.push(
    `${r2Text(c.rsquared, 5)}, residual SD = ${qNum(c.s, 3)}, ${c.n} points at ${r.standards.length} standards (df = ${c.df})`,
  );
  return lines;
}

function curveReport(r: StandardCurveOk, unit: string, title?: string): string {
  const lines: string[] = title ? [title] : [];
  lines.push(...curveHeadline(r, unit));
  lines.push("Standards:");
  for (const s of r.standards) lines.push(`  ${qNum(s.conc)}${unitSuffix(unit)}: ${repLine(s.stats)}`);
  if (r.unknowns.length) {
    lines.push("Unknowns (concentration from the inverse of the fitted curve):");
    for (const u of r.unknowns) {
      if (u.status === "no-data") {
        lines.push(`  ${u.name}: no readings`);
        continue;
      }
      const head = `  ${u.name}: ${repLine(u.stats)} → `;
      if (u.status === "ok") {
        const ci = u.ci
          ? ` (95 % CI ${qNum(u.ci[0])} to ${qNum(u.ci[1])}${unitSuffix(unit)})`
          : u.ciMissing
            ? ` (${u.ciMissing})`
            : "";
        lines.push(`${head}${qNum(u.conc!)}${unitSuffix(unit)}${ci}`);
      } else {
        const msg = (u.message ?? "").replace(/\(([^)]*)\)/, (_, v: string) => `(${v}${u.status === "beyond-asymptote" ? "" : unitSuffix(unit)})`);
        lines.push(`${head}${msg}`);
      }
    }
  }
  return lines.join("\n");
}

/** The standard curve, the standards ± SD and the unknowns on the curve. */
export function standardCurveSvg(r: StandardCurveOk, unit: string, title: string, ylabel = "response"): string {
  const c = r.curve;
  const logX = c.model === "4pl";
  const positive = r.standards.map((s) => s.conc).filter((x) => x > 0);
  // The curve is drawn over every standard (a zero standard included on a linear axis).
  const lo = logX ? Math.min(...positive) : Math.min(...r.standards.map((s) => s.conc));
  const hi = r.range[1];
  const fit: Point[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const x = logX ? Math.pow(10, Math.log10(lo) + ((Math.log10(hi) - Math.log10(lo)) * i) / N) : lo + ((hi - lo) * i) / N;
    const y = c.predict(x);
    if (Number.isFinite(y)) fit.push({ x, y });
  }
  const stds: Point[] = r.standards.map((s) => {
    const p: Point = { x: s.conc, y: s.stats.mean };
    if (Number.isFinite(s.stats.sd) && s.stats.sd > 0) p.err = s.stats.sd;
    return p;
  });
  const unk: Point[] = r.unknowns.filter((u) => u.status === "ok").map((u) => ({ x: u.conc!, y: u.stats.mean }));
  const series: Series[] = [
    { points: stds, type: "scatter", label: "standards (mean ± SD)" },
    { points: fit, type: "line", label: "fitted curve" },
  ];
  if (unk.length) series.push({ points: unk, type: "scatter", label: "unknowns", color: "#d62728" });
  const notes: string[] = [];
  const off = r.unknowns.filter((u) => u.status === "below" || u.status === "above" || u.status === "beyond-asymptote");
  if (off.length) {
    notes.push(`Not plotted (outside the standards, not extrapolated): ${off.map((u) => u.name).join(", ")}.`);
  }
  const opts: PlotOptions = {
    title,
    xlabel: `concentration${unit.trim() ? ` (${unit.trim()})` : ""}${logX ? ", log scale" : ""}`,
    ylabel,
    errorBars: "sd",
    ...(logX ? { xScale: "log" as const } : {}),
  };
  const filtered = dropForScales(series, opts);
  if (filtered.dropped) {
    notes.push(
      `${filtered.dropped} zero-concentration point${filtered.dropped === 1 ? " is" : "s are"} not drawn: a log axis cannot show 0 (it is still in the fit).`,
    );
  }
  return buildPlotSvg(filtered.series, { ...opts, notes });
}

function curveCaveats(r: StandardCurveOk): string[] {
  const out = [r.intervalMethod, ...r.notes];
  const off = r.unknowns.filter((u) => u.status === "below" || u.status === "above");
  if (off.length) {
    out.push(
      `${off.length} unknown${off.length === 1 ? " lies" : "s lie"} outside the standards and ${off.length === 1 ? "is" : "are"} not given a concentration: ` +
        "a standard curve says nothing about the response beyond its last standard. Dilute (or concentrate) the sample and re-assay.",
    );
  }
  return out;
}

const MODEL_FIELD: QuantField = {
  key: "model",
  label: "Curve",
  default: "linear",
  kind: "select",
  options: [
    { value: "linear", label: "Straight line (least squares)" },
    { value: "4pl", label: "4-parameter logistic (ELISA)" },
  ],
};
const model = (v: string): CurveModel => (v === "4pl" ? "4pl" : "linear");

// ------------------------------------------------------------ plate figure

/** The plate's raw readings as a heat map (rows A…, columns 1…); empty wells blank. */
export function plateHeatmapSvg(p: PlateRead, title: string): { svg: string; notes: string[] } {
  const cols = Array.from({ length: p.cols }, (_, i) => i + 1);
  const chart: TableChart = {
    categories: p.rowLabels,
    series: cols.map((c) => ({ name: String(c), values: p.rowLabels.map((L) => p.wells.get(`${L}${c}`) ?? null) })),
    categoryLabel: "Row",
    hasHeader: true,
    rows: [],
    warnings: [],
  };
  // 384 wells at 760 px leave cells too narrow for printed values; the heat
  // map then says so in its own note rather than drawing them illegibly.
  const W = p.cols === 12 ? 620 : 760;
  const H = p.cols === 12 ? 320 : 460;
  const r = buildHeatmapSvg(chart, title, { scale: "sequential" }, W, H);
  // heatmap.ts words a missing value as "not numeric"; on a plate it is an empty well.
  const empty = [...p.wells.values()].filter((v) => v === null).length;
  const notes = r.notes.filter((n) => !/not numeric/.test(n));
  if (empty) notes.unshift(`${empty} empty well${empty === 1 ? " is" : "s are"} left blank on the plate map (not shaded, not counted as zero).`);
  return { svg: r.svg, notes };
}

// -------------------------------------------------------- fold-change bars

const PAPER = "#ffffff";
const INK = "#111111";
const RULE = "#888888";
const FAINT = "#cccccc";
const GREY = "#555555";
const BAR_COLOURS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b", "#17becf", "#bcbd22"];
const xmlEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** SVG text content → the characters drawn (tags dropped, entities decoded), for width estimates. */
const plainText = (svg: string): string =>
  svg.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot);/g, "x");
/** A user-supplied name in a title, kept short so a long gene or group name cannot push the title off the figure. */
const short = (s: string, n = 24): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export interface FoldBarSeries {
  label: string;
  values: number[];
  /** Asymmetric bar ends (NaN = no bar). */
  low?: number[];
  high?: number[];
}

/**
 * Grouped bars of fold change with ASYMMETRIC error bars — the Livak range
 * 2^−(ΔΔCt ± SD) is not symmetric about 2^−ΔΔCt, and no shared chart draws
 * that. A dashed line at 1 marks "no change". `titleSvg` / `footSvg` are SVG
 * text content (escaped by the caller) so 2^−ΔΔCt can carry a superscript.
 */
export function foldChangeBarSvg(categories: string[], series: FoldBarSeries[], titleSvg: string, ylabelSvg: string, footSvg: string[], log2 = false): string {
  const cats = categories.slice(0, 16).map((c) => (c.length > 18 ? c.slice(0, 17) + "…" : c));
  const ser = series.slice(0, 8).map((s) => ({ ...s, label: s.label.length > 24 ? s.label.slice(0, 23) + "…" : s.label }));
  if (categories.length > cats.length) footSvg = [...footSvg, xmlEsc(`${categories.length - cats.length} more groups not shown.`)];
  if (series.length > ser.length) footSvg = [...footSvg, xmlEsc(`${series.length - ser.length} more genes not shown.`)];
  // Said in the footnote, not on the line: a label at y = 1 sits behind the bars.
  footSvg = [
    log2 ? "Log₂ axis: bars rise above 1 for an increase and hang below it for a decrease; dashed line: no change (1)." : "Dashed line: no change (1).",
    ...footSvg,
  ];
  if (log2) ylabelSvg = `${ylabelSvg} (log₂ scale)`;
  // THE CANVAS GROWS TO FIT ITS TEXT (the figure-layout audit's advance, 0.58 em),
  // because Word sizes the picture from width/height and anything past it is cut off.
  const textW = (svgText: string, size: number): number => plainText(svgText).length * size * 0.58;
  const slot = Math.max(40, ser.length * 26, ...cats.map((c) => textW(xmlEsc(c), 10) + 8));
  const W = Math.ceil(Math.min(1400, Math.max(380, 68 + cats.length * slot, textW(titleSvg, 12) + 24, ...footSvg.map((f) => textW(f, 9) + 16))));
  const H0 = 280;
  const ML = 56;
  const MR = 12;
  const MT = 28;
  // Legend entries flow onto as many rows as the width needs.
  const legend: { x: number; row: number; s: (typeof ser)[number]; k: number }[] = [];
  if (ser.length > 1) {
    let lx = ML;
    let row = 0;
    ser.forEach((s, k) => {
      const w = 24 + textW(xmlEsc(s.label), 10);
      if (lx + w > W - MR && lx > ML) {
        row++;
        lx = ML;
      }
      legend.push({ x: lx, row, s, k });
      lx += w;
    });
  }
  const legendRows = legend.length ? legend[legend.length - 1].row + 1 : 0;
  const H = H0 + legendRows * 16;
  const MB = 40 + legendRows * 16;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  // THE SCALE. Linear: bars from 0. Log₂: bars from 1 (log₂ 1 = 0), up for an
  // increase and down for a decrease, so a 4-fold drop is as tall as a 4-fold
  // rise (on a linear axis it is a sliver between 0 and 1). `tr` maps a fold
  // value into axis units; ticks are labelled in fold values.
  const tr = (v: number): number => (log2 ? Math.log2(v) : v);
  const usable = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && (!log2 || v > 0);
  let yMin = 0;
  let yMax: number;
  let ticks: { v: number; label: string }[];
  if (log2) {
    let lo = 0;
    let hi = 0;
    for (const s of ser) {
      s.values.slice(0, cats.length).forEach((v, i) => {
        for (const e of [v, s.low?.[i], s.high?.[i]]) {
          if (usable(e)) {
            lo = Math.min(lo, tr(e));
            hi = Math.max(hi, tr(e));
          }
        }
      });
    }
    let a = Math.floor(lo);
    let b = Math.ceil(hi);
    if (a === b) b = a + 1;
    const step = Math.max(1, Math.ceil((b - a) / 8));
    a = Math.floor(a / step) * step;
    ticks = [];
    for (let k = a; ; k += step) {
      // Labels EXACT (a rounded "1020" under the 2¹⁰ tick would be a wrong number): integers up, 0.5…0.0625, then 1/2ⁿ.
      ticks.push({ v: k, label: k >= -4 ? String(Math.pow(2, k)) : `1/${Math.pow(2, -k)}` });
      if (k >= b) break;
    }
    yMin = a;
    yMax = ticks[ticks.length - 1].v;
  } else {
    let top = 1;
    for (const s of ser) {
      s.values.slice(0, cats.length).forEach((v, i) => {
        const h = s.high?.[i];
        if (Number.isFinite(v)) top = Math.max(top, v);
        if (h !== undefined && Number.isFinite(h)) top = Math.max(top, h);
      });
    }
    const ax = linearAxis(0, top * 1.08, { loose: true });
    yMax = ax.hi > 0 ? ax.hi : top * 1.1;
    ticks = ax.values.map((v, i) => ({ v, label: ax.labels[i] + (ax.multiplier && i === ax.values.length - 1 ? " " + ax.multiplier : "") }));
  }
  const y = (v: number): number => MT + ph - ((v - yMin) / (yMax - yMin)) * ph;
  const base = tr(log2 ? 1 : 0);
  const footH = footSvg.length * 12;
  const outH = H + footH;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}">`,
    `<rect width="${W}" height="${outH}" fill="${PAPER}"/>`,
    `<text data-figure-title="1" x="${W / 2}" y="18" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12" fill="${INK}">${titleSvg}</text>`,
  ];
  ticks.forEach((t) => {
    const yy = y(t.v).toFixed(1);
    parts.push(`<line x1="${ML}" y1="${yy}" x2="${ML + pw}" y2="${yy}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(`<text x="${ML - 6}" y="${(Number(yy) + 3.5).toFixed(1)}" text-anchor="end" font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${xmlEsc(t.label)}</text>`);
  });
  parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(`<line x1="${ML}" y1="${y(yMin).toFixed(1)}" x2="${ML + pw}" y2="${y(yMin).toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(
    `<text x="14" y="${MT + ph / 2}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="10" fill="${INK}" transform="rotate(-90 14 ${MT + ph / 2})">${ylabelSvg}</text>`,
  );
  const step = pw / Math.max(1, cats.length);
  const bw = Math.min(34, (step * 0.7) / Math.max(1, ser.length));
  cats.forEach((cat, i) => {
    const cx = ML + step * (i + 0.5);
    ser.forEach((s, k) => {
      const v = s.values[i];
      if (!usable(v)) return;
      const x = cx - (bw * ser.length) / 2 + k * bw;
      const col = BAR_COLOURS[k % BAR_COLOURS.length];
      const yv = y(tr(v));
      const y0 = y(base);
      parts.push(`<rect x="${x.toFixed(1)}" y="${Math.min(yv, y0).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0.5, Math.abs(y0 - yv)).toFixed(1)}" fill="${col}" fill-opacity="0.85"/>`);
      const lo = s.low?.[i];
      const hi = s.high?.[i];
      if (usable(lo) && usable(hi) && hi > lo) {
        const mx = (x + (bw - 2) / 2).toFixed(1);
        const cap = 4;
        parts.push(`<line x1="${mx}" y1="${y(tr(lo)).toFixed(1)}" x2="${mx}" y2="${y(tr(hi)).toFixed(1)}" stroke="${INK}" stroke-width="1.2"/>`);
        for (const e of [lo, hi]) {
          parts.push(`<line x1="${(Number(mx) - cap).toFixed(1)}" y1="${y(tr(e)).toFixed(1)}" x2="${(Number(mx) + cap).toFixed(1)}" y2="${y(tr(e)).toFixed(1)}" stroke="${INK}" stroke-width="1.2"/>`);
        }
      }
    });
    parts.push(`<text x="${cx.toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${xmlEsc(cat)}</text>`);
  });
  // "No change" at 1.
  if (tr(1) <= yMax && tr(1) >= yMin) {
    parts.push(`<line x1="${ML}" y1="${y(tr(1)).toFixed(1)}" x2="${ML + pw}" y2="${y(tr(1)).toFixed(1)}" stroke="${GREY}" stroke-width="1" stroke-dasharray="4 3"/>`);
  }
  for (const { x: lx, row, s, k } of legend) {
    const ly = MT + ph + 32 + row * 16;
    parts.push(`<rect x="${lx.toFixed(1)}" y="${ly - 8}" width="10" height="10" fill="${BAR_COLOURS[k % BAR_COLOURS.length]}"/>`);
    parts.push(`<text x="${(lx + 14).toFixed(1)}" y="${ly + 1}" font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${xmlEsc(s.label)}</text>`);
  }
  footSvg.forEach((f, i) => {
    parts.push(`<text x="8" y="${H + 8 + i * 12}" font-family="sans-serif" font-size="9" fill="${GREY}">${f}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}

/** "2^−ΔΔCt" with the exponent raised, as SVG text content. */
const SUP_DDCT = `2<tspan dy="-5" font-size="8">${MINUS}ΔΔCt</tspan>`;

// ----------------------------------------------------------------- qPCR

const LIVAK_ASSUMPTIONS =
  "The ΔΔCt method (fold change = 2 to the power −ΔΔCt) assumes both genes amplify with about 100 % efficiency (E ≈ 2, a doubling per cycle) and with EQUAL " +
  "efficiencies. Livak & Schmittgen (2001) check this by plotting ΔCt against log input over a dilution series: the " +
  "slope should be close to zero. If the efficiencies differ, use the Pfaffl ratio with measured efficiencies.";
const REPLICATE_NOTE =
  "The SD here comes from technical replicates (the same cDNA run in several wells): it measures pipetting and " +
  "instrument precision, not biological variation. Biological replicates need separate samples and a statistical test.";

function refShiftNotes(reference: string, shifts: { group: string; shift: number }[]): string[] {
  const out: string[] = [];
  for (const s of shifts) {
    if (Math.abs(s.shift) >= REF_SHIFT_FLAG) {
      out.push(
        `The reference gene ${reference} shifts by ${ct2(s.shift)} cycles in ${s.group} relative to the control ` +
          `(an apparent ${f3(Math.pow(2, Math.abs(s.shift)))}-fold change in its own level). Both methods assume the reference ` +
          "gene is unaffected by treatment; check it against a second reference gene. " +
          `(This tool flags shifts of ${REF_SHIFT_FLAG} cycles or more: a threshold of its own, not a published one.)`,
      );
    }
  }
  return out;
}

/** The fold-change axis choice: "auto" draws log₂ when any non-control bar is below 1 (a decrease). */
export type FoldAxis = "auto" | "linear" | "log2";
const AXIS_FIELD: QuantField = {
  key: "axis",
  label: "Bar chart axis",
  default: "auto",
  kind: "select",
  options: [
    { value: "auto", label: "Automatic (log₂ when any group is below 1)" },
    { value: "linear", label: "Linear" },
    { value: "log2", label: "Log₂ (increase and decrease drawn alike)" },
  ],
};
const foldAxis = (v: string): FoldAxis => (v === "linear" || v === "log2" ? v : "auto");
function useLog2(axis: FoldAxis, treated: number[]): boolean {
  return axis === "log2" || (axis === "auto" && treated.some((v) => Number.isFinite(v) && v < 1));
}

export function livakReport(r: LivakResult, mode: "both" | "propagate", axis: FoldAxis = "auto"): QuantOutput {
  const lines: string[] = ["qPCR relative quantification: Livak ΔΔCt method"];
  lines.push(
    `Reference gene ${r.reference}; calibrator ${r.control}; technical replicates averaged per gene before ΔCt (target and reference in separate wells).`,
  );
  lines.push("ΔCt = Ct(target) − Ct(reference), SD = √(SD target² + SD reference²); fold change = 2 to the power −ΔΔCt, range 2 to the power −(ΔΔCt ± SD).");
  for (const target of r.targets) {
    const rows = r.rows.filter((x) => x.target === target);
    if (!rows.length) continue;
    lines.push(`${target}:`);
    for (const x of rows) {
      const range =
        mode === "propagate" && x.isControl
          ? "1 (calibrator, defined without error)"
          : Number.isFinite(x.foldLow)
            ? `${f3k(x.fold)} (${f3k(x.foldLow)}–${f3k(x.foldHigh)})`
            : `${f3k(x.fold)} (no range: a single replicate)`;
      lines.push(
        `  ${x.group}${x.isControl ? " (calibrator)" : ""}: Ct ${ctMeanSD(x.targetCt.stats)}, ${r.reference} ${ctMeanSD(x.refCt.stats)}; ` +
          `ΔCt ${signedCt(x.dCt, x.dCtSD)}; ΔΔCt ${signedCt(x.ddCt, x.ddCtSD)}; fold change ${range}`,
      );
    }
  }
  const caveats: string[] = [
    mode === "both"
      ? "SD of ΔΔCt = SD of ΔCt: subtracting the calibrator's mean ΔCt is treated as subtracting a constant, and the calibrator keeps its own error (Livak & Schmittgen 2001, Tables 1–2)."
      : "The calibrator is defined as 1 without error, so its ΔCt SD is propagated into every other group: SD(ΔΔCt) = √(SD² + SD calibrator²), " +
        "the usual propagation for a difference of two independent means. Livak & Schmittgen (2001) Tables 1–2 instead keep SD(ΔΔCt) = SD(ΔCt), " +
        "the other option of this calculator.",
    LIVAK_ASSUMPTIONS,
    REPLICATE_NOTE,
    ...refShiftNotes(r.reference, r.refShift),
    ...r.skipped,
    ...r.notes,
  ];
  const cats = r.groups.filter((g) => r.rows.some((x) => x.group === g));
  const series: FoldBarSeries[] = r.targets
    .filter((t) => r.rows.some((x) => x.target === t))
    .map((t) => {
      const at = (g: string) => r.rows.find((x) => x.group === g && x.target === t);
      return {
        label: t,
        values: cats.map((g) => at(g)?.fold ?? NaN),
        low: cats.map((g) => (mode === "propagate" && at(g)?.isControl ? NaN : at(g)?.foldLow ?? NaN)),
        high: cats.map((g) => (mode === "propagate" && at(g)?.isControl ? NaN : at(g)?.foldHigh ?? NaN)),
      };
    });
  const svg = foldChangeBarSvg(
    cats,
    series,
    // The tspan after the superscript drops the baseline back down (dy is cumulative).
    `Relative expression, ${SUP_DDCT}<tspan dy="5"> (vs ${xmlEsc(short(r.control))}, ${xmlEsc(short(r.reference))}-normalised)</tspan>`,
    `fold change, ${SUP_DDCT}`,
    [
      `Error bars: the range 2<tspan dy="-4" font-size="7">${MINUS}(ΔΔCt ± SD)</tspan><tspan dy="4">,</tspan>`,
      "Livak &amp; Schmittgen (2001), from technical replicates.",
    ],
    useLog2(axis, r.rows.filter((x) => !x.isControl).map((x) => x.fold)),
  );
  return { text: lines.join("\n"), svg, caveats };
}

function effLine(name: string, e: EfficiencyFit): string {
  return `  ${name}: slope ${qNum(e.slope, 4)} cycles per log₁₀, ${r2Text(e.rsquared, 4)}, E = ${qNum(e.E, 4)} (efficiency ${qNum(e.efficiencyPct, 3)} %), ${e.n} Cts at ${e.levels} dilutions`;
}

export function pfafflReport(r: PfafflResult, et: EfficiencyFit, er: EfficiencyFit, axis: FoldAxis = "auto"): QuantOutput {
  const lines: string[] = ["qPCR relative quantification: Pfaffl ratio (measured efficiencies)"];
  lines.push("Efficiencies from the dilution series, Ct against log₁₀(input), E = 10 to the power (−1/slope):");
  lines.push(effLine(`${r.target} (target)`, et));
  lines.push(effLine(`${r.reference} (reference)`, er));
  lines.push(
    "Ratio = E(target) to the power ΔCt(target), divided by E(reference) to the power ΔCt(reference); ΔCt = mean Ct(control) − mean Ct(sample):",
  );
  for (const x of r.rows) {
    if (x.isControl) {
      lines.push(`  ${x.group} (control): ratio 1`);
      continue;
    }
    lines.push(`  ${x.group}: ΔCt ${r.target} ${ct2(x.dCtTarget)}, ΔCt ${r.reference} ${ct2(x.dCtRef)} → ratio ${f3k(x.ratio)}`);
  }
  const caveats = [
    "The efficiencies are taken as exact constants; their own uncertainty (from the dilution-series fit) is not carried into the ratio.",
    "No error range is given: Pfaffl (2001) states no closed-form error for the ratio (his REST software tests it by randomisation), and this tool does not invent one.",
    REPLICATE_NOTE,
    ...et.warnings,
    ...er.warnings,
    ...refShiftNotes(r.reference, r.refShift),
    ...r.skipped,
  ];
  const svg = foldChangeBarSvg(
    r.rows.map((x) => x.group),
    [{ label: r.target, values: r.rows.map((x) => x.ratio) }],
    `Expression ratio of ${xmlEsc(short(r.target))} (Pfaffl), vs ${xmlEsc(short(r.control))}`,
    "expression ratio",
    [
      xmlEsc(`E = ${qNum(et.E, 4)} (${short(r.target)}), ${qNum(er.E, 4)} (${short(r.reference)}).`),
      xmlEsc("No error bars: Pfaffl (2001) gives no closed-form error for the ratio."),
    ],
    useLog2(axis, r.rows.filter((x) => !x.isControl).map((x) => x.ratio)),
  );
  return { text: lines.join("\n"), svg, caveats };
}

// -------------------------------------------------------------- defaults

const STD_DEFAULT = [
  "0\t0.048\t0.052\t0.050",
  "25\t0.118\t0.111\t0.115",
  "50\t0.176\t0.183\t0.180",
  "100\t0.309\t0.315\t0.305",
  "200\t0.561\t0.549\t0.570",
  "400\t1.058\t1.071\t1.049",
].join("\n");
const UNK_DEFAULT = ["Sample 1\t0.412\t0.405\t0.418", "Sample 2\t0.231\t0.226\t0.236", "Sample 3\t1.402\t1.389\t1.411"].join("\n");

/** A 96-well default: an 8-point standard curve in duplicate, blanks, three samples in triplicate. */
function plateDefault(): string {
  const conc = [1000, 500, 250, 125, 62.5, 31.25, 15.6, 0];
  const resp = (c: number): number => 0.05 + (2.2 - 0.05) / (1 + Math.pow(180 / Math.max(c, 1e-9), 1.1));
  const head = ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].join("\t");
  const rows: string[] = [head];
  const jitter = [0.006, -0.004, 0.003, -0.007, 0.005, -0.002, 0.004, -0.005, 0.002, -0.003, 0.007, -0.006];
  "ABCDEFGH".split("").forEach((L, r) => {
    const cells: string[] = [];
    for (let c = 1; c <= 12; c++) {
      let v: number | null = null;
      if (c <= 2) v = (conc[r] === 0 ? 0.05 : resp(conc[r])) + 0.04 + jitter[(r + c) % 12];
      else if (c === 3 && r < 3) v = 0.04 + jitter[r] / 3; // blanks A3–C3
      // Replicates differ at the heat map's 2-decimal cell labels (a row of
      // identical printed values reads as a duplicated axis to the label gate).
      else if (c >= 4 && c <= 6 && r < 3) v = [0.82, 0.41, 1.53][r] + [-0.013, 0.001, 0.014][c - 4];
      cells.push(v === null ? "" : v.toFixed(3));
    }
    rows.push([L, ...cells].join("\t"));
  });
  return rows.join("\n");
}
const LAYOUT_DEFAULT = [
  "std 1000: A1-A2",
  "std 500: B1-B2",
  "std 250: C1-C2",
  "std 125: D1-D2",
  "std 62.5: E1-E2",
  "std 31.25: F1-F2",
  "std 15.6: G1-G2",
  "std 0: H1-H2",
  "blank: A3-C3",
  "Sample 1: A4-A6",
  "Sample 2: B4-B6",
  "Sample 3: C4-C6",
].join("\n");

/** Livak & Schmittgen (2001) Table 1: c-myc and GAPDH in brain and kidney, six replicates each. */
const CT_DEFAULT = [
  "Brain\tc-myc\t30.72\t30.34\t30.58\t30.34\t30.50\t30.43",
  "Brain\tGAPDH\t23.70\t23.56\t23.47\t23.65\t23.69\t23.68",
  "Kidney\tc-myc\t27.06\t27.03\t27.03\t27.10\t26.99\t26.94",
  "Kidney\tGAPDH\t22.76\t22.61\t22.62\t22.60\t22.61\t22.76",
].join("\n");
const TDIL_DEFAULT = ["1\t20.11\t20.05\t20.17", "0.1\t23.49\t23.55\t23.44", "0.01\t26.90\t26.82\t26.95", "0.001\t30.31\t30.22\t30.36"].join("\n");
const RDIL_DEFAULT = ["1\t15.02\t15.08\t14.97", "0.1\t18.36\t18.41\t18.30", "0.01\t21.70\t21.76\t21.66", "0.001\t25.09\t25.02\t25.13"].join("\n");

// -------------------------------------------------------------- registry

export const ASSAY_QUANT_CALCS: QuantCalc[] = [
  {
    id: "stdcurve",
    name: "Standard curve: read unknowns (linear or 4PL)",
    fields: [
      MODEL_FIELD,
      { key: "stds", label: "Standards: concentration, then replicate responses (one standard per line)", default: STD_DEFAULT, kind: "block" },
      { key: "unk", label: "Unknowns: name, then replicate responses, one per line (typed names with spaces take a colon: “Sample 1: 0.41 0.40”)", default: UNK_DEFAULT, kind: "block" },
      { key: "unit", label: "Concentration unit (optional)", default: "µg/mL", kind: "text", optional: true },
    ],
    compute: (r) => {
      // The standards and the unknowns are one assay: each is evidence for how the other's commas read.
      const commaNotes: string[] = [];
      const stds = parseStandards(r("stds"), commaNotes, blockTokens(r("unk")), readingCells(r("unk")));
      if (typeof stds === "string") return { text: stds, ok: false };
      const unk = parseUnknowns(r("unk"), commaNotes, blockTokens(r("stds")), readingCells(r("stds")));
      if (typeof unk === "string") return { text: unk, ok: false };
      const res = standardCurve(stds, unk, model(r("model")));
      if (!res.ok) return { text: res.error, ok: false };
      const unit = r("unit");
      return {
        text: curveReport(res, unit),
        svg: standardCurveSvg(res, cleanName(unit), res.curve.model === "4pl" ? "Standard curve (4PL)" : "Standard curve"),
        caveats: [...commaNotes, ...curveCaveats(res)],
      };
    },
  },
  {
    id: "plate",
    name: "Plate reader: 96/384-well plate → standard curve",
    fields: [
      { ...MODEL_FIELD, default: "4pl" },
      { key: "plate", label: "Plate readings (8 × 12 or 16 × 24; row letters and a column-number header)", default: plateDefault(), kind: "block" },
      { key: "layout", label: "Layout: “std 100: A1-A3”, “blank: H1-H3”, “Sample 1: B4-B6” (or a plate-shaped table of labels)", default: LAYOUT_DEFAULT, kind: "block" },
      { key: "unit", label: "Concentration unit (optional)", default: "pg/mL", kind: "text", optional: true },
    ],
    compute: (r) => {
      const a = analysePlate(r("plate"), r("layout"), model(r("model")));
      if (!a.ok) return { text: a.error, ok: false };
      const wellsWithData = [...a.plate.wells.values()].filter((v) => v !== null).length;
      const size = a.plate.rows * a.plate.cols;
      if (!a.curve.ok) return { text: `Plate read (${size}-well, ${wellsWithData} wells with a reading), but the standard curve cannot be used: ${a.curve.error}`, ok: false };
      const unit = r("unit");
      const nStd = a.groups.filter((g) => g.kind === "standard").length;
      const nSmp = a.groups.filter((g) => g.kind === "sample").length;
      const head = [
        `Plate: ${size}-well, ${wellsWithData} well${wellsWithData === 1 ? "" : "s"} with a reading; ${nStd} standard${nStd === 1 ? "" : "s"}, ` +
          `${nSmp} sample${nSmp === 1 ? "" : "s"}.`,
        a.blank
          ? `Blank: ${repLine(a.blank)}; subtracted from every standard and sample well.`
          : "Blank: none in the layout, so no blank subtraction.",
      ];
      const text = `${head.join("\n")}\n${curveReport(a.curve, unit)}`;
      const heat = plateHeatmapSvg(a.plate, `Plate readings (raw), ${size}-well`);
      const curveSvg = standardCurveSvg(a.curve, cleanName(unit), a.curve.curve.model === "4pl" ? "Standard curve (4PL)" : "Standard curve", a.blank ? "response (blank-subtracted)" : "response");
      const svg = combineSvgs([heat.svg, curveSvg]).svg;
      return { text, svg, caveats: [...a.notes, ...heat.notes, ...curveCaveats(a.curve)] };
    },
  },
  {
    id: "qpcr-livak",
    name: "qPCR relative quantification: Livak ΔΔCt method",
    fields: [
      { key: "cts", label: "Ct table: group, gene, then replicate Cts per line (or a table with Sample / Target / Ct columns)", default: CT_DEFAULT, kind: "block" },
      { key: "ref", label: "Reference (housekeeping) gene", default: "GAPDH", kind: "text" },
      { key: "ctrl", label: "Control / calibrator group", default: "Brain", kind: "text" },
      {
        key: "cal",
        label: "Calibrator error",
        default: "both",
        kind: "select",
        options: [
          { value: "both", label: "Shown in the calibrator and in each sample (Livak Tables 1–2)" },
          { value: "propagate", label: "Calibrator = 1 without error; its SD propagated into each sample" },
        ],
      },
      AXIS_FIELD,
    ],
    compute: (r) => {
      const t = readCtTable(r("cts"));
      if (!t.ok) return { text: t.error, ok: false };
      const mode = r("cal") === "propagate" ? "propagate" : "both";
      const res = livak(t, r("ref"), r("ctrl"), mode);
      if (!res.ok) return { text: res.error, ok: false };
      const out = livakReport(res, mode, foldAxis(r("axis")));
      return { ...out, caveats: [...(out.caveats ?? []), ...t.notes] };
    },
  },
  {
    id: "qpcr-pfaffl",
    name: "qPCR relative quantification: Pfaffl ratio (primer efficiencies)",
    fields: [
      { key: "cts", label: "Ct table: group, gene, then replicate Cts per line (or a table with Sample / Target / Ct columns)", default: CT_DEFAULT, kind: "block" },
      { key: "target", label: "Target gene (optional if the table has only one)", default: "", kind: "text", optional: true },
      { key: "ref", label: "Reference (housekeeping) gene", default: "GAPDH", kind: "text" },
      { key: "ctrl", label: "Control group", default: "Brain", kind: "text" },
      { key: "tdil", label: "Target dilution series: relative input (1, 0.1, 0.01 or 1:10), then replicate Cts", default: TDIL_DEFAULT, kind: "block" },
      { key: "rdil", label: "Reference dilution series: relative input, then replicate Cts", default: RDIL_DEFAULT, kind: "block" },
      AXIS_FIELD,
    ],
    compute: (r) => {
      const t = readCtTable(r("cts"));
      if (!t.ok) return { text: t.error, ok: false };
      const dilNotes: string[] = [];
      const td = readDilutionSeries(r("tdil"), "Target dilution series", dilNotes);
      if (!Array.isArray(td)) return { text: td.error, ok: false };
      const rd = readDilutionSeries(r("rdil"), "Reference dilution series", dilNotes);
      if (!Array.isArray(rd)) return { text: rd.error, ok: false };
      const et = efficiencyFromDilution(td, "Target");
      if (!et.ok) return { text: et.error, ok: false };
      const er = efficiencyFromDilution(rd, "Reference");
      if (!er.ok) return { text: er.error, ok: false };
      const res = pfaffl(t, r("target"), r("ref"), r("ctrl"), et.E, er.E);
      if (!res.ok) return { text: res.error, ok: false };
      const out = pfafflReport(res, et, er, foldAxis(r("axis")));
      return { ...out, caveats: [...(out.caveats ?? []), ...t.notes, ...dilNotes] };
    },
  },
];
