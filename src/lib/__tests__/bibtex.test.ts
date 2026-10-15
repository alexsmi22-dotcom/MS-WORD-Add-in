// BibTeX import (docs/SCOPE-CITATIONS-2026-10.md §C2, Builder 2 acceptance in §D).
//
// Oracles are REAL export bytes saved under fixtures/bib/, each fetched 2026-10-14:
//   crossref-kwon2022.bib   Crossref content negotiation:
//                           curl -H "Accept: application/x-bibtex" https://doi.org/10.1086/720277
//                           (the Chicago Quick Guide's own example article, §C6)
//   zotero-group100.bib     Zotero's BibTeX exporter via the Zotero web API:
//                           https://api.zotero.org/groups/100/items/top?limit=4&format=bibtex
//   zotero-group2205533.bib https://api.zotero.org/groups/2205533/items/top?limit=6&format=bibtex
//   zotero-group2205533.csl.json  same group, &format=csljson
// latex-cases.bib is hand-written (stated in its header) and holds the LaTeX cases.
// The Mendeley Desktop and Google Scholar samples below are RECONSTRUCTED in those
// exporters' documented layouts (no captured bytes were obtainable offline: Scholar
// requires a browser session and Mendeley Desktop is discontinued); they are labelled
// as such where they are used.

import * as fs from "fs";
import * as path from "path";
import { parseBibtex } from "../bibtex";
import { parseCslJson } from "../cslJson";
import { parseRis } from "../ris";
import type { BibRecord } from "../bibRecord";

const FX = path.join(__dirname, "fixtures", "bib");
const fx = (f: string): string => fs.readFileSync(path.join(FX, f), "utf8");
const byId = (recs: BibRecord[], id: string): BibRecord => {
  const r = recs.find((x) => x.id === id);
  if (!r) throw new Error(`no record ${id}`);
  return r;
};
const NC = (s: string): string => `<span class="nocase">${s}</span>`;
/** U+00A0 from its code: invisible characters are never typed literally into source. */
const NBSP = String.fromCharCode(0xa0);

/** The round trip the scope asks for: records → CSL-JSON text → parseCslJson → identical. */
function roundTrips(records: BibRecord[]): void {
  const back = parseCslJson(JSON.stringify(records));
  expect(back.refused).toEqual([]);
  expect(back.records).toEqual(records);
}

describe("real export: Crossref BibTeX (Kwon 2022)", () => {
  const res = parseBibtex(fx("crossref-kwon2022.bib"));
  test("one record, nothing refused (leading space, one line, month=May, uppercase DOI=/ISSN=)", () => {
    expect(res.refused).toEqual([]);
    expect(res.records).toEqual([
      {
        id: "Kwon_2022",
        type: "article-journal",
        title: "Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life",
        "container-title": "American Journal of Sociology",
        author: [{ family: "Kwon", given: "Hyeyoung" }],
        issued: { "date-parts": [[2022, 5]] },
        volume: "127",
        issue: "6",
        page: "1818–1859",
        DOI: "10.1086/720277",
        URL: "http://dx.doi.org/10.1086/720277",
        publisher: "University of Chicago Press",
      },
    ]);
    roundTrips(res.records);
  });
});

describe("real export: Zotero BibTeX (group 100)", () => {
  const res = parseBibtex(fx("zotero-group100.bib"));
  test("four articles; pages {867 -- 889} and \\& decoded; urldate → accessed", () => {
    expect(res.refused).toEqual([]);
    expect(res.records.map((r) => r.id)).toEqual([
      "wood_art_2007", "wood_instrumental_2004", "valentine_g._creating_1995", "smith_performing_2000",
    ]);
    const a = byId(res.records, "wood_art_2007");
    expect(a.page).toBe("867–889");
    expect(a.author).toEqual([
      { family: "Wood", given: "Nichola" },
      { family: "Duffy", given: "Michelle" },
      { family: "Smith", given: "Susan J" },
    ]);
    expect(a.accessed).toEqual({ "date-parts": [[2008, 10, 1]] });
    expect(a.DOI).toBe("10.1068/d416t");
    expect(byId(res.records, "wood_instrumental_2004")["container-title"]).toBe("Social & Cultural Geography");
    roundTrips(res.records);
  });
  test("“Valentine G.” follows BibTeX's First Last rule exactly; it is not 'fixed'", () => {
    expect(byId(res.records, "valentine_g._creating_1995").author).toEqual([{ family: "G.", given: "Valentine" }]);
  });
});

