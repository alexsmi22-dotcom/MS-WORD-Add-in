// fix2 documents round (docs2 review) — Table of Authorities, the Bluebook
// paste-and-fix parser, Id., the patent audit, numerals, RIS/BibTeX patents,
// APA in-text order. Each row was reproduced by the reviewer's probes
// (scratchpad docs2/c2.js, t1.js) before the fix and pins the corrected outcome.

import { applySignal, citationById, idForm, pageRanges, parseCitation } from "../citations";
import {
  authoritiesForToa,
  buildTableOfAuthorities,
  findPrecedingAuthority,
  taFieldOoxml,
  toaOccurrenceReport,
  TOA_FIELD_CATEGORIES,
} from "../toa";

const fmt = (id: string, fields: Record<string, string>): string =>
  citationById(id)!.format((k) => (fields[k] ?? "").trim()).plain;
const fmtHtml = (id: string, fields: Record<string, string>): string =>
  citationById(id)!.format((k) => (fields[k] ?? "").trim()).html;
const toa = (text: string) => buildTableOfAuthorities(text);
const rows = (text: string, heading: string): string[] =>
  toa(text).groups.filter((g) => g.heading === heading).flatMap((g) => g.entries.map((e) => e.plain));
const allRows = (text: string): string[] => toa(text).groups.flatMap((g) => g.entries.map((e) => e.plain));

/** Wall time of one call after a warm-up (a gross bound against exponential
 *  backtracking; the house pattern from docsFixes2193). */
function ms(f: () => unknown): number {
  f();
  const t = Date.now();
  f();
  return Date.now() - t;
}

// --- 1. sentence ends, glued prefixes, one row per case ----------------------
describe("1. TOA case names: ')' sentence ends, Ex. X., Under, one row per case", () => {
  it('"…§ 1295(a)(4)(A). Smith v. Jones…" files Smith under S, not "A). Smith"', () => {
    const t = "28 U.S.C. § 1295(a)(4)(A). Smith v. Jones, 110 F.3d 512 (2d Cir. 1997).";
    expect(rows(t, "Cases")).toEqual(["Smith v. Jones, 110 F.3d 512 (2d Cir. 1997)"]);
  });
  it('"See Ex. B. Doe v. Roe…" and "step (C). Acme…" lose the glued words', () => {
    expect(rows("See Ex. B. Doe v. Roe, 10 F.3d 5 (1st Cir. 1993).", "Cases")).toEqual(["Doe v. Roe, 10 F.3d 5 (1st Cir. 1993)"]);
    expect(rows("The court applied step (C). Acme Corp. v. Widget Co., 200 F.3d 100 (Fed. Cir. 2000).", "Cases")).toEqual([
      "Acme Corp. v. Widget Co., 200 F.3d 100 (Fed. Cir. 2000)",
    ]);
  });
  it('"Under Alice Corp. …" is filed under A and its short form "Alice, 573 U.S. at 218" is found', () => {
    const t = "Under Alice Corp. Pty. Ltd. v. CLS Bank Int'l, 573 U.S. 208, 217 (2014), courts apply a two-step test. Alice, 573 U.S. at 218.";
    expect(rows(t, "Cases")).toEqual(["Alice Corp. Pty. Ltd. v. CLS Bank Int'l, 573 U.S. 208 (2014)"]);
    const occ = toaOccurrenceReport(t, authoritiesForToa(t)).occurrences;
    expect(occ.map((o) => o.kind)).toEqual(["full", "short"]);
  });
  it("Under Armour, Under Seal keep their real first word; In re stays", () => {
    const t = "Under Armour, Inc. v. Nike, Inc., 1 F.4th 1 (Fed. Cir. 2021). Under Seal v. Under Seal, 2 F.4th 2 (4th Cir. 2021). In re Wands, 858 F.2d 731 (Fed. Cir. 1988).";
    expect(rows(t, "Cases")).toEqual([
      "In re Wands, 858 F.2d 731 (Fed. Cir. 1988)",
      "Under Armour, Inc. v. Nike, Inc., 1 F.4th 1 (Fed. Cir. 2021)",
      "Under Seal v. Under Seal, 2 F.4th 2 (4th Cir. 2021)",
    ]);
  });
  it("the same vol + reporter + page with prose glued on is one row (no duplicate)", () => {
    const t = "Appeal under 28 U.S.C. § 1295(a)(4)(A). Smith v. Jones, 110 F.3d 512 (2d Cir. 1997). Smith v. Jones, 110 F.3d 512, 515 (2d Cir. 1997).";
    expect(rows(t, "Cases")).toHaveLength(1);
    expect(authoritiesForToa(t).filter((m) => m.category === "cases")).toHaveLength(1);
  });
  it("different names on one table page stay two rows", () => {
    const t = "Ann v. Bob, 100 F.3d 1 (9th Cir. 1996). Cy v. Dee, 100 F.3d 1 (9th Cir. 1996).";
    expect(rows(t, "Cases")).toHaveLength(2);
  });
  it("subsequent history is carried in the entry as first cited (Rule 10.7) and its cite is not a second row", () => {
    const t = "Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023).";
    expect(allRows(t)).toEqual(["Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023)"]);
    const t2 = "Foo v. Bar, 1 F.3d 1 (Fed. Cir. 1990), aff'd sub nom. Baz v. Bar, 500 U.S. 1 (1991).";
    expect(allRows(t2)).toEqual(["Foo v. Bar, 1 F.3d 1 (Fed. Cir. 1990), aff'd sub nom. Baz v. Bar, 500 U.S. 1 (1991)"]);
  });
  it("hostile inputs stay linear (5 kB < 100 ms)", () => {
    const caps = "A). ".repeat(1300) + "Smith v. Jones, 1 F.3d 1 (1990).";
    const exs = "See Ex. B. ".repeat(500) + "Doe v. Roe, 1 F.3d 1 (1990)";
    const hist = "Foo v. Bar, 1 F.3d 1 (1990), cert. denied, ".repeat(120) + "x";
    const subnom = "Foo v. Bar, 1 F.3d 1 (1990), aff'd sub nom. " + "Aa ".repeat(1700);
    for (const s of [caps, exs, hist, subnom]) expect(ms(() => toa(s))).toBeLessThan(100);
  });
});

