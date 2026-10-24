// Figures for the 2026-10 engineering calculators (docs/SCOPE-ENGINEERING-2026-10.md): the plate's von Mises field on
// its deformed mesh, the Arrhenius plot with its extrapolation, the Butler–Volmer and Tafel curves and the Nernst line.
// Colours are literal hex: inserted artwork never follows the pane's theme.

import { SEQUENTIAL_BLUE, sampleRamp } from "./chartPalette";
import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import type { PlateResult } from "./planeStress";
import type { ArrheniusResult } from "./arrhenius";
import { butlerVolmerCurve, type BVParams, type TafelResult } from "./electrochem";

const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000"): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${fill}">${esc(t)}</text>`;

export const PLATE_CHART_WIDTH = 460;

/**
 * The plate: each triangle on its deformed position (displacements magnified, the factor stated), filled by its von
 * Mises stress on a sequential ramp with a colour bar; the supported edges hatched; the largest stress marked.
 */
export function plateChartSvg(r: PlateResult, units = "MPa"): string {
  const W = PLATE_CHART_WIDTH, PAD = 40, BAR = 70;
  const { W: pw, H: ph } = r.model;
  const s = Math.min((W - 2 * PAD - BAR) / pw, 260 / ph);
  const H = ph * s + 2 * PAD + 30;
  const maxD = Math.max(1e-300, r.maxDisp.value);
  const mag = (0.08 * Math.max(pw, ph)) / maxD;
  const P = (x: number, y: number): [number, number] => [PAD + x * s, PAD + 24 + (ph - y) * s];
  const vmax = Math.max(1e-300, r.maxVM.value);
  const out: string[] = [];
  out.push(text(12, 18, `von Mises stress (${units}) on the deformed plate`, "start", 12));
  out.push(text(W - 12, 18, `displacements × ${fmtSig(mag, 2)}`, "end", 10, "#555555"));
  // Undeformed outline, dashed.
  const [ax, ay] = P(0, 0), [bx, by] = P(pw, ph);
  out.push(`<rect x="${f(ax)}" y="${f(by)}" width="${f(bx - ax)}" height="${f(ay - by)}" fill="none" stroke="#888888" stroke-width="0.8" stroke-dasharray="4 3"/>`);
  r.tris.forEach(([p, q, t], e) => {
    const pts = [p, q, t].map((k) => P(r.nodes[k][0] + mag * r.disp[k][0], r.nodes[k][1] + mag * r.disp[k][1]));
    const c = sampleRamp(SEQUENTIAL_BLUE, r.stress[e][3] / vmax);
    out.push(`<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${c}" stroke="${c}" stroke-width="0.3"/>`);
  });
  // Supported edges: hatching outside the edge.
  for (const sp of r.model.supports) {
    const seg: Record<string, [[number, number], [number, number], [number, number]]> = {
      left: [[0, 0], [0, ph], [-1, 0]],
      right: [[pw, 0], [pw, ph], [1, 0]],
      bottom: [[0, 0], [pw, 0], [0, -1]],
      top: [[0, ph], [pw, ph], [0, 1]],
    };
    const [a, b, nrm] = seg[sp.edge];
    const [x1, y1] = P(a[0], a[1]), [x2, y2] = P(b[0], b[1]);
    out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#000000" stroke-width="2"/>`);
    const len = Math.hypot(x2 - x1, y2 - y1), k = Math.max(2, Math.round(len / 9));
    for (let i = 0; i <= k; i++) {
      const x = x1 + ((x2 - x1) * i) / k, y = y1 + ((y2 - y1) * i) / k;
      out.push(`<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + nrm[0] * 7 - Math.abs(nrm[1]) * 4)}" y2="${f(y - nrm[1] * 7 + Math.abs(nrm[0]) * 4)}" stroke="#000000" stroke-width="0.8"/>`);
    }
  }
  // The largest stress.
  const [mx, my] = P(r.maxVM.x, r.maxVM.y);
  out.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="3.5" fill="none" stroke="#c00000" stroke-width="1.4"/>`);
  out.push(text(mx + 6, my - 6, `max ${fmtSig(r.maxVM.value, 4)}`, "start", 10));
  // Colour bar.
  const bx0 = W - PAD - 18, by0 = PAD + 24, bh = Math.min(ph * s, 200);
  for (let i = 0; i < 40; i++) out.push(`<rect x="${f(bx0)}" y="${f(by0 + (bh * i) / 40)}" width="14" height="${f(bh / 40 + 0.5)}" fill="${sampleRamp(SEQUENTIAL_BLUE, 1 - i / 40)}"/>`);
  out.push(`<rect x="${f(bx0)}" y="${f(by0)}" width="14" height="${f(bh)}" fill="none" stroke="#000000" stroke-width="0.6"/>`);
  out.push(text(bx0 - 4, by0 + 4, fmtSig(vmax, 3), "end", 10), text(bx0 - 4, by0 + bh, "0", "end", 10));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${f(H)}" viewBox="0 0 ${W} ${f(H)}"><rect width="${W}" height="${f(H)}" fill="#ffffff"/>${out.join("")}</svg>`;
}

