// v2.136.0 — exact polynomial roots (docs/SCOPE-SYMBOLIC-BATCH.md §B1, §D "Roots").
//
// The §D acceptance values, verbatim: exact display strings, multiplicities,
// method lines, and the SymPy 1.14.0 15-digit values each display must evaluate
// to. Every displayed root is also re-parsed through the Solve grammar (the
// display contract): a string that does not mean its own number is a defect
// even when the number beside it is right.

import { solveEquation, parseExpr, evalAst, normalizeUnicodeMath } from "../solve";
import { exactPolyRoots } from "../polyRoots";
import { ratInt, ratMake } from "../cas";

type R = NonNullable<ReturnType<typeof solveEquation>>;

const solve = (s: string): R => {
  const r = solveEquation(s);
  if (!r) throw new Error(`no result for ${s}`);
  return r;
};
const displays = (r: R): string[] => r.roots.map((x) => x.display);

/** The display re-parses and means (re, im) — linear in i, so i = 0 and i = 1 recover both parts. */
function expectContract(r: R): void {
  for (const root of r.roots) {
    const shown = root.display.replace(/ \(×\d+\)$/, "");
    const ast = parseExpr(shown);
    const re = evalAst(ast, { i: 0 });
    const im = evalAst(ast, { i: 1 }) - re;
    const scale = Math.max(1, Math.hypot(root.re, root.im));
    expect(Math.abs(re - root.re)).toBeLessThanOrEqual(1e-9 * scale);
    expect(Math.abs(im - root.im)).toBeLessThanOrEqual(1e-9 * scale);
  }
}

/** Values (re, im) to 1e-12 relative against an oracle list (any order). */
function expectValues(r: R, want: [number, number][]): void {
  expect(r.roots.length).toBe(want.length);
  const left = [...want];
  for (const root of r.roots) {
    const k = left.findIndex(([a, b]) => Math.hypot(root.re - a, root.im - b) <= 1e-12 * Math.max(1, Math.hypot(a, b)));
    expect(k).toBeGreaterThanOrEqual(0);
    left.splice(k, 1);
  }
}

