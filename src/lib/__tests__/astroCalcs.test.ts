// The Astronomy & lunar calculators through their own compute(): every tool at its defaults and at every select
// option (ok, a reading first, a figure, finite named outputs, governing math that parses, the display contract), the
// adversarial inputs of the brief (polar sites, dates outside the theories, the leap-second expiry, the 1582 reform,
// negative years, the horizon, RA wrap at 24ʰ, zero and negative parallax), refusals by name, sexagesimal carries,
// unit conversions, and the new orbital.ts BODIES against JPL SSD values independent of the file they came from.

import { ASTRO_CALCS } from "../astroCalcs";
import { fmtDMS, fmtHMS, parseDeg, parseRA, refractionFromTrue, airmassKastenYoung } from "../astroCoords";
import { calendarFromJd, dayOfWeek, jdFromCalendar, scalesFromUTC, LEAP_TABLE_EXPIRY_TEXT, LEAP_TABLE_EXPIRY_MJD } from "../astroTime";
import { apparentPlace, riseTransitSet } from "../astroBodies";
import { keplerTransit, overlapFraction, star, surfaceGravity, WORLDS, telescope } from "../astroPhysics";
import { eclipticStripSvg, hrDiagramSvg } from "../astroCharts";
import { PLANET_PHYS } from "../astroData";
import { bodyById, BODIES } from "../orbital";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const D = Math.PI / 180;
const calc = (id: string) => {
  const c = ASTRO_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const run = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};
const ok = (o: AnalyzeOutput): AnalyzeOutput => {
  if (o.ok === false) throw new Error(o.text);
  return o;
};
const refused = (o: AnalyzeOutput, word: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(word);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
};

describe("every calculator at its defaults", () => {
  test.each(ASTRO_CALCS.map((c) => [c.id]))("%s: ok, reading first, draws, named outputs, math parses, display contract", (id) => {
    const o = ok(run(id));
    const first = (o.blocks ?? [])[0];
    expect(first.kind).toBe("line");
    const reading = (first as { text: string }).text;
    expect(reading).toMatch(/\d/);
    expect(reading).toMatch(/\.$/);
    expect(reading).not.toMatch(/^(Method|Inputs|Units)/);
    expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
    for (const b of o.blocks ?? []) if (b.kind === "plot") expect((b as { svg: string }).svg).toMatch(/<text/);
    expect((o.outputs ?? []).length).toBeGreaterThan(0);
    for (const e of o.outputs ?? []) expect(Number.isFinite(e.value)).toBe(true);
    const maths = (o.blocks ?? []).filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const b of maths) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    expect(o.text).not.toMatch(/—|NaN|Infinity|undefined|e[+-]\d/);
    expect(o.text).not.toMatch(/(^|[\s(])-\d/m);
    expect(o.text).toMatch(/Method|Assumptions|Constants|Sources/);
    expect(calc(id).group).toBe("Astronomy & lunar");
  });
});

