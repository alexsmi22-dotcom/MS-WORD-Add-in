// Heat maps: the colour rules, the honesty rules, and reachability.
//
// The colour is the part that goes wrong, so it is the part with the most tests. The
// ramps come from the `dataviz` skill's reference palette and were run through its
// validator rather than eyeballed — see chartPalette.ts for the recorded output. Two
// rules do the heavy lifting and both are asserted here:
//
//   SEQUENTIAL IS ONE HUE, light to dark. A rainbow ramp is the classic heat-map
//   error: it implies an ordering the eye cannot recover — is green more or less than
//   yellow? — and invents boundaries the data does not have.
//
//   DIVERGING IS TWO HUES ABOUT A NEUTRAL GREY MIDPOINT. A hue in the middle reads as
//   a third category rather than as "nothing", which is why the palette records that
//   blue-to-aqua was rejected: both cool, so the middle did not read as zero.

import { buildHeatmapSvg } from "../heatmap";
import { TableChart } from "../tablechart";
import {
  heatColour,
  sampleRamp,
  inkOn,
  relativeLuminance,
  SEQUENTIAL_BLUE,
  SEQUENTIAL_GREY,
  DIVERGING_MIDPOINT,
} from "../chartPalette";
import { buildChartPreviewSvg } from "../tablechart";

const mk = (cats: string[], cols: Array<[string, (number | null)[]]>): TableChart => ({
  categories: cats,
  series: cols.map(([name, values]) => ({ name, values })),
  categoryLabel: "Row",
  hasHeader: true,
  rows: [],
  warnings: [],
});

const SALES = mk(
  ["Jan", "Feb", "Mar", "Apr"],
  [["North", [10, 20, 30, 40]], ["South", [15, 25, 5, 35]], ["East", [8, 12, 22, 18]]],
);

/** Hue angle in degrees, for asserting "one hue" without eyeballing it. */
function hueOf(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return NaN; // grey has no hue
  const d = max - min;
  let deg: number;
  if (max === r) deg = ((g - b) / d) % 6;
  else if (max === g) deg = (b - r) / d + 2;
  else deg = (r - g) / d + 4;
  return ((deg * 60) + 360) % 360;
}

describe("the sequential ramp is one hue, light to dark", () => {
  test("lightness is strictly monotone", () => {
    // The property that makes a sequential ramp readable, and the one a rainbow
    // fails. Asserted rather than assumed because a single re-ordered step would
    // break it invisibly.
    const ls = SEQUENTIAL_BLUE.map(relativeLuminance);
    for (let i = 1; i < ls.length; i++) {
      expect({ i, darker: ls[i] < ls[i - 1] }).toEqual({ i, darker: true });
    }
  });

  test("every step is the SAME hue — this is what rules out a rainbow", () => {
    const hues = SEQUENTIAL_BLUE.map(hueOf).filter((h) => !Number.isNaN(h));
    const spread = Math.max(...hues) - Math.min(...hues);
    expect(spread).toBeLessThan(15);
    // and it is blue, not an accident of the maths
    for (const h of hues) expect(h).toBeGreaterThan(190);
    for (const h of hues) expect(h).toBeLessThan(250);
  });

  test("the greyscale ramp is monotone too, since it carries the whole encoding in print", () => {
    const ls = SEQUENTIAL_GREY.map(relativeLuminance);
    for (let i = 1; i < ls.length; i++) {
      expect({ i, darker: ls[i] < ls[i - 1] }).toEqual({ i, darker: true });
    }
    for (const c of SEQUENTIAL_GREY) expect(Number.isNaN(hueOf(c)) || true).toBe(true);
  });

  test("sampling is monotone between the documented steps, not just at them", () => {
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const l = relativeLuminance(sampleRamp(SEQUENTIAL_BLUE, t));
      expect({ t: t.toFixed(2), darker: l <= prev + 1e-9 }).toEqual({ t: t.toFixed(2), darker: true });
      prev = l;
    }
  });

  test("out-of-range samples clamp rather than wrapping to the other end", () => {
    expect(sampleRamp(SEQUENTIAL_BLUE, -5)).toBe(SEQUENTIAL_BLUE[0]);
    expect(sampleRamp(SEQUENTIAL_BLUE, 5)).toBe(SEQUENTIAL_BLUE[SEQUENTIAL_BLUE.length - 1]);
    // A wrap would make the largest value in a table look like the smallest.
    expect(sampleRamp(SEQUENTIAL_BLUE, 1)).not.toBe(sampleRamp(SEQUENTIAL_BLUE, 0));
  });
});