// --- 2. a case's parenthetical does not win over the case --------------------
describe("2. paste-and-fix: the case beats a statute/MPEP inside its parenthetical", () => {
  it("(quoting 35 U.S.C. § 101) / (citing MPEP § 2106) stay explanatory parentheticals", () => {
    const a = parseCitation("Alice Corp. Pty. Ltd. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014) (quoting 35 U.S.C. § 101).")!;
    expect(a.typeId).toBe("case");
    expect(a.fields.explan).toBe("(quoting 35 U.S.C. § 101)");
    const b = parseCitation("See Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66, 72 (2012) (citing MPEP § 2106).")!;
    expect(b.typeId).toBe("case");
    expect(b.fields.name).toBe("Mayo Collaborative Servs. v. Prometheus Labs., Inc.");
    expect(b.signal).toBe("See");
  });
  it("statutes, regs, Fed. Reg., MPEP, patents and articles still parse as themselves", () => {
    expect(parseCitation("35 U.S.C. § 112(f) (2018).")!.typeId).toBe("usc");
    expect(parseCitation("37 CFR 1.97-1.98")!.typeId).toBe("cfr");
    expect(parseCitation("Changes, 78 Fed. Reg. 11,024 (Feb. 14, 2013) (to be codified at 37 C.F.R. pt. 1).")!.typeId).toBe("fedreg");
    expect(parseCitation("MPEP § 2111.01 (9th ed. Rev. 07.2022, Feb. 2023).")!.typeId).toBe("mpep");
    expect(parseCitation("U.S. Patent No. 10,123,456 col. 3, ll. 15-20 (issued May 14, 2019).")!.typeId).toBe("patent");
    expect(parseCitation("Mark A. Lemley, Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905, 912 (2013).")!.typeId).toBe("article");
  });
});

