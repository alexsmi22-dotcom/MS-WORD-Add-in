/**
 * The layouts the independent adversarial pass broke the first version of
 * tableFeed.ts with. Every one was a wrong number or a silent drop, in a
 * table a Word user actually has; each is now a named rule with its own test.
 */
import { feedGroups, feedSubjects, feedSurvival, feedSurvivalGroups, feedRows, feedFactorial, type TableFeedResult } from "../tableFeed";

const ok = (r: TableFeedResult): { text: string; note: string } => {
  if ("error" in r) throw new Error("unexpected error: " + r.error);
  return r;
};
const err = (r: TableFeedResult): string => {
  if (!("error" in r)) throw new Error("expected an error, got text: " + r.text);
  return r.error;
};

describe("decimal commas, Unicode minus, NBSP thousands", () => {
  it("a decimal comma is a decimal, not a thousands separator, and the note says so", () => {
    const r = ok(feedGroups([["A", "B"], ["1,5", "2,5"], ["1,7", "2,1"]]));
    expect(r.text).toBe("1.5, 1.7\n\n2.5, 2.1");
    expect(r.note).toMatch(/decimal-comma cells read as decimals \(1,5 → 1.5\)/);
  });
  it("survival time 12,5 is 12.5", () => {
    expect(ok(feedSurvival([["time", "event"], ["12,5", "1"], ["20", "0"]])).text).toBe("12.5 1\n20 0");
  });
  it("1,200 stays twelve hundred and 1,234.5 keeps its dot", () => {
    const r = ok(feedGroups([["A", "B"], ["1,200", "1,234.5"], ["1,300", "7"]]));
    expect(r.text).toBe("1200, 1300\n\n1234.5, 7");
    expect(r.note).not.toMatch(/decimal-comma/);
  });
  it("in a crosstab cell a comma is ALWAYS a separator (the note says decimals need a dot): 10,11 and 10, 11,12 are replicates", () => {
    const r = ok(feedFactorial([["", "wet", "dry"], ["low", "10,11", "10, 11,12"], ["high", "1.5", "9"]]));
    expect(r.text).toBe("low wet 10\nlow wet 11\nlow dry 10\nlow dry 11\nlow dry 12\nhigh wet 1.5\nhigh dry 9");
    expect(r.note).toMatch(/decimals in a crosstab must use a dot/);
  });
  it("a no-break-space thousands number inside a crosstab cell is one number", () => {
    const r = ok(feedFactorial([["", "wet", "dry"], ["low", "1 200", "8"], ["high", "14", "9"]]));
    expect(r.text).toBe("low wet 1200\nlow dry 8\nhigh wet 14\nhigh dry 9");
  });
  it("the German form 1.000,5 is 1000.5, and a dot before a comma in any other shape is not a number", () => {
    const r = ok(feedGroups([["A", "B"], ["1.000,5", "2"], ["1.500,25", "3"]]));
    expect(r.text).toBe("1000.5, 1500.25\n\n2, 3");
    expect(err(feedRows([["1", "2"], ["1.5,2", "3"]], "counts"))).toMatch(/must be a number/);
  });
  it("Unicode minus and a no-break-space thousands separator are numbers, not dropped", () => {
    const r = ok(feedGroups([["A", "B"], ["−5", "3"], ["-4", "1 200"], ["4", "2"]]));
    expect(r.text).toBe("-5, -4, 4\n\n3, 1200, 2");
    expect(r.note).toContain("1 = A (n 3)");
  });
});

