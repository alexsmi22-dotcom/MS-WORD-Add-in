// v2.193 documents fix round — Table of Authorities, Bluebook citations, the
// patent audit and numerals, IEEE/Chicago/DOI. Every row here was reproduced by
// the reviewer's probe scripts before the fix; each pins the corrected outcome.

import {
  abbreviateCaseName,
  caseShortName,
  citationById,
  formatDate,
  normalizeCourt,
  parseCitation,
} from "../citations";
import { authoritiesForToa, buildTableOfAuthorities, toaOccurrenceReport } from "../toa";
import { auditDocument } from "../audit";
import { extractNumerals, reconcileNumerals } from "../numerals";
import { formatReference } from "../bibStyles";
import { findDois } from "../doi";
import type { BibRecord } from "../bibRecord";

const fmt = (id: string, fields: Record<string, string>): string =>
  citationById(id)!.format((k) => (fields[k] ?? "").trim()).plain;

const toa = (text: string) => buildTableOfAuthorities(text);
const rows = (text: string, heading: string): string[] =>
  toa(text).groups.filter((g) => g.heading === heading).flatMap((g) => g.entries.map((e) => e.plain));
const caseNames = (text: string): string[] => toa(text).groups.filter((g) => g.category === "cases").flatMap((g) => g.entries.map((e) => e.name));

/** Wall time of one call after a warm-up (a gross bound against exponential
 *  backtracking — the pre-fix code took hours on these inputs). */
function ms(f: () => unknown): number {
  f();
  const t = Date.now();
  f();
  return Date.now() - t;
}

// --- 1. TOA case names are not cut at an abbreviation ------------------------
describe("1. TOA keeps case names whole across T6/T10 abbreviations", () => {
  const names = [
    "Dow Chem. Co. v. Mee Indus.",
    "Allied Chem. Corp. v. Daiflon, Inc.",
    "Consol. Edison Co. v. NLRB",
    "Exxon Chem. Pats., Inc. v. Lubrizol Corp.",
    "Constr. Indus. Ass'n v. City of Petaluma",
    "Intell. Ventures I LLC v. Symantec Corp.",
    "Chem. Separation Tech., Inc. v. United States",
    "Petrol. Helicopters, Inc. v. Avco Corp.",
    "Becton, Dickinson & Co. v. Tyco Healthcare Grp. LP",
    "Mut. Pharm. Co. v. Bartlett",
    "Sw. Bell Tel. Co. v. FCC",
    "Envtl. Def. v. Duke Energy Corp.",
  ];
  test.each(names)("%s", (n) => {
    expect(caseNames(`The court so held. ${n}, 341 F.3d 1370 (Fed. Cir. 2003).`)).toEqual([n]);
  });
  test("the Becton relaxation does not glue a transition word onto the party", () => {
    expect(caseNames("However, Acme Co. v. Widget Inc., 1 F.3d 2 (Fed. Cir. 2000).")).toEqual(["Acme Co. v. Widget Inc."]);
    expect(caseNames("Likewise, Smith v. Jones, 1 F.3d 2 (Fed. Cir. 2000).")).toEqual(["Smith v. Jones"]);
  });
  test("a real sentence end before a case is still cut", () => {
    expect(caseNames("So held the Supreme Court. Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012).")).toEqual([
      "Mayo Collaborative Servs. v. Prometheus Labs., Inc.",
    ]);
  });
});

