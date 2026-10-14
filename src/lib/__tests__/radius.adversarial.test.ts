// Radius of convergence — the traps. Each case is one a coefficient-reading or
// real-axis-only method gets wrong, or one where a careless composition rule
// invents (or misses) a singularity.

import { radiusOfFunction, radiusOfSeriesTerm, tryRadius } from "../radius";
import { taylorSeries } from "../analysis";

const F = (f: string, c: number | string = 0) => radiusOfFunction(f, "x", c);

describe("classic traps", () => {
  it("1/(1+x^2) at 0: R = 1 from the complex poles ±i — no real singularity at all", () => {
    const r = F("1/(1+x^2)");
    expect(r.kind).toBe("finite");
    expect(r.exact).toBe("1");
    expect(r.nearest.every((s) => s.im !== 0 && s.sure)).toBe(true);
    expect(r.interval?.text).toBe("(-1, 1)");
  });
  it("e^x (written with the constant e) is entire: R = ∞", () => {
    expect(F("e^x").kind).toBe("infinite");
    expect(F("exp(x)").kind).toBe("infinite");
    expect(F("2^x").kind).toBe("infinite");
  });
  it("log(1+x) at 0: R = 1, converges at x = 1 (conditionally), diverges at −1", () => {
    const r = F("log(1+x)");
    expect(r.exact).toBe("1");
    expect(r.interval?.text).toBe("(-1, 1]");
    expect(r.interval?.reasons.join(" ")).toMatch(/alternating harmonic/);
    expect(r.interval?.reasons.join(" ")).toMatch(/harmonic series/);
  });
  it("log(1+x) at 1: R = 2, interval (−1, 3]", () => {
    const r = F("ln(1+x)", 1);
    expect(r.exact).toBe("2");
    expect(r.interval?.text).toBe("(-1, 3]");
  });
  it("tan x at 0: R = π/2 (the poles ±π/2)", () => {
    const r = F("tan(x)");
    expect(r.exact).toBe("pi/2");
    expect(r.value).toBeCloseTo(Math.PI / 2, 14);
    expect(r.interval?.loClosed).toBeNull(); // no named test at the poles: not claimed
  });
  it("tan x at 1: R = π/2 − 1, exact", () => {
    expect(F("tan(x)", 1).exact).toBe("pi/2 - 1");
  });
  it("1/(x − 3) expanded at 1: R = 2", () => {
    const r = F("1/(x-3)", 1);
    expect(r.exact).toBe("2");
    expect(r.interval?.text).toBe("(-1, 3)");
  });
  it("sqrt(1+x): R = 1, and the binomial series converges at both ends (p = 1/2 > 0)", () => {
    const r = F("sqrt(1+x)");
    expect(r.exact).toBe("1");
    expect(r.interval?.text).toBe("[-1, 1]");
  });
  it("sin(x)/x: R = ∞ — 0 is removable, not a singularity", () => {
    const r = F("sin(x)/x");
    expect(r.kind).toBe("infinite");
    expect(r.removable).toContain("x = 0");
    expect(F("sin(x)*(1/x)").kind).toBe("infinite");
    expect(F("(sin(x) - x)/x^3").kind).toBe("infinite"); // removable to order 3
  });
  it("x/(e^x − 1): R = 2π — 0 removable, nearest poles ±2πi", () => {
    const r = F("x/(exp(x)-1)");
    expect(r.exact).toBe("2*pi");
    expect(r.nearest.every((s) => Math.abs(Math.abs(s.im) - 2 * Math.PI) < 1e-12)).toBe(true);
  });
  // The builder brief listed "1/(e^x − 1) (R = 2π)". At 0 that function has a POLE,
  // so it has no Taylor series there; 2π is the outer radius of its LAURENT series.
  // §D's row is x/(e^x − 1); this pins the honest answer for the brief's input.
  it("1/(e^x − 1) at 0: no Taylor series (pole at the centre); Laurent annulus out to 2π", () => {
    const r = F("1/(exp(x)-1)");
    expect(r.kind).toBe("centreSingular");
    expect(r.laurentOuter?.display).toBe("2*pi");
    expect(r.line).toMatch(/No Taylor series about x = 0/);
    expect(r.line).toMatch(/±2\*pi\*i/);
  });
  it("1/(e^x − 1) at 1: R = 1 (the pole at 0)", () => {
    expect(F("1/(exp(x)-1)", 1).exact).toBe("1");
  });
});

describe("removability is decided EXACTLY, never by a small float", () => {
  it("sin(x)/(x − 103993/33102): sin is ~3e-11 at the pole, which is still a pole", () => {
    const r = F("sin(x)/(x - 103993/33102)");
    expect(r.kind).toBe("finite");
    expect(r.exact).toBe("103993/33102");
  });
  it("(x − 1)·sin(x)/(x − 1)^2 keeps a simple pole at 1", () => {
    expect(F("(x-1)*sin(x)/(x-1)^2", 3).exact).toBe("2");
  });
  it("(exp(x) − 1)/x is entire", () => {
    expect(F("(exp(x)-1)/x").kind).toBe("infinite");
  });
});

