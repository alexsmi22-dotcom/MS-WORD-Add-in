// Photometry and exposure: illuminance, luminance, beams, exposure value,
// f-stops, depth of field and angle of view.
//
// Every function takes SI numbers (metres, seconds, lux, candela, lumen) and
// returns a pure result plus FIGURE DATA in the shared plotter's `Series`
// shape — the pane draws it with buildPlotSvg; nothing here touches the DOM.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   * Candela → lumen with no beam. The units engine refuses `cd → lm`, and
//     correctly: the conversion needs the solid angle the source emits into.
//     `coneFlux` is the honest route round it — the beam angle is a stated
//     input and "uniform intensity across the beam" is said in the output.
//   * EV, f-stops and mired as UNITS. They are logarithmic or reciprocal, and
//     the converter is linear (value × factor). They are calculator outputs.
//
// CITATIONS (named for what they define; no clause numbers are quoted that
// were not checked):
//   * Inverse-square and cosine law for a point source: elementary photometry
//     (CIE S 017 vocabulary: illuminance, luminance, luminous intensity).
//   * EV = log₂(N²/t): the APEX exposure-value definition, as used by ISO 2720
//     (photographic exposure meters) for the meter equations
//     E = C·2^EV/S (incident, constant C) and L = K·2^EV/S (reflected,
//     constant K). ISO 2720 gives RANGES for C and K, so both are inputs.
//   * ISO speed S: ISO 12232 (digital) / ISO 6 (film) define S; it enters
//     only as the arithmetic speed in the meter equations.
//   * Depth of field and hyperfocal distance: the thin-lens formulas found in
//     every optics text (e.g. Ray, "Applied Photographic Optics"). The circle
//     of confusion is a CONVENTION (0.03 mm for 36×24 mm), not a standard.
//   * The cinema screen reference 48 cd/m² (≈ 14 ftL): SMPTE ST 431-1.

import type { Series } from "./plot";

export interface PhotometryError {
  ok: false;
  error: string;
}

/** Figure data for the shared plotter: series plus axis settings. */
export interface PhotoFigure {
  title: string;
  xlabel: string;
  ylabel: string;
  xScale: "linear" | "log";
  yScale: "linear" | "log";
  series: Series[];
}

// --- Exact unit pairs --------------------------------------------------------

/** The foot is exactly 0.3048 m (international yard and pound, 1959). */
const FOOT = 0.3048;
/** 1 fc = 1 lm/ft² in lux. Derived, never retyped: 10.763910416709722. */
export const LUX_PER_FOOTCANDLE = 1 / (FOOT * FOOT);
/** 1 ftL = (1/π) cd/ft² in cd/m². Derived: 3.4262590996353905. */
export const NIT_PER_FOOTLAMBERT = 1 / (Math.PI * FOOT * FOOT);
/** The D-cinema reference white luminance, SMPTE ST 431-1. */
export const CINEMA_REFERENCE_NIT = 48;

export const luxToFootcandle = (lx: number): number => lx / LUX_PER_FOOTCANDLE;
export const footcandleToLux = (fc: number): number => fc * LUX_PER_FOOTCANDLE;
export const nitToFootlambert = (nit: number): number => nit / NIT_PER_FOOTLAMBERT;
export const footlambertToNit = (ftL: number): number => ftL * NIT_PER_FOOTLAMBERT;

// --- helpers -----------------------------------------------------------------

const DEG = Math.PI / 180;

function bad(error: string): PhotometryError {
  return { ok: false, error };
}

/** Names the first input that is not a finite positive number. */
function requirePositive(pairs: Array<[string, number]>): PhotometryError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return bad(`The ${name} must be a finite number.`);
    if (v <= 0) return bad(`The ${name} must be greater than zero (got ${v}).`);
  }
  return null;
}

/** n points spaced logarithmically from a to b inclusive. */
function logSpace(a: number, b: number, n: number): number[] {
  const la = Math.log10(a);
  const lb = Math.log10(b);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.pow(10, la + ((lb - la) * i) / (n - 1)));
  return out;
}

