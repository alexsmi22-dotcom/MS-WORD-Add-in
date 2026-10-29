// Pane glue for the Astronomy & lunar calculators (group "Astronomy & lunar", after "Trajectory & orbits"). Kept OUT of
// taskpane.ts; the integrator spreads ASTRO_CALCS into ENG_CALCS.
//
// No astronomy is computed here: astroTime.ts, astroCoords.ts, astroBodies.ts, astroMoon.ts and astroPhysics.ts own
// it, each with its theory and measured accuracy. This file reads the fields, words the result under the display
// contract (U+2212, ×10ⁿ, sexagesimal 12ʰ 34ᵐ 56.7ˢ / −12° 34′ 56″, no em dash, NaN or Infinity in an ok result),
// opens every result with a plain-language reading built from its numbers, closes it with the method and its
// accuracy, and draws.
//
// TIME ZONES: every clock time is local = UTC + the offset typed in hours. Daylight saving is NOT applied; type the
// offset in force on the date (−4 for New York in July, −5 in November).

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import {
  calendarFromJd,
  dayOfWeek,
  dayOfYear,
  daysInMonth,
  DEG,
  earthRotationAngle,
  gast,
  gmst,
  jdFromCalendar,
  LEAP_TABLE_EXPIRY_TEXT,
  matVec,
  meanObliquity,
  scalesFromUTC,
  utcFromTT,
  WEEKDAYS,
  type CalendarMode,
} from "./astroTime";
import {
  airmassKastenYoung,
  epochToJd,
  EQ_TO_GAL,
  eqToEcl,
  fmtDMS,
  fmtHMS,
  fx,
  parseDeg,
  parseRA,
  precessBetween,
  refractionFromTrue,
  separation,
  sph,
  vec,
  type Site,
} from "./astroCoords";
import {
  apparentPlace,
  AU_KM,
  BODY_LABEL,
  brightLimbAngle,
  EPHEMERIS_YEARS,
  MOON_RADIUS_KM,
  parallacticAngle,
  planetMagnitude,
  PLANETS,
  riseTransitSet,
  starPlace,
  topocentric,
  VERIFIED_YEARS,
  type BodyId,
  type Place,
} from "./astroBodies";
import { apsidesBetween, eclipsesBetween, libration, MICROMOON_KM, moonLit, moonState, phasesBetween, PHASE_NAMES, SUPERMOON_KM } from "./astroMoon";
import {
  AU_M,
  cosmology,
  keplerTransit,
  LY_M,
  MU_EARTH,
  MU_JUPITER,
  MU_SUN,
  PC_M,
  R_EARTH_M,
  R_JUP_M,
  R_SUN,
  star,
  surfaceGravity,
  telescope,
  transitCurve,
  WORLDS,
} from "./astroPhysics";
import {
  altitudeChartSvg,
  cosmologyChartSvg,
  eclipticStripSvg,
  fovSvg,
  gravityBarsSvg,
  hrDiagramSvg,
  keplerChartSvg,
  modulusChartSvg,
  moonCalendarSvg,
  moonDiscSvg,
  skyDomeSvg,
  timeScalesChartSvg,
  transitChartSvg,
  type CalendarCell,
  type DomePoint,
} from "./astroCharts";
import { buildPlotSvg } from "./plot";

/** The Engineering group these calculators belong to (added to ENG_GROUP_ORDER after "Trajectory & orbits"). */
export const ASTRO_GROUP = "Astronomy & lunar" as const;
type AstroCalc = EngCalcDef<typeof ASTRO_GROUP>;

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });
const n = (v: number, s = 6): string => fmtSig(v, s);
/** Six significant figures with trailing zeros dropped: a value as the user typed it. */
const trimSig = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
const pct = (x: number, d = 1): string => `${fx(x * 100, d)} %`;

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 300);
  return { kind: "plot", svg, caption, alt, w, h };
};
const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((row) => row.map((c) => trueMinus(c))) });

