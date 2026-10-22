// RULE N (src/lib/dataBlock.ts): the release-B round-3 TABLE, pinned whole. Every tool that reads a pasted block
// (titration, materials, two-y-axes data) goes through readDataBlock, so this table is the shared gate: an entry is
// either the exact rows or a refusal whose message matches.

import { readDataBlock, noteNoun, type DataBlock, type DataBlockOptions } from "../dataBlock";

type Want = { rows: (number | null)[][]; note?: RegExp } | { refuse: RegExp };
const TABLE: Array<[string, Want, DataBlockOptions?]> = [
  ["10 5,30\n25 8,25", { rows: [[10, 5.3], [25, 8.25]], note: /decimal points/ }],
  ["10\t5,30\t58\n25\t8,25\t60", { rows: [[10, 5.3, 58], [25, 8.25, 60]] }],
  ["10, 5,30\n25, 8,25", { rows: [[10, 5.3], [25, 8.25]] }],
  ["0\t2,88\n12.5\t5,10", { refuse: /mixes 12\.5 and 2,88/ }],
  ["0\t2,88\t25.0", { refuse: /mixes 25\.0 and 2,88/ }],
  ["0,2.88\n5, 4.15\n10,4.76", { refuse: /"0,2\.88" has both a decimal point and a comma/ }],
  ["1,2,3\n2,4,6", { rows: [[1, 2, 3], [2, 4, 6]] }],
  ["1,2,3\n2,4,6\n3 6 9", { refuse: /"1,2,3" is not a number/ }],
  ["1, 2.5, 3.5\n2, 4.5, 6.5", { rows: [[1, 2.5, 3.5], [2, 4.5, 6.5]] }],
  ["1, 2.5,3.5", { refuse: /"2\.5,3\.5" has both a decimal point and a comma/ }],
  ["1.234,5 1.302,7", { rows: [[1234.5, 1302.7]] }],
  ["1,000 7.0", { refuse: /mixes 7\.0 and 1,000/ }],
  ["2,15 7,20 12,35", { rows: [[2.15, 7.2, 12.35]] }],
  ["2,15 7.20", { refuse: /mixes 7\.20 and 2,15/ }],
  ["4,76", { refuse: /could be one number with a decimal comma \(4\.76\) or two values/ }, { loneCommaPairAmbiguous: true }],
  ["25,50", { rows: [[25, 50]] }],
  ["1,000, 2,000", { refuse: /“1,000” could be a number with a thousands comma/ }],
  ["25, 50,100", { refuse: /“50,100” could be a number with a thousands comma/ }],
  ["Strain (%)\tStress (N/mm2)\n0\t0\n0.1\t70", { rows: [[0, 0], [0.1, 70]], note: /header \(Strain \(%\), Stress \(N\/mm2\)\)/ }],
  ["Batch A: 312 334 351\n380 390", { refuse: /line 1 .*mixes words and numbers/ }],
  ["Specimen 1\n312\n334", { refuse: /line 1 .*mixes words and numbers/ }],
  ["x\ty1\ty2\n1\t2\t3", { rows: [[1, 2, 3]], note: /header \(x, y1, y2\)/ }],
  ["1\t−2,5\t3", { rows: [[1, -2.5, 3]] }],
  ["1e-3\t2\n2e-3\t4", { rows: [[0.001, 2], [0.002, 4]] }],
  ["\r\n10 5.30\r\n\r\n25 8.25\r\n", { rows: [[10, 5.3], [25, 8.25]] }],
  // Missing-value tokens keep their column; a later all-words line is refused, not dropped.
  ["1\t\t3\n2\tNA\t6", { rows: [[1, null, 3], [2, null, 6]] }],
  ["1 2\nfoo bar\n3 4", { refuse: /line 2 .*has no numbers/ }],
  // ---- round 4 rulings ----
  // R1 singleColumn: a multi-line list with no other separator is one value per line, inner comma by N3.
  ["1234,5\n1302,7", { rows: [[1234.5], [1302.7]] }, { singleColumn: true }],
  ["9,98\n10,01", { rows: [[9.98], [10.01]] }, { singleColumn: true }],
  ["312,5\r\n334,1", { rows: [[312.5], [334.1]] }, { singleColumn: true }],
  ["12,5\n25,5\n50,5", { rows: [[12.5], [25.5], [50.5]] }, { singleColumn: true }],
  ["25,50", { rows: [[25, 50]] }, { singleColumn: true }],
  ["4,76", { refuse: /could be one number with a decimal comma/ }, { singleColumn: true, loneCommaPairAmbiguous: true }],
  ["1234,5\n1302,7", { rows: [[1234, 5], [1302, 7]] }], // without singleColumn, N1: bare commas separate
  // R2 spaces inside a tab/semicolon field are refused by name, never read as grouping.
  ["312\t334\t351\n362 371 380", { refuse: /"362 371 380" has spaces inside one tab-separated field/ }],
  ["25\t50\n100 200", { refuse: /"100 200" has spaces inside one tab-separated field/ }],
  ["100 250\t16.62", { refuse: /"100 250" has spaces inside one tab-separated field/ }],
  ["x\ty1\ty2\n0\t1 500\t4", { refuse: /"1 500" has spaces inside one tab-separated field/ }],
  ["1;2 3\n4;5", { refuse: /"2 3" has spaces inside one semicolon-separated field/ }],
  // R3″ (strict, final): a no-break/narrow/thin space between digits is grouping ONLY inside a tab/semicolon field or a
  // singleColumn line, and only in the full SI shape; in space/comma blocks it is always a named refusal.
  // Accepted (a):
  ["1\u00A0234,5\t7", { rows: [[1234.5, 7]] }],
  ["1\u00A0234,5\n1\u00A0302,7", { rows: [[1234.5], [1302.7]] }, { singleColumn: true }],
  ["12\u00A0345\u00A0678\n1\u00A0234,5", { rows: [[12345678], [1234.5]] }, { singleColumn: true }],
  ["0\t1\u00A0000\n1\t2\u00A0000", { rows: [[0, 1000], [1, 2000]] }], // two groups inside a tab field: accepted
  ["25.401\u20092\n25.399\u20098\n25.400\u20095", { rows: [[25.4012], [25.3998], [25.4005]] }, { singleColumn: true }],
  ["3.141\u2009592\n2.718\u2009281", { rows: [[3.141592], [2.718281]] }, { singleColumn: true }],
  ["3,141\u2009592\n2,718\u2009281", { rows: [[3.141592], [2.718281]] }, { singleColumn: true }],
  ["12\u2009345.678\u20099\t1", { rows: [[12345.6789, 1]] }],
  ["1\u00A0234.5\t1\n1\u00A0300.25\t2", { rows: [[1234.5, 1], [1300.25, 2]] }],
  ["1\u202F234\t5\n2\u2009345\t6", { rows: [[1234, 5], [2345, 6]] }],
  ["0,123\u20094;1", { rows: [[0.1234, 1]] }],
  ["\u22121\u00A0234,5\t7", { rows: [[-1234.5, 7]] }],
  ["312\u00A0334\n351\u00A0362", { refuse: /no-break\/thin space between digits/ }, { singleColumn: true }], // two-group integer on a singleColumn line: refused (integrator decision)
  ["12\u00A0MPa\t3", { refuse: /mixes words and numbers/ }], // (c) not between digits: ordinary space, then "12 MPa" is R2/N4
  ["5\u00A0\t6", { rows: [[5, 6]] }], // (c) trailing grouping space is whitespace
  // Refused (a): not SI-shaped inside a delimited field.
  ["312.4\u20095\n334.1\u20092", { refuse: /no-break\/thin space between digits/ }, { singleColumn: true }],
  ["0\u00A0150\t1", { refuse: /no-break\/thin space between digits/ }],
  ["1234\u00A0567\t1", { refuse: /no-break\/thin space between digits/ }],
  ["1\u00A023\t1", { refuse: /no-break\/thin space between digits/ }],
  // Refused (b): any grouping space between digits in a whitespace- or comma-separated block.
  ["1\u00A0234,5 7", { refuse: /no-break\/thin space between digits/ }],
  ["1\u00A0234,5\n1\u00A0302,7", { refuse: /no-break\/thin space between digits/ }],
  ["12\u00A0345\u00A0678", { refuse: /no-break\/thin space between digits/ }],
  ["12\u2009345.678\u20099", { refuse: /no-break\/thin space between digits/ }, { singleColumn: true }], // one line: N1 comma mode, so (b)
  ["0\u00A01.5\n1\u00A02.5", { refuse: /no-break\/thin space between digits/ }],
  ["0\u20091.5\n1\u202F2.5", { refuse: /no-break\/thin space between digits/ }],
  ["312\u00A0334\n351\u00A0362", { refuse: /no-break\/thin space between digits/ }],
  ["1.5\u202F2.5\n3.5\u202F4.5", { refuse: /no-break\/thin space between digits/ }],
  // Round-6 repros: every one a named refusal, never 1.5002 / 12.5007 / 10175.5 / merged rows / [100, 0, 0.5].
  ["1.500\u00A02 3.5", { refuse: /no-break\/thin space between digits/ }],
  ["12.500\u00A07", { refuse: /no-break\/thin space between digits/ }],
  ["0 150.5 2.5\n10\u00A0175.5 3.0", { refuse: /no-break\/thin space between digits/ }],
  ["0\u00A0150\n5\u00A0175\n10\u00A0200.5", { refuse: /no-break\/thin space between digits/ }],
  ["100\u00A0000 0.5", { refuse: /no-break\/thin space between digits/ }],
  // R4 header detection ignores empty cells and missing tokens.
  ["strain %\tstress MPa\t\n0\t0\t\n0.1\t70\t", { rows: [[0, 0, null], [0.1, 70, null]], note: /header/ }],
  ["\tA\tB\n1\t2\t3", { rows: [[1, 2, 3]], note: /header \(A, B\)/ }],
  ["x\t-\ty\n1\t2\t3", { rows: [[1, 2, 3]], note: /header/ }],
  ["", { refuse: /nothing to read/ }],
  ["V\tpH", { refuse: /only a header line/ }],
];