describe("§D binomials, rational roots, factoring", () => {
  it.each(["x^3 = 2", "x³ = 2", "x^3 - 2 = 0"])("%s → cbrt(2) and its complex pair (binomial)", (s) => {
    const r = solve(s);
    expect(r.method).toBe("exact (binomial x^n = c)");
    expect(displays(r)).toEqual([
      "cbrt(2)",
      "-1/2*cbrt(2) - sqrt(3)/2*cbrt(2)*i",
      "-1/2*cbrt(2) + sqrt(3)/2*cbrt(2)*i",
    ]);
    expectValues(r, [[1.25992104989487, 0], [-0.629960524947437, 1.09112363597172], [-0.629960524947437, -1.09112363597172]]);
    expect(r.roots.every((x) => x.exact)).toBe(true);
    expect(r.caveats).toHaveLength(1);
    expect(r.caveats[0]).toMatch(/^Exact: certified by/);
    expectContract(r);
  });

  it("t^3 - 2 = 0 solves in t", () => {
    const r = solve("t^3 - 2 = 0");
    expect(r.variable).toBe("t");
    expect(displays(r)[0]).toBe("cbrt(2)");
  });

  it("x^3 = 27 → 3, -3/2 ± 3*sqrt(3)/2*i", () => {
    const r = solve("x^3 = 27");
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(displays(r)).toEqual(["3", "-3/2 - 3*sqrt(3)/2*i", "-3/2 + 3*sqrt(3)/2*i"]);
    expectContract(r);
  });

  it("x^3 = 1/2 → cbrt(4)/2 (rationalised), -cbrt(4)/4 ± sqrt(3)/4*cbrt(4)*i", () => {
    const r = solve("x^3 = 1/2");
    expect(displays(r)).toEqual(["cbrt(4)/2", "-cbrt(4)/4 - sqrt(3)/4*cbrt(4)*i", "-cbrt(4)/4 + sqrt(3)/4*cbrt(4)*i"]);
    // SymPy: 0.793700526, −0.396850263 ± 0.687364818i (shown to 9 digits in §D).
    for (const z of r.roots) {
      const want = z.im === 0 ? [0.793700526, 0] : [-0.396850263, Math.sign(z.im) * 0.687364818];
      expect(Math.abs(z.re - want[0])).toBeLessThan(1e-9);
      expect(Math.abs(z.im - want[1])).toBeLessThan(1e-9);
    }
    expectContract(r);
  });

  it.each([
    ["x^3 - 6x^2 + 11x - 6 = 0", ["3", "2", "1"]],
    ["2x^3 - 3x^2 - 3x + 2 = 0", ["2", "1/2", "-1"]],
    ["x^3 - x^2 - x + 1 = 0", ["1 (×2)", "-1"]],
    ["x^3 + 3x^2 - 4 = 0", ["1", "-2 (×2)"]],
    ["x^3 - 7x + 6 = 0", ["2", "1", "-3"]],
    ["x^3 - 3x^2 + 3x - 1 = 0", ["1 (×3)"]],
    ["x^3 + 1 = 0", ["1/2 - sqrt(3)/2*i", "1/2 + sqrt(3)/2*i", "-1"]],
    ["x^3 - 15x - 4 = 0", ["4", "-2 + sqrt(3)", "-2 - sqrt(3)"]],
    ["x^3 = 2x", ["sqrt(2)", "0", "-sqrt(2)"]],
    ["(x - 1)^3 = 8", ["3", "-sqrt(3)*i", "sqrt(3)*i"]],
  ])("%s → %j, factored over ℚ", (s, want) => {
    const r = solve(s);
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(displays(r)).toEqual(want);
    expect(r.roots.every((x) => x.exact)).toBe(true);
    expectContract(r);
  });

  it("x^3 - 15x - 4: the rational root comes FIRST, so Bombelli's complex radicals never appear", () => {
    const r = solve("x^3 - 15x - 4 = 0");
    expect(displays(r).join(" ")).not.toMatch(/cbrt|cos/);
    expectValues(r, [[4, 0], [-0.267949192431123, 0], [-3.73205080756888, 0]]);
  });

  it("the double-root work line: (x - 1)*(x + 2)^2 = 0", () => {
    const r = solve("x^3 + 3x^2 - 4 = 0");
    expect(r.steps).toContain("Factored: (x - 1)*(x + 2)^2 = 0.");
    expect(r.steps.some((s) => /Square-free factorisation/.test(s))).toBe(true);
    expect(r.steps).toContain("Rational-root test: 1 is a root; divide out (x - 1).");
  });
});

describe("§D three real roots — the trigonometric form, never complex radicals", () => {
  it("x^3 - 3x + 1 (cos θ = −1/2)", () => {
    const r = solve("x^3 - 3x + 1 = 0");
    expect(r.method).toBe("exact (cubic — trigonometric form, three real roots)");
    expect(displays(r)).toEqual(["2*cos(2*pi/9)", "2*cos(4*pi/9)", "2*cos(8*pi/9)"]);
    expectValues(r, [[1.53208888623796, 0], [0.347296355333861, 0], [-1.87938524157182, 0]]);
    expect(r.roots.every((x) => x.im === 0)).toBe(true);
    expect(r.steps.join(" ")).toMatch(/casus irreducibilis/);
    expect(r.steps.join(" ")).toMatch(/Δ = −4p³ − 27q² = 81 > 0: three real roots/);
    expect(r.caveats[0]).toMatch(/4cos³φ − 3cos φ = cos 3φ/);
    expectContract(r);
  });

  it("x^3 - 3*x - 1", () => {
    const r = solve("x^3 - 3*x - 1 = 0");
    expect(displays(r)).toEqual(["2*cos(pi/9)", "2*cos(5*pi/9)", "2*cos(7*pi/9)"]);
    expectValues(r, [[1.87938524157182, 0], [-0.347296355333861, 0], [-1.53208888623796, 0]]);
    expectContract(r);
  });

  it("8x^3 - 6x - 1 (unit coefficient: a bare cos)", () => {
    const r = solve("8x^3 - 6x - 1 = 0");
    expect(displays(r)).toEqual(["cos(pi/9)", "cos(5*pi/9)", "cos(7*pi/9)"]);
    expectValues(r, [[0.939692620785908, 0], [-0.17364817766693, 0], [-0.766044443118978, 0]]);
    expectContract(r);
  });

  it("x^3 - 1234567x + 1 — non-special argument; the small root keeps its digits", () => {
    const r = solve("x^3 - 1234567x + 1 = 0");
    expect(r.method).toBe("exact (cubic — trigonometric form, three real roots)");
    expect(displays(r)).toContain("2*sqrt(1234567/3)*cos(acos(-3/2469134*sqrt(3/1234567))/3)");
    const vals = r.roots.map((x) => x.re).sort((a, b) => b - a);
    expect(Math.abs(vals[0] - 1111.11070515) / 1111.11070515).toBeLessThan(1e-9);
    expect(Math.abs(vals[1] - 8.100005913e-7) / 8.100005913e-7).toBeLessThan(1e-9);
    expect(Math.abs(vals[2] + 1111.11070596) / 1111.11070596).toBeLessThan(1e-9);
    expectContract(r);
  });
});

