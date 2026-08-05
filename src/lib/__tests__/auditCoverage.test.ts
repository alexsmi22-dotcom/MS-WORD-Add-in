// Tier 1.11 — the document audit's two real gaps, and defect 0.9 — the SEQ ID NO
// false alarm in a fresh session.
//
// 1. The INVERSE numeral check did not exist. reconcileNumerals built
//    elementsByNumeral and flagged one numeral -> two element names. There was no
//    numeralsByElement, so "housing (12)" in one place and "housing (14)" in
//    another passed clean — the more common real drafting defect.
//    (This is NUMERAL hygiene, not claim-set hygiene: nothing here parses claims.)
//
// 2. Figure continuity was checked against the PROSE and never against the Brief
//    Description of the Drawings, so a spec referring to FIG. 1-6 with a brief
//    description covering 1-5 passed.
//
// 3. Defect 0.9: listingCount is read live from the DOM sequence cards, which
//    nothing persists, so on a fresh Word session it is 0 — and every SEQ ID NO in
//    a CORRECT specification was reported "out of range (listing has 0)".

import { auditDocument } from "../audit";
import { reconcileNumerals } from "../numerals";

describe("Tier 1.11 — one element name carrying two numerals", () => {
  it("flags housing (12) and housing (14)", () => {
    const f = reconcileNumerals(
      [
        { numeral: 12, element: "housing" },
        { numeral: 14, element: "housing" },
      ],
      [12, 14],
    );
    expect(f.duplicates).toEqual([{ element: "housing", numerals: [12, 14] }]);
    expect(f.ok).toBe(false);
  });

  it("matches on the normalized name, so case and padding do not hide it", () => {
    const f = reconcileNumerals(
      [
        { numeral: 12, element: "Housing" },
        { numeral: 14, element: " housing " },
      ],
      [12, 14],
    );
    expect(f.duplicates).toHaveLength(1);
    expect(f.duplicates[0].numerals).toEqual([12, 14]);
  });

  it("does not fire on distinct element names", () => {
    const f = reconcileNumerals(
      [
        { numeral: 12, element: "first housing" },
        { numeral: 14, element: "second housing" },
      ],
      [12, 14],
    );
    expect(f.duplicates).toEqual([]);
    expect(f.ok).toBe(true);
  });

  it("does not fire when the same element is listed twice under ONE numeral", () => {
    const f = reconcileNumerals(
      [
        { numeral: 12, element: "housing" },
        { numeral: 12, element: "housing" },
      ],
      [12],
    );
    expect(f.duplicates).toEqual([]);
    expect(f.collisions).toEqual([]);
  });

  it("the document audit surfaces it", () => {
    const r = auditDocument({
      documentText: "The housing (12) is fixed to the housing (14).",
      numerals: [
        { numeral: 12, element: "housing" },
        { numeral: 14, element: "housing" },
      ],
      listingCount: 0,
    });
    const numerals = r.sections.find((s) => s.title === "Reference numerals")!;
    expect(numerals.issues.join(" ")).toContain("housing");
    expect(numerals.issues.join(" ")).toContain("(12)");
    expect(numerals.issues.join(" ")).toContain("(14)");
    expect(r.ok).toBe(false);
  });
});

