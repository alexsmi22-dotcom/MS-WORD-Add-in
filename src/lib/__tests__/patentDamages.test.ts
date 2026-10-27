/**
 * Patent damages (Release E1b): reasonable royalty, lost profits / price erosion / remainder royalty, the summary by
 * period, and the Georgia-Pacific and Panduit worksheets.
 *
 * The worked cases are pinned to the cent against an INDEPENDENT Python Decimal oracle (ROUND_HALF_UP per period,
 * totals = sums of the rounded periods), scripts/patent-damages-oracle.py (run it with the oracle venv's python); its
 * outputs are copied here verbatim.
 */
import * as fs from "fs";
import * as path from "path";
import {
  parsePeriodTable,
  computeRoyalty,
  reasonableRoyalty,
  computeLostProfits,
  lostProfits,
  damagesSummary,
  georgiaPacificWorksheet,
  panduitWorksheet,
  damagesTablesClean,
  damagesToFin,
  roundCents,
  dmgMoney,
  type LostProfitsInput,
  type PeriodRow,
  type RoyaltyInput,
  type DamagesOutput,
} from "../patentDamages";
import { hasBrokenNumber, insertableResultText } from "../insertGate";
import { finMoney } from "../financeFigures";
import { usd } from "../damagesUsd";
import { budget } from "./timeBudget";

const rows = (...r: [string, ...number[]][]): PeriodRow[] => r.map(([label, ...values]) => ({ label, values }));
const ok = (r: ReturnType<typeof reasonableRoyalty>): DamagesOutput => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

