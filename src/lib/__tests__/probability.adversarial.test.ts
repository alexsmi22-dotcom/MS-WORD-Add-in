/**
 * Probability + Markov — the defects the independent adversarial pass found
 * behind a green acceptance audit (v2.131.0), pinned so they stay fixed.
 */
import { parseExpr, evalAst } from "../solve";
import { tryProbability, PROB_VERB_RE } from "../probability";
import { tryMarkov } from "../markov";
import { normalQuantile, normalCdfPrecise, erfPrecise, tanhSinh } from "../probdist";

const run = (q: string) => {
  const v = tryProbability(q) ?? tryMarkov(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = tryProbability(q) ?? tryMarkov(q);
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const firstMath = (q: string): number => evalAst(parseExpr(run(q).lines.find((l) => l.math)!.text), { pi: Math.PI, e: Math.E });

describe("A: wide ranges and large parameters", () => {
  it("Poisson λ = 10⁶: P(X ≤ λ) ≈ 0.500266 (once '= 1, exact, verified'; then the incomplete gamma ran out of iterations)", () => {
    expect(Math.abs(firstMath("poisson lambda = 1000000 P(X <= 1000000)") - 0.500266)).toBeLessThan(2e-6);
    expect(Math.abs(firstMath("poisson lambda = 1000000 P(X <= 1002001)") - 0.977304)).toBeLessThan(2e-6);
    expect(firstMath("poisson lambda = 1e6 P(X <= 10000)")).toBe(0);
  });
  it("binomial n = 5000 and n = 10000 answer in milliseconds, by the cdf, cross-checked by a float sum", () => {
    const t = Date.now();
    expect(Math.abs(firstMath("binomial n=5000 p=0.5 P(X <= 2500)") - 0.505642)).toBeLessThan(2e-6);
    expect(firstMath("binomial n=10000 p=0.4 P(X <= 2000)")).toBe(0);
    expect(text("binomial n=2000 p=0.4 P(X <= 1000)")).toMatch(/P\(X ≤ 1000\) ≈ 1/);
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it("a tail too wide to cross-check is refused by name, not summed for two minutes", () => {
    const t = Date.now();
    expect(refusal("geometric p=0.2 P(X > 10000000)")).toMatch(/too wide for the independent cross-check/);
    expect(refusal("poisson lambda 5 P(X >= 100000000)")).toMatch(/too wide/);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("A: wrong numbers", () => {
  it("a biased coin asked about TAILS uses 1 − p (p is the probability of heads)", () => {
    const v = run("flip a biased coin 5 times with p = 0.3, at least 2 tails");
    expect(v.lines.find((l) => l.math)!.text).toBe("48461/50000");
    expect(v.caveats.join(" ")).toMatch(/P\(tail\) = 7\/10/);
  });
  it("negative binomial honours `failures`", () => {
    expect(run("negative binomial r=3 p=0.5 failures P(X = 2)").lines.find((l) => l.math)!.text).toBe("3/16");
    expect(run("negative binomial r=3 p=0.5 P(X = 4)").lines.find((l) => l.math)!.text).toBe("3/16");
  });
  it("binomial mode: the tie is tested on the rational, and never leaves the support", () => {
    expect(text("binomial n=10 p=1 mode")).toMatch(/mode = 10$/m);
    expect(text("binomial n=99 p=0.07 mode")).toMatch(/mode = 6 and 7/);
    expect(text("binomial n=10 p=0.4 mode")).toMatch(/mode = 4$/m);
  });
  it("a confidence level written as a decimal is honoured", () => {
    const t = text("confidence interval 0.99 mean 50 sd 10 n 30");
    expect(t).toMatch(/\[45\.2972, 54\.7028\]/);
    expect(run("confidence interval 0.99 mean 50 sd 10 n 30").title).toMatch(/^99%/);
  });
});

describe("B: precision and exactness labels", () => {
  it("the normal cdf is precise to ~1e-15, so the median quantile is 0 and the 7th digit is right", () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(Math.abs(normalQuantile(0.5000001) - 2.5066283e-7)).toBeLessThan(1e-13);
    expect(Math.abs(erfPrecise(1) - 0.8427007929497149)).toBeLessThan(1e-15);
    expect(Math.abs(normalCdfPrecise(1.96) - 0.9750021048517795)).toBeLessThan(1e-15);
    expect(Math.abs(normalCdfPrecise(-6) - 9.865876450376946e-10) / 9.865876450376946e-10).toBeLessThan(1e-9);
    expect(Math.abs(normalCdfPrecise(-4) - 3.167124183311986e-5) / 3.167124183311986e-5).toBeLessThan(1e-13);
  });
  it("singular pdfs (χ²(1), gamma k < 1, beta ½,½) cross-check by tanh-sinh and are answered", () => {
    expect(Math.abs(firstMath("chi-square 1 df P(X < 3.84)") - 0.9499565)).toBeLessThan(2e-6);
    expect(Math.abs(firstMath("gamma shape 0.5 rate 1 P(X < 1)") - 0.8427008)).toBeLessThan(2e-6);
    expect(firstMath("beta(0.5, 0.5) P(X < 0.5)")).toBeCloseTo(0.5, 9);
    expect(Math.abs(firstMath("chi-square 2 df P(X < 3.84)") - 0.853393)).toBeLessThan(2e-6);
    expect(Math.abs(tanhSinh((x) => 1 / Math.sqrt(x), 0, 1) - 2)).toBeLessThan(1e-12);
    expect(Math.abs(tanhSinh((x) => Math.pow(x, -0.9), 0, 1) - 10)).toBeLessThan(1e-12);
  });
  it("Markov vectors with long fractions are shown as ≈ decimals and SAID to be", () => {
    const v = run("markov [[0.9,0.1],[0.5,0.5]] after 200 steps");
    expect(v.lines.map((l) => l.text).join("\n")).toMatch(/after 200 steps from \(1, 0\): ≈ \(0\.833333, 0\.166667\)/);
    expect(v.caveats.join(" ")).toMatch(/too long to print/);
  });
  it("N(100, 15^2) reads the second argument as a variance; N(100, 15) says it read an sd", () => {
    expect(text("normal(100, 15^2) P(X > 120)")).toMatch(/z = \(120 − 100\)\/15/);
    expect(run("normal(100, 15) P(X > 120)").caveats.join(" ")).toMatch(/read as the SD/);
  });
});

describe("B: questions answered as asked", () => {
  it("two questions on one line are both answered", () => {
    const t = text("binomial n=10 p=0.4 P(X = 3) and P(X <= 3)");
    expect(t).toMatch(/P\(X = 3\) = 419904\/1953125/);
    expect(t).toMatch(/P\(X ≤ 3\) = 3733209\/9765625/);
  });
  it("CLT with a two-sided question", () => {
    expect(Math.abs(firstMath("clt n = 30 mean 50 sd 10 P(48 < xbar < 52)".replace("firstMath", "")) - 1.82574)).toBeLessThan(1e-4); // first math line is the standard error
    expect(text("clt n = 30 mean 50 sd 10 P(48 < xbar < 52)")).toMatch(/P\(48 < x̄ < 52\) ≈ 0\.726678/);
  });
  it("Markov questions outside the verb are refused by name; return time is answered", () => {
    expect(refusal("markov [[0.9,0.1],[0.5,0.5]] P(X_3 = S2 | X_0 = S1)")).toMatch(/Not answered here/);
    expect(refusal("markov [[0.9,0.1],[0.5,0.5]] mean first passage time from S1 to S2")).toMatch(/first-passage/);
    expect(text("markov [[0.9,0.1],[0.5,0.5]] expected return time to S1")).toMatch(/return time to S1 = 1\/π_1 = 6\/5/);
    expect(text("markov [[0.5,0.5],[0.2,0.8]] P^3")).toMatch(/after 3 steps/);
    expect(text("markov [[0.5,0.5],[0.2,0.8]] after three steps")).toMatch(/\(61\/200, 139\/200\)/);
  });
  it("documented syntaxes work: z p, rows on lines, two-sided critical value, (n=10,p=0.4), question-first, proportion CI", () => {
    expect(Math.abs(firstMath("z 0.975") - 1.95996)).toBeLessThan(1e-5);
    expect(text("markov\n0.9 0.1\n0.5 0.5\nstationary")).toMatch(/π = \(5\/6, 1\/6\)/);
    expect(text("markov\n0.9 0.1\n0.5 0.5\nstationary")).not.toMatch(/NO limit/);
    expect(Math.abs(firstMath("critical value t 12 two-sided alpha 0.05") - 2.17881)).toBeLessThan(1e-5);
    expect(run("binomial(n=10,p=0.4) P(X=3)").lines.find((l) => l.math)!.text).toBe("419904/1953125");
    expect(run("P(X = 3) for binomial n = 10, p = 0.4").lines.find((l) => l.math)!.text).toBe("419904/1953125");
    expect(text("confidence interval 95% proportion p = 0.4 n = 100")).toMatch(/\[0\.303982, 0\.496018\]/);
  });
  it("P(not A|B) is 1 − P(A|B), with readable event names in messages", () => {
    const t = text("P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(not A|B)");
    expect(t).toMatch(/P\(not A\|B\) = 1 − P\(A\|B\) = 11\/13/);
    expect(refusal("P(A)=0.3, P(B)=0.5, P(not A|B)")).not.toMatch(/!A/);
  });
});

describe("B: the guard does not steal", () => {
  it.each(["t 5", "t(1) = 5", "f(2) = 3", "E[X] = 3", "gamma(5)", "beta(2)", "P(x) = x^2 + 1", "draw y = x^2", "roll 2x + 3 = 7", "a box of mass 5 kg", "steady state concentration", "transition matrix of the basis change"])("%s → null", (q) => {
    expect(tryProbability(q)).toBeNull();
    expect(tryMarkov(q)).toBeNull();
  });
  it("odds of rolling a 6 = 1/6; a real prose problem outside the templates is still refused by name", () => {
    expect(run("odds of rolling a 6").lines.find((l) => l.math)!.text).toBe("1/6");
    expect(refusal("probability of drawing two aces from a deck")).toMatch(/outside the templates/);
  });
  it("the guard still claims what the verbs answer", () => {
    expect(PROB_VERB_RE.test("t 12 df P(T > 2.1)")).toBe(true);
    expect(PROB_VERB_RE.test("F(3, 20) P(X > 3)")).toBe(true);
    expect(PROB_VERB_RE.test("t = 5")).toBe(false);
  });
});

describe("C: cosmetics", () => {
  it("F mode rounded with ≈; pmf table never prints '= ≈'; discrete median exact; uniform mgf from 0; birthday with one person", () => {
    expect(text("F 3 20 mode")).toMatch(/mode = ≈ 0\.30303$/m);
    expect(text("pmf of poisson 2")).not.toMatch(/= ≈/);
    expect(text("binomial n=10 p=0.4 median")).toMatch(/median = 4 \(the smallest k/);
    expect(text("uniform(0,10) mgf")).toMatch(/\(exp\(10\*t\) - 1\)\/\(10\*t\)/);
    expect(refusal("birthday problem 1 people")).toMatch(/P = 0/);
    expect(run("exponential mean 2 P(X > 3)").caveats.join(" ")).not.toMatch(/Write "mean 2"/);
  });
});
