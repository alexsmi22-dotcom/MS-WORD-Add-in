/**
 * INDEPENDENT ADVERSARIAL REVIEW, v2.142.0 "Citation styles, BibTeX/RIS import and numbered
 * bibliographies" (docs/SCOPE-CITATIONS-2026-10.md). Written by a reviewer, not a builder.
 *
 *   plain `it`      a real defect that FAILS today (wrong or misleading reference text)
 *   `it.failing`    a cosmetic defect (punctuation, capitalisation, message wording)
 *   passing `it`    a confirmed-correct probe (at most 10)
 *
 * Every input is a real export shape (Crossref, Scopus, Web of Science, Google Scholar, arXiv,
 * PubMed .nbib) or a real chemistry/biology title. Characters that could be look-alikes are built
 * with String.fromCharCode.
 */
import * as fs from "fs";
import * as path from "path";
import type { BibName, BibRecord, BibType, StyleId } from "../bibRecord";
import { STYLES, formatReference } from "../bibStyles";
import { parseBibtex } from "../bibtex";
import { parseRis } from "../ris";
import { collectCitations, importBibText, loadBibStore, planInsert, planUpdate } from "../bibPane";
import { CITE_TAG_PREFIX, addMarker, emptyStore, serializeStore, type BibStoreData } from "../bibStore";
import { CHICAGO_SMALL_WORDS, sentenceCase, titleCase } from "../bibCase";
import { bibliographyOoxml } from "../bibOoxml";

// ------------------------------------------------------------------ helpers

const EN = String.fromCharCode(0x2013);
const LDQ = String.fromCharCode(0x201c);
const RDQ = String.fromCharCode(0x201d);
const DOLLAR = String.fromCharCode(0x24);
const FIX = path.join(__dirname, "fixtures", "bib");
const fixture = (f: string): string => fs.readFileSync(path.join(FIX, f), "utf8");

const p = (family: string, given?: string): BibName => ({ family, ...(given ? { given } : {}) });
let seq = 0;
const R = (type: BibType, f: Omit<BibRecord, "id" | "type">): BibRecord => ({ id: `rv${++seq}`, type, ...f });
const Y = (y: number): BibRecord["issued"] => ({ "date-parts": [[y]] });
const ALL: StyleId[] = ["ieee", "acs", "nature", "vancouver", "apa7", "chicago-ad", "chicago-nb"];

/** Content controls as Word returns them: tag + current text, in document order. */
const ctl = (ids: string[], texts: Record<string, string> = {}): Array<{ tag: string; text: string }> =>
  ids.map((id) => ({ tag: CITE_TAG_PREFIX + id, text: texts[id] ?? "…" }));

function storeOf(style: StyleId, recs: BibRecord[], markers: Record<string, BibStoreData["markers"][string]>): BibStoreData {
  return { ...emptyStore(style), library: Object.fromEntries(recs.map((r) => [r.id, r])), markers };
}

/** Run Update once and return markerId → the text the document shows afterwards. */
function update(st: BibStoreData, order: string[], texts: Record<string, string> = {}): Record<string, string> {
  const kind = STYLES[st.style]!.kind;
  const up = planUpdate(collectCitations(ctl(order, texts), [], kind), st);
  if (!up.ok) throw new Error(up.reason);
  const shown: Record<string, string> = {};
  order.forEach((id) => { shown[id] = texts[id] ?? "…"; });
  for (const rw of up.rewrites) shown[rw.markerId] = rw.plain;
  return shown;
}

// Real export shapes (abridged only by dropping abstract/keyword/affiliation fields).
const SCOPUS_BIB = `@ARTICLE{Smith2020,
author={Smith, J.A. and Doe, J.},
title={Ultrafast Proton Transfer in Water Wires},
journal={Journal of the American Chemical Society},
year={2020},
volume={142},
number={3},
doi={10.1021/jacs.9b12345},
art_number={e123},
note={cited By 5},
url={https://www.scopus.com/inward/record.uri?eid=2-s2.0-85&doi=10.1021%2fjacs&partnerID=40&md5=abc},
abbrev_source_title={J. Am. Chem. Soc.},
document_type={Article},
source={Scopus},
}`;

const WOS_BIB = `@article{ WOS:000123456700001,
Author = {Smith, John A. and Doe, Jane},
Title = {{Ultrafast Proton Transfer in Water Wires}},
Journal = {JOURNAL OF THE AMERICAN CHEMICAL SOCIETY},
Year = {{2020}},
Volume = {{142}},
Number = {{3}},
Pages = {{1234-1239}},
Month = {{JAN 15}},
DOI = {{10.1021/jacs.9b12345}},
Journal-ISO = {J. Am. Chem. Soc.},
Unique-ID = {{WOS:000123456700001}},
}`;

