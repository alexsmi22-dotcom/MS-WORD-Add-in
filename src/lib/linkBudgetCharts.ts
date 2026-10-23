// Figures for the Release E link-budget calculators (linkBudget.ts): received power against distance with the
// sensitivity line, the cumulative noise figure stage by stage, and the BER waterfall with the operating point.
// Colours are literal hex (inserted artwork never follows the pane's theme); Arial through plot.ts, as engCharts2026.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { berOfDb, prAt, APPROX_MAX_BER, C_LIGHT, MODULATIONS, type CascadeRow, type LinkInput, type Modulation } from "./linkBudget";

/** 4 significant figures, trailing zeros dropped (a label, not a measurement). */
const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

const LINK_CHART_WIDTH = 460;

/** A distance with its unit chosen for reading (m or km). */
export function distText(m: number): string {
  return m >= 1000 ? `${sig(m / 1000)} km` : `${sig(m)} m`;
}

/**
 * Received power (dBm) against distance on a log axis — free space falls 20 dB per decade — with the sensitivity as a
 * horizontal line, the design distance marked and, when a sensitivity is given, the free-space range where Pr meets it.
 */
export function linkRangeSvg(inp: LinkInput, prDbm: number, maxRangeM: number | null, width = LINK_CHART_WIDTH): string {
  const lambda = C_LIGHT / inp.fHz;
  const far = Math.max(inp.dM, maxRangeM ?? 0);
  const near = Math.min(inp.dM, maxRangeM ?? Infinity);
  const lo = Math.max(2 * lambda, Math.pow(10, Math.floor(Math.log10(near / 10))));
  const hi = Math.pow(10, Math.ceil(Math.log10(far * 10)));
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const d = lo * Math.pow(hi / lo, i / 120);
    pts.push({ x: d, y: prAt(inp, d) });
  }
  const series: Series[] = [{ points: pts, type: "line", color: "#1f5fa8", label: "Pr, free space" }];
  if (inp.sensDbm !== null)
    series.push({ points: [{ x: lo, y: inp.sensDbm }, { x: hi, y: inp.sensDbm }], type: "line", color: "#c00000", label: `Sensitivity ${sig(inp.sensDbm)} dBm` });
  series.push({ points: [{ x: inp.dM, y: prDbm }], type: "scatter", color: "#000000", label: `${distText(inp.dM)}: ${sig(prDbm)} dBm` });
  if (maxRangeM !== null && inp.sensDbm !== null)
    series.push({ points: [{ x: maxRangeM, y: inp.sensDbm }], type: "scatter", color: "#c00000", label: `Range: ${distText(maxRangeM)}` });
  return buildPlotSvg(series, {
    xlabel: "Distance (m)",
    ylabel: "Received power (dBm)",
    xScale: "log",
    xLimits: { min: lo, max: hi },
    width,
    height: Math.round(width * 0.68),
  });
}

/** The noise figure of stages 1…n after each stage (line), and each stage's own noise figure (markers). */
export function cascadeNfSvg(rows: CascadeRow[], width = LINK_CHART_WIDTH): string {
  const n = rows.length;
  const series: Series[] = [
    { points: rows.map((r) => ({ x: r.n, y: r.cumNfDb })), type: "line", color: "#1f5fa8", label: "Cascade NF to stage" },
    { points: rows.map((r) => ({ x: r.n, y: r.cumNfDb })), type: "scatter", color: "#1f5fa8" },
    { points: rows.map((r) => ({ x: r.n, y: r.nfDb })), type: "scatter", color: "#c00000", label: "Stage's own NF" },
  ];
  const ys = rows.flatMap((r) => [r.cumNfDb, r.nfDb]);
  const top = Math.max(...ys);
  const stepY = top <= 1 ? 0.2 : top <= 2.5 ? 0.5 : top <= 5 ? 1 : top <= 12 ? 2 : top <= 30 ? 5 : top <= 60 ? 10 : 20;
  const step = n <= 12 ? 1 : n <= 24 ? 2 : 5;
  return buildPlotSvg(series, {
    xlabel: "Stage",
    ylabel: "Noise figure (dB)",
    xLimits: { min: 0.5, max: n + 0.5, step },
    yLimits: { min: 0, max: Math.ceil((top * 1.08) / stepY) * stepY || stepY, step: stepY },
    xTickLabel: (v) => (Math.abs(v - Math.round(v)) < 1e-9 && v >= 1 && v <= n ? String(Math.round(v)) : ""),
    notes: n === 1 ? ["One stage: the cascade noise figure is the stage's own."] : undefined,
    width,
    height: Math.round(width * 0.62),
  });
}

