/**
 * Confidence interval for ONE proportion (v2.136.0, scope §A finding 4, §B5,
 * §D "Proportion CI").
 *
 * Before: Wald only; `p = 0.02, n = 50` was silently clamped at 0 while the
 * printed formula evaluated to −0.0188; `p = 0, n = 20` gave a zero-width
 * "95%" interval [0, 0]; "12 successes out of 40" and "x = 12 n = 40" were
 * refused ("Give the sample proportion and n").
 *
 * Oracles: §D table (statsmodels 0.15.0 proportion_confint, SciPy beta,
 * agreeing to 6 dp), and an INDEPENDENT route written here — Wilson from its
 * closed form with z constants typed from tables, Clopper–Pearson by
 * bisection on a binomial CDF built from the pmf RECURRENCE (not the
 * module's beta quantile, not its log-space tail sum).
 */
import { tryProbability, PROB_VERB_RE } from "../probability";
import { tryMarkov, MARKOV_VERB_RE } from "../markov";
import { foldPastedMath } from "../pasteMath";
import { algebraKindFor } from "../algebraSwitch";
import { tryLp, isLpInput } from "../lp";
import { tryLpWords, LP_WORDS_RE } from "../lpWords";
import { tryInterpolate } from "../interpolate";
import { trySpline } from "../spline";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 4000) throw new Error(`took ${dt} ms`);
  return r;
};
const run = (q: string) => {
  const v = timed(() => tryProbability(q));
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = timed(() => tryProbability(q));
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const parseIv = (s: string): [number, number] => {
  const m = /\[(−?[-\d.e]+), (−?[-\d.e]+)\]/.exec(s)!;
  return [Number(m[1].replace("−", "-")), Number(m[2].replace("−", "-"))];
};
const ivOf = (q: string, which: RegExp): [number, number] => {
  const l = run(q).lines.find((x) => which.test(x.text));
  if (!l) throw new Error(`no ${which} line in: ${text(q)}`);
  return parseIv(l.text.slice(l.text.search(which)));
};
const WILSON = /Wilson score interval/;
const CP = /Clopper–Pearson exact interval/;
const WALD = /Textbook \(Wald\)/;
/** 6-significant-digit display: within 5e-7 absolute or 5e-6 relative. */
const near = (got: number, want: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.max(6e-7, 5e-6 * Math.abs(want)));
};

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------
const Z: Record<string, number> = {
  "0.75": 0.6744897501960817, // level 0.5 two-sided
  "0.95": 1.6448536269514722, // 90% two-sided, 95% one-sided
  "0.975": 1.959963984540054,
  "0.995": 2.5758293035489004,
  "0.9995": 3.2905267314918945, // 99.9% two-sided
};
function wilsonOracle(x: number, n: number, z: number): [number, number] {
  const p = x / n;
  const a = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / a;
  const h = (z / a) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [x === 0 ? 0 : c - h, x === n ? 1 : c + h];
}
/** Binomial CDF P(X ≤ x) by the pmf recurrence pmf(k+1) = pmf(k)·(n−k)/(k+1)·p/(1−p). */
function binomCdf(x: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  // start from the log of pmf(0) to avoid underflow, accumulate in log-sum-exp
  let logPmf = n * Math.log(1 - p);
  let maxL = logPmf;
  const logs = [logPmf];
  for (let k = 0; k < x; k++) {
    logPmf += Math.log((n - k) / (k + 1)) + Math.log(p / (1 - p));
    logs.push(logPmf);
    if (logPmf > maxL) maxL = logPmf;
  }
  return Math.min(1, Math.exp(maxL) * logs.reduce((s, l) => s + Math.exp(l - maxL), 0));
}
function cpOracle(x: number, n: number, tail: number): [number, number] {
  const bis = (f: (p: number) => boolean): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 64; i++) {
      const m = (lo + hi) / 2;
      if (f(m)) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  // lower: P(X ≥ x | p) = tail, i.e. 1 − cdf(x − 1) = tail (increasing in p)
  const lo = x === 0 ? 0 : bis((p) => 1 - binomCdf(x - 1, n, p) < tail);
  // upper: P(X ≤ x | p) = tail (decreasing in p)
  const hi = x === n ? 1 : bis((p) => binomCdf(x, n, p) > tail);
  return [lo, hi];
}

