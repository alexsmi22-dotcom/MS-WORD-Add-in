import {
  buildTableOfAuthorities,
  toaToHtml,
  findPrecedingAuthority,
  authoritiesForToa,
  taFieldOoxml,
  toaFieldsOoxml,
  tocFieldOoxml,
  citationRegister,
  parseToaPages,
  toaEntryKey,
  isTaFieldCode,
  isTableFieldCode,
  findPrecedingSecondarySource,
  ToaCategory,
} from "../toa";

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

  test("finds and groups cases (deduped, name preserved, with court/year)", () => {
    expect(g.cases).toContain("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)");
    expect(g.cases).toContain("Mayo v. Prometheus, 566 U.S. 66 (2012)");
    expect(g.cases).toContain("In re Bilski, 545 F.3d 943 (Fed. Cir. 2008)");
    // The Alice case is cited twice (different pincites) but appears once.
    expect(g.cases.filter((c) => c.startsWith("Alice Corp.")).length).toBe(1);
  });

  test("cases are alphabetized (ignoring a leading 'In re')", () => {
    // Alice, Bilski (In re → sorts as 'bilski'), Mayo
    expect(g.cases).toEqual([
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)",
      "In re Bilski, 545 F.3d 943 (Fed. Cir. 2008)",
      "Mayo v. Prometheus, 566 U.S. 66 (2012)",
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
    expect(g.cases).toEqual(["Ass'n for Molecular Pathology v. Myriad Genetics, Inc., 569 U.S. 576 (2013)"]);
  });
});

describe("FRAP 28(a)(3) completeness — rules and unpublished cases", () => {
  test("captures unpublished Westlaw and LEXIS decisions as cases", () => {
    const g = grouped(
      "See BlueRadios, Inc. v. Kopin Corp., Inc., No. 16-CV-2052-JLK, 2017 WL 11546716, at *3 (D. Colo. 2017); " +
        "Hilton v. Kerry, No. 13-11710-TSH, 2013 U.S. Dist. LEXIS 169661, at *2 (D. Mass. 2013)."
    );
    expect(g.cases).toContain("BlueRadios, Inc. v. Kopin Corp., Inc., 2017 WL 11546716 (D. Colo. 2017)");
    expect(g.cases).toContain("Hilton v. Kerry, 2013 U.S. Dist. LEXIS 169661 (D. Mass. 2013)");
  });

  test("captures the F.R.D. reporter", () => {
    const g = grouped("Windsurfing Int'l, Inc. v. Ostermann, 100 F.R.D. 82, 84 (S.D.N.Y. 1983).");
    expect(g.cases).toContain("Windsurfing Int'l, Inc. v. Ostermann, 100 F.R.D. 82 (S.D.N.Y. 1983)");
  });

  test("gathers Fed. R. Civ. P. rules (qualified + bare, collapsed to base rule)", () => {
    const g = grouped(
      "Dismissal under Rule 12(b)(7) is improper. Fed. R. Civ. P. 19(a)(1) governs joinder; " +
        "see also Fed. R. Civ. P. 19(b)."
    );
    expect(g.rules).toEqual(["Fed. R. Civ. P. 12", "Fed. R. Civ. P. 19"]);
  });

  test("does not treat a bare 'Rule 56' as FRCP when no qualified Fed. R. Civ. P. is present", () => {
    const toa = buildTableOfAuthorities("The panel applied Rule 56 to the record.");
    expect(toa.groups.find((x) => x.category === "rules")).toBeUndefined();
  });

  test("Rules sort after Statutes and before Regulations/Other", () => {
    const cats = buildTableOfAuthorities(
      "35 U.S.C. § 101; Fed. R. Civ. P. 19; 37 C.F.R. § 1.84; 85 Fed. Reg. 100."
    ).groups.map((x) => x.category);
    expect(cats).toEqual(["statutes", "rules", "regulations", "other"]);
  });
});

