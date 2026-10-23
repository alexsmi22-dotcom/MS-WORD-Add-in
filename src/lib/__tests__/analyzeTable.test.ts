// Release E: the text-table result block (a header row, then rows) — its preview/plain-text layout.
import { analyzeBlocksToText, formatTextTable } from "../analyzeBlocks";

describe("formatTextTable", () => {
  test("columns align to the widest cell, counting characters not UTF-16 units", () => {
    expect(formatTextTable([["Member", "Force (kN)"], ["AB", "−12.5"], ["BC₂", "3"]])).toBe(
      ["Member  Force (kN)", "AB      −12.5", "BC₂     3"].join("\n"),
    );
  });
  test("ragged rows are padded, trailing spaces trimmed", () => {
    expect(formatTextTable([["a", "b", "c"], ["dd"]])).toBe(["a   b  c", "dd"].join("\n"));
  });
  test("an empty table is an empty string", () => {
    expect(formatTextTable([])).toBe("");
  });
});

describe("a table block in a result", () => {
  test("its label and rows reach the plain text (what the insert guard scans)", () => {
    const text = analyzeBlocksToText([
      { kind: "line", text: "Member forces:" },
      { kind: "table", label: "Table 1", rows: [["Member", "Force (kN)"], ["AB", "4"]] },
    ]);
    expect(text).toBe(["Member forces:", "Table 1", "Member  Force (kN)", "AB      4"].join("\n"));
  });
});