describe("§D table (statsmodels / SciPy, 6 dp)", () => {
  const rows: [string, [number, number], [number, number], [number, number] | null][] = [
    ["confidence interval 95% proportion p = 0.4 n = 100", [0.309401, 0.497997], [0.303295, 0.502791], [0.303982, 0.496018]],
    ["95% confidence interval for 1 of 50", [0.003539, 0.104954], [0.000506, 0.10647], [-0.018805, 0.058805]],
    ["confidence interval 95% proportion p = 0.02 n = 50", [0.003539, 0.104954], [0.000506, 0.10647], [-0.018805, 0.058805]],
    ["confidence interval 95% proportion p = 0 n = 20", [0, 0.161125], [0, 0.168433], null],
    ["95% confidence interval for 20 of 20", [0.838875, 1], [0.831567, 1], null],
    ["95% confidence interval for a proportion with 12 successes out of 40", [0.180748, 0.4543], [0.165627, 0.465316], [0.157987, 0.442013]],
    ["95% confidence interval for a proportion x = 12 n = 40", [0.180748, 0.4543], [0.165627, 0.465316], [0.157987, 0.442013]],
    ["confidence interval 12/40", [0.180748, 0.4543], [0.165627, 0.465316], [0.157987, 0.442013]],
    ["99% confidence interval for 12 of 40", [0.153277, 0.503632], [0.134357, 0.514308], [0.113363, 0.486637]],
    ["90% confidence interval for 7 of 30", [0.13176, 0.379026], [0.114987, 0.393947], [0.106317, 0.360349]],
    ["95% confidence interval for 3 of 10", [0.107791, 0.603222], [0.06674, 0.652453], [0.015974, 0.584026]],
  ];
  it.each(rows)("%s", (q, w, c, d) => {
    const [wl, wh] = ivOf(q, WILSON);
    near(wl, w[0]);
    near(wh, w[1]);
    const [cl, ch] = ivOf(q, CP);
    near(cl, c[0]);
    near(ch, c[1]);
    const wald = run(q).lines.find((l) => WALD.test(l.text))!.text;
    if (d) {
      const [dl, dh] = parseIv(wald.slice(wald.indexOf("=")));
      near(dl, d[0]);
      near(dh, d[1]);
    } else expect(wald).toMatch(/zero width: the Wald interval fails here/);
  });
  it("Wilson LEADS, Clopper–Pearson next, Wald last", () => {
    const ls = run("95% confidence interval for 12 of 40").lines.map((l) => l.text);
    const iw = ls.findIndex((l) => WILSON.test(l));
    const ic = ls.findIndex((l) => CP.test(l));
    const id = ls.findIndex((l) => WALD.test(l));
    expect(iw).toBeGreaterThan(0);
    expect(ic).toBeGreaterThan(iw);
    expect(id).toBeGreaterThan(ic);
  });
  it("the v2.131 Wald pin survives: p = 0.4 n = 100 → [0.303982, 0.496018]", () => {
    expect(text("confidence interval 95% proportion p = 0.4 n = 100")).toMatch(/\[0\.303982, 0\.496018\]/);
  });
});

