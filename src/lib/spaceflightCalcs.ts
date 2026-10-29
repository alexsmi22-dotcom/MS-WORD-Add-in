// Pane glue for the Spaceflight & missions calculators (v2.206.0): orbit elements and propagation, Lambert, interplanetary
// transfers with a porkchop, the lunar Δv budget, orbit changes, J2 and special orbits, three-body points, re-entry and
// decay, ground-station geometry, and spacecraft thermal balance. Kept OUT of taskpane.ts; the integrator spreads
// SPACEFLIGHT_CALCS into ENG_CALCS under the group "Spaceflight & missions" (after "Trajectory & orbits").
//
// No number is computed here: spaceOrbit.ts, spaceMissions.ts and spaceEnvironment.ts own them. This file reads the
// fields (dimensional ones through units.ts parseMeasured, with "au" read here because units.ts does not know it),
// opens every result with a plain-language reading built from the numbers, states the model and its limits, words the
// result under the display contract (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import { G0 } from "./orbital";
import { AU_M, DAY_S, GM_SI, R_EQ_SI, R_MEAN_SI, SPACE_BODIES, spaceBody, isoFromJd, julianDate, J2, OMEGA_EARTH } from "./spaceConstants";
import { elementsToState, lambert, norm, propagate, stateToElements, cross, scale, sub, type ElementsFull, type LambertWay, type V3 } from "./spaceOrbit";
import {
  CRITICAL_INC, PAIRS, ROUTH_MU, biellipticDvNorm, biellipticThresholds, bodyDensity, combinedDv, geoRadius, groundTrack, hillRadius, hohmannDvNorm,
  interplanetaryHohmann, j2Rates, jacobi, lagrange, lunarMission, phasing, planeChangeDv, porkchop, repeatTracks, rocheLimits, soiRadius, ssoInclination,
  standishError, trackShift,
} from "./spaceMissions";
import { SUTTON_GRAVES_EARTH, ballisticEntry, coverage, footprintCircle, geodeticToEcef, lookAngles, orbitalDecay, thermalBalance } from "./spaceEnvironment";
import {
  biellipticSvg, decaySvg, dvWaterfallSvg, entrySvg, footprintSvg, groundTrackSvg, lambertArcSvg, orbitInertialSvg, orbitPlaneSvg, phasingSvg, porkchopSvg,
  rotatingFrameSvg, ssoCurveSvg, thermalSvg,
} from "./spaceflightCharts";

export const SPACE_GROUP = "Spaceflight & missions";
type SpaceCalc = EngCalcDef<"Spaceflight & missions">;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const AU_KM = AU_M / 1000;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (400 km, 1.5 au, 7.8 km/s, 3 day, 90 min, " +
  "0.5 rad) and it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** n significant figures (computed value, trailing zeros kept), plain up to 10⁹, ×10ⁿ beyond, U+2212. */
const sf = (v: number, n = 5): string => fmtSig(v, n, 9);
/** A value as the user typed it: 6 significant figures, trailing zeros dropped. */
const trimSig = (v: number): string => fmtSig(v, 6, 9).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
/** Fixed decimals with a true minus. */
const fx = (v: number, d: number): string => trueMinus((Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d));
const km = (m: number, n = 6): string => `${sf(m / 1000, n)} km`;
const kms = (ms: number, n = 5): string => `${sf(ms / 1000, n)} km/s`;
const deg = (rad: number, d = 4): string => `${fx(rad * R2D, d)}°`;
/** A duration in the largest sensible unit. */
function dur(s: number): string {
  const a = Math.abs(s);
  if (a < 120) return `${sf(s, 4)} s`;
  if (a < 7200) return `${sf(s / 60, 4)} min`;
  if (a < 3 * DAY_S) return `${sf(s / 3600, 4)} h`;
  if (a < 1000 * DAY_S) return `${sf(s / DAY_S, 4)} days`;
  return `${sf(s / (365.25 * DAY_S), 4)} years`;
}
const vec = (v: V3, f: number, unit: string, n = 6): string => `(${v.map((x) => sf(x / f, n)).join(", ")}) ${unit}`;

/**
 * Unit-aware field reading (the laserCalcs.ts pattern): errors collected, conversions reported. Astronomical units
 * ("1.5 au", "AU") are converted here to km first (IAU 2012: 149 597 870.7 km exactly) because units.ts does not hold
 * them.
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    let raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const au = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:au|AU|ua)$/.exec(raw);
    if (au) {
      const kmVal = Number(au[1]) * AU_KM;
      raw = `${kmVal} km`;
      const m0 = parseMeasured(raw, si);
      if ("error" in m0) {
        errors.push(`${label}: au is a length and this field is not one.`);
        return NaN;
      }
      conversions.push(`${label}: ${trimSig(Number(au[1]))} au = ${sf(m0.inTarget, 10)} ${shown}`);
      return m0.inTarget;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${trimSig(m.value)} ${formatUnit(m.unit)} = ${trimSig(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  /** A vector "x, y, z" with an optional unit after the last number, converted to `si`. */
  const vector = (key: string, si: string, label: string, required: boolean): V3 | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-").replace(/^\(|\)$/g, "").replace(/\)\s*(?=[A-Za-zµ])/, " ");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required (three numbers x, y, z).`);
      return null;
    }
    const m = /^(.*?)\s*([A-Za-zµ][A-Za-z0-9µ/^·]*)?$/.exec(raw);
    const nums = (m?.[1] ?? raw).split(/\s*[,;]\s*|\s+/).filter((t) => t !== "");
    const unit = m?.[2] ?? "";
    if (nums.length !== 3 || !nums.every((t) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t))) {
      errors.push(`${label}: "${raw}" is not three numbers x, y, z (write 5000, 10000, 2100 or the same with a unit after).`);
      return null;
    }
    let f = 1;
    if (unit) {
      const u = parseMeasured(`1 ${unit}`, si);
      if ("error" in u) {
        errors.push(`${label}: ${u.error}`);
        return null;
      }
      f = u.inTarget;
      if (Math.abs(f - 1) > 1e-12) conversions.push(`${label}: read in ${formatUnit(unit)}`);
    }
    return nums.map((t) => Number(t) * f) as V3;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
    vec: (key: string, si: string, label: string): V3 => vector(key, si, label, true) as V3,
    vecOpt: (key: string, si: string, label: string): V3 | null => vector(key, si, label, false),
  };
}

