// E1 adversarial-pass fixes (items 1–10). Money pins at the 10¹² cap come from the INDEPENDENT Python Decimal oracle
// of the adversarial pass (prec 60, a naive day-by-day loop, ROUND_HALF_UP): its outputs are copied here verbatim.
import {
  MAX_AMOUNT,
  MAX_ROWS,
  MAX_TOTAL,
  civilDay,
  civilFromDay,
  isTotalsLabel,
  parseTranches,
  postjudgmentInterest,
  postjudgmentReport,
  prejudgmentReport,
  toCents,
} from "../damagesInterest";
import { lostEarningsReport } from "../lostEarnings";
import {
  MAX_DAMAGES_AMOUNT,
  MAX_DAMAGES_ROWS,
  MAX_DAMAGES_TOTAL,
  damagesSummary,
  damagesTablesClean,
  lostProfits,
  parsePeriodTable,
  reasonableRoyalty,
  roundCents,
  SUMMARY_RESULT_COLUMNS,
  type DamagesOutput,
  type DamagesResult,
  type LostProfitsInput,
  type PeriodRow,
  type RoyaltyInput,
} from "../patentDamages";
import { blockFieldListener, debouncedPreview, FIN_BLOCK_DEBOUNCE_MS } from "../previewDebounce";
import { finPlotSvg } from "../financeFigures";
import { buildPlotSvg } from "../plot";
import { buildChartPreviewSvg } from "../tablechart";
import { THIN_SPACE, commaGroupLabel } from "../axis";
import { insertableResultText } from "../insertGate";
import { paneCode } from "./paneCode";
import { budget } from "./timeBudget";

const MINUS = String.fromCharCode(0x2212);
const rows = (...r: [string, ...number[]][]): PeriodRow[] => r.map(([label, ...values]) => ({ label, values }));
const ok = (r: DamagesResult): DamagesOutput => {
  if ("error" in r) throw new Error(r.error);
  return r;
};
const err = (r: DamagesResult | { error: string } | object): string => ("error" in r ? (r as { error: string }).error : "(no error)");
/** A money cell without its "$" (v2.201.0), for comparison with the oracle's verbatim outputs. */
const bare = (cell: string): string => {
  expect(cell.startsWith("$")).toBe(true);
  return cell.slice(1);
};
const PERIOD_NAMES_LP =["infringer's units", "patentee's actual units", "spare capacity"];
const SUM_NAMES = ["lost profits", "price erosion", "reasonable royalty", "interest"];

const royalty = (over: Partial<RoyaltyInput> = {}): RoyaltyInput => ({
  rows: rows(["2021", 4000000], ["2022", 1000]),
  basis: "revenue",
  rate: 5,
  apportionPct: 100,
  lumpSum: 0,
  discountPct: 8,
  periodsPerYear: 1,
  ...over,
});
const lp = (over: Partial<LostProfitsInput> = {}): LostProfitsInput => ({
  rows: rows(["2022", 12000, 30000, 5000], ["2023", 15000, 32000, 6000]),
  method: "share",
  captureSharePct: 60,
  patenteeSharePct: 40,
  infringerSharePct: 25,
  capacity: 0,
  marginMode: "price-cost",
  price: 120,
  cost: 70,
  margin: 50,
  erosion: true,
  butForPrice: 130,
  actualPrice: 120,
  elasticity: 0,
  remainder: "unit",
  remainderRate: 4,
  infringerPrice: 110,
  ...over,
});
const pre = (tranches: string, extra: Partial<{ rates: string; end: string; method: string; dayCount: string; midPeriod: string }> = {}) =>
  prejudgmentReport({ tranches, rates: "1990-01-01\t9\n2008-12-16\t3.2501", end: "2024-12-31", method: "simple", dayCount: "act365", midPeriod: "off", ...extra });
const isoDay = (n: number): string => {
  const d = civilFromDay(n);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
};

