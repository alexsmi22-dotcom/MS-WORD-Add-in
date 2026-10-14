import {
  feedGroups,
  feedSubjects,
  feedSurvival,
  feedSurvivalGroups,
  feedRows,
  feedFactorial,
  feedTable,
  type TableFeedResult,
} from "../tableFeed";

const ok = (r: TableFeedResult): { text: string; note: string } => {
  if ("error" in r) throw new Error("unexpected error: " + r.error);
  return r;
};
const err = (r: TableFeedResult): string => {
  if (!("error" in r)) throw new Error("expected an error, got text: " + r.text);
  return r.error;
};

describe("feedGroups — independent groups", () => {
  it("WIDE: one column per group with a header; blanks skipped (ragged groups)", () => {
    const r = ok(
      feedGroups([
        ["Control", "Low dose", "High dose"],
        ["5.1", "6.3", "7.9"],
        ["4.9", "6.8", ""],
        ["6.2", "", "8.4"],
      ]),
    );
    expect(r.text).toBe("5.1, 4.9, 6.2\n\n6.3, 6.8\n\n7.9, 8.4");
    expect(r.note).toContain("1 = Control (n 3)");
    expect(r.note).toContain("3 = High dose (n 2)");
  });

  it("WIDE without a header still works, and drops a leading label column", () => {
    const r = ok(
      feedGroups([
        ["rep 1", "10", "20"],
        ["rep 2", "11", "21"],
        ["rep 3", "12", "22"],
      ]),
    );
    expect(r.text).toBe("10, 11, 12\n\n20, 21, 22");
    expect(r.note).toContain("column 2");
  });

  it("LONG: label + value, grouped in order of first appearance, with the names in the note only", () => {
    const r = ok(
      feedGroups([
        ["Group", "Value"],
        ["B", "2"],
        ["A", "1"],
        ["B", "3"],
        ["A", "1.5"],
      ]),
    );
    expect(r.text).toBe("2, 3\n\n1, 1.5");
    expect(r.note).toContain("1 = B");
    expect(r.note).toContain("2 = A");
  });

  it("a label that CONTAINS a number never leaks into the values", () => {
    const r = ok(
      feedGroups([
        ["Dose 10 mg", "4"],
        ["Dose 10 mg", "5"],
        ["Dose 20 mg", "6"],
        ["Dose 20 mg", "7"],
      ]),
    );
    expect(r.text).toBe("4, 5\n\n6, 7");
    expect(r.text).not.toMatch(/10|20/);
  });

  it("thousands separators and percent signs are numbers", () => {
    const r = ok(feedGroups([["A", "B"], ["1,200", "45%"], ["1,300", "50%"]]));
    expect(r.text).toBe("1200, 1300\n\n45, 50");
  });

  it("refuses a single column, naming the layouts that work", () => {
    expect(err(feedGroups([["x"], ["1"], ["2"], ["3"]]))).toMatch(/one column per group/);
  });

  it("refuses LONG with only one label", () => {
    expect(err(feedGroups([["A", "1"], ["A", "2"], ["A", "3"]]))).toMatch(/Only one group label/);
  });

  it("refuses an empty table", () => {
    expect(err(feedGroups([]))).toMatch(/empty/);
    expect(err(feedGroups([["", ""]]))).toMatch(/empty/);
  });
});

describe("feedSubjects — repeated measures", () => {
  it("one row per subject, header and subject-label column dropped", () => {
    const r = ok(
      feedSubjects([
        ["Subject", "Before", "During", "After"],
        ["S1", "5", "6", "7"],
        ["S2", "4", "4", "6"],
        ["S3", "6", "7", "9"],
      ]),
    );
    expect(r.text).toBe("5 6 7\n4 4 6\n6 7 9");
    expect(r.note).toContain("3 subject rows × 3 conditions: Before, During, After");
  });
  it("refuses a blank cell — a ragged repeated-measures design would be padded otherwise", () => {
    expect(err(feedSubjects([["5", "6"], ["4", ""], ["6", "7"]]))).toMatch(/every condition column/);
  });
  it("refuses fewer than two conditions", () => {
    expect(err(feedSubjects([["S1", "5"], ["S2", "4"]]))).toMatch(/two condition columns/);
  });
});

describe("feedSurvival — time and event", () => {
  it("finds columns by header name, in either order", () => {
    const r = ok(
      feedSurvival([
        ["Status", "Months"],
        ["1", "12"],
        ["0", "20"],
        ["1", "5"],
      ]),
    );
    expect(r.text).toBe("12 1\n20 0\n5 1");
    expect(r.note).toContain("time = Months");
    expect(r.note).toContain("event = Status");
  });
  it("without a header, time first then the 1/0 flag", () => {
    expect(ok(feedSurvival([["12", "1"], ["20", "0"], ["5", "1"]])).text).toBe("12 1\n20 0\n5 1");
  });
  it("accepts yes/no, TRUE/FALSE and censored/event as flags", () => {
    const r = ok(feedSurvival([["time", "event"], ["3", "yes"], ["4", "FALSE"], ["5", "censored"], ["6", "event"]]));
    expect(r.text).toBe("3 1\n4 0\n5 0\n6 1");
  });
  it("names an ignored group column and points at Log-rank", () => {
    const r = ok(feedSurvival([["time", "event", "arm"], ["3", "1", "A"], ["4", "0", "B"], ["5", "1", "A"]]));
    expect(r.note).toMatch(/arm column was ignored.*Log-rank/);
  });
  it("refuses a table with no event column", () => {
    expect(err(feedSurvival([["time", "weight"], ["3", "70.5"], ["4", "80.2"]]))).toMatch(/event column/);
  });
});

