// Figures for the space and lunar quantum-link calculators (quantumLinks.ts): link loss against range with the range
// presets marked, coincidence and accidental rates against the coincidence window, and the BB84 key rate against channel
// loss with the zero-key cutoff. Colours are literal hex (inserted artwork never follows the pane's theme); Arial through
// plot.ts, as engCharts2026.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import {
  MAX_COUNTS_PER_WINDOW,
  RANGE_PRESETS,
  capturedFraction,
  fsoLossAt,
  optimalMu,
  qkdAt,
  type EntInput,
  type EntResult,
  type FsoInput,
  type QkdInput,
  type QkdResult,
} from "./quantumLinks";

const WIDTH = 460;

/** n significant figures, trailing zeros dropped (a label, not a measurement). */
const sig = (v: number, n = 3): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** A time with an SI prefix for a label. */
export function timeText(s: number): string {
  for (const [f, u] of [[1, "s"], [1e-3, "ms"], [1e-6, "µs"], [1e-9, "ns"], [1e-12, "ps"]] as const) if (s >= f * 0.9995) return `${sig(s / f)} ${u}`;
  return `${sig(s / 1e-15)} fs`;
}

/** A range with its unit chosen for reading (m or km). */
export function rangeText(m: number): string {
  return m >= 1000 ? `${sig(m / 1000, 4)} km` : `${sig(m, 4)} m`;
}

const PRESET_COLOURS: Record<string, string> = { leo: "#2e7d32", geo: "#e08a00", moon: "#7b3fa0" };
const PRESET_TAG: Record<string, string> = { leo: "LEO", geo: "GEO", moon: "Moon" };

/**
 * Total link loss (dB) against range on a log axis, the three range presets marked and the operating range. In the far
 * field the loss rises 20 dB per decade; at short range it levels off as the receiver collects the whole central lobe.
 * The far-field approximation is drawn in grey where it stays at or below 1, so the gap to the exact curve is visible.
 */
export function fsoLossSvg(inp: FsoInput, opRangeM: number, opLossDb: number, presetId: string | null, width = WIDTH): string {
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(1e5, opRangeM / 3))));
  const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(1e9, opRangeM * 1.5))));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 160; i++) {
    const d = lo * Math.pow(hi / lo, i / 160);
    pts.push({ x: d, y: fsoLossAt(inp, d) });
  }
  // The far-field approximation (π D_t D_r /(4 λ L))² as a grey reference, only where it is at most 1.
  const extra = inp.pointingDb + inp.atmosDb + inp.opticsDb - 10 * Math.log10(inp.detEff);
  const approx = (d: number): number => Math.pow((Math.PI * inp.dt * inp.dr) / (4 * inp.lambda * d), 2);
  const approxPts = pts.filter((p) => approx(p.x) <= 1).map((p) => ({ x: p.x, y: extra - 10 * Math.log10(approx(p.x)) }));
  const capped = approxPts.length < pts.length;
  const series: Series[] = [
    { points: approxPts, type: "line", color: "#999999", label: "Far-field approx." },
    { points: pts, type: "line", color: "#1f5fa8", label: "Total loss (exact)" },
  ];
  for (const p of RANGE_PRESETS) {
    if (p.id === presetId) continue;
    series.push({ points: [{ x: p.m, y: fsoLossAt(inp, p.m) }], type: "scatter", color: PRESET_COLOURS[p.id], label: `${PRESET_TAG[p.id]}: ${sig(fsoLossAt(inp, p.m), 4)} dB` });
  }
  // Legend labels stay within plot.ts's 22-character legend width.
  const opName = presetId && PRESET_TAG[presetId] ? `${PRESET_TAG[presetId]} (here)` : "Here";
  series.push({ points: [{ x: opRangeM, y: opLossDb }], type: "scatter", color: "#c00000", label: `${opName}: ${sig(opLossDb, 4)} dB` });
  const ys = [...pts, ...approxPts].map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const step = yMax - yMin > 60 ? 20 : 10;
  return buildPlotSvg(series, {
    xlabel: "Range (m)",
    ylabel: "Total link loss (dB)",
    xScale: "log",
    xLimits: { min: lo, max: hi },
    yLimits: { min: Math.floor(yMin / step) * step, max: Math.ceil((yMax + step * 0.6) / step) * step, step },
    width,
    height: Math.round(width * 0.7),
    notes: capped ? ["Grey ends where the approximation would exceed 1."] : undefined,
  });
}

/**
 * True coincidences inside the window and accidental coincidences against the window width τ (log–log). Accidentals
 * rise in proportion to τ; true coincidences are flat once the window holds the timing jitter. The accidental line
 * stops where a detector would see more than one count in ten windows (the formula's limit).
 */
