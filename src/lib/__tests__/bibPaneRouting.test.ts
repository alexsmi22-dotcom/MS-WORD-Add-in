/**
 * Routing, not engine (v2.142.0): the Citations ▸ Bibliography panel must REACH the citation
 * engines (importers, styles, renumbering, store, OOXML), and the panel's own decisions live in
 * lib/bibPane.ts where they can be tested. taskpane.ts cannot be imported under jest, so the
 * wiring is asserted on its source; the decisions are exercised for real below.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CASE_NOTE, bibHeading, bibLabel, collectCitations, detectBibFormat, doiLibraryLines, importBibText, importSummary,
  libraryRows, loadBibStore, markerRuns, mergeImport, notOfferedNote, offeredStyles, planInsert, planUpdate,
  previewRecords, typeRefusals,
} from "../bibPane";
import { CITE_TAG_PREFIX, emptyStore, serializeStore, type BibStoreData } from "../bibStore";
import { DOI_OFFLINE_NOTE } from "../doi";
import type { BibRecord, StyleId } from "../bibRecord";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const FIX = path.join(__dirname, "fixtures", "bib");
const fixture = (f: string): string => fs.readFileSync(path.join(FIX, f), "utf8");

/** The body of a top-level pane function, for "this call happens inside that handler" checks. */
function fnBody(name: string): string {
  const at = PANE.indexOf(`async function ${name}(`) >= 0 ? PANE.indexOf(`async function ${name}(`) : PANE.indexOf(`function ${name}(`);
  expect(at).toBeGreaterThan(0);
  const next = PANE.indexOf("\nfunction ", at + 10);
  const nextAsync = PANE.indexOf("\nasync function ", at + 10);
  const end = Math.min(...[next, nextAsync].filter((n) => n > 0));
  return PANE.slice(at, end);
}

const BIB = `
@article{alpha, author = {Alpha, Ann and Beta, Bob}, title = {First paper on {NMR}}, journal = {Journal of Tests},
  shortjournal = {J. Tests}, year = {2020}, volume = {1}, number = {2}, pages = {10--20}}
@article{gamma, author = {Gamma, Gus}, title = {Second paper}, journal = {Journal of Tests}, year = {2021}, volume = {2}, pages = {5--9}}
@article{delta, author = {Delta, Dee}, title = {Third paper}, journal = {Journal of Tests}, year = {2019}, volume = {3}, pages = {1--4}}
@book{epsilon, author = {Epsilon, Eve}, title = {A Book}, publisher = {Pub}, address = {City}, year = {2018}}
`;

function libraryStore(style: StyleId): BibStoreData {
  const rep = importBibText(BIB);
  expect(rep.lines).toEqual([]);
  return mergeImport(emptyStore(style), rep.records).store;
}

/** Simulate the document: controls in order, each holding the text the last pass wrote. */
function docControls(order: string[], texts: Record<string, string> = {}): Array<{ tag: string; text: string }> {
  return order.map((id) => ({ tag: CITE_TAG_PREFIX + id, text: texts[id] ?? "…" }));
}

