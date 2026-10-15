// Citation styles against their OWN manuals (docs/SCOPE-CITATIONS-2026-10.md §C6 rule:
// a style ships only with ≥3 verbatim manual examples per item type it claims).
//
// Every `raw` string below is copied verbatim from the source named in its `src` and was
// re-checked character for character against the fetched page (all fetched 2026-10-14).
// Italic and bold are not visible in a plain string; they are pinned separately in the html
// tests at the bottom. The ONLY edits applied to a raw string before comparison are the
// named ones in NORMALISE (dash characters, required by the display contract).
//
// Sources (accessed 2026-10-14):
//   IEEE  IEEE Reference Guide V 3.28.2025, https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf
//         (redirects to https://docs.google.com/document/d/1j1L96U2NagwWI9MEVDNVKt9pXxRzTH7h3krI3Mb6wZE)
//   ACS   ACS Guide to Scholarly Communication, 4.3.3 ACS Style Quick Guide (last updated April 14, 2026),
//         https://pubs.acs.org/doi/full/10.1021/acsguide.40303
//   NAT1  Scientific Reports submission guidelines ("we use the standard Nature referencing style"),
//         https://www.nature.com/srep/author-instructions/submission-guidelines
//   NAT2  Nature Chemistry, AIP and formatting, https://www.nature.com/nchem/submission-guidelines/aip-and-formatting
//   NAT3  Nature formatting guide (author rule), https://www.nature.com/nature/for-authors/formatting-guide
//   NLM   NLM Samples of Formatted References for Authors of Journal Articles, https://www.nlm.nih.gov/bsd/uniform_requirements.html
//   CM2   Citing Medicine 2nd ed., chapter 2 Books, https://www.ncbi.nlm.nih.gov/books/n/citmed/A34155/
//   CM7   Citing Medicine 2nd ed., chapter 7 Patents, https://www.ncbi.nlm.nih.gov/books/n/citmed/A40800/
//   APAJ  https://apastyle.apa.org/style-grammar-guidelines/references/examples/journal-article-references
//   APAB  https://apastyle.apa.org/style-grammar-guidelines/references/examples/book-references
//   APAC  https://apastyle.apa.org/style-grammar-guidelines/references/examples/edited-book-chapter-references
//   APAE  https://apastyle.apa.org/style-grammar-guidelines/references/elements-list-entry
//   CAD   CMOS 18 Citation Quick Guide, author-date, https://www.chicagomanualofstyle.org/tools_citationguide/citation-guide-2.html
//   CNB   CMOS 18 Citation Quick Guide, notes and bibliography, https://www.chicagomanualofstyle.org/tools_citationguide/citation-guide-1.html

import type { BibName, BibRecord, BibType, CiteItem, StyleId } from "../bibRecord";
import {
  STYLES, STYLE_INFO, STYLE_RULES, getStyle, formatReference, referenceWarnings, makeVancouver,
  BibStyleRefusal, chicagoShortTitle, compressNumbers,
} from "../bibStyles";

// ---------------------------------------------------------------- helpers

const p = (family: string, given?: string, extra: Partial<BibName> = {}): BibName =>
  ({ family, ...(given ? { given } : {}), ...extra });
const lit = (literal: string): BibName => ({ literal });
let seq = 0;
const R = (type: BibType, f: Omit<BibRecord, "id" | "type">): BibRecord => ({ id: `r${++seq}`, type, ...f });
const Y = (y: number, m?: number, d?: number): BibRecord["issued"] =>
  ({ "date-parts": [m === undefined ? [y] : d === undefined ? [y, m] : [y, m, d]] });

// Built from escapes so no look-alike character is typed into the test source.
const EN_DASH = String.fromCharCode(0x2013);
const MINUS_BETWEEN_DIGITS = new RegExp("(\\d)\\u2212(\\d)", "g");

/** The named normalisations, and only these. */
const NORMALISE: Record<string, (s: string) => string> = {
  none: (s: string): string => s,
  // The ACS website renders page ranges with U+2212 MINUS SIGN; the display contract prints
  // the en dash (U+2013). Only a minus between two digits is touched.
  acsMinus: (s: string): string => s.replace(MINUS_BETWEEN_DIGITS, (_m, a: string, b: string) => a + EN_DASH + b),
  // …plus Unicode NFC, for a page that stores accents decomposed (records are NFC-normalised at import).
  acsMinusNfc: (s: string): string => NORMALISE.acsMinus(s).normalize("NFC"),
  // Scientific Reports prints "35-39" with a hyphen while Nature Chemistry prints "524–526"
  // with an en dash; the display contract prints the en dash.
  hyphenRange: (s: string): string => s.replace(/(\d)-(\d)/g, (_m, a: string, b: string) => a + EN_DASH + b),
};

interface Oracle {
  src: string;
  raw: string;
  rec: BibRecord;
  norm?: keyof typeof NORMALISE;
}

function check(style: StyleId, list: Oracle[]): void {
  test.each(list.map((o) => [o.raw.slice(0, 60), o] as const))("%s…", (_label, o) => {
    const want = NORMALISE[o.norm ?? "none"](o.raw);
    const got = STYLES[style]!.reference(o.rec);
    expect(got.plain).toBe(want);
    expect(got.html).not.toMatch(/H2O|CO2|\^/);
  });
}

const typesPinned = (list: Oracle[]): Map<BibType, number> => {
  const m = new Map<BibType, number>();
  for (const o of list) m.set(o.rec.type, (m.get(o.rec.type) ?? 0) + 1);
  return m;
};

function coverage(style: StyleId, list: Oracle[]): void {
  test(`${style}: every claimed type has ≥3 pinned manual examples`, () => {
    const m = typesPinned(list);
    for (const t of STYLE_INFO[style].types) expect([t, m.get(t) ?? 0]).toEqual([t, expect.any(Number)]);
    for (const t of STYLE_INFO[style].types) expect(m.get(t) ?? 0).toBeGreaterThanOrEqual(3);
  });
}

// Synthetic names for threshold tests (never printed as if real).
const many = (k: number): BibName[] => Array.from({ length: k }, (_, i) => p(`Author${String.fromCharCode(65 + i)}`, "Q. R."));

// ================================================================ IEEE

