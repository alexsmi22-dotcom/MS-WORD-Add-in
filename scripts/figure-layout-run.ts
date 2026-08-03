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
  npshLadderSvg,
  poleZeroSvg,
  hBarSvg,
  logicWaveSvg,
  powerTriangleSvg,
  gamutTriangleSvg,
} from "../src/lib/mechchart";
import { buildPlotSvg, Series } from "../src/lib/plot";
import { weibullFit, reliabilityBlock, kOutOfN, redundancy, availability } from "../src/lib/reliability";
import { GAMUTS as GAMUT_DEFS } from "../src/lib/colourspace";

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

process.exit(runAudit(figures) ? 1 : 0);
