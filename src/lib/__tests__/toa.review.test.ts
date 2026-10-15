// Independent adversarial review — v2.141.0 "Table of Authorities and Bluebook fixes".
//
// Scope: src/lib/toa.ts, src/lib/citations.ts, buildNativeToaHandler in
// src/taskpane/taskpane.ts. Inputs are the kind of text a patent litigator
// types in Word or pastes from Westlaw/Lexis.
//
//  - plain `it`    — a REAL defect that FAILS today. Each one carries: input,
//                    output today, correct output (with the Bluebook rule),
//                    why it matters in a filed brief, and the owning file.
//                    Tagged REGRESSION (worse than HEAD before v2.141.0) or
//                    PRE-EXISTING. During the review the HEAD sources were
//                    transpiled in memory and diffed against v2.141.0 on an
//                    ordinary-cite corpus (authoritiesForToa AND toaOccurrences:
//                    no occurrence HEAD found was lost). The §§, Westlaw, NBSP,
//                    patent and en-dash labels come from that run; the Id.,
//                    sentence-glue, Pennock, MPEP, WL-docket, Myriad and App'x
//                    labels come from reading the unchanged code paths.
//  - `it.failing`  — cosmetic / contested items (green today because the
//                    assertion fails).
//  - passing `it`  — confirmed-correct probes of the fixes (at most 10).
//
// Rule numbers are from the Bluebook (21st ed.); where marked "(verify)" the
// number should be checked against the current edition before it is pinned.

import * as fs from "fs";
import * as path from "path";
import {
  authoritiesForToa,
  buildTableOfAuthorities,
  findPrecedingAuthority,
  parseToaPages,
  taSearchPlan,
  toaFieldsOoxml,
  toaOccurrences,
  type ToaMark,
  type ToaOccurrence,
} from "../toa";

const ALICE = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)";
const MAYO = "Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012)";

function scan(text: string): { marks: ToaMark[]; occ: ToaOccurrence[]; longs: string[] } {
  const marks = authoritiesForToa(text);
  return { marks, occ: toaOccurrences(text, marks), longs: marks.map((m) => m.long) };
}

/** The mark a given occurrence was attributed to ("" if none). */
const ownerOf = (marks: ToaMark[], o: ToaOccurrence): string => marks[o.markIndex]?.long ?? "";

// =============================================================================
// WRONG PAGE OR WRONG AUTHORITY
// =============================================================================

