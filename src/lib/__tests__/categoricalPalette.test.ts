import * as fs from "fs";
import * as path from "path";
import {
  OKABE_ITO,
  CATEGORICAL_PALETTE,
  OKABE_ITO_EXTRAS,
  SERIES_MARKERS,
  SERIES_DASHES,
  seriesStyle,
  seriesMarkerSvg,
  cvdDeltaE,
  worstPair,
} from "../categoricalPalette";
import { USPTO_DASHES, nonBlackWhitePaints } from "../figureStyle";

const hex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");

describe("Okabe-Ito colours match the published RGB values (J*Fly Fig. 16)", () => {
  test("all eight", () => {
    expect(OKABE_ITO.black).toBe(hex(0, 0, 0));
    expect(OKABE_ITO.orange).toBe(hex(230, 159, 0));
    expect(OKABE_ITO.skyBlue).toBe(hex(86, 180, 233));
    expect(OKABE_ITO.bluishGreen).toBe(hex(0, 158, 115));
    expect(OKABE_ITO.yellow).toBe(hex(240, 228, 66));
    expect(OKABE_ITO.blue).toBe(hex(0, 114, 178));
    expect(OKABE_ITO.vermilion).toBe(hex(213, 94, 0));
    expect(OKABE_ITO.reddishPurple).toBe(hex(204, 121, 167));
  });
  test("the default six plus the two flagged extras are exactly the eight", () => {
    expect(new Set([...CATEGORICAL_PALETTE, ...OKABE_ITO_EXTRAS])).toEqual(new Set(Object.values(OKABE_ITO)));
    expect(CATEGORICAL_PALETTE).toHaveLength(6);
  });
});

describe("CVD validation (Machado 2009, severity 1.0, OKLab x100) reproduces the header", () => {
  const header = fs.readFileSync(path.join(__dirname, "..", "categoricalPalette.ts"), "utf8");
  test("minimum pairwise ΔE under protan/deutan is 7.6, bluish green vs reddish purple, deutan", () => {
    const w = worstPair(CATEGORICAL_PALETTE, ["protan", "deutan"], "all")!;
    expect(w.deltaE.toFixed(1)).toBe("7.6");
    expect(new Set([w.a, w.b])).toEqual(new Set([OKABE_ITO.bluishGreen, OKABE_ITO.reddishPurple]));
    expect(w.kind).toBe("deutan");
    expect(header).toContain("MINIMUM PAIRWISE ΔE UNDER CVD SIMULATION: 7.6");
  });
  test("worst ADJACENT pair is 15.8 (the order was chosen for this)", () => {
    const w = worstPair(CATEGORICAL_PALETTE, ["protan", "deutan"], "adjacent")!;
    expect(w.deltaE.toFixed(1)).toBe("15.8");
    expect(header).toContain("ΔE 15.8 (deutan)");
  });
  test("normal-vision floor: all pairs 15.6 (validator floor 15)", () => {
    const w = worstPair(CATEGORICAL_PALETTE, ["normal"], "all")!;
    expect(w.deltaE.toFixed(1)).toBe("15.6");
    expect(w.deltaE).toBeGreaterThanOrEqual(15);
  });
  test("tritan worst all-pairs 8.5, as quoted", () => {
    expect(worstPair(CATEGORICAL_PALETTE, ["tritan"], "all")!.deltaE.toFixed(1)).toBe("8.5");
  });
  test("identical colours have ΔE 0 and the distance is symmetric", () => {
    expect(cvdDeltaE("#0072B2", "#0072B2", "deutan")).toBe(0);
    expect(cvdDeltaE("#0072B2", "#D55E00")).toBeCloseTo(cvdDeltaE("#D55E00", "#0072B2"), 12);
  });
  test("refuses a malformed colour", () => {
    expect(() => cvdDeltaE("#12345", "#000000")).toThrow(RangeError);
    expect(() => cvdDeltaE("red", "#000000")).toThrow(RangeError);
  });
});

describe("redundant encoding: markers and dashes", () => {
  test("series 0-11 are pairwise distinct with colour removed", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const s = seriesStyle(i, { grey: true });
      keys.add(`${s.marker}|${s.filled}|${s.dash}`);
    }
    expect(keys.size).toBe(12);
  });
  test("dashes match the patent style so a series looks alike in both modes", () => {
    expect([...SERIES_DASHES]).toEqual(USPTO_DASHES);
  });
  test("colours cycle over the validated six", () => {
    expect(seriesStyle(0).color).toBe(OKABE_ITO.blue);
    expect(seriesStyle(6).color).toBe(OKABE_ITO.blue);
    expect(seriesStyle(6).filled).toBe(false);
    expect(seriesStyle(NaN).color).toBe(OKABE_ITO.blue);
    expect(seriesStyle(-3).marker).toBe("circle");
  });
  test("every marker renders, and grey mode emits only black and white", () => {
    for (let i = 0; i < 12; i++) {
      const svg = seriesMarkerSvg(seriesStyle(i, { grey: true }), 10, 10);
      expect(svg).toMatch(/^<(circle|rect|path) /);
      expect(nonBlackWhitePaints(svg)).toEqual([]);
    }
    expect(SERIES_MARKERS).toHaveLength(6);
  });
  test("colour markers carry the series colour", () => {
    const s = seriesStyle(1);
    expect(seriesMarkerSvg(s, 0, 0)).toContain(OKABE_ITO.vermilion);
  });
});
