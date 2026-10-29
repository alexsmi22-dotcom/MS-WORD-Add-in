/**
 * fix-fin (2026-10-28): regressions pinned to reviewer R2's repros for the IP valuation and apportionment calculators
 * (ipValuationCalcs.ts, apportionment.ts, ipValuation.ts) and the royalty label check (patentDamages.ts).
 */
import { IPVAL_CALCS } from "../ipValuationCalcs";
import { periodLabelMismatch, parsePeriodTable, reasonableRoyalty } from "../patentDamages";
import { mcCell } from "../ipValuation";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const ip = (id: string) => calcById(IPVAL_CALCS, id);

describe("R2 #6: period labels that disagree with periods per year get a note", () => {
  test("the helper: years, quarters, months against the frequency entered", () => {
    expect(periodLabelMismatch(["2019", "2020"], 4)).toContain("read as years (1 a year), but periods per year is 4");
    expect(periodLabelMismatch(["2019-Q1", "2019-Q2"], 1)).toContain("quarters (4 a year)");
    expect(periodLabelMismatch(["2019-07", "2019-08"], 4)).toContain("months (12 a year)");
    expect(periodLabelMismatch(["2019", "2020"], 1)).toBeNull();
    expect(periodLabelMismatch(["Year 1", "Year 2"], 4)).toBeNull();
  });
  test("ipv-comparable: year labels with 4 periods a year", () => {
    const o = asObj(runCalc(ip("ipv-comparable"), { ppy: "4" }));
    expect(o.text).toContain("Note: the period labels read as years");
    expect(asObj(runCalc(ip("ipv-comparable"))).text).not.toContain("period labels read as");
  });
  test("dmg-royalty: year labels with 4 periods a year", () => {
    const t = parsePeriodTable("2019 1,000,000\n2020 1,200,000", ["revenue"], 1);
    if ("error" in t) throw new Error(t.error);
    const out = reasonableRoyalty({ basis: "revenue", rate: 5, apportionPct: 100, rows: t.rows, lumpSum: 100000, discountPct: 8, periodsPerYear: 4 });
    if ("error" in out) throw new Error(out.error);
    expect(out.text).toContain("Note: the period labels read as years");
  });
});

// Fix round 2 M2: the mean, its SE and the percentiles round to the SE's second significant figure (mcStepOf);
// mcCell without a step (the standard deviation) keeps 3 significant figures.
describe("R2 #9: ipv-mc amounts to 3 significant figures", () => {
  test("mean, P10 and P90 are not printed to the cent; the standard error is shown", () => {
    const o = asObj(runCalc(ip("ipv-mc")));
    expect(o.text).toMatch(/Mean NPV: 114,100 \(simulation standard error [\d,]+\)/);
    expect(o.text).not.toMatch(/P10 −?[\d,]+\.\d\d;/);
    expect(mcCell(1234567.891, { code: "", minor: 2 } as never)).toBe("1,230,000");
    expect(mcCell(12.3456, { code: "", minor: 2 } as never)).toBe("12.3");
    expect(mcCell(-0.012345, { code: "", minor: 2 } as never)).toBe("−0.01");
  });
});

describe("R2 #10 / MINOR: Nash and the comparable license", () => {
  test("a 25% share is computed, with the Uniloc caution", () => {
    const o = asObj(runCalc(ip("ipv-nash"), { share: "25" }));
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Caution: a patentee share at or near 25%");
  });
  test("a/an: 'an 8%' share and 'An 8.00%' running royalty", () => {
    expect(checkedReading(ip("ipv-nash"), { share: "8" })).toContain("for an 8.00% patentee share");
    expect(checkedReading(ip("ipv-comparable"), { direction: "rate2lump", rate: "8" })).toMatch(/^An 8\.00% running royalty/);
  });
  test("the comparable refusal groups its percentage", () => {
    const o = asObj(runCalc(ip("ipv-comparable"), { lump: "1,000,000,000" }));
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/an effective rate of \d{1,3}(,\d{3})+\.\d\d%/);
  });
});
