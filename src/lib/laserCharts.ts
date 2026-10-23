// Figures for the Release E laser calculators (laserPhysics.ts): the Fabry–Pérot Airy transmission against frequency
// (three orders on a log axis, and one resonance zoomed with its FWHM), output power against pump with the threshold,
// the degree of coherence against path difference with the 1/e and 1/2 levels, and second-harmonic growth along the
// crystal (phase-matched, quasi-phase-matched, not matched) with the sinc² phase-matching curve.
// Colours are literal hex (inserted artwork never follows the pane's theme); Arial, as engCharts2026.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { C_LIGHT } from "./optics";
import { coherence, coherenceDegree, fpTransmission, outputPower, shgGrowth, sinc2, SINC2_HALF_X, type FabryPerotResult, type LineShape } from "./laserPhysics";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const BLACK = "#000000";
const ORANGE = "#d46a00";

/** 4 significant figures, trailing zeros dropped (a label, not a measurement). */
export const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** The SI prefix that puts |v| in [1, 1000): factor and symbol. */
export function scaleFor(v: number, unit: string): { f: number; u: string } {
  const P: Array<[number, string]> = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
  const a = Math.abs(v);
  for (const [f, p] of P) if (a >= f * 0.9995) return { f, u: p + unit };
  return { f: 1e-15, u: "f" + unit };
}
/** A value with its best SI prefix: "4.795 MHz". */
export const withPrefix = (v: number, unit: string, n = 4): string => {
  const s = scaleFor(v, unit);
  return `${sig(v / s.f, n)} ${s.u}`;
};

const W = 460;
const H = Math.round(W * 0.66);

// ---------------------------------------------------------------------------------------------------------------
// Fabry–Pérot
// ---------------------------------------------------------------------------------------------------------------

/** Detunings for −span…+span FSR: a uniform grid plus dense points within ±8 FWHM of every resonance (exactly on each). */
function fpGrid(fsr: number, fwhm: number, span: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i <= 600; i++) xs.push(-span * fsr + (2 * span * fsr * i) / 600);
  for (let m = Math.ceil(-span); m <= Math.floor(span); m++) {
    const c = m * fsr;
    const w = Math.min(8 * fwhm, 0.45 * fsr);
    for (let i = -120; i <= 120; i++) xs.push(c + (w * i) / 120);
  }
  return xs.sort((a, b) => a - b);
}

/** Transmission over three orders on a log axis (the FSR between peaks, the contrast between them). */
export function fpAiryChartSvg(R1: number, R2: number, r: FabryPerotResult): string {
  const span = 1.5;
  const sc = scaleFor(r.fsr, "Hz");
  const pts = fpGrid(r.fsr, r.linewidth, span).map((d) => ({ x: d / sc.f, y: fpTransmission(R1, R2, r.fsr, d) }));
  const tMin = Math.min(...pts.map((p) => p.y));
  const series: Series[] = [
    { points: pts, type: "line", color: BLUE, label: `T, F = ${sig(r.finesse)}` },
    { points: [-1, 0, 1].map((m) => ({ x: (m * r.fsr) / sc.f, y: r.peakT })), type: "scatter", color: RED, label: `FSR = ${withPrefix(r.fsr, "Hz")}` },
  ];
  const log = tMin < 0.05 * r.peakT;
  return buildPlotSvg(series, {
    xlabel: `Detuning from a resonance (${sc.u})`,
    ylabel: "Transmission T",
    yScale: log ? "log" : "linear",
    xLimits: { min: -span * r.fsr / sc.f, max: span * r.fsr / sc.f },
    yLimits: log ? { min: Math.pow(10, Math.floor(Math.log10(tMin * 0.8))), max: 2 } : { min: 0, max: r.peakT * 1.12 },
    width: W,
    height: H,
  });
}

/**
 * One resonance, linear axes, the half-maximum line and the FWHM. The width drawn is the EXACT Airy FWHM, FSR/F_Airy,
 * which is where the curve crosses half its peak; the approximate FSR/F would miss the curve at low finesse. With no
 * half maximum (R₁R₂ ≤ 0.0294) no width is drawn.
 */
