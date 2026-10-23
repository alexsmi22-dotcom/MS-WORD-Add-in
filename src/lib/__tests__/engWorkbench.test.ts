// Release E items 4 and 13: the Engineering workbench — handoffs, shared fields, parameter sweeps and uncertainty —
// exercised on synthetic tools with known answers. Oracle: closed forms (y = a·b: GUM u = √((b·u_a)² + (a·u_b)²);
// for a = 10 ± 0.5, b = 4 ± 0.2 that is √8 = 2.8284; numpy draws of a·b give sd ≈ 2.83, mean ≈ 40.01).
import type { AnalyzeOutput } from "../analyzeBlocks";
import { carryOver, fieldText, handoffsFor, runSweep, runUncertainty, splitValue } from "../engWorkbench";
import { parseMeasured } from "../units";

/** y = a·b with a in metres (converted) and b plain; refuses a ≤ 0. */
const product = (r: (k: string) => string): AnalyzeOutput => {
  const am = parseMeasured(r("a"), "m");
  const b = Number(r("b"));
  if ("error" in am) return { text: am.error, ok: false };
  if (!(am.inTarget > 0)) return { text: "a must be positive.", ok: false };
  const y = am.inTarget * b;
  return { text: `y = ${y}`, outputs: [{ key: "y", label: "Product", value: y, unit: "m" }] };
};
const fields: Record<string, string> = { a: "10 m", b: "4" };
const read = (k: string): string => fields[k] ?? "";

describe("splitValue / fieldText", () => {
  test("numbers with and without units, true minus, e-notation", () => {
    expect(splitValue("12 kN")).toEqual({ value: 12, unit: "kN" });
    expect(splitValue("−3.5e-3 m^2")).toEqual({ value: -0.0035, unit: "m^2" });
    expect(splitValue("7")).toEqual({ value: 7, unit: "" });
    expect(splitValue("kN 12")).toBeNull();
  });
  test("a typeset unit is written back in the form the field parser reads", () => {
    expect(fieldText(1.5, "kN·m")).toBe("1.5 kN*m");
    expect(fieldText(2e-6, "m⁴")).toBe("0.000002 m^4");
    expect(fieldText(50e6, "Pa·√m")).toBe("50000000 Pa*m^0.5");
    const back = parseMeasured(fieldText(2e-6, "m⁴"), "mm^4");
    expect("error" in back ? NaN : back.inTarget).toBeCloseTo(2e6, 3);
  });
});

describe("handoffs", () => {
  const table = [{ from: "prod", output: "y", to: "other", field: "len", label: "Use y in Other" }];
  test("offered only for outputs the result produced", () => {
    expect(handoffsFor("prod", product(read), table).map((h) => [h.to, h.field, h.value.value])).toEqual([["other", "len", 40]]);
    expect(handoffsFor("prod", product((k) => (k === "a" ? "-1 m" : read(k))), table)).toEqual([]);
    expect(handoffsFor("elsewhere", product(read), table)).toEqual([]);
  });
});

describe("shared fields", () => {
  const sets = [{ tools: ["t1", "t2", "t3"], keys: ["num", "den"] }];
  test("only shared keys the user changed are carried, only between tools of the set", () => {
    expect(carryOver("t1", "t2", { num: "1", den: "1 2 5", k: "3" }, { num: "1", den: "1 3 2", k: "1" }, sets)).toEqual({ den: "1 2 5" });
    expect(carryOver("t1", "x", { den: "1 2 5" }, { den: "1 3 2" }, sets)).toEqual({});
    expect(carryOver("t1", "t1", { den: "1 2 5" }, { den: "1 3 2" }, sets)).toEqual({});
  });
});

