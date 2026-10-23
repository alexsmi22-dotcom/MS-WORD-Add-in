import { LASER_CALCS } from "../laserCalcs";
import { LINK_BUDGET_CALCS } from "../linkBudgetCalcs";
import { SEMICONDUCTOR_CALCS } from "../semiconductorCalcs";
import * as fs from "fs";
const ALL = [...LASER_CALCS, ...LINK_BUDGET_CALCS, ...SEMICONDUCTOR_CALCS] as any[];
const run = (id: string, over: Record<string, string> = {}) => {
  const c = ALL.find((x) => x.id === id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f: any) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k: string) => vals[k] ?? "");
};
const cases: Array<[string, string, Record<string, string>]> = [
  ["fp0", "laser-fabry-perot", {}],
  ["fp1", "laser-fabry-perot", { L: "25 cm", n: "1.5", R1: "90 %", R2: "0.5", lam: "1.55 µm" }],
  ["fp2", "laser-fabry-perot", { R1: "0.1", R2: "0.1" }],
  ["fp3", "laser-fabry-perot", { L: "1 mm", lam: "1550" }],
  ["th0", "laser-threshold", {}],
  ["th1", "laser-threshold", { ai: "5 cm^-1", L: "300 µm", R1: "0.32", R2: "0.32", lp: "800 nm", lam: "980 nm", pth: "20 mW", pp: "100 mW" }],
  ["th2", "laser-threshold", { ai: "0.5 /cm" }],
  ["th3", "laser-threshold", { ai: "0.05 /mm" }],
  ["th4", "laser-threshold", { ai: "2 dB/m" }],
  ["co0", "laser-coherence", {}],
  ["co1", "laser-coherence", { shape: "gaussian", dnu: "0.01 nm", lam: "632.8 nm", dnuc: "1 MHz", pout: "1 mW" }],
  ["co2", "laser-coherence", { dnu: "1 nm", lam: "" }],
  ["co3", "laser-coherence", { dnu: "1e6" , dnuc: "2 MHz", pout: "5 mW", lam: "1064 nm"}],
  ["co4", "laser-coherence", { dnu: "1 cm^-1" }],
  ["shg0", "laser-shg", {}],
  ["shg1", "laser-shg", { mode: "perfect", deff: "14 pm/V", I: "1 MW/cm^2", L: "10 mm" }],
  ["shg2", "laser-shg", { mode: "qpm", deff: "14 pm/V", I: "1e10", L: "10 mm", per: "6.9 µm" }],
  ["shg3", "laser-shg", { mode: "none", L: "10 mm" }],
  ["lb0", "rf-link-budget", {}],
  ["lb1", "rf-link-budget", { pt: "1 W", d: "5 mi", f: "900 MHz", sens: "-120 dBW" }],
  ["lb2", "rf-link-budget", { pt: "10 dBW" }],
  ["lb3", "rf-link-budget", { pt: "100 mW" }],
  ["lb4", "rf-link-budget", { pt: "20 dbm" }],
  ["lb5", "rf-link-budget", { gt: "6 dBd" }],
  ["lb6", "rf-link-budget", { d: "0.1 m" }],
  ["lb7", "rf-link-budget", { pt: "-10 W" }],
  ["lb8", "rf-link-budget", { pt: "20 dBmW" }],
  ["lb9", "rf-link-budget", { f: "2.4 GHz", d: "1 km", ltx: "-2" }],
  ["nc0", "noise-figure-cascade", {}],
  ["nc1", "noise-figure-cascade", { stages: "-3 3\n20 2\n-10 10\n30 8", bw: "200 kHz", snr: "12" }],
  ["nc2", "noise-figure-cascade", { stages: "20 0", bw: "1 MHz", snr: "" }],
  ["ber0", "ber-ebn0", {}],
  ["ber1", "ber-ebn0", { mod: "qpsk", ebn0: "9.6" }],
  ["ber2", "ber-ebn0", { mod: "dbpsk", ebn0: "10" }],
  ["ber3", "ber-ebn0", { mod: "8psk", ebn0: "12" }],
  ["ber4", "ber-ebn0", { mod: "16psk", ebn0: "16" }],
  ["ber5", "ber-ebn0", { mode: "target", mod: "bpsk", target: "1e-6" }],
  ["ber6", "ber-ebn0", { mode: "target", mod: "dbpsk", target: "10^-9" }],
  ["ber7", "ber-ebn0", { mode: "target", mod: "8psk", target: "1×10⁻⁵" }],
  ["ber8", "ber-ebn0", { mode: "cn0", mod: "bpsk", cn0: "70", rate: "1 Mbps" }],
  ["ber9", "ber-ebn0", { mode: "cn0", mod: "bpsk", cn0: "70", rate: "1 kbit/s" }],
  ["ber10", "ber-ebn0", { mode: "cn0", mod: "bpsk", cn0: "70", rate: "1 MB/s" }],
  ["ber11", "ber-ebn0", { mode: "ebn0", mod: "bpsk", ebn0: "40" }],
  ["ber12", "ber-ebn0", { mode: "target", mod: "16psk", target: "1e-15" }],
  ["pn0", "semi-pn-junction", {}],
  ["pn1", "semi-pn-junction", { na: "1e22 m^-3", nd: "1e18", vr: "5 V" }],
  ["pn2", "semi-pn-junction", { na: "1×10¹⁷", nd: "1 x 10^15", mat: "gaas" }],
  ["pn3", "semi-pn-junction", { na: "1e16 cm-3" }],
  ["pn4", "semi-pn-junction", { T: "350 K", ni: "1e11" }],
  ["pn5", "semi-pn-junction", { T: "26.85 °C" }],
  ["pn6", "semi-pn-junction", { is: "10 fA", vd: "0.7" }],
  ["pn7", "semi-pn-junction", { na: "1e19" }],
  ["mos0", "semi-mosfet-square-law", {}],
  ["mos1", "semi-mosfet-square-law", { vds: "0.4 V", lambda: "0.05" }],
  ["mos2", "semi-mosfet-square-law", { vds: "2", lambda: "0.1 1/V", tox: "100 Å" }],
  ["mos3", "semi-mosfet-square-law", { mu: "0.04 m^2/(V*s)" }],
  ["mos4", "semi-mosfet-square-law", { vgs: "0.3" }],
  ["mos5", "semi-mosfet-square-law", { lambda: "0.1 /V" }],
  ["car0", "semi-carriers", {}],
  ["car1", "semi-carriers", { nd: "1e15", na: "1e16" }],
  ["car2", "semi-carriers", { nd: "0", na: "0" }],
  ["car3", "semi-carriers", { nd: "1e18", na: "0" }],
  ["car4", "semi-carriers", { nd: "5e10", na: "0" }],
  ["car5", "semi-carriers", { mat: "gaas", nd: "1e17" }],
];
test("dump", () => {
  const out: any = {};
  for (const [name, id, over] of cases) {
    let o: any;
    try { o = run(id, over); } catch (e) { o = { ok: false, text: "THROW " + (e as Error).message }; }
    const tables = (o.blocks ?? []).filter((b: any) => b.kind === "table").map((b: any) => b.rows);
    out[name] = { ok: o.ok !== false, text: o.text, outputs: Object.fromEntries((o.outputs ?? []).map((q: any) => [q.key, [q.value, q.unit]])), tables, blocksText: JSON.stringify((o.blocks ?? []).filter((b: any) => b.kind !== "plot")) };
  }
  fs.writeFileSync(process.env.ZZOUT as string, JSON.stringify(out, null, 1));
});
