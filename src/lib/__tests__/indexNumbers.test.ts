/**
 * idx-price and idx-deflate (Release E3c), pinned against the exact oracle scripts/econ-index-oracle.py (Laspeyres,
 * Paasche, chain products, rebasing and deflation in Python fractions; Fisher and Törnqvist in mpmath at 60 digits),
 * plus the hostile inputs of the E3 brief.
 */
import fixture from "./fixtures/econ-index-oracle.json";
import { parsePriceTable, indexSeries, rebase, type IndexFormula } from "../indexNumbers";
import { idxPriceCalc, idxDeflateCalc, constantDollars, fmtMoney, IDX_PRICE_DEFAULTS, IDX_DEFLATE_DEFAULTS } from "../econE3Calcs";
import { parseSeriesTable } from "../tsData";
import { insertableResultText } from "../insertGate";
import { tableCellsInsertable, civilFromDay } from "../damagesInterest";
import type { StatOutput } from "../analyzeBlocks";

function close(actual: number, expected: number, rel: number): void {
  const tol = rel * Math.abs(expected);
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`expected ${expected}, got ${actual} (rel ${Math.abs(actual - expected) / Math.abs(expected)})`);
}

function clean(out: StatOutput): string[] {
  const bad: string[] = [];
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])];
  for (const s of all) {
    if (/NaN|Infinity|undefined/.test(s)) bad.push(`broken: ${s}`);
    if (/\d[eE][-+]?\d/.test(s)) bad.push(`e-notation: ${s}`);
    if (s.includes("—")) bad.push(`em dash: ${s}`);
    if (/[_^{}]/.test(s)) bad.push(`ASCII sub/superscript notation: ${s}`);
    if (/(^|[\s(])-\d/.test(s)) bad.push(`hyphen minus: ${s}`);
  }
  if (!insertableResultText(out.text)) bad.push("gate: text");
  for (const t of out.tables ?? []) if (!tableCellsInsertable(t.rows)) bad.push(`gate: ${t.label}`);
  return bad;
}

const price = (over: Record<string, string>): StatOutput => idxPriceCalc((k) => over[k] ?? IDX_PRICE_DEFAULTS[k] ?? "");
const deflate = (over: Record<string, string>): StatOutput => idxDeflateCalc((k) => over[k] ?? IDX_DEFLATE_DEFAULTS[k] ?? "");

describe("idx-price against exact rational arithmetic", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      const p = parsePriceTable(c.data);
      if (!p.ok) throw new Error(p.reason);
      expect(p.table.periods).toEqual(c.periods);
      for (const e of c.expect) {
        const r = c.periods.indexOf(e.base);
        for (const [f, want] of Object.entries(e.series)) {
          const got = rebase(indexSeries(p.table, f as IndexFormula, e.method === "chained"), r);
          // Laspeyres, Paasche and their chain products are exact rationals in the oracle: 1e−13; Fisher and Törnqvist 1e−12.
          const rel = f === "laspeyres" || f === "paasche" ? 1e-13 : 1e-12;
          got.forEach((v, t) => close(v, want[t], rel));
        }
      }
      // The calculator prints the same numbers.
      const last = c.expect[c.expect.length - 1];
      const out = price({ data: c.data, method: last.method, base: last.base, formula: "all" });
      expect(clean(out)).toEqual([]);
      const rows = out.tables![0].rows;
      expect(rows[0]).toEqual(["Period", "Laspeyres", "Paasche", "Fisher", "Törnqvist"]);
      rows.slice(1).forEach((row, t) => expect(row[1]).toBe(last.series.laspeyres[t].toFixed(3)));
    });
  }

  test("the euro table's decimal commas are read and said", () => {
    const out = price({ data: fixture.cases[2].data });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/comma/i);
  });

  test("defaults, conventions, one formula, base by name", () => {
    const out = price({});
    expect(clean(out)).toEqual([]);
    expect(out.text).toContain("ILO/IMF CPI Manual");
    expect(out.text).toContain("Fixed base: every period is compared directly with 2021");
    const one = price({ formula: "tornqvist", method: "chained", base: "2023" });
    expect(clean(one)).toEqual([]);
    expect(one.tables![0].rows[0]).toEqual(["Period", "Törnqvist"]);
    expect(one.tables![0].rows[3][1]).toBe("100.000");
    expect(one.text).toContain("Chained");
  });

  test("scale: prices ×10¹² or ×10⁻¹² leave every index unchanged", () => {
    const base = parsePriceTable(fixture.cases[1].data);
    if (!base.ok) throw new Error(base.reason);
    for (const s of [1e12, 1e-12]) {
      const lines = fixture.cases[1].data.split("\n");
      const scaled = [lines[0], ...lines.slice(1).map((l) => l.split("\t").map((v, j) => (j > 0 && j % 2 === 1 ? String(Number(v) * s) : v)).join("\t"))].join("\n");
      const p = parsePriceTable(scaled);
      if (!p.ok) throw new Error(p.reason);
      for (const f of ["laspeyres", "paasche", "fisher", "tornqvist"] as IndexFormula[]) {
        const a = indexSeries(base.table, f, true);
        indexSeries(p.table, f, true).forEach((v, t) => close(v, a[t], 1e-12));
      }
      expect(clean(price({ data: scaled }))).toEqual([]);
    }
  });
});

