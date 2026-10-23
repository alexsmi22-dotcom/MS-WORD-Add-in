// Optica (formerly OSA) reference style: verbatim examples from the publisher's own guide,
// pinned as CSL-JSON in → exact text and html out, plus adversarial rows.
//
// SOURCE: Optica Publishing Group, "Optica Publishing Group Journal Style Guide", §3 "References
// and notes", https://opg.optica.org/content/author/portal/item/style-optica-styleguide/
// (page meta updatedAt 2026-08-20; fetched 2026-10-22). One guide for every Optica journal
// (Optics Letters, Optics Express, Optica, JOSA A/B, Applied Optics …); it does not give a
// separate Optics Letters form. The `guide` strings below are the page's HTML, character for
// character.
//
// TWO DELIBERATE NORMALISATIONS (and only these), applied by `typeset()`: the web page is typed
// in ASCII, so (1) a hyphen between digits in a page range becomes the en dash (display
// contract; the guide's own text asks for "an en dash [1–4]" and the journals print 262–270),
// and (2) straight double quotes become curly quotes, as the journals print them. <em>/<strong>
// are the guide's tags for what the formatter writes as <i>/<b>.

import type { BibName, BibRecord, BibType, CiteItem } from "../bibRecord";
import { BibStyleRefusal, STYLES, STYLE_INFO, STYLE_RULES, formatReference, referenceWarnings } from "../bibStyles";
import { renumberPlan } from "../bibliography";
import { bibLabel, collectCitations, offeredStyles, planInsert, planUpdate, typeRefusals } from "../bibPane";
import { citeTag, emptyStore, parseStore } from "../bibStore";
import type { BibStoreData } from "../bibStore";

const optica = STYLES.optica!;

const p = (family: string, given?: string, extra: Partial<BibName> = {}): BibName =>
  ({ family, ...(given ? { given } : {}), ...extra });
let seq = 0;
const R = (type: BibType, f: Omit<BibRecord, "id" | "type">): BibRecord => ({ id: `o${++seq}`, type, ...f });
const Y = (y: number): BibRecord["issued"] => ({ "date-parts": [[y]] });

