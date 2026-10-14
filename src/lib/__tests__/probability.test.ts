/**
 * Probability and Markov chains — the acceptance audit from
 * docs/SCOPE-PROBABILITY-MARKOV.md §D. Every expected number there was
 * computed independently of the engine (own rationals, own quadrature).
 */
import { parseExpr } from "../solve";
import { tryProbability, PROB_VERB_RE } from "../probability";
import { tryMarkov } from "../markov";

const run = (q: string) => {
  const v = tryProbability(q) ?? tryMarkov(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = tryProbability(q) ?? tryMarkov(q);
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered, not refused: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
/** The first math line's value, evaluated. */
const value = (q: string): number => {
  const l = run(q).lines.find((x) => x.math);
  if (!l) throw new Error("no math line in\n" + text(q));
  const e = parseExpr(l.text);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { evalAst } = require("../solve");
  return evalAst(e, { pi: Math.PI, e: Math.E });
};
const close = (q: string, expected: number, rel = 2e-6) => {
  const v = value(q);
  expect(Math.abs(v - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));
};
const exact = (q: string, frac: string) => {
  expect(run(q).lines.find((x) => x.math)!.text).toBe(frac);
};

describe("discrete distributions", () => {
  it("binomial n=10 p=0.4 P(X = 3) = 419904/1953125", () => {
    exact("binomial n=10 p=0.4 P(X = 3)", "419904/1953125");
    expect(text("binomial n=10 p=0.4 P(X = 3)")).toMatch(/C\(10, 3\) = 120/);
    expect(text("binomial n=10 p=0.4 P(X = 3)")).toMatch(/120\*\(2\/5\)\^3\*\(3\/5\)\^7/);
  });
  it("binomial P(X <= 3), P(X >= 4), positional form", () => {
    exact("binomial n=10 p=0.4 P(X <= 3)", "3733209/9765625");
    exact("binomial n=10 p=0.4 P(X >= 4)", "6032416/9765625");
    exact("binomial(10, 0.4) P(X = 3)", "419904/1953125");
    exact("binomial n=10 p=0.4 P(X ≤ 3)", "3733209/9765625");
  });
  it("binomial n=20 p=0.3 mean and variance = 6, 21/5", () => {
    const t = text("binomial n=20 p=0.3 mean and variance");
    expect(t).toMatch(/mean E\[X\] = 6/);
    expect(t).toMatch(/variance Var\(X\) = 21\/5/);
  });
  it("pmf of binomial(5, 0.5) sums to exactly 1 and draws", () => {
    const v = run("pmf of binomial(5, 0.5)");
    expect(v.lines.map((l) => l.text).join("\n")).toMatch(/P\(X = 2\) = 5\/16/);
    expect(v.caveats.join(" ")).toMatch(/sum to exactly 1/);
    expect(v.svg).toMatch(/<svg/);
  });
  it("flip a fair coin 10 times, exactly 7 heads = 15/128", () => {
    exact("flip a fair coin 10 times, exactly 7 heads", "15/128");
  });
  it("poisson λ = 2.5: P(X = 0), P(X <= 2), P(X >= 3), sd of poisson 4", () => {
    close("poisson lambda = 2.5 P(X = 0)", 0.082085);
    expect(text("poisson λ = 2.5 P(X = 0)")).toMatch(/exp\(-5\/2\)/);
    close("poisson 2.5 P(X <= 2)", 0.543813);
    close("poisson 2.5 P(X >= 3)", 0.456187);
    close("lambda = 3 P(X >= 2)", 0.800852);
    expect(text("standard deviation of poisson 4")).toMatch(/sd σ = 2/);
  });
  it("geometric p = 0.2: expected value 5 (trials, said), P(X = 3) = 16/125; failures 64/625", () => {
    const v = run("geometric p = 0.2 expected value");
    expect(v.lines.map((l) => l.text).join(" ")).toMatch(/mean E\[X\] = 5/);
    expect(v.caveats.join(" ")).toMatch(/number of TRIALS/);
    exact("geometric p = 0.2 P(X = 3)", "16/125");
    exact("geometric p = 0.2 failures P(X = 3)", "64/625");
  });
  it("hypergeometric N=50 K=5 n=10: P(X=1) = 45695/105938, P(X=0) = 82251/264845", () => {
    exact("hypergeometric N=50 K=5 n=10 P(X=1)", "45695/105938");
    exact("hypergeometric N=50 K=5 n=10 P(X=0)", "82251/264845");
  });
  it("expected value of a fair die = 7/2; variance of 1..6 equally likely = 35/12 (not 3.5)", () => {
    expect(text("expected value of a fair die")).toMatch(/mean E\[X\] = 7\/2/);
    exact("variance of [1,2,3,4,5,6] equally likely", "35/12");
  });
  it("E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5 = 23/10; expected value 0.2*10 + 0.8*(-1) = 6/5", () => {
    exact("E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5", "23/10");
    exact("expected value 0.2*10 + 0.8*(-1)", "6/5");
    expect(refusal("E[X] for X = 1, 2 with p = 0.2, 0.3")).toMatch(/sum to 0\.5, not 1/);
  });
});

describe("continuous distributions", () => {
  it("normal(100, 15): P(X > 120), P(X < 85), P(85 < X < 115)", () => {
    close("normal(100, 15) P(X > 120)", 0.0912112);
    expect(text("normal(100, 15) P(X > 120)")).toMatch(/z = \(120 − 100\)\/15 = 1\.33333/);
    close("normal mean 100 sd 15 P(X < 85)", 0.158655);
    close("normal(100,15) P(85 < X < 115)", 0.682689);
    expect(run("normal(100, 15) P(X > 120)").plot?.shadeBetween).toBeTruthy();
  });
  it("standard normal: cdf at 1.96, P(-1.96 < Z < 1.96), z for 0.975, quantile 0.95", () => {
    close("cdf of normal at 1.96", 0.975002);
    close("P(-1.96 < Z < 1.96)", 0.950004);
    close("z-score for 0.975", 1.95996);
    close("quantile normal 0.95", 1.64485);
    close("invNorm(0.975)", 1.95996);
  });
  it("t 12 df P(T > 2.1) = 0.0287725; quantile t 12 0.975 = 2.17881", () => {
    close("t 12 df P(T > 2.1)", 0.0287725);
    close("quantile t 12 0.975", 2.17881);
  });
  it("chi-square 3 df: critical value 0.05 = 7.81473, P(X > 7.81) = 0.0501061", () => {
    close("critical value chi-square 3 df alpha 0.05", 7.81473);
    close("chi-square 3 df P(X > 7.81)", 0.0501061, 1e-5);
  });
  it("critical value F 3 20 alpha 0.05 = 3.09839", () => {
    close("critical value F 3 20 alpha 0.05", 3.09839);
  });
  it("exponential rate 0.5: P(X > 3) = e^(-3/2); mean 2, median ln(2)/(1/2)", () => {
    close("exponential rate 0.5 P(X > 3)", 0.22313);
    const t = text("exponential rate 0.5 mean and median");
    expect(t).toMatch(/mean E\[X\] = 2/);
    expect(t).toMatch(/median = ln\(2\)\/\(1\/2\)/);
  });
  it("uniform(0, 10) variance = 25/3 (not 50); gamma shape 2 rate 3 mean 2/3, P(X < 1) = 0.800852", () => {
    expect(text("uniform(0, 10) variance")).toMatch(/Var\(X\) = 25\/3/);
    expect(text("gamma shape 2 rate 3 mean")).toMatch(/E\[X\] = 2\/3/);
    close("gamma shape 2 rate 3 P(X < 1)", 0.800852);
  });
  it("beta(2, 5): mode 1/5 (mean 2/7, not 3.5), P(X < 0.3) = 0.579825", () => {
    expect(text("beta(2, 5) mode")).toMatch(/mode = 1\/5/);
    expect(text("beta(2, 5) mean")).toMatch(/E\[X\] = 2\/7/);
    close("beta(2, 5) P(X < 0.3)", 0.579825);
  });
  it("mgf of exponential rate 2 = 2/(2 - t), t < 2", () => {
    const t = text("mgf of exponential rate 2");
    expect(t).toMatch(/2\/\(2 - t\), for t < 2/);
  });
  it("refusals by name: P(X = 120) for a continuous X; p = 1.2", () => {
    expect(refusal("normal(100,15) P(X = 120)")).toMatch(/is 0 for a continuous distribution/);
    expect(refusal("binomial n=10 p=1.2 P(X=3)")).toMatch(/p must be a probability/);
  });
});

describe("Bayes and prose", () => {
  it("bayes P(A)=0.01, P(B|A)=0.9, P(B|¬A)=0.05 → P(A|B) = 2/13, P(B) = 117/2000", () => {
    const t = text("bayes P(A)=0.01, P(B|A)=0.9, P(B|¬A)=0.05, P(A|B)");
    expect(t).toMatch(/P\(B\) = .* = 117\/2000/);
    exact("bayes P(A)=0.01, P(B|A)=0.9, P(B|¬A)=0.05, P(A|B)", "2/13");
    expect(run("bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)").svg).toMatch(/<svg/);
  });
  it("P(A and B) = 0.2, P(B) = 0.5, P(A|B) = 2/5; P(A), P(B) alone is refused (independence never assumed)", () => {
    exact("P(A and B) = 0.2, P(B) = 0.5, P(A|B)", "2/5");
    expect(refusal("P(A) = 0.3, P(B) = 0.5, P(A|B)")).toMatch(/Independence is never assumed/);
  });
  it("at least one six in four rolls = 671/1296; two dice sum 7 = 1/6; bag 3 red 5 blue both red = 3/28; birthday 23 = 0.507297", () => {
    expect(text("probability of at least one six in four rolls")).toMatch(/= 671\/1296/);
    exact("roll two dice, probability the sum is 7", "1/6");
    exact("a bag has 3 red and 5 blue; two drawn without replacement; P(both red)", "3/28");
    close("birthday problem 23 people", 0.507297);
  });
  it("a prose problem outside the templates is refused by name", () => {
    expect(refusal("probability of drawing two aces from a deck")).toMatch(/outside the templates/);
  });
});

describe("CLT, confidence intervals, normal approximation", () => {
  it("clt n = 30 mean 50 sd 10 P(xbar > 52): z = 1.09545, P = 0.136661", () => {
    const t = text("clt n = 30 mean 50 sd 10 P(xbar > 52)");
    expect(t).toMatch(/z = .* = 1\.09545/);
    expect(run("clt n = 30 mean 50 sd 10 P(xbar > 52)").lines.some((l) => l.math && l.text === "0.136661")).toBe(true);
  });
  it("confidence interval 95% mean 50 sd 10 n 30: both intervals, the choice stated", () => {
    const v = run("confidence interval 95% mean 50 sd 10 n 30");
    const t = v.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/\[46\.4216, 53\.5784\]/);
    expect(t).toMatch(/\[46\.2659, 53\.7341\]/);
    expect(v.caveats.join(" ")).toMatch(/wording did not say, so both are shown/);
  });
  it("normal approximation binomial n=100 p=0.3 P(X <= 25) states the correction and the exact value", () => {
    const t = text("normal approximation binomial n=100 p=0.3 P(X <= 25)");
    expect(t).toMatch(/P\(Y < 25\.5\)/);
    expect(t).toMatch(/exact binomial P\(X ≤ 25\) ≈ 0\.16313/);
  });
});

describe("Markov chains", () => {
  it("[[0.9, 0.1], [0.5, 0.5]] stationary (5/6, 1/6), irreducible, aperiodic, limit exists", () => {
    const t = text("markov chain [[0.9, 0.1], [0.5, 0.1+0.4]] stationary distribution".replace("0.1+0.4", "0.5"));
    expect(t).toMatch(/π = \(5\/6, 1\/6\)/);
    expect(t).toMatch(/Irreducible .* period 1 — aperiodic/);
    expect(t).toMatch(/LIMIT distribution/);
    expect(run("markov chain [[0.9, 0.1], [0.5, 0.5]] stationary distribution").svg).toMatch(/<svg/);
  });
  it("[[0.5,0.5],[0.2,0.8]] after 3 steps from (1,0) = (61/200, 139/200)", () => {
    expect(text("transition matrix [[0.5,0.5],[0.2,0.8]] after 3 steps from (1,0)")).toMatch(/\(61\/200, 139\/200\)/);
  });
  it("3-state stationary (8/35, 13/35, 2/5)", () => {
    expect(text("markov [[0.5,0.3,0.2],[0.2,0.6,0.2],[0.1,0.2,0.7]] stationary")).toMatch(/π = \(8\/35, 13\/35, 2\/5\)/);
  });
  it("[[0,1],[1,0]]: irreducible, period 2, stationary (1/2, 1/2), NO limit", () => {
    const t = text("is the chain [[0,1],[1,0]] irreducible");
    expect(t).toMatch(/period 2/);
    expect(t).toMatch(/π = \(1\/2, 1\/2\)/);
    expect(t).toMatch(/NO limit distribution/);
  });
  it("absorbing [[1,0,0],[0.3,0.4,0.3],[0,0,1]]: 5/3 steps, 1/2 each", () => {
    const t = text("absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps");
    expect(t).toMatch(/N = \(I − Q\)⁻¹ = \[\[5\/3\]\]/);
    expect(t).toMatch(/from S2: 5\/3/);
    expect(t).toMatch(/S1 with probability 1\/2 .*S3 with probability 1\/2/);
  });
  it("gambler's ruin: steps 2, 2; absorption at S4 with 1/3, 2/3", () => {
    const t = text("markov [[1,0,0,0],[0.5,0,0.5,0],[0,0.5,0,0.5],[0,0,0,1]] absorbing");
    expect(t).toMatch(/from S2: 2\n/);
    expect(t).toMatch(/From S2: absorbed in S1 with probability 2\/3 .* S4 with probability 1\/3/);
  });
  it("a row summing to 11/10 is refused with the sum; the identity has no single stationary distribution", () => {
    expect(refusal("markov [[0.6, 0.5], [0.5, 0.5]]")).toMatch(/Row 1 sums to 11\/10, not 1/);
    expect(text("markov [[1,0],[0,1]] stationary")).toMatch(/no single stationary distribution/);
  });
  it("named states and a transient class", () => {
    expect(text("markov chain states A, B [[1/3, 2/3], [1/2, 1/2]] stationary")).toMatch(/π = \(3\/7, 4\/7\)/);
    expect(text("markov [[0.5, 0.5, 0], [0.5, 0.5, 0], [0.2, 0.3, 0.5]] stationary")).toMatch(/π = \(1\/2, 1\/2, 0\)/);
  });
});

describe("routing and the display contract", () => {
  it("ordinary inputs are not probability verbs", () => {
    for (const q of ["x^2 - 5x + 6 = 0", "mean of 3, 5, 8", "laplace t^2", "gradient x^2 y", "t = 5", "f(x) = x^2", "F = m a"]) {
      expect(tryProbability(q)).toBeNull();
      expect(tryMarkov(q)).toBeNull();
    }
    expect(PROB_VERB_RE.test("x^2 - 5x + 6 = 0")).toBe(false);
    expect(PROB_VERB_RE.test("mean of 3, 5, 8")).toBe(false);
  });
  it("every math line re-parses", () => {
    const qs = [
      "binomial n=10 p=0.4 P(X = 3)",
      "poisson lambda = 2.5 P(X = 0)",
      "normal(100, 15) P(X > 120)",
      "exponential rate 0.5 mean and median",
      "mgf of exponential rate 2",
      "confidence interval 95% mean 50 sd 10 n 30",
      "clt n = 30 mean 50 sd 10 P(xbar > 52)",
      "bayes P(A)=0.01, P(B|A)=0.9, P(B|¬A)=0.05, P(A|B)",
      "markov [[0.5,0.3,0.2],[0.2,0.6,0.2],[0.1,0.2,0.7]] stationary",
      "absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps",
      "variance of [1,2,3,4,5,6] equally likely",
      "probability of at least one six in four rolls",
    ];
    for (const q of qs) for (const l of run(q).lines.filter((x) => x.math)) expect(() => parseExpr(l.text)).not.toThrow();
  });
});
