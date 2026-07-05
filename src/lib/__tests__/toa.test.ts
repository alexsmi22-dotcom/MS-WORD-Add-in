import { buildTableOfAuthorities, toaToHtml, findPrecedingAuthority, ToaCategory } from "../toa";

/** A short brief-like paragraph exercising each authority type. */
const BRIEF = `
The court in Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014), addressed
patent eligibility under 35 U.S.C. § 101. See also Mayo v. Prometheus, 566 U.S.
66 (2012). As explained in In re Bilski, 545 F.3d 943, 950 (Fed. Cir. 2008), the
machine-or-transformation test is a useful clue. The regulations at 37 C.F.R.
§ 1.84 govern drawings. The examiner cited U.S. Patent No. 10,123,456 and U.S.
Patent Application Publication No. 2020/0123456 A1. See 85 Fed. Reg. 12,345
(Mar. 1, 2020); MPEP § 2106.05(a). Alice again: Alice Corp. v. CLS Bank Int'l,
573 U.S. 208, 217 (2014) (a second cite to the same case).
`;

function grouped(text: string): Record<string, string[]> {
  const toa = buildTableOfAuthorities(text);
  const out: Record<string, string[]> = {};
  for (const g of toa.groups) out[g.category] = g.entries.map((e) => e.plain);
  return out;
}

describe("buildTableOfAuthorities", () => {
  const g = grouped(BRIEF);

  test("finds and groups cases (deduped, name preserved)", () => {
    expect(g.cases).toContain("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208");
    expect(g.cases).toContain("Mayo v. Prometheus, 566 U.S. 66");
    expect(g.cases).toContain("In re Bilski, 545 F.3d 943");
    // The Alice case is cited twice (different pincites) but appears once.
    expect(g.cases.filter((c) => c.startsWith("Alice Corp.")).length).toBe(1);
  });

  test("cases are alphabetized (ignoring a leading 'In re')", () => {
    // Alice, Bilski (In re → sorts as 'bilski'), Mayo
    expect(g.cases).toEqual([
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208",
      "In re Bilski, 545 F.3d 943",
      "Mayo v. Prometheus, 566 U.S. 66",
    ]);
  });

  test("finds statutes, regulations, and patents", () => {
    expect(g.statutes).toEqual(["35 U.S.C. § 101"]);
    expect(g.regulations).toEqual(["37 C.F.R. § 1.84"]);
    expect(g.patents).toContain("U.S. Patent No. 10,123,456");
    expect(g.patents).toContain("U.S. Patent Application Publication No. 2020/0123456 A1");
  });

  test("groups Fed. Reg. and MPEP under Other Authorities", () => {
    expect(g.other).toContain("85 Fed. Reg. 12,345");
    expect(g.other).toContain("MPEP § 2106.05(a)");
  });

  test("group order is Cases, Statutes, Regulations, Patents, Other", () => {
    const cats = buildTableOfAuthorities(BRIEF).groups.map((x) => x.category as ToaCategory);
    expect(cats).toEqual(["cases", "statutes", "regulations", "patents", "other"]);
  });

  test("total counts every distinct authority", () => {
    // 3 cases + 1 statute + 1 reg + 2 patents + 2 other = 9
    expect(buildTableOfAuthorities(BRIEF).total).toBe(9);
  });

  test("empty / citation-free text yields no groups", () => {
    const toa = buildTableOfAuthorities("Just some ordinary prose with no citations at all.");
    expect(toa.groups).toEqual([]);
    expect(toa.total).toBe(0);
  });

  test("does not mistake a mid-sentence 'v.' without a reporter for a case", () => {
    const toa = buildTableOfAuthorities("The plaintiff v. defendant dispute settled in 2020 for 45 dollars.");
    expect(toa.groups.find((x) => x.category === "cases")).toBeUndefined();
  });

  test("handles a corporate suffix in the party name (', Inc.')", () => {
    const g = grouped(
      "See Ass'n for Molecular Pathology v. Myriad Genetics, Inc., 569 U.S. 576, 580 (2013)."
    );
    expect(g.cases).toEqual(["Ass'n for Molecular Pathology v. Myriad Genetics, Inc., 569 U.S. 576"]);
  });
});

describe("findPrecedingAuthority", () => {
  test("returns the last authority cited in the text (for Id.)", () => {
    const auth = findPrecedingAuthority(
      "We rely on Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014), and later on 35 U.S.C. § 101."
    );
    expect(auth).toEqual({ plain: "35 U.S.C. § 101", category: "statutes" });
  });

  test("picks the closest preceding case when it comes last", () => {
    const auth = findPrecedingAuthority("35 U.S.C. § 101; see Mayo v. Prometheus, 566 U.S. 66 (2012)");
    expect(auth).toEqual({ plain: "Mayo v. Prometheus, 566 U.S. 66", category: "cases" });
  });

  test("returns null when there is no preceding authority", () => {
    expect(findPrecedingAuthority("This paragraph cites nothing at all.")).toBeNull();
  });
});

describe("toaToHtml", () => {
  test("renders a heading, group sub-headings, and italic case names", () => {
    const html = toaToHtml(buildTableOfAuthorities(BRIEF));
    expect(html).toContain("<b>TABLE OF AUTHORITIES</b>");
    expect(html).toContain("<b>Cases</b>");
    expect(html).toContain("<i>Alice Corp. v. CLS Bank Int'l</i>, 573 U.S. 208");
    expect(html).toContain("<b>Statutes</b>");
    expect(html).toContain("35 U.S.C. § 101");
  });

  test("escapes ampersands in an authority", () => {
    const html = toaToHtml(buildTableOfAuthorities("See Smith & Co. v. Jones & Sons, 100 F.3d 1 (Fed. Cir. 2000)."));
    expect(html).toContain("Smith &amp; Co. v. Jones &amp; Sons");
  });
});
