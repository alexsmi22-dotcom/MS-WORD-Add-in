// Solve's curve (solveFigure.ts): an equation typed with implicit products draws, as Solve read it.
import { solveFunctionSvg } from "../solveFigure";

/** Whether the figure has a drawn curve. */
const hasCurve = (svg: string | null): boolean => !!svg && /<(polyline|path)\b/.test(svg);

describe("solveFunctionSvg", () => {
  it("draws x^2 - 5x + 6 = 0 (it inserted no curve: the plotter refused 5x)", () => {
    const svg = solveFunctionSvg({
      exprs: [{ expr: "(x^2 - 5x + 6) - (0)", label: "f", color: "#2563eb" }],
      variable: "x",
      marks: [2, 3].map((x) => ({ x, y: 0, label: "root" })),
      title: "Where the function crosses zero",
    });
    expect(hasCurve(svg)).toBe(true);
  });

  it("an expression the plotter always read draws exactly as before", () => {
    const o = { exprs: [{ expr: "(x^2 - 4) - (0)", label: "f", color: "#2563eb" }], variable: "x", title: "t" };
    const svg = solveFunctionSvg(o);
    expect(hasCurve(svg)).toBe(true);
    // The same expression written with an explicit product is the same figure.
    expect(solveFunctionSvg({ ...o, exprs: [{ ...o.exprs[0], expr: "(1*x^2 - 4) - (0)" }] })).toBe(svg);
  });

  it("implicit and explicit products give the same figure", () => {
    const a = solveFunctionSvg({ exprs: [{ expr: "3sin(x) + 2x", label: "f", color: "#000" }], variable: "x", title: "t" });
    const b = solveFunctionSvg({ exprs: [{ expr: "3*sin(x) + 2*x", label: "f", color: "#000" }], variable: "x", title: "t" });
    expect(hasCurve(a)).toBe(true);
    expect(a).toBe(b);
  });

  it("the integrated stretch of an implicit-product integrand is drawn too", () => {
    const svg = solveFunctionSvg({
      exprs: [{ expr: "2x", label: "f", color: "#94a3b8" }],
      variable: "x",
      window: { lo: -1, hi: 3 },
      shadeBetween: { lo: 0, hi: 2 },
      title: "Area from 0 to 2",
    });
    expect(svg).toContain("integrated");
  });

  it("an ambiguous product is still no figure (x(x-1): a function x, or x times?)", () => {
    expect(solveFunctionSvg({ exprs: [{ expr: "x(x-1)", label: "f", color: "#000" }], variable: "x", title: "t" })).toBeNull();
  });
});
