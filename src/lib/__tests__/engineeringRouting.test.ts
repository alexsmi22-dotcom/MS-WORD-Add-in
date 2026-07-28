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
  { id: "control-tf", calls: ["analyzeStability(", "parseTf("], module: "../lib/control" },
  { id: "control-step", calls: ["timeResponse(", "secondOrderMetrics("], module: "../lib/control" },
  { id: "control-bode", calls: ["margins(", "frequencyResponse("], module: "../lib/control" },
  { id: "control-pid", calls: ["pidTf(", "feedback(", "series("], module: "../lib/control" },
  { id: "pk-dose", calls: ["singleDoseCurve("], module: "../lib/pk" },
  { id: "pk-steady", calls: ["steadyState(", "multipleDoseCurve("], module: "../lib/pk" },
  { id: "pk-nca", calls: ["nca(", "parseConcentrationData("], module: "../lib/pk" },
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

// ---------------------------------------------------------------------------
// THE UNIT CONTRACT.
//
// The Engineering tools had drifted into three different unit contracts, and
// the dangerous half was silent: column, torsion, pipe flow and the heat tools
// DECLARED strict SI and then accepted whatever was typed without checking. A
// declaration enforces nothing. The concrete trap that produced was inside the
// product — the cross-section tool reports I in mm^4 (as every section table
// does) and the column tool wanted m^4, so the most natural workflow in the
// whole section was wrong by 10^12 and said nothing.
//
// The rule now is: a tool converts units unless it is dimensionally homogeneous
// or computes over exact rationals, and EVERY tool declares which it is. These
// tests enforce the declaration, because the last thing to enforce it was a
// sentence in a hint.
// ---------------------------------------------------------------------------
const UNIT_NOTES = [
  "ENG_UNIT_NOTE",
  "ENG_SAME_UNIT_NOTE",
  "ENG_EXACT_UNIT_NOTE",
  "ENG_CONTROL_UNIT_NOTE",
  "ENG_PK_UNIT_NOTE",
] as const;

/** Which contract each tool is on, asserted rather than inferred. */
const CONTRACT: Record<string, (typeof UNIT_NOTES)[number]> = {
  beam: "ENG_EXACT_UNIT_NOTE",
  truss: "ENG_EXACT_UNIT_NOTE",
  section: "ENG_UNIT_NOTE",
  stress: "ENG_SAME_UNIT_NOTE",
  column: "ENG_UNIT_NOTE",
  torsion: "ENG_UNIT_NOTE",
  pipe: "ENG_UNIT_NOTE",
  wall: "ENG_UNIT_NOTE",
  hx: "ENG_UNIT_NOTE",
  "circuit-dc": "ENG_SAME_UNIT_NOTE",
  "circuit-ac": "ENG_SAME_UNIT_NOTE",
  "control-tf": "ENG_CONTROL_UNIT_NOTE",
  "control-step": "ENG_CONTROL_UNIT_NOTE",
  "control-bode": "ENG_CONTROL_UNIT_NOTE",
  "control-pid": "ENG_CONTROL_UNIT_NOTE",
  "pk-dose": "ENG_PK_UNIT_NOTE",
  "pk-steady": "ENG_PK_UNIT_NOTE",
  "pk-nca": "ENG_PK_UNIT_NOTE",
};

describe("every Engineering tool declares one unit contract", () => {
  test("the three declarations exist", () => {
    for (const n of UNIT_NOTES) expect(PANE).toContain(`const ${n} =`);
  });

  test.each(EXPECTED)("$id declares exactly one contract", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    const found = UNIT_NOTES.filter((n) => body.includes(n));
    // Exactly one: none means the tool says nothing about units, and more than
    // one means it contradicts itself in the same result.
    expect({ id, found }).toEqual({ id, found: [CONTRACT[id]] });
  });

  test("no tool is missing from the contract map", () => {
    const unlisted = ENG.map((e) => e.id).filter((id) => !(id in CONTRACT));
    expect(unlisted).toEqual([]);
  });

  // A tool that claims to convert must actually read its fields through the
  // unit layer. This is the assertion that would have caught the original bug:
  // column DECLARED SI and read with Number().
  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] === "ENG_UNIT_NOTE"))(
    "%s actually parses units rather than only claiming to",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      const parses = body.includes("engUnits(") || body.includes("parseMeasured(");
      expect({ id, parses }).toEqual({ id, parses: true });
    },
  );

  // The converse: a tool that says it does NOT convert must not quietly convert.
  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] !== "ENG_UNIT_NOTE"))(
    "%s does not convert behind its own declaration",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      expect({ id, converts: body.includes("engUnits(") }).toEqual({ id, converts: false });
    },
  );

  test("the shared reader exists and refuses a wrong-quantity unit", () => {
    // engUnits delegates the refusal to parseMeasured; pin that it is wired to
    // the error path rather than defaulting past it.
    expect(PANE).toContain("function engUnits(");
    const body = PANE.slice(PANE.indexOf("function engUnits("), PANE.indexOf("const ENG_UNIT_NOTE"));
    expect(body).toContain("parseMeasured(");
    expect(body).toContain("errors.push(");
  });

  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] === "ENG_UNIT_NOTE"))(
    "%s refuses when a field fails to parse, instead of computing on NaN",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      // Two legitimate shapes, and the property is the same either way: a parse
      // failure must be detected before the value is used.
      //   - The engUnits tools collect into u.errors and bail on it.
      //   - Cross-sections check `"error" in` inline and skip only the stress
      //     block, so a bad moment unit still returns the section properties
      //     rather than throwing all of it away. That is better behaviour, not
      //     a missing guard, so the test accepts it rather than forcing the
      //     tools to converge on one shape for its own sake.
      const guards =
        body.includes("u.errors.length") || body.includes("errors.length") || body.includes('"error" in');
      expect({ id, guards }).toEqual({ id, guards: true });
    },
  );
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
