// v2.137.0 — the three LIVE wrong answers in Chemical / Mass Spec / Structure
// mode (docs/SCOPE-CHEMBIO-BATCH.md §A 12–14 and 18, §D1 "Hydrate fix", §E1,
// §E2, §E6). Every block here failed before the fix.
//
//   1. Fractional hydrates: CaSO4·0.5H2O was "✓ Valid, 226.209" (the split on
//      "." read 0.5 as 0 then 5). Truth 145.1415. A bare 0.5H2O was 90.075.
//   2. The hydrate coefficient was typeset as a SUBSCRIPT (CuSO₄·₅H₂O), in the
//      preview AND the inserted text, which share parseChemical.
//   3. Mass Spec / Structure read a FORMULA as SMILES on a dictionary miss:
//      Co (cobalt) → CH₃O, CN → methylamine.
//
// Rounding note (§D "Hydrate fix"): 145.1415 and 9.0075 are exact ties at three
// decimals, so these tests pin the value with toBeCloseTo rather than a printed
// string; what toFixed(3) prints is pinned separately below so the report can
// state it.

import { validateFormula } from "../chemValidate";
import { parseChemical } from "../chemParser";
import { segmentsToHtml, Segment } from "../segments";
import { resolveChemInput, resolveStructure, renderStructure } from "../structures";
import { resolveMassSpec, computeMassSpec } from "../massspec";
import { formatFormula } from "../energy";
import { balanceReaction } from "../balance";

const html = (formula: string) => segmentsToHtml(parseChemical(formula));

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };
/** The plain-text form of the typeset segments — what lands in the document. */
const printed = (formula: string): string =>
  parseChemical(formula)
    .map((s: Segment) =>
      s.type === "sub" ? [...s.text].map((c) => SUB[c] ?? c).join("") : s.type === "sup" ? [...s.text].map((c) => SUP[c] ?? c).join("") : s.text
    )
    .join("");

const H2O = 2 * 1.008 + 15.999; // 18.015
const CASO4 = 40.078 + 32.06 + 4 * 15.999; // 136.134

