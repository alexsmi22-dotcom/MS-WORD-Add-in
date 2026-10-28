/**
 * fix-fin (2026-10-28): regressions pinned to reviewer R2's repros for the litigation calculators (antitrust,
 * securities, damages tables).
 */
import { LITIG_CALCS } from "../litigCalcs";
import { antitrustReading, type OverchargeEstimate } from "../antitrustDamages";
import { lookbackReading } from "../securitiesDamages";
import { parsePeriodTable, SUMMARY_RESULT_COLUMNS } from "../patentDamages";
import { readingProblems } from "../calcReading";
import { prejudgmentReport } from "../damagesInterest";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const lit = (id: string) => calcById(LITIG_CALCS, id);
const est = (method: "dummy" | "forecast", pct: number, p?: number): OverchargeEstimate =>
  ({ method, pctOfButFor: pct, perUnit: 0, shareOfActual: 0, butFor: [], during: [], fit: {} as OverchargeEstimate["fit"], ...(p !== undefined ? { dummy: { p } as OverchargeEstimate["dummy"] } : {}) }) as OverchargeEstimate;

describe("R2 #4: dmg-antitrust gives one verdict per printed p", () => {
  test("p = 0.0496 and 0.0504 both print 0.050 and both read as borderline", () => {
    const a = antitrustReading([est("dummy", 0.05, 0.0496)], ["$100.00"]);
    const b = antitrustReading([est("dummy", 0.05, 0.0504)], ["$100.00"]);
    for (const r of [a, b]) {
      expect(r).toContain("p = 0.050, right at the conventional 5% threshold, so the evidence is borderline");
      expect(readingProblems(r)).toEqual([]);
    }
    expect(antitrustReading([est("dummy", 0.05, 0.049)], ["$100.00"])).toContain("statistically significant");
    expect(antitrustReading([est("dummy", 0.05, 0.051)], ["$100.00"])).toContain("could be chance");
  });
});

describe("R2 #14: a negative estimate is not 'no overcharge'", () => {
  test("the wording is 'no positive overcharge estimate'", () => {
    const r = antitrustReading([est("dummy", -0.03, 0.074)], ["−$10.00"]);
    expect(r).toMatch(/^These data give no positive overcharge estimate/);
    expect(r).not.toContain("show no overcharge");
  });
});

describe("R2 #13: dmg-antitrust tables in fixed point", () => {
  test("no ×10ⁿ in the tables or text on the defaults, and an R² of float noise prints 0.0000", () => {
    const o = asObj(runCalc(lit("dmg-antitrust")));
    const cells = (o.tables ?? []).flatMap((t) => [...t.rows.flat(), t.note ?? ""]).join("\n");
    expect(cells).not.toMatch(/×10/);
    // A flat price series: the regression explains nothing; R² is float noise around 0.
    const rows = ["Month\tPeriod\tPrice", ...Array.from({ length: 6 }, (_, i) => `b${i + 1}\tbefore\t100`), ...Array.from({ length: 6 }, (_, i) => `d${i + 1}\tduring\t100`)].join("\n");
    const flat = asObj(runCalc(lit("dmg-antitrust"), { data: rows, controls: "", method: "dummy" }));
    const all = [flat.text, ...(flat.tables ?? []).flatMap((t) => [...t.rows.flat(), t.note ?? ""])].join("\n");
    expect(all).not.toMatch(/×10/);
  });
  test("the HAC label names the small-sample factor", () => {
    expect(asObj(runCalc(lit("dmg-antitrust"), { se: "hac" })).text).toContain("n/(n − k) small-sample factor");
  });
});

describe("R2 #15 / MINOR: PSLRA and the ribbon", () => {
  test("a loss equal to the cap as printed is not 'cut to' itself", () => {
    // cap 6.60531 and loss 6.60534 both print $6.6053; the loss is above the cap only past the 4th decimal.
    const r = lookbackReading(28.39469, 35.0, 6.60534);
    expect(r).not.toContain("cut to");
    expect(r).toContain("equals the PSLRA 90-day lookback cap");
  });
  test("one close reads 'the single close', not 'the 1 close'", () => {
    const o = asObj(runCalc(lit("dmg-pslra")));
    expect(o.text).not.toMatch(/the 1 close/);
  });
  test("the constant-percentage ribbon prints per-share inflation at four decimals", () => {
    const o = asObj(runCalc(lit("dmg-sec-ribbon"), { mode: "ar-pct" }));
    const win = (o.tables ?? []).find((t) => t.label === "Inflation by window")!;
    const cells = win.rows.slice(1).map((r) => r[r.length - 1]);
    for (const c of cells.flatMap((x) => x.split(" to "))) expect(c).toMatch(/^\$[\d,]+\.\d{4}$/);
    expect(checkedReading(lit("dmg-sec-ribbon"), { mode: "ar-pct" })).toMatch(/\(\$[\d,]+\.\d{4} per share\)/);
  });
});

describe("R2 #3: dmg-summary's pasted-result check does not fire on valid input", () => {
  const N = ["lost profits", "price erosion", "reasonable royalty"];
  const parse = (s: string) => parsePeriodTable(s, N, 1, { resultColumns: SUMMARY_RESULT_COLUMNS });
  test("all-zero columns and a two-row coincidence are accepted", () => {
    expect("error" in parse("2022 300,000 0 0\n2023 250,000 0 0")).toBe(false);
    expect("error" in parse("2022 100 10 10\n2023 100 20 30")).toBe(false);
  });
  test("a real running-total column over three rows is still refused", () => {
    const r = parse("2022 100 10 10\n2023 100 20 30\n2024 100 5 35");
    expect("error" in r && r.error).toContain("running total");
  });
});

describe("R2 #7: dmg-prejudgment stays quick at its caps", () => {
  test("2,500 rows compounded monthly from 1926 exceed the step budget and are refused by name", () => {
    const tr = Array.from({ length: 2500 }, () => "1926-01-15\t1000").join("\n");
    const r = prejudgmentReport({ tranches: tr, rates: "1926-01-01\t5", end: "2026-01-01", method: "monthly", dayCount: "act365", midPeriod: "off" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("compounding steps, above the 2,000,000");
    expect(r.text).toContain("less frequent compounding method");
    const q = prejudgmentReport({ tranches: tr, rates: "1926-01-01\t5", end: "2026-01-01", method: "annual", dayCount: "act365", midPeriod: "off" });
    expect(q.ok).toBe(true);
  });
});

describe("R2 MINOR: a decimal comma in a damages table is said", () => {
  test("“3,5” is read as 3.5 with a note", () => {
    const t = parsePeriodTable("2022\t3,5", ["revenue"], 1);
    if ("error" in t) throw new Error(t.error);
    expect(t.rows[0].values[0]).toBe(3.5);
    expect(t.notes.join(" ")).toContain("“3,5” was read as 3.5 (a decimal comma)");
    const g = parsePeriodTable("2022\t1,234,567.5", ["revenue"], 1);
    if ("error" in g) throw new Error(g.error);
    expect(g.notes).toEqual([]);
  });
});
