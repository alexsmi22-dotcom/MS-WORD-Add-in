// INDEPENDENT ADVERSARIAL REVIEW — v2.139.0 spectroscopy PANE INTEGRATION
// (lib/spectroPane.ts, the Spectra / Mass Spec / Compare wiring in
// taskpane.ts, jcampChartSvg + jcampDrawPoints). The engines had their own
// review (spectro.review.test.ts); this file is about what the pane PRINTS,
// DRAWS and INSERTS.
//
//   * plain `it`      — a real defect (wrong answer, misleading output, or a
//                       display-contract break in inserted text): FAILS today.
//   * `it.failing`    — cosmetic: PASSES today (the assertion inside fails);
//                       flips to a failure once fixed — then drop `.failing`.
//   * passing `it` in the last describe — probes that confirmed correct
//                       behaviour, so a later change cannot silently undo it.
//
// taskpane.ts cannot be imported (Office.js). Pane-only defects are pinned by
// reading the source, and only where no lib function carries the logic.
// Synthetic files are built with array join — never String.replace.

import * as fs from "fs";
import * as path from "path";
import { parseJcamp, JcampSpectrum } from "../jcamp";
import { predictNmr } from "../nmr";
import { predictCoupling } from "../nmr2d";
import { resolveMassSpec, MassSpecResult } from "../massspec";
import { overlaySpectrum, formatMatchTable } from "../spectrumOverlay";
import { jcampChartSvg } from "../spectraChart";
import {
  multipletText,
  nmrTableText,
  massSpecText,
  jcampBlockLabel,
  jcampDrawPoints,
  jcampSummaryLines,
  parseReferencePeak,
  overlayPrediction,
} from "../spectroPane";

const ROOT = path.join(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
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
const one = (text: string): JcampSpectrum => {
  const r = parseJcamp(text);
  if (!r.ok) throw new Error(r.error);
  return r.spectra[0];
};
/** The pane's code for one function, by name, up to the next top-level function. */
const body = (name: string): string => {
  const i = pane.search(new RegExp(`\\nfunction ${name}\\(|\\nasync function ${name}\\(`));
  if (i < 0) throw new Error(`no function ${name} in taskpane.ts`);
  const rest = pane.slice(i + 1);
  const j = rest.search(/\n(?:async )?function [A-Za-z]/);
  return j < 0 ? rest : rest.slice(0, j);
};
/** The stroked trace path of a jcampChartSvg figure, as [x, y] pixel pairs. */
const tracePath = (svg: string): number[][] => {
  const m = /<path d="([^"]+)" fill="none" stroke="#2563eb"/.exec(svg);
  if (!m) return [];
  return m[1].split(" ").map((t) => t.slice(1).split(",").map(Number));
};

