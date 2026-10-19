/**
 * An Engineering report: prose lines and marked formulas turned into result blocks, with the em-dash
 * sentinel cleaned out of every line, fallback and caption (moved out of taskpane.ts so it can be
 * tested: host-adapter scope §E).
 */
import { AnalyzeBlock, AnalyzeOutput, analyzeBlocksToText } from "./analyzeBlocks";

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

/** Turns an Engineering report into blocks, typesetting the marked formulas. */
export function engReport(lines: EngLine[], extra: AnalyzeBlock[] = []): AnalyzeOutput {
  const blocks: AnalyzeBlock[] = lines.map((l) =>
    typeof l === "string"
      ? { kind: "line" as const, text: plainDashes(l) }
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
