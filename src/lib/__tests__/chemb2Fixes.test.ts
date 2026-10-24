// Fix round chemb2: pinned regressions from the chemistry reviewer pass (organic-chemist clients: a confidently
// wrong number is the worst outcome, so out-of-domain structures must be SAID, not priced).
//
// Reference values: Fulmer et al., Organometallics 2010, 29, 2176 (trace-impurity tables, CDCl₃: DMF 8.02 / 2.96 /
// 2.88, δC 162.62 / 36.50 / 31.39; pyridine 8.62 / 7.29 / 7.68, δC 149.90 / 123.75 / 135.96; methane 0.22), SDBS
// (anisole OCH₃ 3.80; acetophenone CH₃ 2.61; PhSiMe₃ Si–CH₃ 0.26 / δC −1.1; pyrrole, furan, thiophene) and BMRB
// (L-valine Cα ≈63, Cβ ≈32 DSS-referenced, ≈61 / ≈30 on the TMS scale). TMS is 0.00 by definition.
import { Molecule } from "openchemlib";
import { balanceText, balanceReaction, BalanceResult, BalanceOk } from "../balance";
import { parseToMolecule, spectraSizeRefusal, SPECTRA_MAX_HEAVY_ATOMS } from "../molgraph";
import { predictNmr, deptBehaviour, NmrResult } from "../nmr";
import { predictFragments } from "../fragment";
import { resolveMassSpec } from "../massspec";
import { resolveCompound, parseNmr, formatNmr, checkNmr } from "../characterization";
import { formatBotanicalNameHtml } from "../botanical";
import { stoichiometry, StoichOk } from "../stoich";
import { nmrTableText } from "../spectroPane";
import { typesetConditions } from "../reactions";
import { parseScheme, buildScheme } from "../scheme";
import { nmrChartSvg, msChartSvg, hsqcChartSvg } from "../spectraChart";
import { predictHsqc } from "../nmr2d";
import { predictIr } from "../ir";
import { pickPeaks, WAVELENGTHS, type XY } from "../solidform";

function ok(r: BalanceResult): BalanceOk {
  if (!r.ok) throw new Error(`refused (${r.kind}): ${r.message}`);
  return r;
}

// The module's stated accuracy (nmr.ts header): ¹H ±0.2–0.4 ppm, ¹³C ±2–4 ppm.
const TOL_H = 0.4;
const TOL_C = 4;

function nmr(input: string, nuc: "1H" | "13C"): NmrResult {
  const r = predictNmr(input, nuc);
  if (!r) throw new Error(`no structure for ${input}`);
  return r;
}
function shiftOf(r: NmrResult, re: RegExp): number[] {
  return r.signals.filter((s) => re.test(s.assignment)).map((s) => s.shift);
}

describe("1. full redox equations with a medium: H⁺/OH⁻ and H₂O only, no free e⁻", () => {
  test.each([
    // Textbook answers (e.g. Zumdahl, Chemistry, §4.10 and §18.1).
    ["MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+ in acid", "MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O"],
    ["Cr2O7^2- + Fe^2+ -> Cr^3+ + Fe^3+ in acidic solution", "Cr₂O₇²⁻ + 6 Fe²⁺ + 14 H⁺ → 2 Cr³⁺ + 6 Fe³⁺ + 7 H₂O"],
    ["MnO4^- + I^- -> MnO2 + I2 in base", "2 MnO₄⁻ + 6 I⁻ + 4 H₂O → 2 MnO₂ + 3 I₂ + 8 OH⁻"],
    ["Cl2 -> Cl^- + ClO3^- in base", "3 Cl₂ + 6 OH⁻ → 5 Cl⁻ + ClO₃⁻ + 3 H₂O"],
  ])("%s", (input, want) => {
    const r = ok(balanceText(input));
    expect(r.equation).toBe(want);
    expect(r.species.some((s) => s.electron)).toBe(false);
    expect(r.halfReaction).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/no free electrons/);
  });

  test("single half-reactions keep their electrons", () => {
    expect(ok(balanceText("MnO4^- -> Mn^2+ in acid")).equation).toBe("MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O");
    expect(ok(balanceText("half-reaction H2O2 -> O2 in acid")).halfReaction?.electrons).toBe(2);
    expect(ok(balanceText("balance in acid: MnO4^- -> Mn^2+; Fe^2+ -> Fe^3+")).coefficients).toEqual([1, 8, 5, 1, 4, 5]);
    // A three-species half-reaction (As₂S₃ oxidation) has no balancing without e⁻, so it still gets them.
    const as = ok(balanceReaction("As2S3 -> H3AsO4 + SO4^2-", { medium: "acid" }));
    expect(as.halfReaction?.kind).toBe("oxidation");
    expect(as.halfReaction?.electrons).toBe(28);
  });

  test("an explicit “half-reaction” verb always balances with e⁻ (a disproportionation then has no unique answer)", () => {
    expect(balanceText("half-reaction Cl2 -> Cl^- + ClO3^- in base").ok).toBe(false);
  });
});

