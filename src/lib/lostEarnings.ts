/**
 * Present value of lost earnings, year by year (Release E1a).
 *
 * Arithmetic on the user's inputs only: the base, the growth and discount rates, the horizon, the personal-
 * consumption and fringe percentages are all typed by the user. Nothing here is a legal conclusion.
 *
 * CONVENTIONS (printed in every result's notes):
 *  - Year 1 earns the annual base; year t earns base × (1 + growth)^(t − 1).
 *  - Net loss = earnings × (1 + fringe) × (1 − personal consumption).
 *  - A fractional final year (a horizon of 10.5 years) earns that fraction of its year's earnings.
 *  - Discounting is end-of-year by default: year t is discounted over (t − 1) + its fraction of a year; with
 *    mid-year discounting, over (t − 1) + half its fraction.
 *  - Each year's amounts are rounded to the cent; totals are sums of the rounded rows.
 */
import { finFixed, finMoney, finPlotSvg } from "./financeFigures";
import { MAX_AMOUNT, moneyCents, toCents, type DamagesReport } from "./damagesInterest";

/** Longest horizon accepted, in years. */
export const MAX_YEARS = 100;

export interface LostEarningsInput {
  /** Year-1 annual earnings. */
  base: number;
  /** Annual growth, decimal. */
  growth: number;
  /** Annual discount rate, decimal. */
  discount: number;
  /** Years of loss (may be fractional). */
  years: number;
  /** Age at the start of year 1 (for the table only). */
  startAge: number;
  /** Personal consumption, decimal of net earnings. */
  consumption: number;
  /** Fringe benefits, decimal added to earnings. */
  fringe: number;
  midYear: boolean;
}

export interface LostEarningsYear {
  year: number;
  age: number;
  /** Share of the year that is lost (1, or the fraction of a final partial year). */
  fraction: number;
  earningsCents: number;
  netCents: number;
  discountFactor: number;
  pvCents: number;
}

export interface LostEarningsResult {
  rows: LostEarningsYear[];
  totalEarningsCents: number;
  totalNetCents: number;
  totalPvCents: number;
}

/** The year-by-year schedule, or a named refusal. */
export function lostEarnings(o: LostEarningsInput): LostEarningsResult | { error: string } {
  if (!(o.base >= 0)) return { error: "Annual earnings must be zero or positive." };
  if (o.base > MAX_AMOUNT) return { error: `Annual earnings above ${finMoney(MAX_AMOUNT)} are outside this calculator.` };
  if (!(o.growth > -1) || o.growth > 10) return { error: "Growth must be above −100% and at most 1,000% a year." };
  if (!(o.discount > -1) || o.discount > 10) return { error: "The discount rate must be above −100% and at most 1,000% a year." };
  if (!(o.years > 0)) return { error: "The years of loss must be positive (an end age above the starting age)." };
  if (o.years > MAX_YEARS) return { error: `More than ${MAX_YEARS} years of loss is outside this calculator.` };
  if (!(o.startAge >= 0) || o.startAge > 120) return { error: "The starting age must be between 0 and 120." };
  if (!(o.consumption >= 0) || o.consumption > 1) return { error: "Personal consumption must be between 0% and 100%." };
  if (!(o.fringe >= 0) || o.fringe > 10) return { error: "Fringe benefits must be between 0% and 1,000%." };
  const rows: LostEarningsYear[] = [];
  let te = 0;
  let tn = 0;
  let tp = 0;
  const n = Math.ceil(o.years - 1e-9);
  for (let t = 1; t <= n; t++) {
    const fraction = Math.min(1, o.years - (t - 1));
    const earnings = o.base * Math.pow(1 + o.growth, t - 1) * fraction;
    const net = earnings * (1 + o.fringe) * (1 - o.consumption);
    const tau = t - 1 + (o.midYear ? fraction / 2 : fraction);
    const df = Math.pow(1 + o.discount, -tau);
    const row: LostEarningsYear = {
      year: t,
      age: o.startAge + t - 1,
      fraction,
      earningsCents: toCents(earnings),
      netCents: toCents(net),
      discountFactor: df,
      pvCents: toCents(net * df),
    };
    if (![row.earningsCents, row.netCents, row.pvCents, df].every(Number.isFinite)) {
      return { error: "These inputs grow past what this calculator can carry; lower the growth rate or the horizon." };
    }
    rows.push(row);
    te += row.earningsCents;
    tn += row.netCents;
    tp += row.pvCents;
  }
  return { rows, totalEarningsCents: te, totalNetCents: tn, totalPvCents: tp };
}

