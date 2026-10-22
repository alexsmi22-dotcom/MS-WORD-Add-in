// contour.ts: marching squares (centre-value saddle rule), isobands, holes, the figure.
import { compileExpr } from "../plot";
import { sampleGrid, marchingSquares, isobands, niceLevels, gridRange, contourPlotSvg, Grid, CONTOUR_GRID_MAX } from "../contour";

const grid = (expr: string, x0: number, x1: number, y0: number, y1: number, n: number): Grid =>
  sampleGrid(compileExpr(expr, ["x", "y"]), x0, x1, y0, y1, n, n);

/** Every distinct crossing point on the level's paths. */
function crossingPoints(g: Grid, L: number): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const p of marchingSquares(g, [L])[0].paths) for (const q of p.pts) seen.set(`${q[0].toFixed(10)},${q[1].toFixed(10)}`, q);
  return [...seen.values()];
}

// ORACLE (numpy, scratchpad contour_oracle.py): every grid edge whose ends straddle the level
// (z ≥ L counts as above), crossing at t = (L − va)/(vb − va), ONE point per location (a grid
// vertex exactly on the level is where several edges cross); count, Σx, Σy, Σ(x² + y²):
//
//   xs = np.linspace(x0, x1, n); ys = np.linspace(y0, y1, n); Z = f(*np.meshgrid(xs, ys))
//   for each horizontal and vertical edge: if (va >= L) != (vb >= L): t = (L - va)/(vb - va) …
//
//   circle x²+y², [−3, 3]², 61, L = 2.5 → (108, 1.2e-14, 8.4e-15, 269.8100781113977), max |r − √L| 7.899e-4
//   sin x cos y, [−π, π]², 41, L = 0.5 → (98, −3.1415926535897936, 8.9e-16, 640.3047648944521)
//   x² + 3y² + xy, [−2.5, 3]×[−1.7, 2.2], 47, L = 3 → (112, 0.7848607187330545, −0.32788684237779986, 234.99734693414217)
describe("marching squares against the numpy edge-crossing oracle", () => {
  test.each([
    ["x^2 + y^2", -3, 3, -3, 3, 61, 2.5, 108, 0, 0, 269.8100781113977],
    ["sin(x)*cos(y)", -Math.PI, Math.PI, -Math.PI, Math.PI, 41, 0.5, 98, -3.1415926535897936, 0, 640.3047648944521],
    ["x^2 + 3*y^2 + x*y", -2.5, 3, -1.7, 2.2, 47, 3, 112, 0.7848607187330545, -0.32788684237779986, 234.99734693414217],
  ] as [string, number, number, number, number, number, number, number, number, number, number][])(
    "%s at %d",
    (expr, x0, x1, y0, y1, n, L, count, sx, sy, sr) => {
      const pts = crossingPoints(grid(expr, x0, x1, y0, y1, n), L);
      expect(pts.length).toBe(count);
      expect(pts.reduce((a, p) => a + p[0], 0)).toBeCloseTo(sx, 9);
      expect(pts.reduce((a, p) => a + p[1], 0)).toBeCloseTo(sy, 9);
      expect(pts.reduce((a, p) => a + p[0] * p[0] + p[1] * p[1], 0)).toBeCloseTo(sr, 8);
    },
  );
  test("closed-form oracle: x² + y² contours are circles of radius √L (within the h² interpolation error)", () => {
    const g = grid("x^2 + y^2", -3, 3, -3, 3, 61);
    for (const L of [0.7, 2.5, 6.3]) {
      const lv = marchingSquares(g, [L])[0];
      expect(lv.paths.length).toBe(1);
      expect(lv.paths[0].closed).toBe(true);
      for (const [x, y] of lv.paths[0].pts) expect(Math.abs(Math.hypot(x, y) - Math.sqrt(L))).toBeLessThan(0.1 * 0.1);
    }
  });
  test("a level that leaves the rectangle gives an open chain with both ends on the boundary", () => {
    const g = grid("x^2 + y^2", -3, 3, -3, 3, 61);
    const lv = marchingSquares(g, [12])[0]; // r ≈ 3.46: four arcs cut off by the square
    expect(lv.paths.length).toBe(4);
    for (const p of lv.paths) {
      expect(p.closed).toBe(false);
      for (const q of [p.pts[0], p.pts[p.pts.length - 1]]) expect(Math.max(Math.abs(q[0]), Math.abs(q[1]))).toBeCloseTo(3, 9);
    }
  });
});

