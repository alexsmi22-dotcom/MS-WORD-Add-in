/**
 * Input sets for the "fully inclusive" Statistics-library readings (fullStatLib.test.ts): one or more per wording
 * branch of each calculator, each with the phrase its reading must carry. Synthetic data come from a fixed LCG, so
 * every case is reproducible.
 */

/** A 32-bit LCG (Numerical Recipes constants): uniform draws in [0, 1) and normal draws (12 uniforms − 6). */
export function rng(seed: number): { u: () => number; g: () => number } {
  let s = seed >>> 0;
  const u = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const g = (): number => {
    let t = 0;
    for (let i = 0; i < 12; i++) t += u();
    return t - 6;
  };
  return { u, g };
}

const f = (v: number, d = 3): string => v.toFixed(d);

/** A whitespace table: header, then rows. */
function table(head: string[], rows: (string | number)[][]): string {
  return [head.join(" "), ...rows.map((r) => r.join(" "))].join("\n");
}

/** n rows of a response unrelated to two predictors. */
function noise(n: number, seed: number, yOf: (r: ReturnType<typeof rng>) => string): string {
  const r = rng(seed);
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) rows.push([yOf(r), f(r.u() * 10), f(r.u() * 10)]);
  return table(["y", "x1", "x2"], rows);
}

/** Independent random walks (no cointegration, no Granger links when differenced noise is white). */
function walks(n: number, k: number, seed: number, stepOnly = false): string {
  const r = rng(seed);
  const lv = new Array<number>(k).fill(100);
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [String(1901 + i)];
    for (let j = 0; j < k; j++) {
      const e = r.g();
      lv[j] = stepOnly ? e : lv[j] + e;
      row.push(f(lv[j]));
    }
    rows.push(row);
  }
  return table(["Year", ...Array.from({ length: k }, (_, j) => `S${j + 1}`)], rows);
}

/** A sharp RD table with no jump at 50. */
function rdNoJump(): string {
  const r = rng(7);
  const rows: string[][] = [];
  for (let i = 0; i < 600; i++) {
    const x = r.u() * 100;
    rows.push([f(0.1 * x + r.g() * 2), f(x), x >= 50 ? "1" : "0"]);
  }
  return table(["outcome", "score", "treated"], rows);
}

/** A linear IV table: y = x + e; x = z1 + z2 + v; z3 is invalid when `bad` (it enters y). */
function ivTable(bad: boolean, weak: boolean): string {
  const r = rng(bad ? 11 : 13);
  const rows: string[][] = [];
  for (let i = 0; i < 400; i++) {
    const z1 = r.g();
    const z2 = r.g();
    const z3 = r.g();
    const v = r.g();
    const e = 0.5 * v + r.g();
    const x = (weak ? 0.02 : 1) * (z1 + z2 + z3) + v;
    const y = 1 + x + e + (bad ? 1.5 * z3 : 0);
    rows.push([f(y), f(x), f(z1), f(z2), f(z3)]);
  }
  return table(["y", "x", "z1", "z2", "z3"], rows);
}

/** A panel with no dynamics: sales is noise around a firm effect. */
function staticPanel(): string {
  const r = rng(21);
  const rows: string[][] = [];
  for (let i = 1; i <= 60; i++) {
    const eta = r.g();
    for (let t = 2012; t <= 2021; t++) rows.push([String(i), String(t), f(eta + r.g()), f(r.g())]);
  }
  return table(["firm", "year", "sales", "price"], rows);
}

export interface Case {
  id: string;
  label: string;
  over: Record<string, string>;
  /** The reading must match this (the branch's wording). */
  expect: RegExp;
}

