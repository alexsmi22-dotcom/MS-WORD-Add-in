/**
 * MACRS depreciation from IRS Publication 946 Appendix A (release F1, gap item #9). The rates used are the bundled
 * published percentages (macrsTables.ts); every column is also re-derived here from the method, in exact rational
 * arithmetic, so the result can say whether the table and the method agree for the column it used.
 *
 * The method, as the published tables are built (verified cell by cell against every column of Tables A-1 to A-5
 * and A-8 to A-12; see macrs.test.ts and scripts/sched-oracle.py):
 *   year 1:  r₁ = round(100 × d × f₁), d = the declining-balance rate (2/L, 1.5/L, or 1/L for straight line),
 *            f₁ = the first-year fraction (half-year ½; mid-quarter 10.5/12, 7.5/12, 4.5/12, 1.5/12 for quarters 1–4);
 *   year k:  with R the unrecovered percentage (100 minus the ROUNDED rates so far) and Y = L − f₁ − (k − 2) the
 *            recovery years left, r_k = round(max(R × d, R / Y)) while Y > 1, and r_k = R in the last year;
 *   rounding half-up to the column's printed decimals (2, or 3 in the 20-year and longer straight-line columns).
 *
 * Pure: no Office.js, no DOM.
 */
import { PUB946_GDS, PUB946_SL } from "./macrsTables";

export const PUB946_SOURCE = "IRS Publication 946 (2025), How To Depreciate Property, Appendix A";

export type MacrsConvention = "hy" | "q1" | "q2" | "q3" | "q4";
export type MacrsMethod = "gds" | "sl";

export const MACRS_GDS_CLASSES = [3, 5, 7, 10, 15, 20] as const;

/** The straight-line recovery periods printed in Tables A-8 to A-12 (years). */
export const MACRS_SL_PERIODS: readonly string[] = Object.keys(PUB946_SL["A-8"]).sort((a, b) => Number(a) - Number(b));

/** The Pub 946 table for a method and convention. */
export function pub946Table(method: MacrsMethod, conv: MacrsConvention): string {
  const i = ["hy", "q1", "q2", "q3", "q4"].indexOf(conv);
  return method === "gds" ? `A-${1 + i}` : `A-${8 + i}`;
}

/**
 * Cells where the published table and the method (rounded as above) differ. The GDS pairs are in the printed table
 * itself (each pair offsets within its column, so the column still totals 100%); the straight-line runs each start at
 * an exact rounding tie (for example 63.15/6 = 10.525 in the 9.5-year column) that the IRS rounded down and the
 * method's half-up rounds up, after which the alternation runs the other way. The published values are used.
 */
export const PUB946_KNOWN_DEVIATIONS: { table: string; period: string; years: number[]; why: string }[] = [
  { table: "A-2", period: "20", years: [2, 21], why: "year 2 is printed 7.000% where the method gives 7.008% (93.437% × 7.5%); year 21 (0.565% against 0.557%) absorbs the difference" },
  { table: "A-3", period: "7", years: [1, 8], why: "year 1 is printed 17.85% where the method gives 17.857…%, which rounds to 17.86%; year 8 (3.34% against 3.33%) absorbs the difference" },
  { table: "A-8", period: "9.5", years: [5, 6, 7, 8, 9, 10], why: "year 5 is an exact tie (63.15% / 6 = 10.525%) printed 10.52%; the alternation after it runs the other way" },
  { table: "A-8", period: "16.5", years: [16, 17], why: "year 16 is an exact rounding tie printed rounded down" },
  { table: "A-8", period: "26.5", years: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27], why: "year 14 is an exact rounding tie printed rounded down; the alternation after it runs the other way" },
];

// ---------------------------------------------------------------------------------------------------------------
// Exact rationals (bigint), enough for the method
// ---------------------------------------------------------------------------------------------------------------

type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const q = (n: bigint, d: bigint = 1n): Q => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const qadd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qsub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const qdiv = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
const qcmp = (a: Q, b: Q): number => {
  const x = a.n * b.d - b.n * a.d;
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};
/** A decimal string such as "26.5" or "7.219" as an exact rational. */
function qdec(s: string): Q {
  const [i, f = ""] = s.split(".");
  return q(BigInt(i + f), 10n ** BigInt(f.length));
}
/** Half-up rounding of a non-negative rational to dp decimals. */
function qround(x: Q, dp: number): Q {
  const s = 10n ** BigInt(dp);
  return q((2n * x.n * s + x.d) / (2n * x.d), s);
}
function qstr(x: Q, dp: number): string {
  const s = 10n ** BigInt(dp);
  const v = (x.n * s) / x.d;
  const i = v / s;
  const f = (v % s).toString().padStart(dp, "0");
  return dp ? `${i}.${f}` : `${i}`;
}

