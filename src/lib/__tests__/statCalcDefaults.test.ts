// Every calculator's shipped default must actually produce a result.
//
// The One-way ANOVA default was "1 2 3\n4 5 6\n7 8 9" — but statGroups() splits
// on a BLANK line or a semicolon, so that collapsed to a single group of nine
// numbers and the calculator opened showing "Enter at least two groups" instead
// of a worked example. It had presumably always done that. The same mistake was
// made again while wiring Tukey HSD, which is why this guard exists: a default is
// the first thing a user sees in a tool, and nothing was checking them.
//
// taskpane.ts imports Office and cannot be loaded here, so this reads it as text
// and replays the same splitting rule. Narrow, but it pins the property that broke.

import * as fs from "fs";
import * as path from "path";

const PANE = fs.readFileSync(
  path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"),
  "utf8",
);

/** The real statGroups() from taskpane.ts, replayed. */
function statGroups(s: string): number[][] {
  return s
    .split(/\n\s*\n|;/)
    .map((g) => g.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)))
    .filter((g) => g.length > 0);
}

/** Decodes the TypeScript string-literal escapes that appear in defaults. */
function decode(literal: string): string {
  return literal.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}

/**
 * The STAT_CALCS array only.
 *
 * Slicing the whole file by `id:` swallowed the code BETWEEN registries: the last
 * Finance entry's slice ran on into the Stats helpers, picked up the statGroups
 * definition, and reported a Finance calculator as a broken groups default.
 * Bounding the scan to the array is what makes "this default belongs to this
 * parser" true.
 */
function statCalcsSource(): string {
  const start = PANE.indexOf("const STAT_CALCS: StatCalc[] = [");
  if (start < 0) throw new Error("STAT_CALCS not found in taskpane.ts");
  const end = PANE.indexOf("\n];", start);
  if (end < 0) throw new Error("end of STAT_CALCS not found");
  return PANE.slice(start, end);
}

function calcEntries(): { id: string; body: string }[] {
  const src = statCalcsSource();
  const out: { id: string; body: string }[] = [];
  const re = /\bid: "([a-z0-9-]+)",/g;
  const hits: { id: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) hits.push({ id: m[1], at: m.index });
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
    out.push({ id: hits[i].id, body: src.slice(hits[i].at, end) });
  }
  return out;
}

const entries = calcEntries();

describe("Stats calculator defaults produce a result, not a validation error", () => {
  test("the scan finds the Stats calculators and nothing else", () => {
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("anova");
    expect(ids).toContain("tukey");
    expect(ids).toContain("descriptive");
    expect(ids).not.toContain("returns"); // a Finance entry — outside the array
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  test("every default parsed by statGroups yields at least two groups", () => {
    // Only entries whose compute actually calls statGroups are relevant. chiind
    // and twoway use their own row parsers and legitimately use single newlines.
    const offenders: string[] = [];
    let checked = 0;
    for (const e of entries) {
      if (!/statGroups\(/.test(e.body)) continue;
      const d = /default: "((?:[^"\\]|\\.)*)"/.exec(e.body);
      if (!d) continue;
      checked++;
      const groups = statGroups(decode(d[1]));
      if (groups.length < 2) {
        offenders.push(
          `${e.id}: default splits into ${groups.length} group(s) — needs a blank line or ";" between groups`,
        );
      }
    }
    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(2); // anova and tukey at minimum
  });

  test("every group in those defaults has enough values to compute", () => {
    // Both ANOVA and Tukey require at least two values per group.
    const offenders: string[] = [];
    for (const e of entries) {
      if (!/statGroups\(/.test(e.body)) continue;
      const d = /default: "((?:[^"\\]|\\.)*)"/.exec(e.body);
      if (!d) continue;
      const groups = statGroups(decode(d[1]));
      const thin = groups.filter((g) => g.length < 2).length;
      if (thin > 0) offenders.push(`${e.id}: ${thin} group(s) with fewer than 2 values`);
    }
    expect(offenders).toEqual([]);
  });

  test("the replayed splitter still matches the one in the pane", () => {
    // If statGroups changes shape in taskpane.ts this test measures the wrong
    // thing, so pin the source it is imitating.
    expect(PANE).toContain("function statGroups(s: string): number[][] {");
    expect(PANE).toContain(".split(/\\n\\s*\\n|;/)");
  });

  test("the guard fails on the shape that shipped", () => {
    // Proof this test can catch the original bug: the old ANOVA default.
    expect(statGroups(decode("1 2 3\\n4 5 6\\n7 8 9")).length).toBe(1);
    expect(statGroups(decode("1 2 3\\n\\n4 5 6\\n\\n7 8 9")).length).toBe(3);
  });
});
