// Plot ▸ Plot type: the shared evaluator (one grammar for every kind), the field
// parsing and refusals of plotKinds.ts, and each kind's figure as the pane gets it.
import { evalExpr, compileExpr, samplePlot } from "../plot";
import { foldAbsBars } from "../solve";
import { minOf, maxOf } from "../minmax";
import { buildPlotKind, readBound, readLevels, compileKindExpr, PlotKindInput, parametricPlotSvg } from "../plotKinds";
import { readSvgDims } from "../svgSize";
import { prepareFigure, refusalText } from "../insertCapability";

// ---------------------------------------------------------------------------
// A FROZEN COPY of evalExpr as it was before compileExpr existed (v2.186.0),
// so the refactor is proved not to change one number or one error for y = f(x).
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  // The frozen loop ran to n (fact(1e12) never returned); past 170 it could only ever give Infinity.
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}
const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  log: Math.log10, ln: Math.log, log10: Math.log10, log2: Math.log2, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  fact: factorial, factorial,
};
const FUNCS_N: Record<string, { arity: number | "var"; fn: (a: number[]) => number }> = {
  atan2: { arity: 2, fn: (a) => Math.atan2(a[0], a[1]) },
  mod: { arity: 2, fn: (a) => a[0] - a[1] * Math.floor(a[0] / a[1]) },
  pow: { arity: 2, fn: (a) => Math.pow(a[0], a[1]) },
  hypot: { arity: "var", fn: (a) => Math.hypot(...a) },
  min: { arity: "var", fn: (a) => minOf(a) },
  max: { arity: "var", fn: (a) => maxOf(a) },
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
function normalizeOld(expr: string): string {
  let s = foldAbsBars(expr);
  const def = /^\s*([A-Za-z_]\w*)\s*\(\s*x\s*\)\s*=\s*([^=]+)$/.exec(s);
  if (def && !(def[1].toLowerCase() in FUNCS) && !(def[1].toLowerCase() in FUNCS_N)) s = def[2];
  else {
    const yDef = /^\s*y\s*=\s*([^=]+)$/.exec(s);
    if (yDef) s = yDef[1];
  }
  return s;
}
function evalOld(expr: string, x: number): number {
  let i = 0;
  const s = normalizeOld(expr).replace(/\s+/g, "");
  function parseExpr(): number {
    let v = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = parseUnary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseUnary(): number {
    if (s[i] === "-") {
      i++;
      return -parseUnary();
    }
    if (s[i] === "+") {
      i++;
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower(): number {
    const base = parseAtom();
    if (s[i] === "^") {
      i++;
      return Math.pow(base, parseUnary());
    }
    return base;
  }
  function parseAtom(): number {
    if (s[i] === "(") {
      i++;
      const v = parseExpr();
      if (s[i] !== ")") throw new Error("Missing ')'");
      i++;
      return v;
    }
    const numMatch = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(s.slice(i));
    if (numMatch) {
      i += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }
    const idMatch = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (idMatch) {
      const id = idMatch[0];
      i += id.length;
      if (s[i] === "(") {
        i++;
        const args = [parseExpr()];
        while (s[i] === ",") {
          i++;
          args.push(parseExpr());
        }
        if (s[i] !== ")") throw new Error("Missing ')'");
        i++;
        const key = id.toLowerCase();
        if (FUNCS[key]) {
          if (args.length !== 1) throw new Error(`${id} takes 1 argument`);
          return FUNCS[key](args[0]);
        }
        const nf = FUNCS_N[key];
        if (nf) {
          if (nf.arity !== "var" && args.length !== nf.arity) throw new Error(`${id} takes ${nf.arity} arguments`);
          if (nf.arity === "var" && args.length < 1) throw new Error(`${id} needs an argument`);
          return nf.fn(args);
        }
        throw new Error(`Unknown function ${id}`);
      }
      if (id === "x") return x;
      if (id.toLowerCase() in CONSTS) return CONSTS[id.toLowerCase()];
      throw new Error(`Unknown symbol ${id}`);
    }
    throw new Error(`Unexpected "${s[i] ?? "end"}"`);
  }
  const result = parseExpr();
  if (i !== s.length) throw new Error(`Unexpected "${s[i]}"`);
  return result;
}

function outcome(f: () => number): string {
  try {
    const v = f();
    return Object.is(v, -0) ? "-0" : String(v);
  } catch (e) {
    return "throw:" + (e as Error).message;
  }
}

describe("one evaluator: evalExpr through compileExpr is the old evalExpr, number for number and error for error", () => {
  const fixed = [
    "sin(x)/x", "x^2", "-x^2", "2^-x", "2^3^2", "exp(-x^2)", "|x - 1|", "f(x) = x^3 - 2*x", "y = 3*x + 1", "sin(x) = 1",
    "mod(-7, 3)", "max(x, 1, -2)", "min()", "atan2(x)", "hypot(3, 4, x)", "fact(x)", "log(x)", "ln(x)", "PI*x", "E", "Tau",
    "X", "t", "2x", "x)", "(x", "", "   ", "1e3*x", ".5x", "x**2", "sqrt(-x)", "1/0", "-0", "abs(x", "foo(x)", "x,1",
    "sign(x)*floor(x)", "pow(x, 0.5)", "cos(x) + sin(x) * tan(x) - acos(x/10)", "++x", "--x", "x^-+2", "((((x))))",
  ];
  const xs = [-3.5, -1, -0, 0, 0.25, 1, 2, 7.1, 1e-9, 1e12, NaN, Infinity];
  test.each(fixed)("%s", (expr) => {
    for (const x of xs) expect(outcome(() => evalExpr(expr, x))).toBe(outcome(() => evalOld(expr, x)));
  });
  test("fuzz: 3000 random token strings agree", () => {
    const toks = ["x", "1", "2.5", "+", "-", "*", "/", "^", "(", ")", ",", "sin(", "max(", "pi", "e", "|", " ", "y", "=", "abs(", "mod(", "1e-2", "."];
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(rnd() * 10);
      let s = "";
      for (let k = 0; k < len; k++) s += toks[Math.floor(rnd() * toks.length)];
      const x = rnd() * 10 - 5;
      expect([s, outcome(() => evalExpr(s, x))]).toEqual([s, outcome(() => evalOld(s, x))]);
    }
  });
  test("samplePlot is unchanged for the default plot", () => {
    const pts = samplePlot("sin(x)/x", -10, 10, 240);
    expect(pts.length).toBe(240);
    expect(pts[17].y).toBe(evalOld("sin(x)/x", pts[17].x));
  });
});

describe("compileExpr: named variables, parsed once", () => {
  test("two variables", () => {
    const f = compileExpr("x^2 + 3*y", ["x", "y"]);
    expect(f([2, 5])).toBe(19);
    expect(f([-1, 0])).toBe(1);
  });
  test("a symbol that is not a variable is refused at compile time, not read as zero", () => {
    expect(() => compileExpr("x + t", ["x", "y"])).toThrow("Unknown symbol t");
    expect(() => compileExpr("x", ["t"])).toThrow("Unknown symbol x");
  });
  test("abs bars fold", () => {
    expect(compileExpr("|t - 3|", ["t"])([1])).toBe(2);
  });
  test("no variables: a constant expression", () => {
    expect(compileExpr("2*pi", [])([])).toBeCloseTo(2 * Math.PI, 15);
  });
});

describe("readBound: numbers and constant expressions for ranges", () => {
  test.each([
    ["0", 0],
    ["2*pi", 2 * Math.PI],
    ["−pi/2", -Math.PI / 2],
    ["2π", 2 * Math.PI],
    ["π", Math.PI],
    ["360", 360],
    ["1e3", 1000],
  ])("%s", (t, v) => expect(readBound(t as string)).toBeCloseTo(v as number, 12));
  test.each(["", "abc", "x", "1/0", "2pi", "sqrt(-1)"])("refused: %s", (t) => expect(readBound(t)).toBeNull());
});

describe("compileKindExpr: prefixes, θ, equations", () => {
  const z = /^\s*(?:z|f)\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=/;
  test("z = and f(x, y) = are stripped", () => {
    const a = compileKindExpr("z = x*y", "z = f(x, y)", z, ["x", "y"]);
    const b = compileKindExpr("f(x, y) = x*y", "z = f(x, y)", z, ["x", "y"]);
    expect(typeof a).toBe("function");
    expect((a as (v: number[]) => number)([2, 3])).toBe(6);
    expect((b as (v: number[]) => number)([2, 3])).toBe(6);
  });
  test("an equation is refused, by name", () => {
    expect(compileKindExpr("x^2 + y^2 = 1", "z = f(x, y)", z, ["x", "y"])).toMatch(/formula, not an equation/);
  });
  test("θ is folded to theta", () => {
    const f = compileKindExpr("r(θ) = cos(3θ)", "r(θ)", /^\s*r\s*(?:\(\s*(?:theta|t)\s*\))?\s*=/, ["theta"]);
    // 3θ: the multiplication next to θ is made explicit (plot.ts foldPlotSymbols).
    expect((f as (v: number[]) => number)([0])).toBe(1);
    const g = compileKindExpr("cos(3*θ)", "r(θ)", /^\s*r\s*=/, ["theta"]);
    expect((g as (v: number[]) => number)([0])).toBe(1);
  });
  test("empty", () => expect(compileKindExpr("  ", "x(t)", /^x=/, ["t"])).toBe("Enter x(t)."));
});

describe("readLevels", () => {
  test("blank = nice levels strictly inside the range", () => {
    const r = readLevels("", 0.004, 18);
    expect(typeof r).not.toBe("string");
    const lv = (r as { levels: number[] }).levels;
    expect(lv[0]).toBeGreaterThan(0.004);
    expect(lv[lv.length - 1]).toBeLessThan(18);
    expect(lv.length).toBeGreaterThanOrEqual(4);
  });
  test("a list, U+2212 minus, sorted and de-duplicated; outside levels are noted", () => {
    const r = readLevels("3, −1 2 2 50", -2, 10) as { levels: number[]; notes: string[] };
    expect(r.levels).toEqual([-1, 2, 3, 50]);
    expect(r.notes.join(" ")).toMatch(/No contour at 50: outside the z range −2 to 10/);
  });
  test("an unreadable token is refused by name", () => {
    expect(readLevels("1 two 3", 0, 5)).toMatch(/“two”/);
  });
  test("more than 40 levels refused", () => {
    expect(readLevels(Array.from({ length: 41 }, (_, i) => i).join(" "), 0, 50)).toMatch(/At most 40/);
  });
});

// ---------------------------------------------------------------------------
// Each kind through buildPlotKind, as the pane calls it.

const BASE: PlotKindInput = {
  kind: "parametric", fn: "", fn2: "", xmin: "-10", xmax: "10", tmin: "0", tmax: "2*pi", ymin: "-10", ymax: "10",
  angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
  y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "filled",
};
const run = (o: Partial<PlotKindInput>) => buildPlotKind({ ...BASE, ...o });
const okOf = (o: Partial<PlotKindInput>) => {
  const r = run(o);
  if (!r.ok) throw new Error(r.error);
  return r;
};

/** The display contract, on everything visible in a figure. */
function expectTypeset(svg: string): void {
  const text = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" | ");
  expect(text).not.toMatch(/NaN|Infinity|undefined|\^|\d[eE][-+]?\d|—/);
  expect(text).not.toMatch(/(^|[^\w])-\d/); // a hyphen-minus before a digit
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
}

describe.each([
  ["parametric circle", { kind: "parametric", fn: "cos(t)", fn2: "sin(t)" }],
  ["polar rose", { kind: "polar", fn: "cos(3*theta)", tmin: "0", tmax: "pi" }],
  ["polar degrees", { kind: "polar", fn: "1 + 2*cos(θ)", tmin: "0", tmax: "360", angleUnit: "deg" }],
  ["two y axes", { kind: "dualy", data: "0 1 10\n1 2 100\n2 −3 1000", ylabel: "a", y2label: "b", y2scale: "log" }],
  ["contour lines", { kind: "contour", fn: "x^2 + y^2", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3" }],
  ["contour filled with holes", { kind: "contour", fn: "sqrt(4 - x^2 - y^2)", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3", filled: true }],
  ["surface", { kind: "surface", fn: "sin(x)*cos(y)", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3" }],
  ["surface wireframe", { kind: "surface", fn: "x*y", surfaceStyle: "wireframe", az: "200", el: "60" }],
] as [string, Partial<PlotKindInput>][])("%s: what the insert path gets", (_name, o) => {
  test("one valid SVG root whose width/height/viewBox agree (Word sizes from them)", () => {
    const r = okOf(o);
    expect((r.svg.match(/<svg\b/g) ?? []).length).toBe(1);
    const d = readSvgDims(r.svg, 0, 0);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(r.svg);
    expect(vb).not.toBeNull();
    expect(Number(vb![1])).toBeCloseTo(d.w, 6);
    expect(Number(vb![2])).toBeCloseTo(d.h, 6);
    expect(d.w).toBe(380);
  });
  test("render(w) redraws at the asked width, and is the preview at 380", () => {
    const r = okOf(o);
    // Identical but for the per-figure clipPath id (unique so two figures can share a pane).
    const noIds = (s: string) => s.replace(/(plot|contour)clip\d+/g, "clip");
    expect(noIds(r.render(380))).toBe(noIds(r.svg));
    expect(readSvgDims(r.render(520), 0, 0).w).toBe(520);
  });
  test("display contract and alt text", () => {
    const r = okOf(o);
    expectTypeset(r.svg);
    expect(r.alt).not.toMatch(/\^|NaN/);
    expect(r.alt.length).toBeGreaterThan(10);
  });
  test("figure styles accept it (Nature, single column) through render", () => {
    const r = okOf(o);
    const p = prepareFigure({ svg: r.svg, preset: "nature", width: "single", render: r.render, chartKind: r.chartKind });
    expect(p.ok).toBe(true);
  });
});

describe("refusals, said plainly", () => {
  test.each([
    [{ kind: "parametric", fn: "cos(t)", fn2: "" }, /Enter y\(t\)/],
    [{ kind: "parametric", fn: "cos(x)", fn2: "sin(t)" }, /Unknown symbol x/],
    [{ kind: "parametric", fn: "cos(t)", fn2: "sin(t)", tmin: "5", tmax: "1" }, /valid t range/],
    [{ kind: "parametric", fn: "sqrt(-1-t^2)", fn2: "t" }, /no finite values/],
    [{ kind: "polar", fn: "cos(3*x)" }, /Unknown symbol x/],
    [{ kind: "polar", fn: "1", tmin: "0", tmax: "1000" }, /more than 100 full turns/],
    [{ kind: "polar", fn: "sqrt(-1)" }, /no finite value/],
    [{ kind: "dualy", data: "1 2\n3 4" }, /both series/],
    [{ kind: "dualy", data: "1 0 5\n2 1 6", yscale: "log" }, undefined],
    [{ kind: "dualy", data: "1 -1 5\n2 -2 6", yscale: "log" }, /Nothing left/],
    [{ kind: "contour", fn: "5" }, /constant \(5\)/],
    [{ kind: "contour", fn: "sqrt(-1 - x^2)" }, /no finite value anywhere/],
    [{ kind: "contour", fn: "x*y", grid: "500" }, /from 5 to 200/],
    [{ kind: "contour", fn: "x*y", grid: "2.5" }, /whole number/],
    [{ kind: "contour", fn: "x*y", ymin: "1", ymax: "1" }, /valid y range/],
    [{ kind: "contour", fn: "x*y", levels: "a b" }, /Could not read the levels/],
    [{ kind: "surface", fn: "x*y", el: "-10" }, /Elevation must be from 0° to 90°/],
    [{ kind: "surface", fn: "x*y", az: "north" }, /Azimuth/],
    [{ kind: "surface", fn: "x*y", grid: "150" }, /from 5 to 120/],
    [{ kind: "fx" }, /drawn by the Plot tool itself/],
    // Finite ends, infinite span: every sample position would be NaN.
    [{ kind: "contour", fn: "x*y", xmin: "-1e308", xmax: "1e308" }, /x range is too wide/],
    [{ kind: "parametric", fn: "t", fn2: "t", tmin: "-1e308", tmax: "1e308" }, /t range is too wide/],
    [{ kind: "polar", fn: "1", tmin: "-1e308", tmax: "1e308" }, /θ range is too wide/],
    [{ kind: "dualy", data: "-1e308 1 1\n1e308 2 2" }, /too wide a range/],
    [{ kind: "dualy", data: "0 -1e308 1\n1 1e308 2" }, /too wide a range/],
    [{ kind: "contour", fn: "1e308*x", xmin: "-2", xmax: "2" }, /z spans too wide/],
    [{ kind: "surface", fn: "1e308*x", xmin: "-2", xmax: "2" }, /z spans too wide/],
  ] as [Partial<PlotKindInput>, RegExp | undefined][])("%j", (o, re) => {
    const r = run(o);
    if (!re) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.notes.join(" ")).toMatch(/1 point not plotted: a logarithmic axis/);
      return;
    }
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(re);
      expect(r.error).not.toMatch(/NaN|Infinity|undefined|—/);
    }
  });
});

describe("parametric", () => {
  test("oracle: (cos t, sin t) is the unit circle — every sample at radius 1", () => {
    const r = okOf({ kind: "parametric", fn: "cos(t)", fn2: "sin(t)" });
    expect(r.svg).toContain("<path");
    // The plotted path's px points, mapped back through the frame, lie on a circle.
    const frame = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="#888"/.exec(r.svg)!;
    const [fx, fy, fw, fh] = frame.slice(1).map(Number);
    const d = /<path d="([^"]+)" fill="none" stroke="#1f77b4"/.exec(r.svg)![1];
    const pts = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts.length).toBe(800);
    // x data span [−1, 1] fills the width; y has the plotter's 6% pad each side.
    const ux = fw / 2;
    const uy = fh / (2 * 1.12);
    expect(Math.abs(ux - uy) / ux).toBeLessThan(0.005); // EQUAL SCALES
    for (const [px, py] of pts) {
      const x = (px - fx) / ux - 1;
      const y = (fy + fh / 2 - py) / uy;
      expect(Math.hypot(x, y)).toBeCloseTo(1, 2);
    }
  });
  test("equal scales off: the default 380 × 270 canvas", () => {
    const r = okOf({ kind: "parametric", fn: "cos(t)", fn2: "sin(t)", equal: false });
    expect(readSvgDims(r.svg, 0, 0)).toEqual({ w: 380, h: 270 });
  });
  test("a curve too long and thin for equal scales says so in the figure", () => {
    const r = okOf({ kind: "parametric", fn: "t", fn2: "0.001*sin(t)", tmin: "0", tmax: "100" });
    expect(r.svg).toMatch(/different scales/);
  });
  test("a gap where y has no value breaks the curve into separate runs and is noted", () => {
    const r = okOf({ kind: "parametric", fn: "t", fn2: "sqrt(t^2 - 1)", tmin: "-2", tmax: "2", equal: false });
    const paths = r.svg.match(/<path d="M/g) ?? [];
    expect(paths.length).toBe(2);
    expect(r.notes.join(" ")).toMatch(/no finite value at \d+ of 800 values of t; the curve is broken there/);
  });
  test("log axes drop what they cannot show, and say so", () => {
    const r = okOf({ kind: "parametric", fn: "t", fn2: "t", tmin: "-1", tmax: "1", xscale: "log", equal: true });
    expect(r.notes.join(" ")).toMatch(/not plotted: a logarithmic x axis/);
  });
  test("parametricPlotSvg without equal is buildPlotSvg exactly", () => {
    const s = [{ type: "line" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }];
    expect(parametricPlotSvg(s, { equal: false }, 380)).toBe(parametricPlotSvg(s, {}, 380));
  });
});

describe("polar via buildPlotKind", () => {
  test("degrees: the range is read in degrees, the formula in radians", () => {
    const deg = okOf({ kind: "polar", fn: "theta", tmin: "0", tmax: "180", angleUnit: "deg" });
    const rad = okOf({ kind: "polar", fn: "theta", tmin: "0", tmax: "pi", angleUnit: "rad" });
    // r = θ over half a turn reaches π either way: the outer ring is the same.
    const ring = (s: string) => [...s.matchAll(/<circle [^>]*r="([\d.]+)" fill="none" stroke="#888888"/g)].map((m) => m[1]);
    expect(ring(deg.svg)).toEqual(ring(rad.svg));
    expect(deg.svg).toContain("90°");
    expect(rad.svg).toContain("π/2");
    expect(deg.notes.join(" ")).toMatch(/θ in the formula is in radians; the θ range and angle labels are in degrees/);
  });
  test("negative r is noted", () => {
    const r = okOf({ kind: "polar", fn: "cos(2*theta)" });
    expect(r.notes.join(" ")).toMatch(/r < 0 the point is drawn at angle θ \+ π/);
    expect(r.svg).toMatch(/r &lt; 0|r < 0/);
  });
  test("r = t is accepted as well as r = θ", () => {
    expect(run({ kind: "polar", fn: "r = t" }).ok).toBe(true);
  });
});

describe("hostile magnitudes never put NaN or Infinity into a figure", () => {
  test.each([
    { kind: "contour", fn: "x*y", xmin: "-1e300", xmax: "1e300", ymin: "-1e-300", ymax: "1e-300" },
    { kind: "contour", fn: "1e300*x*y", xmin: "-1", xmax: "1", ymin: "-1", ymax: "1", filled: true },
    { kind: "surface", fn: "1e300*x*y", xmin: "-1", xmax: "1", ymin: "-1", ymax: "1" },
    { kind: "surface", fn: "x", xmin: "1e-300", xmax: "2e-300", ymin: "0", ymax: "1" },
    { kind: "parametric", fn: "1e300*cos(t)", fn2: "1e-300*sin(t)" },
    { kind: "polar", fn: "1e300*theta" },
    { kind: "polar", fn: "1e-300" },
    { kind: "dualy", data: "1e-300 1e300 -1e300\n2e-300 2e300 1e300" },
  ] as Partial<PlotKindInput>[])("%j", (o) => {
    const r = run(o);
    if (r.ok) {
      expect(r.svg).not.toMatch(/NaN|Infinity|undefined/);
      expectTypeset(r.svg);
    } else expect(r.error).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("patent figure style (USPTO) per kind", () => {
  test.each([
    ["parametric", { kind: "parametric", fn: "cos(t)", fn2: "sin(t)" }],
    ["polar", { kind: "polar", fn: "cos(3*theta)" }],
    ["contour lines", { kind: "contour", fn: "x*y" }],
    ["surface wireframe", { kind: "surface", fn: "x*y", surfaceStyle: "wireframe" }],
    ["surface filled", { kind: "surface", fn: "x*y" }],
  ] as [string, Partial<PlotKindInput>][])("%s: refused by name or fitted, never an unnamed failure", (_n, o) => {
    const r = okOf(o);
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render, chartKind: r.chartKind });
    if (!p.ok) expect(p.reason.length).toBeGreaterThan(10);
    if (o.kind === "surface" && o.surfaceStyle !== "wireframe") {
      // Colour carries z on a filled surface: the patent style must refuse it, as it does a heat map.
      expect(p.ok).toBe(false);
    }
  });
});

describe("contour via buildPlotKind", () => {
  test("filled contours are refused by a USPTO style by name, with advice that fits a contour", () => {
    // Release D (item 3): this was chartKind "heatmap", which refused with the Table→Chart advice
    // "Choose a column, bar or line chart". The contour now refuses itself, when re-rendered in
    // black and white, and names the change that works: turn off Filled bands.
    const r = okOf({ kind: "contour", fn: "x*y", filled: true });
    expect(r.chartKind).toBeUndefined();
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render, chartKind: r.chartKind });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(refusalText(p)).toMatch(/Turn off Filled bands/);
      expect(refusalText(p)).not.toMatch(/heat map|column, bar or line/);
    }
    expect(okOf({ kind: "contour", fn: "x*y" }).chartKind).toBeUndefined();
  });
  test("holes are counted in the figure", () => {
    const r = okOf({ kind: "contour", fn: "log(x)", xmin: "-1", xmax: "1", ymin: "0", ymax: "1", grid: "11" });
    // x ≤ 0 has no value: columns x = −1 … 0 (6 of 11) on 11 rows.
    expect(r.svg).toMatch(/no finite value at 66 of 121 grid points/);
  });
  test("SVG size stays bounded at the 200 × 200 cap", () => {
    const r = okOf({ kind: "contour", fn: "sin(x)*cos(y)", xmin: "-pi", xmax: "pi", ymin: "-pi", ymax: "pi", grid: "200", filled: true });
    expect(r.svg.length).toBeLessThan(4_000_000);
  });
});