describe("live bug 1 — fractional and decimal hydrate coefficients", () => {
  test("CaSO4·0.5H2O (plaster of Paris) is 145.1415, not 226.209", () => {
    const v = validateFormula("CaSO4·0.5H2O");
    expect(v.valid).toBe(true);
    expect(v.mass).toBeCloseTo(CASO4 + 0.5 * H2O, 6);
    expect(v.mass).toBeCloseTo(145.1415, 4);
    expect(v.counts).toEqual({ Ca: 1, S: 1, O: 4.5, H: 1 });
    expect(v.fractional).toBe(true);
  });

  test("every spelling of the half-hydrate agrees", () => {
    const want = validateFormula("CaSO4·0.5H2O");
    for (const s of ["CaSO4•0.5H2O", "CaSO4*0.5H2O", "CaSO4·1/2H2O", "CaSO4·½H2O", "CaSO4 · 0.5 H2O", "CaSO₄·0.5H₂O", "CaSO4·.5H2O"]) {
      const v = validateFormula(s);
      expect({ s, valid: v.valid, counts: v.counts }).toEqual({ s, valid: true, counts: want.counts });
      expect(v.mass).toBeCloseTo(want.mass!, 9);
    }
  });

  test("what toFixed(3) prints for the two exact ties (recorded, not asserted against the brief)", () => {
    // 145.1415 and 9.0075 sit exactly on the 3-dp boundary; binary floating point
    // decides the last digit. Pin what the product actually prints.
    expect(validateFormula("CaSO4·0.5H2O").mass!.toFixed(3)).toBe("145.142");
    expect(validateFormula("0.5H2O").mass!.toFixed(3)).toBe("9.008");
  });

  test("a bare 0.5H2O is 9.0075 with the coefficient said — never 90.075", () => {
    const v = validateFormula("0.5H2O");
    expect(v.valid).toBe(true);
    expect(v.mass).toBeCloseTo(9.0075, 4);
    expect(v.mass).not.toBeCloseTo(90.075, 1);
    expect(v.notes.join(" ")).toMatch(/coefficient/i);
    expect(v.notes.join(" ")).toContain("H₂O");
  });

  test("1.5O2 is three oxygens (47.997), not O₁₀ (159.990), and is LABELLED 1½O2, not ozone", () => {
    const v = validateFormula("1.5O2");
    expect(v.valid).toBe(true);
    expect(v.counts).toEqual({ O: 3 });
    expect(v.mass).toBeCloseTo(3 * 15.999, 6);
    expect(v.hill).toBe("1½O2");
    expect(validateFormula(v.hill).counts).toEqual({ O: 3 });
  });

  test("a decimal SUBSCRIPT after a count of 0 or 1 is nonstoichiometric, never a hydrate dot", () => {
    const cu = validateFormula("Cu1.8S");
    expect(cu).toMatchObject({ valid: true, counts: { Cu: 1.8, S: 1 }, fractional: true, hill: "Cu1.8S" });
    expect(cu.mass).toBeCloseTo(146.443, 2); // chempy formula_to_composition agrees
    expect(validateFormula("Fe0.95O")).toMatchObject({ valid: true, counts: { Fe: 0.95, O: 1 } });
    expect(validateFormula(cu.hill).counts).toEqual(cu.counts);
    // The pinned hydrate reading is untouched (integer count 4 before the dot).
    expect(validateFormula("CuSO4.5H2O").counts).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    // Repeating the element would need a count that cannot be printed back.
    expect(validateFormula("Cu1.8SCu").valid).toBe(false);
    expect(printed("Cu1.8S")).toBe("Cu₁.₈S");
  });

  test("the displayed Hill form of a fractional formula re-parses to the same counts", () => {
    for (const s of ["CaSO4·0.5H2O", "0.5H2O", "Na2SO4·1.5H2O", "CaSO4·1/3H2O", "2CaSO4·H2O"]) {
      const v = validateFormula(s);
      const back = validateFormula(v.hill);
      expect({ s, hill: v.hill, valid: back.valid }).toEqual({ s, hill: v.hill, valid: true });
      for (const [el, n] of Object.entries(v.counts)) expect(back.counts[el]).toBeCloseTo(n, 12);
      expect(Object.keys(back.counts).sort()).toEqual(Object.keys(v.counts).sort());
    }
    expect(validateFormula("CaSO4·0.5H2O").hill).toBe("CaO4S·½H2O");
    expect(validateFormula("CaSO4·1/3H2O").hill).toBe("CaO4S·⅓H2O");
    expect(validateFormula("Na2SO4·1.5H2O").hill).toBe("Na2O4S·1½H2O");
  });

  test("the pane's validation line (formatFormula(v.hill), taskpane updateChemValidation) typesets it correctly", () => {
    expect(formatFormula(validateFormula("CaSO4·0.5H2O").hill)).toBe("CaO₄S·½H₂O");
    expect(formatFormula(validateFormula("Na2SO4·1.5H2O").hill)).toBe("Na₂O₄S·1½H₂O");
    expect(formatFormula(validateFormula("CaSO4·2/7H2O").hill)).toBe("CaO₄S·2/7H₂O");
    expect(formatFormula(validateFormula("CuSO4·5H2O").hill)).toBe("CuH₁₀O₉S");
    expect(validateFormula(formatFormula(validateFormula("CaSO4·2/7H2O").hill)).counts).toEqual(validateFormula("CaSO4·2/7H2O").counts);
  });

  test("integer hydrates are unchanged, in every separator", () => {
    const a = validateFormula("CuSO4·5H2O");
    expect(a.counts).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(a.mass).toBeCloseTo(249.677, 2);
    expect(a.hill).toBe("CuH10O9S");
    expect(a.fractional).toBe(false);
    for (const s of ["CuSO4.5H2O", "CuSO4*5H2O", "CuSO4•5H2O", "CuSO₄·5H₂O", "CuSO4 · 5H2O"]) {
      expect({ s, v: validateFormula(s).valid, c: validateFormula(s).counts }).toEqual({ s, v: true, c: a.counts });
    }
    expect(validateFormula("KAl(SO4)2·12H2O").mass).toBeCloseTo(474.372, 2);
    expect(validateFormula("Na2CO3·10H2O").counts).toEqual({ Na: 2, C: 1, O: 13, H: 20 });
  });

  test("a hydrate part with no coefficient, a host coefficient, and nested hydrates", () => {
    expect(validateFormula("MgSO4·H2O").counts).toEqual({ Mg: 1, S: 1, O: 5, H: 2 });
    expect(validateFormula("MgSO4.H2O").counts).toEqual({ Mg: 1, S: 1, O: 5, H: 2 });
    // (CaSO4)2·H2O — the same substance as the half-hydrate, per two formula units.
    expect(validateFormula("2CaSO4·H2O").mass).toBeCloseTo(2 * (CASO4 + 0.5 * H2O), 6);
    // Water inside the complex AND lattice water.
    expect(validateFormula("[Cu(H2O)4]SO4·H2O").counts).toEqual({ Cu: 1, H: 10, O: 9, S: 1 });
    // Double salt with two dots.
    expect(validateFormula("K2SO4·Al2(SO4)3·24H2O").counts).toEqual({ K: 2, S: 4, O: 40, Al: 2, H: 48 });
    expect(validateFormula("[Na+].[Cl-]")).toMatchObject({ valid: true, counts: { Na: 1, Cl: 1 }, charge: 0 });
  });

  test("a bare integer coefficient (2H2O, no host) keeps today's counts and says the coefficient", () => {
    const v = validateFormula("2H2O");
    expect(v).toMatchObject({ valid: true, counts: { H: 4, O: 2 }, fractional: false });
    expect(v.notes.join(" ")).toMatch(/coefficient 2/);
  });

  test("bad coefficients are refused by name", () => {
    const why = (s: string) => {
      const v = validateFormula(s);
      expect({ s, valid: v.valid, mass: v.mass }).toEqual({ s, valid: false, mass: null });
      return v.errors.join(" ");
    };
    expect(why("CuSO4·-5H2O")).toMatch(/negative/i);
    expect(why("CuSO4·−5H2O")).toMatch(/negative/i);
    expect(why("CuSO4·0H2O")).toMatch(/zero/i);
    expect(why("CuSO4·0.0H2O")).toMatch(/zero/i);
    expect(why("CuSO4·1/0H2O")).toMatch(/zero|divide/i);
    expect(why("0H2O")).toMatch(/zero/i);
    // chempy reads CaSO4.0.5H2O as an O4.0 subscript; a "." before a decimal
    // coefficient is refused rather than guessed.
    expect(why("CaSO4.0.5H2O")).toMatch(/·/);
    expect(why("CaSO4·0.5")).toMatch(/coefficient|formula/i);
  });

  test("the existing outputs elsewhere do not move", () => {
    expect(validateFormula("Fe2+")).toMatchObject({ valid: true, charge: 2, counts: { Fe: 1 } });
    expect(validateFormula("MnO₄⁻")).toMatchObject({ valid: true, charge: -1 });
    expect(validateFormula("[Fe(CN)6]4-")).toMatchObject({ valid: true, charge: -4 });
    expect(validateFormula("Cr₂O₇²⁻")).toMatchObject({ valid: true, charge: -2 });
    expect(validateFormula("H0").valid).toBe(false);
    expect(validateFormula("¹⁴C").valid).toBe(false);
    expect(validateFormula("C6H12O6")).toMatchObject({ valid: true, hill: "C6H12O6", fractional: false, notes: [] });
  });
});