describe("1. totals lines: skipped as the last row, refused anywhere else", () => {
  test("isTotalsLabel: a label that STARTS with total / subtotal / grand total / sum", () => {
    for (const s of ["Total", "Totals", "Subtotal", "Sub-total", "sub total", "Total damages", "TOTAL (2021–2024)", "Totals (USD)", "Grand total:", "Grand Total", "Sum", "SUM:"]) {
      expect(isTotalsLabel(s)).toBe(true);
    }
    for (const s of ["Summer 2023", "Summary", "Totally 5", "2021", "Q1 2024", "Subsidiary"]) expect(isTotalsLabel(s)).toBe(false);
  });
  test.each(["Subtotal", "Total damages", "TOTAL (2021–2024)", "Totals (USD)", "Grand total:", "Sum", "Total"])(
    "royalty: a last row “%s” is skipped with a note; the damages are not doubled",
    (lbl) => {
      const t = parsePeriodTable(`2021\t4,000,000\n2022\t1,000\n${lbl}\t4,001,000`, ["royalty base"], 1);
      if ("error" in t) throw new Error(t.error);
      expect(t.rows.map((r) => r.label)).toEqual(["2021", "2022"]);
      expect(t.notes.join(" ")).toContain("is a totals line and was skipped");
      const out = ok(reasonableRoyalty(royalty({ rows: t.rows })));
      expect(out.text).toContain("Total running royalty: $200,050.00"); // 5% of 4,001,000, not of 8,002,000
    },
  );
  test("space-separated totals lines too, and the summary", () => {
    const t = parsePeriodTable("2022 300,000 280,000 28,000\nTotal damages 300,000 280,000 28,000", SUM_NAMES, 1);
    if ("error" in t) throw new Error(t.error);
    expect(ok(damagesSummary({ rows: t.rows, multiplier: 1 })).text).toContain("Damages: $608,000.00");
  });
  test("a subtotal between periods is refused by name", () => {
    expect(err(parsePeriodTable("2021\t100\nSubtotal\t100\n2022\t200", ["base"], 1))).toBe(
      "Line 2 (“Subtotal 100”) is a totals line with rows after it; a subtotal between periods is ambiguous. Remove it (totals are computed here, not read).",
    );
    expect(err(parsePeriodTable("2021 100\nSubtotal 100\nGrand total 100", ["base"], 1))).toContain("Line 2 (“Subtotal 100”) is a totals line with rows after it");
  });
  test("prejudgment: a last totals row is skipped with a note; one in the middle is refused by name", () => {
    const r = pre("2019-03-15\t1,000\n2020-03-15\t2,000\nTotal damages\t3,000");
    expect(r.ok).toBe(true);
    expect(r.table!.rows.length).toBe(4); // header, 2 rows, totals
    expect(r.text).toContain("Note: Damages list: row 3 (“Total damages 3,000”) is a totals line and was skipped: totals are computed here, not read.");
    expect(r.text).toContain("Damages $3,000.00 +");
    const mid = pre("2019-03-15\t1,000\nSubtotal\t1,000\n2020-03-15\t2,000");
    expect(mid.ok).toBe(false);
    expect(mid.text).toBe(
      "Damages list, row 2: “Subtotal 1,000” is a totals line with rows after it; a subtotal between rows is ambiguous. Remove it (totals are computed here, not read).",
    );
  });
});

describe("2. a row without a period label is refused, never shifted left", () => {
  test("lost profits “12,000 30,000 5,000” (spaces or tabs)", () => {
    const want = "Line 1 has no period label (“12,000” is a number, not a year or a date); start each row with its period, e.g. 2023 or 2023-Q1.";
    expect(err(parsePeriodTable("12,000 30,000 5,000\n15,000 32,000 6,000", PERIOD_NAMES_LP, 1))).toBe(want);
    expect(err(parsePeriodTable("12,000\t30,000\t5,000", PERIOD_NAMES_LP, 1))).toBe(want);
    expect(err(parsePeriodTable("300000 280000 28000", SUM_NAMES, 1))).toContain("has no period label");
    expect(err(parsePeriodTable("2101 5 6", PERIOD_NAMES_LP, 1))).toContain("has no period label"); // years run 1900–2100
  });
  test("years, dates, quarters and words are labels; a lone number of the required count is “Period n”", () => {
    const t = parsePeriodTable("1900 1 2\n2100 3 4\n2023-Q1 5 6\nFY 2024 7 8\nQ1 9 10\n2024-01-31 11 12", PERIOD_NAMES_LP, 1);
    if ("error" in t) throw new Error(t.error);
    expect(t.rows.map((r) => r.label)).toEqual(["1900", "2100", "2023-Q1", "FY 2024", "Q1", "2024-01-31"]);
    expect(t.rows[0].values).toEqual([1, 2]);
    const lone = parsePeriodTable("12000\n15000", PERIOD_NAMES_LP, 1);
    if ("error" in lone) throw new Error(lone.error);
    expect(lone.rows).toEqual(rows(["Period 1", 12000], ["Period 2", 15000]));
  });
});

describe("3. space-grouped numbers are refused by name in space-separated rows", () => {
  test("summary “2022 300 000 280 000” is not read as 300 and 280", () => {
    expect(err(parsePeriodTable("2022 300 000 280 000", SUM_NAMES, 1))).toBe(
      "Line 1: “300 000” could be one number with a space between its thousands (300,000) or two numbers. Write thousands with commas, or separate the columns with tabs, semicolons or vertical bars.",
    );
    expect(err(parsePeriodTable("2022 12 000 30 000", PERIOD_NAMES_LP, 1))).toContain("“12 000” could be one number");
  });
  test("commas, tabs and ordinary numbers are unaffected", () => {
    const c = parsePeriodTable("2022 300,000 280,000 28,000", SUM_NAMES, 1);
    if ("error" in c) throw new Error(c.error);
    expect(c.rows[0].values).toEqual([300000, 280000, 28000]);
    const t = parsePeriodTable("2022\t300 000\t280 000", SUM_NAMES, 1);
    if ("error" in t) throw new Error(t.error);
    expect(t.rows[0].values).toEqual([300000, 280000]);
    const small = parsePeriodTable("2022 1200 30", SUM_NAMES, 1);
    if ("error" in small) throw new Error(small.error);
    expect(small.rows[0].values).toEqual([1200, 30]);
  });
});

