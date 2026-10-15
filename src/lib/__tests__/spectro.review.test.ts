// INDEPENDENT ADVERSARIAL REVIEW — v2.138.0 spectroscopy batch
// (docs/SCOPE-SPECTROSCOPY-BATCH.md §A–§E).
//
// Every test here pins a defect the authors' own suites do not reach.
//   * plain `it`      — a WRONG answer today: the test FAILS until it is fixed.
//   * `it.failing`    — a cosmetic defect or a refusal where an answer exists:
//                       it PASSES today (the assertion inside fails), and flips
//                       to a failure once fixed — then drop `.failing`.
//
// Oracles are independent of the code under test: hand arithmetic from the
// Woodward–Fieser enone table, the JCAMP-DX header's own FIRSTX/LASTX, the
// definition A = −log₁₀T, and the peak list as written in the file.
//
// Synthetic files are built with array join — never String.replace, whose "$$"
// in a replacement string silently becomes "$".

import * as fs from "fs";
import * as path from "path";
import { parseJcamp, JcampSpectrum } from "../jcamp";
import { overlaySpectrum, OverlayOk, PredictedSpectrum } from "../spectrumOverlay";
import { predictUvVis } from "../uvvis";
import { resolveMassSpec } from "../massspec";

const FIX = path.join(__dirname, "fixtures", "jcamp");

function block(text: string, i = 0): JcampSpectrum {
  const r = parseJcamp(text);
  if (!r.ok) throw new Error(`fixture refused: ${r.error}`);
  return r.spectra[i];
}

function ok(r: ReturnType<typeof overlaySpectrum>): OverlayOk {
  if (!r.ok) throw new Error(`overlay refused: ${r.error}`);
  return r;
}

const near = (xs: number[], v: number, tol: number): boolean => xs.some((x) => Math.abs(x - v) <= tol);

// ---------------------------------------------------------------------------
// 1. JCAMP: XYDATA without ##NPOINTS stacks every ordinate of a line on ONE x
// ---------------------------------------------------------------------------

