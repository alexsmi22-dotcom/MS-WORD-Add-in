import {
  NumeralEntry,
  extractNumerals,
  reconcileNumerals,
  suggestNextNumeral,
  formatCallout,
  buildNumeralListHtml,
} from "../numerals";

describe("extractNumerals", () => {
  it("finds distinct parenthesized callouts, ascending", () => {
    const text = "The widget (10) has a housing (12) and a fastener (14). The housing (12) is bolted.";
    expect(extractNumerals(text)).toEqual([10, 12, 14]);
  });

  it("ignores bare numerals, dates, and quantities", () => {
    expect(extractNumerals("In 2024 the 12 mm housing weighs 3 kg.")).toEqual([]);
  });

  it("returns [] for text with no callouts", () => {
    expect(extractNumerals("No callouts here.")).toEqual([]);
  });

  it("handles numerals of any length (not just ≤4 digits)", () => {
    expect(extractNumerals("the widget (10234) and (5)")).toEqual([5, 10234]);
  });

  it("treats a sub-part callout (12a)/(12') as the base numeral 12", () => {
    expect(extractNumerals("the arm (12) has fingers (12a) and (12b)")).toEqual([12]);
    expect(extractNumerals("the shaft (14') mirrors the shaft (14)")).toEqual([14]);
  });
});

describe("reconcileNumerals", () => {
  const clean: NumeralEntry[] = [
    { numeral: 10, element: "widget" },
    { numeral: 12, element: "housing" },
    { numeral: 14, element: "fastener" },
  ];

  it("counts a non-parenthesized 'element 12' callout as used (via its element name)", () => {
    // No parenthesized callouts, but the element names appear with their numbers.
    const text = "The widget 10 supports a housing 12, and a fastener 14 holds it.";
    const f = reconcileNumerals(clean, [], text);
    expect(f.unused).toEqual([]); // all three recognized despite no parens
    // Without the text, they'd all be reported unused.
    expect(reconcileNumerals(clean, []).unused.length).toBe(3);
    // A prose number is NOT turned into a false orphan.
    expect(reconcileNumerals(clean, [], "It weighs about 50 grams.").orphans).toEqual([]);
  });

  it("reports ok for a consistent, fully-used table", () => {
    const f = reconcileNumerals(clean, [10, 12, 14]);
    expect(f.ok).toBe(true);
    expect(f.collisions).toEqual([]);
    expect(f.gaps).toEqual([]);
    expect(f.orphans).toEqual([]);
    expect(f.unused).toEqual([]);
  });

  it("flags a numeral reused for two elements", () => {
    const entries: NumeralEntry[] = [
      { numeral: 12, element: "housing" },
      { numeral: 12, element: "cover" },
    ];
    const f = reconcileNumerals(entries, [12]);
    expect(f.collisions).toEqual([{ numeral: 12, elements: ["housing", "cover"] }]);
    expect(f.ok).toBe(false);
  });

  it("treats the same element (any case) as not a collision", () => {
    const entries: NumeralEntry[] = [
      { numeral: 12, element: "Housing" },
      { numeral: 12, element: "housing" },
    ];
    expect(reconcileNumerals(entries, [12]).collisions).toEqual([]);
  });

  it("detects an even-grid gap (10,12,16 → 14)", () => {
    const entries: NumeralEntry[] = [
      { numeral: 10, element: "a" },
      { numeral: 12, element: "b" },
      { numeral: 16, element: "c" },
    ];
    expect(reconcileNumerals(entries, [10, 12, 16]).gaps).toEqual([14]);
  });

  it("uses step 1 when numerals are not all even", () => {
    const entries: NumeralEntry[] = [
      { numeral: 1, element: "a" },
      { numeral: 4, element: "b" },
    ];
    expect(reconcileNumerals(entries, [1, 4]).gaps).toEqual([2, 3]);
  });

  it("flags orphans (in document, not in table)", () => {
    const f = reconcileNumerals(clean, [10, 12, 14, 20]);
    expect(f.orphans).toEqual([20]);
    expect(f.ok).toBe(false);
  });

  it("flags unused entries (in table, not in document)", () => {
    const f = reconcileNumerals(clean, [10, 12]);
    expect(f.unused).toEqual([{ numeral: 14, element: "fastener" }]);
    expect(f.ok).toBe(false);
  });

  it("ignores blank-element rows consistently (not counted as defined/unused/gap)", () => {
    const entries: NumeralEntry[] = [
      { numeral: 10, element: "widget" },
      { numeral: 12, element: "   " }, // incomplete row
    ];
    const f = reconcileNumerals(entries, [10]);
    expect(f.unused).toEqual([]); // (12) is not treated as defined
    expect(f.gaps).toEqual([]); // and not part of the grid
    expect(f.ok).toBe(true);
  });
});

describe("suggestNextNumeral", () => {
  it("starts at 10 for an empty table", () => {
    expect(suggestNextNumeral([])).toBe(10);
  });

  it("adds 2 when every numeral is even", () => {
    expect(suggestNextNumeral([{ numeral: 10, element: "a" }, { numeral: 12, element: "b" }])).toBe(14);
  });

  it("adds 1 when numerals are mixed parity", () => {
    expect(suggestNextNumeral([{ numeral: 11, element: "a" }])).toBe(12);
  });

  it("ignores incomplete (blank-element) rows when suggesting", () => {
    // The blank row 99 must not skew the suggestion — should be 14, not 101.
    expect(
      suggestNextNumeral([
        { numeral: 10, element: "widget" },
        { numeral: 12, element: "housing" },
        { numeral: 99, element: "  " },
      ])
    ).toBe(14);
  });
});

describe("formatCallout", () => {
  it("renders element with a parenthesized numeral", () => {
    expect(formatCallout("housing", 12)).toBe("housing (12)");
  });

  it("trims and supports a no-parens style", () => {
    expect(formatCallout("  housing  ", 12, false)).toBe("housing 12");
  });

  it("falls back to just the numeral when no element", () => {
    expect(formatCallout("", 12)).toBe("(12)");
  });
});

describe("buildNumeralListHtml", () => {
  it("renders a sorted two-column table", () => {
    const html = buildNumeralListHtml([
      { numeral: 14, element: "fastener" },
      { numeral: 10, element: "widget" },
    ]);
    expect(html).toContain("Reference numeral");
    expect(html.indexOf("widget")).toBeLessThan(html.indexOf("fastener"));
  });

  it("drops blank rows and collapses duplicate numerals to the first", () => {
    const html = buildNumeralListHtml([
      { numeral: 10, element: "widget" },
      { numeral: 12, element: "" },
      { numeral: 10, element: "gadget" },
    ]);
    expect(html).toContain("widget");
    expect(html).not.toContain("gadget");
    expect(html).not.toContain("<td style=\"border:1px solid #000;padding:2px 8px;\">12</td>");
  });

  it("escapes HTML in element names", () => {
    expect(buildNumeralListHtml([{ numeral: 10, element: "a <b> & c" }])).toContain("a &lt;b&gt; &amp; c");
  });

  it("returns empty string when nothing is defined", () => {
    expect(buildNumeralListHtml([{ numeral: 10, element: "  " }])).toBe("");
  });
});