describe("merged label cells", () => {
  it("LONG: a label merged across its rows is filled from above; the note counts the groups AND the fills", () => {
    const r = ok(feedGroups([["A", "1"], ["", "2"], ["", "3"], ["B", "4"], ["", "5"], ["", "6"]]));
    expect(r.text).toBe("1, 2, 3\n\n4, 5, 6");
    expect(r.note).toContain("1 = A (n 3)");
    expect(r.note).toContain("4 merged label cells filled");
  });
  it("ragged merged rows padded at the end (numbers shifted into column 1) are REFUSED, naming merged cells", () => {
    expect(err(feedGroups([["A", "1"], ["2", ""], ["3", ""], ["B", "4"], ["5", ""], ["6", ""]]))).toMatch(/merged cells/);
  });
  it("log-rank: merged group labels are filled", () => {
    const r = ok(
      feedSurvivalGroups([["time", "event", "arm"], ["3", "1", "Drug"], ["5", "1", ""], ["4", "0", "Placebo"], ["6", "1", ""]]),
    );
    expect(r.text).toBe("3 1\n5 1\n\n4 0\n6 1");
    expect(r.note).toContain("2 merged group cells filled");
  });
  it("two-way long form: merged factor labels are filled", () => {
    const r = ok(feedFactorial([["Fert", "Water", "H"], ["low", "wet", "10"], ["", "dry", "8"], ["high", "wet", "14"], ["", "dry", "9"]]));
    expect(r.text).toBe("low wet 10\nlow dry 8\nhigh wet 14\nhigh dry 9");
  });
});

describe("numeric ids, arms, years", () => {
  it("LONG with arms coded 1/2 under a 'Group' header: the numbers are labels", () => {
    const r = ok(feedGroups([["Group", "Value"], ["1", "5"], ["1", "6"], ["2", "7"], ["2", "8"]]));
    expect(r.text).toBe("5, 6\n\n7, 8");
    expect(r.note).toContain("1 = 1 (n 2)");
  });
  it("Friedman: a numeric Subject column is dropped (header), and a bare 1..n counter is dropped too", () => {
    const r = ok(feedSubjects([["Subject", "Before", "After"], ["1", "5", "7"], ["2", "4", "6"], ["3", "6", "9"]]));
    expect(r.text).toBe("5 7\n4 6\n6 9");
    expect(r.note).toContain("2 conditions: Before, After");
    expect(r.note).toMatch(/Subject.*dropped/);
    const bare = ok(feedSubjects([["1", "5", "7"], ["2", "4", "6"], ["3", "6", "9"]]));
    expect(bare.text).toBe("5 7\n4 6\n6 9");
  });
  it("regression: an ID column is never the response", () => {
    const r = ok(feedRows([["ID", "Yield", "Temp"], ["1", "10", "100"], ["2", "12", "110"], ["3", "15", "120"]], "regression"));
    expect(r.text).toBe("10 100\n12 110\n15 120");
    expect(r.note).toContain("response = Yield");
  });
  it("survival with three unnamed numeric columns is refused: which one is time would be a guess", () => {
    expect(err(feedSurvival([["1", "12", "1"], ["2", "20", "0"], ["3", "5", "1"]]))).toMatch(/named in a header row/);
  });
  it("wide groups without a header say that the first row was read as data", () => {
    const r = ok(feedGroups([["2019", "2020"], ["5.1", "6.3"], ["4.9", "6.8"]]));
    expect(r.note).toMatch(/No header row found/);
  });
  it("a row-counter first column in a wide table is dropped and said so", () => {
    const r = ok(feedGroups([["1", "10", "20"], ["2", "11", "21"], ["3", "12", "22"]]));
    expect(r.text).toBe("10, 11, 12\n\n20, 21, 22");
    expect(r.note).toMatch(/row counter.*dropped/);
  });
});

describe("survival column naming", () => {
  it("'Age (years)' never becomes the time column when a column is named Time", () => {
    const r = ok(feedSurvival([["Age (years)", "Time", "Event"], ["60", "12", "1"], ["70", "20", "0"], ["65", "5", "1"]]));
    expect(r.text).toBe("12 1\n20 0\n5 1");
    expect(r.note).toContain("time = Time");
  });
  it("'Treatment duration (days)' does not steal time from 'Time'", () => {
    const r = ok(feedSurvival([["Treatment duration (days)", "Time", "Status"], ["30", "12", "1"], ["45", "20", "0"]]));
    expect(r.note).toContain("time = Time");
  });
  it("a unit word alone still finds time when nothing is named Time", () => {
    expect(ok(feedSurvival([["Months", "Status"], ["12", "1"], ["20", "0"]])).note).toContain("time = Months");
  });
  it("a 'Censored' column is INVERTED: 1 = censored, so event 0", () => {
    const r = ok(feedSurvival([["Time", "Censored"], ["12", "1"], ["20", "0"], ["5", "1"]]));
    expect(r.text).toBe("12 0\n20 1\n5 0");
    expect(r.note).toMatch(/censored flag/);
  });
  it("an unrecognised status code refuses the whole table rather than dropping rows", () => {
    expect(err(feedSurvival([["time", "status"], ["12", "1"], ["20", "0"], ["5", "2"], ["8", "2"]]))).toMatch(
      /"2" is not recognised.*competing risks/,
    );
  });
  it("1.0 / 0.0 and Deceased are read", () => {
    expect(ok(feedSurvival([["time", "status"], ["12", "1.0"], ["20", "0.0"], ["5", "Deceased"]])).text).toBe("12 1\n20 0\n5 1");
  });
});