describe("§D one real root — Cardano with real radicals", () => {
  it.each([
    ["x^3 - 2x - 5 = 0", "cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)", 2.09455148154233, [-1.04727574077116, 1.13593988908893]],
    ["x^3 + x + 1 = 0", "cbrt(-1/2 + sqrt(93)/18) + cbrt(-1/2 - sqrt(93)/18)", -0.682327803828019, [0.34116390191401, 1.16154139999725]],
    ["x^3 + 0.5x - 1 = 0", "cbrt(1/2 + sqrt(330)/36) + cbrt(1/2 - sqrt(330)/36)", 0.835122348481367, null],
  ] as [string, string, number, [number, number] | null][])("%s → %s", (s, real, val, pair) => {
    const r = solve(s);
    const realRoot = r.roots.find((x) => x.im === 0)!;
    expect(realRoot.display).toBe(real);
    expect(realRoot.exact).toBe(true);
    expect(Math.abs(realRoot.re - val)).toBeLessThan(1e-13);
    if (pair) {
      const c = r.roots.filter((x) => x.im !== 0);
      expect(c).toHaveLength(2);
      for (const z of c) {
        expect(Math.abs(z.re - pair[0])).toBeLessThan(1e-13);
        expect(Math.abs(Math.abs(z.im) - pair[1])).toBeLessThan(1e-13);
      }
    }
    // The complex pair as ω·u + ω̄·v (ω = −1/2 + √3/2·i) — inside the 120 cap
    // (re + im·i ran to ~128 characters and fell back to decimals).
    const pairs = r.roots.filter((x) => x.im !== 0);
    expect(pairs.every((x) => x.exact)).toBe(true);
    for (const z of pairs) {
      expect(z.display).toMatch(/^\(-1\/2 [+-] sqrt\(3\)\/2\*i\)\*cbrt\(.*\) \+ \(-1\/2 [+-] sqrt\(3\)\/2\*i\)\*cbrt\(.*\)$/);
      expect(z.display.length).toBeLessThanOrEqual(120);
    }
    expect(r.method).toBe("exact (cubic — Cardano, one real root)");
    expectContract(r);
  });
});

