// Drives the figure-layout audit over every chart builder we ship.
//
//   npm run check:figures
//
// This file is the CORPUS. The analyser lives in figure-layout-audit.js and the
// runner in check-figures.js; the list is here because the builders are
// TypeScript. Cases are chosen to stress layout rather than to be pretty: long
// labels, many legend entries, values that need wide tick text, and curves that
// sweep through the corners where labels live.
//
// IT USED TO BE INVOKED AS `npx ts-node …`, AND ts-node WAS NOT INSTALLED.
// Offline the gate could not run at all; online it network-installed on every QC
// run. It now loads through scripts/ts-require.js, which uses the `typescript`
// devDependency that is already on disk. No network, no new dependency.
//
// THE CORPUS WAS ENGINEERING-ONLY UNTIL 2026-08-05. It imported mechchart, plot,
// reliability and colourspace — so a Table→Chart, Spectra, heat-map, candlestick,
// sequence-map, beam or periodic-table figure had no geometry gate of any kind.
// check-figures.js now derives the list of SVG-producing modules FROM THE
// FILESYSTEM and fails if any of them is missing from this file's imports, so a
// new chart module cannot be added without a figure landing here.
import {
  mohrCircleSvg,
  goodmanDiagramSvg,
  sectionShapeSvg,
  columnCurveSvg,
  trussSvg,
  torsionProfileSvg,
  npshLadderSvg,
  poleZeroSvg,
  hBarSvg,
  logicWaveSvg,
  powerTriangleSvg,
  gamutTriangleSvg,
  ladderSvg,
  orbitChartSvg,
  vectorTriangleSvg,
  armSvg,
} from "../src/lib/mechchart";
import { buildPlotSvg, Series } from "../src/lib/plot";
import { weibullFit, reliabilityBlock, kOutOfN, redundancy, availability } from "../src/lib/reliability";
import { GAMUTS as GAMUT_DEFS } from "../src/lib/colourspace";
import { boxPlotSvg, forestPlotSvg, groupedBarSvg } from "../src/lib/statchart";
// --- the non-Engineering half, added 2026-08-05 ------------------------------
import { parseTableData, buildChartPreviewSvg, ChartKind } from "../src/lib/tablechart";
import { buildTableFigureSvg } from "../src/lib/tablefigure";
import { buildFlowchartSvg, buildHierarchySvg } from "../src/lib/tablediagram";
import { buildHeatmapSvg } from "../src/lib/heatmap";
import { buildCandlestickSvg } from "../src/lib/candlestick";
import {
  nmrChartSvg,
  irChartSvg,
  msChartSvg,
  cosyChartSvg,
  hsqcChartSvg,
  hmbcChartSvg,
  tocsyChartSvg,
  jcampChartSvg,
} from "../src/lib/spectraChart";
import { predictNmr } from "../src/lib/nmr";
import { predictIr } from "../src/lib/ir";
import { predictFragments } from "../src/lib/fragment";
import { predictCosy, predictHsqc, predictHmbc, predictTocsy } from "../src/lib/nmr2d";
import { beamDiagramSvg } from "../src/lib/beamChart";
import { analyzeBeam, BeamInput, BeamResult, Support, Load } from "../src/lib/beam";
import { Rat, ratInt, ratDiv } from "../src/lib/cas";
import { buildPeriodicTableSvg, buildBohrSvg, buildOrbitalSvg } from "../src/lib/periodicChart";
import { buildLinearMapSvg } from "../src/lib/seqmap";
import { buildCircularMapSvg } from "../src/lib/seqmapcirc";
import { parseGenBank } from "../src/lib/seqio";
import { persistentHomology, barcodeSvg } from "../src/lib/persistence";

const figures: [string, string][] = [];

figures.push([
  "mohr",
  mohrCircleSvg({ sigmaX: 100, sigmaY: 60, tauXY: 30, sigma1: 113.7, sigma2: 46.3, centre: 80, radius: 33.7, unit: "MPa" }),
]);
figures.push([
  "mohr wide",
  mohrCircleSvg({ sigmaX: 1200, sigmaY: -400, tauXY: 500, sigma1: 1300, sigma2: -500, centre: 400, radius: 900, unit: "MPa" }),
]);
figures.push([
  "mohr tiny",
  mohrCircleSvg({ sigmaX: 0.004, sigmaY: 0.002, tauXY: 0.001, sigma1: 0.0044, sigma2: 0.0016, centre: 0.003, radius: 0.0014, unit: "MPa" }),
]);

const gerber = Array.from({ length: 41 }, (_, i) => ({ m: (700 * i) / 40, a: 250 * (1 - (i / 40) ** 2) }));
const asme = Array.from({ length: 41 }, (_, i) => ({ m: (500 * i) / 40, a: 250 * Math.sqrt(Math.max(0, 1 - (i / 40) ** 2)) }));
figures.push([
  "goodman",
  goodmanDiagramSvg({
    sigmaM: 200,
    sigmaA: 100,
    sutMPa: 700,
    seMPa: 250,
    lines: [
      { name: "Modified Goodman", colour: "#2563eb", points: [{ m: 0, a: 250 }, { m: 700, a: 0 }] },
      { name: "Soderberg", colour: "#7c3aed", points: [{ m: 0, a: 250 }, { m: 500, a: 0 }] },
      { name: "Gerber", colour: "#059669", points: gerber },
      { name: "ASME elliptic", colour: "#d97706", points: asme },
      { name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] },
    ],
  }),
]);
figures.push([
  "goodman two-point",
  goodmanDiagramSvg({
    sigmaM: 0,
    sigmaA: 200,
    yieldSigmaM: 400,
    sutMPa: 700,
    seMPa: 250,
    lines: [{ name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] }],
  }),
]);

figures.push([
  "section rect",
  sectionShapeSvg({ name: "Rectangle", strips: [{ b: 100, h: 200, yc: 100, sign: 1 }], depth: 200, yBar: 100, unit: "mm" }),
]);
figures.push([
  "section tee",
  sectionShapeSvg({
    name: "Tee",
    strips: [
      { b: 6, h: 190, yc: 95, sign: 1 },
      { b: 100, h: 10, yc: 195, sign: 1 },
    ],
    depth: 200,
    yBar: 150,
    unit: "mm",
  }),
]);
figures.push(["section circle", sectionShapeSvg({ name: "Solid circle", strips: [], depth: 100, yBar: 50, circle: { d: 100 }, unit: "mm" })]);

figures.push(["column", columnCurveSvg({ E: 200e9, Fy: 250e6, slenderness: 95, sigmaCritical: 1.9e8, transition: 125 })]);
figures.push(["column no yield", columnCurveSvg({ E: 200e9, Fy: null, slenderness: 200, sigmaCritical: 4.9e7, transition: null })]);

figures.push([
  "truss",
  trussSvg(
    [
      { name: "A", x: 0, y: 0 },
      { name: "B", x: 4, y: 0 },
      { name: "C", x: 2, y: 2 },
    ],
    [
      { a: "A", b: "B", force: -30 },
      { a: "A", b: "C", force: 42 },
      { a: "B", b: "C", force: 0 },
    ],
  ),
]);
figures.push([
  "truss flat",
  trussSvg(
    [
      { name: "A", x: 0, y: 0 },
      { name: "B", x: 10, y: 0 },
      { name: "C", x: 5, y: 0.4 },
    ],
    [
      { a: "A", b: "B", force: -100 },
      { a: "A", b: "C", force: 60 },
    ],
  ),
]);

figures.push(["torsion", torsionProfileSvg(40, 20, 95, "MPa", "mm")]);
figures.push(["torsion solid", torsionProfileSvg(40, 0, 95, "MPa", "mm")]);

// The general plotter, on the shapes the Thermal release uses.
figures.push([
  "plot hx profile",
  buildPlotSvg(
    [
      { points: Array.from({ length: 61 }, (_, i) => ({ x: i / 60, y: 150 - i })), type: "line", color: "#b91c1c", label: "hot" },
      { points: Array.from({ length: 61 }, (_, i) => ({ x: i / 60, y: 70 - (40 * i) / 60 })), type: "line", color: "#2563eb", label: "cold" },
    ],
    { width: 380, height: 250, xlabel: "Fraction along the exchanger", ylabel: "Temperature (deg C)", title: "Counterflow temperature profile" },
  ),
]);
const ntuSeries: Series[] = ["counter", "parallel", "crossboth", "shell"].map((f, i) => ({
  points: Array.from({ length: 121 }, (_, j) => ({ x: (j * 6) / 120, y: 100 * (1 - Math.exp(-(j * 6) / 120)) * (1 - i * 0.1) })),
  type: "line" as const,
  color: ["#2563eb", "#b91c1c", "#059669", "#d97706"][i],
  label: f,
}));
ntuSeries.push({ points: [{ x: 2, y: 66.7 }], type: "scatter", color: "#111111", label: "this exchanger" });
figures.push([
  "plot ntu",
  buildPlotSvg(ntuSeries, { width: 380, height: 260, xlabel: "NTU = U*A / Cmin", ylabel: "Effectiveness (%)", title: "Effectiveness vs NTU at Cr = 0.75" }),
]);
figures.push([
  "plot cooling",
  buildPlotSvg(
    [
      { points: Array.from({ length: 81 }, (_, i) => ({ x: i * 10, y: 25 + 175 * Math.exp((-i * 10) / 202) })), type: "line", color: "#2563eb", label: "body" },
      { points: [{ x: 0, y: 25 }, { x: 800, y: 25 }], type: "line", color: "#888888", label: "ambient" },
    ],
    { width: 380, height: 250, xlabel: "Time (s)", ylabel: "Temperature (deg C)", title: "Cooling curve, tau = 202 s" },
  ),
]);
figures.push([
  "plot big numbers",
  buildPlotSvg(
    [{ points: Array.from({ length: 40 }, (_, i) => ({ x: i * 1e5, y: i * 1.234e7 })), type: "line", color: "#2563eb", label: "a very long series label indeed" }],
    { width: 380, height: 250, xlabel: "A rather long x axis label", ylabel: "A rather long y axis label", title: "A title that is also quite long" },
  ),
]);