describe("real export: Zotero BibTeX (group 2205533)", () => {
  const res = parseBibtex(fx("zotero-group2205533.bib"));
  test("every entry imports; @misc without a title or year still imports", () => {
    expect(res.refused).toEqual([]);
    expect(res.records.map((r) => [r.id, r.type])).toEqual([
      ["fraser2024", "article-journal"],
      ["vedantamHiddenBrain2015", "webpage"],
      ["Tintinnabulum2018", "article"],
      ["ashdowne2018", "article"],
      ["greenfieldChildrenAdolescentsInternet2006", "article-journal"],
      ["shoreMarkingTimeLand2014", "article-journal"],
    ]);
    roundTrips(res.records);
  });
  test("Zotero's {\\textless}span class=\"nocase\"{\\textgreater} decodes to the CSL nocase markup", () => {
    expect(byId(res.records, "Tintinnabulum2018").title).toBe(NC("tintinnabulum"));
  });
  test("per-word protection {United} {States} and {Internet}", () => {
    expect(byId(res.records, "shoreMarkingTimeLand2014").title).toBe(
      `Marking time in the land of plenty: reflections on mental health in the ${NC("United")} ${NC("States")}`,
    );
    expect(byId(res.records, "greenfieldChildrenAdolescentsInternet2006").title).toBe(`Children, adolescents, and the ${NC("Internet")}`);
  });
  test("issue “1-2” is an issue, never a page range; month = mar", () => {
    const r = byId(res.records, "fraser2024");
    expect(r.issue).toBe("1-2");
    expect(r.page).toBe("23–26");
    expect(r.issued).toEqual({ "date-parts": [[2024, 3]] });
  });
});

describe("reconstructed exporter layouts (labelled: not captured bytes)", () => {
  test("Mendeley Desktop layout: banner text, {{double-braced}} title, file = {:C$\\backslash$:…}", () => {
    // Layout of a Mendeley Desktop 1.19 export (banner + alphabetical fields), reconstructed.
    const src = String.raw`Automatically generated by Mendeley Desktop 1.19.8
Any changes to this file will be lost if it is regenerated by Mendeley.

BibTeX export options can be customized via Options -> BibTeX in Mendeley Desktop

@article{Zhou2020,
abstract = {Since the outbreak of severe acute respiratory syndrome (SARS) 18 years ago...},
author = {Zhou, Peng and Yang, Xing-Lou and Wang, Xian-Guang},
doi = {10.1038/s41586-020-2012-7},
file = {:C$\backslash$:/Users/me/Documents/Mendeley Desktop/Zhou et al. - 2020 - A pneumonia outbreak.pdf:pdf},
issn = {14764687},
journal = {Nature},
mendeley-groups = {Thesis},
number = {7798},
pages = {270--273},
pmid = {32015507},
title = {{A pneumonia outbreak associated with a new coronavirus of probable bat origin}},
url = {http://dx.doi.org/10.1038/s41586-020-2012-7},
volume = {579},
year = {2020}
}
`;
    const res = parseBibtex(src);
    expect(res.refused).toEqual([]);
    expect(res.records).toEqual([
      {
        id: "Zhou2020",
        type: "article-journal",
        // Mendeley's double braces protect the whole title, exactly as BibTeX reads them.
        title: NC("A pneumonia outbreak associated with a new coronavirus of probable bat origin"),
        "container-title": "Nature",
        author: [
          { family: "Zhou", given: "Peng" },
          { family: "Yang", given: "Xing-Lou" },
          { family: "Wang", given: "Xian-Guang" },
        ],
        issued: { "date-parts": [[2020]] },
        volume: "579",
        issue: "7798",
        page: "270–273",
        DOI: "10.1038/s41586-020-2012-7",
        URL: "http://dx.doi.org/10.1038/s41586-020-2012-7",
      },
    ]);
  });

  test("Google Scholar layout: two-space indent, field={…}, lowercase journal kept as written", () => {
    // Layout of Google Scholar's "Cite → BibTeX" output, reconstructed.
    const src = String.raw`@article{zhou2020pneumonia,
  title={A pneumonia outbreak associated with a new coronavirus of probable bat origin},
  author={Zhou, Peng and Yang, Xing-Lou and Wang, Xian-Guang and Hu, Ben and Zhang, Lei and Zhang, Wei and Si, Hao-Rui and Zhu, Yan and Li, Bei and Huang, Chao-Lin and others},
  journal={nature},
  volume={579},
  number={7798},
  pages={270--273},
  year={2020},
  publisher={Nature Publishing Group UK London}
}`;
    const res = parseBibtex(src);
    expect(res.refused).toEqual([]);
    const r = res.records[0];
    expect(r.author).toHaveLength(10);
    expect(r["et-al-in-source"]).toBe(true);
    expect(r["container-title"]).toBe("nature");
    expect(r.page).toBe("270–273");
    expect(r.publisher).toBe("Nature Publishing Group UK London");
  });
});