describe("truncation is SAID, never silent (§A finding 4)", () => {
  it("p = 0.02, n = 50: [−0.0188053, 0.0588053] runs below 0, reported as [0, 0.0588053]", () => {
    const w = run("confidence interval 95% proportion p = 0.02 n = 50").lines.find((l) => WALD.test(l.text))!.text;
    expect(w).toMatch(/\[−0\.0188053, 0\.0588053\] — runs below 0; reported as \[0, 0\.0588053\]/);
  });
  it("no math line evaluates to a negative bound (the old formula line did)", () => {
    const ms = run("confidence interval 95% proportion p = 0.02 n = 50").lines.filter((l) => l.math).map((l) => Number(l.text));
    expect(ms.length).toBe(4);
    ms.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });
  it("p = 0, n = 20: no zero-width 95% interval presented as the answer", () => {
    const t = text("confidence interval 95% proportion p = 0 n = 20");
    expect(t).toMatch(/Wilson score interval \(recommended\): \[0, 0\.161125\]/);
    expect(t).toMatch(/zero width: the Wald interval fails here/);
  });
  it("Wald's failure is named when np̂ < 10", () => {
    expect(run("95% confidence interval for 3 of 10").caveats.join(" ")).toMatch(/np̂ < 10, so the Wald interval is unreliable/);
  });
});

