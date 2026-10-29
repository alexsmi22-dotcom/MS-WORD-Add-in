/**
 * Securities event study with the market model (Release E3, calculator es-event): the engine, pure numbers.
 *
 * Conventions (sources checked against the printed text):
 *  - Market model by OLS on the estimation window τ = T0+1…T1 (L1 days): β̂ = Σ(Ri − μ̂i)(Rm − μ̂m) / Σ(Rm − μ̂m)²,
 *    α̂ = μ̂i − β̂μ̂m, σ̂²ε = Σ(Ri − α̂ − β̂Rm)² / (L1 − 2). MacKinlay (1997), J. Econ. Lit. 35(1), eqs. (4)–(6);
 *    Campbell, Lo & MacKinlay (1997), The Econometrics of Financial Markets, eqs. (4.4.1)–(4.4.6).
 *  - Abnormal returns AR = R − α̂ − β̂Rm (MacKinlay eq. 7). Their event-window covariance, conditional on the market
 *    returns, is V = σ²ε(I + X*(X'X)⁻¹X*') with X* = [1, R*m] the event-window design (CLM eq. 4.4.9): the
 *    prediction-error correction, which makes the abnormal returns serially correlated. Its diagonal is
 *    σ²ε[1 + 1/L1 + (Rmτ − μ̂m)²/Σ(Rm − μ̂m)²], MacKinlay eq. (8) (printed there without the σ²ε factor on the
 *    second term).
 *  - CAR = γ'AR, var(CAR) = γ'Vγ (CLM eqs. 4.4.11–4.4.12); SCAR = CAR/σ̂(CAR) is Student t with L1 − 2 df under
 *    the null (CLM eq. 4.4.14), so a single event's p-value comes from t(L1 − 2).
 *  - Across N events: CAAR = mean CAR, var = (1/N²)Σσ̂²i, J₁ = CAAR/√var ~ N(0, 1) (CLM eqs. 4.4.19–4.4.22;
 *    MacKinlay eqs. 17, 18, 20); J₂ = √(N(L1 − 4)/(L1 − 2))·mean SCAR ~ N(0, 1) (CLM eq. 4.4.24).
 *  - BMP (Boehmer, Musumeci & Poulsen 1991): mean SCAR·√N / S, S the cross-sectional standard deviation of the SCARs
 *    with divisor N − 1 (as transcribed by Kolari & Pynnönen, EFMA 2009, eqs. 5–7 and 21). The p-value from t(N − 1)
 *    is this module's choice (the one-sample t on the SCARs); the transcription read does not state a reference
 *    distribution.
 *  - Cross-sectional test: CAAR / √((1/N²)Σ(CARi − CAAR)²), the variance estimator of MacKinlay eq. (21) (divisor N²,
 *    as printed), p from N(0, 1).
 *
 * The (X'X)⁻¹ quadratic forms are written in centred form: for g = [Σγ, ΣγRm*], g(X'X)⁻¹g' = (Σγ)²/L1 +
 * (ΣγRm* − Σγ·μ̂m)²/Σ(Rm − μ̂m)², exact algebra and stable at any scale.
 */
import type { DateToken } from "./damagesInterest";
import { readDateToken, longDate } from "./damagesInterest";
import { parseSeriesTable, type SeriesData } from "./tsData";
import { tTestP } from "./stats";
import { normalCdf } from "./stats2";

export type ReturnInput = "returns" | "simple" | "log";

export interface EventStudyOptions {
  input: ReturnInput;
  /** Market column name ("" = the first value column). */
  market: string;
  estFrom: number;
  estTo: number;
  evFrom: number;
  evTo: number;
}

export interface MarketModelFit {
  alpha: number;
  beta: number;
  sigma2: number;
  L1: number;
  meanM: number;
  /** Σ(Rm − μ̂m)² over the estimation window. */
  sxx: number;
}

export interface EventResult {
  firm: string;
  /** The day number asked for and the trading day used. */
  askedDay: number;
  day: number;
  /** Row index of τ = 0 in the return series. */
  row: number;
  fit: MarketModelFit;
  /** Abnormal returns τ = evFrom…evTo. */
  ar: number[];
  /** Market returns over the event window (the X* column). */
  rmEvent: number[];
  car: number;
  carVar: number;
  scar: number;
  p: number;
  /** CAR(−1, +1) when the event window holds it. */
  car11?: { car: number; carVar: number; scar: number; p: number };
}

export interface AggregateTest {
  name: string;
  window: string;
  /** Undefined when the test cannot be formed; `why` says why. */
  stat?: number;
  p?: number;
  reference: string;
  why?: string;
}