describe("LaTeX decoding (fixtures/bib/latex-cases.bib)", () => {
  const res = parseBibtex(fx("latex-cases.bib"));
  test("all five entries import; @string/@STRING(…)/@preamble/@comment and an e-mail @ are not entries", () => {
    expect(res.refused).toEqual([]);
    expect(res.records.map((r) => r.id)).toEqual(["accents", "chem", "mendeley", "zoteroSpan", "style"]);
  });
  test("accented names: {\\\"o}, \\H{o}, {\\ss}, \\c{c}, {\\o}, {\\AA}, {\\L}, \\v{r}, \\'{\\i}", () => {
    expect(byId(res.records, "accents").author).toEqual([
      { family: "Gödel", given: "Kurt" },
      { family: "Erdős", given: "Paul" },
      { family: "Straßer", given: "Hans" },
      { family: "François", given: "Jean" },
      { family: "Sørensen", given: "Søren" },
      { family: "Ångström", given: "Anders" },
      { family: "Łukasiewicz", given: "Jan" },
      { family: "Dvořák", given: "Antonín" },
    ]);
  });
  test("accent groups are special characters, not case protection; quotes and dashes become typographic", () => {
    // A single ' stays straight (see the O'Brien test): only `` '' and ` convert.
    expect(byId(res.records, "accents").title).toBe(`Über formal unentscheidbare Sätze: “quoted” and ‘single' – en — em${NBSP}nbsp`);
  });
  test("@string macro # concatenation, a @STRING(…) macro, month macro, numeric year", () => {
    const r = byId(res.records, "accents");
    expect(r["container-title"]).toBe("J. Am. Chem. Soc. (Washington)");
    expect(r.publisher).toBe("American Chemical Society");
    expect(r.issued).toEqual({ "date-parts": [[1931, 3]] });
    expect(r.page).toBe("173–198");
  });
  test("{pH} {NMR} {DNA} → nocase; H$_2$O → H₂O; $^{13}$C; $^\\circ$; \\textsubscript; \\ce; Greek; K<sub>B</sub>", () => {
    const r = byId(res.records, "chem");
    expect(r.title).toBe(
      `Measuring ${NC("pH")} by ${NC("NMR")} in H₂O and ¹³C at 25${NBSP}°C: <i>${NC("trans")}</i>-stilbene, ${NC("DNA")}, CO₂, SO₄²⁻, α-helix, μm and K<sub>B</sub>`,
    );
    expect(r.title).not.toMatch(/H2O|\^|_|\$/);
  });
  test("'and others' sets et-al-in-source and invents no name; an article number is not a range", () => {
    const r = byId(res.records, "chem");
    expect(r.author).toEqual([{ family: "Doe", given: "Jane" }]);
    expect(r["et-al-in-source"]).toBe(true);
    expect(r.page).toBe("e0318239");
    expect(r.issued).toEqual({ "date-parts": [[2020, 5]] });
    expect(r["container-title"]).toBe("Chem. Sci.");
  });
  test("numeric month; {{…}} protects the whole title", () => {
    const r = byId(res.records, "mendeley");
    expect(r.issued).toEqual({ "date-parts": [[2019, 11]] });
    expect(r.title).toBe(NC("A Title Mendeley Wrapped In Double Braces"));
  });
  test("decoded \\textless/\\textgreater tags on the allow list are markup; \\& is a literal &", () => {
    expect(byId(res.records, "zoteroSpan").title).toBe(`${NC("tintinnabulum")} & <i>Fasciculus</i>`);
  });
  test("{\\em …} and {\\it …} are special (unprotected); \\textbf{…}/\\emph{…} arguments at depth 1 are protected", () => {
    expect(byId(res.records, "style").title).toBe(
      `An <i>emphasised</i> word, a <b>${NC("bold")}</b> one, <i>${NC("E. coli")}</i> and <i>in vivo</i> work`,
    );
  });
});