describe("reference peak (Compare panels)", () => {
  // INPUT "1,5" in the reference-peak box (a user writing one δ, decimal comma).
  // SHOWN: accepted as measured = 1, true = 5 → the measured axis is silently
  // shifted by +4 ppm and the whole match table is computed on it.
  // CORRECT: product rule — "1,5" is the decimal 1.5. A lone number is not a
  // reference, so it must be refused; and "7,36 = 7,26" (decimal commas both
  // sides) must read as 7.36 = 7.26, not be refused.
  // WHY: the comma is BOTH a separator and a decimal mark here, so the
  // commonest European entry shifts a spectrum by whole ppm without a word.
  // OWNER: spectroPane.parseReferencePeak.
  it("decimal comma: '1,5' is not a 1 → 5 reference, and '7,36 = 7,26' reads as 7.36 = 7.26", () => {
    const lone = parseReferencePeak("1,5");
    expect(lone.ok && lone.reference ? [lone.reference.measured, lone.reference.trueValue] : null).not.toEqual([1, 5]);
    expect(parseReferencePeak("7,36 = 7,26")).toEqual({ ok: true, reference: { measured: 7.36, trueValue: 7.26 } });
  });

  // INPUT reference "1000 = 0" against BRUKPAC.DX (¹³C, the file spans
  // roughly 0–240 ppm) with ethylbenzene ¹³C predicted.
  // SHOWN: accepted; the axis is moved by −1000 ppm and the table then says
  // "the measured axis looks offset by −990.79 ppm … give a reference peak to
  // correct it" — telling the user to do what they just did.
  // CORRECT: refuse a reference whose measured value is not inside the file's
  // own x span ("1000 ppm is outside this spectrum, −… to … ppm").
  // WHY: a typo (100 for 10.0) or a value from the wrong file produces a
  // full, confident-looking table on a nonsense axis.
  // OWNER: spectrumOverlay.overlaySpectrum (span check) or parseReferencePeak's caller.
  it("a reference peak measured outside the file's own x range is refused, not applied", () => {
    const f = fileOf("BRUKPAC.DX");
    const pred = overlayPrediction({ kind: "13C", nmr: predictNmr("CCc1ccccc1", "13C")! });
    if ("error" in pred) throw new Error(pred.error);
    const ref = parseReferencePeak("1000 = 0");
    const r = ref.ok ? overlaySpectrum(f.spectra[f.defaultIndex], pred, { reference: ref.reference }) : { ok: false as const, error: ref.error };
    expect(r.ok).toBe(false);
  });

  // INPUT MS panel, reference "129 = 128", ISAS_MS1.DX vs 2-chlorophenol.
  // SHOWN: "Measured axis shifted by −1.00 : the user's reference peak …" —
  // a stray space before the colon and no unit (m/z has unit "", so the
  // template leaves a hole).
  // CORRECT: "Measured axis shifted by −1.00 (m/z): …" or similar.
  // OWNER: spectrumOverlay (the conversions line), reached through the new MS reference box.
  it("MS reference conversion line has no unit and a stray space before the colon (cosmetic)", () => {
    const f = fileOf("ISAS_MS1.DX");
    const pred = overlayPrediction({ kind: "isotopes", spec: ms("Oc1ccccc1Cl") });
    if ("error" in pred) throw new Error(pred.error);
    const r = overlaySpectrum(f.spectra[0], pred, { reference: { measured: 129, trueValue: 128 } });
    if (!r.ok) throw new Error(r.error);
    expect(formatMatchTable(r)).not.toMatch(/ :/);
  });
});

describe("NMR table text — display contract", () => {
  // INPUT ibuprofen, ¹H and ¹³C, Insert.
  // SHOWN (inserted): "δ 2.70  (2H, m (²J 14–18 Hz))  CH2 (on Ph)" and, in
  // ¹³C, "δ 48.6  CH2  CH2" — both the DEPT column and the assignment.
  // CORRECT: CH₂ / CH₃ (the overlay table for the SAME prediction already
  // prints "CH₂" via typesetLabel, so the two inserted tables disagree).
  // WHY: display contract — H₂O, never H2O — in every inserted line.
  // OWNER: spectroPane.nmrTableText (and the pane's own assignment column,
  // which prints s.assignment raw). NOTE: spectroscopyRouting.test.ts pins the
  // raw "CH2 \(on Ph\)" and will need its regex updated with the fix.
  it("nmrTableText typesets CH₂/CH₃ in assignments and the DEPT column", () => {
    const h = nmrTableText(predictNmr("ibuprofen", "1H")!, predictCoupling("ibuprofen")!.signals).join("\n");
    const c = nmrTableText(predictNmr("ibuprofen", "13C")!, undefined).join("\n");
    expect(h).not.toMatch(/CH[23]\b/);
    expect(c).not.toMatch(/CH[23]\b/);
  });

  // INPUT any IR prediction, Insert; any ¹H/¹³C prediction, pane and Insert.
  // SHOWN: inserted IR rows "1715 cm-1  (1700-1725, strong)"; the NMR heading
  // "Predicted 1H NMR — …" / "Predicted 13C NMR — n signals" (pane eyebrow and
  // inserted first line), while COSY/HSQC in the same function say "¹H–¹H".
  // CORRECT: cm⁻¹; ¹H / ¹³C.
  // WHY: the brief's own example of a display-contract break (cm⁻¹), in text
  // that goes into the user's document. Pre-existing, but it is the Spectra
  // insert this release reworked. OWNER: taskpane.ts spectrumAsText /
  // renderSpectraPrediction (pane-only; source-read because nothing can import it).
  it("Spectra insert/pane: no 'cm-1', no bare '1H NMR' / '13C NMR' heading", () => {
    expect(body("spectrumAsText")).not.toMatch(/cm-1/);
    expect(body("spectrumAsText")).not.toMatch(/Predicted \$\{r\.nucleus\} NMR/);
    expect(body("renderSpectraPrediction")).not.toMatch(/Predicted \$\{kind\} NMR/);
  });
});