const IEEE: Oracle[] = [
  // Periodical With DOI
  { src: "IEEE", raw: "M. M. Chiampi and L. L. Zilberti, “Induction of electric field in human bodies moving near MRI: An efficient BEM computational procedure,” IEEE Trans. Biomed. Eng., vol. 58, no. 10, pp. 2787–2793, Oct. 2011, doi: 10.1109/TBME.2011.2158315.",
    rec: R("article-journal", { author: [p("Chiampi", "M. M."), p("Zilberti", "L. L.")], title: "Induction of electric field in human bodies moving near MRI: An efficient BEM computational procedure",
      "container-title": "IEEE Transactions on Biomedical Engineering", "container-title-short": "IEEE Trans. Biomed. Eng.", volume: "58", issue: "10", page: "2787-2793", issued: Y(2011, 10), DOI: "10.1109/TBME.2011.2158315" }) },
  // Periodicals (et al. given by the source)
  { src: "IEEE", raw: "M. Ito et al., “Can the application of amorphous oxide TFT be an electrophoretic display?,” J. Non-Cryst. Solids, vol. 354, no. 19, pp. 2777–2782, Feb. 2008.",
    rec: R("article-journal", { author: [p("Ito", "M.")], "et-al-in-source": true, title: "Can the application of amorphous oxide TFT be an electrophoretic display?",
      "container-title-short": "J. Non-Cryst. Solids", volume: "354", issue: "19", page: "2777–2782", issued: Y(2008, 2) }) },
  // Periodical With Article ID (five authors: all listed)
  { src: "IEEE", raw: "R. Fardel, M. Nagel, F. Nuesch, T. Lippert, and A. Wokaun, “Fabrication of organic light emitting diode pixels by laser-assisted forward transfer,” Appl. Phys. Lett., vol. 91, no. 6, Aug. 2007, Art. no. 061103.",
    rec: R("article-journal", { author: [p("Fardel", "R."), p("Nagel", "M."), p("Nuesch", "F."), p("Lippert", "T."), p("Wokaun", "A.")],
      title: "Fabrication of organic light emitting diode pixels by laser-assisted forward transfer", "container-title-short": "Appl. Phys. Lett.", volume: "91", issue: "6", issued: Y(2007, 8), "article-number": "061103" }) },
  { src: "IEEE", raw: "T. Brunschwiler et al., “Formulation of percolating thermal underfills using hierarchical self-assembly of microparticles and nanoparticles by centrifugal forces and capillary bridging,” J. Microelectron. Electron. Packag., vol. 9, no. 4, pp. 149–159, 2012, doi: 10.4071/imaps.357.",
    rec: R("article-journal", { author: [p("Brunschwiler", "T."), ...many(6)], title: "Formulation of percolating thermal underfills using hierarchical self-assembly of microparticles and nanoparticles by centrifugal forces and capillary bridging",
      "container-title-short": "J. Microelectron. Electron. Packag.", volume: "9", issue: "4", page: "149-159", issued: Y(2012), DOI: "https://doi.org/10.4071/imaps.357" }) },
  { src: "IEEE", raw: "H. Eriksson and P. E. Danielsson, “Two problems on Boolean memories,” IEEE Trans. Electron. Devices, vol. ED-11, no. 1, pp. 32–33, Jan. 1959.",
    rec: R("article-journal", { author: [p("Eriksson", "H."), p("Danielsson", "P. E.")], title: "Two problems on Boolean memories",
      "container-title-short": "IEEE Trans. Electron. Devices", volume: "ED-11", issue: "1", page: "32-33", issued: Y(1959, 1) }) },
  // Books
  { src: "IEEE", raw: "B. Klaus and P. Horn, Robot Vision. Cambridge, MA, USA: MIT Press, 1986.",
    rec: R("book", { author: [p("Klaus", "B."), p("Horn", "P.")], title: "Robot Vision", "publisher-place": "Cambridge, MA, USA", publisher: "MIT Press", issued: Y(1986) }) },
  { src: "IEEE", raw: "W. R. Leonard and M. H. Crawford, Eds. Human Biology of Pastoral Populations. New York, NY, USA: Cambridge Univ. Press, 2002.",
    rec: R("book", { editor: [p("Leonard", "W. R."), p("Crawford", "M. H.")], title: "Human Biology of Pastoral Populations", "publisher-place": "New York, NY, USA", publisher: "Cambridge Univ. Press", issued: Y(2002) }) },
  { src: "IEEE", raw: "Westinghouse Electric Corporation (Staff of Technology and Science, Aerospace Div.), Integrated Electronic Systems. Englewood Cliffs, NJ, USA: Prentice-Hall, 1970.",
    rec: R("book", { author: [lit("Westinghouse Electric Corporation (Staff of Technology and Science, Aerospace Div.)")], title: "Integrated Electronic Systems", "publisher-place": "Englewood Cliffs, NJ, USA", publisher: "Prentice-Hall", issued: Y(1970) }) },
  // Book With Editor(s) / chapters
  { src: "IEEE", raw: "L. Stein, “Random patterns,” in Computers and You, J. S. Brake, Ed., New York, NY, USA: Wiley, 1994, pp. 55–70.",
    rec: R("chapter", { author: [p("Stein", "L.")], title: "Random patterns", "container-title": "Computers and You", editor: [p("Brake", "J. S.")], "publisher-place": "New York, NY, USA", publisher: "Wiley", issued: Y(1994), page: "55-70" }) },
  { src: "IEEE", raw: "C. Bennett, “What happens when you book an airline ticket? The collection and processing of passenger data post-9/11,” in Global Surveillance and Policing: Borders, Security, Identity, E. Zureik and M. Salter, Eds., Cullompton, U.K.: Willan, 2005, pp. 113–138.",
    rec: R("chapter", { author: [p("Bennett", "C.")], title: "What happens when you book an airline ticket? The collection and processing of passenger data post-9/11", "container-title": "Global Surveillance and Policing: Borders, Security, Identity",
      editor: [p("Zureik", "E."), p("Salter", "M.")], "publisher-place": "Cullompton, U.K.", publisher: "Willan", issued: Y(2005), page: "113-138" }) },
  { src: "IEEE", raw: "L. Li, J. Yang, and C. Li, “Super-resolution restoration and image reconstruction for passive millimeter wave imaging,” in Image Restoration—Recent Advances and Applications, A. Histace, Ed., Rijeka, Croatia: InTech, 2012, pp. 25–45.",
    rec: R("chapter", { author: [p("Li", "L."), p("Yang", "J."), p("Li", "C.")], title: "Super-resolution restoration and image reconstruction for passive millimeter wave imaging", "container-title": "Image Restoration—Recent Advances and Applications",
      editor: [p("Histace", "A.")], "publisher-place": "Rijeka, Croatia", publisher: "InTech", issued: Y(2012), page: "25-45" }) },
  { src: "IEEE", raw: "R. L. Myer, “Parametric oscillators and nonlinear materials,” in Nonlinear Optics, vol. 4, P. G. Harper and B. S. Wherret, Eds., San Francisco, CA, USA: Academic, 1977, pp. 47–160.",
    rec: R("chapter", { author: [p("Myer", "R. L.")], title: "Parametric oscillators and nonlinear materials", "container-title": "Nonlinear Optics", volume: "4",
      editor: [p("Harper", "P. G."), p("Wherret", "B. S.")], "publisher-place": "San Francisco, CA, USA", publisher: "Academic", issued: Y(1977), page: "47-160" }) },
  // Conference Proceedings in Print / With DOI
  { src: "IEEE", raw: "A. Amador-Perez and R. A. Rodriguez-Solis, “Analysis of a CPW-fed annular slot ring antenna using DOE,” in Proc. IEEE Antennas Propag. Soc. Int. Symp., Jul. 2006, pp. 4301–4304.",
    rec: R("paper-conference", { author: [p("Amador-Perez", "A."), p("Rodriguez-Solis", "R. A.")], title: "Analysis of a CPW-fed annular slot ring antenna using DOE",
      "container-title-short": "Proc. IEEE Antennas Propag. Soc. Int. Symp.", issued: Y(2006, 7), page: "4301-4304" }) },
  { src: "IEEE", raw: "G. Veruggio, “The EURON roboethics roadmap,” in Proc. Humanoids ’06: 6th IEEE-RAS Int. Conf. Humanoid Robots, 2006, pp. 612–617, doi: 10.1109/ICHR.2006.321337.",
    rec: R("paper-conference", { author: [p("Veruggio", "G.")], title: "The EURON roboethics roadmap", "container-title-short": "Proc. Humanoids ’06: 6th IEEE-RAS Int. Conf. Humanoid Robots",
      issued: Y(2006), page: "612-617", DOI: "10.1109/ICHR.2006.321337" }) },
  { src: "IEEE", raw: "J. Zhao, G. Sun, G. H. Loh, and Y. Xie, “Energy-efficient GPU design with reconfigurable in-package graphics memory,” in Proc. ACM/IEEE Int. Symp. Low Power Electron. Design (ISLPED), Jul. 2012, pp. 403–408, doi: 10.1145/2333660.2333752.",
    rec: R("paper-conference", { author: [p("Zhao", "J."), p("Sun", "G."), p("Loh", "G. H."), p("Xie", "Y.")], title: "Energy-efficient GPU design with reconfigurable in-package graphics memory",
      "container-title-short": "Proc. ACM/IEEE Int. Symp. Low Power Electron. Design (ISLPED)", issued: Y(2012, 7), page: "403-408", DOI: "doi:10.1145/2333660.2333752" }) },
  // Theses and Dissertations
  { src: "IEEE", raw: "J. O. Williams, “Narrow-band analyzer,” Ph.D. dissertation, Dept. Elect. Eng., Harvard Univ., Cambridge, MA, USA, 1993.",
    rec: R("thesis", { author: [p("Williams", "J. O.")], title: "Narrow-band analyzer", genre: "Ph.D. dissertation", publisher: "Dept. Elect. Eng., Harvard Univ.", "publisher-place": "Cambridge, MA, USA", issued: Y(1993) }) },
  { src: "IEEE", raw: "N. Kawasaki, “Parametric study of thermal and chemical nonequilibrium nozzle flow,” M.S. thesis, Dept. Electron. Eng., Osaka Univ., Osaka, Japan, 1993.",
    rec: R("thesis", { author: [p("Kawasaki", "N.")], title: "Parametric study of thermal and chemical nonequilibrium nozzle flow", genre: "M.S. thesis", publisher: "Dept. Electron. Eng., Osaka Univ.", "publisher-place": "Osaka, Japan", issued: Y(1993) }) },
  { src: "IEEE", raw: "F. Jensen, “Electromagnetic near-field far-field correlations,” Ph.D. dissertation, Dept. Elect. Eng., Tech. Univ. Denmark, Lyngby, Denmark, 1970. [Online]. Available: www.tud.ed/jensen/diss",
    rec: R("thesis", { author: [p("Jensen", "F.")], title: "Electromagnetic near-field far-field correlations", genre: "Ph.D. dissertation", publisher: "Dept. Elect. Eng., Tech. Univ. Denmark", "publisher-place": "Lyngby, Denmark", issued: Y(1970), URL: "www.tud.ed/jensen/diss" }) },
  // Reports
  { src: "IEEE", raw: "J. H. Davis and J. R. Cogdell, “Calibration program for the 16-foot antenna,” Elect. Eng. Res. Lab., Univ. Texas, Austin, Tech. Memo. NGL-006-69-3, Nov. 15, 1987.",
    rec: R("report", { author: [p("Davis", "J. H."), p("Cogdell", "J. R.")], title: "Calibration program for the 16-foot antenna", publisher: "Elect. Eng. Res. Lab., Univ. Texas", "publisher-place": "Austin", genre: "Tech. Memo.", number: "NGL-006-69-3", issued: Y(1987, 11, 15) }) },
  { src: "IEEE", raw: "P. Diament, S. L. Richert, and W. L. Lupatkin, “V-line surface-wave radiation and scanning,” Dept. Elect. Eng., Columbia Univ., New York, NY, USA, Sci. Rep. 85, Aug. 1991.",
    rec: R("report", { author: [p("Diament", "P."), p("Richert", "S. L."), p("Lupatkin", "W. L.")], title: "V-line surface-wave radiation and scanning", publisher: "Dept. Elect. Eng., Columbia Univ.", "publisher-place": "New York, NY, USA", genre: "Sci. Rep.", number: "85", issued: Y(1991, 8) }) },
  { src: "IEEE", raw: "R. E. Haskell and C. T. Case, “Transient signal propagation in lossless isotropic plasmas,” USAF Cambridge Res. Labs., Cambridge, MA, USA, Rep. ARCRL-66-234 (II), 1994, vol. 2.",
    rec: R("report", { author: [p("Haskell", "R. E."), p("Case", "C. T.")], title: "Transient signal propagation in lossless isotropic plasmas", publisher: "USAF Cambridge Res. Labs.", "publisher-place": "Cambridge, MA, USA", number: "ARCRL-66-234 (II)", issued: Y(1994), volume: "2" }) },
];

describe("IEEE (IEEE Reference Guide V 3.28.2025)", () => {
  check("ieee", IEEE);
  coverage("ieee", IEEE);
  test("et al. threshold: “up to six names … more than six … primary author’s name followed by et al.”", () => {
    const base = { title: "T", "container-title-short": "J. X", volume: "1", page: "1-2", issued: Y(2020) };
    expect(STYLES.ieee!.reference(R("article-journal", { ...base, author: many(6) })).plain)
      .toMatch(/^Q\. R\. AuthorA, Q\. R\. AuthorB, Q\. R\. AuthorC, Q\. R\. AuthorD, Q\. R\. AuthorE, and Q\. R\. AuthorF, /);
    expect(STYLES.ieee!.reference(R("article-journal", { ...base, author: many(7) })).plain).toMatch(/^Q\. R\. AuthorA et al\., “T,”/);
    expect(STYLE_RULES.ieee.refEtAl).toEqual({ max: 6, keep: 1 });
  });
  test("in-text: “[2], [4], [5]”, locators “[3, pp. 5–10]; [3, eq. (2)]; [3, Fig. 1]”, and no en-dash ranges", () => {
    const r = R("book", { title: "X", issued: Y(2000) });
    const m = (n: number, item: Partial<CiteItem> = {}) => ({ rec: r, n, item: { id: r.id, ...item } });
    expect(STYLES.ieee!.marker([m(2), m(4), m(5), m(6), m(7), m(9)]).plain).toBe("[2], [4], [5], [6], [7], [9]");
    expect(STYLES.ieee!.marker([m(3, { locator: "5-10", label: "page" })]).plain).toBe("[3, pp. 5–10]");
    expect(STYLES.ieee!.marker([m(3, { locator: "2", label: "equation" })]).plain).toBe("[3, eq. (2)]");
    expect(STYLES.ieee!.marker([m(3, { locator: "1", label: "figure" })]).plain).toBe("[3, Fig. 1]");
    expect(STYLE_RULES.ieee.compressRanges).toBe(false);
  });
});

// ================================================================ ACS