describe("readDataBlock: RULE N table", () => {
  test.each(TABLE.map(([text, want, opts]) => ({ text, want, opts })))("$text", ({ text, want, opts }) => {
    const r = readDataBlock(text, "Data", opts);
    if ("refuse" in want) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(want.refuse);
      return;
    }
    if (!r.ok) throw new Error(r.error);
    const b = r as DataBlock;
    expect(b.rows.length).toBe(want.rows.length);
    b.rows.forEach((row, i) => {
      expect(row.length).toBe(want.rows[i].length);
      row.forEach((v, j) => (want.rows[i][j] === null ? expect(v).toBeNull() : expect(v).toBeCloseTo(want.rows[i][j] as number, 12)));
    });
    if (want.note) expect(b.notes.join(" ")).toMatch(want.note);
  });

  test("separators and line numbers are reported", () => {
    const r = readDataBlock("x y\n\n1 2\n3 4", "Data");
    if (!r.ok) throw new Error(r.error);
    expect(r.separator).toBe("space");
    expect(r.lines).toEqual([3, 4]);
    expect(r.header).toEqual(["x", "y"]);
    const c = readDataBlock("1,2\n3,4", "Data");
    expect(c.ok && c.separator).toBe("comma");
  });

  test("the decimal-comma note is grammatical for any label", () => {
    for (const [what, noun] of [["The data", "data"], ["Data", "data"], ["Scan rates", "scan rates"], ["a block", "block"], ["pKa values", "pKa values"], ["XRD peaks", "XRD peaks"]]) {
      const r = readDataBlock("10 5,30\n25 8,25", what);
      if (!r.ok) throw new Error(r.error);
      const note = r.notes.join(" ");
      expect(note).toMatch(new RegExp(`^Commas in the ${noun} were read as decimal points`));
      expect(note).not.toMatch(/the (the|a|an) /i);
    }
    expect(noteNoun("")).toBe("data");
  });

  test("the decimal-comma note echoes the user's minus sign as typed", () => {
    const r = readDataBlock("1 −5,30\n2 4,10", "Data");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0][1]).toBeCloseTo(-5.3, 12);
    expect(r.notes.join(" ")).toMatch(/“−5,30” is −5\.3/);
    expect(r.notes.join(" ")).not.toMatch(/“-5,30”/);
  });

  test("row cap", () => {
    expect(readDataBlock(Array.from({ length: 11 }, (_, i) => `${i} ${i}`).join("\n"), "Data", { maxRows: 10 }).ok).toBe(false);
    expect(readDataBlock(Array.from({ length: 10 }, (_, i) => `${i} ${i}`).join("\n"), "Data", { maxRows: 10 }).ok).toBe(true);
  });
});