/** A plain number field (no unit): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};
const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((row) => row.map((c) => trueMinus(c))) });

function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

const BODY_OPTIONS = SPACE_BODIES.map((b) => ({ value: b.id, label: b.label }));
const PLANET_OPTIONS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"].map((id) => ({ value: id, label: spaceBody(id)?.label ?? id }));

function bodyOf(r: (k: string) => string, key: string): { id: string; label: string; mu: number; radius: number } | string {
  const id = (r(key) ?? "").trim();
  const b = spaceBody(id);
  return b ?? `Body: "${id}" is not one of the bodies offered.`;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Orbit from elements or a state vector; propagation
// ---------------------------------------------------------------------------------------------------------------

const elementsCalc: SpaceCalc = {
  id: "space-elements",
  name: "Orbit from elements or state vector, Kepler propagation",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Classical orbital elements to position and velocity, or a state vector to elements, for any conic: circle, ellipse, " +
    "parabola (e = 1 exactly) or hyperbola. Then the position a time t later by Kepler's equation (the universal " +
    "variable), with the period, apsides, specific energy and angular momentum. Size the orbit by its semi-major axis a, " +
    "periapsis radius or semi-latus rectum p (a parabola has no a). Two-body: no J2, drag or third bodies.",
  fields: [
    { key: "body", label: "Central body", default: "earth", kind: "select", options: BODY_OPTIONS },
    { key: "mode", label: "Start from", default: "elements", kind: "select", options: [{ value: "elements", label: "Classical elements" }, { value: "state", label: "State vector (r, v)" }] },
    { key: "size", label: "Size given as (elements)", default: "a", kind: "select", options: [{ value: "a", label: "Semi-major axis a" }, { value: "rp", label: "Periapsis radius" }, { value: "p", label: "Semi-latus rectum p" }] },
    { key: "a", label: "a, periapsis radius or p (km; radius from the centre)", default: "26600 km", kind: "text" },
    { key: "e", label: "Eccentricity e", default: "0.74", kind: "text" },
    { key: "i", label: "Inclination i (deg)", default: "63.4", kind: "text" },
    { key: "raan", label: "Right ascension of the ascending node Ω (deg)", default: "40", kind: "text" },
    { key: "argp", label: "Argument of periapsis ω (deg)", default: "270", kind: "text" },
    { key: "nu", label: "True anomaly ν at epoch (deg)", default: "30", kind: "text" },
    { key: "r", label: "Position r = x, y, z (km; state-vector mode)", default: "-6045, -3490, 2500 km", kind: "text" },
    { key: "v", label: "Velocity v = vx, vy, vz (km/s; state-vector mode)", default: "-3.457, 6.618, 2.533 km/s", kind: "text" },
    { key: "t", label: "Propagate by t (s; min, h, day convert; blank for none)", default: "2 h", kind: "text" },
  ],
  compute: (r) => {
    const body = bodyOf(r, "body");
    if (typeof body === "string") return refuse(body);
    const mu = body.mu;
    const u = unitReader(r);
    const mode = (r("mode") ?? "").trim();
    const t = u.opt("t", "s", "s", "Propagation time");
    let r0: V3;
    let v0: V3;
    const lines: EngLine[] = [];
    let elIn: string | null = null;
    if (mode === "state") {
      r0 = u.vec("r", "km", "Position");
      v0 = u.vec("v", "km/s", "Velocity");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      r0 = scale(r0, 1000);
      v0 = scale(v0, 1000);
    } else if (mode === "elements") {
      const size = u.req("a", "km", "km", "Orbit size");
      const iD = u.req("i", "deg", "°", "Inclination");
      const O = u.req("raan", "deg", "°", "Ω");
      const w = u.req("argp", "deg", "°", "ω");
      const nu = u.req("nu", "deg", "°", "True anomaly");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      const e = plain(r("e"));
      if (!(e >= 0)) return refuse(`Eccentricity: "${(r("e") ?? "").trim()}" is not a number of 0 or more.`);
      if (e > 100) return refuse("Eccentricity: above 100 the hyperbola is a straight line for every practical purpose; enter a value of 100 or less.");
      if (!(iD >= 0 && iD <= 180)) return refuse("Inclination: must be from 0° to 180° (above 90° is retrograde).");
      const kind = (r("size") ?? "").trim();
      let p: number;
      const sizeM = size * 1000;
      if (kind === "a") {
        if (Math.abs(e - 1) < 1e-9) return refuse("A parabola (e = 1) has no finite semi-major axis: size it by the periapsis radius or by p instead.");
        if (e < 1 && !(sizeM > 0)) return refuse("For an ellipse the semi-major axis must be greater than zero.");
        const a = e > 1 ? -Math.abs(sizeM) : sizeM;
        if (e > 1 && sizeM > 0) elIn = `a read as ${km(a)} (a hyperbola's semi-major axis is negative by convention).`;
        p = a * (1 - e * e);
      } else if (kind === "rp") {
        if (!(sizeM > 0)) return refuse("The periapsis radius must be greater than zero.");
        p = sizeM * (1 + e);
      } else if (kind === "p") {
        if (!(sizeM > 0)) return refuse("The semi-latus rectum p must be greater than zero.");
        p = sizeM;
      } else return refuse(`Size given as: "${kind}" is not one of a, rp or p.`);
      const nuR = nu * D2R;
      if (e >= 1) {
        const nuInf = Math.acos(-1 / e);
        const nuW = Math.atan2(Math.sin(nuR), Math.cos(nuR));
        if (Math.abs(nuW) >= nuInf - 1e-9) return refuse(`True anomaly: ${trimSig(nu)}° is not on this ${e === 1 ? "parabola" : "hyperbola"}. Its true anomaly is limited to ±${fx(nuInf * R2D, 3)}° (the asymptotes); enter a value inside that range.`);
      }
      const rp = p / (1 + e);
      if (rp < body.radius) lines.push(`Note: the periapsis radius ${km(rp)} is inside ${body.label} (radius ${km(body.radius)}): this conic intersects the body.`);
      const st = elementsToState(mu, { p, e, i: iD * D2R, raan: O * D2R, argp: w * D2R, nu: nuR });
      r0 = st.r;
      v0 = st.v;
    } else return refuse(`Start from: "${mode}" is not elements or state.`);
    const el = stateToElements(mu, r0, v0);
    if ("ok" in el) return refuse(el.error);
    if (norm(r0) < body.radius) return refuse(`The position is ${km(norm(r0))} from the centre, inside ${body.label} (radius ${km(body.radius)}). Enter positions from the centre, not altitudes.`);
    let r1: V3 | null = null;
    let v1: V3 | null = null;
    let el1: ElementsFull | null = null;
    if (t !== null) {
      if (Math.abs(t) > 1e3 * 365.25 * DAY_S) return refuse("Propagation time: more than 1000 years is refused (two-body propagation is meaningless that far).");
      const pr = propagate(mu, r0, v0, t);
      if (!pr.ok) return refuse(pr.error);
      r1 = pr.r;
      v1 = pr.v;
      const e1 = stateToElements(mu, r1, v1);
      if ("ok" in e1) return refuse(e1.error);
      el1 = e1;
    }
    const alt = (rr: number): string => km(rr - body.radius);
    const R0 = norm(r0);
    // ---- reading
    let reading: string;
    if (el.conic === "elliptic" || el.conic === "circular") {
      reading = el.conic === "circular"
        ? `This ${body.label} orbit is circular at ${alt(R0)} altitude with a period of ${dur(el.period as number)}.`
        : `This ${body.label} orbit is an ellipse from ${alt(el.rp)} to ${alt(el.ra as number)} altitude with a period of ${dur(el.period as number)}.`;
    } else {
      const vinf = el.conic === "parabolic" ? 0 : Math.sqrt(2 * el.energy);
      reading = el.conic === "parabolic"
        ? `This trajectory is exactly parabolic: it escapes ${body.label} with nothing to spare, passing ${alt(el.rp)} altitude at closest approach.`
        : `This trajectory escapes ${body.label}: a hyperbola passing ${alt(el.rp)} altitude at closest approach and leaving at ${kms(vinf, 4)} (C3 = ${sf((vinf / 1000) ** 2, 4)} km²/s²).`;
    }
    if (r1 && v1 && t !== null) reading += ` ${dur(t)} ${t >= 0 ? "after" : "before"} the epoch it is at ${alt(norm(r1))} altitude moving ${kms(norm(v1), 4)}.`;
    if (el.rp < body.radius) reading += ` Its periapsis is inside ${body.label}, so it would hit the surface first.`;
    lines.push(reading);
    if (elIn) lines.push(elIn);
    lines.push({ math: "v^2 = {mu} (2/r - 1/a)", fallback: "v² = μ·(2/r − 1/a)" });
    lines.push({ math: "M = E - e sin(E)", fallback: "M = E − e·sin E (ellipse); M = e·sinh F − F (hyperbola); Barker's equation for e = 1" });
    lines.push({ math: "r = p/(1 + e cos(nu))", fallback: "r = p/(1 + e·cos ν)" });
    const conv: string[] = [];
    if (el.circular && !el.equatorial) conv.push("circular: ω is undefined and reported as 0, so ν is the argument of latitude u (from the ascending node)");
    if (el.equatorial && !el.circular) conv.push("equatorial: Ω is undefined and reported as 0, so ω is the longitude of periapsis ϖ (from the x axis)");
    if (el.circular && el.equatorial) conv.push("circular and equatorial: Ω and ω are undefined and reported as 0, so ν is the true longitude ℓ (from the x axis)");
    if (conv.length) lines.push(`Conventions for the undefined angles: ${conv.join("; ")}.`);
    const rows: string[][] = [["Element", "At epoch", ...(el1 ? ["At time t"] : [])]];
    const both = (label: string, f: (e: ElementsFull) => string): void => {
      rows.push([label, f(el), ...(el1 ? [f(el1)] : [])]);
    };
    both("Semi-major axis a", (e) => (e.a === null ? "none (parabola)" : km(e.a)));
    both("Eccentricity e", (e) => sf(e.e, 6));
    both("Inclination i", (e) => deg(e.i));
    both("RAAN Ω", (e) => deg(e.raan));
    both("Argument of periapsis ω", (e) => deg(e.argp));
    both(el.circular ? (el.equatorial ? "True longitude ℓ" : "Argument of latitude u") : "True anomaly ν", (e) => deg(e.circular ? (e.equatorial ? e.trueLon : e.u) : e.nu));
    both("Semi-latus rectum p", (e) => km(e.p));
    both("Periapsis altitude", (e) => alt(e.rp));
    if (el.ra !== null) both("Apoapsis altitude", (e) => (e.ra === null ? "none" : alt(e.ra)));
    both("Specific energy", (e) => `${sf(e.energy / 1e6, 6)} km²/s²`);
    both("Angular momentum h", (e) => `${sf(e.h / 1e6, 6)} km²/s`);
    if (el.period !== null) both("Period", (e) => (e.period === null ? "none" : dur(e.period)));
    both("Time since periapsis", (e) => (e.circular ? "undefined (circular)" : dur(e.tSincePeri)));
    rows.push(["Position r", vec(r0, 1000, "km"), ...(r1 ? [vec(r1, 1000, "km")] : [])]);
    rows.push(["Velocity v", vec(v0, 1000, "km/s"), ...(v1 ? [vec(v1, 1000, "km/s")] : [])]);
    lines.push(`Orbit type: ${el.conic}. Speed at epoch ${kms(norm(v0), 6)} at ${km(R0)} from the centre.`);
    lines.push(`Model: two-body, ${body.label} a point mass with GM = ${sf(mu / 1e9, 9)} km³/s² (IAU 2009, script-extracted). No J2 (an Earth orbit's node turns several degrees a day at low altitude), no drag, no third bodies or solar pressure: a real orbit drifts away from this, and the further the propagation the further it drifts. Kepler's equation is solved by bracketed Newton iteration and refused by name if it does not converge.`);
    const outputs: EngOutput[] = [
      { key: "e", label: "Eccentricity", value: el.e, unit: "" },
      { key: "i", label: "Inclination", value: el.i * R2D, unit: "°" },
      { key: "p", label: "Semi-latus rectum", value: el.p / 1000, unit: "km" },
      { key: "energy", label: "Specific energy", value: el.energy / 1e6, unit: "km²/s²" },
      { key: "h", label: "Angular momentum", value: el.h / 1e6, unit: "km²/s" },
      { key: "rpAlt", label: "Periapsis altitude", value: (el.rp - body.radius) / 1000, unit: "km" },
    ];
    if (el.a !== null) outputs.push({ key: "a", label: "Semi-major axis", value: el.a / 1000, unit: "km" });
    if (el.period !== null) outputs.push({ key: "period", label: "Period", value: el.period, unit: "s" });
    if (r1 && v1) outputs.push({ key: "rT", label: "Distance at t", value: norm(r1) / 1000, unit: "km" }, { key: "vT", label: "Speed at t", value: norm(v1) / 1000, unit: "km/s" });
    // Figures: the true shape in its plane, and the path in inertial X–Y and X–Z.
    const nuT = el1 ? (el1.circular ? (el1.equatorial ? el1.trueLon : el1.u) - (el.circular ? 0 : el.argp) : el1.nu) : null;
    const nu0p = el.circular ? (el.equatorial ? el.trueLon : el.u) : el.nu;
    const path: V3[] = [];
    const span = el.period ?? Math.max(Math.abs(t ?? 0) * 1.6, 4 * Math.abs(el.tSincePeri), 3600);
    const t0 = el.period ? 0 : -span / 2;
    for (let k = 0; k <= 240; k++) {
      const pr = propagate(mu, r0, v0, el.period ? (span * k) / 240 : t0 + (span * k) / 240 - el.tSincePeri);
      if (pr.ok && norm(pr.r) < 8 * Math.max(R0, el.rp, body.radius) + (el.ra ?? 0)) path.push(pr.r);
    }
    const extra: AnalyzeBlock[] = [
      table("Orbital elements", rows),
      plot(orbitPlaneSvg(el.p, el.e, body.radius, body.label, nu0p, nuT), "The orbit in its own plane, drawn to scale", `The ${el.conic} orbit in its plane with ${body.label} to scale, periapsis to the right, and the positions at epoch and after the propagation time marked`),
    ];
    if (path.length > 2) {
      extra.push(plot(orbitInertialSvg(path, body.radius, r0, r1, "xy"), "Inertial view looking down the z axis (X–Y)", "The orbit projected on the inertial X–Y plane with the body's equator"));
      extra.push(plot(orbitInertialSvg(path, body.radius, r0, r1, "xz"), "Inertial view edge-on (X–Z)", "The orbit projected on the inertial X–Z plane, showing its inclination"));
    }
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Lambert
// ---------------------------------------------------------------------------------------------------------------

const lambertCalc: SpaceCalc = {
  id: "space-lambert",
  name: "Lambert's problem: transfer between two positions in a given time",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Two position vectors and a time of flight give the one conic that joins them (Lambert's problem, solved by the " +
    "universal variable): the departure and arrival velocities, the transfer orbit, and the two burns from circular " +
    "orbits at each end (or from the velocities you give). Short or long way round; single revolution. A 180° transfer " +
    "is refused: its plane is undefined.",
  fields: [
    { key: "body", label: "Central body", default: "earth", kind: "select", options: BODY_OPTIONS },
    { key: "r1", label: "Departure position r₁ = x, y, z (km)", default: "5000, 10000, 2100 km", kind: "text" },
    { key: "r2", label: "Arrival position r₂ = x, y, z (km)", default: "-14600, 2500, 7000 km", kind: "text" },
    { key: "tof", label: "Time of flight (s; min, h, day convert)", default: "1 h", kind: "text" },
    { key: "way", label: "Direction", default: "short", kind: "select", options: [{ value: "short", label: "Short way (Δθ < 180°)" }, { value: "long", label: "Long way (Δθ > 180°)" }] },
    { key: "vb", label: "Velocity before departure (km/s vector; blank: circular)", default: "", kind: "text" },
    { key: "va", label: "Velocity wanted after arrival (km/s vector; blank: circular)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const body = bodyOf(r, "body");
    if (typeof body === "string") return refuse(body);
    const mu = body.mu;
    const u = unitReader(r);
    const r1k = u.vec("r1", "km", "Departure position");
    const r2k = u.vec("r2", "km", "Arrival position");
    const tof = u.req("tof", "s", "s", "Time of flight");
    const vb = u.vecOpt("vb", "km/s", "Velocity before departure");
    const va = u.vecOpt("va", "km/s", "Velocity after arrival");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const way = (r("way") ?? "").trim() as LambertWay;
    if (way !== "short" && way !== "long") return refuse(`Direction: "${way}" is not short or long.`);
    const r1 = scale(r1k, 1000);
    const r2 = scale(r2k, 1000);
    for (const [n, v] of [["Departure", r1], ["Arrival", r2]] as Array<[string, V3]>) {
      if (norm(v) < body.radius) return refuse(`${n} position: ${km(norm(v))} from the centre is inside ${body.label} (radius ${km(body.radius)}). Positions are measured from the centre.`);
    }
    if (!(tof > 0)) return refuse("Time of flight: must be greater than zero.");
    const L = lambert(mu, r1, r2, tof, way);
    if (!L.ok) return refuse(L.error);
    const tr = stateToElements(mu, r1, L.v1);
    if ("ok" in tr) return refuse(tr.error);
    const hHat = scale(cross(r1, L.v1), 1 / norm(cross(r1, L.v1)));
    const circ = (rv: V3): V3 => scale(cross(hHat, scale(rv, 1 / norm(rv))), Math.sqrt(mu / norm(rv)));
    const vBefore = vb ? scale(vb, 1000) : circ(r1);
    const vAfter = va ? scale(va, 1000) : circ(r2);
    const dv1 = norm(sub(L.v1, vBefore));
    const dv2 = norm(sub(vAfter, L.v2));
    const lines: EngLine[] = [];
    const ends = vb || va ? "from the velocities given" : "from circular orbits at both ends, in the transfer plane";
    let reading = `Getting from r₁ to r₂ in ${dur(tof)} the ${way} way takes ${tr.conic === "hyperbolic" ? "a hyperbolic" : tr.conic === "parabolic" ? "a parabolic" : "an elliptical"} transfer through ${fx(L.dtheta * R2D, 2)}°; the two burns total ${kms(dv1 + dv2, 4)} (${kms(dv1, 4)} + ${kms(dv2, 4)}) ${ends}.`;
    if (tr.rp < body.radius && L.dtheta > 0) {
      // Does the arc itself pass periapsis? Only then is the intersection real.
      const nu1 = tr.nu > Math.PI ? tr.nu - 2 * Math.PI : tr.nu;
      if (nu1 < 0 && nu1 + L.dtheta > 0) reading += ` The arc dips to ${km(tr.rp - body.radius)} altitude, inside ${body.label}: it cannot be flown.`;
    }
    lines.push(reading);
    lines.push({ math: "Delta t sqrt(mu) = (y(z)/C(z))^(3/2) S(z) + A sqrt(y(z))", fallback: "√μ·Δt = (y/C)^(3/2)·S + A·√y (universal-variable Lambert equation)" });
    lines.push({ math: "A = sin(Delta theta) sqrt((r_1 r_2)/(1 - cos(Delta theta)))", fallback: "A = sin Δθ·√(r₁r₂/(1 − cos Δθ))" });
    lines.push(`Transfer angle Δθ = ${deg(L.dtheta, 3)}; z = ${sf(L.z, 6)} (z > 0 ellipse, z < 0 hyperbola); solved in ${L.iterations} bracketed steps.`);
    lines.push(`Minimum-energy transfer for this geometry: ${dur(L.tofMinEnergy)}; the parabolic time is ${dur(L.tofParabolic)} (a shorter flight is hyperbolic).`);
    if (Math.abs(L.dtheta * R2D - 180) < 1) lines.push("Caution: the transfer angle is within 1° of 180°, where the plane is nearly undefined; the out-of-plane velocity is very sensitive to tiny position errors.");
    const rows = [
      ["Quantity", "Departure", "Arrival"],
      ["Transfer velocity", vec(L.v1, 1000, "km/s"), vec(L.v2, 1000, "km/s")],
      ["Speed", kms(norm(L.v1), 6), kms(norm(L.v2), 6)],
      [vb || va ? "Orbit velocity given / assumed" : "Circular orbit velocity", vec(vBefore, 1000, "km/s"), vec(vAfter, 1000, "km/s")],
      ["Burn Δv", kms(dv1, 6), kms(dv2, 6)],
    ];
    const orb = [
      ["Transfer orbit", "Value"],
      ["Semi-major axis a", tr.a === null ? "none (parabola)" : km(tr.a)],
      ["Eccentricity e", sf(tr.e, 6)],
      ["Inclination i", deg(tr.i)],
      ["Periapsis altitude", km(tr.rp - body.radius)],
      ["Period", tr.period === null ? "none (open conic)" : dur(tr.period)],
    ];
    lines.push(`Model: two-body, single revolution (multi-revolution solutions are not offered), impulsive burns. ${body.label} GM = ${sf(mu / 1e9, 9)} km³/s². Below the parabolic time the transfer is hyperbolic (solved, not refused); 0° and 180° transfers, and long-way times too short for the arithmetic to resolve, are refused by name.`);
    const outputs: EngOutput[] = [
      { key: "dv1", label: "Departure Δv", value: dv1 / 1000, unit: "km/s" },
      { key: "dv2", label: "Arrival Δv", value: dv2 / 1000, unit: "km/s" },
      { key: "dvTotal", label: "Total Δv", value: (dv1 + dv2) / 1000, unit: "km/s" },
      { key: "v1", label: "Departure speed", value: norm(L.v1) / 1000, unit: "km/s" },
      { key: "v2", label: "Arrival speed", value: norm(L.v2) / 1000, unit: "km/s" },
      { key: "e", label: "Transfer eccentricity", value: tr.e, unit: "" },
      { key: "dtheta", label: "Transfer angle", value: L.dtheta * R2D, unit: "°" },
    ];
    if (tr.a !== null) outputs.push({ key: "a", label: "Transfer semi-major axis", value: tr.a / 1000, unit: "km" });
    return finish(lines, u.conversions, [
      table("Lambert transfer velocities and burns", rows),
      table("Transfer orbit", orb),
      plot(lambertArcSvg(mu, r1, L.v1, r2, tof, body.radius, tr.period), "The transfer arc in its own plane, to scale", "The Lambert transfer arc from the departure point to the arrival point in the transfer plane, with the departure and arrival radii and the central body"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Interplanetary
// ---------------------------------------------------------------------------------------------------------------

const interplanetaryCalc: SpaceCalc = {
  id: "space-interplanetary",
  name: "Interplanetary transfer, launch windows & porkchop (C3)",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Planet to planet: the Hohmann transfer between circular coplanar orbits (flight time, departure C3 and v∞, the Δv " +
    "from a parking orbit with the Oberth effect, the capture Δv at arrival), the synodic period that spaces the launch " +
    "windows and the next window after a date. Then a porkchop: C3 over departure date and flight time, one Lambert solve " +
    "per cell, with planet positions from JPL's approximate (Standish) elements, valid 1800 to 2050.",
  fields: [
    { key: "dep", label: "Departure planet", default: "earth", kind: "select", options: PLANET_OPTIONS },
    { key: "arr", label: "Arrival planet", default: "mars", kind: "select", options: PLANET_OPTIONS },
    { key: "park", label: "Parking orbit altitude at departure (km)", default: "300 km", kind: "text" },
    { key: "capp", label: "Capture orbit periapsis altitude (km)", default: "400 km", kind: "text" },
    { key: "capa", label: "Capture orbit apoapsis altitude (km; = periapsis for circular)", default: "400 km", kind: "text" },
    { key: "start", label: "Window opens (date, YYYY-MM-DD)", default: "2026-09-01", kind: "text" },
    { key: "span", label: "Departure span (days)", default: "200 day", kind: "text" },
    { key: "tmin", label: "Shortest flight time (days)", default: "120 day", kind: "text" },
    { key: "tmax", label: "Longest flight time (days)", default: "400 day", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const park = u.req("park", "km", "km", "Parking altitude");
    const capp = u.req("capp", "km", "km", "Capture periapsis");
    const capa = u.req("capa", "km", "km", "Capture apoapsis");
    const span = u.req("span", "day", "days", "Departure span");
    const tmin = u.req("tmin", "day", "days", "Shortest flight time");
    const tmax = u.req("tmax", "day", "days", "Longest flight time");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const dep = (r("dep") ?? "").trim();
    const arr = (r("arr") ?? "").trim();
    const startRaw = (r("start") ?? "").trim();
    const jd0 = julianDate(startRaw);
    if (jd0 === null) return refuse(`Window opens: "${startRaw}" is not a date written YYYY-MM-DD (for example 2026-09-01).`);
    if (!spaceBody(dep) || !spaceBody(arr)) return refuse("Both planets must be chosen from the list.");
    const H = interplanetaryHohmann(dep, arr, park * 1000, capp * 1000, capa * 1000, jd0);
    if (!H.ok) return refuse(H.error);
    const pc = porkchop(dep, arr, jd0, span, tmin, tmax, 41);
    if (!pc.ok) return refuse(pc.error);
    const Ld = spaceBody(dep)!.label;
    const La = spaceBody(arr)!.label;
    const lines: EngLine[] = [];
    const best = pc.best;
    let reading = `A minimum-energy ${Ld}→${La} transfer takes ${sf(H.tofS / DAY_S, 4)} days and needs C3 = ${sf(H.c3 / 1e6, 4)} km²/s²: ${kms(H.dvDepart, 4)} from a ${trimSig(park)} km parking orbit, then ${kms(H.dvCapture, 4)} to be captured at ${La}.`;
    reading += ` Windows recur every ${sf(H.synodicS / DAY_S, 4)} days (the synodic period)`;
    reading += H.nextWindowJd !== null ? `; the next Hohmann alignment after ${startRaw} is about ${isoFromJd(H.nextWindowJd)}.` : ".";
    if (best) reading += ` In the window searched the lowest C3 is ${sf(best.c3 / 1e6, 4)} km²/s², leaving ${isoFromJd(best.depJd)} on a ${sf(best.tofDays, 3)}-day flight.`;
    else reading += " No cell of the window searched has a single-revolution solution.";
    lines.push(reading);
    lines.push({ math: "C_3 = v_inf^2", fallback: "C3 = v∞² (twice the hyperbolic excess energy)" });
    lines.push({ math: "Delta v = sqrt(v_inf^2 + 2 mu/r_p) - sqrt(mu/r_p)", fallback: "Δv = √(v∞² + 2μ/rₚ) − √(μ/rₚ) (from a circular parking orbit: the Oberth effect)" });
    lines.push({ math: "S = 1/abs(1/T_1 - 1/T_2)", fallback: "S = 1/|1/T₁ − 1/T₂| (synodic period)" });
    const rows = [
      ["Hohmann transfer", "Value"],
      ["Flight time", `${sf(H.tofS / DAY_S, 5)} days`],
      ["Departure v∞", kms(H.vinfDep, 5)],
      ["Departure C3", `${sf(H.c3 / 1e6, 5)} km²/s²`],
      [`Δv from the ${trimSig(park)} km parking orbit`, kms(H.dvDepart, 5)],
      ["Arrival v∞", kms(H.vinfArr, 5)],
      [`Capture Δv (${trimSig(capp)} × ${trimSig(capa)} km)`, kms(H.dvCapture, 5)],
      ["Phase angle at departure (arrival planet ahead)", deg(H.phaseRad, 2)],
      ["Synodic period", `${sf(H.synodicS / DAY_S, 5)} days`],
    ];
    if (H.phaseNowRad !== null) rows.push([`Phase on ${startRaw}`, deg(H.phaseNowRad, 2)]);
    if (best) {
      rows.push(["Porkchop minimum: departure", isoFromJd(best.depJd)]);
      rows.push(["Porkchop minimum: flight time", `${sf(best.tofDays, 4)} days`]);
      rows.push(["Porkchop minimum: C3", `${sf(best.c3 / 1e6, 5)} km²/s²`]);
      rows.push(["Porkchop minimum: arrival v∞", kms(best.vinfArr, 5)]);
    }
    const e1 = standishError(dep);
    const e2 = standishError(arr);
    lines.push(`Model: the Hohmann figures assume circular coplanar planet orbits at the Standish J2000 semi-major axes (${sf(H.r1 / AU_M, 6)} and ${sf(H.r2 / AU_M, 6)} au), impulsive burns, and patched conics (the planets' gravity only inside their spheres of influence). The real orbits are eccentric and inclined, which is why the porkchop's best C3 differs from the Hohmann value. The porkchop uses prograde single-revolution Lambert transfers between positions from Standish's Table 1 (JPL, valid 1800 to 2050); its published accuracy over that interval is ${e1[0]}″ in longitude and ${e1[2]} thousand km in distance for ${dep === "earth" ? "the Earth–Moon barycentre" : Ld}, ${e2[0]}″ and ${e2[2]} thousand km for ${arr === "earth" ? "the Earth–Moon barycentre" : La}. Checked here against the DE421 ephemeris at five dates 1900 to 2050: within those figures for Mercury to Saturn, but Uranus and Neptune reached 82″ and 45″ in longitude (nominal 50″ and 10″) and Neptune 0.92 million km in distance (nominal 0.2 million), still under 0.03° in direction. A porkchop cell checked against DE421 positions agrees in C3 to within 1 %. Good enough to find a window; a mission design uses a full ephemeris (DE440) and a launch-vehicle C3 curve.`);
    if (pc.holes) lines.push(`${pc.holes} porkchop cells have no single-revolution prograde solution (or lie on the 180° ridge) and are left blank.`);
    const outputs: EngOutput[] = [
      { key: "tof", label: "Hohmann flight time", value: H.tofS / DAY_S, unit: "days" },
      { key: "c3", label: "Hohmann departure C3", value: H.c3 / 1e6, unit: "km²/s²" },
      { key: "dvDep", label: "Departure Δv from parking orbit", value: H.dvDepart / 1000, unit: "km/s" },
      { key: "dvCap", label: "Capture Δv", value: H.dvCapture / 1000, unit: "km/s" },
      { key: "synodic", label: "Synodic period", value: H.synodicS / DAY_S, unit: "days" },
    ];
    if (best) outputs.push({ key: "c3min", label: "Porkchop minimum C3", value: best.c3 / 1e6, unit: "km²/s²" });
    const extra: AnalyzeBlock[] = [table(`${Ld} to ${La}`, rows)];
    if (best) extra.push(plot(porkchopSvg(pc, startRaw), `Porkchop: departure C3 (km²/s²), ${Ld} to ${La}`, "Contours of departure C3 against the departure date and the time of flight, with the minimum in the low valley"));
    else return refuse("The porkchop window has no single-revolution solution in any cell: widen the flight-time range or move the window.");
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Lunar mission
// ---------------------------------------------------------------------------------------------------------------

const lunarCalc: SpaceCalc = {
  id: "space-lunar",
  name: "Lunar mission Δv budget (TLI, LOI, landing, return)",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Earth parking orbit to the Moon and back by patched conics: trans-lunar injection for a chosen flight time (or the " +
    "minimum-energy transfer), the Moon's sphere of influence, lunar orbit insertion, descent and ascent with your " +
    "gravity-loss allowances, trans-Earth injection, and the whole budget as a waterfall with the propellant it costs at " +
    "an Isp (rocket equation).",
  fields: [
    { key: "park", label: "Earth parking orbit altitude (km)", default: "185 km", kind: "text" },
    { key: "dist", label: "Earth–Moon distance (km)", default: "384400 km", kind: "text" },
    { key: "tof", label: "Flight time to the Moon (days; blank: minimum energy)", default: "3 day", kind: "text" },
    { key: "llo", label: "Lunar orbit altitude (km)", default: "110 km", kind: "text" },
    { key: "land", label: "Land and return to orbit", default: "yes", kind: "select", options: [{ value: "yes", label: "Yes (descent and ascent)" }, { value: "no", label: "No (orbit only)" }] },
    { key: "dloss", label: "Descent gravity-loss allowance (km/s)", default: "0.3 km/s", kind: "text" },
    { key: "aloss", label: "Ascent gravity-loss allowance (km/s)", default: "0.15 km/s", kind: "text" },
    { key: "mcc", label: "Mid-course correction allowance per leg (km/s)", default: "0.03 km/s", kind: "text" },
    { key: "isp", label: "Specific impulse (s)", default: "320 s", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const park = u.req("park", "km", "km", "Parking altitude");
    const dist = u.req("dist", "km", "km", "Earth–Moon distance");
    const tof = u.opt("tof", "s", "s", "Flight time");
    const llo = u.req("llo", "km", "km", "Lunar orbit altitude");
    const dloss = u.req("dloss", "km/s", "km/s", "Descent allowance");
    const aloss = u.req("aloss", "km/s", "km/s", "Ascent allowance");
    const mcc = u.req("mcc", "km/s", "km/s", "Mid-course allowance");
    const isp = u.req("isp", "s", "s", "Specific impulse");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const land = (r("land") ?? "").trim();
    if (land !== "yes" && land !== "no") return refuse(`Land: "${land}" is not yes or no.`);
    const res = lunarMission({ parkAltM: park * 1000, moonDistM: dist * 1000, tofS: tof, lloAltM: llo * 1000, descentLossMs: dloss * 1000, ascentLossMs: aloss * 1000, mccMs: mcc * 1000, landing: land === "yes", ispS: isp });
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    lines.push(`Getting from a ${trimSig(park)} km parking orbit to a ${trimSig(llo)} km lunar orbit takes about ${kms(res.tliDv + res.loiDv, 3)} (TLI ${kms(res.tliDv, 4)} plus insertion ${kms(res.loiDv, 4)}) on a ${sf(res.tofS / DAY_S, 3)}-day flight; the whole ${land === "yes" ? "landing and return " : "orbit-and-return "}budget is ${kms(res.totalDv, 4)}, which with a ${trimSig(isp)} s engine in one stage is ${fx(res.propFraction * 100, 1)} % of the departure mass in propellant.`);
    lines.push({ math: "Delta v_TLI = v_p - sqrt(mu_E/r_0)", fallback: "Δv(TLI) = vₚ − √(μE/r₀), vₚ the perigee speed of the translunar conic" });
    lines.push({ math: "Delta v_LOI = sqrt(v_inf^2 + 2 mu_M/r_L) - sqrt(mu_M/r_L)", fallback: "Δv(LOI) = √(v∞² + 2μM/rL) − √(μM/rL)" });
    lines.push({ math: "m_f/m_0 = exp(-Delta v/(I_sp g_0))", fallback: "mf/m₀ = exp(−Δv/(Isp·g₀))" });
    lines.push(`Translunar conic: perigee speed ${kms(res.vTli, 6)}, eccentricity ${sf(res.e, 5)}${res.apogeeM !== null ? `, apogee ${km(res.apogeeM - R_EQ_SI.earth)} altitude` : " (hyperbolic)"}; flight time ${sf(res.tofS / DAY_S, 4)} days. Arrival excess speed relative to the Moon v∞ = ${kms(res.vinfMoon, 4)}.`);
    lines.push(`The Moon's sphere of influence (Laplace, a(m/M)^(2/5)) is ${km(res.soiM)} in radius; this calculation patches at the Moon's centre distance, not at that boundary, which shifts the TLI by a few tens of m/s.`);
    const rows: string[][] = [["Leg", "Δv (km/s)", "Mass left (fraction)", "Note"]];
    res.legs.forEach((l, i) => rows.push([l.name, sf(l.dv / 1000, 4), sf(res.massAfter[i], 4), l.note]));
    rows.push(["Total", sf(res.totalDv / 1000, 4), sf(1 - res.propFraction, 4), `propellant ${fx(res.propFraction * 100, 1)} % at ${trimSig(isp)} s`]);
    lines.push(`Model: patched conics with a circular coplanar lunar orbit (the Moon's 5.1° inclination and its distance changing by ±5 % are ignored), impulsive burns except the gravity-loss allowances you enter, and the return equal to the outbound by symmetry. Apollo's flown values for comparison: TLI about 3.1 km/s, LOI about 0.9 km/s. Mass fractions treat the whole budget as one stage at ${trimSig(isp)} s (g₀ = ${G0}); a real vehicle stages and drops the lander.`);
    const outputs: EngOutput[] = [
      { key: "tli", label: "TLI Δv", value: res.tliDv / 1000, unit: "km/s" },
      { key: "loi", label: "LOI Δv", value: res.loiDv / 1000, unit: "km/s" },
      { key: "total", label: "Total Δv", value: res.totalDv / 1000, unit: "km/s" },
      { key: "tof", label: "Flight time", value: res.tofS / DAY_S, unit: "days" },
      { key: "prop", label: "Propellant fraction", value: res.propFraction, unit: "" },
      { key: "soi", label: "Lunar sphere of influence", value: res.soiM / 1000, unit: "km" },
    ];
    return finish(lines, u.conversions, [
      table("Lunar Δv budget", rows),
      plot(dvWaterfallSvg(res.legs, "Lunar mission Δv budget"), "Δv budget waterfall, leg by leg to the total", "Horizontal waterfall bars of each mission leg's Δv stacked to the total"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Orbit changes
// ---------------------------------------------------------------------------------------------------------------

const maneuverCalc: SpaceCalc = {
  id: "space-maneuvers",
  name: "Orbit changes: plane change, bi-elliptic vs Hohmann, phasing",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Between two circular orbits: the Hohmann Δv with an inclination change done three ways (separately at the start, " +
    "separately at the end, or combined with the circularisation burn), the bi-elliptic alternative and the 11.94 and " +
    "15.58 radius ratios where it wins, and phasing to catch a target a given angle ahead in the final orbit.",
  fields: [
    { key: "body", label: "Central body", default: "earth", kind: "select", options: BODY_OPTIONS },
    { key: "h1", label: "Starting circular altitude (km)", default: "400 km", kind: "text" },
    { key: "h2", label: "Final circular altitude (km)", default: "35786 km", kind: "text" },
    { key: "di", label: "Inclination change Δi (deg)", default: "28.5", kind: "text" },
    { key: "hb", label: "Bi-elliptic intermediate apoapsis altitude (km)", default: "500000 km", kind: "text" },
    { key: "lead", label: "Phasing: target ahead by (deg; negative: behind)", default: "30", kind: "text" },
    { key: "revs", label: "Phasing revolutions", default: "1", kind: "text" },
  ],
  compute: (r) => {
    const body = bodyOf(r, "body");
    if (typeof body === "string") return refuse(body);
    const mu = body.mu;
    const u = unitReader(r);
    const h1 = u.req("h1", "km", "km", "Starting altitude");
    const h2 = u.req("h2", "km", "km", "Final altitude");
    const di = u.req("di", "deg", "°", "Inclination change");
    const hb = u.req("hb", "km", "km", "Bi-elliptic apoapsis");
    const lead = u.req("lead", "deg", "°", "Lead angle");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const revs = plain(r("revs"));
    if (!(h1 >= 0) || !(h2 >= 0)) return refuse("Altitudes must be zero or more: below zero is inside the body.");
    if (!(Math.abs(di) <= 180)) return refuse("The inclination change must be between −180° and 180°.");
    const r1 = body.radius + h1 * 1000;
    const r2 = body.radius + h2 * 1000;
    const rb = body.radius + hb * 1000;
    if (Math.abs(r1 - r2) < 1) return refuse("The two orbits are the same; enter different altitudes (a pure plane change at one altitude: set the final altitude 1 km higher).");
    if (rb < Math.max(r1, r2)) return refuse("The bi-elliptic intermediate apoapsis must be at or above the higher of the two orbits.");
    const dI = Math.abs(di) * D2R;
    const v1 = Math.sqrt(mu / r1);
    const v2 = Math.sqrt(mu / r2);
    const at = (r1 + r2) / 2;
    const vp = Math.sqrt(mu * (2 / r1 - 1 / at));
    const va = Math.sqrt(mu * (2 / r2 - 1 / at));
    const hoh = Math.abs(vp - v1) + Math.abs(v2 - va);
    // Plane change options.
    const sepStart = hoh + planeChangeDv(v1, dI);
    const sepEnd = hoh + planeChangeDv(v2, dI);
    const combEnd = Math.abs(vp - v1) + combinedDv(va, v2, dI);
    const combStart = combinedDv(v1, vp, dI) + Math.abs(v2 - va);
    const R = Math.max(r1, r2) / Math.min(r1, r2);
    const Rb = rb / Math.min(r1, r2);
    const vRef = Math.sqrt(mu / Math.min(r1, r2));
    const bi = biellipticDvNorm(R, Rb) * vRef;
    const hohN = hohmannDvNorm(R) * vRef;
    const th = biellipticThresholds();
    const tHoh = Math.PI * Math.sqrt(at ** 3 / mu);
    const a1b = (Math.min(r1, r2) + rb) / 2;
    const a2b = (rb + Math.max(r1, r2)) / 2;
    const tBi = Math.PI * (Math.sqrt(a1b ** 3 / mu) + Math.sqrt(a2b ** 3 / mu));
    const ph = Number.isFinite(revs) ? phasing(mu, r2, lead * D2R, revs, body.radius) : { ok: false as const, error: `Phasing revolutions: "${(r("revs") ?? "").trim()}" is not a number.` };
    if (!ph.ok) return refuse(ph.error);
    const best = [
      { k: "combined with the circularisation burn", v: combEnd },
      { k: "separately after arriving", v: sepEnd },
      { k: "separately before leaving", v: sepStart },
    ].sort((a, b) => a.v - b.v);
    const lines: EngLine[] = [];
    let reading = `Going from ${trimSig(h1)} km to ${trimSig(h2)} km costs ${kms(hoh, 4)} by Hohmann`;
    reading += dI > 0 ? `; the ${trimSig(Math.abs(di))}° plane change is cheapest ${best[0].k} (${kms(best[0].v, 4)} in all), against ${kms(sepStart, 4)} if done before leaving, because the craft is slowest at the top of the transfer.` : ".";
    reading += R > th.r2 ? ` At a radius ratio of ${sf(R, 4)} (above ${sf(th.r2, 4)}) every bi-elliptic transfer beats Hohmann on Δv; this one saves ${kms(hohN - bi, 3)} but takes ${dur(tBi)} instead of ${dur(tHoh)}.`
      : R > th.r1 ? ` At a radius ratio of ${sf(R, 4)} (between ${sf(th.r1, 4)} and ${sf(th.r2, 4)}) a bi-elliptic transfer can win if its apoapsis is high enough; with this one it ${bi < hohN ? `saves ${kms(hohN - bi, 3)}` : `costs ${kms(bi - hohN, 3)} more`}.`
        : ` At a radius ratio of ${sf(R, 4)} (below ${sf(th.r1, 4)}) Hohmann is the cheapest two-impulse transfer, and no bi-elliptic beats it.`;
    reading += ` Catching a target ${trimSig(lead)}° ${lead > 0 ? "ahead" : "behind"} in the final orbit over ${revs} revolution${revs === 1 ? "" : "s"} takes ${kms(ph.dvTotal, 3)} (two burns) and ${dur(ph.timeS)}.`;
    lines.push(reading);
    lines.push({ math: "Delta v = 2 v sin(Delta i/2)", fallback: "Δv = 2v·sin(Δi/2) (pure plane change)" });
    lines.push({ math: "Delta v = sqrt(v_1^2 + v_2^2 - 2 v_1 v_2 cos(Delta i))", fallback: "Δv = √(v₁² + v₂² − 2v₁v₂·cos Δi) (speed and plane changed in one burn)" });
    lines.push({ math: "T_ph = T (1 - theta/(2 pi k))", fallback: "Tph = T·(1 − θ/(2πk)), k phasing revolutions" });
    const rows = [
      ["Option", "Total Δv (km/s)", "Time"],
      ["Hohmann, no plane change", sf(hoh / 1000, 5), dur(tHoh)],
      ["Hohmann + plane change before leaving", sf(sepStart / 1000, 5), dur(tHoh)],
      ["Hohmann + plane change after arriving", sf(sepEnd / 1000, 5), dur(tHoh)],
      ["Plane change combined with the first burn", sf(combStart / 1000, 5), dur(tHoh)],
      ["Plane change combined with the second burn", sf(combEnd / 1000, 5), dur(tHoh)],
      [`Bi-elliptic via ${trimSig(hb)} km (no plane change)`, sf(bi / 1000, 5), dur(tBi)],
      [`Phasing, ${trimSig(lead)}° in ${revs} rev`, sf(ph.dvTotal / 1000, 5), dur(ph.timeS)],
    ];
    lines.push(`Bi-elliptic thresholds (computed as roots, not typed): R = ${sf(th.r1, 7)} (below it Hohmann always wins) and R = ${sf(th.r2, 7)} (above it every bi-elliptic wins). Phasing orbit: period ${dur(ph.periodPhasing)} against ${dur(ph.periodTarget)}, ${ph.lower ? "lower" : "higher"}, other apsis at ${km(ph.otherApsis - body.radius)} altitude.`);
    lines.push("Model: two-body, impulsive burns, coplanar circular end orbits; the combined burn puts all of the plane change at one apsis (splitting it a few degrees between the two burns saves a little more, not computed here). Two-impulse Hohmann is optimal only among two-burn transfers.");
    const outputs: EngOutput[] = [
      { key: "hohmann", label: "Hohmann Δv", value: hoh / 1000, unit: "km/s" },
      { key: "combined", label: "Hohmann with combined plane change", value: combEnd / 1000, unit: "km/s" },
      { key: "separate", label: "Hohmann with plane change before leaving", value: sepStart / 1000, unit: "km/s" },
      { key: "bielliptic", label: "Bi-elliptic Δv", value: bi / 1000, unit: "km/s" },
      { key: "phasing", label: "Phasing Δv", value: ph.dvTotal / 1000, unit: "km/s" },
      { key: "ratio", label: "Radius ratio", value: R, unit: "" },
    ];
    return finish(lines, u.conversions, [
      table("Orbit-change options", rows),
      plot(biellipticSvg(Rb, R, th), "Total Δv against radius ratio: Hohmann and bi-elliptic", "Total delta-v divided by the inner circular speed against the radius ratio on a log axis, for Hohmann and bi-elliptic transfers, with the 11.94 and 15.58 thresholds and this transfer marked"),
      plot(phasingSvg(r2, ph.aPhasing, lead * D2R, body.radius), "Phasing orbit and the target's lead at the burn", "The circular orbit, the phasing ellipse from the burn point, the chaser and the target"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Perturbations and special orbits
// ---------------------------------------------------------------------------------------------------------------

const perturbCalc: SpaceCalc = {
  id: "space-perturbations",
  name: "J2 perturbations, sun-synchronous & repeat ground-track orbits, GEO drift",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Earth's oblateness (J2) turns an orbit's node and periapsis: the nodal regression and apsidal precession at an " +
    "altitude and inclination, the sun-synchronous inclination for that altitude, the critical (frozen-perigee) " +
    "inclination 63.43°, the westward ground-track shift per orbit and the nearest repeat ground tracks, and the " +
    "longitude drift of a satellite slightly off geostationary.",
  fields: [
    { key: "h", label: "Altitude (km; mean, circular or the semi-major axis minus R)", default: "800 km", kind: "text" },
    { key: "e", label: "Eccentricity e", default: "0", kind: "text" },
    { key: "i", label: "Inclination (deg; or sso for sun-synchronous)", default: "sso", kind: "text" },
    { key: "days", label: "Repeat cycles to search, up to (days)", default: "16", kind: "text" },
    { key: "da", label: "GEO semi-major axis offset Δa (km)", default: "50 km", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const h = u.req("h", "km", "km", "Altitude");
    const da = u.req("da", "km", "km", "GEO offset");
    const iRaw = (r("i") ?? "").trim();
    let iDeg: number | null = null;
    if (!/^sso$/i.test(iRaw)) iDeg = u.req("i", "deg", "°", "Inclination");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const e = plain(r("e"));
    const maxDays = plain(r("days"));
    if (!(e >= 0 && e < 0.9)) return refuse("Eccentricity: must be from 0 to below 0.9 (the J2 rates here are for bound, not extreme, orbits).");
    if (!(maxDays >= 1 && maxDays <= 60 && Number.isInteger(maxDays))) return refuse("Repeat cycles: a whole number of days from 1 to 60.");
    if (!(h > 0)) return refuse("Altitude: must be greater than zero (below zero is inside Earth).");
    if (h > 100000) return refuse("Altitude: above 100 000 km the Moon's and the Sun's pulls dominate J2 and these rates do not describe the orbit.");
    const R = R_EQ_SI.earth;
    const a = R + h * 1000;
    if (a * (1 - e) < R) return refuse(`With e = ${trimSig(e)} the periapsis (${km(a * (1 - e) - R)} altitude) is inside Earth.`);
    let i: number;
    let ssoNote = "";
    const sso = ssoInclination(a, e);
    if (iDeg === null) {
      if (sso === null) return refuse(`No inclination is sun-synchronous at ${trimSig(h)} km: J2 is too weak that high to turn the node 0.9856° a day (the limit is near 5970 km for a circular orbit).`);
      i = sso;
      ssoNote = " (the sun-synchronous value)";
    } else {
      if (!(iDeg >= 0 && iDeg <= 180)) return refuse("Inclination: must be from 0° to 180°.");
      i = iDeg * D2R;
    }
    const rates = j2Rates(GM_SI.earth, R, J2.earth, a, e, i);
    const perDay = (x: number): number => x * R2D * DAY_S;
    const { shift } = trackShift(a, i);
    const reps = repeatTracks(h * 1000, i, maxDays).slice(0, 6);
    const aGeo = geoRadius();
    const drift = -1.5 * ((da * 1000) / aGeo) * OMEGA_EARTH; // rad/s, eastward positive
    const lines: EngLine[] = [];
    let reading = `At ${trimSig(h)} km and ${deg(i, 2)}${ssoNote}, Earth's oblateness turns the orbit's node ${fx(perDay(rates.raanDot), 4)}°/day and its periapsis ${fx(perDay(rates.argpDot), 4)}°/day.`;
    if (sso !== null) reading += Math.abs(i - sso) < 1e-6 ? " The node keeps pace with the Sun (0.9856°/day), so the orbit is sun-synchronous: it crosses each latitude at the same local time all year." : ` Sun-synchronous at this altitude would need ${deg(sso, 2)}.`;
    reading += ` The ground track moves ${fx(shift * R2D, 3)}° (${sf((shift * R) / 1000, 5)} km at the equator) west each orbit`;
    reading += reps.length ? `; the nearest exact repeat is ${reps[0].revs} orbits in ${reps[0].days} day${reps[0].days === 1 ? "" : "s"}, at ${km(reps[0].altitudeM, 5)}.` : ".";
    lines.push(reading);
    lines.push({ math: "dot(Omega) = -3/2 n J_2 (R/p)^2 cos(i)", fallback: "Ω̇ = −(3/2)·n·J₂·(R/p)²·cos i" });
    lines.push({ math: "dot(omega) = 3/4 n J_2 (R/p)^2 (5 cos(i)^2 - 1)", fallback: "ω̇ = (3/4)·n·J₂·(R/p)²·(5cos²i − 1)" });
    lines.push({ math: "Delta lambda = (omega_E - dot(Omega)) T_N", fallback: "Δλ = (ωE − Ω̇)·T(nodal), the westward shift per orbit" });
    lines.push({ math: "dot(lambda) = -3/2 (Delta a/a) omega_E", fallback: "λ̇ = −(3/2)·(Δa/a)·ωE (drift of a near-geostationary satellite)" });
    const rows = [
      ["Quantity", "Value"],
      ["Mean motion n", `${sf(perDay(rates.n), 6)} °/day`],
      ["Keplerian period", dur((2 * Math.PI) / rates.n)],
      ["Nodal (draconitic) period, J2", dur(rates.nodalPeriod)],
      ["Nodal regression Ω̇", `${fx(perDay(rates.raanDot), 5)} °/day`],
      ["Apsidal precession ω̇", `${fx(perDay(rates.argpDot), 5)} °/day`],
      ["Sun-synchronous inclination here", sso === null ? "none (too high)" : deg(sso, 3)],
      ["Critical inclinations (ω̇ = 0)", `${deg(CRITICAL_INC, 3)} and ${deg(Math.PI - CRITICAL_INC, 3)}`],
      ["Ground-track shift per orbit", `${fx(shift * R2D, 4)}° west`],
      ["Revolutions per day", sf((2 * Math.PI) / shift, 6)],
      ["Geostationary radius / altitude", `${km(aGeo, 7)} / ${km(aGeo - R, 7)}`],
      [`GEO drift for Δa = ${trimSig(da)} km`, `${fx(perDay(drift), 4)} °/day (${drift < 0 ? "west" : drift > 0 ? "east" : "none"})`],
    ];
    const repRows = [["Repeat (orbits / days)", "Altitude for an exact repeat", "Change from here"]];
    for (const rp of reps) repRows.push([`${rp.revs} / ${rp.days}`, km(rp.altitudeM, 6), `${trueMinus(fx((rp.altitudeM / 1000 - h), 2))} km`]);
    lines.push(`Model: first-order secular J2 only (J2 = ${J2.earth}, R = ${km(R, 8)}), mean elements, spherical-Earth ground track with Earth's sidereal rate ${OMEGA_EARTH} rad/s; no drag, no J3 (which makes a real frozen orbit's eccentricity about 0.001 at 63.4°), no Sun and Moon (which tilt a GEO orbit's plane about 0.8°/year). A GEO satellite also drifts in longitude from Earth's equatorial ellipticity (J22) toward the stable points at 75° E and 105° W, not modelled. The repeat altitudes are for a circular orbit at this inclination.`);
    const outputs: EngOutput[] = [
      { key: "raanDot", label: "Nodal regression", value: perDay(rates.raanDot), unit: "°/day" },
      { key: "argpDot", label: "Apsidal precession", value: perDay(rates.argpDot), unit: "°/day" },
      { key: "inc", label: "Inclination used", value: i * R2D, unit: "°" },
      { key: "shift", label: "Ground-track shift per orbit", value: shift * R2D, unit: "°" },
      { key: "geoDrift", label: "GEO drift", value: perDay(drift), unit: "°/day" },
    ];
    if (sso !== null) outputs.push({ key: "sso", label: "Sun-synchronous inclination", value: sso * R2D, unit: "°" });
    const extra: AnalyzeBlock[] = [table("J2 rates and special orbits", rows)];
    if (reps.length) extra.push(table("Nearest repeat ground tracks", repRows));
    extra.push(plot(ssoCurveSvg(h, i * R2D), "Sun-synchronous inclination against altitude", "The sun-synchronous inclination rising from about 96° at 150 km toward 180° near 6000 km, with this orbit marked"));
    extra.push(plot(groundTrackSvg(groundTrack(a, i, 3), 3), "Ground track over three orbits", "The sub-satellite track over three orbits on a longitude-latitude map, starting at the ascending node at 0° longitude"));
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Three-body
// ---------------------------------------------------------------------------------------------------------------

const PAIR_OPTIONS = [...PAIRS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom pair (GM and distance below)" }];

const threeBodyCalc: SpaceCalc = {
  id: "space-three-body",
  name: "Lagrange points, Hill sphere, sphere of influence, Roche limit, Jacobi constant",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "Two bodies in circular orbit about each other (the circular restricted three-body problem): the five Lagrange " +
    "points (L1–L3 by root-finding on the exact force balance), the Hill sphere, the Laplace sphere of influence, the " +
    "rigid and fluid Roche limits, and the Jacobi constant of a state in the rotating frame, with the zero-velocity " +
    "curves that bound where it can go.",
  fields: [
    { key: "pair", label: "Pair", default: "earth-moon", kind: "select", options: PAIR_OPTIONS },
    { key: "mu1", label: "Custom: primary GM (km³/s²)", default: "398600.4418", kind: "text" },
    { key: "mu2", label: "Custom: secondary GM (km³/s²)", default: "4902.8", kind: "text" },
    { key: "d", label: "Separation (km; blank: the pair's value)", default: "", kind: "text" },
    { key: "rhos", label: "Satellite density for the Roche limit (kg/m³)", default: "3340 kg/m^3", kind: "text" },
    { key: "x", label: "State in the rotating frame: x from the barycentre (km)", default: "300000 km", kind: "text" },
    { key: "y", label: "y (km)", default: "0 km", kind: "text" },
    { key: "vx", label: "vx relative to the rotating frame (km/s)", default: "0 km/s", kind: "text" },
    { key: "vy", label: "vy relative to the rotating frame (km/s)", default: "0.1 km/s", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const dIn = u.opt("d", "km", "km", "Separation");
    const rhoS = u.req("rhos", "kg/m^3", "kg/m³", "Satellite density");
    const x = u.req("x", "km", "km", "x");
    const y = u.req("y", "km", "km", "y");
    const vx = u.req("vx", "km/s", "km/s", "vx");
    const vy = u.req("vy", "km/s", "km/s", "vy");
    const pairId = (r("pair") ?? "").trim();
    let mu1: number;
    let mu2: number;
    let dist: number;
    let names: [string, string];
    let pairNote = "";
    let R1: number | null = null;
    if (pairId === "custom") {
      const m1 = u.req("mu1", "km^3/s^2", "km³/s²", "Primary GM");
      const m2 = u.req("mu2", "km^3/s^2", "km³/s²", "Secondary GM");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      if (!(m1 > 0) || !(m2 > 0)) return refuse("Both GM values must be greater than zero.");
      if (dIn === null) return refuse("Separation: a custom pair needs its separation.");
      mu1 = Math.max(m1, m2) * 1e9;
      mu2 = Math.min(m1, m2) * 1e9;
      if (m2 > m1) pairNote = "The secondary's GM was the larger, so the two were swapped: the primary is always the more massive body.";
      names = ["Primary", "Secondary"];
      dist = dIn * 1000;
    } else {
      if (u.errors.length) return refuse(u.errors.join("\n"));
      const p = PAIRS.find((q) => q.id === pairId);
      if (!p) return refuse(`Pair: "${pairId}" is not one of the pairs offered.`);
      mu1 = p.mu1;
      mu2 = p.mu2;
      dist = dIn === null ? p.dist : dIn * 1000;
      names = [p.primary, p.secondary];
      pairNote = `${p.label}: ${p.note}.`;
      const pid = p.primary.toLowerCase();
      R1 = R_MEAN_SI[pid] ?? R_EQ_SI[pid] ?? null;
    }
    if (!(dist > 0)) return refuse("Separation: must be greater than zero.");
    if (!(rhoS > 0)) return refuse("Satellite density: must be greater than zero.");
    const mu = mu2 / (mu1 + mu2);
    const L = lagrange(mu);
    if (!L.ok) return refuse(L.error);
    const kmOf = (xn: number): number => xn * dist;
    const wRate = Math.sqrt((mu1 + mu2) / dist ** 3);
    const vUnit = wRate * dist;
    const xs = (x * 1000) / dist, ys = (y * 1000) / dist, vxs = (vx * 1000) / vUnit, vys = (vy * 1000) / vUnit;
    const rp1 = Math.hypot(xs + mu, ys), rp2 = Math.hypot(xs - 1 + mu, ys);
    if (rp1 < 1e-9 || rp2 < 1e-9) return refuse("The state is at the centre of one of the bodies, where the potential is infinite.");
    const C = jacobi(mu, xs, ys, vxs, vys);
    const hill = hillRadius(dist, 0, mu1, mu2);
    const soi = soiRadius(dist, mu1, mu2);
    const lines: EngLine[] = [];
    const L1fromSec = (1 - mu - L.xL[0]) * dist;
    const L2fromSec = (L.xL[1] - (1 - mu)) * dist;
    const gates = C > L.cL[0] ? `C = ${sf(C, 6)} is above C(L1) = ${sf(L.cL[0], 6)}, so the state is trapped in its own region (around one body, or outside both) and cannot cross between them`
      : C > L.cL[1] ? `C = ${sf(C, 6)} is between C(L2) and C(L1): the neck at L1 is open, so the state can pass between the two bodies but cannot leave through L2`
        : C > L.cL[2] ? `C = ${sf(C, 6)} is below C(L2): the necks at L1 and L2 are open, so it can escape past the secondary`
          : C > L.cL[3] ? `C = ${sf(C, 6)} is below C(L3): only the regions around L4 and L5 are forbidden`
            : `C = ${sf(C, 6)} is below C(L4) = C(L5): no zero-velocity curve exists in the plane, so nothing forbids any position`;
    lines.push(`For ${names[0]}–${names[1]} (mass ratio μ = ${sf(mu, 6)}) L1 lies ${km(L1fromSec, 6)} from ${names[1]} toward ${names[0]} and L2 ${km(L2fromSec, 6)} beyond it; ${names[1]}'s Hill sphere is ${km(hill, 5)} in radius. ${gates}.`);
    if (pairNote) lines.push(pairNote);
    lines.push({ math: "x - (1 - mu)(x + mu)/abs(x + mu)^3 - mu (x - 1 + mu)/abs(x - 1 + mu)^3 = 0", fallback: "x − (1 − μ)(x + μ)/|x + μ|³ − μ(x − 1 + μ)/|x − 1 + μ|³ = 0 (collinear points)" });
    lines.push({ math: "C = x^2 + y^2 + 2(1 - mu)/r_1 + 2 mu/r_2 - v^2", fallback: "C = x² + y² + 2(1 − μ)/r₁ + 2μ/r₂ − v² (Jacobi constant, rotating frame, separation and rate 1)" });
    lines.push({ math: "r_H = a root(3, m/(3 M))", fallback: "rH = a·∛(m/(3M)); rSOI = a·(m/M)^(2/5)" });
    const rows = [["Point", `From ${names[0]} (km)`, `From ${names[1]} (km)`, "Jacobi constant"]];
    const lp = [
      ["L1", L.xL[0], 0], ["L2", L.xL[1], 0], ["L3", L.xL[2], 0], ["L4", 0.5 - mu, Math.sqrt(3) / 2], ["L5", 0.5 - mu, -Math.sqrt(3) / 2],
    ] as Array<[string, number, number]>;
    lp.forEach(([n, px, py], k) => rows.push([n, sf(kmOf(Math.hypot(px + mu, py)) / 1000, 7), sf(kmOf(Math.hypot(px - 1 + mu, py)) / 1000, 7), sf(L.cL[k], 8)]));
    const sph = [["Quantity", "Value"], ["Mass ratio μ = m₂/(m₁ + m₂)", sf(mu, 7)], ["Separation", km(dist, 7)], ["Hill sphere radius (circular orbit)", km(hill, 6)], ["Laplace sphere of influence", km(soi, 6)]];
    let roche: ReturnType<typeof rocheLimits> | null = null;
    if (R1 !== null) {
      const rhoP = bodyDensity(mu1, R1);
      roche = rocheLimits(R1, rhoP, rhoS);
      sph.push([`${names[0]} mean density (from GM and radius)`, `${sf(rhoP, 5)} kg/m³`]);
      sph.push([`Roche limit, rigid satellite (${trimSig(rhoS)} kg/m³)`, km(roche.rigid, 5)]);
      sph.push(["Roche limit, fluid satellite (2.44 R…)", km(roche.fluid, 5)]);
    } else lines.push("Roche limits need the primary's radius, which a custom pair does not give; choose a named pair for them.");
    sph.push(["L4/L5 linearly stable (Routh, μ < 0.03852)", L.triangularStable ? "yes" : "no"]);
    sph.push(["This state's Jacobi constant C", sf(C, 8)]);
    lines.push(`L4 and L5 are ${L.triangularStable ? "linearly stable" : "UNSTABLE"} at this mass ratio (Routh's criterion μ < ${sf(ROUTH_MU, 6)}).`);
    lines.push(`Model: circular restricted three-body problem: the two bodies on circular orbits about their barycentre, the third mass negligible, all motion in the orbit plane for the curves. The real Moon's orbit is eccentric (e ≈ 0.055), which moves L1 by thousands of km over a month. Hill sphere for e = 0; the Roche limits are the classical rigid ∛2·R(ρM/ρs)^(1/3) and fluid 2.44·R(ρM/ρs)^(1/3) (Chandrasekhar 2.455 for a synchronously spinning fluid body: ${roche ? km(roche.fluidChandra, 5) : "needs the primary radius"}).`);
    const outputs: EngOutput[] = [
      { key: "mu", label: "Mass ratio", value: mu, unit: "" },
      { key: "L1", label: "L1 distance from the secondary", value: L1fromSec / 1000, unit: "km" },
      { key: "L2", label: "L2 distance from the secondary", value: L2fromSec / 1000, unit: "km" },
      { key: "L1p", label: "L1 distance from the primary", value: (L.xL[0] + mu) * dist / 1000, unit: "km" },
      { key: "hill", label: "Hill sphere", value: hill / 1000, unit: "km" },
      { key: "soi", label: "Sphere of influence", value: soi / 1000, unit: "km" },
      { key: "C", label: "Jacobi constant", value: C, unit: "" },
    ];
    if (roche) outputs.push({ key: "rocheRigid", label: "Roche limit (rigid)", value: roche.rigid / 1000, unit: "km" }, { key: "rocheFluid", label: "Roche limit (fluid)", value: roche.fluid / 1000, unit: "km" });
    const zoom = Math.max(4 * Math.cbrt(mu / 3), 0.02);
    const extra: AnalyzeBlock[] = [
      table("Lagrange points", rows),
      table("Spheres, limits and the state", sph),
      plot(rotatingFrameSvg(L, C, { x: xs, y: ys }, names, null), "Rotating frame: Lagrange points and zero-velocity curves", "The two bodies, the five Lagrange points and the zero-velocity curves at the L1, L2 and L3 Jacobi constants and at this state's, in the rotating frame with the separation as the unit"),
    ];
    if (zoom < 0.8) extra.push(plot(rotatingFrameSvg(L, C, { x: xs, y: ys }, names, zoom), `Close to ${names[1]}: L1, L2 and the curves near it`, "The neighbourhood of the secondary in the rotating frame with L1, L2 and the zero-velocity curves"));
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Re-entry and decay
// ---------------------------------------------------------------------------------------------------------------

const reentryCalc: SpaceCalc = {
  id: "space-reentry",
  name: "Re-entry (Allen–Eggers, Sutton–Graves) & orbital decay",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "A ballistic entry: the ballistic coefficient m/(C_d·A), the peak deceleration, its altitude and the speed there " +
    "(Allen–Eggers), the Sutton–Graves stagnation heat flux, checked against a numerical integration with gravity on " +
    "the 1976 standard atmosphere; and how long the same object takes to decay from a circular orbit, at low, moderate " +
    "and high solar activity (NRLMSIS 2.1 densities), since that is the largest uncertainty.",
  fields: [
    { key: "m", label: "Mass (kg)", default: "5000 kg", kind: "text" },
    { key: "cd", label: "Drag coefficient C_d", default: "1.3", kind: "text" },
    { key: "A", label: "Reference area (m²)", default: "12 m^2", kind: "text" },
    { key: "v", label: "Entry speed (km/s)", default: "7.8 km/s", kind: "text" },
    { key: "g", label: "Flight-path angle below horizontal (deg)", default: "6", kind: "text" },
    { key: "he", label: "Entry interface altitude (km)", default: "122 km", kind: "text" },
    { key: "rn", label: "Nose radius (m)", default: "3 m", kind: "text" },
    { key: "H", label: "Exponential atmosphere scale height H (km)", default: "7.2 km", kind: "text" },
    { key: "rho0", label: "Surface density ρ₀ (kg/m³)", default: "1.225 kg/m^3", kind: "text" },
    { key: "k", label: "Sutton–Graves constant (kg^½/m; Earth 1.7415e-4)", default: "1.7415e-4", kind: "text" },
    { key: "hd", label: "Decay: circular orbit altitude (km; blank for none)", default: "250 km", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const m = u.req("m", "kg", "kg", "Mass");
    const A = u.req("A", "m^2", "m²", "Area");
    const v = u.req("v", "km/s", "km/s", "Entry speed");
    const g = u.req("g", "deg", "°", "Flight-path angle");
    const he = u.req("he", "km", "km", "Entry altitude");
    const rn = u.req("rn", "m", "m", "Nose radius");
    const H = u.req("H", "km", "km", "Scale height");
    const rho0 = u.req("rho0", "kg/m^3", "kg/m³", "Surface density");
    const hd = u.opt("hd", "km", "km", "Decay altitude");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const cd = plain(r("cd"));
    const kRaw = (r("k") ?? "").trim().replace(/×10\^?/, "e").replace(/[−–]/g, "-");
    const k = plain(kRaw);
    if (!(cd > 0)) return refuse(`Drag coefficient: "${(r("cd") ?? "").trim()}" is not a number above zero.`);
    if (!(k > 0)) return refuse(`Sutton–Graves constant: "${(r("k") ?? "").trim()}" is not a number above zero (Earth air: 1.7415e-4).`);
    if (!(m > 0) || !(A > 0)) return refuse("Mass and area must be greater than zero.");
    const beta = m / (cd * A);
    const res = ballisticEntry({ beta, vEntry: v * 1000, gamma: g * D2R, rho0, H: H * 1000, noseR: rn, kSG: k, hEntry: he * 1000 });
    if (!res.ok) return refuse(res.error);
    let decay: ReturnType<typeof orbitalDecay> | null = null;
    if (hd !== null) {
      decay = orbitalDecay(hd * 1000, beta);
      if (!decay.ok) return refuse(decay.error);
    }
    const g0 = 9.80665;
    const lines: EngLine[] = [];
    const n = res.numeric;
    let reading = `A ${sf(beta, 3)} kg/m² body entering at ${trimSig(v)} km/s and ${trimSig(g)}° peaks at ${sf(res.aMax / g0, 3)} g ${res.peakReached ? `near ${sf(res.hAmax / 1000, 3)} km` : "at the ground (it is still decelerating on impact)"} by the Allen–Eggers closed form`;
    reading += n ? ` (${sf(n.aMax / g0, 3)} g near ${sf(n.hAmax / 1000, 3)} km when integrated with gravity on the 1976 atmosphere)` : "";
    reading += `, with a peak stagnation heat flux of ${sf(res.qMax / 1e4, 3)} W/cm² for a ${trimSig(rn)} m nose.`;
    if (decay && decay.ok) {
      const lt = decay.lifetimeDays;
      const fmt = (d: number | null): string => (d === null ? `over ${sf(decay!.ok ? decay.capDays / 365.25 : 0, 3)} years` : dur(d * DAY_S));
      reading += ` From a ${trimSig(hd as number)} km circular orbit it would come down in about ${fmt(lt.high)} at high solar activity to ${fmt(lt.low)} at low activity (${fmt(lt.moderate)} at moderate).`;
    }
    lines.push(reading);
    lines.push({ math: "beta = m/(C_d A)", fallback: "β = m/(Cd·A)" });
    lines.push({ math: "v = v_E exp(-(rho H)/(2 beta sin(gamma)))", fallback: "v = vE·exp(−ρH/(2β·sin γ)) (Allen–Eggers)" });
    lines.push({ math: "a_max = (v_E^2 sin(gamma))/(2 e H)", fallback: "a(max) = vE²·sin γ/(2eH), at v = vE/√e" });
    lines.push({ math: "q = k sqrt(rho/r_n) v^3", fallback: "q = k·√(ρ/rn)·v³ (Sutton–Graves stagnation-point convective heat flux)" });
    lines.push({ math: "{d a}/{d t} = -rho sqrt(mu a)/beta", fallback: "da/dt = −ρ·√(μa)/β (circular-orbit decay)" });
    const rows = [
      ["Quantity", "Allen–Eggers (closed form)", "Integrated (gravity, 1976 + MSIS)"],
      ["Peak deceleration", `${sf(res.aMax / g0, 4)} g`, n ? `${sf(n.aMax / g0, 4)} g` : "not run"],
      ["Altitude of the peak", res.peakReached ? km(res.hAmax, 4) : "the ground", n ? km(n.hAmax, 4) : ""],
      ["Speed at the peak", kms(res.vAmax, 4), n ? kms(n.vAmax, 4) : ""],
      ["Peak heat flux (Sutton–Graves)", `${sf(res.qMax / 1e4, 4)} W/cm²`, n ? `${sf(n.qMax / 1e4, 4)} W/cm²` : ""],
      ["Altitude of peak heating", km(res.hQmax, 4), n ? km(n.hQmax, 4) : ""],
      ["Speed at the ground (closed form)", res.vGround < 1 ? "below 1 m/s (stopped in the air: the closed form has no gravity)" : kms(res.vGround, 4), n ? `ended: ${n.ended === "slow" ? "below 0.1 km/s" : n.ended}` : ""],
    ];
    if (decay && decay.ok) {
      const lt = decay.lifetimeDays;
      rows.push(["Decay lifetime, low / moderate / high activity", [lt.low, lt.moderate, lt.high].map((d) => (d === null ? "over the 200-year cap" : `${sf(d, 3)} d`)).join(" / "), `from ${trimSig(hd as number)} km to ${sf(decay.stopAltM / 1000, 3)} km`]);
      rows.push(["Decay rate now, low / moderate / high", [decay.rateMPerDay.low, decay.rateMPerDay.moderate, decay.rateMPerDay.high].map((x) => `${sf(x, 3)} m/day`).join(" / "), ""]);
    }
    lines.push(`Ballistic coefficient β = ${sf(beta, 5)} kg/m². Model: Allen–Eggers assumes a straight path at constant γ, drag far above gravity, no lift and an exponential atmosphere with your H and ρ₀ (the 1976 standard atmosphere's local scale height runs from about 6 to 8 km below 90 km); it is good for steep entries and poor below about 3°, where the integrated column is the better guide (the integration assumes a non-rotating spherical Earth and no lift). Sutton–Graves is the convective stagnation-point flux only (NASA TR R-376); radiative heating matters above about 10 km/s and is not included.`);
    lines.push("Decay: King-Hele's quasi-circular rate on the NRLMSIS 2.1 global-mean density, held at one solar-activity level for the whole life; a real lifetime moves with the 11-year solar cycle and with attitude (β changes as a satellite tumbles), so the spread between the three columns is the honest answer, and a factor of two either side of any one is normal.");
    const outputs: EngOutput[] = [
      { key: "beta", label: "Ballistic coefficient", value: beta, unit: "kg/m²" },
      { key: "aMax", label: "Peak deceleration (closed form)", value: res.aMax / g0, unit: "g" },
      { key: "hAmax", label: "Altitude of peak deceleration", value: res.hAmax / 1000, unit: "km" },
      { key: "qMax", label: "Peak heat flux", value: res.qMax / 1e4, unit: "W/cm²" },
    ];
    if (n) outputs.push({ key: "aMaxNum", label: "Peak deceleration (integrated)", value: n.aMax / g0, unit: "g" });
    if (decay && decay.ok && decay.lifetimeDays.moderate !== null) outputs.push({ key: "lifeMod", label: "Decay lifetime (moderate activity)", value: decay.lifetimeDays.moderate, unit: "days" });
    const extra: AnalyzeBlock[] = [
      table("Entry", rows),
      plot(entrySvg(res.profile, n ? n.profile : null, "speed", null), "Speed against altitude through the entry", "Speed falling from the entry speed as altitude drops, closed form and integrated"),
      plot(entrySvg(res.profile, n ? n.profile : null, "decel", res.hAmax), "Deceleration against altitude, peak marked", "Deceleration in g against altitude rising to a peak in the lower atmosphere, closed form and integrated"),
    ];
    if (decay && decay.ok) extra.push(plot(decaySvg(decay.curves), "Orbital decay at three levels of solar activity", "Altitude against days for low, moderate and high solar activity, showing how far apart the lifetimes are"));
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 9. Ground station
// ---------------------------------------------------------------------------------------------------------------

const groundCalc: SpaceCalc = {
  id: "space-ground",
  name: "Ground station: look angles, coverage, pass duration, Doppler",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "From a ground site to a satellite over a given point: azimuth, elevation and slant range on the WGS 84 ellipsoid. " +
    "For a circular orbit at that altitude: the footprint radius and swath above a minimum elevation, the longest pass " +
    "(directly overhead), the largest slant range and the Doppler shift at a carrier frequency. For received power over " +
    "the slant range use Electronics ▸ RF link budget (Friis free-space).",
  fields: [
    { key: "slat", label: "Site latitude (deg, north positive)", default: "40.0", kind: "text" },
    { key: "slon", label: "Site longitude (deg, east positive)", default: "-105.0", kind: "text" },
    { key: "sh", label: "Site height above the ellipsoid (m)", default: "1600 m", kind: "text" },
    { key: "plat", label: "Satellite sub-point latitude (deg)", default: "45.0", kind: "text" },
    { key: "plon", label: "Satellite sub-point longitude (deg)", default: "-100.0", kind: "text" },
    { key: "h", label: "Satellite altitude (km)", default: "550 km", kind: "text" },
    { key: "el", label: "Minimum elevation (deg)", default: "10", kind: "text" },
    { key: "f", label: "Carrier frequency (GHz)", default: "2.25 GHz", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const slat = u.req("slat", "deg", "°", "Site latitude");
    const slon = u.req("slon", "deg", "°", "Site longitude");
    const sh = u.req("sh", "m", "m", "Site height");
    const plat = u.req("plat", "deg", "°", "Sub-point latitude");
    const plon = u.req("plon", "deg", "°", "Sub-point longitude");
    const h = u.req("h", "km", "km", "Satellite altitude");
    const el = u.req("el", "deg", "°", "Minimum elevation");
    const f = u.req("f", "GHz", "GHz", "Frequency");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    for (const [n, val] of [["Site latitude", slat], ["Sub-point latitude", plat]] as Array<[string, number]>) if (!(Math.abs(val) <= 90)) return refuse(`${n}: must be from −90° to 90°.`);
    for (const [n, val] of [["Site longitude", slon], ["Sub-point longitude", plon]] as Array<[string, number]>) if (!(Math.abs(val) <= 360)) return refuse(`${n}: must be from −360° to 360°.`);
    if (!(sh > -500 && sh < 10000)) return refuse("Site height: must be between −500 m and 10 000 m.");
    if (!(h > 0)) return refuse("Satellite altitude: must be greater than zero (below zero is inside Earth).");
    if (h > 400000) return refuse("Satellite altitude: above 400 000 km the satellite is beyond the Moon; this geometry is for Earth orbits.");
    const cov = coverage(h * 1000, el * D2R, f * 1e9);
    if (!cov.ok) return refuse(cov.error);
    const sat = geodeticToEcef(plat * D2R, plon * D2R, h * 1000);
    const la = lookAngles(slat * D2R, slon * D2R, sh, sat);
    const visible = la.elevation >= el * D2R;
    const lines: EngLine[] = [];
    let reading = `From the site the satellite is at azimuth ${fx(la.azimuth * R2D, 1)}°, elevation ${fx(la.elevation * R2D, 1)}°, ${sf(la.range / 1000, 4)} km away: ${visible ? "in view" : la.elevation > 0 ? `above the horizon but below the ${trimSig(el)}° mask` : "below the horizon"}.`;
    reading += ` At ${trimSig(h)} km it sees a footprint ${sf(cov.footprintRadius / 1000, 4)} km in radius above ${trimSig(el)}° elevation (swath ${sf(cov.swath / 1000, 4)} km); an overhead pass lasts at most ${dur(cov.maxPass)}, and the Doppler shift at ${trimSig(f)} GHz reaches ±${sf(cov.dopplerHz / 1000, 4)} kHz at the edges.`;
    lines.push(reading);
    lines.push({ math: "sin(eta) = R cos(epsilon)/(R + h)", fallback: "sin η = R·cos ε/(R + h), λ = 90° − ε − η (Earth central angle to the edge)" });
    lines.push({ math: "Delta f = f dot(rho)/c", fallback: "Δf = f·ρ̇/c (Doppler from the range rate)" });
    const rows = [
      ["Quantity", "Value"],
      ["Azimuth (from north, clockwise)", `${fx(la.azimuth * R2D, 3)}°`],
      ["Elevation", `${fx(la.elevation * R2D, 3)}°`],
      ["Slant range", km(la.range, 6)],
      ["Earth central angle to the footprint edge λ", deg(cov.lambda, 3)],
      ["Nadir angle to the edge η", deg(cov.eta, 3)],
      ["Footprint radius (ground arc)", km(cov.footprintRadius, 5)],
      ["Swath width", km(cov.swath, 5)],
      ["Fraction of Earth's surface in view", `${sf(cov.areaFraction * 100, 4)} %`],
      ["Slant range at the minimum elevation", km(cov.slantMax, 5)],
      ["Orbit period / speed", `${dur(cov.period)} / ${kms(cov.speed, 4)}`],
      ["Longest pass (overhead)", dur(cov.maxPass)],
      ["Largest range rate", kms(cov.rangeRateMax, 4)],
      ["Largest Doppler shift", `±${sf(cov.dopplerHz / 1000, 5)} kHz`],
    ];
    lines.push("Model: the look angles use the WGS 84 ellipsoid for the site and the sub-point (geodetic latitude and height). The coverage, pass and Doppler figures assume a circular orbit over a spherical Earth of equatorial radius and neglect Earth's rotation during the pass (it lengthens or shortens a pass by up to about 7 % in low orbit) and the atmosphere's refraction near the horizon. No TLE or SGP4 propagation is offered: a faithful SGP4 port validated against the published SGP4-VER test vectors has not been made, and a partial one would quietly misplace satellites. The received power over this range is the RF link budget calculator's job (Electronics).");
    const outputs: EngOutput[] = [
      { key: "az", label: "Azimuth", value: la.azimuth * R2D, unit: "°" },
      { key: "el", label: "Elevation", value: la.elevation * R2D, unit: "°" },
      { key: "range", label: "Slant range", value: la.range / 1000, unit: "km" },
      { key: "footprint", label: "Footprint radius", value: cov.footprintRadius / 1000, unit: "km" },
      { key: "pass", label: "Longest pass", value: cov.maxPass, unit: "s" },
      { key: "doppler", label: "Largest Doppler shift", value: cov.dopplerHz / 1000, unit: "kHz" },
    ];
    return finish(lines, u.conversions, [
      table("Ground-station geometry", rows),
      plot(footprintSvg(footprintCircle(plat * D2R, plon * D2R, cov.lambda), { lat: plat * D2R, lon: Math.atan2(Math.sin(plon * D2R), Math.cos(plon * D2R)) }, { lat: slat * D2R, lon: Math.atan2(Math.sin(slon * D2R), Math.cos(slon * D2R)) }, el), "Footprint above the minimum elevation, the sub-satellite point and the site", "A world longitude-latitude map with the satellite's coverage circle, the sub-satellite point and the ground station"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 10. Thermal
// ---------------------------------------------------------------------------------------------------------------

const thermalCalc: SpaceCalc = {
  id: "space-thermal",
  name: "Spacecraft thermal balance (equilibrium temperature)",
  group: "Spaceflight & missions",
  unitContract: "converts",
  hint:
    "One-node radiative equilibrium: solar absorptance α and infrared emittance ε, the solar flux at your distance (1361 " +
    "W/m² at 1 au, scaled by 1/r²), the sunlit and radiating areas, the planet's albedo and infrared with a view factor, " +
    "and internal power. Gives the hot (sunlit) and cold (eclipse) temperatures and how they scale across the solar system.",
  fields: [
    { key: "alpha", label: "Solar absorptance α", default: "0.3", kind: "text" },
    { key: "eps", label: "Infrared emittance ε", default: "0.8", kind: "text" },
    { key: "d", label: "Distance from the Sun (au; km converts)", default: "1 au", kind: "text" },
    { key: "as", label: "Area facing the Sun (m²)", default: "1 m^2", kind: "text" },
    { key: "ar", label: "Total radiating area (m²)", default: "6 m^2", kind: "text" },
    { key: "alb", label: "Planet albedo (fraction; 0 in deep space)", default: "0.3", kind: "text" },
    { key: "ir", label: "Planet infrared flux (W/m²; Earth about 237)", default: "237 W/m^2", kind: "text" },
    { key: "F", label: "View factor to the planet (0 to 1)", default: "0.3", kind: "text" },
    { key: "ap", label: "Area facing the planet (m²)", default: "1 m^2", kind: "text" },
    { key: "q", label: "Internal power (W)", default: "100 W", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const dRaw = (r("d") ?? "").trim();
    const dBare = plain(dRaw);
    const d = Number.isFinite(dBare) ? dBare * AU_KM : u.req("d", "km", "km", "Distance");
    const as = u.req("as", "m^2", "m²", "Sunlit area");
    const ar = u.req("ar", "m^2", "m²", "Radiating area");
    const ir = u.req("ir", "W/m^2", "W/m²", "Planet IR");
    const ap = u.req("ap", "m^2", "m²", "Planet-facing area");
    const q = u.req("q", "W", "W", "Internal power");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const alpha = plain(r("alpha"));
    const eps = plain(r("eps"));
    const alb = plain(r("alb"));
    const F = plain(r("F"));
    for (const [n, v] of [["Absorptance α", alpha], ["Emittance ε", eps], ["Albedo", alb], ["View factor", F]] as Array<[string, number]>) {
      if (!Number.isFinite(v)) return refuse(`${n}: not a number (a fraction from 0 to 1).`);
    }
    const res = thermalBalance({ alpha, eps, distM: d * 1000, aSun: as, aRad: ar, albedo: alb, planetIR: ir, viewF: F, aPlanet: ap, power: q });
    if (!res.ok) return refuse(res.error);
    const dAu = (d * 1000) / AU_M;
    const C = (K: number): string => `${fx(K, 1)} K (${fx(K - 273.15, 1)} °C)`;
    const lines: EngLine[] = [];
    lines.push(`In sunlight at ${sf(dAu, 4)} au this α/ε = ${sf(alpha / eps, 3)} craft settles at ${C(res.tHot)}; in eclipse, with only ${F > 0 && ir > 0 ? "planet infrared and " : ""}its own ${trimSig(q)} W, it falls toward ${C(res.tCold)}.`);
    lines.push({ math: "epsilon sigma A_r T^4 = alpha S A_s + alpha S a F A_p + epsilon q_IR F A_p + Q", fallback: "εσA(rad)T⁴ = αS·A(sun) + αSaF·A(planet) + εq(IR)F·A(planet) + Q" });
    lines.push({ math: "S = 1361 (1/d)^2", fallback: "S = 1361 W/m²·(1 au/d)²" });
    const rows = [
      ["Quantity", "Value"],
      ["Solar flux here", `${sf(res.solarFlux, 5)} W/m²`],
      ["Absorbed sunlight", `${sf(res.qSun, 5)} W`],
      ["Absorbed albedo", `${sf(res.qAlbedo, 5)} W`],
      ["Absorbed planet infrared", `${sf(res.qIR, 5)} W`],
      ["Internal power", `${sf(res.qInt, 5)} W`],
      ["Hot case (sunlit)", C(res.tHot)],
      ["Cold case (eclipse)", C(res.tCold)],
      ["α/ε", sf(alpha / eps, 4)],
    ];
    lines.push("Model: a single isothermal node radiating to deep space at 0 K, steady state (no thermal mass, so the eclipse value is the temperature it would reach in a long eclipse, not the minimum of a 35-minute one), the solar constant 1361 W/m² (IAU 2015 nominal) scaled by 1/r², albedo and planet infrared through one view factor you choose. A design uses a multi-node model with orientation-dependent view factors and the hot/cold extremes of α and ε at end of life.");
    const outputs: EngOutput[] = [
      { key: "tHot", label: "Hot-case temperature", value: res.tHot, unit: "K" },
      { key: "tCold", label: "Cold-case temperature", value: res.tCold, unit: "K" },
      { key: "S", label: "Solar flux", value: res.solarFlux, unit: "W/m²" },
    ];
    return finish(lines, u.conversions, [
      table("Thermal balance", rows),
      plot(thermalSvg(alpha / eps, as / ar, dAu, res.tHot), "Equilibrium temperature against distance from the Sun for several α/ε", "Equilibrium temperature falling with distance from the Sun on log axes, for absorptance-to-emittance ratios of 0.2, 1 and 5 and this craft, with its hot-case point marked"),
    ], outputs);
  },
};

/** The Spaceflight & missions calculators, in dropdown order (group "Spaceflight & missions"). */
export const SPACEFLIGHT_CALCS: SpaceCalc[] = [elementsCalc, lambertCalc, interplanetaryCalc, lunarCalc, maneuverCalc, perturbCalc, threeBodyCalc, reentryCalc, groundCalc, thermalCalc];

