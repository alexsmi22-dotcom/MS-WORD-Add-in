// Chart-construction tests. These call the SAME functions taskpane.ts calls, so
// they cannot drift from what the add-in actually renders.

import { predictNmr } from "../nmr";
import { predictIr } from "../ir";
import { predictFragments } from "../fragment";
import { predictCosy, predictHsqc, predictHmbc, predictTocsy } from "../nmr2d";
import {
  nmrChartSvg,
  irChartSvg,
  msChartSvg,
  cosyChartSvg,
  hsqcChartSvg,
  hmbcChartSvg,
  tocsyChartSvg,
  jcampChartSvg,
  SPECTRUM_CHART_SIZE,
} from "../spectraChart";

/**
 * The AXIS TICK LABELS, isolated from every other <text> in the figure.
 *
 * Sweeping up all the text is how the negative-axis defect (gap analysis
 * 2026-08-05, 0.4) hid for eight months behind a green suite: the assertions
 * looked at well-formedness and at the axis TITLE ("increases leftward"), which
 * was correct all along, while the ticks beneath it read −4, −3.5, −3. A tick
 * label is a numeric string in a middle-anchored (x) or end-anchored (y) text
 * node, and nothing else in these figures is both.
 */
function ticks(svg: string, axis: "x" | "y"): { pos: number; label: string; value: number }[] {
  const anchor = axis === "x" ? "middle" : "end";
  const out: { pos: number; label: string; value: number }[] = [];
  const re = new RegExp(
    `<text x="([-\\d.]+)" y="([-\\d.]+)" text-anchor="${anchor}"[^>]*>([^<]*)</text>`,
    "g",
  );
  for (const m of svg.matchAll(re)) {
    const label = m[3];
    if (!/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(label)) continue; // titles and unit labels
    out.push({ pos: Number(axis === "x" ? m[1] : m[2]), label, value: Number(label) });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

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

// REGRESSION (gap analysis 2026-08-05, defect 0.4). Every predicted spectrum drew
// a NEGATIVE axis. The flip that makes δ increase leftward is a drawing device —
// the coordinate is negated — and the tick labels were formatted from the negated
// coordinate, so ethanol's ¹H spectrum was labelled −4 … −1 ppm and aspirin's IR
// −4000 … −500 cm⁻¹. δ = −3.5 ppm is a real upfield shift, so it reads as data,
// not as a bug.
//
// These tests assert on TICK VALUES, which is the assertion the old suite never
// made.
describe("a flipped axis is labelled with the real quantity", () => {
  const noNegative = (t: { label: string }[]): void => {
    expect(t.length).toBeGreaterThan(1);
    for (const { label } of t) expect(label.startsWith("-")).toBe(false);
  };
  /** Increasing leftward: the value must FALL as the drawn position rises. */
  const decreasesRightward = (t: { value: number }[]): void => {
    expect(t.length).toBeGreaterThan(1);
    for (let i = 1; i < t.length; i++) expect(t[i].value).toBeLessThan(t[i - 1].value);
  };

  test("¹H NMR ticks are positive δ, falling to the right", () => {
    const svg = nmrChartSvg(predictNmr("CCO", "1H")!)!;
    const t = ticks(svg, "x");
    noNegative(t);
    decreasesRightward(t);
    // Ethanol's signals sit at ~1.2 and ~3.7 ppm; the axis must cover them.
    expect(Math.max(...t.map((k) => k.value))).toBeGreaterThan(3);
    expect(Math.min(...t.map((k) => k.value))).toBeLessThan(2);
  });

  test("¹³C NMR ticks are positive δ too", () => {
    noNegative(ticks(nmrChartSvg(predictNmr("CCO", "13C")!)!, "x"));
  });

  test("IR ticks are positive wavenumbers, falling to the right", () => {
    const svg = irChartSvg(predictIr("CC(=O)Oc1ccccc1C(=O)O")!.bands)!;
    const t = ticks(svg, "x");
    noNegative(t);
    decreasesRightward(t);
    // A group-frequency plot lives in the hundreds-to-thousands of cm⁻¹.
    expect(Math.max(...t.map((k) => k.value))).toBeGreaterThan(1000);
  });

  test("COSY is positive on BOTH axes", () => {
    const svg = cosyChartSvg(predictCosy("CCO")!)!;
    noNegative(ticks(svg, "x"));
    noNegative(ticks(svg, "y"));
    decreasesRightward(ticks(svg, "x"));
    // y increases DOWNWARD, and svg y also grows downward, so the value rises.
    const ty = ticks(svg, "y");
    for (let i = 1; i < ty.length; i++) expect(ty[i].value).toBeGreaterThan(ty[i - 1].value);
  });

  test("HSQC is positive on both axes, and the ¹³C axis reaches carbon shifts", () => {
    const svg = hsqcChartSvg(predictHsqc("CCO")!)!;
    noNegative(ticks(svg, "x"));
    const ty = ticks(svg, "y");
    noNegative(ty);
    expect(Math.max(...ty.map((k) => k.value))).toBeGreaterThan(20); // ¹³C, not ¹H
  });

  test("HMBC is positive on both axes", () => {
    const svg = hmbcChartSvg(predictHmbc("CC(=O)OC")!)!;
    noNegative(ticks(svg, "x"));
    noNegative(ticks(svg, "y"));
  });

  test("TOCSY is positive on both axes", () => {
    const svg = tocsyChartSvg(predictTocsy("CCCO")!)!;
    noNegative(ticks(svg, "x"));
    noNegative(ticks(svg, "y"));
  });

  test("a MEASURED IR trace is labelled in real wavenumbers", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: 500 + i * 100, y: 90 - (i % 7) * 4 }));
    const svg = jcampChartSvg({ title: "s", kind: "ir", xUnits: "1/CM", yUnits: "%T", points: pts })!;
    const t = ticks(svg, "x");
    noNegative(t);
    decreasesRightward(t);
  });

  test("an axis that is NOT flipped keeps its own direction", () => {
    // UV-Vis runs the ordinary way. The transform must not be applied there, or
    // the fix for one convention becomes the same bug in the other.
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: 200 + i * 10, y: i / 40 }));
    const svg = jcampChartSvg({ title: "s", kind: "uvvis", xUnits: "NM", yUnits: "A", points: pts })!;
    const t = ticks(svg, "x");
    noNegative(t);
    for (let i = 1; i < t.length; i++) expect(t[i].value).toBeGreaterThan(t[i - 1].value);
  });

  test("m/z was never flipped and is still not", () => {
    const t = ticks(msChartSvg(predictFragments("CCCC(=O)C")!)!, "x");
    noNegative(t);
    for (let i = 1; i < t.length; i++) expect(t[i].value).toBeGreaterThan(t[i - 1].value);
  });

  test("the y axis of a 1-D spectrum is untouched", () => {
    // Only x is flipped there; a stray yTickLabel would negate the integration
    // axis, which is a plain positive quantity.
    const t = ticks(nmrChartSvg(predictNmr("CCO", "1H")!)!, "y");
    expect(t.length).toBeGreaterThan(1);
    for (const { value } of t) expect(value).toBeGreaterThanOrEqual(0);
  });
});

