/**
 * Apportionment and royalty-rate methods (Release F1, v2.202.0, gap item #2): a chained apportionment worksheet, the
 * entire-market-value and smallest-salable-unit royalty bases side by side, comparable-license unpacking (lump sum ⇄
 * running royalty) and a Nash bargaining split. Pure: no Office.js, so jest imports it.
 *
 * US DOLLARS, like the damages tools (damagesUsd.ts): every amount prints with usd(); a field that names another
 * currency (€, £, EUR 1,000, C$ …) is refused by foreignCurrencyRefusal.
 *
 * WORDING. Every result is arithmetic on the user's inputs, labelled as a calculation. Nothing here says which base,
 * share or split the law requires. The only legal text is the verified Uniloc quotation behind the 25% rule refusal.
 *
 * EXACTNESS. The worksheet, the EMVR/SSPPU comparison and the Nash split are exact rational arithmetic on the typed
 * decimals (cas.ts Rat): every displayed amount is rounded to the cent once, half away from zero, from its exact value
 * (pinned against Python fractions in scripts/ipval-oracle.py). The comparable-license tool discounts, so it works in
 * doubles with dmg-royalty's convention: per-period amounts rounded to the cent, totals the sums of the rounded periods.
 */
import { readFinanceField } from "./finance";
import { foreignCurrencyRefusal, stripUsd, usd } from "./damagesUsd";
import { MAX_DAMAGES_AMOUNT, periodLabelMismatch, dmgMoney, dmgPct, dmgQty, dmgUnitMoney, damagesFigure, parsePeriodTable, roundCents } from "./patentDamages";
import { ratMul, ratDiv, ratSub, ratSign, ratToNumber, ratInt, parseRatLiteral, type Rat } from "./cas";
import { roundUnits, unitsText } from "./currency";
import type { FinResult } from "./finCalc";
import { aAn } from "./finPaneReadings";
import { namedBarsSvg, stepBarsSvg } from "./finLibFigures";

type Read = (k: string) => string;

/** The citation behind the 25% rule refusal, exactly as verified (reporter pinpoint pages NOT verified: slip op. only). */
export const UNILOC_CITATION = "Uniloc USA, Inc. v. Microsoft Corp., 632 F.3d 1292 (Fed. Cir. 2011), slip op. at 41";
/** Verified 2026-10-26 in Patent Bear, decision USCOURTS-ca13-10-01035-900. */
export const UNILOC_QUOTE =
  "This court now holds as a matter of Federal Circuit law that the 25 percent rule of thumb is a fundamentally flawed tool for determining a baseline royalty rate in a hypothetical negotiation.";

/** The refusal for any input that asks for the 25% rule of thumb. */
export function rule25Refusal(why: string): string {
  return (
    `${why} The 25% rule of thumb is not offered as a calculator. ${UNILOC_CITATION}: “${UNILOC_QUOTE}” ` +
    "Use a split tied to the facts of the case (the Nash bargaining split with a patentee share supported by the evidence), " +
    "or build the rate up in the apportionment worksheet."
  );
}

/** Rows of a comparable-license forecast beyond this are refused (100 years monthly is 1,200). */
export const APP_MAX_PERIODS = 1200;

interface Refusal {
  error: string;
}
const isRefusal = (x: unknown): x is Refusal => typeof x === "object" && x !== null && "error" in x;
const refuse = (e: Refusal): FinResult => ({ text: e.error, ok: false });
const q = (s: string): string => `“${s.length > 40 ? s.slice(0, 40) + "…" : s}”`;

interface Val {
  v: number;
  r: Rat;
}

/**
 * One number field as an exact rational. `money` fields first refuse another currency by name, then drop a US-dollar
 * marking ($, US$, USD) before the product's reader; the pane may already have read the field, so it is read again.
 */
