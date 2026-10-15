// Measured vs predicted — one JCAMP block against one prediction.
//
// docs/SCOPE-SPECTROSCOPY-BATCH.md §B2. The whole value of a predictor is the
// comparison with an acquired spectrum, and every step of that comparison has a
// way of producing a confident wrong answer:
//
//   * AXES. An NMR file in Hz has no δ until it is divided by the observe
//     frequency AND referenced. BRUKPAC.DX's own $OFFSET puts every ¹³C peak
//     +9.09 ppm high (its CDCl₃ triplet sits at 86.25, not 77.16). Nothing here
//     shifts an axis on its own: the offset is DETECTED and said, and only a
//     reference peak the user gives moves the measured axis.
//   * Y CONVENTIONS. %T peaks point down; T may be 0–1 or 0–100. Peaks are
//     picked on A = −log₁₀T, and the DISPLAY keeps the file's own convention —
//     measured data is never transformed for display; the prediction is.
//   * MATCHING. "Nearest peak" is proximity, not identity. The table says so on
//     every output, and a band whose nearest measured peak lies outside its own
//     range is reported as unmatched with the Δ shown — gas-phase ethanol's O–H
//     at 3674 cm⁻¹ is NOT a match for a predicted 3350 [3200–3600] band.
//   * IDENTITY AND PHASE. The file's MOLFORM is compared with the predicted
//     structure, and ##STATE=gas against a condensed-phase IR prediction is said.
//     Neither stops the overlay: the comparison may be deliberate.
//
// Every cap is set before the work: ≤ 200 picked peaks, ≤ 200 predicted lines,
// matching O(p·q). Pure: no Office.js, no DOM.

import { Molecule } from "openchemlib";
import type { JcampSpectrum } from "./jcamp";
import type { NmrResult } from "./nmr";
import type { IrBand, IrResult } from "./ir";
import type { UvResult } from "./uvvis";
import type { FragmentResult } from "./fragment";
import { irTransmittanceCurve } from "./ir";

export type OverlayTechnique = "1H" | "13C" | "ir" | "uvvis" | "ms";

/** One predicted line: a shift, a band centre, a λmax or an m/z. */
export interface PredictedLine {
  x: number;
  /** Relative height (any scale); the strongest line is matched first. */
  height: number;
  /** What the line is, e.g. "CH₃ (on C=O)" or "C=O stretch (ketone)". */
  label: string;
  /** IR only: the band's published range, used as its matching window. */
  range?: [number, number];
}

/** The narrow input this module needs from a prediction (adapters below). */
export interface PredictedSpectrum {
  technique: OverlayTechnique;
  lines: PredictedLine[];
  /** IR: the bands, to draw a predicted curve in the file's y convention. */
  irBands?: IrBand[];
  /** Molecular formula of the predicted structure, for the MOLFORM check. */
  formula?: string;
  /** MS: fragment heights are a likelihood RANKING; isotope heights are intensities. */
  msHeights?: "ranking" | "intensity";
}

export interface OverlayOptions {
  /**
   * A reference peak the user supplies: the peak measured at `measured` is
   * truly at `trueValue`. It shifts the MEASURED axis by trueValue − measured,
   * in display units. Nothing is ever shifted automatically.
   */
  reference?: { measured: number; trueValue: number };
}

export interface MeasuredPeak {
  /** Position in display units (ppm, cm⁻¹, nm, m/z), after any user reference. */
  x: number;
  /** Height normalised to the strongest picked peak's scale (0–1). */
  height: number;
  /** ¹H only: how many lines were grouped into this multiplet. */
  lines?: number;
}

export interface MatchRow {
  predicted: number;
  label: string;
  /** The nearest unused measured peak, matched or not; null when none is left. */
  nearest: number | null;
  /** predicted − measured, in display units; null when there is no nearest. */
  delta: number | null;
  within: boolean;
  window: [number, number];
}

export interface OverlayOk {
  ok: true;
  technique: OverlayTechnique;
  /** The figure's x axis. */
  axis: { label: string; unit: string; reversed: boolean };
  /**
   * The measured series in display x; y in the file's convention (IR),
   * normalised (NMR/UV) or % of base (MS). A trace longer than MEASURED_BUDGET
   * is its min/max envelope (every extremum kept); a peak table is whole.
   */
  measured: { x: number; y: number }[];
  /** The display x of the file's first and last points, and how many there were. */
  xSpan: { first: number; last: number; points: number };
  measuredForm: "trace" | "sticks";
  /** What the measured y axis shows. */
  yLabel: string;
  /** IR: the predicted curve in the file's own y convention. */
  predictedCurve?: { x: number; y: number }[];
  /** NMR and MS: predicted sticks; MS sticks point DOWN (head-to-tail). */
  predictedSticks?: { x: number; height: number }[];
  /** UV: the predicted λmax. */
  predictedMarker?: number;
  peaks: MeasuredPeak[];
  rows: MatchRow[];
  matched: number;
  /**
   * False when the referencing check fired: no row is scored as within its
   * window (the nearest peaks are still shown), and `matched` is 0.
   */
  assessed: boolean;
  /** The strongest measured peaks no predicted line claimed (at most 10). */
  unmatchedMeasured: MeasuredPeak[];
  /** Every unit conversion made, in words. */
  conversions: string[];
  caveats: string[];
  /** The file's title and technique, for the figure. */
  fileTitle: string;
  /** The referencing check, when it fired. */
  offset?: { shift: number; peaks: number };
  /** The file's raw unit strings, for provenance. */
  fileUnits: { x: string; y: string };
}

export type OverlayResult = OverlayOk | { ok: false; error: string };

/** The sentence every match output carries. */
export const NOT_AN_ASSIGNMENT = "A prediction is not an assignment: a nearest peak is proximity, not identity.";

export const OVERLAY_MAX_PEAKS = 200;
export const OVERLAY_MAX_LINES = 200;

// --- display helpers -------------------------------------------------------------

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** C2H6O → C₂H₆O. */
export function typesetFormula(f: string): string {
  return f.replace(/\d/g, (d) => SUB[Number(d)]);
}