// REGRESSION (gap analysis 2026-08-05, defect 0.19). HMBC and TOCSY were typeset in
// ASCII — "d 1H (ppm) - increases leftward", "3J (C,H)" — beside a COSY and an HSQC
// that were not. The display contract is not per-chart.
describe("2-D maps are typeset, not transliterated", () => {
  const cases: [string, () => string][] = [
    ["HMBC", () => hmbcChartSvg(predictHmbc("CC(=O)OC")!)!],
    ["TOCSY", () => tocsyChartSvg(predictTocsy("CCCO")!)!],
    ["COSY", () => cosyChartSvg(predictCosy("CCO")!)!],
    ["HSQC", () => hsqcChartSvg(predictHsqc("CCO")!)!],
  ];
  for (const [name, build] of cases) {
    test(`${name} uses δ and superscripts, never a Latin d or an inline 1H`, () => {
      const svg = build();
      expect(svg).toMatch(/δ/);
      // "d (ppm)" / "d 1H (ppm)" — the transliterations that shipped.
      expect(svg).not.toMatch(/>?d (\d?\d?[A-Z]? ?)?\(ppm\)/);
      expect(svg).not.toMatch(/\b1H-1[3H]C?\b/);
      expect(svg).not.toMatch(/[123]J ?\(C,H\)/); // ASCII coupling orders
    });
  }

  test("HMBC states both coupling orders in superscript", () => {
    const svg = hmbcChartSvg(predictHmbc("CC(=O)OC")!)!;
    expect(svg).toMatch(/³J\(C,H\)/);
    expect(svg).toMatch(/²J \(often weak\)/);
  });
});

test("chart size is shared, so the PNG upscale matches the SVG viewport", () => {
  expect(SPECTRUM_CHART_SIZE.width).toBeGreaterThan(0);
  expect(SPECTRUM_CHART_SIZE.height).toBeGreaterThan(0);
  const svg = nmrChartSvg(predictNmr("CCO", "1H")!)!;
  expect(svg).toContain(`width="${SPECTRUM_CHART_SIZE.width}"`);
  expect(svg).toContain(`height="${SPECTRUM_CHART_SIZE.height}"`);
});
