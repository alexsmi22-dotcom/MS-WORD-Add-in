import {
  CITATIONS,
  citationById,
  applySignal,
  formatDate,
  formatPatentNumber,
  formatPublicationNumber,
  parseCitation,
  CitationType,
} from "../citations";

/** Parses a messy citation, then reformats it via the matched type. */
function roundtrip(raw: string): { typeId: string; plain: string; signal: string } {
  const p = parseCitation(raw);
  if (!p) throw new Error(`no parse for: ${raw}`);
  const type = citationById(p.typeId) as CitationType;
  const base = type.format((k) => (p.fields[k] ?? "").trim());
  const withSignal = applySignal(p.signal, base);
  return { typeId: p.typeId, plain: withSignal.plain, signal: p.signal };
}

/** Formats a citation type from a plain field map. */
function fmt(id: string, fields: Record<string, string>) {
  const type = citationById(id) as CitationType;
  return type.format((k) => (fields[k] ?? "").trim());
}

describe("helpers", () => {
  test("formatDate ISO → Bluebook month", () => {
    expect(formatDate("2014-06-19")).toBe("June 19, 2014");
    expect(formatDate("2020-03-01")).toBe("Mar. 1, 2020");
    expect(formatDate("2019-09-05")).toBe("Sept. 5, 2019");
    expect(formatDate("May 14, 2019")).toBe("May 14, 2019"); // pass-through
    expect(formatDate("2018")).toBe("2018");
  });

  test("formatPatentNumber groups digits and keeps a prefix", () => {
    expect(formatPatentNumber("10123456")).toBe("10,123,456");
    expect(formatPatentNumber("10,123,456")).toBe("10,123,456");
    expect(formatPatentNumber("7123456")).toBe("7,123,456");
    expect(formatPatentNumber("D654321")).toBe("D654,321");
    expect(formatPatentNumber("RE45678")).toBe("RE45,678");
  });

  test("formatPublicationNumber normalizes to YYYY/NNNNNNN", () => {
    expect(formatPublicationNumber("20200123456")).toBe("2020/0123456");
    expect(formatPublicationNumber("2020/0123456")).toBe("2020/0123456");
    expect(formatPublicationNumber("US 2020/0123456")).toBe("2020/0123456");
  });
});

describe("case", () => {
  test("full case with pincite and court", () => {
    const r = fmt("case", { name: "Alice Corp. v. CLS Bank Int’l", vol: "573", reporter: "U.S.", page: "208", pin: "216", year: "2014" });
    expect(r.plain).toBe("Alice Corp. v. CLS Bank Int’l, 573 U.S. 208, 216 (2014)");
    expect(r.html).toContain("<i>Alice Corp. v. CLS Bank Int’l</i>");
    expect(r.html).toContain("573 U.S. 208, 216 (2014)");
  });

  test("lower court includes the court in the parenthetical", () => {
    const r = fmt("case", { name: "In re Bilski", vol: "545", reporter: "F.3d", page: "943", court: "Fed. Cir.", year: "2008" });
    expect(r.plain).toBe("In re Bilski, 545 F.3d 943 (Fed. Cir. 2008)");
  });

  test("short form uses 'at'", () => {
    const r = fmt("case-short", { name: "Alice", vol: "573", reporter: "U.S.", pin: "217" });
    expect(r.plain).toBe("Alice, 573 U.S. at 217");
    expect(r.html).toContain("<i>Alice</i>");
  });
});

describe("statutes & regs", () => {
  test("U.S.C. with subsection and year", () => {
    expect(fmt("usc", { title: "35", section: "112", sub: "b", year: "2018" }).plain).toBe("35 U.S.C. § 112(b) (2018)");
  });
  test("U.S.C. multiple sections use §§", () => {
    expect(fmt("usc", { title: "35", section: "101, 102" }).plain).toBe("35 U.S.C. §§ 101, 102");
  });
  test("C.F.R.", () => {
    expect(fmt("cfr", { title: "37", section: "1.84", year: "2023" }).plain).toBe("37 C.F.R. § 1.84 (2023)");
  });
});

