// Figures for the Release E semiconductor calculators (semiconductor.ts): junction capacitance against reverse bias,
// the forward diode characteristic on a semilog axis, the MOSFET output (I_D–V_DS) family with the saturation edge,
// and the Fermi level against doping. Colours literal hex; Arial through plot.ts (as engCharts2026.ts).

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { cjAt, degeneracyLimit, fermiFromNet, mosId, MAX_EXPONENT } from "./semiconductor";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREY = "#888888";
const FAMILY = ["#9ecae1", "#4a90c8", "#1f5fa8", "#08306b"];
const W = 460;
const H = Math.round(W * 0.66);

/** 3–4 significant figures, trailing zeros dropped (a label, not a measurement). */
const sig = (v: number, n = 3): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** 1, 2, 5 × 10ⁿ at or above v. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v * (1 - 1e-12)) return m * e;
  return 10 * e;
}

/** An axis top and tick step for data reaching v: a 1–2–2.5–5 step giving at most six intervals, top on a tick. */
function axisTop(v: number): { max: number; step: number } {
  if (!(v > 0)) return { max: 1, step: 0.2 };
  const step = niceCeil(v / 6);
  return { max: Math.ceil(v / step - 1e-9) * step, step };
}

/** A current with its prefix chosen for the axis: A, mA, µA, nA, pA. */
function currentScale(maxA: number): { f: number; u: string } {
  for (const [f, u] of [[1, "A"], [1e-3, "mA"], [1e-6, "µA"], [1e-9, "nA"]] as Array<[number, string]>) if (maxA >= f * 0.9995) return { f, u };
  return { f: 1e-12, u: "pA" };
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Junction capacitance per area (nF/cm²; 1 F/m² = 10⁵ nF/cm²) against reverse bias from 0 to a round voltage at
 * least twice the bias of interest (≥ 5 V), the operating point marked.
 */
export function cvChartSvg(j: { na: number; nd: number; epsR: number }, vbi: number, vr: number): string {
  const vmax = niceCeil(Math.max(5, 2 * vr));
  const pts: Array<{ x: number; y: number }> = [];
  // Quadratic spacing: C′ falls fastest near zero bias, so the samples crowd there.
  for (let i = 0; i <= 160; i++) {
    const v = vmax * (i / 160) * (i / 160);
    pts.push({ x: v, y: cjAt(j, vbi, v) * 1e5 });
  }
  const c = cjAt(j, vbi, vr) * 1e5;
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: "C′ (abrupt junction)" }];
  // At zero bias the point IS the curve's left end, and a marker on the frame edge is half cut away: left out.
  if (vr > 0.02 * vmax) series.push({ points: [{ x: vr, y: c }], type: "scatter", color: RED, label: "Operating point" });
  return buildPlotSvg(series, {
    xlabel: "Reverse bias VR (V)",
    ylabel: "Capacitance per area (nF/cm²)",
    xLimits: { min: 0, max: vmax },
    yLimits: { min: 0, ...axisTop(pts[0].y * 1.04) },
    width: W,
    height: H,
  });
}

/**
 * The forward Shockley characteristic on a semilog current axis (a straight line of n·Vₜ·ln 10 per decade), from a
 * small forward bias to past the bias of interest, the point marked when it is forward. A reverse point (I ≈ −Iₛ)
 * cannot sit on a log axis, and a note says so.
 */
export function ivChartSvg(is: number, n: number, vt: number, v: number): string {
  const nvt = n * vt;
  const v1mA = nvt * Math.log1p(1e-3 / is);
  let vhi = v > 0 ? Math.max(1.15 * v, v + 0.1) : Math.max(v1mA, 4 * nvt);
  vhi = Math.min(vhi, 0.98 * MAX_EXPONENT * nvt);
  // At most twelve decades of current below the top: a textbook semilog plot, not a wall of tick labels.
  let vlo = Math.max(Math.min(2 * nvt, vhi / 10), vhi - 12 * Math.LN10 * nvt);
  // A very small forward bias stays on the axis.
  if (v > 0) vlo = Math.min(vlo, v / 2);
  const xStep = niceCeil((vhi - vlo) / 5);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 200; i++) {
    const x = vlo + ((vhi - vlo) * i) / 200;
    pts.push({ x, y: is * Math.expm1(x / nvt) });
  }
  const iTop = pts[pts.length - 1].y;
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: `Ideal diode, n = ${sig(n)}` }];
  const notes: string[] = [];
  if (v > 0) series.push({ points: [{ x: v, y: is * Math.expm1(v / nvt) }], type: "scatter", color: RED, label: `${sig(v)} V: ${sig(is * Math.expm1(v / nvt))} A` });
  else notes.push(`At ${sig(v)} V the diode is reverse biased (I = ${sig(is * Math.expm1(v / nvt))} A, about −Iₛ); a log axis shows forward current only.`);
  const lo = Math.pow(10, Math.floor(Math.log10(pts[0].y)));
  const hi = Math.pow(10, Math.ceil(Math.log10(iTop)));
  return buildPlotSvg(series, {
    xlabel: "Forward bias V (V)",
    ylabel: "Current I (A)",
    yScale: "log",
    xLimits: { min: Math.floor(vlo / xStep) * xStep, max: Math.ceil(vhi / xStep - 1e-9) * xStep },
    yLimits: { min: lo, max: hi },
    notes: notes.length ? notes : undefined,
    width: W,
    height: Math.round(W * 0.7),
  });
}

