// Adversarial pass over the importers (docs/SCOPE-CITATIONS-2026-10.md §D, Builder 2):
// truncated and hostile input, stack depth, time, the "never silently drop" rule, the
// display contract, CSL-JSON validation (including a real Zotero CSL-JSON export), and a
// guard against shell-eaten backslashes in the sources.
//
// zotero-group2205533.csl.json: Zotero web API, fetched 2026-10-14:
//   https://api.zotero.org/groups/2205533/items/top?limit=6&format=csljson

import * as fs from "fs";
import * as path from "path";
import { parseBibtex } from "../bibtex";
import { parseRis } from "../ris";
import { normalizePage, normalizeRichText, parseCslJson, richTextToPlain } from "../cslJson";
import { latexToPlain, latexToRich } from "../latexUnicode";

const LIB = path.join(__dirname, "..");
// Invisible characters come from their codes, never typed literally into source.
const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);
const ACUTE = String.fromCharCode(0x301);
const FX = path.join(__dirname, "fixtures", "bib");

describe("source hygiene", () => {
  test("no control or invisible characters in the importer sources and tests", () => {
    // A shell-eaten \b becomes 0x08 and never matches; a writing tool that decodes a
    // backslash-u escape (it happened while building these files) leaves an invisible
    // combining mark or NBSP in a string literal. Both are banned; the
    // sources build such characters with String.fromCharCode. The class is built from
    // codes for the same reason.
    const ranges: Array<[number, number]> = [
      [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0xa0, 0xa0], [0xad, 0xad],
      [0x300, 0x36f], [0x2000, 0x200f], [0x2028, 0x2029], [0x202f, 0x202f], [0xfeff, 0xfeff],
    ];
    const isBad = (c: number): boolean => ranges.some(([a, b]) => c >= a && c <= b);
    const files = [
      "bibtex.ts", "ris.ts", "cslJson.ts", "doi.ts", "latexUnicode.ts", "bibNames.ts", "bibRecord.ts",
      "__tests__/bibtex.test.ts", "__tests__/ris.test.ts", "__tests__/bibNames.test.ts",
      "__tests__/doi.test.ts", "__tests__/bibImport.adversarial.test.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(LIB, f), "utf8");
      let found: string | null = null;
      for (let i = 0; i < src.length && !found; i++) {
        if (isBad(src.charCodeAt(i))) found = `${f}: U+${src.charCodeAt(i).toString(16)} at offset ${i}`;
      }
      expect(found).toBeNull();
    }
  });
});

