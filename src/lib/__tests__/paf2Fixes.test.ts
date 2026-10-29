// fix2-paf: confirmed defects from the 2026-10-24 Plot/Analyze/Finance review,
// each pinned here. Oracles: numpy / scipy / numpy-financial in
// C:\Users\AlexanderSmith\jurislab-oracle-venv (scripts quoted per block).

import { spectrum, dominantFrequencies, windowCoefficients } from "../fft";

const tone = (n: number, fs: number, f: number, a = 1): number[] =>
  Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));
const peak = (bins: { freq: number; magnitude: number }[]) =>
  bins.reduce((m, b) => (b.magnitude > m.magnitude ? b : m));

describe("1–2. FFT amplitude and windows", () => {
  it("a unit 10 Hz sine reads 1.000 whatever the padding (100 and 1000 samples, fs = 100)", () => {
    // numpy: 2*abs(np.fft.rfft(np.sin(2*np.pi*10*np.arange(N)/100)))/N → 1.0 at bin 10·N/100
    for (const n of [100, 1000]) {
      for (const win of ["none", "hann", "hamming", "blackman"] as const) {
        const p = peak(spectrum(tone(n, 100, 10), 100, win));
        expect(p.freq).toBeCloseTo(10, 9);
        expect(p.magnitude).toBeCloseTo(1, 9);
      }
    }
    // Odd length (no Nyquist bin) and a power of two still agree.
    expect(peak(spectrum(tone(99, 99, 11, 2), 99, "none")).magnitude).toBeCloseTo(2, 9);
    expect(peak(spectrum(tone(128, 128, 16), 128, "none")).magnitude).toBeCloseTo(1, 9);
  });

  it("windowed spectra read A (coherent gain = Σw over the original samples)", () => {
    for (const k of ["hann", "hamming", "blackman"] as const) {
      expect(peak(spectrum(tone(96, 128, 16, 3), 128, k)).magnitude).toBeCloseTo(3, 6);
    }
  });

  it("periodic Hann: the 8-sample default example reads 1.000", () => {
    const sig = [0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707];
    const p = peak(spectrum(sig, 8, "hann"));
    expect(p.freq).toBe(1);
    expect(p.magnitude).toBeCloseTo(1, 3);
    const w = windowCoefficients("hann", 8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
  });

  it("dominantFrequencies: a 5.5 Hz tone reports no false 1 Hz peak", () => {
    for (const [n, fs] of [[64, 64], [100, 100], [200, 50]]) {
      const dom = dominantFrequencies(tone(n, fs, 5.5), fs, 3);
      expect(dom.length).toBeGreaterThan(0);
      expect(Math.abs(dom[0].freq - 5.5)).toBeLessThan(fs / n + 1e-9);
      expect(dom.some((d) => d.freq < 3)).toBe(false);
    }
  });

  it("dominant amplitude matches the plotted spectrum (same pipeline)", () => {
    const sig = tone(96, 128, 16, 2).map((x) => x + 5);
    const d = dominantFrequencies(sig, 128, 1)[0];
    const p = spectrum(sig, 128).find((b) => b.freq === d.freq)!;
    expect(d.magnitude).toBeCloseTo(p.magnitude, 6);
    expect(d.magnitude).toBeCloseTo(2, 6);
  });
});

import {
  blackScholes,
  blackScholesGreeks,
  sigmaZeroAtForward,
  amortizationSummary,
  amortizationRowAt,
  amortizationSchedule,
  decliningBalanceSchedule,
  perpetuity,
  growingPerpetuity,
  readFinanceField,
  IRR_SEARCH_RANGE_TEXT,
  XIRR_SEARCH_RANGE_TEXT,
} from "../finance";

describe("3. Black–Scholes at σ = 0", () => {
  it("prices the deterministic limit max(S − K·e^(−rt), 0), not intrinsic", () => {
    expect(blackScholes("call", 100, 100, 1, 0.05, 0)).toBeCloseTo(100 - 100 * Math.exp(-0.05), 12);
    expect(blackScholes("put", 90, 100, 1, 0.05, 0)).toBeCloseTo(100 * Math.exp(-0.05) - 90, 12);
    expect(blackScholes("put", 100, 100, 1, 0.05, 0)).toBe(0);
    // continuity: σ → 0⁺ approaches the same value
    expect(blackScholes("call", 100, 100, 1, 0.05, 1e-6)).toBeCloseTo(blackScholes("call", 100, 100, 1, 0.05, 0), 6);
    expect(blackScholes("call", 100, 100, 1, 0.05, -0.1)).toBeNaN();
  });
  it("Greeks at σ = 0: delta a step, gamma and vega 0, theta/rho of the forward", () => {
    const g = blackScholesGreeks("call", 110, 100, 1, 0.05, 0);
    expect(g).toEqual({ delta: 1, gamma: 0, vega: 0, theta: -0.05 * 100 * Math.exp(-0.05), rho: 100 * Math.exp(-0.05), psi: -110 });
    const p = blackScholesGreeks("put", 80, 100, 1, 0.05, 0);
    expect(p.delta).toBe(-1);
    expect(p.theta).toBeCloseTo(0.05 * 100 * Math.exp(-0.05), 12);
    const near = blackScholesGreeks("call", 110, 100, 1, 0.05, 1e-7);
    expect(near.delta).toBeCloseTo(1, 9);
    expect(near.theta).toBeCloseTo(g.theta, 6);
  });
  it("exactly at the money forward the Greeks are undefined and named", () => {
    const S = 100 * Math.exp(-0.05);
    expect(sigmaZeroAtForward(S, 100, 1, 0.05, 0)).toBe(true);
    expect(blackScholesGreeks("call", S, 100, 1, 0.05, 0).delta).toBeNaN();
    expect(sigmaZeroAtForward(100, 100, 1, 0.05, 0)).toBe(false);
  });
});

describe("4. Loan summary in closed form, no 12,000-period cap", () => {
  // npf.pmt(0.05/365, 14600, -200000) = 31.686094228698845; ×14600 − 200000 = 262616.97573900316
  // npf.pmt(0.05/12, 360, -200000) = 1073.6432460242797; interest 186511.56856874068
  it("200,000 at 5% for 40 years daily → 31.69 and 262,616.98", () => {
    const s = amortizationSummary(200000, 0.05 / 365, 40 * 365);
    expect(s.payment).toBeCloseTo(31.686094228698845, 9);
    expect(s.totalInterest).toBeCloseTo(262616.97573900316, 4);
  });
  it("matches the schedule where the schedule is uncapped (30 y monthly)", () => {
    const s = amortizationSummary(200000, 0.05 / 12, 360);
    expect(s.totalInterest).toBeCloseTo(186511.56856874068, 5);
    const rows = amortizationSchedule(200000, 0.05 / 12, 360);
    for (const k of [1, 2, 180, 359, 360]) {
      const a = amortizationRowAt(200000, 0.05 / 12, 360, k);
      expect(a.interest).toBeCloseTo(rows[k - 1].interest, 6);
      expect(a.balance).toBeCloseTo(rows[k - 1].balance, 5);
    }
    expect(amortizationRowAt(1200, 0, 12, 6).balance).toBe(600);
  });
});

describe("5. Declining balance keeps a fractional life", () => {
  it("life 7.5 → rate 2/7.5 and a half-year final row", () => {
    const rows = decliningBalanceSchedule(10000, 0, 7.5, 2);
    expect(rows).toHaveLength(8);
    expect(rows[0].depreciation).toBeCloseTo(10000 * (2 / 7.5), 9);
    const before = rows[6].bookValue;
    expect(rows[7].depreciation).toBeCloseTo(before * (2 / 7.5) * 0.5, 9);
    expect(decliningBalanceSchedule(10000, 1000, 5, 2)).toHaveLength(5); // whole life unchanged
  });
});

import { solveBvp } from "../bvp";

describe("6. BVP with no solution is refused, not answered", () => {
  it("y'' = −y on [0, π], y(0) = 0, y(π) = 1 → named refusal (resonance), both methods", () => {
    for (const method of ["fd", "shooting"] as const) {
      const out = solveBvp((_x, y) => -y, 0, Math.PI, 0, 1, { method });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error).toMatch(/NO solution/);
        expect(out.error).toMatch(/resonance/);
        expect(out.error).not.toMatch(/-\d/);
      }
    }
  });
  it("well-posed problems still solve, including exact and all-zero ones", () => {
    const a = solveBvp((_x, y) => -y, 0, 1, 0, 1);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const mid = (a.result.x.length - 1) / 2;
      expect(a.result.y[mid]).toBeCloseTo(Math.sin(0.5) / Math.sin(1), 5);
    }
    const z = solveBvp(() => 0, 0, 1, 0, 0);
    expect(z.ok).toBe(true);
    const lin = solveBvp(() => 0, 0, 2, 0, 6, { method: "shooting" });
    expect(lin.ok).toBe(true);
  });
});