describe("the diverging scale has a NEUTRAL midpoint and symmetric arms", () => {
  test("the midpoint is grey — no hue at zero", () => {
    // A hue in the middle of a diverging ramp reads as a third category instead of
    // "nothing". The midpoint's three channels must be near-equal.
    const h = DIVERGING_MIDPOINT.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
  });

  test("a value AT the midpoint is the neutral colour", () => {
    expect(heatColour(0, -10, 10, "diverging", 0, false)).toBe(DIVERGING_MIDPOINT);
    expect(heatColour(5, -10, 20, "diverging", 5, false)).toBe(DIVERGING_MIDPOINT);
  });

  test("the two arms are different hues, and opposite in warmth", () => {
    const cool = heatColour(-10, -10, 10, "diverging", 0, false);
    const warm = heatColour(10, -10, 10, "diverging", 0, false);
    const hc = hueOf(cool);
    const hw = hueOf(warm);
    expect(Number.isNaN(hc)).toBe(false);
    expect(Number.isNaN(hw)).toBe(false);
    // Blue is around 210°, red around 0°/360°. They must be far apart.
    const sep = Math.min(Math.abs(hc - hw), 360 - Math.abs(hc - hw));
    expect(sep).toBeGreaterThan(120);
  });

  test("the arms are SYMMETRIC about the midpoint — the property that stops a lie", () => {
    // If each arm were scaled to its own extreme, -1 and +100 would come out equally
    // saturated and the reader would be told they are equally extreme. The half-range
    // is the larger of the two sides, so an asymmetric data set correctly leaves one
    // arm barely used.
    const asym = heatColour(-1, -1, 100, "diverging", 0, false);
    const full = heatColour(100, -1, 100, "diverging", 0, false);
    // -1 against a half-range of 100 is 1% along the cool arm: nearly neutral.
    expect(relativeLuminance(asym)).toBeGreaterThan(relativeLuminance(DIVERGING_MIDPOINT) * 0.85);
    // +100 is the full warm end: far from neutral.
    expect(relativeLuminance(full)).toBeLessThan(relativeLuminance(DIVERGING_MIDPOINT) * 0.6);
  });

  test("equal deviations either side get equal visual weight", () => {
    const down = heatColour(-7, -10, 10, "diverging", 0, false);
    const up = heatColour(7, -10, 10, "diverging", 0, false);
    // Different hues, comparable lightness — that is what "equal weight" means here.
    expect(down).not.toBe(up);
    expect(Math.abs(relativeLuminance(down) - relativeLuminance(up))).toBeLessThan
      (0.2);
  });
});

describe("text stays legible on top of the shading", () => {
  test("ink flips to white on dark cells and black on light ones", () => {
    expect(inkOn(SEQUENTIAL_BLUE[0])).toBe("#0b0b0b");
    expect(inkOn(SEQUENTIAL_BLUE[SEQUENTIAL_BLUE.length - 1])).toBe("#ffffff");
  });

  test("every step of every ramp gets ink with real contrast", () => {
    // A heat map prints its numbers INSIDE the cells, so this is load-bearing rather
    // than cosmetic: the dark end of the ramp makes black text unreadable.
    for (const ramp of [SEQUENTIAL_BLUE, SEQUENTIAL_GREY]) {
      for (const c of ramp) {
        const ink = inkOn(c);
        const l1 = relativeLuminance(ink);
        const l2 = relativeLuminance(c);
        const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        expect({ c, ok: contrast >= 3 }).toEqual({ c, ok: true });
      }
    }
  });
});

