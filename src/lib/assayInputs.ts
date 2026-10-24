// Bio/Assay single-value fields and the checks the closed-form lab calculators were missing (fix round 2,
// 2026-10-24). The pane read every field with `+r("x")`, so "0,001" was NaN and the result a bare "—", a negative
// absorbance gave a negative concentration, C2 > C1 gave a negative diluent volume, a fold of 1 or 0.5 "diluted"
// upwards, a sequence with B/Z/X/digits silently lost them, and kcat/Km was compared with the diffusion limit in
// M⁻¹ s⁻¹ whatever units were typed. Each check is a named refusal.

import { parseCellNumber } from "./dataimport";
import { assaySig } from "./assayFormat";
import { hBarSvg } from "./mechchart";
import { buildPlotSvg } from "./plot";
import { catalyticEfficiency, kcat as kcatOf } from "./assay";

export type ScalarRead = { ok: true; value: number; note?: string } | { ok: false; error: string };

/**
 * One typed number. A comma is a decimal comma when that reading is the only one ("0,001" = 0.001, "2,5" = 2.5); a
 * comma that could be digit grouping ("1,250", "12,500") is refused by name — never guessed, never a bare "—".
 * U+2212 and ×10ⁿ are read as everywhere else (parseCellNumber).
 */
export function readAssayScalar(text: string, label: string): ScalarRead {
  const t = (text ?? "").trim().replace(/^−/, "-");
  if (!t) return { ok: false, error: `${label}: enter a number.` };
  if (t.includes(",") && !t.includes(".") && !/[×x^]/.test(t)) {
    if (/^-?0,\d+$/.test(t) || (/^-?\d+,\d+$/.test(t) && !/^-?\d{1,3}(,\d{3})+$/.test(t))) {
      const v = Number(t.replace(",", "."));
      return { ok: true, value: v, note: `${label}: “${t}” read as ${String(v)} (decimal comma).` };
    }
    if (/^-?\d{1,3}(,\d{3}){2,}$/.test(t)) {
      return { ok: false, error: `${label}: “${t}” has digit-grouping commas; type it without them (${t.replace(/,/g, "")}).` };
    }
    if (/^-?\d{1,3}(,\d{3})+$/.test(t)) {
      const asDec = t.replace(/,(\d+)$/, ".$1");
      return {
        ok: false,
        error: `${label}: “${t}” is ambiguous: a decimal comma (${asDec.replace(/,/g, "")}) or a thousands separator (${t.replace(/,/g, "")})? Type it without the comma.`,
      };
    }
  }
  const plain = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : parseCellNumber(t);
  if (!Number.isFinite(plain)) return { ok: false, error: `${label}: “${t}” is not a number.` };
  return { ok: true, value: plain };
}

export interface ScalarSpec {
  key: string;
  label: string;
  /** "positive" (> 0), "nonneg" (≥ 0) or "any". */
  sign?: "positive" | "nonneg" | "any";
}

/** Reads every field once, in order; the first problem is the refusal. Notes say how a decimal comma was read. */
export function readAssayScalars(
  read: (k: string) => string,
  specs: ScalarSpec[],
): { ok: true; v: Record<string, number>; notes: string[] } | { ok: false; error: string } {
  const v: Record<string, number> = {};
  const notes: string[] = [];
  for (const s of specs) {
    const r = readAssayScalar(read(s.key), s.label);
    if (!r.ok) return r;
    if (s.sign === "positive" && !(r.value > 0)) return { ok: false, error: `${s.label} must be greater than zero (got ${assaySig(r.value)}).` };
    if (s.sign === "nonneg" && r.value < 0) return { ok: false, error: `${s.label} cannot be negative (got ${assaySig(r.value)}).` };
    if (r.note) notes.push(r.note);
    v[s.key] = r.value;
  }
  return { ok: true, v, notes };
}

/** C1·V1 = C2·V2: a dilution cannot concentrate. */
export function dilutionRefusal(c1: number, c2: number): string | null {
  if (c2 > c1) {
    return `C2 (${assaySig(c2)}) is larger than C1 (${assaySig(c1)}): adding diluent can only lower a concentration, so this dilution is impossible. Check that the two were not swapped.`;
  }
  return null;
}