/** The display contract on every ok result: text and every table cell. */
function expectDisplayContract(out: DamagesOutput): void {
  expect(insertableResultText(out.text)).toBe(true);
  expect(damagesTablesClean(out.tables)).toBe(true);
  const all = [out.text, ...out.tables.flatMap((t) => t.rows.flat())].join("\n");
  expect(all).not.toMatch(/\d[eE][+-]?\d/);
  expect(all).not.toMatch(/(?:^|[\s(])-\d/m); // a negative number takes U+2212, never a hyphen
  expect(all).not.toMatch(/NaN|Infinity|undefined/);
  expect(all).not.toContain("—");
}

const baseRoyalty = (over: Partial<RoyaltyInput> = {}): RoyaltyInput => ({
  rows: rows(["2021", 4000000], ["2022", 5500000], ["2023", 6250000], ["2024", 3100000]),
  basis: "revenue",
  rate: 3,
  apportionPct: 40,
  lumpSum: 200000,
  discountPct: 8,
  periodsPerYear: 1,
  ...over,
});

const baseLP = (over: Partial<LostProfitsInput> = {}): LostProfitsInput => ({
  rows: rows(["2022", 12000, 30000, 5000], ["2023", 15000, 32000, 6000], ["2024", 9000, 28000, 6000]),
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

describe("reasonable royalty: oracle cases to the cent", () => {
  test("R1: revenue 3% × 40% apportionment, lump 200,000 vs PV at 8% annual", () => {
    const c = computeRoyalty(baseRoyalty());
    if ("error" in c) throw new Error(c.error);
    expect(c.periods.map((p) => p.royalty)).toEqual([48000, 66000, 75000, 37200]);
    expect(c.total).toBe(226200);
    expect(c.periods.map((p) => p.pv)).toEqual([44444.44, 56584.36, 59537.42, 27343.11]);
    expect(c.pvTotal).toBe(187909.33); // the column foots: the sum of the rounded cells
    const out = ok(reasonableRoyalty(baseRoyalty()));
    expect(out.text).toContain("Total running royalty: $226,200.00");
    expect(out.text).toContain("Present value of the running royalty at 8.00% a year: $187,909.33");
    expect(out.text).toContain("Lump sum entered: $200,000.00; $12,090.67 above that present value.");
    expect(out.text).toContain("computed from the inputs given");
    expectDisplayContract(out);
  });
  test("R2: per unit 2.35 on fractional units, no comparison", () => {
    const c = computeRoyalty(baseRoyalty({ rows: rows(["A", 12345], ["B", 23456.5], ["C", 7891]), basis: "unit", rate: 2.35, apportionPct: 100, lumpSum: 0 }));
    if ("error" in c) throw new Error(c.error);
    expect(c.periods.map((p) => p.royalty)).toEqual([29010.75, 55122.78, 18543.85]);
    expect(c.total).toBe(102677.38);
    expect(c.pvTotal).toBeNull();
  });
  test("R3: quarterly 4.5% × 62.5%, lump 150,000 vs PV at 10% annual effective", () => {
    const inp = baseRoyalty({
      rows: rows(["Q1", 1234567.89], ["Q2", 2345678.91], ["Q3", 987654.32], ["Q4", 1111111.11]),
      rate: 4.5,
      apportionPct: 62.5,
      lumpSum: 150000,
      discountPct: 10,
      periodsPerYear: 4,
    });
    const c = computeRoyalty(inp);
    if ("error" in c) throw new Error(c.error);
    expect(c.periods.map((p) => p.royalty)).toEqual([34722.22, 65972.22, 27777.78, 31250]);
    expect(c.total).toBe(159722.22);
    expect(c.periods.map((p) => p.pv)).toEqual([33904.65, 62902.04, 25861.46, 28409.09]);
    expect(c.pvTotal).toBe(151077.24);
    expect(ok(reasonableRoyalty(inp)).text).toContain("$1,077.24 below that present value.");
  });
  test("the table: header, one row per period, a totals row; a figure is drawn", () => {
    const out = ok(reasonableRoyalty(baseRoyalty()));
    const t = out.tables[0].rows;
    expect(t[0]).toEqual(["Period", "Revenue", "Royalty", "Cumulative", "Present value"]);
    expect(t[1]).toEqual(["2021", "$4,000,000.00", "$48,000.00", "$48,000.00", "$44,444.44"]);
    expect(t[t.length - 1][0]).toBe("Total");
    expect(t[t.length - 1][2]).toBe("$226,200.00");
    expect(out.svg).toMatch(/^<svg/);
  });
  test("refusals by name", () => {
    expect(reasonableRoyalty(baseRoyalty({ rate: -1 }))).toEqual({ error: "The royalty rate cannot be negative." });
    expect("error" in reasonableRoyalty(baseRoyalty({ apportionPct: 0 }))).toBe(true);
    expect("error" in reasonableRoyalty(baseRoyalty({ apportionPct: 120 }))).toBe(true);
    expect("error" in reasonableRoyalty(baseRoyalty({ rate: 150 }))).toBe(true);
    expect("error" in reasonableRoyalty(baseRoyalty({ lumpSum: -5 }))).toBe(true);
  });
  test("small rates are shown as entered, not rounded to cents", () => {
    expect(ok(reasonableRoyalty(baseRoyalty({ rate: 0.125, lumpSum: 0 }))).text).toContain("Rate: 0.125% of revenue");
    const u = ok(reasonableRoyalty(baseRoyalty({ basis: "unit", rate: 0.005, apportionPct: 100, lumpSum: 0 })));
    expect(u.text).toContain("Rate: $0.005 per unit");
    expect(u.text).toContain("Total running royalty: $94,250.00");
    expect(u.text).toContain("Total royalty base: 18,850,000 units");
  });
  test("zero rate is a zero royalty, not a refusal", () => {
    const out = ok(reasonableRoyalty(baseRoyalty({ rate: 0, lumpSum: 0 })));
    expect(out.text).toContain("Total running royalty: $0.00");
    expect(out.svg).toBeUndefined();
  });
});

describe("lost profits: oracle cases to the cent", () => {
  test("L1: capture 60%, capacity column, margin 120 − 70, erosion, remainder at 4/unit", () => {
    const c = computeLostProfits(baseLP());
    if ("error" in c) throw new Error(c.error);
    expect(c.periods.map((p) => p.captured)).toEqual([5000, 6000, 5400]);
    expect(c.periods.map((p) => p.lostProfits)).toEqual([250000, 300000, 270000]);
    expect(c.periods.map((p) => p.erosion)).toEqual([300000, 320000, 280000]);
    expect(c.periods.map((p) => p.remainder)).toEqual([28000, 36000, 14400]);
    expect(c.totals).toMatchObject({ lostProfits: 820000, erosion: 900000, remainder: 78400, total: 1798400 });
    expect(c.capped).toBe(2);
    const out = lostProfits(baseLP());
    if ("error" in out) throw new Error(out.error);
    expect(out.text).toContain("Total: $1,798,400.00");
    expect(out.text).toContain("Spare capacity limited the captured units in 2 of 3 periods.");
    expectDisplayContract(out);
  });
  test("L2: market-share method, margin entered, elasticity 1.5, remainder at 5% of 90", () => {
    const c = computeLostProfits(
      baseLP({
        rows: rows(["2022", 10000, 20000], ["2023", 12500, 21000], ["2024", 7333, 19000]),
        method: "market",
        marginMode: "margin",
        margin: 37.25,
        butForPrice: 105,
        actualPrice: 100,
        elasticity: 1.5,
        remainder: "revenue",
        remainderRate: 5,
        infringerPrice: 90,
      }),
    );
    if ("error" in c) throw new Error(c.error);
    expect(c.capture).toBeCloseTo(0.5333333333, 9);
    expect(c.periods.map((p) => p.lostProfits)).toEqual([198666.67, 248333.33, 145682.27]);
    expect(c.periods.map((p) => p.erosion)).toEqual([36625, 38456.25, 34793.75]);
    expect(c.periods.map((p) => p.remainder)).toEqual([21000, 26250, 15399.3]);
    expect(c.periods.map((p) => p.total)).toEqual([256291.67, 313039.58, 195875.32]);
    expect(c.totals).toMatchObject({ lostProfits: 592682.27, erosion: 109875, remainder: 62649.3, total: 765206.57 });
  });
  test("L3: capture 100%, scalar capacity 8,000, margin 99.99 − 45.55, no erosion, no remainder", () => {
    const c = computeLostProfits(
      baseLP({ rows: rows(["A", 9500], ["B", 12000], ["C", 4100]), captureSharePct: 100, capacity: 8000, price: 99.99, cost: 45.55, erosion: false, remainder: "none" }),
    );
    if ("error" in c) throw new Error(c.error);
    expect(c.periods.map((p) => p.lostProfits)).toEqual([435520, 435520, 223204]);
    expect(c.totals.total).toBe(1094244);
    const out = lostProfits(baseLP({ rows: rows(["A", 9500]), erosion: false, remainder: "none" }));
    if ("error" in out) throw new Error(out.error);
    expect(out.tables[0].rows[0]).toEqual(["Period", "Infringer's units", "Captured units", "Lost profits", "Total"]);
  });
  test("refusals by name", () => {
    expect("error" in lostProfits(baseLP({ captureSharePct: 120 }))).toBe(true);
    const sum = lostProfits(baseLP({ method: "market", patenteeSharePct: 80, infringerSharePct: 30 }));
    expect(sum).toEqual({ error: "The patentee's and the infringer's market shares add to 110.00%, more than 100%." });
    expect("error" in lostProfits(baseLP({ cost: 130 }))).toBe(true); // negative margin
    expect(lostProfits(baseLP({ butForPrice: 110 }))).toEqual({ error: "Price erosion needs a but-for price at or above the actual price." });
    expect("error" in lostProfits(baseLP({ elasticity: -1 }))).toBe(true);
    const neg = lostProfits(baseLP({ elasticity: 20 }));
    expect("error" in neg && neg.error).toMatch(/negative but-for volume/);
    expect(lostProfits(baseLP({ rows: rows(["A", 100]) }))).toEqual({
      error: "A: price erosion needs the patentee's actual units, the second number on each line (enter 0 for a period with none).",
    });
  });
});

describe("summary by period: oracle cases to the cent", () => {
  const S = (r: PeriodRow[], m: number): DamagesOutput => ok(damagesSummary({ rows: r, multiplier: m }));
  test("S1: three columns, no multiplier", () => {
    const out = S(rows(["2022", 300000, 280000, 28000], ["2023", 400000, 320000, 36000], ["2024", 300000, 280000, 12000]), 1);
    expect(out.text).toContain("Damages: $1,956,000.00");
    expect(out.text).toContain("Total: $1,956,000.00");
    expect(out.tables[0].rows.slice(1, 4).map((r) => r[5])).toEqual(["$608,000.00", "$756,000.00", "$592,000.00"]);
    expect(out.text).toContain("computes no interest");
    expectDisplayContract(out);
  });
  test("S2: interest column, multiplier 2 on damages only", () => {
    const out = S(rows(["2022", 125000.1, 0, 18000.25, 4321.09], ["2023", 98000.55, 1500, 17000, 2100.5]), 2);
    expect(out.text).toContain("Damages: $259,500.90");
    expect(out.text).toContain("Damages × 2 (multiplier entered): $519,001.80");
    expect(out.text).toContain("Interest (as entered): $6,421.59");
    expect(out.text).toContain("Total: $525,423.39");
    expect(out.tables[0].rows[1][6]).toBe("$147,321.44");
  });
  test("S3: binary near-half cents round half up as the decimal oracle does; multiplier 3", () => {
    const out = S(rows(["A", 1000.005, 2000.004, 0.333], ["B", 0, 0, 999.995]), 3);
    expect(out.text).toContain("Damages: $4,000.34");
    expect(out.text).toContain("Damages × 3 (multiplier entered): $12,001.02");
  });
  test("a multiplier above 3 is refused, quoting § 284 exactly", () => {
    const r = damagesSummary({ rows: rows(["A", 1]), multiplier: 3.5 });
    expect("error" in r && r.error).toContain("“may increase the damages up to three times the amount found or assessed.”");
    expect("error" in damagesSummary({ rows: rows(["A", 1]), multiplier: 0.5 })).toBe(true);
  });
});

describe("the per-period table parser", () => {
  const N = ["units", "own", "capacity"];
  test("spaces, tabs, semicolons; a year label; 'Q1 2024' labels", () => {
    expect(parsePeriodTable("2021 1,000 50", N, 1)).toEqual({ rows: rows(["2021", 1000, 50]), notes: [] });
    expect(parsePeriodTable("Q1 2024 1,000 50", N, 1)).toEqual({ rows: rows(["Q1 2024", 1000, 50]), notes: [] });
    expect(parsePeriodTable("FY 2023\t2.500,5\t7", N, 1)).toEqual({ rows: rows(["FY 2023", 2500.5, 7]), notes: [] });
    expect(parsePeriodTable("Jan; $1,234.50; 3", N, 1)).toEqual({ rows: rows(["Jan", 1234.5, 3]), notes: [] });
    expect(parsePeriodTable("500", ["base"], 1)).toEqual({ rows: rows(["Period 1", 500]), notes: [] });
  });
  test("a header line (Use table at cursor keeps it) is skipped and said", () => {
    const r = parsePeriodTable("Period\tRevenue\n2021\t1,000\n2022\t2,000", ["revenue"], 1);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toEqual(rows(["2021", 1000], ["2022", 2000]));
    expect(r.notes[0]).toMatch(/read as a header/);
  });
  test("decimal comma and thousands separators", () => {
    const r = parsePeriodTable("A 1234,5\nB 1,234,567.25\nC 1.234.567,25", ["base"], 1);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows.map((x) => x.values[0])).toEqual([1234.5, 1234567.25, 1234567.25]);
  });
  test("refused by line and by name", () => {
    expect(parsePeriodTable("", ["base"], 1)).toEqual({ error: "Enter at least one period: a label, then base." });
    expect(parsePeriodTable("   \n  ", ["base"], 1)).toHaveProperty("error");
    expect(parsePeriodTable("2021 100\n2022 abc", ["base"], 1)).toEqual({ error: "Line 2 (“2022”): “abc” is not a number." });
    expect(parsePeriodTable("2021 100\n2022 −5", ["base"], 1)).toEqual({ error: "Line 2 (“2022”): base cannot be negative." });
    expect(parsePeriodTable("2021 100\n2021 200", ["base"], 1)).toEqual({ error: "The period “2021” appears twice (lines 1 and 2)." });
    expect(parsePeriodTable("2021 1 2 3 4", N, 1)).toHaveProperty("error");
    expect(parsePeriodTable("2021 1e19", ["base"], 1)).toHaveProperty("error");
  });
  test("a Total row (an inserted result read back, an expert's totals line) is skipped, never a period", () => {
    const out = ok(reasonableRoyalty(baseRoyalty()));
    const back = out.tables[0].rows.map((r) => r.join("\t")).join("\n");
    const t = parsePeriodTable(back, ["royalty base"], 1);
    // The inserted table has 5 columns; read back as a royalty base it is refused by name, not summed.
    expect(t).toHaveProperty("error");
    const two = parsePeriodTable("Period\tRevenue\n2021\t1,000\n2022\t2,000\nTotal\t3,000", ["revenue"], 1);
    if ("error" in two) throw new Error(two.error);
    expect(two.rows.map((r) => r.label)).toEqual(["2021", "2022"]);
    expect(two.notes.join(" ")).toContain("Line 4 (“Total 3,000”) is a totals line and was skipped");
    for (const lbl of ["TOTAL", "Totals", "Grand total", "Sum", "Subtotal", "Total damages", "TOTAL (2021–2024)", "Totals (USD)"]) {
      const r = parsePeriodTable(`2021 5\n${lbl} 5`, ["base"], 1);
      if ("error" in r) throw new Error(r.error);
      expect(r.rows.length).toBe(1);
    }
  });
  test("zero amounts are accepted", () => {
    const r = parsePeriodTable("2021 0", ["base"], 1);
    expect(r).toEqual({ rows: rows(["2021", 0]), notes: [] });
  });
  test("v2.201.0: “$” cells read; any other currency sign is refused by name (the output prints $)", () => {
    expect(parsePeriodTable("2023\t$1,000\n2024\t−$5", ["base"], 1, { allowNegative: [0] })).toEqual({ rows: rows(["2023", 1000], ["2024", -5]), notes: [] });
    for (const [text, sign] of [["2023\t€1,000", "€"], ["2023 £1,000", "£"], ["2023; ¥1000", "¥"], ["2023 50¢", "¢"], ["Period\tAmount (€)\n2023\t1,000", "€"]]) {
      const r = parsePeriodTable(text, ["base"], 1);
      expect(r).toHaveProperty("error");
      const e = (r as { error: string }).error;
      expect(e).toContain(`“${sign}”`);
      expect(e).toContain("work in US dollars");
    }
  });
});

describe("hostile sizes", () => {
  test("1e12 amounts (the cap) stay grouped, never e-notation; above is refused", () => {
    const out = ok(reasonableRoyalty(baseRoyalty({ rows: rows(["A", 1e12], ["B", 1e12]), rate: 5, apportionPct: 100, lumpSum: 0 })));
    expect(out.text).toContain("Total running royalty: $100,000,000,000.00");
    expect(out.text).toContain("Total royalty base: $2,000,000,000,000.00");
    expectDisplayContract(out);
    expect(parsePeriodTable("2021 1e15", ["base"], 1)).toHaveProperty("error");
  });
  test("10,000 periods parse and compute fast; the figure becomes a cumulative line", () => {
    const text = Array.from({ length: 10000 }, (_, i) => `P${i + 1}\t${1000 + i}\t${2000 + i}\t${500}`).join("\n");
    const t0 = Date.now();
    const t = parsePeriodTable(text, ["units", "own", "capacity"], 1);
    if ("error" in t) throw new Error(t.error);
    const out = lostProfits(baseLP({ rows: t.rows }));
    if ("error" in out) throw new Error(out.error);
    expect(Date.now() - t0).toBeLessThan(budget(3000));
    expect(out.tables[0].rows.length).toBe(10002);
    expect(out.svg).toContain("cumulative");
    expectDisplayContract(out);
  });
  test("roundCents: half away from zero, binary near-halves included", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(0.004999)).toBe(0);
    // A cent fraction of .4 at a million is not a "near half".
    expect(roundCents(1000000.004)).toBe(1000000);
    expect(roundCents(1000000.006)).toBe(1000000.01);
    expect(roundCents(123456789.125)).toBe(123456789.13);
    for (const x of [0, 1, -1, 1234.5, -98765.4321, 1e15, 0.001, -0.004]) expect(dmgMoney(x)).toBe(usd(finMoney(roundCents(x))));
    expect(dmgMoney(-1234.5)).toBe("−$1,234.50");
    expect(dmgMoney(-0.001)).toBe("$0.00");
    // The non-finite sentinel stays bare, so the insert gates still see it.
    expect(dmgMoney(NaN)).toBe("—");
  });
});