describe("wrong page / wrong authority", () => {
  // PRE-EXISTING (CASE_RE) + made worse in the pane by the per-hit plan.
  // Input: a heading paragraph, then a paragraph that opens with a full cite.
  //   "ARGUMENT\rAlice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014), controls."
  // Today: mark long = "ARGUMENT Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)"
  //   ("A. The Claims Are Directed To Eligible Subject Matter" → "Are Directed To
  //   Eligible Subject Matter Alice Corp. …"; "Statement of the Case\rIn Alice…"
  //   → "Statement of the Case In Alice Corp. …"). PARTY's `\s+` crosses the
  //   paragraph mark (Word's body.text uses \r). The glued mark is created FIRST,
  //   and toaOccurrences keeps the first mark at a tied offset, so it owns EVERY
  //   later clean "573 U.S. 208" hit too — every TA field's \l text carries the
  //   heading, and the Word TOA prints "ARGUMENT Alice Corp. …" filed under A/R/S.
  // Correct: "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)" (R10.2 — the
  //   case name is the parties). A party name never spans a paragraph break.
  // Why it matters: headings are immediately followed by the controlling cite in
  //   almost every argument section; the filed TOA shows a nonsense entry.
  // Owner: src/lib/toa.ts (PARTY / CASE_NAME whitespace).
  it("a case name never runs across a paragraph break, and the clean spelling owns the hits", () => {
    for (const brk of ["\r", "\n"]) {
      const t =
        `ARGUMENT${brk}${ALICE}, controls.${brk}` +
        `A. The Claims Are Directed To Eligible Subject Matter${brk}${ALICE}, again.${brk}` +
        `Later: ${ALICE}.`;
      const { marks, occ, longs } = scan(t);
      expect(longs.every((l) => l.startsWith("Alice Corp."))).toBe(true);
      for (const o of occ.filter((x) => x.kind === "full")) expect(ownerOf(marks, o)).toMatch(/^Alice Corp\./);
    }
  });

  // PRE-EXISTING (CASE_RE) — the same class across a SENTENCE boundary, and far
  // more frequent than headings.
  // Inputs:
  //   "This was confirmed by the Supreme Court. Mayo Collaborative Servs. v.
  //    Prometheus Labs., Inc., 566 U.S. 66 (2012)."
  //   "The rule comes from the Federal Circuit. Enfish, LLC v. Microsoft Corp.,
  //    822 F.3d 1327 (Fed. Cir. 2016)."
  //   "<Alice>. Id. Mayo Collaborative Servs. v. …"
  // Today: "Supreme Court. Mayo Collaborative Servs. v. …", "Federal Circuit.
  //   Enfish, LLC v. …", "Id. Mayo Collaborative Servs. v. …" — a capitalised
  //   word with a period ("Court.", "Circuit.", "Id.") is a NAMEWORD, so the
  //   previous sentence's last words become part of the first party.
  // Correct: "Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66
  //   (2012)"; "Enfish, LLC v. Microsoft Corp., 822 F.3d 1327 (Fed. Cir. 2016)".
  // Why it matters: the TOA entry and every TA \l text print the prose; the row
  //   files under S / F / I; and a later clean Mayo cite becomes a second row.
  // Owner: src/lib/toa.ts (PARTY / NAMEWORD; cleanCaseName).
  it("a case name never absorbs the end of the previous sentence", () => {
    const inputs: Array<[string, RegExp]> = [
      [`This was confirmed by the Supreme Court. ${MAYO}.`, /^Mayo Collaborative/],
      ["The rule comes from the Federal Circuit. Enfish, LLC v. Microsoft Corp., 822 F.3d 1327 (Fed. Cir. 2016).", /^Enfish, LLC/],
      [`${ALICE}. Id. ${MAYO}.`, /^(Alice|Mayo)/],
    ];
    for (const [t, ok] of inputs) for (const l of scan(t).longs) expect(l).toMatch(ok);
  });

  // PRE-EXISTING in the lib; in the pane it is a REGRESSION (see next test).
  // Input (patent brief — record cites and the patent short form are what Id.
  //   usually follows):
  //   "<Alice>. The patent is U.S. Patent No. 7,469,381. Alice, 573 U.S. at 217.
  //    '381 patent, col. 3 ll. 5–10. Id. col. 4 ll. 1–3."
  //   "<Alice>. The expert agreed. Appx1234. Id. at Appx1240."
  //   "<Alice>. See R. Merges, Patent Law 45 (2d ed. 2010). Id. at 47."
  // Today: every one of those Id. occurrences → Alice. lastMark is carried across
  //   any citation the scanner does not recognise.
  // Correct: R4.1 — id. refers to the IMMEDIATELY preceding authority (the patent
  //   column, the appendix page, the treatise). If the preceding citation was not
  //   recognised, the Id. must be dropped (and counted), never handed to the last
  //   recognised authority.
  // Why it matters: Alice is listed on pages where it is not cited — a TOA entry
  //   that a court or opposing counsel can check and find false.
  // Owner: src/lib/toa.ts (toaOccurrences, Id. resolution).
  it("an Id. after a citation the scanner cannot read is not given to an earlier authority", () => {
    const cases = [
      `${ALICE}. The patent is U.S. Patent No. 7,469,381. Alice, 573 U.S. at 217. '381 patent, col. 3 ll. 5–10. Id. col. 4 ll. 1–3.`,
      `${ALICE}. The expert agreed. Appx1234. Id. at Appx1240.`,
      `${ALICE}. See R. Merges, Patent Law 45 (2d ed. 2010). Id. at 47.`,
    ];
    for (const t of cases) {
      const { marks, occ } = scan(t);
      const ids = occ.filter((o) => o.kind === "id");
      for (const o of ids) expect(ownerOf(marks, o)).not.toMatch(/^Alice/);
    }
  });

  // REGRESSION (pane). Before v2.141.0 the pane grouped occurrences by needle and
  // REFUSED a needle with two owners ("Id." meaning Alice in one place and Mayo
  // in another was counted as unattributed). taSearchPlan now assigns per hit,
  // so every lib mis-attribution above now becomes a TA field in Word.
  // Input: "<Alice>. Id.; see also <Mayo>. See Appx12. Id."
  //   ("; see also" keeps the first Id. out of the sentence-glue defect above.)
  // Today: plan step "Id." assign = [Alice, Mayo] — the Id. that cites Appx12 is
  //   marked for Mayo. HEAD's pane saw owners {Alice, Mayo} for the needle "Id."
  //   and refused both (declared as unattributed).
  // Correct: the second hit is null (skipped and counted), R4.1.
  // Owner: src/lib/toa.ts (toaOccurrences feeds taSearchPlan); consumed by
  //   buildNativeToaHandler.
  it("REGRESSION (pane): taSearchPlan does not place an Id. that follows an unrecognised record cite", () => {
    const t = `${ALICE}. Id.; see also ${MAYO}. See Appx12. Id.`;
    const { marks, occ } = scan(t);
    const mayo = marks.findIndex((m) => m.long.startsWith("Mayo"));
    const step = taSearchPlan(t, occ).steps.find((s) => s.needle === "Id.");
    expect(mayo).toBeGreaterThanOrEqual(0);
    expect(step).toBeDefined();
    expect(step!.assign.length).toBe(2); // self-check: two bare Id. hits
    expect(step!.assign[1]).not.toBe(mayo);
  });

  // PRE-EXISTING.
  // Input: "Under 35 U.S.C. § 101, claims are eligible. Id. § 102(a)."
  // Today: the Id. → "35 U.S.C. § 101".
  // Correct: "Id. § 102(a)" is 35 U.S.C. § 102(a) (R4.1 / R12.10 — id. plus a
  //   different section points to a different authority). It belongs to § 102 or
  //   is dropped; it is never § 101.
  // Why it matters: § 101 gains a page it is not cited on and § 102 loses one.
  // Owner: src/lib/toa.ts (idRe ignores a following "§ …").
  it("Id. § 102 after 35 U.S.C. § 101 is not attributed to § 101", () => {
    const { marks, occ } = scan("Under 35 U.S.C. § 101, claims are eligible. Id. § 102(a).");
    for (const o of occ.filter((x) => x.kind === "id")) expect(ownerOf(marks, o)).not.toBe("35 U.S.C. § 101");
  });

  // PRE-EXISTING. "Refuse, don't guess."
  // Input: "See <Alice>; <Mayo>. Id. at 72."
  // Today: Id. → Mayo (the last cite of the string).
  // Correct: R4.1 — id. may not be used when the preceding citation contains more
  //   than one source (verify wording). The reference is ambiguous: drop it and
  //   count it; do not pick the last member of the string cite.
  // Owner: src/lib/toa.ts.
  it("an Id. after a string citation is refused, not assigned to the last member", () => {
    const { occ } = scan(`See ${ALICE}; ${MAYO}. Id. at 72.`);
    expect(occ.filter((o) => o.kind === "id")).toHaveLength(0);
  });

  // PRE-EXISTING.
  // Input: "<Alice> (quoting Mayo …, 566 U.S. 66, 72 (2012)). Id. at 217."
  // Today: Id. at 217 → Mayo. (Page 217 is not even inside Mayo, 566 U.S. 66–92.)
  // Correct: the sources in a "quoting" parenthetical are not the authority the
  //   next id. refers to (R4.1 / R10.6.3, verify); either Alice or dropped.
  // Owner: src/lib/toa.ts.
  it("an Id. after a (quoting …) parenthetical is not given to the quoted case", () => {
    const t = `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014) (quoting ${MAYO.replace("66 (2012)", "66, 72 (2012)")}). Id. at 217.`;
    const { marks, occ } = scan(t);
    for (const o of occ.filter((x) => x.kind === "id")) expect(ownerOf(marks, o)).not.toMatch(/^Mayo/);
  });

  // REGRESSION (the B2 #8 fix). HEAD dropped § 103; v2.141.0 swallows the prose.
  // Inputs (patent prosecution / appeal sentences):
  //   "The Examiner rejected claims 1–10 under 35 U.S.C. §§ 102 and 103, and 11–20 under § 112(b)."
  //   "Under 35 U.S.C. §§ 102 & 103, 15 references were cited."
  //   "rejected under 35 U.S.C. §§ 102, 103, 12 claims remain"
  // Today: "35 U.S.C. §§ 102 and 103, and 11–20" / "35 U.S.C. §§ 102 & 103, 15" /
  //   "35 U.S.C. §§ 102, 103, 12" — and findPrecedingAuthority (the Insert-Id.
  //   confirmation) reports the same corrupted text. "§§ 102, 103, 12" names
  //   35 U.S.C. § 12, a real and unrelated section.
  // Correct: "35 U.S.C. §§ 102, 103" (or separate § 102 / § 103 rows), R3.3. A
  //   list member must not be followed by a word; claim numbers are not sections.
  // Owner: src/lib/toa.ts (SEC_LIST_TAIL).
  it("REGRESSION: a §§ list does not absorb claim numbers or counts that follow it", () => {
    const inputs: Array<[string, RegExp]> = [
      ["The Examiner rejected claims 1–10 under 35 U.S.C. §§ 102 and 103, and 11–20 under § 112(b).", /11–20/],
      ["Under 35 U.S.C. §§ 102 & 103, 15 references were cited.", /\b15\b/],
      ["Claims 1-10 were rejected under 35 U.S.C. §§ 102, 103, 12 claims remain.", /\b12\b/],
    ];
    for (const [t, bad] of inputs) {
      const { longs } = scan(t);
      expect(longs.some((l) => /103/.test(l))).toBe(true);
      for (const l of longs) expect(l).not.toMatch(bad);
    }
    expect(findPrecedingAuthority("rejected under 35 U.S.C. §§ 102, 103, 12 claims remain.")?.plain).not.toMatch(/\b12\b/);
  });

  // CONTESTED design (the scope doc allowed "one §§ entry"), but the consequence
  // is missing pages. Introduced by the B2 #8 fix (HEAD listed the § 102 page).
  // Input: "Claims were rejected under 35 U.S.C. §§ 102 and 103. … 35 U.S.C. § 102 again."
  // Today: two rows — "35 U.S.C. §§ 102 and 103" and "35 U.S.C. § 102" — and the
  //   § 102 row does not carry the first page. Same for "37 C.F.R. §§ 1.97, 1.98"
  //   vs "37 C.F.R. § 1.97".
  // Correct: a TOA lists each section with every page on which it is cited (FRAP
  //   28(a)(3): "references to the pages of the brief where they are cited"); a
  //   §§ list cites each member.
  // Owner: src/lib/toa.ts (sectionCite / toaOccurrences).
  it("REGRESSION (contested): the § 102 row includes the page where § 102 is cited inside a §§ list", () => {
    for (const [t, row] of [
      ["Claims were rejected under 35 U.S.C. §§ 102 and 103. Later, 35 U.S.C. § 102 again.", "35 U.S.C. § 102"],
      ["See 37 C.F.R. §§ 1.97, 1.98. Later 37 C.F.R. § 1.97.", "37 C.F.R. § 1.97"],
    ] as const) {
      const { marks, occ } = scan(t);
      const mi = marks.findIndex((m) => m.long === row);
      expect(mi).toBeGreaterThanOrEqual(0);
      const at = occ.filter((o) => o.markIndex === mi).map((o) => o.index);
      expect(at).toContain(t.indexOf(row.slice(0, 10) + "§§"));
    }
  });


  // PRE-EXISTING / pane. Source-read: nothing in a test can drive Word.
  // Reasoning from the Word JS API (not verified in Word): document.body is the
  // MAIN story. Footnotes and endnotes are separate Body objects reached through
  // body.footnotes / body.endnotes (WordApi 1.5). body.text does not contain
  // their text and body.search does not search them, so the plan's hit counts
  // AGREE — expectedHits never trips — and the gap is silent:
  //   - an authority cited only in a footnote never becomes a mark (absent from
  //     the TOA altogether);
  //   - footnote pages of body-cited authorities are never marked;
  //   - an Id. in the text that follows a footnote cite inherits the authority
  //     from before the footnote;
  //   - the message still reads "Marked N of N authorities".
  // Correct: scan footnotes/endnotes, or at least declare that they were not.
  // Owner: src/taskpane/taskpane.ts (buildNativeToaHandler).
  it("buildNativeToaHandler scans or at least discloses footnote / endnote citations", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
    const start = src.indexOf("async function buildNativeToaHandler(");
    expect(start).toBeGreaterThan(0);
    const rest = src.slice(start + 1);
    const end = rest.search(/\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/);
    // Strip full-line AND trailing // comments, so "// TODO footnotes" cannot pass it.
    const body = src
      .slice(start, start + 1 + end)
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/.*$/gm, "");
    expect(body.length).toBeGreaterThan(1500); // self-check: the slice is the handler
    expect(body).toContain("taSearchPlan(");
    expect(body).toMatch(/footnote|endnote/i);
  });

  // PRE-EXISTING. Input: "Doe v. Roe, 10 F. 3d 5 (9th Cir. 1993)." — a space or
  // a non-breaking space inside "F.3d" (NBSP is what drafters type to keep a
  // reporter on one line; Lexis copy produces it).
  // Today: mark "Doe v. Roe, 10 F. 3" — volume 10 of the FIRST-series Federal
  //   Reporter, page 3, no court, no year. CASE_RE has no boundary after the page
  //   digits, so "3" is read out of "3d".
  // Correct: "Doe v. Roe, 10 F.3d 5 (9th Cir. 1993)" (T1 spacing), or refuse. Never
  //   a different reporter series.
  // Owner: src/lib/toa.ts (CASE_RE page group needs a right boundary; reporter
  //   alternation should tolerate \s / NBSP).
  it("'10 F. 3d 5' is never filed as 10 F. 3 (a different reporter series)", () => {
    for (const t of ["Doe v. Roe, 10 F. 3d 5 (9th Cir. 1993).", "Doe v. Roe, 10 F.\u00a03d 5 (9th Cir. 1993)."]) {
      for (const l of scan(t).longs) expect(l).not.toMatch(/10 F\.\s3(?!d)/);
    }
  });

  // PRE-EXISTING. Input: "Ass’n for Molecular Pathology v. Myriad Genetics, Inc.,
  //   569 U.S. 576 (2013). … Myriad, 569 U.S. at 590."
  // Today: caseShortName → "Ass’n", so the Myriad short cite is not an
  //   occurrence (page missing; any following Id. goes to the wrong case).
  // Correct: R10.9 lets the short form use the more distinctive party; when the
  //   first party is a generic "Ass'n …", "Myriad, 569 U.S. at 590" is the form
  //   every brief uses. Vol + reporter + "at" already pins the case.
  // Owner: src/lib/citations.ts (caseShortName) / src/lib/toa.ts (short-form RE).
  it("the Myriad short form is found for Ass'n for Molecular Pathology v. Myriad", () => {
    const t = "Ass’n for Molecular Pathology v. Myriad Genetics, Inc., 569 U.S. 576 (2013). Myriad, 569 U.S. at 590.";
    const { occ } = scan(t);
    expect(occ.some((o) => o.kind === "short" && o.index === t.indexOf("Myriad, 569"))).toBe(true);
  });

  // PRE-EXISTING. Inputs: "See generally id. at 210." / "Contra id. at 211."
  // Today: dropped — ID_SIGNAL_BEFORE knows See / See also / Cf. / Accord / But
  //   see / But cf. / Compare / e.g., but not "See generally" or "Contra" (both
  //   R1.2 signals).
  // Correct: both are Id. citations of Alice (page missing today).
  // Owner: src/lib/toa.ts (ID_SIGNAL_BEFORE).
  it("lowercase id. after 'See generally' and 'Contra' is counted", () => {
    for (const sig of ["See generally", "Contra"]) {
      const { occ } = scan(`${ALICE}. ${sig} id. at 210.`);
      expect(occ.filter((o) => o.kind === "id")).toHaveLength(1);
    }
  });
});