// --- 2. T6 gaps: one TOA row per case, Abbreviate complete ---------------------
describe("2. T6 words that were missing", () => {
  test.each([
    ["Teva Pharmaceuticals USA, Inc. v. Sandoz", "Teva Pharms. USA, Inc. v. Sandoz"],
    ["Dow Chemical Co. v. Mee Industries", "Dow Chem. Co. v. Mee Indus."],
    ["Western Electric Co. v. Piezo", "W. Elec. Co. v. Piezo"],
    ["Northern Natural Gas Co. v. Eastern Pipeline", "N. Nat. Gas Co. v. E. Pipeline"],
    ["Southern Pacific v. Southwestern Bell", "S. Pac. v. Sw. Bell"],
    ["Washington Mutual Bank v. Ohio", "Wash. Mut. Bank v. Ohio"],
    ["Environmental Defense v. Duke Energy", "Envtl. Def. v. Duke Energy"],
    ["Microsoft Corp. v. i4i Limited Partnership", "Microsoft Corp. v. i4i Ltd. P'ship"],
    ["State Street Bank & Trust Co. v. Signature", "State St. Bank & Tr. Co. v. Signature"],
    ["Consolidated Edison v. Construction Industry", "Consol. Edison v. Constr. Indus."],
    ["Intellectual Ventures v. Symantec", "Intell. Ventures v. Symantec"],
  ])("%s → %s", (input, out) => {
    expect(abbreviateCaseName(input)).toBe(out);
  });
  test("compass words never break T10 names or hyphenated names", () => {
    expect(abbreviateCaseName("North Carolina v. Alford")).toBe("North Carolina v. Alford");
    expect(abbreviateCaseName("Smith v. West Virginia")).toBe("Smith v. West Virginia");
    expect(abbreviateCaseName("Novartis v. West-Ward Pharmaceuticals")).toBe("Novartis v. West-Ward Pharms.");
    expect(abbreviateCaseName("Smith v. Northern Mariana Islands Ret. Fund")).toContain("Northern Mariana Islands");
  });
  test("full and abbreviated spellings are ONE table row", () => {
    const doc =
      "Teva Pharmaceuticals USA, Inc. v. Sandoz, Inc., 574 U.S. 318 (2015). Teva Pharms. USA, Inc. v. Sandoz, Inc., 574 U.S. 318 (2015). " +
      "Western Electric Co. v. Piezo Tech., Inc., 860 F.2d 428 (Fed. Cir. 1988). W. Elec. Co. v. Piezo Tech., Inc., 860 F.2d 428 (Fed. Cir. 1988). " +
      "Dow Chemical Co. v. Mee Indus., 341 F.3d 1370 (Fed. Cir. 2003). Dow Chem. Co. v. Mee Indus., 341 F.3d 1370 (Fed. Cir. 2003).";
    expect(toa(doc).groups.find((g) => g.category === "cases")!.entries).toHaveLength(3);
  });
});

// --- 3. Rules --------------------------------------------------------------------
describe("3. Federal rules", () => {
  test("Fed. R. Evid. is captured without a 'P.'", () => {
    expect(rows("Expert testimony: Fed. R. Evid. 702.", "Rules")).toEqual(["Fed. R. Evid. 702"]);
  });
  test("Crim., App., Bankr. procedure rules", () => {
    expect(rows("Fed. R. Crim. P. 11; Fed. R. App. P. 28(a)(3); Fed. R. Bankr. P. 3001.", "Rules")).toEqual([
      "Fed. R. App. P. 28",
      "Fed. R. Bankr. P. 3001",
      "Fed. R. Crim. P. 11",
    ]);
  });
  test("'Rule 702 of the Federal Rules of Evidence' is FRE 702, never FRCP; bare Rule 403 is refused by name", () => {
    const doc = "Under Fed. R. Civ. P. 26, and Rule 702 of the Federal Rules of Evidence, and Fed. R. Evid. 702. Rule 403 also.";
    const t = toa(doc);
    expect(rows(doc, "Rules")).toEqual(["Fed. R. Civ. P. 26", "Fed. R. Evid. 702"]);
    expect(t.refused?.map((r) => r.text)).toEqual(["Rule 403"]);
    expect(t.refused?.[0].reason).toMatch(/end at Rule 86/);
  });
  test("'Federal Rule of Civil Procedure 12(b)(6)' and a bare in-range Rule still list as FRCP", () => {
    expect(rows("Federal Rule of Civil Procedure 12(b)(6) applies. Fed. R. Civ. P. 56. Rule 56(a).", "Rules")).toEqual([
      "Fed. R. Civ. P. 12",
      "Fed. R. Civ. P. 56",
    ]);
  });
});

// --- 4. Federal Register --------------------------------------------------------
describe("4. Federal Register", () => {
  test("1076 and 1,076 are one row, shown per Rule 6.2(a)", () => {
    expect(rows("See 77 Fed. Reg. 1076 (Jan. 9, 2012). Also 77 Fed. Reg. 1,076 (Jan. 9, 2012).", "Other Authorities")).toEqual([
      "77 Fed. Reg. 1076",
    ]);
    expect(rows("84 Fed. Reg. 50057 (Jan. 7, 2019).", "Other Authorities")).toEqual(["84 Fed. Reg. 50,057"]);
  });
  test("the form: commas only from five digits", () => {
    expect(fmt("fedreg", { vol: "77", page: "1,076", date: "2012-01-09" })).toBe("77 Fed. Reg. 1076 (Jan. 9, 2012)");
    expect(fmt("fedreg", { vol: "84", page: "50057", date: "2019-01-07" })).toBe("84 Fed. Reg. 50,057 (Jan. 7, 2019)");
  });
});