describe("parameter sweep", () => {
  test("linear sweep through the tool's own unit reading (mm into a metres field)", () => {
    const r = runSweep(product, read, { field: "a", from: "1000 mm", to: "3000 mm", points: 3, log: false, output: "y" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xs).toEqual([1000, 2000, 3000]);
    expect(r.ys.map((v) => +v.toFixed(9))).toEqual([4, 8, 12]);
    expect(r.unit).toBe("mm");
  });
  test("log sweep spacing", () => {
    const r = runSweep(product, read, { field: "a", from: "1 m", to: "100 m", points: 3, log: true, output: "y" });
    expect(r.ok && r.xs.map((v) => +v.toFixed(9))).toEqual([1, 10, 100]);
  });
  test("refused points are NaN and named, not dropped", () => {
    const r = runSweep(product, read, { field: "a", from: "-1 m", to: "1 m", points: 3, log: false, output: "y" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ys[0]).toBeNaN();
    expect(r.ys[1]).toBeNaN();
    expect(r.ys[2]).toBe(4);
    expect(r.refused[0].reason).toMatch(/positive/);
  });
  test("named refusals for a bad request", () => {
    const bad = (req: Partial<Parameters<typeof runSweep>[2]>): string => {
      const r = runSweep(product, read, { field: "a", from: "1 m", to: "2 m", points: 5, log: false, output: "y", ...req });
      return r.ok ? "ok" : r.reason;
    };
    expect(bad({ to: "2 mm" })).toMatch(/same unit/);
    expect(bad({ points: 1 })).toMatch(/2 to 41/);
    expect(bad({ points: 500 })).toMatch(/2 to 41/);
    expect(bad({ to: "1 m" })).toMatch(/nothing to sweep/);
    expect(bad({ from: "-1 m", log: true })).toMatch(/greater than zero/);
    expect(bad({ output: "zz" })).toMatch(/no zz/);
    expect(bad({ from: "abc" })).toMatch(/numbers/);
  });
});

describe("uncertainty", () => {
  test("a·b: first-order u matches the closed form; the draws agree with it", () => {
    const r = runUncertainty(product, read, [{ field: "a", u: 0.5, relative: false }, { field: "b", u: 5, relative: true }], "y", 2000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gum.u).toBeCloseTo(Math.sqrt(8), 6);
    expect(r.gum.shares.map((s) => +s.share.toFixed(6))).toEqual([0.5, 0.5]);
    expect(r.mean).toBeGreaterThan(39.7);
    expect(r.mean).toBeLessThan(40.3);
    expect(r.sd).toBeGreaterThan(2.6);
    expect(r.sd).toBeLessThan(3.05);
    expect(r.lo).toBeLessThan(r.mean);
    expect(r.hi).toBeGreaterThan(r.mean);
    expect(r.draws).toBe(2000);
  });
  test("reproducible: the same seed gives the same draws", () => {
    const a = runUncertainty(product, read, [{ field: "a", u: 0.5, relative: false }], "y", 200);
    const b = runUncertainty(product, read, [{ field: "a", u: 0.5, relative: false }], "y", 200);
    expect(a.ok && b.ok && a.mean === b.mean).toBe(true);
  });
  test("draws the tool refuses are counted, not used", () => {
    const r = runUncertainty(product, (k) => (k === "a" ? "0.3 m" : read(k)), [{ field: "a", u: 0.3, relative: false }], "y", 400);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.refused).toBeGreaterThan(20);
    expect(r.sorted[0]).toBeGreaterThan(0);
  });
  test("named refusals", () => {
    expect(runUncertainty(product, read, [], "y", 100)).toMatchObject({ ok: false });
    expect(runUncertainty(product, read, [{ field: "a", u: -1, relative: false }], "y", 100)).toMatchObject({ ok: false });
    expect(runUncertainty(product, read, [{ field: "a", u: 1, relative: false }], "zz", 100)).toMatchObject({ ok: false });
  });
});

// The real tables, against the pane's source: every handoff names real tools, a target field that exists, and an output
// key its source tool declares; every shared-field set names real tools that all have those keys.
import * as fs from "fs";
import * as path from "path";
import { ENG_HANDOFFS, SHARED_FIELD_SETS } from "../engWorkbench";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const LIB = path.join(__dirname, "..");
/** A tool's source: its pane entry, or its entry in a lib registry. */
function toolSource(id: string): string | null {
  const find = (src: string): string | null => {
    const i = src.indexOf(`id: "${id}",`);
    if (i < 0) return null;
    const next = src.indexOf('\n    id: "', i + 10);
    const nextLib = src.indexOf('\n  id: "', i + 10);
    const ends = [next, nextLib].filter((x) => x > 0);
    return src.slice(i, ends.length ? Math.min(...ends) : src.length);
  };
  const pane = find(PANE);
  if (pane) return pane;
  for (const f of fs.readdirSync(LIB).filter((n) => /Calcs\.ts$/.test(n))) {
    const hit = find(fs.readFileSync(path.join(LIB, f), "utf8"));
    if (hit) return hit;
  }
  return null;
}

describe("the handoff and shared-field tables name real tools, fields and outputs", () => {
  test.each(ENG_HANDOFFS.map((h) => [`${h.from}.${h.output} → ${h.to}.${h.field}`, h] as const))("%s", (_n, h) => {
    const from = toolSource(h.from), to = toolSource(h.to);
    expect({ from: !!from, to: !!to }).toEqual({ from: true, to: true });
    expect(to).toContain(`key: "${h.field}"`);
    expect(from).toMatch(new RegExp(`key: "${h.output}"`));
  });
  test.each(SHARED_FIELD_SETS.flatMap((s) => s.tools.map((t) => [t, s.keys] as const)))("%s has the shared keys", (t, keys) => {
    const src = toolSource(t);
    expect(src).not.toBeNull();
    for (const k of keys) expect(src).toContain(`key: "${k}"`);
  });
});
