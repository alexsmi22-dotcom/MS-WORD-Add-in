// RIS import (docs/SCOPE-CITATIONS-2026-10.md §C2, Builder 2 acceptance in §D).
//
// Oracles are real export bytes under fixtures/bib/, fetched 2026-10-14:
//   zotero-group100.ris        Zotero's RIS exporter via the web API:
//                              https://api.zotero.org/groups/100/items/top?limit=4&format=ris
//   zotero-group2205533.ris    https://api.zotero.org/groups/2205533/items/top?limit=6&format=ris
//                              (holds a TY SOUND and two TY DICT records: refusals by name)
//   crossref-kwon2022.ris      curl -H "Accept: application/x-research-info-systems" https://doi.org/10.1086/720277
//   springer-zhou2020.ris      https://citation-needed.springer.com/v2/references/10.1038/s41586-020-2012-7?format=refman&flavour=citation
//   scopus-federico2004.ris    a Scopus export kept by JabRef as a test resource (LF line endings):
//                              https://raw.githubusercontent.com/JabRef/jabref/main/jablib/src/test/resources/org/jabref/logic/importer/fileformat/RisImporterTestScopus.ris
//   sciencedirect-ghosh2016.ris  a ScienceDirect export kept by JabRef: …/RisImporterTestScience.ris
//   endnote-castoe2009.ris     an EndNote export (TY - JOUR single spaces, L1 continuation lines,
//                              internal-pdf:// links), TRANSCRIBED from the import test case in
//                              Zotero's RIS translator (github.com/zotero/translators, RIS.js,
//                              lastUpdated 2026-01-05). Transcribed text, not captured bytes.
// Shorter samples quoted inline below are also from RIS.js test cases and say so.

import * as fs from "fs";
import * as path from "path";
import { parseRis, parseRisDate } from "../ris";
import { parseCslJson } from "../cslJson";
import type { BibRecord } from "../bibRecord";

const FX = path.join(__dirname, "fixtures", "bib");
const fx = (f: string): string => fs.readFileSync(path.join(FX, f), "utf8");

function roundTrips(records: BibRecord[]): void {
  const back = parseCslJson(JSON.stringify(records));
  expect(back.refused).toEqual([]);
  expect(back.records).toEqual(records);
}

describe("real export: Zotero RIS", () => {
  test("group 100: four records, pinned field by field, and they round-trip through CSL-JSON", () => {
    const res = parseRis(fx("zotero-group100.ris"));
    expect(res.refused).toEqual([]);
    expect(res.records[0]).toEqual({
      id: "Wood2007",
      type: "article-journal",
      author: [
        { family: "Wood", given: "Nichola" },
        { family: "Duffy", given: "Michelle" },
        { family: "Smith", given: "Susan J" },
      ],
      title: "The art of doing (geographies of) music",
      "container-title": "Environment and Planning D: Society and Space",
      issued: { "date-parts": [[2007]] }, //          DA  - 2007///
      accessed: { "date-parts": [[2008, 10, 1]] }, // Y2  - 2008/10/01/21:33:40
      volume: "25",
      issue: "5",
      page: "867–889", //                             SP  - 867 / EP  - 889
      DOI: "10.1068/d416t",
      URL: "http://www.envplan.com/abstract.cgi?id=d416t",
    });
    expect(res.records.map((r) => r.id)).toEqual(["Wood2007", "Wood2004", "ValentineG1995", "Smith2000"]);
    // SP without EP stays a single page.
    expect(res.records[1].page).toBe("533");
    // "AU  - Valentine G." has no comma, so it is not split.
    expect(res.records[2].author).toEqual([{ literal: "Valentine G." }]);
    roundTrips(res.records);
  });

  test("group 2205533: SOUND and DICT are refused by name with their TY line; J2 → short title; IS 1-2 is an issue", () => {
    const res = parseRis(fx("zotero-group2205533.ris"));
    expect(res.refused.map((r) => [r.line, r.reason.split(" (")[0]])).toEqual([
      [19, "RIS type “SOUND” is not supported"],
      [30, "RIS type “DICT” is not supported"],
      [43, "RIS type “DICT” is not supported"],
    ]);
    expect(res.records.map((r) => r.id)).toEqual(["Fraser2024", "Greenfield2006", "Shore2014"]);
    const fraser = res.records[0];
    expect(fraser["container-title-short"]).toBe("The Bodleian Library Record");
    expect(fraser.issue).toBe("1-2");
    expect(fraser.page).toBe("23–26");
    expect(fraser.issued).toEqual({ "date-parts": [[2024, 3]] }); // DA  - 2024/03//
    // A2 on a journal article is an editor (Zotero's mapping).
    expect(res.records[1].editor).toEqual([
      { family: "Greenfield", given: "P." },
      { family: "Yan", given: "Z." },
    ]);
    expect(res.records[1].author).toBeUndefined();
    roundTrips(res.records);
  });
});

