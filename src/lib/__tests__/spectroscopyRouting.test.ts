// v2.139.0 spectroscopy — can the pane REACH what the engines now do?
//
// Two halves, because a green engine suite proves nothing about the pane (three
// Solve features once shipped unreachable while fully tested):
//   1. the pane's formatters, which live in lib/spectroPane.ts precisely so they
//      can be tested here (nothing can import taskpane.ts — it pulls in Office.js);
//   2. the wiring itself, read from taskpane.ts / taskpane.html: the calls that
//      route each new engine to the screen and to the document.

import * as fs from "fs";
import * as path from "path";
import { parseJcamp, JcampSpectrum } from "../jcamp";
import { predictNmr } from "../nmr";
import { predictCoupling } from "../nmr2d";
import { predictIr } from "../ir";
import { predictUvVis } from "../uvvis";
import { predictFragments } from "../fragment";
import { resolveMassSpec, MassSpecResult } from "../massspec";
import { overlaySpectrum } from "../spectrumOverlay";
import {
  multipletText,
  diastereotopicNotes,
  nmrTableText,
  isotopeCoverage,
  massSpecText,
  jcampBlockLabel,
  jcampDrawPoints,
  jcampSummaryLines,
  parseReferencePeak,
  overlayPrediction,
} from "../spectroPane";

