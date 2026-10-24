/**
 * Finance number formatters and figures (moved from taskpane.ts in v2.144.0,
 * docs/SCOPE-HOST-ADAPTER.md §E, so they can be imported by tests instead of
 * sliced out of the pane's source text). The bodies are unchanged.
 */
import { buildPlotSvg, Point, Series, PlotOptions } from "./plot";
import { blackScholes, bondPrice, OptionType } from "./finance";
import { ladderSvg, LadderRow } from "./mechchart";

/**
 * A FIGURE-STYLE RE-RENDER FOR FINANCE (fix2-paf). Finance figures had no
 * re-render, so a journal or USPTO style could only scale the colour figure as
 * drawn — and USPTO refused every one of them. The pane re-runs a calculator
 * inside withFinFig({ width, bw }), and every Finance figure builder draws at
 * that canvas width (height in proportion) and, for USPTO, in black and white.
 */
export interface FinFig {
  width: number;
  bw: boolean;
}
let finFig: FinFig | null = null;

/** Runs `fn` with every Finance figure drawn at `fig`'s width and colour mode. */
export function withFinFig<T>(fig: FinFig, fn: () => T): T {
  const prev = finFig;
  finFig = fig;
  try {
    return fn();
  } finally {
    finFig = prev;
  }
}

/** buildPlotSvg under the current Finance figure style (unchanged outside withFinFig). */
export function finPlotSvg(series: Series[], opts: PlotOptions): string {
  if (!finFig) return buildPlotSvg(series, opts);
  const w0 = opts.width ?? 380;
  const h0 = opts.height ?? 270;
  return buildPlotSvg(series, { ...opts, width: finFig.width, height: Math.round((h0 * finFig.width) / w0), bw: finFig.bw });
}

/** The current Finance figure style, for builders outside plot.ts (the ladder). */
export function currentFinFig(): FinFig | null {
  return finFig;
}