describe("BibTeX: truncated input never throws, never hangs, never drops an entry silently", () => {
  test.each([
    "@",
    "@article",
    "@article{",
    "@article{k",
    "@article{k,",
    "@article{k, title",
    "@article{k, title =",
    "@article{k, title = {abc",
    '@article{k, title = "abc',
    "@article{k, title = {abc}",
    "@article{k, title = {abc},",
    "@article{k, title = mac",
    "@article{k, title = {a} #",
    "@string{",
    "@string{x",
    "@string{x =",
    '@string{x = "y"',
    "@preamble{",
    "@comment{",
    "@article(k, title = {a}",
    "@article{k, title = {a}}}}}}",
    "}}}}@article{k, title={a}}",
  ])("%j", (src) => {
    const res = parseBibtex(src);
    const looksLikeEntry = /@(?!string|preamble|comment)[A-Za-z]+\s*[{(]/i.test(src);
    if (looksLikeEntry) expect(res.records.length + res.refused.length).toBeGreaterThanOrEqual(1);
    for (const r of res.refused) {
      expect(r.line).toBeGreaterThanOrEqual(1);
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });

  test("several entries on ONE line: a bad one loses only itself", () => {
    const res = parseBibtex("@article{a, title={A}} @article{b, title={B} @article{c, title={C}} @article{d, title={D}}");
    expect(res.records.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0].reason).toMatch(/^@article\{b\}/);
  });

  test("every entry in a file of 30 is either imported or refused (accounting)", () => {
    const lines: string[] = [];
    for (let k = 0; k < 30; k++) {
      if (k % 7 === 3) lines.push(`@article{e${k}, title = {Broken {${k}}`);
      else if (k % 11 === 5) lines.push(`@article{e${k}, journal = undefinedMacro${k}}`);
      else lines.push(`@article{e${k}, title = {T${k}}}`);
    }
    const res = parseBibtex(lines.join("\n"));
    expect(res.records.length + res.refused.length).toBe(30);
  });

  test("CRLF line numbers are the same as LF line numbers", () => {
    const lf = "\n\n@article{a, journal = nope}\n\n@article{b, journal = nope2}";
    expect(parseBibtex(lf.replace(/\n/g, "\r\n")).refused.map((r) => r.line)).toEqual([3, 5]);
  });

  test("a BOM and JabRef meta comments are harmless", () => {
    const res = parseBibtex(BOM + "% Encoding: UTF-8\n\n@article{a, title={A}}\n\n@Comment{jabref-meta: databaseType:bibtex;}\n");
    expect(res.refused).toEqual([]);
    expect(res.records.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("stack depth and time", () => {
  test("100,000 nested braces in a title: no RangeError", () => {
    const deep = "{".repeat(100_000) + "x" + "}".repeat(100_000);
    const res = parseBibtex(`@article{deep, title = {${deep}}}`);
    expect(res.refused).toEqual([]);
    expect(richTextToPlain(res.records[0].title!)).toBe("x");
  });
  test("100,000 nested braces in an author: no RangeError", () => {
    const deep = "{".repeat(100_000) + "Org" + "}".repeat(100_000);
    const res = parseBibtex(`@article{deep, author = {${deep}}}`);
    expect(res.records[0].author).toEqual([{ literal: "Org" }]);
  });
  test("100,000 unclosed braces are refused, not overflowed", () => {
    const res = parseBibtex(`@article{deep, title = {${"{".repeat(100_000)}}`);
    expect(res.records).toEqual([]);
    expect(res.refused[0].reason).toMatch(/unbalanced braces/);
  });
  test("deeply nested CSL-JSON is refused, not thrown", () => {
    const res = parseCslJson("[".repeat(200_000) + "]".repeat(200_000));
    expect(res.records).toEqual([]);
    expect(res.refused.length).toBeGreaterThanOrEqual(1);
  });
  test("5,000 BibTeX entries and 5,000 RIS records import in well under 10 s", () => {
    const bib: string[] = [];
    const ris: string[] = [];
    for (let k = 0; k < 5000; k++) {
      bib.push(`@article{k${k}, author = {Smith, John and van der Berg, Anna and others}, title = {On {DNA} and H$_2$O, part ${k}}, journal = {J.}, year = {2000}, month = jan, pages = {1--9}}`);
      ris.push(`TY  - JOUR\nAU  - Smith, John\nTI  - Part ${k}\nPY  - 2000\nSP  - 1\nEP  - 9\nER  - `);
    }
    const t0 = Date.now();
    const a = parseBibtex(bib.join("\n"));
    const b = parseRis(ris.join("\n"));
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(a.records).toHaveLength(5000);
    expect(b.records).toHaveLength(5000);
    expect(new Set(b.records.map((r) => r.id)).size).toBe(5000);
  });
  test("input over the size limit is refused at line 1", () => {
    const big = "x".repeat(5_000_001);
    for (const parse of [parseBibtex, parseRis, parseCslJson]) {
      const r = parse(big);
      expect(r.records).toEqual([]);
      expect(r.refused[0].line).toBe(1);
      expect(r.refused[0].reason).toMatch(/limit/);
    }
  });
});

describe("display contract: math never leaves _ ^ $ behind", () => {
  test.each([
    ["H$_2$O", "H₂O"],
    ["$H_2O$", "H₂O"],
    ["$CO_2$", "CO₂"],
    ["$^{13}$C", "¹³C"],
    ["H\\textsubscript{2}O", "H₂O"],
    ["\\ce{H2SO4}", "H₂SO₄"],
    ["\\ce{Ca^{2+}}", "Ca²⁺"],
    ["$10^{-3}$", "10⁻³"],
    ["$x_{\\mathrm{max}}$", "xₘₐₓ"],
    ["$\\Delta G^\\circ$", "ΔG°"],
    ["$\\frac{1}{2}$", "1/2"],
    ["$\\sqrt{2}$", "√2"],
    ["$\\mu$m", "μm"],
    ["5~\\AA", `5${NBSP}Å`],
  ])("%s → %s", (raw, out) => {
    expect(latexToPlain(raw)).toBe(out);
    expect(latexToRich(raw)).toBe(out);
  });
  test("non-mappable scripts: <sub>/<sup> in rich text, bare characters in plain, never _ or ^", () => {
    expect(latexToRich("$K_{B}$")).toBe("K<sub>B</sub>");
    expect(latexToPlain("$K_{B}$")).toBe("KB");
    expect(latexToRich("$x^{Q}$")).toBe("x<sup>Q</sup>");
    for (const raw of ["$K_{B}$", "$x^{Q}$", "$a_b^c$", "$_{}$", "$^$", "$_", "H$_{2"]) {
      expect(latexToPlain(raw)).not.toMatch(/[_^$]/);
      expect(latexToRich(raw)).not.toMatch(/[_^$]/);
    }
  });
});

describe("latexUnicode edge cases", () => {
  test("unknown commands are kept verbatim, never dropped", () => {
    expect(latexToPlain("a \\weird b")).toBe("a \\weirdb");
    expect(latexToPlain("\\weird{x}")).toBe("\\weird{x}");
  });
  test("accents with empty or command arguments; dotless i/j under accents", () => {
    expect(latexToPlain("\\'{}")).toBe("´");
    expect(latexToPlain("\\\"{\\i}")).toBe("ï");
    expect(latexToPlain("\\v{\\j}")).toBe("ǰ");
    expect(latexToPlain("\\'E")).toBe("É");
    expect(latexToPlain("\\c c")).toBe("ç");
  });
  test("stray closing braces and unclosed math are tolerated", () => {
    expect(latexToPlain("a}b")).toBe("ab");
    expect(latexToPlain("x$_2")).toBe("x₂");
  });
  test("plain output never contains markup; rich output only allow-listed tags", () => {
    const raw = "{DNA} \\emph{x} {\\bf y} $K_{B}$ \\textsuperscript{Q}";
    expect(latexToPlain(raw)).not.toMatch(/[<>]/);
    const tags = latexToRich(raw).match(/<[^>]+>/g) ?? [];
    for (const t of tags) expect(t).toMatch(/^<\/?(?:i|b|sub|sup|span(?: class="nocase")?)>$/);
  });
  test("NFC: a decomposed é from the source equals the precomposed one", () => {
    expect(latexToPlain(`Cafe${ACUTE}`)).toBe("Café".normalize("NFC"));
    expect(latexToPlain(`Cafe${ACUTE}`)).toHaveLength(4);
  });
});

describe("RIS hostile input", () => {
  test("an empty TY is refused by name; a value-less file is empty, not an error", () => {
    expect(parseRis("TY  - \nTI  - x\nER  - ").refused[0].reason).toMatch(/RIS type “\(empty\)” is not supported/);
    expect(parseRis("")).toEqual({ records: [], refused: [] });
    expect(parseRis("\n\n\n")).toEqual({ records: [], refused: [] });
  });
  test("lower-case tags are not tags (RIS tags are upper case): the record still accounts for itself", () => {
    const res = parseRis("ty  - JOUR\ner  - ");
    expect(res.records).toEqual([]);
  });
  test("a 'TY - JOUR' line inside an AB continuation is still a new TY (and the open record is refused)", () => {
    const res = parseRis("TY  - JOUR\nAB  - abstract\nTY  - JOUR\nTI  - B\nER  - ");
    expect(res.records.map((r) => r.title)).toEqual(["B"]);
    expect(res.refused).toEqual([{ line: 1, reason: "record has no ER line before the next TY on line 3" }]);
  });
});

describe("CSL-JSON", () => {
  const zot = fs.readFileSync(path.join(FX, "zotero-group2205533.csl.json"), "utf8");
  test("real Zotero web-API export ({items: […]} wrapper): types outside the contract refused by name with their line", () => {
    const res = parseCslJson(zot);
    expect(res.records.map((r) => r.id)).toEqual(["fraser2024", "greenfieldChildrenAdolescentsInternet2006", "shoreMarkingTimeLand2014"]);
    expect(res.refused.map((r) => [r.line, r.reason.split(" (")[0]])).toEqual([
      [41, "item “vedantamHiddenBrain2015”: CSL type “broadcast” is not supported"],
      [69, "item “Tintinnabulum2018”: CSL type “entry-dictionary” is not supported"],
      [89, "item “ashdowne2018”: CSL type “entry-dictionary” is not supported"],
    ]);
    const fraser = res.records[0];
    expect(fraser).toEqual({
      id: "fraser2024",
      type: "article-journal",
      "container-title": "Bodleian Library Record",
      "container-title-short": "The Bodleian Library Record", // journalAbbreviation
      issue: "1-2",
      page: "23–26", //                                             "23-26"
      DOI: "10.3828/blr.2024.37.1-2.23",
      URL: "http://www.liverpooluniversitypress.co.uk/doi/10.3828/blr.2024.37.1-2.23",
      volume: "37",
      author: [{ family: "Fraser", given: "Angus" }],
      issued: { "date-parts": [[2024]] }, //                        [["2024"]] (a string year)
      accessed: { "date-parts": [[2026, 5, 16]] },
    });
  });
  test("the same items agree with the BibTeX export of the same library where both carry the field", () => {
    const fromJson = parseCslJson(zot).records;
    const fromBib = parseBibtex(fs.readFileSync(path.join(FX, "zotero-group2205533.bib"), "utf8")).records;
    for (const j of fromJson) {
      const b = fromBib.find((x) => x.id === j.id)!;
      for (const k of ["DOI", "volume", "page", "container-title"] as const) {
        if (j[k] !== undefined && b[k] !== undefined) expect([j.id, k, b[k]]).toEqual([j.id, k, j[k]]);
      }
    }
  });
  test("invalid JSON is refused with the line of the error", () => {
    const res = parseCslJson('[\n  {"id": "a", "type": "book"},\n  {"id": "b", "type": }\n]');
    expect(res.records).toEqual([]);
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0].line).toBe(3);
    expect(res.refused[0].reason).toMatch(/^not valid JSON/);
  });
  test("field validation: numbers become text, bad shapes are refused by line with the reason", () => {
    const src = [
      "[",
      '  {"id": 12, "type": "book", "volume": 3, "title": "Ok"},', //          2
      '  {"id": "n", "type": "book", "author": "Smith"},', //                  3
      '  {"id": "d", "type": "book", "issued": {"date-parts": [["abc"]]}},', // 4
      '  {"id": "m", "type": "book", "issued": {"date-parts": [[2020, 17]]}},', // 5 (13–16, 21–24 are seasons)
      '  {"type": "book"},', //                                                6
      '  {"id": "e", "type": "book", "author": [{"given": ""}]},', //          7
      '  {"id": "12", "type": "book"},', //                                    8
      '  {"id": "x", "type": "book", "DOI": "nope"},', //                      9
      '  {"id": "t", "type": "book", "title": ["a"]},', //                     10
      '  {"id": "f", "type": "book", "et-al-in-source": "yes"},', //           11
      '  "string item"', //                                                    12
      "]",
    ].join("\n");
    const res = parseCslJson(src);
    expect(res.records).toEqual([{ id: "12", type: "book", volume: "3", title: "Ok" }]);
    expect(res.refused).toEqual([
      { line: 3, reason: "field “author” must be a list of names" },
      { line: 4, reason: "issued: “date-parts” must be numbers" },
      { line: 5, reason: "issued: month 17 is not a month" },
      { line: 6, reason: "item has no “id”" },
      { line: 7, reason: "author #1 has no family, given or literal name" },
      { line: 8, reason: "duplicate id “12” (first used on line 2)" },
      { line: 9, reason: "item “x”: “nope” is not a DOI: a DOI starts with “10.”, 4–9 digits and a slash (10.1086/720277)." },
      { line: 10, reason: "field “title” must be text, not a list" },
      { line: 11, reason: "item “f”: “et-al-in-source” must be true or false" },
      { line: 12, reason: "item is not a JSON object" },
    ]);
  });
  test("rich text: & and < stay literal, small-caps spans unwrap, NFC applied", () => {
    const res = parseCslJson(
      JSON.stringify([
        {
          id: "r",
          type: "article-journal",
          title: `p < 0.05 & <span style="font-variant:small-caps;">Smith</span> on Cafe${ACUTE} <i>in vivo</i>`,
          "container-title": "Ann. <span class=\"nocase\">NMR</span>",
        },
      ]),
    );
    expect(res.records[0].title).toBe("p < 0.05 & Smith on Café <i>in vivo</i>");
    expect(res.records[0]["container-title"]).toBe('Ann. <span class="nocase">NMR</span>');
  });
  test("seasons (months 21–24) keep the year; raw and literal dates; preprint aliases to article", () => {
    const res = parseCslJson(
      JSON.stringify([
        { id: "s", type: "preprint", issued: { "date-parts": [[2020, 21]] } },
        { id: "r", type: "post-weblog", issued: { raw: "2021-03-04" } },
        { id: "l", type: "report", issued: { literal: "forthcoming" } },
      ]),
    );
    expect(res.refused).toEqual([]);
    expect(res.records).toEqual([
      { id: "s", type: "article", issued: { "date-parts": [[2020]] } },
      { id: "r", type: "webpage", issued: { "date-parts": [[2021, 3, 4]] } },
      { id: "l", type: "report", issued: { literal: "forthcoming" } },
    ]);
  });
  test("a single item object (not an array) is accepted; a bare number is refused", () => {
    expect(parseCslJson('{"id": "a", "type": "book"}').records).toEqual([{ id: "a", type: "book" }]);
    expect(parseCslJson("42").refused[0].reason).toMatch(/array of items/);
  });
});

describe("shared normalisers", () => {
  test.each([
    ["1818-1859", "1818–1859"],
    ["867 -- 889", "867–889"],
    ["270—273", "270–273"],
    ["e0318239", "e0318239"],
    ["S1-S12", "S1–S12"],
    ["xii-xv", "xii–xv"],
    ["1-5, 7, 9--11", "1–5, 7, 9–11"],
    ["123", "123"],
    ["pp. 1-5", "pp. 1-5"],
  ])("normalizePage(%s)", (raw, out) => {
    expect(normalizePage(raw)).toBe(out);
  });
  test("normalizeRichText collapses whitespace and unwraps nested small caps", () => {
    expect(normalizeRichText('  a\n  <span style="font-variant: small-caps">B</span>  ')).toBe("a B");
  });
});
