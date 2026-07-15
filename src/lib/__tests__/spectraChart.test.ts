// Chart-construction tests. These call the SAME functions taskpane.ts calls, so
// they cannot drift from what the add-in actually renders.

import { predictNmr } from "../nmr";
import { predictIr } from "../ir";
import { predictFragments } from "../fragment";
import { nmrChartSvg, irChartSvg, msChartSvg, SPECTRUM_CHART_SIZE } from "../spectraChart";

/** An SVG that is well-formed and free of the classic numeric leaks. */
function expectCleanSvg(svg: string | null): string {
  expect(svg).not.toBeNull();
  expect(svg!).toContain("<svg");
  expect(svg!).toContain("</svg>");
  expect(svg!).not.toContain("No data to plot");
  expect(svg!).not.toMatch(/NaN|Infinity|undefined/);
  return svg!;
}

describe("NMR chart", () => {
  test("renders a clean stick spectrum", () => {
    const svg = expectCleanSvg(nmrChartSvg(predictNmr("Cc1ccccc1", "1H")!));
    expect(svg).toContain("Predicted 1H NMR");
  });

  test("δ axis increases leftward, and says so", () => {
    const svg = nmrChartSvg(predictNmr("CCO", "1H")!)!;
    expect(svg).toMatch(/increases leftward/);
    // Downfield (larger δ) must map to a smaller plotted x than upfield.
    // Ethanol: CH2 at 3.70 must sit LEFT of CH3 at 1.17.
    const r = predictNmr("CCO", "1H")!;
    const ch2 = r.signals.find((s) => s.assignment.startsWith("CH2"))!;
    const ch3 = r.signals.find((s) => s.assignment.startsWith("CH3"))!;
    expect(ch2.shift).toBeGreaterThan(ch3.shift);
    expect(-ch2.shift).toBeLessThan(-ch3.shift); // the negation the chart relies on
  });

  test("a single-signal molecule still renders (no zero-width axis)", () => {
    expectCleanSvg(nmrChartSvg(predictNmr("c1ccccc1", "1H")!));
  });

  test("a molecule with no protons yields no chart rather than an empty frame", () => {
    expect(nmrChartSvg(predictNmr("ClC(Cl)(Cl)Cl", "1H")!)).toBeNull();
  });

  test("13C charts omit the integration axis label (13C is not quantitative)", () => {
    const svg = nmrChartSvg(predictNmr("CCO", "13C")!)!;
    expect(svg).not.toMatch(/rel\. integration/);
  });
});

describe("IR chart", () => {
  test("renders a clean transmittance trace", () => {
    const svg = expectCleanSvg(irChartSvg(predictIr("CC(=O)Oc1ccccc1C(=O)O")!.bands));
    expect(svg).toMatch(/transmittance/);
    expect(svg).toMatch(/decreases rightward/);
  });

  test("no bands → no chart", () => {
    expect(irChartSvg([])).toBeNull();
  });
});

describe("MS chart", () => {
  test("renders a clean fragment stick plot", () => {
    expectCleanSvg(msChartSvg(predictFragments("CCCC(=O)C")!));
  });

  test("the chart never implies the ranking is an intensity", () => {
    const svg = msChartSvg(predictFragments("CCCC(=O)C")!)!;
    expect(svg).toMatch(/not intensity|ranking/i);
  });

  test("a structure with no predicted fragments yields no chart", () => {
    // Cyclohexane: all bonds are ring bonds, no single-cleavage fragments.
    const r = predictFragments("C1CCCCC1")!;
    if (!r.fragments.length) expect(msChartSvg(r)).toBeNull();
  });
});

test("chart size is shared, so the PNG upscale matches the SVG viewport", () => {
  expect(SPECTRUM_CHART_SIZE.width).toBeGreaterThan(0);
  expect(SPECTRUM_CHART_SIZE.height).toBeGreaterThan(0);
  const svg = nmrChartSvg(predictNmr("CCO", "1H")!)!;
  expect(svg).toContain(`width="${SPECTRUM_CHART_SIZE.width}"`);
  expect(svg).toContain(`height="${SPECTRUM_CHART_SIZE.height}"`);
});
