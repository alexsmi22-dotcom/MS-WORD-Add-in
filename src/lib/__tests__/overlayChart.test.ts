// The measured-vs-predicted figure (overlayChart.ts), docs/SCOPE-SPECTROSCOPY-BATCH.md §B2/§E8.
//
// What is pinned: reversed axes carry un-negated labels, MS is head-to-tail,
// the title is measured and truncated (no new CLIPPED waiver), the caveats that
// change how the figure reads are drawn INTO it, and the SVG declares the size
// it is drawn at (Word inserts at the intrinsic size).

import * as fs from "fs";
import * as path from "path";
import { parseJcamp, JcampSpectrum } from "../jcamp";
import { overlaySpectrum, predictedFromNmr, predictedFromIr, predictedFromFragments, predictedFromUv, OverlayOk, OverlayResult, PredictedSpectrum } from "../spectrumOverlay";
import { overlayChartSvg, fitTitle, OVERLAY_CHART_SIZE } from "../overlayChart";
import { predictNmr } from "../nmr";
import { predictIr } from "../ir";
import { predictUvVis } from "../uvvis";
import { predictFragments } from "../fragment";

const DIR = path.join(__dirname, "fixtures", "jcamp");
const block = (t: string): JcampSpectrum => {
  const r = parseJcamp(t);
  if (!r.ok) throw new Error(r.error);
  return r.spectra[r.defaultIndex];
};
const fixture = (f: string) => block(fs.readFileSync(path.join(DIR, f), "latin1"));
const ok = (r: OverlayResult): OverlayOk => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const dims = (svg: string) => {
  const m = /^<svg[^>]*\swidth="([\d.]+)"\s+height="([\d.]+)"\s+viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error("no svg dims");
  return { w: Number(m[1]), h: Number(m[2]), vw: Number(m[3]), vh: Number(m[4]) };
};
/** Every <text> element's content. */
const texts = (svg: string): string[] => Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)).map((m) => m[1]);

const irFile = (title: string) => {
  const xs: number[] = [];
  for (let x = 450; x <= 3966; x += 4) xs.push(x);
  const peaks: [number, number][] = [[3674, 0.19], [2978, 0.89], [1066, 1]];
  const lines: string[] = [];
  for (let i = 0; i < xs.length; i += 8) {
    lines.push(`${xs[i]} ${xs.slice(i, i + 8).map((x) => Math.round(1e5 * peaks.reduce((t, [c, h]) => t + h / (1 + ((x - c) / 8) ** 2), 0))).join(" ")}`);
  }
  return `##TITLE=${title}\n##DATA TYPE=INFRARED SPECTRUM\n##MOLFORM=C 2 H 6 O\n##STATE=gas\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##YFACTOR=0.00001\n##FIRSTX=450\n##LASTX=3966\n##NPOINTS=${xs.length}\n##XYDATA=(X++(Y..Y))\n${lines.join("\n")}\n##END=`;
};