// =============================================================================
// SILENT OMISSION — the authority is missing from the TOA altogether
// =============================================================================

describe("silent omission", () => {
  // PRE-EXISTING. The B1 #3 quote fold never reached REPORTER_ALT.
  // Input: "Foo Inc. v. Bar Corp., 500 F. App’x 10 (Fed. Cir. 2012)." — Word
  //   AutoCorrect turns the typed ' into ’, so this is how EVERY typed App'x cite
  //   reads in a Word document.
  // Today: no mark (the authority is absent from the TOA).
  // Correct: "Foo Inc. v. Bar Corp., 500 F. App'x 10 (Fed. Cir. 2012)" (T1).
  // Why it matters: nonprecedential Federal Circuit decisions are cited in F. App'x.
  // Owner: src/lib/toa.ts (REPORTER_ALT is built from straight-quote spellings).
  it("F. App’x with a curly apostrophe is recognised", () => {
    expect(scan("Foo Inc. v. Bar Corp., 500 F. App’x 10 (Fed. Cir. 2012).").marks).toHaveLength(1);
  });

  // PRE-EXISTING. Westlaw's own reporter spellings (what "Copy with Reference"
  // pastes): "123 F.Supp.2d 456", "134 S.Ct. 2347", "500 Fed.Appx. 10"; and the
  // Federal Circuit / PTAB form "76 USPQ2d 1385".
  // Today: none recognised — four cases absent from the TOA.
  // Correct: recognised and normalised to T1 ("F. Supp. 2d", "S. Ct.",
  //   "F. App'x", "U.S.P.Q.2d"); normalizeReporter already maps these keys.
  // Owner: src/lib/toa.ts (REPORTER_ALT is literal; it ignores normalizeReporter).
  it("Westlaw / USPQ reporter spellings are recognised", () => {
    const t =
      "Smith v. Jones, 123 F.Supp.2d 456, 460 (D. Del. 2000). Doe v. Roe, 134 S.Ct. 2347 (2014). " +
      "Foo v. Bar, 500 Fed.Appx. 10 (Fed. Cir. 2012). Ex parte Jones, 76 USPQ2d 1385 (B.P.A.I. 2005).";
    expect(scan(t).marks).toHaveLength(4);
  });

  // PRE-EXISTING. Input: "O'Reilly v. Morse, 56 U.S. (15 How.) 62, 113 (1854).
  //   Hotchkiss v. Greenwood, 52 U.S. (11 How.) 248 (1851)."
  // Today: no marks. Correct: R10.3.2 / T1 require the nominative reporter for
  //   early U.S. Reports; both are staple § 101 / § 103 authorities.
  // Owner: src/lib/toa.ts (CASE_RE requires the page right after the reporter).
  it("early U.S. Reports with a nominative parallel are recognised", () => {
    const t = "O'Reilly v. Morse, 56 U.S. (15 How.) 62, 113 (1854). Hotchkiss v. Greenwood, 52 U.S. (11 How.) 248 (1851).";
    expect(scan(t).marks).toHaveLength(2);
  });

  // PRE-EXISTING. Inputs: "U.S. Patent No. RE45,678", "U.S. Patent No. D789,012",
  //   "U.S. Pat. No. 7,469,381".
  // Today: none recognised (PATENT_RE needs digits right after "No." and the full
  //   word "Patent"). Correct: reissue and design patents are patents (R14.8,
  //   verify) and "U.S. Pat. No." is the common practitioner spelling; the
  //   citations.ts form already keeps RE / D prefixes (formatPatentNumber).
  // Owner: src/lib/toa.ts (PATENT_RE).
  it("reissue, design and 'U.S. Pat. No.' patents are recognised", () => {
    const { marks } = scan("U.S. Patent No. RE45,678. U.S. Patent No. D789,012. U.S. Pat. No. 7,469,381.");
    expect(marks.filter((m) => m.category === "patents")).toHaveLength(3);
  });

  // PRE-EXISTING; the B2 #8 list fix was applied to §§ but not to "Nos.".
  // Input: "The asserted U.S. Patent Nos. 7,469,381 and 8,123,456 …"
  // Today: no mark — BOTH asserted patents are absent from the Patents heading.
  // Correct: two rows, "U.S. Patent No. 7,469,381" and "U.S. Patent No.
  //   8,123,456" (R14.8, verify). The plural form is how a complaint or brief
  //   first names the patents-in-suit.
  // Owner: src/lib/toa.ts (PATENT_RE requires "No.").
  it("'U.S. Patent Nos. A and B' lists both patents", () => {
    const { marks } = scan("The asserted U.S. Patent Nos. 7,469,381 and 8,123,456 cover widgets.");
    expect(marks.filter((m) => m.category === "patents")).toHaveLength(2);
  });

  // PRE-EXISTING; inconsistent with the B2 #8 fix, which taught U.S.C. / C.F.R.
  // lists but not MPEP. Input: "MPEP §§ 2111, 2111.01."
  // Today: "MPEP § 2111" only — § 2111.01 silently dropped.
  // Correct: § 2111.01 listed (R3.3). Owner: src/lib/toa.ts (MPEP_RE).
  it("MPEP §§ 2111, 2111.01 keeps § 2111.01", () => {
    expect(scan("See MPEP §§ 2111, 2111.01.").longs.some((l) => l.includes("2111.01"))).toBe(true);
  });
});

