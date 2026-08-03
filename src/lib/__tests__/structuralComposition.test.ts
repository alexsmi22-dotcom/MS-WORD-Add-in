// The minor-axis section properties, and the two constructions this bench
// computed for years without ever drawing.
//
// The minor axis is not a nicety. A column buckles about whichever axis is
// WEAKEST, and for an I-beam that is emphatically not the axis it was designed
// to bend about — so handing the bending I to a buckling check overstates the
// critical load by the full ratio between them.

import { sectionProperties, SectionSpec } from "../section";
import { analyzeColumn } from "../stress";
import {
  mohrCircleSvg,
  goodmanDiagramSvg,
  columnCurveSvg,
  torsionProfileSvg,
  sectionShapeSvg,
  trussSvg,
  MOHR_CHART_SIZE,
} from "../mechchart";

const props = (spec: SectionSpec) => {
  const p = sectionProperties(spec);
  if ("error" in p) throw new Error(p.error);
  return p;
};

describe("minor-axis section properties", () => {
  it("a rectangle's Iy is h·b³/12, exactly", () => {
    const p = props({ kind: "rect", b: 100, h: 200 });
    expect(p.Iy).toBeCloseTo((200 * 100 ** 3) / 12, 6);
    expect(p.I).toBeCloseTo((100 * 200 ** 3) / 12, 6);
    // Taller than wide, so the weak axis is the vertical one.
    expect(p.Imin).toBe(p.Iy);
  });

  it("an I-beam's Iy matches the standard flange + web formula", () => {
    const p = props({ kind: "ibeam", bf: 100, tf: 10, d: 200, tw: 6 });
    const oracle = 2 * ((10 * 100 ** 3) / 12) + ((200 - 20) * 6 ** 3) / 12;
    expect(p.Iy).toBeCloseTo(oracle, 6);
  });

  it("AN I-BEAM IS AN ORDER OF MAGNITUDE WEAKER ABOUT ITS MINOR AXIS", () => {
    // The number that makes this worth computing at all.
    const p = props({ kind: "ibeam", bf: 100, tf: 10, d: 200, tw: 6 });
    expect(p.I / p.Iy).toBeGreaterThan(10);
  });

  it("a hollow box subtracts its void from the minor axis too", () => {
    const p = props({ kind: "box", b: 100, h: 200, t: 10 });
    const oracle = (200 * 100 ** 3) / 12 - (180 * 80 ** 3) / 12;
    expect(p.Iy).toBeCloseTo(oracle, 6);
  });

  it("a tee's Iy is its two strips about the shared vertical centreline", () => {
    const p = props({ kind: "tee", bf: 100, tf: 10, d: 200, tw: 6 });
    const oracle = ((200 - 10) * 6 ** 3) / 12 + (10 * 100 ** 3) / 12;
    expect(p.Iy).toBeCloseTo(oracle, 6);
  });

  it("A CIRCLE AND A PIPE HAVE NO WEAK AXIS — every centroidal axis is the same", () => {
    for (const spec of [
      { kind: "circle", d: 100 },
      { kind: "pipe", d: 100, t: 5 },
    ] as SectionSpec[]) {
      const p = props(spec);
      expect(p.Iy).toBe(p.I);
      expect(p.Imin).toBe(p.I);
      expect(p.ry).toBeCloseTo(p.r, 12);
    }
  });

  it("ry is sqrt(Iy/A) and Imin is the smaller of the two, for every shape", () => {
    for (const spec of [
      { kind: "rect", b: 100, h: 200 },
      { kind: "rect", b: 200, h: 100 },
      { kind: "circle", d: 60 },
      { kind: "pipe", d: 60, t: 4 },
      { kind: "box", b: 80, h: 160, t: 8 },
      { kind: "ibeam", bf: 120, tf: 12, d: 300, tw: 8 },
      { kind: "tee", bf: 120, tf: 12, d: 300, tw: 8 },
    ] as SectionSpec[]) {
      const p = props(spec);
      expect(p.ry).toBeCloseTo(Math.sqrt(p.Iy / p.A), 9);
      expect(p.Imin).toBeCloseTo(Math.min(p.I, p.Iy), 12);
      expect(p.Iy).toBeGreaterThan(0);
    }
  });

  it("a WIDE rectangle is weak about the OTHER axis, and Imin follows", () => {
    const wide = props({ kind: "rect", b: 200, h: 100 });
    expect(wide.Imin).toBe(wide.I); // bending axis is now the weak one
    expect(wide.I).toBeLessThan(wide.Iy);
  });
});