const NBIB = [
  "PMID- 33301246",
  "OWN - NLM",
  "STAT- MEDLINE",
  "IS  - 1533-4406 (Electronic)",
  "VI  - 383",
  "IP  - 27",
  "DP  - 2020 Dec 31",
  "TI  - Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine.",
  "PG  - 2603-2615",
  "LID - 10.1056/NEJMoa2034577 [doi]",
  "FAU - Polack, Fernando P",
  "AU  - Polack FP",
  "FAU - Thomas, Stephen J",
  "AU  - Thomas SJ",
  "TA  - N Engl J Med",
  "JT  - The New England journal of medicine",
  "AID - 10.1056/NEJMoa2034577 [doi]",
  "SO  - N Engl J Med. 2020 Dec 31;383(27):2603-2615. doi: 10.1056/NEJMoa2034577.",
].join("\n");

// ================================================================== REAL DEFECTS (fail today)

describe("defects: wrong or misleading reference text", () => {
  // Input: the repo's own Crossref fixture crossref-kwon2022.bib (Crossref's BibTeX always carries
  //   url={http://dx.doi.org/<DOI>} beside DOI={<DOI>}; Mendeley and Zotero do the same).
  // Output: "H. Kwon, “Inclusion Work: …,” American Journal of Sociology, vol. 127, no. 6,
  //   pp. 1818–1859, May 2022, doi: 10.1086/720277. [Online]. Available: http://dx.doi.org/10.1086/720277"
  // Correct: the IEEE Reference Guide V 3.28.2025 "Periodical With DOI" example (pinned in
  //   bibStyles.oracle.test.ts) ends at the DOI: "… pp. 2787–2793, Oct. 2011, doi: 10.1109/TBME.2011.2158315."
  //   The same identifier must not be printed twice.
  // Owner: bibStyles.ts (ieeeOnline appends the URL unconditionally).
  it("IEEE prints the DOI twice when a Crossref/Mendeley export carries url = dx.doi.org/<DOI>", () => {
    const rec = parseBibtex(fixture("crossref-kwon2022.bib")).records[0];
    const out = STYLES.ieee!.reference(rec).plain;
    expect(out.split("10.1086/720277").length - 1).toBe(1);
    expect(out).not.toMatch(/\[Online\]/);
  });

  // Input: the repo's own Scopus RIS fixture scopus-federico2004.ris (Scopus writes UR = its own
  //   index page, http://www.scopus.com/inward/record.url?eid=…, next to DO).
  // Output: "… doi: 10.1016/j.jmps.2004.03.010. [Online]. Available: http://www.scopus.com/inward/record.url?eid=2-s2.0-…"
  // Correct: as above, the guide's DOI form ends at the DOI; a paywalled index page is not the
  //   work and is printed as if it were where the article is "Available".
  // Owner: bibStyles.ts (ieeeOnline), possibly ris.ts (Scopus UR is an index link, not the work).
  it("IEEE prints a Scopus index-page URL as the article's [Online] location when a DOI is present", () => {
    const rec = parseRis(fixture("scopus-federico2004.ris")).records[0];
    const out = STYLES.ieee!.reference(rec).plain;
    expect(out).toContain("doi: 10.1016/j.jmps.2004.03.010");
    expect(out).not.toMatch(/scopus\.com/);
  });

  // Input: a Scopus BibTeX export (field names exactly as Scopus writes them: art_number,
  //   abbrev_source_title). The article has an article number and no pages.
  // Output: record has no "article-number"; APA prints
  //   "Smith, J. A., & Doe, J. (2020). Ultrafast proton transfer in water wires. Journal of the
  //   American Chemical Society, 142(3). https://doi.org/10.1021/jacs.9b12345" — no locator at all.
  // Correct: APA journal-article examples (APAJ, pinned) print "…, 13(3), Article e0193972. https://doi.org/…".
  // Owner: bibtex.ts (reads eid/articleno/article-number, not Scopus's art_number).
  it("Scopus BibTeX art_number is dropped, so the reference loses its only locator", () => {
    const res = parseBibtex(SCOPUS_BIB);
    expect(res.refused).toEqual([]);
    const rec = res.records[0];
    expect(rec["article-number"]).toBe("e123");
    expect(STYLES.apa7!.reference(rec).plain).toContain("142(3), Article e123.");
    expect(STYLES.ieee!.reference(rec).plain).toContain("Art. no. e123");
  });

  // Input: Web of Science BibTeX (Journal-ISO) and Scopus BibTeX (abbrev_source_title), both
  //   supplying the abbreviation "J. Am. Chem. Soc.".
  // Output: no container-title-short; IEEE prints "JOURNAL OF THE AMERICAN CHEMICAL SOCIETY" in
  //   full capitals and the pane warns "No abbreviation … in the source" although the source gave one.
  // Correct: journalAbbrev.ts's own rule is "an abbreviation is used only when the SOURCE supplied
  //   it"; these sources did. IEEE wants the abbreviated title ("Appl. Phys. Lett.", pinned).
  // Owner: bibtex.ts (short-title field list lacks journal-iso / abbrev_source_title).
  it("the journal abbreviation that WoS (Journal-ISO) and Scopus (abbrev_source_title) supply is ignored", () => {
    const wos = parseBibtex(WOS_BIB).records[0];
    const sco = parseBibtex(SCOPUS_BIB).records[0];
    expect(wos["container-title-short"]).toBe("J. Am. Chem. Soc.");
    expect(sco["container-title-short"]).toBe("J. Am. Chem. Soc.");
    // IEEE guide V 3.28.2025 puts the comma inside the quote: "…computational procedure,” IEEE Trans. Biomed. Eng., vol. 58,"
    expect(STYLES.ieee!.reference(wos).plain).toContain(`,${RDQ} J. Am. Chem. Soc., vol. 142,`);
  });

  // Input: a journal article titled "Chemistry & Biology of Ion Channels"; Chicago NB short note
  //   with a page locator.
  // Output: "Lee, “Chemistry &amp,” 12." — chicagoShortTitle splits the HTML on ";" and the ";"
  //   it finds is the one inside the entity "&amp;". The entity leaks into the plain text, and the
  //   title is cut mid-word.
  // Correct: display contract (no "&amp;" in plain text); CMOS short-title rule as implemented in
  //   the header of chicagoShortTitle: the words before the first small word → "Chemistry & Biology".
  // Owner: bibStyles.ts (chicagoShortTitle works on escaped HTML).
  it("Chicago NB short note leaks “&amp” and cuts the title at the entity's semicolon", () => {
    const rec = R("article-journal", { author: [p("Lee", "Kim")], title: "Chemistry & Biology of Ion Channels",
      "container-title": "Annual Review of Biochemistry", volume: "12", page: "1-20", issued: Y(2019) });
    const short = STYLES["chicago-nb"]!.note!(rec, { id: rec.id, locator: "12", label: "page" }, false);
    expect(short.plain).not.toContain("&amp");
    expect(short.plain).toBe(`Lee, ${LDQ}Chemistry & Biology,${RDQ} 12.`);
  });

  // Input: two APA 7 references, Smith, John (2020) "Alpha" and Smith, Anna (2020) "Beta".
  // Output: markers "(Smith, 2020b)" / "(Smith, 2020a)"; list "Smith, A. (2020a)…", "Smith, J. (2020b)…".
  // Correct (APA 7 Publication Manual §8.20, paraphrased): first authors with the same surname
  //   but different initials are told apart by their initials in the text — "(J. Smith, 2020)",
  //   "(A. Smith, 2020)"; §9.47: the letters a, b are only for works by the SAME author(s) in the
  //   same year. Two different people are presented as one author's two works.
  // Owner: bibliography.ts (year-suffix grouping keys on the bare marker text).
  it("APA: two different authors who share a surname are given 2020a/2020b as if one author", () => {
    const j = R("article-journal", { author: [p("Smith", "John")], title: "Alpha", "container-title": "J", issued: Y(2020) });
    const a = R("article-journal", { author: [p("Smith", "Anna")], title: "Beta", "container-title": "J", issued: Y(2020) });
    const shown = update(storeOf("apa7", [j, a], { "1": [{ id: j.id }], "2": [{ id: a.id }] }), ["1", "2"]);
    expect(shown["1"]).not.toMatch(/2020[ab]/);
    expect(shown["2"]).not.toMatch(/2020[ab]/);
    expect(shown["1"]).not.toBe(shown["2"]);
  });

  // Input: Smith, Jones & Brown (2020) and Smith, Lee & Kim (2020).
  // Output: "(Smith et al., 2020a)" / "(Smith et al., 2020b)", and the list entries
  //   "Smith, J., Jones, K., & Brown, L. (2020a)" and "Smith, J., Lee, M., & Kim, N. (2020b)".
  // Correct (APA 7 §8.18, paraphrased): when works with three or more authors shorten to the same
  //   "et al." form, write out as many names as needed to distinguish them; the year letters of
  //   §9.47 apply only to the same authors in the same order. "(2020a)" on two different author
  //   lists is wrong in the reference list itself.
  // Owner: bibliography.ts.
  it("APA: different author teams that shorten to the same “et al.” form get year letters", () => {
    const g1 = R("article-journal", { author: [p("Smith", "John"), p("Jones", "K"), p("Brown", "L")], title: "Alpha", "container-title": "J", issued: Y(2020) });
    const g2 = R("article-journal", { author: [p("Smith", "John"), p("Lee", "M"), p("Kim", "N")], title: "Beta", "container-title": "J", issued: Y(2020) });
    const st = storeOf("apa7", [g1, g2], { "1": [{ id: g1.id }], "2": [{ id: g2.id }] });
    const up = planUpdate(collectCitations(ctl(["1", "2"]), [], "author-date"), st);
    if (!up.ok) throw new Error(up.reason);
    for (const b of up.plan.bibliography) expect(b.plain).not.toMatch(/\(2020[ab]\)/);
    expect(up.plan.markerText["1"].plain).not.toBe(up.plan.markerText["2"].plain);
  });

  // Input: two undated works by the same author (common for web reports and preprints).
  // Output: both markers read "(Smith, n.d.)" — the reader cannot tell which reference is meant.
  // Correct: APA 7 §9.47 letters undated works too, in the form "(n.d.-a)", "(n.d.-b)".
  // Owner: bibliography.ts (records with no numeric year are skipped by the suffix pass).
  it("APA: two undated works by one author are not disambiguated (two identical “(Smith, n.d.)”)", () => {
    const n1 = R("article-journal", { author: [p("Smith", "John")], title: "Alpha", "container-title": "J" });
    const n2 = R("article-journal", { author: [p("Smith", "John")], title: "Beta", "container-title": "J" });
    const shown = update(storeOf("apa7", [n1, n2], { "1": [{ id: n1.id }], "2": [{ id: n2.id }] }), ["1", "2"]);
    expect(shown["1"]).not.toBe(shown["2"]);
  });

  // Input: title-cased titles "Vitamin A Deficiency in Children", "Protein Kinase A Signaling".
  // Output (APA / Vancouver sentence case): "Vitamin a deficiency in children", "Protein kinase a signaling".
  // Correct: sentence case keeps a capital that is a designation, not the article "a"
  //   (scope §E: sentence-casing must not corrupt such tokens; bibCase.ts header: "single capitals
  //   other than "A"" are kept — the exemption for "A" is applied mid-title, where it is never the
  //   start-of-title article). "Vitamin a" and "protein kinase a" are wrong in a chemistry/biology reference.
  // Owner: bibCase.ts (keepCapital returns false for "A" everywhere).
  it("sentence case turns “Vitamin A” into “Vitamin a” and “Protein Kinase A” into “protein kinase a”", () => {
    expect(sentenceCase("Vitamin A Deficiency in Children", { capitalizeSubtitle: true })).toBe("Vitamin A deficiency in children");
    expect(sentenceCase("Protein Kinase A Signaling in Neurons", { capitalizeSubtitle: true })).toBe("Protein kinase A signaling in neurons");
    const rec = R("article-journal", { author: [p("Doe", "Jane")], title: "Vitamin A Deficiency in Children", "container-title": "J", issued: Y(2020) });
    expect(STYLES.apa7!.reference(rec).plain).toContain("Vitamin A deficiency");
  });

  // Input (IEEE): marker 2 cites a reference later deleted from the library ("gone"); its control
  //   still reads "[1]". Marker 1 cites x, marker 3 cites y. Document order: 2, 1, 3.
  // Output: marker 2 is "left unchanged" as "[1]" and marker 1 is rewritten to "[1]" — two
  //   citations print "[1]", and the bibliography's [1] is x. The orphan now silently points at x.
  // Correct: scope §C3 "A control whose key is missing from the library is reported by marker text,
  //   never dropped" — reporting it is right, but leaving a number that the renumbering has just
  //   reassigned to a different reference makes the document cite the wrong work.
  // Owner: bibliography.ts / bibPane.ts (planUpdate does not flag or neutralise the stale number).
  it("a citation whose record was deleted keeps a number that now belongs to another reference", () => {
    const x = R("article-journal", { author: [p("Xa", "A")], title: "X", "container-title": "J", issued: Y(2020) });
    const y = R("article-journal", { author: [p("Ya", "B")], title: "Y", "container-title": "J", issued: Y(2020) });
    const st = storeOf("ieee", [x, y], { "1": [{ id: x.id }], "2": [{ id: "gone" }], "3": [{ id: y.id }] });
    const shown = update(st, ["2", "1", "3"], { "2": "[1]", "1": "[2]", "3": "[3]" });
    expect(shown["1"]).toBe("[1]");
    expect(shown["2"]).not.toBe(shown["1"]);
  });
});

