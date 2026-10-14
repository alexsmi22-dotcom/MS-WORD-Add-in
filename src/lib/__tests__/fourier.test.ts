/** Fourier series — the acceptance audit from docs/SCOPE-LAPLACE-MULTIVAR.md §D. */
import { parseExpr, evalAst, format } from "../solve";
import { parseFourierRequest, fourierSeries, tryFourierSeries } from "../fourier";

const series = (q: string) => {
  const req = parseFourierRequest(q);
  if (req === null || "error" in req) throw new Error("request: " + (req === null ? "null" : req.error));
  const r = fourierSeries(req);
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const at = (e: ReturnType<typeof parseExpr> | null, n: number): number => {
  if (!e) throw new Error("no closed form");
  return evalAst(e, { n });
};
const num = (e: ReturnType<typeof parseExpr>): number => evalAst(e, {});

describe("closed forms in n", () => {
  it("t on (−π, π): b_n = 2(−1)^{n+1}/n, a_n = 0", () => {
    const r = series("fourier series t on (-pi, pi)");
    expect(num(r.a0)).toBeCloseTo(0, 12);
    for (let n = 1; n <= 6; n++) {
      expect(at(r.bn, n)).toBeCloseTo((2 * (n % 2 === 1 ? 1 : -1)) / n, 12);
      expect(at(r.an, n)).toBeCloseTo(0, 12);
    }
    expect(format(r.bn!)).toMatch(/\(-1\)\^n/);
    expect(format(r.bn!)).not.toMatch(/e-1\d|0\.\d{6}/);
    expect(r.verified).toBe(true);
  });
  it("t² on (−π, π): a_0/2 = π²/3, a_n = 4(−1)^n/n²", () => {
    const r = series("fourier series t^2 on (-pi, pi)");
    expect(num(r.a0) / 2).toBeCloseTo((Math.PI * Math.PI) / 3, 12);
    expect(format(r.a0)).toMatch(/pi\^2/);
    for (let n = 1; n <= 5; n++) expect(at(r.an, n)).toBeCloseTo((4 * (n % 2 ? -1 : 1)) / (n * n), 12);
    expect(format(r.an!)).toMatch(/\(-1\)\^n/);
  });
  it("abs(t) on (−π, π) is split at 0: a_n = −4/(πn²) for odd n, 0 for even", () => {
    const r = series("fourier series abs(t) on (-pi, pi)");
    expect(num(r.a0) / 2).toBeCloseTo(Math.PI / 2, 12);
    expect(at(r.an, 1)).toBeCloseTo(-4 / Math.PI, 12);
    expect(at(r.an, 2)).toBeCloseTo(0, 12);
    expect(at(r.an, 3)).toBeCloseTo(-4 / (9 * Math.PI), 12);
    for (let n = 1; n <= 5; n++) expect(at(r.bn, n)).toBeCloseTo(0, 12);
  });
  it("the square wave −1 on (−π, 0); 1 on (0, π): b_n = 4/(πn) for odd n", () => {
    const r = series("fourier series -1 on (-pi, 0); 1 on (0, pi)");
    expect(at(r.bn, 1)).toBeCloseTo(4 / Math.PI, 12);
    expect(at(r.bn, 2)).toBeCloseTo(0, 12);
    expect(at(r.bn, 3)).toBeCloseTo(4 / (3 * Math.PI), 12);
    expect(r.caveats.join(" ")).toMatch(/Gibbs/);
  });
  it("t on (0, 2): a_0/2 = 1, b_n = −2/(πn)", () => {
    const r = series("fourier series t on (0, 2)");
    expect(num(r.a0) / 2).toBeCloseTo(1, 12);
    for (let n = 1; n <= 4; n++) expect(at(r.bn, n)).toBeCloseTo(-2 / (Math.PI * n), 12);
    for (let n = 1; n <= 4; n++) expect(at(r.an, n)).toBeCloseTo(0, 12);
  });
  it("exp(t) on (−1, 1) has a closed form through the exponential integral", () => {
    const r = series("fourier series exp(t) on (-1, 1)");
    // a_n = (−1)^n (e − 1/e) / (1 + n²π²)
    for (let n = 1; n <= 4; n++) {
      expect(at(r.an, n)).toBeCloseTo(((n % 2 ? -1 : 1) * (Math.E - 1 / Math.E)) / (1 + n * n * Math.PI * Math.PI), 10);
    }
    expect(r.verified).toBe(true);
  });
});

describe("sinusoids and resonance", () => {
  it("cos(t) on (−π, π) is its own series: a_1 = 1 and no 0/0", () => {
    const r = series("fourier series cos(t) on (-pi, pi)");
    expect(r.terms[0].a && num(r.terms[0].a)).toBe(1);
    expect(num(r.terms[1].a)).toBe(0);
    expect(r.special.map((s) => s.n)).toEqual([1]);
    expect(r.verified).toBe(true);
  });
  it("sin(t)² on (−π, π) terminates: 1/2 − cos(2t)/2", () => {
    const r = series("fourier series sin(t)^2 on (-pi, pi)");
    expect(num(r.a0) / 2).toBeCloseTo(0.5, 12);
    expect(num(r.terms[1].a)).toBeCloseTo(-0.5, 12);
    expect(num(r.terms[0].a)).toBeCloseTo(0, 12);
    expect(num(r.terms[2].a)).toBeCloseTo(0, 12);
  });
  it("2 + 3 sin(2t) on (−π, π): a_0/2 = 2, b_2 = 3", () => {
    const r = series("fourier series 2 + 3 sin(2t) on (-pi, pi)");
    expect(num(r.a0) / 2).toBe(2);
    expect(num(r.terms[1].b)).toBe(3);
  });
});

describe("no closed form: coefficients one by one", () => {
  it("a piece boundary at π/2 gives exact per-n coefficients and says why", () => {
    const r = series("fourier series 1 on (-pi/2, pi/2); 0 on (pi/2, 3pi/2)");
    expect(r.an).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/no closed form/);
    expect(num(r.a0) / 2).toBeCloseTo(0.5, 12);
    expect(num(r.terms[0].a)).toBeCloseTo(2 / Math.PI, 12);
    expect(num(r.terms[1].a)).toBeCloseTo(0, 12);
    expect(num(r.terms[2].a)).toBeCloseTo(-2 / (3 * Math.PI), 12);
    expect(r.verified).toBe(true);
  });
});