describe("§D quartics", () => {
  it("x^4 - 5x^2 + 4 → ±1, ±2", () => {
    expect(displays(solve("x^4 - 5x^2 + 4 = 0"))).toEqual(["2", "1", "-1", "-2"]);
  });
  it("x^4 = 16 → ±2, ±2i", () => {
    const r = solve("x^4 = 16");
    expect(displays(r)).toEqual(["2", "-2i", "2i", "-2"]);
    expectContract(r);
  });
  it("x^4 - 2 → ±2^(1/4), ±2^(1/4)*i (binomial)", () => {
    const r = solve("x^4 - 2 = 0");
    expect(r.method).toBe("exact (binomial x^n = c)");
    expect(displays(r)).toEqual(["2^(1/4)", "-2^(1/4)*i", "2^(1/4)*i", "-2^(1/4)"]);
    expect(r.roots[0].re).toBeCloseTo(1.18920711500272, 13);
    expectContract(r);
  });
  it("x^4 + 1 → ±sqrt(2)/2 ± sqrt(2)/2*i (biquadratic; never the square root of ±i)", () => {
    const r = solve("x^4 + 1 = 0");
    expect(r.method).toBe("exact (quartic — biquadratic)");
    expect(displays(r)).toEqual([
      "sqrt(2)/2 - sqrt(2)/2*i", "sqrt(2)/2 + sqrt(2)/2*i", "-sqrt(2)/2 - sqrt(2)/2*i", "-sqrt(2)/2 + sqrt(2)/2*i",
    ]);
    expectContract(r);
  });
  it("x^4 - 10x^2 + 1 → ±(sqrt(3) + sqrt(2)), ±(sqrt(3) - sqrt(2)) (denested)", () => {
    const r = solve("x^4 - 10x^2 + 1 = 0");
    expect(r.method).toBe("exact (quartic — biquadratic)");
    expect(displays(r)).toEqual(["sqrt(3) + sqrt(2)", "sqrt(3) - sqrt(2)", "-sqrt(3) + sqrt(2)", "-sqrt(3) - sqrt(2)"]);
    expectValues(r, [[3.14626436994197, 0], [0.317837245195782, 0], [-0.317837245195782, 0], [-3.14626436994197, 0]]);
    expectContract(r);
  });
  it("x^4 - 3x^2 + 1 = (x² − x − 1)(x² + x − 1) → ±(1/2 + sqrt(5)/2), ±(-1/2 + sqrt(5)/2)", () => {
    const r = solve("x^4 - 3x^2 + 1 = 0");
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(displays(r)).toEqual(["1/2 + sqrt(5)/2", "-1/2 + sqrt(5)/2", "1/2 - sqrt(5)/2", "-1/2 - sqrt(5)/2"]);
    expectContract(r);
  });
  it("x^4 + 4x - 1 (Ferrari; certificate = the ℚ(√2) factorisation)", () => {
    const r = solve("x^4 + 4x - 1 = 0");
    expect(r.method).toBe("exact (quartic — Ferrari)");
    expect(displays(r)).toEqual([
      "sqrt(2)/2 - sqrt(sqrt(2) + 1/2)*i",
      "sqrt(2)/2 + sqrt(sqrt(2) + 1/2)*i",
      "-sqrt(2)/2 + sqrt(sqrt(2) - 1/2)",
      "-sqrt(2)/2 - sqrt(sqrt(2) - 1/2)",
    ]);
    expectValues(r, [
      [0.249038376398374, 0], [-1.66325193877147, 0],
      [0.707106781186548, 1.3835510696657], [0.707106781186548, -1.3835510696657],
    ]);
    expect(r.caveats[0]).toMatch(/ℚ\(√2\)/);
    expectContract(r);
  });
  it("x^4 + x + 1 → numeric, Ferrari refused BY NAME", () => {
    const r = solve("x^4 + x + 1 = 0");
    expect(r.method).toBe("complete (all roots)");
    expect(r.roots.every((x) => !x.exact)).toBe(true);
    expect(r.caveats.join(" ")).toMatch(
      /a closed form exists \(Ferrari\) but needs the cube root of a complex number from its resolvent cubic and runs to hundreds of characters/,
    );
    expectValues(r, [
      [-0.727136084491197, 0.430014288329716], [-0.727136084491197, -0.430014288329716],
      [0.727136084491197, 0.934099289460529], [0.727136084491197, -0.934099289460529],
    ]);
    expectContract(r);
  });
});