describe("real export: Zotero RIS patents (assignee → publisher)", () => {
  // zotero-patents2205533.ris: https://api.zotero.org/groups/2205533/items?itemType=patent&format=ris
  // (fetched 2026-10-14; CRLF, and an AB wrapped onto indented untagged lines).
  // Zotero's RIS translator maps PB ↔ assignee for patents in both directions (RIS.js
  // fieldMap PB: { assignee: ["patent"] }); the contract has no assignee field, and the
  // Vancouver/NLM patent form prints it from `publisher`.
  const res = parseRis(fx("zotero-patents2205533.ris"));
  test("PB is the assignee; SN the number; A2 the authority; DA the issue date", () => {
    expect(res.refused).toEqual([]);
    expect(res.records[0]).toEqual({
      id: "Iizuka1986",
      type: "patent",
      author: [
        { family: "Iizuka", given: "Masanori" },
        { family: "Tanaka", given: "Hideki" },
      ],
      title: "Cement admixture",
      issued: { "date-parts": [[1986, 5, 6]] },
      accessed: { "date-parts": [[2025, 3, 31]] },
      URL: "https://patents.google.com/patent/US4586960A/",
      publisher: "Kao Corp",
      number: "4,586,960",
      authority: "US",
    });
    expect(res.records[1]).toMatchObject({
      id: "Hiremath2016",
      publisher: "International Business Machines Corporation",
      number: "9,367,592",
      authority: "U.S.",
      issued: { "date-parts": [[2016, 6, 14]] },
    });
    expect(res.records[1].author).toHaveLength(4);
    roundTrips(res.records);
  });
});

describe("real export: Crossref, Springer, Scopus, ScienceDirect", () => {
  test("Crossref: SP holds the whole range with no EP", () => {
    const res = parseRis(fx("crossref-kwon2022.ris"));
    expect(res.refused).toEqual([]);
    expect(res.records).toEqual([
      {
        id: "Kwon2022",
        type: "article-journal",
        author: [{ family: "Kwon", given: "Hyeyoung" }],
        title: "Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life",
        "container-title": "American Journal of Sociology",
        issued: { "date-parts": [[2022, 5, 1]] },
        volume: "127",
        issue: "6",
        page: "1818–1859",
        DOI: "10.1086/720277",
        URL: "http://dx.doi.org/10.1086/720277",
        publisher: "University of Chicago Press",
      },
    ]);
  });
  test("Springer: 29 repeated AU lines in order, JO is the full title when no T2/JF, ID tag is the id, ER without a trailing space", () => {
    const res = parseRis(fx("springer-zhou2020.ris"));
    expect(res.refused).toEqual([]);
    const r = res.records[0];
    expect(r.id).toBe("Zhou2020");
    expect(r.author).toHaveLength(29);
    expect(r.author![0]).toEqual({ family: "Zhou", given: "Peng" });
    expect(r.author![28]).toEqual({ family: "Shi", given: "Zheng-Li" });
    expect(r["container-title"]).toBe("Nature");
    expect(r["container-title-short"]).toBeUndefined();
    expect(r.page).toBe("270–273");
    expect(r.issued).toEqual({ "date-parts": [[2020, 3, 1]] });
    roundTrips(res.records);
  });
  test("Scopus: Unicode survives (Facoltà in AD is ignored, title intact)", () => {
    const res = parseRis(fx("scopus-federico2004.ris"));
    expect(res.refused).toEqual([]);
    expect(res.records[0]).toMatchObject({
      "container-title": "Journal of the Mechanics and Physics of Solids",
      page: "2309–2327",
      DOI: "10.1016/j.jmps.2004.03.010",
      author: [{ family: "Federico", given: "S." }, { family: "Grillo", given: "A." }, { family: "Herzog", given: "W." }],
    });
    // Scopus's UR is its own index page, not the work. Kept as data (never dropped);
    // the styles suppress index-page URLs at print time.
    expect(res.records[0].URL).toMatch(/^http:\/\/www\.scopus\.com\/inward\/record\.url\?eid=/);
  });
  test("ScienceDirect: empty 'T2  - ' and 'IS  - ' never override; DO in URL form; ω in the title; PY 2016/12//", () => {
    const res = parseRis(fx("sciencedirect-ghosh2016.ris"));
    expect(res.refused).toEqual([]);
    const r = res.records[0];
    expect(r.title).toBe("Phase separation and ω transformation in binary V-Ti and ternary V-Ti-Cr alloys");
    expect(r["container-title"]).toBe("Acta Materialia");
    expect(r.issue).toBeUndefined();
    expect(r.DOI).toBe("10.1016/j.actamat.2016.09.028");
    expect(r.issued).toEqual({ "date-parts": [[2016, 12]] });
  });
});

