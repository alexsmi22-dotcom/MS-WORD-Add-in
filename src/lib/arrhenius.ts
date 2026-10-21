// Stability and shelf life by Arrhenius (gap item 5, docs/SCOPE-ENGINEERING-2026-10.md): rate constants at several
// temperatures — given, or fitted from assay-versus-time data at each temperature — give the activation energy and
// the rate at the storage temperature, and with it the shelf life (time to 90 % of label claim, t90). Intervals are
// the regression's own (Student t on n − 2 degrees of freedom), and the shelf life is also quoted at the 95 % upper
// bound of the rate, which is the conservative figure a stability section states.
//
// Pure: no Office.js.

import { tCritical } from "./stats";

export const R_GAS = 8.314462618; // J mol⁻¹ K⁻¹ (CODATA 2018, exact)
export const ARRHENIUS_SOURCE = "k = A·exp(−Ea/RT), R = 8.314462618 J mol⁻¹ K⁻¹ (CODATA 2018); first order t90 = ln(10/9)/k, zero order t90 = 10 %/k₀.";

export type Order = "first" | "zero";

export interface RatePoint {
  /** Temperature, °C. */
  tC: number;
  k: number;
  /** For a fitted k: the points it came from, and its own r². */
  from?: { n: number; r2: number; c0: number };
}

export interface LinFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  /** Residual standard deviation. */
  s: number;
  sxx: number;
  xbar: number;
}

export function linFit(xs: number[], ys: number[]): LinFit {
  const n = xs.length;
  const xbar = xs.reduce((a, b) => a + b, 0) / n, ybar = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - xbar) ** 2;
    sxy += (xs[i] - xbar) * (ys[i] - ybar);
    syy += (ys[i] - ybar) ** 2;
  }
  const slope = sxy / sxx, intercept = ybar - slope * xbar;
  const sse = Math.max(0, syy - slope * sxy);
  return { slope, intercept, r2: syy > 0 ? 1 - sse / syy : 1, n, s: n > 2 ? Math.sqrt(sse / (n - 2)) : NaN, sxx, xbar };
}

/** k from assay (% of initial or label claim) against time: first order fits ln C, zero order fits C. */
export function fitRate(series: Array<[number, number]>, order: Order): { k: number; r2: number; n: number; c0: number } | string {
  const pts = series.filter(([t, c]) => Number.isFinite(t) && Number.isFinite(c));
  if (pts.length < 2) return "at least two time points";
  if (order === "first" && pts.some(([, c]) => !(c > 0))) return "first order needs every assay value above zero";
  if (new Set(pts.map(([t]) => t)).size < 2) return "the times must differ";
  const f = linFit(pts.map(([t]) => t), pts.map(([, c]) => (order === "first" ? Math.log(c) : c)));
  const k = -f.slope;
  if (!(k > 0)) return "the assay does not fall with time (no degradation to fit)";
  // The starting assay the line implies (what zero-order t90 counts 10 % of).
  const c0 = order === "first" ? Math.exp(f.intercept) : f.intercept;
  return { k, r2: f.r2, n: pts.length, c0 };
}

export interface ArrheniusResult {
  ok: true;
  points: RatePoint[];
  order: Order;
  /** Activation energy, kJ/mol, with its 95 % interval (null with only two temperatures). */
  EaKJ: number;
  EaCI: [number, number] | null;
  lnA: number;
  r2: number;
  /** At the storage temperature: k, its 95 % upper bound (null with two temperatures), and t90 at both. */
  storage: { tC: number; k: number; kUpper: number | null; t90: number; t90Lower: number | null };
  fit: LinFit;
  notes: string[];
}

/** t90 for a rate constant: first order ln(10/9)/k; zero order 0.1·C0/k (C0 the starting assay, 100 when in %). */
export const t90 = (k: number, order: Order, c0 = 100): number => (order === "first" ? Math.log(10 / 9) / k : (0.1 * c0) / k);