describe("saddles: the centre-value rule", () => {
  // One cell, corners (0,0)=1, (1,0)=0, (1,1)=1, (0,1)=0 — case 5 (corners 0 and 2 above 0.5).
  const cell = (centreBias: number): Grid => ({
    xs: [0, 1],
    ys: [0, 1],
    z: [
      [1 + centreBias, 0],
      [0, 1 + centreBias],
    ],
    holes: 0,
  });
  const segsAround = (g: Grid, L: number) => marchingSquares(g, [L])[0].paths.map((p) => p.pts);
  test("centre above the level joins the two above corners: the lines cut off the BELOW corners (1,0) and (0,1)", () => {
    // centre = (1 + 0 + 1 + 0)/4 = 0.5 ≥ 0.5 → above (a centre ON the level counts as above).
    const paths = segsAround(cell(0), 0.5);
    expect(paths.length).toBe(2);
    const near = (p: [number, number][], cx: number, cy: number) => p.every(([x, y]) => Math.hypot(x - cx, y - cy) < 0.75);
    expect(paths.some((p) => near(p, 1, 0))).toBe(true);
    expect(paths.some((p) => near(p, 0, 1))).toBe(true);
  });
  test("centre below joins the below corners: the lines cut off the ABOVE corners (0,0) and (1,1)", () => {
    // Level 0.6: centre 0.5 < 0.6.
    const paths = segsAround(cell(0), 0.6);
    const near = (p: [number, number][], cx: number, cy: number) => p.every(([x, y]) => Math.hypot(x - cx, y - cy) < 0.75);
    expect(paths.some((p) => near(p, 0, 0))).toBe(true);
    expect(paths.some((p) => near(p, 1, 1))).toBe(true);
  });
  test("case 10 (the mirror saddle) follows the same rule", () => {
    const g: Grid = { xs: [0, 1], ys: [0, 1], z: [[0, 1], [1, 0]], holes: 0 };
    const paths = marchingSquares(g, [0.5])[0].paths.map((p) => p.pts);
    const near = (p: [number, number][], cx: number, cy: number) => p.every(([x, y]) => Math.hypot(x - cx, y - cy) < 0.75);
    // centre 0.5 ≥ 0.5: the above corners (1,0) and (0,1) join; the below corners are cut off.
    expect(paths.some((p) => near(p, 0, 0))).toBe(true);
    expect(paths.some((p) => near(p, 1, 1))).toBe(true);
  });
  test("bands agree with the lines' topology: centre above → the above band is one connected piece through the centre", () => {
    const bands = isobands(cell(0), [0.5])!;
    const upper = bands!.filter((b) => b.band === 1);
    // The centre (0.5, 0.5) is inside the upper band.
    const inside = upper.some((b) => pointInPoly(0.5, 0.5, b.pts) || b.pts.some(([x, y]) => x === 0.5 && y === 0.5));
    expect(inside).toBe(true);
  });
});

function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function area(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a) / 2;
}

