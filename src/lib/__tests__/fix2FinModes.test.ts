/**
 * Fix round 2, Finance R3 MINOR 12 + 11: dropdown modes that refused their own defaults (loan-schedule m = 1, the
 * "prices" options, curve-bootstrap prices, the ipv-mc distribution switches) now carry per-option defaults
 * (FinField.modeDefaults), swapped in by modeDefaultSwaps when the select changes; the MACRS period selects say which
 * method reads them.
 */
import * as fs from "fs";
import * as path from "path";
import { modeDefaultSwaps, type FinCalcDef, type FinField, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { readingProblems } from "../calcReading";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
const BODY = (() => {
  const i = PANE.indexOf("const FIN_CALCS: FinCalc[] = [");
  return PANE.slice(i, PANE.indexOf("\n];", i));
})();
const ALL: FinCalcDef[] = [...BODY.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].flatMap((m) => {
  const name = m[1];
  const imp = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE)!;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require(path.join(SRC, "lib", imp[1])) as Record<string, FinCalcDef[]>)[name];
});

/** The pane's read, after switching select `key` to `value` the way the pane does (modeDefaultSwaps on the defaults). */
function runMode(c: FinCalcDef, key: string, value: string): FinResult {
  const sel = c.fields.find((f) => f.key === key)!;
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, modeDefaultSwaps(c.fields, sel, sel.default, value, (k) => vals[k]), { [key]: value });
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(vals[f.key]);
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? vals[k] ?? "");
}

// Options that refuse by design or need the user's own data: never a default to invent.
const ALLOWED: Record<string, string> = {
  "ipv-nash method=rule25": "the 25% rule is refused by name (Uniloc)",
  "dmg-lost-earnings-lpe table=user-qx": "asks for the user's own life table",
  "dmg-lost-earnings-lpe table=user-lx": "asks for the user's own life table",
  "act-annuity table=user-qx": "asks for the user's own life table",
  "act-annuity table=user-lx": "asks for the user's own life table",
  "act-swr-mc table=user-qx": "asks for the user's own life table",
  "act-swr-mc table=user-lx": "asks for the user's own life table",
  "curve-bootstrap freq=1": "annual coupons need a whole-year grid; the 0.5-year par row is refused by name (a combined mode × frequency default is not offered)",
};

describe("every select option computes from its own defaults", () => {
  const cases: [string, FinCalcDef, string, string][] = [];
  for (const c of ALL) for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) if (o.value !== f.default) cases.push([`${c.id} ${f.key}=${o.value}`, c, f.key, o.value]);
  test.each(cases)("%s", (name, c, key, value) => {
    const r = runMode(c, key, value);
    const refused = typeof r !== "string" && r.ok === false;
    if (ALLOWED[name]) return;
    expect(refused ? r.text : "").toBe("");
    if (typeof r !== "string" && r.reading) expect(readingProblems(r.reading)).toEqual([]);
  });
});

describe("the reviewer's repros", () => {
  const calc = (id: string): FinCalcDef => ALL.find((c) => c.id === id)!;
  test.each([
    ["loan-schedule", "m", "1"],
    ["port-capm", "input", "prices"],
    ["port-performance", "input", "prices"],
    ["port-var", "input", "prices"],
    ["port-frontier", "input", "prices"],
    ["curve-bootstrap", "mode", "prices"],
    ["ipv-mc", "revdist", "logn"],
    ["ipv-mc", "revdist", "fixed"],
    ["ipv-mc", "ratedist", "fixed"],
    ["ipv-mc", "lifedist", "logn"],
    ["ipv-mc", "discdist", "tri"],
    ["ipv-mc", "discdist", "fixed"],
  ])("%s %s=%s computes", (id, key, value) => {
    const r = runMode(calc(id), key, value);
    expect(typeof r === "string" || r.ok !== false).toBe(true);
  });
});

describe("modeDefaultSwaps never overwrites what the user typed", () => {
  const fields: FinField[] = [
    { key: "kind", label: "Kind", default: "a", kind: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], modeDefaults: { b: { x: "B-x" } } },
    { key: "x", label: "X", default: "A-x" },
    { key: "y", label: "Y", default: "y" },
  ];
  const sel = fields[0];
  test("a field still at the previous default swaps; back again it returns", () => {
    expect(modeDefaultSwaps(fields, sel, "a", "b", () => "A-x")).toEqual({ x: "B-x" });
    expect(modeDefaultSwaps(fields, sel, "b", "a", () => "B-x")).toEqual({ x: "A-x" });
    // line endings and outer spaces do not count as an edit
    expect(modeDefaultSwaps(fields, sel, "a", "b", () => " A-x\r\n")).toEqual({ x: "B-x" });
  });
  test("an edited field, an unchanged select and a field not named are left alone", () => {
    expect(modeDefaultSwaps(fields, sel, "a", "b", () => "typed")).toEqual({});
    expect(modeDefaultSwaps(fields, sel, "a", "a", () => "A-x")).toEqual({});
    expect(modeDefaultSwaps(fields, fields[1], "a", "b", () => "A-x")).toEqual({});
  });
  test("the pane wires it once, on the Finance fields, and recomputes after a swap", () => {
    const at = PANE.indexOf("function renderFinanceInputs(): void {");
    const body = PANE.slice(at, PANE.indexOf("\n}\n", at));
    expect(body).toMatch(/modeDefaultSwaps\(calc\.fields, f, prev, sel\.value, read\)/);
    expect(body).toMatch(/updateFinancePreview\(\);/);
    expect(body).toMatch(/if \(sel\.value === prev\) return;/);
  });
});

describe("R3 MINOR 11: the MACRS period selects say which method reads them", () => {
  const m = ALL.find((c) => c.id === "macrs")!;
  test("labels", () => {
    expect(m.fields.find((f) => f.key === "class")!.label).toMatch(/GDS declining balance only/);
    expect(m.fields.find((f) => f.key === "slperiod")!.label).toMatch(/straight line only, not with GDS/);
  });
});