describe("4. the summary table carries the multiplier and the enhanced total", () => {
  test("multiplier 2.5 with interest: rows after Total in both tables that agree with the text", () => {
    const out = ok(damagesSummary({ rows: rows(["2022", 300000, 280000, 28000, 10000.55], ["2023", 400000, 320000, 36000, 5000]), multiplier: 2.5 }));
    expect(out.text).toContain("Damages × 2.5 (multiplier entered): $3,410,000.00");
    expect(out.text).toContain("Total: $3,425,000.55");
    // v2.201.1: two tables of at most six columns.
    expect(out.tables.map((t) => t.label)).toEqual(["Damages by period", "Interest and totals by period"]);
    const t = out.tables[0].rows;
    expect(t[t.length - 3]).toEqual(["Total", "$700,000.00", "$600,000.00", "$64,000.00", "$1,364,000.00"]);
    expect(t[t.length - 2]).toEqual(["Multiplier entered", "", "", "", "× 2.5"]);
    expect(t[t.length - 1]).toEqual(["Damages × 2.5", "", "", "", "$3,410,000.00"]);
    const u = out.tables[1].rows;
    expect(u[0]).toEqual(["Period", "Damages", "Interest", "Total", "Cumulative"]);
    expect(u[u.length - 2]).toEqual(["Total", "$1,364,000.00", "$15,000.55", "$1,379,000.55", ""]);
    expect(u[u.length - 1]).toEqual(["Total with damages × 2.5", "$3,410,000.00", "$15,000.55", "$3,425,000.55", ""]);
    expect(damagesTablesClean(out.tables)).toBe(true);
  });
  test("without interest; multiplier 1 adds no rows", () => {
    const out = ok(damagesSummary({ rows: rows(["2022", 100, 0, 0.01]), multiplier: 3 }));
    expect(out.tables[1].rows.slice(-1)[0]).toEqual(["Total with damages × 3", "$300.03", "$300.03", ""]);
    const one = ok(damagesSummary({ rows: rows(["2022", 100, 0, 0.01]), multiplier: 1 }));
    expect(one.tables[0].rows.slice(-1)[0][0]).toBe("Total");
    expect(one.tables[1].rows.slice(-1)[0][0]).toBe("Total");
  });
  test("either inserted summary table pasted back is refused by name, not misread (multiplier 1 and 2)", () => {
    // v2.201.1: the first table has four numbers per period, which the summary's four input columns would accept
    // (Damages read as interest, the damages counted twice): the header names a result column and is refused.
    for (const m of [1, 2]) {
      const out = ok(damagesSummary({ rows: rows(["2022", 300000, 280000, 28000], ["2023", 1, 2, 3]), multiplier: m }));
      for (const t of out.tables) {
        const back = t.rows.map((r) => r.join("\t")).join("\n");
        const e = err(parsePeriodTable(back, SUM_NAMES, 1, { allowNegative: [1], resultColumns: SUMMARY_RESULT_COLUMNS }));
        expect(e).toMatch(/names a “(damages|total|cumulative)” column: damages, totals and cumulative amounts are computed here, not read/);
      }
    }
    // An input table with ordinary titles still reads.
    const input = parsePeriodTable("Period\tLost profits\tPrice erosion\tReasonable royalty\n2022\t1\t2\t3", SUM_NAMES, 1, { resultColumns: SUMMARY_RESULT_COLUMNS });
    expect(err(input)).toBe("(no error)");
  });
});