function linSpace(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

// --- Illuminance from a point source -----------------------------------------

export interface PointIlluminanceResult {
  ok: true;
  /** Illuminance on the surface, lx (E = I·cosθ/d²). */
  lux: number;
  /** The same in foot-candles. */
  footcandles: number;
  /** Illuminance on a surface facing the source squarely (θ = 0), lx. */
  normalLux: number;
  notes: string[];
  figure: PhotoFigure;
}

/**
 * Illuminance from a point source: E = I·cos θ / d².
 *
 * `intensityCd` in candela, `distanceM` in metres, `incidenceDeg` the angle
 * between the light's direction and the surface NORMAL (0 = facing the source).
 * Far-field only: the inverse-square law holds once the distance is several
 * times the source's own size (the "five times" rule of thumb).
 */
export function pointIlluminance(
  intensityCd: number,
  distanceM: number,
  incidenceDeg = 0,
): PointIlluminanceResult | PhotometryError {
  if (!Number.isFinite(intensityCd) || intensityCd < 0) {
    return bad("The luminous intensity must be a finite number of candela, zero or more.");
  }
  const e = requirePositive([["distance", distanceM]]);
  if (e) return e;
  if (!Number.isFinite(incidenceDeg)) return bad("The incidence angle must be a finite number of degrees.");
  if (incidenceDeg < 0 || incidenceDeg >= 90) {
    return bad(
      `An incidence angle of ${incidenceDeg}° is outside 0° ≤ θ < 90°: at 90° and beyond the light ` +
        "grazes or strikes the back of the surface, and the cosine law gives no illuminance on the face.",
    );
  }
  const cos = Math.cos(incidenceDeg * DEG);
  const normalLux = intensityCd / (distanceM * distanceM);
  const lux = incidenceDeg === 0 ? normalLux : normalLux * cos;

  const ds = logSpace(distanceM / 10, distanceM * 10, 41);
  const series: Series[] = [
    { type: "line", label: "facing the source (θ = 0°)", points: ds.map((d) => ({ x: d, y: intensityCd / (d * d) })) },
  ];
  if (incidenceDeg > 0) {
    series.push({
      type: "line",
      label: `at θ = ${incidenceDeg}°`,
      points: ds.map((d) => ({ x: d, y: (intensityCd * cos) / (d * d) })),
    });
  }
  series.push({ type: "scatter", label: "entered distance", points: [{ x: distanceM, y: lux }] });

  return {
    ok: true,
    lux,
    footcandles: luxToFootcandle(lux),
    normalLux,
    notes: [
      "E = I·cos θ / d² — the inverse-square law with Lambert's cosine law. Halving the distance " +
        "quadruples the illuminance (a slope of −2 on the log–log plot).",
      "POINT SOURCE IN THE FAR FIELD: valid once the distance is several times the size of the " +
        "source. Close to a large luminaire or a softbox the inverse square over-predicts.",
      `1 fc = 1 lm/ft² = ${LUX_PER_FOOTCANDLE} lx exactly (the foot is 0.3048 m).`,
    ],
    figure: {
      title: "Illuminance against distance",
      xlabel: "distance (m)",
      ylabel: "illuminance (lx)",
      xScale: "log",
      yScale: "log",
      series,
    },
  };
}

// --- Flux of a uniform cone ---------------------------------------------------

export interface ConeFluxResult {
  ok: true;
  /** Solid angle of the cone, sr: Ω = 2π(1 − cos(θ/2)). */
  solidAngleSr: number;
  /** Luminous flux into the cone, lm (Φ = I·Ω). */
  lumens: number;
  notes: string[];
  figure: PhotoFigure;
}

/**
 * Luminous flux of a beam of UNIFORM intensity `intensityCd` filling a cone
 * of FULL angle `fullAngleDeg` (0 < θ ≤ 360; 360 is the whole sphere, 4π sr).
 *
 * Ω = 2π(1 − cos(θ/2)), computed as 4π·sin²(θ/4) — the same quantity, but
 * without the cancellation 1 − cos suffers for narrow beams.
 */
export function coneFlux(intensityCd: number, fullAngleDeg: number): ConeFluxResult | PhotometryError {
  if (!Number.isFinite(intensityCd) || intensityCd < 0) {
    return bad("The luminous intensity must be a finite number of candela, zero or more.");
  }
  if (!Number.isFinite(fullAngleDeg)) return bad("The beam angle must be a finite number of degrees.");
  if (fullAngleDeg <= 0 || fullAngleDeg > 360) {
    return bad(
      `A full beam angle of ${fullAngleDeg}° is outside 0° < θ ≤ 360° (360° is the whole sphere, 4π sr).`,
    );
  }
  const omega = (θ: number): number => 4 * Math.PI * Math.pow(Math.sin((θ * DEG) / 4), 2);
  const solidAngleSr = omega(fullAngleDeg);
  const lumens = intensityCd * solidAngleSr;
  const angles = linSpace(1, 360, 72);
  return {
    ok: true,
    solidAngleSr,
    lumens,
    notes: [
      "Φ = I·Ω with Ω = 2π(1 − cos(θ/2)) for a cone of full angle θ.",
      "UNIFORM INTENSITY across the beam is assumed. A real spotlight peaks on axis and falls off " +
        "toward the edge (its 'beam angle' is usually where it reaches 50%), so this is an upper " +
        "bound for a beam rated by its peak candela.",
      "This is why candela cannot simply be converted to lumens: the same candela rating gives " +
        "very different flux depending on how wide the beam is.",
    ],
    figure: {
      title: "Flux of a uniform beam against beam angle",
      xlabel: "full beam angle (°)",
      ylabel: "luminous flux (lm)",
      xScale: "linear",
      yScale: "linear",
      series: [
        { type: "line", label: `I = ${intensityCd} cd`, points: angles.map((a) => ({ x: a, y: intensityCd * omega(a) })) },
        { type: "scatter", label: "entered beam", points: [{ x: fullAngleDeg, y: lumens }] },
      ],
    },
  };
}

// --- Screen luminance -------------------------------------------------------------

export interface ScreenLuminanceResult {
  ok: true;
  /** Illuminance on the screen, lx. */
  lux: number;
  /** Luminance of the screen, cd/m² (L = E·gain/π). */
  nits: number;
  /** The same in foot-lamberts. */
  footlamberts: number;
  /** Ratio to the 48 cd/m² cinema reference. */
  ofCinemaReference: number;
  notes: string[];
  figure: PhotoFigure;
}

/**
 * Luminance of a projection screen: E = Φ/A, then L = E·gain/π.
 *
 * A gain-1 screen is a perfect Lambertian diffuser, for which L = E/π. Gain
 * above 1 is brighter ON AXIS only; this is the on-axis luminance.
 */
export function screenLuminance(
  fluxLm: number,
  areaM2: number,
  gain = 1,
): ScreenLuminanceResult | PhotometryError {
  const e = requirePositive([
    ["luminous flux", fluxLm],
    ["screen area", areaM2],
    ["screen gain", gain],
  ]);
  if (e) return e;
  const lux = fluxLm / areaM2;
  const nits = (lux * gain) / Math.PI;
  const areas = logSpace(areaM2 / 10, areaM2 * 10, 41);
  return {
    ok: true,
    lux,
    nits,
    footlamberts: nitToFootlambert(nits),
    ofCinemaReference: nits / CINEMA_REFERENCE_NIT,
    notes: [
      "L = E·gain/π with E = Φ/A — a Lambertian screen scaled by its gain. Gain is an ON-AXIS " +
        "figure: a high-gain screen is dimmer off axis, which this does not model.",
      `The D-cinema reference white is ${CINEMA_REFERENCE_NIT} cd/m² (≈ ${nitToFootlambert(CINEMA_REFERENCE_NIT).toFixed(2)} ftL; ` +
        "SMPTE ST 431-1), the '14 foot-lamberts' of film projection.",
      `1 ftL = (1/π) cd/ft² = ${NIT_PER_FOOTLAMBERT} cd/m². The foot-lambert is written ftL here — ` +
        "never fL, which is the femtolitre.",
      "The projector's rated lumens are an ANSI measurement through its own lens at full output; " +
        "lamp age, zoom and the port glass all reduce what reaches the screen.",
    ],
    figure: {
      title: "Screen luminance against screen area",
      xlabel: "screen area (m²)",
      ylabel: "luminance (cd/m²)",
      xScale: "log",
      yScale: "log",
      series: [
        { type: "line", label: `${fluxLm} lm, gain ${gain}`, points: areas.map((a) => ({ x: a, y: (fluxLm * gain) / (a * Math.PI) })) },
        {
          type: "line",
          label: `cinema reference ${CINEMA_REFERENCE_NIT} cd/m²`,
          points: [
            { x: areas[0], y: CINEMA_REFERENCE_NIT },
            { x: areas[areas.length - 1], y: CINEMA_REFERENCE_NIT },
          ],
        },
        { type: "scatter", label: "entered screen", points: [{ x: areaM2, y: nits }] },
      ],
    },
  };
}

// --- Exposure value ---------------------------------------------------------------

/**
 * The smallest f-number possible in air: N = 1/(2·NA) and the numerical
 * aperture of a lens in air cannot exceed 1. A typed f/0.3 is a typo, not a
 * lens, and is refused rather than turned into an EV.
 */
export const MIN_F_NUMBER = 0.5;

function checkAperture(n: number): PhotometryError | null {
  if (!Number.isFinite(n)) return bad("The f-number must be a finite number.");
  if (n < MIN_F_NUMBER) {
    return bad(
      `f/${n} is impossible in air: the f-number is 1/(2·NA) and a lens in air cannot have a ` +
        `numerical aperture above 1, so f/${MIN_F_NUMBER} is the physical limit.`,
    );
  }
  return null;
}

export interface ExposureResult {
  ok: true;
  /** EV of the camera settings alone: log₂(N²/t). */
  evSettings: number;
  /**
   * The scene light level the settings are correct for, expressed as EV at
   * ISO 100: EV₁₀₀ = log₂(N²/t) − log₂(S/100). At ISO 100 the two are equal.
   */
  ev100: number;
  /** Incident illuminance those settings expose correctly for: E = C·2^EVsettings/S, lx. */
  incidentLux: number;
  /** Subject luminance those settings expose correctly for: L = K·2^EVsettings/S, cd/m². */
  reflectedNit: number;
  notes: string[];
  figure: PhotoFigure;
}

/** The engraved third-stop markings, f/1 to f/64: position k is 2^(k/6). */
const THIRD_STOP_MARKINGS = [
  "1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8", "3.2", "3.5", "4", "4.5", "5", "5.6", "6.3", "7.1",
  "8", "9", "10", "11", "13", "14", "16", "18", "20", "22", "25", "28", "32", "36", "40", "45", "51", "57", "64",
];

/**
 * An f-number as a figure label: a value ON the third-stop scale (2^(k/6) to 1 part in 10⁶ — what f-stop arithmetic
 * produces, e.g. 2√2 = 2.8284…) is written as its engraved marking (f/2.8, f/5.6, f/11, f/22); any other value with
 * at most three significant figures (fix2-eng2: "f/2.8284271247461903" in a figure title and legend).
 */
export function fNumberLabel(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return String(n);
  const k = Math.round(6 * Math.log2(n));
  if (k >= 0 && k < THIRD_STOP_MARKINGS.length && Math.abs(n / Math.pow(2, k / 6) - 1) < 1e-6) return THIRD_STOP_MARKINGS[k];
  return String(Number(n.toPrecision(3)));
}

/**
 * Exposure value from f-number N, shutter time t (seconds) and ISO speed S.
 *
 * EV = log₂(N²/t) is a property of the SETTINGS; the scene brightness they
 * suit depends on S as well. f/8 at 1/125 s is EV 12.97 whatever the ISO, and
 * at ISO 200 it suits a scene one stop DARKER (EV₁₀₀ 11.97, half the lux).
 * C (incident) and K (reflected) are the meter calibration constants; ISO 2720
 * allows a range and manufacturers differ, so they are inputs with the common
 * defaults C = 250, K = 12.5.
 */
export function exposureValue(
  fNumber: number,
  shutterS: number,
  iso = 100,
  incidentC = 250,
  reflectedK = 12.5,
): ExposureResult | PhotometryError {
  const a = checkAperture(fNumber);
  if (a) return a;
  const e = requirePositive([
    ["shutter time", shutterS],
    ["ISO speed", iso],
    ["incident-meter constant C", incidentC],
    ["reflected-meter constant K", reflectedK],
  ]);
  if (e) return e;
  const evSettings = Math.log2((fNumber * fNumber) / shutterS);
  const ev100 = evSettings - Math.log2(iso / 100);
  const pow = Math.pow(2, evSettings);
  const incidentLux = (incidentC * pow) / iso;
  const reflectedNit = (reflectedK * pow) / iso;
  if (!Number.isFinite(evSettings) || !Number.isFinite(incidentLux)) {
    return bad("These settings are outside the range a number can represent — check the shutter time and f-number.");
  }
  // Figure: for this f-number and ISO, the shutter time against scene EV₁₀₀ —
  // the reciprocity line a meter walks along, with the entered point marked.
  const evs = linSpace(Math.floor(ev100) - 8, Math.floor(ev100) + 8, 33);
  const tFor = (ev: number): number => (fNumber * fNumber) / Math.pow(2, ev + Math.log2(iso / 100));
  return {
    ok: true,
    evSettings,
    ev100,
    incidentLux,
    reflectedNit,
    notes: [
      "EV = log₂(N²/t). Each +1 EV is one stop less exposure: half the time or √2 more f-number.",
      `At ISO ${iso} these settings suit a scene of EV₁₀₀ ${ev100.toFixed(2)}` +
        (iso === 100 ? "." : ` (EV₁₀₀ = EV − log₂(S/100); doubling ISO suits a scene one stop darker).`),
      `Meter equations (ISO 2720): incident E = C·(2 to the power EV)/S with C = ${incidentC}, reflected L = K·(2 to the power EV)/S ` +
        `with K = ${reflectedK}. ISO 2720 allows a range for both and meters differ, so these are inputs.`,
      "Negative EV is legitimate (night scenes, long exposures): f/2 for 4 s is EV 0.",
    ],
    figure: {
      title: `Shutter time against scene EV at f/${fNumberLabel(fNumber)}, ISO ${iso}`,
      xlabel: "scene EV at ISO 100",
      ylabel: "shutter time (s)",
      xScale: "linear",
      yScale: "log",
      series: [
        { type: "line", label: `f/${fNumberLabel(fNumber)}, ISO ${iso}`, points: evs.map((ev) => ({ x: ev, y: tFor(ev) })) },
        { type: "scatter", label: "entered settings", points: [{ x: ev100, y: shutterS }] },
      ],
    },
  };
}

/** Shutter time (s) that gives settings-EV `ev` at f-number N: t = N²/2^EV. */
export function shutterForEv(ev: number, fNumber: number): number | PhotometryError {
  const a = checkAperture(fNumber);
  if (a) return a;
  if (!Number.isFinite(ev)) return bad("The EV must be a finite number.");
  const t = (fNumber * fNumber) / Math.pow(2, ev);
  if (!Number.isFinite(t) || t <= 0) return bad(`EV ${ev} is outside the range a shutter time can represent.`);
  return t;
}

/** f-number that gives settings-EV `ev` at shutter time t: N = √(t·2^EV). */
export function apertureForEv(ev: number, shutterS: number): number | PhotometryError {
  const e = requirePositive([["shutter time", shutterS]]);
  if (e) return e;
  if (!Number.isFinite(ev)) return bad("The EV must be a finite number.");
  const n = Math.sqrt(shutterS * Math.pow(2, ev));
  if (!Number.isFinite(n)) return bad(`EV ${ev} is outside the range an f-number can represent.`);
  if (n < MIN_F_NUMBER) {
    return bad(
      `EV ${ev} at ${shutterS} s would need f/${n.toPrecision(3)}, below f/${MIN_F_NUMBER} — the ` +
        "physical limit for a lens in air. Use a longer shutter time or a higher ISO.",
    );
  }
  return n;
}

/** Settings-EV that correctly exposes an incident illuminance E (lx) at ISO S: log₂(E·S/C). */
export function evFromIlluminance(lux: number, iso = 100, incidentC = 250): number | PhotometryError {
  const e = requirePositive([
    ["illuminance", lux],
    ["ISO speed", iso],
    ["incident-meter constant C", incidentC],
  ]);
  if (e) return e;
  return Math.log2((lux * iso) / incidentC);
}

/** Settings-EV that correctly exposes a subject luminance L (cd/m²) at ISO S: log₂(L·S/K). */
export function evFromLuminance(nit: number, iso = 100, reflectedK = 12.5): number | PhotometryError {
  const e = requirePositive([
    ["luminance", nit],
    ["ISO speed", iso],
    ["reflected-meter constant K", reflectedK],
  ]);
  if (e) return e;
  return Math.log2((nit * iso) / reflectedK);
}

/** Stops between two ISO speeds: log₂(S₂/S₁) (positive = more sensitive). */
export function isoStops(iso1: number, iso2: number): number | PhotometryError {
  const e = requirePositive([
    ["first ISO speed", iso1],
    ["second ISO speed", iso2],
  ]);
  if (e) return e;
  return Math.log2(iso2 / iso1);
}

// --- f-stop arithmetic ----------------------------------------------------------------

export type StopScale = "full" | "half" | "third";

const STOPS_PER_DOUBLING: Record<StopScale, number> = { full: 2, half: 4, third: 6 };

/** Markings are rounded to two figures; the largest such rounding (f/13 on the half scale) is 3.3%. */
const MARKING_TOLERANCE = 0.035;

export interface FNumberExact {
  ok: true;
  /** The number as typed (the marking). */
  marked: number;
  /** The exact value 2^(k/n) the marking stands for, or the typed value if it is not on the scale. */
  exact: number;
  /** True when the marking was recognised on the scale. */
  onScale: boolean;
  /** Position on the scale: stops from f/1 (fractional for half/third stops). */
  stopsFromF1: number;
  note: string;
}

/**
 * The exact f-number a lens marking stands for.
 *
 * f-numbers are powers of √2 (each full stop halves the aperture area):
 * f/5.6 is really 4√2 = 5.657 and f/11 is 8√2 = 11.31. The marking is rounded
 * to two figures, and stop arithmetic on the rounded numbers drifts — f/4 to
 * f/11 is 2.92 stops by the markings and exactly 3 in truth.
 *
 * The SCALE must be stated because half- and third-stop markings overlap
 * (f/13 is a third stop at 12.70 and a half stop at 13.45). The default is the
 * third-stop scale, which contains every full stop. A typed number not within
 * 3.5% of a scale position is used as typed and said so.
 */
export function fNumberExact(marked: number, scale: StopScale = "third"): FNumberExact | PhotometryError {
  const a = checkAperture(marked);
  if (a) return a;
  const n = STOPS_PER_DOUBLING[scale];
  if (!n) return bad(`Unknown stop scale "${scale}" — use full, half or third.`);
  // The one conventional marking that is NOT the two-figure rounding of its
  // position: the third stop 2^(1/3) = 1.26 is engraved "1.2" by convention.
  // A tolerance wide enough to catch it would also snap half-stop markings
  // (f/1.7, f/3.3) onto the wrong third-stop position, so it is named instead.
  const special = scale === "third" && marked === 1.2 ? 2 : null;
  const k = special ?? Math.round(n * Math.log2(marked));
  const exact = Math.pow(2, k / n);
  const onScale = special !== null || Math.abs(marked - exact) / exact <= MARKING_TOLERANCE;
  if (!onScale) {
    return {
      ok: true,
      marked,
      exact: marked,
      onScale: false,
      stopsFromF1: 2 * Math.log2(marked),
      note: `f/${marked} is not a standard marking on the ${scale}-stop scale (nearest is f/${exact.toPrecision(4)}), so it is used as typed.`,
    };
  }
  return {
    ok: true,
    marked,
    exact,
    onScale: true,
    stopsFromF1: (2 * k) / n,
    note: `f/${marked} on the ${scale}-stop scale is exactly 2 to the power ${k}/${n} = ${exact.toPrecision(7)}.`,
  };
}

export interface StopsBetweenResult {
  ok: true;
  /** 2·log₂(N₂/N₁) on the numbers as typed. */
  nominalStops: number;
  /** The same on the exact values the markings stand for. */
  exactStops: number;
  from: FNumberExact;
  to: FNumberExact;
  /** Light ratio: how many times LESS light N₂ admits than N₁ (exact values). */
  lightRatio: number;
  notes: string[];
}

/** Stops between two f-number markings, both nominal and exact. Positive = stopping down. */
export function stopsBetween(n1: number, n2: number, scale: StopScale = "third"): StopsBetweenResult | PhotometryError {
  const a = fNumberExact(n1, scale);
  if (!a.ok) return a;
  const b = fNumberExact(n2, scale);
  if (!b.ok) return b;
  const exactStops = 2 * Math.log2(b.exact / a.exact);
  return {
    ok: true,
    nominalStops: 2 * Math.log2(n2 / n1),
    exactStops,
    from: a,
    to: b,
    lightRatio: Math.pow(2, exactStops),
    notes: [
      "Stops = 2·log₂(N₂/N₁): the light admitted goes as 1/N², and one stop is a factor of 2.",
      a.note,
      b.note,
    ],
  };
}

// --- Depth of field -----------------------------------------------------------------

export interface DofResult {
  ok: true;
  /** Hyperfocal distance H = f²/(N·c) + f, m. */
  hyperfocalM: number;
  /** Near limit of acceptable sharpness, m. */
  nearM: number;
  /** Far limit, m — Infinity when the subject is at or beyond the hyperfocal distance. */
  farM: number;
  /** far − near, m (Infinity when far is). */
  totalM: number;
  notes: string[];
  figure: PhotoFigure;
}

/**
 * Depth of field by the thin-lens formulas, all lengths in metres:
 *   H    = f²/(N·c) + f
 *   near = s(H − f)/(H + s − 2f)
 *   far  = s(H − f)/(H − s)            (∞ for s ≥ H)
 *
 * `cocM` is the circle of confusion — a CONVENTION (0.03 mm is the usual one
 * for 36×24 mm), not a standard; a different print size or viewing distance
 * changes it, and with it every number here.
 */
export function depthOfField(focalM: number, fNumber: number, cocM: number, subjectM: number): DofResult | PhotometryError {
  const a = checkAperture(fNumber);
  if (a) return a;
  const e = requirePositive([
    ["focal length", focalM],
    ["circle of confusion", cocM],
    ["subject distance", subjectM],
  ]);
  if (e) return e;
  if (subjectM <= focalM) {
    return bad(
      `A subject at ${subjectM} m is not beyond the focal length (${focalM} m): a lens cannot focus ` +
        "on it — no real image forms.",
    );
  }
  const f = focalM;
  const H = (f * f) / (fNumber * cocM) + f;
  const near = (s: number): number => (s * (H - f)) / (H + s - 2 * f);
  const far = (s: number): number => (s >= H ? Infinity : (s * (H - f)) / (H - s));
  const nearM = near(subjectM);
  const farM = far(subjectM);

  // Figure: near and far limits against subject distance, from just past the
  // focal length to twice the hyperfocal distance. The far limit runs off to
  // infinity at H, so it is plotted only up to 98% of H.
  const sMin = Math.max(f * 2, Math.min(subjectM, H) / 20);
  const sMax = Math.max(H * 2, subjectM * 1.5);
  const ss = logSpace(sMin, sMax, 61);
  const nearPts = ss.map((s) => ({ x: s, y: near(s) }));
  const farPts = ss.filter((s) => s < 0.98 * H).map((s) => ({ x: s, y: far(s) }));
  const notes = [
    `Hyperfocal distance ${H.toPrecision(5)} m: focused there, everything from H/2 to infinity is acceptably sharp.`,
    "Thin-lens formulas. They assume the subject is well beyond the focal length; at macro " +
      "distances (magnification near 1) use the magnification form instead.",
    `The circle of confusion (${(cocM * 1000).toPrecision(3)} mm) is a convention, not a standard — ` +
      "0.03 mm is the usual one for 36×24 mm at a normal print size and viewing distance.",
  ];
  if (farM === Infinity) {
    notes.push("The subject is at or beyond the hyperfocal distance, so the far limit is infinity.");
  }
  return {
    ok: true,
    hyperfocalM: H,
    nearM,
    farM,
    totalM: farM === Infinity ? Infinity : farM - nearM,
    notes,
    figure: {
      title: `Depth of field, ${(f * 1000).toPrecision(3)} mm at f/${fNumberLabel(fNumber)}`,
      xlabel: "subject distance (m)",
      ylabel: "limit of sharpness (m)",
      xScale: "log",
      yScale: "log",
      series: [
        { type: "line", label: "near limit", points: nearPts },
        { type: "line", label: "far limit", points: farPts },
        { type: "line", label: "subject distance", points: [{ x: ss[0], y: ss[0] }, { x: ss[ss.length - 1], y: ss[ss.length - 1] }] },
        { type: "line", label: "hyperfocal", points: [{ x: H, y: nearPts[0].y }, { x: H, y: sMax * 2 }] },
        {
          type: "scatter",
          label: "entered subject",
          points: farM === Infinity ? [{ x: subjectM, y: nearM }] : [{ x: subjectM, y: nearM }, { x: subjectM, y: farM }],
        },
      ],
    },
  };
}

// --- Angle of view -----------------------------------------------------------------

export interface AngleOfViewResult {
  ok: true;
  /** Horizontal angle, degrees. */
  horizontalDeg: number;
  /** Vertical angle, degrees (null if no height was given). */
  verticalDeg: number | null;
  /** Diagonal angle, degrees (null if no height was given). */
  diagonalDeg: number | null;
  notes: string[];
}

/**
 * Angle of view of a rectilinear lens focused at infinity: 2·atan(d/(2f)) for
 * each sensor dimension d. Lengths in metres. Focusing closer narrows it
 * (the lens extends); a fisheye does not follow this formula at all.
 */
export function angleOfView(sensorWidthM: number, focalM: number, sensorHeightM?: number): AngleOfViewResult | PhotometryError {
  const e = requirePositive([
    ["sensor width", sensorWidthM],
    ["focal length", focalM],
  ]);
  if (e) return e;
  if (sensorHeightM !== undefined) {
    const h = requirePositive([["sensor height", sensorHeightM]]);
    if (h) return h;
  }
  const aov = (d: number): number => (2 * Math.atan(d / (2 * focalM))) / DEG;
  const diag = sensorHeightM !== undefined ? Math.hypot(sensorWidthM, sensorHeightM) : null;
  return {
    ok: true,
    horizontalDeg: aov(sensorWidthM),
    verticalDeg: sensorHeightM !== undefined ? aov(sensorHeightM) : null,
    diagonalDeg: diag !== null ? aov(diag) : null,
    notes: [
      "Angle of view = 2·atan(d / 2f) for a rectilinear lens focused at infinity. Focusing closer " +
        "narrows it slightly; fisheye lenses follow a different projection.",
    ],
  };
}
