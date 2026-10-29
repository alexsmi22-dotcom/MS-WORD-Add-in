/**
 * Derivatives calculators (release F1, gap item #7), spread into the pane's FIN_CALCS: Black-76 options on futures,
 * the Cox–Ross–Rubinstein binomial tree (European and American, with the tree drawn for small n), a put–call parity
 * check on market prices, the cost-of-carry forward price, multi-leg expiry payoffs, and a plain-vanilla swap valued
 * on a pasted discount curve. Engines: derivatives.ts and finance.ts (Black–Scholes–Merton with a dividend yield).
 * Every result prints a "Conventions:" line. Amounts are currency-neutral (bare grouped numbers).
 */
import type { FinCalcDef, FinResult, FinTable } from "./finCalc";
import { finRefusal as finRefusalRaw } from "./finCalc";
/** A refusal starts with a capital (a lower-case first word raised; a symbol such as "q" or "σ" is left alone). */
const finRefusal = (s: string): FinResult => finRefusalRaw(/^[a-z][a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
import { blackScholes, readFinanceField, type OptionType } from "./finance";
import { finPlotSvg, currentFinFig as currentFigCtx } from "./financeFigures";
import { putCallParitySvg } from "./finLibFigures";
import type { Point, Series } from "./plot";
import { readDataBlock } from "./dataBlock";
import { treeSvg, type TreeEdge, type TreeNode } from "./treeSvg";
import {
  analyzeStrategy,
  black76,
  black76Implied,
  crrPrice,
  CRR_FIGURE_STEPS,
  CRR_MAX_STEPS,
  CrrInput,
  CrrResult,
  CurvePoint,
  discountAt,
  forwardPrice,
  Leg,
  LegKind,
  parityCheck,
  StrategyAnalysis,
  SwapResult,
  swapValue,
} from "./derivatives";

// ------------------------------------------------------------------------------------------------------------------
// Formatting (true minus, grouped thousands; non-finite values are refused before they reach these)
// ------------------------------------------------------------------------------------------------------------------

function fx(x: number, dp: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (/^-0(?:\.0*)?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
/** Up to `dp` decimals, trailing zeros dropped (inputs echoed back: 0.25 years, 5%). */
function fv(x: number, dp = 6): string {
  const s = fx(x, dp);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
const pct = (x: number, dp = 4): string => fx(x * 100, dp) + "%";
const pctIn = (x: number): string => fv(x * 100, 6) + "%";
const yrs = (t: number): string => `${fv(t)} year${t === 1 ? "" : "s"}`;

type Read = (k: string) => string;

/** A number field (already through readFinanceField in the pane; read again here so a direct call is held to it). */
function num(r: Read, key: string, label: string, o: { min?: number; max?: number; minOpen?: boolean } = {}): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `Enter the ${label}.`;
  const v = readFinanceField(raw);
  const Label = label[0].toUpperCase() + label.slice(1);
  if (!Number.isFinite(v)) return `${Label}: “${raw}” is not a finite number.`;
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${Label} must be ${o.minOpen ? "above" : "at least"} ${fv(o.min)}.`;
  if (o.max !== undefined && v > o.max) return `${Label} must be at most ${fv(o.max)}.`;
  return v;
}
/** An optional number field: blank is null. */
function optNum(r: Read, key: string, label: string, o: { min?: number; max?: number; minOpen?: boolean } = {}): number | null | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return null;
  return num(r, key, label, o);
}
const typeOf = (r: Read): OptionType | string => (r("type") === "call" || r("type") === "put" ? (r("type") as OptionType) : "Choose call or put.");

const TYPE_FIELD = {
  key: "type",
  label: "Type",
  default: "call",
  kind: "select" as const,
  options: [
    { value: "call", label: "Call" },
    { value: "put", label: "Put" },
  ],
};

// ------------------------------------------------------------------------------------------------------------------
// Figures
// ------------------------------------------------------------------------------------------------------------------

/** Black-76 value against the futures price, with the discounted payoff and this option marked. */
export function black76CurveSvg(type: OptionType, F: number, K: number, t: number, r: number, sigma: number, price: number): string | undefined {
  const lo = 0.5 * Math.min(F, K);
  const hi = 1.5 * Math.max(F, K);
  const value: Point[] = [];
  const payoff: Point[] = [];
  const disc = Math.exp(-r * t);
  for (let i = 0; i <= 60; i++) {
    const x = lo + ((hi - lo) * i) / 60;
    const b = black76(type, x, K, t, r, sigma);
    if (!("error" in b) && Number.isFinite(b.price)) value.push({ x, y: b.price });
    payoff.push({ x, y: disc * Math.max(type === "call" ? x - K : K - x, 0) });
  }
  if (value.length < 2 || !Number.isFinite(price)) return undefined;
  return finPlotSvg(
    [
      { points: value, type: "line", color: "#2563eb", label: "Black-76 value" },
      { points: payoff, type: "line", color: "#6b7280", label: "discounted payoff" },
      { points: [{ x: F, y: price }], type: "scatter", color: "#b91c1c", label: "this option" },
    ],
    { width: 380, height: 250, title: `Black-76 ${type} value against the futures price`, xlabel: "futures price F", ylabel: "option value" },
  );
}

/** The CRR lattice for n ≤ CRR_FIGURE_STEPS: each node "stock / option value", early-exercise nodes highlighted. */
export function crrTreeSvg(res: CrrResult, american: boolean): string | undefined {
  if (!res.nodes) return undefined;
  const n = res.nodes.length - 1;
  const fig = currentFigCtx();
  const NL = String.fromCharCode(10);
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = i; j >= 0; j--) {
      const nd = res.nodes[i][j];
      if (!Number.isFinite(nd.s) || !Number.isFinite(nd.v)) return undefined;
      // Under a figure-style re-render the stock and option value stack on two lines, halving each node's width, so
      // the lattice can reach a journal's or the USPTO's lettering size (lib/figContext.ts).
      nodes.push({ id: `${i},${j}`, label: fig ? `${fx(nd.s, 2)}${NL}${fx(nd.v, 2)}` : `${fx(nd.s, 2)} / ${fx(nd.v, 2)}`, highlight: nd.early });
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j >= 0; j--) {
      edges.push({ from: `${i},${j}`, to: `${i + 1},${j + 1}` });
      edges.push({ from: `${i},${j}`, to: `${i + 1},${j}` });
    }
  }
  const node = fig ? "node = stock over option value" : "node = stock / option value";
  const cap = american
    ? `${n}-step CRR tree, ${node}; up moves left; ${fig?.bw ? "heavy outline" : "shaded"} = early exercise`
    : `${n}-step CRR tree, ${node}; up moves left`;
  return treeSvg({ nodes, edges, dag: true, caption: cap });
}

/** Tree price against the number of steps (1 … min(n, 200)), with the analytic European price as a line. */
export function crrConvergenceSvg(o: CrrInput, analytic: number, nFinal: number, priceFinal: number): string | undefined {
  const top = Math.min(nFinal, 200);
  const pts: Point[] = [];
  for (let k = 1; k <= top; k++) {
    const r = crrPrice({ ...o, n: k, keepNodes: false });
    if (!("error" in r) && Number.isFinite(r.price)) pts.push({ x: k, y: r.price });
  }
  if (pts.length < 2 || !Number.isFinite(analytic)) return undefined;
  const series: Series[] = [
    { points: pts, type: "line", color: "#2563eb", label: `CRR ${o.american ? "American" : "European"} price` },
    { points: [{ x: 1, y: analytic }, { x: Math.max(top, nFinal), y: analytic }], type: "line", color: "#6b7280", label: "Black–Scholes–Merton European" },
  ];
  if (Number.isFinite(priceFinal)) series.push({ points: [{ x: nFinal, y: priceFinal }], type: "scatter", color: "#b91c1c", label: `${nFinal.toLocaleString("en-US")} steps` });
  return finPlotSvg(series, { width: 380, height: 260, title: "Binomial price against the number of steps", xlabel: "steps n", ylabel: "option value" });
}

/** Fair forward price against time to delivery, with a market futures price marked. */
export function carryCurveSvg(base: number, carry: number, t: number, market: number | null): string | undefined {
  const pts: Point[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = (2 * t * i) / 60;
    const y = base * Math.exp(carry * x);
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  if (pts.length < 2) return undefined;
  const series: Series[] = [
    { points: pts, type: "line", color: "#2563eb", label: "cost-of-carry forward" },
    { points: [{ x: t, y: base * Math.exp(carry * t) }], type: "scatter", color: "#2563eb", label: "fair price at delivery" },
  ];
  if (market !== null) series.push({ points: [{ x: t, y: market }], type: "scatter", color: "#b91c1c", label: "market futures price" });
  return finPlotSvg(series, { width: 380, height: 250, title: "Forward price against time to delivery", xlabel: "time to delivery (years)", ylabel: "forward price" });
}

/** Expiry profit of the strategy against the underlying, with the breakevens marked. */
export function strategyPayoffSvg(a: StrategyAnalysis, legs: Leg[]): string | undefined {
  const strikes = legs.map((l) => l.strike);
  const kmin = Math.min(...strikes);
  const kmax = Math.max(...strikes);
  const w = Math.max(kmax - kmin, 0.25 * kmax, 1e-9);
  let lo = Math.max(0, kmin - 0.6 * w);
  let hi = kmax + 0.6 * w;
  for (const b of a.breakevens) {
    if (b < lo) lo = Math.max(0, b - 0.1 * w);
    if (b > hi) hi = b + 0.1 * w;
  }
  const xs = [...new Set([lo, ...a.kinks.filter((k) => k > lo && k < hi), hi])].sort((x, y) => x - y);
  const line: Point[] = xs.map((x) => ({ x, y: a.profit(x) }));
  if (!line.every((p) => Number.isFinite(p.y))) return undefined;
  const series: Series[] = [
    { points: line, type: "line", color: "#2563eb", label: "profit at expiry" },
    { points: [{ x: lo, y: 0 }, { x: hi, y: 0 }], type: "line", color: "#6b7280", label: "zero" },
  ];
  const be = a.breakevens.filter((b) => b >= lo && b <= hi);
  if (be.length) series.push({ points: be.map((x) => ({ x, y: 0 })), type: "scatter", color: "#b91c1c", label: "breakeven" });
  return finPlotSvg(series, { width: 380, height: 260, title: "Strategy profit at expiry", xlabel: "underlying price at expiry", ylabel: "profit" });
}

/** The curve's continuous zero rates, the floating-leg forwards (steps), and the fixed and par rates. */
export function swapCurveSvg(curve: CurvePoint[], res: SwapResult, fixed: number, tenor: number): string | undefined {
  const tMax = curve[curve.length - 1].t;
  const zero: Point[] = [];
  for (let i = 1; i <= 120; i++) {
    const t = (tMax * i) / 120;
    const d = discountAt(curve, t);
    if (d !== null && d > 0) zero.push({ x: t, y: (-Math.log(d) / t) * 100 });
  }
  const fwd: Point[] = [];
  let t0 = 0;
  for (const row of res.rows) {
    if (!Number.isFinite(row.forward)) continue;
    fwd.push({ x: t0, y: row.forward * 100, gap: fwd.length > 0 });
    fwd.push({ x: row.t, y: row.forward * 100 });
    t0 = row.t;
  }
  if (zero.length < 2 || fwd.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: zero, type: "line", color: "#2563eb", label: "zero rate (continuous)" },
      { points: fwd, type: "line", color: "#ea580c", label: "floating-leg forward" },
      { points: [{ x: 0, y: fixed * 100 }, { x: tenor, y: fixed * 100 }], type: "line", color: "#111827", label: "fixed rate" },
      { points: [{ x: 0, y: res.parRate * 100 }, { x: tenor, y: res.parRate * 100 }], type: "line", color: "#16a34a", label: "par swap rate" },
    ],
    { width: 380, height: 260, title: "Discount curve, forwards and the swap rates", xlabel: "time (years)", ylabel: "rate (%)" },
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Black-76
// ------------------------------------------------------------------------------------------------------------------

export function black76Calc(r: Read): FinResult {
  const type = typeOf(r);
  if (type !== "call" && type !== "put") return finRefusal(type);
  const F = num(r, "f", "futures price F", { min: 0, minOpen: true, max: 1e12 });
  if (typeof F === "string") return finRefusal(F);
  const K = num(r, "k", "strike K", { min: 0, minOpen: true, max: 1e12 });
  if (typeof K === "string") return finRefusal(K);
  const t = num(r, "t", "time to expiry (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof t === "string") return finRefusal(t);
  const rp = num(r, "r", "risk-free rate (%)", { min: -100, max: 100 });
  if (typeof rp === "string") return finRefusal(rp);
  const rate = rp / 100;
  const solve = r("solve") === "iv" ? "iv" : "price";
  let sigma: number;
  let solvedNote = "";
  if (solve === "price") {
    const sp = num(r, "sig", "volatility (%)", { min: 0, max: 500 });
    if (typeof sp === "string") return finRefusal(sp);
    sigma = sp / 100;
  } else {
    const price = num(r, "price", "option price (implied volatility from price)", { min: 0, minOpen: true, max: 1e12 });
    if (typeof price === "string") return finRefusal(price);
    const disc = Math.exp(-rate * t);
    const lower = disc * Math.max(type === "call" ? F - K : K - F, 0);
    const upper = disc * (type === "call" ? F : K);
    if (!(price > lower && price < upper)) {
      return finRefusal(
        `Option price ${fv(price)} is outside the no-arbitrage range for a Black-76 ${type}: it must be above the discounted payoff ${fx(lower, 4)} and below ${fx(upper, 4)} (the discounted ${type === "call" ? "futures price" : "strike"}).`,
      );
    }
    const iv = black76Implied(type, price, F, K, t, rate);
    if (iv === null) return finRefusal(`No volatility between 0.01% and 500% reproduces the option price ${fv(price)}.`);
    sigma = iv;
    solvedNote = ` (implied from the price ${fv(price)})`;
  }
  const b = black76(type, F, K, t, rate, sigma);
  if ("error" in b) return finRefusal(b.error);
  const other = black76(type === "call" ? "put" : "call", F, K, t, rate, sigma);
  if ("error" in other) return finRefusal(other.error);
  const C = type === "call" ? b.price : other.price;
  const P = type === "call" ? other.price : b.price;
  const disc = Math.exp(-rate * t);
  const text = [
    `Black-76 ${type} on a futures price F = ${fv(F)}, strike K = ${fv(K)}, ${yrs(t)} to expiry, r = ${pctIn(rate)}, σ = ${solve === "iv" ? pct(sigma) : pctIn(sigma)}${solvedNote}`,
    `${type === "call" ? "Call" : "Put"} price = ${fx(b.price, 4)}`,
    `Delta (∂V/∂F) = ${fx(b.delta, 6)}; gamma (∂²V/∂F²) = ${fx(b.gamma, 6)}`,
    `Vega = ${fx(b.vega / 100, 4)} per 1% volatility; theta = ${fx(b.theta / 365, 4)} per day (${fx(b.theta, 4)} per year); rho = ${fx(b.rho / 100, 4)} per 1% rate (F held fixed)`,
    `Put–call parity: C − P = ${fx(C - P, 4)} = exp(−rt)·(F − K) = ${fx(disc * (F - K), 4)} (call ${fx(C, 4)}, put ${fx(P, 4)})`,
    `Conventions: Black (1976) on the futures price, European exercise; d₁ = (ln(F/K) + σ²t/2)/(σ√t), d₂ = d₁ − σ√t; ` +
      `price discounted at exp(−rt) with r continuously compounded; time in years; theta per year is −∂V/∂t with F fixed, per day is that ÷ 365; ` +
      `vega and rho per 1.00 divided by 100.`,
  ].join("\n");
  return { text, reading: black76Reading(type, solve, sigma, b), svg: black76CurveSvg(type, F, K, t, rate, sigma, b.price) };
}

/** The option's value (or the volatility its price implies), how it moves with the futures price, and its time decay. */
export function black76Reading(type: OptionType, solve: "price" | "iv", sigma: number, b: { price: number; delta: number; theta: number }): string {
  const price = fx(b.price, 4);
  const head =
    solve === "iv"
      ? `The ${type} price of ${price} implies a volatility of ${pct(sigma)} a year`
      : `The ${type} is worth ${price}`;
  const delta = fx(b.delta, 6);
  const move =
    delta === "0.000000" ? "it barely moves with the futures price" : `a rise of 1 in the futures price ${b.delta > 0 ? "raises" : "lowers"} it by about ${fx(Math.abs(b.delta), 6)}`;
  const day = fx(b.theta / 365, 4);
  const decay = day === "0.0000" ? "" : b.theta < 0 ? ` and it loses about ${fx(Math.abs(b.theta / 365), 4)} of value a day as expiry nears` : ` and it gains about ${fx(b.theta / 365, 4)} a day as expiry nears`;
  return `${head}; ${move}${decay}.`;
}

// ------------------------------------------------------------------------------------------------------------------
// CRR binomial tree
// ------------------------------------------------------------------------------------------------------------------

export function crrCalc(r: Read): FinResult {
  const type = typeOf(r);
  if (type !== "call" && type !== "put") return finRefusal(type);
  const american = r("style") === "american";
  const S = num(r, "s", "spot price S", { min: 0, minOpen: true, max: 1e12 });
  if (typeof S === "string") return finRefusal(S);
  const K = num(r, "k", "strike K", { min: 0, minOpen: true, max: 1e12 });
  if (typeof K === "string") return finRefusal(K);
  const t = num(r, "t", "time to expiry (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof t === "string") return finRefusal(t);
  const rp = num(r, "r", "risk-free rate (%)", { min: -100, max: 100 });
  if (typeof rp === "string") return finRefusal(rp);
  const qp = num(r, "q", "dividend yield q (%)", { min: -100, max: 100 });
  if (typeof qp === "string") return finRefusal(qp);
  const sp = num(r, "sig", "volatility (%)", { min: 0, minOpen: true, max: 500 });
  if (typeof sp === "string") return finRefusal(sp);
  const n = num(r, "n", "number of steps n", { min: 1, max: CRR_MAX_STEPS });
  if (typeof n === "string") return finRefusal(n);
  if (!Number.isInteger(n)) return finRefusal(`Number of steps n must be a whole number (got ${fv(n)}).`);
  const input: CrrInput = { type, american, S, K, t, r: rp / 100, q: qp / 100, sigma: sp / 100, n, keepNodes: n <= CRR_FIGURE_STEPS };
  const res = crrPrice(input);
  if ("error" in res) return finRefusal(res.error);
  const analytic = blackScholes(type, S, K, t, input.r, input.sigma, input.q);
  const euro = american ? crrPrice({ ...input, american: false, keepNodes: false }) : res;
  if ("error" in euro) return finRefusal(euro.error);
  if (![res.price, analytic, euro.price].every(Number.isFinite)) return finRefusal("The tree price is not finite: check the inputs.");
  const style = american ? "American" : "European";
  const lines = [
    `${style} ${type}, S = ${fv(S)}, K = ${fv(K)}, ${yrs(t)}, r = ${pctIn(input.r)}, q = ${pctIn(input.q)}, σ = ${pctIn(input.sigma)}, n = ${n.toLocaleString("en-US")} step${n === 1 ? "" : "s"}`,
    `CRR ${style} ${type} price = ${fx(res.price, 4)}`,
  ];
  if (american) {
    lines.push(`European ${type} on the same tree = ${fx(euro.price, 4)}; early-exercise premium = ${fx(res.price - euro.price, 4)}`);
    lines.push(
      res.earlyNodes > 0
        ? res.firstEarlyStep === 0
          ? `Early exercise: exercising NOW (step 0) beats holding: the option is worth its intrinsic value ${fx(res.price, 4)}.`
          : `Early exercise is optimal at ${res.earlyNodes.toLocaleString("en-US")} node${res.earlyNodes === 1 ? "" : "s"}, the earliest at step ${res.firstEarlyStep} (t = ${fv(res.firstEarlyStep * res.dt, 4)} years).`
        : `Early exercise is never optimal on this tree, so the American price equals the European one${type === "call" && input.q <= 0 ? " (an American call on a stock with no dividend yield is never exercised early)" : ""}.`,
    );
  }
  lines.push(
    `Black–Scholes–Merton European price (analytic) = ${fx(analytic, 4)}; ` +
      (american ? `the European tree differs from it by ${fx(euro.price - analytic, 4)}.` : `tree − analytic = ${fx(res.price - analytic, 4)}.`),
  );
  lines.push("Convergence: as n grows the CRR European price converges to the Black–Scholes–Merton price; the error shrinks roughly like 1/n and oscillates between odd and even n.");
  if (n >= 2) lines.push(`Tree Greeks: delta = ${fx(res.delta, 4)} (step 1); gamma = ${fx(res.gamma, 6)} and theta = ${fx(res.theta / 365, 4)} per day (${fx(res.theta, 4)} per year) (step 2).`);
  else lines.push("Tree Greeks need at least 2 steps (delta from step 1, gamma and theta from step 2).");
  lines.push(
    `Conventions: Cox–Ross–Rubinstein, Δt = t/n = ${fv(res.dt, 8)} years; u = exp(σ√Δt) = ${fx(res.u, 8)}, d = 1/u = ${fx(res.d, 8)}, ` +
      `p = (exp((r − q)Δt) − d)/(u − d) = ${fx(res.p, 8)}; each step discounted at exp(−rΔt); r and q continuously compounded; ` +
      (american ? "American exercise checked at every node, including today; " : "European exercise at expiry only; ") +
      `tree Greeks by Hull's formulas; the tree is drawn for n ≤ ${CRR_FIGURE_STEPS}, otherwise the price against n.`,
  );
  const svg = res.nodes ? crrTreeSvg(res, american) : crrConvergenceSvg(input, analytic, n, res.price);
  return { text: lines.join("\n"), reading: crrReading(type, american, n, res, euro.price, analytic), svg };
}

/** The tree value, and either what early exercise adds (American) or how close the tree is to the formula (European). */
export function crrReading(type: OptionType, american: boolean, n: number, res: { price: number; earlyNodes: number; firstEarlyStep: number }, euro: number, analytic: number): string {
  const steps = `${n.toLocaleString("en-US")}-step tree`;
  if (!american) return `The European ${type} is worth about ${fx(res.price, 4)} on a ${steps}, against ${fx(analytic, 4)} from the Black–Scholes–Merton formula; more steps bring the two closer.`;
  const head = `The American ${type} is worth about ${fx(res.price, 4)} on a ${steps}`;
  if (res.earlyNodes > 0 && res.firstEarlyStep === 0) return `${head}, its value if exercised today: exercising now beats holding it.`;
  // fix-fin R1 #14: decided on the printed premium; "0.0000 more … because exercising early pays" contradicted itself.
  const extra = fx(res.price - euro, 4);
  if (res.earlyNodes > 0 && !/[1-9]/.test(extra))
    return `${head}, the same as the option without early exercise to 4 decimals: early exercise pays at some prices on the tree, but adds too little to show.`;
  if (res.earlyNodes > 0)
    return `${head}, ${extra} more than the same option without early exercise, because exercising early pays at some prices (first at step ${res.firstEarlyStep}).`;
  return `${head}, the same as its European twin: early exercise is never worth it on this tree.`;
}

// ------------------------------------------------------------------------------------------------------------------
// Put–call parity check
// ------------------------------------------------------------------------------------------------------------------

export function parityCalc(r: Read): FinResult {
  const C = num(r, "c", "call price", { min: 0, minOpen: true, max: 1e12 });
  if (typeof C === "string") return finRefusal(C);
  const P = num(r, "p", "put price", { min: 0, minOpen: true, max: 1e12 });
  if (typeof P === "string") return finRefusal(P);
  const S = num(r, "s", "spot price S", { min: 0, minOpen: true, max: 1e12 });
  if (typeof S === "string") return finRefusal(S);
  const K = num(r, "k", "strike K", { min: 0, minOpen: true, max: 1e12 });
  if (typeof K === "string") return finRefusal(K);
  const t = num(r, "t", "time to expiry (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof t === "string") return finRefusal(t);
  const rp = num(r, "r", "risk-free rate (%)", { min: -100, max: 100 });
  if (typeof rp === "string") return finRefusal(rp);
  const qp = num(r, "q", "dividend yield q (%)", { min: -100, max: 100 });
  if (typeof qp === "string") return finRefusal(qp);
  const cost = optNum(r, "cost", "trading cost band per share", { min: 0, max: 1e12 });
  if (typeof cost === "string") return finRefusal(cost);
  const band = cost ?? 0;
  const pc = parityCheck(C, P, S, K, t, rp / 100, qp / 100);
  if (![pc.lhs, pc.rhs, pc.violation, pc.impliedForward].every(Number.isFinite)) return finRefusal("The parity terms are not finite: check the rates and the time to expiry.");
  const scale = Math.max(1, S, K);
  const v = Math.abs(pc.violation) <= 1e-12 * scale ? 0 : pc.violation;
  const eqt = Math.exp((-qp / 100) * t);
  const pvK = K * Math.exp((-rp / 100) * t);
  // fix-fin R1 #14: r = −100% over 100 years made K·exp(−rt) a 49-digit number and the reading 397 characters.
  if ([pc.lhs, pc.rhs, S * eqt, pvK, pc.impliedForward].some((x) => Math.abs(x) > PARITY_MAX)) {
    return finRefusal(
      "With this rate, dividend yield and time to expiry the discounted spot or strike runs past 10¹², which is outside this calculator: check the risk-free rate, the dividend yield and the time to expiry.",
    );
  }
  const lines = [
    `Quoted: call ${fv(C)}, put ${fv(P)}; S = ${fv(S)}, K = ${fv(K)}, ${yrs(t)}, r = ${pctIn(rp / 100)}, q = ${pctIn(qp / 100)}`,
    `C − P = ${fx(pc.lhs, 4)}`,
    `S·exp(−qt) − K·exp(−rt) = ${fx(S * eqt, 4)} − ${fx(pvK, 4)} = ${fx(pc.rhs, 4)}`,
    `Violation (C − P) − (S·exp(−qt) − K·exp(−rt)) = ${fx(v, 4)} per share`,
  ];
  if (v === 0) lines.push("Parity holds exactly: no arbitrage.");
  else if (parityHoldsAsPrinted(v, pc.lhs, pc.rhs)) lines.push("Parity holds to the 4 decimals shown: no arbitrage worth naming.");
  else if (Math.abs(v) <= band) lines.push(`|violation| ${fx(Math.abs(v), 4)} is within the trading cost band ${fv(band)}: no arbitrage after costs.`);
  else if (v > 0) {
    lines.push(
      `The call is rich relative to the put. Conversion: sell the call, buy the put, buy ${fx(eqt, 6)} shares (dividends reinvested) and borrow ${fx(pvK, 4)} for ${yrs(t)}. ` +
        `At expiry the shares, put and short call deliver exactly K = ${fv(K)}, which repays the loan; the ${fx(v, 4)} per share is locked in today` +
        (band > 0 ? ` (${fx(v - band, 4)} after the cost band).` : "."),
    );
  } else {
    lines.push(
      `The put is rich relative to the call. Reverse conversion: buy the call, sell the put, short ${fx(eqt, 6)} shares and lend ${fx(pvK, 4)} for ${yrs(t)}. ` +
        `At expiry the long call and short put buy back the shares at K = ${fv(K)}, paid from the loan; the ${fx(-v, 4)} per share is locked in today` +
        (band > 0 ? ` (${fx(-v - band, 4)} after the cost band).` : "."),
    );
  }
  lines.push(
    `Implied by the two prices: forward F = K + (C − P)·exp(rt) = ${fx(pc.impliedForward, 4)}` +
      (Number.isFinite(pc.impliedQ) ? `; dividend yield q = −ln((C − P + K·exp(−rt))/S)/t = ${pct(pc.impliedQ)}` : "; no dividend yield fits (C − P + K·exp(−rt) ≤ 0)") +
      ".",
  );
  lines.push(
    "Conventions: European options on the same underlying, strike and expiry; r and q continuously compounded; time in years; a continuous dividend yield q (discrete dividends: put their present value in q's place by lowering S); " +
      "short sales and borrowing at r allowed; the cost band is a total per share across all legs.",
  );
  const table: FinTable = {
    label: "Put–call parity",
    rows: [
      ["Term", "Value"],
      ["C − P (quoted)", fx(pc.lhs, 4)],
      ["S·exp(−qt)", fx(S * eqt, 4)],
      ["K·exp(−rt)", fx(pvK, 4)],
      ["S·exp(−qt) − K·exp(−rt)", fx(pc.rhs, 4)],
      ["Violation", fx(v, 4)],
    ],
    align: ["left", "right"],
  };
  return { text: lines.join("\n"), reading: parityReading(v, band, pc.lhs, pc.rhs), svg: putCallParitySvg(S, eqt, pvK, pc.lhs), tables: [table] };
}

/**
 * Whether the quoted call and put agree with put–call parity, and if not which side is rich and what the riskless
 * trade locks in. The branches are the text's own (v exactly 0; under the 4 decimals shown; inside the cost band;
 * call rich; put rich).
 */
/** Past this size a parity term is not a price (R1 #14). */
const PARITY_MAX = 1e12;

/**
 * Parity holds as printed (fix-fin R1 #14): the violation prints as 0.0000, or the two sides print the same to 4
 * decimals. A violation of 0.00005 printed "too expensive (4.8771 against 4.8771)".
 */
export function parityHoldsAsPrinted(v: number, lhs: number, rhs: number): boolean {
  return v === 0 || !/[1-9]/.test(fx(Math.abs(v), 4)) || fx(lhs, 4) === fx(rhs, 4);
}

export function parityReading(v: number, band: number, lhs: number, rhs: number): string {
  const sides = `C − P = ${fx(lhs, 4)} against ${fx(rhs, 4)} from spot and strike`;
  if (parityHoldsAsPrinted(v, lhs, rhs)) return `The call and put prices agree with put–call parity (${sides}), so they leave no arbitrage.`;
  const gap = fx(Math.abs(v), 4);
  if (Math.abs(v) <= band) return `The prices miss put–call parity by ${gap} per share (${sides}), inside the trading cost band of ${fv(band)} per share, so there is no profit after costs.`;
  const after = band > 0 ? ` (${fx(Math.abs(v) - band, 4)} after the cost band)` : "";
  if (v > 0) return `The call is ${gap} per share too expensive against the put (${sides}). Selling the call and buying the put and the shares locks in that ${gap} per share before trading costs${after}.`;
  return `The put is ${gap} per share too expensive against the call (${sides}). Buying the call, selling the put and shorting the shares locks in that ${gap} per share before trading costs${after}.`;
}

// ------------------------------------------------------------------------------------------------------------------
// Cost of carry
// ------------------------------------------------------------------------------------------------------------------

export function carryCalc(r: Read): FinResult {
  const S = num(r, "s", "spot price S", { min: 0, minOpen: true, max: 1e12 });
  if (typeof S === "string") return finRefusal(S);
  const t = num(r, "t", "time to delivery (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof t === "string") return finRefusal(t);
  const rp = num(r, "r", "risk-free rate (%)", { min: -100, max: 100 });
  if (typeof rp === "string") return finRefusal(rp);
  const qp = num(r, "q", "income or convenience yield q (%)", { min: -100, max: 100 });
  if (typeof qp === "string") return finRefusal(qp);
  const up = num(r, "u", "storage cost rate u (%)", { min: -100, max: 100 });
  if (typeof up === "string") return finRefusal(up);
  const I = num(r, "inc", "present value of cash income I", { min: 0, max: 1e12 });
  if (typeof I === "string") return finRefusal(I);
  const U = num(r, "stor", "present value of storage costs U", { min: 0, max: 1e12 });
  if (typeof U === "string") return finRefusal(U);
  const mkt = optNum(r, "mkt", "market futures price", { min: 0, minOpen: true, max: 1e12 });
  if (typeof mkt === "string") return finRefusal(mkt);
  const K = optNum(r, "deliv", "delivery price of an existing long forward", { min: 0, minOpen: true, max: 1e12 });
  if (typeof K === "string") return finRefusal(K);
  const rate = rp / 100;
  const q = qp / 100;
  const u = up / 100;
  const F = forwardPrice({ S, t, r: rate, q, u, I, U });
  if (typeof F !== "number") return finRefusal(F.error);
  if (F > 1e15) return finRefusal(`The fair forward price exceeds 10¹⁵ (net carry ${pct(rate - q + u)} a year for ${yrs(t)}): check the rates and the time to delivery.`);
  const base = S - I + U;
  const carry = rate - q + u;
  const lines = [
    `Spot S = ${fv(S)}, ${yrs(t)} to delivery, r = ${pctIn(rate)}, yield q = ${pctIn(q)}, storage rate u = ${pctIn(u)}, PV of income I = ${fv(I)}, PV of storage U = ${fv(U)}`,
    `Fair forward price F₀ = (S − I + U)·exp((r − q + u)t) = ${fx(base, 4)} × exp(${fv(carry * t, 8)}) = ${fx(F, 4)}`,
    `Net cost of carry r − q + u = ${pct(carry)} a year; ${F === S ? "the forward equals spot (flat)." : `the forward is at a ${F > S ? "premium" : "discount"} to spot (${F > S ? "contango" : "backwardation"}) of ${fx(Math.abs(F - S), 4)}.`}`,
  ];
  if (mkt !== null) {
    const gap = mkt - F;
    const pv = gap * Math.exp(-rate * t);
    if (Math.abs(gap) <= 1e-12 * Math.max(1, F)) lines.push(`Market futures price ${fv(mkt)} equals the fair price: no carry arbitrage.`);
    else if (Math.abs(gap) < 5e-5) lines.push(`Market futures price ${fv(mkt)} matches the fair price to the 4 decimals shown: no carry arbitrage worth naming.`);
    else if (gap > 0)
      lines.push(
        `Market futures price ${fv(mkt)} is ${fx(gap, 4)} above fair. Cash-and-carry: borrow, buy the asset (and pay its storage), sell the futures; at delivery the asset is delivered at ${fv(mkt)}. ` +
          `Profit ${fx(gap, 4)} at delivery, ${fx(pv, 4)} today.`,
      );
    else
      lines.push(
        `Market futures price ${fv(mkt)} is ${fx(-gap, 4)} below fair. Reverse cash-and-carry: sell (or short) the asset, invest the proceeds, buy the futures; ` +
          `profit ${fx(-gap, 4)} at delivery, ${fx(-pv, 4)} today. It needs the asset to be borrowable or held for sale; for a consumption commodity a convenience yield can keep the futures below this fair price without arbitrage.`,
      );
  }
  if (K !== null) lines.push(`Value of an existing long forward with delivery price ${fv(K)}: (F₀ − K)·exp(−rt) = ${fx((F - K) * Math.exp(-rate * t), 4)} (the short side holds the negative).`);
  lines.push(
    "Conventions: cost-of-carry model; r, q and u continuously compounded annual rates; I and U present values today of known cash income and storage costs over the life; " +
      "time in years; forward and futures prices treated as equal (deterministic interest rates, no daily-settlement convexity).",
  );
  return { text: lines.join("\n"), reading: carryReading(S, F, carry, t, rate, mkt, K), svg: carryCurveSvg(base, carry, t, mkt) };
}

/** The fair forward against spot, then the market price against it (the arbitrage) or the existing forward's value. */
export function carryReading(S: number, F: number, carry: number, t: number, rate: number, mkt: number | null, K: number | null): string {
  const head =
    F === S
      ? `The fair futures price is ${fx(F, 4)}, equal to spot, with a net cost of carry of ${pct(carry)} a year`
      : `The fair futures price is ${fx(F, 4)}, ${fx(Math.abs(F - S), 4)} ${F > S ? "above" : "below"} the spot price of ${fv(S)}, with a net cost of carry of ${pct(carry)} a year`;
  if (mkt !== null) {
    const gap = mkt - F;
    if (Math.abs(gap) <= 1e-12 * Math.max(1, F) || Math.abs(gap) < 5e-5) return `${head}. The market price ${fv(mkt)} agrees with it, so there is no carry arbitrage.`;
    if (gap > 0) return `${head}. The market price ${fv(mkt)} is ${fx(gap, 4)} higher, so buying the asset and selling the futures earns that ${fx(gap, 4)} at delivery before costs.`;
    return `${head}. The market price ${fv(mkt)} is ${fx(-gap, 4)} lower, so selling the asset and buying the futures earns that ${fx(-gap, 4)} at delivery, if the asset can be borrowed or is held for sale.`;
  }
  if (K !== null) {
    const val = (F - K) * Math.exp(-rate * t);
    const s = fx(val, 4);
    return `${head}. An existing long forward at ${fv(K)} is ${s === "0.0000" ? "worth nothing either way" : val > 0 ? `worth ${s} to its holder today` : `a liability of ${fx(-val, 4)} to its holder today`}.`;
  }
  return `${head}.`;
}

// ------------------------------------------------------------------------------------------------------------------
// Multi-leg strategy payoff
// ------------------------------------------------------------------------------------------------------------------

const LEG_WORD: Record<string, LegKind> = { call: "call", c: "call", put: "put", p: "put", stock: "stock", share: "stock", shares: "stock", underlying: "stock", s: "stock" };
const LEGS_MAX = 20;

/** Reads the legs block: type, strike (or stock price), signed quantity, premium per unit. */
export function readLegs(text: string): { legs: Leg[]; notes: string[] } | string {
  const kinds = new Map<number, LegKind>();
  const b = readDataBlock(text, "Strategy legs", {
    maxRows: LEGS_MAX,
    noHeader: true,
    mapRow: (fields, line) => {
      const first = (fields[0] ?? "").trim().toLowerCase();
      if (/^(type|leg|kind|option)$/.test(first)) return null;
      const k = LEG_WORD[first];
      if (!k) return fields;
      kinds.set(line, k);
      return ["-", ...fields.slice(1)];
    },
  });
  if (!b.ok) return b.error;
  if (!b.rows.length) return "Strategy legs: enter at least one leg (type, strike, quantity, premium).";
  const legs: Leg[] = [];
  const notes: string[] = [...b.notes];
  for (let i = 0; i < b.rows.length; i++) {
    const line = b.lines[i];
    const kind = kinds.get(line);
    const row = b.rows[i];
    if (!kind) return `Strategy legs, line ${line}: start the line with call, put or stock.`;
    const vals = row.slice(1);
    if (vals.length < 2) return `Strategy legs, line ${line}: needs a ${kind === "stock" ? "price" : "strike"} and a quantity${kind === "stock" ? "" : ", then the premium"}.`;
    if (vals.length > 3) return `Strategy legs, line ${line}: has ${vals.length} numbers after the type; expected ${kind === "stock" ? "price, quantity" : "strike, quantity, premium"}.`;
    const [strike, qty, prem] = vals;
    if (strike === null || !Number.isFinite(strike) || !(strike > 0) || strike > 1e12) return `Strategy legs, line ${line}: the ${kind === "stock" ? "stock price" : "strike"} must be a positive number.`;
    if (qty === null || !Number.isFinite(qty) || Math.abs(qty) > 1e9) return `Strategy legs, line ${line}: the quantity must be a finite number (positive long, negative short).`;
    let premium = 0;
    if (kind === "stock") {
      if (prem !== undefined && prem !== null && prem !== 0) return `Strategy legs, line ${line}: a stock leg has no premium; its cost is the price in the second column.`;
    } else {
      if (prem === undefined || prem === null || !Number.isFinite(prem) || prem < 0 || prem > 1e12) return `Strategy legs, line ${line}: the premium must be zero or a positive number (paid when long, received when short).`;
      premium = prem;
    }
    if (qty === 0) {
      notes.push(`Line ${line} has quantity 0 and is left out.`);
      continue;
    }
    legs.push({ kind, strike, qty, premium });
  }
  if (!legs.length) return "Strategy legs: every leg has quantity 0; give at least one leg a quantity.";
  return { legs, notes };
}

export function strategyCalc(r: Read): FinResult {
  const read = readLegs(r("legs"));
  if (typeof read === "string") return finRefusal(read);
  const mult = num(r, "mult", "contract multiplier", { min: 0, minOpen: true, max: 1e6 });
  if (typeof mult === "string") return finRefusal(mult);
  const { legs, notes } = read;
  const a = analyzeStrategy(legs, mult);
  const money = (x: number): string => fx(x, 2);
  // fix-fin R1 #12: a stock leg's quantity is lots of the multiplier, so say how many shares that is.
  const shares = (q: number): string => (mult === 1 ? "stock" : `lot${q === 1 ? "" : "s"} of stock (${fv(q * mult)} shares)`);
  const describe = (l: Leg): string =>
    `${l.qty > 0 ? "long" : "short"} ${fv(Math.abs(l.qty))} ${l.kind === "stock" ? `${shares(Math.abs(l.qty))} at ${fv(l.strike)}` : `${fv(l.strike)} ${l.kind}${Math.abs(l.qty) === 1 ? "" : "s"} at ${fv(l.premium)}`}`;
  const lines = [`Strategy: ${legs.map(describe).join("; ")}; multiplier ${fv(mult)}`];
  lines.push(
    Math.abs(a.netPremium) < 1e-9
      ? "Net premium: zero."
      : a.netPremium > 0
        ? `Net premium paid (debit) = ${money(a.netPremium)}`
        : `Net premium received (credit) = ${money(-a.netPremium)}`,
  );
  // Where an extreme is reached: consecutive kinks that both reach it bound a whole segment (profit is linear between).
  const at = (xs: number[]): string => {
    const idx = xs.map((x) => a.kinks.indexOf(x));
    const parts: string[] = [];
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
      const openTop = idx[j] === a.kinks.length - 1 && a.slopeHigh === 0;
      if (openTop) parts.push(`for underlying prices from ${fv(a.kinks[idx[i]], 4)} up`);
      else if (j > i) parts.push(`for underlying prices from ${fv(a.kinks[idx[i]], 4)} to ${fv(a.kinks[idx[j]], 4)}`);
      else parts.push(`at an underlying price of ${fv(a.kinks[idx[i]], 4)}`);
      i = j + 1;
    }
    return parts.join(" and ");
  };
  lines.push(
    a.maxProfit.unbounded
      ? "Maximum profit: unlimited (profit keeps rising as the underlying rises)."
      : `Maximum profit = ${money(a.maxProfit.value)}, reached ${at(a.maxProfit.at)}.`,
  );
  lines.push(
    a.maxLoss.unbounded
      ? "Maximum loss: unlimited (losses keep growing as the underlying rises)."
      : `Maximum loss = ${money(-a.maxLoss.value)}${a.maxLoss.value > 0 ? " (negative: the strategy cannot lose)" : ""}, reached ${at(a.maxLoss.at)}.`,
  );
  const ranges = a.zeroRanges.map(([x, y]) => (Number.isFinite(y) ? `zero profit for every price from ${fv(x, 4)} to ${fv(y, 4)}` : `zero profit for every price from ${fv(x, 4)} up`));
  if (!a.breakevens.length && !ranges.length) lines.push("Breakeven: none; the profit never crosses zero.");
  else lines.push(`Breakeven${a.breakevens.length + ranges.length === 1 ? "" : "s"}: ${[...a.breakevens.map((x) => fv(x, 4)), ...ranges].join("; ")}.`);
  for (const nt of notes) lines.push(nt);
  lines.push(
    "Conventions: profit at expiry = Σ quantity × multiplier × (payoff − premium), with a stock leg's profit quantity × multiplier × (S − price paid): every quantity, a stock leg's too, counts lots of the multiplier (at 100, a stock quantity of 1 is 100 shares, as in a covered call); " +
      "positive quantity long, negative short; premiums per unit, paid when long and received when short; no interest on premiums, no commissions, no early exercise; " +
      "profit is piecewise linear, so maxima, minima and breakevens are exact at the strikes and on the segments between them, for an underlying from 0 up.",
  );
  const legTable: FinTable = {
    label: "Strategy legs",
    rows: [
      ["Leg", "Type", "Strike or price", "Quantity", "Premium", "Premium cash flow"],
      ...legs.map((l, i) => [String(i + 1), l.kind, fv(l.strike), fv(l.qty), l.kind === "stock" ? "" : fv(l.premium), l.kind === "stock" ? "" : money(-l.qty * l.premium * mult)]),
    ],
    align: ["left", "left", "right", "right", "right", "right"],
    note: "Premium cash flow: negative paid, positive received (multiplier applied).",
  };
  const profitTable: FinTable = {
    label: "Profit at expiry at the strikes",
    rows: [["Underlying at expiry", "Profit"], ...a.kinks.map((k) => [fv(k, 4), money(a.profit(k))])],
    align: ["right", "right"],
    note: a.slopeHigh === 0 ? "Profit is flat above the highest strike." : `Above the highest strike profit changes by ${money(a.slopeHigh)} per 1 rise in the underlying.`,
  };
  return { text: lines.join("\n"), reading: strategyReading(a), svg: strategyPayoffSvg(a, legs), tables: [legTable, profitTable] };
}

/** The upfront cash, the best and worst outcome at expiry, and where the position breaks even. */
export function strategyReading(a: StrategyAnalysis): string {
  const money = (x: number): string => fx(x, 2);
  const upfront = Math.abs(a.netPremium) < 1e-9 ? "It costs nothing up front" : a.netPremium > 0 ? `It costs ${money(a.netPremium)} up front` : `It brings in ${money(-a.netPremium)} up front`;
  // fix-fin R1 #11: a best case that is a loss reads "it loses at least 10.00", not "it makes at most −10.00".
  const bestText = a.maxProfit.unbounded ? "" : money(a.maxProfit.value);
  const best = a.maxProfit.unbounded
    ? "its profit is unlimited if the underlying keeps rising"
    : !/[1-9]/.test(bestText)
      ? "at best it breaks even"
      : a.maxProfit.value < 0
        ? `it loses at least ${money(-a.maxProfit.value)}`
        : `it makes at most ${bestText}`;
  let worst: string;
  if (a.maxLoss.unbounded) worst = "its loss is unlimited if the underlying keeps rising";
  else if (money(-a.maxLoss.value) === "0.00") worst = "at worst it breaks even";
  else if (a.maxLoss.value > 0) worst = `at worst it still makes ${money(a.maxLoss.value)}`;
  else worst = `it loses at most ${money(-a.maxLoss.value)}`;
  const be = a.breakevens.map((x) => fv(x, 4));
  let even: string;
  if (!be.length && !a.zeroRanges.length) even = "Its profit never crosses zero.";
  else if (!be.length) even = "It breaks even over a range of prices (see the breakevens below).";
  else {
    const shown = be.length > 4 ? [...be.slice(0, 4), "more"] : be;
    const list = shown.length === 1 ? shown[0] : shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1];
    even = `It breaks even at ${be.length === 1 ? "an underlying price" : "underlying prices"} of ${list}${a.zeroRanges.length ? ", and over a range of prices" : ""}.`;
  }
  return `${upfront}; at expiry ${best} and ${worst}. ${even}`;
}

// ------------------------------------------------------------------------------------------------------------------
// Interest-rate swap on a user curve
// ------------------------------------------------------------------------------------------------------------------

const CURVE_MAX = 200;

/** Reads the curve block (tenor in years, then a discount factor or a zero rate in %), sorted, as discount factors. */
export function readCurve(text: string, kind: string): { curve: CurvePoint[]; notes: string[] } | string {
  const b = readDataBlock(text, "Discount curve", { maxRows: CURVE_MAX });
  if (!b.ok) return b.error;
  const notes = [...b.notes];
  const pts: (CurvePoint & { line: number })[] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    const line = b.lines[i];
    if (row.length !== 2) return `Discount curve, line ${line}: needs 2 numbers (tenor in years, then ${kind === "df" ? "the discount factor" : "the zero rate in %"}); found ${row.length}.`;
    const [t, v] = row;
    if (t === null || v === null || !Number.isFinite(t) || !Number.isFinite(v)) return `Discount curve, line ${line}: a value is missing or not a finite number.`;
    if (t < 0 || t > 100) return `Discount curve, line ${line}: the tenor must be from 0 to 100 years.`;
    let df: number;
    if (kind === "df") {
      if (!(v > 0) || v > 10) return `Discount curve, line ${line}: a discount factor must be above 0 (and at most 10).`;
      df = v;
    } else if (kind === "zcont") {
      if (Math.abs(v) > 100) return `Discount curve, line ${line}: the zero rate must be between −100% and 100%.`;
      df = Math.exp((-v / 100) * t);
    } else {
      if (!(v > -100) || v > 100) return `Discount curve, line ${line}: an annually compounded zero rate must be above −100% and at most 100%.`;
      df = Math.pow(1 + v / 100, -t);
    }
    if (t === 0) {
      if (kind === "df" && Math.abs(v - 1) > 1e-12) return `Discount curve, line ${line}: the discount factor at tenor 0 must be 1 (today's money is worth itself).`;
      notes.push(`Line ${line} (tenor 0) is left out: the discount factor today is 1 by definition.`);
      continue;
    }
    if (!Number.isFinite(df) || !(df >= 1e-8) || df > 10) {
      return `Discount curve, line ${line}: the discount factor it gives is outside 0.00000001 to 10 (below 0.00000001 is a continuous zero rate above ${fv((-Math.log(1e-8) / t) * 100, 2)}% over ${yrs(t)}); check the value and the curve type.`;
    }
    pts.push({ t, df, line });
  }
  if (!pts.length) return "Discount curve: enter at least one point with a tenor above 0.";
  const sorted = [...pts].sort((x, y) => x.t - y.t);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t === sorted[i - 1].t) return `Discount curve: tenor ${fv(sorted[i].t)} appears twice (lines ${sorted[i - 1].line} and ${sorted[i].line}).`;
  }
  if (sorted.some((p, i) => p !== pts[i])) notes.push("The curve points were not in tenor order; they are sorted by tenor.");
  return { curve: sorted.map(({ t, df }) => ({ t, df })), notes };
}

