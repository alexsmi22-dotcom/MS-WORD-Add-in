/**
 * Routing, not engine: the pane must REACH the probability and Markov verbs
 * (taskpane.ts cannot be imported under jest, so the wiring is asserted on the
 * source text), and the guard must make the prose switches stand aside for
 * every input the verbs answer — the solver once took "poisson lambda = 2.5
 * P(X = 0)" and answered "lambda = 5/2".
 */
import * as fs from "fs";
import * as path from "path";
import { PROB_VERB_RE, tryProbability } from "../probability";
import { MARKOV_VERB_RE, tryMarkov } from "../markov";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("the pane reaches the probability verbs", () => {
  it("imports both verbs and both guards", () => {
    expect(PANE).toMatch(/import \{ tryProbability, PROB_VERB_RE \} from "\.\.\/lib\/probability";/);
    expect(PANE).toMatch(/import \{ tryMarkov, MARKOV_VERB_RE \} from "\.\.\/lib\/markov";/);
  });
  it("tries Markov and probability ahead of every older verb in the chain (only the v2.132.0 point-list verbs precede them)", () => {
    expect(PANE).toMatch(/const verb =\s*tryLp\(text\) \?\?\s*tryLpWords\(text\) \?\?\s*tryInterpolate\(text\) \?\?\s*trySpline\(text\) \?\?\s*tryMarkov\(text\) \?\?\s*tryProbability\(text\) \?\?\s*tryProbability\(taskText\) \?\?\s*tryMultivar\(text\)/);
  });
  it("the prose-switch guard stands aside for both", () => {
    expect(PANE).toMatch(/PROB_VERB_RE\.test\(text\)/);
    expect(PANE).toMatch(/MARKOV_VERB_RE\.test\(text\)/);
  });
  it("the pane renders a verb's own svg and passes shading to the plotter", () => {
    expect(PANE).toMatch(/else if \(verb\.svg\)/);
    expect(PANE).toMatch(/shadeBetween: verb\.plot\.shadeBetween/);
  });
});

describe("the guard claims everything the verbs answer", () => {
  const answered = [
    "binomial n=10 p=0.4 P(X <= 3)",
    "poisson lambda = 2.5 P(X = 0)",
    "geometric p = 0.2 P(X = 3)",
    "hypergeometric N=50 K=5 n=10 P(X=1)",
    "normal mean 100 sd 15 P(X < 85)",
    "P(-1.96 < Z < 1.96)",
    "z-score for 0.975",
    "quantile normal 0.95",
    "critical value chi-square 3 df alpha 0.05",
    "exponential lambda 0.5 mean",
    "gamma shape 2 rate 3 mean",
    "uniform on (0, 10) variance",
    "beta(2, 5) mode",
    "mean of binomial 20 0.3",
    "standard deviation of poisson 4",
    "expected value of a die",
    "variance of [1,2,3,4,5,6] equally likely",
    "E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5",
    "bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)",
    "P(A and B) = 0.2, P(B) = 0.5, P(A|B)",
    "probability of at least one six in four rolls",
    "birthday problem 23 people",
    "clt n = 30 mean 50 sd 10 P(xbar > 52)",
    "confidence interval 95% mean 50 sd 10 n 30",
    "a bag has 3 red and 5 blue; two drawn without replacement; P(both red)",
  ];
  it.each(answered)("%s", (q) => {
    expect(PROB_VERB_RE.test(q)).toBe(true);
    const v = tryProbability(q);
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
  });
  const markov = ["markov chain [[0.9, 0.1], [0.5, 0.5]] stationary distribution", "transition matrix [[0.5,0.5],[0.2,0.8]] after 3 steps from (1,0)", "absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps", "is the chain [[0,1],[1,0]] irreducible"];
  it.each(markov)("%s", (q) => {
    expect(MARKOV_VERB_RE.test(q)).toBe(true);
    expect(tryMarkov(q)!.lines.length).toBeGreaterThan(0);
  });
  const left = ["x^2 - 5x + 6 = 0", "mean of 3, 5, 8", "laplace t^2", "gradient x^2 y", "t = 5", "f(x) = x^2", "F = m a", "solve 2x + 3 = 7", "beta = 2", "gamma = 3", "uniform motion v = 3 m/s", "normal to the curve y = x^2 at x = 1"];
  it.each(left)("%s is left alone by the verbs", (q) => {
    expect(tryProbability(q)).toBeNull();
    expect(tryMarkov(q)).toBeNull();
  });
});