describe("Tier 1.11 — figure continuity against the Brief Description of the Drawings", () => {
  const lines = [
    "BRIEF DESCRIPTION OF THE DRAWINGS",
    "FIG. 1 is a perspective view of the device.",
    "FIG. 2 is a side elevation.",
    "FIG. 3 is a top plan view.",
    "FIG. 4 is a section taken along line A-A.",
    "FIG. 5 is a detail of the latch.",
    "DETAILED DESCRIPTION",
    "As shown in FIG. 1, the device works. FIG. 6 shows an alternative.",
  ];

  it("flags a figure referenced in the text but absent from the brief description", () => {
    const r = auditDocument({ documentText: lines.join("\n"), numerals: [], listingCount: 0 });
    const figs = r.sections.find((s) => s.title === "Figures")!;
    expect(figs.issues.join(" ")).toContain("6");
    expect(figs.issues.join(" ")).toMatch(/Brief Description of the Drawings/i);
  });

  it("works on Word's \\r line endings, not just \\n", () => {
    const r = auditDocument({ documentText: lines.join("\r"), numerals: [], listingCount: 0 });
    const figs = r.sections.find((s) => s.title === "Figures")!;
    expect(figs.issues.join(" ")).toContain("6");
  });

  it("passes when the brief description covers every referenced figure", () => {
    const ok = [...lines.slice(0, 6), "FIG. 6 is an alternative.", ...lines.slice(6)];
    const r = auditDocument({ documentText: ok.join("\n"), numerals: [], listingCount: 0 });
    const figs = r.sections.find((s) => s.title === "Figures")!;
    expect(figs.issues).toEqual([]);
  });

  it("stays silent when there is no Brief Description heading at all", () => {
    const r = auditDocument({
      documentText: "As shown in FIG. 1 and FIG. 2, the device works.",
      numerals: [],
      listingCount: 0,
    });
    const figs = r.sections.find((s) => s.title === "Figures")!;
    expect(figs.issues).toEqual([]);
  });

  it("finds the heading in the forms drafters actually write", () => {
    // Each of these was a SILENT miss: the check simply did not run, and the
    // section reported a green tick over a document it had not examined.
    for (const heading of [
      "BRIEF DESCRIPTION OF THE DRAWINGS",
      "BRIEF DESCRIPTION OF THE DRAWINGS:",
      "BRIEF DESCRIPTION OF THE SEVERAL VIEWS OF THE DRAWINGS",
      "BRIEF DESCRIPTION OF DRAWINGS",
      "Brief Description of Drawings",
      "Brief Description of the Figures",
    ]) {
      const doc = [heading, "FIG. 1 is a plan view.", "DETAILED DESCRIPTION", "See FIG. 1 and FIG. 2."].join("\n");
      const r = auditDocument({ documentText: doc, numerals: [], listingCount: 0 });
      const figs = r.sections.find((s) => s.title === "Figures")!;
      expect(figs.issues.join(" ")).toContain("FIG. 2");
    }
  });

  it("an unreadable Brief Description section says nothing, rather than flagging every figure", () => {
    // Both of these reached the maximal false alarm — every figure in the document
    // reported as missing from a list the code had not actually read.
    const headingLast = ["See FIG. 1 and FIG. 2.", "BRIEF DESCRIPTION OF THE DRAWINGS"].join("\n");
    const subHeading = [
      "BRIEF DESCRIPTION OF THE DRAWINGS",
      "IN THE DRAWINGS",
      "FIG. 1 is a plan view.",
      "FIG. 2 is a side view.",
      "DETAILED DESCRIPTION",
      "See FIG. 1 and FIG. 2.",
    ].join("\n");
    for (const doc of [headingLast, subHeading]) {
      const r = auditDocument({ documentText: doc, numerals: [], listingCount: 0 });
      const figs = r.sections.find((s) => s.title === "Figures")!;
      expect(figs.issues).toEqual([]);
    }
  });
});

describe("defect 0.9 — SEQ ID NO references in a fresh session", () => {
  const text =
    "The polypeptide of SEQ ID NO: 1 is encoded by the polynucleotides of " +
    "SEQ ID NOs: 2-40, each of which binds the target.";

  it("does not flag 40 correct references when no listing is loaded", () => {
    const r = auditDocument({ documentText: text, numerals: [], listingCount: 0 });
    const seq = r.sections.find((s) => s.title === "Sequences (SEQ ID NO)")!;
    expect(seq.issues).toEqual([]);
    expect(seq.notes).toBeDefined();
    expect(seq.notes!.join(" ")).toMatch(/no sequence listing/i);
    expect(r.issueCount).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("a note is not an all-clear: it says the section was NOT checked", () => {
    const r = auditDocument({ documentText: text, numerals: [], listingCount: 0 });
    const seq = r.sections.find((s) => s.title === "Sequences (SEQ ID NO)")!;
    expect(seq.notes!.join(" ")).toMatch(/not checked/i);
  });

  it("still flags a genuinely out-of-range reference once a listing IS loaded", () => {
    const r = auditDocument({ documentText: text, numerals: [], listingCount: 5 });
    const seq = r.sections.find((s) => s.title === "Sequences (SEQ ID NO)")!;
    expect(seq.issues.join(" ")).toContain("out of range");
    expect(seq.notes ?? []).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it("a document with no SEQ ID NO references and no listing gets no note", () => {
    const r = auditDocument({ documentText: "A widget with a housing.", numerals: [], listingCount: 0 });
    const seq = r.sections.find((s) => s.title === "Sequences (SEQ ID NO)")!;
    expect(seq.issues).toEqual([]);
    expect(seq.notes ?? []).toEqual([]);
  });
});
