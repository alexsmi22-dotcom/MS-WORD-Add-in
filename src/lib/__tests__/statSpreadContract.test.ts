/**
 * The Stats calculators that live in library registries (src/lib/*StatCalcs.ts, spread into the pane's STAT_CALCS),
 * held to the pane's contract (F2, v2.203.0) — the Stats counterpart of finSpreadContract.test.ts. The pane passes
 * Stats fields to compute AS TYPED (updateStatsPreview: no number pre-read), so the defaults run raw here.
 *
 * Checked for every spread calculator: a unique id across the whole STAT_CALCS; its defaults compute to an insertable
 * result (not a refusal) whose tables have at most six columns and insertable cells; every select default is one of
 * its options; and its module draws no Math.random (Monte Carlo goes through prng.ts, seeded).
 */
import * as fs from "fs";
import * as path from "path";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
const BODY = (() => {
  const i = PANE.indexOf("const STAT_CALCS: StatCalc[] = [");
  if (i < 0) throw new Error("STAT_CALCS not found");
  return PANE.slice(i, PANE.indexOf("\n];", i));
})();

const INLINE_IDS = [...BODY.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);

const REGISTRIES = [...BODY.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].map((m) => {
  const name = m[1];
  const imp = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE);
  if (!imp) throw new Error(`the pane spreads ${name} but no import of it from ../lib was found`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(path.join(SRC, "lib", imp[1])) as Record<string, StatCalcDef[]>;
  if (!Array.isArray(mod[name])) throw new Error(`${imp[1]}.${name} is not an array`);
  return { name, file: imp[1], calcs: mod[name] };
});
const SPREAD = REGISTRIES.flatMap((r) => r.calcs.map((c) => ({ registry: r.name, file: r.file, c })));

/** The pane's read: every field as typed. */
function run(c: StatCalcDef, over: Record<string, string> = {}): StatOutput {
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
}

test("the spread hook is in STAT_CALCS (the place the F2 registries go)", () => {
  expect(BODY).toContain("F2 library registries");
  expect(INLINE_IDS.length).toBeGreaterThan(30);
});

test("every Stats id is unique across the inline and spread entries", () => {
  const all = [...INLINE_IDS, ...SPREAD.map((s) => s.c.id)];
  expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
});

const cases = SPREAD.map((s) => [`${s.registry} ${s.c.id}`, s] as const);
if (cases.length) {
  describe.each(cases)("%s", (_label, { c, file }) => {
    test("every field has a default; a select's default is one of its options", () => {
      for (const f of c.fields) {
        expect(typeof f.default).toBe("string");
        if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
      }
    });

    test("its defaults compute to an insertable result with insertable table cells", () => {
      const o = run(c);
      expect(o.ok).not.toBe(false);
      expect(insertableResultText(o.text)).toBe(true);
      for (const t of o.tables ?? []) {
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
