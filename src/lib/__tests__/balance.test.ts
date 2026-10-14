// §D1 of docs/SCOPE-CHEMBIO-BATCH.md — every balancing value verbatim.
// Oracles (from the brief): chempy 0.10.2 balance_stoichiometry and the SymPy
// null space of an independently built composition matrix; both agree on
// every unique case below.

import {
  balanceReaction,
  balanceText,
  chemistryKindFor,
  combineHalfReactions,
  compositionMatrix,
  nullSpace,
  parseEquation,
  parseSpecies,
  ratText,
  BalanceOk,
  BalanceResult,
} from "../balance";

function ok(r: BalanceResult): BalanceOk {
  if (!r.ok) throw new Error(`expected a balance, got ${r.kind}: ${r.message}`);
  return r;
}

const D1_UNIQUE: Array<[string, number[]]> = [
  ["Fe + O2 -> Fe2O3", [4, 3, 2]],
  ["KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O", [2, 16, 2, 2, 5, 8]],
  ["C3H8 + O2 → CO2 + H2O", [1, 5, 3, 4]],
  ["C6H12O6 + O2 = CO2 + H2O", [1, 6, 6, 6]],
  ["K4Fe(CN)6 + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O", [10, 122, 299, 162, 5, 122, 60, 60, 188]],
  ["MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O", [1, 5, 8, 1, 5, 4]],
  ["Cr2O7^2- + H+ + e- -> Cr^3+ + H2O", [1, 14, 6, 2, 7]],
  ["MnO4- + H2O + e- -> MnO2 + OH-", [1, 2, 3, 1, 4]],
  ["Cu + HNO3 -> Cu(NO3)2 + NO + H2O", [3, 8, 3, 2, 4]],
  ["NH3 + O2 -> NO + H2O", [4, 5, 4, 6]],
  ["Ca3(PO4)2 + SiO2 + C -> CaSiO3 + P4 + CO", [2, 6, 10, 6, 1, 10]],
  ["Al + Cu^2+ -> Al^3+ + Cu", [2, 3, 2, 3]],
  ["Ag+ + Cl- -> AgCl", [1, 1, 1]],
  ["NaCl -> Na + Cl2", [2, 2, 1]],
  ["CuSO4·5H2O -> CuSO4 + H2O", [1, 1, 5]],
];

describe("§D1 unique balancings (chempy = SymPy)", () => {
  test.each(D1_UNIQUE)("%s", (eq, expected) => {
    const r = ok(balanceReaction(eq));
    expect(r.coefficients).toEqual(expected);
    expect(r.conservation.every((row) => row.ok)).toBe(true);
    // the charge row is always in the table
    expect(r.conservation[r.conservation.length - 1].quantity).toBe("charge");
  });

  test.each(D1_UNIQUE)("round trip: %s", (eq, expected) => {
    const r = ok(balanceReaction(eq));
    const again = ok(balanceReaction(r.equation));
    expect(again.coefficients).toEqual(expected);
    expect(again.equation).toBe(r.equation);
    // all-1 equations carry no typed coefficient, so there is nothing "as written" to judge
    if (expected.some((c) => c !== 1)) expect(again.asWritten?.balanced).toBe(true);
    else expect(again.asWritten).toBeNull();
  });

  test("K₄Fe(CN)₆ is rank 8 of 9 (nullity 1)", () => {
    const p = parseEquation(D1_UNIQUE[4][0]);
    if (!p.ok) throw new Error(p.error);
    const { matrix } = compositionMatrix(p.species, p.sides);
    expect(nullSpace(matrix, p.species.length)).toHaveLength(1);
  });
});

