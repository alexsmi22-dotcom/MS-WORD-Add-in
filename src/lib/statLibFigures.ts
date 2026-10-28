/**
 * Figures for the Statistics library calculators that drew none ("fully inclusive", 2026-10-28):
 *  - coefForestSvg: a coefficient plot, each estimate with its 95% interval as a bar and a zero line, one panel per
 *    equation (econ-tobit: one panel; econ-heckman: the outcome and the selection equations; econ-mlogit: one panel per
 *    outcome against the base category);
 *  - depositExpansionSvg: the money created after each round of deposit expansion, converging to m times the injection
 *    (macro-money-multiplier).
 * Every plotted value is one the calculator computed and prints; the builders only lay them out (plot.buildPlotSvg,
 * plot.combineSvgs: no new drawing code).
 */
import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import { tickKeyNotes } from "./gmmStatCalcs";

/** One estimate and its 95% interval, as the calculator's table prints them. */
export interface ForestTerm {
  name: string;
  coef: number;
  lo: number;
  hi: number;
}

/** One panel of a coefficient plot. */
export interface ForestPanel {
  title: string;
  terms: ForestTerm[];
}

/** At most this many terms in one panel (the rest stay in the table, and the panel says so). */
export const FOREST_MAX_TERMS = 12;
/** At most this many panels (mlogit with many outcomes: the rest stay in the table). */
export const FOREST_MAX_PANELS = 6;

const FOREST_W = 420;
const FOREST_H = 250;

/** Short tick labels that fit their slot (the gmmCoefFigure rule); a shared prefix falls back to numbers keyed in a note. */
function ticks(names: string[]): { tick: string[]; notes: string[] } {
  const k = names.length;
  const maxChars = Math.max(4, Math.floor(330 / (k + 0.2) / 6.5) - 1);
  let tick = names.map((nm) => (nm.length > maxChars ? `${nm.slice(0, maxChars - 1)}…` : nm));
  const numbered = new Set(tick).size < tick.length;
  if (numbered) tick = names.map((_, j) => String(j + 1));
  const shortened = tick.some((t, j) => t !== names[j]);
  return { tick, notes: numbered ? tickKeyNotes(names, 70) : shortened ? [`Ticks, in order: ${names.join(", ")}.`] : [] };
}

/** One panel, or null when no term has a finite estimate and interval. */
function forestPanel(p: ForestPanel, extraNotes: string[]): string | null {
  const all = p.terms.filter((t) => [t.coef, t.lo, t.hi].every(Number.isFinite) && t.lo <= t.coef && t.coef <= t.hi);
  const skipped = p.terms.length - all.length;
  const shown = all.slice(0, FOREST_MAX_TERMS);
  if (!shown.length) return null;
  const k = shown.length;
  const { tick, notes } = ticks(shown.map((t) => t.name));
  // The bar is centred on the estimate; normal (Wald) intervals are symmetric, so coef ± half-width IS the interval.
  // An asymmetric one (none of the callers has one) is drawn with its larger half, so the bar never hides a bound.
  const pts = shown.map((t, j) => ({ x: j + 1, y: t.coef, err: Math.max(t.coef - t.lo, t.hi - t.coef) }));
  const series: Series[] = [
    { type: "line", points: [{ x: 0.4, y: 0 }, { x: k + 0.6, y: 0 }], color: "#94a3b8" },
    { type: "scatter", points: pts, color: "#0369a1" },
  ];
  const more: string[] = [];
  if (all.length > shown.length) more.push(`${all.length - shown.length} more term${all.length - shown.length === 1 ? "" : "s"} in the table, not drawn.`);
  if (skipped) more.push(`${skipped} term${skipped === 1 ? "" : "s"} without a finite interval not drawn.`);
  return buildPlotSvg(series, {
    width: FOREST_W,
    height: FOREST_H,
    title: p.title,
    ylabel: "Coefficient",
    errorBars: "ci95",
    // A tick at every term (step 1), each labelled with its term.
    xLimits: { min: 0.4, max: k + 0.6, step: 1 },
    xTickLabel: (v: number) => {
      const j = Math.round(v);
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? tick[j - 1] : "";
    },
    // What is missing first: the note block is bounded, and a long tick key must not push it off the figure.
    notes: [...more, ...extraNotes, ...notes],
  });
}