function readVal(raw0: string, label: string, o: { money?: boolean; min?: number; minExclusive?: boolean; max?: number; maxExclusive?: boolean; range?: string }): Val | Refusal {
  const raw = (raw0 ?? "").trim();
  if (!raw) return { error: `${label}: enter a number.` };
  if (o.money) {
    const f = foreignCurrencyRefusal(raw, label);
    if (f) return { error: f };
  }
  const v = readFinanceField(o.money ? stripUsd(raw) : raw);
  if (!Number.isFinite(v)) return { error: `${label}: ${q(raw)} is not a number this calculator can use.` };
  const range = o.range ? ` (${o.range})` : "";
  if (o.min !== undefined && (o.minExclusive ? !(v > o.min) : !(v >= o.min))) return { error: `${label} is out of range${range}: ${q(raw)}.` };
  if (o.max !== undefined && (o.maxExclusive ? !(v < o.max) : !(v <= o.max))) return { error: `${label} is out of range${range}: ${q(raw)}.` };
  if (Math.abs(v) > MAX_DAMAGES_AMOUNT) return { error: `${label} is above one trillion, outside this calculator.` };
  const r = parseRatLiteral(String(v));
  if (!r) return { error: `${label}: ${q(raw)} is not a number this calculator can use.` };
  return { v, r };
}

const money = (label: string, raw: string): Val | Refusal => readVal(raw, label, { money: true, min: 0, max: MAX_DAMAGES_AMOUNT, range: "0 to one trillion dollars" });
const share = (label: string, raw: string): Val | Refusal => readVal(raw, label, { min: 0, minExclusive: true, max: 100, range: "more than 0% and at most 100%" });

const HUNDRED: Rat = ratInt(100);
const pctOf = (r: Rat): Rat => ratDiv(r, HUNDRED);

/** Exact dollars and cents, half away from zero from the exact value: "$1,234.57", "−$5.00". */
export function centsText(r: Rat): string {
  return usd(unitsText(roundUnits(r, 2), 2));
}
/** An exact percent: up to six decimals (half away from zero), trailing zeros trimmed to two: "1.512%". */
export function ratPctText(r: Rat): string {
  const t = unitsText(roundUnits(r, 6), 6).replace(/0{1,4}$/, "");
  return `${t}%`;
}
/** The cents of an exact amount as a number (for figures and tests). */
export const centsOf = (r: Rat): number => Number(roundUnits(r, 2)) / 100;

function overTotal(what: string, r: Rat): Refusal | null {
  return Math.abs(ratToNumber(r)) > 10 * MAX_DAMAGES_AMOUNT ? { error: `${what} is above ten trillion dollars, outside this calculator.` } : null;
}

