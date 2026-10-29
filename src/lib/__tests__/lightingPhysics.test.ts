// Oracle tests for lightingPhysics.ts (Engineering ▸ Lighting & rendering). Every expected number below comes from
// src/lib/__tests__/fixtures/lighting-oracle.json, written by scripts/lighting-oracle.py (pvlib 0.16.1 NREL SPA,
// numpy/scipy integration written independently of the TypeScript, published formulas), or is a closed form worked
// in the comment beside it.
import * as fs from "fs";
import * as path from "path";
import {
  ACES_CLIP,
  acesFitted,
  atmosphere,
  brdf,
  deltaT,
  directionalAlbedo,
  discAsPoint,
  discIlluminance,
  distanceForStops,
  dynamicRangeStops,
  f0FromIor,
  falloff,
  falloffStops,
  ggxD,
  hable,
  hemiVariance,
  henyeyGreenstein,
  inverseTone,
  isErr,
  kastenYoung,
  mcRelativeError,
  rayleighTau,
  reinhard,
  reinhardExt,
  samplesForNoise,
  shadowOf,
  softShadow,
  sunAt,
  sunEvents,
  sunPath,
  type LocalDay,
} from "../lightingPhysics";

const O = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lighting-oracle.json"), "utf8"));

const dayOf = (date: string, offset: number): LocalDay => {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y, month: m, day: d, utcOffset: offset };
};
const minutesOf = (t: string): number => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 60 + m + s / 60;
};
const angDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

describe("sun position against NREL SPA (pvlib 0.16.1 nrel_numpy)", () => {
  const rows: Array<{ site: string; lat: number; lon: number; offset: number; date: string; time: string; elevation: number; apparent_elevation: number; azimuth: number; eot: number }> = O.sun_positions;
  test("the fixture is not empty", () => expect(rows.length).toBeGreaterThan(300));
  test("geometric elevation within 0.01°, apparent within 0.012°, azimuth arc within 0.01° (above −5°), EoT within 3 s", () => {
    let eMax = 0;
    let aMax = 0;
    let zMax = 0;
    let tMax = 0;
    for (const r of rows) {
      const p = sunAt(r.lat, r.lon, dayOf(r.date, r.offset), minutesOf(r.time));
      if (isErr(p)) throw new Error(p.error);
      eMax = Math.max(eMax, Math.abs(p.elevation - r.elevation));
      aMax = Math.max(aMax, Math.abs(p.apparentElevation - r.apparent_elevation));
      // Azimuth is ill-conditioned near the zenith (a 0.007° position error is 0.07° of azimuth at 84°), so it is
      // compared as the arc it subtends on the sky, Δaz·cos(elevation), with the sun above −5°.
      if (r.elevation > -5) zMax = Math.max(zMax, angDiff(p.azimuth, r.azimuth) * Math.cos((r.elevation * Math.PI) / 180));
      tMax = Math.max(tMax, Math.abs(p.eotMinutes - r.eot));
    }
    // eslint-disable-next-line no-console
    console.log(`sun vs SPA: elevation ${eMax.toFixed(5)}°, apparent ${aMax.toFixed(5)}°, azimuth ${zMax.toFixed(5)}°, EoT ${(tMax * 60).toFixed(2)} s`);
    expect(eMax).toBeLessThan(0.01);
    expect(aMax).toBeLessThan(0.012);
    expect(zMax).toBeLessThan(0.01);
    expect(tMax * 60).toBeLessThan(3);
  });
  test("ΔT follows the Espenak–Meeus fit (about 69–75 s in the 2020s)", () => {
    expect(deltaT(2026, 6)).toBeGreaterThan(69);
    expect(deltaT(2026, 6)).toBeLessThan(76);
  });
});

