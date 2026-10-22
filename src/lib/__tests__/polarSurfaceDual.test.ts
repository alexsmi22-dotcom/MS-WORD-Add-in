// polarPlot.ts, surface3d.ts, dualAxisPlot.ts: engines and figures.
import { compileExpr } from "../plot";
import { samplePolar, polarToXY, polarPlotSvg, POLAR_SAMPLES_MAX } from "../polarPlot";
import { makeView, sampleSurface, surfacePlotSvg, SURFACE_GRID_MAX } from "../surface3d";
import { parseDualData, dualAxisPlotSvg, dropForDualScales } from "../dualAxisPlot";

describe("polar", () => {
  test("oracle: r = 1 is the unit circle", () => {
    for (const s of samplePolar(compileExpr("1", ["theta"]), 0, 2 * Math.PI, 73)) {
      const p = polarToXY(s);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 14);
    }
  });
  test("oracle: the rose r = cos 3θ — three petals of length 1 at θ = 0, 2π/3, 4π/3", () => {
    // Closed form: r = cos 3θ over [0, π] traces three petals; the petal tips are at
    // r = ±1 where 3θ is a multiple of π: θ = 0 (r = 1, angle 0), θ = π/3 (r = −1 → drawn
    // at angle 4π/3), θ = 2π/3 (r = 1, angle 2π/3).
    const f = compileExpr("cos(3*theta)", ["theta"]);
    const tip = (t: number) => polarToXY({ theta: t, r: f([t]) });
    const a = tip(0);
    const b = tip(Math.PI / 3);
    const c = tip((2 * Math.PI) / 3);
    expect([a.x, a.y].map((v) => +v.toFixed(12))).toEqual([1, 0]);
    expect(Math.atan2(b.y, b.x)).toBeCloseTo(-(2 * Math.PI) / 3, 12); // 4π/3 ≡ −2π/3
    expect(Math.atan2(c.y, c.x)).toBeCloseTo((2 * Math.PI) / 3, 12);
    // Every sample lies inside the unit disc and the curve returns to the origin between petals.
    const pts = samplePolar(f, 0, Math.PI, 721).map(polarToXY);
    expect(Math.max(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeCloseTo(1, 12);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(1e-2);
  });
  test("negative r is drawn at θ + π", () => {
    const p = polarToXY({ theta: 0, r: -2 });
    expect(p.x).toBe(-2);
    expect(Math.abs(p.y)).toBeLessThan(1e-15);
  });
  test("non-finite r breaks the curve; samples are capped", () => {
    const s = samplePolar(compileExpr("sqrt(cos(theta))", ["theta"]), 0, 2 * Math.PI, 360);
    expect(s.some((q) => Number.isNaN(q.r))).toBe(true);
    const svg = polarPlotSvg({ samples: s, angleUnit: "deg" });
    expect(svg).not.toMatch(/NaN/);
    expect(samplePolar(compileExpr("1", ["theta"]), 0, 1, 1e9).length).toBe(POLAR_SAMPLES_MAX);
  });
  test("figure: twelve angle labels in the chosen unit, rings at nice radii, root size agrees", () => {
    const s = samplePolar(compileExpr("1 + 2*cos(theta)", ["theta"]), 0, 2 * Math.PI, 721);
    const deg = polarPlotSvg({ samples: s, angleUnit: "deg" });
    for (const t of ["0°", "30°", "90°", "180°", "330°"]) expect(deg).toContain(`>${t}</text>`);
    const rad = polarPlotSvg({ samples: s, angleUnit: "rad" });
    for (const t of ["π/6", "π/2", "2π/3", "π", "11π/6"]) expect(rad).toContain(`>${t}</text>`);
    expect(rad).toMatch(/r &lt; 0 the point is drawn at angle θ \+ π/);
    const w = Number(/width="([\d.]+)"/.exec(rad)![1]);
    const h = Number(/height="([\d.]+)"/.exec(rad)![1]);
    expect(rad).toContain(`viewBox="0 0 ${w} ${h}"`);
  });
  test("ring labels avoid the curve; when the curve fills the disc they move to a radial scale", () => {
    // A dense spiral crosses every candidate position.
    const s = samplePolar(compileExpr("theta", ["theta"]), 0, 40 * Math.PI, 4000);
    const svg = polarPlotSvg({ samples: s, angleUnit: "rad" });
    expect(svg).toMatch(/>r<\/text>/);
  });
  test("r identically 0 still draws a frame (no division by zero)", () => {
    const s = samplePolar(compileExpr("0", ["theta"]), 0, 1, 10);
    expect(polarPlotSvg({ samples: s, angleUnit: "rad" })).not.toMatch(/NaN|Infinity/);
  });
});

describe("surface", () => {
  test("view: matplotlib's convention — azimuth −60°, elevation 30°", () => {
    const v = makeView(-60, 30);
    // +z projects straight up the screen, scaled by cos(elevation).
    expect(v.project(0, 0, 1)[0]).toBeCloseTo(0, 15);
    expect(v.project(0, 0, 1)[1]).toBeCloseTo(Math.cos(Math.PI / 6), 15);
    // The viewer is toward (cos az, sin az): that corner is nearest.
    expect(v.depth(0.5, -0.5)).toBeGreaterThan(v.depth(-0.5, 0.5));
    // Elevation 90°: looking straight down, x–y map with no z.
    const top = makeView(0, 90);
    expect(top.project(0, 0, 1)[1]).toBeCloseTo(0, 12);
  });
  test("painter's order: quads are drawn far to near (horizontal depth of their centres)", () => {
    const g = sampleSurface(compileExpr("x + y", ["x", "y"]), -1, 1, -1, 1, 5);
    const svg = surfacePlotSvg({ grid: g, azimuthDeg: -60, elevationDeg: 30, style: "wireframe" });
    const quads = [...svg.matchAll(/<polygon points="([^"]+)" fill="#ffffff"/g)].map((m) => m[1]);
    expect(quads.length).toBe(16);
    // The near corner cell (x = +, y = −) must be last; the far one (x = −, y = +) first.
    const v = makeView(-60, 30);
    expect(v.depth(0.375, -0.375)).toBeGreaterThan(v.depth(-0.375, 0.375));
    const cy = (q: string) => q.split(" ").map((p) => Number(p.split(",")[1])).reduce((a, b) => a + b) / 4;
    // Nearer cells sit lower on the screen in this view (z is linear and small).
    expect(cy(quads[quads.length - 1])).toBeGreaterThan(cy(quads[0]));
  });
  test("holes leave gaps and the grid is capped", () => {
    const g = sampleSurface(compileExpr("sqrt(1 - x^2 - y^2)", ["x", "y"]), -1, 1, -1, 1, 21);
    expect(g.holes).toBeGreaterThan(0);
    const svg = surfacePlotSvg({ grid: g });
    const n = (svg.match(/<polygon /g) ?? []).length - 3; // minus the three back panes
    expect(n).toBeLessThan(20 * 20);
    expect(sampleSurface(compileExpr("x", ["x", "y"]), 0, 1, 0, 1, 1e6).xs.length).toBe(SURFACE_GRID_MAX);
  });
  test("a constant surface draws (z axis around the value), elevation is clamped to 0–90°", () => {
    const g = sampleSurface(compileExpr("5", ["x", "y"]), 0, 1, 0, 1, 6);
    const svg = surfacePlotSvg({ grid: g, elevationDeg: 400 });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toMatch(/>5(\.0)?<\/text>/);
  });
  test("axes: x, y and z titles and true-minus ticks", () => {
    const g = sampleSurface(compileExpr("x*y", ["x", "y"]), -2, 2, -2, 2, 12);
    const svg = surfacePlotSvg({ grid: g, xlabel: "u", ylabel: "v", zlabel: "w" });
    for (const t of ["u", "v", "w"]) expect(svg).toContain(`>${t}</text>`);
    expect(svg).toContain(">−2</text>");
    expect(svg).not.toMatch(/>-\d/);
  });
  test.each([[-60, 30], [30, 45], [135, 20], [225, 60], [300, 5], [0, 0], [90, 90]])("az %d el %d: every label on the canvas", (az, el) => {
    const g = sampleSurface(compileExpr("sin(x)*cos(y)", ["x", "y"]), -3, 3, -3, 3, 20);
    const svg = surfacePlotSvg({ grid: g, azimuthDeg: az, elevationDeg: el, xlabel: "Position x (mm)", ylabel: "Position y (mm)", zlabel: "Intensity (a.u.)" });
    const W = 380;
    for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)) {
      const x = Number(m[1]);
      const w = m[5].length * Number(m[4]) * 0.58;
      const x0 = m[3] === "start" ? x : m[3] === "end" ? x - w : x - w / 2;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x0 + w).toBeLessThanOrEqual(W);
      expect(Number(m[2])).toBeGreaterThan(0);
    }
  });
});