export function fpPeakChartSvg(R1: number, R2: number, r: FabryPerotResult): string {
  const exact = r.finesseExact === null ? null : r.fsr / r.finesseExact;
  const w = Math.min(4 * (exact ?? r.linewidth), 0.5 * r.fsr);
  const sc = scaleFor(w, "Hz");
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = -300; i <= 300; i++) {
    const d = (w * i) / 300;
    pts.push({ x: d / sc.f, y: fpTransmission(R1, R2, r.fsr, d) });
  }
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: "T" }];
  if (exact !== null) {
    const half = r.peakT / 2;
    const hw = exact / 2 / sc.f;
    series.push(
      { points: [{ x: -hw, y: half }, { x: hw, y: half }], type: "line", color: RED, label: `FWHM ${withPrefix(exact, "Hz")}` },
      { points: [{ x: -hw, y: half }, { x: hw, y: half }], type: "scatter", color: RED },
    );
  }
  return buildPlotSvg(series, {
    xlabel: `Detuning (${sc.u})`,
    ylabel: "Transmission T",
    xLimits: { min: -w / sc.f, max: w / sc.f },
    yLimits: { min: 0, max: r.peakT * 1.12 },
    width: W,
    height: H,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------------------------------------------

/** Output power against pump: zero to threshold, slope η_s above it; the operating point when given. */
export function thresholdChartSvg(etaS: number, Pth: number, Pp: number | null): string {
  const pMax = Math.max(3 * Pth, Pp !== null ? 1.25 * Pp : 0);
  const sx = scaleFor(pMax, "W");
  const sy = scaleFor(Math.max(outputPower(etaS, pMax, Pth), 1e-300), "W");
  const curve = [
    { x: 0, y: 0 },
    { x: Pth / sx.f, y: 0 },
    { x: pMax / sx.f, y: outputPower(etaS, pMax, Pth) / sy.f },
  ];
  const series: Series[] = [
    { points: curve, type: "line", color: BLUE, label: `slope ηₛ = ${sig(etaS * 100, 3)} %` },
    { points: [{ x: Pth / sx.f, y: 0 }], type: "scatter", color: BLACK, label: `threshold ${withPrefix(Pth, "W")}` },
  ];
  if (Pp !== null) series.push({ points: [{ x: Pp / sx.f, y: outputPower(etaS, Pp, Pth) / sy.f }], type: "scatter", color: RED, label: `at ${withPrefix(Pp, "W")} pump` });
  return buildPlotSvg(series, {
    xlabel: `Pump power (${sx.u})`,
    ylabel: `Output power (${sy.u})`,
    xLimits: { min: 0, max: pMax / sx.f },
    yLimits: { min: 0, max: (outputPower(etaS, pMax, Pth) / sy.f) * 1.08 },
    width: W,
    height: H,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Coherence
// ---------------------------------------------------------------------------------------------------------------

/**
 * |γ| against optical path difference for the chosen line (and the other shape of the same FWHM, grey), 1/e and 1/2,
 * with the chosen line's crossings taken from coherence() itself so the marks always sit on the curve.
 */
export function coherenceChartSvg(shape: LineShape, dnu: number): string {
  const c = coherence(shape, dnu);
  const L1e = c.ok ? c.L1e : NaN;
  const LHalf = c.ok ? c.LHalf : NaN;
  const other: LineShape = shape === "lorentzian" ? "gaussian" : "lorentzian";
  const xMax = 2.2 * Math.max(L1e, (C_LIGHT * 2 * Math.sqrt(Math.LN2)) / (Math.PI * dnu));
  const sc = scaleFor(xMax, "m");
  const mk = (s: LineShape) => {
    const p: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 300; i++) {
      const x = (xMax * i) / 300;
      p.push({ x: x / sc.f, y: coherenceDegree(s, dnu, x / C_LIGHT) });
    }
    return p;
  };
  const name = (s: LineShape) => (s === "lorentzian" ? "Lorentzian" : "Gaussian");
  const series: Series[] = [
    { points: mk(shape), type: "line", color: BLUE, label: `${name(shape)}, ${withPrefix(dnu, "Hz", 3)}` },
    { points: mk(other), type: "line", color: GREY, label: `${name(other)}, same FWHM` },
    { points: [{ x: 0, y: Math.exp(-1) }, { x: xMax / sc.f, y: Math.exp(-1) }], type: "line", color: GREEN, label: "|γ| = 1/e" },
    { points: [{ x: 0, y: 0.5 }, { x: xMax / sc.f, y: 0.5 }], type: "line", color: ORANGE, label: "|γ| = 1/2" },
    { points: [{ x: L1e / sc.f, y: Math.exp(-1) }, { x: LHalf / sc.f, y: 0.5 }], type: "scatter", color: RED, label: `${name(shape)} crossings` },
  ];
  return buildPlotSvg(series, {
    xlabel: `Optical path difference (${sc.u})`,
    ylabel: "Degree of coherence |γ|",
    xLimits: { min: 0, max: xMax / sc.f },
    yLimits: { min: 0, max: 1.05 },
    width: W,
    height: H,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Second-harmonic generation
// ---------------------------------------------------------------------------------------------------------------

/** SH intensity along the crystal over six coherence lengths, in units of the matched value at z = ℓ_c (Hum & Fejer Fig. 1). */
export function shgGrowthChartSvg(adk: number, lc: number): string {
  const zMax = 6 * lc;
  const g = shgGrowth(adk, zMax, 361);
  const sc = scaleFor(zMax, "m");
  const series: Series[] = [
    { points: g.map((p) => ({ x: p.z / sc.f, y: p.perfect })), type: "line", color: BLACK, label: "phase-matched (Δk = 0)" },
    { points: g.map((p) => ({ x: p.z / sc.f, y: p.qpm })), type: "line", color: BLUE, label: "QPM, first order" },
    { points: g.map((p) => ({ x: p.z / sc.f, y: p.none })), type: "line", color: RED, label: "not phase-matched" },
    { points: [{ x: lc / sc.f, y: 4 / (Math.PI * Math.PI) }], type: "scatter", color: GREY, label: `ℓc = ${withPrefix(lc, "m")}` },
  ];
  return buildPlotSvg(series, {
    xlabel: `Distance into the crystal z (${sc.u})`,
    ylabel: "Relative SH intensity",
    xLimits: { min: 0, max: zMax / sc.f },
    yLimits: { min: 0, max: 38 },
    width: W,
    height: H,
  });
}

/** sinc²(ΔkL/2) against ΔkL/2, the half-maximum and this crystal's operating point (or a note when it is off the axis). */
export function shgSincChartSvg(dkRes: number, L: number): string {
  const xMax = 3 * Math.PI;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = -600; i <= 600; i++) {
    const x = (xMax * i) / 600;
    pts.push({ x, y: sinc2(x) });
  }
  const xOp = (dkRes * L) / 2;
  const series: Series[] = [
    { points: pts, type: "line", color: BLUE, label: "sinc²(ΔkL/2)" },
    { points: [{ x: -SINC2_HALF_X, y: 0.5 }, { x: SINC2_HALF_X, y: 0.5 }], type: "line", color: ORANGE, label: "half maximum" },
  ];
  const notes: string[] = [];
  if (Math.abs(xOp) <= xMax) series.push({ points: [{ x: xOp, y: sinc2(xOp) }], type: "scatter", color: RED, label: "this crystal" });
  else notes.push(`This crystal: ΔkL/2 = ${sig(xOp, 4)} rad, off the axis (sinc² = ${sig(sinc2(xOp), 3)}).`);
  return buildPlotSvg(series, {
    xlabel: "Phase mismatch ΔkL/2 (rad)",
    ylabel: "Relative SH efficiency",
    xLimits: { min: -xMax, max: xMax },
    yLimits: { min: 0, max: 1.08 },
    width: W,
    height: H,
    notes,
  });
}
