/**
 * Figures for the library Finance calculators that drew none ("fully inclusive", 2026-10-28): currency parity
 * (fx-cip, fx-uip, fx-ppp), put–call parity (deriv-parity), the royalty steps of apportionment and EMVR → SSPPU, the
 * Nash bargaining split, and the financial-ratio profile.
 *
 * Every value drawn is one the engine computed for this run. The line figures are drawn by the shared plotter
 * (finPlotSvg), which keeps the layout and label gates; the bar figures by groupedBarsSvg below, which prints each
 * value in the result's own format and stacks a label above its bar when it would not fit beside it (the ratio
 * profile's rows also mix three units, times, percent and days, that no single axis can carry).
 *
 * Each builder reads the Finance figure style (width, black and white) through currentFinFig, so the pane's journal
 * and USPTO re-render (withFinFig) reaches it.
 */
import { currentFinFig, finPlotSvg, type FinFig } from "./financeFigures";
import type { Point, Series } from "./plot";
import type { RatioRow, Figure } from "./statements";
import { textWidthPt } from "./arialMetrics";

const INK = "#111111";
const RULE = "#888888";
const BLUE = "#2563eb";
const RED = "#b91c1c";
const GREY = "#6b7280";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** A width estimate that is never narrower than the layout gate's own (0.58 em a character). */
function textW(s: string, size: number): number {
  return Math.max(textWidthPt(s, size), [...s].length * size * 0.58);
}

// ------------------------------------------------------------------------------------------------------------------
// Currency parity (cbaCalcs.ts: fx-cip, fx-uip, fx-ppp)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Covered interest parity: the parity forward across tenors from today to twice the tenor asked (the engine's own
 * forward function at each tenor), the parity forward at the tenor marked, and the quoted forward when one is given.
 * A quote above the curve is the foreign currency dear forward; below, cheap.
 */
export function cipParitySvg(forwardAt: (days: number) => number, days: number, quoted: number | null): string | undefined {
  const maxD = Math.max(2 * days, 2);
  const N = 40;
  const curve: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const d = (maxD * i) / N;
    const F = forwardAt(d);
    if (Number.isFinite(F)) curve.push({ x: d, y: F });
  }
  const Fd = forwardAt(days);
  if (curve.length < 2 || !Number.isFinite(Fd)) return undefined;
  const series: Series[] = [
    { points: curve, type: "line", color: BLUE, label: "parity forward" },
    { points: [{ x: days, y: Fd }], type: "scatter", color: INK, label: "parity at tenor" },
  ];
  if (quoted !== null && Number.isFinite(quoted)) series.push({ points: [{ x: days, y: quoted }], type: "scatter", color: RED, label: "quoted forward" });
  return finPlotSvg(series, { width: 380, height: 270, title: "Covered interest parity by tenor", xlabel: "tenor (days)", ylabel: "forward rate" });
}

/**
 * Uncovered interest parity: the expected spot path S·((1 + i)/(1 + i*))ᵗ from today to the horizon, and the
 * realized spot at the horizon when one is given (above the path: the foreign currency gained more than parity).
 */
export function uipPathSvg(S: number, ratioPerYear: number, T: number, realized: number | null): string | undefined {
  const N = 40;
  const path: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (T * i) / N;
    const y = S * Math.pow(ratioPerYear, t);
    if (Number.isFinite(y)) path.push({ x: t, y });
  }
  if (path.length < 2) return undefined;
  const series: Series[] = [{ points: path, type: "line", color: BLUE, label: "expected (UIP)" }];
  if (realized !== null && Number.isFinite(realized)) series.push({ points: [{ x: T, y: realized }], type: "scatter", color: RED, label: "realized spot" });
  return finPlotSvg(series, { width: 380, height: 270, title: "Uncovered interest parity", xlabel: "years ahead", ylabel: "spot rate" });
}