/**
 * A predictor's label for display: digits after an element symbol or a closing
 * parenthesis are subscripts ("CH2 (on OH)" → "CH₂ (on OH)", "−•CH3" → "−•CH₃"),
 * and nothing else is touched ("(variable, 1-5)" keeps its digits).
 */
export function typesetLabel(s: string): string {
  return s.replace(/([A-Z][a-z]?|\))(\d+)/g, (_m, a: string, d: string) => a + typesetFormula(d));
}

/** A number with a true minus and a fixed number of decimals. */
export function fmtSigned(v: number, dp: number, plus = false): string {
  const s = Math.abs(v).toFixed(dp);
  if (Number(s) === 0) return (0).toFixed(dp);
  return v < 0 ? `−${s}` : plus ? `+${s}` : s;
}

/** File unit strings, normalised for display: "1/CM" → cm⁻¹, "HZ" → Hz, "M/Z" → m/z. */
export function displayUnits(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (!u) return "";
  if (u === "1/CM" || u === "CM-1" || u === "CM^-1" || u === "CM**-1") return "cm⁻¹";
  if (u === "HZ" || u === "HERTZ") return "Hz";
  if (u === "PPM") return "ppm";
  if (u === "M/Z") return "m/z";
  if (u === "NANOMETERS" || u === "NM" || /WAVELENGTH\s*\(NM\)/.test(u)) return "nm";
  if (u === "MICROMETERS" || u === "UM" || u === "MICRONS") return "µm";
  if (u === "TRANSMITTANCE") return "transmittance";
  if (u === "ABSORBANCE") return "absorbance";
  if (u === "ARBITRARY UNITS") return "arbitrary units";
  if (u === "MILLISECONDS" || u === "MS") return "ms";
  if (u === "SECONDS") return "s";
  if (u === "PICOAMPERES") return "pA";
  if (u === "NANOAMPERES") return "nA";
  if (u === "RELATIVE ABUNDANCE" || u === "RELATIVE INTENSITY") return u.toLowerCase();
  if (u === "COUNTS") return "counts";
  // Any other all-capitals word string is a shouted file convention, not a
  // symbol: shown in lower case (the raw string stays in provenance).
  if (/^[A-Z ]{4,}$/.test(raw.trim())) return raw.trim().toLowerCase();
  return raw.trim();
}

const NUCLEUS_DISPLAY: Record<string, string> = { "1H": "¹H", "13C": "¹³C", "19F": "¹⁹F", "31P": "³¹P", "15N": "¹⁵N", "29Si": "²⁹Si", "11B": "¹¹B" };
const nucDisplay = (n: string): string => NUCLEUS_DISPLAY[n] ?? n;

const TECHNIQUE_NAME: Record<OverlayTechnique, string> = {
  "1H": "¹H NMR",
  "13C": "¹³C NMR",
  ir: "IR",
  uvvis: "UV-Vis",
  ms: "mass spectrum",
};

const KIND_NAME: Record<string, string> = {
  ir: "an IR spectrum",
  nmr: "an NMR spectrum",
  uvvis: "a UV-Vis spectrum",
  ms: "a mass spectrum",
  raman: "a Raman spectrum",
};

// --- adapters from the predictors ----------------------------------------------------

/** Molecular formula (Hill) from a SMILES, or undefined. */
function formulaOfSmiles(smiles: string): string | undefined {
  try {
    const m = Molecule.fromSmiles(smiles);
    const f = m.getMolecularFormula().formula.replace(/\./g, "");
    return f || undefined;
  } catch {
    return undefined;
  }
}

export function predictedFromNmr(r: NmrResult): PredictedSpectrum {
  const maxCount = Math.max(1, ...r.signals.map((s) => s.count));
  return {
    technique: r.nucleus,
    lines: r.signals.slice(0, OVERLAY_MAX_LINES).map((s) => ({
      x: s.shift,
      // ¹³C is proton-decoupled: every carbon environment is one line, but a
      // 2-carbon environment is still stronger; integration matters for ¹H.
      height: s.count / maxCount,
      label: typesetLabel(s.assignment),
    })),
    formula: formulaOfSmiles(r.smiles),
  };
}

const INTENSITY_HEIGHT: Record<string, number> = { strong: 1, medium: 0.6, weak: 0.3 };

export function predictedFromIr(r: IrResult): PredictedSpectrum {
  return {
    technique: "ir",
    lines: r.bands.slice(0, OVERLAY_MAX_LINES).map((b) => ({
      x: b.wavenumber,
      height: INTENSITY_HEIGHT[b.intensity] ?? 0.5,
      label: typesetLabel(b.assignment),
      range: [Math.min(b.range[0], b.range[1]), Math.max(b.range[0], b.range[1])] as [number, number],
    })),
    irBands: r.bands,
    formula: formulaOfSmiles(r.smiles),
  };
}

/** UV: one line at λmax. A prediction with no λmax has nothing to overlay. */
export function predictedFromUv(r: UvResult): PredictedSpectrum | { error: string } {
  if (r.lambdaMax === null || !Number.isFinite(r.lambdaMax)) {
    return {
      error: r.outOfDomain
        ? "The UV prediction gives no λmax for this chromophore (outside the Woodward–Fieser domain), so there is nothing to overlay."
        : "The UV prediction gives no λmax (no chromophore above ~200 nm), so there is nothing to overlay.",
    };
  }
  return {
    technique: "uvvis",
    lines: [{ x: r.lambdaMax, height: 1, label: typesetLabel(`λmax — ${r.chromophore}`) }],
    formula: formulaOfSmiles(r.smiles),
  };
}

const LIKELIHOOD_HEIGHT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };

export function predictedFromFragments(r: FragmentResult): PredictedSpectrum {
  const lines: PredictedLine[] = [{ x: r.molecularIon, height: 1, label: `M⁺• ${typesetFormula(r.formula)}` }];
  for (const f of r.fragments.slice(0, OVERLAY_MAX_LINES - 1)) {
    lines.push({ x: f.mz, height: LIKELIHOOD_HEIGHT[f.likelihood] ?? 0.5, label: typesetLabel(`${f.formula} (${f.neutralLoss ? `−${f.neutralLoss}` : f.pathway})`) });
  }
  return { technique: "ms", lines, formula: r.formula, msHeights: "ranking" };
}