const ACS: Oracle[] = [
  { src: "ACS", norm: "acsMinus", raw: "Tan, G. Y.; Das, M.; Keum, H.; Bellotti, P.; Daniliuc, C.; Glorius, F. Photochemical single-step synthesis of β-amino acid derivatives from alkenes and (hetero)arenes. Nature Chemistry 2022, 14 (10), 1174−1184. DOI: 10.1038/s41557-022-01008-w",
    rec: R("article-journal", { author: [p("Tan", "G. Y."), p("Das", "M."), p("Keum", "H."), p("Bellotti", "P."), p("Daniliuc", "C."), p("Glorius", "F.")],
      title: "Photochemical single-step synthesis of β-amino acid derivatives from alkenes and (hetero)arenes", "container-title": "Nature Chemistry", "container-title-short": "Nat. Chem.",
      issued: Y(2022), volume: "14", issue: "10", page: "1174-1184", DOI: "10.1038/s41557-022-01008-w" }) },
  { src: "ACS", raw: "Westermayr, J.; Gastegger, M.; Schütt, K. T.; Maurer, R. J. Perspective on integrating machine learning into computational chemistry and materials science. Journal of Chemical Physics 2021, 154 (23), 230903. DOI: 10.1063/5.0047760",
    rec: R("article-journal", { author: [p("Westermayr", "J."), p("Gastegger", "M."), p("Schütt", "K. T."), p("Maurer", "R. J.")],
      title: "Perspective on integrating machine learning into computational chemistry and materials science", "container-title": "Journal of Chemical Physics",
      issued: Y(2021), volume: "154", issue: "23", "article-number": "230903", DOI: "10.1063/5.0047760" }) },
  { src: "ACS", norm: "acsMinus", raw: "Hanikel, N.; Pei, X. K.; Chheda, S.; Lyu, H.; Jeong, W.; Sauer, J.; Gagliardi, L.; Yaghi, O. M. Evolution of water structures in metal-organic frameworks for improved atmospheric water harvesting. Science 2021, 374 (6566), 454−459. DOI: 10.1126/science.abj0890",
    rec: R("article-journal", { author: [p("Hanikel", "N."), p("Pei", "X. K."), p("Chheda", "S."), p("Lyu", "H."), p("Jeong", "W."), p("Sauer", "J."), p("Gagliardi", "L."), p("Yaghi", "O. M.")],
      title: "Evolution of water structures in metal-organic frameworks for improved atmospheric water harvesting", "container-title": "Science",
      issued: Y(2021), volume: "374", issue: "6566", page: "454-459", DOI: "10.1126/science.abj0890" }) },
  // The page spells "Sociétés" with DECOMPOSED accents (e + U+0301); records are NFC (§E), so NFC is applied.
  { src: "ACS", norm: "acsMinusNfc", raw: "Timmermans, J. Recherches de stoechiométrie I. La chaleur de fusion des composés organiques. Bulletin des Sociétés Chimiques Belges 1935, 44 (1), 17−40. DOI: 10.1002/j.0037-9646.1935.tb00352.x",
    rec: R("article-journal", { author: [p("Timmermans", "J.")], title: "Recherches de stoechiométrie I. La chaleur de fusion des composés organiques", "container-title": "Bulletin des Sociétés Chimiques Belges",
      issued: Y(1935), volume: "44", issue: "1", page: "17-40", DOI: "10.1002/j.0037-9646.1935.tb00352.x" }) },
  { src: "ACS", raw: "Tanemura, K. A.; Sierra-Costa, D.; Merz, K. M., Jr. Python for Chemists; American Chemical Society, 2022. DOI: 10.1021/acsinfocus.7e5030",
    rec: R("book", { author: [p("Tanemura", "K. A."), p("Sierra-Costa", "D."), p("Merz", "K. M.", { suffix: "Jr." })], title: "Python for Chemists", publisher: "American Chemical Society", issued: Y(2022), DOI: "10.1021/acsinfocus.7e5030" }) },
  { src: "ACS", raw: "Francl, M. Steeped: The Chemistry of Tea; Royal Society of Chemistry, 2024.",
    rec: R("book", { author: [p("Francl", "M.")], title: "Steeped: The Chemistry of Tea", publisher: "Royal Society of Chemistry", issued: Y(2024) }) },
  { src: "ACS", raw: "Atkins, P. Concepts in Physical Chemistry, 2nd ed.; Royal Society of Chemistry, 2024. DOI: 10.1039/9781837674244",
    rec: R("book", { author: [p("Atkins", "P.")], title: "Concepts in Physical Chemistry", edition: "2", publisher: "Royal Society of Chemistry", issued: Y(2024), DOI: "10.1039/9781837674244" }) },
  { src: "ACS", norm: "acsMinus", raw: "Bard, A. J.; Faulkner, L. R. Double-Layer Structure and Absorption. Electrochemical Methods: Fundamentals and Applications, 3rd ed.; Wiley, 2022; pp 599−652.",
    rec: R("chapter", { author: [p("Bard", "A. J."), p("Faulkner", "L. R.")], title: "Double-Layer Structure and Absorption", "container-title": "Electrochemical Methods: Fundamentals and Applications", edition: "3rd", publisher: "Wiley", issued: Y(2022), page: "599-652" }) },
  { src: "ACS", norm: "acsMinus", raw: "Kratz, N. Structural Ceramics. Applied Inorganic Chemistry, Vol. 3: From Magnetic to Bioactive Materials; Pöttgen, R., Jüstel, T., Strassert, C. A., Eds.; DeGruyter, 2023; pp 231−243.",
    rec: R("chapter", { author: [p("Kratz", "N.")], title: "Structural Ceramics", "container-title": "Applied Inorganic Chemistry, Vol. 3: From Magnetic to Bioactive Materials",
      editor: [p("Pöttgen", "R."), p("Jüstel", "T."), p("Strassert", "C. A.")], publisher: "DeGruyter", issued: Y(2023), page: "231-243" }) },
  { src: "ACS", norm: "acsMinus", raw: "Birkel, C. S.; Hamm, C. M. Max phases and mxenes. Comprehensive Inorganic Chemistry III, 3rd ed.; Reedijk, J., Poeppelmeier, K. R., Eds.; Elsevier, 2023; Vol. 5, pp 278−289. DOI: 10.1016/B978-0-12-823144-9.00076-5",
    rec: R("chapter", { author: [p("Birkel", "C. S."), p("Hamm", "C. M.")], title: "Max phases and mxenes", "container-title": "Comprehensive Inorganic Chemistry III", edition: "3",
      editor: [p("Reedijk", "J."), p("Poeppelmeier", "K. R.")], publisher: "Elsevier", issued: Y(2023), volume: "5", page: "278-289", DOI: "10.1016/B978-0-12-823144-9.00076-5" }) },
  { src: "ACS", raw: "Cable, M. L. Life in Extreme Environments: Lanthanide-Based Detection of Bacterial Spores and Other Sensor Design Pursuits. Ph.D. Dissertation, California Institute of Technology, 2010. http://resolver.caltech.edu/CaltechTHESIS:05102010-145436548",
    rec: R("thesis", { author: [p("Cable", "M. L.")], title: "Life in Extreme Environments: Lanthanide-Based Detection of Bacterial Spores and Other Sensor Design Pursuits", genre: "Ph.D. Dissertation",
      publisher: "California Institute of Technology", issued: Y(2010), URL: "http://resolver.caltech.edu/CaltechTHESIS:05102010-145436548" }) },
  { src: "ACS", raw: "Tsien, R. Y. The Design and Use of Organic Chemical Tools in Cellular Physiology. Ph.D. Thesis, University of Cambridge, 1976.",
    rec: R("thesis", { author: [p("Tsien", "R. Y.")], title: "The Design and Use of Organic Chemical Tools in Cellular Physiology", genre: "Ph.D. Thesis", publisher: "University of Cambridge", issued: Y(1976) }) },
  { src: "ACS", raw: "McGuire, B. A. High Resolution THz Spectroscopy of Astrophysically Relevant Ions. M.S. Thesis, Emory University, 2011. https://etd.library.emory.edu/concern/etds/9019s306w?locale=en",
    rec: R("thesis", { author: [p("McGuire", "B. A.")], title: "High Resolution THz Spectroscopy of Astrophysically Relevant Ions", genre: "M.S. Thesis", publisher: "Emory University", issued: Y(2011),
      URL: "https://etd.library.emory.edu/concern/etds/9019s306w?locale=en" }) },
];

describe("ACS (ACS Style Quick Guide, 2026)", () => {
  check("acs", ACS);
  coverage("acs", ACS);
  test("no et al. threshold: the guide lists all 13 authors of Deysher et al.; 13 and 14 both list everyone", () => {
    for (const k of [13, 14]) {
      const s = STYLES.acs!.reference(R("article-journal", { author: many(k), title: "T", "container-title": "J", issued: Y(2020), volume: "1", page: "1-2" })).plain;
      expect(s.split("; ").length).toBe(k);
      expect(s).not.toMatch(/et al/);
    }
    expect(STYLE_RULES.acs.refEtAl).toBeNull();
  });
  test("ACS prints the FULL journal title (2026 guide), even when an abbreviation exists", () => {
    expect(STYLES.acs!.reference(ACS[0].rec).plain).toContain("Nature Chemistry 2022");
  });
  test("superscript marker, ranges of three or more compressed", () => {
    const r = ACS[0].rec;
    const m = (n: number) => ({ rec: r, n, item: { id: r.id } });
    expect(STYLES.acs!.marker([m(1), m(2), m(3), m(5)]).html).toBe("<sup>1–3,5</sup>");
    expect(STYLES.acs!.marker([m(1), m(2)]).html).toBe("<sup>1,2</sup>");
  });
});

// ================================================================ Nature

const NATURE: Oracle[] = [
  { src: "NAT1", norm: "hyphenRange", raw: "Schott, D. H., Collins, R. N. & Bretscher, A. Secretory vesicle transport velocity in living cells depends on the myosin V lever arm length. J. Cell Biol. 156, 35-39 (2002).",
    rec: R("article-journal", { author: [p("Schott", "D. H."), p("Collins", "R. N."), p("Bretscher", "A.")], title: "Secretory vesicle transport velocity in living cells depends on the myosin V lever arm length",
      "container-title": "Journal of Cell Biology", "container-title-short": "J. Cell Biol.", volume: "156", page: "35-39", issued: Y(2002) }) },
  { src: "NAT1", raw: "Bellin, D. L. et al. Electrochemical camera chip for simultaneous imaging of multiple metabolites in biofilms. Nat. Commun. 7, 10535; 10.1038/ncomms10535 (2016).",
    rec: R("article-journal", { author: [p("Bellin", "D. L."), ...many(5)], title: "Electrochemical camera chip for simultaneous imaging of multiple metabolites in biofilms",
      "container-title-short": "Nat. Commun.", volume: "7", "article-number": "10535", DOI: "10.1038/ncomms10535", issued: Y(2016) }) },
  { src: "NAT2", raw: "Eigler, D. M. & Schweizer, E. K. Positioning single atoms with a scanning tunnelling microscope. Nature 344, 524–526 (1990).",
    rec: R("article-journal", { author: [p("Eigler", "D. M."), p("Schweizer", "E. K.")], title: "Positioning single atoms with a scanning tunnelling microscope",
      "container-title": "Nature", volume: "344", page: "524-526", issued: Y(1990) }) },
];

