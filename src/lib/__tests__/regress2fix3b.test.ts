// Round-2 regression fixes (fix3b): each pins the behaviour that was right on e34ce0b (live v2.193.0) AND the
// round-2 fix's own intent. Item 1 (chapter-numbered captions) is pinned in captionsPane.dom.test.ts.
import { extractNumerals } from "../numerals";
import { feedRows } from "../tableFeed";
import { buildTableOfAuthorities } from "../toa";

const rows = (text: string, heading: string): string[] =>
  buildTableOfAuthorities(text)
    .groups.filter((g) => g.heading === heading)
    .flatMap((g) => g.entries.map((e) => e.plain));

// ---------------------------------------------------------------------------------------------------------------
describe("item 3: table feed counts keep real data; only true margins are dropped", () => {
  const ok = (r: ReturnType<typeof feedRows>): { text: string; note: string } => {
    if ("error" in r) throw new Error(r.error);
    return { text: r.text, note: r.note ?? "" };
  };
  test("a FIRST row labelled Overall is a category, not a margin (base 2×2)", () => {
    const f = ok(feedRows([["", "Yes", "No"], ["Overall", "12", "8"], ["Control", "5", "15"]], "counts"));
    expect(f.text).toBe("12 8\n5 15");
    expect(f.note).toMatch(/The Overall row was read as data/);
    expect(f.note).not.toMatch(/Marginal totals/);
  });
  test.each(["All", "Total", "Sum"])("a middle row labelled %p stays data", (lab) => {
    const f = ok(feedRows([["", "x", "y"], ["a", "3", "4"], [lab, "8", "10"], ["b", "5", "6"]], "counts"));
    expect(f.text).toBe("3 4\n8 10\n5 6");
  });
  test("a column labelled Total that is not the last stays data", () => {
    const f = ok(feedRows([["", "Total", "x", "y"], ["a", "7", "3", "4"], ["b", "11", "5", "6"]], "counts"));
    expect(f.text).toBe("7 3 4\n11 5 6");
    expect(f.note).toMatch(/The Total column was read as data/);
  });
  test("an unlabelled row equal to the column sums, with no sum column beside it, is data (base 3×2)", () => {
    const f = ok(feedRows([["x", "1", "2"], ["y", "1", "0"], ["z", "2", "2"]], "counts"));
    expect(f.text).toBe("1 2\n1 0\n2 2");
    expect(f.note).toMatch(/last row equals the sum of the rows above it; it was read as data/);
  });
  test("a coincidental sum column, with no sum row below it, is data", () => {
    const f = ok(feedRows([["1", "2", "3"], ["4", "1", "5"]], "counts"));
    expect(f.text).toBe("1 2 3\n4 1 5");
    expect(f.note).toMatch(/last column equals the sum of the columns before it; it was read as data/);
  });
  test("round-2 intent kept: both unlabelled margins agreeing with the grand total are dropped", () => {
    const f = ok(feedRows([["30", "20", "50"], ["25", "25", "50"], ["55", "45", "100"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
  });
  test("both margins but a wrong grand total: kept as data", () => {
    const f = ok(feedRows([["30", "20", "50"], ["25", "25", "50"], ["55", "45", "99"]], "counts"));
    expect(f.text.split("\n")).toHaveLength(3);
  });
  test("round-2 intent kept: labelled Total row and column at the end are dropped", () => {
    const f = ok(feedRows([["", "Yes", "No", "Total"], ["A", "30", "20", "50"], ["B", "25", "25", "50"], ["Total", "55", "45", "100"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
    expect(f.note).toMatch(/Marginal totals are not data/);
  });
  test("a labelled Total column is the other margin for an unlabelled sum row", () => {
    const f = ok(feedRows([["Yes", "No", "Total"], ["30", "20", "50"], ["25", "25", "50"], ["55", "45", "100"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("item 4: a parenthesised range is a callout only between two known numerals, in callout position", () => {
  const K = [10, 12, 14, 16, 20, 100, 102, 200, 1000];
  test.each([
    ["see claims (1-20)", []],
    ["(10–200) particles", []],
    ["comprising (10–200) particles", []],
    ["as recited in claims (12-16)", []],
    ["pages (10–12) of the record", []],
    ["the gap is (10–20) mm wide", []],
    ["As shown. (12-16) are walls", []],
  ] as Array<[string, number[]]>)("%p marks nothing (base: none)", (text, want) => {
    expect(extractNumerals(text, K)).toEqual(want);
  });
  test("an unknown end with a table: the range calls out nothing (not even its known end)", () => {
    expect(extractNumerals("walls (1-20) and (12)", K)).toEqual([12]);
  });
  test("single callouts after a stop word keep the base behaviour", () => {
    expect(extractNumerals("claim (12)", K)).toEqual([12]);
  });
  test("round-2 intent kept: genuine range callouts", () => {
    expect(extractNumerals("walls (12–16) extend", K)).toEqual([12, 14, 16]);
    expect(extractNumerals("the walls (12, 14–16) in FIG. 3", K)).toEqual([12, 14, 16]);
    expect(extractNumerals("walls (30-34) and (36)")).toEqual([30, 34, 36]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("item 5: state-code sections keep their hyphens and colons as one section", () => {
  test.each([
    ["Ga. Code Ann. § 9-11-12.", "Ga. Code Ann. § 9-11-12"],
    ["Ariz. Rev. Stat. Ann. § 12-341.", "Ariz. Rev. Stat. Ann. § 12-341"],
    ["N.J. Stat. Ann. § 2A:14-1.", "N.J. Stat. Ann. § 2A:14-1"],
    ["N.J. Stat. Ann. § 2A:14-1: the limit.", "N.J. Stat. Ann. § 2A:14-1"],
    ["Cal. Civ. Proc. Code § 425.16.", "Cal. Civ. Proc. Code § 425.16"],
  ])("%p → %p", (text, want) => {
    expect(rows(text, "Statutes")).toEqual([want]);
  });
  test("a written §§ keeps its sign", () => {
    expect(rows("Ga. Code Ann. §§ 9-11-12.", "Statutes")).toEqual(["Ga. Code Ann. §§ 9-11-12"]);
  });
  test("federal ranges unchanged: 35 U.S.C. §§ 101-103 still prints the en dash", () => {
    expect(rows("35 U.S.C. §§ 101-103.", "Statutes").join(" | ")).toMatch(/§§ 101–103/);
  });
});
