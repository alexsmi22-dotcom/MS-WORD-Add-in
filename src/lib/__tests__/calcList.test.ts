// Finance and Bio/Assay list fields under the product comma rule (calcList.ts): every default reads exactly as
// the old split did, and only ambiguous or wrong typing changes.
import { readFileSync } from "fs";
import { join } from "path";
import { ListTokenError, readCalcList } from "../calcList";

/** The old reader, kept here as the reference the defaults must still agree with. */
const oldList = (s: string): number[] =>
  s
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

const pane = readFileSync(join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
/** The list-field defaults of one calculator table in the pane's source. */
function listDefaults(table: string): string[] {
  const start = pane.indexOf(`const ${table}`);
  const end = pane.indexOf("\n];", start);
  expect(start).toBeGreaterThan(0);
  const body = pane.slice(start, end);
  return [...body.matchAll(/default: "([^"]*)", kind: "list"/g)].map((m) => m[1]);
}

describe("readCalcList", () => {
  for (const table of ["FIN_CALCS", "ASSAY_CALCS"]) {
    it(`every ${table} list default reads as before, with no note`, () => {
      const defaults = listDefaults(table);
      expect(defaults.length).toBeGreaterThan(table === "FIN_CALCS" ? 3 : 10);
      for (const d of defaults) expect(readCalcList(d)).toEqual({ values: oldList(d), note: "" });
    });
  }

  it("decimal commas between spaced values are decimals, and said", () => {
    const r = readCalcList("1,5 2,3 3,1");
    expect(r.values).toEqual([1.5, 2.3, 3.1]);
    expect(r.note).toBe("3 decimal commas read as decimals (1,5 → 1.5).");
  });

  it("a comma list stays a list", () => {
    expect(readCalcList("-1000, 500, 500").values).toEqual([-1000, 500, 500]);
    expect(readCalcList("1,2,3").values).toEqual([1, 2, 3]);
    expect(readCalcList("4;5;6").values).toEqual([4, 5, 6]);
  });

  it("a token that is not a number is refused by name, never dropped", () => {
    expect(() => readCalcList("-1000, 5OO, 500")).toThrow(ListTokenError);
    expect(() => readCalcList("-1000, 5OO, 500")).toThrow("“5OO” is not a number");
    expect(() => readCalcList("a b c d e")).toThrow("“a”, “b”, “c” and 2 more are not numbers");
  });

  it("the true minus sign is a minus", () => {
    expect(readCalcList("−1000, 500").values).toEqual([-1000, 500]);
  });
});

// v2.201.1 (found by the F1 IP-valuation builder): grouped thousands in a semicolon- or space-separated list were split
// at every comma — "3,500,000; 5,000,000; 8,000,000" was nine cash flows (3, 500, 0, 5, 0, 0, 8, 0, 0), silently.
describe("grouped thousands in a list", () => {
  test("semicolons, spaces and comma-space separate whole grouped numbers", () => {
    expect(readCalcList("3,500,000; 5,000,000; 8,000,000").values).toEqual([3500000, 5000000, 8000000]);
    expect(readCalcList("3,500,000 8,000,000").values).toEqual([3500000, 8000000]);
    expect(readCalcList("−1,250,000, 300,000, 1,400,000.50").values).toEqual([-1250000, 300000, 1400000.5]);
    expect(readCalcList("-1,000,000\n250,000\n1,000,000").values).toEqual([-1000000, 250000, 1000000]);
  });
  test("comma lists without spaces still split", () => {
    expect(readCalcList("1,2,3").values).toEqual([1, 2, 3]);
    expect(readCalcList("1000,2000,3000").values).toEqual([1000, 2000, 3000]);
    expect(readCalcList("1,2,3 4,5,6").values).toEqual([1, 2, 3, 4, 5, 6]);
  });
  test("a lone run that reads both ways is refused naming both readings", () => {
    expect(() => readCalcList("100,200,300")).toThrow(/the numbers 100, 200, 300, or one number grouped in thousands \(100200300\)/);
  });
  test("thousands commas beside decimal commas are refused", () => {
    expect(() => readCalcList("3,500,000 2,5")).toThrow(/writes decimal commas elsewhere/);
  });
});