/**
 * A coefficient (forest) plot: each estimate as a dot with its 95% interval, a line at zero (an interval that crosses
 * it is not significant at 5%), one panel per equation, stacked. `note` goes under the first panel. Returns undefined
 * when nothing can be drawn (no term with a finite interval), so the calculator shows its tables alone.
 */
export function coefForestSvg(panels: ForestPanel[], note?: string): string | undefined {
  const parts: string[] = [];
  const use = panels.slice(0, FOREST_MAX_PANELS);
  for (const p of use) {
    const s = forestPanel(p, parts.length === 0 && note ? [note] : []);
    if (s) parts.push(s);
  }
  if (!parts.length) return undefined;
  if (panels.length > use.length) {
    // Said in the last panel drawn, by redrawing it with the note (cheap: a handful of terms).
    const last = use[use.length - 1];
    const s = forestPanel(last, [`${panels.length - use.length} more equation${panels.length - use.length === 1 ? "" : "s"} in the table, not drawn.`]);
    if (s) parts[parts.length - 1] = s;
  }
  return combineSvgs(parts).svg;
}

/**
 * Deposit expansion: the money created after each round (deposits plus the currency the public keeps), rising to
 * the multiplier times the injection. `cumulative[k]` is the total after round k + 1; `limit` is m times the injection,
 * labelled `limitLabel` (the text's own formatting).
 */
/**
 * A legend label with an exact fraction reduced to its decimal ("m·ΔB = 101000/1001 ≈ 100.8991" → "m·ΔB = 100.8991"),
 * and every number of four or more integer digits grouped ("1000000" → "1,000,000"). The fraction made the label too
 * long for the legend, which cut it to "m·ΔB = 101000/1001 ≈ …" and lost the value (R6 #12).
 */
export function legendDecimal(label: string): string {
  const dec = label.replace(/[−-]?[\d,]+\/[\d,]+\s*≈\s*/g, "");
  return dec.replace(/(?<![\d.,])([−-]?)(\d{4,})(\.\d+)?/g, (m, sign: string, int: string, frac: string | undefined) =>
    `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ?? ""}`,
  );
}

export function depositExpansionSvg(o: { cumulative: number[]; limit: number; limitLabel: string; title: string; injectionLabel: string }): string | undefined {
  const pts = o.cumulative.map((v, i) => ({ x: i + 1, y: v })).filter((p) => Number.isFinite(p.y));
  if (!pts.length || !Number.isFinite(o.limit)) return undefined;
  const n = pts.length;
  const series: Series[] = [
    { type: "line", points: [{ x: 0.5, y: o.limit }, { x: n + 0.5, y: o.limit }], color: "#b45309", label: legendDecimal(o.limitLabel) },
    { type: "line", points: pts, color: "#0369a1", label: "Money created so far" },
    { type: "scatter", points: pts, color: "#0369a1" },
  ];
  return buildPlotSvg(series, {
    width: 420,
    height: 260,
    title: legendDecimal(o.title),
    xlabel: "Round of lending",
    ylabel: "Money created",
    xLimits: { min: 0.5, max: n + 0.5 },
    yGrouping: "comma",
    notes: [
      ...(Math.abs(o.limit - pts[n - 1].y) > 0.01 * Math.abs(o.limit) ? [`Only the first ${n} rounds are drawn; the money created is still short of the limit there.`] : []),
      o.limit < 0
        ? `Round 1 is the ${o.injectionLabel} itself (a fall); each later round removes the loans banks can no longer back with reserves.`
        : `Round 1 is the ${o.injectionLabel} itself; each later round re-lends what banks do not keep as reserves.`,
    ],
  });
}