// The Reliability release. These are built FROM THE ENGINES rather than from
// hand-made points, because the layout hazards here come from what the engines
// actually produce: a probability plot whose y axis is ln(-ln(1-F)) and runs
// negative, availabilities that sit at 0.996 so every tick needs four decimals,
// and mean lives that reach 1e5 hours.
const wf = weibullFit({
  times: [412, 598, 742, 801, 955, 1120, 1204, 1580, 2000, 2000, 2000, 2000],
  events: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
});
if (wf.ok) {
  figures.push([
    "rel weibull plot",
    buildPlotSvg(
      [
        { points: wf.points, type: "scatter", color: "#2563eb", label: "observed" },
        { points: wf.fitLine, type: "line", color: "#b91c1c", label: "maximum likelihood" },
      ],
      { width: 380, height: 260, xlabel: "ln(life in hours)", ylabel: "ln(-ln(1 - F))", title: "Straight means Weibull fits" },
    ),
  ]);
}
for (const cfg of ["series", "parallel"] as const) {
  const rb = reliabilityBlock({
    components: [
      { name: "Pump", lambda: 1.2e-4, quantity: 2 },
      { name: "Control valve", lambda: 5e-5, quantity: 3 },
      { name: "Sensor", lambda: 3e-5, quantity: 4 },
    ],
    configuration: cfg,
    timeH: 8760,
  });
  if (rb.ok) {
    figures.push([
      `rel rbd ${cfg}`,
      buildPlotSvg(
        [
          { points: rb.curve.map((c) => ({ x: c.t, y: c.R })), type: "line", color: "#2563eb", label: "system" },
          { points: rb.unitCurve.map((c) => ({ x: c.t, y: c.R })), type: "line", color: "#b91c1c", label: rb.unitCurveLabel },
        ],
        { width: 380, height: 260, xlabel: "Hours", ylabel: "Surviving", title: "The system outlives every part" },
      ),
    ]);
  }
}
const kn = kOutOfN({ n: 3, k: 2, unitReliability: Math.exp(-5e-5 * 8760), lambda: 5e-5 });
if (kn.ok) {
  figures.push([
    "rel koon",
    buildPlotSvg(
      [
        { points: kn.curve.map((c) => ({ x: c.unitR, y: c.R })), type: "line", color: "#2563eb", label: "2 of 3" },
        { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], type: "line", color: "#94a3b8", label: "one unit alone" },
        { points: [{ x: Math.exp(-5e-5 * 8760), y: kn.systemReliability }], type: "scatter", color: "#b91c1c", label: "this system" },
      ],
      { width: 380, height: 260, xlabel: "Reliability of one unit", ylabel: "Reliability of the system", title: "Redundancy only pays where units are good" },
    ),
  ]);
}
const rd = redundancy({ lambda: 1e-4, n: 3, timeH: 5000 });
if (rd.ok) {
  figures.push([
    "rel redundancy",
    buildPlotSvg(
      [
        { points: rd.standbySweep.map((p) => ({ x: p.n, y: p.mttf })), type: "line", color: "#2563eb", label: "standby (perfect switch)" },
        { points: rd.activeSweep.map((p) => ({ x: p.n, y: p.mttf })), type: "line", color: "#b91c1c", label: "active" },
      ],
      { width: 380, height: 260, xlabel: "Units in total", ylabel: "Mean time to failure (h)", title: "Linear against harmonic" },
    ),
  ]);
}
for (const [mtbf, mttr] of [[2000, 8], [1e6, 0.5]] as [number, number][]) {
  const av = availability({ mtbfH: mtbf, mttrH: mttr, windowH: 8760, unitsInSeries: 5 });
  if (av.ok) {
    figures.push([
      `rel availability ${mtbf}/${mttr}`,
      buildPlotSvg(
        [
          { points: av.curve.map((c) => ({ x: c.mttr, y: c.A })), type: "line", color: "#2563eb", label: "availability" },
          { points: [{ x: mttr, y: av.availability }], type: "scatter", color: "#b91c1c", label: "this repair time" },
        ],
        { width: 380, height: 260, xlabel: "Mean time to repair (h)", ylabel: "Availability", title: "Repair time is the lever" },
      ),
    ]);
  }
}

// --- v2.83.0: fluids, thermal and fatigue figures --------------------------

// The S-N sketch, both material classes — log x, two legend entries, and the
// steel knee that pushes a flat segment to the right edge.
for (const mclass of ["steel", "non-ferrous"] as const) {
  const sut = 700;
  const mk = (limit: number) => {
    const s1000 = 0.9 * sut;
    const b = -Math.log10(s1000 / limit) / 3;
    const a = s1000 / Math.pow(1000, b);
    const endExp = mclass === "steel" ? 6 : Math.log10(5e8);
    const pts = Array.from({ length: 61 }, (_, i) => {
      const N = Math.pow(10, 3 + ((endExp - 3) * i) / 60);
      return { x: N, y: a * Math.pow(N, b) };
    });
    if (mclass === "steel") pts.push({ x: 1e7, y: limit });
    return pts;
  };
  figures.push([
    `sn ${mclass}`,
    buildPlotSvg(
      [
        { points: mk(350), type: "line", color: "#9ca3af", label: "uncorrected Se'" },
        { points: mk(178), type: "line", color: "#2563eb", label: "corrected Se" },
      ],
      { width: 380, height: 260, xScale: "log", xlabel: "cycles to failure N", ylabel: "alternating stress (MPa)", title: "Estimated S-N curve" },
    ),
  ]);
}

// The specific-energy diagram: four legend entries, two scatter points close
// to the curve's nose where labels like to collide.
{
  const Q = 8.6;
  const g = 9.80665;
  const A = (y: number) => (3 + 2 * y) * y; // trapezoid b=3, z=2
  const curve = Array.from({ length: 60 }, (_, i) => {
    const y = (2.7 * (i + 1)) / 60;
    return { x: y + (Q * Q) / (2 * g * A(y) * A(y)), y };
  }).filter((p) => p.x <= 5);
  figures.push([
    "spec energy",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "E(y) at this Q" },
        { points: [{ x: 0, y: 0 }, { x: 2.7, y: 2.7 }], type: "line", color: "#9ca3af", label: "E = y" },
        { points: [{ x: 1.31, y: 1.2 }], type: "scatter", color: "#b91c1c", label: "this flow" },
        { points: [{ x: 1.24, y: 0.83 }], type: "scatter", color: "#059669", label: "critical depth" },
      ],
      { width: 380, height: 270, xlabel: "specific energy E (m)", ylabel: "depth y (m)", title: "Specific energy diagram" },
    ),
  ]);
}

// The NPSH ledger: healthy, cavitating, a pump far above the liquid (drives
// the bars hard right — the case that clipped a value label), and a
// requirement far past every bar (drives ITS label to the edge).
figures.push(["npsh ledger", npshLadderSvg({ surfaceHead: 10.35, staticHead: 2, vapourHead: 0.24, losses: 0.5, npshAvailable: 11.61, npshRequired: 3 })]);
figures.push(["npsh cavitating", npshLadderSvg({ surfaceHead: 10.35, staticHead: -6, vapourHead: 3.8, losses: 1.9, npshAvailable: -1.35, npshRequired: 3 })]);
figures.push(["npsh deep lift", npshLadderSvg({ surfaceHead: 10.35, staticHead: -50, vapourHead: 0.24, losses: 0.5, npshAvailable: -40.39, npshRequired: 3 })]);
figures.push(["npsh big requirement", npshLadderSvg({ surfaceHead: 10.35, staticHead: 2, vapourHead: 0.24, losses: 0.5, npshAvailable: 11.61, npshRequired: 120 })]);

// The system head curve — quadratic-ish sweep with the working point on it.
figures.push([
  "system head",
  buildPlotSvg(
    [
      { points: Array.from({ length: 36 }, (_, i) => { const q = 15.7 * (0.1 + (1.9 * (i + 1)) / 36); return { x: q, y: 0.052 * q * q }; }), type: "line", color: "#2563eb", label: "system head" },
      { points: [{ x: 15.7, y: 12.8 }], type: "scatter", color: "#b91c1c", label: "this flow" },
    ],
    { width: 380, height: 260, xlabel: "flow rate (L/s)", ylabel: "head loss (m)", title: "System head curve" },
  ),
]);