describe("isobands", () => {
  test("the bands tile the rectangle exactly (areas sum to its area) when there are no holes", () => {
    const g = grid("sin(x)*cos(y)", -3, 3, -2, 2, 31);
    const lv = niceLevels(-1, 1);
    const total = isobands(g, lv)!.reduce((a, b) => a + area(b.pts), 0);
    expect(total).toBeCloseTo(6 * 4, 9);
  });
  test("closed-form oracle: the area inside x² + y² < 4 is close to 4π", () => {
    const g = grid("x^2 + y^2", -3, 3, -3, 3, 121);
    const inner = isobands(g, [4])!.filter((b) => b.band === 0).reduce((a, b) => a + area(b.pts), 0);
    expect(Math.abs(inner - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.002);
  });
  test("cells with a non-finite corner are left out of every band", () => {
    const g = grid("sqrt(1 - x^2 - y^2)", -1.5, 1.5, -1.5, 1.5, 31);
    expect(g.holes).toBeGreaterThan(0);
    const total = isobands(g, [0.5])!.reduce((a, b) => a + area(b.pts), 0);
    expect(total).toBeLessThan(Math.PI); // inside the unit disc only
    expect(total).toBeGreaterThan(0.8 * Math.PI * 0.9 * 0.9);
  });
});

describe("holes", () => {
  test("lines never enter a cell with a non-finite corner", () => {
    const g = grid("log(x^2 + y^2 - 1)", -3, 3, -3, 3, 41); // no value inside the unit disc
    const lv = marchingSquares(g, [0, 1])[0];
    for (const p of lv.paths) for (const [x, y] of p.pts) expect(Math.hypot(x, y)).toBeGreaterThan(0.95);
    expect(g.holes).toBeGreaterThan(0);
  });
  test("the figure draws holes grey and says how many points had no value", () => {
    const g = grid("1/(x*y)", -1, 1, -1, 1, 21);
    const svg = contourPlotSvg({ grid: g, levels: [-4, 4], filled: false, notes: [`z has no finite value at ${g.holes} of 441 grid points (grey).`] });
    expect(svg).toContain('fill="#d4d4d4"');
    expect(svg).toMatch(/no finite value at \d+ of 441/);
  });
});

describe("sampleGrid and levels", () => {
  test("caps the grid", () => {
    const g = sampleGrid(compileExpr("x", ["x", "y"]), 0, 1, 0, 1, 10_000, 3);
    expect(g.xs.length).toBe(CONTOUR_GRID_MAX);
    expect(g.ys.length).toBe(3);
    expect(g.xs[g.xs.length - 1]).toBe(1);
  });
  test("refuses bad bounds", () => {
    expect(() => sampleGrid(compileExpr("x", ["x", "y"]), 1, 0, 0, 1, 5, 5)).toThrow();
    expect(() => sampleGrid(compileExpr("x", ["x", "y"]), 0, Infinity, 0, 1, 5, 5)).toThrow();
  });
  test("gridRange ignores holes; null when there is nothing", () => {
    expect(gridRange({ xs: [0, 1], ys: [0, 1], z: [[NaN, 2], [5, NaN]], holes: 2 })).toEqual({ lo: 2, hi: 5 });
    expect(gridRange({ xs: [0, 1], ys: [0, 1], z: [[NaN, NaN], [NaN, NaN]], holes: 4 })).toBeNull();
  });
  test("nice levels: axis ticks strictly inside, bounded", () => {
    expect(niceLevels(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(niceLevels(5, 5)).toEqual([]);
    expect(niceLevels(-1e300, 1e300).length).toBeGreaterThan(0);
    expect(niceLevels(1e-15, 2e-15).every((v) => v > 1e-15 && v < 2e-15)).toBe(true);
  });
  test("a level exactly at a grid value: z = L counts as above (no zero-length or duplicate crash)", () => {
    const g: Grid = { xs: [0, 1, 2], ys: [0, 1, 2], z: [[0, 0, 0], [0, 1, 0], [0, 0, 0]], holes: 0 };
    const lv = marchingSquares(g, [1])[0];
    for (const p of lv.paths) for (const q of p.pts) expect(Math.hypot(q[0] - 1, q[1] - 1)).toBeLessThan(1e-12);
  });
  test("non-finite levels are ignored", () => {
    const g = grid("x + y", 0, 1, 0, 1, 5);
    expect(marchingSquares(g, [NaN, Infinity, 1]).map((l) => l.level)).toEqual([1]);
  });
});

describe("the figure", () => {
  const g = grid("x^2 + y^2", -3, 3, -3, 3, 41);
  test("one path per level, a colour-bar label per level, true minus on ticks", () => {
    const svg = contourPlotSvg({ grid: g, levels: [2, 4, 8], filled: false });
    expect((svg.match(/<path /g) ?? []).length).toBe(3);
    for (const t of ["2", "4", "8"]) expect(svg).toMatch(new RegExp(`>${t}</text>`));
    expect(svg).toContain(">−2</text>");
    expect(svg).not.toMatch(/>-\d/);
  });
  test("filled: one band path per band present, then dark level lines", () => {
    const svg = contourPlotSvg({ grid: g, levels: [2, 4, 8], filled: true });
    expect((svg.match(/stroke-width="0.5" stroke-linejoin="round"/g) ?? []).length).toBe(4);
    expect(svg).toContain('stroke="#1a1a1a"');
  });
  test("a long thin rectangle is drawn at different scales and says so", () => {
    const thin = grid("x*y", 0, 100, 0, 5, 21);
    expect(contourPlotSvg({ grid: thin, levels: [10], filled: false })).toMatch(/different scales/);
    expect(contourPlotSvg({ grid: g, levels: [10], filled: false })).not.toMatch(/different scales/);
  });
  test("the colour-bar title widens the gutter rather than running off the canvas", () => {
    const svg = contourPlotSvg({ grid: g, levels: [1, 2], filled: true, zlabel: "Electric potential (mV)" });
    const t = /<text x="([\d.]+)" y="[\d.]+" font-family="[^"]+" font-size="10" fill="#333333">Electric potential \(mV\)<\/text>/.exec(svg)!;
    expect(Number(t[1]) + "Electric potential (mV)".length * 6.2).toBeLessThanOrEqual(380 + 1);
  });
  test("many levels: labels thinned so they stay at least 12 px apart", () => {
    const lv = Array.from({ length: 40 }, (_, i) => 0.2 + i * 0.4);
    const svg = contourPlotSvg({ grid: g, levels: lv, filled: false });
    const frameRight = (() => {
      const m = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none"/.exec(svg)!;
      return Number(m[1]) + Number(m[2]);
    })();
    const bar = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-family="[^"]+" font-size="10" fill="#333333">[\d.]+<\/text>/g)]
      .filter((m) => Number(m[1]) > frameRight)
      .map((m) => Number(m[2]))
      .sort((a, b) => a - b);
    expect(bar.length).toBeGreaterThan(4);
    expect(bar.length).toBeLessThan(40);
    for (let i = 1; i < bar.length; i++) expect(bar[i] - bar[i - 1]).toBeGreaterThanOrEqual(11.9);
  });
});
