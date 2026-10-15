// Pins the WIRING of the native Table of Authorities button (v2.141.0).
//
// taskpane.ts cannot be imported in a test (it needs Office.js), so the engine
// suites (legalCiteFixes, toa, toaShortForms) prove taSearchPlan is right but
// say nothing about whether the pane USES it the right way. The defects it
// fixes were all pane-side: a substring search marked Doe v. Roe on Smith v.
// Jones's pages, a case-insensitive "Id." search marked "said." for Alice, and
// a per-needle ownership gate dropped every page of an authority cited with
// both apostrophes. This file reads the handler's source and pins the order
// and options that make the plan safe, plus the pure scan-scope helpers the
// handler uses (toaScope.ts): footnotes, old tables, uncounted Id.s.

import * as fs from "fs";
import * as path from "path";
import { TA_SEARCH_OPTIONS, authoritiesForToa, taSearchPlan, toaOccurrenceReport, toaOccurrences } from "../toa";
import {
  blankSpans,
  hasVisibleText,
  isTableOfAuthoritiesFieldCode,
  locateBlock,
  typedToaSpans,
} from "../toaScope";

const PANE = path.join(__dirname, "..", "..", "taskpane", "taskpane.ts");
const src = fs.readFileSync(PANE, "utf8").replace(/\r\n/g, "\n");

/** The body of buildNativeToaHandler, up to the next top-level function. */
function handlerSource(): string {
  const start = src.indexOf("async function buildNativeToaHandler(");
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/);
  return next < 0 ? "" : src.slice(start, start + 1 + next);
}

/** Strips // line comments so a comment cannot satisfy or trip an assertion. */
const code = (s: string): string => s.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

const BEL = String.fromCharCode(7);

