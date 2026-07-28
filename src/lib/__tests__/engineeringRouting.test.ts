// The Engineering pane must be able to REACH every engine it claims to offer.
//
// This test exists because of a real failure mode this repo has already hit:
// three Solve features were fully implemented and fully unit-tested while the
// pane could not reach any of them. A green engine suite says the mathematics
// is right. It says nothing about whether a person clicking through the task
// pane ever gets to run it, and "tested" is exactly the word that stops anyone
// checking.
//
// taskpane.ts cannot be imported here — it pulls in Office.js at module scope —
// so the check is a source scan, which is the convention the other pane tests
// use. It is a weaker check than executing the compute, and it is deliberately
// written to fail loudly if the registry it scans ever stops being found, so it
// cannot pass vacuously.

import * as fs from "fs";
import * as path from "path";

const PANE = fs
  .readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8")
  .replace(/\r\n/g, "\n");

function registrySource(name: string): string {
  const start = PANE.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} not found in taskpane.ts`);
  const end = PANE.indexOf("\n];", start);
  if (end < 0) throw new Error(`end of ${name} not found`);
  return PANE.slice(start, end);
}

/** Entries of the registry, sliced at each `id: "..."`. */
function entries(name: string): { id: string; body: string }[] {
  const src = registrySource(name);
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

const ENG = entries("ENG_CALCS");

/** Every tool the Engineering pane offers, and the engine each one must call. */
const EXPECTED: { id: string; calls: string[]; module: string }[] = [
  { id: "beam", calls: ["analyzeBeam("], module: "../lib/beam" },
  { id: "section", calls: ["sectionProperties("], module: "../lib/section" },
  { id: "circuit-dc", calls: ["solveDc("], module: "../lib/circuit" },
  { id: "circuit-ac", calls: ["solveAc(", "frequencySweep("], module: "../lib/circuit" },
  { id: "stress", calls: ["analyzeStress("], module: "../lib/stress" },
  { id: "truss", calls: ["analyzeTruss(", "parseTruss("], module: "../lib/truss" },
  { id: "column", calls: ["analyzeColumn("], module: "../lib/stress" },
  { id: "torsion", calls: ["analyzeTorsion("], module: "../lib/stress" },
  { id: "pipe", calls: ["analyzePipe("], module: "../lib/fluids" },
  { id: "wall", calls: ["analyzeWall("], module: "../lib/heat" },
  { id: "hx", calls: ["analyzeExchanger("], module: "../lib/heat" },
];

describe("the scan is not vacuous", () => {
  test("the registry was found and has entries", () => {
    expect(ENG.length).toBeGreaterThanOrEqual(EXPECTED.length);
  });

  test("the pane still builds the Engineering menu from this registry", () => {
    // If the select is ever populated from a second, hand-written list, adding a
    // calc here would silently not appear — the exact drift modes.ts was created
    // to end. Pin the loop that reads the registry.
    expect(PANE).toContain("for (const c of ENG_CALCS)");
    expect(PANE).toContain("engineeringCalcSelect");
  });

  test("selection and compute both resolve against the registry", () => {
    // Both the field renderer and the compute path must look the tool up in
    // ENG_CALCS; a hardcoded index in either is how a tool becomes unreachable.
    const hits = PANE.split("ENG_CALCS.find((c) => c.id === engineeringCalcSelect.value)").length - 1;
    expect(hits).toBe(2);
  });
});

describe("every Engineering tool is reachable and wired to its engine", () => {
  test.each(EXPECTED)("$id is present in the registry", ({ id }) => {
    expect(ENG.map((e) => e.id)).toContain(id);
  });

  test.each(EXPECTED)("$id calls its engine rather than reimplementing it", ({ id, calls }) => {
    const entry = ENG.find((e) => e.id === id);
    expect(entry).toBeDefined();
    for (const c of calls) {
      expect(entry!.body).toContain(c);
    }
  });

  test.each(EXPECTED)("$id's engine module is imported by the pane", ({ module }) => {
    expect(PANE).toContain(`from "${module}"`);
  });

  test("no tool in the registry is missing from this test's list", () => {
    // Without this, a new calc could be added and never routing-checked — the
    // list above would go stale exactly the way the old hand-written MODES array
    // did, and every test here would still pass.
    const known = new Set(EXPECTED.map((e) => e.id));
    const unlisted = ENG.map((e) => e.id).filter((id) => !known.has(id));
    expect(unlisted).toEqual([]);
  });
});

describe("every Engineering tool declares its inputs and can produce a result", () => {
  test.each(EXPECTED)("$id has a name, a hint, fields and a compute", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    expect(body).toMatch(/\bname:\s*"/);
    expect(body).toMatch(/\bhint:/);
    expect(body).toMatch(/\bfields:\s*\[/);
    expect(body).toMatch(/\bcompute:\s*\(/);
  });

  test.each(EXPECTED)("$id declares at least one field with a default", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    // A tool whose fields array is empty renders an empty panel and can never
    // be driven from the pane, however good its engine is.
    expect(body).toMatch(/key:\s*"[^"]+",\s*label:/);
    expect(body).toMatch(/default:/);
  });

  test.each(EXPECTED)("$id reads every field key it declares", ({ id }) => {
    // A field whose key is never read back is dead chrome: the user types into
    // it and nothing changes. This catches a rename made on one side only.
    //
    // The check counts occurrences of the quoted key rather than looking for a
    // literal r("key"), because the computes legitimately read through local
    // helpers — num("rho", NaN) is a read, and an earlier version of this test
    // reported it as dead. One occurrence is the declaration; a field that is
    // ever used appears at least twice.
    const body = ENG.find((e) => e.id === id)!.body;
    const declared = [...body.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const unread = declared.filter((k) => body.split(`"${k}"`).length - 1 < 2);
    expect(unread).toEqual([]);
  });
});

describe("the em-dash sentinel cannot disable Insert on an Engineering result", () => {
  // formatNum() renders a non-finite number as an em dash and the pane blocks
  // insertion when it sees one anywhere in the result text. Library caveats are
  // written with em dashes because they are prose, so every compute must pass
  // its assembled text through plainDashes() before returning it. Missing that
  // call does not fail anything — the Insert button just quietly stops working.
  test.each(EXPECTED)("$id normalises its result text", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    expect(body).toContain("plainDashes");
  });

  test("the guard this defends is still in place", () => {
    // If the pane stops scanning for the sentinel, this suite is obsolete rather
    // than wrong — so pin the thing it is protecting.
    expect(PANE).toContain("function plainDashes(");
    expect(PANE).toContain("\\u2014");
  });
});