/**
 * An isotope pattern as the MS prediction. Only `mass` and `intensity` are read,
 * so the peak's own offset/label convention (M−n vs M+n) is the caller's.
 */
export function predictedFromIsotopePattern(
  peaks: { mass: number; intensity: number; label?: string }[],
  formula: string
): PredictedSpectrum {
  return {
    technique: "ms",
    lines: peaks.slice(0, OVERLAY_MAX_LINES).map((p) => ({ x: p.mass, height: p.intensity, label: p.label ? typesetLabel(p.label) : `isotopologue ${p.mass.toFixed(4)}` })),
    formula,
    msHeights: "intensity",
  };
}

// --- formula comparison -----------------------------------------------------------------

/** "C 2 H 6 O", "C3 H6 O", "C2Cl4" → element counts; null if it is not a plain formula. */
export function parseMolform(raw: string): Record<string, number> | null {
  const s = raw.replace(/\s+/g, "");
  if (!s || !/^([A-Z][a-z]?\d*)+$/.test(s)) return null;
  const out: Record<string, number> = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!m[1]) break;
    out[m[1]] = (out[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  }
  return out;
}

function hill(c: Record<string, number>): string {
  const keys = Object.keys(c);
  const order = c.C ? ["C", "H", ...keys.filter((k) => k !== "C" && k !== "H").sort()] : keys.sort();
  return order.filter((k) => c[k]).map((k) => `${k}${c[k] > 1 ? c[k] : ""}`).join("");
}