// ================================================================== COSMETIC (it.failing)

describe("cosmetic defects", () => {
  // Input: a PubMed "Citation manager" export (.nbib, MEDLINE format), pasted or opened.
  // Output: "1 DOI recognised. Nothing was looked up." + "Paste the reference's BibTeX or RIS".
  //   It is NOT misread as RIS (good), but the user is told nothing about MEDLINE: the whole record
  //   is silently reduced to its DOI.
  // Correct: refuse by name ("PubMed .nbib (MEDLINE) is not supported; export RIS from PubMed").
  // Owner: bibPane.ts (detectBibFormat / importBibText).
  it("a pasted PubMed .nbib is reported as “1 DOI recognised”, never named as MEDLINE", () => {
    const rep = importBibText(NBIB, "pubmed-33301246.nbib");
    expect(rep.lines.join(" ")).toMatch(/MEDLINE|PubMed|nbib/i);
  });

  // Input: "Tuning van der Waals Interactions in MoS₂" in Chicago headline style.
  // Output: "Tuning Van Der Waals Interactions in MoS₂".  Correct: the particle stays lowercase.
  // Owner: bibCase.ts (titleCase raises "van" and "der").
  it("Chicago headline case capitalises the particles of “van der Waals”", () => {
    expect(titleCase("Tuning van der Waals Interactions in MoS" + String.fromCharCode(0x2082), { smallWords: CHICAGO_SMALL_WORDS }))
      .toContain("van der Waals");
  });

  // Input: "Growth of E. Coli in Minimal Media" (title-cased source).
  // Output: "Growth of E. Coli in minimal media". Correct: "Growth of E. coli in minimal media" —
  //   the period of a genus abbreviation is not a sentence end.
  // Owner: bibCase.ts (boundaryBefore treats any "." as a sentence end).
  it("sentence case keeps “E. Coli” capitalised after the genus abbreviation", () => {
    expect(sentenceCase("Growth of E. Coli in Minimal Media", { capitalizeSubtitle: true })).toBe("Growth of E. coli in minimal media");
  });

  // Input: Korean given name "Min-jun" (the standard romanisation, as Crossref stores it).
  // Output: IEEE "M.-j. Kim", APA "Kim, M.-j.", Vancouver "Kim Mj". Correct: initials are capitals
  //   (IEEE "M.-J. Kim", APA "Kim, M.-J.", NLM "Kim MJ").
  // Owner: bibStyles.ts (initialsOf takes the first character as written).
  it("hyphenated Korean given names produce lowercase initials (M.-j., Mj)", () => {
    const rec = R("article-journal", { author: [p("Kim", "Min-jun")], title: "T", "container-title": "J", "container-title-short": "J.", issued: Y(2020) });
    expect(STYLES.ieee!.reference(rec).plain).toMatch(/^M\.-J\. Kim,/);
    expect(STYLES.apa7!.reference(rec).plain).toMatch(/^Kim, M\.-J\./);
    expect(STYLES.vancouver!.reference(rec).plain).toMatch(/^Kim MJ\./);
  });

  // Input: marker A cites x; later marker B cites [y, x] (x already numbered 1, y new → 2).
  // Output: B reads "[2], [1]". Correct: IEEE's own examples list ascending numbers ("[2], [4], [5]").
  // Owner: bibStyles.ts (ieeeMarker keeps the item order; the other numeric styles sort).
  it("IEEE multi-reference marker prints numbers out of order: “[2], [1]”", () => {
    const x = R("article-journal", { author: [p("Xa", "A")], title: "X", "container-title": "J", issued: Y(2020) });
    const y = R("article-journal", { author: [p("Ya", "B")], title: "Y", "container-title": "J", issued: Y(2020) });
    const shown = update(storeOf("ieee", [x, y], { "1": [{ id: x.id }], "2": [{ id: y.id }, { id: x.id }] }), ["1", "2"]);
    expect(shown["2"]).toBe("[1], [2]");
  });

  // Input: APA book "Genetics of <i>Escherichia coli</i>". The html correctly sets the species
  //   roman inside the italic title (<span style="font-style:normal">).
  // Output: the OOXML bibliography sets "Escherichia coli" in <w:i/> — italic — so the Word
  //   document loses the reverse-italics the html (and the pane preview's markup) promises.
  // Owner: bibOoxml.ts (htmlToRuns ignores the font-style:normal span).
  it("the Word bibliography loses reverse italics for a species name inside an italic book title", () => {
    const bk = R("book", { author: [p("Lee", "Kim")], title: "Genetics of <i>Escherichia coli</i>", publisher: "Pub", issued: Y(2019) });
    const xml = bibliographyOoxml([STYLES.apa7!.reference(bk)]);
    const run = /<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t xml:space="preserve">Escherichia coli<\/w:t><\/w:r>/.exec(xml);
    expect(run).not.toBeNull();
    expect(run![1] ?? "").not.toContain("<w:i/>");
  });

  // Input: an arXiv BibTeX export (@misc with eprint) — imported as type "article" (preprint).
  // Output: "IEEE cannot format a article reference: …" — "a article", and CSL's "article"
  //   reads as "journal article" to the user. planInsert already says "is a preprint".
  // Owner: bibStyles.ts (guard prints the raw CSL type); shown in previews and Update reports.
  it("the style refusal for an arXiv preprint reads “cannot format a article reference”", () => {
    const rec = R("article", { author: [p("Vaswani", "Ashish")], title: "Attention Is All You Need", issued: Y(2017) });
    const f = formatReference("ieee", rec);
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.reason).not.toMatch(/\ba article\b/);
      expect(f.reason).toMatch(/preprint/);
    }
  });

  // Input: Chicago NB first note for a title ending in "?" (the IEEE guide's own Ito title).
  // Output: "Masato Ito, “Can the Application … Display?,” Journal of Non-Crystalline Solids …".
  // Correct (CMOS, paraphrased): a comma is dropped after a title's closing ? or !; the bibliography
  //   entry from the same module already does this ("Display?” Journal …").
  // Owner: bibStyles.ts (chicagoNote).
  it("Chicago NB note prints “?,” after a question title", () => {
    const q = R("article-journal", { author: [p("Ito", "Masato")], title: "Can the Application of Amorphous Oxide TFT Be an Electrophoretic Display?",
      "container-title": "Journal of Non-Crystalline Solids", volume: "354", issue: "19", page: "2777-2782", issued: Y(2008) });
    expect(STYLES["chicago-nb"]!.note!(q, { id: q.id }, true).plain).not.toContain("?,");
  });

  // Same record, subsequent (short) note. Output: "Ito, “Can,” 2779." — a one-word short title
  // that is not the title's subject. Correct: CMOS short titles are up to four key words
  // ("Amorphous Oxide TFT" or "Can the Application"). Owner: bibStyles.ts (chicagoShortTitle).
  it("Chicago NB short title for a question title is the single word “Can”", () => {
    const q = R("article-journal", { author: [p("Ito", "Masato")], title: "Can the Application of Amorphous Oxide TFT Be an Electrophoretic Display?",
      "container-title": "Journal of Non-Crystalline Solids", volume: "354", issue: "19", page: "2777-2782", issued: Y(2008) });
    expect(STYLES["chicago-nb"]!.note!(q, { id: q.id, locator: "2779", label: "page" }, false).plain).not.toBe(`Ito, ${LDQ}Can,${RDQ} 2779.`);
  });

  // Input: Chicago NB, Kwon cited twice, the second time without a page.
  // Output (from planUpdate, i.e. what Word receives): "Kwon, “Inclusion Work.”." — noteTexts strips
  //   a trailing "." and re-adds one, but the short form ends in ".”", so a second period is added.
  // Correct: CMOS quick guide short note "Kwon, “Inclusion Work,” 1851."; without a page: "Kwon, “Inclusion Work.”"
  // Owner: bibPane.ts (noteTexts).
  it("Chicago NB subsequent notes without a locator end in a double period “.”.”", () => {
    const rec = parseBibtex(fixture("crossref-kwon2022.bib")).records[0];
    const shown = update(storeOf("chicago-nb", [rec], { "1": [{ id: rec.id }], "2": [{ id: rec.id }] }), ["1", "2"]);
    expect(shown["2"]).toBe(`Kwon, ${LDQ}Inclusion Work.${RDQ}`);
  });

  // Input: an in-press article in Chicago author-date.
  // Output: "Doe, Jane. in press. “T.” Journal of Things." — a lowercase sentence start.
  // Correct: CMOS uses "Forthcoming." in the date position (capitalised as a sentence start).
  // Owner: bibStyles.ts.
  it("Chicago AD prints a lowercase “in press.” as a sentence", () => {
    const ip = R("article-journal", { author: [p("Doe", "Jane")], title: "T", "container-title": "Journal of Things", issued: { literal: "in press" } });
    expect(STYLES["chicago-ad"]!.reference(ip).plain).not.toMatch(/\. in press\./);
  });

  // Input: a store holding marker ids "1000000000000" and "1000000000001" (both legal: base-36, the
  //   tag stays under 64 characters). Not reachable from the pane's counter in practice.
  // Output: nextMarkerId → "1000000000000" (parseInt loses precision past 2^53), and addMarker
  //   OVERWRITES that existing marker's items.
  // Owner: bibStore.ts (nextMarkerId should compare ids without Number precision loss).
  it("nextMarkerId collides with an existing long marker id and addMarker overwrites it", () => {
    const x = R("article-journal", { title: "X" });
    const st = storeOf("ieee", [x], { "1000000000000": [{ id: x.id, locator: "7" }], "1000000000001": [{ id: x.id }] });
    const r = addMarker(st, [{ id: x.id }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(st.markers)).not.toContain(r.markerId);
      expect(r.store.markers["1000000000000"]).toEqual([{ id: x.id, locator: "7" }]);
    }
  });
});

