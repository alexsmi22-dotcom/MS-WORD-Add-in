// Pinned regressions for the live Citations / Table-of-Authorities defects
// listed in docs/SCOPE-CITATIONS-2026-10.md §B. Every input below is the EXACT
// byte sequence from that table (curly apostrophes and ellipses included);
// where the table abbreviates an input with "…", the test says what was filled in.
//
// B1 #1 and #2 are pane-level (Word's substring search). The pane cannot be
// imported in a test, so they are pinned through the pure helpers the pane
// calls: taSearchPlan (the pane's wiring is pinned by toaPaneRouting.test.ts).

import {
  CITATIONS,
  abbreviateCaseName,
  caseShortForm,
  citationById,
  formatPatentNumber,
  parseCitation,
} from "../citations";
import {
  authoritiesForToa,
  buildTableOfAuthorities,
  caseShortName,
  citationRegister,
  findPrecedingAuthority,
  toaOccurrenceReport,
  parseToaPages,
  taSearchPlan,
  toaEntryKey,
  toaOccurrences,
} from "../toa";

const fmt = (id: string, fields: Record<string, string>, style?: "practitioner" | "academic") =>
  citationById(id)!.format((k) => (fields[k] ?? "").trim(), style);

const caseEntries = (text: string): string[] =>
  (buildTableOfAuthorities(text).groups.find((g) => g.category === "cases")?.entries ?? []).map((e) => e.plain);
const groupEntries = (text: string, cat: string): string[] =>
  (buildTableOfAuthorities(text).groups.find((g) => g.category === cat)?.entries ?? []).map((e) => e.plain);

// ---------------------------------------------------------------------------
describe("B1 #1 — a cite is not marked where it only appears inside a longer one", () => {
  const text = "Doe v. Roe, 10 F.3d 5 (9th Cir. 1993). Smith v. Jones, 110 F.3d 512 (2d Cir. 1997).";

  test("toaOccurrences gives Doe v. Roe only its own cite", () => {
    const marks = authoritiesForToa(text);
    const doe = marks.findIndex((m) => m.name === "Doe v. Roe");
    const occ = toaOccurrences(text, marks).filter((o) => o.markIndex === doe);
    expect(occ).toHaveLength(1);
    expect(occ[0].index).toBe(text.indexOf("10 F.3d 5"));
  });

  test("the lib boundary holds even when the containing cite is not itself recognised", () => {
    const t = "Doe v. Roe, 10 F.3d 5 (9th Cir. 1993). The panel in 110 F.3d 512 went the other way.";
    const marks = authoritiesForToa(t);
    expect(marks).toHaveLength(1);
    expect(toaOccurrences(t, marks)).toHaveLength(1);
  });

  test("taSearchPlan: Word's 2nd substring hit (inside 110 F.3d 512) is skipped", () => {
    const marks = authoritiesForToa(text);
    const doe = marks.findIndex((m) => m.name === "Doe v. Roe");
    const plan = taSearchPlan(text, toaOccurrences(text, marks));
    const step = plan.steps.find((s) => s.needle === "10 F.3d 5")!;
    expect(step.expectedHits).toBe(2);
    expect(step.assign).toEqual([doe, null]);
    expect(step.options).toEqual({ matchCase: true, matchWholeWord: false, matchWildcards: false });
  });

  test("35 U.S.C. § 10 is not marked inside § 101", () => {
    const t = "Under 35 U.S.C. § 10, and see 35 U.S.C. § 101.";
    const marks = authoritiesForToa(t);
    const i10 = marks.findIndex((m) => m.long === "35 U.S.C. § 10");
    expect(i10).toBeGreaterThanOrEqual(0);
    const step = taSearchPlan(t, toaOccurrences(t, marks)).steps.find((s) => s.needle === "35 U.S.C. § 10")!;
    expect(step.expectedHits).toBe(2);
    expect(step.assign).toEqual([i10, null]);
  });

  // v2.141.0 integration: the pane places TA fields with taSearchPlan alone,
  // so the neighbour predicates (isWholeCiteHit / isIdHit) are no longer
  // exported. Their boundary cases are pinned here through the plan instead.
  test("the plan skips 35 U.S.C. § 1 inside § 103", () => {
    const t = "Under 35 U.S.C. § 1, see 35 U.S.C. § 103 and 37 C.F.R. § 1.97.";
    const marks = authoritiesForToa(t);
    const i1 = marks.findIndex((m) => m.long === "35 U.S.C. § 1");
    expect(i1).toBeGreaterThanOrEqual(0);
    const step = taSearchPlan(t, toaOccurrences(t, marks)).steps.find((s) => s.needle === "35 U.S.C. § 1")!;
    expect(step.expectedHits).toBe(2);
    expect(step.assign).toEqual([i1, null]);
  });

  test("the plan skips 37 C.F.R. § 1 inside § 1.97", () => {
    const t = "Under 37 C.F.R. § 1, and see 37 C.F.R. § 1.97.";
    const marks = authoritiesForToa(t);
    const i1 = marks.findIndex((m) => m.long === "37 C.F.R. § 1");
    expect(i1).toBeGreaterThanOrEqual(0);
    const step = taSearchPlan(t, toaOccurrences(t, marks)).steps.find((s) => s.needle === "37 C.F.R. § 1")!;
    expect(step.expectedHits).toBe(2);
    expect(step.assign).toEqual([i1, null]);
  });
});