describe("native TOA handler wiring", () => {
  const body = handlerSource();
  const live = code(body);

  test("the slice is the real handler (self-check: it cannot pass vacuously)", () => {
    expect(body.length).toBeGreaterThan(1500);
    expect(body.length).toBeLessThan(30000);
    expect(live).toContain("toaFieldsOoxml(");
    expect(live).toContain("taFieldOoxml(");
    expect(live).not.toContain("async function buildTocHandler");
  });

  test("the search options are case-sensitive", () => {
    expect(TA_SEARCH_OPTIONS.matchCase).toBe(true);
    expect(TA_SEARCH_OPTIONS.matchWildcards).toBe(false);
    // The pane passes the plan's own options, never a hand-written literal.
    expect(live).toMatch(/story\.body\.search\(\s*step\.needle\s*,\s*step\.options\s*\)/);
    expect(live).not.toMatch(/matchCase\s*:\s*false/);
  });

  test("marks and occurrences come from the text re-read AFTER the stale TA fields are deleted", () => {
    const del = live.indexOf("f.delete()");
    const reload = live.indexOf('s.body.load("text")', del);
    const plan = live.indexOf("taSearchPlan(");
    expect(del).toBeGreaterThan(0);
    expect(reload).toBeGreaterThan(del);
    expect(live.indexOf("const bodyText = body.text")).toBeGreaterThan(reload);
    expect(live.indexOf("authoritiesForToa(scanTexts.join(")).toBeGreaterThan(reload);
    expect(live.indexOf("toaOccurrenceReport(scanTexts[i]")).toBeGreaterThan(reload);
    expect(plan).toBeGreaterThan(reload);
    // The plan counts hits against the REAL text of each story, not the blanked one.
    expect(live).toMatch(/taSearchPlan\(\s*story\.body\.text\s*,/);
  });

  test("every search is issued and synced BEFORE the first insertOoxml", () => {
    const search = live.indexOf(".search(");
    const firstInsert = live.indexOf("insertOoxml(");
    expect(search).toBeGreaterThan(0);
    expect(firstInsert).toBeGreaterThan(search);
    // Exactly one search call site, inside the loop over the plan's steps —
    // not a search-then-insert loop.
    expect(live.match(/\.search\(/g)).toHaveLength(1);
    expect(live).toMatch(/for\s*\(const step of plan\.steps\)/);
    const sync = live.indexOf("await context.sync()", search);
    expect(sync).toBeGreaterThan(search);
    expect(sync).toBeLessThan(firstInsert);
  });

  test("ownership is per hit, from the plan's assign array — the old per-needle gate is gone", () => {
    expect(live).not.toContain("byText");
    expect(live).not.toContain("owners.size");
    expect(live).toMatch(/step\.assign\[k\]/);
    expect(live).toMatch(/markIndex\s*===\s*null\)\s*return/);
  });

  test("a hit-count mismatch skips the step, and every unplaced citation is reported to the user", () => {
    expect(live).toMatch(/results\.items\.length\s*!==\s*step\.expectedHits/);
    expect(live).toMatch(/unattributed\s*\+=\s*step\.assign\.filter\(\(m\)\s*=>\s*m\s*!==\s*null\)\.length/);
    expect(live).toMatch(/unattributed\s*\+=\s*plan\.unplaced\.length/);
    // The count reaches the message the user reads, by name.
    const msg = live.slice(live.indexOf("toaMsg.textContent =", live.indexOf("taSearchPlan(")));
    expect(msg).toMatch(/unattributed\s*>\s*0/);
    expect(msg).toMatch(/\$\{unattributed\} citation/);
    expect(msg).toContain("left unmarked");
  });

  test("footnotes and endnotes are scanned under WordApi 1.5, and their absence is disclosed", () => {
    expect(live).toContain('wordApiSupported("1.5")');
    expect(live).toContain("body.footnotes");
    expect(live).toContain("body.endnotes");
    // Each note body gets its own plan and its own searches.
    expect(live).toMatch(/stories\.forEach\(\(story, i\)/);
    expect(live).toContain("Footnotes and endnotes were NOT scanned");
    expect(live).toContain("Headers and footers are not scanned.");
    // "N of M" always says what M counted.
    expect(live).toMatch(/authorit\$\{marks\.length === 1 \? "y" : "ies"\} found in `/);
    expect(live).toContain('"the main text, footnotes and endnotes "');
    // Stale TA fields are deleted in every story, not only the main text.
    expect(live).toMatch(/stories\.map\(\(s\)\s*=>\s*\{\s*const f = s\.body\.fields/);
  });

  test("everything the engine refused is reported by name", () => {
    expect(live).toMatch(/const report = toaOccurrenceReport\(scanTexts\[i\], marks\)/);
    expect(live).toMatch(/refused\.push\(\.\.\.report\.refused\)/);
    expect(live).toMatch(/taSearchPlan\(story\.body\.text, occ\)/);
    expect(live).toMatch(/const occ = report\.occurrences/);
    const msg = live.slice(live.indexOf("toaMsg.textContent =", live.indexOf("taSearchPlan(")));
    expect(msg).toMatch(/refused\.length > 0/);
    expect(msg).toContain("deliberately left unmarked rather than guessed (refused)");
  });

  test("a rebuild blanks every earlier table: this pane's, Word's TOA field, and a typed one", () => {
    expect(live).toContain("TOA_FIELD_CC_TAG");
    expect(live).toContain('"formula-inserter:toa"');
    expect(live).toMatch(/getByTag\(/);
    expect(live).toContain("isTableOfAuthoritiesFieldCode(f.code)");
    expect(live).toContain("typedToaSpans(scanText)");
    // Located with the separator-tolerant matcher, never indexOf, and a miss is reported.
    expect(live).toContain("locateBlock(bodyText, t)");
    expect(live).not.toMatch(/indexOf\(cc\.text\)/);
    expect(live).toMatch(/else tablesNotLocated\+\+/);
    expect(live).toMatch(/\$\{tablesNotLocated\} existing table/);
    expect(live).toMatch(/typed\.unbounded > 0/);
    // Blanking happens before the marks are taken.
    expect(live.indexOf("blankSpans(scanText, typed.spans)")).toBeLessThan(live.indexOf("authoritiesForToa(scanTexts.join("));
  });

  test("TEST-SCRIPT §0ch O’Brien step: each apostrophe spelling expects 2 hits (Word must fold quotes)", () => {
    const t =
      "O’Brien v. Doe, 12 F.3d 34 (1st Cir. 1994). O'Brien, 12 F.3d at 36. O’Brien, 12 F.3d at 36.";
    const plan = taSearchPlan(t, toaOccurrences(t, authoritiesForToa(t)));
    const straight = plan.steps.find((s) => s.needle === "O'Brien, 12 F.3d at 36")!;
    const curly = plan.steps.find((s) => s.needle === "O’Brien, 12 F.3d at 36")!;
    expect([straight.expectedHits, straight.assign]).toEqual([2, [0, null]]);
    expect([curly.expectedHits, curly.assign]).toEqual([2, [null, 0]]);
    expect(plan.unplaced).toEqual([]);
  });

  test("the pane imports taSearchPlan and the scope helpers", () => {
    const imp = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/lib\/toa"/.exec(src);
    expect(imp).not.toBeNull();
    expect(imp![1]).toMatch(/\btaSearchPlan\b/);
    expect(src).toMatch(/from\s*"\.\.\/lib\/toaScope"/);
  });
});

describe("toaScope — locating an earlier table despite separator differences", () => {
  const ALICE = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)";
  const MAYO = "Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012)";

  test("\\r in the control, \\n or \\r\\n in body.text", () => {
    const block = `TABLE OF AUTHORITIES\rCases\r${ALICE}\t3\r${MAYO}\t5`;
    const hay = `INTRO\n\nTABLE OF AUTHORITIES\nCases\n${ALICE}\t3\r\n${MAYO}\t5\nARGUMENT`;
    const span = locateBlock(hay, block)!;
    expect(span).not.toBeNull();
    expect(hay.slice(span[0], span[1])).toBe(`TABLE OF AUTHORITIES\nCases\n${ALICE}\t3\r\n${MAYO}\t5`);
  });

  test("table cell marks (BEL) and tabs are interchangeable separators", () => {
    const block = `${ALICE}\t3\r${MAYO}\t5`;
    const hay = `x\r${ALICE}${BEL}3${BEL}\r${BEL}${MAYO}${BEL}5${BEL}\ry`;
    const span = locateBlock(hay, block)!;
    expect(span).not.toBeNull();
    expect(hay.slice(span[0], span[1]).startsWith(ALICE)).toBe(true);
  });

  test("a block that is not there is null (the pane reports it), and an empty one is not 'visible'", () => {
    expect(locateBlock("ARGUMENT. Nothing here.", `${ALICE}\t3`)).toBeNull();
    expect(hasVisibleText(`\r\n\t${BEL} `)).toBe(false);
    expect(hasVisibleText("x")).toBe(true);
  });

  test("regex metacharacters in a table are literal", () => {
    expect(locateBlock("a (b) [c] *d* $e$ f.", "(b) [c] *d* $e$")).toEqual([2, 17]);
  });

  test("blankSpans keeps the length and every paragraph separator", () => {
    const t = `A\rB${BEL}C\nD`;
    const out = blankSpans(t, [[0, t.length]]);
    expect(out).toBe(` \r ${BEL} \n `);
    expect(out.length).toBe(t.length);
  });

  test("a hit inside a blanked table is counted but left unassigned", () => {
    const table = `TABLE OF AUTHORITIES\r${ALICE}\t3`;
    const body = `${table}\rARGUMENT\rAs held in ${ALICE}.`;
    const scanText = blankSpans(body, [locateBlock(body, table)!]);
    const marks = authoritiesForToa(scanText);
    expect(marks).toHaveLength(1);
    const step = taSearchPlan(body, toaOccurrences(scanText, marks)).steps.find((s) => s.needle === "573 U.S. 208")!;
    expect(step.assign).toEqual([null, 0]);
  });
});

describe("toaScope — Word's own TOA field and a typed TOA", () => {
  test("only a TOA field code is a table of authorities (not TA, not TOC)", () => {
    expect(isTableOfAuthoritiesFieldCode(' TOA \\h \\c "1" \\p ')).toBe(true);
    expect(isTableOfAuthoritiesFieldCode("TOA")).toBe(true);
    expect(isTableOfAuthoritiesFieldCode(' TA \\l "Alice" \\s "Alice" \\c 1 ')).toBe(false);
    expect(isTableOfAuthoritiesFieldCode(' TOC \\o "1-3" ')).toBe(false);
  });

  test("a typed TOA runs from its heading to the next all-capitals heading, over category labels", () => {
    const toa =
      "TABLE OF AUTHORITIES\r\tPage(s)\rCASES\tPAGE(S)\r" +
      "Alice Corp. v. CLS Bank Int'l,\r\t573 U.S. 208 (2014)........3, 5\r" +
      "STATUTES\r35 U.S.C. § 101........passim\r";
    const t = "TABLE OF CONTENTS\rTABLE OF AUTHORITIES\t\tii\rARGUMENT\t\t1\r" + toa + "STATEMENT OF THE ISSUES\rWhether…";
    const { spans, unbounded } = typedToaSpans(t);
    expect(unbounded).toBe(0);
    expect(spans).toEqual([[t.indexOf(toa), t.indexOf("STATEMENT OF THE ISSUES")]]);
    expect(typedToaSpans(t).endedBy).toEqual(["STATEMENT OF THE ISSUES"]);
    // The TOC line "TABLE OF AUTHORITIES<tab><tab>ii" is not a heading.
    expect(spans[0][0]).toBeGreaterThan(t.indexOf("TABLE OF AUTHORITIES\t\tii"));
  });

  test("its entries stop being citations once blanked; the argument's Id. is not given to the table", () => {
    const t =
      "TABLE OF AUTHORITIES\rMayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012)\t9\r" +
      "ARGUMENT\rId. at 70.\rAlice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014).";
    const scan = blankSpans(t, typedToaSpans(t).spans);
    const marks = authoritiesForToa(scan);
    expect(marks.map((m) => m.long)).toEqual(["Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)"]);
    const report = toaOccurrenceReport(scan, marks);
    expect(report.occurrences.filter((o) => o.kind === "id")).toEqual([]);
    expect(report.refused.map((r) => r.text)).toEqual(["Id. at 70"]); // the pane reports it
  });

  test("a typed TOA with no heading after it is NOT blanked, and is reported", () => {
    const t = "Argument text.\rTABLE OF AUTHORITIES\rAlice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)\t3";
    expect(typedToaSpans(t)).toEqual({ spans: [], endedBy: [], unbounded: 1 });
  });

  test("a lowercase heading is missed, but the first paragraph of prose still ends the table", () => {
    const prose =
      "The Examiner rejected claims 1–20 under 35 U.S.C. § 101 as directed to an abstract idea, relying on " +
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014), without addressing the claimed improvement.";
    const t =
      "TABLE OF AUTHORITIES\rMayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012)\t9\r" +
      "Statement of the Issues\r" + prose + "\rCONCLUSION";
    const r = typedToaSpans(t);
    expect(r.spans).toEqual([[0, t.indexOf(prose)]]);
    expect(r.endedBy).toEqual(["the first paragraph of text"]);
    // The citation in the prose survives the blanking.
    expect(authoritiesForToa(blankSpans(t, r.spans)).map((m) => m.long)).toContain(
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014)",
    );
  });

  test("the pane names where each typed table was taken to end", () => {
    const live = code(handlerSource());
    expect(live).toMatch(/typed\.endedBy\s*\.map\(/);
    expect(live).toContain("Skipped a typed “TABLE OF AUTHORITIES” up to");
  });

  test("a sentence mentioning the table is not a heading", () => {
    expect(typedToaSpans("See the Table of Authorities above.\rARGUMENT").spans).toEqual([]);
  });
});

describe("per-story plans: an Id. never crosses from the text into a note", () => {
  test("an Id. that opens a footnote has no antecedent in its story: refused, not placed", () => {
    const marks = authoritiesForToa("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014).");
    const report = toaOccurrenceReport("Id. at 217.", marks);
    expect(report.occurrences).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0].text).toBe("Id. at 217");
  });

  test("an Id. after a record cite is refused, so the pane counts it (See Appx12. Id.)", () => {
    const t = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). See Appx12. Id.";
    const report = toaOccurrenceReport(t, authoritiesForToa(t));
    expect(report.occurrences.filter((o) => o.kind === "id")).toEqual([]);
    expect(report.refused.map((r) => r.text)).toEqual(["Id."]);
  });
});
