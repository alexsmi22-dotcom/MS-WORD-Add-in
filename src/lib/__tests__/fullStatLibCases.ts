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

/** One series (a Year column, then "S1"): `next(t, prev)` gives each value. */
function series(n: number, seed: number, next: (t: number, prev: number, r: ReturnType<typeof rng>) => number): string {
  const r = rng(seed);
  const rows: string[][] = [];
  let prev = 0;
  for (let t = 0; t < n; t++) {
    prev = next(t, prev, r);
    rows.push([String(1901 + t), f(prev)]);
  }
  return table(["Year", "S1"], rows);
}

/**
 * A synthetic-control wide table with J donors: the treated unit tracks the mean of donors 1–3 before 2011 (a small
 * wobble) and jumps by 10 from 2011; donors are independent random walks. Its gap relative to fit ranks first.
 */
function synthWide(J: number): string {
  const r = rng(100 + J);
  const lv = Array.from({ length: J }, () => 50 + 10 * r.u());
  const rows: string[][] = [];
  for (let t = 0; t < 30; t++) {
    for (let j = 0; j < J; j++) lv[j] += r.g();
    const year = 1991 + t;
    const treated = (lv[0] + lv[1] + lv[2]) / 3 + 0.05 * r.g() + (year >= 2011 ? 10 : 0);
    rows.push([String(year), f(treated), ...lv.map((v) => f(v))]);
  }
  return table(["Year", "Treated", ...Array.from({ length: J }, (_, j) => `D${j + 1}`)], rows);
}

/** A Phillips table whose change in inflation RISES with unemployment (the wrong slope). */
function phillipsUp(): string {
  const r = rng(61);
  const rows: string[][] = [];
  let pi = 3;
  for (let t = 0; t < 30; t++) {
    const u = 4 + 4 * r.u();
    pi += 0.6 * (u - 6) + 0.2 * r.g();
    rows.push([String(1990 + t), f(pi, 2), f(u, 2), f(pi, 2)]);
  }
  return table(["Year", "inflation", "unemployment", "expected"], rows);
}

