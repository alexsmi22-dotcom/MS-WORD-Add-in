// Four defects that made the patent tools report things that were not true.
//
// Each produced confident, wrong output in a practitioner's document, and each
// is the kind a drafter notices once and then stops trusting the tool over.
// Every case here was measured against the old behaviour before being fixed.

import { extractCaptionNumbers, checkCaptions } from "../refs";
import { extractNumerals, reconcileNumerals } from "../numerals";
import { authoritiesForToa } from "../toa";

const CR = String.fromCharCode(13);

describe("captions are found in real Word text, not just LF text", () => {
  // Word's body.text delimits paragraphs with \r. The anchor was (?:^|\n), so
  // extraction returned [] on every real document: "Check captions" always
  // reported clean, and the Audit reported every figure reference as uncaptioned.
  const wordDoc = `DRAWINGS${CR}Figure 1. The device.${CR}Figure 2. A section.${CR}`;

  test("CR-delimited captions are found", () => {
    expect(extractCaptionNumbers(wordDoc, "figure")).toEqual([1, 2]);
  });

  test("LF-delimited captions still work", () => {
    expect(extractCaptionNumbers(wordDoc.split(CR).join("\n"), "figure")).toEqual([1, 2]);
  });

  test("CRLF works, without double-counting", () => {
    const crlf = "Figure 1. A.\r\nFigure 2. B.\r\n";
    expect(extractCaptionNumbers(crlf, "figure")).toEqual([1, 2]);
  });

  test("tables too", () => {
    expect(extractCaptionNumbers(`Table 1. Results.${CR}Table 2. More.`, "table")).toEqual([1, 2]);
  });

  test("a mid-line 'Figure 3' is not a caption", () => {
    // Only a line-leading caption counts, which is the whole point of the anchor.
    expect(extractCaptionNumbers("As shown in Figure 3 the widget turns.", "figure")).toEqual([]);
  });

  test("checkCaptions can now actually fail on a real document", () => {
    // Before the fix this returned ok for ANY input, because it never saw a
    // caption at all — including when captions really were duplicated.
    const dup = `Figure 1. A.${CR}Figure 1. B.${CR}`;
    const r = checkCaptions(dup, "figure");
    expect(r.ok).toBe(false);
  });

  test("and still passes a correctly numbered document", () => {
    const good = `Figure 1. A.${CR}Figure 2. B.${CR}Figure 3. C.${CR}`;
    expect(checkCaptions(good, "figure").ok).toBe(true);
  });
});

describe("numeral gaps are reported per run, not across bands", () => {
  const entry = (numeral: number, element: string) => ({ numeral, element });

  test("a multi-embodiment spec reports no phantom gaps", () => {
    // 10/12/14 for FIG. 1 and 100/102/104 for FIG. 2 — the commonest patent
    // numbering convention there is. The old global-step walk reported 42
    // "skipped numerals": 16, 18, 20 ... 98.
    const table = [10, 12, 14, 100, 102, 104].map((n) => entry(n, `part ${n}`));
    const f = reconcileNumerals(table, [10, 12, 14, 100, 102, 104]);
    expect(f.gaps).toEqual([]);
  });

  test("a genuine gap inside a run is still reported", () => {
    const table = [10, 12, 16].map((n) => entry(n, `part ${n}`));
    const f = reconcileNumerals(table, [10, 12, 16]);
    expect(f.gaps).toEqual([14]);
  });

  test("a genuine gap inside the second band is still reported", () => {
    const table = [10, 12, 100, 102, 106].map((n) => entry(n, `part ${n}`));
    const f = reconcileNumerals(table, [10, 12, 100, 102, 106]);
    expect(f.gaps).toEqual([104]);
  });

  test("odd numbering still works", () => {
    const table = [1, 2, 4].map((n) => entry(n, `part ${n}`));
    const f = reconcileNumerals(table, [1, 2, 4]);
    expect(f.gaps).toEqual([3]);
  });
});

describe("callouts are not confused with years and list markers", () => {
  const PROSE =
    "a widget (10) with a housing (12). See Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). " +
    "The steps are: (1) forming, (2) etching.";

  test("a citation year is not a reference numeral", () => {
    const known = [10, 12];
    expect(extractNumerals(PROSE, known)).toEqual([10, 12]);
  });

  test("without a table, the year filter still applies", () => {
    // Conservative: only the year is dropped, since nothing bounds the range.
    const got = extractNumerals(PROSE);
    expect(got).not.toContain(2014);
    expect(got).toContain(10);
  });

  test("the audit no longer reports the year as an orphan", () => {
    const table = [10, 12].map((n) => ({ numeral: n, element: `part ${n}` }));
    const f = reconcileNumerals(table, extractNumerals(PROSE, [10, 12]));
    expect(f.orphans).toEqual([]);
  });

  test("a real undefined callout is STILL reported", () => {
    // The filter must not be so wide that it hides the tool's actual job.
    const table = [10, 12].map((n) => ({ numeral: n, element: `part ${n}` }));
    const f = reconcileNumerals(table, extractNumerals("a widget (10) and a lever (14).", [10, 12]));
    expect(f.orphans).toEqual([14]);
  });

  test("sub-part callouts still resolve to their base numeral", () => {
    expect(extractNumerals("the arm (12a) and the arm (12b)", [12])).toEqual([12]);
  });
});

describe("bare 'Rule N' does not fabricate FRCP authorities", () => {
  const brief =
    "Under Fed. R. Civ. P. 12(b)(6) the claim fails. Applicant submitted a Rule 132 " +
    "declaration and a Rule 131 swear-behind. See also Local Rule 7.1 and Rule 36.";

  const rules = () =>
    authoritiesForToa(brief)
      .filter((a) => a.category === "rules")
      .map((a) => a.long);

  test("the qualified rule the drafter actually cited is captured", () => {
    expect(rules().some((r) => r.includes("12"))).toBe(true);
  });

  test("USPTO practice rules are not turned into civil rules", () => {
    const r = rules().join(" | ");
    expect(r).not.toContain("Civ. P. 132");
    expect(r).not.toContain("Civ. P. 131");
  });

  test("a local rule is not turned into a civil rule", () => {
    expect(rules().join(" | ")).not.toContain("Civ. P. 7");
  });

  test("an unqualified bare rule is still captured", () => {
    // "Rule 36" has no qualifier before it, so in a brief that cites the FRCP it
    // is a reasonable civil-rule reading — the behaviour this feature exists for.
    expect(rules().some((r) => r.includes("36"))).toBe(true);
  });

  test("with no FRCP anywhere, bare rules are not captured at all", () => {
    const noFrcp = "Applicant submitted a Rule 132 declaration.";
    expect(authoritiesForToa(noFrcp).filter((a) => a.category === "rules")).toEqual([]);
  });
});
