// Figures for the v2.140.0 audio, video and light calculators.
//
// THE ENGINES DESCRIBE, THIS FILE DRAWS. audio.ts, loudness.ts, photometry.ts,
// timecode.ts, video.ts and colourspace.ts return figure DATA (series, bars,
// ladders, rectangles, cadence slots) and never touch an SVG. Turning that data
// into a picture lives here, in src/lib, for one reason: the figure corpus
// (scripts/figure-layout-run.ts) cannot import the pane, so a figure built
// inside taskpane.ts is a figure no layout gate ever sees. The pane and the
// corpus both call these functions, so the corpus draws exactly what the pane
// inserts.
//
// Colours are literal hex: the artwork goes into Word as line art and must not
// follow the pane's theme.

import { buildPlotSvg, Series } from "./plot";
import { hBarSvg, HBarRow } from "./mechchart";
import type { AudioFigure, FigureMarker } from "./audio";
import type { PhotoFigure } from "./photometry";
import type { DriftFigure } from "./timecode";
import type { PulldownResult, AspectResult, TransferResult, InterfaceRateResult } from "./video";
import type { DaylightLocusFigure } from "./colourspace";

const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be185d"];
const MARK = "#b91c1c";
const FAINT = "#9ca3af";
const INK = "#111111";
const RULE = "#888888";
const PAPER = "#ffffff";

// Tick labels are plot.ts's own: it labels each linear axis as an axis.ts ROW
// (constant decimals, U+2212, ×10ⁿ on the title) and each log axis by decades.
// This file used to pass a per-value `fmtTick` hook, which gave
// `−1 −0.5 0 0.5 1` and `0 0.2 … 1` (mixed decimals in one row).

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The unit in a "name (unit)" axis label, for a bar chart's value labels. */
function unitOf(label: string): string {
  const m = /\(([^()]*)\)\s*$/.exec(label);
  return m ? m[1] : "";
}

function finiteRange(values: number[]): [number, number] | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return [Math.min(...v), Math.max(...v)];
}

/** A marker as a two-point line spanning the data range on the other axis. */
function markerSeries(m: FigureMarker, xr: [number, number], yr: [number, number], colour: string): Series {
  const pts =
    m.axis === "x"
      ? [
          { x: m.at, y: yr[0] },
          { x: m.at, y: yr[1] },
        ]
      : [
          { x: xr[0], y: m.at },
          { x: xr[1], y: m.at },
        ];
  return { points: pts, type: "line", color: colour, label: m.label };
}

/**
 * An engine's AudioFigure, drawn: a line chart through the shared plotter, a
 * bar chart as horizontal bars, or the level ladder (several reference scales
 * side by side on one decibel axis).
 */
export function audioFigureSvg(fig: AudioFigure): string {
  if (fig.kind === "ladder") return levelLadderSvg(fig);
  if (fig.kind === "bar") {
    const unit = unitOf(fig.yLabel);
    const rows: HBarRow[] = (fig.bars ?? []).map((b, i) => ({ name: b.label, value: b.value, colour: PALETTE[i % PALETTE.length] }));
    for (const m of fig.markers ?? []) rows.push({ name: m.label, value: m.at, colour: FAINT });
    return hBarSvg(rows, { title: fig.title, unit });
  }
  const series: Series[] = (fig.series ?? []).map((s, i) => ({
    points: s.points,
    type: "line" as const,
    color: s.style === "faint" ? FAINT : PALETTE[i % PALETTE.length],
    label: s.label,
  }));
  const xs = (fig.series ?? []).flatMap((s) => s.points.map((p) => p.x)).filter((x) => !fig.xLog || x > 0);
  const ys = (fig.series ?? []).flatMap((s) => s.points.map((p) => p.y)).filter((y) => !fig.yLog || y > 0);
  const markers = fig.markers ?? [];
  const xr = finiteRange([...xs, ...markers.filter((m) => m.axis === "x").map((m) => m.at)]);
  const yr = finiteRange([...ys, ...markers.filter((m) => m.axis === "y").map((m) => m.at)]);
  if (xr && yr) {
    markers.forEach((m) => {
      if ((m.axis === "x" && fig.xLog && !(m.at > 0)) || (m.axis === "y" && fig.yLog && !(m.at > 0))) return;
      series.push(markerSeries(m, xr, yr, m.axis === "x" ? MARK : "#6b7280"));
    });
  }
  return buildPlotSvg(series, {
    width: 380,
    height: 260,
    title: fig.title,
    xlabel: fig.xLabel,
    ylabel: fig.yLabel,
    xScale: fig.xLog ? "log" : "linear",
    yScale: fig.yLog ? "log" : "linear",
    notes: fig.note ? [fig.note] : undefined,
  });
}

