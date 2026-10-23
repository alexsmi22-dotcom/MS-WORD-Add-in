// Pane glue for the HPLC/GC peak-table calculator (Release C gap #7): plate number, resolution, retention and
// separation factors, symmetry factor and area percent from a pasted peak table, with the chromatogram
// reconstructed from the table. Kept OUT of taskpane.ts so the exact object the pane registers can be tested (the
// pattern of titrationCalcs.ts, whose structural EngCalc types and group this file shares).
//
// No number is computed here: chromatography.ts owns the conventions (USP ⟨621⟩ / Ph. Eur. 2.2.46 harmonized,
// half-height widths) and every formula. This file reads the fields, words the result under the display contract
// (U+2212 minus, ×10ⁿ, never an em dash, NaN or e-notation in the text) and draws.

import type { EngUnitContract } from "./engCalc";
import { engReport } from "./engReport";
import type { AnalyzeOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { THIN_SPACE } from "./axis";
import { CHEM_ENG_GROUP, type ChemEngCalc } from "./titrationCalcs";
import { CHROM_CONVENTION, readPeakTable, analyzePeaks, drawPlan, showNum, MAX_PEAKS, type PeakResult } from "./chromatography";
import { chromatogramSvg } from "./chromChart";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "–")), ok: false });

/** A plate number: whole, grouped with thin spaces ("13 850"); ×10ⁿ from 10⁹. */
export function fmtPlates(n: number): string {
  if (!Number.isFinite(n)) return "not finite";
  if (n >= 1e9) return showNum(n, 4);
  const s = String(Math.round(n));
  return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}
/** Two decimals (Rs, T, α, k), ×10ⁿ when that would hide the value. */
export function fmt2(v: number): string {
  if (!Number.isFinite(v)) return "not finite";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e6)) return showNum(v, 3);
  return v.toFixed(2).replace(/^-/, "−");
}
/** Area percent: one decimal, three significant figures below 0.1 %. */
export function fmtPct(v: number): string {
  if (v !== 0 && v < 0.1) return showNum(v, 3);
  return v.toFixed(1);
}

const UNIT_OPTIONS = [
  { value: "min", label: "min" },
  { value: "s", label: "s" },
];

const DEFAULT_TABLE =
  "Peak\tRT\tArea\tHeight\tW0.5\tW0.05\tf\n" +
  "Theobromine\t3.12\t41.2\t520\t0.074\t0.140\t0.066\n" +
  "Theophylline\t3.86\t38.5\t455\t0.080\t0.155\t0.072\n" +
  "Caffeine\t4.95\t102.7\t1050\t0.091\t0.180\t0.081\n" +
  "Impurity A\t5.42\t3.1\t30\t0.095\t0.200\t0.083";


/** One line of the results table (tab-separated, an en dash for a value not computed). */
function tableLine(p: PeakResult, unit: string, next: PeakResult | undefined): string {
  const dash = "–";
  const cells = [
    String(p.index),
    p.id === null ? dash : p.named ? p.id : `ID ${p.id}`,
    `${showNum(p.tR)} ${unit}`,
    p.areaPct === null ? dash : `${fmtPct(p.areaPct)} %`,
    p.k === null ? dash : fmt2(p.k),
    p.N === null ? dash : fmtPlates(p.N),
    p.Rs === null || !next ? dash : fmt2(p.Rs),
    p.alpha === null || !next ? dash : fmt2(p.alpha),
    p.T === null ? dash : fmt2(p.T),
  ];
  return cells.join("\t");
}

