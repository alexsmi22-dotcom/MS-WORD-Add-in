# Scope: citation styles, BibTeX/RIS/CSL-JSON import, and numbered bibliographies (hit-list item 11)

_Written 2026-10-14 against `main` at 07eefeb (v2.139.0). The A/V release was being integrated in the same tree at the time. Line numbers will drift, so each one is given with its function name. Planned as the release after audio/video (v2.141.0 if A/V ships as v2.140.0)._

_**Method.** This is a read-only audit of `src/lib/citations.ts` (771 lines), `src/lib/toa.ts` (879 lines), `src/lib/refs.ts` and the Citations handlers in `taskpane.ts`, plus about 75 probe calls through the lib exports. The probes were three throwaway jest files. Each one was copied into `src/lib/__tests__/zz-citeprobe.test.ts`, run with `node scripts/run-jest.js zz-citeprobe`, and deleted at once. **No file in the tree was changed except this one.** Outputs quoted in §B are verbatim. Items marked **(code-read)** come from reading the pane handler and could not be run, because nothing can import `taskpane.ts`. They need a Word pass to confirm._

_Wrong answers come first. §B is the work order for Builder 1, and it should ship whether or not the rest of this brief does._

---

## A. What exists

**Engines (pure, no Office.js):**
- **`citations.ts`**
  - **Types and registry.** `CitationType` / `CitationField` / `CitationResult {plain, html}`, plus `CITATIONS`: 12 Bluebook types (case, case-short, id, supra, usc, cfr, patent, patent-app, fedreg, mpep, article, book).
  - **Style switch.** `CitationStyle = "practitioner" | "academic"`. Academic uses small caps via `<span style="font-variant: small-caps">`.
  - **Formatting helpers.** `formatDate`, `formatPatentNumber`, `formatPublicationNumber`, `normalizeReporter` / `isKnownReporter` (`REPORTER_NAMES`, exported to toa.ts), `normalizeCourt`, `SIGNALS` / `applySignal`.
  - **Name helpers.** `abbreviateCaseName` (T6 + T10 with the named-party exception) and `caseShortForm`.
  - **Paste parser.** `parseCitation`: ordered `DETECTORS` (statute → cfr → fedreg → mpep → patent-app → patent → case → article).
- **`toa.ts`**
  - **Scanner.** A reporter-anchored `CASE_RE` (bounded `PARTY` grammar), `UNPUB_RE` (WL/LEXIS), and STATUTE/CFR/PATENT/FEDREG/MPEP/RULE regexes with the USPTO Rule 130–132 and local-rule guards.
  - **Table builders.** `buildTableOfAuthorities`, `citationRegister`, `toaToHtml`, `toaStaticOoxml` (static brief-template OOXML with dot leaders), `parseToaPages` (reads Word's F9'd TOA back).
  - **Native fields.** `authoritiesForToa` → `ToaMark {long, name, rest, category, categoryNum, locator}`. Also `taFieldOoxml` (TA fields with an italic name run), `toaFieldsOoxml` (`TOA \c "N" \p`), `tocFieldOoxml` (`TOC \o "1-N" \h \z \u`), `isTaFieldCode`, `isTableFieldCode`.
  - **Short forms.** `findPrecedingAuthority` (Id.), `findPrecedingSecondarySource` (supra), `caseShortName`, `toaOccurrences` (full, short and Id. occurrences, with Id. resolved by position).
- **`refs.ts`:** figure/table captions and cross-reference checks. Caption counters live in pane state, not in the document, so there is **no document-derived renumbering precedent** to copy.

**Tests:** `citations.test.ts` (473 lines, 18 describes), `citationsCoverage.test.ts`, `toa.test.ts` (446), `toaShortForms.test.ts`, plus mentions in `legalFalsePositives`, `networkSurface`, `reachability`, `tier0Defects`. **Every expected string was written by the author.** None is quoted from a manual, which the v1.13.0 memory already admits.

**Pane (taskpane.ts, Citations mode, "Legal citations" home group, audience `legal`):**
- **Form.** `populateCitationTypes` / `renderCitationInputs` / `updateCitationPreview` (T6 toggle applied inside `read()`; unknown-reporter warning).
- **Insert.** `insertCitation` does `insertHtml`, then `tagInserted(…, "formula-inserter:citation")`. `copyCitation` copies the plain text.
- **Helpers.** `parseAndFillCitation`, `insertIdForPreceding`, `detectSupraSource`.
- **TOC.** `buildTocHandler`.
- **TOA.** `buildNativeToaHandler`: clears the TA fields, runs `toaOccurrences`, then `body.search(needle,{matchCase:false})` and inserts a TA field **before** every hit. The TOA fields are wrapped in a content control tagged `jurislab:toafield`. `buildToaHandler` handles the static list; it replaces the `jurislab:toafield` control or inserts and tags `formula-inserter:toa`. `clearCitationMarksHandler`, `clearTablesHandler`, `findCitationsHandler` and `copyRegister` complete the set.

