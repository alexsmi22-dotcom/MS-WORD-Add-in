/**
 * Every Stats calculator — the pane's inline STAT_CALCS entries and every library registry spread into it — has a
 * dropdown heading (lib/statGroups.ts). Without one it would sit under "Other" (F2, v2.203.0).
 */
import * as fs from "fs";
import * as path from "path";
import { STAT_GROUP_ORDER, statGroupOf } from "../statGroups";
import type { StatCalcDef } from "../statCalc";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
const BODY = (() => {
  const i = PANE.indexOf("const STAT_CALCS: StatCalc[] = [");
  return PANE.slice(i, PANE.indexOf("\n];", i));
})();
const INLINE = [...BODY.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);
const SPREAD = [...BODY.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].flatMap((m) => {
  const imp = new RegExp(`import \\{[^}]*\\b${m[1]}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE)!;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require(path.join(SRC, "lib", imp[1]))[m[1]] as StatCalcDef[]).map((c) => c.id);
});

test("every Stats calculator has a group", () => {
  expect(INLINE.length).toBeGreaterThan(40);
  expect([...INLINE, ...SPREAD].filter((id) => statGroupOf(id) === null)).toEqual([]);
});

test("every group heading is used, and the first calculator stays the first option", () => {
  const all = [...INLINE, ...SPREAD];
  const used = new Set(all.map((id) => statGroupOf(id)));
  // every heading has at least one calculator
  for (const g of STAT_GROUP_ORDER) expect(used.has(g)).toBe(true);
  // the pane falls back to STAT_CALCS[0]; the grouped list must open on the same calculator
  expect(statGroupOf(INLINE[0])).toBe(STAT_GROUP_ORDER[0]);
});