/**
 * The level ladder every console manual prints: each reference scale as its own
 * vertical axis on ONE common decibel position, the entered level marked on
 * every one of them. The marker is drawn as a short red tick ON each axis and
 * never as a line across the chart, which would strike through the tick
 * labels.
 */
function levelLadderSvg(fig: AudioFigure): string {
  const scales = fig.ladder ?? [];
  const [lo, hi] = fig.range ?? [0, 1];
  const W = 400;
  const top = 46;
  const plotH = 230;
  const H = top + plotH + 40;
  const left = 14;
  const colW = (W - 2 * left) / Math.max(1, scales.length);
  const Y = (v: number): number => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${W / 2}" y="15" text-anchor="middle" font-size="11">${esc(fig.title)}</text>`);
  const marker = (fig.markers ?? [])[0];
  scales.forEach((s, i) => {
    const x0 = left + colW * i + 14;
    p.push(`<text x="${x0.toFixed(1)}" y="${top - 12}" text-anchor="start" font-size="10">${esc(s.name)}</text>`);
    p.push(`<line x1="${x0.toFixed(1)}" y1="${top}" x2="${x0.toFixed(1)}" y2="${top + plotH}" stroke="${RULE}"/>`);
    // Tick labels sit to the right of the axis; a label too close to the
    // marker is dropped rather than overprinted.
    const my = marker ? Y(marker.at) : NaN;
    for (const t of s.ticks) {
      const y = Y(t.at);
      if (y < top - 0.5 || y > top + plotH + 0.5) continue;
      p.push(`<line x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x0 + 4).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${RULE}"/>`);
      if (Number.isFinite(my) && Math.abs(y - my) < 8) continue;
      p.push(`<text x="${(x0 + 7).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="start">${esc(t.label)}</text>`);
    }
    if (marker && Number.isFinite(my) && my >= top - 0.5 && my <= top + plotH + 0.5) {
      p.push(
        `<path d="M ${(x0 - 9).toFixed(1)} ${(my - 4).toFixed(1)} L ${(x0 - 1).toFixed(1)} ${my.toFixed(1)} L ${(x0 - 9).toFixed(1)} ${(my + 4).toFixed(1)} Z" fill="${MARK}"/>`,
      );
    }
  });
  if (marker) {
    p.push(
      `<text x="${left}" y="${H - 12}" text-anchor="start" fill="${MARK}">▶ ${esc(marker.label)}: the same level read on every scale</text>`,
    );
  }
  p.push("</g></svg>");
  return p.join("");
}

/** A photometry engine figure (already in the shared plotter's Series shape). */
export function photoFigureSvg(fig: PhotoFigure): string {
  const series: Series[] = fig.series.map((s, i) => ({
    ...s,
    color: s.type === "scatter" ? MARK : PALETTE[i % PALETTE.length],
  }));
  return buildPlotSvg(series, {
    width: 380,
    height: 260,
    title: fig.title,
    xlabel: fig.xlabel,
    ylabel: fig.ylabel,
    xScale: fig.xScale,
    yScale: fig.yScale,
  });
}

/** Timecode label time minus wall-clock time: NDF's straight fall and DF's sawtooth. */
export function timecodeDriftSvg(fig: DriftFigure, rateLabel: string): string {
  const series: Series[] = [
    { points: fig.ndf.map((d) => ({ x: d.realMin, y: d.driftS })), type: "line", color: PALETTE[0], label: "non-drop label" },
  ];
  if (fig.df.length) {
    series.push({ points: fig.df.map((d) => ({ x: d.realMin, y: d.driftS })), type: "line", color: PALETTE[1], label: "drop-frame label" });
  }
  if (fig.mark) {
    const pts = [{ x: fig.mark.realMin, y: fig.mark.ndfDriftS }];
    if (fig.mark.dfDriftS !== null) pts.push({ x: fig.mark.realMin, y: fig.mark.dfDriftS });
    series.push({ points: pts, type: "scatter", color: MARK, label: "timecode A" });
  }
  return buildPlotSvg(series, {
    width: 380,
    height: 260,
    title: `Label time minus real time, ${rateLabel} fps`,
    xlabel: "real elapsed time (min)",
    ylabel: "label − real time (s)",
  });
}

