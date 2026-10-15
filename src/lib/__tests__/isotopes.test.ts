// isotopes.ts — the stored tables are verbatim, hashed, and derived at load
// (the gc.prt lesson: never hand-type a table of 84 elements).

import { createHash } from "crypto";
import {
  ISOTOPE_ROWS,
  ISOTOPE_ROWS_SHA256,
  LABEL_ROWS,
  LABEL_ROWS_SHA256,
  NO_STABLE_ROWS,
  NO_STABLE_ROWS_SHA256,
  ISOTOPE_SOURCES,
  elementIsotopes,
  tabulatedElements,
  isotopeMass,
  isotopeLabel,
  elementRefusal,
  parseAmeMicroU,
  parseCompositionValue,
  parseInterval,
  monoisotopicElementMass,
} from "../isotopes";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("the stored tables are exactly what was extracted", () => {
  it("hashes match (a transcription slip fails here)", () => {
    expect(sha(ISOTOPE_ROWS)).toBe(ISOTOPE_ROWS_SHA256);
    expect(sha(LABEL_ROWS)).toBe(LABEL_ROWS_SHA256);
    expect(sha(NO_STABLE_ROWS)).toBe(NO_STABLE_ROWS_SHA256);
  });

  it("records the edition that shipped: CIAAW 2024, AME2020", () => {
    expect(ISOTOPE_SOURCES.compositionEdition).toBe("2024");
    expect(ISOTOPE_SOURCES.composition).toMatch(/2024/);
    expect(ISOTOPE_SOURCES.masses).toMatch(/AME2020/);
  });

  it("84 elements, 289 isotopes; the eight Z ≤ 92 elements without a composition are the refusal set", () => {
    expect(tabulatedElements()).toHaveLength(84);
    expect(ISOTOPE_ROWS.split("\n")).toHaveLength(289);
    expect(NO_STABLE_ROWS.split("\n").map((l) => l.split("|")[1])).toEqual(["Tc", "Pm", "Po", "At", "Rn", "Fr", "Ra", "Ac"]);
    for (const el of ["Tc", "Pm", "Po", "At", "Rn", "Fr", "Ra", "Ac"]) expect(elementIsotopes(el)).toBeNull();
    // The scraped U row once carried the citation ("88", ", 293-306 (2016)"): U has exactly 3 isotopes.
    expect(elementIsotopes("U")!.isotopes.map((i) => i.A)).toEqual([234, 235, 238]);
  });

  it("every row parses; the derived numbers come from the strings", () => {
    for (const line of ISOTOPE_ROWS.split("\n")) {
      const [z, sym, a, mass, ciaaw, nist] = line.split("|");
      expect(Number.isInteger(Number(z)) && Number.isInteger(Number(a))).toBe(true);
      const e = elementIsotopes(sym)!;
      const iso = e.isotopes.find((i) => i.A === Number(a))!;
      expect(iso.mass).toBe(parseAmeMicroU(mass));
      expect(iso.ciaaw).toBe(ciaaw);
      if (parseInterval(ciaaw)) expect(iso.nist).toBe(nist);
      else expect(nist).toBe("");
      // AME2020 masses of stable isotopes are measured, never "#" estimates.
      expect(mass).not.toMatch(/#/);
    }
  });
});

describe("interval elements", () => {
  const INTERVAL = ["H", "Li", "B", "C", "N", "O", "Mg", "Si", "S", "Cl", "Ar", "Br", "Tl", "Pb"];

  it("exactly the 14 CIAAW interval elements use a NIST value", () => {
    expect(tabulatedElements().filter((e) => elementIsotopes(e)!.interval)).toEqual(INTERVAL);
  });

  /** The value actually used before normalisation: NIST's, or the midpoint where NIST's lies outside. */
  const used = (i: { nist?: string; interval?: [number, number]; intervalFallback?: boolean; ciaaw: string }) =>
    i.interval ? (i.intervalFallback ? (i.interval[0] + i.interval[1]) / 2 : parseCompositionValue(i.nist!)) : parseCompositionValue(i.ciaaw);

  it("every value USED lies INSIDE its CIAAW interval", () => {
    for (const el of INTERVAL) {
      for (const i of elementIsotopes(el)!.isotopes) {
        const v = used(i);
        const [lo, hi] = i.interval!;
        expect({ el, A: i.A, inside: v >= lo && v <= hi }).toEqual({ el, A: i.A, inside: true });
      }
    }
  });

  it("NIST lies outside the 2024 interval for ³⁶S only, which falls back to the midpoint (said, not silent)", () => {
    const fell: string[] = [];
    for (const el of INTERVAL) for (const i of elementIsotopes(el)!.isotopes) if (i.intervalFallback) fell.push(`${el}-${i.A}`);
    expect(fell).toEqual(["S-36"]);
    const s36 = elementIsotopes("S")!.isotopes.find((i) => i.A === 36)!;
    expect(parseCompositionValue(s36.nist!)).toBe(0.0001);
    expect(s36.interval).toEqual([0.000129, 0.000187]);
  });

  it("each element's printed values sum to 1 within rounding (then are normalised)", () => {
    for (const el of tabulatedElements()) {
      const e = elementIsotopes(el)!;
      const raw = e.isotopes.map(used);
      const sum = raw.reduce((s, v) => s + v, 0);
      expect({ el, ok: Math.abs(sum - 1) < 2e-3 }).toEqual({ el, ok: true });
      const norm = e.isotopes.reduce((s, i) => s + i.abundance, 0);
      expect(norm).toBeCloseTo(1, 12);
    }
  });
});

describe("masses (AME2020)", () => {
  it("the §A-12 elements", () => {
    expect(monoisotopicElementMass("Cu")).toBeCloseTo(62.92960, 5);
    expect(monoisotopicElementMass("Pa")).toBeCloseTo(231.03588, 5);
    expect(monoisotopicElementMass("C")).toBe(12);
    expect(monoisotopicElementMass("H")).toBeCloseTo(1.007825031898, 12);
  });

  it("the most abundant isotope is M's isotope (Se ⁸⁰, B ¹¹, Pt ¹⁹⁵, Fe ⁵⁶, Hg ²⁰², Sn ¹²⁰)", () => {
    const want: Record<string, number> = { Se: 80, B: 11, Pt: 195, Fe: 56, Hg: 202, Sn: 120, Pb: 208, Ar: 40 };
    for (const [el, A] of Object.entries(want)) expect({ el, A: elementIsotopes(el)!.mostAbundant.A }).toEqual({ el, A });
  });

  it("named isotopes: natural ones and stored radiolabels, nothing else", () => {
    expect(isotopeMass("C", 13)).toBeCloseTo(13.00335483534, 10);
    expect(isotopeMass("Tc", 99)).toBeCloseTo(98.906249681, 9);
    expect(isotopeMass("F", 18)).toBeCloseTo(18.000937324, 9);
    expect(isotopeMass("Tc", 100)).toBeNull();
    expect(isotopeMass("Xx", 1)).toBeNull();
  });

  it("the parsers refuse what they do not recognise", () => {
    expect(() => parseAmeMicroU("3 030775#")).toThrow();
    expect(parseCompositionValue("-")).toBeNaN();
    expect(parseInterval("0.05845(105)")).toBeNull();
  });
});

describe("refusals by name and display", () => {
  it("no stable isotope", () => {
    expect(elementRefusal("Tc")).toMatch(/^Tc \(technetium\) has no stable isotope.*\[99Tc\] for ⁹⁹Tc\.$/);
    expect(elementRefusal("Ra")).toMatch(/radium.*\[226Ra\]/);
    expect(elementRefusal("Fe")).toBeNull();
  });

  it("Z > 92", () => {
    expect(elementRefusal("Np")).toMatch(/neptunium.*Z = 93/);
    expect(elementRefusal("No")).toMatch(/nobelium.*Z = 102/);
  });

  it("isotope labels are superscripted (display contract)", () => {
    expect(isotopeLabel("Fe", 54)).toBe("⁵⁴Fe");
    expect(isotopeLabel("U", 238)).toBe("²³⁸U");
  });
});