describe("the verb", () => {
  it("renders the coefficient lines, the partial sum, and the plot", () => {
    const v = tryFourierSeries("fourier series t on (-pi, pi)")!;
    expect(v.lines.some((l) => /^b_n = /.test(l.text))).toBe(true);
    expect(v.lines.some((l) => /^S_5\(t\) = /.test(l.text))).toBe(true);
    expect(v.plot?.exprs).toHaveLength(2);
    expect(v.plot?.window).toEqual({ lo: -Math.PI, hi: Math.PI });
    expect(v.caveats[0]).toMatch(/Verified/);
  });
  it("the displayed coefficient and partial sum re-parse (display contract)", () => {
    for (const q of ["fourier series t^2 on (-pi, pi)", "fourier series abs(t) on (-pi, pi)", "fourier series exp(t) on (-1, 1)"]) {
      const v = tryFourierSeries(q)!;
      for (const l of v.lines.filter((x) => x.math)) {
        const rhs = l.text.replace(/^[^=]+= /, "");
        expect(() => parseExpr(rhs)).not.toThrow();
      }
      expect(() => parseExpr(v.plot!.exprs[0].expr)).not.toThrow();
      expect(() => parseExpr(v.plot!.exprs[1].expr)).not.toThrow();
    }
  });
  it("the partial sum evaluates near f away from jumps", () => {
    const v = tryFourierSeries("fourier series t^2 on (-pi, pi)")!;
    const S5 = parseExpr(v.plot!.exprs[1].expr);
    for (const t of [0, 1, -1.5, 2]) {
      expect(Math.abs(evalAst(S5, { t }) - t * t)).toBeLessThan(0.2);
    }
  });
  it("refuses by name what the pieces do not cover", () => {
    expect(tryFourierSeries("fourier series ln(t) on (1, 2)")!.caveats[0]).toMatch(/Not computed/);
    expect(tryFourierSeries("fourier series t sin(t) on (-pi, pi)")!.caveats[0]).toMatch(/Not computed/);
    expect(tryFourierSeries("fourier series sin(1.5 t) on (-pi, pi)")!.caveats[0]).toMatch(/multiple of the fundamental/);
    expect(tryFourierSeries("fourier series t on (0, 1); t on (2, 3)")!.caveats[0]).toMatch(/join up/);
    expect(tryFourierSeries("fourier series t on (1, 1)")!.caveats[0]).toMatch(/empty/);
  });
  it("is not a verb for anything else", () => {
    expect(tryFourierSeries("taylor exp(x) order 5")).toBeNull();
    expect(tryFourierSeries("x^2 = 4")).toBeNull();
    expect(tryFourierSeries("fourier series = 3")).toBeNull();
  });
});