/**
 * The cadence strip: one cycle of source frames as lettered blocks above the
 * target frames (or fields) they fill, each target coloured by its source.
 */
export function cadenceSvg(p: PulldownResult): string {
  const W = 400;
  const slots = p.cadence.slice(0, 20);
  const nSrc = Math.max(1, Math.min(10, p.cycle.sourceFrames));
  const H = 168;
  const left = 70;
  const avail = W - left - 12;
  const srcW = Math.min(60, avail / nSrc);
  const slotW = Math.min(40, avail / Math.max(1, slots.length));
  const letters = "ABCDEFGHIJ";
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  out.push(`<g font-family="sans-serif" font-size="10" fill="${INK}">`);
  out.push(`<text x="${W / 2}" y="15" text-anchor="middle" font-size="11">${esc(`${p.from.id} → ${p.to.id}: ${p.kind}`)}</text>`);
  out.push(`<text x="8" y="52" text-anchor="start" font-size="9">source</text>`);
  for (let i = 0; i < nSrc; i++) {
    const x = left + i * srcW;
    out.push(`<rect x="${(x + 1).toFixed(1)}" y="34" width="${(srcW - 2).toFixed(1)}" height="28" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.85"/>`);
    out.push(`<text x="${(x + srcW / 2).toFixed(1)}" y="52" text-anchor="middle" fill="${PAPER}">${letters[i] ?? "?"}</text>`);
  }
  const interlaced = slots.some((s) => s.field !== null);
  out.push(`<text x="8" y="104" text-anchor="start" font-size="9">${interlaced ? "fields" : "frames"}</text>`);
  slots.forEach((s, i) => {
    const x = left + i * slotW;
    out.push(`<rect x="${(x + 1).toFixed(1)}" y="86" width="${(slotW - 2).toFixed(1)}" height="28" fill="${PALETTE[s.source % PALETTE.length]}" fill-opacity="0.85"/>`);
    out.push(`<text x="${(x + slotW / 2).toFixed(1)}" y="104" text-anchor="middle" fill="${PAPER}">${letters[s.source] ?? "?"}</text>`);
  });
  if (interlaced) {
    // Bracket each target frame (two fields) underneath.
    const frames = Math.ceil(slots.length / 2);
    for (let f = 0; f < frames; f++) {
      const x = left + 2 * f * slotW;
      out.push(`<path d="M ${(x + 2).toFixed(1)} 120 L ${(x + 2).toFixed(1)} 124 L ${(x + 2 * slotW - 2).toFixed(1)} 124 L ${(x + 2 * slotW - 2).toFixed(1)} 120" fill="none" stroke="${RULE}"/>`);
      out.push(`<text x="${(x + slotW).toFixed(1)}" y="136" text-anchor="middle" font-size="9">${f + 1}</text>`);
    }
  }
  out.push(
    `<text x="8" y="${H - 10}" text-anchor="start" font-size="9">${esc(
      `${p.cycle.sourceFrames} source frame${p.cycle.sourceFrames === 1 ? "" : "s"} → ${p.cycle.targetFrames} target frame${p.cycle.targetFrames === 1 ? "" : "s"} per cycle`,
    )}</text>`,
  );
  out.push("</g></svg>");
  return out.join("");
}

