/**
 * Release F2 items #14 (Micro II) and #15 (Macro II): Stats calculators spread into the pane's STAT_CALCS.
 *  - micro-demand            constant-elasticity (log-log) and log-linear (semi-log) demand: elasticity, revenue,
 *                            revenue-maximising price, monopoly price with a constant marginal cost;
 *  - micro-consumer          Cobb–Douglas, CES, perfect complements and perfect substitutes: Marshallian and Hicksian
 *                            demands, indirect utility and expenditure, Hicks and Slutsky decompositions, CV and EV,
 *                            with the budget-line / indifference-curve figure;
 *  - micro-cost              TC, VC, AC, AVC, MC from a polynomial total cost, shutdown and break-even points, the
 *                            price-taking output at a market price;
 *  - micro-price-disc        uniform monopoly price vs third-degree and first-degree price discrimination (two linear
 *                            markets, constant marginal cost);
 *  - micro-auction           first- and second-price auctions with i.i.d. uniform values: equilibrium bids, expected
 *                            revenue (revenue equivalence), reserve price and Myerson's optimal reserve;
 *  - macro-growth-accounting Solow residual from a pasted Y, K, L series;
 *  - macro-mundell-fleming   small open economy under floating and fixed rates: fiscal, monetary and devaluation
 *                            experiments, IS–LM–BP figure;
 *  - macro-money-multiplier  money multiplier with currency and excess-reserve drains, the deposit-expansion rounds;
 *  - macro-fiscal-multipliers open-economy multipliers with a proportional tax and imports, Keynesian cross;
 *  - macro-phillips          Phillips-curve estimation (OLS through olsInference.fitOls), NAIRU with a delta-method SE.
 * Engines in micromacro.ts. Existing calculators are not duplicated: linear supply and demand (micro-market),
 * oligopoly (micro-oligopoly), Solow, IS–LM and Taylor (macro-*) stay where they are. Every worked default is
 * invented; the Phillips table is synthetic (scripts/micromacro-oracle.py, seed 20261027).
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { StatCalcDef } from "./statCalc";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratSign, ratIsZero, ratToNumber, ratEq, RAT_ZERO, RAT_ONE } from "./cas";
import { readRat, fmtExactDec, cellDec, fmtSig } from "./gameMacroCalcs";
import { fmtFixed, fmtP, intText } from "./regTable";
import { buildPlotSvg, type Series, type Point } from "./plot";
import { composePanels } from "./panels";
import { readCalcList, ListTokenError } from "./calcList";
import { ratOf } from "./currency";
import { parseSeriesTable, pickSeries } from "./tsData";
import { fitOls, type SeType } from "./olsInference";
import { fitReading, unsigned } from "./statLibReading";
import { depositExpansionSvg } from "./statLibFigures";
import {
  rcmp,
  type Utility,
  type UtilityKind,
  type Bundle,
  consumerChoice,
  marshallRat,
  expenditureRat,
  indirectRat,
  COST_MAX_DEGREE,
  costAnalysis,
  minMc,
  supplyAt,
  polyN,
  mcN,
  type CostAnalysis,
  type CostPoint,
  priceDiscrimination,
  type PdScheme,
  AUCTION_MAX_N,
  auction,
  firstPriceBid,
  optimalReserve,
  AUCTION_EXACT_BITS,
  auctionExactCost,
  auctionNum,
  firstPriceBidNum,
  mfSolve,
  type MfParams,
  type MfRegime,
  type MfSolution,
  growthAccounting,
  tfpIndex,
  type GrowthKind,
} from "./micromacro";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;
const MINUS = "−";
const R = (n: number): Rat => ({ n: BigInt(n), d: 1n });
const get = (read: Read, k: string): string => {
  const v = read(k);
  return v === undefined || v === null ? "" : String(v);
};

/** A non-finite value reached a formatter: the compute refuses instead of printing it. */
class NonFinite extends Error {}
/** A double for the text: four significant digits at least (fmtSig), refusing a non-finite value. */
function nm(v: number, dec = 4): string {
  if (!Number.isFinite(v)) throw new NonFinite();
  return fmtSig(v, dec);
}
/** A double with fixed decimals (grouped, true minus), refusing a non-finite value. */
function fx(v: number, dec: number): string {
  if (!Number.isFinite(v)) throw new NonFinite();
  return fmtFixed(v, dec);
}
const ex = (r: Rat): string => fmtExactDec(r, 4);
const pctN = (v: number, dec = 2): string => `${fx(v * 100, dec)}%`;
/** Runs a calculator body, turning a non-finite value into a refusal by name. */
function guarded(body: () => StatOutput): StatOutput {
  try {
    const o = body();
    if (o.ok !== false && (o.text.includes("—") || (o.tables ?? []).some((t) => t.rows.some((r) => r.some((c) => c.includes("—")))))) {
      return refuse("A value came out non-finite on these inputs, so there is nothing to insert. Check the inputs' magnitudes.");
    }
    return o;
  } catch (e) {
    if (e instanceof NonFinite) return refuse("A value came out non-finite (an overflow or a division by zero) on these inputs, so there is nothing to insert. Check the inputs' magnitudes.");
    throw e;
  }
}

type NumOpts = { min?: number; minOpen?: boolean; max?: number; maxOpen?: boolean; blank?: Rat | null; percent?: boolean; int?: boolean };
/**
 * One number field as an exact rational (gameMacroCalcs.readRat: decimals, fractions, true minus, decimal commas by
 * the table rule; magnitudes beyond 10¹⁵ refused). `percent`: the field is in percent and a trailing % is allowed.
 */