describe("case-name robustness (diacritics, en-dash, foreign/firm parties)", () => {
  test("keeps diacritics in a party name", () => {
    const g = grouped("Bacardi Int'l Ltd. v. V. Suárez & Co., 719 F.3d 1, 11 (1st Cir. 2013).");
    expect(g.cases).toContain("Bacardi Int'l Ltd. v. V. Suárez & Co., 719 F.3d 1 (1st Cir. 2013)");
  });

  test("does not truncate a leading multi-word name across an en-dash", () => {
    const g = grouped("See Israel Bio–Eng'g Project v. Amgen Inc., 475 F.3d 1256, 1267 (Fed. Cir. 2007).");
    expect(g.cases).toContain("Israel Bio–Eng'g Project v. Amgen Inc., 475 F.3d 1256 (Fed. Cir. 2007)");
  });

  test("keeps a leading foreign corporate designator (Televisa, S.A. de C.V.)", () => {
    const g = grouped("Televisa, S.A. de C.V. v. Koch Lorber Films, 382 F. Supp. 2d 631 (S.D.N.Y. 2005).");
    expect(g.cases).toContain("Televisa, S.A. de C.V. v. Koch Lorber Films, 382 F. Supp. 2d 631 (S.D.N.Y. 2005)");
  });

  test("keeps a comma-separated law-firm party name", () => {
    const g = grouped(
      "BlueRadios, Inc. v. Hamilton, Brook, Smith & Reynolds, P.C., 166 F.4th 197, 205 (1st Cir. 2026)."
    );
    expect(g.cases).toContain("BlueRadios, Inc. v. Hamilton, Brook, Smith & Reynolds, P.C., 166 F.4th 197 (1st Cir. 2026)");
  });
});

describe("citationRegister", () => {
  test("counts repeated full-form citations and flags them", () => {
    const reg = citationRegister(
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014); later Alice Corp. v. CLS Bank Int'l, " +
        "573 U.S. 208, 217 (2014); and Mayo v. Prometheus, 566 U.S. 66 (2012). Also 35 U.S.C. § 101; 35 U.S.C. § 101."
    );
    expect(reg.authorities).toBe(3); // Alice, Mayo, § 101
    expect(reg.citations).toBe(5); // 2 Alice + 1 Mayo + 2 statute
    const alice = reg.entries.find((e) => e.plain.startsWith("Alice"));
    expect(alice?.count).toBe(2);
    expect(reg.repeated.map((e) => e.plain)).toEqual([
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)",
      "35 U.S.C. § 101",
    ]);
  });

  test("orders entries by category then alphabetically, with headings", () => {
    const reg = citationRegister("Fed. R. Civ. P. 19; Mayo v. Prometheus, 566 U.S. 66 (2012); 35 U.S.C. § 101.");
    expect(reg.entries.map((e) => [e.heading, e.plain])).toEqual([
      ["Cases", "Mayo v. Prometheus, 566 U.S. 66 (2012)"],
      ["Statutes", "35 U.S.C. § 101"],
      ["Rules", "Fed. R. Civ. P. 19"],
    ]);
  });

  test("empty text yields an empty register", () => {
    const reg = citationRegister("No citations here at all.");
    expect(reg).toEqual({ entries: [], authorities: 0, citations: 0, repeated: [] });
  });
});