describe("Mass Spec text", () => {
  // INPUT caffeine (any neutral compound), Insert MS data.
  // SHOWN: "[M+H]+", "[M-H]-", "[M+NH4]+", "[M+2H]2+", "[M-2H]2-", "[M+Cl]-".
  // CORRECT: [M+H]⁺, [M−H]⁻, [M+NH₄]⁺, [M+2H]²⁺, [M−2H]²⁻, [M+Cl]⁻.
  // WHY: the exact class this release fixed for "M+-2": an ASCII hyphen as a
  // minus and charges on the line. The pattern rows above them now use true
  // minus; the adduct rows directly below do not. Pane shows the same raw names.
  // OWNER: massspec.ts adduct names (or massSpecText typesetting them).
  it("adduct names are typeset (true minus, superscript charge, NH₄)", () => {
    const t = massSpecText(ms("caffeine"));
    expect(t).not.toMatch(/\[M-/);
    expect(t).not.toMatch(/\]\d*[+\-−](?=\s)/);
    expect(t).not.toMatch(/NH4/);
  });

  // INPUT [NH4+] (any charged input).
  // SHOWN pane: "Input carries a net charge (1+); … The exact mass above is
  // still valid."  INSERTED: "net charge of +1". Isotope intensities: pane
  // toFixed(1) ("0.7"), insert toFixed(2) ("0.70%").
  // CORRECT: one notation and one precision in both.
  // OWNER: taskpane.ts updateMassSpec vs spectroPane.massSpecText.
  it("pane and inserted MS text agree on charge notation and intensity precision (cosmetic)", () => {
    const t = massSpecText(ms("[NH4+]"));
    const u = body("updateMassSpec");
    expect(u.includes("${spec.netCharge}+") && t.includes("charge of +1")).toBe(false);
    expect(u).not.toMatch(/int\.textContent = `\$\{pk\.intensity\.toFixed\(1\)\}`/);
  });
});

