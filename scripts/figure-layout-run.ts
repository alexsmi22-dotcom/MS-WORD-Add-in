// Drives the figure-layout audit over every chart builder we ship.
//
//   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/figure-layout-run.ts
//
// The analyser lives in figure-layout-audit.js; the LIST is here because the
// builders are TypeScript. Cases are chosen to stress layout rather than to be
// pretty: long labels, many legend entries, values that need wide tick text,
// and curves that sweep through the corners where labels live.

declare const require: (m: string) => { runAudit: (figures: [string, string][]) => number };
declare const process: { exit(code: number): never };
const { runAudit } = require("./figure-layout-audit.js");
import {
  mohrCircleSvg,
  goodmanDiagramSvg,
  sectionShapeSvg,
  columnCurveSvg,
  trussSvg,
  torsionProfileSvg,
} from "../src/lib/mechchart";
import { buildPlotSvg, Series } from "../src/lib/plot";
import { weibullFit, reliabilityBlock, kOutOfN, redundancy, availability } from "../src/lib/reliability";

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

process.exit(runAudit(figures) ? 1 : 0);