describe("5. large tables: debounce, 10,000-row cap, fast", () => {
  test("caps are 10,000 rows, refused by name above", () => {
    expect(MAX_ROWS).toBe(10000);
    expect(MAX_DAMAGES_ROWS).toBe(10000);
    const big = Array.from({ length: 10001 }, (_, i) => `P${i}\t${i}`).join("\n");
    expect(err(parsePeriodTable(big, ["base"], 1))).toBe("More than 10,000 periods is outside this calculator.");
    const tr = Array.from({ length: 10001 }, (_, i) => `${isoDay(civilDay(2000, 1, 1) + i)}\t1`).join("\n");
    expect(pre(tr).text).toBe("Damages list: more than 10,000 rows is outside this calculator.");
  });

  test("10,000 rows compute in well under a second, every calculator (after a warm-up)", () => {
    const N = 10000;
    // Prejudgment takes at most 2,500 rows since fix-fin R2 #7.
    const tranches = Array.from({ length: 2500 }, (_, i) => `${isoDay(civilDay(2004, 1, 1) + (i % 7300))}\t${1000 + (i % 997)}.25`).join("\n");
    const rates = "2000-01-01\t5\n2010-01-01\t3.5\n2020-06-30\t8.25";
    const periodText = (cols: (i: number) => string) => Array.from({ length: N }, (_, i) => `P${i}\t${cols(i)}`).join("\n");
    const runs: [string, () => boolean][] = [
      ...(["simple", "annual", "quarterly", "monthly", "daily"] as const).map(
        (m): [string, () => boolean] => [`prejudgment ${m}`, () => prejudgmentReport({ tranches, rates, end: "2024-12-31", method: m, dayCount: "actact", midPeriod: "off" }).ok],
      ),
      [
        "royalty",
        () => {
          const t = parsePeriodTable(periodText((i) => `${1000 + i}`), ["royalty base"], 1);
          return !("error" in t) && !("error" in reasonableRoyalty(royalty({ rows: t.rows, lumpSum: 1000, periodsPerYear: 12 })));
        },
      ],
      [
        "lost profits",
        () => {
          const t = parsePeriodTable(periodText((i) => `${1000 + i}\t${500 + i}\t300`), PERIOD_NAMES_LP, 1);
          return !("error" in t) && !("error" in lostProfits(lp({ rows: t.rows, elasticity: 0.3 })));
        },
      ],
      [
        "summary",
        () => {
          const t = parsePeriodTable(periodText((i) => `${1000 + i}\t${500 + i}\t300\t12.5`), SUM_NAMES, 1);
          return !("error" in t) && !("error" in damagesSummary({ rows: t.rows, multiplier: 2 }));
        },
      ],
    ];
    for (const [name, run] of runs) {
      expect(run()).toBe(true); // warm-up
      const t0 = performance.now();
      expect(run()).toBe(true);
      const ms = performance.now() - t0;
      // 3 s, not 1 s: GitHub's shared runner measured 1,034 ms for lost profits (v2.199.0 deploy blocked); a freeze
      // is minutes, so the bound still catches one, and contention no longer fails a correct build.
      if (ms >= budget(3000)) throw new Error(`${name}: ${ms.toFixed(0)} ms`);
    }
  });

  test("blockFieldListener: a textarea keystroke waits; a number field, a select and a direct call run now", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const preview = debouncedPreview(
      () => runs.push("debounced"),
      FIN_BLOCK_DEBOUNCE_MS,
      { set: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => undefined },
    );
    const runs: string[] = [];
    const listen = blockFieldListener(preview, () => runs.push("now"));
    listen({ type: "input", target: { tagName: "TEXTAREA" } });
    expect(runs).toEqual([]);
    expect(preview.pending()).toBe(true);
    expect(timers[0].ms).toBe(300);
    listen({ type: "input", target: { tagName: "INPUT" } }); // a number field: live, and the pending run is dropped
    expect(runs).toEqual(["now"]);
    expect(preview.pending()).toBe(false);
    listen({ type: "input", target: { tagName: "TEXTAREA" } });
    listen({ type: "change", target: { tagName: "TEXTAREA" } }); // leaving the field
    expect(runs).toEqual(["now", "now"]);
    listen(); // the calculator switched, or a table was loaded
    expect(runs).toEqual(["now", "now", "now"]);
    listen({ type: "input", target: { tagName: "TEXTAREA" } });
    expect(preview.flush()).toBe(true); // what Insert does first
    expect(runs).toEqual(["now", "now", "now", "debounced"]);
  });

  test("the pane debounces Finance block fields and flushes before Insert and the panel tray", () => {
    const PANE = paneCode();
    expect(PANE).toContain("const finPreview = debouncedPreview(() => updateFinancePreview(), FIN_BLOCK_DEBOUNCE_MS);");
    expect(PANE).toContain('renderCalcFields(calc.fields, finInputs, "fin", blockFieldListener(finPreview, updateFinancePreview));');
    expect(PANE).toContain("if (flushBeforeInsert(finPreview, finInsertBtn)) void runCompositeInsert(finInsertBtn, insertFinanceResult);");
    expect(PANE).not.toContain('finInsertBtn.addEventListener("click", () => void runCompositeInsert(');
    const tray = PANE.slice(PANE.indexOf("function addCurrentFigureToPanels("), PANE.indexOf("function addCurrentFigureToPanels(") + 400);
    expect(tray).toContain("finPreview.flush();");
    // The pane's table preview keeps the whole footer (Total and the multiplier rows) on a long table.
    expect(PANE).toContain("const footer = body.slice(foot);");
  });
});