describe("live bug 2 — a hydrate coefficient is full size, preview AND insert", () => {
  test("CuSO4·5H2O typesets as CuSO₄·5H₂O", () => {
    expect(html("CuSO4·5H2O")).toBe("CuSO<sub>4</sub>·5H<sub>2</sub>O");
    expect(printed("CuSO4·5H2O")).toBe("CuSO₄·5H₂O");
    expect(printed("Na2CO3·10H2O")).toBe("Na₂CO₃·10H₂O");
    expect(printed("CuSO4.5H2O")).toBe("CuSO₄.5H₂O");
    expect(printed("CuSO4*5H2O")).toBe("CuSO₄*5H₂O");
    expect(printed("CuSO4•5H2O")).toBe("CuSO₄•5H₂O");
    expect(printed("CaSO4·0.5H2O")).toBe("CaSO₄·0.5H₂O");
    expect(printed("CaSO4·1/2H2O")).toBe("CaSO₄·1/2H₂O");
    expect(printed("0.5H2O")).toBe("0.5H₂O");
  });

  test("what is printed re-parses to the same composition", () => {
    for (const s of ["CuSO4·5H2O", "Na2CO3·10H2O", "CuSO4.5H2O", "CuSO4*5H2O", "CaSO4·0.5H2O", "CaSO4·1/2H2O", "KAl(SO4)2·12H2O", "2CaSO4·H2O"]) {
      const a = validateFormula(s);
      const b = validateFormula(printed(s));
      expect({ s, printed: printed(s), valid: b.valid, counts: b.counts }).toEqual({ s, printed: printed(s), valid: true, counts: a.counts });
    }
  });

  test("everything else typesets exactly as before", () => {
    expect(html("2H2O")).toBe("2H<sub>2</sub>O");
    expect(html("CuSO4 · 5H2O")).toBe("CuSO<sub>4</sub> · 5H<sub>2</sub>O");
    expect(html("SO4^2-")).toBe("SO<sub>4</sub><sup>2-</sup>");
    expect(html("Fe3+")).toBe("Fe<sup>3+</sup>");
    expect(html("NH4+")).toBe("NH<sub>4</sub><sup>+</sup>");
    expect(html("[Fe(CN)6]3-")).toBe("[Fe(CN)<sub>6</sub>]<sup>3-</sup>");
    expect(html("C6H12O6")).toBe("C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>");
  });
});

