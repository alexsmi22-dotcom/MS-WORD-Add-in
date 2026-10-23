import { parseNetlist, solveDc, solveAc } from "../circuit";
import { solveTransient } from "../circuitTransient";
const nets: Record<string,string> = {
 e: "V1 1 0 1\nR1 1 2 1k\nR2 2 0 1k\nE1 3 0 2 0 10\nR3 3 0 1k",
 f: "V1 1 0 10\nVs 1 2 0\nR1 2 0 1k\nF1 0 3 Vs 5\nR2 3 0 100",
 h: "V1 1 0 10\nVs 1 2 0\nR1 2 0 1k\nH1 4 0 Vs 100\nR4 4 0 1k",
 g: "V1 1 0 10\nR1 1 0 1k\nG1 0 5 1 0 0.002\nR5 5 0 100",
 fneg: "V1 1 0 10\nVs 2 1 0\nR1 2 0 1k\nF1 3 0 Vs 5\nR2 3 0 100",
 opamp: "V1 in 0 1\nR1 in m 1k\nR2 m out 10k\nE1 out 0 0 m 100000",
 fb: "I1 0 1 1m\nR1 1 0 1k\nVs 1 2 0\nR2 2 0 1k\nF1 0 1 Vs 1",
};
test("dc", () => {
  for (const [k, t] of Object.entries(nets)) {
    const p = parseNetlist(t);
    if (p.errors.length) { console.log(k, p.errors); continue; }
    const r = solveDc(p.elements) as any;
    console.log(k, r.ok ? JSON.stringify({n: r.nodes.map((x:any)=>[x.name,x.volts]), c: r.currents.map((x:any)=>[x.name,x.amps])}) : r.error);
  }
});
const ac: Record<string,string> = {
 k: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nK1 L1 L2 0.5\nR2 3 0 50",
 k2: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 0 3 4m\nK1 L2 L1 0.9\nR2 3 0 50",
 k3: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nL3 4 0 2m\nK1 L1 L2 0.8\nK2 L2 L3 0.7\nK3 L1 L3 0.6\nR2 3 0 50\nR3 4 0 20\nE1 5 0 4 3 2\nR5 5 0 1k\nG1 0 6 3 0 0.01\nR6 6 0 100\nVs 4 7 0\nR7 7 0 1e9\nH1 8 0 Vs 3\nR8 8 0 1",
 kunity: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nK1 L1 L2 1\nR2 3 0 50",
};
test("ac", () => {
  for (const [k, t] of Object.entries(ac)) {
    const p = parseNetlist(t);
    if (p.errors.length) { console.log(k, p.errors); continue; }
    const r = solveAc(p.elements, 1000) as any;
    console.log(k, r.ok ? JSON.stringify(r.nodes.map((x:any)=>[x.name,x.re,x.im])) : r.error);
  }
});
test("tran", () => {
  const t = "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nK1 L1 L2 0.5\nR2 3 0 50";
  const p = parseNetlist(t.replace("V1 1 0 1", "V1 1 0 SIN(0 1 1k)"));
  console.log(p.errors);
  const r = solveTransient(p.elements, { stop: 0.01, step: 1e-6 } as any) as any;
  if (!r.ok) { console.log(r.error); return; }
  console.log(Object.keys(r));
  const tr = r.traces ?? r.series;
  console.log(JSON.stringify(Object.keys(tr ?? {})).slice(0,300));
  const ts = r.t ?? r.times;
  const n3 = (tr.find ? tr.find((x:any)=>x.name==="3") : tr["3"]);
  const vals = n3.values ?? n3.v ?? n3;
  let mx=0; for (let i=Math.floor(vals.length*0.8);i<vals.length;i++) mx=Math.max(mx,Math.abs(vals[i]));
  console.log("tran peak V3 last 20%", mx, vals.length);
});