/**
 * The output family: I_D against V_DS at four gate drives (¼, ½, ¾ and 1 × the operating overdrive), the edge of
 * saturation V_DS = V_ov in grey, and the operating point. In cutoff the family is drawn at overdrives of 0.25–1 V
 * and a note says the device itself carries no current.
 */
export function idVdsFamilySvg(beta: number, vth: number, vgs: number, vds: number, lambda: number): string {
  const vovOp = vgs - vth;
  const cutoff = vovOp <= 0;
  const top = cutoff ? 1 : vovOp;
  const vovs = [0.25, 0.5, 0.75, 1].map((k) => k * top);
  const xmax = niceCeil(Math.max(1.5 * vds, 1.5 * top));
  const idMax = mosId(beta, top, xmax, lambda);
  const sc = currentScale(idMax);
  const series: Series[] = [];
  vovs.forEach((vov, i) => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 120; k++) {
      const x = (xmax * k) / 120;
      pts.push({ x, y: mosId(beta, vov, x, lambda) / sc.f });
    }
    series.push({ points: pts, type: "line", color: FAMILY[i], label: `VGS = ${sig(vth + vov, 4)} V` });
  });
  const edge: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= 60; k++) {
    const x = (top * k) / 60;
    edge.push({ x, y: mosId(beta, x, x, lambda) / sc.f });
  }
  series.push({ points: edge, type: "line", color: GREY, label: "Saturation edge" });
  if (!cutoff) series.push({ points: [{ x: vds, y: mosId(beta, vovOp, vds, lambda) / sc.f }], type: "scatter", color: RED, label: "Operating point" });
  return buildPlotSvg(series, {
    xlabel: "Drain–source voltage VDS (V)",
    ylabel: `Drain current ID (${sc.u})`,
    xLimits: { min: 0, max: xmax },
    yLimits: { min: 0, ...axisTop((idMax / sc.f) * 1.04) },
    notes: cutoff ? [`VGS = ${sig(vgs)} V is at or below Vth = ${sig(vth)} V: the device is off (ID = 0). The family shows overdrives of 0.25–1 V.`] : undefined,
    width: W,
    height: Math.round(W * 0.72),
  });
}

/**
 * E_F − Eᵢ against dopant density (log axis) for donors (above Eᵢ) and acceptors (below), the sample marked at its
 * net doping. Each curve stops where E_F comes within 3kT of its band edge when Nc / Nv are known.
 */
export function fermiChartSvg(ni: number, vt: number, net: number, nc: number | null, nv: number | null): string {
  const lo = Math.pow(10, Math.floor(Math.log10(ni)));
  const want = Math.max(Math.abs(net) * 10, ni * 1e8, nc !== null ? degeneracyLimit(nc) : 0, nv !== null ? degeneracyLimit(nv) : 0);
  const hi = Math.pow(10, Math.ceil(Math.log10(want)));
  const curve = (sign: 1 | -1, limit: number | null) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 200; i++) {
      const x = lo * Math.pow(hi / lo, i / 200);
      const maj = x / 2 + Math.hypot(x / 2, ni);
      if (limit !== null && maj > degeneracyLimit(limit)) break;
      out.push({ x, y: fermiFromNet(sign * x, ni, vt) });
    }
    return out;
  };
  const series: Series[] = [
    { points: curve(1, nc), type: "line", color: BLUE, label: "Donors (n-type)" },
    { points: curve(-1, nv), type: "line", color: "#2e7d32", label: "Acceptors (p-type)" },
  ];
  const notes: string[] = [];
  if (net !== 0) series.push({ points: [{ x: Math.abs(net), y: fermiFromNet(net, ni, vt) }], type: "scatter", color: RED, label: `Sample: ${sig(fermiFromNet(net, ni, vt))} eV` });
  else notes.push("Net doping is zero: the sample is intrinsic (EF = Ei).");
  if (nc !== null || nv !== null) notes.push("Curves end where EF comes within 3kT of a band edge (degenerate).");
  const ys = series.flatMap((s) => s.points.map((p) => Math.abs(p.y)));
  const ymax = Math.ceil(Math.max(...ys) * 10 + 0.5) / 10;
  return buildPlotSvg(series, {
    xlabel: "Net dopant density (cm⁻³)",
    ylabel: "EF − Ei (eV)",
    xScale: "log",
    xLimits: { min: lo, max: hi },
    yLimits: { min: -ymax, max: ymax },
    notes: notes.length ? notes : undefined,
    width: W,
    height: Math.round(W * 0.7),
  });
}