// --- 3. signals, Compare … with, subsequent history ---------------------------
describe("3. paste-and-fix: R. 1.2 signals, Compare/with, history", () => {
  it.each([
    ["See generally Diamond v. Chakrabarty, 447 U.S. 303 (1980).", "See generally"],
    ["But see Diamond v. Diehr, 450 U.S. 175, 187 (1981).", "But see"],
    ["But cf. Diamond v. Diehr, 450 U.S. 175 (1981).", "But cf."],
    ["See, e.g., Diamond v. Diehr, 450 U.S. 175 (1981).", "See, e.g.,"],
    ["Cf. Diamond v. Diehr, 450 U.S. 175 (1981).", "Cf."],
    ["Contra Diamond v. Diehr, 450 U.S. 175 (1981).", "Contra"],
    ["Accord Diamond v. Diehr, 450 U.S. 175 (1981).", "Accord"],
    ["E.g., Diamond v. Diehr, 450 U.S. 175 (1981).", "E.g.,"],
  ])("%s → signal %s, name without it", (s, sig) => {
    const p = parseCitation(s)!;
    expect(p.signal).toBe(sig);
    expect(p.fields.name).toMatch(/^Diamond v\./);
  });
  it('"Compare A, with B" fills A and hands B back; the name never holds ", with"', () => {
    const p = parseCitation("Compare Gottschalk v. Benson, 409 U.S. 63 (1972), with Parker v. Flook, 437 U.S. 584 (1978).")!;
    expect(p.fields.name).toBe("Gottschalk v. Benson");
    expect(p.fields.page).toBe("63");
    expect(p.remainder).toBe("with Parker v. Flook, 437 U.S. 584 (1978).");
    const s = parseCitation("Bilski v. Kappos, 561 U.S. 593 (2010); Diamond v. Diehr, 450 U.S. 175 (1981).")!;
    expect(s.fields.name).toBe("Bilski v. Kappos");
    expect(s.remainder).toMatch(/^Diamond v\. Diehr/);
  });
  it('", cert. denied, 143 S. Ct. 1783 (2023)" is history, not the case name', () => {
    const p = parseCitation("Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023).")!;
    expect(p.fields).toMatchObject({ name: "Thaler v. Vidal", vol: "43", reporter: "F.4th", page: "1207", court: "Fed. Cir.", year: "2022" });
    expect(p.fields.history).toBe("cert. denied, 143 S. Ct. 1783 (2023)");
    expect(fmt("case", p.fields)).toBe("Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023)");
    expect(fmtHtml("case", p.fields)).toContain("<i>cert. denied</i>, 143 S. Ct. 1783 (2023)");
  });
  it("hostile paste stays linear (5 kB < 100 ms)", () => {
    const h = "Foo v. Bar, 1 F.3d 1 (1990)" + ", cert. denied".repeat(400);
    const w = "Compare " + "(, with ".repeat(600);
    const sc = "A v. B, 1 F.3d 1 (1990); ".repeat(200);
    for (const s of [h, w, sc]) expect(ms(() => parseCitation(s))).toBeLessThan(100);
  });
});

// --- 4. id. after a signal ----------------------------------------------------
describe("4. Rule 4.1: Id. capitalised only at the start of a citation sentence", () => {
  it('a signal makes it "See id. at 217"', () => {
    const r = applySignal("See", citationById("id")!.format((k) => (k === "pin" ? "217" : "")));
    expect(r.plain).toBe("See id. at 217");
    expect(r.html).toBe("<i>See</i> <i>id.</i> at 217");
  });
  it("idForm reads the text before the cursor", () => {
    expect(idForm("")).toBe("Id.");
    expect(idForm("… 573 U.S. 208 (2014). ")).toBe("Id.");
    expect(idForm("The claims fail. See ")).toBe("id.");
    expect(idForm("The claims fail. Cf. ")).toBe("id.");
    expect(idForm("the claim fails, ")).toBe("id.");
    expect(idForm("(quoting ")).toBe("id.");
  });
});

// --- 5. the Insert Id. helper resolves like the TOA --------------------------
describe("5. findPrecedingAuthority reads short forms and refuses what Id. cannot name", () => {
  const ALICE = "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014).";
  it("a short form is the preceding authority", () => {
    expect(findPrecedingAuthority(`${ALICE} Bilski v. Kappos, 561 U.S. 593 (2010). Alice, 573 U.S. at 217.`)?.plain).toBe(
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208",
    );
  });
  it("a patent column cite between is what Id. would mean → refused by name", () => {
    const r = findPrecedingAuthority(`${ALICE} See '381 patent col. 3 ll. 4–9.`);
    expect(r?.plain).toBe("");
    expect(r?.refused).toMatch(/Rule 4\.1/);
  });
  it("a string cite of several authorities → refused (Rule 4.1)", () => {
    const r = findPrecedingAuthority(`${ALICE.slice(0, -1)}; Bilski v. Kappos, 561 U.S. 593 (2010).`);
    expect(r?.refused).toMatch(/string citation/);
  });
  it("a §§ list is one citation Id. may refer to", () => {
    expect(findPrecedingAuthority("rejected under 35 U.S.C. §§ 102, 103.")?.plain).toBe("35 U.S.C. §§ 102, 103");
  });
});

