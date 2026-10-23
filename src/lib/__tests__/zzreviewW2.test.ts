import { runUncertainty, runSweep } from "../engWorkbench";
import { AI_COMPUTE_CALCS } from "../aiComputeCalcs";
const log = (...a: unknown[]) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
test("list field uncertainty", () => {
  const c = AI_COMPUTE_CALCS.find((x) => x.id === "ai-roofline")!;
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  const read = (k: string) => vals[k] ?? "";
  const base = c.compute(read);
  log(base.outputs);
  const r = runUncertainty(c.compute, read, [{ field: "mnk", u: 10, relative: true }], "flops", 400);
  if (r.ok) log({ value: r.output.value, sd: r.sd, rel: r.sd / r.output.value, gum: r.gum });
  else log(r);
  const s = runSweep(c.compute, read, { field: "mnk", from: "1024", to: "8192", points: 3, log: false, output: "flops" });
  log(s);
});
