// Figures for Engineering ▸ Lighting & rendering (lightingPhysics.ts): the sun path and a shadow plan, the soft-shadow
// ray diagram and widths against receiver distance, illuminance against distance (point against disc), the BRDF lobe
// in the plane of incidence and the white-furnace albedo, render noise against samples, the tone curves, the direct
// beam's transmittance by wavelength and the Henyey–Greenstein phase function.
// Every figure is buildPlotSvg (so the black-and-white/USPTO styles and the label audits apply). Polar curves and the
// ray diagram are parametric line series; a `gap` point starts a new piece. Colours are literal hex; Arial.

import { buildPlotSvg, type Point, type Series } from "./plot";
import { fmtSig } from "./axis";
import {
  ACES_CLIP,
  TONE_NAMES,
  directionalAlbedo,
  discAsPoint,
  discIlluminance,
  henyeyGreenstein,
  hemiVariance,
  isErr,
  kastenYoung,
  lobeInPlane,
  mcRelativeError,
  rayleighTau,
  toneMap,
  type SmithForm,
  type SoftShadow,
  type ToneCurve,
} from "./lightingPhysics";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const BLACK = "#000000";
const ORANGE = "#d46a00";
const PURPLE = "#6a3d9a";

const W = 460;
const H = Math.round(W * 0.66);