export const CASES: Case[] = [
  // ---- causal
  { id: "causal-rdd", label: "sharp, jump", over: {}, expect: /estimated effect of 4\.756 .*unlikely to be chance/ },
  { id: "causal-rdd", label: "sharp, no jump", over: { data: rdNoJump() }, expect: /no clear jump/ },
  { id: "causal-rdd", label: "fuzzy", over: { design: "fuzzy" }, expect: /cutoff at score = 50 switches|no clear effect/ },
  { id: "causal-synth", label: "rank 1, p floor", over: {}, expect: /largest of the 13 units.*cannot go below 0\.077/ },
  { id: "causal-synth", label: "placebos off", over: { placebo: "no" }, expect: /no placebo comparison/ },
  { id: "causal-synth", label: "early start", over: { start: "2000" }, expect: /permutation p|largest of the/ },
  { id: "causal-pscore", label: "matching ATT", over: {}, expect: /among the treated is 2\.500 \(by matching, which gives no standard error.*well balanced after adjustment \(largest standardized difference 0\.082\)/ },
  { id: "causal-pscore", label: "IPW ATE", over: { method: "ipw", estimand: "ate" }, expect: /averaged over everyone is .*95% interval/ },
  { id: "causal-pscore", label: "one covariate, imbalance", over: { covariates: "age" }, expect: /balanced|still differ/ },
  // ---- GMM
  { id: "econ-gmm", label: "default", over: {}, expect: /estimated effect of a one-unit increase in educ on lwage is 0\.0713.*no evidence against the instruments/ },
  { id: "econ-gmm", label: "invalid instrument", over: { data: ivTable(true, false), spec: "y ~", endog: "x", instruments: "z1 + z2 + z3" }, expect: /rejects the instruments/ },
  { id: "econ-gmm", label: "weak instruments", over: { data: ivTable(false, true), spec: "y ~", endog: "x", instruments: "z1 + z2 + z3" }, expect: /barely predict x/ },
  { id: "econ-gmm", label: "exactly identified", over: { instruments: "dist" }, expect: /exactly as many instruments/ },
  { id: "econ-gmm", label: "no endogenous regressor", over: { endog: "", instruments: "" }, expect: /goes with a change of/ },
  { id: "panel-dyn-gmm", label: "default", over: {}, expect: /carries over as about 0\.6580.*no evidence against the instruments/ },
  { id: "panel-dyn-gmm", label: "one-step", over: { steps: "one" }, expect: /carries over/ },
  { id: "panel-dyn-gmm", label: "static panel", over: { data: staticPanel(), timeDummies: "no" }, expect: /no clear carry-over|carries over/ },
  // ---- limited dependent
  { id: "econ-count", label: "Poisson, overdispersed", over: {}, expect: /multiplies the expected rate of visits per unit of years by about 1\.0168.*vary more than a Poisson/ },
  { id: "econ-count", label: "NB2", over: { model: "nb2" }, expect: /negative binomial (fits|does not fit) clearly better/ },
  { id: "econ-count", label: "robust SEs", over: { se: "hc0" }, expect: /robust standard errors used here/ },
  { id: "econ-count", label: "no exposure", over: { exposure: "" }, expect: /the expected visits/ },
  { id: "econ-count", label: "noise", over: { data: noise(150, 3, (r) => String(Math.floor(r.u() * 4))), spec: "y ~ x1 + x2", exposure: "" }, expect: /No predictor is clearly linked to y/ },
  { id: "econ-tobit", label: "default", over: {}, expect: /educ, a clear predictor \(p < 0\.001\), raises the expected hours by about 0\.8802 on average, counting the 37 observations held at 0/ },
  { id: "econ-tobit", label: "noise", over: { data: noise(150, 5, (r) => f(Math.max(0, r.g() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor is clearly linked to y.*held at 0/ },
  { id: "econ-tobit", label: "upper limit only", over: { lower: "", upper: "20" }, expect: /counting the 4 observations held at 20\. It lowers the chance that hours is below 20/ },
  { id: "econ-tobit", label: "both limits", over: { lower: "0", upper: "20" }, expect: /37 observations held at 0 and 4 held at 20.*between 0 and 20/ },
  { id: "econ-heckman", label: "default", over: {}, expect: /differ systematically.*educ raises lwage by about 0\.0853/ },
  { id: "econ-heckman", label: "no exclusion", over: { selection: "works ~ educ + exper" }, expect: /functional form alone|selection term/ },
  { id: "econ-ordered", label: "default", over: {}, expect: /Higher quality shifts rating toward the higher categories.*2 of the 3 predictors/ },
  { id: "econ-ordered", label: "noise", over: { data: noise(150, 9, (r) => String(1 + Math.floor(r.u() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor is clearly linked to y/ },
  { id: "econ-ordered", label: "price only", over: { spec: "rating ~ price" }, expect: /Higher price shifts rating toward the lower categories \(coefficient −/ },
  { id: "econ-mlogit", label: "default", over: {}, expect: /income raises the probability that mode = 2 by about 0\.0053.*clearly help explain/ },
  { id: "econ-mlogit", label: "noise", over: { data: noise(200, 15, (r) => String(1 + Math.floor(r.u() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor clearly changes the probability.*do not clearly help/ },
  // ---- micro / macro
  { id: "micro-demand", label: "elastic", over: {}, expect: /elastic there \(ε = −1\.5000\), so a small price rise would lower revenue.*would charge 12\./ },
  { id: "micro-demand", label: "inelastic", over: { eps: "−0.5" }, expect: /inelastic there.*raise revenue/ },
  { id: "micro-demand", label: "unit elastic", over: { eps: "−1" }, expect: /unit elastic there.*leave revenue \(now 1,000\.0000\) unchanged/ },
  { id: "micro-demand", label: "semilog", over: { form: "semilog" }, expect: /would charge 14/ },
  { id: "micro-consumer", label: "price rise", over: {}, expect: /rise in the price of good 1 from 2 to 4 moves its purchases from 25\.0000 to 12\.5000.*41\.4214 more income/ },
  { id: "micro-consumer", label: "price fall", over: { p1new: "1" }, expect: /fall in the price.*could give up .* of income/ },
  { id: "micro-consumer", label: "no change", over: { p1new: "2" }, expect: /does not change/ },
  { id: "micro-consumer", label: "perfect substitutes tie", over: { util: "linear", a: "2", b: "1", p1: "2", p1new: "4", p2: "1" }, expect: /not unique|moves its purchases/ },
  { id: "micro-cost", label: "profit", over: {}, expect: /produce about 10\.2678 units and makes a profit of about 30\.4042.*below 8 .*above 47/ },
  { id: "micro-cost", label: "loss, produce", over: { price: "20" }, expect: /should still produce .* it loses .*less than its fixed cost of 300/ },
  { id: "micro-cost", label: "shut down", over: { price: "5" }, expect: /below the shutdown price, the firm should produce nothing and loses its fixed cost of 300/ },
  { id: "micro-cost", label: "no price", over: { price: "" }, expect: /^The firm should shut down at prices below 8 and covers all its costs only above 47\.$/ },
  { id: "micro-cost", label: "no fixed cost", over: { tc: "0, 12, −2, 0.25", price: "" }, expect: /below 8; with no fixed cost, any price above that covers all its costs/ },
  { id: "micro-cost", label: "linear", over: { tc: "100, 5", price: "4" }, expect: /no single break-even price/ },
  { id: "micro-price-disc", label: "default", over: {}, expect: /separate prices \(60 and 40\).*raises profit from 2,133\.3333 to 2,400 and lowers total surplus from 3,733\.3333 to 3,600/ },
  { id: "micro-price-disc", label: "identical markets", over: { a2: "100", b2: "1" }, expect: /leaves profit at .* leaves total surplus at/ },
  { id: "micro-auction", label: "no reserve", over: {}, expect: /4 bidders and no reserve, both .* raise 60\. A reserve price of 50 would raise the seller's expected payoff from 60 to 61\.25/ },
  { id: "micro-auction", label: "optimal reserve", over: { reserve: "50" }, expect: /and a reserve of 50.*No other reserve price would do better/ },
  { id: "macro-growth-accounting", label: "default", over: {}, expect: /Output grew 2\.43% a period on average/ },
  { id: "macro-mundell-fleming", label: "fiscal floating", over: {}, expect: /floating exchange rate, a change in government spending of 50 leaves output unchanged and lowers net exports by 50, as the currency appreciates/ },
  { id: "macro-mundell-fleming", label: "fiscal fixed", over: { regime: "fixed" }, expect: /fixed exchange rate, a change in government spending of 50 raises output by 142\.8571/ },
  { id: "macro-mundell-fleming", label: "monetary fixed", over: { regime: "fixed", shock: "monetary" }, expect: /undone as the central bank defends the peg/ },
  { id: "macro-mundell-fleming", label: "monetary floating", over: { shock: "monetary" }, expect: /money-supply change of 50 raises output by 100 and raises net exports by 25, as the currency depreciates/ },
  { id: "macro-mundell-fleming", label: "devaluation", over: { regime: "fixed", shock: "devaluation" }, expect: /devaluation of 0\.1 raises output by 57\.1429/ },
  { id: "macro-mundell-fleming", label: "no spending change", over: { dG: "" }, expect: /no spending change is entered; output stays at 1,600/ },
  { id: "macro-money-multiplier", label: "default", over: {}, expect: /supports 4 units of money.*money supply of 4,000; a change of 100 in the base changes it by 400\./ },
  { id: "macro-money-multiplier", label: "no change in base", over: { dB: "" }, expect: /money supply of 4,000\.$/ },
  { id: "macro-fiscal-multipliers", label: "default", over: {}, expect: /raises output by 2 units.*raises it by 1\.6.*raises output by 200 and changes the budget balance by −50/ },
  { id: "macro-fiscal-multipliers", label: "no policy", over: { dG: "0", dT: "0" }, expect: /held fixed\.$/ },
  { id: "macro-fiscal-multipliers", label: "MPC 0", over: { c: "0" }, expect: /a lump-sum tax cut leaves it unchanged/ },
  { id: "macro-fiscal-multipliers", label: "tax rise", over: { dG: "0", dT: "100" }, expect: /policy entered lowers output by 160/ },
  { id: "macro-phillips", label: "expectations form", over: { form: "expect" }, expect: /inflation relative to expectations|no clear link|slopes up/ },
  { id: "macro-phillips", label: "default", over: {}, expect: /Higher unemployment goes with falling inflation \(β = −0\.3016, p = 0\.003\).*about 5\.523% unemployment/ },
  // ---- time series
  { id: "ts-garch", label: "GJR default", over: {}, expect: /persistent \(persistence 0\.8453\): a shock takes about 4\.12 periods to halve\. Bad news may raise/ },
  { id: "ts-garch", label: "GARCH", over: { model: "garch" }, expect: /forecast variance for the next period is/ },
  { id: "ts-var", label: "default", over: {}, expect: /Past values of Growth help predict Rate .*\(p = 0\.002\), and 1 other link is also clear.*stable/ },
  { id: "ts-var", label: "white noise", over: { data: walks(120, 3, 31, true) }, expect: /No series helps predict another/ },
  { id: "ts-var-irf", label: "default", over: {}, expect: /only 43\.9% of the forecast uncertainty in Rate comes from its own shocks; Growth accounts for 35\.4%/ },
  { id: "ts-var-irf", label: "white noise", over: { data: walks(120, 3, 31, true) }, expect: /driven mainly by its own shocks/ },
  { id: "ts-engle-granger", label: "default", over: {}, expect: /finds evidence of cointegration at 5% \(τ = −6\.8215, below the critical value −3\.789\)/ },
  { id: "ts-engle-granger", label: "independent walks", over: { data: walks(150, 2, 41) }, expect: /finds no evidence of cointegration at 5%/ },
  { id: "ts-johansen", label: "default", over: {}, expect: /Both tests find 1 long-run relation at 5%/ },
  { id: "ts-johansen", label: "independent walks", over: { data: walks(150, 3, 43) }, expect: /no evidence of cointegration|disagree/ },
  { id: "ts-johansen", label: "stationary noise", over: { data: walks(150, 2, 47, true) }, expect: /full rank|disagree/ },
  { id: "ts-acf", label: "default", over: {}, expect: /clearly related to their own past.*0\.572 at lag 1/ },
  { id: "ts-acf", label: "white noise", over: { data: walks(120, 1, 53, true), series: "S1" }, expect: /no clear autocorrelation in S1/ },
  { id: "ts-acf", label: "no p-value", over: { lags: "2", modelDf: "2" }, expect: /no Ljung–Box p-value/ },
  { id: "ts-unitroot", label: "default", over: {}, expect: /Output appears to have a unit root/ },
  { id: "ts-unitroot", label: "white noise", over: { data: walks(120, 1, 59, true), series: "S1" }, expect: /S1 appears stationary/ },
  { id: "ts-hp", label: "default", over: {}, expect: /λ = 1,600, Output swings around its smooth trend by 1\.394/ },
];