describe("section -> column: the 10^12 trap", () => {
  // The failure this composition removes. section reports I in mm^4 because
  // that is what every section table prints; column works in m^4. Pasting the
  // bare number across is wrong by 10^12 and the answer looks entirely
  // reasonable.
  const spec: SectionSpec = { kind: "ibeam", bf: 100, tf: 10, d: 200, tw: 6 };

  it("the converted values are what the column engine must be given", () => {
    const p = props(spec);
    const Ism = p.Imin * 1e-12; // mm^4 -> m^4
    const Asm = p.A * 1e-6; // mm^2 -> m^2
    const good = analyzeColumn({ L: 3, E: 200e9, I: Ism, A: Asm, Fy: 250e6, end: "pinned", kCustom: 1 });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // A real 100x200 I-section, 3 m pinned: a few hundred kN.
    expect(good.pCritical).toBeGreaterThan(1e5);
    expect(good.pCritical).toBeLessThan(1e7);
  });

  it("PASTING THE BARE mm^4 NUMBER IS ABSURD BY TWELVE ORDERS, and that is the point", () => {
    const p = props(spec);
    const right = analyzeColumn({ L: 3, E: 200e9, I: p.Imin * 1e-12, A: p.A * 1e-6, Fy: 250e6, end: "pinned", kCustom: 1 });
    const pasted = analyzeColumn({ L: 3, E: 200e9, I: p.Imin, A: p.A * 1e-6, Fy: 250e6, end: "pinned", kCustom: 1 });
    expect(right.ok && pasted.ok).toBe(true);
    if (!right.ok || !pasted.ok) return;
    expect(pasted.pEuler / right.pEuler).toBeCloseTo(1e12, -6);
  });

  it("USING THE BENDING I INSTEAD OF THE MINOR ONE overstates the load by the axis ratio", () => {
    // The second half of the same mistake, and the quieter one: no unit is
    // wrong, the number is simply about the wrong axis.
    const p = props(spec);
    const minor = analyzeColumn({ L: 3, E: 200e9, I: p.Imin * 1e-12, A: p.A * 1e-6, Fy: 250e6, end: "pinned", kCustom: 1 });
    const major = analyzeColumn({ L: 3, E: 200e9, I: p.I * 1e-12, A: p.A * 1e-6, Fy: 250e6, end: "pinned", kCustom: 1 });
    expect(minor.ok && major.ok).toBe(true);
    if (!minor.ok || !major.ok) return;
    expect(major.pEuler / minor.pEuler).toBeCloseTo(p.I / p.Iy, 6);
    expect(major.pEuler / minor.pEuler).toBeGreaterThan(10);
  });
});