function sameFormula(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

// --- axis normalisation -------------------------------------------------------------------

const numMeta = (s: JcampSpectrum, k: string): number => {
  const v = s.meta[k];
  if (v === undefined || v.trim() === "") return NaN;
  const n = Number(v.trim().split(/[\s,]+/)[0]);
  return Number.isFinite(n) ? n : NaN;
};

type AxisOut = { xs: number[]; conversions: string[]; caveats: string[] } | { error: string };

function nmrAxis(s: JcampSpectrum): AxisOut {
  const u = s.xUnits.trim().toUpperCase();
  const xs = s.points.map((p) => p.x);
  if (u === "PPM") return { xs, conversions: [], caveats: [] };
  if (u !== "HZ" && u !== "HERTZ") {
    return { error: `The file's x axis is in "${s.xUnits}", which cannot be put on a δ (ppm) axis.` };
  }
  const obs = numMeta(s, ".OBSERVEFREQUENCY");
  const sf = numMeta(s, "$SF");
  const offset = numMeta(s, "$OFFSET");
  if (!(obs > 0) && !(sf > 0)) {
    return { error: "x is in Hz and the file gives no observe frequency (.OBSERVE FREQUENCY), so it cannot be put on a δ (ppm) axis. Export the spectrum in ppm, or with its observe frequency." };
  }
  const caveats: string[] = [];
  const conversions: string[] = [];
  // $OFFSET is δ at FIRSTX — the header's first abscissa, NOT the first listed x.
  // For a trace they coincide; for a PEAK TABLE the first listed x is the first
  // peak, and anchoring there put a 12 800 Hz peak at 200 ppm instead of 128.
  const headerFirst = numMeta(s, "FIRSTX");
  const x0 = Number.isFinite(headerFirst) ? headerFirst : xs[0];
  const isTable = s.form === "peaks";
  // .SHIFT REFERENCE = type, solvent (may be empty), 1-based point index, δ.
  // The index counts TRACE points, so it means nothing for a peak table.
  const shiftRef = (() => {
    const raw = s.meta[".SHIFTREFERENCE"];
    if (!raw || isTable) return null;
    const parts = raw.split(",").map((t) => t.trim());
    if (parts.length < 4) return null;
    const idx = Number(parts[2]);
    const d = Number(parts[3]);
    if (!Number.isInteger(idx) || idx < 1 || idx > xs.length || !Number.isFinite(d)) return null;
    return { idx, d, solvent: parts[1] };
  })();

  let mapped: number[];
  if (Number.isFinite(offset) && sf > 0) {
    mapped = xs.map((x) => offset - (x0 - x) / sf);
    conversions.push(
      `Hz → ppm with the file's own referencing: δ = $OFFSET − (FIRSTX − x) ÷ $SF, $OFFSET = ${offset} ppm at FIRSTX = ${x0} Hz, $SF = ${sf} MHz.`
    );
    if (shiftRef) {
      const viaRef = shiftRef.d + (x0 - xs[shiftRef.idx - 1]) / sf;
      if (Math.abs(viaRef - offset) > 0.01) {
        caveats.push(
          `The file's two referencings disagree: $OFFSET puts the first point at ${fmtSigned(offset, 3)} ppm, .SHIFT REFERENCE at ${fmtSigned(viaRef, 3)} ppm. $OFFSET was used; check the referencing.`
        );
      }
    }
  } else if (shiftRef) {
    const f = obs > 0 ? obs : sf;
    const xr = xs[shiftRef.idx - 1];
    mapped = xs.map((x) => shiftRef.d + (x - xr) / f);
    conversions.push(
      `Hz → ppm with the file's .SHIFT REFERENCE: point ${shiftRef.idx} is δ ${fmtSigned(shiftRef.d, 4)} ppm${shiftRef.solvent ? ` (${shiftRef.solvent})` : ""}; observe frequency ${f} MHz.`
    );
  } else {
    const f = obs > 0 ? obs : sf;
    mapped = xs.map((x) => x / f);
    conversions.push(`Hz → ppm as δ = x ÷ ${f} MHz (observe frequency).`);
    // Say what is actually missing: a file with $OFFSET but no $SF HAS an offset.
    const missing = Number.isFinite(offset)
      ? "the file gives $OFFSET but no $SF, so the offset cannot be applied"
      : s.meta[".SHIFTREFERENCE"] && isTable
        ? "the file's .SHIFT REFERENCE names a trace point, which a peak table does not have"
        : "the file gives no $OFFSET or .SHIFT REFERENCE";
    caveats.push(
      `UNREFERENCED: ${missing}, so 0 Hz was taken as δ 0 (TMS). The δ axis may be offset; give a reference peak to correct it.`
    );
  }
  return { xs: mapped, conversions, caveats };
}

function irAxis(s: JcampSpectrum): AxisOut {
  const u = s.xUnits.trim().toUpperCase();
  const xs = s.points.map((p) => p.x);
  if (u === "1/CM" || u === "CM-1" || u === "CM^-1" || u === "CM**-1") return { xs, conversions: [], caveats: [] };
  if (u === "MICROMETERS" || u === "MICRONS" || u === "UM") {
    if (xs.some((x) => !(x > 0))) return { error: "The file's x axis is in µm and holds a non-positive value, which has no wavenumber." };
    return { xs: xs.map((x) => 1e4 / x), conversions: ["µm → cm⁻¹ as 10⁴ ÷ x."], caveats: [] };
  }
  if (u === "NANOMETERS" || u === "NM") {
    if (xs.some((x) => !(x > 0))) return { error: "The file's x axis is in nm and holds a non-positive value, which has no wavenumber." };
    return { xs: xs.map((x) => 1e7 / x), conversions: ["nm → cm⁻¹ as 10⁷ ÷ x."], caveats: [] };
  }
  return { error: `The file's x axis is in "${s.xUnits}", which cannot be put on a wavenumber (cm⁻¹) axis.` };
}

function uvAxis(s: JcampSpectrum): AxisOut {
  const u = s.xUnits.trim().toUpperCase();
  const xs = s.points.map((p) => p.x);
  if (u === "NANOMETERS" || u === "NM" || /\(NM\)/.test(u) || /\bNM\b/.test(u)) return { xs, conversions: [], caveats: [] };
  if (u === "1/CM" || u === "CM-1") {
    if (xs.some((x) => !(x > 0))) return { error: "The file's x axis is in cm⁻¹ and holds a non-positive value, which has no wavelength." };
    return { xs: xs.map((x) => 1e7 / x), conversions: ["cm⁻¹ → nm as 10⁷ ÷ x."], caveats: [] };
  }
  if (u === "MICROMETERS" || u === "UM") return { xs: xs.map((x) => x * 1000), conversions: ["µm → nm as 1000 × x."], caveats: [] };
  return { error: `The file's x axis is in "${s.xUnits}", which cannot be put on a wavelength (nm) axis.` };
}

function msAxis(s: JcampSpectrum): AxisOut {
  const u = s.xUnits.trim().toUpperCase();
  if (u === "M/Z" || u === "" || u === "MASS") return { xs: s.points.map((p) => p.x), conversions: [], caveats: [] };
  return { error: `The file's x axis is in "${s.xUnits}", which is not m/z.` };
}

// --- peak picking -----------------------------------------------------------------------------

interface Picked {
  x: number;
  h: number;
  lines?: number;
}

/**
 * Deterministic peak picking: local maxima whose height is at least `rel` of the
 * signal's range, kept strongest-first with a minimum separation, capped.
 */
function pickPeaks(xs: number[], ys: number[], rel: number, sep: number): { peaks: Picked[]; capped: boolean } {
  const n = xs.length;
  let mx = -Infinity;
  let count = 0;
  for (const y of ys) if (Number.isFinite(y)) count++;
  const finite = new Float64Array(count);
  count = 0;
  for (const y of ys) {
    if (!Number.isFinite(y)) continue;
    finite[count++] = y;
    if (y > mx) mx = y;
  }
  // The range runs from the BASELINE (the median ordinate), not from the deepest
  // point: an NMR trace's negative phase dip would otherwise make 5 % of the
  // range a level the noise already reaches (BRUKPAC.DX: 200 noise "peaks").
  // A typed-array sort: a comparator sort of 2^20 numbers costs seconds.
  finite.sort();
  const mn = finite.length ? finite[Math.floor(finite.length / 2)] : NaN;
  if (!(mx > mn)) return { peaks: [], capped: false };
  const thr = mn + rel * (mx - mn);
  const cand: Picked[] = [];
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (!Number.isFinite(y) || y < thr) continue;
    const l = i > 0 ? ys[i - 1] : -Infinity;
    const r = i < n - 1 ? ys[i + 1] : -Infinity;
    // A plateau counts once: >= on the left, > on the right.
    if (y >= l && y > r && (i > 0 || i < n - 1)) cand.push({ x: xs[i], h: (y - mn) / (mx - mn) });
  }
  cand.sort((a, b) => b.h - a.h || a.x - b.x);
  const kept: Picked[] = [];
  let capped = false;
  for (const c of cand) {
    if (kept.some((k) => Math.abs(k.x - c.x) < sep)) continue;
    if (kept.length >= OVERLAY_MAX_PEAKS) {
      capped = true;
      break;
    }
    kept.push(c);
  }
  return { peaks: kept, capped };
}

/**
 * ¹H: lines of one multiplet are grouped into a centre (height-weighted mean),
 * so the match compares a predicted shift with a multiplet, not with whichever
 * line of a doublet happens to be nearer. Lines closer than `gap` join.
 */
function groupMultiplets(peaks: Picked[], gap: number): Picked[] {
  const s = peaks.slice().sort((a, b) => a.x - b.x);
  const out: Picked[] = [];
  let cur: Picked[] = [];
  const flush = () => {
    if (!cur.length) return;
    const w = cur.reduce((t, p) => t + p.h, 0);
    out.push({ x: cur.reduce((t, p) => t + p.x * p.h, 0) / w, h: Math.max(...cur.map((p) => p.h)), lines: cur.length });
    cur = [];
  };
  for (const p of s) {
    if (cur.length && p.x - cur[cur.length - 1].x > gap) flush();
    cur.push(p);
  }
  flush();
  return out.sort((a, b) => b.h - a.h || a.x - b.x);
}

// --- the overlay -------------------------------------------------------------------------------

const NMR_WINDOW: Record<string, number> = { "1H": 0.5, "13C": 8 };

/**
 * Overlays one measured block on one prediction. Refuses by name when the two
 * cannot be compared; otherwise returns the aligned series, the picked peaks,
 * the match table and every conversion and caveat in words.
 */