const peakTableCalc: ChemEngCalc = {
  id: "chem-peak-table",
  name: "HPLC/GC peak table (plates, resolution, symmetry)",
  group: CHEM_ENG_GROUP,
  unitContract: "domain",
  hint:
    "Paste the PEAK TABLE your chromatography software reports (one line per peak), not the raw detector trace: this " +
    "tool does no peak detection or integration. Columns are read by their headers (Peak or Name, RT or tR, Area, " +
    "Height, W0.5 = width at half height, W0.05 = width at 5 % height, f = front half-width at 5 % height), in any " +
    "order; with no header the order is tR, area, W0.5, height, W0.05, f (a name column may come first when columns " +
    "are tab-separated). Times, widths and the dead time tM are all in the time unit chosen below; a unit written in a header (RT (min)) must match it, and nothing is converted. Gives the plate number N = 5.54 (tR/W₀.₅)², the resolution " +
    "Rs = 1.18 Δt/(W₀.₅,1 + W₀.₅,2) to the next peak, the retention factor k and separation factor α (with a dead " +
    "time tM), the symmetry factor T = W₀.₀₅/(2f) and area %, by USP ⟨621⟩ / Ph. Eur. 2.2.46 (harmonized, half-height " +
    "widths; no tangent method). The chromatogram is reconstructed from the table as Gaussian peaks, not the measured trace.",
  fields: [
    { key: "data", label: "Peak table (header row optional; tabs between columns)", default: DEFAULT_TABLE, kind: "block", rows: 6 },
    { key: "tm", label: "Dead time tM (in the time unit below; optional, for k and α)", default: "1.05", kind: "text" },
    { key: "unit", label: "Time unit of the table", default: "min", kind: "select", options: UNIT_OPTIONS },
  ],
  compute: (r) => {
    const unit = r("unit") === "s" ? "s" : "min";
    const tmRaw = (r("tm") ?? "").trim();
    let tM: number | null = null;
    if (tmRaw) {
      const m = /^([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(min|s)?$/.exec(tmRaw);
      if (!m) return refuse(`Dead time tM: write a number in the table's time unit (${unit}), for example 1.05; or leave it blank.`);
      if (m[2] && m[2] !== unit) return refuse(`Dead time tM is in ${m[2]} but the table's time unit is ${unit}: give tM in ${unit}, or change the time unit.`);
      tM = Number(m[1].replace("−", "-"));
    }
    if (!(r("data") ?? "").trim()) return refuse("Paste a peak table: one line per peak with at least the retention time (and W0.5 for plates and resolution).");
    const t = readPeakTable(r("data"), { unit });
    if (!t.ok) return refuse(t.error);
    const a = analyzePeaks(t.rows, tM);
    if (!a.ok) return refuse(a.error);
    const peaks = a.peaks;
    const lines: string[] = [];
    lines.push(`${peaks.length} peak${peaks.length > 1 ? "s" : ""}${tM !== null ? `, dead time tM = ${showNum(tM)} ${unit}` : ""}.`);
    lines.push(`Convention: ${CHROM_CONVENTION}. N = 5.54 (tR/W₀.₅)², Rs = 1.18 (tR2 − tR1)/(W₀.₅,1 + W₀.₅,2), k = (tR − tM)/tM, α = k₂/k₁, T = W₀.₀₅/(2f).`);
    lines.push("Peak\tName\ttR\tArea %\tk\tN\tRs (to next)\tα (to next)\tT");
    peaks.forEach((p, i) => lines.push(tableLine(p, unit, peaks[i + 1])));
    // The critical pair: the lowest resolution between neighbours, the number a suitability limit is set on.
    const pairs = peaks.slice(0, -1).filter((p) => p.Rs !== null);
    if (pairs.length > 1) {
      const worst = pairs.reduce((m, p) => ((p.Rs as number) < (m.Rs as number) ? p : m));
      lines.push(`Lowest resolution: Rs = ${fmt2(worst.Rs as number)} between ${worst.ref} and ${peaks[worst.index].ref}.`);
    }
    const plan = drawPlan(peaks);
    if (!plan.draw.length) return refuse("Nothing to draw: no peak has a height, or an area and W0.5.");
    const drawnIdx = plan.draw.map((d) => peaks.findIndex((p) => p.label === d.label && p.tR === d.tR));
    const fig = chromatogramSvg(plan.draw, {
      unit,
      numbers: drawnIdx.map((i) => peaks[i].index),
      named: plan.draw.some((_, j) => peaks[drawnIdx[j]].named),
      notes: plan.notes,
    });
    for (const n of [...t.notes, ...a.notes]) lines.push(`Note: ${n}`);
    lines.push(`Note: the table is capped at ${MAX_PEAKS} peaks; times and widths must share one unit (k, N, Rs, α and T are ratios, so the unit itself does not change them).`);
    return engReport(
      lines.map((l) => trueMinus(l)),
      [
        {
          kind: "plot",
          svg: fig.svg,
          w: fig.width,
          h: fig.height,
          caption: "Chromatogram reconstructed from the peak table (Gaussian peaks), not the measured trace.",
          alt: `Reconstructed chromatogram of ${peaks.length} peak${peaks.length > 1 ? "s" : ""}, relative response against time in ${unit}.`,
        },
      ],
    );
  },
};

/** The calculators this file adds to the Engineering registry (group "Chemistry & electrochemistry"). */
export const CHROM_CALCS: ChemEngCalc[] = [peakTableCalc];