const ROOT = path.join(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.html"), "utf8");
const FIX = path.join(__dirname, "fixtures", "jcamp");

const ms = (input: string): MassSpecResult => {
  const r = resolveMassSpec(input, "auto");
  if (r.kind !== "ok") throw new Error(`${input}: ${r.kind}`);
  return r.result;
};
const fileOf = (name: string) => {
  const r = parseJcamp(fs.readFileSync(path.join(FIX, name), "latin1"));
  if (!r.ok) throw new Error(r.error);
  return r;
};
/** The pane's code for one function, by name, up to the next top-level function. */
const body = (name: string): string => {
  const i = pane.search(new RegExp(`\\nfunction ${name}\\(|\\nasync function ${name}\\(`));
  if (i < 0) throw new Error(`no function ${name} in taskpane.ts`);
  const rest = pane.slice(i + 1);
  const j = rest.search(/\n(?:async )?function [A-Za-z]/);
  return j < 0 ? rest : rest.slice(0, j);
};

describe("NMR: the multiplet column and the diastereotopic notes", () => {
  test("a diastereotopic CH₂ shows its GEMINAL ²J range, not the vicinal J (ibuprofen CH₂ on Ph)", () => {
    const r = predictNmr("ibuprofen", "1H")!;
    const c = predictCoupling("ibuprofen")!;
    const i = r.signals.findIndex((s) => s.diastereotopic?.kind === "CH2");
    expect(i).toBeGreaterThanOrEqual(0);
    // The coupling signal still carries the vicinal 7 Hz (COSY reads it) …
    expect(c.signals[i].J).toEqual([7]);
    // … but the column prints the geminal range for the class.
    expect(multipletText(c.signals[i], r.signals[i].multiplicity)).toBe("m (²J 14–18 Hz)");
  });

  test("an sp³ diastereotopic CH₂ (butan-2-ol) → m (²J 12–15 Hz)", () => {
    const r = predictNmr("CC(O)CC", "1H")!;
    const c = predictCoupling("CC(O)CC")!;
    const i = r.signals.findIndex((s) => s.diastereotopic?.kind === "CH2");
    expect(multipletText(c.signals[i], r.signals[i].multiplicity)).toBe("m (²J 12–15 Hz)");
  });

  test("ordinary first-order multiplets are unchanged (toluene ortho dd (7.8, 1.5); CH₃ s)", () => {
    const c = predictCoupling("toluene")!;
    const texts = c.signals.map((s) => multipletText(s, "?"));
    expect(texts).toContain("dd (7.8, 1.5)");
    expect(texts).toContain("s");
    expect(multipletText(undefined, "q")).toBe("q");
  });

  test("predictNmr and predictCoupling rows still align by index after the diastereotopic split", () => {
    for (const s of ["valine", "ibuprofen", "cholesterol", "CC(O)CC"]) {
      const r = predictNmr(s, "1H")!;
      const c = predictCoupling(s)!;
      expect(c.signals.length).toBe(r.signals.length);
      r.signals.forEach((g, i) => {
        expect(c.signals[i].shift).toBeCloseTo(g.shift, 6);
        expect(c.signals[i].count).toBe(g.count);
      });
    }
  });

  test("valine's diastereotopic methyls share ONE footnote letter, its text listed once", () => {
    const r = predictNmr("valine", "1H")!;
    const { marks, notes } = diastereotopicNotes(r.signals);
    expect(marks.filter((m) => m === "a")).toHaveLength(2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^a — diastereotopic: no symmetry operation/);
  });

  test("the inserted ¹H text carries the ²J range, the marks and the notes (¹³C too)", () => {
    const r = predictNmr("ibuprofen", "1H")!;
    const text = nmrTableText(r, predictCoupling("ibuprofen")!.signals).join("\n");
    expect(text).toMatch(/\(2H, m \(²J 14–18 Hz\)\)\s+CH₂ \(on Ph\)\s+\[[ab]\]/);
    expect(text).toMatch(/Diastereotopic notes:/);
    expect(text).toMatch(/geminal ²J typically 14–18 Hz/);
    const c13 = nmrTableText(predictNmr("valine", "13C")!, undefined).join("\n");
    expect(c13).toMatch(/\[a\]/);
    expect(c13).toMatch(/a — diastereotopic/);
  });

  test("a molecule with nothing diastereotopic gets no note column and no notes (toluene)", () => {
    const r = predictNmr("toluene", "1H")!;
    expect(diastereotopicNotes(r.signals).notes).toEqual([]);
    expect(nmrTableText(r, predictCoupling("toluene")!.signals).join("\n")).not.toMatch(/Diastereotopic/);
  });
});

describe("Mass Spec: labels, notes, provenance — in the inserted text", () => {
  test("ferrocene's ⁵⁴Fe peak is M−2 (true minus), never M+-2", () => {
    const t = massSpecText(ms("[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Fe+2]"));
    expect(t).toMatch(/^ {2}M−2 {2}\d+\.\d{4}/m);
    expect(t).not.toMatch(/M\+-|M\+−/);
  });

  test("C₂Cl₄: M+2 is the base peak; the pattern note and the mass source travel with the table", () => {
    const spec = ms("C2Cl4");
    const t = massSpecText(spec);
    expect(t).toMatch(/ {2}M\+2 {2}165\.8725 {2}100\.0%/);
    expect(t).toContain(spec.patternNote);
    expect(t).toContain("Masses: AME2020 (Wang et al. 2021); compositions: CIAAW 2024");
    // The v2.138 text claimed masses were "still exact" beside an incomplete pattern.
    expect(t).not.toMatch(/still exact/);
  });

  test("chlorophyll a's magnesium is IN the pattern now — nothing is excluded", () => {
    const spec = ms("chlorophyll a");
    expect(spec.unsupportedInPattern).toEqual([]);
    expect(massSpecText(spec)).not.toMatch(/Pattern excludes/);
  });

  test("a labelled isotope is named beside the formula ([13CH3]C → ¹³C × 1; CC[2H] → ²H × 1)", () => {
    expect(massSpecText(ms("[13CH3]C"))).toMatch(/Labelled isotopes: ¹³C × 1/);
    expect(massSpecText(ms("CC[2H]"))).toMatch(/Labelled isotopes: ²H × 1/);
    expect(massSpecText(ms("caffeine"))).not.toMatch(/Labelled isotopes/);
  });

  test("the coverage sentence is read from the isotope table (84 elements, H–U)", () => {
    expect(isotopeCoverage()).toBe(
      "Isotope patterns cover all 84 elements with a natural isotopic composition (H–U); masses AME2020, compositions CIAAW 2024.",
    );
  });
});

describe("JCAMP: block choice, refusals, units", () => {
  test("a LINK file's default block is the reader's choice, with its reason (ethanol_nmr.jdx → block 2)", () => {
    const f = fileOf("ethanol_nmr.jdx");
    expect(f.defaultIndex).toBe(1);
    expect(f.defaultReason).toMatch(/showing block 2/);
    expect(jcampBlockLabel(f.spectra[0], 0)).toBe("Block 1: Ethanol — NMR, peak table");
  });

  test("a peak table is drawn as sticks on a baseline, never joined into a trace; a trace is untouched", () => {
    const f = fileOf("ethanol_nmr.jdx");
    const pk = f.spectra[0];
    expect(pk.form).toBe("peaks");
    const pts = jcampDrawPoints(pk);
    expect(pts).toHaveLength(3 * pk.points.length);
    for (let i = 0; i < pts.length; i += 3) {
      expect(pts[i].y).toBe(0);
      expect(pts[i + 2].y).toBe(0);
      expect(pts[i].x).toBe(pts[i + 1].x);
    }
    expect(jcampDrawPoints(f.spectra[1])).toBe(f.spectra[1].points);
    // The pane draws through it, with display-contract units on the axes.
    expect(body("showJcampBlock")).toMatch(/points: jcampDrawPoints\(s\)/);
    expect(body("showJcampBlock")).toMatch(/xUnits: displayUnits\(s\.xUnits\)/);
  });

  test("units are shown normalised, the raw string kept as provenance (1/CM → cm⁻¹)", () => {
    const f = fileOf("compound.jdx");
    const lines = jcampSummaryLines(f.spectra[f.defaultIndex], "compound.jdx");
    expect(lines[1]).toMatch(/cm⁻¹ \(file: 1\/CM\) vs transmittance \(file: TRANSMITTANCE\)/);
    expect(lines[2]).toMatch(/ cm⁻¹$/);
  });

  test("MOLFORM is typeset (C 2 H 6 O → C₂H₆O)", () => {
    const r = parseJcamp("##TITLE=x\n##DATA TYPE=INFRARED SPECTRUM\n##MOLFORM=C 2 H 6 O\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##XYPOINTS=(XY..XY)\n1000,0.1\n1001,0.2\n1002,0.1\n##END=");
    if (!r.ok) throw new Error(r.error);
    expect(jcampSummaryLines(r.spectra[0], "x")).toContain("Formula (MOLFORM): C₂H₆O");
  });

  test("a corrupt block is labelled FAILED, and the overlay engine refuses it", () => {
    const r = parseJcamp(
      "##TITLE=test\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##FIRSTX=1\n##LASTX=8\n##XYDATA=(X++(Y..Y))\n1 10 20 30 40\n8 50 60 70 80\n##END=",
    );
    if (!r.ok) throw new Error(r.error);
    const s = r.spectra[0];
    expect(s.corrupt).toBe(true);
    expect(jcampBlockLabel(s, 0)).toMatch(/FAILED its checks/);
    const pred = overlayPrediction({ kind: "ir", ir: predictIr("CCO")! });
    if ("error" in pred) throw new Error(pred.error);
    const o = overlaySpectrum(s, pred);
    expect(o.ok).toBe(false);
  });

  test("an FID-only file is refused by name (TESTFID.DX)", () => {
    const r = parseJcamp(fs.readFileSync(path.join(FIX, "TESTFID.DX"), "latin1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/FID — needs Fourier transform/);
  });
});

describe("Overlay: the reference peak and the prediction router", () => {
  test("reference peak forms", () => {
    expect(parseReferencePeak("")).toEqual({ ok: true });
    expect(parseReferencePeak("7.36 = 7.26")).toEqual({ ok: true, reference: { measured: 7.36, trueValue: 7.26 } });
    expect(parseReferencePeak("−0.12 → 0")).toEqual({ ok: true, reference: { measured: -0.12, trueValue: 0 } });
    expect(parseReferencePeak("86.25 to 77.16")).toEqual({ ok: true, reference: { measured: 86.25, trueValue: 77.16 } });
    const bad = parseReferencePeak("TMS");
    expect(bad.ok).toBe(false);
  });

  test("every prediction kind routes to its adapter; an out-of-domain UV says why", () => {
    const p = (x: ReturnType<typeof overlayPrediction>) => ("error" in x ? x.error : x.technique);
    expect(p(overlayPrediction({ kind: "1H", nmr: predictNmr("CCO", "1H")! }))).toBe("1H");
    expect(p(overlayPrediction({ kind: "13C", nmr: predictNmr("CCO", "13C")! }))).toBe("13C");
    expect(p(overlayPrediction({ kind: "ir", ir: predictIr("CCO")! }))).toBe("ir");
    expect(p(overlayPrediction({ kind: "uvvis", uv: predictUvVis("CC(=O)C=C(C)C")! }))).toBe("uvvis");
    expect(p(overlayPrediction({ kind: "ms", ms: predictFragments("CC(C)=O")! }))).toBe("ms");
    expect(p(overlayPrediction({ kind: "isotopes", spec: ms("C2Cl4") }))).toBe("ms");
    expect(p(overlayPrediction({ kind: "uvvis", uv: predictUvVis("cinnamaldehyde")! }))).toMatch(/outside the Woodward–Fieser domain/);
  });

  test("the user's reference peak reaches the engine (BRUKPAC ¹³C, 86.25 = 77.16)", () => {
    const f = fileOf("BRUKPAC.DX");
    const ref = parseReferencePeak("86.25 = 77.16");
    if (!ref.ok) throw new Error(ref.error);
    const pred = overlayPrediction({ kind: "13C", nmr: predictNmr("CCc1ccccc1", "13C")! });
    if ("error" in pred) throw new Error(pred.error);
    const r = overlaySpectrum(f.spectra[f.defaultIndex], pred, { reference: ref.reference });
    if (!r.ok) throw new Error(r.error);
    expect(r.conversions.join(" ")).toMatch(/Measured axis shifted by −9\.09 ppm/);
  });
});

describe("the pane is wired to all of it (read from taskpane.ts / .html)", () => {
  test("JCAMP: the reader's default block, not spectra[0]; refusals and corrupt blocks surface", () => {
    expect(body("renderJcamp")).toMatch(/showJcampBlock\(parsed\.defaultIndex\)/);
    expect(body("renderJcamp")).not.toMatch(/spectra\[0\]/);
    expect(body("showJcampBlock")).toMatch(/f\.refused/);
    expect(body("showJcampBlock")).toMatch(/s\.corrupt/);
    expect(body("showJcampBlock")).toMatch(/jcampSummaryLines\(/);
    // Insert is disabled for a corrupt block — the only place the y-check reaches the user.
    expect(body("setJcampButtons")).toMatch(/!currentJcamp\.corrupt/);
    // fix2-plat: the data go in as a package (a real table), still never for a corrupt block.
    expect(body("jcampPackage")).toMatch(/s\.corrupt\) return null/);
  });

  test("Mass Spec: pk.label, the notes, the labelled isotopes and the isotope figure", () => {
    const u = body("updateMassSpec");
    expect(u).toMatch(/label\.textContent = pk\.label/);
    expect(u).not.toMatch(/M\+\$\{/);
    expect(u).toMatch(/spec\.patternNote/);
    expect(u).toMatch(/spec\.massSource/);
    expect(u).toMatch(/spec\.labelledIsotopes/);
    expect(u).toMatch(/isotopeChartSvg\(/);
    expect(u).not.toMatch(/still exact/);
    expect(pane).toMatch(/insertPlainText\(massSpecText\(currentMassSpec\)/);
    // Inserted at the SVG's own size, not a nominal one.
    expect(body("insertIsotopeChart")).toMatch(/readSvgDims\(currentIsotopeSvg/);
  });

  test("Spectra: multipletText and the note column in the pane; nmrTableText in the insert", () => {
    expect(body("renderSpectraPrediction")).toMatch(/multipletText\(cpl\?\.signals\[i\]/);
    expect(body("renderSpectraPrediction")).toMatch(/diastereotopicNotes\(r\.signals\)/);
    expect(body("spectrumAsText")).toMatch(/nmrTableText\(r, cpl\?\.signals\)/);
    expect(pane).not.toMatch(/function formatMultiplet/);
  });

  test("the overlay: both panels route through overlayPrediction → overlaySpectrum → overlayChartSvg", () => {
    const run = body("runOverlay");
    expect(run).toMatch(/parseReferencePeak\(/);
    expect(run).toMatch(/overlayPrediction\(src\)/);
    expect(run).toMatch(/overlaySpectrum\(file, pred/);
    expect(run).toMatch(/overlayChartSvg\(r\)/);
    expect(run).toMatch(/formatMatchTable\(r\)/);
    expect(body("refreshMsOverlay")).toMatch(/kind: "isotopes"/);
    expect(body("insertOverlayChart")).toMatch(/readSvgDims\(svg/);
    // Every change re-runs (or clears) the comparison: no stale overlay.
    expect(body("updateSpectra")).toMatch(/refreshSpecOverlay\(\)/);
    expect(body("showJcampBlock")).toMatch(/refreshSpecOverlay\(\)/);
    expect(body("updateMassSpec")).toMatch(/refreshMsOverlay\(\)/);
  });

  test("the HTML carries every control the pane looks up", () => {
    for (const id of [
      "jcamp-block",
      "spec-compare",
      "spec-overlay-ref",
      "spec-overlay",
      "spec-overlay-insert",
      "spec-overlay-insert-chart",
      "ms-insert-chart",
      "ms-compare",
      "ms-jcamp-file",
      "ms-overlay-ref",
      "ms-overlay",
      "ms-overlay-insert",
      "ms-overlay-insert-chart",
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(pane).toContain(`getElementById("${id}")`);
    }
    expect(html).toMatch(/proximity, not an\s+assignment/);
  });
});