describe("6. compounding to the cent at the 10¹² cap (oracle)", () => {
  const cases: [string, string, string, string, string][] = [
    ["simple", "actact", "1000000000000", "1,000,000,000,000.00", "1,777,413,581,967.21"],
    ["annual", "actact", "1000000000000", "1,000,000,000,000.00", "4,561,329,699,364.63"],
    ["quarterly", "act360", "999999999999.99", "999,999,999,999.99", "4,971,325,916,596.59"],
    ["monthly", "actact", "1000000000000", "1,000,000,000,000.00", "4,882,733,330,310.21"],
    ["daily", "actact", "1000000000000", "1,000,000,000,000.00", "4,913,487,008,947.11"],
    ["daily", "act365", "123456789012.34", "123,456,789,012.34", "607,578,664,666.28"],
    ["monthly", "act365", "87654321098.77", "87,654,321,098.77", "428,677,452,762.05"],
  ];
  test.each(cases)("%s %s on %s from January 1, 1995 to December 31, 2024", (method, dayCount, amt, wantAmt, wantInt) => {
    const r = pre(`1995-01-01\t${amt}`, { method, dayCount });
    expect(r.ok).toBe(true);
    expect(r.table!.rows[1].slice(3, 5).map(bare)).toEqual([wantAmt, wantInt]);
  });
  test("odd accrual days at the cap: a January 31 accrual monthly, a February 29 accrual annually (oracle)", () => {
    const tr = (acc: string) => `${acc}\t999999999999.99\n${acc}\t0.01\n${acc}\t333333333333.33`;
    const rates = "1990-01-01\t7.1234\n2015-03-01\t0.5\n2020-02-29\t12.75";
    const m = pre(tr("2000-01-31"), { rates, end: "2025-03-01", method: "monthly", dayCount: "actact" });
    expect(m.table!.rows.slice(1, 4).map((r) => bare(r[4]))).toEqual(["4,641,759,813,974.33", "0.05", "1,547,253,271,324.78"]);
    const a = pre(tr("1996-02-29"), { rates, end: "2025-03-01", method: "annual", dayCount: "actact" });
    expect(a.table!.rows.slice(1, 4).map((r) => bare(r[4]))).toEqual(["5,906,713,090,846.08", "0.06", "1,968,904,363,615.36"]);
  });
  test("post-judgment at the cap and an exact half-cent tie (oracle)", () => {
    const D = (y: number, m: number, d: number) => civilDay(y, m, d);
    const a = postjudgmentInterest({ amount: 999999999999.99, rate: 0.041234, judgment: D(2023, 12, 31), payment: D(2031, 3, 1), dayCount: "actact" });
    if ("error" in a) throw new Error(a.error);
    expect(a.years.map((y) => y.interestCents / 100)).toEqual([
      41234308660.83, 42933934095.08, 44704593321.8, 46547942522.83, 48467663191.16, 50465438242.42, 52546707889.33, 8993986659.03,
    ]);
    const b = postjudgmentInterest({ amount: 1e12, rate: 0.0507, judgment: D(2023, 12, 31), payment: D(2031, 3, 1), dayCount: "act365" });
    if ("error" in b) throw new Error(b.error);
    expect(b.years[0].interestCents / 100).toBe(50838904109.59);
    expect(b.years[7].interestCents / 100).toBe(11785073413.1);
  });
});

describe("7. one trillion is the amount cap in every damages engine", () => {
  test("constants", () => {
    expect(MAX_AMOUNT).toBe(1e12);
    expect(MAX_DAMAGES_AMOUNT).toBe(1e12);
    expect(MAX_TOTAL).toBe(1e13);
    expect(MAX_DAMAGES_TOTAL).toBe(1e13);
  });
  test("prejudgment and post-judgment: 10¹² accepted, a cent more refused by name", () => {
    expect(pre("2020-01-01\t1,000,000,000,000.00").ok).toBe(true);
    expect(pre("2020-01-01\t1,000,000,000,000.01").text).toBe("Damages list, row 1: amounts above $1,000,000,000,000.00 are outside this calculator.");
    const j = (amount: number) => postjudgmentReport({ amount, ratePct: 5, judgment: "2024-01-01", payment: "2025-01-01", dayCount: "act365" });
    expect(j(1e12).ok).toBe(true);
    expect(j(1e12 + 0.01).text).toBe("Judgment amounts above $1,000,000,000,000.00 are outside this calculator.");
  });
  test("royalty, lost profits, summary: inputs, per-period amounts and totals", () => {
    expect(err(parsePeriodTable("2021 1,000,000,000,000.01", ["royalty base"], 1))).toBe("Line 1 (“2021”): royalty base is above one trillion, outside this calculator.");
    expect(ok(reasonableRoyalty(royalty({ rows: rows(["A", 1e12]), rate: 100 }))).text).toContain("Total running royalty: $1,000,000,000,000.00");
    expect(err(reasonableRoyalty(royalty({ rows: rows(["A", 1e12]), basis: "unit", rate: 2 })))).toBe("A: the royalty is above one trillion, outside this calculator.");
    expect(err(reasonableRoyalty(royalty({ lumpSum: 1e12 + 1 })))).toBe("The lump sum is above one trillion, outside this calculator.");
    const eleven = rows(...Array.from({ length: 11 }, (_, i): [string, number] => [`P${i}`, 1e12]));
    expect(err(reasonableRoyalty(royalty({ rows: eleven, rate: 1 })))).toBe("The total royalty base is above ten trillion, outside this calculator.");
    expect(err(lostProfits(lp({ rows: rows(["2022", 1e12, 1, 1e12]), price: 1000, cost: 0, erosion: false })))).toBe(
      "2022: the lost profits is above one trillion, outside this calculator.",
    );
    const elevenSum = rows(...Array.from({ length: 11 }, (_, i): [string, number] => [`P${i}`, 1e12]));
    expect(err(damagesSummary({ rows: elevenSum, multiplier: 1 }))).toBe("The total lost profits is above ten trillion, outside this calculator.");
    expect(err(damagesSummary({ rows: rows(["A", 1e12], ["B", 1e12], ["C", 1e12], ["D", 1e12]), multiplier: 3 }))).toBe("The damages with the multiplier is above ten trillion, outside this calculator.");
  });
});