describe("patents", () => {
  test("issued patent with pincite", () => {
    const r = fmt("patent", { number: "10123456", pin: "col. 3 ll. 15–20", date: "2019-05-14" });
    expect(r.plain).toBe("U.S. Patent No. 10,123,456 col. 3 ll. 15–20 (issued May 14, 2019)");
  });
  test("bare patent number", () => {
    expect(fmt("patent", { number: "7123456" }).plain).toBe("U.S. Patent No. 7,123,456");
  });
  test("application publication", () => {
    const r = fmt("patent-app", { number: "20200123456", kind: "A1", date: "2020-04-23" });
    expect(r.plain).toBe("U.S. Patent Application Publication No. 2020/0123456 A1 (published Apr. 23, 2020)");
  });
});

describe("agency & secondary", () => {
  test("Federal Register", () => {
    expect(fmt("fedreg", { vol: "85", page: "12345", date: "2020-03-01" }).plain).toBe("85 Fed. Reg. 12,345 (Mar. 1, 2020)");
  });
  test("MPEP", () => {
    expect(fmt("mpep", { section: "2106.05(a)" }).plain).toBe("MPEP § 2106.05(a)");
  });
  test("law review article italicizes the title", () => {
    const r = fmt("article", {
      author: "Mark A. Lemley",
      title: "Software Patents and the Return of Functional Claiming",
      vol: "2013",
      journal: "Wis. L. Rev.",
      page: "905",
      year: "2013",
    });
    expect(r.plain).toBe("Mark A. Lemley, Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905 (2013)");
    expect(r.html).toContain("<i>Software Patents and the Return of Functional Claiming</i>");
  });
  test("treatise", () => {
    const r = fmt("book", { author: "Donald S. Chisum", title: "Chisum on Patents", pin: "§ 5.04", year: "2020" });
    expect(r.plain).toBe("Donald S. Chisum, Chisum on Patents § 5.04 (2020)");
    expect(r.html).toContain("<i>Chisum on Patents</i>");
  });
});

describe("signals", () => {
  test("prepends an italicized signal to both forms", () => {
    const base = fmt("case", { name: "Alice", vol: "573", reporter: "U.S.", page: "208", year: "2014" });
    const signed = applySignal("See", base);
    expect(signed.plain).toBe("See Alice, 573 U.S. 208 (2014)");
    expect(signed.html.startsWith("<i>See</i> ")).toBe(true);
  });
  test("empty signal is a no-op", () => {
    const base = fmt("cfr", { title: "37", section: "1.84" });
    expect(applySignal("", base)).toEqual(base);
  });

  test("'See also' is detected as a whole (not swallowed by 'See')", () => {
    const p = parseCitation("See also Mayo v. Prometheus, 566 U.S. 66 (2012)");
    expect(p?.signal).toBe("See also");
    expect(p?.fields.name).toBe("Mayo v. Prometheus"); // no leftover "also"
    expect(parseCitation("But see Alice Corp. v. CLS Bank, 573 U.S. 208 (2014)")?.signal).toBe("But see");
  });
});

describe("section ranges", () => {
  test("a dash/en-dash range of sections uses §§", () => {
    expect(fmt("usc", { title: "35", section: "101-103" }).plain).toBe("35 U.S.C. §§ 101-103");
    expect(fmt("usc", { title: "35", section: "101–103" }).plain).toBe("35 U.S.C. §§ 101–103");
    expect(fmt("cfr", { title: "37", section: "1.821 to 1.825" }).plain).toBe("37 C.F.R. §§ 1.821 to 1.825");
  });
  test("a single section with a hyphen in its number stays §", () => {
    expect(fmt("usc", { title: "42", section: "2000e-2" }).plain).toBe("42 U.S.C. § 2000e-2");
  });
  test("parser preserves §§ for a pasted range", () => {
    expect(roundtrip("35 U.S.C. §§ 101–103").plain).toBe("35 U.S.C. §§ 101–103");
  });
});