describe("display contract", () => {
  test("KMnO₄ + HCl prints exactly", () => {
    expect(ok(balanceReaction("KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O")).equation).toBe(
      "2 KMnO₄ + 16 HCl → 2 KCl + 2 MnCl₂ + 5 Cl₂ + 8 H₂O",
    );
  });
  test("ions: MnO₄⁻, Fe²⁺, H⁺, e⁻", () => {
    expect(ok(balanceReaction("MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O")).equation).toBe(
      "MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O",
    );
    expect(ok(balanceReaction("Cr2O7^2- + H+ + e- -> Cr^3+ + H2O")).equation).toBe(
      "Cr₂O₇²⁻ + 14 H⁺ + 6 e⁻ → 2 Cr³⁺ + 7 H₂O",
    );
  });
  test("hydrate coefficient full size, counts subscripted", () => {
    expect(ok(balanceReaction("CuSO4·5H2O -> CuSO4 + H2O")).equation).toBe("CuSO₄·5H₂O → CuSO₄ + 5 H₂O");
    expect(ok(balanceReaction("CuSO4.5H2O -> CuSO4 + H2O")).equation).toBe("CuSO₄·5H₂O → CuSO₄ + 5 H₂O");
  });
  test("state symbols kept; ⇌ kept", () => {
    const r = ok(balanceReaction("N2(g) + H2(g) <=> NH3(g)"));
    expect(r.equation).toBe("N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g)");
    expect(ok(balanceReaction(r.equation)).coefficients).toEqual([1, 3, 2]);
  });
  test("charge spellings agree: Fe+3, Fe3+, Fe^3+, Fe³⁺", () => {
    for (const s of ["Fe+3", "Fe3+", "Fe^3+", "Fe³⁺"]) {
      const p = parseSpecies(s);
      if (!p.ok) throw new Error(p.error);
      expect(p.species.charge).toBe(3);
      expect(p.species.display).toBe("Fe³⁺");
    }
  });
  test("H₂⁺ re-parses as H₂⁺, not H²⁺", () => {
    const p = parseSpecies("H2^+");
    if (!p.ok) throw new Error(p.error);
    expect(p.species.display).toBe("H₂⁺");
    const q = parseSpecies(p.species.display);
    if (!q.ok) throw new Error(q.error);
    expect(ratText(q.species.counts.H)).toBe("2");
    expect(q.species.charge).toBe(1);
  });
  test("conservation table: element and charge rows with totals", () => {
    const r = ok(balanceReaction("Al + Cu^2+ -> Al^3+ + Cu"));
    const q = r.conservation.find((x) => x.quantity === "charge")!;
    expect(q.leftText).toBe("+6");
    expect(q.rightText).toBe("+6");
    expect(r.conservation.find((x) => x.quantity === "Al")!.leftText).toBe("2");
  });
});