import { parseNumberCell, parseTableData, buildChartPreviewSvg } from "../tablechart";
import { buildTree, isTreeHeader } from "../tablediagram";
import { parseTable, analyzeData } from "../insights";
import { svd, inverse, solve, determinant, rank, parseMatrix, conditionLines, conditionNumber } from "../linalg";
import { samplePlot, robustYLimits, typesetExprLabel, plotAxisTicks, buildPlotSvg } from "../plot";
import { nonBlackWhitePaints } from "../figureStyle";
import { cashFlowLadderSvg, withFinFig, moneyOverTimeSvg, currentFinFig as currentFinFigForTest } from "../financeFigures";
import { textWidthPt } from "../arialMetrics";

describe("7. Table→Chart cells follow the decimal-comma rule", () => {
  it.each([
    ["3,5", 3.5],
    ["0,5", 0.5],
    ["€3,5", 3.5],
    ["1.234,5", 1234.5],
    ["1,000", 1000],
    ["12,345,678", 12345678],
    ["1,234.5", 1234.5],
    ["(1,200)", -1200],
    ["3,5 kg", 3.5],
    ["2.5×10³", 2500],
  ])("%s → %d", (s, v) => expect(parseNumberCell(s)).toBe(v));
  it.each(["1,2,3", "1.2,3.4", "12,34,5"])("ambiguous %s is refused (null)", (s) => expect(parseNumberCell(s)).toBeNull());
});

