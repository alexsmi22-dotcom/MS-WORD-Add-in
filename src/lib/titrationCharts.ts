// Figures for the titration, speciation, solution-pH and cyclic-voltammetry calculators (titrationCalcs.ts).
// Every figure is built by plot.ts (buildPlotSvg) and stacked with combineSvgs; colours are literal hex, as for
// every inserted figure. No number is computed here that the engines do not already return.

import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import { fmtSig } from "./axis";
import { fractions, bufferCapacity, speciesLabel, type SolutionSpec, type TitrationResult } from "./titration";
import type { CvSim, RsAnalysis } from "./electrochem";

const W = 420;
const H = 269;
const BLACK = "#000000";
const RED = "#c00000";
const BLUE = "#1f5fbf";
const GREY = "#777777";
/** Species colours, colour-blind-safe ordering (Okabe–Ito). */
const SPECIES = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9"];

export interface Composite {
  svg: string;
  width: number;
  height: number;
}

/** pH against titrant volume with the equivalence points, over dpH/dV; a measured curve overlaid when given. */
export function titrationCurveSvg(
  res: TitrationResult,
  opts: { measured?: Array<[number, number]>; at?: { V: number; pH: number } | null; acid: boolean } = { acid: true },
): Composite {
  if (res.curve.length > 5000 || (opts.measured?.length ?? 0) > 2000) throw new Error("too many points for one figure");
  const pts = res.curve.map((p) => ({ x: p.V, y: p.pH }));
  const top: Series[] = [{ points: pts, type: "line", color: BLACK, label: "exact pH" }];
  top.push({ points: res.breaks.map((b) => ({ x: b.Veq, y: b.pHeq })), type: "scatter", color: RED, label: "equivalence points" });
  if (opts.at) top.push({ points: [{ x: opts.at.V, y: opts.at.pH }], type: "scatter", color: GREY, label: "your volume" });
  if (opts.measured?.length) top.push({ points: opts.measured.map(([x, y]) => ({ x, y })), type: "scatter", color: BLUE, label: "measured" });
  const p1 = buildPlotSvg(top, { xlabel: "Titrant volume (mL)", ylabel: "pH", width: W, height: H });
  const sl = res.curve.map((p) => ({ x: p.V, y: Math.abs(p.slope) }));
  const bottom: Series[] = [{ points: sl, type: "line", color: BLACK, label: "exact |dpH/dV|" }];
  const slopeAt = (V: number): number => {
    // The curve carries an exact point at every equivalence volume (titrate adds them).
    let best = res.curve[0];
    for (const p of res.curve) if (Math.abs(p.V - V) < Math.abs(best.V - V)) best = p;
    return Math.abs(best.slope);
  };
  bottom.push({ points: res.breaks.map((b) => ({ x: b.Veq, y: slopeAt(b.Veq) })), type: "scatter", color: RED, label: "equivalence points" });
  const m = opts.measured ?? [];
  if (m.length >= 2) {
    const d: Array<{ x: number; y: number }> = [];
    for (let i = 1; i < m.length; i++) d.push({ x: (m[i][0] + m[i - 1][0]) / 2, y: Math.abs((m[i][1] - m[i - 1][1]) / (m[i][0] - m[i - 1][0])) });
    bottom.push({ points: d, type: "scatter", color: BLUE, label: "measured |ΔpH/ΔV|" });
  }
  const p2 = buildPlotSvg(bottom, { xlabel: "Titrant volume (mL)", ylabel: "|dpH/dV| (pH per mL)", width: W, height: H });
  return combineSvgs([p1, p2]);
}

/** Species fractions against pH, 0 to pKw; a pH of interest marked. */
export function speciationSvg(pKa: number[], base: boolean, pKw: number, mark?: number | null): string {
  const n = pKa.length;
  const N = 281;
  const series: Series[] = [];
  const rows: number[][] = [];
  for (let i = 0; i < N; i++) rows.push(fractions(pKa, (pKw * i) / (N - 1)));
  // Most protonated first, as a distribution diagram reads left to right.
  for (let k = n; k >= 0; k--) {
    series.push({
      points: rows.map((f, i) => ({ x: (pKw * i) / (N - 1), y: f[k] })),
      type: "line",
      color: SPECIES[(n - k) % SPECIES.length],
      label: speciesLabel(k, n, base),
    });
  }
  if (mark !== undefined && mark !== null && Number.isFinite(mark)) {
    const f = fractions(pKa, mark);
    series.push({ points: f.map((y) => ({ x: mark, y })), type: "scatter", color: BLACK, label: `pH ${fmtSig(mark, 3)}` });
  }
  return buildPlotSvg(series, { xlabel: "pH", ylabel: "Fraction α", width: W, height: H });
}

/** Buffer capacity β against pH for a solution's fixed totals, its own pH marked. */
export function bufferCapacitySvg(s: SolutionSpec, pH: number): string {
  const N = 281;
  const pKw = -Math.log10(s.Kw);
  const pts = Array.from({ length: N }, (_, i) => {
    const x = (pKw * i) / (N - 1);
    return { x, y: bufferCapacity(s, x) * 1000 };
  });
  return buildPlotSvg(
    [
      { points: pts, type: "line", color: BLACK, label: "β at these totals" },
      { points: [{ x: pH, y: bufferCapacity(s, pH) * 1000 }], type: "scatter", color: RED, label: "this solution" },
    ],
    { xlabel: "pH", ylabel: "β (mM per pH unit)", width: W, height: H, yScale: "log" },
  );
}

