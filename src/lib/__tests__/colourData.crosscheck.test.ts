// The committed cross-check that makes the bundled colour tables acceptable (colourData.ts, extracted by
// scripts/colour-data-extract.py from colour-science 0.4.7), in the manner of colourspace.crosscheck.test.ts: every
// test checks the tables against a fact known INDEPENDENTLY of the file, so an extraction or transcription slip
// cannot survive.

import {
  CAT_MATRICES,
  CMF_10,
  CMF_2,
  CMF_END,
  CMF_START,
  E313_COEFFICIENTS,
  ILLUMINANT_SPD,
  SRGB_RGB_TO_XYZ,
  SRGB_XYZ_TO_RGB,
  WHITE_XY,
} from "../colourData";
import { gamutById } from "../colourspace";
import { illuminant1nm, ILLUMINANTS, xyToXYZ, type Observer } from "../colourScience";

const at = (nm: number): number => nm - CMF_START;

describe("colour-matching functions", () => {
  test("1 nm from 360 to 780 nm: 421 rows in each of the six columns", () => {
    for (const t of [CMF_2, CMF_10]) for (const c of [t.x, t.y, t.z]) expect(c).toHaveLength(CMF_END - CMF_START + 1);
  });
  test("the 2° ȳ is the CIE 1924 V(λ): exactly 1 at 555 nm, its peak", () => {
    expect(CMF_2.y[at(555)]).toBe(1);
    expect(Math.max(...CMF_2.y)).toBe(1);
  });
  test("equal-energy white E sits at x = y = 1/3: Σx̄, Σȳ, Σz̄ are equal to 0.1 % for both observers", () => {
    for (const t of [CMF_2, CMF_10]) {
      const sx = t.x.reduce((s, v) => s + v, 0);
      const sy = t.y.reduce((s, v) => s + v, 0);
      const sz = t.z.reduce((s, v) => s + v, 0);
      expect(Math.abs(sx / sy - 1)).toBeLessThan(1e-3);
      expect(Math.abs(sz / sy - 1)).toBeLessThan(1e-3);
    }
  });
  test("the spectral locus is a horseshoe: x̄ peaks near 600 nm, z̄ near 445 nm, and no value is negative", () => {
    const argmax = (c: readonly number[]): number => CMF_START + c.indexOf(Math.max(...c));
    expect(Math.abs(argmax(CMF_2.x) - 599)).toBeLessThanOrEqual(2);
    expect(Math.abs(argmax(CMF_2.z) - 446)).toBeLessThanOrEqual(3);
    for (const t of [CMF_2, CMF_10]) for (const c of [t.x, t.y, t.z]) expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
  });
});

describe("illuminant spectra", () => {
  test("every SPD but C is normalised to 100 at 560 nm (CIE convention; the CIE table gives C as 105.3 there)", () => {
    expect(ILLUMINANT_SPD.C.values[(560 - 360) / 5]).toBe(105.3);
    for (const k of ["A", "D50", "D55", "D65", "D75"]) {
      const s = ILLUMINANT_SPD[k];
      expect(s.values[(560 - s.start) / s.step]).toBeCloseTo(100, 6);
    }
  });
  test("illuminant A is Planck's law at 2848 K with c₂ = 1.435×10⁻² m·K (CIE 15), to 6 significant figures", () => {
    const s = ILLUMINANT_SPD.A;
    const c = 1.435e7;
    const planck = (nm: number): number => (100 * (560 / nm) ** 5 * (Math.exp(c / (2848 * 560)) - 1)) / (Math.exp(c / (2848 * nm)) - 1);
    s.values.forEach((v, i) => {
      const nm = s.start + i * s.step;
      expect(Math.abs(v / planck(nm) - 1)).toBeLessThan(5e-6);
    });
  });
  test("the tabulated white points agree with the SPD × CMF integration (1 nm, 360–780 nm) to 1×10⁻³ in x and y", () => {
    for (const obs of ["2", "10"] as Observer[]) {
      const t = obs === "2" ? CMF_2 : CMF_10;
      for (const ill of ILLUMINANTS) {
        const S = illuminant1nm(ill);
        let X = 0, Y = 0, Z = 0;
        S.forEach((s, i) => {
          X += s * t.x[i];
          Y += s * t.y[i];
          Z += s * t.z[i];
        });
        const [x, y] = WHITE_XY[obs][ill];
        expect({ ill, obs, dx: Math.abs(X / (X + Y + Z) - x) < 1e-3, dy: Math.abs(Y / (X + Y + Z) - y) < 1e-3 }).toEqual({ ill, obs, dx: true, dy: true });
      }
    }
  });
  test("D65's tabulated white is the familiar (0.3127, 0.3290) for 2° and (0.31382, 0.331) for 10°", () => {
    expect(WHITE_XY["2"].D65).toEqual([0.3127, 0.329]);
    expect(WHITE_XY["10"].D65).toEqual([0.31382, 0.331]);
  });
});

