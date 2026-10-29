// Pane glue for the Engineering group "Lighting & rendering": the calculations behind realistic light and shadow in
// film, CG and architecture. Kept OUT of taskpane.ts; the pane spreads LIGHTING_CALCS into ENG_CALCS and lists the
// group in ENG_GROUP_ORDER after "Light & camera".
//
// No number is computed here: lightingPhysics.ts owns them. This file reads the fields (dimensional ones through
// units.ts parseMeasured), opens every result with a plain-language reading built from THIS run's numbers, words the
// rest under the display contract (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result), states what each model
// assumes, and draws.
//
// Neighbours, not duplicated: Light & camera's light-photometry (E = I·cos θ/d², the uniform cone's flux, a Lambertian
// screen) and light-exposure (EV, f-stops); Optics' Snell tool (critical angle, total internal reflection) and the
// thin-film Fresnel s/p tool. The vfx group owns standalone Lambert N·L, Blinn–Phong and the Schlick term; here Schlick
// appears only inside the Cook–Torrance BRDF.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import { engEq } from "./engEquations";
import { eotfSrgbInverse } from "./video";
import {
  ACES_CLIP,
  BLUE_LOW,
  GOLDEN_HIGH,
  GOLDEN_LOW,
  HABLE,
  rayleighTau,
  MIN_ROUGHNESS,
  TONE_NAMES,
  atmosphere,
  brdf,
  distanceForStops,
  dynamicRangeStops,
  falloff,
  hemiVariance,
  inverseTone,
  isErr,
  samplesForNoise,
  shadowOf,
  softShadow,
  sunAt,
  sunEvents,
  sunPath,
  toneMap,
  type Crossing,
  type LocalDay,
  type SmithForm,
  type ToneCurve,
} from "./lightingPhysics";
import {
  beamTransmittanceSvg,
  brdfAlbedoSvg,
  brdfLobeSvg,
  clock,
  falloffChartSvg,
  hgPolarSvg,
  noiseChartSvg,
  shadowPlanSvg,
  softShadowRaySvg,
  softShadowWidthSvg,
  sunPathChartSvg,
  toneChartSvg,
} from "./lightingCharts";

/** The new Engineering group these calculators belong to. */
type LightCalc = EngCalcDef<"Lighting & rendering">;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (6 ft, 30 cm, 2 km, 10 min, 0.5 rad) " +
  "and it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Significant figures with trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const s4 = (v: number, n = 4): string => (Math.abs(v) < 1e-300 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, ""));
const s6 = (v: number): string => s4(v, 6);
const pct = (x: number, n = 3): string => `${s4(x * 100, n)} %`;

/**
 * Unit-aware field reading (the laserCalcs.ts pattern): errors collected, conversions reported. A spaced reciprocal
 * ("2 /km") is read as 1/km.
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
    raw = raw.replace(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+\/\s*(?=[A-Za-zµ])/, "$1 1/");
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12) {
      conversions.push(`${label}: ${s6(m.value)} ${formatUnit(m.unit)} = ${s6(m.inTarget)} ${shown}`);
    }
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
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

const tableLine = (label: string, rows: string[][]): EngReportLine => ({ table: rows.map((row) => row.map((c) => trueMinus(c))), label });

function finish(lines: EngReportLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l.replace(/—/g, ";")) : l));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

// =====================================================================================================================
// 1. Sun position and shadows
// =====================================================================================================================

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const POINT_WORDS: Record<string, string> = {
  N: "north", NNE: "north-north-east", NE: "north-east", ENE: "east-north-east", E: "east", ESE: "east-south-east", SE: "south-east", SSE: "south-south-east",
  S: "south", SSW: "south-south-west", SW: "south-west", WSW: "west-south-west", W: "west", WNW: "west-north-west", NW: "north-west", NNW: "north-north-west",
};
const compass = (az: number): string => POINTS16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
const compassWords = (az: number): string => POINT_WORDS[compass(az)];

/** "2026-06-21" → {year, month, day}; other shapes refused by name (a slashed date has two readings). */
function readDate(raw: string): { year: number; month: number; day: number } | string {
  const t = raw.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return `Date: "${t}" is not a date in the form YYYY-MM-DD (2026-06-21). A slashed date such as 06/07/2026 is refused: it reads as June or July.`;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** "15:00", "6:30:15" (24-hour) → minutes after midnight. */
function readClock(raw: string): number | string {
  const t = raw.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(t);
  if (!m) return `Local time: "${t}" is not a 24-hour clock time (15:00 or 06:30:15).`;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || s >= 60) return `Local time: "${t}" is not a time of day (00:00 to 23:59:59).`;
  return h * 60 + mi + s / 60;
}

/** "+1", "−5", "5.5", "+05:30", "UTC+1" → hours east of UTC. */
function readOffset(raw: string): number | string {
  const t = raw.trim().replace(/[−–]/g, "-").replace(/^(UTC|GMT)\s*/i, "");
  if (!t) return "UTC offset: this field is required (0 for UTC, +1 for BST or CET, −5 for EST).";
  const hm = /^([+-]?)(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) return (hm[1] === "-" ? -1 : 1) * (Number(hm[2]) + Number(hm[3]) / 60);
  const n = plain(t);
  if (!Number.isFinite(n)) return `UTC offset: "${raw.trim()}" is not an offset in hours (+1, −5, 5.5 or +05:30).`;
  return n;
}

const longDate = (d: LocalDay): string => `${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
const offsetText = (o: number): string => {
  const sign = o < 0 ? "−" : "+";
  const a = Math.abs(o);
  const h = Math.floor(a + 1e-9);
  const m = Math.round((a - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
};
/** A crossing as a clock time, flagged when it falls on the day before or after. */
const when = (m: number): string => `${clock(m)}${m < 0 ? " (the day before)" : m >= 1440 ? " (the next day)" : ""}`;
const hm = (minutes: number): string => {
  const t = Math.round(minutes);
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")} min`;
};

/** A twilight window [start, end] in words, with the reason when one end is never reached. */
function windowText(a: Crossing, b: Crossing, lowDeg: number, highDeg: number, eMin: number, eMax: number): string {
  const lo = `${s4(lowDeg)}°`;
  const hi = `${s4(highDeg)}°`;
  if (a !== null && b !== null) return `${when(Math.min(a, b))} to ${when(Math.max(a, b))}`;
  if (eMax < lowDeg) return `none (the sun never rises to ${lo})`;
  if (eMin > highDeg) return `none (the sun never sinks below ${hi})`;
  if (a === null && b !== null) return eMin > lowDeg ? `ends ${when(b)}; the sun never sinks below ${lo}, so it has no start` : `${when(b)}`;
  if (a !== null && b === null) return eMax < highDeg ? `from ${when(a)}; the sun never climbs above ${hi}, so it lasts through midday` : `${when(a)}`;
  return "none";
}