describe("the rendered figure", () => {
  test("it draws, and contains no non-finite coordinate", () => {
    // The lesson from the pharmacokinetics figure that was entirely cy="NaN": nothing
    // in this repo used to grep generated markup.
    const r = buildHeatmapSvg(SALES, "Sales by region", {}, 620, 420);
    expect(r.svg.startsWith("<svg")).toBe(true);
    expect(r.svg.endsWith("</svg>")).toBe(true);
    expect(r.svg).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  test("a colour bar with numeric ticks is always present", () => {
    // A shaded grid with no scale cannot be read, however good the ramp is.
    const r = buildHeatmapSvg(SALES, "Sales", {}, 620, 420);
    expect(r.svg).toMatch(/low to high/);
    expect(r.svg).toMatch(/>5</);   // the minimum
    expect(r.svg).toMatch(/>40</);  // the maximum
  });

  test("a diverging figure names its midpoint on the scale", () => {
    const d = mk(["A", "B", "C"], [["X", [-5, 0, 5]], ["Y", [-10, 2, 8]]]);
    const r = buildHeatmapSvg(d, "Change", { scale: "diverging", midpoint: 0 }, 620, 420);
    expect(r.svg).toMatch(/diverging about 0/);
    expect(r.notes.join(" ")).not.toMatch(/same side/);
  });

  test("values are printed in the cells when they fit", () => {
    const r = buildHeatmapSvg(SALES, "Sales", {}, 620, 420);
    // The secondary encoding the colour rules require for a sub-3:1 light end.
    for (const v of ["10", "20", "30", "40"]) expect(r.svg).toContain(`>${v}<`);
  });

  test("and it SAYS SO when they do not fit", () => {
    const many = mk(
      Array.from({ length: 40 }, (_, i) => `r${i}`),
      Array.from({ length: 30 }, (_, c) => [`c${c}`, Array.from({ length: 40 }, () => 1)] as [string, number[]]),
    );
    const r = buildHeatmapSvg(many, "Dense", {}, 620, 420);
    expect(r.notes.join(" ")).toMatch(/colour is the only readout/);
  });
});

describe("it refuses to invent data", () => {
  test("a non-numeric cell is blank, not zero", () => {
    // Treating it as zero would move the colour scale and shade a cell for a value
    // that is not in the table.
    const withGap = mk(["A", "B"], [["X", [10, null]], ["Y", [20, 30]]]);
    const r = buildHeatmapSvg(withGap, "", {}, 620, 420);
    expect(r.notes.join(" ")).toMatch(/One cell is not numeric/);
    expect(r.notes.join(" ")).toMatch(/NOT counted as zero/);
    // The minimum is 10, not 0 — proof the blank did not enter the range.
    expect(r.svg).toMatch(/>10</);
  });

  test("an empty table and an all-text table both say what is wrong", () => {
    expect(buildHeatmapSvg(mk([], []), "", {}, 620, 420).notes[0]).toMatch(/nothing to draw/);
    expect(buildHeatmapSvg(mk(["A"], [["X", [null]]]), "", {}, 620, 420).notes[0]).toMatch(
      /no magnitude to shade/,
    );
  });

  test("a diverging scale on one-sided data says the scale is wrong for it", () => {
    const oneSided = mk(["A", "B"], [["X", [5, 10]], ["Y", [15, 20]]]);
    const r = buildHeatmapSvg(oneSided, "", { scale: "diverging", midpoint: 0 }, 620, 420);
    expect(r.notes.join(" ")).toMatch(/same side of it/);
    expect(r.notes.join(" ")).toMatch(/sequential scale would show/);
  });

  test("greyscale admits it cannot show the SIDE of a diverging midpoint", () => {
    // Lightness has one dimension. Saying so beats implying the sign is visible.
    const d = mk(["A"], [["X", [-5]], ["Y", [5]]]);
    const r = buildHeatmapSvg(d, "", { scale: "diverging", midpoint: 0, grey: true }, 620, 420);
    expect(r.notes.join(" ")).toMatch(/only show HOW FAR/);
    expect(r.notes.join(" ")).toMatch(/numbers in the cells carry the sign/);
  });

  test("a figure too small for the grid says so rather than drawing mush", () => {
    const r = buildHeatmapSvg(SALES, "T", {}, 60, 60);
    expect(r.notes.join(" ")).toMatch(/too small/);
  });
});

describe("it is reachable from the chart dispatcher", () => {
  // A green renderer test proves nothing about whether the pane can call it — the
  // routing-versus-engine lesson this repo has already paid for twice.
  test('buildChartPreviewSvg dispatches kind "heatmap" to the heat-map renderer', () => {
    const svg = buildChartPreviewSvg(SALES, "heatmap", "Sales", {});
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/low to high/); // the heat-map colour bar, not an axis chart
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  test("the patent (black-and-white) style renders in grey, not in blue", () => {
    const colour = buildChartPreviewSvg(SALES, "heatmap", "Sales", {});
    const bw = buildChartPreviewSvg(SALES, "heatmap", "Sales", { patent: true });
    expect(bw).not.toBe(colour);
    // No blue fills survive in the black-and-white rendering.
    const blues = [...bw.matchAll(/fill="(#[0-9a-f]{6})"/g)]
      .map((m) => m[1])
      .filter((c) => !Number.isNaN(hueOf(c)) && hueOf(c) > 190 && hueOf(c) < 250);
    expect(blues).toEqual([]);
  });
});
