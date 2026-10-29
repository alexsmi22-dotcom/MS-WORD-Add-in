// The Astronomy & lunar engines against independent oracles: JPL DE421 (1900–2049) and DE440s (2050–2100) through
// skyfield 1.55, erfa (pyerfa) and astropy 8.0.2, recorded by scripts/astro-oracle.py into fixtures/astro-oracle.json
// (run it with the oracle venv's python -I from outside the repo). Every engine is fed the oracle's own TT (and UT1),
// so a ΔT difference cannot pose as a theory error.
//
// THIS IS ALSO THE CHECKSUM OF THE GENERATED TABLES (astroData.ts): a slip in any Meeus 47.A/47.B or 22.A row, or in
// any kept VSOP87 term, moves a position at some of these 400 dates by more than the tolerances below.
//
// Measured maxima when written (2026-10-28), tolerances a little above them:
//   Moon (Meeus ch. 47): longitude 17.1″, latitude 4.5″, distance 44 km;  Sun (VSOP87 trunc.): 1.7″, 715 km
//   planets: RA·cos δ ≤ 3.3″, Dec ≤ 1.7″; magnitudes ≤ 0.007 (Venus 0.031; Mercury 0.134: skyfield takes the
//   barycentre for the Sun in the phase angle); GMST 10⁻⁶″, GAST 0.014″, nutation 0.002″, precession 5×10⁻⁷″
//   rise/set/transit (Sun and Moon, 6 sites incl. 78° N and 78° S, 1950–2050): 4.6 s; phases: 19 s;
//   lunar eclipses 1900–2049: all 343 found, umbral magnitude 0.0033, greatest-eclipse time 0.3 min;
//   solar γ 0.0009; galactic 0.03″; star alt/az 0.3″; ΔT (Espenak–Meeus) vs observed 1.1 s before 2005, 5.0 s after;
//   illuminated fraction 3×10⁻⁵, bright-limb angle 0.008°; perigee/apogee 7 min and 7 km.

import * as fs from "fs";
import * as path from "path";
import { calendarFromJd, deltaTEspenakMeeus, gast, gmst, jdFromCalendar, matVec, meanObliquity, nutation, precessionMatrix, taiMinusUtc } from "../astroTime";
import { EQ_TO_GAL, separation, sph, vec } from "../astroCoords";
import { apparentPlace, brightLimbAngle, moonMeeus, planetMagnitude, PLANETS, riseTransitSet, starPlace, topocentric, type BodyId } from "../astroBodies";
import { apsidesBetween, libration, lunarEclipseAt, phasesBetween, solarEclipseAt } from "../astroMoon";
import { cosmology } from "../astroPhysics";

