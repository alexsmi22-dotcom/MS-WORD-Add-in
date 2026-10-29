/**
 * The colour engine (colourScience.ts) against scripts/colour-oracle.py (fixtures/colour-oracle.json: colour-science
 * 0.4.7) and the published CIEDE2000 test data of Sharma, Wu & Dalal (2005), all 34 pairs.
 *
 * Tolerances (the measured worst case is printed by the "agreement summary" test):
 *   ΔE (all formulas)                 1e-9 absolute
 *   Sharma table                      the published 4 decimals: |ΔE₀₀ − table| < 5e-5
 *   L*a*b*, L*C*h, L*u*v*, u'v', xy   1e-9 absolute (hue 1e-8 degrees)
 *   sRGB encoded                      1e-9 absolute
 *   chromatic adaptation              1e-9 absolute (XYZ on the 0–100 scale)
 *   spectral XYZ and white            1e-9 absolute (0–100 scale); the Sprague interpolant 1e-12
 *   E2022 weighting factors           1e-12 absolute
 *   dominant wavelength               exact (whole nm); purity 1e-9
 *   whiteness, tint, YI               1e-9
 *   metamerism index                  1e-9
 */
import * as fs from "fs";
import * as path from "path";
import {
  adaptXYZ,
  ciede2000,
  deltaE,
  deltaE76,
  deltaE94,
  deltaECMC,
  dominantWavelength,
  labToLch,
  labToXYZ,
  luvToXYZ,
  metamerismIndex,
  sprague,
  spectrumToXYZ,
  srgbToXYZ,
  weightingFactors10,
  whitePoint,
  cieWhiteness,
  wcagContrast,
  wcagLuminance,
  XYZToLab,
  XYZToLuv,
  XYZToSrgb,
  XYZToUpVp,
  XYZToxy,
  yellownessD1925,
  yellownessE313,
  type CatMethod,
  type DeFormula,
  type IlluminantId,
  type Lab,
  type Observer,
  type SpectralMethod,
  type Vec3,
} from "../colourScience";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "colour-oracle.json"), "utf8"));
/** test.each over [name, fixture row] pairs (the fixture is untyped JSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const each = test.each as unknown as (rows: Array<[unknown, any]>) => (name: string, fn: (k: any, r: any) => void) => void;
const deltaE00 = (s: Lab, m: Lab, kL = 1, kC = 1, kH = 1): number => ciede2000(s, m, kL, kC, kH).dE;
const lab = (v: number[]): Lab => ({ L: v[0], a: v[1], b: v[2] });
const v3 = (v: number[]): Vec3 => [v[0], v[1], v[2]];
const worst: Record<string, number> = {};
const track = (k: string, err: number): void => {
  worst[k] = Math.max(worst[k] ?? 0, err);
};
const close = (k: string, got: number, want: number, tol: number): void => {
  const e = Math.abs(got - want);
  track(k, e);
  if (!(e <= tol)) throw new Error(`${k}: got ${got}, want ${want} (|Δ| = ${e} > ${tol})`);
};
const closeV = (k: string, got: readonly number[], want: readonly number[], tol: number): void => got.forEach((g, i) => close(k, g, want[i], tol));

describe("CIEDE2000: Sharma, Wu & Dalal (2005), all 34 published pairs", () => {
  test("34 pairs read from colour-science's test module, pair 14 restored", () => {
    expect(FX.sharma).toHaveLength(34);
    expect(FX.sharma[13]).toEqual({ std: [50, -0.001, 2.49], smp: [50, 0.001, -2.49], dE: 4.8045 });
  });
  each(FX.sharma.map((p: { std: number[]; smp: number[]; dE: number }, i: number) => [i + 1, p]))("pair %i to 4 decimals", (_i, p) => {
    const q = p as { std: number[]; smp: number[]; dE: number };
    const d = deltaE00(lab(q.std), lab(q.smp));
    close("Sharma table", d, q.dE, 5e-5);
    expect(d.toFixed(4)).toBe(q.dE.toFixed(4));
  });
  test("symmetric: swapping standard and sample leaves ΔE₀₀ unchanged on every pair, pair 14 included", () => {
    for (const p of FX.sharma) expect(Math.abs(deltaE00(lab(p.smp), lab(p.std)) - p.dE)).toBeLessThan(5e-5);
  });
  test("pairs 7 and 8 (one colour neutral, C = 0): the mean hue is h₁ + h₂", () => {
    const r = ciede2000(lab([50, 0, 0]), lab([50, -1, 2]));
    expect(r.dE.toFixed(4)).toBe("2.3669");
  });
});

describe("difference formulas against colour-science", () => {
  each(FX.diffs.map((d: { std: number[] }, i: number) => [i, d]))("pair %i", (_i, d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = d;
    const s = lab(r.std);
    const m = lab(r.smp);
    close("ΔE*ab", deltaE76(s, m), r.de76, 1e-9);
    close("ΔE*94", deltaE94(s, m, false), r.de94g, 1e-9);
    close("ΔE*94 textiles", deltaE94(s, m, true), r.de94t, 1e-9);
    close("CMC 2:1", deltaECMC(s, m, 2, 1), r.cmc21, 1e-9);
    close("CMC 1:1", deltaECMC(s, m, 1, 1), r.cmc11, 1e-9);
    close("ΔE₀₀", deltaE00(s, m), r.de00, 1e-9);
    close("ΔE₀₀ 2:1:1", deltaE00(s, m, 2, 1, 1), r.de00_211, 1e-9);
    close("ΔE₀₀ 1.5:0.8:1.2", deltaE00(s, m, 1.5, 0.8, 1.2), r.de00_k, 1e-9);
    const l1 = labToLch(s);
    close("C*ab", l1.C, r.lch_std[1], 1e-9);
    close("hab", l1.h, r.lch_std[2], 1e-8);
    for (const f of ["de00", "de76", "de94g", "de94t", "cmc21", "cmc11"] as DeFormula[]) expect(deltaE(f, s, m)).toBeCloseTo(r[f], 9);
  });
});

describe("conversions against colour-science", () => {
  each(FX.conversions.map((c: { ill: string; obs: string; XYZ: number[] }, i: number) => [`${c.ill}/${c.obs}° #${i}`, c]))("%s", (_k, c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = c;
    const W = whitePoint(r.ill as IlluminantId, r.obs as Observer);
    const X = v3(r.XYZ);
    const L = XYZToLab(X, W);
    closeV("L*a*b*", [L.L, L.a, L.b], r.Lab, 1e-9);
    const C = labToLch(L);
    close("L*C*h (C)", C.C, r.LCh[1], 1e-9);
    close("L*C*h (h)", C.h, r.LCh[2], 1e-8);
    const U = XYZToLuv(X, W);
    closeV("L*u*v*", [U.L, U.u, U.v], r.Luv, 1e-9);
    closeV("u′v′", XYZToUpVp(X) as number[], r.upvp, 1e-12);
    closeV("xy", XYZToxy(X) as number[], r.xy, 1e-12);
    closeV("Lab → XYZ", labToXYZ(L, W), r.XYZ_from_Lab, 1e-9);
    closeV("Luv → XYZ", luvToXYZ(U, W), r.XYZ_from_Luv, 1e-9);
    closeV("XYZ → sRGB (Bradford)", XYZToSrgb(X, W).encoded, r.sRGB, 1e-9);
  });
  each(FX.srgb_to_xyz.map((c: { rgb: number[]; ill: string; obs: string }, i: number) => [i, c]))("sRGB → XYZ #%i", (_i, c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = c;
    closeV("sRGB → XYZ", srgbToXYZ(v3(r.rgb), whitePoint(r.ill, r.obs)), r.XYZ, 1e-9);
  });
});

describe("chromatic adaptation against colour-science", () => {
  each(FX.cat.map((c: { method: string; from: string; to: string }, i: number) => [`${c.method} ${c.from}→${c.to} #${i}`, c]))("%s", (_k, c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = c;
    const out = adaptXYZ(v3(r.XYZ), whitePoint(r.from, r.obs), whitePoint(r.to, r.obs), r.method as CatMethod);
    closeV(`CAT ${r.method}`, out, r.out, 1e-9);
  });
});

describe("spectral → XYZ against colour.sd_to_XYZ", () => {
  test("the Sprague interpolant matches colour.algebra.SpragueInterpolator at 1 nm", () => {
    for (const [name, want] of Object.entries(FX.sprague1nm)) {
      const s = FX.colourchecker[name];
      const f = sprague(s.wl, s.v);
      (want as number[]).forEach((w, i) => {
        const x = 380 + i;
        const got = s.wl.includes(x) ? s.v[s.wl.indexOf(x)] : f(x);
        close("Sprague 1 nm", got, w, 1e-12);
      });
    }
  });
  test("ASTM E2022 10 nm weighting factors: D65/10° and A/2°", () => {
    weightingFactors10("D65", "10").forEach((w, i) => closeV("E2022 weights", w, FX.weights_D65_10[i], 1e-12));
    weightingFactors10("A", "2").forEach((w, i) => closeV("E2022 weights", w, FX.weights_A_2[i], 1e-12));
  });
  each(FX.spectral.map((c: { spec: string; ill: string; obs: string; method: string }, i: number) => [`${c.spec} ${c.ill}/${c.obs}° ${c.method} #${i}`, c]))("%s", (_k, c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = c;
    const s = FX.spectra[r.spec];
    const method: SpectralMethod = r.method === "ASTM E308" ? "astm-e308" : "integration";
    const out = spectrumToXYZ({ wl: s.wl.slice(), v: s.v.slice() }, r.ill, r.obs, method);
    if (!out.ok) throw new Error(out.error);
    closeV(`spectral XYZ (${r.method})`, out.XYZ, r.XYZ, 1e-9);
    closeV(`spectral white (${r.method})`, out.white, r.white, 1e-9);
  });
});

describe("dominant wavelength and excitation purity against colour-science", () => {
  each(FX.dominant.map((d: { obs: string; xy: number[] }, i: number) => [`${d.obs}° (${d.xy.join(", ")}) #${i}`, d]))("%s", (_k, d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = d;
    const out = dominantWavelength([r.xy[0], r.xy[1]], [r.white[0], r.white[1]], r.obs);
    if (!out.ok) throw new Error(out.error);
    expect(out.wavelength).toBe(r.wl);
    closeV("dominant crossing xy", out.xyBoundary, r.xy_wl, 1e-12);
    close("excitation purity", out.purity, r.purity, 1e-9);
  });
});

describe("whiteness, tint and yellowness against colour-science", () => {
  each(FX.whiteness.map((w: { XYZ: number[] }) => [w.XYZ.join(", "), w]))("XYZ %s", (_k, w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = w;
    const X = v3(r.XYZ);
    for (const obs of ["2", "10"] as Observer[]) {
      const wp = XYZToxy(whitePoint("D65", obs)) as [number, number];
      const wt = cieWhiteness(X, wp, obs);
      close("CIE whiteness W", wt!.W, r[`WT_${obs}`][0], 1e-9);
      close("CIE tint T", wt!.T, r[`WT_${obs}`][1], 1e-9);
      for (const ill of ["C", "D65"] as const) close("ASTM E313 YI", yellownessE313(X, ill, obs), r[`YI_${ill}_${obs}`], 1e-9);
    }
    close("ASTM D1925 YI", yellownessD1925(X), r.YI_D1925, 1e-9);
  });
});

describe("metamerism index against colour-science (ISO 18314-4)", () => {
  const m = FX.metamer;
  const xyzOf = (v: number[], ill: IlluminantId) => {
    const o = spectrumToXYZ({ wl: m.wl.slice(), v: v.slice() }, ill, "10", "astm-e308");
    if (!o.ok) throw new Error(o.error);
    return o;
  };
  each(FX.metamerism.map((r: { formula: string; test: string }) => [`${r.formula} D65 → ${r.test}`, r]))("%s", (_k, row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = row;
    const sr = xyzOf(m.std, "D65");
    const pr = xyzOf(m.smp, "D65");
    const st = xyzOf(m.std, r.test);
    const pt = xyzOf(m.smp, r.test);
    const f = r.formula as DeFormula;
    close("metamerism additive", metamerismIndex(f, "additive", sr, pr, st, pt), r.additive, 1e-9);
    close("metamerism multiplicative", metamerismIndex(f, "multiplicative", sr, pr, st, pt), r.multiplicative, 1e-9);
    close("metamerism raw", metamerismIndex(f, "none", sr, pr, st, pt), r.raw, 1e-9);
    close("ΔE under the reference", deltaE(f, XYZToLab(sr.XYZ, sr.white), XYZToLab(pr.XYZ, pr.white)), r.ref, 1e-9);
  });
});

describe("WCAG 2.x contrast", () => {
  const hex = (s: string): Vec3 => [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Vec3;
  each(FX.wcag.map((w: { fg: string; bg: string }) => [`#${w.fg} on #${w.bg}`, w]))("%s", (_k, w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = w;
    close("WCAG luminance", wcagLuminance(hex(r.fg)), r.Lfg, 1e-12);
    close("WCAG contrast", wcagContrast(hex(r.fg), hex(r.bg)), r.ratio, 1e-12);
  });
  test("the W3C example: #777777 on white is 4.48:1 and FAILS AA (4.5) on the unrounded value", () => {
    const c = wcagContrast([0x77, 0x77, 0x77], [255, 255, 255]);
    expect(c.toFixed(2)).toBe("4.48");
    expect(c < 4.5).toBe(true);
    expect(wcagContrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 12);
  });
  test("thresholds 0.03928 (WCAG 2.0/2.1) and 0.04045 (IEC, WCAG 2.2) give identical luminance for every 8-bit value", () => {
    for (let c = 0; c < 256; c++) {
      const v = c / 255;
      const a = v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const b = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      expect(a).toBe(b);
    }
  });
});

afterAll(() => {
  // The agreement summary quoted in the CHANGELOG: the largest absolute error per quantity.
  // eslint-disable-next-line no-console
  if (process.env.COLOUR_ORACLE_SUMMARY) console.log(Object.entries(worst).map(([k, v]) => `${k}: ${v.toExponential(2)}`).join("\n"));
});