function freqNum(r: Read, key: string, label: string): number | string {
  const f = Number(r(key));
  return [1, 2, 4, 12].includes(f) ? f : `${label} must be 1, 2, 4 or 12 a year (got ${r(key) || "nothing"}).`;
}
const timesWord = (f: number): string => (f === 1 ? "annual" : f === 2 ? "semiannual" : f === 4 ? "quarterly" : "monthly");

export function swapCalc(r: Read): FinResult {
  const side = r("side") === "receive" ? "receive" : "pay";
  const N = num(r, "notional", "notional", { min: 0, minOpen: true, max: 1e13 });
  if (typeof N === "string") return finRefusal(N);
  const fp = num(r, "fixed", "fixed rate (%)", { min: -100, max: 100 });
  if (typeof fp === "string") return finRefusal(fp);
  const sb = num(r, "spread", "floating spread (bp)", { min: -10000, max: 10000 });
  if (typeof sb === "string") return finRefusal(sb);
  const T = num(r, "tenor", "swap tenor (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof T === "string") return finRefusal(T);
  const ff = freqNum(r, "ffix", "Fixed-leg payments");
  if (typeof ff === "string") return finRefusal(ff);
  const fl = freqNum(r, "fflt", "Floating-leg payments");
  if (typeof fl === "string") return finRefusal(fl);
  const kind = ["df", "zcont", "zann"].includes(r("ckind")) ? r("ckind") : "df";
  const c = readCurve(r("curve"), kind);
  if (typeof c === "string") return finRefusal(c);
  const res = swapValue({ notional: N, fixed: fp / 100, spread: sb / 10000, tenor: T, fixedFreq: ff, floatFreq: fl, side, curve: c.curve });
  if ("error" in res) return finRefusal(res.error);
  const money = (x: number): string => fx(x, 2);
  const lines = [
    `${side === "pay" ? "Pay fixed, receive floating (payer swap)" : "Receive fixed, pay floating (receiver swap)"}: notional ${money(N)}, ${yrs(T)}, fixed ${pctIn(fp / 100)} ${timesWord(ff)}, floating ${timesWord(fl)}${sb !== 0 ? ` plus ${fv(sb)} bp` : ""}`,
    `PV of the fixed leg = ${money(res.pvFixed)}; PV of the floating leg = ${money(res.pvFloat)}`,
    `Swap value to this side = ${money(res.value)} (${side === "pay" ? "floating − fixed" : "fixed − floating"})`,
    `Par swap rate = ${pct(res.parRate, 6)} (the fixed rate that makes the value zero${sb !== 0 ? " with this spread" : ""}); fixed-leg annuity Σ τ·D = ${fx(res.annuity, 8)}`,
    `PV01 = ${money(res.pv01)} for a 1 bp rise in the fixed rate (to this side).`,
    ...c.notes,
    `Conventions: spot-starting swap valued on a reset date, payment times on a regular grid of 1/f years, accrual fraction 1/f per period (a 30/360 regular schedule, no business-day adjustment, no stub); ` +
      `one curve for discounting and forwarding (forward F = (D(t₀)/D(t₁) − 1)/τ, floating leg = N·Σ(F + spread)·τ·D(t₁)); ` +
      `discount factors log-linear in time between curve points (piecewise-flat continuous forwards), flat zero rate from today to the first point, no extrapolation past the last point; ` +
      `${kind === "df" ? "curve given as discount factors" : kind === "zcont" ? "zero rates continuously compounded, D = exp(−z·t)" : "zero rates annually compounded, D = (1 + z)⁻ᵗ"}.`,
  ];
  const sign = side === "pay" ? 1 : -1;
  const row = (x: SwapResult["rows"][number]): string[] => [
    fv(x.t, 6),
    fx(x.df, 8),
    x.fixed ? money(x.fixed) : "",
    Number.isFinite(x.forward) ? money(x.float) : "",
    money(sign * (x.float - x.fixed)),
    money(sign * (x.float - x.fixed) * x.df),
  ];
  const all = res.rows;
  const body = all.length <= 80 ? all.map(row) : [...all.slice(0, 60).map(row), ["…", "…", "…", "…", "…", "…"], ...all.slice(-20).map(row)];
  const table: FinTable = {
    label: "Swap cash flows",
    rows: [["Time (years)", "Discount factor", "Fixed payment", "Floating payment", "Net to this side", "PV of net"], ...body, ["Total (swap value)", "", "", "", "", money(res.value)]],
    align: ["right", "right", "right", "right", "right", "right"],
    note: "Floating payments are the forward rates implied by the curve; a blank cell is a date with no payment on that leg." + (all.length > 80 ? ` ${all.length} payment dates: rows 61 to ${all.length - 20} are omitted (the total includes them).` : ""),
  };
  return { text: lines.join("\n"), reading: swapReading(side, fp / 100, res), svg: swapCurveSvg(c.curve, res, fp / 100, T), tables: [table] };
}

/** The swap's value to this side, why (its fixed rate against the par rate), and its sensitivity to the fixed rate. */
export function swapReading(side: "pay" | "receive", fixed: number, res: { value: number; parRate: number; pv01: number }): string {
  const money = (x: number): string => fx(x, 2);
  const who = side === "pay" ? "the fixed-rate payer" : "the fixed-rate receiver";
  const v = money(res.value);
  const rates = `the ${pctIn(fixed)} fixed rate against the ${pct(res.parRate, 6)} par swap rate`;
  const head =
    v === "0.00"
      ? `The swap is worth 0.00 to ${who} today: ${rates} leaves the two legs equal`
      : res.value > 0
        ? `The swap is worth ${v} to ${who} today, an asset, given ${rates}`
        : `The swap is a liability of ${money(-res.value)} to ${who} today, given ${rates}`;
  const p = money(res.pv01);
  const sens = p === "0.00" ? "" : ` Each 1 bp rise in the fixed rate ${res.pv01 > 0 ? "adds" : "takes"} ${money(Math.abs(res.pv01))} ${res.pv01 > 0 ? "to" : "from"} that value.`;
  return `${head}.${sens}`;
}

// ------------------------------------------------------------------------------------------------------------------
// Registry
// ------------------------------------------------------------------------------------------------------------------

const LEGS_DEFAULT = "put, 90, 1, 1.20\nput, 95, -1, 2.50\ncall, 105, -1, 2.60\ncall, 110, 1, 1.10";
const CURVE_DEFAULT = "0.5\t0.9800\n1\t0.9605\n2\t0.9210\n3\t0.8820\n5\t0.8050\n7\t0.7330\n10\t0.6400";
const FREQ_OPTIONS = [
  { value: "1", label: "1 (annual)" },
  { value: "2", label: "2 (semiannual)" },
  { value: "4", label: "4 (quarterly)" },
  { value: "12", label: "12 (monthly)" },
];

export const DERIV_CALCS: FinCalcDef[] = [
  {
    id: "deriv-black76",
    group: "Derivatives",
    name: "Black-76 option on a futures price",
    fields: [
      TYPE_FIELD,
      {
        key: "solve",
        label: "Solve for",
        default: "price",
        kind: "select",
        options: [
          { value: "price", label: "Price and Greeks from volatility" },
          { value: "iv", label: "Implied volatility from price" },
        ],
      },
      { key: "f", label: "Futures price F", default: "620" },
      { key: "k", label: "Strike K", default: "600" },
      { key: "t", label: "Time to expiry (years)", default: "0.4" },
      { key: "r", label: "Risk-free rate (%)", default: "4" },
      { key: "sig", label: "Volatility (%) (price from volatility)", default: "30", optional: true },
      { key: "price", label: "Option price (implied volatility from price)", default: "", optional: true },
    ],
    assumes:
      "European exercise on a futures or forward price that is lognormal with constant volatility; the premium is paid up front and discounted at a constant risk-free rate. " +
      "Futures-style margined options (no discounting) and American futures options are not modelled.",
    compute: (r) => {
      // Black-76 price, Greeks and put–call parity, or the implied volatility from a price
      return black76Calc(r);
    },
  },
  {
    id: "deriv-crr",
    group: "Derivatives",
    name: "Binomial option tree (Cox–Ross–Rubinstein)",
    fields: [
      { ...TYPE_FIELD, default: "put" },
      {
        key: "style",
        label: "Exercise",
        default: "american",
        kind: "select",
        options: [
          { value: "american", label: "American (any time)" },
          { value: "european", label: "European (expiry only)" },
        ],
      },
      { key: "s", label: "Spot price S", default: "50" },
      { key: "k", label: "Strike K", default: "50" },
      { key: "t", label: "Time to expiry (years)", default: "0.4166666667" },
      { key: "r", label: "Risk-free rate (%)", default: "10" },
      { key: "q", label: "Dividend yield q (%)", default: "0" },
      { key: "sig", label: "Volatility (%)", default: "40" },
      { key: "n", label: `Steps n (the tree is drawn for n ≤ ${CRR_FIGURE_STEPS}; at most ${CRR_MAX_STEPS.toLocaleString("en-US")})`, default: "5" },
    ],
    assumes:
      "A recombining CRR tree: lognormal moves of ±σ√Δt each step, constant rate, volatility and continuous dividend yield, no transaction costs; " +
      "discrete cash dividends are not modelled. A finite tree is an approximation: it converges to the continuous-time price as n grows.",
    compute: (r) => {
      // prices the option on a CRR tree, draws the tree for small n, compares with Black–Scholes–Merton
      return crrCalc(r);
    },
  },
  {
    id: "deriv-parity",
    group: "Derivatives",
    name: "Put–call parity check on market prices",
    fields: [
      { key: "c", label: "Call price", default: "10.45" },
      { key: "p", label: "Put price", default: "4.90" },
      { key: "s", label: "Spot price S", default: "100" },
      { key: "k", label: "Strike K", default: "100" },
      { key: "t", label: "Time to expiry (years)", default: "1" },
      { key: "r", label: "Risk-free rate (%)", default: "5" },
      { key: "q", label: "Dividend yield q (%)", default: "0" },
      { key: "cost", label: "Trading cost band per share (optional)", default: "0", optional: true },
    ],
    assumes:
      "European call and put on the same underlying, strike and expiry, quoted at the same moment; borrowing and lending at the risk-free rate; short sales allowed. " +
      "American options satisfy only the parity bounds, not the equality.",
    compute: (r) => {
      // compares C − P with S·exp(−qt) − K·exp(−rt) and names the arbitrage trade when they differ
      return parityCalc(r);
    },
  },
  {
    id: "deriv-carry",
    group: "Derivatives",
    name: "Forward and futures price by cost of carry",
    fields: [
      { key: "s", label: "Spot price S", default: "1800" },
      { key: "t", label: "Time to delivery (years)", default: "0.75" },
      { key: "r", label: "Risk-free rate (%)", default: "4" },
      { key: "q", label: "Income or convenience yield q (%)", default: "0" },
      { key: "u", label: "Storage cost rate u (%)", default: "0.2" },
      { key: "inc", label: "Present value of cash income I (coupons, dividends)", default: "0" },
      { key: "stor", label: "Present value of storage costs U", default: "12" },
      { key: "mkt", label: "Market futures price (optional)", default: "1890", optional: true },
      { key: "deliv", label: "Delivery price of an existing long forward (optional)", default: "", optional: true },
    ],
    assumes:
      "No-arbitrage carry with borrowing and lending at one risk-free rate, no transaction costs or margin, and known income and storage costs. " +
      "Futures are priced as forwards (deterministic rates).",
    compute: (r) => {
      // fair forward price from spot plus net carry, the arbitrage against a market price, and an existing forward's value
      return carryCalc(r);
    },
  },
  {
    id: "deriv-strategy",
    group: "Derivatives",
    name: "Option strategy payoff at expiry (multi-leg)",
    fields: [
      {
        key: "legs",
        label: "Legs, one per line: type (call, put or stock), strike (or stock price), quantity (+ long, − short), premium per unit",
        default: LEGS_DEFAULT,
        kind: "block",
      },
      { key: "mult", label: "Contract multiplier (every quantity, stock too, is in lots of this many units)", default: "1" },
    ],
    assumes:
      "Every leg held to the same expiry and settled at its intrinsic value; no early exercise or assignment, interest on premiums, margin or commissions. " +
      "The default legs (an iron condor) are illustrative numbers, not market prices.",
    compute: (r) => {
      // profit at expiry, breakevens, maximum profit and loss of the legs combined
      return strategyCalc(r);
    },
  },
  {
    id: "deriv-swap",
    group: "Derivatives",
    name: "Interest-rate swap value on a discount curve",
    fields: [
      {
        key: "side",
        label: "Position",
        default: "pay",
        kind: "select",
        options: [
          { value: "pay", label: "Pay fixed, receive floating (payer)" },
          { value: "receive", label: "Receive fixed, pay floating (receiver)" },
        ],
      },
      { key: "notional", label: "Notional", default: "10,000,000" },
      { key: "fixed", label: "Fixed rate (%)", default: "4.2" },
      { key: "spread", label: "Floating spread (bp)", default: "0" },
      { key: "tenor", label: "Swap tenor (years)", default: "5" },
      { key: "ffix", label: "Fixed-leg payments per year", default: "2", kind: "select", options: FREQ_OPTIONS },
      { key: "fflt", label: "Floating-leg payments per year", default: "4", kind: "select", options: FREQ_OPTIONS },
      {
        key: "ckind",
        label: "Curve values are",
        default: "df",
        kind: "select",
        options: [
          { value: "df", label: "Discount factors" },
          { value: "zcont", label: "Zero rates (%), continuously compounded" },
          { value: "zann", label: "Zero rates (%), annually compounded" },
        ],
      },
      { key: "curve", label: "Curve, one point per line: tenor (years), value (illustrative numbers by default)", default: CURVE_DEFAULT, kind: "block" },
    ],
    assumes:
      "A plain-vanilla, spot-starting swap with no credit or funding adjustment, valued on one curve for discounting and forwarding (single-curve, pre-OIS style). " +
      "Seasoned swaps with a fixing already set, stubs, business-day calendars and separate OIS discounting are not modelled. The default curve is illustrative, not market data.",
    compute: (r) => {
      // values both legs off the pasted curve, with the par rate, PV01 and the cash-flow schedule
      return swapCalc(r);
    },
  },
];