/** A label number: four significant figures, trailing zeros dropped, U+2212, ×10ⁿ outside 10⁻³…10⁵. */
export const lsig = (v: number, n = 4): string => fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** Local clock minutes as HH:MM (wrapped into the day). */
export function clock(minutes: number): string {
  const m = Math.round(((minutes % 1440) + 1440) % 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// =====================================================================================================================
// Sun
// =====================================================================================================================

export interface SunPathPoint {
  minute: number;
  elevation: number;
  azimuth: number;
}

/**
 * Elevation against azimuth over the local day, with the horizon, solar noon and the chosen time. When the sun
 * culminates in the north (southern hemisphere, or the tropics) the axis is centred on north (−180…180, labelled as
 * compass bearings), so the path is one unbroken arc.
 */
export function sunPathChartSvg(path: SunPathPoint[], now: { minute: number; elevation: number; azimuth: number }, noon: { elevation: number; azimuth: number }): string {
  const north = noon.azimuth < 90 || noon.azimuth > 270;
  const ax = (a: number): number => (north ? (a > 180 ? a - 360 : a) : a);
  const pts: Point[] = [];
  let prev: number | null = null;
  for (const p of path) {
    const x = ax(p.azimuth);
    const gap = prev !== null && Math.abs(x - prev) > 180;
    pts.push(gap ? { x, y: p.elevation, gap: true } : { x, y: p.elevation });
    prev = x;
  }
  const lo = north ? -180 : 0;
  const hi = north ? 180 : 360;
  const top = Math.max(10, Math.ceil((Math.max(noon.elevation, now.elevation) + 8) / 10) * 10);
  const bottom = Math.min(-10, Math.floor((Math.min(...path.map((p) => p.elevation)) - 2) / 10) * 10);
  const series: Series[] = [
    { points: pts, type: "line", color: BLUE, label: "sun path (apparent)" },
    { points: [{ x: lo, y: 0 }, { x: hi, y: 0 }], type: "line", color: GREY, label: "horizon" },
    { points: [{ x: ax(noon.azimuth), y: noon.elevation }], type: "scatter", color: BLACK, label: `solar noon, ${lsig(noon.elevation, 3)}°` },
    { points: [{ x: ax(now.azimuth), y: now.elevation }], type: "scatter", color: RED, label: `${clock(now.minute)}, ${lsig(now.elevation, 3)}°` },
  ];
  return buildPlotSvg(series, {
    xlabel: "Azimuth (° clockwise from north)",
    ylabel: "Elevation (°)",
    xLimits: { min: lo, max: hi },
    yLimits: { min: Math.max(-90, bottom), max: Math.min(90, top) },
    xTickLabel: north ? (v: number) => lsig(((v % 360) + 360) % 360, 4) : undefined,
    width: W,
    height: H,
  });
}

/**
 * Plan view of the shadow on level ground (east to the right, north up), the object at the origin: the shadow now,
 * and the shadow tip across the day while the shadow is no longer than `cap` heights (a low sun throws it toward
 * infinity). Lengths in the height's unit.
 */
export function shadowPlanSvg(h: number, unit: string, now: { length: number; bearing: number } | null, tips: Array<{ length: number; bearing: number; minute: number }>, cap: number): string {
  const xy = (len: number, bearing: number): { x: number; y: number } => ({ x: len * Math.sin((bearing * Math.PI) / 180), y: len * Math.cos((bearing * Math.PI) / 180) });
  const kept = tips.filter((t) => t.length <= cap * h);
  const all = [...kept.map((t) => xy(t.length, t.bearing)), ...(now && now.length <= cap * h ? [xy(now.length, now.bearing)] : [])];
  const span = Math.max(h * 1.2, ...all.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.1;
  const series: Series[] = [];
  if (kept.length > 1) {
    const pts: Point[] = [];
    let prev: number | null = null;
    for (const t of kept) {
      const p = xy(t.length, t.bearing);
      pts.push(prev !== null && t.minute - prev > 30 ? { ...p, gap: true } : p);
      prev = t.minute;
    }
    series.push({ points: pts, type: "line", color: GREY, label: `shadow tip over the day (to ${lsig(cap, 2)}h)` });
  }
  const notes: string[] = [];
  if (now) {
    if (now.length <= cap * h) {
      const tip = xy(now.length, now.bearing);
      series.push({ points: [{ x: 0, y: 0 }, tip], type: "line", color: BLUE, label: `shadow now, ${lsig(now.length, 4)} ${unit}` });
      series.push({ points: [tip], type: "scatter", color: BLUE });
    } else notes.push(`The shadow now (${lsig(now.length, 4)} ${unit}, bearing ${lsig(now.bearing, 4)}°) runs off this plan.`);
  } else notes.push("The sun is below the horizon at the chosen time: no shadow.");
  series.push({ points: [{ x: 0, y: 0 }], type: "scatter", color: BLACK, label: `object, ${lsig(h, 4)} ${unit} tall` });
  series.push({ points: [{ x: 0, y: -span * 0.9 }, { x: 0, y: span * 0.9 }], type: "line", color: "#cccccc" });
  return buildPlotSvg(series, {
    xlabel: `East (${unit})`,
    ylabel: `North (${unit})`,
    xLimits: { min: -span * 1.25, max: span * 1.25 },
    yLimits: { min: -span, max: span },
    width: W,
    height: H,
    notes,
  });
}

// =====================================================================================================================
// Soft shadows
// =====================================================================================================================

/** Side view: the light (orange), the occluder (black), the receiver, and the four limiting rays; the umbra and penumbra marked on the receiver. */
export function softShadowRaySvg(D: number, w: number, L: number, d: number, s: SoftShadow): string {
  const xr = L + d;
  const ray = (y0: number, y1: number): Point[] => [{ x: 0, y: y0 }, { x: xr, y: y0 + ((y1 - y0) * xr) / L }];
  const rays: Point[] = [];
  for (const [y0, y1] of [[D / 2, w / 2], [-D / 2, -w / 2], [-D / 2, w / 2], [D / 2, -w / 2]] as Array<[number, number]>) {
    const r = ray(y0, y1);
    rays.push({ ...r[0], gap: rays.length > 0 }, r[1]);
  }
  const half = s.outer / 2;
  const series: Series[] = [
    { points: rays, type: "line", color: GREY, label: "limiting rays" },
    { points: [{ x: 0, y: -D / 2 }, { x: 0, y: D / 2 }], type: "line", color: ORANGE, label: `light, D = ${lsig(D)}` },
    { points: [{ x: L, y: -w / 2 }, { x: L, y: w / 2 }], type: "line", color: BLACK, label: `occluder, w = ${lsig(w)}` },
    { points: [{ x: xr, y: s.umbra > 0 ? s.umbra / 2 : -s.umbra / 2 }, { x: xr, y: half }, { x: xr, y: -(s.umbra > 0 ? s.umbra / 2 : -s.umbra / 2), gap: true }, { x: xr, y: -half }], type: "line", color: BLUE, label: `penumbra, ${lsig(s.penumbra)} each` },
  ];
  if (s.umbra > 0) series.push({ points: [{ x: xr, y: -s.umbra / 2 }, { x: xr, y: s.umbra / 2 }], type: "line", color: RED, label: `umbra, ${lsig(s.umbra)}` });
  else series.push({ points: [{ x: xr, y: s.umbra / 2 }, { x: xr, y: -s.umbra / 2 }], type: "line", color: PURPLE, label: `antumbra, ${lsig(-s.umbra)}` });
  const ySpan = Math.max(D, half * 2, w) * 0.62;
  return buildPlotSvg(series, {
    xlabel: "Distance from the light",
    ylabel: "Lateral position",
    xLimits: { min: -0.04 * xr, max: xr * 1.04 },
    yLimits: { min: -ySpan, max: ySpan },
    width: W,
    height: H,
  });
}

/** Penumbra, umbra and the point-light shadow against receiver distance: contact hardening at d = 0. */
export function softShadowWidthSvg(D: number, w: number, L: number, d: number): string {
  const ends = D > w ? (w * L) / (D - w) : null;
  const dMax = Math.max(2 * d, ends !== null ? 1.6 * ends : 0, 0.5 * L);
  const pen: Point[] = [];
  const umb: Point[] = [];
  const pt: Point[] = [];
  for (let i = 0; i <= 200; i++) {
    const x = (dMax * i) / 200;
    pen.push({ x, y: (D * x) / L });
    umb.push({ x, y: Math.max(0, w - ((D - w) * x) / L) });
    pt.push({ x, y: (w * (L + x)) / L });
  }
  const series: Series[] = [
    { points: pen, type: "line", color: BLUE, label: "penumbra (each side)" },
    { points: umb, type: "line", color: RED, label: "umbra" },
    { points: pt, type: "line", color: GREY, label: "point-light shadow" },
    { points: [{ x: d, y: (D * d) / L }, { x: d, y: Math.max(0, w - ((D - w) * d) / L) }], type: "scatter", color: BLACK, label: `receiver at ${lsig(d)}` },
  ];
  if (ends !== null) series.push({ points: [{ x: ends, y: 0 }], type: "scatter", color: PURPLE, label: `umbra ends at ${lsig(ends)}` });
  return buildPlotSvg(series, {
    xlabel: "Occluder to receiver distance d",
    ylabel: "Width",
    xLimits: { min: 0, max: dMax },
    yLimits: { min: 0, max: Math.max(...pen.map((p) => p.y), ...pt.map((p) => p.y)) * 1.06 },
    width: W,
    height: H,
  });
}

// =====================================================================================================================
// Falloff
// =====================================================================================================================

/** Illuminance against distance on log axes: the exact disc and its point approximation, the subject and background marked, and z = 5D. */
export function falloffChartSvg(Lum: number, R: number, d1: number, d2: number): string {
  const zMin = Math.min(R * 0.2, d1 / 4);
  const zMax = Math.max(d2 * 3, 20 * R);
  const exact: Point[] = [];
  const point: Point[] = [];
  for (let i = 0; i <= 240; i++) {
    const z = zMin * Math.pow(zMax / zMin, i / 240);
    exact.push({ x: z, y: discIlluminance(Lum, R, z) });
    point.push({ x: z, y: discAsPoint(Lum, R, z) });
  }
  const five = 10 * R;
  const yLo = discIlluminance(Lum, R, zMax) * 0.6;
  const yHi = discAsPoint(Lum, R, zMin) * 1.5;
  const series: Series[] = [
    { points: point, type: "line", color: GREY, label: "point source, E = I/z²" },
    { points: exact, type: "line", color: BLUE, label: "exact disc, E = πL sin²θ" },
    { points: [{ x: five, y: yLo }, { x: five, y: yHi }], type: "line", color: ORANGE, label: `5 diameters (${lsig(five)} m): 1 % error` },
    { points: [{ x: d1, y: discIlluminance(Lum, R, d1) }], type: "scatter", color: RED, label: `subject, ${lsig(d1)} m` },
    { points: [{ x: d2, y: discIlluminance(Lum, R, d2) }], type: "scatter", color: BLACK, label: `background, ${lsig(d2)} m` },
  ];
  return buildPlotSvg(series, {
    xlabel: "Distance on the light's axis (m)",
    ylabel: "Illuminance (lx)",
    xScale: "log",
    yScale: "log",
    xLimits: { min: zMin, max: zMax },
    yLimits: { min: yLo, max: yHi },
    width: W,
    height: H,
  });
}

// =====================================================================================================================
// BRDF
// =====================================================================================================================

/**
 * The specular lobe f·cosθl in the plane of incidence for several roughness values, each normalised to its own peak,
 * drawn as a polar curve over the surface (y = 0); the view direction as a line.
 */
export function brdfLobeSvg(thetaV: number, F0: number, form: SmithForm, roughness: number): string {
  const rs = [...new Set([0.25, 0.5, 0.75, Math.round(roughness * 1000) / 1000])].sort((a, b) => a - b);
  const colours = [GREEN, BLUE, ORANGE, PURPLE, RED];
  const series: Series[] = [];
  rs.forEach((r, k) => {
    const a = Math.max(r, 0.045) ** 2;
    const vals: Array<{ t: number; f: number }> = [];
    for (let i = 0; i <= 360; i++) {
      const t = -89.75 + (179.5 * i) / 360;
      vals.push({ t, f: lobeInPlane(a, thetaV, F0, form, t) });
    }
    const peak = Math.max(...vals.map((v) => v.f));
    const pts = vals.map((v) => {
      const rho = peak > 0 ? v.f / peak : 0;
      return { x: -Math.sin((v.t * Math.PI) / 180) * rho, y: Math.cos((v.t * Math.PI) / 180) * rho };
    });
    const mine = Math.abs(r - roughness) < 1e-9;
    series.push({ points: pts, type: "line", color: mine ? RED : colours[k % colours.length], label: `r = ${lsig(r, 3)}${mine ? " (yours)" : ""}` });
  });
  const vx = Math.sin((thetaV * Math.PI) / 180);
  const vy = Math.cos((thetaV * Math.PI) / 180);
  series.push({ points: [{ x: 0, y: 0 }, { x: 1.1 * vx, y: 1.1 * vy }], type: "line", color: BLACK, label: `view, θv = ${lsig(thetaV, 3)}°` });
  series.push({ points: [{ x: -1.2, y: 0 }, { x: 1.2, y: 0 }], type: "line", color: GREY, label: "surface" });
  return buildPlotSvg(series, {
    xlabel: "In-plane direction (lobe normalised to its peak)",
    ylabel: "Along the normal",
    xLimits: { min: -1.2, max: 1.2 },
    yLimits: { min: 0, max: 1.2 },
    width: W,
    height: H,
  });
}

/** White-furnace directional albedo against roughness at θv (F = 1), and with the material's F0; the chosen roughness marked. */
export function brdfAlbedoSvg(thetaV: number, F0: number, form: SmithForm, roughness: number, eWhite: number, eF: number): string {
  const white: Point[] = [];
  const withF: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const r = 0.045 + ((1 - 0.045) * i) / 24;
    const a = r * r;
    const ew = directionalAlbedo(a, thetaV, 1, form);
    const ef = directionalAlbedo(a, thetaV, F0, form);
    if (!isErr(ew)) white.push({ x: r, y: ew });
    if (!isErr(ef)) withF.push({ x: r, y: ef });
  }
  const r = Math.max(roughness, 0.045);
  const series: Series[] = [
    { points: white, type: "line", color: BLUE, label: "white furnace, F = 1" },
    { points: withF, type: "line", color: ORANGE, label: `with F0 = ${lsig(F0, 3)}` },
    { points: [{ x: r, y: eWhite }, { x: r, y: eF }], type: "scatter", color: RED, label: `r = ${lsig(r, 3)}` },
    { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }], type: "line", color: GREY, label: "energy conserved" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Perceptual roughness r (α = r²)",
    ylabel: "Directional albedo",
    xLimits: { min: 0, max: 1 },
    yLimits: { min: 0, max: 1.08 },
    width: W,
    height: H,
  });
}

