import { LASER_CALCS } from "../laserCalcs";
import { LINK_BUDGET_CALCS } from "../linkBudgetCalcs";
import { SEMICONDUCTOR_CALCS } from "../semiconductorCalcs";
const ALL = [...LASER_CALCS, ...LINK_BUDGET_CALCS, ...SEMICONDUCTOR_CALCS] as any[];
const HOSTILE = ["1e400", "-1e400", "1e308", "1e-320", "0", "-0", "-5", "NaN", "Infinity", "abc", "1e15", "1e-15", " ", "5 kg", "1,5", "0x10", "1e16 m^-3", "100 %", "1 GHz", "3 km"];
test("hostile", () => {
  const bad: string[] = [];
  for (const c of ALL) {
    const defs: Record<string, string> = Object.fromEntries(c.fields.map((f: any) => [f.key, f.default]));
    for (const f of c.fields) {
      if (f.kind === "select") continue;
      for (const h of HOSTILE) {
        const vals = { ...defs, [f.key]: h };
        const t0 = Date.now();
        let o: any;
        try { o = c.compute((k: string) => (vals as any)[k] ?? ""); } catch (e) { bad.push(`${c.id}.${f.key}=${h}: THROW ${(e as Error).message}`); continue; }
        const dt = Date.now() - t0;
        if (dt > 1500) bad.push(`${c.id}.${f.key}=${h}: SLOW ${dt}ms`);
        if (o.ok === false) continue;
        const svgs = (o.blocks ?? []).filter((b: any) => b.kind === "plot").map((b: any) => b.svg).join("");
        const txt = o.text + JSON.stringify((o.blocks ?? []).filter((b: any) => b.kind === "table"));
        if (/NaN|Infinity|undefined/.test(txt)) bad.push(`${c.id}.${f.key}=${h}: TEXT ${txt.match(/.{0,60}(NaN|Infinity|undefined).{0,20}/)?.[0]}`);
        if (/NaN|Infinity|undefined/.test(svgs)) bad.push(`${c.id}.${f.key}=${h}: SVG ${svgs.match(/.{0,60}(NaN|Infinity|undefined).{0,20}/)?.[0]}`);
        if (/\d[eE][+-]?\d/.test(o.text)) bad.push(`${c.id}.${f.key}=${h}: ENOTATION ${o.text.match(/.{0,50}\d[eE][+-]?\d.{0,10}/)?.[0]}`);
        for (const q of o.outputs ?? []) if (!Number.isFinite(q.value)) bad.push(`${c.id}.${f.key}=${h}: OUTPUT ${q.key}=${q.value}`);
        if (/(?<![A-Za-z\-])-\d/.test(o.text)) bad.push(`${c.id}.${f.key}=${h}: HYPHEN ${o.text.match(/.{0,40}(?<![A-Za-z\-])-\d.{0,10}/)?.[0]}`);
      }
    }
  }
  console.log(bad.join("\n"));
});