/** A serial dilution: fold > 1 (a fold of 1 changes nothing; below 1 concentrates) and a whole number of steps. */
export function serialRefusal(fold: number, n: number): string | null {
  if (!(fold > 1)) {
    return fold === 1
      ? "A fold of 1 does not dilute: every step would have the starting concentration. Enter a fold greater than 1 (10 for a ten-fold series)."
      : `A fold of ${assaySig(fold)} is not a dilution (below 1 concentrates). Enter the fold as a number greater than 1: 2 for a 1:2 series, 10 for 1:10.`;
  }
  if (!Number.isInteger(n) || n < 1) return `The number of steps must be a whole number of at least 1 (got ${assaySig(n)}).`;
  return null;
}

const AMINO = "ACDEFGHIKLMNPQRSTVWY";

/**
 * A protein sequence for Gill & von Hippel ε₂₈₀: the 20 standard one-letter codes (spaces, line breaks, digits of a
 * numbered GenBank listing and a terminal * are layout). B, Z, X, J, O, U and other characters are refused by name:
 * B (Asx), Z (Glx) and X (unknown) may hide a Trp, Tyr or Cys, so ε could be wrong, and silently dropping them was.
 */
export function proteinSequenceRefusal(seq: string): string | null {
  const body = seq.replace(/^>.*$/m, "").replace(/[\s\d*]+/g, "");
  if (!body) return "The sequence holds no residues.";
  const bad = [...new Set([...body.toUpperCase()].filter((c) => !AMINO.includes(c)))];
  if (bad.length) {
    return (
      `Not standard one-letter amino-acid codes: ${bad.map((c) => `“${c}”`).join(", ")}. ε₂₈₀ is summed from W, Y and C, ` +
      "and an ambiguous residue (B = Asx, Z = Glx, X = unknown) could be one of them, so ε cannot be computed honestly. " +
      "Replace them with the actual residues, or enter ε directly with the sequence field empty."
    );
  }
  // Digits typed INSIDE a run of letters ("MKWZXB1") are a typo, not a numbered listing.
  if (/[A-Za-z]\d+[A-Za-z]|[A-Za-z]\d+$/.test(seq.replace(/\s+/g, " ").trim()) && !/^\s*\d/.test(seq)) {
    return "The sequence has digits inside it. Paste only the residues (a numbered GenBank listing with the numbers at line starts is fine).";
  }
  return null;
}

// ------------------------------------------------------------------ kcat, kcat/Km with units

/** Concentration units, as a factor to mol/L. "" = not stated. */
export const CONC_UNITS: { value: string; label: string; toM: number }[] = [
  { value: "", label: "unit not stated", toM: NaN },
  { value: "M", label: "M", toM: 1 },
  { value: "mM", label: "mM", toM: 1e-3 },
  { value: "uM", label: "µM", toM: 1e-6 },
  { value: "nM", label: "nM", toM: 1e-9 },
];
/** Rate units (concentration per time), as a factor to M/s. */
export const RATE_UNITS: { value: string; label: string; toMs: number }[] = [
  { value: "", label: "unit not stated", toMs: NaN },
  { value: "M/s", label: "M/s", toMs: 1 },
  { value: "mM/s", label: "mM/s", toMs: 1e-3 },
  { value: "uM/s", label: "µM/s", toMs: 1e-6 },
  { value: "nM/s", label: "nM/s", toMs: 1e-9 },
  { value: "M/min", label: "M/min", toMs: 1 / 60 },
  { value: "mM/min", label: "mM/min", toMs: 1e-3 / 60 },
  { value: "uM/min", label: "µM/min", toMs: 1e-6 / 60 },
  { value: "nM/min", label: "nM/min", toMs: 1e-9 / 60 },
];

export interface EfficiencyOut {
  ok: boolean;
  text: string;
  svg?: string;
  caveats?: string[];
}

/** The diffusion limit for kcat/Km, about 10⁸–10⁹ M⁻¹ s⁻¹ (Alberty & Hammes 1958; Bar-Even et al. 2011). */
export const DIFFUSION_LIMIT = { low: 1e8, high: 1e9 };

/**
 * kcat = Vmax/[E]ₜ and kcat/Km, converted to s⁻¹ and M⁻¹ s⁻¹ when every unit is stated. Only then is the result
 * compared with the diffusion limit: with unitless inputs "kcat/Km = 1500" is in the user's units, and drawing it
 * against 10⁹ M⁻¹ s⁻¹ compared two different quantities.
 */