describe("Nature (nature.com author guidelines)", () => {
  check("nature", NATURE);
  coverage("nature", NATURE);
  test("et al.: “All authors … unless there are more than five” (NAT3); “six or more” (NAT1)", () => {
    const base = { title: "T", "container-title": "Nature", volume: "1", page: "1-2", issued: Y(2020) };
    expect(STYLES.nature!.reference(R("article-journal", { ...base, author: many(5) })).plain)
      .toMatch(/^AuthorA, Q\. R\., AuthorB, Q\. R\., AuthorC, Q\. R\., AuthorD, Q\. R\. & AuthorE, Q\. R\. T\./);
    expect(STYLES.nature!.reference(R("article-journal", { ...base, author: many(6) })).plain).toMatch(/^AuthorA, Q\. R\. et al\. T\./);
  });
  test("superscript marker (“reference numbers are superscript”)", () => {
    const r = NATURE[0].rec;
    expect(STYLES.nature!.marker([{ rec: r, n: 4, item: { id: r.id } }]).html).toBe("<sup>4</sup>");
  });
});

// ================================================================ Vancouver / NLM

const NLM: Oracle[] = [
  { src: "NLM", raw: "Halpern SD, Ubel PA, Caplan AL. Solid-organ transplantation in HIV-infected patients. N Engl J Med. 2002 Jul 25;347(4):284-7.",
    rec: R("article-journal", { author: [p("Halpern", "S.D."), p("Ubel", "PA"), p("Caplan", "A. L.")], title: "Solid-Organ Transplantation in HIV-Infected Patients",
      "container-title": "New England Journal of Medicine", "container-title-short": "N. Engl. J. Med.", issued: Y(2002, 7, 25), volume: "347", issue: "4", page: "284-287" }) },
  { src: "NLM", raw: "Halpern SD, Ubel PA, Caplan AL. Solid-organ transplantation in HIV-infected patients. N Engl J Med. 2002;347:284-7.",
    rec: R("article-journal", { author: [p("Halpern", "S. D."), p("Ubel", "P. A."), p("Caplan", "A. L.")], title: "Solid-organ transplantation in HIV-infected patients",
      "container-title-short": "N Engl J Med", issued: Y(2002), volume: "347", page: "284–287" }) },
  { src: "NLM", raw: "Rose ME, Huerbin MB, Melick J, Marion DW, Palmer AM, Schiding JK, et al. Regulation of interstitial excitatory amino acid concentrations after cortical contusion injury. Brain Res. 2002;935(1-2):40-6.",
    rec: R("article-journal", { author: [p("Rose", "M. E."), p("Huerbin", "M. B."), p("Melick", "J."), p("Marion", "D. W."), p("Palmer", "A. M."), p("Schiding", "J. K."), p("Kochanek", "P. M."), p("Graham", "S. H.")],
      title: "Regulation of interstitial excitatory amino acid concentrations after cortical contusion injury", "container-title-short": "Brain Res", issued: Y(2002), volume: "935", issue: "1-2", page: "40-46" }) },
  { src: "NLM", raw: "Ahrar K, Madoff DC, Gupta S, Wallace MJ, Price RE, Wright KC. Development of a large animal model for lung tumors. J Vasc Interv Radiol. 2002;13(9 Pt 1):923-8.",
    rec: R("article-journal", { author: [p("Ahrar", "K."), p("Madoff", "D. C."), p("Gupta", "S."), p("Wallace", "M. J."), p("Price", "R. E."), p("Wright", "K. C.")],
      title: "Development of a large animal model for lung tumors", "container-title-short": "J Vasc Interv Radiol", issued: Y(2002), volume: "13", issue: "9 Pt 1", page: "923-928" }) },
  { src: "NLM", raw: "Diabetes Prevention Program Research Group. Hypertension, insulin, and proinsulin in participants with impaired glucose tolerance. Hypertension. 2002;40(5):679-86.",
    rec: R("article-journal", { author: [lit("Diabetes Prevention Program Research Group")], title: "Hypertension, insulin, and proinsulin in participants with impaired glucose tolerance",
      "container-title": "Hypertension", issued: Y(2002), volume: "40", issue: "5", page: "679-686" }) },
  { src: "NLM", raw: "Banit DM, Kaufer H, Hartford JM. Intraoperative frozen section analysis in revision total joint arthroplasty. Clin Orthop. 2002;(401):230-8.",
    rec: R("article-journal", { author: [p("Banit", "D. M."), p("Kaufer", "H."), p("Hartford", "J. M.")], title: "Intraoperative frozen section analysis in revision total joint arthroplasty",
      "container-title-short": "Clin Orthop", issued: Y(2002), issue: "401", page: "230-238" }) },
  { src: "NLM", raw: "Murray PR, Rosenthal KS, Kobayashi GS, Pfaller MA. Medical microbiology. 4th ed. St. Louis: Mosby; 2002.",
    rec: R("book", { author: [p("Murray", "P. R."), p("Rosenthal", "K. S."), p("Kobayashi", "G. S."), p("Pfaller", "M. A.")], title: "Medical Microbiology", edition: "4", "publisher-place": "St. Louis", publisher: "Mosby", issued: Y(2002) }) },
  { src: "NLM", raw: "Gilstrap LC 3rd, Cunningham FG, VanDorsten JP, editors. Operative obstetrics. 2nd ed. New York: McGraw-Hill; 2002.",
    rec: R("book", { editor: [p("Gilstrap", "L. C.", { suffix: "III" }), p("Cunningham", "F. G."), p("VanDorsten", "J. P.")], title: "Operative obstetrics", edition: "2nd ed.", "publisher-place": "New York", publisher: "McGraw-Hill", issued: Y(2002) }) },
  { src: "NLM", raw: "Breedlove GK, Schorfheide AM. Adolescent pregnancy. 2nd ed. Wieczorek RR, editor. White Plains (NY): March of Dimes Education Services; 2001.",
    rec: R("book", { author: [p("Breedlove", "G. K."), p("Schorfheide", "A. M.")], editor: [p("Wieczorek", "R. R.")], title: "Adolescent pregnancy", edition: "2", "publisher-place": "White Plains (NY)", publisher: "March of Dimes Education Services", issued: Y(2001) }) },
  { src: "NLM", raw: "Meltzer PS, Kallioniemi A, Trent JM. Chromosome alterations in human solid tumors. In: Vogelstein B, Kinzler KW, editors. The genetic basis of human cancer. New York: McGraw-Hill; 2002. p. 93-113.",
    rec: R("chapter", { author: [p("Meltzer", "P. S."), p("Kallioniemi", "A."), p("Trent", "J. M.")], title: "Chromosome alterations in human solid tumors", editor: [p("Vogelstein", "B."), p("Kinzler", "K. W.")],
      "container-title": "The genetic basis of human cancer", "publisher-place": "New York", publisher: "McGraw-Hill", issued: Y(2002), page: "93-113" }) },
  { src: "CM2", raw: "Whiteside TL, Heberman RB. Effectors of immunity and rationale for immunotherapy. In: Kufe DW, Pollock RE, Weichselbaum RR, Bast RC Jr, Gansler TS, Holland JF, Frei E 3rd, editors. Cancer medicine 6. Hamilton (ON): BC Decker Inc; 2003. p. 221-8.",
    rec: R("chapter", { author: [p("Whiteside", "T. L."), p("Heberman", "R. B.")], title: "Effectors of immunity and rationale for immunotherapy",
      editor: [p("Kufe", "D. W."), p("Pollock", "R. E."), p("Weichselbaum", "R. R."), p("Bast", "R. C.", { suffix: "Jr." }), p("Gansler", "T. S."), p("Holland", "J. F."), p("Frei", "E.", { suffix: "III" })],
      "container-title": "Cancer medicine 6", "publisher-place": "Hamilton (ON)", publisher: "BC Decker Inc", issued: Y(2003), page: "221-228" }) },
  { src: "CM2", raw: "Rojko JL, Hardy WD Jr. Feline leukemia virus and other retroviruses. In: Sherding RG, editor. The cat: diseases and clinical management. New York: Churchill Livingstone; 1989. p. 229-332.",
    rec: R("chapter", { author: [p("Rojko", "J. L."), p("Hardy", "W. D.", { suffix: "Jr." })], title: "Feline leukemia virus and other retroviruses", editor: [p("Sherding", "R. G.")],
      "container-title": "The cat: diseases and clinical management", "publisher-place": "New York", publisher: "Churchill Livingstone", issued: Y(1989), page: "229-332" }) },
  // Patents. Contract convention: the assignee is carried in `publisher`.
  { src: "NLM", raw: "Pagedas AC, inventor; Ancel Surgical R&D Inc., assignee. Flexible endoscopic grasping and cutting device and positioning tool assembly. United States patent US 20020103498. 2002 Aug 1.",
    rec: R("patent", { author: [p("Pagedas", "A. C.")], publisher: "Ancel Surgical R&D Inc.", title: "Flexible endoscopic grasping and cutting device and positioning tool assembly",
      authority: "US", number: "US 20020103498", issued: Y(2002, 8, 1) }) },
  { src: "CM7", raw: "Cho ST, inventor; Hospira, Inc., assignee. Microneedles for minimally invasive drug delivery. United States patent US 6,980,855. 2005 Dec 27.",
    rec: R("patent", { author: [p("Cho", "S. T.")], publisher: "Hospira, Inc.", title: "Microneedles for minimally invasive drug delivery", authority: "United States", number: "US 6,980,855", issued: Y(2005, 12, 27) }) },
  { src: "CM7", raw: "Myers K, Nguyen C, inventors; 3F Therapeutics, Inc., assignee. Prosthetic heart valve. United States patent US 6,911,043. 2005 Jun 28.",
    rec: R("patent", { author: [p("Myers", "K."), p("Nguyen", "C.")], publisher: "3F Therapeutics, Inc.", title: "Prosthetic heart valve", authority: "US", number: "US 6,911,043", issued: Y(2005, 6, 28) }) },
  { src: "CM7", raw: "Smith MK, Duggan JM, Stalzer CM, Smith SC, Mowry GJ, inventors; Smith MK, assignee. Universal flexible arm. United States patent US 5,823,486. 1998 Oct 20.",
    rec: R("patent", { author: [p("Smith", "M. K."), p("Duggan", "J. M."), p("Stalzer", "C. M."), p("Smith", "S. C."), p("Mowry", "G. J.")], publisher: "Smith MK", title: "Universal flexible arm",
      authority: "U.S.", number: "US 5,823,486", issued: Y(1998, 10, 20) }) },
  { src: "CM7", raw: "Bilenski E, Cobb NC, inventors; Bilenski E, Cobb NC, assignee. Single use, self-contained twist resistant surgical knife. United States patent US 6,979,340. 2005 Dec 27.",
    rec: R("patent", { author: [p("Bilenski", "E."), p("Cobb", "N. C.")], publisher: "Bilenski E, Cobb NC", title: "Single use, self-contained twist resistant surgical knife",
      authority: "US", number: "US 6,979,340", issued: Y(2005, 12, 27) }) },
];

