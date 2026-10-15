// The Spectra / Mass Spec / JCAMP pane's text and decisions, as pure functions (v2.139.0).
//
// WHY THIS IS NOT IN taskpane.ts. Nothing can import taskpane.ts in a test (it
// pulls in Office.js), so a formatter that lives there is invisible to the whole
// suite. Three of the things this release changes are exactly that kind of
// formatter: the multiplet column (which printed the VICINAL J beside a
// diastereotopic CH₂'s "m"), the inserted MS text (which built "M+" + offset and
// so would print "M+-2" for ferrocene's ⁵⁴Fe peak), and the JCAMP block summary
// (raw "1/CM" where the display contract wants cm⁻¹). Each now lives here and is
// pinned by spectroscopyRouting.test.ts; the pane only calls them.
//
// Pure; no Office.js, no DOM.

import type { CoupledSignal } from "./nmr2d";
import type { NmrResult, NmrSignal } from "./nmr";
import type { IrResult } from "./ir";
import type { UvResult } from "./uvvis";
import type { FragmentResult } from "./fragment";
import type { MassSpecResult } from "./massspec";
import type { JcampSpectrum } from "./jcamp";
import { typesetHill } from "./structures";
import { tabulatedElements } from "./isotopes";
import {
  PredictedSpectrum,
  OverlayOptions,
  displayUnits,
  typesetFormula,
  typesetLabel,
  predictedFromNmr,
  predictedFromIr,
  predictedFromUv,
  predictedFromFragments,
  predictedFromIsotopePattern,
} from "./spectrumOverlay";

// --- NMR --------------------------------------------------------------------------

/**
 * The multiplet column for one ¹H signal.
 *
 * A diastereotopic CH₂ is reported as "m" with its typical GEMINAL ²J range: the
 * coupling signal still carries the vicinal J values (COSY and TOCSY read them),
 * and printing those beside the "m" would label a vicinal 7 Hz as the coupling
 * that makes the pattern second-order. A CH₂ whose topicity DEPENDS on unspecified
 * configuration is "m" with no J at all — neither number is known to apply.
 */
export function multipletText(cs: CoupledSignal | undefined, fallback: string): string {
  if (!cs) return fallback;
  if (cs.geminal) return `m (²J ${cs.geminal.min}–${cs.geminal.max} Hz)`;
  if (cs.multiplet === "m" && cs.count === 2 && cs.note && /depends on relative configuration/.test(cs.note)) return "m";
  return cs.J.length ? `${cs.multiplet} (${cs.J.map((j) => j.toFixed(1)).join(", ")})` : cs.multiplet;
}

/**
 * Diastereotopicity notes as footnotes: one letter per signal that has a note
 * (identical notes share a letter), and each note's text once. A 250-character
 * note repeated under ten CH₂ rows of a steroid would bury the table.
 */
export function diastereotopicNotes(signals: NmrSignal[]): { marks: string[]; notes: string[] } {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const byText = new Map<string, string>();
  const notes: string[] = [];
  const marks = signals.map((s) => {
    const t = s.diastereotopic?.note;
    if (!t) return "";
    let m = byText.get(t);
    if (!m) {
      m = letters[byText.size] ?? String(byText.size + 1);
      byText.set(t, m);
      notes.push(`${m} — ${t}`);
    }
    return m;
  });
  return { marks, notes };
}

/** "1H" → "¹H", "13C" → "¹³C" — for headings ("Predicted ¹H NMR"). */
export function nucleusName(n: string): string {
  return n === "1H" ? "¹H" : n === "13C" ? "¹³C" : n;
}

/** The ¹H/¹³C table as inserted text: shift, count, multiplet, assignment, note mark. */
export function nmrTableText(r: NmrResult, coupling: CoupledSignal[] | undefined): string[] {
  const { marks, notes } = diastereotopicNotes(r.signals);
  const rows = r.signals.map((s, i) => {
    const mk = marks[i] ? `  [${marks[i]}]` : "";
    // Display contract: CH₂ / CH₃ in the assignment and the DEPT class.
    const a = typesetLabel(s.assignment);
    if (r.nucleus !== "1H") {
      const d = s.dept ? `  ${typesetLabel(s.dept).padEnd(3)}` : "";
      return `  δ ${s.shift.toFixed(1)}${d}  ${a}${s.count > 1 ? `  (${s.count} equivalent C)` : ""}${mk}`;
    }
    return `  δ ${s.shift.toFixed(2)}  (${s.count}H, ${multipletText(coupling?.[i], s.multiplicity)})  ${a}${mk}`;
  });
  return notes.length ? [...rows, "Diastereotopic notes:", ...notes.map((n) => `  ${n}`)] : rows;
}

// --- Mass Spec ------------------------------------------------------------------------