// =====================================================================================================================
// Noise
// =====================================================================================================================

/** Relative noise against samples per pixel on log axes: analytic σ/√N for both strategies and seeded Monte Carlo RMS points. */
export function noiseChartSvg(betaDeg: number, N0: number, sigma0: number, Nt: number, sigmaT: number): string {
  const h = hemiVariance(betaDeg);
  const series: Series[] = [];
  const notes: string[] = [];
  const nMax = Math.max(4096, Nt * 2, N0 * 2);
  const ns: number[] = [];
  for (let n = 1; n <= nMax * 1.0001; n *= 2) ns.push(n);
  if (!isErr(h)) {
    const su = Math.sqrt(h.varUniform) / h.integral;
    const sc = Math.sqrt(h.varCosine) / h.integral;
    series.push({ points: ns.map((n) => ({ x: n, y: su / Math.sqrt(n) })), type: "line", color: BLUE, label: "uniform hemisphere" });
    if (sc > 0) series.push({ points: ns.map((n) => ({ x: n, y: sc / Math.sqrt(n) })), type: "line", color: GREEN, label: "cosine-weighted" });
    else notes.push("Cosine-weighted sampling has zero variance here (β = 90°), so it cannot be drawn on a log axis.");
    const mcU: Point[] = [];
    const mcC: Point[] = [];
    for (const n of ns.filter((x) => x <= 4096)) {
      const trials = Math.max(8, Math.min(64, Math.floor(65536 / n)));
      const u = mcRelativeError("uniform", betaDeg, n, trials, 1 + n);
      const c = mcRelativeError("cosine", betaDeg, n, trials, 7 + n);
      if (!isErr(u) && u > 0) mcU.push({ x: n, y: u });
      if (!isErr(c) && c > 0) mcC.push({ x: n, y: c });
    }
    series.push({ points: mcU, type: "scatter", color: BLUE, label: "seeded MC, uniform" });
    if (mcC.length) series.push({ points: mcC, type: "scatter", color: GREEN, label: "seeded MC, cosine" });
  }
  series.push({ points: [{ x: N0, y: sigma0 }, { x: Nt, y: sigmaT }], type: "line", color: RED, label: `your render, slope −1/2` });
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => y > 0 && Number.isFinite(y));
  return buildPlotSvg(series, {
    xlabel: "Samples per pixel N",
    ylabel: "Relative noise σ/E",
    xScale: "log",
    yScale: "log",
    xLimits: { min: 1, max: nMax },
    yLimits: { min: Math.min(...ys) * 0.6, max: Math.max(...ys) * 1.6 },
    width: W,
    height: H,
    notes,
  });
}

