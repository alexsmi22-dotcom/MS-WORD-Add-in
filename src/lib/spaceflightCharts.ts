// Figures for the Spaceflight & missions calculators: orbits drawn to equal scale (the orbit in its own plane, inertial
// views, a Lambert transfer arc, a phasing orbit, the CR3BP rotating frame with zero-velocity curves), a porkchop of
// departure C3, a Δv budget waterfall, bi-elliptic against Hohmann, the sun-synchronous inclination curve, ground
// tracks and footprints on a longitude–latitude map, entry speed and deceleration against altitude, orbital decay at
// three solar-activity levels, and equilibrium temperature against distance from the Sun.
// Colours are literal hex (inserted artwork never follows the pane's theme), as laserCharts.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { contourPlotSvg, marchingSquares, niceLevels, type Grid } from "./contour";
import { norm, propagate, scale, cross, type V3 } from "./spaceOrbit";
import { biellipticDvNorm, biellipticInfNorm, hohmannDvNorm, ssoInclination, twoOmega, type LagrangeResult, type LunarLeg, type PorkchopResult } from "./spaceMissions";
import { tempAtDistance } from "./spaceEnvironment";
import { R_EQ_SI } from "./spaceConstants";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const BLACK = "#000000";
const ORANGE = "#d46a00";
const PURPLE = "#6a3d9a";
const W = 460;
const H = Math.round(W * 0.66);
const TWO_PI = 2 * Math.PI;
const R2D = 180 / Math.PI;

/** 4 significant figures, trailing zeros dropped (a label, not a measurement). */
export const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

type Box = { xmin: number; xmax: number; ymin: number; ymax: number };

/**
 * A plot with EQUAL SCALES on x and y (an orbit drawn on unequal axes is a different ellipse). buildPlotSvg sizes its
 * margins from the tick labels, so the frame is read back from the first render and the shorter span widened to match;
 * two more passes absorb the margin change that new tick labels cause.
 */
export function equalAspectSvg(series: Series[], box: Box, xlabel: string, ylabel: string, width = W, height = Math.round(W * 0.8), notes?: string[]): string {
  let b = { ...box };
  let svg = "";
  for (let pass = 0; pass < 4; pass++) {
    svg = buildPlotSvg(series, { xlabel, ylabel, width, height, xLimits: { min: b.xmin, max: b.xmax }, yLimits: { min: b.ymin, max: b.ymax }, ...(notes && notes.length ? { notes } : {}) });
    const m = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/.exec(svg);
    if (!m) break;
    const fw = Number(m[3]);
    const fh = Number(m[4]);
    const sx = (b.xmax - b.xmin) / fw;
    const sy = (b.ymax - b.ymin) / fh;
    if (Math.abs(sx / sy - 1) < 0.01) break;
    // Widen the span drawn at the finer scale, about its centre, from the ORIGINAL box (never shrink data out).
    const s = Math.max((box.xmax - box.xmin) / fw, (box.ymax - box.ymin) / fh);
    const cx = (box.xmin + box.xmax) / 2;
    const cy = (box.ymin + box.ymax) / 2;
    b = { xmin: cx - (s * fw) / 2, xmax: cx + (s * fw) / 2, ymin: cy - (s * fh) / 2, ymax: cy + (s * fh) / 2 };
  }
  return svg;
}

const circle = (cx: number, cy: number, r: number, n = 120): Array<{ x: number; y: number }> =>
  Array.from({ length: n + 1 }, (_, k) => ({ x: cx + r * Math.cos((TWO_PI * k) / n), y: cy + r * Math.sin((TWO_PI * k) / n) }));

/** A box around points with a margin fraction. */
function boxOf(pts: Array<{ x: number; y: number }>, margin = 0.08): Box {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y);
    ymax = Math.max(ymax, p.y);
  }
  const span = Math.max(xmax - xmin, ymax - ymin, 1e-9);
  return { xmin: xmin - margin * span, xmax: xmax + margin * span, ymin: ymin - margin * span, ymax: ymax + margin * span };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Orbit from elements
// ---------------------------------------------------------------------------------------------------------------

