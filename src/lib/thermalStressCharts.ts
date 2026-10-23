// Figures for the thermal-stress calculators (Release E, gap #3): the restrained stress against ΔT with the yield
// line, the bimetal curvature against ΔT, the stress through a bimetal's thickness, Stoney's film stress against
// curvature, and the quench stress against ΔT with the strength line (crossing at R). All through buildPlotSvg, so
// axes, ticks, ×10ⁿ multipliers and legends follow the one plotter. Colours are literal hex: inserted artwork never
// follows the pane's theme.

import { buildPlotSvg, type Series, type Point } from "./plot";
import { fmtSig } from "./axis";

export const THERMAL_CHART_WIDTH = 440;
const H = (w: number): number => Math.round(w * 0.64);
const INK = "#000000", RED = "#c00000", GREY = "#777777", BLUE = "#1f4e9c";

/** Plain number for a legend: significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵. */
function lab(v: number, sig = 3): string {
  const a = Math.abs(v);
  if (v === 0) return "0";
  if (a >= 1e-3 && a < 1e5) return fmtSig(v, sig).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return fmtSig(v, sig);
}

/** Evenly spaced points of a straight or piecewise function over [a, b] (n ≤ 201). */
function sample(a: number, b: number, n: number, f: (x: number) => number): Point[] {
  const N = Math.max(2, Math.min(201, Math.round(n)));
  const out: Point[] = [];
  for (let i = 0; i < N; i++) {
    const x = a + ((b - a) * i) / (N - 1);
    out.push({ x, y: f(x) });
  }
  return out;
}

/** The ΔT range drawn: 0…ΔT (or ΔT…0 when cooling); a zero ΔT draws 0…100 K and says so. */
export function sweepRange(dT: number): { lo: number; hi: number; note: string | null } {
  if (dT > 0) return { lo: 0, hi: dT, note: null };
  if (dT < 0) return { lo: dT, hi: 0, note: null };
  return { lo: 0, hi: 100, note: "ΔT = 0: the line is drawn over 0–100 K to show its slope." };
}

/**
 * Restrained stress against ΔT. `sigmaAt` returns Pa; drawn in MPa. The yield line is drawn on the side of the
 * stress (−σ_y under compression), and only when the caller passes one (a hydrostatic state never yields under
 * von Mises or Tresca, so the caller passes null there).
 */
export function restrainedChartSvg(
  sigmaAt: (dT: number) => number,
  dT: number,
  yieldMPa: number | null,
  extraNotes: string[] = [],
  width = THERMAL_CHART_WIDTH,
): string {
  const { lo, hi, note } = sweepRange(dT);
  const line = sample(lo, hi, 201, (x) => sigmaAt(x) / 1e6);
  const yOp = sigmaAt(dT) / 1e6;
  const series: Series[] = [{ points: line, type: "line", color: INK, label: "restrained σ" }];
  if (yieldMPa !== null) {
    // Which side: the side the stress over the drawn range reaches; compression when the line is all ≤ 0.
    const reach = line.reduce((m, p) => (Math.abs(p.y) > Math.abs(m) ? p.y : m), 0);
    const yv = reach < 0 ? -yieldMPa : yieldMPa;
    series.push({ points: [{ x: lo, y: yv }, { x: hi, y: yv }], type: "line", color: RED, label: "yield strength" });
  }
  series.push({ points: [{ x: dT, y: yOp }], type: "scatter", color: BLUE, label: "this ΔT" });
  const notes = [...(note ? [note] : []), ...extraNotes];
  return buildPlotSvg(series, {
    xlabel: "Temperature change ΔT (K)",
    ylabel: "Stress σ (MPa)",
    width,
    height: H(width),
    ...(notes.length ? { notes } : {}),
  });
}

/** Bimetal curvature against ΔT (a straight line through the origin in Timoshenko's model), this ΔT marked. */
export function bilayerKappaChartSvg(kappaPerK: number, dT: number, width = THERMAL_CHART_WIDTH): string {
  const { lo, hi, note } = sweepRange(dT);
  const k = kappaPerK * dT;
  const series: Series[] = [
    { points: sample(lo, hi, 2, (x) => kappaPerK * x), type: "line", color: INK, label: "κ (Timoshenko)" },
    { points: [{ x: dT, y: k }], type: "scatter", color: BLUE, label: "this ΔT" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Temperature change ΔT (K)",
    ylabel: "Curvature κ (m⁻¹)",
    width,
    height: H(width),
    ...(note ? { notes: [note] } : {}),
  });
}