describe("§D repeated roots — exact multiplicities, NO complex shards", () => {
  it.each([
    ["(x-1)^4 = 0", ["1 (×4)"]],
    ["x^4 - 4x^3 + 6x^2 - 4x + 1 = 0", ["1 (×4)"]],
    ["(x-2)^3*(x+1) = 0", ["2 (×3)", "-1"]],
    ["x^6 - 3x^4 + 3x^2 - 1 = 0", ["1 (×3)", "-1 (×3)"]],
    ["x^4 - 2x^2 + 1 = 0", ["1 (×2)", "-1 (×2)"]],
    ["(x^2 + 1)^2 = 0", ["-i (×2)", "i (×2)"]],
  ])("%s → %j", (s, want) => {
    const r = solve(s);
    expect(displays(r)).toEqual(want);
    expect(r.method).toBe("exact (factored over ℚ)");
    for (const root of r.roots) {
      const m = /\(×(\d+)\)$/.exec(root.display);
      expect(root.mult).toBe(m ? Number(m[1]) : undefined);
    }
    expectContract(r);
  });
});

describe("§D degree ≥ 5", () => {
  it("x^6 - 9x^3 + 8 → 2, 1, -1/2 ± sqrt(3)/2*i, -1 ± sqrt(3)*i (exact, factored)", () => {
    const r = solve("x^6 - 9x^3 + 8 = 0");
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(displays(r)).toEqual(["2", "1", "-1/2 - sqrt(3)/2*i", "-1/2 + sqrt(3)/2*i", "-1 - sqrt(3)*i", "-1 + sqrt(3)*i"]);
    expectContract(r);
  });
  it("x^5 - x - 1 → numeric with the Abel–Ruffini caveat (never 'unsolvable')", () => {
    const r = solve("x^5 - x - 1 = 0");
    expect(r.method).toBe("complete (all roots)");
    expect(r.caveats).toContain(
      "Degree 5: no general formula in radicals exists (Abel–Ruffini); this quintic was not tested for solvability by radicals, so its roots are numerical.",
    );
    expect(r.caveats.join(" ")).not.toMatch(/unsolvable|cannot be solved/i);
    expectValues(r, [
      [1.16730397826142, 0],
      [-0.764884433600585, 0.352471546031726], [-0.764884433600585, -0.352471546031726],
      [0.181232444469875, 1.08395410131771], [0.181232444469875, -1.08395410131771],
    ]);
    expectContract(r);
  });
  it("x^5 = 32 → 2 exact; the quartic cofactor is ALSO exact here (its resolvent has a rational root)", () => {
    // §D expected the other four numeric. The Ferrari branch finds m rational for
    // x⁴ + 2x³ + 4x² + 8x + 16 (a scaled 5th cyclotomic, cyclic Galois group), so
    // the certified pipeline gives them exactly: 2·e^(±2πi/5), 2·e^(±4πi/5).
    const r = solve("x^5 = 32");
    expect(r.roots[0].display).toBe("2");
    expect(r.roots).toHaveLength(5);
    expectValues(r, [0, 1, 2, 3, 4].map((k) => [2 * Math.cos((2 * Math.PI * k) / 5), 2 * Math.sin((2 * Math.PI * k) / 5)] as [number, number]).map(([a, b]) => [Math.abs(a) < 1e-15 ? 0 : a, b] as [number, number]));
    expect(r.roots.every((x) => x.exact)).toBe(true);
    expectContract(r);
  });
});

describe("§D unchanged twins", () => {
  it("x^2 - 2 → sqrt(2) exact (the quadratic path is untouched)", () => {
    const r = solve("x^2 - 2 = 0");
    expect(r.method).toBe("exact (quadratic)");
    expect(displays(r)).toEqual(["sqrt(2)", "-sqrt(2)"]);
  });
  it("x^2 + x + 1 → -1/2 ± sqrt(3)/2*i", () => {
    expect(displays(solve("x^2 + x + 1 = 0"))).toEqual(["-1/2 + sqrt(3)/2*i", "-1/2 - sqrt(3)/2*i"]);
  });
  it("cbrt(x) = 2 → 8", () => {
    expect(solve("cbrt(x) = 2").roots.map((x) => x.re)).toEqual([8]);
  });
  it("x^100 = 2 → real roots only, said", () => {
    const r = solve("x^100 = 2");
    expect(r.roots).toHaveLength(2);
    expect(r.roots.every((x) => x.im === 0)).toBe(true);
  });
});

