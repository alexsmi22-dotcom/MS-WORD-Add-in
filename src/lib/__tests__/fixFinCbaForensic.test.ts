/**
 * fix-fin (2026-10-28): regressions pinned to reviewers R2 and R3's repros for the cost–benefit, currency-parity and
 * forensic / actuarial calculators (cbaCalcs.ts, forensicReports.ts).
 */
import { CBA_CALCS, pigou, pigouEfficient } from "../cbaCalcs";
import { FORENSIC_CALCS } from "../forensicCalcs";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const cba = (id: string) => calcById(CBA_CALCS, id);
const fo = (id: string) => calcById(FORENSIC_CALCS, id);

describe("R2 #1: fx-uip names a carry trade only when the foreign rate is the higher", () => {
  test("domestic 5% above foreign 3%, realized 1.30: no 'carry trade paid'", () => {
    const over = { spot: "1.25", id: "5", if: "3", years: "1", st: "1.30" };
    const o = asObj(runCalc(cba("fx-uip"), over));
    expect(o.text).not.toContain("carry trade");
    expect(o.text).toContain("UIP failed in favor of the foreign deposit");
    const r = checkedReading(cba("fx-uip"), over);
    expect(r).not.toContain("carry trade");
    expect(r).toContain("ahead.");
  });
  test("foreign 5% above domestic 3%: the carry trade", () => {
    const r = checkedReading(cba("fx-uip"), { spot: "1.25", id: "3", if: "5", years: "1", st: "1.30" });
    expect(r).toContain("(the carry trade paid)");
  });
});

describe("R2 #11 / #12 / MINOR: fx-cip", () => {
  test("a quote equal to parity as printed is parity, in the text and the reading", () => {
    const o = asObj(runCalc(cba("fx-cip"), { fwd: "1.26245" }));
    expect(o.text).toContain("Covered interest parity holds at the quoted forward");
    expect(o.text).not.toContain("Covered arbitrage");
    expect(o.reading).toContain("to the 6 decimals shown");
  });
  test("yen amounts carry no decimals (ISO 4217 minor unit 0)", () => {
    const o = asObj(runCalc(cba("fx-cip"), { spot: "150", id: "0.5", if: "5", fwd: "140", base: "USD", quote: "JPY", notional: "20,000,000" }));
    expect(o.ok).not.toBe(false);
    const yen = [...(o.text + (o.reading ?? "")).matchAll(/JP¥ ?[\d,]+(\.\d+)?/g)].map((m) => m[0]);
    expect(yen.length).toBeGreaterThan(0);
    for (const y of yen) expect(y).not.toMatch(/\.\d/);
  });
  test("a 36,500-day tenor is grouped", () => {
    const r = checkedReading(cba("fx-cip"), { days: "36500", fwd: "" });
    expect(r).toContain("36,500-day");
  });
});

describe("R3 M2 / MINOR 1 / MINOR 8: cba-scenarios and cba-pigou decide on the printed values", () => {
  test("two scenarios, one whose NPV prints 0.00, is not 'all 2 pass'", () => {
    const data = ["Year\tA benefits\tA costs\tB benefits\tB costs", "2026\t0\t100\t0\t100", "2027\t104.0000001\t0\t110\t0"].join("\n");
    const r = checkedReading(cba("cba-scenarios"), { data, rate: "4" });
    expect(r).toContain("1 of 2 scenarios passes");
    expect(r).not.toContain("all 2");
    const both = checkedReading(cba("cba-scenarios"), { data: data.replace("104.0000001", "120"), rate: "4" });
    expect(both).toContain("both scenarios pass");
  });
  test("'an 8%' rate", () => {
    expect(checkedReading(cba("cba-scenarios"), { rate: "8" })).toMatch(/^At an 8\.00% discount rate/);
  });
  test("pigou: quantities that print the same are already efficient", () => {
    const over = { e0: "0.0000001", e1: "0" };
    const res = pigou(100, 1, 10, 0.5, 0.0000001, 0);
    expect("error" in res).toBe(false);
    expect(pigouEfficient(res as never)).toBe(true);
    const r = checkedReading(cba("cba-pigou"), over);
    expect(r).toContain("already produces the efficient 60.0000 units");
    const o = asObj(runCalc(cba("cba-pigou"), over));
    expect(o.text).toContain("none: the market is already efficient");
    expect(o.svg).not.toContain("deadweight loss");
    const t = o.tables![0].rows;
    expect(t.find((x) => x[0] === "Tax per unit")![1]).toBe("0.0000");
    expect(t.find((x) => x[0] === "Deadweight loss")![2]).toBe("0.00");
  });
});

describe("R2 #9 / MINOR: forensic", () => {
  test("act-swr-mc: the ruin probability to 0.1 point with its standard error", () => {
    const o = asObj(runCalc(fo("act-swr-mc")));
    expect(o.text).toContain("23.4%, simulation standard error about 0.3 percentage points");
    expect(o.text).not.toContain("23.445%");
    expect(o.reading).not.toMatch(/about (0|100)%/);
  });
  test("act-swr-mc: no path ruined reads in words", () => {
    const r = checkedReading(fo("act-swr-mc"), { table: "none", years: "1" });
    expect(r).toContain("in none of 20,000 simulated return paths");
  });
  test("act-retire: (1 − 3%), not (1 + −3%)", () => {
    const o = asObj(runCalc(fo("act-retire"), { inflation: "-3" }));
    expect(o.text).toContain("/(1 − 3%)");
    expect(o.text).not.toContain("+ −");
  });
  test("dmg-lost-earnings-lpe: the Age of the partial final earnings row is the age the probabilities use", () => {
    const o = asObj(runCalc(fo("dmg-lost-earnings-lpe")));
    const rows = o.tables![0].rows;
    const r23 = rows.find((x) => x[0] === "23")!;
    expect(r23[1]).not.toBe("66.72");
    expect(Number(r23[1])).toBeLessThan(66.72);
    expect(rows.find((x) => x[0] === "24")![1]).toBe("67.72");
  });
});