**How citations are stored in Word.** `tagInserted` wraps the range in a hidden content control with title `"JurisLab"` and a tag string. Nothing else is stored:
- **Tags in use here:** `formula-inserter:citation` (every Bluebook cite and Id.), `formula-inserter:toa` (static TOA), `jurislab:toafield` (field-TOA wrapper, set directly at `buildNativeToaHandler` → `cc.tag = TOA_FIELD_CC_TAG`).
- **HARD RULE:** **no `formula-inserter:*` tag may change**, nor `jurislab:toafield`. Documents in the field carry them. New tags are added; old ones are only ever read.
- **Consequence for this release:** an inserted citation stores only its rendered HTML. It has **no source record, no key, no style**. "Build the bibliography from the document's citation controls" is impossible with today's data, so the new citations need a key in the tag and a record store (§C4).
- **Per-document store precedent:** `Office.context.document.settings` already holds `NUMERALS_SETTING` and `REFS_SETTING` (`saveAsync`). The bibliography library goes there too.
- **Missing (grep 2026-10-14):** no DOI, BibTeX, RIS, CSL, bibliography or reference-list code anywhere in `src/`. `docs/OPEN-ITEMS.md` item 18: "Zero footprint. Citations today are Bluebook legal only."

---

## B. Live defects in the shipped Citations/TOA code

Severity order: wrong page numbers in a filed TOA, then wrong text in a filed brief, then silent omission, then honest refusal.

### B1. Wrong pages attached to authorities in the native TOA (code-read in `buildNativeToaHandler`)

| # | Input | Today | Correct |
|---|---|---|---|
| 1 | `Doe v. Roe, 10 F.3d 5 (9th Cir. 1993). Smith v. Jones, 110 F.3d 512 (2d Cir. 1997).` | The lib is safe, because `toaOccurrences` drops contained hits. But the pane calls `body.search("10 F.3d 5")`, which is a **substring** search. It also hits inside `110 F.3d 512`, so Doe v. Roe gets every page that cites Smith v. Jones. The same happens for `35 U.S.C. § 10` inside `§ 101`, and `§ 1` inside `§ 103`. | Search with boundaries, or (better) place TA fields **by offset** from `toaOccurrences` instead of re-searching by string. |
| 2 | Brief with Alice, then a bare `Id.` (every Id. refers to Alice), and the words `said.` / `paid.` / `valid.` elsewhere | The occurrence text `Id.` has one owner, so the pane runs `body.search("Id.", {matchCase:false})`. That matches the `id.` in `said.` and `paid.` and **marks those pages for Alice**. (Probe: `toaOccurrences` returns two `["id","Id.",Alice]`; the substring hit happens only in Word.) | `matchCase: true, matchWholeWord: true`, or offset-based placement as in #1. |
| 3 | `…Int’l, 573 U.S. 208 (2014). …Int'l, 573 U.S. 208, 216 (2014).` (curly and straight apostrophes; Word autocorrects to curly, while pasted text keeps straight) | Two TOA rows: `Alice Corp. v. CLS Bank Int'l, …` and `Alice Corp. v. CLS Bank Int’l, …`. **Both marks have locator `573 U.S. 208`, so `owners.size === 2` and the pane skips that locator entirely. Alice gets zero pages** and is counted as "unattributed". | One row. Normalize `’‘` → `'` in `dedupe` (`toaEntryKey` already does this). |
| 4 | Word's TOA with `\p` (which `toaFieldsOoxml` emits) prints `passim` for 5+ pages; then click "Insert formatted list" | `parseToaPages("35 U.S.C. § 101\tpassim")` → **no entry**. `PAGE_LIST_RE` accepts only digits and roman numerals, so the most-cited authority gets a **blank** page slot. | `passim` accepted as a page string. |
| 5 | `In re Wands, 858 F.2d 731, 737 (Fed. Cir. 1988). … Wands, 858 F.2d at 740. … In re Wands, 858 F.2d at 741.` | `caseShortName("In re Bilski")` → `null`, so neither short form is found (probe: one `full` occurrence only). **Short-cite pages are missing for every In re / Ex parte case**, which is the Federal Circuit's staple form. | Short name = the party after `In re` / `Ex parte`, with or without the prefix. |