/** A current unit that keeps the largest magnitude between 1 and 1000: A, mA, µA, nA or pA. */
export function currentUnit(maxAbsA: number): { scale: number; unit: string } {
  const units: Array<[number, string]> = [[1, "A"], [1e3, "mA"], [1e6, "µA"], [1e9, "nA"], [1e12, "pA"]];
  for (const [scale, unit] of units) if (maxAbsA * scale >= 1) return { scale, unit };
  return { scale: 1e12, unit: "pA" };
}

/** ip against √v: the Randles–Ševčík line (through the origin), with the requested scan rates on it. */
export function rsLineSvg(rates: number[], ipA: number[]): string {
  if (rates.length > 50) throw new Error("at most 50 scan rates");
  const xs = rates.map(Math.sqrt);
  const xMax = Math.max(...xs);
  const slope = ipA[0] / xs[0];
  const { scale, unit } = currentUnit(Math.max(...ipA.map(Math.abs)));
  return buildPlotSvg(
    [
      { points: [{ x: 0, y: 0 }, { x: xMax * 1.05, y: slope * xMax * 1.05 * scale }], type: "line", color: BLACK, label: "Randles–Ševčík" },
      { points: xs.map((x, i) => ({ x, y: ipA[i] * scale })), type: "scatter", color: RED, label: "your scan rates" },
    ],
    { xlabel: "√(v / V s⁻¹)", ylabel: `ip (${unit})`, width: W, height: H },
  );
}

/** Simulated reversible voltammograms (one per scan rate, at most six), IUPAC sign convention (anodic positive). */
export function cvSimSvg(sims: Array<{ v: number; sim: CvSim }>): string {
  const shown = sims.slice(0, 6);
  if (shown.some(({ sim }) => sim.E.length > 8001)) throw new Error("too many points for one figure");
  const { scale, unit } = currentUnit(Math.max(...shown.map(({ sim }) => Math.max(...sim.i.map(Math.abs)))));
  const series: Series[] = shown.map(({ v, sim }, k) => ({
    points: sim.E.map((E, i) => ({ x: E, y: sim.i[i] * scale })).filter((_, i) => i % 4 === 0 || i === sim.E.length - 1),
    type: "line",
    color: SPECIES[k % SPECIES.length],
    label: `${Number((v * 1000).toPrecision(3))} mV/s`,
  }));
  return buildPlotSvg(series, { xlabel: "E (V)", ylabel: `i (${unit}), anodic positive`, width: W, height: H });
}

/** Measured ip against √v with the least-squares line, over log ip against log v with a slope-½ reference. */
export function rsAnalysisSvg(data: Array<[number, number]>, fit: RsAnalysis, ipScale: number, ipUnit: string): Composite {
  if (data.length > 500) throw new Error("at most 500 pairs");
  const xs = data.map(([v]) => Math.sqrt(v));
  const ys = data.map(([, ip]) => Math.abs(ip) * ipScale);
  const xMax = Math.max(...xs);
  const p1 = buildPlotSvg(
    [
      { points: xs.map((x, i) => ({ x, y: ys[i] })), type: "scatter", color: BLACK, label: "measured" },
      { points: [{ x: 0, y: fit.intercept * ipScale }, { x: xMax * 1.05, y: (fit.intercept + fit.slope * xMax * 1.05) * ipScale }], type: "line", color: RED, label: `fit, ${fit.r2 < 1 && fit.r2.toFixed(4) === "1.0000" ? "R² > 0.9999" : `R² = ${fit.r2.toFixed(4)}`}` },
    ],
    { xlabel: "√(v / V s⁻¹)", ylabel: `|ip| (${ipUnit})`, width: W, height: H },
  );
  const lx = data.map(([v]) => Math.log10(v));
  const ly = data.map(([, ip]) => Math.log10(Math.abs(ip) * ipScale));
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length, my = ly.reduce((a, b) => a + b, 0) / ly.length;
  const lo = Math.min(...lx), hi = Math.max(...lx);
  const p2 = buildPlotSvg(
    [
      { points: lx.map((x, i) => ({ x, y: ly[i] })), type: "scatter", color: BLACK, label: `measured, slope ${fit.logSlope.toFixed(2)}` },
      { points: [{ x: lo, y: my + 0.5 * (lo - mx) }, { x: hi, y: my + 0.5 * (hi - mx) }], type: "line", color: GREY, label: "slope 0.5 (diffusion)" },
      { points: [{ x: lo, y: my + (lo - mx) }, { x: hi, y: my + (hi - mx) }], type: "line", color: BLUE, label: "slope 1 (adsorbed)" },
    ],
    { xlabel: "log₁₀ (v / V s⁻¹)", ylabel: `log₁₀ (|ip| / ${ipUnit})`, width: W, height: H },
  );
  return combineSvgs([p1, p2]);
}