// The wall temperature profile — vertical film steps at both faces.
figures.push([
  "wall profile",
  buildPlotSvg(
    [{ points: [{ x: 0, y: 20 }, { x: 0, y: 12.4 }, { x: 200, y: 8.1 }, { x: 250, y: -3.9 }, { x: 250, y: -5 }], type: "line", color: "#b91c1c" }],
    { width: 380, height: 250, xlabel: "distance from inner surface (mm)", ylabel: "temperature (°C)", title: "Temperature through the wall" },
  ),
]);

// NPSH against flow: three series, one of them a flat requirement line.
figures.push([
  "npsh vs flow",
  buildPlotSvg(
    [
      { points: Array.from({ length: 36 }, (_, i) => { const q = 15 * (0.1 + (1.9 * (i + 1)) / 36); return { x: q, y: 12.1 - 0.02 * q * q }; }), type: "line", color: "#2563eb", label: "NPSH available" },
      { points: [{ x: 1.5, y: 3 }, { x: 30, y: 3 }], type: "line", color: "#b91c1c", label: "NPSH required" },
      { points: [{ x: 15, y: 7.6 }], type: "scatter", color: "#059669", label: "this flow" },
    ],
    { width: 380, height: 250, xlabel: "flow (L/s)", ylabel: "NPSH (m)", title: "NPSH available against flow" },
  ),
]);

// Load blocks over the S-N line — scatter points deliberately ON the curve.
{
  const sut = 700, se = 250, s1000 = 0.9 * sut;
  const b = -Math.log10(s1000 / se) / 3;
  const a = s1000 / Math.pow(1000, b);
  const line = Array.from({ length: 61 }, (_, i) => { const N = Math.pow(10, 3 + (3 * i) / 60); return { x: N, y: a * Math.pow(N, b) }; });
  line.push({ x: 1e7, y: se });
  figures.push([
    "sn blocks",
    buildPlotSvg(
      [
        { points: line, type: "line", color: "#2563eb", label: "S-N line" },
        { points: [{ x: 1000, y: 420 }, { x: 20000, y: 350 }, { x: 500000, y: 280 }], type: "scatter", color: "#b91c1c", label: "applied blocks" },
      ],
      { width: 380, height: 260, xScale: "log", xlabel: "cycles N", ylabel: "alternating stress (MPa)", title: "Load blocks against the S-N line" },
    ),
  ]);
}

// --- v2.84.0: thermo and aero figures ---------------------------------------

// P-v process path: isentropic compression 10:1 — steep curve into the corner
// where the state-2 label lives.
{
  const p1 = 100, v1 = 0.8614, n = 1.4, v2 = 0.1663;
  const path = Array.from({ length: 49 }, (_, i) => {
    const v = v1 * Math.pow(v2 / v1, i / 48);
    return { x: v, y: p1 * Math.pow(v1 / v, n) };
  });
  figures.push([
    "pv process",
    buildPlotSvg(
      [
        { points: path, type: "line", color: "#2563eb", label: "process path" },
        { points: [{ x: v1, y: p1 }], type: "scatter", color: "#059669", label: "state 1" },
        { points: [{ x: v2, y: 1000 }], type: "scatter", color: "#b91c1c", label: "state 2" },
      ],
      { width: 380, height: 260, xlabel: "volume (m³)", ylabel: "pressure (kPa)", title: "isentropic process on the P-v plane" },
    ),
  ]);
}

// Otto cycle on log pressure — the full four-leg loop with corner markers.
{
  const k = 1.4, r = 8, p2 = Math.pow(r, k), p3 = p2 * (1800.15 / 689.2);
  const path: { x: number; y: number }[] = [{ x: r, y: 1 }];
  for (let i = 1; i <= 30; i++) { const v = r * Math.pow(1 / r, i / 30); path.push({ x: v, y: Math.pow(r / v, k) }); }
  path.push({ x: 1, y: p3 });
  for (let i = 1; i <= 30; i++) { const v = Math.pow(r, i / 30); path.push({ x: v, y: p3 * Math.pow(1 / v, k) }); }
  path.push({ x: r, y: 1 });
  figures.push([
    "otto cycle",
    buildPlotSvg(
      [
        { points: path, type: "line", color: "#2563eb", label: "cycle path" },
        { points: [{ x: r, y: 1 }, { x: 1, y: p2 }, { x: 1, y: p3 }, { x: r, y: p3 * Math.pow(1 / r, k) }], type: "scatter", color: "#b91c1c", label: "states 1-4" },
      ],
      { width: 380, height: 270, yScale: "log", xlabel: "volume ratio", ylabel: "pressure ratio P/P₁", title: "Otto cycle on the P-v plane" },
    ),
  ]);
}

// ISA profile: three ratio curves that converge at (1, 0) — label crowding at
// the shared origin is the case to police.
{
  const t = (zkm: number) => Math.max(0.75, 1 - 0.0226 * zkm);
  const pr = (zkm: number) => Math.exp(-zkm / 7.3);
  figures.push([
    "isa profile",
    buildPlotSvg(
      [
        { points: Array.from({ length: 61 }, (_, i) => ({ x: t(i / 3), y: i / 3 })), type: "line", color: "#b91c1c", label: "T / T₀" },
        { points: Array.from({ length: 61 }, (_, i) => ({ x: pr(i / 3), y: i / 3 })), type: "line", color: "#2563eb", label: "p / p₀" },
        { points: Array.from({ length: 61 }, (_, i) => ({ x: pr(i / 3) / t(i / 3), y: i / 3 })), type: "line", color: "#059669", label: "ρ / ρ₀" },
        { points: [{ x: 0.34, y: 10 }], type: "scatter", color: "#111111", label: "this altitude" },
      ],
      { width: 380, height: 270, xlabel: "fraction of sea-level value", ylabel: "altitude (km)", title: "Standard atmosphere profile" },
    ),
  ]);
}

// Drag polar with the tangent ray and two markers near the curve.
{
  const cd0 = 0.02, kInd = 1 / (Math.PI * 9 * 0.8);
  const polar = Array.from({ length: 51 }, (_, i) => { const cl = (0.95 * i) / 50; return { x: cd0 + kInd * cl * cl, y: cl }; });
  figures.push([
    "drag polar",
    buildPlotSvg(
      [
        { points: polar, type: "line", color: "#2563eb", label: "drag polar" },
        { points: [{ x: 0, y: 0 }, { x: 0.05, y: 0.841 }], type: "line", color: "#9ca3af", label: "best L/D ray" },
        { points: [{ x: 0.028, y: 0.425 }], type: "scatter", color: "#b91c1c", label: "this flight" },
        { points: [{ x: 0.04, y: 0.673 }], type: "scatter", color: "#059669", label: "best L/D" },
      ],
      { width: 380, height: 270, xlabel: "CD", ylabel: "CL", title: "Drag polar" },
    ),
  ]);
}

// Turn radius on a log axis, spanning 34 m to 4.4 km.
figures.push([
  "turn radius",
  buildPlotSvg(
    [
      { points: Array.from({ length: 81 }, (_, i) => { const deg = 5 + i; return { x: deg, y: (61.7 * 61.7) / (9.80665 * Math.tan((deg * Math.PI) / 180)) }; }), type: "line", color: "#2563eb", label: "turn radius" },
      { points: [{ x: 45, y: 389 }], type: "scatter", color: "#b91c1c", label: "this bank" },
    ],
    { width: 380, height: 250, yScale: "log", xlabel: "bank angle (°)", ylabel: "turn radius (m)", title: "Turn radius against bank" },
  ),
]);

// --- v2.85.0: control, vibration and electronics figures --------------------

// Pole-zero maps: a stable triple, an unstable pair in the shaded half plane,
// and a cluster hugging the imaginary axis where labels crowd the boundary.
figures.push(["pz stable", poleZeroSvg([{ re: -1, im: 0 }, { re: -0.5, im: 1.2 }, { re: -0.5, im: -1.2 }], [{ re: -2, im: 0 }])]);
figures.push(["pz unstable", poleZeroSvg([{ re: 0.3, im: 2 }, { re: 0.3, im: -2 }, { re: -3, im: 0 }], [])]);
figures.push(["pz axis-hugging", poleZeroSvg([{ re: -0.01, im: 0.5 }, { re: -0.01, im: -0.5 }, { re: 0, im: 0 }], [{ re: 0.02, im: 0 }])]);

// Power bars: milliwatt values (the formatter case), and a mixed-sign budget.
figures.push(["power bars", hBarSvg([
  { name: "V1", value: -8.33e-3, colour: "#059669" },
  { name: "R1", value: 2.78e-3, colour: "#2563eb" },
  { name: "R2", value: 5.56e-3, colour: "#2563eb" },
], { title: "Power per element", unit: "W" })]);
figures.push(["long bars", hBarSvg(
  Array.from({ length: 12 }, (_, i) => ({ name: `element-${i + 1}`, value: (i - 4) * 1.7 })),
  { title: "A longer mixed-sign budget", unit: "kJ" },
)]);

