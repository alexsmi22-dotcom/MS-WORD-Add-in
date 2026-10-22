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

describe("Check captions: chapter numbers and schemes (release A)", () => {
  test("chapter-numbered captions restart per chapter: 1.1, 1.2, 2.1 is consistent", () => {
    expect(checkCaptions("Figure 1.1. A\nFigure 1.2. B\nFigure 2.1. C", "figure")).toEqual({ gaps: [], duplicates: [], ok: true });
  });
  test("a gap or a duplicate is named with its chapter", () => {
    expect(checkCaptions("Figure 1.1. A\nFigure 1.3. B\nFigure 2.1. C\nFigure 2.1. D", "figure")).toEqual({ gaps: ["1.2"], duplicates: ["2.1"], ok: false });
  });
  test("schemes are checked like figures", () => {
    expect(checkCaptions("Scheme 1. A\nScheme 3. B", "scheme")).toEqual({ gaps: [2], duplicates: [], ok: false });
  });
});

describe("Check captions: prose is not a chapter caption (fix-round review)", () => {
  test("a range in a sentence leaves plain numbering checked plainly", () => {
    const f = checkCaptions("Figure 1. A\nFigure 1. B\nFigure 3. C\nFigure 2–4 show the results.", "figure");
    // Checked plainly (as before this release): no chapter labels invented.
    expect(f.duplicates).toEqual([1]);
    expect(f.gaps.every((g) => typeof g === "number")).toBe(true);
  });
  test("a quantity after a table word is not a caption", () => {
    expect(checkCaptions("Table 1. Data\nTable 1.5 mg of x was added.\nTable 2. More", "table").gaps).toEqual([]);
  });
  test("Word's own chapter captions: a bare capitalised title, a colon, a spaced dash", () => {
    expect(checkCaptions("Figure 1.1 Housing\nFigure 1.2: Gear\nFigure 2-1 — Shaft", "figure")).toEqual({ gaps: [], duplicates: [], ok: true });
  });
});