describe("live bug 2b — a reaction typed in Chemical mode: separators and arrows are not charges", () => {
  const cases: Array<[string, string]> = [
    ["Fe + O2 -> Fe2O3", "Fe + O₂ → Fe₂O₃"],
    ["MnO4- + Fe2+ -> Mn2+ + Fe3+", "MnO₄⁻ + Fe²⁺ → Mn²⁺ + Fe³⁺"],
    ["2H2 + O2 = 2H2O", "2H₂ + O₂ = 2H₂O"],
    ["N2 + 3H2 <=> 2NH3", "N₂ + 3H₂ ⇌ 2NH₃"],
    ["N2 + 3H2 ⇌ 2NH3", "N₂ + 3H₂ ⇌ 2NH₃"],
    ["Cr2O7^2- + 14H+ + 6e- → 2Cr3+ + 7H2O", "Cr₂O₇²⁻ + 14H⁺ + 6e⁻ → 2Cr³⁺ + 7H₂O"],
    ["Fe2O3->2Fe", "Fe₂O₃→2Fe"],
  ];
  test.each(cases)("%s prints as %s", (input, want) => {
    expect(printed(input)).toBe(want);
  });

  test("the printed equation re-parses: it balances exactly as the typed one does", () => {
    for (const [input] of cases.slice(0, 6)) {
      const a = balanceReaction(input);
      const b = balanceReaction(printed(input));
      expect({ input, ok: b.ok, coefs: b.ok ? b.coefficients : null }).toEqual({ input, ok: a.ok, coefs: a.ok ? a.coefficients : null });
      // …and typed back into Chemical mode, it prints the same again.
      expect(printed(printed(input))).toBe(printed(input));
    }
  });

  test("single species keep their charges exactly as before", () => {
    expect(printed("Na+")).toBe("Na⁺");
    expect(printed("Cl-")).toBe("Cl⁻");
    expect(printed("Ca2+")).toBe("Ca²⁺");
    expect(printed("NH4+")).toBe("NH₄⁺");
    expect(printed("SO4^2-")).toBe("SO₄²⁻");
    expect(printed("Na+ Cl-")).toBe("Na⁺ Cl⁻");
  });
});