describe("§D1 must REFUSE", () => {
  test("C + O2 -> CO + CO2: nullity 2, both reactions shown, no single answer", () => {
    const r = balanceReaction("C + O2 -> CO + CO2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not-unique");
    expect(r.message).toMatch(/no single set of coefficients/);
    expect(r.basis).toHaveLength(2);
    const eqs = r.basis!.map((b) => b.equation).sort();
    expect(eqs).toEqual(["2 C + O₂ → 2 CO", "C + O₂ → CO₂"].sort());
    // chempy's arbitrary pick must not appear as THE answer
    expect(JSON.stringify(r)).not.toMatch(/"coefficients":\[3,2,2,1\]/);
  });

  test("Cu + HNO3 -> Cu(NO3)2 + NO + NO2 + H2O: refuse; show both reactions", () => {
    const r = balanceReaction("Cu + HNO3 -> Cu(NO3)2 + NO + NO2 + H2O");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not-unique");
    const eqs = r.basis!.map((b) => b.equation).sort();
    expect(eqs).toEqual(
      ["3 Cu + 8 HNO₃ → 3 Cu(NO₃)₂ + 2 NO + 4 H₂O", "Cu + 4 HNO₃ → Cu(NO₃)₂ + 2 NO₂ + 2 H₂O"].sort(),
    );
    expect(JSON.stringify(r)).not.toMatch(/"coefficients":\[2,6,2,1,1,3\]/);
  });

  test("KMnO4 + H2O2 + H2SO4: refuse; disproportionation independent; textbook form is a positive combination", () => {
    const r = balanceReaction("KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not-unique");
    expect(r.nullity).toBe(2);
    expect(r.basis!.map((b) => b.equation)).toContain("2 H₂O₂ → O₂ + 2 H₂O");
    // every shown reaction balances, is non-negative and primitive
    for (const b of r.basis!) {
      expect(b.coefficients.every((c) => c >= 0)).toBe(true);
      const g = b.coefficients.reduce((a, c) => { let x = a, y = c; while (y) [x, y] = [y, x % y]; return x; }, 0);
      expect(g).toBe(1);
      expect(ok(balanceReaction(b.equation)).asWritten?.balanced).toBe(true);
    }
    // the textbook 2,5,3,1,2,5,8 = ½·(4,0,6,2,4,5,6) + (5/2)·(0,2,0,0,0,1,2)
    const [a, b] = r.basis!.map((x) => x.coefficients);
    const textbook = [2, 5, 3, 1, 2, 5, 8];
    let found = false;
    for (let p = 0; p <= 20 && !found; p++) {
      for (let q = 0; q <= 20 && !found; q++) {
        const v = a.map((x, j) => p * x + q * b[j]);
        const g = v.reduce((s, c) => { let x = s, y = c; while (y) [x, y] = [y, x % y]; return x; }, 0);
        if (g && v.map((x) => x / g).join() === textbook.join()) found = true;
      }
    }
    expect(found).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/"coefficients":\[2,1,3,1,2,3,4\]/);
  });

  test("H2O -> H2O2: nullity 0, names H and O", () => {
    const r = balanceReaction("H2O -> H2O2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("impossible");
    expect(r.message).toBe("No positive coefficients conserve H and O together: H₂O has H:O = 2:1, H₂O₂ has H:O = 1:1.");
  });

  test("H2 + O2 + N2 -> H2O: names N₂ (coefficient 0), never prints 0 N₂", () => {
    const r = balanceReaction("H2 + O2 + N2 -> H2O");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("zero");
    expect(r.message).toMatch(/^N₂ takes no part/);
    expect(r.message).not.toMatch(/0 N₂/);
  });

  test("the charge row is load-bearing (MnO₄⁻/Fe²⁺)", () => {
    const p = parseEquation("MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O");
    if (!p.ok) throw new Error(p.error);
    const without = compositionMatrix(p.species, p.sides, { chargeRow: false });
    expect(without.rows).not.toContain("charge");
    expect(nullSpace(without.matrix, 6)).toHaveLength(2);
    const withRow = compositionMatrix(p.species, p.sides);
    expect(withRow.rows[withRow.rows.length - 1]).toBe("charge");
    expect(nullSpace(withRow.matrix, 6)).toHaveLength(1);
    expect(ok(balanceReaction("MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O")).coefficients).toEqual([1, 5, 8, 1, 5, 4]);
  });

  test("H2+O2->H2O: the unspaced-+ refusal", () => {
    const r = balanceReaction("H2+O2->H2O");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/Put spaces around a “\+” that separates species/);
  });

  test("2 H2 + O2 -> 2 H2O: already balanced, returns 2, 1, 2", () => {
    const r = ok(balanceReaction("2 H2 + O2 -> 2 H2O"));
    expect(r.coefficients).toEqual([2, 1, 2]);
    expect(r.asWritten).toEqual({ balanced: true, message: "As written it is balanced." });
  });
});