/** The delivery frame to scale: active picture, bars, action- and title-safe rectangles, keyed below. */
export function aspectFrameSvg(fig: AspectResult["figure"]): string {
  const W = 400;
  const maxW = 360;
  const maxH = 220;
  const s = Math.min(maxW / fig.frameW, maxH / fig.frameH);
  const fw = fig.frameW * s;
  const fh = fig.frameH * s;
  const x0 = (W - fw) / 2;
  const y0 = 28;
  const keyTop = y0 + fh + 18;
  const H = keyTop + 14 * fig.rects.length + 6;
  const style: Record<string, { fill: string; stroke: string; dash: string; opacity: string }> = {
    Frame: { fill: "#111827", stroke: "#111827", dash: "", opacity: "1" },
    "Active picture": { fill: "#93c5fd", stroke: "#2563eb", dash: "", opacity: "1" },
  };
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}">`);
  out.push(`<rect width="${W}" height="${H.toFixed(0)}" fill="${PAPER}"/>`);
  out.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  out.push(`<text x="${W / 2}" y="16" text-anchor="middle" font-size="11">${esc(`${fig.frameW}×${fig.frameH} frame`)}</text>`);
  const colourFor = (label: string, i: number): string =>
    style[label]?.stroke ?? (label.startsWith("Action") ? "#d97706" : label.startsWith("Title") ? "#059669" : PALETTE[i % PALETTE.length]);
  fig.rects.forEach((r, i) => {
    const st = style[r.label];
    const colour = colourFor(r.label, i);
    const fill = st ? st.fill : "none";
    const dash = st ? "" : ` stroke-dasharray="5 3"`;
    out.push(
      `<rect x="${(x0 + r.x * s).toFixed(1)}" y="${(y0 + r.y * s).toFixed(1)}" width="${(r.w * s).toFixed(1)}" height="${(r.h * s).toFixed(1)}" fill="${fill}" stroke="${colour}" stroke-width="1.5"${dash}/>`,
    );
    const ky = keyTop + 14 * i;
    out.push(`<rect x="${x0.toFixed(1)}" y="${(ky - 8).toFixed(1)}" width="12" height="9" fill="${st ? st.fill : PAPER}" stroke="${colour}"/>`);
    out.push(`<text x="${(x0 + 18).toFixed(1)}" y="${ky.toFixed(1)}" text-anchor="start">${esc(`${r.label}: ${fmtPx(r.w)}×${fmtPx(r.h)}`)}</text>`);
  });
  out.push("</g></svg>");
  return out.join("");
}

function fmtPx(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/** A transfer curve against signal, the entered point marked and the SDR curves faint behind it. */
export function transferSvg(r: TransferResult): string {
  const series: Series[] = r.figure.compare.map((c) => ({ points: c.points, type: "line" as const, color: FAINT, label: c.name }));
  const names: Record<string, string> = { bt709: "BT.709 OETF⁻¹", bt1886: "BT.1886 EOTF", srgb: "sRGB EOTF", pq: "PQ EOTF", hlg: "HLG OETF⁻¹" };
  series.push({ points: r.figure.curve, type: "line", color: PALETTE[0], label: names[r.curve] ?? r.curve });
  if (r.figure.mark) series.push({ points: [r.figure.mark], type: "scatter", color: MARK, label: "entered value" });
  const yl =
    r.curve === "pq" ? "luminance (cd/m²)" : r.curve === "bt1886" ? "light / white (0–1)" : r.curve === "hlg" ? "scene light (0–1)" : "light (0–1)";
  return buildPlotSvg(series, {
    width: 380,
    height: 260,
    title: `${names[r.curve] ?? r.curve}: light against signal`,
    xlabel: "signal (0–1)",
    ylabel: yl,
    yScale: r.figure.logY ? "log" : "linear",
  });
}

/** Active picture, blanking and the SDI class, as bars in Gbit/s. */
export function interfaceBarsSvg(fig: InterfaceRateResult["figure"]): string {
  return hBarSvg(
    fig.bars.map((b, i) => ({ name: b.label, value: b.bps / 1e9, colour: PALETTE[i % PALETTE.length] })),
    { title: "Link rate: picture, blanking and the SDI class", unit: "Gbit/s" },
  );
}

/**
 * The CIE daylight and Planckian loci in xy, the sRGB triangle faint for
 * orientation. Entered temperatures are red on the locus that defines them;
 * an entered chromaticity is drawn in ink, so it never passes for a temperature.
 */
export function daylightLocusSvg(fig: DaylightLocusFigure): string {
  const lineColours = [FAINT, PALETTE[0], PALETTE[2]];
  let li = 0;
  const series: Series[] = fig.series.map((s) => ({
    points: s.points,
    type: s.type,
    color: s.type === "scatter" ? (/chromaticity/.test(s.label) ? INK : MARK) : lineColours[li++ % lineColours.length],
    label: s.label,
  }));
  return buildPlotSvg(series, { width: 380, height: 300, title: fig.title, xlabel: fig.xlabel, ylabel: fig.ylabel });
}