describe("crossref inheritance", () => {
  const src = [
    "@inproceedings{child,", //                                    line 1
    "  author = {Doe, Jane},",
    "  title = {Fast {GaN} transistors},",
    "  pages = {12--15},",
    "  crossref = {proc}",
    "}",
    "@proceedings{proc,", //                                       line 7
    "  title = {Proceedings of the 2020 {IEEE} Symposium},",
    "  editor = {Roe, Richard},",
    "  year = {2020},",
    "  publisher = {IEEE},",
    "  address = {New York}",
    "}",
  ].join("\n");
  const res = parseBibtex(src);
  test("the child takes booktitle (from the parent's title), editor, year, publisher, address", () => {
    expect(res.refused).toEqual([]);
    expect(byId(res.records, "child")).toEqual({
      id: "child",
      type: "paper-conference",
      title: `Fast ${NC("GaN")} transistors`,
      "container-title": `Proceedings of the 2020 ${NC("IEEE")} Symposium`,
      author: [{ family: "Doe", given: "Jane" }],
      editor: [{ family: "Roe", given: "Richard" }],
      issued: { "date-parts": [[2020]] },
      page: "12–15",
      publisher: "IEEE",
      "publisher-place": "New York",
    });
  });
  test("the parent is kept as its own record (it appears after the child)", () => {
    expect(byId(res.records, "proc").type).toBe("book");
    expect(byId(res.records, "proc").title).toBe(`Proceedings of the 2020 ${NC("IEEE")} Symposium`);
  });
  test("a child whose parent is missing still imports, with its own fields", () => {
    const r = parseBibtex("@inproceedings{orphan, title = {T}, year = 2001, crossref = {nowhere}}");
    expect(r.refused).toEqual([]);
    expect(r.records[0]).toEqual({ id: "orphan", type: "paper-conference", title: "T", issued: { "date-parts": [[2001]] } });
  });
  test("identifiers are NOT inherited: the volume's DOI/URL is not the paper's", () => {
    // Hand-written in DBLP's "with crossref" shape (dblp.org served a bot wall to the fetcher on 2026-10-14).
    const r = parseBibtex(String.raw`@inproceedings{DBLP:conf/x/Paper16,
  author    = {Doe, Jane},
  title     = {A Paper},
  pages     = {1--9},
  crossref  = {DBLP:conf/x/2016}
}
@proceedings{DBLP:conf/x/2016,
  title     = {Proceedings of X 2016},
  publisher = {{IEEE} Computer Society},
  year      = {2016},
  url       = {https://ieeexplore.ieee.org/xpl/conhome/7776647/proceeding},
  doi       = {10.1109/CVPR.2016},
  isbn      = {978-1-4673-8851-1}
}`);
    expect(r.refused).toEqual([]);
    const paper = byId(r.records, "DBLP:conf/x/Paper16");
    expect(paper.DOI).toBeUndefined();
    expect(paper.URL).toBeUndefined();
    expect(paper.publisher).toBe("IEEE Computer Society");
    expect(paper["container-title"]).toBe("Proceedings of X 2016");
    expect(byId(r.records, "DBLP:conf/x/2016").DOI).toBe("10.1109/CVPR.2016");
  });
  test("the child's own fields win over the parent's", () => {
    const r = parseBibtex(
      "@incollection{c, title={C}, year={1999}, booktitle={Own Book}, crossref={p}}\n@collection{p, title={Parent Title}, year={2000}, publisher={Pub}}",
    );
    const c = byId(r.records, "c");
    expect(c.issued).toEqual({ "date-parts": [[1999]] });
    expect(c["container-title"]).toBe("Own Book");
    expect(c.publisher).toBe("Pub");
  });
});