describe("JCAMP block readout", () => {
  // INPUT 1HQuinine.jdx (a real fixture; the Hz axis runs below zero).
  // SHOWN: "Range -799.835 to 5599.56 Hz" — ASCII hyphen as minus, in the pane
  // readout AND in the inserted data header (jcampAsText reuses these lines).
  // CORRECT: "−799.835". WHY: display contract; fmtSigned exists for exactly this.
  // OWNER: spectroPane.jcampSummaryLines.
  it("the Range line uses a true minus for negative x", () => {
    const f = fileOf("1HQuinine.jdx");
    const lines = jcampSummaryLines(f.spectra[0], "1HQuinine.jdx");
    const range = lines.find((l) => l.startsWith("Range"))!;
    expect(range).toMatch(/−799/);
    expect(range).not.toMatch(/-\d/);
  });

  // INPUT a file whose units displayUnits does not know: IMSDEMO.DX
  // ("MILLISECONDS vs PICOAMPERES"), ISAS_MS1.DX ("RELATIVE ABUNDANCE").
  // SHOWN: shouted raw strings on screen and in the insert; BRUKPAC's
  // "Range 0.00000 to 24038.5 Hz" (toPrecision trailing zeros, 6 s.f. claimed).
  // CORRECT: ms, pA, relative abundance; "0 to 24038.5 Hz".
  // OWNER: spectrumOverlay.displayUnits / spectroPane.jcampSummaryLines.
  it("unknown units are shown as shouted file strings; Range has spurious trailing zeros (cosmetic)", () => {
    const ims = jcampSummaryLines(fileOf("IMSDEMO.DX").spectra[0], "IMSDEMO.DX").join("\n");
    expect(ims).not.toMatch(/MILLISECONDS vs PICOAMPERES/);
    expect(jcampSummaryLines(fileOf("BRUKPAC.DX").spectra[0], "x").join("\n")).not.toMatch(/0\.00000 to/);
  });

  // INPUT one file: block 1 an FID (refused), block 2 IR, block 3 NMR.
  // SHOWN: picker "Block 1: … IR", "Block 2: … NMR" (position among spectra),
  // and the warning "⚠ Block 1 (ETHYLBENZOL/CDCL3) refused: …" (position in
  // the FILE). "Block 1" names two different blocks on the same screen; the
  // defaultReason ("showing block 1 …") agrees with the picker, not the file.
  // CORRECT: one numbering scheme for the picker, the reason and the refusals.
  // WHY: the user cannot tell which block was refused or which one is drawn.
  // OWNER: taskpane.ts showJcampBlock (uses r.block) vs spectroPane.jcampBlockLabel.
  it("refused-block warnings and the block picker number blocks the same way", () => {
    const fid = fs.readFileSync(path.join(FIX, "TESTFID.DX"), "latin1");
    const ir = ["##TITLE=ir", "##JCAMP-DX=4.24", "##DATA TYPE=INFRARED SPECTRUM", "##XUNITS=1/CM", "##YUNITS=ABSORBANCE", "##XYPOINTS=(XY..XY)", "1000,0.1", "1001,0.2", "1002,0.1", "##END="].join("\n");
    const nmr = ["##TITLE=nmr", "##JCAMP-DX=4.24", "##DATA TYPE=NMR SPECTRUM", "##XUNITS=PPM", "##YUNITS=ARBITRARY UNITS", "##XYPOINTS=(XY..XY)", "1,0.1", "2,0.2", "3,0.1", "##END="].join("\n");
    const r = parseJcamp([fid, ir, nmr].join("\n"));
    if (!r.ok) throw new Error(r.error);
    expect(r.refused.length).toBeGreaterThan(0);
    const numberOf = (label: string) => Number(/^Block (\d+)/.exec(label)![1]);
    const pickerNumbers = r.spectra.map((s, i) => numberOf(jcampBlockLabel(s, i)));
    // The reason line must name the same number the picker shows for the default…
    expect(Number(/showing block (\d+)/.exec(r.defaultReason)![1])).toBe(pickerNumbers[r.defaultIndex]);
    // …and a refused block (the pane prints refused.block) must not share a number with a shown one.
    const refusedNumbers = r.refused.map((x) => x.block);
    for (const n of refusedNumbers) expect(pickerNumbers).not.toContain(n);
  });
});