describe("species reader", () => {
  test("fractional hydrate CaSO₄·0.5H₂O = 145.142 (not 226.209)", () => {
    const p = parseSpecies("CaSO4·0.5H2O");
    if (!p.ok) throw new Error(p.error);
    expect(p.species.molarMass).toBeCloseTo(145.142, 3);
    expect(ratText(p.species.counts.O)).toBe("9/2");
    expect(p.species.display).toBe("CaSO₄·0.5H₂O");
  });
  test("plaster of Paris sets: 2 CaSO₄·0.5H₂O + 3 H₂O → 2 CaSO₄·2H₂O", () => {
    const r = ok(balanceReaction("CaSO4·0.5H2O + H2O -> CaSO4·2H2O"));
    expect(r.coefficients).toEqual([2, 3, 2]);
    expect(r.equation).toBe("2 CaSO₄·0.5H₂O + 3 H₂O → 2 CaSO₄·2H₂O");
    expect(ok(balanceReaction(r.equation)).coefficients).toEqual([2, 3, 2]);
  });
  test("hydrate dots · • * and . (integer only)", () => {
    for (const s of ["CuSO4·5H2O", "CuSO4•5H2O", "CuSO4*5H2O", "CuSO4.5H2O", "CuSO₄·5H₂O"]) {
      const p = parseSpecies(s);
      if (!p.ok) throw new Error(`${s}: ${p.error}`);
      expect(p.species.molarMass).toBeCloseTo(249.677, 3);
      expect(p.species.display).toBe("CuSO₄·5H₂O");
    }
  });
  test("½ hydrate and ½ coefficient", () => {
    const p = parseSpecies("CaSO4·½H2O");
    if (!p.ok) throw new Error(p.error);
    expect(p.species.molarMass).toBeCloseTo(145.142, 3);
    const r = ok(balanceReaction("H2 + ½O2 -> H2O"));
    expect(r.coefficients).toEqual([2, 1, 2]);
    expect(r.asWritten?.balanced).toBe(true);
    expect(r.asWritten?.message).toMatch(/fractional coefficient/);
  });
  test("chempy's CuSO4.5.H2O-style decimal dot is refused", () => {
    const p = parseSpecies("CaSO4.0.5H2O");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/ambiguous/);
  });
  test("electrons", () => {
    for (const s of ["e", "e-", "e⁻", "e^-", "e−"]) {
      const p = parseSpecies(s);
      if (!p.ok) throw new Error(`${s}: ${p.error}`);
      expect(p.species.electron).toBe(true);
      expect(p.species.charge).toBe(-1);
    }
    for (const s of ["2e-", "5 e⁻"]) {
      const p = parseSpecies(s);
      expect(p.ok && p.species.electron).toBe(true);
    }
    expect(parseSpecies("e+").ok).toBe(false);
    expect(parseSpecies("e2-").ok).toBe(false);
  });
  test("state symbols", () => {
    for (const st of ["(s)", "(l)", "(g)", "(aq)", "(cr)"]) {
      const p = parseSpecies("NaCl" + st);
      if (!p.ok) throw new Error(p.error);
      expect(p.species.state).toBe(st);
      expect(p.species.display).toBe("NaCl" + st);
    }
    const q = parseSpecies("Na+(aq)");
    expect(q.ok && q.species.charge === 1).toBe(true);
  });
  test("bare numbers and algebra are not species", () => {
    for (const s of ["x", "A", "7", "f(x)", "2x", "2*pi*r", "lim x"]) expect(parseSpecies(s, { allowNames: false }).ok).toBe(false);
  });
  test("a space inside a formula is refused (validateFormula would skip it)", () => {
    expect(parseSpecies("H2 O").ok).toBe(false);
  });
  test("SO42- is ambiguous; SO4^2- and SO₄²⁻ are sulfate", () => {
    const a = parseSpecies("SO42-");
    expect(a.ok).toBe(false);
    for (const s of ["SO4^2-", "SO₄²⁻", "SO4-2"]) {
      const p = parseSpecies(s);
      if (!p.ok) throw new Error(p.error);
      expect(p.species.charge).toBe(-2);
      expect(ratText(p.species.counts.O)).toBe("4");
    }
  });
  test("[Fe(CN)6]4- and Hg2^2+", () => {
    const p = parseSpecies("[Fe(CN)6]4-");
    expect(p.ok && p.species.charge === -4 && ratText(p.species.counts.N) === "6").toBe(true);
    const h = parseSpecies("Hg2^2+");
    expect(h.ok && h.species.charge === 2 && ratText(h.species.counts.Hg) === "2").toBe(true);
  });
  test("dictionary names resolve and are SAID", () => {
    const r = ok(balanceReaction("hydrogen + oxygen -> water"));
    expect(r.coefficients).toEqual([2, 1, 2]);
    expect(r.notes.join(" ")).toMatch(/“water” read from the compound dictionary as H₂O/);
    const cs = parseSpecies("copper sulfate");
    if (!cs.ok) throw new Error(cs.error);
    expect(cs.species.hillDisplay).toBe("CuO₄S");
    expect(cs.species.molarMass).toBeCloseTo(159.6, 1);
  });
});

