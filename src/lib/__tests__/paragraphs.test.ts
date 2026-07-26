// USPTO paragraph numbering.
//
// The risk here is not the arithmetic, it is the policy: numbering a heading, a
// claim or the abstract produces a document that looks authoritative and is
// facially wrong. These tests are mostly about what must NOT be numbered.

import {
  formatParagraphNumber,
  parseParagraphNumber,
  stripParagraphNumber,
  looksLikeHeading,
  looksLikeClaimsStart,
  planParagraphNumbering,
  describeParagraphPlan,
} from "../paragraphs";

describe("the mark itself", () => {
  test("is zero-padded to four digits", () => {
    expect(formatParagraphNumber(1)).toBe("[0001]");
    expect(formatParagraphNumber(42)).toBe("[0042]");
    expect(formatParagraphNumber(1234)).toBe("[1234]");
  });

  test("grows rather than truncating past 9999", () => {
    // Truncating would produce a duplicate label, which is worse than a wide one.
    expect(formatParagraphNumber(12345)).toBe("[12345]");
  });

  test("parses the forms real documents contain", () => {
    expect(parseParagraphNumber("[0001] The invention relates")).toBe(1);
    expect(parseParagraphNumber("[00042] Something")).toBe(42);
    expect(parseParagraphNumber("[7] Something")).toBe(7);
    expect(parseParagraphNumber("  [0003] leading space")).toBe(3);
  });

  test("does not mistake a mid-sentence bracket for a paragraph mark", () => {
    // "as shown in [0012]" is a cross-reference, not this paragraph's number.
    expect(parseParagraphNumber("As described in [0012], the widget")).toBeNull();
    expect(parseParagraphNumber("No number here")).toBeNull();
  });

  test("stripping removes the mark and its spacing", () => {
    expect(stripParagraphNumber("[0001] The invention")).toBe("The invention");
    expect(stripParagraphNumber("Nothing to strip")).toBe("Nothing to strip");
  });
});

describe("what counts as a heading", () => {
  test.each([
    "BACKGROUND",
    "DETAILED DESCRIPTION",
    "Brief Description of the Drawings",
    "Technical Field",
    "SUMMARY OF THE INVENTION",
    "CROSS-REFERENCE TO RELATED APPLICATIONS",
  ])("%s is a heading", (t) => {
    expect(looksLikeHeading(t)).toBe(true);
  });

  test("a real sentence is not a heading, even a short one", () => {
    expect(looksLikeHeading("The widget is attached to the frame.")).toBe(false);
    expect(looksLikeHeading("FIG. 1 shows a widget.")).toBe(false);
  });

  test("a long line is never a heading however it is capitalised", () => {
    // The conservative direction: a stray number is deleted in a second, a
    // missing one breaks every cross-reference after it.
    const long = "THE PRESENT INVENTION RELATES GENERALLY TO WIDGETS AND MORE PARTICULARLY TO IMPROVED WIDGETS";
    expect(looksLikeHeading(long)).toBe(false);
  });

  test("a trailing full stop disqualifies a heading", () => {
    expect(looksLikeHeading("BACKGROUND.")).toBe(false);
  });
});

describe("claims are never numbered", () => {
  test.each(["What is claimed is:", "We claim:", "I claim:", "CLAIMS", "The invention claimed is:"])(
    "%s starts the claims",
    (t) => {
      expect(looksLikeClaimsStart(t)).toBe(true);
    },
  );

  test("everything from the claims onward is skipped", () => {
    const doc = [
      "DETAILED DESCRIPTION",
      "The widget comprises a frame.",
      "What is claimed is:",
      "1. A widget comprising a frame.",
      "2. The widget of claim 1, wherein the frame is steel.",
    ];
    const plan = planParagraphNumbering(doc);
    expect(plan.numbered).toBe(1);
    expect(plan.claimsAt).toBe(2);
    // No claim carries a mark.
    for (const it of plan.items.slice(2)) expect(it.mark).toBe("");
  });

  test("stopAtClaims:false numbers them, for the user who insists", () => {
    const doc = ["A paragraph.", "What is claimed is:", "1. A widget."];
    const plan = planParagraphNumbering(doc, { stopAtClaims: false });
    expect(plan.numbered).toBe(3);
  });
});

describe("numbering a specification", () => {
  const spec = [
    "TECHNICAL FIELD",
    "The present invention relates to widgets.",
    "",
    "BACKGROUND",
    "Widgets are known in the art.",
    "Known widgets suffer from wobble.",
  ];

  test("only the body paragraphs are numbered, in order from 1", () => {
    const plan = planParagraphNumbering(spec);
    const marks = plan.items.map((i) => i.mark).filter(Boolean);
    expect(marks).toEqual(["[0001]", "[0002]", "[0003]"]);
    expect(plan.skippedHeadings).toBe(2);
    expect(plan.skippedEmpty).toBe(1);
  });

  test("numbering can start anywhere", () => {
    const plan = planParagraphNumbering(spec, { start: 40 });
    expect(plan.items.map((i) => i.mark).filter(Boolean)).toEqual(["[0040]", "[0041]", "[0042]"]);
  });

  test("an already-numbered document is left alone by default", () => {
    const doc = ["[0001] First.", "[0002] Second."];
    const plan = planParagraphNumbering(doc);
    expect(plan.numbered).toBe(0);
    expect(plan.alreadyNumbered).toBe(2);
    expect(plan.items.every((i) => i.mark === "")).toBe(true);
  });

  test("a PARTIALLY numbered document continues the sequence and does not collide", () => {
    // The real workflow: paragraphs were inserted into a numbered spec.
    const doc = ["[0001] First.", "Inserted later.", "[0002] Was second."];
    const plan = planParagraphNumbering(doc);
    // The new paragraph must not be given [0002], which already exists.
    const assigned = plan.items.filter((i) => i.mark).map((i) => i.mark);
    expect(assigned).toEqual(["[0002]"]);
    // ...and that is a genuine collision, which is exactly why renumber exists.
    expect(plan.alreadyNumbered).toBe(2);
    // It must be REPORTED, not left for the examiner to find.
    expect(plan.collisions).toEqual([2]);
    expect(describeParagraphPlan(plan)).toContain("already appear later");
    expect(describeParagraphPlan(plan)).toContain("renumber");
  });

  test("renumbering resolves the collision rather than reporting one", () => {
    const doc = ["[0001] First.", "Inserted later.", "[0002] Was second."];
    expect(planParagraphNumbering(doc, { renumber: true }).collisions).toEqual([]);
  });

  test("a clean document reports no collisions", () => {
    expect(planParagraphNumbering(["One.", "Two."]).collisions).toEqual([]);
  });

  test("renumbering rewrites every mark from the start", () => {
    const doc = ["[0007] First.", "Inserted later.", "[0009] Third."];
    const plan = planParagraphNumbering(doc, { renumber: true });
    expect(plan.items.map((i) => i.mark)).toEqual(["[0001]", "[0002]", "[0003]"]);
    expect(plan.items[0].removeExisting).toBe(true);
    expect(plan.items[1].removeExisting).toBe(false);
    expect(plan.numbered).toBe(3);
  });

  test("the summary says what will happen before anything is written", () => {
    const text = describeParagraphPlan(planParagraphNumbering(spec));
    expect(text).toContain("3 paragraphs will be numbered");
    expect(text).toContain("2 headings skipped");
  });

  test("an empty document produces an empty plan, not a crash", () => {
    const plan = planParagraphNumbering([]);
    expect(plan.items).toEqual([]);
    expect(plan.numbered).toBe(0);
  });
});