/** Relative PPP: the spot path S₀·((1 + π)/(1 + π*))ᵗ over the horizon. */
export function pppPathSvg(S0: number, g: number, T: number): string | undefined {
  const N = 40;
  const path: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (T * i) / N;
    const y = S0 * Math.pow(g, t);
    if (Number.isFinite(y)) path.push({ x: t, y });
  }
  if (path.length < 2) return undefined;
  return finPlotSvg([{ points: path, type: "line", color: BLUE, label: "PPP spot path" }], {
    width: 380,
    height: 260,
    title: "Relative PPP: spot rate path",
    xlabel: "years ahead",
    ylabel: "spot rate",
  });
}

/**
 * Put–call parity (derivCalcs.ts: deriv-parity): the parity line C − P = S′·exp(−qt) − K·exp(−rt) across spot prices
 * S′ around today's spot (half to one and a half times), the parity value at today's spot marked, and the quoted C − P
 * at today's spot. A quote above the line is the call rich against the put; below, the put rich.
 */
export function putCallParitySvg(S: number, eqt: number, pvK: number, quotedDiff: number): string | undefined {
  const N = 40;
  const line: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const s = S * (0.5 + i / N);
    const y = s * eqt - pvK;
    if (Number.isFinite(y)) line.push({ x: s, y });
  }
  const atS = S * eqt - pvK;
  if (line.length < 2 || !Number.isFinite(atS) || !Number.isFinite(quotedDiff)) return undefined;
  return finPlotSvg(
    [
      { points: line, type: "line", color: BLUE, label: "parity line" },
      { points: [{ x: S, y: atS }], type: "scatter", color: INK, label: "parity at spot" },
      { points: [{ x: S, y: quotedDiff }], type: "scatter", color: RED, label: "quoted C − P" },
    ],
    { width: 380, height: 270, title: "Put–call parity: quote and line", xlabel: "spot price", ylabel: "C − P" },
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Labelled bar rows: the step bars (apportionment, EMVR → SSPPU), the Nash split, absolute PPP and the ratio profile
// ------------------------------------------------------------------------------------------------------------------

export interface BarRow {
  name: string;
  value: number;
  /** The value as the result's text or table prints it (drawn in the value column). */
  text: string;
  /** A second value on the same scale, drawn as a tick (the prior year). */
  tick?: number | null;
  emphasis?: boolean;
}
export interface BarGroup {
  /** A group heading (its unit); none for a single group. */
  head?: string;
  rows: BarRow[];
}

/**
 * Horizontal bars in groups, each group on its own scale from zero, the value printed in a column at the right in
 * the result's own format. Labels sit to the left of the bars when they fit, else on their own line above each bar
 * (narrow or black-and-white widths), so a long label never runs off the canvas; the title wraps by words.
 * (hBarSvg caps its label margin at 45% of the width and lets a longer label run off the left edge in black and
 * white, which is why these figures do not use it.)
 */
export function groupedBarsSvg(title: string, groups: BarGroup[], fig: FinFig | null = currentFinFig()): string | undefined {
  const gs = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => Number.isFinite(r.value)) })).filter((g) => g.rows.length);
  const all = gs.flatMap((g) => g.rows);
  if (!all.length) return undefined;
  const W = fig?.width ?? 400;
  const bw = fig?.bw === true;
  const S = (base: number): number => (bw ? Math.round(base * 1.45 * 1.4 * 10) / 10 : base);
  const fs = S(8);
  const titleFs = bw ? S(9) : 11;
  const headFs = bw ? S(8.5) : 9.5;
  const titleLines: string[] = [];
  for (const word of title.split(" ")) {
    const last = titleLines[titleLines.length - 1];
    if (last !== undefined && textW(`${last} ${word}`, titleFs) <= W - 16) titleLines[titleLines.length - 1] = `${last} ${word}`;
    else titleLines.push(word);
  }
  const MR = Math.ceil(Math.max(...all.map((r) => textW(r.text, fs))) + 12);
  const labelW = Math.max(...all.map((r) => textW(r.name, fs)));
  const side = labelW + 14 <= W * 0.45 && W - (labelW + 14) - MR >= 80;
  const ML = side ? Math.ceil(labelW + 14) : 8;
  const plotR = W - MR;
  const pw = plotR - ML;
  if (pw < 40) return undefined;
  const barH = bw ? 12 : 9;
  const rowH = side ? Math.max(barH, fs) + 8 : fs + barH + 10;

  let y = 10 + titleLines.length * (titleFs + 4) + 4;
  const p: string[] = [];
  for (const g of gs) {
    const vals = g.rows.flatMap((r) => [r.value, r.tick ?? null]).filter((v): v is number => v !== null && Number.isFinite(v));
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    let span = hi - lo || 1;
    if (!Number.isFinite(span)) span = Math.max(Math.abs(hi / 2 - lo / 2), 1) * 2;
    const X = (v: number): number => ML + ((v / 2 - lo / 2) / (span / 2)) * pw;
    if (g.head) {
      p.push(`<text x="8" y="${(y + headFs).toFixed(1)}" font-size="${headFs}" font-weight="bold" fill="${INK}">${esc(g.head)}</text>`);
      y += headFs + 10;
    }
    for (const r of g.rows) {
      const labelY = side ? y + barH / 2 + fs * 0.35 : y + fs;
      const barY = side ? y : y + fs + 4;
      p.push(`<text x="${side ? (ML - 6).toFixed(1) : "8"}" y="${labelY.toFixed(1)}" font-size="${fs}"${side ? ' text-anchor="end"' : ""} fill="${INK}">${esc(r.name)}</text>`);
      const x0 = Math.min(X(0), X(r.value));
      const wBar = Math.max(Math.abs(X(r.value) - X(0)), 0.75);
      const fill = r.emphasis ? RED : r.value >= 0 ? BLUE : GREY;
      p.push(
        bw
          ? `<rect x="${x0.toFixed(1)}" y="${barY.toFixed(1)}" width="${wBar.toFixed(1)}" height="${barH}" fill="${r.emphasis ? "#000000" : "#ffffff"}" stroke="#000000" stroke-width="0.8"/>`
          : `<rect x="${x0.toFixed(1)}" y="${barY.toFixed(1)}" width="${wBar.toFixed(1)}" height="${barH}" fill="${fill}" fill-opacity="0.85"/>`,
      );
      // the zero line, over this bar only (a line running through the rows would cross the stacked labels)
      if (lo < 0) {
        const xz = X(0).toFixed(1);
        p.push(`<line x1="${xz}" y1="${(barY - 1).toFixed(1)}" x2="${xz}" y2="${(barY + barH + 1).toFixed(1)}" stroke="${RULE}" stroke-width="0.8"/>`);
      }
      if (r.tick !== undefined && r.tick !== null && Number.isFinite(r.tick)) {
        const xp = X(r.tick).toFixed(1);
        p.push(`<line x1="${xp}" y1="${(barY - 2).toFixed(1)}" x2="${xp}" y2="${(barY + barH + 2).toFixed(1)}" stroke="${INK}" stroke-width="2"/>`);
      }
      const vY = side ? labelY : barY + barH / 2 + fs * 0.35;
      p.push(`<text x="${(plotR + 6).toFixed(1)}" y="${vY.toFixed(1)}" font-size="${fs}" fill="${INK}">${esc(r.text)}</text>`);
      y += rowH;
    }
    y += 4;
  }
  const H = Math.ceil(y + 8);
  const head = titleLines
    .map((t, i) => `<text data-figure-title="1" x="${(W / 2).toFixed(1)}" y="${(10 + titleFs + i * (titleFs + 4)).toFixed(1)}" text-anchor="middle" font-size="${titleFs}" fill="${INK}">${esc(t)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g font-family="sans-serif">${head}${p.join("")}</g></svg>`;
  return bw ? svg.replace(/#(?:111111|888888|6b7280|b91c1c|2563eb)/g, "#000000") : svg;
}

/**
 * The amount left after each step from the base to the royalty: one bar per stage, the last (the royalty)
 * emphasised. Read top to bottom it is the waterfall: each bar is the one above it times that step's share.
 */
export function stepBarsSvg(steps: { name: string; value: number; text: string }[], title: string): string | undefined {
  if (steps.length < 2) return undefined;
  return groupedBarsSvg(title, [{ rows: steps.map((s, i) => ({ ...s, emphasis: i === steps.length - 1 })) }]);
}

/** Named amounts as bars (the Nash split, EMV against SSPPU, the PPP basket), one emphasised. */
export function namedBarsSvg(rows: { name: string; value: number; text: string; emphasis?: boolean }[], title: string): string | undefined {
  return groupedBarsSvg(title, [{ rows }]);
}

/**
 * Absolute PPP with an actual spot: the basket's cost at home against its cost abroad converted at the spot rate,
 * both in domestic currency. The longer bar is the dearer basket; equal bars are parity. Without a spot there is no
 * second domestic-currency amount to compare, so nothing is drawn.
 */
export function pppBasketSvg(pd: number, pf: number, S: number | null, fmt: (x: number) => string): string | undefined {
  if (S === null || !Number.isFinite(S * pf)) return undefined;
  return namedBarsSvg(
    [
      { name: "Basket at home", value: pd, text: fmt(pd) },
      { name: "Basket abroad at spot", value: S * pf, text: fmt(S * pf), emphasis: true },
    ],
    "Absolute PPP: the basket in domestic currency",
  );
}

// ------------------------------------------------------------------------------------------------------------------
// The financial-ratio profile (schedCalcs.ts: fin-ratios)
// ------------------------------------------------------------------------------------------------------------------

const UNIT_HEAD: Record<RatioRow["unit"], string> = { times: "Multiples (×)", "%": "Percentages", days: "Days" };

function ratioText(f: Figure, unit: RatioRow["unit"]): string {
  if (!f.ok) return "";
  const v = unit === "%" ? f.value * 100 : f.value;
  const s = unit === "days" ? v.toFixed(1) : v.toFixed(2);
  const t = /^-0\.0+$/.test(s) ? s.slice(1) : s.startsWith("-") ? "−" + s.slice(1) : s;
  return unit === "%" ? `${t}%` : unit === "days" ? `${t} days` : `${t}×`;
}

/**
 * The ratio profile: every computed ratio as a bar, grouped by unit (multiples, percentages, days), each group on its
 * own scale from zero; the prior year (when the statement has one) as a tick on the same scale; the value in the
 * table's own format (`fmt`).
 */
export function ratioProfileSvg(
  rows: RatioRow[],
  hasPrior: boolean,
  fmt: (f: Figure, unit: RatioRow["unit"]) => string = ratioText,
  fig: FinFig | null = currentFinFig(),
): string | undefined {
  const scaled = (f: Figure | null, unit: RatioRow["unit"]): number | null => (f && f.ok && Number.isFinite(f.value) ? (unit === "%" ? f.value * 100 : f.value) : null);
  const groups: BarGroup[] = (["times", "%", "days"] as const).map((u) => ({
    head: UNIT_HEAD[u],
    rows: rows
      .filter((r) => r.unit === u && scaled(r.current, u) !== null)
      .map((r) => ({ name: r.name, value: scaled(r.current, u) as number, text: fmt(r.current, u), tick: hasPrior ? scaled(r.prior, u) : null })),
  }));
  return groupedBarsSvg(hasPrior ? "Financial ratio profile (bar: this year; tick: prior year)" : "Financial ratio profile", groups, fig);
}

/** Exposed for tests: the value text the profile prints for a ratio by default. */
export const ratioProfileText = ratioText;