// =====================================================================================================================
// Tone mapping
// =====================================================================================================================

/** Display value against scene-linear value (log x) for the four curves, the inputs marked on each, middle grey drawn. */
export function toneChartSvg(Lw: number, exposed: number[]): string {
  const curves: ToneCurve[] = ["reinhard", "reinhardExt", "hable", "aces"];
  const colours = [GREY, BLUE, GREEN, RED];
  const xMin = 1 / 256;
  const xMax = Math.max(64, ...exposed.map((x) => x * 2));
  const series: Series[] = curves.map((c, k) => {
    const pts: Point[] = [];
    for (let i = 0; i <= 300; i++) {
      const x = xMin * Math.pow(xMax / xMin, i / 300);
      pts.push({ x, y: toneMap(c, x, Lw) });
    }
    return { points: pts, type: "line" as const, color: colours[k], label: c === "reinhardExt" ? `${TONE_NAMES[c]}, Lw = ${lsig(Lw)}` : TONE_NAMES[c] };
  });
  curves.forEach((c, k) => {
    const pts = exposed.filter((x) => x >= xMin && x <= xMax).map((x) => ({ x, y: toneMap(c, x, Lw) }));
    if (pts.length) series.push({ points: pts, type: "scatter", color: colours[k] });
  });
  series.push({ points: [{ x: 0.18, y: 0 }, { x: 0.18, y: 1 }], type: "line", color: "#bbbbbb", label: "scene middle grey 0.18" });
  return buildPlotSvg(series, {
    xlabel: "Scene-linear value after exposure",
    ylabel: "Display-linear value",
    xScale: "log",
    xLimits: { min: xMin, max: xMax },
    yLimits: { min: 0, max: 1.05 },
    width: W,
    height: H,
    notes: [`The ACES fit clips to 1 above ${lsig(ACES_CLIP, 4)}.`],
  });
}

