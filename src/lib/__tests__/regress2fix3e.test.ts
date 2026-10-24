// Round-2 regression fixes (fix3e) on top of 2c2e68e: each pins the behaviour that was right on base (69a5275) AND
// the 2c2e68e fix's own intent. Items: 4 numeral ranges, 5 counts margins, 7 state-code sections.
import { extractNumerals } from "../numerals";
import { feedRows } from "../tableFeed";
import { buildTableOfAuthorities } from "../toa";

const rows = (text: string, heading: string): string[] =>
  buildTableOfAuthorities(text)
    .groups.filter((g) => g.heading === heading)
    .flatMap((g) => g.entries.map((e) => e.plain));

// ---------------------------------------------------------------------------------------------------------------
describe("item 4: real range callouts are found again; citation and quantity ranges still are not", () => {
  const T = [20, 22, 24, 30, 32, 34, 40, 42, 44, 102, 104, 106, 108];
  test.each([
    ["fluid lines (20–24)", [20, 22, 24]],
    ["support columns (30-34)", [30, 32, 34]],
    ["tube sections (40–44)", [40, 42, 44]],
    ["steps (102–108)", [102, 104, 106, 108]],
    ["examples (102-108)", [102, 104, 106, 108]],
    ["brackets (30–34) L-shaped", [30, 32, 34]],
    ["walls (30–34) V-shaped", [30, 32, 34]],
    ["pipes (20-24) s-bend", [20, 22, 24]],
    ["the bars (30–34) M", [30, 32, 34]],
    ["panels (30–34) units", [30, 32, 34]],
    ["rollers (30–34) times", [30, 32, 34]],
    ["each of (30–34)", [30, 32, 34]],
    ["the frame; (30-34) walls", [30, 32, 34]],
    ["the frame. (30-34) walls", [30, 32, 34]],
    ["(30–34) extend", [30, 32, 34]],
    ["lines (20, 22–24)", [20, 22, 24]],
  ] as Array<[string, number[]]>)("%p → %p (base)", (text, want) => {
    expect(extractNumerals(text, T)).toEqual(want);
  });

  const K = [10, 12, 14, 16, 20, 100, 102, 200, 1000];
  test.each([
    ["see claims (1-20)", []],
    ["(10–200) particles", []],
    ["comprising (10–200) particles", []],
    ["as recited in claims (12-16)", []],
    ["pages (10–12) of the record", []],
    ["the gap is (10–20) mm wide", []],
    ["about (12-16) of them", []],
    ["col. 3, lines (12-16)", []],
    ["¶ (12–16)", []],
  ] as Array<[string, number[]]>)("2c2e68e intent kept: %p marks nothing", (text, want) => {
    expect(extractNumerals(text, K)).toEqual(want);
  });
  test.each([
    ["even 10…1000", Array.from({ length: 496 }, (_, i) => 10 + 2 * i)],
    ["tens 10…1000", Array.from({ length: 100 }, (_, i) => 10 * (i + 1))],
  ])("a dense table (%s): (10–200) is still a quantity", (_n, dense) => {
    expect(extractNumerals("(10–200) particles", dense as number[])).toEqual([]);
    expect(extractNumerals("comprising (10–200) particles", dense as number[])).toEqual([]);
  });
  test("a single member beside a vetoed range keeps the plain rule", () => {
    expect(extractNumerals("see claims (12, 14-16)", K)).toEqual([12]);
  });
  test("a table spaced by tens: a full range still calls out", () => {
    expect(extractNumerals("arms (100–130)", [100, 110, 120, 130])).toEqual([100, 110, 120, 130]);
  });
  test("no table: a range calls out its ends unless a unit or citation word says otherwise", () => {
    expect(extractNumerals("walls (30-34) L-shaped")).toEqual([30, 34]);
    expect(extractNumerals("a gap of (30-34) mm")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("item 5: counts margins", () => {
  const ok = (r: ReturnType<typeof feedRows>): { text: string; note: string } => {
    if ("error" in r) throw new Error(r.error);
    return { text: r.text, note: r.note ?? "" };
  };
  const err = (r: ReturnType<typeof feedRows>): string => ("error" in r ? r.error : `no error: ${r.text}`);

  test("a Total row under a single data row is a margin: too few rows, refused (base)", () => {
    expect(err(feedRows([["", "A", "B"], ["a", "5", "3"], ["Total", "5", "3"]], "counts"))).toMatch(/at least two rows/);
  });
  test("a last Total column beside one data column is a margin: refused, no wrong note (base)", () => {
    expect(err(feedRows([["", "A", "Total"], ["a", "5", "5"], ["b", "3", "3"]], "counts"))).toMatch(/two numeric columns/);
  });
  test("a Total row with a blank or dash cell is still dropped (base)", () => {
    const f = ok(feedRows([["", "Yes", "No", "Total"], ["A", "30", "20", "50"], ["B", "25", "25", "50"], ["Total", "55", "—", ""]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
    expect(f.note).toMatch(/Marginal totals are not data/);
  });
  test("a Total column with one blank cell is still dropped (base)", () => {
    const f = ok(feedRows([["", "Yes", "No", "Total"], ["A", "30", "20", ""], ["B", "25", "25", "50"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
  });
  test("a % row after the Total row: both dropped, the % one as not a count", () => {
    const f = ok(feedRows([["", "Yes", "No"], ["A", "30", "20"], ["B", "25", "25"], ["Total", "55", "45"], ["%", "55%", "45%"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
    expect(f.note).toMatch(/Percentages are not counts, so the % row was dropped/);
    expect(f.note).toMatch(/Marginal totals are not data, so the Total row was dropped/);
  });
  test.each(["Percent", "Row %", "Col %"])("a %p column is dropped", (lab) => {
    const f = ok(feedRows([["", "Yes", "No", lab], ["A", "30", "20", "60"], ["B", "25", "25", "50"]], "counts"));
    expect(f.text).toBe("30 20\n25 25");
    expect(f.note).toMatch(/Percentages are not counts/);
  });
  test("several middle rows labelled Total give one note", () => {
    const f = ok(feedRows([["", "x", "y"], ["a", "3", "4"], ["Total", "8", "10"], ["b", "5", "6"], ["Total", "1", "1"], ["c", "2", "2"]], "counts"));
    expect(f.note.match(/The Total row was read as data/g)).toHaveLength(1);
  });
  test("kept: an Overall group not in last position is data", () => {
    const f = ok(feedRows([["", "Yes", "No"], ["Overall", "12", "8"], ["Control", "5", "15"]], "counts"));
    expect(f.text).toBe("12 8\n5 15");
  });
  test("kept: unlabelled margins dropped only when both margins and the corner agree", () => {
    expect(ok(feedRows([["30", "20", "50"], ["25", "25", "50"], ["55", "45", "100"]], "counts")).text).toBe("30 20\n25 25");
    expect(ok(feedRows([["30", "20", "50"], ["25", "25", "50"], ["55", "45", "99"]], "counts")).text.split("\n")).toHaveLength(3);
    expect(ok(feedRows([["x", "1", "2"], ["y", "1", "0"], ["z", "2", "2"]], "counts")).text).toBe("1 2\n1 0\n2 2");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("item 7: state-code sections", () => {
  test("plain-number code: §§ with a hyphen and with an en dash merge into one entry (base)", () => {
    expect(rows("Cal. Civ. Code §§ 1714-1715. Later, Cal. Civ. Code §§ 1714–1715.", "Statutes")).toEqual(["Cal. Civ. Code §§ 1714–1715"]);
  });
  test("plain-number code: a single § over a hyphenated pair is a range (base)", () => {
    expect(rows("Cal. Civ. Code § 1714-1716.", "Statutes")).toEqual(["Cal. Civ. Code § 1714-1716"]); // one § is one section (Rule 3.3)
  });
  test("a colon not followed by a digit is not part of the section", () => {
    expect(rows("Cal. Civ. Code § 1714:a", "Statutes")).toEqual(["Cal. Civ. Code § 1714"]);
  });
  test.each([
    ["Ga. Code Ann. § 9-11-12.", "Ga. Code Ann. § 9-11-12"],
    ["Ariz. Rev. Stat. Ann. § 12-341.", "Ariz. Rev. Stat. Ann. § 12-341"],
    ["Va. Code Ann. § 8.01-243.", "Va. Code Ann. § 8.01-243"],
    ["N.C. Gen. Stat. § 1-52.", "N.C. Gen. Stat. § 1-52"],
    ["N.J. Stat. Ann. § 2A:14-1.", "N.J. Stat. Ann. § 2A:14-1"],
    ["N.H. Rev. Stat. Ann. § 508:4.", "N.H. Rev. Stat. Ann. § 508:4"],
  ])("2c2e68e intent kept: %p → %p", (text, want) => {
    expect(rows(text, "Statutes")).toEqual([want]);
  });
});