/** The report: the reading first, then the body, then the method note. */
function finish(reading: string, lines: EngReportLine[], method: string, extra: AnalyzeBlock[], outputs: EngOutput[], conversions: string[] = []): AnalyzeOutput {
  const all: EngReportLine[] = [reading, ...lines];
  if (conversions.length) all.push("Units read: " + conversions.join("; ") + ".");
  all.push(method);
  const clean = all.map((l): EngReportLine => (typeof l === "string" ? trueMinus(l.replace(/—/g, "-")) : "table" in l ? l : { math: l.math, fallback: trueMinus(l.fallback) }));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

// ---------------------------------------------------------------------------------------------------------------
// Field reading (dates, clock times, offsets, angles: the field's own unit; a unit typed after a number is refused)
// ---------------------------------------------------------------------------------------------------------------

/** A plain number field: NaN when blank or not a number. */
function plainNum(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

interface YMD {
  y: number;
  m: number;
  d: number;
}

/** "2026-11-05", "−44-03-15" (astronomical year numbering: 0 = 1 BC, −1 = 2 BC). */
function readDate(raw: string | undefined, label: string): YMD | string {
  const t = (raw ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: this field is required (YYYY-MM-DD).`;
  const m = /^([-+]?\d{1,5})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return `${label}: "${t}" is not a date; write YYYY-MM-DD (for example 2026-11-05; −44-03-15 for 45 BC in astronomical numbering).`;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "21:30", "21:30:15.5" → hours. */
function readClock(raw: string | undefined, label: string): number | string {
  const t = (raw ?? "").trim();
  if (!t) return `${label}: this field is required (HH:MM or HH:MM:SS).`;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(t);
  if (!m) return `${label}: "${t}" is not a clock time; write HH:MM or HH:MM:SS on the 24-hour clock (21:30).`;
  const h = Number(m[1]), mi = Number(m[2]), s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || s >= 60) return `${label}: "${t}" is not a time of day (hours 0 to 23, minutes and seconds below 60).`;
  return h + mi / 60 + s / 3600;
}

/** A UTC offset in hours: "−5", "+5:30", "0". */
function readOffset(raw: string | undefined): number | string {
  const t = (raw ?? "").trim().replace(/[−–]/g, "-").replace(/^UTC/i, "");
  if (!t) return "UTC offset: this field is required (0 for UTC; −5 for US Eastern standard time).";
  const m = /^([-+]?)(\d{1,2})(?::(\d{2}))?$/.exec(t) ?? /^([-+]?)(\d{1,2}\.\d+)$/.exec(t);
  if (!m) return `UTC offset: "${t}" is not an offset; write hours such as −5, +1, +5:30.`;
  const v = (m[1] === "-" ? -1 : 1) * (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0));
  if (Math.abs(v) > 14) return `UTC offset: ${t} hours is outside the world's time zones (−12 to +14).`;
  return v;
}

/** The observing site: geodetic latitude and east longitude in degrees (decimal or DMS), height in metres. */
function readSite(r: (k: string) => string): Site | string {
  const la = parseDeg(r("lat"));
  if ("error" in la) return `Latitude: ${la.error}`;
  if (Math.abs(la.deg) > 90) return `Latitude: ${trimSig(la.deg)}° is not a latitude (−90° to +90°, north positive).`;
  const lo = parseDeg(r("lon"));
  if ("error" in lo) return `Longitude: ${lo.error}`;
  if (Math.abs(lo.deg) > 180) return `Longitude: ${trimSig(lo.deg)}° is outside −180° to +180° (east positive; west is negative).`;
  const h = plainNum(r("height"));
  if (!Number.isFinite(h)) return `Height: "${(r("height") ?? "").trim()}" is not a number of metres.`;
  if (h < -500 || h > 9000) return `Height: ${trimSig(h)} m is not a height on the Earth's surface (−500 to 9000 m).`;
  return { lat: la.deg * DEG, lon: lo.deg * DEG, height: h };
}

interface When {
  jdUTC: number;
  offset: number;
  /** Local midnight starting the local date, as a UTC JD. */
  jdLocal0: number;
  ymd: YMD;
  clock: number;
  warnings: string[];
}

/** Date + local clock + UTC offset → the instant; refuses dates the ephemeris does not cover. */
function readWhen(r: (k: string) => string, ephemeris: boolean): When | string {
  const ymd = readDate(r("date"), "Date");
  if (typeof ymd === "string") return ymd;
  const clock = readClock(r("time"), "Local time");
  if (typeof clock === "string") return clock;
  const offset = readOffset(r("tz"));
  if (typeof offset === "string") return offset;
  if (ephemeris && (ymd.y < EPHEMERIS_YEARS.min || ymd.y > EPHEMERIS_YEARS.max))
    return `Date: the year ${ymd.y} is outside ${EPHEMERIS_YEARS.min} to ${EPHEMERIS_YEARS.max}, the years these positions are computed for (the truncated theories degrade and ΔT is uncertain by minutes before 1000).`;
  const jd0 = jdFromCalendar(ymd.y, ymd.m, ymd.d, "auto");
  if (typeof jd0 !== "number") return `Date: ${jd0.error}`;
  const warnings: string[] = [];
  if (ymd.y < VERIFIED_YEARS.min || ymd.y > VERIFIED_YEARS.max)
    warnings.push(`The year ${ymd.y} is outside ${VERIFIED_YEARS.min} to ${VERIFIED_YEARS.max}, the range compared against JPL's ephemerides here: positions and times are less certain (ΔT alone may be off by seconds to minutes).`);
  return { jdUTC: jd0 + (clock - offset) / 24, offset, jdLocal0: jd0 - offset / 24, ymd, clock, warnings };
}

const pad2 = (x: number): string => String(x).padStart(2, "0");
const yearText = (y: number): string => (y < 0 ? `−${String(-y).padStart(4, "0")}` : String(y).padStart(4, "0"));

/** The local date and HH:MM of a UTC instant (rounded to the minute, carried across midnight). */
function localStamp(jdUTC: number, offset: number): { date: string; time: string } {
  const jl = Math.round((jdUTC + offset / 24 + 0.5) * 1440) / 1440 - 0.5;
  const c = calendarFromJd(jl);
  const d = Math.floor(c.day);
  const mins = Math.round((c.day - d) * 1440) % 1440;
  return { date: `${yearText(c.year)}-${pad2(c.month)}-${pad2(d)}`, time: `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}` };
}
const stampText = (jdUTC: number, offset: number): string => {
  const s = localStamp(jdUTC, offset);
  return `${s.date} ${s.time}`;
};
/** HH:MM, with the local date added when it differs from `refDate`. */
const clockOn = (jdUTC: number, offset: number, refDate: string): string => {
  const s = localStamp(jdUTC, offset);
  return s.date === refDate ? s.time : `${s.time} (${s.date})`;
};
const offsetText = (o: number): string => {
  if (o === 0) return "UTC";
  const a = Math.abs(o);
  const h = Math.floor(a + 1e-9), m = Math.round((a - h) * 60);
  return `UTC${o < 0 ? "−" : "+"}${h}${m ? `:${pad2(m)}` : ""}`;
};
const dateText = (w: When): string => `${yearText(w.ymd.y)}-${pad2(w.ymd.m)}-${pad2(w.ymd.d)}`;

const COMPASS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
const compass = (azDeg: number): string => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
const latText = (s: Site): string => `${fx(Math.abs(s.lat / DEG), 2)}° ${s.lat >= 0 ? "N" : "S"}, ${fx(Math.abs(s.lon / DEG), 2)}° ${s.lon >= 0 ? "E" : "W"}`;

const TZ_NOTE = "Clock times are local: UTC plus the offset given, with no daylight-saving rule applied (type the offset in force on the date).";

/** Words for a rise/transit/set day. */
function riseSetWords(name: string, rs: ReturnType<typeof riseTransitSet>, offset: number, ref: string, setWord = "sets"): string {
  if (rs.circumpolar === "up") return `${name} stays above the horizon all day (it neither rises nor sets on this date at this latitude).`;
  if (rs.circumpolar === "down") return `${name} stays below the horizon all day (it does not rise on this date at this latitude).`;
  const parts: string[] = [];
  parts.push(rs.rise !== null ? `rises at ${clockOn(rs.rise, offset, ref)}` : "does not rise on this date");
  if (rs.transit !== null) parts.push(`transits at ${clockOn(rs.transit, offset, ref)} (altitude ${fx((rs.transitAlt as number) / DEG, 1)}°)`);
  parts.push(rs.set !== null ? `${setWord} at ${clockOn(rs.set, offset, ref)}` : `does not set on this date`);
  return `${name} ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Time scales and sidereal time
// ---------------------------------------------------------------------------------------------------------------

const timeCalc: AstroCalc = {
  id: "astro-time",
  name: "Time scales: Julian Date, UTC, TAI, TT, ΔT, sidereal time",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A calendar date and UTC time (or a Julian Date) to the Julian Date, MJD, TAI, TT and ΔT, Greenwich mean and apparent " +
    "sidereal time and local sidereal time at a longitude, the day of the week and of the year, and the date in both the " +
    "Julian and Gregorian calendars. Years use astronomical numbering (0 = 1 BC, −1 = 2 BC).",
  fields: [
    { key: "mode", label: "Input", default: "calendar", kind: "select", options: [{ value: "calendar", label: "Calendar date and UTC time" }, { value: "jd", label: "Julian Date (UTC)" }, { value: "mjd", label: "Modified Julian Date (UTC)" }] },
    { key: "date", label: "Date (YYYY-MM-DD)", default: "2026-11-05", kind: "text" },
    { key: "time", label: "UTC time (HH:MM:SS)", default: "06:00:00", kind: "text" },
    { key: "jd", label: "Julian Date or MJD (when the input is a JD)", default: "2461349.75", kind: "text" },
    { key: "cal", label: "Calendar", default: "auto", kind: "select", options: [{ value: "auto", label: "Gregorian from 1582-10-15, Julian before" }, { value: "gregorian", label: "Proleptic Gregorian" }, { value: "julian", label: "Julian" }] },
    { key: "lon", label: "East longitude for local sidereal time (°)", default: "0", kind: "text" },
  ],
  compute: (r) => {
    const mode = r("mode") === "jd" ? "jd" : r("mode") === "mjd" ? "mjd" : "calendar";
    const cal: CalendarMode = r("cal") === "gregorian" ? "gregorian" : r("cal") === "julian" ? "julian" : "auto";
    let jd: number;
    if (mode === "calendar") {
      const ymd = readDate(r("date"), "Date");
      if (typeof ymd === "string") return refuse(ymd);
      const clock = readClock(r("time"), "UTC time");
      if (typeof clock === "string") return refuse(clock);
      if (ymd.y < -4712 || ymd.y > 9999) return refuse(`Date: the year ${ymd.y} is outside −4712 to 9999 (Julian Date 0 is −4712 January 1, noon).`);
      const j = jdFromCalendar(ymd.y, ymd.m, ymd.d + clock / 24, cal);
      if (typeof j !== "number") return refuse(`Date: ${j.error}`);
      jd = j;
    } else {
      const v = plainNum(r("jd"));
      if (!Number.isFinite(v)) return refuse(`Julian Date: "${(r("jd") ?? "").trim()}" is not a number.`);
      jd = mode === "mjd" ? v + 2400000.5 : v;
      if (jd < 0 || jd > 5373484.5) return refuse(`Julian Date: ${trimSig(jd)} is outside 0 (−4712 January 1, noon) to 5373484.5 (the year 10000).`);
    }
    const lonP = parseDeg(r("lon"));
    if ("error" in lonP) return refuse(`Longitude: ${lonP.error}`);
    if (Math.abs(lonP.deg) > 180) return refuse(`Longitude: ${trimSig(lonP.deg)}° is outside −180° to +180° (east positive).`);
    const sc = scalesFromUTC(jd);
    const gm = gmst(sc.jdUT1, sc.jdTT), ga = gast(sc.jdUT1, sc.jdTT);
    const lmst = gm + lonP.deg * DEG, last = ga + lonP.deg * DEG;
    const H = (rad: number): number => rad / (15 * DEG);
    const auto = calendarFromJd(jd, "auto");
    const greg = calendarFromJd(jd, "gregorian");
    const jul = calendarFromJd(jd, "julian");
    const fmtCal = (c: { year: number; month: number; day: number }): string => {
      const d = Math.floor(c.day);
      const secs = Math.round((c.day - d) * 86400 * 10) / 10;
      const hh = Math.floor(secs / 3600), mm = Math.floor((secs - hh * 3600) / 60), ss = secs - hh * 3600 - mm * 60;
      return `${yearText(c.year)}-${pad2(c.month)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}:${ss.toFixed(1).padStart(4, "0")}`;
    };
    const wd = WEEKDAYS[dayOfWeek(jd)];
    const doy = dayOfYear(auto.year, auto.month, auto.day, auto.calendar === "gregorian");
    const lines: EngReportLine[] = [];
    lines.push({ math: "JD = floor(365.25 (Y + 4716)) + floor(30.6001 (M + 1)) + D + B - 1524.5", fallback: "JD = ⌊365.25(Y + 4716)⌋ + ⌊30.6001(M + 1)⌋ + D + B − 1524.5 (Meeus 7.1; B = 2 − A + ⌊A/4⌋, A = ⌊Y/100⌋ in the Gregorian calendar, B = 0 in the Julian)" });
    lines.push({ math: "TT = TAI + 32.184", fallback: "TT = TAI + 32.184 s; TAI = UTC + ΔAT (leap seconds)" });
    lines.push({ math: "theta_ERA = 2 pi (0.7790572732640 + 1.00273781191135448 D_U)", fallback: "ERA = 2π(0.7790572732640 + 1.00273781191135448·Dᵤ), Dᵤ = JD(UT1) − 2451545.0" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Julian Date (UTC)", jd.toFixed(6)], ["Modified Julian Date (UTC)", (jd - 2400000.5).toFixed(6)]);
    rows.push(["Julian Date (TT)", sc.jdTT.toFixed(6)]);
    if (sc.taiUtc !== null) rows.push(["TAI − UTC (leap seconds)", `${sc.taiUtc} s`], ["GPS − UTC", `${sc.taiUtc - 19} s`]);
    rows.push(["TT − UT1 (ΔT)", `${fx(sc.deltaT, 3)} s${sc.source === "leap-seconds" ? " (with UT1 = UTC)" : " (Espenak–Meeus)"}`]);
    rows.push(["Day of the week", wd], [`Day of the year`, String(doy)]);
    rows.push(["Date, calendar in force", `${fmtCal(auto)} (${auto.calendar === "gregorian" ? "Gregorian" : "Julian"})`]);
    rows.push(["Date, proleptic Gregorian", fmtCal(greg)], ["Date, Julian calendar", fmtCal(jul)]);
    rows.push(["Earth rotation angle", fmtDMS(earthRotationAngle(sc.jdUT1) / DEG, 2)]);
    rows.push(["Greenwich mean sidereal time", fmtHMS(H(gm), 3)], ["Greenwich apparent sidereal time", fmtHMS(H(ga), 3)]);
    rows.push([`Local mean sidereal time (${fx(lonP.deg, 4)}° E)`, fmtHMS(H(lmst), 3)], ["Local apparent sidereal time", fmtHMS(H(last), 3)]);
    rows.push(["Equation of the equinoxes", `${fx((ga - gm) / DEG * 240, 4)} s`]);
    lines.push({ table: rows, label: "Time scales" });
    for (const note of sc.notes) lines.push(note);
    if (auto.year === 1582 && auto.month === 10) lines.push("October 1582: Thursday 4 October (Julian) was followed by Friday 15 October (Gregorian); 5 to 14 October 1582 never happened in the reform.");
    if (Math.abs(auto.year - 2000) > 2000) lines.push(`ΔT this far from the present is uncertain by minutes to hours (Espenak–Meeus), so TT and the sidereal times carry that uncertainty.`);
    const reading = `${fmtCal(auto).slice(0, 16)} UTC is Julian Date ${jd.toFixed(5)}, a ${wd} (day ${doy} of ${yearText(auto.year)}); TT runs ${fx(sc.deltaT, 3)} s ahead of ${sc.source === "leap-seconds" ? "UTC" : "UT"}, and Greenwich mean sidereal time is ${fmtHMS(H(gm), 0)}.`;
    const method =
      `Method: Meeus ch. 7 Julian Dates (Gregorian from 1582-10-15, Julian before; astronomical year numbering); leap seconds from the IERS table valid to ${LEAP_TABLE_EXPIRY_TEXT} (TT = UTC + ΔAT + 32.184 s, UT1 taken equal to UTC, within 0.9 s); ΔT outside the table from the Espenak–Meeus polynomials; ERA and GMST by IAU 2006 (agrees with erfa gmst06 to 10⁻⁶″), GAST with the IAU 1980 equation of the equinoxes (within 0.02″ of erfa gst06a).`;
    const fig = timeScalesChartSvg(
      sc.taiUtc !== null
        ? [
            { name: "UTC", offset: 0, note: "civil time" },
            { name: "UT1", offset: 0, note: "Earth rotation (≈ UTC ± 0.9 s)" },
            { name: "GPS", offset: sc.taiUtc - 19, note: `+${sc.taiUtc - 19} s` },
            { name: "TAI", offset: sc.taiUtc, note: `+${sc.taiUtc} s` },
            { name: "TT", offset: sc.deltaT, note: `+${fx(sc.deltaT, 3)} s` },
          ]
        : [
            { name: "UT", offset: 0, note: "Earth rotation" },
            { name: "TT", offset: sc.deltaT, note: `ΔT ${fx(sc.deltaT, 1)} s` },
          ],
    );
    const outputs: EngOutput[] = [
      { key: "jd", label: "Julian Date (UTC)", value: jd, unit: "d" },
      { key: "jdTT", label: "Julian Date (TT)", value: sc.jdTT, unit: "d" },
      { key: "deltaT", label: "ΔT = TT − UT1", value: sc.deltaT, unit: "s" },
      { key: "gmst", label: "GMST", value: H(gm), unit: "h" },
      { key: "last", label: "Local apparent sidereal time", value: H(((last % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)), unit: "h" },
    ];
    return finish(reading, lines, method, [plot(fig, "How far each time scale runs ahead of UTC", "Horizontal bars of the offsets of UT1, GPS time, TAI and TT from UTC in seconds")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Celestial coordinates
// ---------------------------------------------------------------------------------------------------------------

const coordsCalc: AstroCalc = {
  id: "astro-coords",
  name: "Celestial coordinates: RA/Dec to altitude/azimuth, ecliptic, galactic, airmass",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A star's J2000 right ascension and declination (12h 34m 56s or decimal; −12° 34′ 56″ or decimal) with a site and a " +
    "local time: the apparent place of date (precession, nutation, aberration), altitude and azimuth with and without " +
    "refraction, airmass, ecliptic and galactic coordinates, precession to another epoch, rise/transit/set, and the " +
    "separation from a second object.",
  fields: [
    { key: "ra", label: "Right ascension, J2000 (h m s)", default: "5h 55m 10.3s", kind: "text" },
    { key: "dec", label: "Declination, J2000 (° ′ ″)", default: "+7° 24′ 25″", kind: "text" },
    { key: "date", label: "Local date (YYYY-MM-DD)", default: "2026-11-05", kind: "text" },
    { key: "time", label: "Local time (HH:MM)", default: "22:00", kind: "text" },
    { key: "tz", label: "UTC offset (hours; −5 = US Eastern standard)", default: "-5", kind: "text" },
    { key: "lat", label: "Site latitude (°, north +)", default: "38.8895", kind: "text" },
    { key: "lon", label: "Site longitude (°, east +, west −)", default: "-77.0353", kind: "text" },
    { key: "height", label: "Site height (m)", default: "20", kind: "text" },
    { key: "pres", label: "Air pressure for refraction (hPa)", default: "1010", kind: "text" },
    { key: "temp", label: "Air temperature for refraction (°C)", default: "10", kind: "text" },
    { key: "epoch", label: "Precess to epoch (Julian year; blank = none)", default: "2050", kind: "text" },
    { key: "ra2", label: "Second object RA, J2000 (blank = none)", default: "6h 45m 08.9s", kind: "text" },
    { key: "dec2", label: "Second object Dec, J2000", default: "−16° 42′ 58″", kind: "text" },
  ],
  compute: (r) => {
    const ra = parseRA(r("ra"));
    if ("error" in ra) return refuse(`Right ascension: ${ra.error}`);
    const de = parseDeg(r("dec"));
    if ("error" in de) return refuse(`Declination: ${de.error}`);
    if (Math.abs(de.deg) > 90) return refuse(`Declination: ${trimSig(de.deg)}° is beyond ±90°.`);
    const w = readWhen(r, true);
    if (typeof w === "string") return refuse(w);
    const site = readSite(r);
    if (typeof site === "string") return refuse(site);
    const P = plainNum(r("pres")), Tc = plainNum(r("temp"));
    if (!Number.isFinite(P) || P < 0 || P > 1100) return refuse(`Air pressure: "${(r("pres") ?? "").trim()}" must be 0 to 1100 hPa (0 = no refraction).`);
    if (!Number.isFinite(Tc) || Tc < -90 || Tc > 60) return refuse(`Air temperature: "${(r("temp") ?? "").trim()}" must be −90 to 60 °C.`);
    const sc = scalesFromUTC(w.jdUTC);
    const a0 = ra.hours * 15 * DEG, d0 = de.deg * DEG;
    const place = starPlace(a0, d0, sc.jdTT);
    const tp = topocentric(place, site, sc.jdUT1, sc.jdTT);
    const refr = P > 0 ? refractionFromTrue(tp.alt, P, Tc) : 0;
    const altObs = tp.alt + refr;
    const am = airmassKastenYoung(altObs / DEG);
    const ecl = sph(matVec(eqToEcl(meanObliquity(2451545)), vec(a0, d0)));
    const gal = sph(matVec(EQ_TO_GAL, vec(a0, d0)));
    const ref = dateText(w);
    const rs = riseTransitSet((tt) => starPlace(a0, d0, tt), "star", site, w.jdLocal0, sc.deltaT);
    const lines: EngReportLine[] = [...w.warnings];
    lines.push({ math: "sin(h) = sin(phi) sin(delta) + cos(phi) cos(delta) cos(H)", fallback: "sin h = sin φ·sin δ + cos φ·cos δ·cos H (H = local sidereal time − α)" });
    lines.push({ math: "X = 1/(cos(z) + 0.50572 (96.07995 - z)^(-1.6364))", fallback: "X = 1/(cos z + 0.50572·(96.07995° − z)^−1.6364) (Kasten & Young 1989, z in degrees)" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["RA, Dec (J2000, as entered)", `${fmtHMS(ra.hours, 2)}, ${fmtDMS(de.deg, 1, true)}`]);
    rows.push(["Apparent RA, Dec of date", `${fmtHMS(place.ra / DEG / 15, 2)}, ${fmtDMS(place.dec / DEG, 1, true)}`]);
    rows.push(["Ecliptic λ, β (J2000)", `${fx(ecl.lon / DEG, 5)}°, ${fx(ecl.lat / DEG, 5)}°`]);
    rows.push(["Galactic l, b", `${fx(gal.lon / DEG, 5)}°, ${fx(gal.lat / DEG, 5)}°`]);
    rows.push(["Hour angle", fmtHMS(((tp.ha / DEG / 15) + 24) % 24, 1)]);
    rows.push(["Altitude (airless)", fmtDMS(tp.alt / DEG, 0)], ["Altitude (with refraction)", P > 0 ? fmtDMS(altObs / DEG, 0) : "refraction off"]);
    rows.push(["Azimuth (from north, east +)", `${fx(tp.az / DEG, 3)}° (${compass(tp.az / DEG)})`]);
    rows.push(["Airmass (Kasten–Young)", am === null ? "below the horizon" : fx(am, 3)]);
    if (altObs > 0) rows.push(["Airmass, plane-parallel sec z", fx(1 / Math.sin(altObs), 3)]);
    const outputs: EngOutput[] = [
      { key: "alt", label: "Altitude (refracted)", value: altObs / DEG, unit: "°" },
      { key: "az", label: "Azimuth", value: tp.az / DEG, unit: "°" },
      { key: "l", label: "Galactic longitude", value: gal.lon / DEG, unit: "°" },
      { key: "b", label: "Galactic latitude", value: gal.lat / DEG, unit: "°" },
    ];
    if (am !== null) outputs.push({ key: "airmass", label: "Airmass", value: am, unit: "" });
    const epTxt = (r("epoch") ?? "").trim();
    if (epTxt) {
      const ep = plainNum(epTxt);
      if (!Number.isFinite(ep) || ep < 1000 || ep > 3000) return refuse(`Epoch: "${epTxt}" must be a Julian year from 1000 to 3000 (2050, or 2026.85).`);
      const pv = sph(precessBetween(vec(a0, d0), 2451545.0, epochToJd(ep)));
      rows.push([`Mean RA, Dec at epoch J${trimSig(ep)}`, `${fmtHMS(pv.lon / DEG / 15, 2)}, ${fmtDMS(pv.lat / DEG, 1, true)}`]);
    }
    let sepTxt = "";
    const ra2t = (r("ra2") ?? "").trim();
    if (ra2t) {
      const ra2 = parseRA(ra2t);
      if ("error" in ra2) return refuse(`Second object RA: ${ra2.error}`);
      const de2 = parseDeg(r("dec2"));
      if ("error" in de2) return refuse(`Second object Dec: ${de2.error}`);
      if (Math.abs(de2.deg) > 90) return refuse(`Second object Dec: ${trimSig(de2.deg)}° is beyond ±90°.`);
      const s = separation(a0, d0, ra2.hours * 15 * DEG, de2.deg * DEG) / DEG;
      rows.push(["Separation from the second object", `${fmtDMS(s, 1)} (${fx(s, 5)}°)`]);
      outputs.push({ key: "sep", label: "Angular separation", value: s, unit: "°" });
      sepTxt = ` It lies ${fx(s, 2)}° from the second object.`;
    }
    lines.push({ table: rows, label: "Coordinates" });
    lines.push(riseSetWords("The object", rs, w.offset, ref));
    if (Math.abs(altObs / DEG) < 1) lines.push("The object is within 1° of the horizon: refraction there is uncertain by several arcminutes with the actual air temperature profile.");
    lines.push(TZ_NOTE);
    const where = altObs > 0 ? `${fx(altObs / DEG, 1)}° above the ${compass(tp.az / DEG)} horizon (azimuth ${fx(tp.az / DEG, 0)}°), airmass ${fx(am as number, 2)}` : `${fx(-altObs / DEG, 1)}° below the horizon (azimuth ${fx(tp.az / DEG, 0)}°)`;
    const reading = `At ${pad2(Math.floor(w.clock))}:${pad2(Math.round((w.clock % 1) * 60) % 60)} (${offsetText(w.offset)}) on ${ref} from ${latText(site)}, the object is ${where}${rs.transit !== null ? `; it transits at ${clockOn(rs.transit, w.offset, ref)} at ${fx((rs.transitAlt as number) / DEG, 1)}°` : ""}.${sepTxt}`;
    const method = "Method: IAU 2006 precession, IAU 1980 nutation (Meeus table 22.A) and annual aberration take the J2000 place to the apparent place of date (proper motion and light deflection are left out; agreement with skyfield on the same instants 0.3″); WGS84 site; refraction by Sæmundsson scaled to the pressure and temperature (about 0.5′ uncertain at the horizon); rise and set at −34′ (standard refraction); galactic coordinates in the IAU (ICRS) system, within 0.03″ of astropy.";
    // The path of the object across the local day, split where it dips below the horizon.
    const path: Array<Array<{ altDeg: number; azDeg: number }>> = [[]];
    for (let i = 0; i <= 96; i++) {
      const u = w.jdLocal0 + i / 96;
      const t2 = topocentric(starPlace(a0, d0, u + sc.deltaT / 86400), site, u, u + sc.deltaT / 86400);
      if (t2.alt >= 0) path[path.length - 1].push({ altDeg: t2.alt / DEG, azDeg: t2.az / DEG });
      else if (path[path.length - 1].length) path.push([]);
    }
    const pts: DomePoint[] = [{ altDeg: altObs / DEG, azDeg: tp.az / DEG, label: `the object at ${pad2(Math.floor(w.clock))}:${pad2(Math.round((w.clock % 1) * 60) % 60)}: alt ${fx(altObs / DEG, 1)}°, az ${fx(tp.az / DEG, 1)}°` }];
    const fig = skyDomeSvg(pts, `The object over ${latText(site)}`, path.filter((p) => p.length > 1));
    return finish(reading, lines, method, [plot(fig, "Where the object stands now, and its path above the horizon through the local day", "A sky dome seen looking up, with the horizon as the outer circle and the zenith at the centre, north at the top and east at the left, showing the object's position and its dashed path")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Moon: phase and position
// ---------------------------------------------------------------------------------------------------------------

const moonCalc: AstroCalc = {
  id: "astro-moon",
  name: "Moon: phase, position, rise and set",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A local date, time and site: the Moon's phase name, illuminated fraction and age, its geocentric and topocentric " +
    "place, altitude and azimuth, distance and apparent diameter, moonrise, transit and moonset, the next New, First " +
    "Quarter, Full and Last Quarter, the optical libration, and the lit disc drawn as it appears.",
  fields: [
    { key: "date", label: "Local date (YYYY-MM-DD)", default: "2026-11-05", kind: "text" },
    { key: "time", label: "Local time (HH:MM)", default: "21:00", kind: "text" },
    { key: "tz", label: "UTC offset (hours; −5 = US Eastern standard)", default: "-5", kind: "text" },
    { key: "lat", label: "Site latitude (°, north +)", default: "38.8895", kind: "text" },
    { key: "lon", label: "Site longitude (°, east +, west −)", default: "-77.0353", kind: "text" },
    { key: "height", label: "Site height (m)", default: "20", kind: "text" },
  ],
  compute: (r) => {
    const w = readWhen(r, true);
    if (typeof w === "string") return refuse(w);
    const site = readSite(r);
    if (typeof site === "string") return refuse(site);
    const sc = scalesFromUTC(w.jdUTC);
    const st = moonState(sc.jdTT);
    const tp = topocentric(st.moon, site, sc.jdUT1, sc.jdTT);
    const ref = dateText(w);
    const rs = riseTransitSet((tt) => apparentPlace("moon", tt), "moon", site, w.jdLocal0, sc.deltaT);
    const chi = brightLimbAngle(st.moon, st.sun) / DEG;
    const q = parallacticAngle(tp.ha, tp.dec, site.lat) / DEG;
    const lib = libration(sc.jdTT);
    const next = phasesBetween(sc.jdTT, sc.jdTT + 30).slice(0, 4);
    const topoDiam = 2 * Math.asin(MOON_RADIUS_KM / tp.distKm);
    const lines: EngReportLine[] = [...w.warnings];
    lines.push({ math: "k = (1 + cos(i))/2", fallback: "k = (1 + cos i)/2, i the phase angle Sun–Moon–Earth" });
    lines.push({ math: "chi = arctan((cos(delta_0) sin(alpha_0 - alpha))/(sin(delta_0) cos(delta) - cos(delta_0) sin(delta) cos(alpha_0 - alpha)))", fallback: "χ = atan2(cos δ₀·sin(α₀ − α), sin δ₀·cos δ − cos δ₀·sin δ·cos(α₀ − α)) (Meeus 48.5, ₀ the Sun)" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Phase", `${st.name} (elongation in longitude ${fx(st.elongLon, 2)}°)`]);
    rows.push(["Illuminated fraction", pct(st.illuminated, 1)], ["Age (since New Moon)", `${fx(st.ageDays, 2)} days`]);
    rows.push(["Geocentric RA, Dec (apparent)", `${fmtHMS(st.moon.ra / DEG / 15, 1)}, ${fmtDMS(st.moon.dec / DEG, 0, true)}`]);
    rows.push(["Topocentric RA, Dec", `${fmtHMS(tp.ra / DEG / 15, 1)}, ${fmtDMS(tp.dec / DEG, 0, true)}`]);
    rows.push(["Altitude (airless), azimuth", `${fx(tp.alt / DEG, 2)}°, ${fx(tp.az / DEG, 2)}° (${compass(tp.az / DEG)})`]);
    rows.push(["Distance, centre to centre", `${n(st.moon.distKm, 6)} km (from the site ${n(tp.distKm, 6)} km)`]);
    rows.push(["Apparent diameter", `${fx((st.diameter / DEG) * 60, 2)}′ geocentric, ${fx((topoDiam / DEG) * 60, 2)}′ from the site`]);
    rows.push(["Bright limb position angle χ", `${fx(chi, 1)}° from north through east`]);
    rows.push(["Optical libration l, b", `${fx(lib.l, 2)}°, ${fx(lib.b, 2)}°`]);
    rows.push(["Moonrise", rs.circumpolar ? (rs.circumpolar === "up" ? "above the horizon all day" : "below the horizon all day") : rs.rise !== null ? clockOn(rs.rise, w.offset, ref) : "none on this date"]);
    rows.push(["Moon transit", rs.transit !== null ? `${clockOn(rs.transit, w.offset, ref)} (${fx((rs.transitAlt as number) / DEG, 1)}°)` : "none on this date"]);
    rows.push(["Moonset", rs.circumpolar ? "(see above)" : rs.set !== null ? clockOn(rs.set, w.offset, ref) : "none on this date"]);
    lines.push({ table: rows, label: "The Moon" });
    const nextRows: string[][] = [["Next phase", "Local date and time", "UTC"]];
    for (const e of next) {
      const u = utcFromTT(e.jdTT);
      nextRows.push([PHASE_NAMES[e.phase], stampText(u, w.offset), stampText(u, 0)]);
    }
    lines.push({ table: nextRows, label: "The next principal phases" });
    if (rs.circumpolar === null && (rs.rise === null || rs.set === null))
      lines.push(`No ${rs.rise === null ? "moonrise" : "moonset"} falls on ${ref}: the Moon rises about 50 minutes later each day, so once a month one calendar day has none.`);
    lines.push(TZ_NOTE);
    const where = tp.alt > 0 ? `${fx(tp.alt / DEG, 1)}° above the ${compass(tp.az / DEG)} horizon` : "below the horizon";
    const riseBit = rs.circumpolar === "up" ? "it stays up all day" : rs.circumpolar === "down" ? "it does not rise today" : [rs.rise !== null ? `it rises at ${clockOn(rs.rise, w.offset, ref)}` : "it does not rise today", rs.set !== null ? `sets at ${clockOn(rs.set, w.offset, ref)}` : "does not set today"].join(" and ");
    const reading = `On ${ref} at ${pad2(Math.floor(w.clock))}:${pad2(Math.round((w.clock % 1) * 60) % 60)} (${offsetText(w.offset)}) the Moon is a ${st.name.toLowerCase()}, ${fx(st.illuminated * 100, 0)} % lit and ${fx(st.ageDays, 1)} days old, ${where}; ${riseBit}.`;
    const method = "Method: Meeus ch. 47 Moon (ELP-2000/82 truncated; against JPL DE421/DE440s over 1900 to 2100 within 17″ in longitude, 4.5″ in latitude, 45 km in distance), truncated VSOP87 Sun (2″); topocentric by WGS84 parallax; rise and set when the upper limb meets the horizon (centre at −34′ − semidiameter, standard refraction, no dip; within 5 s of skyfield); phases are instants of 0°/90°/180°/270° elongation in apparent longitude (within 20 s of DE421); libration is optical only (Meeus ch. 53).";
    // Figures: the disc as seen, and altitude from local noon to the next.
    const disc = moonDiscSvg(st.illuminated, chi, tp.alt > 0 ? q : null, `${st.name}, ${fx(st.illuminated * 100, 0)} % lit`, tp.alt > 0 ? `as seen from the site (zenith up), age ${fx(st.ageDays, 1)} d` : `below the horizon: drawn north up, age ${fx(st.ageDays, 1)} d`);
    const moonPts: Array<{ x: number; y: number }> = [], sunPts: Array<{ x: number; y: number }> = [];
    const start = w.jdLocal0 + 0.5;
    for (let i = 0; i <= 96; i++) {
      const u = start + i / 96;
      const tt = u + sc.deltaT / 86400;
      moonPts.push({ x: i / 4, y: topocentric(apparentPlace("moon", tt), site, u, tt).alt / DEG });
      sunPts.push({ x: i / 4, y: topocentric(apparentPlace("sun", tt), site, u, tt).alt / DEG });
    }
    const alt = altitudeChartSvg([{ label: "Moon", pts: moonPts, colour: "#555555" }, { label: "Sun", pts: sunPts, colour: "#e0a800" }], `Local time from noon of ${ref} (${offsetText(w.offset)})`, 12);
    const outputs: EngOutput[] = [
      { key: "illum", label: "Illuminated fraction", value: st.illuminated, unit: "" },
      { key: "age", label: "Age", value: st.ageDays, unit: "d" },
      { key: "alt", label: "Altitude", value: tp.alt / DEG, unit: "°" },
      { key: "az", label: "Azimuth", value: tp.az / DEG, unit: "°" },
      { key: "dist", label: "Distance", value: st.moon.distKm, unit: "km" },
    ];
    return finish(reading, lines, method, [
      plot(disc, "The lit Moon with its terminator, turned as it appears", "The Moon's disc with the lit part drawn in pale yellow and the dark part in grey, the bright limb toward the Sun marked by an orange line"),
      plot(alt, "Altitude of the Moon and the Sun from local noon to the next noon", "Altitude in degrees against local time for the Moon and the Sun, with the horizon at zero"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Moon calendar: phases, perigee/apogee, supermoons, eclipses
// ---------------------------------------------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const calendarCalc: AstroCalc = {
  id: "astro-moon-calendar",
  name: "Moon calendar: phases, perigee and apogee, supermoons, eclipses",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A month (or a whole year): every New Moon, First Quarter, Full Moon and Last Quarter with its local time, the " +
    "Moon's perigees and apogees, supermoons and micromoons, and the lunar and solar eclipses found from that month " +
    "onward (type, magnitude, time of greatest eclipse).",
  fields: [
    { key: "year", label: "Year", default: "2026", kind: "text" },
    { key: "month", label: "Month", default: "11", kind: "select", options: [...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })), { value: "all", label: "The whole year" }] },
    { key: "tz", label: "UTC offset (hours; −5 = US Eastern standard)", default: "-5", kind: "text" },
    { key: "span", label: "Eclipse search", default: "24", kind: "select", options: [{ value: "12", label: "12 months from the start" }, { value: "24", label: "24 months" }, { value: "60", label: "5 years" }] },
  ],
  compute: (r) => {
    const y = plainNum(r("year"));
    if (!Number.isInteger(y)) return refuse(`Year: "${(r("year") ?? "").trim()}" is not a whole year.`);
    if (y < EPHEMERIS_YEARS.min || y > EPHEMERIS_YEARS.max) return refuse(`Year: ${y} is outside ${EPHEMERIS_YEARS.min} to ${EPHEMERIS_YEARS.max}, the years these positions are computed for.`);
    const offset = readOffset(r("tz"));
    if (typeof offset === "string") return refuse(offset);
    const whole = r("month") === "all";
    const mo = whole ? 1 : Number(r("month"));
    if (!(mo >= 1 && mo <= 12)) return refuse("Month: choose a month or the whole year.");
    const span = Number(r("span")) || 24;
    const j0 = (jdFromCalendar(y, mo, 1, "auto") as number) - offset / 24;
    const j1 = whole ? (jdFromCalendar(y + 1, 1, 1, "auto") as number) - offset / 24 : (jdFromCalendar(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, "auto") as number) - offset / 24;
    const dt0 = scalesFromUTC(j0).deltaT / 86400;
    const phases = phasesBetween(j0 + dt0, j1 + dt0);
    const aps = apsidesBetween(j0 + dt0 - 1, j1 + dt0 + 1).filter((a) => a.jdTT >= j0 + dt0 && a.jdTT < j1 + dt0);
    const label = whole ? String(y) : `${MONTHS[mo - 1]} ${y}`;
    const lines: EngReportLine[] = [];
    if (y < VERIFIED_YEARS.min || y > VERIFIED_YEARS.max) lines.push(`The year ${y} is outside 1900 to 2100, the range compared against JPL's ephemerides: phase times may be off by a minute or more (ΔT is uncertain).`);
    const phRows: string[][] = [["Phase", `Local (${offsetText(offset)})`, "UTC", "Distance (km)", "Note"]];
    const supers: string[] = [];
    for (const e of phases) {
      const u = utcFromTT(e.jdTT);
      const st = e.phase === 2 ? moonState(e.jdTT) : null;
      const d = st ? st.moon.distKm : null;
      const note = d !== null && d < SUPERMOON_KM ? "supermoon" : d !== null && d > MICROMOON_KM ? "micromoon" : "";
      if (note === "supermoon") supers.push(stampText(u, offset).slice(0, 10));
      phRows.push([PHASE_NAMES[e.phase], stampText(u, offset), stampText(u, 0), d !== null ? fx(d, 0) : "", note]);
    }
    lines.push({ table: phRows, label: `Moon phases, ${label}` });
    const apRows: string[][] = [["Event", `Local (${offsetText(offset)})`, "Distance (km)"]];
    for (const a of aps) apRows.push([a.kind === "perigee" ? "Perigee" : "Apogee", stampText(utcFromTT(a.jdTT), offset), fx(a.distKm, 0)]);
    lines.push({ table: apRows, label: "Perigee and apogee (least and greatest centre distance)" });
    const eclEnd = j0 + dt0 + span * 30.44;
    const ecl = eclipsesBetween(j0 + dt0, eclEnd);
    const all = [
      ...ecl.lunar.map((e) => ({ t: e.jdTT, kind: `${e.type[0].toUpperCase()}${e.type.slice(1)} lunar eclipse`, mag: `umbral ${fx(e.umbralMag, 3)}, penumbral ${fx(e.penumbralMag, 3)}`, extra: "" })),
      ...ecl.solar.map((e) => ({ t: e.jdTT, kind: `${e.type[0].toUpperCase()}${e.type.slice(1)} solar eclipse${e.central || e.type === "partial" ? "" : " (non-central)"}`, mag: `magnitude ${fx(e.magnitude, 3)}`, extra: `γ = ${fx(e.gamma, 4)}` })),
    ].sort((a, b) => a.t - b.t);
    const ecRows: string[][] = [["Eclipse", "Greatest (UTC)", `Local (${offsetText(offset)})`, "Magnitude", "γ"]];
    for (const e of all) {
      const u = utcFromTT(e.t);
      ecRows.push([e.kind, stampText(u, 0), stampText(u, offset), e.mag, e.extra]);
    }
    lines.push({ table: ecRows, label: `Eclipses from ${label.split(" ")[0]} ${y} for ${span} months` });
    if (!all.length) lines.push(`No eclipse falls in the ${span} months searched.`);
    lines.push(`Supermoon here means a full Moon less than ${fx(SUPERMOON_KM, 0)} km from the Earth's centre; micromoon, beyond ${fx(MICROMOON_KM, 0)} km. There is no official definition; others (Nolle's "within 90 % of perigee") give slightly different lists.`);
    lines.push("Eclipses are found at every New and Full Moon in the window. A solar eclipse's γ is the least distance of the Moon's shadow axis from the Earth's centre in Earth radii (positive north); where on Earth it is seen is NOT computed here. A lunar eclipse is visible wherever the Moon is up at the time.");
    lines.push(TZ_NOTE);
    const full = phases.filter((e) => e.phase === 2);
    const newm = phases.filter((e) => e.phase === 0);
    const nextE = all[0];
    const reading = `In ${label} the Moon is full ${full.length ? full.map((e) => `on ${stampText(utcFromTT(e.jdTT), offset)}`).join(" and ") : "on no date"} and new ${newm.length ? newm.map((e) => `on ${stampText(utcFromTT(e.jdTT), offset)}`).join(" and ") : "on no date"} (${offsetText(offset)})${supers.length ? `; supermoon ${supers.join(", ")}` : ""}; ${nextE ? `the next eclipse found is ${/^[aeiou]/i.test(nextE.kind) ? "an" : "a"} ${nextE.kind.toLowerCase()} on ${stampText(utcFromTT(nextE.t), 0).slice(0, 10)}.` : `no eclipse falls in the ${span} months searched.`}`;
    const method = "Method: phases are the instants the apparent geocentric longitude of the Moon (Meeus ch. 47) exceeds the Sun's (truncated VSOP87) by 0°, 90°, 180°, 270° (within 20 s of DE421/DE440s over 1900 to 2100); perigee and apogee are extrema of the ch. 47 distance (times within about an hour, distances within 50 km); lunar eclipses by Danjon's shadow (umbral magnitudes within 0.004 of skyfield's DE421 values, all 343 of 1900 to 2049 found), solar eclipse γ within 0.001 of DE421.";
    // Figure: the month grid, or for a whole year the lit fraction day by day.
    let fig: AnalyzeBlock;
    if (!whole) {
      const days = daysInMonth(y, mo, y > 1582);
      const cells: CalendarCell[] = [];
      for (let d = 1; d <= days; d++) {
        const u = (jdFromCalendar(y, mo, d, "auto") as number) - offset / 24 + 21 / 24; // 21:00 local, an evening view
        const st = moonLit(u + dt0);
        const ph = phases.find((e) => localStamp(utcFromTT(e.jdTT), offset).date === `${yearText(y)}-${pad2(mo)}-${pad2(d)}`);
        cells.push({ day: d, k: st.illuminated, waxing: st.waxing, mark: ph ? `${["New", "1st Q", "Full", "Last Q"][ph.phase]} ${localStamp(utcFromTT(ph.jdTT), offset).time}` : null });
      }
      const first = dayOfWeek(jdFromCalendar(y, mo, 1, "auto") as number);
      fig = plot(moonCalendarSvg(`The Moon in ${label} (at 21:00, ${offsetText(offset)})`, first, cells), `The Moon each evening of ${label}, principal phases marked`, "A month calendar grid with a small Moon icon in every day showing its lit fraction, the days of the principal phases highlighted with their local times");
    } else {
      const pts: Array<{ x: number; y: number }> = [];
      const nd = Math.round(j1 - j0);
      for (let d = 0; d <= nd; d++) pts.push({ x: d + 1, y: moonLit(j0 + dt0 + d + 0.5).illuminated * 100 });
      fig = plot(buildPlotSvg([{ points: pts, type: "line", color: "#555555", label: "lit fraction at local noon" }, { points: full.map((e) => ({ x: e.jdTT - (j0 + dt0) + 1, y: 100 })), type: "scatter", color: "#c00000", label: "Full Moon" }], { xlabel: `Day of ${y}`, ylabel: "Illuminated (%)", yLimits: { min: 0, max: 105 }, width: 460, height: 290 }), `The Moon's illuminated fraction through ${y}`, "Illuminated percentage of the Moon against day of the year, full Moons marked");
    }
    const outputs: EngOutput[] = [{ key: "nPhases", label: "Principal phases in the period", value: phases.length, unit: "" }, { key: "nEclipses", label: "Eclipses found", value: all.length, unit: "" }];
    if (full.length) outputs.push({ key: "fullDist", label: "Distance at the first Full Moon", value: moonState(full[0].jdTT).moon.distKm, unit: "km" });
    return finish(reading, lines, method, [fig], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Sun, Moon and planets ephemeris
// ---------------------------------------------------------------------------------------------------------------

const ephemCalc: AstroCalc = {
  id: "astro-ephemeris",
  name: "Sun, Moon and planets: positions, magnitudes, rise and set",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A local date, time and site: the apparent right ascension and declination of the Sun, the Moon and Mercury to " +
    "Neptune, their distances, elongations from the Sun, visual magnitudes and lit fractions, altitudes now, and rise " +
    "and set times on the local date; and the ecliptic strip with every body on it.",
  fields: [
    { key: "date", label: "Local date (YYYY-MM-DD)", default: "2026-11-05", kind: "text" },
    { key: "time", label: "Local time (HH:MM)", default: "21:00", kind: "text" },
    { key: "tz", label: "UTC offset (hours; −5 = US Eastern standard)", default: "-5", kind: "text" },
    { key: "lat", label: "Site latitude (°, north +)", default: "38.8895", kind: "text" },
    { key: "lon", label: "Site longitude (°, east +, west −)", default: "-77.0353", kind: "text" },
    { key: "height", label: "Site height (m)", default: "20", kind: "text" },
  ],
  compute: (r) => {
    const w = readWhen(r, true);
    if (typeof w === "string") return refuse(w);
    const site = readSite(r);
    if (typeof site === "string") return refuse(site);
    const sc = scalesFromUTC(w.jdUTC);
    const ref = dateText(w);
    const bodies: BodyId[] = ["sun", "moon", ...PLANETS];
    const sun = apparentPlace("sun", sc.jdTT);
    const rows: string[][] = [["Body", "RA (of date)", "Dec", "Distance", "Elong.", "Mag.", "Lit", "Alt. now", "Rises", "Sets"]];
    const strip: Array<{ label: string; lonDeg: number; latDeg: number }> = [];
    const up: string[] = [];
    const outputs: EngOutput[] = [];
    for (const b of bodies) {
      const p: Place = b === "sun" ? sun : apparentPlace(b, sc.jdTT);
      const tp = topocentric(p, site, sc.jdUT1, sc.jdTT);
      const rs = riseTransitSet((tt) => apparentPlace(b, tt), b, site, w.jdLocal0, sc.deltaT);
      const elong = b === "sun" ? null : separation(p.ra, p.dec, sun.ra, sun.dec) / DEG;
      const mag = b === "sun" ? -26.74 : b === "moon" ? null : planetMagnitude(b, sc.jdTT);
      const lit = b === "sun" ? null : (1 + Math.cos(p.phaseAngle)) / 2;
      const dist = b === "moon" ? `${fx(p.distKm, 0)} km` : `${fx(p.distKm / AU_KM, 5)} au`;
      const riseTxt = rs.circumpolar === "up" ? "up all day" : rs.circumpolar === "down" ? "not up" : rs.rise !== null ? clockOn(rs.rise, w.offset, ref) : "none";
      const setTxt = rs.circumpolar ? "" : rs.set !== null ? clockOn(rs.set, w.offset, ref) : "none";
      rows.push([BODY_LABEL[b], fmtHMS(p.ra / DEG / 15, 1), fmtDMS(p.dec / DEG, 0, true), dist, elong === null ? "" : `${fx(elong, 1)}°`, mag === null ? "" : fx(mag, 2), lit === null ? "" : pct(lit, 0), `${fx(tp.alt / DEG, 1)}°`, riseTxt, setTxt]);
      strip.push({ label: BODY_LABEL[b], lonDeg: p.eclLon / DEG, latDeg: p.eclLat / DEG });
      if (b !== "sun" && b !== "moon" && tp.alt > 0) up.push(`${BODY_LABEL[b]} (magnitude ${fx(mag as number, 1)}, ${fx(tp.alt / DEG, 0)}° up in the ${compass(tp.az / DEG)})`);
      if (b !== "sun") outputs.push({ key: `${b}Alt`, label: `${BODY_LABEL[b]} altitude`, value: tp.alt / DEG, unit: "°" });
    }
    const sunTp = topocentric(sun, site, sc.jdUT1, sc.jdTT);
    const lines: EngReportLine[] = [...w.warnings];
    lines.push({ math: "Delta = abs(vec(r)_p(t - tau) - vec(r)_E(t))", fallback: "Δ = |r⃗ₚ(t − τ) − r⃗ₑ(t)|, τ = Δ/c (light time), then aberration, precession and nutation" });
    lines.push({ table: rows, label: `Sun, Moon and planets, ${ref} ${pad2(Math.floor(w.clock))}:${pad2(Math.round((w.clock % 1) * 60) % 60)} (${offsetText(w.offset)})` });
    lines.push("Distances are from the Earth's centre; RA and Dec are geocentric apparent places of date (the Moon's topocentric place differs by up to a degree: see the Moon tool). Altitudes are topocentric and airless. Elongation is the angle from the Sun; Lit is the illuminated fraction of the disc. Rise and set use −50′ for the Sun, −34′ for the planets and the Moon's semidiameter.");
    lines.push(TZ_NOTE);
    const sunWord = sunTp.alt > 0 ? `the Sun is up (${fx(sunTp.alt / DEG, 0)}°)` : sunTp.alt > -6 * DEG ? "it is civil twilight" : sunTp.alt > -18 * DEG ? `the Sun is ${fx(-sunTp.alt / DEG, 0)}° below the horizon (twilight)` : "it is fully dark";
    const reading = `On ${ref} at ${pad2(Math.floor(w.clock))}:${pad2(Math.round((w.clock % 1) * 60) % 60)} (${offsetText(w.offset)}) ${sunWord}; ${up.length ? `above the horizon: ${up.slice(0, 3).join("; ")}` : "no planet is above the horizon"}.`;
    const method = "Method: truncated VSOP87 (1230 terms) for the Sun and planets with light time, aberration, IAU 2006 precession and IAU 1980 nutation: within 3.5″ of JPL DE421/DE440s over 1900 to 2100; the Moon by Meeus ch. 47 (17″); magnitudes by Mallama & Hilton (2018), within 0.02 of skyfield (Mercury 0.14 near inferior conjunction, where skyfield uses the barycentre for the Sun); the Sun's −26.74 is the standard value.";
    const fig = eclipticStripSvg(strip);
    return finish(reading, lines, method, [plot(fig, "The Sun, Moon and planets along the ecliptic, east to the left as the sky looks facing south", "Ecliptic latitude against ecliptic longitude for the Sun, the Moon and the seven planets")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Unit reading for the converting tools (telescope, stars, Kepler, gravity)
// ---------------------------------------------------------------------------------------------------------------

/** Astronomical units the shared unit table does not hold: their factor to SI, by dimension. */
const ASTRO_UNITS: Record<string, { si: string; factor: number }> = {
  pc: { si: "m", factor: PC_M }, kpc: { si: "m", factor: PC_M * 1e3 }, Mpc: { si: "m", factor: PC_M * 1e6 },
  ly: { si: "m", factor: LY_M }, au: { si: "m", factor: AU_M }, AU: { si: "m", factor: AU_M },
  "R☉": { si: "m", factor: R_SUN }, Rsun: { si: "m", factor: R_SUN }, "R⊕": { si: "m", factor: R_EARTH_M }, Rearth: { si: "m", factor: R_EARTH_M }, RJ: { si: "m", factor: R_JUP_M }, Rjup: { si: "m", factor: R_JUP_M },
  "M☉": { si: "kg", factor: MU_SUN / 6.6743e-11 }, Msun: { si: "kg", factor: MU_SUN / 6.6743e-11 }, "M⊕": { si: "kg", factor: MU_EARTH / 6.6743e-11 }, Mearth: { si: "kg", factor: MU_EARTH / 6.6743e-11 }, MJ: { si: "kg", factor: MU_JUPITER / 6.6743e-11 }, Mjup: { si: "kg", factor: MU_JUPITER / 6.6743e-11 },
  d: { si: "s", factor: 86400 }, days: { si: "s", factor: 86400 }, yr: { si: "s", factor: 365.25 * 86400 }, y: { si: "s", factor: 365.25 * 86400 },
};

/**
 * Unit-aware field reading: a bare number is in the field's own unit; an astronomical unit (pc, ly, au, R☉, M☉, M⊕,
 * MJ, d, yr) or any unit of the shared table (km, mm, µm, kg, lb, h, K, °C) converts; a unit of the wrong quantity is
 * refused by name. Conversions are reported.
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shownFactor: number, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(\S.*)?$/.exec(raw);
    if (m && m[2] && ASTRO_UNITS[m[2].trim()]) {
      const u = ASTRO_UNITS[m[2].trim()];
      if (u.si !== si) {
        errors.push(`${label}: "${m[2].trim()}" is not a unit of this quantity.`);
        return NaN;
      }
      const v = (Number(m[1]) * u.factor) / shownFactor;
      conversions.push(`${label}: ${trimSig(Number(m[1]))} ${m[2].trim()} = ${trimSig(v)} ${shown}`);
      return v;
    }
    const pm = parseMeasured(raw, si);
    if ("error" in pm) {
      errors.push(`${label}: ${pm.error}`);
      return NaN;
    }
    if (!Number.isFinite(pm.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    // A bare number is in the shown unit; a unit typed converts through SI.
    if (pm.assumed) return pm.value;
    const v = pm.inTarget / shownFactor;
    if (Math.abs(v / pm.value - 1) > 1e-12 || pm.unit !== shown) conversions.push(`${label}: ${trimSig(pm.value)} ${formatUnit(pm.unit)} = ${trimSig(v)} ${shown}`);
    return v;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shownFactor: number, shown: string, label: string): number => read(key, si, shownFactor, shown, label, true) as number,
    opt: (key: string, si: string, shownFactor: number, shown: string, label: string): number | null => read(key, si, shownFactor, shown, label, false),
  };
}

/** A fraction field: "0.8" or "80 %". */
function fraction(v: string | undefined, label: string): number | string {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: this field is required.`;
  const pc = /^(.*?)\s*%$/.exec(t);
  const x = plainNum(pc ? pc[1] : t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a number (write 0.8, or 80 %).`;
  if (!pc && x > 1) return `${label}: ${trimSig(x)} is above 1: write a fraction (0.8) or a percentage (80 %).`;
  return pc ? x / 100 : x;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Telescope and camera
// ---------------------------------------------------------------------------------------------------------------

const telescopeCalc: AstroCalc = {
  id: "astro-telescope",
  name: "Telescope and camera: magnification, field, resolution, limiting magnitude, sampling",
  group: ASTRO_GROUP,
  unitContract: "converts",
  hint:
    "Aperture and focal length, with an eyepiece (focal length and apparent field) and/or a camera (pixel size and sensor " +
    "size): focal ratio, magnification, true field, exit pupil, Dawes and Rayleigh limits, the limiting magnitude, plate " +
    "scale, pixel scale, the sampling of the seeing disc, and the camera's field against a target's size.",
  fields: [
    { key: "D", label: "Aperture D (mm)", default: "200 mm", kind: "text" },
    { key: "F", label: "Focal length F (mm)", default: "1200 mm", kind: "text" },
    { key: "fe", label: "Eyepiece focal length (mm; blank = none)", default: "25 mm", kind: "text" },
    { key: "afov", label: "Eyepiece apparent field (°)", default: "52", kind: "text" },
    { key: "pupil", label: "Eye pupil (mm)", default: "7 mm", kind: "text" },
    { key: "eye", label: "Naked-eye limiting magnitude", default: "6.0", kind: "text" },
    { key: "trans", label: "Optical transmission (fraction, or %)", default: "0.8", kind: "text" },
    { key: "lam", label: "Wavelength for the Rayleigh limit (nm)", default: "550 nm", kind: "text" },
    { key: "seeing", label: "Seeing FWHM (arcsec; blank = none)", default: "2 arcsec", kind: "text" },
    { key: "pix", label: "Camera pixel size (µm; blank = no camera)", default: "3.76 µm", kind: "text" },
    { key: "sw", label: "Sensor width (mm)", default: "23.5 mm", kind: "text" },
    { key: "sh", label: "Sensor height (mm)", default: "15.6 mm", kind: "text" },
    { key: "target", label: "Target's apparent size (arcmin; 31 = the Moon)", default: "31", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const D = u.req("D", "m", 1e-3, "mm", "Aperture");
    const F = u.req("F", "m", 1e-3, "mm", "Focal length");
    const fe = u.opt("fe", "m", 1e-3, "mm", "Eyepiece focal length");
    const pupil = u.req("pupil", "m", 1e-3, "mm", "Eye pupil");
    const lam = u.req("lam", "m", 1e-9, "nm", "Wavelength");
    const seeing = u.opt("seeing", "arcsec", 1, "arcsec", "Seeing");
    const pix = u.opt("pix", "m", 1e-6, "µm", "Pixel size");
    const sw = pix !== null ? u.opt("sw", "m", 1e-3, "mm", "Sensor width") : null;
    const sh = pix !== null ? u.opt("sh", "m", 1e-3, "mm", "Sensor height") : null;
    const afov = fe !== null ? u.opt("afov", "°", 1, "°", "Apparent field") : null;
    const target = u.opt("target", "arcmin", 1, "arcmin", "Target size");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const eye = plainNum(r("eye"));
    if (!Number.isFinite(eye)) return refuse(`Naked-eye limiting magnitude: "${(r("eye") ?? "").trim()}" is not a number.`);
    const tr = fraction(r("trans"), "Optical transmission");
    if (typeof tr === "string") return refuse(tr);
    if (target !== null && target <= 0) return refuse("Target size must be greater than zero (or blank).");
    const res = telescope({ apertureMm: D, focalMm: F, eyepieceMm: fe, afovDeg: afov, pupilMm: pupil, eyeLimit: eye, transmission: tr, wavelengthNm: lam, seeingArcsec: seeing, pixelUm: pix, sensorWmm: sw, sensorHmm: sh });
    if (!res.ok) return refuse(res.error);
    const lines: EngReportLine[] = [];
    lines.push({ math: "N = F/D", fallback: "N = F/D (focal ratio); M = F/fₑ; true field = apparent field/M; exit pupil = D/M" });
    lines.push({ math: "theta_R = 1.21967 lambda/D", fallback: "θ(Rayleigh) = 1.21967·λ/D; θ(Dawes) = 116″/D(mm)" });
    lines.push({ math: "m_lim = m_eye + 5 log(D/d_p) + 2.5 log(T)", fallback: "m(lim) = m(eye) + 5·log₁₀(D/d(pupil)) + 2.5·log₁₀ T" });
    lines.push({ math: "s = 206.265 p/F", fallback: "s = 206.265·p(µm)/F(mm) arcsec per pixel" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Focal ratio", `f/${fx(res.focalRatio, 2)}`]);
    if (res.magnification !== null) rows.push(["Magnification", `${fx(res.magnification, 1)}×`], ["Exit pupil", `${fx(res.exitPupilMm as number, 2)} mm`]);
    if (res.trueFovDeg !== null) rows.push(["True field of view", `${fx(res.trueFovDeg, 3)}° (${fx(res.trueFovDeg * 60, 1)}′)`]);
    rows.push(["Useful magnification range", `${fx(res.minUsefulMag, 0)}× (exit pupil = eye pupil) to about ${fx(res.maxUsefulMag, 0)}× (2× per mm)`]);
    rows.push(["Dawes limit", `${fx(res.dawesArcsec, 3)}″`], [`Rayleigh limit at ${trimSig(lam)} nm`, `${fx(res.rayleighArcsec, 3)}″`]);
    rows.push(["Limiting magnitude (visual)", fx(res.limitingMag, 1)]);
    rows.push(["Plate scale", `${fx(res.plateScaleArcsecPerMm, 2)}″/mm`]);
    if (res.pixelScale !== null) rows.push(["Pixel scale", `${fx(res.pixelScale, 3)}″/px`]);
    if (res.samplesPerSeeing !== null) rows.push(["Pixels across the seeing FWHM", `${fx(res.samplesPerSeeing, 2)} (${res.sampling === "under" ? "undersampled: below 2" : res.sampling === "over" ? "oversampled: above 3.5" : "well sampled: 2 to 3.5"})`]);
    if (res.cameraFovArcmin) rows.push(["Camera field", `${fx(res.cameraFovArcmin[0], 1)}′ × ${fx(res.cameraFovArcmin[1], 1)}′ (${fx(res.cameraFovArcmin[0] / 60, 3)}° × ${fx(res.cameraFovArcmin[1] / 60, 3)}°)`]);
    lines.push({ table: rows, label: "Telescope" });
    for (const note of res.notes) lines.push(note);
    if (seeing !== null && res.dawesArcsec < seeing) lines.push(`The seeing (${trimSig(seeing)}″) is coarser than the Dawes limit (${fx(res.dawesArcsec, 2)}″): on most nights the atmosphere, not the aperture, sets the resolution.`);
    const fits = (fov: number | null): string => (target === null || fov === null ? "" : fov >= target ? " (the target fits)" : " (the target does not fit)");
    const fov = res.trueFovDeg;
    const fovText = fov === null ? "" : fov >= 1 ? `a ${fx(fov, 2)}° true field` : `a ${fx(fov * 60, 1)}′ true field`;
    const eyeBit = res.magnification === null ? "" : ` with a ${trimSig(fe as number)} mm eyepiece gives ${fx(res.magnification, 0)}×${fovText ? ` and ${fovText}${fits(fov === null ? null : fov * 60)}` : ""}`;
    const reading = `A ${trimSig(D)} mm f/${fx(res.focalRatio, 1)} telescope${eyeBit}; it shows stars to about magnitude ${fx(res.limitingMag, 1)} and resolves doubles ${fx(res.dawesArcsec, 2)}″ apart${res.pixelScale !== null ? `; the camera images ${fx(res.pixelScale, 2)}″ per pixel${res.samplesPerSeeing !== null ? `, ${fx(res.samplesPerSeeing, 1)} pixels across the seeing (${res.sampling === "good" ? "well sampled" : res.sampling === "under" ? "undersampled" : "oversampled"})` : ""}` : ""}.`;
    const method = "Assumptions: the limiting magnitude scales the naked-eye limit by the light grasp (D/pupil)² and the transmission, for a dark-adapted observer under a dark sky (real limits vary by about ±1 magnitude with sky brightness, experience and magnification); Dawes's 116″/D is an empirical limit for equal 6th-magnitude doubles; Rayleigh is the Airy first-minimum radius; sampling of 2 to 3.5 pixels per FWHM is the usual Nyquist-based target.";
    const fig = fovSvg(res.trueFovDeg === null ? null : res.trueFovDeg * 60, res.cameraFovArcmin, target, "target");
    const outputs: EngOutput[] = [
      { key: "N", label: "Focal ratio", value: res.focalRatio, unit: "" },
      { key: "dawes", label: "Dawes limit", value: res.dawesArcsec, unit: "arcsec" },
      { key: "mlim", label: "Limiting magnitude", value: res.limitingMag, unit: "" },
    ];
    if (res.magnification !== null) outputs.push({ key: "mag", label: "Magnification", value: res.magnification, unit: "" });
    if (res.pixelScale !== null) outputs.push({ key: "pixScale", label: "Pixel scale", value: res.pixelScale, unit: "arcsec" });
    return finish(reading, lines, method, [plot(fig, "Eyepiece field, camera field and the target, to one scale", "Concentric outlines of the eyepiece's circular field and the camera's rectangular field over a disc the size of the target")], outputs, u.conversions);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Stars: magnitudes, distance, luminosity
// ---------------------------------------------------------------------------------------------------------------

const starsCalc: AstroCalc = {
  id: "astro-stars",
  name: "Stars: magnitude, distance modulus, parallax, luminosity, radius, Wien peak",
  group: ASTRO_GROUP,
  unitContract: "converts",
  hint:
    "Any two of the apparent magnitude, absolute magnitude and distance (or parallax) give the third and the distance " +
    "modulus; any two of the luminosity, radius and effective temperature give the third by the Stefan–Boltzmann law, " +
    "with the Wien peak, the flux at the Earth and the bolometric magnitude. Defaults: Sirius A.",
  fields: [
    { key: "m", label: "Apparent magnitude m (blank = solve)", default: "-1.46", kind: "text" },
    { key: "M", label: "Absolute magnitude M (blank = solve)", default: "", kind: "text" },
    { key: "d", label: "Distance (pc; ly, au, kpc convert; blank = solve)", default: "", kind: "text" },
    { key: "plx", label: "Parallax (mas; instead of a distance)", default: "379.21", kind: "text" },
    { key: "A", label: "Extinction A (mag)", default: "0", kind: "text" },
    { key: "L", label: "Luminosity (L☉; blank = solve)", default: "", kind: "text" },
    { key: "R", label: "Radius (R☉; km, R⊕ convert; blank = solve)", default: "1.711", kind: "text" },
    { key: "T", label: "Effective temperature (K)", default: "9940 K", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const d = u.opt("d", "m", PC_M, "pc", "Distance");
    const Rr = u.opt("R", "m", R_SUN, "R☉", "Radius");
    const T = u.opt("T", "K", 1, "K", "Temperature");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const opt = (k: string, label: string): number | null | string => {
      const t = (r(k) ?? "").trim();
      if (!t) return null;
      const v = plainNum(t);
      return Number.isFinite(v) ? v : `${label}: "${t}" is not a number.`;
    };
    const m = opt("m", "Apparent magnitude"), M = opt("M", "Absolute magnitude"), plx = opt("plx", "Parallax"), A = opt("A", "Extinction"), L = opt("L", "Luminosity");
    for (const v of [m, M, plx, A, L]) if (typeof v === "string") return refuse(v);
    const res = star({ m: m as number | null, M: M as number | null, dPc: d, parallaxMas: plx as number | null, extinction: (A as number | null) ?? 0, L: L as number | null, R: Rr, T });
    if (!res.ok) return refuse(res.error);
    const lines: EngReportLine[] = [];
    lines.push({ math: "m - M = 5 log(d/(10 pc)) + A", fallback: "m − M = 5·log₁₀(d/10 pc) + A (distance modulus)" });
    lines.push({ math: "d = 1/varpi", fallback: "d (pc) = 1/ϖ (arcsec) = 1000/ϖ (mas)" });
    lines.push({ math: "L = 4 pi R^2 sigma T^4", fallback: "L = 4πR²σT⁴, so L/L☉ = (R/R☉)²(T/T☉)⁴" });
    lines.push({ math: "lambda_max = b/T", fallback: "λ(max) = b/T, b = 2.897771955×10⁻³ m·K" });
    const rows: string[][] = [["Quantity", "Value"]];
    if (res.m !== null) rows.push(["Apparent magnitude m", fx(res.m, 3)]);
    if (res.M !== null) rows.push(["Absolute magnitude M", fx(res.M, 3)]);
    if (res.dPc !== null) rows.push(["Distance", `${n(res.dPc, 6)} pc = ${n((res.dPc * PC_M) / LY_M, 6)} ly`], ["Parallax", `${n(res.parallaxMas as number, 6)} mas`], ["Distance modulus 5 log₁₀(d/10 pc)", fx(res.mu as number, 3)]);
    if (res.L !== null) rows.push(["Luminosity", `${n(res.L, 5)} L☉ = ${n(res.L * 3.828e26, 5)} W`], ["Bolometric magnitude", fx(res.mbol as number, 3)]);
    if (res.R !== null) rows.push(["Radius", `${n(res.R, 5)} R☉ = ${n(res.R * R_SUN / 1000, 5)} km`]);
    if (res.T !== null) rows.push(["Effective temperature", `${n(res.T, 5)} K`], ["Wien peak", `${n(res.wienNm as number, 5)} nm`]);
    if (res.fluxWm2 !== null) rows.push(["Bolometric flux at the Earth", `${n(res.fluxWm2, 5)} W/m²`]);
    lines.push({ table: rows, label: "The star" });
    if (res.derived.length) lines.push(`Solved: ${res.derived.join("; ")}.`);
    for (const note of res.notes) lines.push(note);
    if (res.M !== null && res.L !== null) lines.push("The absolute magnitude is in the band of the apparent one you gave (usually V); the bolometric magnitude counts all wavelengths, and the two differ by the bolometric correction, which is not computed here.");
    const band = (nm: number): string => (nm < 380 ? "ultraviolet" : nm < 450 ? "violet" : nm < 495 ? "blue" : nm < 570 ? "green" : nm < 590 ? "yellow" : nm < 620 ? "orange" : nm < 750 ? "red" : "infrared");
    const bits: string[] = [];
    if (res.dPc !== null) bits.push(`is ${n(res.dPc, 4)} pc away (${n((res.dPc * PC_M) / LY_M, 3)} light-years)`);
    if (res.M !== null) bits.push(`has absolute magnitude ${fx(res.M, 2)}`);
    if (res.L !== null) bits.push(`radiates ${n(res.L, 3)} times the Sun's power`);
    if (res.wienNm !== null) bits.push(`peaks at ${n(res.wienNm, 3)} nm (${band(res.wienNm)})`);
    const reading = `This star ${bits.join(", ")}.`;
    const method = "Constants: IAU 2015 nominal solar values (L☉ = 3.828×10²⁶ W, R☉ = 6.957×10⁸ m, T☉ = 5772 K, M(bol)☉ = 4.74), IAU parsec (648000/π au), CODATA 2018 σ and Wien's b. Assumes a blackbody photosphere for L = 4πR²σT⁴, and 1/ϖ as the distance (valid when the parallax error is small; for errors above about 20 % a Bayesian distance is needed).";
    const outputs: EngOutput[] = [];
    if (res.dPc !== null) outputs.push({ key: "d", label: "Distance", value: res.dPc, unit: "pc" });
    if (res.M !== null) outputs.push({ key: "M", label: "Absolute magnitude", value: res.M, unit: "" });
    if (res.L !== null) outputs.push({ key: "L", label: "Luminosity", value: res.L, unit: "L☉" });
    if (res.wienNm !== null) outputs.push({ key: "wien", label: "Wien peak", value: res.wienNm, unit: "nm" });
    let fig: AnalyzeBlock | null = null;
    if (res.T !== null && res.L !== null && res.T >= 2000 && res.T <= 50000 && res.L > 1e-5 && res.L < 1e7)
      fig = plot(hrDiagramSvg(res.T, res.L, "this star"), "The star on the Hertzsprung–Russell diagram, with lines of constant radius", "Luminosity on a log scale against temperature falling to the right, grey lines of constant radius, the Sun and this star marked");
    else if (res.M !== null && res.dPc !== null && res.m !== null) fig = plot(modulusChartSvg(res.M, res.dPc, res.m, (A as number | null) ?? 0), "Apparent magnitude against distance for this absolute magnitude", "Apparent magnitude against distance on a log axis, brighter upward, the star marked");
    else if (res.T !== null) {
      const pts: Array<{ x: number; y: number }> = [];
      const peak = res.wienNm as number;
      for (let i = 1; i <= 200; i++) {
        const lnm = (peak * 6 * i) / 200;
        const l = lnm * 1e-9;
        pts.push({ x: lnm, y: 1 / (l ** 5 * (Math.exp(0.014387768775039337 / (l * (res.T as number))) - 1)) });
      }
      const max = Math.max(...pts.map((p) => p.y));
      fig = plot(buildPlotSvg([{ points: pts.map((p) => ({ x: p.x, y: p.y / max })), type: "line", color: "#c00000", label: `${n(res.T, 4)} K blackbody` }], { xlabel: "Wavelength (nm)", ylabel: "Relative spectral radiance", width: 460, height: 290 }), "The blackbody spectrum at this temperature", "Planck spectrum against wavelength, peaking at the Wien wavelength");
    }
    if (!fig) return refuse("Give enough to place the star: two of m, M and distance, or a temperature.");
    return finish(reading, lines, method, [fig], outputs, u.conversions);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Redshift and cosmological distances
// ---------------------------------------------------------------------------------------------------------------

const cosmoCalc: AstroCalc = {
  id: "astro-cosmology",
  name: "Redshift: Hubble-law and ΛCDM distances, lookback time, age",
  group: ASTRO_GROUP,
  unitContract: "domain",
  hint:
    "A redshift z with H₀ and Ωm (flat ΛCDM, defaults Planck-like 67.7 km/s/Mpc and 0.31): the low-z Hubble-law distance " +
    "cz/H₀, and the comoving, luminosity and angular-diameter distances, the scale in kpc per arcsecond, the lookback " +
    "time and the age of the universe then and now.",
  fields: [
    { key: "z", label: "Redshift z", default: "0.5", kind: "text" },
    { key: "H0", label: "Hubble constant H₀ (km/s/Mpc)", default: "67.7", kind: "text" },
    { key: "Om", label: "Matter density Ωm (flat: ΩΛ = 1 − Ωm)", default: "0.31", kind: "text" },
  ],
  compute: (r) => {
    const z = plainNum(r("z")), H0 = plainNum(r("H0")), Om = plainNum(r("Om"));
    if (!Number.isFinite(z)) return refuse(`Redshift: "${(r("z") ?? "").trim()}" is not a number.`);
    if (!Number.isFinite(H0)) return refuse(`H₀: "${(r("H0") ?? "").trim()}" is not a number of km/s/Mpc.`);
    if (!Number.isFinite(Om)) return refuse(`Ωm: "${(r("Om") ?? "").trim()}" is not a number.`);
    const c = cosmology(z, H0, Om);
    if (!c.ok) return refuse(c.error);
    const lines: EngReportLine[] = [];
    lines.push({ math: "D_C = c/H_0 int(0, z, 1/E(z) dz)", fallback: "D(C) = (c/H₀)∫₀ᶻ dz′/E(z′), E(z) = √(Ωm(1 + z)³ + ΩΛ)" });
    lines.push({ math: "D_L = (1 + z) D_C", fallback: "D(L) = (1 + z)·D(C); D(A) = D(C)/(1 + z)" });
    lines.push({ math: "t(z) = 2/(3 H_0 sqrt(Omega_Lambda)) arcsinh(sqrt(Omega_Lambda/Omega_m) (1 + z)^(-3/2))", fallback: "t(z) = (2/(3H₀√ΩΛ))·arsinh(√(ΩΛ/Ωm)·(1 + z)^(−3/2))" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Recession velocity cz", `${n(c.czKms, 6)} km/s`]);
    rows.push(["Hubble-law distance cz/H₀", `${n(c.hubbleMpc, 6)} Mpc`]);
    rows.push(["Comoving distance", `${n(c.comovingMpc, 6)} Mpc`], ["Luminosity distance", `${n(c.luminosityMpc, 6)} Mpc`], ["Angular-diameter distance", `${n(c.angularMpc, 6)} Mpc`]);
    rows.push(["Scale", `${n(c.kpcPerArcsec, 5)} kpc per arcsecond`]);
    rows.push(["Lookback time", `${n(c.lookbackGyr, 5)} Gyr`], ["Age of the universe at z", `${n(c.ageGyr, 5)} Gyr`], ["Age now", `${n(c.age0Gyr, 5)} Gyr`]);
    if (z > 0) rows.push(["Distance modulus 5 log₁₀(D(L)/10 pc)", fx(5 * Math.log10((c.luminosityMpc * 1e6) / 10), 3)]);
    lines.push({ table: rows, label: "Cosmology" });
    if (z > 0.1) lines.push(`At z = ${trimSig(z)} the Hubble law cz/H₀ is ${pct(Math.abs(c.hubbleMpc / c.comovingMpc - 1), 0)} off the comoving distance: it is a low-redshift (z ≲ 0.1) approximation.`);
    else if (z > 0 && z < 0.01) lines.push("Below z ≈ 0.01 a galaxy's own motion (a few hundred km/s) is a large part of cz, so a distance from z alone is rough.");
    const reading = z === 0 ? `With H₀ = ${trimSig(H0)} km/s/Mpc and Ωm = ${trimSig(Om)}, the universe is ${n(c.age0Gyr, 3)} billion years old.` : `Light from z = ${trimSig(z)} left its source ${n(c.lookbackGyr, 3)} billion years ago, when the universe was ${n(c.ageGyr, 3)} billion years old; the source is now ${n(c.comovingMpc, 4)} Mpc away (comoving), and its luminosity distance is ${n(c.luminosityMpc, 4)} Mpc.`;
    const method = "Method: flat ΛCDM with matter and Λ only (no radiation or neutrinos, astropy FlatLambdaCDM with Tcmb0 = 0), adaptive Simpson quadrature; agrees with astropy 8.0 to 10⁻¹² relative over z = 0.001 to 10. Including radiation (Tcmb0 = 2.7255 K) changes D(C) at z = 1 by about 0.03 %.";
    const zs: number[] = [], dc: number[] = [], dl: number[] = [], da: number[] = [], hub: number[] = [];
    const zMax = Math.max(1, z * 2);
    for (let i = 0; i <= 60; i++) {
      const zz = (zMax * i) / 60;
      const q = cosmology(zz, H0, Om);
      if (!q.ok) continue;
      zs.push(zz); dc.push(q.comovingMpc); dl.push(q.luminosityMpc); da.push(q.angularMpc); hub.push(q.hubbleMpc);
    }
    const fig = cosmologyChartSvg({ z: zs, dc, dl, da, hub }, z, c.luminosityMpc);
    const outputs: EngOutput[] = [
      { key: "dc", label: "Comoving distance", value: c.comovingMpc, unit: "Mpc" },
      { key: "dl", label: "Luminosity distance", value: c.luminosityMpc, unit: "Mpc" },
      { key: "da", label: "Angular-diameter distance", value: c.angularMpc, unit: "Mpc" },
      { key: "lookback", label: "Lookback time", value: c.lookbackGyr, unit: "Gyr" },
      { key: "age", label: "Age at z", value: c.ageGyr, unit: "Gyr" },
    ];
    return finish(reading, lines, method, [plot(fig, "Cosmological distances against redshift", "Luminosity, comoving and angular-diameter distance and the Hubble-law line against redshift, the chosen redshift marked")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 9. Kepler's third law, transits, radial velocity
// ---------------------------------------------------------------------------------------------------------------

const keplerCalc: AstroCalc = {
  id: "astro-kepler",
  name: "Kepler's third law, exoplanet transit depth and duration, radial velocity",
  group: ASTRO_GROUP,
  unitContract: "converts",
  hint:
    "A star (or planet, or binary primary) and a companion: the period from the semi-major axis or the reverse. With the " +
    "two radii, the transit depth, duration (first to fourth and second to third contact) and geometric probability; with " +
    "the companion's mass, the star's radial-velocity semi-amplitude K. Masses in M☉, M⊕, MJ or kg; radii in R☉, R⊕, RJ " +
    "or km. Defaults: a hot Jupiter.",
  fields: [
    { key: "Ms", label: "Central mass (M☉; M⊕, MJ, kg convert)", default: "1 Msun", kind: "text" },
    { key: "Mp", label: "Companion mass (MJ, M⊕, M☉ or kg; 0 = test particle)", default: "1 MJ", kind: "text" },
    { key: "P", label: "Period (days; h, yr convert; blank = solve)", default: "3.5 d", kind: "text" },
    { key: "a", label: "Semi-major axis (au; km, R☉ convert; blank = solve)", default: "", kind: "text" },
    { key: "Rs", label: "Star radius (R☉; blank = no transit)", default: "1 Rsun", kind: "text" },
    { key: "Rp", label: "Planet radius (RJ, R⊕, km)", default: "1 RJ", kind: "text" },
    { key: "b", label: "Impact parameter b (0 = central)", default: "0", kind: "text" },
    { key: "e", label: "Eccentricity", default: "0", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const Ms = u.req("Ms", "kg", MU_SUN / 6.6743e-11, "M☉", "Central mass");
    const Mp = u.req("Mp", "kg", MU_JUPITER / 6.6743e-11, "MJ", "Companion mass");
    const P = u.opt("P", "s", 86400, "d", "Period");
    const a = u.opt("a", "m", AU_M, "au", "Semi-major axis");
    const Rs = u.opt("Rs", "m", R_SUN, "R☉", "Star radius");
    const Rp = Rs !== null ? u.req("Rp", "m", R_JUP_M, "RJ", "Planet radius") : null;
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const b = plainNum(r("b")), e = plainNum(r("e"));
    if (!Number.isFinite(b)) return refuse(`Impact parameter: "${(r("b") ?? "").trim()}" is not a number.`);
    if (!Number.isFinite(e)) return refuse(`Eccentricity: "${(r("e") ?? "").trim()}" is not a number.`);
    const res = keplerTransit({ muStar: Ms * MU_SUN, muPlanet: Mp * MU_JUPITER, aM: a === null ? null : a * AU_M, periodS: P === null ? null : P * 86400, rStarM: Rs === null ? null : Rs * R_SUN, rPlanetM: Rp === null ? null : Rp * R_JUP_M, impact: b, ecc: e });
    if (!res.ok) return refuse(res.error);
    const lines: EngReportLine[] = [];
    lines.push({ math: "P^2 = (4 pi^2 a^3)/(G (M_1 + M_2))", fallback: "P² = 4π²a³/(G(M₁ + M₂))" });
    lines.push({ math: "delta = (R_p/R_s)^2", fallback: "δ = (Rₚ/R★)² (no limb darkening)" });
    lines.push({ math: "T_14 = P/pi arcsin(R_s/a sqrt((1 + k)^2 - b^2)/sin(i))", fallback: "T₁₄ = (P/π)·arcsin((R★/a)·√((1 + k)² − b²)/sin i), b = a·cos i/R★, k = Rₚ/R★" });
    lines.push({ math: "K = ((2 pi G)/P)^(1/3) (M_p sin(i))/((M_s + M_p)^(2/3) sqrt(1 - e^2))", fallback: "K = (2πG/P)^(1/3)·Mₚ sin i/((M★ + Mₚ)^(2/3)·√(1 − e²))" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Period", `${n(res.periodS / 86400, 6)} d (${n(res.periodS / (365.25 * 86400), 6)} yr)`]);
    rows.push(["Semi-major axis", `${n(res.aM / AU_M, 6)} au (${n(res.aM / 1000, 6)} km)`]);
    if (res.depth !== null) {
      rows.push(["Transit depth", `${n(res.depth * 100, 4)} % (${n(res.depth * 1e6, 4)} ppm)`]);
      rows.push(["Geometric transit probability R★/a", pct(res.transitProbability as number, 2)]);
      if (res.inclinationDeg !== null) rows.push(["Inclination for this b", `${fx(res.inclinationDeg, 3)}°`]);
      if (res.t14H !== null) rows.push(["Duration T₁₄ (first to fourth contact)", `${fx(res.t14H, 3)} h`], ["Duration T₂₃ (flat bottom)", `${fx(res.t23H as number, 3)} h`]);
    }
    if (res.rvKms !== null) rows.push(["Radial-velocity semi-amplitude K", `${n(res.rvKms * 1000, 4)} m/s`]);
    lines.push({ table: rows, label: "Orbit" });
    for (const note of res.notes) lines.push(note);
    const bits: string[] = [`the orbit takes ${n(res.periodS / 86400, 4)} days at ${n(res.aM / AU_M, 4)} au`];
    if (res.depth !== null && res.t14H !== null) bits.push(`a transit dims the star by ${n(res.depth * 100, 3)} % for ${fx(res.t14H, 2)} hours`);
    if (res.rvKms !== null) bits.push(`the star wobbles at ${n(res.rvKms * 1000, 3)} m/s`);
    const reading = `For a ${trimSig(Ms)} M☉ central mass and a ${trimSig(Mp)} MJ companion, ${bits.join("; ")}.`;
    const method = "Assumptions: two point masses (Kepler's third law exact for the pair); transits for a circular orbit, a dark planet and a uniform stellar disc (limb darkening rounds the bottom and deepens the centre by up to about 20 %); K for the orbit's sin i (sin i = 1 without a transit). Masses through orbital.ts μ (IAU 2009) and G = 6.6743×10⁻¹¹.";
    const outputs: EngOutput[] = [{ key: "P", label: "Period", value: res.periodS / 86400, unit: "d" }, { key: "a", label: "Semi-major axis", value: res.aM / AU_M, unit: "au" }];
    if (res.depth !== null) outputs.push({ key: "depth", label: "Transit depth", value: res.depth, unit: "" });
    if (res.t14H !== null) outputs.push({ key: "t14", label: "Transit duration", value: res.t14H, unit: "h" });
    if (res.rvKms !== null) outputs.push({ key: "K", label: "RV semi-amplitude", value: res.rvKms * 1000, unit: "m/s" });
    let fig: AnalyzeBlock;
    if (res.depth !== null && res.t14H !== null && res.t14H > 0) fig = plot(transitChartSvg(transitCurve(res.depth, res.t14H, res.t23H as number), res.depth), "The transit light curve (no limb darkening)", "Relative flux against hours from mid-transit, a flat-bottomed dip");
    else {
      const curve: Array<{ x: number; y: number }> = [];
      const mu = Ms * MU_SUN + Mp * MU_JUPITER;
      const ac = res.aM / AU_M;
      for (let i = 0; i <= 60; i++) {
        const aa = ac * Math.pow(10, -1.5 + (3 * i) / 60);
        curve.push({ x: aa, y: (2 * Math.PI * Math.sqrt((aa * AU_M) ** 3 / mu)) / 86400 });
      }
      fig = plot(keplerChartSvg(curve, ac, res.periodS / 86400), "Kepler's third law for this mass", "Period against semi-major axis on log axes, a straight line of slope 3/2, the orbit marked");
    }
    return finish(reading, lines, method, [fig], outputs, u.conversions);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 10. Surface gravity, tides and day length
// ---------------------------------------------------------------------------------------------------------------

const gravityCalc: AstroCalc = {
  id: "astro-gravity",
  name: "Surface gravity, weight, escape speed, day length and tides on the planets and moons",
  group: ASTRO_GROUP,
  unitContract: "converts",
  hint:
    "A planet, Pluto, the Moon or a major moon, and a mass: surface gravity and what that mass weighs there, escape speed, " +
    "the sidereal rotation and the solar day, the year, and the tidal acceleration at the surface from its planet and " +
    "from the Sun (with the Earth's Moon-to-Sun tide ratio).",
  fields: [
    { key: "body", label: "Body", default: "mars", kind: "select", options: WORLDS.map((w) => ({ value: w.id, label: w.parent === "sun" ? w.label : `${w.label} (${w.parent === "earth" ? "Earth" : w.parent[0].toUpperCase() + w.parent.slice(1)})` })) },
    { key: "mass", label: "Mass to weigh (kg; lb converts)", default: "70 kg", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mass = u.req("mass", "kg", 1, "kg", "Mass");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const res = surfaceGravity(r("body") ?? "", mass);
    if (!res.ok) return refuse(res.error);
    const w = res.world;
    const lines: EngReportLine[] = [];
    lines.push({ math: "g = G M/R^2", fallback: "g = GM/R² (equatorial radius, rotation not subtracted, as JPL tabulates it)" });
    lines.push({ math: "v_esc = sqrt(2 G M/R)", fallback: "v(esc) = √(2GM/R) (mean radius)" });
    lines.push({ math: "a_tide = 2 G M R/d^3", fallback: "a(tide) = 2GM·R/d³ (difference across the body's radius)" });
    lines.push({ math: "1/T_sol = 1/T_rot - 1/T_orb", fallback: "1/T(solar) = 1/T(rotation) − 1/T(orbit) (signed; retrograde rotation negative)" });
    const rows: string[][] = [["Quantity", "Value"]];
    rows.push(["Surface gravity", `${n(res.g, 5)} m/s² (${n(res.gRatio, 4)} g)`]);
    rows.push([`Weight of ${trimSig(mass)} kg`, `${n(res.weightN, 5)} N (an Earth scale reads ${n(res.scaleKg, 4)} kg)`]);
    rows.push(["Escape speed", `${n(res.vEsc / 1000, 5)} km/s`]);
    rows.push(["Sidereal rotation", `${n(Math.abs(w.rotationD), 6)} d (${n(Math.abs(w.rotationD) * 24, 6)} h)${w.rotationD < 0 ? ", retrograde" : ""}${w.parent !== "sun" ? ", synchronous" : ""}`]);
    rows.push(["Solar day (noon to noon)", `${n(res.solarDayD, 6)} d (${n(res.solarDayD * 24, 6)} h)`]);
    rows.push(["Year (orbit of the Sun)", `${n(w.yearD, 6)} d (${n(w.yearD / 365.25, 6)} Julian years)`]);
    if (res.tideParent !== null) rows.push([`Tidal acceleration from ${w.parent[0].toUpperCase() + w.parent.slice(1)}`, `${n(res.tideParent, 4)} m/s²`]);
    rows.push(["Tidal acceleration from the Sun", `${n(res.tideSun, 4)} m/s²`]);
    rows.push(["Earth: lunar / solar tide ratio", n(res.earthMoonSunRatio, 4)]);
    lines.push({ table: rows, label: w.label });
    const reading = w.id === "earth"
      ? `On the Earth ${trimSig(mass)} kg weighs ${n(res.weightN, 4)} N; the Moon raises tides ${n(res.earthMoonSunRatio, 3)} times the Sun's, and the escape speed is ${n(res.vEsc / 1000, 4)} km/s.`
      : `On ${w.label} a ${trimSig(mass)} kg mass weighs ${n(res.weightN, 4)} N, what ${n(res.scaleKg, 3)} kg weighs on Earth (${n(res.gRatio, 3)} g); the escape speed is ${n(res.vEsc / 1000, 3)} km/s and a day lasts ${res.solarDayD > 2 ? `${n(res.solarDayD, 4)} Earth days` : `${n(res.solarDayD * 24, 4)} hours`}.`;
    const method = `Sources: ${w.source}; JPL SSD physical parameters and satellite elements (generated into astroData.ts). Surface gravity is GM/R² at the equator without the centrifugal term (Earth's falls by 0.034 m/s² at the equator from rotation); gas giants have no surface, so their "surface" is the 1 bar level. Tides use mean distances.`;
    const bars = WORLDS.map((x) => ({ label: x.label, g: x.mu / (x.radius * x.radius) })).sort((p, q) => q.g - p.g);
    const outputs: EngOutput[] = [
      { key: "g", label: "Surface gravity", value: res.g, unit: "m/s²" },
      { key: "weight", label: "Weight", value: res.weightN, unit: "N" },
      { key: "vesc", label: "Escape speed", value: res.vEsc, unit: "m/s" },
      { key: "day", label: "Solar day", value: res.solarDayD * 24, unit: "h" },
    ];
    return finish(reading, lines, method, [plot(gravityBarsSvg(bars, w.label), "Surface gravity of the planets, Pluto and the major moons", "Horizontal bars of surface gravity for every body, the chosen one in red and the Earth in blue")], outputs, u.conversions);
  },
};

/** The Astronomy & lunar calculators, in dropdown order. */
export const ASTRO_CALCS: AstroCalc[] = [timeCalc, coordsCalc, moonCalc, calendarCalc, ephemCalc, telescopeCalc, starsCalc, cosmoCalc, keplerCalc, gravityCalc];

// Re-exported for tests that check the helpers directly.
export { readDate, readClock, readOffset, localStamp };
