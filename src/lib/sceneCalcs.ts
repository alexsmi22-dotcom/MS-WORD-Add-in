// Pane glue for the Scene modelling & pipeline calculators (the "Geometric modelling of scenes and optimisation of
// digital processes" directive, 2026-10-28): Bézier curves, B-spline / NURBS curves, mesh statistics and validity,
// subdivision and polycount budgets, screen-space size and LOD switching, ray intersection and bounding volumes,
// texture memory and texel density, render farm and frame storage, and pipeline throughput (Little's law).
// Kept OUT of taskpane.ts; the integrator spreads SCENE_CALCS into ENG_CALCS under the group SCENE_GROUP.
//
// No number is computed here: sceneCurves.ts, sceneMesh.ts and scenePipeline.ts own them. This file reads the fields
// (dimensional ones through units.ts parseMeasured), words the result under the display contract (U+2212, ×10ⁿ, no
// em dash, NaN or Infinity in an ok result), opens every result with a plain-language reading built from the
// computed numbers, states what the model assumes, and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import { BEZIER_MAX_DEGREE, ARC_REL_TOL, bezierAnalyse, bezierPolyline, nurbsAnalyse, nurbsPolyline, type Vec } from "./sceneCurves";
import { MESH_MAX_VERTICES, SUBDIV_REAL_MAX_FACES, catmullClarkCounts, catmullClarkStep, countVEF, edgeMap, eulerFromCounts, loopCounts, loopStep, meshStats, parseObj } from "./sceneMesh";
import { bestSahSplit, boundingVolumes, rayBox, raySphere, rayTriangle, sahCost, unitDir, type RayHit } from "./sceneRay";
import { DEADLINE_SCAN, TEX_FORMATS, farm, frameBytes, prepareFarm, lodBands, nodesForDeadline, pipeline, rawFormat, screenSize, texelDensity, textureMemory, textureSideFor, type Depth, type FarmInput, type LodLevel, type Stage, type TexFormat } from "./scenePipeline";
import { bezierChartSvg, boundingChartSvg, farmChartSvg, lodChartSvg, meshWireframeSvg, nurbsChartSvg, polycountChartSvg, rayChartSvg, sceneBarsSvg } from "./sceneCharts";

/** The Engineering heading these calculators sit under (added to ENG_GROUP_ORDER after "Light & camera"). */
export const SCENE_GROUP = "Scene modelling & pipeline";
type SceneCalc = EngCalcDef<typeof SCENE_GROUP>;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (25 cm, 3 min, 2 h, 10 Gbps, 4 GiB) " +
  "and it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";
const SAME_UNITS_NOTE =
  "Coordinates are plain numbers in any one length unit (metres, centimetres, scene units); every length in the result " +
  "is in that unit, areas in its square and volumes in its cube.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const num = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
/** A point, with coordinates below `tiny` (rounding residue) shown as 0. */
const pt = (v: Vec, tiny = 0): string => `(${v.map((c) => num(Math.abs(c) <= tiny ? 0 : c)).join(", ")})`;
const ORD = ["", "linear", "quadratic", "cubic", "quartic", "quintic"];
const degreeWord = (n: number): string => ORD[n] ?? `degree-${n}`;

/**
 * Unit-aware field reading: errors collected, conversions reported (the laserCalcs.ts pattern).
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (m.unit.replace(/\s+/g, "") === si) return m.value;
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${num(m.value)} ${formatUnit(m.unit)} = ${num(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
  };
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;

/** A plain number (no unit): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return new RegExp(`^${NUM}$`).test(t) ? Number(t) : NaN;
}

/**
 * One scalar as a modeller writes it: a number, a fraction (1/3), or a root form (√2/2, sqrt(2)/2, 1/√2, 2√3). NaN
 * when it is none of these.
 */
function scalar(tok: string): number {
  const t = tok.trim().replace(/[−–]/g, "-").replace(/sqrt\(\s*([^)]+?)\s*\)/gi, "√$1");
  if (new RegExp(`^${NUM}$`).test(t)) return Number(t);
  let m = new RegExp(`^(${NUM})/(${NUM})$`).exec(t);
  if (m) return Number(m[2]) === 0 ? NaN : Number(m[1]) / Number(m[2]);
  m = new RegExp(`^(${NUM})?√(${NUM})(?:/(${NUM}))?$`).exec(t);
  if (m) {
    const a = m[1] === undefined ? 1 : m[1] === "-" ? -1 : Number(m[1]);
    const c = m[3] === undefined ? 1 : Number(m[3]);
    return c === 0 || Number(m[2]) < 0 ? NaN : (a * Math.sqrt(Number(m[2]))) / c;
  }
  m = new RegExp(`^(${NUM})/√(${NUM})$`).exec(t);
  if (m) return Number(m[2]) <= 0 ? NaN : Number(m[1]) / Math.sqrt(Number(m[2]));
  return NaN;
}

/** A list of scalars separated by commas, semicolons or spaces. */
function scalarList(text: string, label: string): number[] | string {
  const toks = text.trim().split(/[\s,;]+/).filter(Boolean);
  const out: number[] = [];
  for (const tok of toks) {
    const v = scalar(tok);
    if (!Number.isFinite(v)) return `${label}: "${tok}" is not a number (write 0.5, 1/3, √2/2 or sqrt(2)/2).`;
    out.push(v);
  }
  return out;
}

/** Control points, one per line: "x, y" or "x, y, z" (commas, spaces or tabs). Lines starting # are notes. */
function pointBlock(text: string, label: string): Vec[] | string {
  const out: Vec[] = [];
  const lines = (text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln || ln.startsWith("#")) continue;
    const parts = ln.replace(/^\(|\)$/g, "").split(/[\s,;]+/).filter(Boolean);
    const v = parts.map(scalar);
    if (v.some((x) => !Number.isFinite(x))) return `${label}, line ${i + 1}: "${ln}" is not a list of numbers.`;
    if (v.length !== 2 && v.length !== 3) return `${label}, line ${i + 1}: "${ln}" has ${v.length} number${v.length === 1 ? "" : "s"}; write x, y or x, y, z.`;
    out.push(v);
  }
  return out;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((row) => row.map((c) => trueMinus(c))) });