/** The thinnest layer, as a fraction of the total, the through-thickness profile is drawn for (below: a sliver). */
export const PROFILE_MIN_FRACTION = 0.1;

/**
 * The stress through the bimetal's thickness: z from the outer face of layer 2 (z = 0) to the outer face of layer 1
 * (z = h), in mm, with the interface marked. Stresses in MPa; linear within each layer, a jump at the interface.
 */
export function bilayerStressProfileSvg(
  r: { s1Outer: number; s1Interface: number; s2Interface: number; s2Outer: number },
  t1: number,
  t2: number,
  width = THERMAL_CHART_WIDTH,
): string {
  const mm = 1e3, M = 1e-6;
  const zI = t2 * mm, zT = (t1 + t2) * mm;
  const xs = [r.s1Outer, r.s1Interface, r.s2Interface, r.s2Outer].map((v) => v * M);
  let lo = Math.min(0, ...xs), hi = Math.max(0, ...xs);
  if (hi - lo === 0) { lo = -1; hi = 1; }
  const pad = 0.08 * (hi - lo);
  const series: Series[] = [
    { points: [{ x: r.s1Interface * M, y: zI }, { x: r.s1Outer * M, y: zT }], type: "line", color: RED, label: "layer 1" },
    { points: [{ x: r.s2Outer * M, y: 0 }, { x: r.s2Interface * M, y: zI }], type: "line", color: BLUE, label: "layer 2" },
    { points: [{ x: lo - pad, y: zI }, { x: hi + pad, y: zI }], type: "line", color: GREY, label: "interface" },
    { points: [{ x: 0, y: 0 }, { x: 0, y: zT }], type: "line", color: "#bbbbbb" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Stress σ (MPa)",
    ylabel: "Height z (mm)",
    width,
    height: H(width),
    xLimits: { min: lo - pad, max: hi + pad },
    yLimits: { min: 0, max: zT },
  });
}

/** Stoney: film stress against substrate curvature (a line through the origin), the stated point marked. */
export function stoneyChartSvg(factor: number, kappa: number, width = THERMAL_CHART_WIDTH): string {
  const end = kappa !== 0 ? 1.25 * kappa : 1;
  const lo = Math.min(0, end), hi = Math.max(0, end);
  const s = (factor * kappa) / 1e6;
  const series: Series[] = [
    { points: sample(lo, hi, 2, (x) => (factor * x) / 1e6), type: "line", color: INK, label: "Stoney relation" },
    { points: [{ x: kappa, y: s }], type: "scatter", color: BLUE, label: "this film" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Substrate curvature κ (m⁻¹)",
    ylabel: "Film stress (MPa)",
    width,
    height: H(width),
  });
}

/**
 * Thermal shock: the surface stress of a suddenly quenched plate, Eα·ΔT/(1−ν) (the fully restrained, infinite-Biot
 * limit), against ΔT, with the strength σ_f; the lines cross at ΔT = R.
 */
export function thermalShockChartSvg(E: number, alpha: number, nu: number, sf: number, R: number, width = THERMAL_CHART_WIDTH): string {
  const hi = 1.6 * R;
  const sfM = sf / 1e6;
  const series: Series[] = [
    { points: sample(0, hi, 2, (x) => (E * alpha * x) / (1 - nu) / 1e6), type: "line", color: INK, label: "quench stress" },
    { points: [{ x: 0, y: sfM }, { x: hi, y: sfM }], type: "line", color: RED, label: "fracture strength" },
    { points: [{ x: R, y: sfM }], type: "scatter", color: BLUE, label: `R = ${lab(R, 4)} K` },
  ];
  return buildPlotSvg(series, {
    xlabel: "Quench temperature difference ΔT (K)",
    ylabel: "Surface stress (MPa)",
    width,
    height: H(width),
    xLimits: { min: 0, max: hi },
    yLimits: { min: 0 },
  });
}
