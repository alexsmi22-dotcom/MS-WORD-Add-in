// What the independent adversarial pass found in the figure work, and in the
// instrument built to police it.
//
// The instrument's own blind spot is the important one here. It parsed <line>
// and <polyline> and NOT <path> — which is every data curve `buildPlotSvg`
// draws — so it reported a gridline crossing a legend entry and missed the
// curve that entry names. A gate that cannot see the thing it was built for is
// worse than no gate, because it is believed.

/* eslint-disable @typescript-eslint/no-var-requires */
import { buildPlotSvg, parseData, Series } from "../plot";
import { finPerformance, radiationExchange, lumpedCapacitance } from "../heat2";

const audit = require("../../../scripts/figure-layout-audit.js") as {
  auditSvg: (name: string, svg: string) => { found: string[] };
  segments: (svg: string) => unknown[];
  textBoxes: (svg: string) => unknown[];
};

const findings = (svg: string): string[] => audit.auditSvg("t", svg).found;

describe("the layout instrument sees what it claims to", () => {
  it("PARSES <path>, which is every data curve", () => {
    // Identical geometry, two spellings. Only one was detected before.
    const asLine =
      '<svg width="200" height="100"><g font-size="10"><line x1="0" y1="48" x2="200" y2="48" stroke="#000"/>' +
      '<text x="50" y="50">struck out</text></g></svg>';
    const asPath =
      '<svg width="200" height="100"><g font-size="10"><path d="M0,48 L200,48" stroke="#000" fill="none"/>' +
      '<text x="50" y="50">struck out</text></g></svg>';
    expect(findings(asLine).some((f) => f.startsWith("STRIKETHROUGH"))).toBe(true);
    expect(findings(asPath).some((f) => f.startsWith("STRIKETHROUGH"))).toBe(true);
  });

  it("counts a real plot's curve segments, not only its gridlines", () => {
    const svg = buildPlotSvg(
      [{ points: Array.from({ length: 60 }, (_, i) => ({ x: i, y: Math.sin(i / 5) })), type: "line", color: "#000", label: "s" }],
      { width: 380, height: 250, xlabel: "x", ylabel: "y", title: "t" },
    );
    const lineCount = (svg.match(/<line\s/g) || []).length;
    // With <path> parsed the segment total must exceed the <line> count, since
    // the curve itself now contributes.
    expect(audit.segments(svg).length).toBeGreaterThan(lineCount);
  });

  it("still respects paint order — an opaque backing hides what is under it", () => {
    const occluded =
      '<svg width="200" height="100"><g font-size="10"><path d="M0,48 L200,48" stroke="#000" fill="none"/>' +
      '<rect x="30" y="38" width="110" height="16" fill="#ffffff"/><text x="50" y="50">backed</text></g></svg>';
    expect(findings(occluded)).toEqual([]);
  });

  it("does not ignore a whole figure when a path uses a curve command", () => {
    // Arcs and béziers are deliberately not parsed; the lines around them must
    // still be checked rather than the figure being skipped.
    const svg =
      '<svg width="200" height="100"><g font-size="10"><path d="M0,10 C10,10 20,20 30,30" stroke="#000" fill="none"/>' +
      '<line x1="0" y1="48" x2="200" y2="48" stroke="#000"/><text x="50" y="50">struck out</text></g></svg>';
    expect(findings(svg).some((f) => f.startsWith("STRIKETHROUGH"))).toBe(true);
  });
});

