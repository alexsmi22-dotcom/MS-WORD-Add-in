// The four calculator tools share ONE field renderer.
//
// They used to have four near-identical copies, and the copies had already
// drifted: Finance and Assay had no branch for a `text` field or a textarea, so
// a field kind that renders correctly in Stats produced a plain numeric input
// there. Four copies guarantee that eventually.
//
// This pins the consolidation so it cannot quietly come apart again.

import * as fs from "fs";
import * as path from "path";

// Line endings are normalised on read: this checkout is CRLF, and a body scan
// anchored on a bare LF brace matched nothing and silently returned half the
// file — so the assertions below passed against the wrong text.
const PANE = fs
  .readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8")
  .replace(/\r\n/g, "\n");

const TOOLS = [
  { fn: "renderFinanceInputs", registry: "FIN_CALCS", prefix: '"fin"' },
  { fn: "renderStatsInputs", registry: "STAT_CALCS", prefix: '"stats"' },
  { fn: "renderAnalyzeInputs", registry: "ANALYZE_CALCS", prefix: '"analyze"' },
  { fn: "renderAssayInputs", registry: "ASSAY_CALCS", prefix: '"assay"' },
];

/** The body of a top-level function. */
function bodyOf(name: string): string {
  const i = PANE.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = PANE.indexOf("\n}\n", i);
  return PANE.slice(i, j);
}

describe("one renderer, four tools", () => {
  test("the shared renderer exists", () => {
    expect(PANE).toContain("function renderCalcFields(");
  });

  test.each(TOOLS)("$fn delegates to it", ({ fn, registry, prefix }) => {
    const body = bodyOf(fn);
    expect(body).toContain("renderCalcFields(");
    expect(body).toContain(registry);
    expect(body).toContain(prefix);
  });

  test.each(TOOLS)("$fn no longer builds inputs itself", ({ fn }) => {
    // The duplication this replaced: each copy created its own elements.
    const body = bodyOf(fn);
    expect(body).not.toContain('createElement("input")');
    expect(body).not.toContain('createElement("select")');
    expect(body).not.toContain('createElement("textarea")');
  });

  test("each tool keeps its own id prefix, so ids stay unique", () => {
    // The id-wiring audit depends on this; two tools sharing a prefix would
    // collide the moment they had a field with the same key.
    const prefixes = TOOLS.map((t) => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test("the renderer handles the union of field kinds, not one tool's subset", () => {
    const body = bodyOf("renderCalcFields");
    expect(body).toContain('f.kind === "select"');
    expect(body).toContain('f.kind === "text"');
    expect(body).toContain("MULTILINE_FIELD_KINDS");
    // `kind` is optional because Finance and Assay omit it on numeric fields.
    expect(PANE).toContain("kind?: string");
  });

  test("a list field does not get the single-numeral styling", () => {
    // It holds several numbers; num-numeral narrows and right-aligns the box.
    expect(bodyOf("renderCalcFields")).toContain('f.kind === "list" ? "rgroup-input"');
  });
});
