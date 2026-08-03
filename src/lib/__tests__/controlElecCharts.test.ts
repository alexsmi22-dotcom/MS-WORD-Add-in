// The three builders added for the control/electronics figure batch. Each is
// probed at its degenerate inputs, because a chart builder's failure mode in
// a task pane is a blank box or a NaN — never an exception the user sees.

import { poleZeroSvg, POLE_ZERO_SIZE, hBarSvg, logicWaveSvg } from "../mechchart";

describe("the pole-zero map", () => {
  it("draws poles, zeros, the axis and the instability shading", () => {
    const svg = poleZeroSvg(
      [{ re: -1, im: 0 }, { re: 0.5, im: 2 }, { re: 0.5, im: -2 }],
      [{ re: -2, im: 0 }],
    );
    expect(svg).toContain("unstable");
    expect(svg).toContain("Pole-zero map");
    expect(svg).not.toContain("NaN");
  });

  it("keeps one scale on both axes, so conjugate pairs mirror exactly", () => {
    const svg = poleZeroSvg([{ re: -1, im: 3 }, { re: -1, im: -3 }], []);
    // The two × marks must be at the same x and symmetric y.
    const xs = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#111111" stroke-width="1.8"\/>/g)];
    expect(xs.length).toBe(4); // two strokes per ×
    expect(svg).not.toContain("NaN");
  });

  it("says why it is empty rather than drawing nothing", () => {
    expect(poleZeroSvg([], [])).toContain("no finite poles");
    expect(poleZeroSvg([{ re: NaN, im: 0 }], [])).toContain("no finite poles");
  });
});

describe("the horizontal bar chart", () => {
  it("labels milliwatt bars with real numbers, not 0.0", () => {
    const svg = hBarSvg(
      [{ name: "R1", value: 2.78e-3 }, { name: "V1", value: -8.33e-3 }],
      { title: "Power per element", unit: "W" },
    );
    expect(svg).toContain("0.00278 W");
    expect(svg).toContain("-0.00833 W");
    expect(svg).not.toMatch(/>0\.0 W</);
    expect(svg).not.toContain("NaN");
  });

  it("grows with the row count and says when rows were dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `e${i}`, value: i + 1 }));
    const svg = hBarSvg(many, { title: "t", unit: "x" });
    expect(svg).toContain("and 6 more");
  });

  it("says why it is empty", () => {
    expect(hBarSvg([], { title: "t", unit: "x" })).toContain("no finite values");
    expect(hBarSvg([{ name: "a", value: Infinity }], { title: "t", unit: "x" })).toContain("no finite values");
  });
});

describe("the logic waveform figure", () => {
  const rows4 = Array.from({ length: 16 }, (_, i) => ({
    inputs: [8, 4, 2, 1].map((b) => (i & b) !== 0),
    output: i % 3 === 0,
  }));

  it("draws one lane per variable plus the output", () => {
    const svg = logicWaveSvg({ variables: ["A", "B", "C", "D"], rows: rows4 });
    for (const v of ["A", "B", "C", "D", "out"]) expect(svg).toContain(`>${v}</text>`);
    expect(svg).not.toContain("NaN");
  });

  it("refuses a table too large to read as waveforms", () => {
    const rows7 = Array.from({ length: 128 }, (_, i) => ({
      inputs: Array.from({ length: 7 }, (_, b) => ((i >> b) & 1) !== 0),
      output: false,
    }));
    expect(logicWaveSvg({ variables: ["A", "B", "C", "D", "E", "F", "G"], rows: rows7 })).toContain("too large");
  });

  it("refuses rows that do not match the variable count", () => {
    expect(
      logicWaveSvg({ variables: ["A", "B"], rows: [{ inputs: [true], output: false }] }),
    ).toContain("too large");
  });
});

describe("size constants", () => {
  it("pole-zero size is what the insert path passes", () => {
    expect(POLE_ZERO_SIZE.w).toBeGreaterThan(0);
    expect(POLE_ZERO_SIZE.h).toBeGreaterThan(0);
  });
});