describe("worksheets", () => {
  test("Georgia-Pacific: 15 rows, the verified short titles, the citation line", () => {
    const w = georgiaPacificWorksheet();
    const t = w.tables[0].rows;
    expect(t[0]).toEqual(["No.", "Factor", "Evidence", "Effect on rate (↑/↓/neutral)"]);
    expect(t.length).toBe(16);
    expect(t[1][1]).toBe("royalties received by the patentee for licensing the patent in suit (established royalty)");
    expect(t[6][1]).toBe("effect on sales of other products; derivative or convoyed sales");
    expect(t[15][1]).toBe("amount a willing licensor and willing licensee would have agreed upon at the time infringement began (hypothetical negotiation)");
    expect(w.text).toContain("Georgia-Pacific Corp. v. U.S. Plywood Corp., 318 F. Supp. 1116, 1120 (S.D.N.Y. 1970)");
    expect(w.text).toContain("ProBatter Sports, LLC v. Sports Tutor, Inc., 586 F. Supp. 3d 80 (D. Conn. 2022)");
    expect(w.svg).toBeUndefined();
    expectDisplayContract(w);
  });
  test("Panduit: the four factors verbatim with the Presidio citation", () => {
    const w = panduitWorksheet();
    expect(w.tables[0].rows.map((r) => r[1])).toEqual([
      "Factor",
      "demand for the patented product",
      "an absence of acceptable, noninfringing substitutes",
      "manufacturing and marketing capability to exploit the demand",
      "the amount of profit that would have been made",
    ]);
    expect(w.tables[0].rows[0]).toEqual(["No.", "Factor", "Evidence", "Shown?"]);
    expect(w.text).toContain(
      "“(1) demand for the patented product; (2) an absence of acceptable, noninfringing substitutes; (3) manufacturing and marketing capability to exploit the demand; and (4) the amount of profit that would have been made.”",
    );
    expect(w.text).toContain(
      "Panduit Corp. v. Stahlin Bros. Fibre Works, Inc., 575 F.2d 1152, 1156 (6th Cir. 1978), as stated in Presidio Components, Inc. v. Am. Tech. Ceramics Corp., 875 F.3d 1369 (Fed. Cir. 2017)",
    );
    expectDisplayContract(w);
  });
  test("damagesToFin: a refusal is never insertable; notes ride along", () => {
    expect(damagesToFin({ error: "x" })).toEqual({ text: "x", ok: false });
    expect(damagesToFin(panduitWorksheet(), ["n"]).text).toMatch(/Note: n$/);
  });
});

