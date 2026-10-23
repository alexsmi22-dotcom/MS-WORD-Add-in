import { parseNetlist, solveAc } from "../circuit";
import { solveTransient } from "../circuitTransient";
const ac: Record<string,string> = {
 k: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nK1 L1 L2 0.5\nR2 3 0 50",
 k2: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 0 3 4m\nK1 L2 L1 0.9\nR2 3 0 50",
 k3: "V1 1 0 1\nR1 1 2 10\nL1 2 0 1m\nL2 3 0 4m\nL3 4 0 2m\nK1 L1 L2 0.8\nK2 L2 L3 0.7\nK3 L1 L3 0.6\nR2 3 0 50\nR3 4 0 20\nE1 5 0 4 3 2\nR5 5 0 1k\nG1 0 6 3 0 0.01\nR6 6 0 100\nVs 4 7 0\nR7 7 0 1e9\nH1 8 0 Vs 3\nR8 8 0 1",
 fc: "V1 1 0 1\nR1 1 2 1k\nC1 2 0 100n\nVs 2 3 0\nR3 3 0 1k\nF1 0 4 Vs 10\nR4 4 0 100\nC4 4 0 1u",
 opc: "V1 in 0 1\nR1 in m 1k\nR2 m out 10k\nC2 m out 10n\nE1 out 0 0 m 100000",
};
test("tran vs ac", () => {
  for (const [k, t] of Object.entries(ac)) {
    const p = parseNetlist(t);
    const a = solveAc(p.elements, 1000) as any;
    const q = parseNetlist(t.replace(/^V1 (\S+) 0 1$/m, "V1 $1 0 SIN(0 1 1k)"));
    const r = solveTransient(q.elements, { stop: 0.02, step: 2e-7 }) as any;
    if (!r.ok) { console.log(k, r.error); continue; }
    const out: string[] = [];
    for (const pr of r.probes) {
      const v = pr.values; let mx = 0;
      for (let i = Math.floor(v.length * 0.9); i < v.length; i++) mx = Math.max(mx, Math.abs(v[i]));
      const an = a.nodes.find((x:any)=>x.name===pr.name);
      out.push(`${pr.name}: tran ${mx.toPrecision(5)} ac ${an?.magnitude.toPrecision(5)}`);
    }
    console.log(k, out.join(" | "), r.notes.length);
  }
});
