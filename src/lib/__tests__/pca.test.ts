import { pca, trapz } from "../pca";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("PCA", () => {
  it("perfectly correlated variables collapse to one component", () => {
    const r = ok(pca([[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]]));
    expect(r.explained[0]).toBeCloseTo(1, 10);
    expect(r.explained[1]).toBeCloseTo(0, 10);
    expect(r.componentsFor95).toBe(1);
  });

  it("independent standardised variables split the variance evenly", () => {
    // Two orthogonal patterns of equal spread.
    const data = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const r = ok(pca(data));
    expect(r.explained[0]).toBeCloseTo(0.5, 6);
    expect(r.explained[1]).toBeCloseTo(0.5, 6);
  });

  it("explained fractions sum to 1 and cumulative is monotone", () => {
    const rnd = (() => {
      let s = 7;
      return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    })();
    const data = Array.from({ length: 40 }, () => [rnd(), rnd(), rnd(), rnd()]);
    const r = ok(pca(data));
    expect(r.explained.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (let i = 1; i < r.cumulative.length; i++) {
      expect(r.cumulative[i]).toBeGreaterThanOrEqual(r.cumulative[i - 1] - 1e-12);
    }
    expect(r.cumulative[r.cumulative.length - 1]).toBeCloseTo(1, 10);
  });

  it("variance is DESCENDING — the first component is the largest", () => {
    const data = Array.from({ length: 30 }, (_, i) => [i, i * 0.5 + (i % 3), (i % 7) - 3]);
    const r = ok(pca(data));
    for (let i = 1; i < r.variance.length; i++) {
      expect(r.variance[i]).toBeLessThanOrEqual(r.variance[i - 1] + 1e-12);
    }
  });

  it("scores are centred: each component's scores average to zero", () => {
    const data = [[2, 8], [4, 5], [6, 9], [8, 1], [10, 6]];
    const r = ok(pca(data));
    for (let c = 0; c < r.scores[0].length; c++) {
      const m = r.scores.reduce((s, row) => s + row[c], 0) / r.scores.length;
      expect(m).toBeCloseTo(0, 9);
    }
  });

  it("loadings are orthonormal", () => {
    const data = Array.from({ length: 25 }, (_, i) => [i, (i * i) % 11, (i * 3) % 7, i % 5]);
    const r = ok(pca(data));
    const k = r.loadings[0].length;
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) {
        const dot = r.loadings.reduce((s, row) => s + row[a] * row[b], 0);
        expect(dot).toBeCloseTo(a === b ? 1 : 0, 7);
      }
    }
  });

  it("the total variance equals the sum of the input variances (standardised = p)", () => {
    const data = Array.from({ length: 20 }, (_, i) => [i, 2 * i + 1, (i % 4) * 3]);
    const r = ok(pca(data, true));
    // Standardising makes every variable unit variance, so the total is p.
    expect(r.variance.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 6);
  });

  it("covariance mode keeps the original scales", () => {
    const data = [[1, 1000], [2, 2000], [3, 3000], [4, 4000]];
    const cov = ok(pca(data, false));
    // The large column dominates entirely on covariance...
    expect(cov.explained[0]).toBeCloseTo(1, 6);
    // ...and the result says which basis was used.
    expect(cov.notes.join(" ")).toMatch(/Covariance basis/);
    expect(ok(pca(data, true)).notes.join(" ")).toMatch(/Standardised/);
  });

  it("refuses a constant column when standardising, with the reason", () => {
    const r = pca([[1, 5], [2, 5], [3, 5]], true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/never vary/);
  });

  it("refuses degenerate and non-finite input", () => {
    expect(pca([[1, 2]]).ok).toBe(false); // one row
    expect(pca([[1], [2]]).ok).toBe(false); // one column
    expect(pca([[1, 2], [3]]).ok).toBe(false); // ragged
    expect(pca([[1, 2], [3, NaN]]).ok).toBe(false);
    expect(pca([[1, 1], [1, 1], [1, 1]], false).ok).toBe(false); // no variance
  });

  it("warns when observations are scarce relative to variables", () => {
    const data = [[1, 2, 3, 4, 5], [2, 1, 4, 3, 6], [5, 4, 3, 2, 1]];
    expect(ok(pca(data)).notes.join(" ")).toMatch(/fewer observations|three observations per variable/i);
  });

  it("always states that component signs are arbitrary", () => {
    expect(ok(pca([[1, 2], [3, 5], [5, 4], [7, 9]])).notes.join(" ")).toMatch(/sign.*arbitrary/i);
  });
});