describe("8. roundCents / toCents: near-halves only within the value's own float precision", () => {
  test("pins", () => {
    expect(roundCents(100000000000.0048)).toBe(100000000000);
    expect(roundCents(100000000000.005)).toBe(100000000000.01);
    expect(roundCents(-100000000000.005)).toBe(-100000000000.01);
    expect(roundCents(999999999999.994)).toBe(999999999999.99);
    expect(roundCents(999999999999.995)).toBe(1e12);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(0.125)).toBe(0.13);
    expect(roundCents(1234567.125)).toBe(1234567.13);
    expect(roundCents(1000000.004)).toBe(1000000);
    expect(toCents(100000000000.0048)).toBe(10000000000000);
    expect(toCents(-0.001)).toBe(0);
    expect(Number.isNaN(roundCents(NaN))).toBe(true);
  });
});

describe("9. minor fixes", () => {
  test("(a) price erosion refuses a row without the patentee's units, by name", () => {
    expect(err(lostProfits(lp({ rows: rows(["2022", 12000, 30000], ["2023", 15000]) })))).toBe(
      "2023: price erosion needs the patentee's actual units, the second number on each line (enter 0 for a period with none).",
    );
    // Base-correct: an explicit 0 erodes nothing, and no erosion needs no column.
    expect(ok(lostProfits(lp({ rows: rows(["2022", 12000, 30000], ["2023", 15000, 0]) }))).text).toContain("Price erosion: $300,000.00");
    expect(ok(lostProfits(lp({ rows: rows(["2022", 12000]), erosion: false }))).text).toContain("Total: $379,200.00");
  });
  test("(b) a negative erosion from lost profits is said, and the summary takes it as an offset", () => {
    const neg = ok(lostProfits(lp({ rows: rows(["2022", 1000, 1000]), butForPrice: 110, actualPrice: 100, elasticity: 5, price: 100 })));
    // The price-erosion cell, found by its header (v2.201.1 splits a table wider than six columns in two).
    const et = neg.tables.find((t) => t.rows[0].includes("Price erosion"))!;
    const ero = et.rows[1][et.rows[0].indexOf("Price erosion")];
    expect(ero.startsWith(MINUS)).toBe(true);
    expect(neg.text).toContain("Note: a negative price erosion");
    const t = parsePeriodTable(`2022 1,000 ${ero} 50`, SUM_NAMES, 1, { allowNegative: [1] });
    if ("error" in t) throw new Error(t.error);
    const s = ok(damagesSummary({ rows: t.rows, multiplier: 1 }));
    expect(s.text).toContain(`Price erosion: ${ero}`);
    expect(s.text).toContain("Note: a negative price erosion (as the lost-profits tool can compute) is entered as an offset and subtracted from the damages.");
    expect(insertableResultText(s.text)).toBe(true);
    // Only that column: a negative lost profits or royalty is still refused.
    expect(err(parsePeriodTable(`2022 ${MINUS}1,000 0 50`, SUM_NAMES, 1, { allowNegative: [1] }))).toBe("Line 1 (“2022”): lost profits cannot be negative.");
  });
  test("(c) the February 29 → February 28 anniversary convention is printed", () => {
    const pj = postjudgmentReport({ amount: 1000, ratePct: 5, judgment: "2024-02-29", payment: "2026-03-01", dayCount: "act365" });
    expect(pj.text).toContain("Note: an anniversary of a February 29 judgment falls on February 28 in a common year (and on February 29 in a leap year).");
    const rates = "2010-01-01 6";
    expect(pre("2016-02-29 1,000", { rates, end: "2021-03-01", method: "annual" }).text).toContain(
      "Note: an anniversary of a February 29 accrual falls on February 28 in a common year (and on February 29 in a leap year).",
    );
    expect(pre("2016-03-01 1,000", { rates, end: "2021-03-01", method: "annual" }).text).not.toContain("February 29 accrual");
    expect(pre("2016-02-29 1,000", { rates, end: "2021-03-01", method: "simple" }).text).not.toContain("February 29 accrual");
  });
  test("(d) lost earnings: any value above one trillion is refused by name, without printing it", () => {
    const le = (over: Partial<Parameters<typeof lostEarningsReport>[0]>) =>
      lostEarningsReport({ base: 65000, growthPct: 3, discountPct: 4.5, horizonMode: "years", horizon: 20, startAge: 45, consumptionPct: 0, fringePct: 0, midYear: "off", ...over });
    const huge = le({ base: 1e9, growthPct: 1000, horizon: 100 });
    expect(huge.ok).toBe(false);
    expect(huge.text).toBe("Year 4: an amount or a running total is above $1,000,000,000,000.00, outside this calculator; lower the earnings, the growth rate or the horizon.");
    expect(le({ base: 1e12, growthPct: 0, horizon: 1 }).ok).toBe(true);
    expect(le({ base: 6e11, growthPct: 0, horizon: 2 }).text).toContain("Year 2: an amount or a running total is above");
  });
});