/** The Arrhenius plot: ln k against 1000/T, the fitted line run out to the storage temperature, which is marked. */
export function arrheniusChartSvg(r: ArrheniusResult, width = 420): string {
  const pts = r.points.map((p) => ({ x: 1000 / (p.tC + 273.15), y: Math.log(p.k) }));
  const xs0 = 1000 / (r.storage.tC + 273.15);
  const all = [...pts.map((p) => p.x), xs0];
  const lo = Math.min(...all), hi = Math.max(...all);
  const line = [lo, hi].map((x) => ({ x, y: r.fit.intercept + (r.fit.slope * x) / 1000 }));
  const series: Series[] = [
    { points: pts, type: "scatter", color: "#000000", label: "measured" },
    { points: line, type: "line", color: "#555555", label: `fit, Ea = ${fmtSig(r.EaKJ, 3)} kJ/mol` },
    { points: [{ x: xs0, y: Math.log(r.storage.k) }], type: "scatter", color: "#c00000", label: `${r.storage.tC} °C (storage)` },
  ];
  const pad = 0.05 * (hi - lo || 1);
  return buildPlotSvg(series, { xlabel: "1000/T (K⁻¹)", ylabel: "ln k", width, height: Math.round(width * 0.64), xLimits: { min: lo - pad, max: hi + pad } });
}

/** Butler–Volmer: current density against overpotential over ±ηmax. */
export function butlerVolmerChartSvg(p: BVParams, etaMax: number, units: string, width = 420): string {
  const pts = butlerVolmerCurve(p, -etaMax, etaMax).map(([x, y]) => ({ x, y }));
  return buildPlotSvg([{ points: pts, type: "line", color: "#000000" }], { xlabel: "Overpotential η (V)", ylabel: `Current density (${units})`, width, height: Math.round(width * 0.64) });
}

/** Tafel plot: log10|j| against η, the data and each fitted branch's line run to η = 0. */
export function tafelChartSvg(data: Array<[number, number]>, r: TafelResult, width = 420): string {
  // Currents at a vanishing fraction of the largest (η ≈ 0, where j crosses zero) have no place on a log axis.
  const jMax = Math.max(...data.map(([, j]) => Math.abs(j)));
  const series: Series[] = [{ points: data.filter(([, j]) => Math.abs(j) > 1e-6 * jMax).map(([e, j]) => ({ x: e, y: Math.log10(Math.abs(j)) })), type: "scatter", color: "#000000", label: "measured" }];
  for (const [b, name] of [[r.anodic, "anodic"], [r.cathodic, "cathodic"]] as const) {
    if (!b) continue;
    const etaEnd = Math.max(...data.map(([e]) => Math.abs(e))) * Math.sign(b.slope);
    series.push({ points: [{ x: 0, y: b.log10j0 }, { x: etaEnd, y: b.log10j0 + etaEnd / b.slope }], type: "line", color: "#555555", label: `${name}, ${fmtSig(Math.abs(b.slope) * 1000, 3)} mV/dec` });
  }
  return buildPlotSvg(series, { xlabel: "Overpotential η (V)", ylabel: "log₁₀ |j|", width, height: Math.round(width * 0.64) });
}

/** The Nernst line: E against log10 Q over four decades either side, the given Q marked. */
export function nernstChartSvg(E0: number, slopePerDecade: number, log10Q: number, width = 420): string {
  const xs = [log10Q - 4, log10Q + 4];
  const line = xs.map((x) => ({ x, y: E0 - slopePerDecade * x }));
  return buildPlotSvg(
    [
      { points: line, type: "line", color: "#000000", label: `slope −${fmtSig(slopePerDecade * 1000, 4)} mV/decade` },
      { points: [{ x: log10Q, y: E0 - slopePerDecade * log10Q }], type: "scatter", color: "#c00000", label: "this Q" },
    ],
    { xlabel: "log₁₀ Q", ylabel: "E (V)", width, height: Math.round(width * 0.64) },
  );
}