function ratField(read: Read, key: string, label: string, o: NumOpts = {}): Rat | null | string {
  const raw = get(read, key);
  if (raw.trim() === "" && o.blank !== undefined) return o.blank;
  const r = readRat(raw, label, { percentAsIs: o.percent });
  if ("error" in r) return r.error;
  const v = ratToNumber(r.value);
  const lim = (x: number): string => fmtSig(x, x % 1 ? 2 : 0);
  if (o.int && r.value.d !== 1n) return `${label} must be a whole number (got ${raw.trim()}).`;
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${label} must be ${o.minOpen ? "greater than" : "at least"} ${lim(o.min)} (got ${raw.trim()}).`;
  if (o.max !== undefined && (o.maxOpen ? !(v < o.max) : v > o.max)) return `${label} must be ${o.maxOpen ? "less than" : "at most"} ${lim(o.max)} (got ${raw.trim()}).`;
  return r.value;
}
/** Reads several required fields; the first refusal wins. */
function ratFields(read: Read, specs: [string, string, NumOpts?][]): Record<string, Rat> | string {
  const out: Record<string, Rat> = {};
  for (const [k, label, o] of specs) {
    const v = ratField(read, k, label, o ?? {});
    if (typeof v === "string") return v;
    if (v === null) return `${label} is empty.`;
    out[k] = v;
  }
  return out;
}
const pick = (read: Read, key: string, allowed: string[], dflt: string, label: string): string | { error: string } => {
  const v = get(read, key).trim() || dflt;
  return allowed.includes(v) ? v : { error: `${label}: unknown choice ${q(v)}.` };
};

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n: number): string => String(n).replace(/\d/g, (d) => SUP[d]);

/** "300 + 12q − 2q² + 0.25q³": a polynomial (coefficients lowest first) under the display contract. */
function polyText(c: Rat[], v: string, startPow = 0): string {
  const parts: string[] = [];
  c.forEach((coef, i) => {
    if (ratIsZero(coef)) return;
    const k = i + startPow;
    const neg = ratSign(coef) < 0;
    const mag = neg ? ratNeg(coef) : coef;
    const ms = fmtExactDec(mag, 4).replace(/ ≈ .*$/, "");
    const body = k === 0 ? ms : `${ratEq(mag, RAT_ONE) ? "" : ms}${v}${k === 1 ? "" : sup(k)}`;
    parts.push(parts.length === 0 ? (neg ? MINUS : "") + body : `${neg ? MINUS : "+"} ${body}`);
  });
  return parts.length ? parts.join(" ") : "0";
}

/** "Q" for a unit slope, else the slope: "0.5Q". */
const slopeQ = (b: Rat): string => (ratEq(b, RAT_ONE) ? "" : ex(b));

const W = 420;
const H = 280;

// =================================================================================================================
// micro-demand

/** Demand curve (P against Q) and revenue against price, side by side. */
export function demandRevenueSvg(o: {
  qOf: (p: number) => number;
  pMax: number;
  /** Lowest price drawn (the constant-elasticity curve runs to infinite quantity as P → 0). */
  pMin: number;
  p0: number;
  pR: number | null;
  pStar: number | null;
  title: string;
}): string {
  const dem: Point[] = [];
  const rev: Point[] = [];
  const N = 120;
  const pLo = o.pMin;
  const qCap = o.qOf(Math.max(pLo, o.pMax / 1e6));
  for (let i = 0; i <= N; i++) {
    const p = pLo + ((o.pMax - pLo) * i) / N;
    const qq = o.qOf(p);
    if (!Number.isFinite(qq) || qq > qCap * (1 + 1e-9)) continue;
    dem.push({ x: qq, y: p });
    rev.push({ x: p, y: p * qq });
  }
  const at = (p: number): Point => ({ x: o.qOf(p), y: p });
  const ds: Series[] = [{ type: "line", points: dem, color: "#0369a1", label: "demand" }, { type: "scatter", points: [at(o.p0)], color: "#15803d", label: "at the price entered" }];
  const rs: Series[] = [{ type: "line", points: rev, color: "#b45309", label: "revenue P·Q" }, { type: "scatter", points: [{ x: o.p0, y: o.p0 * o.qOf(o.p0) }], color: "#15803d", label: "at the price entered" }];
  if (o.pR !== null) rs.push({ type: "scatter", points: [{ x: o.pR, y: o.pR * o.qOf(o.pR) }], color: "#b91c1c", label: "revenue maximum" });
  if (o.pStar !== null) {
    ds.push({ type: "scatter", points: [at(o.pStar)], color: "#7c3aed", label: "monopoly price" });
    rs.push({ type: "scatter", points: [{ x: o.pStar, y: o.pStar * o.qOf(o.pStar) }], color: "#7c3aed", label: "monopoly price" });
  }
  const a = buildPlotSvg(ds, { width: 360, height: 270, title: o.title, xlabel: "Quantity Q", ylabel: "Price P" });
  const b = buildPlotSvg(rs, { width: 360, height: 270, title: "Revenue against price", xlabel: "Price P", ylabel: "Revenue P·Q" });
  return composePanels([a, b], { cols: 2, gap: 8, idPrefix: "mdem" }).svg;
}

export function microDemandCalc(read: Read): StatOutput {
  return guarded(() => {
    const form = pick(read, "form", ["loglog", "semilog"], "loglog", "Demand form");
    if (typeof form !== "string") return refuse(form.error);
    const P0 = ratField(read, "p", "The price P", { min: 0, minOpen: true });
    if (typeof P0 === "string" || P0 === null) return refuse(P0 ?? "The price P is empty.");
    const mc = ratField(read, "mc", "The marginal cost c", { min: 0, blank: null });
    if (typeof mc === "string") return refuse(mc);
    const p0 = ratToNumber(P0);
    const lines: string[] = [];
    const tables: StatTable[] = [];
    let qOf: (p: number) => number;
    let epsOf: (p: number) => number;
    let pR: Rat | null = null;
    let pStar: Rat | null = null;
    let revenueLine: string;
    let starLine = "";
    let conv: string;
    if (form === "loglog") {
      const v = ratFields(read, [
        ["A", "The scale A", { min: 0, minOpen: true }],
        ["eps", "The elasticity ε", { max: 0, maxOpen: true, min: -100 }],
      ]);
      if (typeof v === "string") return refuse(v);
      const A = ratToNumber(v.A);
      const e = ratToNumber(v.eps);
      qOf = (p) => Math.exp(Math.log(A) + e * Math.log(p));
      epsOf = () => e;
      lines.push(`Constant-elasticity demand: ln Q = ln A + ε·ln P with A = ${ex(v.A)} and ε = ${ex(v.eps)} (the elasticity is ε at every price).`);
      const cmp1 = rcmp(v.eps, R(-1));
      revenueLine =
        cmp1 === 0
          ? `Revenue P·Q = A = ${ex(v.A)} at every price (unit elastic everywhere): there is no unique revenue-maximizing price.`
          : cmp1 > 0
            ? "Demand is inelastic at every price (−1 < ε < 0): revenue rises with the price without bound, so there is no revenue-maximizing price (the form cannot hold at very high prices)."
            : "Demand is elastic at every price (ε < −1): revenue falls as the price rises and grows without bound as P → 0, so there is no interior revenue maximum.";
      if (mc) {
        if (cmp1 < 0 && ratSign(mc) > 0) {
          pStar = ratDiv(ratMul(mc, v.eps), ratAdd(RAT_ONE, v.eps));
          const lerner = ratDiv(RAT_ONE, ratNeg(v.eps));
          const ps = ratToNumber(pStar);
          starLine = `Monopoly price with marginal cost c = ${ex(mc)}: P* = c·ε/(1 + ε) = ${ex(pStar)} (markup ε/(1 + ε) = ${ex(ratDiv(v.eps, ratAdd(RAT_ONE, v.eps)))} over c; Lerner index (P* − c)/P* = −1/ε = ${ex(lerner)}), Q* = ${nm(qOf(ps))}, profit ${nm((ps - ratToNumber(mc)) * qOf(ps))}.`;
        } else if (ratSign(mc) === 0) {
          starLine = "With a zero marginal cost the monopolist maximizes revenue, which has no interior maximum here.";
        } else {
          starLine = `No monopoly price: with ε ≥ −1 marginal revenue P·(1 + 1/ε) is zero or negative at every price, so the monopolist would raise the price without bound.`;
        }
      }
      conv = "Conventions: constant-elasticity (log-log) demand Q = A·P to the power ε, written ln Q = ln A + ε·ln P; marginal revenue MR = P·(1 + 1/ε); a monopolist with constant marginal cost c sets MR = c, P* = c·ε/(1 + ε) (only for ε < −1). Quantities are computed in floating point; P* and the Lerner index are exact rationals.";
    } else {
      const v = ratFields(read, [
        ["a", "The intercept a"],
        ["b", "The slope b", { min: 0, minOpen: true }],
      ]);
      if (typeof v === "string") return refuse(v);
      const a = ratToNumber(v.a);
      const b = ratToNumber(v.b);
      if (a - b * p0 > 700) return refuse("ln Q = a − b·P is above 700 at the price entered (Q overflows): rescale the units.");
      qOf = (p) => Math.exp(a - b * p);
      epsOf = (p) => -b * p;
      lines.push(`Log-linear (semi-log) demand: ln Q = a − b·P with a = ${ex(v.a)} and b = ${ex(v.b)}; the elasticity is ε = −b·P, rising in magnitude with the price.`);
      pR = ratDiv(RAT_ONE, v.b);
      const pr = ratToNumber(pR);
      revenueLine = `Revenue is maximized where demand is unit elastic: P = 1/b = ${ex(pR)}, Q = e to the power (a − 1) = ${nm(qOf(pr))}, revenue ${nm(pr * qOf(pr))}.`;
      if (mc) {
        pStar = ratAdd(mc, pR);
        const ps = ratToNumber(pStar);
        starLine = `Monopoly price with marginal cost c = ${ex(mc)}: P* = c + 1/b = ${ex(pStar)}, Q* = ${nm(qOf(ps))}, elasticity there ${nm(epsOf(ps))}, Lerner index (P* − c)/P* = 1/(b·P*) = ${ex(ratDiv(pR, pStar))}, profit ${nm((ps - ratToNumber(mc)) * qOf(ps))}.`;
      }
      conv = "Conventions: log-linear means semi-log, ln Q = a − b·P (Q = e to the power (a − b·P)); the constant-elasticity form is the other choice. Elasticity ε = −b·P; MR = P·(1 + 1/ε) = P − 1/b; revenue peaks at P = 1/b; a monopolist with constant marginal cost c sets P* = c + 1/b. Quantities in floating point; 1/b and P* exact.";
    }
    const q0 = qOf(p0);
    const e0 = epsOf(p0);
    lines.push(`At P = ${ex(P0)}: Q = ${nm(q0)}, elasticity ε = ${nm(e0)} (${e0 < -1 ? "elastic" : e0 > -1 ? "inelastic" : "unit elastic"}), revenue P·Q = ${nm(p0 * q0)}, marginal revenue ${nm(p0 * (1 + 1 / e0))}.`);
    lines.push(revenueLine);
    if (starLine) lines.push(starLine);
    lines.push("");
    lines.push(conv);
    const marks = [p0, pR ? ratToNumber(pR) : 0, pStar ? ratToNumber(pStar) : 0];
    const pMax = Math.max(...marks) * 1.6;
    const grid: string[][] = [["Price P", "Quantity Q", "Elasticity ε", "Revenue P·Q"]];
    for (let i = 1; i <= 8; i++) {
      const p = (pMax * i) / 8;
      grid.push([nm(p), nm(qOf(p)), nm(epsOf(p)), nm(p * qOf(p))]);
    }
    tables.push({ label: "Demand at a grid of prices", rows: grid, align: ["right", "right", "right", "right"] });
    const pMin = form === "semilog" ? 0 : 0.25 * Math.min(...marks.filter((x) => x > 0));
    const svg = demandRevenueSvg({ qOf, pMax, pMin, p0, pR: pR ? ratToNumber(pR) : null, pStar: pStar ? ratToNumber(pStar) : null, title: form === "loglog" ? "Constant-elasticity demand" : "Log-linear demand" });
    // The reading: the quantity and elasticity at the price entered, what a price rise does to revenue, the monopoly price.
    const kindWord = e0 < -1 ? "elastic" : e0 > -1 ? "inelastic" : "unit elastic";
    const revText = e0 < -1 || e0 > -1 ? `${e0 < -1 ? "lower" : "raise"} revenue (now ${nm(p0 * q0)})` : `leave revenue (now ${nm(p0 * q0)}) unchanged`;
    const lead = `At a price of ${ex(P0)} buyers take about ${nm(q0)} units and demand is ${kindWord} there (ε = ${nm(e0)}), so a small price rise would ${revText}.`;
    const star = pStar && mc ? ` A monopolist with marginal cost ${ex(mc)} would charge ${ex(pStar)}.` : "";
    const reading = fitReading(lead + star, lead);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// micro-consumer

/** Budget lines, indifference curves through the old and new optima, and the bundles A, B, C. */
export function consumerChoiceSvg(o: {
  u: Utility;
  m: number;
  p1: number;
  p1New: number;
  p2: number;
  eHicks: number;
  u0: number;
  u1: number;
  A: Bundle;
  B: Bundle;
  C: Bundle;
}): string {
  const xMax = Math.max(o.m / o.p1, o.m / o.p1New, o.eHicks / o.p1New) * 1.1;
  const yMax = Math.max(o.m / o.p2, o.eHicks / o.p2) * 1.1;
  const budget = (inc: number, px: number): Point[] => [
    { x: 0, y: inc / o.p2 },
    { x: inc / px, y: 0 },
  ];
  const ic = (util: number): Point[] => {
    const pts: Point[] = [];
    const { u } = o;
    if (u.kind === "leontief") {
      const x0 = util / u.a;
      const y0 = util / u.b;
      if (x0 <= xMax && y0 <= yMax) return [{ x: x0, y: yMax }, { x: x0, y: y0 }, { x: xMax, y: y0 }];
      return [];
    }
    if (u.kind === "linear") {
      const seg: Point[] = [];
      const yAt0 = util / u.b;
      const xAt0 = util / u.a;
      seg.push(yAt0 <= yMax ? { x: 0, y: yAt0 } : { x: (util - u.b * yMax) / u.a, y: yMax });
      seg.push(xAt0 <= xMax ? { x: xAt0, y: 0 } : { x: xMax, y: (util - u.a * xMax) / u.b });
      return seg;
    }
    for (let i = 1; i <= 160; i++) {
      const x = (xMax * i) / 160;
      let y: number;
      if (u.kind === "cd") y = Math.exp((Math.log(util) - u.a * Math.log(x)) / u.b);
      else {
        const r = u.rho!;
        const inner = (Math.pow(util, r) - u.a * Math.pow(x, r)) / u.b;
        y = inner > 0 ? Math.pow(inner, 1 / r) : NaN;
      }
      if (Number.isFinite(y) && y >= 0 && y <= yMax) pts.push({ x, y });
    }
    return pts;
  };
  const series: Series[] = [
    { type: "line", points: budget(o.m, o.p1), color: "#0369a1", label: "budget, old price" },
    { type: "line", points: budget(o.m, o.p1New), color: "#b45309", label: "budget, new price" },
    { type: "line", points: budget(o.eHicks, o.p1New), color: "#9ca3af", label: "compensated budget" },
    { type: "line", points: ic(o.u0), color: "#15803d", label: "indifference curve u₀" },
    { type: "line", points: ic(o.u1), color: "#7c3aed", label: "indifference curve u₁" },
  ];
  const pt = (b: Bundle, color: string, label: string): void => {
    if (!b.tie) series.push({ type: "scatter", points: [{ x: b.x, y: b.y }], color, label });
  };
  pt(o.A, "#15803d", "A: old optimum");
  pt(o.B, "#111827", "B: compensated");
  pt(o.C, "#7c3aed", "C: new optimum");
  return buildPlotSvg(
    series.filter((s) => s.points.length > 0),
    { width: W, height: 300, title: "Price change: substitution and income effects", xlabel: "Good 1 (x₁)", ylabel: "Good 2 (x₂)" },
  );
}

const UTIL_NAMES: Record<UtilityKind, string> = {
  cd: "Cobb–Douglas",
  ces: "CES (constant elasticity of substitution)",
  leontief: "perfect complements",
  linear: "perfect substitutes",
};

export function microConsumerCalc(read: Read): StatOutput {
  return guarded(() => {
    const kind = pick(read, "util", ["cd", "ces", "leontief", "linear"], "cd", "Utility");
    if (typeof kind !== "string") return refuse(kind.error);
    const k = kind as UtilityKind;
    const v = ratFields(read, [
      ["a", "The weight a", { min: 0, minOpen: true, max: k === "cd" ? 100 : 1e6 }],
      ["b", "The weight b", { min: 0, minOpen: true, max: k === "cd" ? 100 : 1e6 }],
      ["m", "Income m", { min: 0, minOpen: true }],
      ["p1", "The price of good 1, p₁", { min: 0, minOpen: true }],
      ["p1new", "The new price of good 1", { min: 0, minOpen: true }],
      ["p2", "The price of good 2, p₂", { min: 0, minOpen: true }],
    ]);
    if (typeof v === "string") return refuse(v);
    let rho: number | undefined;
    if (k === "ces") {
      const r = ratField(read, "rho", "The CES exponent ρ", { min: -20, max: 0.95 });
      if (typeof r === "string" || r === null) return refuse(r ?? "The CES exponent ρ is empty.");
      if (ratIsZero(r)) return refuse("The CES exponent ρ = 0 is the Cobb–Douglas limit: choose Cobb–Douglas.");
      rho = ratToNumber(r);
    }
    const u: Utility = { kind: k, a: ratToNumber(v.a), b: ratToNumber(v.b), rho };
    const [m, p1, p1n, p2] = [v.m, v.p1, v.p1new, v.p2].map(ratToNumber);
    const res = consumerChoice(u, p1, p1n, p2, m);
    if (![res.u0, res.u1, res.eHicks, res.cv, res.ev].every(Number.isFinite)) throw new NonFinite();
    // Exact bundles where the closed form is rational.
    const exactOK = k !== "ces";
    const mPrimeR = exactOK && !res.A.tie ? (() => {
      const A = marshallRat(k as Exclude<UtilityKind, "ces">, v.a, v.b, v.p1, v.p2, v.m)!;
      return ratAdd(v.m, ratMul(ratSub(v.p1new, v.p1), A.x));
    })() : null;
    const exA = exactOK ? marshallRat(k as Exclude<UtilityKind, "ces">, v.a, v.b, v.p1, v.p2, v.m) : null;
    const exC = exactOK ? marshallRat(k as Exclude<UtilityKind, "ces">, v.a, v.b, v.p1new, v.p2, v.m) : null;
    const exS = exactOK && mPrimeR ? marshallRat(k as Exclude<UtilityKind, "ces">, v.a, v.b, v.p1new, v.p2, mPrimeR) : null;
    let exB: { x: Rat; y: Rat } | null = null;
    let exE: Rat | null = null;
    let exU0: Rat | null = null;
    if (k === "leontief" || k === "linear") {
      exU0 = indirectRat(k, v.a, v.b, v.p1, v.p2, v.m);
      exE = expenditureRat(k, v.a, v.b, v.p1new, v.p2, exU0);
      exB = marshallRat(k, v.a, v.b, v.p1new, v.p2, exE);
    }
    const bundleText = (b: Bundle, e: { x: Rat; y: Rat } | null): string =>
      b.tie ? "any bundle on the budget line (the two goods are equally good value)" : e ? `x₁ = ${ex(e.x)}, x₂ = ${ex(e.y)}` : `x₁ = ${nm(b.x)}, x₂ = ${nm(b.y)}`;
    const lines: string[] = [];
    const head =
      k === "cd"
        ? `U = xᵃ·yᵇ (x = x₁, y = x₂) with a = ${ex(v.a)}, b = ${ex(v.b)}`
        : k === "ces"
          ? `U = (a·xʳ + b·yʳ) to the power 1/r, r = ρ = ${nm(rho!)} (elasticity of substitution σ = 1/(1 − ρ) = ${nm(1 / (1 - rho!))}), a = ${ex(v.a)}, b = ${ex(v.b)}`
          : k === "leontief"
            ? `U = min(a·x₁, b·x₂) with a = ${ex(v.a)}, b = ${ex(v.b)}`
            : `U = a·x₁ + b·x₂ with a = ${ex(v.a)}, b = ${ex(v.b)}`;
    lines.push(`Consumer choice, ${UTIL_NAMES[k]}: ${head}; income m = ${ex(v.m)}, p₂ = ${ex(v.p2)}; p₁ changes from ${ex(v.p1)} to ${ex(v.p1new)}.`);
    const demandForms: Record<UtilityKind, string> = {
      cd: "Marshallian demands x₁ = (a/(a + b))·m/p₁, x₂ = (b/(a + b))·m/p₂ (constant budget shares); Hicksian demands h(p, ū) = x(p, e(p, ū)) with e(p, ū) = (ū/v(p, 1)) to the power 1/(a + b).",
      ces: "Marshallian demands from the tangency x₁/x₂ = (a·p₂/(b·p₁)) to the power σ on the budget line; v(p, m) = m·v(p, 1), e(p, ū) = ū/v(p, 1) (U is homogeneous of degree 1); Hicksian h(p, ū) = x(p, e(p, ū)).",
      leontief: "Marshallian demands on the kink a·x₁ = b·x₂: x₁ = (m/(p₁/a + p₂/b))/a, x₂ = (m/(p₁/a + p₂/b))/b; v = m/(p₁/a + p₂/b), e(p, ū) = ū·(p₁/a + p₂/b); Hicksian h₁ = ū/a, h₂ = ū/b (independent of prices: no substitution effect).",
      linear: "Marshallian demand: all income on the good with the higher marginal utility per unit of money (a/p₁ against b/p₂), any split at a tie; v = m·max(a/p₁, b/p₂), e(p, ū) = ū/max(a/p₁, b/p₂).",
    };
    lines.push(demandForms[k]);
    lines.push(`Before (A): ${bundleText(res.A, exA)}; utility u₀ = ${exU0 ? ex(exU0) : nm(res.u0)}.`);
    lines.push(`After (C): ${bundleText(res.C, exC)}; utility u₁ = ${nm(res.u1)}.`);
    lines.push(`Hicks-compensated (B, utility u₀ at the new prices): income e(p′, u₀) = ${exE ? ex(exE) : nm(res.eHicks)}, ${bundleText(res.B, exB)}.`);
    const fin = (b: Bundle): b is { x: number; y: number } => !b.tie;
    // Float noise in a difference (a zero price change gives −1.07×10⁻¹⁴) is shown as 0.
    const scale = Math.max(m, m / p1, m / p1n, m / p2);
    const snap = (x: number): number => (Math.abs(x) < 1e-11 * scale ? 0 : x);
    if (fin(res.A) && fin(res.B) && fin(res.C)) {
      const se = snap(res.B.x - res.A.x);
      const ie = snap(res.C.x - res.B.x);
      lines.push(`Hicks decomposition of the change in x₁ (${nm(snap(res.C.x - res.A.x))}): substitution effect B − A = ${nm(se)}, income effect C − B = ${nm(ie)}.`);
    } else {
      lines.push("Hicks decomposition: not defined, because demand at one of A, B, C is not unique (a tie between perfect substitutes).");
    }
    if (res.S && fin(res.S) && fin(res.A) && fin(res.C)) {
      lines.push(
        `Slutsky decomposition (purchasing power held constant: income m′ = m + Δp₁·x₁ᴬ = ${mPrimeR ? ex(mPrimeR) : nm(res.mSlutsky!)} buys the old bundle): S has ${bundleText(res.S, exS)}; substitution effect S − A = ${exS && exA ? ex(ratSub(exS.x, exA.x)) : nm(snap(res.S.x - res.A.x))}, income effect C − S = ${exS && exC ? ex(ratSub(exC.x, exS.x)) : nm(snap(res.C.x - res.S.x))}.`,
      );
    } else {
      lines.push("Slutsky decomposition: not defined, because demand at the old or new prices, or at the compensated income, is not unique.");
    }
    lines.push(`Compensating variation CV = e(p′, u₀) − m = ${nm(snap(res.cv))}; equivalent variation EV = m − e(p, u₁) = ${nm(snap(res.ev))} (positive numbers are losses from the price change).`);
    if (k === "leontief") lines.push("Perfect complements: the substitution effect is zero by construction (the indifference curves are L-shaped); the whole change is an income effect.");
    lines.push("");
    lines.push(
      "Conventions: the figure and the main decomposition are Hicks's (utility held at u₀: B is the cheapest bundle on u₀ at the new prices); the Slutsky line holds purchasing power constant instead. Effects are reported for good 1, whose price changes. " +
        (k === "ces" || k === "cd"
          ? `${k === "ces" ? "CES demands" : "Cobb–Douglas Hicksian demands, utilities and expenditures"} have no rational closed form for general parameters and are computed in floating point${k === "cd" ? "; the Marshallian and Slutsky bundles are exact rationals" : ""}.`
          : "Every bundle and income here is an exact rational."),
    );
    const row = (name: string, b: Bundle | null): string[] => (b && !b.tie ? [name, nm(b.x), nm(b.y)] : [name, "not unique", "not unique"]);
    const diff = (name: string, p: Bundle | null, q2: Bundle | null): string[] =>
      p && q2 && !p.tie && !q2.tie ? [name, nm(snap(q2.x - p.x)), nm(snap(q2.y - p.y))] : [name, "not defined", "not defined"];
    const tables: StatTable[] = [
      {
        label: "Bundles and effects of the price change",
        rows: [
          ["Bundle or effect", "Good 1", "Good 2"],
          row("A: before", res.A),
          row("B: Hicks-compensated", res.B),
          row("C: after", res.C),
          diff("Substitution effect (Hicks)", res.A, res.B),
          diff("Income effect (Hicks)", res.B, res.C),
          diff("Total effect", res.A, res.C),
          row("S: Slutsky-compensated", res.S),
          diff("Substitution effect (Slutsky)", res.A, res.S),
          diff("Income effect (Slutsky)", res.S, res.C),
        ],
        align: ["left", "right", "right"],
        note: "Decimals rounded to four places (four significant digits below 1); the text gives exact fractions where they exist.",
      },
      {
        label: "Utility and money measures",
        rows: [
          ["Measure", "Value"],
          ["Utility before u₀", nm(res.u0)],
          ["Utility after u₁", nm(res.u1)],
          ["Compensating income e(p′, u₀)", nm(res.eHicks)],
          ["Slutsky income m′", res.mSlutsky === null ? "not defined" : nm(res.mSlutsky)],
          ["Compensating variation", nm(snap(res.cv))],
          ["Equivalent variation", nm(snap(res.ev))],
        ],
        align: ["left", "right"],
      },
    ];
    const svg = consumerChoiceSvg({ u, m, p1, p1New: p1n, p2, eHicks: res.eHicks, u0: res.u0, u1: res.u1, A: res.A, B: res.B, C: res.C });
    // The reading: what the price change does to good 1, split into its two effects, and the money measure of the loss.
    const dir = rcmp(v.p1new, v.p1);
    const cvS = nm(snap(res.cv));
    const money =
      dir === 0
        ? ""
        : snap(res.cv) > 0
          ? ` The consumer would need ${cvS} more income to be as well off as before.`
          : snap(res.cv) < 0
            ? ` The consumer could give up ${unsigned(cvS)} of income and still be as well off as before.`
            : "";
    let lead: string;
    if (dir === 0) lead = fin(res.A) ? `The price of good 1 does not change (${ex(v.p1)}), so the choice stays at ${nm(res.A.x)} of good 1 and ${nm(res.A.y)} of good 2.` : `The price of good 1 does not change (${ex(v.p1)}), so nothing about the choice changes.`;
    else if (fin(res.A) && fin(res.B) && fin(res.C)) {
      lead =
        `The ${dir > 0 ? "rise" : "fall"} in the price of good 1 from ${ex(v.p1)} to ${ex(v.p1new)} moves its purchases from ${nm(res.A.x)} to ${nm(res.C.x)}: ` +
        `${nm(snap(res.B.x - res.A.x))} from substitution between the goods and ${nm(snap(res.C.x - res.B.x))} from the change in purchasing power.`;
    } else lead = `With the price of good 1 going from ${ex(v.p1)} to ${ex(v.p1new)}, the best bundle is not unique at one of the steps (the goods are equally good value), so the change cannot be split into effects.`;
    const reading = fitReading(lead + money, lead);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// micro-cost

/** AC, AVC and MC against output, with the shutdown and break-even points and the market price. */
export function costCurvesSvg(an: CostAnalysis, price: number | null, qStar: number | null): string {
  const hi = Math.max(an.qHi, qStar ?? 0);
  const ac: Point[] = [];
  const avc: Point[] = [];
  const mc: Point[] = [];
  const marks = [an.shutdown.value, an.breakEven?.value ?? 0, price ?? 0, mcN(an.cn, hi)];
  const yTop = Math.max(...marks) * 1.5 + 1e-9;
  for (let i = 1; i <= 200; i++) {
    const qq = (hi * i) / 200;
    const tc = polyN(an.cn, qq);
    const a = tc / qq;
    const v = (tc - an.cn[0]) / qq;
    const m = mcN(an.cn, qq);
    if (a <= yTop) ac.push({ x: qq, y: a });
    if (v <= yTop) avc.push({ x: qq, y: v });
    if (m <= yTop) mc.push({ x: qq, y: m });
  }
  const series: Series[] = [
    { type: "line", points: mc, color: "#b91c1c", label: "MC" },
    { type: "line", points: ac, color: "#0369a1", label: "AC" },
    { type: "line", points: avc, color: "#15803d", label: "AVC" },
  ];
  if (price !== null) series.push({ type: "line", points: [{ x: 0, y: price }, { x: hi, y: price }], color: "#9ca3af", label: "market price" });
  if (an.shutdown.q > 0) series.push({ type: "scatter", points: [{ x: an.shutdown.q, y: an.shutdown.value }], color: "#15803d", label: "shutdown (min AVC)" });
  if (an.breakEven && an.breakEven.q > 0 && !ratIsZero(an.c[0])) series.push({ type: "scatter", points: [{ x: an.breakEven.q, y: an.breakEven.value }], color: "#0369a1", label: "break-even (min AC)" });
  if (price !== null && qStar !== null && qStar > 0) series.push({ type: "scatter", points: [{ x: qStar, y: price }], color: "#7c3aed", label: "output at the price" });
  return buildPlotSvg(series.filter((s) => s.points.length > 0), { width: W, height: H, title: "Short-run cost curves", xlabel: "Output q", ylabel: "Cost per unit" });
}

export function microCostCalc(read: Read): StatOutput {
  return guarded(() => {
    const raw = get(read, "tc").trim();
    if (!raw) return refuse("Total cost coefficients: enter c₀ (the fixed cost), c₁, c₂, … separated by commas or semicolons.");
    let vals: number[];
    try {
      vals = readCalcList(raw).values;
    } catch (e) {
      if (e instanceof ListTokenError) return refuse(`Total cost coefficients: ${e.message}`);
      throw e;
    }
    if (vals.length < 2) return refuse("Total cost coefficients: enter at least c₀ and c₁ (TC = c₀ + c₁q + …).");
    if (vals.length > COST_MAX_DEGREE + 1) return refuse(`Total cost coefficients: at most ${COST_MAX_DEGREE + 1} (degree ${COST_MAX_DEGREE}).`);
    const c: Rat[] = [];
    for (let i = 0; i < vals.length; i++) {
      const r = Number.isFinite(vals[i]) && Math.abs(vals[i]) <= 1e12 ? ratOf(vals[i]) : undefined;
      if (!r) return refuse(`Total cost coefficients: c${"₀₁₂₃₄₅₆"[i]} is not a finite number of at most 10¹² in magnitude.`);
      c.push(r);
    }
    while (c.length > 2 && ratIsZero(c[c.length - 1])) c.pop();
    if (ratSign(c[0]) < 0) return refuse("Total cost coefficients: the fixed cost c₀ must be 0 or more.");
    const n = c.length - 1;
    if (ratSign(c[n]) <= 0) return refuse(`Total cost coefficients: the leading coefficient c${"₀₁₂₃₄₅₆"[n]} must be positive (otherwise cost eventually falls as output rises and AVC has no minimum).`);
    const price = ratField(read, "price", "The market price P", { min: 0, blank: null });
    if (typeof price === "string") return refuse(price);
    const qmax = ratField(read, "qmax", "The largest output plotted", { min: 0, minOpen: true, blank: null });
    if (typeof qmax === "string") return refuse(qmax);
    const an = costAnalysis(c, qmax ? ratToNumber(qmax) : null);
    if ("error" in an) return refuse(an.error);
    // A linear TC has a constant MC = c₁: above it output is unbounded, at it any output is optimal (stated, not solved).
    const linearMc = n === 1 && price ? rcmp(price, c[1]) : null;
    const sup: ReturnType<typeof supplyAt> | null = price && (linearMc === null || linearMc < 0) ? supplyAt(an, price) : null;
    const checkHi = Math.max(an.qHi, sup?.q ?? 0);
    const low = minMc(c, checkHi);
    if (low.v < 0) return refuse(`Marginal cost MC(q) = TC′(q) is negative near q = ${nm(low.q)} (MC ≈ ${nm(low.v)}): a total cost must not fall as output rises. Check the coefficients.`);
    if (!qmax && sup && !sup.shut) an.qHi = Math.max(an.qHi, sup.q * 1.3);
    const mcC = c.slice(1).map((v, i) => ratMul(v, R(i + 1)));
    const lines: string[] = [];
    lines.push(`Total cost TC(q) = ${polyText(c, "q")}; fixed cost FC = ${ex(c[0])}.`);
    lines.push(`VC(q) = ${polyText([RAT_ZERO, ...c.slice(1)], "q")}; AVC(q) = ${polyText(c.slice(1), "q")}; AC(q) = TC(q)/q; MC(q) = ${polyText(mcC, "q")}.`);
    const ptText = (p: CostPoint, what: string): string => {
      if (p.atZero) return `AVC has no interior minimum: it is lowest as q → 0, where AVC → c₁ = ${ex(c[1])}`;
      const qs = p.qExact ? ex(p.qExact) : `≈ ${nm(p.q)}`;
      const vs = p.valueExact ? ex(p.valueExact) : `≈ ${nm(p.value)}`;
      return `q ${qs.startsWith("≈") ? qs : "= " + qs}, ${what} = MC ${vs.startsWith("≈") ? vs : "= " + vs}`;
    };
    lines.push(`Shutdown point (minimum AVC, where MC = AVC): ${ptText(an.shutdown, "AVC")}. Below a price of ${an.shutdown.valueExact ? ex(an.shutdown.valueExact) : nm(an.shutdown.value)} the firm produces nothing in the short run.`);
    if (ratIsZero(c[0])) lines.push("With no fixed cost AC = AVC, so the break-even point is the shutdown point.");
    else if (an.breakEven) lines.push(`Break-even point (minimum AC, where MC = AC): ${ptText(an.breakEven, "AC")}. At prices above this the firm makes an economic profit; between the two points it produces at a loss smaller than its fixed cost.`);
    else lines.push("AC falls at every output (TC is linear, so AC = FC/q + c₁): there is no break-even minimum.");
    if (price && linearMc !== null && linearMc >= 0) {
      lines.push(
        linearMc > 0
          ? `At the market price P = ${ex(price)}, above the constant marginal cost c₁ = ${ex(c[1])}, every extra unit adds P − c₁ to profit: output is unbounded (no finite profit maximum; a linear TC cannot describe a price-taking firm's supply).`
          : `At the market price P = ${ex(price)}, equal to the constant marginal cost c₁, every output earns the same profit (−FC): output is not determined.`,
      );
    }
    if (price && sup) {
      if (sup.shut) lines.push(`At the market price P = ${ex(price)} (below the shutdown price) the firm shuts down: q = 0, loss = the fixed cost ${ex(c[0])}.`);
      else {
        const qs = sup.qExact ? `= ${ex(sup.qExact)}` : `≈ ${nm(sup.q)}`;
        const ps = sup.profitExact ? `= ${ex(sup.profitExact)}` : `≈ ${nm(sup.profit)}`;
        lines.push(`At the market price P = ${ex(price)}: output q ${qs} (P = MC on the rising branch), revenue ${nm(ratToNumber(price) * sup.q)}, profit ${ps}${sup.profit < 0 ? " (a loss, but smaller than the fixed cost: produce in the short run)" : ""}.`);
      }
    }
    lines.push("");
    lines.push(
      "Conventions: TC(q) = c₀ + c₁q + c₂q² + … with c₀ the fixed cost, read exactly as typed (decimals are exact rationals); shutdown = minimum of AVC over q > 0 (roots of Σ(k − 1)cₖqᵏ⁻² = 0), break-even = minimum of AC (roots of Σ(k − 1)cₖqᵏ − c₀ = 0). " +
        "Rational roots are found exactly (rational-root theorem); others by a sign-change scan and bisection, shown with ≈. Price-taking output: the largest root of MC(q) = P, when P is at least the minimum AVC.",
    );
    const grid: string[][] = [["Output q", "TC", "AVC", "AC", "MC"]];
    for (let i = 1; i <= 10; i++) {
      const qq = (an.qHi * i) / 10;
      const tc = polyN(an.cn, qq);
      grid.push([nm(qq), nm(tc), nm((tc - an.cn[0]) / qq), nm(tc / qq), nm(mcN(an.cn, qq))]);
    }
    const tables: StatTable[] = [
      { label: "Cost schedule", rows: grid, align: ["right", "right", "right", "right", "right"] },
      {
        label: "Key points",
        rows: [
          ["Point", "Output q", "Cost per unit"],
          ["Shutdown (min AVC)", an.shutdown.atZero ? "q → 0" : an.shutdown.qExact ? cellDec(an.shutdown.qExact) : nm(an.shutdown.q), an.shutdown.valueExact ? cellDec(an.shutdown.valueExact) : nm(an.shutdown.value)],
          ...(an.breakEven && !ratIsZero(c[0]) ? [["Break-even (min AC)", an.breakEven.qExact ? cellDec(an.breakEven.qExact) : nm(an.breakEven.q), an.breakEven.valueExact ? cellDec(an.breakEven.valueExact) : nm(an.breakEven.value)]] : []),
          ...(price && sup ? [["Output at the market price", sup.qExact ? cellDec(sup.qExact) : nm(sup.q), cellDec(price)]] : []),
        ],
        align: ["left", "right", "right"],
      },
    ];
    const svg = costCurvesSvg(an, price ? ratToNumber(price) : null, sup && !sup.shut ? sup.q : null);
    // The reading: what the firm should do at the market price, then its shutdown and break-even prices.
    const shutP = an.shutdown.valueExact ? ex(an.shutdown.valueExact) : nm(an.shutdown.value);
    const beP = !ratIsZero(c[0]) && an.breakEven ? (an.breakEven.valueExact ? ex(an.breakEven.valueExact) : nm(an.breakEven.value)) : null;
    const noBreakEven = !ratIsZero(c[0]) && !an.breakEven;
    const thresholds = noBreakEven
      ? `The firm should shut down at prices below ${shutP}; its average cost falls at every output, so there is no single break-even price.`
      : an.shutdown.atZero
        ? `The firm covers its variable cost at any price above ${ex(c[1])}${beP ? ` and all its costs above ${beP}` : ""}.`
        : beP
          ? `The firm should shut down at prices below ${shutP} and covers all its costs only above ${beP}.`
          : `The firm should shut down at prices below ${shutP}; with no fixed cost, any price above that covers all its costs.`;
    let lead = "";
    if (price && sup) {
      if (sup.shut) lead = `At a price of ${ex(price)}, below the shutdown price, the firm should produce nothing and loses its fixed cost of ${ex(c[0])}.`;
      else {
        const qS = sup.qExact ? ex(sup.qExact) : `about ${nm(sup.q)}`;
        const profS = sup.profitExact ? ex(sup.profitExact) : nm(sup.profit);
        lead =
          sup.profit >= 0
            ? `At a price of ${ex(price)} the firm should produce ${qS} units and makes a profit of ${sup.profitExact ? "" : "about "}${profS}.`
            : `At a price of ${ex(price)} the firm should still produce ${qS} units: it loses ${sup.profitExact ? "" : "about "}${profS.replace(/−/g, "")}, less than its fixed cost of ${ex(c[0])}.`;
      }
    } else if (price && linearMc !== null && linearMc >= 0) {
      lead = linearMc > 0 ? `At a price of ${ex(price)}, above the constant marginal cost, a linear cost gives no finite best output.` : `At a price of ${ex(price)}, equal to the constant marginal cost, every output earns the same profit.`;
    }
    const reading = fitReading(lead ? `${lead} ${thresholds}` : thresholds, lead || thresholds);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// micro-price-disc