### B2. Wrong text in the table or the inserted citation (all probed)

| # | Input | Output | Correct |
|---|---|---|---|
| 6 | TOA: `eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)` | `Bay Inc. v. MercExchange, …`, sorted under B and written into the TA `\l` text | `eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)` |
| 7 | TOA: `iRobot Corp. v. SharkNinja Operating LLC, 19 F.4th 1 …`; `de Vries v. Doe, 1 F.3d 1 (1990)` | `Robot Corp. v. …`; `Vries v. Doe, …` | Names intact. `PARTY` requires `[A-Z]` as the first character. |
| 8 | TOA: `35 U.S.C. §§ 102, 103.` | `35 U.S.C. § 102` only. **§ 103 is silently dropped.** In a patent brief that is the obviousness statute. | Both sections are listed, or one `§§ 102, 103` entry. |
| 9 | TOA: `37 C.F.R. §§ 1.97–1.98` (also `35 U.S.C. §§ 102–103`) | `37 C.F.R. § 1.97–1.98` (singular § before a range) | `37 C.F.R. §§ 1.97–1.98`. The builder already has `sectionSymbol()`; reuse it. |
| 10 | TOA: `U.S. Patent No. 7,469,381` and `U.S. Patent No. 7469381` | Two rows, which also means two owners for the locator (see #3) | One row, keyed on digits only. |
| 11 | Form: Patent number `US10123456B2` or `US 10,123,456 B2` (the Google Patents display form) | `U.S. Patent No. US10,123,456` | `U.S. Patent No. 10,123,456`. Strip a `US` country prefix and a kind code. |
| 12 | "→ Short form" button on `United States v. Alvarez`, 567 U.S., pin 715 | `caseShortForm` → name `United States` → `United States, 567 U.S. at 715` | `Alvarez, 567 U.S. at 715` (R10.9). `toa.ts caseShortName` already gets this right. **The two implementations disagree, so delete one.** |
| 13 | T6 toggle on: `United States of America v. Microsoft Corporation` | `United States of Am. v. Microsoft Corp.` | `United States v. Microsoft Corp.` (R10.2.2) |
| 14 | Form: Law review article, using the field placeholders as shipped (vol `2013`, Wis. L. Rev., 905, pin 912, year 2013) | `…, 2013 Wis. L. Rev. 905, 912 (2013)` | `…, 2013 Wis. L. Rev. 905, 912`. When the volume is the year, the date parenthetical is omitted. **The shipped placeholder demonstrates the wrong form.** Confirm the rule number against R16.4 before pinning. |

### B3. Paste parser mis-fills the form (probed; the user reviews the fields, so this is lower than B1/B2)

| # | Pasted | Parsed | Correct |
|---|---|---|---|
| 15 | `85 Fed. Reg. 12,345 (Mar. 1, 2020) (to be codified at 37 C.F.R. pt. 1)` | type **cfr**, section `pt. 1)` | type fedreg. `detectCFR` runs before `detectFedReg`; order them FedReg first. |
| 16 | `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 134 S. Ct. 2347 (2014)` | name `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208`, vol 134 S. Ct. The primary cite is italicized as part of the name. | name `Alice…Int'l`, 573 U.S. 208, parallel `134 S. Ct. 2347` |
| 17 | `In re Fisher, 421 F.3d 1365, 76 USPQ2d 1225 (Fed. Cir. 2005)` | name `In re Fisher, 421 F.3d 1365`, reporter U.S.P.Q.2d | Same fix as #16 (anchor at the first `vol reporter page`) |
| 18 | `U.S. Pat. No. 7,469,381, col. 3, ll. 15-20 (issued …)` | pin `col. 3`. **The line range is silently lost.** | `col. 3 ll. 15–20` |
| 19 | `…, 573 U.S. 208, 216 n.3 (2014)`; `…, 573 U.S. 208, 216, 220 (2014)`; `…, No. 13-cv-1, 2015 WL 123456, at *3 (D. Del. …)`; `US 10,123,456 B2` | `null` ("couldn't recognize") | Recognized. The TOA scanner already accepts `n.3` and WL forms, so the paste parser should share its grammar. |
| 20 | `The Office relied on 37 C.F.R. § 1.56 and Rule 132.` | section `1.56 and Rule 132` | Section `1.56`. Stop at the first non-section token. |

### B4. Omissions and latent defects (not wrong output; list them, and fix them if cheap)

- **PTAB decisions without a WL number:** `Ex parte Jones, Appeal 2018-005678 (P.T.A.B. Mar. 3, 2019)` is **absent from the TOA**. The WL form is kept but its docket number is dropped: `Ex parte Smith, 2020 WL 1234567 (P.T.A.B. …)`. Check R10.8.1 before calling the dropped docket a defect.
- **Case form with no year:** renders `… 573 U.S. 208 ()`. This is latent, because the pane requires the year.
- **T6 coverage gaps:** Southern, Railway, Labor and similar words are not abbreviated (`Kan. City Southern Railway Co.`). Probe outputs that are arguably correct Bluebook and are **not** listed as defects: `Tex. Instruments`, `Bank of Am.`, `George Wash. Univ.`. Verify any T6 additions against the table itself, not from memory.
- **`In re` sorting:** `sortKey` strips `In re`, so `In re Bilski` files under B. Bluebook is silent on this, and many firms file such cases under "I". Make it a preference, not a fix.

**Regression rule for Builder 1:** every row above becomes a pinned test that uses the exact input bytes in the table, curly apostrophes included.

---

## C. Scope for the release

### C1. Styles, ranked for these users

Patent attorneys cite non-patent literature in specs, IDS-backed arguments and declarations. Grad students in chemistry, bio, optics and engineering write papers and theses.

| Rank | Style | Who | Kind | Wave |
|---|---|---|---|---|
| 1 | **ACS** (ACS Guide) | chemistry; the core of JurisLab's chem audience | numeric (superscript or italic) or author-date | 1 |
| 2 | **IEEE** | EE, optics (Optica's style is close), engineering, CS | numeric `[1]` | 1 |
| 3 | **Vancouver / NLM** (*Citing Medicine*) | bio, biomedical, pharma patent declarations | numeric | 1 |
| 4 | **Nature** | bio, chem and physics journals | numeric superscript | 1 |
| 5 | **APA 7** | bio-adjacent, psych, education, many theses | author-date | 1 |
| 6 | **Chicago author-date** (CMOS 18) | theses, humanities-adjacent | author-date | 2 |
| 7 | **Harvard**: no canonical manual. Pick **Cite Them Right (12th ed.)** and name it in the UI as "Harvard (Cite Them Right)". | UK and Commonwealth students | author-date | 2 |
| 8 | **Chicago notes-bibliography** | law-adjacent and history | **notes**, gated on footnotes (§E) | 2 |
| 9 | **MLA 9** | rare for these users | author-page | 2 |

**Item types in scope:** article-journal, book, chapter, paper-conference, thesis, report, webpage, dataset, preprint, and **patent**. Every style must format a patent, because these users cite patents in technical papers. IEEE and ACS both define a patent form.

### C2. Import (all offline)

- **BibTeX.**
  - **Syntax:** `@type{key, field = {…} | "…" | number | macro # concat}`, `@string`, `@preamble` (ignored), `@comment`, and an unbalanced-brace refusal *by line*.
  - **crossref** inheritance: an `@inproceedings` child takes booktitle, editor and year from an `@proceedings` parent. biblatex `xdata` is out of scope.
  - **LaTeX:** accents to Unicode (`{\"o}`, `\'e`, `{\v{c}}`, `\ss`, `{\aa}`, `\c{c}`, `\l`, `--` → en dash, `---` → em dash, `~` → NBSP). Math-mode subscripts (`H$_2$O`, `$_2$`, `\textsubscript{2}`) become `H₂O`.
  - **Brace-protected spans** (`{pH}`, `{DNA}`, `{NMR}`) become CSL `<span class="nocase">…</span>`, so case conversion leaves them alone.
  - **Names:** split on top-level ` and `, then the three BibTeX forms: `First von Last`, `von Last, First`, `von Last, Jr, First`. The **von** particle is the run of lowercase-initial words (`van der Waals`, `de la Fontaine`; `Ludwig van Beethoven` → particle "van"). Braces protect corporate authors (`{World Health Organization}` → `literal`). `and others` → et al. flag.
  - **Months:** `jan`…`dec` macros.
  - **Keys:** used as record ids; duplicates are refused by name.
- **RIS:** `TY`/`ER` blocks, `AU`/`A1` (one per line, `Last, First`), `TI`/`T1`, `JO`/`JF`/`T2`/`JA`, `VL`, `IS`, `SP`/`EP`, `PY`/`DA` (`YYYY/MM/DD/`), `DO`, `UR`, `PB`, `SN`, and `TY - PAT` for patents. Tolerate CRLF and the `ER  -` variants. Record types outside the table are refused by name.
- **CSL-JSON:** this is the internal record format, so import validates and passes it through. Zotero and Mendeley export it, and so does the doi.org content negotiation that users can run themselves.
- **Pasted DOI, offline. Say this in the UI.** `doi:10.…`, `https://doi.org/10.…` and `dx.doi.org` forms are recognized, normalized, and formatted as `https://doi.org/<doi>`. **No metadata is fetched**, because the product is offline (precaching service worker) and `networkSurface.test.ts` polices the network surface. The DOI fills one field and the form asks for the rest. Suggested UI line: "JurisLab works offline, so it can't look a DOI up. Paste the reference's BibTeX or RIS from the publisher page to fill everything."
  - Recognize with the Crossref-recommended pattern `10.\d{4,9}/[-._;()/:A-Z0-9]+` (case-insensitive), then trim trailing punctuation.

### C3. Bibliographies

- **Numbering.**
  - **Numeric styles** (IEEE, Vancouver, ACS numeric, Nature) number by first citation in document order.
  - **Author-date styles** (APA, Chicago AD, Harvard, MLA) sort alphabetically: family name, then given, then year, then title, with `2020a`/`2020b` disambiguation.
- **In-text markers:**
  - IEEE `[1]`, `[1], [3]`, `[2]–[4]`.
  - Vancouver `(1)` or superscript, with ranges `1–3`.
  - ACS superscript `¹` or italic `(1)`.
  - Nature superscript.
  - APA `(Smith & Jones, 2020)` and narrative `Smith and Jones (2020)`.
  - Chicago AD `(Smith 2020, 45)`.
  - Locators (page, figure, equation) pass through.
  - Range compression happens only for 3 or more consecutive numbers.
- **Re-numbering.** One "Update citations" button handles a citation that was moved, added or deleted. It enumerates the cite controls in document order, recomputes the numbers, rewrites each marker's text inside its control, and rewrites the bibliography block. It is idempotent, and a second run changes nothing.
- **Bibliography from the document.** Only references actually cited get listed. A library entry that is never cited is reported, not printed. A control whose key is missing from the library is reported by marker text, never dropped.

### C4. Storage design (additive; old tags untouched)

- **Marker control:**
  - **Tag:** `formula-inserter:cite:<markerId>`, where markerId is a short base-36 counter.
  - **The tag does not hold the citekeys.** Word caps a tag's length (reportedly 64 characters), and a multi-cite marker would overflow it. **The integrator must verify that limit in Word before relying on any length.**
  - **Title:** `JurisLab citation`.
- **Bibliography block:** tag `formula-inserter:bibliography`.
- **Store:** document settings key `jurislab.bib.v1` = `{ version: 1, style, library: Record<id, BibRecord>, markers: Record<markerId, CiteItem[]> }`.
- **Enumeration:** `getByTag` is exact-match, so enumeration is `body.contentControls.load("items/tag,items/text")` filtered by prefix. That collection comes back in document order.
- **Footnotes** are NOT in `body.contentControls`. Chicago NB needs `body.footnotes` (WordApi 1.5) and each footnote's `body.contentControls`. Gate it on `wordApiSupported("1.5")`, and refuse by name below that.

### C5. Decision: a hand-written formatter per style on a CSL-JSON record, no CSL processor

- **citeproc-js is dual-licensed CPAL 1.0+ or AGPL 3.0+** (`LICENSE` in Juris-M/citeproc-js, fetched 2026-10-14).
  - Both options impose attribution/network-use obligations on a distributed web add-in.
  - **citation-js is MIT**, but its CSL output plugin `@citation-js/plugin-csl` depends on `citeproc ^2.4.6` (package.json fetched 2026-10-14). That is citeproc-js again, so it carries the same licence.
- **CSL style files** (citation-style-language/styles) are "released under the Creative Commons Attribution-ShareAlike 3.0 Unported license." Bundling them, or transliterating them into code, would make our style code a share-alike adaptation. **Do not bundle or translate the CSL XML.** Write each style from its manual, with the manual examples as oracles.
- **Why a mini CSL processor is also rejected:**
  - Nine styles do not justify a CSL interpreter (macros, `<choose>`, locale terms, disambiguation).
  - The runtime footprint today is three dependencies.
  - The precache bundle grows with every byte.
  - The display contract (H₂O, `<span class="nocase">`, small caps) is easier to guarantee in about 120 lines of TypeScript per style than through a generic renderer.
- **What keeps the door open:** the record **is** CSL-JSON (field names verbatim). If a CSL processor is ever licensed or written, the data layer does not change.

### C6. Oracles (quote these verbatim in the style tests)

**Fetched 2026-10-14:**
- **Chicago 18th, Citation Quick Guide** (chicagomanualofstyle.org/tools_citationguide/citation-guide-1.html):
  - B: `Kwon, Hyeyoung. “Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life.” American Journal of Sociology 127, no. 6 (2022): 1818–59. https://doi.org/10.1086/720277.`
  - N: `1. Hyeyoung Kwon, “Inclusion Work: …,” American Journal of Sociology 127, no. 6 (2022): 1842–43, https://doi.org/10.1086/720277.`
  - Short note: `5. Kwon, “Inclusion Work,” 1851.`
  - Two authors (B): `Dittmar, Emily L., and Douglas W. Schemske. “Temporal Variation in Selection Influences Microgeographic Local Adaptation.” American Naturalist 202, no. 4 (2023): 471–85. https://doi.org/10.1086/725865.`
  - Seven authors (B): `Snyder, Carl D., Manuel Bedrossian, Casey Barr, et al. “Extant Life Detection …” PLOS ONE 20, no. 3 (2025): e0318239.` In CMOS 18, the bibliography lists 3 names then et al. for 7 or more authors, and the note uses first author et al. Page ranges are **elided** (1818–59).
- **NLM / ICMJE Sample References** (nlm.nih.gov/bsd/uniform_requirements.html):
  - `Halpern SD, Ubel PA, Caplan AL. Solid-organ transplantation in HIV-infected patients. N Engl J Med. 2002 Jul 25;347(4):284-7.`
  - More than six authors: `Rose ME, Huerbin MB, Melick J, Marion DW, Palmer AM, Schiding JK, et al. …`
  - The page says to list the first six authors then et al., and notes that NLM now lists all of them. **Make the threshold an option, defaulting to six.** Pages are elided with a hyphen (`284-7`).
- **MLA, Purdue OWL** (owl.purdue.edu, works cited: periodicals): `Bagchi, Alaknanda. "Conflicting Nationalisms: The Voice of the Subaltern in Mahasweta Devi's Bashai Tudu." …`. Fetch the full entry at build time.

**Blocked or not fetched this session. Builder 3 must fetch these and quote them with URL and date before pinning any string:**
- **APA 7:** apastyle.apa.org journal-article examples. The page returned empty to the fetcher. The canonical example 1 is Grady et al. (2019), *Psychology of Popular Media Culture*, 8(3), 207–217, https://doi.org/10.1037/ppm0000185. That is from memory, so verify it.
- **IEEE Reference Guide:** the ieeeauthorcenter PDF now redirects to a Google Doc. Secondary guides disagree on whether "6 or more" or "more than 6" triggers et al., so **settle that from the primary source.**
- **ACS Guide:** pubs.acs.org/doi/10.1021/acsguide.40303 returned 403. The author format uses semicolons (`Author, A. B.; Author, C. D.`), the year is bold and the volume italic, e.g. `J. Am. Chem. Soc. **2020**, *142*, 1234–1240.` That pattern is from memory, so verify it, including the all-authors rule.
- **Nature:** the formatting guide redirects to a login. The reported rule is first author et al. above five authors. Verify it.
- **Harvard (Cite Them Right 12th):** quote from the book or the publisher's site.

**Rule:** a style ships only with **at least three verbatim manual examples** pinned per item type it claims (journal, book, patent). A style without them ships disabled in the dropdown with the reason shown.

---

## D. Builder split (disjoint files; the contract below is frozen before anyone starts)

**Frozen contract, `src/lib/bibRecord.ts`.** Builder 2 creates it verbatim on day 0, and nobody else edits it:
```ts
export interface BibName { family?: string; given?: string; "non-dropping-particle"?: string;
  "dropping-particle"?: string; suffix?: string; literal?: string; }
export interface BibDate { "date-parts"?: Array<[number, number?, number?]>; literal?: string; }
export type BibType = "article-journal" | "book" | "chapter" | "paper-conference" | "thesis" | "report"
  | "webpage" | "dataset" | "article" | "patent";
export interface BibRecord { id: string; type: BibType; title?: string; "container-title"?: string;
  "container-title-short"?: string; author?: BibName[]; editor?: BibName[]; issued?: BibDate;
  volume?: string; issue?: string; page?: string; "article-number"?: string; DOI?: string; URL?: string;
  publisher?: string; "publisher-place"?: string; edition?: string; number?: string; authority?: string;
  genre?: string; accessed?: BibDate; "et-al-in-source"?: boolean; }
// Rich text in title/container-title: only <i> <b> <sub> <sup> <span class="nocase">. Unicode (H₂O) verbatim.
export interface CiteItem { id: string; locator?: string; label?: "page" | "figure" | "equation" | "chapter";
  prefix?: string; suffix?: string; suppressAuthor?: boolean; }
export interface Formatted { plain: string; html: string; }
export type StyleId = "acs" | "ieee" | "vancouver" | "nature" | "apa7" | "chicago-ad" | "chicago-nb" | "harvard-ctr" | "mla9";
export interface BibStyle { id: StyleId; name: string; kind: "numeric" | "author-date" | "note";
  order: "citation" | "alphabetical";
  reference(r: BibRecord, n?: number): Formatted;
  marker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>, opts?: { narrative?: boolean }): Formatted;
  note?(rec: BibRecord, item: CiteItem, first: boolean): Formatted; }
export interface ImportResult { records: BibRecord[]; refused: Array<{ line: number; reason: string }>; }
```

**Builder 1: fix the shipped legal code.**
- **Owns:** `src/lib/citations.ts`, `src/lib/toa.ts`, `citations.test.ts`, `toa.test.ts`, `toaShortForms.test.ts`, `citationsCoverage.test.ts`, and a new `citationsLive.2026-10.test.ts`.
- **Work:** every §B row as a pinned test using the exact input. Add `placeTaByOffset(occurrences)`, a pure helper that returns the per-occurrence `{index, length, markIndex}` the pane needs to stop re-searching. Merge `caseShortForm` onto `caseShortName`.
- **Accepts when:**
  - B1 #1–#5 and B2 #6–#14 are green.
  - Pane-level #1/#2 have a lib-side helper plus a TEST-SCRIPT step for the integrator.
  - The existing suites are unchanged.

**Builder 2: importers.**
- **Owns:** `bibRecord.ts` (the contract), `bibtex.ts`, `ris.ts`, `cslJson.ts`, `doi.ts`, `latexUnicode.ts`, `bibNames.ts`, and tests `bibtex.test.ts`, `ris.test.ts`, `bibNames.test.ts`, `doi.test.ts`, `bibImport.adversarial.test.ts`.
- **Accepts when:**
  - The BibTeX name forms are pinned: `Ludwig van Beethoven`, `van Beethoven, Ludwig`, `{van} Beethoven, L.`, `Martin Luther King, Jr.` written as `King, Jr., Martin Luther`, `{World Health Organization}`, `Jean-Paul Sartre`, `de la Fontaine, Jean`, and `and others`.
  - `@string` and `#` concatenation work, and `crossref` inherits from the parent.
  - `{pH}` and `{NMR}` become nocase spans, and `H$_2$O` becomes `H₂O`.
  - Unbalanced braces are refused with a line number.
  - A RIS export from Zotero and one from EndNote, as real byte samples saved under `__tests__/fixtures/`, round-trip.
  - The DOI tests cover all three paste forms and trailing punctuation, and assert that no network call is made.
  - **No new runtime dependency.**

**Builder 3: styles and case conversion.**
- **Owns:** `bibStyles.ts` (one `BibStyle` per id), `bibCase.ts` (sentence and title case, protected spans), `bibPages.ts` (en-dash and elision rules per style), `journalAbbrev.ts` (only `container-title-short`, never invented), and tests `bibStyles.oracle.test.ts`, `bibCase.test.ts`, `bibPages.test.ts`.
- **Accepts when:**
  - Each Wave-1 style has 3 or more manual quotes per item type, with URL and fetch date in a comment.
  - Every style's et al. threshold is pinned at its boundary (n and n+1 authors).
  - The case tests cover pH, NMR, DNA, *trans*-, *p*-, *N*-methyl, *E*/*Z*, *tert*-, and CO₂.
  - Display contract: `H₂O` survives every style in both plain and html, and no output contains `H2O` or `^`.

**Builder 4: bibliography assembly.**
- **Owns:** `bibliography.ts` (numbering, ordering, `2020a`/`2020b` disambiguation, range compression, `renumberPlan(markersInDocOrder, store) → {markerId → newText, bibliography: Formatted[]}`), `bibStore.ts` (serialize/parse `jurislab.bib.v1` with a version guard and size check), `bibOoxml.ts` (hanging-indent bibliography block), and tests `bibliography.test.ts`, `bibStore.test.ts`.
- **Accepts when:**
  - Moving marker 3 before marker 1 renumbers all of them, and the plan is idempotent.
  - Uncited library entries and orphan markers are reported, not dropped.
  - `[1], [2], [3]` compresses to `[1]–[3]`, and `[1], [3]` stays as written.
  - Alphabetical sorting handles particles (APA files "van Beethoven" under V. Chicago lets it vary, so make it a per-style flag pinned to its manual).
  - The OOXML parses in jsdom.

**Integrator.**
- **Owns:** `taskpane.ts`, `taskpane.html`, `examples.ts`, `docs/TEST-SCRIPT.md`, `FEATURES.md`.
- **Starts only after the A/V release has landed**, since that agent is editing `taskpane.ts` now.
- **Work:**
  - A new "References" panel inside Citations mode: import (paste or file), library list, style dropdown, insert marker, "Update citations & bibliography", insert bibliography.
  - Wire B1's offset placement into `buildNativeToaHandler`.
  - The new tags from §C4.
  - The home tile reaches the STEM audience too, not only `legal`.
- **Accepts when:**
  - A `reachability` test covers every new button.
  - The TEST-SCRIPT section includes a Word pass for the tag-length limit, footnote enumeration, and renumbering after cut and paste.
  - The full suite passes, followed by an independent adversarial pass over the diff (HARD RULE).

---

## E. Risks

- **Name parsing.**
  - Particles: `van`, `von`, `de`, `de la`, `di`, `da`, `le`, `ter`. APA says "van Gogh" files under V when the particle is part of usage; Chicago lets this vary. Keep `dropping-particle` and `non-dropping-particle` distinct.
  - Suffixes: `Jr.`, `III`, `Sr.`.
  - Compound family names: `García Márquez`, Spanish double surnames.
  - East Asian order: `Zhang Wei` must not be flipped when entered family-first; trust the field split and never guess.
  - Hyphenated initials: `J.-P. Sartre`.
  - Initials without periods: Vancouver `SD`, APA `S. D.`.
  - Corporate authors (`literal`) must never be initialized: not `W. H. Organization`.
- **Sentence case vs title case.**
  - APA, Harvard and Vancouver sentence-case article titles. A naive lowercaser corrupts `pH`, `NMR`, `DNA`, `CRISPR–Cas9`, `MoS₂`, `GaN`, `Escherichia coli` (the genus stays capitalized), and stereodescriptors `(R)`, `(S)`, `(E)`.
  - **Rule:** sentence-casing touches only words whose original casing is Title (`Xxxx`). Leave mixed-case words, all-caps acronyms, words with digits or subscripts, and nocase spans alone. Italic locants and prefixes (`trans-`, `cis-`, `p-`, `o-`, `m-`, `N-`, `tert-`, `sec-`) keep their case, and stay lowercase/italic even at a sentence start (ACS lowercases them after a capitalized first letter of the next word: `*trans*-Stilbene`).
  - Title case (Chicago, MLA) must not capitalize those prefixes either.
- **Page ranges.**
  - En dash (U+2013), not a hyphen, everywhere except NLM, which uses a hyphen with elision (`284-7`).
  - Chicago elides (`1818–59`). APA and IEEE give full numbers.
  - Article numbers (`e0318239`) are not ranges. Never elide alphanumeric pages.
- **et al. thresholds** differ per style and per context (reference list vs in-text). Pin each one at n and n+1, and verify from the primary sources in §C6:
  - **APA 7:** up to 20 authors in the reference list; 21+ → 19, an ellipsis, then the last author. In-text, 3+ authors → et al.
  - **CMOS 18:** see §C6.
  - **NLM:** 6, configurable.
  - **IEEE:** about 6 (unsettled).
  - **Nature:** about 5.
  - **MLA 9:** 3+ authors → et al.
  - **Harvard CTR:** 4+ authors → et al.
  - **ACS:** all authors.
  - **BibTeX `and others`** forces et al. even below the threshold. Never fabricate the missing names.
- **Unicode and the display contract.**
  - `H₂O`, `CO₂`, `¹³C`, `µ`, `Å` and Greek in titles must survive import, case conversion, HTML escaping and OOXML.
  - Formatters never ASCII-fold. The BibTeX `$_2$` → `₂` mapping covers only digits and the characters that have Unicode subscripts. Anything else stays as `<sub>`, never as `_` or `^`.
  - NFC-normalize at import, so `é` written as e + U+0301 and the precomposed `é` collate the same way.
- **Journal abbreviations.** ACS, NLM and IEEE want abbreviated titles. Use `container-title-short` when the source has it. Otherwise print the full title and flag it; **never invent an ISO-4 abbreviation.** Any bundled list needs a licence check (NLM catalog data is public domain; the CASSI and ISSN LTWA terms need checking).
- **Word mechanics.**
  - The tag-length limit, enumerating content controls in footnotes, Word Online vs desktop parity for `document.settings` size, and markers deleted by the user (orphan library entries).
  - Undo after a renumber touches many controls. Run it in a single `Word.run` so one Ctrl+Z reverts it, and confirm that in Word.
- **Scope creep.** No live DOI lookup, no Zotero connector, no CSL file import. Each one is a network or licence decision for the user, not for a builder.
