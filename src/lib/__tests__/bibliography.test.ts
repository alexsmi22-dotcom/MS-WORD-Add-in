// Bibliography assembly (docs/SCOPE-CITATIONS-2026-10.md §C3, §D Builder 4).
// The styles here are minimal STUBS coded to the frozen BibStyle interface, so these tests do
// not depend on Builder 3's bibStyles.ts. One block at the end loads the real styles if present.
// Invisible and combining characters are built with String.fromCharCode, never typed (the
// editing tools turn escape sequences into literal characters).

import * as fs from "fs";
import * as path from "path";
import type { BibRecord, BibStyle, CiteItem, Formatted } from "../bibRecord";
import type { BibStoreData } from "../bibStore";
import {
  EN_DASH, alphabeticalOrder, compressNumbers, numberRuns, renumberPlan, suffixLetter, withYearSuffix, yearOf,
} from "../bibliography";

// ------------------------------------------------------------------ stubs

const out = (html: string): Formatted => ({ html, plain: html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&") });

const yr = (r: BibRecord): string => {
  const y = r.issued?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" ? String(y) : r.issued?.literal ?? "n.d.";
};
const fam = (r: BibRecord): string => {
  const a = r.author?.[0];
  if (!a) return r.title ?? "";
  return a.literal ?? [a["non-dropping-particle"], a.family].filter(Boolean).join(" ");
};

/** Numeric stub: "[1–3, 5]"; refuses patents (as a real style may). */
const numericStub: BibStyle = {
  id: "vancouver", name: "Numeric stub", kind: "numeric", order: "citation",
  reference(r, n) {
    if (r.type === "patent") throw new Error("Numeric stub cannot format a patent reference.");
    return out(`${n}. ${fam(r)}. ${r.title ?? ""}. ${yr(r)}.`);
  },
  marker(items) {
    return out(`[${compressNumbers(items.map((i) => i.n!))}]`);
  },
};

/** IEEE-like stub: each number bracketed, "[1]–[3]". */
const bracketStub: BibStyle = {
  ...numericStub,
  marker: (items) => out(compressNumbers(items.map((i) => i.n!), { wrap: (n) => `[${n}]` })),
};

/** Author-date stub: "(Smith 2020, 45; Jones et al. 2019)". */
const authorDateStub: BibStyle = {
  id: "apa7", name: "Author-date stub", kind: "author-date", order: "alphabetical",
  reference(r) {
    return out(`${fam(r)}. ${yr(r)}. <i>${r.title ?? ""}</i>.`);
  },
  marker(items) {
    return out(`(${items.map(({ rec, item }) => {
      const who = (rec.author?.length ?? 0) > 2 ? `${fam(rec)} et al.` : fam(rec);
      return `${who} ${yr(rec)}${item.locator ? `, ${item.locator}` : ""}`;
    }).join("; ")})`);
  },
};

const rec = (id: string, family: string, year: number | null, title: string, extra: Partial<BibRecord> = {}): BibRecord => ({
  id, type: "article-journal", title, author: [{ family, given: "A." }],
  ...(year !== null ? { issued: { "date-parts": [[year]] } } : {}), ...extra,
});

const store = (records: BibRecord[], markers: Record<string, CiteItem[]>): BibStoreData => ({
  version: 1, style: "vancouver",
  library: Object.fromEntries(records.map((r) => [r.id, r])),
  markers,
});

const cite = (...ids: string[]): CiteItem[] => ids.map((id) => ({ id }));

const A = rec("a", "Adams", 2001, "Alpha");
const B = rec("b", "Brown", 2002, "Beta");
const C = rec("c", "Clark", 2003, "Gamma");
const D = rec("d", "Davis", 2004, "Delta");
const E = rec("e", "Evans", 2005, "Epsilon");

// ------------------------------------------------------------------ range compression

describe("compressNumbers (§C3: ranges only for 3+ consecutive)", () => {
  test("[1–3, 5] with an EN DASH (U+2013)", () => {
    const s = compressNumbers([1, 2, 3, 5]);
    expect(s).toBe("1–3, 5");
    expect(s.charCodeAt(1)).toBe(0x2013);
    expect(EN_DASH).toBe(String.fromCharCode(0x2013));
    expect(s).not.toContain("-");
  });
  test("[1], [2], [3] → [1]–[3]; [1], [3] stays as written", () => {
    const w = { wrap: (n: number) => `[${n}]` };
    expect(compressNumbers([1, 2, 3], w)).toBe("[1]–[3]");
    expect(compressNumbers([1, 3], w)).toBe("[1], [3]");
  });
  test("two consecutive are listed, not ranged", () => {
    expect(compressNumbers([4, 5])).toBe("4, 5");
    expect(compressNumbers([1, 2, 4, 5, 6, 9])).toBe("1, 2, 4–6, 9");
  });
  test("unsorted and repeated numbers", () => {
    expect(compressNumbers([3, 1, 2, 2])).toBe("1–3");
    expect(numberRuns([7, 5, 6, 1])).toEqual([[1, 1], [5, 7]]);
  });
  test("compress: false (IEEE's rule, taken from the style) writes every number", () => {
    expect(compressNumbers([1, 2, 3, 4], { wrap: (n) => `[${n}]`, compress: false })).toBe("[1], [2], [3], [4]");
  });
  test("compress flag follows bibStyles STYLE_RULES when present", () => {
    let rules: Record<string, { compressRanges: boolean }> | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      rules = require("../bibStyles").STYLE_RULES;
    } catch { /* covered by the integration block */ }
    if (!rules) return;
    expect(compressNumbers([1, 2, 3], { wrap: (n) => `[${n}]`, compress: rules.ieee.compressRanges })).toBe("[1], [2], [3]");
    expect(compressNumbers([1, 2, 3], { compress: rules.vancouver.compressRanges })).toBe("1–3");
  });
  test("custom separator and minimum run", () => {
    expect(compressNumbers([1, 2, 3], { sep: ",", minRun: 2 })).toBe("1–3");
    expect(compressNumbers([1, 2], { sep: ",", minRun: 2 })).toBe("1–2");
    expect(compressNumbers([])).toBe("");
  });
});

// ------------------------------------------------------------------ numbering

describe("numbering in citation order", () => {
  const st = store([A, B, C, D], { "1": cite("b"), "2": cite("a", "c"), "3": cite("b") });

  test("first citation in document order decides the number", () => {
    const p = renumberPlan(["1", "2", "3"], st, numericStub);
    expect(p.numbers).toEqual({ b: 1, a: 2, c: 3 });
    expect(p.markerText["1"].plain).toBe("[1]");
    expect(p.markerText["2"].plain).toBe("[2, 3]");
    expect(p.markerText["3"].plain).toBe("[1]");
    expect(p.bibliography.map((f) => f.plain)).toEqual(["1. Brown. Beta. 2002.", "2. Adams. Alpha. 2001.", "3. Clark. Gamma. 2003."]);
    expect(p.uncited).toEqual(["d"]);
    expect(p.missing).toEqual([]);
  });

  test("[1–3, 5] in one marker", () => {
    const s2 = store([A, B, C, D, E], { "1": cite("a", "b", "c", "d"), "2": cite("e"), "3": cite("a", "b", "c", "e") });
    const p = renumberPlan(["1", "2", "3"], s2, numericStub);
    expect(p.markerText["3"].plain).toBe("[1–3, 5]");
    expect(renumberPlan(["1", "2", "3"], s2, bracketStub).markerText["3"].plain).toBe("[1]–[3], [5]");
  });

  test("moving marker 3 before marker 1 renumbers all of them, and the plan is idempotent", () => {
    const s3 = store([A, B, C], { "1": cite("a"), "2": cite("b"), "3": cite("c") });
    const before = renumberPlan(["1", "2", "3"], s3, numericStub);
    expect([before.markerText["1"].plain, before.markerText["2"].plain, before.markerText["3"].plain]).toEqual(["[1]", "[2]", "[3]"]);
    const occ = [
      { markerId: "3", text: before.markerText["3"].plain },
      { markerId: "1", text: before.markerText["1"].plain },
      { markerId: "2", text: before.markerText["2"].plain },
    ];
    const moved = renumberPlan(occ, s3, numericStub);
    expect(moved.markerText["3"].plain).toBe("[1]");
    expect(moved.markerText["1"].plain).toBe("[2]");
    expect(moved.markerText["2"].plain).toBe("[3]");
    expect(moved.changed).toEqual(["3", "1", "2"]);
    expect(moved.bibliography[0].plain).toBe("1. Clark. Gamma. 2003.");
    // Second run over the updated document: nothing changes.
    const again = renumberPlan(occ.map((o) => ({ markerId: o.markerId, text: moved.markerText[o.markerId].plain })), s3, numericStub);
    expect(again.changed).toEqual([]);
    expect(again.markerText).toEqual(moved.markerText);
    expect(again.bibliography).toEqual(moved.bibliography);
  });

  test("a cite that moves earlier renumbers everything after it, not before it", () => {
    const s4 = store([A, B, C, D], { "1": cite("a"), "2": cite("b"), "3": cite("c"), "4": cite("d") });
    const p = renumberPlan(["1", "4", "2", "3"], s4, numericStub);
    expect(p.numbers).toEqual({ a: 1, d: 2, b: 3, c: 4 });
  });

  test("a deleted marker drops its entry unless it is cited elsewhere", () => {
    const s5 = store([A, B, C], { "1": cite("a"), "2": cite("b"), "3": cite("c"), "4": cite("b") });
    const gone = renumberPlan(["1", "3"], s5, numericStub);
    expect(gone.entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(gone.uncited).toEqual(["b"]);
    expect(gone.staleStoreMarkers).toEqual(["2", "4"]);
    expect(gone.markerText["3"].plain).toBe("[2]");
    const kept = renumberPlan(["1", "3", "4"], s5, numericStub);
    expect(kept.entries.map((e) => e.id)).toEqual(["a", "c", "b"]);
    expect(kept.uncited).toEqual([]);
    expect(kept.staleStoreMarkers).toEqual(["2"]);
  });

  test("the same id twice in one marker is numbered once", () => {
    const p = renumberPlan(["1"], store([A], { "1": cite("a", "a") }), numericStub);
    expect(p.entries).toHaveLength(1);
    expect(p.markerText["1"].plain).toBe("[1]");
  });

  test("the store is not mutated", () => {
    const s6 = store([A, B], { "1": cite("b", "a") });
    const snap = JSON.stringify(s6);
    renumberPlan(["1"], s6, numericStub);
    renumberPlan(["1"], s6, authorDateStub);
    expect(JSON.stringify(s6)).toBe(snap);
  });
});

// ------------------------------------------------------------------ reports, never silent drops

describe("nothing is dropped silently", () => {
  test("numeric: a marker whose record is missing reads “?” (never a stale number) and is reported by name", () => {
    const s = store([A, B], { "1": cite("a"), "2": cite("ghost2020", "b"), "3": cite("b") });
    const p = renumberPlan([{ markerId: "1", text: "[1]" }, { markerId: "2", text: "[2, 3]" }, { markerId: "3", text: "[3]" }], s, numericStub);
    expect(p.missing).toEqual([{ markerId: "2", markerText: "[2, 3]", id: "ghost2020", placeholder: "[2, ?]" }]);
    expect(p.markerText["2"].plain).toBe("[2, ?]");
    expect(p.occurrences[1].text?.plain).toBe("[2, ?]");
    expect(p.problems.join("\n")).toContain(
      "Citation “[2, 3]” (marker 2) cites “ghost2020”, which is not in the reference library; it now reads “[2, ?]” until the reference is imported again or the citation is removed.");
    // b is still cited (by marker 2 and 3) and still listed; the missing one gets no number.
    expect(p.numbers).toEqual({ a: 1, b: 2 });
    expect(p.markerText["3"].plain).toBe("[2]");
  });

  test("numeric: the deleted reference's old [1] cannot collide with the new [1]", () => {
    const s = store([A, B], { "1": cite("a"), "2": cite("gone"), "3": cite("b") });
    const p = renumberPlan([{ markerId: "2", text: "[1]" }, { markerId: "1", text: "[2]" }, { markerId: "3", text: "[3]" }], s, bracketStub);
    expect(p.occurrences.map((o) => o.text?.plain)).toEqual(["[?]", "[1]", "[2]"]);
    expect(p.changed).toEqual(["2", "1", "3"]);
  });

  test("author-date: a missing-record marker has no number to collide, so it is left unchanged", () => {
    const p = renumberPlan([{ markerId: "1", text: "(Gone 2019)" }], store([A], { "1": cite("gone") }), authorDateStub);
    expect(p.markerText["1"]).toBeUndefined();
    expect(p.missing).toEqual([{ markerId: "1", markerText: "(Gone 2019)", id: "gone" }]);
    expect(p.problems.join("\n")).toContain("Citation “(Gone 2019)” (marker 1) cites “gone”, which is not in the reference library; the citation was left unchanged.");
  });

  test("a control whose marker id the store does not know is reported", () => {
    const p = renumberPlan([{ markerId: "zz", text: "[9]" }, "1"], store([A], { "1": cite("a") }), numericStub);
    expect(p.unknownMarkers).toEqual([{ markerId: "zz", markerText: "[9]" }]);
    expect(p.occurrences[0].text).toBeNull();
    expect(p.problems[0]).toContain("Citation “[9]” (marker zz)");
  });

  test("a copied marker (duplicate tag) shows the same text at every copy and is reported", () => {
    const p = renumberPlan(["1", "2", "1"], store([A, B], { "1": cite("a"), "2": cite("b") }), numericStub);
    expect(p.duplicateMarkerIds).toEqual(["1"]);
    expect(p.occurrences.map((o) => o.text?.plain)).toEqual(["[1]", "[2]", "[1]"]);
  });

  test("an empty marker is reported, not rendered as []", () => {
    const p = renumberPlan(["1"], store([A], { "1": [] }), numericStub);
    expect(p.markerText["1"]).toBeUndefined();
    expect(p.problems[0]).toContain("cites no references");
  });

  test("a reference the style refuses takes no number, its citation reads ?, and it is reported", () => {
    // Release D: numbering a refused reference left the text citing [1–3] over a list printed 1, 3.
    const pat: BibRecord = { id: "pat", type: "patent", title: "Widget" };
    const p = renumberPlan(["1"], store([A, pat, B], { "1": cite("a", "pat", "b") }), numericStub);
    expect(p.refused).toEqual([{ id: "pat", reason: "Numeric stub cannot format a patent reference." }]);
    expect(p.entries.map((e) => [e.id, e.n, e.formatted === null])).toEqual([["a", 1, false], ["pat", undefined, true], ["b", 2, false]]);
    expect(p.bibliography.map((f) => f.plain[0])).toEqual(["1", "2"]);
    expect(p.markerText["1"].plain).toContain("?");
    expect(p.markerText["1"].plain).not.toMatch(/3/);
    expect(p.problems.some((s) => s.includes("“pat”"))).toBe(true);
  });

  test("a marker the style refuses is reported, not dropped", () => {
    const bad: BibStyle = { ...numericStub, marker: () => { throw new Error("nope"); } };
    const p = renumberPlan(["1"], store([A], { "1": cite("a") }), bad);
    expect(p.refused).toEqual([{ markerId: "1", reason: "nope" }]);
    expect(p.occurrences[0].text).toBeNull();
  });
});

// ------------------------------------------------------------------ alphabetical order

describe("alphabetical order", () => {
  const person = (id: string, family: string, given: string, year: number, ndp?: string, title = "T"): BibRecord => ({
    id, type: "book", title, issued: { "date-parts": [[year]] },
    author: [{ family, given, ...(ndp ? { "non-dropping-particle": ndp } : {}) }],
  });
  const bach = person("bach", "Bach", "Johann Sebastian", 1750);
  const beet = person("beet", "Beethoven", "Ludwig", 1810, "van");
  const brahms = person("brahms", "Brahms", "Johannes", 1880);
  const turing = person("turing", "Turing", "Alan", 1936);
  const wagner = person("wagner", "Wagner", "Richard", 1850);
  const all = [wagner, brahms, beet, turing, bach];

  test("particle first (APA 7: van Beethoven under V)", () => {
    expect(alphabeticalOrder(all, { sortParticleFirst: true }).map((r) => r.id)).toEqual(["bach", "brahms", "turing", "beet", "wagner"]);
  });
  test("particle demoted (van Beethoven under B)", () => {
    expect(alphabeticalOrder(all, { sortParticleFirst: false }).map((r) => r.id)).toEqual(["bach", "beet", "brahms", "turing", "wagner"]);
  });
  test("a dropping particle never leads the key", () => {
    const dp: BibRecord = { id: "dp", type: "book", author: [{ family: "Gaulle", given: "Charles", "dropping-particle": "de" }] };
    expect(alphabeticalOrder([dp, wagner, bach]).map((r) => r.id)).toEqual(["bach", "dp", "wagner"]);
  });
  test("the same author across years: earliest first; undated before dated", () => {
    const s21 = person("s21", "Smith", "J.", 2021);
    const s19 = person("s19", "Smith", "J.", 2019);
    const snd: BibRecord = { id: "snd", type: "book", author: [{ family: "Smith", given: "J." }] };
    expect(alphabeticalOrder([s21, s19, snd]).map((r) => r.id)).toEqual(["snd", "s19", "s21"]);
  });
  test("one author before the same author with co-authors", () => {
    const solo = person("solo", "Smith", "J.", 2022);
    const duo: BibRecord = { ...person("duo", "Smith", "J.", 2001), author: [{ family: "Smith", given: "J." }, { family: "Jones", given: "K." }] };
    expect(alphabeticalOrder([duo, solo]).map((r) => r.id)).toEqual(["solo", "duo"]);
  });
  test("given name breaks a family tie; corporate authors file as written", () => {
    const sj = person("sj", "Smith", "John", 2000);
    const sa = person("sa", "Smith", "Anna", 2020);
    const who: BibRecord = { id: "who", type: "report", author: [{ literal: "World Health Organization" }] };
    expect(alphabeticalOrder([who, sj, sa]).map((r) => r.id)).toEqual(["sa", "sj", "who"]);
  });
  test("no author: the title files, without a leading article", () => {
    const anon: BibRecord = { id: "anon", type: "webpage", title: "The Zebra Report" };
    const yak = person("yak", "Yates", "A.", 2000);
    expect(alphabeticalOrder([anon, yak]).map((r) => r.id)).toEqual(["yak", "anon"]);
  });
  test("decomposed and precomposed accents collate the same (NFC)", () => {
    // Built from code points: E + COMBINING ACUTE (0x301) vs precomposed E-acute (0xC9).
    const decomposed = "E" + String.fromCharCode(0x301) + "mile";
    const precomposed = String.fromCharCode(0xc9) + "mile";
    expect(decomposed).not.toBe(precomposed);
    const nfd = person("nfd", decomposed, "A.", 2001);
    const nfc = person("nfc", precomposed, "A.", 2000);
    // Equal names after NFC, so the year decides.
    expect(alphabeticalOrder([nfd, nfc]).map((r) => r.id)).toEqual(["nfc", "nfd"]);
  });
  test("alphabetical plan: entries in sorted order, author-date markers unnumbered", () => {
    const s = store([wagner, bach], { "1": cite("wagner"), "2": cite("bach") });
    const p = renumberPlan(["1", "2"], s, authorDateStub);
    expect(p.entries.map((e) => e.id)).toEqual(["bach", "wagner"]);
    expect(p.numbers).toEqual({});
    expect(p.markerText["1"].plain).toBe("(Wagner 1850)");
  });
});

// ------------------------------------------------------------------ 2020a / 2020b

describe("year-suffix disambiguation", () => {
  test("suffix letters", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(suffixLetter)).toEqual(["a", "b", "z", "aa", "ab", "az", "ba"]);
  });

  test("same author, same year → 2020a / 2020b in title order; marker and list agree", () => {
    const beta = rec("s1", "Smith", 2020, "Beta study");
    const alpha = rec("s2", "Smith", 2020, "Alpha study");
    const older = rec("s0", "Smith", 2019, "Old study");
    const s = store([beta, alpha, older], { "1": [{ id: "s1", locator: "45" }], "2": cite("s2", "s0") });
    const p = renumberPlan(["1", "2"], s, authorDateStub);
    expect(p.entries.map((e) => [e.id, e.yearSuffix])).toEqual([["s0", undefined], ["s2", "a"], ["s1", "b"]]);
    expect(p.bibliography.map((f) => f.plain)).toEqual([
      "Smith. 2019. Old study.", "Smith. 2020a. Alpha study.", "Smith. 2020b. Beta study.",
    ]);
    expect(p.markerText["1"].plain).toBe("(Smith 2020b, 45)");
    expect(p.markerText["2"].plain).toBe("(Smith 2020a; Smith 2019)");
    // The store records still say 2020.
    expect(s.library.s1.issued).toEqual({ "date-parts": [[2020]] });
  });

  test("different authors in the same year are not suffixed", () => {
    const p = renumberPlan(["1"], store([rec("x", "Smith", 2020, "X"), rec("y", "Jones", 2020, "Y")], { "1": cite("x", "y") }), authorDateStub);
    expect(p.entries.every((e) => e.yearSuffix === undefined)).toBe(true);
  });

  test("et al. collisions between different teams get names, not letters (review defect 7)", () => {
    const three = (id: string, co: string, title: string): BibRecord => ({
      id, type: "article-journal", title, issued: { "date-parts": [[2020]] },
      author: [{ family: "Smith" }, { family: co }, { family: "Brown" }],
    });
    const p = renumberPlan(["1"], store([three("p", "Jones", "P"), three("q", "Lee", "Q")], { "1": cite("p", "q") }), authorDateStub);
    expect(p.markerText["1"].plain).toBe("(Smith, Jones, et al. 2020; Smith, Lee, et al. 2020)");
  });

  test("different people who share a surname: initials, not letters (APA 8.20)", () => {
    const j: BibRecord = { ...rec("j", "Smith", 2020, "Alpha"), author: [{ family: "Smith", given: "John" }] };
    const a: BibRecord = { ...rec("a", "Smith", 2020, "Beta"), author: [{ family: "Smith", given: "Anna Marie" }] };
    const p = renumberPlan(["1"], store([j, a], { "1": cite("j", "a") }), authorDateStub);
    expect(p.entries.every((e) => e.yearSuffix === undefined)).toBe(true);
    expect(p.markerText["1"].plain).toBe("(J. Smith 2020; A. M. Smith 2020)");
    expect(p.bibliography.map((b) => b.plain)).toEqual(["Smith. 2020. Beta.", "Smith. 2020. Alpha."]);
    expect(p.ambiguous).toEqual([]);
  });

  test("teams that shorten to the same et al.: names until they differ (APA 8.18), no letters", () => {
    const team = (id: string, second: string): BibRecord => ({
      id, type: "article-journal", title: id, issued: { "date-parts": [[2020]] },
      author: [{ family: "Smith", given: "J" }, { family: second, given: "K" }, { family: "Brown", given: "L" }],
    });
    const p = renumberPlan(["1"], store([team("p", "Jones"), team("q", "Lee")], { "1": cite("p", "q") }), authorDateStub);
    expect(p.markerText["1"].plain).toBe("(Smith, Jones, et al. 2020; Smith, Lee, et al. 2020)");
    expect(p.entries.every((e) => e.yearSuffix === undefined)).toBe(true);
  });

  test("teams that differ only in the last name are reported by name, never lettered", () => {
    const team = (id: string, last: string): BibRecord => ({
      id, type: "article-journal", title: id, issued: { "date-parts": [[2020]] },
      author: [{ family: "Smith" }, { family: "Jones" }, { family: last }],
    });
    const p = renumberPlan(["1"], store([team("p", "Brown"), team("q", "Kim")], { "1": cite("p", "q") }), authorDateStub);
    expect(p.entries.every((e) => e.yearSuffix === undefined)).toBe(true);
    expect(p.ambiguous).toEqual([{ ids: ["p", "q"], text: "(Smith et al. 2020)" }]);
    expect(p.problems.join(" ")).toContain("“p” and “q”");
  });

  test("undated works by one author: n.d.-a, n.d.-b (APA 9.47); in press-a likewise", () => {
    const u1 = rec("u1", "Smith", null, "Beta");
    const u2 = rec("u2", "Smith", null, "Alpha");
    const p = renumberPlan(["1"], store([u1, u2], { "1": cite("u1", "u2") }), authorDateStub);
    expect(p.markerText["1"].plain).toBe("(Smith n.d.-b; Smith n.d.-a)");
    expect(p.bibliography.map((b) => b.plain)).toEqual(["Smith. n.d.-a. Alpha.", "Smith. n.d.-b. Beta."]);
    const ip = (id: string, t: string): BibRecord => ({ ...rec(id, "Doe", null, t), issued: { literal: "in press" } });
    const q = renumberPlan(["1"], store([ip("i1", "A"), ip("i2", "B")], { "1": cite("i1", "i2") }), authorDateStub);
    expect(q.markerText["1"].plain).toBe("(Doe in press-a; Doe in press-b)");
  });

  test("numeric styles never get suffixes", () => {
    const p = renumberPlan(["1"], store([rec("s1", "Smith", 2020, "B"), rec("s2", "Smith", 2020, "A")], { "1": cite("s1", "s2") }), numericStub);
    expect(p.entries.every((e) => e.yearSuffix === undefined)).toBe(true);
    expect(p.bibliography[0].plain).toContain("2020.");
  });

  test("withYearSuffix clones; an undated record becomes n.d.-a", () => {
    const r = rec("r", "Smith", 2020, "T");
    expect(withYearSuffix(r, "a").issued).toEqual({ literal: "2020a" });
    expect(r.issued).toEqual({ "date-parts": [[2020]] });
    const nd = rec("n", "Smith", null, "T");
    expect(withYearSuffix(nd, "a").issued).toEqual({ literal: "n.d.-a" });
    expect(nd.issued).toBeUndefined();
    expect(yearOf({ id: "l", type: "book", issued: { literal: "Spring 1999" } })).toBe(1999);
  });
});

