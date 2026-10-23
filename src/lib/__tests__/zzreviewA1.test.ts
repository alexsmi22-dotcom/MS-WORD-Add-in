import { THERMAL_STRESS_CALCS } from "../thermalStressCalcs";
import { VESSELS_CALCS } from "../vesselsCalcs";
import { GAS_DYNAMICS_CALCS } from "../gasDynamicsCalcs";
import * as fs from "fs";
const ALL: any[] = [...THERMAL_STRESS_CALCS, ...VESSELS_CALCS, ...GAS_DYNAMICS_CALCS];
const BAD = /NaN|Infinity|undefined|not finite|\d[eE][+-]?\d|\^|—|(?<![A-Za-z])-\d/;
function run(id: string, over: Record<string, string>) {
  const c = ALL.find((x) => x.id === id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f: any) => [f.key, f.default]));
  Object.assign(vals, over);
  const t0 = Date.now();
  let o: any;
  try { o = c.compute((k: string) => vals[k] ?? ""); } catch (e) { return { id, over, THROW: String(e) }; }
  const ms = Date.now() - t0;
  const tables = (o.blocks ?? []).filter((b: any) => b.kind === "table").map((b: any) => b.rows);
  const eqs = (o.blocks ?? []).filter((b: any) => b.kind !== "table" && b.kind !== "plot").map((b: any) => b.text ?? b.fallback ?? "");
  const allText = [o.text, ...tables.flat(2)].join("\n");
  const bad = allText.split("\n").filter((l: string) => BAD.test(l));
  const plotsBad = (o.blocks ?? []).filter((b: any) => b.kind === "plot" && /NaN|Infinity|undefined/.test(b.svg)).length;
  return { id, over, ok: o.ok, ms, text: o.text, outputs: (o.outputs ?? []).map((x: any) => `${x.key}=${x.value} ${x.unit}`), tables, bad, plotsBad };
}
test("probe", () => {
  const probes: Array<[string, Record<string, string>]> = JSON.parse(fs.readFileSync(process.env.PROBES as string, "utf8"));
  const res = probes.map(([id, o]) => run(id, o));
  fs.writeFileSync(process.env.PROBES + ".out.json", JSON.stringify(res, null, 1));
});
