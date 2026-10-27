/**
 * Book depreciation schedules (release F1, gap item #9; fixes D11): straight line, declining balance (Excel DDB
 * semantics, optionally switching to straight line as Excel VDB does), sum-of-the-years'-digits and units of
 * production. Whole years, the asset placed in service at the start of year 1. Pure: no Office.js, no DOM.
 *
 * Methods (Excel names in brackets; scripts/sched-oracle.py transcribes the same formulas independently and checks
 * them against Microsoft's worked examples for SLN, SYD, DDB and VDB):
 *   sl     (cost − salvage)/life each year                                                         [SLN]
 *   db     min(book × factor/life, book − salvage): stops at salvage, may never reach it           [DDB]
 *   dbsl   as db, but in any year where (book − salvage)/(years left) is larger, that is the charge [VDB, no_switch FALSE]
 *   syd    (cost − salvage) × (life − k + 1)/(life(life + 1)/2)                                     [SYD]
 *   uop    (cost − salvage) × units in the year / total units, never below salvage
 */

export type DeprMethod = "sl" | "db" | "dbsl" | "syd" | "uop";

export interface DeprRow {
  year: number;
  opening: number;
  depreciation: number;
  accumulated: number;
  closing: number;
  /** "SL" or "DB" for the switching method (the method that set the year's charge); otherwise empty. */
  basis: "" | "DB" | "SL";
  units?: number;
}

export interface DeprSchedule {
  rows: DeprRow[];
  /** db: book value left above salvage after the last year (D11). */
  shortfall: number;
  /** dbsl: the first year charged straight line, or 0 when declining balance never gave way. */
  switchYear: number;
  /** uop: the total units used as the denominator, and whether the listed units exceeded it. */
  totalUnits?: number;
  unitsCapped?: boolean;
}

export const MAX_DEPR_LIFE = 100;

export interface DeprInput {
  method: DeprMethod;
  cost: number;
  salvage: number;
  /** Whole years (sl, db, dbsl, syd); for uop the number of years is the length of `units`. */
  life: number;
  factor?: number;
  units?: number[];
  totalUnits?: number;
}

export function depreciationSchedule(inp: DeprInput): DeprSchedule | { error: string } {
  const { method, cost, salvage } = inp;
  if (!Number.isFinite(cost) || cost <= 0) return { error: "Cost must be a positive number." };
  if (!Number.isFinite(salvage) || salvage < 0) return { error: "Salvage value must be zero or more." };
  if (salvage > cost) return { error: "Salvage value cannot exceed the cost (the asset would appreciate, not depreciate)." };
  const base = cost - salvage;
  const rows: DeprRow[] = [];
  let book = cost;
  const push = (dep: number, b: DeprRow["basis"] = "", units?: number): void => {
    const opening = book;
    book = opening - dep;
    // the last cent of floating drift: never below salvage
    if (book < salvage && book > salvage - 1e-9 * Math.max(1, cost)) book = salvage;
    rows.push({ year: rows.length + 1, opening, depreciation: dep, accumulated: cost - book, closing: book, basis: b, ...(units !== undefined ? { units } : {}) });
  };

  if (method === "uop") {
    const units = inp.units ?? [];
    if (!units.length) return { error: "Units produced: enter one number per year." };
    if (units.length > MAX_DEPR_LIFE) return { error: `Units produced: at most ${MAX_DEPR_LIFE} years (got ${units.length}).` };
    if (units.some((u) => !Number.isFinite(u) || u < 0)) return { error: "Units produced: every year's units must be zero or more." };
    const listed = units.reduce((a, b) => a + b, 0);
    const total = inp.totalUnits ?? listed;
    if (!Number.isFinite(total) || total <= 0) return { error: "Total units over the asset's life must be positive." };
    let capped = false;
    for (const u of units) {
      let dep = (base * u) / total;
      if (dep > book - salvage) {
        if (dep - (book - salvage) > 1e-9 * Math.max(1, cost)) capped = true;
        dep = Math.max(0, book - salvage);
      }
      push(dep, "", u);
    }
    return { rows, shortfall: book - salvage, switchYear: 0, totalUnits: total, unitsCapped: capped };
  }

  const life = inp.life;
  if (!Number.isFinite(life) || life < 1 || !Number.isInteger(life)) return { error: "Useful life must be a whole number of years, 1 or more." };
  if (life > MAX_DEPR_LIFE) return { error: `Useful life must be at most ${MAX_DEPR_LIFE} years.` };

  if (method === "sl") {
    for (let k = 1; k <= life; k++) push(k === life ? book - salvage : base / life);
    return { rows, shortfall: 0, switchYear: 0 };
  }
  if (method === "syd") {
    const s = (life * (life + 1)) / 2;
    for (let k = 1; k <= life; k++) push(k === life ? book - salvage : (base * (life - k + 1)) / s);
    return { rows, shortfall: 0, switchYear: 0 };
  }
  const factor = inp.factor ?? 2;
  if (!Number.isFinite(factor) || factor <= 0) return { error: "Declining-balance factor must be positive (2 = double declining)." };
  if (factor > 10) return { error: "Declining-balance factor must be at most 10." };
  let switchYear = 0;
  for (let k = 1; k <= life; k++) {
    const db = Math.max(0, Math.min((book * factor) / life, book - salvage));
    if (method === "dbsl") {
      const sl = Math.max(0, (book - salvage) / (life - k + 1));
      if (switchYear || sl > db) {
        if (!switchYear) switchYear = k;
        push(k === life ? book - salvage : sl, "SL");
      } else push(db, "DB");
    } else push(db);
  }
  return { rows, shortfall: book - salvage, switchYear };
}