describe("composition rules that must not invent or miss a singularity", () => {
  it("sqrt((1+x)^2) has NO branch point at −1 (even-order zero)", () => {
    const r = F("sqrt((1+x)^2)");
    expect(r.kind).toBe("infinite");
  });
  it("sqrt(x^2 + 1): branch points ±i, R = 1", () => {
    expect(F("sqrt(x^2+1)").exact).toBe("1");
  });
  it("cos(sqrt(x)) about 1: the branch point of √x may vanish (it does) — only R ≥ 1 is claimed", () => {
    const r = F("cos(sqrt(x))", 1);
    expect(r.kind).toBe("lowerBound");
    expect(r.line).toMatch(/^R ≥ 1/);
  });
  it("exp(1/(1−x)): the pole of the argument becomes an essential singularity, R = 1", () => {
    const r = F("exp(1/(1-x))");
    expect(r.exact).toBe("1");
    expect(r.nearest[0].kind).toBe("essential singularity");
  });
  it("a zero of a factor cannot cancel a branch point: x·ln(x) about 1 has R = 1", () => {
    expect(F("x*ln(x)", 1).exact).toBe("1");
  });
  it("a sum whose singularities coincide is only a lower bound", () => {
    const r = F("ln(1+x) + sqrt(1+x)");
    expect(r.kind).toBe("lowerBound");
    expect(r.value).toBe(1);
  });
  it("1/(x^2 − 2) about 1: R = sqrt(2) − 1, exact signs", () => {
    expect(F("1/(x^2-2)", 1).exact).toBe("sqrt(2) - 1");
  });
  it("asin(x): branch points ±1; asin(x^2): 1 − x⁴ has simple zeros ±1, ±i, so R = 1", () => {
    expect(F("asin(x)").exact).toBe("1");
    expect(F("asin(x^2)").exact).toBe("1");
  });
  it("an irreducible cubic denominator is located numerically and said so with ≈", () => {
    const r = F("1/(x^3-x-1)");
    expect(r.kind).toBe("finite");
    expect(r.exact).toBeUndefined();
    expect(r.display).toMatch(/^≈ 0\.86883696/); // |complex roots| of the plastic-number cubic
    expect(r.caveats.join(" ")).toMatch(/numerically/);
  });
  it("a binomial denominator has an exact modulus about 0: 1/(x^3 − 2) → 2^(1/3), 1/(x^4 + 1) → 1", () => {
    const r = F("1/(x^3-2)");
    expect(r.exact).toBe("2^(1/3)");
    expect(r.value).toBeCloseTo(Math.cbrt(2), 12);
    expect(F("1/(x^4+1)").exact).toBe("1");
    expect(F("1/(x^4+1)", 1).exact).toBeUndefined(); // off-centre the distances differ: numeric, said
  });
  it("π-linear denominators are exact zeros; removability decided exactly", () => {
    expect(F("sin(x)/(x - pi)").kind).toBe("infinite");
    expect(F("cos(x)/(x - pi)").exact).toBe("pi");
    expect(F("cos(x)/(2*x - pi)").kind).toBe("infinite");
    expect(F("1/(x - pi/2)", 1).exact).toBe("pi/2 - 1");
  });
  it("an identically-zero factor kills every singularity", () => {
    expect(F("0*log(1-x)").kind).toBe("infinite");
    expect(F("log(1-x)*sin(0)").kind).toBe("infinite");
    expect(F("(x - x)/(1 - x)").kind).toBe("infinite");
  });
  it("a decimal coefficient is read exactly: 1/(1 − 0.1x) has R = 10", () => {
    expect(F("1/(1-0.1*x)").exact).toBe("10");
  });
  it("π in a coefficient is not folded into a fake rational pole", () => {
    const r = F("1/(x^2 - pi)");
    expect(r.kind).toBe("refused");
  });
});

describe("a numeric 'nonzero' must be judged against the scale of what cancelled", () => {
  // exp(x+40) − e⁴⁰·eˣ ≡ 0, but in doubles it is ~10 — far above any absolute cut-off.
  it("an identically-zero numerator over (x − 1/2) is NOT certified as a pole", () => {
    const r = F("(exp(x+40) - exp(40)*exp(x))/(x - 1/2)");
    expect(r.kind).not.toBe("finite");
  });
  it("the same zero numerator times ln(x) about 1 is not a certified branch point", () => {
    const r = F("(exp(x+40) - exp(40)*exp(x))*ln(x)", 1);
    expect(r.kind).not.toBe("finite");
  });
});