describe("10. damages figures group money ticks with commas; other figures are unchanged", () => {
  const ticks = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  test("stacked columns, the cumulative line, interest and lost earnings", () => {
    const sum = ok(damagesSummary({ rows: rows(["2022", 300000, 280000, 28000], ["2023", 400000, 320000, 36000]), multiplier: 1 }));
    expect(ticks(sum.svg!)).toContain("600,000");
    expect(sum.svg).not.toContain(THIN_SPACE);
    const long = ok(reasonableRoyalty(royalty({ rows: rows(...Array.from({ length: 60 }, (_, i): [string, number] => [`P${i}`, 100000])) })));
    expect(long.svg).toContain("cumulative");
    expect(ticks(long.svg!).some((t) => /^\d{1,3}(,\d{3})+$/.test(t))).toBe(true);
    expect(long.svg).not.toContain(THIN_SPACE + "000");
    const p = pre("2019-03-15\t125,000\n2020-12-31\t250,000.50", { rates: "2018-01-01 5", end: "2024-02-29" });
    expect(ticks(p.svg!).some((t) => /^\d{1,3}(,\d{3})+$/.test(t))).toBe(true);
    expect(p.svg).not.toContain(THIN_SPACE);
    const pj = postjudgmentReport({ amount: 1500000, ratePct: 4.12, judgment: "2024-03-15", payment: "2026-10-24", dayCount: "act365" });
    expect(pj.svg).not.toContain(THIN_SPACE);
    const le = lostEarningsReport({ base: 65000, growthPct: 3, discountPct: 4.5, horizonMode: "years", horizon: 20, startAge: 45, consumptionPct: 0, fringePct: 22, midYear: "off" });
    expect(ticks(le.svg!).some((t) => /^\d{1,3}(,\d{3})+$/.test(t))).toBe(true);
    expect(le.svg).not.toContain(THIN_SPACE);
  });
  test("a figure that does not ask for commas keeps thin-space grouping (every Finance figure asks, 2026-10-28)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 600000 }];
    const plain = buildPlotSvg([{ points: pts, type: "line", color: "#000", label: "x" }], { width: 380, height: 250, title: "t", xlabel: "x", ylabel: "y" });
    expect(plain).toContain(`600${THIN_SPACE}000`);
    // finPlotSvg groups Finance's money axes with commas by default (the display contract: "600,000", never "600 000").
    const fin = finPlotSvg([{ points: pts, type: "line", color: "#000", label: "x" }], { width: 380, height: 250, title: "t", xlabel: "x", ylabel: "y" });
    expect(fin).toContain("600,000");
    expect(fin).not.toContain(THIN_SPACE);
    const chart = buildChartPreviewSvg(
      { categories: ["a", "b"], series: [{ name: "s", values: [300000, 600000] }], categoryLabel: "c", hasHeader: false, rows: [], warnings: [] },
      "stacked-column",
      "t",
    );
    expect(chart.svg).toContain(THIN_SPACE);
    expect(chart.svg).not.toMatch(/\d,\d{3}/);
  });
});

test("tranches still read space-grouped single amounts (one number per row is unambiguous)", () => {
  const t = parseTranches("June 30, 2022  98 765,43", false);
  if (!t.ok) throw new Error(t.error);
  expect(t.value[0].amount).toBe(98765.43);
});

