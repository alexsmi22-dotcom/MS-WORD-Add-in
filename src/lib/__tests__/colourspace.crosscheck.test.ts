// The committed cross-check that makes bundled chromaticity data acceptable,
// exactly as flame.crosscheck.test.ts does for the NASA polynomials.
//
// The primaries in colourspace.ts were script-extracted from the colour-science
// datasets. These tests validate them against facts known INDEPENDENTLY of that
// file, so a transcription or extraction slip cannot survive.

import { GAMUTS, gamutById, gamutCoverage, gamutAreaUv, xyToUv } from "../colourspace";

describe("fetched primaries vs independently known facts", () => {
  it("sRGB and Rec.709 share primaries EXACTLY — true by construction of sRGB", () => {
    // sRGB adopted the Rec.709 primaries; any difference means the extraction
    // went wrong. This is the strongest single check available here.
    const s = gamutById("srgb")!;
    const b = gamutById("bt709")!;
    for (let i = 0; i < 3; i++) {
      expect(s.primaries[i].x).toBe(b.primaries[i].x);
      expect(s.primaries[i].y).toBe(b.primaries[i].y);
    }
  });

  it("DCI-P3 shares the sRGB BLUE primary, and differs in red and green", () => {
    // Another published relationship: P3's blue is the same 0.150, 0.060.
    const p3 = gamutById("dcip3")!;
    const s = gamutById("srgb")!;
    expect(p3.primaries[2]).toEqual(s.primaries[2]);
    expect(p3.primaries[0]).not.toEqual(s.primaries[0]);
    expect(p3.primaries[1]).not.toEqual(s.primaries[1]);
  });

  it("every primary is a physically possible chromaticity", () => {
    for (const g of GAMUTS) {
      for (const p of g.primaries) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(p.x + p.y).toBeLessThanOrEqual(1); // z = 1 - x - y >= 0
      }
    }
  });

  it("each gamut is a real triangle, not degenerate", () => {
    for (const g of GAMUTS) {
      expect(gamutAreaUv(g.id)!).toBeGreaterThan(0.001);
    }
  });

  it("the size ordering is the known one: Rec.2020 > DCI-P3 > sRGB", () => {
    const s = gamutAreaUv("srgb")!;
    const p = gamutAreaUv("dcip3")!;
    const b = gamutAreaUv("bt2020")!;
    expect(p).toBeGreaterThan(s);
    expect(b).toBeGreaterThan(p);
  });

  it("Rec.2020 red sits on the spectral locus, as the standard specifies", () => {
    // BT.2020 uses monochromatic primaries; its red is at 630 nm, whose
    // chromaticity has x + y very close to 1 (z ~ 0).
    const red = gamutById("bt2020")!.primaries[0];
    expect(red.x + red.y).toBeCloseTo(1, 3);
  });

  it("every gamut cites where its numbers came from", () => {
    for (const g of GAMUTS) {
      expect(g.source.length).toBeGreaterThan(3);
      expect(g.source).toMatch(/IEC|ITU|SMPTE|DCI/);
    }
  });
});

describe("the xy -> u'v' transform", () => {
  it("matches the published formula at a known point", () => {
    // D65 is x 0.3127, y 0.3290 -> u' 0.1978, v' 0.4683 (standard values).
    const uv = xyToUv({ x: 0.3127, y: 0.329 });
    expect(uv.x).toBeCloseTo(0.1978, 4);
    expect(uv.y).toBeCloseTo(0.4683, 4);
  });

  it("is injective over the gamut vertices", () => {
    const seen = new Set<string>();
    for (const g of GAMUTS) {
      for (const p of g.primaries) {
        const uv = xyToUv(p);
        expect(Number.isFinite(uv.x)).toBe(true);
        expect(Number.isFinite(uv.y)).toBe(true);
        seen.add(`${uv.x.toFixed(6)},${uv.y.toFixed(6)}`);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("coverage", () => {
  it("a gamut covers ITSELF completely — the identity that validates the clipper", () => {
    for (const g of GAMUTS) {
      const r = gamutCoverage(g.id, g.id);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.coverageXy).toBeCloseTo(1, 9);
        expect(r.coverageUv).toBeCloseTo(1, 9);
        expect(r.areaRatioUv).toBeCloseTo(1, 9);
        expect(r.outsideReferenceUv).toBeCloseTo(0, 9);
      }
    }
  });

  it("sRGB and Rec.709 cover each other completely, being identical", () => {
    const r = gamutCoverage("bt709", "srgb");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.coverageUv).toBeCloseTo(1, 9);
  });

  it("COVERAGE AND AREA RATIO DIFFER — the distinction the tool exists to make", () => {
    const r = gamutCoverage("dcip3", "srgb");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // DCI-P3 ENCLOSES sRGB, so it covers 100% of it...
      expect(r.coverageUv).toBeCloseTo(1, 6);
      // ...while being about 126% of its AREA. Quoting that ratio as
      // "coverage" would claim 126% of a space it merely contains.
      expect(r.areaRatioUv).toBeGreaterThan(1.2);
      // A fifth of P3 lies outside sRGB entirely — the colours it buys.
      expect(r.outsideReferenceUv).toBeGreaterThan(0.15);
    }
  });

  it("the two metrics DISAGREE MATERIALLY, in no fixed direction", () => {
    // An early draft asserted u'v' is always the smaller figure. It is not:
    // sRGB covers 52.9% of Rec.2020 in xy and 58.0% in u'v'. What holds is
    // that they differ enough to matter, which is why both are reported.
    const r = gamutCoverage("srgb", "bt2020");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coverageUv).toBeLessThan(0.75);
      expect(Math.abs(r.coverageUv - r.coverageXy)).toBeGreaterThan(0.02);
    }
  });

  it("a wider gamut covers a narrower one almost entirely", () => {
    const r = gamutCoverage("bt2020", "srgb");
    if (r.ok) expect(r.coverageUv).toBeGreaterThan(0.9);
  });

  it("refuses an unknown space by name", () => {
    const r = gamutCoverage("nonesuch", "srgb");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nonesuch/);
  });

  it("always distinguishes coverage from area ratio in its notes", () => {
    const r = gamutCoverage("dcip3", "srgb");
    if (r.ok) {
      expect(r.notes.join(" ")).toMatch(/COVERAGE and AREA RATIO are different/);
      expect(r.notes.join(" ")).toMatch(/Quote the u'v' figure/);
    }
  });
});