// --- 5. Secondary sources and court rules ----------------------------------------
describe("5. Other Authorities and court rules (FRAP 28(a)(3))", () => {
  const doc =
    "Fed. Cir. R. 36. Sup. Ct. R. 10. Restatement (Second) of Torts § 402A (Am. L. Inst. 1965). " +
    "5 Donald S. Chisum, Chisum on Patents § 18.02 (2020). Mark A. Lemley, Software Patents, 2013 Wis. L. Rev. 905, 912 (2013). " +
    "See Dan L. Burk, Patent Silences, 62 Am. U. L. Rev. 1 (2012).";
  test("court rules are listed under Rules", () => {
    expect(rows(doc, "Rules")).toEqual(["Fed. Cir. R. 36", "Sup. Ct. R. 10"]);
  });
  test("Restatement, treatise and articles are listed under Other Authorities", () => {
    expect(rows(doc, "Other Authorities")).toEqual([
      "Restatement (Second) of Torts § 402A (Am. L. Inst. 1965)",
      "Dan L. Burk, Patent Silences, 62 Am. U. L. Rev. 1 (2012)",
      "Mark A. Lemley, Software Patents, 2013 Wis. L. Rev. 905",
      "5 Donald S. Chisum, Chisum on Patents § 18.02 (2020)",
    ]);
  });
  test("an article title is italic in the HTML entry", () => {
    const e = toa(doc).groups.flatMap((g) => g.entries).find((x) => x.plain.startsWith("Mark A. Lemley"))!;
    expect(e.html).toContain("<i>Software Patents</i>");
  });
  test("a secondary source the scan cannot read is reported, not silently dropped", () => {
    const t = toa("As the Restatement explains, see also 12 Harv. L. Rev. 45, nothing more.");
    expect(t.total).toBe(0);
    expect(t.refused?.map((r) => r.text)).toEqual(["Restatement", "12 Harv. L. Rev. 45"]);
  });
});

// --- 6. Short names (Rule 10.9(a)(i)) -------------------------------------------
describe("6. caseShortName", () => {
  test.each([
    ["Gen. Elec. Co. v. Joiner", "Gen. Elec."],
    ["Lab. Corp. of Am. Holdings v. Metabolite Labs., Inc.", "Lab. Corp."],
    ["Am. Axle & Mfg., Inc. v. Neapco Holdings LLC", "Am. Axle"],
    ["Int'l Bus. Machs. Corp. v. Zillow", "Int'l Bus. Machs."],
    ["Dir. of Revenue v. X", "Dir. of Revenue"],
    ["State Street Bank & Trust Co. v. Signature Fin. Grp.", "State St. Bank"],
    ["TC Heartland LLC v. Kraft Foods Grp. Brands LLC", "TC Heartland"],
    ["J.E.M. Ag Supply, Inc. v. Pioneer Hi-Bred Int'l, Inc.", "J.E.M. Ag Supply"],
    // Earlier pinned outcomes that must not move.
    ["Alice Corp. v. CLS Bank Int'l", "Alice"],
    ["Mayo Collaborative Servs. v. Prometheus Labs., Inc.", "Mayo"],
    ["United States v. Alvarez", "Alvarez"],
    ["State v. Robinson", "Robinson"],
    ["Commissioner v. Banks", "Banks"],
    ["In re Wands", "Wands"],
    ["Ex parte Jones", "Jones"],
    ["de Vries v. Doe", "de Vries"],
    ["Ass'n for Molecular Pathology v. Myriad Genetics, Inc.", "Myriad"],
    ["Bd. of Regents v. Roth", "Roth"],
    ["SAS Inst., Inc. v. Iancu", "SAS"],
    ["KSR Int'l Co. v. Teleflex Inc.", "KSR"],
    ["eBay Inc. v. MercExchange, L.L.C.", "eBay"],
    ["Teva Pharms. USA, Inc. v. Sandoz, Inc.", "Teva"],
    ["Nautilus, Inc. v. Biosig Instruments, Inc.", "Nautilus"],
  ])("%s → %s", (name, short) => {
    expect(caseShortName(name)).toBe(short);
  });

  test("TOA short-form recall: every short cite in the reviewer's brief is still found", () => {
    const head =
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014). Gen. Elec. Co. v. Joiner, 522 U.S. 136 (1997). " +
      "eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006). TC Heartland LLC v. Kraft Foods Grp. Brands LLC, 581 U.S. 258 (2017). " +
      "State St. Bank & Tr. Co. v. Signature Fin. Grp., Inc., 149 F.3d 1368 (Fed. Cir. 1998). In re Wands, 858 F.2d 731, 737 (Fed. Cir. 1988). " +
      "Nat'l Collegiate Athletic Ass'n v. Alston, 594 U.S. 69 (2021). Cal. Inst. of Tech. v. Broadcom Ltd., 25 F.4th 976 (Fed. Cir. 2022).";
    const later =
      head +
      " Alice, 573 U.S. at 217. Gen. Elec., 522 U.S. at 140. Joiner, 522 U.S. at 141. TC Heartland, 581 U.S. at 262." +
      " State St., 149 F.3d at 1373. State St. Bank, 149 F.3d at 1374. Cal. Inst. of Tech., 25 F.4th at 980. eBay, 547 U.S. at 391." +
      " Wands, 858 F.2d at 740. Alston, 594 U.S. at 81.";
    const shorts = toaOccurrenceReport(later, authoritiesForToa(later))
      .occurrences.filter((o) => o.kind === "short")
      .map((o) => o.text);
    expect(shorts).toEqual([
      "Alice, 573 U.S. at 217",
      "Gen. Elec., 522 U.S. at 140",
      "Joiner, 522 U.S. at 141",
      "TC Heartland, 581 U.S. at 262",
      "State St., 149 F.3d at 1373",
      "State St. Bank, 149 F.3d at 1374",
      "Cal. Inst. of Tech., 25 F.4th at 980",
      "eBay, 547 U.S. at 391",
      "Wands, 858 F.2d at 740",
      "Alston, 594 U.S. at 81",
    ]);
  });
});

