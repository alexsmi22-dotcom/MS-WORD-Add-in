// Figures for the compressible-flow calculators (gasDynamics.ts): the normal-shock ratios against M₁, the θ–β–M
// chart, the Prandtl–Meyer function, Fanno's 4f̄L*/D and Rayleigh's T₀/T₀* against M, each with the current state
// marked. Every curve is sampled from the engine's closed forms (no root finding to draw). Colours are literal hex
// (Okabe–Ito): inserted artwork never follows the pane's theme.

import { buildPlotSvg, combineSvgs, type Series, type Point } from "./plot";
import {
  normalShock,
  thetaOfBeta,
  betaAtThetaMax,
  prandtlMeyerNu,
  fannoFLD,
  rayleighState,
  MACH_MAX,
  type NormalShock,
} from "./gasDynamics";

const DEG = 180 / Math.PI;
const BLUE = "#0072B2", VERMILLION = "#D55E00", GREEN = "#009E73", PURPLE = "#CC79A7", ORANGE = "#E69F00", SKY = "#56B4E9";
const GREY = "#888888", BLACK = "#000000";
const W = 400, H = 250;

/** A Mach number for a legend: up to four significant figures, trailing zeros dropped. */
function mStr(M: number): string {
  return String(Number(M.toPrecision(4)));
}

export interface GdFigure {
  svg: string;
  w: number;
  h: number;
}

function sized(svg: string): GdFigure {
  const c = combineSvgs([svg]);
  return { svg: c.svg, w: c.width, h: c.height };
}