describe("idx-price refusals", () => {
  const head = "Item\tP1\tQ1\tP2\tQ2";
  const refused = (data: string, re: RegExp, over: Record<string, string> = {}): void => {
    const out = price({ data, ...over });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(re);
  };
  test("prices and quantities", () => {
    refused(`${head}\nA\t1\t5\t0\t5\nB\t2\t3\t2\t3`, /Item “A” in “2”: a price must be greater than zero/);
    refused(`${head}\nA\t1\t5\t−2\t5\nB\t2\t3\t2\t3`, /Item “A” in “2”: a price must be greater than zero/);
    refused(`${head}\nA\t1\t5\t1\t−5\nB\t2\t3\t2\t3`, /a quantity cannot be negative/);
    refused(`${head}\nA\t1\t5\t1.2\tNA\nB\t2\t3\t2\t3`, /Item “A” has a quantity in “1” but not in “2”: a new or vanished item/);
    refused(`${head}\nA\t1\t5\t1.2\t6\nNew\t\t\t2\t3`, /Item “New” has a quantity in “2” but not in “1”: a new or vanished item/);
    refused(`${head}\nA\t1\t5\t\t6\nB\t2\t3\t2\t3`, /Item “A” has no price in “2”/);
    refused(`${head}\nA\t1\t0\t1.2\t0\nB\t2\t0\t2\t0`, /Every quantity in “1” is zero/);
    refused(`${head}\nA\tabc\t5\t1\t5`, /not a number/);
  });
  test("layout", () => {
    refused("Item\tP1\tQ1\nA\t1\t2", /at least two periods/);
    refused("Item\tCost1\tQ1\tP2\tQ2\nA\t1\t2\t3\t4", /“Cost1” should be a price column/);
    refused("Item\tP1\tQ1\tP2\tQ3\nA\t1\t2\t3\t4", /does not match its price column/);
    refused("Item\tP1\tQ1\tP1\tQ1\nA\t1\t2\t3\t4", /appears twice/);
    refused(`${head}\nA\t1\t2\t3\t4\na\t1\t2\t3\t4`, /appears in rows 1 and 2/);
    refused("1\t2\t3\t4\t5", /needs a header row/);
    refused("", /Paste a table/);
  });
  test("rubbish options", () => {
    refused(IDX_PRICE_DEFAULTS.data, /Unknown index “abc”/, { formula: "abc" });
    refused(IDX_PRICE_DEFAULTS.data, /Unknown comparison/, { method: "−1" });
    refused(IDX_PRICE_DEFAULTS.data, /No period is named “1e400”/, { base: "1e400" });
    expect(price({ base: "" }).ok).not.toBe(false);
  });
  test("10,000 items × 6 periods is bounded; more items are refused by count", () => {
    const lines = ["Item\tP1\tQ1\tP2\tQ2\tP3\tQ3\tP4\tQ4\tP5\tQ5\tP6\tQ6"];
    for (let i = 0; i < 10000; i++) {
      const cells = [`I${i}`];
      for (let t = 0; t < 6; t++) cells.push((1 + ((i * 7 + t * 13) % 97) / 10).toFixed(2), String(1 + ((i * 3 + t) % 50)));
      lines.push(cells.join("\t"));
    }
    const t0 = Date.now();
    const out = price({ data: lines.join("\n"), method: "chained" });
    const ms = Date.now() - t0;
    expect(clean(out)).toEqual([]);
    // Measured 0.14 s alone; bounded at over 10×.
    expect(ms).toBeLessThan(1500);
    const more = [...lines, ...Array.from({ length: 90000 }, (_, i) => `X${i}\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1`)].join("\n");
    const t1 = Date.now();
    const big = price({ data: more });
    expect(big.ok).toBe(false);
    expect(big.text).toMatch(/100,000 items; the most is 10,000/);
    expect(Date.now() - t1).toBeLessThan(3000);
  });
});