describe("the pane reaches the damages tools (routing, from the taskpane source)", () => {
  const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
  test("imports the engine", () => {
    expect(PANE).toMatch(/from "\.\.\/lib\/patentDamages";/);
  });
  test("the five ids sit in one contiguous block at the end of FIN_CALCS under the E1b header", () => {
    const start = PANE.indexOf("const FIN_CALCS: FinCalc[] = [");
    const end = PANE.indexOf("\n];\n", start);
    const body = PANE.slice(start, end);
    const header = body.indexOf("// Litigation damages: royalty, lost profits, worksheets (E1b)");
    expect(header).toBeGreaterThan(0);
    const ids = ["dmg-royalty", "dmg-lost-profits", "dmg-summary", "dmg-gp-worksheet", "dmg-panduit-worksheet"];
    let at = header;
    for (const id of ids) {
      const i = body.indexOf(`id: "${id}"`);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    // Nothing else after the block.
    expect(/id: "/.test(body.slice(body.indexOf('id: "dmg-panduit-worksheet"') + 5))).toBe(false);
  });
  test("per-period fields are block fields (Use table at cursor), skipped by the number reader", () => {
    expect(PANE).toMatch(/kind\?: "number" \| "select" \| "list" \| "text" \| "block";/);
    expect(PANE).toMatch(/if \(f\.kind === "select" \|\| f\.kind === "list" \|\| f\.kind === "text" \|\| f\.kind === "block"\) continue;/);
  });
  test("tables are gated and inserted as one package", () => {
    expect(PANE).toMatch(/damagesTablesClean\(tables\)/);
    expect(PANE).toMatch(/if \(currentFinTables\.length\) \{[\s\S]{0,400}await insertTextTablesFigure\(/);
    // v2.196.0 (E2): the loop also pushes a table's optional legend line (Stats regression tables) right after it.
    expect(PANE).toMatch(/for \(const t of tables\) \{\n(\s+\/\/[^\n]*\n)?\s+items\.push\(\{ kind: "table", label: t\.label, rows: t\.rows(, align: t\.align)? \}\);/);
  });
});
