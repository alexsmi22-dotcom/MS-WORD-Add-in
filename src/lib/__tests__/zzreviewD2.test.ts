import * as fs from "fs";
import { TLINE_CALCS } from "../tlineCalcs";
import { AI_COMPUTE_CALCS } from "../aiComputeCalcs";
const all = [...TLINE_CALCS, ...AI_COMPUTE_CALCS];
const run = (id: string, over: Record<string, string>) => {
  const c = all.find((x) => x.id === id)!;
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  let o;
  try { o = c.compute((k) => vals[k] ?? ""); } catch (e) { return { id, over, threw: String(e) }; }
  const outs = Object.fromEntries((o.outputs ?? []).map((q) => [q.key, [q.value, q.unit]]));
  const tables = (o.blocks ?? []).filter((b: any) => b.kind === "table").map((b: any) => b.rows);
  return { id, over, ok: o.ok !== false, text: o.text, outs, tables };
};
test("dump", () => {
  const cases: Array<[string, Record<string, string>]> = JSON.parse(fs.readFileSync("C:/Users/ALEXAN~1/AppData/Local/Temp/claude/C--Users-AlexanderSmith/159af2e5-ca44-4a0b-8980-0dfa8841a194/scratchpad/d/cases.json", "utf8"));
  fs.writeFileSync("C:/Users/ALEXAN~1/AppData/Local/Temp/claude/C--Users-AlexanderSmith/159af2e5-ca44-4a0b-8980-0dfa8841a194/scratchpad/d/res.json", JSON.stringify(cases.map(([id, o]) => run(id, o)), null, 1));
});