describe("balancing: D₂O and bracketed caret charges", () => {
  test("D is read as a hydrogen isotope, with ²H's mass", () => {
    const r = ok(balanceText("D2O + Na -> NaOD + D2"));
    expect(r.equation).toBe("2 D₂O + 2 Na → 2 NaOD + D₂");
    expect(r.species[0].molarMass).toBeCloseTo(2 * 2.01410177812 + 15.999, 6);
  });
  test("Fe^(3+) and SO4^(2-)", () => {
    expect(ok(balanceText("Fe^(3+) + e^- -> Fe^(2+)")).equation).toBe("Fe³⁺ + e⁻ → Fe²⁺");
    expect(ok(balanceText("SO4^(2-) + Ba^(2+) -> BaSO4")).equation).toBe("SO₄²⁻ + Ba²⁺ → BaSO₄");
  });
});

describe("2. Spectra: a long SMILES is refused by name, never laid out", () => {
  test("C × 800: refused before any 2D layout (a frozen Word took 17 s)", () => {
    const spy = jest.spyOn(Molecule, "fromSmiles");
    try {
      const long = "C".repeat(800);
      expect(parseToMolecule(long)).toBeNull();
      expect(predictNmr(long, "13C")).toBeNull();
      const msg = spectraSizeRefusal(long);
      expect(msg).toMatch(/800 heavy atoms/);
      expect(msg).toMatch(new RegExp(`${SPECTRA_MAX_HEAVY_ATOMS}-atom limit`));
      // Deterministic work bound: every parse of the long input was coordinate-free.
      const longCalls = spy.mock.calls.filter((c) => typeof c[0] === "string" && c[0].length >= 800);
      expect(longCalls.length).toBeGreaterThan(0);
      for (const c of longCalls) expect((c[1] as { noCoordinates?: boolean } | undefined)?.noCoordinates).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  test("under the cap nothing changes", () => {
    expect(spectraSizeRefusal("C".repeat(SPECTRA_MAX_HEAVY_ATOMS))).toBeNull();
    expect(parseToMolecule("ethanol")).not.toBeNull();
  });
});

describe("3. NMR: predictions inside the stated error, or named as out of domain", () => {
  test("TMS and PhSiMe₃: silicon priced, anchored on TMS = 0", () => {
    expect(nmr("C[Si](C)(C)C", "1H").signals[0].shift).toBeCloseTo(0.0, 6);
    expect(nmr("C[Si](C)(C)C", "13C").signals[0].shift).toBeCloseTo(0.0, 6);
    const h = nmr("C[Si](C)(C)c1ccccc1", "1H");
    expect(Math.abs(shiftOf(h, /SiR3/)[0] - 0.26)).toBeLessThanOrEqual(TOL_H);
    const c = nmr("C[Si](C)(C)c1ccccc1", "13C");
    expect(Math.abs(c.signals.find((s) => s.dept === "CH3")!.shift - -1.1)).toBeLessThanOrEqual(TOL_C);
    expect(h.caveats.join(" ")).toMatch(/silicon/);
  });

  test("DMF: formyl H 8.02, formamide C=O 162.6, N–CH₃ 31.4/36.5 — and the rotamer caveat", () => {
    const h = nmr("DMF", "1H");
    expect(Math.abs(shiftOf(h, /formamide/)[0] - 8.02)).toBeLessThanOrEqual(TOL_H);
    expect(Math.abs(shiftOf(h, /^CH3/)[0] - 2.92)).toBeLessThanOrEqual(TOL_H);
    const c = nmr("DMF", "13C");
    expect(Math.abs(shiftOf(c, /formamide/)[0] - 162.6)).toBeLessThanOrEqual(TOL_C);
    const me = shiftOf(c, /^CH3/)[0];
    expect(Math.abs(me - 31.4)).toBeLessThanOrEqual(TOL_C);
    expect(Math.abs(me - 36.5)).toBeLessThanOrEqual(TOL_C);
    expect(c.caveats.join(" ")).toMatch(/Tertiary amide/);
  });

  test("L-valine α and β carbons", () => {
    const c = nmr("valine", "13C");
    const ch = c.signals.filter((s) => s.dept === "CH").map((s) => s.shift).sort((a, b) => b - a);
    expect(Math.abs(ch[0] - 61)).toBeLessThanOrEqual(TOL_C); // Cα (was 75.6)
    expect(Math.abs(ch[1] - 31)).toBeLessThanOrEqual(TOL_C); // Cβ (was 39.0)
  });

  test.each([
    ["pyridine", [8.62, 7.29, 7.68], [149.9, 123.8, 136.0]],
    ["pyrrole", [6.74, 6.24], [118.0, 108.1]],
    ["furan", [7.42, 6.38], [142.8, 109.7]],
    ["thiophene", [7.33, 7.12], [125.6, 127.3]],
  ])("%s: ring positions from the parent ring (α, β, γ)", (name, hs, cs) => {
    const h = nmr(name, "1H");
    const c = nmr(name, "13C");
    for (const [i, pos] of ["α", "β", "γ"].slice(0, hs.length).entries()) {
      const re = new RegExp(`${name} CH, ${pos} to`);
      expect(Math.abs(shiftOf(h, re)[0] - hs[i])).toBeLessThanOrEqual(TOL_H);
      expect(Math.abs(shiftOf(c, re)[0] - cs[i])).toBeLessThanOrEqual(TOL_C);
    }
  });

  test("a fused or polyhetero aromatic ring is OUT OF DOMAIN: omitted and said, never printed at 128.5 / 7.26", () => {
    for (const x of ["indole", "c1ccc2ncccc2c1", "c1cnc[nH]1", "c1cncnc1"]) {
      const c = nmr(x, "13C");
      expect(c.caveats.join(" ")).toMatch(/OUT OF DOMAIN/);
      expect(c.signals.some((s) => /aromatic/.test(s.assignment))).toBe(false);
      const h = nmr(x, "1H");
      expect(h.signals.some((s) => s.assignment === "aromatic CH")).toBe(false);
    }
    // caffeine's ring C=O carbons (155.4, 151.7) are not given the acyclic 170/158.
    expect(nmr("caffeine", "13C").signals.some((s) => /C=O/.test(s.assignment))).toBe(false);
  });

  test("anisole O–CH₃ 3.80 and acetophenone C(=O)–CH₃ 2.61", () => {
    expect(Math.abs(shiftOf(nmr("anisole", "1H"), /^CH3/)[0] - 3.8)).toBeLessThanOrEqual(TOL_H);
    expect(Math.abs(shiftOf(nmr("acetophenone", "1H"), /^CH3/)[0] - 2.61)).toBeLessThanOrEqual(TOL_H);
    // the aliphatic analogues are unchanged
    expect(Math.abs(shiftOf(nmr("CC(C)=O", "1H"), /^CH3/)[0] - 2.17)).toBeLessThanOrEqual(TOL_H);
    expect(Math.abs(shiftOf(nmr("COC", "1H"), /^CH3/)[0] - 3.24)).toBeLessThanOrEqual(TOL_H);
  });

  test("methane is CH₄: label, DEPT class and DEPT-135 phase", () => {
    const c = nmr("C", "13C").signals[0];
    expect(c.assignment).toBe("CH4");
    expect(c.dept).toBe("CH4");
    expect(deptBehaviour("CH4")).toEqual({ dept135: "DOWN", dept90: "absent" });
    const h = nmr("C", "1H").signals[0];
    expect(h.assignment).toBe("CH4");
    expect(Math.abs(h.shift - 0.22)).toBeLessThanOrEqual(TOL_H);
  });
});

describe("4. EI: CO is lost from each acylium, not from M⁺•", () => {
  const mzs = (x: string) => predictFragments(x)!.fragments;
  test("acetophenone 105 → 77; no 92", () => {
    const f = mzs("acetophenone");
    expect(f.some((x) => Math.round(x.mz) === 92)).toBe(false);
    const co = f.filter((x) => /loss of CO from the acylium/.test(x.pathway));
    expect(co.map((x) => Math.round(x.mz)).sort((a, b) => a - b)).toEqual([15, 77]);
    expect(co.find((x) => Math.round(x.mz) === 77)!.pathway).toMatch(/m\/z 105/);
  });
  test("acetone: 43 → 15, no 30", () => {
    const f = mzs("acetone");
    expect(f.some((x) => Math.round(x.mz) === 30)).toBe(false);
    expect(f.some((x) => Math.round(x.mz) === 15 && /acylium ion m\/z 43/.test(x.pathway))).toBe(true);
  });
  test("benzaldehyde M − H is the benzoyl acylium, not tropylium", () => {
    const f = mzs("benzaldehyde");
    const mh = f.find((x) => Math.round(x.mz) === 105)!;
    expect(mh.pathway).toMatch(/acylium/);
    expect(f.some((x) => /tropylium/.test(x.pathway))).toBe(false);
    expect(f.some((x) => Math.round(x.mz) === 77 && /acylium ion m\/z 105/.test(x.pathway))).toBe(true);
  });
});

describe("5. ESI adducts: a deprotonation needs a ¹H", () => {
  const names = (x: string): string[] => {
    const r = resolveMassSpec(x);
    if (r.kind !== "ok") throw new Error(`${x}: ${r.kind}`);
    return r.result.adducts.map((a) => a.name);
  };
  test.each(["Br2", "Cl2", "NaCl", "W(CO)6", "Xe", "U", "CCl4", "C2D6O"])("%s has no [M−H]⁻ / [M−2H]²⁻", (x) => {
    const n = names(x);
    expect(n).not.toContain("[M-H]-");
    expect(n).not.toContain("[M-2H]2-");
    expect(n).toContain("[M+Na]+");
  });
  test("ethanol keeps both", () => {
    expect(names("CCO")).toEqual(expect.arrayContaining(["[M-H]-", "[M-2H]2-"]));
  });
});

describe("6. Characterization passes the reader's ambiguity note through", () => {
  test("“NO” read as hydroxylamine says so", () => {
    const c = resolveCompound("NO");
    if ("refusal" in c) throw new Error(c.refusal);
    expect(c.note).toMatch(/H₃NO/);
    expect(c.note).toMatch(/formula/);
  });
});

describe("7. nothospecies: × against the epithet (ICN H.3.1, Rec. H.3A.1)", () => {
  test.each([
    ["Fragaria ×ananassa Duchesne", "<i>Fragaria</i> ×<i>ananassa</i> Duchesne"],
    ["Mentha ×piperita L.", "<i>Mentha</i> ×<i>piperita</i> L."],
    ["Citrus ×limon (L.) Osbeck", "<i>Citrus</i> ×<i>limon</i> (L.) Osbeck"],
    // spaced forms and ordinary epithets are unchanged
    ["Magnolia × soulangeana", "<i>Magnolia</i> × <i>soulangeana</i>"],
    ["Solanum xanthocarpum", "<i>Solanum</i> <i>xanthocarpum</i>"],
  ])("%s", (input, html) => {
    expect(formatBotanicalNameHtml(input)).toBe(html);
  });
});

describe("8–9. stoichiometry: ×10ⁿ, never e-notation; trailing zeros kept", () => {
  const run = (amount: string, reaction = "2 H2 + O2 -> 2 H2O"): StoichOk => {
    const r = stoichiometry({ reaction, amounts: [{ species: "O2", amount }] });
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  test.each(["6e-5 mol", "5e+29 mol", "6E-5 mol"])("%s", (amount) => {
    const text = run(amount).lines.join("\n");
    expect(text).not.toMatch(/\d[eE][+-]?\d/);
    expect(text).toMatch(/×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/);
  });
  test("6e-5 mol O₂ → 6.0×10⁻⁵ mol", () => {
    expect(run("6e-5 mol").lines.join("\n")).toContain("6.0×10⁻⁵ mol");
  });
  test("64.0 g O₂ → 2.00 mol; 16.0 g → 0.500 mol", () => {
    expect(run("64.0 g").lines.join("\n")).toMatch(/O₂ \(M = 31\.998 g\/mol\): 2\.00 mol/);
    expect(run("16.0 g").lines.join("\n")).toMatch(/: 0\.500 mol/);
  });
  test("a percent yield keeps its figures", () => {
    const r = stoichiometry({ reaction: "2 H2 + O2 -> 2 H2O", amounts: [{ species: "O2", amount: "16.0 g" }], actual: { species: "H2O", amount: "9.01 g" } });
    if (!r.ok) throw new Error(r.message);
    expect(r.percentYield!.text).toBe("50.0 %");
  });
});

describe("10. true minus", () => {
  test("nmrTableText: methane δ −2.3", () => {
    const t = nmrTableText(nmr("C", "13C"), undefined).join("\n");
    expect(t).toContain("δ −2.3");
    expect(t).not.toMatch(/δ -/);
  });
  test("an empty signal list is no table", () => {
    expect(nmrTableText({ smiles: "", nucleus: "1H", signals: [], caveats: [] }, undefined)).toEqual([]);
  });
  test("conditions: MeOH, −78 °C (text and the scheme's SVG)", () => {
    expect(typesetConditions("MeOH, -78 °C")).toBe("MeOH, −78 °C");
    expect(typesetConditions("-78 °C to rt")).toBe("−78 °C to rt");
    expect(typesetConditions("1,4-dioxane, 2-propanol")).toBe("1,4-dioxane, 2-propanol");
    const b = buildScheme(parseScheme(["CC=O", "-> NaBH4 ; MeOH, -78 °C", "CCO"].join("\n")));
    if (!b.ok) throw new Error(b.errors.join(" "));
    expect(b.svg).toContain("−78 °C");
    expect(b.svg).not.toContain("-78");
  });
  test("Characterization: J = −8.0 Hz is read as a J value and printed with the true minus", () => {
    const p = parseNmr("δ 7.26 (d, J = -8.0 Hz, 2H)", "1H");
    expect(p.peaks[0].J).toEqual(["−8.0"]);
    expect(formatNmr(p, { style: "common" })).toContain("= −8.0 Hz");
    const msgs = checkNmr(p, null, { style: "common" }).map((m) => m.text).join(" ");
    expect(msgs).not.toMatch(/none given/);
    expect(msgs).toMatch(/SIGNED coupling/);
  });
  test("Characterization: an empty list writes no “δ .” line and says why", () => {
    const p = parseNmr("", "1H");
    expect(formatNmr(p, { style: "common" })).toBe("");
    expect(checkNmr(p, null, { style: "common" }).some((m) => m.level === "error" && /No ¹H signal/.test(m.text))).toBe(true);
  });
});

describe("11. chart titles typeset the nucleus", () => {
  test("Predicted ¹H NMR / ¹³C NMR", () => {
    expect(nmrChartSvg(nmr("toluene", "1H"))).toContain("Predicted ¹H NMR");
    expect(nmrChartSvg(nmr("toluene", "13C"))).toContain("Predicted ¹³C NMR");
  });
});

/** The plot frame (the first stroked rect) and every stick / point inside it, in px. */
function frame(svg: string): { x0: number; x1: number; y0: number; y1: number } {
  const m = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/.exec(svg)!;
  return { x0: +m[1], y0: +m[2], x1: +m[1] + +m[3], y1: +m[2] + +m[4] };
}

describe("13. figures: nothing on the frame or in the corner", () => {
  test("msChartSvg: the M⁺• stick and the lowest stick sit inside the frame", () => {
    for (const x of ["acetophenone", "ibuprofen", "acetone"]) {
      const svg = msChartSvg(predictFragments(x)!)!;
      const f = frame(svg);
      const sticks = [...svg.matchAll(/<path d="M([\d.]+),[\d.]+ L([\d.]+),[\d.]+" fill="none" stroke="#(?:2563eb|dc2626)"/g)].map((m) => +m[1]);
      expect(sticks.length).toBeGreaterThan(2);
      for (const sx of sticks) {
        expect(sx).toBeGreaterThan(f.x0 + 3);
        expect(sx).toBeLessThan(f.x1 - 3);
      }
    }
  });
  test("hsqcChartSvg: every cross-peak at least 4 px from the frame", () => {
    for (const x of ["ibuprofen", "ethyl acetate", "toluene"]) {
      const svg = hsqcChartSvg(predictHsqc(x)!)!;
      const f = frame(svg);
      // A legend swatch (a circle followed by its label) sits outside the frame by design.
      const pts = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"[^>]*\/>(?!<text)/g)].map((m) => [+m[1], +m[2]]);
      expect(pts.length).toBeGreaterThan(0);
      for (const [cx, cy] of pts) {
        expect(cx - f.x0).toBeGreaterThanOrEqual(4);
        expect(f.x1 - cx).toBeGreaterThanOrEqual(4);
        expect(cy - f.y0).toBeGreaterThanOrEqual(4);
        expect(f.y1 - cy).toBeGreaterThanOrEqual(4);
      }
    }
  });
  test("scheme: PhMgBr draws a visible Br–Mg bond", () => {
    const b = buildScheme(parseScheme("Br[Mg]c1ccccc1 -> c1ccccc1"));
    if (!b.ok) throw new Error(b.errors.join(" "));
    const label = (t: string): [number, number] => {
      const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*><tspan[^>]*>${t}</tspan>`).exec(b.svg)!;
      return [+m[1], +m[2]];
    };
    const mg = label("Mg");
    const br = label("Br");
    const lines = [...b.svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)].map((m) => m.slice(1, 5).map(Number));
    // A segment whose midpoint lies between the two labels' anchors, at least 2 pt long.
    const between = lines.filter(([x1, y1, x2, y2]) => {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const inX = mx > Math.min(mg[0], br[0]) - 2 && mx < Math.max(mg[0], br[0]) + 12;
      const inY = my > Math.min(mg[1], br[1]) - 12 && my < Math.max(mg[1], br[1]) + 2;
      return inX && inY && Math.hypot(x2 - x1, y2 - y1) >= 2;
    });
    expect(between.length).toBeGreaterThanOrEqual(1);
  });
});

describe("IR: the C–O stretch of alcohols, phenols and ethers", () => {
  const band = (x: string, re: RegExp) => predictIr(x)!.bands.find((b) => re.test(b.assignment));
  test.each([
    ["ethanol", /C-O stretch \(primary alcohol\)/, 1050],
    ["CC(C)O", /C-O stretch \(secondary alcohol\)/, 1100],
    ["CC(C)(C)O", /C-O stretch \(tertiary alcohol\)/, 1150],
    ["phenol", /C-O stretch \(phenol\)/, 1230],
    ["CCOCC", /C-O-C stretch \(dialkyl ether\)/, 1120],
    ["anisole", /C-O-C asym\. stretch \(aryl alkyl ether\)/, 1250],
  ])("%s", (x, re, wn) => {
    expect(band(x, re)?.wavenumber).toBe(wn);
  });
  test("an ester's alkoxy O and an acid's OH get no alcohol/ether band", () => {
    expect(band("CC(=O)OCC", /alcohol|ether/)).toBeUndefined();
    expect(band("CC(=O)O", /alcohol|ether/)).toBeUndefined();
  });
});

describe("XRPD: Cu Kα1 data with Kα2 pairs are listed, but SAID", () => {
  const G = (x: number, c: number, w: number) => Math.exp((-4 * Math.LN2 * (x - c) ** 2) / w ** 2);
  const ka2 = (tt: number) => (2 * Math.asin((1.544426 / 1.540598) * Math.sin((tt * Math.PI) / 360)) * 180) / Math.PI;
  test("a half-height peak at the Kα2 position of a stronger one gets a note", () => {
    const xy: XY[] = [];
    for (let x = 50; x <= 70.0001; x += 0.01) xy.push([Math.round(x * 100) / 100, 100 + 3000 * G(x, 60, 0.04) + 1500 * G(x, ka2(60), 0.04)]);
    const r = pickPeaks(xy, WAVELENGTHS.CuKa1.a, { wavelength: "CuKa1" });
    expect(r.peaks.length).toBe(2);
    expect(r.notes.join(" ")).toMatch(/Kα1\/Kα2 separation/);
    // a single clean peak: no note
    const one: XY[] = [];
    for (let x = 50; x <= 70.0001; x += 0.01) one.push([Math.round(x * 100) / 100, 100 + 3000 * G(x, 60, 0.04)]);
    expect(pickPeaks(one, WAVELENGTHS.CuKa1.a, { wavelength: "CuKa1" }).notes.join(" ")).not.toMatch(/Kα2/);
  });
});
