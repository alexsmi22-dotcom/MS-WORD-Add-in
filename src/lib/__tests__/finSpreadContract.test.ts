/**
 * The Finance calculators that live in library registries (src/lib/*Calcs.ts, spread into the pane's FIN_CALCS),
 * held to the pane's contract (F1, v2.202.0). The source-scanning tests (analyzeCalcText, searchIndex, calcList) read
 * only the pane's inline entries; this file loads each spread registry from the module the pane imports it from and
 * RUNS it, the way updateFinancePreview does: number fields through readFinanceField first, then compute.
 *
 * Checked for every spread calculator: a unique id across the whole FIN_CALCS; a group in FIN_GROUP_ORDER; a name
 * that does not repeat its group; its defaults compute to an insertable result (not a refusal), whose table cells pass
 * the insert gate; and its module draws no Math.random (Monte Carlo goes through prng.ts, seeded).
 */
import * as fs from "fs";
import * as path from "path";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";
import { readingProblems } from "../calcReading";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
const BODY = (() => {
  const i = PANE.indexOf("const FIN_CALCS: FinCalc[] = [");
  if (i < 0) throw new Error("FIN_CALCS not found");
  return PANE.slice(i, PANE.indexOf("\n];", i));
})();

const INLINE_IDS = [...BODY.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);

const REGISTRIES = [...BODY.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].map((m) => {
  const name = m[1];
  const imp = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE);
  if (!imp) throw new Error(`the pane spreads ${name} but no import of it from ../lib was found`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(path.join(SRC, "lib", imp[1])) as Record<string, FinCalcDef[]>;
  if (!Array.isArray(mod[name])) throw new Error(`${imp[1]}.${name} is not an array`);
  return { name, file: imp[1], calcs: mod[name] };
});
const SPREAD = REGISTRIES.flatMap((r) => r.calcs.map((c) => ({ registry: r.name, file: r.file, c })));

/** The pane's read: number fields through the product's cell reader, everything else as typed. */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}

test("the spread hook is in FIN_CALCS (the place the F1 registries go)", () => {
  expect(BODY).toContain("F1 library registries");
  expect(INLINE_IDS.length).toBeGreaterThan(30);
});

test("every Finance id is unique across the inline and spread entries", () => {
  const all = [...INLINE_IDS, ...SPREAD.map((s) => s.c.id)];
  expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
});

const cases = SPREAD.map((s) => [`${s.registry} ${s.c.id}`, s] as const);
if (cases.length) {
  describe.each(cases)("%s", (_label, { c, file }) => {
    test("a known group, a name that does not repeat it, every field with a default", () => {
      expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
      expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
      for (const f of c.fields) expect(typeof f.default).toBe("string");
    });

    // "Fully inclusive" (2026-10-28): every result says what it means and draws a figure, not a table alone.
    test("its defaults carry a plain-language reading that keeps the rules (lib/calcReading.ts)", () => {
      const o = run(c);
      expect(typeof o).not.toBe("string");
      if (typeof o === "string") return;
      expect(readingProblems(o.reading)).toEqual([]);
    });

    test("its defaults draw a figure", () => {
      const o = run(c);
      expect(typeof o === "string" ? "" : (o.svg ?? "")).toMatch(/^<svg[\s>]/);
    });

    test("its defaults compute to an insertable result with insertable table cells", () => {
      const out = run(c);
      const o = typeof out === "string" ? { text: out } : out;
      expect(o.ok).not.toBe(false);
      expect(insertableResultText(o.text)).toBe(true);
      const tables = o.tables ?? (o.table ? [o.table] : []);
      for (const t of tables) {
        expect(t.rows.length).toBeGreaterThan(0);
        expect(t.rows[0].length).toBeLessThanOrEqual(6);
        for (const row of t.rows) for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    });

    test("its module draws no Math.random", () => {
      const src = fs.readFileSync(path.join(SRC, "lib", file + ".ts"), "utf8");
      expect(src).not.toMatch(/Math\.random\s*\(/);
    });
  });
}