// --- 7. Courts ---------------------------------------------------------------------
describe("7. normalizeCourt (T7)", () => {
  test.each([
    ["2nd Cir.", "2d Cir."],
    ["3rd Cir.", "3d Cir."],
    ["2d cir", "2d Cir."],
    ["3d Cir", "3d Cir."],
    ["second circuit", "2d Cir."],
    ["third circuit", "3d Cir."],
    ["1st circuit", "1st Cir."],
    ["9th cir", "9th Cir."],
  ])("%s → %s", (raw, out) => {
    expect(normalizeCourt(raw)).toBe(out);
  });
  test("the case form prints 2d Cir.", () => {
    expect(fmt("case", { name: "X v. Y", vol: "5", reporter: "F.3d", page: "1", court: "2nd Cir", year: "2001" })).toBe("X v. Y, 5 F.3d 1 (2d Cir. 2001)");
  });
});

// --- 8. No freeze ---------------------------------------------------------------------
describe("8. no catastrophic backtracking", () => {
  test("40 commas with no closing parenthesis: case and article detection return promptly", () => {
    const pins = "Smith v. Jones, 5 F.3d 1" + ", 12".repeat(40) + " (Fed. Cir.";
    const prose =
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216, where the Court held that the claims, " + "a widget, ".repeat(40) + "were ineligible";
    const article = "Mark A. Lemley, Title" + ", Part".repeat(40) + ", 2013 Wis. L. Rev. 905, 912 (x";
    for (const s of [pins, prose, article]) {
      expect(ms(() => parseCitation(s))).toBeLessThan(250);
    }
    expect(parseCitation(pins)).toBeNull();
  });
  test("adversarial 5 kB inputs to every scanner return promptly", () => {
    const inputs = [
      "Smith v. Jones, 5 F.3d 1" + ", 12".repeat(1500) + " (Fed. Cir.",
      "A v. B, " + "1, ".repeat(1700) + "x",
      "Mark A. Lemley, Title, 12 J." + "ABCDEFGHIJ".repeat(500) + " x",
      "Mark A. Lemley, Title, 12 J." + " Am".repeat(1500) + " x",
      "Alpha Beta, ".repeat(450) + "v. ",
      "Smith Jones Brown Lee Kim Park Wong v. Acme Widget Corp Inc LLC Holding, ".repeat(70),
      "Restatement (Second) of " + "Torts ".repeat(850),
      "5 Donald S. Chisum, " + "Chisum on ".repeat(500) + "§",
      "Rule 702 of the Federal Rules of " + "Evidence ".repeat(550),
      "(".repeat(5000),
      "35 U.S.C. §§ " + "1, ".repeat(1700) + "x",
      "Fed. Cir. R. " + "1.".repeat(2500),
    ];
    for (const s of inputs) {
      expect(ms(() => parseCitation(s))).toBeLessThan(500);
      expect(ms(() => buildTableOfAuthorities(s))).toBeLessThan(500);
      expect(ms(() => toaOccurrenceReport(s, authoritiesForToa(s)))).toBeLessThan(500);
    }
  });
  test("spelled-number scan on a long run of number words", () => {
    const s = "twenty ".repeat(800) + "(20) and housing (10)";
    expect(ms(() => extractNumerals(s, [10]))).toBeLessThan(250);
  });
});