describe("trapz", () => {
  it("integrates y = x exactly (it is a straight line)", () => {
    const xs = Array.from({ length: 11 }, (_, i) => i);
    const r = ok(trapz(xs, xs));
    expect(r.area).toBeCloseTo(50, 12);
    expect(r.meanValue).toBeCloseTo(5, 12);
  });

  it("a constant integrates to height x width", () => {
    const r = ok(trapz([0, 1, 2, 3], [7, 7, 7, 7]));
    expect(r.area).toBeCloseTo(21, 12);
    expect(r.meanValue).toBeCloseTo(7, 12);
  });

  it("handles UNEVEN spacing", () => {
    // y = x on x = 0, 1, 10 → 0.5 + 49.5 = 50
    expect(ok(trapz([0, 1, 10], [0, 1, 10])).area).toBeCloseTo(50, 12);
  });

  it("the cumulative curve ends at the total and starts at zero", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [1, 3, 2, 5, 4];
    const r = ok(trapz(xs, ys));
    expect(r.cumulative[0]).toBe(0);
    expect(r.cumulative[r.cumulative.length - 1]).toBeCloseTo(r.area, 12);
    expect(r.cumulative).toHaveLength(xs.length);
  });

  it("approaches the true integral of a curve as sampling tightens", () => {
    const exact = 2; // ∫ sin x dx over [0, π]
    const at = (n: number): number => {
      const xs = Array.from({ length: n + 1 }, (_, i) => (Math.PI * i) / n);
      return ok(trapz(xs, xs.map(Math.sin))).area;
    };
    expect(Math.abs(at(10) - exact)).toBeLessThan(0.02);
    expect(Math.abs(at(1000) - exact)).toBeLessThan(1e-5);
    // And it UNDER-estimates a concave-down curve, as the note says.
    expect(at(10)).toBeLessThan(exact);
  });

  it("a decreasing x gives the negative area, and says so", () => {
    const r = ok(trapz([10, 5, 0], [10, 5, 0]));
    expect(r.area).toBeCloseTo(-50, 12);
    expect(r.notes.join(" ")).toMatch(/NEGATIVE/);
  });

  it("flags non-monotonic x rather than silently integrating a loop", () => {
    expect(ok(trapz([0, 5, 2, 8], [1, 2, 3, 4])).notes.join(" ")).toMatch(/not monotonic/);
  });

  it("flags very uneven spacing", () => {
    expect(ok(trapz([0, 1, 2, 100], [1, 1, 1, 1])).notes.join(" ")).toMatch(/very uneven/);
  });

  it("refuses mismatched or too-short input", () => {
    expect(trapz([1, 2], [1]).ok).toBe(false);
    expect(trapz([1], [1]).ok).toBe(false);
    expect(trapz([1, NaN], [1, 2]).ok).toBe(false);
  });
});

describe("the em-dash sentinel — notes from THIS module reach an insertable result", () => {
  // The registry-scanning gate in analyzeCalcText.test.ts reads taskpane.ts and
  // therefore cannot see note strings built here. An em dash anywhere in an
  // Analyze result disables Insert for the whole tool, so the pane runs these
  // through plainDashes. This test pins that the pane still does it.
  const pane = require("fs").readFileSync(
    require("path").resolve(__dirname, "..", "..", "taskpane", "taskpane.ts"),
    "utf8",
  ) as string;

  for (const id of ["pca", "trapz"]) {
    it(`${id} passes library notes through plainDashes`, () => {
      const start = pane.indexOf(`id: "${id}"`);
      expect(start).toBeGreaterThan(-1);
      const body = pane.slice(start, pane.indexOf("\n  },", start));
      expect(body).toMatch(/plainDashes\(`Note: \$\{n\}`\)/);
      expect(body).toMatch(/plainDashes\(res\.error\)/);
    });
  }
});