/** The guide's ASCII HTML → what the journals print (see the header). */
function typeset(guideHtml: string): string {
  return guideHtml
    .replace(/<em>/g, "<i>").replace(/<\/em>/g, "</i>")
    .replace(/<strong>/g, "<b>").replace(/<\/strong>/g, "</b>")
    .replace(/(\d)-(\d)/g, "$1–$2")
    .replace(/(^|[\s(\[])"/g, "$1“")
    .replace(/"/g, "”");
}
const strip = (h: string): string => h.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");

interface Example { name: string; guide: string; rec: BibRecord; htmlExact: boolean }

const GUIDE: Example[] = [
  {
    name: "Wang (journal article in regular issue; more than three authors)",
    guide: "T. Wang, Y. Ge, J. Chang, <em>et al.</em>, \"Wavelength-interrogation Fabry-Perot refractive index sensor based on a sealed in-fiber cavity,\" IEEE Photon. Technol. Lett. <strong>28,</strong> 3-6 (2016).",
    rec: R("article-journal", {
      author: [p("Wang", "T."), p("Ge", "Y."), p("Chang", "J."), p("Zhang", "X.")],
      title: "Wavelength-interrogation Fabry-Perot refractive index sensor based on a sealed in-fiber cavity",
      "container-title": "IEEE Photonics Technology Letters", "container-title-short": "IEEE Photon. Technol. Lett.",
      volume: "28", page: "3-6", issued: Y(2016),
    }),
    htmlExact: true,
  },
  {
    name: "Gomez (issue number; particle in a name)",
    guide: "C. Gomez, R. Su, P. de Groot, <em>et al.</em>, \"Noise reduction in coherence scanning interferometry for surface topography measurement,\" Nanomanuf. Metrol. <strong>3</strong>(2), 1-12 (2020).",
    rec: R("article-journal", {
      author: [p("Gomez", "C."), p("Su", "R."), p("Groot", "P.", { "non-dropping-particle": "de" }), p("Leach", "R.")],
      title: "Noise reduction in coherence scanning interferometry for surface topography measurement",
      "container-title-short": "Nanomanuf. Metrol.", volume: "3", issue: "2", page: "1-12", issued: Y(2020),
    }),
    htmlExact: true,
  },
  {
    name: "Deck and Soobitsky (Proc. SPIE, set as a journal)",
    guide: "L. Deck and J. A. Soobitsky, \"Phase-shifting via wavelength tuning in very large aperture interferometers,\" Proc. SPIE <strong>3782,</strong> 432-442 (1999).",
    rec: R("article-journal", {
      author: [p("Deck", "L."), p("Soobitsky", "J. A.")],
      title: "Phase-shifting via wavelength tuning in very large aperture interferometers",
      "container-title": "Proceedings of SPIE", "container-title-short": "Proc. SPIE", volume: "3782", page: "432-442", issued: Y(1999),
    }),
    htmlExact: true,
  },
  {
    // The et al. rule's own example, in running text: no title, et al. and volume not styled.
    name: "Haddad (the et al. rule's example; no title)",
    guide: "W. S. Haddad, D. Cullen, J. C. Solem, et al., Appl. Opt. 31, 4973-4980 (1992).",
    rec: R("article-journal", {
      author: [p("Haddad", "W. S."), p("Cullen", "D."), p("Solem", "J. C."), p("Longworth", "J. W.")],
      "container-title-short": "Appl. Opt.", volume: "31", page: "4973-4980", issued: Y(1992),
    }),
    htmlExact: false,
  },
];

describe("Optica guide examples, verbatim (journal articles)", () => {
  test.each(GUIDE)("$name", ({ guide, rec, htmlExact }) => {
    const f = optica.reference(rec);
    const want = typeset(guide);
    expect(f.plain).toBe(strip(want));
    if (htmlExact) expect(f.html).toBe(want);
  });
  test("at least three pinned examples for every claimed type", () => {
    expect(STYLE_INFO.optica.types).toEqual(["article-journal"]);
    expect(GUIDE.filter((g) => g.rec.type === "article-journal").length).toBeGreaterThanOrEqual(3);
  });
  test("the guide's own number labels: “5. W. S. Haddad…”, “1. J. Smith…”", () => {
    expect(bibLabel("optica")!(5)).toBe("5.");
    expect(bibLabel("optica")!(1)).toBe("1.");
  });
  test("the two guide examples the record contract cannot fully hold format up to the missing part", () => {
    // Frieden: "…, J. Opt. Soc. Am. <strong>57,</strong> 56-66 (1967), special issue on Optical Transfer."
    const frieden = optica.reference(R("article-journal", {
      author: [p("Frieden", "R.")], title: "Optical transfer of the three-dimensional object",
      "container-title-short": "J. Opt. Soc. Am.", volume: "57", page: "56-66", issued: Y(1967),
    }));
    expect(frieden.html).toBe(typeset("R. Frieden, \"Optical transfer of the three-dimensional object,\" J. Opt. Soc. Am. <strong>57,</strong> 56-66 (1967)."));
    // Sherman: "… Phys. Usp. <strong>53,</strong> 546-547 (2010) [Usp. Fiz. Nauk …]."
    const sherman = optica.reference(R("article-journal", {
      author: [p("Sherman", "C.")], title: "Application of the convolution theorem to Rayleigh's integral formulas",
      "container-title-short": "Phys. Usp.", volume: "53", page: "546-547", issued: Y(2010),
    }));
    expect(sherman.plain).toBe("C. Sherman, “Application of the convolution theorem to Rayleigh's integral formulas,” Phys. Usp. 53, 546–547 (2010).");
  });
});

describe("the brief's two shapes", () => {
  test("Pancharatnam: no title, volume with a letter", () => {
    const f = optica.reference(R("article-journal", {
      author: [p("Pancharatnam", "S.")], "container-title-short": "Proc. Indian Acad. Sci.", volume: "41A", page: "137", issued: Y(1955),
    }));
    expect(f.plain).toBe("S. Pancharatnam, Proc. Indian Acad. Sci. 41A, 137 (1955).");
    expect(f.html).toBe("S. Pancharatnam, Proc. Indian Acad. Sci. <b>41A,</b> 137 (1955).");
  });
  test("Wahle and Kitzerow: two authors, titled, Opt. Express", () => {
    const f = optica.reference(R("article-journal", {
      author: [p("Wahle", "Markus"), p("Kitzerow", "Heinz-Siegfried")], title: "Liquid crystal assisted optical fibres",
      "container-title": "Optics Express", "container-title-short": "Opt. Express", volume: "22", page: "262-270", issued: Y(2014),
    }));
    expect(f.plain).toBe("M. Wahle and H.-S. Kitzerow, “Liquid crystal assisted optical fibres,” Opt. Express 22, 262–270 (2014).");
  });
});

// ------------------------------------------------------------------ adversarial case table
const base = { title: "T", "container-title-short": "Opt. Lett.", volume: "40", issued: Y(2015) } as const;
type Case = [string, Omit<BibRecord, "id" | "type">, string];
const CASES: Case[] = [
  ["exactly three authors: all listed, serial and", { ...base, author: [p("Aa", "A."), p("Bb", "B."), p("Cc", "C.")], page: "1-2" },
    "A. Aa, B. Bb, and C. Cc, “T,” Opt. Lett. 40, 1–2 (2015)."],
  ["four authors: first three, et al.", { ...base, author: [p("Aa", "A."), p("Bb", "B."), p("Cc", "C."), p("Dd", "D.")], page: "1-2" },
    "A. Aa, B. Bb, C. Cc, et al., “T,” Opt. Lett. 40, 1–2 (2015)."],
  ["thirty authors: still first three", { ...base, author: Array.from({ length: 30 }, (_, i) => p(`N${i}`, "Q.")), page: "1-2" },
    "Q. N0, Q. N1, Q. N2, et al., “T,” Opt. Lett. 40, 1–2 (2015)."],
  ["et al. in the source, one name: no names invented", { ...base, author: [p("Solo", "A.")], "et-al-in-source": true, page: "1" },
    "A. Solo, et al., “T,” Opt. Lett. 40, 1 (2015)."],
  ["one author", { ...base, author: [p("Solo", "Anna")], page: "5" }, "A. Solo, “T,” Opt. Lett. 40, 5 (2015)."],
  ["missing pages: no comma left inside the bold", { ...base, author: [p("Solo", "A.")] }, "A. Solo, “T,” Opt. Lett. 40 (2015)."],
  ["article number in the page slot (Optics Express style)", { ...base, author: [p("Solo", "A.")], "container-title-short": "Opt. Express", "article-number": "262" },
    "A. Solo, “T,” Opt. Express 40, 262 (2015)."],
  ["article number wins over a page field", { ...base, author: [p("Solo", "A.")], "article-number": "100004", page: "1-9" },
    "A. Solo, “T,” Opt. Lett. 40, 100004 (2015)."],
  ["eLocation ID kept as written", { ...base, author: [p("Solo", "A.")], page: "e0318239" }, "A. Solo, “T,” Opt. Lett. 40, e0318239 (2015)."],
  ["abbreviated second page is expanded", { ...base, author: [p("Solo", "A.")], page: "4973-80" }, "A. Solo, “T,” Opt. Lett. 40, 4973–4980 (2015)."],
  ["no volume: comma before the locator (Optica Open shape)", { title: "T", "container-title": "Optica Open", "article-number": "100004", issued: Y(2023), author: [p("Smith", "J.")] },
    "J. Smith, “T,” Optica Open, 100004 (2023)."],
  ["DOI and URL are not printed (the guide's journal examples have none)", { ...base, author: [p("Solo", "A.")], page: "1", DOI: "10.1364/OL.40.000001", URL: "https://example.org/x" },
    "A. Solo, “T,” Opt. Lett. 40, 1 (2015)."],
  ["title ending in ? takes no comma", { ...base, author: [p("Solo", "A.")], title: "Is light a wave?", page: "1" },
    "A. Solo, “Is light a wave?” Opt. Lett. 40, 1 (2015)."],
  ["non-ASCII names, hyphenated given names, particle", { ...base, author: [p("Ångström", "Åsa"), p("Roche", "Jean-Marc"), p("Groot", "Peter", { "non-dropping-particle": "de" })], page: "1" },
    "Å. Ångström, J.-M. Roche, and P. de Groot, “T,” Opt. Lett. 40, 1 (2015)."],
  ["corporate author is never initialised", { ...base, author: [{ literal: "LIGO Scientific Collaboration" }], page: "1" },
    "LIGO Scientific Collaboration, “T,” Opt. Lett. 40, 1 (2015)."],
  ["title only", { title: "Only a title" }, "“Only a title.”"],
  ["no year: no empty parentheses", { title: "T", "container-title-short": "Opt. Lett.", volume: "40", page: "1", author: [p("Solo", "A.")] },
    "A. Solo, “T,” Opt. Lett. 40, 1."],
  ["subscripts survive", { ...base, author: [p("Solo", "A.")], title: "CO<sub>2</sub> lasers", page: "1" }, "A. Solo, “CO₂ lasers,” Opt. Lett. 40, 1 (2015)."],
  ["issue without pages", { ...base, author: [p("Solo", "A.")], issue: "7" }, "A. Solo, “T,” Opt. Lett. 40(7) (2015)."],
];

describe("adversarial rows (case table)", () => {
  test.each(CASES)("%s", (_name, f, want) => {
    const out = optica.reference(R("article-journal", f));
    expect(out.plain).toBe(want);
    expect(out.plain).not.toMatch(/undefined|null|NaN|,,|\(\)|\s{2}|\^/);
    expect(out.plain).toBe(out.html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&"));
  });
  test("et al. is italic, as in the guide's formatted examples", () => {
    const h = optica.reference(R("article-journal", { ...base, author: [p("Aa", "A."), p("Bb", "B."), p("Cc", "C."), p("Dd", "D.")], page: "1" })).html;
    expect(h).toContain("C. Cc, <i>et al.</i>, ");
  });
  test("journal title is roman; the full title is printed with a warning when there is no abbreviation", () => {
    const r = R("article-journal", { author: [p("Solo", "A.")], title: "T", "container-title": "Optics Letters", volume: "40", page: "1", issued: Y(2015) });
    const f = optica.reference(r);
    expect(f.html).toBe("A. Solo, “T,” Optics Letters <b>40,</b> 1 (2015).");
    expect(referenceWarnings("optica", r).join(" ")).toMatch(/No abbreviation for "Optics Letters"/);
    expect(referenceWarnings("optica", { ...r, "container-title-short": "Opt. Lett." })).toEqual([]);
  });
  test("ampersands are escaped in html", () => {
    const f = optica.reference(R("article-journal", { ...base, author: [p("Solo", "A.")], title: "R&D in optics", page: "1" }));
    expect(f.html).toContain("R&amp;D");
    expect(f.plain).toContain("R&D");
  });
});

describe("refusals by name", () => {
  const others: BibType[] = ["book", "chapter", "paper-conference", "patent", "thesis", "report", "dataset", "article", "webpage"];
  test.each(others)("%s is refused, with the reason", (t) => {
    const r = formatReference("optica", R(t, { title: "X", author: [p("Solo", "A.")], issued: Y(2000) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Optica \(Optics Letters, Optics Express, JOSA\) cannot format an? [a-z ]+ reference: the Optica style guide/);
    expect(() => optica.reference(R(t, { title: "X" }))).toThrow(BibStyleRefusal);
  });
  test("a conference paper refusal says how to enter a Proc. SPIE paper", () => {
    const r = formatReference("optica", R("paper-conference", { title: "X" }));
    expect(!r.ok && r.reason).toMatch(/enter it as a journal article with the journal abbreviation "Proc\. SPIE"/);
  });
  test("typeRefusals names the record and never falls back to another style", () => {
    const lines = typeRefusals("optica", [R("book", { title: "B" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/It was not formatted in another style\.$/);
  });
});

// ------------------------------------------------------------------ in-text markers
const one = R("article-journal", { ...base, author: [p("Solo", "A.")], page: "1" });
const M = (...ns: Array<number | undefined>) => ns.map((n, i) => (n === undefined
  ? { rec: one, item: { id: `x${i}` } as CiteItem } : { rec: one, n, item: { id: `x${i}` } as CiteItem }));

describe("in-text markers: [1], [2,3], [1–4]", () => {
  test.each<[string, Array<number | undefined>, string]>([
    ["one", [1], "[1]"],
    ["two consecutive: comma, no space (guide: [2,3])", [2, 3], "[2,3]"],
    ["three or more consecutive: en dash (guide: [1–4])", [1, 2, 3, 4], "[1–4]"],
    ["unsorted input is sorted", [4, 1, 3, 2], "[1–4]"],
    ["non-consecutive", [1, 3], "[1,3]"],
    ["mixed", [7, 1, 2, 3, 5], "[1–3,5,7]"],
    ["duplicates collapse", [2, 2, 3], "[2,3]"],
    ["an unnumbered item reads ?", [1, undefined], "[1,?]"],
    ["nothing numbered", [undefined], "[?]"],
  ])("%s", (_n, ns, want) => {
    expect(optica.marker(M(...ns)).plain).toBe(want);
  });
  test("a carried-over locator is never invented into the marker; the number stays correct", () => {
    expect(optica.marker([{ rec: one, n: 3, item: { id: "x", locator: "5", label: "page" } }]).plain).toBe("[3]");
  });
  test("style rules agree with the guide", () => {
    expect(STYLE_RULES.optica).toEqual({ refEtAl: { max: 3, keep: 3 }, citeEtAlMin: null, compressRanges: true, sortParticleFirst: null });
  });
});

// ------------------------------------------------------------------ numbering via bibliography.ts
describe("bibliography numbering in citation order (renumberPlan)", () => {
  const rec = (id: string, fam: string): BibRecord =>
    ({ id, type: "article-journal", author: [p(fam, "A.")], title: `Paper ${fam}`, "container-title-short": "Opt. Lett.", volume: "1", page: "1-2", issued: Y(2020) });
  const recs = ["a", "b", "c", "d", "e"].map((id) => rec(id, id.toUpperCase() + "z"));
  const store = (markers: Record<string, CiteItem[]>): BibStoreData =>
    ({ version: 1, style: "optica", library: Object.fromEntries(recs.map((r) => [r.id, r])), markers });
  const cite = (...ids: string[]): CiteItem[] => ids.map((id) => ({ id }));

  test("first citation decides the number; [2,3] and [1–4] in one document", () => {
    const st = store({ m1: cite("c"), m2: cite("a", "b"), m3: cite("c", "a", "b", "d"), m4: cite("e", "c") });
    const plan = renumberPlan(["m1", "m2", "m3", "m4"], st, optica);
    expect(plan.numbers).toEqual({ c: 1, a: 2, b: 3, d: 4, e: 5 });
    expect(plan.markerText.m1.plain).toBe("[1]");
    expect(plan.markerText.m2.plain).toBe("[2,3]");
    expect(plan.markerText.m3.plain).toBe("[1–4]");
    expect(plan.markerText.m4.plain).toBe("[1,5]");
    expect(plan.bibliography.map((f) => f.plain)).toEqual([
      "A. Cz, “Paper Cz,” Opt. Lett. 1, 1–2 (2020).",
      "A. Az, “Paper Az,” Opt. Lett. 1, 1–2 (2020).",
      "A. Bz, “Paper Bz,” Opt. Lett. 1, 1–2 (2020).",
      "A. Dz, “Paper Dz,” Opt. Lett. 1, 1–2 (2020).",
      "A. Ez, “Paper Ez,” Opt. Lett. 1, 1–2 (2020).",
    ]);
  });
  test("moving a citation earlier renumbers, and a second run changes nothing", () => {
    const st = store({ m1: cite("a"), m2: cite("b"), m3: cite("c") });
    const moved = renumberPlan(["m3", "m1", "m2"], st, optica);
    expect([moved.markerText.m3.plain, moved.markerText.m1.plain, moved.markerText.m2.plain]).toEqual(["[1]", "[2]", "[3]"]);
    const again = renumberPlan(["m3", "m1", "m2"].map((id) => ({ markerId: id, text: moved.markerText[id].plain })), st, optica);
    expect(again.changed).toEqual([]);
  });
  test("a deleted reference reads ? and never keeps a stale number", () => {
    const st = store({ m1: cite("a"), m2: cite("gone", "b") });
    const plan = renumberPlan(["m1", "m2"], st, optica);
    expect(plan.markerText.m2.plain).toBe("[2,?]");
    expect(plan.missing.map((m) => m.id)).toEqual(["gone"]);
  });
  test("a refused type is reported by name, not formatted", () => {
    const st: BibStoreData = { ...store({ m1: cite("a", "bk") }), library: { ...store({}).library, bk: { id: "bk", type: "book", title: "B" } } };
    const plan = renumberPlan(["m1"], st, optica);
    expect(plan.bibliography).toHaveLength(1);
    expect(plan.problems.join(" ")).toMatch(/cannot format a book reference/);
  });
  test("a locator in a marker gets the number only (reported by planUpdate)", () => {
    const plan = renumberPlan(["m1"], store({ m1: [{ id: "a", locator: "5", label: "page" }] }), optica);
    expect(plan.markerText.m1.plain).toBe("[1]");
  });
});

describe("locators are refused before they reach the document", () => {
  const r: BibRecord = { id: "a", type: "article-journal", title: "T", "container-title-short": "Opt. Lett.", volume: "1", page: "1", issued: Y(2020) };
  test("Insert citation with a page under Optica is refused by name; IEEE accepts it", () => {
    const st: BibStoreData = { ...emptyStore("optica"), library: { a: r } };
    const res = planInsert(st, ["a"], { locator: "5", label: "page" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toMatch(/^Optica \(Optics Letters, Optics Express, JOSA\) cannot add a locator: the Optica style guide gives no form/);
    expect(planInsert(st, ["a"]).ok).toBe(true);
    expect(planInsert({ ...st, style: "ieee" }, ["a"], { locator: "5", label: "page" }).ok).toBe(true);
  });
});

describe("switching an IEEE document with a locator to Optica never leaves a stale number", () => {
  const rec = (id: string): BibRecord => ({ id, type: "article-journal", title: id, "container-title-short": "Opt. Lett.", volume: "1", page: "1", issued: Y(2020) });
  const ctl = (id: string, text: string) => ({ tag: citeTag(id).ok ? (citeTag(id) as { ok: true; tag: string }).tag : "", text });
  test("b keeps its correct number without the locator, and the locator is reported by name", () => {
    // Built under IEEE: m1 cites a → [1]; m2 cites b with p. 5 → [2, p. 5].
    const ieeeStore: BibStoreData = { version: 1, style: "ieee", library: { a: rec("a"), b: rec("b"), c: rec("c") },
      markers: { m1: [{ id: "a" }], m2: [{ id: "b", locator: "5", label: "page" }] } };
    const up0 = planUpdate(collectCitations([ctl("m1", ""), ctl("m2", "")], [], "numeric"), ieeeStore);
    if (!up0.ok) throw new Error(up0.reason);
    expect(up0.rewrites.map((r) => r.plain)).toEqual(["[1]", "[2, p. 5]"]);
    // Switch to Optica and cite a new record c BEFORE both.
    const st: BibStoreData = { ...ieeeStore, style: "optica", markers: { ...ieeeStore.markers, m0: [{ id: "c" }] } };
    const up = planUpdate(collectCitations([ctl("m0", ""), ctl("m1", "[1]"), ctl("m2", "[2, p. 5]")], [], "numeric"), st, { rewriteAll: true });
    if (!up.ok) throw new Error(up.reason);
    expect(up.rewrites.map((r) => [r.markerId, r.plain])).toEqual([["m0", "[1]"], ["m1", "[2]"], ["m2", "[3]"]]);
    expect(up.plan.numbers.b).toBe(3);
    expect(up.report.join(" ")).toMatch(/Locators left out \(1\): “5” for “b” \(marker m2\)\. Optica \(Optics Letters, Optics Express, JOSA\): the Optica style guide gives no form/);
  });
  test("no locator, no report line; IEEE never gets the line", () => {
    const st: BibStoreData = { version: 1, style: "optica", library: { a: rec("a") }, markers: { m1: [{ id: "a" }] } };
    const up = planUpdate(collectCitations([ctl("m1", "")], [], "numeric"), st);
    expect(up.ok && up.report.join(" ")).not.toMatch(/Locators left out/);
    const ie: BibStoreData = { ...st, style: "ieee", markers: { m1: [{ id: "a", locator: "5", label: "page" }] } };
    const up2 = planUpdate(collectCitations([ctl("m1", "")], [], "numeric"), ie);
    expect(up2.ok && up2.report.join(" ")).not.toMatch(/Locators left out/);
  });
});

describe("registration", () => {
  test("offered in the style picker, after Nature", () => {
    const ids = offeredStyles().map((s) => s.id);
    expect(ids).toContain("optica");
    expect(ids.indexOf("optica")).toBe(ids.indexOf("nature") + 1);
    expect(offeredStyles().find((s) => s.id === "optica")!.name).toBe("Optica (Optics Letters, Optics Express, JOSA)");
  });
  test("a saved store with style optica loads", () => {
    const st = emptyStore("optica");
    const r = parseStore(JSON.parse(JSON.stringify(st)));
    expect(r.ok).toBe(true);
  });
});

describe("Release D citation fixes", () => {
  it("a quoted title's own double quotes become single quotes", () => {
    const rec: BibRecord = { id: "q", type: "article-journal", title: 'The "Hello World" program', author: [{ family: "Ab", given: "A." }], "container-title-short": "Opt. Lett.", volume: "1", page: "1", issued: { "date-parts": [[2001]] } };
    for (const sid of ["optica", "ieee"] as const) {
      const f = STYLES[sid]!.reference(rec, 1);
      expect(f.plain).toContain("‘Hello World’");
      expect(f.plain).not.toContain('"');
    }
  });
  it("a journal article with no journal name is warned about", () => {
    const rec: BibRecord = { id: "n", type: "article-journal", title: "T", issued: { "date-parts": [[2001]] } };
    expect(referenceWarnings("optica", rec).some((w) => /No journal name/.test(w))).toBe(true);
  });
});

describe("Release D review: nested quote direction", () => {
  const rec = (title: string): BibRecord => ({ id: "q", type: "article-journal", title, author: [{ family: "Ab", given: "A." }], "container-title-short": "Opt. Lett.", volume: "1", page: "1", issued: { "date-parts": [[2001]] } });
  it("a tag inside the quoted words does not flip the closing quote", () => {
    expect(STYLES.optica!.reference(rec('The "<i>lac</i>" operon'), 1).plain).toContain("‘lac’");
  });
  it("a quote that ends a word closes", () => {
    expect(STYLES.ieee!.reference(rec('Ending in a quote"'), 1).plain).toContain("quote’");
  });
});