export function entRatesSvg(inp: EntInput, res: EntResult, width = WIDTH): string {
  const tauMax = Math.min(inp.tau * 100, MAX_COUNTS_PER_WINDOW / Math.max(res.singlesA, res.singlesB));
  const tauMin = inp.tau / 100;
  const coinc: Array<{ x: number; y: number }> = [];
  const acc: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 120; i++) {
    const t = tauMin * Math.pow(tauMax / tauMin, i / 120);
    coinc.push({ x: t, y: res.coincTotal * capturedFraction(t, inp.jitter) });
    acc.push({ x: t, y: res.singlesA * res.singlesB * t });
  }
  const yFloor = Math.max(1e-300, res.coincTotal * 1e-6);
  const keep = (p: { y: number }): boolean => p.y >= yFloor;
  const series: Series[] = [
    { points: coinc.filter(keep), type: "line", color: "#1f5fa8", label: "True coincidences" },
    { points: acc.filter(keep), type: "line", color: "#c00000", label: "Accidentals" },
    { points: [{ x: inp.tau, y: res.coinc }], type: "scatter", color: "#1f5fa8", label: `C: ${sig(res.coinc)} /s` },
    { points: [{ x: inp.tau, y: res.acc }], type: "scatter", color: "#c00000", label: `A: ${sig(res.acc)} /s` },
  ];
  const all = [...coinc, ...acc].filter(keep).map((p) => p.y);
  const yLo = Math.pow(10, Math.floor(Math.log10(Math.min(...all))));
  const yHi = Math.pow(10, Math.ceil(Math.log10(Math.max(...all) * 3)));
  return buildPlotSvg(series, {
    xlabel: "Coincidence window τ (s)",
    ylabel: "Rate (per second)",
    xScale: "log",
    yScale: "log",
    xLimits: { min: tauMin, max: tauMax },
    yLimits: { min: yLo, max: yHi },
    width,
    height: Math.round(width * 0.7),
    notes: tauMax < inp.tau * 100 ? ["Curves end where a detector sees one count in ten windows."] : undefined,
  });
}

/**
 * BB84 key rate (bit/s, log axis) against channel loss (dB) for the chosen source, the other source as a grey reference,
 * the operating point and the zero-key cutoff as a vertical line. The curve stops just before the cutoff.
 */
export function qkdKeySvg(inp: QkdInput, res: QkdResult, width = WIDTH): string {
  const mu = res.mu ?? 0;
  const otherSource = inp.source === "single" ? "decoy" : "single";
  const cut = res.cutoffDb !== null && res.cutoffDb > 0 ? res.cutoffDb : null;
  const xMax = Math.max(10, Math.ceil(((cut ?? Math.max(inp.lossDb, 40)) * 1.2) / 10) * 10, Math.ceil((inp.lossDb + 5) / 10) * 10);
  // m = null: the decoy reference at its best μ for each loss (golden section per point, 80 steps × 401 points).
  const curve = (src: "single" | "decoy", m: number | null) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 400; i++) {
      const l = (xMax * i) / 400;
      const eta = Math.pow(10, -l / 10) * inp.detEff;
      const y = inp.rate * qkdAt(src, eta, inp.y0, inp.ed, m ?? optimalMu(eta, inp.y0, inp.ed, inp.f), inp.f).perPulse;
      if (y > 0) out.push({ x: l, y });
    }
    return out;
  };
  const main = curve(inp.source, mu);
  const other = curve(otherSource, otherSource === "decoy" ? null : 0);
  const ys = [...main, ...other].map((p) => p.y).concat(res.keyRate > 0 ? [res.keyRate] : []);
  const top = ys.length ? Math.max(...ys) : 1;
  const yHi = Math.pow(10, Math.ceil(Math.log10(top * 3)));
  const yLo = Math.max(yHi * 1e-9, Math.pow(10, Math.floor(Math.log10(Math.min(...main.map((p) => p.y).filter((y) => y > 0), top)))));
  const clip = (pts: Array<{ x: number; y: number }>) => pts.filter((p) => p.y >= yLo);
  const mainLabel = inp.source === "single" ? "Single photons" : `Decoy, μ = ${sig(mu)}`;
  const otherLabel = otherSource === "single" ? "Single photons (ref.)" : "Decoy (ref., best μ)";
  const series: Series[] = [
    { points: clip(other), type: "line", color: "#999999", label: otherLabel },
    { points: clip(main), type: "line", color: "#1f5fa8", label: mainLabel },
  ];
  if (cut !== null && cut <= xMax) series.push({ points: [{ x: cut, y: yLo }, { x: cut, y: yHi }], type: "line", color: "#c00000", label: `Zero key: ${sig(cut, 4)} dB` });
  if (res.keyRate >= yLo) series.push({ points: [{ x: inp.lossDb, y: res.keyRate }], type: "scatter", color: "#000000", label: `Here: ${sig(res.keyRate)} bit/s` });
  const notes: string[] = [];
  if (res.keyRate === 0) notes.push(`No key at ${sig(inp.lossDb, 4)} dB.`);
  if (res.cutoffDb === null) notes.push("No dark counts: the rate falls with loss but never reaches zero.");
  return buildPlotSvg(series, {
    xlabel: "Channel loss (dB)",
    ylabel: "Secret key rate (bit/s)",
    yScale: "log",
    xLimits: { min: 0, max: xMax },
    yLimits: { min: yLo, max: yHi },
    width,
    height: Math.round(width * 0.7),
    notes: notes.length ? notes : undefined,
  });
}