// Logic waveforms at the default four variables (16 columns).
figures.push(["logic waves", logicWaveSvg({
  variables: ["A", "B", "C", "D"],
  rows: Array.from({ length: 16 }, (_, i) => ({
    inputs: [8, 4, 2, 1].map((b) => (i & b) !== 0),
    output: [0, 1, 2, 5, 6, 7, 8, 9, 10, 14].includes(i),
  })),
})]);

// The FRF with resonance peaks on a log axis and the operating point off-peak.
{
  const frf = Array.from({ length: 90 }, (_, i) => {
    const w = (14 * (i + 1)) / 90;
    const den = (wn: number) => Math.sqrt((wn * wn - w * w) ** 2 + (2 * 0.02 * wn * w) ** 2);
    return { x: w, y: 10 / den(6.18) + 4 / den(16.18) };
  });
  figures.push([
    "mdof frf",
    buildPlotSvg(
      [
        { points: frf, type: "line", color: "#2563eb", label: "DOF 1" },
        { points: [{ x: 8, y: 0.34 }], type: "scatter", color: "#b91c1c", label: "this frequency" },
      ],
      { width: 380, height: 250, yScale: "log", xlabel: "forcing frequency ω (rad/s)", ylabel: "steady-state amplitude", title: "Frequency response, DOF 1" },
    ),
  ]);
}

// Mode shapes: five modes of a five-mass chain, legend at its row cap.
figures.push([
  "mode shapes",
  buildPlotSvg(
    Array.from({ length: 5 }, (_, j) => ({
      points: Array.from({ length: 6 }, (_, i) => ({ x: i, y: i === 0 ? 0 : Math.sin(((j + 1) * Math.PI * i) / 5.5) })),
      type: "line" as const,
      color: ["#2563eb", "#b91c1c", "#059669", "#d97706", "#7c3aed"][j],
      label: `mode ${j + 1} (${(1.1 * (j + 1)).toFixed(2)} Hz)`,
    })),
    { width: 380, height: 250, xlabel: "degree of freedom (0 = anchor)", ylabel: "mass-normalised amplitude", title: "Mode shapes" },
  ),
]);

// Op-amp gain: closed loop meeting the open-loop roll-off, both log axes.
{
  const bw = 1e4;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const f = 10 * Math.pow(1e5, i / 60);
    return { x: f, y: 20 * Math.log10(100 / Math.sqrt(1 + (f / bw) ** 2)) };
  });
  const ol = Array.from({ length: 61 }, (_, i) => {
    const f = 10 * Math.pow(1e5, i / 60);
    return { x: f, y: 20 * Math.log10(1e6 / f) };
  }).filter((p) => p.y > -0.1);
  figures.push([
    "opamp gain",
    buildPlotSvg(
      [
        { points: pts, type: "line", color: "#2563eb", label: "closed-loop gain" },
        { points: ol, type: "line", color: "#9ca3af", label: "open-loop roll-off" },
        { points: [{ x: bw, y: 20 * Math.log10(100) - 3 }], type: "scatter", color: "#b91c1c", label: "-3 dB" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "frequency (Hz)", ylabel: "gain (dB)", title: "Gain against frequency" },
    ),
  ]);
}

// --- v2.86.0: energy figures -------------------------------------------------

// The power triangle at the default 0.8 pf, at unity (collapsed), and at a
// heavily reactive 0.3 where the arc label crowds the hypotenuse.
figures.push(["power triangle", powerTriangleSvg(55.4, 41.6, 69.3, 0.8)]);
figures.push(["power triangle unity", powerTriangleSvg(69.3, 0, 69.3, 1)]);
figures.push(["power triangle reactive", powerTriangleSvg(20.8, 66.1, 69.3, 0.3)]);

// The cube-law wind curve: four series, three of them near-coincident at the
// left where the legend used to sit.
figures.push([
  "wind cube law",
  buildPlotSvg(
    [
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 1994 * Math.pow(v / 8, 3) }; }), type: "line", color: "#9ca3af", label: "in the wind" },
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 1181 * Math.pow(v / 8, 3) }; }), type: "line", color: "#2563eb", label: "Betz bound 16/27" },
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 897 * Math.pow(v / 8, 3) }; }), type: "line", color: "#059669", label: "Cp = 0.45" },
      { points: [{ x: 8, y: 897 }], type: "scatter", color: "#b91c1c", label: "this wind speed" },
    ],
    { width: 380, height: 260, xlabel: "hub-height wind speed (m/s)", ylabel: "power (kW)", title: "Power goes as the cube of wind speed" },
  ),
]);

// The Weibull pdf with three unlabeled stems and two markers near the peak.
{
  const k = 2, c = 8;
  const pdf = (v: number) => (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k));
  const curve = Array.from({ length: 120 }, (_, i) => { const v = 0.05 + (27.95 * i) / 119; return { x: v, y: pdf(v) }; });
  const yCap = Math.max(...curve.map((p) => p.y));
  figures.push([
    "weibull pdf",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "Weibull k=2, c=8" },
        { points: [{ x: 3, y: 0 }, { x: 3, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 12, y: 0 }, { x: 12, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 25, y: 0 }, { x: 25, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 7.09, y: pdf(7.09) }, { x: 5.66, y: pdf(5.66) }], type: "scatter", color: "#b91c1c", label: "mean / mode" },
      ],
      { width: 380, height: 260, xlabel: "wind speed (m/s)", ylabel: "probability density (per m/s)", title: "The fitted wind distribution" },
    ),
  ]);
}

// Battery runtime log-log with two curves and a marker.
figures.push([
  "battery runtime",
  buildPlotSvg(
    [
      { points: Array.from({ length: 49 }, (_, i) => { const I = 1 * Math.pow(100, i / 48); return { x: I, y: 18 / I }; }), type: "line", color: "#2563eb", label: "ideal Ah / I" },
      { points: Array.from({ length: 49 }, (_, i) => { const I = 1 * Math.pow(100, i / 48); return { x: I, y: 18 / Math.pow(I, 1.15) }; }), type: "line", color: "#b91c1c", label: "Peukert-corrected" },
      { points: [{ x: 10, y: 1.8 }], type: "scatter", color: "#059669", label: "this load" },
    ],
    { width: 380, height: 250, xScale: "log", yScale: "log", xlabel: "discharge current (A)", ylabel: "runtime (h)", title: "Runtime against discharge current" },
  ),
]);

// The solar day curve crossing the horizon twice, markers at the crossings.
{
  const elev = (h: number) => 73.4 * Math.sin((Math.PI * (h - 4.7)) / 14.6) - 10;
  const day = Array.from({ length: 97 }, (_, i) => { const h = (24 * i) / 96; return { x: h, y: Math.max(-35, elev(h)) }; });
  figures.push([
    "solar day",
    buildPlotSvg(
      [
        { points: day, type: "line", color: "#d97706", label: "solar elevation" },
        { points: [{ x: 0, y: 0 }, { x: 24, y: 0 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 12, y: 63.4 }], type: "scatter", color: "#b91c1c", label: "solar noon" },
        { points: [{ x: 4.7, y: 0 }, { x: 19.3, y: 0 }], type: "scatter", color: "#2563eb", label: "sunrise / sunset" },
      ],
      { width: 380, height: 260, xlabel: "solar time (h)", ylabel: "sun elevation (°)", title: "The sun's day at this latitude" },
    ),
  ]);
}

// The combustion mass-balance bars, with the long balance-row name.
figures.push([
  "combustion balance",
  hBarSvg(
    [
      { name: "fuel in", value: 1, colour: "#059669" },
      { name: "air in", value: 17.2, colour: "#059669" },
      { name: "CO₂ out", value: -2.74, colour: "#b91c1c" },
      { name: "H₂O out", value: -2.25, colour: "#2563eb" },
      { name: "N₂ + unused O₂ out", value: -13.2, colour: "#9ca3af" },
    ],
    { title: "Mass balance per kg of fuel", unit: "kg" },
  ),
]);

// --- v2.87.0: audio + video figures -----------------------------------------

// The gamut triangles: an enclosing pair and a partial-coverage pair.
{
  const by = (id: string) => GAMUT_DEFS.find((g) => g.id === id)!;
  figures.push([
    "gamut dcip3 vs srgb",
    gamutTriangleSvg({
      gamutLabel: "DCI-P3",
      refLabel: "sRGB",
      gamutPrimaries: by("dcip3").primaries,
      refPrimaries: by("srgb").primaries,
      coverageUv: 1,
    }),
  ]);
  figures.push([
    "gamut srgb vs bt2020",
    gamutTriangleSvg({
      gamutLabel: "sRGB",
      refLabel: "BT.2020",
      gamutPrimaries: by("srgb").primaries,
      refPrimaries: by("bt2020").primaries,
      coverageUv: 0.52,
    }),
  ]);
}