describe("Vancouver / NLM (ICMJE samples, Citing Medicine)", () => {
  check("vancouver", NLM);
  coverage("vancouver", NLM);
  test("et al.: “If there are more than six authors, list the first six authors, followed by et al.”", () => {
    const base = { title: "T", "container-title-short": "J", issued: Y(2020), volume: "1", page: "1-2" };
    expect(STYLES.vancouver!.reference(R("article-journal", { ...base, author: many(6) })).plain)
      .toMatch(/^AuthorA QR, AuthorB QR, AuthorC QR, AuthorD QR, AuthorE QR, AuthorF QR\. T\./);
    expect(STYLES.vancouver!.reference(R("article-journal", { ...base, author: many(7) })).plain)
      .toMatch(/^AuthorA QR, AuthorB QR, AuthorC QR, AuthorD QR, AuthorE QR, AuthorF QR, et al\. T\./);
  });
  test("the threshold is an option (“NLM now lists all authors”)", () => {
    const all = makeVancouver({ maxAuthors: 1000 });
    const s = all.reference(R("article-journal", { author: many(8), title: "T", "container-title-short": "J", issued: Y(2020), volume: "1", page: "1-2" })).plain;
    expect(s).toMatch(/AuthorH QR\. T\./);
    expect(s).not.toMatch(/et al/);
  });
  test("a title-cased input is sentence-cased with the subtitle lowercased (Forooghian, NLM)", () => {
    const r = R("article-journal", { author: [p("Forooghian", "F.")], title: "Uveitic Foveal Atrophy: Clinical Features and Associations", "container-title-short": "Arch Ophthalmol", issued: Y(2009, 2), volume: "127", issue: "2", page: "179-186" });
    expect(STYLES.vancouver!.reference(r).plain).toBe("Forooghian F. Uveitic foveal atrophy: clinical features and associations. Arch Ophthalmol. 2009 Feb;127(2):179-86.");
  });
  test("an abbreviation the source gave with periods is printed without them", () => {
    expect(STYLES.vancouver!.reference(NLM[0].rec).plain).toContain(" N Engl J Med. ");
  });
});

// ================================================================ APA 7

const APA: Oracle[] = [
  { src: "APAJ", raw: "Grady, J. S., Her, M., Moreno, G., Perez, C., & Yelinek, J. (2019). Emotions in storybooks: A comparison of storybooks that represent ethnic and racial groups in the United States. Psychology of Popular Media Culture, 8(3), 207–217. https://doi.org/10.1037/ppm0000185",
    rec: R("article-journal", { author: [p("Grady", "J. S."), p("Her", "M."), p("Moreno", "G."), p("Perez", "C."), p("Yelinek", "J.")],
      title: "Emotions in storybooks: A comparison of storybooks that represent ethnic and racial groups in the United States", "container-title": "Psychology of Popular Media Culture",
      issued: Y(2019), volume: "8", issue: "3", page: "207-217", DOI: "10.1037/ppm0000185" }) },
  { src: "APAJ", raw: "Pope, J. P., & Wall, H. (2025). Is the goal intrinsic or extrinsic? Examining self-determination theory researchers’ and the general publics’ perceptions of exercise goals. Canadian Journal of Behavioural Science/Revue canadienne des sciences du comportement, 57(3), 239–248. https://doi.org/10.1037/cbs0000411",
    rec: R("article-journal", { author: [p("Pope", "J. P."), p("Wall", "H.")], title: "Is the goal intrinsic or extrinsic? Examining self-determination theory researchers’ and the general publics’ perceptions of exercise goals",
      "container-title": "Canadian Journal of Behavioural Science/Revue canadienne des sciences du comportement", issued: Y(2025), volume: "57", issue: "3", page: "239-248", DOI: "https://doi.org/10.1037/cbs0000411" }) },
  { src: "APAJ", raw: "Rybaczewska, M., & Sparks, L. (2022). Ageing consumers and e-commerce activities. Ageing and Society, 42(8), 1879–1898. https://doi.org/10.1017/S0144686X20001932",
    rec: R("article-journal", { author: [p("Rybaczewska", "M."), p("Sparks", "L.")], title: "Ageing Consumers and E-Commerce Activities", "container-title": "Ageing and Society",
      issued: Y(2022), volume: "42", issue: "8", page: "1879-1898", DOI: "10.1017/S0144686X20001932" }) },
  { src: "APAJ", raw: "Jerrentrup, A., Mueller, T., Glowalla, U., Herder, M., Henrichs, N., Neubauer, A., & Schaefer, J. R. (2018). Teaching medicine with the help of “Dr. House.” PLoS ONE, 13(3), Article e0193972. https://doi.org/10.1371/journal.pone.0193972",
    rec: R("article-journal", { author: [p("Jerrentrup", "A."), p("Mueller", "T."), p("Glowalla", "U."), p("Herder", "M."), p("Henrichs", "N."), p("Neubauer", "A."), p("Schaefer", "J. R.")],
      title: "Teaching medicine with the help of “Dr. House”", "container-title": "PLoS ONE", issued: Y(2018), volume: "13", issue: "3", "article-number": "e0193972", DOI: "10.1371/journal.pone.0193972" }) },
  { src: "APAJ", raw: "Schlesselmann, A. J., McNally, R. J., & Held, P. (2025). Using network analysis to characterize clinical improvement during cognitive processing therapy. Behaviour Research and Therapy, 185, Article 104678. https://doi.org/10.1016/j.brat.2024.104678",
    rec: R("article-journal", { author: [p("Schlesselmann", "A. J."), p("McNally", "R. J."), p("Held", "P.")], title: "Using network analysis to characterize clinical improvement during cognitive processing therapy",
      "container-title": "Behaviour Research and Therapy", issued: Y(2025), volume: "185", "article-number": "104678", DOI: "10.1016/j.brat.2024.104678" }) },
  { src: "APAB", raw: "Jackson, L. M. (2019). The psychology of prejudice: From attitudes to social action (2nd ed.). American Psychological Association. https://doi.org/10.1037/0000168-000",
    rec: R("book", { author: [p("Jackson", "L. M.")], title: "The Psychology of Prejudice: From Attitudes to Social Action", edition: "2", publisher: "American Psychological Association", issued: Y(2019), DOI: "10.1037/0000168-000" }) },
  { src: "APAB", raw: "Sapolsky, R. M. (2017). Behave: The biology of humans at our best and worst. Penguin Books.",
    rec: R("book", { author: [p("Sapolsky", "R. M.")], title: "Behave: The Biology of Humans at Our Best and Worst", publisher: "Penguin Books", issued: Y(2017) }) },
  { src: "APAB", raw: "Svendsen, S., & Løber, L. (2020). The big picture/Academic writing: The one-hour guide (3rd digital ed.). Hans Reitzel Forlag. https://thebigpicture-academicwriting.digi.hansreitzel.dk/",
    rec: R("book", { author: [p("Svendsen", "S."), p("Løber", "L.")], title: "The big picture/Academic writing: The one-hour guide", edition: "3rd digital", publisher: "Hans Reitzel Forlag", issued: Y(2020),
      URL: "https://thebigpicture-academicwriting.digi.hansreitzel.dk/" }) },
  { src: "APAB", raw: "Hygum, E., & Pedersen, P. M. (Eds.). (2010). Early childhood education: Values and practices in Denmark. Hans Reitzels Forlag. https://earlychildhoodeducation.digi.hansreitzel.dk/",
    rec: R("book", { editor: [p("Hygum", "E."), p("Pedersen", "P. M.")], title: "Early childhood education: Values and practices in Denmark", publisher: "Hans Reitzels Forlag", issued: Y(2010),
      URL: "https://earlychildhoodeducation.digi.hansreitzel.dk/" }) },
  { src: "APAB", raw: "Kesharwani, P. (Ed.). (2020). Nanotechnology based approaches for tuberculosis treatment. Academic Press.",
    rec: R("book", { editor: [p("Kesharwani", "P.")], title: "Nanotechnology Based Approaches for Tuberculosis Treatment", publisher: "Academic Press", issued: Y(2020) }) },
  { src: "APAB", raw: "Torino, G. C., Rivera, D. P., Capodilupo, C. M., Nadal, K. L., & Sue, D. W. (Eds.). (2019). Microaggression theory: Influence and implications. John Wiley & Sons. https://doi.org/10.1002/9781119466642",
    rec: R("book", { editor: [p("Torino", "G. C."), p("Rivera", "D. P."), p("Capodilupo", "C. M."), p("Nadal", "K. L."), p("Sue", "D. W.")], title: "Microaggression theory: Influence and implications",
      publisher: "John Wiley & Sons", issued: Y(2019), DOI: "10.1002/9781119466642" }) },
  { src: "APAC", raw: "Aron, L., Botella, M., & Lubart, T. (2019). Culinary arts: Talent and their development. In R. F. Subotnik, P. Olszewski-Kubilius, & F. C. Worrell (Eds.), The psychology of high performance: Developing human potential into domain-specific talent (pp. 345–359). American Psychological Association. https://doi.org/10.1037/0000120-016",
    rec: R("chapter", { author: [p("Aron", "L."), p("Botella", "M."), p("Lubart", "T.")], title: "Culinary Arts: Talent and Their Development",
      editor: [p("Subotnik", "R. F."), p("Olszewski-Kubilius", "P."), p("Worrell", "F. C.")], "container-title": "The Psychology of High Performance: Developing Human Potential Into Domain-Specific Talent",
      page: "345-359", publisher: "American Psychological Association", issued: Y(2019), DOI: "10.1037/0000120-016" }) },
  { src: "APAC", raw: "Dillard, J. P. (2020). Currents in the study of persuasion. In M. B. Oliver, A. A. Raney, & J. Bryant (Eds.), Media effects: Advances in theory and research (4th ed., pp. 115–129). Routledge.",
    rec: R("chapter", { author: [p("Dillard", "J. P.")], title: "Currents in the study of persuasion", editor: [p("Oliver", "M. B."), p("Raney", "A. A."), p("Bryant", "J.")],
      "container-title": "Media effects: Advances in theory and research", edition: "4", page: "115-129", publisher: "Routledge", issued: Y(2020) }) },
  { src: "APAC", raw: "Thestrup, K. (2010). To transform, to communicate, to play—The experimenting community in action. In E. Hygum & P. M. Pedersen (Eds.), Early childhood education: Values and practices in Denmark. Hans Reitzels Forlag. https://earlychildhoodeducation.digi.hansreitzel.dk/?id=192",
    rec: R("chapter", { author: [p("Thestrup", "K.")], title: "To Transform, to Communicate, to Play—The Experimenting Community in Action", editor: [p("Hygum", "E."), p("Pedersen", "P. M.")],
      "container-title": "Early childhood education: Values and practices in Denmark", publisher: "Hans Reitzels Forlag", issued: Y(2010), URL: "https://earlychildhoodeducation.digi.hansreitzel.dk/?id=192" }) },
];