describe("JCAMP figure — peak tables", () => {
  // INPUT an NMR peak table with 600 peaks (a high-resolution ¹H peak list).
  // SHOWN: jcampDrawPoints makes 1,800 stick points; jcampChartSvg then runs
  // decimateTrace (budget 1,200), which keeps min/max per bucket and joins a
  // baseline point to a neighbouring peak's top — 599 diagonal segments, a
  // sawtooth: the "invented curve" jcampDrawPoints exists to prevent.
  // CORRECT: every segment vertical (sticks are never decimated into a trace).
  // OWNER: spectraChart.jcampChartSvg (decimation) / spectroPane.jcampDrawPoints.
  it("a peak table of > 400 peaks is still drawn as vertical sticks", () => {
    const rows: string[] = [];
    for (let i = 0; i < 600; i++) rows.push(`${(10 - i * 0.01).toFixed(2)}, ${1 + (i % 7)}`);
    const s = one(["##TITLE=big", "##JCAMP-DX=5.01", "##DATA TYPE=NMR PEAK TABLE", "##DATA CLASS=PEAK TABLE", "##.OBSERVE NUCLEUS=^1H", "##XUNITS=PPM", "##YUNITS=ARBITRARY UNITS", "##NPOINTS=600", "##PEAK TABLE=(XY..XY)", ...rows, "##END="].join("\n"));
    expect(s.form).toBe("peaks");
    const segs = tracePath(jcampChartSvg({ title: s.title, kind: s.kind, xUnits: "ppm", yUnits: "", points: jcampDrawPoints(s) })!);
    expect(segs.length).toBeGreaterThan(0);
    let diagonal = 0;
    for (let i = 1; i < segs.length; i++) if (Math.abs(segs[i][0] - segs[i - 1][0]) > 0.05 && Math.abs(segs[i][1] - segs[i - 1][1]) > 0.05) diagonal++;
    expect(diagonal).toBe(0);
  });

  // INPUT an IR PEAK TABLE in TRANSMITTANCE (%T): C=O at 1715 cm⁻¹ T = 5 %
  // (strong), a weak band at 2950 cm⁻¹ T = 90 %.
  // SHOWN: sticks rise from y = 0 to y = T, so the STRONGEST band (T = 5) is
  // the shortest stick and the weakest the tallest — the figure inverts what
  // the table says.
  // CORRECT: in transmittance a band hangs DOWN from the 100 % (or 1) line to T.
  // OWNER: spectroPane.jcampDrawPoints (baseline must follow the y convention).
  it("a transmittance peak table is drawn hanging from 100 %T, not rising from 0", () => {
    const s = one(["##TITLE=irpk", "##JCAMP-DX=5.01", "##DATA TYPE=INFRARED PEAK TABLE", "##DATA CLASS=PEAK TABLE", "##XUNITS=1/CM", "##YUNITS=TRANSMITTANCE", "##NPOINTS=2", "##PEAK TABLE=(XY..XY)", "1715, 5", "2950, 90", "##END="].join("\n"));
    expect(s.kind).toBe("ir");
    expect(s.form).toBe("peaks");
    const pts = jcampDrawPoints(s);
    const baselines = pts.filter((_, i) => i % 3 !== 1).map((p) => p.y);
    expect(Math.min(...baselines)).toBeGreaterThanOrEqual(90);
  });

  // INPUT ISAS_MS1.DX (MS peak table), Open.
  // SHOWN: jcampDrawPoints returns MS unchanged "because jcampChartSvg draws
  // MS as sticks" — but jcampChartSvg draws MS as type "scatter": 26 floating
  // dots, no stick, no baseline (and a profile-mode MS trace becomes 1,200 dots).
  // CORRECT: MS drawn as sticks from 0, the convention every MS reader expects.
  // OWNER: spectraChart.jcampChartSvg / spectroPane.jcampDrawPoints.
  it("an MS peak table is drawn as sticks, not floating dots (cosmetic)", () => {
    const s = fileOf("ISAS_MS1.DX").spectra[0];
    const svg = jcampChartSvg({ title: s.title, kind: s.kind, xUnits: "m/z", yUnits: "", points: jcampDrawPoints(s) })!;
    expect(svg).not.toMatch(/<circle/);
  });
});

describe("stale state", () => {
  // INPUT Mass Spec: compare with file A (overlay shown), then click Compare
  // again and pick a file over 16 MB (or one the FileReader fails on).
  // SHOWN: a status-bar error only — readJcampInput is called for the MS
  // panel WITHOUT an onError, so msJcamp/msPanel keep file A's comparison,
  // with Insert enabled, under the user's attempt to load B.
  // CORRECT: clear the MS overlay (and say why), as the Spectra path does
  // (onJcampFile passes an onError that nulls currentJcamp and refreshes).
  // OWNER: taskpane.ts msJcampFile change handler. Source-read: pane-only.
  it("the MS Compare file picker clears the old overlay when the new file cannot be read", () => {
    const i = pane.indexOf("readJcampInput(msJcampFile,");
    expect(i).toBeGreaterThan(0);
    // Find the end of this call: the handler's closing "});" followed by its own closing.
    const call = pane.slice(i, pane.indexOf("msOverlayRef.addEventListener", i));
    // An onError argument is a third argument after the (text, name) callback.
    expect(call).toMatch(/\},\s*\(\w+[^)]*\)\s*=>/);
  });
});