function finish(lines: EngLine[], conversions: string[] | null, extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions && conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(conversions ? UNIT_NOTE : SAME_UNITS_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Bézier curves
// ---------------------------------------------------------------------------------------------------------------

const bezierCalc: SceneCalc = {
  id: "scene-bezier",
  name: "Bézier curve: point, tangent, curvature, arc length, split, bounds",
  group: SCENE_GROUP,
  unitContract: "same-units",
  hint:
    `Control points one per line, x, y or x, y, z (2 to ${BEZIER_MAX_DEGREE + 1} points: degree 1 to ${BEZIER_MAX_DEGREE}), and a parameter t from 0 ` +
    "to 1. Evaluates C(t) by de Casteljau's construction (drawn), the tangent, principal normal and curvature from the " +
    "hodograph, the arc length by adaptive Gauss–Legendre, the two halves when split at t, the curve raised one degree, " +
    "and the tight bounding box from the roots of C′.",
  fields: [
    { key: "pts", label: "Control points P₀ … Pₙ (x, y or x, y, z per line)", default: "0, 0\n1, 2\n3, 2\n4, 0", kind: "block", rows: 5 },
    { key: "t", label: "Parameter t (0 to 1)", default: "0.5", kind: "text" },
  ],
  compute: (r) => {
    const P = pointBlock(r("pts"), "Control points");
    if (typeof P === "string") return refuse(P);
    const t = plain(r("t"));
    if (!Number.isFinite(t)) return refuse(`Parameter t: "${(r("t") ?? "").trim()}" is not a number (give a value from 0 to 1).`);
    const res = bezierAnalyse(P, t);
    if (!res.ok) return refuse(res.error);
    const n = res.degree;
    const big = Math.max(...P.flat().map(Math.abs), 1e-300);
    const tiny = 1e-13 * big;
    const lines: EngLine[] = [];
    const w = res.bounds.max.map((v, i) => v - res.bounds.min[i]);
    const box = w.map(num).join(" × ");
    if (res.degenerate) {
      lines.push(`All ${P.length} control points coincide, so this curve is the single point ${pt(P[0], tiny)}: its length is 0 and it has no tangent, normal or curvature.`);
    } else {
      const turn = res.curvature === null ? "" : res.dim === 2 ? (res.curvature > 0 ? `, turning left with radius of curvature ${num(1 / res.curvature)}` : res.curvature < 0 ? `, turning right with radius of curvature ${num(-1 / res.curvature)}` : ", running straight") : res.curvature > 0 ? `, bending with radius of curvature ${num(1 / res.curvature)}` : ", running straight";
      const heading = res.tangent ? `, heading along ${pt(res.tangent, 1e-13)}` : "";
      lines.push(`At t = ${num(t)} the ${degreeWord(n)} Bézier curve is at ${pt(res.point, tiny)}${heading}${turn}. The whole curve is ${num(res.arcLength)} long (its control polygon ${num(res.polygonLength)}) and fits a ${box} box.`);
    }
    lines.push(`Degree ${n} (${P.length} control points, ${res.dim}-D): ${P.map((q, i) => `P${sub(i)} = ${pt(q)}`).join(", ")}.`);
    lines.push({ math: "C(t) = sum(i=0, n, binom(n, i) (1 - t)^{n - i} t^i P_i)", fallback: "C(t) = Σᵢ₌₀ⁿ (n choose i)(1 − t)ⁿ⁻ⁱ tⁱ Pᵢ, evaluated by de Casteljau's repeated linear interpolation" });
    lines.push({ math: "C'(t) = n sum(i=0, n - 1, binom(n - 1, i) (1 - t)^{n - 1 - i} t^i (P_{i+1} - P_i))", fallback: "C′(t) = n Σᵢ₌₀ⁿ⁻¹ (n − 1 choose i)(1 − t)ⁿ⁻¹⁻ⁱ tⁱ (Pᵢ₊₁ − Pᵢ), the hodograph" });
    lines.push({ math: "kappa = abs(C' times C'')/abs(C')^3", fallback: "κ = |C′ × C″|/|C′|³" });
    lines.push({ math: "L = int(0, 1, abs(C'(t)) dt)", fallback: "L = ∫₀¹ |C′(t)| dt" });
    lines.push(`C(${num(t)}) = ${pt(res.point, tiny)}; C′ = ${pt(res.d1, tiny)}; C″ = ${pt(res.d2, tiny)}.`);
    if (res.tangent) lines.push(`Unit tangent T = ${pt(res.tangent, 1e-13)}${res.tangentOrder > 1 ? ` (from the order-${res.tangentOrder} derivative, since C′ = 0 here)` : ""}.`);
    if (res.normal) lines.push(`Principal normal N = ${pt(res.normal, 1e-13)} (toward the centre of curvature).`);
    if (res.curvature !== null && res.curvature !== 0)
      lines.push(`Curvature κ = ${num(res.curvature)}${res.dim === 2 ? " (signed: positive turns left)" : ""}; radius of curvature ${num(1 / Math.abs(res.curvature))}${res.normal ? `, centre ${pt(res.point.map((v, i) => v + (res.normal as Vec)[i] / Math.abs(res.curvature as number)), tiny)}` : ""}.`);
    if (res.curvatureNote) lines.push(res.curvatureNote);
    lines.push(`Arc length ${num(res.arcLength)} by adaptive 5-point Gauss–Legendre (${res.arcPanels} panels), refined until each panel's estimate and its two halves agree to ${fmtSig(ARC_REL_TOL, 1)} of the control-polygon length ${num(res.polygonLength)}${res.arcConverged ? "" : "; the refinement cap was reached first, so treat the last digits with care"}. The chord is ${num(res.chordLength)}; the arc lies between the chord and the polygon.`);
    lines.push(`Split at t = ${num(t)}: left half ${res.left.map((q) => pt(q, tiny)).join(", ")}; right half ${res.right.map((q) => pt(q, tiny)).join(", ")} (each degree ${n}, together the same curve).`);
    lines.push(`Raised to degree ${n + 1} (the same curve, one more control point): ${res.elevated.map((q) => pt(q, tiny)).join(", ")}.`);
    const axes = ["x", "y", "z"];
    lines.push(`Tight bounding box: ${res.bounds.min.map((v, i) => `${axes[i]} ${num(v)} to ${num(res.bounds.max[i])}`).join(", ")}${res.bounds.extremaT.some((e) => e.length) ? `; interior extremes at ${res.bounds.extremaT.map((e, i) => (e.length ? `${axes[i]}: t = ${e.map(num).join(", ")}` : "")).filter(Boolean).join("; ")}` : "; no interior extreme (the box is set by the end points)"}. The control polygon's box ${res.bounds.min.map((_, i) => `${num(Math.min(...P.map((q) => q[i])))} to ${num(Math.max(...P.map((q) => q[i])))}`).join(", ")} is looser (the convex hull bounds the curve).`);
    lines.push("Assumes: a polynomial (non-rational) Bézier curve in 2-D or 3-D; derivatives come from the hodograph exactly, and only the arc length is numerical (to the tolerance stated). A rational curve (weights) is the B-spline / NURBS tool's job.");
    const rows: string[][] = [["Quantity", "Value"], ["C(t)", pt(res.point, tiny)], ["Arc length", num(res.arcLength)], ["Curvature κ", res.curvature === null ? "not defined (C′ = 0)" : num(res.curvature)], ["Bounding box size", box]];
    const outputs: EngOutput[] = [
      { key: "x", label: "x at t", value: res.point[0], unit: "" },
      { key: "y", label: "y at t", value: res.point[1], unit: "" },
      { key: "arc", label: "Arc length", value: res.arcLength, unit: "" },
      { key: "boxW", label: "Bounding box width", value: w[0], unit: "" },
      { key: "boxH", label: "Bounding box height", value: w[1], unit: "" },
    ];
    if (res.curvature !== null) outputs.push({ key: "kappa", label: "Curvature", value: res.curvature, unit: "" });
    return finish(lines, null, [
      table("Bézier curve", rows),
      plot(
        bezierChartSvg({ P, curve: bezierPolyline(P), levels: res.levels, t, point: res.point, tangent: res.tangent, bmin: res.bounds.min, bmax: res.bounds.max }),
        `Degree-${n} Bézier curve with de Casteljau's construction at t = ${num(t)}`,
        "The curve in blue over its dashed control polygon, the green intermediate polygons of de Casteljau's construction converging on the red point at t with its tangent, and the dashed tight bounding box",
      ),
    ], outputs);
  },
};

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number): string => String(n).replace(/\d/g, (d) => SUBS[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------
// 2. B-spline / NURBS
// ---------------------------------------------------------------------------------------------------------------

const nurbsCalc: SceneCalc = {
  id: "scene-nurbs",
  name: "B-spline / NURBS curve: de Boor evaluation, knots, knot insertion",
  group: SCENE_GROUP,
  unitContract: "same-units",
  hint:
    "Degree p, control points one per line, a weight per point (blank: all 1, a plain B-spline) and a knot vector " +
    "(blank: clamped uniform). The knot vector is checked (non-decreasing, n + p + 1 knots, no interior knot repeated " +
    "p + 1 times); the curve is evaluated by de Boor's algorithm in homogeneous coordinates, and a knot can be inserted " +
    "(Boehm) without changing the curve. The default is the exact NURBS quarter circle (weights 1, √2/2, 1).",
  fields: [
    { key: "deg", label: "Degree p", default: "2", kind: "text" },
    { key: "pts", label: "Control points (x, y or x, y, z per line)", default: "1, 0\n1, 1\n0, 1", kind: "block", rows: 5 },
    { key: "w", label: "Weights, one per point (blank: all 1)", default: "1, √2/2, 1", kind: "text" },
    { key: "U", label: "Knot vector (blank: clamped uniform)", default: "0 0 0 1 1 1", kind: "text" },
    { key: "u", label: "Evaluate at u", default: "0.5", kind: "text" },
    { key: "ins", label: "Insert knot at (blank: none)", default: "0.5", kind: "text" },
    { key: "times", label: "Insert it how many times", default: "1", kind: "text" },
  ],
  compute: (r) => {
    const p = plain(r("deg"));
    if (!Number.isFinite(p)) return refuse(`Degree: "${(r("deg") ?? "").trim()}" is not a number.`);
    const P = pointBlock(r("pts"), "Control points");
    if (typeof P === "string") return refuse(P);
    if (P.length === 0) return refuse("Control points: give at least p + 1 points, one per line.");
    const wRaw = (r("w") ?? "").trim();
    const w = wRaw ? scalarList(wRaw, "Weights") : null;
    if (typeof w === "string") return refuse(w);
    const Uraw = (r("U") ?? "").trim();
    const U = Uraw ? scalarList(Uraw, "Knot vector") : null;
    if (typeof U === "string") return refuse(U);
    const u = scalar(r("u") ?? "");
    if (!Number.isFinite(u)) return refuse(`Evaluate at u: "${(r("u") ?? "").trim()}" is not a number.`);
    const insRaw = (r("ins") ?? "").trim();
    const ins = insRaw ? scalar(insRaw) : null;
    if (ins !== null && !Number.isFinite(ins)) return refuse(`Insert knot at: "${insRaw}" is not a number.`);
    const times = plain(r("times") || "1");
    const res = nurbsAnalyse({ P, w, p, U, u, insert: ins, times });
    if (!res.ok) return refuse(res.error);
    const big = Math.max(...P.flat().map(Math.abs), 1e-300);
    const tiny = 1e-13 * big;
    const kind = res.rational ? "NURBS" : "B-spline";
    const pieces = res.knotPoints.length - 1;
    const lines: EngLine[] = [];
    const arc = res.arc;
    if (arc && arc.exact) {
      lines.push(`This ${degreeWord(p)} ${kind} is an exact circular arc: ${num(arc.sweepDeg)}° of a circle of radius ${num(arc.radius)} about ${pt(arc.centre, tiny)}, because the middle weight ${num(res.weights[1])} equals cos(${num(arc.sweepDeg / 2)}°). At u = ${num(u)} it passes ${pt(res.point, tiny)}, and its largest radial error is ${resid(arc.maxRadialError)} (rounding only).`);
    } else {
      lines.push(`At u = ${num(u)} the ${degreeWord(p)} ${kind} (${res.n} control points, ${pieces} polynomial piece${pieces === 1 ? "" : "s"}) is at ${pt(res.point, tiny)}${res.tangent ? `, heading along ${pt(res.tangent, 1e-13)}` : ""}.${res.inserted ? ` Inserting the knot ${num(res.inserted.u)} adds ${res.inserted.times} control point${res.inserted.times === 1 ? "" : "s"} and moves the curve by ${resid(res.insertionDeviation as number)} (rounding only).` : ""}`);
    }
    lines.push(`Degree p = ${p}, ${res.n} control points, ${res.knots.length} knots${res.knotsDefaulted ? " (clamped uniform, as none were given)" : ""}: [${res.knots.map(num).join(", ")}]; parameter domain [${num(res.check.lo)}, ${num(res.check.hi)}]${res.check.clamped ? ", clamped (the curve starts at the first and ends at the last control point)" : ", unclamped (the curve does not reach the end control points)"}.`);
    lines.push(`Weights: ${res.weights.map(num).join(", ")}${res.rational ? " (rational: a NURBS)" : " (all equal: a polynomial B-spline; equal weights cancel)"}.`);
    lines.push({ math: "C(u) = (sum(i=0, n, N_i(u) w_i P_i))/(sum(i=0, n, N_i(u) w_i))", fallback: "C(u) = Σ Nᵢ(u) wᵢ Pᵢ / Σ Nᵢ(u) wᵢ, the Nᵢ the degree-p B-spline basis, evaluated by de Boor's algorithm on the homogeneous points (wᵢPᵢ, wᵢ)" });
    lines.push({ math: "N_knots = N_ctrl + p + 1", fallback: "Nknots = Nctrl + p + 1" });
    if (res.check.interior.length)
      lines.push(`Interior knots: ${res.check.interior.map((k) => `${num(k.u)} (multiplicity ${k.mult}: C${sup(k.continuity)} there)`).join(", ")}.${res.check.c0.length ? ` At ${res.check.c0.map(num).join(", ")} the multiplicity equals p, so the curve is only C⁰ there: it passes through a control point and may turn a corner.` : ""}`);
    else lines.push(`No interior knots: the curve is a single ${degreeWord(p)} piece${res.check.clamped ? " (a rational Bézier curve when clamped)" : ""}.`);
    lines.push(`C(${num(u)}) = ${pt(res.point, tiny)}; C′(${num(u)}) = ${pt(res.d1, tiny)}${res.tangent ? `; unit tangent ${pt(res.tangent, 1e-13)}` : "; C′ = 0 here, so no tangent direction"}.`);
    if (arc) {
      lines.push(`Circle test (one rational quadratic span): the legs P₀P₁ and P₁P₂ are equal, so the control triangle fits a circle of radius ${num(arc.radius)} about ${pt(arc.centre, tiny)} sweeping ${num(arc.sweepDeg)}°; the exact-circle weight is w₁/√(w₀w₂) = cos(${num(arc.sweepDeg / 2)}°) = ${num(arc.circleWeight)}. ${arc.exact ? `The weight given matches, and over 2,001 samples the distance from the centre differs from the radius by ${resid(arc.maxRadialError)}.` : `The weight given (${num(res.weights[1] / Math.sqrt(res.weights[0] * res.weights[2]))}) does not, so the curve is a conic but not this circle: its radius error reaches ${num(arc.maxRadialError)}.`}`);
      lines.push({ math: "w_1 = cos(theta/2)", fallback: "w₁ = cos(θ/2), θ the arc's sweep (√2/2 for a quarter circle)" });
    }
    if (res.inserted) {
      lines.push(`Knot insertion (Boehm): u = ${num(res.inserted.u)} inserted ${res.inserted.times} time${res.inserted.times === 1 ? "" : "s"}. New knots [${res.inserted.U.map(num).join(", ")}]; new control points ${res.inserted.P.map((q) => pt(q, tiny)).join(", ")}; weights ${res.inserted.w.map(num).join(", ")}. Largest change in the curve over 1,001 samples: ${resid(res.insertionDeviation as number)}.`);
    }
    lines.push("Assumes: a NURBS curve in 2-D or 3-D with every weight positive (a zero or negative weight lets the denominator vanish and is refused). The knot vector sets the parameterisation; the circle test applies to a single rational quadratic span in the plane.");
    const rows: string[][] = [["Quantity", "Value"], ["Degree", String(p)], ["Control points", String(res.n)], ["Polynomial pieces", String(pieces)], [`C(${num(u)})`, pt(res.point, tiny)]];
    if (arc) rows.push(["Exact-circle weight cos(θ/2)", num(arc.circleWeight)], ["Largest radial error", resid(arc.maxRadialError)]);
    if (res.inserted) rows.push(["Control points after insertion", String(res.inserted.P.length)]);
    const outputs: EngOutput[] = [
      { key: "x", label: "x at u", value: res.point[0], unit: "" },
      { key: "y", label: "y at u", value: res.point[1], unit: "" },
      { key: "pieces", label: "Polynomial pieces", value: pieces, unit: "" },
    ];
    if (arc) outputs.push({ key: "radialErr", label: "Largest radial error", value: arc.maxRadialError, unit: "" });
    const curve = nurbsPolyline(res.knots, P, res.weights, p, res.check.lo, res.check.hi);
    return finish(lines, null, [
      table(kind === "NURBS" ? "NURBS curve" : "B-spline curve", rows),
      plot(
        nurbsChartSvg({ P, curve, knotPoints: res.knotPoints, u, point: res.point, degree: p, rational: res.rational, inserted: res.inserted ? res.inserted.P : null, circle: arc && arc.exact ? { centre: arc.centre.map((c) => (Math.abs(c) <= tiny ? 0 : c)), radius: arc.radius } : null }),
        `Degree-${p} ${kind} with its control polygon and knots`,
        "The curve in blue over its dashed control polygon, green crosses where the curve passes each knot, the red point at u, and the refined control polygon after knot insertion in purple",
      ),
    ], outputs);
  },
};

/**
 * A rounding residue in words: below 10⁻¹⁵ it is "under 10⁻¹⁵", because its last digits come from acos/tan/cos rounding
 * and differ between JavaScript engines (WebView2 on Windows, JavaScriptCore on the Mac); above, the value.
 */
const resid = (x: number): string => (Math.abs(x) < 1e-15 ? "under 10⁻¹⁵" : `at most ${fmtSig(x, 2)}`);

const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number): string => String(n).replace(/\d/g, (d) => SUPS[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------
// Shared readers for counts and fractions
// ---------------------------------------------------------------------------------------------------------------

/**
 * A whole-number count field (no unit): the value, or a refusal naming the field. A typed unit is refused rather than
 * stripped ("4 GB" in a count field is a mistake, not a count).
 */
function countField(v: string | undefined, label: string, min: number, max: number): number | string {
  const t = (v ?? "").trim().replace(/,(?=\d{3}\b)/g, "");
  if (!t) return `${label}: this field is required.`;
  const x = plain(t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a plain number (this field takes a count, with no unit).`;
  if (!Number.isInteger(x)) return `${label}: ${num(x)} is not a whole number.`;
  if (x < min) return `${label}: ${num(x)} is below ${min.toLocaleString("en-US")}${min === 1 ? " (at least one is needed)" : ""}.`;
  if (x > max) return `${label}: ${num(x)} is above the cap of ${max.toLocaleString("en-US")}.`;
  return x;
}

/** A plain non-negative number field with no unit (bytes per vertex, a cost per hour, a ratio). */
function plainField(v: string | undefined, label: string, opts: { min?: number; positive?: boolean; max?: number } = {}): number | string {
  const t = (v ?? "").trim();
  if (!t) return `${label}: this field is required.`;
  const x = plain(t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a plain number (this field takes no unit).`;
  if (opts.positive && !(x > 0)) return `${label}: ${num(x)} must be greater than 0.`;
  if (opts.min !== undefined && x < opts.min) return `${label}: ${num(x)} is below ${num(opts.min)}.`;
  if (opts.max !== undefined && x > opts.max) return `${label}: ${num(x)} is above ${num(opts.max)}.`;
  return x;
}

/** A fraction field: "0.8" or "80 %". A bare number above 1 is refused rather than read as a percentage. */
function fractionField(v: string | undefined, label: string): number | string {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: this field is required.`;
  const pc = /^(.*?)\s*%$/.exec(t);
  const x = plain(pc ? pc[1] : t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a number (write 0.8, or 80 %).`;
  if (!pc && x > 1) return `${label}: ${num(x)} is above 1. Give a fraction from 0 to 1: write ${num(x / 100)}, or ${num(x)} % if a percentage was meant.`;
  const f = pc ? x / 100 : x;
  if (f < 0 || f > 1) return `${label}: ${num(f * 100)} % is outside 0 to 100 %.`;
  return f;
}

/** Bytes with binary prefixes (as GPUs and file systems report), and the decimal form beside it. */
function bytes(b: number): string {
  const P: Array<[number, string]> = [[2 ** 40, "TiB"], [2 ** 30, "GiB"], [2 ** 20, "MiB"], [2 ** 10, "KiB"]];
  for (const [f, u] of P) if (b >= f) return `${num(b / f)} ${u}`;
  return `${num(b)} B`;
}
const dec = (b: number): string => {
  const P: Array<[number, string]> = [[1e12, "TB"], [1e9, "GB"], [1e6, "MB"], [1e3, "kB"]];
  for (const [f, u] of P) if (b >= f) return `${num(b / f)} ${u}`;
  return `${num(b)} B`;
};
const int = (v: number | bigint): string => (typeof v === "bigint" ? v.toLocaleString("en-US") : Math.round(v).toLocaleString("en-US"));
/** A duration in its natural unit. */
function dur(s: number): string {
  if (s >= 86400 * 2) return `${num(s / 86400)} days`;
  if (s >= 3600) return `${num(s / 3600)} h`;
  if (s >= 60) return `${num(s / 60)} min`;
  return `${num(s)} s`;
}
const pct = (x: number): string => `${fmtSig(x * 100, 4).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "")} %`;

// ---------------------------------------------------------------------------------------------------------------
// 3. Mesh statistics and validity
// ---------------------------------------------------------------------------------------------------------------

const CUBE_OBJ = [
  "# a cube, 1-based OBJ, faces wound counter-clockwise seen from outside",
  "v -1 -1 -1",
  "v 1 -1 -1",
  "v 1 1 -1",
  "v -1 1 -1",
  "v -1 -1 1",
  "v 1 -1 1",
  "v 1 1 1",
  "v -1 1 1",
  "f 1 4 3 2",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 2 3 7 6",
  "f 3 4 8 7",
  "f 4 1 5 8",
].join("\n");

const BASE_OPTIONS = [
  { value: "obj", label: "OBJ (1-based; negative counts back)" },
  { value: "zero", label: "0-based list (from code)" },
];

const meshCalc: SceneCalc = {
  id: "scene-mesh",
  name: "Mesh statistics & validity: Euler characteristic, genus, area, volume",
  group: SCENE_GROUP,
  unitContract: "same-units",
  hint:
    `Paste an OBJ-style mesh (v x y z and f lines; up to ${MESH_MAX_VERTICES.toLocaleString("en-US")} vertices and faces), or give V, E, F counts. ` +
    "Gives the Euler characteristic and genus of a closed orientable surface, boundary, non-manifold and inconsistently " +
    "wound edges (with orientability), surface area, signed volume by the divergence theorem, centroids, the bounding " +
    "box, and triangle, quad and n-gon counts with the triangle count after triangulation.",
  fields: [
    { key: "mode", label: "Input", default: "obj", kind: "select", options: [{ value: "obj", label: "A mesh (OBJ v / f lines)" }, { value: "counts", label: "Counts only (V, E, F)" }] },
    { key: "obj", label: "Mesh (v x y z / f i j k … lines)", default: CUBE_OBJ, kind: "block", rows: 8 },
    { key: "base", label: "Index base", default: "obj", kind: "select", options: BASE_OPTIONS },
    { key: "vef", label: "Counts V, E, F (counts mode)", default: "8, 12, 6", kind: "text" },
    { key: "comp", label: "Connected pieces (counts mode)", default: "1", kind: "text" },
  ],
  compute: (r) => {
    if (r("mode") === "counts") {
      const parts = (r("vef") ?? "").split(/[\s,;]+/).filter(Boolean);
      if (parts.length !== 3) return refuse(`Counts: give three whole numbers V, E, F (e.g. 8, 12, 6); "${(r("vef") ?? "").trim()}" has ${parts.length}.`);
      const vals: number[] = [];
      for (const [i, s] of parts.entries()) {
        const c = countField(s, ["V", "E", "F"][i], 0, 1e12);
        if (typeof c === "string") return refuse(c);
        vals.push(c);
      }
      const comp = countField(r("comp"), "Connected pieces", 1, 1e6);
      if (typeof comp === "string") return refuse(comp);
      const [V, E, F] = vals;
      const res = eulerFromCounts(V, E, F, comp);
      const lines: EngLine[] = [];
      lines.push(res.genus !== null
        ? `With ${int(V)} vertices, ${int(E)} edges and ${int(F)} faces, χ = ${res.chi}: if this is a closed, orientable surface in ${comp} piece${comp === 1 ? "" : "s"}, it has genus ${res.genus} (${res.genus === 0 ? "sphere-like, no handles" : `${res.genus} handle${res.genus === 1 ? "" : "s"}, like a ${res.genus === 1 ? "torus" : `${res.genus}-holed torus`}`}).`
        : `With ${int(V)} vertices, ${int(E)} edges and ${int(F)} faces, χ = ${res.chi}, which no closed orientable surface in ${comp} piece${comp === 1 ? "" : "s"} has.`);
      lines.push({ math: "chi = V - E + F", fallback: "χ = V − E + F" });
      lines.push({ math: "g = (2 c - chi)/2", fallback: "g = (2c − χ)/2 for a closed orientable surface in c pieces" });
      if (res.note) lines.push(res.note);
      lines.push("Assumes: counts alone cannot show whether the surface is closed, manifold or consistently wound; the genus is what a closed orientable surface with these counts would have. Paste the mesh itself to check.");
      return finish(lines, null, [
        table("Euler characteristic", [["Quantity", "Value"], ["V", int(V)], ["E", int(E)], ["F", int(F)], ["χ = V − E + F", String(res.chi)], ["Genus (if closed and orientable)", res.genus === null ? "not a closed orientable surface" : String(res.genus)]]),
        plot(sceneBarsSvg([{ name: "Vertices V", value: V, text: int(V) }, { name: "Edges E", value: E, text: int(E), colour: "#c00000" }, { name: "Faces F", value: F, text: int(F) }, { name: "χ = V − E + F", value: res.chi, text: String(res.chi).replace("-", "−"), colour: "#2e7d32" }], "Euler characteristic from the counts", ""), "V, E, F and χ", "Horizontal bars of the vertex, edge and face counts and the Euler characteristic"),
      ], [{ key: "chi", label: "Euler characteristic", value: res.chi, unit: "" }, ...(res.genus !== null ? [{ key: "genus", label: "Genus", value: res.genus, unit: "" }] : [])]);
    }
    const base = r("base") === "zero" ? "zero" : "obj";
    const mesh = parseObj(r("obj") ?? "", base);
    if (!("V" in mesh)) return refuse(mesh.error);
    const s = meshStats(mesh);
    const diag = Math.hypot(...s.bmax.map((v, i) => v - s.bmin[i]));
    const tiny = 1e-12 * Math.max(diag, 1e-300);
    const lines: EngLine[] = [];
    const many = (n: number, w: string): string => `${int(n)} ${w}${n === 1 ? "" : w.endsWith("x") ? "es" : "s"}`;
    const counts = `${many(s.referenced, "vertex").replace("vertexes", "vertices")}, ${many(s.edges, "edge")} and ${many(s.faces, "face")} (χ = ${s.chi})`;
    const valid = s.closed && s.inconsistentEdges.length === 0;
    if (s.nonManifoldEdges.length)
      lines.push(`This mesh is not a manifold surface: ${s.nonManifoldEdges.length} edge${s.nonManifoldEdges.length === 1 ? " is" : "s are"} shared by three or more faces, so it has no well-defined inside, volume or genus. It has ${counts}.`);
    else if (!s.closed)
      lines.push(`This mesh is open: ${s.boundaryEdges.length} boundary edge${s.boundaryEdges.length === 1 ? "" : "s"} form${s.boundaryEdges.length === 1 ? "s" : ""} ${s.boundaryLoops} hole${s.boundaryLoops === 1 ? "" : "s"}, so it encloses no volume${s.orientable === false ? " and it is non-orientable (a Möbius-like twist)" : ""}. It has ${counts} and a surface area of ${num(s.area)}.`);
    else if (s.orientable === false)
      lines.push(`This closed mesh is non-orientable (no choice of face directions is consistent, like a Klein bottle), so it has no inside and no volume. It has ${counts} and a surface area of ${num(s.area)}.`);
    else if (s.inconsistentEdges.length)
      lines.push(`This closed mesh is wound inconsistently (${s.inconsistentEdges.length} edges run the same way in both faces); flipping ${s.flipsNeeded} face${s.flipsNeeded === 1 ? "" : "s"} fixes it, and until then its volume is wrong. It has ${counts}, genus ${s.genus ?? "undetermined"}.`);
    else
      lines.push(`This is a closed, consistently wound surface of genus ${s.genus}${s.genus === 0 ? " (sphere-like, a solid with no handles)" : ` (${s.genus} handle${s.genus === 1 ? ", like a torus" : "s"})`}: ${counts}, surface area ${num(s.area)} and ${s.volume < 0 ? `volume ${num(-s.volume)} once it is turned the right way out` : `volume ${num(s.volume)}`}.`);
    lines.push(`Read ${int(s.vertices)} vertices${s.isolated ? ` (${int(s.isolated)} isolated: used by no face, left out of χ; counting them, V − E + F = ${s.chi + s.isolated})` : ""} and ${int(s.faces)} faces: ${int(s.tris)} triangle${s.tris === 1 ? "" : "s"}, ${int(s.quads)} quad${s.quads === 1 ? "" : "s"}, ${int(s.ngons)} n-gon${s.ngons === 1 ? "" : "s"} (5 or more sides); ${int(s.triangulated)} triangles after triangulation (Σ(k − 2) over faces of k sides).${mesh.ignored.length ? ` Skipped: ${mesh.ignored.join(", ")}.` : ""}`);
    lines.push({ math: "chi = V - E + F", fallback: "χ = V − E + F" });
    lines.push({ math: "g = (2 c - chi)/2", fallback: "g = (2c − χ)/2 for a closed orientable surface in c pieces" });
    lines.push({ math: "V = (1/6) sum(k=1, T, a_k dot (b_k times c_k))", fallback: "V = (1/6) Σₖ₌₁ᵀ aₖ · (bₖ × cₖ) over the T triangles (aₖ, bₖ, cₖ), the divergence theorem" });
    lines.push(`Topology: ${s.components} connected piece${s.components === 1 ? "" : "s"}; ${s.boundaryEdges.length} boundary edge${s.boundaryEdges.length === 1 ? "" : "s"}${s.boundaryEdges.length ? ` in ${s.boundaryLoops} loop${s.boundaryLoops === 1 ? "" : "s"}` : ""}; ${s.nonManifoldEdges.length} non-manifold edge${s.nonManifoldEdges.length === 1 ? "" : "s"}; ${s.inconsistentEdges.length} inconsistently wound edge${s.inconsistentEdges.length === 1 ? "" : "s"}. Orientable: ${s.orientable === null ? "not tested (non-manifold edges)" : s.orientable ? `yes${s.flipsNeeded ? ` (after flipping ${s.flipsNeeded} face${s.flipsNeeded === 1 ? "" : "s"})` : ""}` : "no"}. ${s.genus !== null ? `Genus ${s.genus}.` : "Genus is defined for a closed orientable surface only."}`);
    const ix = (e: [number, number]): string => `${base === "obj" ? e[0] + 1 : e[0]}–${base === "obj" ? e[1] + 1 : e[1]}`;
    if (s.nonManifoldEdges.length) lines.push(`Non-manifold edges (vertex indices as typed): ${s.nonManifoldEdges.slice(0, 12).map(ix).join(", ")}${s.nonManifoldEdges.length > 12 ? " …" : ""}.`);
    if (s.boundaryEdges.length) lines.push(`Boundary edges: ${s.boundaryEdges.slice(0, 12).map(ix).join(", ")}${s.boundaryEdges.length > 12 ? " …" : ""}.`);
    if (s.inconsistentEdges.length) lines.push(`Inconsistently wound edges: ${s.inconsistentEdges.slice(0, 12).map(ix).join(", ")}${s.inconsistentEdges.length > 12 ? " …" : ""}.`);
    lines.push(`Surface area ${num(s.area)}${s.zeroAreaFaces ? ` (${s.zeroAreaFaces} face${s.zeroAreaFaces === 1 ? " has" : "s have"} zero area)` : ""}; area-weighted surface centroid ${pt(s.surfaceCentroid, tiny)}.`);
    if (valid && s.orientable) {
      lines.push(`Signed volume ${num(s.volume)}${s.volume < 0 ? ": negative, so the faces are wound clockwise seen from outside (inside-out); flip every face and it is " + num(-s.volume) : ""}.${s.volumeCentroid ? ` Volume centroid (centre of mass at uniform density) ${pt(s.volumeCentroid, tiny)}.` : ""}`);
    } else {
      lines.push(`The divergence-theorem sum gives ${num(s.volume)}, but it is not a volume here: ${!s.closed ? "the surface is open, so the sum depends on where the origin is" : s.orientable === false ? "the surface has no consistent outside" : "inconsistent winding cancels parts of the sum"}.`);
    }
    lines.push(`Bounding box ${pt(s.bmin, tiny)} to ${pt(s.bmax, tiny)}: ${s.bmax.map((v, i) => num(v - s.bmin[i])).join(" × ")}, diagonal ${num(diag)}.`);
    if (s.nonPlanar) lines.push(`${s.nonPlanar} face${s.nonPlanar === 1 ? " is" : "s are"} not planar: area and volume use a fan triangulation from each face's first vertex, and another triangulation gives slightly different numbers.`);
    lines.push("Assumes: faces are simple polygons triangulated as fans from their first vertex; edges are shared by vertex index (coincident but separately numbered vertices are NOT welded, so a mesh exported with split normals or UV seams reads as open there); the volume is meaningful only for a closed, consistently wound, orientable surface.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["V, E, F", `${int(s.referenced)}, ${int(s.edges)}, ${int(s.faces)}`],
      ["χ = V − E + F", String(s.chi)],
      ["Genus", s.genus === null ? "not a closed orientable surface" : String(s.genus)],
      ["Boundary / non-manifold / inconsistent edges", `${s.boundaryEdges.length} / ${s.nonManifoldEdges.length} / ${s.inconsistentEdges.length}`],
      ["Triangles / quads / n-gons", `${int(s.tris)} / ${int(s.quads)} / ${int(s.ngons)}`],
      ["Triangles after triangulation", int(s.triangulated)],
      ["Surface area", num(s.area)],
      ["Volume", valid && s.orientable ? num(s.volume) : "not defined (not a closed, consistent surface)"],
    ];
    const outputs: EngOutput[] = [
      { key: "chi", label: "Euler characteristic", value: s.chi, unit: "" },
      { key: "area", label: "Surface area", value: s.area, unit: "" },
      { key: "tris", label: "Triangles after triangulation", value: s.triangulated, unit: "" },
      { key: "boundary", label: "Boundary edges", value: s.boundaryEdges.length, unit: "" },
    ];
    if (valid && s.orientable) outputs.push({ key: "volume", label: "Volume", value: s.volume, unit: "" });
    if (s.genus !== null) outputs.push({ key: "genus", label: "Genus", value: s.genus, unit: "" });
    const edges = [...edgeMap(mesh.F).values()].map((e): [number, number] => [e.a, e.b]);
    return finish(lines, null, [
      table("Mesh statistics", rows),
      plot(meshWireframeSvg({ V: mesh.V, edges, boundary: s.boundaryEdges, nonManifold: s.nonManifoldEdges, inconsistent: s.inconsistentEdges }), "Orthographic wireframe with problem edges highlighted", "The mesh's edges in grey from a three-quarter view, boundary edges orange, non-manifold edges red and inconsistently wound edges purple"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Subdivision and polycount budget
// ---------------------------------------------------------------------------------------------------------------

const SUBDIV_MAX_LEVELS = 10;

const subdivCalc: SceneCalc = {
  id: "scene-subdiv",
  name: "Subdivision & polycount budget: Catmull–Clark and Loop levels, memory",
  group: SCENE_GROUP,
  unitContract: "domain",
  hint:
    "A base mesh (OBJ v / f lines), the scheme and the number of levels. Gives V, E, F and the triangle count at every " +
    "level (Catmull–Clark: F₁ = Σ face valences, all quads after; Loop: ×4 triangles), checked against a real subdivision " +
    "of the mesh while it stays small, the memory per level from the bytes per vertex and per index, and the level at " +
    "which a triangle budget is exceeded. Bytes and counts are plain numbers.",
  fields: [
    { key: "scheme", label: "Scheme", default: "cc", kind: "select", options: [{ value: "cc", label: "Catmull–Clark (any polygons; quads after level 1)" }, { value: "loop", label: "Loop (triangle meshes)" }] },
    { key: "obj", label: "Base mesh (v / f lines, 1-based OBJ)", default: CUBE_OBJ, kind: "block", rows: 8 },
    { key: "levels", label: `Levels (1 to ${SUBDIV_MAX_LEVELS})`, default: "6", kind: "text" },
    { key: "bpv", label: "Bytes per vertex (position, normal, UV …)", default: "32", kind: "text" },
    { key: "bpi", label: "Bytes per index (2 or 4)", default: "4", kind: "text" },
    { key: "budget", label: "Triangle budget (blank: none)", default: "10000", kind: "text" },
  ],
  compute: (r) => {
    const scheme = r("scheme") === "loop" ? "loop" : "cc";
    const mesh = parseObj(r("obj") ?? "", "obj");
    if (!("V" in mesh)) return refuse(mesh.error);
    const levels = countField(r("levels"), "Levels", 1, SUBDIV_MAX_LEVELS);
    if (typeof levels === "string") return refuse(levels);
    const bpv = plainField(r("bpv"), "Bytes per vertex", { positive: true, max: 4096 });
    if (typeof bpv === "string") return refuse(bpv);
    const bpi = plainField(r("bpi"), "Bytes per index", { positive: true, max: 8 });
    if (typeof bpi === "string") return refuse(bpi);
    const budgetRaw = (r("budget") ?? "").trim();
    const budget = budgetRaw ? countField(budgetRaw, "Triangle budget", 1, 1e15) : null;
    if (typeof budget === "string") return refuse(budget);
    const s = meshStats(mesh);
    if (s.nonManifoldEdges.length) return refuse(`The base mesh has ${s.nonManifoldEdges.length} non-manifold edge${s.nonManifoldEdges.length === 1 ? "" : "s"} (three or more faces on one edge): ${scheme === "cc" ? "Catmull–Clark" : "Loop"} subdivision is defined on manifold meshes. Fix the mesh first (the Mesh statistics tool lists them).`);
    if (scheme === "loop" && s.quads + s.ngons > 0) return refuse(`Loop subdivision works on triangles only, and this mesh has ${s.quads + s.ngons} face${s.quads + s.ngons === 1 ? "" : "s"} with 4 or more sides. Triangulate it first (it would give ${int(s.triangulated)} triangles), or use Catmull–Clark.`);
    if (s.isolated) return refuse(`${s.isolated} vertex${s.isolated === 1 ? " is" : "es are"} used by no face; remove ${s.isolated === 1 ? "it" : "them"} so the vertex counts describe the surface.`);
    const counts = scheme === "cc" ? catmullClarkCounts(s.referenced, s.edges, s.faces, s.corners, s.triangulated, levels) : loopCounts(s.referenced, s.edges, s.faces, levels);
    // The real subdivision, while it stays small: its counts must equal the formulas.
    let real: { V: Vec[]; F: number[][] } = { V: mesh.V, F: mesh.F };
    let verified = 0;
    const firstMove: { from: Vec; to: Vec } | null = { from: mesh.V[mesh.F[0][0]], to: [] };
    for (let l = 1; l <= levels; l++) {
      if (Number(counts[l].F) > SUBDIV_REAL_MAX_FACES) break;
      real = scheme === "cc" ? catmullClarkStep(real) : loopStep(real);
      const c = countVEF(real);
      if (BigInt(c.V) !== counts[l].V || BigInt(c.E) !== counts[l].E || BigInt(c.F) !== counts[l].F)
        return refuse(`Internal check failed at level ${l}: the real subdivision has V, E, F = ${c.V}, ${c.E}, ${c.F} but the count formulas give ${counts[l].V}, ${counts[l].E}, ${counts[l].F}. Please report this mesh.`);
      if (l === 1 && firstMove) firstMove.to = real.V[mesh.F[0][0]];
      verified = l;
    }
    const mem = counts.map((c) => Number(c.V) * bpv + 3 * Number(c.T) * bpi);
    const over = budget === null ? null : counts.find((c) => Number(c.T) > budget) ?? null;
    const last = counts[levels];
    const lines: EngLine[] = [];
    const name = scheme === "cc" ? "Catmull–Clark" : "Loop";
    lines.push(`${name} subdivision takes this ${int(s.faces)}-face mesh to ${int(last.F)} ${scheme === "cc" ? "quads" : "triangles"} (${int(last.T)} triangles to draw, about ${bytes(mem[levels])}) after ${levels} level${levels === 1 ? "" : "s"}.${budget !== null ? (over ? ` A ${int(budget)}-triangle budget is exceeded at level ${over.level}, so level ${over.level - 1} is the deepest that fits.` : ` Every level fits a ${int(budget)}-triangle budget.`) : ""}`);
    if (scheme === "cc") {
      lines.push({ math: "V' = V + E + F", fallback: "V′ = V + E + F (a new point per edge and per face)" });
      lines.push({ math: "E' = 2 E + sum(f, , k_f)", fallback: "E′ = 2E + Σ k_f (each edge splits; each face of k sides adds k edges)" });
      lines.push({ math: "F' = sum(f, , k_f)", fallback: "F′ = Σ k_f (each face of k sides becomes k quads); then F′ = 4F" });
    } else {
      lines.push({ math: "V' = V + E", fallback: "V′ = V + E" });
      lines.push({ math: "E' = 2 E + 3 F", fallback: "E′ = 2E + 3F" });
      lines.push({ math: "F' = 4 F", fallback: "F′ = 4F" });
    }
    lines.push({ math: "M = V b_v + 3 T b_i", fallback: "Memory = V·bᵥ + 3T·bᵢ (vertex buffer plus a triangle index buffer)" });
    lines.push(`Base mesh: V = ${int(s.referenced)}, E = ${int(s.edges)}, F = ${int(s.faces)} (${int(s.tris)} triangles, ${int(s.quads)} quads, ${int(s.ngons)} n-gons; Σ face valences ${int(s.corners)}); χ = ${s.chi}, which subdivision preserves at every level.`);
    lines.push(verified
      ? `Verified: the mesh was subdivided for real through level ${verified}${verified < levels ? ` (deeper levels pass ${int(SUBDIV_REAL_MAX_FACES)} faces and are counted by the formulas alone)` : ""}, and its V, E, F match the formulas at every level.${firstMove && firstMove.to.length ? ` Its first vertex moves from ${pt(firstMove.from, 1e-12)} to ${pt(firstMove.to, 1e-12)} at level 1.` : ""}`
      : `The first level already passes ${int(SUBDIV_REAL_MAX_FACES)} faces, so the counts come from the formulas alone.`);
    const rows: string[][] = [["Level", "Vertices", "Edges", "Faces", "Triangles", "Memory"]];
    counts.forEach((c, i) => rows.push([String(c.level), int(c.V), int(c.E), int(c.F), int(c.T), bytes(mem[i])]));
    lines.push(`Memory at ${num(bpv)} bytes per vertex and ${num(bpi)} bytes per index: ${counts.map((c, i) => `level ${c.level} ${bytes(mem[i])}`).join(", ")}.${bpi === 2 && Number(last.V) > 65536 ? ` Level ${counts.find((c) => Number(c.V) > 65536)?.level} has more than 65,536 vertices, which 2-byte indices cannot address: it needs 4-byte indices.` : ""}`);
    if (Number(last.T) > 2 ** 31) lines.push("The deepest levels pass 2³¹ triangles: beyond what one draw call or a 32-bit index buffer can hold.");
    lines.push(`Assumes: the counts are exact for any manifold mesh (boundaries included); memory counts one vertex buffer and one triangle index buffer (${scheme === "cc" ? "each quad drawn as two triangles" : "one index triple per triangle"}), with no per-corner vertex splitting for UV seams or hard edges, no adjacency data and no GPU padding. Positions use ${scheme === "cc" ? "Catmull–Clark's rules (the cubic B-spline crease on a boundary)" : "Loop's rules with Warren's β (the cubic B-spline crease on a boundary)"}.`);
    const outputs: EngOutput[] = [
      { key: "faces", label: `Faces at level ${levels}`, value: Number(last.F), unit: "" },
      { key: "tris", label: `Triangles at level ${levels}`, value: Number(last.T), unit: "" },
      { key: "memory", label: `Memory at level ${levels}`, value: mem[levels], unit: "B" },
    ];
    if (over) outputs.push({ key: "budgetLevel", label: "Level exceeding the budget", value: over.level, unit: "" });
    return finish(lines, null, [
      table(`${name} levels`, rows),
      plot(polycountChartSvg(counts.map((c) => ({ level: c.level, T: Number(c.T) })), budget, "Triangles"), `Triangles per ${name} level${budget !== null ? " against the budget" : ""}`, "Triangle count against subdivision level on a logarithmic axis, a straight line of slope four per level after the first, with the budget as a horizontal line"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Screen-space size and LOD
// ---------------------------------------------------------------------------------------------------------------

const lodCalc: SceneCalc = {
  id: "scene-lod",
  name: "Screen-space size & LOD switch distances",
  group: SCENE_GROUP,
  unitContract: "converts",
  hint:
    "An object's bounding radius and distance, the camera's vertical field of view and the image height in pixels give its " +
    "projected size. For a list of levels of detail (name, geometric error, triangles; finest first), each level's switch " +
    "distance is where its error projects to the pixel tolerance, f·ε/τ; the triangle density on screen warns of " +
    "sub-pixel triangles. Perspective projection only (the camera and lens tools cover the rest).",
  fields: [
    { key: "fov", label: "Vertical field of view (°)", default: "60°", kind: "text" },
    { key: "res", label: "Image height (pixels)", default: "1080", kind: "text" },
    { key: "r", label: "Object bounding radius (m)", default: "1 m", kind: "text" },
    { key: "d", label: "Distance to the object's centre (m)", default: "20 m", kind: "text" },
    { key: "tol", label: "Pixel error tolerance (pixels)", default: "1", kind: "text" },
    { key: "lods", label: "LODs: name, geometric error, triangles (finest first)", default: "LOD0, 0.5 mm, 80000\nLOD1, 2 mm, 20000\nLOD2, 8 mm, 5000\nLOD3, 30 mm, 1200", kind: "block", rows: 5 },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const fovDeg = u.req("fov", "°", "°", "Field of view");
    const rad = u.req("r", "m", "m", "Bounding radius");
    const d = u.req("d", "m", "m", "Distance");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const H = countField(r("res"), "Image height", 1, 100000);
    if (typeof H === "string") return refuse(H);
    const tol = plainField(r("tol"), "Pixel error tolerance", { positive: true });
    if (typeof tol === "string") return refuse(tol);
    if (!(fovDeg > 0 && fovDeg < 180)) return refuse(`Field of view: ${num(fovDeg)}° is outside the 0° to 180° a perspective camera can have.`);
    if (!(rad > 0)) return refuse("Bounding radius: give a radius greater than 0.");
    if (!(d > rad)) return refuse(`Distance: ${num(d)} m is not beyond the bounding radius ${num(rad)} m, so the camera is inside the object's bounding sphere and it has no projected size (it fills the view).`);
    const levels: LodLevel[] = [];
    const lodLines = (r("lods") ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!lodLines.length) return refuse("LODs: give at least one line: name, geometric error, triangles.");
    if (lodLines.length > 12) return refuse(`${lodLines.length} LODs: the cap is 12.`);
    for (const [i, ln] of lodLines.entries()) {
      const parts = ln.split(",").map((x) => x.trim());
      if (parts.length !== 3) return refuse(`LODs, line ${i + 1}: "${ln}" needs three parts separated by commas: name, geometric error, triangles.`);
      const e = parseMeasured(parts[1].replace(/[−–]/g, "-"), "m");
      if ("error" in e) return refuse(`LODs, line ${i + 1}, error: ${e.error}`);
      if (!e.assumed && e.unit !== "m") u.conversions.push(`${parts[0]} error: ${num(e.value)} ${formatUnit(e.unit)} = ${num(e.inTarget)} m`);
      const t = countField(parts[2], `LODs, line ${i + 1}, triangles`, 1, 1e10);
      if (typeof t === "string") return refuse(t);
      if (!(e.inTarget >= 0)) return refuse(`LODs, line ${i + 1}: a geometric error cannot be negative.`);
      levels.push({ name: parts[0] || `LOD${i}`, error: e.inTarget, triangles: t });
    }
    for (let i = 1; i < levels.length; i++)
      if (!(levels[i].error > levels[i - 1].error)) return refuse(`LODs: ${levels[i].name}'s error (${num(levels[i].error)} m) is not larger than ${levels[i - 1].name}'s (${num(levels[i - 1].error)} m). List the levels finest first, each coarser than the one before.`);
    const fov = (fovDeg * Math.PI) / 180;
    const sz = screenSize(rad, d, fov, H);
    const bands = lodBands(levels, sz.focal, tol);
    let current = bands[0];
    for (const b of bands) if (b.switchDistance <= d) current = b;
    const front = current.triangles / 2;
    const pxPerTri = sz.areaPx / front;
    const lines: EngLine[] = [];
    const next = bands.find((b) => b.switchDistance > d);
    lines.push(`At ${num(d)} m the object is ${num(2 * sz.radiusPx)} px across (${pct(sz.heightFraction)} of the ${int(H)}-pixel height), so ${current.name} is the coarsest level that keeps the error within ${num(tol)} px${next ? `; ${next.name} takes over beyond ${num(next.switchDistance)} m` : ""}. ${pxPerTri < 1 ? `Its triangles are smaller than a pixel on screen (${num(pxPerTri)} px each), which wastes rasterisation and aliases.` : `Its visible triangles cover about ${num(pxPerTri)} px each.`}`);
    lines.push({ math: "f = (H/2)/tan(theta/2)", fallback: "f = (H/2)/tan(θ/2), the focal length in pixels" });
    lines.push({ math: "r_px = f r/d", fallback: "r(px) = f·r/d" });
    lines.push({ math: "d_i = f epsilon_i/tau", fallback: "dᵢ = f·εᵢ/τ, where level i's error projects to the tolerance" });
    lines.push(`Focal length ${num(sz.focal)} px for a ${num(fovDeg)}° vertical field over ${int(H)} rows. Projected radius f·r/d = ${num(sz.radiusPx)} px (the exact silhouette of a sphere at the image centre, f·r/√(d² − r²), is ${num(sz.radiusPxExact)} px); projected area about ${num(sz.areaPx)} px².`);
    lines.push(`Switch distances at ${num(tol)} px: ${bands.map((b) => `${b.name} (error ${num(b.error * 1000)} mm, ${int(b.triangles)} triangles) is within tolerance beyond ${num(b.switchDistance)} m`).join("; ")}.`);
    lines.push(`At ${num(d)} m: ${current.name}, ${int(current.triangles)} triangles, about half (${int(front)}) facing the camera on a closed object, over ${num(sz.areaPx)} px²: ${num(pxPerTri)} px per visible triangle${pxPerTri < 1 ? " (sub-pixel: aliasing and wasted work)" : pxPerTri < 10 ? " (small: GPUs shade in 2 × 2 pixel quads, so triangles of a few pixels shade several times their area)" : ""}.`);
    lines.push("Assumes: a symmetric perspective camera; the object's bounding sphere near the image centre (off-axis it projects slightly larger); the geometric error is each level's largest deviation from the full-detail surface, viewed face-on (its worst case); switching on screen-space error alone, with no hysteresis band.");
    const rows: string[][] = [["LOD", "Error (mm)", "Triangles", "Within tolerance beyond (m)"]];
    for (const b of bands) rows.push([b.name, num(b.error * 1000), int(b.triangles), num(b.switchDistance)]);
    const outputs: EngOutput[] = [
      { key: "diameterPx", label: "Projected diameter", value: 2 * sz.radiusPx, unit: "px" },
      { key: "focal", label: "Focal length", value: sz.focal, unit: "px" },
      { key: "pxPerTri", label: "Pixels per visible triangle", value: pxPerTri, unit: "px" },
      ...bands.slice(1).map((b, i) => ({ key: `switch${i + 1}`, label: `${b.name} switch distance`, value: b.switchDistance, unit: "m" })),
    ];
    return finish(lines, u.conversions, [
      table("LOD switch distances", rows),
      plot(lodChartSvg({ focal: sz.focal, r: rad, bands, d }), "Projected diameter against distance with the LOD switch distances", "The object's projected diameter in pixels falling with distance on log–log axes, vertical lines where each coarser level of detail becomes acceptable, and the current distance marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Ray intersection
// ---------------------------------------------------------------------------------------------------------------

function vec3(text: string | undefined, label: string, n = 3): Vec | string {
  const parts = (text ?? "").replace(/^\(|\)$/g, "").split(/[\s,;]+/).filter(Boolean);
  const v = parts.map(scalar);
  if (v.length !== n || v.some((x) => !Number.isFinite(x))) return `${label}: give ${n} numbers separated by commas (x, y, z${n === 4 ? ", radius" : n === 6 ? " of the min corner, then of the max corner" : ""}).`;
  return v;
}

const rayCalc: SceneCalc = {
  id: "scene-ray",
  name: "Ray intersection: sphere, box (slabs), triangle (Möller–Trumbore)",
  group: SCENE_GROUP,
  unitContract: "same-units",
  hint:
    "A ray (origin and direction; the direction need not be unit length) against a sphere, an axis-aligned box and a " +
    "triangle. The chosen primitive is reported in full and drawn: hit distance, point and normal, the triangle's " +
    "barycentric coordinates; a ray starting inside, a tangent or grazing ray, a ray parallel to a box slab or a " +
    "triangle's plane, a back face and a primitive behind the origin are each named.",
  fields: [
    { key: "prim", label: "Report and draw", default: "sphere", kind: "select", options: [{ value: "sphere", label: "Sphere" }, { value: "box", label: "Axis-aligned box" }, { value: "triangle", label: "Triangle" }] },
    { key: "o", label: "Ray origin x, y, z", default: "0, 0.3, -5", kind: "text" },
    { key: "d", label: "Ray direction x, y, z", default: "0, 0, 1", kind: "text" },
    { key: "sph", label: "Sphere: centre x, y, z, radius", default: "0, 0, 0, 1", kind: "text" },
    { key: "box", label: "Box: min x, y, z, max x, y, z", default: "-1, -1, -1, 1, 1, 1", kind: "text" },
    { key: "tri", label: "Triangle: v0, v1, v2 (one per line)", default: "-1, -1, 0\n1, -1, 0\n0, 1, 0", kind: "block", rows: 3 },
  ],
  compute: (r) => {
    const prim = r("prim") === "box" ? "box" : r("prim") === "triangle" ? "triangle" : "sphere";
    const o = vec3(r("o"), "Ray origin");
    if (typeof o === "string") return refuse(o);
    const d0 = vec3(r("d"), "Ray direction");
    if (typeof d0 === "string") return refuse(d0);
    const d = unitDir(d0);
    if (!d) return refuse("Ray direction: (0, 0, 0) has no direction. Give a non-zero vector (it need not be unit length).");
    const sph = vec3(r("sph"), "Sphere", 4);
    if (typeof sph === "string") return refuse(sph);
    if (!(sph[3] > 0)) return refuse(`Sphere: radius ${num(sph[3])} must be greater than 0.`);
    const bx = vec3(r("box"), "Box", 6);
    if (typeof bx === "string") return refuse(bx);
    const lo = bx.slice(0, 3);
    const hi = bx.slice(3);
    for (let i = 0; i < 3; i++) if (!(hi[i] >= lo[i])) return refuse(`Box: the max corner's ${"xyz"[i]} (${num(hi[i])}) is below the min corner's (${num(lo[i])}). Give the min corner first.`);
    const T = pointBlock(r("tri"), "Triangle");
    if (typeof T === "string") return refuse(T);
    if (T.length !== 3 || T.some((v) => v.length !== 3)) return refuse("Triangle: give exactly three vertices, each x, y, z, one per line.");
    const big = Math.max(...[...o, ...sph, ...bx, ...T.flat()].map(Math.abs), 1);
    const tiny = 1e-12 * big;
    const hs = raySphere(o, d, sph.slice(0, 3), sph[3]);
    const hb = rayBox(o, d, lo, hi);
    const ht = rayTriangle(o, d, T[0], T[1], T[2]);
    const AX = ["x", "y", "z"];
    const describe = (kind: string, h: RayHit & { parallelAxes?: number[]; backFace?: boolean; det?: number; planeDistance?: number | null }): string => {
      if (h.outcome === "miss") {
        if (h.note === "behind") return `misses: the ${kind} is behind the origin (it lies along the line, at negative distance).`;
        if (h.note.startsWith("parallel-")) {
          const i = Number(h.note.slice(9));
          return `misses: the ray is parallel to the ${AX[i]} slabs (direction ${AX[i]} = 0) and its ${AX[i]} = ${num(o[i])} is outside ${num(lo[i])} to ${num(hi[i])}.`;
        }
        if (h.note === "parallel") return `misses: the ray is parallel to the triangle's plane (d · n = 0), ${num(Math.abs(h.planeDistance as number))} away from it.`;
        if (h.note === "coplanar") return "misses in the usual sense: the ray lies IN the triangle's plane (parallel and at distance 0), where Möller–Trumbore's determinant is zero; a coplanar ray meets the triangle along a segment, not at a point.";
        if (h.note === "degenerate") return "cannot be tested: the triangle has zero area (its vertices are collinear).";
        if (kind === "sphere" && h.missBy !== null) return `misses: the ray's line passes ${num(h.missBy + sph[3])} from the centre, ${num(h.missBy)} outside the radius.`;
        if (h.bary) return `misses: the ray meets the triangle's plane outside the triangle (barycentrics ${pt(h.bary, 1e-13)}, one negative).`;
        return `misses: the ray passes outside the ${kind}.`;
      }
      const where = `at distance ${num(h.tNear ?? (h.tFar as number))}, point ${pt(h.point as Vec, tiny)}, normal ${pt(h.normal as Vec, 1e-13)}`;
      if (h.note === "inside") return `starts INSIDE the ${kind}: it hits the ${kind} from within, leaving ${where.replace("at distance", "at distance")}.`;
      if (h.note === "tangent") return `grazes the sphere (tangent: the two roots coincide) ${where}.`;
      if (h.note === "grazing") return `grazes the box (it touches only the surface: an edge or a corner, or it slides along a face) ${where}.`;
      if (kind === "triangle") return `hits ${where}${h.note === "edge" ? ", on an edge (a barycentric is 0)" : ""}; barycentrics (w₀, w₁, w₂) = ${pt(h.bary as Vec, 1e-13)}${h.backFace ? "; the ray strikes the BACK face (d · n > 0), which back-face culling would discard" : "; front face"}.`;
      return `hits ${where}${h.tFar !== null && h.tNear !== null && h.tFar !== h.tNear ? `, and leaves at distance ${num(h.tFar)}` : ""}.`;
    };
    const lines: EngLine[] = [];
    const chosen = prim === "sphere" ? hs : prim === "box" ? hb : ht;
    const name = prim === "box" ? "box" : prim;
    lines.push(`The ray ${describe(name, chosen).replace(/^hits /, `hits the ${name} `).replace(/^misses: the ray /, `misses the ${name}: it `).replace(/^misses: /, `misses the ${name}: `)}`.replace(/\.\.$/, "."));
    lines.push(`Ray: origin ${pt(o)}, direction ${pt(d0)} (unit ${pt(d, 1e-13)}); distances are along the unit direction.`);
    if (prim === "sphere") {
      lines.push({ math: "abs(o + t d - c)^2 = r^2", fallback: "|o + t·d − c|² = r²" });
      lines.push({ math: "t = -b +- sqrt(b^2 - (abs(o - c)^2 - r^2))", fallback: "t = −b ± √(b² − (|o − c|² − r²)), b = d · (o − c)" });
    } else if (prim === "box") {
      lines.push({ math: "t_i = (b_i - o_i)/d_i", fallback: "tᵢ = (bᵢ − oᵢ)/dᵢ for each slab plane; enter at the largest near t, leave at the smallest far t" });
    } else {
      lines.push({ math: "o + t d = (1 - u - v) v_0 + u v_1 + v v_2", fallback: "o + t·d = (1 − u − v)·v₀ + u·v₁ + v·v₂, solved by Cramer's rule (Möller–Trumbore)" });
    }
    lines.push(`All three primitives: sphere ${describe("sphere", hs)} Box ${describe("box", hb)} Triangle ${describe("triangle", ht)}`);
    if (prim === "box" && hb.parallelAxes.length && hb.outcome === "hit") lines.push(`The ray is parallel to the ${hb.parallelAxes.map((i) => AX[i]).join(" and ")} slabs and inside them, so those slabs set no limit (their 1/dᵢ is infinite and is skipped, not divided by).`);
    lines.push("Assumes: an infinite one-sided ray (t ≥ 0) in exact geometry; tangent, grazing, parallel and on-edge cases are decided with a tolerance of 10⁻¹² of the scene's size, so a ray within rounding of a boundary is reported as touching it.");
    const rowOf = (n: string, h: RayHit): string[] => [n, h.outcome === "hit" ? "hit" : "miss", h.outcome === "hit" ? num(h.tNear ?? (h.tFar as number)) : "", h.outcome === "hit" ? pt(h.point as Vec, tiny) : ""];
    const rows = [["Primitive", "Result", "Distance", "Point"], rowOf("Sphere", hs), rowOf("Box", hb), rowOf("Triangle", ht)];
    const outputs: EngOutput[] = [];
    for (const [k, h] of [["sphere", hs], ["box", hb], ["triangle", ht]] as Array<[string, RayHit]>) if (h.outcome === "hit") outputs.push({ key: `t${k}`, label: `${k} hit distance`, value: h.tNear ?? (h.tFar as number), unit: "" });
    outputs.push({ key: "hit", label: `${name} hit (1) or miss (0)`, value: chosen.outcome === "hit" ? 1 : 0, unit: "" });
    const centre = prim === "sphere" ? sph.slice(0, 3) : prim === "box" ? lo.map((v, i) => (v + hi[i]) / 2) : [0, 1, 2].map((j) => (T[0][j] + T[1][j] + T[2][j]) / 3);
    const shapes3d: Vec[][] = [];
    if (prim === "box") {
      const c = (m: number): Vec => [m & 1 ? hi[0] : lo[0], m & 2 ? hi[1] : lo[1], m & 4 ? hi[2] : lo[2]];
      for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) shapes3d.push([c(a), c(a | bit)]);
    } else if (prim === "triangle") shapes3d.push([T[0], T[1], T[2], T[0]]);
    const toCentre = Math.hypot(...centre.map((v, i) => v - o[i]));
    const reach = prim === "sphere" ? sph[3] : Math.hypot(...hi.map((v, i) => v - lo[i])) / 2;
    const tEnd = Math.max(chosen.tFar ?? 0, toCentre + (prim === "triangle" ? Math.max(...T.map((v) => Math.hypot(...v.map((x, i) => x - centre[i])))) : reach)) * 1.15 || 1;
    return finish(lines, null, [
      table("Ray against each primitive", rows),
      plot(rayChartSvg({ o, d, kind: prim, centre, shapes3d, sphereR: prim === "sphere" ? sph[3] : null, hit: chosen.point, hitLabel: chosen.outcome === "hit" ? `filled dot: the ${chosen.note === "inside" ? "exit" : "hit"} point at distance ${num(chosen.tNear ?? (chosen.tFar as number))}.` : "no hit.", tEnd }), `The ray and the ${name}, in the plane of the ray and the ${prim === "triangle" ? "centroid" : "centre"}`, `The ray drawn from its origin along the horizontal axis, the ${name} in blue, and the intersection point marked if there is one`),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Bounding volumes and the BVH SAH
// ---------------------------------------------------------------------------------------------------------------

const BV_MAX_POINTS = 5000;

const bvolCalc: SceneCalc = {
  id: "scene-bvol",
  name: "Bounding volumes & BVH split cost (surface area heuristic)",
  group: SCENE_GROUP,
  unitContract: "same-units",
  hint:
    "A set of points (primitive centroids, or a mesh's vertices). Compares the axis-aligned box with two bounding spheres " +
    "(about the box centre, and Ritter's), by volume and surface area, and works the surface-area-heuristic cost of " +
    "splitting this node at a given plane against keeping it as a leaf, beside the best split found by a sweep.",
  fields: [
    { key: "pts", label: "Points x, y, z (one per line)", default: "0, 0, 0\n1, 0.5, 0.2\n0.5, 1.5, 0\n2, 0.2, 0.4\n6, 1, 0.1\n6.5, 0.4, 0.3\n7, 1.2, 0\n7.2, 0.1, 0.5", kind: "block", rows: 8 },
    { key: "axis", label: "Split axis", default: "x", kind: "select", options: [{ value: "x", label: "x" }, { value: "y", label: "y" }, { value: "z", label: "z" }] },
    { key: "pos", label: "Split position on that axis", default: "3", kind: "text" },
    { key: "ct", label: "Traversal cost C(trav)", default: "1", kind: "text" },
    { key: "ci", label: "Intersection cost per primitive C(isect)", default: "1", kind: "text" },
  ],
  compute: (r) => {
    const P = pointBlock(r("pts"), "Points");
    if (typeof P === "string") return refuse(P);
    if (P.length < 2) return refuse("Points: give at least two points.");
    if (P.length > BV_MAX_POINTS) return refuse(`${P.length} points: the cap is ${BV_MAX_POINTS.toLocaleString("en-US")}.`);
    if (P.some((p) => p.length !== 3)) return refuse("Points: every point needs x, y and z.");
    const axis = r("axis") === "y" ? 1 : r("axis") === "z" ? 2 : 0;
    const pos = scalar(r("pos") ?? "");
    if (!Number.isFinite(pos)) return refuse(`Split position: "${(r("pos") ?? "").trim()}" is not a number.`);
    const ct = plainField(r("ct"), "Traversal cost", { min: 0 });
    if (typeof ct === "string") return refuse(ct);
    const ci = plainField(r("ci"), "Intersection cost", { positive: true });
    if (typeof ci === "string") return refuse(ci);
    const bv = boundingVolumes(P);
    const AX = ["x", "y", "z"];
    const ext = bv.bmax.map((v, i) => v - bv.bmin[i]);
    if (bv.boxArea === 0) return refuse(`The points' box has zero surface area (${ext.filter((e) => e === 0).length === 3 ? "every point coincides" : "the points are collinear along one axis"}), so the surface-area ratios the heuristic is built on are 0/0. Give points that span at least two axes.`);
    const sv = (rr: number): number => (4 / 3) * Math.PI * rr ** 3;
    const sa = (rr: number): number => 4 * Math.PI * rr ** 2;
    const split = sahCost(P, axis, pos, ct, ci);
    if (!split) {
      const below = P.filter((p) => p[axis] < pos).length;
      return refuse(`A split at ${AX[axis]} = ${num(pos)} puts ${below === 0 ? "every point on the right (at or above it)" : "every point on the left (below it)"}: one child would be empty, which is no split. The points run from ${AX[axis]} = ${num(bv.bmin[axis])} to ${num(bv.bmax[axis])}.`);
    }
    const best = bestSahSplit(P, ct, ci);
    const leaf = P.length * ci;
    const lines: EngLine[] = [];
    lines.push(`Splitting these ${P.length} points at ${AX[axis]} = ${num(pos)} costs ${num(split.cost)} against ${num(leaf)} for a leaf, so the split ${split.cost < leaf ? "pays" : "does not pay"}${best ? `; the best plane, ${AX[best.axis]} = ${num(best.position)}, costs ${num(best.cost)}` : ""}. The box encloses ${num(bv.boxVolume)} against ${num(sv(bv.ritter.r))} for Ritter's sphere.`);
    lines.push({ math: "C = C_trav + (A_L/A) N_L C_isect + (A_R/A) N_R C_isect", fallback: "C = C(trav) + (A_L/A)·N_L·C(isect) + (A_R/A)·N_R·C(isect), A the surface area of each box" });
    lines.push({ math: "C_leaf = N C_isect", fallback: "C(leaf) = N·C(isect)" });
    lines.push(`Box ${pt(bv.bmin)} to ${pt(bv.bmax)}: ${ext.map(num).join(" × ")}, volume ${num(bv.boxVolume)}, surface area ${num(bv.boxArea)}.`);
    lines.push(`Sphere about the box centre ${pt(bv.centred.c)}: radius ${num(bv.centred.r)}, volume ${num(sv(bv.centred.r))} (${num(sv(bv.centred.r) / Math.max(bv.boxVolume, 1e-300))} × the box), surface area ${num(sa(bv.centred.r))}.`);
    lines.push(`Ritter's sphere ${pt(bv.ritter.c, 1e-12 * Math.max(...ext))}: radius ${num(bv.ritter.r)}, volume ${num(sv(bv.ritter.r))}, surface area ${num(sa(bv.ritter.r))}. Ritter's is an approximation (typically within 5 to 20 % of the minimum sphere's radius); neither sphere is the minimum.`);
    {
      const areaRatio = sa(bv.ritter.r) / bv.boxArea;
      const tighter = areaRatio > 1 ? "box" : "sphere";
      lines.push(`${bv.boxVolume > 0 ? `By volume, Ritter's sphere is ${num(sv(bv.ritter.r) / bv.boxVolume)} × the box. ` : "The box is flat (zero volume), so only surface areas compare. "}A random ray hits a convex volume with probability in proportion to its surface area: sphere ${num(sa(bv.ritter.r))} against box ${num(bv.boxArea)}, so the ${tighter} is the tighter test here (the ${tighter === "box" ? "sphere" : "box"} is entered ${num(tighter === "box" ? areaRatio : 1 / areaRatio)} × as often by rays that miss the contents).`);
    }
    lines.push(`Split ${AX[axis]} = ${num(pos)}: left ${split.left} point${split.left === 1 ? "" : "s"} (box area ${num(split.areaLeft)}), right ${split.right} (box area ${num(split.areaRight)}), parent area ${num(split.areaParent)}. Cost ${num(ct)} + (${num(split.areaLeft)}/${num(split.areaParent)})·${split.left}·${num(ci)} + (${num(split.areaRight)}/${num(split.areaParent)})·${split.right}·${num(ci)} = ${num(split.cost)}.`);
    if (best) lines.push(`Best split by a full sweep (every axis, every midpoint between consecutive coordinates): ${AX[best.axis]} = ${num(best.position)}, ${best.left} | ${best.right}, cost ${num(best.cost)}${best.cost >= leaf ? `, still not below the leaf cost ${num(leaf)}: keep this node as a leaf` : ""}.`);
    lines.push("Assumes: point primitives (a primitive goes left when its coordinate is below the plane, and its child box is the box of its points; real triangles have extent and enlarge the child boxes); uniformly distributed rays, so hit probability is the ratio of surface areas; constant traversal and intersection costs.");
    const rows: string[][] = [["Volume", "Size", "Volume", "Surface area"], ["Axis-aligned box", ext.map(num).join(" × "), num(bv.boxVolume), num(bv.boxArea)], ["Sphere about the box centre", `r ${num(bv.centred.r)}`, num(sv(bv.centred.r)), num(sa(bv.centred.r))], ["Ritter's sphere", `r ${num(bv.ritter.r)}`, num(sv(bv.ritter.r)), num(sa(bv.ritter.r))]];
    const outputs: EngOutput[] = [
      { key: "cost", label: "SAH cost of the split", value: split.cost, unit: "" },
      { key: "leaf", label: "Leaf cost", value: leaf, unit: "" },
      { key: "boxVolume", label: "Box volume", value: bv.boxVolume, unit: "" },
      { key: "ritterR", label: "Ritter sphere radius", value: bv.ritter.r, unit: "" },
    ];
    if (best) outputs.push({ key: "bestCost", label: "Best split cost", value: best.cost, unit: "" });
    return finish(lines, null, [
      table("Bounding volumes", rows),
      plot(boundingChartSvg({ P, bmin: bv.bmin, bmax: bv.bmax, centred: bv.centred, ritter: bv.ritter, split: { axis, position: pos } }), "Points, their box and spheres, and the split plane", "The points as blue dots, their axis-aligned box in orange, the box-centred sphere dashed and Ritter's sphere in green, with the split plane as a red dashed line"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Texture memory and texel density
// ---------------------------------------------------------------------------------------------------------------

const TEX_SELECT = [...TEX_FORMATS.map((f) => ({ value: f.id, label: f.label })), { value: "custom", label: "Other uncompressed: channels × bytes" }];
const COMPARE = ["rgba8", "rgba16f", "bc1", "bc7", "astc4x4", "astc6x6", "astc8x8", "astc12x12"];

const textureCalc: SceneCalc = {
  id: "scene-texture",
  name: "Texture memory, mip chains & texel density",
  group: SCENE_GROUP,
  unitContract: "converts",
  hint:
    "Width, height and format (uncompressed, BC1–BC7 or an ASTC block size) give the memory with and without a full mip " +
    "chain (whole compressed blocks at every level, beside the ×4/3 rule). With the UV-island fraction and the surface " +
    "area, the texel density in texels per metre and the texture size a target density needs. A list of textures " +
    "(name, width, height, format) is totalled against a memory budget.",
  fields: [
    { key: "w", label: "Width (pixels)", default: "2048", kind: "text" },
    { key: "h", label: "Height (pixels)", default: "2048", kind: "text" },
    { key: "fmt", label: "Format", default: "bc7", kind: "select", options: TEX_SELECT },
    { key: "mips", label: "Mip chain", default: "yes", kind: "select", options: [{ value: "yes", label: "Full chain to 1 × 1" }, { value: "no", label: "Top level only" }] },
    { key: "ch", label: "Channels (Other format only)", default: "4", kind: "text" },
    { key: "bpc", label: "Bytes per channel (Other format only)", default: "1", kind: "text" },
    { key: "uv", label: "UV-island fraction of the 0–1 square (fraction, or %)", default: "0.7", kind: "text" },
    { key: "area", label: "Surface area the island covers (m²)", default: "4 m^2", kind: "text" },
    { key: "target", label: "Target texel density (texels per metre; blank: none)", default: "1024", kind: "text" },
    { key: "list", label: "Budget list: name, width, height, format id (blank: none)", default: "Albedo, 4096, 4096, bc7\nNormal, 4096, 4096, bc5\nRoughness, 2048, 2048, bc4\nEmissive, 1024, 1024, bc1", kind: "block", rows: 5 },
    { key: "budget", label: "Memory budget (bytes; MiB converts)", default: "64 MiB", kind: "text" },
  ],
  compute: (r) => {
    const w = countField(r("w"), "Width", 1, 65536);
    if (typeof w === "string") return refuse(w);
    const h = countField(r("h"), "Height", 1, 65536);
    if (typeof h === "string") return refuse(h);
    const mips = r("mips") !== "no";
    let fmt: TexFormat;
    if (r("fmt") === "custom") {
      const ch = countField(r("ch"), "Channels", 1, 4);
      if (typeof ch === "string") return refuse(ch);
      const bpc = countField(r("bpc"), "Bytes per channel", 1, 8);
      if (typeof bpc === "string") return refuse(bpc);
      fmt = rawFormat(ch, bpc);
    } else fmt = TEX_FORMATS.find((f) => f.id === r("fmt")) ?? (TEX_FORMATS.find((f) => f.id === "bc7") as TexFormat);
    const uv = fractionField(r("uv"), "UV-island fraction");
    if (typeof uv === "string") return refuse(uv);
    if (uv === 0) return refuse("UV-island fraction: 0 means the island has zero area in UV space, so no texel maps to the surface and the texel density has no value (each texel would cover an unbounded area). Give the fraction of the 0–1 square the island covers, from the UV editor.");
    const u = unitReader(r);
    const area = u.req("area", "m^2", "m²", "Surface area");
    const budget = u.opt("budget", "B", "B", "Memory budget");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!(area > 0)) return refuse("Surface area: give an area greater than 0 (a zero-area surface has no texel density).");
    const targetRaw = (r("target") ?? "").trim();
    const target = targetRaw ? plainField(targetRaw, "Target texel density", { positive: true }) : null;
    if (typeof target === "string") return refuse(target);
    const m = textureMemory(w, h, fmt, mips);
    const density = texelDensity(w, h, uv, area);
    const lines: EngLine[] = [];
    const total = mips ? m.chain : m.base;
    lines.push(`A ${w} × ${h} ${fmt.label.split(" (")[0]} texture takes ${bytes(total)}${mips ? ` with its ${m.levels}-level mip chain (${bytes(m.base)} for the top level alone)` : ""}, and on ${num(area)} m² with ${pct(uv)} of the UV square it gives ${num(density)} texels per metre${target !== null ? `, ${density >= target ? "meeting" : "short of"} the ${num(target)} target` : ""}.`);
    lines.push({ math: "M_0 = ceil(w/b_w) ceil(h/b_h) B", fallback: "M₀ = ⌈w/b_w⌉·⌈h/b_h⌉·B, with b_w × b_h the block and B its bytes (1 × 1 and the pixel size uncompressed)" });
    lines.push({ math: "M_chain ≈ (4/3) M_0", fallback: "M(chain) ≈ (4/3)·M₀ (each level a quarter of the one above)" });
    lines.push({ math: "rho = sqrt(w h a_uv/A)", fallback: "ρ = √(w·h·a_uv/A) texels per metre" });
    lines.push(`Format ${fmt.label}: ${num(fmt.bpp)} bits per pixel${fmt.bw > 1 ? ` (${fmt.blockBytes}-byte blocks of ${fmt.bw} × ${fmt.bh} pixels, so 128/${fmt.bw * fmt.bh} = ${num(fmt.bpp)} bpp${fmt.id.startsWith("astc") ? "" : ""})` : ""}.`);
    lines.push(`Top level ${bytes(m.base)} (${int(m.base)} bytes). ${mips ? `Full chain, ${m.levels} levels to 1 × 1, each rounded up to whole ${fmt.bw > 1 ? "blocks" : "pixels"}: ${bytes(m.chain)} (${int(m.chain)} bytes), against ${bytes(m.approx)} by the ×4/3 rule${m.chain > m.approx * (1 + 1e-9) ? `: whole blocks at the small levels add ${int(m.chain - m.approx)} bytes` : ""}. Smallest levels: ${m.perLevel.slice(-3).map(([a, b, c]) => `${a} × ${b} = ${c} B`).join(", ")}.` : "No mip chain: minified sampling will alias (shimmer) without one."}`);
    if ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0) lines.push(`${w} × ${h} is not a power of two: modern GPUs accept it, but its mip levels round down unevenly (each is ⌊size/2⌋) and some older and mobile pipelines require power-of-two sizes for mipmapping or wrapping.`);
    if (fmt.bw > 1 && (w % fmt.bw || h % fmt.bh)) lines.push(`${w} × ${h} is not a whole number of ${fmt.bw} × ${fmt.bh} blocks: the top level is padded to ${Math.ceil(w / fmt.bw) * fmt.bw} × ${Math.ceil(h / fmt.bh) * fmt.bh}.`);
    lines.push(`Texel density: the island covers ${pct(uv)} of the texture, ${int(Math.round(w * h * uv))} texels, spread over ${num(area)} m²: ${num(density)} texels per metre (${num(density / 100)} per centimetre).`);
    if (target !== null) {
      const need = textureSideFor(target, uv, area);
      lines.push(`For ${num(target)} texels per metre on the same island: a square texture of ${num(need.side)} px a side, so ${need.pow2} × ${need.pow2} as a power of two (${bytes(textureMemory(need.pow2, need.pow2, fmt, mips).chain)} in this format${mips ? " with mips" : ""}).`);
    }
    const extra: AnalyzeBlock[] = [];
    const cmpRows = COMPARE.map((id) => TEX_FORMATS.find((f) => f.id === id) as TexFormat).map((f) => {
      const mm = textureMemory(w, h, f, mips);
      const b = mips ? mm.chain : mm.base;
      return { name: f.label.split(" (")[0], value: b / 2 ** 20, text: bytes(b), colour: f.id === fmt.id ? "#c00000" : undefined };
    });
    // The budget list.
    const listRaw = (r("list") ?? "").trim();
    let listTotal: number | null = null;
    const listRows: Array<{ name: string; value: number; text: string }> = [];
    if (listRaw) {
      const tl = listRaw.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
      if (tl.length > 64) return refuse(`Budget list: ${tl.length} textures; the cap is 64.`);
      const tableRows: string[][] = [["Texture", "Size", "Format", "Memory"]];
      listTotal = 0;
      for (const [i, ln] of tl.entries()) {
        const parts = ln.split(",").map((x) => x.trim());
        if (parts.length !== 4) return refuse(`Budget list, line ${i + 1}: "${ln}" needs name, width, height, format id (e.g. Albedo, 4096, 4096, bc7).`);
        const lw = countField(parts[1], `Budget list, line ${i + 1}, width`, 1, 65536);
        if (typeof lw === "string") return refuse(lw);
        const lh = countField(parts[2], `Budget list, line ${i + 1}, height`, 1, 65536);
        if (typeof lh === "string") return refuse(lh);
        const lf = TEX_FORMATS.find((f) => f.id === parts[3].toLowerCase().replace(/[\s_-]/g, ""));
        if (!lf) return refuse(`Budget list, line ${i + 1}: "${parts[3]}" is not a format id. Use one of ${TEX_FORMATS.map((f) => f.id).join(", ")}.`);
        const lm = textureMemory(lw, lh, lf, mips);
        const b = mips ? lm.chain : lm.base;
        listTotal += b;
        tableRows.push([parts[0], `${lw} × ${lh}`, lf.label.split(" (")[0], bytes(b)]);
        listRows.push({ name: parts[0], value: b / 2 ** 20, text: bytes(b) });
      }
      tableRows.push(["Total", "", "", bytes(listTotal)]);
      lines.push(`Budget list (${mips ? "with" : "without"} mips): ${bytes(listTotal)} in total${budget !== null ? ` against a budget of ${bytes(budget)}: ${listTotal <= budget ? `${bytes(budget - listTotal)} to spare (${pct(listTotal / budget)} used)` : `${bytes(listTotal - budget)} OVER (${pct(listTotal / budget)} of the budget)`}` : ""}.`);
      extra.push(table("Texture budget", tableRows));
    }
    lines.push("Assumes: memory as the GPU stores the texture (whole blocks, no compression beyond the format's fixed rate), with no driver padding, alignment, tiling or sparse residency; RGB8 unpadded (most GPUs store it as RGBA8); BCn is 4 × 4 blocks and every ASTC block is 16 bytes. Texel density assumes the island's texels are spread evenly over the surface (no UV stretching).");
    const outputs: EngOutput[] = [
      { key: "memory", label: "Texture memory", value: total, unit: "B" },
      { key: "base", label: "Top-level memory", value: m.base, unit: "B" },
      { key: "density", label: "Texel density", value: density, unit: "1/m" },
    ];
    if (listTotal !== null) outputs.push({ key: "listTotal", label: "Budget list total", value: listTotal, unit: "B" });
    extra.unshift(table("Texture memory", [["Quantity", "Value"], ["Top level", bytes(m.base)], ["With mips (whole blocks)", mips ? bytes(m.chain) : "no mips"], ["×4/3 rule", bytes(m.approx)], ["Texel density (per m)", num(density)]]));
    extra.push(plot(sceneBarsSvg(cmpRows, `${w} × ${h}${mips ? " with mips" : ""}: memory by format`, "MiB"), `Memory of a ${w} × ${h} texture in each format${mips ? ", full mip chain" : ""}`, "Horizontal bars of texture memory for uncompressed, BC and ASTC formats, the chosen format in red"));
    if (listRows.length) extra.push(plot(sceneBarsSvg(listRows, `Texture budget: ${bytes(listTotal as number)}${budget !== null ? ` of ${bytes(budget)}` : ""}`, "MiB"), "Memory of each texture in the budget list", "Horizontal bars of each listed texture's memory"));
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 9. Render farm
// ---------------------------------------------------------------------------------------------------------------

const FARM_MAX_FRAMES = 100000;
/** Measured per-frame times are scheduled (LPT) at every node count tried: a smaller cap keeps that bounded. */
const FARM_MAX_TIMES = 10000;
const FARM_MAX_NODES = 10000;

const farmCalc: SceneCalc = {
  id: "scene-farm",
  name: "Render farm: completion time, nodes for a deadline, cost",
  group: SCENE_GROUP,
  unitContract: "converts",
  hint:
    "Frames and the render time of one frame on ONE core (or a list of measured per-frame core times), nodes and cores " +
    "per node, and the serial fraction of a frame's render (Amdahl). Gives each frame's time on a node, the wall-clock " +
    "completion with whole frames per node (or LPT scheduling of measured times), utilisation, the nodes a deadline " +
    "needs, and the cost at a rate per core-hour or node-hour.",
  fields: [
    { key: "frames", label: "Frames", default: "240", kind: "text" },
    { key: "t", label: "Render time per frame on one core (h; min converts)", default: "8 h", kind: "text" },
    { key: "times", label: "Or measured per-frame core times (one per line; blank: use the above)", default: "", kind: "block", rows: 3 },
    { key: "nodes", label: "Render nodes", default: "20", kind: "text" },
    { key: "cores", label: "Cores per node", default: "32", kind: "text" },
    { key: "serial", label: "Serial fraction of a frame (0 to 1, or %)", default: "0.05", kind: "text" },
    { key: "over", label: "Overhead per frame on a node (scene load, start-up)", default: "2 min", kind: "text" },
    { key: "deadline", label: "Deadline (h; blank: none)", default: "24 h", kind: "text" },
    { key: "bill", label: "Billing", default: "core", kind: "select", options: [{ value: "core", label: "Per core-hour" }, { value: "node", label: "Per node-hour" }] },
    { key: "rate", label: "Rate per core-hour or node-hour (any currency)", default: "0.02", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const t = u.req("t", "s", "s", "Render time per frame");
    const overhead = u.req("over", "s", "s", "Overhead per frame");
    const deadline = u.opt("deadline", "s", "s", "Deadline");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const nodes = countField(r("nodes"), "Render nodes", 1, FARM_MAX_NODES);
    if (typeof nodes === "string") return refuse(nodes.replace("(at least one is needed)", "(0 nodes render nothing: at least one is needed)"));
    const cores = countField(r("cores"), "Cores per node", 1, 4096);
    if (typeof cores === "string") return refuse(cores);
    const serial = fractionField(r("serial"), "Serial fraction");
    if (typeof serial === "string") return refuse(serial);
    const rate = plainField(r("rate"), "Rate", { min: 0 });
    if (typeof rate === "string") return refuse(rate);
    if (!(t > 0)) return refuse("Render time per frame: give a time greater than 0.");
    if (overhead < 0) return refuse("Overhead per frame: a negative overhead is not possible.");
    if (deadline !== null && !(deadline > 0)) return refuse("Deadline: give a time greater than 0, or leave it blank.");
    let frameTimes: number[] | null = null;
    const timesRaw = (r("times") ?? "").trim();
    if (timesRaw) {
      const toks = timesRaw.split(/[\r\n,;]+/).map((x) => x.trim()).filter(Boolean);
      if (toks.length > FARM_MAX_TIMES) return refuse(`${toks.length.toLocaleString("en-US")} frame times: the cap for a measured list is ${FARM_MAX_TIMES.toLocaleString("en-US")} (give the mean time per frame and the frame count instead).`);
      frameTimes = [];
      for (const [i, tok] of toks.entries()) {
        const m = parseMeasured(tok.replace(/[−–]/g, "-"), "h");
        if ("error" in m) return refuse(`Frame time ${i + 1}: ${m.error}`);
        if (!(m.inTarget > 0)) return refuse(`Frame time ${i + 1}: give a time greater than 0.`);
        frameTimes.push(m.inTarget * 3600);
      }
    }
    const frames = frameTimes ? frameTimes.length : countField(r("frames"), "Frames", 1, FARM_MAX_FRAMES);
    if (typeof frames === "string") return refuse(frames);
    const mean = frameTimes ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : t;
    const input: FarmInput = { frameTimes, meanTime: mean, frames, nodes, coresPerNode: cores, serial, overhead };
    const prep = prepareFarm(input);
    const res = farm(input, prep);
    const dl = deadline === null ? null : nodesForDeadline(input, deadline, prep);
    const need = dl === null ? null : dl.nodes;
    const perHour = r("bill") === "node" ? "node" : "core";
    const allocHours = (res.allocatedNodeSeconds / 3600) * (perHour === "core" ? cores : 1);
    const busyHours = (res.busyNodeSeconds / 3600) * (perHour === "core" ? cores : 1);
    const cost = allocHours * rate;
    const lines: EngLine[] = [];
    const meets = deadline === null ? "" : res.wall <= deadline ? `, inside the ${dur(deadline)} deadline` : `, missing the ${dur(deadline)} deadline`;
    lines.push(`${int(frames)} frames on ${nodes} node${nodes === 1 ? "" : "s"} of ${cores} cores finish in ${dur(res.wall)}${meets}${need !== null && deadline !== null && res.wall > deadline ? `; ${dl && dl.how === "bound" ? "at most " : ""}${need} nodes would make it` : deadline !== null && need === null ? "; no node count makes it, because one frame alone takes longer than the deadline" : ""}. Each frame takes ${dur(res.nodeFrameTime)} on a node (a ${num(res.speedup)}× speed-up from ${cores} cores), and the job costs ${num(cost)} at ${num(rate)} per ${perHour}-hour.`);
    lines.push({ math: "S = 1/(s + (1 - s)/c)", fallback: "S = 1/(s + (1 − s)/c), Amdahl's law with serial fraction s on c cores" });
    lines.push({ math: "t_node = t_1/S + t_o", fallback: "t(node) = t₁/S + t₀, the one-core time over the speed-up plus the per-frame overhead" });
    lines.push({ math: "T = ceil(N/n) t_node", fallback: "T = ⌈N/n⌉·t(node) for N equal frames on n nodes (whole frames: a node renders one frame at a time)" });
    lines.push(`Per frame: ${dur(mean)} on one core${frameTimes ? ` (the mean of ${frameTimes.length} measured times, ${dur(prep.sorted ? (prep.sorted[prep.sorted.length - 1] - overhead) * res.speedup : mean)} to ${dur(prep.sorted ? (prep.sorted[0] - overhead) * res.speedup : mean)})` : ""}; on ${cores} cores with serial fraction ${num(serial)} the speed-up is ${num(res.speedup)} (ceiling ${serial > 0 ? num(1 / serial) : "unbounded"} at infinitely many cores), core efficiency ${pct(res.coreEfficiency)}; plus ${dur(overhead)} overhead: ${dur(res.nodeFrameTime)} per frame per node.`);
    if (serial === 1) lines.push("Serial fraction 1: the render does not parallelise at all, so extra cores per node give no speed-up (only extra nodes help).");
    lines.push(res.scheduler === "rounds"
      ? `Completion: ⌈${int(frames)}/${nodes}⌉ = ${Math.ceil(frames / nodes)} round${Math.ceil(frames / nodes) === 1 ? "" : "s"} of ${dur(res.nodeFrameTime)} = ${dur(res.wall)}${frames % nodes ? `; the last round uses ${frames % nodes} of the ${nodes} nodes` : ""}.`
      : `Completion by LPT scheduling (longest frame first onto the least-loaded node, a heuristic within 4/3 of the optimum): ${dur(res.wall)}; no schedule can beat ${dur(res.lowerBound)} (the longest frame, or the work spread perfectly).`);
    lines.push(`Utilisation: busy ${num(res.busyNodeSeconds / 3600)} node-hours of ${num(res.allocatedNodeSeconds / 3600)} allocated (${pct(res.utilisation)}).`);
    if (deadline !== null) lines.push(need === null ? `No number of nodes meets ${dur(deadline)}: even one frame per node takes ${dur(prep.longest)}. Shorten the frame (fewer samples, more cores per node) or move the deadline.` : dl && dl.how === "rounds" ? `Nodes for the ${dur(deadline)} deadline: ${need} (each node fits ⌊${dur(deadline)}/${dur(res.nodeFrameTime)}⌋ = ${Math.floor((deadline * (1 + 1e-12)) / res.nodeFrameTime + 1e-12)} whole frame${Math.floor((deadline * (1 + 1e-12)) / res.nodeFrameTime + 1e-12) === 1 ? "" : "s"}, and ⌈${int(frames)}/that⌉ nodes are needed).` : dl && dl.how === "scan" ? `Nodes for the ${dur(deadline)} deadline: ${need}, the fewest that LPT schedules within it (every count from ${dl.from}, the work over the deadline, was tried: LPT's completion need not fall smoothly as nodes are added).` : `Nodes for the ${dur(deadline)} deadline: at most ${need}. Graham's bound for list scheduling, (work − longest frame)/n + longest frame ≤ deadline, guarantees that many; the ${DEADLINE_SCAN} counts from ${dl ? dl.from : 1} that were tried by LPT did not meet it, and the exact minimum was not searched further.`);
    lines.push(`Cost: billed on ALLOCATED time (nodes held for the whole ${dur(res.wall)}), ${num(allocHours)} ${perHour}-hours × ${num(rate)} = ${num(cost)}; the busy time alone is ${num(busyHours)} ${perHour}-hours (${num(busyHours * rate)}), the floor if idle nodes are released.`);
    lines.push("Assumes: identical nodes, each rendering one frame at a time on all its cores; Amdahl's law for the in-frame speed-up (memory bandwidth, I/O and licence limits are not modelled); a fixed overhead per frame; no failures, retries or queue wait; the per-frame time is an input (from a test render), not predicted from the scene.");
    const curve: Array<{ n: number; hours: number }> = [];
    const nMax = Math.min(frames, Math.max(2 * nodes, need ?? 0, 8), FARM_MAX_NODES);
    // Equal frames cost nothing per point; measured frames are an LPT schedule per point, so fewer points.
    const step = Math.max(1, Math.ceil(nMax / (prep.sorted ? 120 : 400)));
    for (let n = 1; n <= nMax; n += step) curve.push({ n, hours: farm({ ...input, nodes: n }, prep).wall / 3600 });
    if (curve[curve.length - 1].n !== nMax) curve.push({ n: nMax, hours: farm({ ...input, nodes: nMax }, prep).wall / 3600 });
    const rows: string[][] = [["Quantity", "Value"], ["Speed-up per node", num(res.speedup)], ["Time per frame on a node", dur(res.nodeFrameTime)], ["Completion", dur(res.wall)], ["Utilisation", pct(res.utilisation)], ["Nodes for the deadline", deadline === null ? "no deadline" : need === null ? "none suffices" : dl && dl.how === "bound" ? `at most ${need}` : String(need)], ["Cost (allocated)", num(cost)]];
    const outputs: EngOutput[] = [
      { key: "wall", label: "Completion", value: res.wall / 3600, unit: "h" },
      { key: "speedup", label: "Speed-up per node", value: res.speedup, unit: "" },
      { key: "frameNode", label: "Time per frame on a node", value: res.nodeFrameTime / 60, unit: "min" },
      { key: "utilisation", label: "Utilisation", value: res.utilisation, unit: "" },
      { key: "cost", label: "Cost", value: cost, unit: "" },
    ];
    if (need !== null) outputs.push({ key: "nodesNeeded", label: "Nodes for the deadline", value: need, unit: "" });
    return finish(lines, u.conversions, [
      table("Render farm", rows),
      plot(farmChartSvg(curve, deadline === null ? null : deadline / 3600, nodes, res.wall / 3600), "Completion time against the number of nodes", "Completion time in hours on a logarithmic axis falling in steps as nodes are added, the deadline as a horizontal line and this farm's node count marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 10. Frame-sequence storage and transfer
// ---------------------------------------------------------------------------------------------------------------

const DEPTHS: Array<{ value: Depth; label: string }> = [
  { value: "half", label: "16-bit half float (EXR half)" },
  { value: "float", label: "32-bit float (EXR float)" },
  { value: "int10dpx", label: "10-bit integer, DPX packed (3 per 32-bit word)" },
  { value: "int12", label: "12-bit integer (in 16-bit words)" },
  { value: "int16", label: "16-bit integer" },
  { value: "int8", label: "8-bit integer" },
];

const storageCalc: SceneCalc = {
  id: "scene-storage",
  name: "Frame-sequence storage & transfer time (EXR, DPX)",
  group: SCENE_GROUP,
  unitContract: "converts",
  hint:
    "Resolution, channels and bit depth give the uncompressed bytes of one frame (10-bit DPX packed three components " +
    "to a 32-bit word, lines padded to a word); a compression ratio you enter (1 for none: it depends on the image and the " +
    "codec, so it is never guessed) gives the stored size, per shot and per sequence, and the transfer time over a link " +
    "at a stated efficiency.",
  fields: [
    { key: "w", label: "Width (pixels)", default: "4096", kind: "text" },
    { key: "h", label: "Height (pixels)", default: "2160", kind: "text" },
    { key: "ch", label: "Channels (3 RGB, 4 RGBA, more for AOVs)", default: "4", kind: "text" },
    { key: "depth", label: "Bit depth", default: "half", kind: "select", options: DEPTHS },
    { key: "comp", label: "Compression ratio (1 = uncompressed; your measured value)", default: "1", kind: "text" },
    { key: "frames", label: "Frames per shot", default: "240", kind: "text" },
    { key: "shots", label: "Shots in the sequence", default: "12", kind: "text" },
    { key: "link", label: "Link speed (Gbps; Mbps converts)", default: "10 Gbps", kind: "text" },
    { key: "eff", label: "Link efficiency (fraction of the line rate achieved)", default: "0.7", kind: "text" },
  ],
  compute: (r) => {
    const w = countField(r("w"), "Width", 1, 65536);
    if (typeof w === "string") return refuse(w);
    const h = countField(r("h"), "Height", 1, 65536);
    if (typeof h === "string") return refuse(h);
    const ch = countField(r("ch"), "Channels", 1, 64);
    if (typeof ch === "string") return refuse(ch);
    const depth = (DEPTHS.find((d) => d.value === r("depth")) ?? DEPTHS[0]).value;
    const comp = plainField(r("comp"), "Compression ratio", { min: 1 });
    if (typeof comp === "string") return refuse(comp.replace(/is below 1\.$/, "is below 1: a ratio under 1 would mean the file grows (write 1 for uncompressed)."));
    const frames = countField(r("frames"), "Frames per shot", 1, 1e7);
    if (typeof frames === "string") return refuse(frames);
    const shots = countField(r("shots"), "Shots", 1, 1e5);
    if (typeof shots === "string") return refuse(shots);
    const eff = fractionField(r("eff"), "Link efficiency");
    if (typeof eff === "string") return refuse(eff);
    if (eff === 0) return refuse("Link efficiency: 0 means nothing gets through, so the transfer never finishes. Give the fraction of the line rate a copy achieves (0.6 to 0.9 is typical).");
    const u = unitReader(r);
    const link = u.req("link", "bit/s", "bit/s", "Link speed");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!(link > 0)) return refuse("Link speed: give a speed greater than 0.");
    if (depth === "int10dpx" && ch !== 3 && ch !== 4 && ch !== 1) return refuse(`10-bit DPX holds 1 (luma), 3 (RGB) or 4 (RGBA) components; ${ch} channels is not a DPX layout. Use EXR half for arbitrary channel counts.`);
    const raw = frameBytes(w, h, ch, depth);
    const frame = raw / comp;
    const shot = frame * frames;
    const seq = shot * shots;
    const rateB = (link * eff) / 8;
    const tShot = shot / rateB;
    const tSeq = seq / rateB;
    const lines: EngLine[] = [];
    const dname = DEPTHS.find((d) => d.value === depth)?.label.split(" (")[0] ?? depth;
    lines.push(`One ${w} × ${h} ${ch}-channel ${dname} frame is ${bytes(frame)}${comp > 1 ? ` at your ${num(comp)}:1 compression (${bytes(raw)} uncompressed)` : " uncompressed"}, so the ${shots}-shot sequence of ${int(frames)}-frame shots is ${bytes(seq)}, and moving it takes ${dur(tSeq)} over ${num(link / 1e9)} Gbps at ${pct(eff)} efficiency.`);
    lines.push({ math: "B = w h c b/8", fallback: "B = w·h·c·b/8 bytes for b bits per channel (EXR, 8/16-bit)" });
    lines.push({ math: "B_DPX10 = 4 ceil(c w/3) h", fallback: "B(DPX 10-bit) = 4·⌈c·w/3⌉·h: three 10-bit components per 32-bit word, each line padded to a word" });
    lines.push({ math: "t = 8 B/(eta R)", fallback: "t = 8B/(η·R) for a link of R bit/s at efficiency η" });
    lines.push(`Frame: ${int(raw)} bytes uncompressed (${bytes(raw)}, ${dec(raw)})${depth === "int10dpx" ? `, ${num((raw * 8) / (w * h * ch))} bits per component stored including padding` : ""}; compression ratio ${num(comp)}:1 (your input) gives ${bytes(frame)} per frame.`);
    lines.push(`Shot (${int(frames)} frames): ${bytes(shot)} (${dec(shot)}); sequence (${shots} shots, ${int(frames * shots)} frames): ${bytes(seq)} (${dec(seq)}).`);
    lines.push(`Transfer at ${num(link / 1e9)} Gbps × ${num(eff)} = ${num((link * eff) / 1e9)} Gbps effective (${dec(rateB)}/s): one frame ${dur(frame / rateB)}, a shot ${dur(tShot)}, the sequence ${dur(tSeq)}.`);
    lines.push("Assumes: image data only (file headers, EXR offset tables and metadata are not counted: a few kilobytes per frame); EXR half and float store 2 and 4 bytes per channel and 12-bit DPX sits in 16-bit words; the compression ratio is yours, because lossless EXR compression (PIZ, ZIP, DWAA) varies severalfold with the image; the link runs at a steady fraction of its line rate.");
    const cmp = DEPTHS.map((d) => {
      if (d.value === "int10dpx" && ch !== 3 && ch !== 4 && ch !== 1) return null;
      const b = (frameBytes(w, h, ch, d.value) / comp) * frames * shots;
      return { name: d.label.split(" (")[0], value: b / 2 ** 30, text: bytes(b), colour: d.value === depth ? "#c00000" : undefined };
    }).filter((x): x is { name: string; value: number; text: string; colour: string | undefined } => x !== null);
    const outputs: EngOutput[] = [
      { key: "frame", label: "Bytes per frame", value: frame, unit: "B" },
      { key: "shot", label: "Bytes per shot", value: shot, unit: "B" },
      { key: "sequence", label: "Bytes per sequence", value: seq, unit: "B" },
      { key: "transfer", label: "Sequence transfer time", value: tSeq / 3600, unit: "h" },
    ];
    return finish(lines, u.conversions, [
      table("Frame storage", [["Quantity", "Value"], ["Frame (uncompressed)", bytes(raw)], ["Frame (stored)", bytes(frame)], ["Shot", bytes(shot)], ["Sequence", bytes(seq)], ["Sequence transfer", dur(tSeq)]]),
      plot(sceneBarsSvg(cmp, `Sequence size by bit depth (${num(comp)}:1)`, "GiB"), "Sequence size for each bit depth at this resolution", "Horizontal bars of the sequence's size for each bit depth, the chosen one in red"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 11. Pipeline throughput
// ---------------------------------------------------------------------------------------------------------------

const pipelineCalc: SceneCalc = {
  id: "scene-pipeline",
  name: "Production pipeline: bottleneck, throughput, Little's law",
  group: SCENE_GROUP,
  unitContract: "converts",
  hint:
    "Stages one per line (name, work time per item, people or machines on it) give each stage's capacity and the " +
    "bottleneck; with the arrival interval of new items, each stage's utilisation; with the work in progress you count, " +
    "the lead time by Little's law (L = λW), and the work-in-progress limit for a target lead time.",
  fields: [
    { key: "stages", label: "Stages: name, hours per item, workers", default: "Modelling, 6 h, 2\nTexturing, 4 h, 1\nRigging, 3 h, 1\nLighting, 2 h, 1\nCompositing, 90 min, 1", kind: "block", rows: 6 },
    { key: "every", label: "A new item arrives every (h; blank: as fast as the bottleneck)", default: "5 h", kind: "text" },
    { key: "wip", label: "Items in progress now (blank: none)", default: "12", kind: "text" },
    { key: "lead", label: "Target lead time (h; blank: none)", default: "40 h", kind: "text" },
  ],
  compute: (r) => {
    const sl = (r("stages") ?? "").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
    if (!sl.length) return refuse("Stages: give at least one line: name, hours per item, workers.");
    if (sl.length > 30) return refuse(`${sl.length} stages: the cap is 30.`);
    const stages: Stage[] = [];
    const conv: string[] = [];
    for (const [i, ln] of sl.entries()) {
      const parts = ln.split(",").map((x) => x.trim());
      if (parts.length !== 3) return refuse(`Stages, line ${i + 1}: "${ln}" needs three parts: name, hours per item, workers (e.g. Lighting, 2 h, 1).`);
      const m = parseMeasured(parts[1].replace(/[−–]/g, "-"), "h");
      if ("error" in m) return refuse(`Stages, line ${i + 1}, time: ${m.error}`);
      if (!(m.inTarget > 0)) return refuse(`Stages, line ${i + 1}: a work time must be greater than 0.`);
      if (!m.assumed && m.unit !== "h") conv.push(`${parts[0]}: ${num(m.value)} ${formatUnit(m.unit)} = ${num(m.inTarget)} h`);
      const wk = countField(parts[2], `Stages, line ${i + 1}, workers`, 1, 100000);
      if (typeof wk === "string") return refuse(wk.replace("(at least one is needed)", "(a stage with nobody on it never finishes anything)"));
      stages.push({ name: parts[0] || `Stage ${i + 1}`, hoursPerItem: m.inTarget, workers: wk });
    }
    const u = unitReader(r);
    u.conversions.push(...conv);
    const every = u.opt("every", "h", "h", "Arrival interval");
    const lead = u.opt("lead", "h", "h", "Target lead time");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (every !== null && !(every > 0)) return refuse("Arrival interval: give a time greater than 0, or leave it blank.");
    if (lead !== null && !(lead > 0)) return refuse("Target lead time: give a time greater than 0, or leave it blank.");
    const wipRaw = (r("wip") ?? "").trim();
    const wip = wipRaw ? plainField(wipRaw, "Items in progress", { min: 0 }) : null;
    if (typeof wip === "string") return refuse(wip);
    const demand = every === null ? null : 1 / every;
    const res = pipeline(stages, demand);
    const b = stages[res.bottleneck];
    const cap = res.capacity[res.bottleneck];
    const overloaded = demand !== null && demand > cap * (1 + 1e-12);
    const lines: EngLine[] = [];
    const perDay = (x: number): string => `${num(x * 8)} per 8-hour day`;
    /** Working hours (the stages' clock), with eight-hour days beside a long one: never calendar days. */
    const wh = (hrs: number): string => (hrs >= 40 ? `${num(hrs)} working hours (${num(hrs / 8)} eight-hour days)` : hrs >= 1 ? `${num(hrs)} h` : `${num(hrs * 60)} min`);
    const W = wip !== null && !overloaded && res.throughput > 0 ? wip / res.throughput : null;
    lines.push(overloaded
      ? `${b.name} is the bottleneck at ${perDay(cap)}, but items arrive at ${perDay(demand as number)}, so the backlog grows by ${perDay((demand as number) - cap)} and lead times rise without limit until ${b.name} gains capacity.`
      : `${b.name} is the bottleneck at ${perDay(cap)} (${pct(res.utilisation[res.bottleneck])} busy), so the pipeline delivers ${perDay(res.throughput)}${W !== null ? `; with ${num(wip as number)} items in progress, each takes about ${wh(W)} from start to finish (Little's law), of which ${wh(res.touchTime)} is actual work` : ""}.`);
    lines.push({ math: "mu_i = n_i/t_i", fallback: "μᵢ = nᵢ/tᵢ, a stage's capacity from its workers and hours per item" });
    lines.push({ math: "X = min(lambda, min(mu_i))", fallback: "X = min(λ, minᵢ μᵢ), the throughput" });
    lines.push({ math: "L = lambda W", fallback: "L = λW (Little's law: work in progress = throughput × lead time)" });
    lines.push(`Capacity (items per hour): ${stages.map((s, i) => `${s.name} ${num(res.capacity[i])} (${s.workers} × 1/${num(s.hoursPerItem)} h)`).join("; ")}. Bottleneck: ${b.name}.`);
    lines.push(demand === null ? `No arrival interval given: the pipeline is taken as running flat out, at the bottleneck's ${num(cap)} per hour.` : `Arrivals: one every ${wh((every as number))}, ${num(demand)} per hour. Utilisation: ${stages.map((s, i) => `${s.name} ${pct(Math.min(res.utilisation[i], 1))}`).join(", ")}${overloaded ? " (the bottleneck is overloaded: its utilisation would exceed 100 %)" : ""}.`);
    lines.push(`Touch time (the work in one item, every stage once): ${wh(res.touchTime)}.`);
    if (wip !== null) {
      if (overloaded) lines.push("Little's law applies to a pipeline in steady state; with arrivals above the bottleneck's capacity there is none (the queue grows), so no lead time is given.");
      else if (W !== null) lines.push(`Lead time W = L/λ = ${num(wip)}/${num(res.throughput)} per hour = ${wh(W)}; flow efficiency (touch time ÷ lead time) ${pct(Math.min(1, res.touchTime / W))}${W < res.touchTime ? `. That is below the touch time, so ${num(wip)} items cannot be in steady flow at this rate: count the work in progress again` : ""}.`);
    }
    if (lead !== null && !overloaded) lines.push(`For a ${wh(lead)} lead time at ${num(res.throughput)} per hour: hold work in progress to L = λW = ${num(res.throughput * lead)} items${lead < res.touchTime ? ` (but ${wh(lead)} is less than the ${wh(res.touchTime)} touch time, so no WIP limit reaches it: the stages themselves must get faster)` : ""}.`);
    lines.push("Assumes: steady state (Little's law needs arrivals and departures to balance over the period); each worker handles one item at a time; hours are working hours; no rework loops, hand-off delays or batching. Utilisation near 100 % means long queues in practice even below capacity, because work times vary.");
    const rows: string[][] = [["Stage", "Hours per item", "Workers", "Capacity per hour", "Utilisation"]];
    stages.forEach((s, i) => rows.push([s.name + (i === res.bottleneck ? " (bottleneck)" : ""), num(s.hoursPerItem), String(s.workers), num(res.capacity[i]), pct(Math.min(res.utilisation[i], 1))]));
    const outputs: EngOutput[] = [
      { key: "throughput", label: "Throughput", value: res.throughput, unit: "1/h" },
      { key: "bottleneckCapacity", label: "Bottleneck capacity", value: cap, unit: "1/h" },
      { key: "touch", label: "Touch time", value: res.touchTime, unit: "h" },
    ];
    if (W !== null) outputs.push({ key: "lead", label: "Lead time (Little's law)", value: W, unit: "h" });
    const bars = stages.map((s, i) => ({ name: s.name, value: res.capacity[i] * 8, text: `${num(res.capacity[i] * 8)} per day`, colour: i === res.bottleneck ? "#c00000" : undefined }));
    if (demand !== null) bars.push({ name: "Arrivals", value: demand * 8, text: `${num(demand * 8)} per day`, colour: "#888888" });
    return finish(lines, u.conversions, [
      table("Pipeline stages", rows),
      plot(sceneBarsSvg(bars, "Stage capacity (items per 8-hour day)", "per day"), "Capacity of each stage against the arrival rate", "Horizontal bars of each stage's capacity in items per hour, the bottleneck in red, and the arrival rate in grey"),
    ], outputs);
  },
};

/** The Scene modelling & pipeline calculators, in dropdown order. */
export const SCENE_CALCS: SceneCalc[] = [bezierCalc, nurbsCalc, meshCalc, subdivCalc, lodCalc, rayCalc, bvolCalc, textureCalc, farmCalc, storageCalc, pipelineCalc];