// --- 9. IEEE edition period ----------------------------------------------------------
describe("9. IEEE never prints 'ed..'", () => {
  const N = (family: string, given: string) => ({ family, given });
  test("book", () => {
    const f = formatReference("ieee", { id: "b", type: "book", title: "Robot vision", author: [N("Horn", "B.")], publisher: "MIT Press", "publisher-place": "Cambridge, MA, USA", edition: "3rd ed.", issued: { "date-parts": [[1986]] } }, 1);
    expect(f.ok && f.value.plain).toBe("B. Horn, Robot vision, 3rd ed. Cambridge, MA, USA: MIT Press, 1986.");
  });
  test("chapter", () => {
    const f = formatReference("ieee", { id: "c", type: "chapter", title: "Ch", author: [N("A", "B.")], "container-title": "Book", editor: [N("E", "F.")], edition: "2", publisher: "P", "publisher-place": "X", page: "1-5", issued: { "date-parts": [[2000]] } }, 1);
    expect(f.ok && f.value.plain).toBe("B. A, “Ch,” in Book, F. E, Ed., 2nd ed. X: P, 2000, pp. 1–5.");
  });
});

// --- 10–12. Audit and numerals ---------------------------------------------------
describe("10–12. audit and numerals", () => {
  test("10. table numerals in the 1800–2199 band are callouts, not years", () => {
    const tbl = [{ numeral: 1800, element: "housing" }, { numeral: 1802, element: "lid" }];
    expect(extractNumerals("The housing (1800) has a lid (1802). Smith (2014).", [1800, 1802])).toEqual([1800, 1802]);
    const r = auditDocument({ documentText: "The housing (1800) has a lid (1802).", numerals: tbl, listingCount: 0 });
    expect(r.sections[0].issues).toEqual([]);
  });
  test("10. the audit passes the text, so 'housing 10' (no parentheses) counts as a use", () => {
    const r = auditDocument({ documentText: "The housing 10 has a lid 12.", numerals: [{ numeral: 10, element: "housing" }, { numeral: 12, element: "lid" }], listingCount: 0 });
    expect(r.sections[0].issues).toEqual([]);
  });
  test("11. a patent application (Brief Description section) is not flagged for uncaptioned FIG. N", () => {
    const spec =
      "BRIEF DESCRIPTION OF THE DRAWINGS\nFIG. 1 is a perspective view.\nFIG. 2 is a section view.\nDETAILED DESCRIPTION\nAs shown in FIG. 1 and Fig. 2, see Table 1.";
    const cross = auditDocument({ documentText: spec, numerals: [], listingCount: 0 }).sections.find((s) => s.title === "Cross-references")!;
    expect(cross.issues).toEqual(["Referenced without a caption: Table 1"]);
  });
  test("11. a document without that section is still checked for figure captions", () => {
    const cross = auditDocument({ documentText: "As shown in Fig. 1, the result holds.", numerals: [], listingCount: 0 }).sections.find((s) => s.title === "Cross-references")!;
    expect(cross.issues).toEqual(["Referenced without a caption: Fig. 1"]);
  });
  test("12. '(N)' after the same spelled-out number is a quantity; other callouts stay", () => {
    const x = "The housing (10) is heated for about twenty (20) minutes, then the lid (12) closes within thirty-five (35) seconds; one (14) more.";
    expect(extractNumerals(x, [10, 12, 14])).toEqual([10, 12, 14]);
    expect(extractNumerals("a first housing (12) and a second housing (14)", [12, 14])).toEqual([12, 14]);
    expect(extractNumerals("one hundred and twenty (120) cycles; a gear (100)", [100])).toEqual([100]);
    expect(reconcileNumerals([{ numeral: 10, element: "housing" }], extractNumerals("housing (10) for ten (10) days", [10])).ok).toBe(true);
  });
});

