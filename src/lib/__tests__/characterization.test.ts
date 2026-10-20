// Characterization text (lib/characterization.ts). Oracles: the J. Org. Chem. author
// guidelines' own worked examples (HRMS and elemental analysis for C13H17NO3), the existing
// ESI adduct table (massspec.ADDUCTS), and hand counts. The NMR inputs are written here from
// scratch in the shapes MestReNova and journals print.
import { Molecule } from "openchemlib";
import {
  checkNmr,
  compoundFromMolecule,
  eaLine,
  formatNmr,
  hrmsLine,
  htmlText,
  normalizeMult,
  parseNmr,
  physicalLines,
  protonCount,
  resolveCompound,
  roundTyped,
  exchangeableProtons,
  CharCompound,
} from "../characterization";
import { ADDUCTS, adductMz, computeMassSpec } from "../massspec";

const compound = (s: string): CharCompound => {
  const c = resolveCompound(s);
  if ("refusal" in c) throw new Error(c.refusal);
  return c;
};
const text = (r: { html: string } | { refusal: string }): string => {
  if ("refusal" in r) throw new Error(r.refusal);
  return htmlText(r.html);
};

describe("roundTyped", () => {
  it("rounds by digits, half up, never pads", () => {
    expect(roundTyped("7.255", 2)).toBe("7.26");
    expect(roundTyped("1.005", 2)).toBe("1.01");
    expect(roundTyped("9.995", 2)).toBe("10.00");
    expect(roundTyped("128.35", 1)).toBe("128.4");
    expect(roundTyped("7.3", 2)).toBe("7.3");
    expect(roundTyped("-0.005", 2)).toBe("-0.01");
    expect(roundTyped("-0.004", 2)).toBe("0.00");
  });
});

describe("multiplicities", () => {
  it("normalizes words, broad and apparent forms", () => {
    expect(normalizeMult("brs")).toBe("br s");
    expect(normalizeMult("bs")).toBe("br s");
    expect(normalizeMult("broad singlet")).toBe("br s");
    expect(normalizeMult("app t")).toBe("app t");
    expect(normalizeMult("doublet")).toBe("d");
    expect(normalizeMult("ddd")).toBe("ddd");
    expect(normalizeMult("hept")).toBe("hept");
    expect(normalizeMult("OH")).toBeNull();
    expect(normalizeMult("CH3")).toBeNull();
  });
});