describe("real export: Zotero patents (assignee → publisher)", () => {
  // https://api.zotero.org/groups/2205533/items?itemType=patent&format=bibtex   (zotero-patents2205533.bib)
  // https://api.zotero.org/groups/2205533/items?itemType=patent&format=biblatex (zotero-patents2205533.biblatex.bib)
  // fetched 2026-10-14. Zotero writes the assignee as BibTeX `assignee` and biblatex `holder`.
  test("BibTeX: assignee → publisher, nationality → authority", () => {
    const res = parseBibtex(fx("zotero-patents2205533.bib"));
    expect(res.refused).toEqual([]);
    expect(res.records[0]).toEqual({
      id: "iizukaCementAdmixture1986",
      type: "patent",
      title: "Cement admixture",
      author: [
        { family: "Iizuka", given: "Masanori" },
        { family: "Tanaka", given: "Hideki" },
      ],
      issued: { "date-parts": [[1986, 5]] },
      number: "4,586,960",
      URL: "https://patents.google.com/patent/US4586960A/",
      publisher: "Kao Corp",
      authority: "US",
      accessed: { "date-parts": [[2025, 3, 31]] },
    });
    expect(res.records[1]).toMatchObject({ publisher: "International Business Machines Corporation", authority: "U.S.", number: "9,367,592" });
    roundTrips(res.records);
  });
  test("biblatex: holder → publisher, date → issued", () => {
    const res = parseBibtex(fx("zotero-patents2205533.biblatex.bib"));
    expect(res.refused).toEqual([]);
    expect(res.records.map((r) => [r.publisher, r.issued])).toEqual([
      ["Kao Corp", { "date-parts": [[1986, 5, 6]] }],
      ["International Business Machines Corporation", { "date-parts": [[2016, 6, 14]] }],
    ]);
  });
  test("several holders are joined, braces and LaTeX decoded", () => {
    const r = parseBibtex("@patent{p, holder = {{Barnes and Noble} and Sch{\\\"o}n AG}, number = {1}}").records[0];
    expect(r.publisher).toBe("Barnes and Noble; Schön AG");
  });
});

describe("et al. and apostrophes", () => {
  test("'and others' in the EDITOR list does not mark a complete author list as truncated", () => {
    const r = parseBibtex("@incollection{c, author = {A, Ann and B, Bob}, editor = {C, Cy and others}, title = {T}, booktitle = {B}}").records[0];
    expect(r.author).toHaveLength(2);
    expect(r["et-al-in-source"]).toBeUndefined();
  });
  test("…but it does when there is no author list (styles promote editors)", () => {
    const r = parseBibtex("@book{b, editor = {C, Cy and others}, title = {T}}").records[0];
    expect(r["et-al-in-source"]).toBe(true);
  });
  test("O'Brien from BibTeX equals O'Brien from RIS and CSL-JSON (a single ' stays straight)", () => {
    const fromBib = parseBibtex("@article{a, author = {O'Brien, Conor}, title = {Rock 'n' roll}}").records[0];
    const fromRis = parseRis("TY  - JOUR\nAU  - O'Brien, Conor\nER  - ").records[0];
    const fromCsl = parseCslJson('[{"id": "a", "type": "article-journal", "author": [{"family": "O\'Brien", "given": "Conor"}]}]').records[0];
    expect(fromBib.author).toEqual(fromRis.author);
    expect(fromBib.author).toEqual(fromCsl.author);
    expect(fromBib.title).toBe("Rock 'n' roll");
  });
});