const sunCalc: LightCalc = {
  id: "rend-sun-shadow",
  name: "Sun position, golden hour & shadows",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "Where the sun is for a place, date and local time: elevation and azimuth (Meeus low-accuracy solar coordinates, the " +
    "NOAA Solar Calculator's basis; within 0.007° of NREL SPA), sunrise, solar noon and sunset, golden hour (sun 6° to " +
    "−4°) and blue hour (−4° to −6°), and the length and direction of the shadow an object of height h casts on level " +
    "ground. Drawn: the day's sun path and a plan of the shadow across the day.",
  fields: [
    { key: "lat", label: "Latitude (°, north positive)", default: "51.5074", kind: "text" },
    { key: "lon", label: "Longitude (°, east positive)", default: "-0.1278", kind: "text" },
    { key: "date", label: "Date (YYYY-MM-DD)", default: "2026-06-21", kind: "text" },
    { key: "time", label: "Local clock time (24-hour, HH:MM)", default: "15:00", kind: "text" },
    { key: "tz", label: "UTC offset of that clock (hours; +1 for BST)", default: "+1", kind: "text" },
    { key: "h", label: "Object height h", default: "1.8 m", kind: "text" },
    { key: "p", label: "Air pressure (for refraction)", default: "1013.25 hPa", kind: "text" },
    { key: "temp", label: "Air temperature (°C, for refraction)", default: "12", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const lat = u.req("lat", "°", "°", "Latitude");
    const lon = u.req("lon", "°", "°", "Longitude");
    const h = u.req("h", "m", "m", "Object height");
    const pHpa = u.req("p", "hPa", "hPa", "Air pressure");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const temp = plain(r("temp"));
    if (!Number.isFinite(temp)) return refuse(`Air temperature: "${(r("temp") ?? "").trim()}" is not a number of degrees Celsius.`);
    const date = readDate(r("date") ?? "");
    if (typeof date === "string") return refuse(date);
    const minutes = readClock(r("time") ?? "");
    if (typeof minutes === "string") return refuse(minutes);
    const offset = readOffset(r("tz") ?? "");
    if (typeof offset === "string") return refuse(offset);
    const day: LocalDay = { ...date, utcOffset: offset };
    const pos = sunAt(lat, lon, day, minutes, pHpa, temp);
    if (isErr(pos)) return refuse(pos.error);
    const ev = sunEvents(lat, lon, day);
    if (isErr(ev)) return refuse(ev.error);
    const path = sunPath(lat, lon, day, 5);
    if (isErr(path)) return refuse(path.error);
    const sh = shadowOf(h, pos.apparentElevation, pos.azimuth);
    if (isErr(sh)) return refuse(sh.error);
    const noonPos = sunAt(lat, lon, day, Math.min(1439.99, Math.max(0, ev.transit)), pHpa, temp);
    const noon = isErr(noonPos) ? { elevation: ev.maxElevation, azimuth: 180 } : { elevation: noonPos.apparentElevation, azimuth: noonPos.azimuth };
    const noonShadow = noon.elevation > 0 ? h / Math.tan((noon.elevation * Math.PI) / 180) : null;

    const at = `${longDate(day)} at ${clock(minutes)} (${offsetText(offset)})`;
    const lines: EngReportLine[] = [];
    // The reading, from this run's numbers.
    const riseSet =
      ev.daylight === "polar day" ? "It is polar day: the sun does not set." :
      ev.daylight === "polar night" ? "It is polar night: the sun does not rise." :
      `Sunrise ${when(ev.sunrise as number)}, sunset ${when(ev.sunset as number)}${ev.goldenEvening[0] !== null ? `, evening golden hour from ${when(ev.goldenEvening[0])}` : ""}.`;
    if (sh) {
      lines.push(`On ${at} the sun is ${s4(pos.apparentElevation, 3)}° above the horizon in the ${compassWords(pos.azimuth)} (azimuth ${s4(pos.azimuth, 4)}°); a ${s4(h, 3)} m object casts a ${s4(sh.length, 3)} m shadow pointing ${compassWords(sh.bearing)}. ${riseSet}`);
    } else {
      lines.push(`On ${at} the sun is ${s4(Math.abs(pos.apparentElevation), 3)}° below the horizon (azimuth ${s4(pos.azimuth, 4)}°), so there is no direct sunlight and no shadow. ${riseSet}`);
    }
    lines.push(...engEq("rend-sun-shadow"));
    lines.push(`Solar declination δ = ${s4(pos.declination, 5)}°, hour angle H = ${s4(pos.hourAngle, 5)}°, equation of time ${s4(pos.eotMinutes, 3)} min; φ is the latitude and A_S the azimuth from south (compass azimuth = A_S + 180°).`);
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Elevation, apparent (refracted)", `${s6(pos.apparentElevation)}°`],
      ["Elevation, geometric", `${s6(pos.elevation)}°`],
      ["Azimuth (clockwise from north)", `${s6(pos.azimuth)}° (${compass(pos.azimuth)})`],
      ["Solar noon", `${when(ev.transit)}, sun at ${s4(noon.elevation, 4)}°`],
      ["Sunrise", ev.sunrise !== null ? when(ev.sunrise) : ev.daylight === "polar day" ? "none: polar day" : "none: polar night"],
      ["Sunset", ev.sunset !== null ? when(ev.sunset) : ev.daylight === "polar day" ? "none: polar day" : "none: polar night"],
      ["Day length", ev.daylight === "polar day" ? "24 h (polar day)" : ev.daylight === "polar night" ? "0 h (polar night)" : hm(ev.dayLength)],
      ["Morning blue hour (−6° to −4°)", windowText(ev.blueMorning[0], ev.blueMorning[1], BLUE_LOW, GOLDEN_LOW, ev.minElevation, ev.maxElevation)],
      ["Morning golden hour (−4° to 6°)", windowText(ev.goldenMorning[0], ev.goldenMorning[1], GOLDEN_LOW, GOLDEN_HIGH, ev.minElevation, ev.maxElevation)],
      ["Evening golden hour (6° to −4°)", windowText(ev.goldenEvening[0], ev.goldenEvening[1], GOLDEN_LOW, GOLDEN_HIGH, ev.minElevation, ev.maxElevation)],
      ["Evening blue hour (−4° to −6°)", windowText(ev.blueEvening[0], ev.blueEvening[1], BLUE_LOW, GOLDEN_LOW, ev.minElevation, ev.maxElevation)],
    ];
    if (sh) {
      rows.push([`Shadow of the ${s4(h, 4)} m object`, `${s6(sh.length)} m (${s4(sh.ratio, 4)} × its height), bearing ${s4(sh.bearing, 4)}° (${compass(sh.bearing)})`]);
      // The sun's 0.533° disc blurs the shadow's tip: ds = h·Δα/sin²α along the ground.
      const blur = (h * 0.533 * Math.PI) / 180 / Math.pow(Math.sin((pos.apparentElevation * Math.PI) / 180), 2);
      rows.push(["Soft edge at the tip (sun's 0.533° disc)", `${s4(blur, 3)} m along the ground`]);
    } else rows.push(["Shadow", "none: the sun is below the horizon"]);
    if (noonShadow !== null) rows.push(["Shortest shadow (solar noon)", `${s6(noonShadow)} m`]);
    lines.push(tableLine("Sun and shadow", rows));
    lines.push(
      "Golden hour is taken as the sun between 6° above and 4° below the horizon, blue hour between 4° and 6° below (civil twilight ends at −6°): the photographers' convention. Sources differ by a degree or two, so treat the edges as soft. These windows and sunrise/sunset use the geometric elevation of the sun's centre; sunrise and sunset are where it is 0.8333° below the horizon (the sun's radius plus standard refraction, as NREL SPA defines them).",
    );
    lines.push(
      "Assumes: Meeus (1998) low-accuracy solar coordinates with ΔT from Espenak & Meeus (2006), hour angle from apparent sidereal time, topocentric parallax, and SPA's refraction formula at the pressure and temperature given. Checked against NREL SPA (pvlib 0.16.1) on 336 cases at 8 sites from 1990 to 2075: elevation within 0.007°, azimuth within 0.007° of arc, sunrise and sunset within 5 s of SPA's own elevation crossing. Near the horizon real refraction varies by tenths of a degree with the weather, so rise and set times are good to about a minute. Times are clock times at the typed UTC offset: daylight saving is not applied for you. Shadows assume a vertical object on level, open ground.",
    );
    // Shadow tips over the day, every 10 minutes while the sun is up.
    const tips: Array<{ length: number; bearing: number; minute: number }> = [];
    for (let m = 0; m < 1440; m += 10) {
      const p = sunAt(lat, lon, day, m, pHpa, temp);
      if (isErr(p) || p.apparentElevation <= 0) continue;
      tips.push({ length: h / Math.tan((p.apparentElevation * Math.PI) / 180), bearing: (p.azimuth + 180) % 360, minute: m });
    }
    const outputs: EngOutput[] = [
      { key: "elevation", label: "Sun elevation (apparent)", value: pos.apparentElevation, unit: "°" },
      { key: "azimuth", label: "Sun azimuth", value: pos.azimuth, unit: "°" },
      { key: "noon", label: "Solar noon (local clock hours)", value: ev.transit / 60, unit: "h" },
      { key: "dayLength", label: "Day length", value: ev.dayLength / 60, unit: "h" },
    ];
    if (ev.sunrise !== null) outputs.push({ key: "sunrise", label: "Sunrise (local clock hours)", value: ev.sunrise / 60, unit: "h" });
    if (ev.sunset !== null) outputs.push({ key: "sunset", label: "Sunset (local clock hours)", value: ev.sunset / 60, unit: "h" });
    if (sh) outputs.push({ key: "shadow", label: "Shadow length", value: sh.length, unit: "m" }, { key: "bearing", label: "Shadow bearing", value: sh.bearing, unit: "°" });
    return finish(lines, u.conversions, [
      plot(sunPathChartSvg(path, { minute: minutes, elevation: pos.apparentElevation, azimuth: pos.azimuth }, noon), `Sun path on ${longDate(day)} at latitude ${s4(lat, 6)}°, longitude ${s4(lon, 6)}°`, "Sun elevation against azimuth across the day, with the horizon, solar noon and the chosen time marked"),
      plot(shadowPlanSvg(h, "m", sh ? { length: sh.length, bearing: sh.bearing } : null, tips, 5), `Plan of the shadow (north up): the shadow at ${clock(minutes)} and its tip across the day`, "Plan view of a vertical object at the origin, its shadow now as a line and the path of the shadow tip during the day"),
    ], outputs);
  },
};

