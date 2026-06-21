import { formatCaption, formatRef, formatEqRef, extractCaptionNumbers, extractRefNumbers, checkCaptions } from "../refs";

describe("formatting", () => {
  it("formats captions with and without text", () => {
    expect(formatCaption("figure", 1, "A widget")).toBe("Figure 1. A widget");
    expect(formatCaption("table", 2)).toBe("Table 2");
  });
  it("formats cross-references", () => {
    expect(formatRef("figure", 3)).toBe("Fig. 3");
    expect(formatRef("table", 2)).toBe("Table 2");
    expect(formatEqRef(4)).toBe("Eq. (4)");
  });
});

describe("extractCaptionNumbers", () => {
  it("finds line-start captions in order", () => {
    const text = "Figure 1. The device.\nSome prose about Fig. 1.\nFigure 2. Another view.";
    expect(extractCaptionNumbers(text, "figure")).toEqual([1, 2]);
  });
  it("does not pick up inline cross-references", () => {
    expect(extractCaptionNumbers("As seen in Figure 5, the part…", "figure")).toEqual([]);
  });
});

describe("extractRefNumbers", () => {
  it("finds abbreviated and full cross-references anywhere", () => {
    expect(extractRefNumbers("see Fig. 3 and Figure 5; also Figs. 1-2", "figure")).toEqual([1, 2, 3, 5]);
    expect(extractRefNumbers("as in Table 2 and Tables 4 or 6", "table")).toEqual([2, 4, 6]);
  });
});

describe("checkCaptions", () => {
  it("passes a clean sequence", () => {
    expect(checkCaptions("Figure 1. a\nFigure 2. b\nFigure 3. c", "figure")).toMatchObject({ ok: true });
  });
  it("flags gaps", () => {
    expect(checkCaptions("Figure 1. a\nFigure 3. c", "figure").gaps).toEqual([2]);
  });
  it("flags duplicates", () => {
    expect(checkCaptions("Table 1. a\nTable 1. b", "table").duplicates).toEqual([1]);
  });
});