/** Two market panels: demand, marginal revenue, marginal cost, the third-degree prices and the uniform price. */
export function priceDiscSvg(mk: { a: number; b: number }[], c: number, p3: (number | null)[], q3: number[], pu: number | null): string {
  const panels = mk.map((m, i) => {
    const qMax = m.a / m.b;
    const series: Series[] = [
      { type: "line", points: [{ x: 0, y: m.a }, { x: qMax, y: 0 }], color: "#0369a1", label: "demand" },
      { type: "line", points: [{ x: 0, y: m.a }, { x: qMax / 2, y: 0 }], color: "#9ca3af", label: "marginal revenue" },
      { type: "line", points: [{ x: 0, y: c }, { x: qMax, y: c }], color: "#b91c1c", label: "marginal cost" },
    ];
    if (pu !== null) series.push({ type: "line", points: [{ x: 0, y: pu }, { x: qMax, y: pu }], color: "#b45309", label: "uniform price" });
    if (p3[i] !== null) series.push({ type: "scatter", points: [{ x: q3[i], y: p3[i]! }], color: "#15803d", label: "third-degree price" });
    return buildPlotSvg(series, { width: 360, height: 270, title: `Market ${i + 1}`, xlabel: `Quantity Q${"₁₂"[i]}`, ylabel: "Price" });
  });
  return composePanels(panels, { cols: 2, gap: 8, idPrefix: "mpd" }).svg;
}