// ---------------------------------------------------------------------------
describe("B1 #2 — a bare Id. never matches said. / paid. / valid.", () => {
  const text =
    "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). Id. at 216. The examiner said. " +
    "The fee was paid. The claim is valid. Id.";

  test("taSearchPlan searches case-sensitively and maps each Id. hit by position", () => {
    const marks = authoritiesForToa(text);
    const plan = taSearchPlan(text, toaOccurrences(text, marks));
    const bare = plan.steps.find((s) => s.needle === "Id.")!;
    // Word (matchCase) finds "Id." twice: inside "Id. at 216" (owned by that
    // needle's own step) and the final bare one. said./paid./valid. never hit.
    expect(bare.expectedHits).toBe(2);
    expect(bare.assign).toEqual([null, 0]);
    expect(plan.steps.find((s) => s.needle === "Id. at 216")!.assign).toEqual([0]);
  });

  test("an Id. that means different cases in different places is still placed", () => {
    const t =
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). Id. " +
      "Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66 (2012). Id.";
    const marks = authoritiesForToa(t);
    const step = taSearchPlan(t, toaOccurrences(t, marks)).steps.find((s) => s.needle === "Id.")!;
    expect(step.assign).toEqual([0, 1]);
  });

  test("no plan step searches for a lowercase id. that is not after a signal", () => {
    const plan = taSearchPlan(text, toaOccurrences(text, authoritiesForToa(text)));
    expect(plan.steps.map((s) => s.needle).filter((n) => /^id\./.test(n))).toEqual([]);
    expect(plan.unplaced).toEqual([]);
  });

  test("See id. (lowercase after a signal) is an Id. occurrence", () => {
    const t = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). See id. at 217.";
    const occ = toaOccurrences(t, authoritiesForToa(t));
    expect(occ.map((o) => [o.kind, o.text, o.markIndex])).toEqual([
      ["full", "573 U.S. 208", 0],
      ["id", "id. at 217", 0],
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("B1 #3 — curly and straight apostrophes are one authority", () => {
  const text =
    "Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014). Later: Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014).";

  test("one TOA row, keeping the typed (first) form", () => {
    expect(caseEntries(text)).toEqual(["Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014)"]);
    expect(authoritiesForToa(text)).toHaveLength(1);
  });

  test("Alice gets both pages (one owner for the locator)", () => {
    const marks = authoritiesForToa(text);
    const occ = toaOccurrences(text, marks);
    expect(occ.filter((o) => o.markIndex === 0 && o.kind === "full")).toHaveLength(2);
    const step = taSearchPlan(text, occ).steps.find((s) => s.needle === "573 U.S. 208")!;
    expect(step.assign).toEqual([0, 0]);
  });

  test("the register counts both under one entry", () => {
    const reg = citationRegister(text);
    expect(reg.authorities).toBe(1);
    expect(reg.entries[0].count).toBe(2);
  });

  test("a curly-apostrophe short name still finds a straight-apostrophe short cite", () => {
    const t = "O’Brien v. Doe, 12 F.3d 34 (1st Cir. 1994). O'Brien, 12 F.3d at 36.";
    const occ = toaOccurrences(t, authoritiesForToa(t));
    expect(occ.map((o) => o.kind)).toEqual(["full", "short"]);
  });
});

// ---------------------------------------------------------------------------
describe("B1 #4 — parseToaPages accepts passim", () => {
  test("Word's \\p switch output is read back", () => {
    expect(parseToaPages("35 U.S.C. § 101\tpassim").get(toaEntryKey("35 U.S.C. § 101"))).toBe("passim");
  });
  test("prose is still not read as a page list", () => {
    expect(parseToaPages("Some text\tpassim is a word here").size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("B1 #5 — In re / Ex parte short forms", () => {
  const text =
    "In re Wands, 858 F.2d 731, 737 (Fed. Cir. 1988). … Wands, 858 F.2d at 740. … In re Wands, 858 F.2d at 741.";

  test("caseShortName takes the party after the procedural phrase", () => {
    expect(caseShortName("In re Wands")).toBe("Wands");
    expect(caseShortName("In re Bilski")).toBe("Bilski");
    expect(caseShortName("Ex parte Jones")).toBe("Jones");
  });

  test("both short cites are found, with and without the prefix", () => {
    const occ = toaOccurrences(text, authoritiesForToa(text));
    expect(occ.map((o) => o.kind)).toEqual(["full", "short", "short"]);
    expect(occ[1].text).toBe("Wands, 858 F.2d at 740");
    expect(occ[2].text).toBe("Wands, 858 F.2d at 741");
  });
});

// ---------------------------------------------------------------------------
describe("B2 #6/#7 — leading lowercase letters are kept", () => {
  test("eBay", () => {
    expect(caseEntries("eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)")).toEqual([
      "eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)",
    ]);
  });
  test("iRobot (the scope's … filled with a court and year)", () => {
    expect(caseEntries("iRobot Corp. v. SharkNinja Operating LLC, 19 F.4th 1 (Fed. Cir. 2021)")).toEqual([
      "iRobot Corp. v. SharkNinja Operating LLC, 19 F.4th 1 (Fed. Cir. 2021)",
    ]);
  });
  test("de Vries", () => {
    expect(caseEntries("de Vries v. Doe, 1 F.3d 1 (1990)")).toEqual(["de Vries v. Doe, 1 F.3d 1 (1990)"]);
    expect(caseShortName("de Vries v. Doe")).toBe("de Vries");
  });
  test("sentence prose before the name is not swallowed", () => {
    expect(caseEntries("As the Court held in eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006), relief is equitable.")).toEqual([
      "eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)",
    ]);
    expect(caseEntries("The panel in de Vries v. Doe, 1 F.3d 1 (1990), disagreed.")).toEqual(["de Vries v. Doe, 1 F.3d 1 (1990)"]);
  });
  test("the lowercase branches never start a name in the middle of a word", () => {
    // "xxeBay" is not a camel-case name; the new branch must not begin at "eBay".
    const entries = caseEntries("xxeBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)");
    expect(entries.some((e) => e.startsWith("eBay"))).toBe(false);
    expect(caseEntries("Rodeo Vries v. Doe, 1 F.3d 1 (1990)").some((e) => e.startsWith("deo") || e.startsWith("de "))).toBe(false);
  });
  test("the PARTY grammar stays fast on large prose (no catastrophic backtracking)", () => {
    const chunk = "Smith Jones Brown of the and Corp. Inc. de la van iPad eBay Alpha Beta Gamma, Delta, Epsilon ";
    const big = chunk.repeat(1500) + " v. " + chunk.repeat(50) + ", 1 U.S. 1 (2000).";
    const t0 = Date.now();
    authoritiesForToa(big);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

// ---------------------------------------------------------------------------
describe("B2 #8/#9 — § lists and ranges", () => {
  // Fix round (coordinator decision): each listed section is its OWN row and
  // gets the list's page; there is no combined "§§ 102, 103" row.
  test("35 U.S.C. §§ 102, 103 keeps § 103 (one row per section)", () => {
    expect(groupEntries("35 U.S.C. §§ 102, 103.", "statutes")).toEqual(["35 U.S.C. § 102", "35 U.S.C. § 103"]);
  });
  test("lists with and / a serial comma", () => {
    expect(groupEntries("35 U.S.C. §§ 102 and 103.", "statutes")).toEqual(["35 U.S.C. § 102", "35 U.S.C. § 103"]);
    expect(groupEntries("35 U.S.C. §§ 102, 103, and 112.", "statutes")).toEqual([
      "35 U.S.C. § 102",
      "35 U.S.C. § 103",
      "35 U.S.C. § 112",
    ]);
  });
  test("each member is placed at its own position, so every row gets the page", () => {
    const t = "Rejected under 35 U.S.C. §§ 102, 103.";
    const marks = authoritiesForToa(t);
    const occ = toaOccurrences(t, marks);
    expect(occ.map((o) => [o.text, marks[o.markIndex].long])).toEqual([
      ["35 U.S.C. §§ 102", "35 U.S.C. § 102"],
      ["103", "35 U.S.C. § 103"],
    ]);
    expect(occ[1].index).toBe(t.indexOf("103"));
  });
  test("a following separate statute cite is not swallowed into the list", () => {
    expect(groupEntries("35 U.S.C. §§ 102, 103, 35 U.S.C. § 112.", "statutes")).toEqual([
      "35 U.S.C. § 102",
      "35 U.S.C. § 103",
      "35 U.S.C. § 112",
    ]);
  });
  test("a trailing count is refused by name, never listed as a section", () => {
    const t = "Claims 1-10 were rejected under 35 U.S.C. §§ 102, 103, 12 claims remain.";
    expect(groupEntries(t, "statutes")).toEqual(["35 U.S.C. § 102", "35 U.S.C. § 103"]);
    const rep = toaOccurrenceReport(t, authoritiesForToa(t));
    expect(rep.refused.map((r) => r.text)).toEqual(["12"]);
    expect(findPrecedingAuthority(t)?.plain).toBe("35 U.S.C. §§ 102, 103");
  });
  test("a single § is never extended into a list", () => {
    expect(groupEntries("35 U.S.C. § 112, ¶ 6.", "statutes")).toEqual(["35 U.S.C. § 112"]);
  });
  test("§§ before a range", () => {
    expect(groupEntries("37 C.F.R. §§ 1.97–1.98", "regulations")).toEqual(["37 C.F.R. §§ 1.97–1.98"]);
    expect(groupEntries("35 U.S.C. §§ 102–103", "statutes")).toEqual(["35 U.S.C. §§ 102–103"]);
  });
  test("a dotted single section with a hyphen stays singular (Treasury reg)", () => {
    expect(groupEntries("26 C.F.R. § 1.6011-4.", "regulations")).toEqual(["26 C.F.R. § 1.6011-4"]);
    expect(fmt("cfr", { title: "37", section: "1.97–1.98" }).plain).toBe("37 C.F.R. §§ 1.97–1.98");
  });
});

// ---------------------------------------------------------------------------
describe("B2 #10 — one row per patent, with or without commas", () => {
  const text = "See U.S. Patent No. 7,469,381. Compare U.S. Patent No. 7469381.";
  test("one row, displayed with Bluebook commas", () => {
    expect(groupEntries(text, "patents")).toEqual(["U.S. Patent No. 7,469,381"]);
    expect(groupEntries("U.S. Patent No. 7469381.", "patents")).toEqual(["U.S. Patent No. 7,469,381"]);
  });
  test("both spellings are placed, under one owner", () => {
    const marks = authoritiesForToa(text);
    expect(marks).toHaveLength(1);
    const occ = toaOccurrences(text, marks);
    expect(occ.map((o) => [o.text, o.markIndex])).toEqual([
      ["U.S. Patent No. 7,469,381", 0],
      ["U.S. Patent No. 7469381", 0],
    ]);
  });
  test("a trailing comma is not part of the number", () => {
    expect(groupEntries("U.S. Patent No. 10,123,456, which issued", "patents")).toEqual(["U.S. Patent No. 10,123,456"]);
    expect(groupEntries("85 Fed. Reg. 12,345, which", "other")).toEqual(["85 Fed. Reg. 12,345"]);
  });
});

// ---------------------------------------------------------------------------
describe("B2 #11 — Google Patents number forms", () => {
  test("US prefix and kind code are stripped", () => {
    expect(fmt("patent", { number: "US10123456B2" }).plain).toBe("U.S. Patent No. 10,123,456");
    expect(fmt("patent", { number: "US 10,123,456 B2" }).plain).toBe("U.S. Patent No. 10,123,456");
  });
  test("letter prefixes are kept", () => {
    expect(formatPatentNumber("USRE45678E")).toBe("RE45,678");
    expect(formatPatentNumber("D123456")).toBe("D123,456");
  });
});

// ---------------------------------------------------------------------------
describe("B2 #12 — the short-form button (Bluebook R10.9)", () => {
  test("United States v. Alvarez → Alvarez, 567 U.S. at 715", () => {
    const short = caseShortForm({ name: "United States v. Alvarez", vol: "567", reporter: "U.S.", pin: "715" });
    expect(short.name).toBe("Alvarez");
    expect(fmt("case-short", short).plain).toBe("Alvarez, 567 U.S. at 715");
  });
  test("caseShortForm and caseShortName are one implementation", () => {
    for (const n of ["Alice Corp. v. CLS Bank Int’l", "In re Wands", "State v. Robinson", "de Vries v. Doe"]) {
      expect(caseShortForm({ name: n }).name).toBe(caseShortName(n));
    }
  });
  test("a name with no party falls back to what was typed (never a blank field)", () => {
    expect(caseShortForm({ name: "35 U.S.C. § 101" }).name).toBe("35 U.S.C. § 101");
  });
});

// ---------------------------------------------------------------------------
describe("B2 #13 — United States of America (R10.2.2)", () => {
  test("T6 toggle", () => {
    expect(abbreviateCaseName("United States of America v. Microsoft Corporation")).toBe("United States v. Microsoft Corp.");
  });
});

// ---------------------------------------------------------------------------
describe("B2 #14 — law review volume that is the year", () => {
  test("the shipped placeholders no longer demonstrate a redundant (2013)", () => {
    const article = CITATIONS.find((c) => c.id === "article")!;
    const ph: Record<string, string> = {};
    for (const f of article.fields) ph[f.key] = f.placeholder ?? "";
    expect(fmt("article", ph).plain).toBe(
      "Mark A. Lemley, Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905, 912"
    );
    expect(fmt("article", ph, "academic").html).not.toContain("(2013)");
  });
  test("a numbered volume keeps its year", () => {
    expect(fmt("article", { author: "A B", title: "T", vol: "99", journal: "Va. L. Rev.", page: "1", year: "2013" }).plain).toBe(
      "A B, T, 99 Va. L. Rev. 1 (2013)"
    );
  });
});

// ---------------------------------------------------------------------------
describe("B3 — Parse & fill", () => {
  test("#15 Federal Register with to-be-codified-at", () => {
    const p = parseCitation("85 Fed. Reg. 12,345 (Mar. 1, 2020) (to be codified at 37 C.F.R. pt. 1)");
    expect(p?.typeId).toBe("fedreg");
    expect(p?.fields).toEqual({ vol: "85", page: "12,345", date: "Mar. 1, 2020", codified: "37 C.F.R. pt. 1" });
    const p2 = parseCitation("85 Fed. Reg. 12,345 (Mar. 1, 2020) (to be codified at 35 U.S.C. § 1)");
    expect(p2?.typeId).toBe("fedreg");
  });

  test("#16 a parallel cite is not glued into the name", () => {
    const p = parseCitation("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 134 S. Ct. 2347 (2014)");
    expect(p?.typeId).toBe("case");
    expect(p?.fields).toMatchObject({
      name: "Alice Corp. v. CLS Bank Int'l",
      vol: "573",
      reporter: "U.S.",
      page: "208",
      pin: "",
      parallel: "134 S. Ct. 2347",
      year: "2014",
    });
    expect(fmt("case", p!.fields).plain).toBe("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 134 S. Ct. 2347 (2014)");
  });

  test("#17 USPQ2d parallel", () => {
    const p = parseCitation("In re Fisher, 421 F.3d 1365, 76 USPQ2d 1225 (Fed. Cir. 2005)");
    expect(p?.fields).toMatchObject({
      name: "In re Fisher",
      vol: "421",
      reporter: "F.3d",
      page: "1365",
      parallel: "76 USPQ2d 1225",
      court: "Fed. Cir.",
      year: "2005",
    });
  });

  test("#18 col. 3, ll. 15-20 keeps the line range", () => {
    const p = parseCitation("U.S. Pat. No. 7,469,381, col. 3, ll. 15-20 (issued …)");
    expect(p?.typeId).toBe("patent");
    expect(p?.fields.number).toBe("7,469,381");
    expect(p?.fields.pin).toBe("col. 3 ll. 15–20");
  });

  test("#19 n.3 pincite", () => {
    const p = parseCitation("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 n.3 (2014)");
    expect(p?.typeId).toBe("case");
    expect(p?.fields).toMatchObject({ name: "Alice Corp. v. CLS Bank Int'l", page: "208", pin: "216 n.3", parallel: "" });
  });
  test("#19 two pincites", () => {
    const p = parseCitation("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216, 220 (2014)");
    expect(p?.fields).toMatchObject({ name: "Alice Corp. v. CLS Bank Int'l", pin: "216, 220", parallel: "" });
  });
  test("#19 Westlaw with docket number and star page", () => {
    const raw = "Acme Corp. v. Widget Co., No. 13-cv-1, 2015 WL 123456, at *3 (D. Del. Mar. 1, 2015)";
    const p = parseCitation(raw);
    expect(p?.typeId).toBe("case");
    expect(p?.fields).toMatchObject({
      name: "Acme Corp. v. Widget Co.",
      docket: "No. 13-cv-1",
      vol: "2015",
      reporter: "WL",
      page: "123456",
      pin: "at *3",
      year: "2015",
    });
    expect(fmt("case", p!.fields).plain).toBe(raw);
    expect(fmt("case", p!.fields).html).toBe(
      "<i>Acme Corp. v. Widget Co.</i>, No. 13-cv-1, 2015 WL 123456, at *3 (D. Del. Mar. 1, 2015)"
    );
  });
  test("#19 Google Patents number", () => {
    const p = parseCitation("US 10,123,456 B2");
    expect(p?.typeId).toBe("patent");
    expect(fmt("patent", p!.fields).plain).toBe("U.S. Patent No. 10,123,456");
    expect(parseCitation("US10123456B2")?.typeId).toBe("patent");
  });

  test("#20 the section stops at the first non-section token", () => {
    const p = parseCitation("The Office relied on 37 C.F.R. § 1.56 and Rule 132.");
    expect(p?.typeId).toBe("cfr");
    expect(p?.fields.section).toBe("1.56");
  });
  test("#20 section lists and years still parse", () => {
    expect(parseCitation("35 U.S.C. §§ 102, 103 (2018)")?.fields).toMatchObject({ section: "102, 103", year: "2018" });
    expect(parseCitation("35 U.S.C. § 112, ¶ 6")?.fields.section).toBe("112, ¶ 6");
    expect(parseCitation("37 C.F.R. § 1.84(a), (b)")?.fields.section).toBe("1.84(a), (b)");
  });
});

// ---------------------------------------------------------------------------
describe("guards around the fixes", () => {
  test("the new parse grammar stays fast on a long pasted paragraph", () => {
    const para = "Smith v. Jones, 12 words here, 34 more words, and 56 again, ".repeat(60) + "(no year";
    const t0 = Date.now();
    parseCitation(para);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  test("reporters with internal digits and a pincite still parse", () => {
    expect(parseCitation("Smith v. Jones, 10 F. Supp. 2d 100, 105 (D. Mass. 1998)")?.fields).toMatchObject({
      reporter: "F. Supp. 2d",
      page: "100",
      pin: "105",
      parallel: "",
      court: "D. Mass.",
    });
  });
  test("statute year and subsection survive the stricter section grammar", () => {
    expect(parseCitation("See 35 U.S.C. § 101 (2018).")?.fields).toMatchObject({ section: "101", year: "2018" });
    expect(parseCitation("37 C.F.R. § 1.56(a).")?.fields.section).toBe("1.56(a)");
    expect(parseCitation("(see 35 U.S.C. § 101).")?.fields.section).toBe("101");
  });
  test("a cite typed with non-breaking spaces is still placed (verbatim span)", () => {
    const t = "Under 35 U.S.C. § 101 the claims fail.";
    const occ = toaOccurrences(t, authoritiesForToa(t));
    expect(occ.map((o) => o.text)).toEqual(["35 U.S.C. § 101"]);
  });
  // Fix round: a §§ list cites several authorities, so a following Id. does
  // not name one (Rule 4.1) — refused by name, not guessed.
  test("Id. after a § list is refused, with a reason", () => {
    const t = "Rejected under 35 U.S.C. §§ 102, 103. Id.";
    const rep = toaOccurrenceReport(t, authoritiesForToa(t));
    expect(rep.occurrences.map((o) => o.kind)).toEqual(["full", "full"]);
    expect(rep.refused).toHaveLength(1);
    expect(rep.refused[0].reason).toMatch(/several authorities/);
  });
  test("Id. § 102 goes to the § 102 row", () => {
    const t = "Under 35 U.S.C. § 101, see also 35 U.S.C. § 102. Later 35 U.S.C. § 101 applies. Id. § 102.";
    const marks = authoritiesForToa(t);
    const ids = toaOccurrences(t, marks).filter((o) => o.kind === "id");
    expect(ids.map((o) => marks[o.markIndex].long)).toEqual(["35 U.S.C. § 102"]);
  });
});

// ---------------------------------------------------------------------------
describe("B4 (cheap) — no empty date parenthetical", () => {
  test("a case form with no court and no year has no ()", () => {
    expect(fmt("case", { name: "Alice Corp. v. CLS Bank Int'l", vol: "573", reporter: "U.S.", page: "208" }).plain).toBe(
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208"
    );
  });
});