describe("types and fields", () => {
  test("theses, reports, patents, online, books, chapters, preprints", () => {
    const src = String.raw`
@phdthesis{t1, author={Lee, Ann}, title={On {GaN}}, school={MIT}, year=2015}
@mastersthesis{t2, author={Lee, Ann}, title={X}, school={MIT}, year=2012, type={MSc dissertation}}
@techreport{r1, author={Kay, Bo}, title={Rep}, institution={NIST}, number={TN-1297}, year=1994}
@patent{p1, author={Inventor, Ida}, title={Widget}, number={4,904,581}, year=1990, type={patentus}}
@online{w1, author={{World Health Organization}}, title={Fact sheet}, url={https://www.who.int/x\_y}, urldate={2024-01-31}, year=2023}
@book{b1, editor={Ed, Ed}, title={Big Book}, publisher={Wiley}, address={Hoboken}, edition={2}, year=2010}
@incollection{c1, author={Au, Al}, title={Chap}, booktitle={Collected}, editor={Ed, Ed}, pages={1-9}, year=2010}
@misc{arx, author={Smith, J.}, title={Pre}, eprint={2101.00001}, archiveprefix={arXiv}, year=2021}
@unpublished{u1, author={Smith, J.}, title={Draft}, year=2022, note={in preparation}}
`;
    const res = parseBibtex(src);
    expect(res.refused).toEqual([]);
    expect(byId(res.records, "t1")).toMatchObject({ type: "thesis", genre: "PhD thesis", publisher: "MIT" });
    expect(byId(res.records, "t2")).toMatchObject({ type: "thesis", genre: "MSc dissertation" });
    expect(byId(res.records, "r1")).toMatchObject({ type: "report", number: "TN-1297", publisher: "NIST" });
    expect(byId(res.records, "p1")).toMatchObject({ type: "patent", number: "4,904,581", authority: "US" });
    expect(byId(res.records, "w1")).toMatchObject({
      type: "webpage",
      author: [{ literal: "World Health Organization" }],
      URL: "https://www.who.int/x_y",
      accessed: { "date-parts": [[2024, 1, 31]] },
    });
    expect(byId(res.records, "b1")).toMatchObject({ type: "book", publisher: "Wiley", "publisher-place": "Hoboken", edition: "2" });
    expect(byId(res.records, "c1")).toMatchObject({ type: "chapter", "container-title": "Collected", page: "1–9" });
    expect(byId(res.records, "arx").type).toBe("article");
    expect(byId(res.records, "u1").type).toBe("article");
  });
  test("pages with --, —, – and a single hyphen all become an en dash", () => {
    const res = parseBibtex(String.raw`
@article{a, title={A}, pages={100--109}}
@article{b, title={B}, pages={100—109}}
@article{c, title={C}, pages={100–109}}
@article{d, title={D}, pages={S1-S12}}
@article{e, title={E}, pages={100---109}}
`);
    expect(res.records.map((r) => r.page)).toEqual(["100–109", "100–109", "100–109", "S1–S12", "100–109"]);
  });
  test("DOI fields in URL form are stored bare", () => {
    const res = parseBibtex("@article{a, doi = {https://doi.org/10.1016/S0027-9684(15)31340-7}}");
    expect(res.records[0].DOI).toBe("10.1016/S0027-9684(15)31340-7");
  });
  test("Scopus art_number → article-number; Scopus abbrev_source_title and WoS Journal-ISO → container-title-short", () => {
    // Field names as Scopus and Web of Science write them (review v2.142.0, defects 3 and 4).
    const sco = parseBibtex(
      "@ARTICLE{Smith2020,\nauthor={Smith, J.A. and Doe, J.},\ntitle={T},\njournal={Journal of the American Chemical Society},\nyear={2020},\nvolume={142},\nnumber={3},\nart_number={e123},\nurl={https://www.scopus.com/inward/record.uri?eid=2-s2.0-85},\nabbrev_source_title={J. Am. Chem. Soc.},\nsource={Scopus},\n}",
    ).records[0];
    expect(sco["article-number"]).toBe("e123");
    expect(sco["container-title-short"]).toBe("J. Am. Chem. Soc.");
    // The Scopus index URL is kept as data; styles suppress it at print time.
    expect(sco.URL).toMatch(/scopus\.com\/inward\/record/);
    const wos = parseBibtex("@article{ WOS:000123456700001,\nJournal = {JOURNAL OF THE AMERICAN CHEMICAL SOCIETY},\nYear = {{2020}},\nJournal-ISO = {J. Am. Chem. Soc.},\n}").records[0];
    expect(wos["container-title-short"]).toBe("J. Am. Chem. Soc.");
    expect(wos.id).toBe("WOS:000123456700001");
    for (const [field, value] of [["eid", "103"], ["articleno", "7"], ["article-number", "e0318239"]]) {
      expect(parseBibtex(`@article{k, ${field} = {${value}}}`).records[0]["article-number"]).toBe(value);
    }
  });
  test("year that is not a number becomes a literal date", () => {
    expect(parseBibtex("@article{a, year = {in press}}").records[0].issued).toEqual({ literal: "in press" });
  });
  test("biblatex date = {2020-05-12} wins over year", () => {
    expect(parseBibtex("@article{a, date = {2020-05-12}, year = 1999}").records[0].issued).toEqual({ "date-parts": [[2020, 5, 12]] });
  });
});