describe("the overlay figure", () => {
  const c13 = ok(overlaySpectrum(fixture("BRUKPAC.DX"), predictedFromNmr(predictNmr("CCc1ccccc1", "13C")!), { reference: { measured: 86.25, trueValue: 77.16 } }));

  test("NMR: δ increases leftward and the tick labels are the real values (no negated axis)", () => {
    const svg = overlayChartSvg(c13)!;
    expect(svg).toContain("δ (ppm) — increases leftward");
    const ticks = texts(svg).filter((t) => /^[−-]?\d+(\.\d+)?$/.test(t));
    expect(ticks.length).toBeGreaterThan(3);
    // The referenced axis runs from −9.09 to 230.3: at most one tick can be negative,
    // and it carries a TRUE minus.
    expect(ticks.filter((t) => t.startsWith("-"))).toEqual([]);
    expect(ticks.some((t) => Number(t) >= 200)).toBe(true);
  });

  test("both series are in the legend, measured and predicted, in two colours", () => {
    const svg = overlayChartSvg(c13)!;
    expect(svg).toContain("measured — test32");
    expect(svg).toContain("predicted (estimate)");
    expect(svg).toContain("#2563eb");
    expect(svg).toContain("#ea580c");
  });

  test("the SVG declares the size it is drawn at, and holds no NaN", () => {
    const svg = overlayChartSvg(c13)!;
    const d = dims(svg);
    expect(d.w).toBe(d.vw);
    expect(d.h).toBe(d.vh);
    expect(d.w).toBeGreaterThanOrEqual(OVERLAY_CHART_SIZE.width);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  test("'a prediction is not an assignment' is IN the figure, not only beside it", () => {
    const all = texts(overlayChartSvg(c13)!).join(" ");
    expect(all).toMatch(/proximity, not identity/);
    expect(all).toMatch(/6 of 6 predicted lines/);
  });

  test("the unreferenced offset caveat is drawn into the figure", () => {
    const r = ok(overlaySpectrum(fixture("BRUKPAC.DX"), predictedFromNmr(predictNmr("CCc1ccccc1", "13C")!)));
    const all = texts(overlayChartSvg(r)!).join(" ");
    expect(all).toMatch(/looks offset by \+9/);
    expect(all).toMatch(/Not assessed/);
    expect(all).not.toMatch(/predicted lines have a measured peak/);
  });

  test("IR: wavenumber decreases rightward, labels un-negated, the gas-phase note is in the figure", () => {
    const r = ok(overlaySpectrum(block(irFile("Ethanol")), predictedFromIr(predictIr("CCO")!)));
    const svg = overlayChartSvg(r)!;
    expect(svg).toContain("wavenumber (cm⁻¹) — decreases rightward");
    const ticks = texts(svg).filter((t) => /^[−-]?\d+$/.test(t));
    expect(ticks.some((t) => Number(t) >= 3000)).toBe(true);
    expect(ticks.filter((t) => /^[−-]/.test(t))).toEqual([]);
    expect(texts(svg).join(" ")).toMatch(/Gas-phase spectrum/);
  });

  test("MS is head-to-tail: predicted sticks drawn below zero, labelled by magnitude", () => {
    const ms = `##TITLE=Acetone\n##DATA TYPE=MASS SPECTRUM\n##XUNITS=M/Z\n##YUNITS=RELATIVE INTENSITY\n##PEAK TABLE=(XY..XY)\n15,1201 42,961 43,9999 58,2484\n##END=`;
    const r = ok(overlaySpectrum(block(ms), predictedFromFragments(predictFragments("CC(C)=O")!)));
    const svg = overlayChartSvg(r)!;
    expect(svg).toContain("rel. intensity (%) — predicted below");
    expect(svg).toContain("predicted (below)");
    // Tick labels never show a minus on the head-to-tail axis.
    expect(texts(svg).filter((t) => /^[−-]\d/.test(t))).toEqual([]);
    expect(texts(svg).join(" ")).toMatch(/RANKING/);
  });

  test("UV: a λmax marker, wavelength increasing rightward", () => {
    const pts = Array.from({ length: 200 }, (_, i) => {
      const x = 230 + i * 0.2;
      return `${x.toFixed(2)},${(1 + 1 / (1 + ((x - 260.6) / 2) ** 2)).toFixed(5)}`;
    });
    const t = `##TITLE=Toluene\n##DATA TYPE=UV/VIS SPECTRUM\n##XUNITS=NANOMETERS\n##YUNITS=ABSORBANCE\n##XYPOINTS=(XY..XY)\n${pts.join("\n")}\n##END=`;
    const r = ok(overlaySpectrum(block(t), predictedFromUv(predictUvVis("Cc1ccccc1")!) as PredictedSpectrum));
    const svg = overlayChartSvg(r)!;
    expect(svg).toContain("wavelength (nm)");
    expect(svg).toContain("predicted λmax");
  });
});

describe("the title is measured and truncated (no new CLIPPED waiver)", () => {
  test("a long file title is cut with an ellipsis to the measured width", () => {
    const long = "A".repeat(200);
    const r = ok(overlaySpectrum(block(irFile(long)), predictedFromIr(predictIr("CCO")!)));
    const svg = overlayChartSvg(r)!;
    const title = /<text[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/.exec(svg)![1];
    expect(title.endsWith("…")).toBe(true);
    // 13 px bold, bounded at 8.6 px per character inside the 380 px canvas.
    expect(title.length * 8.6).toBeLessThanOrEqual(OVERLAY_CHART_SIZE.width - 16 + 8.6);
  });

  test("fitTitle leaves a short title alone and collapses whitespace", () => {
    expect(fitTitle("IR —  measured   vs predicted")).toBe("IR — measured vs predicted");
  });
});