export function overlaySpectrum(file: JcampSpectrum, pred: PredictedSpectrum, opts: OverlayOptions = {}): OverlayResult {
  const tech = pred.technique;
  const tName = TECHNIQUE_NAME[tech];

  // --- compatibility, refused by name -----------------------------------------------
  if (file.corrupt) {
    return { ok: false, error: `This block failed the file's own checks (${file.corruptReason ?? "decode check"}), so it is not overlaid.` };
  }
  if (file.points.length < 2) return { ok: false, error: "The measured block holds fewer than two points; there is nothing to overlay." };
  const wantKind = tech === "1H" || tech === "13C" ? "nmr" : tech;
  if (file.kind === "raman") return { ok: false, error: "This file is a Raman spectrum; no prediction exists for Raman." };
  if (file.kind === "unknown") {
    return { ok: false, error: `This file is ${file.dataType ? `"${file.dataType}"` : "of an unrecognised kind"}; no prediction exists for it to be compared with.` };
  }
  if (file.kind !== wantKind) {
    return { ok: false, error: `This file is ${KIND_NAME[file.kind] ?? file.kind}; the prediction is ${tName}.` };
  }
  if (/\b2D\b|COSY|HSQC|HMBC|TOCSY|NOESY/i.test(`${file.dataType} ${file.meta["DATACLASS"] ?? ""}`)) {
    return { ok: false, error: "This is a 2D NMR file; only 1D spectra are overlaid." };
  }
  if (wantKind === "nmr" && file.nucleus && file.nucleus !== tech) {
    return { ok: false, error: `This file is a ${nucDisplay(file.nucleus)} spectrum; the prediction is ${tName}.` };
  }
  if (!pred.lines.length) return { ok: false, error: "The prediction has no lines to compare." };
  const lines = pred.lines.slice(0, OVERLAY_MAX_LINES).filter((l) => Number.isFinite(l.x) && Number.isFinite(l.height));

  // --- axis --------------------------------------------------------------------------------
  const ax = wantKind === "nmr" ? nmrAxis(file) : tech === "ir" ? irAxis(file) : tech === "uvvis" ? uvAxis(file) : msAxis(file);
  if ("error" in ax) return { ok: false, error: ax.error };
  const conversions = ax.conversions.slice();
  const caveats = ax.caveats.slice();
  let xs = ax.xs;
  if (opts.reference) {
    const { measured, trueValue } = opts.reference;
    if (!Number.isFinite(measured) || !Number.isFinite(trueValue)) {
      return { ok: false, error: "The reference peak needs two numbers: where it was measured and where it truly is." };
    }
    const u = wantKind === "nmr" ? "ppm" : tech === "ir" ? "cm⁻¹" : tech === "uvvis" ? "nm" : "(m/z)";
    // The measured value must be ON this spectrum: a typo (100 for 10.0) or a
    // value from another file would otherwise move the whole axis and produce a
    // confident table on nonsense.
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of xs) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (measured < lo || measured > hi) {
      return {
        ok: false,
        error: `Reference peak: ${fmtSigned(measured, 2)} ${u} is outside this spectrum (${fmtSigned(lo, 2)} to ${fmtSigned(hi, 2)} ${u}), so it was not applied.`,
      };
    }
    const shift = trueValue - measured;
    xs = xs.map((x) => x + shift);
    conversions.push(`Measured axis shifted by ${fmtSigned(shift, 2, true)} ${u}: the user's reference peak measured at ${fmtSigned(measured, 2)} is taken as ${fmtSigned(trueValue, 2)}.`);
  }
  if (wantKind === "nmr" && !file.nucleus) {
    caveats.push(`The file does not name its nucleus (.OBSERVE NUCLEUS); it is compared as ${nucDisplay(tech)} because that is what was predicted.`);
  }

  // --- y convention ---------------------------------------------------------------------
  const ys = file.points.map((p) => p.y);
  let pickY: number[] = ys;
  let displayY: number[] = ys;
  let yLabel = "";
  let dropped = 0;
  let irMode: "pctT" | "fracT" | "abs" = "abs";
  const yU = file.yUnits.trim().toUpperCase();

  if (tech === "ir") {
    if (/REFLECTANCE|KUBELKA/.test(yU)) {
      return { ok: false, error: `The file's y is ${file.yUnits.trim()}; reflectance and Kubelka–Munk spectra are not compared with an absorption prediction.` };
    }
    if (/TRANSMIT/.test(yU) || yU === "%T" || yU === "T") {
      let ymax = -Infinity;
      for (const y of ys) if (y > ymax) ymax = y;
      irMode = ymax > 1.5 || /%/.test(yU) ? "pctT" : "fracT";
      const scale = irMode === "pctT" ? 100 : 1;
      pickY = ys.map((y) => {
        const t = y / scale;
        if (!(t > 0)) {
          dropped++;
          return NaN;
        }
        return -Math.log10(t);
      });
      conversions.push(`Peaks picked on absorbance A = −log₁₀T (the file is ${irMode === "pctT" ? "%T, 0–100" : "T, 0–1"}); the trace is drawn as the file gives it.`);
      if (dropped) caveats.push(`${dropped} ${dropped === 1 ? "point has" : "points have"} T ≤ 0, which has no absorbance; ${dropped === 1 ? "it was" : "they were"} left out of peak picking.`);
      yLabel = irMode === "pctT" ? "transmittance (%)" : "transmittance";
    } else {
      yLabel = yU === "ABSORBANCE" ? "absorbance" : displayUnits(file.yUnits) || "absorbance";
      if (yU !== "ABSORBANCE") conversions.push(`The file's y (${file.yUnits.trim() || "unlabelled"}) is treated as absorbance-like: peaks point up.`);
    }
  } else if (tech === "ms") {
    let ymax = -Infinity;
    for (const y of ys) if (y > ymax) ymax = y;
    if (!(ymax > 0)) return { ok: false, error: "The mass spectrum has no positive intensity." };
    displayY = ys.map((y) => (100 * y) / ymax);
    pickY = displayY;
    yLabel = "relative intensity (%)";
  } else {
    let src = ys;
    if (tech === "uvvis" && /REFLECTANCE|KUBELKA/.test(yU)) {
      return { ok: false, error: `The file's y is ${file.yUnits.trim()}; reflectance and Kubelka–Munk spectra are not compared with an absorption λmax.` };
    }
    if (tech === "uvvis" && (/TRANSMIT/.test(yU) || yU === "%T" || yU === "T")) {
      // λmax is an ABSORBANCE maximum. Picked on T, the transmittance MAXIMUM
      // (the least-absorbing wavelength) was taken as the band.
      let tMax = -Infinity;
      for (const y of ys) if (y > tMax) tMax = y;
      const scale = tMax > 1.5 || /%/.test(yU) ? 100 : 1;
      src = ys.map((y) => {
        const t = y / scale;
        if (!(t > 0)) {
          dropped++;
          return NaN;
        }
        return -Math.log10(t);
      });
      conversions.push(`The file is ${scale === 100 ? "%T, 0–100" : "T, 0–1"}: converted to absorbance A = −log₁₀T before λmax is picked, and drawn as absorbance.`);
      if (dropped) caveats.push(`${dropped} ${dropped === 1 ? "point has" : "points have"} T ≤ 0, which has no absorbance; ${dropped === 1 ? "it was" : "they were"} left out.`);
    }
    let ymax = -Infinity;
    for (const y of src) if (Number.isFinite(y) && Math.abs(y) > ymax) ymax = Math.abs(y);
    if (!(ymax > 0)) return { ok: false, error: "The measured trace is flat zero; there is nothing to compare." };
    displayY = src.map((y) => y / ymax);
    pickY = displayY;
    yLabel = src === ys ? "normalised intensity" : "normalised absorbance";
  }

  // --- peak picking ------------------------------------------------------------------------
  let picked: Picked[];
  let capped = false;
  // A PEAK TABLE is a set of sticks for EVERY technique: each listed peak is a
  // measured peak. Running local-maximum picking over a peak list in file order
  // kept one line of four and "matched" three predictions to it.
  const isSticks = file.form === "peaks";
  let unitMass = false;
  if (isSticks && tech !== "ms") {
    let hMax = 0;
    for (const v of pickY) if (Number.isFinite(v) && v > hMax) hMax = v;
    const heights = pickY.map((v) => (Number.isFinite(v) && hMax > 0 ? Math.max(0, v) / hMax : 0));
    displayY = heights;
    yLabel = tech === "ir" && irMode !== "abs" ? "normalised absorbance (from %T)" : "normalised peak height";
    if (tech === "ir" && irMode !== "abs") conversions.push("Peak-table heights drawn as normalised absorbance, −log₁₀T.");
    pickY = heights;
  }
  if (tech === "ms") {
    unitMass = xs.every((x) => Math.abs(x - Math.round(x)) < 1e-6);
    // Sticks: every line of a peak table is a peak (adjacent integer m/z must
    // not compete as "local maxima"). A profile trace is picked like any other.
    if (isSticks) {
      const c: Picked[] = [];
      for (let i = 0; i < xs.length; i++) if (pickY[i] >= 1) c.push({ x: xs[i], h: pickY[i] / 100 });
      c.sort((a, b) => b.h - a.h || a.x - b.x);
      capped = c.length > OVERLAY_MAX_PEAKS;
      picked = c.slice(0, OVERLAY_MAX_PEAKS);
    } else {
      const r = pickPeaks(xs, pickY, 0.01, unitMass ? 0.5 : 0.01);
      picked = r.peaks;
      capped = r.capped;
    }
  } else {
    if (isSticks) {
      const c: Picked[] = [];
      for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(pickY[i])) c.push({ x: xs[i], h: pickY[i] });
      c.sort((a, b) => b.h - a.h || a.x - b.x);
      capped = c.length > OVERLAY_MAX_PEAKS;
      picked = c.slice(0, OVERLAY_MAX_PEAKS);
      conversions.push("The file is a peak table: every listed peak is a measured peak (no peak picking).");
    } else {
      // §B2 separations, with two measured exceptions: ¹³C uses 0.3 ppm, because
      // 0.5 merges ethylbenzene's 128.53/128.08 pair (0.45 apart); ¹H picks LINES
      // at 0.004 ppm and then groups them into multiplets (below), because 0.02 ppm
      // is the size of a 7 Hz doublet at 300 MHz.
      const sep = tech === "1H" ? 0.004 : tech === "13C" ? 0.3 : tech === "ir" ? 10 : 2;
      const r = pickPeaks(xs, pickY, 0.05, sep);
      picked = r.peaks;
      capped = r.capped;
    }
    if (tech === "1H") {
      const sf = numMeta(file, ".OBSERVEFREQUENCY");
      const gap = sf > 0 ? 20 / sf : 0.06;
      picked = groupMultiplets(picked, gap);
      conversions.push(`¹H lines closer than ${gap.toFixed(3)} ppm (${sf > 0 ? `20 Hz at ${sf} MHz` : "no observe frequency; 0.06 ppm"}) are grouped into one multiplet centre.`);
    }
  }
  if (capped) caveats.push(`The measured peak list is capped at the ${OVERLAY_MAX_PEAKS} strongest peaks.`);

  // --- matching ------------------------------------------------------------------------------
  const windowOf = (l: PredictedLine): [number, number] => {
    if (tech === "ir") return l.range ?? [l.x - 20, l.x + 20];
    if (tech === "uvvis") return [l.x - 20, l.x + 20];
    if (tech === "ms") {
      const h = unitMass ? 0.5 : (l.x * 10) / 1e6;
      return [l.x - h, l.x + h];
    }
    const w = NMR_WINDOW[tech];
    return [l.x - w, l.x + w];
  };
  const order = lines.map((l, i) => i).sort((a, b) => lines[b].height - lines[a].height || a - b);
  const used = new Set<number>();
  const rowsByIndex: MatchRow[] = new Array(lines.length);
  for (const i of order) {
    const l = lines[i];
    const win = windowOf(l);
    let best = -1;
    if (tech === "uvvis") {
      // λmax is a BAND maximum: compare with the strongest measured maximum in
      // the window (toluene's fine structure would otherwise offer a nearer
      // shoulder), and fall back on the nearest when the window is empty.
      for (let j = 0; j < picked.length; j++) {
        if (used.has(j)) continue;
        const p = picked[j];
        if (p.x >= win[0] && p.x <= win[1] && (best < 0 || p.h > picked[best].h)) best = j;
      }
    }
    if (best < 0) {
      for (let j = 0; j < picked.length; j++) {
        if (used.has(j)) continue;
        if (best < 0 || Math.abs(picked[j].x - l.x) < Math.abs(picked[best].x - l.x)) best = j;
      }
    }
    const nearest = best >= 0 ? picked[best].x : null;
    const within = nearest !== null && nearest >= win[0] && nearest <= win[1];
    if (within) used.add(best);
    rowsByIndex[i] = { predicted: l.x, label: l.label, nearest, delta: nearest === null ? null : l.x - nearest, within, window: win };
  }
  const rows = rowsByIndex;

  // --- checks: each a caveat, never a silent correction ---------------------------------------
  let offset: OverlayOk["offset"];
  if (wantKind === "nmr") {
    const w = NMR_WINDOW[tech];
    const o = detectOffset(lines.map((l) => l.x), picked.map((p) => p.x), w);
    if (o) {
      offset = o;
      caveats.unshift(
        `The measured axis looks offset by ${fmtSigned(o.shift, 2, true)} ppm (${o.peaks} peaks agree on it). Check the referencing — nothing has been shifted; give a reference peak (measured δ → true δ) to correct it. Until then no line is scored as matched: the nearest peaks below sit across that offset and are not evidence.`
      );
    }
  }
  // An offset axis is NOT ASSESSED: a "✓" earned by pairing across a 9 ppm
  // shift (unreferenced BRUKPAC: 144.2 → 137.6) is a wrong answer with a tick.
  const assessed = !offset;
  if (!assessed) {
    for (const r of rows) r.within = false;
    used.clear();
  }
  const matched = rows.filter((r) => r.within).length;
  const unmatchedMeasured = picked
    .filter((_, j) => !used.has(j))
    .slice(0, 10)
    .map((p) => ({ x: p.x, height: p.h, ...(p.lines ? { lines: p.lines } : {}) }));
  if (tech === "ir" && /GAS/i.test(file.meta["STATE"] ?? "")) {
    caveats.push(
      "Gas-phase spectrum (##STATE=gas): O–H and C=O sit higher than the condensed-phase values predicted (free O–H near 3650 cm⁻¹, not a broad 3200–3600 band). Unmatched bands here may be phase, not structure."
    );
  }
  const molform = file.meta["MOLFORM"];
  if (molform && pred.formula) {
    const a = parseMolform(molform);
    const b = parseMolform(pred.formula);
    if (a && b && !sameFormula(a, b)) {
      caveats.push(
        `Identity: this file is ${typesetFormula(hill(a))}; the prediction is for ${typesetFormula(hill(b))}. The overlay is drawn anyway — the comparison may be deliberate.`
      );
    } else if (!a) {
      caveats.push(`The file's MOLFORM ("${molform.trim()}") could not be read as a formula, so the identity was not checked.`);
    }
  }
  if (tech === "ms" && pred.msHeights === "ranking") {
    caveats.push("Predicted fragment heights are a likelihood RANKING, not intensities.");
  }
  caveats.push("Matching is one-to-one: each measured peak is paired with at most one predicted line, strongest prediction first.");
  caveats.push(NOT_AN_ASSIGNMENT);

  // --- the series for the figure ------------------------------------------------------------
  // Peak tables are kept whole; a trace is reduced to its min/max envelope (every
  // extremum survives — spectraChart.decimateTrace's rule) so a 2^20-point file
  // does not hand the figure a million objects.
  const measured = isSticks ? xs.map((x, i) => ({ x, y: displayY[i] })) : envelope(xs, displayY, MEASURED_BUDGET);
  const out: OverlayOk = {
    ok: true,
    technique: tech,
    axis: axisFor(tech),
    measured,
    xSpan: { first: xs[0], last: xs[xs.length - 1], points: xs.length },
    measuredForm: isSticks ? "sticks" : "trace",
    yLabel,
    peaks: picked.map((p) => ({ x: p.x, height: p.h, ...(p.lines ? { lines: p.lines } : {}) })),
    rows,
    matched,
    assessed,
    unmatchedMeasured,
    conversions,
    caveats,
    fileTitle: file.title,
    fileUnits: { x: file.xUnits, y: file.yUnits },
  };
  if (offset) out.offset = offset;

  if (tech === "ir" && pred.irBands && pred.irBands.length && !isSticks) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of xs) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const from = Math.max(400, Math.floor(lo));
    const to = Math.min(4000, Math.ceil(hi));
    if (to > from) {
      const curve = irTransmittanceCurve(pred.irBands, { from, to, step: 4 });
      if (irMode === "pctT") out.predictedCurve = curve;
      else if (irMode === "fracT") out.predictedCurve = curve.map((p) => ({ x: p.x, y: p.y / 100 }));
      else {
        // Absorbance-like file: A = −log₁₀(T), scaled to the measured maximum.
        let mMax = -Infinity;
        for (const y of ys) if (Number.isFinite(y) && y > mMax) mMax = y;
        const a = curve.map((p) => ({ x: p.x, y: -Math.log10(Math.max(p.y, 1e-6) / 100) }));
        let aMax = 0;
        for (const p of a) if (p.y > aMax) aMax = p.y;
        const k = aMax > 0 && mMax > 0 ? mMax / aMax : 1;
        out.predictedCurve = a.map((p) => ({ x: p.x, y: p.y * k }));
        conversions.push("The predicted curve (%T) is drawn as absorbance, −log₁₀T, scaled to the measured maximum.");
      }
    }
  } else if (tech === "uvvis") {
    out.predictedMarker = lines[0].x;
  } else if (tech === "ms") {
    const hMax = Math.max(...lines.map((l) => l.height), 1e-12);
    out.predictedSticks = lines.map((l) => ({ x: l.x, height: (-100 * l.height) / hMax }));
  } else {
    const hMax = Math.max(...lines.map((l) => l.height), 1e-12);
    out.predictedSticks = lines.map((l) => ({ x: l.x, height: (0.9 * l.height) / hMax }));
  }
  return out;
}