const O = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "astro-oracle.json"), "utf8"));
const D = Math.PI / 180;
const wrap = (x: number): number => ((((x + 540) % 360) + 360) % 360) - 180;
const wrapRad = (x: number): number => ((((x + 3 * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const maxAbs = (xs: number[]): number => xs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("the fixture is what this test expects", () => {
  test("it spans 1900–2100 with hundreds of dates", () => {
    expect(O.moon.length).toBe(400);
    const jds = O.moon.map((r: { jd_tt: number }) => r.jd_tt);
    expect(Math.min(...jds)).toBeLessThan(2416000);
    expect(Math.max(...jds)).toBeGreaterThan(2487000);
  });
});

describe("Moon, Meeus ch. 47 (generated tables 47.A/47.B) against DE421/DE440s", () => {
  const dl: number[] = [], db: number[] = [], dr: number[] = [];
  for (const r of O.moon) {
    const p = apparentPlace("moon", r.jd_tt);
    dl.push(wrap(p.eclLon / D - r.lon) * 3600 * Math.cos(r.lat * D));
    db.push((p.eclLat / D - r.lat) * 3600);
    dr.push(p.distKm - r.dist_km);
  }
  test("longitude within 18″ at all 400 dates (Meeus claims about 10″ typical)", () => expect(maxAbs(dl)).toBeLessThan(18));
  test("95 % of longitudes within 10″", () => expect(dl.filter((x) => Math.abs(x) < 10).length / dl.length).toBeGreaterThan(0.95));
  test("latitude within 5″", () => expect(maxAbs(db)).toBeLessThan(5));
  test("distance within 50 km", () => expect(maxAbs(dr)).toBeLessThan(50));
  test("Meeus example 47.a (1992-04-12 0h TD) reproduces the book", () => {
    const m = moonMeeus(2448724.5);
    expect(m.lon / D).toBeCloseTo(133.162655, 5);
    expect(m.lat / D).toBeCloseTo(-3.229126, 5);
    expect(m.distKm).toBeCloseTo(368409.7, 0);
  });
  test("Meeus example 53.a optical libration: l′ = −1.206°, b′ = +4.194°", () => {
    const l = libration(2448724.5);
    expect(l.l).toBeCloseTo(-1.206, 2);
    expect(l.b).toBeCloseTo(4.194, 2);
  });
});

describe("Sun and planets, truncated VSOP87 (generated) against DE421/DE440s", () => {
  test("Sun: apparent longitude within 2.5″, latitude 1″, distance 1000 km", () => {
    const dl: number[] = [], db: number[] = [], dr: number[] = [];
    for (const r of O.sun) {
      const p = apparentPlace("sun", r.jd_tt);
      dl.push(wrap(p.eclLon / D - r.lon) * 3600);
      db.push((p.eclLat / D - r.lat) * 3600);
      dr.push(p.distKm - r.dist_km);
    }
    expect(maxAbs(dl)).toBeLessThan(2.5);
    expect(maxAbs(db)).toBeLessThan(1);
    expect(maxAbs(dr)).toBeLessThan(1000);
  });
  test.each(PLANETS.map((p) => [p]))("%s: apparent RA and Dec within 4″, distance 3×10⁻⁵, magnitude", (k) => {
    const dra: number[] = [], ddec: number[] = [], dd: number[] = [], dm: number[] = [];
    for (const row of O.planets) {
      const r = row[k];
      const p = apparentPlace(k as BodyId, row.jd_tt);
      dra.push(wrap(p.ra / D - r.ra) * 3600 * Math.cos(r.dec * D));
      ddec.push((p.dec / D - r.dec) * 3600);
      dd.push((p.distKm - r.dist_km) / r.dist_km);
      const m = planetMagnitude(k as Exclude<BodyId, "sun" | "moon">, row.jd_tt);
      if (r.mag !== null && m !== null) dm.push(m - r.mag);
    }
    expect(maxAbs(dra)).toBeLessThan(4);
    expect(maxAbs(ddec)).toBeLessThan(4);
    expect(maxAbs(dd)).toBeLessThan(3e-5);
    expect(dm.length).toBeGreaterThan(50);
    expect(maxAbs(dm)).toBeLessThan(k === "mercury" ? 0.15 : k === "venus" ? 0.04 : 0.02);
  });
});

describe("time scales against erfa and skyfield", () => {
  test("GMST (IAU 2006) to 10⁻⁴″, GAST to 0.02″, mean obliquity exact, nutation (22.A) to 0.003″, precession to 10⁻⁵″", () => {
    for (const r of O.times) {
      expect(Math.abs(wrapRad(gmst(r.ut1, r.tt) - r.gmst)) / D * 3600).toBeLessThan(1e-4);
      expect(Math.abs(wrapRad(gast(r.ut1, r.tt) - r.gast)) / D * 3600).toBeLessThan(0.02);
      expect(Math.abs(meanObliquity(r.tt) - r.eps0) / D * 3600).toBeLessThan(1e-6);
      const n = nutation(r.tt);
      expect(Math.abs(n.dpsi - r.dpsi) / D * 3600).toBeLessThan(0.003);
      expect(Math.abs(n.deps - r.deps) / D * 3600).toBeLessThan(0.003);
      const P = precessionMatrix(r.tt);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(Math.abs(P[i][j] - r.rp[i][j]) / D * 3600).toBeLessThan(1e-5);
    }
  });
  test("Julian Dates, Julian calendar before 1582-10-15 (skyfield julian_calendar_cutoff), both directions", () => {
    for (const c of O.calendar) {
      expect(jdFromCalendar(c.y, c.m, c.d + c.h / 24, "auto")).toBeCloseTo(c.jd, 6);
      const back = calendarFromJd(c.jd);
      expect([back.year, back.month]).toEqual([c.y, c.m]);
      expect(back.day).toBeCloseTo(c.d + c.h / 24, 6);
    }
  });
  test("TAI − UTC equals erfa.dat at 220 dates 1972–2026", () => {
    for (const r of O.dat) expect(taiMinusUtc(jdFromCalendar(r.y, r.m, r.d, "gregorian") as number)).toBe(r.dat);
  });
  test("ΔT polynomials against the observed ΔT: 1.5 s before 2005, 6 s 2005–2024 (the 2006 extrapolation)", () => {
    for (const r of O.deltat) expect(Math.abs(deltaTEspenakMeeus(r.year + 0.5) - r.dt)).toBeLessThan(r.year < 2005 ? 1.5 : 6);
  });
  test("ΔT branches join without a jump of more than a few seconds (a transcription slip would show here)", () => {
    for (const y of [-500, 500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 2005, 2050, 2150])
      expect(Math.abs(deltaTEspenakMeeus(y - 1e-6) - deltaTEspenakMeeus(y))).toBeLessThan(y <= 500 ? 25 : 4);
  });
  test("ΔT at NASA's tabulated historical values (−500: 17190 s, 0: 10580, 1000: 1570, 1600: 120, 1800: 14)", () => {
    for (const [y, v, tol] of [[-500, 17190, 50], [0, 10580, 30], [1000, 1570, 20], [1600, 120, 2], [1800, 14, 1]])
      expect(Math.abs(deltaTEspenakMeeus(y) - v)).toBeLessThan(tol);
  });
});

describe("coordinates", () => {
  test("ICRS → galactic within 0.05″ of astropy at 40 random points", () => {
    for (const r of O.galactic) {
      const s = sph(matVec(EQ_TO_GAL, vec(r.ra * D, r.dec * D)));
      expect(separation(s.lon, s.lat, r.l * D, r.b * D) / D * 3600).toBeLessThan(0.05);
    }
  });
  test("a star's airless altitude and azimuth within 0.5″ of skyfield at 6 sites", () => {
    for (const r of O.stars) {
      const site = { lat: r.lat * D, lon: r.lon * D, height: 0 };
      const tp = topocentric(starPlace(r.ra * D, r.dec * D, r.jd_tt), site, r.ut1, r.jd_tt);
      expect(Math.abs(tp.alt / D - r.alt) * 3600).toBeLessThan(0.5);
      expect(Math.abs(wrap(tp.az / D - r.az)) * 3600 * Math.cos(r.alt * D)).toBeLessThan(0.5);
    }
  });
});

describe("rise, transit and set of the Sun and Moon against skyfield (6 sites, polar included, 1950–2050)", () => {
  let worst = 0;
  const misses: string[] = [];
  for (const r of O.riseset) {
    const site = { lat: r.lat * D, lon: r.lon * D, height: 0 };
    const res = riseTransitSet((tt) => apparentPlace(r.body, tt), r.body, site, r.ut1_0, r.dt);
    for (const k of ["rise", "set", "transit"] as const) {
      const ora = (r[k] as Array<{ ut1: number; real?: boolean }>).filter((e) => e.real !== false);
      const mine = res[k];
      if (!ora.length && mine === null) continue;
      if (!ora.length || mine === null) {
        misses.push(`${r.site} ${r.body} ${r.ut1_0} ${k}`);
        continue;
      }
      worst = Math.max(worst, Math.min(...ora.map((e) => Math.abs(e.ut1 - mine) * 86400)));
    }
  }
  test("every event skyfield finds is found, and none it does not", () => expect(misses).toEqual([]));
  test("within 10 s", () => expect(worst).toBeLessThan(10));
});

describe("phases and eclipses against skyfield", () => {
  test("240 principal phases (1900, 2000, 2026, 2050, 2100) within 25 s", () => {
    for (const p of O.phases) {
      const ev = phasesBetween(p.tt - 0.6, p.tt + 0.6).find((e) => e.phase === p.phase);
      expect(ev).toBeDefined();
      expect(Math.abs((ev as { jdTT: number }).jdTT - p.tt) * 86400).toBeLessThan(25);
    }
  });
  test("all 343 lunar eclipses 1900–2049: umbral and penumbral magnitudes within 0.005, time within 1 min, type agreeing away from the 1.0 / 0.0 boundaries", () => {
    const TY = ["penumbral", "partial", "total"];
    expect(O.lunar_eclipses.length).toBe(343);
    for (const e of O.lunar_eclipses) {
      const m = lunarEclipseAt(e.tt);
      expect(m).not.toBeNull();
      if (!m) continue;
      expect(Math.abs(m.umbralMag - e.umag)).toBeLessThan(0.005);
      expect(Math.abs(m.penumbralMag - e.pmag)).toBeLessThan(0.005);
      expect(Math.abs(m.jdTT - e.tt) * 1440).toBeLessThan(1);
      if (Math.abs(e.umag) > 0.005 && Math.abs(e.umag - 1) > 0.005) expect(m.type).toBe(TY[e.type]);
    }
  });
  test("solar eclipse γ within 0.002 of DE421 at every New Moon with |γ| < 1.5, 1990–2049", () => {
    for (const s of O.solar_gamma) {
      if (Math.abs(s.gamma) > 1.5) continue;
      const m = solarEclipseAt(s.new_tt);
      expect(m).not.toBeNull();
      expect(Math.abs((m as { gamma: number }).gamma - s.gamma)).toBeLessThan(0.002);
    }
  });
  test("published eclipses: 2017-08-21 and 2024-04-08 total, 2023-10-14 annular, 2023-04-20 hybrid", () => {
    const at = (y: number, mo: number, d: number) => solarEclipseAt(phasesBetween((jdFromCalendar(y, mo, d) as number) - 1, (jdFromCalendar(y, mo, d) as number) + 1).find((e) => e.phase === 0)!.jdTT)!;
    expect(at(2017, 8, 21).type).toBe("total");
    expect(at(2024, 4, 8).type).toBe("total");
    expect(at(2024, 4, 8).magnitude).toBeCloseTo(1.0566, 2);
    expect(at(2023, 10, 14).type).toBe("annular");
    expect(at(2023, 4, 20).type).toBe("hybrid");
  });
});

describe("the Moon's lit fraction, bright limb and apsides against skyfield", () => {
  test("illuminated fraction within 10⁻⁴ and bright-limb position angle within 0.05° at 100 dates", () => {
    for (const r of O.illum) {
      const m = apparentPlace("moon", r.jd_tt), s = apparentPlace("sun", r.jd_tt);
      expect(Math.abs((1 + Math.cos(m.phaseAngle)) / 2 - r.k)).toBeLessThan(1e-4);
      expect(Math.abs(wrap(brightLimbAngle(m, s) / D - r.chi))).toBeLessThan(0.05);
    }
  });
  test("all 133 perigees and apogees (1960–61, 2026–28) found within 15 minutes and 10 km of DE421", () => {
    expect(O.apsides.length).toBe(133);
    for (const a of O.apsides) {
      const near = apsidesBetween(a.tt - 3, a.tt + 3).filter((x) => x.kind === a.kind);
      expect(near.length).toBeGreaterThan(0);
      const f = near.reduce((p, q) => (Math.abs(q.jdTT - a.tt) < Math.abs(p.jdTT - a.tt) ? q : p));
      expect(Math.abs(f.jdTT - a.tt) * 1440).toBeLessThan(15);
      expect(Math.abs(f.distKm - a.km)).toBeLessThan(10);
    }
  });
});

describe("review M2: cosmology with radiation against astropy FlatLambdaCDM(67.7, 0.31, Tcmb0 = 2.7255, Neff 3.04)", () => {
  test("comoving distance, lookback time and age at z = 0.01, 1, 5, 100 and 1100", () => {
    expect(O.cosmo_rad.map((c: { z: number }) => c.z)).toEqual([0.01, 1, 5, 100, 1100]);
    for (const c of O.cosmo_rad) {
      const r = cosmology(c.z, 67.7, 0.31);
      if (!r.ok) throw new Error(r.error);
      const tol = c.z >= 1000 ? 2e-6 : 1e-9;
      expect(Math.abs(r.comovingMpc / c.dc - 1)).toBeLessThan(tol);
      expect(Math.abs(r.lookbackGyr / c.lookback - 1)).toBeLessThan(tol);
      expect(Math.abs(r.ageGyr / c.age - 1)).toBeLessThan(tol);
    }
    const r0 = cosmology(0, 67.7, 0.31);
    if (!r0.ok) throw new Error(r0.error);
    expect(Math.abs(r0.age0Gyr / O.cosmo_rad_age0 - 1)).toBeLessThan(1e-9);
  });
  test("the reviewer's repro: the age at z = 1100 is no longer 29 % high", () => {
    const r = cosmology(1100, 67.7, 0.31);
    if (!r.ok) throw new Error(r.error);
    expect(Math.abs(r.ageGyr / O.cosmo_rad[4].age - 1)).toBeLessThan(1e-5);
  });
});

describe("review B1: solar eclipses against NASA's Five Millennium Canon, 2001–2100 (224 eclipses)", () => {
  const N = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "nasa-solar-eclipses.json"), "utf8"));
  const TYPE: Record<string, string> = { P: "partial", A: "annular", T: "total", H: "hybrid" };
  const at = (r: { y: number; m: number; d: number; td: number }) => {
    const jd = jdFromCalendar(r.y, r.m, r.d + r.td / 24) as number;
    return { jd, e: solarEclipseAt(phasesBetween(jd - 1, jd + 1).find((x) => x.phase === 0)!.jdTT) };
  };
  test("every type agrees; magnitude within 0.005, γ within 0.002, greatest eclipse within 1.5 min", () => {
    expect(N.rows.length).toBe(224);
    for (const r of N.rows) {
      const { jd, e } = at(r);
      expect(e).not.toBeNull();
      if (!e) continue;
      expect({ date: `${r.y}-${r.m}-${r.d}`, type: e.type }).toEqual({ date: `${r.y}-${r.m}-${r.d}`, type: TYPE[r.type[0]] });
      expect(Math.abs(e.magnitude - r.mag)).toBeLessThan(0.005);
      expect(Math.abs(e.gamma - r.gamma)).toBeLessThan(0.002);
      expect(Math.abs(e.jdTT - jd) * 1440).toBeLessThan(1.5);
    }
  });
  test("the reviewer's repros: 2014-04-29 non-central annular below 1, 2043-04-09 non-central total above 1, 2025-03-29 0.938, 2025-09-21 0.855", () => {
    const pick = (y: number, m: number, d: number) => at(N.rows.find((r: { y: number; m: number; d: number }) => r.y === y && r.m === m && r.d === d)).e!;
    expect(pick(2014, 4, 29).type).toBe("annular");
    expect(pick(2014, 4, 29).magnitude).toBeLessThan(1);
    expect(pick(2014, 4, 29).magnitude).toBeCloseTo(0.9868, 2);
    expect(pick(2043, 4, 9).type).toBe("total");
    expect(pick(2043, 4, 9).magnitude).toBeGreaterThan(1);
    expect(pick(2043, 4, 9).magnitude).toBeCloseTo(1.0095, 2);
    expect(pick(2025, 3, 29).magnitude).toBeCloseTo(0.9376, 2);
    expect(pick(2025, 9, 21).magnitude).toBeCloseTo(0.855, 2);
  });
});

describe("cosmology against astropy FlatLambdaCDM(67.7, 0.31, Tcmb0 = 0)", () => {
  test("distances, lookback time and age to 10⁻⁹ relative", () => {
    for (const c of O.cosmo) {
      const r = cosmology(c.z, 67.7, 0.31, 0); // Tcmb0 = 0: matter and Λ only, as this fixture
      if (!r.ok) throw new Error(r.error);
      expect(Math.abs(r.comovingMpc / c.dc - 1)).toBeLessThan(1e-9);
      expect(Math.abs(r.luminosityMpc / c.dl - 1)).toBeLessThan(1e-9);
      expect(Math.abs(r.angularMpc / c.da - 1)).toBeLessThan(1e-9);
      expect(Math.abs(r.lookbackGyr / c.lookback - 1)).toBeLessThan(1e-9);
      expect(Math.abs(r.ageGyr / c.age - 1)).toBeLessThan(1e-9);
    }
  });
});
