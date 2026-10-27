/**
 * v2.201.1 review: the split summary tables (≤ 6 columns) carry few enough numbers per row to be read back in as
 * input. Pasted back WITHOUT their title row they used to double-count; they are recognised by their arithmetic and
 * refused. Title rows are matched as words ("Damages ($)", space-separated titles from a PDF).
 */
import { damagesSummary, parsePeriodTable, SUMMARY_RESULT_COLUMNS, type PeriodRow } from "../patentDamages";

const NAMES = ["lost profits", "price erosion", "reasonable royalty", "interest"];
const summaryRead = (text: string) => parsePeriodTable(text, NAMES, 1, { allowNegative: [1], resultColumns: SUMMARY_RESULT_COLUMNS });
const rows = (...r: [string, ...number[]][]): PeriodRow[] => r.map(([label, ...values]) => ({ label, values }));
const tsv = (t: string[][]): string => t.map((r) => r.join("\t")).join("\n");
const err = (r: object): string => ("error" in r ? String((r as { error: string }).error) : "");

function summaryTables(withInterest: boolean): string[][][] {
  const input = withInterest
    ? rows(["2022", 300000, 280000, 28000, 5000], ["2023", 400000, 320000, 36000, 7000])
    : rows(["2022", 300000, 280000, 28000], ["2023", 400000, 320000, 36000]);
  const out = damagesSummary({ rows: input, multiplier: 1 });
  if ("error" in out) throw new Error(out.error);
  return out.tables.map((t) => t.rows);
}

describe("a result table pasted back without its title row is refused", () => {
  test.each([true, false])("both summary tables (interest %s), body and Total row", (withInterest) => {
    for (const t of summaryTables(withInterest)) {
      const e = err(summaryRead(tsv(t.slice(1))));
      expect(e).toContain("result table pasted back");
    }
  });

  test("title rows matched as words: brackets, spaces, capitals", () => {
    for (const head of ["Period\tDamages ($)", "Period\tTotal (USD)", "Period Lost profits Price erosion Reasonable royalty Damages", "PERIOD;CUMULATIVE"]) {
      expect(err(summaryRead(`${head}\n2022\t100\t50`))).toContain("computed here, not read");
    }
  });
});

describe("ordinary input still reads", () => {
  test("a normal summary input, with and without its title row", () => {
    for (const text of [
      "Period\tLost profits\tPrice erosion\tReasonable royalty\n2022\t300000\t280000\t28000\n2023\t400000\t320000\t36000",
      "2022\t300000\t280000\t28000\n2023\t400000\t320000\t36000",
      "2022\t100000\t100000",
    ]) {
      const r = summaryRead(text);
      expect(err(r)).toBe("");
    }
  });

  test("an all-zero table is not mistaken for a result table", () => {
    expect(err(summaryRead("2022\t0\t0\t0\n2023\t0\t0\t0"))).toBe("");
  });
});