describe("idx-deflate against exact rational arithmetic", () => {
  for (const c of fixture.deflate) {
    test(c.name, () => {
      const parsed = parseSeriesTable(c.data, { requireDates: true });
      if (!parsed.ok) throw new Error(parsed.reason);
      const tokens = parsed.data.dates!.tokens;
      const out = deflate({ data: c.data, ...c.fields });
      expect(out.ok).not.toBe(false);
      expect(clean(out)).toEqual([]);
      const b = out.tables![0].rows.length - 1 === tokens.length ? tokens.findIndex((t) => t.label === out.tables![0].rows.slice(1).find((r) => r[3] === "100.000")![0]) : -1;
      expect(b).toBeGreaterThanOrEqual(0);
      const { real, idx } = constantDollars(parsed.data.cols[0], parsed.data.cols[1], b);
      real.forEach((v, i) => close(v, c.real[i], 1e-14));
      idx.forEach((v, i) => close(v, c.index[i], 1e-14));
      // Printed to the cent, grouped, and the cumulative inflation to two decimals.
      out.tables![0].rows.slice(1).forEach((r, i) => expect(r[4]).toBe(fmtMoney(c.real[i])));
      expect(out.text).toContain(`${c.inflation_pct.toFixed(2).replace("-", "−")}%`);
    });
  }

  test("the quarterly table with a gap says so and still deflates", () => {
    const out = deflate({ data: fixture.deflate[2].data, ...fixture.deflate[2].fields });
    expect(out.text).toContain("not evenly spaced (2019 Q2 is followed by 2019 Q4)");
  });

  test("defaults and money formatting", () => {
    const out = deflate({});
    expect(clean(out)).toEqual([]);
    expect(out.text).toContain("in 2024 dollars");
    expect(fmtMoney(-1234567.891)).toBe("−1,234,567.89");
    expect(fmtMoney(-0.001)).toBe("0.00");
    expect(fmtMoney(999999999999.99)).toBe("999,999,999,999.99");
  });
});

describe("idx-deflate refusals and scale", () => {
  const d = "Year\tNominal\tCPI\n2020\t100\t100\n2021\t110\t105\n2022\t120\t0";
  const refused = (over: Record<string, string>, re: RegExp): void => {
    const out = deflate(over);
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(re);
  };
  test("bad index values, columns and fields", () => {
    refused({ data: d }, /“CPI” on 2022 is 0\.000; a price index must be greater than zero/);
    refused({ data: d.replace("\t0", "\t−1") }, /must be greater than zero/);
    refused({ data: d.replace("\t0", "\t") }, /Row 3 \(2022\) has no value in “CPI”/);
    refused({ data: "Year\tNominal\n2020\t1\n2021\t2" }, /two value columns/);
    refused({ data: "Nominal\tCPI\n1\t2\n3\t4" }, /Put the dates in the first column/);
    refused({ data: "Year\tNominal\tCPI\n2020\t1\t100" }, /at least 2/);
    refused({ base: "abc" }, /Base period: “abc” is not a date or period/);
    refused({ base: "1999" }, /no row is dated 1999/);
    refused({ from: "1e400" }, /not a date or period/);
    refused({ to: "−1" }, /not a date or period/);
    refused({ index: "Revenue" }, /cannot be both/);
    refused({ nominal: "Sales" }, /No column is named “Sales”/);
    refused({ data: "Year\tNominal\tCPI\n2020\t1e16\t100\n2021\t1\t101" }, /too large to show to the cent/);
    refused({ data: "Year\tNominal\tCPI\n2020\t1e14\t1e-300\n2021\t1\t1e300" }, /not a finite amount|too large/);
  });

  test("tiny and huge amounts stay printable", () => {
    const out = deflate({ data: "Year\tNominal\tCPI\n2020\t0.000000000001\t100\n2021\t999999999999\t101.5" });
    expect(clean(out)).toEqual([]);
  });

  test("100,000 daily rows: bounded, table and figure thinned and said", () => {
    const lines = ["Date\tNominal\tCPI"];
    for (let i = 0; i < 100000; i++) {
      const { y, m, d: dd } = civilFromDay(-25000 + i);
      lines.push(`${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}\t${(1000 + i).toFixed(2)}\t${(100 + i / 1000).toFixed(3)}`);
    }
    const t0 = Date.now();
    const out = deflate({ data: lines.join("\n") });
    const ms = Date.now() - t0;
    expect(out.ok).not.toBe(false);
    expect(clean(out)).toEqual([]);
    expect(out.tables![0].rows.length).toBeLessThanOrEqual(402);
    expect(out.text).toMatch(/The table shows every 250th row and the last/);
    // Measured 0.82 s alone (one worker, most of it reading 100,000 dated rows); bounded at 3.6×.
    expect(ms).toBeLessThan(3000);
  });
});