// =====================================================================================================================
// Atmosphere
// =====================================================================================================================

/** Direct-beam Rayleigh transmittance against wavelength at the sun's air mass and overhead; the listed wavelengths marked. */
export function beamTransmittanceSvg(airMass: number, pressureRatio: number, marks: Array<{ lambdaNm: number; T: number }>): string {
  const at = (am: number): Point[] => {
    const pts: Point[] = [];
    for (let l = 380; l <= 720; l += 5) {
      const tau = rayleighTau(l / 1000);
      if (!isErr(tau)) pts.push({ x: l, y: Math.exp(-tau * pressureRatio * am) });
    }
    return pts;
  };
  const am1 = kastenYoung(0);
  const series: Series[] = [
    { points: at(isErr(am1) ? 1 : am1), type: "line", color: GREY, label: "sun overhead (air mass 1)" },
    { points: at(airMass), type: "line", color: ORANGE, label: `air mass ${lsig(airMass, 3)}` },
    { points: marks.map((m) => ({ x: m.lambdaNm, y: m.T })), type: "scatter", color: RED, label: "your wavelengths" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Wavelength (nm)",
    ylabel: "Direct-beam transmittance (Rayleigh)",
    xLimits: { min: 380, max: 720 },
    yLimits: { min: 0, max: 1.05 },
    width: W,
    height: H,
  });
}

