// Stats-pane result text that used to be built inline in taskpane.ts (fix round 2, 2026-10-24), moved here so the
// display contract can be pinned by tests: the ignored-token warning, the regression report, a straight-line
// equation, the no-break-space list pre-pass and the uncertainty formula as displayed.

import { assaySig } from "./assayFormat";
import { formatP } from "./stats";
import { plainDashes } from "./engReport";
import { tidyDisplay } from "./subscriptText";

/**
 * The warning for list entries that were not numbers. Each token is shown in straight double quotes: the insert gate
 * blanks a quoted span before it looks for NaN/Infinity, so a user's literal "NaN" echoed back no longer makes a
 * valid result uninsertable (it did — the warning itself tripped the gate).
 */
export function droppedTokensNote(dropped: string[]): string {
  if (!dropped.length) return "";
  const distinct = [...new Set(dropped)];
  const shown = distinct.slice(0, 6).map((t) => `"${t.replace(/"/g, "'")}"`).join(", ");
  return (
    `⚠ ${dropped.length} non-numeric ${dropped.length === 1 ? "entry was" : "entries were"} ignored (${shown}` +
    `${distinct.length > 6 ? ", ..." : ""}). They are NOT counted in n, so check that this is what you meant.`
  );
}

/** "y = 1.98x − 1.98×10⁹": the sign carried by the operator, never "+ −", and no "·" before x. */
export function lineEquation(slope: number, intercept: number, y = "y", x = "x"): string {
  const b = intercept === 0 || Object.is(intercept, -0) ? "" : intercept < 0 ? ` − ${assaySig(-intercept)}` : ` + ${assaySig(intercept)}`;
  return `${y} = ${assaySig(slope)}${x}${b}`;
}

export interface RegressionReportInput {
  coefficients: { name: string; estimate: number; standardError: number; t: number; p: number }[];
  rSquared: number;
  adjustedRSquared: number;
  residualStandardError: number;
  f: number;
  dfModel: number;
  dfResidual: number;
  pOverall: number;
  n: number;
  caveats: string[];
  exactFit?: boolean;
}

/** The multiple/polynomial regression report. An exact fit says so instead of printing rounding noise as SE, t, F. */
export function regressionReport(res: RegressionReportInput): string {
  const lines: string[] = [];
  for (const c of res.coefficients) {
    lines.push(
      res.exactFit
        ? `${c.name} = ${assaySig(c.estimate)} (SE 0)`
        : `${c.name} = ${assaySig(c.estimate)} ± ${assaySig(c.standardError, 3)}  t = ${assaySig(c.t, 3)}, ${formatP(c.p)}`,
    );
  }
  lines.push("");
  if (res.exactFit) {
    lines.push("R² = 1 (exact fit: SE 0; t and F undefined)");
    lines.push(`Residual SE = 0 on ${res.dfResidual} df (n = ${res.n})`);
  } else {
    lines.push(`R² = ${assaySig(res.rSquared, 4)} · adjusted R² = ${assaySig(res.adjustedRSquared, 4)}`);
    lines.push(`Residual SE = ${assaySig(res.residualStandardError, 4)} on ${res.dfResidual} df (n = ${res.n})`);
    lines.push(`Overall F(${res.dfModel}, ${res.dfResidual}) = ${assaySig(res.f, 4)}, ${formatP(res.pOverall)}`);
  }
  lines.push("");
  lines.push(plainDashes(res.caveats.join("\n")));
  return lines.join("\n");
}

const NB = /[   ]/;
const NB_GROUPED = /^[-−]?\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?$/;

/**
 * No-break spaces (U+00A0, U+202F, U+2007) as list SEPARATORS, before the shared list reader sees the text. A paste
 * from Word or a web page often separates numbers with them, and "1 2 3 4" (no-break) was one unreadable token.
 * A no-break space INSIDE digit grouping ("1 200", "12 345,5") is still a thousands separator and is left alone.
 */
export function nbspSeparators(text: string): string {
  if (!NB.test(text)) return text;
  return text
    .split(/([ \t\n;,]+)/)
    .map((tok) => (NB.test(tok) && !NB_GROUPED.test(tok) ? tok.replace(/[   ]+/g, " ") : tok))
    .join("");
}

/** A typed uncertainty formula as displayed: "a^2" → "a²", "a*b" → "a·b", "-" as a true minus. */
export function displayFormula(formula: string): string {
  return tidyDisplay(formula.replace(/\s*\*\s*/g, "·"));
}