describe("8. A header row of years is a header", () => {
  it("Region | 2021 | 2022 | 2023 → series named by year, regions as categories", () => {
    const c = parseTableData([
      ["Region", "2021", "2022", "2023"],
      ["North", "120", "135", "150"],
      ["South", "80", "95", "90"],
    ]);
    expect(c.hasHeader).toBe(true);
    expect(c.series.map((s) => s.name)).toEqual(["2021", "2022", "2023"]);
    expect(c.categories).toEqual(["North", "South"]);
    expect(c.series[0].values).toEqual([120, 80]);
  });
  it("a body of years with a year row is not guessed into a header", () => {
    const c = parseTableData([
      ["Founded", "1998", "2003"],
      ["Rebuilt", "2010", "2015"],
    ]);
    expect(c.hasHeader).toBe(false);
  });
});

describe("9. Block diagram skips its header row", () => {
  it("System | Subsystem | Component is not a branch", () => {
    const rows = [
      ["System", "Subsystem", "Component"],
      ["Robot", "Arm", "Gripper"],
      ["Robot", "Arm", "Wrist"],
      ["Robot", "Base", "Motor"],
    ];
    expect(isTreeHeader(rows[0])).toBe(true);
    const t = buildTree(rows);
    expect(t.roots.map((r) => r.label)).toEqual(["Robot"]);
    expect(t.warnings.join(" ")).toMatch(/header/);
    expect(isTreeHeader(["Robot", "Arm", "Gripper"])).toBe(false);
  });
});