/** The most points of a measured trace handed to the figure. */
export const MEASURED_BUDGET = 4000;

/**
 * Min/max envelope in file order: each of budget/2 buckets keeps its lowest and
 * highest point, so every peak and every dip survives. Works on the parallel
 * arrays, never building one object per input point.
 */
function envelope(xs: number[], ys: number[], budget: number): { x: number; y: number }[] {
  const n = xs.length;
  if (n <= budget) return xs.map((x, i) => ({ x, y: ys[i] }));
  const buckets = Math.max(1, Math.floor(budget / 2));
  const per = n / buckets;
  const out: { x: number; y: number }[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor(b * per);
    const hi = Math.min(n, Math.floor((b + 1) * per));
    if (hi <= lo) continue;
    let iMin = lo;
    let iMax = lo;
    for (let i = lo; i < hi; i++) {
      if (ys[i] < ys[iMin]) iMin = i;
      if (ys[i] > ys[iMax]) iMax = i;
    }
    if (iMin === iMax) out.push({ x: xs[iMin], y: ys[iMin] });
    else {
      const a = Math.min(iMin, iMax);
      const c = Math.max(iMin, iMax);
      out.push({ x: xs[a], y: ys[a] }, { x: xs[c], y: ys[c] });
    }
  }
  return out;
}