export function arrhenius(points: RatePoint[], storageC: number, order: Order): ArrheniusResult | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const pts = points.filter((p) => Number.isFinite(p.tC) && Number.isFinite(p.k));
  if (pts.length < 2) errors.push("At least two temperatures are needed for an Arrhenius fit.");
  if (pts.some((p) => !(p.k > 0))) errors.push("Every rate constant must be above zero.");
  if (pts.some((p) => p.tC <= -273.15)) errors.push("A temperature at or below absolute zero.");
  if (new Set(pts.map((p) => p.tC)).size < 2) errors.push("The temperatures must differ.");
  if (!Number.isFinite(storageC) || storageC <= -273.15) errors.push("Give the storage temperature in °C (e.g. 25).");
  // Stability temperatures in °C run up to about 100: every one above 200 is kelvin typed as °C.
  if (pts.length && pts.every((p) => p.tC > 200)) errors.push(`The temperatures (${pts.map((p) => p.tC).join(", ")}) look like kelvin: give them in °C (subtract 273.15). (A study really run above 200 °C is outside what this shelf-life tool is for.)`);
  else if (storageC > 200 && pts.every((p) => p.tC < 150)) errors.push(`A storage temperature of ${storageC} °C looks like kelvin: give it in °C (25, not 298.15).`);
  if (errors.length) return { ok: false, errors };
  const notes: string[] = [];
  // Zero order counts 10 % of the starting assay: from the fitted series when there are any (their mean), else 100 (%).
  const fitted = pts.filter((p) => p.from).map((p) => p.from!.c0);
  const c0 = order === "zero" && fitted.length === pts.length ? fitted.reduce((a, b) => a + b, 0) / fitted.length : 100;
  if (order === "zero" && fitted.length < pts.length) notes.push("Zero order with rate constants typed in: everything is read as assay % per time unit, and t₉₀ as the time to lose 10 % (10/k) — give every temperature as a series to count from its own starting assay.");
  if (!(c0 > 0)) return { ok: false, errors: ["The fitted starting assay is zero or below: zero-order t₉₀ counts 10 % of it, so give the assay as amounts above zero."] };
  const xs = pts.map((p) => 1 / (p.tC + 273.15));
  const ys = pts.map((p) => Math.log(p.k));
  const f = linFit(xs, ys);
  const Ea = (-f.slope * R_GAS) / 1000;
  if (!(Ea > 0))
    return {
      ok: false,
      errors: [
        Ea === 0 || Math.abs(Ea) < 1e-9
          ? "The rate is the same at every temperature (no activation energy): there is nothing to extrapolate a shelf life from."
          : "The rate falls as the temperature rises (a negative activation energy): the data do not follow Arrhenius, and no shelf life can be extrapolated from them — check them.",
      ],
    };
  const x0 = 1 / (storageC + 273.15);
  const lnk0 = f.intercept + f.slope * x0;
  const k0 = Math.exp(lnk0);
  let EaCI: [number, number] | null = null;
  let kUpper: number | null = null;
  if (f.n > 2 && Number.isFinite(f.s)) {
    const t = tCritical(0.05, f.n - 2);
    const seSlope = f.s / Math.sqrt(f.sxx);
    const lo = (-(f.slope + t * seSlope) * R_GAS) / 1000, hi = (-(f.slope - t * seSlope) * R_GAS) / 1000;
    EaCI = [Math.min(lo, hi), Math.max(lo, hi)];
    // One-sided 95 % upper bound of ln k at the storage temperature (the mean-response interval).
    const t1 = tCritical(0.1, f.n - 2);
    const se = f.s * Math.sqrt(1 / f.n + (x0 - f.xbar) ** 2 / f.sxx);
    kUpper = Math.exp(lnk0 + t1 * se);
  } else notes.push("With two temperatures the line passes through both exactly: no interval can be given. Three or more temperatures give one.");
  const tMin = Math.min(...pts.map((p) => p.tC)), tMax = Math.max(...pts.map((p) => p.tC));
  if (storageC < tMin - 0.01 || storageC > tMax + 0.01) notes.push(`${storageC} °C is outside the measured range (${tMin}–${tMax} °C): an extrapolation, which assumes the same mechanism holds there.`);
  if (f.n > 2 && f.r2 < 0.95) notes.push(`The Arrhenius plot is not straight (r² = ${f.r2.toFixed(3)}): a change of mechanism, or of order, across the range?`);
  for (const p of pts) if (p.from && p.from.r2 < 0.9) notes.push(`At ${p.tC} °C the ${order}-order fit is poor (r² = ${p.from.r2.toFixed(3)}): is the order right?`);
  return {
    ok: true,
    points: pts,
    order,
    EaKJ: Ea,
    EaCI,
    lnA: f.intercept,
    r2: f.r2,
    storage: { tC: storageC, k: k0, kUpper, t90: t90(k0, order, c0), t90Lower: kUpper ? t90(kUpper, order, c0) : null },
    fit: f,
    notes,
  };
}

/**
 * The input, one item per line:
 *   40 0.0123              a temperature (°C) and its rate constant (1/time unit), or
 *   40: 0 100, 1 98.2, 3 95.1, 6 90.3     a temperature and its assay (time, % remaining) series.
 * Lines of the second kind are fitted to k first, at the chosen order.
 */
export function parseStability(text: string, order: Order): { points: RatePoint[]; errors: string[] } {
  const errors: string[] = [];
  const points: RatePoint[] = [];
  const NUM = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const t = raw.replace(/#.*$/, "").replace(/°\s*C/gi, "").trim();
    if (!t) return;
    const series = new RegExp(`^(${NUM})\\s*:\\s*(.+)$`).exec(t);
    if (series) {
      const pairs = series[2].split(/\s*[,;]\s*/).filter(Boolean).map((pp) => pp.trim().split(/\s+/).map(Number));
      if (pairs.some((pp) => pp.length !== 2 || pp.some((v) => !Number.isFinite(v)))) return void errors.push(`Line ${i + 1}: a series is “40: 0 100, 1 98.2, 3 95.1” (time and assay pairs).`);
      const r = fitRate(pairs as Array<[number, number]>, order);
      if (typeof r === "string") return void errors.push(`Line ${i + 1} (${series[1]} °C): ${r}.`);
      points.push({ tC: Number(series[1]), k: r.k, from: { n: r.n, r2: r.r2, c0: r.c0 } });
      return;
    }
    const pair = new RegExp(`^(${NUM})[\\s,;]+(${NUM})$`).exec(t);
    if (pair) {
      points.push({ tC: Number(pair[1]), k: Number(pair[2]) });
      return;
    }
    errors.push(`Line ${i + 1}: “${t.slice(0, 40)}” is not “40 0.0123” or “40: 0 100, 1 98.2, 3 95.1”.`);
  });
  return { points, errors };
}