describe("live bug 3 — a formula is not read as SMILES on a dictionary miss", () => {
  test("Co is cobalt (58.9332), not CH₃O", () => {
    const r = resolveChemInput("Co", "auto");
    expect(r.kind).toBe("formula");
    const ms = resolveMassSpec("Co", "auto");
    expect(ms.kind).toBe("ok");
    if (ms.kind !== "ok") return;
    expect(ms.reading).toBe("formula");
    expect(ms.result.formula).toBe("Co");
    expect(ms.result.monoisotopicMass).toBeCloseTo(58.9332, 3);
    expect(ms.result.averageMass).toBeCloseTo(58.933, 2);
  });

  test("both readings valid and different: picked by pane, the other reading NAMED, never refused", () => {
    // Ordinary typed SMILES stay SMILES in both panes.
    for (const s of ["CCO", "CCl", "CCCC", "C1CC1", "CN", "NO", "O", "Cl", "CS", "SN", "OCCO", "ClCCl"]) {
      const st = resolveChemInput(s, "auto", "structure");
      const ms = resolveChemInput(s, "auto", "massspec");
      expect({ s, st: st.kind, ms: ms.kind }).toEqual({ s, st: "smiles", ms: "smiles" });
      expect(st.kind === "smiles" && st.note).toContain(`formula:${s}`);
    }
    // CCO in Structure mode → ethanol, with the formula reading named.
    const st = resolveStructure("CCO", "auto");
    expect(st.kind).toBe("ok");
    if (st.kind === "ok") {
      expect(st.result.formula).toBe("C2H6O");
      expect(st.note).toContain("ethanol");
      expect(st.note).toContain("C₂O");
      expect(st.note).toContain("formula:CCO");
    }
    // CCO in Mass Spec → SMILES (ethanol), with the formula reading named.
    const ms = resolveMassSpec("CCO", "auto");
    expect(ms.kind === "ok" && ms.reading).toBe("smiles");
    if (ms.kind === "ok") {
      expect(ms.result.formula).toBe("C2H6O");
      expect(ms.note).toContain("C₂O");
      expect(ms.note).toContain("formula:CCO");
    }
    // CN in Mass Spec → methylamine, cyanide named.
    const cn = resolveMassSpec("CN", "auto");
    expect(cn.kind === "ok" && cn.result.formula).toBe("CH5N");
    if (cn.kind === "ok") expect(cn.note).toContain("formula:CN");
  });

  test("Mass Spec: the formula wins when the string is written as a formula (explicit count)", () => {
    // C2CC2 is valid SMILES (cyclopropane, ring bond 2…2) AND a formula C5.
    // Its digits are a RING-CLOSURE PAIR (every label occurs an even number of
    // times), so they are not counts: SMILES wins, with the formula reading named
    // (independent review, chembio.review: decalin/norbornane/adamantane/cubane).
    const r = resolveChemInput("C2CC2", "auto", "massspec");
    expect(r.kind).toBe("smiles");
    if (r.kind === "smiles") expect(r.note).toContain("formula:C2CC2");
    const m = resolveMassSpec("C2CC2", "auto");
    expect(m.kind === "ok" && m.result.formula).toBe("C3H6");
    expect(resolveChemInput("C2CC2", "auto", "structure").kind).toBe("smiles");
    const dec = resolveMassSpec("C1CCC2CCCCC2C1", "auto");
    expect(dec.kind === "ok" && dec.result.formula).toBe("C10H18");
    // C6H12O6, H2O, CH4: not SMILES at all (or a dictionary formula) — read as the formula.
    for (const [s, f] of [["C6H12O6", "C6H12O6"], ["H2O", "H2O"], ["CH4", "CH4"], ["C8H10N4O2", "C8H10N4O2"]]) {
      const m = resolveMassSpec(s, "auto");
      expect({ s, ok: m.kind }).toEqual({ s, ok: "ok" });
      if (m.kind === "ok") expect(m.result.formula).toBe(f);
    }
  });

  test("no 'ambiguous' result remains for the traps above", () => {
    for (const s of ["CCO", "CCl", "CCCC", "C1CC1", "CN", "NO", "O", "Cl", "C2CC2", "Co", "SN", "CS", "No"]) {
      expect({ s, st: resolveStructure(s, "auto").kind === "ambiguous", ms: resolveMassSpec(s, "auto").kind === "ambiguous" })
        .toEqual({ s, st: false, ms: false });
    }
  });

  test("capitalisation traps", () => {
    const kind = (s: string) => resolveChemInput(s, "auto").kind;
    // A lowercase letter after an organic-subset atom is an AROMATIC atom in
    // SMILES, and an aromatic atom must sit in a ring — which needs a ring
    // digit. With no digit, the SMILES reading is not valid SMILES at all.
    for (const s of ["Co", "No", "Sn", "Cs", "Sc", "Nb", "Os", "Pb", "Hf", "Fe2O3", "Ni", "Bi"]) {
      expect({ s, st: kind(s), ms: resolveChemInput(s, "auto", "massspec").kind }).toEqual({ s, st: "formula", ms: "formula" });
    }
    for (const s of ["CO2X"]) expect(kind(s)).toBe("none");
    // All-capitals strings of organic-subset atoms really are both: SMILES wins
    // (no explicit count), the formula reading is named.
    for (const s of ["NO", "CS", "SN", "CN"]) expect({ s, k: kind(s) }).toEqual({ s, k: "smiles" });
    // Dictionary hits still win (§E6 applies to a dictionary MISS only).
    expect(resolveChemInput("CO", "auto")).toMatchObject({ kind: "dictionary", source: "formula", smiles: "[C-]#[O+]" });
    expect(resolveChemInput("HF", "auto")).toMatchObject({ kind: "dictionary", source: "formula" });
    expect(resolveChemInput("aspirin", "auto")).toMatchObject({ kind: "dictionary", source: "name" });
  });

  test("No is nobelium, NO is SMILES with nitric oxide named, Hf is hafnium, HF is hydrogen fluoride", () => {
    const no = resolveMassSpec("No", "auto");
    expect(no.kind === "ok" && no.result.formula).toBe("No");
    const hf = resolveMassSpec("Hf", "auto");
    expect(hf.kind === "ok" && hf.result.averageMass).toBeCloseTo(178.49, 1);
    const HF = resolveMassSpec("HF", "auto");
    expect(HF.kind === "ok" && HF.result.formula).toBe("HF");
    const sn = resolveMassSpec("Sn", "auto");
    expect(sn.kind === "ok" && sn.result.formula).toBe("Sn");
    const SN = resolveMassSpec("SN", "auto");
    expect(SN.kind === "ok" && SN.reading).toBe("smiles");
    const NO = resolveMassSpec("NO", "auto");
    expect(NO.kind === "ok" && NO.note).toContain("formula:NO");
  });

  test("Fe2O3 (no structure, so no answer before) now has masses from its formula", () => {
    const r = resolveMassSpec("Fe2O3", "auto");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.result.monoisotopicMass).toBeCloseTo(159.8546, 3);
    expect(r.result.averageMass).toBeCloseTo(159.69, 1);
    expect(r.result.netCharge).toBe(0);
    expect(r.result.adducts.length).toBeGreaterThan(0);
  });

  test("a charged formula keeps its charge and drops the neutral-M adducts", () => {
    const r = resolveMassSpec("MnO4-", "auto");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.result.netCharge).toBe(-1);
    expect(r.result.adducts).toEqual([]);
  });

  test("formula-reading masses: OpenChemLib per element, cross-checked against NIST isotope masses", () => {
    // Most-abundant-isotope masses (NIST), the same values massspec.ts's ISOTOPES uses.
    const NIST: Record<string, number> = {
      H: 1.0078250319, C: 12.0, N: 14.0030740052, O: 15.9949146221, F: 18.99840322, Na: 22.98976928,
      Si: 27.9769265327, P: 30.97376151, S: 31.97207069, Cl: 34.96885271, K: 38.9637069, Br: 78.9183376,
      I: 126.904473, B: 11.0093055, Se: 79.9165218,
    };
    for (const [el, mono] of Object.entries(NIST)) {
      const r = resolveMassSpec(`${el}2`, "formula");
      expect({ el, kind: r.kind }).toEqual({ el, kind: "ok" });
      if (r.kind === "ok") expect(Math.abs(r.result.monoisotopicMass - 2 * mono)).toBeLessThan(2e-4);
    }
    // OpenChemLib gives a bracket [Al] three implicit hydrogens; they are subtracted.
    const al = resolveMassSpec("Al", "auto");
    expect(al.kind).toBe("ok");
    if (al.kind === "ok") {
      expect(al.result.formula).toBe("Al");
      expect(al.result.monoisotopicMass).toBeCloseTo(26.98154, 4);
      expect(al.result.averageMass).toBeCloseTo(26.982, 2);
    }
  });

  test("the formula path is bounded before any work (a 7-character input must not freeze Word)", () => {
    const t0 = Date.now();
    const big = resolveMassSpec("Se99999", "auto");
    expect(big.kind).toBe("none");
    if (big.kind === "none") expect(big.message).toMatch(/10000-atom-per-element limit/);
    const total = resolveMassSpec("C9000H9000N9000O9000S9000P9000", "auto");
    expect(total.kind).toBe("none");
    if (total.kind === "none") expect(total.message).toMatch(/50000-atom limit/);
    expect(Date.now() - t0).toBeLessThan(200);
    // At the cap it still answers, quickly.
    const t1 = Date.now();
    const edge = resolveMassSpec("Se10000Br10000S10000O10000Cl9999", "auto");
    expect(edge.kind).toBe("ok");
    expect(Date.now() - t1).toBeLessThan(2000);
  });

  test("a fractional formula has no molecular ion — refused by name in Mass Spec", () => {
    const r = resolveMassSpec("CaSO4·0.5H2O", "auto");
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.message).toMatch(/fraction|whole/i);
  });

  test("the mode is a parameter: smiles / formula force one reading", () => {
    const s = resolveMassSpec("Co", "smiles");
    expect(s.kind === "ok" && s.result.formula).toBe("CH3O");
    const f = resolveMassSpec("CCO", "formula");
    expect(f.kind === "ok" && f.result.formula).toBe("C2O");
    const a = resolveMassSpec("CCO", "auto");
    expect(a.kind === "ok" && a.result.formula).toBe("C2H6O");
    // The explicit prefixes settle it inside auto mode.
    const p = resolveMassSpec("smiles:CN", "auto");
    expect(p.kind === "ok" && p.result.formula).toBe("CH5N");
    const q = resolveMassSpec("formula:CN", "auto");
    expect(q.kind === "ok" && q.reading).toBe("formula");
  });

  test("every SMILES the existing suites feed in still reads as SMILES under auto", () => {
    for (const smi of ["c1ccccc1", "CC(=O)[O-]", "[N+](C)(C)(C)CCO", "[Na+].[Cl-]", "[Fe]", "CC(=O)OCC", "Cc1ccccc1",
      "CC(=O)Oc1ccccc1C(=O)O", "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", "O=C=O", "C#N", "C/C=C/C", "N[C@@H](C)C(=O)O"]) {
      const r = resolveChemInput(smi, "auto");
      expect({ smi, k: r.kind }).toEqual({ smi, k: "smiles" });
    }
  });

  test("Structure mode: a formula reading has no drawing, and says so", () => {
    const co = resolveStructure("Co", "auto");
    expect(co.kind).toBe("formula");
    if (co.kind === "formula") expect(co.message).toMatch(/cobalt/i);
    const cn = resolveStructure("CN", "auto");
    expect(cn.kind === "ok" && cn.result.formula).toBe("CH5N");
    if (cn.kind === "ok") expect(cn.note).toContain("formula:CN");
    const co2 = resolveMassSpec("Co", "auto");
    expect(co2.kind === "ok" && co2.reading).toBe("formula");
    const asp = resolveStructure("aspirin", "auto");
    expect(asp.kind === "ok" && asp.result.formula).toBe("C9H8O4");
    expect(resolveStructure("c1ccccc1", "auto").kind).toBe("ok");
    expect(resolveStructure("smiles:CO", "auto").kind).toBe("ok");
    expect(resolveStructure("zzzz_not_a_compound", "auto").kind).toBe("none");
  });

  test("the legacy entry points are unchanged (fed SMILES by construction elsewhere)", () => {
    expect(computeMassSpec("CCl")!.formula).toBe("CH3Cl");
    expect(computeMassSpec("CCO")!.formula).toBe("C2H6O");
    expect(renderStructure("CO")!.source).toBe("formula");
    expect(renderStructure("CCCC")!.formula).toBe("C4H10");
  });
});