describe("¹H lists", () => {
  const BNAC = "CC(=O)OCc1ccccc1"; // benzyl acetate, C9H10O2
  const MNOVA = "1H NMR (400 MHz, Chloroform-d) δ 7.36 – 7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).";

  it("reads a MestReNova paragraph: header, spaced en-dash range, solvent name", () => {
    const p = parseNmr(MNOVA, "1H");
    expect(p.unread).toEqual([]);
    expect(p.freq).toBe("400");
    expect(p.solvent && "key" in p.solvent && p.solvent.key).toBe("CDCl3");
    expect(p.peaks.map((x) => [x.shift, x.low, x.mult, x.nH])).toEqual([
      ["7.36", "7.27", "m", "5"],
      ["5.12", undefined, "s", "2"],
      ["2.10", undefined, "s", "3"],
    ]);
  });

  it("writes the JOC form and the common form", () => {
    const p = parseNmr(MNOVA, "1H");
    expect(htmlText(formatNmr(p, { style: "joc" }))).toBe("¹H NMR (CDCl3, 400 MHz): δ 7.36–7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).");
    expect(htmlText(formatNmr(p, { style: "common" }))).toBe("¹H NMR (400 MHz, CDCl3) δ 7.36–7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).");
    // Real subscripts and italics in the html.
    expect(formatNmr(p, { style: "joc" })).toContain("CDCl<sub>3</sub>");
  });

  it("several J values, in both spellings; integration before J in JOC, after in common", () => {
    const a = parseNmr("7.05 (dd, J = 8.0, 2.1 Hz, 1H), 6.90 (d, J = 8.0 Hz, 1H)", "1H");
    const b = parseNmr("7.05 (dd, J = 8.0 Hz, J = 2.1 Hz, 1H), 6.90 (d, J = 8.0 Hz, 1H)", "1H");
    for (const p of [a, b]) {
      expect(p.unread).toEqual([]);
      expect(p.peaks[0].J).toEqual(["8.0", "2.1"]);
      expect(p.peaks[0].nH).toBe("1");
    }
    expect(htmlText(formatNmr(a, { style: "joc" }))).toContain("7.05 (dd, 1H, J = 8.0, 2.1 Hz)");
    expect(htmlText(formatNmr(a, { style: "common" }))).toContain("7.05 (dd, J = 8.0, 2.1 Hz, 1H)");
    expect(formatNmr(a, { style: "joc" })).toContain("<i>J</i> = 8.0, 2.1 Hz");
  });

  it("a labelled heteronuclear J stays its own group", () => {
    const p = parseNmr("4.45 (dt, JHF = 47.4 Hz, J = 6.0 Hz, 2H)", "1H");
    expect(p.unread).toEqual([]);
    expect(p.peaks[0].J).toEqual(["47.4", "6.0"]);
    expect(p.peaks[0].jLabels).toEqual(["HF", ""]);
    expect(formatNmr(p, { style: "common" })).toContain("<i>J</i><sub>HF</sub> = 47.4 Hz, <i>J</i> = 6.0 Hz");
    // 47.4 Hz is labelled heteronuclear, so no 0–25 Hz warning.
    expect(checkNmr(p, null, { style: "joc" }).some((m) => /0–25 Hz/.test(m.text))).toBe(false);
  });

  it("br s, app t, hept and a trailing assignment", () => {
    const p = parseNmr("5.30 (br s, 1H, OH), 3.95 (app t, J = 6.5 Hz, 2H), 2.90 (hept, J = 6.9 Hz, 1H)", "1H");
    expect(p.unread).toEqual([]);
    expect(p.peaks.map((x) => x.mult)).toEqual(["br s", "app t", "hept"]);
    expect(p.peaks[0].assign).toBe("OH");
    expect(htmlText(formatNmr(p, { style: "common" }))).toContain("5.30 (br s, 1H, OH)");
  });

  it("the RSC form: δH header, integration first, J without “=”; numbered J1/J2", () => {
    const p = parseNmr("δH (400 MHz; CDCl3) 7.26 (2H, d, J 8.4), 3.80 (3H, s)", "1H");
    expect(p.unread).toEqual([]);
    expect(p.headerNucleus).toBe("1H");
    expect(htmlText(formatNmr(p, { style: "common" }))).toBe("¹H NMR (400 MHz, CDCl3) δ 7.26 (d, J = 8.4 Hz, 2H), 3.80 (s, 3H).");
    const q = parseNmr("7.05 (dd, J1 = 8.0 Hz, J2 = 2.1 Hz, 1H), 1.25 (t, 3J = 7.1 Hz, 3H)", "1H");
    expect(q.unread).toEqual([]);
    expect(q.peaks.map((x) => x.J)).toEqual([["8.0", "2.1"], ["7.1"]]);
    expect(parseNmr("δC (101 MHz; CDCl3) 170.9", "1H").headerNucleus).toBe("13C");
  });

  it("one signal per line, without parentheses", () => {
    const p = parseNmr("7.26 d 8.0 2H\n6.85 d 8.0 2H\n3.80 s 3H", "1H");
    expect(p.unread).toEqual([]);
    expect(p.peaks.map((x) => [x.shift, x.mult, x.J, x.nH])).toEqual([
      ["7.26", "d", ["8.0"], "2"],
      ["6.85", "d", ["8.0"], "2"],
      ["3.80", "s", [], "3"],
    ]);
  });

  it("never drops a segment silently", () => {
    const p = parseNmr("7.26 (d, J = 8.0 Hz, 2H), see SI, 3.80 (s, 3H)", "1H");
    expect(p.peaks).toHaveLength(2);
    expect(p.unread).toEqual(["see SI"]);
    expect(checkNmr(p, null, { style: "joc" }).some((m) => m.level === "error" && /see SI/.test(m.text))).toBe(true);
  });

  it("lists high δ to low, whatever order was typed", () => {
    const p = parseNmr("2.10 (s, 3H), 7.30 (m, 5H), 5.12 (s, 2H)", "1H");
    expect(htmlText(formatNmr(p, { style: "common" }))).toBe("¹H NMR δ 7.30 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).");
  });

  it("JOC rounds ¹H to 0.01 ppm; common keeps the typed digits", () => {
    const p = parseNmr("7.2650 (s, 1H)", "1H");
    expect(htmlText(formatNmr(p, { style: "joc" }))).toContain("δ 7.27 (s, 1H)");
    expect(htmlText(formatNmr(p, { style: "common" }))).toContain("δ 7.2650 (s, 1H)");
  });

  it("a negative shift prints with a true minus", () => {
    const p = parseNmr("0.10 (s, 9H), -0.05 (s, 6H)", "1H");
    expect(htmlText(formatNmr(p, { style: "common" }))).toContain("−0.05 (s, 6H)");
  });

  it("the pane's solvent and frequency override the header", () => {
    const p = parseNmr(MNOVA, "1H");
    expect(htmlText(formatNmr(p, { style: "joc", solvent: "DMSO-d6", freq: "500" }))).toMatch(/^¹H NMR \(DMSO-d6, 500 MHz\): δ/);
    expect(formatNmr(p, { style: "joc", solvent: "DMSO-d6" })).toContain("DMSO-<i>d</i><sub>6</sub>");
  });

  it("round trip: the formatted line parses back to the same peaks", () => {
    const src = parseNmr("7.36 – 7.27 (m, 5H), 7.05 (dd, J = 8.0, 2.1 Hz, 1H), 5.30 (br s, 1H, OH), 4.45 (dt, JHF = 47.4 Hz, J = 6.0 Hz, 2H)", "1H");
    for (const style of ["joc", "common"] as const) {
      const back = parseNmr(htmlText(formatNmr(src, { style, solvent: "CDCl3", freq: "400" })).replace(/−/g, "-"), "1H");
      expect(back.unread).toEqual([]);
      const key = (p: typeof src) => p.peaks.map((x) => [x.shift, x.low, x.mult, x.J, x.jLabels, x.nH, x.assign]).sort();
      expect(key(back)).toEqual(key(src));
    }
  });

  it("checks: multiplicity vs J count, no integration", () => {
    const p = parseNmr("7.05 (dd, J = 8.0 Hz, 1H), 6.90 (s, J = 2.0 Hz, 1H), 3.80 (s)", "1H");
    const t = checkNmr(p, null, { style: "joc" }).map((m) => m.text).join("\n");
    expect(t).toMatch(/dd, which needs 2 J values; 1 given/);
    expect(t).toMatch(/is a s but lists a J value/);
    expect(t).toMatch(/3\.80 has no integration/);
  });

  it("checks: integration vs the formula, with exchangeable protons named", () => {
    const ok = checkNmr(parseNmr(MNOVA, "1H"), compound(BNAC), { style: "joc" });
    expect(ok.find((m) => /matching the formula/.test(m.text))).toBeTruthy();
    const benzoic = compound("OC(=O)c1ccccc1");
    const five = parseNmr("8.12 (d, J = 7.5 Hz, 2H), 7.62 (t, J = 7.5 Hz, 1H), 7.48 (t, J = 7.5 Hz, 2H)", "1H");
    const cdcl3 = checkNmr(five, benzoic, { style: "joc", solvent: "CDCl3" }).find((m) => /add up/.test(m.text))!;
    expect(cdcl3.level).toBe("info");
    expect(cdcl3.text).toMatch(/1 OH\/NH\/SH proton, which are often broad/);
    const meod = checkNmr(five, benzoic, { style: "joc", solvent: "CD3OD" }).find((m) => /add up/.test(m.text))!;
    expect(meod.text).toMatch(/exchange with CD3OD and are expected to be absent/);
    const tooMany = checkNmr(parseNmr("7.30 (m, 6H), 5.12 (s, 2H), 2.10 (s, 3H)", "1H"), compound(BNAC), { style: "joc" });
    expect(tooMany.find((m) => m.level === "error" && /more protons than the compound has/.test(m.text))).toBeTruthy();
  });

  it("deuterium is not ¹H", () => {
    expect(protonCount(compound("[2H]C([2H])([2H])c1ccccc1"))).toBe(5);
    expect(protonCount(compound("formula:CDCl3"))).toBe(0);
  });

  it("the header nucleus must match the box", () => {
    const p = parseNmr("13C NMR (101 MHz, CDCl3) δ 170.9, 66.3", "1H");
    expect(checkNmr(p, null, { style: "joc" }).some((m) => m.level === "error" && /header says ¹³C/.test(m.text))).toBe(true);
  });
});