export function catalyticEfficiencyCalc(o: {
  vmax: number;
  vmaxUnit: string;
  e: number;
  eUnit: string;
  km: number;
  kmUnit: string;
}): EfficiencyOut {
  if (!(o.vmax > 0)) return { ok: false, text: "Vmax must be greater than zero." };
  if (!(o.e > 0)) return { ok: false, text: "[Enzyme] must be greater than zero (kcat = Vmax/[E] divides by it)." };
  if (!(o.km > 0)) return { ok: false, text: "Km must be greater than zero." };
  const rate = RATE_UNITS.find((u) => u.value === o.vmaxUnit)?.toMs ?? NaN;
  const eM = CONC_UNITS.find((u) => u.value === o.eUnit)?.toM ?? NaN;
  const kmM = CONC_UNITS.find((u) => u.value === o.kmUnit)?.toM ?? NaN;
  const kcatKnown = Number.isFinite(rate) && Number.isFinite(eM);
  const allKnown = kcatKnown && Number.isFinite(kmM);
  // The engine's own kcat and kcat/Km (assay.ts), on SI-converted values when the units are known.
  const kcatRaw = kcatOf(o.vmax, o.e);
  const kcat = kcatKnown ? kcatOf(o.vmax * rate, o.e * eM) : kcatRaw;
  const eff = allKnown ? catalyticEfficiency(kcat, o.km * kmM) : catalyticEfficiency(kcatRaw, o.km);
  const lines = [
    kcatKnown ? `kcat = ${assaySig(kcat)} s⁻¹` : `kcat = Vmax/[E] = ${assaySig(kcatRaw)} (units of Vmax/[E]; state them to get s⁻¹)`,
    allKnown ? `kcat/Km = ${assaySig(eff)} M⁻¹ s⁻¹` : `kcat/Km = ${assaySig(eff)} (in your units, not M⁻¹ s⁻¹)`,
  ];
  const caveats: string[] = [];
  let svg: string;
  if (allKnown) {
    const where =
      eff > DIFFUSION_LIMIT.high
        ? "at or slightly above the diffusion limit (10⁸ to 10⁹ M⁻¹ s⁻¹): catalysis is limited by encounter, not chemistry"
        : eff >= DIFFUSION_LIMIT.low
          ? "at the diffusion limit (10⁸ to 10⁹ M⁻¹ s⁻¹): catalysis is limited by encounter, not chemistry"
          : `${assaySig(DIFFUSION_LIMIT.low / eff, 2)}-fold below the diffusion limit (10⁸ to 10⁹ M⁻¹ s⁻¹)`;
    lines.push(`This enzyme is ${where}.`);
    if (eff > 1e10) caveats.push("kcat/Km above 10¹⁰ M⁻¹ s⁻¹ exceeds the diffusion limit: check the units of Vmax, [E] and Km.");
    svg = hBarSvg(
      [
        { name: "this enzyme", value: eff },
        { name: "diffusion limit (upper)", value: DIFFUSION_LIMIT.high, colour: "#6b7280" },
      ],
      { title: "kcat/Km against the diffusion limit (M⁻¹ s⁻¹)", unit: "", w: 360 },
    );
  } else {
    caveats.push(
      "The units of Vmax, [E] and Km are not all stated, so kcat/Km cannot be put in M⁻¹ s⁻¹ or compared with the diffusion limit. Choose the units to get that comparison.",
    );
    // The rate law these constants define, which needs no units: v against [S] with Km marked.
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k <= 80; k++) {
      const s = (5 * o.km * k) / 80;
      pts.push({ x: s, y: (o.vmax * s) / (o.km + s) });
    }
    svg = buildPlotSvg(
      [
        { type: "line", points: pts, color: "#2563eb", label: "v = Vmax[S]/(Km + [S])" },
        { type: "scatter", points: [{ x: o.km, y: o.vmax / 2 }], color: "#b91c1c", label: "Km, Vmax/2" },
      ],
      { width: 360, height: 240, title: "Michaelis–Menten curve from Vmax and Km", xlabel: "[S]", ylabel: "v" },
    );
  }
  caveats.push("kcat = Vmax/[E]ₜ assumes every enzyme molecule is active; an active-site titration gives the true [E].");
  return { ok: true, text: lines.join("\n"), svg, caveats };
}
