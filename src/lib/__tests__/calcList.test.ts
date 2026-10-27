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

// F1 (found by builder B, 2026-10-27): thousands grouped with plain spaces between semicolons were split at the space —
// "−1 000; 300; 400" was −1, 0, 300, 400, silently.
describe("space-grouped thousands in a list", () => {
  test("a number grouped with spaces (a later group starting with 0) is refused, whatever the separators", () => {
    expect(() => readCalcList("−1 000; 300; 400")).toThrow(/“−1 000” is one number grouped in thousands with spaces \(−1000\)/);
    expect(() => readCalcList("3 500 000, 400")).toThrow(/\(3500000\)/);
    expect(() => readCalcList("1 000 000")).toThrow(/\(1000000\)/);
    expect(() => readCalcList("1  000; 2")).toThrow(/\(1000\)/);
    expect(() => readCalcList("−1 000,300")).toThrow(/\(−1000\)/);
    expect(() => readCalcList("−1 000 300")).toThrow(/\(−1000300\)/);
    expect(() => readCalcList("1 000,50 2 000,25")).toThrow(/\(1000\)/);
    expect(() => readCalcList("100; 2 050.50")).toThrow(/\(2050\)/);
  });
  test("lists of ordinary values still read", () => {
    expect(readCalcList("-1000 300 400").values).toEqual([-1000, 300, 400]);
    expect(readCalcList("-1000; 300; 400").values).toEqual([-1000, 300, 400]);
    expect(readCalcList("5 100 200").values).toEqual([5, 100, 200]);
    expect(readCalcList("1; 22 33; 4").values).toEqual([1, 22, 33, 4]);
    expect(readCalcList("-1000, 300 400 500").values).toEqual([-1000, 300, 400, 500]);
    expect(readCalcList("5, 10 100").values).toEqual([5, 10, 100]);
    expect(readCalcList("1; 22 333").values).toEqual([1, 22, 333]);
    expect(readCalcList("100, 200\t300").values).toEqual([100, 200, 300]);
    expect(readCalcList("1.5 000.5").values).toEqual([1.5, 0.5]);
  });
  // F1 review round 2: the exponent's digit started the match, so "1e3 050" was refused quoting “3 050”, the middle of a
  // token; a tab-grouped run said "spaces" only
  test("a run never starts mid-token (after a letter or an exponent sign); a tab is named", () => {
    for (const s of ["1e3 050", "1E3 050", "1.5e3 050", "1.5e-3 050", "1e+3 050", "1e−3 050"]) {
      let msg = "";
      try {
        readCalcList(s);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect([s, msg]).not.toEqual([s, expect.stringContaining("3 050")]);
    }
    expect(readCalcList("1e3 050").values).toEqual([1000, 50]);
    expect(readCalcList("1.5e3 050").values).toEqual([1500, 50]);
    expect(() => readCalcList("1\t000; 2")).toThrow(/grouped in thousands with spaces or tabs \(1000\), but a space or tab also separates list values/);
    expect(() => readCalcList("1 000; 2")).toThrow(/grouped in thousands with spaces \(1000\), but a space also separates/);
  });
});