// The fold diagram — the sawtooth plus three markers near its teeth.
{
  const fs = 44100;
  const fold = Array.from({ length: 200 }, (_, i) => {
    const f = (2.5 * fs * (i + 1)) / 200;
    const m = f % fs;
    return { x: f, y: m <= fs / 2 ? m : fs - m };
  });
  figures.push([
    "fold diagram",
    buildPlotSvg(
      [
        { points: fold, type: "line", color: "#2563eb", label: "lands at" },
        { points: [{ x: 20000, y: 20000 }], type: "scatter", color: "#059669", label: "signal max" },
        { points: [{ x: 22050, y: 22050 }], type: "scatter", color: "#b91c1c", label: "Nyquist" },
      ],
      { width: 380, height: 260, xlabel: "input frequency (Hz)", ylabel: "apparent frequency after sampling (Hz)", title: "The fold diagram" },
    ),
  ]);
}

// The comb with its floored notches on a log axis.
{
  const t = 0.001;
  const comb = Array.from({ length: 401 }, (_, i) => {
    const f = 100 * Math.pow(20, i / 400);
    return { x: f, y: Math.max(-30, 20 * Math.log10(Math.abs(2 * Math.cos(Math.PI * f * t)))) };
  });
  figures.push([
    "comb response",
    buildPlotSvg(
      [
        { points: comb, type: "line", color: "#2563eb", label: "response" },
        { points: [500, 1500, 2500, 3500, 4500].map((f) => ({ x: f, y: -30 })), type: "scatter", color: "#b91c1c", label: "cancellations" },
        { points: [1000, 2000, 3000, 4000, 5000].map((f) => ({ x: f, y: 6.02 })), type: "scatter", color: "#059669", label: "reinforcements" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "frequency (Hz)", ylabel: "response (dB, floored at -30)", title: "The comb" },
    ),
  ]);
}

// The PQ curve on log nits.
figures.push([
  "pq curve",
  buildPlotSvg(
    [
      { points: Array.from({ length: 201 }, (_, i) => { const code = 0.005 + (0.995 * i) / 200; const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875; const cp = Math.pow(code, 1 / m2); const n = Math.max(cp - c1, 0) / (c2 - c3 * cp); return { x: code, y: 10000 * Math.pow(n, 1 / m1) }; }).filter((p) => p.y > 0), type: "line", color: "#2563eb", label: "ST 2084 (PQ)" },
      { points: [{ x: 0.751, y: 1000 }], type: "scatter", color: "#b91c1c", label: "this peak" },
    ],
    { width: 380, height: 250, yScale: "log", xlabel: "PQ code value (0-1)", ylabel: "luminance (nits)", title: "The absolute PQ curve" },
  ),
]);

// The buffer timeline and the latency bars.
figures.push([
  "buffer timeline",
  buildPlotSvg(
    [
      { points: [{ x: 0, y: 0 }, { x: 13.33, y: 8 }, { x: 21.33, y: 0 }], type: "line", color: "#2563eb", label: "buffer held" },
      { points: [{ x: 13.33, y: 8 }], type: "scatter", color: "#059669", label: "playback starts" },
      { points: [{ x: 21.33, y: 0 }], type: "scatter", color: "#b91c1c", label: "stall if outage" },
    ],
    { width: 380, height: 250, xlabel: "time (s)", ylabel: "buffer held (s of video)", title: "Fill on the surplus, drain through an outage" },
  ),
]);
figures.push([
  "latency bars",
  hBarSvg(
    [
      { name: "capture", value: 5, colour: "#2563eb" },
      { name: "encode", value: 20, colour: "#2563eb" },
      { name: "network", value: 30, colour: "#b91c1c" },
      { name: "decode", value: 8, colour: "#2563eb" },
      { name: "sum", value: 63, colour: "#9ca3af" },
      { name: "delivered", value: 66.67, colour: "#059669" },
    ],
    { title: "Latency budget at 60 Hz", unit: "ms" },
  ),
]);

// The mode map: three scatter rows with crowded low-frequency axials.
figures.push([
  "mode map",
  buildPlotSvg(
    [
      { points: [34.3, 42.9, 68.6, 68.6, 85.8, 102.9, 137.2].map((f) => ({ x: f, y: 3 })), type: "scatter", color: "#b91c1c", label: "axial" },
      { points: [54.9, 77.4, 80.9, 98.6, 110.1, 123.5].map((f) => ({ x: f, y: 2 })), type: "scatter", color: "#2563eb", label: "tangential" },
      { points: [89.5, 112.3, 130.7, 145.2].map((f) => ({ x: f, y: 1 })), type: "scatter", color: "#9ca3af", label: "oblique" },
    ],
    { width: 380, height: 220, xlabel: "mode frequency (Hz)", ylabel: "audibility rank", title: "The mode map" },
  ),
]);

// --- v2.88.0: comp, chips, optics and quantum figures ------------------------

// The generic ladder in both conventions: a thermal ladder that must stay
// LEFT of its limit, and a timing budget that must end RIGHT of zero.
figures.push([
  "thermal ladder",
  ladderSvg(
    [
      { name: "ambient", delta: 25, gain: true },
      { name: "θ sink-to-ambient", delta: 19.5, gain: true },
      { name: "θ case-to-sink", delta: 3, gain: true },
      { name: "θ junction-to-case", delta: 7.5, gain: true },
      { name: "junction", delta: 55, gain: true, result: true },
    ],
    { title: "The thermal ladder", axisLabel: "temperature (°C)", fmt: (v) => v.toFixed(1), limit: 125, limitLabel: "Tj max 125 °C", limitOkAbove: false, okText: "within limit", failText: "OVER LIMIT" },
  ),
]);
figures.push([
  "timing ladder",
  ladderSvg(
    [
      { name: "clock period", delta: 1000, gain: true },
      { name: "clock-to-Q", delta: -100, gain: false },
      { name: "longest logic", delta: -700, gain: false },
      { name: "setup time", delta: -80, gain: false },
      { name: "clock skew", delta: 0, gain: true },
      { name: "setup slack", delta: 120, gain: true, result: true },
    ],
    { title: "The setup budget", axisLabel: "time (ps)", fmt: (v) => `${Math.round(v)}`, limit: 0, limitLabel: "slack = 0", limitOkAbove: true, okText: "PASS", failText: "FAIL" },
  ),
]);
figures.push([
  "timing ladder FAIL",
  ladderSvg(
    [
      { name: "clock period", delta: 500, gain: true },
      { name: "clock-to-Q", delta: -100, gain: false },
      { name: "longest logic", delta: -700, gain: false },
      { name: "setup slack", delta: -300, gain: true, result: true },
    ],
    { title: "The setup budget", axisLabel: "time (ps)", fmt: (v) => `${Math.round(v)}`, limit: 0, limitLabel: "slack = 0", limitOkAbove: true, okText: "PASS", failText: "FAIL" },
  ),
]);

// The stability diagram's parametric hyperbola with the axes as series.
{
  const G = 3;
  const hyp: { x: number; y: number }[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = -Math.log(G) + (2 * Math.log(G) * i) / 80;
    hyp.push({ x: Math.exp(t), y: Math.exp(-t) });
  }
  figures.push([
    "stability diagram",
    buildPlotSvg(
      [
        { points: hyp, type: "line", color: "#2563eb", label: "g₁g₂ = 1" },
        { points: hyp.map((p) => ({ x: -p.x, y: -p.y })), type: "line", color: "#2563eb" },
        { points: [{ x: -G, y: 0 }, { x: G, y: 0 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 0, y: -G }, { x: 0, y: G }], type: "line", color: "#9ca3af" },
        { points: [{ x: 0.5, y: 0.5 }], type: "scatter", color: "#059669", label: "this cavity (stable)" },
      ],
      { width: 380, height: 270, xlabel: "g₁ = 1 − L/R₁", ylabel: "g₂ = 1 − L/R₂", title: "The stability diagram" },
    ),
  ]);
}

// The CHSH stem chart: bounds as lines, S saturating Tsirelson exactly.
figures.push([
  "chsh stems",
  buildPlotSvg(
    [
      { points: [{ x: -0.6, y: 0 }, { x: 4.6, y: 0 }], type: "line", color: "#9ca3af" },
      { points: [{ x: -0.6, y: 2 }, { x: 4.6, y: 2 }], type: "line", color: "#d97706", label: "classical ±2" },
      { points: [{ x: -0.6, y: -2 }, { x: 4.6, y: -2 }], type: "line", color: "#d97706" },
      { points: [{ x: -0.6, y: 2.8284 }, { x: 4.6, y: 2.8284 }], type: "line", color: "#059669", label: "Tsirelson ±2√2" },
      { points: [{ x: -0.6, y: -2.8284 }, { x: 4.6, y: -2.8284 }], type: "line", color: "#059669" },
      { points: [{ x: 0, y: 0 }, { x: 0, y: 2.8284 }], type: "line", color: "#b91c1c", label: "S" },
      { points: [{ x: 1, y: 0 }, { x: 1, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 2, y: 0 }, { x: 2, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 3, y: 0 }, { x: 3, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 4, y: 0 }, { x: 4, y: 0.7071 }], type: "line", color: "#2563eb" },
    ],
    { width: 380, height: 260, xlabel: "S, then the four contributions", ylabel: "correlation sum", title: "S against both bounds" },
  ),
]);

// The Snell sweep stopping at the critical angle.
{
  const snell: { x: number; y: number }[] = [];
  for (let deg = 0; deg <= 41.5; deg += 0.5) {
    const s = (1.5 / 1.0) * Math.sin((deg * Math.PI) / 180);
    if (s <= 1) snell.push({ x: deg, y: (Math.asin(s) * 180) / Math.PI });
  }
  figures.push([
    "snell sweep",
    buildPlotSvg(
      [
        { points: snell, type: "line", color: "#2563eb", label: "Snell" },
        { points: [{ x: 41.81, y: 0 }, { x: 41.81, y: 90 }], type: "line", color: "#9ca3af", label: "critical angle" },
        { points: [{ x: 30, y: 48.59 }], type: "scatter", color: "#b91c1c", label: "your angle" },
        { points: [{ x: 33.69, y: 56.3 }], type: "scatter", color: "#059669", label: "Brewster" },
      ],
      { width: 380, height: 260, xlabel: "angle of incidence (°)", ylabel: "angle of refraction (°)", title: "Snell's law at this interface" },
    ),
  ]);
}

// The birthday curve with its far-left working point.
{
  const space = Math.pow(2, 64);
  const curve: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const k = Math.max(1, Math.round(Math.pow(5.06e10, i / 60)));
    const p = 1 - Math.exp((-k * (k - 1)) / 2 / space);
    curve.push({ x: k, y: p });
  }
  figures.push([
    "birthday curve",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "P(collision)" },
        { points: [{ x: 1, y: 0.5 }, { x: 5.06e10, y: 0.5 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 1e6, y: 2.7e-8 }], type: "scatter", color: "#b91c1c", label: "this count" },
        { points: [{ x: 5.06e9, y: 0.5 }], type: "scatter", color: "#059669", label: "50% crossing" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "items (log scale)", ylabel: "P(at least one collision)", title: "The birthday curve" },
    ),
  ]);
}

