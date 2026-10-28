/**
 * The shape of a Stats / Analyze / Engineering result and its plain-text form (moved out of taskpane.ts
 * so it can be tested: host-adapter scope §E). The text form is what the preview shows and what the
 * insert guard scans, so it is derived from the blocks in exactly one place.
 */
import { formatMatrix, Matrix } from "./linalg";
import { BracketChoice, BracketFigure } from "./statsBrackets";

export interface StatOutput {
  text: string;
  /**
   * What the result means, in one or two plain sentences, built from the computed numbers (lib/calcReading.ts
   * states the rules). Shown first, in bold, and inserted as the first paragraph. Never on a refusal.
   */
  reading?: string;
  /** False for a validation message (blocks insertion). */
  ok?: boolean;
  /**
   * Optional diagram shown under the result — currently the regression residual
   * and Q-Q plots, and the curve-fit plot.
   *
   * IT IS NO LONGER DISPLAY ONLY. This said "Display only: `text` remains what
   * gets inserted", and that was true when the field was added and false once
   * "Insert chart" shipped: `currentStatsSvg` (taskpane.ts) feeds `insertStatsChart()`
   * behind its own button. The comment outlived the behaviour,
   * and an audit read it as evidence that Stats figures could never reach a
   * document — which is exactly the cost of a stale comment.
   *
   * `text` is still what the main Insert button writes; the figure is a second,
   * separate insertion.
   */
  svg?: string;
  /**
   * v2.143.0: the same figure with significance brackets, built ONLY from this
   * result's own engine object (lib/statsBrackets.ts). Present on the two-sample
   * and paired t-tests, Mann–Whitney, Wilcoxon and Tukey HSD. `w` re-renders at a
   * canvas width, for the figure styles.
   */
  brackets?: (choice: BracketChoice, w?: number) => BracketFigure;
  /**
   * Release E2: results tables (the regression coefficients, diagnostics, the publication table). Each goes into
   * Word as a real table, in ONE package with the text and the figure; `note` is a line printed under its table
   * (the star legend). Cells pass the same insert gate as the text; a blank cell is "".
   */
  tables?: StatTable[];
}

/** A Stats results table: the first row is the header. */
export interface StatTable {
  label: string;
  rows: string[][];
  note?: string;
  /** Per-column cell alignment in Word (default: numbers right, words left). The regression table centres its models. */
  align?: ("left" | "center" | "right")[];
}

/** A piece of an Analyze result: a text line, a matrix (→ table), or a plot (→ image). */
export type AnalyzeBlock =
  | { kind: "line"; text: string }
  /**
   * A line that IS a formula, written in the pane's math syntax and inserted as
   * a real Word equation rather than as characters.
   *
   * This exists because a transfer function arriving in a document as
   * "G(s) = (s^3 + 3s^2 + 2s + 1)/(s^2 + 2s + 5)" is ASCII with carets, not a
   * formula — the same complaint that got Solve's derivations converted from
   * flat text to OMML. `fallback` is what a reader gets if the expression will
   * not parse, so an unusual result degrades to readable text rather than
   * failing the whole insert.
   */
  | { kind: "math"; math: string; fallback: string }
  | { kind: "matrix"; label?: string; m: Matrix }
  /**
   * A results table of text cells — the first row is the header, units in its cells ("Force (kN)") — inserted as a
   * real Word table (Release E: truss forces, reliability blocks, link budgets went in as padded text before).
   */
  | { kind: "table"; label?: string; rows: string[][] }
  | { kind: "plot"; svg: string; caption: string; alt: string; w: number; h: number };

/**
 * One named numeric result: its value in `unit` (the unit it is displayed in, as typeset: "kN", "MPa", "m²", "" for
 * a pure number). A parameter sweep or an uncertainty run reads these — a tool joins them only by declaring them;
 * nothing is ever scraped from the result text.
 */
export interface EngOutput {
  key: string;
  label: string;
  value: number;
  unit: string;
}

export interface AnalyzeOutput extends StatOutput {
  /** Structured blocks for rich insertion; when present, matrices and tables go in as Word tables. */
  blocks?: AnalyzeBlock[];
  /** Named numeric results, for sweeps and uncertainty (Engineering, Release E). */
  outputs?: EngOutput[];
}

/** A text table laid out in columns, for the preview and the plain-text form. */
export function formatTextTable(rows: string[][]): string {
  const len = (s: string): number => [...s].length;
  const n = Math.max(0, ...rows.map((r) => r.length));
  const width = Array.from({ length: n }, (_, j) => Math.max(0, ...rows.map((r) => len(r[j] ?? ""))));
  return rows
    .map((r) =>
      Array.from({ length: n }, (_, j) => (r[j] ?? "") + " ".repeat(width[j] - len(r[j] ?? "")))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Renders a block's text form (for the pane preview and the plain-text fallback). */
export function analyzeBlocksToText(blocks: AnalyzeBlock[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "line") return b.text;
      if (b.kind === "math") return b.fallback;
      if (b.kind === "plot") return b.caption;
      if (b.kind === "table") return (b.label ? `${b.label}\n` : "") + formatTextTable(b.rows);
      return (b.label ? `${b.label}\n` : "") + formatMatrix(b.m);
    })
    .join("\n");
}