describe("10. Pie refuses negatives by name, warns on zeros", () => {
  const c = parseTableData([
    ["Part", "Share"],
    ["A", "5"],
    ["B", "0"],
    ["C", "−2"],
  ]);
  it("names the negative slice", () => {
    const r = buildChartPreviewSvg(c, "pie");
    expect(r.svg).toContain("cannot show negative values");
    expect(r.svg).toContain("“C” (−2)");
  });
  it("zeros draw nothing and are said so", () => {
    const z = parseTableData([
      ["Part", "Share"],
      ["A", "5"],
      ["B", "0"],
    ]);
    expect(buildChartPreviewSvg(z, "pie").warnings.join(" ")).toMatch(/“B” is zero/);
  });
});

describe("11. Legend swatches are drawn like their data", () => {
  it("USPTO Table→Chart scatter legend uses the series markers, not hatched squares", () => {
    const c = parseTableData([
      ["x", "A", "B"],
      ["1", "2", "3"],
      ["2", "4", "5"],
    ]);
    const svg = buildChartPreviewSvg(c, "scatter", "", { patent: true }).svg;
    expect(svg).not.toMatch(/fill="url\(#fi-/);
    // marker 0 (filled disc) and marker 1 (open disc) appear in data AND legend.
    expect((svg.match(/<circle [^>]*fill="#fff" stroke="#000"/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it("plot.ts: a scatter series' legend swatch is a marker, a line series' a line", () => {
    const svg = buildPlotSvg(
      [
        { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], type: "line", label: "fit" },
        { points: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }], type: "scatter", label: "data" },
      ],
      { bw: true },
    );
    expect(nonBlackWhitePaints(svg)).toEqual([]);
    // the USPTO open disc (scatter series 0 is marker 0: a filled disc) in the legend: 3 discs total
    expect((svg.match(/<circle [^>]*r="3" fill="#000"/g) || []).length).toBe(3);
  });
});

describe("12. Insights reads semicolon data with decimal commas", () => {
  it("a;b / 1,5;2,5 … are numbers", () => {
    const t = parseTable("a;b\n1,5;2,5\n2,5;3,5\n3,5;5,0");
    expect(t.headers).toEqual(["a", "b"]);
    expect(t.columns[0]).toEqual(["1.5", "2.5", "3.5"]);
    const rep = analyzeData("a;b\n1,5;2,5\n2,5;3,5\n3,5;5,0")!;
    expect(rep.columns[0].type).toBe("numeric");
    expect(rep.columns[1].type).toBe("numeric");
  });
});

describe("13. SVD of a rank-deficient matrix has an orthonormal U", () => {
  // numpy: svd([[1,1],[1,1]]) → S = [2, 0], U columns ±[0.7071, 0.7071], ±[−0.7071, 0.7071]
  it("[[1,1],[1,1]]", () => {
    const r = svd([[1, 1], [1, 1]]);
    expect(r.S[0]).toBeCloseTo(2, 12);
    expect(r.S[1]).toBe(0);
    const U = r.U;
    const dot = (i: number, j: number) => U[0][i] * U[0][j] + U[1][i] * U[1][j];
    expect(dot(0, 0)).toBeCloseTo(1, 12);
    expect(dot(1, 1)).toBeCloseTo(1, 12);
    expect(dot(0, 1)).toBeCloseTo(0, 12);
  });
  it("3×3 rank 1 and a wide matrix", () => {
    for (const A of [[[1, 2, 3], [2, 4, 6], [3, 6, 9]], [[1, 2, 3], [2, 4, 6]]]) {
      const { U } = svd(A);
      const k = U[0].length;
      for (let i = 0; i < k; i++)
        for (let j = 0; j < k; j++) {
          let s = 0;
          for (let r = 0; r < U.length; r++) s += U[r][i] * U[r][j];
          expect(s).toBeCloseTo(i === j ? 1 : 0, 10);
        }
    }
  });
});

describe("16. Relative singularity, condition number, true minus", () => {
  // numpy: cond([[2,1],[1,3]]·1e-15) = 2.618; inv = [[6e14, −2e14], [−2e14, 4e14]]; cond(hilbert(10)) = 1.6025e13
  it("a well-conditioned matrix scaled 1e-15 is not singular", () => {
    const A = [[2e-15, 1e-15], [1e-15, 3e-15]];
    const inv = inverse(A)!;
    expect(inv[0][0]).toBeCloseTo(6e14, -2);
    expect(inv[0][1]).toBeCloseTo(-2e14, -2);
    expect(determinant(A)).toBeCloseTo(5e-30, 40);
    expect(solve(A, [[3e-15], [4e-15]])).not.toBeNull();
    expect(rank(A)).toBe(2);
    expect(conditionNumber(A)).toBeCloseTo(2.618034, 5);
  });
  it("exactly singular matrices are still singular; diag(10¹⁵, 1) is not", () => {
    expect(inverse([[1, 2], [2, 4]])).toBeNull();
    expect(determinant([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toBe(0);
    expect(rank([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toBe(2);
    expect(inverse([[1e15, 0], [0, 1]])![0][0]).toBe(1e-15);
  });
  it("Hilbert-10 solves with a condition warning", () => {
    const H = Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 }, (_, j) => 1 / (i + j + 1)));
    expect(inverse(H)).not.toBeNull();
    const lines = conditionLines(H);
    expect(lines[0]).toMatch(/κ₂ = 1\.60\d×10¹³/);
    expect(lines[1]).toMatch(/above 10¹²/);
    expect(conditionLines([[2, 1], [1, 3]])).toHaveLength(1);
  });
  it("accepts −1 (U+2212) and refuses 0x10", () => {
    const p = parseMatrix("1 −1\n−2.5 4");
    expect(p.ok && p.matrix).toEqual([[1, -1], [-2.5, 4]]);
    expect(parseMatrix("0x10 1").ok).toBe(false);
  });
});

describe("17/18. Figures: poles, legends, offset ticks, tiny ladders", () => {
  it("tan(x) breaks at its poles and does not set the y range", () => {
    const pts = samplePlot("tan(x)", -5, 5, 240);
    // three poles in [−5, 5] (±π/2, ±3π/2 → four) — every one is a gap
    expect(pts.filter((p) => p.gap).length).toBe(4);
    const lim = robustYLimits([{ points: pts, type: "line" }])!;
    expect(lim).not.toBeNull();
    expect(lim.max!).toBeLessThan(30);
    expect(lim.min!).toBeGreaterThan(-30);
    // the drawn path starts a new piece at each gap
    const svg = buildPlotSvg([{ points: pts, type: "line" }], { yLimits: lim });
    expect((svg.match(/<path d="M/g) || []).length).toBe(1);
    expect(((svg.match(/<path d="([^"]*)"/) || ["", ""])[1].match(/M/g) || []).length).toBe(5);
  });
  it("1/x breaks once; sin(x) and exp(x) neither break nor clip", () => {
    expect(samplePlot("1/x", -1, 1, 240).filter((p) => p.gap).length).toBe(1);
    expect(samplePlot("sin(x)", -10, 10, 240).some((p) => p.gap)).toBe(false);
    expect(robustYLimits([{ points: samplePlot("exp(x)", 0, 10, 240), type: "line" }])).toBeNull();
  });
  it("legend labels are typeset", () => {
    expect(typesetExprLabel("x^2/50")).toBe("x²/50");
    expect(typesetExprLabel("exp(-x^2)")).toBe("exp(−x²)");
    expect(typesetExprLabel("2*x^(-1)")).toBe("2·x⁻¹");
    expect(typesetExprLabel("x^2.5")).toBe("x^2.5");
  });
  it("ticks on [10⁹, 10⁹ + 1] use an offset", () => {
    const t = plotAxisTicks(1e9 - 0.06, 1e9 + 1.06, false, 6, undefined, undefined);
    expect(t.multiplier).toBe("ticks + 1×10⁹");
    expect(t.ticks.map((k) => k.text)).toEqual(["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
    expect(new Set(t.ticks.map((k) => k.text)).size).toBe(t.ticks.length);
  });
  it("a cash-flow ladder of tiny values gets enough decimals", () => {
    const svg = cashFlowLadderSvg([-0.01, 0.004, 0.004, 0.004], [-0.01, 0.0036, 0.0033, 0.003], "t")!;
    const ticks = [...svg.matchAll(/text-anchor="middle">([^<]+)<\/text>/g)].map((m) => m[1]).filter((s) => /\d/.test(s));
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks.every((s) => s !== "0.00")).toBe(true);
  });
  it("a long ladder title stays inside the canvas (centred on it, or wrapped)", () => {
    const title = "Explicit forecast, discounted (excludes terminal value)";
    const svg = cashFlowLadderSvg([100, 110, 121], [90.9, 90.9, 90.9], title)!;
    const x = Number(/data-figure-title="1" x="([\d.]+)"/.exec(svg)![1]);
    const half = (textWidthPt(title, 11) * 1.25) / 2;
    expect(x - half).toBeGreaterThanOrEqual(0);
    expect(x + half).toBeLessThanOrEqual(400);
    const longer = cashFlowLadderSvg([1], [1], title + " and a much longer tail that cannot fit on one line")!;
    expect(longer).toContain("<tspan");
  });
  it("Finance figures re-render at a width and in black and white", () => {
    const draw = () => moneyOverTimeSvg({ periods: 10, valueAt: (k) => 1000 * 1.05 ** k, title: "t", xlabel: "period" })!;
    const bw = withFinFig({ width: 600, bw: true }, draw);
    // 600 exactly: under a re-render the legend sits below the plot, not in a gutter (lib/figContext.ts, 2026-10-28).
    expect(Number(/^<svg[^>]*width="([\d.]+)"/.exec(bw)![1])).toBe(600);
    expect(nonBlackWhitePaints(bw)).toEqual([]);
    const lad = withFinFig({ width: 300, bw: true }, () => cashFlowLadderSvg([-100, 60, 60], [-100, 54.5, 49.6], "t")!);
    expect(nonBlackWhitePaints(lad)).toEqual([]);
    expect(lad).toContain('<pattern id="fi-diag"');
    // outside withFinFig nothing changes
    expect(draw()).toMatch(/^<svg[^>]*width="427"/); // 360 + the legend gutter, colour, as before
  });
});

import { formatCodeBlock } from "../codeblock";
import { buildResultOoxml } from "../resultOoxml";
import { layoutFlowchart } from "../tablediagram";

describe("Suspicions checked and fixed", () => {
  it("code-block lines are zero-spacing paragraphs (Word read them double-spaced)", () => {
    const html = formatCodeBlock("a = 1\nb = 2", { style: "code", lineNumbers: false });
    expect((html.match(/<p style="margin:0;/g) || []).length).toBe(2);
  });
  it("a result text item's newlines become paragraphs, not spaces in one run", () => {
    const { ooxml } = buildResultOoxml([{ kind: "text", content: "Payment 1.00\nTotal 2.00\n\nNote" }]);
    expect((ooxml.match(/<w:p>/g) || []).length).toBe(3);
    expect(ooxml).toContain("<w:p/>");
    expect(ooxml).not.toMatch(/<w:t[^>]*>[^<]*\n/);
  });
  it("flowchart: with the patent numeral option, ordinal ids 1, 2, 3 become 102, 104, 106; S101 is kept", () => {
    const nums = (rows: string[][]) =>
      layoutFlowchart(rows, "", { numerals: true }).texts.map((t) => t.text).filter((t) => /^(S?\d+)$/.test(t));
    expect(nums([["1", "Start"], ["2", "Measure"], ["3", "End"]])).toEqual(["102", "104", "106"]);
    expect(nums([["S101", "Start"], ["S102", "End"]])).toEqual(["S101", "S102"]);
    // option off: ids drawn as typed
    expect(layoutFlowchart([["1", "Start"], ["2", "End"]]).texts.map((t) => t.text)).toContain("1");
  });
});

import { prepareFigure } from "../insertCapability";
import { polarPlotSvg } from "../polarPlot";

describe("14. USPTO style draws y = f(x), Finance and polar figures (no refusal)", () => {
  const uspto = (svg: string, render: (w: number, st?: { color?: string }) => string) =>
    prepareFigure({ svg, preset: "uspto", width: "single", render: render as never });
  it("a two-function f(x) plot with data re-renders in black and white and passes 37 CFR 1.84", () => {
    const series = [
      { points: samplePlot("x^2/50", -5, 5, 240), type: "line" as const, label: "x²/50" },
      { points: samplePlot("exp(-x^2)", -5, 5, 240), type: "line" as const, label: "exp(−x²)" },
      { points: [{ x: 0, y: 0.8 }, { x: 2, y: 0.2 }], type: "scatter" as const, label: "data" },
    ];
    const render = (w: number, st?: { color?: string }) =>
      buildPlotSvg(series, { xlabel: "x", ylabel: "y", width: w, height: Math.round((270 * w) / 380), bw: st?.color === "bw" });
    const r = uspto(render(380), render);
    expect(r.ok ? "" : `${r.reason}: ${r.problems.join("; ")}`).toBe("");
  });
  it("a Finance figure re-renders through withFinFig and passes", () => {
    const draw = () => moneyOverTimeSvg({ periods: 30, valueAt: (k) => 1000 * 1.05 ** k, title: "Value over time", xlabel: "period" })!;
    const render = (w: number, st?: { color?: string }) => withFinFig({ width: w, bw: st?.color === "bw" }, draw);
    const r = uspto(draw(), render);
    expect(r.ok ? "" : `${r.reason}: ${r.problems.join("; ")}`).toBe("");
    const lad = () => cashFlowLadderSvg([-1000, 500, 500, 500], [-1000, 454.5, 413.2, 375.7], "Cash flows in today's money")!;
    const r2 = uspto(lad(), (w, st) => withFinFig({ width: w, bw: st?.color === "bw" }, lad));
    expect(r2.ok ? "" : `${r2.reason}: ${r2.problems.join("; ")}`).toBe("");
  });
  it("polar: the radial-scale \"r\" is lettered like the other lowercase runs", () => {
    const samples = Array.from({ length: 361 }, (_, i) => ({ theta: (i * Math.PI) / 180, r: 1 + 2 * Math.cos((i * Math.PI) / 180) }));
    const svg = polarPlotSvg({ samples, angleUnit: "rad", bw: true });
    if (svg.includes(">r</text>")) expect(svg).toMatch(/font-size="14"[^>]*>r<\/text>/);
  });
});

import { hBarSvg } from "../mechchart";
import { parseDefinitions, evalMatrixExpression } from "../matrixExpr";

describe("Review round: regressions the first pass could introduce", () => {
  it("flowchart: user numerals 10, 20, 30 are kept with the numeral option on", () => {
    const nums = (rows: string[][]) =>
      layoutFlowchart(rows, "", { numerals: true }).texts.map((t) => t.text).filter((t) => /^\d+$/.test(t));
    expect(nums([["10", "Start"], ["20", "Measure"], ["30", "End"]])).toEqual(["10", "20", "30"]);
    expect(nums([["2", "Start"], ["3", "End"]])).toEqual(["2", "3"]); // not 1..n
  });
  it("insights: a tab-separated US paste 1,250<TAB>3,400 is grouping, not decimal commas", () => {
    const t = parseTable("a\tb\n1,250\t3,400\n2,000\t4,100");
    expect(t.columns.flat()).toContain("1,250"); // left as typed, never rewritten to 1.25
    expect(t.columns.flat()).not.toContain("1.250");
  });
  it("Table→Chart: 1,000 beside 3,5 is ambiguous and refused, with a warning", () => {
    const c = parseTableData([
      ["Item", "Value"],
      ["A", "3,5"],
      ["B", "1,000"],
      ["C", "2,25"],
    ]);
    expect(c.series[0].values).toEqual([3.5, null, 2.25]);
    expect(c.warnings.join(" ")).toMatch(/ambiguous beside decimal commas/);
    // without any decimal comma, 1,000 is grouping as before
    expect(parseTableData([["Item", "Value"], ["A", "1,000"], ["B", "2,500"]]).series[0].values).toEqual([1000, 2500]);
  });
  it("a narrow finite peak (Lorentzian) is not clipped; only poles/gaps trigger the robust range", () => {
    expect(robustYLimits([{ points: samplePlot("1/(x^2+0.001)", -1, 1, 240), type: "line" }])).toBeNull();
  });
  it("a refused pie is flagged so the pane does not insert it", () => {
    const c = parseTableData([["P", "S"], ["A", "5"], ["B", "−1"]]);
    expect(buildChartPreviewSvg(c, "pie").refused).toBe(true);
    expect(buildChartPreviewSvg(parseTableData([["P", "S"], ["A", "5"], ["B", "1"]]), "pie").refused).toBeUndefined();
  });
  it("matrix expressions accept the true minus and ×", () => {
    const d = parseDefinitions("A = 1 −2; 3 4\nB = 1 0; 0 1");
    expect(d.ok).toBe(true);
    if (d.ok) {
      const r = evalMatrixExpression("A − B × 2", d.env);
      expect(r.ok && r.value.kind === "matrix" && r.value.m).toEqual([[-1, -2], [3, 2]]);
    }
  });
  it("the Effective-annual-rate bar figure passes USPTO through the Finance re-render", () => {
    const draw = () => {
      const fig = currentFinFigForTest();
      return hBarSvg(
        [
          { name: "annual", value: 12 },
          { name: "monthly", value: 12.68, colour: "#b91c1c" },
          { name: "daily", value: 12.75 },
        ],
        { title: "Effective annual rate by compounding frequency (%)", unit: "", w: fig?.width ?? 360, bw: fig?.bw },
      );
    };
    const r = prepareFigure({ svg: draw(), preset: "uspto", width: "single", render: ((w: number, st?: { color?: string }) => withFinFig({ width: w, bw: st?.color === "bw" }, draw)) as never });
    expect(r.ok ? "" : `${r.reason}: ${r.problems.join("; ")}`).toBe("");
  });
});

describe("15. Finance field reading and range texts", () => {
  it("reads true minus, grouping, % and refuses hex", () => {
    expect(readFinanceField("−5")).toBe(-5);
    expect(readFinanceField("1,000")).toBe(1000);
    expect(readFinanceField("5%")).toBe(5);
    expect(readFinanceField("+3,5")).toBe(3.5);
    expect(readFinanceField("0x10")).toBeNaN();
    expect(readFinanceField("abc")).toBeNaN();
    expect(readFinanceField("Infinity")).toBeNaN();
  });
  it("perpetuity refuses a non-positive rate; growing needs r > g", () => {
    expect(perpetuity(100, 0)).toBeNaN();
    expect(perpetuity(100, -0.02)).toBeNaN();
    expect(growingPerpetuity(100, 0.03, 0.03)).toBeNaN();
    expect(growingPerpetuity(100, 0.05, 0.03)).toBeCloseTo(5000, 9);
  });
  it("search ranges are written with a true minus", () => {
    expect(IRR_SEARCH_RANGE_TEXT).not.toMatch(/-/);
    expect(XIRR_SEARCH_RANGE_TEXT).toMatch(/^−99\.99%/);
  });
});