/** "Base" from the basis select: revenue, or units × price per unit. */
function readBase(read: Read, revKey: string, revLabel: string, priceKey: string, priceLabel: string): { base: Rat; text: string } | Refusal {
  if (read("basis") === "unit") {
    const units = readVal(read("units"), "Units", { min: 0, max: MAX_DAMAGES_AMOUNT, range: "0 to one trillion" });
    if (isRefusal(units)) return units;
    const price = money(priceLabel, read(priceKey));
    if (isRefusal(price)) return price;
    const base = ratMul(units.r, price.r);
    const big = overTotal("Units × price", base);
    if (big) return big;
    return { base, text: `${dmgQty(units.v)} units × ${dmgUnitMoney(price.v)}` };
  }
  const rev = money(revLabel, read(revKey));
  if (isRefusal(rev)) return rev;
  return { base: rev.r, text: revLabel.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Chained apportionment worksheet
// ---------------------------------------------------------------------------

export interface ChainStep {
  label: string;
  share: Rat | null;
  amount: Rat;
}
export interface ChainComputed {
  steps: ChainStep[];
  royalty: Rat;
  /** The royalty as a percent of the starting base. */
  effectivePct: Rat;
}

/** base × SSPPU share × feature share × patent share × royalty rate, each running amount exact. Shares in percent. */
export function computeChain(base: Rat, ssuPct: Rat, featurePct: Rat, patentPct: Rat, ratePct: Rat, baseLabel = "Royalty base"): ChainComputed {
  const s1 = ratMul(base, pctOf(ssuPct));
  const s2 = ratMul(s1, pctOf(featurePct));
  const s3 = ratMul(s2, pctOf(patentPct));
  const roy = ratMul(s3, pctOf(ratePct));
  const eff = ratMul(ratMul(ratMul(pctOf(ssuPct), pctOf(featurePct)), pctOf(patentPct)), ratePct);
  return {
    steps: [
      { label: baseLabel, share: null, amount: base },
      { label: "× smallest salable patent-practicing unit share", share: ssuPct, amount: s1 },
      { label: "× patented-feature share", share: featurePct, amount: s2 },
      { label: "× share attributable to the patent", share: patentPct, amount: s3 },
      { label: "× royalty rate", share: ratePct, amount: roy },
    ],
    royalty: roy,
    effectivePct: eff,
  };
}

/** The plain-language reading of the apportionment worksheet (lib/calcReading.ts rules). */
export function apportionReading(c: ChainComputed, base: Rat): string {
  return (
    `On these inputs the apportioned royalty is ${centsText(c.royalty)}, an effective ${ratPctText(c.effectivePct)} of the ${centsText(base)} base. ` +
    "Every share applied is an input, so the figure is only as strong as the evidence for each share."
  );
}

export function apportionCalc(read: Read): FinResult {
  const b = readBase(read, "revenue", "Revenue", "price", "Price per unit");
  if (isRefusal(b)) return refuse(b);
  const ssu = share("Smallest salable unit share (%)", read("ssu"));
  if (isRefusal(ssu)) return refuse(ssu);
  const feat = share("Feature share (%)", read("feature"));
  if (isRefusal(feat)) return refuse(feat);
  const pat = share("Patent share (%)", read("patent"));
  if (isRefusal(pat)) return refuse(pat);
  const rate = share("Royalty rate (%)", read("rate"));
  if (isRefusal(rate)) return refuse(rate);
  const c = computeChain(b.base, ssu.r, feat.r, pat.r, rate.r, read("basis") === "unit" ? "Royalty base (units × price)" : "Royalty base (revenue)");
  const lines = [
    "Apportionment worksheet, computed from the inputs given",
    `Royalty: ${centsText(c.royalty)} on a base of ${centsText(b.base)} (${b.text})`,
    `Effective rate on the starting base: ${ratPctText(c.effectivePct)} (= ${ratPctText(ssu.r)} × ${ratPctText(feat.r)} × ${ratPctText(pat.r)} × ${ratPctText(rate.r)})`,
    "Each step multiplies the running amount above it by the share shown; the shares are inputs, and choosing them is a matter for the evidence.",
    "Conventions: exact rational arithmetic on the typed decimals; each running amount is rounded to the cent (half away from zero) from its exact value, independently, so rounding never compounds " +
      "(a displayed step can differ by a cent from the rounded line above times its share); US dollars.",
  ];
  const rows: string[][] = [["Step", "Applied", "Share", "Running amount"]];
  c.steps.forEach((s, i) => rows.push([String(i + 1), s.label, s.share ? ratPctText(s.share) : "", centsText(s.amount)]));
  rows.push(["", "Royalty", ratPctText(c.effectivePct), centsText(c.royalty)]);
  return {
    text: lines.join("\n"),
    reading: apportionReading(c, b.base),
    // the running amount after each step, from the base down to the royalty (the table's Running amount column)
    svg: stepBarsSvg(
      c.steps.map((s, i) => ({
        name: i === 0 ? "Royalty base" : `${["SSPPU share", "Feature share", "Patent share", "Royalty rate"][i - 1]} ${s.share ? ratPctText(s.share) : ""}`.trim(),
        value: centsOf(s.amount),
        text: centsText(s.amount),
      })),
      "Apportionment: from the base to the royalty",
    ),
    tables: [{ label: "Apportionment chain", rows, align: ["left", "left", "right", "right"] }],
  };
}

// ---------------------------------------------------------------------------
// EMVR vs SSPPU
// ---------------------------------------------------------------------------

export interface EmvrComputed {
  emvRoyalty: Rat;
  ssppuRoyalty: Rat;
  /** SSPPU base as a percent of the entire-product base. */
  sharePct: Rat;
  /** The rate on the entire product that gives the SSPPU royalty, in percent. */
  equivalentPct: Rat;
  difference: Rat;
}

export function computeEmvr(emv: Rat, ssppu: Rat, ratePct: Rat): EmvrComputed {
  const r = pctOf(ratePct);
  const emvRoyalty = ratMul(emv, r);
  const ssppuRoyalty = ratMul(ssppu, r);
  const sharePct = ratMul(ratDiv(ssppu, emv), HUNDRED);
  return { emvRoyalty, ssppuRoyalty, sharePct, equivalentPct: ratMul(ratePct, ratDiv(ssppu, emv)), difference: ratSub(emvRoyalty, ssppuRoyalty) };
}

/** The plain-language reading of the EMV / SSPPU comparison (lib/calcReading.ts rules). */
export function emvrReading(c: EmvrComputed, ratePct: Rat): string {
  // Branch on the royalties as printed: bases a few cents apart give the same royalty to the cent.
  if (centsText(c.ssppuRoyalty) === centsText(c.emvRoyalty))
    return `At ${ratPctText(ratePct)} both bases give a royalty of ${centsText(c.ssppuRoyalty)} to the cent, so the choice of base does not change the figure here.`;
  return (
    `At ${ratPctText(ratePct)}, the smallest salable unit gives a royalty of ${centsText(c.ssppuRoyalty)} against ${centsText(c.emvRoyalty)} on the entire product, ${centsText(c.difference)} less. ` +
    `Matching the smaller royalty on the entire product takes a rate of ${ratPctText(c.equivalentPct)}.`
  );
}

export function emvrCalc(read: Read): FinResult {
  let emv: Rat;
  let ssppu: Rat;
  let inputs: string;
  if (read("basis") === "unit") {
    const units = readVal(read("units"), "Units", { min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than 0, at most one trillion" });
    if (isRefusal(units)) return refuse(units);
    const pp = readVal(read("emvprice"), "Entire-product price per unit", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0" });
    if (isRefusal(pp)) return refuse(pp);
    const sp = readVal(read("ssppuprice"), "SSPPU price per unit", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0" });
    if (isRefusal(sp)) return refuse(sp);
    emv = ratMul(units.r, pp.r);
    ssppu = ratMul(units.r, sp.r);
    inputs = `${dmgQty(units.v)} units at ${dmgUnitMoney(pp.v)} (entire product) and ${dmgUnitMoney(sp.v)} (SSPPU)`;
  } else {
    const e = readVal(read("emv"), "Entire-product revenue", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0, at most one trillion" });
    if (isRefusal(e)) return refuse(e);
    const s = readVal(read("ssppu"), "SSPPU revenue", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0, at most one trillion" });
    if (isRefusal(s)) return refuse(s);
    emv = e.r;
    ssppu = s.r;
    inputs = "revenues as entered";
  }
  const big = overTotal("The entire-product base", emv);
  if (big) return refuse(big);
  if (ratSign(ratSub(ssppu, emv)) > 0) return refuse({ error: "The SSPPU base is larger than the entire-product base; the smallest salable unit is part of the product, so its base cannot exceed the product's. Check the two amounts." });
  const rate = share("Royalty rate (%)", read("rate"));
  if (isRefusal(rate)) return refuse(rate);
  const c = computeEmvr(emv, ssppu, rate.r);
  const lines = [
    "Royalty base comparison (entire market value vs smallest salable patent-practicing unit), computed from the inputs given",
    `At ${ratPctText(rate.r)}: ${centsText(c.emvRoyalty)} on the entire-product base of ${centsText(emv)}; ${centsText(c.ssppuRoyalty)} on the SSPPU base of ${centsText(ssppu)}.`,
    `The SSPPU base is ${ratPctText(c.sharePct)} of the entire-product base; ${ratPctText(c.equivalentPct)} on the entire product gives the same royalty as ${ratPctText(rate.r)} on the SSPPU.`,
    `Inputs: ${inputs}.`,
    "Both royalties are calculations on the inputs only; which base is appropriate in a case is not decided here.",
    "Conventions: the same rate applied to both bases; exact rational arithmetic, each amount rounded to the cent (half away from zero) from its exact value; US dollars.",
  ];
  const rows: string[][] = [
    ["Royalty base", "Base amount", "Rate", "Royalty"],
    ["Entire product (EMV)", centsText(emv), ratPctText(rate.r), centsText(c.emvRoyalty)],
    ["SSPPU", centsText(ssppu), ratPctText(rate.r), centsText(c.ssppuRoyalty)],
    ["Difference", centsText(ratSub(emv, ssppu)), "", centsText(c.difference)],
  ];
  return {
    text: lines.join("\n"),
    reading: emvrReading(c, rate.r),
    // the two bases and the royalty the same rate gives on each (the table's amounts)
    svg: namedBarsSvg(
      [
        { name: "Entire-product base", value: centsOf(emv), text: centsText(emv) },
        { name: "SSPPU base", value: centsOf(ssppu), text: centsText(ssppu) },
        { name: "Royalty on the entire product", value: centsOf(c.emvRoyalty), text: centsText(c.emvRoyalty) },
        { name: "Royalty on the SSPPU", value: centsOf(c.ssppuRoyalty), text: centsText(c.ssppuRoyalty), emphasis: true },
      ],
      `EMV and SSPPU bases at ${ratPctText(rate.r)}`,
    ),
    tables: [{ label: "EMV and SSPPU royalty bases", rows, align: ["left", "right", "right", "right"] }],
  };
}

// ---------------------------------------------------------------------------
// Comparable license: lump sum ⇄ running royalty
// ---------------------------------------------------------------------------

export interface ComparableInput {
  bases: number[];
  labels: string[];
  direction: "lump2rate" | "rate2lump";
  lump: number;
  ratePct: number;
  discountPct: number;
  periodsPerYear: number;
}
export interface ComparablePeriod {
  label: string;
  base: number;
  royalty: number;
  df: number;
  pv: number;
}
export interface ComparableComputed {
  /** Σ base × discount factor (unrounded). */
  pvBase: number;
  /** Effective running rate, percent (computed, or the rate entered). */
  ratePct: number;
  /** Lump-sum equivalent (entered, or rate × pvBase). */
  lump: number;
  periods: ComparablePeriod[];
  totalRoyalty: number;
  totalPv: number;
}

export function computeComparable(inp: ComparableInput): ComparableComputed | Refusal {
  const d = inp.discountPct / 100;
  const dfs = inp.bases.map((_, k) => Math.pow(1 + d, -(k + 1) / inp.periodsPerYear));
  let pvBase = 0;
  for (let k = 0; k < inp.bases.length; k++) pvBase += inp.bases[k] * dfs[k];
  if (!(pvBase > 0)) return { error: "The royalty base forecast is zero, so no running rate can match a lump sum." };
  let ratePct: number;
  let lump: number;
  if (inp.direction === "lump2rate") {
    lump = inp.lump;
    ratePct = (inp.lump / pvBase) * 100;
    if (ratePct > 100) return { error: `The lump sum is worth more than the whole discounted royalty base (an effective rate of ${ratePct.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%); check the lump sum, the forecast and the discount rate.` };
  } else {
    ratePct = inp.ratePct;
    lump = (inp.ratePct / 100) * pvBase;
  }
  const periods: ComparablePeriod[] = [];
  let totalRoyalty = 0;
  let totalPv = 0;
  for (let k = 0; k < inp.bases.length; k++) {
    const royalty = roundCents((inp.bases[k] * ratePct) / 100);
    const pv = roundCents(royalty * dfs[k]);
    totalRoyalty += Math.round(royalty * 100);
    totalPv += Math.round(pv * 100);
    periods.push({ label: inp.labels[k], base: inp.bases[k], royalty, df: dfs[k], pv });
  }
  return { pvBase, ratePct, lump, periods, totalRoyalty: totalRoyalty / 100, totalPv: totalPv / 100 };
}

/** The plain-language reading of the comparable-license conversion (lib/calcReading.ts rules). */
export function comparableReading(c: ComparableComputed, direction: "lump2rate" | "rate2lump", discountPct: number): string {
  const at = `discounted at ${dmgPct(discountPct)} a year`;
  return direction === "lump2rate"
    ? `The ${dmgMoney(c.lump)} lump sum is worth about the same as a running royalty of ${dmgPct(c.ratePct)} on the forecast base (${at}), the rate to set beside other licenses.`
    : `${aAn(dmgPct(c.ratePct), true)} ${dmgPct(c.ratePct)} running royalty on the forecast base is worth about ${dmgMoney(c.lump)} paid up front (${at}), against ${dmgMoney(c.totalRoyalty)} paid over time undiscounted.`;
}

export function comparableCalc(read: Read): FinResult {
  const t = parsePeriodTable(read("periods"), ["royalty base"], 1);
  if ("error" in t) return refuse(t);
  if (t.rows.length > APP_MAX_PERIODS) return refuse({ error: `More than ${APP_MAX_PERIODS.toLocaleString("en-US")} periods is outside this calculator.` });
  const direction = read("direction") === "rate2lump" ? "rate2lump" : "lump2rate";
  let lump = 0;
  let ratePct = 0;
  if (direction === "lump2rate") {
    const l = readVal(read("lump"), "Lump sum", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0, at most one trillion" });
    if (isRefusal(l)) return refuse(l);
    lump = l.v;
  } else {
    const r = share("Running royalty rate (%)", read("rate"));
    if (isRefusal(r)) return refuse(r);
    ratePct = r.v;
  }
  const disc = readVal(read("disc"), "Discount rate (% a year)", { min: 0, max: 100, range: "0% to 100% a year" });
  if (isRefusal(disc)) return refuse(disc);
  const ppy = Number(read("ppy")) || 1;
  const c = computeComparable({ bases: t.rows.map((r) => r.values[0]), labels: t.rows.map((r) => r.label), direction, lump, ratePct, discountPct: disc.v, periodsPerYear: ppy });
  if (isRefusal(c)) return refuse(c);
  const n = c.periods.length;
  const lines = [
    direction === "lump2rate" ? "Comparable license: lump sum to effective running royalty, computed from the inputs given" : "Comparable license: running royalty to lump-sum equivalent, computed from the inputs given",
    direction === "lump2rate"
      ? `Effective running rate: ${dmgPct(c.ratePct)} of the royalty base (lump sum ${dmgMoney(c.lump)} ÷ discounted base ${dmgMoney(c.pvBase)})`
      : `Lump-sum equivalent: ${dmgMoney(c.lump)} (${dmgPct(c.ratePct)} × discounted base ${dmgMoney(c.pvBase)})`,
    `Discount rate ${dmgPct(disc.v)} a year; ${n.toLocaleString("en-US")} period${n === 1 ? "" : "s"}, ${ppy} a year; undiscounted running royalty ${dmgMoney(c.totalRoyalty)}.`,
    "Effective rate = lump sum ÷ Σ base × discount factor; lump-sum equivalent = rate × Σ base × discount factor; discount factor = 1/(1 + d) raised to k/m.",
    `Conventions: each period's royalty is paid at the end of its period and discounted to the start of the first period at the annual effective rate d (m = ${ppy} period${ppy === 1 ? "" : "s"} a year), as in Damages: reasonable royalty; ` +
      "the rate and lump sum come from the unrounded sums; table amounts are rounded to the cent per period and totals are the sums of the rounded periods, so the Present value total can differ from the lump sum by a few cents; US dollars.",
  ];
  for (const note of t.notes) lines.push(`Note: ${note}`);
  const mismatch = periodLabelMismatch(t.rows.map((r) => r.label), ppy);
  if (mismatch) lines.push(`Note: ${mismatch}`);
  const rows: string[][] = [["Period", "Royalty base", "Royalty", "Discount factor", "Present value"]];
  for (const p of c.periods) rows.push([p.label, dmgMoney(p.base), dmgMoney(p.royalty), p.df.toFixed(6), dmgMoney(p.pv)]);
  rows.push(["Total", dmgMoney(c.periods.reduce((s, p) => s + Math.round(p.base * 100), 0) / 100), dmgMoney(c.totalRoyalty), "", dmgMoney(c.totalPv)]);
  const svg = damagesFigure(
    c.periods.map((p) => p.label),
    [
      { name: "Present value", values: c.periods.map((p) => p.pv) },
      { name: "Discounting", values: c.periods.map((p) => roundCents(p.royalty - p.pv)) },
    ],
    "Running royalty by period",
  );
  return {
    text: lines.join("\n"),
    reading: comparableReading(c, direction, disc.v),
    tables: [{ label: "Running royalty by period", rows, align: ["left", "right", "right", "right", "right"] }],
    svg,
  };
}

// ---------------------------------------------------------------------------
// Nash bargaining split
// ---------------------------------------------------------------------------

export interface NashComputed {
  surplus: Rat;
  patentee: Rat;
  licensee: Rat;
}
export function computeNash(withPatent: Rat, alternative: Rat, sharePct: Rat): NashComputed {
  const surplus = ratSub(withPatent, alternative);
  const patentee = ratMul(surplus, pctOf(sharePct));
  return { surplus, patentee, licensee: ratSub(surplus, patentee) };
}

/** The plain-language reading of the Nash split (lib/calcReading.ts rules). */
export function nashReading(c: NashComputed, sharePct: Rat): string {
  return (
    `On these inputs the patentee's part of the ${centsText(c.surplus)} bargaining surplus is ${centsText(c.patentee)} and the licensee keeps ${centsText(c.licensee)}. ` +
    `The result is only as sound as the evidence for ${aAn(ratPctText(sharePct))} ${ratPctText(sharePct)} patentee share.`
  );
}

export function nashCalc(read: Read): FinResult {
  if (read("method") === "rule25") return refuse({ error: rule25Refusal("The “25% rule of thumb” option was chosen.") });
  const signedMoney = (label: string, key: string): Val | Refusal =>
    readVal(read(key), label, { money: true, min: -MAX_DAMAGES_AMOUNT, max: MAX_DAMAGES_AMOUNT, range: "−one trillion to one trillion dollars" });
  const w = signedMoney("Profit with the patented feature", "with");
  if (isRefusal(w)) return refuse(w);
  const a = signedMoney("Profit with the next-best alternative", "alt");
  if (isRefusal(a)) return refuse(a);
  const sh = readVal(read("share"), "Patentee share of the surplus (%)", { min: 0, minExclusive: true, max: 100, maxExclusive: true, range: "more than 0% and less than 100%" });
  if (isRefusal(sh)) return refuse(sh);
  // fix-fin R2 #10: a typed share of 25% is computed with a caution, not refused. Refusing exactly 25 while accepting
  // 24.9999 was legally inaccurate: Uniloc rejects the rule of thumb as a starting point, not the number 25 when the
  // evidence of the case supports it.
  const near25 = Math.abs(sh.v - 25) < 0.5;
  const c = computeNash(w.r, a.r, sh.r);
  if (ratSign(c.surplus) <= 0) return refuse({ error: "There is no bargaining surplus: the profit with the patented feature is not above the profit with the next-best alternative, so there is nothing to split." });
  const lines = [
    "Nash bargaining split, shown as a method, computed from the inputs given",
    `Royalty (the patentee's part of the surplus): ${centsText(c.patentee)} = surplus ${centsText(c.surplus)} × ${ratPctText(sh.r)}`,
    `Surplus = profit with the patented feature ${centsText(w.r)} − profit with the next-best alternative ${centsText(a.r)}; the licensee keeps ${centsText(c.licensee)}.`,
  ];
  const rows: string[][] = [
    ["Item", "Amount"],
    ["Profit with the patented feature", centsText(w.r)],
    ["Profit with the next-best alternative", centsText(a.r)],
    ["Bargaining surplus", centsText(c.surplus)],
    [`Patentee share (${ratPctText(sh.r)})`, centsText(c.patentee)],
    ["Licensee keeps", centsText(c.licensee)],
  ];
  const unitsRaw = (read("units") ?? "").trim();
  if (unitsRaw) {
    const u = readVal(unitsRaw, "Units (optional)", { min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than 0" });
    if (isRefusal(u)) return refuse(u);
    const per = ratDiv(c.patentee, u.r);
    lines.push(`Per unit over ${dmgQty(u.v)} units: ${dmgUnitMoney(ratToNumber(per))}.`);
    rows.push(["Royalty per unit", dmgUnitMoney(ratToNumber(per))]);
  }
  const revRaw = (read("revenue") ?? "").trim();
  if (revRaw) {
    const rv = readVal(revRaw, "Revenue (optional)", { money: true, min: 0, minExclusive: true, max: MAX_DAMAGES_AMOUNT, range: "more than $0" });
    if (isRefusal(rv)) return refuse(rv);
    const pct = ratMul(ratDiv(c.patentee, rv.r), HUNDRED);
    lines.push(`As a rate on revenue of ${centsText(rv.r)}: ${ratPctText(pct)}.`);
    rows.push(["Royalty as % of revenue", ratPctText(pct)]);
  }
  lines.push(
    "Caution: the split is a method, not a result. The patentee share must be tied to the facts of the case (each side's bargaining position and the evidence for it); " +
      "a share chosen without that support is not something this arithmetic can supply.",
  );
  if (near25) {
    lines.push(
      `Caution: a patentee share at or near 25% matches the 25% rule of thumb, which the Federal Circuit rejected as a baseline (${UNILOC_CITATION}: “${UNILOC_QUOTE}”). ` +
        "A share of this size is admissible only if the evidence of this case supports it, not because it is customary.",
    );
  }
  lines.push("Conventions: surplus = profit with − profit with the next-best alternative; royalty = surplus × patentee share; exact rational arithmetic, each amount rounded to the cent (half away from zero) from its exact value; US dollars.");
  return {
    text: lines.join("\n"),
    reading: nashReading(c, sh.r),
    // the two profits, the surplus between them, and how it is split (the table's amounts)
    svg: namedBarsSvg(
      [
        { name: "Profit with the feature", value: centsOf(w.r), text: centsText(w.r) },
        { name: "Next-best alternative", value: centsOf(a.r), text: centsText(a.r) },
        { name: "Bargaining surplus", value: centsOf(c.surplus), text: centsText(c.surplus) },
        { name: `Patentee (${ratPctText(sh.r)})`, value: centsOf(c.patentee), text: centsText(c.patentee), emphasis: true },
        { name: "Licensee keeps", value: centsOf(c.licensee), text: centsText(c.licensee) },
      ],
      "Nash bargaining: splitting the surplus",
    ),
    tables: [{ label: "Nash bargaining split", rows, align: ["left", "right"] }],
  };
}
