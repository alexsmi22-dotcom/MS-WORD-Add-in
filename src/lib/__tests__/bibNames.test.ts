// Name parsing (docs/SCOPE-CITATIONS-2026-10.md §C2 "Names", §D acceptance list, §E risks).
// The BibTeX forms are those of Patashnik's BibTeXing (CTAN, btxdoc) §4: "First von Last",
// "von Last, First", "von Last, Jr, First"; braces make a word caseless or a name literal.

import { NameError, isVonWord, parseBibtexName, parseBibtexNameList, parseRisName, splitBibtexNames } from "../bibNames";

describe("§D acceptance: the pinned BibTeX name forms", () => {
  test.each([
    ["Ludwig van Beethoven", { given: "Ludwig", "non-dropping-particle": "van", family: "Beethoven" }],
    ["van Beethoven, Ludwig", { given: "Ludwig", "non-dropping-particle": "van", family: "Beethoven" }],
    // Braces make "van" caseless, so it is part of the family name: that is what they are for.
    ["{van} Beethoven, L.", { given: "L.", family: "van Beethoven" }],
    ["King, Jr., Martin Luther", { given: "Martin Luther", family: "King", suffix: "Jr." }],
    ["{World Health Organization}", { literal: "World Health Organization" }],
    ["Jean-Paul Sartre", { given: "Jean-Paul", family: "Sartre" }],
    ["de la Fontaine, Jean", { given: "Jean", "non-dropping-particle": "de la", family: "Fontaine" }],
  ])("%s", (raw, expected) => {
    expect(parseBibtexName(raw)).toEqual(expected);
  });

  test("“and others” sets the et-al flag and never invents a name", () => {
    expect(parseBibtexNameList("Smith, John and Doe, Jane and others")).toEqual({
      names: [
        { family: "Smith", given: "John" },
        { family: "Doe", given: "Jane" },
      ],
      etAl: true,
    });
    expect(parseBibtexNameList("others")).toEqual({ names: [], etAl: true });
  });
});

describe("more BibTeX forms (§E risks)", () => {
  test.each([
    ["Jean de la Fontaine", { given: "Jean", "non-dropping-particle": "de la", family: "Fontaine" }],
    ["J.-P. Sartre", { given: "J.-P.", family: "Sartre" }],
    ["van der Waals, Johannes Diderik", { given: "Johannes Diderik", "non-dropping-particle": "van der", family: "Waals" }],
    ["Johannes Diderik van der Waals", { given: "Johannes Diderik", "non-dropping-particle": "van der", family: "Waals" }],
    ["Brinch Hansen, Per", { given: "Per", family: "Brinch Hansen" }],
    ["García Márquez, Gabriel", { given: "Gabriel", family: "García Márquez" }],
    ["Garc{\\'\\i}a M{\\'a}rquez, Gabriel", { given: "Gabriel", family: "García Márquez" }],
    ["Ortega y Gasset, José", { given: "José", family: "Ortega y Gasset" }],
    ["{\\\"O}zt{\\\"u}rk, Ali", { given: "Ali", family: "Öztürk" }],
    ["{\\'E}mile Zola", { given: "Émile", family: "Zola" }],
    ["D.~E. Knuth", { given: "D. E.", family: "Knuth" }],
    ["Smith, III, John", { given: "John", family: "Smith", suffix: "III" }],
    ["Doe, , Jane", { given: "Jane", family: "Doe" }],
    ["Aristotle", { family: "Aristotle" }],
    ["Halpern, SD", { given: "SD", family: "Halpern" }],
    ["Halpern, S. D.", { given: "S. D.", family: "Halpern" }],
    // East Asian names are never re-ordered by guesswork: without a comma BibTeX's rule applies…
    ["Zhang Wei", { given: "Zhang", family: "Wei" }],
    // …and the comma form is how a family-first name is written.
    ["Zhang, Wei", { given: "Wei", family: "Zhang" }],
    // A special character counts by the letter it accents: {\"u}ber is lowercase, so a particle.
    ["Hans {\\\"u}ber Mensch", { given: "Hans", "non-dropping-particle": "über", family: "Mensch" }],
    ["{Barnes and Noble}", { literal: "Barnes and Noble" }],
    ["{Barnes {\\&} Noble, Inc.}", { literal: "Barnes & Noble, Inc." }],
  ])("%s", (raw, expected) => {
    expect(parseBibtexName(raw)).toEqual(expected);
  });

  test("corporate authors are never split or initialised", () => {
    const r = parseBibtexNameList("{World Health Organization} and {Barnes and Noble} and Smith, J.");
    expect(r.names).toEqual([
      { literal: "World Health Organization" },
      { literal: "Barnes and Noble" },
      { family: "Smith", given: "J." },
    ]);
  });

  test("splitting on top-level 'and' only (case-insensitive, any whitespace), never inside braces", () => {
    expect(splitBibtexNames("A and B AND C\nand\tD and {E and F}")).toEqual(["A", "B", "C", "D", "{E and F}"]);
    expect(splitBibtexNames("Anderson, Alan and Sand, Andy")).toEqual(["Anderson, Alan", "Sand, Andy"]);
    // Unbraced, "Barnes and Noble" is two names: BibTeX semantics, which is why braces exist.
    expect(splitBibtexNames("Barnes and Noble")).toEqual(["Barnes", "Noble"]);
  });

  test("too many commas is an error the importer turns into a refusal", () => {
    expect(() => parseBibtexName("a, b, c, d")).toThrow(NameError);
  });

  test("isVonWord: first cased letter at depth 0; braced groups are caseless", () => {
    expect(isVonWord("van")).toBe(true);
    expect(isVonWord("Van")).toBe(false);
    expect(isVonWord("{van}")).toBe(false);
    expect(isVonWord("{\\\"u}ber")).toBe(true);
    expect(isVonWord("{\\OE}uvre")).toBe(false);
    expect(isVonWord("{\\oe}uvre")).toBe(true);
    expect(isVonWord("123")).toBe(false);
  });
});

describe("RIS names", () => {
  test.each([
    ["Smith, John", { family: "Smith", given: "John" }],
    ["Baldwin,S.A.", { family: "Baldwin", given: "S.A." }],
    ["KONING, A. P. JASON de", { family: "KONING", given: "A. P. JASON de" }],
    ["King, Martin Luther, Jr.", { family: "King", given: "Martin Luther", suffix: "Jr." }],
    ["de la Fontaine, Jean", { "non-dropping-particle": "de la", family: "Fontaine", given: "Jean" }],
    ["van Beethoven, Ludwig", { "non-dropping-particle": "van", family: "Beethoven", given: "Ludwig" }],
    ["Aristotle", { family: "Aristotle" }],
    ["Valentine G.", { literal: "Valentine G." }],
    ["World Health Organization", { literal: "World Health Organization" }],
    ["Wetmore-Arkader, L.", { family: "Wetmore-Arkader", given: "L." }],
    ["Kwon, Hyeyoung", { family: "Kwon", given: "Hyeyoung" }],
  ])("%s", (raw, expected) => {
    expect(parseRisName(raw)).toEqual(expected);
  });
  test("NFC: e + U+0301 equals the precomposed é", () => {
    const acute = String.fromCharCode(0x301);
    const r = parseRisName(`Sartre, Jean-Paul Ame${acute}de${acute}e`);
    expect(r).toEqual({ family: "Sartre", given: "Jean-Paul Amédée".normalize("NFC") });
    expect(r.given).toHaveLength("Jean-Paul Amédée".normalize("NFC").length);
    expect(r.given!.includes(acute)).toBe(false);
  });
});