describe("crosstab header and numeric factor levels", () => {
  it("a crosstab whose first data row is all replicate lists keeps its header", () => {
    const r = ok(feedFactorial([["", "wet", "dry", "mid"], ["low", "10, 11", "8, 9", "1, 2"], ["high", "14, 15", "9, 10", "3, 4"]]));
    expect(r.text.split("\n")).toHaveLength(12);
    expect(r.note).toContain("crosstab");
  });
  it("a 2 × 2 crosstab with lists in every cell works", () => {
    const r = ok(feedFactorial([["", "wet", "dry"], ["low", "10, 11", "8, 9"], ["high", "14, 15", "9, 10"]]));
    expect(r.text.split("\n")).toHaveLength(8);
  });
  it("numeric factor levels (dose 10/20) are read in long form when a header is present", () => {
    const r = ok(feedFactorial([["Dose", "Temp", "Yield"], ["10", "20", "5"], ["10", "30", "6"], ["20", "20", "7"], ["20", "30", "8"]]));
    expect(r.text).toBe("10 20 5\n10 30 6\n20 20 7\n20 30 8");
  });
  it("a long-form row with a missing label and nothing above to fill it from is refused by row number", () => {
    // A blank BELOW a label is a merged cell and is filled; a blank in the
    // first row has nothing to inherit and is an error, named by row.
    expect(err(feedFactorial([["A", "B", "V"], ["x", "", "1"], ["y", "p", "2"], ["x", "q", "3"], ["y", "q", "4"]]))).toMatch(/Row 1/);
  });
});

// ---------------------------------------------------------------------------
// Second pass: the header-word heuristics added by the first round of fixes
// were themselves a source of silent re-mappings. A header word now needs the
// column's CONTENT to agree before it changes what a column is.

describe("second pass: header words never reclassify a column on their own", () => {
  it("'Sample A | Sample B | Sample C' are three groups, not an id column plus two", () => {
    const r = ok(feedGroups([["Sample A", "Sample B", "Sample C"], ["1", "2", "3"], ["1.1", "2.1", "3.1"], ["0.9", "1.9", "2.9"]]));
    expect(r.text).toBe("1, 1.1, 0.9\n\n2, 2.1, 1.9\n\n3, 2.1, 2.9".replace("2.1, 1.9\n\n3, 2.1, 2.9", "2.1, 1.9\n\n3, 3.1, 2.9"));
    expect(r.note).toContain("1 = Sample A (n 3)");
    expect(r.note).not.toMatch(/dropped/);
  });
  it("Friedman: 'Trial 1 | Trial 2 | Trial 3' are three conditions", () => {
    const r = ok(feedSubjects([["Trial 1", "Trial 2", "Trial 3"], ["5", "6", "7"], ["4", "4", "6"], ["6", "7", "9"]]));
    expect(r.note).toContain("3 conditions: Trial 1, Trial 2, Trial 3");
  });
  it("regression: 'Run time' with non-integer values is the response, not an id", () => {
    const r = ok(feedRows([["Run time", "Size", "Threads"], ["1.2", "10", "1"], ["2.5", "20", "2"], ["4.1", "40", "4"]], "regression"));
    expect(r.note).toContain("response = Run time");
    expect(r.text).toBe("1.2 10 1\n2.5 20 2\n4.1 40 4");
  });
  it("a bare 'ID' header over 1..n integers IS dropped (content agrees)", () => {
    const r = ok(feedRows([["ID", "Yield", "Temp"], ["1", "10", "100"], ["2", "12", "110"], ["3", "15", "120"]], "regression"));
    expect(r.note).toContain("response = Yield");
  });
  it("'Case fatality | Survival' with decimal values is two WIDE groups, not label + value", () => {
    const r = ok(feedGroups([["Case fatality", "Survival"], ["0.1", "5"], ["0.2", "6"], ["0.1", "7"], ["0.2", "8"]]));
    expect(r.text).toBe("0.1, 0.2, 0.1, 0.2\n\n5, 6, 7, 8");
    expect(r.note).toContain("1 = Case fatality (n 4)");
  });
  it("'Group | Value' with integer arms that repeat is still label + value", () => {
    const r = ok(feedGroups([["Group", "Value"], ["1", "5"], ["1", "6"], ["2", "7"], ["2", "8"]]));
    expect(r.text).toBe("5, 6\n\n7, 8");
  });
  it("a 2 × 2 'Case | Control' contingency table without row labels keeps both columns", () => {
    const r = ok(feedRows([["Case", "Control"], ["10", "20"], ["5", "30"]], "counts"));
    expect(r.text).toBe("10 20\n5 30");
  });
  it("an n/a placeholder in the first column of a 2-column wide table is a blank, not 'merged cells'", () => {
    const r = ok(feedGroups([["Control", "Treated"], ["5", "6"], ["n/a", "7"], ["4", "8"]]));
    expect(r.text).toBe("5, 4\n\n6, 7, 8");
  });
});

