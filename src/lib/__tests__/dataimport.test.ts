import {
  parseDelimited,
  sniffDelimiter,
  tidyGrid,
  isNumericCell,
  gridToFieldText,
  hasHeaderRow,
  describeGrid,
} from "../dataimport";

describe("parseDelimited", () => {
  it("reads plain CSV", () => {
    expect(parseDelimited("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("QUOTED FIELDS containing the delimiter do not shift the columns", () => {
    // The defect a naive split(",") produces: every column after the quoted
    // cell moves one place left, and the table still looks plausible.
    const rows = parseDelimited('name,value\n"Smith, J.",42\n"Doe, A.",7');
    expect(rows).toEqual([
      ["name", "value"],
      ["Smith, J.", "42"],
      ["Doe, A.", "7"],
    ]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    const rows = parseDelimited('a,b\n"he said ""hi""","line1\nline2"');
    expect(rows[1][0]).toBe('he said "hi"');
    expect(rows[1][1]).toBe("line1\nline2");
  });

  it("sniffs tab, semicolon and comma in that order", () => {
    expect(sniffDelimiter("a\tb,c")).toBe("\t");
    expect(sniffDelimiter("a;b,c")).toBe(";");
    expect(sniffDelimiter("a,b")).toBe(",");
    expect(sniffDelimiter("single")).toBe(",");
  });

  it("survives CRLF, a trailing newline, and blank lines", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a final row with no trailing newline", () => {
    expect(parseDelimited("1,2\n3,4")).toHaveLength(2);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("\n\n  \n")).toEqual([]);
  });
});

describe("tidyGrid", () => {
  it("pads ragged rows and drops trailing empty columns", () => {
    expect(tidyGrid([["a", "b", ""], ["1"], ["2", "3", ""]])).toEqual([
      ["a", "b"],
      ["1", ""],
      ["2", "3"],
    ]);
  });

  it("drops blank rows and trims cells", () => {
    expect(tidyGrid([[" a ", " b "], ["", ""], ["1", "2"]])).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("never collapses to zero width", () => {
    expect(tidyGrid([["x"], ["y"]])).toEqual([["x"], ["y"]]);
  });
});

describe("isNumericCell", () => {
  it("accepts numbers with thousands separators and percent signs", () => {
    for (const s of ["1", "-2.5", "1e3", " 42 ", "1,234", "12%"]) {
      expect(isNumericCell(s)).toBe(true);
    }
  });
  it("rejects text and blanks", () => {
    for (const s of ["", "  ", "abc", "12abc", "N/A", "-"]) {
      expect(isNumericCell(s)).toBe(false);
    }
  });
});

describe("hasHeaderRow", () => {
  it("detects a text header over numeric data", () => {
    expect(hasHeaderRow([["x", "y"], ["1", "2"]])).toBe(true);
  });
  it("treats an all-numeric first row as DATA, not a header", () => {
    // Conservative on purpose: discarding a real observation is the worse error.
    expect(hasHeaderRow([["1", "2"], ["3", "4"]])).toBe(false);
  });
  it("needs at least two rows", () => {
    expect(hasHeaderRow([["x", "y"]])).toBe(false);
  });
});

describe("gridToFieldText", () => {
  const grid = [
    ["group", "value"],
    ["a", "1"],
    ["b", "2.5"],
    ["c", "3"],
  ];

  it("block gets a tab-separated table, header kept", () => {
    expect(gridToFieldText(grid, "block")).toBe("group\tvalue\na\t1\nb\t2.5\nc\t3");
  });

  it("list gets comma-separated numbers, header dropped", () => {
    expect(gridToFieldText(grid, "list")).toBe("1, 2.5, 3");
  });

  it("matrix gets space-separated numeric rows", () => {
    const m = [["1", "2"], ["3", "4"]];
    expect(gridToFieldText(m, "matrix")).toBe("1 2\n3 4");
  });

  it("list strips thousands separators so the numbers parse", () => {
    expect(gridToFieldText([["n"], ["1,234"], ["2,000"]], "list")).toBe("1234, 2000");
  });

  it("empty input yields empty text rather than throwing", () => {
    for (const kind of ["block", "list", "matrix"]) {
      expect(gridToFieldText([], kind)).toBe("");
    }
  });

  it("a one-column numeric table becomes a clean list", () => {
    expect(gridToFieldText([["12"], ["15"], ["9"]], "list")).toBe("12, 15, 9");
  });
});

describe("describeGrid", () => {
  it("counts data rows, excluding a header", () => {
    expect(describeGrid([["x", "y"], ["1", "2"], ["3", "4"]])).toBe("2 rows × 2 columns");
  });
  it("singularises", () => {
    expect(describeGrid([["x"], ["1"]])).toBe("1 row × 1 column");
  });
  it("says so when there is nothing", () => {
    expect(describeGrid([])).toBe("no data");
  });
});

describe("round trip: a CSV a spreadsheet would actually export", () => {
  it("quoted labels, blank trailing line, CRLF — reaches the fields intact", () => {
    const csv = 'Sample,"Conc, mM",Response\r\n"A, control",1.5,22\r\n"B, test",3.0,41\r\n';
    const rows = parseDelimited(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("A, control");
    expect(gridToFieldText(rows, "list")).toBe("1.5, 22, 3.0, 41");
    expect(gridToFieldText(rows, "block").split("\n")[1]).toBe("A, control\t1.5\t22");
  });
});
