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

/** A fixed seed, so a failure is reproducible from the report. */
const railSeed = 8675309;

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

  // The two things added to the bottom of the figure in the 2026-08-05 pass: the
  // "kind not stated" declaration that now fires by DEFAULT on any scatter with
  // error bars, and the footnote block that carries a caveat into the picture.
  // Both live in the strip below the plot frame, which is where the x label
  // already is — so they are exactly the kind of addition this instrument exists
  // to check.
  it("the undeclared-bars line does not land on the x axis label", () => {
    const svg = buildPlotSvg(
      [{ points: parseData("1 10 2\n2 14 1.5\n3 19 3"), type: "scatter", color: "#2563eb" }],
      { width: 380, height: 250, xlabel: "Dose (mg/kg)", ylabel: "Response" },
    );
    expect(svg).toMatch(/kind not stated/);
    expect(findings(svg)).toEqual([]);
  });

  it("a footnote block lays out cleanly, wrapped and inside its own canvas", () => {
    const svg = buildPlotSvg(
      [{ points: parseData("1 10 2\n2 14 1.5\n3 19 3"), type: "scatter", color: "#2563eb", label: "titration" }],
      {
        width: 380,
        height: 250,
        xlabel: "log10[Agonist] (M)",
        ylabel: "Response (% max)",
        errorBars: "sem",
        notes: [
          "⚠ 3 points not plotted: a logarithmic x axis cannot show zero or negative values.",
          "The zero-concentration control is one of them.",
        ],
      },
    );
    expect(findings(svg)).toEqual([]);
    // Every glyph of every note is inside the declared canvas — the whole point
    // of growing the height rather than drawing past it.
    const H = Number(/height="([\d.]+)"/.exec(svg)![1]);
    const W = Number(/width="([\d.]+)"/.exec(svg)![1]);
    for (const m of svg.matchAll(/<text x="8" y="([\d.]+)"[^>]*font-size="9"[^>]*>([^<]*)</g)) {
      expect(Number(m[1]) + 3).toBeLessThanOrEqual(H);
      expect(8 + m[2].length * 6.3).toBeLessThanOrEqual(W);
    }
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

  it("THE RIGHT MARGIN FITS THE LAST X TICK, which was a flat 14 px", () => {
    // x tick labels are centred on their tick, so a tick on the right edge
    // hangs half its width off the canvas. The left margin has been computed
    // from its widest label for a while; the right one was a constant, and
    // "2.5e+4" is 36 px wide. Found on a reliability figure whose x axis runs
    // to a 25,000 hour mission, but the defect is in the shared plotter.
    const svg = buildPlotSvg(
      [{ points: Array.from({ length: 81 }, (_, i) => ({ x: (25000 * i) / 80, y: Math.exp(-i / 20) })), type: "line", color: "#2563eb", label: "system" }],
      { width: 380, height: 260, xlabel: "Hours", ylabel: "Surviving", title: "t" },
    );
    expect(findings(svg)).toEqual([]);
    expect(svg).toContain("2.5e+4");
  });

  it("no x tick is clipped over a wide sweep of magnitudes", () => {
    let seed = railSeed;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      const top = rnd() * Math.pow(10, Math.floor(rnd() * 14) - 6);
      const svg = buildPlotSvg(
        [{ points: [{ x: 0, y: 0 }, { x: top, y: 1 }], type: "line", color: "#000" }],
        { width: 380, height: 250, xlabel: "Time (s)", ylabel: "Signal (counts)" },
      );
      const f = findings(svg);
      if (f.length) bad.push(`x up to ${top}: ${f[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("A TINY AXIS RANGE DOES NOT DRAW HALF A MILLION TICKS", () => {
    // Both tick walks ended at `t <= max + 1e-9` - an ABSOLUTE epsilon, on axes
    // whose whole range may be far smaller than 1e-9. Femtoseconds and nanoamps
    // are ordinary pasted data, and at an x span of 1e-14 that slack was a
    // billion steps wide: 500,007 tick labels and a 128 MB SVG for one plot.
    // That is not a bad-looking chart in a task pane, it is a frozen Word.
    for (const span of [1e-6, 1e-8, 1e-9, 1e-10, 1e-12, 1e-14, 1e-20]) {
      for (const axis of ["x", "y"] as const) {
        const pts = axis === "x" ? [{ x: 0, y: 0 }, { x: span, y: 1 }] : [{ x: 0, y: 0 }, { x: 1, y: span }];
        const svg = buildPlotSvg([{ points: pts, type: "line", color: "#000" }], {
          width: 380,
          height: 260,
          xlabel: "t",
          ylabel: "y",
        });
        const labels = (svg.match(/<text /g) || []).length;
        expect({ span, axis, labels: labels < 40 }).toEqual({ span, axis, labels: true });
        expect({ span, axis, bytes: svg.length < 20000 }).toEqual({ span, axis, bytes: true });
        expect(findings(svg)).toEqual([]);
      }
    }
  });

  it("the tick slack still includes a tick that floating point landed a hair past the end", () => {
    // The relative epsilon must not have thrown away the tick the absolute one
    // was there to keep: 0 to 1 in steps of 0.2 must still print a "1".
    const svg = buildPlotSvg(
      [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], type: "line", color: "#000" }],
      { width: 380, height: 250, xlabel: "x", ylabel: "y" },
    );
    expect(svg).toMatch(/>1</);
    expect(svg).toMatch(/>0</);
  });

  it("the legend sits OUTSIDE the plot frame, so it cannot cover data or be struck by curves", () => {
    const series: Series[] = [0, 1, 2].map((i) => ({
      points: Array.from({ length: 80 }, (_, j) => ({ x: j, y: 100 - j * (i + 1) })),
      type: "line" as const,
      color: ["#2563eb", "#b91c1c", "#059669"][i],
      label: `series ${i}`,
    }));
    const svg = buildPlotSvg(series, { width: 380, height: 250, xlabel: "x", ylabel: "y", title: "t" });
    expect(findings(svg)).toEqual([]);
    expect(svg).not.toMatch(/fill-opacity="0\.8/);
    // The legend box starts at or past the requested canvas width — the gutter
    // widens the canvas rather than shrinking the plot — so every curve pixel
    // (all of which lie left of x = 380) is clear of it.
    const legendBox = svg.match(/<rect x="(\d+(?:\.\d+)?)" y="\d+(?:\.\d+)?" width="\d+" height="\d+" fill="#ffffff" stroke="#ccc"\/>/);
    expect(legendBox).not.toBeNull();
    expect(parseFloat((legendBox as RegExpMatchArray)[1])).toBeGreaterThanOrEqual(380);
    // And the widened canvas declares its true size, so nothing is clipped.
    const width = svg.match(/<svg[^>]*\bwidth="(\d+)"/);
    expect(parseFloat((width as RegExpMatchArray)[1])).toBeGreaterThan(380);
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