/** A formatted number's leading hyphen as a true minus, and a negative zero ("-0.00", "-0.00%") as plain zero. */
function trueMinusFixed(s: string): string {
  if (/^-0(?:[.,]0*)?%?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}

export function finMoney(x: number): string {
  if (!Number.isFinite(x)) return "—";
  // True minus (v2.193.0): a negative NPV printed "-1,234.56" with an ASCII hyphen.
  return trueMinusFixed(x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
export function finPct(x: number): string {
  // Same non-finite guard as finMoney. Without it, a constant return series
  // (sharpeRatio divides by a zero standard deviation) rendered "NaN%", and the
  // insertability gate below only blocked on the em dash — so "Sharpe ratio NaN"
  // went into the user's document as though it were a number.
  if (!Number.isFinite(x)) return "—";
  return trueMinusFixed((x * 100).toFixed(2) + "%");
}
/** Fixed-decimal formatting that cannot emit "NaN" or "Infinity". */
export function finFixed(x: number, dp: number): string {
  if (!Number.isFinite(x)) return "—";
  // A true minus (v2.193.0: "Theta -0.0176 per day" had an ASCII hyphen), and no "−0.0000" for a value that rounds
  // to zero.
  return trueMinusFixed(x.toFixed(dp));
}

/**
 * A money-over-time curve: one point per period, drawn from a closed-form
 * valuation the caller supplies.
 *
 * WHY A HELPER. Six Finance calculators answer "what is this worth after n
 * periods", and the picture that makes each of them useful is the same one —
 * the path, not just the endpoint. Compounding is the case in point: "Amount =
 * 1,647" gives no sense that the curve bends, and the bend is the entire
 * subject. A shared builder also means these six cannot drift into drawing the
 * same idea six slightly different ways.
 *
 * THE PERIOD COUNT IS A USER NUMBER, so it is clamped. A pane that recomputes
 * on every keystroke and is asked for 1e9 periods is a frozen Word, not a slow
 * chart; and past a couple of hundred points the curve gains nothing a reader
 * can see. `valueAt` is called per point rather than the result being scaled,
 * so the curve is the engine's own arithmetic at every step.
 */
export function moneyOverTimeSvg(o: {
  periods: number;
  valueAt: (k: number) => number;
  title: string;
  xlabel: string;
  ylabel?: string;
  label?: string;
}): string | undefined {
  // THE EXACT FINAL PERIOD, NOT ITS FLOOR. Flooring meant the curve stopped
  // short of the printed answer whenever the horizon was fractional — and on
  // straight-line depreciation over 7.5 years it stopped at a book value of
  // 1,600 directly beneath a sentence saying the book value reaches salvage at
  // the end of the useful life. The figure denied the prose beside it.
  const end = o.periods;
  if (!Number.isFinite(end) || !(end > 0)) return undefined;
  const CAP = 200;
  const whole = Math.floor(end);
  const stride = Math.max(1, Math.ceil(whole / Math.min(Math.max(whole, 1), CAP)));
  const pts: Point[] = [];
  for (let k = 0; k <= whole; k += stride) {
    const y = o.valueAt(k);
    if (Number.isFinite(y)) pts.push({ x: k, y });
  }
  // Land on the real end, whether or not it is a whole period.
  if (!pts.length || pts[pts.length - 1].x !== end) {
    const y = o.valueAt(end);
    if (Number.isFinite(y)) pts.push({ x: end, y });
  }
  if (pts.length < 2) return undefined;
  return finPlotSvg(
    [{ points: pts, type: "line", color: "#2563eb", label: o.label ?? "value" }],
    {
      width: 360,
      height: 240,
      title: o.title,
      xlabel: o.xlabel,
      ylabel: o.ylabel ?? "amount",
    },
  );
}

/**
 * A discounted cash-flow ledger: what each flow contributes in today's money,
 * with the resulting total as the last bar.
 *
 * THE DISCOUNTED BARS, NOT THE RAW FLOWS. The raw numbers are already on the
 * user's screen — they typed them. What the calculation adds is how much each
 * one is actually WORTH once discounting is applied, and the shrinking of the
 * later bars is the finding: a project carried by year-eight cash is a very
 * different proposition from one carried by year-one cash, and both can share
 * an NPV.
 *
 * `ladderSvg` keeps the result row whatever the row cap does, so the bottom
 * line of the ledger can never be the thing that gets sliced off.
 */
export function cashFlowLadderSvg(
  flows: number[],
  discounted: number[],
  title: string,
  opts: { resultLabel?: string; firstPeriod?: number } = {},
): string | undefined {
  if (!flows.length || flows.length !== discounted.length) return undefined;
  if (!discounted.every((v) => Number.isFinite(v))) return undefined;
  const total = discounted.reduce((a, v) => a + v, 0);
  if (!Number.isFinite(total)) return undefined;

  // THE FIRST PERIOD IS A PARAMETER, because it is not the same for every
  // caller. NPV and IRR take `cf[0]` as the t=0 flow; DCF's own field says
  // "Cash flows (t=1 first)" and its engine discounts flow k at exponent k+1.
  // Hardcoding `t=${k}` labelled every DCF bar one period early — the figure
  // agreed with the arithmetic and lied about the dates.
  const t0 = opts.firstPeriod ?? 0;

  // AND THE ROWS ARE CAPPED HERE, VISIBLY, rather than left to ladderSvg's
  // silent slice at ten. That cap drops the tenth flow onward with no ellipsis
  // and no note, while the total keeps summing all of them — so an eleven-flow
  // project drew nine bars ending at -105 above a total bar sitting at zero.
  // A waterfall whose bars do not reach its own total is worse than no
  // waterfall: it looks like an arithmetic error in the product.
  const ROOM = 8;
  const rows: LadderRow[] = [];
  if (discounted.length <= ROOM + 1) {
    discounted.forEach((v, k) => rows.push({ name: `t=${t0 + k}`, delta: v, gain: v >= 0 }));
  } else {
    discounted.slice(0, ROOM).forEach((v, k) => rows.push({ name: `t=${t0 + k}`, delta: v, gain: v >= 0 }));
    const restFrom = t0 + ROOM;
    const restTo = t0 + discounted.length - 1;
    const rest = discounted.slice(ROOM).reduce((a, v) => a + v, 0);
    rows.push({ name: `t=${restFrom}..${restTo}`, delta: rest, gain: rest >= 0 });
  }
  rows.push({
    name: opts.resultLabel ?? "total",
    delta: total,
    gain: total >= 0,
    result: true,
  });
  // DECIMALS FOLLOW THE SCALE (fix2-paf). A project whose discounted flows are
  // a few thousandths labelled all five ticks "0.00". Two decimals stay the
  // floor (money); a tiny span gets as many as its tick step needs.
  let run = 0;
  const edges = [0, total];
  for (const r of rows) if (!r.result) edges.push((run += r.delta));
  const span = Math.max(...edges) - Math.min(...edges);
  const dp = span > 0 && Number.isFinite(span) ? Math.min(10, Math.max(2, Math.ceil(-Math.log10(span / 5)) + 1)) : 2;
  const fmt = (v: number): string =>
    !Number.isFinite(v)
      ? "—"
      : trueMinusFixed(v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const fig = currentFinFig();
  return ladderSvg(rows, { title, axisLabel: "present value", fmt, ...(fig ? { width: fig.width, bw: fig.bw } : {}) });
}

/**
 * Price against yield — the curve every bond calculator is really about.
 *
 * A price is one point on it, and the point tells you nothing about the two
 * things that matter: that the relationship is INVERSE (a fact people
 * reliably get backwards) and that it is CONVEX, so a fall in yield helps more
 * than the same rise hurts. Duration and convexity are numerical summaries of
 * this shape; drawing it makes them legible.
 *
 * The yield window is a fixed span around the quoted yield rather than
 * anything derived from an unbounded user number, and the engine is re-called
 * per point rather than the price being scaled by an approximation.
 */
export function bondPriceCurveSvg(o: {
  face: number;
  coupon: number;
  ytm: number;
  years: number;
  freq: number;
  price: number;
}): string | undefined {
  if (![o.face, o.coupon, o.ytm, o.years, o.freq, o.price].every(Number.isFinite)) return undefined;
  // WHOLE COUPON PERIODS, because `bondPrice` refuses a partial one and returns
  // NaN. `bondYTM` already rounds internally, so a 10.25-year bond solved
  // against 10.5 years produced a perfectly good yield and then a curve of
  // sixty NaNs — no figure at all, and nothing said why.
  const years = o.freq > 0 ? Math.round(o.years * o.freq) / o.freq : o.years;
  // THE WINDOW IS CENTRED ON THE QUOTED YIELD AND NOT CLAMPED AT ZERO. Clamping
  // `lo` while leaving the marked point at the real yield put the point outside
  // the curve entirely for a negative-yielding bond, which is an ordinary
  // instrument rather than a corner case.
  const lo = o.ytm - 0.05;
  const hi = o.ytm + 0.05;
  const pts: Point[] = [];
  for (let k = 0; k <= 60; k++) {
    const y = lo + ((hi - lo) * k) / 60;
    const v = bondPrice(o.face, o.coupon, y, years, o.freq);
    if (Number.isFinite(v)) pts.push({ x: y * 100, y: v });
  }
  if (pts.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: pts, type: "line", color: "#2563eb", label: "price" },
      { points: [{ x: o.ytm * 100, y: o.price }], type: "scatter", color: "#b91c1c", label: "this bond" },
    ],
    { width: 360, height: 240, title: "Price against yield", xlabel: "yield to maturity (%)", ylabel: "price" },
  );
}

/**
 * Option value against the underlying price, with the position marked.
 *
 * A Black-Scholes price is one point on a curve whose SHAPE is the whole
 * subject: how far the option is from the money, how much of its value is
 * intrinsic versus time value, and how sharply the payoff turns. The intrinsic
 * line is drawn alongside so the gap between the two IS the time value — the
 * quantity people ask about and no single number shows.
 *
 * The spot window is a fixed proportion of the strike, so no user number
 * becomes a loop bound, and the engine is re-called per point.
 */
export function optionCurveSvg(o: {
  type: OptionType;
  s: number;
  k: number;
  t: number;
  r: number;
  sig: number;
  price: number;
}): string | undefined {
  if (![o.s, o.k, o.t, o.r, o.sig, o.price].every(Number.isFinite) || !(o.k > 0)) return undefined;
  // Covers the strike AND the spot (fix2-paf): a fixed 0.5K–1.5K window left
  // a deep in-the-money position (S = 300, K = 100) off the chart.
  const lo = 0.5 * Math.min(o.k, o.s > 0 ? o.s : o.k);
  const hi = 1.5 * Math.max(o.k, o.s > 0 ? o.s : o.k);
  const value: Point[] = [];
  const intrinsic: Point[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = lo + ((hi - lo) * i) / 60;
    const v = blackScholes(o.type, x, o.k, o.t, o.r, o.sig);
    if (Number.isFinite(v)) value.push({ x, y: v });
    intrinsic.push({ x, y: o.type === "call" ? Math.max(0, x - o.k) : Math.max(0, o.k - x) });
  }
  if (value.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: value, type: "line", color: "#2563eb", label: "option value" },
      { points: intrinsic, type: "line", color: "#6b7280", label: "intrinsic" },
      { points: [{ x: o.s, y: o.price }], type: "scatter", color: "#b91c1c", label: "this option" },
    ],
    { width: 380, height: 250, title: "Value against the underlying", xlabel: "spot price", ylabel: "option value" },
  );
}
