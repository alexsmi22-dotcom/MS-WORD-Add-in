import { auditDocument, extractFigureRefs } from "../audit";

describe("extractFigureRefs", () => {
  it("finds FIG., Figure, and ranges", () => {
    expect(extractFigureRefs("As in FIG. 1 and Figure 3, see FIGS. 5-6.")).toEqual([1, 3, 5, 6]);
  });
});

describe("auditDocument", () => {
  const documentText =
    "A widget (10) with a housing (12). As shown in FIG. 1 and FIG. 3, " +
    "the polypeptide of SEQ ID NO: 5 binds.";

  const report = auditDocument({
    documentText,
    numerals: [
      { numeral: 10, element: "widget" },
      { numeral: 12, element: "housing" },
      { numeral: 14, element: "fastener" },
    ],
    listingCount: 1,
  });

  it("returns a section per check", () => {
    expect(report.sections.map((s) => s.title.split(" ")[0])).toEqual([
      "Reference",
      "Sequences",
      "Figures",
      "Cross-references",
    ]);
  });

  it("flags a cross-reference with no matching caption", () => {
    // "FIG. 1" / "FIG. 3" are referenced but there is no "Figure N" caption line.
    const xref = report.sections[3].issues.join(" ");
    expect(xref).toContain("Fig. 1");
  });

  it("passes cross-reference validity when captions exist", () => {
    const r = auditDocument({
      documentText: "Figure 1. The device.\nAs shown in Fig. 1, it works.",
      numerals: [],
      listingCount: 0,
    });
    const xref = r.sections.find((s) => s.title === "Cross-references")!;
    expect(xref.issues).toEqual([]);
  });

  it("flags an unused reference numeral", () => {
    const numerals = report.sections[0].issues.join(" ");
    expect(numerals).toContain("(14)");
  });

  it("flags an out-of-range SEQ ID NO and an uncited listing entry", () => {
    const seq = report.sections[1].issues.join(" ");
    expect(seq).toContain("out of range");
    expect(seq).toContain("SEQ ID NO 1");
  });

  it("flags a figure-number gap", () => {
    expect(report.sections[2].issues.join(" ")).toContain("2");
  });

  it("counts issues and is not ok", () => {
    expect(report.issueCount).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });
});