describe("paste-and-fix parser", () => {
  test("messy U.S.C. variants", () => {
    expect(roundtrip("35 usc 101").plain).toBe("35 U.S.C. § 101");
    expect(roundtrip("35 U.S.C. § 112(b) (2018)").plain).toBe("35 U.S.C. § 112(b) (2018)");
    expect(roundtrip("35 U.S.C.A. sec 103").plain).toBe("35 U.S.C. § 103");
    expect(roundtrip("35 USC §§ 101, 102").plain).toBe("35 U.S.C. §§ 101, 102");
  });

  test("messy C.F.R.", () => {
    expect(roundtrip("37 cfr 1.84").plain).toBe("37 C.F.R. § 1.84");
    expect(roundtrip("37 C.F.R. § 1.84 (2023)").plain).toBe("37 C.F.R. § 1.84 (2023)");
  });

  test("patents (with and without commas / keywords)", () => {
    expect(roundtrip("US Patent No. 10123456").plain).toBe("U.S. Patent No. 10,123,456");
    expect(roundtrip("U.S. Pat. No. 7,123,456").plain).toBe("U.S. Patent No. 7,123,456");
    expect(roundtrip("patent 8,987,654 (issued 3/1/2015)").plain).toBe("U.S. Patent No. 8,987,654 (issued Mar. 1, 2015)");
  });

  test("application publication", () => {
    expect(roundtrip("US Pub. No. 2020/0123456 A1").plain).toBe("U.S. Patent Application Publication No. 2020/0123456 A1");
    expect(roundtrip("Publication No. 20200123456").typeId).toBe("patent-app");
  });

  test("Federal Register", () => {
    expect(roundtrip("85 Fed. Reg. 12345 (Mar. 1, 2020)").plain).toBe("85 Fed. Reg. 12,345 (Mar. 1, 2020)");
    expect(roundtrip("85 fed reg 12,345 (March 1, 2020)").typeId).toBe("fedreg");
  });

  test("MPEP", () => {
    expect(roundtrip("MPEP 2106.05(a)").plain).toBe("MPEP § 2106.05(a)");
    expect(roundtrip("mpep § 2111").plain).toBe("MPEP § 2111");
  });

  test("cases — full, lower court, and In re", () => {
    expect(roundtrip("Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014)").plain).toBe(
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014)"
    );
    expect(roundtrip("in re bilski, 545 f.3d 943 (fed. cir. 2008)").typeId).toBe("case");
    const c = roundtrip("Mayo v. Prometheus, 566 U.S. 66 (2012)");
    expect(c.typeId).toBe("case");
    expect(c.plain).toBe("Mayo v. Prometheus, 566 U.S. 66 (2012)");
  });

  test("distinguishes a law-review article from a case", () => {
    const r = roundtrip("Mark A. Lemley, Software Patents, 2013 Wis. L. Rev. 905 (2013)");
    expect(r.typeId).toBe("article");
    expect(r.plain).toBe("Mark A. Lemley, Software Patents, 2013 Wis. L. Rev. 905 (2013)");
  });

  test("strips and re-applies a leading signal", () => {
    const r = roundtrip("See 35 U.S.C. § 101 (2018)");
    expect(r.signal).toBe("See");
    expect(r.plain).toBe("See 35 U.S.C. § 101 (2018)");
    expect(roundtrip("But see Alice Corp. v. CLS Bank, 573 U.S. 208 (2014)").signal).toBe("But see");
  });

  test("returns null on unrecognizable input", () => {
    expect(parseCitation("just some random prose here")).toBeNull();
    expect(parseCitation("")).toBeNull();
  });
});

describe("config integrity", () => {
  test("every type has a unique id, a name, and fields", () => {
    const ids = new Set<string>();
    for (const c of CITATIONS) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.fields.length).toBeGreaterThan(0);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });
  test("html output escapes ampersands in fields", () => {
    const r = fmt("book", { author: "A & B", title: "X & Y", year: "2020" });
    expect(r.html).toContain("A &amp; B");
    expect(r.html).toContain("<i>X &amp; Y</i>");
  });
});