function axisFor(tech: OverlayTechnique): OverlayOk["axis"] {
  if (tech === "1H" || tech === "13C") return { label: "δ (ppm) — increases leftward", unit: "ppm", reversed: true };
  if (tech === "ir") return { label: "wavenumber (cm⁻¹) — decreases rightward", unit: "cm⁻¹", reversed: true };
  if (tech === "uvvis") return { label: "wavelength (nm)", unit: "nm", reversed: false };
  return { label: "m/z", unit: "", reversed: false };
}

/**
 * The referencing check. Scans the candidate shifts given by every (measured −
 * predicted) pair (beyond 3 windows only with ≥ 60 % agreement), counts how many predicted lines find a peak
 * within ¼ window after the shift, and keeps the best (ties → the smallest
 * shift). It fires only when ≥ 3 lines agree, the agreed shift is more than ½
 * window, and their spread (MAD) is under ¼ window — and when that shift beats
 * no shift at all.
 */
function detectOffset(pred: number[], meas: number[], window: number): { shift: number; peaks: number } | null {
  if (pred.length < 3 || meas.length < 3) return null;
  const tau = window / 4;
  const sortedMeas = meas.slice().sort((a, b) => a - b);
  const nearestTo = (v: number): number => {
    let lo = 0;
    let hi = sortedMeas.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedMeas[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    let best = sortedMeas[lo];
    if (lo > 0 && Math.abs(sortedMeas[lo - 1] - v) < Math.abs(best - v)) best = sortedMeas[lo - 1];
    return best;
  };
  const support = (s: number): number[] => {
    const d: number[] = [];
    for (const p of pred) {
      const m = nearestTo(p + s);
      if (Math.abs(m - (p + s)) <= tau) d.push(m - p);
    }
    return d;
  };
  let bestShift = 0;
  let bestCount = support(0).length;
  const zeroCount = bestCount;
  // Every pairwise shift is a candidate (≤ 200 × 200). A shift beyond 3 windows
  // is the best GLOBAL alignment of the two sets only if most of the prediction
  // agrees on it (≥ 60 %, and ≥ 3 lines): a few chance coincidences far away
  // must not outvote a plausible axis.
  const farNeed = Math.max(3, Math.ceil(0.6 * pred.length));
  const cands: number[] = [];
  for (const p of pred) for (const m of meas) cands.push(m - p);
  cands.sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const s of cands.slice(0, 40000)) {
    const c = support(s).length;
    if (Math.abs(s) > 3 * window && c < farNeed) continue;
    if (c > bestCount) {
      bestCount = c;
      bestShift = s;
    }
  }
  if (bestCount < 3 || bestCount <= zeroCount) return null;
  const ds = support(bestShift).sort((a, b) => a - b);
  const median = (v: number[]): number => (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  const med = median(ds);
  const mad = median(ds.map((d) => Math.abs(d - med)).sort((a, b) => a - b));
  if (Math.abs(med) <= window / 2 || mad >= window / 4) return null;
  return { shift: med, peaks: ds.length };
}

/** The one-line verdict, shared by the table text and the figure. */
export function matchSummary(r: OverlayOk): string {
  if (!r.assessed) {
    return `Not assessed: the measured axis looks offset${r.offset ? ` by ${fmtSigned(r.offset.shift, 2, true)} ppm` : ""}. Give a reference peak, then compare.`;
  }
  return `${r.matched} of ${r.rows.length} predicted lines have a measured peak inside their window.`;
}

/** The match table as text, for insertion beside the figure. */
export function formatMatchTable(r: OverlayOk): string {
  const dp = r.technique === "1H" ? 2 : r.technique === "13C" || r.technique === "uvvis" ? 1 : r.technique === "ms" ? 3 : 0;
  const u = r.axis.unit ? ` ${r.axis.unit}` : "";
  const lines: string[] = [];
  lines.push(`Predicted${u}\tAssignment\tNearest measured${u}\tΔ (pred − meas)\tWithin window`);
  for (const row of r.rows) {
    lines.push(
      [
        fmtSigned(row.predicted, dp),
        row.label,
        row.nearest === null ? "—" : fmtSigned(row.nearest, dp),
        row.delta === null ? "—" : fmtSigned(row.delta, dp, true),
        !r.assessed ? "not assessed" : row.within ? "✓" : "—",
      ].join("\t")
    );
  }
  lines.push(matchSummary(r));
  if (r.unmatchedMeasured.length) {
    lines.push(`Measured peaks with no prediction (strongest ${r.unmatchedMeasured.length}): ${r.unmatchedMeasured.map((p) => fmtSigned(p.x, dp)).join(", ")}${u}.`);
  }
  for (const c of r.conversions) lines.push(c);
  for (const c of r.caveats) lines.push(c);
  return lines.join("\n");
}
