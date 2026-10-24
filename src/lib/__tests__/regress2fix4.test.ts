/**
 * Round-2 regression fixes, fourth pass (2026-10-24): the defects a final adversarial pass found in the third.
 */
import { checkSmiles } from "../structures";
import { balanceText } from "../balance";
import { extractNumerals } from "../numerals";
import { buildTableOfAuthorities } from "../toa";

const rows = (text: string, heading: string): string[] =>
  buildTableOfAuthorities(text)
    .groups.filter((g) => g.heading === heading)
    .flatMap((g) => g.entries.map((e) => e.plain));

const notes = (q: string): string => JSON.stringify(balanceText(q), (_k, v) => (typeof v === "bigint" ? String(v) : v));

const PORPHINE = "C1=Cc2cc3ccc(cc4ccc(cc5nc(cc1n2)C=C5)[nH]4)[nH]3";

describe("a radical WRITTEN in the SMILES beside a porphyrin is accepted (RDKit accepts it)", () => {
  test.each([
    PORPHINE + ".[CH3]",
    PORPHINE + ".[O]",
    PORPHINE + ".[OH]",
    PORPHINE + ".c1ccccc1[O]",
    PORPHINE + ".c1cc[n+]cc1",
    "[O]N1C(C)(C)CC(CC1(C)C)c1c2ccc(n2)cc2ccc([nH]2)cc2ccc(n2)cc2ccc1[nH]2",
  ])("%s", (s) => expect(checkSmiles(s).ok).toBe(true));
  test.each(["[c-]1cccc1", "c1cccc1c1cccc1", "c1cccc1"])("%s is still refused", (s) => expect(checkSmiles(s).ok).toBe(false));
});

describe("balance: mixed-valence averages", () => {
  test("Fe₃O₄ + H⁺ → Fe + Fe³⁺: Fe⁰ forms, so the electron sentence is kept", () => {
    expect(notes("Fe3O4 + H+ -> Fe + Fe^3+ + H2O in acid")).toContain("electrons lost and gained cancel");
  });
  test.each(["Fe3O4 + H+ -> Fe^2+ + Fe^3+ + H2O in acid", "Pb3O4 + H+ -> Pb^2+ + PbO2 + H2O in acid"])("%s: no electron sentence", (q) => {
    expect(notes(q)).not.toContain("electrons lost and gained cancel");
  });
  test("a typed H₂O(l) is not called added", () => {
    expect(notes("MnO4- + H2O(l) -> MnO2 in base")).toContain("OH⁻ and e⁻ were added");
  });
});

describe("numerals: unit forms and long full ranges", () => {
  const T = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  test.each(["the dose (10–20) mg/kg", "(10–20) mm/s", "(10–20) mg·kg⁻¹", "(10–20) nm-thick", "(10–20) wt.%", "(10–20) wt %", "(10–20) mol%", "see p. (10–20)"])(
    "%s is a quantity or citation, not a callout",
    (t) => expect(extractNumerals(t, T)).toEqual([]),
  );
  test("brackets (10–20) L-shaped is still a callout", () => {
    expect(extractNumerals("brackets (10–20) L-shaped", T)).toEqual([10, 12, 14, 16, 18, 20]);
  });
  test("the teeth (100–124): thirteen defined numerals, all called out", () => {
    const teeth = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124];
    expect(extractNumerals("the teeth (100–124)", teeth)).toEqual(teeth);
  });
});

describe("TOA: one § is one section in every state (Rule 3.3)", () => {
  test.each([
    ["N.Y. Gen. Oblig. Law § 5-701.", "N.Y. Gen. Oblig. Law § 5-701"],
    ["Del. Code Ann. tit. 6, § 2-725.", "Del. Code Ann. tit. 6, § 2-725"],
    ["N.Y. Gen. Oblig. Law § 15-108(a).", "N.Y. Gen. Oblig. Law § 15-108(a)"],
  ])("%s", (text, want) => expect(rows(text, "Statutes")).toEqual([want]));
  test("a written §§ is still a range", () => {
    expect(rows("Cal. Civ. Code §§ 1714-1715.", "Statutes")).toEqual(["Cal. Civ. Code §§ 1714–1715"]);
  });
});