describe("two y axes", () => {
  test("parses x y₁ y₂ with missing values, U+2212 and comments", () => {
    // RULE N (dataBlock.ts): comments are blanked, missing tokens break the line, a row with no y is left out.
    const r = parseDualData("# t T p\n0 1 10\n1 − 20\n2 −3\n\n5 NA NA\n6 7 8");
    expect(r.left).toEqual([{ x: 0, y: 1 }, { x: 2, y: -3, gap: true }, { x: 6, y: 7 }]);
    expect(r.right).toEqual([{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 6, y: 8, gap: true }]);
    expect(r.skipped).toEqual(["5 NA NA"]);
    // A word row, or a comma field in a whitespace block, refuses the block by line (never a silent drop).
    expect(parseDualData("0 1 2\nfoo 1 2").refusal).toMatch(/line 2/);
    expect(parseDualData("0 1 10\n3,4,NA").refusal).toMatch(/line 2/);
  });
  test("each axis has its own scale and colour; the key names the axes", () => {
    const svg = dualAxisPlotSvg({
      left: [{ x: 0, y: 20 }, { x: 10, y: 30 }],
      right: [{ x: 0, y: 1 }, { x: 10, y: 1000 }],
      rightScale: "log",
      leftLabel: "T (°C)",
      rightLabel: "p (kPa)",
    });
    expect(svg).toMatch(/fill="#0072B2" transform="rotate\(-90[^"]*">T \(°C\)<\/text>/);
    expect(svg).toMatch(/fill="#D55E00" transform="rotate\(90[^"]*">p \(kPa\)<\/text>/);
    expect(svg).toContain(">10³</text>");
    expect(svg).toContain("left axis: T (°C)");
    expect(svg).toContain("right axis: p (kPa)");
    expect(svg).toContain('stroke-dasharray="7 3"'); // series 2 dashed: not colour alone
  });
  test("log axes drop what they cannot show and count it", () => {
    const d = dropForDualScales({ left: [{ x: 1, y: 0 }, { x: 2, y: 3 }], right: [{ x: -1, y: 5 }], leftScale: "log", xScale: "log" });
    expect(d.dropped).toBe(2);
    expect(d.fig.left).toEqual([{ x: 2, y: 3 }]);
    expect(d.fig.right).toEqual([]);
  });
  test("long axis titles: the key stacks rather than truncating", () => {
    const svg = dualAxisPlotSvg({ left: [{ x: 0, y: 1 }, { x: 1, y: 2 }], right: [{ x: 0, y: 3 }, { x: 1, y: 4 }], leftLabel: "Dissolved oxygen (mg/L)", rightLabel: "Turbidity (NTU)" });
    expect(svg).toContain("left axis: Dissolved oxygen (mg/L)");
    expect(svg).not.toContain("…");
  });
  test("a single x value and a constant series still draw", () => {
    const svg = dualAxisPlotSvg({ left: [{ x: 1, y: 2 }], right: [{ x: 1, y: 2 }] });
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