describe("half-reactions", () => {
  test("MnO4- -> Mn2+ in acid: reduction, 5 e⁻", () => {
    const r = ok(balanceReaction("MnO4- -> Mn2+", { medium: "acid" }));
    expect(r.equation).toBe("MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O");
    expect(r.halfReaction).toMatchObject({ kind: "reduction", electrons: 5, summary: "Reduction (gains 5 e⁻)." });
  });
  test("MnO4- -> MnO2 in base (computed directly with OH⁻)", () => {
    const r = ok(balanceReaction("MnO4- -> MnO2", { medium: "base" }));
    expect(r.equation).toBe("MnO₄⁻ + 2 H₂O + 3 e⁻ → MnO₂ + 4 OH⁻");
    expect(r.coefficients).toEqual([1, 2, 3, 1, 4]);
  });
  test("Fe2+ -> Fe3+ is an oxidation", () => {
    const r = ok(balanceReaction("Fe2+ -> Fe3+", { medium: "acid" }));
    expect(r.equation).toBe("Fe²⁺ → Fe³⁺ + e⁻");
    expect(r.halfReaction?.kind).toBe("oxidation");
  });
  test("Cr2O7^2- -> Cr3+ in acid matches the §D1 full form", () => {
    expect(ok(balanceReaction("Cr2O7^2- -> Cr^3+", { medium: "acid" })).equation).toBe("Cr₂O₇²⁻ + 14 H⁺ + 6 e⁻ → 2 Cr³⁺ + 7 H₂O");
  });
  test("no electron transfer is said", () => {
    const r = ok(balanceReaction("CrO4^2- -> Cr2O7^2-", { medium: "acid" }));
    expect(r.halfReaction?.kind).toBe("none");
    expect(r.equation).toBe("2 CrO₄²⁻ + 2 H⁺ → Cr₂O₇²⁻ + H₂O");
  });
  test("redox pair = the direct full balance (cross-checked)", () => {
    const r = ok(combineHalfReactions("MnO4- -> Mn2+", "Fe2+ -> Fe3+", "acid"));
    expect(r.equation).toBe("MnO₄⁻ + 8 H⁺ + 5 Fe²⁺ → Mn²⁺ + 4 H₂O + 5 Fe³⁺");
    expect(r.notes.join(" ")).toMatch(/Cross-checked/);
  });
  test("text front-end", () => {
    expect(ok(balanceText("half-reaction MnO4- -> Mn2+ in acid")).halfReaction?.electrons).toBe(5);
    expect(ok(balanceText("balance in base: MnO4- -> MnO2")).coefficients).toEqual([1, 2, 3, 1, 4]);
    expect(ok(balanceText("balance Fe + O2 -> Fe2O3")).coefficients).toEqual([4, 3, 2]);
    expect(ok(balanceText("balance in acid: MnO4- -> Mn2+; Fe2+ -> Fe3+")).coefficients).toEqual([1, 8, 5, 1, 4, 5]);
    expect(balanceText("half-reaction MnO4- -> Mn2+").ok).toBe(false);
  });
});

describe("chemistryKindFor (Solve routing)", () => {
  test.each([
    "x + y = 5", "A + B = C", "C = 2*pi*r", "H = 2", "N + O = 7", "Co + O2 = 5",
    "f(x) -> 0", "x -> x^2", "lim x->0 sin(x)/x", "2x + 3y = 7", "C + O = CO",
  ])("negative: %s", (s) => expect(chemistryKindFor(s)).toBeNull());
  test.each([
    ["Co + O = CoO", "balance"],
    ["Fe + O2 = Fe2O3", "balance"],
    ["2H2 + O2 = 2H2O", "balance"],
    ["balance Fe + O2 -> Fe2O3", "balance"],
    ["KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O", "balance"],
    ["MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O", "balance"],
    ["C + O2 -> CO2", "balance"],
    ["half-reaction MnO4- -> Mn2+ in acid", "half-reaction"],
  ])("positive: %s", (s, kind) => expect(chemistryKindFor(s)).toBe(kind));
});