/** How many elements the isotope table covers, said from the table itself. */
export function isotopeCoverage(): string {
  const els = tabulatedElements();
  return `Isotope patterns cover all ${els.length} elements with a natural isotopic composition (${els[0]}–${els[els.length - 1]}); masses AME2020, compositions CIAAW 2024.`;
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };

/**
 * An adduct name for display: "[M-H]-" → "[M−H]⁻", "[M+NH4]+" → "[M+NH₄]⁺",
 * "[M+2H]2+" → "[M+2H]²⁺". The engine keeps the ASCII names (tests and lookups
 * key on them); only what is shown and inserted is typeset.
 */
export function adductName(name: string): string {
  const m = /^\[(.*)\]([0-9]*[+-])$/.exec(name);
  if (!m) return name;
  const inner = m[1].replace(/-/g, "−").replace(/([A-Za-z)])(\d+)/g, (_x, a: string, d: string) => a + typesetFormula(d));
  return `[${inner}]${[...m[2]].map((c) => SUP[c] ?? c).join("")}`;
}

/** A net charge as the pane writes it: "1+", "2−". */
export function chargeText(q: number): string {
  return q > 0 ? `${q}+` : `${-q}−`;
}

/** An isotope intensity, the same precision on screen and in the document. */
export function intensityText(v: number): string {
  return v.toFixed(v >= 10 ? 1 : 2);
}

/** Multi-line plain-text MS summary for insertion. Every line the pane shows, the document gets. */
export function massSpecText(spec: MassSpecResult | null): string {
  if (!spec) return "";
  const lines = [
    `Mass spectrometry — ${typesetHill(spec.formula, spec.netCharge)}`,
    ...(spec.labelledIsotopes.length ? [`Labelled isotopes: ${spec.labelledIsotopes.join(", ")}`] : []),
    `Monoisotopic mass: ${spec.monoisotopicMass.toFixed(4)}`,
    `Average mass: ${spec.averageMass.toFixed(2)}`,
    "Isotope pattern (relative intensity):",
    // pk.label — "M−2" with a true minus. "M+" + offset printed "M+-2".
    ...spec.pattern.map((p) => `  ${p.label}  ${p.mass.toFixed(4)}  ${intensityText(p.intensity)}%`),
    ...(spec.patternNote ? [`  ${spec.patternNote}`] : []),
    ...(spec.unsupportedInPattern.length ? [`  Pattern excludes ${spec.unsupportedInPattern.join(", ")} (no isotope composition).`] : []),
    ...(spec.netCharge !== 0
      ? [`Adducts: n/a (input carries a net charge (${chargeText(spec.netCharge)}); ESI adducts assume a neutral molecule)`]
      : ["Adducts (m/z):", ...spec.adducts.map((a) => `  ${adductName(a.name)}  ${a.mz.toFixed(4)}`)]),
    spec.massSource,
    "Computed offline — verify before relying.",
  ];
  return lines.join("\n");
}

// --- JCAMP ------------------------------------------------------------------------------

/**
 * The points to DRAW for a block. A peak table is a list of sticks, not a
 * trace: drawn as a line it would join four NMR peaks into an invented curve.
 * Each peak becomes a vertical stick (x,0)→(x,y)→(x,0), so a line series draws
 * sticks on a baseline. A trace is returned unchanged.
 */
export function jcampDrawPoints(s: JcampSpectrum): { x: number; y: number }[] {
  if (s.form !== "peaks") return s.points;
  // The baseline follows the y convention: in transmittance a band HANGS from
  // 100 %T (or 1, for a 0–1 file) down to T, so the strongest band is the
  // longest stick. Everything else rises from 0.
  let maxY = -Infinity;
  for (const p of s.points) if (p.y > maxY) maxY = p.y;
  const base = /TRANSMIT|%T/i.test(s.yUnits) ? (maxY > 1.5 ? 100 : 1) : 0;
  let peaks = [...s.points].sort((a, b) => a.x - b.x);
  // Never thin sticks into a trace. jcampChartSvg's decimation (budget 1,200
  // points = 400 sticks) would join a baseline point to a neighbour's top. Above
  // that, the strongest stick in each of 400 equal x-bins is kept instead —
  // still sticks, each one a real peak from the table.
  const MAX_STICKS = 400;
  if (peaks.length > MAX_STICKS) {
    const lo = peaks[0].x;
    const span = peaks[peaks.length - 1].x - lo || 1;
    const bins: ({ x: number; y: number } | undefined)[] = new Array(MAX_STICKS);
    for (const p of peaks) {
      const b = Math.min(MAX_STICKS - 1, Math.floor(((p.x - lo) / span) * MAX_STICKS));
      const cur = bins[b];
      if (!cur || Math.abs(p.y - base) > Math.abs(cur.y - base)) bins[b] = p;
    }
    peaks = bins.filter((p): p is { x: number; y: number } => !!p);
  }
  const out: { x: number; y: number }[] = [];
  for (const p of peaks) out.push({ x: p.x, y: base }, { x: p.x, y: p.y }, { x: p.x, y: base });
  return out;
}

