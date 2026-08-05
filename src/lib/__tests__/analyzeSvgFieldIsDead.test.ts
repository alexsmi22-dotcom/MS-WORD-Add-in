// `AnalyzeOutput.svg` compiles, and the Analyze pane ignores it.
//
// WHAT HAPPENED. `AnalyzeOutput extends StatOutput`, and StatOutput carries the
// optional `svg` that Statistics uses for its figures. So an Analyze calculator
// can return `{ text, svg }`, the compiler accepts it, and it looks exactly
// like the way to attach a chart — because in the registry next door it is.
//
// But `updateAnalyzePreview` renders `out.blocks` or `out.text` and nothing
// else, and the insert path follows the same branch. The correlation matrix in
// the `insights` calculator was built on every keystroke and discarded. No
// error, no failing test, no visible symptom other than the absence of a figure
// nobody knew to expect.
//
// It was caught only because the pane audit reported "insights: text-only"
// while the source plainly contained a chart. That is one layer deeper than
// "the tool is unreachable": the TOOL was reachable, the FIELD was not — the
// same shape as the recorded defect where a report of prose plus formulas fell
// through to plain text because the dispatch checked for the wrong block kinds.
//
// The rule: in Analyze, a figure is a `plot` BLOCK. This pins it.

import * as fs from "fs";
import * as path from "path";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

function registrySource(name: string): string {
  const start = PANE.indexOf(`const ${name}`);
  expect(start).toBeGreaterThan(0);
  const end = PANE.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return PANE.slice(start, end);
}

/** Entries of a calculator registry, sliced at each `id: "..."`. */
function entries(name: string): { id: string; body: string }[] {
  const src = registrySource(name);
  const hits: { id: string; at: number }[] = [];
  const re = /\bid: "([a-z0-9-]+)",/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) hits.push({ id: m[1], at: m.index });
  return hits.map((h, i) => ({
    id: h.id,
    body: src.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : src.length),
  }));
}

describe("an Analyze figure must be a plot block, never the inherited svg field", () => {
  test("the renderer still ignores svg, which is why this test exists", () => {
    // If Analyze ever learns to render `out.svg`, this file is obsolete rather
    // than wrong — so pin the branch that makes the field dead today.
    const i = PANE.indexOf("analyzeResult.innerHTML");
    expect(i).toBeGreaterThan(0);
    const branch = PANE.slice(i, i + 200);
    expect(branch).toContain("out.blocks");
    expect(branch).not.toContain("out.svg");
  });

  test("no ANALYZE_CALCS entry returns an svg property", () => {
    const offenders = entries("ANALYZE_CALCS")
      .filter((e) => {
        // `svg:` inside a plot block is correct — that is the supported route.
        // What is dead is `svg` as a property of the RETURNED OUTPUT, which
        // appears at the object's own indentation rather than inside a block.
        const withoutBlocks = e.body.replace(/\{\s*kind: "plot"[\s\S]*?\},/g, "");
        return /^\s{6,8}svg[,:]/m.test(withoutBlocks);
      })
      .map((e) => e.id);
    expect(offenders).toEqual([]);
  });

  test("the negative control: that scan can actually fail", () => {
    // Proving the check above is not vacuous. The first version of the
    // laundering test in a sibling file could only ever pass, and nobody
    // noticed until an adversarial pass simulated it by hand.
    const fake = `id: "x",\n    compute: () => {\n      return { text: "t", svg: chart };\n    },`;
    const withoutBlocks = fake.replace(/\{\s*kind: "plot"[\s\S]*?\},/g, "");
    expect(/^\s{6,8}svg[,:]/m.test(withoutBlocks)).toBe(false);
    // ...and on the shape that actually occurs (svg on its own line):
    const real = `      return {\n        text: "t",\n        svg: chart,\n      };`;
    expect(/^\s{6,8}svg[,:]/m.test(real)).toBe(true);
  });

  test("insights draws its correlation matrix through a plot block", () => {
    // The specific figure the defect ate, asserted by name so a refactor that
    // drops it fails loudly.
    const insights = entries("ANALYZE_CALCS").find((e) => e.id === "insights");
    expect(insights).toBeDefined();
    expect(insights!.body).toContain('kind: "plot"');
    expect(insights!.body).toContain("Correlation matrix");
  });

  test("Statistics is unaffected: its svg field is the supported route there", () => {
    // The mirror image, so nobody "fixes" Stats to match Analyze.
    const i = PANE.indexOf("statsResult.innerHTML");
    expect(i).toBeGreaterThan(0);
    expect(PANE.slice(i, i + 260)).toContain("out.svg");
  });
});