describe("refusals, by line, with the reason", () => {
  test("unbalanced braces are refused with the entry's line, the brace's line, and the next entry survives", () => {
    const src = [
      "@article{good1, title = {Fine}}", //   1
      "", //                                  2
      "@article{bad,", //                     3
      "  title = {Unclosed {brace},", //      4
      "  year = 2001", //                     5
      "}", //                                 6
      "@article{good2, title = {Also fine}}", // 7
    ].join("\n");
    const res = parseBibtex(src);
    expect(res.records.map((r) => r.id)).toEqual(["good1", "good2"]);
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0].line).toBe(3);
    expect(res.refused[0].reason).toBe(
      "@article{bad}: unbalanced braces in field “title”: its “{” opened on line 4 only closes on line 6, so entry “bad” is still open when the next entry starts on line 7",
    );
  });
  test("an undefined macro is refused by name", () => {
    const res = parseBibtex("\n\n@article{k, journal = nojournal}");
    expect(res.refused).toEqual([{ line: 3, reason: "@article{k}: undefined @string macro “nojournal” in field “journal”" }]);
  });
  test("a duplicate key is refused by name (keys compare case-insensitively, as in BibTeX)", () => {
    const res = parseBibtex("@article{Smith2020, title={A}}\n@book{smith2020, title={B}}");
    expect(res.records.map((r) => r.title)).toEqual(["A"]);
    expect(res.refused).toEqual([{ line: 2, reason: "duplicate key “smith2020” (first defined on line 1)" }]);
  });
  test("an unsupported type is refused by name", () => {
    const res = parseBibtex("@artwork{k, title={T}}");
    expect(res.refused[0].line).toBe(1);
    expect(res.refused[0].reason).toMatch(/^@artwork\{k\}: BibTeX entry type @artwork is not supported/);
  });
  test("a name with too many commas, an entry with no key, a bad DOI, xdata", () => {
    const res = parseBibtex(
      [
        "@article{n, author = {a, b, c, d}}",
        "@article{title = {No key}}",
        "@article{d, doi = {11.1000/x}}",
        "@article{x, xdata = {shared}}",
      ].join("\n"),
    );
    expect(res.records).toEqual([]);
    expect(res.refused.map((r) => r.line)).toEqual([1, 2, 3, 4]);
    expect(res.refused[0].reason).toMatch(/too many commas in the name/);
    expect(res.refused[1].reason).toMatch(/has no citation key/);
    expect(res.refused[2].reason).toMatch(/is not a DOI/);
    expect(res.refused[3].reason).toMatch(/xdata/);
  });
  test("a missing closing brace before the next entry is caught instead of eating it", () => {
    const res = parseBibtex(["@article{a,", "  title = {Open", "@article{b, title = {B}}"].join("\n"));
    expect(res.records.map((r) => r.id)).toEqual(["b"]);
    expect(res.refused[0].line).toBe(1);
    expect(res.refused[0].reason).toMatch(/opened on line 2 is still open when the next entry starts on line 3/);
  });
});