// =====================================================================================================================
// 2. Soft shadows: umbra and penumbra
// =====================================================================================================================

const softCalc: LightCalc = {
  id: "rend-soft-shadow",
  name: "Soft shadows: umbra & penumbra",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "An area light of size D at distance L in front of an occluder of size w, and a receiving surface a distance d behind " +
    "it. By similar triangles: each penumbra D·d/L, the umbra w − (D − w)·d/L (and where it vanishes, the antumbra), " +
    "contact hardening (the penumbra is zero where the object touches the surface), and the hard shadow a point light " +
    "would cast. Drawn: the ray diagram and the widths against receiver distance.",
  fields: [
    { key: "D", label: "Light size D (width, or disc diameter)", default: "1 m", kind: "text" },
    { key: "w", label: "Occluder size w (width, or disc diameter)", default: "0.3 m", kind: "text" },
    { key: "L", label: "Light to occluder distance L", default: "2 m", kind: "text" },
    { key: "d", label: "Occluder to receiving surface distance d", default: "1 m", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const D = u.req("D", "m", "m", "Light size D");
    const w = u.req("w", "m", "m", "Occluder size w");
    const L = u.req("L", "m", "m", "Light to occluder distance L");
    const d = u.req("d", "m", "m", "Occluder to receiver distance d");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const s = softShadow(D, w, L, d);
    if (isErr(s)) return refuse(s.error);
    const lines: EngReportLine[] = [];
    const lead = `A ${s4(D)} m light ${s4(L)} m from a ${s4(w)} m object, with the surface ${s4(d)} m behind it:`;
    if (d === 0) lines.push(`${lead} the object touches the surface, so its shadow is perfectly hard there (no penumbra) and exactly ${s4(w)} m wide; the edge softens by ${s4(D / L)} m for every metre the surface moves away (contact hardening).`);
    else if (s.hasUmbra) lines.push(`${lead} a ${s4(s.umbra)} m core of full shadow (umbra) with a ${s4(s.penumbra)} m soft edge (penumbra) on each side, ${s4(s.outer)} m in all. A point light would cast a hard ${s4(s.pointShadow)} m shadow instead.`);
    else lines.push(`${lead} no point on the surface is fully shadowed. The two ${s4(s.penumbra)} m penumbrae overlap, leaving a ${s4(-s.umbra)} m antumbra where a ring of the light shows round the object; the umbra ended ${s4(s.umbraEnds as number)} m behind it. A point light would cast a hard ${s4(s.pointShadow)} m shadow.`);
    lines.push(...engEq("rend-soft-shadow"));
    const rows: string[][] = [
      ["Quantity", "Value (m)"],
      ["Penumbra, each side", s6(s.penumbra)],
      [s.hasUmbra ? "Umbra" : "Antumbra (no umbra)", s6(Math.abs(s.umbra))],
      ["Shadow, outer edge to outer edge", s6(s.outer)],
      ["Umbra ends at d₀", s.umbraEnds === null ? "never (occluder at least as large as the light)" : s6(s.umbraEnds)],
      ["Point light's hard shadow", s6(s.pointShadow)],
      ["Penumbra growth per metre of d", s6(D / L)],
    ];
    lines.push(tableLine("Umbra and penumbra", rows));
    lines.push("Contact hardening: the penumbra is D·d/L, so it is zero where the object meets the surface and widens in proportion to the gap. A renderer's shadow softness therefore depends on the light's SIZE and on the occluder–receiver gap, not on the light's brightness.");
    lines.push("Assumes: a section through a uniformly bright light, the occluder and a receiving surface, all parallel and centred on one axis (exact for strip lights and strip occluders, and for coaxial discs with D and w as diameters). Only the extent of each region is computed: across the penumbra the light ramps from none to full, linearly for a strip light and in an S-curve for a disc. Light bouncing off other surfaces (which lifts every shadow) is not included.");
    const outputs: EngOutput[] = [
      { key: "penumbra", label: "Penumbra width (each side)", value: s.penumbra, unit: "m" },
      { key: "umbra", label: s.hasUmbra ? "Umbra width" : "Umbra width (negative: antumbra)", value: s.umbra, unit: "m" },
      { key: "outer", label: "Total shadow width", value: s.outer, unit: "m" },
      { key: "pointShadow", label: "Point-light shadow width", value: s.pointShadow, unit: "m" },
    ];
    if (s.umbraEnds !== null) outputs.push({ key: "umbraEnds", label: "Umbra ends at", value: s.umbraEnds, unit: "m" });
    return finish(lines, u.conversions, [
      plot(softShadowRaySvg(D, w, L, d, s), "Ray diagram: the limiting rays from the light's edges past the occluder's edges", "Side view with the light, the occluder and the receiving surface, four limiting rays, and the umbra (or antumbra) and penumbrae marked on the surface"),
      plot(softShadowWidthSvg(D, w, L, d), "Umbra, penumbra and the point-light shadow against the occluder–receiver distance", "Widths against receiver distance: the penumbra grows from zero at contact, the umbra shrinks to zero, the point-light shadow grows slowly"),
    ], outputs);
  },
};

// =====================================================================================================================
// 3. Light falloff, lighting ratios and renderer light units
// =====================================================================================================================

const falloffCalc: LightCalc = {
  id: "rend-falloff",
  name: "Light falloff, lighting ratios & light units",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "Inverse-square falloff in stops between subject and background, where to move a light for a change in stops, and the " +
    "key:fill ratio in stops. The near-field error of treating an area light as a point (the exact on-axis illuminance " +
    "of a Lambertian disc, πL·sin²θ, against I/z², with the five-diameter rule checked). Physically based renderer " +
    "units: point light lm → cd, spot cone lm → cd, area light lm → nits, and W → lm at an efficacy. (E = I·cos θ/d² " +
    "itself is Light & camera ▸ Illuminance, luminance & beams.)",
  fields: [
    { key: "d1", label: "Light to subject distance", default: "2 m", kind: "text" },
    { key: "d2", label: "Light to background distance", default: "4 m", kind: "text" },
    { key: "stops", label: "Change wanted at the subject (stops; + brighter)", default: "1", kind: "text" },
    { key: "ratio", label: "Key:fill ratio (the R in R:1)", default: "4", kind: "text" },
    { key: "dia", label: "Area light diameter (a disc)", default: "1 m", kind: "text" },
    { key: "flux", label: "The light's luminous flux", default: "10000 lm", kind: "text" },
    { key: "cone", label: "Spot full cone angle (°)", default: "60", kind: "text" },
    { key: "watts", label: "Electrical power (W; blank to skip)", default: "100 W", kind: "text" },
    { key: "eff", label: "Luminous efficacy (lm/W; LED about 100)", default: "100", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const d1 = u.req("d1", "m", "m", "Light to subject distance");
    const d2 = u.req("d2", "m", "m", "Light to background distance");
    const dia = u.req("dia", "m", "m", "Area light diameter");
    const flux = u.req("flux", "lm", "lm", "Luminous flux");
    const cone = u.req("cone", "°", "°", "Spot cone angle");
    const watts = u.opt("watts", "W", "W", "Electrical power");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const stops = plain(r("stops"));
    if (!Number.isFinite(stops)) return refuse(`Change in stops: "${(r("stops") ?? "").trim()}" is not a number.`);
    const ratio = plain(r("ratio"));
    if (!Number.isFinite(ratio) || ratio < 1) return refuse(`Key:fill ratio: "${(r("ratio") ?? "").trim()}" must be a number of at least 1 (the key is the brighter side: 4 means 4:1).`);
    const effRaw = (r("eff") ?? "").trim();
    const eff = watts === null ? null : plain(effRaw);
    if (watts !== null && (eff === null || !Number.isFinite(eff))) return refuse(`Luminous efficacy: "${effRaw}" is not a number of lumens per watt (needed with an electrical power).`);
    const f = falloff({ d1, d2, diameter: dia, flux, coneDeg: cone, watts, efficacy: eff });
    if (isErr(f)) return refuse(f.error);
    const move = distanceForStops(d1, stops);
    if (isErr(move)) return refuse(move.error);
    const ratioStops = Math.log2(ratio);
    const lines: EngReportLine[] = [];
    const bgWord = f.stops >= 0 ? `${s4(f.stops, 3)} stops less light (${s4(f.ratioBackground, 3)} ×)` : `${s4(-f.stops, 3)} stops more light (${s4(f.ratioBackground, 3)} ×)`;
    lines.push(
      `The background at ${s4(d2)} m gets ${bgWord} than the subject at ${s4(d1)} m. To make the subject ${s4(Math.abs(stops), 3)} stop${Math.abs(stops) === 1 ? "" : "s"} ${stops >= 0 ? "brighter" : "darker"}, move the light to ${s4(move)} m. A ${s4(ratio)}:1 key:fill ratio is ${s4(ratioStops, 3)} stops. Treating the ${s4(dia)} m light as a point at ${s4(d1)} m overstates it by ${pct(f.pointError)}; that error is 1 % at ${s4(f.onePercentDistance)} m (five diameters).`,
    );
    lines.push(...engEq("rend-falloff"));
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Subject to background falloff", `${s6(f.stops)} stops (${s6(f.ratioBackground)} × the light)`],
      [`Light distance for ${s4(stops)} stop${Math.abs(stops) === 1 ? "" : "s"}`, `${s6(move)} m`],
      [`Key:fill ${s4(ratio)}:1`, `${s6(ratioStops)} stops; (key + fill):fill = ${s4(ratio + 1)}:1`],
      ["Disc luminance L = Φ/(πA)", `${s6(f.discLuminance)} cd/m²`],
      [`Illuminance at ${s4(d1)} m, exact disc`, `${s6(f.discExact)} lx`],
      [`Illuminance at ${s4(d1)} m, as a point`, `${s6(f.discPoint)} lx`],
      ["Point-approximation error (R/z)²", pct(f.pointError, 4)],
      ["Error at five diameters", pct(f.errorAtFive, 4)],
      ["Point light: I = Φ/4π", `${s6(f.pointCd)} cd`],
      [`Spot, ${s4(cone)}° cone: I = Φ/Ω`, `${s6(f.spotCd)} cd (Ω = ${s6(f.spotOmega)} sr)`],
      ["Area light (one-sided disc): L = Φ/(πA)", `${s6(f.areaNits)} nit (cd/m²)`],
    ];
    if (f.lumensFromWatts !== null && watts !== null && eff !== null) rows.push([`${s4(watts)} W at ${s4(eff)} lm/W`, `${s6(f.lumensFromWatts)} lm`]);
    lines.push(tableLine("Falloff, ratios and light units", rows));
    lines.push(
      "Conventions: a stop is a factor of 2 in light. The lighting ratio here is key:fill, the illuminance on the key side over the fill side; the older (key + fill):fill form counts the fill on both sides and is one more. The spot conversion spreads the flux uniformly over the cone's solid angle Ω = 2π(1 − cos(β/2)), the inverse of Light & camera's uniform-cone flux; renderers differ (some keep a spot's intensity at Φ/4π however narrow the cone), so check your renderer's documentation. 683 lm/W is the ceiling, reached only by monochromatic 555 nm light; white LEDs reach roughly 80 to 200 lm/W.",
    );
    lines.push("Assumes: inverse-square falloff from the light's position with nothing in between and no light bounced off walls (which raises the fill and flattens falloff indoors); the area light is a uniform one-sided Lambertian disc, and the near-field figures are on its axis.");
    const outputs: EngOutput[] = [
      { key: "stops", label: "Subject to background falloff", value: f.stops, unit: "stops" },
      { key: "dNew", label: "Light distance for the change", value: move, unit: "m" },
      { key: "ratioStops", label: "Key:fill in stops", value: ratioStops, unit: "stops" },
      { key: "pointError", label: "Point-approximation error", value: f.pointError * 100, unit: "%" },
      { key: "Ipoint", label: "Point light intensity", value: f.pointCd, unit: "cd" },
      { key: "Ispot", label: "Spot intensity", value: f.spotCd, unit: "cd" },
      { key: "Larea", label: "Area light luminance", value: f.areaNits, unit: "cd/m²" },
    ];
    if (f.lumensFromWatts !== null) outputs.push({ key: "lumens", label: "Lumens from watts", value: f.lumensFromWatts, unit: "lm" });
    return finish(lines, u.conversions, [
      plot(falloffChartSvg(f.discLuminance, dia / 2, d1, d2), "Illuminance on the light's axis: the exact disc against the point approximation", "Illuminance against distance on logarithmic axes; the point-source line rises above the exact disc curve close to the light, and the five-diameter distance is marked"),
    ], outputs);
  },
};

// =====================================================================================================================
// 4. Microfacet BRDF
// =====================================================================================================================

const brdfCalc: LightCalc = {
  id: "rend-brdf",
  name: "Microfacet BRDF (GGX, Smith, Schlick)",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "The physically based shading model: Cook–Torrance with the GGX (Trowbridge–Reitz) distribution, Smith masking-" +
    "shadowing (height-correlated or separable) and Schlick's Fresnel, with roughness remapped α = r² (the Disney/Unreal " +
    "convention) and F0 from the index of refraction or mixed toward the base colour by metallic. The BRDF for given " +
    "light and view directions, and the directional albedo by numerical integration (a white-furnace test showing the " +
    "energy single scattering loses at high roughness). Drawn: the lobe and the albedo against roughness.",
  fields: [
    { key: "r", label: "Perceptual roughness r (0 to 1)", default: "0.5", kind: "text" },
    { key: "metal", label: "Metallic (0 dielectric to 1 metal)", default: "0", kind: "text" },
    { key: "ior", label: "Index of refraction (dielectric)", default: "1.5", kind: "text" },
    { key: "base", label: "Base colour, one channel (linear 0 to 1)", default: "0.8", kind: "text" },
    { key: "tv", label: "View angle θv from the normal (°)", default: "45", kind: "text" },
    { key: "tl", label: "Light angle θl from the normal (°)", default: "45", kind: "text" },
    { key: "phi", label: "Light azimuth from the view (°; 180 = mirror)", default: "180", kind: "text" },
    {
      key: "g",
      label: "Smith masking-shadowing",
      default: "correlated",
      kind: "select",
      options: [
        { value: "correlated", label: "Height-correlated (Heitz 2014; Filament, Unreal)" },
        { value: "separable", label: "Separable G₁(l)·G₁(v)" },
      ],
    },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const tv = u.req("tv", "°", "°", "View angle θv");
    const tl = u.req("tl", "°", "°", "Light angle θl");
    const phi = u.req("phi", "°", "°", "Light azimuth φ");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const nums: Array<[string, string]> = [["r", "Roughness"], ["metal", "Metallic"], ["ior", "Index of refraction"], ["base", "Base colour"]];
    const v: Record<string, number> = {};
    for (const [k, label] of nums) {
      const x = plain(r(k));
      if (!Number.isFinite(x)) return refuse(`${label}: "${(r(k) ?? "").trim()}" is not a number.`);
      v[k] = x;
    }
    const form: SmithForm = r("g") === "separable" ? "separable" : "correlated";
    const b = brdf({ roughness: v.r, metallic: v.metal, ior: v.ior, base: v.base, thetaV: tv, thetaL: tl, phi, form });
    if (isErr(b)) return refuse(b.error);
    const lines: EngReportLine[] = [];
    const kind = v.metal === 0 ? `this dielectric (F0 = ${s4(b.F0, 3)})` : v.metal === 1 ? `this metal (F0 = ${s4(b.F0, 3)}, the base colour)` : `this ${s4(v.metal * 100, 3)} % metallic mix (F0 = ${s4(b.F0, 3)})`;
    const loss = 1 - b.albedoWhite;
    lines.push(
      `At roughness ${s4(b.roughnessUsed, 3)} (α = ${s4(b.alpha, 3)}), view ${s4(tv, 3)}° and light ${s4(tl, 3)}° from the normal, ${kind} has a specular BRDF of ${s4(b.specular, 4)} sr⁻¹${b.diffuse > 0 ? ` plus ${s4(b.diffuse, 3)} sr⁻¹ diffuse` : ""}. A white furnace at this view angle returns ${pct(b.albedoWhite, 4)} of the light, so single-scattering GGX ${loss > 0.005 ? `loses ${pct(loss, 3)} to the bounces between microfacets it does not model` : "is close to energy-conserving here"}.`,
    );
    if (b.floored) lines.push(`Roughness ${s4(v.r, 3)} is below ${MIN_ROUGHNESS} and was raised to it (α = ${s4(b.alpha, 4)}), the clamp Filament applies: at r = 0 the GGX lobe is a delta function, a mirror, with no finite BRDF value to report.`);
    lines.push(...engEq("rend-brdf"));
    if (form === "separable") lines.push(...engEq("rend-brdf:separable"));
    lines.push(`Directions: n·l = ${s4(b.NoL, 5)}, n·v = ${s4(b.NoV, 5)}, n·h = ${s4(b.NoH, 5)} (half vector ${s4(b.thetaH, 4)}° off the normal), v·h = ${s4(b.VoH, 5)}; θd is the angle between v and h. The visibility form G/(4 cos θl cos θv) is evaluated directly, so grazing angles never divide 0 by 0.`);
    const rows: string[][] = [
      ["Term", "Value"],
      ["α = r²", s6(b.alpha)],
      ["D (GGX), sr⁻¹", s6(b.D)],
      [`G (Smith, ${form === "correlated" ? "height-correlated" : "separable"})`, s6(b.G)],
      ["F (Schlick)", s6(b.F)],
      ["F0", `${s6(b.F0)}${v.metal > 0 ? ` = (1 − m)·${s4(b.F0dielectric, 4)} + m·${s4(v.base, 4)}` : ` = ((n − 1)/(n + 1))²`}`],
      ["Specular BRDF D·G·F/(4 cos θl cos θv), sr⁻¹", s6(b.specular)],
      ["Diffuse (1 − m)·base/π, sr⁻¹", s6(b.diffuse)],
      ["(specular + diffuse)·cos θl", s6(b.cosineWeighted)],
      ["Directional albedo, F = 1 (white furnace)", s6(b.albedoWhite)],
      [`Directional albedo with F0 = ${s4(b.F0, 3)}`, s6(b.albedoF)],
    ];
    if (b.fresnelExactAtVoH !== null) rows.push(["Exact unpolarised Fresnel at the same v·h", `${s6(b.fresnelExactAtVoH)} (Schlick ${b.F >= b.fresnelExactAtVoH ? "+" : "−"}${pct(Math.abs(b.F / b.fresnelExactAtVoH - 1), 3)})`]);
    lines.push(tableLine("Cook–Torrance terms", rows));
    lines.push(
      "Assumes: single scattering off a GGX microfacet surface (multiple bounces between microfacets are not modelled, which is the albedo shortfall), an isotropic surface, Schlick's approximation to Fresnel, one colour channel at a time (run the R, G and B base colours separately for a metal), and a Lambert diffuse lobe (1 − metallic)·base/π with no Fresnel weighting between the two. The albedo is integrated over the half-vector on a 256 × 128 grid (within 5×10⁻⁵ of an independent 400 × 720 Gauss–Legendre integral over the light direction).",
    );
    const outputs: EngOutput[] = [
      { key: "D", label: "D (GGX)", value: b.D, unit: "sr⁻¹" },
      { key: "G", label: "G (Smith)", value: b.G, unit: "" },
      { key: "F", label: "F (Schlick)", value: b.F, unit: "" },
      { key: "F0", label: "F0", value: b.F0, unit: "" },
      { key: "spec", label: "Specular BRDF", value: b.specular, unit: "sr⁻¹" },
      { key: "albedoWhite", label: "White-furnace albedo", value: b.albedoWhite, unit: "" },
      { key: "albedoF", label: "Directional albedo with F0", value: b.albedoF, unit: "" },
    ];
    return finish(lines, u.conversions, [
      plot(brdfLobeSvg(tv, b.F0, form, b.roughnessUsed), `Specular lobe f·cos θl in the plane of incidence, view at ${s4(tv, 3)}° (each roughness normalised to its own peak)`, "Polar plot over the surface of the specular reflection lobe for several roughness values, narrow and tall for smooth surfaces and broad for rough ones, with the view direction drawn"),
      plot(brdfAlbedoSvg(tv, b.F0, form, b.roughnessUsed, b.albedoWhite, b.albedoF), `Directional albedo against roughness at θv = ${s4(tv, 3)}°: the white-furnace shortfall grows with roughness`, "Directional albedo against perceptual roughness for F equal to one and for the material's F0, falling below one as roughness rises"),
    ], outputs);
  },
};

// =====================================================================================================================
// 5. Render noise and sampling
// =====================================================================================================================

/** Seconds as "2 h 30 min", "4 min 10 s" or "12.5 s". */
function duration(sec: number): string {
  if (sec < 60) return `${s4(sec, 3)} s`;
  if (sec < 3600) {
    const t = Math.round(sec);
    return t % 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t / 60} min`;
  }
  if (sec < 86400 * 3) {
    const t = Math.round(sec / 60);
    return t % 60 ? `${Math.floor(t / 60)} h ${t % 60} min` : `${t / 60} h`;
  }
  return `${s4(sec / 86400, 3)} days`;
}

const noiseCalc: LightCalc = {
  id: "rend-noise",
  name: "Render noise & samples per pixel",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "Monte Carlo noise falls as 1/√N: the samples per pixel for a target noise (halving the noise takes four times the " +
    "samples) and the render time that follows. Then why sampling strategy matters: the per-sample variance of uniform " +
    "against cosine-weighted hemisphere sampling for a diffuse surface lit by a light filling a cone about its normal, " +
    "in closed form. Drawn: noise against samples on log axes, with seeded Monte Carlo runs beside the theory.",
  fields: [
    { key: "n0", label: "Current samples per pixel", default: "64", kind: "text" },
    { key: "s0", label: "Current noise (relative, %)", default: "8", kind: "text" },
    { key: "st", label: "Target noise (relative, %)", default: "2", kind: "text" },
    { key: "t0", label: "Current render time per frame", default: "10 min", kind: "text" },
    { key: "tf", label: "Fixed overhead per frame (load, build)", default: "30 s", kind: "text" },
    { key: "beta", label: "Light cone half-angle β about the normal (°; 90 = whole sky)", default: "30", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const t0 = u.req("t0", "s", "s", "Current render time");
    const tf = u.req("tf", "s", "s", "Fixed overhead");
    const beta = u.req("beta", "°", "°", "Light cone half-angle β");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const n0 = plain(r("n0"));
    const s0 = plain((r("s0") ?? "").replace(/%\s*$/, ""));
    const st = plain((r("st") ?? "").replace(/%\s*$/, ""));
    if (!Number.isFinite(n0)) return refuse(`Current samples per pixel: "${(r("n0") ?? "").trim()}" is not a number.`);
    if (!Number.isFinite(s0)) return refuse(`Current noise: "${(r("s0") ?? "").trim()}" is not a percentage.`);
    if (!Number.isFinite(st)) return refuse(`Target noise: "${(r("st") ?? "").trim()}" is not a percentage.`);
    const n = samplesForNoise(n0, s0, st, t0, tf);
    if (isErr(n)) return refuse(n.error);
    const hv = hemiVariance(beta);
    if (isErr(hv)) return refuse(hv.error);
    const lines: EngReportLine[] = [];
    const change = s0 / st;
    const strat = hv.ratio === null
      ? `With the light filling the whole hemisphere, cosine-weighted sampling has no noise at all for a diffuse surface (each sample returns the exact answer), while uniform sampling has a relative noise of ${s4(Math.sqrt(hv.varUniform) / hv.integral, 3)} per sample.`
      : `For a light filling a ${s4(beta, 3)}° cone about the normal, cosine-weighted sampling needs ${s4(hv.ratio, 3)} × fewer samples than uniform hemisphere sampling for the same noise.`;
    lines.push(
      `${change >= 1 ? "Cutting" : "Relaxing"} the noise from ${s4(s0, 3)} % to ${s4(st, 3)} % (${s4(change >= 1 ? change : 1 / change, 3)} × ${change >= 1 ? "less" : "more"}) takes ${s4(n.factor, 4)} × the samples: ${s4(Math.ceil(n.samples - 1e-9), 6)} per pixel instead of ${s4(n0, 6)}, and about ${duration(n.time)} per frame instead of ${duration(t0)}. ${strat}`,
    );
    lines.push(...engEq("rend-noise"));
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Samples-per-pixel factor (σ0/σt)²", s6(n.factor)],
      ["Samples per pixel needed", s6(n.samples)],
      ["Render time per frame", `${duration(n.time)} (${s6(n.time)} s, ${s4(n.timeFactor, 4)} × now)`],
      ["Irradiance from the cone, π sin²β (radiance 1)", s6(hv.integral)],
      ["Per-sample variance, uniform hemisphere", s6(hv.varUniform)],
      ["Per-sample variance, cosine-weighted", s6(hv.varCosine)],
      ["Relative noise per sample, uniform", s6(Math.sqrt(hv.varUniform) / hv.integral)],
      ["Relative noise per sample, cosine-weighted", s6(Math.sqrt(hv.varCosine) / hv.integral)],
      ["Samples saved by cosine weighting", hv.ratio === null ? "all of them (zero variance)" : `${s6(hv.ratio)} ×`],
    ];
    lines.push(tableLine("Noise, samples and time", rows));
    lines.push(
      "Assumes: noise is the standard deviation of independent samples, so it falls exactly as 1/√N (no denoiser, and no adaptive or low-discrepancy sampling, which converge faster); render time is the fixed overhead plus a part proportional to samples. The strategy comparison is one diffuse pixel lit by a uniform light of radiance 1 filling a cone of half-angle β centred on the normal, black elsewhere; sampling the light directly would do better still. The figure's Monte Carlo points are seeded runs (mulberry32), drawn only to show the theory holds; the numbers above are closed forms.",
    );
    const outputs: EngOutput[] = [
      { key: "samples", label: "Samples per pixel needed", value: n.samples, unit: "" },
      { key: "factor", label: "Sample factor", value: n.factor, unit: "" },
      { key: "time", label: "Render time per frame", value: n.time, unit: "s" },
      { key: "varUniform", label: "Variance, uniform", value: hv.varUniform, unit: "" },
      { key: "varCosine", label: "Variance, cosine-weighted", value: hv.varCosine, unit: "" },
    ];
    if (hv.ratio !== null) outputs.push({ key: "ratio", label: "Uniform/cosine variance ratio", value: hv.ratio, unit: "" });
    return finish(lines, u.conversions, [
      plot(noiseChartSvg(beta, n0, s0 / 100, n.samples, st / 100), "Relative noise against samples per pixel: theory (lines) and seeded Monte Carlo (points)", "Noise against samples per pixel on logarithmic axes, straight lines of slope minus one half for uniform and cosine-weighted sampling with simulated points on them, and this render's current and target points"),
    ], outputs);
  },
};

// =====================================================================================================================
// 6. Tone mapping and dynamic range
// =====================================================================================================================

const CURVES: ToneCurve[] = ["reinhard", "reinhardExt", "hable", "aces"];

const toneCalc: LightCalc = {
  id: "rend-tonemap",
  name: "Tone mapping & dynamic range",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "Scene-linear values and an exposure in stops to display values under Reinhard (simple, and extended with a white " +
    "point), Hable's Uncharted 2 filmic curve and Narkowicz's ACES fit (an approximation of the ACES RRT + ODT, not ACES " +
    "itself), with the sRGB code value each lands on; where middle grey (0.18) falls; and a scene's dynamic range in " +
    "stops from its darkest and brightest luminance. Drawn: the curves on a logarithmic scene axis.",
  fields: [
    { key: "x", label: "Scene-linear values (list; 0.18 is middle grey)", default: "0.18 1 4 16", kind: "text" },
    { key: "ev", label: "Exposure (stops; + brighter)", default: "0", kind: "text" },
    { key: "lw", label: "White point Lw for Reinhard extended", default: "4", kind: "text" },
    { key: "lmin", label: "Darkest scene luminance", default: "0.01 cd/m^2", kind: "text" },
    { key: "lmax", label: "Brightest scene luminance", default: "10000 cd/m^2", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const lmin = u.req("lmin", "cd/m^2", "cd/m²", "Darkest scene luminance");
    const lmax = u.req("lmax", "cd/m^2", "cd/m²", "Brightest scene luminance");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const rawX = (r("x") ?? "").trim();
    const toks = rawX.split(/[\s,;]+/).filter(Boolean);
    if (!toks.length) return refuse("Scene-linear values: give at least one (0.18 is middle grey).");
    if (toks.length > 12) return refuse(`Scene-linear values: ${toks.length} given; twelve at most.`);
    const xs: number[] = [];
    for (const t of toks) {
      const x = plain(t);
      if (!Number.isFinite(x) || x < 0) return refuse(`Scene-linear values: "${t}" is not a number of zero or more (scene-linear light cannot be negative).`);
      if (x > 1e6) return refuse(`Scene-linear values: ${t} is above 10⁶, beyond any scene.`);
      xs.push(x);
    }
    const ev = plain(r("ev"));
    if (!Number.isFinite(ev) || Math.abs(ev) > 20) return refuse(`Exposure: "${(r("ev") ?? "").trim()}" must be a number of stops within ±20.`);
    const lw = plain(r("lw"));
    if (!Number.isFinite(lw) || lw <= 0) return refuse(`White point Lw: "${(r("lw") ?? "").trim()}" must be a positive scene value (the value that maps to display white).`);
    const dr = dynamicRangeStops(lmin, lmax);
    if (isErr(dr)) return refuse(dr.error);
    const k = Math.pow(2, ev);
    const exposed = xs.map((x) => x * k);
    const code = (y: number): number => Math.round(255 * eotfSrgbInverse(Math.max(0, Math.min(1, y))));
    const grey = 0.18 * k;
    const lines: EngReportLine[] = [];
    const greyAt = CURVES.map((c) => `${TONE_NAMES[c]} ${s4(toneMap(c, grey, lw), 3)}`).join(", ");
    const xTop = Math.max(...exposed);
    const display = Math.log2(1000);
    lines.push(
      `At ${ev >= 0 ? "+" : "−"}${s4(Math.abs(ev), 3)} stops, scene middle grey lands at display ${greyAt}, and the brightest input (${s4(xTop, 4)}) at ${s4(toneMap("aces", xTop, lw), 3)} under the ACES fit. The scene spans ${s4(dr, 3)} stops from ${s4(lmin)} to ${s4(lmax)} cd/m²; an SDR display of 100 cd/m² with a 0.1 cd/m² black shows about ${s4(display, 3)} stops, so ${dr > display ? `${s4(dr - display, 3)} stops must be compressed into the toe and shoulder` : "it fits without compression"}.`,
    );
    lines.push(...engEq("rend-tonemap"));
    const rows: string[][] = [["Scene value", "Exposed", ...CURVES.map((c) => TONE_NAMES[c])]];
    for (let i = 0; i < xs.length; i++) {
      const x = exposed[i];
      rows.push([s4(xs[i], 6), s4(x, 6), ...CURVES.map((c) => `${s4(toneMap(c, x, lw), 4)} (sRGB ${code(toneMap(c, x, lw))})`)]);
    }
    lines.push(tableLine("Display-linear value (8-bit sRGB code) under each curve", rows));
    const place: string[][] = [["Curve", "Middle grey 0.18 shows at", "Exposure to show 0.18 at 0.18", "Display white reached at"]];
    for (const c of CURVES) {
      const xNeeded = inverseTone(c, 0.18, lw);
      const white = c === "reinhard" ? "never (approaches 1)" : c === "reinhardExt" ? `x = ${s4(lw, 4)}` : c === "hable" ? `x = ${s4(HABLE.W / HABLE.bias, 4)}` : `x = ${s4(ACES_CLIP, 5)}`;
      place.push([TONE_NAMES[c], `${s4(toneMap(c, grey, lw), 4)} (sRGB ${code(toneMap(c, grey, lw))})`, xNeeded === null ? "not reachable" : `${xNeeded / 0.18 >= 1 ? "+" : "−"}${s4(Math.abs(Math.log2(xNeeded / 0.18)), 3)} stops`, white]);
    }
    lines.push(tableLine("Middle grey and white", place));
    lines.push(
      `Constants: Reinhard (2002) eq. 3 and 4 (the extended form passes 1 above Lw and is clipped to display white there). Hable (2010) A = ${HABLE.A}, B = ${HABLE.B}, C = ${HABLE.C}, D = ${HABLE.D}, E = ${HABLE.E}, F = ${HABLE.F}, linear white W = ${HABLE.W}, with the exposure bias of 2 from his published sample code applied, so display white is reached at scene 5.6 and brighter values clip. ACES: Narkowicz's fit a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14, clamped to 1, applied to the exposed value with no further input scale; it approximates the ACES reference rendering plus an sRGB output transform, without ACES's colour handling. The sRGB code is IEC 61966-2-1's encoding of the display-linear value.`,
    );
    lines.push("Assumes: the curves act on one channel (or luminance) of scene-linear light; real pipelines apply them per channel or to luminance, which shifts saturated colours differently. Dynamic range is log₂ of the luminance ratio; the 10-stop display figure is the stated 100 to 0.1 cd/m² example, not a measurement of yours.");
    const outputs: EngOutput[] = [
      { key: "dr", label: "Scene dynamic range", value: dr, unit: "stops" },
      ...CURVES.map((c): EngOutput => ({ key: `grey_${c}`, label: `Middle grey under ${TONE_NAMES[c]}`, value: toneMap(c, grey, lw), unit: "" })),
    ];
    return finish(lines, u.conversions, [
      plot(toneChartSvg(lw, exposed), "Tone curves: display value against scene-linear value (logarithmic), your values marked", "Four tone-mapping curves rising from zero toward display white on a logarithmic scene axis, with the input values marked on each and middle grey drawn"),
    ], outputs);
  },
};