const FIRST_YEAR: Record<MacrsConvention, Q> = { hy: q(1n, 2n), q1: q(21n, 24n), q2: q(15n, 24n), q3: q(9n, 24n), q4: q(3n, 24n) };

/**
 * The method's rates (percent, as decimal strings with `dp` decimals) for a recovery period L (a decimal string, e.g.
 * "7" or "26.5"), a declining-balance multiple ("2", "1.5", or "1" for straight line) and a convention.
 */
export function macrsMethodRates(L: string, multiple: string, conv: MacrsConvention, dp: number): string[] {
  const Lq = qdec(L);
  const rate = qdiv(qdec(multiple), Lq);
  const f1 = FIRST_YEAR[conv];
  let rem = q(100n);
  const out: string[] = [];
  for (let k = 1; k <= 60 && qcmp(rem, q(0n)) > 0; k++) {
    let r: Q;
    if (k === 1) r = qround(qmul(qmul(rem, rate), f1), dp);
    else {
      const left = qsub(qsub(Lq, f1), q(BigInt(k - 2)));
      if (qcmp(left, q(1n)) <= 0) r = rem;
      else {
        const db = qmul(rem, rate);
        const sl = qdiv(rem, left);
        r = qround(qcmp(db, sl) >= 0 ? db : sl, dp);
      }
    }
    if (qcmp(r, rem) > 0) r = rem;
    out.push(qstr(r, dp));
    rem = qsub(rem, r);
  }
  return out;
}

export interface MacrsRates {
  table: string;
  period: string;
  /** "200% declining balance", "150% declining balance" or "straight line". */
  methodName: string;
  multiple: string;
  /** Published rates (percent strings) by recovery year. */
  published: string[];
  /** The method's rates rounded as the table prints them. */
  method: string[];
  /** Recovery years where the two differ (1-based). */
  differ: number[];
  deviation?: { years: number[]; why: string };
}

/** The bundled rates for a method, period and convention, with the method's own re-derivation beside them. */
export function macrsRates(method: MacrsMethod, period: string, conv: MacrsConvention): MacrsRates | { error: string } {
  const table = pub946Table(method, conv);
  const col = (method === "gds" ? PUB946_GDS : PUB946_SL)[table]?.[period];
  if (!col) {
    return {
      error:
        method === "gds"
          ? `GDS property class must be 3, 5, 7, 10, 15 or 20 years (got ${period || "nothing"}).`
          : `Recovery period ${period || "(blank)"} years is not one Pub 946 Tables A-8 to A-12 print; use one of ${MACRS_SL_PERIODS.join(", ")}.`,
    };
  }
  const published = col.split(" ");
  const dp = Math.max(...published.map((s) => (s.split(".")[1] ?? "").length));
  const multiple = method === "sl" ? "1" : Number(period) >= 15 ? "1.5" : "2";
  const m = macrsMethodRates(period, multiple, conv, dp);
  const differ: number[] = [];
  for (let k = 0; k < Math.max(m.length, published.length); k++) {
    const a = published[k] ?? "0";
    const b = m[k] ?? "0";
    if (qcmp(qdec(a), qdec(b)) !== 0) differ.push(k + 1);
  }
  const dev = PUB946_KNOWN_DEVIATIONS.find((d) => d.table === table && d.period === period);
  return {
    table,
    period,
    methodName: multiple === "2" ? "200% declining balance" : multiple === "1.5" ? "150% declining balance" : "straight line",
    multiple,
    published,
    method: m,
    differ,
    deviation: dev ? { years: dev.years, why: dev.why } : undefined,
  };
}

export interface MacrsRow {
  year: number;
  rate: number;
  depreciation: number;
  accumulated: number;
  remaining: number;
}

/** Basis × published rate for each recovery year (the Pub 946 table method: the rates total exactly 100%). */
export function macrsSchedule(basis: number, rates: string[]): MacrsRow[] {
  const rows: MacrsRow[] = [];
  let accQ = q(0n);
  rates.forEach((s, i) => {
    accQ = qadd(accQ, qdec(s));
    const accumulated = qcmp(accQ, q(100n)) === 0 ? basis : (basis * Number(accQ.n)) / Number(accQ.d) / 100;
    const prev = i ? rows[i - 1].accumulated : 0;
    rows.push({ year: i + 1, rate: Number(s), depreciation: accumulated - prev, accumulated, remaining: basis - accumulated });
  });
  return rows;
}
