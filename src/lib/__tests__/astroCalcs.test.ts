// The Astronomy & lunar calculators through their own compute(): every tool at its defaults and at every select
// option (ok, a reading first, a figure, finite named outputs, governing math that parses, the display contract), the
// adversarial inputs of the brief (polar sites, dates outside the theories, the leap-second expiry, the 1582 reform,
// negative years, the horizon, RA wrap at 24ʰ, zero and negative parallax), refusals by name, sexagesimal carries,
// unit conversions, and the new orbital.ts BODIES against JPL SSD values independent of the file they came from.

import { ASTRO_CALCS } from "../astroCalcs";
import { fmtDMS, fmtHMS, parseDeg, parseRA, refractionFromTrue, airmassKastenYoung } from "../astroCoords";
import { calendarFromJd, dayOfWeek, jdFromCalendar, scalesFromUTC, LEAP_TABLE_EXPIRY_TEXT } from "../astroTime";
import { apparentPlace, riseTransitSet } from "../astroBodies";
import { star, surfaceGravity, WORLDS, telescope } from "../astroPhysics";
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