describe("sunrise, sunset, transit, golden and blue hour against SPA", () => {
  const rows: Array<{ site: string; lat: number; lon: number; offset: number; date: string; sunrise: number | null; sunset: number | null; transit: number; max_elevation: number; min_elevation: number; crossings: Record<string, [number | null, number | null]> }> = O.sun_events;
  test("transit within 6 s; rise and set within 30 s of brentq on SPA's elevation at −0.8333°; polar day and night where SPA has no sunrise", () => {
    let tr = 0;
    let rs = 0;
    let spaMid = 0;
    let spaHigh = 0;
    for (const r of rows) {
      const ev = sunEvents(r.lat, r.lon, dayOf(r.date, r.offset));
      if (isErr(ev)) throw new Error(ev.error);
      tr = Math.max(tr, Math.abs(ev.transit - r.transit));
      if (r.sunrise === null || r.sunset === null) {
        expect({ site: r.site, date: r.date, daylight: ev.daylight }).toEqual({ site: r.site, date: r.date, daylight: r.max_elevation < -0.8333 ? "polar night" : "polar day" });
        expect(ev.sunrise).toBeNull();
        continue;
      }
      expect(ev.sunrise).not.toBeNull();
      const [up, down] = r.crossings["-0.8333"];
      rs = Math.max(rs, Math.abs((ev.sunrise as number) - (up as number)), Math.abs((ev.sunset as number) - (down as number)));
      // SPA's own rise/set (A.2 of Reda & Andreas) interpolates the sun's coordinates once from 0 h UT; it drifts from
      // the true crossing where the sun rises slowly. Measured, not assumed: held to its own looser bounds.
      const dSpa = Math.max(Math.abs((ev.sunrise as number) - r.sunrise), Math.abs((ev.sunset as number) - r.sunset));
      if (Math.abs(r.lat) < 60) spaMid = Math.max(spaMid, dSpa);
      else spaHigh = Math.max(spaHigh, dSpa);
    }
    // eslint-disable-next-line no-console
    console.log(`events: transit ${(tr * 60).toFixed(1)} s; rise/set vs brentq ${(rs * 60).toFixed(1)} s; vs SPA rise/set ${(spaMid * 60).toFixed(1)} s (|lat| < 60°), ${(spaHigh * 60).toFixed(1)} s (higher)`);
    expect(tr * 60).toBeLessThan(6);
    expect(rs * 60).toBeLessThan(30);
    expect(spaMid * 60).toBeLessThan(120);
    expect(spaHigh * 60).toBeLessThan(720);
  });
  test("golden-hour and blue-hour boundaries (6°, −4°, −6°) within 30 s of brentq on SPA's elevation", () => {
    let worst = 0;
    let n = 0;
    for (const r of rows) {
      const ev = sunEvents(r.lat, r.lon, dayOf(r.date, r.offset));
      if (isErr(ev)) throw new Error(ev.error);
      const pairs: Array<[number | null, number | null]> = [
        [ev.goldenMorning[1], r.crossings["6.0"][0]],
        [ev.goldenEvening[0], r.crossings["6.0"][1]],
        [ev.goldenMorning[0], r.crossings["-4.0"][0]],
        [ev.goldenEvening[1], r.crossings["-4.0"][1]],
        [ev.blueMorning[0], r.crossings["-6.0"][0]],
        [ev.blueEvening[1], r.crossings["-6.0"][1]],
      ];
      for (const [mine, theirs] of pairs) {
        if (theirs === null) continue;
        // The oracle scanned one window centred on transit; a crossing it found must be found here too.
        expect(mine).not.toBeNull();
        worst = Math.max(worst, Math.abs((mine as number) - theirs));
        n++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`golden/blue vs SPA: ${n} crossings, worst ${(worst * 60).toFixed(1)} s`);
    expect(n).toBeGreaterThan(150);
    expect(worst * 60).toBeLessThan(30);
  });
});

describe("sun: adversarial", () => {
  test("polar night at Longyearbyen on 21 December, polar day on 21 June", () => {
    const n = sunEvents(78.2232, 15.6267, dayOf("2026-12-21", 1));
    const d = sunEvents(78.2232, 15.6267, dayOf("2026-06-21", 1));
    if (isErr(n) || isErr(d)) throw new Error("refused");
    expect(n.daylight).toBe("polar night");
    expect(n.dayLength).toBe(0);
    expect(n.sunrise).toBeNull();
    expect(d.daylight).toBe("polar day");
    expect(d.dayLength).toBe(1440);
    // In polar night the sun never reaches 6°: no golden hour end; at 78° in December it stays below −6° too.
    expect(n.goldenMorning[1]).toBeNull();
  });
  test("a pole, a bad longitude, 30 February and an offset of 20 h are refused by name", () => {
    expect(isErr(sunEvents(90, 0, dayOf("2026-06-21", 0)))).toBe(true);
    expect((sunEvents(90, 0, dayOf("2026-06-21", 0)) as { error: string }).error).toMatch(/Latitude/);
    expect((sunEvents(10, 200, dayOf("2026-06-21", 0)) as { error: string }).error).toMatch(/Longitude/);
    expect((sunEvents(10, 20, dayOf("2026-02-30", 0)) as { error: string }).error).toMatch(/day 30 does not exist/);
    expect((sunEvents(10, 20, dayOf("2026-06-21", 20)) as { error: string }).error).toMatch(/UTC offset/);
    expect((sunEvents(10, 20, dayOf("1850-06-21", 0)) as { error: string }).error).toMatch(/1901–2099/);
    expect(isErr(sunAt(10, 20, dayOf("2026-06-21", 0), 1440))).toBe(true);
    expect(isErr(sunAt(10, 20, dayOf("2026-06-21", 0), NaN))).toBe(true);
  });
  test("the sun below the horizon casts no shadow (null, not an infinite length)", () => {
    expect(shadowOf(2, -3, 100)).toBeNull();
    expect(shadowOf(2, 0, 100)).toBeNull();
    const s = shadowOf(2, 45, 100);
    if (s === null || isErr(s)) throw new Error("no shadow");
    expect(s.length).toBeCloseTo(2, 12);
    expect(s.bearing).toBeCloseTo(280, 12);
    expect(isErr(shadowOf(0, 45, 100))).toBe(true);
    expect(isErr(shadowOf(-1, 45, 100))).toBe(true);
  });
  test("a very low sun gives a long but finite shadow: h/tan(0.5°) = 114.6h", () => {
    const s = shadowOf(1, 0.5, 270);
    if (s === null || isErr(s)) throw new Error("no shadow");
    expect(s.ratio).toBeCloseTo(1 / Math.tan((0.5 * Math.PI) / 180), 10);
  });
  test("sun path covers the day and refuses a hostile step", () => {
    const p = sunPath(51.5, 0, dayOf("2026-06-21", 1));
    if (isErr(p)) throw new Error(p.error);
    expect(p.length).toBe(289);
    expect(isErr(sunPath(51.5, 0, dayOf("2026-06-21", 1), 0))).toBe(true);
    expect(isErr(sunPath(51.5, 0, dayOf("2026-06-21", 1), Infinity))).toBe(true);
  });
});

describe("soft shadows (similar triangles)", () => {
  test("light 1 m wide, occluder 0.3 m at 2 m, receiver 1 m behind: penumbra 0.5 m each side, umbra −0.05 m (antumbra)", () => {
    // penumbra D·d/L = 1·1/2 = 0.5; umbra w − (D − w)d/L = 0.3 − 0.7·0.5 = −0.05; ends at wL/(D − w) = 0.6/0.7.
    const s = softShadow(1, 0.3, 2, 1);
    if (isErr(s)) throw new Error(s.error);
    expect(s.penumbra).toBeCloseTo(0.5, 14);
    expect(s.umbra).toBeCloseTo(-0.05, 14);
    expect(s.hasUmbra).toBe(false);
    expect(s.umbraEnds).toBeCloseTo(0.6 / 0.7, 14);
    expect(s.outer).toBeCloseTo(0.3 + 1.3 * 0.5, 14);
    expect(s.pointShadow).toBeCloseTo(0.45, 14);
  });
  test("contact hardening: the penumbra is exactly 0 at d = 0 and the shadow is the occluder's own size", () => {
    const s = softShadow(1, 0.3, 2, 0);
    if (isErr(s)) throw new Error(s.error);
    expect(s.penumbra).toBe(0);
    expect(s.umbra).toBeCloseTo(0.3, 14);
    expect(s.hasUmbra).toBe(true);
  });
  test("an occluder larger than the light keeps an umbra at every distance", () => {
    const s = softShadow(0.2, 1, 2, 100);
    if (isErr(s)) throw new Error(s.error);
    expect(s.umbraEnds).toBeNull();
    expect(s.hasUmbra).toBe(true);
  });
  test("the umbra and both penumbrae add up to the outer width", () => {
    const s = softShadow(0.6, 0.4, 3, 0.5);
    if (isErr(s)) throw new Error(s.error);
    expect(s.umbra + 2 * s.penumbra).toBeCloseTo(s.outer, 14);
  });
  test("occluder at the light, negative distances and a zero-size light are refused by name", () => {
    expect((softShadow(1, 0.3, 0, 1) as { error: string }).error).toMatch(/occluder sits at the light/);
    expect((softShadow(1, 0.3, -2, 1) as { error: string }).error).toMatch(/Light to occluder/);
    expect((softShadow(1, 0.3, 2, -1) as { error: string }).error).toMatch(/receiver/);
    expect((softShadow(0, 0.3, 2, 1) as { error: string }).error).toMatch(/Light size/);
    expect((softShadow(1, 0, 2, 1) as { error: string }).error).toMatch(/Occluder size/);
    expect(isErr(softShadow(NaN, 0.3, 2, 1))).toBe(true);
  });
});

describe("falloff, lighting ratios and the near-field error", () => {
  test("doubling the distance is exactly 2 stops; moving for +1 stop divides the distance by √2", () => {
    expect(falloffStops(2, 4)).toBeCloseTo(2, 14);
    expect(distanceForStops(2, 1)).toBeCloseTo(2 / Math.SQRT2, 14);
    expect(distanceForStops(2, -2)).toBeCloseTo(4, 14);
    expect(isErr(falloffStops(0, 4))).toBe(true);
    expect(isErr(distanceForStops(-1, 1))).toBe(true);
  });
  test("disc on-axis illuminance matches quad over the disc's solid angle (scipy), and the point form", () => {
    for (const r of O.disc as Array<{ L: number; R: number; z: number; E: number; E_point: number }>) {
      expect(discIlluminance(r.L, r.R, r.z)).toBeCloseTo(r.E, 8);
      expect(discAsPoint(r.L, r.R, r.z)).toBeCloseTo(r.E_point, 8);
    }
  });
  test("the five-diameter rule: at z = 5D the point form is exactly 1 % high", () => {
    const f = falloff({ d1: 2, d2: 4, diameter: 1, flux: 10000, coneDeg: 60, watts: 100, efficacy: 100 });
    if (isErr(f)) throw new Error(f.error);
    expect(f.errorAtFive).toBeCloseTo(0.01, 12);
    expect(f.onePercentDistance).toBeCloseTo(5, 14);
    expect(f.pointError).toBeCloseTo(0.25 / 4, 14);
    // PBR units: 10,000 lm point → 795.775 cd; one-sided disc of area π/4 m² → Φ/(πA) = 4053.0 nits.
    expect(f.pointCd).toBeCloseTo(10000 / (4 * Math.PI), 10);
    expect(f.areaNits).toBeCloseTo(10000 / (Math.PI * (Math.PI / 4)), 8);
    // 60° full cone: Ω = 2π(1 − cos 30°) = 0.841787 sr.
    expect(f.spotOmega).toBeCloseTo(2 * Math.PI * (1 - Math.cos(Math.PI / 6)), 10);
    expect(f.lumensFromWatts).toBe(10000);
  });
  test("efficacy above 683 lm/W and a zero flux are refused", () => {
    expect((falloff({ d1: 2, d2: 4, diameter: 1, flux: 10000, coneDeg: 60, watts: 100, efficacy: 700 }) as { error: string }).error).toMatch(/683/);
    expect(isErr(falloff({ d1: 2, d2: 4, diameter: 1, flux: 0, coneDeg: 60, watts: null, efficacy: null }))).toBe(true);
    expect(isErr(falloff({ d1: 2, d2: 4, diameter: 1, flux: 10, coneDeg: 0, watts: null, efficacy: null }))).toBe(true);
  });
});

describe("microfacet BRDF against an independent numpy implementation", () => {
  test("D, G, F and the specular BRDF at eight configurations (incl. roughness 0 floored to 0.045, grazing 85°)", () => {
    for (const p of O.brdf_points as Array<{ r: number; metallic: number; ior: number; base: number; tv: number; tl: number; phi: number; form: "correlated" | "separable"; D: number; G: number; F: number; F0: number; spec: number }>) {
      const b = brdf({ roughness: p.r, metallic: p.metallic, ior: p.ior, base: p.base, thetaV: p.tv, thetaL: p.tl, phi: p.phi, form: p.form });
      if (isErr(b)) throw new Error(b.error);
      expect(b.D / p.D - 1).toBeCloseTo(0, 10);
      expect(b.G / p.G - 1).toBeCloseTo(0, 10);
      expect(b.F / p.F - 1).toBeCloseTo(0, 10);
      expect(b.F0 / p.F0 - 1).toBeCloseTo(0, 10);
      expect(b.specular / p.spec - 1).toBeCloseTo(0, 10);
    }
  });
  test("directional albedo (half-vector quadrature) within 10⁻⁴ of the light-direction Gauss–Legendre integral", () => {
    let worst = 0;
    for (const a of O.albedo as Array<{ r: number; tv: number; F0: number; form: "correlated" | "separable"; E: number }>) {
      const e = directionalAlbedo(a.r * a.r, a.tv, a.F0, a.form);
      if (isErr(e)) throw new Error(e.error);
      worst = Math.max(worst, Math.abs(e - a.E));
    }
    // eslint-disable-next-line no-console
    console.log(`albedo vs numpy: worst ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-4);
  });
  test("white furnace: smooth surfaces keep nearly all energy, rough ones lose a visible share", () => {
    const smooth = directionalAlbedo(0.045 * 0.045, 0, 1, "correlated") as number;
    const rough = directionalAlbedo(1, 0, 1, "correlated") as number;
    expect(smooth).toBeGreaterThan(0.99);
    expect(rough).toBeLessThan(0.9);
  });
  test("GGX is normalised: ∫D cosθh dω = 1 (scipy quad) for α from 0.002 to 1", () => {
    for (const d of O.d_norm as Array<{ alpha: number; norm: number }>) expect(d.norm).toBeCloseTo(1, 6);
    // and the TS D agrees with the closed form at the peak: D(1) = 1/(πα²).
    expect(ggxD(1, 0.25)).toBeCloseTo(1 / (Math.PI * 0.0625), 10);
  });
  test("F0 from IOR: 1.5 → 0.04, 1.33 → 0.02006; the Fresnel module agrees with ((n − 1)/(n + 1))²", () => {
    expect(f0FromIor(1.5)).toBeCloseTo(0.04, 12);
    expect(f0FromIor(1.33)).toBeCloseTo((0.33 / 2.33) ** 2, 12);
  });
  test("adversarial: roughness 0 is floored (stated), 90° and beyond is refused, bad inputs refused by name", () => {
    const b = brdf({ roughness: 0, metallic: 0, ior: 1.5, base: 0.5, thetaV: 30, thetaL: 30, phi: 180, form: "correlated" });
    if (isErr(b)) throw new Error(b.error);
    expect(b.floored).toBe(true);
    expect(b.alpha).toBeCloseTo(0.002025, 12);
    expect(Number.isFinite(b.specular)).toBe(true);
    expect((brdf({ roughness: 0.5, metallic: 0, ior: 1.5, base: 0.5, thetaV: 90, thetaL: 30, phi: 180, form: "correlated" }) as { error: string }).error).toMatch(/View angle/);
    expect((brdf({ roughness: 0.5, metallic: 0, ior: 1.5, base: 0.5, thetaV: 30, thetaL: 95, phi: 180, form: "correlated" }) as { error: string }).error).toMatch(/Light angle/);
    expect((brdf({ roughness: 1.2, metallic: 0, ior: 1.5, base: 0.5, thetaV: 30, thetaL: 30, phi: 180, form: "correlated" }) as { error: string }).error).toMatch(/Roughness/);
    expect((brdf({ roughness: 0.5, metallic: 0, ior: 0, base: 0.5, thetaV: 30, thetaL: 30, phi: 180, form: "correlated" }) as { error: string }).error).toMatch(/Index of refraction/);
    // Grazing: 89.9° on both sides stays finite (no 0/0).
    const g = brdf({ roughness: 0.3, metallic: 0, ior: 1.5, base: 0.5, thetaV: 89.9, thetaL: 89.9, phi: 180, form: "separable" });
    if (isErr(g)) throw new Error(g.error);
    expect(Number.isFinite(g.specular) && Number.isFinite(g.albedoWhite)).toBe(true);
  });
});

describe("render noise", () => {
  test("halving the noise takes four times the samples; time scales on the per-sample share", () => {
    const n = samplesForNoise(64, 8, 4, 600, 60);
    if (isErr(n)) throw new Error(n.error);
    expect(n.samples).toBeCloseTo(256, 12);
    expect(n.time).toBeCloseTo(60 + 540 * 4, 10);
  });
  test("hemisphere variances match quad (scipy) at β = 10°…90°, and cosine sampling is exact at 90°", () => {
    for (const r of O.noise as Array<{ beta: number; I: number; var_uniform: number; var_cosine: number }>) {
      const h = hemiVariance(r.beta);
      if (isErr(h)) throw new Error(h.error);
      expect(h.integral).toBeCloseTo(r.I, 9);
      expect(h.varUniform).toBeCloseTo(r.var_uniform, 9);
      expect(h.varCosine).toBeCloseTo(Math.max(0, r.var_cosine), 9);
    }
    const full = hemiVariance(90) as { varUniform: number; varCosine: number; ratio: number | null };
    expect(full.varUniform).toBeCloseTo((Math.PI * Math.PI) / 3, 12);
    expect(full.varCosine).toBe(0);
    expect(full.ratio).toBeNull();
  });
  test("seeded Monte Carlo reproduces the analytic 1/√N noise within 15 %", () => {
    const h = hemiVariance(30) as { integral: number; varUniform: number; varCosine: number };
    for (const N of [16, 256]) {
      const mu = mcRelativeError("uniform", 30, N, 400, 7) as number;
      const mc = mcRelativeError("cosine", 30, N, 400, 7) as number;
      expect(mu / (Math.sqrt(h.varUniform / N) / h.integral)).toBeGreaterThan(0.85);
      expect(mu / (Math.sqrt(h.varUniform / N) / h.integral)).toBeLessThan(1.15);
      expect(mc / (Math.sqrt(h.varCosine / N) / h.integral)).toBeGreaterThan(0.85);
      expect(mc / (Math.sqrt(h.varCosine / N) / h.integral)).toBeLessThan(1.15);
    }
  });
  test("adversarial: zero target noise, a non-finite count and a runaway Monte Carlo are refused", () => {
    expect((samplesForNoise(64, 8, 0, 600, 0) as { error: string }).error).toMatch(/Target noise/);
    expect(isErr(samplesForNoise(Infinity, 8, 4, 600, 0))).toBe(true);
    expect(isErr(samplesForNoise(64, 8, 4, 600, 600))).toBe(true);
    expect(isErr(samplesForNoise(64, 8, 1e-9, 600, 0))).toBe(true);
    expect(isErr(mcRelativeError("uniform", 30, 1e9, 1e9, 1))).toBe(true);
    expect(isErr(mcRelativeError("uniform", 30, NaN, 4, 1))).toBe(true);
    expect(isErr(hemiVariance(0))).toBe(true);
  });
});

describe("tone mapping", () => {
  test("every curve matches the published formulas (numpy)", () => {
    for (const t of O.tone as Array<{ x: number; reinhard: number; reinhard_ext_4: number; hable: number; aces: number }>) {
      expect(reinhard(t.x)).toBeCloseTo(t.reinhard, 12);
      expect(reinhardExt(t.x, 4)).toBeCloseTo(t.reinhard_ext_4, 12);
      expect(hable(t.x)).toBeCloseTo(t.hable, 12);
      expect(acesFitted(t.x)).toBeCloseTo(t.aces, 12);
    }
  });
  test("white points: Reinhard extended is 1 at Lw, Hable at W/2 = 5.6 (bias 2), the ACES fit clips at 7.2417", () => {
    expect(reinhardExt(4, 4)).toBeCloseTo(1, 14);
    expect(hable(5.6)).toBeCloseTo(1, 14);
    expect(ACES_CLIP).toBeCloseTo(7.24166, 4);
    expect(acesFitted(ACES_CLIP)).toBeCloseTo(1, 10);
  });
  test("inverse placement and dynamic range", () => {
    const x = inverseTone("reinhard", 0.5, 4) as number;
    expect(x).toBeCloseTo(1, 9);
    expect(inverseTone("reinhard", 1, 4)).toBeNull();
    expect(dynamicRangeStops(0.01, 10000)).toBeCloseTo(Math.log2(1e6), 12);
    expect(isErr(dynamicRangeStops(10, 1))).toBe(true);
    expect(isErr(dynamicRangeStops(0, 1))).toBe(true);
  });
});

describe("atmosphere, fog and participating media", () => {
  test("Kasten–Young matches pvlib get_relative_airmass('kastenyoung1989')", () => {
    for (const k of O.kasten_young as Array<{ zenith: number; am: number }>) expect(kastenYoung(k.zenith)).toBeCloseTo(k.am, 9);
    // Published anchor: about 38 at the horizon.
    expect(kastenYoung(90)).toBeCloseTo(37.92, 1);
    expect(isErr(kastenYoung(91))).toBe(true);
  });
  test("Rayleigh optical depth: Bucholtz 0.0972 at 550 nm, within 1.5 % of Hansen–Travis and Bird–Riordan over 400–700 nm", () => {
    expect(rayleighTau(0.55)).toBeCloseTo(0.0972, 4);
    for (const r of O.rayleigh as Array<{ um: number; bucholtz: number; hansen_travis: number; bird_riordan: number }>) {
      const t = rayleighTau(r.um) as number;
      expect(t / r.bucholtz - 1).toBeCloseTo(0, 10);
      expect(Math.abs(t / r.hansen_travis - 1)).toBeLessThan(0.015);
      expect(Math.abs(t / r.bird_riordan - 1)).toBeLessThan(0.015);
    }
  });
  test("Henyey–Greenstein: values match, it integrates to 1 and its mean cosine is g (scipy quad)", () => {
    for (const h of O.hg as Array<{ g: number; p0: number; p90: number; p180: number; p30: number; norm: number; mean_cos: number }>) {
      expect(henyeyGreenstein(h.g, 0)).toBeCloseTo(h.p0, 10);
      expect(henyeyGreenstein(h.g, 90)).toBeCloseTo(h.p90, 10);
      expect(henyeyGreenstein(h.g, 180)).toBeCloseTo(h.p180, 10);
      expect(henyeyGreenstein(h.g, 30)).toBeCloseTo(h.p30, 10);
      expect(h.norm).toBeCloseTo(1, 8);
      expect(h.mean_cos).toBeCloseTo(h.g, 8);
    }
  });
  const base = { sigma: 0.002, visibility: null, distance: 500, elevationDeg: 5, pressureHpa: 1013.25, g: 0.76, thetaDeg: 30, lambdas: [450, 550, 650] };
  test("Beer–Lambert and Koschmieder: σ = 0.002 /m over 500 m is e⁻¹; V = 3.912/σ = 1956 m", () => {
    const a = atmosphere(base);
    if (isErr(a)) throw new Error(a.error);
    expect(a.transmittance).toBeCloseTo(Math.exp(-1), 14);
    expect(a.visibility).toBeCloseTo(-Math.log(0.02) / 0.002, 10);
    expect(a.rayleighRatio).toBeCloseTo((650 / 450) ** 4, 12);
    // Low sun: blue is cut harder than red.
    expect(a.beam[0].T).toBeLessThan(a.beam[2].T);
  });
  test("fog σ = 0: transmittance exactly 1 and no visibility limit (null, not Infinity)", () => {
    const a = atmosphere({ ...base, sigma: 0 });
    if (isErr(a)) throw new Error(a.error);
    expect(a.transmittance).toBe(1);
    expect(a.visibility).toBeNull();
    expect(a.mor).toBeNull();
  });
  test("adversarial: g = 1, sun below the horizon, negative σ and a 100 nm wavelength are refused by name", () => {
    expect((atmosphere({ ...base, g: 1 }) as { error: string }).error).toMatch(/Asymmetry g/);
    expect((atmosphere({ ...base, elevationDeg: -2 }) as { error: string }).error).toMatch(/below the horizon/);
    expect((atmosphere({ ...base, sigma: -1 }) as { error: string }).error).toMatch(/Extinction/);
    expect((atmosphere({ ...base, lambdas: [100] }) as { error: string }).error).toMatch(/Wavelength 100 nm/);
    expect((atmosphere({ ...base, sigma: null, visibility: 0 }) as { error: string }).error).toMatch(/Visibility/);
  });
});