describe("feedSurvivalGroups — log-rank", () => {
  it("blocks per group label, in first-appearance order", () => {
    const r = ok(
      feedSurvivalGroups([
        ["time", "event", "arm"],
        ["3", "1", "Drug"],
        ["4", "0", "Placebo"],
        ["5", "1", "Drug"],
        ["6", "1", "Placebo"],
      ]),
    );
    expect(r.text).toBe("3 1\n5 1\n\n4 0\n6 1");
    expect(r.note).toContain("1 = Drug (n 2)");
    expect(r.note).toContain("2 = Placebo (n 2)");
  });
  it("refuses without a group column", () => {
    expect(err(feedSurvivalGroups([["time", "event"], ["3", "1"], ["4", "0"]]))).toMatch(/group column/);
  });
});

describe("feedRows — numeric blocks", () => {
  it("regression: response first then predictors, names from the header", () => {
    const r = ok(
      feedRows(
        [
          ["Yield", "Temp", "Time"],
          ["10", "100", "5"],
          ["12", "110", "5"],
          ["15", "120", "6"],
        ],
        "regression",
      ),
    );
    expect(r.text).toBe("10 100 5\n12 110 5\n15 120 6");
    expect(r.note).toContain("response = Yield; predictors = Temp, Time");
  });
  it("counts: header row and row labels dropped", () => {
    const r = ok(
      feedRows(
        [
          ["", "Yes", "No"],
          ["Treated", "10", "20"],
          ["Control", "30", "40"],
        ],
        "counts",
      ),
    );
    expect(r.text).toBe("10 20\n30 40");
    expect(r.note).toContain("2 × 2 table of counts");
    expect(r.note).toMatch(/row labels.*dropped/);
  });
  it("refuses a word in a numeric cell rather than silently dropping it (a shifted column is a wrong answer)", () => {
    expect(err(feedRows([["1", "2"], ["3", "n/a"], ["5", "6"]], "counts"))).toMatch(/must be a number/);
  });
});

describe("feedFactorial — two factors", () => {
  it("LONG: A B value; level names with spaces are made single tokens", () => {
    const r = ok(
      feedFactorial([
        ["Fertiliser", "Water", "Height"],
        ["Low dose", "wet", "10"],
        ["Low dose", "dry", "8"],
        ["High dose", "wet", "14"],
        ["High dose", "dry", "9"],
      ]),
    );
    expect(r.text).toBe("Low_dose wet 10\nLow_dose dry 8\nHigh_dose wet 14\nHigh_dose dry 9");
    expect(r.note).toContain("Fertiliser × Water → Height");
  });
  it("CROSSTAB: row labels are A, header is B, cells may hold replicate lists", () => {
    const r = ok(
      feedFactorial([
        ["", "wet", "dry"],
        ["low", "10, 11", "8"],
        ["high", "14", "9; 10"],
      ]),
    );
    expect(r.text).toBe("low wet 10\nlow wet 11\nlow dry 8\nhigh wet 14\nhigh dry 9\nhigh dry 10");
    expect(r.note).toContain("crosstab");
  });
  it("refuses a crosstab cell that is not numeric", () => {
    expect(err(feedFactorial([["", "wet", "dry"], ["low", "10", "x"], ["high", "14", "9"]]))).toMatch(/not a number/);
  });
  it("refuses a layout it cannot read, naming both that work", () => {
    expect(err(feedFactorial([["1", "2"], ["3", "4"]]))).toMatch(/three columns.*crosstab/);
  });
});

describe("feedTable dispatch", () => {
  it("routes every shape", () => {
    expect("text" in feedTable("groups", [["a", "b"], ["1", "2"], ["3", "4"]])).toBe(true);
    expect("text" in feedTable("subjects", [["1", "2"], ["3", "4"]])).toBe(true);
    expect("text" in feedTable("survival", [["1", "1"], ["2", "0"]])).toBe(true);
    expect("error" in feedTable("survival-groups", [["1", "1"], ["2", "0"]])).toBe(true);
    expect("text" in feedTable("rows", [["1", "2"], ["3", "4"]])).toBe(true);
    expect("text" in feedTable("counts", [["1", "2"], ["3", "4"]])).toBe(true);
    expect("error" in feedTable("factorial", [["1", "2"], ["3", "4"]])).toBe(true);
  });
});