// --- v2.89.0: the final 24 — orbits, triangles, arms and ledgers -------------

figures.push([
  "orbit leo",
  orbitChartSvg(6371000, [{ a: 6771000, e: 0, colour: "#2563eb", label: "400 km orbit" }], [], "Circular orbit of Earth"),
]);
figures.push([
  "orbit gto",
  orbitChartSvg(
    6371000,
    [{ a: 24371000, e: 0.7306, colour: "#2563eb", label: "e = 0.731" }],
    [
      { rM: 6671000, side: 1, label: "peri 10.2 km/s", colour: "#b91c1c" },
      { rM: 42164000, side: -1, label: "apo 1.6 km/s", colour: "#059669" },
    ],
    "Elliptical orbit of Earth",
  ),
]);
figures.push([
  "orbit hohmann",
  orbitChartSvg(
    6371000,
    [
      { a: 6671000, e: 0, colour: "#9ca3af", dashed: true },
      { a: 42164000, e: 0, colour: "#9ca3af", dashed: true },
      { a: 24417500, e: 0.7268, colour: "#2563eb", label: "transfer", half: true },
    ],
    [
      { rM: 6671000, side: 1, label: "burn 1: 2440 m/s", colour: "#b91c1c" },
      { rM: 42164000, side: -1, label: "burn 2: 1472 m/s", colour: "#059669" },
    ],
    "Hohmann transfer at Earth",
  ),
]);

figures.push([
  "wind triangle",
  vectorTriangleSvg(
    [
      { dx: 49.0, dy: -9.9, colour: "#2563eb", label: "air 50 m/s hdg 101.3°" },
      { dx: 0, dy: 10, colour: "#b91c1c", label: "wind 10 m/s" },
    ],
    { dx: 49.0, dy: 0.1, colour: "#059669", label: "ground 49 m/s trk 90°" },
    "The wind triangle",
    "drift 11.3°, north up",
  ),
]);
figures.push([
  "climb triangle",
  vectorTriangleSvg(
    [
      { dx: 79.6, dy: 0, colour: "#9ca3af", label: "ground leg 79.6 m/s" },
      { dx: 0, dy: 8, colour: "#b91c1c", label: "climb 8.0 m/s" },
    ],
    { dx: 79.6, dy: 8, colour: "#2563eb", label: "V = 80 m/s at γ 5.74°" },
    "The climb triangle",
    "sin γ = (T − D)/W = 0.1",
  ),
]);

figures.push([
  "arm fk",
  armSvg(
    [
      {
        joints: [
          { x: 0, y: 0 },
          { x: 0.433, y: 0.25 },
          { x: 0.537, y: 0.636 },
          { x: 0.712, y: 0.667 },
        ],
        colour: "#2563eb",
        label: "tip",
      },
    ],
    [{ r: 1.1 }],
    { title: "The chain in the plane", note: "tip (0.712, 0.667) m, reach 1.1 m" },
  ),
]);
figures.push([
  "arm ik unreachable",
  armSvg([], [{ r: 0.9 }, { r: 0.1 }], {
    title: "The target is outside the workspace",
    target: { x: 1.1, y: 0.4 },
    note: "outside the annulus by 0.27 m",
  }),
]);
figures.push([
  "arm ellipse",
  armSvg(
    [
      {
        joints: [
          { x: 0, y: 0 },
          { x: 0.433, y: 0.25 },
          { x: 0.433, y: 0.65 },
        ],
        colour: "#2563eb",
      },
    ],
    [],
    {
      title: "The manipulability ellipse",
      ellipse: { cx: 0.433, cy: 0.65, a: 0.82, b: 0.21, phi: 1.2, colour: "#b91c1c" },
      note: "condition number 3.9",
    },
  ),
]);
figures.push([
  "diffdrive circles",
  armSvg(
    [
      {
        joints: [
          { x: -0.2, y: 0 },
          { x: 0.2, y: 0 },
        ],
        colour: "#2563eb",
        label: "robot",
      },
    ],
    [
      { r: 1.0, cx: -1.0, cy: 0, dashed: false, colour: "#2563eb" },
      { r: 0.8, cx: -1.0, cy: 0, colour: "#9ca3af" },
      { r: 1.2, cx: -1.0, cy: 0, colour: "#9ca3af" },
    ],
    { title: "The turning circles", target: { x: -1.0, y: 0 }, note: "turn radius 1.0 m about the marked centre" },
  ),
]);

figures.push([
  "rankine ledger",
  ladderSvg(
    [
      { name: "heat in (boiler)", delta: 3019, gain: true },
      { name: "heat out (condenser)", delta: -1908.2, gain: false },
      { name: "pump work in", delta: 3.2, gain: true },
      { name: "net work", delta: 1110.8, gain: true, result: true },
    ],
    { title: "The Rankine energy ledger", axisLabel: "specific energy (kJ/kg)", fmt: (v) => v.toFixed(0) },
  ),
]);

// The great-circle track with its chord, and the S-curve pair.
figures.push([
  "great circle",
  buildPlotSvg(
    [
      { points: Array.from({ length: 101 }, (_, i) => { const f = i / 100; const lat = 51.4775 + (40.6413 - 51.4775) * f + 12 * Math.sin(Math.PI * f); const lon = -0.4614 + (-73.7781 + 0.4614) * f; return { x: lon, y: lat }; }), type: "line", color: "#2563eb", label: "great circle" },
      { points: [{ x: -0.4614, y: 51.4775 }, { x: -73.7781, y: 40.6413 }], type: "line", color: "#9ca3af", label: "straight on the chart" },
      { points: [{ x: -0.4614, y: 51.4775 }, { x: -73.7781, y: 40.6413 }], type: "scatter", color: "#b91c1c" },
    ],
    { width: 380, height: 260, xlabel: "longitude (°E)", ylabel: "latitude (°N)", title: "The shortest route bends poleward" },
  ),
]);
figures.push([
  "scurve pair",
  buildPlotSvg(
    [
      { points: Array.from({ length: 141 }, (_, i) => { const t = (2.55 * i) / 140; const Ta = 0.45, vp = 0.5, cruise = 1.35; const va = (tt: number) => (tt <= 0 ? 0 : tt >= Ta ? vp : tt <= 0.2 ? 25 * tt * tt : tt <= 0.25 ? 0.5 * (tt - 0.1) * 4 - 0 + 25 * 0.04 - 1 * 0 : vp - 25 * (Ta - tt) * (Ta - tt)); const y = t <= Ta ? va(t) : t <= Ta + cruise ? vp : va(2.55 - t); return { x: t, y: Math.max(0, Math.min(vp, y)) }; }), type: "line", color: "#2563eb", label: "S-curve" },
      { points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.5 }, { x: 2.05, y: 0.5 }, { x: 2.3, y: 0 }], type: "line", color: "#9ca3af", label: "trapezoidal" },
    ],
    { width: 380, height: 250, xlabel: "time (s)", ylabel: "speed (m/s)", title: "The jerk limit rounds the corners" },
  ),
]);