// ================================================================== CONFIRMED CORRECT (≤ 10)

describe("confirmed correct", () => {
  it("Crossref BibTeX for Kwon (2022) reproduces the CMOS 18 quick-guide entries verbatim (AD and NB)", () => {
    const rec = parseBibtex(fixture("crossref-kwon2022.bib")).records[0];
    expect(STYLES["chicago-ad"]!.reference(rec).plain).toBe(
      `Kwon, Hyeyoung. 2022. ${LDQ}Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.${RDQ} American Journal of Sociology 127 (6): 1818${EN}59. https://doi.org/10.1086/720277.`);
    expect(STYLES["chicago-nb"]!.reference(rec).plain).toBe(
      `Kwon, Hyeyoung. ${LDQ}Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.${RDQ} American Journal of Sociology 127, no. 6 (2022): 1818${EN}59. https://doi.org/10.1086/720277.`);
  });

  it("“1234–39” is expanded or elided per manual: IEEE/APA full, CMOS 1234–39, NLM 1234-9", () => {
    const rec = R("article-journal", { author: [p("Doe", "Jane")], title: "T", "container-title": "J", "container-title-short": "J.", volume: "5", page: "1234" + EN + "39", issued: Y(2020) });
    expect(STYLES.ieee!.reference(rec).plain).toContain(`pp. 1234${EN}1239`);
    expect(STYLES.apa7!.reference(rec).plain).toContain(`5, 1234${EN}1239.`);
    expect(STYLES["chicago-ad"]!.reference(rec).plain).toContain(`5: 1234${EN}39.`);
    expect(STYLES.vancouver!.reference(rec).plain).toContain("2020;5:1234-9.");
  });

  it("article number instead of pages, no issue: each style's own form", () => {
    const rec = R("article-journal", { author: [p("Doe", "Jane")], title: "T", "container-title": "PLOS ONE", "container-title-short": "PLoS One",
      volume: "15", "article-number": "e0227389", issued: Y(2020), DOI: "10.1371/journal.pone.0227389" });
    expect(STYLES.ieee!.reference(rec).plain).toBe("J. Doe, “T,” PLoS One, vol. 15, 2020, Art. no. e0227389, doi: 10.1371/journal.pone.0227389.");
    expect(STYLES.apa7!.reference(rec).plain).toBe("Doe, J. (2020). T. PLOS ONE, 15, Article e0227389. https://doi.org/10.1371/journal.pone.0227389");
    expect(STYLES.vancouver!.reference(rec).plain).toBe("Doe J. T. PLoS One. 2020;15:e0227389.");
  });

  it("Google Scholar BibTeX: H$_2$O, Ca$^{2+}$, \\textit{E. coli} and “and others” survive every style", () => {
    const src = `@article{smith2020ultrafast,
  title={Ultrafast dynamics of {H}${DOLLAR}_2${DOLLAR}{O} near {Ca}${DOLLAR}^{2+}${DOLLAR} in {\\textit{E. coli}}},
  author={Smith, John and others},
  journal={Journal of the American Chemical Society},
  volume={142}, number={3}, pages={1234--1239}, year={2020}, publisher={ACS Publications}
}`;
    const rec = parseBibtex(src).records[0];
    expect(rec["et-al-in-source"]).toBe(true);
    for (const s of ALL) {
      const f = STYLES[s]!.reference(rec);
      expect(f.plain).toContain("H" + String.fromCharCode(0x2082) + "O");
      expect(f.plain).toContain("Ca" + String.fromCharCode(0xb2, 0x207a));
      expect(f.html).toMatch(/<i>E\. coli<\/i>|font-style:normal">E\. coli/);
      expect(f.plain).not.toMatch(/H2O|\^|\$|<|&amp;/);
    }
  });

  it("particles, Jr., corporate authors and a Spanish double surname print per APA and CMOS", () => {
    const rec = R("article-journal", { author: [{ family: "King", given: "Martin Luther", suffix: "Jr." },
      { family: "Waals", "non-dropping-particle": "van der", given: "Johannes Diderik" }, { literal: "World Health Organization" },
      { family: "García Márquez", given: "Gabriel" }], title: "T", "container-title": "J", volume: "5", page: "1-9", issued: Y(2020) });
    expect(STYLES.apa7!.reference(rec).plain).toMatch(/^King, M\. L\., Jr\., van der Waals, J\. D\., World Health Organization, & García Márquez, G\. \(2020\)/);
    expect(STYLES["chicago-ad"]!.reference(rec).plain).toMatch(/^King, Martin Luther, Jr\., Johannes Diderik van der Waals, World Health Organization, and Gabriel García Márquez\. 2020\./);
  });

  it("Update twice changes nothing, in every shipped style (multi-item, repeat and locator markers)", () => {
    const a = R("article-journal", { author: [p("Smith", "John"), p("Doe", "Jane")], title: "Alpha", "container-title": "J", "container-title-short": "J.", volume: "1", page: "1-9", issued: Y(2020) });
    const b = R("article-journal", { author: [p("Smith", "John"), p("Doe", "Jane")], title: "Gamma", "container-title": "J", "container-title-short": "J.", volume: "1", page: "1-9", issued: Y(2020) });
    for (const s of ALL) {
      const st = storeOf(s, [a, b], { "1": [{ id: a.id, locator: "5", label: "page" }], "2": [{ id: b.id }, { id: a.id }], "3": [{ id: a.id }] });
      const first = update(st, ["3", "1", "2"]);
      const kind = STYLES[s]!.kind;
      const again = planUpdate(collectCitations(ctl(["3", "1", "2"], first), [], kind), st);
      expect([s, again.ok && again.rewrites.length]).toEqual([s, 0]);
    }
  });

  it("no “undefined”, “NaN”, “&amp;” or tags in plain text, for sparse records in every style", () => {
    const recs: BibRecord[] = [
      R("article-journal", { title: "Na⁺/K⁺ & Ca²⁺ pumps <i>in vivo</i>", "container-title": "Biophys & Chem" }),
      R("article-journal", { author: [{ given: "Cher" }], issued: { literal: "" } }),
      R("article-journal", { title: "T", issued: { "date-parts": [[2020, 13, 40]] }, editor: [p("Ed", "E")] }),
      R("book", { title: "B" }), R("chapter", { title: "C" }), R("thesis", { title: "T" }), R("patent", { title: "P" }),
    ];
    for (const s of ALL) for (const r of recs) {
      const f = formatReference(s, r);
      if (!f.ok) continue;
      expect([s, f.value.plain]).not.toEqual([s, expect.stringMatching(/undefined|NaN|&amp;|&lt;|<\/?[a-z]/)]);
    }
  });

  it("store: damaged JSON and a newer version are refused by name; 2.1 MB is refused before writing", () => {
    expect(loadBibStore('{"version":1,')).toEqual({ ok: false, reason: expect.stringMatching(/not valid JSON/) });
    expect(loadBibStore(JSON.stringify({ version: 2, style: "ieee", library: {}, markers: {} })))
      .toEqual({ ok: false, reason: expect.stringMatching(/version 2, made by a newer JurisLab/) });
    const big = emptyStore("ieee");
    for (let i = 0; i < 4000; i++) big.library[`k${i}`] = { id: `k${i}`, type: "article-journal", title: "x".repeat(470) };
    const ser = serializeStore(big);
    expect(ser.ok).toBe(false);
  });

  it("refuse, don't guess: an arXiv preprint is refused by name at insert; a book is refused by Nature", () => {
    const arx = parseBibtex(`@misc{vaswani2017attention, title={Attention Is All You Need}, author={Ashish Vaswani and Noam Shazeer},
      year={2017}, eprint={1706.03762}, archivePrefix={arXiv}, primaryClass={cs.CL}, url={https://arxiv.org/abs/1706.03762}}`).records[0];
    const plan = planInsert(storeOf("ieee", [arx], {}), [arx.id]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasons[0]).toMatch(/is a preprint; IEEE does not format preprints/);
    const bk = R("book", { author: [p("Jones", "R")], title: "Soft Machines", publisher: "OUP", issued: Y(2004) });
    expect(formatReference("nature", bk)).toEqual({ ok: false, reason: expect.stringMatching(/^Nature cannot format a book reference/) });
  });

  it("a pasted PubMed .nbib is not misread as RIS (no records invented from MEDLINE tags)", () => {
    const rep = importBibText(NBIB);
    expect(rep.format).not.toBe("ris");
    expect(rep.records).toEqual([]);
  });
});