// =============================================================================
// WRONG TEXT in the filed table
// =============================================================================

describe("wrong text", () => {
  // PRE-EXISTING. Input: "Smith v. Jones, No. 13-cv-1, 2015 WL 123456, at *3
  //   (D. Del. Mar. 1, 2015)."
  // Today: "Smith v. Jones, 2015 WL 123456 (D. Del. Mar. 1, 2015)" — docket gone.
  // Correct: R10.8.1(a) — a database cite includes the docket number:
  //   "Smith v. Jones, No. 13-cv-1, 2015 WL 123456 (D. Del. Mar. 1, 2015)". This
  //   release taught the citations.ts form to EMIT the docket; the TOA strips it.
  // Owner: src/lib/toa.ts (UNPUB_RE does not capture the docket).
  it("an unreported (WL) case keeps its docket number in the TOA entry", () => {
    const { longs } = scan("Smith v. Jones, No. 13-cv-1, 2015 WL 123456, at *3 (D. Del. Mar. 1, 2015).");
    expect(longs[0]).toContain("No. 13-cv-1");
  });

  // PRE-EXISTING. Input: "Pennock v. Dialogue, 27 U.S. 1 (1829)."
  // Today: "Pennock v. Dialogue, 27 U.S. 1" — YEAR_PAREN only accepts 19xx/20xx.
  // Correct: the date parenthetical is part of the full cite (R10.5) — any year.
  // Owner: src/lib/toa.ts (YEAR_PAREN).
  it("a pre-1900 decision keeps its year", () => {
    expect(scan("Pennock v. Dialogue, 27 U.S. 1 (1829).").longs[0]).toContain("(1829)");
  });

  // PRE-EXISTING. Inputs: "After / Even / Both <Alice>, …".
  // Today: "After Alice Corp. v. …", "Even Alice Corp. v. …", "Both Alice Corp.
  //   v. …" — filed under A / E / B with the prose word in italics.
  // Correct: "Alice Corp. v. CLS Bank Int'l, …". (Not "Under", which the code
  //   deliberately keeps for "Under Armour"; see the it.failing below.)
  // Owner: src/lib/toa.ts (LEADING_INTRO_RE).
  it("a sentence-opening prose word is not glued onto the case name", () => {
    for (const w of ["After", "Even", "Both"]) {
      expect(scan(`${w} ${ALICE}, courts apply two steps.`).longs[0]).toMatch(/^Alice Corp\./);
    }
  });

  // PRE-EXISTING. Input: "37 C.F.R. §§ 1.97-1.98 … 37 C.F.R. §§ 1.97–1.98."
  // Today: two rows (hyphen and en dash). Correct: one row, printed with the en
  //   dash (R3.3(b) / R3.2(a)). A pasted range keeps the hyphen; a typed one gets
  //   Word's AutoFormat en dash — the same brief has both.
  // Owner: src/lib/toa.ts (sectionCite / dedupe key).
  it("a hyphen and an en-dash section range are one row", () => {
    expect(scan("37 C.F.R. §§ 1.97-1.98 and 37 C.F.R. §§ 1.97–1.98.").marks).toHaveLength(1);
  });
});