describe("the pane is wired to the bibliography engines", () => {
  it("imports the panel's decisions from lib/bibPane", () => {
    expect(PANE).toMatch(/from "\.\.\/lib\/bibPane";/);
    for (const name of ["importBibText", "mergeImport", "planInsert", "planUpdate", "collectCitations", "previewRecords",
      "offeredStyles", "notOfferedNote", "loadBibStore", "doiLibraryLines", "libraryRows", "markerRuns", "CASE_NOTE"]) {
      expect({ name, used: new RegExp(`\\b${name}\\(|\\b${name}\\b[^,\\n]*;`).test(PANE.replace(/import \{[\s\S]*?\} from "\.\.\/lib\/bibPane";/, "")) })
        .toEqual({ name, used: true });
    }
  });
  it("every new control exists in the HTML and has a listener", () => {
    for (const id of ["bib-paste", "bib-import", "bib-open", "bib-file", "bib-doi-note", "bib-import-msg", "bib-style", "bib-style-note",
      "bib-library", "bib-loc-label", "bib-locator", "bib-preview", "bib-case-note", "bib-insert", "bib-update", "bib-msg"]) {
      expect({ id, html: HTML.includes(`id="${id}"`), pane: PANE.includes(`getElementById("${id}")`) }).toEqual({ id, html: true, pane: true });
    }
    expect(PANE).toMatch(/bibImportBtn\.addEventListener\("click"/);
    expect(PANE).toMatch(/bibOpenBtn\.addEventListener\("click", \(\) => bibFileInput\.click\(\)\)/);
    expect(PANE).toMatch(/bibFileInput\.addEventListener\("change"/);
    expect(PANE).toMatch(/bibStyleSelect\.addEventListener\("change"/);
    expect(PANE).toMatch(/bibLibrarySelect\.addEventListener\("change", renderBibPreview\)/);
    expect(PANE).toMatch(/bibInsertBtn\.addEventListener\("click", \(\) => void insertBibCitation\(\)\)/);
    expect(PANE).toMatch(/bibUpdateBtn\.addEventListener\("click", \(\) => void updateBibliography\(false\)\)/);
  });
  it("entering Citations mode fills the panel", () => {
    expect(PANE).toMatch(/if \(mode === "citations"\) \{[^}]*\n[^}]*\n[^}]*\n\s*refreshBibPanel\(\);/);
  });
  it("shows DOI_OFFLINE_NOTE verbatim, and the pane never fetches for a DOI", () => {
    expect(PANE).toMatch(/bibDoiNote\.textContent = DOI_OFFLINE_NOTE;/);
    for (const line of PANE.split("\n")) {
      if (/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(line)) expect(line).not.toMatch(/doi/i);
    }
  });
  it("the library lives in the document settings store, refused stores are never overwritten", () => {
    expect(fnBody("readBibStore")).toMatch(/Office\.context\.document\.settings\.get\(BIB_SETTING_KEY\)/);
    const w = fnBody("writeBibStore");
    expect(w).toMatch(/serializeStore\(store\)/);
    expect(w.indexOf("serializeStore(store)")).toBeLessThan(w.indexOf("settings.set(BIB_SETTING_KEY"));
    expect(w).toMatch(/saveAsync/);
    expect(fnBody("refreshBibPanel")).toMatch(/b\.disabled = blocked/);
  });
  it("Insert: checks the tag via citeTag and the store size BEFORE touching Word; one Word.run", () => {
    const b = fnBody("insertBibCitation");
    expect(b.match(/Word\.run\(/g)).toHaveLength(1);
    expect(b).toMatch(/const t = citeTag\(plan\.markerId\);/);
    expect(b.indexOf("serializeStore(plan.store)")).toBeLessThan(b.indexOf("insertContentControl()"));
    expect(b.indexOf("citeTag(plan.markerId)")).toBeLessThan(b.indexOf("insertContentControl()"));
    expect(b).toMatch(/cc\.title = CITE_CONTROL_TITLE;/);
    expect(b).toMatch(/applyBibUpdate\(context, plan\.store/);
  });
  it("Update: enumerates cite controls (body + footnotes), rewrites markers, replaces the bibliography; one Word.run", () => {
    expect(fnBody("updateBibliography").match(/Word\.run\(/g)).toHaveLength(1);
    const a = fnBody("applyBibUpdate");
    expect(a).toMatch(/ccs\.load\("items\/tag,items\/text"\)/);
    expect(a).toMatch(/body\.footnotes/);
    expect(a).toMatch(/wordApiSupported\("1\.5"\)/);
    expect(a).toMatch(/collectCitations\(/);
    expect(a).toMatch(/planUpdate\(collected, store/);
    expect(a).toMatch(/writeMarkerRuns\(cc, rw\.runs\)/);
    expect(a).toMatch(/c\.tag === BIBLIOGRAPHY_TAG/);
    expect(a).toMatch(/insertOoxml\(up\.ooxml, Word\.InsertLocation\.replace\)/);
    expect(a).toMatch(/cc\.tag = BIBLIOGRAPHY_TAG;/);
    expect(a).toMatch(/up\.report/);
  });
  // The Science filter exists to hide legal tools (render-check.js guards it), so
  // Citations stays legal-only there; bibliographies are reachable from the full
  // tool list, which shows every tile by default.
  it("the Citations tile stays out of the Science filter (render-check guard)", () => {
    expect(PANE).toMatch(/mode: "citations", audience: \["legal"\]/);
  });
});

describe("import: format detection, refusals with line numbers, merge outcomes by name", () => {
  it.each([
    ["crossref-kwon2022.bib", "bibtex"],
    ["zotero-group100.ris", "ris"],
    ["endnote-castoe2009.ris", "ris"],
    ["zotero-group2205533.csl.json", "csl-json"],
  ])("%s → %s, by extension and by content", (f, fmt) => {
    expect(detectBibFormat(fixture(f), f)).toBe(fmt);
    expect(detectBibFormat(fixture(f))).toBe(fmt);
  });
  it("a real Crossref BibTeX export imports one record", () => {
    const rep = importBibText(fixture("crossref-kwon2022.bib"), "crossref-kwon2022.bib");
    expect(rep.format).toBe("bibtex");
    expect(rep.records.map((r) => r.id)).toEqual(["Kwon_2022"]);
    expect(importSummary(rep)).toBe("BibTeX: 1 reference read.");
  });
  it("an importer refusal is shown with its line number", () => {
    const rep = importBibText("@article{ok, title={Fine}, year={2020}}\n\n@article{bad, title={Unbalanced, year={2020}\n");
    expect(rep.lines.length).toBeGreaterThan(0);
    for (const l of rep.lines) expect(l).toMatch(/^Line \d+: /);
    expect(importSummary(rep)).toMatch(/refused \(listed below with line numbers\)/);
  });
  it("a RIS type outside the table is refused by name with its line", () => {
    const rep = importBibText(fixture("zotero-group2205533.ris"), "zotero-group2205533.ris");
    expect(rep.lines.some((l) => /^Line \d+: .*SOUND/.test(l))).toBe(true);
  });
  it("pasted DOIs: recognised, shown as https://doi.org/, the offline note verbatim, no record created", () => {
    const rep = importBibText("doi:10.1086/720277.\nhttps://dx.doi.org/10.1038/ncomms10535");
    expect(rep.format).toBe("doi");
    expect(rep.records).toEqual([]);
    expect(rep.note).toBe(DOI_OFFLINE_NOTE);
    expect(rep.lines).toEqual(["DOI 10.1086/720277 → https://doi.org/10.1086/720277", "DOI 10.1038/ncomms10535 → https://doi.org/10.1038/ncomms10535"]);
    const store = mergeImport(emptyStore("ieee"), importBibText(fixture("crossref-kwon2022.bib")).records).store;
    expect(doiLibraryLines(rep.dois, store)).toEqual([
      "10.1086/720277 is already in the library as “Kwon_2022”.",
      "10.1038/ncomms10535 is not in the library. Paste its BibTeX or RIS to add it.",
    ]);
  });
  it("a PubMed .nbib (MEDLINE) is refused by name, not reduced to its DOI", () => {
    const nbib = "PMID- 33301246\nOWN - NLM\nTI  - Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine.\nLID - 10.1056/NEJMoa2034577 [doi]\nAU  - Polack FP";
    for (const name of [undefined, "pubmed.nbib"]) {
      const rep = importBibText(nbib, name);
      expect(rep).toEqual({ format: null, records: [], dois: [], lines: ["This is a PubMed MEDLINE (.nbib) file — not supported yet; export RIS from PubMed instead."] });
    }
    expect(detectBibFormat(nbib)).toBeNull();
  });
  it("unrecognised text is refused, nothing guessed", () => {
    const rep = importBibText("Smith J. A paper. 2020.");
    expect(rep.format).toBeNull();
    expect(rep.records).toEqual([]);
    expect(rep.lines[0]).toMatch(/^Not recognised as BibTeX/);
  });
  it("merging twice: identical records are skipped by name; a changed record is renamed, never overwritten", () => {
    const first = mergeImport(emptyStore("ieee"), importBibText(BIB).records);
    expect(first.lines).toEqual(["Added (4): alpha, gamma, delta, epsilon"]);
    const again = mergeImport(first.store, importBibText(BIB).records);
    expect(again.lines).toEqual(["Skipped as identical to the library copy (4): alpha, gamma, delta, epsilon"]);
    const changed = mergeImport(first.store, importBibText("@article{gamma, author={Gamma, Gus}, title={Revised}, journal={J}, year={2022}}").records);
    expect(changed.lines).toEqual(["Renamed, because a different reference already uses the key (1): gamma → gamma-2"]);
    expect(changed.store.library.gamma.title).toBe("Second paper");
  });
});

describe("the style picker offers the seven shipped styles and refuses by name", () => {
  it("exactly 7 styles; Harvard and MLA explained in one line", () => {
    expect(offeredStyles().map((s) => s.id)).toEqual(["ieee", "acs", "nature", "vancouver", "apa7", "chicago-ad", "chicago-nb"]);
    expect(notOfferedNote()).toBe("Harvard (Cite Them Right) and MLA 9 are not offered: no official guide could be verified.");
  });
  it("a patent under IEEE is refused by name, never formatted in another style; Vancouver formats it", () => {
    const pat = importBibText(fixture("zotero-patents2205533.bib")).records.filter((r) => r.type === "patent");
    expect(pat.length).toBeGreaterThan(0);
    const r = typeRefusals("ieee", pat);
    expect(r).toHaveLength(pat.length);
    expect(r[0]).toMatch(new RegExp(`^“${pat[0].id}” is a patent; IEEE does not format patents here`));
    expect(r[0]).toMatch(/It was not formatted in another style\.$/);
    expect(typeRefusals("vancouver", pat)).toEqual([]);
    const p = previewRecords("ieee", pat.slice(0, 1))[0];
    expect(p.formatted).toBeNull();
    expect(p.refusal).toMatch(/patent/i);
  });
  it("Nature claims journal articles only: a book is refused", () => {
    const book = libraryStore("nature").library.epsilon;
    expect(typeRefusals("nature", [book])[0]).toMatch(/^“epsilon” is a book; Nature does not format books here/);
  });
  it("converted titles are previewed with a note (APA sentence-cases; the imported title is shown)", () => {
    const rec: BibRecord = { id: "t", type: "article-journal", title: "Raman Spectra of Gaussian Beams", "container-title": "Journal of Tests",
      author: [{ family: "Alpha", given: "Ann" }], issued: { "date-parts": [[2020]] }, volume: "1", page: "1-2" };
    const [p] = previewRecords("apa7", [rec]);
    expect(p.formatted!.plain).toContain("Raman spectra of gaussian beams");
    expect(p.recased).toBe(true);
    expect(p.original).toBe("Raman Spectra of Gaussian Beams");
    expect(CASE_NOTE).toMatch(/Sentence case lowercases capitalised words/);
    expect(PANE).toMatch(/bibCaseNote\.textContent = CASE_NOTE;/);
    expect(PANE).toMatch(/title case changed; as imported/);
  });
  it("library rows name key, first author, year and title", () => {
    expect(libraryRows(libraryStore("ieee"))[0].label).toBe("alpha · Alpha 2020 · First paper on NMR");
  });
});

describe("insert: new marker, add to the citation at the cursor, refusals", () => {
  it("a new marker gets a cite tag", () => {
    const p = planInsert(libraryStore("ieee"), ["alpha"]);
    expect(p).toMatchObject({ ok: true, kind: "new", markerId: "1", tag: `${CITE_TAG_PREFIX}1` });
  });
  it("with the cursor in an existing citation the reference is added to it (setMarkerItems)", () => {
    const s1 = planInsert(libraryStore("ieee"), ["alpha"]);
    if (!s1.ok) throw new Error("setup");
    const p = planInsert(s1.store, ["gamma", "alpha"], { existingTag: `${CITE_TAG_PREFIX}1` });
    expect(p).toMatchObject({ ok: true, kind: "edit", markerId: "1" });
    if (p.ok) expect(p.store.markers["1"].map((i) => i.id)).toEqual(["alpha", "gamma"]);
  });
  it("refuses an unclaimed type, a locator over several references, and an empty selection by name", () => {
    expect(planInsert(libraryStore("nature"), ["epsilon"])).toMatchObject({ ok: false });
    expect(planInsert(libraryStore("ieee"), ["alpha", "gamma"], { locator: "5" })).toEqual({
      ok: false, reasons: ["A locator (page, figure, …) belongs to one reference: select one, or insert the citations one at a time."] });
    expect(planInsert(libraryStore("ieee"), [])).toMatchObject({ ok: false });
    expect(planInsert(libraryStore("ieee"), ["nope"])).toEqual({ ok: false, reasons: ["“nope” is not in the reference library."] });
  });
  it("a locator is carried on the item", () => {
    const p = planInsert(libraryStore("ieee"), ["alpha"], { locator: "5-10", label: "page" });
    if (!p.ok) throw new Error("refused");
    expect(p.store.markers["1"]).toEqual([{ id: "alpha", locator: "5-10", label: "page" }]);
  });
});

/** Insert markers citing the given ids, in turn; returns the store. */
function withMarkers(style: StyleId, cites: string[][]): BibStoreData {
  let s = libraryStore(style);
  for (const ids of cites) {
    const p = planInsert(s, ids);
    if (!p.ok) throw new Error(p.reasons.join("; "));
    s = p.store;
  }
  return s;
}

describe("update: renumbering after a move, idempotence, every problem list by name", () => {
  it("IEEE: numbers follow document order; moving citation 3 first renumbers all; a second run changes nothing", () => {
    const store = withMarkers("ieee", [["alpha"], ["gamma"], ["delta"]]);
    const up1 = planUpdate(collectCitations(docControls(["1", "2", "3"]), [], "numeric"), store);
    if (!up1.ok) throw new Error(up1.reason);
    expect(up1.rewrites.map((r) => r.plain)).toEqual(["[1]", "[2]", "[3]"]);
    // The user cuts the third citation and pastes it first.
    const moved = docControls(["3", "1", "2"], { 1: "[1]", 2: "[2]", 3: "[3]" });
    const up2 = planUpdate(collectCitations(moved, [], "numeric"), store);
    if (!up2.ok) throw new Error(up2.reason);
    expect(up2.rewrites.map((r) => [r.markerId, r.plain])).toEqual([["3", "[1]"], ["1", "[2]"], ["2", "[3]"]]);
    expect(up2.plan.numbers).toEqual({ delta: 1, alpha: 2, gamma: 3 });
    expect(up2.ooxml).toContain(">[1]<");
    expect(up2.ooxml).toContain(">References<");
    const after = docControls(["3", "1", "2"], { 3: "[1]", 1: "[2]", 2: "[3]" });
    const up3 = planUpdate(collectCitations(after, [], "numeric"), store);
    if (!up3.ok) throw new Error(up3.reason);
    expect(up3.rewrites).toEqual([]);
    expect(up3.ooxml).toBe(up2.ooxml);
  });
  it("deleting a citation: its reference leaves the list, the store keeps the marker for Undo, both reported by name", () => {
    const store = withMarkers("ieee", [["alpha"], ["gamma"]]);
    const up = planUpdate(collectCitations(docControls(["2"]), [], "numeric"), store);
    if (!up.ok) throw new Error(up.reason);
    expect(up.plan.bibliography).toHaveLength(1);
    expect(up.report).toContain("Not cited (3), in the library but not in the document, so not listed: alpha, delta, epsilon.");
    expect(up.report).toContain("Deleted citations (1), no longer in the document (kept so Undo can restore them): 1.");
  });
  it("a copied citation, an unknown control and a missing record are each reported, never dropped", () => {
    let store = withMarkers("ieee", [["alpha"], ["gamma"]]);
    const lib = { ...store.library };
    delete lib.gamma;
    store = { ...store, library: lib };
    const up = planUpdate(collectCitations(docControls(["1", "1", "2", "zz"], { 2: "[9]", zz: "[7]" }), [], "numeric"), store);
    if (!up.ok) throw new Error(up.reason);
    expect(up.report).toEqual(expect.arrayContaining([
      "Missing from the library (1): “[9]” (marker 2) cites “gamma”, now shown as “[?]” so its old number cannot point at another reference. Re-import the reference, or delete the citation.",
      "Unknown citations (1), not in this document's reference store: “[7]” (marker zz). Left unchanged.",
      "Copied citations (1), the same marker more than once: 1. Every copy shows the same references.",
    ]));
    // Both copies of marker 1 are rewritten, the orphan becomes "[?]" in Word (its stale "[9]"
    // could otherwise name a renumbered reference), and the unknown control is left as it is.
    expect(up.rewrites.map((r) => [r.index, r.plain])).toEqual([[0, "[1]"], [1, "[1]"], [2, "[?]"]]);
  });
  it("defect 10: an orphan that still reads “[1]” is rewritten to “[?]”, never left colliding with the new [1]", () => {
    let store = withMarkers("ieee", [["alpha"], ["gamma"], ["delta"]]);
    const lib = { ...store.library };
    delete lib.gamma;
    store = { ...store, library: lib };
    const up = planUpdate(collectCitations(docControls(["2", "1", "3"], { 2: "[1]", 1: "[2]", 3: "[3]" }), [], "numeric"), store);
    if (!up.ok) throw new Error(up.reason);
    const shown = Object.fromEntries(up.rewrites.map((r) => [r.markerId, r.plain]));
    expect(shown).toEqual({ 2: "[?]", 1: "[1]", 3: "[2]" });
    // A second pass is quiet: the placeholder is stable.
    const again = planUpdate(collectCitations(docControls(["2", "1", "3"], { 2: "[?]", 1: "[1]", 3: "[2]" }), [], "numeric"), store);
    if (!again.ok) throw new Error(again.reason);
    expect(again.rewrites).toEqual([]);
  });
  it("ACS: superscript marker runs keep their formatting; the list label is (n)", () => {
    const store = withMarkers("acs", [["alpha", "gamma"]]);
    const up = planUpdate(collectCitations(docControls(["1"]), [], "numeric"), store);
    if (!up.ok) throw new Error(up.reason);
    expect(up.rewrites[0].runs).toEqual([{ text: "1,2", sup: true, sub: false, italic: false, bold: false }]);
    expect(up.ooxml).toContain(">(1)<");
    expect(markerRuns("<sup>1</sup> (p&#160;5)")).toEqual([
      { text: "1", sup: true, sub: false, italic: false, bold: false },
      { text: ` (p${String.fromCharCode(0xa0)}5)`, sup: false, sub: false, italic: false, bold: false },
    ]);
  });
  it("labels and headings per style", () => {
    expect(bibLabel("ieee")!(3)).toBe("[3]");
    expect(bibLabel("vancouver")!(3)).toBe("3.");
    expect(bibLabel("nature")!(3)).toBe("3.");
    expect(bibLabel("apa7")).toBeUndefined();
    expect(bibHeading("chicago-nb")).toBe("Bibliography");
  });
  it("APA: alphabetical, unnumbered; a style switch rewrites every marker when asked", () => {
    const store = withMarkers("apa7", [["gamma"], ["alpha"]]);
    const up = planUpdate(collectCitations(docControls(["1", "2"]), [], "author-date"), store);
    if (!up.ok) throw new Error(up.reason);
    expect(up.rewrites.map((r) => r.plain)).toEqual(["(Gamma, 2021)", "(Alpha & Beta, 2020)"]);
    const same = docControls(["1", "2"], { 1: "(Gamma, 2021)", 2: "(Alpha & Beta, 2020)" });
    const quiet = planUpdate(collectCitations(same, [], "author-date"), store);
    const all = planUpdate(collectCitations(same, [], "author-date"), store, { rewriteAll: true });
    if (!quiet.ok || !all.ok) throw new Error("refused");
    expect(quiet.rewrites).toEqual([]);
    expect(all.rewrites).toHaveLength(2);
  });
  it("Chicago notes: footnotes are planned first; a repeated source gets the short note", () => {
    const store = withMarkers("chicago-nb", [["alpha"], ["alpha"]]);
    const col = collectCitations([], docControls(["1", "2"]), "note");
    const up = planUpdate(col, store);
    if (!up.ok) throw new Error(up.reason);
    expect(up.rewrites).toHaveLength(2);
    expect(up.rewrites[1].plain.length).toBeLessThan(up.rewrites[0].plain.length);
    expect(up.rewrites[0].plain).toContain("Ann Alpha and Bob Beta");
    expect(up.ooxml).toContain(">Bibliography<");
  });
  it("footnotes unreadable, or citations split between text and notes: said, not hidden", () => {
    expect(collectCitations(docControls(["1"]), null, "numeric").notes).toEqual([
      "Footnotes were not read (this version of Word cannot read them); citations inside footnotes are not counted."]);
    const mixed = collectCitations(docControls(["1"]), docControls(["2"]), "numeric");
    expect(mixed.notes).toEqual(["1 citation is inside footnotes; they are numbered after the main text."]);
    expect(mixed.where).toEqual([{ in: "body", index: 0 }, { in: "note", index: 0 }]);
    expect(collectCitations([{ tag: "formula-inserter:citation", text: "x" }, ...docControls(["1"])], [], "numeric").where)
      .toEqual([{ in: "body", index: 1 }]);
  });
});

describe("a real Crossref export, end to end (the strings FEATURES.md quotes)", () => {
  const kwon = importBibText(fixture("crossref-kwon2022.bib")).records;
  const EXPECT: Record<string, { marker: string; ref: string }> = {
    ieee: {
      marker: "[1, p. 1842]",
      // Crossref fills url with the DOI link again; IEEE no longer prints it a second time
      // as "[Online]. Available: http://dx.doi.org/…" (review fix, v2.142.0).
      ref: "H. Kwon, “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life,” American Journal of Sociology, vol. 127, no. 6, pp. 1818–1859, May 2022, doi: 10.1086/720277.",
    },
    apa7: {
      marker: "(Kwon, 2022, p. 1842)",
      ref: "Kwon, H. (2022). Inclusion work: Children of immigrants claiming membership in everyday life. American Journal of Sociology, 127(6), 1818–1859. https://doi.org/10.1086/720277",
    },
    "chicago-ad": {
      marker: "(Kwon 2022, 1842)",
      ref: "Kwon, Hyeyoung. 2022. “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.” American Journal of Sociology 127 (6): 1818–59. https://doi.org/10.1086/720277.",
    },
  };
  it.each(["ieee", "apa7", "chicago-ad"] as StyleId[])("%s", (style) => {
    const store = mergeImport(emptyStore(style), kwon).store;
    const p = planInsert(store, ["Kwon_2022"], { locator: "1842", label: "page" });
    if (!p.ok) throw new Error(p.reasons.join("; "));
    const up = planUpdate(collectCitations(docControls(["1"]), [], style === "ieee" ? "numeric" : "author-date"), p.store);
    if (!up.ok) throw new Error(up.reason);
    expect({ marker: up.rewrites[0].plain, ref: up.plan.bibliography[0].plain }).toEqual(EXPECT[style]);
  });
});

describe("the document store", () => {
  it("no setting → a fresh store; damaged or newer → refused by name (the pane must not overwrite it)", () => {
    expect(loadBibStore(null, "acs")).toEqual({ ok: true, fresh: true, store: emptyStore("acs") });
    expect(loadBibStore("{not json")).toMatchObject({ ok: false });
    expect(loadBibStore(JSON.stringify({ version: 2, style: "ieee", library: {}, markers: {} })))
      .toEqual({ ok: false, reason: "This document's reference library is version 2, made by a newer JurisLab. Update JurisLab before editing its citations." });
    const s = withMarkers("ieee", [["alpha"]]);
    const ser = serializeStore(s);
    if (!ser.ok) throw new Error(ser.reason);
    expect(loadBibStore(ser.json)).toEqual({ ok: true, fresh: false, store: s });
  });
});