describe("preview vs insert", () => {
  // INPUT "cholesterol", ¹H, then Insert.
  // SHOWN: the pane pairs predictNmr("cholesterol") rows with
  // predictCoupling("cholesterol") (stored as currentSpectrum.coupling), but
  // spectrumAsText IGNORES cur.coupling and calls predictCoupling(r.smiles) —
  // a re-parse whose atom numbering differs, so the tied δ 1.55 CH rows get
  // each other's couplings: screen row 6 "sept (7.0)", document row 6
  // "m (7.0)"; row 10 "q" on screen, "quint" in the document.
  // CORRECT: the document carries exactly the rows on screen (use cur.coupling).
  // WHY: preview ≠ insert, and the pairing of a coupling with a row is decided
  // by a tie-break that differs between the two parses — wherever the tied rows
  // carry different assignments, the J lands on the wrong group.
  // OWNER: taskpane.ts spectrumAsText (predictCoupling(r.smiles) → cur.coupling).
  it("inserted ¹H rows equal the pane's rows (cholesterol)", () => {
    // FIXED (integrator): the insert no longer recomputes — it uses the couplings
    // stored with the on-screen prediction, so the rows cannot differ. (The
    // original form of this test asserted the recompute was present and then
    // compared the two parses; the recompute is gone, so it pins the fix.)
    const t = body("spectrumAsText");
    expect(t).not.toMatch(/predictCoupling\(r\.smiles\)/);
    expect(t).toMatch(/const cpl = r\.nucleus === "1H" \? cur\.coupling/);
    expect(t).toMatch(/nmrTableText\(r, cpl\?\.signals\)/);
    // And the pane builds its rows from the same stored object it keeps.
    expect(body("renderSpectraPrediction")).toMatch(/currentSpectrum = \{ kind, nmr: r, coupling: cpl \?\? undefined \}/);
    expect(body("renderSpectraPrediction")).toMatch(/multipletText\(cpl\?\.signals\[i\]/);
  });

  // INPUT a 2²⁰-point ¹H trace open, Compare active; type in the reference box.
  // SHOWN: overlaySpectrum alone measured ~0.75 s per call here, run on EVERY
  // keystroke of the reference box (and of the Spectra / Mass Spec input), with
  // no debounce — typing "7.36 = 7.26" is ~8 s of a stalled pane. Not a freeze
  // (each call ends), so cosmetic; Align was debounced for exactly this.
  // OWNER: taskpane.ts specOverlayRef / msOverlayRef listeners.
  it("the reference-peak boxes are debounced (cosmetic: ~0.75 s per keystroke on a 2²⁰-point file)", () => {
    expect(pane).toMatch(/specOverlayRef\.addEventListener\("input", debounce/);
    expect(pane).toMatch(/msOverlayRef\.addEventListener\("input", debounce/);
  });

  // INPUT [13CH3]C (¹³C-labelled ethane).
  // SHOWN: "Labelled isotopes: ¹³C × 1" and then the pattern note "labelled from
  // M = the most abundant isotope of every element; natural representative
  // composition" — which is not true of the labelled carbon.
  // CORRECT: the note says the labelled atoms are fixed at their named isotope.
  // OWNER: massspec.ts pattern note (carried by massSpecText and the figure).
  it("the pattern note for a labelled compound says the label is fixed (cosmetic)", () => {
    const spec = ms("[13CH3]C");
    // ("labelled from M" in today's note is the peak-label convention, not the isotope label.)
    expect(spec.patternNote).toMatch(/fixed|enrich/i);
  });
});

describe("probes that confirmed correct behaviour", () => {
  it("¹H rows and coupling rows align, ²J only on diastereotopic CH₂, never a J beside a 'depends' CH₂ (21 structures)", () => {
    const smis = ["OC(C)CC(C)O", "CC(O)CC(O)CC(O)C", "CC1CC(C)CCC1", "CC1CCC(C)CC1", "CC(O)CCCC(C)O", "OCC(O)CO", "CC(Cl)C(Cl)C", "CCC(C)CC", "CC(C)CC(C)C", "OC1CCC(O)CC1", "CC(Br)CC(Br)C", "CC(N)CC(N)CC(N)C", "ibuprofen", "cholesterol", "menthol", "C1CCC(CC1)CC", "CCC(CC)(O)CC", "CC(O)C(C)O", "CC(O)CCC(C)O", "CC(Cl)CCC(C)Cl", "CC(O)CC(C)CC(C)O"];
    for (const s of smis) {
      const r = predictNmr(s, "1H")!;
      const c = predictCoupling(s)!;
      expect(c.signals.length).toBe(r.signals.length);
      r.signals.forEach((g, i) => {
        const cs = c.signals[i];
        expect(cs.shift).toBeCloseTo(g.shift, 6);
        const t = multipletText(cs, g.multiplicity);
        expect(/²J/.test(t)).toBe(g.diastereotopic?.kind === "CH2");
        // A "depends" CH₂ (one carbon, two H): bare "m", no vicinal J beside it.
        if (g.diastereotopic?.kind === "depends" && g.multiplicity === "m" && /CH2/.test(g.assignment)) expect(t).toBe("m");
      });
    }
  });

  it("a 2²⁰-point peak table draws in well under the freeze budget", () => {
    const N = 1 << 20;
    const pts = new Array(N);
    for (let i = 0; i < N; i++) pts[i] = { x: (i * 7919) % 10007 / 1000, y: (i % 97) / 97 };
    const t0 = Date.now();
    const dp = jcampDrawPoints({ title: "", dataType: "", kind: "nmr", xUnits: "", yUnits: "", points: pts, meta: {}, caveats: [], form: "peaks" });
    jcampChartSvg({ title: "", kind: "nmr", xUnits: "", yUnits: "", points: dp });
    expect(Date.now() - t0).toBeLessThan(10000); // a freeze bound, not a speed claim: 1.7 s alone, 5.2 s under parallel QC load
  });

  it("the isotope overlay keeps the engine's M−2 label (ferrocene), never M+-2", () => {
    const pred = overlayPrediction({ kind: "isotopes", spec: ms("[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Fe+2]") });
    if ("error" in pred) throw new Error(pred.error);
    const labels = pred.lines.map((l) => l.label);
    expect(labels).toContain("M−2");
    expect(labels.join(" ")).not.toMatch(/M\+-|M\+−/);
  });

  it("every JCAMP failure exit on the Spectra side re-runs (clears) the comparison", () => {
    expect((body("renderJcamp").match(/refreshSpecOverlay\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(body("onJcampFile")).toMatch(/currentJcamp = null[\s\S]*refreshSpecOverlay\(\)/);
  });

  it("the MS Compare picks a non-corrupt MS block before the file's default", () => {
    expect(pane).toMatch(/findIndex\(\(s\) => s\.kind === "ms" && !s\.corrupt\)/);
  });

  it("reference peak: tabs, true minus and arrows parse; trailing junk is refused", () => {
    expect(parseReferencePeak("  7.36\t=\t7.26 ")).toEqual({ ok: true, reference: { measured: 7.36, trueValue: 7.26 } });
    expect(parseReferencePeak("7.36 = −7.26")).toEqual({ ok: true, reference: { measured: 7.36, trueValue: -7.26 } });
    expect(parseReferencePeak("7.36 = 7.26 = 1").ok).toBe(false);
    expect(parseReferencePeak("1.2.3 = 4").ok).toBe(false);
  });
});