describe("JCAMP reader — XYDATA with FIRSTX/LASTX but no NPOINTS", () => {
  // Today: ok, not corrupt, x = 1,1,1,1,5,5,5,5 (step 0), under a caveat that says
  // "X spacing was taken from the data lines instead" — it was not.
  // Oracle: the header itself (FIRSTX 1, LASTX 8, 8 ordinates decoded) and the
  // line X values (1, 5: four ordinates per line) both give x = 1…8. Python
  // `jcamp` 1.3.2 refuses the file (KeyError 'npoints'), so the property pinned
  // is: the abscissae are strictly monotonic, or the block is refused/corrupt.
  const text = [
    "##TITLE=no npoints",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=INFRARED SPECTRUM",
    "##XUNITS=1/CM",
    "##YUNITS=ABSORBANCE",
    "##FIRSTX=1",
    "##LASTX=8",
    "##XFACTOR=1",
    "##YFACTOR=1",
    "##XYDATA=(X++(Y..Y))",
    "1 10 20 30 40",
    "5 50 60 70 80",
    "##END=",
  ].join("\n");

  it("never returns an ok, non-corrupt trace whose x values repeat", () => {
    const r = parseJcamp(text);
    if (!r.ok) return; // a refusal is an honest answer
    const s = r.spectra[0];
    if (s.corrupt) return; // so is a flagged block
    const xs = s.points.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

// ---------------------------------------------------------------------------
// 2. OVERLAY: a PEAK TABLE block (NMR / IR) is peak-picked as if it were a trace
// ---------------------------------------------------------------------------
//
// Only the MS branch treats `form === "peaks"` as sticks. Every other technique
// runs pickPeaks (local maxima above the MEDIAN ordinate) over the peak list in
// file order, so most listed peaks vanish and predicted lines are "matched" to
// the wrong measured peak with a ✓.

describe("overlay — non-MS peak tables", () => {
  const c13Table = [
    "##TITLE=ethyl acetate 13C peaks",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=NMR PEAK TABLE",
    "##.OBSERVE NUCLEUS=^13C",
    "##XUNITS=PPM",
    "##YUNITS=ARBITRARY UNITS",
    "##NPOINTS=4",
    "##PEAK TABLE=(XY..XY)",
    "171.1,20",
    "60.5,80",
    "21.0,60",
    "14.2,100",
    "##END=",
  ].join("\n");
  const c13Pred: PredictedSpectrum = {
    technique: "13C",
    lines: [
      { x: 170.5, height: 1, label: "C=O" },
      { x: 60.4, height: 1, label: "OCH₂" },
      { x: 21.0, height: 1, label: "CH₃CO" },
      { x: 14.2, height: 1, label: "CH₃" },
    ],
  };

  // Today: peaks [14.2] only; 21.0 → nearest 14.2 "within ✓"; 170.5 and 60.4 → 14.2.
  // Oracle: the four listed peaks; each prediction's nearest is its own peak.
  it("¹³C peak table: every listed peak is a measured peak, and each line matches its own", () => {
    const r = ok(overlaySpectrum(block(c13Table), c13Pred));
    const xs = r.peaks.map((p) => p.x);
    for (const v of [171.1, 60.5, 21.0, 14.2]) expect(near(xs, v, 1e-6)).toBe(true);
    const row21 = r.rows.find((q) => q.predicted === 21.0)!;
    expect(row21.nearest).toBeCloseTo(21.0, 6);
    expect(r.matched).toBe(4);
  });

  // Today: measuredForm "trace" — the peak list is drawn as a connected line,
  // the very "4-point peak table drawn as a line" defect §A-6 removed from the
  // viewer, re-introduced in the overlay figure.
  it("¹³C peak table: the measured series is drawn as sticks, not as a line through the peaks", () => {
    const r = ok(overlaySpectrum(block(c13Table), c13Pred));
    expect(r.measuredForm).toBe("sticks");
  });

  // Committed fixture: ethanol_nmr.jdx block 1 is a 4-line PPM peak table
  // (1.22458, 1.24796, 1.27134, 1.80911). Today only 1.248 is picked; 1.809
  // (25 % of the strongest line) falls under the median "baseline".
  it("ethanol_nmr.jdx peak-table block: the 1.809 ppm line is not discarded", () => {
    const parsed = parseJcamp(fs.readFileSync(path.join(FIX, "ethanol_nmr.jdx"), "latin1"));
    if (!parsed.ok) throw new Error(parsed.error);
    const table = parsed.spectra.find((s) => s.form === "peaks")!;
    expect(table.points.map((p) => p.x)).toContain(1.80911);
    const r = ok(
      overlaySpectrum(table, {
        technique: "1H",
        lines: [
          { x: 3.69, height: 2, label: "CH₂" },
          { x: 2.6, height: 1, label: "OH" },
          { x: 1.22, height: 3, label: "CH₃" },
        ],
      })
    );
    expect(near(r.peaks.map((p) => p.x), 1.80911, 0.005)).toBe(true);
  });

  // IR %T peak table (minima are the bands). Today: peaks [1050] only, 1 of 3 matched.
  it("IR %T peak table: all three listed bands are matched inside their ranges", () => {
    const text = [
      "##TITLE=IR peaks",
      "##JCAMP-DX=4.24",
      "##DATA TYPE=INFRARED PEAK TABLE",
      "##XUNITS=1/CM",
      "##YUNITS=TRANSMITTANCE",
      "##NPOINTS=4",
      "##PEAK TABLE=(XY..XY)",
      "3350,20",
      "2970,40",
      "1050,10",
      "880,60",
      "##END=",
    ].join("\n");
    const r = ok(
      overlaySpectrum(block(text), {
        technique: "ir",
        lines: [
          { x: 3350, height: 1, label: "O–H", range: [3200, 3600] },
          { x: 2970, height: 1, label: "C–H", range: [2850, 3000] },
          { x: 1050, height: 1, label: "C–O", range: [1000, 1100] },
        ],
      })
    );
    expect(r.matched).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. OVERLAY: a UV-Vis file in TRANSMITTANCE is peak-picked on T, not on A
// ---------------------------------------------------------------------------

describe("overlay — UV-Vis in transmittance", () => {
  // One absorption band at 300 nm (A = exp(−((λ−300)/15)²)), written as %T.
  // Today: no conversion is made or stated; the transmittance MAXIMUM at 248 nm
  // is taken as the measured peak and the 300 nm prediction is "unmatched".
  // Oracle: A = −log₁₀(T/100) peaks at exactly 300 nm.
  const xs: number[] = [];
  for (let x = 200; x <= 400; x++) xs.push(x);
  const T = xs.map((x) => 100 * Math.pow(10, -Math.exp(-Math.pow((x - 300) / 15, 2))));
  const text = [
    "##TITLE=UV band 300 nm, %T",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=UV/VIS SPECTRUM",
    "##XUNITS=NANOMETERS",
    "##YUNITS=TRANSMITTANCE",
    `##FIRSTX=200`,
    `##LASTX=400`,
    `##NPOINTS=${xs.length}`,
    "##XYPOINTS=(XY..XY)",
    ...xs.map((x, i) => `${x}, ${T[i].toFixed(4)}`),
    "##END=",
  ].join("\n");

  it("the measured λmax is the absorbance maximum (300 nm), and the 300 nm prediction matches it", () => {
    const r = ok(overlaySpectrum(block(text), { technique: "uvvis", lines: [{ x: 300, height: 1, label: "λmax" }] }));
    expect(r.rows[0].nearest).not.toBeNull();
    expect(Math.abs((r.rows[0].nearest as number) - 300)).toBeLessThanOrEqual(1);
    expect(r.rows[0].within).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. OVERLAY: Hz → ppm with $OFFSET anchors on the first LISTED x, not FIRSTX
// ---------------------------------------------------------------------------

describe("overlay — Hz peak table referenced by $OFFSET/$SF", () => {
  // $OFFSET is δ at FIRSTX (= 20000 Hz here). nmrAxis uses xs[0] — for a peak
  // table that is the first PEAK (12800 Hz), so 12800 Hz is placed at 200 ppm.
  // Oracle: δ = $OFFSET − (FIRSTX − x)/$SF = 200 − (20000 − x)/100 →
  // 12800 → 128, 7700 → 77, 3000 → 30, 2000 → 20.
  const text = [
    "##TITLE=13C peaks in Hz",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=NMR PEAK TABLE",
    "##XUNITS=HZ",
    "##YUNITS=ARBITRARY UNITS",
    "##.OBSERVE FREQUENCY=100",
    "##.OBSERVE NUCLEUS=^13C",
    "##$SF=100",
    "##$OFFSET=200",
    "##FIRSTX=20000",
    "##LASTX=0",
    "##NPOINTS=4",
    "##PEAK TABLE=(XY..XY)",
    "12800,5",
    "7700,1",
    "3000,4",
    "2000,2",
    "##END=",
  ].join("\n");

  it("places the 12800 Hz peak at 128 ppm, not 200", () => {
    const r = ok(
      overlaySpectrum(block(text), {
        technique: "13C",
        lines: [
          { x: 128, height: 1, label: "a" },
          { x: 77, height: 1, label: "b" },
          { x: 30, height: 1, label: "c" },
          { x: 20, height: 1, label: "d" },
        ],
      })
    );
    expect(r.xSpan.first).toBeCloseTo(128, 6);
    expect(r.xSpan.last).toBeCloseTo(20, 6);
  });
});

// ---------------------------------------------------------------------------
// 5. OVERLAY: a caveat that says the file has no $OFFSET when it has one (cosmetic)
// ---------------------------------------------------------------------------

describe("overlay — Hz file with $OFFSET and .OBSERVE FREQUENCY but no $SF", () => {
  // The axis falls back to x ÷ observe frequency (flagged UNREFERENCED, which is
  // honest), but the caveat says "the file gives no $OFFSET or .SHIFT REFERENCE"
  // — false: it gives $OFFSET, which was ignored for want of $SF. Silent
  // mislabel of the file's own content. it.failing: passes today.
  const xs: number[] = [];
  for (let i = 0; i <= 200; i++) xs.push(20000 - i * 100);
  const text = [
    "##TITLE=Hz with OFFSET, no SF",
    "##JCAMP-DX=4.24",
    "##DATA TYPE=NMR SPECTRUM",
    "##XUNITS=HZ",
    "##YUNITS=ARBITRARY UNITS",
    "##.OBSERVE FREQUENCY=100",
    "##.OBSERVE NUCLEUS=^13C",
    "##$OFFSET=200",
    "##FIRSTX=20000",
    "##LASTX=0",
    `##NPOINTS=${xs.length}`,
    "##XYPOINTS=(XY..XY)",
    ...xs.map((x) => `${x}, ${Math.abs(x - 7700) < 1 || Math.abs(x - 3000) < 1 ? 100 : 1}`),
    "##END=",
  ].join("\n");

  it("does not claim the file gives no $OFFSET", () => {
    const r = ok(overlaySpectrum(block(text), { technique: "13C", lines: [{ x: 77, height: 1, label: "a" }] }));
    expect(r.caveats.join(" ")).not.toMatch(/gives no \$OFFSET/);
  });
});

// ---------------------------------------------------------------------------
// 6. UV: an EXTENDED enone arm counts the in-chain γ carbon as a β substituent,
//    and never applies the γ/δ (+18) or homoannular (+39) increments
// ---------------------------------------------------------------------------
//
// Woodward–Fieser enone table: base (acyclic/6-ring ketone 215, aldehyde 210),
// extended conjugation +30, α +10, β +12, γ/δ and higher +18 per residue,
// homoannular diene component +39, exocyclic C=C +5 (held off here by D-1).
// scoreEnoneArm counts every single-bonded carbon on β as "β-alkyl / ring
// residue" — including γ, which is the next atom OF THE CHROMOPHORE — and has no
// γ/δ or homoannular term at all. The ledger shown is arithmetic WF does not do.

describe("UV — extended (dienone/dienal) enone arms vs the Woodward–Fieser table", () => {
  // hexa-2,4-dienal: 210 + 30 + δ-CH₃ 18 = 258. Today 252 (210 + 30 + "β-alkyl" 12).
  it("(2E,4E)-hexa-2,4-dienal → 258 nm", () => {
    expect(predictUvVis("C/C=C/C=C/C=O")!.lambdaMax).toBe(258);
  });

  // 6,6-dimethylcyclohexa-2,4-dienone: 215 + 30 + homoannular 39 + δ ring residue 18 = 302.
  // Today 257 (215 + 30 + "β-alkyl" 12), 45 nm low, under the ±5 nm caveat.
  it("6,6-dimethylcyclohexa-2,4-dien-1-one → 302 nm", () => {
    expect(predictUvVis("CC1(C)C=CC=CC1=O")!.lambdaMax).toBe(302);
  });

  // cholesta-4,6-dien-3-one: 215 + 30 + β ring residue (C10) 12 + δ ring residue (C8) 18
  // = 275 (+5 exocyclic = 280 if D-1 were applied; measured 284). Today 269
  // (215 + 30 + "β-alkyl ×2" 24: C6, the γ atom, counted as a β residue).
  it("cholesta-4,6-dien-3-one → 275 nm (exocyclic +5 held off per D-1)", () => {
    const r = predictUvVis("C[C@]12CC[C@H]3[C@@H](C=CC4=CC(=O)CC[C@@]43C)[C@@H]1CC[C@@H]2[C@H](C)CCCC(C)C")!;
    expect(r.lambdaMax).toBe(275);
  });
});

// ---------------------------------------------------------------------------
// 7. MASS SPEC: deuterium written in a formula is refused (refusal where answerable)
// ---------------------------------------------------------------------------

describe("Mass Spec — D in a typed formula", () => {
  // CDCl₃, D₂O and C₆D₆ — the NMR solvents — are refused: "Unknown element “D”".
  // The same atom written as SMILES [2H] is computed (²H is in the AME2020 table).
  // Oracle (AME2020): CDCl₃ = 12 + 2.014101778 + 3 × 34.968852694 = 118.920664.
  // Fixed in v2.139.0: chemValidate reads D/T as deuterium/tritium.
  it("CDCl3 gives a monoisotopic mass of 118.92066", () => {
    const r = resolveMassSpec("CDCl3");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.result.monoisotopicMass).toBeCloseTo(118.920664, 5);
  });
});