/** Perifocal points of a conic (km) over the drawable true-anomaly range; hyperbolas and parabolas stop at rMax. */
function conicPoints(p: number, e: number, rMax: number, n = 361): Array<{ x: number; y: number }> {
  let numax = Math.PI;
  if (e >= 1) {
    // r = p/(1 + e cos ν) reaches rMax at cos ν = (p/rMax − 1)/e.
    const c = (p / rMax - 1) / e;
    numax = Math.acos(Math.max(-1, Math.min(1, c)));
  }
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= n; k++) {
    const nu = -numax + (2 * numax * k) / n;
    const r = p / (1 + e * Math.cos(nu));
    if (r > 0 && Number.isFinite(r)) pts.push({ x: (r * Math.cos(nu)) / 1000, y: (r * Math.sin(nu)) / 1000 });
  }
  return pts;
}

/** The orbit in its own plane (periapsis to the right), the body to scale, the epoch and propagated positions. */
export function orbitPlaneSvg(p: number, e: number, bodyR: number, bodyLabel: string, nu0: number, nu1: number | null): string {
  const rAt = (nu: number): number => p / (1 + e * Math.cos(nu));
  const r0 = rAt(nu0);
  const r1 = nu1 === null ? r0 : rAt(nu1);
  const rMax = e < 1 ? p / (1 - e) : Math.max(4 * (p / (1 + e)), 1.3 * Math.max(r0, r1), 3 * bodyR);
  const orbit = conicPoints(p, e, rMax);
  const body = circle(0, 0, bodyR / 1000);
  const series: Series[] = [
    { points: body, type: "line", color: GREY, label: bodyLabel },
    { points: orbit, type: "line", color: BLUE, label: e < 1e-9 ? "Circular orbit" : e < 1 ? "Ellipse" : Math.abs(e - 1) < 1e-9 ? "Parabola" : "Hyperbola" },
  ];
  if (e > 1e-9) series.push({ points: [{ x: p / (1 + e) / 1000, y: 0 }], type: "scatter", color: BLACK, label: "Periapsis" });
  series.push({ points: [{ x: (r0 * Math.cos(nu0)) / 1000, y: (r0 * Math.sin(nu0)) / 1000 }], type: "scatter", color: GREEN, label: "At epoch" });
  if (nu1 !== null) series.push({ points: [{ x: (r1 * Math.cos(nu1)) / 1000, y: (r1 * Math.sin(nu1)) / 1000 }], type: "scatter", color: RED, label: "At time t" });
  return equalAspectSvg(series, boxOf([...orbit, ...body]), "Along periapsis (km)", "In-plane, 90° ahead (km)");
}