describe("sRGB (IEC 61966-2-1)", () => {
  test("the luminance row is the Rec. 709 luma weights 0.2126, 0.7152, 0.0722 (also WCAG's)", () => {
    expect(SRGB_RGB_TO_XYZ[1]).toEqual([0.2126, 0.7152, 0.0722]);
  });
  test("RGB = (1, 1, 1) lands on the D65 white, and the two 4-decimal matrices are inverses to 2×10⁻⁴", () => {
    const W = xyToXYZ(0.3127, 0.329, 1);
    for (let r = 0; r < 3; r++) expect(Math.abs(SRGB_RGB_TO_XYZ[r].reduce((s, v) => s + v, 0) - W[r])).toBeLessThan(2e-4);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const p = [0, 1, 2].reduce((s, k) => s + SRGB_XYZ_TO_RGB[r][k] * SRGB_RGB_TO_XYZ[k][c], 0);
        expect(Math.abs(p - (r === c ? 1 : 0))).toBeLessThan(2e-4);
      }
    }
  });
  test("the matrix's columns are the sRGB primaries held independently in colourspace.ts", () => {
    const prim = gamutById("srgb")!.primaries;
    for (let c = 0; c < 3; c++) {
      const X = SRGB_RGB_TO_XYZ[0][c], Y = SRGB_RGB_TO_XYZ[1][c], Z = SRGB_RGB_TO_XYZ[2][c];
      expect(Math.abs(X / (X + Y + Z) - prim[c].x)).toBeLessThan(2e-4);
      expect(Math.abs(Y / (X + Y + Z) - prim[c].y)).toBeLessThan(2e-4);
    }
  });
});

describe("chromatic adaptation matrices", () => {
  test("Bradford, CAT02 and CAT16 map equal-energy white to equal cone responses: each row sums to 1 (to 2×10⁻⁴)", () => {
    for (const m of [CAT_MATRICES.bradford, CAT_MATRICES.cat02, CAT_MATRICES.cat16]) for (const row of m) expect(Math.abs(row[0] + row[1] + row[2] - 1)).toBeLessThan(2e-4);
  });
  test("the Bradford matrix is the published one (Lam 1985) to 4 decimals: its first row 0.8951, 0.2664, −0.1614", () => {
    expect(CAT_MATRICES.bradford[0]).toEqual([0.8951, 0.2664, -0.1614]);
  });
});

describe("ASTM E313 coefficients", () => {
  test("the perfect white has yellowness 0 to within 0.1 under each tabulated illuminant and observer", () => {
    for (const obs of ["2", "10"] as Observer[]) {
      for (const ill of ["C", "D65"] as const) {
        const [cx, cz] = E313_COEFFICIENTS[obs][ill];
        const [x, y] = WHITE_XY[obs][ill];
        const W = xyToXYZ(x, y, 100);
        expect(Math.abs((100 * (cx * W[0] - cz * W[2])) / W[1])).toBeLessThan(0.1);
      }
    }
  });
});