function sample(lo: number, hi: number, n: number, f: (x: number) => number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const y = f(x);
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

/** Normal shock: p₂/p₁, ρ₂/ρ₁, T₂/T₁ (log axis) and M₂, p₀₂/p₀₁ against M₁, the given M₁ marked on each curve. */
export function normalShockSvg(M1: number, g: number): GdFigure {
  const hi = Math.min(MACH_MAX, Math.max(5, 1.5 * M1));
  const ns = (M: number): NormalShock | null => {
    const r = normalShock(M, g);
    return r.ok ? r : null;
  };
  const lo = 1.0001;
  const curve = (k: keyof NormalShock): Point[] => sample(lo, hi, 400, (M) => (ns(M)?.[k] as number) ?? NaN);
  const at = ns(M1);
  const mark = (k: keyof NormalShock): Point => ({ x: M1, y: at ? (at[k] as number) : NaN });
  // The plotter's legend draws every entry as a line swatch, so the markers are named in a note, not the legend.
  const notes = [`Black dots: the given M₁ = ${mStr(M1)}.`];
  const a = buildPlotSvg(
    [
      { points: curve("p2p1"), type: "line", color: BLUE, label: "p₂/p₁" },
      { points: curve("rho2rho1"), type: "line", color: VERMILLION, label: "ρ₂/ρ₁" },
      { points: curve("T2T1"), type: "line", color: GREEN, label: "T₂/T₁" },
      { points: [mark("p2p1"), mark("rho2rho1"), mark("T2T1")], type: "scatter", color: BLACK },
    ],
    { width: W, height: H, yScale: "log", xLimits: { min: 1, max: hi }, xlabel: "Upstream Mach number M₁", ylabel: "Static ratio across the shock", title: `(a) Static ratios, γ = ${mStr(g)}`, notes },
  );
  const b = buildPlotSvg(
    [
      { points: curve("M2"), type: "line", color: BLUE, label: "M₂" },
      { points: curve("p02p01"), type: "line", color: VERMILLION, label: "p₀₂/p₀₁" },
      { points: [mark("M2"), mark("p02p01")], type: "scatter", color: BLACK },
    ],
    { width: W, height: H, xLimits: { min: 1, max: hi }, xlabel: "Upstream Mach number M₁", ylabel: "M₂ and p₀₂/p₀₁", title: "(b) Downstream Mach number, total-pressure ratio", yLimits: { min: 0, max: 1 }, notes },
  );
  const c = combineSvgs([a, b]);
  return { svg: c.svg, w: c.width, h: c.height };
}

/** One θ–β curve at Mach M: β from μ to 90°, θ in closed form. */
function thetaBetaCurve(M: number, g: number): Point[] {
  const mu = Math.asin(1 / M);
  const pts: Point[] = [];
  const n = 180;
  for (let i = 0; i <= n; i++) {
    // The last sample is exactly 90° (mu + (90° − mu)·n/n can round a hair above it, off the axis).
    const b = i === n ? Math.PI / 2 : mu + ((Math.PI / 2 - mu) * i) / n;
    const th = i === n ? 0 : Math.max(0, thetaOfBeta(b, M, g));
    pts.push({ x: th * DEG, y: b * DEG });
  }
  return pts;
}

/** The θ–β–M chart: curves for standard Mach numbers and the given M₁, the θmax locus dashed grey, the solution(s) marked. */
export function thetaBetaSvg(M1: number, g: number, sol: { thetaDeg: number; weakDeg: number; strongDeg: number } | null): GdFigure {
  const standard = [1.5, 2, 3, 5, 10];
  const colours = [SKY, GREEN, ORANGE, PURPLE, VERMILLION];
  const series: Series[] = [];
  standard.forEach((M, i) => {
    if (Math.abs(M - M1) < 1e-9) return;
    series.push({ points: thetaBetaCurve(M, g), type: "line", color: colours[i], label: `M = ${mStr(M)}` });
  });
  series.push({ points: thetaBetaCurve(M1, g), type: "line", color: BLUE, label: `M₁ = ${mStr(M1)} (given)` });
  // The θmax locus: (θmax, βmax) for M from just above 1 to the largest Mach number drawn.
  const mTop = Math.max(10, M1);
  const locus: Point[] = [];
  for (let i = 0; i <= 120; i++) {
    const M = 1.0005 * Math.pow(mTop / 1.0005, i / 120);
    const b = betaAtThetaMax(M, g);
    locus.push({ x: thetaOfBeta(b, M, g) * DEG, y: b * DEG });
  }
  series.push({ points: locus, type: "line", color: GREY, label: "θmax locus" });
  // The θ axis reaches past the largest deflection drawn (θmax grows as γ falls: 45.6° at γ = 1.4, 65° at γ = 1.1).
  const thetaTop = Math.max(...series.flatMap((s) => s.points.map((p) => p.x)), sol ? sol.thetaDeg : 0);
  const xMax = Math.max(50, 10 * Math.ceil((thetaTop + 1) / 10));
  const notes: string[] = [];
  if (sol) {
    const one = Math.abs(sol.strongDeg - sol.weakDeg) < 1e-9;
    const pts = one ? [{ x: sol.thetaDeg, y: sol.weakDeg }] : [{ x: sol.thetaDeg, y: sol.weakDeg }, { x: sol.thetaDeg, y: sol.strongDeg }];
    series.push({ points: pts, type: "scatter", color: BLACK });
    notes.push(
      one
        ? `Black dot: θ = ${sol.thetaDeg.toFixed(2)}° = θmax, β = ${sol.weakDeg.toFixed(2)}°.`
        : `Black dots at θ = ${sol.thetaDeg.toFixed(2)}°: weak β = ${sol.weakDeg.toFixed(2)}°, strong β = ${sol.strongDeg.toFixed(2)}°.`,
    );
  }
  return sized(
    buildPlotSvg(series, {
      width: W + 40,
      height: 300,
      xlabel: "Flow deflection θ (°)",
      ylabel: "Shock angle β (°)",
      title: `θ–β–M chart, γ = ${mStr(g)}`,
      xLimits: { min: 0, max: xMax },
      yLimits: { min: 0, max: 90 },
      notes,
    }),
  );
}

/** The Prandtl–Meyer function ν(M) with M₁ and the expanded M₂ marked. */
export function prandtlMeyerSvg(M1: number, M2: number | null, g: number): GdFigure {
  const top = Math.max(M1, M2 ?? M1);
  const hi = Math.min(MACH_MAX, Math.max(5, 1.3 * top));
  const series: Series[] = [
    { points: sample(1, hi, 200, (M) => prandtlMeyerNu(M, g) * DEG), type: "line", color: BLUE, label: `ν(M), γ = ${mStr(g)}` },
    { points: [{ x: M1, y: prandtlMeyerNu(M1, g) * DEG }], type: "scatter", color: BLACK },
  ];
  const notes = [`Black dot: upstream M₁ = ${mStr(M1)}.`];
  if (M2 !== null) {
    series.push({ points: [{ x: M2, y: prandtlMeyerNu(M2, g) * DEG }], type: "scatter", color: VERMILLION });
    notes[0] += ` Red dot: expanded M₂ = ${mStr(M2)}.`;
  }
  return sized(
    buildPlotSvg(series, { width: W, height: H, xlabel: "Mach number M", ylabel: "Prandtl–Meyer angle ν (°)", title: "Prandtl–Meyer function", notes }),
  );
}

/** A state to mark on a duct-flow chart. */
export interface GdMark {
  M: number;
  label: string;
}

/** The markers named (the legend draws only line swatches): black for the first, red for the second. */
function markNote(marks: GdMark[]): string {
  return marks.map((m, i) => `${i === 0 ? "Black" : "Red"} dot: ${m.label}.`).join(" ");
}

/** Fanno: 4f̄L* / D against M (subsonic and supersonic branches), inlet and exit marked. */
export function fannoSvg(g: number, marks: GdMark[]): GdFigure {
  const Ms = marks.map((m) => m.M);
  const fMax = Math.max(3, 1.25 * Math.max(...marks.map((m) => fannoFLD(m.M, g))));
  // A low inlet Mach number makes 4fL*/D large (280 at M 0.05), and a linear axis then flattens every state against
  // the frame: above 20 the axis is logarithmic, the curve drawn down to a floor below the smallest marked state (it
  // is 0 at M = 1, which no logarithmic axis can show).
  const logY = fMax > 20;
  const fTop = logY ? Math.pow(10, Math.ceil(Math.log10(fMax))) : Math.ceil(fMax);
  // The left end: the subsonic Mach number where 4f̄L*/D reaches the top of the axis (bisection, capped).
  let a = 1e-6, b = 1;
  for (let i = 0; i < 100; i++) {
    const m = 0.5 * (a + b);
    if (fannoFLD(m, g) > fTop) a = m;
    else b = m;
  }
  const lo = b;
  const hi = Math.min(MACH_MAX, Math.max(3, 1.3 * Math.max(...Ms)));
  const colours = [BLACK, VERMILLION];
  const markF = marks.map((m) => fannoFLD(m.M, g));
  const positive = markF.filter((v) => v > 0);
  const floor = logY ? Math.pow(10, Math.floor(Math.log10(Math.min(0.01, ...positive.map((v) => v / 2))))) : 0;
  const keep = (pts: Point[]): Point[] => (logY ? pts.filter((p) => p.y >= floor) : pts);
  const series: Series[] = [
    { points: keep(sample(lo, 1, 300, (M) => fannoFLD(M, g))), type: "line", color: BLUE, label: "subsonic branch" },
    { points: keep(sample(1, hi, 300, (M) => fannoFLD(M, g))), type: "line", color: GREEN, label: "supersonic branch" },
    ...marks.map((m, i): Series => ({ points: keep([{ x: m.M, y: markF[i] }]), type: "scatter", color: colours[i % 2] })),
  ];
  const notes = [markNote(marks)];
  if (logY && markF.some((v) => v <= 0)) notes.push("A state at Mach 1 (4fL*/D = 0) lies below the logarithmic axis.");
  return sized(
    buildPlotSvg(series, {
      width: W,
      height: H,
      xlabel: "Mach number M",
      ylabel: "4fL*/D (Fanning f)",
      title: `Fanno line: friction length to choking, γ = ${mStr(g)}`,
      yScale: logY ? "log" : "linear",
      yLimits: { min: floor, max: fTop },
      notes,
    }),
  );
}

/** Rayleigh: T₀/T₀* against M, inlet and exit marked; heating drives both branches toward M = 1. */
export function rayleighSvg(g: number, marks: GdMark[]): GdFigure {
  const hi = Math.min(MACH_MAX, Math.max(3, 1.3 * Math.max(...marks.map((m) => m.M))));
  const colours = [BLACK, VERMILLION];
  const series: Series[] = [
    { points: sample(0, 1, 150, (M) => rayleighState(M, g).T0T0s), type: "line", color: BLUE, label: "subsonic branch" },
    { points: sample(1, hi, 150, (M) => rayleighState(M, g).T0T0s), type: "line", color: GREEN, label: "supersonic branch" },
    ...marks.map((m, i): Series => ({ points: [{ x: m.M, y: rayleighState(m.M, g).T0T0s }], type: "scatter", color: colours[i % 2] })),
  ];
  return sized(
    buildPlotSvg(series, {
      width: W,
      height: H,
      xlabel: "Mach number M",
      ylabel: "T₀/T₀*",
      title: `Rayleigh line: heat addition, γ = ${mStr(g)}`,
      yLimits: { min: 0, max: 1.05 },
      notes: [markNote(marks)],
    }),
  );
}