describe("APA 7 (apastyle.apa.org)", () => {
  check("apa7", APA);
  coverage("apa7", APA);
  test("et al. in the reference list: 20 listed; 21 → first 19, “. . .”, last (APAE)", () => {
    const base = { title: "T", "container-title": "J", issued: Y(2020), volume: "1", page: "1-2" };
    const s20 = STYLES.apa7!.reference(R("article-journal", { ...base, author: many(20) })).plain;
    expect(s20).toMatch(/AuthorS, Q\. R\., & AuthorT, Q\. R\. \(2020\)/);
    const s21 = STYLES.apa7!.reference(R("article-journal", { ...base, author: many(21) })).plain;
    expect(s21).toMatch(/AuthorS, Q\. R\., \. \. \. AuthorU, Q\. R\. \(2020\)/);
    expect(s21).not.toMatch(/&/);
    expect(s21).not.toMatch(/AuthorT/);
  });
  test("in-text (APAJ): parenthetical and narrative forms", () => {
    const [g, pw, rs] = APA;
    const items = [g, pw, rs].map((o) => ({ rec: o.rec, item: { id: o.rec.id } }));
    expect(STYLES.apa7!.marker(items).plain).toBe("(Grady et al., 2019; Pope & Wall, 2025; Rybaczewska & Sparks, 2022)");
    expect(STYLES.apa7!.marker(items, { narrative: true }).plain).toBe("Grady et al. (2019), Pope and Wall (2025), and Rybaczewska and Sparks (2022)");
  });
  test("in-text (APAB): editors stand in for authors; 3+ → et al.", () => {
    const eds = APA.filter((o) => o.src === "APAB" && o.rec.editor);
    const items = eds.map((o) => ({ rec: o.rec, item: { id: o.rec.id } }));
    expect(STYLES.apa7!.marker(items).plain).toBe("(Hygum & Pedersen, 2010; Kesharwani, 2020; Torino et al., 2019)");
    expect(STYLES.apa7!.marker(items, { narrative: true }).plain).toBe("Hygum and Pedersen (2010), Kesharwani (2020), and Torino et al. (2019)");
  });
  test("in-text et al. boundary: 2 authors named, 3 → et al.", () => {
    const two = R("book", { author: many(2), title: "T", issued: Y(2001) });
    const three = R("book", { author: many(3), title: "T", issued: Y(2001) });
    expect(STYLES.apa7!.marker([{ rec: two, item: { id: two.id } }]).plain).toBe("(AuthorA & AuthorB, 2001)");
    expect(STYLES.apa7!.marker([{ rec: three, item: { id: three.id } }]).plain).toBe("(AuthorA et al., 2001)");
    expect(STYLES.apa7!.marker([{ rec: three, item: { id: three.id, locator: "45", label: "page" } }]).plain).toBe("(AuthorA et al., 2001, p. 45)");
  });
});

// ================================================================ Chicago

const CAD: Oracle[] = [
  { src: "CAD", raw: "Dittmar, Emily L., and Douglas W. Schemske. 2023. “Temporal Variation in Selection Influences Microgeographic Local Adaptation.” American Naturalist 202 (4): 471–85. https://doi.org/10.1086/725865.",
    rec: R("article-journal", { author: [p("Dittmar", "Emily L."), p("Schemske", "Douglas W.")], title: "Temporal variation in selection influences microgeographic local adaptation",
      "container-title": "American Naturalist", issued: Y(2023), volume: "202", issue: "4", page: "471-485", DOI: "10.1086/725865" }) },
  { src: "CAD", raw: "Kwon, Hyeyoung. 2022. “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.” American Journal of Sociology 127 (6): 1818–59. https://doi.org/10.1086/720277.",
    rec: R("article-journal", { author: [p("Kwon", "Hyeyoung")], title: "Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life",
      "container-title": "American Journal of Sociology", issued: Y(2022), volume: "127", issue: "6", page: "1818-1859", DOI: "10.1086/720277" }) },
  { src: "CAD", raw: "Lindquist, Benjamin. 2023. “The Art of Text-to-Speech.” Critical Inquiry 50 (2): 225–51. https://doi.org/10.1086/727651.",
    rec: R("article-journal", { author: [p("Lindquist", "Benjamin")], title: "The art of text-to-speech", "container-title": "Critical Inquiry", issued: Y(2023), volume: "50", issue: "2", page: "225-251", DOI: "10.1086/727651" }) },
  { src: "CAD", raw: "Snyder, Carl D., Manuel Bedrossian, Casey Barr, et al. 2025. “Extant Life Detection Using Label-Free Video Microscopy in Analog Aquatic Environments.” PLOS ONE 20 (3): e0318239. https://doi.org/10.1371/journal.pone.0318239.",
    rec: R("article-journal", { author: [p("Snyder", "Carl D."), p("Bedrossian", "Manuel"), p("Barr", "Casey"), ...many(4)], title: "Extant Life Detection Using Label-Free Video Microscopy in Analog Aquatic Environments",
      "container-title": "PLOS ONE", issued: Y(2025), volume: "20", issue: "3", "article-number": "e0318239", DOI: "10.1371/journal.pone.0318239" }) },
  { src: "CAD", raw: "Binder, Amy J., and Jeffrey L. Kidder. 2022. The Channels of Student Activism: How the Left and Right Are Winning (and Losing) in Campus Politics Today. University of Chicago Press.",
    rec: R("book", { author: [p("Binder", "Amy J."), p("Kidder", "Jeffrey L.")], title: "The Channels of Student Activism: How the Left and Right Are Winning (and Losing) in Campus Politics Today",
      publisher: "University of Chicago Press", issued: Y(2022) }) },
  { src: "CAD", raw: "Yu, Charles. 2020. Interior Chinatown. Pantheon Books.",
    rec: R("book", { author: [p("Yu", "Charles")], title: "Interior Chinatown", publisher: "Pantheon Books", issued: Y(2020) }) },
  { src: "CAD", raw: "Kurland, Philip B., and Ralph Lerner, eds. 1987. The Founders’ Constitution. University of Chicago Press. https://press-pubs.uchicago.edu/founders/.",
    rec: R("book", { editor: [p("Kurland", "Philip B."), p("Lerner", "Ralph")], title: "The Founders’ Constitution", publisher: "University of Chicago Press", issued: Y(1987), URL: "https://press-pubs.uchicago.edu/founders/" }) },
];

// The same records in the notes-bibliography system.
const CNB: Oracle[] = [
  { src: "CNB", raw: "Dittmar, Emily L., and Douglas W. Schemske. “Temporal Variation in Selection Influences Microgeographic Local Adaptation.” American Naturalist 202, no. 4 (2023): 471–85. https://doi.org/10.1086/725865.", rec: CAD[0].rec },
  { src: "CNB", raw: "Kwon, Hyeyoung. “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.” American Journal of Sociology 127, no. 6 (2022): 1818–59. https://doi.org/10.1086/720277.", rec: CAD[1].rec },
  { src: "CNB", raw: "Lindquist, Benjamin. “The Art of Text-to-Speech.” Critical Inquiry 50, no. 2 (2023): 225–51. https://doi.org/10.1086/727651.", rec: CAD[2].rec },
  { src: "CNB", raw: "Snyder, Carl D., Manuel Bedrossian, Casey Barr, et al. “Extant Life Detection Using Label-Free Video Microscopy in Analog Aquatic Environments.” PLOS ONE 20, no. 3 (2025): e0318239. https://doi.org/10.1371/journal.pone.0318239.", rec: CAD[3].rec },
  { src: "CNB", raw: "Binder, Amy J., and Jeffrey L. Kidder. The Channels of Student Activism: How the Left and Right Are Winning (and Losing) in Campus Politics Today. University of Chicago Press, 2022.", rec: CAD[4].rec },
  { src: "CNB", raw: "Yu, Charles. Interior Chinatown. Pantheon Books, 2020.", rec: CAD[5].rec },
  { src: "CNB", raw: "Kurland, Philip B., and Ralph Lerner, eds. The Founders’ Constitution. University of Chicago Press, 1987. https://press-pubs.uchicago.edu/founders/.", rec: CAD[6].rec },
];

const ci = (o: Oracle, locator?: string, label?: CiteItem["label"]): CiteItem => ({ id: o.rec.id, ...(locator ? { locator } : {}), ...(label ? { label } : {}) });