describe("the left margin fits the labels that go in it", () => {
  it("ACCOUNTS FOR ERROR BARS, which the drawing code includes unconditionally", () => {
    // Three points at y = 0 with ±30000 bars: the ticks run to five figures
    // even though every y is zero. Reachable from the Plot tab by pasting a
    // third column.
    const svg = buildPlotSvg(
      [{ points: parseData("1 0 30000\n2 0 30000\n3 0 30000"), type: "scatter", color: "#2563eb" }],
      { width: 380, height: 250, xlabel: "x", ylabel: "Signal (counts)" },
    );
    expect(findings(svg)).toEqual([]);
  });

  it("walks the SAME padded range the drawing code walks", () => {
    // The deterministic case the reviewer reduced: a range straddling zero,
    // where the margin came out at the 48 px floor and the leftmost label ran
    // off the canvas.
    const svg = buildPlotSvg(
      [{ points: [{ x: 0, y: -0.29024015524033464 }, { x: 1, y: 0.2817304317016178 }], type: "line", color: "#000" }],
      { width: 380, height: 250, ylabel: "y" },
    );
    expect(findings(svg)).toEqual([]);
  });

  it("NO CLIPPING OR COLLISION over a wide sweep of ranges and magnitudes", () => {
    // 2.6% of random plots used to under-size the margin. A fixed generator so
    // a failure is reproducible from the report.
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) {
      const a = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 10) - 4);
      const b = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 10) - 4);
      const svg = buildPlotSvg(
        [{ points: [{ x: 0, y: Math.min(a, b) }, { x: 1, y: Math.max(a, b) }], type: "line", color: "#000" }],
        { width: 380, height: 250, ylabel: "Signal (counts)", xlabel: "Time (s)" },
      );
      const f = findings(svg);
      if (f.length) bad.push(`[${Math.min(a, b)}, ${Math.max(a, b)}] ${f[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("A TICK THAT SHOULD BE ZERO PRINTS AS ZERO", () => {
    // Walking t += step accumulates float error, so a range across the origin
    // landed on "-2.8e-17" about 2% of the time - a meaningless label, and a
    // wide one at that.
    let seed = 999;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 300; i++) {
      const a = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 8) - 3);
      const b = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 8) - 3);
      const svg = buildPlotSvg(
        [{ points: [{ x: 0, y: Math.min(a, b) }, { x: 1, y: Math.max(a, b) }], type: "line", color: "#000" }],
        { width: 380, height: 250, ylabel: "y" },
      );
      expect(svg).not.toMatch(/>-?\d\.\de-(1[0-9]|[2-9]\d)</);
    }
  });

  it("a legend is opaque, so the curves under it do not strike out its labels", () => {
    const series: Series[] = [0, 1, 2].map((i) => ({
      points: Array.from({ length: 80 }, (_, j) => ({ x: j, y: 100 - j * (i + 1) })),
      type: "line" as const,
      color: ["#2563eb", "#b91c1c", "#059669"][i],
      label: `series ${i}`,
    }));
    const svg = buildPlotSvg(series, { width: 380, height: 250, xlabel: "x", ylabel: "y", title: "t" });
    expect(findings(svg)).toEqual([]);
    expect(svg).not.toMatch(/fill-opacity="0\.8/);
  });
});

describe("the thermal defects the pass found", () => {
  it("THE FIN PROFILE NEVER GOES NaN, however long and thin the fin", () => {
    // Math.cosh overflows past an argument of about 710, so cosh/cosh became
    // Infinity/Infinity. This tool actively invites bad fins - a bad fin is the
    // result it exists to demonstrate.
    const r = finPerformance({ h: 10000, k: 15, L: 0.3, t: 2e-4, width: 1, excessK: 40 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mLc).toBeGreaterThan(710); // the overflow threshold
    const coshRatio = (A: number, B: number): number =>
      Math.exp(A - B) * ((1 + Math.exp(-2 * A)) / (1 + Math.exp(-2 * B)));
    const ys = Array.from({ length: 61 }, (_, i) => {
      const x = (r.lCorrected * i) / 60;
      return 40 * coshRatio(r.m * (r.lCorrected - x), r.mLc);
    });
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(ys[0]).toBeCloseTo(40, 9); // the base sits at the base temperature
    expect(ys.every((y) => y >= 0 && y <= 40.0001)).toBe(true);
    expect(ys[60]).toBeLessThan(1e-6); // and a very long fin's tip is at ambient
  });

  it("FIN EFFECTIVENESS IS INDEPENDENT OF THE DRIVING TEMPERATURE", () => {
    // It is eta*A_fin/A_c; the excess temperature cancels. Computing it as a
    // ratio of heat rates gave 0/0 for a base at ambient - an ordinary input -
    // and silently dropped all three effectiveness notes with it.
    const zero = finPerformance({ h: 40, k: 200, L: 0.05, t: 0.003, width: 1, excessK: 0 });
    const hot = finPerformance({ h: 40, k: 200, L: 0.05, t: 0.003, width: 1, excessK: 60 });
    expect(zero.ok && hot.ok).toBe(true);
    if (!zero.ok || !hot.ok) return;
    expect(Number.isFinite(zero.effectiveness)).toBe(true);
    expect(zero.effectiveness).toBeCloseTo(hot.effectiveness, 12);
    expect(zero.notes.length).toBe(hot.notes.length);
  });

  it("radiation at EQUAL TEMPERATURES does not report a NaN share", () => {
    // The tool's own default convection coefficient is non-zero, so typing the
    // same temperature twice gave "radiation carries NaN% of the total".
    const r = radiationExchange({ geometry: "large", t1C: 27, t2C: 27, eps1: 0.8, eps2: 0.8, area: 1, hConv: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/NaN/);
    expect(r.notes.join(" ")).toMatch(/same temperature/);
  });

  it("lumped capacitance stays finite, or refuses", () => {
    const huge = lumpedCapacitance({
      h: 20, k: 200, rho: 2700, cp: 900, volume: 1e-4, area: 0.06,
      tInit: 200, tAmbient: 25, timeS: 1e307,
    });
    if (huge.ok) {
      expect(huge.curve.every((c) => Number.isFinite(c.t) && Number.isFinite(c.T))).toBe(true);
      expect(Number.isFinite(huge.energyJ)).toBe(true);
    }
    // A density that overflows the time constant must refuse rather than
    // return "The time constant is Infinity s."
    const over = lumpedCapacitance({
      h: 1, k: 1e9, rho: 1e308, cp: 1e10, volume: 1e-3, area: 1,
      tInit: 200, tAmbient: 25, timeS: 10,
    });
    expect(over.ok).toBe(false);
  });
});