describe("adversarial: against the independent oracle", () => {
  const cases: [number, number, string, number, number][] = [];
  // [x, n, level text, z, tail]
  for (const [x, n] of [
    [0, 1],
    [1, 1],
    [0, 7],
    [7, 7],
    [1, 2],
    [5, 13],
    [0, 500],
    [500, 500],
    [1, 1000],
    [999, 1000],
    [317, 1000],
  ]) {
    cases.push([x, n, "95%", Z["0.975"], 0.025]);
    cases.push([x, n, "50%", Z["0.75"], 0.25]);
    cases.push([x, n, "99.9%", Z["0.9995"], 0.0005]);
  }
  it.each(cases)("x = %d, n = %d at %s", (x, n, lv, z, tail) => {
    const q = `${lv} confidence interval for x = ${x}, n = ${n}`;
    const [wl, wh] = ivOf(q, WILSON);
    const [ow, oh] = wilsonOracle(x, n, z);
    near(wl, ow);
    near(wh, oh);
    const [cl, ch] = ivOf(q, CP);
    const [ocl, och] = cpOracle(x, n, tail);
    near(cl, ocl);
    near(ch, och);
    // CP contains Wilson's centre region at the ends; both within [0, 1]
    [wl, wh, cl, ch].forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
  it("x = 0: CP upper = 1 − (α/2)^(1/n) in closed form", () => {
    const [, ch] = ivOf("95% confidence interval for 0 of 20", CP);
    near(ch, 1 - Math.pow(0.025, 1 / 20));
  });
  it("n = 10 000 still cross-checked (both routes agree) inside 4 s", () => {
    const v = run("95% confidence interval for 4321 of 10000");
    expect(v.caveats.join(" ")).toMatch(/agree to 1e-9/);
    const [cl, ch] = ivOf("95% confidence interval for 4321 of 10000", CP);
    const [ocl, och] = cpOracle(4321, 10000, 0.025);
    near(cl, ocl);
    near(ch, och);
  });
  it("n above 10⁷: Clopper–Pearson omitted BY NAME (beta route unverified there); Wilson still shown", () => {
    const t = text("95% confidence interval for 123456789 of 1000000000");
    expect(t).toMatch(/Clopper–Pearson not shown: n = 1000000000 is above 10⁷/);
    const [wl, wh] = ivOf("95% confidence interval for 123456789 of 1000000000", WILSON);
    const [ow, oh] = wilsonOracle(123456789, 1000000000, Z["0.975"]);
    near(wl, ow);
    near(wh, oh);
  });
  it("n above the binomial cap: the beta route stands alone, SAID", () => {
    const v = run("95% confidence interval for 40000 of 100000");
    expect(v.caveats.join(" ")).toMatch(/beta-quantile route stands alone/);
    // the lone route is still right (the test's own oracle runs the binomial CDF at n = 100 000)
    const [cl, ch] = ivOf("95% confidence interval for 40000 of 100000", CP);
    const [ocl, och] = cpOracle(40000, 100000, 0.025);
    near(cl, ocl);
    near(ch, och);
  });
});

describe("one-sided, levels, forms", () => {
  it("upper confidence bound: Wilson upper = z²/(n + z²) at x = 0 with z = z₀.₉₅", () => {
    const z = Z["0.95"];
    const t = text("95% upper confidence bound for 0 of 20");
    expect(t).toMatch(/one-sided upper bound/);
    const [lo, hi] = ivOf("95% upper confidence bound for 0 of 20", WILSON);
    expect(lo).toBe(0);
    near(hi, (z * z) / (20 + z * z));
    const [, ch] = ivOf("95% upper confidence bound for 0 of 20", CP);
    near(ch, 1 - Math.pow(0.05, 1 / 20)); // 1 − α^(1/n)
  });
  it("lower bound: [L, 1]", () => {
    const [lo, hi] = ivOf("95% lower confidence bound for 12 of 40", WILSON);
    expect(hi).toBe(1);
    near(lo, wilsonOracle(12, 40, Z["0.95"])[0]);
  });
  it("one-sided without a direction gives both bounds and says they are not an interval together", () => {
    expect(run("one-sided 95% confidence interval for 12 of 40").caveats.join(" ")).toMatch(/NOT a 95% interval/);
  });
  it("level forms: 0.99, 'at 90%', 'level 0.9', alpha = 0.05", () => {
    expect(run("confidence interval 0.99 proportion 12 of 40").title).toMatch(/^99%/);
    expect(run("confidence interval at 90% for 7 of 30").title).toMatch(/^90%/);
    expect(run("confidence interval for 7 of 30 level 0.9").title).toMatch(/^90%/);
    expect(run("confidence interval for 12 of 40 alpha = 0.05").title).toMatch(/^95%/);
    expect(run("confidence interval for 12 of 40").title).toMatch(/^95%/); // default
  });
  it("review: the level is read ANYWHERE on the line (statsmodels alpha = 0.2: Wilson [0.039929, 0.133363], CP [0.032697, 0.142604])", () => {
    for (const q of ["clopper pearson 80% 4/54", "clopper pearson 80% 4 of 54", "80% clopper pearson 4/54", "clopper pearson interval 80% 4 out of 54", "4 of 54, wilson interval 80%"]) {
      expect(run(q).title).toMatch(/^80%/);
      const [wl, wh] = ivOf(q, WILSON);
      near(wl, 0.039929);
      near(wh, 0.133363);
      const [cl, ch] = ivOf(q, CP);
      near(cl, 0.032697);
      near(ch, 0.142604);
    }
  });
  it("review: two different levels are refused by name", () => {
    expect(refusal("95% clopper pearson 80% 4/54")).toMatch(/Two different confidence levels were given: 95% and 80%/);
  });
  it("review: the level prints as typed — 99.9999999% never becomes 100%", () => {
    const v = run("99.9999999% confidence interval for 12 of 40");
    expect(v.title).toMatch(/^99\.9999999% /);
    expect(v.lines[0].text).toMatch(/99\.9999999% two-sided/);
  });
  it("a percent proportion is not read as the level", () => {
    const v = run("confidence interval proportion p = 30% n = 40");
    expect(v.title).toMatch(/^95%/);
    near(ivOf("confidence interval proportion p = 30% n = 40", WILSON)[0], 0.180748);
  });
  it("count forms: k = 12, n = 40; 12 out of 40; p̂ = 0.3 n = 40; p-hat", () => {
    for (const q of ["confidence interval k = 12, n = 40", "95% confidence interval 12 out of 40", "confidence interval p̂ = 0.3 n = 40", "confidence interval phat = 0.3, n = 40", "confidence interval proportion 0.3 in 40 trials"]) {
      near(ivOf(q, WILSON)[0], 0.180748);
      near(ivOf(q, CP)[0], 0.165627);
    }
  });
  it("named methods: wilson / clopper pearson / exact binomial lead with their own", () => {
    near(ivOf("wilson interval 12 of 40", WILSON)[0], 0.180748);
    const ls = run("clopper pearson 12 of 40").lines.map((l) => l.text);
    expect(ls.findIndex((l) => CP.test(l))).toBeLessThan(ls.findIndex((l) => WILSON.test(l)));
    near(ivOf("exact binomial confidence interval 12 of 40", CP)[1], 0.465316);
  });
  it("a figure: three interval bars with p̂ marked", () => {
    const v = run("95% confidence interval for 12 of 40");
    expect(v.svg).toMatch(/<svg/);
    expect(v.svg).toMatch(/p̂ = 0\.3/);
    expect((v.svg!.match(/<rect /g) ?? []).length).toBe(4); // background + 3 bars
  });
  it("p̂ with a non-integer count: Wilson and Wald shown, Clopper–Pearson omitted BY NAME", () => {
    const t = text("confidence interval proportion p = 0.333 n = 10");
    expect(t).toMatch(/Wilson score interval/);
    expect(t).toMatch(/Clopper–Pearson needs a whole number of successes: n·p̂ = 3\.33 is not one/);
  });
});

describe("refusals by name", () => {
  it("n = 0", () => expect(refusal("confidence interval for 0 of 0")).toMatch(/n = 0: there are no trials/));
  it("x > n", () => expect(refusal("confidence interval x = 12, n = 10")).toMatch(/x = 12 successes is more than n = 10 trials/));
  it("non-integer count", () => expect(refusal("confidence interval x = 12.5, n = 40")).toMatch(/x = 12\.5 is not a whole number of successes/));
  it("non-integer n", () => expect(refusal("confidence interval proportion p = 0.3 n = 40.5")).toMatch(/n = 40\.5 is not a whole number of trials/));
  it("count and proportion disagree", () => expect(refusal("confidence interval x = 12, n = 40, p = 0.4")).toMatch(/disagree: 12\/40 = 3\/10 ≈ 0\.3, but p̂ = 0\.4/));
  it("Jeffreys and Agresti–Coull point to Wilson", () => {
    expect(refusal("jeffreys interval 12 of 40")).toMatch(/Jeffreys interval is not computed here.*Wilson/);
    expect(refusal("agresti-coull interval 12 of 40")).toMatch(/Agresti–Coull interval is not computed here/);
  });
  it("a proportion outside [0, 1]", () => expect(refusal("confidence interval proportion p = 1.4 n = 40")).toMatch(/must be in \[0, 1\]/));
});

describe("routing: the guard claims the new openers, and only them", () => {
  const claimed = [
    "95% confidence interval for a proportion with 12 successes out of 40",
    "95% confidence interval for 1 of 50",
    "99% confidence interval for 12 of 40",
    "wilson interval 12 of 40",
    "wilson score interval for 12 of 40",
    "clopper pearson 12 of 40",
    "clopper-pearson interval x = 12 n = 40",
    "exact binomial confidence interval 12 of 40",
    "one-sided 95% confidence interval for 12 of 40",
    "95% upper confidence bound for 0 of 20",
    "upper 95% confidence bound for 0 of 20",
    "confidence interval 12/40",
  ];
  it.each(claimed)("%s", (q) => {
    expect(PROB_VERB_RE.test(q)).toBe(true);
    expect(tryProbability(q)!.lines.length).toBeGreaterThan(0);
  });
  const left = ["12 out of 40 is what percent", "12 of 40 students passed; what percent failed", "wilson = 3", "x = 12, n = 40", "12/40", "exact = 5"];
  it.each(left)("%s is not claimed", (q) => {
    expect(PROB_VERB_RE.test(q)).toBe(false);
    expect(tryProbability(q)).toBeNull();
    expect(tryMarkov(q)).toBeNull();
  });
  it.each([
    "12 successes out of 40; find the 95% confidence interval",
    "12 out of 40 voters said yes. Give a 95% confidence interval for the proportion",
    "find the 99% confidence interval for 12 of 40",
    "95% CI for 12 of 40",
  ])("count-first / CI-later prose: %s", (q) => {
    expect(PROB_VERB_RE.test(q)).toBe(true);
    const lv = /99%/.test(q) ? 0.153277 : 0.180748;
    near(ivOf(q, WILSON)[0], lv);
  });
  it("a CI for a MEAN still goes to the mean path", () => {
    expect(run("confidence interval 95% mean 50 sd 10 n 30").title).toMatch(/for the mean/);
    expect(run("95% confidence interval mean 50 sd 10 n 30").title).toMatch(/for the mean/);
  });
});

/**
 * Pane reachability (routing, not engine): the pane hands the verbs
 * foldPastedMath(raw), not the raw string, and the algebra switch reads the
 * raw line first. Mirror that for every §D CI and Markov input: the fold must
 * not destroy the parse, transformVerb must stand the prose switches aside,
 * and the first verb in the chain to answer must be ours, with the §D value.
 */
describe("pane reachability: every §D input survives the fold and reaches its verb", () => {
  const chain = (t: string) => tryLp(t) ?? tryLpWords(t) ?? tryInterpolate(t) ?? trySpline(t) ?? tryMarkov(t) ?? tryProbability(t);
  const paneText = (raw: string): string => foldPastedMath(raw.trim(), { lp: isLpInput(raw) || LP_WORDS_RE.test(raw) }).text;
  const cases: [string, RegExp][] = [
    ["confidence interval 95% proportion p = 0.4 n = 100", /Wilson score interval \(recommended\): \[0\.309401, 0\.497997\]/],
    ["confidence interval 95% proportion p = 0.02 n = 50", /reported as \[0, 0\.0588053\]/],
    ["confidence interval 95% proportion p = 0 n = 20", /Wilson score interval \(recommended\): \[0, 0\.161125\]/],
    ["95% confidence interval for 20 of 20", /Wilson score interval \(recommended\): \[0\.838875, 1\]/],
    ["95% confidence interval for a proportion with 12 successes out of 40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["95% confidence interval for a proportion x = 12 n = 40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["95% confidence interval for a proportion x = 12, n = 40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["confidence interval 12/40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["confidence interval p̂ = 0.3, n = 40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["confidence interval proportion p = 30% n = 40", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["99% confidence interval for 12 of 40", /Wilson score interval \(recommended\): \[0\.153277, 0\.503632\]/],
    ["90% confidence interval for 7 of 30", /Wilson score interval \(recommended\): \[0\.13176, 0\.379026\]/],
    ["95% confidence interval for 3 of 10", /Wilson score interval \(recommended\): \[0\.107791, 0\.603222\]/],
    ["12 successes out of 40; find the 95% confidence interval", /Wilson score interval \(recommended\): \[0\.180748, 0\.4543\]/],
    ["markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] expected hitting time from 1 to 3", /Expected steps from S1 to S3: 8\b/],
    ["markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] expected steps from state 1 to state 3", /Expected steps from S1 to S3: 8\b/],
    ["markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] mean first passage time", /M = \[\[4, 2, 8\], \[6, 2, 6\], \[8, 2, 4\]\]/],
    ["markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] probability of reaching 3 before 1 starting from 2", /P\(reach S3 before S1 \| X_0 = S2\) = 1\/2/],
    ["markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] expected return time", /return time to S2 = 2 steps/],
    ["markov states A, B, C [[1/2,1/3,1/6],[3/4,0,1/4],[0,1,0]] expected time to reach C from A", /Expected steps from A to C: 16\/3/],
    ["markov [[0.9,0.1],[0.5,0.5]] expected hitting time from S1 to S2", /Expected steps from S1 to S2: 10\b/],
    ["markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2", /∞ — S2 cannot be reached from S1/],
  ];
  it.each(cases)("%s", (raw, want) => {
    expect(algebraKindFor(raw)).toBeNull();
    const t = paneText(raw);
    expect(PROB_VERB_RE.test(t) || MARKOV_VERB_RE.test(t)).toBe(true); // transformVerb: the prose switches stand aside
    const v = chain(t);
    expect(v).not.toBeNull();
    expect(v!.lines.map((l) => l.text).join("\n")).toMatch(want);
  });
});