// =============================================================================
// THE NON-ENGINEERING HALF
// =============================================================================
// Everything above this line is Engineering. Everything below is the half of the
// product that had no figure gate at all until 2026-08-05 — Table→Chart, the
// table figure and diagrams, heat maps, candlesticks, predicted and measured
// spectra, beams, the periodic table, sequence maps and the persistence barcode.
//
// Inputs are built THROUGH THE REAL PARSERS AND ENGINES (`parseTableData`,
// `predictNmr`, `analyzeBeam`, `parseGenBank`, `persistentHomology`) rather than
// hand-assembled, for the same reason the Reliability block above does it: a
// hand-made object that does not match what the pane actually passes produces a
// figure nobody ever sees, and a corpus of those is a gate that measures nothing.

// --- Table → Chart ------------------------------------------------------------
// Long category labels, a five-series legend, thousands separators and a unit
// suffix — the four things that make the tick column and the legend fight.
const SALES: string[][] = [
  ["Fiscal quarter", "North America", "Europe, Middle East & Africa", "Asia-Pacific", "Latin America", "Rest of world"],
  ["Q1 2024 (restated)", "1,204,500", "886,000", "1,455,900", "212,400", "18,900"],
  ["Q2 2024", "1,318,750", "902,300", "1,502,100", "244,050", "21,300"],
  ["Q3 2024", "1,101,200", "1,044,800", "1,688,400", "198,700", "17,050"],
  ["Q4 2024 (preliminary)", "1,590,300", "1,120,600", "1,742,250", "301,900", "26,400"],
  ["Q1 2025", "1,622,100", "1,208,400", "1,811,000", "288,300", "24,800"],
];
const salesChart = parseTableData(SALES);
for (const kind of [
  "column",
  "bar",
  "line",
  "area",
  "scatter",
  "stacked-column",
  "stacked-bar",
  "stacked-area",
  "pie",
  "doughnut",
] as ChartKind[]) {
  figures.push([
    `tablechart ${kind}`,
    buildChartPreviewSvg(salesChart, kind, "Revenue by region and quarter, in reporting currency").svg,
  ]);
}
// Mixed signs with a zero crossing, which moves the baseline off the frame edge.
const SWING = parseTableData([
  ["Month", "Net cash flow", "Cumulative"],
  ["January", "-48200", "-48200"],
  ["February", "12400", "-35800"],
  ["March", "-6050", "-41850"],
  ["April", "88100", "46250"],
  ["May", "-2.5", "46247.5"],
]);
figures.push(["tablechart signed", buildChartPreviewSvg(SWING, "column", "Net cash flow, signed").svg]);
// FEMTO MAGNITUDES. This is gap-analysis defect 0.1: an absolute 1e-9 tick slack
// with no count cap built 2,000,011 tick labels and a 510 MB SVG here. The
// product deliberately ships fs, fF and fJ units, so this input is ordinary.
// It stays in the corpus as the regression guard: if the cap is ever removed,
// this figure alone will take the gate from seconds to never.
const FEMTO = parseTableData([
  ["Pulse", "Width (s)", "Energy (J)"],
  ["seed", "1.2e-15", "3.4e-15"],
  ["amplified", "8.7e-15", "9.1e-15"],
  ["compressed", "4.4e-15", "6.8e-15"],
]);
figures.push(["tablechart femto", buildChartPreviewSvg(FEMTO, "column", "Femtosecond pulse train").svg]);
// A patent-drawing rendering with a figure label: hatching, markers and an extra
// caption band beneath the frame.
figures.push([
  "tablechart patent",
  buildChartPreviewSvg(salesChart, "column", "Revenue by region", { patent: true, figLabel: "FIG. 4" }).svg,
]);

// --- The table figure and the two diagram kinds -------------------------------
figures.push(["tablefigure", buildTableFigureSvg(SALES, "Table 1 — quarterly revenue").svg]);
figures.push([
  "tablefigure narrow",
  buildTableFigureSvg(
    [
      ["Step", "Reagent", "Conditions", "Yield"],
      ["1", "n-BuLi in THF at -78 °C under argon", "45 min", "88%"],
      ["2", "Pd(PPh₃)₄, K₂CO₃, dioxane/water 4:1", "12 h reflux", "61%"],
      ["3", "TBAF in THF", "2 h, 0 °C to rt", "94%"],
    ],
    "Table 2 — a synthesis with long condition cells",
  ).svg,
]);
const FLOW: string[][] = [
  ["Step", "Description", "Next"],
  ["1", "Receive the Office Action and docket the three-month statutory period", "2"],
  ["2", "Map every rejection to its claim set", "3"],
  ["3", "Pull and read each cited reference in full", "4"],
  ["4", "Is the rejection well founded on the reference as a whole?", "5,6"],
  ["5", "Draft distinguishing arguments with pin cites", "7"],
  ["6", "Draft claim amendments under 37 CFR 1.121", "7"],
  ["7", "File the response and confirm the acknowledgement receipt", ""],
];
figures.push(["diagram flowchart", buildFlowchartSvg(FLOW, "Office Action response workflow").svg]);
// A hierarchy is COLUMN-INDEXED: depth is the column a cell sits in, not a level
// number in a column of its own. Getting that wrong builds a tree of orphans that
// still renders — which is why check-figures.js refuses a blank figure but cannot
// refuse a wrong-shaped one, and why these inputs go through the real parser.
const TREE: string[][] = [
  ["Independent claim 1 — an optical assembly"],
  ["", "Claim 2 — wherein the lens is aspheric"],
  ["", "", "Claim 3 — wherein the aspheric surface is diamond-turned"],
  ["", "Claim 4 — wherein the housing is anodised aluminium"],
  ["", "", "Claim 5 — wherein the anodising is type III hard coat"],
  ["", "", "Claim 6 — wherein a gasket seals the housing to IP67"],
  ["Independent claim 7 — a method of assembling the optical assembly"],
  ["", "Claim 8 — wherein the assembling includes active alignment"],
];
figures.push(["diagram hierarchy", buildHierarchySvg(TREE, "Claim dependency tree").svg]);

// --- Heat map -----------------------------------------------------------------
const CORR = parseTableData([
  ["Assay", "IC50 (nM)", "Hill slope", "Emax (%)", "Selectivity ratio"],
  ["Kinase A binding", "12.4", "1.02", "97.5", "1.0"],
  ["Kinase B binding", "1180", "0.88", "62.1", "95.2"],
  ["Cell proliferation", "44.9", "1.41", "88.0", "3.6"],
  ["Whole blood", "302.7", "1.15", "71.4", "24.4"],
  ["Off-target hERG patch clamp", "9840", "0.79", "18.2", "793.5"],
]);
figures.push(["heatmap sequential", buildHeatmapSvg(CORR, "Assay panel, sequential scale").svg]);
figures.push([
  "heatmap diverging",
  buildHeatmapSvg(
    parseTableData([
      ["Gene", "0 h", "6 h", "24 h", "72 h"],
      ["TP53", "-2.41", "0.12", "1.88", "3.04"],
      ["MYC", "3.19", "-0.44", "-2.90", "-3.55"],
      ["CDKN1A", "0.02", "2.71", "2.44", "0.81"],
      ["BAX", "-0.15", "-1.02", "0.36", "1.99"],
    ]),
    "Log₂ fold change against time",
    { scale: "diverging", midpoint: 0 },
  ).svg,
]);
figures.push(["heatmap grey", buildHeatmapSvg(CORR, "Assay panel, print rendering", { grey: true }).svg]);

// --- Candlestick --------------------------------------------------------------
const OHLC = parseTableData([
  ["Session", "Open", "High", "Low", "Close"],
  ["2025-01-06", "184.20", "188.95", "183.10", "188.02"],
  ["2025-01-07", "188.40", "189.10", "181.75", "182.30"],
  ["2025-01-08", "182.05", "186.60", "180.90", "186.11"],
  ["2025-01-09", "186.30", "192.44", "185.80", "191.90"],
  ["2025-01-10", "191.75", "191.80", "176.20", "177.45"],
  ["2025-01-13", "177.10", "180.05", "174.65", "179.88"],
]);
figures.push(["candlestick", buildCandlestickSvg(OHLC, "Six sessions").svg]);
figures.push(["candlestick grey", buildCandlestickSvg(OHLC, "Six sessions, print", { grey: true }).svg]);
figures.push([
  "candlestick redIsUp",
  buildCandlestickSvg(OHLC, "Six sessions, East Asian convention", { redIsUp: true }).svg,
]);
// Same femtoscale guard as above: candlestick carried the identical tick loop.
figures.push([
  "candlestick femto",
  buildCandlestickSvg(
    parseTableData([
      ["Shot", "Open", "High", "Low", "Close"],
      ["1", "1.20e-15", "1.44e-15", "1.02e-15", "1.31e-15"],
      ["2", "1.31e-15", "1.52e-15", "1.19e-15", "1.22e-15"],
      ["3", "1.22e-15", "1.38e-15", "1.10e-15", "1.36e-15"],
    ]),
    "Femtojoule shot energies",
  ).svg,
]);