describe("the frozen API", () => {
  it("exactPolyRoots(coeffs) returns roots with mult and certificate", () => {
    const res = exactPolyRoots([ratInt(-2), ratInt(0), ratInt(0), ratInt(1)])!;
    expect(res.method).toBe("exact (binomial x^n = c)");
    expect(res.incomplete).toBe(false);
    expect(res.roots[0]).toMatchObject({ display: "cbrt(2)", exact: true, mult: 1, im: 0 });
    expect(res.roots[0].certificate).toMatch(/cbrt\(2\)\)³ = 2/);
  });
  it("multiplicity is a field, not only display text", () => {
    // (x − 1/2)²(x + 3) = x³ + 2x² − 11/4·x + 3/4
    const res = exactPolyRoots([ratMake(3n, 4n), ratMake(-11n, 4n), ratInt(2), ratInt(1)])!;
    expect(res.roots.map((r) => [r.display, r.mult])).toEqual([["1/2", 2], ["-3", 1]]);
  });
  it("degree 1 and 2 through the API directly (radius.ts calls it on denominators)", () => {
    expect(exactPolyRoots([ratInt(3), ratInt(2)])!.roots.map((r) => [r.display, r.mult])).toEqual([["-3/2", 1]]);
    const i2 = exactPolyRoots([ratInt(1), ratInt(0), ratInt(1)])!;
    expect(i2.roots.map((r) => r.display)).toEqual(["-i", "i"]);
    expect(i2.roots.map((r) => [r.re, r.im])).toEqual([[0, -1], [0, 1]]);
    expect(i2.method).toBe("exact (factored over ℚ)");
    const dbl = exactPolyRoots([ratInt(1), ratInt(2), ratInt(1)])!;
    expect(dbl.roots.map((r) => [r.display, r.mult])).toEqual([["-1", 2]]);
    const q = exactPolyRoots([ratInt(4), ratInt(0), ratInt(1)])!; // x² + 4 → ±2i, |z| = 2
    expect(q.roots.map((r) => r.display)).toEqual(["-2i", "2i"]);
    const s = exactPolyRoots([ratInt(-5), ratInt(0), ratInt(1)])!; // x² − 5
    expect(s.roots.map((r) => r.display)).toEqual(["sqrt(5)", "-sqrt(5)"]);
  });
  it("caps BEFORE work: degree over 64 → null (the caller keeps its own path)", () => {
    const c = new Array(66).fill(0).map(() => ratInt(0));
    c[0] = ratInt(-1);
    c[65] = ratInt(1);
    expect(exactPolyRoots(c)).toBeNull();
  });
});

describe("input aliases: ∛ ∜ arccos arcsin arctan (display stays cbrt/acos)", () => {
  const val = (s: string): number => evalAst(parseExpr(s), {});
  it("∛ and ∜ parse", () => {
    expect(val("∛8")).toBeCloseTo(2, 14);
    expect(val("∛(-8)")).toBeCloseTo(-2, 14);
    expect(val("∜16")).toBeCloseTo(2, 14);
    expect(val("√∛64")).toBeCloseTo(2, 14);
    expect(val("2∛27")).toBeCloseTo(6, 14);
  });
  it("arc-names are whole-word aliases", () => {
    expect(val("arccos(0)")).toBeCloseTo(Math.PI / 2, 14);
    expect(val("arcsin(1)")).toBeCloseTo(Math.PI / 2, 14);
    expect(val("arctan(1)")).toBeCloseTo(Math.PI / 4, 14);
    expect(normalizeUnicodeMath("arcsinh(x)")).toBe("arcsinh(x)");
    expect(val("2arcsin(1)")).toBeCloseTo(Math.PI, 14);
    expect(val("arccos(1/2) + arctan(1)")).toBeCloseTo(Math.PI / 3 + Math.PI / 4, 14);
  });
  it("x³ = 2 typed with ∛ on the other side round-trips", () => {
    const r = solve("x = ∛2");
    expect(r.roots[0].re).toBeCloseTo(Math.cbrt(2), 14);
  });
});