/** The floor of the waterfall's BER axis. */
const BER_FLOOR = 1e-10;
/** The axis never extends below this, whatever the point (a 10⁻⁴⁴ point would squash every curve to the top). */
const BER_AXIS_MIN = 1e-16;

/**
 * BER against Eb/N0 (log BER) for the chosen modulation, BPSK as a grey reference when it differs, the operating point
 * and, in the required-Eb/N0 mode, the target BER as a horizontal line. An approximate curve is drawn only where it
 * was checked (Pb ≤ 10⁻¹).
 */
export function berWaterfallSvg(mod: Modulation, point: { ebn0Db: number; ber: number } | null, target: number | null, width = LINK_CHART_WIDTH): string {
  const m = MODULATIONS.find((x) => x.id === mod)!;
  const pointShown = point !== null && point.ber >= 10 * BER_AXIS_MIN;
  const floor = Math.max(BER_AXIS_MIN, Math.min(BER_FLOOR, point && pointShown ? point.ber / 10 : BER_FLOOR, target ? target / 10 : BER_FLOOR));
  const xLo = -2;
  // Right edge: where the curve reaches the floor, but always past the point.
  let xHi = 4;
  while (xHi < 40 && berOfDb(mod, xHi) > floor) xHi += 1;
  if (point && pointShown) xHi = Math.max(xHi, Math.ceil(point.ebn0Db + 2));
  xHi = Math.ceil(xHi / 2) * 2;
  const curve = (md: Modulation, cap: number) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 240; i++) {
      const x = xLo + ((xHi - xLo) * i) / 240;
      const y = berOfDb(md, x);
      if (y >= floor && y <= cap) out.push({ x, y });
    }
    return out;
  };
  const series: Series[] = [];
  if (mod !== "bpsk" && mod !== "qpsk") series.push({ points: curve("bpsk", 0.5), type: "line", color: "#999999", label: "BPSK/QPSK reference" });
  series.push({ points: curve(mod, m.approx ? APPROX_MAX_BER : 0.5), type: "line", color: "#1f5fa8", label: m.label.replace(/ \(.*\)$/, "") + (m.approx ? " (approx.)" : "") });
  if (target !== null) series.push({ points: [{ x: xLo, y: target }, { x: xHi, y: target }], type: "line", color: "#2e7d32", label: `Target BER ${sig(target, 3)}` });
  if (point && pointShown) series.push({ points: [{ x: point.ebn0Db, y: point.ber }], type: "scatter", color: "#c00000", label: `${sig(point.ebn0Db, 3)} dB: ${sig(point.ber, 3)}` });
  return buildPlotSvg(series, {
    xlabel: "Eb/N₀ (dB)",
    ylabel: "Bit error rate",
    yScale: "log",
    xLimits: { min: xLo, max: xHi },
    yLimits: { min: Math.pow(10, Math.floor(Math.log10(floor))), max: 1 },
    width,
    height: Math.round(width * 0.7),
    notes: point && !pointShown ? [`Operating point (${sig(point.ebn0Db, 3)} dB, BER ${point.ber > 0 ? sig(point.ber, 3) : "below 10⁻³⁰⁰"}) lies below the axis.`] : undefined,
  });
}