// ------------------------------------------------------------------ display contract

describe("display contract", () => {
  test("Unicode in titles survives into the bibliography, plain and html", () => {
    const t = "H₂O and CO₂ on MoS₂ at 5 Å: ¹³C NMR of α-µ sites";
    const r: BibRecord = { ...rec("u", "Ångström", 2020, t), title: t };
    const p = renumberPlan(["1"], store([r], { "1": cite("u") }), authorDateStub);
    expect(p.bibliography[0].plain).toContain(t);
    expect(p.bibliography[0].html).toContain(t);
    expect(p.bibliography[0].plain).toContain("Ångström");
    expect(p.bibliography[0].plain).not.toMatch(/H2O|CO2|\^/);
  });
});

// ------------------------------------------------------------------ scale

describe("1,000 references", () => {
  const N = 1000;
  const fams = ["Smith", "Jones", "García Márquez", "Müller", "Nguyen", "Zhang", "O'Brien", "Ølstad"];
  const recs: BibRecord[] = Array.from({ length: N }, (_, i) => ({
    id: `r${i}`, type: "article-journal", title: `Study ${(i * 7919) % N} of H₂O`,
    author: [{ family: fams[i % fams.length], given: `G${i % 13}` }, ...(i % 3 ? [{ family: "Co", given: "A" }] : [])],
    ...(i % 50 === 0 ? { author: [{ family: "Smith", given: "G0", "non-dropping-particle": "van" }] } : {}),
    issued: { "date-parts": [[1990 + (i % 30)]] },
  }));
  const markers: Record<string, CiteItem[]> = {};
  for (let i = 0; i < N; i++) markers[(i + 1).toString(36)] = cite(`r${(i * 37) % N}`, `r${(i * 11 + 3) % N}`);
  const st = store(recs, markers);
  const order = Object.keys(markers);

  test("numeric plan under 1 s", () => {
    const t0 = Date.now();
    const p = renumberPlan(order, st, numericStub);
    const ms = Date.now() - t0;
    expect(p.entries).toHaveLength(N);
    expect(p.problems.filter((s) => !s.startsWith("Not cited"))).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  test("author-date plan (sort + disambiguation) under 1 s", () => {
    const t0 = Date.now();
    const p = renumberPlan(order, st, authorDateStub, { sortParticleFirst: true });
    const ms = Date.now() - t0;
    expect(p.bibliography).toHaveLength(N);
    // Many same-surname / same-et-al. collisions, all resolved or reported within budget.
    expect(p.entries.length).toBe(N);
    expect(ms).toBeLessThan(1000);
  });
});

// ------------------------------------------------------------------ source hygiene

describe("Builder 4 sources hold no invisible characters", () => {
  const files = ["bibliography.ts", "bibStore.ts", "bibOoxml.ts", "__tests__/bibliography.test.ts", "__tests__/bibStore.test.ts"];
  const bad = (c: number): boolean =>
    c === 0xfeff || (c >= 0x200b && c <= 0x200d) || c === 0xa0 || (c >= 0x300 && c <= 0x36f)
    || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff;
  test("the scanner itself flags each hazard and passes visible Unicode", () => {
    expect([0xfeff, 0x200b, 0x200c, 0x200d, 0xa0, 0x301, 0x08].every(bad)).toBe(true);
    expect(["–", "₂", "Å", "µ", "“"].map((s) => s.charCodeAt(0)).some(bad)).toBe(false);
  });
  test.each(files)("%s", (f) => {
    const p = path.join(__dirname, "..", f);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, "utf8");
    const hits: string[] = [];
    src.split("\n").forEach((line, i) => {
      for (let k = 0; k < line.length; k++) {
        if (bad(line.charCodeAt(k))) hits.push(`line ${i + 1} col ${k + 1}: U+${line.charCodeAt(k).toString(16).toUpperCase().padStart(4, "0")}`);
      }
    });
    expect(hits).toEqual([]);
  });
});

// ------------------------------------------------------------------ the real styles (Builder 3), if present

describe("integration with bibStyles.ts", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any = null;
  let why = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("../bibStyles");
  } catch (e) {
    why = (e as Error).message;
  }
  const real = mod && typeof mod.getStyle === "function" ? test : test.skip;
  if (!mod) {
    // eslint-disable-next-line no-console
    console.warn(`bibStyles.ts not loadable; real-style integration skipped: ${why}`);
  }

  const art = (id: string, family: string, given: string, year: number, title: string): BibRecord => ({
    id, type: "article-journal", title, "container-title": "Journal of Testing", "container-title-short": "J. Test.",
    author: [{ family, given }], issued: { "date-parts": [[year]] }, volume: "12", issue: "3", page: "100-110",
  });
  const recs = [art("a", "Adams", "Ann", 2001, "Alpha of H₂O"), art("b", "Brown", "Bob", 2002, "Beta"),
    art("c", "Clark", "Cy", 2003, "Gamma"), art("d", "Davis", "Di", 2004, "Delta")];
  const st = store(recs, { "1": cite("a", "b", "c"), "2": cite("a", "c"), "3": cite("d") });

  real("Vancouver: numbering, compression, H₂O kept", () => {
    const p = renumberPlan(["1", "2", "3"], st, mod.getStyle("vancouver"));
    expect(p.numbers).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    expect(p.refused).toEqual([]);
    expect(p.markerText["1"].plain).toContain(`1${EN_DASH}3`);
    expect(p.markerText["2"].plain).not.toContain(EN_DASH);
    expect(p.bibliography[0].plain).toContain("H₂O");
  });

  real("IEEE: numbers in citation order; marker as the 2025 guide prints it (no ranges)", () => {
    const p = renumberPlan(["3", "1"], st, mod.getStyle("ieee"));
    expect(p.numbers).toEqual({ d: 1, a: 2, b: 3, c: 4 });
    expect(p.markerText["1"].plain).toBe("[2], [3], [4]");
  });

  real("APA 7: alphabetical, 2020a/2020b from the real style", () => {
    const s = store([art("x", "Smith", "Jo", 2020, "Zeta work"), art("y", "Smith", "Jo", 2020, "Eta work"), art("z", "Adams", "Al", 2020, "Q")],
      { "1": cite("x"), "2": cite("y", "z") });
    const p = renumberPlan(["1", "2"], s, mod.getStyle("apa7"), { sortParticleFirst: mod.STYLE_RULES.apa7.sortParticleFirst });
    expect(p.entries.map((e) => [e.id, e.yearSuffix])).toEqual([["z", undefined], ["y", "a"], ["x", "b"]]);
    expect(p.markerText["1"].plain).toContain("2020b");
    expect(p.bibliography[1].plain).toContain("2020a");
  });
});