const money = moneyCents;
const pct = (x: number): string => `${finFixed(x * 100, 2).replace(/\.?0+$/, "")}%`;
const num = (x: number): string => (Number.isInteger(x) ? String(x) : finFixed(x, 2));

/** The whole lost-earnings calculation from the pane's (already numeric) fields. */
export function lostEarningsReport(f: {
  base: number;
  growthPct: number;
  discountPct: number;
  horizonMode: string;
  horizon: number;
  startAge: number;
  consumptionPct: number;
  fringePct: number;
  midYear: string;
}): DamagesReport {
  const refuse = (text: string): DamagesReport => ({ ok: false, text });
  const values = [f.base, f.growthPct, f.discountPct, f.horizon, f.startAge, f.consumptionPct, f.fringePct];
  if (!values.every(Number.isFinite)) return refuse("Enter every value as a number.");
  const byAge = f.horizonMode === "age";
  if (byAge && !(f.horizon > f.startAge)) return refuse(`The end age (${num(f.horizon)}) must be above the starting age (${num(f.startAge)}).`);
  const years = byAge ? f.horizon - f.startAge : f.horizon;
  const input: LostEarningsInput = {
    base: f.base,
    growth: f.growthPct / 100,
    discount: f.discountPct / 100,
    years,
    startAge: f.startAge,
    consumption: f.consumptionPct / 100,
    fringe: f.fringePct / 100,
    midYear: f.midYear === "on",
  };
  const res = lostEarnings(input);
  if ("error" in res) return refuse(res.error);
  const rows: string[][] = [["Year", "Age", "Earnings", "Net loss", "Discount factor", "Present value"]];
  for (const r of res.rows) {
    rows.push([
      r.fraction < 1 ? `${r.year} (${finFixed(r.fraction, 2)} yr)` : String(r.year),
      num(r.age),
      money(r.earningsCents),
      money(r.netCents),
      finFixed(r.discountFactor, 6),
      money(r.pvCents),
    ]);
  }
  rows.push(["Total", "", money(res.totalEarningsCents), money(res.totalNetCents), "", money(res.totalPvCents)]);
  const text = [
    "Present value of lost earnings, computed from the inputs given",
    `Present value ${money(res.totalPvCents)} (net loss before discounting ${money(res.totalNetCents)})`,
    `${num(years)} year${years === 1 ? "" : "s"} from age ${num(f.startAge)}; earnings ${money(toCents(f.base))} in year 1, growth ${pct(input.growth)}, discount ${pct(
      input.discount,
    )}, fringe ${pct(input.fringe)}, personal consumption ${pct(input.consumption)}.`,
    "Note: year t earns the base × (1 + growth)^(t − 1); net loss = earnings × (1 + fringe) × (1 − personal consumption).",
    input.midYear
      ? "Note: mid-year discounting: year t is discounted over t − 0.5 years (a partial final year over its midpoint)."
      : "Note: end-of-year discounting: year t is discounted over t years (a partial final year over its end).",
    ...(res.rows.some((r) => r.fraction < 1) ? ["Note: the final partial year earns that fraction of a year's earnings."] : []),
    "Note: each year's amounts are rounded to the cent; totals are sums of the rounded rows.",
  ].join("\n");
  const svg = finPlotSvg(
    [
      { points: res.rows.map((r) => ({ x: r.year, y: r.netCents / 100 })), type: "line", color: "#b45309", label: "net loss" },
      { points: res.rows.map((r) => ({ x: r.year, y: r.pvCents / 100 })), type: "line", color: "#2563eb", label: "present value" },
    ],
    { width: 380, height: 250, title: "Lost earnings by year (from the inputs given)", xlabel: "year of loss", ylabel: "amount" },
  );
  return { ok: true, text, table: { label: "Lost earnings by year", rows }, svg: res.rows.length >= 2 ? svg : undefined };
}