/** One line naming a block, for the block picker. */
export function jcampBlockLabel(s: JcampSpectrum, i: number): string {
  const kind = s.kind === "unknown" ? s.dataType || "unknown" : s.kind === "uvvis" ? "UV-Vis" : s.kind.toUpperCase();
  const form = s.form === "peaks" ? "peak table" : `${s.points.length.toLocaleString("en-US")} points`;
  // `block` is the reader's one numbering (the n-th data block in the file,
  // refused blocks included) — the same number the default-block reason and the
  // refusal warnings use.
  return `Block ${s.block ?? i + 1}: ${s.title || "untitled"} — ${kind}, ${form}${s.corrupt ? " (FAILED its checks)" : ""}`;
}

/**
 * The block summary, display-contract units (cm⁻¹, Hz, m/z) with the file's raw
 * strings kept in parentheses as provenance, and MOLFORM typeset.
 */
export function jcampSummaryLines(s: JcampSpectrum, filename: string): string[] {
  const unit = (raw: string): string => {
    const d = displayUnits(raw);
    return !raw ? "?" : d === raw.trim() ? d : `${d} (file: ${raw.trim()})`;
  };
  const lines: string[] = [];
  lines.push(`${s.title || filename} — ${s.dataType || "spectrum"}`);
  if (s.meta.MOLFORM) lines.push(`Formula (MOLFORM): ${typesetFormula(s.meta.MOLFORM.replace(/\s+/g, ""))}`);
  lines.push(`${s.points.length.toLocaleString("en-US")} ${s.form === "peaks" ? "peaks (peak table)" : "points"}, ${unit(s.xUnits)} vs ${unit(s.yUnits)}`);
  if (s.points.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of s.points) {
      if (p.x < lo) lo = p.x;
      if (p.x > hi) hi = p.x;
    }
    // Six significant figures at most, no trailing zeros, a true minus.
    const num = (v: number): string => {
      const t = String(Number(v.toPrecision(6)));
      return t.startsWith("-") ? `−${t.slice(1)}` : t;
    };
    lines.push(`Range ${num(lo)} to ${num(hi)} ${displayUnits(s.xUnits)}`);
  }
  if (s.ntuples) {
    lines.push(`NTUPLES (${s.ntuples.type}): page ${s.ntuples.usedPage} read${s.ntuples.unusedPages.length ? `; not used: ${s.ntuples.unusedPages.join(", ")}` : ""}.`);
  }
  return lines;
}

// --- Overlay --------------------------------------------------------------------------------

/**
 * The optional reference peak: "7.36 = 7.26" (measured = true). Also accepts →,
 * -> and "to"; a decimal comma ("7,36 = 7,26"). Blank means none. A true minus
 * is read as a minus.
 */
export function parseReferencePeak(text: string): { ok: true; reference?: OverlayOptions["reference"] } | { ok: false; error: string } {
  // Product comma rule: "1,5" is the DECIMAL 1.5, never two numbers — so a
  // comma between digits is a decimal mark, and a comma is not a separator.
  const t = text
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2");
  if (!t) return { ok: true };
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:=|->|→|\bto\b)\s*(-?\d+(?:\.\d+)?)$/i.exec(t);
  if (!m) return { ok: false, error: "Reference peak: write it as measured = true, e.g. 7.36 = 7.26 (δ, cm⁻¹, nm or m/z)." };
  return { ok: true, reference: { measured: Number(m[1]), trueValue: Number(m[2]) } };
}

/** The prediction in the form the overlay engine reads, or why there is none. */
export type OverlaySource =
  | { kind: "1H" | "13C"; nmr: NmrResult }
  | { kind: "ir"; ir: IrResult }
  | { kind: "uvvis"; uv: UvResult }
  | { kind: "ms"; ms: FragmentResult }
  | { kind: "isotopes"; spec: MassSpecResult };

export function overlayPrediction(src: OverlaySource): PredictedSpectrum | { error: string } {
  switch (src.kind) {
    case "1H":
    case "13C":
      return predictedFromNmr(src.nmr);
    case "ir":
      return predictedFromIr(src.ir);
    case "uvvis":
      return predictedFromUv(src.uv);
    case "ms":
      return predictedFromFragments(src.ms);
    case "isotopes":
      return predictedFromIsotopePattern(src.spec.pattern, src.spec.formula);
  }
}