// --- Predicted and measured spectra -------------------------------------------
// Toluene, ethanol, aspirin and 2-hexanone: enough signals to crowd an axis, and
// the shifts are real predictions rather than invented coordinates.
//
// The axes here are FLIPPED (δ and wavenumber increase leftward), and gap-analysis
// defect 0.4 was that every one of these drew a NEGATIVE axis for eight months.
// A tick label reading "-4" is not a layout defect, so this corpus cannot catch
// it — spectraChart.test.ts asserts on the tick VALUES. What the corpus catches
// is the other half: a stick spectrum whose assignment labels sit on top of each
// other, which is what a dense aromatic region produces.
for (const [name, smiles, nucleus] of [
  ["nmr toluene 1H", "Cc1ccccc1", "1H"],
  ["nmr aspirin 1H", "CC(=O)Oc1ccccc1C(=O)O", "1H"],
  ["nmr aspirin 13C", "CC(=O)Oc1ccccc1C(=O)O", "13C"],
  ["nmr ethanol 1H", "CCO", "1H"],
] as [string, string, "1H" | "13C"][]) {
  const r = predictNmr(smiles, nucleus);
  const svg = r ? nmrChartSvg(r) : null;
  if (svg) figures.push([name, svg]);
}
{
  const ir = predictIr("CC(=O)Oc1ccccc1C(=O)O");
  const svg = ir ? irChartSvg(ir.bands) : null;
  if (svg) figures.push(["ir aspirin", svg]);
}
{
  const fr = predictFragments("CCCC(=O)C");
  const svg = fr ? msChartSvg(fr) : null;
  if (svg) figures.push(["ms hexanone", svg]);
}
{
  const c = predictCosy("CCO");
  if (c) { const s = cosyChartSvg(c); if (s) figures.push(["cosy ethanol", s]); }
  const h = predictHsqc("Cc1ccccc1");
  if (h) { const s = hsqcChartSvg(h); if (s) figures.push(["hsqc toluene", s]); }
  const b = predictHmbc("Cc1ccccc1");
  if (b) { const s = hmbcChartSvg(b); if (s) figures.push(["hmbc toluene", s]); }
  const t = predictTocsy("CCCCO");
  if (t) { const s = tocsyChartSvg(t); if (s) figures.push(["tocsy butanol", s]); }
}
// A measured trace, as a JCAMP-DX import delivers it: 900 points, four-digit
// wavenumbers, and a title long enough to reach the frame edge.
{
  const pts = Array.from({ length: 900 }, (_, i) => {
    const x = 4000 - (3500 * i) / 899;
    const band = (c: number, w: number, d: number) => d * Math.exp(-(((x - c) / w) ** 2));
    return { x, y: 100 - band(3300, 180, 45) - band(2950, 60, 30) - band(1715, 25, 78) - band(1240, 30, 52) };
  });
  const s = jcampChartSvg({
    title: "Acetylsalicylic acid, KBr disc, 4 cm⁻¹ resolution",
    kind: "ir",
    xUnits: "wavenumber (cm⁻¹)",
    yUnits: "transmittance (%)",
    points: pts,
  });
  if (s) figures.push(["jcamp measured ir", s]);
}

// --- The beam diagram ---------------------------------------------------------
{
  const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
  const beam = (name: string, supports: Support[], loads: Load[], ei: Rat | null): void => {
    const input: BeamInput = { length: R(8), supports, loads, ei };
    const r = analyzeBeam(input);
    if (!r.ok) return;
    figures.push([
      name,
      beamDiagramSvg({
        result: r as BeamResult,
        supports,
        loads,
        forceUnit: "kN",
        momentUnit: "kN·m",
        lengthUnit: "m",
      }),
    ]);
  };
  beam("beam udl", [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], [{ kind: "udl", a: R(0), b: R(8), w: R(5) }], null);
  beam(
    "beam cantilever point",
    [{ kind: "fixed", x: R(0) }],
    [{ kind: "point", x: R(8), p: R(12) }],
    null,
  );
  beam(
    "beam mixed loads",
    [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }],
    [
      { kind: "udl", a: R(0), b: R(3), w: R(9) },
      { kind: "point", x: R(5), p: R(24) },
      { kind: "moment", x: R(6), m: R(15) },
      { kind: "ramp", a: R(6), b: R(8), w1: R(0), w2: R(11) },
    ],
    null,
  );
  // Tiny magnitudes: the value labels become exponential and grow wide.
  beam(
    "beam micro",
    [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }],
    [{ kind: "udl", a: R(0), b: R(8), w: ratDiv(ratInt(1), ratInt(1000000)) }],
    null,
  );
}

// --- The periodic table and the two atom views --------------------------------
figures.push(["periodic table", buildPeriodicTableSvg("Fe").svg]);
figures.push(["periodic table no highlight", buildPeriodicTableSvg().svg]);
for (const [name, z] of [["bohr H", 1], ["bohr Fe", 26], ["bohr U", 92]] as [string, number][]) {
  const r = buildBohrSvg(z);
  if (r) figures.push([name, r.svg]);
}
for (const [name, z] of [["orbital C", 6], ["orbital Fe", 26], ["orbital U", 92]] as [string, number][]) {
  const r = buildOrbitalSvg(z);
  if (r) figures.push([name, r.svg]);
}

// --- Sequence maps, linear and circular ---------------------------------------
{
  const GB = `LOCUS       pEXAMPLE                 900 bp    DNA     circular SYN 05-AUG-2026
DEFINITION  An example construct for the figure corpus.
FEATURES             Location/Qualifiers
     CDS             40..480
                     /label="a rather long coding sequence label"
     promoter        1..38
                     /label="Ptac"
     terminator      500..560
                     /label="rrnB T1"
     misc_feature    complement(600..720)
                     /label="reverse element with a long name"
     primer_bind     complement(861..880)
                     /label="M13rev"
     rep_origin      740..850
                     /label="ColE1"
ORIGIN
        1 ${"acgt".repeat(225)}
//
`;
  const parsed = parseGenBank(GB);
  if (parsed.ok && parsed.records.length) {
    const rec = parsed.records[0];
    const lin = buildLinearMapSvg(rec);
    if (lin) figures.push(["seqmap linear", lin]);
    const circ = buildCircularMapSvg(rec);
    if (circ) figures.push(["seqmap circular", circ]);
  }
}

// --- The persistence barcode --------------------------------------------------
{
  // A noisy circle: one long H1 bar plus a spray of short ones, which is exactly
  // the case where the bar labels crowd the left margin.
  const pts: number[][] = [];
  for (let i = 0; i < 14; i++) {
    const a = (2 * Math.PI * i) / 14;
    pts.push([Math.cos(a) + 0.03 * Math.sin(7 * a), Math.sin(a) + 0.03 * Math.cos(5 * a)]);
  }
  figures.push(["persistence barcode", barcodeSvg(persistentHomology(pts, { maxDim: 1 }))]);
}

// --- The statistics charts ----------------------------------------------------
//
// Stress entries, not happy paths. Each one is the case that crowds the layout:
// the longest labels, the most rows, the widest magnitude spread - because a
// figure that reads at three tidy groups can still be unreadable at twelve.
{
  figures.push([
    "box plot 2 groups",
    boxPlotSvg(
      [
        { label: "control", values: [5, 6, 7, 8, 9] },
        { label: "treated", values: [10, 11, 12, 13, 40] },
      ],
      { title: "Response by group", ylabel: "response (mg/L)" },
    ),
  ]);
  // Twelve groups is the cap: the tightest the category labels ever get.
  figures.push([
    "box plot at the cap",
    boxPlotSvg(
      Array.from({ length: 12 }, (_, i) => ({
        label: "condition " + (i + 1),
        values: [i, i + 1, i + 2, i + 3, i + 9],
      })),
      { title: "Twelve groups, long labels", ylabel: "value" },
    ),
  ]);
  // A forest plot whose labels are long AND whose intervals span both sides of
  // the null line, so the tick labels and the row labels compete for margin.
  figures.push([
    "forest plot pairwise",
    forestPlotSvg(
      [
        { label: "control vs low dose", estimate: -2.5, low: -4.1, high: -0.9 },
        { label: "control vs mid dose", estimate: -0.4, low: -2.2, high: 1.4 },
        { label: "control vs high dose", estimate: 3.8, low: 1.9, high: 5.7 },
        { label: "low dose vs high dose", estimate: 6.3, low: 4.0, high: 8.6 },
      ],
      { title: "Tukey HSD, 95% CI on the difference", xlabel: "difference in means" },
    ),
  ]);
  figures.push([
    "grouped bars obs vs exp",
    groupedBarSvg(
      ["strongly agree", "agree", "neutral", "disagree", "strongly disagree"],
      [
        { label: "observed", values: [42, 31, 18, 7, 2] },
        { label: "expected", values: [20, 20, 20, 20, 20] },
      ],
      { title: "Goodness of fit", ylabel: "count" },
    ),
  ]);
}

export { figures };