export interface EventStudyResult {
  events: EventResult[];
  taus: number[];
  /** Average AR and CAR by τ across events, and the standard error of the CAAR from τ1 to τ. */
  aar: number[];
  caar: number[];
  caarSe: number[];
  tests: AggregateTest[];
  L1: number;
  notes: string[];
  firmNames: string[];
  marketName: string;
  /** The table's value columns carry % signs (tsData), so the returns are in percent units. */
  percentCells: boolean;
}

export const MAX_EVENTS = 500;
export const MAX_EST_LENGTH = 1000;
export const MAX_EVENT_WINDOW = 121;
export const MAX_TAU = 1000;
export const MIN_EST_DAYS = 30;

const q = (s: string): string => `“${s}”`;

/** OLS market model on rows [a, b] of the two series (two-pass sums for accuracy at any scale). */
export function fitMarketModel(rm: ArrayLike<number>, ri: ArrayLike<number>, a: number, b: number): MarketModelFit {
  const L1 = b - a + 1;
  let sm = 0;
  let si = 0;
  for (let t = a; t <= b; t++) {
    sm += rm[t];
    si += ri[t];
  }
  const meanM = sm / L1;
  const meanI = si / L1;
  let sxx = 0;
  let sxy = 0;
  for (let t = a; t <= b; t++) {
    const dx = rm[t] - meanM;
    sxx += dx * dx;
    sxy += dx * (ri[t] - meanI);
  }
  const beta = sxy / sxx;
  const alpha = meanI - beta * meanM;
  let ssr = 0;
  for (let t = a; t <= b; t++) {
    const e = ri[t] - meanI - beta * (rm[t] - meanM);
    ssr += e * e;
  }
  return { alpha, beta, sigma2: ssr / (L1 - 2), L1, meanM, sxx };
}

/** var(CAR) = σ²ε(γ'γ + g(X'X)⁻¹g') for γ = ones on event-window positions [i0, i1] of rmEvent. */
export function carVariance(fit: MarketModelFit, rmEvent: ArrayLike<number>, i0: number, i1: number): number {
  const k = i1 - i0 + 1;
  let srm = 0;
  for (let i = i0; i <= i1; i++) srm += rmEvent[i];
  const centred = srm - k * fit.meanM;
  return fit.sigma2 * (k + (k * k) / fit.L1 + (centred * centred) / fit.sxx);
}

/** Two-sided p from N(0, 1). */
export function normalP(z: number): number {
  const a = Math.abs(z);
  return Math.min(1, 2 * (1 - normalCdf(a)));
}

/** A whole-number field: "−130" (U+2212) reads; "abc", "1e400", "" and out-of-range values are refused by name. */
export function readIntField(raw: string, label: string, lo: number, hi: number): number | { error: string } {
  // A Word minus or an en dash typed as a minus; "5.0" is the whole number 5.
  const s = (raw ?? "").trim().replace(/[−–]/g, "-");
  if (!/^[-+]?\d{1,15}(\.0+)?$/.test(s)) return { error: `${label}: ${q((raw ?? "").trim())} is not a whole number.` };
  const v = Math.trunc(Number(s));
  if (v < lo || v > hi) return { error: `${label}: ${String(v).replace("-", "−")} is outside ${String(lo).replace("-", "−")} to ${String(hi).replace("-", "−")}.` };
  return v === 0 ? 0 : v;
}

interface EventSpec {
  firm: string;
  day: number;
  line: number;
}

/** "Firm: 2024-03-05" per line; a single-firm table may give just the date. */
export function parseEventList(text: string, firms: string[]): { ok: true; events: EventSpec[] } | { ok: false; reason: string } {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const events: EventSpec[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (events.length >= MAX_EVENTS) return { ok: false, reason: `At most ${MAX_EVENTS} events fit in one study.` };
    let firmText = "";
    let dateText = line;
    const colon = line.indexOf(":");
    const tab = line.indexOf("\t");
    const cut = colon >= 0 ? colon : tab;
    if (cut >= 0) {
      firmText = line.slice(0, cut).trim();
      dateText = line.slice(cut + 1).trim();
    }
    const t = readDateToken(dateText, false);
    if (!t) return { ok: false, reason: `Event line ${i + 1}: ${q(dateText)} is not a date. Write one event per line as “Firm: 2024-03-05”.` };
    if ("error" in t) return { ok: false, reason: `Event line ${i + 1}: ${t.error}` };
    if (t.len !== dateText.length) return { ok: false, reason: `Event line ${i + 1}: ${q(dateText)} has more than a date after the firm name.` };
    let firm: string;
    if (!firmText) {
      if (firms.length !== 1) {
        return { ok: false, reason: `Event line ${i + 1} names no firm, and the table has ${firms.length} firm columns (${firms.map(q).join(", ")}). Write “Firm: date”.` };
      }
      firm = firms[0];
    } else {
      const j = firms.findIndex((f) => f.toLowerCase() === firmText.toLowerCase());
      if (j < 0) return { ok: false, reason: `Event line ${i + 1}: no firm column is named ${q(firmText)}; the firm columns are ${firms.map(q).join(", ")}.` };
      firm = firms[j];
    }
    events.push({ firm, day: t.from, line: i + 1 });
  }
  if (!events.length) return { ok: false, reason: "List at least one event: “Firm: 2024-03-05”, one per line." };
  return { ok: true, events };
}