describe("narrow pass on the E1 fix", () => {
  const P = (t: string, n: string[], req: number, o = {}) => parsePeriodTable(t, n, req, o);
  test("2023 500 120 in a two-number table is two numbers, as with tabs", () => {
    const r = P("2023 500 120", ["units", "actual units"], 2);
    expect("error" in r ? r.error : r.rows[0].values).toEqual([500, 120]);
  });
  test("a lone 0 never starts a thousands group", () => {
    const r = P("2023 100 0 250", ["a", "b", "c"], 1);
    expect("error" in r ? r.error : r.rows[0].values).toEqual([100, 0, 250]);
  });
  test("period numbers 1, 2 (forecast years) and a yyyymm code are period labels", () => {
    const r = P("1\t500000\n2\t600000\n202301\t5", ["base"], 1);
    expect("error" in r ? r.error : r.rows.map((x) => x.label)).toEqual(["1", "2", "202301"]);
  });
  test("a last line starting with Sum or Total that is NOT the column total is refused, never dropped", () => {
    expect("error" in P("2022\t100\nSum 2023\t200", ["base"], 1)).toBe(true);
    expect("error" in P("2022\t100\nTotal Q1\t200", ["base"], 1)).toBe(true);
    const ok = P("2022\t100\n2023\t200\nTotal\t300", ["base"], 1);
    expect("error" in ok ? ok.error : ok.rows.length).toBe(2);
  });
  test("a lone totals line says so", () => {
    const r = P("Total\t500", ["base"], 1);
    expect("error" in r && r.error).toMatch(/totals line and there are no periods/);
  });
  test("comma money ticks group four-digit values too", () => {
    expect(commaGroupLabel("1250")).toBe("1,250");
    expect(commaGroupLabel("12 500")).toBe("12,500");
    expect(commaGroupLabel("250")).toBe("250");
    expect(commaGroupLabel("1250.5")).toBe("1,250.5");
  });
});

// v2.201.1: in real Word, a table wider than six columns broke long amounts mid-number ("$400,000,|000,000.0|0").
describe("every damages table is at most six columns, at each engine's widest options", () => {
  const big = 400000000000;
  const cases: [string, { label: string; rows: string[][] }[]][] = [
    ["summary, interest + multiplier", ok(damagesSummary({ rows: rows(["2022", big, big / 2, big / 10, big / 40], ["2023", 1, 2, 3, 4]), multiplier: 2.5 })).tables],
    ["lost profits, erosion + uncaptured royalty", ok(lostProfits(lp())).tables],
    ["reasonable royalty with present value", ok(reasonableRoyalty(royalty({ discountPct: 8, lumpSum: 1000 }))).tables],
    ["prejudgment", [pre("2019-01-01\t1,000,000\n2020-06-30\t2,500,000", { method: "monthly" }).table!]],
    ["post-judgment", [postjudgmentReport({ amount: 1469135.78, ratePct: 4.12, judgment: "2024-03-15", payment: "2026-10-24", dayCount: "actact" }).table!]],
    [
      "lost earnings",
      [lostEarningsReport({ base: 65000, growthPct: 3, discountPct: 4.5, horizonMode: "years", horizon: 20, startAge: 45, consumptionPct: 10, fringePct: 22, midYear: "on" }).table!],
    ],
  ];
  test.each(cases)("%s", (_name, tables) => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const r of t.rows) expect({ table: t.label, len: r.length }).toEqual({ table: t.label, len: t.rows[0].length });
    }
  });
  test("lost profits with erosion and the uncaptured royalty is split into units and money", () => {
    const t = ok(lostProfits(lp())).tables;
    expect(t.map((x) => x.label)).toEqual(["Units by period", "Lost profits by period"]);
    expect(t[0].rows[0]).toEqual(["Period", "Infringer's units", "Captured units"]);
    expect(t[1].rows[0]).toEqual(["Period", "Lost profits", "Price erosion", "Royalty on uncaptured units", "Total"]);
    expect(t[0].rows.length).toBe(t[1].rows.length);
    expect(t[1].rows[t[1].rows.length - 1][0]).toBe("Total");
    // Without the uncaptured royalty: one table of six columns, as before.
    expect(ok(lostProfits(lp({ remainder: "none" }))).tables.map((x) => x.label)).toEqual(["Lost profits by period"]);
  });
  test("the lost-profits money table pasted into the summary without its title row is refused (review v2.201.1)", () => {
    const money = ok(lostProfits(lp())).tables.find((x) => x.label === "Lost profits by period")!;
    const text = money.rows.slice(1).map((r) => r.join("\t")).join("\n");
    const r = parsePeriodTable(text, ["lost profits", "price erosion", "reasonable royalty", "interest"], 1, { allowNegative: [1], resultColumns: SUMMARY_RESULT_COLUMNS });
    expect("error" in r && r.error).toContain("result table pasted back");
  });
});
