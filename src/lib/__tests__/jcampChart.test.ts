// Drawing a MEASURED spectrum (spectraChart.jcampChartSvg + decimateTrace).
//
// Two things here are easy to get wrong in ways that produce a plausible
// picture rather than an obvious error, which is why they are tested rather
// than eyeballed:
//
//   AXIS DIRECTION. IR, Raman and NMR are conventionally drawn with their x
//   quantity increasing LEFTWARD. Getting it backwards yields a clean mirror
//   image that looks like a spectrum and is not the user's spectrum.
//
//   DECIMATION. A 30,000-point trace cannot go into an SVG as-is. The obvious
//   reduction — keep every nth point — drops any peak narrower than the stride,
//   silently, leaving a tidy spectrum with a missing band. That is the single
//   worst thing this code could do to a measured file, so the test asserts the
//   extremes survive rather than asserting a point count.

import { jcampChartSvg, decimateTrace, MeasuredTrace } from "../spectraChart";
import { parseJcamp } from "../jcamp";

const trace = (kind: MeasuredTrace["kind"], pts: { x: number; y: number }[]): MeasuredTrace => ({
  title: "Test", kind, xUnits: "1/CM", yUnits: "TRANSMITTANCE", points: pts,
});

const ramp = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

describe("decimation keeps the peaks", () => {
  it("a short trace is returned untouched", () => {
    const pts = ramp(50);
    expect(decimateTrace(pts, 1200)).toEqual(pts);
  });

  it("stays within the budget for a long trace", () => {
    const out = decimateTrace(ramp(30000), 1200);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.length).toBeGreaterThan(100);
  });

  it("a ONE-POINT SPIKE survives — the thing stride sampling loses", () => {
    // Flat baseline of 30,000 points with a single sharp peak. Keeping every
    // 25th point would miss it unless it happened to land on a multiple of 25.
    const pts = ramp(30000).map((p) => ({ x: p.x, y: 0 }));
    pts[7013] = { x: 7013, y: 999 };
    const out = decimateTrace(pts, 1200);
    expect(out.some((p) => p.y === 999 && p.x === 7013)).toBe(true);
  });

  it("a one-point NEGATIVE spike survives too (absorbance dips downward)", () => {
    const pts = ramp(30000).map((p) => ({ x: p.x, y: 1 }));
    pts[21111] = { x: 21111, y: -50 };
    const out = decimateTrace(pts, 1200);
    expect(out.some((p) => p.y === -50)).toBe(true);
  });

  it("several spikes all survive", () => {
    const pts = ramp(20000).map((p) => ({ x: p.x, y: 0 }));
    for (const i of [11, 999, 4321, 8888, 15000, 19999]) pts[i] = { x: i, y: 100 + i };
    const out = decimateTrace(pts, 1000);
    for (const i of [11, 999, 4321, 8888, 15000, 19999]) {
      expect(`${i}: ${out.some((p) => p.x === i) ? "kept" : "LOST"}`).toBe(`${i}: kept`);
    }
  });

  it("x stays monotonic, so the polyline never doubles back", () => {
    const pts = ramp(9000).map((p) => ({ x: p.x, y: Math.sin(p.x / 40) }));
    const out = decimateTrace(pts, 800);
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x);
  });
});

describe("axis direction follows the technique, not the file", () => {
  const pts = [
    { x: 400, y: 10 },
    { x: 4000, y: 90 },
  ];

  it("IR decreases rightward, and says so", () => {
    const svg = jcampChartSvg(trace("ir", pts))!;
    expect(svg).toContain("decreases rightward");
  });
  it("Raman and NMR use the same convention", () => {
    expect(jcampChartSvg(trace("raman", pts))!).toContain("decreases rightward");
    expect(jcampChartSvg(trace("nmr", pts))!).toContain("decreases rightward");
  });
  it("UV-Vis and MS increase rightward, the ordinary direction", () => {
    expect(jcampChartSvg(trace("uvvis", pts))!).toContain("increases rightward");
    expect(jcampChartSvg(trace("ms", pts))!).toContain("increases rightward");
  });
  it("the title marks it MEASURED, never predicted", () => {
    const svg = jcampChartSvg(trace("ir", pts))!;
    expect(svg).toMatch(/measured/i);
    expect(svg).not.toMatch(/predicted|estimate/i);
  });
  it("an empty trace draws nothing rather than an empty frame", () => {
    expect(jcampChartSvg(trace("ir", []))).toBeNull();
  });
});

describe("end to end: a real JCAMP file reaches a chart", () => {
  // The reader was complete and tested for several releases while nothing
  // imported it. This asserts the whole path, parse through to SVG.
  const FILE = [
    "##TITLE=Acetone IR",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=INFRARED SPECTRUM",
    "##XUNITS=1/CM",
    "##YUNITS=TRANSMITTANCE",
    "##FIRSTX=0",
    "##LASTX=4",
    "##NPOINTS=5",
    "##XFACTOR=1",
    "##YFACTOR=1",
    "##XYDATA=(X++(Y..Y))",
    "0 100 90 80 70 60",
    "##END=",
  ].join("\n");

  it("parses, then draws", () => {
    const p = parseJcamp(FILE);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const s = p.spectra[0];
    expect(s.kind).toBe("ir");
    const svg = jcampChartSvg({
      title: s.title, kind: s.kind, xUnits: s.xUnits, yUnits: s.yUnits, points: s.points,
    });
    expect(svg).toBeTruthy();
    expect(svg!).toContain("Acetone IR");
    expect(svg!).toContain("decreases rightward");
  });
});