describe("Chicago author-date (CMOS 18 quick guide)", () => {
  check("chicago-ad", CAD);
  coverage("chicago-ad", CAD);
  test("in-text citations (CAD)", () => {
    const m = (o: Oracle, loc?: string, label?: CiteItem["label"]) => STYLES["chicago-ad"]!.marker([{ rec: o.rec, item: ci(o, loc, label) }]).plain;
    expect(m(CAD[4], "117-118", "page")).toBe("(Binder and Kidder 2022, 117–18)");
    expect(m(CAD[5], "45", "page")).toBe("(Yu 2020, 45)");
    expect(m(CAD[0], "480", "page")).toBe("(Dittmar and Schemske 2023, 480)");
    expect(m(CAD[1], "1842-1843", "page")).toBe("(Kwon 2022, 1842–43)");
    expect(m(CAD[2], "230")).toBe("(Lindquist 2023, 230)");
    expect(m(CAD[3], "9–10", "page")).toBe("(Snyder et al. 2025, 9–10)");
    expect(m(CAD[6], "chap. 10, doc. 19")).toBe("(Kurland and Lerner 1987, chap. 10, doc. 19)");
  });
  test("et al.: “up to six in the reference list; for more than six authors, list the first three, followed by et al.”", () => {
    const base = { title: "T", "container-title": "J", issued: Y(2020), volume: "1", page: "1-2" };
    expect(STYLES["chicago-ad"]!.reference(R("article-journal", { ...base, author: many(6) })).plain)
      .toMatch(/^AuthorA, Q\. R\., Q\. R\. AuthorB, Q\. R\. AuthorC, Q\. R\. AuthorD, Q\. R\. AuthorE, and Q\. R\. AuthorF\. 2020\./);
    expect(STYLES["chicago-ad"]!.reference(R("article-journal", { ...base, author: many(7) })).plain)
      .toMatch(/^AuthorA, Q\. R\., Q\. R\. AuthorB, Q\. R\. AuthorC, et al\. 2020\./);
    // In the text, three or more → first author et al.
    const two = R("book", { author: many(2), title: "T", issued: Y(2001) });
    const three = R("book", { author: many(3), title: "T", issued: Y(2001) });
    expect(STYLES["chicago-ad"]!.marker([{ rec: two, item: { id: two.id } }]).plain).toBe("(AuthorA and AuthorB 2001)");
    expect(STYLES["chicago-ad"]!.marker([{ rec: three, item: { id: three.id } }]).plain).toBe("(AuthorA et al. 2001)");
  });
});

describe("Chicago notes-bibliography (CMOS 18 quick guide)", () => {
  check("chicago-nb", CNB);
  coverage("chicago-nb", CNB);
  const note = (o: Oracle, first: boolean, loc?: string, label?: CiteItem["label"]) =>
    STYLES["chicago-nb"]!.note!(o.rec, ci(o, loc, label), first).plain;
  // (The guide's Dittmar note has a stray space inside the italics, "American Naturalist  202" in
  // the page source; it renders as one space and is compared with one.)
  test("first notes (the note number is Word's footnote number, so it is not part of the text)", () => {
    expect(note(CAD[1], true, "1842-1843", "page")).toBe("Hyeyoung Kwon, “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life,” American Journal of Sociology 127, no. 6 (2022): 1842–43, https://doi.org/10.1086/720277.");
    expect(note(CAD[2], true, "230", "page")).toBe("Benjamin Lindquist, “The Art of Text-to-Speech,” Critical Inquiry 50, no. 2 (2023): 230, https://doi.org/10.1086/727651.");
    expect(note(CAD[0], true, "480", "page")).toBe("Emily L. Dittmar and Douglas W. Schemske, “Temporal Variation in Selection Influences Microgeographic Local Adaptation,” American Naturalist 202, no. 4 (2023): 480, https://doi.org/10.1086/725865.");
    expect(note(CAD[3], true, "9-10", "page")).toBe("Carl D. Snyder et al., “Extant Life Detection Using Label-Free Video Microscopy in Analog Aquatic Environments,” PLOS ONE 20, no. 3 (2025): 9–10, e0318239, https://doi.org/10.1371/journal.pone.0318239.");
    expect(note(CAD[5], true, "45", "page")).toBe("Charles Yu, Interior Chinatown (Pantheon Books, 2020), 45.");
    expect(note(CAD[4], true, "117-118", "page")).toBe("Amy J. Binder and Jeffrey L. Kidder, The Channels of Student Activism: How the Left and Right Are Winning (and Losing) in Campus Politics Today (University of Chicago Press, 2022), 117–18.");
    expect(note(CAD[6], true, "chap. 10, doc. 19")).toBe("Philip B. Kurland and Ralph Lerner, eds., The Founders’ Constitution (University of Chicago Press, 1987), chap. 10, doc. 19, https://press-pubs.uchicago.edu/founders/.");
  });
  test("shortened notes that the mechanical short-title rule reproduces", () => {
    expect(note(CAD[5], false, "48", "page")).toBe("Yu, Interior Chinatown, 48.");
    expect(note(CAD[4], false, "125", "page")).toBe("Binder and Kidder, Channels of Student Activism, 125.");
    expect(note(CAD[1], false, "1851", "page")).toBe("Kwon, “Inclusion Work,” 1851.");
    expect(note(CAD[0], false, "480", "page")).toBe("Dittmar and Schemske, “Temporal Variation,” 480.");
    expect(note(CAD[6], false, "chap. 4, doc. 29")).toBe("Kurland and Lerner, Founders’ Constitution, chap. 4, doc. 29.");
    const hebert = R("article-journal", { author: [p("Hebert", "B. T.")], title: "The Island of Bolsö: A Study of Norwegian Life", "container-title": "Sociological Review", issued: Y(1925), volume: "17", issue: "4", page: "307-313" });
    expect(STYLES["chicago-nb"]!.note!(hebert, { id: hebert.id, locator: "311", label: "page" }, false).plain).toBe("Hebert, “Island of Bolsö,” 311.");
    const marks = R("book", { editor: [p("Marks", "P. J. M."), p("Parkin", "Stephen")], title: "The Book by Design: The Remarkable Story of the World’s Greatest Invention", publisher: "University of Chicago Press", issued: Y(2023) });
    expect(STYLES["chicago-nb"]!.note!(marks, { id: marks.id }, false).plain).toBe("Marks and Parkin, Book by Design.");
    const melville = R("book", { author: [p("Melville", "Herman")], title: "Moby-Dick; or, The Whale", issued: Y(1851) });
    expect(STYLES["chicago-nb"]!.note!(melville, { id: melville.id, locator: "722-723", label: "page" }, false).plain).toBe("Melville, Moby-Dick, 722–23.");
  });
  test("note et al. boundary: two authors named, three → first author et al. (CNB)", () => {
    const two = R("book", { author: many(2), title: "Title", publisher: "Pub", issued: Y(2001) });
    const three = R("book", { author: many(3), title: "Title", publisher: "Pub", issued: Y(2001) });
    expect(STYLES["chicago-nb"]!.note!(two, { id: two.id }, true).plain).toBe("Q. R. AuthorA and Q. R. AuthorB, Title (Pub, 2001).");
    expect(STYLES["chicago-nb"]!.note!(three, { id: three.id }, true).plain).toBe("Q. R. AuthorA et al., Title (Pub, 2001).");
    expect(STYLES["chicago-nb"]!.note!(three, { id: three.id }, false).plain).toBe("AuthorA et al., Title.");
  });
  test("KNOWN DIVERGENCE: short titles the guide chose editorially are not reproduced", () => {
    // CNB: "Lindquist, “Text-to-Speech,” 231–32." / "Snyder et al., “Extant Life Detection,” 12." /
    // "Borel, *Fact-Checking*, 104–5." CMOS lets the author pick the short title; our rule is mechanical.
    expect(chicagoShortTitle("The Art of Text-to-Speech")).toBe("Art of Text-to-Speech");
    expect(chicagoShortTitle("Extant Life Detection Using Label-Free Video Microscopy in Analog Aquatic Environments")).toBe("Extant Life Detection Using");
    expect(chicagoShortTitle("The Chicago Guide to Fact-Checking")).toBe("Chicago Guide to Fact-Checking");
  });
});

// ================================================================ html, display contract, refusals

describe("html formatting each guide prescribes", () => {
  test("IEEE: journal abbreviation and book titles italic", () => {
    expect(STYLES.ieee!.reference(IEEE[0].rec).html).toContain("<i>IEEE Trans. Biomed. Eng.</i>");
    expect(STYLES.ieee!.reference(IEEE[5].rec).html).toContain("<i>Robot Vision</i>");
  });
  test("ACS: journal italic, year bold, volume italic (quick guide markup); book title italic, thesis title roman", () => {
    const h = STYLES.acs!.reference(ACS[0].rec).html;
    expect(h).toContain("<i>Nature Chemistry</i> <b>2022</b>, <i>14</i> (10)");
    expect(STYLES.acs!.reference(ACS[5].rec).html).toContain("<i>Steeped: The Chemistry of Tea</i>;");
    expect(STYLES.acs!.reference(ACS[12].rec).html).not.toContain("<i>");
  });
  test("Nature: journal italic, volume and its comma bold (NAT1)", () => {
    expect(STYLES.nature!.reference(NATURE[0].rec).html).toContain("<i>J. Cell Biol.</i> <b>156,</b> 35–39 (2002).");
  });
  test("APA: journal and volume italic, issue roman; book title italic", () => {
    expect(STYLES.apa7!.reference(APA[0].rec).html).toContain("<i>Psychology of Popular Media Culture</i>, <i>8</i>(3), 207–217.");
    expect(STYLES.apa7!.reference(APA[6].rec).html).toContain("<i>Behave: The biology of humans at our best and worst</i>.");
  });
  test("Chicago: journal and book titles italic", () => {
    expect(STYLES["chicago-ad"]!.reference(CAD[1].rec).html).toContain("<i>American Journal of Sociology</i>");
    expect(STYLES["chicago-nb"]!.reference(CAD[5].rec).html).toContain("<i>Interior Chinatown</i>");
  });
  test("et al. is roman in every style (no fetched guide italicises it)", () => {
    for (const id of ["ieee", "nature", "vancouver", "chicago-ad"] as StyleId[]) {
      const r = R("article-journal", { author: many(25), title: "T", "container-title": "J", "container-title-short": "J", issued: Y(2020), volume: "1", page: "1-2" });
      const h = STYLES[id]!.reference(r).html;
      expect(h).toMatch(/et al/);
      expect(h).not.toMatch(/<i>et al/);
    }
  });
});

