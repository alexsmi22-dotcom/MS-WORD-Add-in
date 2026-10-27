/**
 * Release F2 litigation damages (#6 securities, #20 antitrust): the engines against fixtures/litig-oracle.json
 * (scripts/litig-oracle.py: independent Python re-implementations of the ribbon, FIFO/LIFO, the 90-day mean and the
 * trading model, and statsmodels for the regressions), hand-checked cases, hostile inputs, and the pane contract
 * (the finSpreadContract read path copied here, since the integrator spreads LITIG_CALCS later).
 *
 * Tolerances: per-share and per-day amounts 1e-9 relative; trading-model window damages 1e-9 relative; OLS
 * coefficients, SEs and p-values 1e-7 relative (absolute 1e-10 near zero); cent totals exact.
 */
import * as fs from "fs";
import * as path from "path";
import oracle from "./fixtures/litig-oracle.json";
import { LITIG_CALCS } from "../litigCalcs";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { civilDay, civilFromDay } from "../damagesInterest";
import {
  inflationRibbon,
  matchTrades,
  lookbackTable,
  proportionalModel,
  PSLRA_E1,
  PSLRA_E2,
  PSLRA_E3,
  MAX_TRADES,
  MAX_SEC_DAYS,
  MAX_DISCLOSURES,
  type Trade,
} from "../securitiesDamages";
import { readOverchargeData, dummyMethod, forecastMethod, estimatePassThrough, periodKind } from "../antitrustDamages";

const day = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return civilDay(y, m, d);
};
const iso = (n: number): string => {
  const { y, m, d } = civilFromDay(n);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const close = (a: number, b: number, rel = 1e-9, abs = 1e-10): void => {
  if (Math.abs(a - b) > abs + rel * Math.abs(b)) throw new Error(`expected ${b}, got ${a}`);
};

/** The pane's read (finSpreadContract.run): number fields through readFinanceField first, the rest as typed. */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}
const calc = (id: string): FinCalcDef => LITIG_CALCS.find((c) => c.id === id)!;
type Out = { text: string; svg?: string; ok?: boolean; tables?: { label: string; rows: string[][] }[] };
const out = (id: string, over: Record<string, string> = {}): Out => {
  const o = run(calc(id), over);
  return typeof o === "string" ? { text: o } : (o as Out);
};
const okOut = (id: string, over: Record<string, string> = {}): Out => {
  const o = out(id, over);
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  return o;
};
const refusal = (id: string, over: Record<string, string>): string => {
  const o = out(id, over);
  if (o.ok !== false) throw new Error(`expected a refusal, got: ${o.text.slice(0, 200)}`);
  return o.text;
};
const money = (s: string): number => Number(s.replace(/[$,]/g, "").replace("−", "-"));

// ---------------------------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------------------------