describe("parseToaPages", () => {
  // A built TOA renders each entry as "Name<tab>pages" (dot leader is visual only).
  const BUILT_TOA =
    "TABLE OF AUTHORITIES\n" +
    "Cases\n" +
    "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208\t6, 8\n" +
    "Mayo v. Prometheus, 566 U.S. 66\t13\n" +
    "Statutes\n" +
    "35 U.S.C. § 101\t2, 5, 9\n";

  test("maps each authority to its page list", () => {
    const pages = parseToaPages(BUILT_TOA);
    expect(pages.get(toaEntryKey("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208"))).toBe("6, 8");
    expect(pages.get(toaEntryKey("Mayo v. Prometheus, 566 U.S. 66"))).toBe("13");
    expect(pages.get(toaEntryKey("35 U.S.C. § 101"))).toBe("2, 5, 9");
    // Category headings and the title carry no tab+pages and are ignored.
    expect(pages.has(toaEntryKey("Cases"))).toBe(false);
  });

  test("matches keys despite curly/straight quotes and trailing punctuation", () => {
    const pages = parseToaPages("Bacardi Int’l Ltd. v. V. Suárez & Co., 719 F.3d 1\tiv, 13\n");
    expect(pages.get(toaEntryKey("Bacardi Int'l Ltd. v. V. Suárez & Co., 719 F.3d 1."))).toBe("iv, 13");
  });

  test("ignores prose lines with no tab-delimited page list", () => {
    expect(parseToaPages("Some ordinary sentence with a 42 in it.\nAnother line.").size).toBe(0);
  });
});

describe("isTaFieldCode", () => {
  test("matches TA (citation) field instructions, not TOA or others", () => {
    expect(isTaFieldCode(' TA \\l "Alice Corp. v. CLS Bank Int\'l, 573 U.S. 208" \\c 1 ')).toBe(true);
    expect(isTaFieldCode("TA \\l \"X\" \\c 2")).toBe(true);
    expect(isTaFieldCode(' TOA \\c "1" \\p ')).toBe(false); // the table field itself
    expect(isTaFieldCode(' DATE \\@ "MMMM d, yyyy" ')).toBe(false);
    expect(isTaFieldCode(" TOC \\o \"1-3\" \\h ")).toBe(false);
    expect(isTaFieldCode("")).toBe(false);
    expect(isTaFieldCode(null)).toBe(false);
  });
});

describe("isTableFieldCode", () => {
  test("matches TOC and TOA table fields, not TA marks or others", () => {
    expect(isTableFieldCode(' TOA \\c "1" \\p ')).toBe(true);
    expect(isTableFieldCode(' TOC \\o "1-3" \\h \\z \\u ')).toBe(true);
    expect(isTableFieldCode(' TA \\l "X" \\c 1 ')).toBe(false); // a citation mark, not a table
    expect(isTableFieldCode(' DATE \\@ "MMMM d, yyyy" ')).toBe(false);
    expect(isTableFieldCode(null)).toBe(false);
  });
});