// --- 9. authorities the table used to drop without a word --------------------
describe("9. constitutional provisions, PTAB, session laws, state codes, legislative history, local rules, reporters", () => {
  it("U.S. Const. art./amend. → Constitutional Provisions (Word TOA category 7)", () => {
    const t = "U.S. Const. art. I, § 8, cl. 8. U.S. Const. amend. V. U.S. Const. amend. XIV, § 1. Cal. Const. art. I, § 7.";
    expect(rows(t, "Constitutional Provisions")).toEqual([
      "U.S. Const. art. I, § 8, cl. 8",
      "U.S. Const. amend. V",
      "U.S. Const. amend. XIV, § 1",
      "Cal. Const. art. I, § 7",
    ]);
    expect(toa(t).groups[0].heading).toBe("Constitutional Provisions");
    expect(authoritiesForToa(t)[0].categoryNum).toBe(7);
    expect(TOA_FIELD_CATEGORIES.map((c) => c.num)).toEqual([1, 7, 2, 4, 6, 3]);
  });
  it("PTAB decisions are listed with the cases", () => {
    const t = "Apple Inc. v. Fintiv, Inc., IPR2020-00019, Paper 11, at 5 (P.T.A.B. Mar. 20, 2020) (precedential). Ex parte Jones, Appeal No. 2019-001234 (P.T.A.B. Jan. 2, 2020).";
    expect(rows(t, "Cases")).toEqual([
      "Apple Inc. v. Fintiv, Inc., IPR2020-00019, Paper 11 (P.T.A.B. Mar. 20, 2020)",
      "Ex parte Jones, Appeal No. 2019-001234 (P.T.A.B. Jan. 2, 2020)",
    ]);
  });
  it("Pub. L. / Stat. and state codes → Statutes", () => {
    const t =
      "See Leahy-Smith America Invents Act, Pub. L. No. 112-29, § 3, 125 Stat. 284, 285 (2011). 96 Stat. 25. Federal Food, Drug, and Cosmetic Act, Pub. L. No. 75-717, 52 Stat. 1040 (1938). Cal. Civ. Proc. Code § 425.16. Fla. Stat. § 768.79. Tex. Civ. Prac. & Rem. Code Ann. § 16.003. Del. Code Ann. tit. 8, § 102 (2020).";
    expect(rows(t, "Statutes")).toEqual([
      "Pub. L. No. 75-717, 52 Stat. 1040 (1938)",
      "Leahy-Smith America Invents Act, Pub. L. No. 112-29, 125 Stat. 284 (2011)",
      "96 Stat. 25",
      "Cal. Civ. Proc. Code § 425.16",
      "Del. Code Ann. tit. 8, § 102",
      "Fla. Stat. § 768.79",
      "Tex. Civ. Prac. & Rem. Code Ann. § 16.003",
    ]);
  });
  it("legislative history → Other Authorities; local patent rules → Rules", () => {
    expect(rows("H.R. Rep. No. 112-98, pt. 1, at 40 (2011). S. Rep. No. 82-1979 (1952).", "Other Authorities")).toEqual([
      "H.R. Rep. No. 112-98 (2011)",
      "S. Rep. No. 82-1979 (1952)",
    ]);
    expect(rows("N.D. Cal. Patent L.R. 3-1(a). P.R. 3-3. Civ. L.R. 7-3.", "Rules")).toEqual(["Civ. L.R. 7-3", "N.D. Cal. Patent L.R. 3-1", "P.R. 3-3"]);
  });
  it.each([
    ["Smith v. Jones, 50 Cal. App. 4th 100 (1996).", "50 Cal. App. 4th 100"],
    ["Doe v. Roe, 20 Cal. Rptr. 3d 5 (Ct. App. 2004).", "20 Cal. Rptr. 3d 5"],
    ["In re Acme, 400 B.R. 1 (Bankr. D. Del. 2009).", "400 B.R. 1"],
    ["Lee v. Comm'r, 100 T.C. 1 (1993).", "100 T.C. 1"],
    ["Ray v. Brown, 300 F. App'x 10 (Fed. Cir. 2008).", "300 F. App'x 10"],
    ["Moe v. United States, 90 Fed. Cl. 1 (2009).", "90 Fed. Cl. 1"],
    ["Kay v. Shinseki, 22 Vet. App. 1 (2008).", "22 Vet. App. 1"],
    ["Acme Corp. v. Widget Co., No. 1:20-cv-1, 2021 BL 12345 (D. Del. Jan. 4, 2021).", "2021 BL 12345"],
    ["Zed v. Zee, No. 19-1, 2020 U.S. Dist. LEXIS 999 (D. Mass. 2020).", "2020 U.S. Dist. LEXIS 999"],
    ["Bee v. Cee, No. 2:19-cv-2, 2021 WL 123456 (E.D. Tex. 2021).", "2021 WL 123456"],
  ])("%s is a case", (t, core) => {
    const r = rows(t, "Cases");
    expect(r).toHaveLength(1);
    expect(r[0]).toContain(core);
  });
  it("a citation-shaped string with an unknown source is reported as skipped, not silently dropped", () => {
    const t = toa("Foo v. Bar, 12 Weird Rptr. 34 (1999).");
    expect(t.total).toBe(0);
    expect(t.refused?.[0].text).toBe("12 Weird Rptr. 34 (1999)");
  });
  it("hostile inputs stay linear (5 kB < 100 ms)", () => {
    const hostile = [
      "U.S. Const. art. ".repeat(300),
      "Pub. L. No. 1-1, ".repeat(300),
      "Aa ".repeat(1700) + ", Pub. L. No. 1-1",
      "Cal. " + "Civ. ".repeat(1000) + "Code §",
      "H.R. Rep. No. ".repeat(350),
      "N.D. Cal. Patent L.R. ".repeat(230),
      "1 " + "Aa ".repeat(1700) + "1 (1999",
      "1 Aa 1 (".repeat(600),
      "Foo v. Bar, IPR2020-00019, Paper ".repeat(150),
      "Smith v. Jones, No. 1, 2020 " + "Aa ".repeat(1600) + "LEXIS",
    ];
    for (const s of hostile) expect(ms(() => toa(s))).toBeLessThan(100);
  });
});