// =============================================================================
// COSMETIC / CONTESTED — it.failing (green while the gap exists)
// =============================================================================

describe("cosmetic / contested (it.failing)", () => {
  // "vs." is not Bluebook (R10.2.1 requires "v."), but drafters paste it; the
  // case is silently absent. Ideally recognised (and normalised) or reported.
  // PROMOTED (fix round): "vs." is accepted and shown as "v.".
  it("'Smith vs. Jones' is recognised", () => {
    expect(scan("Smith vs. Jones, 1 F.3d 1 (1990).").marks).toHaveLength(1);
  });

  // "35 USC § 101" / "35 U.S.C. 101" — non-Bluebook (R12.9), common in drafts.
  // PROMOTED (fix round): both spellings are read and shown as "35 U.S.C. § N".
  it("'35 USC § 101' and '35 U.S.C. 101' are recognised", () => {
    expect(scan("Under 35 USC § 101 and 35 U.S.C. 102.").marks).toHaveLength(2);
  });

  // Foreign patents (R14.8 / R20, verify) are absent from the TOA.
  it.failing("EP 1 674 995 B1 is listed", () => {
    expect(scan("See EP 1 674 995 B1.").marks.length).toBeGreaterThan(0);
  });

  // Bare "§ 101" after a full cite is the R12.10 short form; its pages are not
  // marked. Contested because a bare § is ambiguous across titles — but then it
  // should be COUNTED, not silently skipped.
  it.failing("a bare '§ 101' short form after 35 U.S.C. § 101 is an occurrence", () => {
    const t = "Under 35 U.S.C. § 101, claims are eligible. The claims satisfy § 101.";
    expect(scan(t).occ).toHaveLength(2);
  });

  // "the '381 patent" short form — ubiquitous in Federal Circuit briefs; its
  // pages are not marked under U.S. Patent No. 7,469,381.
  // PROMOTED (fix round): "the '381 patent" is a short form when the three
  // digits name one patent; the defining "(the '381 patent)" is not a second hit.
  it("the '381 patent short form is an occurrence of U.S. Patent No. 7,469,381", () => {
    const t = "U.S. Patent No. 7,469,381 (the '381 patent). The '381 patent claims a widget.";
    expect(scan(t).occ).toHaveLength(2);
  });

  // Westlaw's "CLS Bank International" vs the T6 "CLS Bank Int'l": two rows in the
  // static list (in the field TOA the first spelling silently owns every hit).
  // PROMOTED (fix round): the dedupe key applies T6, so both spellings are one
  // row; the first-typed spelling is the one shown.
  it("'International' and 'Int'l' spellings of one case are one static row", () => {
    const t = `${ALICE}. Alice Corp. v. CLS Bank International, 573 U.S. 208 (2014).`;
    expect(buildTableOfAuthorities(t).total).toBe(1);
  });

  // "Alice, supra, at 217" — R4.2(a): supra is not used for cases. The scanner
  // skips it without a word, so the page is lost AND the drafting error goes
  // unflagged. Ideally: count it under Alice and warn.
  it.failing("'Alice, supra, at 217' is an occurrence of Alice (and is flagged)", () => {
    const t = `${ALICE}. Alice, supra, at 217.`;
    expect(scan(t).occ).toHaveLength(2);
  });

  // "Under Alice Corp. v. …" is filed under U. The code keeps "Under" on purpose
  // ("Under Armour"); a refusal/flag would beat both outcomes.
  // KEPT AS IS (fix round, coordinator decision): stripping "Under" would corrupt
  // real parties (Under Armour, Inc.; Under Seal) — a wrong name in a filed TOA
  // is worse than a prose word the drafter can see and delete.
  it.failing("'Under Alice Corp. v. …' is filed as Alice", () => {
    expect(scan(`Under ${ALICE}, courts apply two steps.`).longs[0]).toMatch(/^Alice/);
  });
});