describe("refused by name", () => {
  it.each([
    ["abs(x)", /abs/],
    ["floor(x)", /floor/],
    ["gamma(x)", /gamma/],
    ["x^x", /both base and exponent/],
    ["tan(x^2)", /linear argument/],
    ["1/(x - a)", /another symbol/],
    ["1/(x + sin(x))", /zeros of .* are not determined/],
  ])("%s", (f, why) => {
    const r = F(f, 1);
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(why);
  });
  it("a centre on a branch point: no Taylor series", () => {
    const r = F("ln(x)", 0);
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(/branch point/);
  });
  it("sum terms outside the ratio-test forms are refused by name", () => {
    expect(radiusOfSeriesTerm("ln(n)*x^n").reason).toMatch(/not a rational function of n/);
    expect(radiusOfSeriesTerm("x^n/factorial(2n)").reason).toMatch(/\(2n\)! or \(n\+1\)!/);
    expect(radiusOfSeriesTerm("n^n*x^n").reason).toMatch(/both base and exponent/);
    expect(radiusOfSeriesTerm("1/n^2").reason).toMatch(/no variable/);
    expect(radiusOfSeriesTerm("x^(-n)").reason).toMatch(/exponent/);
  });
  it("sums: alternating sign, sqrt(n), x^(2n) — exact", () => {
    expect(radiusOfSeriesTerm("(-1)^n*x^n/sqrt(n)").interval?.text).toBe("(-1, 1]");
    expect(radiusOfSeriesTerm("x^(2n)/4^n").exact).toBe("2");
    expect(radiusOfSeriesTerm("x^(2n)/2^n").exact).toBe("sqrt(2)");
    expect(radiusOfSeriesTerm("(2x+1)^n/n").interval?.text).toBe("[-1, 0)");
  });
  it("the Taylor verb keeps its series when the radius is refused", () => {
    const t = taylorSeries("abs(x)+1", "x", 1, 3);
    expect(t).not.toBeNull();
    expect(t!.radiusLine).toMatch(/not determined/);
  });
});

describe("gross-freeze bounds (4 s each)", () => {
  const time = (fn: () => unknown): number => {
    const t0 = Date.now();
    fn();
    return Date.now() - t0;
  };
  it("a tower of powers is refused before it is expanded", () => {
    let ms = 0;
    ms = time(() => expect(F("1/((x+1)^64)^64").kind).toBe("refused"));
    expect(ms).toBeLessThan(4000);
  });
  it("a degree-9 denominator is refused by the cap", () => {
    const r = F("1/(x^9 + x + 1)");
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(/capped at degree 8/);
  });
  it("a degree-8 denominator with big coefficients finishes", () => {
    const ms = time(() => expect(F("1/(123456789*x^8 - 987654321*x^3 + 1000000007)").kind).toBe("finite"));
    expect(ms).toBeLessThan(4000);
  });
  it("a degree-8 denominator just under the 512-bit coefficient cap finishes (ratPolyRoots runs twice)", () => {
    const big = (2n ** 505n + 3n).toString();
    const ms = time(() => F(`1/(${big}*x^8 + x + ${big})`));
    expect(ms).toBeLessThan(4000);
    const over = (2n ** 520n).toString();
    const r = F(`1/(${over}*x^2 + 1)`);
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(/512 bits/);
  });
  it("a highly composite 64-bit coefficient (the rational-root theorem's worst case) finishes", () => {
    expect(time(() => F("1/(9200527969062830400*x^8 + x^3 + 9200527969062830400)"))).toBeLessThan(4000);
  });
  it("rational roots of a degree ≥ 3 denominator are certified exactly", () => {
    expect(F("1/(x^3 - 6*x^2 + 11*x - 6)").exact).toBe("1");
    expect(F("1/((2*x - 3)*(x^2 + x + 5))").exact).toBe("3/2");
    expect(F("1/((3*x + 7)*(x^2 + 1)*(x^2 + 9))", 1).exact).toBe("sqrt(2)");
  });
  it("deep nesting and long input are refused by the caps", () => {
    const deep = "ln(".repeat(45) + "1+x" + ")".repeat(45);
    expect(time(() => expect(F(deep).kind).toBe("refused"))).toBeLessThan(4000);
    const long = Array.from({ length: 250 }, () => "x").join("+");
    const r = F(`1/(${long})`);
    expect(r.kind).toBe("refused");
    expect(r.reason).toMatch(/longer than 400 characters/);
  });
  it("many trig families in a sum stay inside the work budget", () => {
    const f = Array.from({ length: 20 }, (_, i) => `tan(${i + 1}*x)`).join(" + ");
    expect(time(() => F(f))).toBeLessThan(4000);
  });
  it("a sum term with large exponents finishes", () => {
    expect(time(() => radiusOfSeriesTerm("x^(12n)*n^40/(n^39+1)/12345678901234567890^n"))).toBeLessThan(4000);
  });
  it("the verb on a long nonsense request returns promptly", () => {
    expect(time(() => tryRadius(`radius of convergence of ${"sin(".repeat(30)}x${")".repeat(30)}`))).toBeLessThan(4000);
  });
});