// --- 13. parseCitation and the form -----------------------------------------------
describe("13. parseCitation / form details", () => {
  test("trailing (en banc) is parsed and kept", () => {
    const p = parseCitation("In re Bilski, 545 F.3d 943, 950 (Fed. Cir. 2008) (en banc).")!;
    expect(p.typeId).toBe("case");
    expect(p.fields).toMatchObject({ name: "In re Bilski", court: "Fed. Cir.", year: "2008", pin: "950", explan: "(en banc)" });
    expect(fmt("case", p.fields)).toBe("In re Bilski, 545 F.3d 943, 950 (Fed. Cir. 2008) (en banc)");
  });
  test("(per curiam) and a nested (quoting …) parenthetical", () => {
    const p = parseCitation("Smith v. Jones, 5 F.3d 1, 3 (2d Cir. 2001) (per curiam) (quoting Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66, 72 (2012))")!;
    expect(p.fields.year).toBe("2001");
    expect(p.fields.explan).toBe("(per curiam) (quoting Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66, 72 (2012))");
  });
  test("T12 months for a spelled patent date", () => {
    expect(fmt("patent", { number: "7,654,321", date: "September 20, 1983" })).toBe("U.S. Patent No. 7,654,321 (issued Sept. 20, 1983)");
    expect(formatDate("June 4, 2019")).toBe("June 4, 2019");
    expect(formatDate("jan 5 2015")).toBe("Jan. 5, 2015");
    expect(formatDate("February 30, 2019")).toBe("February 30, 2019");
  });
  test("form hyphens become en dashes in line, page and section ranges — but not inside one section number", () => {
    expect(fmt("patent", { number: "7,654,321", pin: "col. 3 ll. 15-20" })).toBe("U.S. Patent No. 7,654,321 col. 3 ll. 15–20");
    expect(fmt("usc", { title: "35", section: "101-103" })).toBe("35 U.S.C. §§ 101–103");
    expect(fmt("usc", { title: "42", section: "2000e-2" })).toBe("42 U.S.C. § 2000e-2");
    expect(fmt("cfr", { title: "26", section: "1.6011-4" })).toBe("26 C.F.R. § 1.6011-4");
    expect(fmt("cfr", { title: "37", section: "1.97-1.98" })).toBe("37 C.F.R. §§ 1.97–1.98");
    expect(fmt("case", { name: "A v. B", vol: "1", reporter: "F.3d", page: "200", pin: "205-09", year: "2000" })).toBe("A v. B, 1 F.3d 200, 205–09 (2000)");
  });
  test("a book with no year or edition has no empty parenthetical", () => {
    expect(fmt("book", { author: "A", title: "B", year: "" })).toBe("A, B");
  });
});

// --- reviewer suspicions -----------------------------------------------------------
describe("reviewer suspicions, confirmed against the cited rule", () => {
  const N = (family: string, given: string) => ({ family, given });
  test("IEEE journal article date is 'Abbrev. Month year' (no day)", () => {
    const f = formatReference("ieee", { id: "a", type: "article-journal", title: "T", author: [N("Smith", "J.")], "container-title-short": "J. Am. Chem. Soc.", "container-title": "Journal of the American Chemical Society", volume: "135", issue: "4", page: "1371-1376", issued: { "date-parts": [[2013, 2, 1]] } }, 1);
    expect(f.ok && f.value.plain).toContain("pp. 1371–1376, Feb. 2013.");
  });
  test("Chicago: 'King Jr.' without a comma in normal order, with one when inverted", () => {
    const rec: BibRecord = { id: "p", type: "article-journal", title: "T", author: [N("Waals", "Johannes D."), { family: "King", given: "Martin L.", suffix: "Jr." }], "container-title": "J", volume: "12", page: "99-101", issued: { "date-parts": [[1999]] } };
    const f = formatReference("chicago-ad", rec, 1);
    expect(f.ok && f.value.plain).toContain("and Martin L. King Jr. 1999.");
    const g = formatReference("chicago-ad", { ...rec, author: [{ family: "King", given: "Martin L.", suffix: "Jr." }] }, 1);
    expect(g.ok && g.value.plain).toMatch(/^King, Martin L\., Jr\. 1999\./);
  });
  test("findDois keeps a Wiley SICI DOI whole", () => {
    expect(findDois("refs: 10.1000/182, and 10.1002/(SICI)1097-4636(199706)35:4<439::AID-JBM5>3.0.CO;2-H.")).toEqual([
      "10.1000/182",
      "10.1002/(SICI)1097-4636(199706)35:4<439::AID-JBM5>3.0.CO;2-H",
    ]);
  });
});
