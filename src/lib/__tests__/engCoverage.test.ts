// Release E gaps #13 and #14, as a ratchet: how many of the pane's literal Engineering tools declare named outputs
// (the sweep and uncertainty runs read nothing else), how many show their governing equations as real Word equations,
// and how many results tables are real table blocks. The floors only go up. Every output key is unique within its tool.
//
// taskpane.ts cannot be imported (Office.js at module scope), so this is a source scan of ENG_CALCS, the convention of
// engineeringRouting.test.ts.
import * as fs from "fs";
import * as path from "path";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

function entries(): { id: string; body: string }[] {
  const start = PANE.indexOf("const ENG_CALCS");
  if (start < 0) throw new Error("ENG_CALCS not found in taskpane.ts");
  const end = PANE.indexOf("\n];", start);
  const src = PANE.slice(start, end);
  const hits = [...src.matchAll(/\n    id: "([a-z0-9-]+)",/g)].map((m) => ({ id: m[1], at: m.index ?? 0 }));
  return hits.map((h, i) => ({ id: h.id, body: src.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : src.length) }));
}

const ENG = entries();

/** The `{ key: "…", label: …, value: …, unit: … }` objects inside a tool's outputs arrays (not its fields). */
function outputKeys(body: string): string[] {
  const keys: string[] = [];
  for (const m of body.matchAll(/\{\s*key: "([^"]+)",\s*label: [^{}]*?,\s*value: /g)) keys.push(m[1]);
  return keys;
}

const withOut = ENG.filter((e) => outputKeys(e.body).length > 0);
const withMath = ENG.filter((e) => /\bengEq\("/.test(e.body) || /\{\s*math: /.test(e.body));
const withTable = ENG.filter((e) => /\btable: \[/.test(e.body) || /\bkvTable\(/.test(e.body));

// Tools whose result is not a headline number (or whose method is an algorithm with no single formula) are listed in
// the Release E report; these floors are what the release reached.
const FLOORS = { tools: 153, outputs: 152, math: 142, tables: 85 };

describe("Engineering coverage ratchet (Release E)", () => {
  test("the registry is found and has every literal tool", () => {
    expect(ENG.length).toBeGreaterThanOrEqual(FLOORS.tools);
  });
  test(`at least ${FLOORS.outputs} tools declare named outputs`, () => {
    expect(withOut.length).toBeGreaterThanOrEqual(FLOORS.outputs);
  });
  test(`at least ${FLOORS.math} tools show governing equations`, () => {
    expect(withMath.length).toBeGreaterThanOrEqual(FLOORS.math);
  });
  test(`at least ${FLOORS.tables} tools emit real results tables`, () => {
    expect(withTable.length).toBeGreaterThanOrEqual(FLOORS.tables);
  });
  test.each(withOut.map((e) => [e.id, e.body] as const))("%s: output keys are unique, and never a field key", (_id, body) => {
    const keys = outputKeys(body);
    expect(keys.length).toBe(new Set(keys).size);
    const fields = [...body.matchAll(/\{\s*key: "([^"]+)",\s*label: [^\n]*?,\s*default: /g)].map((m) => m[1]);
    // An output named like a field would let the handoff test pass on the field alone.
    expect(keys.filter((k) => fields.includes(k))).toEqual([]);
  });
});