/** The orbit seen in inertial axes: `view` "xy" looks down the z axis, "xz" edge-on from −y. */
export function orbitInertialSvg(path: V3[], bodyR: number, here: V3, there: V3 | null, view: "xy" | "xz"): string {
  const j = view === "xy" ? 1 : 2;
  const pts = path.map((r) => ({ x: r[0] / 1000, y: r[j] / 1000 }));
  const body = circle(0, 0, bodyR / 1000);
  const series: Series[] = [
    { points: body, type: "line", color: GREY, label: view === "xy" ? "Equator" : "Body" },
    { points: pts, type: "line", color: BLUE, label: "Orbit" },
    { points: [{ x: here[0] / 1000, y: here[j] / 1000 }], type: "scatter", color: GREEN, label: "At epoch" },
  ];
  if (there) series.push({ points: [{ x: there[0] / 1000, y: there[j] / 1000 }], type: "scatter", color: RED, label: "At time t" });
  return equalAspectSvg(series, boxOf([...pts, ...body]), "X (km)", view === "xy" ? "Y (km)" : "Z (km)", W, Math.round(W * 0.72));
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Lambert transfer arc
// ---------------------------------------------------------------------------------------------------------------

/** The transfer in its own plane: r₁ along x, the departure and arrival radii as circles, the arc and the rest of its conic. */
export function lambertArcSvg(mu: number, r1: V3, v1: V3, r2: V3, tof: number, bodyR: number, period: number | null): string {
  const ex = scale(r1, 1 / norm(r1));
  const h = cross(r1, v1);
  const ey = cross(scale(h, 1 / norm(h)), ex);
  const proj = (r: V3): { x: number; y: number } => ({ x: (r[0] * ex[0] + r[1] * ex[1] + r[2] * ex[2]) / 1000, y: (r[0] * ey[0] + r[1] * ey[1] + r[2] * ey[2]) / 1000 });
  const arc: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= 200; k++) {
    const s = propagate(mu, r1, v1, (tof * k) / 200);
    if (s.ok) arc.push(proj(s.r));
  }
  const rest: Array<{ x: number; y: number }> = [];
  if (period !== null) {
    for (let k = 0; k <= 200; k++) {
      const s = propagate(mu, r1, v1, tof + ((period - tof) * k) / 200);
      if (s.ok) rest.push(proj(s.r));
    }
  }
  const R1 = norm(r1) / 1000;
  const R2 = norm(r2) / 1000;
  const series: Series[] = [
    { points: circle(0, 0, bodyR / 1000), type: "line", color: BLACK, label: "Central body" },
    { points: circle(0, 0, R1), type: "line", color: GREY, label: `r₁ = ${sig(R1)} km` },
  ];
  if (Math.abs(R2 / R1 - 1) > 1e-3) series.push({ points: circle(0, 0, R2), type: "line", color: "#bbbbbb", label: `r₂ = ${sig(R2)} km` });
  if (rest.length) series.push({ points: rest, type: "line", color: "#9fbfe0", label: "Rest of the ellipse" });
  series.push({ points: arc, type: "line", color: BLUE, label: "Transfer arc" });
  series.push({ points: [proj(r1)], type: "scatter", color: GREEN, label: "Departure" });
  series.push({ points: [proj(r2)], type: "scatter", color: RED, label: "Arrival" });
  const all = [...arc, ...circle(0, 0, Math.max(R1, R2)), ...(rest.length && rest.every((p) => Math.hypot(p.x, p.y) < 6 * Math.max(R1, R2)) ? rest : [])];
  return equalAspectSvg(series, boxOf(all), "Along r₁ (km)", "In the transfer plane (km)");
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Porkchop
// ---------------------------------------------------------------------------------------------------------------

/** Departure C3 contours (km²/s²) over days after the window opens × time of flight. */
export function porkchopSvg(pc: PorkchopResult, startLabel: string): string {
  const xs = pc.depJd.map((jd) => jd - pc.depJd[0]);
  const ys = pc.tofDays;
  const raw = pc.c3.map((row) => row.map((v) => v / 1e6));
  const finite = raw.flat().filter((v) => Number.isFinite(v));
  const lo = Math.min(...finite);
  const hi = Math.min(Math.max(...finite), Math.max(lo * 3, lo + 40));
  // The 180° ridge climbs to C3 in the thousands: cells far above the contoured range are left blank, so the figure
  // shows the valley a launch can reach instead of a bundle of lines converging on the ridge.
  const cap = hi * 2;
  const z = raw.map((row) => row.map((v) => (Number.isFinite(v) && v <= cap ? v : NaN)));
  const unsolved = raw.flat().filter((v) => !Number.isFinite(v)).length;
  const above = raw.flat().filter((v) => Number.isFinite(v) && v > cap).length;
  const grid: Grid = { xs, ys, z, holes: unsolved + above };
  let levels = niceLevels(lo, hi, 9);
  if (!levels.length) levels = [lo + (hi - lo) / 2];
  const notes = [`Lowest C3 ${sig(lo)} km²/s²; the ridge of high C3 is the 180° transfer, where the plane flips.`];
  if (above) notes.push(`${above} cells above C3 = ${sig(cap, 3)} km²/s² (the ridge) are left blank.`);
  if (unsolved) notes.push(`${unsolved} cells have no single-revolution solution and are left blank.`);
  return contourPlotSvg({ grid, levels, filled: false, xlabel: `Days after ${startLabel}`, ylabel: "Time of flight (days)", zlabel: "C3 (km²/s²)", notes, width: W });
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Δv waterfall
// ---------------------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f2 = (v: number): string => v.toFixed(1);
const text = (x: number, y: number, s: string, anchor: string, size = 10, fill = "#000000"): string =>
  `<text x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${fill}">${esc(s)}</text>`;

/** Horizontal Δv waterfall: each leg a floating bar from the running total, the total as a last full bar. */
export function dvWaterfallSvg(legs: LunarLeg[], title: string, width = W): string {
  const rows = [...legs.map((l) => ({ name: l.name, a: 0, b: l.dv })), { name: "Total", a: 0, b: 0 }];
  let acc = 0;
  for (const r of rows) {
    if (r.name === "Total") {
      r.a = 0;
      r.b = acc;
    } else {
      r.a = acc;
      acc += r.b;
      r.b = acc;
    }
  }
  const total = acc / 1000;
  const raw = total / 5;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p10).find((s) => total / s <= 6) ?? 10 * p10;
  const axisMax = Math.ceil(total / step - 1e-9) * step;
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const longest = Math.max(...rows.map((r) => r.name.length));
  const ML = Math.min(210, Math.max(80, longest * 5.8 + 14));
  const MR = 64;
  const MT = 30;
  const ROW = 26;
  const pw = width - ML - MR;
  const plotH = rows.length * ROW;
  const Hh = MT + plotH + 40;
  const X = (v: number): number => ML + (v / 1000 / axisMax) * pw;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Hh}" viewBox="0 0 ${width} ${Hh}">`);
  out.push(`<rect width="${width}" height="${Hh}" fill="#ffffff"/>`);
  out.push(text(width / 2, 18, title, "middle", 12));
  for (let i = 0; i * step <= axisMax + 1e-9; i++) {
    const v = i * step;
    const x = ML + (v / axisMax) * pw;
    // Tick marks below the bars and the zero line only: a full gridline would run through the value labels.
    if (i === 0) out.push(`<line x1="${f2(x)}" y1="${MT}" x2="${f2(x)}" y2="${MT + plotH}" stroke="#000000" stroke-width="1"/>`);
    out.push(`<line x1="${f2(x)}" y1="${MT + plotH}" x2="${f2(x)}" y2="${MT + plotH + 4}" stroke="#333333" stroke-width="1"/>`);
    out.push(text(x, MT + plotH + 14, v.toFixed(dec), "middle", 10, "#333333"));
  }
  out.push(`<line x1="${f2(ML)}" y1="${MT + plotH}" x2="${f2(ML + pw)}" y2="${MT + plotH}" stroke="#333333" stroke-width="1"/>`);
  out.push(text(ML + pw / 2, MT + plotH + 30, "Cumulative Δv (km/s)", "middle", 11));
  rows.forEach((r, i) => {
    const y = MT + i * ROW + 5;
    const h = ROW - 10;
    const x0 = X(r.a);
    const x1 = X(r.b);
    const isTotal = r.name === "Total";
    out.push(`<rect x="${f2(x0)}" y="${f2(y)}" width="${f2(Math.max(x1 - x0, 0.75))}" height="${h}" fill="${isTotal ? "#555555" : BLUE}"/>`);
    out.push(text(ML - 6, y + h / 2 + 4, r.name, "end", 10));
    const val = isTotal ? r.b : r.b - r.a;
    out.push(text(x1 + 4, y + h / 2 + 4, `${(val / 1000).toFixed(3)}`, "start", 10, "#333333"));
  });
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Orbit changes
// ---------------------------------------------------------------------------------------------------------------

/** Total Δv / v₁ against the radius ratio: Hohmann, bi-elliptic at the chosen rb/r₁, the rb → ∞ limit; thresholds marked. */
export function biellipticSvg(Rb: number, Ruser: number, th: { r1: number; r2: number }): string {
  const Rmax = Math.max(60, Ruser * 1.5);
  const xs = Array.from({ length: 241 }, (_, k) => Math.exp((Math.log(Rmax) * k) / 240));
  const hoh = xs.map((x) => ({ x, y: hohmannDvNorm(x) }));
  // The rb → ∞ curve starts at 0.83 at R = 1: drawn only where it is inside the frame (no "points outside" note).
  const inf = xs.map((x) => ({ x, y: biellipticInfNorm(x) })).filter((p) => p.y <= 0.6);
  const bi = xs.filter((x) => x <= Rb).map((x) => ({ x, y: biellipticDvNorm(x, Rb) })).filter((p) => p.y <= 0.6);
  const series: Series[] = [
    { points: hoh, type: "line", color: BLUE, label: "Hohmann" },
    { points: inf, type: "line", color: GREY, label: "Bi-elliptic, rb → ∞" },
  ];
  if (bi.length > 2) series.push({ points: bi, type: "line", color: ORANGE, label: `Bi-elliptic, rb/r₁ = ${sig(Rb)}` });
  series.push({ points: [{ x: th.r1, y: 0 }, { x: th.r1, y: 0.6 }], type: "line", color: GREEN, label: `R = ${sig(th.r1)}` });
  series.push({ points: [{ x: th.r2, y: 0 }, { x: th.r2, y: 0.6 }], type: "line", color: PURPLE, label: `R = ${sig(th.r2)}` });
  series.push({ points: [{ x: Ruser, y: hohmannDvNorm(Ruser) }], type: "scatter", color: RED, label: "This transfer" });
  return buildPlotSvg(series, { xlabel: "Radius ratio r₂/r₁", ylabel: "Total Δv / v₁", xScale: "log", xLimits: { min: 1, max: Rmax }, yLimits: { min: 0, max: 0.6 }, width: W, height: H });
}

/** The phasing orbit: the shared circular orbit, the phasing ellipse from the burn point, chaser and target. */
export function phasingSvg(r: number, aph: number, leadRad: number, bodyR: number): string {
  const other = 2 * aph - r;
  const lower = other < r;
  // Burn point at angle 0: it is the apoapsis of a lower phasing orbit, the periapsis of a higher one.
  const rp = Math.min(r, other);
  const ra = Math.max(r, other);
  const e = (ra - rp) / (ra + rp);
  const p = rp * (1 + e);
  const ell: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= 240; k++) {
    const nu = (TWO_PI * k) / 240;
    const rr = p / (1 + e * Math.cos(nu));
    const ang = lower ? nu + Math.PI : nu;
    ell.push({ x: (rr * Math.cos(ang)) / 1000, y: (rr * Math.sin(ang)) / 1000 });
  }
  const orbit = circle(0, 0, r / 1000);
  const series: Series[] = [
    { points: circle(0, 0, bodyR / 1000), type: "line", color: GREY, label: "Body" },
    { points: orbit, type: "line", color: BLUE, label: "Target orbit" },
    { points: ell, type: "line", color: ORANGE, label: lower ? "Phasing orbit (lower)" : "Phasing orbit (higher)" },
    { points: [{ x: r / 1000, y: 0 }], type: "scatter", color: GREEN, label: "Chaser, burn point" },
    { points: [{ x: (r * Math.cos(leadRad)) / 1000, y: (r * Math.sin(leadRad)) / 1000 }], type: "scatter", color: RED, label: "Target at the burn" },
  ];
  return equalAspectSvg(series, boxOf([...orbit, ...ell]), "x (km)", "y (km)");
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Perturbations
// ---------------------------------------------------------------------------------------------------------------

/** Sun-synchronous inclination against circular altitude (Earth, J2), with this orbit marked. */
export function ssoCurveSvg(altUserKm: number, incUserDeg: number | null): string {
  const R = R_EQ_SI.earth;
  const pts: Array<{ x: number; y: number }> = [];
  for (let h = 150; h <= 6000; h += 25) {
    const i = ssoInclination(R + h * 1000);
    if (i !== null) pts.push({ x: h, y: i * R2D });
  }
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: "Sun-synchronous" }];
  if (incUserDeg !== null) series.push({ points: [{ x: altUserKm, y: incUserDeg }], type: "scatter", color: RED, label: "This orbit" });
  return buildPlotSvg(series, { xlabel: "Circular altitude (km)", ylabel: "Inclination (°)", xLimits: { min: 0, max: 6000 }, yLimits: { min: 95, max: 180 }, width: W, height: H });
}

