// Independent adversarial review of v2.140.0 (audio / video / light deepening).
//
// Each test pins ONE confirmed defect. Convention (house rule):
//   - plain `it`      → a WRONG answer or mislabel; it FAILS today and passes once fixed.
//   - `it.failing`    → cosmetic, or a refusal where an answer exists; it PASSES today
//                       (the assertion fails) and must be flipped to `it` when fixed.
// Oracles are named beside each case.

import { solveWithUnits } from "../unitSolve";
import { convert, parseMeasured } from "../units";
import { codeValue, transfer } from "../video";
import { parseLevelList, levelConvert } from "../audio";
import { cctMcCamy, daylightXy, MCCAMY_ERROR_K } from "../colourspace";

describe("v2.140.0 adversarial review — wrong answers and mislabels (plain it: FAIL today)", () => {
  // NEW UNIT KEYS CAPTURE FREQUENCY SYMBOLS. "fc" (cutoff) and "fL" (lower band
  // edge) are the audio engineer's symbols, and fL is used that way in audio.ts
  // itself. Both are now UNITS keys (footcandle, femtolitre), so a known line
  // "f1 = 3 fc" passes ASSIGN_RE + parseCompoundUnit and the pane's Solve
  // (taskpane: multiline text → solveWithUnits FIRST) answers "f2 = 64.58 lx".
  // Before v2.140.0 parseCompoundUnit("fc") was null, solveWithUnits returned
  // null, and the system path read 3·fc. The units.ts comment ("safe because
  // Solve reads units only AFTER a number") is exactly the case that breaks:
  // "3 fc" IS after a number. Oracle: [X] 2 × (3·fc) = 6·fc, not 64.58 lx.
  it("Solve does not read '3 fc' (a cutoff-frequency symbol) as 3 footcandles without saying so", () => {
    const r = solveWithUnits("f2 = k*f1\nk = 2\nf1 = 3 fc");
    const captured = r !== null && r.refusal === undefined && r.namedUnit === "lx";
    const disclosed = r !== null && [...r.caveats, ...r.steps.map((s) => s.text ?? "")].some((t) => /foot-?candle/i.test(t));
    expect(!captured || disclosed).toBe(true);
  });

  it("Solve does not read '2 fL' (a lower band-edge symbol) as 2 femtolitres without saying so", () => {
    const r = solveWithUnits("fH = 8*fL\nfL = 2 fL");
    const captured = r !== null && r.refusal === undefined && r.unit === "m³";
    const disclosed = r !== null && [...r.caveats, ...r.steps.map((s) => s.text ?? "")].some((t) => /femto/i.test(t));
    expect(!captured || disclosed).toBe(true);
  });

  // Units-aware Solve now NAMES cd/m² as "nit" (NAMED gained nit, as brief A1-6
  // asked). The textbook inverse-square law E = I/d² with I in candela produces
  // the same signature, so Solve prints "E = 250 nit (= 250 cd/m²)" — a
  // LUMINANCE — for what is an ILLUMINANCE of 250 lx (photometry.ts
  // pointIlluminance gives 250 lx for exactly 1000 cd at 2 m). Before v2.140.0
  // the bare "cd/m²" was shown, unnamed.
  it("units-aware Solve does not name the inverse-square illuminance I/d² a luminance ('nit')", () => {
    const r = solveWithUnits("E = I/d^2\nI = 1000 cd\nd = 2 m");
    expect(r).not.toBeNull();
    expect(r!.value).toBeCloseTo(250, 9);
    expect(r!.namedUnit).not.toBe("nit");
  });

  // The McCamy result is labelled "±2 K over 2856–6504 K" (MCCAMY_ERROR_K = 2,
  // which also sets the refusal window). On the TRUE Planckian locus McCamy is
  // +7.94 K off at 3200 K and +8.84 K off at 4000 K. Oracle [L], independent of
  // the McCamy cubic: colour-science 0.4.7 sd_blackbody(4000 K) integrated with
  // the CIE 1931 2° CMFs (1 nm and 5 nm agree to 4e-7 in xy) gives
  // xy = (0.38044236, 0.37674859); McCamy on that is 4008.84 K.
  it("the stated McCamy accuracy (±MCCAMY_ERROR_K) holds for a 4000 K blackbody", () => {
    const r = cctMcCamy(0.3804423640303758, 0.3767485876116532);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cctK).toBeCloseTo(4008.84, 1); // the formula itself is transcribed right
    expect(Math.abs(r.cctK - 4000)).toBeLessThanOrEqual(MCCAMY_ERROR_K);
  });

  // BT.2100 Table 9 full-range chroma, D = Round((2ⁿ−1)E′ + 2ⁿ⁻¹): at E′ = +0.5
  // that is 1023.5 → 1024 at 10 bits and 255.5 → 256 at 8 bits — codes that do
  // not exist in an n-bit word (0 … 2ⁿ−1). The tool returns them, and reports
  // the nominal range as "1 to 1024". Oracle: [X] an n-bit code is ≤ 2ⁿ − 1.
  it("full-range chroma code values stay inside the n-bit word (10-bit ≤ 1023, 8-bit ≤ 255)", () => {
    const c10 = codeValue(0.5, 10, "full", "chroma");
    const c8 = codeValue(0.5, 8, "full", "chroma");
    expect(c10.ok && c8.ok).toBe(true);
    if (!c10.ok || !c8.ok) return;
    expect(c10.code).toBeLessThanOrEqual(1023);
    expect(c10.nominalMax).toBeLessThanOrEqual(1023);
    expect(c8.code).toBeLessThanOrEqual(255);
  });

  // parseLevelList strips every reference/weighting suffix (dBu, dBV, dBFS,
  // dB SPL, dB(A), dB(C)) and returns bare numbers with NO note, so a list that
  // mixes references sums silently in no reference at all. "0 dBu, 0 dBV" →
  // [0, 0] → levelSum 3.0103 dB; in dBu the true incoherent sum is
  // 10·log₁₀(1 + 10^(2.2185/10)) = 4.3934 dBu ([X], dBV = dBu − 2.2185). The
  // weighted case is worse: A and C levels are different measurements.
  it("a level list that mixes references (dBu with dBV) is refused or flagged, not summed silently", () => {
    const r = parseLevelList("0 dBu, 0 dBV");
    const flagged = !r.ok || /mix|reference|dBu|dBV/i.test(r.note);
    expect(flagged).toBe(true);
  });

  it("a level list that mixes weightings (dB(A) with dB(C)) is refused or flagged, not summed silently", () => {
    const r = parseLevelList("80 dB(A), 80 dB(C)");
    const flagged = !r.ok || /mix|weight|dB\(A\)|dB\(C\)/i.test(r.note);
    expect(flagged).toBe(true);
  });

  // PRE-EXISTING (unitSolve.ts SUP map has digits 0–5 only), reachable from the
  // display contract this round re-asserts: m³ × m³ prints "m6", which is not a
  // unit and does not parse back. Oracle: [X] the displayed unit must re-parse.
  it("units-aware Solve prints m⁶ (not 'm6') and the printed unit parses back", () => {
    const r = solveWithUnits("y = a*b\na = 2 m^3\nb = 3 m^3");
    expect(r).not.toBeNull();
    expect(r!.value).toBe(6);
    expect(convert(1, r!.unit, "m^6")).toBe(1);
  });
});