// =====================================================================================================================
// 7. Atmosphere, fog and participating media
// =====================================================================================================================

const atmosCalc: LightCalc = {
  id: "rend-atmosphere",
  name: "Atmosphere, fog & scattering",
  group: "Lighting & rendering",
  unitContract: "converts",
  hint:
    "Light through a medium: Beer–Lambert transmittance exp(−σd), Koschmieder visibility 3.912/σ (2 % contrast), why the " +
    "sky is blue and sunsets red (Rayleigh scattering ∝ λ⁻⁴), the optical air mass at a sun elevation (Kasten–Young " +
    "1989) and the direct sun's colour shift as relative transmittance by wavelength (Bucholtz 1995 Rayleigh optical " +
    "depth), and the Henyey–Greenstein phase function for an asymmetry g. Drawn: the beam's transmittance by " +
    "wavelength and the phase function.",
  fields: [
    { key: "sigma", label: "Extinction coefficient σ (1/km; blank: from visibility)", default: "", kind: "text" },
    { key: "vis", label: "Visibility (used when σ is blank)", default: "2 km", kind: "text" },
    { key: "d", label: "Path length through the medium d", default: "500 m", kind: "text" },
    { key: "elev", label: "Sun elevation (apparent, °)", default: "5", kind: "text" },
    { key: "p", label: "Surface pressure (altitude)", default: "1013.25 hPa", kind: "text" },
    { key: "lams", label: "Wavelengths (nm, list)", default: "450 550 650", kind: "text" },
    { key: "g", label: "Phase asymmetry g (−1 to 1; fog about 0.8)", default: "0.76", kind: "text" },
    { key: "theta", label: "Scattering angle θ (°; 0 = straight on)", default: "30", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const sigmaKm = u.opt("sigma", "1/km", "km⁻¹", "Extinction coefficient σ");
    const visM = sigmaKm === null ? u.req("vis", "m", "m", "Visibility") : null;
    const d = u.req("d", "m", "m", "Path length d");
    const elev = u.req("elev", "°", "°", "Sun elevation");
    const p = u.req("p", "hPa", "hPa", "Surface pressure");
    const theta = u.req("theta", "°", "°", "Scattering angle θ");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const g = plain(r("g"));
    if (!Number.isFinite(g)) return refuse(`Phase asymmetry g: "${(r("g") ?? "").trim()}" is not a number.`);
    const toks = (r("lams") ?? "").trim().split(/[\s,;]+/).filter(Boolean);
    const lams: number[] = [];
    for (const t of toks) {
      const m = parseMeasured(t.replace(/[−–]/g, "-"), "nm");
      if ("error" in m) return refuse(`Wavelengths: "${t}": ${m.error}`);
      lams.push(m.inTarget);
    }
    const a = atmosphere({ sigma: sigmaKm === null ? null : sigmaKm / 1000, visibility: visM, distance: d, elevationDeg: elev, pressureHpa: p, g, thetaDeg: theta, lambdas: lams });
    if (isErr(a)) return refuse(a.error);
    const lines: EngReportLine[] = [];
    const sigKm = a.sigma * 1000;
    const shortest = a.beam.reduce((x, y) => (y.lambdaNm < x.lambdaNm ? y : x));
    const longest = a.beam.reduce((x, y) => (y.lambdaNm > x.lambdaNm ? y : x));
    const medium = a.sigma === 0
      ? `With σ = 0 the medium is clear: all of the light crosses the ${s4(d)} m path and visibility has no limit from extinction.`
      : `Over ${s4(d)} m of this medium (σ = ${s4(sigKm, 4)} per km, visibility ${s4((a.visibility as number) / 1000, 4)} km) ${pct(a.transmittance)} of the light gets through.`;
    const colour = a.beam.length > 1
      ? ` With the sun ${s4(elev, 3)}° up (air mass ${s4(a.airMass, 3)}), Rayleigh scattering alone passes ${pct(shortest.T)} of ${s4(shortest.lambdaNm)} nm but ${pct(longest.T)} of ${s4(longest.lambdaNm)} nm, so the direct sun ${longest.T > shortest.T * 1.05 ? "shifts toward red" : "stays nearly white"}; the same scattering sends ${s4(a.rayleighRatio, 3)} × more ${s4(shortest.lambdaNm)} nm than ${s4(longest.lambdaNm)} nm light into the sky, which is why it is blue.`
      : ` With the sun ${s4(elev, 3)}° up (air mass ${s4(a.airMass, 3)}), Rayleigh scattering passes ${pct(shortest.T)} of ${s4(shortest.lambdaNm)} nm in the direct beam.`;
    lines.push(medium + colour);
    lines.push(...engEq("rend-atmosphere"));
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Extinction coefficient σ", `${s6(sigKm)} km⁻¹ (${s6(a.sigma)} m⁻¹)`],
      ["Optical depth σd", s6(a.opticalDepth)],
      ["Transmittance exp(−σd)", s6(a.transmittance)],
      ["Visibility, Koschmieder 3.912/σ (2 %)", a.visibility === null ? "unlimited (σ = 0)" : `${s6(a.visibility)} m`],
      ["Meteorological optical range 2.996/σ (5 %)", a.mor === null ? "unlimited (σ = 0)" : `${s6(a.mor)} m`],
      ["Sun zenith angle", `${s6(a.zenith)}°`],
      ["Relative air mass (Kasten–Young)", s6(a.airMass)],
      ["Pressure scaling p/p₀", s6(p / 1013.25)],
    ];
    lines.push(tableLine("Medium and air mass", rows));
    const beamRows: string[][] = [["Wavelength (nm)", "Rayleigh τ at p", "Direct-beam transmittance", "Relative to 550 nm"]];
    for (const b of a.beam) beamRows.push([s4(b.lambdaNm, 5), s6(b.tau), s6(b.T), s6(b.rel550)]);
    lines.push(tableLine("Direct sun by wavelength (Rayleigh only)", beamRows));
    lines.push(`Henyey–Greenstein with g = ${s4(g, 3)}: p(${s4(theta, 3)}°) = ${s6(a.hg)} sr⁻¹ (isotropic is 1/4π = 0.0795775 sr⁻¹); straight-on scattering is ${s4(a.hgForwardBack, 4)} × straight-back. p integrates to 1 over the sphere and its mean cosine is g.`);
    lines.push(
      `Sources: Koschmieder's 3.912 is −ln 0.02, the 2 % contrast at which a black object vanishes against the horizon sky (the WMO's 5 % gives 2.996). Kasten & Young (1989) takes the apparent zenith angle and gives about 38 at the horizon. Rayleigh optical depth is Bucholtz (1995)'s fit for the US Standard Atmosphere, ${s4(rayleighTau(0.55) as number, 3)} at 550 nm at sea level, scaled by p/1013.25 hPa; it agrees with Hansen & Travis (1974) and Bird & Riordan (1986) within 1.5 % over 400 to 700 nm.`,
    );
    lines.push("Assumes: a homogeneous medium along the path (fog or haze of one σ at all wavelengths) and single scattering for the phase function. The beam's colour shift is Rayleigh scattering by air only: real sunsets are redder still from aerosols and ozone, which are not included. The relative transmittance is not converted to a colour (that is the Colour & appearance group's work).");
    const outputs: EngOutput[] = [
      { key: "T", label: "Transmittance", value: a.transmittance, unit: "" },
      { key: "tau", label: "Optical depth", value: a.opticalDepth, unit: "" },
      { key: "airMass", label: "Relative air mass", value: a.airMass, unit: "" },
      { key: "hg", label: "Phase function at θ", value: a.hg, unit: "sr⁻¹" },
      ...a.beam.map((b): EngOutput => ({ key: `T${Math.round(b.lambdaNm)}`, label: `Direct beam at ${s4(b.lambdaNm, 5)} nm`, value: b.T, unit: "" })),
    ];
    if (a.visibility !== null) outputs.push({ key: "visibility", label: "Koschmieder visibility", value: a.visibility, unit: "m" });
    return finish(lines, u.conversions, [
      plot(beamTransmittanceSvg(a.airMass, p / 1013.25, a.beam.filter((b) => b.lambdaNm >= 380 && b.lambdaNm <= 720).map((b) => ({ lambdaNm: b.lambdaNm, T: b.T }))), `Direct-sun transmittance by wavelength (Rayleigh) at air mass ${s4(a.airMass, 3)} and overhead`, "Transmittance of the direct solar beam against wavelength from 380 to 720 nanometres, lower at the blue end and much lower for a low sun"),
      plot(hgPolarSvg(g, theta), `Henyey–Greenstein phase function, g = ${s4(g, 3)}, beside isotropic scattering on the same scale`, "Polar plot of the phase function with the incident light travelling to the right, a forward lobe for positive g, and a small circle for isotropic scattering"),
    ], outputs);
  },
};

/** The Lighting & rendering calculators, in dropdown order. */
export const LIGHTING_CALCS: LightCalc[] = [sunCalc, softCalc, falloffCalc, brdfCalc, noiseCalc, toneCalc, atmosCalc];
