// No generated figure may contain NaN or Infinity in its markup.
//
// This closes a measured coverage gap, not a hypothetical one. The repo has two
// non-finite walkers — engineering.adversarial.test.ts and phase6.adversarial —
// and both recurse into numbers, arrays and objects. Neither looks inside a
// STRING, so neither can see an SVG. Nothing in the repo grepped generated
// markup, which is how a pharmacokinetics figure whose every point was
// cy="NaN" survived six rounds of review: the report above it was numerically
// correct, the x axis still read a plausible 0/10/20/30/40, and the body was
// simply blank.
//
// The trigger was not bad data. plot.ts documents that any caller passing a
// logarithmic scale MUST run dropForScales first; Plot mode did, the PK report
// did not. And in pharmacokinetics a zero concentration is NORMAL: the pre-dose
// sample is zero by definition, and a trailing below-limit-of-quantification
// sample is reported as zero too. log(0) = -Infinity became Infinity/Infinity
// became NaN.
//
// A blank figure is the failure mode this repo has already learned about once —
// see the Engineering tool page that rendered blank for ten releases while the
// layout gate passed it every time, because an empty page cannot overlap itself.
// An all-NaN figure passes every check that looks at numbers.

import { buildPlotSvg, dropForScales } from "../plot";

/** The check the existing walkers structurally cannot make. */
function markupIsFinite(svg: string): string[] {
  const bad: string[] = [];
  for (const m of svg.matchAll(/(?:NaN|-?Infinity|undefined|null)/g)) {
    bad.push(`${m[0]} at offset ${m.index}`);
  }
  return bad;
}

describe("the check itself fails on a known-bad payload", () => {
  // A harness reports itself first. Three separate times in this repo a green
  // result meant the harness was broken, not the code. So: prove the detector
  // fires before trusting it to say "clean".
  test("markupIsFinite catches NaN, Infinity and undefined", () => {
    expect(markupIsFinite('<circle cx="48.0" cy="NaN"/>')).toHaveLength(1);
    expect(markupIsFinite('<line y1="-Infinity"/>')).toHaveLength(1);
    expect(markupIsFinite('<text>undefined</text>')).toHaveLength(1);
    expect(markupIsFinite('<circle cx="48.0" cy="12.5"/>')).toHaveLength(0);
  });

  test("it would have caught the pharmacokinetics figure as it shipped", () => {
    // The defect reproduced exactly: a log y scale, a zero at t = 0, and NO
    // dropForScales call. This is the pre-fix code path.
    const times = [0, 0.5, 1, 2, 4, 8, 12, 24, 48];
    const conc = [0, 12.1, 10.9, 9.6, 7.8, 4.3, 2.4, 1.3, 0.13];
    const svg = buildPlotSvg(
      [{ points: times.map((t, i) => ({ x: t, y: conc[i] })), type: "scatter" }],
      { width: 380, height: 240, yScale: "log" },
    );
    expect(markupIsFinite(svg).length).toBeGreaterThan(0);
  });
});

describe("a log axis with a legitimate zero", () => {
  // Ordinary PK data. The zero is not a typo — it is the pre-dose sample.
  const times = [0, 0.5, 1, 2, 4, 8, 12, 24, 48];
  const conc = [0, 12.1, 10.9, 9.6, 7.8, 4.3, 2.4, 1.3, 0.13];
  const opts = { width: 380, height: 240, yScale: "log" as const };
  const series = [{ points: times.map((t, i) => ({ x: t, y: conc[i] })), type: "scatter" as const }];

  test("dropForScales removes exactly the unplottable point and says so", () => {
    const f = dropForScales(series, opts);
    expect(f.dropped).toBe(1);
    expect(f.axes).toEqual(["y"]);
    expect(f.series[0].points).toHaveLength(8);
    // and the point removed is the zero, not a neighbour
    expect(f.series[0].points.every((p) => p.y > 0)).toBe(true);
  });

  test("the filtered series renders finite markup", () => {
    const svg = buildPlotSvg(dropForScales(series, opts).series, opts);
    expect(markupIsFinite(svg)).toEqual([]);
    expect(svg).toContain("<svg");
  });

  test("a trailing below-limit-of-quantification zero is handled too", () => {
    const blq = [{ points: [
      { x: 0.5, y: 12.1 }, { x: 1, y: 10.9 }, { x: 4, y: 7.8 }, { x: 48, y: 0 },
    ], type: "scatter" as const }];
    const f = dropForScales(blq, opts);
    expect(f.dropped).toBe(1);
    expect(markupIsFinite(buildPlotSvg(f.series, opts))).toEqual([]);
  });

  test("every point unplottable leaves nothing to draw, and the caller must not draw it", () => {
    // The PK report now emits no figure at all in this case rather than an
    // empty one. What matters here is that the library reports it honestly.
    const allZero = [{ points: [{ x: 1, y: 0 }, { x: 2, y: 0 }], type: "scatter" as const }];
    const f = dropForScales(allZero, opts);
    expect(f.dropped).toBe(2);
    expect(f.series.every((s) => s.points.length === 0)).toBe(true);
  });
});

describe("negative values on a log axis", () => {
  test("a negative concentration is dropped, not logged", () => {
    const s = [{ points: [{ x: 1, y: -5 }, { x: 2, y: 10 }], type: "line" as const }];
    const opts = { width: 300, height: 200, yScale: "log" as const };
    const f = dropForScales(s, opts);
    expect(f.dropped).toBe(1);
    expect(markupIsFinite(buildPlotSvg(f.series, opts))).toEqual([]);
  });

  test("a zero on a log X axis is caught on the x axis", () => {
    const s = [{ points: [{ x: 0, y: 1 }, { x: 10, y: 2 }], type: "line" as const }];
    const f = dropForScales(s, { xScale: "log" });
    expect(f.dropped).toBe(1);
    expect(f.axes).toEqual(["x"]);
  });
});

describe("ordinary linear plots stay clean", () => {
  test.each([
    ["single point", [{ x: 5, y: 5 }]],
    ["flat line", [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }]],
    ["vertical", [{ x: 1, y: 0 }, { x: 1, y: 5 }]],
    ["all zero", [{ x: 0, y: 0 }, { x: 1, y: 0 }]],
    ["huge span", [{ x: 0, y: 1e-30 }, { x: 1, y: 1e30 }]],
    ["negatives", [{ x: -5, y: -5 }, { x: 5, y: 5 }]],
  ])("%s", (_label, points) => {
    const svg = buildPlotSvg([{ points, type: "line" }], { width: 300, height: 200 });
    expect(markupIsFinite(svg)).toEqual([]);
  });
});