export function microPriceDiscCalc(read: Read): StatOutput {
  return guarded(() => {
    const v = ratFields(read, [
      ["a1", "Market 1 demand intercept a₁", { min: 0, minOpen: true }],
      ["b1", "Market 1 demand slope b₁", { min: 0, minOpen: true }],
      ["a2", "Market 2 demand intercept a₂", { min: 0, minOpen: true }],
      ["b2", "Market 2 demand slope b₂", { min: 0, minOpen: true }],
      ["c", "The marginal cost c", { min: 0 }],
    ]);
    if (typeof v === "string") return refuse(v);
    const res = priceDiscrimination([{ a: v.a1, b: v.b1 }, { a: v.a2, b: v.b2 }], v.c);
    if ("error" in res) return refuse(res.error);
    const lines: string[] = [];
    lines.push(`Two markets with inverse demands P₁ = ${ex(v.a1)} ${MINUS} ${slopeQ(v.b1)}Q₁ and P₂ = ${ex(v.a2)} ${MINUS} ${slopeQ(v.b2)}Q₂; constant marginal cost c = ${ex(v.c)} (no fixed cost).`);
    const pq = (s: PdScheme, i: number): string => (s.p[i] ? `P${"₁₂"[i]} = ${ex(s.p[i]!)}, Q${"₁₂"[i]} = ${ex(s.q[i])}` : `market ${i + 1} not served`);
    lines.push(
      `Uniform monopoly price: P = ${ex(res.uniformPrice)} (${res.uniformServesBoth ? "both markets served, on the lower segment of the kinked aggregate demand" : "only the market with the higher intercept is served"}); ${pq(res.uniform, 0)}; ${pq(res.uniform, 1)}; profit ${ex(res.uniform.profit)}.`,
    );
    if (res.uniformTie) lines.push("The two segments of the kinked demand give the same uniform profit; the price serving both markets is reported.");
    lines.push(`Third-degree discrimination (MR = c in each market): ${pq(res.third, 0)}; ${pq(res.third, 1)}; profit ${ex(res.third.profit)}.`);
    lines.push(`First-degree (perfect) discrimination: each buyer pays their own value down to c; Q₁ = ${ex(res.first.q[0])}, Q₂ = ${ex(res.first.q[1])}; profit = total surplus = ${ex(res.first.profit)}, no deadweight loss.`);
    const totU = ratAdd(res.uniform.q[0], res.uniform.q[1]);
    const tot3 = ratAdd(res.third.q[0], res.third.q[1]);
    if (res.uniformServesBoth && res.third.p.every((p) => p !== null)) {
      // Identical prices in the two markets (the same demands, or the same monopoly price in each): discrimination changes
      // nothing, so the "misallocates output" sentence would contradict the 0 change printed below.
      const samePrices = res.third.p[0] !== null && res.third.p[1] !== null && ratEq(res.third.p[0]!, res.third.p[1]!);
      const sameOut = ratEq(totU, tot3);
      lines.push(
        `Total output is ${sameOut ? "the same" : "different"} under uniform pricing (${ex(totU)}) and third-degree discrimination (${ex(tot3)})${
          sameOut
            ? samePrices
              ? ": the discriminating prices are the same in both markets, so discrimination changes nothing here (the same prices, quantities and surplus as uniform pricing)"
              : ", as it must be with linear demands when both markets are served either way; discrimination then lowers total surplus by misallocating that output"
            : ""
        }.`,
      );
    } else {
      lines.push(`Total output: uniform ${ex(totU)}, third-degree ${ex(tot3)}${rcmp(tot3, totU) > 0 ? ": discrimination opens a market the uniform price leaves unserved" : ""}.`);
    }
    const dTS = ratSub(res.third.ts, res.uniform.ts);
    lines.push(`Welfare: total surplus uniform ${ex(res.uniform.ts)}, third-degree ${ex(res.third.ts)} (${ratSign(dTS) > 0 ? "+" : ""}${ex(dTS)} against uniform), first-degree ${ex(res.first.ts)} (the efficient maximum).`);
    lines.push("");
    lines.push(
      "Conventions: linear inverse demands Pᵢ = aᵢ − bᵢQᵢ, constant marginal cost, no resale between markets (arbitrage ruled out), read exactly as typed so every result is an exact rational. " +
        "Uniform price: the profit maximum on each segment of the kinked aggregate demand (one market served, then both), clamped to the segment, the higher profit chosen. Consumer surplus ½bᵢQᵢ² per market; deadweight loss against the efficient output (price = c).",
    );
    const cell = (r: Rat | null): string => (r === null ? "not served" : cellDec(r));
    const t: StatTable = {
      label: "Uniform price against price discrimination",
      rows: [
        ["Measure", "Uniform", "Third-degree", "First-degree"],
        ["Price in market 1", cell(res.uniform.p[0]), cell(res.third.p[0]), ratSign(res.first.q[0]) > 0 ? "each buyer's value" : "not served"],
        ["Price in market 2", cell(res.uniform.p[1]), cell(res.third.p[1]), ratSign(res.first.q[1]) > 0 ? "each buyer's value" : "not served"],
        ["Quantity in market 1", cellDec(res.uniform.q[0]), cellDec(res.third.q[0]), cellDec(res.first.q[0])],
        ["Quantity in market 2", cellDec(res.uniform.q[1]), cellDec(res.third.q[1]), cellDec(res.first.q[1])],
        ["Total quantity", cellDec(totU), cellDec(tot3), cellDec(ratAdd(res.first.q[0], res.first.q[1]))],
        ["Profit", cellDec(res.uniform.profit), cellDec(res.third.profit), cellDec(res.first.profit)],
        ["Consumer surplus", cellDec(res.uniform.cs), cellDec(res.third.cs), cellDec(res.first.cs)],
        ["Total surplus", cellDec(res.uniform.ts), cellDec(res.third.ts), cellDec(res.first.ts)],
        ["Deadweight loss", cellDec(res.uniform.dwl), cellDec(res.third.dwl), cellDec(res.first.dwl)],
      ],
      align: ["left", "right", "right", "right"],
      note: "Decimals exact within four places, else rounded; the text gives exact fractions.",
    };
    const svg = priceDiscSvg(
      [{ a: ratToNumber(v.a1), b: ratToNumber(v.b1) }, { a: ratToNumber(v.a2), b: ratToNumber(v.b2) }],
      ratToNumber(v.c),
      res.third.p.map((p) => (p ? ratToNumber(p) : null)),
      res.third.q.map(ratToNumber),
      ratToNumber(res.uniformPrice),
    );
    // The reading: separate prices against one price, for the seller and for total surplus.
    const prices = res.third.p.map((p, i) => (p === null ? `market ${i + 1} not served` : cellDec(p)));
    const tsMove = ratSign(dTS) > 0 ? "raises" : ratSign(dTS) < 0 ? "lowers" : "leaves";
    const tsText = ratSign(dTS) === 0 ? `leaves total surplus at ${cellDec(res.third.ts)}` : `${tsMove} total surplus from ${cellDec(res.uniform.ts)} to ${cellDec(res.third.ts)}`;
    const profitText = ratEq(res.third.profit, res.uniform.profit)
      ? `leaves profit at ${cellDec(res.third.profit)}`
      : `raises profit from ${cellDec(res.uniform.profit)} to ${cellDec(res.third.profit)}`;
    const both = res.third.p.every((p) => p !== null);
    const charging = both ? `Charging the two markets separate prices (${prices.join(" and ")})` : `Pricing each market on its own (${prices.join("; ")})`;
    const reading = `${charging} instead of one uniform price ${profitText} and ${tsText}.`;
    return { text: lines.join("\n"), reading, tables: [t], svg };
  });
}

// =================================================================================================================
// micro-auction

/** Equilibrium bids against value (first and second price) and expected revenue against the reserve price. */
export function auctionSvg(n: number, lo: number, hi: number, r: number, rStar: number): string {
  const span = hi - lo;
  const s = Math.max(0, (r - lo) / span);
  const fpa: Point[] = [];
  const spa: Point[] = [];
  for (let i = 0; i <= 100; i++) {
    const v = lo + (span * i) / 100;
    const u = (v - lo) / span;
    spa.push({ x: v, y: v });
    if (u >= s && u > 0) fpa.push({ x: v, y: lo + span * (u - (Math.pow(u, n) - Math.pow(s, n)) / (n * Math.pow(u, n - 1))) });
  }
  const bids: Series[] = [
    { type: "line", points: spa, color: "#b45309", label: "second price" },
    { type: "line", points: fpa, color: "#0369a1", label: "first price" },
  ];
  if (s > 0) bids.push({ type: "scatter", points: [{ x: r, y: r }], color: "#b91c1c", label: "reserve" });
  const revAt = (rr: number): number => {
    const ss = Math.max(0, (rr - lo) / span);
    const sn = Math.pow(ss, n);
    return lo * (1 - sn) + span * ((n - 1) / (n + 1) + sn - (2 * n * sn * ss) / (n + 1));
  };
  const rev: Point[] = [];
  for (let i = 0; i < 100; i++) {
    const rr = lo + (span * i) / 100;
    rev.push({ x: rr, y: revAt(rr) });
  }
  const rs: Series[] = [
    { type: "line", points: rev, color: "#15803d", label: "expected revenue" },
    { type: "scatter", points: [{ x: rStar, y: revAt(rStar) }], color: "#7c3aed", label: "optimal reserve" },
  ];
  if (s > 0) rs.push({ type: "scatter", points: [{ x: r, y: revAt(r) }], color: "#b91c1c", label: "reserve entered" });
  const a = buildPlotSvg(bids, { width: 360, height: 270, title: `Equilibrium bids, ${n} bidders`, xlabel: "Value v", ylabel: "Bid" });
  const b = buildPlotSvg(rs, { width: 360, height: 270, title: "Expected revenue against the reserve", xlabel: "Reserve price r", ylabel: "Expected revenue" });
  return composePanels([a, b], { cols: 2, gap: 8, idPrefix: "mauc" }).svg;
}