describe("what the independent adversarial pass found in the charts", () => {
  // Every case below reproduced a real defect. Two of them exhausted the heap.

  it("AN INFINITE TICK STEP DOES NOT HANG — a frozen pane is a frozen Word", () => {
    // analyzeColumn returns transition = Infinity for a vanishing yield
    // strength, columnCurveSvg fed that straight into its axis limit, and the
    // resulting `t += Infinity` loop consumed 4 GB before dying.
    const col = analyzeColumn({ L: 3, E: 200e9, I: 1e-6, A: 2e-3, Fy: 1e-300, end: "pinned", kCustom: 1 });
    expect(col.ok).toBe(true);
    if (!col.ok) return;
    expect(Number.isFinite(col.slendernessTransition as number)).toBe(false); // still infinite
    const t0 = Date.now();
    const svg = columnCurveSvg({
      E: 200e9, Fy: 1e-300, slenderness: col.slenderness,
      sigmaCritical: 1e6, transition: col.slendernessTransition,
    });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("A ZERO TICK STEP DOES NOT HANG EITHER — a subnormal span underflows the step", () => {
    // 10^floor(log10 x) underflows to 0 for a subnormal span, and `t += 0`
    // never advances.
    for (const [label, svg] of [
      ["torsion", () => torsionProfileSvg(0.04, 0, 1e-323)],
      ["column", () => columnCurveSvg({ E: 1e-300, Fy: 1e-323, slenderness: 1, sigmaCritical: 1e-323, transition: 1 })],
      ["goodman", () => goodmanDiagramSvg({ sigmaM: 1e-323, sigmaA: 1e-323, lines: [{ name: "x", colour: "#000", points: [{ m: 0, a: 1e-323 }, { m: 1e-323, a: 0 }] }] })],
    ] as [string, () => string][]) {
      const t0 = Date.now();
      const out = svg();
      expect(`${label}: ${Date.now() - t0 < 2000}`).toBe(`${label}: true`);
      expect(out.startsWith("<svg")).toBe(true);
    }
  });

  it("a centre far from the origin does not stall the tick walk", () => {
    // Once centre/radius exceeds about 5e15, `t + step === t` in floating point.
    const t0 = Date.now();
    const svg = mohrCircleSvg({ sigmaX: 1e16, sigmaY: 1e16, tauXY: 0, sigma1: 1e16, sigma2: 1e16, centre: 1e16, radius: 1 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("NO BUILDER EVER RETURNS A BLANK WHITE BOX — it says why it is empty", () => {
    // A 118-byte white rect inserts into the document as artwork and renders
    // as nothing. Zero torque is a perfectly legal input that produced one.
    for (const [label, svg] of [
      ["torsion, zero torque", torsionProfileSvg(0.04, 0, 0)],
      ["torsion, NaN diameter", torsionProfileSvg(NaN, 0, 5)],
      ["torsion, negative bore", torsionProfileSvg(0.04, -1, 5)],
      ["column, no inputs", columnCurveSvg({ E: 0, Fy: null, slenderness: 0, sigmaCritical: 0, transition: null })],
      ["section, no strips", sectionShapeSvg({ name: "x", strips: [], depth: 0, yBar: 0, unit: "mm" })],
      ["truss, no joints", trussSvg([], [])],
      ["truss, one joint", trussSvg([{ name: "A", x: 0, y: 0 }], [])],
      ["mohr, non-finite", mohrCircleSvg({ sigmaX: NaN, sigmaY: 0, tauXY: 0, sigma1: 0, sigma2: 0, centre: NaN, radius: NaN })],
      ["goodman, nothing", goodmanDiagramSvg({ sigmaM: 0, sigmaA: 0, lines: [] })],
    ] as [string, string][]) {
      expect(`${label}: ${svg.includes("<text")}`).toBe(`${label}: true`);
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
  });

  it("Iy IS NOT ALWAYS THE MINOR AXIS — a plate on edge is weakest the other way", () => {
    // The first draft asserted Iy was the minor axis in four places, and told
    // the user a 200x50 plate had no weak axis at all.
    const plate = props({ kind: "rect", b: 200, h: 50 });
    expect(plate.Iy).toBeGreaterThan(plate.I);
    expect(plate.minorAxis).toBe("horizontal");
    expect(plate.Imin).toBe(plate.I);
    const tall = props({ kind: "rect", b: 50, h: 200 });
    expect(tall.minorAxis).toBe("vertical");
    expect(tall.Imin).toBe(tall.Iy);
  });

  it("a square and a circle report EQUAL axes rather than a false weak one", () => {
    for (const spec of [
      { kind: "rect", b: 100, h: 100 },
      { kind: "circle", d: 100 },
      { kind: "pipe", d: 100, t: 5 },
      { kind: "box", b: 100, h: 100, t: 10 },
    ] as SectionSpec[]) {
      expect(props(spec).minorAxis).toBe("equal");
    }
  });

  it("the Goodman diagram marks the YIELD point separately for a compressive mean", () => {
    // The fatigue criteria clamp a compressive mean to zero; the Langer line
    // uses its magnitude. One marker against both families made the figure
    // contradict the factor of safety printed above it.
    const two = goodmanDiagramSvg({
      sigmaM: 0, sigmaA: 200, yieldSigmaM: 400, sutMPa: 700, seMPa: 250,
      lines: [{ name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] }],
    });
    expect(two).toContain("fatigue point");
    expect(two).toContain("yield point");
    // With a tensile mean the two coincide, so only one marker is drawn.
    const one = goodmanDiagramSvg({
      sigmaM: 200, sigmaA: 100, yieldSigmaM: 200, sutMPa: 700, seMPa: 250,
      lines: [{ name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] }],
    });
    expect(one).toContain("operating point");
    expect(one).not.toContain("yield point");
  });

  it("the box error message carries no em dash, which now reaches two tools", () => {
    const bad = sectionProperties({ kind: "box", b: 100, h: 200, t: 60 });
    expect("error" in bad).toBe(true);
    if ("error" in bad) expect(bad.error).not.toContain("—");
  });

  it("no chart this module produces contains an em dash", () => {
    // A caption or an axis label is part of the result text, and the pane's
    // insert guard treats an em dash as the non-finite sentinel.
    const charts = [
      mohrCircleSvg({ sigmaX: 100, sigmaY: 60, tauXY: 30, sigma1: 114, sigma2: 46, centre: 80, radius: 34 }),
      goodmanDiagramSvg({ sigmaM: 200, sigmaA: 100, sutMPa: 700, seMPa: 250, lines: [{ name: "G", colour: "#000", points: [{ m: 0, a: 250 }, { m: 700, a: 0 }] }] }),
      columnCurveSvg({ E: 200e9, Fy: 250e6, slenderness: 90, sigmaCritical: 2e8, transition: 125 }),
      torsionProfileSvg(40, 0, 95, "MPa", "mm"),
      trussSvg([{ name: "A", x: 0, y: 0 }, { name: "B", x: 4, y: 0 }], [{ a: "A", b: "B", force: 10 }]),
      sectionShapeSvg({ name: "Rect", strips: [{ b: 100, h: 200, yc: 100, sign: 1 }], depth: 200, yBar: 100, unit: "mm" }),
    ];
    for (const c of charts) {
      expect(c).not.toContain("—");
      expect(c).not.toMatch(/NaN|Infinity/);
    }
  });

  it("the torsion radius axis names its unit and does not read 0.0", () => {
    // Passed in metres, a 20 mm outer radius formatted to one decimal place as
    // "0.0" - a tick that says nothing - on an axis with no unit at all.
    const svg = torsionProfileSvg(40, 0, 95, "MPa", "mm");
    expect(svg).toContain("radius (mm)");
    expect(svg).toContain(">20.0<");
  });
});

describe("Mohr's circle is a CIRCLE", () => {
  const svg = mohrCircleSvg({
    sigmaX: 100, sigmaY: 60, tauXY: 30,
    sigma1: 113.72, sigma2: 46.28, centre: 80, radius: 33.72, unit: "MPa",
  });

  it("renders a well-formed SVG at the exported size", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`width="${MOHR_CHART_SIZE.w}"`);
    expect(svg).toContain(`height="${MOHR_CHART_SIZE.h}"`);
  });

  it("USES A SINGLE RADIUS — an independently scaled plot would draw an ellipse", () => {
    // This is why it does not go through buildPlotSvg.
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<ellipse");
    const m = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(svg);
    expect(m).not.toBeNull();
    expect(Number(m![3])).toBeGreaterThan(1);
  });

  it("marks both principal stresses and the maximum shear", () => {
    expect(svg).toContain("σ₁");
    expect(svg).toContain("σ₂");
    expect(svg).toMatch(/τmax = R/);
  });

  it("carries no NaN and no theme-following colour", () => {
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toContain("current" + "Color");
    expect(svg).not.toContain("var(--");
  });

  it("survives a degenerate state rather than emitting broken geometry", () => {
    for (const bad of [
      mohrCircleSvg({ sigmaX: 0, sigmaY: 0, tauXY: 0, sigma1: 0, sigma2: 0, centre: 0, radius: 0 }),
      mohrCircleSvg({ sigmaX: NaN, sigmaY: 1, tauXY: 1, sigma1: 1, sigma2: 1, centre: NaN, radius: NaN }),
      mohrCircleSvg({ sigmaX: 5, sigmaY: 5, tauXY: 0, sigma1: 5, sigma2: 5, centre: 5, radius: 0 }),
    ]) {
      expect(bad.startsWith("<svg")).toBe(true);
      expect(bad).not.toMatch(/NaN|Infinity/);
    }
  });

  it("a pure hydrostatic state gives a circle of zero radius, not a crash", () => {
    const s = mohrCircleSvg({ sigmaX: 50, sigmaY: 50, tauXY: 0, sigma1: 50, sigma2: 50, centre: 50, radius: 0 });
    expect(s).toContain("<circle");
    expect(s).not.toMatch(/NaN/);
  });
});

describe("the Goodman diagram shows the disagreement", () => {
  const lines = [
    { name: "Modified Goodman", colour: "#2563eb", points: [{ m: 0, a: 250 }, { m: 700, a: 0 }] },
    { name: "Soderberg", colour: "#7c3aed", points: [{ m: 0, a: 250 }, { m: 500, a: 0 }] },
    {
      name: "Gerber",
      colour: "#059669",
      points: Array.from({ length: 41 }, (_, i) => ({ m: (700 * i) / 40, a: 250 * (1 - ((700 * i) / 40 / 700) ** 2) })),
    },
    { name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] },
  ];
  const svg = goodmanDiagramSvg({ sigmaM: 200, sigmaA: 100, sutMPa: 700, seMPa: 250, lines });

  it("draws every locus it is given, plus a legend entry for each", () => {
    expect((svg.match(/<polyline/g) || []).length).toBe(lines.length);
    for (const l of lines) expect(svg).toContain(l.name);
  });

  it("marks the operating point and the load line through the origin", () => {
    // The factor of safety is measured ALONG that line, not vertically.
    expect(svg).toContain("operating point");
    expect(svg).toMatch(/stroke-dasharray/);
  });

  it("carries no NaN and no theme-following colour", () => {
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toContain("current" + "Color");
    expect(svg).not.toContain("var(--");
  });

  it("NEVER EMITS NaN INTO THE SVG, whatever it is handed", () => {
    // Found by this very test on the first run: a non-finite operating stress
    // put NaN into three coordinate attributes, and an SVG carrying NaN is
    // inserted into the document looking like artwork and renders as nothing.
    for (const bad of [
      goodmanDiagramSvg({ sigmaM: 0, sigmaA: 0, lines: [] }),
      goodmanDiagramSvg({ sigmaM: NaN, sigmaA: NaN, lines: [{ name: "x", colour: "#000", points: [] }] }),
      goodmanDiagramSvg({ sigmaM: NaN, sigmaA: 100, sutMPa: 700, seMPa: 250, lines }),
      goodmanDiagramSvg({ sigmaM: 200, sigmaA: Infinity, sutMPa: 700, seMPa: 250, lines }),
      goodmanDiagramSvg({ sigmaM: 200, sigmaA: 100, lines: [{ name: "n", colour: "#000", points: [{ m: NaN, a: 1 }, { m: 2, a: NaN }] }] }),
    ]) {
      expect(bad.startsWith("<svg")).toBe(true);
      expect(bad).not.toMatch(/NaN|Infinity/);
    }
  });

  it("the same holds for Mohr's circle with a finite circle but a bad state", () => {
    // The early return covers a bad centre/radius; this covers the case where
    // those two are fine and a stress component is not.
    const s = mohrCircleSvg({ sigmaX: NaN, sigmaY: 60, tauXY: 30, sigma1: 113, sigma2: 46, centre: 80, radius: 33 });
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toMatch(/NaN|Infinity/);
  });

  it("a locus with a single point is skipped rather than drawn as nothing", () => {
    const s = goodmanDiagramSvg({
      sigmaM: 10, sigmaA: 10,
      lines: [{ name: "one", colour: "#000", points: [{ m: 1, a: 1 }] }],
    });
    expect(s).not.toContain("<polyline");
    expect(s).toContain("<svg");
  });
});