describe("every select option computes and draws", () => {
  const rows: Array<[string, string, string]> = [];
  for (const c of ASTRO_CALCS) for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) rows.push([c.id, f.key, o.value]);
  test.each(rows)("%s %s = %s", (id, key, value) => {
    const o = ok(run(id, { [key]: value }));
    expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
    for (const b of o.blocks ?? []) if (b.kind === "plot") expect((b as { svg: string }).svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("review regressions (2026-10-29)", () => {
  test("a typed time with seconds reads as a clock shows it (21:59:45 is 21:59, never 21:00)", () => {
    const o = ok(run("astro-moon", { time: "21:59:45" }));
    expect((o.blocks ?? [])[0]).toMatchObject({ text: expect.stringMatching(/ at 21:59 /) });
    expect(ok(run("astro-ephemeris", { time: "21:59:45" })).text).toMatch(/at 21:59 /);
    expect(ok(run("astro-coords", { time: "21:59:45" })).text).toMatch(/At 21:59 /);
  });
  test("a five-character negative year keeps its minutes in the reading", () => {
    const o = ok(run("astro-time", { date: "-43-03-15", time: "12:34:00" }));
    expect((o.blocks ?? [])[0]).toMatchObject({ text: expect.stringMatching(/^−0043-03-15 12:34 UTC/) });
  });
  test("October 1582 draws without the ten missing days and without NaN", () => {
    const o = ok(run("astro-moon-calendar", { year: "1582", month: "10" }));
    const svg = ((o.blocks ?? []).find((b) => b.kind === "plot") as { svg: string }).svg;
    expect(svg).not.toMatch(/NaN/);
    expect(svg).toMatch(/>4</);
    expect(svg).toMatch(/>15</);
    expect(svg).not.toMatch(/>10</);
  });
  test("Neptune in the 1990s (its magnitude formula has a pre-2000 gap) never breaks the ephemeris", () => {
    for (const date of ["1995-10-15", "1998-04-20", "1991-01-10"]) for (const time of ["20:00", "05:00"]) ok(run("astro-ephemeris", { date, time }));
  });
});

describe("sexagesimal display", () => {
  test("seconds carry: 59.95ˢ becomes the next minute, 23ʰ 59ᵐ 59.96ˢ wraps to 0ʰ", () => {
    expect(fmtHMS(1 + 59 / 60 + 59.95 / 3600, 1)).toBe("2ʰ 00ᵐ 00.0ˢ");
    expect(fmtHMS(23 + 59 / 60 + 59.96 / 3600, 1)).toBe("0ʰ 00ᵐ 00.0ˢ");
    expect(fmtHMS(24, 1)).toBe("0ʰ 00ᵐ 00.0ˢ");
    expect(fmtHMS(-1, 0)).toBe("23ʰ 00ᵐ 00ˢ");
  });
  test("the sign survives below 1° and the arcsecond carries", () => {
    expect(fmtDMS(-0.5)).toBe("−0° 30′ 00″");
    expect(fmtDMS(-(12 + 34 / 60 + 59.6 / 3600))).toBe("−12° 35′ 00″");
    expect(fmtDMS(7.5, 0, true)).toBe("+7° 30′ 00″");
    expect(fmtDMS(-0.00001)).toBe("0° 00′ 00″");
  });
  test("RA input wraps at 24ʰ by refusal, and every written form parses", () => {
    expect(parseRA("12h 34m 56.7s")).toEqual({ hours: 12 + 34 / 60 + 56.7 / 3600 });
    expect(parseRA("12:34:56.7")).toEqual({ hours: 12 + 34 / 60 + 56.7 / 3600 });
    expect((parseRA("188.7°") as { hours: number }).hours).toBeCloseTo(188.7 / 15, 12);
    expect(parseRA("24h")).toHaveProperty("error");
    expect(parseRA("360°")).toHaveProperty("error");
    expect(parseRA("-1h")).toHaveProperty("error");
    expect(parseRA("12h 61m")).toHaveProperty("error");
    expect((parseRA("23h 59m 59.99s") as { hours: number }).hours).toBeLessThan(24);
    expect(parseDeg("−12° 34′ 56″")).toEqual({ deg: -(12 + 34 / 60 + 56 / 3600) });
    expect(parseDeg("-0 30")).toEqual({ deg: -0.5 });
  });
  test("an RA just below 24ʰ is a valid input and gives an altitude", () => {
    ok(run("astro-coords", { ra: "23h 59m 59.99s", dec: "0" }));
    refused(run("astro-coords", { ra: "24h 00m 00s" }), /24ʰ/);
  });
});

describe("calendars: 1582, negative years, weekdays", () => {
  test("1582-10-05 to 14 refused by name in the default calendar; proleptic modes name them", () => {
    refused(run("astro-time", { date: "1582-10-10" }), /does not exist|Gregorian reform/);
    ok(run("astro-time", { date: "1582-10-10", cal: "gregorian" }));
    ok(run("astro-time", { date: "1582-10-10", cal: "julian" }));
    expect((jdFromCalendar(1582, 10, 15) as number) - (jdFromCalendar(1582, 10, 4) as number)).toBe(1);
    expect(dayOfWeek(jdFromCalendar(1582, 10, 4) as number)).toBe(4); // Thursday
    expect(dayOfWeek(jdFromCalendar(1582, 10, 15) as number)).toBe(5); // Friday
  });
  test("negative years: astronomical numbering, the Ides of March −44 (44 BC) is JD 1705425.5 (0h) in the Julian calendar", () => {
    expect(jdFromCalendar(-43, 3, 15)).toBe(1705425.5);
    const o = ok(run("astro-time", { date: "-43-03-15", time: "12:00:00" }));
    expect(o.text).toMatch(/−0043-03-15/);
    expect(o.text).toMatch(/1705426\.0/);
    expect(calendarFromJd(0).year).toBe(-4712);
    refused(run("astro-time", { date: "-5000-01-01" }), /−4712/);
  });
  test("Feb 29 exists in 1900 Julian but not Gregorian; 2000 is a Gregorian leap year", () => {
    expect(jdFromCalendar(1900, 2, 29, "gregorian")).toHaveProperty("error");
    expect(typeof jdFromCalendar(1900, 2, 29, "julian")).toBe("number");
    expect(typeof jdFromCalendar(2000, 2, 29)).toBe("number");
  });
});

describe("the leap-second table and its expiry", () => {
  test(`inside the table TT − UTC is 69.184 s; past ${LEAP_TABLE_EXPIRY_TEXT} the tool says the table expired`, () => {
    expect(scalesFromUTC(jdFromCalendar(2026, 11, 5) as number).deltaT).toBeCloseTo(69.184, 9);
    const past = ok(run("astro-time", { date: "2031-01-01" }));
    expect(past.text).toMatch(/expiry/);
    expect(past.text).toMatch(new RegExp(LEAP_TABLE_EXPIRY_TEXT));
    const before = ok(run("astro-time", { date: "1950-06-01" }));
    expect(before.text).toMatch(/no leap seconds/);
    expect(scalesFromUTC(jdFromCalendar(2016, 12, 31.99999) as number).taiUtc).toBe(36);
    expect(scalesFromUTC(jdFromCalendar(2017, 1, 1) as number).taiUtc).toBe(37);
  });
});

describe("dates outside the theories are refused or flagged", () => {
  test.each(["astro-moon", "astro-ephemeris", "astro-coords"])("%s refuses year 500 and 3500, flags 1850", (id) => {
    refused(run(id, { date: "0500-01-01" }), /outside 1000 to 3000/);
    refused(run(id, { date: "3500-01-01" }), /outside 1000 to 3000/);
    expect(ok(run(id, { date: "1850-01-01" })).text).toMatch(/outside 1900 to 2100/);
  });
  test("the calendar refuses year 999", () => refused(run("astro-moon-calendar", { year: "999" }), /outside 1000 to 3000/));
});

describe("polar sites: a body that never rises or never sets says so", () => {
  const longyearbyen = { lat: 78.22 * D, lon: 15.65 * D, height: 0 };
  test("the Sun at 78° N: up all day at midsummer, down all day at midwinter (engine and pane)", () => {
    const jun = (jdFromCalendar(2026, 6, 21) as number) - 1 / 24;
    const dec = (jdFromCalendar(2026, 12, 21) as number) - 1 / 24;
    expect(riseTransitSet((t) => apparentPlace("sun", t), "sun", longyearbyen, jun, 69.184).circumpolar).toBe("up");
    expect(riseTransitSet((t) => apparentPlace("sun", t), "sun", longyearbyen, dec, 69.184).circumpolar).toBe("down");
    const o = ok(run("astro-ephemeris", { date: "2026-06-21", lat: "78.22", lon: "15.65", tz: "1" }));
    expect(o.text).toMatch(/up all day/);
  });
  test("the Moon at 78° N: within a month there are days it never rises and days it never sets, and the Moon tool says which", () => {
    let up = "", down = "";
    for (let d = 1; d <= 28 && (!up || !down); d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      const o = ok(run("astro-moon", { date, lat: "78.22", lon: "15.65", tz: "1" }));
      if (/stays up all day|above the horizon all day/.test(o.text)) up = date;
      if (/does not rise today|below the horizon all day/.test(o.text)) down = date;
    }
    expect(up).not.toBe("");
    expect(down).not.toBe("");
  });
  test("at mid-latitudes a month has a day with no moonrise, worded as a normal answer", () => {
    let found = false;
    for (let d = 1; d <= 30 && !found; d++) {
      const o = ok(run("astro-moon", { date: `2026-11-${String(d).padStart(2, "0")}` }));
      if (/No moonrise falls on|No moonset falls on/.test(o.text)) found = true;
    }
    expect(found).toBe(true);
  });
  test("a star at the pole: Polaris from 78° N is circumpolar; from 60° S it never rises", () => {
    expect(ok(run("astro-coords", { ra: "2h 31m 49s", dec: "+89° 15′ 51″", lat: "78", lon: "15" })).text).toMatch(/stays above the horizon all day/);
    expect(ok(run("astro-coords", { ra: "2h 31m 49s", dec: "+89° 15′ 51″", lat: "-60", lon: "15" })).text).toMatch(/stays below the horizon all day/);
  });
});

describe("altitude exactly at the horizon", () => {
  test("refraction at 0° true altitude is about 29′ (Sæmundsson), the airmass is finite at the apparent horizon and null below it", () => {
    expect(refractionFromTrue(0) / D * 60).toBeGreaterThan(27);
    expect(refractionFromTrue(0) / D * 60).toBeLessThan(31);
    expect(airmassKastenYoung(0.0001)).toBeGreaterThan(30);
    expect(airmassKastenYoung(0.0001)).toBeLessThan(40);
    expect(airmassKastenYoung(0)).toBeNull();
    expect(airmassKastenYoung(-1)).toBeNull();
  });
  test("an object at the horizon is reported with the refraction caveat", () => {
    // Find a local time when the default star sits within 1° of the horizon and check the wording.
    let hit = false;
    for (let m = 0; m < 24 * 60 && !hit; m += 4) {
      const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const o = ok(run("astro-coords", { time: t }));
      if (/within 1° of the horizon/.test(o.text)) hit = true;
    }
    expect(hit).toBe(true);
  });
});

describe("parallax, distance and stars", () => {
  test("zero and negative parallax are refused by name", () => {
    refused(run("astro-stars", { plx: "0" }), /parallax of 0 mas is zero/);
    refused(run("astro-stars", { plx: "-2" }), /negative/);
    expect(star({ m: 1, M: null, dPc: null, parallaxMas: 0, extinction: 0, L: null, R: null, T: null }).ok).toBe(false);
  });
  test("Sirius: M = 1.43, L ≈ 25 L☉; distance and parallax are not both allowed", () => {
    const o = ok(run("astro-stars"));
    expect(o.text).toMatch(/1\.434/);
    refused(run("astro-stars", { d: "2.64 pc" }), /OR the parallax/);
  });
  test("a distance in light-years converts (8.6 ly = 2.637 pc)", () => {
    const o = ok(run("astro-stars", { plx: "", d: "8.6 ly" }));
    expect(o.text).toMatch(/8\.6 ly = 2\.6367/);
  });
  test("a unit of the wrong quantity is refused", () => refused(run("astro-stars", { plx: "", d: "5 kg" }), /Distance/));
});

describe("refusals by name", () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["astro-moon", { lat: "95" }, /Latitude/],
    ["astro-moon", { lon: "200" }, /Longitude/],
    ["astro-moon", { date: "2026-13-01" }, /month must be 1 to 12/],
    ["astro-moon", { date: "2026-02-30" }, /Day 30/],
    ["astro-moon", { time: "25:00" }, /Local time/],
    ["astro-moon", { tz: "+15" }, /UTC offset/],
    ["astro-moon", { date: "5 Nov 2026" }, /YYYY-MM-DD/],
    ["astro-moon", { height: "20 km" }, /Height/],
    ["astro-coords", { dec: "95" }, /Declination/],
    ["astro-coords", { pres: "2000" }, /pressure/],
    ["astro-coords", { epoch: "5000" }, /Epoch/],
    ["astro-time", { mode: "jd", jd: "abc" }, /Julian Date/],
    ["astro-telescope", { D: "0" }, /aperture/],
    ["astro-telescope", { F: "50 mm" }, /faster than f\/0\.5/],
    ["astro-telescope", { trans: "80" }, /above 1/],
    ["astro-telescope", { D: "200 kg" }, /Aperture/],
    ["astro-cosmology", { z: "-1" }, /redshift/i],
    ["astro-cosmology", { Om: "1.5" }, /Ωm/],
    ["astro-cosmology", { z: "2000" }, /recombination/],
    ["astro-kepler", { a: "1 au" }, /OR the period/],
    ["astro-kepler", { Rp: "2 Rsun" }, /smaller than the star/],
    ["astro-kepler", { e: "1" }, /eccentricity/i],
    ["astro-gravity", { mass: "-3" }, /mass/i],
    ["astro-gravity", { body: "vulcan" }, /Unknown body/],
  ];
  test.each(cases)("%s %j", (id, over, word) => refused(run(id, over), word));
});

describe("values a user can check", () => {
  test("J2000.0 is JD 2451545.0, a Saturday", () => {
    const o = ok(run("astro-time", { date: "2000-01-01", time: "12:00:00" }));
    expect(o.text).toMatch(/2451545\.0/);
    expect(o.text).toMatch(/Saturday/);
  });
  test("telescope: 200 mm f/6 with 25 mm eyepiece = 48×, Dawes 0.58″", () => {
    const t = telescope({ apertureMm: 200, focalMm: 1200, eyepieceMm: 25, afovDeg: 52, pupilMm: 7, eyeLimit: 6, transmission: 1, wavelengthNm: 550, seeingArcsec: 2, pixelUm: 3.76, sensorWmm: 23.5, sensorHmm: 15.6 });
    if (!t.ok) throw new Error(t.error);
    expect(t.magnification).toBe(48);
    expect(t.dawesArcsec).toBeCloseTo(0.58, 3);
    expect(t.pixelScale).toBeCloseTo(0.6463, 3);
    expect(ok(run("astro-telescope", { D: "8 in" })).text).toMatch(/8 in = 203\.2 mm/);
  });
  test("an exit pupil wider than the eye stops the aperture down, and says so", () => {
    expect(ok(run("astro-telescope", { fe: "60 mm" })).text).toMatch(/wider than the eye/);
  });
  test("the Earth's lunar/solar tide ratio is 2.18; Venus's solar day is 116.75 d; the Moon's day is 29.53 d", () => {
    const e = surfaceGravity("earth", 1);
    if (!e.ok) throw new Error(e.error);
    expect(e.earthMoonSunRatio).toBeCloseTo(2.18, 2);
    const v = surfaceGravity("venus", 1);
    if (!v.ok) throw new Error(v.error);
    expect(v.solarDayD).toBeCloseTo(116.75, 1);
    const m = surfaceGravity("moon", 1);
    if (!m.ok) throw new Error(m.error);
    expect(m.solarDayD).toBeCloseTo(29.53, 2);
  });
  test("UTC offsets with minutes are read, and clock displays carry across midnight", () => {
    expect(ok(run("astro-moon", { tz: "+5:30", lon: "77.2", lat: "28.6" })).text).toMatch(/\(UTC\+5:30\)/);
    expect(ok(run("astro-moon", { tz: "−5" })).text).toMatch(/\(UTC−5\)/);
    const o = ok(run("astro-time", { date: "2026-12-31", time: "23:59:59.97" }));
    expect(o.text).toMatch(/2027-01-01 00:00:00\.0/);
    expect(o.text).not.toMatch(/24:00/);
  });
});

describe("orbital.ts BODIES: the five planets added are consistent with JPL SSD (independent of poliastro)", () => {
  test.each(["mercury", "venus", "saturn", "uranus", "neptune"])("%s: μ/R² matches the JPL equatorial gravity to 0.5 %", (id) => {
    const b = bodyById(id)!;
    const jpl = PLANET_PHYS.find((p) => p[0] === id)!;
    expect(Math.abs(b.mu / b.radius ** 2 / jpl[9] - 1)).toBeLessThan(0.005);
    expect(Math.abs(b.radius / 1000 / jpl[1] - 1)).toBeLessThan(1e-3);
  });
  test("BODIES keeps its original five first (the Trajectory dropdowns' order) and every id once", () => {
    expect(BODIES.slice(0, 5).map((b) => b.id)).toEqual(["earth", "moon", "mars", "sun", "jupiter"]);
    expect(new Set(BODIES.map((b) => b.id)).size).toBe(BODIES.length);
  });
  test("every world of the gravity tool has finite gravity and escape speed against JPL's tabulated values", () => {
    for (const w of WORLDS) {
      const g = surfaceGravity(w.id, 1);
      if (!g.ok) throw new Error(g.error);
      const jpl = PLANET_PHYS.find((p) => p[0] === w.id);
      if (jpl) {
        expect(Math.abs(g.g - jpl[9])).toBeLessThan(0.006 * jpl[9] + 0.006);
        expect(Math.abs(g.vEsc / 1000 - jpl[10])).toBeLessThan(0.006 * jpl[10] + 0.006);
      }
    }
  });
});

describe("work is bounded", () => {
  test("the whole-year calendar with a 5-year eclipse search finishes in under 20 s", () => {
    const t0 = Date.now();
    ok(run("astro-moon-calendar", { month: "all", span: "60" }));
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The independent review of 2026-10-29 (findings-astro.md): each finding's own repro, pinned.
// ---------------------------------------------------------------------------------------------------------------

const reading = (o: AnalyzeOutput): string => ((o.blocks ?? [])[0] as { text: string }).text;
const tableText = (o: AnalyzeOutput): string =>
  (o.blocks ?? []).filter((b) => b.kind === "table").map((b) => (b as { rows: string[][] }).rows.map((r) => r.join(" | ")).join("\n")).join("\n");

describe("review blockers", () => {
  test("B2: 2026-11-04 23:59:59.97 UTC reads 2026-11-05 and a Thursday (the weekday of the date shown)", () => {
    const o = ok(run("astro-time", { date: "2026-11-04", time: "23:59:59.97" }));
    expect(reading(o)).toMatch(/^2026-11-05 00:00 UTC .* a Thursday/);
    expect(o.text).not.toMatch(/Wednesday/);
  });
  test("B3: a lowercase s is south, never arcseconds: lat \"33.87 s\" is 33.87° S; Dec \"12.5 s\" is refused", () => {
    const o = ok(run("astro-coords", { lat: "33.87 s", lon: "151.21", tz: "10" }));
    expect(reading(o)).toMatch(/from 33\.87° S/);
    ok(run("astro-moon", { lat: "33.87 s", lon: "151.21", tz: "10" }));
    expect(parseDeg("33.87 s", "lat")).toEqual({ deg: -33.87 });
    expect(run("astro-coords", { dec: "12.5 s" }).ok).toBe(false);
    expect(run("astro-coords", { dec: "12.5 s" }).text).toMatch(/sign instead/);
  });
  test("B4: a grazing transit (b = 1.05, k = 0.1028) reports the overlap, not k²", () => {
    const o = ok(run("astro-kepler", { b: "1.05" }));
    expect(tableText(o)).toMatch(/Transit depth at mid-transit \(disc overlap\) \| 0\.20\d\d %/);
    expect(reading(o)).toMatch(/dims the star by 0\.20\d %/);
    expect(reading(o)).not.toMatch(/1\.06 %/);
    expect(overlapFraction(0, 0.1)).toBeCloseTo(0.01, 12);
    expect(overlapFraction(1.2, 0.1)).toBe(0);
    // Half the planet over the limb at d = 1 for a small planet: about half of k².
    expect(overlapFraction(1, 0.01) / 1e-4).toBeCloseTo(0.5, 2);
  });
});

describe("review majors", () => {
  test("M1: the Moon at 85° N on 2025-06-18 rises twice in the UTC day, and both are reported", () => {
    const site = { lat: 85 * D, lon: 40 * D, height: 0 };
    const day = jdFromCalendar(2025, 6, 18) as number;
    const rs = riseTransitSet((t) => apparentPlace("moon", t), "moon", site, day, 69.184);
    expect(rs.rises.length).toBeGreaterThanOrEqual(2);
    const o = ok(run("astro-moon", { date: "2025-06-18", time: "23:00", tz: "0", lat: "85", lon: "40", height: "0" }));
    expect(tableText(o)).toMatch(/Moonrise \| \d\d:\d\d and \d\d:\d\d/);
    expect(o.text).toMatch(/21:2\d/);
  });
  test("M3: ΔT is continuous across the leap-second table's expiry (was a 6.8 s jump)", () => {
    const exp = LEAP_TABLE_EXPIRY_MJD + 2400000.5;
    const before = scalesFromUTC(exp - 1e-6).deltaT;
    const after = scalesFromUTC(exp + 1e-6).deltaT;
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    expect(scalesFromUTC(exp + 365.25).deltaT - before).toBeLessThan(2);
  });
  test("M4: 23:59:60 is accepted on 2016-12-31 (a leap-second day) and refused by name on 2026-11-05", () => {
    const o = ok(run("astro-time", { date: "2016-12-31", time: "23:59:60.5" }));
    expect(o.text).toMatch(/leap second 23:59:60\.5/);
    const sec59 = ok(run("astro-time", { date: "2016-12-31", time: "23:59:59.5" }));
    const tt = (x: AnalyzeOutput): number => (x.outputs ?? []).find((e) => e.key === "jdTT")!.value;
    expect((tt(o) - tt(sec59)) * 86400).toBeCloseTo(1, 3);
    const bad = run("astro-time", { date: "2026-11-05", time: "23:59:60" });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/2026-11-05 had no leap second/);
    expect(run("astro-moon", { time: "23:59:60" }).ok).toBe(false);
  });
  test("M5: the ecliptic strip keeps Venus at β = 8.4° in view", () => {
    const svg = eclipticStripSvg([{ label: "Venus", lonDeg: 100, latDeg: 8.41 }, { label: "Sun", lonDeg: 90, latDeg: 0 }]);
    expect(svg).toMatch(/>10</);
    expect(svg).not.toMatch(/NaN/);
  });
  test("M6: inconsistent inputs are worded with ×10ⁿ, never e-notation", () => {
    const o = ok(run("astro-stars", { M: "1.43", d: "1e6 pc", plx: "" }));
    expect(o.text).toMatch(/inconsistent/);
    expect(o.text).not.toMatch(/\de[+-]\d/);
    const s = star({ m: null, M: null, dPc: null, parallaxMas: null, extinction: 0, L: 1e9, R: 1, T: 5772 });
    if (!s.ok) throw new Error(s.error);
    expect(s.notes.join(" ")).not.toMatch(/\de[+-]\d/);
  });
  test("M7: hemisphere letters and DMS with a letter: \"33°52′S\" and \"77.03 W\"", () => {
    const o = ok(run("astro-coords", { lat: "33°52′S", lon: "151°12′ E", tz: "10" }));
    expect(o.text).toMatch(/33\.87° S, 151\.20° E/);
    expect(ok(run("astro-coords", { lon: "77.03 W" })).text).toMatch(/77\.03° W/);
    expect(parseDeg("N 40.5", "lat")).toEqual({ deg: 40.5 });
    expect(parseDeg("-33 S", "lat")).toHaveProperty("error");
    expect(parseDeg("40 E", "lat")).toHaveProperty("error");
  });
});

describe("review minors", () => {
  test("1: the eclipse table is labelled once, \"from November 2026\" / \"from January 2026\"", () => {
    expect(tableText(ok(run("astro-moon-calendar")))).not.toMatch(/2026 2026/);
    const o = ok(run("astro-moon-calendar", { month: "all", span: "60" }));
    expect(o.text).toMatch(/Eclipses from January 2026 for 60 months/);
    expect(o.text).not.toMatch(/2026 2026/);
  });
  test("2: seeing written 2\" is two arcseconds", () => {
    const o = ok(run("astro-telescope", { seeing: '2"' }));
    expect(o.text).toMatch(/3\.1 pixels across the seeing/);
    expect(ok(run("astro-telescope", { target: "31'" })).text).toMatch(/target fits/);
  });
  test("3: elongation says east (evening) or west (morning)", () => {
    expect(tableText(ok(run("astro-ephemeris")))).toMatch(/° (E \(evening\)|W \(morning\))/);
  });
  test("4: 1582-10-15 is day 278 of 1582 (ten days were dropped)", () => {
    expect(ok(run("astro-time", { date: "1582-10-15" })).text).toMatch(/Day of the year\s+278\b/);
    expect(ok(run("astro-time", { date: "2026-11-05" })).text).toMatch(/Day of the year\s+309\b/);
  });
  test("5: \"On the Moon\"", () => expect(reading(ok(run("astro-gravity", { body: "moon" })))).toMatch(/^On the Moon /));
  test("6: b = 1.2 (clear of the disc) lists no depth or probability, and K uses the sin i that b fixes", () => {
    const o = ok(run("astro-kepler", { b: "1.2" }));
    expect(tableText(o)).not.toMatch(/Transit depth|probability/);
    const r = keplerTransit({ muStar: 1.32712442099e20, muPlanet: 1.2671276253e17, aM: null, periodS: 3.5 * 86400, rStarM: 6.957e8, rPlanetM: 7.1492e7, impact: 1.2, ecc: 0 });
    const r0 = keplerTransit({ muStar: 1.32712442099e20, muPlanet: 1.2671276253e17, aM: null, periodS: 3.5 * 86400, rStarM: null, rPlanetM: null, impact: 0, ecc: 0 });
    if (!r.ok || !r0.ok) throw new Error("kepler");
    expect(r.rvKms as number).toBeLessThan(r0.rvKms as number);
    expect((r.rvKms as number) / (r0.rvKms as number)).toBeCloseTo(Math.sin(((r.inclinationDeg as number) * Math.PI) / 180), 12);
  });
  test("7: at the South Pole every direction is north", () => {
    const o = ok(run("astro-coords", { lat: "-90", lon: "0", dec: "-60", ra: "6h" }));
    expect(reading(o)).toMatch(/above the north horizon/);
    expect(reading(o)).not.toMatch(/south/);
  });
  test("8: figure legends are short, all six radius lines are labelled, Venus is not the Sun's colour", () => {
    const hr = hrDiagramSvg(9940, 25, "this star");
    for (const R of ["0.01", "0.1", "1", "10", "100", "1000"]) expect(hr).toContain(`R = ${R} R☉`);
    const svg = eclipticStripSvg([{ label: "Sun", lonDeg: 0, latDeg: 0 }, { label: "Venus", lonDeg: 10, latDeg: 1 }]);
    expect(svg).not.toMatch(/#d4a017/i);
    expect(ok(run("astro-cosmology")).blocks!.find((b) => b.kind === "plot")!.svg).not.toMatch(/…|\.\.\./);
  });
  test("9: Neptune's μ is the planet alone (JPL SSD), and the escape speed names its radius", () => {
    expect(bodyById("neptune")!.mu).toBe(6.83509997e15);
    const t = tableText(ok(run("astro-gravity", { body: "saturn" })));
    expect(t).toMatch(/Escape speed \(mean radius, as JPL tabulates\) \| 36\.09/);
    expect(t).toMatch(/Escape speed from the equator \(the Trajectory tools' radius\) \| 35\.47/);
  });
  test("10: a transit earlier in the evening is past tense", () => {
    expect(reading(ok(run("astro-coords", { ra: "20h", dec: "+10", time: "23:30" })))).toMatch(/it transited at/);
    expect(reading(ok(run("astro-coords")))).toMatch(/it transited at 03:06/);
    expect(reading(ok(run("astro-coords", { ra: "1h 05m" })))).toMatch(/it transits at 22:/);
  });
  test("11: the whole-year reading summarises (counts, the first full Moon, supermoons) instead of listing 26 dates", () => {
    const r = reading(ok(run("astro-moon-calendar", { month: "all" })));
    expect(r).toMatch(/^In 2026 the Moon is full 1[23] times and new 1[23] times/);
    expect(r.length).toBeLessThan(320);
  });
  test("12: December 3000 does not list eclipses in 3001", () => {
    const o = ok(run("astro-moon-calendar", { year: "3000", month: "12", span: "24" }));
    expect(tableText(o)).not.toMatch(/3001-/);
    expect(o.text).toMatch(/to the end of 3000/);
  });
});