/** Splits a longitude path where it wraps across ±180° so no line crosses the map. */
function splitWrap(pts: Array<{ lon: number; lat: number }>): Array<Array<{ x: number; y: number }>> {
  const segs: Array<Array<{ x: number; y: number }>> = [[]];
  for (let k = 0; k < pts.length; k++) {
    const p = { x: pts[k].lon * R2D, y: pts[k].lat * R2D };
    if (k > 0 && Math.abs(pts[k].lon - pts[k - 1].lon) > Math.PI) segs.push([]);
    segs[segs.length - 1].push(p);
  }
  return segs.filter((s) => s.length > 1);
}

const mapOpts = (notes?: string[]) => ({ xlabel: "Longitude (°)", ylabel: "Latitude (°)", xLimits: { min: -180, max: 180 }, yLimits: { min: -90, max: 90 }, width: W, height: Math.round(W * 0.62), ...(notes ? { notes } : {}) });

/** Ground track on a longitude–latitude map (equirectangular), split at the date line. */
export function groundTrackSvg(pts: Array<{ lon: number; lat: number }>, orbits: number): string {
  const series: Series[] = splitWrap(pts).map((s, k) => ({ points: s, type: "line" as const, color: BLUE, ...(k === 0 ? { label: `${orbits} orbits` } : {}) }));
  series.push({ points: [{ x: pts[0].lon * R2D, y: pts[0].lat * R2D }], type: "scatter", color: GREEN, label: "Start (node)" });
  return buildPlotSvg(series, mapOpts());
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Three-body rotating frame
// ---------------------------------------------------------------------------------------------------------------

/**
 * The CR3BP rotating frame (separation 1, barycentre at the origin): zero-velocity curves 2Ω(x, y) = C at this state's C
 * and at the L1, L2 and L3 values, the primaries, the five Lagrange points and the state. `zoom` frames the secondary
 * at ±`zoom` separations instead of the whole system.
 */
export function rotatingFrameSvg(lag: LagrangeResult, cState: number | null, state: { x: number; y: number } | null, names: [string, string], zoom: number | null): string {
  const mu = lag.mu;
  const cx = zoom ? 1 - mu : 0;
  const half = zoom ?? 1.6;
  const xs = Array.from({ length: 161 }, (_, k) => cx - half + (2 * half * k) / 160);
  const ys = Array.from({ length: 161 }, (_, k) => -half + (2 * half * k) / 160);
  const z = ys.map((y) => xs.map((x) => Math.min(twoOmega(mu, x, y), 1e3)));
  const grid: Grid = { xs, ys, z, holes: 0 };
  const lvls: Array<{ c: number; color: string; label: string }> = [
    { c: lag.cL[0], color: BLUE, label: `C(L1) = ${sig(lag.cL[0], 6)}` },
    { c: lag.cL[1], color: GREEN, label: `C(L2) = ${sig(lag.cL[1], 6)}` },
    { c: lag.cL[2], color: ORANGE, label: `C(L3) = ${sig(lag.cL[2], 6)}` },
  ];
  if (cState !== null) lvls.push({ c: cState, color: RED, label: `This state, C = ${sig(cState, 6)}` });
  const series: Series[] = [];
  for (const L of lvls) {
    const ml = marchingSquares(grid, [L.c])[0];
    let first = true;
    for (const path of ml?.paths ?? []) {
      if (path.pts.length < 2) continue;
      series.push({ points: path.pts.map(([x, y]) => ({ x, y })), type: "line", color: L.color, ...(first ? { label: L.label } : {}) });
      first = false;
    }
  }
  const lp = [
    { x: lag.xL[0], y: 0 }, { x: lag.xL[1], y: 0 }, { x: lag.xL[2], y: 0 },
    { x: 0.5 - mu, y: Math.sqrt(3) / 2 }, { x: 0.5 - mu, y: -Math.sqrt(3) / 2 },
  ].filter((p) => Math.abs(p.x - cx) <= half && Math.abs(p.y) <= half);
  series.push({ points: [{ x: -mu, y: 0 }].filter((p) => Math.abs(p.x - cx) <= half), type: "scatter", color: BLACK, label: names[0] });
  series.push({ points: [{ x: 1 - mu, y: 0 }], type: "scatter", color: GREY, label: names[1] });
  if (lp.length) series.push({ points: lp, type: "scatter", color: PURPLE, label: "Lagrange points" });
  if (state && Math.abs(state.x - cx) <= half && Math.abs(state.y) <= half) series.push({ points: [state], type: "scatter", color: RED, label: "This state" });
  const box = { xmin: cx - half, xmax: cx + half, ymin: -half, ymax: half };
  return equalAspectSvg(series.filter((s) => s.points.length > 0), box, "x (separations)", "y (separations)");
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Re-entry and decay
// ---------------------------------------------------------------------------------------------------------------

/** Speed (or deceleration in g) against altitude: the Allen–Eggers closed form and the numerical check. */
export function entrySvg(profile: Array<{ h: number; v: number; a: number }>, numeric: Array<{ h: number; v: number; a: number }> | null, what: "speed" | "decel", hPeak: number | null): string {
  const g0 = 9.80665;
  const val = (p: { v: number; a: number }): number => (what === "speed" ? p.v / 1000 : p.a / g0);
  const series: Series[] = [{ points: profile.map((p) => ({ x: val(p), y: p.h / 1000 })), type: "line", color: BLUE, label: "Allen–Eggers" }];
  if (numeric && numeric.length > 2) series.push({ points: numeric.map((p) => ({ x: val(p), y: p.h / 1000 })), type: "line", color: ORANGE, label: "Integrated, with gravity" });
  if (hPeak !== null && what === "decel") {
    const pk = profile.reduce((b, p) => (p.a > b.a ? p : b), profile[0]);
    series.push({ points: [{ x: pk.a / g0, y: pk.h / 1000 }], type: "scatter", color: RED, label: "Peak (closed form)" });
  }
  return buildPlotSvg(series, { xlabel: what === "speed" ? "Speed (km/s)" : "Deceleration (g)", ylabel: "Altitude (km)", yLimits: { min: 0, max: Math.max(...profile.map((p) => p.h)) / 1000 }, width: W, height: H });
}

/** Altitude against days at three solar-activity levels (the lifetime spread is the result). */
export function decaySvg(curves: Record<string, Array<{ t: number; h: number }>>): string {
  const cols: Record<string, string> = { low: BLUE, moderate: GREEN, high: RED };
  const names: Record<string, string> = { low: "Low activity (F10.7 = 70)", moderate: "Moderate (F10.7 = 150)", high: "High (F10.7 = 250)" };
  const series: Series[] = Object.keys(curves).map((k) => {
    const pts = curves[k];
    const stride = Math.max(1, Math.floor(pts.length / 300));
    return { points: pts.filter((_, i) => i % stride === 0 || i === pts.length - 1).map((p) => ({ x: Math.max(p.t, 1e-3), y: p.h / 1000 })), type: "line" as const, color: cols[k], label: names[k] };
  });
  const tMax = Math.max(...Object.values(curves).map((c) => c[c.length - 1].t));
  return buildPlotSvg(series, { xlabel: "Days from now", ylabel: "Altitude (km)", xLimits: { min: 0, max: tMax * 1.02 }, width: W, height: H });
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Ground station
// ---------------------------------------------------------------------------------------------------------------

/** Footprint (minimum-elevation circle) about the sub-satellite point, the site and the satellite on a map. */
export function footprintSvg(circlePts: Array<{ lon: number; lat: number }>, sub: { lon: number; lat: number }, site: { lon: number; lat: number }, minElevDeg: number): string {
  const series: Series[] = splitWrap(circlePts).map((s, k) => ({ points: s, type: "line" as const, color: BLUE, ...(k === 0 ? { label: `Footprint, ε ≥ ${sig(minElevDeg)}°` } : {}) }));
  series.push({ points: [{ x: sub.lon * R2D, y: sub.lat * R2D }], type: "scatter", color: RED, label: "Sub-satellite point" });
  series.push({ points: [{ x: site.lon * R2D, y: site.lat * R2D }], type: "scatter", color: GREEN, label: "Ground station" });
  return buildPlotSvg(series, mapOpts());
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Thermal
// ---------------------------------------------------------------------------------------------------------------

/** Equilibrium temperature against distance from the Sun for several α/ε (no planet, no internal power). */
export function thermalSvg(alphaOverEps: number, areaRatio: number, distAu: number, tHere: number): string {
  const AU = 149597870700;
  const ds = Array.from({ length: 121 }, (_, k) => 0.2 * Math.pow(40 / 0.2, k / 120));
  const ratios = [0.2, 1, 5];
  const cols = [BLUE, BLACK, ORANGE];
  const series: Series[] = ratios.map((r, k) => ({ points: ds.map((d) => ({ x: d, y: tempAtDistance(r, areaRatio, d * AU) })), type: "line" as const, color: cols[k], label: `α/ε = ${sig(r)}` }));
  if (!ratios.some((r) => Math.abs(r / alphaOverEps - 1) < 0.02)) {
    series.push({ points: ds.map((d) => ({ x: d, y: tempAtDistance(alphaOverEps, areaRatio, d * AU) })), type: "line", color: RED, label: `This craft, α/ε = ${sig(alphaOverEps)}` });
  }
  series.push({ points: [{ x: distAu, y: tHere }], type: "scatter", color: RED, label: "Here (hot case)" });
  return buildPlotSvg(series, { xlabel: "Distance from the Sun (au)", ylabel: "Equilibrium temperature (K)", xScale: "log", yScale: "log", xLimits: { min: 0.2, max: 40 }, width: W, height: H });
}

