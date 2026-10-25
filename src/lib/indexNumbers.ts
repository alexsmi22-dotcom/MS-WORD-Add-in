/**
 * Price indexes (Release E3, calculator idx-price): Laspeyres, Paasche, Fisher and Törnqvist, fixed base or chained,
 * rebased to any period = 100.
 *
 * Input is WIDE: one row per item, Item | P<period> | Q<period> | P<period> | Q<period> …, a price column then its
 * quantity column for each period in order ("Item P2022 Q2022 P2023 Q2023"; "Price 2022", "Qty 2022" also read).
 * The item names are text, so the table is read by the regression reader (parseRegData) and its numbers by the same
 * column reader tsData uses (selectColumns → readRegCell): decimal commas, U+2212 and ×10ⁿ read the same way.
 *
 * Formulas (ILO/IMF/OECD et al., Consumer Price Index Manual: Theory and Practice, 2004, the standard definitions),
 * comparing period t with period s over the same items:
 *   Laspeyres  P_L = Σ p_t q_s / Σ p_s q_s
 *   Paasche    P_P = Σ p_t q_t / Σ p_s q_t
 *   Fisher     P_F = √(P_L · P_P)
 *   Törnqvist  ln P_T = Σ ½(w_s + w_t) ln(p_t / p_s), w the expenditure shares p q / Σ p q
 * Fixed base: every period is compared directly with the FIRST period (its prices and quantities are the reference);
 * chained: the period-to-period links are multiplied. Rebasing divides the series by its value in the chosen period
 * (×100); it does not change the weights.
 *
 * Refused, by item and period: a price that is missing, zero or negative; a negative quantity; an item with a quantity
 * in some periods and not others (a new or vanished item — no imputation is attempted).
 */
import { isMissingCell, parseRegData, selectColumns, type RegDataset } from "./regData";

export type IndexFormula = "laspeyres" | "paasche" | "fisher" | "tornqvist";
export const INDEX_FORMULAS: IndexFormula[] = ["laspeyres", "paasche", "fisher", "tornqvist"];
export const INDEX_NAMES: Record<IndexFormula, string> = { laspeyres: "Laspeyres", paasche: "Paasche", fisher: "Fisher", tornqvist: "Törnqvist" };

export interface PriceTable {
  items: string[];
  periods: string[];
  /** prices[t][i], quantities[t][i]. */
  prices: Float64Array[];
  quantities: Float64Array[];
  notes: string[];
}

export const MAX_ITEMS = 10000;
export const MAX_PERIODS = 200;

const q = (s: string): string => `“${s}”`;
/** "Price 2022", "Prices 2022", "Price_2022", "P2022", "PY1" (the period label is the rest: "2022", "Y1"). */
const PRICE_HEAD = /^(?:prices?(?![a-z])|p)[\s_:.-]*(.*)$/i;
const QTY_HEAD = /^(?:quantit(?:y|ies)(?![a-z])|qty(?![a-z])|q)[\s_:.-]*(.*)$/i;