/** Henyey–Greenstein p(θ) as a polar curve (forward to the right), normalised to its forward peak, beside the isotropic 1/4π on the same scale. */
export function hgPolarSvg(g: number, thetaDeg: number): string {
  const peak = Math.max(henyeyGreenstein(g, 0), henyeyGreenstein(g, 180));
  const curve: Point[] = [];
  const iso: Point[] = [];
  const r0 = 1 / (4 * Math.PI) / peak;
  for (let i = 0; i <= 360; i++) {
    const t = i;
    const r = henyeyGreenstein(g, t > 180 ? 360 - t : t) / peak;
    curve.push({ x: r * Math.cos((t * Math.PI) / 180), y: r * Math.sin((t * Math.PI) / 180) });
    iso.push({ x: r0 * Math.cos((t * Math.PI) / 180), y: r0 * Math.sin((t * Math.PI) / 180) });
  }
  const rt = henyeyGreenstein(g, thetaDeg) / peak;
  const series: Series[] = [
    { points: curve, type: "line", color: BLUE, label: `Henyey–Greenstein, g = ${lsig(g, 3)}` },
    { points: iso, type: "line", color: GREY, label: "isotropic, 1/4π" },
    { points: [{ x: -1.1, y: 0 }, { x: 1.1, y: 0 }], type: "line", color: "#cccccc", label: "incident light direction" },
    { points: [{ x: rt * Math.cos((thetaDeg * Math.PI) / 180), y: rt * Math.sin((thetaDeg * Math.PI) / 180) }], type: "scatter", color: RED, label: `θ = ${lsig(thetaDeg, 3)}°` },
  ];
  return buildPlotSvg(series, {
    xlabel: "Forward (relative phase, normalised to the peak)",
    ylabel: "Sideways",
    xLimits: { min: -1.15, max: 1.15 },
    yLimits: { min: -0.75, max: 0.75 },
    width: W,
    height: H,
  });
}