export function microAuctionCalc(read: Read): StatOutput {
  return guarded(() => {
    const nR = ratField(read, "n", "The number of bidders n", { min: 2, max: AUCTION_MAX_N, int: true });
    if (typeof nR === "string" || nR === null) return refuse(nR ?? "The number of bidders n is empty.");
    const n = Number(nR.n);
    const v = ratFields(read, [
      ["lo", "The lowest value"],
      ["hi", "The highest value"],
    ]);
    if (typeof v === "string") return refuse(v);
    if (rcmp(v.hi, v.lo) <= 0) return refuse("The highest value must be greater than the lowest value.");
    const reserve = ratField(read, "reserve", "The reserve price", { blank: v.lo });
    if (typeof reserve === "string") return refuse(reserve);
    const v0 = ratField(read, "v0", "The seller's value", { blank: RAT_ZERO });
    if (typeof v0 === "string") return refuse(v0);
    if (rcmp(reserve!, v.hi) >= 0) return refuse("The reserve price must be below the highest value (otherwise the object is never sold).");
    if (rcmp(v0!, v.hi) >= 0) return refuse("The seller's value must be below the highest value (otherwise the seller never wants to sell).");
    const rStar = optimalReserve(v.lo, v.hi, v0!);
    // Exact rationals unless the n-th powers would run to thousands of digits (then the same closed forms in floating point).
    const exact = auctionExactCost(n, [v.lo, v.hi, reserve!, v0!]) <= AUCTION_EXACT_BITS;
    type V = Rat | number;
    const N = (x: V): number => (typeof x === "number" ? x : ratToNumber(x));
    const dv = (x: V): string => (typeof x === "number" ? (Math.abs(x) < 1e-12 * Math.max(1, Math.abs(N(v.hi)), Math.abs(N(v.lo))) ? "0" : `≈ ${nm(x)}`) : ex(x));
    const cv = (x: V): string => (typeof x === "number" ? nm(x) : cellDec(x));
    type View = { [K in keyof ReturnType<typeof auctionNum>]: V };
    const solve = (r: Rat): View => (exact ? auction(n, v.lo, v.hi, r) : auctionNum(n, N(v.lo), N(v.hi), N(r)));
    const res = solve(reserve!);
    const resStar = solve(rStar);
    const sIsZero = N(res.s) === 0;
    const payoff = (a: View): V =>
      typeof a.revFirst === "number" || typeof a.pSale === "number" ? N(a.revFirst) + N(v0!) * (1 - N(a.pSale)) : ratAdd(a.revFirst, ratMul(v0!, ratSub(RAT_ONE, a.pSale)));
    const equalRev = typeof res.revFirst === "number" ? Math.abs(N(res.revFirst) - N(res.revSecond)) <= 1e-9 * Math.max(1, Math.abs(N(res.revFirst))) : ratEq(res.revFirst, res.revSecond as Rat);
    const lines: string[] = [];
    lines.push(`${n} risk-neutral bidders with private values independent and uniform on [${ex(v.lo)}, ${ex(v.hi)}]; reserve price ${!sIsZero ? ex(reserve!) : "none (at or below the lowest value)"}.`);
    const span = ratSub(v.hi, v.lo);
    if (sIsZero) {
      lines.push(`First-price auction: the symmetric equilibrium bid is b(v) = lo + ((n − 1)/n)·(v − lo) = ${ratIsZero(v.lo) ? "" : `${ex(v.lo)} + `}${ex({ n: BigInt(n - 1), d: BigInt(n) })}·${ratIsZero(v.lo) ? "v" : `(v ${ratSign(v.lo) > 0 ? MINUS : "+"} ${ex(ratSign(v.lo) > 0 ? v.lo : ratNeg(v.lo))})`}: each bidder shades the bid to the expected second-highest value given that theirs is highest.`);
    } else {
      lines.push(`First-price auction with reserve r: for v ≥ r the equilibrium bid is b(v) = v − (F(v)ⁿ − F(r)ⁿ)/(n·F(v)ⁿ⁻¹)·(hi − lo), F(v) = (v − lo)/(hi − lo); bidders with v < r do not bid.`);
    }
    lines.push("Second-price auction: bidding one's value is a weakly dominant strategy; the winner pays the larger of the second-highest bid and the reserve.");
    lines.push(`Expected revenue: first price ${dv(res.revFirst)}, second price ${dv(res.revSecond)}: ${equalRev ? (exact ? "equal exactly (revenue equivalence: same allocation, losers pay nothing)" : "equal to floating-point precision (revenue equivalence: same allocation, losers pay nothing)") : "NOT equal (check the inputs)"}.`);
    if (sIsZero) lines.push(`Without a reserve this is E[second-highest value] = lo + (hi − lo)·(n − 1)/(n + 1) = ${dv(res.eSecond)}; the expected highest value is ${dv(res.eMax)}.`);
    lines.push(`Probability of a sale ${dv(res.pSale)}; each bidder's expected surplus ${dv(res.bidderSurplus)}; seller's expected payoff (revenue + value × probability of no sale) ${dv(payoff(res))}.`);
    lines.push(`Optimal (Myerson) reserve for a seller who values the object at v₀ = ${ex(v0!)}: r* = (hi + v₀)/2 = ${ex(rStar)}${rcmp(rStar, v.lo) === 0 && rcmp(ratDiv(ratAdd(v.hi, v0!), R(2)), v.lo) < 0 ? " (raised to the lowest value: no reserve binds)" : ""}, independent of n; expected revenue there ${dv(resStar.revFirst)}, seller's payoff ${dv(payoff(resStar))}.`);
    lines.push("");
    lines.push(
      "Conventions: independent private values, uniform on [lo, hi]; risk-neutral bidders; symmetric Bayesian Nash equilibrium (first price) and weakly dominant truthful bidding (second price); the seller's value v₀ only enters the optimal reserve and the seller's payoff. " +
        (exact
          ? "Every result is an exact rational from closed forms (order statistics of the uniform), each auction from its own formula."
          : `The closed forms (order statistics of the uniform, each auction from its own formula) are evaluated in floating point: with these inputs and n = ${n} the exact fractions would run to thousands of digits.`),
    );
    const grid: string[][] = [["Value v", "First-price bid", "Second-price bid"]];
    for (let i = 0; i <= 5; i++) {
      const val = ratAdd(v.lo, ratMul(span, { n: BigInt(i), d: 5n }));
      const bidOK = N(val) >= N(res.r) && (exact ? rcmp(val, res.r as Rat) >= 0 : true);
      const bid: V = exact ? firstPriceBid(n, v.lo, v.hi, res.s as Rat, val) : firstPriceBidNum(n, N(v.lo), N(v.hi), N(res.s), N(val));
      grid.push([cellDec(val), bidOK ? cv(bid) : "no bid", bidOK ? cellDec(val) : "no bid"]);
    }
    const tables: StatTable[] = [
      { label: "Equilibrium bids", rows: grid, align: ["right", "right", "right"] },
      {
        label: "Revenue at the reserve entered and at the optimal reserve",
        rows: [
          ["Measure", `Reserve ${!sIsZero ? cellDec(reserve!) : "none"}`, `Optimal reserve ${cellDec(rStar)}`],
          ["Probability of a sale", cv(res.pSale), cv(resStar.pSale)],
          ["Expected revenue, first price", cv(res.revFirst), cv(resStar.revFirst)],
          ["Expected revenue, second price", cv(res.revSecond), cv(resStar.revSecond)],
          ["Seller's expected payoff", cv(payoff(res)), cv(payoff(resStar))],
          ["Each bidder's expected surplus", cv(res.bidderSurplus), cv(resStar.bidderSurplus)],
        ],
        align: ["left", "right", "right"],
      },
    ];
    const svg = auctionSvg(n, N(v.lo), N(v.hi), N(res.r), N(rStar));
    // The reading: expected revenue in both formats, then what the optimal reserve does for the seller.
    const revText = equalRev ? `both a first-price and a second-price auction are expected to raise ${cv(res.revFirst)}` : `a first-price auction is expected to raise ${cv(res.revFirst)} and a second-price auction ${cv(res.revSecond)}`;
    const pay0 = N(payoff(res));
    const pay1 = N(payoff(resStar));
    const same = Math.abs(pay1 - pay0) <= 1e-9 * Math.max(1, Math.abs(pay0));
    const resText = same
      ? ` No other reserve price would do better for the seller (the best is ${cellDec(rStar)}).`
      : ` A reserve price of ${cellDec(rStar)} would raise the seller's expected payoff from ${cv(payoff(res))} to ${cv(payoff(resStar))}.`;
    const lead = `With ${n} bidders ${!sIsZero ? `and a reserve of ${cellDec(reserve!)}` : "and no reserve"}, ${revText}.`;
    const reading = fitReading(lead + resText, lead);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// macro-growth-accounting

export const GROWTH_DATA_DEFAULT = [
  "Year\tY\tK\tL",
  "2014\t1000\t3000\t500",
  "2015\t1031\t3093\t505",
  "2016\t1058\t3189\t509",
  "2017\t1092\t3290\t515",
  "2018\t1124\t3394\t520",
  "2019\t1151\t3498\t524",
  "2020\t1118\t3571\t510",
  "2021\t1176\t3660\t518",
  "2022\t1212\t3770\t526",
  "2023\t1243\t3881\t531",
  "2024\t1275\t3995\t536",
].join("\n");

/** Cumulative growth since the first period: output and its three sources (percent, log or compounded). */
export function growthAccountingSvg(labels: string[], xs: number[], cum: { y: number[]; k: number[]; l: number[]; a: number[] }): string {
  const s = (vals: number[]): Point[] => vals.map((v, i) => ({ x: xs[i], y: v * 100 }));
  return buildPlotSvg(
    [
      { type: "line", points: s(cum.y), color: "#111827", label: "output growth" },
      { type: "line", points: s(cum.k), color: "#0369a1", label: "capital contribution" },
      { type: "line", points: s(cum.l), color: "#b45309", label: "labor contribution" },
      { type: "line", points: s(cum.a), color: "#15803d", label: "TFP (Solow residual)" },
    ],
    { width: W, height: H, title: "Growth accounting: cumulative contributions", xlabel: labels.length && /^\d{4}$/.test(labels[0]) ? "Year" : "Period", ylabel: "Cumulative growth since the first period (%)" },
  );
}

export function macroGrowthCalc(read: Read): StatOutput {
  return guarded(() => {
    const parsed = parseSeriesTable(get(read, "data"), { minRows: 2 });
    if (!parsed.ok) return refuse(`Data: ${parsed.reason}`);
    const d = parsed.data;
    if (d.n > 2000) return refuse(`Data: ${intText(d.n)} rows; the most is 2,000.`);
    const cols: Float64Array[] = [];
    const names: string[] = [];
    for (const [key, dflt, what] of [["ycol", "Y", "Output"], ["kcol", "K", "Capital"], ["lcol", "L", "Labor"]] as const) {
      const p = pickSeries(d, get(read, key).trim() || dflt);
      if (!p.ok) return refuse(`${what} column: ${p.reason}`);
      for (let i = 0; i < p.values.length; i++) if (!(p.values[i] > 0) || !Number.isFinite(p.values[i])) return refuse(`${what} column ${q(p.name)}, row ${i + 1}: every value must be a positive number (growth rates need logs or ratios).`);
      cols.push(p.values);
      names.push(p.name);
    }
    const alphaR = ratField(read, "alpha", "The capital share α", { min: 0, minOpen: true, max: 1, maxOpen: true });
    if (typeof alphaR === "string" || alphaR === null) return refuse(alphaR ?? "The capital share α is empty.");
    const alpha = ratToNumber(alphaR);
    const kind = pick(read, "growth", ["log", "simple"], "log", "Growth rates");
    if (typeof kind !== "string") return refuse(kind.error);
    const [Y, K, L] = cols;
    const rows = growthAccounting(Y, K, L, alpha, kind as GrowthKind);
    const tfp = tfpIndex(Y, K, L, alpha);
    const labels = d.dates ? d.dates.tokens.map((t) => t.label) : Array.from({ length: d.n }, (_, i) => `period ${i + 1}`);
    const xs = d.dates && d.dates.frequency === "year" ? labels.map(Number) : labels.map((_, i) => i);
    const T = rows.length;
    const mean = (f: (r: (typeof rows)[number]) => number): number => rows.reduce((s, r) => s + f(r), 0) / T;
    const mY = mean((r) => r.gY);
    const mK = mean((r) => r.capital);
    const mL = mean((r) => r.labour);
    const mA = mean((r) => r.tfp);
    const lines: string[] = [];
    lines.push(`Growth accounting over ${T} period${T === 1 ? "" : "s"} (${labels[0]} to ${labels[d.n - 1]}), output ${q(names[0])}, capital ${q(names[1])}, labor ${q(names[2])}, capital share α = ${ex(alphaR)}.`);
    lines.push(`Average growth per period: output ${pctN(mY)} = capital α·gK ${pctN(mK)} + labor (1 − α)·gL ${pctN(mL)} + TFP (Solow residual) ${pctN(mA)}.`);
    if (Math.abs(mY) > 1e-12) lines.push(`Shares of average output growth: capital ${pctN(mK / mY, 1)}, labor ${pctN(mL / mY, 1)}, TFP ${pctN(mA / mY, 1)}.`);
    lines.push(`Labor productivity Y/L grew ${pctN(mean((r) => r.gY - r.gL))} a period on average, of which capital deepening α·g(K/L) ${pctN(mean((r) => alpha * (r.gK - r.gL)))} and TFP ${pctN(mA)}.`);
    lines.push(`TFP level A = Y/(K^α·L^(1 − α)) indexed to 100 in ${labels[0]}: ${fx(tfp[d.n - 1], 2)} in ${labels[d.n - 1]}.`.replace("K^α·L^(1 − α)", "Kᵅ·L¹⁻ᵅ"));
    lines.push(...d.notes);
    lines.push("");
    lines.push(
      `Conventions: Cobb–Douglas Y = A·Kᵅ·L¹⁻ᵅ with constant returns and factor shares α and 1 − α; growth rates are ${kind === "log" ? "log differences ln(Xₜ/Xₜ₋₁), so the decomposition gY = α·gK + (1 − α)·gL + gA is exact (gX the growth rate of X) and the cumulative figure adds up" : "simple rates Xₜ/Xₜ₋₁ − 1; the residual gA = gY − α·gK − (1 − α)·gL (gX the growth rate of X) absorbs the cross terms (log differences would make it exact)"}. ` +
        "The Solow residual measures everything not explained by measured capital and labor (technology, efficiency, measurement error, utilization).",
    );
    const showRows = T <= 60 ? rows.map((_, i) => i) : [...Array.from({ length: 40 }, (_, i) => i), -1, ...Array.from({ length: 15 }, (_, i) => T - 15 + i)];
    const tbl: string[][] = [["Period", "Output growth", "Capital α·gK", "Labor (1 − α)·gL", "TFP residual"]];
    for (const i of showRows) {
      if (i < 0) tbl.push(["…", "…", "…", "…", "…"]);
      else tbl.push([labels[i + 1], pctN(rows[i].gY), pctN(rows[i].capital), pctN(rows[i].labour), pctN(rows[i].tfp)]);
    }
    tbl.push(["Average", pctN(mY), pctN(mK), pctN(mL), pctN(mA)]);
    const cum = { y: [0], k: [0], l: [0], a: [0] };
    for (const r of rows) {
      cum.y.push(cum.y[cum.y.length - 1] + r.gY);
      cum.k.push(cum.k[cum.k.length - 1] + r.capital);
      cum.l.push(cum.l[cum.l.length - 1] + r.labour);
      cum.a.push(cum.a[cum.a.length - 1] + r.tfp);
    }
    const tables: StatTable[] = [{ label: "Growth accounting by period", rows: tbl, align: ["left", "right", "right", "right", "right"], note: `Growth rates per period, ${kind === "log" ? "log differences" : "simple rates"}, in percent.` }];
    const svg = growthAccountingSvg(labels, xs, cum);
    // The reading: average output growth and where it came from.
    const grew = mY > 0 ? `grew ${pctN(mY)}` : mY < 0 ? `shrank ${pctN(-mY)}` : `did not grow`;
    const tfpShare = Math.abs(mY) > 1e-12 && mY > 0 ? ` (${pctN(mA / mY, 1)} of the total)` : "";
    const reading = fitReading(
      `Output ${grew} a period on average over ${labels[0]} to ${labels[d.n - 1]}: capital contributed ${pctN(mK)}, labor ${pctN(mL)} and productivity growth (TFP, the part capital and labor do not explain) ${pctN(mA)}${tfpShare}.`,
      `Output ${grew} a period on average: capital contributed ${pctN(mK)}, labor ${pctN(mL)} and productivity growth (TFP) ${pctN(mA)}${tfpShare}.`,
    );
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// macro-mundell-fleming

/** IS, LM and BP in (Y, r) before and after the policy (the IS at the new exchange rate). */
export function isLmBpSvg(p0: MfParams, s0: MfSolution, p1: MfParams, s1: MfSolution, regime: MfRegime): string {
  const num = ratToNumber;
  const Ys = [num(s0.Y), num(s1.Y)];
  const rs = [num(s0.r), num(s1.r)];
  const span = Math.max(Math.abs(Ys[1] - Ys[0]) * 1.5, 0.4 * Math.max(...Ys.map(Math.abs)), 1);
  const lo = Math.max(0, Math.min(...Ys) - span);
  const hi = Math.max(...Ys) + span;
  const rspan = Math.max(4, Math.abs(rs[1] - rs[0]) * 2, Math.max(...rs.map(Math.abs)) * 0.8);
  const rlo = Math.min(...rs) - rspan;
  const rhi = Math.max(...rs) + rspan;
  const segment = (a: number, b: number, c: number): Point[] => {
    const pts: Point[] = [];
    const add = (x: number, y: number): void => {
      const ex2 = 1e-9 * (hi - lo);
      const ey = 1e-9 * (rhi - rlo);
      if (x >= lo - ex2 && x <= hi + ex2 && y >= rlo - ey && y <= rhi + ey && !pts.some((p) => Math.abs(p.x - x) <= ex2 && Math.abs(p.y - y) <= ey)) pts.push({ x, y });
    };
    if (b !== 0) {
      add(lo, (c - a * lo) / b);
      add(hi, (c - a * hi) / b);
    }
    if (a !== 0) {
      add((c - b * rlo) / a, rlo);
      add((c - b * rhi) / a, rhi);
    }
    pts.sort((u, v) => u.x - v.x || u.y - v.y);
    return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : [];
  };
  // IS: (1 − c + m)Y + b·r = C₀ − cT + I₀ + G + NX₀ + n·e; LM: kY − h·r = M/P; BP: r = r*, or −mY + f·r = f·r* − NX₀ − n·e.
  const curves = (p: MfParams, s: MfSolution): { is: Point[]; lm: Point[]; bp: Point[] } => {
    const auto = num(p.C0) - num(p.c) * num(p.T) + num(p.I0) + num(p.G) + num(p.NX0) + num(p.n) * num(s.e);
    return {
      is: segment(1 - num(p.c) + num(p.m), num(p.b), auto),
      lm: segment(num(p.k), -num(p.h), num(s.M) / num(p.P)),
      bp: p.f === null ? segment(0, 1, num(p.rw)) : segment(-num(p.m), num(p.f), num(p.f) * num(p.rw) - num(p.NX0) - num(p.n) * num(s.e)),
    };
  };
  const c0 = curves(p0, s0);
  const c1 = curves(p1, s1);
  const same = (a: Point[], b: Point[]): boolean => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 * (hi - lo) && Math.abs(p.y - b[i].y) < 1e-9 * (rhi - rlo));
  const series: Series[] = [
    { type: "line", points: c0.is, color: "#0369a1", label: "IS" },
    { type: "line", points: c0.lm, color: "#b45309", label: "LM" },
    { type: "line", points: c0.bp, color: "#6b7280", label: p0.f === null ? "BP (r = r*)" : "BP" },
  ];
  // Under floating rates a fiscal shift moves the IS before the exchange rate moves it back (part or all of the way).
  if (regime === "floating" && !ratEq(p0.G, p1.G)) {
    const mid = curves(p1, s0).is;
    if (!same(mid, c1.is)) series.push({ type: "line", points: mid, color: "#c4b5fd", label: "IS before e adjusts" });
  }
  if (!same(c0.is, c1.is)) series.push({ type: "line", points: c1.is, color: "#7dd3fc", label: "IS after" });
  if (!same(c0.lm, c1.lm)) series.push({ type: "line", points: c1.lm, color: "#fcd34d", label: "LM after" });
  if (!same(c0.bp, c1.bp)) series.push({ type: "line", points: c1.bp, color: "#d1d5db", label: "BP after" });
  series.push({ type: "scatter", points: [{ x: Ys[0], y: rs[0] }], color: "#15803d", label: "equilibrium" });
  if (Math.abs(Ys[1] - Ys[0]) > 1e-12 || Math.abs(rs[1] - rs[0]) > 1e-12) series.push({ type: "scatter", points: [{ x: Ys[1], y: rs[1] }], color: "#7c3aed", label: "after the policy" });
  return buildPlotSvg(series.filter((s) => s.points.length > 0), {
    width: W,
    height: H,
    title: `IS–LM–BP, ${regime} exchange rate`,
    xlabel: "Output Y (per period)",
    ylabel: "Interest rate r (%)",
    xLimits: { min: lo, max: hi },
    yLimits: { min: rlo, max: rhi },
  });
}

export function macroMundellFlemingCalc(read: Read): StatOutput {
  return guarded(() => {
    const v = ratFields(read, [
      ["C0", "Autonomous consumption C₀"],
      ["c", "The marginal propensity to consume c", { min: 0, max: 1, maxOpen: true }],
      ["T", "Taxes T"],
      ["I0", "Autonomous investment I₀"],
      ["b", "The investment sensitivity b", { min: 0 }],
      ["G", "Government spending G"],
      ["NX0", "Autonomous net exports NX₀"],
      ["n", "The net-export sensitivity to the exchange rate n", { min: 0, minOpen: true }],
      ["m", "The marginal propensity to import m", { min: 0, max: 1, maxOpen: true }],
      ["M", "The money supply M", { min: 0, minOpen: true }],
      ["P", "The price level P", { min: 0, minOpen: true }],
      ["k", "The income sensitivity of money demand k", { min: 0, minOpen: true }],
      ["h", "The interest sensitivity of money demand h", { min: 0 }],
      ["rw", "The world interest rate r*", { percent: true }],
      ["e0", "The pegged exchange rate e₀", { min: 0, minOpen: true }],
    ]);
    if (typeof v === "string") return refuse(v);
    const mob = pick(read, "mobility", ["perfect", "imperfect"], "perfect", "Capital mobility");
    if (typeof mob !== "string") return refuse(mob.error);
    let f: Rat | null = null;
    if (mob === "imperfect") {
      const fr = ratField(read, "f", "The capital-flow sensitivity f", { min: 0, minOpen: true });
      if (typeof fr === "string" || fr === null) return refuse(fr ?? "The capital-flow sensitivity f is empty.");
      f = fr;
    }
    const regime = pick(read, "regime", ["floating", "fixed"], "floating", "Exchange-rate regime") as MfRegime | { error: string };
    if (typeof regime !== "string") return refuse(regime.error);
    const shock = pick(read, "shock", ["fiscal", "monetary", "devaluation"], "fiscal", "Policy in the figure");
    if (typeof shock !== "string") return refuse(shock.error);
    const d = ratFields(read, [
      ["dG", "The change in G", { blank: RAT_ZERO }],
      ["dM", "The change in M", { blank: RAT_ZERO }],
      ["de", "The devaluation Δe", { blank: RAT_ZERO }],
    ]);
    if (typeof d === "string") return refuse(d);
    const p: MfParams = { C0: v.C0, c: v.c, T: v.T, I0: v.I0, b: v.b, G: v.G, NX0: v.NX0, n: v.n, m: v.m, M: v.M, P: v.P, k: v.k, h: v.h, rw: v.rw, f, e0: v.e0 };
    const base: Record<MfRegime, MfSolution | null> = { floating: mfSolve(p, "floating"), fixed: mfSolve(p, "fixed") };
    if (!base.floating || !base.fixed) return refuse("The IS, LM and BP equations are singular for these coefficients (two curves are parallel): check k, h, b, f and m.");
    const exps: { name: string; regime: MfRegime; p1: MfParams; note?: string }[] = [
      { name: "Fiscal ΔG, floating", regime: "floating", p1: { ...p, G: ratAdd(p.G, d.dG) } },
      { name: "Fiscal ΔG, fixed", regime: "fixed", p1: { ...p, G: ratAdd(p.G, d.dG) } },
      { name: "Monetary ΔM, floating", regime: "floating", p1: { ...p, M: ratAdd(p.M, d.dM) } },
      { name: "Monetary ΔM, fixed", regime: "fixed", p1: p, note: "reversed by reserve flows" },
      { name: "Devaluation Δe, fixed", regime: "fixed", p1: { ...p, e0: ratAdd(p.e0, d.de) } },
    ];
    const out = exps.map((x) => {
      const s1 = mfSolve(x.p1, x.regime)!;
      const s0 = base[x.regime]!;
      return { ...x, s0, s1, dY: ratSub(s1.Y, s0.Y), dr: ratSub(s1.r, s0.r), de: ratSub(s1.e, s0.e), dMo: ratSub(s1.M, s0.M), dNX: ratSub(s1.NX, s0.NX) };
    });
    if (out.some((o) => ratSign(o.s1.e) <= 0)) {
      const bad = out.find((o) => ratSign(o.s1.e) <= 0)!;
      return refuse(`${bad.name}: the exchange rate would fall to ${ex(bad.s1.e)} (not positive). Choose a smaller shock or a larger net-export sensitivity n.`);
    }
    if (ratSign(base.floating.e) <= 0) return refuse(`The floating-rate equilibrium exchange rate is ${ex(base.floating.e)} (not positive): raise NX₀ or n, or lower M.`);
    const lines: string[] = [];
    lines.push(
      `Small open economy, ${mob === "perfect" ? "perfect capital mobility (BP: r = r*)" : `imperfect capital mobility (capital inflow f·(r − r*), f = ${ex(f!)})`}, world rate r* = ${ex(v.rw)}%, price level fixed at P = ${ex(v.P)}.`,
    );
    const eqText = (s: MfSolution, rg: MfRegime): string =>
      `Y = ${ex(s.Y)}, r = ${ex(s.r)}%, ${rg === "floating" ? `exchange rate e = ${ex(s.e)}` : `money supply M = ${ex(s.M)} (to hold the peg e₀ = ${ex(s.e)})`}, net exports NX = ${ex(s.NX)}`;
    lines.push(`Floating-rate equilibrium (M = ${ex(v.M)}): ${eqText(base.floating, "floating")}.`);
    lines.push(`Fixed-rate equilibrium (peg e₀ = ${ex(v.e0)}): ${eqText(base.fixed, "fixed")}.`);
    for (const o of out) {
      if (o.name.startsWith("Monetary ΔM, fixed")) {
        lines.push(`Monetary ΔM = ${ex(d.dM)} under the peg: the central bank must buy back its own currency to hold e₀, so reserves fall by ${ex(d.dM)} and M returns to ${ex(o.s0.M)}; Y, r and e are unchanged (monetary policy is powerless under a fixed rate).`);
        continue;
      }
      const shockText = o.name.startsWith("Fiscal") ? `ΔG = ${ex(d.dG)}` : o.name.startsWith("Monetary") ? `ΔM = ${ex(d.dM)}` : `Δe = ${ex(d.de)}`;
      lines.push(`${o.name.replace(/ Δ[GMe],/, ",")} (${shockText}): ΔY = ${ex(o.dY)}, Δr = ${ex(o.dr)} points, Δe = ${ex(o.de)}${o.regime === "fixed" ? `, ΔM = ${ex(o.dMo)} (endogenous)` : ""}, ΔNX = ${ex(o.dNX)}.`);
    }
    if (mob === "perfect") lines.push("With perfect mobility: fiscal policy is fully crowded out by appreciation under floating (ΔY = 0) and fully effective under a peg; monetary policy is fully effective under floating and powerless under a peg.");
    lines.push("");
    lines.push(
      "Conventions: e is the price of foreign currency in domestic currency (a rise is a depreciation; net exports NX = NX₀ + n·e − m·Y rise with e); prices fixed (short run); static expectations (no expected depreciation). " +
        "IS: Y = C₀ + c(Y − T) + I₀ − b·r + G + NX; LM: M/P = kY − h·r; BP: r = r* (perfect mobility) or NX + f·(r − r*) = 0. Floating: Y, r, e solve; fixed: Y, r, M solve with e pegged. Solved exactly in rational arithmetic; r in percent.",
    );
    const cell = (r: Rat): string => cellDec(r);
    const tbl: string[][] = [["Experiment", "ΔY", "Δr (points)", "Δe", "ΔM", "ΔNX"]];
    for (const o of out) tbl.push([o.name, cell(o.dY), cell(o.dr), cell(o.de), o.name.startsWith("Monetary ΔM, fixed") ? ratIsZero(d.dM) ? "0" : `0 (reserves ${ratSign(d.dM) > 0 ? MINUS : "+"}${cell(ratSign(d.dM) > 0 ? d.dM : ratNeg(d.dM))})` : o.regime === "floating" ? (o.name.startsWith("Monetary") ? cell(d.dM) : "0") : cell(o.dMo), cell(o.dNX)]);
    const tables: StatTable[] = [{ label: "Policy experiments", rows: tbl, align: ["left", "right", "right", "right", "right", "right"], note: "Changes from each regime's own equilibrium; ΔM under floating is the policy itself, under the peg the money supply the central bank must allow." }];
    const chosen = out.find((o) => o.regime === regime && (shock === "fiscal" ? o.name.startsWith("Fiscal") : shock === "monetary" ? o.name.startsWith("Monetary") : o.name.startsWith("Devaluation")));
    let note = "";
    let figExp = chosen;
    if (!figExp) {
      figExp = out.find((o) => o.name.startsWith("Devaluation"))!;
      note = "A devaluation is a fixed-rate policy: the figure shows it under the peg.";
    }
    if (note) lines.splice(lines.length - 2, 0, note);
    const svg = isLmBpSvg(p, figExp.s0, figExp.p1, figExp.s1, figExp.regime);
    const reading = mundellFlemingReading(figExp, d);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// macro-money-multiplier

export function macroMoneyMultiplierCalc(read: Read): StatOutput {
  return guarded(() => {
    const v = ratFields(read, [
      ["rr", "The required reserve ratio", { percent: true, min: 0, max: 100 }],
      ["cr", "The currency–deposit ratio", { percent: true, min: 0, max: 10000 }],
      ["er", "The excess reserve ratio", { percent: true, min: 0, max: 100, blank: RAT_ZERO }],
      ["base", "The monetary base B", { min: 0, minOpen: true }],
      ["dB", "The change in the base ΔB", { blank: RAT_ZERO }],
    ]);
    if (typeof v === "string") return refuse(v);
    const h = R(100);
    const rr = ratDiv(v.rr, h);
    const cr = ratDiv(v.cr, h);
    const er = ratDiv(v.er, h);
    const res = ratAdd(rr, er);
    if (rcmp(res, RAT_ONE) > 0) return refuse("The required and excess reserve ratios add up to more than 100% of deposits.");
    const den = ratAdd(res, cr);
    if (ratIsZero(den)) return refuse("With zero reserve and currency ratios the multiplier is unbounded: enter a positive reserve or currency ratio.");
    const mult = ratDiv(ratAdd(RAT_ONE, cr), den);
    const D = ratDiv(v.base, den);
    const C = ratMul(cr, D);
    const M = ratAdd(C, D);
    const lines: string[] = [];
    lines.push(`Required reserves ${ex(v.rr)}% of deposits, excess reserves ${ex(v.er)}%, currency held ${ex(v.cr)}% of deposits; monetary base B = ${ex(v.base)}.`);
    lines.push(`Money multiplier m = (1 + c)/(r + e + c) = ${ex(mult)} (c = C/D, r + e = total reserves/D); money supply M = C + D = m·B = ${ex(M)}.`);
    lines.push(`Deposits D = B/(r + e + c) = ${ex(D)}; currency C = ${ex(C)}; reserves ${ex(ratMul(res, D))} (required ${ex(ratMul(rr, D))}, excess ${ex(ratMul(er, D))}).`);
    if (!ratIsZero(res)) lines.push(`Without the currency drain (c = 0) the simple deposit multiplier would be 1/(r + e) = ${ex(ratDiv(RAT_ONE, res))}.`);
    if (!ratIsZero(v.dB)) lines.push(`A change in the base ΔB = ${ex(v.dB)} changes the money supply by m·ΔB = ${ex(ratMul(mult, v.dB))} (deposits ${ex(ratDiv(v.dB, den))}, currency ${ex(ratMul(cr, ratDiv(v.dB, den)))}).`);
    lines.push("");
    lines.push("Conventions: the textbook base-multiplier model with fixed ratios: B = C + reserves, C = c·D, reserves = (r + e)·D, so M = C + D = ((1 + c)/(r + e + c))·B. Ratios typed in percent; exact rational arithmetic. Real-world multipliers are not stable (banks and the public change c and e).");
    const tables: StatTable[] = [
      {
        label: "Money supply",
        rows: [
          ["Measure", "Value"],
          ["Money multiplier", cellDec(mult)],
          ["Money supply M", cellDec(M)],
          ["Deposits D", cellDec(D)],
          ["Currency C", cellDec(C)],
          ["Reserves", cellDec(ratMul(res, D))],
        ],
        align: ["left", "right"],
      },
    ];
    if (!ratIsZero(v.dB)) {
      // Deposit-expansion rounds: the public holds c/(1 + c) of each new sum as currency, banks keep r + e of each deposit.
      const lend = ratSub(RAT_ONE, res);
      const ratio = ratDiv(lend, ratAdd(RAT_ONE, cr));
      let dep = ratDiv(v.dB, ratAdd(RAT_ONE, cr));
      const tr: string[][] = [["Round", "New deposits", "Reserves kept", "New loans", "Currency held"]];
      for (let k = 1; k <= 6; k++) {
        tr.push([String(k), cellDec(dep), cellDec(ratMul(res, dep)), cellDec(ratMul(lend, dep)), cellDec(ratMul(cr, dep))]);
        dep = ratMul(dep, ratio);
      }
      const Dt = ratDiv(v.dB, den);
      tr.push(["All rounds", cellDec(Dt), cellDec(ratMul(res, Dt)), cellDec(ratMul(lend, Dt)), cellDec(ratMul(cr, Dt))]);
      tables.push({ label: `Deposit expansion after ΔB = ${cellDec(v.dB)}`, rows: tr, align: ["left", "right", "right", "right", "right"], note: "Each round: the public deposits 1/(1 + c) of the new money and holds the rest as currency; banks keep (r + e) of each deposit and lend the rest." });
    }
    const reading = moneyMultiplierReading(mult, v.base, M, v.dB);
    const svg = moneyExpansionFigure(v.dB, v.base, mult, res, cr);
    return { text: lines.join("\n"), reading, tables, ...(svg ? { svg } : {}) };
  });
}

/** A change as "raises output by 142.8571" / "lowers … by 50" / "leaves … unchanged" (cellDec, the table's format). */
function ratMove(x: Rat, what: string, up = "raises", down = "lowers"): string {
  const s = ratSign(x);
  return s === 0 ? `leaves ${what} unchanged` : `${s > 0 ? up : down} ${what} by ${cellDec(s > 0 ? x : ratNeg(x))}`;
}

/** macro-mundell-fleming in plain words: the experiment the figure shows (the regime and policy chosen). */
function mundellFlemingReading(
  o: { name: string; regime: MfRegime; s0: MfSolution; dY: Rat; de: Rat; dNX: Rat },
  d: Record<string, Rat>,
): string {
  const regime = o.regime === "floating" ? "Under a floating exchange rate" : "Under a fixed exchange rate";
  if (o.name.startsWith("Monetary ΔM, fixed")) {
    return ratIsZero(d.dM)
      ? `${regime}, no money-supply change is entered; output stays at ${ex(o.s0.Y)}.`
      : `${regime}, a money-supply change of ${ex(d.dM)} is undone as the central bank defends the peg, so output, the interest rate and the exchange rate do not change.`;
  }
  const size = o.name.startsWith("Fiscal") ? d.dG : o.name.startsWith("Monetary") ? d.dM : d.de;
  const policy = o.name.startsWith("Fiscal") ? `a change in government spending of ${ex(size)}` : o.name.startsWith("Monetary") ? `a money-supply change of ${ex(size)}` : `a devaluation of ${ex(size)}`;
  if (ratIsZero(size)) return `${regime}, no ${o.name.startsWith("Fiscal") ? "spending" : o.name.startsWith("Monetary") ? "money-supply" : "exchange-rate"} change is entered; output stays at ${ex(o.s0.Y)}.`;
  const fx2 = o.regime === "floating" && ratSign(o.de) !== 0 ? `, as the currency ${ratSign(o.de) < 0 ? "appreciates" : "depreciates"}` : "";
  return `${regime}, ${policy} ${ratMove(o.dY, "output")} and ${ratMove(o.dNX, "net exports")}${fx2}.`;
}

/** macro-money-multiplier in plain words. */
function moneyMultiplierReading(mult: Rat, base: Rat, M: Rat, dB: Rat): string {
  const change = ratIsZero(dB) ? "" : `; a change of ${ex(dB)} in the base changes it by ${ex(ratMul(mult, dB))}`;
  return `In this fixed-ratio model every unit of monetary base supports ${ex(mult)} units of money, so a base of ${ex(base)} supports a money supply of ${ex(M)}${change}.`;
}

/** At most this many lending rounds in the deposit-expansion figure. */
const EXPANSION_MAX_ROUNDS = 40;

/**
 * The deposit-expansion figure: money created after each round out of ΔB (or out of the whole base B when ΔB is 0),
 * rising to m times it. Round k adds ΔB·qᵏ⁻¹ with q = (1 − r − e)/(1 + c) (the round's deposit plus the currency kept,
 * the table's own recursion); drawn until within 1% of the limit, at least 6 rounds and at most EXPANSION_MAX_ROUNDS.
 */
function moneyExpansionFigure(dB: Rat, base: Rat, mult: Rat, res: Rat, cr: Rat): string | undefined {
  const onBase = ratIsZero(dB);
  const inj = onBase ? base : dB;
  const q = ratToNumber(ratDiv(ratSub(RAT_ONE, res), ratAdd(RAT_ONE, cr)));
  const injN = ratToNumber(inj);
  const limitR = ratMul(mult, inj);
  const limit = ratToNumber(limitR);
  if (![q, injN, limit].every(Number.isFinite)) return undefined;
  const cum: number[] = [];
  let add = injN;
  let tot = 0;
  for (let k = 1; k <= EXPANSION_MAX_ROUNDS; k++) {
    tot += add;
    cum.push(tot);
    add *= q;
    if (k >= 6 && Math.abs(limit - tot) <= 0.01 * Math.abs(limit)) break;
  }
  const what = onBase ? "B" : "ΔB";
  return depositExpansionSvg({
    cumulative: cum,
    limit,
    limitLabel: `m·${what} = ${ex(limitR)}`,
    title: `Deposit expansion out of ${what} = ${ex(inj)}`,
    injectionLabel: onBase ? "monetary base" : "change in the base",
  });
}

// =================================================================================================================
// macro-fiscal-multipliers

/** The Keynesian cross before and after the policy. */
export function keynesianCrossSvg(A0: number, A1: number, slope: number, Y0: number, Y1: number): string {
  const hi = Math.max(Y0, Y1) * 1.4;
  const ae = (A: number): Point[] => [{ x: 0, y: A }, { x: hi, y: A + slope * hi }];
  const series: Series[] = [
    { type: "line", points: [{ x: 0, y: 0 }, { x: hi, y: hi }], color: "#6b7280", label: "45° line (Y = AE)" },
    { type: "line", points: ae(A0), color: "#0369a1", label: "planned expenditure" },
  ];
  if (A1 !== A0) series.push({ type: "line", points: ae(A1), color: "#7dd3fc", label: "after the policy" });
  series.push({ type: "scatter", points: [{ x: Y0, y: Y0 }], color: "#15803d", label: "equilibrium" });
  if (A1 !== A0) series.push({ type: "scatter", points: [{ x: Y1, y: Y1 }], color: "#7c3aed", label: "new equilibrium" });
  return buildPlotSvg(series, { width: W, height: H, title: "Keynesian cross (open economy, proportional tax)", xlabel: "Output Y", ylabel: "Planned expenditure AE" });
}

export function macroFiscalMultipliersCalc(read: Read): StatOutput {
  return guarded(() => {
    const v = ratFields(read, [
      ["c", "The marginal propensity to consume c", { min: 0, max: 1, maxOpen: true }],
      ["t", "The tax rate t", { percent: true, min: 0, max: 100, maxOpen: true }],
      ["m", "The marginal propensity to import m", { min: 0, max: 1, maxOpen: true }],
      ["A", "Autonomous expenditure A", { min: 0, minOpen: true }],
      ["dG", "The change in G", { blank: RAT_ZERO }],
      ["dT", "The change in lump-sum taxes", { blank: RAT_ZERO }],
    ]);
    if (typeof v === "string") return refuse(v);
    const t = ratDiv(v.t, R(100));
    const one = RAT_ONE;
    const leak = ratAdd(ratSub(one, ratMul(v.c, ratSub(one, t))), v.m);
    if (ratSign(leak) <= 0) return refuse("1 − c(1 − t) + m must be positive for a finite multiplier.");
    const k = ratDiv(one, leak);
    const kT = ratNeg(ratMul(v.c, k));
    const kB = ratMul(ratSub(one, v.c), k);
    const Y0 = ratMul(k, v.A);
    const dA = ratSub(v.dG, ratMul(v.c, v.dT));
    const dY = ratMul(k, dA);
    const dRev = ratAdd(v.dT, ratMul(t, dY));
    const lines: string[] = [];
    lines.push(`MPC c = ${ex(v.c)}, proportional tax rate t = ${ex(v.t)}%, marginal propensity to import m = ${ex(v.m)}; autonomous expenditure A = ${ex(v.A)} (equilibrium Y = A/(1 − c(1 − t) + m) = ${ex(Y0)}).`);
    lines.push(`Government-spending multiplier ΔY/ΔG = 1/(1 − c(1 − t) + m) = ${ex(k)}; lump-sum tax multiplier ΔY/ΔT = −c/(1 − c(1 − t) + m) = ${ex(kT)}; transfer multiplier ${ex(ratNeg(kT))}; balanced-budget multiplier (ΔG = ΔT, lump-sum) = (1 − c)/(1 − c(1 − t) + m) = ${ex(kB)}.`);
    const simple = (den: Rat): string => (ratSign(den) > 0 ? ex(ratDiv(one, den)) : "unbounded");
    lines.push(`For comparison: closed economy without income tax 1/(1 − c) = ${simple(ratSub(one, v.c))}; closed with the tax 1/(1 − c(1 − t)) = ${simple(ratSub(one, ratMul(v.c, ratSub(one, t))))}; open without the tax 1/(1 − c + m) = ${simple(ratAdd(ratSub(one, v.c), v.m))}. Taxes and imports are leakages that shrink the multiplier.`);
    if (!ratIsZero(v.dG) || !ratIsZero(v.dT)) {
      lines.push(`Policy ΔG = ${ex(v.dG)}, ΔT = ${ex(v.dT)}: ΔY = ${ex(dY)}; tax revenue changes by ΔT + t·ΔY = ${ex(dRev)}, so the budget balance changes by ${ex(ratSub(dRev, v.dG))}; imports rise by m·ΔY = ${ex(ratMul(v.m, dY))} (net exports ${ex(ratNeg(ratMul(v.m, dY)))}).`);
    }
    lines.push("");
    lines.push("Conventions: the Keynesian cross with fixed prices and interest rates (no crowding out; macro-islm adds it): C = C₀ + c·(Y − T − t·Y), imports = M₀ + m·Y, so Y = A/(1 − c(1 − t) + m) with A all autonomous spending net of c·T. ΔT is a lump-sum tax change; t is a proportional income tax. Exact rational arithmetic.");
    const tables: StatTable[] = [
      {
        label: "Multipliers",
        rows: [
          ["Multiplier", "Value"],
          ["Government spending ΔY/ΔG", cellDec(k)],
          ["Lump-sum tax ΔY/ΔT", cellDec(kT)],
          ["Transfers", cellDec(ratNeg(kT))],
          ["Balanced budget (lump-sum)", cellDec(kB)],
          ["Closed, no income tax 1/(1 − c)", ratSign(ratSub(one, v.c)) > 0 ? cellDec(ratDiv(one, ratSub(one, v.c))) : "unbounded"],
        ],
        align: ["left", "right"],
      },
    ];
    const slope = ratToNumber(ratSub(ratMul(v.c, ratSub(one, t)), v.m));
    const svg = keynesianCrossSvg(ratToNumber(v.A), ratToNumber(ratAdd(v.A, dA)), slope, ratToNumber(Y0), ratToNumber(ratAdd(Y0, dY)));
    // The reading: the spending multiplier in words, then the policy entered (if any).
    const taxCut = ratIsZero(kT) ? "a lump-sum tax cut leaves it unchanged" : `a one-unit lump-sum tax cut raises it by ${ex(ratNeg(kT))}`;
    const lead = `Each extra unit of government spending raises output by ${ex(k)} units and ${taxCut}, with prices and interest rates held fixed.`;
    const pol = ratIsZero(v.dG) && ratIsZero(v.dT) ? "" : ` The policy entered ${ratMove(dY, "output")} and changes the budget balance by ${ex(ratSub(dRev, v.dG))}.`;
    const reading = fitReading(lead + pol, lead);
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// macro-phillips

/** Synthetic annual inflation and unemployment (percent), scripts/micromacro-oracle.py, seed 20261027. */
export const PHILLIPS_DATA_DEFAULT = [
  "Year\tinflation\tunemployment\texpected",
  "1990\t3.0\t5.8\t2.4",
  "1991\t3.5\t5.0\t3.1",
  "1992\t3.4\t4.8\t3.8",
  "1993\t3.1\t5.2\t3.6",
  "1994\t3.7\t4.7\t3.2",
  "1995\t3.6\t5.0\t4.1",
  "1996\t3.9\t5.0\t4.0",
  "1997\t4.3\t4.7\t4.2",
  "1998\t5.0\t3.6\t4.8",
  "1999\t5.3\t4.4\t5.0",
  "2000\t5.3\t5.3\t5.4",
  "2001\t5.3\t4.6\t5.3",
  "2002\t6.1\t3.6\t4.9",
  "2003\t6.2\t3.9\t5.8",
  "2004\t6.5\t4.7\t6.0",
  "2005\t6.1\t5.7\t6.2",
  "2006\t6.0\t5.3\t5.7",
  "2007\t6.3\t5.4\t6.5",
  "2008\t6.1\t5.8\t6.5",
  "2009\t6.4\t6.5\t6.0",
  "2010\t6.2\t5.7\t6.2",
  "2011\t5.6\t5.9\t6.0",
  "2012\t5.8\t4.8\t5.6",
  "2013\t6.3\t4.9\t5.5",
  "2014\t5.9\t4.5\t6.3",
  "2015\t6.7\t3.6\t6.5",
  "2016\t6.9\t3.7\t6.5",
  "2017\t7.5\t3.9\t7.1",
  "2018\t7.3\t4.3\t8.1",
  "2019\t7.9\t4.5\t6.6",
  "2020\t9.4\t4.8\t7.8",
  "2021\t9.1\t5.5\t9.9",
  "2022\t9.4\t5.3\t9.1",
  "2023\t10.0\t3.9\t9.7",
  "2024\t10.5\t4.4\t9.8",
].join("\n");

/** Δπ (or π − πᵉ) against unemployment with the fitted line and the NAIRU marked. */
export function phillipsSvg(u: number[], y: number[], alpha: number, beta: number, nairu: number | null, yLabel: string): string {
  const lo = Math.min(...u, nairu ?? Infinity);
  const hi = Math.max(...u, nairu ?? -Infinity);
  const series: Series[] = [
    { type: "scatter", points: u.map((x, i) => ({ x, y: y[i] })), color: "#2563eb", label: "years" },
    { type: "line", points: [lo, hi].map((x) => ({ x, y: alpha + beta * x })), color: "#b91c1c", label: "OLS fit" },
  ];
  if (nairu !== null && Number.isFinite(nairu)) series.push({ type: "scatter", points: [{ x: nairu, y: 0 }], color: "#15803d", label: "NAIRU" });
  return buildPlotSvg(series, { width: W, height: H, title: "Phillips curve", xlabel: "Unemployment rate (%)", ylabel: yLabel });
}

const PHILLIPS_SE: SeType[] = ["classical", "hc1", "hac"];

export function macroPhillipsCalc(read: Read): StatOutput {
  return guarded(() => {
    const parsed = parseSeriesTable(get(read, "data"), { minRows: 4 });
    if (!parsed.ok) return refuse(`Data: ${parsed.reason}`);
    const d = parsed.data;
    if (d.n > 5000) return refuse(`Data: ${intText(d.n)} rows; the most is 5,000.`);
    const form = pick(read, "form", ["accel", "expect"], "accel", "Specification");
    if (typeof form !== "string") return refuse(form.error);
    const se = pick(read, "se", PHILLIPS_SE, "classical", "Standard errors") as SeType | { error: string };
    if (typeof se !== "string") return refuse(se.error);
    const pi = pickSeries(d, get(read, "picol").trim() || "inflation");
    if (!pi.ok) return refuse(`Inflation column: ${pi.reason}`);
    const un = pickSeries(d, get(read, "ucol").trim() || "unemployment");
    if (!un.ok) return refuse(`Unemployment column: ${un.reason}`);
    if (pi.name === un.name) return refuse("The inflation and unemployment columns must be different columns.");
    let y: number[];
    let u: number[];
    let rowLabels: string[];
    const labels = d.dates ? d.dates.tokens.map((t) => t.label) : Array.from({ length: d.n }, (_, i) => String(i + 1));
    let depName: string;
    if (form === "accel") {
      y = [];
      u = [];
      for (let t = 1; t < d.n; t++) {
        y.push(pi.values[t] - pi.values[t - 1]);
        u.push(un.values[t]);
      }
      rowLabels = labels.slice(1);
      depName = "Δπ";
    } else {
      const ee = pickSeries(d, get(read, "ecol").trim() || "expected");
      if (!ee.ok) return refuse(`Expected-inflation column: ${ee.reason}`);
      y = Array.from(pi.values, (p, i) => p - ee.values[i]);
      u = Array.from(un.values);
      rowLabels = labels;
      depName = "π − πᵉ";
    }
    for (let i = 0; i < y.length; i++) if (!Number.isFinite(y[i]) || !Number.isFinite(u[i])) return refuse(`Data, row ${rowLabels[i]}: a value is missing or not a number.`);
    if (y.length < 4) return refuse(`Data: ${y.length} usable observations; at least 4 are needed${form === "accel" ? " (the change in inflation uses up the first row)" : ""}.`);
    if (u.every((x) => x === u[0])) return refuse(`Unemployment column ${q(un.name)}: every usable value is ${fx(u[0], 2)}, so the slope of the Phillips curve cannot be estimated.`);
    const fit = fitOls({ y, depName, X: [u], names: ["unemployment"], constant: true, se });
    if (!fit.ok) return refuse(`The regression could not be fitted: ${fit.reason}`);
    const terms = fit.model.terms;
    const seText = fit.model.seLabel.replace(/^Classical$/, "classical");
    const tb = terms.find((t) => t.name === "unemployment")!;
    const ta = terms.find((t) => t.name === "Constant")!;
    const alpha = ta.coef;
    const beta = tb.coef;
    const lines: string[] = [];
    lines.push(`Phillips curve by OLS, ${y.length} observations (${rowLabels[0]} to ${rowLabels[rowLabels.length - 1]}): ${depName} = α + β·u, inflation ${q(pi.name)}, unemployment ${q(un.name)}${form === "accel" ? " (Δπₜ = πₜ − πₜ₋₁: expected inflation is last year's, the accelerationist form; the first row is used up)" : " (expected inflation from the named column)"}.`);
    lines.push(`α = ${fx(alpha, 4)} (SE ${fx(ta.se, 4)}), β = ${fx(beta, 4)} (SE ${fx(tb.se, 4)}, t = ${fx(tb.stat, 3)}, ${fmtP(tb.p).startsWith("<") ? "p " + fmtP(tb.p) : "p = " + fmtP(tb.p)}); R² = ${fx(fit.r2, 4)}; standard errors ${seText}.`);
    let nairu: number | null = null;
    let nSe: number | null = null;
    if (beta === 0) {
      lines.push("β = 0: inflation does not respond to unemployment in this sample, so no NAIRU is defined.");
    } else {
      nairu = -alpha / beta;
      // Delta method by reparametrisation: regress on (u − û*). Its intercept is α + β·û* (= 0 at the estimate) and its
      // SE is √Var(α + β·û*) under the same covariance estimator; ∇(−α/β) = −(1/β)·(1, û*), so SE(û*) = SE₀/|β|.
      const fit2 = fitOls({ y, depName, X: [u.map((x) => x - nairu!)], names: ["unemployment"], constant: true, se });
      if (!fit2.ok) return refuse(`The NAIRU standard error could not be computed: ${fit2.reason}`);
      const se0 = fit2.model.terms.find((t) => t.name === "Constant")!.se;
      nSe = se0 / Math.abs(beta);
      lines.push(`NAIRU = −α/β = ${fx(nairu, 3)}% (delta-method SE ${fx(nSe, 3)}; 95% interval ${fx(nairu - 1.959964 * nSe, 3)}% to ${fx(nairu + 1.959964 * nSe, 3)}%): the unemployment rate at which ${form === "accel" ? "inflation is stable" : "inflation equals expected inflation"}.`);
      if (beta > 0) lines.push("β is positive: the estimated curve does not slope down, so −α/β is not a meaningful NAIRU here.");
      else lines.push(`Sacrifice ratio −1/β = ${fx(-1 / beta, 3)}: points of unemployment above the NAIRU for one year per point of disinflation.`);
      if (Math.abs(tb.stat) < 2) lines.push("The slope is imprecise (|t| < 2): the delta-method interval for the NAIRU is unreliable when β is near zero (a Fieller interval would be wider and may be unbounded).");
    }
    lines.push("");
    lines.push(
      `Conventions: OLS by olsInference.fitOls (the econ-ols engine), constant included, ${seText} standard errors; NAIRU = −α/β with its delta-method SE computed by reparametrizing the regression around the estimate (same covariance estimator); 95% interval ±1.96 SE (normal). Inflation and unemployment in percent.`,
    );
    const pText = (p: number): string => fmtP(p);
    const tables: StatTable[] = [
      {
        label: `OLS: ${depName} on unemployment`,
        rows: [
          ["Term", "Coefficient", "Std. error", "t", "p", "95% CI"],
          ...[tb, ta].map((t) => [t.name === "Constant" ? "Constant α" : "Unemployment β", fx(t.coef, 4), fx(t.se, 4), fx(t.stat, 3), pText(t.p), `${fx(t.ciLo, 3)} to ${fx(t.ciHi, 3)}`]),
          ...(nairu !== null && nSe !== null ? [["NAIRU −α/β", fx(nairu, 4), fx(nSe, 4), "", "", `${fx(nairu - 1.959964 * nSe, 3)} to ${fx(nairu + 1.959964 * nSe, 3)}`]] : []),
        ],
        align: ["left", "right", "right", "right", "right", "right"],
        note: `n = ${y.length}; R² = ${fx(fit.r2, 4)}; ${seText} standard errors; the NAIRU row is delta-method (normal interval).`,
      },
    ];
    const svg = phillipsSvg(u, y, alpha, beta, nairu, form === "accel" ? "Change in inflation Δπ (points)" : "Inflation surprise π − πᵉ (points)");
    lines.push(...d.notes.map((n) => n));
    // The reading: the NAIRU when the curve slopes down, else what the slope says.
    const pS = fmtP(tb.p).startsWith("<") ? "p " + fmtP(tb.p) : "p = " + fmtP(tb.p);
    const what = form === "accel" ? "inflation" : "inflation relative to expectations";
    let reading: string;
    if (nairu === null) reading = `Inflation does not respond to unemployment in this sample (slope 0), so no NAIRU can be estimated.`;
    else if (beta > 0) reading = `The estimated curve slopes up (β = ${fx(beta, 4)}, ${pS}), the wrong way for a Phillips curve, so these data give no meaningful NAIRU.`;
    else if (tb.p < 0.05) {
      reading = fitReading(
        `Higher unemployment goes with falling ${what} (β = ${fx(beta, 4)}, ${pS}); ${what === "inflation" ? "inflation is stable" : "inflation meets expectations"} at about ${fx(nairu, 3)}% unemployment (the NAIRU; 95% interval ${fx(nairu - 1.959964 * nSe!, 3)}% to ${fx(nairu + 1.959964 * nSe!, 3)}%).`,
        `Higher unemployment goes with falling ${what} (${pS}); the NAIRU is about ${fx(nairu, 3)}%.`,
      )!;
    } else reading = `The data show no clear link between unemployment and ${what} (β = ${fx(beta, 4)}, ${pS}), so the NAIRU estimate of ${fx(nairu, 3)}% is unreliable.`;
    return { text: lines.join("\n"), reading, tables, svg };
  });
}

// =================================================================================================================
// Registry

export const MICROMACRO_STAT_CALCS: StatCalcDef[] = [
  {
    id: "micro-demand",
    name: "Constant-elasticity and log-linear demand",
    fields: [
      {
        key: "form",
        label: "Demand form",
        default: "loglog",
        kind: "select",
        options: [
          { value: "loglog", label: "Constant elasticity: ln Q = ln A + ε·ln P" },
          { value: "semilog", label: "Log-linear (semi-log): ln Q = a − b·P" },
        ],
      },
      { key: "A", label: "Scale A (constant elasticity)", default: "1000", kind: "text" },
      { key: "eps", label: "Elasticity ε, negative (constant elasticity)", default: "−1.5", kind: "text" },
      { key: "a", label: "Intercept a (log-linear)", default: "5", kind: "text" },
      { key: "b", label: "Slope b, positive (log-linear)", default: "0.1", kind: "text" },
      { key: "p", label: "Price P to evaluate at", default: "8", kind: "text" },
      { key: "mc", label: "Constant marginal cost c for the monopoly price (blank: none)", default: "4", kind: "text" },
    ],
    compute: (r) => {
      // Elasticity, revenue, revenue-maximizing and monopoly prices for log-log and semi-log demand, with the figure.
      return microDemandCalc(r);
    },
  },
  {
    id: "micro-consumer",
    name: "Consumer choice: demands and Slutsky decomposition",
    fields: [
      {
        key: "util",
        label: "Utility function",
        default: "cd",
        kind: "select",
        options: [
          { value: "cd", label: "Cobb–Douglas U = x₁ᵃ·x₂ᵇ" },
          { value: "ces", label: "CES U = (a·x₁ʳ + b·x₂ʳ) to the 1/r, r = ρ" },
          { value: "leontief", label: "Perfect complements U = min(a·x₁, b·x₂)" },
          { value: "linear", label: "Perfect substitutes U = a·x₁ + b·x₂" },
        ],
      },
      { key: "a", label: "Weight a", default: "0.5", kind: "text" },
      { key: "b", label: "Weight b", default: "0.5", kind: "text" },
      { key: "rho", label: "CES exponent ρ (below 1, not 0; CES only)", default: "0.5", kind: "text" },
      { key: "m", label: "Income m", default: "100", kind: "text" },
      { key: "p1", label: "Price of good 1, p₁ (before)", default: "2", kind: "text" },
      { key: "p1new", label: "Price of good 1 after the change", default: "4", kind: "text" },
      { key: "p2", label: "Price of good 2, p₂", default: "1", kind: "text" },
    ],
    compute: (r) => {
      // Marshallian and Hicksian demands, Hicks and Slutsky decompositions, CV and EV, with the indifference-curve figure.
      return microConsumerCalc(r);
    },
  },
  {
    id: "micro-cost",
    name: "Cost curves: AC, AVC, MC, shutdown and break-even",
    fields: [
      { key: "tc", label: "Total cost coefficients c₀ (fixed cost), c₁, c₂, c₃ … for TC = c₀ + c₁q + c₂q² + c₃q³ …", default: "300, 12, −2, 0.25", kind: "list" },
      { key: "price", label: "Market price P for the price-taking output (blank: none)", default: "50", kind: "text" },
      { key: "qmax", label: "Largest output plotted (blank: automatic)", default: "", kind: "text" },
    ],
    compute: (r) => {
      // Cost curves from a polynomial TC: exact shutdown and break-even points where rational, the output at a price.
      return microCostCalc(r);
    },
  },
  {
    id: "micro-price-disc",
    name: "Price discrimination: uniform, third-degree, first-degree",
    fields: [
      { key: "a1", label: "Market 1 demand intercept a₁ (P₁ = a₁ − b₁Q₁)", default: "100", kind: "text" },
      { key: "b1", label: "Market 1 demand slope b₁", default: "1", kind: "text" },
      { key: "a2", label: "Market 2 demand intercept a₂ (P₂ = a₂ − b₂Q₂)", default: "60", kind: "text" },
      { key: "b2", label: "Market 2 demand slope b₂", default: "0.5", kind: "text" },
      { key: "c", label: "Constant marginal cost c", default: "20", kind: "text" },
    ],
    compute: (r) => {
      // Uniform monopoly price on the kinked demand against third- and first-degree discrimination, exact welfare.
      return microPriceDiscCalc(r);
    },
  },
  {
    id: "micro-auction",
    name: "Auctions: first and second price, revenue equivalence",
    fields: [
      { key: "n", label: "Number of bidders n (2 to 200)", default: "4", kind: "text" },
      { key: "lo", label: "Lowest value (values uniform on [lo, hi])", default: "0", kind: "text" },
      { key: "hi", label: "Highest value", default: "100", kind: "text" },
      { key: "reserve", label: "Reserve price (blank or at most lo: none)", default: "0", kind: "text" },
      { key: "v0", label: "Seller's own value (for the optimal reserve)", default: "0", kind: "text" },
    ],
    compute: (r) => {
      // Equilibrium bids and exact expected revenue of both auctions, the reserve price and Myerson's optimal reserve.
      return microAuctionCalc(r);
    },
  },
  {
    id: "macro-growth-accounting",
    name: "Growth accounting: the Solow residual",
    fields: [
      { key: "data", label: "Table: period or year first, then output, capital and labor columns (names in a header row)", default: GROWTH_DATA_DEFAULT, kind: "block" },
      { key: "ycol", label: "Output column", default: "Y", kind: "text" },
      { key: "kcol", label: "Capital column", default: "K", kind: "text" },
      { key: "lcol", label: "Labor column", default: "L", kind: "text" },
      { key: "alpha", label: "Capital share α (between 0 and 1)", default: "0.35", kind: "text" },
      {
        key: "growth",
        label: "Growth rates",
        default: "log",
        kind: "select",
        options: [
          { value: "log", label: "Log differences (exact decomposition)" },
          { value: "simple", label: "Simple percentage changes" },
        ],
      },
    ],
    compute: (r) => {
      // Contributions of capital, labour and TFP to output growth by period, the TFP index and the cumulative figure.
      return macroGrowthCalc(r);
    },
  },
  {
    id: "macro-mundell-fleming",
    name: "Mundell–Fleming: fixed and floating exchange rates",
    fields: [
      { key: "C0", label: "Autonomous consumption C₀", default: "200", kind: "text" },
      { key: "c", label: "Marginal propensity to consume c", default: "0.75", kind: "text" },
      { key: "T", label: "Taxes T", default: "200", kind: "text" },
      { key: "I0", label: "Autonomous investment I₀", default: "300", kind: "text" },
      { key: "b", label: "Investment sensitivity b (per percentage point of r)", default: "25", kind: "text" },
      { key: "G", label: "Government spending G", default: "250", kind: "text" },
      { key: "NX0", label: "Autonomous net exports NX₀", default: "−140", kind: "text" },
      { key: "n", label: "Net-export sensitivity n to the exchange rate e", default: "200", kind: "text" },
      { key: "m", label: "Marginal propensity to import m", default: "0.1", kind: "text" },
      { key: "M", label: "Money supply M (floating)", default: "600", kind: "text" },
      { key: "P", label: "Price level P", default: "1", kind: "text" },
      { key: "k", label: "Money demand: income sensitivity k", default: "0.5", kind: "text" },
      { key: "h", label: "Money demand: interest sensitivity h (per percentage point)", default: "50", kind: "text" },
      { key: "rw", label: "World interest rate r* (%)", default: "4", kind: "text" },
      { key: "e0", label: "Pegged exchange rate e₀ (fixed)", default: "1", kind: "text" },
      {
        key: "mobility",
        label: "Capital mobility",
        default: "perfect",
        kind: "select",
        options: [
          { value: "perfect", label: "Perfect (BP flat at r*)" },
          { value: "imperfect", label: "Imperfect (capital flows f·(r − r*))" },
        ],
      },
      { key: "f", label: "Capital-flow sensitivity f (imperfect mobility)", default: "100", kind: "text" },
      { key: "dG", label: "Fiscal experiment ΔG", default: "50", kind: "text" },
      { key: "dM", label: "Monetary experiment ΔM", default: "50", kind: "text" },
      { key: "de", label: "Devaluation experiment Δe (fixed rate)", default: "0.1", kind: "text" },
      {
        key: "regime",
        label: "Exchange-rate regime in the figure",
        default: "floating",
        kind: "select",
        options: [
          { value: "floating", label: "Floating" },
          { value: "fixed", label: "Fixed" },
        ],
      },
      {
        key: "shock",
        label: "Policy in the figure",
        default: "fiscal",
        kind: "select",
        options: [
          { value: "fiscal", label: "Fiscal (ΔG)" },
          { value: "monetary", label: "Monetary (ΔM)" },
          { value: "devaluation", label: "Devaluation (Δe, fixed rate)" },
        ],
      },
    ],
    compute: (r) => {
      // Fiscal, monetary and devaluation experiments under floating and fixed rates, exact, with the IS–LM–BP figure.
      return macroMundellFlemingCalc(r);
    },
  },
  {
    id: "macro-money-multiplier",
    name: "Money multiplier with currency and reserve drains",
    fields: [
      { key: "rr", label: "Required reserve ratio (% of deposits)", default: "10", kind: "text" },
      { key: "cr", label: "Currency–deposit ratio C/D (%)", default: "20", kind: "text" },
      { key: "er", label: "Excess reserve ratio (% of deposits)", default: "0", kind: "text" },
      { key: "base", label: "Monetary base B", default: "1,000", kind: "text" },
      { key: "dB", label: "Change in the base ΔB (blank: none)", default: "100", kind: "text" },
    ],
    compute: (r) => {
      // Multiplier (1 + c)/(r + e + c), money supply, deposits, currency and reserves, the deposit-expansion rounds.
      return macroMoneyMultiplierCalc(r);
    },
  },
  {
    id: "macro-fiscal-multipliers",
    name: "Fiscal multipliers with taxes and imports",
    fields: [
      { key: "c", label: "Marginal propensity to consume c", default: "0.8", kind: "text" },
      { key: "t", label: "Proportional income tax rate t (%)", default: "25", kind: "text" },
      { key: "m", label: "Marginal propensity to import m", default: "0.1", kind: "text" },
      { key: "A", label: "Autonomous expenditure A", default: "600", kind: "text" },
      { key: "dG", label: "Change in government spending ΔG", default: "100", kind: "text" },
      { key: "dT", label: "Change in lump-sum taxes ΔT", default: "0", kind: "text" },
    ],
    compute: (r) => {
      // Spending, tax, transfer and balanced-budget multipliers, the policy's effect on Y and the budget, Keynesian cross.
      return macroFiscalMultipliersCalc(r);
    },
  },
  {
    id: "macro-phillips",
    name: "Phillips curve estimation and the NAIRU",
    fields: [
      { key: "data", label: "Table: year first, then inflation and unemployment columns in percent (names in a header row)", default: PHILLIPS_DATA_DEFAULT, kind: "block" },
      { key: "picol", label: "Inflation column", default: "inflation", kind: "text" },
      { key: "ucol", label: "Unemployment column", default: "unemployment", kind: "text" },
      {
        key: "form",
        label: "Specification",
        default: "accel",
        kind: "select",
        options: [
          { value: "accel", label: "Accelerationist: Δπ = α + β·u" },
          { value: "expect", label: "Expectations column: π − πᵉ = α + β·u" },
        ],
      },
      { key: "ecol", label: "Expected-inflation column (expectations form only)", default: "expected", kind: "text" },
      {
        key: "se",
        label: "Standard errors",
        default: "classical",
        kind: "select",
        options: [
          { value: "classical", label: "Classical" },
          { value: "hc1", label: "HC1 (Stata robust)" },
          { value: "hac", label: "Newey–West HAC" },
        ],
      },
    ],
    compute: (r) => {
      // OLS of the change in inflation on unemployment; NAIRU −α/β with a delta-method SE; sacrifice ratio; figure.
      return macroPhillipsCalc(r);
    },
  },
];