/** Reads the wide table. */
export function parsePriceTable(text: string): { ok: true; table: PriceTable } | { ok: false; reason: string } {
  const layout = "Lay the table out as Item | P2022 | Q2022 | P2023 | Q2023 …: one row per item, a price column then its quantity column for each period.";
  const parsed = parseRegData(text);
  if (!parsed.ok) return parsed;
  const { names, rows, named } = parsed.data;
  if (!named) return { ok: false, reason: `The table needs a header row. ${layout}` };
  const valueNames = names.slice(1);
  if (valueNames.length < 4 || valueNames.length % 2 !== 0) {
    return { ok: false, reason: `After the item column the table needs pairs of price and quantity columns for at least two periods (it has ${valueNames.length} columns). ${layout}` };
  }
  const periods: string[] = [];
  for (let k = 0; k < valueNames.length; k += 2) {
    const pm = PRICE_HEAD.exec(valueNames[k]);
    const qm = QTY_HEAD.exec(valueNames[k + 1]);
    if (!pm) return { ok: false, reason: `Column ${q(valueNames[k])} should be a price column (P2022 or Price 2022). ${layout}` };
    if (!qm) return { ok: false, reason: `Column ${q(valueNames[k + 1])} should be the quantity column after ${q(valueNames[k])} (Q2022 or Qty 2022). ${layout}` };
    const label = pm[1].trim() || `Period ${k / 2 + 1}`;
    if (qm[1].trim() && qm[1].trim().toLowerCase() !== pm[1].trim().toLowerCase()) {
      return { ok: false, reason: `The quantity column ${q(valueNames[k + 1])} does not match its price column ${q(valueNames[k])}. ${layout}` };
    }
    if (periods.some((p) => p.toLowerCase() === label.toLowerCase())) return { ok: false, reason: `Period ${q(label)} appears twice in the header.` };
    periods.push(label);
  }
  if (periods.length > MAX_PERIODS) return { ok: false, reason: `The table has ${periods.length} periods; the most is ${MAX_PERIODS}.` };
  if (rows.length > MAX_ITEMS) return { ok: false, reason: `The table has ${rows.length.toLocaleString("en-US")} items; the most is ${MAX_ITEMS.toLocaleString("en-US")}.` };
  const items = rows.map((r, i) => (r[0] ?? "").trim() || `Row ${i + 1}`);
  const seen = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const key = items[i].toLowerCase();
    if (seen.has(key)) return { ok: false, reason: `Item ${q(items[i])} appears in rows ${seen.get(key)! + 1} and ${i + 1}; list each item once.` };
    seen.set(key, i);
  }

  // Missing cells first, by item and period: a new or vanished item is refused with the reason.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const qMissing: number[] = [];
    for (let k = 0; k < periods.length; k++) if (isMissingCell(r[2 + 2 * k] ?? "")) qMissing.push(k);
    if (qMissing.length > 0 && qMissing.length < periods.length) {
      const has = periods.filter((_, k) => !qMissing.includes(k));
      return {
        ok: false,
        reason:
          `Item ${q(items[i])} has a quantity in ${has.map(q).join(", ")} but not in ${qMissing.map((k) => q(periods[k])).join(", ")}: ` +
          "a new or vanished item. A matched-item index needs every item in every period; remove it or supply the missing quantity (no imputation is made).",
      };
    }
    if (qMissing.length === periods.length) return { ok: false, reason: `Item ${q(items[i])} has no quantity in any period.` };
    for (let k = 0; k < periods.length; k++) {
      if (isMissingCell(r[1 + 2 * k] ?? "")) return { ok: false, reason: `Item ${q(items[i])} has no price in ${q(periods[k])}.` };
    }
  }

  const data: RegDataset = { names: valueNames, rows: rows.map((r) => r.slice(1)), named: true, semicolon: parsed.data.semicolon };
  const sel = selectColumns(data, { dep: valueNames[0], preds: valueNames.slice(1), text: "" });
  if (!sel.ok) return sel;
  const cols = [sel.cols.y, ...sel.cols.X];
  const prices: Float64Array[] = [];
  const quantities: Float64Array[] = [];
  for (let k = 0; k < periods.length; k++) {
    const p = cols[2 * k];
    const qq = cols[2 * k + 1];
    for (let i = 0; i < items.length; i++) {
      if (!(p[i] > 0) || !Number.isFinite(p[i])) return { ok: false, reason: `Item ${q(items[i])} in ${q(periods[k])}: a price must be greater than zero.` };
      if (!(qq[i] >= 0) || !Number.isFinite(qq[i])) return { ok: false, reason: `Item ${q(items[i])} in ${q(periods[k])}: a quantity cannot be negative.` };
    }
    prices.push(p);
    quantities.push(qq);
  }
  for (let k = 0; k < periods.length; k++) {
    let any = false;
    for (let i = 0; i < items.length && !any; i++) if (quantities[k][i] > 0) any = true;
    if (!any) return { ok: false, reason: `Every quantity in ${q(periods[k])} is zero, so that period has no expenditure to weight by.` };
  }
  return { ok: true, table: { items, periods, prices, quantities, notes: sel.cols.notes } };
}

/** The bilateral index comparing period t with period s (1 = no change). */
export function bilateral(tbl: PriceTable, s: number, t: number, f: IndexFormula): number {
  const ps = tbl.prices[s];
  const pt = tbl.prices[t];
  const qs = tbl.quantities[s];
  const qt = tbl.quantities[t];
  const n = ps.length;
  if (f === "tornqvist") {
    let es = 0;
    let et = 0;
    for (let i = 0; i < n; i++) {
      es += ps[i] * qs[i];
      et += pt[i] * qt[i];
    }
    let lg = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 * ((ps[i] * qs[i]) / es + (pt[i] * qt[i]) / et);
      if (w > 0) lg += w * Math.log(pt[i] / ps[i]);
    }
    return Math.exp(lg);
  }
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (let i = 0; i < n; i++) {
    a += pt[i] * qs[i];
    b += ps[i] * qs[i];
    c += pt[i] * qt[i];
    d += ps[i] * qt[i];
  }
  const L = a / b;
  const P = c / d;
  if (f === "laspeyres") return L;
  if (f === "paasche") return P;
  return Math.sqrt(L * P);
}

/** The index series (first period = 1) by formula, fixed base or chained. */
export function indexSeries(tbl: PriceTable, f: IndexFormula, chained: boolean): number[] {
  const T = tbl.periods.length;
  const out = [1];
  for (let t = 1; t < T; t++) out.push(chained ? out[t - 1] * bilateral(tbl, t - 1, t, f) : bilateral(tbl, 0, t, f));
  return out;
}

/** The series rebased so period r = 100. */
export function rebase(series: number[], r: number): number[] {
  const b = series[r];
  return series.map((v) => (v / b) * 100);
}