type Fail = { ok: false; reason: string };

/** Turns a price table into returns dated by the later day; refuses a zero or negative price by date. */
function pricesToReturns(data: SeriesData, mode: "simple" | "log"): { cols: Float64Array[]; tokens: DateToken[] } | Fail {
  const tokens = data.dates!.tokens;
  const n = data.n;
  const cols: Float64Array[] = [];
  for (let j = 0; j < data.cols.length; j++) {
    const p = data.cols[j];
    for (let i = 0; i < n; i++) {
      if (!(p[i] > 0)) {
        return { ok: false, reason: `${q(data.names[j])} on ${tokens[i].label}: a price must be greater than zero to form a return.` };
      }
    }
    const r = new Float64Array(n - 1);
    for (let i = 1; i < n; i++) r[i - 1] = mode === "log" ? Math.log(p[i] / p[i - 1]) : p[i] / p[i - 1] - 1;
    cols.push(r);
  }
  return { cols, tokens: tokens.slice(1) };
}

const tauText = (t: number): string => (t > 0 ? `+${t}` : t < 0 ? `−${-t}` : "0");
export const windowText = (a: number, b: number): string => `(${tauText(a)}, ${tauText(b)})`;

/** Runs the study end to end on the pasted table and event list. */
export function runEventStudy(tableText: string, eventsText: string, o: EventStudyOptions): { ok: true; result: EventStudyResult } | Fail {
  if (o.estTo >= o.evFrom) {
    return { ok: false, reason: `The estimation window must end before the event window starts (estimation ends at τ = ${tauText(o.estTo)}, the event window starts at τ = ${tauText(o.evFrom)}).` };
  }
  if (o.estFrom > o.estTo) return { ok: false, reason: "The estimation window starts after it ends." };
  if (o.evFrom > o.evTo) return { ok: false, reason: "The event window starts after it ends." };
  const L1 = o.estTo - o.estFrom + 1;
  if (L1 < MIN_EST_DAYS) return { ok: false, reason: `The estimation window has ${L1} trading days; at least ${MIN_EST_DAYS} are needed.` };
  if (L1 > MAX_EST_LENGTH) return { ok: false, reason: `The estimation window has ${L1} trading days; the most is ${MAX_EST_LENGTH}.` };
  const L2 = o.evTo - o.evFrom + 1;
  if (L2 > MAX_EVENT_WINDOW) return { ok: false, reason: `The event window has ${L2} days; the most is ${MAX_EVENT_WINDOW}.` };

  const parsed = parseSeriesTable(tableText, { requireDates: true, minRows: 3 });
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const dates = data.dates!;
  if (dates.frequency !== "day") {
    const what = dates.frequency === "irregular" ? "a mix of periods" : `${dates.frequency}s`;
    return { ok: false, reason: `The date column holds ${what}${dates.gap ? ` (${dates.gap})` : ""}; an event study here takes one row per trading day (2024-03-05).` };
  }
  if (data.cols.length < 2) return { ok: false, reason: "The table needs a market column and at least one firm column." };
  // A % sign must be on every column or none: a market in percent beside a firm in decimals would mix units.
  const percentCells = data.percent.some(Boolean);
  if (percentCells && !data.percent.every(Boolean)) {
    const plain = data.names[data.percent.indexOf(false)];
    return { ok: false, reason: `Some columns are written with % signs and ${q(plain)} is not; write every return column the same way.` };
  }
  if (percentCells && o.input !== "returns") {
    return { ok: false, reason: "The cells carry % signs, which prices do not have; choose “Returns” for a table of returns." };
  }
  let mIdx = 0;
  if (o.market.trim()) {
    mIdx = data.names.findIndex((nm) => nm.toLowerCase() === o.market.trim().toLowerCase());
    if (mIdx < 0) return { ok: false, reason: `No column is named ${q(o.market.trim())}; the columns are ${data.names.map(q).join(", ")}.` };
  }
  const marketName = data.names[mIdx];
  const firmNames = data.names.filter((_, j) => j !== mIdx);

  let cols = data.cols;
  let tokens = dates.tokens;
  if (o.input !== "returns") {
    const r = pricesToReturns(data, o.input);
    if ("ok" in r) return r;
    cols = r.cols;
    tokens = r.tokens;
  }
  const n = tokens.length;
  const rm = cols[mIdx];

  const ev = parseEventList(eventsText, firmNames);
  if (!ev.ok) return ev;

  const notes: string[] = [...data.notes];
  const events: EventResult[] = [];
  const has11 = o.evFrom <= -1 && o.evTo >= 1 && !(o.evFrom === -1 && o.evTo === 1);
  const seen = new Map<string, number>();
  for (const e of ev.events) {
    const label = `${e.firm}, ${longDate(e.day)}`;
    // The first trading day on or after the event date.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tokens[mid].from < e.day) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= n) return { ok: false, reason: `Event ${label}: the table's returns end on ${tokens[n - 1].label}, before the event.` };
    const row = lo;
    const key = `${e.firm}\n${row}`;
    if (seen.has(key)) return { ok: false, reason: `Event line ${e.line}: ${e.firm} already has an event on ${tokens[row].label} (line ${seen.get(key)}); list each event once.` };
    seen.set(key, e.line);
    if (tokens[row].from !== e.day) notes.push(`Event ${label} is not a trading day in the table; it moves to the next trading day, ${tokens[row].label}.`);
    const a = row + o.estFrom;
    const b = row + o.estTo;
    if (a < 0) {
      return { ok: false, reason: `Event ${label}: the estimation window needs ${-o.estFrom} trading days of returns before the event; the table has ${row}.` };
    }
    if (row + o.evTo > n - 1) {
      return { ok: false, reason: `Event ${label}: the event window needs ${o.evTo} trading days of returns after the event; the table has ${n - 1 - row}.` };
    }
    const ri = cols[data.names.indexOf(e.firm)];
    let mConst = true;
    let iConst = true;
    for (let t = a + 1; t <= b; t++) {
      if (rm[t] !== rm[a]) mConst = false;
      if (ri[t] !== ri[a]) iConst = false;
    }
    if (mConst) return { ok: false, reason: `Event ${label}: ${q(marketName)} has the same return on every estimation day, so the market model has no slope.` };
    if (iConst) return { ok: false, reason: `Event ${label}: ${q(e.firm)} has the same return on every estimation day, so its abnormal-return variance is zero and no test can be formed.` };
    const fit = fitMarketModel(rm, ri, a, b);
    let tss = 0;
    let mi = 0;
    for (let t = a; t <= b; t++) mi += ri[t];
    mi /= L1;
    for (let t = a; t <= b; t++) tss += (ri[t] - mi) * (ri[t] - mi);
    if (!(fit.sigma2 * (L1 - 2) > 1e-20 * tss)) {
      return { ok: false, reason: `Event ${label}: ${q(e.firm)} moves exactly with the market over the estimation window (no residual variance), so no test can be formed.` };
    }
    const ar: number[] = [];
    const rmEvent: number[] = [];
    for (let tau = o.evFrom; tau <= o.evTo; tau++) {
      const t = row + tau;
      ar.push(ri[t] - fit.alpha - fit.beta * rm[t]);
      rmEvent.push(rm[t]);
    }
    const sumRange = (i0: number, i1: number): number => {
      let s = 0;
      for (let i = i0; i <= i1; i++) s += ar[i];
      return s;
    };
    const car = sumRange(0, L2 - 1);
    const carVar = carVariance(fit, rmEvent, 0, L2 - 1);
    const scar = car / Math.sqrt(carVar);
    const res: EventResult = { firm: e.firm, askedDay: e.day, day: tokens[row].from, row, fit, ar, rmEvent, car, carVar, scar, p: tTestP(scar, L1 - 2) };
    if (has11) {
      const i0 = -1 - o.evFrom;
      const c = sumRange(i0, i0 + 2);
      const v = carVariance(fit, rmEvent, i0, i0 + 2);
      res.car11 = { car: c, carVar: v, scar: c / Math.sqrt(v), p: tTestP(c / Math.sqrt(v), L1 - 2) };
    }
    for (const x of [fit.alpha, fit.beta, fit.sigma2, car, carVar, scar, ...ar]) {
      if (!Number.isFinite(x)) return { ok: false, reason: `Event ${label}: the market model gives a value that is not a finite number for these returns (an extreme scale).` };
    }
    events.push(res);
  }

  // Clustering: event windows that overlap in calendar time break the independence the aggregate tests assume.
  const spans = events.map((e) => ({ lo: e.row + o.evFrom, hi: e.row + o.evTo, e }));
  let clusterNote = "";
  for (let i = 0; i < spans.length && !clusterNote; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].lo <= spans[j].hi && spans[j].lo <= spans[i].hi) {
        clusterNote =
          `The event windows of ${spans[i].e.firm} (${longDate(spans[i].e.day)}) and ${spans[j].e.firm} (${longDate(spans[j].e.day)}) overlap in calendar time; ` +
          "the aggregate tests assume they do not (no clustering, MacKinlay 1997 §5E), so read them with care.";
        break;
      }
    }
  }
  if (clusterNote) notes.push(clusterNote);

  const N = events.length;
  const taus: number[] = [];
  const aar: number[] = [];
  const caar: number[] = [];
  const caarSe: number[] = [];
  let cum = 0;
  for (let k = 0; k < L2; k++) {
    taus.push(o.evFrom + k);
    let s = 0;
    let v = 0;
    for (const e of events) {
      s += e.ar[k];
      v += carVariance(e.fit, e.rmEvent, 0, k);
    }
    const m = s / N;
    cum += m;
    aar.push(m);
    caar.push(cum);
    caarSe.push(Math.sqrt(v) / N);
  }

  const tests: AggregateTest[] = [];
  const addTests = (win: string, pick: (e: EventResult) => { car: number; carVar: number; scar: number }): void => {
    const xs = events.map(pick);
    const cbar = xs.reduce((s, x) => s + x.car, 0) / N;
    const vbar = xs.reduce((s, x) => s + x.carVar, 0) / (N * N);
    const j1 = cbar / Math.sqrt(vbar);
    tests.push({ name: "J₁ (CAAR / its standard error)", window: win, stat: j1, p: normalP(j1), reference: "N(0, 1)" });
    const sbar = xs.reduce((s, x) => s + x.scar, 0) / N;
    if (L1 > 4) {
      const j2 = Math.sqrt((N * (L1 - 4)) / (L1 - 2)) * sbar;
      tests.push({ name: "J₂ (mean SCAR)", window: win, stat: j2, p: normalP(j2), reference: "N(0, 1)" });
    }
    if (N < 2) {
      tests.push({ name: "BMP standardized cross-sectional t", window: win, reference: "t(N − 1)", why: "needs 2 or more events" });
      tests.push({ name: "Cross-sectional t on the CARs", window: win, reference: "N(0, 1)", why: "needs 2 or more events" });
      return;
    }
    let ss = 0;
    for (const x of xs) ss += (x.scar - sbar) * (x.scar - sbar);
    const sS = Math.sqrt(ss / (N - 1));
    if (sS > 0) {
      const bmp = (sbar * Math.sqrt(N)) / sS;
      tests.push({ name: "BMP standardized cross-sectional t", window: win, stat: bmp, p: tTestP(bmp, N - 1), reference: `t(${N - 1})` });
    } else tests.push({ name: "BMP standardized cross-sectional t", window: win, reference: `t(${N - 1})`, why: "not defined: every SCAR is the same" });
    let sc = 0;
    for (const x of xs) sc += (x.car - cbar) * (x.car - cbar);
    const vcs = sc / (N * N);
    if (vcs > 0) {
      const cs = cbar / Math.sqrt(vcs);
      tests.push({ name: "Cross-sectional t on the CARs", window: win, stat: cs, p: normalP(cs), reference: "N(0, 1)" });
    } else tests.push({ name: "Cross-sectional t on the CARs", window: win, reference: "N(0, 1)", why: "not defined: every CAR is the same" });
  };
  addTests(windowText(o.evFrom, o.evTo), (e) => e);
  if (has11) addTests(windowText(-1, 1), (e) => e.car11!);
  for (const t of tests) {
    if (t.stat !== undefined && !Number.isFinite(t.stat)) return { ok: false, reason: `${t.name} is not a finite number for these returns (an extreme scale).` };
  }

  return { ok: true, result: { events, taus, aar, caar, caarSe, tests, L1, notes, firmNames, marketName, percentCells } };
}