// --- 12. low items -------------------------------------------------------------
describe("12. pin ranges, § doubling, patent numbers, native italics, In re sorting", () => {
  it("R. 3.2(a): page ranges drop repetitious digits but keep two", () => {
    expect(pageRanges("216-218")).toBe("216–18");
    expect(pageRanges("1312–1317")).toBe("1312–17");
    expect(pageRanges("100-105")).toBe("100–05");
    expect(pageRanges("1335-36")).toBe("1335–36");
    expect(pageRanges("99-100")).toBe("99–100");
    expect(pageRanges("§ 3.02-3.04")).toBe("§ 3.02–3.04");
    expect(fmt("case", { name: "A v. B", vol: "1", reporter: "F.3d", page: "200", pin: "216-218", year: "2000" })).toBe("A v. B, 1 F.3d 200, 216–18 (2000)");
    expect(fmt("case-short", { name: "A", vol: "1", reporter: "F.3d", pin: "216-218" })).toBe("A, 1 F.3d at 216–18");
    expect(fmt("id", { pin: "216-218" })).toBe("Id. at 216–18");
    expect(fmt("article", { author: "X", title: "T", vol: "1", journal: "Y. L.J.", page: "200", pin: "216-218", year: "2000" })).toContain("200, 216–18");
    expect(fmt("book", { author: "X", title: "T", pin: "at 216-218", year: "2000" })).toBe("X, T at 216–18 (2000)");
  });
  it('"§ 101" typed in the Section field is not printed "§ §"', () => {
    expect(fmt("usc", { title: "35", section: "§ 101" })).toBe("35 U.S.C. § 101");
    expect(fmt("cfr", { title: "37", section: "§§ 1.97-1.98" })).toBe("37 C.F.R. §§ 1.97–1.98");
    expect(fmt("mpep", { section: "§ 2106" })).toBe("MPEP § 2106");
  });
  it('a patent number "abc" is refused by name', () => {
    expect(() => fmt("patent", { number: "abc" })).toThrow(/not a U\.S\. patent number/);
    expect(fmt("patent", { number: "RE45678" })).toBe("U.S. Patent No. RE45,678");
  });
  it("a native TA field keeps an article title italic", () => {
    const t = "Mark A. Lemley, Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905, 912 (2013).";
    const mk = authoritiesForToa(t)[0];
    const x = taFieldOoxml(mk.name, mk.rest, mk.categoryNum, mk.html);
    expect(x).toContain("<w:i/><w:iCs/></w:rPr><w:instrText xml:space=\"preserve\">Software Patents and the Return of Functional Claiming</w:instrText>");
  });
  it('"In re Wands" sorts under I in the static table, as Word sorts the TA \\l text', () => {
    const t = "In re Wands, 858 F.2d 731 (Fed. Cir. 1988). Hall v. Doe, 1 F.3d 1 (1990). Xu v. Yi, 2 F.3d 2 (1991).";
    expect(rows(t, "Cases").map((r) => r.split(",")[0])).toEqual(["Hall v. Doe", "In re Wands", "Xu v. Yi"]);
  });
});
