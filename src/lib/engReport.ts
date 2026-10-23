/**
 * An Engineering report: prose lines and marked formulas turned into result blocks, with the em-dash
 * sentinel cleaned out of every line, fallback and caption (moved out of taskpane.ts so it can be
 * tested: host-adapter scope §E).
 */
import { AnalyzeBlock, AnalyzeOutput, analyzeBlocksToText } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { toSuperscript } from "./units";

/**
 * Swaps em dashes for hyphens in prose destined for a Stats result.
 *
 * An em dash in the result text is the NON-FINITE sentinel (formatNum, linalg.ts)
 * and blocks insertion. Library caveats are written with em dashes because they
 * are prose; this normalises them so a valid result stays insertable, changing
 * the punctuation and never the wording.
 */
export function plainDashes(text: string): string {
  return text.replace(/\u2014/g, "-");
}

/**
 * One line of an Engineering report: prose, or a formula to be typeset.
 *
 * Marking the formulas rather than typesetting everything keeps the reports
 * readable — a result is mostly sentences with a few equations in it, and
 * pushing the prose through a math engine would be both wrong and ugly.
 */
export type EngLine = string | { math: string; fallback: string };

/**
 * A results table IN PLACE among the report's lines (Release E): first row the header, units in its cells. It goes
 * where the padded text lines used to be, not after the notes as an `extra` block would. Cells are cleaned like lines.
 */
export interface EngTableLine {
  table: string[][];
  label?: string;
}

/**
 * One table cell under the display contract: the em-dash sentinel cleaned, a true minus on negative numbers, and
 * e-notation written as ×10ⁿ (the pane's number formatter returns "1.2e-5" and "-3"; a table is new output and is
 * typeset). Hyphenated names ("A-B", "1-2") are left alone.
 */
export function engCell(text: string): string {
  const sci = text.replace(/(^|[^\w.])(-?\d+(?:\.\d+)?)[eE]([+-]?)(\d+)(?![\w.])/g, (_m, pre: string, mant: string, sg: string, ex: string) =>
    `${pre}${mant}×10${toSuperscript((sg === "-" ? "-" : "") + String(Number(ex)))}`,
  );
  return trueMinus(plainDashes(sci));
}

/**
 * A quantity / value / unit table — the form of the padded "  Flow     0.012 m³/s" summaries the tools printed —
 * with the unit in its own column. Rows whose value is not shown are left out by the caller.
 */
export function kvTable(rows: Array<[string, string, string]>, label?: string): EngTableLine {
  return { table: [["Quantity", "Value", "Unit"], ...rows], ...(label !== undefined ? { label } : {}) };
}

/** A report line: prose, a formula, or a table. */
export type EngReportLine = EngLine | EngTableLine;

/** Turns an Engineering report into blocks, typesetting the marked formulas. */
export function engReport(lines: EngReportLine[], extra: AnalyzeBlock[] = []): AnalyzeOutput {
  const blocks: AnalyzeBlock[] = lines.map((l): AnalyzeBlock =>
    typeof l === "string"
      ? { kind: "line" as const, text: plainDashes(l) }
      : "table" in l
        ? {
            kind: "table" as const,
            ...(l.label !== undefined ? { label: plainDashes(l.label) } : {}),
            rows: l.table.map((r) => r.map(engCell)),
          }
        : { kind: "math" as const, math: l.math, fallback: plainDashes(l.fallback) },
  );
  // A FIGURE'S CAPTION IS PART OF THE RESULT TEXT, and the insert guard scans
  // the whole of it for the em dash it uses as the non-finite sentinel. The
  // lines above were already cleaned and the captions were not, so one em dash
  // in a caption disabled Insert for a tool whose numbers were all fine. Every
  // caption every figure will ever carry goes through the same cleaning.
  blocks.push(
    ...extra.map((b) =>
      b.kind === "plot" ? { ...b, caption: plainDashes(b.caption), alt: plainDashes(b.alt) } : b,
    ),
  );
  return { blocks, text: analyzeBlocksToText(blocks) };
}