describe("v2.140.0 adversarial review — refusals where answerable and cosmetics (it.failing: PASS today)", () => {
  // Brief §B3: CCT from xy is "labelled 'McCamy approximation, ±2 K over
  // 2856–6504 K, worse outside'". The build REFUSES everything outside
  // 2854–6506 K instead — including a 2700 K warm-white LED and the product's
  // OWN D75 point from daylightXy(7504). colour-science xy_to_CCT(method=
  // "McCamy 1992") answers 2705.56 K for the Kang-2002 2700 K point and
  // 7493.14 K for the 7504 K one. REFUSAL WHERE ANSWERABLE.
  it("McCamy CCT answers (labelled) for a 2700 K lamp instead of refusing", () => {
    const r = cctMcCamy(0.4593139523446629, 0.41066024937841794);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cctK).toBeCloseTo(2705.56, 1);
  });

  it("McCamy CCT answers (labelled) for the product's own D75 daylight point", () => {
    const d = daylightXy(7504);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = cctMcCamy(d.xy.x, d.xy.y);
    expect(r.ok).toBe(true);
  });

  // levelConvert ACCEPTS +2 dBFS under the AES17 sine convention (anything up to
  // +3.01 dBFS — a full-scale square wave — is legal input there), then the
  // notes say "+2.00 dBFS is ABOVE full scale: this level clips the converter".
  // A reading the tool itself accepted as a non-clipping signal is declared to
  // clip. COSMETIC (the number, +20 dBu under R68, is right).
  it("an accepted +2 dBFS (sine-referenced) input is not told it clips the converter", () => {
    const r = levelConvert(2, "dBFS", "dBu", { alignment: "ebu-r68" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes.some((n) => /clips/i.test(n))).toBe(false);
  });

  // The new decibel refusal matches /^(dB|Np\b|neper)/i, so the DECIBAR (dbar,
  // 10 kPa — the oceanographer's pressure unit) is told it is "a logarithmic
  // level, not a unit". It was unrecognised before; now the message is false.
  // COSMETIC. FIXED by SUPPORTING the decibar (1 dbar = 10 kPa), which the
  // coordinator allowed ("support it or refuse by name"); the pin accepts
  // either outcome but never the decibel message.
  it("'2 dbar' is not described as a logarithmic level", () => {
    const r = parseMeasured("2 dbar", "Pa");
    if ("error" in r) expect(r.error).not.toMatch(/logarithmic/);
    else expect(r.inTarget).toBe(20000);
  });

  // Case friction was fixed for FPS / KHz / NIT, but the new footcandle is a
  // canonical key with no case alias: "50 FC" — how IES lighting schedules
  // write it — is "not a unit this recognises". No collision exists for "FC"
  // (no farad·coulomb or femtocoulomb key). REFUSAL WHERE ANSWERABLE.
  it("'50 FC' (footcandles as lighting schedules write it) is read as 538.2 lx", () => {
    const r = parseMeasured("50 FC", "lx");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.inTarget).toBeCloseTo(538.1955208354861, 9);
  });

  // Display contract: the transfer tool's displayed formula prints ASCII carets
  // ("1.099·L^0.45 − 0.099", "max(V + b, 0)^2.4"). COSMETIC.
  it("the BT.709 formula line is typeset without ASCII '^'", () => {
    const r = transfer("bt709", "toSignal", 0.18);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.formula).not.toMatch(/\^/);
  });
});