describe("¹³C lists", () => {
  const BNAC13 = "13C NMR (101 MHz, CDCl3) δ 170.9, 136.0, 128.6, 128.3, 128.3, 66.3, 21.1.";

  it("reads and writes ¹³C{¹H} in JOC form, keeping equal values as separate lines", () => {
    const p = parseNmr(BNAC13, "13C");
    expect(p.unread).toEqual([]);
    expect(p.peaks).toHaveLength(7);
    expect(htmlText(formatNmr(p, { style: "joc" }))).toBe("¹³C{¹H} NMR (CDCl3, 101 MHz): δ 170.9, 136.0, 128.6, 128.3, 128.3, 66.3, 21.1.");
    expect(htmlText(formatNmr(p, { style: "common" }))).toBe("¹³C NMR (101 MHz, CDCl3) δ 170.9, 136.0, 128.6, 128.3, 128.3, 66.3, 21.1.");
  });

  it("JOC rounds to 0.1 ppm without merging close peaks", () => {
    const p = parseNmr("128.33, 128.29", "13C");
    expect(htmlText(formatNmr(p, { style: "joc" }))).toContain("δ 128.3, 128.3.");
    expect(htmlText(formatNmr(p, { style: "common" }))).toContain("δ 128.33, 128.29.");
  });

  it("counts against symmetry-distinct carbons (benzyl acetate: 7), and 2C entries", () => {
    const c = compound("CC(=O)OCc1ccccc1");
    const seven = checkNmr(parseNmr("170.9, 136.0, 128.6, 128.3, 128.2, 66.3, 21.1", "13C"), c, { style: "joc" });
    expect(seven.find((m) => /matching the structure's 7/.test(m.text))).toBeTruthy();
    const six = checkNmr(parseNmr("170.9, 136.0, 128.6, 128.3, 66.3, 21.1", "13C"), c, { style: "joc" });
    expect(six.find((m) => /6 signals listed; the structure has 7/.test(m.text))?.level).toBe("info");
    const eight = checkNmr(parseNmr("170.9, 136.0, 128.6, 128.4, 128.3, 128.2, 66.3, 21.1", "13C"), c, { style: "joc" });
    expect(eight.find((m) => /8 signals listed/.test(m.text))?.level).toBe("warn");
    const tooMany = checkNmr(parseNmr("170.9, 136.0 (2C), 128.6 (2C), 128.3 (2C), 128.2 (2C), 66.3, 21.1", "13C"), c, { style: "joc" });
    expect(tooMany.find((m) => m.level === "error" && /11 carbons listed, but the formula has 9/.test(m.text))).toBeTruthy();
  });

  it("diastereotopic methyls are two environments (valine's isopropyl)", () => {
    const c = compound("CC(C)[C@H](N)C(=O)O");
    const five = checkNmr(parseNmr("175.0, 60.1, 30.5, 19.0, 17.6", "13C"), c, { style: "joc" });
    expect(five.find((m) => /matching the structure's 5/.test(m.text))).toBeTruthy();
  });

  it("a C–F doublet", () => {
    const p = parseNmr("162.4 (d, J = 246.0 Hz), 115.6 (d, J = 21.8 Hz)", "13C");
    expect(p.unread).toEqual([]);
    expect(htmlText(formatNmr(p, { style: "joc" }))).toContain("162.4 (d, J = 246.0 Hz), 115.6 (d, J = 21.8 Hz)");
  });

  it("¹H data in the ¹³C box is flagged", () => {
    const p = parseNmr("7.26, 5.12, 2.10", "13C");
    expect(checkNmr(p, null, { style: "joc" }).some((m) => /looks like ¹H data/.test(m.text))).toBe(true);
  });
});

describe("HRMS", () => {
  it("the JOC guideline's own example: [M + Na]⁺ for C13H17NO3 → C13H17NO3Na 258.1101", () => {
    const c = compound("formula:C13H17NO3");
    const r = hrmsLine(c, { ion: "M+Na", source: "ESI", analyzer: "Q-TOF", found: "258.1074", style: "joc" });
    expect(text(r)).toBe("HRMS (ESI/Q-TOF) m/z: [M + Na]+ Calcd for C13H17NO3Na 258.1101; Found 258.1074.");
    if ("refusal" in r) throw new Error();
    expect(r.html).toContain("<i>m</i>/<i>z</i>");
    expect(r.html).toContain("C<sub>13</sub>H<sub>17</sub>NO<sub>3</sub>Na");
    expect(r.messages.find((m) => /within JOC's 0\.003/.test(m.text))).toBeTruthy();
  });

  it("[M + H]⁺ merges the H into the formula and agrees with the adduct table (caffeine)", () => {
    const c = compound("caffeine");
    const r = hrmsLine(c, { ion: "M+H", source: "ESI", analyzer: "TOF", style: "joc" });
    expect(text(r)).toBe("HRMS (ESI/TOF) m/z: [M + H]+ Calcd for C8H11N4O2 195.0877.");
    if ("refusal" in r) throw new Error();
    const ms = computeMassSpec("caffeine")!;
    for (const [id, name] of [["M+H", "[M+H]+"], ["M+Na", "[M+Na]+"], ["M+K", "[M+K]+"], ["M+NH4", "[M+NH4]+"], ["M+2H", "[M+2H]2+"], ["M-H", "[M-H]-"], ["M+Cl", "[M+Cl]-"], ["M+HCOO", "[M+HCOO]-"], ["M-2H", "[M-2H]2-"]]) {
      const h = hrmsLine(c, { ion: id, style: "joc" });
      if ("refusal" in h) throw new Error(h.refusal);
      const a = ADDUCTS.find((x) => x.name === name)!;
      expect(Math.abs(h.calcd - adductMz(ms.monoisotopicMass, a))).toBeLessThan(1e-9);
    }
  });

  it("Found outside 0.003 is an error, and the ion it matches is named", () => {
    const c = compound("caffeine");
    const na = hrmsLine(c, { ion: "M+Na", style: "joc" });
    if ("refusal" in na) throw new Error();
    const r = hrmsLine(c, { ion: "M+H", found: na.calcd.toFixed(4), style: "joc" });
    if ("refusal" in r) throw new Error();
    expect(r.messages.find((m) => m.level === "error" && /outside JOC's 0\.003/.test(m.text))).toBeTruthy();
    expect(r.messages.find((m) => /matches \[M \+ Na\]⁺/.test(m.text))).toBeTruthy();
  });

  it("radical cation for EI; a drawn cation as [M]⁺; refusals by name", () => {
    expect(text(hrmsLine(compound("caffeine"), { ion: "M+.", source: "EI", style: "joc" }))).toBe("HRMS (EI) m/z: [M]+• Calcd for C8H10N4O2 194.0798.");
    expect(text(hrmsLine(compound("C[N+](C)(C)C"), { ion: "M+", source: "ESI", style: "joc" }))).toBe("HRMS (ESI) m/z: [M]+ Calcd for C4H12N 74.0964.");
    const adduct = hrmsLine(compound("C[N+](C)(C)C"), { ion: "M+H", style: "joc" });
    expect("refusal" in adduct && adduct.refusal).toMatch(/already carries a charge/);
    const salt = hrmsLine(compound("C[N+](C)(C)C.[Cl-]"), { ion: "M+", style: "joc" });
    expect("refusal" in salt && salt.refusal).toMatch(/more than one part/);
    const noH = hrmsLine(compound("formula:CCl4"), { ion: "M-H", style: "joc" });
    expect("refusal" in noH && noH.refusal).toMatch(/removes 1 H, but the compound has 0/);
    const neutralM = hrmsLine(compound("caffeine"), { ion: "M+", style: "joc" });
    expect("refusal" in neutralM && neutralM.refusal).toMatch(/drawn as an ion/);
  });

  it("common style writes calcd/found in lower case", () => {
    expect(text(hrmsLine(compound("caffeine"), { ion: "M+H", source: "ESI", found: "195.0874", style: "common" }))).toBe(
      "HRMS (ESI) m/z: [M + H]+ calcd for C8H11N4O2 195.0877; found 195.0874."
    );
  });

  it("Na already in the compound is merged, not appended twice", () => {
    const r = hrmsLine(compound("CC(=O)[O-].[Na+]"), { ion: "M+Na", style: "joc" });
    expect("refusal" in r && r.refusal).toMatch(/more than one part/);
  });
});

describe("elemental analysis", () => {
  it("the JOC guideline's own example (C13H17NO3)", () => {
    const r = eaLine(compound("formula:C13H17NO3"), { C: "66.55", H: "7.01", N: "6.22" });
    expect(text(r)).toBe("Anal. Calcd for C13H17NO3: C, 66.36; H, 7.28; N, 5.95. Found: C, 66.55; H, 7.01; N, 6.22.");
    if ("refusal" in r) throw new Error();
    expect(r.messages.find((m) => /within 0\.4/.test(m.text))).toBeTruthy();
  });

  it("outside 0.4 % is an error; a hydrate formula prints as typed", () => {
    const r = eaLine(compound("formula:C13H17NO3"), { C: "65.80", H: "7.28", N: "5.95" });
    if ("refusal" in r) throw new Error();
    expect(r.messages.find((m) => m.level === "error" && /^C: Found − Calcd = −0\.56/.test(m.text))).toBeTruthy();
    const hyd = eaLine(compound("formula:C13H17NO3·0.5H2O"), {});
    expect(text(hyd)).toMatch(/^Anal\. Calcd for C13H17NO3·0\.5H2O: C, 63\.92; H, 7\.43; N, 5\.73\.$/);
  });
});

describe("yield, mp, Rf", () => {
  it("mass, mmol and percent from the molar mass", () => {
    const r = physicalLines(compound("CC(=O)OCc1ccccc1"), { massMg: "139", scaleMmol: "1.00", state: "colorless oil", mp: "", rf: "0.45", eluent: "hexanes/EtOAc 4:1" });
    if ("refusal" in r) throw new Error(r.refusal);
    expect(r.lines.map(htmlText)).toEqual(["Obtained as a colorless oil (139 mg, 0.926 mmol, 93%).", "Rf = 0.45 (hexanes/EtOAc 4:1)."]);
    expect(r.lines[1]).toContain("<i>R</i><sub>f</sub>");
  });

  it("mp range typeset; a yield over 100 % is an error", () => {
    const r = physicalLines(compound("CC(=O)OCc1ccccc1"), { massMg: "200", scaleMmol: "1.00", mp: "123-125 °C" });
    if ("refusal" in r) throw new Error();
    expect(r.lines.map(htmlText)).toEqual(["Yield: 200 mg, 1.33 mmol, 133%.", "mp 123–125 °C."]);
    expect(r.messages.find((m) => m.level === "error" && /133%/.test(m.text))).toBeTruthy();
  });
});

describe("drawn structures", () => {
  it("a Molecule from Build gives the same compound as its SMILES", () => {
    const m = Molecule.fromSmiles("CC(=O)OCc1ccccc1");
    const c = compoundFromMolecule(m);
    if ("refusal" in c) throw new Error();
    expect(htmlText(c.formulaHtml)).toBe("C9H10O2");
    expect(protonCount(c)).toBe(10);
  });
});

// Independent review, round 1: every finding pinned with its reproducing input.
describe("review round 1", () => {
  const common = (t: string, n: "1H" | "13C" = "1H") => htmlText(formatNmr(parseNmr(t, n), { style: "common" }));
  const errors = (t: string, n: "1H" | "13C" = "1H") => checkNmr(parseNmr(t, n), null, { style: "joc" }).filter((m) => m.level === "error").map((m) => m.text);

  it("B1: a missing separator never folds the next signal into an assignment", () => {
    expect(common("δ 7.26 (s, 1H) 3.50 (s, 3H), 1.20 (s, 9H)")).toBe("¹H NMR δ 7.26 (s, 1H), 3.50 (s, 3H), 1.20 (s, 9H).");
    expect(common("δ 170.9 128.4 21.0", "13C")).toBe("¹³C NMR δ 170.9, 128.4, 21.0.");
    expect(common("3.50 (s, 3H) ppm.")).toBe("¹H NMR δ 3.50 (s, 3H).");
    const si = parseNmr("7.26 (s, 1H) see SI", "1H");
    expect(si.peaks).toHaveLength(1);
    expect(si.unread).toEqual(["see SI"]);
    const pm = parseNmr("6.5 ± 0.1 (br s, 1H)", "1H");
    expect(pm.peaks).toHaveLength(0);
    expect(pm.unread).toEqual(["6.5 ± 0.1 (br s, 1H)"]);
    const both = parseNmr("1H NMR (400 MHz, CDCl3) δ 2.10 (s, 3H). 13C NMR (101 MHz, CDCl3) δ 170.1", "1H");
    expect(both.peaks.map((p) => p.shift)).toEqual(["2.10"]);
    expect(checkNmr(both, null, { style: "joc" }).some((m) => m.level === "error" && /second NMR list/.test(m.text))).toBe(true);
  });

  it("B2: a salt or solvate formula is refused for HRMS (the parent is the ion)", () => {
    for (const f of ["formula:C13H17NO3·HCl", "formula:C13H17NO3·H2O", "formula:C13H17NO3·2HCl"]) {
      const r = hrmsLine(compound(f), { ion: "M+H", style: "joc" });
      expect("refusal" in r && r.refusal).toMatch(/more than one part \(a salt or solvate/);
    }
    expect(text(eaLine(compound("formula:C13H17NO3·HCl"), {}))).toMatch(/^Anal\. Calcd for C13H17NO3·HCl: /);
  });

  it("B3: [M] takes the structure's charge — an anion is [M]⁻", () => {
    const r = hrmsLine(compound("smiles:CC(=O)[O-]"), { ion: "M+", style: "joc" });
    expect(text(r)).toBe("HRMS m/z: [M]− Calcd for C2H3O2 59.0139.");
  });

  it("B4: header items never overwrite the solvent, and a temperature is printed", () => {
    const tms = parseNmr("1H NMR (CDCl3, TMS, 400 MHz) δ 7.26 (s, 1H)", "1H");
    expect(htmlText(formatNmr(tms, { style: "joc" }))).toBe("¹H NMR (CDCl3, 400 MHz, TMS): δ 7.26 (s, 1H).");
    const vt = parseNmr("1H NMR (500 MHz, DMSO-d6, 353 K) δ 7.26 (s, 1H)", "1H");
    expect(htmlText(formatNmr(vt, { style: "common" }))).toBe("¹H NMR (500 MHz, DMSO-d6, 353 K) δ 7.26 (s, 1H).");
    expect(checkNmr(vt, null, { style: "joc" }).some((m) => /printed as typed: 353 K/.test(m.text))).toBe(true);
  });

  it("S1: hyphenated headers (1H-NMR, 13C-NMR) and δH( without a space", () => {
    expect(common("1H-NMR (400 MHz, CDCl3): δ 7.26 (s, 1H)")).toBe("¹H NMR (400 MHz, CDCl3) δ 7.26 (s, 1H).");
    expect(errors("13C-NMR (101 MHz, CDCl3) δ 170.1")[0]).toMatch(/header says ¹³C/);
    expect(common("δH(400 MHz, CDCl3) 7.26 (s, 1H)")).toBe("¹H NMR (400 MHz, CDCl3) δ 7.26 (s, 1H).");
    expect(common("1H NMR 400 MHz, CDCl3 δ 7.26 (s, 1H)")).toBe("¹H NMR (400 MHz, CDCl3) δ 7.26 (s, 1H).");
  });

  it("S2/S3/S5: J lists stop at an integration or carbon count; J ranges; a repeated Hz", () => {
    const a = parseNmr("7.26 (d, J = 8.0, 2H)", "1H").peaks[0];
    expect([a.J, a.nH]).toEqual([["8.0"], "2"]);
    const b = parseNmr("7.26 (2H, d, J 8.0, 1 H)", "1H").peaks[0];
    expect(b.J).toEqual(["8.0"]);
    const c = parseNmr("115.6 (d, J = 8.1, 2C)", "13C").peaks[0];
    expect([c.J, c.nC]).toEqual([["8.1"], "2"]);
    expect(common("1.60 (m, J = 7.0-7.5 Hz, 2H)")).toBe("¹H NMR δ 1.60 (m, J = 7.0–7.5 Hz, 2H).");
    expect(common("7.05 (dd, J = 8.0 Hz, 2.0 Hz, 1H)")).toBe("¹H NMR δ 7.05 (dd, J = 8.0, 2.0 Hz, 1H).");
  });

  it("S4: rotamer pairs are named as unread, not garbled", () => {
    const p = parseNmr("3.50 and 3.45 (2 × s, 3H, rotamers)", "1H");
    expect(p.peaks).toHaveLength(0);
    expect(p.unread).toHaveLength(1);
  });

  it("S6: decimal commas are refused by name", () => {
    for (const [t, n] of [["δ 7,26 (d, J = 8,0 Hz, 2H), 3,50 (s, 3H)", "1H"], ["170,1; 128,4", "13C"]] as const) {
      const p = parseNmr(t, n);
      expect(p.peaks).toHaveLength(0);
      expect(errors(t, n).some((e) => /decimal commas/.test(e))).toBe(true);
    }
    // A J pair written "8.0,2.1" is not a decimal comma.
    expect(parseNmr("7.05 (dd, J = 8.0,2.1 Hz, 1H)", "1H").peaks[0].J).toEqual(["8.0", "2.1"]);
  });

  it("S7: JOC rounding never collapses a range", () => {
    expect(htmlText(formatNmr(parseNmr("1.304–1.296 (m, 2H)", "1H"), { style: "joc" }))).toContain("δ 1.304–1.296 (m, 2H)");
  });

  it("S8: mp keeps one °C, after the temperatures; negatives get a true minus", () => {
    const mp = (v: string) => {
      const r = physicalLines(null, { mp: v });
      if ("refusal" in r) throw new Error();
      return htmlText(r.lines[0]);
    };
    expect(mp("123–125 °C (EtOAc/hexanes)")).toBe("mp 123–125 °C (EtOAc/hexanes).");
    expect(mp("123-125 (dec.)")).toBe("mp 123–125 °C (dec.).");
    expect(mp("123–125 ℃")).toBe("mp 123–125 °C.");
    expect(mp("123-125 oC")).toBe("mp 123–125 °C.");
    expect(mp("-12 to -10")).toBe("mp −12 to −10 °C.");
    expect(mp("> 250")).toBe("mp > 250 °C.");
  });

  it("S9: a frequency typed with its unit is not doubled; a non-number is said", () => {
    const p = parseNmr("7.26 (s, 1H)", "1H");
    expect(htmlText(formatNmr(p, { style: "joc", freq: "400 MHz", solvent: "CDCl3" }))).toBe("¹H NMR (CDCl3, 400 MHz): δ 7.26 (s, 1H).");
    expect(checkNmr(p, null, { style: "joc", freq: "four hundred" }).some((m) => /not a number of MHz/.test(m.text))).toBe(true);
  });

  it("S10: a list that marks 2C is not told to mark 2C", () => {
    const c = compound("CC(=O)OCc1ccccc1");
    const t = checkNmr(parseNmr("170.9, 136.0, 128.6 (2C), 128.3 (2C), 66.3, 21.1", "13C"), c, { style: "joc" }).map((m) => m.text).join("\n");
    expect(t).not.toMatch(/mark them/);
    expect(t).toMatch(/With the nC counts, 8 of the formula's 9 carbons/);
  });

  it("S11: an OH already listed is not the missing proton", () => {
    const bnoh = compound("OCc1ccccc1");
    const m = checkNmr(parseNmr("7.30 (m, 4H), 4.70 (s, 2H), 1.90 (br s, 1H, OH)", "1H"), bnoh, { style: "joc" }).find((x) => /add up/.test(x.text))!;
    expect(m.level).toBe("warn");
  });

  it("S12: tilde ranges", () => {
    expect(common("7.36~7.27 (m, 5H)")).toBe("¹H NMR δ 7.36–7.27 (m, 5H).");
  });

  it("nits: brd, an orange oil, .35, no exponent, Found at exactly 0.003, O–D not exchangeable", () => {
    expect(normalizeMult("brd")).toBe("br d");
    const r = physicalLines(compound("caffeine"), { massMg: "0.0000129", state: "orange oil", rf: ".35", eluent: "EtOAc" });
    if ("refusal" in r) throw new Error();
    expect(htmlText(r.lines[0])).toMatch(/^Obtained as an orange oil \(0\.0000129 mg, 0\.0000000664 mmol\)\.$/);
    expect(htmlText(r.lines[1])).toBe("Rf = 0.35 (EtOAc).");
    const h = hrmsLine(compound("caffeine"), { ion: "M+H", found: "195.0907", style: "joc" });
    if ("refusal" in h) throw new Error();
    expect(h.messages.find((m) => /within JOC's 0\.003/.test(m.text))).toBeTruthy();
    const d = compound("[2H]OC");
    expect(exchangeableProtons(d)).toBe(0);
  });
});

// Independent review, round 2 (after the round-1 parser rewrite).
describe("review round 2", () => {
  const common = (t: string, n: "1H" | "13C" = "1H") => htmlText(formatNmr(parseNmr(t, n), { style: "common" }));

  it("B1: digits after a parenthesis that are not a shift never become a peak — the segment is named", () => {
    for (const [t, n] of [
      ["δ 128.4 (CH) 2C, 77.2", "13C"],
      ["δ 170.9 (C=O) 13C-labelled, 128.4", "13C"],
      ["δ 21.0 (CH3) 2D", "13C"],
      ["δ 7.26 (d, J = 8.0 Hz) 2H, 3.50 (s, 3H)", "1H"],
      ["δ 1.25 (s, 6H) 2 × CH3", "1H"],
      ["3.50 (s, 3H) 1H", "1H"],
    ] as const) {
      const p = parseNmr(t, n);
      expect(p.peaks.every((x) => Number(x.shift) > 5 || n === "1H")).toBe(true);
      expect(p.peaks.some((x) => /^(1|2|13)$/.test(x.shift))).toBe(false);
      expect(p.unread.length).toBeGreaterThan(0);
    }
  });

  it("B2: any comma between digits outside parentheses is refused by name", () => {
    for (const [t, n] of [["δ 128,4 (q, J = 272.1 Hz), 21,0", "13C"], ["δ 170.1, 128,4", "13C"], ["δ 7,26 (d, J = 8.0 Hz, 2H), 3,50 (s, 3H)", "1H"], ["δ 77,160, 128,452, 21,003", "13C"]] as const) {
      const p = parseNmr(t, n);
      expect(p.peaks).toHaveLength(0);
      expect(p.issues.join(" ")).toMatch(/comma sits between digits/);
    }
    expect(parseNmr("7.26 (d, J = 8,2 Hz, 2H)", "1H").peaks[0].J).toEqual(["8", "2"]);
  });

  it("B3: words after a bare ¹³C value are named, not an assignment", () => {
    const p = parseNmr("170.9, 136.0, 21.1 see SI", "13C");
    expect(p.peaks.map((x) => x.shift)).toEqual(["170.9", "136.0"]);
    expect(p.unread).toEqual(["21.1 see SI"]);
  });

  it("S1: a second-list cut only outside parentheses", () => {
    expect(parseNmr("δ 3.50 (s, 3H, assigned by 1H NMR NOE)", "1H").peaks).toHaveLength(1);
    expect(parseNmr("δ 55.1 (OCH3, δC from HSQC), 21.0", "13C").peaks).toHaveLength(2);
  });

  it("S2: ppm from the exact values — caffeine Found 195.0874 is −1.3 ppm", () => {
    const r = hrmsLine(compound("caffeine"), { ion: "M+H", found: "195.0874", style: "joc" });
    if ("refusal" in r) throw new Error();
    expect(r.ppm!.toFixed(1)).toBe("-1.3");
    expect(r.messages[0].text).toMatch(/−1\.3 ppm/);
  });

  it("S3: a paste mixing parenthesised and one-per-line signals", () => {
    const p = parseNmr("δ 7.26 (d, J = 8.0 Hz, 2H)\n6.90 dd 8.0, 2.0 1H", "1H");
    expect(p.peaks.map((x) => [x.shift, x.mult, x.J, x.nH])).toEqual([["7.26", "d", ["8.0"], "2"], ["6.90", "dd", ["8.0", "2.0"], "1"]]);
  });

  it("S4: mp with a bare C", () => {
    const r = physicalLines(null, { mp: "123-125 C" });
    if ("refusal" in r) throw new Error();
    expect(htmlText(r.lines[0])).toBe("mp 123–125 °C.");
  });

  it("S5: ¹J / ²J keep their bond count", () => {
    const p = parseNmr("162.4 (d, 1JCF = 246.0 Hz), 115.6 (d, 2JCF = 21.8 Hz), 1.25 (t, ³J = 7.1 Hz)", "13C");
    const html = formatNmr(p, { style: "joc" });
    expect(html).toContain("<sup>1</sup><i>J</i><sub>CF</sub> = 246.0 Hz");
    expect(html).toContain("<sup>2</sup><i>J</i><sub>CF</sub> = 21.8 Hz");
    expect(html).toContain("<sup>3</sup><i>J</i> = 7.1 Hz");
  });

  it("S6/S7: EA of a bare ion is refused; a typed charge is raised", () => {
    for (const f of ["formula:C4H12N+", "smiles:C[N+](C)(C)C"]) {
      const r = eaLine(compound(f), {});
      expect("refusal" in r && r.refusal).toMatch(/as an ion/);
    }
    expect(compound("formula:C4H12N+.Cl-").formulaHtml).toBe("C<sub>4</sub>H<sub>12</sub>N<sup>+</sup>·Cl<sup>−</sup>");
  });

  it("nits: spaces around ·, Unicode typed formula, an 8:1 mixture, no 0.00 for absent C, <0.1%, every mp range, brackets, menu solvent vs header", () => {
    expect(compound("formula:C13H17NO3 · HCl").formulaHtml).toBe("C<sub>13</sub>H<sub>17</sub>NO<sub>3</sub>·HCl");
    expect(compound("formula:C₁₃H₁₇NO₃·HCl").formulaHtml).toBe("C<sub>13</sub>H<sub>17</sub>NO<sub>3</sub>·HCl");
    const mix = physicalLines(null, { state: "8:1 mixture of diastereomers" });
    if ("refusal" in mix) throw new Error();
    expect(htmlText(mix.lines[0])).toBe("Obtained as an 8:1 mixture of diastereomers.");
    expect(text(eaLine(compound("formula:NaCl"), {}))).not.toMatch(/C, 0\.00/);
    const y = physicalLines(compound("caffeine"), { massMg: "0.0001", scaleMmol: "1" });
    if ("refusal" in y) throw new Error();
    expect(htmlText(y.lines[0])).toMatch(/<0\.1%\)?\.$/);
    const two = physicalLines(null, { mp: "123-125 °C, 126-128 (2nd crop)" });
    if ("refusal" in two) throw new Error();
    expect(htmlText(two.lines[0])).toBe("mp 123–125 °C, 126–128 (2nd crop).");
    expect(common("7.26 [d, J = 8.0 Hz, 2H]")).toBe("¹H NMR δ 7.26 (d, J = 8.0 Hz, 2H).");
    const p = parseNmr("1H NMR (400 MHz, CDCl3) δ 7.26 (s, 1H)", "1H");
    expect(checkNmr(p, null, { style: "joc", solvent: "DMSO-d6" }).some((m) => /header names CDCl3; the Solvent menu's DMSO-d6/.test(m.text))).toBe(true);
  });
});

// Independent review, round 3 (after round 2's splitter change).
describe("review round 3", () => {
  const common = (t: string, n: "1H" | "13C" = "1H") => htmlText(formatNmr(parseNmr(t, n), { style: "common" }));

  it("1: one line, no parentheses, comma-separated signals — each read, none swallowed into J", () => {
    expect(common("1H NMR (400 MHz, CDCl3) δ 7.26 dd 8.0 1H, 6.90 d 2H")).toBe("¹H NMR (400 MHz, CDCl3) δ 7.26 (dd, J = 8.0 Hz, 1H), 6.90 (d, 2H).");
    expect(common("δ 7.26 d 8.0 2H, 6.90 d 8.0 2H")).toBe("¹H NMR δ 7.26 (d, J = 8.0 Hz, 2H), 6.90 (d, J = 8.0 Hz, 2H).");
    expect(common("δ 1.25 t 7.1 3H, 4.12 q 7.1 2H")).toBe("¹H NMR δ 4.12 (q, J = 7.1 Hz, 2H), 1.25 (t, J = 7.1 Hz, 3H).");
    expect(common("7.26 (d, J = 8.0 Hz, 2H)\n3.50 s 3H\n2.10 d 7.0 3H, 1.10 d 7.0 3H")).toBe("¹H NMR δ 7.26 (d, J = 8.0 Hz, 2H), 3.50 (s, 3H), 2.10 (d, J = 7.0 Hz, 3H), 1.10 (d, J = 7.0 Hz, 3H).");
    expect(common("6.90 dd 8.0, 2.0 1H")).toBe("¹H NMR δ 6.90 (dd, J = 8.0, 2.0 Hz, 1H).");
    // A number after the integration is a stray value: the segment is named, not folded into J.
    expect(parseNmr("7.26 dd 8.0 1H 6.90", "1H").unread).toEqual(["7.26 dd 8.0 1H 6.90"]);
  });

  it("2: correct lists are read — ppm units, decimals run together, an integer after a parenthesis", () => {
    expect(common("13C NMR (101 MHz, CDCl3) δ 170.1 ppm, 128.4 ppm, 21.0 ppm", "13C")).toBe("¹³C NMR (101 MHz, CDCl3) δ 170.1, 128.4, 21.0.");
    expect(common("δ 170.1,128.4,21.0", "13C")).toBe("¹³C NMR δ 170.1, 128.4, 21.0.");
    expect(common("δ 170.1 (C=O) 128, 21", "13C")).toBe("¹³C NMR δ 170.1 (C=O), 128, 21.");
  });

  it("3: the 2 of CH2 is not a bond count", () => {
    const p = parseNmr("7.26 (t, 2H, OCH2 J = 7.0 Hz)", "1H").peaks[0];
    expect(p.jBonds).toEqual([""]);
  });

  it("b: br s in the line format; H-2,6 kept whole; mp: prefix; articles", () => {
    expect(parseNmr("12.1 br s 1H", "1H").peaks[0].mult).toBe("br s");
    expect(parseNmr("7.10 (d, J = 8.0 Hz, 2H, H-2,6)", "1H").peaks[0].assign).toBe("H-2,6");
    const mp = physicalLines(null, { mp: "mp: 123-125 °C" });
    if ("refusal" in mp) throw new Error();
    expect(htmlText(mp.lines[0])).toBe("mp 123–125 °C.");
    const art = (w: string) => {
      const r = physicalLines(null, { state: w });
      if ("refusal" in r) throw new Error();
      return htmlText(r.lines[0]);
    };
    expect(art("uniform solid")).toBe("Obtained as a uniform solid.");
    expect(art("one-to-one mixture")).toBe("Obtained as a one-to-one mixture.");
    expect(art("unknown oil")).toBe("Obtained as an unknown oil.");
  });
});