/** A growth-accounting table in which output shrinks. */
function shrinking(): string {
  const rows: string[][] = [];
  for (let t = 0; t <= 8; t++) rows.push([String(2014 + t), f(1000 * Math.pow(0.98, t), 2), f(3000 * Math.pow(1.01, t), 2), f(500 * Math.pow(0.995, t), 2)]);
  return table(["Year", "Y", "K", "L"], rows);
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
  { id: "causal-rdd", label: "fuzzy", over: { design: "fuzzy" }, expect: /whose treatment the cutoff at score = 50 switches, the estimated effect on outcome is 5\.808/ },
  { id: "causal-rdd", label: "fuzzy, no jump", over: { design: "fuzzy", data: rdNoJump() }, expect: /no clear effect on outcome at score = 50/ },
  { id: "causal-synth", label: "rank 1, p floor", over: {}, expect: /largest of the 13 units.*cannot go below 0\.077/ },
  { id: "causal-synth", label: "placebos off", over: { placebo: "no" }, expect: /no placebo comparison/ },
  { id: "causal-synth", label: "early start", over: { start: "2000" }, expect: /ranks only 3 of 13 against placebo units \(permutation p = 0\.231\), so the gap could be chance/ },
  { id: "causal-pscore", label: "matching ATT", over: {}, expect: /among the treated is 2\.500 \(by matching, which gives no standard error.*well balanced after adjustment \(largest standardized difference 0\.082\)/ },
  { id: "causal-pscore", label: "IPW ATE", over: { method: "ipw", estimand: "ate" }, expect: /averaged over everyone is .*95% interval/ },
  { id: "causal-pscore", label: "matching without replacement: imbalance", over: { replace: "no" }, expect: /is 2\.624 .*The groups still differ after adjustment \(largest standardized difference 0\.143, above 0\.1\), so the estimate may be biased/ },
  { id: "causal-pscore", label: "IPW Horvitz–Thompson ATE: not significant", over: { method: "ipw", weights: "ht", estimand: "ate" }, expect: /is 1\.385 \(95% interval \[−0\.250; 3\.020\], p = 0\.097\), not clearly different from zero/ },
  { id: "causal-pscore", label: "one covariate", over: { covariates: "age" }, expect: /among the treated is 2\.803 .*well balanced after adjustment \(largest standardized difference 0\.000\)/ },
  // ---- GMM
  { id: "econ-gmm", label: "default", over: {}, expect: /estimated effect of a one-unit increase in educ on lwage is 0.0713.*no clear evidence against the instruments/ },
  { id: "econ-gmm", label: "invalid instrument", over: { data: ivTable(true, false), spec: "y ~", endog: "x", instruments: "z1 + z2 + z3" }, expect: /rejects the instruments/ },
  { id: "econ-gmm", label: "weak instruments", over: { data: ivTable(false, true), spec: "y ~", endog: "x", instruments: "z1 + z2 + z3" }, expect: /The instruments are weak for x \(first-stage F = 2\.15, below the rule-of-thumb 10\)/ },
  { id: "econ-gmm", label: "exactly identified", over: { instruments: "dist" }, expect: /exactly as many instruments/ },
  { id: "econ-gmm", label: "no endogenous regressor", over: { endog: "", instruments: "" }, expect: /goes with a change of/ },
  { id: "panel-dyn-gmm", label: "default", over: {}, expect: /carries over as about 0\.6580.*no evidence against the instruments/ },
  { id: "panel-dyn-gmm", label: "one-step", over: { steps: "one" }, expect: /carries over/ },
  { id: "panel-dyn-gmm", label: "static panel", over: { data: staticPanel(), timeDummies: "no" }, expect: /no clear carry-over from last period's sales \(coefficient 0\.1153, p = 0\.059\)/ },
  // ---- limited dependent
  { id: "econ-count", label: "Poisson, overdispersed", over: {}, expect: /goes with the expected rate of visits per unit of years about 1.0168 times as high.*vary more than a Poisson/ },
  { id: "econ-count", label: "NB2", over: { model: "nb2" }, expect: /negative binomial fits clearly better than the Poisson model \(LR test p < 0\.001\)/ },
  { id: "econ-count", label: "robust SEs", over: { se: "hc0" }, expect: /robust standard errors used here/ },
  { id: "econ-count", label: "no exposure", over: { exposure: "" }, expect: /the expected visits/ },
  { id: "econ-count", label: "noise", over: { data: noise(150, 3, (r) => String(Math.floor(r.u() * 4))), spec: "y ~ x1 + x2", exposure: "" }, expect: /No predictor is clearly linked to y/ },
  { id: "econ-tobit", label: "default", over: {}, expect: /educ, a clear predictor \(p < 0\.001\), goes with an expected hours about 0\.8802 higher on average, counting the 37 observations held at the lower limit 0/ },
  { id: "econ-tobit", label: "noise", over: { data: noise(150, 5, (r) => f(Math.max(0, r.g() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor is clearly linked to y.*held at the lower limit 0/ },
  { id: "econ-tobit", label: "upper limit only", over: { lower: "", upper: "20" }, expect: /counting the 4 observations held at the upper limit 20\. It goes with a chance that hours is below 20 about [\d.]+ lower/ },
  { id: "econ-tobit", label: "both limits", over: { lower: "0", upper: "20" }, expect: /37 observations held at the lower limit 0 and 4 at the upper limit 20.*between 0 and 20/ },
  { id: "econ-heckman", label: "default", over: {}, expect: /differ systematically.*educ goes with lwage about 0.0853 higher/ },
  { id: "econ-heckman", label: "no exclusion", over: { selection: "works ~ educ + exper" }, expect: /no clear evidence of selection bias \(selection term p = 0\.803\).*no outcome predictor is clearly linked.*functional form alone/ },
  { id: "econ-ordered", label: "default", over: {}, expect: /^Higher quality goes with rating in the higher categories \(coefficient 0\.9165, p < 0\.001\), other predictors held fixed\.$/ },
  { id: "econ-ordered", label: "noise", over: { data: noise(150, 9, (r) => String(1 + Math.floor(r.u() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor is clearly linked to y/ },
  { id: "econ-ordered", label: "price only", over: { spec: "rating ~ price" }, expect: /Higher price goes with rating in the lower categories \(coefficient −/ },
  { id: "econ-mlogit", label: "default", over: {}, expect: /income goes with a probability that mode = 2 about 0.0053 higher.*clearly help explain/ },
  { id: "econ-mlogit", label: "noise", over: { data: noise(200, 15, (r) => String(1 + Math.floor(r.u() * 3))), spec: "y ~ x1 + x2" }, expect: /No predictor is clearly linked to the probability.*do not clearly help/ },
  // ---- micro / macro
  { id: "micro-demand", label: "elastic", over: {}, expect: /elastic there \(ε = −1\.5000\), so a small price rise would lower revenue.*would charge 12\./ },
  { id: "micro-demand", label: "inelastic", over: { eps: "−0.5" }, expect: /inelastic there.*raise revenue/ },
  { id: "micro-demand", label: "unit elastic", over: { eps: "−1" }, expect: /unit elastic there.*leave revenue \(now 1,000\.0000\) unchanged/ },
  { id: "micro-demand", label: "semilog", over: { form: "semilog" }, expect: /would charge 14/ },
  { id: "micro-consumer", label: "price rise", over: {}, expect: /rise in the price of good 1 from 2 to 4 moves its purchases from 25\.0000 to 12\.5000.*41\.4214 more income/ },
  { id: "micro-consumer", label: "price fall", over: { p1new: "1" }, expect: /fall in the price.*could give up .* of income/ },
  { id: "micro-consumer", label: "no change", over: { p1new: "2" }, expect: /does not change/ },
  { id: "micro-consumer", label: "perfect substitutes tie", over: { util: "linear", a: "2", b: "1", p1: "2", p1new: "4", p2: "1" }, expect: /best bundle is not unique at one of the steps/ },
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
  { id: "macro-phillips", label: "expectations form", over: { form: "expect" }, expect: /no clear link between unemployment and inflation relative to expectations \(β = −0\.2230, p = 0\.082\), so the NAIRU estimate of 5\.640% is unreliable/ },
  { id: "macro-phillips", label: "default", over: {}, expect: /Higher unemployment goes with falling inflation \(β = −0\.3016, p = 0\.003\).*about 5\.523% unemployment/ },
  // ---- time series
  { id: "ts-garch", label: "GJR default", over: {}, expect: /persistent \(persistence 0\.8453\): a shock takes about 4\.12 periods to halve\. Bad news may raise/ },
  { id: "ts-garch", label: "GARCH", over: { model: "garch" }, expect: /forecast variance for the next period is/ },
  { id: "ts-var", label: "default", over: {}, expect: /Past values of Growth help predict Rate .*\(p = 0\.002\), and another link is also clear at the 5% level; the system is stable/ },
  { id: "ts-var", label: "white noise", over: { data: walks(120, 3, 31, true) }, expect: /No series helps predict another/ },
  { id: "ts-var-irf", label: "default", over: {}, expect: /only 43\.9% of the forecast uncertainty in Rate comes from its own shocks; Growth accounts for 35\.4%/ },
  { id: "ts-var-irf", label: "white noise", over: { data: walks(120, 3, 31, true) }, expect: /driven mainly by its own shocks/ },
  { id: "ts-engle-granger", label: "default", over: {}, expect: /finds evidence of cointegration at 5% \(τ = −6\.8215, below the critical value −3\.789\)/ },
  { id: "ts-engle-granger", label: "independent walks", over: { data: walks(150, 2, 41) }, expect: /finds no evidence of cointegration at 5%/ },
  { id: "ts-johansen", label: "default", over: {}, expect: /Both tests find 1 long-run relation at 5%/ },
  { id: "ts-johansen", label: "independent walks", over: { data: walks(150, 3, 43) }, expect: /^Both tests find no evidence of cointegration at 5%/ },
  { id: "ts-johansen", label: "stationary noise", over: { data: walks(150, 2, 47, true) }, expect: /^Both tests find full rank \(2\) at 5%/ },
  { id: "ts-acf", label: "default", over: {}, expect: /clearly related to their own past.*0\.572 at lag 1/ },
  { id: "ts-acf", label: "white noise", over: { data: walks(120, 1, 53, true), series: "S1" }, expect: /no clear autocorrelation in S1/ },
  { id: "ts-acf", label: "no p-value", over: { lags: "2", modelDf: "2" }, expect: /no Ljung–Box p-value/ },
  { id: "ts-unitroot", label: "default", over: {}, expect: /Output appears to have a unit root/ },
  { id: "ts-unitroot", label: "white noise", over: { data: walks(120, 1, 59, true), series: "S1" }, expect: /S1 appears stationary/ },
  { id: "ts-hp", label: "default", over: {}, expect: /λ = 1,600, Output swings around its smooth trend by 1\.394/ },
  // ---- branches reached by synthetic inputs
  { id: "causal-synth", label: "19 donors: rank 1 at p = 0.050", over: { data: synthWide(19), period: "Year", treated: "Treated", start: "2011" }, expect: /ranks 1 of 20 against placebo units \(permutation p = 0\.050\), right at the conventional 5% threshold, so the evidence is borderline/ },
  { id: "causal-synth", label: "24 donors: rank 1 at p = 0.040", over: { data: synthWide(24), period: "Year", treated: "Treated", start: "2011" }, expect: /ranks 1 of 25 against placebo units \(permutation p = 0\.040\), unlikely to be chance/ },
  { id: "macro-phillips", label: "upward slope", over: { data: phillipsUp() }, expect: /slopes up .* no meaningful NAIRU/ },
  { id: "macro-growth-accounting", label: "shrinking output", over: { data: shrinking() }, expect: /Output shrank/ },
  { id: "micro-price-disc", label: "market 2 never worth serving", over: { a2: "15" }, expect: /^Pricing each market on its own \(60; market 2 not served\) instead of one uniform price leaves profit at 1,600/ },
  { id: "ts-garch", label: "iid returns", over: { data: series(290, 71, (_t, _p, r) => r.g()), model: "garch", dist: "normal" }, expect: /returns of S1 do not move its volatility/ },
  { id: "ts-garch", label: "EGARCH", over: { model: "egarch" }, expect: /Volatility shocks in Return are/ },
  { id: "ts-unitroot", label: "noise with a level break: conflict", over: { data: series(120, 73, (t, _p, r) => r.g() + (t >= 60 ? 1 : 0)), series: "S1" }, expect: /The two tests conflict for S1: ADF rejects a unit root but KPSS also rejects stationarity \(ADF τ = −9\.210 against the 5% critical value −2\.886, KPSS p = 0\.014\)/ },
  { id: "ts-unitroot", label: "noise around a trend, constant only: conflict", over: { data: series(120, 73, (t, _p, r) => r.g() + 0.02 * t), series: "S1" }, expect: /The two tests conflict for S1/ },
  { id: "ts-unitroot", label: "short AR(1): inconclusive", over: { data: series(13, 81, (_t, p, r) => 0.8 * p + r.g()), series: "S1" }, expect: /Neither test rejects at 5% \(ADF τ = −2\.221 against the 5% critical value −3\.367, KPSS p = 0\.067\)/ },
  { id: "ts-unitroot", label: "short AR(1), 20 rows: inconclusive", over: { data: series(20, 85, (_t, p, r) => 0.7 * p + r.g()), series: "S1" }, expect: /Neither test rejects at 5%/ },
  { id: "panel-dyn-gmm", label: "instruments from lag 3", over: { lagFirst: "3", lagLast: "5" }, expect: /carries over as about 0\.7127 .*; the Hansen test finds no evidence against the instruments \(p = 0\.813\)\.$/ },
];
