// The NPSH ledger is the one fluids figure with no flow axis - it must stay
// finite and verdict-honest for every sign of static head.

import { npshLadderSvg, NPSH_CHART_SIZE } from "../mechchart";

const base = {
  surfaceHead: 10.35,
  staticHead: 2,
  vapourHead: 0.24,
  losses: 0.5,
  npshAvailable: 11.61,
  npshRequired: 3,
};

describe("the NPSH ledger figure", () => {
  it("draws five bars, the NPSHr line, and a verdict", () => {
    const svg = npshLadderSvg(base);
    expect(svg).toContain("surface pressure");
    expect(svg).toContain("static head");
    expect(svg).toContain("vapour pressure");
    expect(svg).toContain("suction losses");
    expect(svg).toContain("NPSH available");
    expect(svg).toContain("NPSH required");
    expect(svg).toContain("clears NPSHr");
    expect(svg).not.toContain("NaN");
  });

  it("says CAVITATES when available is below required", () => {
    const svg = npshLadderSvg({ ...base, npshAvailable: 2, npshRequired: 3 });
    expect(svg).toContain("CAVITATES");
    expect(svg).not.toContain("clears NPSHr");
  });

  it("a margin of exactly zero is cavitation, matching the engine's verdict", () => {
    // fluids.ts npshAnalysis: cavitating = (available - required) <= 0. The
    // figure must never print green beside a text verdict that says failure.
    const svg = npshLadderSvg({ ...base, npshAvailable: 3, npshRequired: 3 });
    expect(svg).toContain("CAVITATES");
  });

  it("labels stay on the canvas when a deep lift drives the bars hard right", () => {
    const svg = npshLadderSvg({ ...base, staticHead: -50, npshAvailable: -40.39 });
    // Every label backing rect must end inside the canvas.
    for (const m of svg.matchAll(/<rect x="(-?\d+(?:\.\d+)?)" [^>]*width="(\d+(?:\.\d+)?)"/g)) {
      expect(parseFloat(m[1]) + parseFloat(m[2])).toBeLessThanOrEqual(NPSH_CHART_SIZE.w + 0.5);
    }
  });

  it("a pump ABOVE the liquid (negative static head) still draws finite geometry", () => {
    const svg = npshLadderSvg({ ...base, staticHead: -4, npshAvailable: 5.61 });
    expect(svg).not.toContain("NaN");
    expect(svg).toContain("static head");
    // Every coordinate stays on the canvas.
    for (const m of svg.matchAll(/x1?="(-?\d+(?:\.\d+)?)"/g)) {
      const x = parseFloat(m[1]);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(NPSH_CHART_SIZE.w + 1);
    }
  });

  it("says why it is empty rather than drawing a blank box", () => {
    expect(npshLadderSvg({ ...base, losses: NaN })).toContain("do not define");
    expect(npshLadderSvg({ ...base, surfaceHead: Infinity })).toContain("do not define");
  });
});