describe("tocFieldOoxml", () => {
  test("emits a centered heading and a TOC field over heading levels 1–3", () => {
    const xml = tocFieldOoxml(3);
    expect(xml).toContain("<pkg:package");
    expect(xml).toContain("<w:t xml:space=\"preserve\">TABLE OF CONTENTS</w:t>");
    expect(xml).toContain(' TOC \\o "1-3" \\h \\z \\u ');
    expect(xml).toContain('fldCharType="begin"');
  });

  test("title is Times New Roman, bold, underlined, centered", () => {
    const xml = tocFieldOoxml();
    expect(xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:sz w:val="24"/>');
  });

  test("clamps the level count into 1–9", () => {
    expect(tocFieldOoxml(0)).toContain('TOC \\o "1-1"');
    expect(tocFieldOoxml(42)).toContain('TOC \\o "1-9"');
    expect(tocFieldOoxml()).toContain('TOC \\o "1-3"');
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

describe("native Word TOA (TA/TOA fields)", () => {
  const marks = authoritiesForToa(
    "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014); 35 U.S.C. § 101; 37 C.F.R. § 1.84; U.S. Patent No. 10,123,456."
  );

  test("authoritiesForToa returns marks with a category number and a verbatim locator", () => {
    const alice = marks.find((mk) => mk.long.startsWith("Alice"));
    expect(alice).toMatchObject({ category: "cases", categoryNum: 1, locator: "573 U.S. 208" });
    expect(marks.find((mk) => mk.long === "35 U.S.C. § 101")).toMatchObject({ categoryNum: 2, locator: "35 U.S.C. § 101" });
    // Patents share Word's "Other Authorities" category (3).
    expect(marks.find((mk) => mk.long.startsWith("U.S. Patent"))).toMatchObject({ category: "patents", categoryNum: 3 });
  });

  test("taFieldOoxml emits a TA field with the case name in an italic run", () => {
    const xml = taFieldOoxml("Alice Corp. v. CLS Bank Int'l", ", 573 U.S. 208 (2014)", 1);
    expect(xml).toContain('<pkg:package');
    expect(xml).toContain('fldCharType="begin"');
    expect(xml).toContain(' TA \\l "'); // opening of the \l value
    expect(xml).toContain("<w:rPr><w:i/><w:iCs/></w:rPr><w:instrText xml:space=\"preserve\">Alice Corp. v. CLS Bank Int'l</w:instrText>");
    expect(xml).toContain(', 573 U.S. 208 (2014)" \\c 1 ');
  });

  test("taFieldOoxml swaps inner double-quotes and escapes ampersands", () => {
    const xml = taFieldOoxml("Smith & Co. v. Jones", ", 100 F.3d 1", 1);
    expect(xml).toContain("Smith &amp; Co. v. Jones");
  });

  test("taFieldOoxml with no name (statute) emits a plain roman \\l value", () => {
    const xml = taFieldOoxml("", "35 U.S.C. § 101", 2);
    expect(xml).toContain(' TA \\l "35 U.S.C. § 101" \\c 2 ');
    expect(xml).not.toContain("<w:i/>");
  });

  test("toaFieldsOoxml emits a TOA field per present category, in Bluebook order", () => {
    const xml = toaFieldsOoxml([2, 1, 3]); // statutes, cases, other
    expect(xml).toContain("TABLE OF AUTHORITIES");
    expect(xml).toContain('<w:u w:val="single"/>'); // title underlined
    // Cases (1) before Statutes (2) before Other (3); Regulations (6) omitted.
    const iCases = xml.indexOf('TOA \\c "1"');
    const iStat = xml.indexOf('TOA \\c "2"');
    const iOther = xml.indexOf('TOA \\c "3"');
    expect(iCases).toBeGreaterThan(-1);
    expect(iStat).toBeGreaterThan(iCases);
    expect(iOther).toBeGreaterThan(iStat);
    expect(xml).not.toContain('TOA \\c "6"');
  });
});

describe("findPrecedingSecondarySource (supra)", () => {
  test("detects a law-review article and derives the supra short form", () => {
    const src = findPrecedingSecondarySource(
      "As one scholar put it, Mark A. Lemley, Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905, 912 (2013), the doctrine shifted."
    );
    expect(src?.short).toBe("Lemley");
    expect(src?.author).toBe("Mark A. Lemley");
  });

  test("returns the last article when several appear", () => {
    const src = findPrecedingSecondarySource(
      "See John Doe, First Piece, 100 Harv. L. Rev. 1 (2019); Jane P. Roe, Second Piece, 55 Stan. L. Rev. 200 (2021)."
    );
    expect(src?.short).toBe("Roe");
  });

  test("handles two authors joined by &", () => {
    const src = findPrecedingSecondarySource("A. B. Smith & C. D. Jones, A Study, 90 Yale L.J. 10 (2018).");
    expect(src?.short).toBe("Smith & Jones");
  });

  test("does not treat a case citation as a secondary source", () => {
    expect(findPrecedingSecondarySource("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)")).toBeNull();
    expect(findPrecedingSecondarySource("The statute, 35 U.S.C. § 101, controls.")).toBeNull();
  });
});

describe("toaToHtml", () => {
  test("renders a heading, group sub-headings, and italic case names", () => {
    const html = toaToHtml(buildTableOfAuthorities(BRIEF));
    expect(html).toContain("<b><u>TABLE OF AUTHORITIES</u></b>");
    expect(html).toContain("Times New Roman");
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