describe("real export: EndNote (transcribed)", () => {
  const res = parseRis(fx("endnote-castoe2009.ris"));
  test("single-space tags, L1 continuation lines, ER - without a trailing space", () => {
    expect(res.refused).toEqual([]);
    expect(res.records).toEqual([
      {
        id: "3",
        type: "article-journal",
        author: [
          { family: "CASTOE", given: "TODD A." },
          { family: "POOLE", given: "ALEXANDER W." },
          { family: "GU", given: "WANJUN" },
          // Stored as written: no re-casing, no guessed particle.
          { family: "KONING", given: "A. P. JASON de" },
          { family: "DAZA", given: "JUAN M." },
          { family: "SMITH", given: "ERIC N." },
          { family: "POLLOCK", given: "DAVID D." },
        ],
        title:
          "Rapid identification of thousands of copperhead snake (Agkistrodon contortrix) microsatellite loci from modest amounts of 454 shotgun genome sequence",
        "container-title": "Molecular Ecology Resources",
        issued: { "date-parts": [[2009]] },
        volume: "9999",
        URL: "http://dx.doi.org/10.1111/j.1755-0998.2009.02750.x",
      },
    ]);
    roundTrips(res.records);
  });
  test("the same bytes with CRLF line endings import identically", () => {
    const crlf = parseRis(fx("endnote-castoe2009.ris").replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(res);
  });
});

describe("tag rules (inline samples from Zotero RIS.js test cases)", () => {
  test("Reference Manager: A1 'Baldwin,S.A.' (no space), T1 wrapped onto a second line, JO abbreviation, Y1", () => {
    const src = [
      "TY  - JOUR",
      "A1  - Baldwin,S.A.",
      "A1  - Fugaccia,I.",
      "T1  - Blood-brain barrier breach following",
      "cortical contusion in the rat",
      "JO  - J.Neurosurg.",
      "Y1  - 1996",
      "VL  - 85",
      "SP  - 476",
      "EP  - 481",
      "RP  - Not In File",
      "ER  - ",
    ].join("\n");
    const r = parseRis(src).records[0];
    expect(r.author).toEqual([
      { family: "Baldwin", given: "S.A." },
      { family: "Fugaccia", given: "I." },
    ]);
    expect(r.title).toBe("Blood-brain barrier breach following cortical contusion in the rat");
    expect(r["container-title"]).toBe("J.Neurosurg.");
    expect(r.issued).toEqual({ "date-parts": [[1996]] });
    expect(r.page).toBe("476–481");
  });
  test("DA wins over Y1 even when Y1 comes first (RIS.js 'Deprecated tag test')", () => {
    const src = "TY  - JOUR\nT1  - Deprecated tag test\nY1  - 1900/01/01\nDA  - 1950/01/01\nER  - ";
    expect(parseRis(src).records[0].issued).toEqual({ "date-parts": [[1950, 1, 1]] });
  });
  test("A1 and AU interleave in file order (RIS.js 'Mixed author tags')", () => {
    const src = "TY  - JOUR\nTI  - Mixed author tags\nA1  - Georgiev, Danko\nAU  - Bello, Leon\nAU  - Carmi, Avishy\nAU  - Cohen, Eliahu\nER  - ";
    expect(parseRis(src).records[0].author!.map((a) => a.family)).toEqual(["Georgiev", "Bello", "Carmi", "Cohen"]);
  });
  test("JF full + JO abbreviation (EndNote, Light & McNaughton 2014): JO becomes the short title", () => {
    const src = [
      "TY  - JOUR",
      "T1  - From Basic to Applied Research to Improve Outcomes for Individuals Who Require Augmentative and Alternative Communication:  Potential Contributions of Eye Tracking Research Methods",
      "AU  - Light, Janice",
      "AU  - McNaughton, David",
      "Y1  - 2014/06/01",
      "PY  - 2014",
      "DA  - 2014/06/01",
      "N1  - doi: 10.3109/07434618.2014.906498",
      "DO  - 10.3109/07434618.2014.906498",
      "T2  - Augmentative and Alternative Communication",
      "JF  - Augmentative and Alternative Communication",
      "JO  - Augment Altern Commun",
      "SP  - 99",
      "EP  - 105",
      "VL  - 30",
      "IS  - 2",
      "PB  - Informa Allied Health",
      "ER  -",
    ].join("\n");
    const r = parseRis(src).records[0];
    expect(r["container-title"]).toBe("Augmentative and Alternative Communication");
    expect(r["container-title-short"]).toBe("Augment Altern Commun");
    expect(r.title).toBe(
      "From Basic to Applied Research to Improve Outcomes for Individuals Who Require Augmentative and Alternative Communication: Potential Contributions of Eye Tracking Research Methods",
    );
    expect(r.issued).toEqual({ "date-parts": [[2014, 6, 1]] });
    expect(r.page).toBe("99–105");
    expect(r.DOI).toBe("10.3109/07434618.2014.906498");
  });
  test("Scopus CRLF pair: DOI ending in a legitimate ')' and a PY 0000 record with no title", () => {
    const src =
      "TY  - JOUR\r\nTI  - Using focus groups to adapt ethnically appropriate, information-seeking and recruitment messages for a prostate cancer screening program for men at high risk\r\nT2  - Journal of the National Medical Association\r\nVL  - 100\r\nIS  - 6\r\nSP  - 674\r\nEP  - 682\r\nPY  - 2008\r\nDO  - 10.1016/S0027-9684(15)31340-7\r\nAU  - Bryan, C.J.\r\nAU  - Wetmore-Arkader, L.\r\nN1  - Cited By :10\r\nER  - \r\n\r\nTY  - JOUR\r\nT2  - Prostate Cancer Mortality Statistics 2015\r\nPY  - 0000\r\nN1  - Cited By :1\r\nER  - \r\n\r\n";
    const res = parseRis(src);
    expect(res.refused).toEqual([]);
    expect(res.records[0].DOI).toBe("10.1016/S0027-9684(15)31340-7");
    expect(res.records[0].author![1]).toEqual({ family: "Wetmore-Arkader", given: "L." });
    // PY 0000 → no issued date at all (never [0]).
    expect(res.records[1].issued).toBeUndefined();
    expect(res.records[1].title).toBeUndefined();
    expect(res.records[1]["container-title"]).toBe("Prostate Cancer Mortality Statistics 2015");
    expect(res.records[1].id).toBe("ref");
  });
  test("patents: Zotero puts the number in SN and the authority in A2; EndNote puts the number in IS", () => {
    const zotero = parseRis("TY  - PAT\nTI  - Widget\nAU  - Inventor, Ida\nA2  - United States Patent and Trademark Office\nSN  - US 4,904,581\nDA  - 1990/02/27\nER  - ").records[0];
    expect(zotero).toEqual({
      id: "Inventor1990",
      type: "patent",
      author: [{ family: "Inventor", given: "Ida" }],
      title: "Widget",
      issued: { "date-parts": [[1990, 2, 27]] },
      number: "US 4,904,581",
      authority: "United States Patent and Trademark Office",
    });
    // RIS.js test case (EndNote-style patent): IS is the patent number, CY a state, VL an application number.
    const endnote = parseRis(
      "TY  - PAT\nA1  - Burger,D.R.\nA1  - Goldstein,A.S.\nT1  - Method of detecting AIDS virus infection\nY1  - 1990/2/27\nVL  - 877609\nIS  - 4,904,581\nRP  - Not In File\nCY  - OR\nPB  - 4,629,783\nER  - ",
    ).records[0];
    expect(endnote.number).toBe("4,904,581");
    // PB is mapped exactly as Zotero maps it (its expected item has assignee "4,629,783"),
    // even though this EndNote record put a number there: stored as written, not guessed at.
    expect(endnote.publisher).toBe("4,629,783");
    expect(endnote.issued).toEqual({ "date-parts": [[1990, 2, 27]] });
    expect(endnote.volume).toBeUndefined();
    expect(endnote.issue).toBeUndefined();
  });
  test("other types: CHAP (T2 = book, A2 = editors), CONF, THES (M3 genre), RPRT, ELEC, DATA, EDBOOK, UNPB", () => {
    const one = (s: string): BibRecord => {
      const r = parseRis(s);
      expect(r.refused).toEqual([]);
      return r.records[0];
    };
    expect(one("TY  - CHAP\nTI  - Ch\nAU  - A, B\nA2  - Ed, Ed\nT2  - The Book\nPB  - Wiley\nCY  - Hoboken\nSP  - 1\nEP  - 9\nPY  - 2010\nER  - ")).toMatchObject({
      type: "chapter", "container-title": "The Book", editor: [{ family: "Ed", given: "Ed" }], publisher: "Wiley", "publisher-place": "Hoboken", page: "1–9",
    });
    expect(one("TY  - CONF\nTI  - Talk\nT2  - Proc. X\nPY  - 2011\nER  - ")).toMatchObject({ type: "paper-conference", "container-title": "Proc. X" });
    expect(one("TY  - THES\nTI  - Diss\nPB  - MIT\nM3  - PhD Thesis\nPY  - 2015\nER  - ")).toMatchObject({ type: "thesis", publisher: "MIT", genre: "PhD Thesis" });
    expect(one("TY  - RPRT\nTI  - Rep\nSN  - TN-1297\nPY  - 1994\nER  - ")).toMatchObject({ type: "report", number: "TN-1297" });
    expect(one("TY  - RPRT\nTI  - Rep\nSN  - 978-0-19-726633-5\nPY  - 1994\nER  - ").number).toBeUndefined();
    expect(one("TY  - ELEC\nTI  - Page\nUR  - https://x.org\nY2  - 2024/01/31/10:00:00\nER  - ")).toMatchObject({
      type: "webpage", URL: "https://x.org", accessed: { "date-parts": [[2024, 1, 31]] },
    });
    expect(one("TY  - DATA\nTI  - Moving language: Mothers’ verbs\nAU  - West, Kelsey Louise\nDO  - 10.17910/B7.1322\nPY  - 2021\nPB  - Databrary\nER  - ")).toMatchObject({
      type: "dataset", DOI: "10.17910/B7.1322", publisher: "Databrary", title: "Moving language: Mothers’ verbs",
    });
    expect(one("TY  - EDBOOK\nTI  - Edited\nAU  - Ed, Ed\nPY  - 2000\nER  - ")).toMatchObject({ type: "book", editor: [{ family: "Ed", given: "Ed" }] });
    expect(one("TY  - UNPB\nTI  - Draft\nPY  - 2000\nER  - ").type).toBe("article");
  });
});

describe("refusals by line", () => {
  test("missing ER before the next TY, ER without TY, a tag outside any record, a record that never ends, a bad DO", () => {
    const src = [
      "AU  - Stray, Line", //   1
      "TY  - JOUR", //          2
      "TI  - First", //         3
      "TY  - JOUR", //          4
      "TI  - Second", //        5
      "ER  - ", //              6
      "ER  - ", //              7
      "TY  - JOUR", //          8
      "DO  - not-a-doi", //     9
      "ER  - ", //              10
      "TY  - JOUR", //          11
      "TI  - Unfinished", //    12
    ].join("\n");
    const res = parseRis(src);
    expect(res.records.map((r) => r.title)).toEqual(["Second"]);
    expect(res.refused).toEqual([
      { line: 1, reason: "AU line outside a record (no TY line before it)" },
      { line: 2, reason: "record has no ER line before the next TY on line 4" },
      { line: 7, reason: "ER line with no TY line before it" },
      { line: 8, reason: "“not-a-doi” is not a DOI: a DOI starts with “10.”, 4–9 digits and a slash (10.1086/720277)." },
      { line: 11, reason: "record ends without an ER line" },
    ]);
  });
  test("duplicate ID tags are refused by name; generated ids never collide with stated ones", () => {
    const res = parseRis("TY  - JOUR\nAU  - Smith, J\nPY  - 2020\nER  - \nTY  - JOUR\nID  - Smith2020\nER  - \nTY  - JOUR\nID  - Smith2020\nER  - ");
    expect(res.records.map((r) => r.id)).toEqual(["Smith2020a", "Smith2020"]);
    expect(res.refused).toEqual([{ line: 8, reason: "duplicate ID “Smith2020” (first used on line 5)" }]);
  });
  test("banner text outside records (export headers) is ignored, not refused", () => {
    const res = parseRis("Provider: Elsevier\nDatabase: Elsevier ScienceDirect Journals\n\nTY  - JOUR\nTI  - T\nER  - ");
    expect(res.refused).toEqual([]);
    expect(res.records).toHaveLength(1);
  });
});

describe("parseRisDate", () => {
  test.each([
    ["2007///", [2007]],
    ["2024/03//", [2024, 3]],
    ["1990/2/27", [1990, 2, 27]],
    ["2008/10/01/21:33:40", [2008, 10, 1]],
    ["2020-05-12", [2020, 5, 12]],
    ["2016/13/40/", [2016]],
  ])("%s", (raw, parts) => {
    expect(parseRisDate(raw)).toEqual({ "date-parts": [parts] });
  });
  test("0000 → no date; free text → literal", () => {
    expect(parseRisDate("0000")).toBeUndefined();
    expect(parseRisDate("Spring 2020")).toEqual({ literal: "Spring 2020" });
  });
});