describe("display contract", () => {
  const titled = (title: string): BibRecord[] => [
    R("article-journal", { author: [p("Smith", "John")], title, "container-title": "Journal of H₂O Science", "container-title-short": "J. H₂O Sci.", issued: Y(2020), volume: "1", page: "10-20" }),
    R("book", { author: [p("Smith", "John")], title, publisher: "Pub", "publisher-place": "City", issued: Y(2020) }),
  ];
  const shipped = (Object.keys(STYLE_INFO) as StyleId[]).filter((id) => STYLE_INFO[id].shipped);
  test.each(shipped)("%s: H₂O and CO₂ survive in plain and html, from Unicode or <sub> input", (id) => {
    for (const title of ["Splitting Of H₂O And CO₂", "Splitting of H<sub>2</sub>O and CO<sub>2</sub>"]) {
      for (const rec of titled(title)) {
        if (!STYLE_INFO[id].types.includes(rec.type)) continue;
        const f = STYLES[id]!.reference(rec);
        for (const s of [f.plain, f.html]) {
          expect(s).toContain("H₂O");
          expect(s).toContain("CO₂");
          expect(s).not.toMatch(/H2O|CO2|\^|<sub>/);
        }
      }
    }
  });
  test.each(shipped)("%s: plain is the html stripped of tags", (id) => {
    for (const rec of titled("R&D on H₂O")) {
      if (!STYLE_INFO[id].types.includes(rec.type)) continue;
      const f = STYLES[id]!.reference(rec);
      expect(f.plain).toBe(f.html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      expect(f.plain).toContain("R&D");
      expect(f.html).toContain("R&amp;D");
    }
  });
  test("ranges use the en dash; NLM uses its hyphen", () => {
    const rec = titled("T")[0];
    for (const id of ["ieee", "acs", "nature", "apa7", "chicago-ad"] as StyleId[]) expect(STYLES[id]!.reference(rec).plain).toMatch(/10–20/);
    expect(STYLES.vancouver!.reference(rec).plain).toMatch(/:10-20\./);
  });
  test("an et-al-in-source record never gets names invented", () => {
    const r = R("article-journal", { author: [p("Solo", "A.")], "et-al-in-source": true, title: "T", "container-title": "J", "container-title-short": "J", issued: Y(2020), volume: "1", page: "1-2" });
    expect(STYLES.ieee!.reference(r).plain).toMatch(/^A\. Solo et al\., /);
    expect(STYLES.nature!.reference(r).plain).toMatch(/^Solo, A\. et al\. /);
    expect(STYLES.vancouver!.reference(r).plain).toMatch(/^Solo A, et al\. /);
    expect(STYLES.apa7!.marker([{ rec: r, item: { id: r.id } }]).plain).toBe("(Solo et al., 2020)");
  });
});

describe("refusals by name", () => {
  test("unclaimed types throw BibStyleRefusal and formatReference returns the reason", () => {
    const pat = R("patent", { author: [p("Wilkinson", "J. P.")], title: "Nonlinear resonant circuit devices", authority: "US", number: "3 624 125", issued: Y(1990, 7, 16) });
    expect(() => STYLES.ieee!.reference(pat)).toThrow(BibStyleRefusal);
    const r = formatReference("ieee", pat);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/IEEE cannot format a patent reference: .*two internally consistent patent examples/);
    expect(formatReference("nature", R("book", { title: "X", issued: Y(2000) })).ok).toBe(false);
    expect(formatReference("acs", R("webpage", { title: "X" })).ok).toBe(false);
  });
  test("Harvard and MLA are not offered, with the reason", () => {
    expect(getStyle("harvard-ctr")).toBeNull();
    expect(getStyle("mla9")).toBeNull();
    const r = formatReference("mla9", R("book", { title: "X", issued: Y(2000) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MLA 9 is not available/);
  });
  test("claimed types format successfully through formatReference", () => {
    const r = formatReference("apa7", APA[0].rec);
    expect(r.ok && r.value.plain).toBe(APA[0].raw);
  });
});

describe("review fixes (v2.142.0)", () => {
  const base = { author: [p("Kwon", "Hyeyoung")], title: "Inclusion work", "container-title-short": "Am. J. Sociol.", volume: "127", issue: "6", page: "1818-1859", issued: Y(2022, 5) };
  test("IEEE never prints a doi.org link to the record's own DOI, nor a database index page", () => {
    for (const URL of ["http://dx.doi.org/10.1086/720277", "https://doi.org/10.1086/720277",
      "https://www.scopus.com/inward/record.uri?eid=2-s2.0-85", "https://www.webofscience.com/wos/woscc/full-record/WOS:1"]) {
      const s = STYLES.ieee!.reference(R("article-journal", { ...base, DOI: "10.1086/720277", URL })).plain;
      expect(s.endsWith("doi: 10.1086/720277.")).toBe(true);
      expect(s.split("10.1086/720277").length - 1).toBe(1);
    }
    // A real repository URL beside the DOI is kept (the guide: DOI first, then the URL).
    const repo = STYLES.ieee!.reference(R("article-journal", { ...base, DOI: "10.1086/720277", URL: "https://example.org/kwon.pdf" })).plain;
    expect(repo).toMatch(/doi: 10\.1086\/720277\. \[Online\]\. Available: https:\/\/example\.org\/kwon\.pdf$/);
    // Without a DOI an index page is all there is, so it is printed.
    expect(STYLES.ieee!.reference(R("article-journal", { ...base, URL: "https://www.scopus.com/x" })).plain).toContain("scopus.com");
  });
  test("IEEE markers are ascending", () => {
    const r = IEEE[0].rec;
    expect(STYLES.ieee!.marker([{ rec: r, n: 2, item: { id: r.id } }, { rec: r, n: 1, item: { id: r.id } }]).plain).toBe("[1], [2]");
  });
  test("hyphenated given names give capital initials in every style", () => {
    const r = R("article-journal", { author: [p("Kim", "Min-jun")], title: "T", "container-title": "J", "container-title-short": "J", issued: Y(2020), volume: "1", page: "1-2" });
    expect(STYLES.ieee!.reference(r).plain).toMatch(/^M\.-J\. Kim,/);
    expect(STYLES.vancouver!.reference(r).plain).toMatch(/^Kim MJ\./);
  });
  test("refusals name the type in words, with the right article", () => {
    const r = formatReference("ieee", R("article", { title: "Attention" }));
    expect(!r.ok && r.reason).toMatch(/IEEE cannot format a preprint reference/);
    const d = formatReference("acs", R("dataset", { title: "D" }));
    expect(!d.ok && d.reason).toMatch(/ACS cannot format a dataset reference/);
  });
  test("Chicago: question titles, entity-safe short titles, forthcoming", () => {
    const q = R("article-journal", { author: [p("Ito", "Masato")], title: "Can the Application of Amorphous Oxide TFT Be an Electrophoretic Display?", "container-title": "Journal of Non-Crystalline Solids", volume: "354", issue: "19", page: "2777-2782", issued: Y(2008) });
    expect(STYLES["chicago-nb"]!.note!(q, { id: q.id }, true).plain).toContain("Display?” Journal of Non-Crystalline Solids");
    expect(STYLES["chicago-nb"]!.note!(q, { id: q.id, locator: "2779", label: "page" }, false).plain).toBe("Ito, “Can the Application,” 2779.");
    expect(chicagoShortTitle("Chemistry &amp; Biology of Ion Channels")).toBe("Chemistry &amp; Biology");
    const ip = R("article-journal", { author: [p("Doe", "Jane")], title: "T", "container-title": "Journal of Things", issued: { literal: "in press" } });
    expect(STYLES["chicago-ad"]!.reference(ip).plain).toBe("Doe, Jane. Forthcoming. “T.” Journal of Things.");
  });
});

describe("warnings", () => {
  test("a missing abbreviation is flagged, never invented", () => {
    const r = R("article-journal", { author: [p("A", "B.")], title: "T", "container-title": "Journal of Applied Things", issued: Y(2020), volume: "1", page: "1-2" });
    expect(referenceWarnings("ieee", r).join(" ")).toMatch(/No abbreviation for "Journal of Applied Things"/);
    expect(STYLES.ieee!.reference(r).plain).toContain("Journal of Applied Things");
    expect(referenceWarnings("acs", r)).toEqual([]);
    expect(referenceWarnings("ieee", { ...r, "container-title-short": "J. Appl. Things" })).toEqual([]);
  });
  test("one-word titles are not abbreviated and not flagged (IEEE: “Science and Nature”)", () => {
    const r = R("article-journal", { author: [p("A", "B.")], title: "T", "container-title": "Science", issued: Y(2020), volume: "1", page: "1-2" });
    expect(referenceWarnings("ieee", r)).toEqual([]);
  });
});

describe("sparse records never print junk", () => {
  const shipped = (Object.keys(STYLE_INFO) as StyleId[]).filter((id) => STYLE_INFO[id].shipped);
  const sparse: BibRecord[] = [
    R("article-journal", { title: "Only a title" }),
    R("article-journal", { author: [p("Solo", "A.")], issued: Y(2020) }),
    R("book", { author: [lit("World Health Organization")], title: "Report on things", issued: Y(2021) }),
    R("chapter", { title: "Chapter", "container-title": "Book" }),
    R("thesis", { author: [p("Solo", "A.")], title: "T" }),
    R("report", { title: "R" }),
    R("paper-conference", { title: "P" }),
    R("patent", { title: "Pat" }),
  ];
  test.each(shipped)("%s", (id) => {
    for (const rec of sparse) {
      if (!STYLE_INFO[id].types.includes(rec.type)) continue;
      const f = STYLES[id]!.reference(rec);
      expect(f.plain).not.toMatch(/undefined|null|NaN|\.\.(?!\.)|,,|\s[,.;:]|\(\)|\s{2}/);
      expect(f.plain.trim()).toBe(f.plain);
      // A corporate author is never initialised.
      if (rec.author?.[0]?.literal) expect(f.plain).toContain("World Health Organization");
    }
  });
});

describe("source hygiene: no invisible or look-alike characters typed into Builder 3's files", () => {
  // The edit tools turn \uXXXX escapes into literal characters. Invisible ones must be built
  // with String.fromCharCode. The only exceptions are verbatim oracle data: U+2212 inside ACS
  // `raw:` strings and the decomposed accents (U+0301) of the Timmermans `raw:` string.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  const files = ["bibPages.ts", "bibCase.ts", "bibStyles.ts", "journalAbbrev.ts",
    "__tests__/bibPages.test.ts", "__tests__/bibCase.test.ts", "__tests__/bibStyles.oracle.test.ts"];
  const INVISIBLE = new RegExp("[\\ufeff\\u200b-\\u200d\\u00a0\\u0300-\\u036f]");
  const MINUS = new RegExp("\\u2212");
  test.each(files)("%s", (f) => {
    const lines = fs.readFileSync(path.join(__dirname, "..", f), "utf8").split("\n");
    lines.forEach((line, i) => {
      const oracle = /\braw: "/.test(line);
      if (INVISIBLE.test(line)) expect([f, i + 1, oracle && /Timmermans/.test(line)]).toEqual([f, i + 1, true]);
      if (MINUS.test(line)) expect([f, i + 1, oracle && /src: "ACS"/.test(line)]).toEqual([f, i + 1, true]);
    });
  });
});

test("compressNumbers: ranges only for three or more consecutive numbers", () => {
  expect(compressNumbers([1, 2, 3])).toBe("1–3");
  expect(compressNumbers([1, 3])).toBe("1,3");
  expect(compressNumbers([1, 2])).toBe("1,2");
  expect(compressNumbers([5, 1, 2, 3, 9, 10, 11, 12])).toBe("1–3,5,9–12");
});