// =============================================================================
// CONFIRMED CORRECT (≤ 10)
// =============================================================================

describe("confirmed-correct probes", () => {
  it("curly and straight apostrophes are one authority (B1 #3)", () => {
    const t = "Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014). Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014).";
    expect(authoritiesForToa(t)).toHaveLength(1);
  });

  it("taSearchPlan skips the '10 F.3d 5' hit inside '110 F.3d 512' (B1 #1)", () => {
    const t = "Doe v. Roe, 10 F.3d 5 (9th Cir. 1993). Smith v. Jones, 110 F.3d 512 (2d Cir. 1997).";
    const { occ } = scan(t);
    const step = taSearchPlan(t, occ).steps.find((s) => s.needle === "10 F.3d 5")!;
    expect(step.assign).toEqual([0, null]);
  });

  it("taSearchPlan skips a short-form needle that is a prefix of a longer one in the same sentence", () => {
    const t = `${ALICE}. Alice, 573 U.S. at 21; Alice, 573 U.S. at 217.`;
    const { occ } = scan(t);
    const step = taSearchPlan(t, occ).steps.find((s) => s.needle === "Alice, 573 U.S. at 21")!;
    expect(step.assign).toEqual([0, null]);
  });

  it("taSearchPlan counts a hit inside a blanked old table but leaves it unassigned", () => {
    const table = `${ALICE}\t3`;
    const body = `${table}\rARGUMENT. ${ALICE}.`;
    const scanText = " ".repeat(table.length) + body.slice(table.length);
    const marks = authoritiesForToa(scanText);
    const step = taSearchPlan(body, toaOccurrences(scanText, marks)).steps.find((s) => s.needle === "573 U.S. 208")!;
    expect(step.assign).toEqual([null, 0]);
  });

  it("'said.' is not an Id. (B1 #2)", () => {
    const { occ } = scan(`${ALICE}. The court said. Id. at 210.`);
    expect(occ.filter((o) => o.kind === "id").map((o) => o.text)).toEqual(["Id. at 210"]);
  });

  it("In re Wands short forms are found (B1 #5)", () => {
    const t = "In re Wands, 858 F.2d 731, 737 (Fed. Cir. 1988). Wands, 858 F.2d at 740. In re Wands, 858 F.2d at 741.";
    expect(scan(t).occ.filter((o) => o.kind === "short")).toHaveLength(2);
  });

  it("passim is read back and the TOA field carries \\p (B1 #4)", () => {
    expect([...parseToaPages("35 U.S.C. § 101\tpassim").values()]).toEqual(["passim"]);
    expect(toaFieldsOoxml([1])).toMatch(/TOA \\c "1" \\p/);
  });

  it("eBay keeps its leading lowercase letter (B2 #6)", () => {
    expect(scan("eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388, 391 (2006).").longs[0]).toMatch(/^eBay Inc\./);
  });

  it("'(see 35 U.S.C. § 103).' drops the prose parenthesis", () => {
    expect(scan("(see 35 U.S.C. § 103).").longs).toEqual(["35 U.S.C. § 103"]);
  });
});