describe("pane contract (finSpreadContract read path)", () => {
  const SRC = path.join(__dirname, "..", "..");
  const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8");
  const paneIds = [...PANE.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);
  const libIds = fs
    .readdirSync(path.join(SRC, "lib"))
    .filter((f) => /Calcs\.ts$/.test(f) && f !== "litigCalcs.ts")
    .flatMap((f) => [...fs.readFileSync(path.join(SRC, "lib", f), "utf8").matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]));

  test("ids are lowercase kebab, unique, and collide with no pane or library id", () => {
    const ids = LITIG_CALCS.map((c) => c.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(paneIds).not.toContain(id);
      expect(libIds).not.toContain(id);
    }
  });

  test("registry source form: 4-space id lines, compute → one-line comment → return engine(r)", () => {
    const src = fs.readFileSync(path.join(SRC, "lib", "litigCalcs.ts"), "utf8").replace(/\r\n/g, "\n");
    expect([...src.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1])).toEqual(LITIG_CALCS.map((c) => c.id));
    const computes = [...src.matchAll(/compute: \(r\) => \{\n\s*\/\/ [^\n]+\n\s*return [A-Za-z]+\(r\);\n\s*\}/g)];
    expect(computes.length).toBe(LITIG_CALCS.length);
  });

  describe.each(LITIG_CALCS.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    test("group, name, defaults", () => {
      expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
      expect(c.group).toBe("Litigation damages");
      expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
      for (const f of c.fields) {
        expect(typeof f.default).toBe("string");
        if (f.kind === "select") expect(f.options!.map((o) => o.value)).toContain(f.default);
      }
    });
    test("defaults compute to an insertable result; tables ≤ 6 columns with insertable cells; no em dash", () => {
      const t0 = Date.now();
      const o = run(c);
      expect(Date.now() - t0).toBeLessThan(300);
      const r = typeof o === "string" ? { text: o } : o;
      expect(r.ok).not.toBe(false);
      expect(insertableResultText(r.text)).toBe(true);
      expect(r.text).not.toMatch(/\bNaN\b|Infinity|undefined|e[+-]\d/);
      const tables = r.tables ?? (r.table ? [r.table] : []);
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) {
        expect(t.rows[0].length).toBeLessThanOrEqual(6);
        for (const row of t.rows) {
          expect(row.length).toBe(t.rows[0].length);
          for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
        }
        if (t.align) expect(t.align.length).toBe(t.rows[0].length);
      }
      expect(r.text).toMatch(/Conventions: /);
      expect(r.svg).toBeTruthy();
    });
    test("module draws no Math.random", () => {
      for (const f of ["litigCalcs.ts", "securitiesDamages.ts", "antitrustDamages.ts"]) {
        expect(fs.readFileSync(path.join(SRC, "lib", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (a) Ribbon
// ---------------------------------------------------------------------------------------------------------------

describe("inflation ribbon vs the Python oracle", () => {
  test.each(oracle.ribbons.map((r) => [r.name, r] as const))("%s", (_n, c) => {
    const days = c.days.map(day);
    const disc = c.disc.map(day);
    for (const [mode, want] of [
      ["ar-dollar", c.dollar],
      ["ar-pct", c.pct],
    ] as const) {
      const res = inflationRibbon(days, c.close, disc, c.ar, mode);
      if ("error" in res) throw new Error(res.error);
      res.inflation.forEach((x, i) => close(x, want[i]));
      res.drops.forEach((x, j) => close(x, c.drops[j]));
    }
    // Dollar mode with the oracle's drops reproduces the constant-dollar ribbon.
    const res = inflationRibbon(days, c.close, disc, c.drops, "dollar");
    if ("error" in res) throw new Error(res.error);
    res.inflation.forEach((x, i) => close(x, c.dollar[i]));
  });

  test("hand case: closes 10, 10, 8, 8; −20% on day 3 → drop 2 (0.2 × prior close 10), inflation 2, 2, 0, 0", () => {
    const days = [day("2025-01-06"), day("2025-01-07"), day("2025-01-08"), day("2025-01-09")];
    const r = inflationRibbon(days, [10, 10, 8, 8], [days[2]], [-0.2], "ar-dollar");
    if ("error" in r) throw new Error(r.error);
    expect(r.inflation).toEqual([2, 2, 0, 0]);
    const p = inflationRibbon(days, [10, 12, 8, 8], [days[2]], [-0.2], "ar-pct");
    if ("error" in p) throw new Error(p.error);
    // Constant percentage: 20% of each pre-disclosure close (10 → 2, 12 → 2.4).
    p.inflation.forEach((x, i) => close(x, [2, 2.4, 0, 0][i]));
  });

  test("default text and tables", () => {
    const o = okOut("dmg-sec-ribbon");
    expect(o.text).toContain("Inflation per share on March 3, 2025 (the class-period start, the price table's first day): $5.9312");
    expect(o.tables![0].rows[1]).toEqual(["March 17, 2025", "$40.15", "$37.54", "−6.20%", "$2.4893"]);
    expect(o.tables![1].rows[2]).toEqual(["Window 2", "March 17, 2025", "March 28, 2025", "10", "$3.4419"]);
  });

  test("constant percentage, dollar mode, % cells, decimals", () => {
    const pct = okOut("dmg-sec-ribbon", { mode: "ar-pct" });
    expect(pct.text).toContain("constant percentage");
    expect(pct.tables![1].rows[0]).toHaveLength(6);
    const dec = okOut("dmg-sec-ribbon", { units: "decimal", disclosures: "2025-03-17\t−0.062\n2025-03-31\t−0.093" });
    expect(dec.text).toContain("$5.9312");
    const pctCells = okOut("dmg-sec-ribbon", { units: "decimal", disclosures: "2025-03-17\t−6.2%\n2025-03-31\t−9.3%" });
    expect(pctCells.text).toContain("$5.9312");
    expect(pctCells.text).toContain("read as percent");
    const dol = okOut("dmg-sec-ribbon", { mode: "dollar", disclosures: "2025-03-17\t$2.4893\n2025-03-31\t$3.4419" });
    expect(dol.text).toContain("$5.9312");
  });

  test("refusals name the problem", () => {
    expect(refusal("dmg-sec-ribbon", { disclosures: "2025-03-15\t−6.2" })).toMatch(/not a row of the price table/);
    expect(refusal("dmg-sec-ribbon", { disclosures: "2025-03-17\t6.2" })).toMatch(/not a price decline/);
    expect(refusal("dmg-sec-ribbon", { disclosures: "2025-03-17\t−100" })).toMatch(/−100% or below/);
    expect(refusal("dmg-sec-ribbon", { disclosures: "2025-03-03\t−6.2" })).toMatch(/must come after the first day/);
    expect(refusal("dmg-sec-ribbon", { mode: "dollar", disclosures: "2025-03-17\t30\n2025-03-31\t20" })).toMatch(/not below the close/);
    expect(refusal("dmg-sec-ribbon", { mode: "dollar", disclosures: "2025-03-17\t2%" })).toMatch(/in percent/);
    expect(refusal("dmg-sec-ribbon", { prices: "" })).toMatch(/price table is empty/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03-03\t€41.82\n2025-03-17\t€40" })).toMatch(/not the US dollar|€/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03-03\t41.82\n2025-03-17\t−40" })).toMatch(/must be positive/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03-03\t41.82\n2025-03-17\tNaN" })).toMatch(/no value|not a number/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03-03\t41.82\n2025-03-17\t1e400" })).toMatch(/not a number/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03\t41.82\n2025-04\t40" })).toMatch(/period, not a single day/);
    expect(refusal("dmg-sec-ribbon", { prices: "2025-03-04\t41.82\n2025-03-03\t40" })).toMatch(/oldest first/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (b) Out-of-pocket loss
// ---------------------------------------------------------------------------------------------------------------

const blotterText = (rows: (string | number)[][]): string => ["Date\tSide\tShares\tPrice", ...rows.map((r) => r.join("\t"))].join("\n");
const dropText = (disc: string[], drops: number[]): string => ["Date\tDrop", ...disc.map((d, i) => `${d}\t${drops[i]}`)].join("\n");

describe("out-of-pocket loss vs the Python oracle (FIFO/LIFO)", () => {
  test.each(oracle.oop.map((o) => [o.name, o] as const))("%s", (_n, c) => {
    const o = okOut("dmg-sec-oop", {
      start: c.start,
      disclosures: dropText(c.disc, c.drops),
      blotter: blotterText(c.blotter),
      held: String(c.opening),
      match: c.method,
    });
    const total = money(/Out-of-pocket loss (\S+)/.exec(o.text)![1]);
    expect(total).toBeCloseTo(c.total, 6);
    const held = Number(/Holdings at the end of the class period \([^)]*\): ([\d,.]+)/.exec(o.text)![1].replace(/,/g, ""));
    expect(held).toBeCloseTo(c.held, 6);
    // The matched lots, one for one (engine level).
    const trades: Trade[] = c.blotter.map((r, i) => ({ day: day(r[0] as string), buy: r[1] === "buy", shares: r[2] as number, price: r[3] as number, row: i + 1 }));
    const m = matchTrades(trades, c.opening, c.method as "fifo" | "lifo");
    if ("error" in m) throw new Error(m.error);
    expect(m.matches.map((x) => [x.buyRow, x.sellDay === null ? null : iso(x.sellDay), x.shares])).toEqual(c.lots.map((l) => [l.buyRow, l.sell, l.shares]));
    const lots = o.tables![2].rows.slice(1).map((r) => money(r[5]));
    expect(lots).toEqual(c.lots.map((l) => l.loss));
  });

  test("hand case (default FIFO): 248.93 + 4,151.84 + 1,186.24 + 2,965.60 + 1,376.76 = $9,929.37", () => {
    const o = okOut("dmg-sec-oop");
    expect(o.text).toContain("Out-of-pocket loss $9,929.37 on 1,900 shares");
    expect(o.text).toContain("Holdings at the end of the class period (March 30, 2025): 1,800 shares.");
    expect(okOut("dmg-sec-oop", { match: "lifo" }).text).toContain("Out-of-pocket loss $8,208.42");
  });

  test("round trip: the ribbon's disclosure table pasted into the out-of-pocket calculator", () => {
    const rib = okOut("dmg-sec-ribbon");
    const pasted = rib.tables![0].rows.map((r) => r.join("\t")).join("\n");
    const o = okOut("dmg-sec-oop", { disclosures: pasted });
    expect(o.text).toContain("Out-of-pocket loss $9,929.37");
    expect(o.text).toContain("value columns; “Inflation removed per share” was read as the inflation removed per share");
    // The constant-percentage table's last column is in percent: refused, never read as dollars.
    const pct = okOut("dmg-sec-ribbon", { mode: "ar-pct" });
    const pastedPct = pct.tables![0].rows.map((r) => r.join("\t")).join("\n");
    expect(refusal("dmg-sec-oop", { disclosures: pastedPct })).toMatch(/in percent/);
  });

  test("hostile inputs and refusals", () => {
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Sell", 900, 40]]), held: "0" })).toMatch(/more than the shares held/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Hold", 900, 40]]) })).toMatch(/“Hold” is not Buy or Sell/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-02-30", "Buy", 900, 40]]) })).toMatch(/blotter row 1/i);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", -900, 40]]) })).toMatch(/must be positive/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", 0, 40]]) })).toMatch(/must be positive/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", 900, "NA"]]) })).toMatch(/no price/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", 900, "1e400"]]) })).toMatch(/not a number/);
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", 900, "€40"]]) })).toMatch(/€/);
    expect(refusal("dmg-sec-oop", { blotter: "2025-03-05\tBuy\t900" })).toMatch(/exactly four/);
    expect(refusal("dmg-sec-oop", { held: "abc" })).toMatch(/shares held before the class period: “abc” is not a number/i);
    expect(refusal("dmg-sec-oop", { held: "−5" })).toMatch(/cannot be negative/);
    expect(refusal("dmg-sec-oop", { start: "2025-03-20" })).toMatch(/must come after the class-period start/);
    expect(refusal("dmg-sec-oop", { start: "" })).toMatch(/class-period start date/);
    expect(refusal("dmg-sec-oop", { disclosures: "2025-03-17\t−2" })).toMatch(/must be positive/);
    expect(refusal("dmg-sec-oop", { match: "hifo" })).toMatch(/Unknown matching/);
    // US thousands and a decimal comma price are read by the regression reader's rules; mixing them is refused.
    const k = okOut("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", "1,000", "41.20"]]), held: "0" });
    expect(k.text).toContain("Out-of-pocket loss $5,931.20 on 1,000 shares");
    const dc = okOut("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", "100", "41,2"]]), held: "0" });
    expect(dc.text).toContain("$593.12");
    expect(refusal("dmg-sec-oop", { blotter: blotterText([["2025-03-05", "Buy", "1,000", "41,2"]]) })).toMatch(/ambiguous/);
    // Out of order rows are sorted (same day keeps the pasted order) and said.
    const so = okOut("dmg-sec-oop", { blotter: blotterText([["2025-03-10", "Sell", 100, 40], ["2025-03-05", "Buy", 100, 41]]), held: "0" });
    expect(so.text).toContain("put in date order");
    const big = Array.from({ length: MAX_TRADES + 1 }, () => ["2025-03-05", "Buy", 1, 40]);
    expect(refusal("dmg-sec-oop", { blotter: blotterText(big) })).toMatch(/the most is 5,000/);
  });

  test("5,000 trades and 50 disclosures compute within the keystroke budget", () => {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < MAX_TRADES; i++) rows.push([iso(day("2015-01-05") + i), i % 3 === 2 ? "Sell" : "Buy", 100, 40]);
    const disc = Array.from({ length: MAX_DISCLOSURES }, (_, j) => iso(day("2015-02-01") + j * 90));
    const t0 = Date.now();
    const o = okOut("dmg-sec-oop", { start: "2015-01-05", disclosures: dropText(disc, disc.map(() => 0.1)), blotter: blotterText(rows), held: "0", match: "lifo" });
    const ms = Date.now() - t0;
    expect(o.text).toContain("Out-of-pocket loss");
    expect(ms).toBeLessThan(1500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (c) PSLRA
// ---------------------------------------------------------------------------------------------------------------

describe("PSLRA 90-day lookback", () => {
  test("the statute is quoted exactly as supplied (15 U.S.C. § 78u-4(e))", () => {
    expect(PSLRA_E1).toBe(
      "Except as provided in paragraph (2), in any private action arising under this chapter in which the plaintiff seeks to establish damages by reference to the market price of a security, the award of damages to the plaintiff shall not exceed the difference between the purchase or sale price paid or received, as appropriate, by the plaintiff for the subject security and the mean trading price of that security during the 90-day period beginning on the date on which the information correcting the misstatement or omission that is the basis for the action is disseminated to the market.",
    );
    expect(PSLRA_E2).toBe(
      "In any private action arising under this chapter in which the plaintiff seeks to establish damages by reference to the market price of a security, if the plaintiff sells or repurchases the subject security prior to the expiration of the 90-day period described in paragraph (1), the plaintiff's damages shall not exceed the difference between the purchase or sale price paid or received, as appropriate, by the plaintiff for the security and the mean trading price of the security during the period beginning immediately after dissemination of information correcting the misstatement or omission and ending on the date on which the plaintiff sells or repurchases the security.",
    );
    expect(PSLRA_E3).toBe(
      'For purposes of this subsection, the "mean trading price" of a security shall be an average of the daily trading price of that security, determined as of the close of the market each day during the 90-day period referred to in paragraph (1).',
    );
    const o = okOut("dmg-pslra");
    expect(o.text).toContain(`15 U.S.C. § 78u-4(e)(1): “${PSLRA_E1}”`);
    expect(o.text).toContain(`15 U.S.C. § 78u-4(e)(3): “${PSLRA_E3}”`);
    expect(insertableResultText(o.text)).toBe(true);
  });

  test.each(oracle.lookbacks.map((l) => [l.name, l] as const))("vs the Python oracle: %s", (_n, c) => {
    const lb = lookbackTable(c.rows.map((r) => day(r[0] as string)), c.rows.map((r) => r[1] as number), day(c.disclosure));
    if ("error" in lb) throw new Error(lb.error);
    expect(iso(lb.periodEnd)).toBe(c.end);
    expect(lb.rows.length).toBe(c.n);
    close(lb.mean90!, c.mean90);
    if (c.sale) {
      const s = day(c.sale);
      const used = lb.rows.filter((x) => x.day <= s);
      close(used[used.length - 1].mean, c.meanSale!);
    }
  });

  test("default and (e)(2) texts", () => {
    const o = okOut("dmg-pslra");
    expect(o.text).toContain("The 90-day period: March 31, 2025 to June 28, 2025.");
    expect(o.text).toContain("Mean trading price over the 90-day period: $34.5947 (62 closes).");
    expect(o.text).toContain("Cap per share = purchase price $41.20 − mean trading price $34.5947 = $6.6053.");
    expect(o.text).toContain("Damages per share after the cap: $5.9312");
    const s = okOut("dmg-pslra", { sale: "2025-05-09" });
    expect(s.text).toContain("mean trading price $33.9617");
    expect(s.text).toContain("Rule (e)(2): sold May 9, 2025");
    expect(s.text).toContain(`(2): “${PSLRA_E2}”`);
    const late = okOut("dmg-pslra", { sale: "2025-08-01" });
    expect(late.text).toContain("Rule (e)(1): sold August 1, 2025, after the 90-day period");
    // A cap below the loss limits it; a cap below zero floors damages at zero.
    expect(okOut("dmg-pslra", { loss: "9" }).text).toContain("Damages per share after the cap: $6.6053");
    expect(okOut("dmg-pslra", { purchase: "30" }).text).toMatch(/below zero.*\n.*Damages per share after the cap: \$0\.00/);
    // No purchase price: the mean only.
    expect(okOut("dmg-pslra", { purchase: "", loss: "" }).text).toContain("Enter the purchase price to compute the cap per share.");
  });

  test("hand case: closes 10, 20, 30 on D, D+1, D+89 (a close at D+90 ignored) → mean 20", () => {
    const D = day("2025-01-02");
    const lb = lookbackTable([D, D + 1, D + 89, D + 90], [10, 20, 30, 1000], D);
    if ("error" in lb) throw new Error(lb.error);
    expect(lb.mean90).toBe(20);
    expect(lb.rows.map((r) => r.dayOfPeriod)).toEqual([1, 2, 90]);
  });

  test("coverage: a short series is refused, a weekend gap at the end is noted", () => {
    const rows = (oracle.lookbacks[0].rows as (string | number)[][]).filter((r) => (r[0] as string) <= "2025-06-20");
    const t = ["Date\tClose", ...rows.map((r) => `${r[0]}\t${r[1]}`)].join("\n");
    expect(refusal("dmg-pslra", { prices: t })).toMatch(/stops on June 20, 2025, but the 90-day period runs to June 28, 2025/);
    // Within the period, a sale before the series ends still computes (e)(2).
    expect(okOut("dmg-pslra", { prices: t, sale: "2025-05-09" }).text).toContain("$33.9617");
    const upToFri = (oracle.lookbacks[0].rows as (string | number)[][]).filter((r) => (r[0] as string) <= "2025-06-27");
    const t2 = ["Date\tClose", ...upToFri.map((r) => `${r[0]}\t${r[1]}`)].join("\n");
    expect(okOut("dmg-pslra", { prices: t2 }).text).toContain("taken as non-trading days");
  });

  test("refusals", () => {
    expect(refusal("dmg-pslra", { disclosure: "2025-02-30" })).toMatch(/corrective disclosure date/i);
    expect(refusal("dmg-pslra", { disclosure: "" })).toMatch(/Enter the corrective disclosure date/);
    expect(refusal("dmg-pslra", { sale: "2025-03-01" })).toMatch(/before the disclosure date/);
    expect(refusal("dmg-pslra", { sale: "soon" })).toMatch(/Sale date: “soon” is not a date/);
    expect(refusal("dmg-pslra", { purchase: "−5" })).toMatch(/purchase price per share must be positive/);
    expect(refusal("dmg-pslra", { purchase: "1e400" })).toMatch(/purchase price per share: “1e400” is not a number/i);
    expect(refusal("dmg-pslra", { purchase: "", loss: "3" })).toMatch(/Enter the purchase price/);
    expect(refusal("dmg-pslra", { disclosure: "2026-01-05" })).toMatch(/no close on or after the disclosure date/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (d) Trading model
// ---------------------------------------------------------------------------------------------------------------

describe("trading model vs the Python block simulation", () => {
  test.each(oracle.trading.map((t) => [t.name, t] as const))("%s", (_n, c) => {
    const start = day(c.start);
    const disc = c.disc.map(day);
    const end = disc[disc.length - 1] - 1;
    const rows = (c.rows as (string | number)[][]).map((r) => [day(r[0] as string), r[1] as number] as const).filter(([d]) => d >= start && d <= end);
    const days = rows.map((r) => r[0]);
    const vol = rows.map((r) => r[1] * (1 - c.reduction));
    const infl = c.drops.map((_, w) => c.drops.slice(w).reduce((s, x) => s + x, 0)).concat([0]);
    const one = proportionalModel(days, vol, disc, infl, c.float, "adjusted");
    if ("error" in one) throw new Error(one.error);
    one.byWindow.forEach((x, w) => close(x, c.one[w]));
    close(one.retained, c.oneRetained);
    const A = proportionalModel(days, vol.map((v) => v * c.activeVolume), disc, infl, c.float * c.activeFloat, "a");
    const P = proportionalModel(days, vol.map((v) => v * (1 - c.activeVolume)), disc, infl, c.float * (1 - c.activeFloat), "p");
    if ("error" in A || "error" in P) throw new Error("refused");
    A.byWindow.forEach((x, w) => close(x + P.byWindow[w], c.two[w]));
    // Through the calculator: the totals are sums of the cent-rounded windows.
    const o = okOut("dmg-sec-aggregate", {
      start: c.start,
      disclosures: dropText(c.disc, c.drops),
      volume: ["Date\tVolume", ...(c.rows as (string | number)[][]).map((r) => `${r[0]}\t${r[1]}`)].join("\n"),
      float: String(c.float),
      reduction: String(c.reduction * 100),
      activeFloat: String(c.activeFloat * 100),
      activeVolume: String(c.activeVolume * 100),
    });
    const sumCents = (xs: number[]): number => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;
    expect(money(/One-trader \(proportional\) model: (\S+);/.exec(o.text)![1])).toBeCloseTo(sumCents(c.one), 2);
    expect(money(/Two-trader model: (\S+);/.exec(o.text)![1])).toBeCloseTo(sumCents(c.two), 2);
  });

  test("hand case: one window, float 100, volumes 10 then 20, inflation $1 → bought 30, sold 10 × 0.2 = 2 → damages 28", () => {
    const D = day("2025-01-06");
    const r = proportionalModel([D, D + 1], [10, 20], [D + 5], [1, 0], 100, "x");
    if ("error" in r) throw new Error(r.error);
    close(r.byWindow[0], 28);
    close(r.retained, 28);
  });

  test("labelled a model, every parameter printed", () => {
    const o = okOut("dmg-sec-aggregate");
    expect(o.text).toContain("TRADING MODEL ESTIMATE");
    expect(o.text).toContain("they are models that courts have criticized.");
    expect(o.text).toContain("float 50,000,000 shares; volume reduction 0%");
    expect(o.text).toContain("active traders hold 20% of the float (10,000,000 shares) and make 80% of the adjusted volume");
    expect(o.text).toContain("One-trader (proportional) model: $142,937,391.52");
    expect(o.text).toContain("Two-trader model: $90,945,345.73");
    expect(okOut("dmg-sec-aggregate", { model: "one" }).tables![0].rows[0]).toHaveLength(4);
    expect(calc("dmg-sec-aggregate").assumes).toMatch(/courts have criticized/);
  });

  test("refusals", () => {
    expect(refusal("dmg-sec-aggregate", { float: "1,000,000" })).toMatch(/turnover of 100% or more/);
    expect(refusal("dmg-sec-aggregate", { float: "0" })).toMatch(/float must be positive/);
    expect(refusal("dmg-sec-aggregate", { reduction: "100" })).toMatch(/below 100%/);
    expect(refusal("dmg-sec-aggregate", { activeFloat: "0" })).toMatch(/share of the float must be above 0%/);
    expect(refusal("dmg-sec-aggregate", { activeVolume: "x" })).toMatch(/share of the volume %: “x” is not a number/);
    expect(refusal("dmg-sec-aggregate", { volume: "2025-03-03\t−5" })).toMatch(/cannot be negative/);
    expect(refusal("dmg-sec-aggregate", { volume: "2025-04-01\t5" })).toMatch(/no trading day in the class period/);
    expect(refusal("dmg-sec-aggregate", { volume: "2025-03-03\t5%" })).toMatch(/in percent/);
    // The two-trader inputs are not needed for the one-trader model.
    expect(okOut("dmg-sec-aggregate", { model: "one", activeFloat: "", activeVolume: "" }).text).toContain("One-trader");
  });

  test("10,000 days × 50 disclosures within the budget", () => {
    const vol = ["Date\tVolume"];
    for (let i = 0; i < MAX_SEC_DAYS; i++) vol.push(`${iso(day("1990-01-01") + i)}\t1000`);
    const disc = Array.from({ length: MAX_DISCLOSURES }, (_, j) => iso(day("1990-01-01") + 200 * (j + 1)));
    const t0 = Date.now();
    const o = okOut("dmg-sec-aggregate", { start: "1990-01-01", disclosures: dropText(disc, disc.map(() => 0.5)), volume: vol.join("\n"), float: "1,000,000" });
    expect(o.text).toContain("Two-trader model");
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #20 Antitrust
// ---------------------------------------------------------------------------------------------------------------

describe("antitrust overcharge vs statsmodels", () => {
  const A = oracle.antitrust;
  const text = ["Month\tPeriod\tPrice\tCost\tDemand", ...A.labels.map((l, i) => [l, A.kinds[i], A.price[i], A.cost[i], A.demand[i]].join("\t"))].join("\n");

  test.each(A.regs.map((r) => [`${r.form} ${r.cov}`, r] as const))("%s", (_n, c) => {
    const d = readOverchargeData(text, "Price", "Period", "Cost, Demand", c.form === "log");
    if ("error" in d) throw new Error(d.error);
    const dm = dummyMethod(d, c.form === "log", c.cov as "classical" | "hc1" | "hac");
    if ("error" in dm) throw new Error(dm.error);
    dm.fit.model.terms.forEach((t, j) => {
      close(t.coef, c.dummy.params[j], 1e-7);
      close(t.se, c.dummy.bse[j], 1e-7);
      close(t.p, c.dummy.pvalues[j], 1e-6, 1e-12);
      close(t.ciLo, c.dummy.ciLo[j], 1e-7);
      close(t.ciHi, c.dummy.ciHi[j], 1e-7);
    });
    dm.butFor.forEach((x, m) => close(x, c.dummy.butFor[m], 1e-9));
    close(dm.perUnit, c.dummy.perUnit, 1e-7);
    close(dm.pctOfButFor, c.dummy.pctOfButFor, 1e-7);
    close(dm.shareOfActual, c.dummy.shareOfActual, 1e-7);
    const fc = forecastMethod(d, c.form === "log", c.cov as "classical" | "hc1" | "hac");
    if ("error" in fc) throw new Error(fc.error);
    fc.fit.model.terms.forEach((t, j) => {
      close(t.coef, c.forecast.params[j], 1e-7);
      close(t.se, c.forecast.bse[j], 1e-7);
    });
    fc.butFor.forEach((x, m) => close(x, c.forecast.butFor[m], 1e-8));
    close(fc.shareOfActual, c.forecast.shareOfActual, 1e-7);
    close(fc.pctOfButFor, c.forecast.pctOfButFor, 1e-7);
  });

  test("forecast with no controls is the before-period mean", () => {
    const d = readOverchargeData(text, "Price", "Period", "", false);
    if ("error" in d) throw new Error(d.error);
    const fc = forecastMethod(d, false, "classical");
    if ("error" in fc) throw new Error(fc.error);
    close(fc.butFor[0], A.forecastNoControls.butFor, 1e-10);
    close(fc.shareOfActual, A.forecastNoControls.shareOfActual, 1e-10);
  });

  test("pass-through slope vs statsmodels", () => {
    const pt = estimatePassThrough(calc("dmg-antitrust").fields.find((f) => f.key === "ptData")!.default);
    if ("error" in pt) throw new Error(pt.error);
    close(pt.rate, oracle.passthrough.rate, 1e-9);
    close(pt.se, oracle.passthrough.se, 1e-7);
    expect(okOut("dmg-antitrust", { pt: "estimated" }).text).toContain("Pass-through rate 64.33% (estimated");
  });

  test("damages table: dollars × share of actual price, units × overcharge per unit; totals foot", () => {
    const o = okOut("dmg-antitrust");
    const reg = A.regs.find((r) => r.form === "log" && r.cov === "hc1")!;
    const dmgTab = o.tables!.find((t) => t.label.startsWith("Damages by period"))!;
    const purchases = [1250000, 1410000, 1380000, 1525000];
    const dummyRows = purchases.map((p) => Math.round(p * reg.dummy.shareOfActual * 100) / 100);
    dmgTab.rows.slice(1, 5).forEach((r, i) => expect(money(r[3])).toBeCloseTo(dummyRows[i], 2));
    expect(money(dmgTab.rows[5][3])).toBeCloseTo(dummyRows.reduce((s, x) => s + x, 0), 2);
    expect(o.text).toContain("Pass-through rate 60.00% (entered).");
    const u = okOut("dmg-antitrust", { basis: "units", purchases: "2020\t1,000" });
    const ut = u.tables!.find((t) => t.label.startsWith("Damages by period"))!;
    expect(money(ut.rows[1][3])).toBeCloseTo(Math.round(1000 * reg.dummy.perUnit * 100) / 100, 2);
    expect(ut.rows[0][1]).toBe("Units purchased");
  });

  test("text prints the method, benchmark and formula", () => {
    const o = okOut("dmg-antitrust", { method: "dummy", form: "level", se: "hac" });
    expect(o.text).toContain("before and after rows pooled as the benchmark");
    expect(o.text).toContain("but-for price = P − δ");
    expect(o.text).toContain("Newey–West HAC");
    expect(o.text).not.toContain("Forecast method:");
  });

  test("periods, columns, hostile inputs", () => {
    expect(periodKind(" During ")).toBe("during");
    expect(periodKind("POST")).toBe("after");
    expect(periodKind("maybe")).toBeNull();
    expect(refusal("dmg-antitrust", { data: text.replace("\tduring\t", "\tcartelish\t") })).toMatch(/“cartelish” is not before, during or after/);
    expect(refusal("dmg-antitrust", { priceCol: "Cost price" })).toMatch(/Price column: No column is named “Cost price”/);
    expect(refusal("dmg-antitrust", { controls: "Cost, Weather" })).toMatch(/Controls: No column is named “Weather”/);
    expect(refusal("dmg-antitrust", { controls: "Price" })).toMatch(/is the price column/);
    expect(refusal("dmg-antitrust", { data: text.replace(/\tafter\t/g, "\tduring\t").replace(/\tbefore\t/g, "\tduring\t") })).toMatch(/no before- or after-period row/);
    expect(refusal("dmg-antitrust", { method: "forecast", data: text.split("\n").filter((l, i) => i === 0 || !l.includes("before") || i < 3).join("\n") })).toMatch(/needs more before-period rows/);
    expect(refusal("dmg-antitrust", { data: text.replace("97.13", "−97.13") })).toMatch(/must be positive/);
    expect(refusal("dmg-antitrust", { data: text.replace("97.13", "€97.13") })).toMatch(/€/);
    expect(refusal("dmg-antitrust", { data: text.replace("97.13", "1e400") })).toMatch(/not a number/);
    expect(refusal("dmg-antitrust", { purchases: "2020-Q1\t−5" })).toMatch(/Purchases: .*cannot be negative/);
    expect(refusal("dmg-antitrust", { purchases: "2020-Q1\t5 EUR" })).toMatch(/Purchases: .*EUR/);
    expect(refusal("dmg-antitrust", { ptRate: "abc" })).toMatch(/Pass-through rate %: “abc” is not a number/);
    expect(refusal("dmg-antitrust", { ptRate: "" })).toMatch(/Enter the pass-through rate/);
    expect(refusal("dmg-antitrust", { pt: "estimated", ptData: "1\t2\t3\t4" })).toMatch(/pass-through table has 4 columns/);
    expect(okOut("dmg-antitrust", { pt: "none", ptRate: "" }).text).not.toContain("Pass-through");
    // A missing control cell drops its row (listwise) with a note.
    const miss = okOut("dmg-antitrust", { data: text.replace("185.1", "NA") });
    expect(miss.text).toContain("1 row with a missing cell");
    expect(miss.text).toContain("29 rows (11 before, 12 during, 6 after)");
    // Dollar signs in the price table are US dollars.
    expect(okOut("dmg-antitrust", { data: text.replace("97.13", "$97.13") }).text).toContain("Dummy-variable method");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Own adversarial pass (cases not used while building)
// ---------------------------------------------------------------------------------------------------------------

describe("adversarial", () => {
  test("ribbon at the caps: 10,000 days × 50 disclosures, both methods, within the budget", () => {
    const rows = ["Date\tClose"];
    for (let i = 0; i < MAX_SEC_DAYS; i++) rows.push(`${iso(day("1990-01-01") + i)}\t${(100 + (i % 7)).toFixed(2)}`);
    const disc = ["Date\tAR"];
    for (let j = 1; j <= MAX_DISCLOSURES; j++) disc.push(`${iso(day("1990-01-01") + 150 * j)}\t−1`);
    for (const mode of ["ar-dollar", "ar-pct"]) {
      const t0 = Date.now();
      const o = okOut("dmg-sec-ribbon", { prices: rows.join("\n"), disclosures: disc.join("\n"), mode });
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(o.tables![1].rows.length).toBe(MAX_DISCLOSURES + 2);
    }
    disc.push(`${iso(day("1990-01-01") + 150 * 51)}\t−1`);
    expect(refusal("dmg-sec-ribbon", { prices: rows.join("\n"), disclosures: disc.join("\n") })).toMatch(/the most is 50/);
    rows.push(`${iso(day("1990-01-01") + MAX_SEC_DAYS)}\t100`);
    expect(refusal("dmg-sec-ribbon", { prices: rows.join("\n"), disclosures: "1990-03-01\t−1" })).toMatch(/the most is 10,000/);
  });

  test("fractional shares: 0.1 + 0.2 bought, 0.3 sold leaves nothing held and no short-sale refusal", () => {
    const o = okOut("dmg-sec-oop", { held: "0", blotter: blotterText([["2025-03-05", "Buy", 0.1, 40], ["2025-03-06", "Buy", 0.2, 40], ["2025-04-02", "Sell", 0.3, 33]]) });
    expect(o.text).toContain("Holdings at the end of the class period (March 30, 2025): 0.3 shares.");
    expect(o.tables![2].rows.some((r) => r[1] === "Still held")).toBe(false);
  });

  test("a sale and a purchase on the same day: the pasted order decides (sale first is a short sale)", () => {
    expect(refusal("dmg-sec-oop", { held: "0", blotter: blotterText([["2025-03-05", "Sell", 10, 40], ["2025-03-05", "Buy", 10, 40]]) })).toMatch(/row 1/);
    expect(okOut("dmg-sec-oop", { held: "0", blotter: blotterText([["2025-03-05", "Buy", 10, 40], ["2025-03-05", "Sell", 10, 40]]) }).text).toContain("Out-of-pocket loss $0.00");
  });

  test("a trade on a disclosure day falls in the window that disclosure opens", () => {
    const o = okOut("dmg-sec-oop", { held: "0", blotter: blotterText([["2025-03-17", "Buy", 100, 37.5]]) });
    expect(o.text).toContain("Out-of-pocket loss $344.19");
    const s = okOut("dmg-sec-oop", { held: "0", blotter: blotterText([["2025-03-14", "Buy", 100, 40], ["2025-03-17", "Sell", 100, 37.5]]) });
    expect(s.text).toContain("Out-of-pocket loss $248.93");
  });

  test("whitespace blotter, M/D/YYYY dates and a US-dollar column", () => {
    const o = okOut("dmg-sec-oop", { held: "0", blotter: "3/5/2025 buy 1,000 $41.20\n3/20/2025 SOLD 400 US$36.90" });
    // 400 × 2.4893 (window 1 → 2) + 600 × 5.9312 (held) = 995.72 + 3,558.72.
    expect(o.text).toContain("Out-of-pocket loss $4,554.44");
  });

  test("totals past ten trillion are refused, not printed with lost cents", () => {
    expect(refusal("dmg-sec-oop", { held: "0", disclosures: "2025-03-17\t999,999", blotter: blotterText([["2025-03-05", "Buy", "900,000,000,000", 40]]) })).toMatch(/ten trillion/);
    expect(refusal("dmg-antitrust", { basis: "units", purchases: "2020\t999,999,999,999\n2021\t999,999,999,999" })).toMatch(/ten trillion/);
  });

  test("a typed whitespace table with thousands commas is not split at its commas (the CSV-header trap)", () => {
    const o = okOut("dmg-sec-aggregate", { volume: "2025-03-03 2,401,000\n2025-03-04 2,833,000\n2025-03-05 1,130,000", model: "one" });
    expect(o.tables![0].rows[1][2]).toBe("6,364,000");
    // "March 3, 2025" in a whitespace row is left to the reader, which refuses it by name rather than misreading it.
    expect(refusal("dmg-sec-aggregate", { volume: "March 3, 2025 2,401,000\nMarch 4, 2025 2,833,000" })).toMatch(/volume table/i);
  });

  test("antitrust: a constant control column and a perfectly collinear control are refused by name", () => {
    const base = calc("dmg-antitrust").fields[0].default as string;
    const withConst = base
      .split("\n")
      .map((l, i) => l + (i === 0 ? "\tFlat" : "\t5"))
      .join("\n");
    expect(refusal("dmg-antitrust", { data: withConst, controls: "Cost, Flat" })).toMatch(/Flat|collinear|constant/i);
    const dup = base
      .split("\n")
      .map((l, i) => l + (i === 0 ? "\tCost2" : `\t${Number(l.split("\t")[3]) * 2}`))
      .join("\n");
    expect(refusal("dmg-antitrust", { data: dup, controls: "Cost, Cost2" })).toMatch(/Cost2|collinear/i);
  });

  test("antitrust: a column named During does not clash with the dummy", () => {
    const base = calc("dmg-antitrust").fields[0].default as string;
    const t = base.replace("Demand", "During");
    const o = okOut("dmg-antitrust", { data: t, controls: "Cost, During", method: "dummy" });
    expect(o.tables![0].rows.map((r) => r[0])).toEqual(["Term", "Cost", "During", "During (dummy)", "Constant"]);
  });

  test("PSLRA: 10,000 closes, a disclosure inside them; one close only", () => {
    const rows = ["Date\tClose"];
    for (let i = 0; i < MAX_SEC_DAYS; i++) rows.push(`${iso(day("1990-01-01") + i)}\t50`);
    const o = okOut("dmg-pslra", { prices: rows.join("\n"), disclosure: "2000-01-03", purchase: "60", loss: "" });
    expect(o.text).toContain("Mean trading price over the 90-day period: $50.00 (90 closes).");
    expect(o.text).toContain("= $10.00.");
    expect(o.text).toContain(`${(day("2000-01-03") - day("1990-01-01")).toLocaleString("en-US")} closes before the disclosure date were not used`);
    const one = okOut("dmg-pslra", { prices: "2025-03-31\t35\n2025-07-01\t30", purchase: "40", loss: "" });
    expect(one.text).toContain("Mean trading price over the 90-day period: $35.00 (1 close).");
    expect(one.svg).toBeUndefined();
  });

  test("every refusal is a refusal (ok false) with text, never an em dash", () => {
    const bad: [string, Record<string, string>][] = [
      ["dmg-sec-ribbon", { mode: "nope" }],
      ["dmg-sec-ribbon", { units: "nope" }],
      ["dmg-sec-aggregate", { model: "nope" }],
      ["dmg-antitrust", { form: "nope" }],
      ["dmg-antitrust", { method: "nope" }],
      ["dmg-antitrust", { se: "hc3" }],
      ["dmg-antitrust", { basis: "nope" }],
      ["dmg-antitrust", { pt: "nope" }],
      ["dmg-antitrust", { data: "" }],
      ["dmg-antitrust", { data: "1\t2\n3\t4" }],
      ["dmg-sec-aggregate", { volume: "" }],
      ["dmg-pslra", { prices: "" }],
    ];
    for (const [id, over] of bad) {
      const t = refusal(id, over);
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toContain("—");
    }
  });

  test("a price export with Open, High, Low, Close, Adj Close, Volume: the Close column is read, never Open", () => {
    const head = "Date,Open,High,Low,Close,Adj Close,Volume";
    const ribbonRows = (oracle.ribbons[0].days as string[]).map((d, i) => {
      const c = oracle.ribbons[0].close[i] as number;
      return [d, c + 5, c + 6, c - 1, c, c - 0.5, 1000000 + i].join(",");
    });
    const o = okOut("dmg-sec-ribbon", { prices: [head, ...ribbonRows].join("\n") });
    expect(o.text).toContain("Inflation per share on March 3, 2025 (the class-period start, the price table's first day): $5.9312");
    expect(o.text).toContain("“Close” was read as the close (not “Adj Close”)");
    const lbRows = (oracle.lookbacks[0].rows as (string | number)[][]).map(([d, c], i) => [d, (c as number) + 3, (c as number) + 4, (c as number) - 1, c, (c as number) - 0.25, 500000 + i].join(","));
    expect(okOut("dmg-pslra", { prices: [head, ...lbRows].join("\n") }).text).toContain("Mean trading price over the 90-day period: $34.5947 (62 closes).");
    const volRows = (oracle.trading[0].rows as (string | number)[][]).map(([d, v]) => [d, 40, 41, 39, 40, 39.5, v].join(","));
    expect(okOut("dmg-sec-aggregate", { volume: [head, ...volRows].join("\n") }).text).toContain("One-trader (proportional) model: $142,937,391.52");
    // Several unnamed value columns: refused, listing them.
    expect(refusal("dmg-sec-ribbon", { prices: "Date\tA\tB\n2025-03-03\t1\t2\n2025-03-17\t1\t2" })).toMatch(/none is named “Close”/);
    expect(refusal("dmg-sec-aggregate", { volume: "Date\tA\tB\n2025-03-03\t1\t2" })).toMatch(/none is named “Volume”/);
  });

  test("each compute at its caps within 300 ms (one run each)", () => {
    const timed = (f: () => Out): number => {
      const t0 = Date.now();
      const o = f();
      const ms = Date.now() - t0;
      expect(o.ok).not.toBe(false);
      return ms;
    };
    const prices = ["Date\tClose"];
    for (let i = 0; i < MAX_SEC_DAYS; i++) prices.push(`${iso(day("1990-01-01") + i)}\t${(100 + (i % 7)).toFixed(2)}`);
    const ar = ["Date\tAR"];
    const drops: string[] = [];
    for (let j = 1; j <= MAX_DISCLOSURES; j++) {
      ar.push(`${iso(day("1990-01-01") + 150 * j)}\t−1`);
      drops.push(iso(day("1990-01-01") + 150 * j));
    }
    // Warm the module once (first-call JIT), then time.
    okOut("dmg-sec-ribbon");
    const times: Record<string, number> = {};
    times.ribbonDollar = timed(() => out("dmg-sec-ribbon", { prices: prices.join("\n"), disclosures: ar.join("\n") }));
    times.ribbonPct = timed(() => out("dmg-sec-ribbon", { prices: prices.join("\n"), disclosures: ar.join("\n"), mode: "ar-pct" }));
    times.pslra = timed(() => out("dmg-pslra", { prices: prices.join("\n"), disclosure: "2000-01-03" }));
    const vol = ["Date\tVolume", ...prices.slice(1).map((l) => l.split("\t")[0] + "\t1000")];
    times.aggregate = timed(() => out("dmg-sec-aggregate", { start: "1990-01-01", disclosures: dropText(drops, drops.map(() => 0.5)), volume: vol.join("\n"), float: "1,000,000" }));
    const trades: (string | number)[][] = [];
    for (let i = 0; i < MAX_TRADES; i++) trades.push([iso(day("1990-01-01") + i), i % 3 === 2 ? "Sell" : "Buy", 100, 40]);
    times.oop = timed(() => out("dmg-sec-oop", { start: "1990-01-01", disclosures: dropText(drops, drops.map(() => 0.1)), blotter: blotterText(trades), held: "0" }));
    const at = ["Month\tPeriod\tPrice\tCost\tDemand"];
    for (let i = 0; i < 5000; i++) at.push(`R${i}\t${i < 2000 ? "before" : i < 4000 ? "during" : "after"}\t${(100 + (i % 13) + (i >= 2000 && i < 4000 ? 9 : 0)).toFixed(2)}\t${(50 + (i % 11)).toFixed(2)}\t${(200 + (i % 17)).toFixed(1)}`);
    times.antitrust = timed(() => out("dmg-antitrust", { data: at.join("\n"), se: "hac" }));
    // eslint-disable-next-line no-console
    console.log("litig compute times at the caps (ms):", JSON.stringify(times));
    for (const v of Object.values(times)) expect(v).toBeLessThan(300);
  });
});