describe("second pass: survival headers and the crosstab/long tiebreak", () => {
  it("log-rank groups by 'Arm', not by 'Treatment duration (days)'", () => {
    const r = ok(
      feedSurvivalGroups([
        ["Treatment duration (days)", "Time", "Status", "Arm"],
        ["30", "12", "1", "A"],
        ["45", "20", "0", "B"],
        ["30", "5", "1", "A"],
        ["45", "8", "1", "B"],
      ]),
    );
    expect(r.note).toContain("1 = A (n 2)");
    expect(r.note).toContain("time = Time");
    expect(r.text).toBe("12 1\n5 1\n\n20 0\n8 1");
  });
  it("'Progression-free survival (months) | Event' reads PFS as time", () => {
    const r = ok(feedSurvival([["Progression-free survival (months)", "Event"], ["12", "1"], ["20", "0"]]));
    expect(r.note).toContain("time = Progression-free survival (months)");
    expect(r.text).toBe("12 1\n20 0");
  });
  it("'Survival status | Time (months)' reads status as the event", () => {
    const r = ok(feedSurvival([["Survival status", "Time (months)"], ["1", "12"], ["0", "20"]]));
    expect(r.text).toBe("12 1\n20 0");
    expect(r.note).toContain("event = Survival status");
  });
  it("'Days to death | Dead' reads the first as time and the second as the event", () => {
    const r = ok(feedSurvival([["Days to death", "Dead"], ["12", "yes"], ["20", "no"]]));
    expect(r.text).toBe("12 1\n20 0");
  });
  it("'Event time | Status' reads event time as time", () => {
    expect(ok(feedSurvival([["Event time", "Status"], ["12", "1"], ["20", "0"]])).note).toContain("time = Event time");
  });
  it("a blank-corner crosstab with replicates on separate rows (repeated row labels) is a CROSSTAB", () => {
    const r = ok(feedFactorial([["", "wet", "dry"], ["low", "10", "8"], ["low", "11", "9"], ["high", "14", "9"], ["high", "15", "10"]]));
    expect(r.text).toBe("low wet 10\nlow dry 8\nlow wet 11\nlow dry 9\nhigh wet 14\nhigh dry 9\nhigh wet 15\nhigh dry 10");
    expect(r.note).toContain("crosstab");
  });
  it("'Dose | Temp | Yield' with both factor columns repeating is LONG", () => {
    const r = ok(feedFactorial([["Dose", "Temp", "Yield"], ["10", "20", "5"], ["10", "30", "6"], ["20", "20", "7"], ["20", "30", "8"]]));
    expect(r.text).toBe("10 20 5\n10 30 6\n20 20 7\n20 30 8");
  });
});
